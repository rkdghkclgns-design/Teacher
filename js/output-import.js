// output-import.js - 내보낸 교안 파일(HTML·MD)을 다시 불러와 고칠 수 있는 차시로 되살린다
// HTML 내보내기에는 원본(탭 글, 화면에 없는 그림. 교수안 HTML이면 교수안·편성안과 그 그림도)을 <script type="application/json" id="teacher-source">로 담는다.
// 화면에 보이는 그림은 <img data-teacher-image="키" data-teacher-lesson="차시 번호">로 표시하고 원본에는 null로만 적는다(그림을 두 번 담지 않는다, version 2).
// 진짜 그림(data:image)만 담는다. 찾지 못한 그림 자리(teacher-image:…)·빈 값은 담지 않아, 다시 불러오면 빈 그림 자리로 센다.
// MD 내보내기에는 차시·탭 표시(<!-- teacher-lesson / teacher-tab -->)를 넣는다(lesson-export.js, ui.js, gyosuan-view.js).
// 불러오는 파일은 남이 준 것일 수 있어 글은 문자열만, 그림 키는 [\w-]만, 그림은 data:image만 받고 id는 새로 준다. 테스트: tests/output-import.test.js

const OUTPUT_FORMAT = 'teacher-lesson-export';
const OUTPUT_VERSION = 2; // 1: 그림을 모두 원본에 담음(af5287a). 2: 화면에 보인 그림은 원본에 null로 적고 그 <img>에서 읽는다
const OUTPUT_FILE_MB = 80;
const OUTPUT_FILE_MAX = OUTPUT_FILE_MB * 1024 * 1024; // 그림이 든 교과 HTML도 받되, 브라우저가 멈출 만큼 큰 파일은 받지 않는다
const OUTPUT_SOURCE_RE = /<script type="application\/json" id="teacher-source">([\s\S]*?)<\/script>/;
const OUTPUT_TAB_RE = /<!--\s*teacher-tab:\s*([A-Za-z]+)\s*-->/g; // /g라서 .test()에 쓰지 않는다(lastIndex가 움직인다)
const OUTPUT_TAB_MARK = /<!--\s*teacher-tab:/; // 탭 표시가 있는지만 볼 때
const OUTPUT_LESSON_RE = /<!--\s*teacher-lesson:\s*title=([^\s]*)\s*-->/;
const OUTPUT_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const OUTPUT_PICTURE_RE = /^data:image\//; // 담을 그림인지(진짜 그림). data-safety.js보다 먼저 실리므로 따로 둔다
const OUTPUT_IMAGE_KEY_RE = /^[\w-]{1,80}$/; // lesson-export.js EXPORT_IMAGE_KEY_RE, data-safety.js SAFE_IMAGE_KEY와 같은 규칙
const OUTPUT_IMG_TAG_RE = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi; // 따옴표 안의 >에서 끊기지 않는다
const OUTPUT_IMG_ATTR_RE = /\s([^\s=>"'\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
const OUTPUT_NUMBER_HEAD = /^\d+[_.\s-]*/; // ZIP 파일 이름·머리의 01_ 같은 번호
const OUTPUT_HTML_NAME = /\.html?$/i;
const OUTPUT_MD_NAME = /\.(md|markdown|txt)$/i;
const OUTPUT_GYOSUAN_NAME = /(교수안|편성안)(_묶음)?$/; // 06_교수안, 07_슬라이드편성안, …_교수안, …_차시별편성안, …_교수안_편성안_묶음
const OUTPUT_GYOSUAN_TEXT = /^##\s*진행\s*$|^(?:###\s*슬라이드|##\s*슬라이드\s*편성)/m; // gyosuan-io.js gyosuanFileKind와 같은 표시
const OUTPUT_TAB_SEPARATOR = '\n\n---\n\n';
const OUTPUT_CONFIRM_LESSONS = 5; // 확인 창에 제목을 보일 차시 수(나머지는 '외 N개')
const OUTPUT_CONFIRM_TITLE = 40; // 확인 창에 보일 제목 글자 수
const OUTPUT_CONFIRM_FAILED = 3; // 확인 창·알림에 까닭을 보일 건너뛴 파일 수
const OUTPUT_DEDUPE_SCAN = 20; // 탭 글이 같은 차시끼리 견줄 때 앞에서부터 살피는 수(남이 만든 파일에 같은 차시가 아주 많아도 멈추지 않게)
const OUTPUT_FILE_LESSONS = 2000; // 한 파일에서 받는 차시 수. 남이 만든 아주 긴 목록으로 확인 창 앞에서 멈추지 않게 한다(교과 HTML 하나에는 넉넉하다)

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

// 담은 탭이 쓰는 그림만 고른다(파일이 커지지 않게). 진짜 그림만: 찾지 못한 그림 자리(teacher-image:…)·빈 값은 담지 않는다
// (화면·내보내기도 그런 값은 빈 그림으로 그린다. 다시 불러오면 그 자리는 빈 그림으로 센다)
function usedLessonImages(images, texts) {
    const all = texts.join('\n');
    return Object.fromEntries(Object.entries(images || {}).filter(([id, data]) => typeof data === 'string' && OUTPUT_PICTURE_RE.test(data) && all.includes(`local:${id}`)));
}

// 화면에 보인 그림(shown: Map 키 → 그림)은 원본에 null로만 적는다. 다시 불러올 때 그 <img>에서 읽는다
// 같은 키라도 화면 그림과 다르면(교수안 쪽 그림 등) 원본에 그대로 담는다
function outputSourceImages(images, shown) {
    return Object.fromEntries(Object.entries(images).map(([key, data]) => [key, shown && shown.get(key) === data ? null : data]));
}

// 읽기용 원본에는 화면에서 늘 숨기는 예전 강사 안내(instructor-callout, data.js stripInstructorCallouts)를 넣지 않는다
function outputReaderTabs(tabs) {
    if (typeof stripInstructorCallouts !== 'function') return tabs;
    return Object.fromEntries(Object.entries(tabs)
        .filter(([, md]) => typeof md === 'string')
        .map(([id, md]) => [id, stripInstructorCallouts(md)])
        .filter(([, md]) => md.trim()));
}

// withGyosuan: 교수안·편성안과 그 그림까지 담는다(교수안 화면의 HTML만). 메뉴의 차시·교과 HTML과 ZIP의 교안.html(읽기용)에는 담지 않는다
// shown: 차시 순서대로 Map(그림 키 → 화면에 보인 그림). lesson-export.js markShownImages가 채운다
// mods는 화면(내보낸 본문)을 그린 바로 그 차시 객체여야 한다. 그리지 않은 그림은 원본에 그림 그대로 담기기 때문이다
function lessonSourcePayload(mods, { tabIds = null, withGyosuan = false, shown = [] } = {}) {
    return {
        format: OUTPUT_FORMAT,
        version: OUTPUT_VERSION,
        exportedAt: new Date().toISOString(),
        lessons: mods.map((mod, index) => {
            const tabs = lessonSourceTabs(mod, tabIds);
            const tabContents = withGyosuan ? tabs : outputReaderTabs(tabs);
            const docMd = withGyosuan ? mod.gyosuan?.docMd || '' : '';
            const deckMd = docMd ? mod.gyosuan.deckMd || '' : '';
            const gyosuan = docMd ? { docMd, deckMd, images: outputSourceImages(usedLessonImages(mod.gyosuan.images, [docMd, deckMd]), shown[index]) } : null;
            return {
                title: mod.title || '',
                description: mod.description || '',
                hours: mod.hours,
                tabContents,
                images: outputSourceImages(usedLessonImages(mod.images, [...Object.values(tabContents), docMd, deckMd]), shown[index]),
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
// <img …> 태그 하나의 속성(큰따옴표·작은따옴표·따옴표 없는 값). 같은 이름이 또 있으면 처음 것만 본다(브라우저와 같다)
function outputImgAttributes(tag) {
    const attrs = new Map();
    for (const [, name, double, single, bare] of tag.matchAll(OUTPUT_IMG_ATTR_RE)) {
        const key = name.toLowerCase();
        if (!attrs.has(key)) attrs.set(key, double ?? single ?? bare ?? '');
    }
    return attrs;
}

// 화면 그림 가운데 다시 불러오기 표시가 있는 것: Map('차시 번호/키' → 그림). 검사를 통과한 것만, 같은 자리는 처음 것만 쓴다
// 브라우저는 DOMParser로 읽는다(스크립트가 돌지 않고 그림도 내려받지 않는다). DOMParser가 없으면(node 테스트) 태그를 직접 읽는다
function readShownImages(html) {
    const found = new Map();
    const add = (lesson, key, src) => {
        if (!/^\d{1,4}$/.test(String(lesson)) || !OUTPUT_IMAGE_KEY_RE.test(String(key)) || typeof src !== 'string' || !OUTPUT_IMAGE_RE.test(src)) return;
        const at = `${Number(lesson)}/${key}`;
        if (!found.has(at)) found.set(at, src);
    };
    if (typeof DOMParser === 'function') {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('img[data-teacher-image]').forEach(img => add(img.getAttribute('data-teacher-lesson') ?? '0', img.getAttribute('data-teacher-image'), img.getAttribute('src')));
        return found;
    }
    for (const [tag] of html.matchAll(OUTPUT_IMG_TAG_RE)) {
        const attrs = outputImgAttributes(tag);
        if (attrs.has('data-teacher-image')) add(attrs.get('data-teacher-lesson') ?? '0', attrs.get('data-teacher-image'), attrs.get('src'));
    }
    return found;
}

const outputHasShownImage = images => !!images && typeof images === 'object' && Object.values(images).some(data => data === null);

// 원본에 null로 적힌 그림을 화면의 <img>에서 채운다. 못 찾으면 뺀다(그 자리는 빈 그림으로 남고 확인 창이 센다)
function fillShownImages(images, index, shown) {
    if (!images || typeof images !== 'object') return {};
    return Object.fromEntries(Object.entries(images)
        .map(([key, data]) => [key, data === null ? shown.get(`${index}/${key}`) : data])
        .filter(([, data]) => data !== undefined));
}

function parseOutputHtml(text) {
    const html = String(text || '');
    const match = html.match(OUTPUT_SOURCE_RE);
    if (!match) return null;
    let data;
    try {
        data = JSON.parse(match[1]);
    } catch (err) {
        console.warn('[불러오기] HTML 안의 원본을 읽지 못했습니다:', err.message);
        return null;
    }
    if (!data || data.format !== OUTPUT_FORMAT || !Array.isArray(data.lessons)) return null;
    const isObject = value => !!value && typeof value === 'object';
    // 예전(version 1) 파일처럼 그림이 모두 원본에 들어 있으면 화면은 읽지 않는다
    if (!data.lessons.some(lesson => isObject(lesson) && (outputHasShownImage(lesson.images) || outputHasShownImage(lesson.gyosuan?.images)))) return data.lessons;
    const shown = readShownImages(html);
    return data.lessons.map((lesson, index) => {
        if (!isObject(lesson)) return lesson;
        const gyosuan = isObject(lesson.gyosuan) ? { ...lesson.gyosuan, images: fillShownImages(lesson.gyosuan.images, index, shown) } : lesson.gyosuan;
        return { ...lesson, images: fillShownImages(lesson.images, index, shown), gyosuan };
    });
}

// 탭 id·이름. 앞 번호(ZIP의 01_기본학습)와 띄어쓰기는 보지 않는다
const tabIdOf = name => {
    const key = String(name || '').trim().replace(OUTPUT_NUMBER_HEAD, '');
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

// 파일 이름에서 확장자와 내려받을 때 붙은 번호(' (1)')를 뗀다
const outputFileBase = fileName => String(fileName || '').replace(OUTPUT_MD_NAME, '').replace(/\s*\(\d+\)$/, '').trim();

// ZIP의 탭 MD(01_기본학습.md…)면 그 탭 id. 차시·탭 표시가 있는 MD(이 앱의 MD 내보내기)는 표시를 따른다
function outputTabFileOf(text, fileName) {
    const src = String(text || '');
    if (OUTPUT_LESSON_RE.test(src) || OUTPUT_TAB_MARK.test(src)) return null;
    return tabIdOf(outputFileBase(fileName));
}

// MD의 차시 표시(<!-- teacher-lesson: title=… -->)에 적힌 제목. 표시가 없거나 읽지 못하면 ''
function outputMarkTitle(text) {
    const mark = String(text || '').match(OUTPUT_LESSON_RE);
    if (!mark) return '';
    try { return decodeURIComponent(mark[1]); } catch (err) { return ''; }
}

// MD 한 파일 → 차시 하나. 표시가 있으면 탭별로, ZIP의 탭 MD(02_기본실습.md)면 글 전체를 그 탭으로,
// 예전 내보내기면 '# [탭]' 머리(ZIP _전체.md의 # [01_기본학습] 포함)로, 그 밖이면 전체를 기본학습으로
function parseOutputMarkdown(text, fileName = '') {
    const src = String(text || '').replace(/\r\n/g, '\n');
    const title = outputMarkTitle(src);
    const body = src.replace(OUTPUT_LESSON_RE, '');
    const tabContents = {};
    const marks = [...body.matchAll(OUTPUT_TAB_RE)];
    const fileTab = marks.length ? null : outputTabFileOf(src, fileName);
    if (marks.length) {
        marks.forEach((mark, i) => {
            const id = tabIdOf(mark[1]);
            const end = i + 1 < marks.length ? marks[i + 1].index : body.length;
            const part = cleanTabPart(body.slice(mark.index + mark[0].length, end), { headOf: marks.length > 1 ? id : null, isLast: i === marks.length - 1 });
            if (id && part) tabContents[id] = part;
        });
    } else if (fileTab) {
        if (body.trim()) tabContents[fileTab] = body.trim(); // 글 속 '# [..]' 줄로 나누지 않는다(교안 내용일 수 있다)
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
    // ZIP의 탭 MD는 차시 이름을 모른다(제목은 '불러온 차시'가 된다). _전체.md는 앞 번호와 _전체를 뗀다
    const fallbackTitle = fileTab ? '' : outputFileBase(fileName).replace(OUTPUT_NUMBER_HEAD, '').replace(/_전체$/, '').trim();
    return [{ title: title || fallbackTitle, tabContents, images: {} }];
}

// 교수안·편성안 MD(ZIP의 06_교수안.md·07_슬라이드편성안.md, 교수안 화면에서 받은 …_교수안.md 등)는 교안 차시로 넣지 않는다
// 이름과 내용이 함께 맞을 때만 본다. 차시·탭 표시가 있는 MD(이 앱의 교안 MD)는 제목에 '교수안'이 있어도 교안이다
function isGyosuanMdFile(text, fileName) {
    const src = String(text || '').replace(/\r\n/g, '\n');
    if (OUTPUT_LESSON_RE.test(src) || OUTPUT_TAB_MARK.test(src)) return false;
    return OUTPUT_GYOSUAN_NAME.test(outputFileBase(fileName)) && OUTPUT_GYOSUAN_TEXT.test(src);
}

// ZIP의 탭 MD를 한 번에 고르면 한 차시로 묶는다. 같은 탭 파일이 둘 이상이면 묶지 않는다
// items: [{ raw, from, tabFile, file }]. tabFile은 MD를 읽을 때만 붙인다(HTML 원본 글로는 흉내 낼 수 없다). 묶은 차시는 첫 탭 파일 자리에 둔다
function mergeTabFiles(items) {
    const tabItems = items.filter(item => item.from === 'md' && item.tabFile);
    const ids = tabItems.map(item => item.tabFile);
    if (tabItems.length < 2 || new Set(ids).size !== ids.length) return items;
    const merged = { raw: { title: '', tabContents: Object.assign({}, ...tabItems.map(item => item.raw.tabContents)), images: {} }, from: 'md', file: tabItems[0].file };
    return items.flatMap(item => (item === tabItems[0] ? [merged] : tabItems.includes(item) ? [] : [item]));
}

/* ---------- 검사: 남이 준 파일일 수 있다 ---------- */
// 그림 키는 [\w-]만, 그림은 data:image만
const outputValidImages = raw => Object.fromEntries(Object.entries(raw && typeof raw === 'object' ? raw : {})
    .filter(([key, data]) => OUTPUT_IMAGE_KEY_RE.test(key) && typeof data === 'string' && OUTPUT_IMAGE_RE.test(data)));

function normalizeImportedLesson(raw, id) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const tabs = source.tabContents && typeof source.tabContents === 'object' ? source.tabContents : {};
    const tabContents = Object.fromEntries(LESSON_TABS.map(tab => [tab.id, outputText(tabs[tab.id]) || null]));
    const images = outputValidImages(source.images);
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
        ...(docMd ? { gyosuan: { docMd, deckMd: outputText(gyosuanSource.deckMd), images: outputValidImages(gyosuanSource.images), updatedAt: new Date().toISOString() } } : {}),
        uploadedMdName: null,
        uploadedMdContent: null
    };
}

/* ---------- 확인 창: 무엇이 들어오는지 ---------- */
// 같은 차시인지 볼 탭 글. 줄바꿈 모양·앞뒤 빈칸·예전 강사 안내(ZIP의 탭 MD에는 남아 있다)는 보지 않는다. 글이 하나도 없으면 ''
const outputTabsKey = lesson => {
    const texts = LESSON_TABS.map(tab => {
        const text = String(lesson.tabContents[tab.id] || '').replace(/\r\n/g, '\n');
        return (typeof stripInstructorCallouts === 'function' ? stripInstructorCallouts(text) : text).trim();
    });
    return texts.some(Boolean) ? texts.join('\u0000') : '';
};
const outputImageKeys = lesson => Object.keys({ ...lesson.images, ...(lesson.gyosuan?.images || {}) });
// 겹친 차시 가운데 남길 쪽: 교수안이 있는 쪽, 다음은 HTML(제목·설명·그림이 있다), 다음은 그림이 많은 쪽
const outputKeepRank = item => (item.lesson.gyosuan ? 2e6 : 0) + (item.from === 'html' ? 1e6 : 0) + outputImageKeys(item.lesson).length;
// 제목이 어디서 왔는지(readOutputText): 2 = 파일 안에 적힌 제목(HTML 원본, MD 차시 표시), 1 = 파일 이름에서 딴 제목, 0 = 없음('불러온 차시')
const outputTitleRank = item => item.titleRank || 0;
// 둘 다 가진 키의 그림은 같아야 한다(한쪽에서 다시 그린 그림이면 다른 차시로 본다)
const outputSameImages = (a, b) => Object.keys(a || {}).every(key => !Object.prototype.hasOwnProperty.call(b || {}, key) || a[key] === b[key]);

// 하나를 빼도 잃는 것이 없을 때만 같은 차시로 본다: 다른 파일에서 왔고, 둘 다 담은 것은 모두 같다(탭 글은 이미 같다)
// 제목은 둘 다 파일 안에 적힌 것일 때만 견준다(ZIP의 _전체.md처럼 파일 이름에서 딴 제목은 차시 이름과 다르다). 설명·시간은 HTML에만 담긴다
function outputSameLesson(entry, item) {
    const a = entry.item.lesson;
    const b = item.lesson;
    if (entry.files.has(item.file)) return false;
    if (outputTitleRank(entry.item) === 2 && outputTitleRank(item) === 2 && a.title !== b.title) return false;
    if (entry.item.from === 'html' && item.from === 'html' && (a.description !== b.description || a.hours !== b.hours)) return false;
    if (a.gyosuan && b.gyosuan && (a.gyosuan.docMd !== b.gyosuan.docMd || a.gyosuan.deckMd !== b.gyosuan.deckMd)) return false;
    return outputSameImages(a.images, b.images) && outputSameImages(a.gyosuan?.images, b.gyosuan?.images);
}

// 버리는 쪽에만 있는 것(그림, 교수안 그림, 더 확실한 제목)을 남기는 쪽에 더한 새 항목. 받은 항목·차시 객체는 바꾸지 않는다
function outputAbsorbLesson(keep, drop) {
    const lesson = keep.lesson;
    const other = drop.lesson;
    const title = outputTitleRank(drop) > outputTitleRank(keep) ? { title: other.title } : {};
    const gyosuan = lesson.gyosuan && other.gyosuan ? { gyosuan: { ...lesson.gyosuan, images: { ...other.gyosuan.images, ...lesson.gyosuan.images } } } : {};
    return {
        ...keep,
        titleRank: Math.max(outputTitleRank(keep), outputTitleRank(drop)),
        lesson: { ...lesson, ...title, images: { ...other.images, ...lesson.images }, ...gyosuan }
    };
}

// 다른 파일에서 온 같은 차시는 한 번만 넣는다(ZIP 차시 폴더의 파일을 모두 골랐을 때, 차시 HTML과 교수안 HTML을 함께 골랐을 때 등)
// 같은 차시인지는 outputSameLesson. 교수안·제목·설명·시간·같은 키의 그림 가운데 하나라도 서로 다르면 둘 다 넣는다
// 한 파일 안에서 겹친 차시는 일부러 둔 것일 수 있어 그대로 둔다(이미 그 파일의 차시를 품은 항목에는 다시 품지 않는다). 글도 교수안도 없는 차시는 견주지 않는다
// 탭 글이 같은 것끼리만 견준다(차시가 많아도 느려지지 않게)
// items: [{ lesson, from, file(고른 파일 순서), titleRank }] → { kept, dropped }
function dedupeImported(items) {
    const kept = [];
    const byKey = new Map(); // 탭 글 → 그 글인 kept 자리들
    items.forEach(item => {
        const key = outputTabsKey(item.lesson);
        const comparable = Boolean(key || item.lesson.gyosuan); // 글도 교수안도 없는 차시는 견주지 않는다(제목만 다른 빈 차시가 하나로 접히지 않게)
        if (comparable && !byKey.has(key)) byKey.set(key, []);
        const places = comparable ? byKey.get(key) : [];
        const at = places.slice(0, OUTPUT_DEDUPE_SCAN).find(place => outputSameLesson(kept[place], item));
        if (at === undefined) {
            places.push(kept.length);
            kept.push({ item, files: new Set([item.file]) });
            return;
        }
        const entry = kept[at];
        const files = new Set([...entry.files, item.file]);
        kept[at] = outputKeepRank(item) > outputKeepRank(entry.item)
            ? { item: outputAbsorbLesson(item, entry.item), files }
            : { item: outputAbsorbLesson(entry.item, item), files };
    });
    return { kept: kept.map(entry => entry.item), dropped: items.length - kept.length };
}

// 글에는 있는데 파일에 그림이 없는 자리(local:키) 수
function missingImageCount(lesson) {
    const have = new Set(outputImageKeys(lesson));
    const texts = [...Object.values(lesson.tabContents || {}), lesson.gyosuan?.docMd, lesson.gyosuan?.deckMd].filter(Boolean).join('\n');
    return new Set([...texts.matchAll(/local:([\w-]+)/g)].map(match => match[1]).filter(key => !have.has(key))).size;
}

const outputCount = n => Number(n).toLocaleString('ko-KR');
const outputShortTitle = title => {
    const chars = Array.from(String(title));
    return chars.length > OUTPUT_CONFIRM_TITLE ? `${chars.slice(0, OUTPUT_CONFIRM_TITLE).join('')}…` : chars.join('');
};
// 건너뛴 파일: 앞 몇 개만 까닭과 함께, 나머지는 '외 N개'
const outputFailedLines = failed => [...failed.slice(0, OUTPUT_CONFIRM_FAILED).map(line => `· ${line}`),
    ...(failed.length > OUTPUT_CONFIRM_FAILED ? [`· 외 ${failed.length - OUTPUT_CONFIRM_FAILED}개`] : [])];

// 차시 한 줄: 제목, 다음 줄에 탭별 글자 수·그림 장수·교수안
function outputLessonLine(lesson) {
    const tabs = LESSON_TABS.filter(tab => lesson.tabContents[tab.id]).map(tab => `${tab.label} ${outputCount(lesson.tabContents[tab.id].length)}자`);
    const images = outputImageKeys(lesson).length;
    const parts = [...tabs, ...(images ? [`그림 ${images}장`] : []), ...(lesson.gyosuan ? ['교수안'] : [])];
    return `· ${outputShortTitle(lesson.title)}\n   ${parts.join(' · ') || '글 없음'}`;
}

// 불러오기 확인 창 글. items: [{ lesson(검사를 거친 차시), from: 'html' | 'md' }], failed: ['파일 이름: 까닭']
function describeOutputImport(items, { fileCount, where, dropped = 0, failed = [] }) {
    const lessons = items.map(item => item.lesson);
    const list = lessons.slice(0, OUTPUT_CONFIRM_LESSONS).map(outputLessonLine);
    if (lessons.length > OUTPUT_CONFIRM_LESSONS) list.push(`· 외 차시 ${lessons.length - OUTPUT_CONFIRM_LESSONS}개`);
    const missing = from => items.filter(item => item.from === from).reduce((sum, item) => sum + missingImageCount(item.lesson), 0);
    const mdMissing = missing('md');
    const htmlMissing = missing('html');
    const notes = [
        items.some(item => item.from === 'html') && '· HTML은 파일 안에 숨겨 둔 원본(내보낼 때의 글)으로 되살립니다. 다른 프로그램에서 HTML을 고쳤다면 고친 글은 들어오지 않습니다.',
        items.some(item => item.from === 'md') && `· MD 파일에는 그림이 담기지 않습니다.${mdMissing ? ` 그림 자리 ${mdMissing}곳은 빈칸이 됩니다. 그림까지 옮기려면 HTML이나 백업 ZIP을 쓰세요.` : ''}`,
        htmlMissing && `· 그림 ${htmlMissing}곳은 파일에서 찾지 못해 빈칸이 됩니다.`,
        !lessons.some(lesson => lesson.gyosuan) && '· 교수안은 들어 있지 않습니다. 교수안까지 되살리려면 교수안 화면의 HTML 버튼으로 받은 파일을 고르세요.',
        "· 되살리는 것은 파일에 담긴 차시 제목·설명·시간, 탭 글, 그림, 교수안뿐입니다. 차시 정보의 나머지 칸, 섹션 고정, 수동 검수 기록, 슬라이드 화면 편집, 참고 이미지, 삽화 목록, NCS, 판서 영상 같은 것은 돌아오지 않습니다. 모두 되살리려면 '백업 ZIP으로 되살리기'를 쓰세요.",
        dropped && `· 여러 파일에 같은 차시가 있어 겹친 ${dropped}개는 빼고 한 번만 넣습니다.`
    ].filter(Boolean);
    const skipped = failed.length ? ['', `건너뛰는 파일 ${failed.length}개`, ...outputFailedLines(failed)] : [];
    return [`파일 ${fileCount}개에서 차시 ${lessons.length}개를 찾았습니다.`, `${where} 새 차시로 넣습니다. 지금 있는 차시는 그대로 둡니다.`,
        '', ...list, '', ...notes, ...skipped].join('\n');
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

// 원본을 읽지 못한 HTML의 까닭과 쓸 메뉴
function outputHtmlMissingReason(text) {
    if (/id=["']kb-source["']/.test(text)) return "슬라이드 HTML입니다. 그 차시의 교수안 화면에서 '내보낸 HTML 불러오기'로 넣으세요";
    if (text.includes('id="teacher-source"')) return '파일 안의 원본이 잘렸거나 깨져 읽지 못했습니다. 이 앱에서 다시 내보내 주세요';
    return "되살릴 원본이 없는 HTML입니다(이 앱의 예전 버전에서 내보냈거나 다른 프로그램의 파일). 백업 ZIP에서 꺼낸 파일이면 그 ZIP을 '백업 ZIP으로 되살리기'로 여세요";
}

// 고른 파일을 읽기 전에 거른다. 문제가 있으면 까닭(글)을, 없으면 null
function outputFileProblem(file) {
    const name = String(file?.name || '');
    if (/\.zip$/i.test(name)) return "ZIP 파일은 '백업 ZIP으로 되살리기'로 여세요";
    if (!OUTPUT_HTML_NAME.test(name) && !OUTPUT_MD_NAME.test(name)) return 'HTML이나 MD 파일만 불러올 수 있습니다';
    if (file.size > OUTPUT_FILE_MAX) return `파일이 너무 큽니다(${OUTPUT_FILE_MB}MB 넘음). 그림이 많은 교과는 '백업 ZIP으로 되살리기'를 쓰거나, 그림 없이 옮기려면 MD로 내보내 불러오세요`;
    return null;
}

// 파일 글 → [{ raw, from, tabFile, titleRank }]. 되살릴 수 없으면 까닭을 담아 던진다
// titleRank(겹친 차시를 견줄 때 쓴다): 2 = 파일 안에 적힌 제목(HTML 원본, MD 차시 표시), 1 = 파일 이름에서 딴 제목, 0 = 없음
function readOutputText(name, text) {
    if (OUTPUT_HTML_NAME.test(name)) {
        const lessons = parseOutputHtml(text);
        if (!lessons) throw new Error(outputHtmlMissingReason(String(text || '')));
        if (!lessons.length) throw new Error('들어 있는 차시가 없습니다');
        if (lessons.length > OUTPUT_FILE_LESSONS) throw new Error(`차시가 너무 많은 파일입니다(${outputCount(OUTPUT_FILE_LESSONS)}개 넘음). '백업 ZIP으로 되살리기'를 쓰세요`);
        return lessons.map(raw => ({ raw, from: 'html', titleRank: outputText(raw?.title).trim() ? 2 : 0 }));
    }
    if (isGyosuanMdFile(text, name)) {
        throw new Error(/_묶음$/.test(outputFileBase(name))
            ? "여러 차시의 교수안을 모은 읽기용 MD라 되살릴 수 없습니다. 모두 되살리려면 '백업 ZIP으로 되살리기'를 쓰세요"
            : "교수안·편성안 MD입니다. 그 차시의 교수안 화면에서 '완성 MD 불러오기'로 넣으세요");
    }
    const lessons = parseOutputMarkdown(text, name);
    if (lessons.every(raw => !Object.keys(raw.tabContents).length)) throw new Error('불러올 교안 글이 없습니다');
    const tabFile = outputTabFileOf(text, name);
    const marked = !!outputMarkTitle(text).trim();
    return lessons.map(raw => ({ raw, from: 'md', tabFile, titleRank: marked ? 2 : raw.title.trim() ? 1 : 0 }));
}

async function readOutputFile(file) {
    const problem = outputFileProblem(file);
    if (problem) throw new Error(problem);
    return readOutputText(file.name, await file.text());
}

window.importOutputFiles = async function (event) {
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = ''; // 같은 파일을 다시 고를 수 있게
    if (!files.length) return;
    const found = [];
    const failed = [];
    for (const [index, file] of files.entries()) {
        try {
            found.push(...(await readOutputFile(file)).map(item => ({ ...item, file: index })));
        } catch (err) {
            console.error('[불러오기] 파일 실패:', file.name, err);
            failed.push(`${file.name}: ${err.message}`);
        }
    }
    // ZIP의 탭 MD는 한 차시로 묶고, 검사한 뒤 다른 파일에서 온 같은 차시는 한 번만 넣는다
    const prepared = mergeTabFiles(found)
        .filter(item => item.raw && typeof item.raw === 'object')
        .map(item => ({ from: item.from, file: item.file, titleRank: item.titleRank, lesson: normalizeImportedLesson(item.raw, 0) }));
    const { kept, dropped } = dedupeImported(prepared);
    if (!kept.length) return window.showAlert(['불러올 교안을 찾지 못했습니다.', ...outputFailedLines(failed)].join('\n'));
    const { subject, isNew } = outputImportTarget();
    const where = isNew ? `새 교과 '${subject.title}'를 만들어` : `'${subject.title}' 교과에`;
    const ok = await confirmAsync(describeOutputImport(kept, { fileCount: files.length, where, dropped, failed }), { okLabel: '불러오기', tone: 'primary', title: '내보낸 교안 다시 불러오기' });
    if (!ok) return;
    window.saveRawContent?.(); // 고치던 원문을 먼저 저장한다
    const existing = isNew ? [] : (subject.id === currentSubjectId ? courseData : subject.lessons || []);
    const ids = renumberLessons(kept.map(() => ({})), existing.map(lesson => lesson.id)).map(lesson => lesson.id);
    const lessons = kept.map((item, i) => ({ ...item.lesson, id: ids[i] }));
    if (isNew) {
        globalState.subjects = [...globalState.subjects, { ...subject, lessons }];
    } else if (subject.id === currentSubjectId) {
        courseData = [...courseData, ...lessons];
    } else {
        subject.lessons = [...existing, ...lessons];
    }
    await saveState();
    // 건너뛴 파일과 까닭은 확인 창에서 이미 보였다
    window.showToast?.(`차시 ${lessons.length}개를 불러왔습니다. 바로 고칠 수 있습니다.`, 'success');
    if (isNew) location.hash = `#editor/${subject.id}/${lessons[0].id}`;
    else {
        renderSidebar();
        viewModule(lessons[0].id);
    }
};

// 앱이 만든 HTML이 다시 불러오기 상한을 넘으면 내려받은 뒤 알린다(읽고 나눠 주는 데는 그대로 쓴다)
window.noteReimportSize = function (bytes) {
    if (!(bytes > OUTPUT_FILE_MAX)) return false;
    window.showAlert?.(`이 HTML은 ${OUTPUT_FILE_MB}MB가 넘어 '내보낸 교안 다시 불러오기'로는 되살릴 수 없습니다. 읽고 나눠 주는 데는 그대로 쓰면 됩니다. 되살릴 수 있게 하려면 '교과 백업 ZIP 받기'로 백업도 받아 두세요.`);
    return true;
};

if (typeof window !== 'undefined') {
    Object.assign(window, {
        lessonSourcePayload, lessonSourceScript, lessonMarkdownExport, parseOutputHtml, parseOutputMarkdown, normalizeImportedLesson, lessonSourceTabs,
        readShownImages, mergeTabFiles, dedupeImported, describeOutputImport, missingImageCount, outputFileProblem, readOutputText, isGyosuanMdFile
    });
}
