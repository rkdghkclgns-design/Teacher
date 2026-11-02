// course-design.js - 과정 설계: 주제와 단원 목록에서 시간 배분·학습모듈 블록을 만들어 교과·차시로 추가한다
// 설계 규칙과 시간 배분은 develocket-slide(assets/course-model.js, course-ai.js @3a7303f)를 따른다.
// 단원 → 교과, 학습모듈 → 차시로 옮기며, 차시에는 minutes·objectives·flow를 남겨 교안·교수안 생성에 쓴다.

const DESIGN_DEFAULT_HOURS = 40;
const DESIGN_MODULE_MAX_MINUTES = 180;
const DESIGN_MAX_OBJECTIVES = 3;
const DESIGN_MIN_FLOW_MINUTES = 30;
const DESIGN_FLOW_STEP_MINUTES = 5;
const DESIGN_MODULE_SUFFIX = ['핵심 개념', '구조와 사례', '적용 실습', '심화 활용', '종합 정리'];
const DESIGN_BANNED_VERBS = /(이해한다|이해합니다|안다|익힌다|익힙니다|배운다|배웁니다|알게 된다|알게 됩니다|(?:이해할|알|익힐) 수 있(?:다|습니다))\s*\.?$/;
const DESIGN_BULLET = /^\s*(?:[-*•·]|\d+[.)])\s+/;
const DESIGN_UNIT_HOURS = /\s*\(\s*(\d+)\s*(?:시간|h|H)\s*\)\s*$/;
const DESIGN_SAMPLE_TOPIC = '주제 입력: 생성형 AI와 UGC 산업의 이해\n - 생성형 AI의 종류\n - LLM의 동작 원리\n - UGC 플랫폼 산업의 구조와 크리에이터 이코노미\n - AI 에이전트\n - 이미지, 사운드 생성 등의 AI 도구 생태계\n - AI 생성물의 저작권 및 라이선스';
// 교안 생성 옵션 (develocket-slide assets/course-ai-tb.js @3a7303f). 값을 고르지 않으면 프롬프트에 넣지 않는다.
const LESSON_OBJECTIVE_COUNTS = ['1', '2', '3'];
const LESSON_LEVELS = ['비전공 입문', '기초 문법 이수', '실무 경험자'];
const LESSON_LENGTHS = ['짧게 (약 400자)', '보통 (약 800자)', '길게 (약 1,500자)'];

let _designDraft = null;
let _designRun = 0;
let _designBusy = false;

/* ---------- 입력·시간 배분 ---------- */
function parseTopicLine(raw) {
    const text = raw.replace(DESIGN_BULLET, '').trim();
    const hours = text.match(DESIGN_UNIT_HOURS);
    return {
        indent: (raw.match(/^\s*/) || [''])[0].replace(/\t/g, '    ').length,
        isBullet: DESIGN_BULLET.test(raw),
        label: (text.match(/^(?:과정\s*)?주제(?:\s*입력)?\s*[:：]\s*(.+)$/) || [])[1],
        text: text.replace(DESIGN_UNIT_HOURS, '').trim(),
        hours: hours ? Number(hours[1]) : 0
    };
}

// "주제 입력: 과정명" + 글머리 단원 목록 → { title, units, hours }. 라벨이 없으면 첫 비글머리 줄이 주제다.
// 단원은 가장 바깥 글머리이고 더 들여쓴 줄은 세부 항목이라 제외한다. "(N시간)"은 배분 가중치로 쓴다.
function parseTopicInput(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').filter(raw => raw.trim()).map(parseTopicLine);
    const heading = lines.find(line => line.label) || lines.find(line => !line.isBullet);
    const rest = lines.filter(line => line !== heading && line.text);
    const bullets = rest.filter(line => line.isBullet);
    const pool = bullets.length ? bullets : rest;
    const outer = Math.min(...pool.map(line => line.indent));
    const units = pool.filter((line, i) => line.indent === outer && pool.findIndex(other => other.text === line.text) === i);
    return { title: heading ? (heading.label || heading.text).trim() : '', units: units.map(unit => unit.text), hours: units.map(unit => unit.hours) };
}

