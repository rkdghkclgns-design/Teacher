// course-refs.js - 참고 자료 읽기 보조: 이미지·스캔 PDF 글자 판독, 텍스트 인코딩, PPTX 발표자 노트
// develocket-slide(assets/course-refs.js, course-ai-tb.js @3a7303f)의 판독을 옮겼다.
// 파일 읽기(extractTextFromFile, ui.js)가 쓰고, 참고자료 탭(api.js importReferenceFiles)과 차시 첨부가 부른다.

const REF_TRANSCRIBE_BATCH = 4;
const REF_SCAN_MAX_PAGES = 30;
const REF_SCAN_SCALE = 1.5;
const REF_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const REF_TEXT_BYTES_PER_CHAR = 4; // UTF-8 한 글자의 최대 바이트(앞부분만 읽을 때 넉넉히)
const REF_IMAGE_SEND_BYTES = 4 * 1024 * 1024; // 이보다 큰 그림은 줄여서 AI에 보낸다(요청 한 번의 크기 한도)
const REF_IMAGE_SEND_SIDE = 2400; // 줄인 그림의 긴 변(글자를 읽기에 넉넉하다)

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

// 잘린 끝에 걸린 UTF-8 글자 조각을 뗀다(그대로 두면 깨진 글로 보고 CP949로 다시 읽는다)
function trimUtf8Tail(bytes) {
    let back = 0;
    while (back < 3 && back < bytes.length && (bytes[bytes.length - 1 - back] & 0xc0) === 0x80) back++;
    const lead = bytes.length - 1 - back;
    if (lead < 0) return bytes;
    const first = bytes[lead];
    const size = first >= 0xf0 ? 4 : first >= 0xe0 ? 3 : first >= 0xc0 ? 2 : 1;
    return size > back + 1 ? bytes.subarray(0, lead) : bytes;
}

// 글 파일의 앞부분(넣을 글자 수만큼)만 읽는다. 수백 MB 파일도 파일 전체를 메모리에 올리지 않는다
async function readTextPrefix(file, maxChars = Infinity) {
    const limit = Number.isFinite(maxChars) ? Math.min(file.size, Math.max(0, maxChars) * REF_TEXT_BYTES_PER_CHAR) : file.size;
    const bytes = new Uint8Array(await file.slice(0, limit).arrayBuffer());
    return limit < file.size ? trimUtf8Tail(bytes) : bytes;
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

// AI에 보낼 그림. 큰 그림은 긴 변을 줄여 JPEG로 보낸다(그대로 보내면 요청 크기 한도에 걸린다)
async function referenceImageDataUrl(file) {
    if (file.size <= REF_IMAGE_SEND_BYTES || typeof createImageBitmap !== 'function') return readFileAsDataUrl(file);
    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, REF_IMAGE_SEND_SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.85);
    } finally {
        bitmap.close?.();
    }
}

async function transcribeImageFile(file) {
    const [text] = await transcribeImages([dataUrlToInline(await referenceImageDataUrl(file))]);
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
