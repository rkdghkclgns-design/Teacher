// course-overview.js - 교과 현황: 과정 시간 막대, 교과 배지, 교과를 추가한 뒤의 차시 구성 화면
// develocket-slide(assets/course-ui.js renderSummary·unitBadges·블록 설계 @3a7303f)를 Teacher의 교과·차시에 옮겼다.

const courseLessons = subject => subjectLessons(subject).filter(lesson => lesson.id !== 'mainQuest');
const courseLessonMinutes = subject => courseLessons(subject).reduce((sum, lesson) => sum + lessonMinutes(lesson), 0);
const courseTargetMinutes = () => (Number(globalState.courseDesign?.totalHours) || 0) * 60;

/* ---------- 교과 카드 배지 ---------- */
function subjectBadge(text, title, style = 'bg-white/10 text-textLight') {
    return `<span title="${escapeHtml(title)}" class="text-[0.6875rem] font-bold px-2 py-1 rounded-md ${style}">${escapeHtml(text)}</span>`;
}

function subjectStatusBadges(subject) {
    const lessons = courseLessons(subject);
    const plans = lessons.filter(lesson => lesson.gyosuan?.docMd).length;
    const questions = lessons.reduce((sum, lesson) => sum + qbankQuestions(lesson).length, 0);
    const done = lessons.filter(lesson => lessonStatus(lesson) === '완료').length;
    const units = subject.ncs?.units?.length || 0;
    const confirmed = !!subject.ncs?.confirmed;
    return [
        plans ? subjectBadge(`교수안 ${plans}/${lessons.length}`, '교수안이 있는 차시') : '',
        units ? subjectBadge(`NCS ${units}${confirmed ? '' : ' 확정 전'}`, confirmed ? 'NCS 능력단위 확정' : 'NCS 능력단위 자동 배정 · 확정 전', confirmed ? undefined : 'bg-amber-500/20 text-amber-300') : '',
        questions ? subjectBadge(`문항 ${questions}`, '학습이해도 탭의 문항 수') : '',
        done ? subjectBadge(`완료 ${done}/${lessons.length}`, '작업 상태가 완료인 차시') : ''
    ].join('');
}

function subjectOverviewChips(subject) {
    const total = globalState.subjects.reduce((sum, item) => sum + courseLessonMinutes(item), 0);
    const minutes = courseLessonMinutes(subject);
    const time = minutes ? subjectBadge(`${fmtMinutes(minutes)} · ${Math.round(minutes / total * 100)}%`, '교과 시간과 과정에서 차지하는 비율') : '';
    return `${time}${subjectStatusBadges(subject)}`;
}

/* ---------- 과정 시간 막대 ---------- */
function renderCourseTimeBar() {
    const rows = globalState.subjects.map((subject, index) => ({ subject, index, minutes: courseLessonMinutes(subject) })).filter(row => row.minutes);
    const total = rows.reduce((sum, row) => sum + row.minutes, 0);
    if (!total) return '';
    const target = courseTargetMinutes();
    const matched = !target || target === total;
    const segments = rows.map(({ subject, index, minutes }) => `
        <button onclick="location.hash='#editor/${escapeHtml(String(subject.id))}'" style="flex:${minutes}" title="${escapeHtml(`${index + 1}. ${subject.title} — ${fmtMinutes(minutes)}`)}" class="min-w-0 h-4 rounded-sm bg-accent/40 hover:bg-accent text-[0.6875rem] font-bold text-white truncate">${index + 1}</button>`).join('');
    return `
        <div class="mb-3 rounded-xl border border-white/10 bg-white/5 p-2.5">
            <div class="flex items-center justify-between gap-2 text-[0.6875rem]">
                <span class="font-bold text-textLight">과정 시간</span>
                <span class="${matched ? 'text-emerald-400' : 'text-amber-400'}">합계 ${fmtMinutes(total)}${target ? ` / 목표 ${fmtMinutes(target)}` : ''}</span>
            </div>
            <div class="flex gap-0.5 mt-1.5">${segments}</div>
            ${matched ? '' : '<button onclick="fitSubjectHours()" class="mt-1.5 text-[0.6875rem] font-bold px-2 py-0.5 rounded bg-white/10 text-textLight hover:bg-accent">비율대로 맞추기</button>'}
        </div>`;
}

function fittedLessons(subject, minutes) {
    const lessons = courseLessons(subject);
    const split = allocateTime(lessons.length, minutes, lessons.map(lessonMinutes), DESIGN_FLOW_STEP_MINUTES);
    return lessons.map((lesson, index) => lessonWithHours(lesson, split[index] / 60) || lesson);
}

async function applySubjectHours() {
    const subjects = globalState.subjects.filter(courseLessonMinutes);
    const fitted = allocateTime(subjects.length, courseTargetMinutes(), subjects.map(courseLessonMinutes), DESIGN_FLOW_STEP_MINUTES);
    subjects.forEach((subject, index) => {
        const quests = (subject.lessons || []).filter(lesson => lesson.id === 'mainQuest');
        subject.lessons = [...quests, ...fittedLessons(subject, fitted[index])];
        if (subject.id === currentSubjectId) courseData = subject.lessons;
    });
    await saveState();
    renderSidebar();
    renderOverviewLNB();
    window.showToast?.('교과 시간을 과정 목표에 맞췄습니다.', 'success');
}