// 가중치 비례 + 최대 나머지 방식 정수 배분. 각 항목 최소 1칸, 합계 = total
function allocateTime(count, total, weights, unit = 1) {
    if (count <= 0) return [];
    const slots = Math.round(total / unit);
    const safeWeights = Array.from({ length: count }, (_, i) => (weights && weights[i] > 0 ? weights[i] : 1));
    const weightSum = safeWeights.reduce((a, b) => a + b, 0);
    const raw = safeWeights.map(w => (w / weightSum) * slots);
    const base = raw.map(x => Math.max(1, Math.floor(x)));
    let sum = base.reduce((a, b) => a + b, 0);
    const order = raw.map((x, i) => ({ i, fraction: x - Math.floor(x) })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
    for (let k = 0; sum < slots; k++, sum++) base[order[k % count].i]++;
    while (sum > slots) {
        const largest = base.indexOf(Math.max(...base));
        if (base[largest] <= 1) break;
        base[largest]--;
        sum--;
    }
    return base.map(x => x * unit);
}

function defaultFlow(minutes, title) {
    if (minutes < DESIGN_MIN_FLOW_MINUTES) return [{ phase: '전개', title, minutes }];
    const intro = minutes >= 60 ? Math.max(10, Math.round(minutes * 0.1 / 5) * 5) : 5;
    const body = minutes - intro * 2;
    const middle = body > 90
        ? allocateTime(2, body, [1, 1], 5).map((m, i) => ({ phase: '전개', title: `${title} — ${i ? '적용 실습' : '개념과 원리'}`, minutes: m }))
        : [{ phase: '전개', title, minutes: body }];
    return [{ phase: '도입', title: '문제 상황 제시와 목표 확인', minutes: intro }, ...middle, { phase: '정리', title: '목표 확인과 체크리스트', minutes: intro }];
}

// AI 없이도 쓸 수 있는 기본 블록 분할
function defaultModules(unitTitle, hours) {
    const total = Math.max(1, hours) * 60;
    const count = Math.max(1, Math.ceil(total / DESIGN_MODULE_MAX_MINUTES));
    return allocateTime(count, total, null, 30).map((minutes, i) => {
        const label = count === 1 ? unitTitle : (DESIGN_MODULE_SUFFIX[i] || `블록 ${i + 1}`);
        return { title: count === 1 ? unitTitle : `${unitTitle} — ${label}`, minutes, objectives: [], flow: defaultFlow(minutes, label), isDefault: true };
    });
}

// 진행 단계 시간을 블록 시간에 비례로 맞춘다. 5분 단위로 담을 수 없으면 기본 흐름으로 되돌린다
function fitFlow(flow, minutes, title) {
    if (!flow?.length || flow.length * DESIGN_FLOW_STEP_MINUTES > minutes) return defaultFlow(minutes, title);
    const flowMinutes = allocateTime(flow.length, minutes, flow.map(step => Math.max(5, Number(step.minutes) || 5)), 5);
    return flow.map((step, i) => ({ ...step, minutes: flowMinutes[i] }));
}

// 단원 시간이 바뀌면 블록과 진행 단계 시간을 비례로 맞춘다
function normalizeDesignUnit(unit) {
    const total = Math.max(1, Number(unit.hours) || 1) * 60;
    // 기본 블록은 새 시간에 맞게 다시 나눈다 (블록 3시간 상한 유지). 사용자가 고친 블록은 isDefault가 없어 유지된다.
    if (!unit.modules?.length || unit.modules.every(module => module.isDefault)) return { ...unit, modules: defaultModules(unit.title, unit.hours) };
    const minutes = allocateTime(unit.modules.length, total, unit.modules.map(m => Math.max(5, Number(m.minutes) || 5)), 5);
    const modules = unit.modules.map((module, i) => ({ ...module, minutes: minutes[i], flow: fitFlow(module.flow, minutes[i], module.title) }));
    return { ...unit, modules };
}

function createCourseDesign(parsed, totalHours, target) {
    const hours = allocateTime(parsed.units.length, totalHours, parsed.hours);
    return {
        title: parsed.title, target, goal: '', totalHours,
        units: parsed.units.map((title, i) => ({ title, hours: hours[i], modules: defaultModules(title, hours[i]) }))
    };
}

function designTotalHours(design) {
    return design.units.reduce((sum, unit) => sum + (Number(unit.hours) || 0), 0);
}

function lintObjective(text) {
    const objective = String(text || '').trim();
    if (DESIGN_BANNED_VERBS.test(objective)) return '관찰 가능한 행동으로 바꾸세요';
    if (!/할\s*수\s*(?:있다|있습니다)\.?$/.test(objective)) return '"~할 수 있습니다"로 끝내세요';
    return objective.length < 18 ? '수행 조건을 함께 적으세요' : '';
}

/* ---------- AI 설계 ---------- */
async function askDesignJson(prompt) {
    const data = await callGemini(TEXT_MODEL, {
        taskRole: 'plan',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: `${CONTEXT_CORE.personas.orchestrator} 직업훈련 과정을 설계하고 지정된 JSON만 출력합니다.` }] },
        generationConfig: { responseMimeType: 'application/json' }
    });
    return safeJSONParse(extractText(data));
}

