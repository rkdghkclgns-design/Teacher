// 학습 탭 낭독 목표와 실습 시간 테스트 (실행: node tests/tab-time.test.js)
// 기본학습·심화학습의 낭독 목표(차시 시간과 관계없이 하루 480분 − 같은 트랙 실습 시간, 실습 기본 120분이면 360분), 심화학습의 지시·이어쓰기·분량 보강과 분량 채우기(탭 생성·탭 위 단추·묻는 창·예고),
// 강사가 정한 실습 시간(과정 기본값·차시 값·실습 탭 단추)이 지시·이어쓰기·청크 상한·예고에 닿는지, 정하지 않으면 지시가 예전과 같은지,
// (⏱) 합계 알림과 불러온 저장본의 실습 시간 검사를 실제 파일로 확인한다. AI 응답만 스텁이고 키는 쓰지 않는다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const root = path.join(__dirname, '..', 'js') + path.sep;
const source = file => fs.readFileSync(root + file, 'utf8');
const GEN_FILES = ['data.js', 'ai-errors.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js', 'course-design.js', 'course-flow.js', 'lesson-volume.js'];
const reply = (text, finishReason = 'STOP') => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });
const plain = value => JSON.parse(JSON.stringify(value));
const call = (ctx, name) => vm.runInContext(name, ctx);
const FILL_UNIT = '가나다라마바사아자차. ';
const filler = n => FILL_UNIT.repeat(Math.ceil(n / FILL_UNIT.length)).slice(0, n).trim();
// 19차: 실습 시간을 정하지 않은 학습 탭의 낭독 목표(480 − 120 = 360분)
const LEARN = 360;
const TARGET_CHARS = LEARN * 250;
const hash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

function fakeElement() {
    const handlers = {};
    return {
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', title: '', disabled: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener(type, fn) { handlers[type] = fn; },
        fire(type, event) { return handlers[type]?.(event); },
        querySelector: () => fakeElement(),
        querySelectorAll: () => [],
        remove() { this.removed = true; }
    };
}

// 낭독 목표·실습 시간·과정 설계 지시 함수만 싣는다
function pureContext() {
    const ctx = { console, localStorage: { getItem: () => null, setItem() {} }, globalState: { subjects: [] }, escapeHtml: s => String(s),
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} } };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['data.js', 'lesson-lint.js', 'lesson-editor-tools.js', 'course-design.js'].forEach(file => vm.runInContext(source(file), ctx));
    return ctx;
}

// lesson-volume.test.js와 같은 화면 흉내. 프롬프트는 '작업|탭|섹션 제목|부탁 글자|code|실습 시간'으로 만들어 스텁이 읽는다
function genContext() {
    const elements = {};
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        Promise, URL, Uint16Array, Blob, AbortController,
        localStorage: { getItem: () => null, setItem() {} },
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''),
        saveState: async () => { ctx.saved += 1; },
        renderEditor() {}, renderSidebar() {}, showLessonView() {},
        archiveContent: async (item, reason) => { ctx.archived.push({ ...item, reason }); },
        currentEditingModuleId: null, needsElementAutoAssign: () => false, lessonNeedsGyosuan: () => false, runGyosuanGeneration: async () => ({ ok: true }),
        archived: [], alerts: [], toasts: [], overlays: [], prompts: [], payloads: [], sections: [], waits: [], confirms: [], asked: [],
        imageCalls: 0, saved: 0,
        elements,
        document: {
            readyState: 'complete', hidden: false, title: '',
            body: { appendChild: el => { if (el.id) elements[el.id] = el; ctx.overlays.push(el); ctx.onOverlay?.(el); } },
            createElement: fakeElement,
            getElementById: id => elements[id] || null,
            addEventListener() {}, removeEventListener() {},
            querySelector: () => null, querySelectorAll: () => []
        }
    };
    ctx.window = ctx;
    ctx.setTimeout = (fn, ms) => { ctx.waits.push(ms); return setTimeout(fn, Math.min(ms, 1)); };
    ctx.clearTimeout = id => clearTimeout(id);
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind });
    vm.createContext(ctx);
    GEN_FILES.forEach(file => vm.runInContext(source(file), ctx));
    ctx.confirmAsync = async (message, opts) => { ctx.confirms.push({ message, opts }); return ctx.confirmAnswer !== false; };
    ctx.promptAsync = async (message, opts) => { ctx.asked.push({ message, opts }); return ctx.promptAnswer ?? null; };
    ctx.callGemini = async () => { throw new Error('호출되면 안 됨'); };
    vm.runInContext(`callGemini = (...args) => window.callGemini(...args);
        buildTaskContext = (task, a) => ({ systemInstruction: '시스템', userPrompt: [task, a.tabId, a.sectionTitle, a.requestChars, a.needCode ? 'code' : '', a.practiceMinutes || 0].join('|') });
        getEditingModule = (id = window.currentMod?.id) => (String(id) === String(window.currentMod?.id) ? window.currentMod : null);
        processImageTags = async (mod, md) => { window.imageCalls += 1; return md; };
        renderSidebar = () => {}; renderEditor = () => {};
        globalState = { subjects: [] }; currentSubjectId = null; courseData = [];`, ctx);
    ['editor-loading', 'editor-loading-text', 'editor-loading-stop', 'ai-command-input', 'lesson-volume-chip'].forEach(id => { elements[id] = fakeElement(); });
    return ctx;
}

// 덜 쓰는 모델 흉내: 첫 생성에는 초안을, 분량 보강에는 '### ■ 보강 k'와 부탁 글자의 75%를 돌려준다
function volumeModel(ctx, { draft = '', deliver = 0.75, tabReply = null } = {}) {
    let k = 0;
    return async (model, payload) => {
        const text = payload.contents[0].parts[0].text;
        ctx.payloads.push(payload);
        ctx.prompts.push(text);
        const [task, , sectionTitle, requestChars] = text.split('|');
        if (task === 'tab_content' || task === 'tab_content_continue' || task === 'module') return tabReply ? tabReply(task, text) : reply(draft);
        if (task !== 'volume_expand') return reply('');
        k += 1;
        ctx.sections.push({ k, sectionTitle });
        return reply(`### ■ 보강 ${k}\n\n${filler(Math.round(Number(requestChars) * deliver))}`);
    };
}

const LABELS = [60, 60, 45, 60, 60, 45, 60, 60];
const GOALS = ['게임 경제의 고급 모델을 비교해 설계안을 작성할 수 있습니다.', '업계 사례를 근거로 밸런스 문제를 분석할 수 있습니다.'];
// 심화학습 초안: 학습 목표·개요(⏱ 10분)·'심화'로 시작하는 내용 섹션 8개·체크리스트
function advDraft() {
    return [
        '# 🚀 게임 경제 심화',
        `## 학습 목표\n\n${GOALS.map(goal => `- ${goal}`).join('\n')}`,
        '## 개요 (⏱ 10분)\n\n- 경제가 무너지는 상황입니다.\n- 고급 모델로 해결합니다.',
        ...LABELS.map((minutes, i) => `## ${i + 1}. 심화 이론 ${i + 1} (⏱ ${minutes}분)\n\n${filler(2400)}\n\n<br>`),
        '## ✅ 학습 후 체크리스트\n\n- 설계안을 작성했습니다. (다시 보기: 1. 심화 이론 1)\n- 사례를 분석했습니다. (다시 보기: 2. 심화 이론 2)'
    ].join('\n\n');
}

const emptyTabs = () => ({ basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null });
const MOD = { id: 1, title: '게임 경제', description: '경제를 설계합니다.' };
const lessonOf = (tabs = {}, extra = {}) => ({ ...MOD, tabContents: { ...emptyTabs(), ...tabs }, ...extra });
const volumePrompts = ctx => ctx.prompts.filter(text => text.startsWith('volume_expand'));
const tabPrompts = ctx => ctx.prompts.filter(text => text.startsWith('tab_content'));
const minutesOf = text => parseInt(text.split('|')[5], 10); // 스텁 프롬프트의 실습 시간 칸(뒤에 과정 설계 지시가 붙는다)
const askOf = text => `${text.split('|')[0]}|${text.split('|')[1]}|${minutesOf(text)}`;

