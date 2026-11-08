// course-illustrations.js - 차시 삽화: 생성 폼, 아이디어, 수정 요청, 내려받기, 본문 배치
// develocket-slide(assets/course-art.js @3a7303f)의 삽화 탭을 Teacher의 차시 대화상자로 옮겼다.
// SVG 원본은 mod.illustrations에 두고 본문에는 PNG만 넣는다. 내보내기가 data:image/\w+;base64, 형식의 비트맵을 전제로 하기 때문이다.

const ILLUSTRATION_RASTER = /^data:image\/\w+;base64,/;
const ILLUSTRATION_TITLE_CHARS = 40;
const ILLUSTRATION_CONTEXT_CHARS = 800;
const ILLUSTRATION_IDEA_LESSON_CHARS = 4000;
const ILLUSTRATION_MAX_IDEAS = 3;
const ILLUSTRATION_PLACE_NONE = '';
const ILLUSTRATION_PLACE_END = 'end';
const ILLUSTRATION_PLAIN_SECTION = /학습\s*목표|체크리스트|요약|정리/;
const ILLUSTRATION_CAPTION_STYLE = 'margin-top:8px;text-align:center;font-size:0.85rem;color:#6b7280;font-style:italic;font-weight:500;letter-spacing:-0.01em;line-height:1.4;max-width:100%;';

let _lessonArt = null;

const lessonArtTabMd = (mod, tabId) => String(mod.tabContents?.[tabId] || '').replace(/\r\n/g, '\n');
const newLessonImageId = () => `img_${Date.now()}${Math.floor(Math.random() * 1000)}`;
const svgPreviewUrl = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/* ---------- 본문 배치 ---------- */
// 코드 블록 안의 ## 은 제목이 아니다
function lessonH2s(md) {
    const heads = [];
    let fence = 0;
    let offset = 0;
    md.split('\n').forEach(line => {
        const wasFenced = fence;
        fence = nextCodeFence(fence, line);
        if (!wasFenced && !fence && /^##\s+/.test(line)) heads.push({ title: line.replace(/^##\s+/, '').trim(), start: offset });
        offset += line.length + 1;
    });
    return heads;
}

function illustrationHtml(imgId, illustration) {
    const caption = illustration.caption ? `<div class="image-caption" style="${ILLUSTRATION_CAPTION_STYLE}">${escapeHtml(illustration.caption)}</div>` : '';
    return `<div class="image-wrapper"><img src="local:${imgId}" alt="${escapeHtml(illustration.caption || illustration.title)}" class="rounded-lg border-2 border-accent/30 shadow-md max-w-full">${caption}</div>`;
}

// 본문의 삽화 블록. 그림 id로 정규식을 만들지 않는다: 정해 둔 모양으로 블록을 찾고 그 블록의 id를 글자 그대로 견준다(이상한 id로 깨지거나 멈추지 않게)
const ILLUSTRATION_BLOCKS = /<div class="image-wrapper"><img src="local:([^"]*)"[^>]*>(?:<div class="image-caption"[^>]*>[\s\S]*?<\/div>)?<\/div>/g;

// 그 그림 id의 첫 삽화 블록 자리 { start, end }. 없으면 null
function findIllustrationBlock(md, imgId) {
    const target = String(imgId);
    for (const match of String(md).matchAll(ILLUSTRATION_BLOCKS)) {
        if (match[1] === target) return { start: match.index, end: match.index + match[0].length };
    }
    return null;
}

// 섹션 끝이나 문서 끝에 넣는다. 본문은 공백 외에는 바꾸지 않는다.
function insertIllustrationMd(md, html, placement) {
    const heads = lessonH2s(md);
    const index = Number(placement);
    const position = placement === ILLUSTRATION_PLACE_END || !heads[index] ? md.length : (heads[index + 1]?.start ?? md.length);
    return `${[md.slice(0, position).trimEnd(), html, md.slice(position).trimStart()].filter(Boolean).join('\n\n')}\n`;
}

