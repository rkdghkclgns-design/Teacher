// course-art.js - 텍스트 모델이 SVG로 그리는 교재 삽화와 과정 공용 아트 스타일 가이드
// develocket-slide(assets/course-art.js, course-ai-tb.js @3a7303f)의 스타일 가이드·SVG 정리·팔레트 맞춤을 옮겼다.
// 내보내기가 비트맵을 전제로 하므로 SVG는 PNG로 바꿔 돌려준다. 이미지 모델 키가 없어도 삽화를 만들 수 있다.

const SVG_RENDER_WIDTH = 1280;
const SVG_RENDER_HEIGHT = 720;
const SVG_MAX_CHARS = 300000;
const SVG_ANCHOR_CHARS = 14000;
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
    anchorSvg: null
};
const ART_COLOR = /(fill|stroke|stop-color|color)\s*([:=])\s*(["']?)\s*(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|[a-zA-Z]+)/g;
const ART_COLOR_SKIP = /^(none|transparent|currentColor|inherit|url)$/i;
const ART_UNSAFE_VALUE = /url\(\s*(?!['"]?\s*#)|@import|javascript:/i;
const ART_UNSAFE_NODES = "script,style,foreignObject,image,iframe,a,use[href^='http'],animate,set";

const courseArt = () => ({ ...ART_DEFAULT, ...(globalState.courseArt || {}) });

function usesSvgIllustration() {
    return IMAGE_MODEL === SVG_IMAGE_MODEL || (!apiKey && textModelHasKey());
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

// 비율이 달라도 찌그러지지 않게 바탕색 여백을 두고 16:9 화면에 맞춘다
function svgToPng(svg, background) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = SVG_RENDER_WIDTH;
            canvas.height = SVG_RENDER_HEIGHT;
            const context = canvas.getContext('2d');
            const scale = Math.min(SVG_RENDER_WIDTH / image.naturalWidth, SVG_RENDER_HEIGHT / image.naturalHeight);
            const width = image.naturalWidth * scale;
            const height = image.naturalHeight * scale;
            context.fillStyle = background;
            context.fillRect(0, 0, SVG_RENDER_WIDTH, SVG_RENDER_HEIGHT);
            context.drawImage(image, (SVG_RENDER_WIDTH - width) / 2, (SVG_RENDER_HEIGHT - height) / 2, width, height);
            resolve(canvas.toDataURL('image/png'));
        };
        image.onerror = () => reject(new Error('SVG를 그림으로 바꾸지 못했습니다.'));
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
}

/* ---------- 생성 ---------- */
function buildSvgPrompt(art, description) {
    return [
        '교육용 교재 삽화를 SVG 코드로 그립니다. 같은 교재의 모든 삽화가 한 사람이 그린 것처럼 보이도록 아래 스타일 가이드를 엄격히 지킵니다.', '',
        `[스타일 가이드: ${art.name}]`,
        `- 사용 가능한 색(이 목록의 hex만 사용, 그 밖의 색·투명도 변형 금지): ${art.palette.map(option => `${option.role} ${option.hex}`).join(', ')}`,
        `- 윤곽선: 모든 stroke-width="${art.stroke}", stroke는 윤곽선 색, stroke-linecap/linejoin="round"`,
        `- 모서리: ${art.corner}`, `- 채색: ${art.shading}`, `- 글자: ${art.text}`, `- 그림 규칙: ${art.rules}`,
        art.anchorSvg ? `\n[기준 삽화 SVG — 이 그림과 같은 화풍·도형 문법·선·여백감을 유지]\n${art.anchorSvg.slice(0, SVG_ANCHOR_CHARS)}\n` : '',
        '[기술 조건]',
        '- <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"> 하나.',
        '- 바탕은 첫 요소로 바탕색 rect 하나.',
        '- <script>, <image>, <foreignObject>, 외부 링크, filter, 그라디언트, opacity 사용 금지.',
        '- 색은 fill/stroke 속성에 hex로 직접 쓴다(style 속성·class 금지).',
        '- 전체 20KB 이하, 도형 수는 필요한 만큼만.', '',
        `[그릴 내용]\n${description}`, '',
        '[출력] SVG 코드만 출력합니다. 설명·코드펜스 없이 <svg로 시작해 </svg>로 끝냅니다.'
    ].filter(line => line !== null).join('\n');
}

// 기준 삽화가 없으면 처음 그린 삽화를 기준으로 삼아 과정 전체의 화풍을 맞춘다
async function drawSvgIllustration(description) {
    const art = courseArt();
    const data = await callGemini(TEXT_MODEL, {
        contents: [{ role: 'user', parts: [{ text: buildSvgPrompt(art, description) }] }],
        systemInstruction: { parts: [{ text: '교재 삽화가로서 지정된 SVG 코드만 출력합니다.' }] }
    });
    const { svg, replaced } = snapSvgPalette(sanitizeSvg(extractText(data)), art.palette);
    if (replaced) console.warn(`[SVG 삽화] 팔레트 밖 색 ${replaced}곳을 맞췄습니다.`);
    const png = await svgToPng(svg, art.palette.find(option => option.role === '바탕')?.hex || '#FFFFFF');
    if (!art.anchorSvg) globalState.courseArt = { ...(globalState.courseArt || {}), anchorSvg: svg };
    return png;
}

// generateImageAPI와 같은 계약: 성공하면 data URL, 실패하면 null
async function generateSvgIllustration(description) {
    try {
        return await drawSvgIllustration(description);
    } catch (err) {
        console.error('[SVG 삽화] 생성 실패:', err);
        window.showToast?.(`SVG 삽화 생성 실패: ${err.message}`, 'warning');
        return null;
    }
}

/* ---------- 스타일 가이드 편집 ---------- */
function artDialogHtml(art) {
    const field = 'w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white focus:outline-none focus:border-accent';
    const colors = art.palette.map((option, index) => `
        <label class="text-[0.6rem] text-textMuted text-center">${escapeHtml(option.role)}<input type="color" data-art-color="${index}" value="${escapeHtml(option.hex.toLowerCase())}" class="block w-full h-7 mt-1 bg-transparent"></label>`).join('');
    return `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[520px] shadow-2xl">
            <div class="p-4 border-b border-white/10">
                <h2 class="text-sm font-bold text-textLight">삽화 스타일 가이드</h2>
                <p class="text-[0.65rem] text-textMuted mt-1">과정 전체의 SVG 삽화가 같은 화풍을 쓰도록 합니다. 팔레트 밖 색은 자동으로 맞춥니다.</p>
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-7 gap-1">${colors}</div>
                <label class="block text-[0.65rem] text-textMuted">선 굵기<input id="art-stroke" type="number" min="1" max="8" step="0.5" value="${art.stroke}" class="${field} mt-1"></label>
                <label class="block text-[0.65rem] text-textMuted">그림 규칙<textarea id="art-rules" rows="3" class="${field} mt-1">${escapeHtml(art.rules)}</textarea></label>
                <p class="text-[0.65rem] text-textMuted">기준 삽화: ${art.anchorSvg ? '설정됨 (처음 그린 삽화)' : '없음 (처음 그린 삽화가 기준이 됩니다)'}</p>
            </div>
            <div class="p-3 border-t border-white/10 flex justify-between gap-2">
                <button data-art-action="reset-anchor" class="px-3 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">기준 삽화 초기화</button>
                <div class="flex gap-2">
                    <button data-art-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
                    <button data-art-action="save" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">저장</button>
                </div>
            </div>
        </div>`;
}

window.openArtStyle = function () {
    if (document.getElementById('art-style-dialog')) return;
    const overlay = document.createElement('div');
    overlay.id = 'art-style-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9100]';
    overlay.innerHTML = artDialogHtml(courseArt());
    overlay.addEventListener('click', onArtClick);
    document.body.appendChild(overlay);
};

async function onArtClick(event) {
    const action = event.target.dataset?.artAction;
    const dialog = document.getElementById('art-style-dialog');
    if (!action || !dialog) return;
    if (action === 'reset-anchor') {
        globalState.courseArt = { ...(globalState.courseArt || {}), anchorSvg: null };
        await saveState();
        window.showToast?.('기준 삽화를 초기화했습니다.', 'success');
    }
    if (action === 'save') {
        const art = courseArt();
        const palette = art.palette.map((option, index) => ({ ...option, hex: dialog.querySelector(`[data-art-color="${index}"]`).value }));
        globalState.courseArt = { ...(globalState.courseArt || {}), palette, stroke: Number(document.getElementById('art-stroke').value) || ART_DEFAULT.stroke, rules: document.getElementById('art-rules').value.trim() || ART_DEFAULT.rules };
        await saveState();
    }
    dialog.remove();
}
