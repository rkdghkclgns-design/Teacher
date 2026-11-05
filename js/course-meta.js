// course-meta.js - 차시 메타데이터: 카테고리, 작업 상태, 사용 툴·버전, 선행 차시, NCS 능력단위요소, 변경 이력, 휴지통
// develocket-slide(assets/course-workspace.js, course-ncs.js @3a7303f)의 학습모듈 관리를 Teacher의 차시 목록에 옮겼다.
// 버전 의존 정보는 본문이 아니라 여기서 관리한다는 컨벤션을 함께 따른다.

const LESSON_STATUSES = ['작성중', '검수중', '완료', '개선필요'];
const LESSON_HISTORY_LIMIT = 20;
const LESSON_TRASH_LIMIT = 100;
const LESSON_TRASH_DAYS = 30;
const LESSON_TRASH_REWRITE = 'rewrite'; // 다시 만들기 전 사본: 개수 상한에서 빼고 30일이 지나야 지운다
const DAY_MS = 86400000;
const FLOW_PHASES = ['도입', '전개', '정리'];
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

// 형식: "단계 | 내용 | 분". 단계를 빼고 "내용 | 분"만 적으면 전개로 본다
function parseFlowLines(text) {
    return String(text || '').split('\n')
        .map(line => line.split('|').map(part => part.trim()))
        .filter(parts => parts.some(Boolean))
        .map(parts => {
            const [phase, title, minutes] = parts.length > 2 ? parts : ['전개', ...parts];
            return { phase: FLOW_PHASES.includes(phase) ? phase : '전개', title: title || '', minutes: Math.max(1, Number.parseInt(minutes, 10) || DESIGN_FLOW_STEP_MINUTES) };
        })
        .filter(step => step.title);
}

const flowLinesText = flow => (flow || []).map(step => `${step.phase} | ${step.title} | ${step.minutes}`).join('\n');
const flowTotal = flow => flow.reduce((sum, step) => sum + step.minutes, 0);

// 진행 단계 합계가 차시 시간이 된다. 단계를 비우면 시간은 그대로 둔다
function lessonFlowPatch(flow) {
    if (!flow.length) return { flow };
    const minutes = flowTotal(flow);
    return { flow, minutes, hours: Math.round(minutes / 60 * 100) / 100 };
}

function metaFlowNote(text, mod) {
    const flow = parseFlowLines(text);
    if (!flow.length) return '';
    const total = flowTotal(flow);
    const current = lessonMinutes(mod);
    return !current || total === current ? `합계 ${fmtMinutes(total)}` : `합계 ${fmtMinutes(total)}. 저장하면 차시 시간이 ${fmtMinutes(current)}에서 ${fmtMinutes(total)}이 됩니다.`;
}

