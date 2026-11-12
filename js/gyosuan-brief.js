// gyosuan-brief.js - 간이 교수안: 교수안 옆에 두는 한 장짜리 참고 교수안(교과·일차, 교안 순서와 권장 수업 시간, 필수·과제, 시간이 되면 권장)
// 갈래마다 교수안 칸(mod.gyosuan · mod.gyosuanAdv)의 briefMd에 마크다운으로 둔다. 머리(제목·안내·교과·일차·교안 순서)는 차시 시간으로 코드가 정하고,
// 필수·과제·권장은 다 만든 교수안(docMd)과 그 갈래 탭 제목을 근거로 AI 호출 한 번(갈래마다 하나)으로 받는다.
// 응답 형식이 맞지 않거나 호출이 실패하면 briefMd를 두지 않고 교수안은 그대로 둔다(교수안은 이 호출 전에 이미 저장했다).
// 교수안을 만들 때(처음 만들기·재생성·일괄 생성) gyosuan.js runGyosuanGeneration이 교수안을 저장한 뒤 runGyosuanBriefStep을 부른다.
// 교수안만 있고 간이 교수안이 없으면 교수안 화면의 '간이 교수안 만들기'(generateGyosuanBrief)가 이 호출만 한다. 화면은 gyosuan-view.js, 테스트: tests/gyosuan-brief.test.js

const BRIEF_DAY_MINUTES = 8 * 60;                       // 하루 수업 시간(분). 교과 안에서 차시 시간을 차례로 더해 일차를 정한다
const BRIEF_DOC_CHARS = 16000;                          // AI에 보내는 교수안 글자 수 상한(넘으면 '진행' 절만 줄인다)
const BRIEF_HEADING_LIMIT = 24;                         // 탭마다 보내는 제목 수 상한
const BRIEF_COUNTS = { must: [2, 5], extra: [1, 4] };  // 필수·권장 항목 수(최소, 최대). 모자라면 응답을 받지 않고, 넘치면 앞에서부터 최대까지 쓴다
const BRIEF_NOTE = '이 교수안은 참고용입니다. 수업에 필요하면 절을 새로 만들거나 기존 절을 고쳐 써도 됩니다.';
const BRIEF_DEADLINE = '제출 기한은 수업 중에 반드시 고지한다.';
const BRIEF_MARKS = { must: '@@필수@@', task: '@@과제@@', extra: '@@권장@@' };
const BRIEF_STOP_LABELS = { idle: '간이 교수안 만들기 중지', pending: '멈추고 있습니다...' };
const BRIEF_RETRY_HINT = "교수안 화면의 '간이 교수안 만들기'로 다시 만들 수 있습니다.";
const BRIEF_STOPPED = '간이 교수안 만들기를 중지했습니다.';

/* ---------- 머리: 교과·일차·교안 순서(코드가 정한다) ---------- */
// 차시 시간(분). 시간이 없거나 0 이하면 0
const briefLessonMinutes = lesson => {
    const hours = Number(lesson?.hours);
    return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : 0;
};

// 1시간 · 1시간 30분 · 45분
function briefDurationText(minutes) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours && rest) return `${hours}시간 ${rest}분`;
    return hours ? `${hours}시간` : `${rest}분`;
}

