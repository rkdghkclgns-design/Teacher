// course-design-edit.js - 과정 설계 미리보기의 블록·진행 단계 편집과 1시간 단위 시간표 표시
// 편집 규칙은 develocket-slide(assets/course-ui.js setPath @3a7303f)를 따른다. 모든 변경은 새 초안을 돌려준다.
// 단원은 늘 5차시(블록) × 하루 8시간이라(course-design.js) 블록 수와 블록 시간은 고치지 않고, 제목·학습목표·진행 단계만 고친다.

const DESIGN_MIN_BLOCK_MINUTES = 10;
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

// 블록 시간은 고치지 않는다(차시 하나 = 8시간)
const DESIGN_MODULE_FIELDS = {
    title: (module, value) => ({ title: value.trim() || module.title }),
    objectives: (module, value) => ({ objectives: parseObjectiveLines(value) })
};

const DESIGN_STEP_FIELDS = {
    phase: (step, value) => ({ phase: DESIGN_PHASES.includes(value) ? value : step.phase }),
    title: (step, value) => ({ title: value.trim() || step.title }),
    minutes: (step, value) => ({ minutes: roundMinutes(value, DESIGN_FLOW_STEP_MINUTES) })
};

// 고칠 수 없는 칸(블록 시간 등)이면 초안을 그대로 돌려준다
function setDesignModuleField(draft, unitIndex, moduleIndex, field, value) {
    if (!Object.prototype.hasOwnProperty.call(DESIGN_MODULE_FIELDS, field)) return draft;
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

function fitDesignBlock(draft, unitIndex, moduleIndex) {
    return editDesignModule(draft, unitIndex, moduleIndex, module => ({ flow: fitFlow(module.flow, module.minutes, module.title) }));
}

// 단원을 5차시 × 8시간으로 다시 맞춘다(course-design.js normalizeDesignUnit)
function fitDesignUnit(draft, unitIndex) {
    return { ...draft, edited: true, units: mapAt(draft.units, unitIndex, normalizeDesignUnit) };
}

function designEditAction(draft, action, data) {
    const [unit, module, step] = [Number(data.unit), Number(data.module), Number(data.step)];
    if (action === 'add-step') return addDesignStep(draft, unit, module);
    if (action === 'del-step') return removeDesignStep(draft, unit, module, step);
    if (action === 'fit-block') return fitDesignBlock(draft, unit, module);
    if (action === 'fit-unit') return fitDesignUnit(draft, unit);
    return null;
}

/* ---------- 시간 합계 ---------- */
const designFlowMinutes = module => (module.flow || []).reduce((sum, step) => sum + (Number(step.minutes) || 0), 0);
const designBlockMinutes = unit => unit.modules.reduce((sum, module) => sum + (Number(module.minutes) || 0), 0);
const designFlowMatches = module => designFlowMinutes(module) === Number(module.minutes);
// 단원은 정확히 5차시이고 차시마다 8시간(합계 40시간)이어야 한다
const designUnitMatches = unit => Number(unit.hours) === DESIGN_UNIT_TOTAL_HOURS && unit.modules.length === DESIGN_LESSONS_PER_UNIT
    && unit.modules.every(module => Number(module.minutes) === DESIGN_LESSON_MINUTES);

function designTimeMismatches(draft) {
    return draft.units.reduce((count, unit) => count + (designUnitMatches(unit) ? 0 : 1) + unit.modules.filter(module => !designFlowMatches(module)).length, 0);
}

function designModuleNotes(module) {
    return [
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
        <label class="block text-[0.6875rem] font-bold text-textMuted">${label} <span class="font-normal">(수료 시 도달할 최종 목표)</span>
            <textarea ${attr} rows="2" class="block w-full mt-1 ${DESIGN_FIELD_CLASS}" placeholder="예: 주어진 기준으로 콘텐츠 제작 기획서를 작성할 수 있습니다.">${escapeHtml(goal || '')}</textarea>
        </label>`;
}

function designBlockStatusHtml(module, unitIndex, moduleIndex) {
    const flowMinutes = designFlowMinutes(module);
    const matched = designFlowMatches(module);
    const notes = designModuleNotes(module).map(note => `<p class="text-amber-400 text-xs">⚠ ${escapeHtml(note)}</p>`).join('');
    return `
        <div class="flex items-center gap-2 text-[0.6875rem] ${matched ? 'text-emerald-400' : 'text-amber-400'}">
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
            <span class="text-[0.6875rem] text-textMuted">분</span>
            <button data-design-action="del-step" ${attrs} title="단계 삭제" class="px-1 text-rose-300 text-xs">✕</button>
        </div>`;
}

function designBlockHtml(module, unitIndex, moduleIndex) {
    const attrs = designIndexAttrs(unitIndex, moduleIndex);
    return `
        <div class="p-2 rounded-lg bg-black/20 border border-white/5 space-y-1.5">
            <div class="flex items-center gap-1">
                <span class="text-[0.6875rem] font-bold text-accent shrink-0">${moduleIndex + 1}차시</span>
                <input data-design-field="title" ${attrs} value="${escapeHtml(module.title)}" aria-label="차시 제목" class="flex-1 min-w-0 ${DESIGN_FIELD_CLASS}">
                <span class="text-[0.6875rem] text-textMuted shrink-0" title="차시 하나는 하루 ${DESIGN_LESSON_HOURS}시간(실습 포함)입니다">${fmtMinutes(Number(module.minutes) || 0)}</span>
            </div>
            <label class="block text-[0.6875rem] text-textMuted">학습목표 (한 줄에 하나, ${DESIGN_MAX_OBJECTIVES}개 이하, '~할 수 있습니다')
                <textarea data-design-field="objectives" ${attrs} rows="2" class="block w-full mt-0.5 ${DESIGN_FIELD_CLASS}">${escapeHtml(module.objectives.join('\n'))}</textarea>
            </label>
            <div class="space-y-1">${(module.flow || []).map((step, stepIndex) => designStepHtml(step, unitIndex, moduleIndex, stepIndex)).join('')}</div>
            <div class="flex items-start justify-between gap-2">
                <div id="design-block-status-${unitIndex}-${moduleIndex}" class="min-w-0">${designBlockStatusHtml(module, unitIndex, moduleIndex)}</div>
                <button data-design-action="add-step" ${attrs} class="shrink-0 px-1.5 py-0.5 text-[0.6875rem] font-bold rounded bg-white/10 text-textLight hover:bg-white/20">＋ 단계</button>
            </div>
        </div>`;
}

// 단원 머리줄: 5차시 × 8시간이면 ✓, 아니면(예전 초안) 지금 차시 수와 합계를 보이고 다시 맞추는 단추를 둔다
function designUnitStatusHtml(unit, unitIndex) {
    const matched = designUnitMatches(unit);
    const shape = `${DESIGN_LESSONS_PER_UNIT}차시 × ${DESIGN_LESSON_HOURS}시간`;
    const text = matched ? `${shape} = ${DESIGN_UNIT_TOTAL_HOURS}시간 ✓` : `차시 ${unit.modules.length}개 · 합계 ${fmtMinutes(designBlockMinutes(unit))} ≠ ${shape}`;
    return `
        <span class="text-[0.6875rem] ${matched ? 'text-emerald-400' : 'text-amber-400'}">${text}</span>
        ${matched ? '' : `<button data-design-action="fit-unit" data-unit="${unitIndex}" class="px-1.5 py-0.5 text-[0.6875rem] rounded bg-white/10 text-textLight font-bold">${DESIGN_LESSONS_PER_UNIT}차시로 맞추기</button>`}`;
}

// 표의 셀로 조립하면 제목이 HTML로 해석되므로 sessionRows 값을 글자 그대로 넣는다. 1시간 칸은 교시로 부른다(차시 하나가 하루 8시간)
function sessionTableHtml(rows) {
    const body = rows.map((row, index) => `
        <tr class="border-t border-white/5 align-top">
            <td class="py-1 pr-2 text-textLight"><b>${index + 1}교시</b> ${escapeHtml(row.title)}</td>
            <td class="py-1 pr-2 text-textMuted whitespace-nowrap">${fmtMinutes(row.minutes)}</td>
            <td class="py-1 text-textMuted">${row.steps.map(step => `<div><b class="text-textLight">${escapeHtml(step.label)}</b> ${escapeHtml(step.text)} (${fmtMinutes(step.minutes)})</div>`).join('')}</td>
        </tr>`).join('');
    return `<table class="w-full mt-1 text-[0.6875rem]"><thead><tr class="text-left text-textMuted"><th class="pr-2 font-bold">교시</th><th class="pr-2 font-bold">시간</th><th class="font-bold">진행 단계</th></tr></thead><tbody>${body}</tbody></table>`;
}

function designSessionsHtml(unit, unitIndex) {
    const rows = sessionRows(unit.modules);
    if (!rows.length) return '';
    const open = _designSessionsOpen.has(unitIndex);
    return `
        <button data-design-action="sessions" data-unit="${unitIndex}" class="px-1.5 py-0.5 text-[0.6875rem] font-bold rounded bg-white/10 text-textLight hover:bg-white/20">1시간 단위 시간표 ${open ? '접기' : `보기 (${rows.length}교시)`}</button>
        ${open ? sessionTableHtml(rows) : ''}`;
}

function designUnitHtml(unit, unitIndex) {
    return `
        <div class="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
            <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-textLight shrink-0">${unitIndex + 1}.</span>
                <input data-design-unit-title="${unitIndex}" value="${escapeHtml(unit.title)}" aria-label="단원 제목" class="flex-1 min-w-0 ${DESIGN_FIELD_CLASS}">
                <span id="design-unit-status-${unitIndex}" class="flex items-center gap-1 shrink-0">${designUnitStatusHtml(unit, unitIndex)}</span>
            </div>
            ${unit.modules.map((module, moduleIndex) => designBlockHtml(module, unitIndex, moduleIndex)).join('')}
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