function metaChanges(mod, next) {
    const changed = (key, label, empty = []) => (JSON.stringify(mod[key] ?? empty) !== JSON.stringify(next[key] ?? empty) ? label : '');
    const status = lessonStatus(mod) !== next.reviewStatus ? `상태: ${lessonStatus(mod)} → ${next.reviewStatus}` : '';
    return [changed('title', '제목', ''), status, changed('category', '카테고리', ''), changed('objectives', '학습 목표'), changed('flow', '진행 단계'), changed('tools', '툴·버전'), changed('prereqs', '선행 차시'), changed('ncsElements', 'NCS 요소'), changed('gen', '생성 옵션', {})].filter(Boolean);
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

// 저장해 둔 시각(ISO 글자, UTC)을 이 컴퓨터 시각 'YYYY-MM-DD HH:MM'으로. 글자가 아니거나 읽을 수 없으면 빈 글(휴지통·변경 이력·수동 검수)
function localTimeText(value) {
    if (typeof value !== 'string') return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

// 지운 차시는 LESSON_TRASH_LIMIT개까지 두고 넘치면 목록 뒤쪽부터 뺀다(새 항목이 앞이다).
// 한 번에 LESSON_TRASH_LIMIT개보다 많이 넣으면 새 항목도 뒤쪽은 빠진다(droppedNew: 그렇게 빠진 새 항목 수).
// 다시 만들기 전 사본은 세지 않는다(큰 과정을 다시 만들어도 자기 사본을 밀어내지 않게). 날짜가 앞날인 사본은 세어 끝없이 남지 않게 한다
function addToLessonTrash(trash, entries, now = Date.now(), limit = LESSON_TRASH_LIMIT) {
    const all = [...entries, ...liveLessonTrash(trash, now)];
    const exempt = entry => entry.kind === LESSON_TRASH_REWRITE && trashAgeDays(entry, now) >= 0;
    let regular = 0;
    const keep = all.map(entry => exempt(entry) || ++regular <= limit);
    return {
        trash: all.filter((_, i) => keep[i]),
        dropped: keep.filter(ok => !ok).length,
        droppedNew: keep.slice(0, entries.length).filter(ok => !ok).length
    };
}

// 빠지는 차시가 꼭 오래된 것만은 아니다(한 번에 많이 지우면 방금 지운 차시도 빠진다). 그때는 그 수를 함께 말한다
const lessonTrashCapText = (count, fresh = 0) => `휴지통에는 지운 차시를 ${LESSON_TRASH_LIMIT}개까지 둡니다. 넘친 ${count}개${fresh ? `(방금 지운 차시 ${fresh}개 포함)` : ''}를 완전히 지웠습니다.`;

// reason: 휴지통 목록에 보일 까닭. kind: LESSON_TRASH_REWRITE면 개수 상한에서 뺀다
function moveLessonsToTrash(lessons, subjectId = currentSubjectId, { reason = '', kind = '' } = {}) {
    const at = new Date().toISOString();
    const entries = lessons.map(lesson => ({ lesson, subjectId, at, ...(reason ? { reason } : {}), ...(kind ? { kind } : {}) }));
    const { trash, dropped, droppedNew } = addToLessonTrash(globalState.lessonTrash, entries);
    globalState.lessonTrash = trash;
    if (dropped) window.showToast?.(lessonTrashCapText(dropped, droppedNew), 'warning');
}

// 글(문자열)은 바뀌지 않으므로 함께 쓰고 객체·배열만 새로 만든다. 그림이 많은 차시를 메모리에 두 벌 두지 않는다
const copyLessonTree = value => (Array.isArray(value) ? value.map(copyLessonTree)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyLessonTree(item)]))
        : value);

// 다시 만들기 전 사본: 차시를 통째로(탭·옛 본문·교수안과 슬라이드 화면 편집·그림·삽화·판서 영상 연결·차시 정보) 복사해 휴지통에 넣는다.
// 넣은 사본을 돌려준다(다시 만들지 못해 되돌리면 그 사본을 휴지통에서 뺀다, course-flow.js)
function trashLessonCopy(mod, subjectId = currentSubjectId) {
    const copy = copyLessonTree(mod);
    moveLessonsToTrash([copy], subjectId, { reason: '다시 만들기 전', kind: LESSON_TRASH_REWRITE });
    return copy;
}

// 목록을 그릴 때마다 지난 항목을 비운다. 다음 저장에 함께 반영된다.
function renderLessonTrashButton() {
    if (globalState.lessonTrash?.length) globalState.lessonTrash = liveLessonTrash(globalState.lessonTrash);
    const count = (globalState.lessonTrash || []).length;
    return count ? `<button onclick="openLessonTrash()" class="text-[0.6875rem] font-bold px-2 py-0.5 mr-1 rounded bg-white/10 text-textMuted hover:bg-white/20" title="삭제한 차시 복원">휴지통 ${count}</button>` : '';
}

function restoreLesson(index) {
    const entry = globalState.lessonTrash[index];
    const subject = globalState.subjects.find(item => item.id === entry.subjectId) || globalState.subjects.find(item => item.id === currentSubjectId);
    if (!subject) return false;
    // 남이 준 백업의 휴지통에서 왔을 수 있어 검사하고, 같은 교과 안에서 id가 겹치면 새 숫자를 준다(data-safety.js)
    const cleaned = typeof cleanTrashLesson === 'function' ? cleanTrashLesson(entry.lesson) : entry.lesson;
    const siblings = subject.id === currentSubjectId ? courseData : (subject.lessons || []);
    const clash = siblings.some(item => String(item.id) === String(cleaned.id));
    const unique = clash && typeof renumberLessons === 'function' ? renumberLessons([cleaned], siblings.map(item => item.id))[0] : cleaned;
    const lesson = lessonTitleTaken(unique.title, unique.id) ? { ...unique, title: `${unique.title} (복원)` } : unique;
    // 다시 만들기 전 사본은 다시 만든 차시(같은 교과의 같은 id) 바로 아래에 둔다. 그 교과나 차시가 없으면 맨 아래
    const after = entry.kind === LESSON_TRASH_REWRITE && subject.id === entry.subjectId ? siblings.findIndex(item => String(item.id) === String(cleaned.id)) : -1;
    const placed = after >= 0 ? [...siblings.slice(0, after + 1), lesson, ...siblings.slice(after + 1)] : [...siblings, lesson];
    if (subject.id === currentSubjectId) courseData = placed;
    subject.lessons = placed;
    globalState.lessonTrash = globalState.lessonTrash.filter((_, i) => i !== index);
    return true;
}

