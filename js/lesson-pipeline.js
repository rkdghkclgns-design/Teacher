// lesson-pipeline.js - 차시 전체 생성: 교안 탭 → 교수안·슬라이드 → 문제은행을 차례로 만든다
// 화면을 막지 않으므로 생성하는 동안 끝난 항목을 읽을 수 있다. 진행은 아래쪽 막대와 탐색줄 표시로 보여 준다.
// 있는 항목은 건드리지 않고 빈 항목만 채운다. 항목마다 저장하므로 멈춰도 만든 내용은 남는다.

const QBANK_FILL_COUNT = 3;
const PIPELINE_COOLDOWN_MS = 2000; // 호출 한도를 피하려고 항목 사이를 둔다

let _pipeline = null;

window.isLessonPipelineRunning = () => !!_pipeline;
window.isPipelineStep = id => _pipeline?.current === id;

/* ---------- 문제은행 채우기 ---------- */
function questionBankGaps(mod) {
    const covered = new Set(qbankQuestions(mod).map(question => question.objective));
    return qbankObjectives(mod).map((_, index) => index + 1).filter(no => !covered.has(no));
}

// 학습 목표마다 문항이 있도록 빠진 목표의 문항을 채운다. 문제은행은 학습이해도 탭의 마크다운을 쓴다
async function fillQuestionBank(moduleId, { isStopped = () => false, onStatus = () => {} } = {}) {
    for (const objective of questionBankGaps(getEditingModule(moduleId))) {
        if (isStopped()) return { ok: false, stopped: true };
        onStatus(`학습 목표 ${objective}의 문항을 만들고 있습니다...`);
        const mod = getEditingModule(moduleId);
        const questions = await generateQuestions(mod, { objective, band: 'L1', type: '객관식', multi: false, count: QBANK_FILL_COUNT });
        setTabMarkdown(mod, 'assessment', appendQuestionsMd(qbankMarkdown(mod), questions));
        Object.assign(mod, withHistoryNote(mod, `문제은행 문항 생성 (학습 목표 ${objective}, ${questions.length}개)`));
        await saveState();
    }
    return { ok: true };
}

/* ---------- 단계 ---------- */
function pipelineSteps(moduleId, lockedByTab) {
    const tabs = LESSON_TABS.map(tab => ({
        id: tab.id,
        label: tab.label,
        needed: mod => lessonMissingTabs(mod).includes(tab.id),
        run: () => generateTabContent(moduleId, tab.id, { quiet: true, background: true, lockedBlocks: lockedByTab[tab.id], onStatus: window.setPipelineStatus })
    }));
    if (moduleId === 'mainQuest') return tabs;
    return [
        ...tabs,
        { id: 'gyosuan', label: '교수안·슬라이드', needed: lessonNeedsGyosuan, run: () => runGyosuanGeneration(moduleId, { background: true, onStatus: window.setPipelineStatus }) },
        { id: 'qbank', label: '문제은행', needed: mod => questionBankGaps(mod).length > 0, run: () => fillQuestionBank(moduleId, { isStopped: () => !!_pipeline?.stopped, onStatus: window.setPipelineStatus }) }
    ];
}

async function runPipelineStep(step) {
    try {
        return await step.run();
    } catch (err) {
        console.error('[전체 생성] 단계 실패:', step.label, err);
        return { ok: false, error: err?.message || String(err) };
    }
}

/* ---------- 진행 막대 ---------- */
function pipelineBarHtml(run) {
    const percent = run.total ? Math.round(run.done / run.total * 100) : 0;
    const position = run.total ? `${Math.min(run.done + 1, run.total)}/${run.total} · ` : '';
    return `
        <div class="min-w-0 flex-1">
            <p class="text-xs font-bold text-white truncate">${position}${escapeHtml(run.label)}</p>
            <p class="text-[0.65rem] text-white/60 truncate min-h-[1em]">${escapeHtml(run.status)}</p>
            <div class="mt-1 h-1 rounded bg-white/15 overflow-hidden"><div class="h-full bg-accent transition-all" style="width:${percent}%"></div></div>
        </div>
        <button onclick="requestLessonPipelineStop()" ${run.stopped ? 'disabled' : ''} class="shrink-0 px-3 py-1.5 text-xs font-bold text-white bg-white/10 rounded-lg hover:bg-white/20 disabled:opacity-50">${run.stopped ? '멈추는 중' : '중지'}</button>`;
}

