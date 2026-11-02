// course-design-edit.js - 과정 설계 미리보기의 블록·진행 단계 편집과 차시 구성 표시
// 편집 규칙은 develocket-slide(assets/course-ui.js setPath @3a7303f)를 따른다. 모든 변경은 새 초안을 돌려준다.

const DESIGN_MIN_BLOCK_MINUTES = 10;
const DESIGN_NEW_BLOCK_MINUTES = 60;
const DESIGN_PHASES = ['도입', '전개', '정리'];
const DESIGN_OBJECTIVE_BULLET = /^\s*(?:\d+[.)]|[-*•])\s*/;

let _designSessionsOpen = new Set();

/* ---------- 초안 변경 ---------- */
const mapAt = (list, index, change) => list.map((item, i) => (i === index ? change(item) : item));
const roundMinutes = (value, min) => Math.max(min, Math.round(Number(value) / DESIGN_FLOW_STEP_MINUTES) * DESIGN_FLOW_STEP_MINUTES || min);

function parseObjectiveLines(text) {
    return String(text).split('\n').map(line => line.replace(DESIGN_OBJECTIVE_BULLET, '').trim()).filter(Boolean);
}

// 고친 블록은 isDefault를 지워 단원 시간이 바뀌어도 기본 블록으로 다시 만들지 않게 한다
function editDesignModule(draft, unitIndex, moduleIndex, change) {
    const units = mapAt(draft.units, unitIndex, unit => ({
        ...unit,
        modules: mapAt(unit.modules, moduleIndex, module => ({ ...module, ...change(module), isDefault: false }))
    }));
    return { ...draft, units, edited: true };
}

const DESIGN_MODULE_FIELDS = {
    title: (module, value) => ({ title: value.trim() || module.title }),
    minutes: (module, value) => ({ minutes: roundMinutes(value, DESIGN_MIN_BLOCK_MINUTES) }),
    objectives: (module, value) => ({ objectives: parseObjectiveLines(value) })
};

const DESIGN_STEP_FIELDS = {
    phase: (step, value) => ({ phase: DESIGN_PHASES.includes(value) ? value : step.phase }),
    title: (step, value) => ({ title: value.trim() || step.title }),
    minutes: (step, value) => ({ minutes: roundMinutes(value, DESIGN_FLOW_STEP_MINUTES) })
};

function setDesignModuleField(draft, unitIndex, moduleIndex, field, value) {
    return editDesignModule(draft, unitIndex, moduleIndex, module => DESIGN_MODULE_FIELDS[field](module, value));
}

function setDesignStepField(draft, unitIndex, moduleIndex, stepIndex, field, value) {
    return editDesignModule(draft, unitIndex, moduleIndex, module => ({
        flow: mapAt(module.flow, stepIndex, step => ({ ...step, ...DESIGN_STEP_FIELDS[field](step, value) }))
    }));
}

// 새 단계는 정리 앞에 넣는다
function addDesignStep(draft, unitIndex, moduleIndex) {
    return editDesignModule(draft, unitIndex, moduleIndex, module => {
        const at = Math.max(0, module.flow.length - 1);
        return { flow: [...module.flow.slice(0, at), { phase: '전개', title: '새 활동', minutes: DESIGN_MIN_BLOCK_MINUTES }, ...module.flow.slice(at)] };
    });
}

function removeDesignStep(draft, unitIndex, moduleIndex, stepIndex) {
    return editDesignModule(draft, unitIndex, moduleIndex, module => (module.flow.length > 1
        ? { flow: module.flow.filter((_, i) => i !== stepIndex) }
        : {}));
}

function setDesignUnitTitle(draft, unitIndex, value) {
    return { ...draft, edited: true, units: mapAt(draft.units, unitIndex, unit => ({ ...unit, title: value.trim() || unit.title })) };
}

function addDesignBlock(draft, unitIndex) {
    const title = '새 블록';
    const block = { title, minutes: DESIGN_NEW_BLOCK_MINUTES, objectives: [], flow: defaultFlow(DESIGN_NEW_BLOCK_MINUTES, title), isDefault: false };
    return { ...draft, edited: true, units: mapAt(draft.units, unitIndex, unit => ({ ...unit, modules: [...unit.modules, block] })) };
}

