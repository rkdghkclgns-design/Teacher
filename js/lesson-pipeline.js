// lesson-pipeline.js - 차시 전체 생성: 교안 탭 → 삽화 → NCS 요소 → 기본학습·심화학습 교수안·슬라이드 → 두 문제은행을 차례로 만든다
// 화면을 막지 않으므로 생성하는 동안 끝난 항목을 읽을 수 있다. 진행은 아래쪽 막대와 탐색줄 표시로 보여 준다.
// 탭 하나 만들기·탭 전체 AI 수정·탭 모두 다시 만들기·일괄 이미지 찾기도 같은 막대와 중지를 쓴다 (runLessonJob).
// 있는 항목은 건드리지 않고 빈 항목만 채운다. 항목마다 저장하므로 멈춰도 만든 내용은 남는다.

const QBANK_FILL_COUNT = 3;
const PIPELINE_COOLDOWN_MS = 2000; // 호출 한도를 피하려고 항목 사이를 둔다

let _pipeline = null;

const isPipelineLesson = moduleId => !!_pipeline && String(_pipeline.moduleId) === String(moduleId);

// moduleId를 주면 그 차시를 만드는 중인지 본다. 다른 차시를 보는 동안 거짓 진행 표시를 하지 않는다
window.isLessonPipelineRunning = moduleId => (moduleId === undefined ? !!_pipeline : isPipelineLesson(moduleId));
window.isPipelineStep = (id, moduleId) => isPipelineLesson(moduleId) && _pipeline.current === id;

/* ---------- 문제은행 채우기 ---------- */
// 그 갈래의 문제은행에서 문항이 없는 학습 목표 번호. 학습·실습 탭이 빈 갈래는 문항을 만들 원고가 없어 채우지 않는다
function questionBankGaps(mod, trackId = 'basic') {
    if (!trackHasContent(mod, trackId)) return [];
    const covered = new Set(qbankQuestions(mod, trackId).map(question => question.objective));
    return qbankObjectives(mod, trackId).map((_, index) => index + 1).filter(no => !covered.has(no));
}

// 두 갈래 문제은행의 빈 목표 수를 더한다(일괄 생성 대기열·전체 생성의 단계)
const lessonQuestionGaps = mod => LESSON_TRACKS.reduce((sum, track) => sum + questionBankGaps(mod, track.id).length, 0);

// 갈래마다 학습 목표에 문항이 있도록 빠진 목표의 문항을 채운다(기본학습 → 심화학습). 문제은행은 그 갈래 문제은행 탭(학습이해도·심화이해도)의 마크다운을 쓴다
async function fillQuestionBank(moduleId, { isStopped = () => false, onStatus = () => {} } = {}) {
    const lesson = getEditingModule(moduleId);
    if (!lesson) return { ok: false, error: '차시를 찾지 못했습니다.' };
    for (const track of LESSON_TRACKS) {
        for (const objective of questionBankGaps(lesson, track.id)) {
            if (isStopped()) return { ok: false, stopped: true };
            onStatus(`${track.label} 학습 목표 ${objective}의 문항을 만들고 있습니다...`);
            const mod = getEditingModule(moduleId);
            if (!mod) return { ok: false, error: '차시를 찾지 못했습니다.' };
            const questions = await generateQuestions(mod, { objective, band: 'L1', type: '객관식', multi: false, count: QBANK_FILL_COUNT }, track.id);
            setTabMarkdown(mod, track.bank, appendQuestionsMd(qbankMarkdown(mod, track.id), questions));
            Object.assign(mod, withHistoryNote(mod, `${track.label} 문제은행 문항 생성 (학습 목표 ${objective}, ${questions.length}개)`));
            await saveState();
        }
    }
    return { ok: true };
}

// 그 갈래의 학습·실습 탭 가운데 아직 없는 탭이 있는가(전체 생성·일괄 생성은 빈 탭을 먼저 만든다)
function trackTabsMissing(mod, trackId) {
    const track = lessonTrack(trackId);
    return lessonMissingTabs(mod).some(id => id === track.learn || id === track.practice);
}

