// course-flow.js - 교과를 추가한 뒤의 흐름: 남은 차시 일괄 생성, 블록 다시 설계, 교수안·편성안 묶음
// 흐름은 develocket-slide(assets/course-ai.js generateUnit·generateCourse, course-ui.js replan-unit @3a7303f)를 따른다.
// 생성은 원본 대신 Teacher의 탭 생성을 그대로 쓰며, 저장은 탭마다 일어나므로 멈춰도 만든 내용은 남는다.

const LESSON_RETRY_WAIT_SECONDS = 30; // 호출 한도는 분 단위로 풀리므로 바로 재시도하면 같은 오류가 난다

let _lessonRun = null;
let _replanRun = 0;

/* ---------- 일괄 생성 대기열 ---------- */
// 업로드한 MD는 탭 생성이 읽지 않으므로 그 차시는 대기열에서 빼고 안내한다 (차시 카드의 '교안 생성'이 읽는다)
// withGyosuan: 탭이 다 찼어도 갈래(기본학습·심화학습)의 교수안이나 문제은행이 빈 차시를 넣는다
// overwrite: 내용이 있어도 모두 다시 만든다
function pendingLessons(subjects, withGyosuan = false, overwrite = false) {
    return subjects.flatMap(subject => (subject.lessons || [])
        .filter(lesson => lesson.id !== 'mainQuest' && (overwrite || lessonMissingTabs(lesson).length || (withGyosuan && (gyosuanBuildCount(lesson) > 0 || lessonQuestionGaps(lesson) > 0))))
        .map(lesson => ({ subject, lessonId: lesson.id, title: lesson.title, uploaded: !!lesson.uploadedMdContent })));
}

// 그 갈래의 교수안을 만들어야 하는가: 교수안이 없고, 학습·실습 탭에 글이 있거나 이번에 그 탭을 만든다(빈 탭을 먼저 만든다, lesson-pipeline.js trackTabsMissing)
const lessonNeedsGyosuan = (lesson, trackId = 'basic') => !gyosuanOf(lesson, trackId)?.docMd && (trackHasContent(lesson, trackId) || trackTabsMissing(lesson, trackId));

// 만들 교수안 수(갈래마다 하나). 미리 보기와 일괄 생성 대기열이 센다
const gyosuanBuildCount = lesson => LESSON_TRACKS.filter(track => lessonNeedsGyosuan(lesson, track.id)).length;
const runnableLessons = (subjects, withGyosuan = false, overwrite = false) => pendingLessons(subjects, withGyosuan, overwrite).filter(item => !item.uploaded);

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

// 실패하면 잠시 뒤 한 번 더 시도한다. 재시도는 빈 탭만 채우므로 먼저 성공한 탭은 다시 만들지 않는다.
// 다시 보내도 같은 오류(noRetry: 키·모델·한도 0·하루 한도)와 일괄 생성을 멈출 오류(halt)는 다시 해 보지 않는다
async function generateLesson(item, attempt, isStopped, onRetry) {
    const first = await attemptSafely(attempt, item, 1);
    if (first.ok || first.stopped || first.halt || first.noRetry || isStopped()) return first;
    onRetry(item, first.error);
    await waitBeforeRetry(isStopped);
    if (isStopped()) return first;
    const second = await attemptSafely(attempt, item, 2);
    return { ...second, partial: !!(first.partial || second.partial), ...shortOfAttempts(first, second) };
}

// 두 시도에서 낭독 목표에 못 미친 학습 탭을 합친다. 첫 시도에서 만든 학습 탭이 짧았으면 다시 해도 그 탭은 그대로다(다시 시도는 빈 탭만 만든다)
function shortOfAttempts(first, second) {
    const short = second.short ? second : first.short ? first : null;
    if (!short) return {};
    const tabs = [...(first.shortTabs || []), ...(second.shortTabs || [])].filter((tab, i, all) => all.findIndex(other => other.tabId === tab.tabId) === i);
    return { short: true, readMinutes: short.readMinutes, ...(tabs.length ? { shortTabs: tabs } : {}) };
}

// 학습 탭(기본학습·심화학습)이 낭독 목표에 못 미친 차시는 따로 모은다(그 탭의 '분량 채우기'로 늘린다). shortTabs: 모자란 탭마다 { tabId, label, readMinutes }
const withShortLesson = (list, item, result) => (result.short ? [...(list || []), { ...item, readMinutes: result.readMinutes, ...(result.shortTabs ? { shortTabs: result.shortTabs } : {}) }] : list);

// 일괄 생성 보고에 보일 모자란 학습 탭과 낭독 시간
const shortLessonText = item => (item.shortTabs?.length ? item.shortTabs.map(tab => `${tab.label} 낭독 약 ${tab.readMinutes}분`).join(' · ') : `낭독 약 ${item.readMinutes}분`);

function recordLessonResult(report, item, result) {
    const partial = result.partial ? [...report.partial, item] : report.partial;
    const short = withShortLesson(report.short, item, result);
    const next = short ? { ...report, partial, short } : { ...report, partial };
    if (result.ok) return { ...next, done: [...report.done, item] };
    return { ...next, failed: [...report.failed, { ...item, error: result.error || '원인을 알 수 없습니다.' }] };
}

