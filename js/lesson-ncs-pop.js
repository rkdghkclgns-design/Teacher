// lesson-ncs-pop.js - 차시 카드의 NCS 코드 팝업: 마우스를 올리면 코드별 상세와 적합도를 보여 주고, 골라서 확정한다
// 후보 목록은 차시 정보 대화상자와 같은 lessonElementEntries를 쓴다. 클릭하면 고정되어 마우스를 옮겨도 닫히지 않는다.

const NCS_POP_MAX_ROWS = 12;
const NCS_POP_CLOSE_MS = 250;
const NCS_POP_GAP = 6;
const NCS_POP_COPIED_MS = 1200;
const NCS_POP_COPY_ICON = '<i class="ph-bold ph-copy text-[0.7rem]"></i>';
// NCS 목록(카탈로그)은 필요할 때 불러온다. 다 불러오기 전에는 참조 목록에 있는지 알 수 없으므로 상태 배지를 미룬다
const NCS_POP_CATALOG_NOTE = {
    loading: 'NCS 목록을 확인하고 있습니다...',
    failed: 'NCS 목록을 불러오지 못해 참조 목록 여부와 수준을 표시하지 않습니다.'
};

let _ncsPop = null; // { moduleId, pinned, entries, selected }
let _ncsPopTimer = 0;

