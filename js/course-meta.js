// course-meta.js - 차시 메타데이터: 카테고리, 작업 상태, 사용 툴·버전, 선행 차시, NCS 능력단위요소, 변경 이력, 휴지통
// develocket-slide(assets/course-workspace.js, course-ncs.js @3a7303f)의 학습모듈 관리를 Teacher의 차시 목록에 옮겼다.
// 버전 의존 정보는 본문이 아니라 여기서 관리한다는 컨벤션을 함께 따른다.

const LESSON_STATUSES = ['작성중', '검수중', '완료', '개선필요'];
const LESSON_HISTORY_LIMIT = 20;
const LESSON_TRASH_LIMIT = 100;
const LESSON_TRASH_DAYS = 30;
const DAY_MS = 86400000;
const LESSON_STATUS_STYLES = { 작성중: 'bg-sky-500/20 text-sky-300', 검수중: 'bg-amber-500/20 text-amber-300', 완료: 'bg-emerald-500/20 text-emerald-300', 개선필요: 'bg-rose-500/20 text-rose-300' };

let _lessonFilter = { status: '', query: '', ncs: [], group: false };
let _metaDraft = null;
let _metaOpening = false;

const lessonStatus = lesson => lesson.reviewStatus || '작성중';

// 현재 교과의 차시는 courseData가 최신이다. subject.lessons는 저장할 때 맞춰진다.
const subjectLessons = subject => (subject.id === currentSubjectId ? courseData : subject.lessons) || [];
const allLessonEntries = () => globalState.subjects.flatMap(subject => subjectLessons(subject).map(lesson => ({ lesson, subject })));

function lessonTitleTaken(title, selfId) {
    const text = String(title || '').trim();
    return allLessonEntries().some(({ lesson }) => String(lesson.title).trim() === text && String(lesson.id) !== String(selfId));
}

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

// 교수안 개요에도 이 표기를 쓴다. 사용자가 확정하기 전의 자동 배정은 미확정으로 밝힌다.
function elementLabel(element) {
    return `${element.code ? `${element.code} ` : ''}${element.name}${element.auto ? ' (미확정)' : ''}`;
}

function metaChanges(mod, next) {
    const changed = (key, label, empty = []) => (JSON.stringify(mod[key] ?? empty) !== JSON.stringify(next[key] ?? empty) ? label : '');
    const status = lessonStatus(mod) !== next.reviewStatus ? `상태: ${lessonStatus(mod)} → ${next.reviewStatus}` : '';
    return [changed('title', '제목', ''), status, changed('category', '카테고리', ''), changed('tools', '툴·버전'), changed('prereqs', '선행 차시'), changed('ncsElements', 'NCS 요소')].filter(Boolean);
}

function withHistoryNote(mod, note) {
    return { history: [{ at: new Date().toISOString(), note }, ...(mod.history || [])].slice(0, LESSON_HISTORY_LIMIT) };
}

function withMetaHistory(mod, next) {
    const changes = metaChanges(mod, next);
    if (!changes.length) return { ...next, history: mod.history || [] };
    return { ...next, ...withHistoryNote(mod, changes.join(', ')) };
}

// 이름이 바뀌어도 id로 찾고, 지운 뒤 같은 이름으로 다시 만든 차시는 제목으로 잇는다
function findLessonPrereq(prereq, selfId) {
    const entries = allLessonEntries();
    const title = String(prereq.title || '').trim();
    const hit = entries.find(({ lesson }) => prereq.id != null && String(lesson.id) === String(prereq.id))
        || entries.find(({ lesson }) => String(lesson.title).trim() === title);
    if (!hit) return { state: 'none' };
    return { ...hit, state: String(hit.lesson.id) === String(selfId) ? 'self' : 'ok' };
}

/* ---------- 휴지통 ---------- */
const trashAgeDays = (entry, now) => Math.floor((now - Date.parse(entry.at)) / DAY_MS);

function trashDaysLeft(entry, now = Date.now()) {
    return Math.max(0, LESSON_TRASH_DAYS - trashAgeDays(entry, now));
}

