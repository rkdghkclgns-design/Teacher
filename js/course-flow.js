// course-flow.js - 교과를 추가한 뒤의 흐름: 남은 차시 일괄 생성, 블록 다시 설계, 교수안·편성안 묶음
// 흐름은 develocket-slide(assets/course-ai.js generateUnit·generateCourse, course-ui.js replan-unit @3a7303f)를 따른다.
// 생성은 원본 대신 Teacher의 탭 생성을 그대로 쓰며, 저장은 탭마다 일어나므로 멈춰도 만든 내용은 남는다.

const LESSON_RETRY_WAIT_SECONDS = 30; // 호출 한도는 분 단위로 풀리므로 바로 재시도하면 같은 오류가 난다

let _lessonRun = null;
let _replanRun = 0;

/* ---------- 일괄 생성 대기열 ---------- */
// 업로드한 MD는 탭 생성이 읽지 않으므로 그 차시는 대기열에서 빼고 안내한다 (차시 카드의 '교안 생성'이 읽는다)
// withGyosuan: 탭이 다 찼어도 교수안이 없는 차시를 넣는다
function pendingLessons(subjects, withGyosuan = false) {
    return subjects.flatMap(subject => (subject.lessons || [])
        .filter(lesson => lesson.id !== 'mainQuest' && (lessonMissingTabs(lesson).length || (withGyosuan && lessonNeedsGyosuan(lesson))))
        .map(lesson => ({ subject, lessonId: lesson.id, title: lesson.title, uploaded: !!lesson.uploadedMdContent })));
}

const lessonNeedsGyosuan = lesson => !lesson.gyosuan?.docMd;
const runnableLessons = (subjects, withGyosuan = false) => pendingLessons(subjects, withGyosuan).filter(item => !item.uploaded);

async function attemptSafely(attempt, item, tryNumber) {
    try {
        return await attempt(item, tryNumber);
    } catch (err) {
        console.error('[일괄 생성] 차시 실패:', item.title, err);
        return { ok: false, error: err?.message || String(err) };
    }
}

async function waitBeforeRetry(isStopped) {
    for (let i = 0; i < LESSON_RETRY_WAIT_SECONDS && !isStopped(); i++) await new Promise(r => setTimeout(r, 1000));
}

// 실패하면 잠시 뒤 한 번 더 시도한다. 재시도는 빈 탭만 채우므로 먼저 성공한 탭은 다시 만들지 않는다
async function generateLesson(item, attempt, isStopped, onRetry) {
    const first = await attemptSafely(attempt, item, 1);
    if (first.ok || first.stopped || isStopped()) return first;
    onRetry(item, first.error);
    await waitBeforeRetry(isStopped);
    if (isStopped()) return first;
    const second = await attemptSafely(attempt, item, 2);
    return { ...second, partial: !!(first.partial || second.partial) };
}

function recordLessonResult(report, item, result) {
    const partial = result.partial ? [...report.partial, item] : report.partial;
    if (result.ok) return { ...report, partial, done: [...report.done, item] };
    return { ...report, partial, failed: [...report.failed, { ...item, error: result.error || '원인을 알 수 없습니다.' }] };
}

// 차시를 차례로 생성하고 결과를 모은다. 실패한 차시는 건너뛰고 계속하며, 중지는 차시와 탭 사이에서 받는다
async function runLessonQueue(queue, attempt, { isStopped = () => false, onLesson = () => {}, onRetry = () => {} } = {}) {
    let report = { done: [], partial: [], failed: [], left: [], stopped: false };
    for (let i = 0; i < queue.length; i++) {
        if (isStopped()) return { ...report, stopped: true, left: queue.slice(i) };
        onLesson(queue[i], i, queue.length);
        const result = await generateLesson(queue[i], attempt, isStopped, onRetry);
        if (result.stopped || (!result.ok && isStopped())) {
            const partial = result.partial ? [...report.partial, queue[i]] : report.partial;
            return { ...report, partial, stopped: true, left: queue.slice(i) };
        }
        report = recordLessonResult(report, queue[i], result);
    }
    return report;
}