function buildGoalPrompt(design) {
    return [
        "아래 과정의 '과정 목표'와 단원별 시간 배분을 제안하세요.",
        "과정 목표는 수료 시점에 도달해야 할 최종 목표를 관찰 가능한 행동으로 1~2문장에 씁니다('~할 수 있습니다').",
        `시간은 각 단원의 난이도·실습량을 반영한 정수 시간이며 합계가 정확히 ${design.totalHours}시간이어야 합니다.`,
        '', `[과정] ${design.title}`, `[대상] ${design.target}`, '[단원]',
        design.units.map((unit, i) => `${i + 1}. ${unit.title}`).join('\n'), '',
        'JSON만 출력합니다: {"goal": "...", "hours": [정수]}'
    ].join('\n');
}

function buildUnitPrompt(design, unit) {
    return [
        '아래 단원을 학습모듈(교육의 최소 단위 블록)로 나누세요.',
        `[과정] ${design.title}`, design.goal ? `[과정 목표] ${design.goal}` : '', `[대상] ${design.target}`,
        `[단원] ${unit.title} — ${unit.hours}시간`, '', '[규칙]',
        '- 학습모듈은 다른 교과에서도 재사용할 수 있는 독립 블록입니다. 블록 하나는 60~180분입니다.',
        `- 모든 학습모듈의 minutes 합계는 정확히 ${unit.hours * 60}분입니다.`,
        "- 학습목표는 블록당 1~3개, '~할 수 있습니다'로 끝나며 관찰 가능한 행동(설명·비교·분류·작성·구현·평가)과 수행 조건·제약을 포함합니다. '이해한다·안다·익힌다'는 쓰지 않습니다.",
        '- flow는 블록 안의 진행 단계로 도입 1개, 전개 1~4개, 정리 1개입니다. flow의 minutes 합계는 블록 minutes와 같고 5분 단위입니다.',
        '- 전개 단계 title은 실제로 다룰 내용이나 활동을 구체적으로 씁니다.', '',
        'JSON만 출력합니다:',
        '{"modules": [{"title": "...", "minutes": 120, "objectives": ["..."], "flow": [{"phase": "도입", "title": "...", "minutes": 10}]}]}'
    ].filter(Boolean).join('\n');
}

function parseUnitPlan(parsed, unit) {
    const modules = (parsed?.modules || []).map(module => ({
        title: String(module.title || unit.title).trim(),
        minutes: Number(module.minutes) || 60,
        objectives: (module.objectives || []).map(o => String(o).trim()).filter(Boolean).slice(0, DESIGN_MAX_OBJECTIVES),
        flow: (module.flow || []).filter(step => step?.title).map(step => ({
            phase: /도입/.test(step.phase) ? '도입' : /정리/.test(step.phase) ? '정리' : '전개',
            title: String(step.title).trim(),
            minutes: Number(step.minutes) || 10
        }))
    }));
    if (!modules.length) throw new Error(`'${unit.title}' 블록 설계 응답이 비어 있습니다.`);
    return normalizeDesignUnit({ ...unit, modules });
}

// 단원 하나가 실패해도 기본 블록으로 남겨 나머지를 계속 설계한다
async function planCourseDesign(design, onProgress = () => {}, isCancelled = () => false) {
    onProgress('과정 목표와 시간 배분을 설계하고 있습니다...');
    const plan = await askDesignJson(buildGoalPrompt(design));
    const goal = String(design.goal || plan?.goal || '').trim(); // 사용자가 적은 목표를 AI 제안보다 우선한다
    const planned = Array.isArray(plan?.hours) && plan.hours.length === design.units.length
        ? allocateTime(design.units.length, design.totalHours, plan.hours.map(Number))
        : design.units.map(unit => unit.hours);
    const units = [];
    let failed = 0;
    for (let i = 0; i < design.units.length && !isCancelled(); i++) {
        const unit = { ...design.units[i], hours: planned[i], modules: defaultModules(design.units[i].title, planned[i]) };
        onProgress(`단원 ${i + 1}/${design.units.length} 블록 설계 중... (${unit.title})`);
        try {
            units.push(parseUnitPlan(await askDesignJson(buildUnitPrompt({ ...design, goal }, unit)), unit));
        } catch (err) {
            console.error('[과정 설계] 단원 설계 실패:', unit.title, err);
            failed++;
            units.push(unit);
        }
    }
    return { design: { ...design, goal, units }, failed };
}