// 날짜를 읽지 못한 항목은 지우지 않는다
function liveLessonTrash(entries, now = Date.now()) {
    return (entries || []).filter(entry => !(trashAgeDays(entry, now) >= LESSON_TRASH_DAYS));
}

function moveLessonsToTrash(lessons) {
    const entries = lessons.map(lesson => ({ lesson, subjectId: currentSubjectId, at: new Date().toISOString() }));
    globalState.lessonTrash = [...entries, ...liveLessonTrash(globalState.lessonTrash)].slice(0, LESSON_TRASH_LIMIT);
}

// 목록을 그릴 때마다 지난 항목을 비운다. 다음 저장에 함께 반영된다.
function renderLessonTrashButton() {
    if (globalState.lessonTrash?.length) globalState.lessonTrash = liveLessonTrash(globalState.lessonTrash);
    const count = (globalState.lessonTrash || []).length;
    return count ? `<button onclick="openLessonTrash()" class="text-[0.55rem] font-bold px-2 py-0.5 mr-1 rounded bg-white/10 text-textMuted hover:bg-white/20" title="삭제한 차시 복원">휴지통 ${count}</button>` : '';
}

function restoreLesson(index) {
    const entry = globalState.lessonTrash[index];
    const subject = globalState.subjects.find(item => item.id === entry.subjectId) || globalState.subjects.find(item => item.id === currentSubjectId);
    if (!subject) return false;
    const lesson = lessonTitleTaken(entry.lesson.title, entry.lesson.id) ? { ...entry.lesson, title: `${entry.lesson.title} (복원)` } : entry.lesson;
    if (subject.id === currentSubjectId) courseData = [...courseData, lesson];
    subject.lessons = subject.id === currentSubjectId ? courseData : [...(subject.lessons || []), lesson];
    globalState.lessonTrash = globalState.lessonTrash.filter((_, i) => i !== index);
    return true;
}

function renderTrashRows() {
    const rows = (globalState.lessonTrash || []).map((entry, index) => {
        const subject = globalState.subjects.find(item => item.id === entry.subjectId);
        return `
            <div class="flex items-center gap-2 p-2 rounded-lg bg-white/5 text-xs text-textLight">
                <span class="flex-1 min-w-0 truncate">${escapeHtml(entry.lesson.title)}<span class="block text-[0.6rem] text-textMuted">${escapeHtml(subject?.title || '삭제된 교과')} · ${escapeHtml(entry.at.slice(0, 16).replace('T', ' '))} · 남은 기간 ${trashDaysLeft(entry)}일</span></span>
                <button data-trash-action="restore" data-index="${index}" class="px-2 py-1 font-bold bg-accent text-white rounded">복원</button>
                <button data-trash-action="purge" data-index="${index}" class="px-2 py-1 font-bold bg-white/10 text-rose-300 rounded">완전 삭제</button>
            </div>`;
    });
    return rows.join('') || '<p class="text-xs text-textMuted">휴지통이 비었습니다.</p>';
}