// 차시를 차례로 생성하고 결과를 모은다. 실패한 차시는 건너뛰고 계속하며, 중지는 차시와 탭 사이에서 받는다.
// 다음 차시도 같은 까닭으로 실패할 오류(halt: 하루 한도·한도 0·키·연결 문제, 다른 생성이 도는 중)면 그 차시를 실패로 적고 멈춘다(halted)
async function runLessonQueue(queue, attempt, { isStopped = () => false, onLesson = () => {}, onRetry = () => {} } = {}) {
    let report = { done: [], partial: [], failed: [], short: [], left: [], stopped: false };
    for (let i = 0; i < queue.length; i++) {
        if (isStopped()) return { ...report, stopped: true, left: queue.slice(i) };
        onLesson(queue[i], i, queue.length);
        const result = await generateLesson(queue[i], attempt, isStopped, onRetry);
        if (result.stopped || (!result.ok && isStopped())) {
            const partial = result.partial ? [...report.partial, queue[i]] : report.partial;
            return { ...report, partial, short: withShortLesson(report.short, queue[i], result), stopped: true, left: queue.slice(i) };
        }
        report = recordLessonResult(report, queue[i], result);
        if (!result.ok && result.halt) return { ...report, stopped: true, halted: true, left: queue.slice(i + 1) };
    }
    return report;
}

// 비울 것이 하나라도 있는 차시만 휴지통에 넣는다(아무것도 없는 차시의 빈 사본이 휴지통을 채우지 않게)
const lessonHasRewriteContent = lesson => lessonHasContent(lesson) || LESSON_TRACKS.some(track => !!lesson[track.field])
    || Object.keys(lesson.images || {}).length > 0 || (lesson.illustrations || []).length > 0;

// 덮어쓰기: 비우기 직전에 차시를 통째로 휴지통에 넣고(30일 동안 되살린다. 작업 기록 칸은 쓰지 않는다) 빈 탭을 채우는 같은 경로로 다시 만든다
// 사본은 옛 단일 본문을 탭으로 옮기기 전 모양 그대로다. 고정 섹션은 비우면 찾을 수 없으므로 먼저 챙겨 돌려준다.
// 교수안까지 다시 만들면 그림도 덜어 내되, 다시 넣을 고정 섹션의 그림과 남는 삽화·판서 영상이 쓰는 그림은 남긴다(카드의 다시 생성과 같은 규칙, tabs.js dropUnusedLessonImages).
// before: 비운 칸의 지우기 전 값(탭을 하나도 만들지 못하면 되돌린다, undoEmptyRewrite). 그림을 덜어 내면 움직이는 GIF 기록(imageMotions)도 함께 덜리므로
// 그 기록도 담는다(되돌린 GIF가 기록을 잃으면 '원래 그림으로'가 사라지고 간직한 원래 그림은 다음 그림 정리에서 지워진다) / copy: 휴지통에 넣은 사본(되돌리면 뺀다)
// batch: 이 일괄 실행의 이름. 사본에 붙여 휴지통의 '모두 복원'이 한 실행의 사본을 함께 되살린다(course-meta.js)
async function clearLessonForRewrite(mod, withGyosuan, subjectId, batch = '') {
    const trashed = lessonHasRewriteContent(mod);
    const copy = trashed ? trashLessonCopy(mod, subjectId, batch) : null;
    migrateMonolithicContent(mod);
    const lockedByTab = Object.fromEntries(LESSON_TABS.map(tab => [tab.id, lockedSectionBlocks(mod, tab.id)]));
    const redraw = globalState.courseDesign?.autoArt ? { illustrations: [], artAutoDone: false } : {};
    const note = trashed ? '일괄 생성으로 내용을 다시 만듦(이전 내용은 휴지통)' : '일괄 생성으로 내용을 다시 만듦';
    const emptied = { content: null, tabContents: {}, ...redraw, ...(withGyosuan ? Object.fromEntries(LESSON_TRACKS.map(track => [track.field, null])) : {}) };
    const isMap = value => !!value && typeof value === 'object' && !Array.isArray(value);
    const hasImages = !!mod.images && typeof mod.images === 'object';
    const motions = isMap(mod.imageMotions) ? { imageMotions: { ...mod.imageMotions } } : {};
    const before = {
        ...Object.fromEntries([...Object.keys(emptied), 'history', 'images'].map(field => [field, field === 'images' && hasImages ? { ...mod.images } : mod[field]])),
        ...motions
    };
    Object.assign(mod, withHistoryNote(mod, note), emptied);
    if (withGyosuan) {
        mod.images = hasImages ? { ...mod.images } : {};
        dropUnusedLessonImages(mod, Object.values(lockedByTab).flat().map(block => block.text));
    }
    await saveState(); // 휴지통 사본과 비운 차시를 한 번에 저장한다
    return { lockedByTab, trashed, copy, before };
}