// 교과 목록 아래 휴지통 버튼. 교과와 차시를 함께 센다
function renderTrashFooter() {
    const subjects = typeof liveSubjectTrash === 'function' ? liveSubjectTrash().length : 0;
    const lessons = liveLessonTrash(globalState.lessonTrash).length;
    if (!subjects && !lessons) return '';
    return `<button onclick="openLessonTrash()" class="w-full mt-1 h-8 flex items-center justify-center gap-1 rounded border border-dashed border-white/15 text-[0.6875rem] font-bold text-textMuted hover:bg-white/5 hover:text-textLight" title="지운 교과와 차시를 되살립니다"><i class="ph-bold ph-trash"></i> 휴지통 · 교과 ${subjects} · 차시 ${lessons}</button>`;
}

// 휴지통 교과 항목의 차시 수. 차시 목록이 배열일 때만 센다(남이 준 백업의 { length: '<img …>' } 같은 값을 화면에 넣지 않게)
const trashSubjectLessonCount = entry => (Array.isArray(entry?.subject?.lessons) ? entry.subject.lessons.length : 0);

// 휴지통 창에 지금 그려 둔 항목(교과·차시 항목 객체). 버튼의 data-index는 이 목록의 자리다.
// 복원·완전 삭제는 그린 항목 그대로 찾는다(앞 줄을 되살려 목록이 당겨진 뒤, 다시 그리기 전에 누른 버튼이 다음 항목을 가리키지 않게)
let _trashRows = { subjects: [], lessons: [] };

function renderSubjectTrashRows() {
    const entries = typeof liveSubjectTrash === 'function' ? liveSubjectTrash() : [];
    _trashRows = { ..._trashRows, subjects: entries };
    return entries.map((entry, index) => `
            <div class="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 text-xs text-textLight">
                <span class="flex-1 min-w-0 truncate"><i class="ph-bold ph-books"></i> 교과 · ${escapeHtml(entry.subject.title)}<span class="block text-[0.6875rem] text-textMuted">차시 ${trashSubjectLessonCount(entry)}개 · ${escapeHtml(localTimeText(entry.at))}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''} · 남은 기간 ${trashDaysLeft(entry)}일</span></span>
                <button data-trash-action="restore-subject" data-index="${index}" class="px-2 py-1 font-bold bg-accent text-white rounded">복원</button>
                <button data-trash-action="purge-subject" data-index="${index}" class="px-2 py-1 font-bold bg-white/10 text-rose-300 rounded">완전 삭제</button>
            </div>`).join('');
}