/* ---------- 교과·차시로 적용 ---------- */
function moduleToLesson(module, id) {
    return {
        id,
        title: module.title,
        description: module.objectives.join(' ') || module.title,
        hours: Math.round(module.minutes / 60 * 100) / 100,
        minutes: module.minutes,
        objectives: module.objectives,
        flow: module.flow,
        status: 'waiting',
        content: null,
        images: {},
        tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null },
        uploadedMdName: null,
        uploadedMdContent: null
    };
}

function unitToSubject(unit, id, firstLessonId, target) {
    return {
        id,
        title: unit.title,
        description: `${target} 대상 ${unit.hours}시간 교과입니다.`,
        namingConvention: '',
        referenceUrls: [],
        referenceText: '',
        autoSlide: false,
        lessonCount: unit.modules.length,
        hasLevelTest: true,
        hours: unit.hours,
        mainQuest: { id: 'mainQuest', title: '👑 메인 퀘스트 (최종 과제)', description: '모든 일일 퀘스트를 종합한 최종 평가입니다.', status: 'waiting', content: null, images: {} },
        lessons: unit.modules.map((module, i) => moduleToLesson(module, firstLessonId + i))
    };
}

// 시간은 사용자가 고칠 수 있는 차시의 시수를 기준으로 삼는다
function lessonMinutes(lesson) {
    return Math.round((Number(lesson.hours) || 0) * 60);
}

// 차시 시간을 5분 단위로 맞추고 진행 단계 합계도 함께 맞춘다. 올바른 값이 아니면 null
function lessonWithHours(lesson, value) {
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours <= 0) return null;
    const minutes = Math.max(1, Math.round(hours * 60 / DESIGN_FLOW_STEP_MINUTES)) * DESIGN_FLOW_STEP_MINUTES;
    const flow = lesson.flow?.length ? fitFlow(lesson.flow, minutes, lesson.title) : lesson.flow;
    return { ...lesson, hours: Math.round(minutes / 60 * 100) / 100, minutes, flow };
}

function lessonHoursChip(mod) {
    return `
        <label onclick="event.stopPropagation()" class="flex items-center gap-1 text-[0.6rem] text-textMuted" title="차시 시간. 바꾸면 진행 단계 시간도 같은 비율로 맞춥니다.">
            <input type="number" min="0.25" step="0.25" value="${escapeHtml(String(mod.hours ?? ''))}" placeholder="-" data-hours-lesson="${escapeHtml(String(mod.id))}" onchange="updateLessonHours(this.dataset.hoursLesson, this.value)" class="w-11 px-1 py-0.5 bg-black/30 border border-white/10 rounded text-white text-right focus:outline-none focus:border-accent">시간
        </label>`;
}

window.updateLessonHours = async function (id, value) {
    const mod = getEditingModule(id);
    if (!mod) return;
    const next = lessonWithHours(mod, value);
    if (!next) window.showToast?.('차시 시간은 0보다 큰 숫자로 입력해주세요.', 'warning');
    else Object.assign(mod, next);
    await saveState();
    renderSidebar();
    if (next && lessonMissingTabs(mod).length < LESSON_TABS.length) window.showToast?.('이미 만든 교안은 바뀌지 않습니다. 새 시간에 맞추려면 다시 생성해주세요.', 'warning');
};

// 차시에 툴을 따로 적지 않으면 과정 공통 사용 툴을 쓴다
function lessonTools(mod) {
    return mod.tools?.length ? mod.tools : (globalState.courseDesign?.tools || []);
}

// 차시 옵션이 과정 기본값보다 우선한다
function lessonGenOptions(mod) {
    const own = Object.fromEntries(Object.entries(mod.gen || {}).filter(([, value]) => value));
    return { ...globalState.courseDesign?.genOptions, ...own };
}

function lessonGenLines(mod) {
    const { objectives, level, length } = lessonGenOptions(mod);
    return [
        objectives ? `- 학습 목표 수: ${objectives}개 (정해 둔 학습 목표와 수가 다르면 묶거나 나누어 맞춥니다)` : '',
        level ? `- 학습자 수준: ${level}` : '',
        length ? `- 학습 내용 섹션 하나당 분량: ${length}` : ''
    ].filter(Boolean).join('\n');
}

