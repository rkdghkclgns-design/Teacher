// course-meta.js - 차시 메타데이터: 카테고리, 작업 상태, 사용 툴·버전, 선행 차시, NCS 능력단위요소, 변경 이력
// develocket-slide(assets/course-workspace.js, course-ncs.js @3a7303f)의 학습모듈 관리를 Teacher의 차시 목록에 옮겼다.
// 버전 의존 정보는 본문이 아니라 여기서 관리한다는 컨벤션을 함께 따른다.

const LESSON_STATUSES = ['작성중', '검수중', '완료', '개선필요'];
const LESSON_HISTORY_LIMIT = 20;
const LESSON_ELEMENT_MIN_FIT = 70;
const LESSON_STATUS_STYLES = { 작성중: 'bg-sky-500/20 text-sky-300', 검수중: 'bg-amber-500/20 text-amber-300', 완료: 'bg-emerald-500/20 text-emerald-300', 개선필요: 'bg-rose-500/20 text-rose-300' };

let _lessonFilter = { status: '', query: '' };
let _metaDraft = null;

const lessonStatus = lesson => lesson.reviewStatus || '작성중';

function parseToolLines(text) {
    return String(text || '').split('\n')
        .map(line => line.split('|').map(part => part.trim()))
        .filter(([name]) => name)
        .map(([name, version = '']) => ({ name, version }));
}

function toolLabel(tool) {
    return `${tool.name}${tool.version ? ` ${tool.version}` : ''}`;
}

// 등록 형식: "코드 | 요소 이름" 한 줄에 하나. 코드 없이 이름만 적어도 된다
function parseElementLines(text) {
    return String(text || '').split('\n')
        .map(line => line.split('|').map(part => part.trim()))
        .filter(parts => parts.some(Boolean))
        .map(parts => (parts.length > 1 ? { code: parts[0], name: parts.slice(1).join(' ') } : { code: '', name: parts[0] }));
}

function subjectElementOptions(subject) {
    const registry = globalState.ncsElements || {};
    return (subject?.ncs?.units || []).flatMap(unit => (registry[unit.code] || []).map(element => ({ ...element, unitCode: unit.code, unitName: unit.name })));
}

function elementKey(element) {
    return `${element.unitCode}::${element.code || element.name}`;
}

function elementLabel(element) {
    return `${element.code ? `${element.code} ` : ''}${element.name}`;
}

function buildElementPrompt(subject, mod, options) {
    return [
        '국가직무능력표준(NCS) 매핑 담당자로서 아래 차시에 대응하는 능력단위요소를 고르세요.',
        '- 능력단위요소는 차시(학습모듈)에, 능력단위는 교과에 대응합니다.',
        '- 반드시 [참조 목록]의 번호만 사용합니다. 목록에 없는 코드를 지어내지 않습니다.',
        '- fit은 0~100 적합도입니다. 부풀리지 말고 정직하게 매기며 적합도 내림차순으로 정렬합니다.', '',
        '[참조 목록] (번호 | 능력단위 | 능력단위요소)',
        options.map((option, index) => `${index + 1} | ${option.unitName} | ${elementLabel(option)}`).join('\n'), '',
        `[교과] ${subject.title}`, `[차시] ${mod.title}`, `[설명] ${mod.description || '-'}`,
        `[학습 목표]\n${(mod.objectives || []).join('\n') || '-'}`, '',
        'JSON만 출력합니다: [{"index": 1, "fit": 85, "reason": "한 문장 근거"}]'
    ].join('\n');
}

async function recommendLessonElements(subject, mod, options) {
    if (!options.length) throw new Error('능력단위요소를 먼저 등록해주세요. 원문은 ncs.go.kr에서 확인할 수 있습니다.');
    if (!textModelHasKey()) throw new Error('능력단위요소 추천에는 AI 키가 필요합니다.');
    const parsed = await askNcsJson(buildElementPrompt(subject, mod, options));
    const rows = Array.isArray(parsed) ? parsed : (parsed?.recs || []);
    return rows
        .map(row => ({ option: options[Number(row.index) - 1], fit: Math.max(0, Math.min(100, Math.round(Number(row.fit) || 0))), reason: String(row.reason || '').trim() }))
        .filter(row => row.option)
        .sort((a, b) => b.fit - a.fit);
}

function pickLessonElements(recs) {
    return recs.filter(rec => rec.fit >= LESSON_ELEMENT_MIN_FIT).map(rec => rec.option);
}