// 단원에는 블록이 하나는 있어야 하므로 마지막 블록은 지우지 않는다
// 남은 블록의 isDefault를 지워 시간을 맞출 때 지운 블록이 기본 블록으로 되살아나지 않게 한다
function removeDesignBlock(draft, unitIndex, moduleIndex) {
    const without = unit => unit.modules.filter((_, i) => i !== moduleIndex).map(module => ({ ...module, isDefault: false }));
    return { ...draft, edited: true, units: mapAt(draft.units, unitIndex, unit => (unit.modules.length > 1 ? { ...unit, modules: without(unit) } : unit)) };
}

function fitDesignBlock(draft, unitIndex, moduleIndex) {
    return editDesignModule(draft, unitIndex, moduleIndex, module => ({ flow: fitFlow(module.flow, module.minutes, module.title) }));
}

function fitDesignUnit(draft, unitIndex) {
    return { ...draft, edited: true, units: mapAt(draft.units, unitIndex, normalizeDesignUnit) };
}

function designEditAction(draft, action, data) {
    const [unit, module, step] = [Number(data.unit), Number(data.module), Number(data.step)];
    if (action === 'add-step') return addDesignStep(draft, unit, module);
    if (action === 'del-step') return removeDesignStep(draft, unit, module, step);
    if (action === 'add-block') return addDesignBlock(draft, unit);
    if (action === 'del-block') return removeDesignBlock(draft, unit, module);
    if (action === 'fit-block') return fitDesignBlock(draft, unit, module);
    if (action === 'fit-unit') return fitDesignUnit(draft, unit);
    return null;
}

/* ---------- 시간 합계 ---------- */
const designFlowMinutes = module => (module.flow || []).reduce((sum, step) => sum + (Number(step.minutes) || 0), 0);
const designBlockMinutes = unit => unit.modules.reduce((sum, module) => sum + (Number(module.minutes) || 0), 0);
const designFlowMatches = module => designFlowMinutes(module) === Number(module.minutes);
const designUnitMatches = unit => designBlockMinutes(unit) === Number(unit.hours) * 60;

function designTimeMismatches(draft) {
    return draft.units.reduce((count, unit) => count + (designUnitMatches(unit) ? 0 : 1) + unit.modules.filter(module => !designFlowMatches(module)).length, 0);
}

function designModuleNotes(module) {
    return [
        module.minutes > DESIGN_MODULE_MAX_MINUTES && '블록은 3시간 이하로 나누세요',
        module.objectives.length > DESIGN_MAX_OBJECTIVES && `학습목표는 ${DESIGN_MAX_OBJECTIVES}개 이하를 권장합니다`,
        ...module.objectives.map((objective, i) => {
            const note = lintObjective(objective);
            return note && `목표 ${i + 1}: ${note}`;
        })
    ].filter(Boolean);
}

/* ---------- 화면 ---------- */
const DESIGN_FIELD_CLASS = 'px-1.5 py-1 text-xs bg-black/30 border border-white/10 rounded text-white focus:outline-none focus:border-accent';
const designIndexAttrs = (unitIndex, moduleIndex) => `data-unit="${unitIndex}" data-module="${moduleIndex}"`;

function designGoalHtml(label, goal, attr) {
    return `
        <label class="block text-[0.65rem] font-bold text-textMuted">${label} <span class="font-normal">(수료 시 도달할 최종 목표)</span>
            <textarea ${attr} rows="2" class="block w-full mt-1 ${DESIGN_FIELD_CLASS}" placeholder="예: 주어진 기준으로 콘텐츠 제작 기획서를 작성할 수 있습니다.">${escapeHtml(goal || '')}</textarea>
        </label>`;
}

function designBlockStatusHtml(module, unitIndex, moduleIndex) {
    const flowMinutes = designFlowMinutes(module);
    const matched = designFlowMatches(module);
    const notes = designModuleNotes(module).map(note => `<p class="text-amber-400 text-[0.6rem]">⚠ ${escapeHtml(note)}</p>`).join('');
    return `
        <div class="flex items-center gap-2 text-[0.65rem] ${matched ? 'text-emerald-400' : 'text-amber-400'}">
            <span>단계 합계 ${fmtMinutes(flowMinutes)}${matched ? ' ✓' : ` ≠ 블록 ${fmtMinutes(module.minutes)}`}</span>
            ${matched ? '' : `<button data-design-action="fit-block" ${designIndexAttrs(unitIndex, moduleIndex)} class="px-1.5 py-0.5 rounded bg-white/10 text-textLight font-bold">시간 맞추기</button>`}
        </div>${notes}`;
}

