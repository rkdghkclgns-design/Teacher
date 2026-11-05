// output-import.js - 내보낸 교안 파일(HTML·MD)을 다시 불러와 고칠 수 있는 차시로 되살린다
// HTML 내보내기에는 원본(탭 글·그림·교수안 MD)을 <script type="application/json" id="teacher-source">로 함께 담고,
// MD 내보내기에는 차시·탭 표시(<!-- teacher-lesson / teacher-tab -->)를 넣는다(lesson-export.js, ui.js, gyosuan-view.js).
// 불러오는 파일은 남이 준 것일 수 있어 글은 문자열만, 그림은 data:image만 받고 id는 새로 준다. 테스트: tests/output-import.test.js

const OUTPUT_FORMAT = 'teacher-lesson-export';
const OUTPUT_FILE_MAX = 80 * 1024 * 1024; // 그림이 든 교과 HTML도 받되, 브라우저가 멈출 만큼 큰 파일은 받지 않는다
const OUTPUT_SOURCE_RE = /<script type="application\/json" id="teacher-source">([\s\S]*?)<\/script>/;
const OUTPUT_TAB_RE = /<!--\s*teacher-tab:\s*([A-Za-z]+)\s*-->/g;
const OUTPUT_LESSON_RE = /<!--\s*teacher-lesson:\s*title=([^\s]*)\s*-->/;
const OUTPUT_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const OUTPUT_TAB_SEPARATOR = '\n\n---\n\n';

const outputText = value => (typeof value === 'string' ? value : '');

/* ---------- 내보낼 때: 원본 담기 ---------- */
// 저장된 원문 그대로(첫머리 정리 전). tabIds를 주면 그 탭만. 탭이 비고 옛 단일 본문만 있으면 기본학습으로 본다
function lessonSourceTabs(mod, tabIds = null) {
    const tabs = mod?.tabContents || {};
    const legacy = !!mod?.content && !LESSON_TABS.some(tab => tabs[tab.id]);
    return Object.fromEntries(LESSON_TABS
        .filter(tab => !tabIds || tabIds.includes(tab.id))
        .map(tab => [tab.id, tabs[tab.id] || (legacy && tab.id === 'basicLearn' ? mod.content : '')])
        .filter(([, md]) => md && String(md).trim()));
}

// 담은 탭이 쓰는 그림만 고른다(파일이 커지지 않게)
function usedLessonImages(images, texts) {
    const all = texts.join('\n');
    return Object.fromEntries(Object.entries(images || {}).filter(([id, data]) => typeof data === 'string' && all.includes(`local:${id}`)));
}

function lessonSourcePayload(mods, { tabIds = null, withGyosuan = true } = {}) {
    return {
        format: OUTPUT_FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        lessons: mods.map(mod => {
            const tabContents = lessonSourceTabs(mod, tabIds);
            const gyosuan = withGyosuan && mod.gyosuan?.docMd ? { docMd: mod.gyosuan.docMd, deckMd: mod.gyosuan.deckMd || '' } : null;
            return {
                title: mod.title || '',
                description: mod.description || '',
                hours: mod.hours,
                tabContents,
                images: usedLessonImages(mod.images, [...Object.values(tabContents), gyosuan?.docMd || '', gyosuan?.deckMd || '']),
                gyosuan
            };
        })
    };
}

// HTML 안에 원본을 담는 태그. JSON 속 '<'를 \u003c로 바꿔 </script>로 태그가 끊기지 않게 한다
function lessonSourceScript(payload) {
    return `<script type="application/json" id="teacher-source">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`;
}