// 이어쓰기 청크에는 옵션만 보낸다. 목표·진행 단계까지 다시 주면 앞부분을 되풀이할 수 있다
function lessonGenBrief(mod) {
    const options = lessonGenLines(mod);
    return options ? `\n\n[생성 옵션 — 반드시 반영]\n${options}` : '';
}

function lessonGenFieldsHtml(prefix, values = {}) {
    const select = (key, label, options, unit = '') => `
        <label class="flex-1 min-w-0 text-[0.65rem] font-bold text-textMuted">${label}
            <select id="${prefix}-gen-${key}" class="block w-full mt-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white">
                <option value="">지정 안 함</option>
                ${options.map(option => `<option value="${escapeHtml(option)}" ${values[key] === option ? 'selected' : ''}>${escapeHtml(option)}${unit}</option>`).join('')}
            </select>
        </label>`;
    return `<div class="flex gap-2">${select('objectives', '학습 목표 수', LESSON_OBJECTIVE_COUNTS, '개')}${select('level', '학습자 수준', LESSON_LEVELS)}${select('length', '섹션당 분량', LESSON_LENGTHS)}</div>`;
}

// 고른 값만 돌려준다. 빈 값을 남기면 차시 저장 때 바뀌지 않은 옵션이 변경 이력에 남는다
function readLessonGenFields(prefix) {
    const pairs = ['objectives', 'level', 'length'].map(key => [key, document.getElementById(`${prefix}-gen-${key}`)?.value]);
    return Object.fromEntries(pairs.filter(([, value]) => value));
}

// 차시에 설계 정보가 있으면 교안 생성 프롬프트에 덧붙인다
function lessonDesignBrief(mod) {
    if (!mod) return '';
    const objectives = (mod.objectives || []).map(o => `- ${o}`).join('\n');
    const flow = (mod.flow || []).map(step => `- ${step.phase}: ${step.title} (${step.minutes}분)`).join('\n');
    const tools = lessonTools(mod).map(tool => `- ${toolLabel(tool)}`).join('\n');
    const prereqs = (mod.prereqs || []).map(item => `- ${item.title}`).join('\n');
    const options = lessonGenLines(mod);
    const parts = [
        mod.minutes ? `이 차시는 과정 설계에서 ${lessonMinutes(mod)}분으로 배정되었습니다. 지시문의 시간과 분량 기준을 이 시간에 맞게 비례해 줄이세요.` : '',
        objectives ? `[학습 목표]\n${objectives}` : '',
        flow ? `[진행 단계]\n${flow}` : '',
        tools ? `[사용 툴과 버전]\n${tools}\n버전 번호는 본문에 쓰지 않습니다.` : '',
        prereqs ? `[선행 차시]\n${prereqs}\n선행 내용은 다시 설명하지 않고, 본문에서 다른 차시를 지칭하지 않습니다.` : '',
        options ? `[생성 옵션]\n${options}\n출력 형식과 구성 순서는 바꾸지 않습니다.` : ''
    ].filter(Boolean);
    return parts.length ? `\n\n[과정 설계 — 반드시 반영]\n${parts.join('\n')}` : '';
}

function fmtMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return [hours ? `${hours}시간` : '', rest ? `${rest}분` : ''].filter(Boolean).join(' ') || '0분';
}