function metaChanges(mod, next) {
    const changed = (key, label, empty = []) => (JSON.stringify(mod[key] ?? empty) !== JSON.stringify(next[key] ?? empty) ? label : '');
    const status = lessonStatus(mod) !== next.reviewStatus ? `상태: ${lessonStatus(mod)} → ${next.reviewStatus}` : '';
    return [status, changed('category', '카테고리', ''), changed('tools', '툴·버전'), changed('prereqs', '선행 차시'), changed('ncsElements', 'NCS 요소')].filter(Boolean);
}

function withMetaHistory(mod, next) {
    const changes = metaChanges(mod, next);
    if (!changes.length) return { ...next, history: mod.history || [] };
    return { ...next, history: [{ at: new Date().toISOString(), note: changes.join(', ') }, ...(mod.history || [])].slice(0, LESSON_HISTORY_LIMIT) };
}

/* ---------- 차시 목록 ---------- */
function renderLessonMetaChips(mod) {
    const tools = (mod.tools || []).map(toolLabel).join(', ');
    return `
        <div class="mt-2 flex flex-wrap items-center gap-1">
            <button onclick="event.stopPropagation(); openLessonMeta(${mod.id})" class="text-[0.6rem] font-bold px-1.5 py-0.5 rounded ${LESSON_STATUS_STYLES[lessonStatus(mod)]}" title="차시 정보 편집">${lessonStatus(mod)}</button>
            ${mod.category ? `<span class="text-[0.6rem] px-1.5 py-0.5 rounded bg-white/10 text-textLight">${escapeHtml(mod.category)}</span>` : ''}
            ${tools ? `<span class="text-[0.6rem] text-textMuted truncate max-w-[150px]" title="${escapeHtml(tools)}">${escapeHtml(tools)}</span>` : ''}
        </div>`;
}

function renderLessonFilterBar() {
    const counts = LESSON_STATUSES.map(status => [status, courseData.filter(lesson => lessonStatus(lesson) === status).length]);
    const chip = (value, label, count) => `<button onclick="setLessonStatusFilter('${value}')" class="text-[0.6rem] px-1.5 py-0.5 rounded ${_lessonFilter.status === value ? 'bg-accent text-white' : 'bg-white/10 text-textMuted'}">${label} ${count}</button>`;
    return `
        <div class="mb-2 space-y-1">
            <input oninput="setLessonQueryFilter(this.value)" value="${escapeHtml(_lessonFilter.query)}" placeholder="차시 검색 (제목·카테고리·목표)" class="w-full px-2 py-1 text-[0.65rem] bg-black/30 border border-white/10 rounded text-white focus:outline-none focus:border-accent">
            <div class="flex flex-wrap gap-1">${chip('', '전체', courseData.length)}${counts.map(([status, count]) => chip(status, status, count)).join('')}</div>
        </div>`;
}

function lessonMatchesFilter(lesson) {
    const haystack = `${lesson.title} ${lesson.category || ''} ${(lesson.objectives || []).join(' ')}`.toLowerCase();
    const statusOk = !_lessonFilter.status || lessonStatus(lesson) === _lessonFilter.status;
    return statusOk && haystack.includes(_lessonFilter.query.trim().toLowerCase());
}

// 드래그 정렬이 DOM 순서를 읽으므로 카드를 지우지 않고 숨긴다
function applyLessonFilter() {
    document.querySelectorAll('.module-card[data-id]').forEach(card => {
        const lesson = courseData.find(item => String(item.id) === card.dataset.id);
        if (lesson) card.classList.toggle('hidden', !lessonMatchesFilter(lesson));
    });
}

window.setLessonStatusFilter = function (status) {
    _lessonFilter = { ..._lessonFilter, status };
    renderSidebar();
    applyLessonFilter();
};

window.setLessonQueryFilter = function (query) {
    _lessonFilter = { ..._lessonFilter, query };
    applyLessonFilter();
};

