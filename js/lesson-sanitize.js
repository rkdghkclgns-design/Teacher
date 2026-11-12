// lesson-sanitize.js - 교안 HTML에서 실행되는 요소를 걷어낸다
// 교안은 AI 응답, 업로드한 MD, 가져온 저장 파일을 그대로 그린다. API 키가 브라우저에 있으므로 화면과 내보낸 HTML 어디서도 스크립트가 돌면 안 된다.
// 인라인 핸들러는 모두 지운다. 교안 안의 버튼은 data-lesson-action으로 표시하고 값은 글자로만 다룬다.

// 파서마다 다르게 읽는 요소(noscript, math 등)는 정리 뒤 다시 파싱될 때 태그가 살아날 수 있어 통째로 뺀다.
// iframe은 허용한 동영상 삽입 주소(youtube-nocookie·player.vimeo.com)만 새로 만들어 남기고 나머지는 지운다(keepLessonEmbed)
const LESSON_BLOCKED_SELECTOR = [
    'script', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'form',
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

/* ---------- 동영상: 주소 읽기·삽입 주소·차시 동영상 키 (lesson-insert-tools.js·lesson-export.js·data-safety.js가 함께 쓴다) ---------- */
// YouTube는 개인정보를 덜 남기는 youtube-nocookie.com/embed로, Vimeo는 player.vimeo.com(dnt=1)으로만 넣는다.
// 주소는 URL로 읽어 id만 꺼낸 뒤 정해 둔 모양으로 다시 쓴다(받은 글자를 속성에 그대로 넣지 않는다)
const LESSON_YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const LESSON_YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const LESSON_VIMEO_HASH = /^[0-9a-f]{6,20}$/i;
const LESSON_VIDEO_FILE_TYPES = { mp4: 'video/mp4', webm: 'video/webm' };
const LESSON_VIDEO_START_MAX = 24 * 60 * 60; // 시작 시각 상한(초)
// 차시에 넣은 내 PC 동영상: lessonVideos[동영상 키] = data URL, 글에는 local:동영상 키(그림의 local:그림 키와 같은 모양, 앞말 vid_로 가른다)
const LESSON_VIDEO_KEY_RE = /^vid_[a-z0-9]{6,40}$/;
const LESSON_VIDEO_REF_RE = /local:(vid_[a-z0-9]{6,40})(?![\w-])/g;
const LESSON_VIDEO_DATA_RE = /^data:video\/(?:mp4|webm);base64,[A-Za-z0-9+/=]+$/;
// 삽입 플레이어에 주는 권한: 재생·전체 화면·PIP만(카메라·마이크·자동 재생은 주지 않는다). 위 창을 옮기지 못하게 sandbox로 묶는다
const LESSON_EMBED_ALLOW = 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
const LESSON_EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox';

const isLessonVideoData = value => typeof value === 'string' && LESSON_VIDEO_DATA_RE.test(value);

// 시작 시각 글(90 · 90s · 1m30s · 1h2m3s)을 초로. 못 읽으면 0
function lessonVideoStart(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return 0;
    const match = /^(\d{1,6})s?$/.exec(text) || /^(?:(\d{1,2})h)?(?:(\d{1,3})m)?(?:(\d{1,5})s)?$/.exec(text);
    if (!match) return 0;
    const seconds = match.length === 2 ? Number(match[1]) : Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
    return Number.isSafeInteger(seconds) && seconds > 0 ? Math.min(seconds, LESSON_VIDEO_START_MAX) : 0;
}

const lessonYoutubeEmbed = (id, start = 0) => `https://www.youtube-nocookie.com/embed/${id}${start > 0 ? `?start=${start}` : ''}`;
const lessonVimeoEmbed = (id, hash = '') => `https://player.vimeo.com/video/${id}?${hash ? `h=${hash}&` : ''}dnt=1`;

// http·https 주소만, 계정·포트를 적은 주소는 받지 않는다. 아니면 null
function lessonVideoUrl(text) {
    const raw = String(text ?? '').trim();
    if (!raw || /[\s"'<>`]/.test(raw)) return null;
    try {
        const url = new URL(raw);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port ? url : null;
    } catch (err) {
        return null;
    }
}

function lessonYoutubeId(url, host) {
    if (host === 'youtu.be') {
        const id = url.pathname.split('/')[1] || '';
        return LESSON_YOUTUBE_ID.test(id) && url.pathname.split('/').length <= 3 ? id : '';
    }
    if (!LESSON_YOUTUBE_HOSTS.has(host)) return '';
    if (url.pathname === '/watch') {
        const id = url.searchParams.get('v') || '';
        return LESSON_YOUTUBE_ID.test(id) ? id : '';
    }
    const match = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname);
    return match ? match[1] : '';
}

// Vimeo 주소의 { id, hash }. vimeo.com/123 · vimeo.com/123/해시(비공개 링크) · vimeo.com/channels/이름/123 · player.vimeo.com/video/123?h=해시. 아니면 null
function lessonVimeoParts(url, host) {
    if (host === 'player.vimeo.com') {
        const match = /^\/video\/(\d{1,12})\/?$/.exec(url.pathname);
        const hash = url.searchParams.get('h') || '';
        return match ? { id: match[1], hash: LESSON_VIMEO_HASH.test(hash) ? hash : '' } : null;
    }
    if (host !== 'vimeo.com' && host !== 'www.vimeo.com') return null;
    const match = /^\/(?:channels\/[\w-]{1,60}\/|groups\/[\w-]{1,60}\/videos\/)?(\d{1,12})(?:\/([0-9a-f]{6,20}))?\/?$/i.exec(url.pathname);
    return match ? { id: match[1], hash: match[2] || '' } : null;
}

// 강사가 적은 동영상 주소 → { kind: 'youtube' | 'vimeo', id, src(삽입 주소), link(원래 보기 주소) } 또는 { kind: 'file', src, link, type }. 받을 수 없으면 null
function parseLessonVideoUrl(text) {
    const url = lessonVideoUrl(text);
    if (!url) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const youtube = lessonYoutubeId(url, host);
    if (youtube) {
        const start = lessonVideoStart(url.searchParams.get('t') || url.searchParams.get('start'));
        return { kind: 'youtube', id: youtube, src: lessonYoutubeEmbed(youtube, start), link: `https://www.youtube.com/watch?v=${youtube}` };
    }
    const vimeo = lessonVimeoParts(url, host);
    if (vimeo) return { kind: 'vimeo', id: vimeo.id, src: lessonVimeoEmbed(vimeo.id, vimeo.hash), link: `https://vimeo.com/${vimeo.id}` };
    const ext = (/\.([a-z0-9]{1,5})$/i.exec(url.pathname) || [])[1]?.toLowerCase();
    if (!LESSON_VIDEO_FILE_TYPES[ext]) return null;
    return { kind: 'file', src: url.href, link: url.href, type: LESSON_VIDEO_FILE_TYPES[ext] };
}

// 교안 HTML의 iframe 주소 → 남길 삽입 주소(정해 둔 모양). youtube.com 삽입은 youtube-nocookie로 바꾼다. 허용한 삽입 주소가 아니면 ''
function lessonEmbedFrameSrc(value) {
    const url = lessonVideoUrl(value);
    if (!url) return '';
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (LESSON_YOUTUBE_HOSTS.has(host) && host !== 'music.youtube.com') {
        const match = /^\/embed\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname);
        return match ? lessonYoutubeEmbed(match[1], lessonVideoStart(url.searchParams.get('start'))) : '';
    }
    if (host !== 'player.vimeo.com') return '';
    const vimeo = lessonVimeoParts(url, host);
    return vimeo ? lessonVimeoEmbed(vimeo.id, vimeo.hash) : '';
}

// 허용한 삽입 주소의 iframe만 정해 둔 속성으로 새로 만들어 바꾼다. 안쪽 글(iframe 안은 글자로 읽힌다)·핸들러·srcdoc·다른 속성은 버린다. 아니면 지운다
function keepLessonEmbed(doc, frame) {
    const src = lessonEmbedFrameSrc(frame.getAttribute('src'));
    if (!src || !frame.parentNode) {
        frame.remove();
        return;
    }
    const title = String(frame.getAttribute('title') || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80) || '동영상';
    const clean = doc.createElement('iframe');
    [['src', src], ['title', title], ['allow', LESSON_EMBED_ALLOW], ['allowfullscreen', ''], ['loading', 'lazy'],
        ['referrerpolicy', 'strict-origin-when-cross-origin'], ['sandbox', LESSON_EMBED_SANDBOX], ['class', 'lesson-video-frame']]
        .forEach(([name, value]) => clean.setAttribute(name, value));
    frame.parentNode.replaceChild(clean, frame);
}

// 화면·내보내기의 <video>가 가리키는 차시 동영상 키(data-video-id 또는 src="local:키"). 아니면 ''
function lessonVideoKeyOf(el) {
    const own = String(el?.getAttribute?.('data-video-id') || '');
    if (LESSON_VIDEO_KEY_RE.test(own)) return own;
    const match = /^local:(vid_[a-z0-9]{6,40})$/.exec(String(el?.getAttribute?.('src') || '').trim());
    return match ? match[1] : '';
}

// 정리에 실패하면 글자로 보여 준다. 정리되지 않은 HTML을 그대로 내보내지 않는다
function sanitizeLessonHtml(html) {
    try {
        const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
        Array.from(doc.body.querySelectorAll('iframe')).forEach(frame => keepLessonEmbed(doc, frame));
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
// postprocessHtml이 '**라벨:**'의 끝 콜론을 지우므로 그 전(marked 직후)에 부른다.
// 라벨 모양: **라벨:** 설명 / **라벨**: 설명 / **라벨: 설명 전체가 굵게**
// 목록 안에 들여쓴 문단은 marked가 '<p>  <strong>'처럼 앞 공백을 남긴다
const LESSON_TERM_PARAGRAPH = String.raw`<p>\s*<strong>[^<:：]{1,40}(?:[:：]\s*<\/strong>|<\/strong>\s*[:：]|[:：](?=[^<]))[\s\S]*?<\/p>\s*`;
// 머리: 목록 끝, '• 항목' 문단, 굵은 글씨만 있는 짧은 문단, 목록 항목 안의 첫 문단(들여쓴 설명이 그 항목 안에 들어간 경우)
const LESSON_TERM_HEAD = String.raw`(?:<\/ul>|<\/ol>|<p>•[^<]{1,40}<\/p>|<p>(?:•\s*)?<strong>[^<]{1,40}<\/strong><\/p>|<li>\s*<p>(?:(?!<\/p>)[\s\S])*<\/p>)\s*`;
const LESSON_TERM_RUN = new RegExp(`(${LESSON_TERM_HEAD})?((?:${LESSON_TERM_PARAGRAPH})+)`, 'g');

function markTermParagraphs(html) {
    return String(html || '').replace(LESSON_TERM_RUN, (whole, head, run) => {
        const count = (run.match(/<p>/g) || []).length;
        if (!head && count < 2) return whole; // 머리 없이 하나만 있는 '라벨: 설명'은 그대로 둔다
        return (head || '') + run.replace(/<p>(?=\s*<strong>)/g, '<p class="lesson-term">');
    });
}

/* ---------- 교안 안의 버튼 ---------- */
// 코드 블록의 코드만 복사한다(api.js lessonCodeBlockHtml). 이름표는 CSS이고 버튼에는 글자가 없다.
// 앱이 그린 코드 블록은 글자만 담는다. 안에 다른 요소가 든 블록(남이 준 교안에 HTML로 넣은 블록)은 화면에 숨긴 글까지 복사될 수 있어 복사하지 않는다
async function copyLessonCode(button) {
    const box = button.closest('.lesson-code');
    const holder = box?.querySelector('pre code') || box?.querySelector('pre');
    if (!holder || holder.children?.length) {
        window.showToast?.('이 코드 블록은 앱이 만든 모양이 아니라 복사하지 않았습니다. 코드를 끌어 골라 복사해 주세요.', 'warning');
        return;
    }
    const code = holder.textContent ?? '';
    try {
        if (typeof copyPlainText === 'function') await copyPlainText(code); // 클립보드가 막히면 선택 복사로 대신한다(course-list.js)
        else await navigator.clipboard.writeText(code);
        window.showToast?.('코드를 복사했습니다.', 'success');
    } catch (err) {
        console.warn('[코드 복사] 실패:', err?.message);
        window.showToast?.('복사하지 못했습니다. 코드를 끌어 골라 복사해 주세요.', 'warning');
    }
}

const LESSON_ACTIONS = {
    'regenerate-image': button => window.promptRegenerateImage(button, button.dataset.keyword || '', button.dataset.imgId || null),
    'delete-image': button => window.deleteImage(button.dataset.imgId, button),
    'copy-code': copyLessonCode
};

// 교안 화면(#render-view)에서는 모든 단추가 돈다. 강사 대본 화면(#lesson-script-view, lesson-script-view.js)의 교안 칸에서는 코드 복사만 돈다(그림 다시 찾기·지우기는 고치는 일이다)
function onLessonActionClick(event) {
    const button = event.target.closest?.('[data-lesson-action]');
    const action = button && LESSON_ACTIONS[button.dataset.lessonAction];
    if (!action) return;
    if (button.closest('#render-view') || (button.dataset.lessonAction === 'copy-code' && button.closest('#lesson-script-view'))) action(button);
}

document.addEventListener('click', onLessonActionClick);
