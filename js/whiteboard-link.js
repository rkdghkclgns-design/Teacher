// whiteboard-link.js - 차시 교안을 화이트보드 교안 스튜디오로 넘겨 판서 영상을 만든다
// 두 앱이 같은 주소(rkdghkclgns-design.github.io)에 있어 localStorage를 함께 쓴다. 기록 하나를 남기고
// 스튜디오를 #from=teacher로 열면 스튜디오가 한 번 읽고 지운다. 생성은 스튜디오에서 사용자가 누를 때만 한다.

const WHITEBOARD_STUDIO_PATH = '/whiteboard-studio-web/';
const WHITEBOARD_STUDIO_PUBLIC = `https://rkdghkclgns-design.github.io${WHITEBOARD_STUDIO_PATH}`;
const WHITEBOARD_HANDOFF_KEY = 'whiteboard-studio:handoff';
const WHITEBOARD_HANDOFF_HASH = '#from=teacher';
const WHITEBOARD_AUDIENCE = '대학생·성인'; // 직업훈련 교안이라 스튜디오의 성인 대상으로 맞춘다
const WHITEBOARD_MAX_CHARS = 1000000; // 같은 주소의 localStorage(약 5MB)에 넉넉히 들어가는 양
const WHITEBOARD_TOPIC_MAX = 300; // 스튜디오 주제 칸 길이
const WHITEBOARD_NAME_MAX = 100;

// "3차시: 제목", "1. 교과" 같은 번호를 뗀다
const stripLessonNumber = text => String(text || '').replace(/^\s*\d+\s*(?:차시|\.)\s*[:.)\-–]?\s*/, '').trim();