const ncsFitTone = fit => (fit >= 70 ? 'bg-emerald-500/20 text-emerald-300' : fit >= 40 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300');

/* ---------- 목록 ---------- */
// 고른 항목을 먼저, 그다음 적합도 높은 순으로 둔다
function lessonNcsPopEntries(mod, subject) {
    const selected = new Set((mod.ncsElements || []).map(elementKey));
    const score = entry => entry.rec?.fit ?? -1;
    return [...lessonElementEntries(mod, subjectElementOptions(subject))]
        .sort((a, b) => (selected.has(b.key) - selected.has(a.key)) || score(b) - score(a))
        .slice(0, NCS_POP_MAX_ROWS);
}

// 능력단위 이름·수준·세분류. 참조 목록에 없는 단위는 저장된 이름만 쓴다
function ncsPopUnitLine(element) {
    const unit = element.unitCode ? ncsUnit(element.unitCode) : null;
    return [
        `능력단위 ${element.unitName || unit?.name || ''}`.trim(),
        unit?.level ? `${unit.level}수준` : '',
        unit?.path?.[3] || '',
        element.unitLevel ? '능력단위 수준 배정' : ''
    ].filter(Boolean).join(' · ');
}

function ncsPopFitHtml(rec) {
    if (!rec) return '<span class="ml-auto shrink-0 text-[0.6875rem] text-textMuted">점수 없음</span>';
    const kind = rec.by === 'AI' ? 'AI 적합도' : '키워드 일치도';
    return `<span class="ml-auto shrink-0 text-[0.6875rem] font-bold px-1.5 py-0.5 rounded ${ncsFitTone(rec.fit)}" title="${kind}">${Number(rec.fit) || 0}점</span>`;
}

// 카드와 같이 요소 코드가 없으면 능력단위 코드를 쓴다
const ncsPopCode = element => element.code || element.unitCode || '';

// 행 안의 버튼이라 눌러도 체크가 바뀌지 않게 onNcsPopClick에서 기본 동작을 막는다
function ncsPopCopyButtonHtml(code) {
    const label = escapeHtml(`${code} 복사`);
    return `<button type="button" data-ncs-pop-action="copy" data-code="${escapeHtml(code)}" title="${label}" aria-label="${label}"
        class="shrink-0 px-1 rounded text-textMuted hover:text-white hover:bg-white/10">${NCS_POP_COPY_ICON}</button>`;
}

function ncsPopRowHtml(entry, checked, index, catalogReady = true) {
    const { key, element, rec } = entry;
    const code = ncsPopCode(element);
    // 코드도 단위도 없는 목록 밖 후보는 참고로만 보여 준다
    const blocked = !code;
    const covers = rec?.covers?.length ? ` · 학습 목표 ${rec.covers.join(', ')}` : '';
    return `
        <label data-ncs-pop-row="${index}" class="flex items-start gap-2 p-1.5 rounded hover:bg-white/5 ${blocked ? 'opacity-60' : 'cursor-pointer'}">
            <input type="checkbox" class="mt-0.5 shrink-0" data-ncs-pop-key="${escapeHtml(key)}" ${checked ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
            <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1">
                    <span class="font-mono text-[0.6875rem] text-white truncate">${escapeHtml(code || '(코드 없음)')}</span>
                    ${code ? ncsPopCopyButtonHtml(code) : ''}
                    ${catalogReady ? elementBadgeHtml(rec) : ''}
                    ${ncsPopFitHtml(rec)}
                </span>
                <span class="block text-[0.7rem] text-textLight">${escapeHtml(element.name)}</span>
                <span class="block text-[0.6875rem] text-textMuted">${escapeHtml(ncsPopUnitLine(element) + covers)}</span>
                ${rec?.reason ? `<span class="block text-[0.6875rem] text-textMuted">${rec.by === 'AI' ? '근거' : '찾은 방법'}: ${escapeHtml(rec.reason)}</span>` : ''}
            </span>
        </label>`;
}

function ncsPopStatus(mod) {
    if (!(mod.ncsElements || []).length) return { text: mod.ncsNone ? '모두 해제함' : '배정 없음', tone: 'bg-white/10 text-textMuted' };
    if (!mod.ncsAuto) return { text: '확정됨', tone: 'bg-emerald-500/20 text-emerald-300' };
    return { text: `${mod.ncsKeyword ? '키워드' : 'AI'} 자동 배정 · 확정 전`, tone: 'bg-amber-500/20 text-amber-300' };
}

// catalog: 'ready' | 'loading' | 'failed' (NCS 목록을 불러온 상태)
function ncsPopHtml(mod, entries, selected, pinned, catalog = 'ready') {
    const status = ncsPopStatus(mod);
    const rows = entries.length
        ? entries.map((entry, index) => ncsPopRowHtml(entry, selected.has(entry.key), index, catalog === 'ready')).join('')
        : '<p class="p-2 text-xs text-textMuted">후보가 없습니다. 차시 정보에서 AI 추천을 받아주세요.</p>';
    const note = NCS_POP_CATALOG_NOTE[catalog];
    return `
        <div class="flex items-center gap-2 mb-2">
            <b class="text-sm text-white">NCS 능력단위요소</b>
            <span class="text-[0.6875rem] px-1.5 py-0.5 rounded ${status.tone}">${status.text}</span>
            <span data-ncs-pop-pin class="ml-auto text-[0.6875rem] text-textMuted">${pinned ? '고정됨' : '클릭하면 고정'}</span>
        </div>
        ${note ? `<p class="mb-1 text-xs ${catalog === 'failed' ? 'text-rose-300' : 'text-textMuted'}">${note}</p>` : ''}
        <div class="space-y-0.5 max-h-72 overflow-y-auto">${rows}</div>
        <div class="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-white/10">
            <button data-ncs-pop-action="detail" class="text-[0.6875rem] text-textMuted hover:text-white underline">차시 정보에서 자세히</button>
            <span class="flex gap-1">
                <button data-ncs-pop-action="close" class="px-2 py-1 text-[0.6875rem] text-textLight rounded bg-white/10 hover:bg-white/20">닫기</button>
                <button data-ncs-pop-action="confirm" class="px-3 py-1 text-[0.6875rem] font-bold text-white bg-accent rounded hover:bg-accentHover">선택 확정 (${selected.size})</button>
            </span>
        </div>`;
}

// 고른 항목을 확정 값으로 바꾼다. 모두 해제하면 빈 차시 채우기가 다시 넣지 않는다
function confirmedNcsChange(entries, selected) {
    const picked = entries.filter(entry => selected.has(entry.key)).map(({ element }) => {
        const { auto, ...rest } = element;
        return rest;
    });
    return { ncsElements: picked, ncsAuto: false, ncsKeyword: false, ncsNone: !picked.length };
}

// 마우스를 올린 항목을 크게 보여 주는 상세 카드. 학습 목표 번호는 추천 때 쓴 목록(qbankObjectives)의 순서다
function ncsPopDetailHtml(entry, mod, catalogReady = true) {
    const { element, rec } = entry;
    const code = ncsPopCode(element);
    const objectives = qbankObjectives(mod);
    const covers = rec?.covers || [];
    const section = (title, body) => `<div class="mt-3"><p class="text-xs font-bold text-textMuted mb-1">${title}</p>${body}</div>`;
    return `
        <div class="flex items-center gap-2 flex-wrap">
            <span class="font-mono text-sm font-bold text-white">${escapeHtml(code || '(코드 없음)')}</span>
            ${catalogReady ? elementBadgeHtml(rec) : ''}
            ${rec ? `<span class="ml-auto text-xs font-bold px-2 py-0.5 rounded ${ncsFitTone(rec.fit)}">${rec.by === 'AI' ? 'AI 적합도' : '키워드 일치도'} ${Number(rec.fit) || 0}점</span>` : ''}
        </div>
        <p class="mt-2 text-base font-bold text-white leading-snug">${escapeHtml(element.name || '')}</p>
        <p class="mt-1 text-xs text-textLight">${escapeHtml(ncsPopUnitLine(element))}</p>
        ${covers.length ? section('관련 학습 목표', `<ul class="space-y-1 text-[0.8rem] text-textLight leading-relaxed">${covers.map(no => `<li><b class="text-accent">${no}.</b> ${escapeHtml(objectives[no - 1] || '지금 교안에는 없는 번호입니다')}</li>`).join('')}</ul>`) : ''}
        ${rec?.reason ? section(rec.by === 'AI' ? '근거' : '찾은 방법', `<p class="text-[0.85rem] text-textLight leading-relaxed whitespace-pre-wrap">${escapeHtml(rec.reason)}</p>`) : ''}
        ${rec ? '' : '<p class="mt-3 text-xs text-textMuted">교과에 등록한 요소입니다. 적합도 점수는 차시 정보에서 AI 추천을 받으면 생깁니다.</p>'}`;
}

/* ---------- 화면 ---------- */
const ncsPopModule = () => (_ncsPop ? getEditingModule(Number(_ncsPop.moduleId) || _ncsPop.moduleId) : null);

function closeLessonNcsPop() {
    clearTimeout(_ncsPopTimer);
    hideNcsPopDetail();
    document.getElementById('lesson-ncs-pop')?.remove();
    _ncsPop = null;
}

/* ---------- 큰 상세 카드 ---------- */
const hideNcsPopDetail = () => document.getElementById('lesson-ncs-pop-detail')?.remove();

// 팝업 오른쪽에 두고, 자리가 없으면 왼쪽에 둔다. 높이는 마우스를 올린 행에 맞추되 화면 안에 둔다
function placeNcsPopDetail(card, pop, row) {
    card.style.visibility = 'hidden';
    requestAnimationFrame(() => {
        if (!card.isConnected) return;
        if (!row.isConnected) return hideNcsPopDetail();
        const box = pop.getBoundingClientRect();
        const anchor = row.getBoundingClientRect();
        const size = card.getBoundingClientRect();
        const right = box.right + NCS_POP_GAP;
        const left = right + size.width <= window.innerWidth - NCS_POP_GAP ? right : Math.max(NCS_POP_GAP, box.left - size.width - NCS_POP_GAP);
        const top = Math.max(NCS_POP_GAP, Math.min(anchor.top, window.innerHeight - size.height - NCS_POP_GAP));
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
        card.style.visibility = 'visible';
    });
}

// 마우스가 지나가는 동안 보기만 하는 카드라 마우스를 받지 않는다 (pointer-events-none)
function showNcsPopDetail(row) {
    const entry = _ncsPop?.entries[Number(row.dataset.ncsPopRow)];
    const mod = ncsPopModule();
    const pop = document.getElementById('lesson-ncs-pop');
    if (!entry || !mod || !pop) return hideNcsPopDetail();
    let card = document.getElementById('lesson-ncs-pop-detail');
    if (card?.dataset.row === row.dataset.ncsPopRow) return;
    if (!card) {
        card = document.createElement('div');
        card.id = 'lesson-ncs-pop-detail';
        card.className = 'fixed z-[9501] w-[420px] max-w-[92vw] p-4 bg-[#141428] border border-accent/40 rounded-xl shadow-2xl pointer-events-none';
        document.body.appendChild(card);
    }
    card.dataset.row = row.dataset.ncsPopRow;
    card.innerHTML = ncsPopDetailHtml(entry, mod, _ncsPop.catalog === 'ready');
    placeNcsPopDetail(card, pop, row);
}

function onNcsPopHover(event) {
    const row = event.target.closest?.('[data-ncs-pop-row]');
    if (row) showNcsPopDetail(row);
    else hideNcsPopDetail();
}

async function copyNcsPopCode(button) {
    const code = button.dataset.code;
    try {
        await copyPlainText(code);
        button.innerHTML = '<i class="ph-bold ph-check text-[0.7rem] text-emerald-300"></i>';
        setTimeout(() => { if (button.isConnected) button.innerHTML = NCS_POP_COPY_ICON; }, NCS_POP_COPIED_MS);
        window.showToast?.(`NCS 코드를 복사했습니다: ${code}`, 'success');
    } catch (err) {
        console.error('[NCS 팝업] 코드 복사 실패:', err);
        window.showAlert(`코드를 복사하지 못했습니다: ${code}`);
    }
}

// 아래 공간이 모자라면 위로 띄우고, 좌우는 화면 안에 둔다.
// Tailwind CDN은 새 클래스의 스타일을 DOM이 바뀐 뒤에 만들므로 다음 프레임에 크기를 재고, 그때까지 숨겨 둔다
function placeNcsPop(pop, trigger) {
    pop.style.visibility = 'hidden';
    requestAnimationFrame(() => {
        if (!pop.isConnected) return;
        if (!trigger.isConnected) return closeLessonNcsPop(); // 그사이 목록을 다시 그렸다
        const anchor = trigger.getBoundingClientRect();
        const box = pop.getBoundingClientRect();
        const below = anchor.bottom + NCS_POP_GAP;
        const top = below + box.height > window.innerHeight ? Math.max(NCS_POP_GAP, anchor.top - box.height - NCS_POP_GAP) : below;
        pop.style.top = `${top}px`;
        pop.style.left = `${Math.min(Math.max(NCS_POP_GAP, anchor.left), window.innerWidth - box.width - NCS_POP_GAP)}px`;
        pop.style.visibility = 'visible';
    });
}

function renderNcsPop(trigger) {
    const mod = ncsPopModule();
    if (!mod) return closeLessonNcsPop();
    let pop = document.getElementById('lesson-ncs-pop');
    if (!pop) {
        pop = document.createElement('div');
        pop.id = 'lesson-ncs-pop';
        pop.className = 'fixed z-[9500] w-[380px] max-w-[92vw] p-3 bg-[#1a1a2e] border border-white/15 rounded-xl shadow-2xl text-xs text-textLight';
        pop.addEventListener('mouseenter', () => clearTimeout(_ncsPopTimer));
        pop.addEventListener('mouseleave', () => {
            hideNcsPopDetail();
            window.scheduleLessonNcsPopClose();
        });
        pop.addEventListener('mouseover', onNcsPopHover);
        pop.addEventListener('scroll', hideNcsPopDetail, true); // 목록을 스크롤하면 카드 위치가 어긋난다
        pop.addEventListener('click', onNcsPopClick);
        pop.addEventListener('change', onNcsPopChange);
        document.body.appendChild(pop);
    }
    hideNcsPopDetail();
    pop.innerHTML = ncsPopHtml(mod, _ncsPop.entries, _ncsPop.selected, _ncsPop.pinned, _ncsPop.catalog);
    if (trigger) placeNcsPop(pop, trigger);
}

// 목록을 다 불러오면 같은 차시의 팝업이 아직 열려 있을 때만 다시 그린다. 고른 항목과 고정 여부는 상태에 있어 유지된다
async function refreshNcsPopCatalog(moduleId) {
    let catalog = 'ready';
    try {
        await loadNcsCatalog();
    } catch (err) {
        console.warn('[NCS 팝업] NCS 목록을 불러오지 못했습니다:', err.message);
        catalog = 'failed';
    }
    if (_ncsPop?.moduleId !== moduleId || !document.getElementById('lesson-ncs-pop')) return;
    _ncsPop = { ..._ncsPop, catalog };
    renderNcsPop(_ncsPop.trigger?.isConnected ? _ncsPop.trigger : null); // 목록이 다시 그려졌으면 자리는 그대로 둔다
}

function startNcsPop(trigger, pinned) {
    const mod = getEditingModule(Number(trigger.dataset.ncsPop) || trigger.dataset.ncsPop);
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    if (!mod) return;
    const catalog = window.KBuilder?.NCS ? 'ready' : 'loading';
    _ncsPop = { moduleId: String(mod.id), pinned, trigger, catalog, entries: lessonNcsPopEntries(mod, subject), selected: new Set((mod.ncsElements || []).map(elementKey)) };
    renderNcsPop(trigger);
    if (catalog === 'loading') refreshNcsPopCatalog(_ncsPop.moduleId);
}

const isOpenFor = trigger => !!_ncsPop && _ncsPop.moduleId === trigger.dataset.ncsPop && !!document.getElementById('lesson-ncs-pop');

window.openLessonNcsPop = function (trigger) {
    clearTimeout(_ncsPopTimer);
    if (isOpenFor(trigger) || _ncsPop?.pinned) return; // 고정한 팝업은 다른 카드에 마우스가 지나가도 바꾸지 않는다
    startNcsPop(trigger, false);
};

window.toggleLessonNcsPop = function (trigger) {
    if (isOpenFor(trigger) && _ncsPop.pinned) return closeLessonNcsPop();
    if (isOpenFor(trigger)) {
        _ncsPop = { ..._ncsPop, pinned: true };
        return renderNcsPop();
    }
    startNcsPop(trigger, true);
};

window.scheduleLessonNcsPopClose = function () {
    clearTimeout(_ncsPopTimer);
    if (_ncsPop?.pinned) return;
    _ncsPopTimer = setTimeout(closeLessonNcsPop, NCS_POP_CLOSE_MS);
};

function onNcsPopChange(event) {
    const key = event.target.dataset?.ncsPopKey;
    if (key === undefined || !_ncsPop) return;
    const selected = new Set(_ncsPop.selected);
    if (event.target.checked) selected.add(key);
    else selected.delete(key);
    _ncsPop = { ..._ncsPop, selected, pinned: true }; // 고르기 시작하면 실수로 닫히지 않게 고정한다
    // 목록 스크롤이 처음으로 돌아가지 않게 전체를 다시 그리지 않고 글자만 바꾼다
    const confirm = document.querySelector('#lesson-ncs-pop [data-ncs-pop-action="confirm"]');
    if (confirm) confirm.textContent = `선택 확정 (${selected.size})`;
    const pin = document.querySelector('#lesson-ncs-pop [data-ncs-pop-pin]');
    if (pin) pin.textContent = '고정됨';
}

async function confirmNcsPop() {
    const mod = ncsPopModule();
    if (!mod) return closeLessonNcsPop();
    const change = confirmedNcsChange(_ncsPop.entries, _ncsPop.selected);
    const count = change.ncsElements.length;
    Object.assign(mod, change, withHistoryNote(mod, count ? `NCS 요소 확정 ${count}개` : 'NCS 요소 모두 해제'));
    closeLessonNcsPop();
    try {
        await saveState();
        window.showToast?.(count ? `NCS 요소 ${count}개를 확정했습니다.` : 'NCS 요소를 모두 해제했습니다.', 'success');
    } catch (err) {
        console.error('[NCS 팝업] 저장 실패:', err);
        window.showAlert(`NCS 요소를 저장하지 못했습니다: ${err.message}`);
    }
    renderSidebar();
    window.applyLessonFilter?.();
}

function onNcsPopClick(event) {
    const button = event.target.closest?.('[data-ncs-pop-action]');
    const action = button?.dataset.ncsPopAction;
    if (action === 'copy') {
        event.preventDefault(); // 행(label) 안의 버튼이라 막지 않으면 체크가 바뀐다
        copyNcsPopCode(button);
    }
    if (action === 'close') closeLessonNcsPop();
    if (action === 'confirm') confirmNcsPop();
    if (action === 'detail') {
        const moduleId = _ncsPop?.moduleId;
        closeLessonNcsPop();
        window.openLessonMeta(Number(moduleId) || moduleId);
    }
}

// 고정한 팝업은 바깥을 누르거나 Esc로 닫는다
document.addEventListener('click', event => {
    if (!_ncsPop || event.target.closest?.('#lesson-ncs-pop, [data-ncs-pop]')) return;
    closeLessonNcsPop();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && _ncsPop) closeLessonNcsPop();
});