// 블록과 그 앞뒤 빈 줄을 빈 줄 하나로 바꾼다
function removeIllustrationMd(md, imgId) {
    const found = findIllustrationBlock(md, imgId);
    if (!found) return md.trimStart();
    let { start, end } = found;
    while (start > 0 && md[start - 1] === '\n') start -= 1;
    while (end < md.length && md[end] === '\n') end += 1;
    return `${md.slice(0, start)}\n\n${md.slice(end)}`.trimStart();
}

function illustrationTab(mod, imgId) {
    return imgId ? Object.keys(mod.tabContents || {}).find(tabId => mod.tabContents[tabId]?.includes(`local:${imgId}`)) : undefined;
}

// 사용자가 본문에서 이미지를 지웠을 수 있으므로 기록이 아니라 본문을 보고 위치를 찾는다
function illustrationPlacement(mod, illustration, tabId) {
    const found = illustrationTab(mod, illustration.imgId);
    if (!found) return ILLUSTRATION_PLACE_NONE;
    if (found !== tabId) return `tab:${found}`;
    const md = lessonArtTabMd(mod, tabId);
    const position = md.indexOf(`local:${illustration.imgId}`);
    const index = lessonH2s(md).filter(head => head.start < position).length - 1;
    return index < 0 ? ILLUSTRATION_PLACE_END : String(index);
}

async function illustrationPng(illustration) {
    const png = await svgToPng(illustration.svg, artBackground(courseArt().palette), ratioRenderSize(illustration.ratio));
    if (!ILLUSTRATION_RASTER.test(png)) throw new Error('삽화를 비트맵으로 바꾸지 못했습니다.');
    return png;
}

function updateIllustration(mod, id, patch) {
    mod.illustrations = (mod.illustrations || []).map(item => (item.id === id ? { ...item, ...patch } : item));
    return mod.illustrations.find(item => item.id === id);
}

function takeOutIllustration(mod, illustration) {
    const tabId = illustrationTab(mod, illustration.imgId);
    if (!tabId) return;
    mod.tabContents = { ...mod.tabContents, [tabId]: removeIllustrationMd(lessonArtTabMd(mod, tabId), illustration.imgId) };
}

// 같은 이미지 ID를 다시 쓰므로 옮겨도 mod.images는 한 장만 남는다
async function placeIllustration(mod, id, tabId, placement) {
    const illustration = mod.illustrations.find(item => item.id === id);
    takeOutIllustration(mod, illustration);
    const images = withoutKey(mod.images, illustration.imgId);
    if (placement === ILLUSTRATION_PLACE_NONE) {
        mod.images = images;
        return updateIllustration(mod, id, { imgId: null });
    }
    const imgId = illustration.imgId || newLessonImageId();
    mod.images = { ...images, [imgId]: await illustrationPng(illustration) };
    mod.tabContents = { ...mod.tabContents, [tabId]: insertIllustrationMd(lessonArtTabMd(mod, tabId), illustrationHtml(imgId, illustration), placement) };
    return updateIllustration(mod, id, { imgId });
}

// 본문에 들어간 그림이 있으면 함께 갱신한다. 비율은 SVG를 그릴 때 정해져 바뀌지 않는다.
async function refreshPlacedIllustration(mod, illustration) {
    if (!illustrationTab(mod, illustration.imgId)) return;
    mod.images = { ...mod.images, [illustration.imgId]: await illustrationPng(illustration) };
}

function replaceIllustrationCaption(mod, illustration) {
    const tabId = illustrationTab(mod, illustration.imgId);
    if (!tabId) return;
    // 글을 잘라 붙인다(캡션의 $ 기호가 치환 패턴으로 읽히지 않는다)
    const md = lessonArtTabMd(mod, tabId);
    const found = findIllustrationBlock(md, illustration.imgId);
    const next = found ? `${md.slice(0, found.start)}${illustrationHtml(illustration.imgId, illustration)}${md.slice(found.end)}` : md;
    mod.tabContents = { ...mod.tabContents, [tabId]: next };
}