const mdCell = text => String(text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const subjectMinutes = subject => subject.lessons.reduce((sum, lesson) => sum + lessonMinutes(lesson), 0);

function courseDesignLessonMd(lesson, subjectNumber, lessonNumber) {
    const lines = [`### 학습모듈 ${subjectNumber}-${lessonNumber}. ${lesson.title} (${fmtMinutes(lessonMinutes(lesson))})`, ''];
    if (lesson.objectives?.length) lines.push('**학습목표**', '', ...lesson.objectives.map((o, i) => `${i + 1}. ${o}`), '');
    if (lesson.flow?.length) lines.push('| 단계 | 내용 | 시간 |', '|---|---|---|', ...lesson.flow.map(s => `| ${s.phase} | ${mdCell(s.title)} | ${fmtMinutes(s.minutes)} |`), '');
    return lines;
}

function courseDesignMd() {
    const design = globalState.courseDesign || {};
    const subjects = globalState.subjects.filter(s => (s.lessons || []).length);
    const total = subjects.reduce((sum, subject) => sum + subjectMinutes(subject), 0);
    const rows = subjects.map((subject, i) => {
        const modules = subject.lessons.map(l => `${mdCell(l.title)}(${fmtMinutes(lessonMinutes(l))})`).join('<br>');
        return `| ${i + 1}. ${mdCell(subject.title)} | ${fmtMinutes(subjectMinutes(subject))} | ${modules} | ${subjectNcsText(subject, '<br>') || '-'} |`;
    });
    return [
        '---', `과정: ${globalState.courseTitle}`, `총 시간: ${fmtMinutes(total)}`, `date: ${new Date().toISOString().slice(0, 10)}`, '---', '',
        `# 과정 설계서 - ${globalState.courseTitle}`, '', '## 과정 목표', '', design.goal || '(과정 목표를 입력하세요)', '',
        '## 단원 구성 한눈에 보기', '', '| 단원 | 시간 | 학습모듈 | NCS 능력단위 |', '|---|---|---|---|', ...rows, `| **합계** | **${fmtMinutes(total)}** |  |  |`, '',
        ...subjects.flatMap((subject, i) => [`## ${i + 1}. ${subject.title}`, '', ...subject.lessons.flatMap((lesson, j) => courseDesignLessonMd(lesson, i + 1, j + 1)), ...subjectSessionLines(subject)])
    ].join('\n');
}

window.downloadCourseDesignMd = function () {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([courseDesignMd()], { type: 'text/markdown;charset=utf-8' }));
    a.download = `${String(globalState.courseTitle).replace(/[^\w가-힣]/g, '_')}_과정설계서.md`;
    a.click();
    URL.revokeObjectURL(a.href);
};

/* ---------- 화면 ---------- */
function renderDesignPreview() {
    const area = document.getElementById('design-preview');
    if (!area) return;
    if (!_designDraft) {
        // 설계 초안이 없으면 이미 추가한 과정의 목표를 고칠 수 있게 둔다
        area.innerHTML = globalState.courseDesign?.title ? designGoalHtml('현재 과정 목표', globalState.courseDesign.goal, 'data-design-saved-goal') : '';
        return;
    }
    const sum = designTotalHours(_designDraft);
    const matched = sum === _designDraft.totalHours;
    area.innerHTML = `
        ${designGoalHtml('과정 목표', _designDraft.goal, 'data-design-goal')}
        <div class="flex items-center gap-2 text-xs ${matched ? 'text-emerald-400' : 'text-amber-400'}">
            <span>합계 ${sum}시간 / 목표 ${_designDraft.totalHours}시간</span>
            ${matched ? '' : '<button data-design-action="fit" class="px-2 py-0.5 rounded bg-white/10 text-textLight font-bold">시간 맞추기</button>'}
        </div>
        ${_designDraft.units.map(designUnitHtml).join('')}`;
}

function setDesignStatus(text) {
    const el = document.getElementById('design-status');
    if (el) el.textContent = text;
}

function readDesignInput() {
    const parsed = parseTopicInput(document.getElementById('design-topic').value);
    if (!parsed.title || !parsed.units.length) {
        window.showAlert('첫 줄에 과정 주제를, 그 아래에 단원을 글머리로 적어주세요.');
        return null;
    }
    const totalHours = Math.max(parsed.units.length, Math.round(Number(document.getElementById('design-hours').value)) || DESIGN_DEFAULT_HOURS);
    const target = document.getElementById('design-target').value.trim() || '직업훈련 수강생';
    return { ...createCourseDesign(parsed, totalHours, target), goal: carriedDesignGoal(parsed.title) };
}

// 같은 과정을 다시 나눌 때는 초안이나 저장된 과정의 목표를 이어받는다
function carriedDesignGoal(title) {
    return [_designDraft, globalState.courseDesign].find(design => design?.title === title)?.goal || '';
}