// 덮어쓰기로 비운 차시에 탭을 하나도 만들지 못했으면(한도·키·연결 문제, 중지, 다른 생성) 비우기 전 내용으로 되돌리고 휴지통에 넣은 사본을 뺀다.
// 다시 시도하면 처음처럼 비우고 만든다. 탭을 하나라도 만들었으면 그대로 둔다(이전 내용은 휴지통에 있다)
async function undoEmptyRewrite(mod, cleared, run, key) {
    if (LESSON_TABS.some(tab => mod.tabContents?.[tab.id])) return;
    Object.assign(mod, cleared.before);
    if (cleared.copy) globalState.lessonTrash = (globalState.lessonTrash || []).filter(entry => entry.lesson !== cleared.copy);
    if (cleared.trashed) {
        run.trashed -= 1;
        run.restored?.add(key); // 내용이 있던 차시만 '되돌렸다'고 센다(빈 차시는 다시 실행하면 빈 탭부터 만든다)
    }
    run.cleared.delete(key);
    await saveState();
    if (getEditingModule() === mod) renderEditor(mod);
}

// 프롬프트의 참고 자료와 커리큘럼은 현재 교과를 읽으므로 차시마다 그 교과로 옮겨 간다
async function attemptLesson(item, run) {
    if (currentSubjectId !== item.subject.id) openEditor(item.subject.id);
    const mod = getEditingModule(item.lessonId);
    if (!mod) return { ok: false, error: '차시를 찾지 못했습니다. 삭제되었는지 확인해주세요.' };
    // 진행 막대의 다른 생성(탭 하나 만들기·일괄 이미지 찾기 등)이 돌면 탭을 만들 수 없다. 차시를 비우지 않고 일괄 생성을 멈춘다
    if (window.isLessonPipelineRunning?.()) return { ok: false, halt: true, error: '다른 생성(진행 막대의 작업)이 끝나지 않았습니다. 그 작업이 끝난 뒤 다시 실행해 주세요.' };
    const key = `${item.subject.id}:${item.lessonId}`; // 차시 id는 교과 안에서만 겹치지 않으므로 교과 id와 함께 센다
    let cleared = null;
    if (run.overwrite && !run.cleared.has(key)) { // 재시도는 먼저 만든 탭을 지우지 않는다
        cleared = await clearLessonForRewrite(mod, run.withGyosuan, item.subject.id, run.batch);
        run.cleared.set(key, cleared.lockedByTab);
        run.restored?.delete(key);
        if (cleared.trashed) run.trashed = (run.trashed || 0) + 1;
    }
    try {
        return await fillRunLesson(item, run, key);
    } finally {
        if (cleared) await undoEmptyRewrite(mod, cleared, run, key);
    }
}

// 갈래마다(기본학습 → 심화학습) 빠진 교수안·슬라이드를 만든다. 실패하거나 멈추면 그 결과를 돌려주고 남은 갈래는 만들지 않는다
async function fillRunGyosuan(lessonId, run) {
    let partial = false;
    for (const track of LESSON_TRACKS) {
        if (run.stopped) return { ok: false, stopped: true, partial };
        const mod = getEditingModule(lessonId);
        if (!mod || !lessonNeedsGyosuan(mod, track.id)) continue;
        const result = await runGyosuanGeneration(lessonId, { track: track.id, onStatus: setLessonRunStatus });
        partial = partial || !!result.partial;
        if (!result.ok) return { ...result, partial };
    }
    return { ok: true, partial };
}

// 차시 하나의 빈 탭, 보강(삽화·NCS), 갈래마다 교수안·슬라이드와 두 문제은행을 차례로 만든다(attemptLesson)
async function fillRunLesson(item, run, key) {
    window.viewModule(item.lessonId);
    const tabs = await fillMissingTabs(item.lessonId, {
        lockedByTab: run.cleared?.get(key),
        isStopped: () => run.stopped,
        onTab: (tab, index, total) => setLessonRunStatus(`${tab.label} (${index + 1}/${total})`),
        onStatus: setLessonRunStatus
    });
    if (!tabs.ok) return tabs;
    await runLessonExtras(item.lessonId, { isStopped: () => run.stopped, onStatus: setLessonRunStatus });
    if (run.stopped) return { ...tabs, ok: false, stopped: true };
    if (!run.withGyosuan) return tabs;
    const gyosuan = await fillRunGyosuan(item.lessonId, run);
    const partial = !!(tabs.partial || gyosuan.partial);
    const short = tabs.short ? { short: true, readMinutes: tabs.readMinutes, ...(tabs.shortTabs ? { shortTabs: tabs.shortTabs } : {}) } : {}; // 학습 탭이 낭독 목표에 못 미쳤으면 보고에 남긴다
    if (!gyosuan.ok) return { ok: false, stopped: gyosuan.stopped, error: gyosuan.error, partial, ...short };
    return { ...(await fillQuestionBank(item.lessonId, { isStopped: () => run.stopped, onStatus: setLessonRunStatus })), partial, ...short };
}

/* ---------- 일괄 생성 화면 ---------- */
const lessonLabel = item => `${item.subject.title} · ${item.title}`;

function runSubjects(scope) {
    return scope === 'course' ? globalState.subjects : globalState.subjects.filter(subject => subject.id === currentSubjectId);
}

