// lesson-export.js - 교안을 화면과 같은 모양의 HTML·PDF로 내보낸다
// 화면 보기와 같은 순서(그림 치환 → preprocessMarkdown → renderLessonHTML)로 그리고, 화면과 같은 서식(인용 막대·번호 목록·링크)을 문서에 넣는다.
// 위쪽 내보내기 메뉴(현재 차시·현재 교과), ZIP(차시별 교안.html), 교수안 내려받기가 함께 쓴다. PDF는 브라우저 인쇄 창의 'PDF로 저장'으로 만든다.

const EXPORT_PRINT_WAIT = 800; // 인쇄 전에 글꼴·그림이 자리 잡을 시간
const EXPORT_FRAME_LIFETIME = 30 * 60 * 1000; // 인쇄가 끝났다는 신호(afterprint)가 오지 않는 브라우저에서 인쇄용 iframe을 지우는 시한
const EXPORT_CONTROLS = '[data-lesson-action], .image-regenerate-btn, .image-wrapper > span, .para-edit, button, textarea';
const EXPORT_IMAGE_KEY_RE = /^[\w-]{1,80}$/; // 다시 불러오기 표시를 달 그림 키(output-import.js OUTPUT_IMAGE_KEY_RE, data-safety.js SAFE_IMAGE_KEY와 같은 규칙)
const EXPORT_PICTURE_RE = /^data:image\//; // 넣을 그림인지(진짜 그림). 찾지 못한 그림 자리(teacher-image:…)·빈 값은 없는 그림으로 그린다

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
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid #d9d9e3; padding: 8px 12px; text-align: left; vertical-align: top; }
th { background: #f3f2f8; font-weight: 700; }
img, video, svg { max-width: 100%; height: auto; }
img, video { display: block; margin: 1.5rem auto; border-radius: 8px; }
.image-wrapper, .mermaid { display: flex; flex-direction: column; align-items: center; margin: 1.5rem auto; }
hr { border: 0; border-top: 1px solid #e5e5ee; margin: 2rem 0; }
@media print {
    @page { size: A4; margin: 1.5cm; }
    body { font-size: 12.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .lesson-doc { max-width: none; padding: 0; }
    .lesson-tab + .lesson-tab, .lesson-break + .lesson-break { break-before: page; margin-top: 0; padding-top: 0; border-top: 0; }
    h1, h2, h3, h4 { break-after: avoid; }
    img, video, table, pre, blockquote, .image-wrapper, .mermaid, .lesson-code { break-inside: avoid; }
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
// 코드 블록 안은 바꾸지 않는다(코드 예제의 local: 글자와 ToString(local: true) 같은 코드는 그대로). 빈 자리로 둘 괄호는 그림 키 모양((local:img_1))만 본다
function inlineLessonImages(md, images) {
    const pictures = new Map(Object.entries(images || {}).filter(([, data]) => typeof data === 'string' && EXPORT_PICTURE_RE.test(data)));
    const code = typeof stashCodeFences === 'function' ? stashCodeFences(String(md || ''), { keepSpaces: true }) : { text: String(md || ''), restore: text => text };
    const filled = code.text.replace(/local:([\w-]{1,80})(?![\w-])/g, (whole, id) => (pictures.has(id) ? pictures.get(id) : whole));
    return code.restore(filled.replace(/src="local:[^"]+"/g, 'src="" alt="[이미지 생성 누락]"').replace(/\(local:[\w-]{1,80}\)/g, '()'));
}

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
function exportStrip(html) {
    const box = document.createElement('div');
    box.innerHTML = html;
    box.querySelectorAll(EXPORT_CONTROLS).forEach(el => el.remove());
    box.querySelectorAll('.hidden').forEach(el => el.classList.remove('hidden')); // 두 번 눌러 고치는 중 숨긴 단락
    return box;
}

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
// opts.mark = { index, shown }: HTML 파일과 ZIP의 교안.html은 보이는 그림에 다시 불러오기 표시를 단다(PDF에는 달지 않는다)
async function lessonTabHtml(mod, tab, opts) {
    const view = document.getElementById('render-view');
    const onScreen = opts.useView && view && view.children.length
        && tab.id === currentLessonTab && String(getEditingModule?.()?.id) === String(mod.id);
    const mark = box => (opts.mark ? markShownImages(box, mod.images, opts.mark.index, opts.mark.shown) : box);
    if (onScreen) {
        const exported = opts.videos && window.whiteboardHtmlForExport ? await window.whiteboardHtmlForExport(view) : { html: view.innerHTML, videos: 0 };
        return { html: mark(exportStrip(exported.html)).innerHTML, videos: exported.videos };
    }
    const box = exportStrip(renderLessonHTML(preprocessMarkdown(inlineLessonImages(tab.md, mod.images))));
    await renderExportMermaid(box);
    return { html: mark(box).innerHTML, videos: 0 };
}

// 차시 하나의 문서 본문. 탭이 여럿이면 탭 이름 띠를 붙이고, PDF에서는 탭마다 새 쪽으로 넘긴다
async function lessonExportBody(mod, tabIds, opts = {}) {
    const tabs = lessonTabSources(mod, tabIds);
    const sections = [];
    let videos = 0;
    for (const tab of tabs) {
        const out = await lessonTabHtml(mod, tab, opts);
        videos += out.videos;
        const label = tabs.length > 1 ? `<div class="lesson-tab-label">${exportEscape(tab.label)}</div>` : '';
        sections.push(`<section class="lesson-tab">${label}${out.html}</section>`);
    }
    return { html: sections.join('\n'), tabs: tabs.length, videos };
}

/* ---------- 내려받기·인쇄 ---------- */
// 내려받은 파일 크기(바이트)를 돌려준다
function downloadTextFile(text, fileName, type) {
    const blob = new Blob([text], { type });
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
    const body = await lessonExportBody(mod, null, { mark: { index: 0, shown } });
    if (!body.tabs) return null;
    return lessonHtmlDocument(mod.title || '교안', body.html, '', lessonSourceScript(lessonSourcePayload([mod], { shown: [shown] })));
};

Object.assign(window, { lessonTabSources, inlineLessonImages, lessonHtmlDocument, printHtmlDocument, downloadTextFile, markShownImages });