window.openLessonTrash = function () {
    if (document.getElementById('lesson-trash-dialog')) return;
    globalState.lessonTrash = liveLessonTrash(globalState.lessonTrash);
    const overlay = document.createElement('div');
    overlay.id = 'lesson-trash-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[480px] max-h-[80vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10">
                <div class="flex items-center gap-2">
                    <h2 class="text-sm font-bold text-textLight">차시 휴지통</h2>
                    <button data-trash-action="empty" class="ml-auto px-3 py-1 text-xs font-bold text-rose-300 bg-white/10 rounded">휴지통 비우기</button>
                    <button data-trash-action="close" class="px-3 py-1 text-xs font-bold text-textLight bg-white/10 rounded">닫기</button>
                </div>
                <p class="text-[0.65rem] text-textMuted mt-1">삭제한 차시는 ${LESSON_TRASH_DAYS}일 동안 보관한 뒤 자동으로 지웁니다.</p>
            </div>
            <div id="lesson-trash-rows" class="flex-1 overflow-y-auto p-4 space-y-2">${renderTrashRows()}</div>
        </div>`;
    overlay.addEventListener('click', onTrashClick);
    document.body.appendChild(overlay);
};

async function refreshTrash() {
    await saveState();
    renderSidebar();
    applyLessonFilter();
    const rows = document.getElementById('lesson-trash-rows');
    if (rows) rows.innerHTML = renderTrashRows();
}

async function onTrashClick(event) {
    const action = event.target.dataset?.trashAction;
    if (!action) return;
    if (action === 'close') return document.getElementById('lesson-trash-dialog')?.remove();
    if (action === 'empty') {
        return window.showConfirm('휴지통의 차시를 모두 영구 삭제할까요? 되돌릴 수 없습니다.', () => {
            globalState.lessonTrash = [];
            return refreshTrash();
        });
    }
    const index = Number(event.target.dataset.index);
    if (action === 'restore') {
        const entry = globalState.lessonTrash[index];
        if (!restoreLesson(index)) return window.showAlert('복원할 교과를 찾지 못했습니다.');
        window.showToast?.(`'${entry.lesson.title}' 차시를 복원했습니다.`, 'success');
    }
    if (action === 'purge') globalState.lessonTrash = globalState.lessonTrash.filter((_, i) => i !== index);
    await refreshTrash();
}

/* ---------- 차시 목록 ---------- */
function renderLessonMetaChips(mod) {
    const tools = (mod.tools || []).map(toolLabel).join(', ');
    return `
        <div class="mt-2 flex flex-wrap items-center gap-1">
            <button onclick="event.stopPropagation(); openLessonMeta(${mod.id})" class="text-[0.6rem] font-bold px-1.5 py-0.5 rounded ${LESSON_STATUS_STYLES[lessonStatus(mod)]}" title="차시 정보 편집">${lessonStatus(mod)}</button>
            ${mod.category ? `<span class="text-[0.6rem] px-1.5 py-0.5 rounded bg-white/10 text-textLight">${escapeHtml(mod.category)}</span>` : ''}
            ${tools ? `<span class="text-[0.6rem] text-textMuted truncate max-w-[150px]" title="${escapeHtml(tools)}">${escapeHtml(tools)}</span>` : ''}
            ${lessonListBadges(mod)}
        </div>`;
}

function renderLessonFilterBar() {
    const counts = LESSON_STATUSES.map(status => [status, courseData.filter(lesson => lessonStatus(lesson) === status).length]);
    const chip = (value, label, count) => `<button onclick="setLessonStatusFilter('${value}')" class="text-[0.6rem] px-1.5 py-0.5 rounded ${_lessonFilter.status === value ? 'bg-accent text-white' : 'bg-white/10 text-textMuted'}">${label} ${count}</button>`;
    return `
        <div class="mb-2 space-y-1">
            <input oninput="setLessonQueryFilter(this.value)" value="${escapeHtml(_lessonFilter.query)}" placeholder="차시 검색 (제목·카테고리·목표)" class="w-full px-2 py-1 text-[0.65rem] bg-black/30 border border-white/10 rounded text-white focus:outline-none focus:border-accent">
            <div class="flex flex-wrap gap-1">${chip('', '전체', courseData.length)}${counts.map(([status, count]) => chip(status, status, count)).join('')}</div>
            ${renderLessonViewBar()}
        </div>`;
}

function lessonMatchesFilter(lesson) {
    const haystack = `${lesson.title} ${lesson.category || ''} ${(lesson.objectives || []).join(' ')}`.toLowerCase();
    const statusOk = !_lessonFilter.status || lessonStatus(lesson) === _lessonFilter.status;
    return statusOk && lessonMatchesNcs(lesson) && haystack.includes(_lessonFilter.query.trim().toLowerCase());
}

// 입력 중인 검색창이 다시 그려지지 않도록 카드를 지우지 않고 숨긴다
function applyLessonFilter() {
    document.querySelectorAll('.module-card[data-id]').forEach(card => {
        const lesson = courseData.find(item => String(item.id) === card.dataset.id);
        if (lesson) card.classList.toggle('hidden', !lessonMatchesFilter(lesson));
    });
    refreshLessonGroupHeads();
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
    const { mod, options, selected } = _metaDraft;
    const entries = lessonElementEntries(mod, options);
    if (!entries.length) return '<p class="text-[0.65rem] text-textMuted">AI 추천을 누르면 교안을 분석해 고를 항목을 보여 줍니다. 요소를 등록하지 않았으면 능력단위 수준으로 추천합니다.</p>';
    return entries.map(entry => elementRowHtml(entry, selected.has(entry.key))).join('');
}

function metaElementStatus() {
    const { mod } = _metaDraft;
    const note = mod.ncsNote ? `<p class="text-[0.6rem] text-textMuted mb-1">${escapeHtml(mod.ncsNote)}</p>` : '';
    if (!mod.ncsAuto) return note;
    return `
        <div class="flex items-center gap-2 mb-1">
            <span class="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">자동 배정 · 확정 전</span>
            <button data-meta-action="confirm-elements" class="text-[0.6rem] font-bold px-2 py-0.5 rounded bg-accent text-white">확인하고 확정</button>
        </div>${note}`;
}

function metaRegisterForm(subject) {
    const units = subject?.ncs?.units || [];
    const recommend = '<button data-meta-action="recommend" class="px-2 py-1 text-xs font-bold text-white bg-accent rounded hover:bg-accentHover">AI 추천</button>';
    if (!units.length) return `<div class="flex items-center gap-2"><p class="flex-1 text-[0.65rem] text-textMuted">교과 NCS 관리에서 능력단위를 배정하면 요소를 등록할 수 있습니다.</p>${recommend}</div>`;
    return `
        <div class="flex gap-2">
            <select id="meta-element-unit" class="flex-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white">${units.map(unit => `<option value="${escapeHtml(unit.code)}">${escapeHtml(unit.name)}</option>`).join('')}</select>
            <button data-meta-action="register" class="px-2 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20">요소 등록</button>
            ${recommend}
        </div>
        <textarea id="meta-element-lines" rows="2" placeholder="코드 | 요소 이름 (한 줄에 하나, ncs.go.kr 원문 기준)" class="mt-1 w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white"></textarea>`;
}

function metaPrereqRow(lesson, checked) {
    return `
        <label class="flex items-center gap-2 text-xs text-textLight">
            <input type="checkbox" data-meta-prereq="${escapeHtml(String(lesson.id))}" ${checked ? 'checked' : ''}> <span class="min-w-0 truncate">${escapeHtml(lesson.title)}</span>
            <span class="text-[0.55rem] font-bold px-1 rounded shrink-0 ${LESSON_STATUS_STYLES[lessonStatus(lesson)] || ''}">${escapeHtml(lessonStatus(lesson))}</span>
        </label>`;
}

// 다른 교과의 차시도 선행으로 고를 수 있다. 지운 차시는 체크된 채로 남겨 사용자가 직접 뺀다.
function metaPrereqRows(mod) {
    const chosen = mod.prereqs || [];
    const others = allLessonEntries().filter(({ lesson }) => String(lesson.id) !== String(mod.id));
    const isChosen = lesson => chosen.some(item => findLessonPrereq(item, mod.id).lesson === lesson);
    const groups = globalState.subjects
        .map(subject => ({ subject, rows: others.filter(entry => entry.subject === subject) }))
        .filter(group => group.rows.length)
        .map(({ subject, rows }) => `<p class="text-[0.6rem] text-textMuted mt-1">${escapeHtml(subject.title)}</p>${rows.map(({ lesson }) => metaPrereqRow(lesson, isChosen(lesson))).join('')}`);
    const broken = chosen.map((item, index) => ({ item, index, state: findLessonPrereq(item, mod.id).state })).filter(row => row.state !== 'ok').map(({ item, index, state }) => `
        <label class="flex items-center gap-2 text-xs text-textLight">
            <input type="checkbox" data-meta-prereq-broken="${index}" checked> ${escapeHtml(item.title || '')}
            <span class="text-[0.55rem] font-bold px-1 rounded bg-rose-500/20 text-rose-300">${state === 'self' ? '자기 자신' : '미등록'}</span>
        </label>`);
    return [...broken, ...groups].join('') || '<p class="text-[0.65rem] text-textMuted">선행으로 고를 다른 차시가 없습니다.</p>';
}

function metaHistoryRows(mod) {
    if (!(mod.history || []).length) return '<p class="text-[0.65rem] text-textMuted">변경 이력이 없습니다.</p>';
    return mod.history.map(row => `<div class="text-[0.65rem] text-textMuted">${escapeHtml(row.at.slice(0, 16).replace('T', ' '))} · ${escapeHtml(row.note)}</div>`).join('');
}

function metaBasicsHtml(subject, mod, label, field) {
    const categories = lessonCategories().map(item => item.name);
    return `
        <div><label class="${label}">제목 (과정 안에서 겹치지 않게)</label><input id="meta-title" value="${escapeHtml(mod.title)}" class="${field}"><p id="meta-title-warning" class="text-[0.6rem] text-rose-300 min-h-[1em]">${lessonTitleTaken(mod.title, mod.id) ? '같은 제목의 차시가 이미 있습니다.' : ''}</p></div>
        <div class="flex gap-2">
            <div class="flex-1"><label class="${label}">카테고리</label><input id="meta-category" list="meta-categories" value="${escapeHtml(mod.category || '')}" class="${field}"><datalist id="meta-categories">${categories.map(item => `<option value="${escapeHtml(item)}"></option>`).join('')}</datalist></div>
            <div class="w-28"><label class="${label}">상태</label><select id="meta-status" class="${field}">${LESSON_STATUSES.map(status => `<option ${lessonStatus(mod) === status ? 'selected' : ''}>${status}</option>`).join('')}</select></div>
            <div class="w-40"><label class="${label}">교과</label><select id="meta-subject" class="${field}">${globalState.subjects.map(item => `<option value="${escapeHtml(String(item.id))}" ${item.id === subject.id ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></div>
        </div>
        <details id="meta-category-manager" class="text-[0.65rem] text-textMuted"><summary class="cursor-pointer">카테고리 관리</summary><div id="meta-category-rows" class="mt-1 space-y-1">${lessonCategoryRowsHtml()}</div></details>`;
}

function metaDialogHtml(subject, mod) {
    const label = 'block text-[0.65rem] font-bold text-textMuted mb-1';
    const field = 'w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white focus:outline-none focus:border-accent';
    return `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[600px] max-h-[86vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10"><h2 class="text-sm font-bold text-textLight">차시 정보 · ${escapeHtml(mod.title)}</h2></div>
            <div class="flex-1 overflow-y-auto p-4 space-y-3">
                ${metaBasicsHtml(subject, mod, label, field)}
                <div><label class="${label}">사용 툴과 버전 (이름 | 버전, 버전 의존 정보는 본문이 아니라 여기서 관리합니다)</label><textarea id="meta-tools" rows="2" class="${field}">${escapeHtml((mod.tools || []).map(tool => `${tool.name}${tool.version ? ` | ${tool.version}` : ''}`).join('\n'))}</textarea></div>
                <div><label class="${label}">선행 차시 (메타데이터 전용, 본문에서는 언급하지 않습니다)</label><div class="space-y-1 max-h-28 overflow-y-auto">${metaPrereqRows(mod)}</div></div>
                <div><label class="${label}">NCS 능력단위요소</label><div id="meta-element-status">${metaElementStatus()}</div><div id="meta-elements" class="space-y-1 max-h-40 overflow-y-auto mb-2">${metaElementRows()}</div>${metaRegisterForm(subject)}<p id="meta-status-text" class="text-[0.65rem] text-accent mt-1 min-h-[1em]"></p></div>
                <div><label class="${label}">변경 이력</label>
                    <div class="flex gap-2 mb-1"><input id="meta-history-note" placeholder="직접 기록 (예: 교과 담당자 검토 반영)" class="${field}"><button data-meta-action="add-note" class="px-2 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20 shrink-0">기록</button></div>
                    <div id="meta-history">${metaHistoryRows(mod)}</div>
                </div>
            </div>
            <div class="p-3 border-t border-white/10 flex justify-end gap-2">
                <button data-meta-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
                <button id="meta-save" data-meta-action="save" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover disabled:opacity-40">저장</button>
            </div>
        </div>`;
}

// 능력단위요소 판정에 카탈로그가 필요하다. 못 불러와도 다른 차시 정보는 편집할 수 있게 연다.
async function loadCatalogForMeta() {
    _metaOpening = true;
    try {
        await loadNcsCatalog();
    } catch (err) {
        console.warn('[차시 정보] NCS 목록 로드 실패:', err);
    } finally {
        _metaOpening = false;
    }
}

window.openLessonMeta = async function (moduleId) {
    if (_metaOpening || document.getElementById('lesson-meta-dialog')) return;
    const mod = getEditingModule(moduleId);
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    if (!mod || !subject) return;
    await loadCatalogForMeta();
    const options = subjectElementOptions(subject);
    _metaDraft = { mod, subject, options, touched: false, confirm: false, selected: new Set((mod.ncsElements || []).map(elementKey)) };
    const overlay = document.createElement('div');
    overlay.id = 'lesson-meta-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = metaDialogHtml(subject, mod);
    overlay.addEventListener('click', onMetaClick);
    overlay.addEventListener('change', onMetaChange);
    overlay.addEventListener('input', onMetaInput);
    document.body.appendChild(overlay);
    if (needsElementAutoAssign(mod)) runElementAutoAssign();
};

function closeLessonMeta() {
    document.getElementById('lesson-meta-dialog')?.remove();
    _metaDraft = null;
}

function refreshMetaElements() {
    const list = document.getElementById('meta-elements');
    if (list) list.innerHTML = metaElementRows();
    const status = document.getElementById('meta-element-status');
    if (status) status.innerHTML = metaElementStatus();
}

function setMetaStatus(text) {
    const status = document.getElementById('meta-status-text');
    if (status) status.textContent = text;
}

function onMetaChange(event) {
    const key = event.target.dataset?.metaElement;
    if (key === undefined) return;
    _metaDraft = { ..._metaDraft, touched: true };
    if (event.target.checked) _metaDraft.selected.add(key);
    else _metaDraft.selected.delete(key);
}

// 새 차시는 기본 제목이 같으므로, 이미 겹치던 제목은 경고만 하고 저장을 막지 않는다. 바꿔서 겹치게 될 때만 막는다.
function metaTitleBlocked(title, mod) {
    return !title || (title !== mod.title && lessonTitleTaken(title, mod.id));
}

function onMetaInput(event) {
    if (event.target.id !== 'meta-title') return;
    const title = event.target.value.trim();
    const { mod } = _metaDraft;
    document.getElementById('meta-title-warning').textContent = lessonTitleTaken(title, mod.id) ? '같은 제목의 차시가 이미 있습니다.' : '';
    document.getElementById('meta-save').disabled = metaTitleBlocked(title, mod);
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

// 확정한 선택이 있으면 추천은 후보로만 보여 주고 체크를 바꾸지 않는다
async function runElementRecommend(button) {
    const draft = _metaDraft;
    button.disabled = true;
    setMetaStatus('능력단위요소를 분석하고 있습니다...');
    try {
        const { recs, note } = await recommendLessonElements(draft.subject, draft.mod);
        Object.assign(draft.mod, { ncsRecs: recs, ncsNote: note, ncsAutoTried: true });
        await saveState();
        if (_metaDraft?.mod !== draft.mod) return;
        if (!hasConfirmedElements(draft.mod)) pickLessonElements(recs).forEach(rec => _metaDraft.selected.add(elementKey(recToElement(rec))));
        setMetaStatus('');
        refreshMetaElements();
    } catch (err) {
        console.error('[차시 정보] 요소 추천 실패:', err);
        setMetaStatus(err.message);
    } finally {
        button.disabled = false;
    }
}

// 교안이 있는 차시를 처음 열 때 한 번 배정한다. 확정은 사용자가 한다.
async function runElementAutoAssign() {
    const draft = _metaDraft;
    setMetaStatus('능력단위요소를 자동 배정하고 있습니다...');
    try {
        const assigned = await assignLessonElements(draft.subject, draft.mod);
        await saveState();
        if (_metaDraft?.mod === draft.mod) {
            if (!_metaDraft.touched) _metaDraft = { ..._metaDraft, selected: new Set((draft.mod.ncsElements || []).map(elementKey)) };
            setMetaStatus(assigned ? '적합도가 높은 항목을 배정했습니다. 확인 후 확정해주세요.' : '자동 배정할 만한 항목을 찾지 못했습니다. 직접 선택해주세요.');
            refreshMetaElements();
        }
    } catch (err) {
        console.error('[차시 정보] 요소 자동 배정 실패:', err);
        setMetaStatus(`자동 배정 실패: ${err.message}`);
    }
    renderSidebar();
    applyLessonFilter();
}

// 고른 항목이 그대로면 미확정 상태를 유지한다. 사용자가 고쳐 저장하거나 확정을 누르면 확정이다.
function metaElementResult() {
    const { mod, options, selected, confirm } = _metaDraft;
    const picked = lessonElementEntries(mod, options).filter(entry => selected.has(entry.key)).map(entry => entry.element);
    const before = (mod.ncsElements || []).map(elementKey);
    const same = before.length === picked.length && picked.every(element => before.includes(elementKey(element)));
    if (same && !confirm) return { ncsElements: mod.ncsElements || [], ncsAuto: !!mod.ncsAuto };
    return { ncsElements: picked.map(({ auto, ...element }) => element), ncsAuto: false };
}

function readMetaPrereqs(dialog, mod) {
    const chosen = mod.prereqs || [];
    const live = [...dialog.querySelectorAll('[data-meta-prereq]:checked')]
        .map(box => allLessonEntries().find(({ lesson }) => String(lesson.id) === box.dataset.metaPrereq)?.lesson)
        .filter(Boolean)
        .map(lesson => ({ id: lesson.id, title: lesson.title }));
    const broken = [...dialog.querySelectorAll('[data-meta-prereq-broken]:checked')].map(box => chosen[Number(box.dataset.metaPrereqBroken)]);
    return [...broken, ...live];
}

async function saveLessonMeta() {
    const { mod, subject } = _metaDraft;
    const dialog = document.getElementById('lesson-meta-dialog');
    const title = document.getElementById('meta-title').value.trim();
    if (metaTitleBlocked(title, mod)) return;
    const next = {
        title,
        category: document.getElementById('meta-category').value.trim(),
        reviewStatus: document.getElementById('meta-status').value,
        tools: parseToolLines(document.getElementById('meta-tools').value),
        prereqs: readMetaPrereqs(dialog, mod),
        ...metaElementResult()
    };
    Object.assign(mod, withMetaHistory(mod, next));
    const targetId = document.getElementById('meta-subject').value;
    if (targetId !== String(subject.id) && moveLessonToSubject(mod, targetId)) closeMovedLesson(mod);
    await saveState();
    closeLessonMeta();
    renderSidebar();
    applyLessonFilter();
}

async function addMetaHistoryNote() {
    const input = document.getElementById('meta-history-note');
    const note = input.value.trim();
    if (!note) return;
    Object.assign(_metaDraft.mod, withHistoryNote(_metaDraft.mod, note));
    input.value = '';
    document.getElementById('meta-history').innerHTML = metaHistoryRows(_metaDraft.mod);
    await saveState();
}

async function onMetaClick(event) {
    const action = event.target.dataset?.metaAction;
    if (action === 'close') closeLessonMeta();
    if (action === 'register') registerElements();
    if (action === 'recommend') await runElementRecommend(event.target);
    if (action === 'add-note') await addMetaHistoryNote();
    if (action === 'rename-category') await renameCategoryFromDialog(event.target.dataset.category);
    if (action === 'delete-category') deleteCategoryFromDialog(event.target.dataset.category);
    if (action === 'save') await saveLessonMeta();
    if (action === 'confirm-elements') {
        _metaDraft = { ..._metaDraft, confirm: true };
        await saveLessonMeta();
    }
}