function designDialogHtml() {
    return `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[760px] max-w-[94vw] max-h-[88vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10">
                <h2 class="text-sm font-bold text-textLight">🧩 과정 설계</h2>
                <p class="text-[0.65rem] text-textMuted mt-1">주제와 단원을 적으면 시간을 나누고 단원을 학습모듈로 쪼개 교과·차시로 추가합니다. AI 키가 있으면 NCS 능력단위도 함께 배정합니다.</p>
            </div>
            <div class="flex-1 overflow-y-auto p-4 space-y-3">
                <textarea id="design-topic" rows="6" class="w-full px-3 py-2 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-accent" placeholder="주제 입력: 생성형 AI와 UGC 산업의 이해&#10; - 생성형 AI의 종류&#10; - LLM의 동작 원리&#10; - UGC 플랫폼과 저작권"></textarea>
                <div class="flex gap-2">
                    <label class="text-[0.65rem] text-textMuted">총 시간
                        <input id="design-hours" type="number" min="1" value="${DESIGN_DEFAULT_HOURS}" class="block w-24 mt-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white">
                    </label>
                    <label class="text-[0.65rem] text-textMuted flex-1">대상
                        <input id="design-target" value="직업훈련 수강생" class="block w-full mt-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white">
                    </label>
                </div>
                <label class="block text-[0.65rem] text-textMuted">과정 공통 사용 툴 (이름 | 버전, 한 줄에 하나. 바로 저장되며, 차시에 따로 적지 않으면 이 값을 씁니다)
                    <textarea id="design-tools" data-design-tools rows="2" class="block w-full mt-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white" placeholder="ChatGPT 웹 | 2026-10 기준">${escapeHtml(designToolLines(globalState.courseDesign?.tools))}</textarea>
                </label>
                <div class="flex gap-2">
                    <button data-design-action="draft" class="px-3 py-1.5 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">시간만 나누기</button>
                    <button data-design-action="plan" class="px-3 py-1.5 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">AI로 블록 설계</button>
                    <button data-design-action="sample" class="ml-auto px-3 py-1.5 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">예시 넣기</button>
                </div>
                <p id="design-status" class="text-[0.65rem] text-accent min-h-[1em]"></p>
                <div id="design-preview" class="space-y-2"></div>
            </div>
            <div class="p-3 border-t border-white/10 flex justify-between gap-2">
                <div class="flex gap-2">
                    <button data-design-action="export" class="px-3 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">현재 과정 설계서 내려받기</button>
                    <button data-design-action="art" class="px-3 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">삽화 스타일</button>
                </div>
                <div class="flex gap-2">
                    <button data-design-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
                    <button data-design-action="apply" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">교과로 추가</button>
                </div>
            </div>
        </div>`;
}

window.openCourseDesign = function () {
    if (document.getElementById('design-dialog')) return;
    _designDraft = null;
    resetDesignSessions();
    const overlay = document.createElement('div');
    overlay.id = 'design-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = designDialogHtml();
    overlay.addEventListener('click', onDesignClick);
    overlay.addEventListener('change', onDesignChange);
    document.body.appendChild(overlay);
    renderDesignPreview();
};

function designToolLines(tools) {
    return (tools || []).map(tool => `${tool.name}${tool.version ? ` | ${tool.version}` : ''}`).join('\n');
}

// 과정 전체에 걸린 값은 초안과 달리 바로 저장한다
function saveCourseDesignField(change) {
    globalState.courseDesign = { ...globalState.courseDesign, ...change };
    saveState();
}

function onDesignHoursChange(target) {
    const hours = Math.max(1, Math.round(Number(target.value)) || 1);
    const index = Number(target.dataset.designHours);
    const units = _designDraft.units.map((unit, i) => (i === index ? normalizeDesignUnit({ ...unit, hours }) : unit));
    _designDraft = { ..._designDraft, units };
    renderDesignPreview();
}

function onDesignChange(event) {
    const { target } = event;
    const data = target.dataset || {};
    if (data.designTools !== undefined) return saveCourseDesignField({ tools: parseToolLines(target.value) });
    if (data.designSavedGoal !== undefined) return saveCourseDesignField({ goal: target.value.trim() });
    if (!_designDraft || _designBusy) return;
    if (data.designGoal !== undefined) _designDraft = { ..._designDraft, goal: target.value.trim(), edited: true };
    if (data.designHours !== undefined) onDesignHoursChange(target);
    if (data.designField || data.designStep) onDesignFieldChange(target);
}

// 고친 블록이 있으면 다시 나누기 전에 확인한다
function confirmDesignReset() {
    return !_designDraft?.edited || confirm('직접 고친 블록과 과정 목표 내용이 새 설계로 바뀝니다. 계속할까요?');
}

// 시간이 맞지 않으면 차시 구성과 교안 지시가 어긋나므로 추가하기 전에 확인한다
function confirmDesignMismatch() {
    const count = designTimeMismatches(_designDraft);
    return !count || confirm(`시간이 맞지 않는 항목이 ${count}개 있습니다. 그대로 교과로 추가할까요?`);
}