// 전체 탭 생성은 탭 사이에 로딩 화면을 내리므로 _suppressTabAlert도 함께 본다.
// 진행 막대의 작업(탭 하나 만들기·일괄 이미지 찾기·탭 전체 AI 고치기 등, 알림을 켜고 돈다)과 교수안 생성도 진행 중이다
function generationBusy() {
    return _suppressTabAlert || !!window.isLessonPipelineRunning?.() || (typeof _gyosuanRunning !== 'undefined' && !!_gyosuanRunning)
        || document.getElementById('editor-loading')?.style.display === 'flex';
}

// 돌고 있는 AI 작업이 있는가. 창을 닫기 전에 묻는다(ui.js hasUnsavedWork). 닫으면 만들던 결과와 그 비용을 잃는다.
// 새 생성을 막는 조건(generationBusy: 진행 막대의 작업·교수안·로딩 화면. 분량 채우기 뒤의 자동 수정·그림·저장도 그 안이다)에 더해
// 일괄 생성·기존 내용 보강·과정 설계·차시 목차 만들기, 기본 학습 분량 채우기(lesson-volume.js), 열어 둔 삽화·문제은행 창의 작업,
// 컨벤션 검수 창의 AI 수정 제안도 센다. 답을 기다리는 AI 호출(api.js callGemini)도 센다: 창을 닫아도 이어지는 삽화·문제은행 작업,
// 참고 자료 판독, 그림 다시 찾기, 블록 다시 설계, 학습 목표 세트 추가, NCS 추천, 과정 화풍처럼 따로 표시가 없는 작업이다.
// 뒤에 싣는 파일의 이름은 typeof로 본다(그 파일을 싣지 않은 화면·시험에서도 멈추지 않게)
function isAiWorkRunning() {
    return generationBusy() || !!_lessonRun
        || (typeof _backfillRun !== 'undefined' && !!_backfillRun)
        || (typeof _designBusy !== 'undefined' && !!_designBusy)
        || document.getElementById('sidebar-loading')?.style.display === 'flex'
        || !!window.isVolumeFilling?.()
        || !!window.aiCallsWaiting?.()
        || (typeof _lessonArt !== 'undefined' && !!_lessonArt?.busy)
        || (typeof _qbank !== 'undefined' && !!_qbank?.busy)
        || (typeof _review !== 'undefined' && !!_review?.busy);
}

function lessonRunListHtml(title, items, detail = () => '') {
    if (!items.length) return '';
    const rows = items.map(item => `<li>${escapeHtml(lessonLabel(item))}${detail(item) ? ` <span class="text-textMuted">— ${escapeHtml(detail(item))}</span>` : ''}</li>`).join('');
    return `<div><p class="text-xs font-bold text-textMuted mb-1">${title} ${items.length}개</p><ul class="list-disc pl-4 space-y-0.5 text-[0.7rem] text-textLight max-h-32 overflow-y-auto">${rows}</ul></div>`;
}

function lessonRunQueueHtml(queue, uploaded) {
    return `
        ${lessonRunListHtml('생성할 차시', queue) || '<p class="text-xs text-textMuted">생성할 차시가 없습니다.</p>'}
        ${uploaded.length ? `<p class="text-xs text-amber-400">업로드한 MD가 있는 차시 ${uploaded.length}개는 제외합니다. 업로드 파일을 반영하려면 차시 카드의 교안 생성을 눌러주세요.</p>` : ''}`;
}

function lessonRunIntroHtml(queue, uploaded, withGyosuan = false) {
    return `
        <p class="text-xs text-textLight">내용이 비어 있는 탭만 차례로 생성합니다. 이미 있는 탭은 그대로 둡니다. 차시마다 몇 분 걸릴 수 있습니다. 교안을 만든 차시에는 NCS 능력단위요소도 확정 전 상태로 배정합니다. 기본학습과 심화학습은 각각 낭독 480분 분량을 채우느라 차시마다 40분 넘게 걸릴 수 있습니다. 실습 탭은 정한 실습 시간(정하지 않으면 90~120분) 분량으로 만듭니다.</p>
        <div id="lesson-run-queue" class="space-y-2">${lessonRunQueueHtml(queue, uploaded)}</div>
        <div id="lesson-run-estimate"></div>
        <label class="flex items-start gap-2 text-xs text-textLight">
            <input id="lesson-run-gyosuan" type="checkbox" ${withGyosuan ? 'checked' : ''}>
            <span>교수안, 슬라이드, 문제은행까지 만들기<span class="block text-[0.6875rem] text-textMuted">기본학습과 심화학습을 따로 만들고 빠진 항목만 만듭니다. 차시마다 호출이 늘고, 슬라이드 자동 이미지를 켜 두면 이미지 비용도 듭니다.</span></span>
        </label>
        <label class="flex items-start gap-2 text-xs text-textLight">
            <input id="lesson-run-overwrite" type="checkbox">
            <span>이미 만든 내용도 모두 다시 만들기<span class="block text-[0.6875rem] text-textMuted">지금 내용은 차시마다 휴지통에 통째로 넣어 30일 동안 되살릴 수 있고, 고정 섹션은 유지합니다. 교수안까지 만들기를 켜면 교수안과 슬라이드도 다시 만듭니다.</span></span>
        </label>
        <label class="flex items-start gap-2 text-xs text-textLight">
            <input id="lesson-run-art" type="checkbox" ${globalState.courseDesign?.autoArt ? 'checked' : ''}>
            <span>교안에 SVG 삽화 넣기<span class="block text-[0.6875rem] text-textMuted">기본학습의 섹션에 그려 넣습니다. 차시마다 호출이 늘고, 차시의 전체 생성에도 같이 적용됩니다.</span></span>
        </label>
        ${lessonGenFieldsHtml('run', globalState.courseDesign?.genOptions)}
        <p class="text-xs text-textMuted">생성 옵션은 과정 기본값으로 저장됩니다. 차시 정보에서 따로 정한 값이 있으면 그 값을 씁니다.</p>`;
}