// 교과 안에서 그 차시의 일차와 같은 날 차시들 { day, items: [{ title, minutes }] }.
// 일차 = (앞 차시 시간의 합 ÷ 8시간)의 몫 + 1, 같은 날은 시작 시각이 [8(d-1), 8d)시간 안인 차시다. 시간이 없는 차시는 0시간으로 더하고 어느 날에도 넣지 않는다.
// 그 차시에 시간이 없거나 교과에서 찾지 못하면 일차 없이 그 차시만 둔다
function briefDayPlan(lessons, mod) {
    const list = Array.isArray(lessons) ? lessons : [];
    const own = briefLessonMinutes(mod);
    const same = list.indexOf(mod);
    const index = same >= 0 ? same : list.findIndex(lesson => lesson && mod && String(lesson.id) === String(mod.id));
    if (!own || index < 0) return { day: null, items: [{ title: String(mod?.title || ''), minutes: own }] };
    const { starts } = list.reduce((acc, lesson) => ({ sum: acc.sum + briefLessonMinutes(lesson), starts: acc.starts.concat(acc.sum) }), { sum: 0, starts: [] });
    const day = Math.floor(starts[index] / BRIEF_DAY_MINUTES) + 1;
    const from = (day - 1) * BRIEF_DAY_MINUTES;
    const items = list
        .map((lesson, i) => ({ title: String(lesson?.title || ''), minutes: briefLessonMinutes(lesson), start: starts[i] }))
        .filter(item => item.minutes > 0 && item.start >= from && item.start < from + BRIEF_DAY_MINUTES)
        .map(({ title, minutes }) => ({ title, minutes }));
    return { day, items };
}

// 교과 줄: '{교과 번호} {교과 이름}'. 번호는 교과 목록에서의 차례(1부터)다. 이름이 이미 숫자로 시작하면 번호를 붙이지 않는다
function briefSubjectLabel(subjects, subject) {
    const title = String(subject?.title || '').trim();
    if (!title || /^\d/.test(title)) return title;
    const index = (Array.isArray(subjects) ? subjects : []).findIndex(item => item === subject || (item?.id != null && item.id === subject.id));
    return index >= 0 ? `${index + 1} ${title}` : title;
}

const briefLessonsOf = subject => (typeof subjectLessonList === 'function' ? subjectLessonList(subject) : subject?.lessons) || [];

// 그 차시가 든 교과: 지금 연 교과에 있으면 그 교과, 아니면 그 차시 객체를 담은 교과, 어디에도 없으면 지금 연 교과
function briefSubjectOf(mod) {
    const subjects = Array.isArray(globalState?.subjects) ? globalState.subjects : [];
    const current = subjects.find(subject => subject.id === currentSubjectId) || null;
    if (current && briefLessonsOf(current).some(lesson => lesson === mod || String(lesson?.id) === String(mod?.id))) return current;
    return subjects.find(subject => briefLessonsOf(subject).includes(mod)) || current;
}

// 간이 교수안 머리(제목·안내·교과·교안 순서). topic: 교수안 주제(gyosuan.js gyosuanTopic) / plan: briefDayPlan
function briefHeaderMd({ topic, subjectLabel = '', plan }) {
    const subjectLine = [subjectLabel, plan.day ? `${plan.day}일차` : ''].filter(Boolean).join(' · ');
    const order = plan.items.map((item, i) => `  ${i + 1}. ${item.title}${item.minutes ? ` — ${briefDurationText(item.minutes)}` : ''}`);
    return [`# ${topic} 교수안`, '', BRIEF_NOTE, '', ...(subjectLine ? [`- 교과: ${subjectLine}`] : []), '- 교안 순서와 권장 수업 시간:', ...order].join('\n');
}

// 차시와 갈래로 머리를 만든다. 교과를 찾지 못하면 과정 이름을 교과 줄에 쓴다
function gyosuanBriefHeader(mod, trackId = 'basic') {
    const subject = briefSubjectOf(mod);
    const label = briefSubjectLabel(globalState?.subjects, subject) || String(globalState?.courseTitle || '').trim();
    const topic = typeof gyosuanTopic === 'function' ? gyosuanTopic(mod, trackId) : String(mod?.title || '');
    return briefHeaderMd({ topic, subjectLabel: label, plan: briefDayPlan(subject ? briefLessonsOf(subject) : [], mod) });
}

