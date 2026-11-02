// course-ncs-ref.js - NCS 참조 목록: 등록한 능력단위요소와 직접 추가한 능력단위를 보고 고친다
// develocket-slide(assets/course-ncs.js @3a7303f)의 참조 목록 화면과 보강 저장을 옮겼다.
// 내장 능력단위는 고치지 않는다. 요소는 globalState.ncsElements, 미검증 표시는 ncsUnverified, 직접 추가는 ncsCustomUnits에 둔다.

const NCS_REF_LIMIT = 30;

let _ncsRef = null;

const registeredElements = code => (globalState.ncsElements || {})[code] || [];
const withoutKey = (map, key) => Object.fromEntries(Object.entries(map || {}).filter(([item]) => item !== key));

function ncsRefInfo(code, fallback = null) {
    const unit = ncsUnit(code) || fallback;
    return unit && { ...unit, elements: registeredElements(code), verified: ncsVerified(unit), custom: !isCatalogNcsCode(code) };
}

// 요소를 등록했거나 직접 추가했거나 미검증으로 돌린 단위. 검색어가 없을 때 이것만 보여 준다.
function enrichedNcsUnits() {
    const codes = [
        ...Object.keys(globalState.ncsElements || {}).filter(code => registeredElements(code).length),
        ...Object.keys(globalState.ncsUnverified || {}),
        ...customNcsUnits().map(unit => unit.code)
    ];
    return [...new Set(codes)].map(code => ncsRefInfo(code)).filter(Boolean);
}

function ncsRefRows(query) {
    const text = query.trim().toLowerCase();
    if (!text) return enrichedNcsUnits();
    const matches = unit => `${unit.code} ${unit.name} ${unit.path?.[3] || ''} ${unit.elements.map(elementLabel).join(' ')}`.toLowerCase().includes(text);
    const rows = [...enrichedNcsUnits().filter(matches), ...ncsKeywordRows(query, NCS_REF_LIMIT).map(row => ncsRefInfo(row.code, row))];
    return rows.filter((row, index) => rows.findIndex(other => other.code === row.code) === index).slice(0, NCS_REF_LIMIT);
}

function ncsRefStats() {
    const elements = Object.keys(globalState.ncsElements || {}).reduce((sum, code) => sum + registeredElements(code).length, 0);
    return { units: ncsCatalog().units.length + customNcsUnits().length, elements, custom: customNcsUnits().length };
}

function saveCustomNcsUnit(code, { name, level, subclass, verified }) {
    const unit = { code, name, level: Number(level) || null, path: ['', '', '', subclass || '직접 추가'], duty: '', verified, custom: true };
    globalState.ncsCustomUnits = [...customNcsUnits().filter(item => item.code !== code), unit];
}

function saveNcsRefUnit({ code, name, level, subclass, elements, verified }) {
    const unitCode = String(code || '').trim();
    const unitName = String(name || '').trim();
    const official = isCatalogNcsCode(unitCode);
    if (!unitCode || (!official && !unitName)) throw new Error('코드와 이름을 입력해주세요.');
    if (!official) saveCustomNcsUnit(unitCode, { name: unitName, level, subclass: String(subclass || '').trim(), verified });
    if (official) globalState.ncsUnverified = verified ? withoutKey(globalState.ncsUnverified, unitCode) : { ...(globalState.ncsUnverified || {}), [unitCode]: true };
    const rest = withoutKey(globalState.ncsElements, unitCode);
    globalState.ncsElements = elements.length ? { ...rest, [unitCode]: elements } : rest;
    return unitCode;
}

// 교과와 차시에 이미 고른 값은 사용자가 고른 기록이므로 지우지 않는다
function deleteNcsRefUnit(code) {
    globalState.ncsCustomUnits = customNcsUnits().filter(unit => unit.code !== code);
    globalState.ncsElements = withoutKey(globalState.ncsElements, code);
    globalState.ncsUnverified = withoutKey(globalState.ncsUnverified, code);
}

