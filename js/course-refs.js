// course-refs.js - 참고 자료 읽기 보조: 이미지·스캔 PDF 글자 판독, 쪽 범위 선택, 인코딩, 전달 분량, 추출 글자 보기
// develocket-slide(assets/course-refs.js, course-ai-tb.js @3a7303f)의 판독과 쪽 범위 선택을 옮겼다.

const REF_TRANSCRIBE_BATCH = 4;
const REF_SCAN_MAX_PAGES = 30;
const REF_SCAN_SCALE = 1.5;
const REF_MAX_PAGE = 1000;
const REF_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const REF_PAGE_LABEL = /^\[(?:p\.|Slide\s*)(\d+)\]/;
const REF_PAGE_SPLIT = /\n\n(?=\[(?:p\.|Slide\s*)\d+\])/;
// 일괄 생성이 AI에 보내는 참고 자료 글자 수. 앞에서부터 잘라 보낸다.
const REF_OUTLINE_CHARS = 3000;
const REF_LESSON_CHARS = 2000;

function dataUrlToInline(dataUrl) {
    const [head, data] = String(dataUrl).split(',');
    return { mimeType: (head.match(/data:([^;]+)/) || [])[1] || 'image/png', data };
}

// UTF-8로 읽고, 깨지면 CP949로 다시 읽는다. 한글 윈도우 메모장의 ANSI 저장 파일이 여기에 해당한다.
function decodeTextBuffer(buffer) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (err) {
        return new TextDecoder('euc-kr').decode(buffer);
    }
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
    return String(content).split(REF_PAGE_SPLIT)
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

/* ---------- 전달 분량 ---------- */
// 잘리는 분량을 미리 보여 준다. 잘린 뒷부분은 AI가 보지 못한다.
function refBudget(total) {
    const share = limit => (total ? Math.round(Math.min(total, limit) / total * 100) : 100);
    return { total, outline: Math.min(total, REF_OUTLINE_CHARS), lesson: Math.min(total, REF_LESSON_CHARS), outlineShare: share(REF_OUTLINE_CHARS), lessonShare: share(REF_LESSON_CHARS), cut: total > REF_LESSON_CHARS };
}

function refMeterHtml(budget) {
    const count = number => number.toLocaleString();
    const text = budget.cut
        ? `추출한 ${count(budget.total)}자 가운데 AI에 보내는 분량: 목차 설계 ${count(budget.outline)}자(${budget.outlineShare}%), 차시마다 ${count(budget.lesson)}자(${budget.lessonShare}%). 앞부분만 보내므로 쪽 범위로 필요한 부분을 골라주세요.`
        : `추출한 ${count(budget.total)}자를 모두 AI에 보냅니다.`;
    return `
        <div class="h-1 rounded bg-white/10 overflow-hidden"><div class="h-full ${budget.cut ? 'bg-amber-400' : 'bg-emerald-400'}" style="width:${budget.lessonShare}%"></div></div>
        <p class="mt-1 text-[0.6rem] ${budget.cut ? 'text-amber-300' : 'text-textMuted'}">${text}</p>`;
}

function renderRefMeter() {
    const meter = document.getElementById('batch-ref-meter');
    if (!meter) return;
    meter.innerHTML = batchUploadedFileContent ? refMeterHtml(refBudget(cleanForAPI(batchUploadedFileContent).length)) : '';
}

/* ---------- 파일별 추출 글자 보기 ---------- */
// 쪽 범위에 든 블록을 표시한다. 범위가 없거나 맞는 쪽이 없으면 전체가 쓰인다.
function refContentBlocks(content, rangeText) {
    const pages = parsePageRange(rangeText);
    const useAll = !pages.size || !selectPages(content, pages);
    return String(content).split(REF_PAGE_SPLIT).map(text => ({
        text, included: useAll || pages.has(Number((text.match(REF_PAGE_LABEL) || [])[1]))
    }));
}

function batchFileToolsHtml(file, index) {
    if (file.status !== 'ok') return '';
    const range = hasPageLabels(file.content) ? `<input value="${escapeHtml(file.pageRange || '')}" onchange="setBatchFileRange(${index}, this.value)" placeholder="쪽 범위 (예: 1-5, 9)" class="mt-1 w-32 px-1.5 py-0.5 text-[0.6rem] bg-black/30 border border-white/10 rounded text-white">` : '';
    return `${range}<button type="button" onclick="viewBatchFile(${index})" class="ml-1 text-[0.6rem] underline text-textMuted hover:text-white">글자 보기</button>`;
}

window.viewBatchFile = function (index) {
    const file = batchUploadedFiles[index];
    if (!file || document.getElementById('ref-view-dialog')) return;
    const blocks = refContentBlocks(file.content, file.pageRange).map(block => `
        <pre class="whitespace-pre-wrap text-[0.65rem] text-textLight p-2 rounded border ${block.included ? 'border-accent/60' : 'border-white/10 opacity-50'}">${escapeHtml(block.text || '(글자 없음)')}</pre>`).join('');
    const overlay = document.createElement('div');
    overlay.id = 'ref-view-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[640px] max-h-[84vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10 flex items-start gap-2">
                <div class="min-w-0"><h2 class="text-sm font-bold text-textLight truncate">${escapeHtml(file.name)}</h2>
                    <p class="text-[0.65rem] text-textMuted mt-1">뽑아낸 글자 ${String(file.content || '').length.toLocaleString()}자입니다. 쓰는 범위는 파란 테두리로 표시합니다. 잘못 읽힌 곳이 많으면 다른 형식으로 올려주세요.</p></div>
                <button data-ref-view-close class="ml-auto px-3 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20">닫기</button>
            </div>
            <div class="flex-1 overflow-y-auto p-4 space-y-2">${blocks}</div>
        </div>`;
    overlay.addEventListener('click', event => {
        if (event.target === overlay || event.target.dataset?.refViewClose !== undefined) overlay.remove();
    });
    document.body.appendChild(overlay);
};