function designStepHtml(step, unitIndex, moduleIndex, stepIndex) {
    const attrs = `${designIndexAttrs(unitIndex, moduleIndex)} data-step="${stepIndex}"`;
    return `
        <div class="flex items-center gap-1">
            <select data-design-step="phase" ${attrs} class="${DESIGN_FIELD_CLASS}">${DESIGN_PHASES.map(phase => `<option ${phase === step.phase ? 'selected' : ''}>${phase}</option>`).join('')}</select>
            <input data-design-step="title" ${attrs} value="${escapeHtml(step.title)}" aria-label="단계 제목" class="flex-1 min-w-0 ${DESIGN_FIELD_CLASS}">
            <input type="number" min="5" step="5" data-design-step="minutes" ${attrs} value="${Number(step.minutes) || 0}" aria-label="단계 시간(분)" class="w-14 text-right ${DESIGN_FIELD_CLASS}">
            <span class="text-[0.6rem] text-textMuted">분</span>
            <button data-design-action="del-step" ${attrs} title="단계 삭제" class="px-1 text-rose-300 text-xs">✕</button>
        </div>`;
}

function designBlockHtml(module, unitIndex, moduleIndex) {
    const attrs = designIndexAttrs(unitIndex, moduleIndex);
    return `
        <div class="p-2 rounded-lg bg-black/20 border border-white/5 space-y-1.5">
            <div class="flex items-center gap-1">
                <span class="text-[0.6rem] font-bold text-accent shrink-0">블록 ${unitIndex + 1}-${moduleIndex + 1}</span>
                <input data-design-field="title" ${attrs} value="${escapeHtml(module.title)}" aria-label="블록 제목" class="flex-1 min-w-0 ${DESIGN_FIELD_CLASS}">
                <input type="number" min="10" step="5" data-design-field="minutes" ${attrs} value="${Number(module.minutes) || 0}" aria-label="블록 시간(분)" class="w-16 text-right ${DESIGN_FIELD_CLASS}">
                <span class="text-[0.6rem] text-textMuted">분</span>
                <button data-design-action="del-block" ${attrs} title="블록 삭제" class="px-1 text-rose-300 text-xs">✕</button>
            </div>
            <label class="block text-[0.6rem] text-textMuted">학습목표 (한 줄에 하나, ${DESIGN_MAX_OBJECTIVES}개 이하, '~할 수 있습니다')
                <textarea data-design-field="objectives" ${attrs} rows="2" class="block w-full mt-0.5 ${DESIGN_FIELD_CLASS}">${escapeHtml(module.objectives.join('\n'))}</textarea>
            </label>
            <div class="space-y-1">${(module.flow || []).map((step, stepIndex) => designStepHtml(step, unitIndex, moduleIndex, stepIndex)).join('')}</div>
            <div class="flex items-start justify-between gap-2">
                <div id="design-block-status-${unitIndex}-${moduleIndex}" class="min-w-0">${designBlockStatusHtml(module, unitIndex, moduleIndex)}</div>
                <button data-design-action="add-step" ${attrs} class="shrink-0 px-1.5 py-0.5 text-[0.65rem] font-bold rounded bg-white/10 text-textLight hover:bg-white/20">＋ 단계</button>
            </div>
        </div>`;
}

function designUnitStatusHtml(unit, unitIndex) {
    const matched = designUnitMatches(unit);
    return `
        <span class="text-[0.65rem] ${matched ? 'text-emerald-400' : 'text-amber-400'}">블록 합계 ${fmtMinutes(designBlockMinutes(unit))}${matched ? ' ✓' : ` ≠ ${fmtMinutes(Number(unit.hours) * 60)}`}</span>
        ${matched ? '' : `<button data-design-action="fit-unit" data-unit="${unitIndex}" class="px-1.5 py-0.5 text-[0.65rem] rounded bg-white/10 text-textLight font-bold">시간 맞추기</button>`}`;
}

// 표의 셀로 조립하면 제목이 HTML로 해석되므로 sessionRows 값을 글자 그대로 넣는다
function sessionTableHtml(rows) {
    const body = rows.map((row, index) => `
        <tr class="border-t border-white/5 align-top">
            <td class="py-1 pr-2 text-textLight"><b>${index + 1}차시</b> ${escapeHtml(row.title)}</td>
            <td class="py-1 pr-2 text-textMuted whitespace-nowrap">${fmtMinutes(row.minutes)}</td>
            <td class="py-1 text-textMuted">${row.steps.map(step => `<div><b class="text-textLight">${escapeHtml(step.label)}</b> ${escapeHtml(step.text)} (${fmtMinutes(step.minutes)})</div>`).join('')}</td>
        </tr>`).join('');
    return `<table class="w-full mt-1 text-[0.65rem]"><thead><tr class="text-left text-textMuted"><th class="pr-2 font-bold">차시</th><th class="pr-2 font-bold">시간</th><th class="font-bold">진행 단계</th></tr></thead><tbody>${body}</tbody></table>`;
}