function lessonRunProgressHtml(item, index, total) {
    const percent = Math.round(index / total * 100);
    return `
        <p class="text-xs font-bold text-textLight">${index + 1}/${total} · ${escapeHtml(lessonLabel(item))}</p>
        <div class="h-1.5 rounded bg-white/10 overflow-hidden"><div class="h-full bg-accent" style="width:${percent}%"></div></div>
        <p id="lesson-run-status" class="text-xs text-accent min-h-[1em]"></p>`;
}

// 덮어쓰기로 이전 내용을 휴지통에 넣은 차시 수와 되찾는 곳
const lessonRunTrashNote = count => (count > 0 ? `<p class="text-xs text-textMuted">차시 ${count}개의 이전 내용은 휴지통에 있습니다. 30일 동안 되살릴 수 있습니다.</p>` : '');

// 그림 모델이 막혀 남긴 그림 자리와 할 일(api.js imageRunNote)
const lessonRunImageNote = note => (note ? `<p class="text-xs text-amber-300">${escapeHtml(note)}</p>` : '');

// trashed: 덮어쓰기로 이전 내용을 휴지통에 넣은 차시 수
// imageNote: 그림 모델이 막혀 남긴 그림 자리 안내(api.js imageRunNote)
// restored: 덮어쓰기로 비웠다가 탭을 하나도 만들지 못해 지우기 전 내용으로 되돌린 차시 수(undoEmptyRewrite)
function lessonRunReportHtml(report, { trashed = 0, imageNote = '', restored = 0 } = {}) {
    const counts = [`완료 ${report.done.length}개`, `실패 ${report.failed.length}개`, report.left.length ? `남은 ${report.left.length}개` : ''].filter(Boolean).join(' · ');
    // 다시 실행하면 이어서 만들 것: 남은 차시나 탭을 만들다 만 차시(지우기 전 내용으로 되돌린 차시는 빈 탭이 없다). 멈춘 까닭이 있으면(halted) 그 줄이 대신 말한다
    const unfinished = !report.halted && (report.left.length || report.failed.length > restored);
    return `
        <p class="text-xs font-bold text-textLight">${report.stopped ? '중지했습니다' : '일괄 생성을 마쳤습니다'} · ${counts}</p>
        ${report.halted ? '<p class="text-xs text-amber-300">남은 차시도 같은 까닭으로 만들 수 없어 일괄 생성을 멈췄습니다. 아래 실패 까닭을 해결한 뒤 다시 실행해 주세요.</p>' : ''}
        ${lessonRunListHtml('실패해서 건너뛴 차시', report.failed, item => item.error)}
        ${lessonRunListHtml('일부 단락이 누락되었을 수 있는 차시', report.partial)}
        ${lessonRunListHtml('낭독 분량이 목표에 못 미친 차시', report.short || [], shortLessonText)}
        ${(report.short || []).length ? "<p class=\"text-xs text-textMuted\">그 차시의 모자란 탭(기본학습·심화학습) 위 '분량 채우기'로 이어서 늘릴 수 있습니다.</p>" : ''}
        ${restored > 0 ? `<p class="text-xs text-textMuted">탭을 하나도 만들지 못한 차시 ${restored}개는 지우기 전 내용으로 되돌렸습니다.</p>` : ''}
        ${unfinished ? '<p class="text-xs text-textMuted">만든 내용은 저장했습니다. 다시 실행하면 남은 탭부터 이어서 생성합니다.</p>' : ''}
        ${lessonRunTrashNote(trashed)}
        ${lessonRunImageNote(imageNote)}`;
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
    if (!runnableLessons(runSubjects(scope), true, true).length) return window.showToast?.('생성할 차시가 없습니다.', 'success');
    const withGyosuan = globalState.courseDesign?.runGyosuan !== false || !runnableLessons(runSubjects(scope)).length; // 탭이 다 찼으면 교수안이나 문제은행만 남은 것이다
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
    refreshLessonRunQueue(scope); // 모두 만든 교과는 덮어쓰기를 골라야 시작할 수 있다
};

