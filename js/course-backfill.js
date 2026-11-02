// course-backfill.js - 기존 내용 보강: 예전에 만든 교과와 차시에 NCS 자동 배정과 삽화를 채운다
// develocket-slide(assets/course-auto.js existingWork·applyExisting @3a7303f)를 따른다. 사용자가 확정한 항목은 건드리지 않는다.

const BACKFILL_ART_TAB = 'basicLearn';

let _backfillRun = null;

// 삽화는 한 번 돌린 차시를 다시 돌리지 않는다. 사용자가 일부러 지웠을 수 있다
const lessonNeedsArt = lesson => !!lesson.tabContents?.[BACKFILL_ART_TAB] && !lesson.artAutoDone && !(lesson.illustrations || []).length;
const lessonNeedsFill = (lesson, withArt) => needsElementAutoAssign(lesson) || (withArt && lessonNeedsArt(lesson));

function backfillWork(subjects, withArt) {
    return {
        units: subjects.filter(needsNcsAutoAssign),
        lessons: subjects.flatMap(subject => courseLessons(subject).filter(lesson => lessonNeedsFill(lesson, withArt)).map(lesson => ({ subject, lesson })))
    };
}

// 교안이 고른 섹션마다 삽화 하나를 그려 넣는다. 중지하면 그린 데까지만 남긴다
async function fillLessonArt(lesson, isStopped) {
    const tabId = BACKFILL_ART_TAB;
    const ideas = await suggestIllustrationIdeas(lesson, tabId);
    const form = { kind: ART_KINDS[0], ratio: ART_RATIOS[0].value, caption: '' };
    for (const idea of ideas) {
        if (isStopped()) return;
        const place = String(idea.section);
        const svg = await drawLessonSvg({ description: idea.description, kind: form.kind, ratio: form.ratio, context: placementContext(lesson, tabId, place) });
        const illustration = newIllustration(form, idea.description, svg);
        lesson.illustrations = [...(lesson.illustrations || []), illustration];
        await placeIllustration(lesson, illustration.id, tabId, place);
        setTabMarkdown(lesson, tabId, lesson.tabContents[tabId]);
        if (!courseArt().anchorSvg) setArtAnchor(illustration);
    }
    lesson.artAutoDone = true; // 끝까지 돌았을 때만 표시한다. 실패하거나 멈추면 다시 보강할 수 있다
}

async function fillSubjectNcs(subject) {
    subject.ncs = { units: [], recs: [], confirmed: false, ...(subject.ncs || {}), autoTried: true };
    await autoAssignNcs(subject, setBackfillStatus);
}

async function fillLesson(subject, lesson, run) {
    if (needsElementAutoAssign(lesson)) {
        setBackfillStatus('NCS 능력단위요소를 배정하고 있습니다...');
        await assignLessonElements(subject, lesson);
    }
    if (run.withArt && lessonNeedsArt(lesson) && !run.stopped) {
        setBackfillStatus('삽화를 그리고 있습니다...');
        await fillLessonArt(lesson, () => run.stopped);
    }
}

function backfillSteps({ units, lessons }, run) {
    return [
        ...units.map(subject => ({ label: `${subject.title} · NCS 능력단위`, task: () => fillSubjectNcs(subject) })),
        ...lessons.map(({ subject, lesson }) => ({ label: `${subject.title} · ${lesson.title}`, task: () => fillLesson(subject, lesson, run) }))
    ];
}

// 항목마다 저장하므로 중간에 멈추거나 실패해도 채운 내용은 남는다
async function runBackfillSteps(steps, run, onStep) {
    let report = { done: 0, failed: [], left: 0 };
    for (let i = 0; i < steps.length; i++) {
        if (run.stopped) return { ...report, left: steps.length - i };
        onStep(steps[i], i, steps.length);
        try {
            await steps[i].task();
            await saveState();
            report = { ...report, done: report.done + 1 };
        } catch (err) {
            console.error('[기존 내용 보강] 실패:', steps[i].label, err);
            report = { ...report, failed: [...report.failed, { label: steps[i].label, error: err?.message || String(err) }] };
        }
    }
    return report;
}

/* ---------- 대화상자 ---------- */
function setBackfillStatus(text) {
    const status = document.getElementById('backfill-status');
    if (status) status.textContent = text;
}

function setBackfillBody(html) {
    const body = document.getElementById('backfill-body');
    if (body) body.innerHTML = html;
}

function setBackfillFooter(html) {
    const footer = document.getElementById('backfill-footer');
    if (footer) footer.innerHTML = html;
}

const BACKFILL_BUTTONS = {
    start: `
        <button data-backfill-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
        <button data-backfill-action="start" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover disabled:opacity-50">보강 시작</button>`,
    stop: '<button data-backfill-action="stop" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">중지</button>',
    close: '<button data-backfill-action="close" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">닫기</button>'
};

