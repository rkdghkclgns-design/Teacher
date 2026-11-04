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

// 그림(본문에 든 data: 주소 포함)과 HTML 주석(이미지 자리 표시)은 판서 자료로 쓸 수 없어 빼고 그림 설명만 남긴다
function whiteboardPlainMarkdown(md) {
    return String(md || '')
        .replace(/\r\n/g, '\n')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => (alt.trim() ? `(그림: ${alt.trim()})` : ''))
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
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

window.openWhiteboardStudio = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return;
    if (typeof saveOpenEditsFor === 'function') saveOpenEditsFor(mod, currentLessonTab); // 수정 모드에서 고치던 글부터 반영
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    const handoff = buildWhiteboardHandoff(mod, subject);
    if (!handoff) return window.showAlert('이 차시에는 아직 교안 내용이 없습니다. 교안을 먼저 만든 뒤 판서 영상을 만들어 주세요.');
    if (!sharesWhiteboardOrigin()) return handOffWhiteboardByFile(handoff, '이 Teacher는 스튜디오와 다른 주소에서 열려 교안을 바로 넘길 수 없습니다.');
    try {
        localStorage.setItem(WHITEBOARD_HANDOFF_KEY, JSON.stringify(handoff));
    } catch (e) {
        console.warn('[판서 영상] 교안을 넘기지 못했습니다:', e);
        return handOffWhiteboardByFile(handoff, '브라우저 저장소에 교안을 넣지 못해 바로 넘길 수 없습니다.');
    }
    // 기록은 스튜디오가 읽을 때 지운다. 열리지 않았다면 10분 뒤 쓰지 않으며, 다시 누르면 새 기록으로 바뀐다
    openWhiteboardTab(`${location.origin}${WHITEBOARD_STUDIO_PATH}${WHITEBOARD_HANDOFF_HASH}`);
    window.showToast?.(`"${handoff.topic}" 교안을 화이트보드 교안 스튜디오로 넘겼습니다. 새 탭에서 설정을 확인하고 판서 수업을 생성하세요.`, 'success');
};