// 대기열의 차시마다 할 일을 더한다(빈 탭, 교수안·문제은행, 삽화). 예고에 쓴다(cost-estimate.js)
// genOptions: 창에 적은 과정 기본 생성 옵션(시작할 때 저장한다). 실습 시간을 정한 실습 탭은 이어쓰기 호출을 더 센다
function lessonRunWork(queue, { withGyosuan, overwrite, art, genOptions }) {
    const imageAmount = currentEstimateSettings().imageAmount;
    return sumWork(queue.map(item => {
        const lesson = (item.subject.lessons || []).find(entry => entry.id === item.lessonId) || {};
        const tabs = overwrite ? LESSON_TABS.map(tab => tab.id) : lessonMissingTabs(lesson); // 탭마다 그림 자리 수가 달라 탭 id로 센다
        return lessonWork({
            tabs,
            gyosuan: withGyosuan ? (overwrite ? LESSON_TRACKS.length : gyosuanBuildCount(lesson)) : 0, // 갈래마다 교수안을 하나씩 만든다
            qbank: withGyosuan ? qbankFillCount(lesson, overwrite) : 0,
            art: art && tabs.length > 0,
            volumeMinutes: lessonVolumeMinutes(lesson), // 학습 탭의 낭독 목표(차시 시간과 관계없이 480분)
            practiceMinutes: lessonPracticeWork(lesson, genOptions)
        }, imageAmount);
    }));
}

function refreshLessonRunQueue(scope) {
    const checked = id => !!document.getElementById(id)?.checked;
    const options = { withGyosuan: checked('lesson-run-gyosuan'), overwrite: checked('lesson-run-overwrite'), art: checked('lesson-run-art'), genOptions: readLessonGenFields('run') };
    const pending = pendingLessons(runSubjects(scope), options.withGyosuan, options.overwrite);
    const queue = pending.filter(item => !item.uploaded);
    document.getElementById('lesson-run-queue').innerHTML = lessonRunQueueHtml(queue, pending.filter(item => item.uploaded));
    const estimate = document.getElementById('lesson-run-estimate');
    if (estimate) estimate.innerHTML = queue.length ? estimateBoxHtml(lessonRunWork(queue, options)) : '';
    document.querySelector('[data-run-action="start"]').disabled = !queue.length;
}

function onLessonRunChange(event, scope) {
    if (['lesson-run-gyosuan', 'lesson-run-overwrite', 'lesson-run-art', 'run-gen-basicPracMinutes', 'run-gen-advPracMinutes'].includes(event.target.id)) refreshLessonRunQueue(scope);
}

function onLessonRunClick(event) {
    const action = event.target.dataset?.runAction;
    if (action === 'close') document.getElementById('lesson-run-dialog')?.remove();
    if (action === 'start') startLessonRun(event.target.dataset.scope, event.target);
    if (action === 'stop' && _lessonRun) {
        _lessonRun.stopped = true; // 진행 중인 실행이 같은 객체를 읽는다
        window.requestTabGenerationStop?.();
        event.target.disabled = true;
        event.target.textContent = '받고 있는 단락까지만 저장합니다';
    }
}

// 덮어쓰기 확인 창 글: 무엇을 지우는지, 지금 내용을 몇 차시나 어디에 얼마 동안 남기는지 사실대로 말한다
// art: 이번 실행에서 삽화를 다시 그리는지(창의 '교안에 SVG 삽화 넣기')
function rewriteConfirmText(scope, withGyosuan, art = false) {
    const queue = runnableLessons(runSubjects(scope), withGyosuan, true);
    const lessonOf = item => item.subject.lessons.find(lesson => lesson.id === item.lessonId);
    const kept = queue.filter(item => lessonOf(item) && lessonHasRewriteContent(lessonOf(item))).length;
    const edited = withGyosuan ? queue.filter(item => LESSON_TRACKS.some(track => lessonOf(item)?.[track.field] && gyosuanHasScreenEdits(lessonOf(item)[track.field]))).length : 0;
    const erase = withGyosuan
        ? `차시 ${queue.length}개의 교안 탭과 교수안·슬라이드를 지우고 다시 만듭니다.`
        : `차시 ${queue.length}개의 교안 탭을 지우고 다시 만듭니다. 교수안·슬라이드는 그대로 둡니다.`;
    return [
        `${erase}${art ? ' 삽화도 다시 그립니다.' : ''}`,
        kept ? `지우기 직전에 내용이 있는 차시 ${kept}개를 통째로(글·그림·교수안·슬라이드·삽화) 휴지통에 넣습니다.` : '',
        kept ? '휴지통에서 30일 동안 되살릴 수 있습니다. 되살리면 다시 만든 차시는 그대로 두고, 이전 차시가 그 바로 아래에 따로 생깁니다.' : '',
        edited ? `슬라이드 화면을 직접 고친 차시 ${edited}개는 새 슬라이드에 그 편집이 들어가지 않습니다. 휴지통의 사본에는 남습니다.` : '',
        kept ? '그림까지 보관하므로 브라우저 저장 공간을 더 씁니다. 확인을 마친 사본은 휴지통에서 지우면 됩니다.' : ''
    ].filter(Boolean).join('\n');
}