// 프롬프트의 참고 자료와 커리큘럼은 현재 교과를 읽으므로 차시마다 그 교과로 옮겨 간다
async function attemptLesson(item, run) {
    if (currentSubjectId !== item.subject.id) openEditor(item.subject.id);
    if (!getEditingModule(item.lessonId)) return { ok: false, error: '차시를 찾지 못했습니다. 삭제되었는지 확인해주세요.' };
    window.viewModule(item.lessonId);
    const tabs = await fillMissingTabs(item.lessonId, {
        isStopped: () => run.stopped,
        onTab: (tab, index, total) => setLessonRunStatus(`${tab.label} (${index + 1}/${total})`),
        onStatus: setLessonRunStatus
    });
    if (!tabs.ok || !run.withGyosuan || !lessonNeedsGyosuan(getEditingModule(item.lessonId))) return tabs;
    if (run.stopped) return { ...tabs, ok: false, stopped: true };
    const gyosuan = await runGyosuanGeneration(item.lessonId, { onStatus: setLessonRunStatus });
    return { ok: gyosuan.ok, stopped: gyosuan.stopped, error: gyosuan.error, partial: !!(tabs.partial || gyosuan.partial) };
}

/* ---------- 일괄 생성 화면 ---------- */
const lessonLabel = item => `${item.subject.title} · ${item.title}`;

function runSubjects(scope) {
    return scope === 'course' ? globalState.subjects : globalState.subjects.filter(subject => subject.id === currentSubjectId);
}

// 전체 탭 생성은 탭 사이에 로딩 화면을 내리므로 _suppressTabAlert도 함께 본다
function generationBusy() {
    return _suppressTabAlert || document.getElementById('editor-loading')?.style.display === 'flex';
}

function lessonRunListHtml(title, items, detail = () => '') {
    if (!items.length) return '';
    const rows = items.map(item => `<li>${escapeHtml(lessonLabel(item))}${detail(item) ? ` <span class="text-textMuted">— ${escapeHtml(detail(item))}</span>` : ''}</li>`).join('');
    return `<div><p class="text-[0.65rem] font-bold text-textMuted mb-1">${title} ${items.length}개</p><ul class="list-disc pl-4 space-y-0.5 text-[0.7rem] text-textLight max-h-32 overflow-y-auto">${rows}</ul></div>`;
}

function lessonRunQueueHtml(queue, uploaded) {
    return `
        ${lessonRunListHtml('생성할 차시', queue) || '<p class="text-[0.65rem] text-textMuted">생성할 차시가 없습니다.</p>'}
        ${uploaded.length ? `<p class="text-[0.65rem] text-amber-400">업로드한 MD가 있는 차시 ${uploaded.length}개는 제외합니다. 업로드 파일을 반영하려면 차시 카드의 교안 생성을 눌러주세요.</p>` : ''}`;
}

function lessonRunIntroHtml(queue, uploaded, withGyosuan = false) {
    return `
        <p class="text-xs text-textLight">내용이 비어 있는 탭만 차례로 생성합니다. 이미 있는 탭은 그대로 둡니다. 차시마다 몇 분 걸릴 수 있습니다.</p>
        <div id="lesson-run-queue" class="space-y-2">${lessonRunQueueHtml(queue, uploaded)}</div>
        <label class="flex items-start gap-2 text-xs text-textLight">
            <input id="lesson-run-gyosuan" type="checkbox" ${withGyosuan ? 'checked' : ''}>
            <span>교수안과 슬라이드 편성안도 만들기<span class="block text-[0.6rem] text-textMuted">교수안이 없는 차시만 만듭니다. 차시마다 호출이 늘고, 슬라이드 자동 이미지를 켜 두면 이미지 비용도 듭니다.</span></span>
        </label>
        ${lessonGenFieldsHtml('run', globalState.courseDesign?.genOptions)}
        <p class="text-[0.6rem] text-textMuted">생성 옵션은 과정 기본값으로 저장됩니다. 차시 정보에서 따로 정한 값이 있으면 그 값을 씁니다.</p>`;
}