/* ---------- 아이디어 ---------- */
// 키가 없어도 쓸 수 있도록 섹션 제목에서 만든 후보를 먼저 보여 준다. 학습 목표처럼 그릴 내용이 없는 섹션은 뺀다.
function sectionIllustrationIdeas(md) {
    return lessonH2s(md)
        .map((head, section) => ({ head, section }))
        .filter(({ head }) => !ILLUSTRATION_PLAIN_SECTION.test(head.title))
        .slice(0, ILLUSTRATION_MAX_IDEAS)
        .map(({ head, section }) => ({
            section, description: `「${head.title}」의 핵심 개념을 한눈에 보여 주는 개념도. 핵심 요소를 단순한 도형으로 나누고 관계를 화살표로 잇는다.`
        }));
}

function buildIdeaPrompt(mod, heads, md) {
    return [
        '아래 차시 교안의 이해를 돕는 삽화 후보를 고릅니다. 글자 없이 그림만으로 전달되는 구체적인 장면이나 개념을 한 문장으로 설명합니다.', '',
        `[차시] ${mod.title}`, `[섹션]\n${heads.map((head, index) => `${index}. ${head.title}`).join('\n') || '(섹션 없음)'}`,
        `[교안]\n${md.slice(0, ILLUSTRATION_IDEA_LESSON_CHARS)}`, '',
        `JSON 배열만 출력합니다. ${ILLUSTRATION_MAX_IDEAS}개 이하: [{"section": 0, "description": "삽화 설명"}]`
    ].join('\n');
}

function parseIllustrationIdeas(parsed, sectionCount) {
    const rows = Array.isArray(parsed) ? parsed : (parsed?.ideas || []);
    return rows.slice(0, ILLUSTRATION_MAX_IDEAS)
        .map(row => ({ section: Math.max(0, Math.min(Math.max(0, sectionCount - 1), Number(row?.section) || 0)), description: String(row?.description || '').trim() }))
        .filter(row => row.description);
}

async function suggestIllustrationIdeas(mod, tabId) {
    const md = lessonArtTabMd(mod, tabId);
    const heads = lessonH2s(md);
    const data = await callGemini(TEXT_MODEL, {
        taskRole: 'plan',
        contents: [{ role: 'user', parts: [{ text: buildIdeaPrompt(mod, heads, md) }] }],
        systemInstruction: { parts: [{ text: '교재 삽화 기획자로서 지정된 JSON만 출력합니다.' }] },
        generationConfig: { responseMimeType: 'application/json' }
    });
    return parseIllustrationIdeas(safeJSONParse(extractText(data)), heads.length);
}

/* ---------- 화면 ---------- */
function illustrationBadges(illustration, art) {
    const check = svgStyleCheck(illustration.svg, art);
    const badge = (text, style, title = '') => `<span class="text-[0.6875rem] font-bold px-1 rounded ${style}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
    return [
        check.bad.length ? badge(`팔레트 밖 ${check.bad.length}색`, 'bg-rose-500/20 text-rose-300', check.bad.join(', ')) : badge('팔레트 준수', 'bg-emerald-500/20 text-emerald-300'),
        check.strokeOk ? '' : badge('선 굵기 불일치', 'bg-amber-500/20 text-amber-300', check.strokes.join(', ')),
        art.anchorId === illustration.id ? badge('기준', 'bg-accent/30 text-white') : ''
    ].join(' ');
}

function placementOptions(mod, tabId, current) {
    const option = (value, label) => `<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    const elsewhere = current.startsWith('tab:') ? option(current, '다른 탭에 배치됨') : '';
    return [option(ILLUSTRATION_PLACE_NONE, '배치 안 함'), elsewhere, option(ILLUSTRATION_PLACE_END, '이 탭 맨 끝'), ...lessonH2s(lessonArtTabMd(mod, tabId)).map((head, index) => option(String(index), `${index + 1}. ${head.title.slice(0, 24)}`))].join('');
}

