// lesson-sanitize.js - 교안 HTML에서 실행되는 요소를 걷어낸다
// 교안은 AI 응답, 업로드한 MD, 가져온 저장 파일을 그대로 그린다. API 키가 브라우저에 있으므로 화면과 내보낸 HTML 어디서도 스크립트가 돌면 안 된다.
// 인라인 핸들러는 모두 지운다. 교안 안의 버튼은 data-lesson-action으로 표시하고 값은 글자로만 다룬다.

// 파서마다 다르게 읽는 요소(noscript, math 등)는 정리 뒤 다시 파싱될 때 태그가 살아날 수 있어 통째로 뺀다
const LESSON_BLOCKED_SELECTOR = [
    'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'form',
    'noscript', 'noembed', 'noframes', 'xmp', 'plaintext', 'template', 'math', 'svg style', 'use', 'animate', 'set'
].join(',');
const LESSON_URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'data', 'poster', 'background'];
const LESSON_SAFE_URL = /^(?:https?:|mailto:|tel:|local:|blob:|data:image\/)/i;
const LESSON_URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;
// 예전에 저장한 교안의 이미지 재생성 버튼 형식
const LESSON_LEGACY_REGENERATE = /^promptRegenerateImage\(this,\s*'((?:[^'\\]|\\.)*)',\s*(?:'([\w-]*)'|null)\)$/;

// 제어 문자를 끼운 java\tscript: 도 같은 주소로 읽는다
function isSafeLessonUrl(value) {
    const url = String(value).replace(/[\u0000- \u007f-\u009f]+/g, '');
    return !LESSON_URL_SCHEME.test(url) || LESSON_SAFE_URL.test(url);
}

// 저장된 인라인 호출에서 값만 읽어 data 속성으로 옮긴다. 호출 자체는 실행하지 않는다
function legacyRegenerateArgs(onclick) {
    const [, keyword, imgId = ''] = String(onclick).trim().match(LESSON_LEGACY_REGENERATE) || [];
    return keyword === undefined ? null : { keyword: keyword.replace(/\\(.)/g, '$1'), imgId };
}

function cleanLessonElement(element) {
    const legacy = legacyRegenerateArgs(element.getAttribute('onclick') || '');
    [...element.attributes].forEach(({ name, value }) => {
        const key = name.toLowerCase();
        if (key.startsWith('on') || (LESSON_URL_ATTRS.includes(key) && !isSafeLessonUrl(value))) element.removeAttribute(name);
    });
    if (legacy) Object.assign(element.dataset, { lessonAction: 'regenerate-image', keyword: legacy.keyword, imgId: legacy.imgId });
}

// 정리에 실패하면 글자로 보여 준다. 정리되지 않은 HTML을 그대로 내보내지 않는다
function sanitizeLessonHtml(html) {
    try {
        const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
        doc.body.querySelectorAll(LESSON_BLOCKED_SELECTOR).forEach(element => element.remove());
        doc.body.querySelectorAll('*').forEach(cleanLessonElement);
        return doc.body.innerHTML;
    } catch (err) {
        console.error('[교안 HTML 정리] 실패:', err);
        return `<pre>${escapeHtml(html)}</pre>`;
    }
}

/* ---------- '용어: 설명' 문단을 위 항목에 딸린 인용처럼 보이기 ---------- */
// "• 핵심 역할" 같은 항목 다음의 "**전투 설계**: 설명" 문단들은 그 항목에 딸린 설명이다. 왼쪽 회색 막대로 이어 보이게
// class만 붙인다. 문단을 상자로 감싸지 않으므로 화면의 블록 수가 마크다운 블록 수와 같아 두 번 눌러 고치기가 그대로 맞는다.
const LESSON_TERM_PARAGRAPH = String.raw`<p><strong>[^<]{1,40}(?:[:：]<\/strong>|<\/strong>\s*[:：])[\s\S]*?<\/p>\s*`;
// 목록, '• 항목' 문단, 굵은 글씨만 있는 짧은 문단이 머리다
const LESSON_TERM_HEAD = String.raw`(?:<\/ul>|<\/ol>|<p>•[^<]{1,40}<\/p>|<p>(?:•\s*)?<strong>[^<]{1,40}<\/strong><\/p>)\s*`;
const LESSON_TERM_RUN = new RegExp(`(${LESSON_TERM_HEAD})?((?:${LESSON_TERM_PARAGRAPH})+)`, 'g');

function markTermParagraphs(html) {
    return String(html || '').replace(LESSON_TERM_RUN, (whole, head, run) => {
        const count = (run.match(/<p>/g) || []).length;
        if (!head && count < 2) return whole; // 머리 없이 하나만 있는 '라벨: 설명'은 그대로 둔다
        return (head || '') + run.replace(/<p>(?=<strong>)/g, '<p class="lesson-term">');
    });
}

/* ---------- 교안 안의 버튼 ---------- */
const LESSON_ACTIONS = {
    'regenerate-image': button => window.promptRegenerateImage(button, button.dataset.keyword || '', button.dataset.imgId || null),
    'delete-image': button => window.deleteImage(button.dataset.imgId, button)
};

function onLessonActionClick(event) {
    const button = event.target.closest?.('[data-lesson-action]');
    const action = button && LESSON_ACTIONS[button.dataset.lessonAction];
    if (action && button.closest('#render-view')) action(button);
}

document.addEventListener('click', onLessonActionClick);