function lessonRunProgressHtml(item, index, total) {
    const percent = Math.round(index / total * 100);
    return `
        <p class="text-xs font-bold text-textLight">${index + 1}/${total} · ${escapeHtml(lessonLabel(item))}</p>
        <div class="h-1.5 rounded bg-white/10 overflow-hidden"><div class="h-full bg-accent" style="width:${percent}%"></div></div>
        <p id="lesson-run-status" class="text-[0.65rem] text-accent min-h-[1em]"></p>`;
}

function lessonRunReportHtml(report) {
    const counts = [`완료 ${report.done.length}개`, `실패 ${report.failed.length}개`, report.left.length ? `남은 ${report.left.length}개` : ''].filter(Boolean).join(' · ');
    const unfinished = report.failed.length || report.left.length;
    return `
        <p class="text-xs font-bold text-textLight">${report.stopped ? '중지했습니다' : '일괄 생성을 마쳤습니다'} · ${counts}</p>
        ${lessonRunListHtml('실패해서 건너뛴 차시', report.failed, item => item.error)}
        ${lessonRunListHtml('일부 단락이 누락되었을 수 있는 차시', report.partial)}
        ${unfinished ? '<p class="text-[0.65rem] text-textMuted">만든 내용은 저장했습니다. 다시 실행하면 남은 탭부터 이어서 생성합니다.</p>' : ''}`;
}

function setLessonRunBody(html) {
    const body = document.getElementById('lesson-run-body');
    if (body) body.innerHTML = html;
}

function setLessonRunStatus(text) {
    const status = document.getElementById('lesson-run-status');
    if (status) status.textContent = text;
}

function setLessonRunButtons(html) {
    const footer = document.getElementById('lesson-run-footer');
    if (footer) footer.innerHTML = html;
}

const RUN_BUTTONS = {
    start: scope => `
        <button data-run-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
        <button data-run-action="start" data-scope="${scope}" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">생성 시작</button>`,
    stop: '<button data-run-action="stop" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">중지</button>',
    close: '<button data-run-action="close" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">닫기</button>'
};