function backfillCountHtml({ units, lessons }) {
    return units.length + lessons.length
        ? `<p class="text-xs text-textLight">교과 ${units.length}개, 차시 ${lessons.length}개를 보강합니다.</p>`
        : '<p class="text-xs text-textMuted">보강할 항목이 없습니다.</p>';
}

function backfillIntroHtml(work) {
    return `
        <p class="text-[0.65rem] text-textMuted">NCS를 아직 배정해 보지 않은 교과와 차시를 채웁니다. 자동 배정은 확정 전 상태로 들어가고, 확정한 항목은 건드리지 않습니다.</p>
        <div id="backfill-count">${backfillCountHtml(work)}</div>
        <label class="flex items-start gap-2 text-xs text-textLight">
            <input id="backfill-art" type="checkbox">
            <span>기본 학습에 삽화도 넣기<span class="block text-[0.6rem] text-textMuted">차시마다 삽화 후보 1회와 삽화 최대 ${ILLUSTRATION_MAX_IDEAS}장 호출이 늘어납니다.</span></span>
        </label>`;
}

function backfillReportHtml(report) {
    const rows = report.failed.map(item => `<li>${escapeHtml(item.label)} <span class="text-textMuted">— ${escapeHtml(item.error)}</span></li>`).join('');
    return `
        <p class="text-xs font-bold text-textLight">${report.left ? '중지했습니다' : '보강을 마쳤습니다'} · 완료 ${report.done}개 · 실패 ${report.failed.length}개${report.left ? ` · 남은 ${report.left}개` : ''}</p>
        ${rows ? `<ul class="list-disc pl-4 text-[0.7rem] text-textLight max-h-40 overflow-y-auto">${rows}</ul>` : ''}`;
}

function backfillProgressHtml(step, index, total) {
    return `
        <p class="text-xs font-bold text-textLight">${index + 1}/${total} · ${escapeHtml(step.label)}</p>
        <div class="h-1.5 rounded bg-white/10 overflow-hidden"><div class="h-full bg-accent" style="width:${Math.round(index / total * 100)}%"></div></div>
        <p id="backfill-status" class="text-[0.65rem] text-accent min-h-[1em]"></p>`;
}

function refreshBackfillCount() {
    const withArt = !!document.getElementById('backfill-art')?.checked;
    const work = backfillWork(globalState.subjects, withArt);
    document.getElementById('backfill-count').innerHTML = backfillCountHtml(work);
    document.querySelector('[data-backfill-action="start"]').disabled = !(work.units.length + work.lessons.length);
}

async function startBackfill() {
    const run = { stopped: false, withArt: !!document.getElementById('backfill-art')?.checked };
    _backfillRun = run;
    setBackfillFooter(BACKFILL_BUTTONS.stop);
    try {
        const steps = backfillSteps(backfillWork(globalState.subjects, run.withArt), run);
        const report = await runBackfillSteps(steps, run, (step, index, total) => setBackfillBody(backfillProgressHtml(step, index, total)));
        setBackfillBody(backfillReportHtml(report));
        renderSidebar();
        renderOverviewLNB();
    } catch (err) {
        console.error('[기존 내용 보강] 중단:', err);
        setBackfillBody(`<p class="text-xs text-rose-300">보강 중 오류가 발생했습니다: ${escapeHtml(err.message)}</p>`);
    } finally {
        _backfillRun = null;
        setBackfillFooter(BACKFILL_BUTTONS.close);
    }
}

function onBackfillClick(event) {
    const action = event.target.dataset?.backfillAction;
    if (action === 'close') document.getElementById('backfill-dialog')?.remove();
    if (action === 'start') startBackfill();
    if (action === 'stop' && _backfillRun) {
        _backfillRun.stopped = true; // 진행 중인 실행이 같은 객체를 읽는다
        event.target.disabled = true;
        event.target.textContent = '지금 항목을 마치면 멈춥니다';
    }
}

window.openLessonBackfill = async function () {
    if (_backfillRun || document.getElementById('backfill-dialog')) return;
    if (!textModelHasKey()) return window.showAlert('기존 내용 보강에는 AI 키가 필요합니다. 설정에서 키를 입력해주세요.');
    if (generationBusy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    try {
        await loadNcsCatalog();
    } catch (err) {
        return window.showAlert(err.message);
    }
    const overlay = document.createElement('div');
    overlay.id = 'backfill-dialog';
    overlay.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[480px] max-w-[94vw] max-h-[80vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10"><h2 class="text-sm font-bold text-textLight">기존 내용 보강 · 과정 전체</h2></div>
            <div id="backfill-body" class="flex-1 overflow-y-auto p-4 space-y-3">${backfillIntroHtml(backfillWork(globalState.subjects, false))}</div>
            <div id="backfill-footer" class="p-3 border-t border-white/10 flex justify-end gap-2">${BACKFILL_BUTTONS.start}</div>
        </div>`;
    overlay.addEventListener('click', onBackfillClick);
    overlay.addEventListener('change', refreshBackfillCount);
    document.body.appendChild(overlay);
    refreshBackfillCount();
};