// MD 내보내기: 차시 표시와 탭마다 표시를 넣는다. 제목은 주석이 끊기지 않게 인코딩한다
function lessonMarkdownExport(mod, tabs) {
    const head = `<!-- teacher-lesson: title=${encodeURIComponent(mod.title || '')} -->\n`;
    const body = tabs.map(tab => `<!-- teacher-tab: ${tab.id} -->\n${tabs.length > 1 ? `# [${tab.label}]\n\n` : ''}${tab.md}`).join(OUTPUT_TAB_SEPARATOR);
    return head + body;
}

/* ---------- 불러올 때: 원본 읽기 ---------- */
function parseOutputHtml(text) {
    const match = String(text || '').match(OUTPUT_SOURCE_RE);
    if (!match) return null;
    try {
        const data = JSON.parse(match[1]);
        return data && data.format === OUTPUT_FORMAT && Array.isArray(data.lessons) ? data.lessons : null;
    } catch (err) {
        console.warn('[불러오기] HTML 안의 원본을 읽지 못했습니다:', err.message);
        return null;
    }
}

const tabIdOf = name => {
    const key = String(name || '').trim();
    return LESSON_TABS.find(tab => tab.id === key || tab.label === key || tab.label.replace(/\s/g, '') === key.replace(/\s/g, ''))?.id || null;
};

// 탭 하나의 글에서 내보낼 때 붙인 머리(# [그 탭 이름])와 다음 탭 앞의 구분선만 뗀다.
// 글 첫 줄이 다른 '# [..]' 제목이거나 마지막 탭이 구분선으로 끝나면 교안 내용이므로 둔다
// headOf: 머리를 뗄 탭 id(머리를 붙이지 않은 한 탭 내보내기면 비움)
function cleanTabPart(text, { headOf = null, isLast = true } = {}) {
    let part = String(text);
    const head = part.match(/^\s*# \[([^\]\n]+)\][ \t]*(\n|$)/);
    if (headOf && head && tabIdOf(head[1]) === headOf) part = part.slice(head[0].length);
    if (!isLast) part = part.replace(/\n+---\s*$/, '');
    return part.trim();
}

// MD 한 파일 → 차시 하나. 표시가 있으면 탭별로, 예전 내보내기면 '# [탭]' 머리로, 그 밖이면 전체를 기본학습으로
function parseOutputMarkdown(text, fileName = '') {
    const src = String(text || '').replace(/\r\n/g, '\n');
    const titleMark = src.match(OUTPUT_LESSON_RE);
    let title = '';
    if (titleMark) {
        try { title = decodeURIComponent(titleMark[1]); } catch (err) { title = ''; }
    }
    const body = src.replace(OUTPUT_LESSON_RE, '');
    const tabContents = {};
    const marks = [...body.matchAll(OUTPUT_TAB_RE)];
    if (marks.length) {
        marks.forEach((mark, i) => {
            const id = tabIdOf(mark[1]);
            const end = i + 1 < marks.length ? marks[i + 1].index : body.length;
            const part = cleanTabPart(body.slice(mark.index + mark[0].length, end), { headOf: marks.length > 1 ? id : null, isLast: i === marks.length - 1 });
            if (id && part) tabContents[id] = part;
        });
    } else {
        const heads = [...body.matchAll(/^# \[([^\]\n]+)\]\s*$/gm)].filter(head => tabIdOf(head[1]));
        if (heads.length) {
            heads.forEach((head, i) => {
                const end = i + 1 < heads.length ? heads[i + 1].index : body.length;
                const id = tabIdOf(head[1]);
                const part = cleanTabPart(body.slice(head.index, end), { headOf: id, isLast: i === heads.length - 1 });
                if (part) tabContents[id] = part;
            });
        } else if (body.trim()) {
            tabContents.basicLearn = body.trim();
        }
    }
    const fallbackTitle = String(fileName).replace(/\.(md|markdown|txt)$/i, '').replace(/^\d+[_.\s-]*/, '').trim();
    return [{ title: title || fallbackTitle, tabContents, images: {} }];
}

/* ---------- 검사: 남이 준 파일일 수 있다 ---------- */
function normalizeImportedLesson(raw, id) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const tabs = source.tabContents && typeof source.tabContents === 'object' ? source.tabContents : {};
    const tabContents = Object.fromEntries(LESSON_TABS.map(tab => [tab.id, outputText(tabs[tab.id]) || null]));
    const images = Object.fromEntries(Object.entries(source.images && typeof source.images === 'object' ? source.images : {})
        .filter(([key, data]) => /^[\w-]{1,80}$/.test(key) && typeof data === 'string' && OUTPUT_IMAGE_RE.test(data)));
    const gyosuanSource = source.gyosuan && typeof source.gyosuan === 'object' ? source.gyosuan : null;
    const docMd = outputText(gyosuanSource?.docMd);
    const content = LESSON_TABS.map(tab => tabContents[tab.id] || '').filter(Boolean).join(OUTPUT_TAB_SEPARATOR);
    const hours = Number(source.hours);
    return {
        id,
        title: outputText(source.title).trim().slice(0, 300) || '불러온 차시',
        description: outputText(source.description).slice(0, 4000),
        ...(Number.isFinite(hours) && hours > 0 ? { hours } : {}),
        status: content ? 'done' : 'waiting',
        content: content || null,
        tabContents,
        images,
        ...(docMd ? { gyosuan: { docMd, deckMd: outputText(gyosuanSource.deckMd), updatedAt: new Date().toISOString() } } : {}),
        uploadedMdName: null,
        uploadedMdContent: null
    };
}

/* ---------- 화면: 내보내기·백업 → 내보낸 교안 다시 불러오기 ---------- */
const onEditorScreen = () => /^#editor/.test(location.hash) && !!globalState.subjects.find(s => s.id === currentSubjectId);

// 편집 중인 교과가 있으면 거기에, 아니면 새 교과를 만들어 넣는다
function outputImportTarget() {
    if (onEditorScreen()) return { subject: globalState.subjects.find(s => s.id === currentSubjectId), isNew: false };
    const stamp = new Date().toLocaleDateString();
    const subject = sanitizeState({ subjects: [{ id: generateUniqueId('subject_'), title: `불러온 교안 (${stamp})`, description: '내보낸 교안 파일에서 되살린 교과입니다.', lessons: [] }] }).subjects[0];
    return { subject, isNew: true };
}

async function readOutputFile(file) {
    if (file.size > OUTPUT_FILE_MAX) throw new Error('파일이 너무 큽니다(80MB 넘음)');
    const text = await file.text();
    if (/\.html?$/i.test(file.name)) {
        const lessons = parseOutputHtml(text);
        if (!lessons) throw new Error('되살릴 원본이 들어 있지 않습니다(이번 업데이트 전에 내보낸 HTML이거나 다른 프로그램의 파일입니다. MD나 백업 ZIP을 써 주세요)');
        return lessons;
    }
    return parseOutputMarkdown(text, file.name);
}

window.importOutputFiles = async function (event) {
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = ''; // 같은 파일을 다시 고를 수 있게
    if (!files.length) return;
    const found = [];
    const failed = [];
    for (const file of files) {
        try {
            found.push(...(await readOutputFile(file)));
        } catch (err) {
            console.error('[불러오기] 파일 실패:', file.name, err);
            failed.push(`${file.name}: ${err.message}`);
        }
    }
    const usable = found.filter(raw => raw && typeof raw === 'object');
    if (!usable.length) return window.showAlert(`불러올 교안을 찾지 못했습니다.\n${failed.join('\n')}`);
    const { subject, isNew } = outputImportTarget();
    const where = isNew ? `새 교과 '${subject.title}'를 만들어` : `'${subject.title}' 교과에`;
    const ok = await confirmAsync(`파일 ${files.length}개에서 차시 ${usable.length}개를 찾았습니다.\n${where} 새 차시로 넣습니다. 지금 있는 차시는 그대로 둡니다.${failed.length ? `\n\n읽지 못한 파일 ${failed.length}개는 건너뜁니다.` : ''}`, { okLabel: '불러오기', tone: 'primary', title: '내보낸 교안 다시 불러오기' });
    if (!ok) return;
    window.saveRawContent?.(); // 고치던 원문을 먼저 저장한다
    const existing = isNew ? [] : (subject.id === currentSubjectId ? courseData : subject.lessons || []);
    const ids = renumberLessons(usable.map(() => ({})), existing.map(lesson => lesson.id)).map(lesson => lesson.id);
    const lessons = usable.map((raw, i) => normalizeImportedLesson(raw, ids[i]));
    if (isNew) {
        globalState.subjects = [...globalState.subjects, { ...subject, lessons }];
    } else if (subject.id === currentSubjectId) {
        courseData = [...courseData, ...lessons];
    } else {
        subject.lessons = [...existing, ...lessons];
    }
    await saveState();
    if (failed.length) window.showAlert(`읽지 못한 파일이 있습니다.\n${failed.join('\n')}`);
    window.showToast?.(`차시 ${lessons.length}개를 불러왔습니다. 바로 고칠 수 있습니다.`, 'success');
    if (isNew) location.hash = `#editor/${subject.id}/${lessons[0].id}`;
    else {
        renderSidebar();
        viewModule(lessons[0].id);
    }
};

if (typeof window !== 'undefined') {
    Object.assign(window, { lessonSourcePayload, lessonSourceScript, lessonMarkdownExport, parseOutputHtml, parseOutputMarkdown, normalizeImportedLesson, lessonSourceTabs });
}