function designSessionsHtml(unit, unitIndex) {
    const rows = sessionRows(unit.modules);
    if (!rows.length) return '';
    const open = _designSessionsOpen.has(unitIndex);
    return `
        <button data-design-action="sessions" data-unit="${unitIndex}" class="px-1.5 py-0.5 text-[0.65rem] font-bold rounded bg-white/10 text-textLight hover:bg-white/20">차시 구성 ${open ? '접기' : `보기 (${rows.length}차시)`}</button>
        ${open ? sessionTableHtml(rows) : ''}`;
}

function designUnitHtml(unit, unitIndex) {
    return `
        <div class="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
            <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-textLight shrink-0">${unitIndex + 1}.</span>
                <input data-design-unit-title="${unitIndex}" value="${escapeHtml(unit.title)}" aria-label="단원 제목" class="flex-1 min-w-0 ${DESIGN_FIELD_CLASS}">
                <span id="design-unit-status-${unitIndex}" class="flex items-center gap-1 shrink-0">${designUnitStatusHtml(unit, unitIndex)}</span>
                <input type="number" min="1" data-design-hours="${unitIndex}" value="${unit.hours}" aria-label="단원 시간" class="w-14 ${DESIGN_FIELD_CLASS} text-right">
                <span class="text-[0.65rem] text-textMuted">시간</span>
            </div>
            ${unit.modules.map((module, moduleIndex) => designBlockHtml(module, unitIndex, moduleIndex)).join('')}
            <button data-design-action="add-block" data-unit="${unitIndex}" class="px-1.5 py-0.5 text-[0.65rem] font-bold rounded bg-white/10 text-textLight hover:bg-white/20">＋ 블록</button>
            <div id="design-sessions-${unitIndex}">${designSessionsHtml(unit, unitIndex)}</div>
        </div>`;
}

function resetDesignSessions() {
    _designSessionsOpen = new Set();
}

function setDesignHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

function toggleDesignSessions(unitIndex) {
    const next = new Set(_designSessionsOpen);
    if (!next.delete(unitIndex)) next.add(unitIndex);
    _designSessionsOpen = next;
    setDesignHtml(`design-sessions-${unitIndex}`, designSessionsHtml(_designDraft.units[unitIndex], unitIndex));
}

// 입력칸을 다시 그리면 다음 칸으로 옮긴 커서가 사라지므로 합계·검사 표시만 고친다
function refreshDesignStatus(unitIndex, moduleIndex) {
    const unit = _designDraft.units[unitIndex];
    setDesignHtml(`design-block-status-${unitIndex}-${moduleIndex}`, designBlockStatusHtml(unit.modules[moduleIndex], unitIndex, moduleIndex));
    setDesignHtml(`design-unit-status-${unitIndex}`, designUnitStatusHtml(unit, unitIndex));
    setDesignHtml(`design-sessions-${unitIndex}`, designSessionsHtml(unit, unitIndex));
}

function onDesignUnitTitleChange(target) {
    const unitIndex = Number(target.dataset.designUnitTitle);
    _designDraft = setDesignUnitTitle(_designDraft, unitIndex, target.value);
    target.value = _designDraft.units[unitIndex].title;
}

// 입력칸에는 다듬어진 값을 되돌려 준다 (5분 단위 반올림, 빈 제목 복원)
function onDesignFieldChange(target) {
    const data = target.dataset;
    const [unitIndex, moduleIndex, stepIndex] = [Number(data.unit), Number(data.module), Number(data.step)];
    if (data.designField) {
        _designDraft = setDesignModuleField(_designDraft, unitIndex, moduleIndex, data.designField, target.value);
        const module = _designDraft.units[unitIndex].modules[moduleIndex];
        target.value = data.designField === 'objectives' ? module.objectives.join('\n') : module[data.designField];
    } else {
        _designDraft = setDesignStepField(_designDraft, unitIndex, moduleIndex, stepIndex, data.designStep, target.value);
        target.value = _designDraft.units[unitIndex].modules[moduleIndex].flow[stepIndex][data.designStep];
    }
    refreshDesignStatus(unitIndex, moduleIndex);
}
