// course-list.js - 차시 목록 보조: 카테고리 묶음, NCS 필터, 목록 배지, 카테고리 관리, 교과 간 이동
// develocket-slide(assets/course-workspace.js @3a7303f)의 학습모듈 목록 기능을 Teacher의 교과별 차시 목록에 옮겼다.
// 카드 마크업은 api.js에 있으므로 묶음은 그려진 카드를 재배치해 만든다. 번호와 드래그 정렬은 courseData 순서를 그대로 쓴다.

const LESSON_NCS_NONE = '__none';
const LESSON_NO_CATEGORY = '(카테고리 없음)';

let _ncsFilterDraft = null;

/* ---------- 배지 ---------- */
function lessonBadge(text, style, title = '') {
    return `<span class="text-[0.6rem] font-bold px-1.5 py-0.5 rounded ${style}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}

function lessonListBadges(mod) {
    const required = lessonRequiredIssues(mod);
    const questions = lessonQuestionSpans(qbankMarkdown(mod)).length;
    const elements = (mod.ncsElements || []).length;
    const brokenPrereqs = (mod.prereqs || []).filter(item => findLessonPrereq(item, mod.id).state !== 'ok').length;
    return [
        required.length ? lessonBadge(`필수 위반 ${required.length}`, 'bg-rose-500/20 text-rose-300', required.map(issue => issue.msg).join('\n')) : '',
        questions ? lessonBadge(`문항 ${questions}`, 'bg-white/10 text-textLight') : '',
        elements ? lessonBadge(`NCS ${elements}${mod.ncsAuto ? '?' : ''}`, 'bg-white/10 text-textLight', mod.ncsAuto ? '자동 배정 · 확정 전' : '확정됨') : '',
        lessonTitleTaken(mod.title, mod.id) ? lessonBadge('제목 중복', 'bg-amber-500/20 text-amber-300') : '',
        brokenPrereqs ? lessonBadge(`선행 미등록 ${brokenPrereqs}`, 'bg-amber-500/20 text-amber-300') : ''
    ].join('');
}

/* ---------- 카테고리별 묶음 ---------- */
function renderLessonViewBar() {
    const active = 'bg-accent text-white';
    const idle = 'bg-white/10 text-textMuted';
    const count = _lessonFilter.ncs.length;
    return `
        <div class="flex flex-wrap items-center gap-1">
            <button onclick="toggleLessonGroup()" class="text-[0.6rem] px-1.5 py-0.5 rounded ${_lessonFilter.group ? active : idle}">카테고리별</button>
            <button onclick="openLessonNcsFilter()" class="text-[0.6rem] px-1.5 py-0.5 rounded ${count ? active : idle}">NCS 필터${count ? ` ${count}` : ''}</button>
            ${count ? '<button onclick="clearLessonNcsFilter()" class="text-[0.6rem] px-1 text-textMuted hover:text-white" title="NCS 필터 해제">✕</button>' : ''}
        </div>`;
}

// 카테고리 없는 차시는 맨 뒤에 둔다
function groupLessonsByCategory(lessons) {
    const names = [...new Set(lessons.map(lesson => lesson.category || ''))].sort((a, b) => (!a) - (!b) || a.localeCompare(b, 'ko'));
    return names.map(name => ({ name, title: name || LESSON_NO_CATEGORY, lessons: lessons.filter(lesson => (lesson.category || '') === name) }));
}

function lessonGroupHead(group) {
    const head = document.createElement('div');
    head.className = 'lesson-group-head text-[0.65rem] font-bold text-textMuted mt-2 mb-1 px-1';
    head.dataset.category = group.name;
    head.textContent = `${group.title} · ${group.lessons.length}`;
    return head;
}

function refreshLessonGroupHeads() {
    document.querySelectorAll('.lesson-group-head').forEach(head => {
        const visible = courseData.some(lesson => (lesson.category || '') === head.dataset.category && lessonMatchesFilter(lesson));
        head.classList.toggle('hidden', !visible);
    });
}

// renderSidebar가 그린 직후 부른다. 카드를 다시 만들지 않으므로 드래그와 체크 상태가 유지된다.
function applyLessonGrouping() {
    if (!_lessonFilter.group) return;
    const cards = [...document.querySelectorAll('.module-card[data-id]')].filter(card => card.dataset.id !== 'mainQuest');
    if (!cards.length) return;
    const parent = cards[0].parentElement;
    const slot = document.createComment('lesson-groups');
    parent.insertBefore(slot, cards[0]);
    groupLessonsByCategory(courseData).forEach(group => {
        parent.insertBefore(lessonGroupHead(group), slot);
        group.lessons.forEach(lesson => {
            const card = cards.find(item => item.dataset.id === String(lesson.id));
            if (card) parent.insertBefore(card, slot);
        });
    });
    slot.remove();
    refreshLessonGroupHeads();
}

window.toggleLessonGroup = function () {
    _lessonFilter = { ..._lessonFilter, group: !_lessonFilter.group };
    renderSidebar();
};

/* ---------- NCS 필터 ---------- */
function lessonMatchesNcs(lesson) {
    const { ncs } = _lessonFilter;
    if (!ncs.length) return true;
    const keys = (lesson.ncsElements || []).map(elementKey);
    return keys.length ? keys.some(key => ncs.includes(key)) : ncs.includes(LESSON_NCS_NONE);
}

// 이 교과의 차시가 쓰는 능력단위요소와 차시 수
function lessonNcsUsage(lessons) {
    const usage = new Map();
    lessons.forEach(lesson => (lesson.ncsElements || []).forEach(element => {
        const key = elementKey(element);
        usage.set(key, { key, element, count: (usage.get(key)?.count || 0) + 1 });
    }));
    return { rows: [...usage.values()].sort((a, b) => a.key.localeCompare(b.key)), none: lessons.filter(lesson => !(lesson.ncsElements || []).length).length };
}

function ncsFilterRowHtml(key, label, count) {
    return `
        <label class="flex items-center gap-2 p-1.5 rounded hover:bg-white/5 text-xs text-textLight">
            <input type="checkbox" data-ncs-filter="${escapeHtml(key)}" ${_ncsFilterDraft.has(key) ? 'checked' : ''}>
            <span class="flex-1 min-w-0">${escapeHtml(label)}</span><span class="text-[0.6rem] text-textMuted">${count}</span>
        </label>`;
}

window.openLessonNcsFilter = function () {
    if (document.getElementById('lesson-ncs-filter')) return;
    _ncsFilterDraft = new Set(_lessonFilter.ncs);
    const { rows, none } = lessonNcsUsage(courseData);
    const overlay = document.createElement('div');
    overlay.id = 'lesson-ncs-filter';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[460px] max-h-[80vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10">
                <h2 class="text-sm font-bold text-textLight">NCS 필터</h2>
                <p class="text-[0.65rem] text-textMuted mt-1">고른 능력단위요소에 대응한 차시만 목록에 보입니다.</p>
            </div>
            <div class="flex-1 overflow-y-auto p-3">
                ${ncsFilterRowHtml(LESSON_NCS_NONE, 'NCS 미대응 차시', none)}
                ${rows.map(row => ncsFilterRowHtml(row.key, `${elementLabel(row.element)} · ${row.element.unitName || ''}`, row.count)).join('') || '<p class="text-xs text-textMuted p-2">아직 NCS를 대응한 차시가 없습니다.</p>'}
            </div>
            <div class="p-3 border-t border-white/10 flex justify-end gap-2">
                <button data-ncs-filter-action="clear" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">해제</button>
                <button data-ncs-filter-action="apply" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">적용</button>
            </div>
        </div>`;
    overlay.addEventListener('click', onNcsFilterClick);
    overlay.addEventListener('change', onNcsFilterChange);
    document.body.appendChild(overlay);
};

