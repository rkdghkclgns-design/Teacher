// course-design.js - 과정 설계: 주제와 단원 목록에서 학습모듈 블록을 만들어 교과·차시로 추가한다
// 설계 규칙은 develocket-slide(assets/course-model.js, course-ai.js @3a7303f)를 따르되, 시간은 고정이다:
// 단원(교과) 하나는 정확히 5차시(40시간), 차시(학습모듈) 하나는 하루 8시간(480분, 실습 포함). 과정 전체는 단원 수 × 40시간이다.
// 단원 → 교과, 학습모듈 → 차시로 옮기며, 차시에는 minutes·objectives·flow를 남겨 교안·교수안 생성에 쓴다.

const DESIGN_LESSONS_PER_UNIT = 5;
const DESIGN_LESSON_HOURS = 8;
const DESIGN_LESSON_MINUTES = DESIGN_LESSON_HOURS * 60; // 차시 하나 = 하루 8시간(실습 포함). lesson-lint.js TRACK_DAY_MINUTES와 같다
const DESIGN_UNIT_TOTAL_HOURS = DESIGN_LESSONS_PER_UNIT * DESIGN_LESSON_HOURS; // 단원(교과) 하나 = 40시간
const DESIGN_DEFAULT_HOURS = DESIGN_UNIT_TOTAL_HOURS; // 단원을 아직 적지 않았을 때 총 시간 칸에 보이는 값(단원 1개)
const DESIGN_DAY_FRAME_MINUTES = 30; // 하루 진행 단계의 도입·정리 시간
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
// 실습 시간 칸(차시 정보·일괄 생성 창). 키는 lesson-lint.js PRACTICE_MINUTE_KEYS와 같고 값은 10~600분, 10분 단위 정수다
const LESSON_PRACTICE_FIELDS = [
    { tab: 'basicPrac', key: 'basicPracMinutes', label: '기본실습 시간(분)', name: '기본실습' },
    { tab: 'advPrac', key: 'advPracMinutes', label: '심화실습 시간(분)', name: '심화실습' }
];
const LESSON_GEN_KEYS = ['objectives', 'level', 'length', ...LESSON_PRACTICE_FIELDS.map(field => field.key)]; // 차시 정보 창이 읽는 칸 순서

// 실습 시간을 정하지 않았을 때의 실습 분(lesson-lint.js PRACTICE_DEFAULT_MINUTES). 그 파일을 싣지 않은 화면에서는 0(진행 단계에 실습을 따로 두지 않는다)
const designPracticeMinutes = () => (typeof PRACTICE_DEFAULT_MINUTES === 'number' ? PRACTICE_DEFAULT_MINUTES : 0);

// 실습 시간 칸 아래 안내. 기본값은 실습 탭 지시와 같은 값이다
function practiceInputHint() {
    const practice = designPracticeMinutes();
    return `실습 시간은 10~600분 사이에서 10분 단위로 적습니다. 차시에도 과정에도 정하지 않으면 ${practice}분으로 만듭니다. 차시는 하루 ${DESIGN_LESSON_HOURS}시간(${DESIGN_LESSON_MINUTES}분)이라 학습 탭 낭독은 ${DESIGN_LESSON_MINUTES}분에서 같은 트랙의 실습 시간을 뺀 만큼입니다(기본 ${DESIGN_LESSON_MINUTES - practice}분, 실습이 420분 이상이면 학습은 60분).`;
}

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

// 차시 하루(480분)의 기본 진행 단계: 도입 30분 → 전개(개념) → 전개(실습, 실습 탭 기본 120분) → 정리 30분. 합계 480분, 5분 단위.
// 실습 기본값을 모르는 화면(lesson-lint.js를 싣지 않음)에서는 예전 기본 흐름(defaultFlow)이다
function designDayFlow(title) {
    const practice = designPracticeMinutes();
    if (!practice) return defaultFlow(DESIGN_LESSON_MINUTES, title);
    const concept = DESIGN_LESSON_MINUTES - practice - DESIGN_DAY_FRAME_MINUTES * 2;
    return [
        { phase: '도입', title: '문제 상황 제시와 목표 확인', minutes: DESIGN_DAY_FRAME_MINUTES },
        { phase: '전개', title: `${title} — 개념과 원리`, minutes: concept },
        { phase: '전개', title: `${title} — 적용 실습`, minutes: practice },
        { phase: '정리', title: '목표 확인과 체크리스트', minutes: DESIGN_DAY_FRAME_MINUTES }
    ];
}

// AI 없이도 쓸 수 있는 기본 블록: 단원 하나를 정확히 5차시 × 8시간으로 나눈다
function defaultModules(unitTitle) {
    return DESIGN_MODULE_SUFFIX.slice(0, DESIGN_LESSONS_PER_UNIT).map((label, i) => ({
        title: `${unitTitle} — ${label || `블록 ${i + 1}`}`, minutes: DESIGN_LESSON_MINUTES, objectives: [], flow: designDayFlow(label), isDefault: true
    }));
}

// 진행 단계 시간을 블록 시간에 비례로 맞춘다. 5분 단위로 담을 수 없으면 기본 흐름으로 되돌린다(8시간 차시는 하루 진행 단계)
function fitFlow(flow, minutes, title) {
    if (!flow?.length || flow.length * DESIGN_FLOW_STEP_MINUTES > minutes) return minutes === DESIGN_LESSON_MINUTES ? designDayFlow(title) : defaultFlow(minutes, title);
    const flowMinutes = allocateTime(flow.length, minutes, flow.map(step => Math.max(5, Number(step.minutes) || 5)), 5);
    return flow.map((step, i) => ({ ...step, minutes: flowMinutes[i] }));
}

/* ---------- 5차시로 맞추기 ---------- */
// 나눈 차시에 붙이는 이름: 나눈 수에 맞춰 핵심 개념 … 종합 정리 가운데 고르게 고른다(2개면 핵심 개념·종합 정리)
function splitLabels(parts) {
    const last = DESIGN_MODULE_SUFFIX.length - 1;
    return Array.from({ length: parts }, (_, i) => DESIGN_MODULE_SUFFIX[parts > 1 ? Math.round(i * last / (parts - 1)) : 0]);
}