/* ---------- AI 호출: 필수·과제·권장 ---------- */
// 보내는 교수안: 머리글(frontmatter)·그림·목차는 빼고, 길면 '진행' 절만 줄여 앞뒤 절(학습 목표·수업 흐름·학생 산출물·제출·평가)은 그대로 보낸다
function briefSourceDoc(docMd, limit = BRIEF_DOC_CHARS) {
    const text = String(docMd || '').replace(/\r\n/g, '\n').replace(/^﻿?---\n[\s\S]*?\n---\s*/, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n').trim();
    const parts = text.split(/\n(?=##\s)/).filter(part => !/^##\s*목차\s*$/.test(part.split('\n')[0].trim()));
    const whole = parts.join('\n');
    if (whole.length <= limit) return whole;
    const at = parts.findIndex(part => /^##\s*진행\s*$/.test(part.split('\n')[0].trim()));
    if (at < 0) return whole.slice(0, limit);
    const room = Math.max(0, limit - (whole.length - parts[at].length));
    return parts.map((part, i) => (i === at ? `${part.slice(0, room).trimEnd()}\n…(진행 일부 생략)` : part)).join('\n');
}

// 탭의 제목(### 까지). 코드 블록 속 # 주석 줄은 제목이 아니다
function briefTabHeadings(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/```[\s\S]*?```/g, '')
        .split('\n').map(line => line.match(/^#{1,3}\s+(.+?)\s*$/)).filter(Boolean)
        .map(match => (typeof cleanSectionTitle === 'function' ? cleanSectionTitle(match[1]) : match[1].trim()))
        .filter(Boolean).slice(0, BRIEF_HEADING_LIMIT);
}

function buildBriefPrompt({ topic, docMd, learnHeadings = [], practiceHeadings = [], tabs = {} }) {
    const list = (title, items) => (items.length ? [`[${title}]`, ...items.map(item => `- ${item}`)] : []);
    return [
        '아래 [교수안]을 읽고 강사가 수업 전에 한눈에 볼 간이 교수안의 세 부분을 쓰세요. 아래 형식만 출력합니다.',
        '',
        BRIEF_MARKS.must,
        '- (이 차시에서 빠뜨리면 안 되는 것. 2~5개, 한 줄에 하나)',
        BRIEF_MARKS.task,
        '- (학생이 제출하는 과제가 있으면 과제 내용과 제출 방법 한 줄. 없으면 이 줄 대신 없음 한 단어만)',
        BRIEF_MARKS.extra,
        '- (시간이 남으면 더 다룰 것. 1~4개, 한 줄에 하나)',
        '',
        '[작성 규칙]',
        '- 항목마다 강사가 할 일을 한 문장으로 짧게 쓰고 "~한다"로 끝냅니다.',
        `- 과제는 실습 탭이나 교수안에 학생이 제출하는 과제·산출물이 있을 때만 씁니다. 제출 기한은 정하지 말고 "${BRIEF_DEADLINE}"로 끝냅니다.`,
        '- 필수와 권장에 같은 내용을 겹쳐 쓰지 않습니다.',
        '- 교수안에 없는 내용은 지어내지 않습니다. 표·코드 블록·제목은 쓰지 않습니다.',
        '',
        `[차시] ${topic}`,
        ...list(`${tabs.learn || '학습'} 탭 제목`, learnHeadings),
        ...list(`${tabs.practice || '실습'} 탭 제목`, practiceHeadings),
        `[교수안]\n${briefSourceDoc(docMd)}`
    ].join('\n');
}

function briefSystemInstruction() {
    const persona = typeof CONTEXT_CORE !== 'undefined' ? CONTEXT_CORE?.personas?.instructor || '' : '';
    return [`${persona} 직업훈련 강사가 수업 전에 한눈에 보는 간이 교수안을 씁니다.`.trim(), '- 지정된 출력 형식만 출력하고 머리말·맺음말을 붙이지 않습니다.'].join('\n');
}

/* ---------- 응답 읽기·검사 ---------- */
const BRIEF_BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
// 항목 한 줄: 글머리(-, *, •, 1.)와 굵게 표시, 앞 이름표(필수:, 과제:, 권장:)를 떼고 빈칸을 줄인다
const briefItemText = line => String(line).replace(BRIEF_BULLET, '').replace(/\*\*/g, '').replace(/^(?:필수|과제|권장)\s*[:：]\s*/, '').replace(/\s+/g, ' ').trim();
// 형식 설명을 그대로 옮긴 줄 '(…)'은 항목이 아니다
const isBriefPlaceholder = text => /^\(.*\)$/.test(text);

// 표시 뒤부터 다음 표시 앞까지의 글. 표시가 없으면 null
function briefBlock(text, mark) {
    const at = text.indexOf(mark);
    if (at < 0) return null;
    const rest = text.slice(at + mark.length);
    const ends = Object.values(BRIEF_MARKS).map(other => rest.indexOf(other)).filter(i => i >= 0);
    return rest.slice(0, ends.length ? Math.min(...ends) : rest.length);
}

// 글머리 항목들(겹친 항목은 하나만)
function briefItems(block) {
    const items = String(block || '').split('\n').filter(line => BRIEF_BULLET.test(line)).map(briefItemText)
        .filter(text => text && !isBriefPlaceholder(text));
    return items.filter((item, i) => items.indexOf(item) === i);
}

// 과제 한 줄. '없음'이거나 비면 ''. 제출 기한 고지가 빠졌으면 붙인다
function briefTask(block) {
    const first = String(block || '').split('\n').map(briefItemText).find(line => line && !isBriefPlaceholder(line)) || '';
    if (!first || /^(?:해당\s*)?없(?:음|다|습니다)/.test(first)) return '';
    if (/기한/.test(first)) return first;
    return `${/[.!?。]$/.test(first) ? first : `${first}.`} ${BRIEF_DEADLINE}`;
}

// AI 답 → { must, task, extra } 또는 { error }. 필수·권장 표시가 없거나 항목이 모자라면 오류, 넘치면 앞에서부터 상한까지. 과제 표시가 없으면 과제가 없는 것으로 본다
function parseBriefAnswer(text) {
    const source = String(text || '').replace(/\r\n/g, '\n');
    const must = briefBlock(source, BRIEF_MARKS.must);
    const extra = briefBlock(source, BRIEF_MARKS.extra);
    if (must === null || extra === null) return { error: '간이 교수안 응답에 필수·권장 표시가 없습니다.' };
    const mustItems = briefItems(must);
    const extraItems = briefItems(extra);
    if (mustItems.length < BRIEF_COUNTS.must[0]) return { error: `간이 교수안 응답의 필수 항목이 ${BRIEF_COUNTS.must[0]}개보다 적습니다.` };
    if (extraItems.length < BRIEF_COUNTS.extra[0]) return { error: '간이 교수안 응답에 시간이 되면 권장할 항목이 없습니다.' };
    return { must: mustItems.slice(0, BRIEF_COUNTS.must[1]), task: briefTask(briefBlock(source, BRIEF_MARKS.task)), extra: extraItems.slice(0, BRIEF_COUNTS.extra[1]) };
}

function assembleBriefMd(header, answer) {
    return [
        header, '', '## 필수', '', ...answer.must.map(item => `- ${item}`), ...(answer.task ? [`- 과제: ${answer.task}`] : []),
        '', '## 시간이 되면 권장', '', ...answer.extra.map(item => `- ${item}`), ''
    ].join('\n');
}

// 간이 교수안 MD 한 벌(호출 한 번). 응답 형식이 맞지 않으면 던진다
async function buildGyosuanBrief(mod, trackId, docMd) {
    const track = lessonTrack(trackId);
    const tabLabel = id => (typeof LESSON_TABS !== 'undefined' && LESSON_TABS.find(tab => tab.id === id)?.label) || id;
    const prompt = buildBriefPrompt({
        topic: gyosuanTopic(mod, track.id),
        docMd,
        learnHeadings: briefTabHeadings(mod.tabContents?.[track.learn]),
        practiceHeadings: briefTabHeadings(mod.tabContents?.[track.practice]),
        tabs: { learn: tabLabel(track.learn), practice: tabLabel(track.practice) }
    });
    const answer = parseBriefAnswer(await askGyosuanModel(prompt, briefSystemInstruction()));
    if (answer.error) throw new Error(answer.error);
    return assembleBriefMd(gyosuanBriefHeader(mod, track.id), answer);
}

/* ---------- 넣기·저장 ---------- */
// 그 갈래 교수안의 간이 교수안을 만들어 넣고 저장한다. 던지지 않고 { ok, briefMd } | { ok: false, stopped?, error }를 돌려준다(교수안은 그대로 둔다)
// note: 작업 기록에 남길 말(버튼에서 간이 교수안만 만들 때)
async function fillGyosuanBrief(mod, trackId = 'basic', { note = '' } = {}) {
    const track = lessonTrack(trackId);
    const docMd = mod?.[track.field]?.docMd;
    if (!docMd) return { ok: false, error: `${track.label} 교수안이 없어 간이 교수안을 만들지 않았습니다.` };
    try {
        setGyosuanProgress(`${track.label} 간이 교수안을 작성하고 있습니다...`);
        const briefMd = await buildGyosuanBrief(mod, track.id, docMd);
        // 기다리는 동안 교수안을 다시 만들었거나 고쳤으면 그 교수안과 맞지 않으므로 넣지 않는다
        if (mod[track.field]?.docMd !== docMd) return { ok: false, error: '만드는 동안 교수안이 바뀌어 간이 교수안을 넣지 않았습니다.' };
        mod[track.field] = { ...mod[track.field], briefMd, updatedAt: new Date().toISOString() };
        if (note && typeof withHistoryNote === 'function') Object.assign(mod, withHistoryNote(mod, note));
        await saveGyosuan(mod);
        return { ok: true, briefMd };
    } catch (err) {
        if (window.isTabGenerationStopped?.()) return { ok: false, stopped: true, error: BRIEF_STOPPED };
        console.error('[간이 교수안] 생성 실패:', err);
        return { ok: false, error: `간이 교수안을 만들지 못했습니다: ${err && err.message ? err.message : err}` };
    }
}

// 그 차시(같은 객체)를 보고 있고 원문 칸에 넣지 않은 글이 없을 때만 교수안 화면을 다시 그린다(쓰던 글이 옛 글로 바뀌지 않게)
function refreshBriefView(mod) {
    if (getEditingModule() !== mod || window.hasPendingGyosuanRaw?.()) return;
    if (typeof refreshGyosuanViews === 'function') refreshGyosuanViews(mod);
}

// 교수안을 만들어 저장한 뒤(gyosuan.js runGyosuanGeneration) 이어서 부른다. 로딩 화면을 띄운 생성은 이 단계에도 중지 단추를 보이고,
// 전체 생성의 교수안 단계(background)는 그 작업의 중지를 따른다. 이미 중지를 눌렀으면 부르지 않는다
async function runGyosuanBriefStep(mod, trackId = 'basic', { background = false } = {}) {
    if (window.isTabGenerationStopped?.()) return { ok: false, stopped: true, error: BRIEF_STOPPED };
    if (!background) window.beginGenerationStop?.(BRIEF_STOP_LABELS);
    try {
        const result = await fillGyosuanBrief(mod, trackId);
        if (result.ok) refreshBriefView(mod);
        return result;
    } finally {
        if (!background) window.endGenerationStop?.();
    }
}

// 교수안을 만든 뒤의 간이 교수안 안내. 만들었으면 ''
function gyosuanBriefNote(brief) {
    if (!brief || brief.ok) return '';
    const reason = String(brief.stopped ? BRIEF_STOPPED : brief.error || '간이 교수안을 만들지 못했습니다.');
    return `${/[.!?。]$/.test(reason) ? reason : `${reason}.`} ${BRIEF_RETRY_HINT}`;
}

/* ---------- 교수안 화면의 '간이 교수안 만들기' ---------- */
const gyosuanBriefBusy = () => !!_gyosuanRunning || document.getElementById('editor-loading')?.style.display === 'flex'
    || !!window.isLessonPipelineRunning?.() || !!window.isVolumeFilling?.();

// 비용·시간 미리 보기(cost-estimate.js)를 보이고 묻는다. 그 파일이 없으면(테스트) 앱의 확인 창만 쓴다
function confirmGyosuanBrief(track) {
    const message = `${track.label} 교수안을 바탕으로 간이 교수안(필수·과제·시간이 되면 권장)을 만듭니다. 교과·일차와 교안 순서·권장 수업 시간은 차시 시간으로 채웁니다.`;
    const opts = { title: `${track.label} 간이 교수안 만들기`, okLabel: '만들기' };
    return typeof confirmWithEstimate === 'function' ? confirmWithEstimate(message, { brief: 1 }, opts) : confirmAsync(message, opts);
}

// 로딩 화면과 중지 단추를 띄우고 간이 교수안만 만든다. 다른 생성이 끼어들지 못하게 교수안 생성 중 표시(_gyosuanRunning)를 함께 쓴다
async function runStandaloneBrief(mod, track) {
    const loading = document.getElementById('editor-loading');
    _gyosuanRunning = true;
    if (loading) loading.style.display = 'flex';
    window.beginGenerationStop?.(BRIEF_STOP_LABELS);
    try {
        return await fillGyosuanBrief(mod, track.id, { note: `${track.label} 간이 교수안 AI 생성` });
    } finally {
        _gyosuanRunning = false;
        if (loading) loading.style.display = 'none';
        window.endGenerationStop?.();
        setGyosuanProgress('AI가 상세 교안을 작성하고 있습니다...');
    }
}

// 알리고 만들지 않는다
const refuseGyosuanBrief = message => {
    window.showAlert(message);
    return false;
};
const BRIEF_BUSY_TEXT = '진행 중인 생성이 끝난 뒤 다시 시도해주세요.';

// trackId: 만들 갈래. 버튼은 화면에서 고른 갈래를 넘긴다. 만들었으면 true
window.generateGyosuanBrief = async function (moduleId, trackId = currentGyosuanTrack()) {
    const mod = getEditingModule(moduleId);
    if (!mod) return refuseGyosuanBrief('교안을 먼저 선택해주세요.');
    const track = lessonTrack(trackId);
    if (!gyosuanOf(mod, track.id)?.docMd) return refuseGyosuanBrief(`먼저 ${track.label} 교수안을 만들어 주세요.`);
    if (gyosuanBriefBusy()) return refuseGyosuanBrief(BRIEF_BUSY_TEXT);
    await window.saveGyosuanRaw?.(); // 원문 칸에 넣지 않은 교수안 글도 담아 만든다
    if (!(await confirmGyosuanBrief(track)) || gyosuanTargetMoved(moduleId, mod)) return false;
    if (gyosuanBriefBusy()) return refuseGyosuanBrief(BRIEF_BUSY_TEXT); // 묻는 동안 다른 생성이 시작됐을 수 있다
    const result = await runStandaloneBrief(mod, track);
    if (result.ok) {
        if (getEditingModule() === mod) window.openGyosuanBriefView?.(mod, track.id);
        window.showToast?.(`${track.label} 간이 교수안을 만들었습니다.`, 'success');
    } else if (result.stopped) {
        window.showToast?.(`${BRIEF_STOPPED} 교수안은 그대로입니다.`, 'warning');
    } else {
        window.showAlert(result.error);
    }
    return result.ok;
};