function renderTrashRows() {
    const subjectRows = renderSubjectTrashRows();
    _trashRows = { ..._trashRows, lessons: [...(globalState.lessonTrash || [])] };
    const rows = (globalState.lessonTrash || []).map((entry, index) => {
        const subject = globalState.subjects.find(item => item.id === entry.subjectId);
        // 까닭('다시 만들기 전')이 붙으면 부제가 길어지므로 잘라 내지 않고 줄을 바꿔 남은 기간까지 보인다
        return `
            <div class="flex items-center gap-2 p-2 rounded-lg bg-white/5 text-xs text-textLight">
                <span class="flex-1 min-w-0 truncate">${escapeHtml(entry.lesson.title)}<span class="block text-[0.6875rem] text-textMuted whitespace-normal break-keep">${escapeHtml(subject?.title || '삭제된 교과')} · ${escapeHtml(localTimeText(entry.at))}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''} · 남은 기간 ${trashDaysLeft(entry)}일</span></span>
                <button data-trash-action="restore" data-index="${index}" class="px-2 py-1 font-bold bg-accent text-white rounded">복원</button>
                <button data-trash-action="purge" data-index="${index}" class="px-2 py-1 font-bold bg-white/10 text-rose-300 rounded">완전 삭제</button>
            </div>`;
    });
    return (subjectRows + rows.join('')) || '<p class="text-xs text-textMuted">휴지통이 비었습니다.</p>';
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
                    <h2 class="text-sm font-bold text-textLight">휴지통</h2>
                    <button data-trash-action="empty" class="ml-auto px-3 py-1 text-xs font-bold text-rose-300 bg-white/10 rounded">휴지통 비우기</button>
                    <button data-trash-action="close" class="px-3 py-1 text-xs font-bold text-textLight bg-white/10 rounded">닫기</button>
                </div>
                <p class="text-xs text-textMuted mt-1">지운 교과와 차시는 ${LESSON_TRASH_DAYS}일 동안 보관한 뒤 자동으로 지웁니다.</p>
            </div>
            <div id="lesson-trash-rows" class="flex-1 overflow-y-auto p-4 space-y-2">${renderTrashRows()}</div>
        </div>`;
    overlay.addEventListener('click', onTrashClick);
    document.body.appendChild(overlay);
};

async function refreshTrash() {
    await saveState();
    if (typeof renderSidebar === 'function') renderSidebar();
    if (typeof applyLessonFilter === 'function') applyLessonFilter();
    if (typeof renderOverviewLNB === 'function') renderOverviewLNB();
    if (typeof renderDiagram === 'function') renderDiagram();
    const rows = document.getElementById('lesson-trash-rows');
    if (rows) rows.innerHTML = renderTrashRows();
}

async function onTrashClick(event) {
    const action = event.target.dataset?.trashAction;
    if (!action) return;
    if (action === 'close') return document.getElementById('lesson-trash-dialog')?.remove();
    if (action === 'empty') {
        return window.showConfirm('휴지통의 교과와 차시를 모두 영구 삭제할까요? 되돌릴 수 없습니다.', () => {
            globalState.lessonTrash = [];
            globalState.subjectTrash = [];
            return refreshTrash();
        }, { okLabel: '영구 삭제', title: '휴지통 비우기' });
    }
    // 누른 줄에 그려 둔 항목. 그사이 되살리거나 지워 휴지통에 없으면 아무것도 하지 않는다(두 번 눌러 다음 항목까지 되살리거나 지우지 않게)
    const index = Number(event.target.dataset.index);
    if (action === 'restore-subject') {
        const at = liveSubjectTrash().indexOf(_trashRows.subjects[index]);
        if (at < 0) return;
        const subject = restoreSubject(at);
        if (!subject) return window.showAlert('복원할 교과를 찾지 못했습니다.');
        window.showToast?.(`'${subject.title}' 교과를 복원했습니다.`, 'success');
        return refreshTrash();
    }
    if (action === 'purge-subject') {
        const entry = _trashRows.subjects[index];
        if (!entry || !liveSubjectTrash().includes(entry)) return;
        return window.showConfirm(`'${entry.subject.title}' 교과와 차시 ${trashSubjectLessonCount(entry)}개를 영구 삭제합니다. 되돌릴 수 없습니다.`, () => {
            globalState.subjectTrash = liveSubjectTrash().filter(item => item !== entry);
            return refreshTrash();
        }, { okLabel: '영구 삭제', title: '교과 영구 삭제' });
    }
    const entry = _trashRows.lessons[index];
    if (!entry || !(globalState.lessonTrash || []).includes(entry)) return;
    if (action === 'restore') {
        if (!restoreLesson(globalState.lessonTrash.indexOf(entry))) return window.showAlert('복원할 교과를 찾지 못했습니다.');
        window.showToast?.(`'${entry.lesson.title}' 차시를 복원했습니다.`, 'success');
    }
    if (action === 'purge') {
        return window.showConfirm(`'${entry.lesson.title}' 차시를 영구 삭제합니다. 되돌릴 수 없습니다.`, () => {
            globalState.lessonTrash = globalState.lessonTrash.filter(item => item !== entry);
            return refreshTrash();
        }, { okLabel: '영구 삭제', title: '차시 영구 삭제' });
    }
    await refreshTrash();
}

/* ---------- 차시 목록 ---------- */
// extra: 카드가 함께 보일 칩 (올린 MD 파일 등)
function renderLessonMetaChips(mod, { extra = '' } = {}) {
    const tools = (mod.tools || []).map(toolLabel).join(', ');
    return `
        <div class="mt-2 flex flex-wrap items-center gap-1">
            ${mod.status === 'done' ? '' : '<span class="text-[0.6875rem] px-1.5 py-0.5 rounded border border-dashed border-white/25 text-textLight">교안 없음</span>'}
            <button onclick="event.stopPropagation(); openLessonMeta(${mod.id})" class="text-[0.6875rem] font-bold px-1.5 py-0.5 rounded ${LESSON_STATUS_STYLES[lessonStatus(mod)]}" title="차시 정보 편집">${lessonStatus(mod)}</button>
            ${lessonHoursChip(mod)}
            ${mod.category ? `<span class="text-[0.6875rem] px-1.5 py-0.5 rounded bg-white/10 text-textLight">${escapeHtml(mod.category)}</span>` : ''}
            ${tools ? `<span class="text-[0.6875rem] text-textMuted truncate max-w-[150px]" title="${escapeHtml(tools)}">${escapeHtml(tools)}</span>` : ''}
            ${lessonListBadges(mod)}
            ${extra}
        </div>`;
}

function renderLessonFilterBar() {
    const counts = LESSON_STATUSES.map(status => [status, courseData.filter(lesson => lessonStatus(lesson) === status).length]);
    const chip = (value, label, count) => `<button onclick="setLessonStatusFilter('${value}')" class="text-[0.6875rem] px-1.5 py-0.5 rounded ${_lessonFilter.status === value ? 'bg-accent text-white' : 'bg-white/10 text-textMuted'}">${label} ${count}</button>`;
    return `
        <div class="mb-2 space-y-1">
            <input oninput="setLessonQueryFilter(this.value)" value="${escapeHtml(_lessonFilter.query)}" placeholder="차시 검색 (제목·카테고리·목표)" class="w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white focus:outline-none focus:border-accent">
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
    if (!entries.length) return '<p class="text-xs text-textMuted">AI 추천을 누르면 교안을 분석해 고를 항목을 보여 줍니다. 요소를 등록하지 않았으면 능력단위 수준으로 추천합니다.</p>';
    return entries.map(entry => elementRowHtml(entry, selected.has(entry.key))).join('');
}

