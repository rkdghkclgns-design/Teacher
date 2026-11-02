// course-refs.js - 참고 자료 읽기 보조: 이미지·스캔 PDF 글자 판독, 쪽 범위 선택
// develocket-slide(assets/course-refs.js, course-ai-tb.js @3a7303f)의 판독과 쪽 범위 선택을 옮겼다.

const REF_TRANSCRIBE_BATCH = 4;
const REF_SCAN_MAX_PAGES = 30;
const REF_SCAN_SCALE = 1.5;
const REF_MAX_PAGE = 1000;
const REF_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const REF_PAGE_LABEL = /^\[(?:p\.|Slide\s*)(\d+)\]/;

function dataUrlToInline(dataUrl) {
    const [head, data] = String(dataUrl).split(',');
    return { mimeType: (head.match(/data:([^;]+)/) || [])[1] || 'image/png', data };
}

async function pdfPageToInline(pdf, pageNumber) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: REF_SCAN_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return dataUrlToInline(canvas.toDataURL('image/jpeg', 0.8));
}

function buildTranscribePrompt(count) {
    return `첨부한 이미지 ${count}장은 교육 자료(교안·슬라이드·교재)의 페이지입니다. 각 이미지에 있는 글자를 빠짐없이 그대로 옮겨 적습니다. 요약하거나 고치지 않습니다.\nJSON 배열 하나만 출력합니다. 이미지 순서대로 각 원소는 그 페이지의 글자(문자열)입니다.`;
}

async function transcribeBatch(images) {
    if (!textModelHasKey()) throw new Error('이미지의 글자를 읽으려면 AI 키가 필요합니다.');
    const data = await callGemini(TEXT_MODEL, {
        taskRole: 'fast',
        contents: [{ role: 'user', parts: [{ text: buildTranscribePrompt(images.length) }, ...images.map(inlineData => ({ inlineData }))] }],
        systemInstruction: { parts: [{ text: '문서의 글자를 그대로 옮겨 적는 판독 담당자로서 지정된 JSON만 출력합니다.' }] },
        generationConfig: { responseMimeType: 'application/json' }
    });
    const parsed = safeJSONParse(extractText(data));
    const texts = Array.isArray(parsed) ? parsed : [];
    if (texts.length !== images.length) console.warn(`[참고 자료] 판독 결과 ${texts.length}쪽, 요청 ${images.length}쪽`);
    // 쪽 번호가 밀리지 않도록 요청한 장수에 맞춘다
    return images.map((_, index) => String(texts[index] || '').trim());
}

// 한 번에 4장씩 보내 페이지 순서대로 글자를 모은다
async function transcribeImages(images) {
    const texts = [];
    for (let start = 0; start < images.length; start += REF_TRANSCRIBE_BATCH) {
        texts.push(...await transcribeBatch(images.slice(start, start + REF_TRANSCRIBE_BATCH)));
    }
    return texts;
}

async function transcribeImageFile(file) {
    const [text] = await transcribeImages([dataUrlToInline(await readFileAsDataUrl(file))]);
    if (!text) throw new Error('이미지에서 글자를 찾지 못했습니다.');
    return text;
}

// 글자 층이 없는 스캔 PDF는 쪽을 이미지로 바꿔 판독한다
async function transcribeScannedPdf(pdf) {
    const count = Math.min(pdf.numPages, REF_SCAN_MAX_PAGES);
    if (pdf.numPages > count) window.showToast?.(`스캔 PDF는 앞 ${count}쪽까지만 판독합니다. (전체 ${pdf.numPages}쪽)`, 'warning');
    const images = [];
    for (let pageNumber = 1; pageNumber <= count; pageNumber++) images.push(await pdfPageToInline(pdf, pageNumber));
    const texts = await transcribeImages(images);
    if (!texts.some(Boolean)) throw new Error('스캔 PDF에서 글자를 찾지 못했습니다.');
    return texts.map((text, index) => (text ? `[p.${index + 1}] ${text}` : '')).filter(Boolean).join('\n\n');
}

// 슬라이드에 연결된 발표자 노트를 읽는다. 슬라이드 번호만 있는 조각은 뺀다.
async function pptxSlideNotes(zip, slidePath) {
    const rels = zip.file(slidePath.replace('slides/', 'slides/_rels/') + '.rels');
    if (!rels) return '';
    const target = ((await rels.async('string')).match(/Target="([^"]*notesSlide[^"]*)"/) || [])[1];
    const note = target && zip.file(`ppt/${target.replace(/^(?:\.\.\/|\/ppt\/)+/, '')}`);
    if (!note) return '';
    const pieces = (await note.async('string')).match(/<a:t[^>]*>[\s\S]*?<\/a:t>/g) || [];
    return pieces
        .map(piece => piece.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim())
        .filter(text => text && !/^\d+$/.test(text))
        .join(' ');
}

/* ---------- 쪽 범위 ---------- */
// "1-5, 9" → 포함할 쪽 번호. 형식이 틀린 조각은 무시한다
function parsePageRange(text) {
    const pages = new Set();
    String(text || '').split(',').map(part => part.trim()).filter(Boolean).forEach(part => {
        const [, from, to] = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/) || [];
        if (!from) return;
        for (let page = Number(from); page <= Math.min(Number(to || from), REF_MAX_PAGE); page++) pages.add(page);
    });
    return pages;
}

function selectPages(content, pages) {
    return String(content).split(/\n\n(?=\[(?:p\.|Slide\s*)\d+\])/)
        .filter(block => pages.has(Number((block.match(REF_PAGE_LABEL) || [])[1])))
        .join('\n\n');
}

// 범위에 해당하는 쪽이 없으면 자료가 통째로 빠지지 않도록 전체를 쓴다
function filterPageRange(content, rangeText) {
    const pages = parsePageRange(rangeText);
    return (pages.size && selectPages(content, pages)) || content;
}

const hasPageLabels = content => REF_PAGE_LABEL.test(String(content || ''));

window.setBatchFileRange = function (index, value) {
    const file = { ...batchUploadedFiles[index], pageRange: value };
    batchUploadedFiles[index] = file;
    syncBatchLegacyVars();
    const pages = parsePageRange(value);
    if (value.trim() && (!pages.size || !selectPages(file.content, pages))) window.showToast?.('해당하는 쪽이 없어 전체 내용을 사용합니다.', 'warning');
};