function answerPreview(ctx, action) {
    ctx.onOverlay = overlay => {
        if (overlay.id === 'lesson-pipeline-bar') return;
        ctx.previewHtml = overlay.innerHTML;
        setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: action } } }));
    };
}

// 실제 프롬프트 빌더(ui.js)
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

// 바뀌지 않아야 할 다른 지시의 sha256 앞 16자(이 묶음을 시작하기 전 코드에서 같은 입력으로 잰 값).
// 기본학습 탭 지시는 18차에 첫머리 차례(개요 → 학습 목표)를 바꿔 다시 쟀다(tests/lesson-info.test.js가 바뀐 글을 본다).
// 19차에 기본실습 이어쓰기(기본 120분 실습), 기본학습·기본실습 과정 설계 지시(하루 480분 − 실습, 기본 실습 120분)를 바꿔 다시 쟀다
const PINNED = {
    tab_basicLearn: '2f73034e361d5db0', tab_assessment: '13349ea0610eb3a3',
    cont_basicLearn: 'b212c475f1a1cbcd', cont_basicPrac: 'b9201ff5fb01a88f', cont_assessment: 'ba3a5e78f8f06d7e',
    volume_system: '70a87b493ebd09b6', volume_user: '494fa97e4c7df814',
    brief_basicLearn: 'f5461c5369754168', brief_basicPrac: '51b4113703b57e70', brief_gyosuan: '9a1de5b816050a04',
    gen_basicPrac: '150894263488005a', gen_basicLearn: '0ad2abc8517f47de'
};

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

