// 19차 목차·시간 테스트 (실행: node tests/toc-8h.test.js)
// 교과(단원) 하나 = 정확히 5차시, 차시 하나 = 하루 8시간(480분, 실습 포함), 과정 = 단원 수 × 40시간.
// 기본(기본학습+기본실습)·심화(심화학습+심화실습)는 각각 480분이라 학습 탭 낭독 목표 = 480 − 같은 트랙 실습 시간(정하지 않으면 120분 → 360분, 60분 아래로 줄이지 않는다).
// 과정 설계·AI 차시 목차·블록 다시 설계의 5차시 맞추기, 시간 모델, 지시문, 분량 채우기·(⏱) 다시 매기기·탭 위 표시·예고를 실제 파일로 확인한다.
// AI 응답만 스텁이고 키는 쓰지 않으며 네트워크를 부르지 않는다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { loadLessonTracks } = require('./lesson-tracks');

const root = path.join(__dirname, '..', 'js') + path.sep;
const source = file => fs.readFileSync(root + file, 'utf8');
const reply = obj => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }, finishReason: 'STOP' }] });
const plain = value => JSON.parse(JSON.stringify(value));
const call = (ctx, name) => vm.runInContext(name, ctx);
const sum = list => list.reduce((total, value) => total + value, 0);
const FILL_UNIT = '가나다라마바사아자차. ';
const filler = n => FILL_UNIT.repeat(Math.ceil(n / FILL_UNIT.length)).slice(0, n).trim();
const escapeHtml = s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '');

let failed = 0;
let count = 0;
async function run(name, fn) {
    count++;
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (e) {
        failed++;
        console.log(`FAIL - ${name}\n  ${e.stack || e.message}`);
    }
}

function fakeElement() {
    const handlers = {};
    return {
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', title: '', disabled: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener(type, fn) { handlers[type] = fn; },
        fire(type, event) { return handlers[type]?.(event); },
        querySelector: () => fakeElement(), querySelectorAll: () => [],
        remove() { this.removed = true; }
    };
}

// 시간 모델과 과정 설계 함수만 싣는다
function pureContext() {
    const ctx = { console, localStorage: { getItem: () => null, setItem() {} }, globalState: { subjects: [] }, escapeHtml,
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} } };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['data.js', 'lesson-lint.js', 'lesson-editor-tools.js', 'course-design.js', 'course-design-edit.js', 'course-sessions.js', 'cost-estimate.js'].forEach(file => vm.runInContext(source(file), ctx));
    return ctx;
}

// 과정 설계·블록 다시 설계(course-flow.test.js와 같은 파일). AI 답은 ai(프롬프트)로 정한다
const FLOW_FILES = ['kbuilder/ncs-catalog.js', 'ai-errors.js', 'lesson-lint.js', 'lesson-opening.js', 'course-qbank.js', 'lesson-pipeline.js', 'ai-routing.js', 'course-ncs.js', 'course-design.js', 'course-design-edit.js', 'course-sessions.js', 'course-meta.js', 'lesson-editor-tools.js', 'lesson-attachments.js', 'tabs.js', 'course-flow.js', 'course-overview.js'];
function flowContext(ai = async () => { throw new Error('호출되면 안 됨'); }) {
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: fn => { fn(); return 0; }, clearTimeout() {}, Promise, URL, Blob,
        LESSON_TABS: [['basicLearn', '기본 학습'], ['basicPrac', '기본 실습'], ['advLearn', '심화 학습'], ['advPrac', '심화 실습'], ['assessment', '학습 이해도']].map(([id, label]) => ({ id, label })),
        TEXT_MODEL: 'gemini-4-argon', apiKey: '', claudeApiKey: '', isClaudeModel: () => false, needsElementAutoAssign: () => false,
        CONTEXT_CORE: { personas: { orchestrator: '설계자' } },
        globalState: { courseTitle: '과정', subjects: [] },
        courseData: [], currentSubjectId: null, currentEditingModuleId: null,
        alerts: [], toasts: [], prompts: [], archived: [], elements: { 'replan-status': { textContent: '' } },
        escapeHtml, safeJSONParse: t => JSON.parse(t), extractText: d => d.candidates[0].content.parts[0].text,
        document: { getElementById: id => ctx.elements[id] || null, createElement: () => ({}), head: { appendChild() {} }, body: { appendChild() {} } },
        getEditingModule: id => ctx.courseData.find(mod => String(mod.id) === String(id)),
        openEditor() {}, archiveContents: async items => { items.forEach(item => ctx.archived.push(item.title)); },
        saveState: async () => {}, renderSidebar() {}, renderEditor() {}, renderOverview() {}, renderOverviewLNB() {},
        confirmAsync: async () => true,
        callGemini: async (model, payload) => {
            const text = payload.contents[0].parts[0].text;
            ctx.prompts.push(text);
            return ai(text);
        }
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, type) => ctx.toasts.push({ message, type });
    vm.createContext(ctx);
    loadLessonTracks(ctx);
    FLOW_FILES.forEach(file => vm.runInContext(source(file), ctx));
    return ctx;
}

// 실제 지시문 빌더(ui.js)
function promptContext() {
    const ctx = {
        console: { log() {}, warn() {}, error() {} }, JSON, Map, Set, Promise, Date,
        localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, location: { hash: '' },
        document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeElement(), body: { appendChild() {} } },
        globalState: { subjects: [] }, currentSubjectId: null, courseData: [], instructorTone: 'formal',
        getReferenceContext: () => ''
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['data.js', 'lesson-lint.js', 'course-design.js', 'ui.js'].forEach(file => vm.runInContext(source(file), ctx));
    return ctx;
}