// 학습 목표를 나눈 차시에 나눠 담는다. 목표가 차시보다 많으면 차례로 묶고, 적으면 이웃한 차시가 같은 목표를 나눠 맡는다(목표는 하나도 버리지 않는다)
function splitObjectives(objectives, parts) {
    const list = objectives || [];
    if (!list.length) return Array.from({ length: parts }, () => []);
    if (list.length >= parts) return Array.from({ length: parts }, (_, j) => list.filter((_, i) => Math.floor(i * parts / list.length) === j));
    return Array.from({ length: parts }, (_, j) => [list[Math.floor(j * list.length / parts)]]);
}

// 블록 하나를 parts개 차시로 나눈다. 진행 단계는 차시마다 새로 매긴다(fitDesignModule)
function splitModule(module, parts) {
    if (parts <= 1) return [module];
    const goals = splitObjectives(module.objectives, parts);
    return splitLabels(parts).map((label, i) => ({ ...module, title: `${module.title} — ${label}`, objectives: goals[i], flow: [], isDefault: false }));
}

// 이웃한 블록을 한 차시로 묶는다. 제목은 ' · '로 잇고, 학습 목표·설명은 모두 남기며, 진행 단계는 첫 도입 → 모든 전개 → 마지막 정리다
function mergeModules(group) {
    if (group.length === 1) return group[0];
    const flows = group.map(module => module.flow || []);
    const intro = flows[0].filter(step => step.phase === '도입');
    const close = flows.at(-1).filter(step => step.phase === '정리');
    return {
        title: group.map(module => module.title).join(' · '),
        description: group.map(module => module.description).filter(Boolean).join(' '),
        minutes: DESIGN_LESSON_MINUTES,
        objectives: [...new Set(group.flatMap(module => module.objectives || []))],
        flow: [...intro, ...flows.flatMap(flow => flow.filter(step => step.phase === '전개')), ...close],
        isDefault: false
    };
}

// 블록 목록을 정확히 5개로 맞춘다. 많으면 차례를 지켜 이웃한 블록을 고르게 묶고, 적으면 긴 블록부터 더 잘게 나눈다
function fitModuleCount(modules, count = DESIGN_LESSONS_PER_UNIT) {
    const list = (modules || []).filter(Boolean);
    if (!list.length || list.length === count) return list;
    if (list.length > count) {
        let start = 0;
        return allocateTime(count, list.length).map(size => mergeModules(list.slice(start, start += size)));
    }
    const parts = allocateTime(list.length, count, list.map(module => Math.max(1, Number(module.minutes) || 1)));
    return list.flatMap((module, i) => splitModule(module, parts[i]));
}

// 차시 하나를 8시간(480분)으로 두고 진행 단계 합계도 480분으로 맞춘다
const fitDesignModule = module => ({ ...module, minutes: DESIGN_LESSON_MINUTES, flow: fitFlow(module.flow, DESIGN_LESSON_MINUTES, module.title) });

// 단원을 늘 5차시 × 8시간(40시간)으로 맞춘다. 기본 블록뿐이면 다시 만들고, 고친 블록·AI 블록은 수를 맞춘 뒤 시간만 맞춘다(목표·제목은 남긴다)
function normalizeDesignUnit(unit) {
    const base = { ...unit, hours: DESIGN_UNIT_TOTAL_HOURS };
    if (!unit.modules?.length || unit.modules.every(module => module.isDefault)) return { ...base, modules: defaultModules(unit.title) };
    return { ...base, modules: fitModuleCount(unit.modules).map(fitDesignModule) };
}

// 단원이 이미 5차시 × 8시간이면 그대로, 아니면 맞춘다(교과로 추가할 때 늘 이 구성으로 넣는다. 고친 진행 단계는 건드리지 않는다)
function enforceUnitShape(unit) {
    const shaped = Number(unit.hours) === DESIGN_UNIT_TOTAL_HOURS && unit.modules?.length === DESIGN_LESSONS_PER_UNIT
        && unit.modules.every(module => Number(module.minutes) === DESIGN_LESSON_MINUTES);
    return shaped ? unit : normalizeDesignUnit(unit);
}

// 과정 전체 시간 = 단원 수 × 40시간
const designCourseHours = unitCount => Math.max(0, Number(unitCount) || 0) * DESIGN_UNIT_TOTAL_HOURS;