function metaElementStatus() {
    const { mod } = _metaDraft;
    const note = mod.ncsNote ? `<p class="text-xs text-textMuted mb-1">${escapeHtml(mod.ncsNote)}</p>` : '';
    if (!mod.ncsAuto) return note;
    return `
        <div class="flex items-center gap-2 mb-1">
            <span class="text-[0.6875rem] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">자동 배정 · 확정 전</span>
            <button data-meta-action="confirm-elements" class="text-[0.6875rem] font-bold px-2 py-0.5 rounded bg-accent text-white">확인하고 확정</button>
        </div>${note}`;
}

function metaElementSearchHtml() {
    return `
        <input id="meta-element-search" type="search" placeholder="코드·능력단위·요소 이름으로 직접 찾기" class="w-full px-2 py-1 mb-1 text-xs bg-black/30 border border-white/10 rounded text-white">
        <div id="meta-element-results" class="max-h-36 overflow-y-auto mb-1"></div>`;
}

function metaSearchRowHtml(option) {
    const key = elementKey(option);
    const picked = _metaDraft.selected.has(key);
    const label = option.unitLevel ? elementLabel(option) : `${option.unitName} · ${elementLabel(option)}`;
    return `<button data-meta-action="pick-element" data-key="${escapeHtml(key)}" ${picked ? 'disabled' : ''} class="block w-full text-left px-2 py-1 text-[0.7rem] text-textLight rounded hover:bg-white/10 disabled:opacity-50">${picked ? '✓' : '+'} ${escapeHtml(label)}</button>`;
}

function renderMetaSearch() {
    const box = document.getElementById('meta-element-results');
    if (!box) return;
    const { found = [], searched = false } = _metaDraft;
    box.innerHTML = found.length || !searched ? found.map(metaSearchRowHtml).join('') : '<p class="px-2 py-1 text-xs text-textMuted">찾는 항목이 없습니다.</p>';
}

function searchMetaElements(query) {
    try {
        _metaDraft = { ..._metaDraft, found: searchElementOptions(query), searched: !!query.trim() };
        renderMetaSearch();
    } catch (err) {
        console.error('[차시 정보] 요소 검색 실패:', err);
        setMetaStatus(`검색 실패: ${err.message}`);
    }
}