function illustrationReviseHtml(illustration) {
    if (_lessonArt.revising !== illustration.id) return '';
    return `
        <div class="mt-1 space-y-1">
            <textarea id="lesson-art-revise" rows="2" placeholder="무엇을 바꿀까요 (예: 오른쪽 화살표를 곡선으로, 블록 개수를 5개로 줄이기)" class="w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white"></textarea>
            <div class="flex justify-end gap-1">
                <button data-lesson-art-action="revise-cancel" class="px-2 py-0.5 text-[0.6875rem] font-bold text-textLight bg-white/10 rounded">취소</button>
                <button data-lesson-art-action="revise-go" data-id="${escapeHtml(illustration.id)}" class="px-2 py-0.5 text-[0.6875rem] font-bold text-white bg-accent rounded">수정</button>
            </div>
        </div>`;
}

function illustrationCardHtml(mod, illustration, art) {
    const { tabId } = _lessonArt;
    const id = escapeHtml(illustration.id);
    const action = (name, label, extra = '') => `<button data-lesson-art-action="${name}" data-id="${id}" class="px-1.5 py-0.5 text-[0.6875rem] font-bold rounded bg-white/10 text-textLight hover:bg-white/20 ${extra}">${label}</button>`;
    const bad = svgStyleCheck(illustration.svg, art).bad.length;
    const field = 'w-full px-2 py-1 text-[0.6875rem] bg-black/30 border border-white/10 rounded text-white';
    return `
        <div class="rounded-lg border ${art.anchorId === illustration.id ? 'border-accent' : 'border-white/10'} bg-white/5 overflow-hidden">
            <img alt="${escapeHtml(illustration.title)}" src="${escapeHtml(svgPreviewUrl(illustration.svg))}" class="w-full bg-white">
            <div class="p-2 space-y-1">
                <p class="text-xs font-bold text-textLight truncate" title="${escapeHtml(illustration.prompt)}">${escapeHtml(illustration.title)}</p>
                <p class="text-xs text-textMuted">${escapeHtml(illustration.kind)}</p>
                <div>${illustrationBadges(illustration, art)}</div>
                <input data-lesson-art-caption="${id}" value="${escapeHtml(illustration.caption || '')}" placeholder="캡션 (본문에 함께 실림)" class="${field}">
                <select data-lesson-art-place="${id}" class="${field}">${placementOptions(mod, tabId, illustrationPlacement(mod, illustration, tabId))}</select>
                <div class="flex flex-wrap gap-1">
                    ${bad ? action('snap', '팔레트로 맞추기') : ''}${art.anchorId === illustration.id ? '' : action('anchor', '기준으로')}
                    ${textModelHasKey() ? action('revise', '수정 요청') : ''}${action('svg', 'SVG')}${action('png', 'PNG')}${action('delete', '삭제', 'text-rose-300')}
                </div>
                ${illustrationReviseHtml(illustration)}
            </div>
        </div>`;
}