window.openLessonRun = function (scope) {
    if (_lessonRun || document.getElementById('lesson-run-dialog')) return;
    if (!textModelHasKey()) return window.showAlert('교안 생성에는 AI 키가 필요합니다. 설정에서 키를 입력해주세요.');
    if (generationBusy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    if (!runnableLessons(runSubjects(scope), true).length) return window.showToast?.('생성할 차시가 없습니다. 모든 차시에 내용과 교수안이 있습니다.', 'success');
    const withGyosuan = !!globalState.courseDesign?.runGyosuan || !runnableLessons(runSubjects(scope)).length; // 탭이 다 찼으면 교수안만 남은 것이다
    const pending = pendingLessons(runSubjects(scope), withGyosuan);
    const overlay = document.createElement('div');
    overlay.id = 'lesson-run-dialog';
    overlay.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[520px] max-w-[94vw] max-h-[80vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10"><h2 class="text-sm font-bold text-textLight">남은 차시 생성 · ${scope === 'course' ? '과정 전체' : '이 교과'}</h2></div>
            <div id="lesson-run-body" class="flex-1 overflow-y-auto p-4 space-y-3">${lessonRunIntroHtml(pending.filter(item => !item.uploaded), pending.filter(item => item.uploaded), withGyosuan)}</div>
            <div id="lesson-run-footer" class="p-3 border-t border-white/10 flex justify-end gap-2">${RUN_BUTTONS.start(scope)}</div>
        </div>`;
    overlay.addEventListener('click', onLessonRunClick);
    overlay.addEventListener('change', event => onLessonRunChange(event, scope));
    document.body.appendChild(overlay);
};

function onLessonRunChange(event, scope) {
    if (event.target.id !== 'lesson-run-gyosuan') return;
    const pending = pendingLessons(runSubjects(scope), event.target.checked);
    const queue = pending.filter(item => !item.uploaded);
    document.getElementById('lesson-run-queue').innerHTML = lessonRunQueueHtml(queue, pending.filter(item => item.uploaded));
    document.querySelector('[data-run-action="start"]').disabled = !queue.length;
}

function onLessonRunClick(event) {
    const action = event.target.dataset?.runAction;
    if (action === 'close') document.getElementById('lesson-run-dialog')?.remove();
    if (action === 'start') startLessonRun(event.target.dataset.scope);
    if (action === 'stop' && _lessonRun) {
        _lessonRun.stopped = true; // 진행 중인 실행이 같은 객체를 읽는다
        window.requestTabGenerationStop?.();
        event.target.disabled = true;
        event.target.textContent = '받고 있는 단락까지만 저장합니다';
    }
}

// 화면 갱신이 실패해도 닫기 버튼은 나오도록 정리는 finally에서 한다
async function startLessonRun(scope) {
    const withGyosuan = !!document.getElementById('lesson-run-gyosuan')?.checked;
    saveCourseDesignField({ genOptions: readLessonGenFields('run'), runGyosuan: withGyosuan });
    const run = { stopped: false, withGyosuan };
    _lessonRun = run;
    setLessonRunButtons(RUN_BUTTONS.stop);
    try {
        const report = await runLessonQueue(runnableLessons(runSubjects(scope), withGyosuan), item => attemptLesson(item, run), {
            isStopped: () => run.stopped,
            onLesson: (item, index, total) => setLessonRunBody(lessonRunProgressHtml(item, index, total)),
            onRetry: (item, error) => setLessonRunStatus(`${LESSON_RETRY_WAIT_SECONDS}초 뒤 다시 시도합니다... (${error})`)
        });
        setLessonRunBody(lessonRunReportHtml(report));
        await saveState();
        renderSidebar();
        renderOverviewLNB();
    } catch (err) {
        console.error('[일괄 생성] 실패:', err);
        setLessonRunBody(`<p class="text-xs text-rose-300">일괄 생성 중 오류가 발생했습니다: ${escapeHtml(err.message)}</p>`);
    } finally {
        _lessonRun = null;
        setLessonRunButtons(RUN_BUTTONS.close);
    }
}

/* ---------- 블록 다시 설계 ---------- */
function lessonHasContent(lesson) {
    return LESSON_TABS.some(tab => lesson.tabContents?.[tab.id]) || !!lesson.content || !!lesson.gyosuan?.docMd || !!lesson.uploadedMdContent;
}

function subjectPlanHours(subject) {
    return Math.max(1, Math.round(subjectMinutes(subject) / 60) || Number(subject.hours) || 1);
}

async function planSubjectBlocks(subject, hours) {
    const saved = globalState.courseDesign || {};
    const design = { title: saved.title || globalState.courseTitle, goal: saved.goal || '', target: saved.target || '직업훈련 수강생' };
    const unit = { title: subject.title, hours, modules: [] };
    return parseUnitPlan(await askDesignJson(buildUnitPrompt(design, unit)), unit);
}

// 새 블록을 받은 뒤에만 바꾼다. 이전 차시는 휴지통과 보관함에 남겨 되살릴 수 있다
async function replaceSubjectLessons(subject, modules, hours) {
    const previous = (subject.lessons || []).filter(lesson => lesson.id !== 'mainQuest');
    const quests = (subject.lessons || []).filter(lesson => lesson.id === 'mainQuest');
    for (const lesson of previous.filter(item => item.content)) await archiveContent(lesson);
    moveLessonsToTrash(previous, subject.id);
    const firstId = Date.now();
    const lessons = [...quests, ...modules.map((module, i) => moduleToLesson(module, firstId + i))];
    Object.assign(subject, { lessons, lessonCount: modules.length, hours });
    if (subject.id === currentSubjectId) courseData = lessons;
    await saveState();
    return previous.length;
}

function replanNoticeHtml(subject) {
    const lessons = subject.lessons || [];
    const filled = lessons.filter(lessonHasContent);
    if (!lessons.length) return '<p class="text-xs text-textLight">아직 차시가 없습니다. AI가 설계한 블록으로 차시를 만듭니다.</p>';
    const titles = filled.map(lesson => `<li>${escapeHtml(lesson.title)}</li>`).join('');
    return `
        <p class="text-xs text-textLight">이 교과의 차시 ${lessons.length}개를 새 블록으로 바꿉니다. 지금 차시는 휴지통으로 옮겨 되살릴 수 있습니다.</p>
        ${filled.length ? `<div class="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30"><p class="text-xs font-bold text-amber-300 mb-1">내용이 있는 차시 ${filled.length}개도 함께 옮겨집니다.</p><ul class="list-disc pl-4 text-[0.7rem] text-textLight max-h-28 overflow-y-auto">${titles}</ul></div>` : ''}`;
}

window.openSubjectReplan = function () {
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    if (!subject || document.getElementById('replan-dialog')) return;
    if (!textModelHasKey()) return window.showAlert('블록 다시 설계에는 AI 키가 필요합니다. 설정에서 키를 입력해주세요.');
    if (generationBusy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    const filled = (subject.lessons || []).some(lessonHasContent);
    const overlay = document.createElement('div');
    overlay.id = 'replan-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[480px] max-w-[94vw] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10"><h2 class="text-sm font-bold text-textLight">블록 다시 설계 · ${escapeHtml(subject.title)}</h2></div>
            <div class="p-4 space-y-3">
                ${replanNoticeHtml(subject)}
                <label class="block text-[0.65rem] font-bold text-textMuted">교과 시간
                    <input id="replan-hours" type="number" min="1" value="${subjectPlanHours(subject)}" class="block w-24 mt-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white">
                </label>
                <p id="replan-status" class="text-[0.65rem] text-accent min-h-[1em]"></p>
            </div>
            <div class="p-3 border-t border-white/10 flex justify-end gap-2">
                <button data-replan-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
                <button data-replan-action="start" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">${filled ? '휴지통으로 옮기고 다시 설계' : '다시 설계'}</button>
            </div>
        </div>`;
    overlay.addEventListener('click', event => onReplanClick(event, subject));
    document.body.appendChild(overlay);
};

function closeSubjectReplan() {
    _replanRun += 1; // 닫으면 늦게 온 응답을 버린다
    document.getElementById('replan-dialog')?.remove();
}

function onReplanClick(event, subject) {
    const action = event.target.dataset?.replanAction;
    if (action === 'close') closeSubjectReplan();
    if (action === 'start') runSubjectReplan(event.target, subject);
}

async function runSubjectReplan(button, subject) {
    const hours = Math.max(1, Math.round(Number(document.getElementById('replan-hours').value)) || 1);
    const status = document.getElementById('replan-status');
    const run = ++_replanRun;
    button.disabled = true;
    status.textContent = '블록을 설계하고 있습니다...';
    try {
        const planned = await planSubjectBlocks(subject, hours);
        if (run !== _replanRun) return;
        const moved = await replaceSubjectLessons(subject, planned.modules, hours);
        closeSubjectReplan();
        if (subject.id === currentSubjectId) openEditor(subject.id);
        renderOverviewLNB();
        window.showToast?.(`새 블록 ${planned.modules.length}개로 바꿨습니다.${moved ? ` 이전 차시 ${moved}개는 휴지통에 있습니다.` : ''}`, 'success');
    } catch (err) {
        console.error('[블록 다시 설계] 실패:', err);
        if (run !== _replanRun) return;
        status.textContent = `설계 실패: ${err.message} 지금 차시는 그대로입니다.`;
        button.disabled = false;
    }
}

/* ---------- 교수안·편성안 묶음 ---------- */
const stripFrontmatter = md => String(md || '').replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '').trim();

// ZIP에 넣을 차시의 교수안·편성안 파일
function lessonGyosuanFiles(mod) {
    const { docMd, deckMd } = mod?.gyosuan || {};
    return [
        ...(docMd ? [{ name: '06_교수안.md', content: docMd }] : []),
        ...(deckMd ? [{ name: '07_슬라이드편성안.md', content: deckMd }] : [])
    ];
}

// 이미지 data URL을 ZIP용 확장자와 base64 본문으로 나눈다. svg+xml도 읽고, base64가 아니면 본문이 비어 건너뛰게 한다
function zipImageParts(dataUrl) {
    const [, ext = 'png', data = ''] = String(dataUrl).match(/^data:image\/(\w+)[^;,]*;base64,(.*)$/s) || [];
    return { ext, data };
}

function subjectBundleMd(subject) {
    const lessons = (subject.lessons || []).filter(lesson => lesson.id !== 'mainQuest');
    const ready = lessons.filter(lesson => lesson.gyosuan?.docMd || lesson.gyosuan?.deckMd);
    if (!ready.length) return '';
    const missing = lessons.filter(lesson => !ready.includes(lesson));
    const parts = ready.flatMap(lesson => [lesson.gyosuan.docMd, lesson.gyosuan.deckMd].filter(Boolean).map(stripFrontmatter));
    return [
        `# 교수안·슬라이드 편성안 모음 - ${subject.title}`, '',
        '## 차시', '', ...ready.map((lesson, i) => `${i + 1}. ${lesson.title}`), '',
        ...(missing.length ? ['## 교수안이 아직 없는 차시', '', ...missing.map(lesson => `- ${lesson.title}`), ''] : []),
        ...parts.flatMap(part => ['---', '', part, ''])
    ].join('\n');
}

window.downloadSubjectBundle = function () {
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    const md = subject && subjectBundleMd(subject);
    if (!md) return window.showAlert('이 교과에 교수안이 있는 차시가 없습니다. 먼저 교수안을 생성해주세요.');
    downloadMd(md, `${subject.title}_교수안_편성안_묶음`);
};

/* ---------- 교과 카드 ---------- */
function renderSubjectFlowCard(subject) {
    const button = 'text-[0.6rem] font-bold px-2 py-1 rounded bg-white/10 text-textLight hover:bg-accent transition-colors';
    return `
        <div class="mb-3 rounded-xl border border-white/10 bg-bgSidebar p-2.5">
            <div class="flex items-center gap-2 mb-1.5">
                <i class="ph-fill ph-stack text-accent"></i>
                <h3 class="text-[0.7rem] font-bold text-textLight tracking-wider">교과 일괄 작업</h3>
            </div>
            <div class="flex flex-wrap gap-1">
                <button onclick="openLessonRun('subject')" class="${button}" title="내용이 빈 탭만 차례로 생성">남은 차시 생성 ${runnableLessons([subject]).length}개</button>
                <button onclick="openSubjectBlocks()" class="${button}" title="차시 제목과 시간을 한눈에 보고 고침">차시 구성</button>
                <button onclick="openSubjectReplan()" class="${button}" title="AI로 이 교과의 차시를 새로 나눔">블록 다시 설계</button>
                <button onclick="downloadSubjectBundle()" class="${button}" title="모든 차시의 교수안과 슬라이드 편성안을 한 파일로 내려받기">교수안·편성안 묶음</button>
                <button onclick="openLessonBackfill()" class="${button}" title="예전에 만든 교과와 차시에 NCS와 삽화를 채움">기존 내용 보강</button>
            </div>
        </div>`;
}