async function onDesignClick(event) {
    const action = event.target.dataset?.designAction;
    if (!action) return;
    if (action === 'close') return closeCourseDesign();
    if (_designBusy) return;
    if (action === 'export') window.downloadCourseDesignMd();
    if (action === 'art') window.openArtStyle();
    if (action === 'sample') document.getElementById('design-topic').value = DESIGN_SAMPLE_TOPIC;
    if (action === 'sessions') toggleDesignSessions(Number(event.target.dataset.unit));
    const edited = _designDraft && designEditAction(_designDraft, action, event.target.dataset);
    if (edited) {
        _designDraft = edited;
        renderDesignPreview();
    }
    if (action === 'draft' && confirmDesignReset()) {
        const draft = readDesignInput();
        if (draft) {
            _designDraft = draft;
            renderDesignPreview();
        }
    }
    if (action === 'fit') {
        const hours = allocateTime(_designDraft.units.length, _designDraft.totalHours, _designDraft.units.map(u => u.hours));
        _designDraft = { ..._designDraft, units: _designDraft.units.map((unit, i) => normalizeDesignUnit({ ...unit, hours: hours[i] })) };
        renderDesignPreview();
    }
    if (action === 'plan' && confirmDesignReset()) await runDesignPlan(event.target);
    if (action === 'apply') await applyCourseDesign(event.target);
}

// 닫으면 진행 중인 설계를 버린다. 결과가 다시 연 대화상자를 덮어쓰지 않게 하고 남은 호출도 멈춘다.
function closeCourseDesign() {
    _designRun += 1;
    _designBusy = false;
    document.getElementById('design-dialog')?.remove();
}

async function runDesignPlan(button) {
    const draft = readDesignInput();
    if (!draft) return;
    const run = ++_designRun;
    const isCurrent = () => run === _designRun;
    _designBusy = true;
    button.disabled = true;
    try {
        const { design, failed } = await planCourseDesign(draft, text => isCurrent() && setDesignStatus(text), () => !isCurrent());
        if (!isCurrent()) return;
        _designDraft = design;
        setDesignStatus(failed ? `단원 ${failed}개는 기본 블록으로 두었습니다.` : '설계를 마쳤습니다. 시간을 고친 뒤 교과로 추가하세요.');
        renderDesignPreview();
    } catch (err) {
        console.error('[과정 설계] 실패:', err);
        if (isCurrent()) setDesignStatus(`설계 실패: ${err.message}`);
    } finally {
        if (isCurrent()) {
            _designBusy = false;
            button.disabled = false;
        }
    }
}

// 교과 하나의 배정이 실패해도 나머지 교과를 계속 배정한다
async function assignSubjectsNcs(subjects) {
    let failed = 0;
    for (let i = 0; i < subjects.length; i++) {
        setDesignStatus(`NCS 능력단위 배정 중... (${i + 1}/${subjects.length})`);
        try {
            await autoAssignNcs(subjects[i]);
        } catch (err) {
            console.error('[과정 설계] NCS 자동 배정 실패:', subjects[i].title, err);
            failed += 1;
        }
    }
    return failed;
}

async function applyCourseDesign(button) {
    if (!_designDraft) return window.showAlert('먼저 시간을 나누거나 AI로 블록을 설계해주세요.');
    if (!confirmDesignMismatch()) return;
    _designBusy = true;
    button.disabled = true;
    const design = _designDraft;
    let lessonId = Date.now();
    const subjects = design.units.map((unit, i) => {
        const subject = unitToSubject(unit, `subject_${lessonId}_${i}`, lessonId, design.target);
        lessonId += unit.modules.length;
        return subject;
    });
    const hasContent = globalState.subjects.some(s => (s.lessons || []).some(l => l.content));
    if (!hasContent) globalState.courseTitle = design.title;
    globalState.subjects.push(...subjects);
    globalState.courseDesign = { ...globalState.courseDesign, title: design.title, goal: design.goal, target: design.target, totalHours: design.totalHours };
    const failed = await assignSubjectsNcs(subjects);
    await saveState();
    closeCourseDesign();
    renderOverview();
    if (failed) window.showToast?.(`교과 ${subjects.length}개를 추가했습니다. NCS 자동 배정에 실패한 교과 ${failed}개는 NCS 관리에서 다시 시도해주세요.`, 'warning');
    else if (!textModelHasKey()) window.showToast?.(`교과 ${subjects.length}개를 추가했습니다. NCS는 교과의 NCS 관리에서 선택해주세요.`, 'success');
    else window.showToast?.(`교과 ${subjects.length}개를 추가했습니다.`, 'success');
}