/* ---------- 화면 ---------- */
function ncsRefRowsHtml(rows) {
    const body = rows.map(unit => `
        <tr class="border-t border-white/5 align-top">
            <td class="p-1 font-mono text-accent">${escapeHtml(unit.code)}</td>
            <td class="p-1 text-textLight">${escapeHtml(unit.name)}${unit.custom ? ' <span class="text-[0.55rem] px-1 rounded bg-white/10 text-textMuted">직접 추가</span>' : ''}
                <span class="block text-[0.6rem] text-textMuted">${unit.elements.length ? escapeHtml(unit.elements.map(elementLabel).join(' · ')) : '요소 미등록'}</span></td>
            <td class="p-1 text-textMuted">${unit.level ? `${escapeHtml(String(unit.level))}수준` : ''}</td>
            <td class="p-1 text-textMuted">${escapeHtml(unit.path?.[3] || '')}</td>
            <td class="p-1 ${unit.verified ? 'text-emerald-400' : 'text-amber-400'}">${unit.verified ? '확인' : '미검증'}</td>
            <td class="p-1"><button data-ncs-ref-action="edit" data-code="${escapeHtml(unit.code)}" class="underline text-textLight">편집</button></td>
        </tr>`).join('');
    const empty = _ncsRef.query.trim() ? '찾는 항목이 없습니다.' : '아직 요소를 등록한 능력단위가 없습니다. 검색해서 편집해주세요.';
    return `
        <table class="w-full text-[0.65rem]">
            <thead><tr class="text-textMuted text-left"><th class="p-1">코드</th><th class="p-1">능력단위 / 요소</th><th class="p-1">수준</th><th class="p-1">세분류</th><th class="p-1">검증</th><th class="p-1"></th></tr></thead>
            <tbody>${body || `<tr><td colspan="6" class="p-2 text-textMuted">${empty}</td></tr>`}</tbody>
        </table>`;
}

function ncsRefFormHtml(unit) {
    const field = 'w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white';
    const locked = unit && !unit.custom ? 'readonly' : '';
    const input = (name, label, value, attrs = '') => `<label class="block text-[0.65rem] text-textMuted">${label}<input data-ncs-ref="${name}" value="${escapeHtml(String(value ?? ''))}" class="${field} mt-0.5" ${attrs}></label>`;
    const lines = (unit?.elements || []).map(element => (element.code ? `${element.code} | ${element.name}` : element.name)).join('\n');
    return `
        <p class="text-xs font-bold text-textLight">${unit ? '능력단위 편집' : '능력단위 추가'}</p>
        <div class="grid grid-cols-2 gap-2">
            ${input('code', '분류번호', unit?.code, unit ? 'readonly' : '')}${input('name', '능력단위명', unit?.name, locked)}
            ${input('level', '수준', unit?.level, `type="number" min="1" max="8" ${locked}`)}${input('subclass', '세분류', unit?.path?.[3], locked)}
        </div>
        <label class="block text-[0.65rem] text-textMuted">능력단위요소 (한 줄에 하나: 코드 | 이름)<textarea data-ncs-ref="elements" rows="3" class="${field} mt-0.5">${escapeHtml(lines)}</textarea></label>
        <label class="flex items-center gap-2 text-xs text-textLight"><input type="checkbox" data-ncs-ref="verified" ${unit?.verified ? 'checked' : ''}> ncs.go.kr에서 확인함</label>
        <p id="ncs-ref-status" class="text-[0.65rem] text-accent min-h-[1em]"></p>
        <div class="flex justify-end gap-2">
            ${unit ? `<button data-ncs-ref-action="delete" data-code="${escapeHtml(unit.code)}" class="px-3 py-1 text-xs font-bold text-rose-300 bg-white/10 rounded">${unit.custom ? '이 능력단위 삭제' : '요소·검증 표시 지우기'}</button><button data-ncs-ref-action="new" class="px-3 py-1 text-xs font-bold text-textLight bg-white/10 rounded">새로 추가</button>` : ''}
            <button data-ncs-ref-action="save" class="px-3 py-1 text-xs font-bold text-white bg-accent rounded">목록에 저장</button>
        </div>`;
}