function lessonArtFormHtml(mod) {
    const { form, ideas, tabId } = _lessonArt;
    const field = 'w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white';
    const label = 'block text-[0.6875rem] text-textMuted';
    const options = (items, current) => items.map(item => `<option value="${escapeHtml(item.value)}" ${item.value === current ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
    const hasKey = textModelHasKey();
    return `
        <div class="flex flex-wrap items-center gap-1">
            <span class="text-[0.6875rem] text-textMuted">아이디어</span>
            ${ideas.map((idea, index) => `<button data-lesson-art-action="idea" data-index="${index}" title="${escapeHtml(idea.description)}" class="px-1.5 py-0.5 text-[0.6875rem] rounded bg-white/10 text-textLight hover:bg-white/20">${escapeHtml(idea.description.slice(0, 20))}…</button>`).join('')}
            ${hasKey ? '<button data-lesson-art-action="ideas" class="px-1.5 py-0.5 text-[0.6875rem] font-bold rounded bg-accent/30 text-white hover:bg-accent">AI 아이디어</button>' : ''}
        </div>
        <label class="${label}">무엇을 그릴까요<textarea data-lesson-art-form="description" rows="3" placeholder="예: 질문 상자에서 나온 화살표가 토큰 블록 여러 개로 나뉘고, 각 블록 위에 확률 막대가 서 있는 모습" class="${field} mt-0.5">${escapeHtml(form.description)}</textarea></label>
        <div class="grid grid-cols-3 gap-2">
            <label class="${label}">종류<select data-lesson-art-form="kind" class="${field} mt-0.5">${options(ART_KINDS.map(kind => ({ value: kind, label: kind })), form.kind)}</select></label>
            <label class="${label}">비율<select data-lesson-art-form="ratio" class="${field} mt-0.5">${options(ART_RATIOS, form.ratio)}</select></label>
            <label class="${label}">배치<select data-lesson-art-form="place" class="${field} mt-0.5">${placementOptions(mod, tabId, form.place)}</select></label>
        </div>
        <label class="${label}">캡션<input data-lesson-art-form="caption" value="${escapeHtml(form.caption)}" class="${field} mt-0.5"></label>
        <div class="flex items-center gap-2">
            <button data-lesson-art-action="generate" ${hasKey ? '' : 'disabled'} class="px-3 py-1 text-xs font-bold text-white bg-accent rounded hover:bg-accentHover disabled:opacity-40">삽화 생성</button>
            <span class="text-[0.6875rem] text-textMuted">${hasKey ? '텍스트 모델이 SVG로 그립니다.' : 'AI 키를 저장하면 삽화를 만들 수 있습니다.'}</span>
        </div>`;
}

function lessonArtGuideHtml(art) {
    const row = (name, value) => `<dt class="text-textMuted">${name}</dt><dd class="text-textLight mb-1">${escapeHtml(String(value))}</dd>`;
    return `
        <div class="flex items-center mb-2">
            <h3 class="text-xs font-bold text-textLight">스타일 가이드 · ${escapeHtml(art.name)}</h3>
            <button data-lesson-art-action="guide" class="ml-auto px-2 py-0.5 text-[0.6875rem] font-bold text-textLight bg-white/10 rounded hover:bg-white/20">편집</button>
        </div>
        <div class="flex flex-wrap gap-1 mb-2">${art.palette.map(option => `<span class="flex items-center gap-1 text-[0.6875rem] text-textMuted"><i class="inline-block w-3 h-3 rounded border border-white/20" style="background:${escapeHtml(option.hex)}"></i>${escapeHtml(option.role)}</span>`).join('')}</div>
        <dl class="text-[0.6875rem]">${row('선 굵기', `${art.stroke}px`)}${row('모서리', art.corner)}${row('채색', art.shading)}${row('글자', art.text)}</dl>
        ${art.anchorSvg ? `<p class="text-xs text-textMuted mt-1">기준 삽화</p><img alt="기준 삽화" src="${escapeHtml(svgPreviewUrl(art.anchorSvg))}" class="w-full rounded bg-white mt-1">` : '<p class="text-xs text-textMuted mt-1">기준 삽화가 없습니다. 첫 삽화가 기준이 됩니다.</p>'}`;
}

function renderLessonArt() {
    const body = document.getElementById('lesson-art-body');
    const mod = _lessonArt && getEditingModule(_lessonArt.moduleId);
    if (!body || !mod) return;
    const art = courseArt();
    const cards = (mod.illustrations || []).map(item => illustrationCardHtml(mod, item, art)).join('');
    body.innerHTML = `
        <div class="grid grid-cols-3 gap-3">
            <div class="col-span-2 space-y-3">
                <div class="p-2 rounded-lg bg-black/20 space-y-2">${lessonArtFormHtml(mod)}<p class="text-xs text-accent min-h-[1em]">${escapeHtml(_lessonArt.status)}</p></div>
                <div class="grid grid-cols-2 gap-2">${cards || '<p class="col-span-2 text-xs text-textMuted p-2">아직 삽화가 없습니다.</p>'}</div>
            </div>
            <div class="p-2 rounded-lg bg-black/20 self-start">${lessonArtGuideHtml(art)}</div>
        </div>`;
}

window.openLessonArt = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod?.tabContents) return window.showAlert('삽화는 차시에서 사용할 수 있습니다.');
    if (document.getElementById('lesson-art-dialog')) return;
    const tabId = currentLessonTab;
    const form = { description: '', kind: ART_KINDS[0], ratio: ART_RATIOS[0].value, place: ILLUSTRATION_PLACE_NONE, caption: '' };
    _lessonArt = { moduleId, tabId, form, ideas: sectionIllustrationIdeas(lessonArtTabMd(mod, tabId)), revising: null, status: '', dirty: false, busy: false };
    const label = LESSON_TABS.find(tab => tab.id === tabId)?.label || '';
    const overlay = document.createElement('div');
    overlay.id = 'lesson-art-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[900px] max-h-[90vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10 flex items-center">
                <div><h2 class="text-sm font-bold text-textLight">삽화 · ${escapeHtml(mod.title)}</h2><p class="text-xs text-textMuted mt-1">배치는 지금 연 ${escapeHtml(label)} 탭 기준입니다. 본문에는 PNG로 들어갑니다.</p></div>
                <button data-lesson-art-action="close" class="ml-auto px-3 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20">닫기</button>
            </div>
            <div id="lesson-art-body" class="flex-1 overflow-y-auto p-4"></div>
        </div>`;
    overlay.addEventListener('click', onLessonArtClick);
    overlay.addEventListener('change', onLessonArtChange);
    overlay.addEventListener('input', onLessonArtInput);
    document.body.appendChild(overlay);
    renderLessonArt();
};

/* ---------- 동작 ---------- */
function setLessonArtStatus(status) {
    if (!_lessonArt) return;
    _lessonArt = { ..._lessonArt, status };
    renderLessonArt();
}

// 대화상자를 닫아도 비용을 들여 만든 결과는 저장한다. 그사이 다른 차시로 옮겼으면 편집기를 되돌리지 않는다.
async function finishLessonArtChange(mod, moduleId, status) {
    Object.assign(mod, withHistoryNote(mod, `삽화: ${status}`));
    await saveState();
    if (_lessonArt?.moduleId === moduleId) {
        _lessonArt = { ..._lessonArt, dirty: true, busy: false, status };
        return renderLessonArt();
    }
    if (getEditingModule() === mod) renderEditor(mod); // 그 차시(같은 객체)를 보고 있을 때만. 다른 교과의 같은 번호 차시 화면은 그대로 둔다
}

function placementContext(mod, tabId, place) {
    const md = lessonArtTabMd(mod, tabId);
    const heads = lessonH2s(md);
    const head = heads[Number(place)];
    if (place === ILLUSTRATION_PLACE_NONE || !head) return '';
    return md.slice(head.start, heads[Number(place) + 1]?.start ?? md.length).replace(/\s+/g, ' ').slice(0, ILLUSTRATION_CONTEXT_CHARS);
}

function newIllustration(form, description, svg) {
    return {
        id: `ill_${Date.now()}${Math.floor(Math.random() * 1000)}`, title: description.split(/[.\n]/)[0].slice(0, ILLUSTRATION_TITLE_CHARS),
        kind: form.kind, ratio: form.ratio, prompt: description, svg, caption: form.caption.trim(), imgId: null, at: new Date().toISOString()
    };
}

function setArtAnchor(illustration) {
    globalState.courseArt = { ...(globalState.courseArt || {}), anchorId: illustration.id, anchorSvg: illustration.svg };
}

// 기준 삽화를 고치면 이후 삽화가 고친 그림을 따른다
function syncArtAnchor(illustration) {
    if (courseArt().anchorId === illustration.id) setArtAnchor(illustration);
}

async function withLessonArtBusy(status, failure, work) {
    const { moduleId } = _lessonArt;
    _lessonArt = { ..._lessonArt, busy: true, status };
    renderLessonArt();
    try {
        await work(moduleId);
    } catch (err) {
        console.error(`[삽화] ${failure}:`, err);
        if (_lessonArt?.moduleId === moduleId) _lessonArt = { ..._lessonArt, busy: false, status: `${failure}: ${err.message}` };
        renderLessonArt();
    }
}

function runLessonArtGenerate(mod) {
    const { tabId, form } = _lessonArt;
    const description = form.description.trim();
    if (!description) return setLessonArtStatus('그릴 내용을 적어주세요.');
    return withLessonArtBusy('삽화를 그리고 있습니다...', '삽화 생성 실패', async moduleId => {
        const svg = await drawLessonSvg({ description, kind: form.kind, ratio: form.ratio, context: placementContext(mod, tabId, form.place) });
        const illustration = newIllustration(form, description, svg);
        mod.illustrations = [...(mod.illustrations || []), illustration];
        if (form.place !== ILLUSTRATION_PLACE_NONE) await placeIllustration(mod, illustration.id, tabId, form.place);
        if (!courseArt().anchorSvg) setArtAnchor(illustration);
        if (_lessonArt?.moduleId === moduleId) _lessonArt = { ..._lessonArt, form: { ...form, description: '', caption: '' } };
        await finishLessonArtChange(mod, moduleId, '삽화를 만들었습니다. 스타일 검사 결과를 확인해주세요.');
    });
}

function runLessonArtRevise(mod, id) {
    const instruction = document.getElementById('lesson-art-revise')?.value.trim();
    if (!instruction) return setLessonArtStatus('무엇을 바꿀지 적어주세요.');
    const original = mod.illustrations.find(item => item.id === id);
    return withLessonArtBusy('삽화를 고치고 있습니다...', '삽화 수정 실패', async moduleId => {
        const svg = await reviseLessonSvg(original.svg, instruction);
        const illustration = updateIllustration(mod, id, { svg, revisedAt: new Date().toISOString() });
        await refreshPlacedIllustration(mod, illustration);
        syncArtAnchor(illustration);
        if (_lessonArt?.moduleId === moduleId) _lessonArt = { ..._lessonArt, revising: null };
        await finishLessonArtChange(mod, moduleId, '수정했습니다.');
    });
}

function runLessonArtIdeas(mod) {
    const { tabId } = _lessonArt;
    return withLessonArtBusy('삽화 아이디어를 고르고 있습니다...', '아이디어 제안 실패', async moduleId => {
        const ideas = await suggestIllustrationIdeas(mod, tabId);
        if (_lessonArt?.moduleId !== moduleId) return;
        _lessonArt = { ..._lessonArt, ideas: ideas.length ? ideas : _lessonArt.ideas, busy: false, status: ideas.length ? '' : '새 아이디어를 찾지 못했습니다.' };
        renderLessonArt();
    });
}

function runLessonArtSnap(mod, id) {
    return withLessonArtBusy('팔레트 색으로 맞추고 있습니다...', '팔레트 맞춤 실패', async moduleId => {
        const { svg } = snapSvgPalette(mod.illustrations.find(item => item.id === id).svg, courseArt().palette);
        const illustration = updateIllustration(mod, id, { svg });
        await refreshPlacedIllustration(mod, illustration);
        syncArtAnchor(illustration);
        await finishLessonArtChange(mod, moduleId, '팔레트 색으로 맞췄습니다.');
    });
}

function deleteIllustration(mod, id) {
    window.showConfirm('이 삽화를 삭제할까요? 본문에 넣은 그림도 함께 지웁니다.', () => withLessonArtBusy('삽화를 지우고 있습니다...', '삽화 삭제 실패', async moduleId => {
        await placeIllustration(mod, id, _lessonArt?.tabId, ILLUSTRATION_PLACE_NONE);
        mod.illustrations = mod.illustrations.filter(item => item.id !== id);
        await finishLessonArtChange(mod, moduleId, '삭제했습니다.');
    }));
}

function illustrationFileName(illustration, extension) {
    return `${String(illustration.title || '삽화').replace(/[^\w가-힣]/g, '_')}.${extension}`;
}

// 기본 저장 폴더(save-folder.js)를 골랐으면 그 폴더에, 아니면 브라우저 다운로드로 받는다(받지 못하면 던져 창에 알린다)
async function saveIllustrationPng(illustration) {
    const png = await illustrationPng(illustration);
    const fileName = illustrationFileName(illustration, 'png');
    if (typeof saveFileToFolder === 'function') return saveFileToFolder(dataUrlBlob(png), fileName);
    const link = document.createElement('a');
    link.href = png;
    link.download = fileName;
    link.click();
}

function closeLessonArt() {
    const { dirty, moduleId } = _lessonArt;
    document.getElementById('lesson-art-dialog')?.remove();
    _lessonArt = null;
    const mod = getEditingModule(moduleId);
    if (dirty && mod) renderEditor(mod);
}

function lessonArtImmediateAction(action, mod, illustration) {
    if (action === 'svg') downloadFile(illustration.svg, illustrationFileName(illustration, 'svg'), 'image/svg+xml');
    if (action === 'png') saveIllustrationPng(illustration).catch(err => setLessonArtStatus(`PNG 저장 실패: ${err.message}`));
    if (action === 'revise') _lessonArt = { ..._lessonArt, revising: illustration.id };
}

async function onLessonArtClick(event) {
    const button = event.target.closest?.('[data-lesson-art-action]');
    const action = button?.dataset.lessonArtAction;
    if (!action) return;
    if (action === 'close') return closeLessonArt();
    if (action === 'guide') return window.openArtStyle();
    if (_lessonArt.busy) return;
    const mod = getEditingModule(_lessonArt.moduleId);
    const { id } = button.dataset;
    const illustration = (mod.illustrations || []).find(item => item.id === id);
    if (action === 'generate') return runLessonArtGenerate(mod);
    if (action === 'ideas') return runLessonArtIdeas(mod);
    if (action === 'snap') return runLessonArtSnap(mod, id);
    if (action === 'revise-go') return runLessonArtRevise(mod, id);
    if (action === 'delete') return deleteIllustration(mod, id);
    if (action === 'anchor') {
        setArtAnchor(illustration);
        return finishLessonArtChange(mod, _lessonArt.moduleId, '기준 삽화로 지정했습니다. 이후 삽화가 이 그림의 화풍을 따릅니다.');
    }
    if (action === 'idea') {
        const idea = _lessonArt.ideas[Number(button.dataset.index)];
        const hasSection = !!lessonH2s(lessonArtTabMd(mod, _lessonArt.tabId))[idea.section];
        _lessonArt = { ..._lessonArt, form: { ..._lessonArt.form, description: idea.description, place: hasSection ? String(idea.section) : ILLUSTRATION_PLACE_NONE } };
    }
    if (action === 'revise-cancel') _lessonArt = { ..._lessonArt, revising: null };
    if (illustration) lessonArtImmediateAction(action, mod, illustration);
    renderLessonArt();
}

function onLessonArtInput(event) {
    const name = event.target.dataset?.lessonArtForm;
    if (name) _lessonArt = { ..._lessonArt, form: { ..._lessonArt.form, [name]: event.target.value } };
}

// 칸을 벗어나며 저장하므로 다시 그리지 않는다. 그리면 바로 이어진 버튼 클릭이 사라진다.
async function changeIllustrationCaption(mod, id, caption) {
    const illustration = updateIllustration(mod, id, { caption: caption.trim() });
    replaceIllustrationCaption(mod, illustration);
    _lessonArt = { ..._lessonArt, dirty: true };
    await saveState();
}

function changeIllustrationPlace(mod, id, place) {
    const { tabId } = _lessonArt;
    return withLessonArtBusy('본문에 배치하고 있습니다...', '배치 실패', async moduleId => {
        await placeIllustration(mod, id, tabId, place);
        await finishLessonArtChange(mod, moduleId, place === ILLUSTRATION_PLACE_NONE ? '본문에서 뺐습니다.' : '본문에 배치했습니다.');
    });
}

function onLessonArtChange(event) {
    const { lessonArtForm, lessonArtCaption, lessonArtPlace } = event.target.dataset || {};
    if (lessonArtForm) _lessonArt = { ..._lessonArt, form: { ..._lessonArt.form, [lessonArtForm]: event.target.value } };
    if (_lessonArt.busy) return;
    const mod = getEditingModule(_lessonArt.moduleId);
    if (lessonArtCaption) changeIllustrationCaption(mod, lessonArtCaption, event.target.value);
    if (lessonArtPlace) changeIllustrationPlace(mod, lessonArtPlace, event.target.value);
}
