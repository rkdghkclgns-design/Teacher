// lesson-export.js - 교안을 화면과 같은 모양의 HTML·PDF로 내보낸다
// 화면 보기와 같은 순서(그림 치환 → preprocessMarkdown → renderLessonHTML)로 그리고, 화면과 같은 서식(인용 막대·번호 목록·링크)을 문서에 넣는다.
// 위쪽 내보내기 메뉴(현재 차시·현재 교과), ZIP(차시별 교안.html), 교수안 내려받기가 함께 쓴다. PDF는 브라우저 인쇄 창의 'PDF로 저장'으로 만든다.

const EXPORT_PRINT_WAIT = 800; // 인쇄 전에 글꼴·그림이 자리 잡을 시간
const EXPORT_FRAME_LIFETIME = 30 * 60 * 1000; // 인쇄가 끝났다는 신호(afterprint)가 오지 않는 브라우저에서 인쇄용 iframe을 지우는 시한
const EXPORT_CONTROLS = '[data-lesson-action], .image-regenerate-btn, .image-wrapper > span, .para-edit, button, textarea';
const EXPORT_IMAGE_KEY_RE = /^[\w-]{1,80}$/; // 다시 불러오기 표시를 달 그림 키(output-import.js OUTPUT_IMAGE_KEY_RE, data-safety.js SAFE_IMAGE_KEY와 같은 규칙)
const EXPORT_PICTURE_RE = /^data:image\//; // 넣을 그림인지(진짜 그림). 찾지 못한 그림 자리(teacher-image:…)·빈 값은 없는 그림으로 그린다
const EXPORT_SOURCE_URL_RE = /^https?:\/\/[^\s"'<>]+$/i; // 그림 설명 아래 글자로 적을 출처 페이지 주소(http·https만)

const LESSON_EXPORT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;800&display=swap');
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #1a1a2e; font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; font-size: 15px; line-height: 1.8; }
.lesson-doc { max-width: 860px; margin: 0 auto; padding: 40px 32px; }
.lesson-tab-label { display: inline-block; margin: 0 0 .75rem; padding: 2px 10px; border-radius: 999px; background: #efeafe; color: #5b3fd6; font-size: .8rem; font-weight: 700; }
.lesson-tab + .lesson-tab { margin-top: 2.5rem; padding-top: 2rem; border-top: 2px solid #ecebf3; }
.lesson-break + .lesson-break { margin-top: 3rem; padding-top: 2rem; border-top: 3px solid #d9d4f3; }
h1 { font-size: 1.75rem; font-weight: 800; margin: 0 0 1rem; padding-bottom: .5rem; border-bottom: 2px solid #e2ddf7; }
h2 { font-size: 1.35rem; font-weight: 800; margin: 2rem 0 .75rem; }
h3 { font-size: 1.12rem; font-weight: 700; margin: 1.5rem 0 .5rem; }
h4 { font-size: 1rem; font-weight: 700; margin: 1.2rem 0 .4rem; }
p { margin: 0 0 1rem; }
ul, ol { padding-left: 1.5rem; margin: 0 0 1rem; }
ul { list-style: disc; }
ul ul { list-style: circle; }
ol { list-style: decimal; }
li { margin-bottom: .25rem; }
a { color: #6d4fe0; text-decoration: underline; text-underline-offset: 2px; }
code { background: #eee8f8; color: #7c5bf5; padding: .1rem .3rem; border-radius: 4px; font-family: ui-monospace, Consolas, monospace; font-size: .9em; }
pre { background: #1e1e2e; color: #e2e0f0; padding: 1rem; border-radius: 8px; overflow-x: auto; margin: 0 0 1rem; }
pre code { background: none; color: inherit; padding: 0; }
.lesson-code { position: relative; margin: 0 0 1rem; }
.lesson-code > pre { margin: 0; padding-top: 2.1rem; }
.lesson-code[data-lang]::before { content: attr(data-lang); position: absolute; top: .55rem; left: 1rem; font: 700 .7rem/1 ui-monospace, Consolas, monospace; color: #a6a3c8; pointer-events: none; }
blockquote { border-left: 3px solid #7c5bf5; padding: .75rem 1.2rem; margin: 1.2rem 0; background: #f6f3ff; border-radius: 0 8px 8px 0; color: #4a4a7a; }
p.lesson-term { margin: 0 0 0 1.25rem; padding: .35rem 0 .35rem 1rem; border-left: 4px solid #d4d4de; }
ul + p.lesson-term, ol + p.lesson-term, p:not(.lesson-term) + p.lesson-term { margin-top: -.5rem; }
p.lesson-term + :not(.lesson-term) { margin-top: 1rem; }
li > p.lesson-term { margin-left: 0; }
blockquote.lesson-summary { margin: 1.75rem 0 1rem; padding: .9rem 1.25rem .7rem; border: 1px solid #d6ccfb; border-left: 6px solid #7c5bf5; border-radius: 10px; background: #f5f2ff; color: #2a2540; font-style: normal; }
blockquote.lesson-summary > p.lesson-summary-head { margin: 0 0 .45rem; font-size: .95rem; font-weight: 800; color: #4c2fc9; }
blockquote.lesson-summary > ul { margin: 0; padding-left: 1.25rem; }
blockquote.lesson-summary li { margin-bottom: .3rem; line-height: 1.7; }
p.lesson-callout { padding: .55rem .9rem; border-left-width: 4px; border-left-style: solid; border-radius: 0 8px 8px 0; color: #2f2f3d; }
p.lesson-callout:has(+ ul, + ol) { margin-bottom: 0; border-bottom-right-radius: 0; }
p.lesson-callout + ul, p.lesson-callout + ol { margin-top: 0; padding: .15rem .9rem .6rem 2.4rem; border-left-width: 4px; border-left-style: solid; border-radius: 0 0 8px 0; color: #2f2f3d; }
p.lesson-callout-key, p.lesson-callout-key + ul, p.lesson-callout-key + ol { border-left-color: #f59e0b; background: #fffaeb; }
p.lesson-callout-warn, p.lesson-callout-warn + ul, p.lesson-callout-warn + ol { border-left-color: #ef4444; background: #fff4f4; }
p.lesson-callout-check, p.lesson-callout-check + ul, p.lesson-callout-check + ol { border-left-color: #10b981; background: #effcf6; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid #d9d9e3; padding: 8px 12px; text-align: left; vertical-align: top; }
th { background: #f3f2f8; font-weight: 700; }
img, video, svg { max-width: 100%; height: auto; }
img, video { display: block; margin: 1.5rem auto; border-radius: 8px; }
.lesson-video { margin: 1.5rem auto; }
.lesson-video video { width: 100%; margin: 0 auto; background: #000; }
.lesson-video iframe { display: block; width: 100%; aspect-ratio: 16 / 9; height: auto; border: 0; border-radius: 8px; }
.lesson-video-caption { margin: 6px 0 0; text-align: center; font-size: .8rem; color: #6b7280; }
.lesson-video-note { padding: .75rem 1rem; border: 1px dashed #c9c3e6; border-radius: 8px; background: #f8f6ff; color: #4a4a7a; font-size: .85rem; text-align: center; }
.image-wrapper, .mermaid { display: flex; flex-direction: column; align-items: center; margin: 1.5rem auto; }
.image-source { margin-top: 2px; font-size: .75rem; color: #6b7280; text-align: center; word-break: break-all; }
hr { border: 0; border-top: 1px solid #e5e5ee; margin: 2rem 0; }
@media print {
    @page { size: A4; margin: 1.5cm; }
    body { font-size: 12.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .lesson-doc { max-width: none; padding: 0; }
    .lesson-tab + .lesson-tab, .lesson-break + .lesson-break { break-before: page; margin-top: 0; padding-top: 0; border-top: 0; }
    h1, h2, h3, h4 { break-after: avoid; }
    img, video, table, pre, blockquote, .image-wrapper, .mermaid, .lesson-code { break-inside: avoid; }
    p.lesson-callout { break-inside: avoid; }
    p.lesson-callout:has(+ ul, + ol) { break-after: avoid; }
    pre { white-space: pre-wrap; }
}`;

const exportEscape = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/* ---------- 내보낼 글 고르기 (DOM 없이) ---------- */
// 탭 순서대로 내용이 있는 탭만. tabIds를 주면 그 탭만. 탭이 모두 비고 옛 단일 본문(content)만 있으면 기본학습으로 본다
function lessonTabSources(mod, tabIds) {
    const tabs = mod?.tabContents || {};
    const legacy = !!mod?.content && !LESSON_TABS.some(tab => tabs[tab.id]);
    const clean = md => (typeof cleanLessonOpening === 'function' ? cleanLessonOpening(md) : md);
    return LESSON_TABS
        .filter(tab => !tabIds || tabIds.includes(tab.id))
        .map(tab => ({ id: tab.id, label: tab.label, md: tabs[tab.id] || (legacy && tab.id === 'basicLearn' ? mod.content : '') }))
        .filter(tab => tab.md && tab.md.trim())
        .map(tab => ({ ...tab, md: clean(tab.md) }));
}

// local:그림 키를 저장된 그림으로 바꾸고, 없는 그림 자리는 비운다(화면 보기와 같은 규칙. 차시 화면도 이 함수로 그린다, api.js)
// 그림 키는 [\w-]만 쓰므로(data-safety.js SAFE_IMAGE_KEY) 정해 둔 모양 하나로 찾아 키를 목록에서 꺼낸다(그림 키로 정규식을 만들지 않는다).
// 키 끝까지 읽으므로 img_1이 img_10을 건드리지 않는다. 진짜 그림만 넣고, 찾지 못한 그림 자리(teacher-image:…)·빈 값·목록에 없는 키는 없는 그림 자리로 둔다.
// 코드 블록 안은 바꾸지 않는다(코드 예제의 local: 글자와 ToString(local: true) 같은 코드는 그대로). 빈 자리로 둘 괄호는 그림 키 모양((local:img_1))만 본다.
// 차시 동영상(src="local:vid_…", lesson-insert-tools.js)은 그림이 아니라 비우지 않는다. 화면은 그린 뒤 그 파일을 붙이고(applyLessonVideos) 내보내기는 파일을 넣는다(exportLessonVideos)
function inlineLessonImages(md, images) {
    const pictures = new Map(Object.entries(images || {}).filter(([, data]) => typeof data === 'string' && EXPORT_PICTURE_RE.test(data)));
    const code = typeof stashCodeFences === 'function' ? stashCodeFences(String(md || ''), { keepSpaces: true }) : { text: String(md || ''), restore: text => text };
    const filled = code.text.replace(/local:([\w-]{1,80})(?![\w-])/g, (whole, id) => (pictures.has(id) ? pictures.get(id) : whole));
    return code.restore(filled.replace(/src="local:(?!vid_[a-z0-9]{6,40}")[^"]+"/g, 'src="" alt="[이미지 생성 누락]"').replace(/\(local:[\w-]{1,80}\)/g, '()'));
}

// 동영상을 대신하는 안내 칸(글자로만 넣는다)
function exportVideoNote(box, text) {
    const note = box.ownerDocument.createElement('div');
    note.className = 'lesson-video-note';
    note.textContent = text;
    return note;
}

const EXPORT_VIDEO_TEXT = {
    print: '▶ 동영상은 인쇄본에서 재생되지 않습니다. 화면이나 HTML 파일에서 보세요.',
    zip: '▶ 직접 넣은 동영상 파일은 이 읽기용 파일에 넣지 않았습니다(백업이 두 배로 커지지 않게). 백업의 되살리기용 정보에 담겨 있어 앱에서 되살리면 재생됩니다.',
    missing: '동영상 파일을 찾지 못해 넣지 못했습니다. 앱에서 도구 → 동영상 넣기로 다시 넣어 주세요.'
};

// 내보낼 칸의 차시 동영상. mode 'play'(HTML 파일)는 내 PC 동영상(local:키 · data-video-id)의 src를 차시에 둔 data URL로 바꿔 파일 하나로 열리게 하고(찾지 못한 파일은 안내 글로),
// 'zip'(백업 ZIP의 읽기용 교안.html)은 내 PC 동영상만 안내 글로 바꾼다(파일은 save_data.yaml에 담긴다). 'print'(PDF)는 재생할 수 없어 동영상·삽입 플레이어를 안내 칸으로 바꾼다
// (아래 설명의 주소 링크는 남는다). 판서 영상(data-wb-video)은 whiteboard-video.js가 다룬다. 파일 안에 넣은 동영상 수를 돌려준다
function exportLessonVideos(box, mod, mode) {
    const videos = mod?.lessonVideos && typeof mod.lessonVideos === 'object' ? mod.lessonVideos : {};
    const keyOf = typeof lessonVideoKeyOf === 'function' ? lessonVideoKeyOf : () => '';
    const isData = typeof isLessonVideoData === 'function' ? isLessonVideoData : () => false;
    const swap = (el, text) => el.parentNode?.replaceChild(exportVideoNote(box, text), el);
    let count = 0;
    Array.from(box.querySelectorAll('video')).forEach(player => {
        if (player.hasAttribute('data-wb-video')) return;
        const key = keyOf(player);
        if (mode === 'print') return swap(player, EXPORT_VIDEO_TEXT.print);
        if (!key) return;
        const data = Object.prototype.hasOwnProperty.call(videos, key) ? videos[key] : '';
        if (!isData(data)) return swap(player, EXPORT_VIDEO_TEXT.missing);
        if (mode === 'zip') return swap(player, EXPORT_VIDEO_TEXT.zip);
        player.setAttribute('src', data);
        player.removeAttribute('hidden');
        count += 1;
    });
    Array.from(box.querySelectorAll('.lesson-video-missing')).forEach(el => el.remove()); // 화면에 단 안내(applyLessonVideos)는 위 안내 글로 대신한다
    if (mode === 'print') Array.from(box.querySelectorAll('iframe')).forEach(frame => swap(frame, EXPORT_VIDEO_TEXT.print));
    return count;
}

// 내보내기 종류 → 동영상 다루는 방식. 다시 불러오기 표시를 다는 내보내기(HTML 파일·ZIP의 교안.html)만 재생할 수 있다
const exportVideoMode = opts => (!opts.mark ? 'print' : opts.videoFiles === false ? 'zip' : 'play');

// 다시 불러오기 표시: 화면에 보인 그림 <img>에 그림 키와 차시 번호를 단다. 원본(JSON)에는 그 그림을 다시 넣지 않는다(output-import.js)
// images: 이 화면을 그릴 때 쓴 그림(키 → data URL). 같은 그림이 여러 키에 있으면 앞 키 하나만 단다(나머지 키는 원본에 그림을 담는다)
// shown(Map 키 → 그림)에 단 것을 모은다. 글에 미리 들어 있던 표시는 지운다(남이 만든 글이 다른 그림을 가리키지 않게)
function markShownImages(box, images, lessonIndex, shown) {
    const keyOf = new Map();
    Object.entries(images || {}).forEach(([key, data]) => {
        if (typeof data === 'string' && EXPORT_PICTURE_RE.test(data) && EXPORT_IMAGE_KEY_RE.test(key) && !keyOf.has(data)) keyOf.set(data, key);
    });
    box.querySelectorAll('img').forEach(img => {
        img.removeAttribute('data-teacher-image');
        img.removeAttribute('data-teacher-lesson');
        const src = img.getAttribute('src');
        const key = keyOf.get(src);
        if (!key) return;
        img.setAttribute('data-teacher-image', key);
        img.setAttribute('data-teacher-lesson', String(lessonIndex));
        shown.set(key, src);
    });
    return box;
}

// 완성된 HTML 문서. 서식은 문서 안에 넣어 파일 하나로 열린다.
// source: 다시 불러오기용 원본 태그(output-import.js lessonSourceScript). HTML로 내려받을 때와 ZIP의 교안.html에 넣는다(PDF 인쇄본에는 넣지 않는다)
function lessonHtmlDocument(title, body, extraCss = '', source = '') {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${exportEscape(title)}</title>
<style>${LESSON_EXPORT_CSS}${extraCss}</style>
</head>
<body>
<main class="lesson-doc">
${body}
</main>
${source}
</body>
</html>
`;
}

/* ---------- 그리기 ---------- */
// 예시 게임 그림의 출처 페이지 주소(그림 설명의 data-source-url, game-images.js)를 설명 바로 아래에 글자로 적는다. http·https 주소만, 글자로만 넣는다
function exportImageSources(box) {
    box.querySelectorAll('.image-caption[data-source-url]').forEach(caption => {
        const url = String(caption.getAttribute('data-source-url') || '').trim();
        const next = caption.nextSibling;
        if (!EXPORT_SOURCE_URL_RE.test(url) || (next && next.nodeType === 1 && String(next.className || '').split(' ').includes('image-source'))) return;
        const line = document.createElement('div');
        line.className = 'image-source';
        line.textContent = `출처 페이지: ${url}`;
        caption.parentNode.insertBefore(line, next);
    });
    return box;
}

function exportStrip(html) {
    const box = document.createElement('div');
    box.innerHTML = html;
    box.querySelectorAll(EXPORT_CONTROLS).forEach(el => el.remove());
    box.querySelectorAll('.hidden').forEach(el => el.classList.remove('hidden')); // 두 번 눌러 고치는 중 숨긴 단락
    return exportImageSources(box);
}

// 체크리스트 다시 보기 링크(checklist-links.js)의 id 앞말: 차시와 탭마다 다르다(교과 문서에 차시·탭이 여럿 들어간다). 영문·숫자·-·_만
const exportAnchorPrefix = (mod, tab) => `ls-${String(mod?.id ?? '').replace(/[^\w-]/g, '')}-${String(tab?.id ?? '').replace(/[^\w-]/g, '')}`;

// 그린 탭의 다시 보기 링크와 제목 id에 앞말을 붙인다. 링크는 문서 안 #id로 가므로 파일 하나로 열어도 그 제목으로 간다
const scopeExportLinks = (box, mod, tab) => (typeof scopeChecklistLinks === 'function' ? scopeChecklistLinks(box, exportAnchorPrefix(mod, tab)) : box);

async function renderExportMermaid(box) {
    if (!window.mermaid) return;
    let count = 0;
    for (const el of box.querySelectorAll('.mermaid')) {
        const code = (el.textContent || '').trim();
        if (el.querySelector('svg') || !code) continue;
        try {
            const clean = typeof sanitizeMermaidCode === 'function' ? sanitizeMermaidCode(code) : code;
            el.innerHTML = (await window.mermaid.render(`export-mermaid-${Date.now()}-${count++}`, clean)).svg;
        } catch (err) {
            console.warn('[내보내기] 다이어그램을 그리지 못해 코드로 둡니다:', err.message);
        }
    }
}

// 지금 화면에 보이는 탭이면 화면을 그대로 쓴다(그린 다이어그램, 판서 영상). 아니면 같은 순서로 새로 그린다
// 화면이 아직 그리지 않은 다이어그램(슬라이드·문제은행·교수안이 가린 화면에는 그리지 않는다)은 화면을 복사해 복사본에 그린다(api.js lessonViewForExport)
// opts.mark = { index, shown }: HTML 파일과 ZIP의 교안.html은 보이는 그림에 다시 불러오기 표시를 단다(PDF에는 달지 않는다)
async function lessonTabHtml(mod, tab, opts) {
    const view = document.getElementById('render-view');
    const onScreen = opts.useView && view && view.children.length
        && tab.id === currentLessonTab && String(getEditingModule?.()?.id) === String(mod.id);
    const mark = box => (opts.mark ? markShownImages(box, mod.images, opts.mark.index, opts.mark.shown) : box);
    if (onScreen) {
        const drawnView = window.lessonViewForExport ? await window.lessonViewForExport(view) : view;
        const exported = opts.videos && window.whiteboardHtmlForExport ? await window.whiteboardHtmlForExport(drawnView) : { html: drawnView.innerHTML, videos: 0 };
        const shownBox = scopeExportLinks(exportStrip(exported.html), mod, tab);
        const localVideos = exportLessonVideos(shownBox, mod, exportVideoMode(opts));
        return { html: mark(shownBox).innerHTML, videos: exported.videos, localVideos };
    }
    // 화면과 같은 규칙: 문제은행 탭·최종 평가는 핵심 요약·💡·⚠️·✅ 상자 없이 그린다(lesson-summary.js lessonCalloutsFor)
    const callouts = typeof lessonCalloutsFor === 'function' ? lessonCalloutsFor(mod, tab.id) : true;
    const box = scopeExportLinks(exportStrip(renderLessonHTML(preprocessMarkdown(inlineLessonImages(tab.md, mod.images)), callouts ? undefined : { callouts: false })), mod, tab);
    await renderExportMermaid(box);
    const localVideos = exportLessonVideos(box, mod, exportVideoMode(opts));
    return { html: mark(box).innerHTML, videos: 0, localVideos };
}

// 차시 하나의 문서 본문. 탭이 여럿이면 탭 이름 띠를 붙이고, PDF에서는 탭마다 새 쪽으로 넘긴다
async function lessonExportBody(mod, tabIds, opts = {}) {
    const tabs = lessonTabSources(mod, tabIds);
    const sections = [];
    let videos = 0;
    let localVideos = 0;
    for (const tab of tabs) {
        const out = await lessonTabHtml(mod, tab, opts);
        videos += out.videos;
        localVideos += out.localVideos || 0;
        const label = tabs.length > 1 ? `<div class="lesson-tab-label">${exportEscape(tab.label)}</div>` : '';
        sections.push(`<section class="lesson-tab">${label}${out.html}</section>`);
    }
    return { html: sections.join('\n'), tabs: tabs.length, videos, localVideos };
}

/* ---------- 내려받기·인쇄 ---------- */
// 내려받은 파일 크기(바이트)를 돌려준다. 기본 저장 폴더(save-folder.js)를 골랐으면 그 폴더에 저장한다
function downloadTextFile(text, fileName, type) {
    const blob = new Blob([text], { type });
    if (typeof saveFileToFolder === 'function') {
        saveFileToFolder(blob, fileName).catch(showSaveFailure);
        return blob.size;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return blob.size;
}

// 숨긴 iframe에 문서를 넣고 인쇄 창을 연다. 새 창을 띄우지 않으므로 팝업 차단에 걸리지 않는다
async function printHtmlDocument(doc) {
    document.getElementById('lesson-print-frame')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'lesson-print-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(frame);
    const win = frame.contentWindow;
    win.document.open();
    win.document.write(doc);
    win.document.close();
    await Promise.all([...win.document.images].map(img => (img.complete ? null : new Promise(done => { img.onload = done; img.onerror = done; }))));
    await win.document.fonts?.ready?.catch(() => null);
    await new Promise(done => setTimeout(done, EXPORT_PRINT_WAIT));
    // 인쇄 창이 닫힌 뒤에 지운다. 인쇄 창에 오래 머물러도 문서가 사라지지 않게
    const cleanup = () => frame.remove();
    win.addEventListener('afterprint', () => setTimeout(cleanup, 500), { once: true });
    setTimeout(cleanup, EXPORT_FRAME_LIFETIME);
    win.focus();
    win.print();
}

/* ---------- 내보내기 메뉴에서 부른다 ---------- */
// format: 'html' | 'pdf'. tabIds: null이면 차시 전체(모든 탭), 아니면 그 탭만
window.exportLessonDocument = async function (mod, format, tabIds) {
    if (!mod) return window.showAlert('차시를 먼저 선택해주세요. (좌측 목록에서 차시 클릭)');
    // HTML을 다 그린 뒤에는 권한 창을 띄우지 못하므로 누른 직후 기본 저장 폴더(save-folder.js)의 쓰기 권한을 받아 둔다
    if (format === 'html' && typeof prepareSaveFolder === 'function') await prepareSaveFolder();
    try {
        window.showToast?.(format === 'pdf' ? '인쇄 창을 준비하는 중입니다. "PDF로 저장"을 고르세요.' : 'HTML 파일을 만드는 중입니다.', 'info');
        const asHtml = format === 'html';
        const shown = new Map();
        const body = await lessonExportBody(mod, tabIds, { useView: true, videos: asHtml, mark: asHtml ? { index: 0, shown } : null });
        if (!body.tabs) return window.showAlert('내보낼 교안 내용이 없습니다.');
        if (format === 'pdf') return await printHtmlDocument(lessonHtmlDocument(mod.title || '교안', body.html));
        // 읽기용 HTML: 원본에는 탭 글과 화면에 없는 그림만 담는다(교수안은 넣지 않는다). '내보낸 교안 다시 불러오기'로 고칠 수 있다
        const source = lessonSourceScript(lessonSourcePayload([mod], { tabIds, shown: [shown] }));
        // 큰 파일도 '내보낸 교안 다시 불러오기'가 조각으로 읽어 되살리므로 크기 안내는 하지 않는다(import-stream.js)
        downloadTextFile(lessonHtmlDocument(mod.title || '교안', body.html, '', source), lessonFileName(mod, 'html'), 'text/html;charset=utf-8');
        if (body.videos) window.showToast?.(`판서 영상 ${body.videos}개를 HTML 파일 안에 넣었습니다(파일이 커질 수 있습니다).`, 'info');
        if (body.localVideos) window.showToast?.(`직접 넣은 동영상 ${body.localVideos}개를 HTML 파일 안에 넣었습니다(파일이 커질 수 있습니다).`, 'info');
    } catch (err) {
        console.error('[내보내기] 차시 문서 실패:', err);
        window.showAlert(`내보내기 중 오류가 났습니다: ${err.message}`);
    }
};

// 교과 전체를 문서 하나로. 차시는 PDF에서 새 쪽으로 넘긴다. 차시별 파일은 ZIP에 들어 있다
window.exportSubjectDocument = async function (subj, format) {
    if (!subj) return window.showAlert('교과를 먼저 선택해주세요.');
    const lessons = (subj.lessons || []).filter(mod => mod.id !== 'mainQuest' && lessonTabSources(mod).length);
    if (!lessons.length) return window.showAlert('내보낼 교안이 없습니다. 교안을 먼저 생성해주세요.');
    if (format === 'html' && typeof prepareSaveFolder === 'function') await prepareSaveFolder(); // 차시가 많으면 다 그리는 데 오래 걸린다(exportLessonDocument와 같다)
    try {
        window.showToast?.(`${lessons.length}개 차시를 문서로 만드는 중입니다.`, 'info');
        const asHtml = format === 'html';
        const shown = lessons.map(() => new Map());
        const articles = [];
        for (const [index, mod] of lessons.entries()) {
            const body = await lessonExportBody(mod, null, asHtml ? { mark: { index, shown: shown[index] } } : {});
            articles.push(`<article class="lesson-break">${body.html}</article>`);
        }
        if (format === 'pdf') return await printHtmlDocument(lessonHtmlDocument(subj.title || '교과', articles.join('\n')));
        // 읽기용: 교수안은 원본에 넣지 않는다. 보이는 그림은 차시 번호와 함께 표시해 원본에 다시 담지 않는다
        const source = lessonSourceScript(lessonSourcePayload(lessons, { shown }));
        downloadTextFile(lessonHtmlDocument(subj.title || '교과', articles.join('\n'), '', source), `${safeFileName(subj.title || '교과')}_교안.html`, 'text/html;charset=utf-8');
    } catch (err) {
        console.error('[내보내기] 교과 문서 실패:', err);
        window.showAlert(`내보내기 중 오류가 났습니다: ${err.message}`);
    }
};

// ZIP에 넣을 차시 교안 HTML(모든 탭, 그림 포함). 내용이 없으면 null
// 원본도 담아 이 파일 하나로 '내보낸 교안 다시 불러오기'가 된다. 교수안은 넣지 않는다(ZIP의 07_교수안.md·08_슬라이드편성안.md, 심화학습은 09·10번 파일에 있다)
// 원본은 그린 바로 그 차시(mod)로 만든다(그림 담기 '빼기'는 백업 정보에만 쓰고 읽기용 교안.html의 그림은 그대로 둔다)
window.lessonHtmlForZip = async function (mod) {
    const shown = new Map();
    const body = await lessonExportBody(mod, null, { mark: { index: 0, shown }, videoFiles: false }); // 직접 넣은 동영상 파일은 save_data.yaml에만 담는다
    if (!body.tabs) return null;
    return lessonHtmlDocument(mod.title || '교안', body.html, '', lessonSourceScript(lessonSourcePayload([mod], { shown: [shown] })));
};

Object.assign(window, { lessonTabSources, inlineLessonImages, lessonHtmlDocument, printHtmlDocument, downloadTextFile, markShownImages });