function renderNcsRefRows() {
    const list = document.getElementById('ncs-ref-rows');
    if (list && _ncsRef) list.innerHTML = ncsRefRowsHtml(ncsRefRows(_ncsRef.query));
    const stats = ncsRefStats();
    const summary = document.getElementById('ncs-ref-stats');
    if (summary) summary.textContent = `능력단위 ${stats.units.toLocaleString()}개 · 능력단위요소 ${stats.elements}개 · 직접 추가 ${stats.custom}개`;
}

function renderNcsRefForm() {
    const form = document.getElementById('ncs-ref-form');
    if (form && _ncsRef) form.innerHTML = ncsRefFormHtml(_ncsRef.editing ? ncsRefInfo(_ncsRef.editing) : null);
}

window.openNcsRefDialog = async function () {
    if (document.getElementById('ncs-ref-dialog')) return;
    try {
        await loadNcsCatalog();
    } catch (err) {
        return window.showAlert(err.message);
    }
    _ncsRef = { query: '', editing: null };
    const overlay = document.createElement('div');
    overlay.id = 'ncs-ref-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9100]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[680px] max-h-[86vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10">
                <div class="flex items-center">
                    <h2 class="text-sm font-bold text-textLight">NCS 참조 목록</h2>
                    <button data-ncs-ref-action="close" class="ml-auto px-3 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20">닫기</button>
                </div>
                <p class="text-[0.65rem] text-textMuted mt-1">추천은 이 목록 안에서 먼저 고릅니다. 요소와 직접 추가한 능력단위는 ncs.go.kr 원문을 확인해 등록하고 검증 표시를 바꿔주세요.</p>
                <p id="ncs-ref-stats" class="text-[0.65rem] text-accent mt-1"></p>
                <input id="ncs-ref-search" class="w-full mt-2 px-3 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-accent" placeholder="코드·이름·세분류 검색 (비우면 요소를 등록한 능력단위만 보입니다)">
            </div>
            <div id="ncs-ref-rows" class="flex-1 overflow-y-auto p-2 min-h-[120px]"></div>
            <div id="ncs-ref-form" class="p-3 border-t border-white/10 space-y-2"></div>
        </div>`;
    overlay.addEventListener('click', onNcsRefClick);
    overlay.querySelector('#ncs-ref-search').addEventListener('input', event => {
        _ncsRef = { ..._ncsRef, query: event.target.value };
        renderNcsRefRows();
    });
    document.body.appendChild(overlay);
    renderNcsRefRows();
    renderNcsRefForm();
};

async function refreshNcsRef(editing) {
    await saveState();
    _ncsRef = { ..._ncsRef, editing };
    renderNcsRefRows();
    renderNcsRefForm();
    renderNcsDialogList();
}

async function saveNcsRefForm() {
    const field = name => document.querySelector(`[data-ncs-ref="${name}"]`);
    try {
        const code = saveNcsRefUnit({
            code: field('code').value, name: field('name').value, level: field('level').value, subclass: field('subclass').value,
            elements: parseElementLines(field('elements').value), verified: field('verified').checked
        });
        await refreshNcsRef(code);
    } catch (err) {
        document.getElementById('ncs-ref-status').textContent = err.message;
    }
}

function onNcsRefClick(event) {
    const button = event.target.closest?.('[data-ncs-ref-action]');
    const action = button?.dataset.ncsRefAction;
    const code = button?.dataset.code;
    if (action === 'close') {
        document.getElementById('ncs-ref-dialog')?.remove();
        _ncsRef = null;
    }
    if (action === 'save') saveNcsRefForm();
    if (action === 'new' || action === 'edit') {
        _ncsRef = { ..._ncsRef, editing: action === 'edit' ? code : null };
        renderNcsRefForm();
    }
    if (action === 'delete') {
        window.showConfirm('이 항목을 참조 목록에서 지울까요? 교과와 차시에 이미 고른 값은 그대로 남습니다.', () => {
            deleteNcsRefUnit(code);
            refreshNcsRef(null);
        });
    }
}
