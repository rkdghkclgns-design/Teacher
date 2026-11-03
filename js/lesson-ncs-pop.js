// lesson-ncs-pop.js - 차시 카드의 NCS 코드 팝업: 마우스를 올리면 코드별 상세와 적합도를 보여 주고, 골라서 확정한다
// 후보 목록은 차시 정보 대화상자와 같은 lessonElementEntries를 쓴다. 클릭하면 고정되어 마우스를 옮겨도 닫히지 않는다.

const NCS_POP_MAX_ROWS = 12;
const NCS_POP_CLOSE_MS = 250;
const NCS_POP_GAP = 6;

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
    if (!rec) return '<span class="ml-auto shrink-0 text-[0.6rem] text-textMuted">점수 없음</span>';
    const kind = rec.by === 'AI' ? 'AI 적합도' : '키워드 일치도';
    return `<span class="ml-auto shrink-0 text-[0.6rem] font-bold px-1.5 py-0.5 rounded ${ncsFitTone(rec.fit)}" title="${kind}">${Number(rec.fit) || 0}점</span>`;
}

function ncsPopRowHtml(entry, checked) {
    const { key, element, rec } = entry;
    // 코드도 단위도 없는 목록 밖 후보는 참고로만 보여 준다
    const blocked = !element.unitCode && !element.code;
    const covers = rec?.covers?.length ? ` · 학습 목표 ${rec.covers.join(', ')}` : '';
    return `
        <label class="flex items-start gap-2 p-1.5 rounded hover:bg-white/5 ${blocked ? 'opacity-60' : 'cursor-pointer'}">
            <input type="checkbox" class="mt-0.5 shrink-0" data-ncs-pop-key="${escapeHtml(key)}" ${checked ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
            <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1">
                    <span class="font-mono text-[0.65rem] text-white truncate">${escapeHtml(element.code || '(코드 없음)')}</span>
                    ${elementBadgeHtml(rec)}
                    ${ncsPopFitHtml(rec)}
                </span>
                <span class="block text-[0.7rem] text-textLight">${escapeHtml(element.name)}</span>
                <span class="block text-[0.6rem] text-textMuted">${escapeHtml(ncsPopUnitLine(element) + covers)}</span>
                ${rec?.reason ? `<span class="block text-[0.6rem] text-textMuted/80">${rec.by === 'AI' ? '근거' : '찾은 방법'}: ${escapeHtml(rec.reason)}</span>` : ''}
            </span>
        </label>`;
}

function ncsPopStatus(mod) {
    if (!(mod.ncsElements || []).length) return { text: mod.ncsNone ? '모두 해제함' : '배정 없음', tone: 'bg-white/10 text-textMuted' };
    if (!mod.ncsAuto) return { text: '확정됨', tone: 'bg-emerald-500/20 text-emerald-300' };
    return { text: `${mod.ncsKeyword ? '키워드' : 'AI'} 자동 배정 · 확정 전`, tone: 'bg-amber-500/20 text-amber-300' };
}

function ncsPopHtml(mod, entries, selected, pinned) {
    const status = ncsPopStatus(mod);
    const rows = entries.length
        ? entries.map(entry => ncsPopRowHtml(entry, selected.has(entry.key))).join('')
        : '<p class="p-2 text-[0.7rem] text-textMuted">후보가 없습니다. 차시 정보에서 AI 추천을 받아주세요.</p>';
    return `
        <div class="flex items-center gap-2 mb-2">
            <b class="text-sm text-white">NCS 능력단위요소</b>
            <span class="text-[0.6rem] px-1.5 py-0.5 rounded ${status.tone}">${status.text}</span>
            <span data-ncs-pop-pin class="ml-auto text-[0.6rem] text-textMuted">${pinned ? '고정됨' : '클릭하면 고정'}</span>
        </div>
        <div class="space-y-0.5 max-h-72 overflow-y-auto">${rows}</div>
        <div class="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-white/10">
            <button data-ncs-pop-action="detail" class="text-[0.65rem] text-textMuted hover:text-white underline">차시 정보에서 자세히</button>
            <span class="flex gap-1">
                <button data-ncs-pop-action="close" class="px-2 py-1 text-[0.65rem] text-textLight rounded bg-white/10 hover:bg-white/20">닫기</button>
                <button data-ncs-pop-action="confirm" class="px-3 py-1 text-[0.65rem] font-bold text-white bg-accent rounded hover:bg-accentHover">선택 확정 (${selected.size})</button>
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

/* ---------- 화면 ---------- */
const ncsPopModule = () => (_ncsPop ? getEditingModule(Number(_ncsPop.moduleId) || _ncsPop.moduleId) : null);

function closeLessonNcsPop() {
    clearTimeout(_ncsPopTimer);
    document.getElementById('lesson-ncs-pop')?.remove();
    _ncsPop = null;
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
        pop.addEventListener('mouseleave', () => window.scheduleLessonNcsPopClose());
        pop.addEventListener('click', onNcsPopClick);
        pop.addEventListener('change', onNcsPopChange);
        document.body.appendChild(pop);
    }
    pop.innerHTML = ncsPopHtml(mod, _ncsPop.entries, _ncsPop.selected, _ncsPop.pinned);
    if (trigger) placeNcsPop(pop, trigger);
}

function startNcsPop(trigger, pinned) {
    const mod = getEditingModule(Number(trigger.dataset.ncsPop) || trigger.dataset.ncsPop);
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    if (!mod) return;
    _ncsPop = { moduleId: String(mod.id), pinned, entries: lessonNcsPopEntries(mod, subject), selected: new Set((mod.ncsElements || []).map(elementKey)) };
    renderNcsPop(trigger);
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
    const action = event.target.closest?.('[data-ncs-pop-action]')?.dataset.ncsPopAction;
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