// 고른 항목은 목록에 더해 체크한다. 저장은 다른 요소 선택과 같이 일어난다
function pickSearchedElement(key) {
    const option = (_metaDraft.found || []).find(item => elementKey(item) === key);
    if (!option) return;
    const known = _metaDraft.options.some(item => elementKey(item) === key);
    _metaDraft = { ..._metaDraft, touched: true, options: known ? _metaDraft.options : [..._metaDraft.options, option] };
    _metaDraft.selected.add(key);
    refreshMetaElements();
    renderMetaSearch();
}

function metaRegisterForm(subject) {
    const units = subject?.ncs?.units || [];
    const recommend = '<button data-meta-action="recommend" class="px-2 py-1 text-xs font-bold text-white bg-accent rounded hover:bg-accentHover">AI 추천</button>';
    if (!units.length) return `${metaElementSearchHtml()}<div class="flex items-center gap-2"><p class="flex-1 text-xs text-textMuted">교과 NCS 관리에서 능력단위를 배정하면 요소를 등록할 수 있습니다.</p>${recommend}</div>`;
    return `
        ${metaElementSearchHtml()}
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
            <span class="text-[0.6875rem] font-bold px-1 rounded shrink-0 ${LESSON_STATUS_STYLES[lessonStatus(lesson)] || ''}">${escapeHtml(lessonStatus(lesson))}</span>
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
        .map(({ subject, rows }) => `<p class="text-xs text-textMuted mt-1">${escapeHtml(subject.title)}</p>${rows.map(({ lesson }) => metaPrereqRow(lesson, isChosen(lesson))).join('')}`);
    const broken = chosen.map((item, index) => ({ item, index, state: findLessonPrereq(item, mod.id).state })).filter(row => row.state !== 'ok').map(({ item, index, state }) => `
        <label class="flex items-center gap-2 text-xs text-textLight">
            <input type="checkbox" data-meta-prereq-broken="${index}" checked> ${escapeHtml(item.title || '')}
            <span class="text-[0.6875rem] font-bold px-1 rounded bg-rose-500/20 text-rose-300">${state === 'self' ? '자기 자신' : '미등록'}</span>
        </label>`);
    return [...broken, ...groups].join('') || '<p class="text-xs text-textMuted">선행으로 고를 다른 차시가 없습니다.</p>';
}

function metaHistoryRows(mod) {
    if (!(mod.history || []).length) return '<p class="text-xs text-textMuted">변경 이력이 없습니다.</p>';
    return mod.history.map(row => `<div class="text-[0.6875rem] text-textMuted">${escapeHtml(localTimeText(row.at))} · ${escapeHtml(row.note)}</div>`).join('');
}

function metaBasicsHtml(subject, mod, label, field) {
    const categories = lessonCategories().map(item => item.name);
    return `
        <div><label class="${label}">제목 (과정 안에서 겹치지 않게)</label><input id="meta-title" value="${escapeHtml(mod.title)}" class="${field}"><p id="meta-title-warning" class="text-xs text-rose-300 min-h-[1em]">${lessonTitleTaken(mod.title, mod.id) ? '같은 제목의 차시가 이미 있습니다.' : ''}</p></div>
        <div class="flex gap-2">
            <div class="flex-1"><label class="${label}">카테고리</label><input id="meta-category" list="meta-categories" value="${escapeHtml(mod.category || '')}" class="${field}"><datalist id="meta-categories">${categories.map(item => `<option value="${escapeHtml(item)}"></option>`).join('')}</datalist></div>
            <div class="w-28"><label class="${label}">상태</label><select id="meta-status" class="${field}">${LESSON_STATUSES.map(status => `<option ${lessonStatus(mod) === status ? 'selected' : ''}>${status}</option>`).join('')}</select></div>
            <div class="w-40"><label class="${label}">교과</label><select id="meta-subject" class="${field}">${globalState.subjects.map(item => `<option value="${escapeHtml(String(item.id))}" ${item.id === subject.id ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></div>
        </div>
        <details id="meta-category-manager" class="text-[0.6875rem] text-textMuted"><summary class="cursor-pointer">카테고리 관리</summary><div id="meta-category-rows" class="mt-1 space-y-1">${lessonCategoryRowsHtml()}</div></details>`;
}

function metaDialogHtml(subject, mod) {
    const label = 'block text-[0.6875rem] font-bold text-textMuted mb-1';
    const field = 'w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white focus:outline-none focus:border-accent';
    return `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[600px] max-h-[86vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10"><h2 class="text-sm font-bold text-textLight">차시 정보 · ${escapeHtml(mod.title)}</h2></div>
            <div class="flex-1 overflow-y-auto p-4 space-y-3">
                ${metaBasicsHtml(subject, mod, label, field)}
                <div>
                    <label class="${label}">학습 목표 (한 줄에 하나, 교안 생성과 교수안에 씁니다)</label>
                    <textarea id="meta-objectives" rows="3" class="${field}">${escapeHtml((mod.objectives || []).join('\n'))}</textarea>
                    <button data-meta-action="objective-sets" class="mt-1 px-2 py-0.5 text-[0.6875rem] font-bold text-textLight bg-white/10 rounded hover:bg-white/20">교안의 학습 목표 세트 추가·삭제</button>
                </div>
                <div>
                    <label class="${label}">진행 단계 (단계 | 내용 | 분, 한 줄에 하나)</label>
                    <textarea id="meta-flow" rows="4" class="${field}">${escapeHtml(flowLinesText(mod.flow))}</textarea>
                    <p id="meta-flow-note" class="text-xs text-textMuted min-h-[1em]">${escapeHtml(metaFlowNote(flowLinesText(mod.flow), mod))}</p>
                </div>
                <div><label class="${label}">사용 툴과 버전 (이름 | 버전, 버전 의존 정보는 본문이 아니라 여기서 관리합니다)</label><textarea id="meta-tools" rows="2" class="${field}">${escapeHtml((mod.tools || []).map(tool => `${tool.name}${tool.version ? ` | ${tool.version}` : ''}`).join('\n'))}</textarea></div>
                <div><label class="${label}">교안 생성 옵션 (지정하지 않으면 과정 기본값을 씁니다)</label>${lessonGenFieldsHtml('meta', mod.gen)}</div>
                <div><label class="${label}">선행 차시 (메타데이터 전용, 본문에서는 언급하지 않습니다)</label><div class="space-y-1 max-h-28 overflow-y-auto">${metaPrereqRows(mod)}</div></div>
                <div><label class="${label}">NCS 능력단위요소</label><div id="meta-element-status">${metaElementStatus()}</div><div id="meta-elements" class="space-y-1 max-h-40 overflow-y-auto mb-2">${metaElementRows()}</div>${metaRegisterForm(subject)}<p id="meta-status-text" class="text-xs text-accent mt-1 min-h-[1em]"></p></div>
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
    if (event.target.id === 'meta-element-search') return searchMetaElements(event.target.value);
    if (event.target.id === 'meta-flow') document.getElementById('meta-flow-note').textContent = metaFlowNote(event.target.value, _metaDraft.mod);
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
    const fresh = subjectElementOptions(_metaDraft.subject);
    const searched = _metaDraft.options.filter(item => !fresh.some(other => elementKey(other) === elementKey(item)));
    _metaDraft = { ..._metaDraft, options: [...fresh, ...searched] };
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
    return { ncsElements: picked.map(({ auto, ...element }) => element), ncsAuto: false, ncsKeyword: false, ncsNone: !picked.length };
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
        objectives: parseObjectiveLines(document.getElementById('meta-objectives').value),
        ...lessonFlowPatch(parseFlowLines(document.getElementById('meta-flow').value)),
        tools: parseToolLines(document.getElementById('meta-tools').value),
        gen: readLessonGenFields('meta'),
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
    if (action === 'pick-element') pickSearchedElement(event.target.dataset.key);
    if (action === 'recommend') await runElementRecommend(event.target);
    if (action === 'add-note') await addMetaHistoryNote();
    if (action === 'objective-sets') {
        const { mod } = _metaDraft;
        closeLessonMeta();
        return window.openObjectiveSets(mod.id);
    }
    if (action === 'rename-category') await renameCategoryFromDialog(event.target.dataset.category);
    if (action === 'delete-category') deleteCategoryFromDialog(event.target.dataset.category);
    if (action === 'save') await saveLessonMeta();
    if (action === 'confirm-elements') {
        _metaDraft = { ..._metaDraft, confirm: true };
        await saveLessonMeta();
    }
}