// 단원마다 40시간·5차시. requestedHours: 총 시간 칸에 적힌 값(단원 수로 정한 시간과 다르면 화면에 바꾼 까닭을 보인다).
// parsed.hours의 "(N시간)" 표시는 단원 시간이 고정이라 쓰지 않는다
function createCourseDesign(parsed, requestedHours, target) {
    const totalHours = designCourseHours(parsed.units.length);
    const requested = Number(requestedHours) || 0;
    return {
        title: parsed.title, target, goal: '', totalHours,
        ...(requested && requested !== totalHours ? { requestedHours: requested } : {}),
        units: parsed.units.map(title => ({ title, hours: DESIGN_UNIT_TOTAL_HOURS, modules: defaultModules(title) }))
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

// 과정 목표만 묻는다. 시간은 정해져 있다(단원마다 5차시 × 8시간 = 40시간, 과정 = 단원 수 × 40시간)
function buildGoalPrompt(design) {
    return [
        "아래 과정의 '과정 목표'를 제안하세요.",
        "과정 목표는 수료 시점에 도달해야 할 최종 목표를 관찰 가능한 행동으로 1~2문장에 씁니다('~할 수 있습니다').",
        `시간은 정해져 있어 제안하지 않습니다. 단원마다 ${DESIGN_LESSONS_PER_UNIT}차시 × 하루 ${DESIGN_LESSON_HOURS}시간(실습 포함) = ${DESIGN_UNIT_TOTAL_HOURS}시간이고, 과정 전체는 ${designCourseHours(design.units.length)}시간입니다.`,
        '', `[과정] ${design.title}`, `[대상] ${design.target}`, '[단원]',
        design.units.map((unit, i) => `${i + 1}. ${unit.title}`).join('\n'), '',
        'JSON만 출력합니다: {"goal": "..."}'
    ].join('\n');
}

// 단원 하나를 정확히 5개 학습모듈(차시)로 나누게 한다. 차시마다 480분이고 진행 단계는 도입·전개(개념·실습)·정리로 480분을 채운다
function buildUnitPrompt(design, unit) {
    const minutes = DESIGN_LESSON_MINUTES;
    const practice = designPracticeMinutes();
    const concept = minutes - practice - DESIGN_DAY_FRAME_MINUTES * 2;
    return [
        `아래 단원을 학습모듈(교육의 최소 단위 블록) 정확히 ${DESIGN_LESSONS_PER_UNIT}개로 나누세요. 학습모듈 하나가 차시 하나이고, 차시 하나는 하루 ${DESIGN_LESSON_HOURS}시간(${minutes}분) 수업이며 실습을 포함합니다.`,
        `[과정] ${design.title}`, design.goal ? `[과정 목표] ${design.goal}` : '', `[대상] ${design.target}`,
        `[단원] ${unit.title} — ${DESIGN_UNIT_TOTAL_HOURS}시간(${DESIGN_LESSONS_PER_UNIT}차시 × ${DESIGN_LESSON_HOURS}시간)`, '', '[규칙]',
        `- modules는 정확히 ${DESIGN_LESSONS_PER_UNIT}개입니다. 더 적거나 많이 만들지 않습니다. 앞 차시가 다음 차시의 바탕이 되는 순서로 둡니다.`,
        `- 학습모듈마다 minutes는 정확히 ${minutes}분(${DESIGN_LESSON_HOURS}시간)이고, 모든 학습모듈의 minutes 합계는 ${DESIGN_LESSONS_PER_UNIT * minutes}분입니다.`,
        '- 학습모듈은 다른 교과에서도 재사용할 수 있는 독립 블록입니다.',
        "- 학습목표는 블록당 1~3개, '~할 수 있습니다'로 끝나며 관찰 가능한 행동(설명·비교·분류·작성·구현·평가)과 수행 조건·제약을 포함합니다. '이해한다·안다·익힌다'는 쓰지 않습니다.",
        `- flow는 그 차시 하루의 진행 단계로 도입 1개, 전개 2~4개, 정리 1개입니다. 전개에는 개념 설명 단계와 실습 단계를 함께 두고${practice ? `, 실습 단계는 합쳐서 ${practice}분 안팎입니다` : ''}. flow의 minutes는 5분 단위이고 합계는 정확히 ${minutes}분입니다.`,
        '- 전개 단계 title은 실제로 다룰 내용이나 활동을 구체적으로 씁니다.', '',
        'JSON만 출력합니다:',
        `{"modules": [{"title": "...", "minutes": ${minutes}, "objectives": ["..."], "flow": [{"phase": "도입", "title": "...", "minutes": ${DESIGN_DAY_FRAME_MINUTES}}, {"phase": "전개", "title": "...", "minutes": ${practice ? concept : minutes - DESIGN_DAY_FRAME_MINUTES * 2}}, ${practice ? `{"phase": "전개", "title": "... 실습", "minutes": ${practice}}, ` : ''}{"phase": "정리", "title": "...", "minutes": ${DESIGN_DAY_FRAME_MINUTES}}]}]}`
    ].filter(Boolean).join('\n');
}

// AI 답의 블록 → 5차시 × 8시간. 블록 수가 다르면 묶거나 나누고(normalizeDesignUnit), 목표는 남긴다
function parseUnitPlan(parsed, unit) {
    const modules = (parsed?.modules || []).filter(module => module && typeof module === 'object').map(module => ({
        title: String(module.title || unit.title).trim(),
        minutes: Number(module.minutes) || DESIGN_LESSON_MINUTES,
        objectives: (Array.isArray(module.objectives) ? module.objectives : []).map(o => String(o).trim()).filter(Boolean).slice(0, DESIGN_MAX_OBJECTIVES),
        flow: (Array.isArray(module.flow) ? module.flow : []).filter(step => step?.title).map(step => ({
            phase: /도입/.test(step.phase) ? '도입' : /정리/.test(step.phase) ? '정리' : '전개',
            title: String(step.title).trim(),
            minutes: Number(step.minutes) || 10
        }))
    }));
    if (!modules.length) throw new Error(`'${unit.title}' 블록 설계 응답이 비어 있습니다.`);
    return normalizeDesignUnit({ ...unit, modules });
}

// 단원 하나가 실패해도 기본 블록(5차시 × 8시간)으로 남겨 나머지를 계속 설계한다
async function planCourseDesign(design, onProgress = () => {}, isCancelled = () => false) {
    onProgress('과정 목표를 설계하고 있습니다...');
    const plan = await askDesignJson(buildGoalPrompt(design));
    const goal = String(design.goal || plan?.goal || '').trim(); // 사용자가 적은 목표를 AI 제안보다 우선한다
    const units = [];
    let failed = 0;
    for (let i = 0; i < design.units.length && !isCancelled(); i++) {
        const unit = { ...design.units[i], hours: DESIGN_UNIT_TOTAL_HOURS, modules: defaultModules(design.units[i].title) };
        onProgress(`단원 ${i + 1}/${design.units.length} 블록 설계 중... (${unit.title})`);
        try {
            units.push(parseUnitPlan(await askDesignJson(buildUnitPrompt({ ...design, goal }, unit)), unit));
        } catch (err) {
            console.error('[과정 설계] 단원 설계 실패:', unit.title, err);
            failed++;
            units.push(unit);
        }
    }
    return { design: { ...design, totalHours: designCourseHours(design.units.length), goal, units }, failed };
}

/* ---------- AI 차시 목차 (api.js handleGenerate) ---------- */
// 차시 목차 지시(ui.js 'blueprint')의 규칙: 정확히 5차시, 차시마다 하루 8시간(실습 포함)과 학습 목표
function tocPromptRules() {
    return [
        `- 차시 수는 반드시 정확히 ${DESIGN_LESSONS_PER_UNIT}개로 구성하세요. 교과(단원) 하나는 ${DESIGN_LESSONS_PER_UNIT}차시(${DESIGN_UNIT_TOTAL_HOURS}시간)이고, 차시 하나는 하루 ${DESIGN_LESSON_HOURS}시간(${DESIGN_LESSON_MINUTES}분) 수업이며 실습을 포함합니다. 더 적거나 많이 만들지 마세요.`,
        `- 차시마다 "hours"는 ${DESIGN_LESSON_HOURS}입니다. 앞 차시가 다음 차시의 바탕이 되는 순서로 둡니다.`,
        `- 차시마다 "objectives"에 학습 목표를 1~${DESIGN_MAX_OBJECTIVES}개 씁니다. '~할 수 있습니다'로 끝나며 관찰 가능한 행동(설명·비교·분류·작성·구현·평가)과 수행 조건을 담고, '이해한다·안다·익힌다'는 쓰지 않습니다.`
    ].join('\n');
}

// AI 차시 목차 답(배열) → 정확히 5차시 × 8시간 차시. 차시가 많으면 이웃한 차시를 묶고 적으면 나누며, 설명과 학습 목표는 남긴다
function tocLessons(items, firstId) {
    const modules = (Array.isArray(items) ? items : []).filter(item => item && typeof item === 'object' && (item.title || item.description)).map(item => ({
        title: String(item.title || item.description).trim(),
        description: String(item.description || '').trim(),
        minutes: DESIGN_LESSON_MINUTES,
        objectives: (Array.isArray(item.objectives) ? item.objectives : []).map(o => String(o).trim()).filter(Boolean).slice(0, DESIGN_MAX_OBJECTIVES),
        flow: []
    }));
    return fitModuleCount(modules).map((module, i) => moduleToLesson({ ...module, minutes: DESIGN_LESSON_MINUTES, flow: [] }, firstId + i));
}

/* ---------- 교과·차시로 적용 ---------- */
function moduleToLesson(module, id) {
    return {
        id,
        title: module.title,
        description: module.description || module.objectives.join(' ') || module.title,
        hours: Math.round(module.minutes / 60 * 100) / 100,
        minutes: module.minutes,
        objectives: module.objectives,
        flow: module.flow,
        status: 'waiting',
        content: null,
        images: {},
        tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null, advAssessment: null },
        uploadedMdName: null,
        uploadedMdContent: null
    };
}

function unitToSubject(unit, id, firstLessonId, target) {
    return {
        id,
        title: unit.title,
        description: `${target} 대상 ${unit.hours}시간(${unit.modules.length}차시 × 하루 ${DESIGN_LESSON_HOURS}시간) 교과입니다.`,
        namingConvention: '',
        referenceUrls: [],
        referenceText: '',
        autoSlide: false,
        lessonCount: unit.modules.length,
        hasLevelTest: true,
        hours: unit.hours,
        mainQuest: { id: 'mainQuest', title: '👑 최종 평가', description: '모든 차시의 실습을 종합한 최종 평가입니다.', status: 'waiting', content: null, images: {} },
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
        <label onclick="event.stopPropagation()" class="flex items-center gap-1 text-[0.6875rem] text-textMuted" title="차시 시간. 바꾸면 진행 단계 시간도 같은 비율로 맞춥니다.">
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

/* ---------- 실습 시간 ---------- */
const PRACTICE_BUTTON_CLASS = {
    header: 'px-2.5 py-1.5 text-[0.6875rem] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 transition-colors flex items-center gap-1 shrink-0 mr-1 whitespace-nowrap',
    empty: 'mt-3 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors flex items-center gap-1'
};

// 과정 기본 실습 시간(분). 정하지 않았으면 0
const coursePracticeMinutes = key => practiceFieldValue(globalState.courseDesign?.genOptions?.[key]) || 0;

// 실습 탭의 '실습 시간 N분' 단추. place: 'header'(이 탭 생성 옆) | 'empty'(빈 탭 안내의 만들기 단추 아래). 누르면 이 차시의 실습 시간을 바꾼다(changePracticeMinutes).
// 보이는 시간은 차시 값 → 과정 기본값 → 기본 120분 순서다. 머리 줄 단추는 좁은 화면에서 차시 제목을 가리지 않게 짧게 쓰고 긴 글은 title에 둔다.
// 실습 탭이 아니거나 최종 평가면 ''
function practiceTimeButtonHtml(mod, tabId, place = 'header') {
    const field = LESSON_PRACTICE_FIELDS.find(item => item.tab === tabId);
    if (!field || !mod || mod.id === 'mainQuest' || typeof lessonPracticeTime !== 'function') return '';
    const { minutes, from } = lessonPracticeTime(mod, tabId);
    const practice = designPracticeMinutes();
    const text = minutes ? `실습 시간 ${minutes}분${from === 'course' ? '(과정 기본값)' : ''}` : `실습 시간 기본 ${practice}분`;
    const tip = { lesson: '이 차시에서 정한 실습 시간입니다. 눌러서 바꿉니다', course: '과정 기본값입니다. 눌러서 이 차시만 바꿉니다' }[from] || `정하지 않으면 ${practice}분으로 만듭니다. 눌러서 이 차시의 실습 시간을 정합니다`;
    const header = place === 'header';
    const label = header ? `실습 ${minutes ? `${minutes}분` : `기본 ${practice}분`}` : text;
    const id = header ? 'id="lesson-practice-time" ' : '';
    return `<button type="button" ${id}data-practice-lesson="${escapeHtml(String(mod.id))}" data-practice-tab="${field.tab}" onclick="changePracticeMinutes(this.dataset.practiceLesson, this.dataset.practiceTab)" title="${escapeHtml(header ? `${text}. ${tip}` : tip)}" class="${PRACTICE_BUTTON_CLASS[place] || PRACTICE_BUTTON_CLASS.header}"><i class="ph-bold ph-timer"></i> ${escapeHtml(label)}</button>`;
}

const PRACTICE_PROMPT_TRIES = 5; // 받을 수 없는 값을 적으면 그 글을 칸에 둔 채 다시 묻는 횟수(이 뒤에는 알리고 멈춘다)

// 실습 시간을 앱 입력 창으로 묻는다. '120분'처럼 '분'을 붙여 적어도 받고, 받을 수 없는 값이면 적은 글을 칸에 둔 채 까닭을 붙여 다시 묻는다.
// 결과: 분 | null(비움: 이 차시에서 정한 값을 지운다) | undefined(취소했거나 묻는 동안 차시가 바뀜, 끝내 받을 수 없는 값)
async function askPracticeMinutes(field, mod, moduleId, { ask, invalid, placeholder, value }) {
    let typed = value;
    for (let tries = 1; tries <= PRACTICE_PROMPT_TRIES; tries++) {
        const answer = await window.promptAsync(tries > 1 ? `${invalid}\n\n${ask}` : ask, { title: `${field.name} 시간`, okLabel: '저장', placeholder, value: typed });
        if (answer === null || answer === undefined) return undefined;
        if (getEditingModule(moduleId) !== mod) {
            window.showToast?.('묻는 동안 차시가 바뀌어 실습 시간을 바꾸지 않았습니다.', 'warning');
            return undefined;
        }
        const text = String(answer).trim().replace(/\s*분$/, '').trim();
        if (!text) return null;
        const minutes = practiceFieldValue(text);
        if (minutes) return minutes;
        typed = String(answer);
    }
    window.showToast?.(invalid, 'warning');
    return undefined;
}

// 이 차시의 실습 시간을 바꾼다(앱 입력 창). 비우면 이 차시에서 정한 값을 지운다(과정 기본값, 없으면 기본 120분으로 만든다). 10~600분, 10분 단위만 받는다.
// 같은 트랙 학습 탭의 낭독 목표(480 − 실습)도 함께 바뀌므로 알리고, 420분 이상이면 학습 탭이 짧아진다고 경고한다
window.changePracticeMinutes = async function (moduleId, tabId) {
    const field = LESSON_PRACTICE_FIELDS.find(item => item.tab === tabId);
    const mod = getEditingModule(moduleId);
    if (!field || !mod || mod.id === 'mainQuest' || typeof lessonPracticeTime !== 'function') return;
    const { minutes, from } = lessonPracticeTime(mod, tabId);
    const course = coursePracticeMinutes(field.key);
    const fallback = course ? `과정 기본값 ${course}분` : `기본 ${designPracticeMinutes()}분`;
    const value = await askPracticeMinutes(field, mod, moduleId, {
        ask: `이 차시 ${field.name}의 실습 시간을 분으로 적어 주세요. 10분에서 600분 사이, 10분 단위입니다.\n비워 두면 ${fallback}으로 만듭니다. 바꾼 시간은 다음에 ${field.name}을 만들 때부터 씁니다.`,
        invalid: `${field.name} 시간은 10분에서 600분 사이에서 10분 단위로 적어 주세요(예: 120).`,
        placeholder: course ? String(course) : '예: 120',
        value: from === 'lesson' ? String(minutes) : ''
    });
    if (value === undefined) return;
    if (practiceFieldValue(mod.gen?.[field.key]) === value) return;
    Object.assign(mod, { gen: withGenOption(mod.gen, field.key, value) }, withHistoryNote(mod, value ? `${field.name} 시간 ${value}분으로 정함` : `${field.name} 시간 정한 값 지움`));
    await saveState();
    if (getEditingModule() === mod) {
        renderEditor(mod);
        document.getElementById('lesson-practice-time')?.focus?.(); // 다시 그린 단추로 포커스를 돌려준다(키보드로 쓰는 강사가 처음부터 다시 찾지 않게)
    }
    const made = String(mod.tabContents?.[tabId] || '').trim() ? ` 이미 만든 ${field.name}은 바뀌지 않습니다. 새 시간에 맞추려면 '이 탭 생성'으로 다시 만드세요.` : '';
    const long = typeof practiceLongNote === 'function' ? practiceLongNote(tabId, value) : '';
    window.showToast?.(`${value ? `${field.name} 시간을 ${value}분으로 정했습니다.` : `${field.name}에서 정한 시간을 지웠습니다. ${fallback}으로 만듭니다.`}${practiceLearnNote(mod, tabId)}${made}${long ? ` ${long}` : ''}`, long ? 'warning' : 'success');
};

// 실습 시간을 바꾼 뒤 알릴 같은 트랙 학습 탭의 새 낭독 목표. lesson-lint.js를 싣지 않은 화면에서는 ''
function practiceLearnNote(mod, tabId) {
    const learnTab = { basicPrac: 'basicLearn', advPrac: 'advLearn' }[tabId];
    if (!learnTab || typeof learnTargetMinutes !== 'function') return '';
    return ` 하루 ${DESIGN_LESSON_HOURS}시간 가운데 ${learnTab === 'advLearn' ? '심화학습' : '기본학습'} 낭독 목표는 ${learnTargetMinutes(mod, learnTab)}분입니다.`;
}

// 생성 옵션에 실습 시간을 420분 이상으로 적었으면 학습 탭이 짧아진다고 알린다(막지 않는다, lesson-lint.js practiceLongNote). values: { basicPracMinutes, advPracMinutes }
function warnLongPractice(values) {
    if (typeof practiceLongNote !== 'function') return;
    const notes = LESSON_PRACTICE_FIELDS.map(field => practiceLongNote(field.tab, values?.[field.key])).filter(Boolean);
    if (notes.length) window.showToast?.(notes.join(' '), 'warning');
}

// 차시에 툴을 따로 적지 않으면 과정 공통 사용 툴을 쓴다
function lessonTools(mod) {
    return mod.tools?.length ? mod.tools : (globalState.courseDesign?.tools || []);
}

// 차시 옵션이 과정 기본값보다 우선한다
function lessonGenOptions(mod) {
    const own = Object.fromEntries(Object.entries(mod.gen || {}).filter(([, value]) => value));
    return { ...globalState.courseDesign?.genOptions, ...own };
}

// 낭독 분량을 채우는 학습 탭(기본학습·심화학습)인가. lesson-lint.js LEARN_VOLUME_TABS를 따르고, 그 파일을 싣지 않은 화면에서도 두 탭으로 본다
const isLearnTab = tabId => (typeof LEARN_VOLUME_TABS !== 'undefined' ? LEARN_VOLUME_TABS : ['basicLearn', 'advLearn']).includes(tabId);

// 학습 탭(기본학습·심화학습)은 낭독 분량 규칙을 따르므로 섹션당 분량 옵션을 넣지 않는다
function lessonGenLines(mod, tabId = '') {
    const { objectives, level, length } = lessonGenOptions(mod);
    return [
        objectives ? `- 학습 목표 수: ${objectives}개 (정해 둔 학습 목표와 수가 다르면 묶거나 나누어 맞춥니다)` : '',
        level ? `- 학습자 수준: ${level}` : '',
        length && !isLearnTab(tabId) ? `- 학습 내용 섹션 하나당 분량: ${length}` : ''
    ].filter(Boolean).join('\n');
}

// 이어쓰기 청크에는 옵션만 보낸다. 목표·진행 단계까지 다시 주면 앞부분을 되풀이할 수 있다
function lessonGenBrief(mod, tabId = '') {
    const options = lessonGenLines(mod, tabId);
    return options ? `\n\n[생성 옵션 — 반드시 반영]\n${options}` : '';
}

// 실습 시간 값(lesson-lint.js practiceMinutesValue). 그 파일을 싣지 않은 화면에서는 null
const practiceFieldValue = value => (typeof practiceMinutesValue === 'function' ? practiceMinutesValue(value) : null);

function lessonGenFieldsHtml(prefix, values = {}) {
    const current = values && typeof values === 'object' ? values : {};
    const select = (key, label, options, unit = '') => `
        <label class="flex-1 min-w-0 text-[0.6875rem] font-bold text-textMuted">${label}
            <select id="${prefix}-gen-${key}" class="block w-full mt-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white">
                <option value="">지정 안 함</option>
                ${options.map(option => `<option value="${escapeHtml(option)}" ${current[key] === option ? 'selected' : ''}>${escapeHtml(option)}${unit}</option>`).join('')}
            </select>
        </label>`;
    const minutes = field => `
        <label class="flex-1 min-w-0 text-[0.6875rem] font-bold text-textMuted">${field.label}
            <input id="${prefix}-gen-${field.key}" type="number" min="10" max="600" step="10" inputmode="numeric" value="${escapeHtml(String(practiceFieldValue(current[field.key]) || ''))}" placeholder="${designPracticeMinutes() || ''}" class="block w-full mt-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white">
        </label>`;
    return `<div class="flex gap-2">${select('objectives', '학습 목표 수', LESSON_OBJECTIVE_COUNTS, '개')}${select('level', '학습자 수준', LESSON_LEVELS)}${select('length', '섹션당 분량(기본·심화학습 제외)', LESSON_LENGTHS)}</div>
        <div class="flex gap-2 mt-2">${LESSON_PRACTICE_FIELDS.map(minutes).join('')}</div>
        <p class="text-[0.6875rem] text-textMuted mt-1">${practiceInputHint()}</p>`;
}

// 고른 값만 돌려준다. 빈 값을 남기면 차시 저장 때 바뀌지 않은 옵션이 변경 이력에 남는다. 실습 시간은 받을 수 있는 값(10~600분, 10분 단위)만 숫자로 둔다
function readLessonGenFields(prefix) {
    const practiceKeys = LESSON_PRACTICE_FIELDS.map(field => field.key);
    const pairs = LESSON_GEN_KEYS.map(key => {
        const raw = document.getElementById(`${prefix}-gen-${key}`)?.value;
        return [key, practiceKeys.includes(key) ? practiceFieldValue(raw) : raw];
    });
    return Object.fromEntries(pairs.filter(([, value]) => value));
}

// 실습 시간 칸에 적었지만 받을 수 없는 값(10~600분, 10분 단위가 아님)이 든 칸의 이름(기본실습·심화실습)
function invalidPracticeFields(prefix) {
    return LESSON_PRACTICE_FIELDS.filter(field => {
        const input = document.getElementById(`${prefix}-gen-${field.key}`);
        const raw = String(input?.value ?? '').trim();
        return !!input?.validity?.badInput || (!!raw && practiceFieldValue(raw) === null);
    }).map(field => field.name);
}

// 받을 수 없는 실습 시간을 적었으면 알리고 true를 돌려준다(부른 쪽은 저장·시작하지 않는다)
function warnInvalidPracticeFields(prefix) {
    const names = invalidPracticeFields(prefix);
    if (!names.length) return false;
    window.showAlert(`${names.join('·')} 시간은 10분에서 600분 사이에서 10분 단위로 적어 주세요(예: 120). 비워 두면 정하지 않은 것으로 봅니다.`);
    return true;
}

// 생성 옵션 하나를 바꾼 새 객체(빈 값은 뺀다). 칸 순서를 차시 정보 창이 읽는 순서로 맞춰, 바꾸지 않고 저장했을 때 변경 이력이 남지 않게 한다
function withGenOption(gen, key, value) {
    const current = gen && typeof gen === 'object' && !Array.isArray(gen) ? gen : {};
    const merged = { ...current, [key]: value };
    const keys = [...LESSON_GEN_KEYS, ...Object.keys(merged).filter(name => !LESSON_GEN_KEYS.includes(name))];
    return Object.fromEntries(keys.filter(name => merged[name] !== undefined && merged[name] !== null && merged[name] !== '').map(name => [name, merged[name]]));
}

// 학습 탭(기본학습·심화학습)은 차시 시간과 관계없이 하루 8시간에서 같은 트랙 실습 시간을 뺀 낭독 목표 분량(lesson-lint.js learnTargetMinutes)을 지킨다. 진행 단계는 내용 순서만 참고한다.
// 실습 탭은 강사가 정한 실습 시간(정하지 않으면 기본 120분)으로 쓴다(줄이라고 하지 않는다). 탭을 주지 않으면(교수안) 지금과 같다
function lessonDesignTimeLine(mod, tabId = '') {
    if (!mod.minutes) return '';
    const head = `이 차시는 과정 설계에서 ${lessonMinutes(mod)}분으로 배정되었습니다.`;
    if (isLearnTab(tabId)) {
        const target = learnTargetMinutes(mod, tabId);
        const practice = trackPracticeMinutes(mod, tabId === 'advLearn' ? 'advPrac' : 'basicPrac');
        return `${head} ${tabId === 'advLearn' ? '심화' : '기본'} 학습 탭은 차시 시간과 관계없이 하루 ${DESIGN_LESSON_HOURS}시간(${DESIGN_LESSON_MINUTES}분)에서 같은 트랙 실습 ${practice}분을 뺀 낭독 ${target}분(공백 포함 약 ${(target * READ_CHARS_PER_MINUTE).toLocaleString('ko-KR')}자) 분량을 지킵니다. 진행 단계는 내용의 순서를 정하는 데만 참고합니다.`;
    }
    const practice = typeof lessonPracticeMinutes === 'function' ? lessonPracticeMinutes(mod, tabId) : 0;
    if (practice) return `${head} 이 실습 탭은 강사가 정한 ${practice}분 분량으로 씁니다.`;
    if (typeof practiceKeyOf === 'function' && practiceKeyOf(tabId)) return `${head} 이 실습 탭은 하루 ${DESIGN_LESSON_HOURS}시간 가운데 기본 실습 시간 ${designPracticeMinutes()}분 분량으로 씁니다.`;
    return `${head} 지시문의 시간과 분량 기준을 이 시간에 맞게 비례해 줄이세요.`;
}

// 차시에 설계 정보가 있으면 교안 생성 프롬프트에 덧붙인다. tabId: 만드는 탭(교수안처럼 주지 않으면 지금과 같다)
function lessonDesignBrief(mod, tabId = '') {
    if (!mod) return '';
    const learn = isLearnTab(tabId);
    const objectives = (mod.objectives || []).map(o => `- ${o}`).join('\n');
    const flow = (mod.flow || []).map(step => `- ${step.phase}: ${step.title}${learn ? '' : ` (${step.minutes}분)`}`).join('\n');
    const tools = lessonTools(mod).map(tool => `- ${toolLabel(tool)}`).join('\n');
    const prereqs = (mod.prereqs || []).map(item => `- ${item.title}`).join('\n');
    const options = lessonGenLines(mod, tabId);
    const parts = [
        lessonDesignTimeLine(mod, tabId),
        objectives ? `[학습 목표]\n${objectives}` : '',
        flow ? `${learn ? '[진행 단계 — 내용 순서만 참고합니다]' : '[진행 단계]'}\n${flow}` : '',
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
    const blob = new Blob([courseDesignMd()], { type: 'text/markdown;charset=utf-8' });
    const fileName = `${String(globalState.courseTitle).replace(/[^\w가-힣]/g, '_')}_과정설계서.md`;
    // 기본 저장 폴더(save-folder.js)를 골랐으면 그 폴더에, 아니면 브라우저 다운로드로 받는다
    if (typeof saveFileToFolder === 'function') return void saveFileToFolder(blob, fileName).catch(showSaveFailure);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
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
    area.innerHTML = `
        ${designGoalHtml('과정 목표', _designDraft.goal, 'data-design-goal')}
        ${designTotalHtml(_designDraft)}
        ${_designDraft.units.map(designUnitHtml).join('')}`;
}

// 과정 총 시간 줄: 단원 수 × 40시간. 총 시간 칸에 다른 값이 적혀 있었으면 그 값 대신 이 시간을 쓴다고 함께 보인다
function designTotalHtml(draft) {
    const total = designCourseHours(draft.units.length);
    const requested = Number(draft.requestedHours) || 0;
    const replaced = requested && requested !== total ? `<p class="text-[0.6875rem] text-amber-400">적은 총 시간 ${requested}시간 대신 단원 수로 정한 ${total}시간을 씁니다.</p>` : '';
    return `
        <div class="text-xs text-emerald-400">
            <p class="font-bold">과정 총 ${total}시간 = 단원 ${draft.units.length}개 × ${DESIGN_UNIT_TOTAL_HOURS}시간</p>
            <p class="text-[0.6875rem] text-textMuted">단원 하나는 ${DESIGN_LESSONS_PER_UNIT}차시, 차시 하나는 하루 ${DESIGN_LESSON_HOURS}시간(실습 포함)입니다.</p>
            ${replaced}
        </div>`;
}

// 총 시간 칸은 고칠 수 없고, 적은 단원 수 × 40시간을 보인다(단원이 없으면 비운다)
function syncDesignHours() {
    const input = document.getElementById('design-hours');
    const topic = document.getElementById('design-topic');
    if (!input || !topic) return;
    const units = parseTopicInput(topic.value).units.length;
    input.value = units ? String(designCourseHours(units)) : '';
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
    const requested = Math.round(Number(document.getElementById('design-hours')?.value)) || 0; // 과정 총 시간은 단원 수 × 40시간으로 정한다(createCourseDesign)
    const target = document.getElementById('design-target').value.trim() || '직업훈련 수강생';
    return { ...createCourseDesign(parsed, requested, target), goal: carriedDesignGoal(parsed.title) };
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
                <p class="text-xs text-textMuted mt-1">주제와 단원을 적으면 단원마다 ${DESIGN_LESSONS_PER_UNIT}차시 × 하루 ${DESIGN_LESSON_HOURS}시간(실습 포함, ${DESIGN_UNIT_TOTAL_HOURS}시간)으로 쪼개 교과·차시로 추가합니다. 과정 총 시간은 단원 수 × ${DESIGN_UNIT_TOTAL_HOURS}시간입니다. AI 키가 있으면 NCS 능력단위도 함께 배정합니다.</p>
            </div>
            <div class="flex-1 overflow-y-auto p-4 space-y-3">
                <textarea id="design-topic" rows="6" class="w-full px-3 py-2 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-accent" placeholder="주제 입력: 생성형 AI와 UGC 산업의 이해&#10; - 생성형 AI의 종류&#10; - LLM의 동작 원리&#10; - UGC 플랫폼과 저작권"></textarea>
                <div class="flex gap-2">
                    <label class="text-[0.6875rem] text-textMuted" title="단원 하나는 ${DESIGN_LESSONS_PER_UNIT}차시 × 하루 ${DESIGN_LESSON_HOURS}시간입니다. 단원을 적으면 저절로 바뀝니다.">총 시간 (단원 수 × ${DESIGN_UNIT_TOTAL_HOURS}시간)
                        <input id="design-hours" type="number" readonly aria-readonly="true" value="" placeholder="${DESIGN_DEFAULT_HOURS}" class="block w-24 mt-1 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded text-textLight cursor-default">
                    </label>
                    <label class="text-[0.6875rem] text-textMuted flex-1">대상
                        <input id="design-target" value="직업훈련 수강생" class="block w-full mt-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white">
                    </label>
                </div>
                <label class="block text-[0.6875rem] text-textMuted">과정 공통 사용 툴 (이름 | 버전 | 공식 페이지 주소, 한 줄에 하나. 주소는 https만이며 빼도 됩니다. 바로 저장되며, 차시에 따로 적지 않으면 이 값을 씁니다)
                    <textarea id="design-tools" data-design-tools rows="2" class="block w-full mt-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white" placeholder="ChatGPT 웹 | 2026-10 기준">${escapeHtml(designToolLines(globalState.courseDesign?.tools))}</textarea>
                </label>
                <div class="flex gap-2">
                    <button data-design-action="draft" class="px-3 py-1.5 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20" title="AI 없이 단원마다 기본 ${DESIGN_LESSONS_PER_UNIT}차시를 만듭니다">${DESIGN_LESSONS_PER_UNIT}차시로 나누기</button>
                    <button data-design-action="plan" class="px-3 py-1.5 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">AI로 블록 설계</button>
                    <button data-design-action="sample" class="ml-auto px-3 py-1.5 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">예시 넣기</button>
                </div>
                <p id="design-status" class="text-xs text-accent min-h-[1em]"></p>
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
    overlay.addEventListener('input', event => { if (event.target?.id === 'design-topic') syncDesignHours(); });
    document.body.appendChild(overlay);
    renderDesignPreview();
};

// 과정 공통 툴 칸의 글(course-meta.js toolLineText: 이름 | 버전 | 주소)
function designToolLines(tools) {
    return (tools || []).map(toolLineText).join('\n');
}

// 과정 전체에 걸린 값은 초안과 달리 바로 저장한다
function saveCourseDesignField(change) {
    globalState.courseDesign = { ...globalState.courseDesign, ...change };
    saveState();
}

function onDesignChange(event) {
    const { target } = event;
    const data = target.dataset || {};
    if (data.designTools !== undefined) return saveCourseDesignField({ tools: parseToolLines(target.value) });
    if (data.designSavedGoal !== undefined) return saveCourseDesignField({ goal: target.value.trim() });
    if (!_designDraft || _designBusy) return;
    if (data.designGoal !== undefined) _designDraft = { ..._designDraft, goal: target.value.trim(), edited: true };
    if (data.designUnitTitle !== undefined) onDesignUnitTitleChange(target);
    if (data.designField || data.designStep) onDesignFieldChange(target);
}

// 고친 블록이 있으면 다시 나누기 전에 확인한다
async function confirmDesignReset() {
    return !_designDraft?.edited || confirmAsync('직접 고친 블록과 과정 목표 내용이 새 설계로 바뀝니다. 계속할까요?', { title: '과정 설계', okLabel: '새 설계로 바꾸기', tone: 'danger' });
}

// 시간이 맞지 않으면 차시 구성과 교안 지시가 어긋나므로 추가하기 전에 확인한다
async function confirmDesignMismatch() {
    const count = designTimeMismatches(_designDraft);
    return !count || confirmAsync(`시간이 맞지 않는 항목이 ${count}개 있습니다. 그대로 교과로 추가할까요?`, { title: '교과로 추가', okLabel: '그대로 추가', tone: 'primary' });
}

// 확인을 받은 뒤에도 이어 갈 수 있는가. 묻는 동안 대화상자를 닫았거나(닫기는 _designRun을 올린다) 설계가 시작됐으면 멈춘다.
// 초안을 고친 것은 막지 않는다(확인 창으로 포커스가 옮겨 가며 칸에 고쳐 둔 값이 초안에 들어간다. 그 값으로 이어 간다)
async function designConfirmed(ask) {
    const run = _designRun;
    return !!(await ask()) && run === _designRun && !_designBusy;
}

async function onDesignClick(event) {
    const action = event.target.dataset?.designAction;
    if (!action) return;
    if (action === 'close') return closeCourseDesign();
    if (_designBusy) return;
    if (action === 'export') window.downloadCourseDesignMd();
    if (action === 'art') window.openArtStyle();
    if (action === 'sample') {
        document.getElementById('design-topic').value = DESIGN_SAMPLE_TOPIC;
        syncDesignHours();
    }
    if (action === 'sessions') toggleDesignSessions(Number(event.target.dataset.unit));
    const edited = _designDraft && designEditAction(_designDraft, action, event.target.dataset);
    if (edited) {
        _designDraft = edited;
        renderDesignPreview();
    }
    if (action === 'draft' && await designConfirmed(confirmDesignReset)) {
        const draft = readDesignInput();
        if (draft) {
            _designDraft = draft;
            renderDesignPreview();
        }
    }
    if (action === 'plan' && await designConfirmed(confirmDesignReset)) await runDesignPlan(event.target);
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
        setDesignStatus(failed ? `단원 ${failed}개는 기본 ${DESIGN_LESSONS_PER_UNIT}차시로 두었습니다.` : `설계를 마쳤습니다. 단원마다 ${DESIGN_LESSONS_PER_UNIT}차시 × ${DESIGN_LESSON_HOURS}시간입니다. 내용을 고친 뒤 교과로 추가하세요.`);
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
    if (!_designDraft) return window.showAlert(`먼저 ${DESIGN_LESSONS_PER_UNIT}차시로 나누거나 AI로 블록을 설계해주세요.`);
    if (!(await designConfirmed(confirmDesignMismatch)) || !_designDraft) return;
    _designBusy = true;
    button.disabled = true;
    // 단원은 늘 5차시 × 8시간으로 넣고, 과정 총 시간은 단원 수 × 40시간이다(고친 진행 단계는 그대로 둔다)
    const units = _designDraft.units.map(enforceUnitShape);
    const design = { ..._designDraft, units, totalHours: designCourseHours(units.length) };
    const subjects = designSubjects(design);
    const hasContent = globalState.subjects.some(s => (s.lessons || []).some(l => l.content));
    if (!hasContent) globalState.courseTitle = design.title;
    globalState.subjects.push(...subjects);
    globalState.courseDesign = { ...globalState.courseDesign, title: design.title, goal: design.goal, target: design.target, totalHours: design.totalHours };
    const failed = await assignSubjectsNcs(subjects);
    await saveState();
    closeCourseDesign();
    renderOverview();
    const added = `교과 ${subjects.length}개(차시 ${subjects.length * DESIGN_LESSONS_PER_UNIT}개, 과정 총 ${design.totalHours}시간)를 추가했습니다.`;
    if (failed) window.showToast?.(`${added} NCS 자동 배정에 실패한 교과 ${failed}개는 NCS 관리에서 다시 시도해주세요.`, 'warning');
    else window.showToast?.(textModelHasKey() ? added : `${added} NCS는 교과의 NCS 관리에서 선택해주세요.`, 'success');
}

// 설계 초안의 단원 → 교과. 차시 id는 단원을 넘어 이어 붙인다
function designSubjects(design) {
    let lessonId = Date.now();
    return design.units.map((unit, i) => {
        const subject = unitToSubject(unit, `subject_${lessonId}_${i}`, lessonId, design.target);
        lessonId += unit.modules.length;
        return subject;
    });
}