// 차시 시간을 비율대로 늘이거나 줄인다. 진행 단계 시간도 함께 맞춘다
window.fitSubjectHours = function () {
    if (generationBusy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.'); // 생성 중인 차시 객체를 바꾸면 결과가 사라진다
    window.showConfirm(`교과 시간을 비율대로 조정해 합계를 ${fmtMinutes(courseTargetMinutes())}으로 맞출까요? 차시와 진행 단계 시간이 바뀝니다.`, applySubjectHours, { okLabel: '시간 맞추기', tone: 'primary' });
};

/* ---------- 차시 구성 화면 ---------- */
function blockRowHtml(lesson, index) {
    const input = 'px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white focus:outline-none focus:border-accent';
    const summary = `목표 ${(lesson.objectives || []).length}개 · 단계 ${(lesson.flow || []).length}개`;
    const id = escapeHtml(String(lesson.id));
    return `
        <tr>
            <td class="pr-2 text-[0.6875rem] text-textMuted">${index + 1}</td>
            <td class="pr-2 py-0.5"><input data-block-title="${id}" value="${escapeHtml(lesson.title)}" class="${input} w-full"></td>
            <td class="pr-2 py-0.5"><input data-block-hours="${id}" type="number" min="0.25" step="0.25" value="${escapeHtml(String(lesson.hours ?? ''))}" aria-label="차시 시간" class="${input} w-16"></td>
            <td class="pr-2 text-[0.6875rem] text-textMuted whitespace-nowrap">${escapeHtml(summary)}</td>
            <td><button data-block-action="detail" data-id="${id}" class="px-2 py-0.5 text-[0.6875rem] font-bold text-textLight bg-white/10 rounded hover:bg-white/20">상세</button></td>
        </tr>`;
}

// 제목은 비우거나 다른 차시와 겹치면 안 되고, 시간은 양수여야 한다. 고를 수 없는 값은 저장 전에 알린다
function readBlockRows(overlay, lessons) {
    return lessons.map(lesson => {
        const id = CSS.escape(String(lesson.id));
        return {
            lesson,
            title: overlay.querySelector(`[data-block-title="${id}"]`).value.trim(),
            hours: overlay.querySelector(`[data-block-hours="${id}"]`).value
        };
    });
}

// 같은 화면에서 맞바꾸는 제목은 허용하고, 이번에 새로 겹치게 되는 제목만 막는다
function blockRowProblem({ lesson, title, hours }, rows = []) {
    if (!title) return `${lesson.title}: 제목을 입력해주세요.`;
    const others = allLessonEntries().filter(entry => !rows.some(row => row.lesson.id === entry.lesson.id) && entry.lesson.id !== lesson.id);
    const taken = others.some(entry => String(entry.lesson.title).trim() === title) || rows.filter(row => row.title === title).length > 1;
    if (title !== lesson.title && taken) return `같은 제목의 차시가 이미 있습니다: ${title}`;
    return hours !== '' && !(Number(hours) > 0) ? `${title}: 시간은 0보다 커야 합니다.` : '';
}

function blockRowLesson({ lesson, title, hours }) {
    const timed = hours !== '' && Number(hours) !== Number(lesson.hours) ? lessonWithHours(lesson, hours) : lesson;
    return title === lesson.title ? timed : { ...timed, title };
}

async function saveSubjectBlocks(overlay, subject) {
    const rows = readBlockRows(overlay, courseLessons(subject));
    const problem = rows.map(row => blockRowProblem(row, rows)).find(Boolean);
    if (problem) return window.showAlert(problem);
    const quests = (subject.lessons || []).filter(lesson => lesson.id === 'mainQuest');
    subject.lessons = [...quests, ...rows.map(blockRowLesson)];
    if (subject.id === currentSubjectId) courseData = subject.lessons;
    await saveState();
    overlay.remove();
    renderSidebar();
    renderOverviewLNB();
}

async function onBlockDialogClick(event, overlay, subject) {
    const action = event.target.dataset?.blockAction;
    if (action === 'close') overlay.remove();
    if (action === 'save') await saveSubjectBlocks(overlay, subject);
    if (action === 'detail') {
        overlay.remove();
        await window.openLessonMeta(Number(event.target.dataset.id) || event.target.dataset.id);
    }
}

window.openSubjectBlocks = function () {
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    if (!subject || document.getElementById('subject-blocks-dialog')) return;
    if (generationBusy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    const lessons = courseLessons(subject);
    if (!lessons.length) return window.showAlert('이 교과에 차시가 없습니다. 차시를 추가하거나 블록 다시 설계를 실행해주세요.');
    const overlay = document.createElement('div');
    overlay.id = 'subject-blocks-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[640px] max-w-[94vw] max-h-[84vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10">
                <h2 class="text-sm font-bold text-textLight">차시 구성 · ${escapeHtml(subject.title)}</h2>
                <p class="text-xs text-textMuted mt-1">합계 ${fmtMinutes(courseLessonMinutes(subject))}. 학습 목표와 진행 단계는 상세에서 고칩니다. 시간을 바꾸면 진행 단계 시간도 함께 맞춥니다.</p>
            </div>
            <div class="flex-1 overflow-y-auto p-4"><table class="w-full">${lessons.map(blockRowHtml).join('')}</table></div>
            <div class="p-3 border-t border-white/10 flex justify-end gap-2">
                <button data-block-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
                <button data-block-action="save" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">저장</button>
            </div>
        </div>`;
    overlay.addEventListener('click', event => onBlockDialogClick(event, overlay, subject));
    document.body.appendChild(overlay);
};