// 그림(본문에 든 data: 주소 포함)·그림 틀·버튼·HTML 주석(이미지 자리 표시)은 판서 자료로 쓸 수 없어 빼고, 그림 설명과 글만 남긴다(코드 블록 밖 글)
function whiteboardProse(text) {
    return String(text)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => (alt.trim() ? `(그림: ${alt.trim()})` : ''))
        .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, (_, alt) => (alt.trim() ? `(그림: ${alt.trim()})` : ''))
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/<button\b[\s\S]*?<\/button>/gi, '')
        .replace(/<div\b[^>]*class="[^"]*image-placeholder[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<\/?[a-z][a-z0-9-]*\b[^>]*>/gi, '') // 남은 태그는 벗기고 글은 둔다
        .replace(/^[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// 앱이 넣는 그림 줄: local:·data: 그림 주소(그림 틀·붙여 넣은 그림)와 이미지 자리 표시(<!-- [IMG: …] -->)
const WB_PICTURE_LINE = /\bsrc=["']?(?:local|data):|\]\(\s*(?:local|data):|<!--\s*\[IMG:/i;

// 닫히지 않은 코드 블록(data.js fenceStateAfter): { at(여는 펜스 줄), close(같은 들여쓰기·같은 길이의 닫는 펜스) }. 닫혔으면 null
function whiteboardOpenFence(lines) {
    let fence = 0;
    let at = -1;
    lines.forEach((line, k) => {
        const was = fence;
        fence = fenceStateAfter(fence, line);
        if (!was && fence) at = k;
    });
    return fence ? { at, close: `${lines[at].match(/^[ \t]*/)[0]}${'`'.repeat(fence)}` } : null;
}

// 코드 블록은 떼어 두었다가 그대로 되돌린다(data.js stashCodeFences): html·xml 코드의 <!-- --> 주석과 List<int> 같은 코드 글자는 지우지 않는다.
// 닫히지 않은 코드 블록(글 끝까지 코드다)은 닫아서 넘기고(이어 붙이는 다음 탭의 # 제목이 코드가 되지 않게), 그 블록 안의 그림 줄만 글처럼 정리한다(그림 틀·data: 주소를 넘기지 않게)
function whiteboardPlainMarkdown(md) {
    const text = String(md || '').replace(/\r\n/g, '\n');
    if (typeof stashCodeFences !== 'function' || typeof fenceStateAfter !== 'function') return whiteboardProse(text);
    const lines = text.split('\n');
    const open = whiteboardOpenFence(lines);
    const closed = open
        ? [...lines.slice(0, open.at + 1), ...lines.slice(open.at + 1).map(line => (WB_PICTURE_LINE.test(line) ? whiteboardProse(line) : line)), open.close].join('\n')
        : text;
    const fences = stashCodeFences(closed, { keepSpaces: true });
    return fences.restore(whiteboardProse(fences.text));
}

// 탭마다 # 제목으로 나눠, 스튜디오의 목차에서 쓸 탭만 고를 수 있게 한다
function whiteboardLessonMarkdown(mod, subject) {
    const clean = md => whiteboardPlainMarkdown(typeof cleanLessonOpening === 'function' ? cleanLessonOpening(md) : md);
    const tabs = typeof LESSON_TABS !== 'undefined' ? LESSON_TABS : [];
    const sections = tabs
        .map(tab => ({ title: tab.label, body: clean(mod.tabContents?.[tab.id]) }))
        .filter(section => section.body);
    if (!sections.length && mod.content) sections.push({ title: '교안', body: clean(mod.content) });
    if (!sections.length || !sections.some(section => section.body)) return '';
    const info = [
        subject?.title ? `- 교과: ${subject.title}` : '',
        mod.description ? `- 개요: ${mod.description}` : '',
        ...(mod.objectives?.length ? ['- 학습 목표', ...mod.objectives.map(goal => `  - ${goal}`)] : [])
    ].filter(Boolean);
    const parts = [`# ${mod.title || '차시'} — 수업 정보`, info.join('\n'), ...sections.map(section => `# ${section.title}\n\n${section.body}`)];
    const markdown = parts.filter(Boolean).join('\n\n');
    return markdown.length > WHITEBOARD_MAX_CHARS ? `${markdown.slice(0, WHITEBOARD_MAX_CHARS)}\n\n(이하 생략)` : markdown;
}

function whiteboardFileName(mod, subject) {
    const name = [stripLessonNumber(subject?.title), mod.title].filter(Boolean).join(' ')
        .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, WHITEBOARD_NAME_MAX);
    return `${name || '차시 교안'}.md`;
}

// 스튜디오가 받는 기록. 교안이 비어 있으면 null
function buildWhiteboardHandoff(mod, subject, now = Date.now()) {
    const markdown = whiteboardLessonMarkdown(mod, subject);
    if (!markdown) return null;
    const lessonTitle = stripLessonNumber(mod.title) || String(mod.title || '').trim();
    const subjectTitle = stripLessonNumber(subject?.title);
    const topic = lessonTitle && subjectTitle && lessonTitle !== subjectTitle ? `${lessonTitle} (${subjectTitle})` : (lessonTitle || subjectTitle || '차시 교안');
    return {
        v: 1,
        from: 'teacher',
        createdAt: now,
        topic: topic.slice(0, WHITEBOARD_TOPIC_MAX),
        audience: WHITEBOARD_AUDIENCE,
        fileName: whiteboardFileName(mod, subject),
        markdown
    };
}

// GitHub Pages처럼 /Teacher/ 아래에서 열렸으면 스튜디오(/whiteboard-studio-web/)와 주소가 같다
const sharesWhiteboardOrigin = (loc = location) => /^https?:$/.test(loc.protocol) && loc.pathname.startsWith('/Teacher/');

// 누른 버튼에서 링크로 새 탭을 연다. window.open은 브라우저에 따라 창을 열고도 null을 돌려줘 막힘과 구별할 수 없다
function openWhiteboardTab(url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
}

// 주소가 달라 저장소를 함께 쓸 수 없으면 교안 파일을 내려받게 하고, 스튜디오 지식 보관함에 넣도록 안내한다
function handOffWhiteboardByFile(handoff, reason) {
    downloadFile(handoff.markdown, handoff.fileName, 'text/markdown;charset=utf-8');
    openWhiteboardTab(WHITEBOARD_STUDIO_PUBLIC);
    window.showAlert(`${reason}\n\n교안 파일(${handoff.fileName})을 내려받았습니다. 새 탭의 화이트보드 교안 스튜디오에서 '자료 기반 생성'을 켜고 지식 보관함에 이 파일을 넣은 뒤, 주제에 "${handoff.topic}"을 넣고 생성해 주세요.`);
}

// 스튜디오로 넘기고 새 탭을 연다. 기록은 스튜디오가 읽을 때 지우고, 열리지 않았다면 10분 뒤 쓰지 않으며, 다시 누르면 새 기록으로 바뀐다
function deliverWhiteboardHandoff(handoff) {
    if (!sharesWhiteboardOrigin()) return handOffWhiteboardByFile(handoff, '이 Teacher는 스튜디오와 다른 주소에서 열려 교안을 바로 넘길 수 없습니다.') ?? false;
    try {
        localStorage.setItem(WHITEBOARD_HANDOFF_KEY, JSON.stringify(handoff));
    } catch (e) {
        console.warn('[판서 영상] 교안을 넘기지 못했습니다:', e);
        return handOffWhiteboardByFile(handoff, '브라우저 저장소에 교안을 넣지 못해 바로 넘길 수 없습니다.') ?? false;
    }
    openWhiteboardTab(`${location.origin}${WHITEBOARD_STUDIO_PATH}${WHITEBOARD_HANDOFF_HASH}`);
    const next = handoff.returnTo ? "영상을 만든 뒤 스튜디오의 'Teacher로 보내기'를 누르면 이 그림 자리가 영상으로 바뀝니다." : '새 탭에서 설정을 확인하고 판서 수업을 생성하세요.';
    window.showToast?.(`"${handoff.topic}" 내용을 화이트보드 교안 스튜디오로 넘겼습니다. ${next}`, 'success');
    return true;
}

/* ---------- 판서 영상 만들기 창: 주제와 담을 내용을 직접 고쳐 쓴다 ---------- */
// 창에서 고친 값을 검사한다. 잘못되면 { error }
function readWhiteboardDialog(topic, markdown) {
    const cleanTopic = String(topic || '').trim();
    const body = String(markdown || '').replace(/\r\n/g, '\n').trim();
    if (!cleanTopic) return { error: '주제를 써 주세요.' };
    if (cleanTopic.length > WHITEBOARD_TOPIC_MAX) return { error: `주제는 ${WHITEBOARD_TOPIC_MAX}자까지 쓸 수 있습니다.` };
    if (!body) return { error: '판서 영상에 담을 내용을 써 주세요.' };
    if (body.length > WHITEBOARD_MAX_CHARS) return { error: `내용은 ${WHITEBOARD_MAX_CHARS.toLocaleString()}자까지 넘길 수 있습니다.` };
    return { topic: cleanTopic, markdown: body };
}

// subtitle: 무엇을 만드는지(차시 전체 / 그림 자리). onConfirm({ topic, markdown })은 확인 버튼을 누른 그 클릭 안에서 불린다
window.showWhiteboardDialog = function ({ subtitle, topic, markdown }, onConfirm) {
    document.getElementById('whiteboard-dialog')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'whiteboard-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] animate-fade-in p-4';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-full max-w-[720px] max-h-[90vh] p-6 shadow-2xl flex flex-col" role="dialog" aria-modal="true" aria-labelledby="wb-dialog-title">
            <div class="flex items-center gap-3 mb-1">
                <i class="ph-fill ph-chalkboard-teacher text-2xl text-accent"></i>
                <h3 id="wb-dialog-title" class="font-bold text-white text-sm">판서 영상 만들기</h3>
            </div>
            <p class="text-xs text-textMuted mb-4">${escapeHtml(subtitle)}</p>
            <label for="wb-dialog-topic" class="text-[0.6875rem] font-bold text-textLight mb-1">주제</label>
            <input id="wb-dialog-topic" type="text" maxlength="${WHITEBOARD_TOPIC_MAX}"
                class="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent mb-3">
            <div class="flex items-end justify-between mb-1">
                <label for="wb-dialog-body" class="text-[0.6875rem] font-bold text-textLight">판서 영상에 담을 내용</label>
                <span id="wb-dialog-count" class="text-[0.6875rem] text-textMuted"></span>
            </div>
            <textarea id="wb-dialog-body" spellcheck="false"
                class="w-full flex-1 min-h-[240px] bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs leading-relaxed text-white font-mono focus:outline-none focus:border-accent resize-y"></textarea>
            <p class="text-[0.6875rem] text-textMuted mt-2 leading-relaxed">스튜디오는 이 내용만 자료로 써서 5장면 판서 수업을 만듭니다. 필요 없는 부분은 지우고, 강조할 설명이나 예시를 직접 써넣으세요. <code># 제목</code>마다 스튜디오 목차에서 골라 쓸 수 있습니다.</p>
            <p id="wb-dialog-error" class="hidden text-xs text-red-400 mt-2" role="alert"></p>
            <div class="flex items-center justify-between gap-2 mt-4">
                <button type="button" id="wb-dialog-reset" class="px-3 py-2 text-xs font-bold text-textLight bg-white/5 hover:bg-white/10 rounded-lg transition-colors">원래 내용으로</button>
                <div class="flex gap-2">
                    <button type="button" id="wb-dialog-cancel" class="px-4 py-2 text-xs font-bold text-textLight bg-white/5 hover:bg-white/10 rounded-lg transition-colors">취소</button>
                    <button type="button" id="wb-dialog-ok" class="px-4 py-2 text-xs font-bold text-white bg-accent hover:bg-accentHover rounded-lg transition-colors flex items-center gap-1"><i class="ph-bold ph-arrow-square-out"></i> 스튜디오에서 만들기</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const topicInput = overlay.querySelector('#wb-dialog-topic');
    const body = overlay.querySelector('#wb-dialog-body');
    const count = overlay.querySelector('#wb-dialog-count');
    const error = overlay.querySelector('#wb-dialog-error');
    const showCount = () => { count.textContent = `${body.value.length.toLocaleString()}자`; };
    topicInput.value = topic || '';
    body.value = markdown || '';
    showCount();
    body.addEventListener('input', showCount);
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = event => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('#wb-dialog-cancel').onclick = close;
    overlay.querySelector('#wb-dialog-reset').onclick = () => { topicInput.value = topic || ''; body.value = markdown || ''; showCount(); };
    overlay.querySelector('#wb-dialog-ok').onclick = () => {
        const result = readWhiteboardDialog(topicInput.value, body.value);
        if (result.error) {
            error.textContent = result.error;
            error.classList.remove('hidden');
            return;
        }
        close();
        onConfirm(result);
    };
    setTimeout(() => topicInput.focus(), 50);
};

// 창에서 고친 주제·내용으로 바꿔 넘긴다
function confirmWhiteboardHandoff(handoff, subtitle, after) {
    window.showWhiteboardDialog({ subtitle, topic: handoff.topic, markdown: handoff.markdown }, ({ topic, markdown }) => {
        const delivered = deliverWhiteboardHandoff({ ...handoff, topic, markdown, createdAt: Date.now() });
        if (delivered && typeof after === 'function') after();
    });
}

window.openWhiteboardStudio = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return;
    if (typeof saveOpenEditsFor === 'function') saveOpenEditsFor(mod, currentLessonTab); // 수정 모드에서 고치던 글부터 반영
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    const handoff = buildWhiteboardHandoff(mod, subject);
    if (!handoff) return window.showAlert('이 차시에는 아직 교안 내용이 없습니다. 교안을 먼저 만든 뒤 판서 영상을 만들어 주세요.');
    confirmWhiteboardHandoff(handoff, `${mod.title || '이 차시'} 교안 전체로 만듭니다. 내용을 고쳐 쓰거나 줄여도 됩니다.`);
};
