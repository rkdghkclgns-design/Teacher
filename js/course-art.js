// course-art.js - 텍스트 모델이 SVG로 그리는 교재 삽화와 과정 공용 아트 스타일 가이드
// develocket-slide(assets/course-art.js, course-ai-tb.js @3a7303f)의 스타일 가이드·SVG 정리·팔레트 맞춤을 옮겼다.
// 내보내기가 비트맵을 전제로 하므로 SVG는 PNG로 바꿔 돌려준다. 이미지 모델 키가 없어도 삽화를 만들 수 있다.

const SVG_RENDER_WIDTH = 1280;
const SVG_RENDER_HEIGHT = 720;
const SVG_MAX_CHARS = 300000;
const SVG_ANCHOR_CHARS = 14000;
const SVG_REVISE_CHARS = 16000;
const ART_MAX_PALETTE = 8;
const ART_MIN_STROKE = 1;
const ART_MAX_STROKE = 8;
const ART_STROKE_TOLERANCE = 0.6;
const ART_KINDS = ['개념도', '장면 삽화', '화면 예시(추상화)', '아이콘'];
const ART_RATIOS = [{ value: '640 360', label: '16:9' }, { value: '640 480', label: '4:3' }, { value: '480 480', label: '1:1' }];
const ART_DEFAULT = {
    name: '기본 교재 스타일',
    palette: [
        { role: '윤곽선', hex: '#1E2A3A' }, { role: '주색', hex: '#3D5FC4' }, { role: '보조색', hex: '#9DB8EA' }, { role: '강조색', hex: '#F2A93B' },
        { role: '바탕', hex: '#F6F4EE' }, { role: '그림자', hex: '#D9D4C7' }, { role: '흰색', hex: '#FFFFFF' }
    ],
    stroke: 2.5,
    corner: '둥근 모서리(rx 8~12)',
    shading: '평면 채색, 그라디언트·필터 없음, 그림자는 그림자 색 도형 하나로만',
    text: '이미지 안에 글자를 넣지 않는다(설명은 캡션이 담당)',
    rules: '굵기가 같은 윤곽선, 단순화한 기하 도형 위주, 사람은 얼굴 이목구비 없이 둥근 머리와 몸통으로만, 화면 요소는 박스와 막대로 추상화',
    anchorId: null,
    anchorSvg: null
};
const ART_COLOR = /(fill|stroke|stop-color|color)\s*([:=])\s*(["']?)\s*(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|[a-zA-Z]+)/g;
const ART_COLOR_SKIP = /^(none|transparent|currentColor|inherit|url)$/i;
const ART_UNSAFE_VALUE = /url\(\s*(?!['"]?\s*#)|@import|javascript:/i;
const ART_UNSAFE_NODES = "script,style,foreignObject,image,iframe,a,use[href^='http'],animate,set";

let _artDraft = null;

// 색 계산은 팔레트가 하나 이상 있다고 전제하므로, 저장값이 비어 있으면 기본 팔레트를 쓴다
function courseArt() {
    const stored = globalState.courseArt || {};
    return { ...ART_DEFAULT, ...stored, palette: stored.palette?.length ? stored.palette : ART_DEFAULT.palette };
}

function usesSvgIllustration() {
    if (IMAGE_MODEL === SVG_IMAGE_MODEL) return true;
    // Higgsfield를 골랐고 설정했으면 Gemini 키가 없어도 그림 모델로 그린다
    if (isHiggsfieldModel(IMAGE_MODEL) && typeof higgsfieldReady === 'function' && higgsfieldReady()) return false;
    return !apiKey && textModelHasKey();
}

/* ---------- SVG 정리·팔레트 ---------- */
function stripUnsafeAttributes(element) {
    Array.from(element.attributes).forEach(attribute => {
        const name = attribute.name.toLowerCase();
        const isLink = name === 'href' || name === 'xlink:href';
        if (name.startsWith('on') || (isLink && !attribute.value.startsWith('#')) || ART_UNSAFE_VALUE.test(attribute.value)) element.removeAttribute(attribute.name);
    });
    Array.from(element.children).forEach(stripUnsafeAttributes);
}

function normalizeSvgBox(root) {
    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const declared = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const valid = declared.length === 4 && !declared.some(Number.isNaN) && declared[2] > 0 && declared[3] > 0;
    const size = (name, fallback) => (/^\d+(?:\.\d+)?(?:px)?$/.test(root.getAttribute(name) || '') ? parseFloat(root.getAttribute(name)) : fallback);
    const box = valid ? declared : [0, 0, size('width', 640), size('height', 360)];
    root.setAttribute('viewBox', box.join(' '));
    root.setAttribute('width', box[2]);
    root.setAttribute('height', box[3]);
}

// AI가 만든 SVG는 그대로 쓰지 않는다. 스크립트·외부 자원을 지워 안전한 그림만 남긴다.
function sanitizeSvg(raw) {
    const found = String(raw || '').match(/<svg[\s\S]*<\/svg>/i);
    if (!found) throw new Error('SVG 코드를 찾지 못했습니다. 다시 생성해주세요.');
    const doc = new DOMParser().parseFromString(found[0], 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('SVG 형식이 올바르지 않습니다. 다시 생성해주세요.');
    const root = doc.documentElement;
    root.querySelectorAll(ART_UNSAFE_NODES).forEach(node => node.remove());
    stripUnsafeAttributes(root);
    normalizeSvgBox(root);
    const svg = new XMLSerializer().serializeToString(root);
    if (svg.length > SVG_MAX_CHARS) throw new Error('SVG가 너무 큽니다. 더 단순하게 다시 생성해주세요.');
    return svg;
}

function colorToHex(color) {
    const value = String(color).trim();
    if (/^#[0-9a-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map(c => c + c).join('')}`.toLowerCase();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
    if (/^#[0-9a-f]{8}$/i.test(value)) return value.slice(0, 7).toLowerCase();
    const context = document.createElement('canvas').getContext?.('2d');
    if (!context) return null;
    context.fillStyle = '#010203';
    context.fillStyle = value;
    return context.fillStyle === '#010203' || !context.fillStyle.startsWith('#') ? null : context.fillStyle.toLowerCase();
}

const hexChannels = hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));

function nearestPaletteColor(hex, palette) {
    const [red, green, blue] = hexChannels(hex);
    const distance = option => {
        const [r, g, b] = hexChannels(option.hex.toLowerCase());
        return (red - r) ** 2 * 0.3 + (green - g) ** 2 * 0.59 + (blue - b) ** 2 * 0.11;
    };
    return palette.reduce((best, option) => (distance(option) < distance(best) ? option : best)).hex;
}

// 팔레트 밖 색을 가장 가까운 팔레트 색으로 맞추고 어긋난 색 수를 함께 돌려준다
function snapSvgPalette(svg, palette) {
    const allowed = new Set(palette.map(option => option.hex.toLowerCase()));
    let replaced = 0;
    // 태그 안의 속성만 고친다. 글자 내용은 건드리지 않는다.
    const snapped = String(svg).replace(/<[^>]+>/g, tag => tag.replace(ART_COLOR, (all, property, operator, quote, value) => {
        if (ART_COLOR_SKIP.test(value)) return all;
        const hex = colorToHex(value);
        if (!hex || allowed.has(hex)) return all;
        replaced += 1;
        return `${property}${operator}${quote}${nearestPaletteColor(hex, palette)}`;
    }));
    return { svg: snapped, replaced };
}

// 팔레트 밖 색과 가이드와 다른 선 굵기를 찾는다. 글자 내용은 맞출 때처럼 검사에서도 뺀다.
function svgStyleCheck(svg, art) {
    const allowed = new Set(art.palette.map(option => option.hex.toLowerCase()));
    const tags = String(svg).match(/<[^>]+>/g) || [];
    const colors = tags.flatMap(tag => [...tag.matchAll(ART_COLOR)].map(match => match[4])).filter(value => !ART_COLOR_SKIP.test(value));
    const bad = [...new Set(colors.filter(value => {
        const hex = colorToHex(value);
        return hex && !allowed.has(hex);
    }))];
    const strokes = [...new Set(tags.flatMap(tag => [...tag.matchAll(/stroke-width\s*[:=]\s*["']?\s*([\d.]+)/g)].map(match => Number(match[1]))))];
    const strokeOk = strokes.every(width => width === 0 || Math.abs(width - Number(art.stroke)) <= ART_STROKE_TOLERANCE);
    return { bad, strokes, strokeOk };
}

function ratioRenderSize(ratio) {
    const [width, height] = String(ratio).split(/\s+/).map(Number);
    return width > 0 && height > 0 ? { width: SVG_RENDER_WIDTH, height: Math.round(SVG_RENDER_WIDTH * height / width) } : { width: SVG_RENDER_WIDTH, height: SVG_RENDER_HEIGHT };
}

// 비율이 달라도 찌그러지지 않게 바탕색 여백을 두고 지정한 크기에 맞춘다
function svgToPng(svg, background, size = { width: SVG_RENDER_WIDTH, height: SVG_RENDER_HEIGHT }) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size.width;
            canvas.height = size.height;
            const context = canvas.getContext('2d');
            const scale = Math.min(size.width / image.naturalWidth, size.height / image.naturalHeight);
            const width = image.naturalWidth * scale;
            const height = image.naturalHeight * scale;
            context.fillStyle = background;
            context.fillRect(0, 0, size.width, size.height);
            context.drawImage(image, (size.width - width) / 2, (size.height - height) / 2, width, height);
            resolve(canvas.toDataURL('image/png'));
        };
        image.onerror = () => reject(new Error('SVG를 그림으로 바꾸지 못했습니다.'));
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
}

/* ---------- 생성 ---------- */
function svgPromptRequest(description, { kind, context, revise }) {
    if (revise) return `[수정할 기존 SVG]\n${revise.svg.slice(0, SVG_REVISE_CHARS)}\n\n[수정 요청]\n${revise.instruction}`;
    return `[그릴 내용${kind ? ` — ${kind}` : ''}]\n${description}${context ? `\n\n[참고: 이 삽화가 들어갈 교안 부분]\n${context}` : ''}`;
}

function buildSvgPrompt(art, description, options = {}) {
    const anchor = art.anchorSvg && !options.revise ? art.anchorSvg : '';
    return [
        '교육용 교재 삽화를 SVG 코드로 그립니다. 같은 교재의 모든 삽화가 한 사람이 그린 것처럼 보이도록 아래 스타일 가이드를 엄격히 지킵니다.', '',
        `[스타일 가이드: ${art.name}]`,
        `- 사용 가능한 색(이 목록의 hex만 사용, 그 밖의 색·투명도 변형 금지): ${art.palette.map(option => `${option.role} ${option.hex}`).join(', ')}`,
        `- 윤곽선: 모든 stroke-width="${art.stroke}", stroke는 윤곽선 색, stroke-linecap/linejoin="round"`,
        `- 모서리: ${art.corner}`, `- 채색: ${art.shading}`, `- 글자: ${art.text}`, `- 그림 규칙: ${art.rules}`,
        anchor ? `\n[기준 삽화 SVG — 이 그림과 같은 화풍·도형 문법·선·여백감을 유지]\n${anchor.slice(0, SVG_ANCHOR_CHARS)}\n` : '',
        '[기술 조건]',
        `- <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${options.ratio || ART_RATIOS[0].value}"> 하나.`,
        '- 바탕은 첫 요소로 바탕색 rect 하나.',
        '- <script>, <image>, <foreignObject>, 외부 링크, filter, 그라디언트, opacity 사용 금지.',
        '- 색은 fill/stroke 속성에 hex로 직접 쓴다(style 속성·class 금지).',
        '- 전체 20KB 이하, 도형 수는 필요한 만큼만.', '',
        svgPromptRequest(description, options), '',
        '[출력] SVG 코드만 출력합니다. 설명·코드펜스 없이 <svg로 시작해 </svg>로 끝냅니다.'
    ].filter(line => line !== null).join('\n');
}

// opts.signal: 중지하면 그리던 호출을 끊는다 / opts.attempts: 보내는 최대 횟수(교안 그림 작업은 한 번만 다시)
async function requestSvg(prompt, { signal = null, attempts } = {}) {
    const data = await callGemini(TEXT_MODEL, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: '교재 삽화가로서 지정된 SVG 코드만 출력합니다.' }] },
        ...(signal ? { signal } : {}),
        ...(attempts ? { attempts } : {})
    });
    return sanitizeSvg(extractText(data));
}

// 삽화 대화상자용. 색을 자동으로 맞추지 않아 검사 결과를 사용자가 볼 수 있다.
function drawLessonSvg({ description, kind, ratio, context }) {
    return requestSvg(buildSvgPrompt(courseArt(), description, { kind, ratio, context }));
}

function reviseLessonSvg(svg, instruction) {
    const ratio = (String(svg).match(/viewBox="([^"]+)"/) || [])[1]?.trim().split(/\s+/).slice(2).join(' ');
    return requestSvg(buildSvgPrompt(courseArt(), '', { ratio, revise: { svg, instruction } }));
}

// 추출한 가이드는 역할 이름이 다를 수 있어, 바탕 역할이 없으면 가장 밝은 색을 쓴다
function artBackground(palette) {
    const named = palette.find(option => /바탕|배경/.test(option.role));
    if (named) return named.hex;
    const brightness = option => hexChannels(option.hex).reduce((sum, channel) => sum + channel, 0);
    return palette.reduce((best, option) => (brightness(option) > brightness(best) ? option : best)).hex;
}

// 기준 삽화가 없으면 처음 그린 삽화를 기준으로 삼아 과정 전체의 화풍을 맞춘다
async function drawSvgIllustration(description, opts = {}) {
    const art = courseArt();
    const { svg, replaced } = snapSvgPalette(await requestSvg(buildSvgPrompt(art, description), opts), art.palette);
    if (replaced) console.warn(`[SVG 삽화] 팔레트 밖 색 ${replaced}곳을 맞췄습니다.`);
    const png = await svgToPng(svg, artBackground(art.palette));
    if (!art.anchorSvg) globalState.courseArt = { ...(globalState.courseArt || {}), anchorSvg: svg };
    return png;
}

// generateImageAPI와 같은 계약: 성공하면 data URL, 실패하면 null. 중지하면 AbortError를 그대로 던진다
async function generateSvgIllustration(description, opts = {}) {
    try {
        return await drawSvgIllustration(description, opts);
    } catch (err) {
        if (err?.name === 'AbortError') throw err;
        window.markImageBlocked?.(SVG_IMAGE_MODEL, err); // 글 모델이 사용 한도·키 문제면 이번 작업의 그림을 멈춘다(api.js)
        console.error('[SVG 삽화] 생성 실패:', err);
        window.showToast?.(`SVG 삽화 생성 실패: ${err.message}`, 'warning');
        return null;
    }
}

/* ---------- 레퍼런스 이미지에서 스타일 추출 ---------- */
const ART_EXTRACT_PROMPT = '첨부한 이미지는 교재 삽화의 화풍 견본입니다. 이 화풍을 SVG 벡터 삽화로 재현할 수 있도록 스타일 가이드를 추출합니다.\nJSON 하나만 출력:\n{"name":"가이드 이름(짧게)","palette":[{"role":"윤곽선|주색|보조색|강조색|바탕|그림자 등","hex":"#RRGGBB"}],"stroke":2.5,"corner":"모서리 처리","shading":"채색 방식","text":"이미지 안 글자 처리","rules":"형태·인물·구도 규칙 2~3문장"}\npalette는 5~8색.';

function normalizeArtStyle(parsed) {
    const palette = (parsed?.palette || [])
        .filter(option => /^#[0-9a-f]{6}$/i.test(option?.hex))
        .map(option => ({ role: String(option.role || '색').slice(0, 10), hex: option.hex }))
        .slice(0, ART_MAX_PALETTE);
    if (!palette.length) throw new Error('이미지에서 팔레트를 찾지 못했습니다.');
    const text = (value, fallback) => String(value || '').trim() || fallback;
    return {
        name: text(parsed.name, '추출한 스타일'), palette, stroke: Math.min(ART_MAX_STROKE, Math.max(ART_MIN_STROKE, Number(parsed.stroke) || ART_DEFAULT.stroke)),
        corner: text(parsed.corner, ART_DEFAULT.corner), shading: text(parsed.shading, ART_DEFAULT.shading),
        text: text(parsed.text, ART_DEFAULT.text), rules: text(parsed.rules, ART_DEFAULT.rules)
    };
}

// 새 화풍이므로 이전 기준 삽화는 쓰지 않는다
async function extractArtStyle(file) {
    if (!textModelHasKey()) throw new Error('스타일 추출에는 AI 키가 필요합니다.');
    const data = await callGemini(TEXT_MODEL, {
        contents: [{ role: 'user', parts: [{ text: ART_EXTRACT_PROMPT }, { inlineData: dataUrlToInline(await readFileAsDataUrl(file)) }] }],
        systemInstruction: { parts: [{ text: '교재 삽화 아트 디렉터로서 지정된 JSON만 출력합니다.' }] },
        generationConfig: { responseMimeType: 'application/json' }
    });
    const style = normalizeArtStyle(safeJSONParse(extractText(data)));
    globalState.courseArt = { ...(globalState.courseArt || {}), ...style, anchorId: null, anchorSvg: null };
    return style;
}

/* ---------- 스타일 가이드 편집 ---------- */
// 대화상자는 초안을 고친다. 색을 넣고 빼도 입력칸 번호가 초안 배열과 항상 같도록 저장 시 화면을 다시 읽지 않는다.
const cloneArt = art => ({ ...art, palette: art.palette.map(option => ({ ...option })) });

function addPaletteColor(art) {
    if (art.palette.length >= ART_MAX_PALETTE) return art;
    return { ...art, palette: [...art.palette, { role: '색', hex: '#888888' }] };
}

// 색 계산에 쓰는 reduce는 빈 팔레트에서 실패하므로 마지막 색은 지우지 않는다
function removePaletteColor(art, index) {
    if (art.palette.length <= 1) return art;
    return { ...art, palette: art.palette.filter((_, i) => i !== index) };
}

function updatePaletteColor(art, index, patch) {
    return { ...art, palette: art.palette.map((option, i) => (i === index ? { ...option, ...patch } : option)) };
}

// 기준 삽화는 스타일이 아니라 사용자가 고른 견본이므로 유지한다
function resetArtDraft(art) {
    return { ...cloneArt(ART_DEFAULT), anchorId: art.anchorId, anchorSvg: art.anchorSvg };
}

function normalizeArtDraft(draft) {
    const palette = draft.palette.map(option => ({ role: String(option.role || '').trim().slice(0, 10) || '색', hex: colorToHex(option.hex) }));
    if (!palette.length) throw new Error('팔레트에 색이 하나 이상 있어야 합니다.');
    if (palette.some(option => !option.hex)) throw new Error('색 코드는 #RRGGBB 형식으로 입력해주세요.');
    const text = (value, fallback) => String(value || '').trim() || fallback;
    return {
        name: text(draft.name, ART_DEFAULT.name), palette: palette.slice(0, ART_MAX_PALETTE).map(option => ({ ...option, hex: option.hex.toUpperCase() })),
        stroke: Math.min(ART_MAX_STROKE, Math.max(ART_MIN_STROKE, Number(draft.stroke) || ART_DEFAULT.stroke)),
        corner: text(draft.corner, ART_DEFAULT.corner), shading: text(draft.shading, ART_DEFAULT.shading),
        text: text(draft.text, ART_DEFAULT.text), rules: text(draft.rules, ART_DEFAULT.rules)
    };
}

function artPaletteRows(art, field) {
    return art.palette.map((option, index) => `
        <div class="flex items-center gap-2">
            <input type="color" data-art-color="${index}" value="${escapeHtml((colorToHex(option.hex) || '#000000').toLowerCase())}" aria-label="색" class="w-8 h-7 bg-transparent shrink-0">
            <input data-art-role="${index}" value="${escapeHtml(option.role)}" aria-label="역할" class="${field}">
            <input data-art-hex="${index}" value="${escapeHtml(option.hex)}" aria-label="색 코드" class="${field} w-28 font-mono shrink-0">
            <button data-art-action="color-delete" data-index="${index}" ${art.palette.length <= 1 ? 'disabled' : ''} class="px-1 text-rose-300 disabled:opacity-30" title="색 삭제">✕</button>
        </div>`).join('');
}

function artDialogHtml(art) {
    const field = 'w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white focus:outline-none focus:border-accent';
    const label = 'block text-[0.6875rem] text-textMuted';
    const text = (name, title, value) => `<label class="${label}">${title}<input data-art-field="${name}" value="${escapeHtml(String(value))}" class="${field} mt-1"></label>`;
    return `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[560px] max-h-[88vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10">
                <h2 class="text-sm font-bold text-textLight">삽화 스타일 가이드</h2>
                <p class="text-xs text-textMuted mt-1">과정의 모든 삽화가 공유하는 기준입니다. 바꾸면 이후 생성하는 삽화부터 적용됩니다.</p>
            </div>
            <div class="flex-1 overflow-y-auto p-4 space-y-3">
                ${text('name', '가이드 이름', art.name)}
                <div class="space-y-1"><p class="${label}">팔레트 (역할 · 색 코드)</p>${artPaletteRows(art, field)}
                    <button data-art-action="color-add" ${art.palette.length >= ART_MAX_PALETTE ? 'disabled' : ''} class="text-xs underline text-textLight disabled:opacity-40">색 추가 (최대 ${ART_MAX_PALETTE}색)</button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <label class="${label}">선 굵기<input data-art-field="stroke" type="number" min="${ART_MIN_STROKE}" max="${ART_MAX_STROKE}" step="0.5" value="${escapeHtml(String(art.stroke))}" class="${field} mt-1"></label>
                    ${text('corner', '모서리', art.corner)}
                </div>
                ${text('shading', '채색', art.shading)}${text('text', '이미지 안 글자', art.text)}
                <label class="${label}">그림 규칙<textarea data-art-field="rules" rows="3" class="${field} mt-1">${escapeHtml(art.rules)}</textarea></label>
                <label class="${label}">레퍼런스 이미지에서 추출<input id="art-reference" type="file" accept="image/png,image/jpeg,image/webp" class="block w-full mt-1 text-xs text-textLight"></label>
                <p class="text-xs text-textMuted">기준 삽화: ${art.anchorSvg ? '설정됨' : '없음 (처음 그린 삽화가 기준이 됩니다)'}</p>
                <p id="art-status" class="text-xs text-accent min-h-[1em]"></p>
            </div>
            <div class="p-3 border-t border-white/10 flex justify-between gap-2">
                <div class="flex gap-2">
                    <button data-art-action="reset-style" class="px-3 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">기본 스타일로</button>
                    <button data-art-action="reset-anchor" class="px-3 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">기준 삽화 초기화</button>
                </div>
                <div class="flex gap-2">
                    <button data-art-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
                    <button data-art-action="save" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">저장</button>
                </div>
            </div>
        </div>`;
}

function renderArtDialog() {
    const dialog = document.getElementById('art-style-dialog');
    if (dialog) dialog.innerHTML = artDialogHtml(_artDraft);
}

window.openArtStyle = function () {
    if (document.getElementById('art-style-dialog')) return;
    _artDraft = cloneArt(courseArt());
    const overlay = document.createElement('div');
    overlay.id = 'art-style-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9100]';
    overlay.addEventListener('click', onArtClick);
    overlay.addEventListener('change', onArtChange);
    overlay.addEventListener('input', onArtInput);
    document.body.appendChild(overlay);
    renderArtDialog();
};

// 다시 그리지 않고 초안만 고친다. 색 선택기와 색 코드 칸은 서로 맞춰 준다.
function onArtInput(event) {
    const { value, dataset } = event.target;
    if (dataset?.artField) _artDraft = { ..._artDraft, [dataset.artField]: value };
    if (dataset?.artRole !== undefined) _artDraft = updatePaletteColor(_artDraft, Number(dataset.artRole), { role: value });
    if (dataset?.artColor !== undefined) {
        _artDraft = updatePaletteColor(_artDraft, Number(dataset.artColor), { hex: value.toUpperCase() });
        document.querySelector(`[data-art-hex="${dataset.artColor}"]`).value = value.toUpperCase();
    }
    if (dataset?.artHex !== undefined) {
        const hex = colorToHex(value);
        _artDraft = updatePaletteColor(_artDraft, Number(dataset.artHex), { hex: value.trim() });
        if (hex) document.querySelector(`[data-art-color="${dataset.artHex}"]`).value = hex;
    }
}

async function onArtChange(event) {
    const file = event.target.id === 'art-reference' ? event.target.files?.[0] : null;
    if (!file || !document.getElementById('art-style-dialog')) return;
    const status = document.getElementById('art-status');
    status.textContent = '이미지에서 스타일을 추출하고 있습니다...';
    try {
        await extractArtStyle(file);
        await saveState();
        _artDraft = cloneArt(courseArt());
        renderArtDialog();
    } catch (err) {
        console.error('[삽화 스타일] 추출 실패:', err);
        if (status.isConnected) status.textContent = `추출 실패: ${err.message}`;
    }
}

async function saveArtDraft() {
    try {
        globalState.courseArt = { ...(globalState.courseArt || {}), ...normalizeArtDraft(_artDraft) };
    } catch (err) {
        document.getElementById('art-status').textContent = err.message;
        return;
    }
    await saveState();
    closeArtDialog();
}

async function resetArtAnchor() {
    globalState.courseArt = { ...(globalState.courseArt || {}), anchorId: null, anchorSvg: null };
    _artDraft = { ..._artDraft, anchorId: null, anchorSvg: null };
    await saveState();
    renderArtDialog();
    window.showToast?.('기준 삽화를 초기화했습니다.', 'success');
}

function closeArtDialog() {
    document.getElementById('art-style-dialog')?.remove();
    _artDraft = null;
    renderLessonArt();
}

async function onArtClick(event) {
    const action = event.target.dataset?.artAction;
    if (!action || !document.getElementById('art-style-dialog')) return;
    if (action === 'save') return saveArtDraft();
    if (action === 'close') return closeArtDialog();
    if (action === 'reset-anchor') return resetArtAnchor();
    if (action === 'color-add') _artDraft = addPaletteColor(_artDraft);
    if (action === 'color-delete') _artDraft = removePaletteColor(_artDraft, Number(event.target.dataset.index));
    if (action === 'reset-style') _artDraft = resetArtDraft(_artDraft);
    renderArtDialog();
}