(async () => {
    const pure = pureContext();
    const promptCtx = promptContext();
    const build = (task, args) => call(promptCtx, 'buildTaskContext')(task, { title: 'Python 반복문', description: '반복문', keyConcepts: [], ...args });
    const tabText = (tabId, extra = {}) => build('tab_content', { tabId, tabLabel: tabId, targetMinutes: 480, ...extra }).userPrompt.split('[탭 작성 지시]\n')[1];
    const contRules = (tabId, extra = {}) => {
        const sys = build('tab_content_continue', { tabId, tabLabel: tabId, chunkIndex: 1, previousContent: '앞 글', targetMinutes: 480, ...extra }).systemInstruction;
        return sys.slice(sys.indexOf('[이어쓰기 규칙]'));
    };

    /* ---------- 학습 탭 낭독 목표 ---------- */
    await run('낭독 목표: 기본학습·심화학습은 차시 시간과 관계없이 480분 − 같은 트랙 실습 시간이고(정하지 않으면 360분), 다른 탭은 0이다. 최종 평가는 채우지 않는다', () => {
        const target = call(pure, 'learnTargetMinutes');
        [{}, { hours: 1 }, { hours: 2, minutes: 120 }, { hours: 10, minutes: 600 }, null].forEach(mod => {
            assert.deepStrictEqual([target(mod, 'basicLearn'), target(mod, 'advLearn')], [LEARN, LEARN], JSON.stringify(mod));
        });
        assert.deepStrictEqual(['basicPrac', 'advPrac', 'assessment', 'constructor'].map(tabId => target({ hours: 10 }, tabId)), [0, 0, 0, 0]);
        assert.strictEqual(call(pure, 'basicLearnTargetMinutes')({ hours: 10 }), LEARN, '예전 이름도 같은 값');
        const fills = call(pure, 'fillsLearnVolume');
        assert.deepStrictEqual([fills({ id: 1 }, 'basicLearn'), fills({ id: 1 }, 'advLearn'), fills({ id: 'mainQuest' }, 'advLearn'), fills({ id: 1 }, 'advPrac'), fills(null, 'basicLearn')], [true, true, false, false, false]);
    });

    await run('심화학습 지시: 이 탭 하나가 낭독 480분인 심화 교안이고(기본학습과 같은 낭독 규칙·구조 최소치), 옛 90~120분·12,000자·350줄 기준은 없다', () => {
        const text = tabText('advLearn');
        ['기본 학습의 개념을 더 깊이 파고들어 고급 이론, 업계 사례, 실무적 분석을 제공하세요', '실습, 평가, 강사 가이드는 다른 탭에서 작성하므로', '[시간 배분 — 이 탭 하나가 곧 480분 심화 과정입니다]',
            '강사가 소리 내어 읽으며 강의할 때 480분이 걸리는 완결된 심화 교안', '[분량 규칙 — 낭독 기준, 절대 준수]', '480분은 120,000자 이상입니다.', '480분 이상 510분 이하',
            '## 대주제 최소 8개, ### 소주제 최소 16개.', '표(Table) 최소 6개, mermaid 다이어그램 최소 3개', '학습 목표부터 "## ✅ 학습 후 체크리스트"까지', '<!-- CONTINUE -->']
            .forEach(part => assert.ok(text.includes(part), part));
        ['90~120분', '12,000자', '350줄', '짧은 교안은 불합격'].forEach(part => assert.ok(!text.includes(part), part));
        assert.ok(build('tab_content', { tabId: 'advLearn', tabLabel: '심화학습' }).userPrompt.includes('360분은 90,000자 이상입니다.'), '목표를 모르면 360분(480 − 실습 기본 120)');
    });

    await run('심화학습 이어쓰기·분량 보강: 첫 청크와 같은 낭독 480분 기준과 심화 역할을 준다. 기본학습 지시에는 심화 역할이 없다', () => {
        const cont = contRules('advLearn');
        ['- 분량 기준은 첫 청크와 같습니다. 남은 섹션을 요약하지 않습니다.', '480분은 120,000자 이상입니다.', '이 탭은 "심화 학습"입니다.', '고급 이론, 업계 사례, 실무적 분석을 씁니다'].forEach(part => assert.ok(cont.includes(part), part));
        assert.ok(!contRules('basicLearn').includes('심화 학습"입니다'));
        const args = { tabLabel: '심화학습', targetMinutes: 480, outline: ['1. 심화 이론 (⏱ 60분)'], objectives: [], sectionTitle: '1. 심화 이론 (⏱ 60분)', sectionText: '## 1. 심화 이론 (⏱ 60분)\n\n본문입니다.', requestChars: 3000, subtopics: 2 };
        const adv = build('volume_expand', { ...args, tabId: 'advLearn' });
        assert.ok(adv.systemInstruction.includes('고급 이론 → 업계 사례 → 실무 분석') && adv.systemInstruction.includes('이 탭은 "심화 학습"입니다.') && adv.userPrompt.includes('[현재 작업: 심화학습 분량 보강 — 목표 낭독 480분]'));
        const basic = build('volume_expand', { ...args, tabId: 'basicLearn', tabLabel: '기본학습' });
        assert.ok(basic.systemInstruction.includes('개념 정의 → 이론 설명 → 구체적 예시 → 사례 분석') && !basic.systemInstruction.includes('심화 학습"입니다'));
    });

    await run('과정 설계 지시: 심화학습도 차시 시간으로 줄이지 않고 진행 단계는 순서만 참고하며 섹션당 분량 옵션을 넣지 않는다', () => {
        const brief = call(pure, 'lessonDesignBrief');
        const lesson = { minutes: 120, hours: 2, flow: [{ phase: '도입', title: '시작', minutes: 10 }], gen: { length: '길게 (약 1,500자)', level: '실무 경험자' } };
        const adv = brief(lesson, 'advLearn');
        assert.ok(adv.includes('심화 학습 탭은 차시 시간과 관계없이 하루 8시간(480분)에서 같은 트랙 실습 120분을 뺀 낭독 360분(공백 포함 약 90,000자) 분량을 지킵니다.') && adv.includes('[진행 단계 — 내용 순서만 참고합니다]'), adv);
        ['비례해 줄이세요', '(10분)', '섹션 하나당 분량'].forEach(part => assert.ok(!adv.includes(part), part));
        assert.ok(brief({ minutes: 600, hours: 10 }, 'advLearn').includes('낭독 360분(공백 포함 약 90,000자)'), '10시간 차시도 360분');
        assert.ok(brief({ minutes: 480, hours: 8, gen: { advPracMinutes: 240 } }, 'advLearn').includes('같은 트랙 실습 240분을 뺀 낭독 240분'), '심화실습 240분이면 심화학습 240분');
        assert.ok(!call(pure, 'lessonGenBrief')(lesson, 'advLearn').includes('섹션 하나당 분량') && call(pure, 'lessonGenBrief')(lesson, 'advPrac').includes('섹션 하나당 분량'));
    });

    await run('심화학습 탭 생성: 초안 뒤 분량 보강으로 낭독 목표(기본 360분)를 넘기고 (⏱) 합계는 360분이다. \'심화\'로 시작하는 섹션도 늘리고 기본학습은 건드리지 않는다', async () => {
        const mod = lessonOf();
        const ctx = genContext();
        ctx.currentMod = mod;
        const statuses = [];
        ctx.callGemini = volumeModel(ctx, { draft: `${advDraft()}\n<!-- END -->` });
        const result = plain(await call(ctx, 'generateTabContent')(1, 'advLearn', { onStatus: text => statuses.push(text) }));
        assert.deepStrictEqual(result, { ok: true, partial: false });
        const saved = mod.tabContents.advLearn;
        assert.ok(call(ctx, 'spokenChars')(saved) >= TARGET_CHARS, String(call(ctx, 'spokenChars')(saved)));
        assert.strictEqual(call(ctx, 'volumeLabelSum')(saved), LEARN);
        assert.ok(volumePrompts(ctx).length > 5 && volumePrompts(ctx).every(text => text.startsWith('volume_expand|advLearn|') && text.split('|')[2].includes('심화 이론')), volumePrompts(ctx)[0]);
        assert.ok(statuses.some(text => text.includes('심화학습 분량 채우는 중') && text.includes(`/${LEARN}분`)), statuses.find(text => text.includes('낭독')));
        assert.ok(ctx.alerts.at(-1).includes('심화학습 탭이 생성되었습니다. 낭독 약') && ctx.alerts.at(-1).includes(`(목표 ${LEARN}분)`), ctx.alerts.at(-1));
        assert.strictEqual(mod.tabContents.basicLearn, null);
        const open = (title, tabId) => call(ctx, 'isVolumeContentSection')({ title, text: `## ${title}\n\n본문입니다.` }, new Set(), tabId);
        assert.deepStrictEqual([open('1. 심화 이론 (⏱ 60분)', 'advLearn'), open('1. 심화 이론 (⏱ 60분)', 'basicLearn'), open('실습 안내', 'advLearn')], [true, false, false], '기본학습의 심화 섹션은 늘리지 않는다');
    });

    await run('전체 생성: 빈 심화학습도 분량 보강까지 채우고, 시작 전 예고에 기본학습·심화학습 분량 채우기를 함께 센다', async () => {
        const mod = lessonOf({ basicLearn: '## 본문\n\n글입니다.', basicPrac: '## 실습\n\n글', advPrac: '## 실습\n\n글', assessment: '### 문제 1. 가\n\n글' });
        const ctx = genContext();
        ctx.currentMod = mod;
        ctx.callGemini = volumeModel(ctx, { draft: advDraft() });
        await call(ctx, 'runLessonPipeline')(1);
        assert.ok(call(ctx, 'spokenChars')(mod.tabContents.advLearn) >= TARGET_CHARS && volumePrompts(ctx).every(text => text.startsWith('volume_expand|advLearn|')) && volumePrompts(ctx).length > 5);
        const fresh = genContext();
        fresh.currentMod = lessonOf();
        fresh.confirmAnswer = false;
        await call(fresh, 'startLessonGeneration')(1);
        assert.ok(fresh.confirms[0].message.includes(`기본학습·심화학습은 탭마다 낭독 ${LEARN}분`) && fresh.confirms[0].message.includes('탭 2개에 긴 호출이 약 42번'), fresh.confirms[0].message);
    });

    await run('심화학습 이어쓰기 상한: 학습 탭은 6단락, 정하지 않은 실습 탭은 3단락까지 받는다', async () => {
        const counts = {};
        for (const tabId of ['advLearn', 'basicPrac']) {
            const ctx = genContext();
            ctx.currentMod = lessonOf();
            ctx.callGemini = volumeModel(ctx, { tabReply: () => reply('## 이어지는 파트 (⏱ 30분)\n\n본문입니다.\n<!-- CONTINUE -->') });
            vm.runInContext('ensureSpokenVolume = undefined;', ctx); // 분량 채우기 없이 단락 수만 센다
            await call(ctx, 'generateTabContent')(1, tabId, { quiet: true });
            counts[tabId] = tabPrompts(ctx).length;
        }
        assert.deepStrictEqual(counts, { advLearn: 6, basicPrac: 3 });
    });

    await run('심화학습 분량 채우기: 탭 위 표시와 단추가 심화학습을 채우고, 묻는 창·미리 보기·작업 기록·변경 이력에 심화학습이라고 적는다', async () => {
        const start = advDraft();
        const mod = lessonOf({ advLearn: start });
        const ctx = genContext();
        ctx.currentMod = mod;
        vm.runInContext("currentLessonTab = 'advLearn'; _lessonPanel = null;", ctx);
        call(ctx, 'syncVolumeChip')(mod);
        const chip = ctx.elements['lesson-volume-chip'];
        assert.ok(chip.className.includes('amber') && chip.innerHTML.includes(`/ 목표 ${LEARN}분`) && chip.innerHTML.includes('data-volume-tab="advLearn"') && chip.innerHTML.includes('분량 채우기'), chip.innerHTML);
        const panel = call(ctx, 'reviewPanelHtml')(mod, 'advLearn', start, false);
        assert.ok(panel.includes(`분(목표 ${LEARN}분)`), '검수 패널에도 심화학습 낭독 시간');
        ctx.callGemini = volumeModel(ctx, {});
        answerPreview(ctx, 'apply');
        await call(ctx, 'fillLessonVolume')('1', 'advLearn');
        const asked = ctx.confirms[0];
        assert.strictEqual(asked.opts.title, '심화학습 분량 채우기');
        assert.ok(asked.message.startsWith('심화학습은 지금 낭독 약') && asked.message.includes('심화학습은 낭독 360분(공백 포함 약 90,000자)'), asked.message);
        assert.ok(call(ctx, 'spokenChars')(mod.tabContents.advLearn) >= TARGET_CHARS, '반영했다');
        assert.ok(ctx.previewHtml.includes('심화학습 분량 채우기 미리보기') || ctx.previewHtml.includes('심화학습을 낭독 약'), ctx.previewHtml.slice(0, 300));
        assert.deepStrictEqual(ctx.archived.map(item => [item.tabId, item.reason, item.content === start, item.title]), [['advLearn', '분량 채우기 전', true, '게임 경제 · 심화학습']]);
        assert.ok(mod.history[0].note.startsWith('심화학습 분량 채우기(낭독 약 '), mod.history[0].note);
        assert.ok(ctx.toasts.at(-1).message.startsWith('심화학습을 낭독 약'), JSON.stringify(ctx.toasts.at(-1)));
        assert.ok(volumePrompts(ctx).every(text => text.startsWith('volume_expand|advLearn|')));
        assert.strictEqual(mod.tabContents.basicLearn, null, '기본학습은 그대로');
        // 학습 탭이 아닌 값이 오면 아무것도 하지 않는다
        const other = genContext();
        other.currentMod = lessonOf({ basicPrac: '## 실습\n\n글입니다.' });
        other.callGemini = volumeModel(other, {});
        await call(other, 'fillLessonVolume')(1, 'basicPrac');
        await call(other, 'fillLessonVolume')(1, 'constructor');
        assert.deepStrictEqual([other.confirms.length, other.prompts.length, other.alerts.length], [0, 0, 0]);
        // 반영하지 않으면 채운 글은 심화학습 이름으로 작업 기록에 남는다
        const declined = genContext();
        declined.currentMod = lessonOf({ advLearn: start });
        declined.callGemini = volumeModel(declined, {});
        answerPreview(declined, 'cancel');
        await call(declined, 'fillLessonVolume')(1, 'advLearn');
        const kept = declined.archived.find(item => item.reason === '분량 채우기 결과(반영 안 함)');
        assert.ok(kept && kept.tabId === 'advLearn' && kept.title === '게임 경제 · 심화학습', JSON.stringify(declined.archived.map(item => item.reason)));
    });

    await run('이 탭 생성: 심화학습도 먼저 호출 수·시간을 보이고 묻고, 빈 심화학습 안내는 오래 걸린다고 말한다', async () => {
        const ctx = genContext();
        ctx.currentMod = lessonOf();
        ctx.callGemini = volumeModel(ctx, { draft: advDraft() });
        ctx.confirmAnswer = false;
        const declined = plain(await call(ctx, 'runTabJob')(1, 'advLearn'));
        assert.deepStrictEqual([declined.cancelled, ctx.prompts.length], [true, 0]);
        const asked = ctx.confirms[0];
        assert.strictEqual(asked.opts.title, '심화학습 만들기');
        assert.ok(asked.message.startsWith('«심화학습» 탭을 만듭니다.') && asked.message.includes(`${LEARN}분`) && asked.message.includes('긴 호출이 약 21번') && asked.message.includes(`심화학습은 낭독 ${LEARN}분`), asked.message);
        vm.runInContext("currentLessonTab = 'advLearn'", ctx);
        const hint = call(ctx, 'emptyTabPromptHtml')(ctx.currentMod, false);
        assert.ok(hint.includes(`심화학습은 강사가 소리 내어 읽어도 ${LEARN}분이 걸리는 분량까지`) && !hint.includes('수십 초'), hint);
    });

    await run('미리 보기: 심화학습을 만들면 기본학습처럼 분량 보강 호출을 더하고, 둘 다 만들면 탭마다 센다', () => {
        const ectx = { console, window: {}, JSON, Math, Object, localStorage: { getItem: () => null, setItem() {} } };
        vm.createContext(ectx);
        vm.runInContext(source('cost-estimate.js'), ectx);
        const work = (input, extra) => plain(vm.runInContext('lessonWork', ectx)(input, 'section', 0, extra));
        const note = w => vm.runInContext('estimateNote', ectx)(plain(vm.runInContext('estimateSummary', ectx)(w, { model: 'gemini-3.8-flash', timings: {} })), 'gemini-3.8-flash');
        const adv = work({ tabs: ['advLearn'] });
        assert.deepStrictEqual([adv.volume, adv.volumeCalls, adv.volumeMinutes, adv.volumeAdv], [1, 21, LEARN, 1]);
        const both = work({ tabs: ['basicLearn', 'basicPrac', 'advLearn'] });
        assert.deepStrictEqual([both.volume, both.volumeCalls, both.volumeAdv], [2, 42, 1]);
        assert.ok(note(adv).includes('심화학습은 낭독 360분(공백 포함 약 90,000자)이 될 때까지') && note(adv).includes('긴 호출이 약 21번'), note(adv));
        assert.ok(note(both).includes(`기본학습·심화학습은 탭마다 낭독 ${LEARN}분`) && note(both).includes('탭 2개에 긴 호출이 약 42번'), note(both));
        // 19차: 트랙마다 실습 시간이 달라 학습 탭 목표가 다르면 탭마다 그 목표로 세고, 안내에는 범위를 보인다
        const split = work({ tabs: ['basicLearn', 'advLearn'], volumeMinutes: { basicLearn: 300, advLearn: LEARN } });
        assert.deepStrictEqual([split.volumeCalls, split.volumeMinutes, split.volumeMinutesLow], [15 + 3 + 18 + 3, LEARN, 300]);
        assert.ok(note(split).includes('기본학습·심화학습은 탭마다 낭독 300~360분(공백 포함 약 75,000~90,000자)'), note(split));
        assert.ok(!('volume' in work({ tabs: ['advLearn'], fillsVolume: false })), '최종 평가는 세지 않는다');
        assert.strictEqual(vm.runInContext('estimateCallSplit', ectx)({ tabs: 2, volume: 2 }).long, 42, '긴 호출 수를 모르면 탭마다 기본 360분 상한으로');
    });

    /* ---------- 실습 시간 ---------- */
    await run('실습 시간 값: 10~600분 사이 10분 단위 정수만 받고, 차시 값 → 과정 기본값 → 0 순서로 쓴다(최종 평가와 다른 탭은 0)', () => {
        const value = call(pure, 'practiceMinutesValue');
        assert.deepStrictEqual([10, 120, 600, '120', ' 90 '].map(value), [10, 120, 600, 120, 90]);
        [5, 0, -10, 95, 605, 610, 12.5, NaN, Infinity, '12a', '', '  ', null, undefined, true, {}, [], [120]].forEach(bad => assert.strictEqual(value(bad), null, JSON.stringify(bad)));
        const time = (mod, tabId, options) => plain(call(pure, 'lessonPracticeTime')(mod, tabId, options));
        pure.globalState = { subjects: [], courseDesign: { genOptions: { basicPracMinutes: 120 } } };
        assert.deepStrictEqual(time({ id: 1 }, 'basicPrac'), { minutes: 120, from: 'course' });
        assert.deepStrictEqual(time({ id: 1, gen: { basicPracMinutes: 200 } }, 'basicPrac'), { minutes: 200, from: 'lesson' });
        assert.deepStrictEqual(time({ id: 1, gen: { basicPracMinutes: 95 } }, 'basicPrac'), { minutes: 120, from: 'course' }, '받을 수 없는 차시 값은 건너뛴다');
        assert.deepStrictEqual(time({ id: 1, gen: 'x' }, 'basicPrac'), { minutes: 120, from: 'course' });
        assert.deepStrictEqual(time({ id: 1 }, 'advPrac'), { minutes: 0, from: '' });
        assert.deepStrictEqual(time({ id: 'mainQuest', gen: { basicPracMinutes: 200 } }, 'basicPrac'), { minutes: 0, from: '' }, '최종 평가에는 쓰지 않는다');
        assert.deepStrictEqual(time({ id: 1, gen: { basicPracMinutes: 200 } }, 'basicLearn'), { minutes: 0, from: '' });
        assert.deepStrictEqual(time({ id: 1 }, 'basicPrac', { basicPracMinutes: 300 }), { minutes: 300, from: 'course' }, '저장 전 창의 과정 기본값');
        pure.globalState = { subjects: [] };
        const chunks = call(pure, 'tabChunkLimit');
        assert.deepStrictEqual([0, 90, 180, 270, 280, 360, 450, 540, 600].map(n => chunks('basicPrac', n)), [3, 3, 3, 3, 4, 4, 5, 6, 6]);
        assert.deepStrictEqual([chunks('basicLearn'), chunks('advLearn'), chunks('assessment', 600), chunks('advPrac', 95)], [6, 6, 3, 3]);
    });

    await run('실습 지시: 실습 시간을 정하면 그 시간과 시간에 맞춘 최소 분량을 주고, 정하지 않으면 기본 120분으로 준다(옛 90~120분은 없다)', () => {
        assert.strictEqual(tabText('basicPrac'), tabText('basicPrac', { practiceMinutes: 120 }), '정하지 않으면 기본 120분과 같다');
        assert.strictEqual(tabText('advPrac'), tabText('advPrac', { practiceMinutes: 120 }));
        assert.strictEqual(tabText('basicPrac', { practiceMinutes: 95 }), tabText('basicPrac'), '받을 수 없는 값은 정하지 않은 것');
        ['[시간 배분 — 이 탭: 120분]', '합계가 정확히 120분이 되게 하세요.', '최소 9,000자 이상', '최소 288줄 이상', '실습 과제 최소 3개'].forEach(part => assert.ok(tabText('basicPrac').includes(part), part));
        assert.ok(tabText('advPrac').includes('프로젝트형 실습 과제 최소 2개') && ![tabText('basicPrac'), tabText('advPrac')].some(prompt => prompt.includes('90~120분')));
        const basic = tabText('basicPrac', { practiceMinutes: 180 });
        ['[시간 배분 — 이 탭: 180분]', '독립 기본 실습 모듈로, 180분 분량입니다.', '합계가 정확히 180분이 되게 하세요.', '최소 13,500자 이상', '최소 432줄 이상', '## 대주제(실습 파트) 최소 3개.', '실습 과제 최소 5개', '최소 5단계']
            .forEach(part => assert.ok(basic.includes(part), part));
        assert.ok(!basic.includes('90~120분') && !basic.includes('8,000자'));
        const adv = tabText('advPrac', { practiceMinutes: 240 });
        ['[시간 배분 — 이 탭: 240분]', '합계가 정확히 240분이 되게 하세요.', '최소 18,000자 이상', '최소 576줄 이상', '프로젝트형 실습 과제 최소 5개', '최소 7단계'].forEach(part => assert.ok(adv.includes(part), part));
        const short = tabText('basicPrac', { practiceMinutes: 30 });
        ['최소 2,300자 이상', '최소 72줄 이상', '## 대주제(실습 파트) 최소 1개.', '실습 과제 최소 1개'].forEach(part => assert.ok(short.includes(part), part));
        const tiny = tabText('advPrac', { practiceMinutes: 10 });
        ['최소 2,000자 이상', '최소 24줄 이상', '프로젝트형 실습 과제 최소 1개'].forEach(part => assert.ok(tiny.includes(part), part));
        const long = tabText('advPrac', { practiceMinutes: 600 });
        ['최소 45,000자 이상', '최소 1,440줄 이상', '프로젝트형 실습 과제 최소 6개', '## 대주제(실습 파트) 최소 3개.'].forEach(part => assert.ok(long.includes(part), part));
        assert.ok(tabText('basicPrac', { practiceMinutes: 600 }).includes('실습 과제 최소 8개'));
        assert.ok(contRules('advPrac', { practiceMinutes: 240 }).includes('이 탭은 240분 실습입니다.') && contRules('advPrac', { practiceMinutes: 240 }).includes('합계가 정확히 240분'));
        assert.ok(contRules('advPrac').includes('이 탭은 120분 실습입니다.'), '정하지 않으면 이어쓰기도 기본 120분');
    });

    await run('바뀌지 않는 지시: 실습 시간을 정하지 않으면 기본학습·학습이해도 탭, 이어쓰기, 분량 보강, 과정 설계 지시가 정한 글과 같다(19차에 실습 기본 120분·학습 360분으로 바뀐 셋은 다시 쟀다)', () => {
        const volumeArgs = { tabId: 'basicLearn', tabLabel: '기본학습', targetMinutes: 480, outline: ['학습 목표', '1. 반복문 (⏱ 60분)'], objectives: ['반복문으로 합계를 구하는 코드를 작성할 수 있습니다.'], sectionTitle: '1. 반복문 (⏱ 60분)', sectionText: '## 1. 반복문 (⏱ 60분)\n\n반복문은 같은 일을 되풀이합니다.', requestChars: 12000, subtopics: 5 };
        const volume = build('volume_expand', volumeArgs);
        const lesson = { title: '차시', minutes: 120, hours: 2, objectives: ['목표를 작성할 수 있습니다.'], flow: [{ phase: '도입', title: '시작', minutes: 10 }, { phase: '전개', title: '본문', minutes: 100 }, { phase: '정리', title: '끝', minutes: 10 }], gen: { level: '실무 경험자', length: '길게 (약 1,500자)' } };
        const brief = tabId => call(promptCtx, 'lessonDesignBrief')(lesson, tabId);
        const genBrief = tabId => call(promptCtx, 'lessonGenBrief')(lesson, tabId);
        const now = {
            tab_basicLearn: tabText('basicLearn'), tab_assessment: tabText('assessment'),
            cont_basicLearn: contRules('basicLearn'), cont_basicPrac: contRules('basicPrac'), cont_assessment: contRules('assessment'),
            volume_system: volume.systemInstruction.slice(volume.systemInstruction.indexOf('[분량 보강 규칙')), volume_user: volume.userPrompt,
            brief_basicLearn: brief('basicLearn'), brief_basicPrac: brief('basicPrac'), brief_gyosuan: brief(''),
            gen_basicPrac: genBrief('basicPrac'), gen_basicLearn: genBrief('basicLearn')
        };
        Object.entries(PINNED).forEach(([key, expected]) => assert.strictEqual(hash(now[key]), expected, `${key}가 바뀌었다:\n${now[key].slice(0, 300)}`));
        assert.ok(['basicPrac', 'advPrac'].every(tabId => brief(tabId).includes('기본 실습 시간 120분 분량으로 씁니다.') && !brief(tabId).includes('비례해 줄이세요')), '실습 시간을 정하지 않은 실습 탭은 차시 시간으로 줄이지 않고 기본 120분으로 쓴다');
    });

    await run('과정 설계 지시: 실습 시간을 정한 실습 탭은 차시 시간으로 줄이라고 하지 않고 정한 시간으로 쓴다고 한다', () => {
        promptCtx.globalState = { subjects: [], courseDesign: { genOptions: { advPracMinutes: 150 } } };
        const lesson = { id: 3, title: '차시', minutes: 120, hours: 2, gen: { basicPracMinutes: 240 } };
        const basic = call(promptCtx, 'lessonDesignBrief')(lesson, 'basicPrac');
        const adv = call(promptCtx, 'lessonDesignBrief')(lesson, 'advPrac');
        assert.ok(basic.includes('이 실습 탭은 강사가 정한 240분 분량으로 씁니다.') && !basic.includes('비례해 줄이세요'), basic);
        assert.ok(adv.includes('이 실습 탭은 강사가 정한 150분 분량으로 씁니다.') && !adv.includes('비례해 줄이세요'), '과정 기본값');
        promptCtx.globalState = { subjects: [] };
    });

    await run('실습 시간 → 생성: 과정 기본값과 차시 값이 이 탭 생성·이어쓰기·이어쓰기 상한·전체 생성·일괄 생성에 닿는다', async () => {
        const make = (gen, tabs = {}) => lessonOf(tabs, { gen, minutes: 120, hours: 2 });
        const ctx = genContext();
        ctx.globalState.courseDesign = { genOptions: { basicPracMinutes: 120, advPracMinutes: 600 } };
        ctx.currentMod = make({ basicPracMinutes: 240 });
        ctx.callGemini = volumeModel(ctx, { tabReply: () => reply('## 실습 파트 (⏱ 40분)\n\n본문입니다.\n<!-- CONTINUE -->') });
        await call(ctx, 'generateTabContent')(1, 'basicPrac', { quiet: true });
        const basic = tabPrompts(ctx);
        assert.deepStrictEqual(basic.map(askOf), ['tab_content|basicPrac|240', 'tab_content_continue|basicPrac|240', 'tab_content_continue|basicPrac|240'], '240분은 상한 3단락, 이어쓰기에도 같은 시간');
        assert.ok(basic[0].includes('이 실습 탭은 강사가 정한 240분 분량으로 씁니다.'), '첫 단락에 과정 설계 지시');
        ctx.prompts.length = 0;
        await call(ctx, 'generateTabContent')(1, 'advPrac', { quiet: true });
        const adv = tabPrompts(ctx);
        assert.strictEqual(adv.length, 6, '600분은 이어쓰기 상한 6단락');
        assert.ok(adv[0].startsWith('tab_content|advPrac|') && adv.every(text => minutesOf(text) === 600), adv[0].slice(0, 60));
        // 일괄 생성(빈 탭만 채우기)과 전체 생성도 같은 시간으로 만든다
        const batch = genContext();
        batch.globalState.courseDesign = { genOptions: { advPracMinutes: 180 } };
        batch.currentMod = make({ basicPracMinutes: 60 }, { basicLearn: '## 본문\n\n글입니다.', advLearn: '## 본문\n\n글입니다.', assessment: '### 문제 1. 가\n\n글' });
        batch.callGemini = volumeModel(batch, { tabReply: () => reply('## 실습 (⏱ 60분)\n\n본문입니다.') });
        const filled = plain(await call(batch, 'fillMissingTabs')(1));
        assert.strictEqual(filled.ok, true);
        assert.deepStrictEqual(tabPrompts(batch).map(askOf), ['tab_content|basicPrac|60', 'tab_content|advPrac|180', 'tab_content|advAssessment|0'], '빈 심화이해도 탭도 채운다(실습 시간은 없다)');
        const pipeline = genContext();
        pipeline.currentMod = make({ advPracMinutes: 90 }, { basicLearn: '## 본문\n\n글입니다.', advLearn: '## 본문\n\n글입니다.', assessment: '### 문제 1. 가\n\n글' });
        pipeline.callGemini = volumeModel(pipeline, { tabReply: () => reply('## 실습 (⏱ 60분)\n\n본문입니다.') });
        await call(pipeline, 'runLessonPipeline')(1);
        assert.deepStrictEqual(tabPrompts(pipeline).map(askOf), ['tab_content|basicPrac|0', 'tab_content|advPrac|90', 'tab_content|advAssessment|0'], '정하지 않은 탭은 0(예전 지시)');
    });

    await run('실습 탭 단추: 이 탭 생성 옆과 빈 탭 안내에 실습 시간을 보이고, 앱 입력 창으로 바꾸면 변경 이력에 남기고 다음 생성에 쓴다', async () => {
        const ctx = genContext();
        const mod = lessonOf({ basicPrac: '## 실습 (⏱ 60분)\n\n글입니다.' });
        ctx.currentMod = mod;
        ctx.globalState.courseDesign = { genOptions: { advPracMinutes: 150 } };
        const button = (m, tabId, place) => call(ctx, 'practiceTimeButtonHtml')(m, tabId, place);
        assert.ok(button(mod, 'basicPrac').includes('실습 시간 기본 120분') && button(mod, 'basicPrac').includes('id="lesson-practice-time"') && button(mod, 'basicPrac').includes('data-practice-tab="basicPrac"'));
        assert.ok(button(mod, 'advPrac').includes('실습 시간 150분(과정 기본값)'));
        assert.deepStrictEqual([button(mod, 'basicLearn'), button({ ...mod, id: 'mainQuest' }, 'basicPrac'), button(mod, 'constructor')], ['', '', '']);
        assert.ok(!button(mod, 'advPrac', 'empty').includes('id="lesson-practice-time"'), '빈 탭 안내의 단추는 같은 id를 쓰지 않는다');
        vm.runInContext("currentLessonTab = 'advPrac'", ctx);
        assert.ok(call(ctx, 'tabGenerateButtonsHtml')(mod, false).includes('changePracticeMinutes(') && call(ctx, 'emptyTabPromptHtml')(mod, false).includes('실습 시간 150분(과정 기본값)'));
        assert.ok(call(ctx, 'emptyTabPromptHtml')(mod, false).includes('생성에는 수십 초가 걸릴 수 있습니다.'));
        vm.runInContext("currentLessonTab = 'basicLearn'", ctx);
        assert.ok(!call(ctx, 'tabGenerateButtonsHtml')(mod, false).includes('changePracticeMinutes('), '실습 탭이 아니면 두지 않는다');
        // 앱 입력 창으로 정하기·고치기·지우기
        ctx.promptAnswer = '240';
        await call(ctx, 'changePracticeMinutes')('1', 'basicPrac');
        assert.deepStrictEqual(plain(mod.gen), { basicPracMinutes: 240 });
        assert.strictEqual(mod.history[0].note, '기본실습 시간 240분으로 정함');
        assert.ok(ctx.asked[0].message.includes('10분에서 600분 사이') && ctx.asked[0].opts.title === '기본실습 시간' && ctx.asked[0].opts.value === '', JSON.stringify(ctx.asked[0]));
        assert.ok(ctx.toasts.at(-1).message.includes('기본실습 시간을 240분으로 정했습니다.') && ctx.toasts.at(-1).message.includes('이미 만든 기본실습은 바뀌지 않습니다'), ctx.toasts.at(-1).message);
        assert.ok(ctx.toasts.at(-1).message.includes('기본학습 낭독 목표는 240분입니다.') && ctx.toasts.at(-1).kind === 'success', '같은 트랙 학습 탭의 새 목표(480 − 240)를 알린다');
        ctx.callGemini = volumeModel(ctx, { tabReply: () => reply('## 실습 (⏱ 240분)\n\n본문입니다.') });
        answerPreview(ctx, 'apply');
        await call(ctx, 'generateTabContent')(1, 'basicPrac', { quiet: true });
        assert.strictEqual(minutesOf(tabPrompts(ctx)[0]), 240, '다음 생성에 쓴다');
        const saves = ctx.saved;
        ctx.promptAnswer = '95';
        const askedBefore = ctx.asked.length;
        await call(ctx, 'changePracticeMinutes')(1, 'basicPrac');
        assert.ok(mod.gen.basicPracMinutes === 240 && ctx.toasts.at(-1).kind === 'warning' && ctx.toasts.at(-1).message.includes('10분 단위'), '받을 수 없는 값만 거듭 적으면 저장하지 않고 알린다');
        assert.strictEqual(ctx.asked[askedBefore].opts.value, '240', '차시 값을 칸에 넣어 묻는다');
        assert.deepStrictEqual([ctx.asked.length - askedBefore, ctx.asked.at(-1).opts.value], [5, '95'], '받을 수 없는 값은 적은 글을 칸에 둔 채 다섯 번까지 다시 묻는다');
        ctx.promptAnswer = null;
        await call(ctx, 'changePracticeMinutes')(1, 'basicPrac');
        assert.strictEqual(ctx.saved, saves, '취소하면 저장하지 않는다');
        ctx.promptAnswer = '';
        await call(ctx, 'changePracticeMinutes')(1, 'basicPrac');
        assert.deepStrictEqual([plain(mod.gen), mod.history[0].note], [{}, '기본실습 시간 정한 값 지움']);
        // 묻는 동안 다른 차시로 옮기면 바꾸지 않는다
        ctx.promptAnswer = '300';
        const asking = call(ctx, 'changePracticeMinutes')(1, 'advPrac');
        ctx.currentMod = lessonOf({}, { id: 2 });
        await asking;
        assert.strictEqual(mod.gen.advPracMinutes, undefined);
    });

    await run("실습 시간 입력: '120분'처럼 분을 붙여 적어도 받고, 받을 수 없는 값이면 적은 글을 칸에 둔 채 까닭을 붙여 다시 묻는다. 저장하면 다시 그린 단추로 포커스를 돌려주고, 머리 줄 단추 글은 짧다", async () => {
        const ctx = genContext();
        const mod = lessonOf({ basicPrac: '## 실습 (⏱ 60분)\n\n글입니다.' });
        ctx.currentMod = mod;
        const button = { focused: 0, focus() { this.focused += 1; } };
        ctx.elements['lesson-practice-time'] = button;
        const answers = [];
        ctx.promptAsync = async (message, opts) => { ctx.asked.push({ message, opts }); return answers.length ? answers.shift() : null; };
        answers.push('120분');
        await call(ctx, 'changePracticeMinutes')(1, 'basicPrac');
        assert.deepStrictEqual([mod.gen.basicPracMinutes, ctx.asked.length, button.focused], [120, 1, 1], "'120분'을 120분으로 받고 단추로 포커스를 돌려준다");
        answers.push(' 150 분');
        await call(ctx, 'changePracticeMinutes')(1, 'basicPrac');
        assert.strictEqual(mod.gen.basicPracMinutes, 150, '띄어 쓴 분도 받는다');
        ctx.asked.length = 0;
        answers.push('125', '130');
        await call(ctx, 'changePracticeMinutes')(1, 'basicPrac');
        assert.strictEqual(ctx.asked.length, 2, '받을 수 없는 값이면 창을 닫지 않고 다시 묻는다');
        assert.deepStrictEqual([ctx.asked[0].opts.value, ctx.asked[1].opts.value], ['150', '125'], '적은 글을 칸에 그대로 둔다');
        assert.ok(ctx.asked[1].message.startsWith('기본실습 시간은 10분에서 600분 사이에서 10분 단위로 적어 주세요(예: 120).') && ctx.asked[1].message.includes('비워 두면'), ctx.asked[1].message);
        assert.strictEqual(mod.gen.basicPracMinutes, 130, '고쳐 적은 값을 저장한다');
        ctx.asked.length = 0;
        answers.push('125');
        const saves = ctx.saved;
        await call(ctx, 'changePracticeMinutes')(1, 'basicPrac'); // 다시 묻는 창을 취소한다
        assert.deepStrictEqual([ctx.asked.length, mod.gen.basicPracMinutes, ctx.saved], [2, 130, saves], '다시 묻는 창을 닫으면 저장하지 않는다');
        // 머리 줄(이 탭 생성 옆) 단추는 짧은 글을 보이고 긴 글은 title에 둔다. 빈 탭 안내의 단추는 긴 글 그대로
        const shown = html => html.replace(/<[^>]*>/g, '').trim();
        const header = call(ctx, 'practiceTimeButtonHtml')(mod, 'basicPrac', 'header');
        assert.ok(shown(header).length <= 10 && shown(header) === '실습 130분' && header.includes('title="실습 시간 130분. 이 차시에서 정한 실습 시간입니다'), header);
        const unset = call(ctx, 'practiceTimeButtonHtml')(lessonOf(), 'advPrac', 'header');
        assert.ok(shown(unset) === '실습 기본 120분' && shown(unset).length <= 10, shown(unset));
        assert.strictEqual(shown(call(ctx, 'practiceTimeButtonHtml')(lessonOf(), 'advPrac', 'empty')), '실습 시간 기본 120분');
    });

    await run('갈래 고르기: 키보드로 기본학습 | 심화학습을 바꾸면 다시 그린 고르기의 고른 단추로 포커스를 돌려준다(숨은 사본은 건너뛴다)', async () => {
        const ctx = genContext();
        const mod = lessonOf({ basicLearn: '## 본문\n\n글입니다.', advLearn: '## 본문\n\n글입니다.' });
        ctx.currentMod = mod;
        const switches = () => [
            { offsetParent: null, focused: 0, focus() { this.focused += 1; } }, // 숨은 슬라이드 패널의 사본
            { offsetParent: {}, focused: 0, focus() { this.focused += 1; } }
        ];
        let drawn = [];
        ctx.document.querySelectorAll = selector => (selector === '.lesson-track-switch button[aria-pressed="true"]' ? drawn : []);
        vm.runInContext("renderEditor = () => { window.redrawn = (window.redrawn || 0) + 1; window.onRedraw?.(); }; _lessonPanel = 'gyosuan';", ctx);
        ctx.onRedraw = () => { drawn = switches(); };
        call(ctx, 'setLessonPanelTrack')('adv');
        assert.deepStrictEqual([ctx.redrawn, drawn[0].focused, drawn[1].focused], [1, 0, 1], '보이는 고른 단추로');
        // 열어 둔 문제은행은 그 자리에서 다시 그리고 같은 단추로 포커스를 돌려준다
        ctx.switchQbankTrack = () => { drawn = switches(); return true; };
        call(ctx, 'setLessonPanelTrack')('basic');
        assert.deepStrictEqual([ctx.redrawn, drawn[1].focused], [1, 1]);
    });

    await run('실습 시간 칸: 차시 정보·일괄 생성 창에 두 칸을 두고, 받을 수 있는 값만 숫자로 읽으며, 받을 수 없는 값이면 저장·시작하지 않고 알린다', () => {
        const ctx = genContext();
        const html = call(ctx, 'lessonGenFieldsHtml')('meta', { basicPracMinutes: 120, advPracMinutes: '"><img src=x onerror=1>' });
        ['기본실습 시간(분)', '심화실습 시간(분)', 'id="meta-gen-basicPracMinutes"', 'id="meta-gen-advPracMinutes"', 'value="120"', 'min="10" max="600" step="10"', '10~600분'].forEach(part => assert.ok(html.includes(part), part));
        assert.ok(!html.includes('onerror'), '이상한 값은 칸에 넣지 않는다');
        assert.ok(call(ctx, 'lessonGenFieldsHtml')('run', null).includes('id="run-gen-basicPracMinutes"'), '옵션이 객체가 아니어도 그린다');
        Object.assign(ctx.elements, { 'run-gen-level': { value: '실무 경험자' }, 'run-gen-basicPracMinutes': { value: '180' }, 'run-gen-advPracMinutes': { value: '95' } });
        assert.deepStrictEqual(plain(call(ctx, 'readLessonGenFields')('run')), { level: '실무 경험자', basicPracMinutes: 180 });
        assert.strictEqual(call(ctx, 'warnInvalidPracticeFields')('run'), true);
        assert.ok(ctx.alerts.at(-1).startsWith('심화실습 시간은 10분에서 600분 사이에서 10분 단위로'), ctx.alerts.at(-1));
        ctx.elements['run-gen-advPracMinutes'] = { value: '', validity: { badInput: true } };
        assert.strictEqual(call(ctx, 'warnInvalidPracticeFields')('run'), true, '숫자가 아닌 글을 적은 칸');
        ctx.elements['run-gen-advPracMinutes'] = { value: '' };
        assert.strictEqual(call(ctx, 'warnInvalidPracticeFields')('run'), false);
        const changed = plain(call(ctx, 'withMetaHistory')({ reviewStatus: '작성중', gen: { level: '실무 경험자' } }, { reviewStatus: '작성중', gen: call(ctx, 'readLessonGenFields')('run') }));
        assert.ok(changed.history[0].note.includes('생성 옵션'), '실습 시간을 바꾸면 변경 이력에 남는다');
        const ordered = call(ctx, 'withGenOption')({ advPracMinutes: 90, level: '실무 경험자' }, 'basicPracMinutes', 120);
        assert.deepStrictEqual(Object.keys(ordered), ['level', 'basicPracMinutes', 'advPracMinutes'], '차시 정보 창이 읽는 순서');
        assert.deepStrictEqual(plain(call(ctx, 'withGenOption')({ basicPracMinutes: 120 }, 'basicPracMinutes', null)), {});
        // 저장(차시 정보)과 시작(남은 차시 생성)은 받을 수 없는 실습 시간이면 멈춘다
        assert.ok(/warnInvalidPracticeFields\('meta'\)\) return;/.test(source('course-meta.js')) && /warnInvalidPracticeFields\('run'\)\) return;/.test(source('course-flow.js')));
    });

    await run('(⏱) 합계 알림: 정한 실습 시간과 10% 넘게 다르거나 시간 표시가 없으면 생성 직후 한 번 알리고(막지 않는다), 맞거나 정하지 않았으면 알리지 않는다', async () => {
        const check = (md, minutes) => plain(call(pure, 'practiceTimeCheck')(md, minutes));
        const md = sum => `## 1. 준비 (⏱ ${sum / 2}분)\n\n글\n\n## 2. 실습 (⏱ ${sum / 2}분)\n\n글\n\n\`\`\`text\n## 코드 속 (⏱ 500분)\n\`\`\``;
        assert.deepStrictEqual(check(md(120), 120), { minutes: 120, sum: 120, labelled: 2, ok: true }, '코드 블록 안의 제목은 세지 않는다');
        assert.deepStrictEqual([check(md(110), 120).ok, check(md(130), 120).ok, check(md(100), 120).ok, check(md(140), 120).ok], [true, true, false, false]);
        assert.deepStrictEqual(check('## 실습\n\n글', 120), { minutes: 120, sum: 0, labelled: 0, ok: false });
        assert.strictEqual(call(pure, 'practiceTimeCheck')(md(60), 0), null, '정하지 않으면 보지 않는다');
        const generate = async (minutes, draft) => {
            const ctx = genContext();
            ctx.currentMod = lessonOf({}, minutes ? { gen: { basicPracMinutes: minutes } } : {});
            ctx.callGemini = volumeModel(ctx, { tabReply: () => reply(draft) });
            const result = plain(await call(ctx, 'generateTabContent')(1, 'basicPrac', { quiet: true }));
            assert.strictEqual(result.ok, true, '막지 않고 저장한다');
            return ctx.toasts.filter(item => item.kind === 'warning').map(item => item.message);
        };
        const off = await generate(120, md(60));
        assert.ok(off.length === 1 && off[0].startsWith('기본실습의 ## 제목 시간(⏱) 합계가 60분으로, 정한 실습 시간 120분과 10% 넘게 차이 납니다.'), JSON.stringify(off));
        assert.deepStrictEqual(await generate(120, md(120)), []);
        assert.deepStrictEqual(await generate(0, md(60)), [], '정하지 않으면 예전처럼 보지 않는다');
        const missing = await generate(120, '## 실습\n\n글입니다.');
        assert.ok(missing.length === 1 && missing[0].includes('시간 표시가 없어 정한 실습 시간 120분에 맞는지 알 수 없습니다'), JSON.stringify(missing));
        // 컨벤션 검수 패널에 실습 시간과 (⏱) 합계를 보인다
        const ctx = genContext();
        const lesson = lessonOf({ basicPrac: md(60) }, { gen: { basicPracMinutes: 120 } });
        const panel = call(ctx, 'reviewPanelHtml')(lesson, 'basicPrac', md(60), false);
        assert.ok(panel.includes('실습 시간 120분 · (⏱) 합계 60분') && panel.includes('text-amber-300'), panel.slice(0, 600));
        assert.ok(call(ctx, 'reviewPanelHtml')(lessonOf({ advPrac: md(60) }), 'advPrac', md(60), false).includes('실습 시간: 정하지 않음(기본 120분)'));
        assert.ok(!call(ctx, 'reviewPanelHtml')(lessonOf({ basicLearn: md(60) }), 'basicLearn', md(60), false).includes('실습 시간'));
    });

    await run('예고: 실습 시간을 정한 실습 탭은 늘어난 이어쓰기 상한만큼 본문 호출을 더 세고, 일괄 생성 창의 칸을 바로 반영한다', () => {
        const ctx = genContext();
        const work = input => plain(call(ctx, 'lessonWork')(input, 'section', 0));
        assert.strictEqual(work({ tabs: ['basicPrac'], practiceMinutes: { basicPrac: 600 } }).practiceCalls, 3);
        assert.ok(!('practiceCalls' in work({ tabs: ['basicPrac'], practiceMinutes: { basicPrac: 270 } })), '270분까지는 기본 상한(3단락) 안');
        assert.ok(!('practiceCalls' in work({ tabs: ['basicLearn'], practiceMinutes: { basicPrac: 600 } })), '만들지 않는 실습 탭은 세지 않는다');
        assert.strictEqual(call(ctx, 'estimateCallSplit')(work({ tabs: ['advPrac'], practiceMinutes: { advPrac: 450 } })).body, 2 + 2 + 1, '탭 2회 + 늘어난 이어쓰기 2회 + NCS 1회');
        [0, 10, 90, 270, 280, 450, 540, 600].forEach(n => assert.strictEqual(call(ctx, 'practiceExtraCalls')(n), call(ctx, 'tabChunkLimit')('basicPrac', n) - 3, `${n}분: 예고와 탭 생성의 상한이 같다`));
        ctx.globalState.courseDesign = { genOptions: { basicPracMinutes: 600 } };
        assert.deepStrictEqual(plain(call(ctx, 'lessonPracticeWork')({ id: 1, gen: { advPracMinutes: 360 } })), { basicPrac: 600, advPrac: 360 });
        const lesson = lessonOf({ basicLearn: '글', advLearn: '글', assessment: '글' });
        const queue = [{ subject: { id: 's1', title: '교과', lessons: [lesson] }, lessonId: 1, title: '차시' }];
        const runWork = genOptions => plain(call(ctx, 'lessonRunWork')(queue, { withGyosuan: false, overwrite: false, art: false, genOptions }));
        assert.deepStrictEqual([runWork({}).practiceCalls, runWork({ advPracMinutes: 540 }).practiceCalls], [undefined, 3], '창에 적은 과정 기본값으로 센다');
    });

    await run('일괄 생성 보고: 낭독 목표에 못 미친 학습 탭을 탭마다 적고, 다시 시도한 탭과 합친다', async () => {
        const ctx = genContext();
        ctx.currentMod = lessonOf({ basicPrac: '글', advPrac: '글', assessment: '글', advAssessment: '글' }); // 빈 탭은 두 학습 탭뿐
        vm.runInContext("generateTabContent = async (id, tabId) => { window.currentMod.tabContents[tabId] = '## 글'; return { ok: true, short: true, readMinutes: tabId === 'basicLearn' ? 300 : 340, targetMinutes: 360 }; };", ctx);
        const filled = plain(await call(ctx, 'fillMissingTabs')(1));
        assert.deepStrictEqual([filled.short, filled.readMinutes, filled.shortTabs], [true, 300, [{ tabId: 'basicLearn', label: '기본학습', readMinutes: 300 }, { tabId: 'advLearn', label: '심화학습', readMinutes: 340 }]]);
        const item = { lessonId: 1, title: '게임 경제', subject: { id: 's1', title: '교과' } };
        const report = plain(await call(ctx, 'runLessonQueue')([item], async () => ({ ok: true, ...filled })));
        const html = call(ctx, 'lessonRunReportHtml')(report);
        assert.ok(html.includes('낭독 분량이 목표에 못 미친 차시 1개') && html.includes('기본학습 낭독 약 300분 · 심화학습 낭독 약 340분') && html.includes("'분량 채우기'"), html);
        const merged = plain(call(ctx, 'shortOfAttempts')({ short: true, readMinutes: 300, shortTabs: [filled.shortTabs[0]] }, { ok: true, short: true, readMinutes: 340, shortTabs: [filled.shortTabs[1]] }));
        assert.deepStrictEqual([merged.readMinutes, merged.shortTabs.map(tab => tab.tabId)], [340, ['basicLearn', 'advLearn']]);
        assert.deepStrictEqual(plain(call(ctx, 'shortOfAttempts')({ ok: false }, { ok: true })), {});
    });

    /* ---------- 불러온 저장본 ---------- */
    await run('불러온 저장본: 실습 시간 칸의 이상한 값은 버리고 바른 값은 숫자로 맞춘다. 바른 옵션과 다른 칸은 그대로 두고, 검사 규칙은 지시 쪽과 같다', () => {
        const sctx = { console, window: {}, JSON, Date, Map, Set, Promise };
        vm.createContext(sctx);
        vm.runInContext(source('data-safety.js'), sctx);
        const stateSource = source('state.js').replace(/\r\n/g, '\n');
        const extract = name => {
            const start = stateSource.indexOf(`function ${name}(`);
            const end = stateSource.indexOf('\n}\n', start);
            assert.ok(start >= 0 && end > start, `${name}을 찾지 못함`);
            return stateSource.slice(start, end + 2);
        };
        vm.runInContext(`${extract('generateUniqueId')}\n${extract('sanitizeState')}`, sctx);
        const evil = '"><img src=x onerror=1>';
        const keptGen = { level: '실무 경험자', basicPracMinutes: 120 };
        const state = sctx.sanitizeState({
            courseTitle: '과정',
            courseDesign: { title: '설계', genOptions: { basicPracMinutes: '180', advPracMinutes: evil, level: '비전공 입문' } },
            subjects: [{ id: 's1', title: '교과', lessons: [
                { id: 1, title: '가', gen: { basicPracMinutes: 95, advPracMinutes: 600, objectives: '2' } },
                { id: 2, title: '나', gen: keptGen },
                { id: 3, title: '다', gen: 'x' },
                { id: 4, title: '라', gen: { basicPracMinutes: { toString: null }, advPracMinutes: true } },
                { id: 5, title: '마' }
            ] }]
        });
        assert.deepStrictEqual(plain(state.courseDesign), { title: '설계', genOptions: { basicPracMinutes: 180, level: '비전공 입문' } });
        const [a, b, c, d, e] = state.subjects[0].lessons;
        assert.deepStrictEqual(plain(a.gen), { advPracMinutes: 600, objectives: '2' });
        assert.strictEqual(b.gen, keptGen, '바른 옵션은 같은 객체');
        assert.deepStrictEqual([c.gen, plain(d.gen), e.gen], [undefined, {}, undefined]);
        assert.deepStrictEqual(plain(sctx.sanitizeState({ subjects: [], courseDesign: { genOptions: [120] } }).courseDesign), {}, '객체가 아닌 기본값은 지운다');
        assert.deepStrictEqual(plain(sctx.sanitizeState({ subjects: [], courseDesign: { tools: [] } }).courseDesign), { tools: [] }, '옵션이 없으면 그대로');
        vm.runInContext(source('lesson-lint.js'), sctx);
        [10, 120, 600, '120', ' 90 ', 5, 95, 605, 12.5, '12a', '', null, undefined, true, {}, [], NaN].forEach(value => {
            assert.strictEqual(vm.runInContext('safePracticeMinutes', sctx)(value), vm.runInContext('practiceMinutesValue', sctx)(value), JSON.stringify(value));
        });
    });

    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