function renderPipelineBar(run) {
    const existing = document.getElementById('lesson-pipeline-bar');
    const bar = existing || document.createElement('div');
    bar.id = 'lesson-pipeline-bar';
    bar.className = 'fixed bottom-28 right-6 z-[8000] w-[380px] max-w-[92vw] flex items-center gap-3 px-4 py-2.5 bg-[#1a1a2e] border border-white/15 rounded-2xl shadow-2xl';
    bar.innerHTML = pipelineBarHtml(run);
    if (!existing) document.body.appendChild(bar);
}

function refreshPipelineView(run) {
    renderPipelineBar(run);
    const mod = getEditingModule(run.moduleId);
    if (mod) window.refreshLessonNav?.(mod);
}

window.setPipelineStatus = function (text) {
    if (!_pipeline) return;
    _pipeline.status = text;
    renderPipelineBar(_pipeline);
};

window.requestLessonPipelineStop = function () {
    if (!_pipeline) return;
    _pipeline.stopped = true; // 진행 중인 실행이 같은 객체를 읽는다
    _pipeline.status = '받고 있는 내용까지만 저장합니다...';
    window.requestTabGenerationStop?.();
    renderPipelineBar(_pipeline);
};

/* ---------- 실행 ---------- */
window.beginLessonPipeline = function (moduleId) {
    _pipeline = { moduleId, stopped: false, current: LESSON_TABS[0].id, label: LESSON_TABS[0].label, status: '', done: 0, total: 0, failed: [] };
    _suppressTabAlert = true;
    _tabGenStop = false;
    refreshPipelineView(_pipeline);
};

function pipelineSummary(run) {
    if (run.failed.length) return { alert: `일부 항목을 만들지 못했습니다.\n${run.failed.join('\n')}\n\n전체 생성을 다시 누르면 빠진 항목만 만듭니다.` };
    return run.stopped ? { toast: '전체 생성을 중지했습니다. 만든 내용은 저장했습니다.', kind: 'warning' } : { toast: '전체 생성을 마쳤습니다.', kind: 'success' };
}

window.finishLessonPipeline = function () {
    const run = _pipeline;
    if (!run) return;
    _pipeline = null;
    _suppressTabAlert = false;
    document.getElementById('lesson-pipeline-bar')?.remove();
    const mod = getEditingModule(run.moduleId);
    if (mod) window.refreshLessonNav?.(mod);
    renderSidebar();
    const { alert, toast, kind } = pipelineSummary(run);
    if (alert) window.showAlert(alert);
    else window.showToast?.(toast, kind);
};

// continuing: 교안 전체 생성이 기본 학습을 만든 뒤 이어서 부를 때 / lockedByTab: 재생성 전에 챙겨 둔 고정 섹션
window.runLessonPipeline = async function (moduleId, { lockedByTab = {}, continuing = false } = {}) {
    if (_pipeline && !continuing) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    if (!continuing) window.beginLessonPipeline(moduleId);
    const run = _pipeline;
    if (String(currentEditingModuleId) === String(moduleId)) renderEditor(getEditingModule(moduleId));
    const steps = pipelineSteps(moduleId, lockedByTab);
    run.total = steps.length;
    try {
        for (let i = 0; i < steps.length; i++) {
            const mod = getEditingModule(moduleId);
            if (!mod || run.stopped) break;
            if (!steps[i].needed(mod)) continue;
            Object.assign(run, { current: steps[i].id, label: steps[i].label, status: '', done: i });
            refreshPipelineView(run);
            const result = await runPipelineStep(steps[i]);
            if (!result.ok && !result.stopped) run.failed.push(`${steps[i].label}: ${result.error}`);
            if (!run.stopped) await new Promise(resolve => setTimeout(resolve, PIPELINE_COOLDOWN_MS));
        }
    } finally {
        window.finishLessonPipeline();
    }
};

// 탐색줄의 전체 생성 버튼. 빈 항목이 없으면 다시 만들지 묻는다
window.startLessonGeneration = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return;
    if (_pipeline) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    if (pipelineSteps(moduleId, {}).some(step => step.needed(mod))) return window.runLessonPipeline(moduleId);
    return window.showConfirm('모든 항목이 있습니다. 교안 탭을 모두 다시 만들까요?', () => generateAllTabs(moduleId));
};

// 도구 메뉴는 바깥을 누르면 닫는다
document.addEventListener?.('click', event => {
    const menu = document.getElementById('lesson-tools-menu');
    if (menu?.open && !menu.contains(event.target)) menu.open = false;
});