// 미리 보기에 셀 문제은행 채우기 수(갈래마다 하나): 빈 목표가 있거나 이번에 학습·실습 탭을 만드는 갈래. overwrite: 모두 다시 만든다
const qbankFillCount = (lesson, overwrite = false) => LESSON_TRACKS.filter(track => overwrite || questionBankGaps(lesson, track.id).length > 0 || trackTabsMissing(lesson, track.id)).length;

/* ---------- 교안 뒤 보강 ---------- */
// 교안 본문에는 이미지 태그 생성이 따로 돌아 호출이 겹치므로 삽화는 일괄 생성 창에서 켠 경우에만 그린다
const lessonWantsArt = mod => !!globalState.courseDesign?.autoArt && lessonNeedsArt(mod);

async function fillPipelineArt(moduleId, isStopped, onStatus) {
    onStatus('교안에 넣을 삽화를 그리고 있습니다...');
    await fillLessonArt(getEditingModule(moduleId), isStopped);
    await saveState();
    return { ok: true };
}

async function fillPipelineElements(moduleId, onStatus) {
    onStatus('NCS 능력단위요소를 배정하고 있습니다...');
    await assignLessonElements(globalState.subjects.find(item => item.id === currentSubjectId), getEditingModule(moduleId));
    await saveState();
    return { ok: true };
}

// 확정한 NCS 요소와 이미 돌린 삽화는 건드리지 않는다
function lessonExtraSteps(moduleId, { isStopped, onStatus }) {
    return [
        { id: 'art', label: '삽화', afterTabs: true, needed: lessonWantsArt, run: () => fillPipelineArt(moduleId, isStopped, onStatus) },
        { id: 'ncsElements', label: 'NCS 요소 배정', afterTabs: true, needed: needsElementAutoAssign, run: () => fillPipelineElements(moduleId, onStatus) }
    ];
}