/* ---------- 대화상자 ---------- */
function metaElementRows() {
    const { options, selected } = _metaDraft;
    if (!options.length) return '<p class="text-[0.65rem] text-textMuted">교과에 배정한 능력단위의 요소를 아래에 등록하면 고를 수 있습니다.</p>';
    return options.map(option => `
        <label class="flex items-start gap-2 text-xs text-textLight">
            <input type="checkbox" class="mt-0.5" data-meta-element="${escapeHtml(elementKey(option))}" ${selected.has(elementKey(option)) ? 'checked' : ''}>
            <span>${escapeHtml(elementLabel(option))}<span class="block text-[0.6rem] text-textMuted">${escapeHtml(option.unitName)}${_metaDraft.reasons[elementKey(option)] ? ` · ${escapeHtml(_metaDraft.reasons[elementKey(option)])}` : ''}</span></span>
        </label>`).join('');
}

function metaRegisterForm(subject) {
    const units = subject?.ncs?.units || [];
    if (!units.length) return '<p class="text-[0.65rem] text-textMuted">먼저 교과 NCS 관리에서 능력단위를 배정해주세요.</p>';
    return `
        <div class="flex gap-2">
            <select id="meta-element-unit" class="flex-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white">${units.map(unit => `<option value="${escapeHtml(unit.code)}">${escapeHtml(unit.name)}</option>`).join('')}</select>
            <button data-meta-action="register" class="px-2 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20">요소 등록</button>
            <button data-meta-action="recommend" class="px-2 py-1 text-xs font-bold text-white bg-accent rounded hover:bg-accentHover">AI 추천</button>
        </div>
        <textarea id="meta-element-lines" rows="2" placeholder="코드 | 요소 이름 (한 줄에 하나, ncs.go.kr 원문 기준)" class="mt-1 w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white"></textarea>`;
}

function metaPrereqRows(mod) {
    const others = courseData.filter(lesson => lesson.id !== mod.id);
    if (!others.length) return '<p class="text-[0.65rem] text-textMuted">이 교과에 다른 차시가 없습니다.</p>';
    return others.map(lesson => `
        <label class="flex items-center gap-2 text-xs text-textLight">
            <input type="checkbox" data-meta-prereq="${lesson.id}" ${(mod.prereqs || []).some(item => item.id === lesson.id) ? 'checked' : ''}> ${escapeHtml(lesson.title)}
        </label>`).join('');
}

function metaHistoryRows(mod) {
    if (!(mod.history || []).length) return '<p class="text-[0.65rem] text-textMuted">변경 이력이 없습니다.</p>';
    return mod.history.map(row => `<div class="text-[0.65rem] text-textMuted">${escapeHtml(row.at.slice(0, 16).replace('T', ' '))} · ${escapeHtml(row.note)}</div>`).join('');
}

function metaDialogHtml(subject, mod) {
    const label = 'block text-[0.65rem] font-bold text-textMuted mb-1';
    const field = 'w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white focus:outline-none focus:border-accent';
    const categories = [...new Set(globalState.subjects.flatMap(item => item.lessons || []).map(lesson => lesson.category).filter(Boolean))];
    return `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[560px] max-h-[86vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10"><h2 class="text-sm font-bold text-textLight">차시 정보 · ${escapeHtml(mod.title)}</h2></div>
            <div class="flex-1 overflow-y-auto p-4 space-y-3">
                <div class="flex gap-2">
                    <div class="flex-1"><label class="${label}">카테고리</label><input id="meta-category" list="meta-categories" value="${escapeHtml(mod.category || '')}" class="${field}"><datalist id="meta-categories">${categories.map(item => `<option value="${escapeHtml(item)}"></option>`).join('')}</datalist></div>
                    <div class="w-32"><label class="${label}">상태</label><select id="meta-status" class="${field}">${LESSON_STATUSES.map(status => `<option ${lessonStatus(mod) === status ? 'selected' : ''}>${status}</option>`).join('')}</select></div>
                </div>
                <div><label class="${label}">사용 툴과 버전 (이름 | 버전, 버전 의존 정보는 본문이 아니라 여기서 관리합니다)</label><textarea id="meta-tools" rows="2" class="${field}">${escapeHtml((mod.tools || []).map(tool => `${tool.name}${tool.version ? ` | ${tool.version}` : ''}`).join('\n'))}</textarea></div>
                <div><label class="${label}">선행 차시</label><div class="space-y-1 max-h-24 overflow-y-auto">${metaPrereqRows(mod)}</div></div>
                <div><label class="${label}">NCS 능력단위요소</label><div id="meta-elements" class="space-y-1 max-h-32 overflow-y-auto mb-2">${metaElementRows()}</div>${metaRegisterForm(subject)}<p id="meta-status-text" class="text-[0.65rem] text-accent mt-1 min-h-[1em]"></p></div>
                <div><label class="${label}">변경 이력</label>${metaHistoryRows(mod)}</div>
            </div>
            <div class="p-3 border-t border-white/10 flex justify-end gap-2">
                <button data-meta-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
                <button data-meta-action="save" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">저장</button>
            </div>
        </div>`;
}