function onNcsFilterChange(event) {
    const key = event.target.dataset?.ncsFilter;
    if (key === undefined) return;
    if (event.target.checked) _ncsFilterDraft.add(key);
    else _ncsFilterDraft.delete(key);
}

function setLessonNcsFilter(keys) {
    _lessonFilter = { ..._lessonFilter, ncs: keys };
    document.getElementById('lesson-ncs-filter')?.remove();
    renderSidebar();
    applyLessonFilter();
}

function onNcsFilterClick(event) {
    const action = event.target.dataset?.ncsFilterAction;
    if (action === 'apply') setLessonNcsFilter([..._ncsFilterDraft]);
    if (action === 'clear') setLessonNcsFilter([]);
}

window.clearLessonNcsFilter = () => setLessonNcsFilter([]);

/* ---------- 카테고리 관리 ---------- */
function lessonCategories() {
    const counts = new Map();
    allLessonEntries().forEach(({ lesson }) => {
        if (lesson.category) counts.set(lesson.category, (counts.get(lesson.category) || 0) + 1);
    });
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

// 차시 객체는 편집 화면이 직접 참조하므로 제자리에서 바꾼다
function changeLessonCategory(from, to, note) {
    const lessons = allLessonEntries().map(entry => entry.lesson).filter(lesson => lesson.category === from);
    lessons.forEach(lesson => Object.assign(lesson, { category: to }, withHistoryNote(lesson, note)));
    return lessons.length;
}

function renameLessonCategory(from, to) {
    return changeLessonCategory(from, to, `카테고리 이름 변경: ${from} → ${to}`);
}

function deleteLessonCategory(name) {
    return changeLessonCategory(name, '', `카테고리 삭제: ${name}`);
}

function lessonCategoryRowsHtml() {
    const rows = lessonCategories().map((item, index) => `
        <div class="flex items-center gap-2">
            <input data-category-input="${index}" value="${escapeHtml(item.name)}" class="flex-1 px-2 py-0.5 text-xs bg-black/30 border border-white/10 rounded text-white">
            <span class="text-[0.6rem] shrink-0">${item.count}개 차시</span>
            <button data-meta-action="rename-category" data-category="${escapeHtml(item.name)}" class="underline text-textLight shrink-0">이름 바꾸기</button>
            <button data-meta-action="delete-category" data-category="${escapeHtml(item.name)}" class="underline text-rose-300 shrink-0">삭제</button>
        </div>`);
    return rows.join('') || '<p>카테고리가 없습니다.</p>';
}

function refreshMetaCategories() {
    const rows = document.getElementById('meta-category-rows');
    if (rows) rows.innerHTML = lessonCategoryRowsHtml();
    const list = document.getElementById('meta-categories');
    if (list) list.innerHTML = lessonCategories().map(item => `<option value="${escapeHtml(item.name)}"></option>`).join('');
}

async function afterCategoryChange(from, to) {
    const field = document.getElementById('meta-category');
    if (field?.value === from) field.value = to;
    refreshMetaCategories();
    await saveState();
}

async function renameCategoryFromDialog(from) {
    const index = lessonCategories().findIndex(item => item.name === from);
    const to = document.querySelector(`[data-category-input="${index}"]`)?.value.trim();
    if (!to || to === from) return;
    const count = renameLessonCategory(from, to);
    await afterCategoryChange(from, to);
    window.showToast?.(`${count}개 차시의 카테고리를 바꿨습니다.`, 'success');
}

function deleteCategoryFromDialog(name) {
    window.showConfirm(`카테고리 '${name}'를 지울까요? 이 카테고리를 쓰던 차시는 카테고리 없음이 됩니다.`, () => {
        deleteLessonCategory(name);
        return afterCategoryChange(name, '');
    });
}

/* ---------- 교과 간 이동 ---------- */
// 차시 객체를 그대로 옮기므로 교안·문항·삽화·이력이 함께 간다
function moveLessonToSubject(lesson, targetId) {
    const from = globalState.subjects.find(item => item.id === currentSubjectId);
    const target = globalState.subjects.find(item => String(item.id) === String(targetId));
    if (!from || !target || target === from) return false;
    courseData = courseData.filter(item => item !== lesson);
    from.lessons = courseData;
    target.lessons = [...(target.lessons || []), lesson];
    Object.assign(lesson, withHistoryNote(lesson, `교과 이동: ${from.title} → ${target.title}`));
    return true;
}

// 옮긴 차시가 편집기에 열려 있으면 다른 교과의 내용을 고치지 않도록 닫는다
function closeMovedLesson(lesson) {
    if (String(currentEditingModuleId) !== String(lesson.id)) return;
    currentEditingModuleId = null;
    document.getElementById('editor-content-area').innerHTML = '<div class="h-full flex items-center justify-center text-textMuted text-sm">차시를 다른 교과로 옮겼습니다.</div>';
    document.getElementById('ai-command-bar')?.classList.add('hidden');
}