// 일괄 생성용. 보강이 실패해도 교안은 있으므로 차시를 실패로 치지 않고 안내만 한다. 기존 내용 보강에서 다시 채울 수 있다
async function runLessonExtras(moduleId, options) {
    for (const step of lessonExtraSteps(moduleId, options)) {
        const mod = getEditingModule(moduleId);
        if (!mod || options.isStopped()) return;
        const result = step.needed(mod) ? await runPipelineStep(step) : { ok: true };
        if (!result.ok) window.showToast?.(`${mod.title} · ${step.label} 실패: ${result.error}`, 'warning');
    }
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
    // 교수안·슬라이드는 갈래마다 따로 만든다. 단계 id는 그 교수안을 담는 차시 칸 이름이다(gyosuan · gyosuanAdv, tabs.js LESSON_PANELS)
    const gyosuanSteps = LESSON_TRACKS.map(track => ({
        id: track.field, label: `${track.label} 교수안·슬라이드`, afterTabs: true, gyosuan: true,
        needed: mod => lessonNeedsGyosuan(mod, track.id),
        run: () => runGyosuanGeneration(moduleId, { background: true, track: track.id, onStatus: window.setPipelineStatus })
    }));
    return [
        ...tabs,
        ...lessonExtraSteps(moduleId, { isStopped: () => !!_pipeline?.stopped, onStatus: window.setPipelineStatus }),
        ...gyosuanSteps,
        { id: 'qbank', label: '문제은행', afterTabs: true, needed: mod => qbankFillCount(mod) > 0, run:() => fillQuestionBank(moduleId, { isStopped: () => !!_pipeline?.stopped, onStatus: window.setPipelineStatus }) }
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
const PIPELINE_TICK_MS = 1000;
const formatElapsed = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

// 단계가 하나뿐인 작업은 비율 대신 움직이는 막대로 진행 중임을 보인다
function pipelineBarHtml(run) {
    const steps = run.total > 1;
    const percent = steps ? Math.round(run.done / run.total * 100) : 100;
    const position = steps ? `${Math.min(run.done + 1, run.total)}/${run.total} · ` : '';
    return `
        <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
                <p class="flex-1 text-xs font-bold text-white truncate">${position}${escapeHtml(run.label)}</p>
                <span data-pipeline-elapsed class="shrink-0 text-xs text-white/60 tabular-nums" title="걸린 시간">${formatElapsed(Date.now() - run.startedAt)}</span>
            </div>
            <p class="text-xs text-white/60 truncate min-h-[1em]" title="${escapeHtml(run.status)}">${escapeHtml(run.status)}</p>
            <div class="mt-1 h-1 rounded bg-white/15 overflow-hidden"><div class="h-full bg-accent transition-all ${steps ? '' : 'animate-pulse'}" style="width:${percent}%"></div></div>
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

// 응답 하나를 오래 기다려도 멈춘 것처럼 보이지 않게 걸린 시간만 고친다. 막대 전체를 다시 그리면 중지 버튼 클릭을 놓친다
function startPipelineTicker(run) {
    if (typeof setInterval !== 'function') return null;
    return setInterval(() => {
        const elapsed = document.querySelector('#lesson-pipeline-bar [data-pipeline-elapsed]');
        if (elapsed) elapsed.textContent = formatElapsed(Date.now() - run.startedAt);
    }, PIPELINE_TICK_MS);
}

/* ---------- 실행 ---------- */
// kind: 'all'(빈 항목을 채우는 전체 생성) | 'job'(사용자가 고른 작업 하나)
// alerts: 작업 안의 탭 생성이 미리보기와 완료 알림을 띄울지. 전체 생성은 끝에 한 번만 알린다
window.beginLessonPipeline = function (moduleId, { kind = 'all', label = LESSON_TABS[0].label, current = LESSON_TABS[0].id, alerts = false } = {}) {
    _pipeline = { moduleId, subjectId: currentSubjectId, kind, stopped: false, moved: false, halted: false, current, label, status: '', done: 0, total: 0, failed: [], partial: [], short: [], skipped: [], startedAt: Date.now(), ticker: null, ownsImageRun: !!window.beginImageRun?.(), imageNote: '' };
    _suppressTabAlert = !alerts;
    _tabGenStop = false;
    window.resetTabGenStop?.(); // 새 끊기 신호(tabs.js). 캐시에 옛 tabs.js가 남아 있어도 위 줄이 중지를 푼다
    refreshPipelineView(_pipeline);
    _pipeline.ticker = startPipelineTicker(_pipeline);
};

window.lessonPipelineKind = () => _pipeline?.kind || null;

// 작업이 단계를 넘어갈 때 막대와 탐색줄 표시를 고친다
window.updateLessonJob = function (step) {
    if (!_pipeline) return;
    Object.assign(_pipeline, { status: '' }, step);
    refreshPipelineView(_pipeline);
};

// short: 기본 학습이 낭독 목표에 못 미친 항목 / halted: 한도·키 문제로 남은 항목을 만들지 않고 멈췄다
function pipelineSummary(run) {
    const short = run.short || [];
    const problems = [
        run.moved ? '다른 교과로 옮기거나 차시가 없어져 전체 생성을 멈췄습니다.' : '',
        run.failed.length ? `만들지 못한 항목:\n${run.failed.join('\n')}` : '',
        run.halted ? '같은 까닭으로 남은 항목은 만들지 않았습니다.' : '',
        run.skipped.length ? `교안 탭이 모두 있어야 해서 건너뛴 항목: ${run.skipped.join(', ')}` : '',
        run.partial.length ? `일부 내용이 빠졌을 수 있는 항목: ${run.partial.join(', ')}` : '',
        short.length ? `목표 분량에 못 미친 항목: ${short.join(', ')}. 그 탭 위 '분량 채우기'로 늘릴 수 있습니다.` : ''
    ].filter(Boolean);
    const onlyShort = short.length && !run.moved && !run.failed.length && !run.skipped.length && !run.partial.length;
    const retry = run.moved || run.failed.length || run.skipped.length ? '이 차시에서 전체 생성을 다시 누르면 빠진 항목만 만듭니다.' : onlyShort ? '' : '내용이 빠진 탭은 해당 탭에서 다시 생성해주세요.';
    if (problems.length) return { alert: [...problems, run.imageNote, retry].filter(Boolean).join('\n\n') };
    // 그림 모델이 막혀 그림 자리를 남겼으면 창으로 알린다. 작업 하나(job)는 부른 쪽이 끝을 따로 알리므로 안내만 보인다
    if (run.imageNote) {
        const head = run.kind === 'all' ? (run.stopped ? '전체 생성을 중지했습니다. 만든 내용은 저장했습니다.' : '전체 생성을 마쳤습니다.') : '';
        return { alert: [head, run.imageNote].filter(Boolean).join('\n\n') };
    }
    return run.stopped ? { toast: '전체 생성을 중지했습니다. 만든 내용은 저장했습니다.', kind: 'warning' } : { toast: '전체 생성을 마쳤습니다.', kind: 'success' };
}

// 기다리던 빈 탭의 안내가 남지 않게 한다. 내용을 읽거나 항목을 고치는 화면은 두고 탐색줄만 고친다.
// 원문 칸에 쓰던 글을 먼저 넣는다(빈 탭을 손으로 쓰던 중이면 그 글이 탭에 들어가 다시 그리지 않고, 쓰던 칸도 그대로 둔다)
function refreshFinishedLesson(mod) {
    window.saveRawContent?.();
    const waiting = String(currentEditingModuleId) === String(mod.id) && !_lessonPanel && !getActiveTabContent(mod);
    if (waiting) renderEditor(mod);
    else window.refreshLessonNav?.(mod);
}

// quiet: 부른 쪽이 이미 결과를 알렸거나, 여러 차시를 이어서 만드는 중이라 차시마다 알리지 않는다. 실패는 그래도 알린다
window.finishLessonPipeline = function ({ quiet = false } = {}) {
    const run = _pipeline;
    if (!run) return;
    _pipeline = null;
    if (run.ticker) clearInterval(run.ticker);
    if (run.ownsImageRun) { // 이 작업이 연 그림 작업 기록: 남긴 자리 안내를 받고 닫는다(api.js)
        run.imageNote = window.imageRunNote?.() || '';
        window.endImageRun?.();
    }
    _suppressTabAlert = false;
    document.getElementById('lesson-pipeline-bar')?.remove();
    const mod = getEditingModule(run.moduleId);
    if (mod) refreshFinishedLesson(mod);
    renderSidebar();
    const { alert, toast, kind } = pipelineSummary(run);
    if (alert) window.showAlert(alert);
    else if (!quiet) window.showToast?.(toast, kind);
};

// continuing: 교안 전체 생성이 기본 학습을 만든 뒤 이어서 부를 때 / lockedByTab: 재생성 전에 챙겨 둔 고정 섹션
// quiet: 끝나도 성공 알림을 띄우지 않는다 / shortNote: 이어서 부르기 전에 만든 기본 학습이 낭독 목표에 못 미쳤으면 끝 알림에 적을 항목
window.runLessonPipeline = async function (moduleId, { lockedByTab = {}, continuing = false, quiet = false, shortNote = '' } = {}) {
    if (_pipeline && !continuing) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    if (!continuing) window.beginLessonPipeline(moduleId);
    const run = _pipeline;
    if (!run.short) run.short = [];
    if (shortNote) run.short.push(shortNote);
    const steps = pipelineSteps(moduleId, lockedByTab);
    run.total = steps.length;
    try {
        if (String(currentEditingModuleId) === String(moduleId)) renderEditor(getEditingModule(moduleId));
        for (let i = 0; i < steps.length; i++) {
            const mod = currentSubjectId === run.subjectId ? getEditingModule(moduleId) : null;
            run.moved = !mod && !run.stopped;
            if (!mod || run.stopped) break;
            if (!steps[i].needed(mod)) continue;
            if (steps[i].afterTabs && lessonMissingTabs(mod).length) {
                run.skipped.push(steps[i].label);
                continue;
            }
            Object.assign(run, { current: steps[i].id, label: steps[i].label, status: '', done: i });
            refreshPipelineView(run);
            const result = await runPipelineStep(steps[i]);
            if (!result.ok && !result.stopped) run.failed.push(`${steps[i].label}: ${result.error}`);
            if (result.partial) run.partial.push(steps[i].label);
            if (result.short) run.short.push(`${steps[i].label}(낭독 약 ${result.readMinutes}분/목표 ${result.targetMinutes}분)`);
            // 하루 한도·키·연결 문제는 남은 항목도 같은 까닭으로 실패하므로 멈춘다. 기본 학습은 저장했지만 분량 채우기가 멈춘 경우도 알린다
            if (result.halt) {
                if (result.ok) run.failed.push(`${steps[i].label} 분량 채우기: ${result.error}`);
                run.halted = true;
                break;
            }
            if (!run.stopped) await new Promise(resolve => setTimeout(resolve, PIPELINE_COOLDOWN_MS));
        }
    } finally {
        window.finishLessonPipeline({ quiet });
    }
};

/* ---------- 작업 하나 ---------- */
// 고른 작업 하나를 화면을 막지 않고 돌린다. 전체 생성과 같은 진행 막대·중지를 쓰고, 한 번에 하나만 돈다
// task(run)의 결과를 돌려준다. 다른 생성이 돌고 있으면 { busy: true }
window.runLessonJob = async function (moduleId, { label, current = null, total = 1, alerts = false }, task) {
    if (_pipeline) {
        window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
        return { ok: false, busy: true };
    }
    window.beginLessonPipeline(moduleId, { kind: 'job', label, current, alerts });
    _pipeline.total = total;
    refreshPipelineView(_pipeline);
    try {
        return await task(_pipeline);
    } finally {
        window.finishLessonPipeline({ quiet: true });
    }
};

// 차시의 학습 탭(기본학습·심화학습) 만들기는 초안 뒤 낭독 목표 분량까지 섹션마다 나눠 채운다(긴 호출이 20번 넘게 들고 20분 넘게 걸린다).
// 시작 전에 호출 수·시간을 보이고 묻는다(cost-estimate.js). 다른 탭과 최종 평가는 묻지 않는다(true)
async function confirmLearnJob(mod, tabId) {
    if (!fillsLearnVolume(mod, tabId) || typeof confirmWithEstimate !== 'function' || typeof lessonWork !== 'function') return true;
    if (window.isLessonPipelineRunning?.()) return true; // 다른 생성이 돌면 runLessonJob이 알리고 멈춘다
    const label = LESSON_TABS.find(item => item.id === tabId)?.label || '학습';
    const target = lessonVolumeMinutes(mod, tabId);
    const existing = !!String(storedTabMarkdown(mod, tabId) || '').trim();
    const message = [
        `«${label}» 탭을 ${existing ? '다시 ' : ''}만듭니다. 초안을 받은 뒤 강사가 소리 내어 읽어도 ${target}분이 걸리는 분량까지 섹션마다 나눠 채우느라 20분 넘게 걸릴 수 있습니다.`,
        existing ? '끝나면 바뀐 섹션을 골라 반영하고, 지금 글은 작업 기록에 남습니다.' : '',
        '오른쪽 아래 진행 막대에서 언제든 멈출 수 있습니다.'
    ].filter(Boolean).join(' ');
    const work = lessonWork({ tabs: [tabId], volumeMinutes: target }, currentEstimateSettings().imageAmount, 0);
    return confirmWithEstimate(message, work, { title: `${label} 만들기`, okLabel: '만들기' });
}

// 탭 하나를 만들거나 다시 만든다. 다시 만들면 끝날 때 바뀐 섹션을 골라 반영한다. 차시의 학습 탭(기본학습·심화학습)은 먼저 호출 수·시간을 보이고 묻는다
window.runTabJob = async function (moduleId, tabId) {
    const tab = LESSON_TABS.find(item => item.id === tabId);
    const mod = getEditingModule(moduleId);
    if (!(await confirmLearnJob(mod, tabId))) return { ok: false, cancelled: true };
    if (mod && getEditingModule(moduleId) !== mod) return { ok: false, cancelled: true }; // 묻는 동안 다른 교과·차시로 옮겼다
    return window.runLessonJob(moduleId, { label: `${tab?.label || '탭'} 만들기`, current: tabId, alerts: true },
        () => generateTabContent(moduleId, tabId, { background: true, onStatus: window.setPipelineStatus }));
};

let _titleBeforeNotice = null;

// 작업이 끝나면 알린다. 다른 창을 보고 있었으면 브라우저 탭 제목에도 표시해 돌아왔을 때 알 수 있게 한다
window.notifyLessonJobDone = function (message, kind = 'success') {
    window.showToast?.(message, kind);
    if (!document.hidden || _titleBeforeNotice !== null) return;
    _titleBeforeNotice = document.title;
    document.title = `✓ 작업 완료 · ${_titleBeforeNotice}`;
    const restore = () => {
        if (document.hidden) return;
        document.title = _titleBeforeNotice;
        _titleBeforeNotice = null;
        document.removeEventListener('visibilitychange', restore);
    };
    document.addEventListener('visibilitychange', restore);
};

// 탐색줄의 전체 생성 버튼. 빈 항목이 없으면 다시 만들지 묻는다
window.startLessonGeneration = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return;
    if (_pipeline) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    const needed = pipelineSteps(moduleId, {}).filter(step => step.needed(mod));
    if (needed.length) {
        // 빈 항목을 차례로 만들기 전에 호출 수·시간·비용 수준을 먼저 보인다(cost-estimate.js)
        const has = id => needed.some(step => step.id === id);
        const work = lessonWork({
            tabs: needed.filter(step => LESSON_TABS.some(tab => tab.id === step.id)).map(step => step.id), // 탭마다 그림 자리 수가 달라 탭 id로 센다
            gyosuan: needed.filter(step => step.gyosuan).length, // 갈래마다 교수안을 하나씩 만든다
            qbank: has('qbank') ? qbankFillCount(mod) : 0, art: has('art'), ncs: has('ncsElements'), fillsVolume: moduleId !== 'mainQuest', volumeMinutes: lessonVolumeMinutes(mod),
            practiceMinutes: lessonPracticeWork(mod) // 실습 시간을 정한 실습 탭은 이어쓰기 호출이 늘어난다
        }, currentEstimateSettings().imageAmount);
        return confirmWithEstimate(`빈 항목 ${needed.length}개(${needed.map(step => step.label).join(', ')})를 차례로 만듭니다.`, work, { title: '전체 생성', okLabel: '만들기' })
            .then(ok => ok && window.runLessonPipeline(moduleId));
    }
    const rebuild = lessonWork({ tabs: LESSON_TABS.map(tab => tab.id), fillsVolume: moduleId !== 'mainQuest', volumeMinutes: lessonVolumeMinutes(mod), practiceMinutes: lessonPracticeWork(mod) }, currentEstimateSettings().imageAmount); // 최종 평가는 분량을 채우지 않는다
    return confirmWithEstimate(`모든 항목이 있습니다. 교안 탭 ${LESSON_TABS.length}개를 모두 다시 만듭니다(지금 글은 작업 기록에 남습니다).`, rebuild, { title: '모두 다시 만들기', okLabel: '모두 다시 만들기' })
        .then(ok => ok && generateAllTabs(moduleId));
};

// 도구 메뉴는 바깥을 누르면 닫는다
document.addEventListener?.('click', event => {
    const menu = document.getElementById('lesson-tools-menu');
    if (menu?.open && !menu.contains(event.target)) menu.open = false;
});