// 분량 채우기·탭 생성(lesson-volume.test.js와 같은 화면 흉내). 프롬프트는 '작업|탭|섹션 제목|부탁 글자|목표 분'으로 만들어 스텁이 읽는다
const GEN_FILES = ['data.js', 'ai-errors.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'lesson-fix-run.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js', 'course-design.js', 'course-flow.js', 'lesson-volume.js'];
function genContext() {
    const elements = {};
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        Promise, URL, Uint16Array, Blob, AbortController,
        localStorage: { getItem: () => null, setItem() {} }, escapeHtml,
        saveState: async () => {}, renderEditor() {}, renderSidebar() {}, showLessonView() {},
        archiveContent: async () => {}, currentEditingModuleId: null, needsElementAutoAssign: () => false,
        alerts: [], toasts: [], prompts: [], elements,
        document: {
            readyState: 'complete', hidden: false, title: '',
            body: { appendChild: el => { if (el.id) elements[el.id] = el; } },
            createElement: fakeElement, getElementById: id => elements[id] || null,
            addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => []
        }
    };
    ctx.window = ctx;
    ctx.setTimeout = (fn, ms) => setTimeout(fn, Math.min(ms, 1));
    ctx.clearTimeout = id => clearTimeout(id);
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind });
    vm.createContext(ctx);
    GEN_FILES.forEach(file => vm.runInContext(source(file), ctx));
    vm.runInContext(`buildTaskContext = (task, a) => ({ systemInstruction: '시스템', userPrompt: [task, a.tabId, a.sectionTitle, a.requestChars, a.targetMinutes].join('|') });
        getEditingModule = (id = window.currentMod?.id) => (String(id) === String(window.currentMod?.id) ? window.currentMod : null);
        processImageTags = async (mod, md) => md;
        globalState = { subjects: [] }; currentSubjectId = null; courseData = [];`, ctx);
    // 덜 쓰는 모델 흉내: 첫 생성에는 초안을, 분량 보강에는 부탁 글자의 75%를 돌려준다(api.js callGemini를 덮어쓴다)
    ctx.callGemini = async (model, payload) => {
        const text = payload.contents[0].parts[0].text;
        ctx.prompts.push(text);
        const [task, , , requestChars] = text.split('|');
        if (task !== 'volume_expand') return reply(ctx.draft || '');
        return reply(`### ■ 보강 ${ctx.prompts.length}\n\n${filler(Math.round(Number(requestChars) * 0.75))}`);
    };
    ['editor-loading', 'editor-loading-text', 'editor-loading-stop', 'ai-command-input', 'lesson-volume-chip'].forEach(id => { elements[id] = fakeElement(); });
    return ctx;
}

const LABELS = [60, 60, 45, 60, 60, 45, 60, 60]; // 예전 480분 목표로 쓴 초안의 시간(개요 포함 460분)
const SHORT_LABELS = [20, 20, 15, 20, 20, 15, 20, 20]; // 목표보다 짧게 적은 시간(개요 포함 160분)
// 학습 목표·개요(⏱ 10분)·내용 섹션 8개·체크리스트로 된 초안(섹션마다 body자, 기본 약 2만 자)
function draftMd(labels = LABELS, body = 2400) {
    return [
        '# 📝 반복과 합계',
        '## 학습 목표\n\n- 반복문으로 합계를 구하는 코드를 작성할 수 있습니다.\n- 조건에 맞는 값을 골라 세는 코드를 작성할 수 있습니다.',
        '## 개요 (⏱ 10분)\n\n- 값을 하나씩 더해야 하는 상황입니다.\n- 반복 구조로 해결합니다.',
        ...labels.map((minutes, i) => `## ${i + 1}. 내용 ${i + 1} (⏱ ${minutes}분)\n\n${filler(body)}\n\n<br>`),
        '## ✅ 학습 후 체크리스트\n\n- 합계를 구했습니다. (다시 보기: 1. 내용 1)\n- 값을 골라 셌습니다. (다시 보기: 2. 내용 2)'
    ].join('\n\n');
}

// AI가 보낼 법한 블록 n개. 시간은 일부러 틀리게(90·600분) 준다
const aiModules = n => Array.from({ length: n }, (_, i) => ({
    title: `블록${i + 1}`, minutes: i % 2 ? 600 : 90, objectives: [`목표 ${i + 1}을 작성할 수 있습니다.`],
    flow: [{ phase: '도입', title: '시작', minutes: 10 }, { phase: '전개', title: `본문 ${i + 1}`, minutes: 70 }, { phase: '정리', title: '끝', minutes: 10 }]
}));
// 섹션마다 (⏱) 분(제목 키 → 분)
const labelMap = (ctx, md) => new Map(call(ctx, 'mdSections')(md).map(section => [call(ctx, 'lockTitleKey')(section.title), call(ctx, 'volumeTitleMinutes')(section.title)]));
const shapeOf = modules => modules.map(module => [module.minutes, sum((module.flow || []).map(step => step.minutes))]);
const FIVE_DAYS = Array.from({ length: 5 }, () => [480, 480]);