// 화면 갱신이 실패해도 닫기 버튼은 나오도록 정리는 finally에서 한다
// button: 누른 '생성 시작' 버튼. 확인 창이 떠 있는 동안 막아 Enter로 확인 창이 두 번 뜨지 않게 한다
async function startLessonRun(scope, button = null) {
    if (_lessonRun) return;
    // 창을 연 뒤 다른 생성(진행 막대의 작업 등)이 시작됐을 수 있다. 그동안은 탭을 만들 수 없어 시작하지 않는다(확인 창을 기다리는 사이도 다시 본다)
    if (generationBusy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    const withGyosuan = !!document.getElementById('lesson-run-gyosuan')?.checked;
    const overwrite = !!document.getElementById('lesson-run-overwrite')?.checked;
    const art = !!document.getElementById('lesson-run-art')?.checked;
    if (typeof warnInvalidPracticeFields === 'function' && warnInvalidPracticeFields('run')) return; // 받을 수 없는 실습 시간이면 시작하지 않고 알린다(course-design.js)
    if (overwrite) {
        if (button) button.disabled = true;
        let ok = false;
        try {
            ok = await confirmAsync(rewriteConfirmText(scope, withGyosuan, art), { okLabel: '휴지통에 넣고 다시 만들기', title: '이미 만든 내용 다시 만들기' });
        } finally {
            if (button) button.disabled = false;
        }
        if (!ok) return;
        if (generationBusy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    }
    if (_lessonRun) return;
    saveCourseDesignField({ genOptions: readLessonGenFields('run'), runGyosuan: withGyosuan, autoArt: art });
    // 이 실행이 휴지통에 넣는 사본에 붙이는 이름(휴지통의 '모두 복원'). 앱 밖(테스트 등)에서는 시각과 난수로 만든다
    const batch = typeof generateUniqueId === 'function' ? generateUniqueId('run_') : `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const run = { stopped: false, withGyosuan, overwrite, cleared: new Map(), trashed: 0, restored: new Set(), batch };
    _lessonRun = run;
    setLessonRunButtons(RUN_BUTTONS.stop);
    const ownsImageRun = !!window.beginImageRun?.(); // 그림 모델이 막히면 이 실행이 끝날 때까지 다시 부르지 않는다(api.js)
    const imageNote = () => (ownsImageRun ? window.imageRunNote?.() || '' : ''); // 이 실행이 연 기록의 안내만 보인다
    try {
        const report = await runLessonQueue(runnableLessons(runSubjects(scope), withGyosuan, overwrite), item => attemptLesson(item, run), {
            isStopped: () => run.stopped,
            onLesson: (item, index, total) => setLessonRunBody(lessonRunProgressHtml(item, index, total)),
            onRetry: (item, error) => setLessonRunStatus(`${LESSON_RETRY_WAIT_SECONDS}초 뒤 다시 시도합니다... (${error})`)
        });
        setLessonRunBody(lessonRunReportHtml(report, { trashed: run.trashed, imageNote: imageNote(), restored: run.restored.size }));
        await saveState();
        renderSidebar();
        renderOverviewLNB();
    } catch (err) {
        console.error('[일괄 생성] 실패:', err);
        setLessonRunBody(`<p class="text-xs text-rose-300">일괄 생성 중 오류가 발생했습니다: ${escapeHtml(err.message)}</p>${lessonRunTrashNote(run.trashed)}${lessonRunImageNote(imageNote())}`);
    } finally {
        if (ownsImageRun) window.endImageRun?.();
        _lessonRun = null;
        setLessonRunButtons(RUN_BUTTONS.close);
    }
}

/* ---------- 블록 다시 설계 ---------- */
function lessonHasContent(lesson) {
    return LESSON_TABS.some(tab => lesson.tabContents?.[tab.id]) || !!lesson.content || LESSON_TRACKS.some(track => !!lesson[track.field]?.docMd) || !!lesson.uploadedMdContent;
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
    await archiveContents(previous.filter(item => item.content)); // 한 번에 남긴다(id가 겹치지 않고 상한 알림도 한 번)
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
                <label class="block text-[0.6875rem] font-bold text-textMuted">교과 시간
                    <input id="replan-hours" type="number" min="1" value="${subjectPlanHours(subject)}" class="block w-24 mt-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white">
                </label>
                <p id="replan-status" class="text-xs text-accent min-h-[1em]"></p>
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

// 차시는 이미 바뀌었으므로 실패해도 되돌리지 않는다. 확정한 교과는 autoAssignNcs가 건드리지 않는다
// 고를 만한 단위를 못 찾으면 이전 배정을 지우지 않고 남긴다
async function reassignReplannedNcs(subject) {
    if (subject.ncs?.confirmed) return;
    const units = subject.ncs?.units || [];
    window.showToast?.('NCS 능력단위를 새 블록에 맞춰 다시 배정하고 있습니다.', 'info');
    try {
        const ncs = await autoAssignNcs(subject);
        if (ncs && !ncs.units?.length) subject.ncs = { ...ncs, units };
        await saveState();
        if (subject.id === currentSubjectId) renderSidebar();
        renderOverviewLNB();
    } catch (err) {
        console.error('[블록 다시 설계] NCS 재배정 실패:', err);
        window.showToast?.('NCS 다시 배정에 실패했습니다. NCS 관리에서 다시 추천해주세요.', 'warning');
    }
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
        await reassignReplannedNcs(subject);
    } catch (err) {
        console.error('[블록 다시 설계] 실패:', err);
        if (run !== _replanRun) return;
        status.textContent = `설계 실패: ${err.message} 지금 차시는 그대로입니다.`;
        button.disabled = false;
    }
}

/* ---------- 교수안·편성안 묶음 ---------- */
const stripFrontmatter = md => String(md || '').replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '').trim();

// ZIP에 넣을 차시의 교수안·편성안 파일. 번호는 탭 파일(01_기본학습 … 06_심화이해도) 다음이고, 심화학습 교수안은 '심화'를 붙인다.
// 이름이 교수안·편성안으로 끝나 '내보낸 교안 다시 불러오기'가 교안 탭으로 넣지 않는다(output-import.js OUTPUT_GYOSUAN_NAME)
const GYOSUAN_ZIP_FILES = {
    basic: { doc: '07_교수안.md', deck: '08_슬라이드편성안.md' },
    adv: { doc: '09_심화교수안.md', deck: '10_심화슬라이드편성안.md' }
};
function lessonGyosuanFiles(mod) {
    return LESSON_TRACKS.flatMap(track => {
        const { docMd, deckMd } = mod?.[track.field] || {};
        const names = GYOSUAN_ZIP_FILES[track.id];
        return [
            ...(docMd ? [{ name: names.doc, content: docMd }] : []),
            ...(deckMd ? [{ name: names.deck, content: deckMd }] : [])
        ];
    });
}

// 이미지 data URL을 ZIP용 확장자와 base64 본문으로 나눈다. svg+xml도 읽고, base64가 아니면 본문이 비어 건너뛰게 한다
function zipImageParts(dataUrl) {
    const [, ext = 'png', data = ''] = String(dataUrl).match(/^data:image\/(\w+)[^;,]*;base64,(.*)$/s) || [];
    return { ext, data };
}

// 교과의 교수안·편성안을 차시 순서로 묶는다. 차시마다 기본학습 교수안 다음에 심화학습 교수안이다
function subjectBundleMd(subject) {
    const lessons = (subject.lessons || []).filter(lesson => lesson.id !== 'mainQuest');
    const hasPlan = (lesson, track) => !!(lesson[track.field]?.docMd || lesson[track.field]?.deckMd);
    const ready = lessons.filter(lesson => LESSON_TRACKS.some(track => hasPlan(lesson, track)));
    if (!ready.length) return '';
    // 교안이 있거나 교수안이 하나도 없는 차시에서 아직 없는 갈래의 교수안
    const missing = lessons.flatMap(lesson => LESSON_TRACKS
        .filter(track => !hasPlan(lesson, track) && (trackHasContent(lesson, track.id) || (!ready.includes(lesson) && track.id === LESSON_TRACKS[0].id)))
        .map(track => `- ${lesson.title} · ${track.label}`));
    const parts = ready.flatMap(lesson => LESSON_TRACKS.flatMap(track => [lesson[track.field]?.docMd, lesson[track.field]?.deckMd]).filter(Boolean).map(stripFrontmatter));
    const titles = lesson => LESSON_TRACKS.filter(track => hasPlan(lesson, track)).map(track => track.label).join('·');
    return [
        `# 교수안·슬라이드 편성안 모음 - ${subject.title}`, '',
        '## 차시', '', ...ready.map((lesson, i) => `${i + 1}. ${lesson.title} (${titles(lesson)})`), '',
        ...(missing.length ? ['## 교수안이 아직 없는 차시', '', ...missing, ''] : []),
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
    const button = 'text-[0.6875rem] font-bold px-2 py-1 rounded bg-white/10 text-textLight hover:bg-accent transition-colors';
    const remaining = runnableLessons([subject]).length;
    // 접어도 남은 차시 수는 머리줄에 보인다
    return sidebarSectionHtml('subject-flow', { icon: 'ph-stack', title: '교과 일괄 작업', summaryHtml: remaining ? `남은 차시 ${remaining}개` : '' }, `
            <div class="flex flex-wrap gap-1">
                <button onclick="openLessonRun('subject')" class="${button}" title="내용이 빈 탭만 차례로 생성">남은 차시 생성 ${remaining}개</button>
                <button onclick="openSubjectBlocks()" class="${button}" title="차시 제목과 시간을 한눈에 보고 고침">차시 구성</button>
                <button onclick="openSubjectReplan()" class="${button}" title="AI로 이 교과의 차시를 새로 나눔">블록 다시 설계</button>
                <button onclick="downloadSubjectBundle()" class="${button}" title="모든 차시의 교수안과 슬라이드 편성안을 한 파일로 내려받기">교수안·편성안 묶음</button>
                <button onclick="downloadLessonMaterial('subject')" class="${button}" title="이 교과를 학습자용 직무 교육 자료 양식으로 내려받기">교육 자료</button>
                <button onclick="downloadLessonMaterial('course')" class="${button}" title="과정 전체를 학습자용 직무 교육 자료 양식으로 내려받기">과정 교육 자료</button>
                <button onclick="openLessonBackfill()" class="${button}" title="예전에 만든 교과와 차시에 NCS와 삽화를 채움">기존 내용 보강</button>
            </div>`);
}
