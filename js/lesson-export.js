// lesson-export.js - 교안을 화면과 같은 모양의 HTML·PDF로 내보낸다
// 화면 보기와 같은 순서(그림 치환 → preprocessMarkdown → renderLessonHTML)로 그리고, 화면과 같은 서식(인용 막대·번호 목록·링크)을 문서에 넣는다.
// 위쪽 내보내기 메뉴(현재 차시·현재 교과), ZIP(차시별 교안.html), 교수안 내려받기가 함께 쓴다. PDF는 브라우저 인쇄 창의 'PDF로 저장'으로 만든다.

const EXPORT_PRINT_WAIT = 800; // 인쇄 전에 글꼴·그림이 자리 잡을 시간
const EXPORT_FRAME_LIFETIME = 30 * 60 * 1000; // 인쇄가 끝났다는 신호(afterprint)가 오지 않는 브라우저에서 인쇄용 iframe을 지우는 시한
const EXPORT_CONTROLS = '[data-lesson-action], .image-regenerate-btn, .image-wrapper > span, .para-edit, button, textarea';

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
    img, video, table, pre, blockquote, .image-wrapper, .mermaid { break-inside: avoid; }
    pre { white-space: pre-wrap; }
}`;

const exportEscape = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const exportRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

// local:그림id를 저장된 그림으로 바꾸고, 없는 그림 자리는 비운다(화면 보기와 같은 규칙). img_1이 img_10을 건드리지 않게 id 끝을 확인한다
function inlineLessonImages(md, images) {
    const filled = Object.entries(images || {}).reduce(
        (text, [id, data]) => text.replace(new RegExp(`local:${exportRegExp(id)}(?![\\w-])`, 'g'), () => data),
        String(md || '')
    );
    return filled.replace(/src="local:[^"]+"/g, 'src="" alt="[이미지 생성 누락]"').replace(/\(local:[^)]+\)/g, '()');
}

// 완성된 HTML 문서. 서식은 문서 안에 넣어 파일 하나로 열린다.
// source: 다시 불러오기용 원본 태그(output-import.js lessonSourceScript). HTML로 내려받을 때만 넣는다
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
async function lessonTabHtml(mod, tab, opts) {
    const view = document.getElementById('render-view');
    const onScreen = opts.useView && view && view.children.length
        && tab.id === currentLessonTab && String(getEditingModule?.()?.id) === String(mod.id);
    if (onScreen) {
        const exported = opts.videos && window.whiteboardHtmlForExport ? await window.whiteboardHtmlForExport(view) : { html: view.innerHTML, videos: 0 };
        return { html: exportStrip(exported.html).innerHTML, videos: exported.videos };
    }
    const box = exportStrip(renderLessonHTML(preprocessMarkdown(inlineLessonImages(tab.md, mod.images))));
    await renderExportMermaid(box);
    return { html: box.innerHTML, videos: 0 };
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
function downloadTextFile(text, fileName, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
// format: 'html' | 'pdf'. tabIds: null이면 차시 전체(5개 탭), 아니면 그 탭만
window.exportLessonDocument = async function (mod, format, tabIds) {
    if (!mod) return window.showAlert('차시를 먼저 선택해주세요. (좌측 목록에서 차시 클릭)');
    try {
        window.showToast?.(format === 'pdf' ? '인쇄 창을 준비하는 중입니다. "PDF로 저장"을 고르세요.' : 'HTML 파일을 만드는 중입니다.', 'info');
        const body = await lessonExportBody(mod, tabIds, { useView: true, videos: format === 'html' });
        if (!body.tabs) return window.showAlert('내보낼 교안 내용이 없습니다.');
        if (format === 'pdf') return await printHtmlDocument(lessonHtmlDocument(mod.title || '교안', body.html));
        // HTML에는 원본(탭 글·그림·교수안)을 담아 '내보낸 교안 다시 불러오기'로 고칠 수 있게 한다
        const source = lessonSourceScript(lessonSourcePayload([mod], { tabIds, withGyosuan: !tabIds }));
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
        const articles = [];
        for (const mod of lessons) articles.push(`<article class="lesson-break">${(await lessonExportBody(mod, null)).html}</article>`);
        if (format === 'pdf') return await printHtmlDocument(lessonHtmlDocument(subj.title || '교과', articles.join('\n')));
        const source = lessonSourceScript(lessonSourcePayload(lessons));
        downloadTextFile(lessonHtmlDocument(subj.title || '교과', articles.join('\n'), '', source), `${safeFileName(subj.title || '교과')}_교안.html`, 'text/html;charset=utf-8');
    } catch (err) {
        console.error('[내보내기] 교과 문서 실패:', err);
        window.showAlert(`내보내기 중 오류가 났습니다: ${err.message}`);
    }
};

// ZIP에 넣을 차시 교안 HTML(5개 탭). 내용이 없으면 null
window.lessonHtmlForZip = async function (mod) {
    const body = await lessonExportBody(mod, null);
    return body.tabs ? lessonHtmlDocument(mod.title || '교안', body.html) : null;
};

Object.assign(window, { lessonTabSources, inlineLessonImages, lessonHtmlDocument, printHtmlDocument, downloadTextFile });