window.openLessonMeta = async function (moduleId) {
    if (document.getElementById('lesson-meta-dialog')) return;
    const mod = getEditingModule(moduleId);
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    if (!mod || !subject) return;
    const options = subjectElementOptions(subject);
    _metaDraft = { mod, subject, options, reasons: {}, selected: new Set((mod.ncsElements || []).map(elementKey)) };
    const overlay = document.createElement('div');
    overlay.id = 'lesson-meta-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = metaDialogHtml(subject, mod);
    overlay.addEventListener('click', onMetaClick);
    overlay.addEventListener('change', onMetaChange);
    document.body.appendChild(overlay);
};

function refreshMetaElements() {
    const list = document.getElementById('meta-elements');
    if (list) list.innerHTML = metaElementRows();
}

function onMetaChange(event) {
    const key = event.target.dataset?.metaElement;
    if (key === undefined) return;
    if (event.target.checked) _metaDraft.selected.add(key);
    else _metaDraft.selected.delete(key);
}

function registerElements() {
    const unitCode = document.getElementById('meta-element-unit')?.value;
    const added = parseElementLines(document.getElementById('meta-element-lines')?.value);
    if (!unitCode || !added.length) return;
    const registry = globalState.ncsElements || {};
    const merged = [...(registry[unitCode] || []), ...added].filter((element, index, all) => all.findIndex(other => (other.code || other.name) === (element.code || element.name)) === index);
    globalState.ncsElements = { ...registry, [unitCode]: merged };
    _metaDraft = { ..._metaDraft, options: subjectElementOptions(_metaDraft.subject) };
    document.getElementById('meta-element-lines').value = '';
    refreshMetaElements();
}

async function runElementRecommend(button) {
    const draft = _metaDraft;
    const status = document.getElementById('meta-status-text');
    button.disabled = true;
    status.textContent = '능력단위요소를 분석하고 있습니다...';
    try {
        const recs = await recommendLessonElements(draft.subject, draft.mod, draft.options);
        if (_metaDraft?.mod !== draft.mod || !document.getElementById('lesson-meta-dialog')) return;
        pickLessonElements(recs).forEach(option => _metaDraft.selected.add(elementKey(option)));
        _metaDraft = { ..._metaDraft, reasons: Object.fromEntries(recs.map(rec => [elementKey(rec.option), `${rec.fit}점 ${rec.reason}`])) };
        status.textContent = recs.length ? '' : '적합한 요소를 찾지 못했습니다.';
        refreshMetaElements();
    } catch (err) {
        console.error('[차시 정보] 요소 추천 실패:', err);
        status.textContent = err.message;
    } finally {
        button.disabled = false;
    }
}

async function saveLessonMeta() {
    const { mod, options, selected } = _metaDraft;
    const dialog = document.getElementById('lesson-meta-dialog');
    const prereqs = [...dialog.querySelectorAll('[data-meta-prereq]:checked')]
        .map(box => courseData.find(lesson => String(lesson.id) === box.dataset.metaPrereq))
        .filter(Boolean)
        .map(lesson => ({ id: lesson.id, title: lesson.title }));
    const next = {
        category: document.getElementById('meta-category').value.trim(),
        reviewStatus: document.getElementById('meta-status').value,
        tools: parseToolLines(document.getElementById('meta-tools').value),
        prereqs,
        // 능력단위가 바뀌어 지금 목록에 없는 요소도 사용자가 고른 기록이므로 유지한다
        ncsElements: [...(mod.ncsElements || []).filter(element => !options.some(option => elementKey(option) === elementKey(element))), ...options.filter(option => selected.has(elementKey(option)))]
    };
    Object.assign(mod, withMetaHistory(mod, next));
    await saveState();
    dialog.remove();
    renderSidebar();
    applyLessonFilter();
}

async function onMetaClick(event) {
    const action = event.target.dataset?.metaAction;
    if (action === 'close') document.getElementById('lesson-meta-dialog')?.remove();
    if (action === 'register') registerElements();
    if (action === 'recommend') await runElementRecommend(event.target);
    if (action === 'save') await saveLessonMeta();
}