(async () => {
    const pure = pureContext();

    /* ---------- 시간 모델: 트랙마다 하루 480분 ---------- */
    await run('학습 탭 목표 = 480 − 같은 트랙 실습 시간: 정하지 않으면 실습 120분 → 360분, 기본실습 180분이면 기본학습 300분(심화는 그대로)', () => {
        const target = call(pure, 'learnTargetMinutes');
        assert.deepStrictEqual([call(pure, 'TRACK_DAY_MINUTES'), call(pure, 'PRACTICE_DEFAULT_MINUTES'), call(pure, 'LEARN_TARGET_MINUTES')], [480, 120, 360]);
        assert.deepStrictEqual([target({}, 'basicLearn'), target({}, 'advLearn'), target(null, 'basicLearn')], [360, 360, 360]);
        const mod = { id: 1, gen: { basicPracMinutes: 180 } };
        assert.deepStrictEqual([target(mod, 'basicLearn'), target(mod, 'advLearn')], [300, 360], '트랙마다 따로 센다');
        assert.strictEqual(target({ id: 1, gen: { basicPracMinutes: 95 } }, 'basicLearn'), 360, '받을 수 없는 실습 시간은 정하지 않은 것');
        assert.deepStrictEqual(['basicPrac', 'advPrac', 'assessment'].map(tabId => target(mod, tabId)), [0, 0, 0]);
    });

    await run('학습 탭 목표: 과정 기본값과 저장 전 창의 값도 쓰고 차시 값이 우선하며, 60분 아래로 줄이지 않는다', () => {
        const target = call(pure, 'learnTargetMinutes');
        pure.globalState = { subjects: [], courseDesign: { genOptions: { advPracMinutes: 240 } } };
        assert.deepStrictEqual([target({ id: 1 }, 'advLearn'), target({ id: 1, gen: { advPracMinutes: 60 } }, 'advLearn')], [240, 420], '과정 기본값 240분, 차시 값 60분이 우선');
        assert.strictEqual(target({ id: 1 }, 'basicLearn', { basicPracMinutes: 200 }), 280, '저장 전 일괄 생성 창의 값');
        pure.globalState = { subjects: [] };
        assert.deepStrictEqual([410, 420, 450, 600].map(n => target({ id: 1, gen: { basicPracMinutes: n } }, 'basicLearn')), [70, 60, 60, 60]);
        assert.deepStrictEqual([call(pure, 'learnMinutesFor')(10), call(pure, 'learnMinutesFor')(0), call(pure, 'practicePromptMinutes')(0), call(pure, 'practicePromptMinutes')(180)], [470, 360, 120, 180]);
    });

    await run('실습 420분 이상 경고: 학습 탭이 짧아진다고 알리고, 60분 아래로 줄이지 않아 8시간을 넘으면 그것도 알린다', () => {
        const note = call(pure, 'practiceLongNote');
        assert.deepStrictEqual([note('basicPrac', 410), note('basicPrac', 0), note('basicLearn', 480), note('constructor', 480)], ['', '', '', '']);
        assert.ok(note('basicPrac', 420).startsWith('기본실습을 420분으로 정하면 하루 8시간(480분) 가운데 기본학습 낭독은 60분만 남습니다.') && !note('basicPrac', 420).includes('넘습니다'), note('basicPrac', 420));
        assert.ok(note('advPrac', 450).includes('심화학습 낭독은 60분만 남습니다.') && note('advPrac', 450).includes('60분 아래로 줄이지 않아 하루 8시간(480분)을 넘습니다'), note('advPrac', 450));
        const ctx = flowContext();
        call(ctx, 'warnLongPractice')({ basicPracMinutes: 180, advPracMinutes: 420 });
        assert.ok(ctx.toasts.length === 1 && ctx.toasts[0].type === 'warning' && ctx.toasts[0].message.startsWith('심화실습을 420분으로'), JSON.stringify(ctx.toasts));
        call(ctx, 'warnLongPractice')({ basicPracMinutes: 300 });
        assert.strictEqual(ctx.toasts.length, 1, '420분보다 짧으면 알리지 않는다');
        assert.ok(/warnLongPractice\(next\.gen\)/.test(source('course-meta.js')) && /warnLongPractice\(genOptions\)/.test(source('course-flow.js')), '차시 정보 저장과 남은 차시 생성 시작에서도 알린다');
    });

    await run('실습 시간 안내: 칸 아래 안내·자리 표시·실습 단추·검수 패널이 기본 120분과 학습 360분을 같은 말로 쓴다(옛 90~120분은 없다)', () => {
        const hint = call(pure, 'practiceInputHint')();
        assert.ok(hint.includes('정하지 않으면 120분으로 만듭니다') && hint.includes('기본 360분') && hint.includes('420분 이상이면 학습은 60분'), hint);
        const fields = call(pure, 'lessonGenFieldsHtml')('run', {});
        assert.ok(fields.includes('placeholder="120"') && !fields.includes('90~120'));
        // ui.js는 lesson-lint.js를 싣지 않은 화면의 대체 지시에만 예전 90~120분을 남긴다(아래 '대체 값' 테스트)
        ['course-design.js', 'course-flow.js', 'lesson-review.js', 'lesson-lint.js', 'convention.js', 'tutorial.js'].forEach(file => assert.ok(!source(file).includes('90~120'), `${file}에 90~120분이 남았다`));
    });

    /* ---------- 단원 = 5차시 × 480분 ---------- */
    await run('기본 블록: 단원마다 정확히 5차시 × 480분, 진행 단계는 도입 30·개념 300·실습 120·정리 30분', () => {
        const modules = plain(call(pure, 'defaultModules')('게임 기획'));
        assert.deepStrictEqual(shapeOf(modules), FIVE_DAYS);
        assert.deepStrictEqual(modules[0].flow.map(step => [step.phase, step.minutes]), [['도입', 30], ['전개', 300], ['전개', 120], ['정리', 30]]);
        assert.ok(modules[0].flow[2].title.includes('적용 실습'));
    });

    await run('AI 블록 3·5·7개와 틀린 시간: 늘 5차시 × 480분으로 맞추고(나누거나 이웃끼리 묶는다) 진행 단계 합계도 480분이며 학습 목표를 남긴다', () => {
        const unit = { title: '단원', hours: 7, modules: [] };
        const plan = n => plain(call(pure, 'parseUnitPlan')({ modules: aiModules(n) }, unit));
        [3, 5, 7].forEach(n => {
            const planned = plan(n);
            assert.deepStrictEqual([planned.hours, planned.modules.length, shapeOf(planned.modules)], [40, 5, FIVE_DAYS], `${n}개`);
            const goals = new Set(planned.modules.flatMap(module => module.objectives));
            aiModules(n).forEach(module => assert.ok(goals.has(module.objectives[0]), `${n}개: ${module.objectives[0]}를 남긴다`));
        });
        assert.deepStrictEqual(plan(3).modules.map(module => module.title), ['블록1', '블록2 — 핵심 개념', '블록2 — 적용 실습', '블록2 — 종합 정리', '블록3'], '3개는 AI가 길게 잡은 블록(600분)을 더 잘게 나눈다');
        assert.deepStrictEqual(plan(3).modules.map(module => module.objectives), [['목표 1을 작성할 수 있습니다.'], ['목표 2을 작성할 수 있습니다.'], ['목표 2을 작성할 수 있습니다.'], ['목표 2을 작성할 수 있습니다.'], ['목표 3을 작성할 수 있습니다.']], '나눈 차시도 그 블록의 목표를 지닌다');
        assert.deepStrictEqual(plan(5).modules.map(module => module.title), ['블록1', '블록2', '블록3', '블록4', '블록5'], '5개는 그대로 두고 시간만 맞춘다');
        assert.deepStrictEqual(plan(5).modules[1].flow.map(step => step.title), ['시작', '본문 2', '끝'], 'AI 진행 단계는 남기고 시간만 비례로 맞춘다');
        const seven = plan(7);
        assert.deepStrictEqual(seven.modules.map(module => module.title), ['블록1 · 블록2', '블록3 · 블록4', '블록5', '블록6', '블록7'], '7개는 차례를 지켜 이웃끼리 묶는다');
        assert.deepStrictEqual(seven.modules[0].objectives, ['목표 1을 작성할 수 있습니다.', '목표 2을 작성할 수 있습니다.'], '묶은 차시는 두 블록의 목표를 모두 지닌다');
        assert.deepStrictEqual(seven.modules[0].flow.map(step => step.phase), ['도입', '전개', '전개', '정리'], '묶은 차시는 첫 도입 → 모든 전개 → 마지막 정리');
        assert.throws(() => call(pure, 'parseUnitPlan')({ modules: [] }, unit), /비어 있습니다/, '빈 답은 실패(기본 5차시로 둔다)');
    });

    await run('과정 총 시간 = 단원 수 × 40시간: 적은 총 시간은 덮어쓰고 바꾼 까닭을 보이며, 단원 시간 (N시간) 표시도 쓰지 않는다', () => {
        const parsed = { title: '과정', units: ['가', '나', '다'], hours: [10, 0, 30] };
        const design = plain(call(pure, 'createCourseDesign')(parsed, 100, '수강생'));
        assert.deepStrictEqual([design.totalHours, design.requestedHours, design.units.map(unit => unit.hours), design.units.map(unit => unit.modules.length)], [120, 100, [40, 40, 40], [5, 5, 5]]);
        assert.strictEqual(call(pure, 'designTotalHours')(design), 120);
        const total = call(pure, 'designTotalHtml')(design);
        assert.ok(total.includes('과정 총 120시간 = 단원 3개 × 40시간') && total.includes('단원 하나는 5차시, 차시 하나는 하루 8시간(실습 포함)') && total.includes('적은 총 시간 100시간 대신 단원 수로 정한 120시간을 씁니다.'), total);
        assert.ok(!call(pure, 'designTotalHtml')({ ...design, requestedHours: undefined }).includes('대신'));
        const unit = call(pure, 'designUnitHtml')(design.units[0], 0);
        assert.ok(unit.includes('5차시 × 8시간 = 40시간 ✓') && unit.includes('1차시') && unit.includes('8시간') && unit.includes('1시간 단위 시간표 보기 (40교시)'), unit.slice(0, 400));
    });

    await run('AI 과정 설계: 시간은 묻지 않고 목표만 물으며, 단원마다 블록 수가 달라도 5차시 × 480분이고 과정은 단원 수 × 40시간이다', async () => {
        const counts = { 단원1: 3, 단원2: 7 };
        const ctx = flowContext(async text => {
            if (text.includes("'과정 목표'를 제안하세요")) return reply({ goal: '기획서를 작성할 수 있습니다.', hours: [70, 10] });
            const name = Object.keys(counts).find(title => text.includes(`[단원] ${title} —`));
            return reply({ modules: aiModules(counts[name]) });
        });
        const design = call(ctx, 'createCourseDesign')({ title: '과정', units: ['단원1', '단원2'] }, 40, '수강생');
        const { design: planned, failed: missed } = await call(ctx, 'planCourseDesign')(design);
        const result = plain(planned);
        assert.deepStrictEqual([missed, result.totalHours, result.units.map(unit => unit.hours), result.units.map(unit => shapeOf(unit.modules))], [0, 80, [40, 40], [FIVE_DAYS, FIVE_DAYS]], 'AI가 시간을 나눠 보내도 따르지 않는다');
        const [goalPrompt, unitPrompt] = ctx.prompts;
        assert.ok(goalPrompt.includes('시간은 정해져 있어 제안하지 않습니다. 단원마다 5차시 × 하루 8시간(실습 포함) = 40시간이고, 과정 전체는 80시간입니다.') && goalPrompt.includes('JSON만 출력합니다: {"goal": "..."}') && !goalPrompt.includes('"hours"'), goalPrompt);
        ['학습모듈(교육의 최소 단위 블록) 정확히 5개로 나누세요', '차시 하나는 하루 8시간(480분) 수업이며 실습을 포함합니다', '[단원] 단원1 — 40시간(5차시 × 8시간)', 'modules는 정확히 5개입니다. 더 적거나 많이 만들지 않습니다.',
            '학습모듈마다 minutes는 정확히 480분(8시간)이고, 모든 학습모듈의 minutes 합계는 2400분입니다.', '도입 1개, 전개 2~4개, 정리 1개', '전개에는 개념 설명 단계와 실습 단계를 함께 두고, 실습 단계는 합쳐서 120분 안팎입니다', 'flow의 minutes는 5분 단위이고 합계는 정확히 480분입니다.',
            '"minutes": 480', '{"phase": "전개", "title": "... 실습", "minutes": 120}'].forEach(part => assert.ok(unitPrompt.includes(part), part));
        ['60~180분', '1~4개'].forEach(part => assert.ok(!unitPrompt.includes(part), part));
    });

    await run('교과로 추가: 예전 초안(차시 수·시간이 다른 단원)도 5차시 × 8시간 교과로 넣고, 과정 목표 시간은 단원 수 × 40시간이다', async () => {
        const ctx = flowContext();
        vm.runInContext("_designDraft = createCourseDesign({ title: '과정', units: ['가', '나'] }, 40, '수강생')", ctx);
        vm.runInContext("_designDraft = { ..._designDraft, units: [{ ..._designDraft.units[0], hours: 6, modules: [{ title: '옛 블록', minutes: 360, objectives: ['옛 목표를 설명할 수 있습니다.'], flow: [] }] }, _designDraft.units[1]] }", ctx);
        await call(ctx, 'applyCourseDesign')({ disabled: false });
        const subjects = plain(ctx.globalState.subjects);
        assert.deepStrictEqual(subjects.map(subject => [subject.hours, subject.lessonCount, subject.lessons.map(lesson => lesson.hours)]), [[40, 5, [8, 8, 8, 8, 8]], [40, 5, [8, 8, 8, 8, 8]]]);
        assert.ok(subjects[0].lessons.every(lesson => lesson.objectives[0] === '옛 목표를 설명할 수 있습니다.' && sum(lesson.flow.map(step => step.minutes)) === 480), '옛 블록을 나눠도 목표를 지닌다');
        assert.ok(subjects[0].description.includes('40시간(5차시 × 하루 8시간)'));
        assert.strictEqual(ctx.globalState.courseDesign.totalHours, 80);
        assert.ok(ctx.toasts.at(-1).message.startsWith('교과 2개(차시 10개)를 추가했습니다. 과정 총 80시간(단원 2개 × 40시간)입니다.'), ctx.toasts.at(-1).message);
        assert.ok(call(ctx, 'lessonHoursChip')(subjects[0].lessons[0]).includes('value="8"'), '차시 시간 칸에 8시간');
        assert.ok(call(ctx, 'courseDesignMd')().includes('총 시간: 80시간') && call(ctx, 'courseDesignMd')().includes('### 시간표 (1교시 = 1시간)'), '과정 설계서');
    });

    /* ---------- 다른 목차 만들기 ---------- */
    await run('AI 차시 목차(차시 목차 만들기): 답의 차시가 3·5·7개여도 5차시 × 8시간이고, 설명과 학습 목표를 남긴다', () => {
        const items = n => Array.from({ length: n }, (_, i) => ({ title: `차시${i + 1}`, description: `설명${i + 1}`, objectives: [`목표${i + 1}`], hours: i + 1 }));
        [3, 5, 7].forEach(n => {
            const lessons = plain(call(pure, 'tocLessons')(items(n), 100));
            assert.deepStrictEqual([lessons.length, lessons.map(lesson => lesson.hours), lessons.map(lesson => lesson.minutes), lessons.map(lesson => lesson.id)], [5, [8, 8, 8, 8, 8], [480, 480, 480, 480, 480], [100, 101, 102, 103, 104]], `${n}개`);
            const goals = lessons.flatMap(lesson => lesson.objectives);
            items(n).forEach(item => assert.ok(goals.includes(item.objectives[0]), `${n}개: ${item.objectives[0]}`));
        });
        const seven = plain(call(pure, 'tocLessons')(items(7), 1));
        assert.deepStrictEqual([seven[0].title, seven[0].description], ['차시1 · 차시2', '설명1 설명2']);
        const three = plain(call(pure, 'tocLessons')(items(3), 1));
        assert.deepStrictEqual([three[0].title, three[0].description, three[0].status], ['차시1 — 핵심 개념', '설명1', 'waiting']);
        assert.deepStrictEqual(plain(call(pure, 'tocLessons')([null, {}, 'x'], 1)), [], '읽을 차시가 없으면 빈 목록');
        const handled = source('api.js');
        assert.ok(handled.includes('tocLessons(parsed, Date.now())') && !handled.includes('hours: item.hours || 2'), 'handleGenerate가 5차시로 맞춘다');
    });

    await run('AI 차시 목차 지시: 차시 수를 고르지 않고 정확히 5개, 차시마다 하루 8시간(실습 포함)과 학습 목표를 묻는다', () => {
        const promptCtx = promptContext();
        const { systemInstruction, userPrompt } = call(promptCtx, 'buildTaskContext')('blueprint', '게임 기획');
        ['차시 수는 반드시 정확히 5개로 구성하세요. 교과(단원) 하나는 5차시(40시간)이고, 차시 하나는 하루 8시간(480분) 수업이며 실습을 포함합니다.', '"hours"는 8입니다', '"objectives"에 학습 목표를 1~3개', '"hours": 8}]']
            .forEach(part => assert.ok(systemInstruction.includes(part), part));
        assert.ok(userPrompt.includes('주제: 게임 기획') && userPrompt.includes('생성할 차시 수: 5개 (반드시 이 수만큼 생성, 차시마다 하루 8시간·실습 포함)'), userPrompt);
        const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        assert.ok(html.includes('5차시 × 8시간') && !html.includes('id="sidebar-batch-count"') && !source('ui.js').includes('sidebar-batch-count'), '사이드바의 차시 수 칸을 없앴다');
    });

    await run('블록 다시 설계: 교과 시간 칸 없이 늘 40시간으로 묻고, AI 블록이 7개여도 5차시 × 8시간으로 바꾼다', async () => {
        const ctx = flowContext(async () => reply({ modules: aiModules(7) }));
        const subject = { id: 's1', title: '교과', hours: 3, lessons: [{ id: 1, title: '옛 차시', hours: 3, tabContents: {} }], mainQuest: { id: 'mainQuest' } };
        Object.assign(ctx, { currentSubjectId: 's1', courseData: subject.lessons });
        ctx.globalState.subjects = [subject];
        ctx.globalState.courseDesign = { title: '게임 과정', target: '입문자' };
        await call(ctx, 'runSubjectReplan')({ disabled: false }, subject);
        assert.deepStrictEqual([subject.hours, subject.lessonCount, plain(subject.lessons).map(lesson => lesson.hours)], [40, 5, [8, 8, 8, 8, 8]]);
        assert.ok(ctx.prompts[0].includes('[단원] 교과 — 40시간(5차시 × 8시간)') && ctx.prompts[0].includes('modules는 정확히 5개'), ctx.prompts[0]);
        assert.ok(ctx.toasts[0].message.startsWith('새 블록 5개(차시마다 8시간, 교과 40시간)로 바꿨습니다.'), ctx.toasts[0].message);
        assert.ok(!source('course-flow.js').includes("getElementById('replan-hours')"), '교과 시간 칸을 읽지 않는다');
    });

    /* ---------- 지시문의 시간 ---------- */
    await run('지시: 실습 탭은 정하지 않으면 기본 120분, 학습 탭은 받은 목표(480 − 실습)로 낭독 분량을 준다', () => {
        const promptCtx = promptContext();
        const build = (task, args) => call(promptCtx, 'buildTaskContext')(task, { title: '반복', description: '반복', keyConcepts: [], ...args });
        const prac = build('tab_content', { tabId: 'basicPrac', tabLabel: '기본실습' }).userPrompt;
        ['[시간 배분 — 이 탭: 120분]', '합계가 정확히 120분이 되게 하세요.'].forEach(part => assert.ok(prac.includes(part), part));
        const learn = build('tab_content', { tabId: 'basicLearn', tabLabel: '기본학습', targetMinutes: 300 }).userPrompt;
        ['이 탭 하나가 곧 300분 본과정입니다', '300분은 75,000자 이상입니다.', '300분 이상 330분 이하'].forEach(part => assert.ok(learn.includes(part), part));
        assert.ok(build('tab_content', { tabId: 'advLearn', tabLabel: '심화학습' }).userPrompt.includes('360분은 90,000자 이상입니다.'), '목표를 모르면 360분');
        const brief = call(pure, 'lessonDesignBrief');
        const lesson = { minutes: 480, hours: 8, gen: { basicPracMinutes: 180 } };
        assert.ok(brief(lesson, 'basicLearn').includes('이 차시는 과정 설계에서 480분으로 배정되었습니다. 기본 학습 탭은 차시 시간과 관계없이 하루 8시간(480분)에서 같은 트랙 실습 180분을 뺀 낭독 300분(공백 포함 약 75,000자) 분량을 지킵니다.'), brief(lesson, 'basicLearn'));
        assert.ok(brief(lesson, 'basicPrac').includes('이 실습 탭은 강사가 정한 180분 분량으로 씁니다.') && brief(lesson, 'advPrac').includes('기본 실습 시간 120분 분량으로 씁니다.'));
        assert.ok(call(promptCtx, 'CONTEXT_CORE').rules.glossary_terms.includes('5차시(40시간)') && call(promptCtx, 'CONTEXT_CORE').rules.glossary_terms.includes('1일 수업(8시간)'), '용어 정리도 5차시 × 8시간');
    });

    /* ---------- 분량 채우기·(⏱)·탭 위 표시·예고 ---------- */
    await run('분량 채우기: 기본실습 180분인 차시의 기본학습은 300분까지 채우고 목표보다 짧게 적은 (⏱)는 300분까지 올린다. 정하지 않으면 360분', async () => {
        const ctx = genContext();
        const mod = { id: 1, title: '반복과 합계', description: '합계', gen: { basicPracMinutes: 180 } };
        const result = plain(await call(ctx, 'ensureSpokenVolume')({ mod, tabId: 'basicLearn', md: draftMd(SHORT_LABELS) }));
        assert.deepStrictEqual([result.targetMinutes, result.targetChars, result.reason, result.short], [300, 75000, 'target', false]);
        assert.strictEqual(call(ctx, 'volumeLabelSum')(result.md), 300, '(⏱) 합계는 새 목표');
        assert.ok(ctx.prompts.every(text => text.endsWith('|300')) && ctx.prompts.length <= 15, `호출 상한은 75,000자 ÷ 5,000 = 15번: ${ctx.prompts.length}`);
        const plainCtx = genContext();
        const fallback = plain(await call(plainCtx, 'ensureSpokenVolume')({ mod: { id: 2, title: '반복' }, tabId: 'advLearn', md: draftMd(SHORT_LABELS) }));
        assert.deepStrictEqual([fallback.targetMinutes, call(plainCtx, 'volumeLabelSum')(fallback.md)], [360, 360]);
        assert.strictEqual(call(ctx, 'volumeLabelSum')(call(ctx, 'retimeVolumeChoice')(draftMd(SHORT_LABELS), { targetMinutes: call(ctx, 'learnTargetMinutes')(mod, 'basicLearn') })), 300, '미리 보기에서 고른 글도 목표보다 짧으면 새 목표까지 올린다');
    });

    await run('탭 생성·탭 위 표시·검수 패널: 학습 탭 목표가 그 트랙 실습 시간을 따른다', async () => {
        const ctx = genContext();
        const mod = { id: 1, title: '반복', description: '반복', gen: { advPracMinutes: 240 }, tabContents: { basicLearn: `## 1. 내용 (⏱ 60분)\n\n${filler(70000)}`, advLearn: `## 1. 심화 (⏱ 60분)\n\n${filler(70000)}` } };
        ctx.currentMod = mod;
        vm.runInContext("currentLessonTab = 'basicLearn'; _lessonPanel = null;", ctx);
        const chip = ctx.elements['lesson-volume-chip'];
        call(ctx, 'syncVolumeChip')(mod);
        assert.ok(chip.innerHTML.includes('낭독 약 280분 / 목표 360분') && chip.innerHTML.includes('분량 채우기'), chip.innerHTML);
        vm.runInContext("currentLessonTab = 'advLearn'", ctx);
        call(ctx, 'syncVolumeChip')(mod);
        assert.ok(chip.innerHTML.includes('낭독 약 280분 / 목표 240분') && !chip.innerHTML.includes('<button'), '심화실습 240분이면 심화학습 240분이라 이미 찼다');
        assert.ok(call(ctx, 'reviewPanelHtml')(mod, 'advLearn', mod.tabContents.advLearn, false).includes(' · 낭독 약 280분(목표 240분)'));
        // 탭 생성은 그 목표를 지시에 넘긴다(스텁 프롬프트 끝 칸)
        const gen = genContext();
        gen.currentMod = { id: 1, title: '반복', description: '반복', gen: { basicPracMinutes: 180 }, tabContents: {} };
        gen.draft = `${draftMd(SHORT_LABELS)}\n<!-- END -->`;
        await call(gen, 'generateTabContent')(1, 'basicLearn', { quiet: true });
        assert.ok(gen.prompts[0].startsWith('tab_content|basicLearn|') && gen.prompts[0].includes('|300'), gen.prompts[0].slice(0, 80));
        assert.strictEqual(call(gen, 'volumeLabelSum')(gen.currentMod.tabContents.basicLearn), 300);
    });

    /* ---------- 검토 반영: 예전 480분 탭의 (⏱)는 깎지 않는다 ---------- */
    await run('예전 480분 탭: 이미 목표(360분)를 넘는 탭은 분량 채우기·미리 보기 반영·다시 붙이기에서 (⏱)를 그대로 둔다', async () => {
        const ctx = genContext();
        const full = draftMd(LABELS, 12000); // 낭독 약 384분, 시간은 예전 480분 기준(460분)
        const result = plain(await call(ctx, 'ensureSpokenVolume')({ mod: { id: 1, title: '반복' }, tabId: 'basicLearn', md: full }));
        assert.deepStrictEqual([result.targetMinutes, result.added, result.reason, ctx.prompts.length], [360, 0, 'target', 0], '채울 것이 없다');
        assert.deepStrictEqual([...labelMap(ctx, result.md)], [...labelMap(ctx, full)], '(⏱)를 360분으로 다시 매기지 않는다');
        assert.strictEqual(call(ctx, 'volumeLabelSum')(call(ctx, 'retimeVolumeChoice')(full, { targetMinutes: 360 })), 460, '미리 보기에서 고른 글도 목표 이상이면 그대로');
        assert.strictEqual(call(ctx, 'rebaseVolumeParts')(full, [], { targetMinutes: 360 }), full, '붙일 소주제가 없으면 그대로');
        const chip = ctx.elements['lesson-volume-chip'];
        vm.runInContext("currentLessonTab = 'basicLearn'; _lessonPanel = null;", ctx);
        call(ctx, 'syncVolumeChip')({ id: 1, title: '반복', tabContents: { basicLearn: full } });
        assert.ok(chip.className.includes('emerald') && chip.innerHTML.includes('/ 목표 360분') && !chip.innerHTML.includes('<button'), `탭 위 표시는 목표를 넘어도 모자라다고 하지 않는다: ${chip.innerHTML}`);
        assert.ok(plain(call(ctx, 'lintLessonMarkdown')(full, 'basicLearn')).every(issue => !/⏱|낭독|분량/.test(`${issue.msg}`)), '검수도 목표를 넘는 시간을 지적하지 않는다');
    });

    await run('분량 채우기로 글을 붙여도 섹션마다 적힌 (⏱) 아래로는 줄이지 않는다(합계는 목표 이상). 줄이지 않기는 분량 채우기에서만 켠다', async () => {
        const ctx = genContext();
        const short = draftMd(); // 시간은 460분인데 글은 낭독 약 77분
        const result = plain(await call(ctx, 'ensureSpokenVolume')({ mod: { id: 1, title: '반복' }, tabId: 'basicLearn', md: short }));
        assert.ok(result.added > 0 && result.spoken >= 360 * 250, '목표까지 채웠다');
        const before = labelMap(ctx, short);
        const after = labelMap(ctx, result.md);
        [...before].forEach(([key, minutes]) => assert.ok(after.get(key) >= minutes, `${key}: ${after.get(key)} < ${minutes}`));
        assert.ok(call(ctx, 'volumeLabelSum')(result.md) >= 460);
        const rebased = call(ctx, 'rebaseVolumeParts')(short, result.parts, { targetMinutes: 360 });
        [...labelMap(ctx, short)].forEach(([key, minutes]) => assert.ok(labelMap(ctx, rebased).get(key) >= minutes, `다시 붙인 글 ${key}`));
        const retime = (keepWritten) => labelMap(ctx, call(ctx, 'retimeSections')(short, 360, new Set(), 'basicLearn', { keepWritten }));
        assert.ok([...before].every(([key, minutes]) => retime(true).get(key) >= minutes) && [...before].some(([key, minutes]) => retime(false).get(key) < minutes), '직접 부르는 retimeSections는 예전처럼 목표에 맞춰 줄일 수 있다');
    });

    /* ---------- 검토 반영: 과정 총 시간과 시간 맞추기 ---------- */
    const fiveDays = (id, title = `교과 ${id}`) => ({ id, title, lessons: Array.from({ length: 5 }, (_, i) => ({ id: `${id}_${i}`, title: `${title} ${i + 1}`, hours: 8, minutes: 480 })) });

    await run('교과로 추가를 다시 해도 과정 총 시간은 모든 단원 × 40시간이고, 과정 시간 막대는 맞추기 단추 없이 규칙을 보인다', async () => {
        const ctx = flowContext();
        ctx.globalState.subjects = [fiveDays('a'), fiveDays('b'), fiveDays('c')];
        ctx.globalState.courseDesign = { title: '과정', totalHours: 120 };
        vm.runInContext("_designDraft = createCourseDesign({ title: '과정', units: ['새 단원'] }, 40, '수강생')", ctx);
        await call(ctx, 'applyCourseDesign')({ disabled: false });
        assert.deepStrictEqual([ctx.globalState.subjects.length, ctx.globalState.courseDesign.totalHours], [4, 160], '이번에 더한 40시간만이 아니다');
        assert.ok(ctx.toasts.at(-1).message.startsWith('교과 1개(차시 5개)를 추가했습니다. 과정 총 160시간(단원 4개 × 40시간)입니다.'), ctx.toasts.at(-1).message);
        const bar = call(ctx, 'renderCourseTimeBar')();
        assert.ok(bar.includes('합계 160시간 / 목표 160시간') && bar.includes('목표 = 단원 4개 × 40시간(1단원 = 5차시 × 하루 8시간)') && !bar.includes('fitSubjectHours'), bar);
    });

    await run('과정 목표는 저장된 옛 총 시간이 아니라 단원 수 × 40시간이고, 맞추기는 확인 뒤 40시간이 아닌 교과만 맞추며 5차시 × 8시간 교과는 그대로 둔다', async () => {
        const ctx = flowContext();
        const shaped = fiveDays('a', '설계');
        const shapedLessons = shaped.lessons;
        const old = { id: 'b', title: '예전', lessons: [{ id: 'mainQuest', title: '퀘스트' }, { id: 1, title: '가', hours: 3, flow: [{ phase: '전개', title: '본문', minutes: 180 }] }, { id: 2, title: '나', hours: 1 }] };
        ctx.globalState.subjects = [shaped, old];
        ctx.globalState.courseDesign = { totalHours: 44 }; // 저장된 옛 총 시간(지금 합계와 같다)
        assert.strictEqual(call(ctx, 'courseTargetMinutes')(), 80 * 60, '단원 2개 × 40시간');
        assert.ok(call(ctx, 'renderCourseTimeBar')().includes('합계 44시간 / 목표 80시간') && call(ctx, 'renderCourseTimeBar')().includes('fitSubjectHours'));
        const confirms = [];
        ctx.showConfirm = (message, onConfirm) => confirms.push({ message, onConfirm });
        call(ctx, 'fitSubjectHours')();
        assert.ok(confirms.length === 1 && confirms[0].message.includes('40시간이 아닌 교과 1개') && confirms[0].message.includes('5차시 × 8시간 교과는 그대로 둡니다'), confirms[0]?.message);
        assert.strictEqual(call(ctx, 'courseLessonMinutes')(old), 240, '확인하기 전에는 바꾸지 않는다');
        await confirms[0].onConfirm();
        assert.ok(shaped.lessons === shapedLessons && shapedLessons.every(lesson => lesson.hours === 8 && lesson.minutes === 480), '5차시 × 8시간 교과는 손대지 않는다');
        assert.deepStrictEqual([call(ctx, 'courseLessonMinutes')(old), old.lessons[0].id, sum(old.lessons[1].flow.map(step => step.minutes))], [2400, 'mainQuest', call(ctx, 'lessonMinutes')(old.lessons[1])], '예전 교과만 40시간으로(진행 단계도 따라간다)');
        assert.ok(!call(ctx, 'renderCourseTimeBar')().includes('fitSubjectHours'), '맞춘 뒤에는 단추가 없다');
        call(ctx, 'fitSubjectHours')();
        assert.strictEqual(confirms.length, 1, '맞출 교과가 없으면 묻지 않는다');
    });

    /* ---------- 검토 반영: lesson-lint.js 없이도 실습 지시를 만든다 ---------- */
    await run('실습 지시 대체 값: lesson-lint.js를 싣지 않은 화면에서도 멈추지 않고 예전 지시(90~120분)를 쓰며, 싣으면 기본 120분이다', () => {
        const bare = { console: { log() {}, warn() {}, error() {} }, JSON, Map, Set, Promise, Date, localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, location: { hash: '' },
            document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeElement(), body: { appendChild() {} } } };
        bare.window = bare;
        vm.createContext(bare);
        ['data.js', 'ui.js'].forEach(file => vm.runInContext(source(file), bare));
        assert.strictEqual(vm.runInContext("typeof practiceVolumeSpec", bare), 'undefined');
        assert.deepStrictEqual(plain(call(bare, 'practicePromptValues')('advPrac', 0)), { time: '90~120분', total: '90~120분', chars: '8,000', lines: '250', parts: '3', tasks: '2' });
        assert.ok(call(bare, 'basicPracTabPrompt')(180).includes('[시간 배분 — 이 탭: 90~120분]'));
        assert.strictEqual(call(bare, 'tabContinueVolumeRule')('basicPrac', { practiceMinutes: 180 }), '');
        const promptCtx = promptContext();
        assert.strictEqual(plain(call(promptCtx, 'practicePromptValues')('advPrac', 0)).time, '120분');
        assert.ok(call(promptCtx, 'tabContinueVolumeRule')('basicPrac', {}).includes('이 탭은 120분 실습입니다.'));
    });

    await run('예고: 학습 탭마다 그 트랙의 목표로 긴 호출을 세고, 목표가 다르면 범위를 보인다', () => {
        const targets = plain(call(pure, 'lessonVolumeTargets')({ id: 1, gen: { basicPracMinutes: 180 } }));
        assert.deepStrictEqual(targets, { basicLearn: 300, advLearn: 360 });
        const work = plain(call(pure, 'lessonWork')({ tabs: ['basicLearn', 'advLearn'], volumeMinutes: targets }, 'section', 0));
        assert.deepStrictEqual([work.volume, work.volumeCalls, work.volumeMinutes, work.volumeMinutesLow], [2, 15 + 3 + 18 + 3, 360, 300]);
        const same = plain(call(pure, 'lessonWork')({ tabs: ['basicLearn', 'advLearn'] }, 'section', 0));
        assert.deepStrictEqual([same.volumeCalls, same.volumeMinutes, 'volumeMinutesLow' in same], [42, 360, false], '정하지 않으면 두 탭 모두 360분');
        const total = plain(call(pure, 'sumWork')([same, plain(call(pure, 'lessonWork')({ tabs: ['basicLearn'], volumeMinutes: 240 }, 'section', 0))]));
        assert.deepStrictEqual([total.volume, total.volumeMinutes, total.volumeMinutesLow], [3, 360, 240], '차시들 가운데 가장 짧은 목표');
        const note = call(pure, 'estimateNote')(plain(call(pure, 'estimateSummary')(work, { model: 'gemini-3.8-flash', timings: {} })), 'gemini-3.8-flash');
        assert.ok(note.includes('기본학습·심화학습은 탭마다 낭독 300~360분(공백 포함 약 75,000~90,000자)이 될 때까지') && note.includes('긴 호출이 약 39번'), note);
        ['lesson-pipeline.js', 'api.js', 'course-flow.js'].forEach(file => assert.ok(source(file).includes('lessonVolumeTargets('), `${file}의 예고가 탭마다 센다`));
    });

    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
