// 일괄 작업 예고 계산 테스트 (실행: node tests/cost-estimate.test.js)
// 할 일 개수 → 글 호출 수·비용 수준, 그림 장수·그리는 곳·요금 방식, 시간 범위와 잰 시간 기록(본문·짧은 호출·그림)을 DOM 없이 확인한다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'cost-estimate.js'), 'utf8');
const store = {};
const ctx = {
    console, window: {}, JSON, Math, Object,
    localStorage: { getItem: key => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); } }
};
vm.createContext(ctx);
vm.runInContext(SOURCE, ctx);
const { modelCostTier, lessonWork, tabImageCount, sumWork, estimateCallSplit, estimateCalls, recordAiTiming, readAiTimings, secondsPerCall, estimateSummary, estimateLines, estimateNote } = { ...ctx, ...ctx.window };
const plain = value => JSON.parse(JSON.stringify(value));

let failed = 0;
let count = 0;
const test = (name, fn) => {
    count++;
    try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
};

// 차시 하나 전부: 탭 5개(핵심만) + 교수안(슬라이드 그림 4장) + 문제은행 + NCS
const FULL = { tabs: 5, images: 15, slideImages: 4, ncs: 1, gyosuan: 1, qbank: 1, art: 0 };
const FLASH = { model: 'gemini-3.8-flash', effort: 'medium', timings: {} };
const LABELS = { modelLabel: 'Gemini 3.8 Flash', imageLabel: 'Nano Banana 2.1' };
const summary = (work, extra = {}) => plain(estimateSummary(work, { ...FLASH, ...extra }));
const lines = (work, extra = {}, labels = LABELS) => plain(estimateLines(summary(work, extra), labels));

test('비용 수준: 빠른 모델은 낮음, 최고 모델은 높음, 나머지는 보통', () => {
    assert.strictEqual(modelCostTier('gemini-3.8-flash'), 'low');
    assert.strictEqual(modelCostTier('claude-haiku-5-5'), 'low');
    assert.strictEqual(modelCostTier('claude-opus-5-5'), 'high');
    assert.strictEqual(modelCostTier('claude-fable-5-1'), 'high');
    assert.strictEqual(modelCostTier('gemini-4-argon'), 'mid', "'gemini' 안의 mini로 낮음이 되지 않는다");
    assert.strictEqual(modelCostTier('gpt-5-mini'), 'low');
    assert.strictEqual(modelCostTier(''), 'mid');
});

test('할 일 개수: 탭·교안 그림·슬라이드 그림·교수안·문제은행·삽화·NCS를 더한다', () => {
    // 탭 수만 알면 여섯 탭(심화이해도 포함)의 평균으로 그림을 센다(탭 하나에 3장, 다섯 탭이면 15장으로 FULL과 같다)
    assert.deepStrictEqual(plain(lessonWork({ tabs: 5, gyosuan: true, qbank: true }, 'section', 4)), FULL);
    assert.strictEqual(plain(lessonWork({ tabs: 5 }, 'section', 4)).slideImages, 0, '교수안을 만들지 않으면 슬라이드 그림도 없다');
    assert.strictEqual(plain(lessonWork({ tabs: 1, gyosuan: true }, 'section')).slideImages, 0, '슬라이드 자동 이미지를 모르면 0장');
    ctx.window.KBuilder = { autoImages: { count: () => 8 } };
    assert.strictEqual(plain(lessonWork({ tabs: 1, gyosuan: true }, 'section')).slideImages, 8, '슬라이드 자동 이미지 장수를 따른다');
    delete ctx.window.KBuilder;
    assert.strictEqual(plain(lessonWork({ tabs: 2 }, 'none')).images, 0, '이미지 양이 넣지 않음이면 교안 그림 없음');
    assert.strictEqual(plain(lessonWork({}, 'all')).ncs, 0, '탭을 만들지 않으면 NCS 배정도 없다');
    const total = plain(sumWork([FULL, plain(lessonWork({ tabs: ['basicLearn'], gyosuan: true }, 'all', 4))]));
    assert.deepStrictEqual([total.tabs, total.images, total.slideImages], [6, 37, 8]);
});

test('그림 자리: 탭마다 탭 글 규칙의 최소 섹션 수로 센다(모두는 학습 탭의 긴 소주제까지, 학습 이해도는 0)', () => {
    const ALL_TABS = ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment', 'advAssessment'];
    // 핵심만: ## 섹션마다(기본·심화 학습은 학습 목표·개요를 빼고 6개) / 모두: ## 섹션과 긴 ### 소주제마다(기본·심화 학습 6+16)
    assert.strictEqual(tabImageCount(ALL_TABS, 'section'), 18);
    assert.strictEqual(tabImageCount(ALL_TABS, 'all'), 50, '모두는 탭 다섯 개에 4장씩(20장)이 아니라 50장');
    assert.strictEqual(tabImageCount(['basicLearn'], 'all'), 22);
    assert.strictEqual(tabImageCount(['advLearn'], 'all'), 22, '심화 학습도 기본 학습과 같은 구조(## 8개·### 16개)');
    assert.strictEqual(tabImageCount(['assessment'], 'all'), 0, '학습 이해도는 문제(짧은 소주제)뿐');
    assert.strictEqual(tabImageCount(['advAssessment'], 'all'), 0, '심화 이해도도 문제뿐');
    assert.strictEqual(tabImageCount(['basicPrac', 'advPrac'], 'section'), 6);
    assert.strictEqual(tabImageCount(ALL_TABS, 'none'), 0);
    assert.strictEqual(tabImageCount(['constructor', '__proto__'], 'all'), 0, '모르는 탭 이름은 세지 않는다');
    // 심화 학습을 만들면 기본 학습처럼 낭독 분량 채우기도 센다. 실습 시간을 모르면 학습 탭은 480 − 120 = 360분(긴 호출 18 + 자동 수정 3 = 21번)
    assert.deepStrictEqual(plain(lessonWork({ tabs: ['basicPrac', 'advLearn'] }, 'all', 0)), { tabs: 2, images: 25, slideImages: 0, ncs: 1, gyosuan: 0, qbank: 0, art: 0, volume: 1, volumeCalls: 21, volumeMinutes: 360, volumeAdv: 1 });
    assert.strictEqual(plain(lessonWork({ tabs: [] }, 'all')).ncs, 0, '빈 탭 목록이면 NCS 배정도 없다');
    assert.strictEqual(plain(lessonWork({ tabs: 6 }, 'all', 0)).images, 50, '탭 수만 알면 여섯 탭의 평균으로 센다');
});

test('교수안·문제은행은 갈래(기본학습·심화학습)마다 하나씩 센다: 교수안 둘이면 교수안 호출과 슬라이드 그림도 두 배', () => {
    const one = plain(lessonWork({ tabs: 0, gyosuan: true, qbank: true, ncs: false }, 'section', 4));
    const two = plain(lessonWork({ tabs: 0, gyosuan: 2, qbank: 2, ncs: false }, 'section', 4));
    assert.deepStrictEqual([one.gyosuan, one.qbank, one.slideImages], [1, 1, 4]);
    assert.deepStrictEqual([two.gyosuan, two.qbank, two.slideImages], [2, 2, 8]);
    assert.strictEqual(plain(estimateCallSplit(two)).body, 2 * (12 + 1) + 2 * 2, '교수안 12번과 간이 교수안 1번 × 2 + 문제은행 2번 × 2');
    assert.deepStrictEqual([plain(lessonWork({ gyosuan: 0, qbank: false }, 'section', 4)).gyosuan, plain(lessonWork({ gyosuan: -3, qbank: 'x' }, 'section', 4)).qbank], [0, 0], '이상한 값은 0');
});

test('호출 수: 본문·짧은 호출·그림을 나눠 세고, SVG 삽화면 그림 장수만큼 글 호출이 는다', () => {
    // 탭 5×2 + NCS 1 + 문제은행 2 + 교수안 12 + 간이 교수안 1 = 26, 기다리는 시간은 교수안을 6으로(간이 교수안은 그대로 1) / 짧은 호출 15×1 + 4×2 = 23
    assert.deepStrictEqual(plain(estimateCallSplit(FULL)), { body: 26, bodyWait: 20, short: 23, images: 19 });
    assert.strictEqual(estimateCalls(FULL), 49);
    assert.strictEqual(estimateCalls(FULL, 'svg'), 68);
    assert.strictEqual(estimateCalls({}), 0);
    assert.strictEqual(estimateCalls({ ocr: 3 }), 3);
});

test('시간: 잰 기록이 없으면 모델·추론 강도로 어림하고 그림·간격을 더한다', () => {
    const guessed = summary({ tabs: 10 });
    // 20회 × 20초 + 탭 사이 10 × 4초 = 440초 ≈ 7.3분 → 5~11분
    assert.deepStrictEqual([guessed.calls, guessed.minutesLow, guessed.minutesHigh, guessed.measured, guessed.costLabel], [20, 5, 11, false, '낮음']);
    const full = summary(FULL);
    assert.deepStrictEqual([full.minutesLow, full.minutesHigh], [13, 29], '본문 20×20초 + 짧은 호출 23×6초 + 그림 19×25초 + 간격 125초');
    const svg = summary(FULL, { imageSource: 'svg' });
    assert.deepStrictEqual([svg.minutesLow, svg.minutesHigh], [12, 27], 'SVG 삽화는 그림 한 장을 본문 호출 하나로 잰다');
    const slow = summary({ tabs: 10 }, { model: 'claude-opus-5-5', effort: 'max' });
    assert.deepStrictEqual([slow.minutesLow, slow.minutesHigh], [42, 91]);
    assert.ok(slow.minutesHigh > guessed.minutesHigh * 4, '최고 모델·최대 강도는 훨씬 오래 걸린다');
    const xhigh = summary({ tabs: 10 }, { model: 'claude-opus-5-5', effort: 'xhigh' });
    const high = summary({ tabs: 10 }, { model: 'claude-opus-5-5', effort: 'high' });
    assert.deepStrictEqual([xhigh.minutesHigh, high.minutesHigh], [80, 69], '매우 높음은 높음보다 오래 걸린다');
});

test('시간: 본문·짧은 호출·그림 모델을 따로 잰 기록을 쓴다', () => {
    const timings = {
        'gemini-3.8-flash': { count: 3, avg: 10000 },
        'gemini-3.8-flash#short': { count: 3, avg: 2000 },
        'gemini-nano-banana-2.1': { count: 3, avg: 20000 }
    };
    const measured = summary(FULL, { timings, imageModel: 'gemini-nano-banana-2.1' });
    // 20×10 + 23×2 + 19×20 + 125 = 751초 ≈ 12.5분 → 9~19분
    assert.deepStrictEqual([measured.minutesLow, measured.minutesHigh, measured.measured], [9, 19, true]);
});

test('기록: 본문 호출과 짧은 호출을 따로 모으고, 예전 기록은 본문 시간으로 읽는다', () => {
    ['a', 'b', 'c'].forEach(() => recordAiTiming('gemini-3.8-flash', 6000));
    assert.strictEqual(readAiTimings()['gemini-3.8-flash'].avg, 6000);
    ['a', 'b', 'c'].forEach(() => recordAiTiming('gemini-3.8-flash', 2000, 'short'));
    assert.strictEqual(readAiTimings()['gemini-3.8-flash#short'].avg, 2000);
    assert.strictEqual(readAiTimings()['gemini-3.8-flash'].avg, 6000, '짧은 호출이 본문 평균을 줄이지 않는다');
    recordAiTiming('', 100);
    recordAiTiming('x', -5);
    assert.deepStrictEqual(Object.keys(readAiTimings()), ['gemini-3.8-flash', 'gemini-3.8-flash#short'], '잘못된 기록은 넣지 않는다');
    const measured = plain(estimateSummary({ tabs: 10 }, { model: 'gemini-3.8-flash', effort: 'medium' }));
    assert.deepStrictEqual([measured.minutesLow, measured.minutesHigh, measured.measured], [2, 4, true]);
    store['teacher:ai-timing'] = '{"gemini-3.8-flash":{"count":10,"avg":30000}}';
    assert.strictEqual(secondsPerCall('gemini-3.8-flash', 'medium').seconds, 30);
    assert.deepStrictEqual(plain(secondsPerCall('gemini-3.8-flash', 'medium', undefined, 'short')), { seconds: 6, measured: false }, '짧은 호출 기록이 없으면 본문의 0.3배로 어림');
});

test('보이는 글: 글·그림·걸리는 시간 세 줄, 장수는 약(남은 자리는 그대로), 최대·이상은 쓰지 않는다', () => {
    const full = lines(FULL);
    assert.deepStrictEqual(full, ['글: AI 호출 약 49회 · 비용 낮음(Gemini 3.8 Flash)', '그림: 약 19장(슬라이드 그림 4장 포함) · Nano Banana 2.1 · 장마다 요금', '걸리는 시간: 약 13~29분']);
    const svg = lines(FULL, { imageSource: 'svg' });
    assert.strictEqual(svg[1], '그림: 약 19장(슬라이드 그림 4장 포함) · 글 모델이 SVG로 그림 · 글 비용에 포함');
    assert.ok(svg[0].includes('약 68회'), svg[0]);
    const higgs = lines(FULL, { imageSource: 'higgsfield' }, { ...LABELS, imageLabel: 'Higgsfield · Recraft V4.1' });
    assert.ok(higgs[1].endsWith('· Higgsfield · Recraft V4.1 · 크레딧 사용'), higgs[1]);
    assert.ok(lines({ tabs: 5, images: 20 })[1].startsWith('그림: 약 20장 · '));
    assert.strictEqual(lines({ images: 6 }, { exactImages: true })[1], '그림: 6장 · Nano Banana 2.1 · 장마다 요금');
    assert.ok(lines({ gyosuan: 1, slideImages: 4 })[1].startsWith('그림: 약 4장(슬라이드 그림) · '));
    const textOnly = lines({ tabs: 2 });
    assert.ok(!textOnly.some(line => line.startsWith('그림:')), '그림이 없으면 그림 줄이 없다');
    [full, svg, higgs, textOnly].flat().forEach(line => assert.ok(!/최대|이상/.test(line), line));
    assert.strictEqual(lines({ ocr: 1 }).at(-1), '걸리는 시간: 1분 안쪽');
    assert.strictEqual(lines({ tabs: 200, images: 600, slideImages: 160, ncs: 40, gyosuan: 40, qbank: 40 }).at(-1), '걸리는 시간: 약 9~19시간', '2시간이 넘으면 시간 단위');
});

test('안내: 그림 모델은 무료 키로 못 쓸 수 있음, 역할별 분배, 무료 키 분당 한도', () => {
    assert.ok(estimateNote(summary(FULL), 'gemini-3.8-flash').includes('그림 자리만 남깁니다'));
    const searched = estimateNote(summary(FULL, { imageSearch: true }), 'gemini-3.8-flash');
    assert.ok(searched.includes('교안 그림은 검색으로 찾고 못 찾은 자리만 남깁니다(슬라이드 그림은 만들지 못합니다)') && !searched.includes('그림 자리만 남깁니다'), '검색 키가 있으면 교안 그림은 검색으로 찾는다고 말한다');
    assert.ok(estimateNote(summary({ tabs: 5, images: 15 }, { imageSearch: true }), 'gemini-3.8-flash').includes('못 찾은 자리만 남깁니다.'), '슬라이드 그림이 없으면 슬라이드 이야기는 없다');
    assert.ok(estimateNote(summary({ gyosuan: 1, slideImages: 4 }, { imageSearch: true }), 'gemini-3.8-flash').includes('그때는 슬라이드 그림을 만들지 못합니다.'), '슬라이드 그림만이면 검색 이야기를 하지 않는다');
    assert.ok(estimateNote(summary(FULL, { imageAmount: 'all' }), 'gemini-3.8-flash').includes("교안 이미지 양이 '모두'라 글이 길면 그림이 더 늘어납니다."));
    assert.ok(!estimateNote(summary(FULL, { imageAmount: 'section' }), 'gemini-3.8-flash').includes('더 늘어납니다'));
    assert.ok(!estimateNote(summary({ images: 6 }, { imageAmount: 'all', exactImages: true }), 'gemini-3.8-flash').includes('더 늘어납니다'), '남은 자리를 그대로 셌으면 늘지 않는다');
    assert.ok(!estimateNote(summary(FULL, { imageSource: 'svg' }), 'gemini-3.8-flash').includes('그림 자리만'), 'SVG 삽화는 그림 모델을 쓰지 않는다');
    assert.ok(estimateNote(summary({ tabs: 1 }, { routed: true }), 'gemini-3.8-flash').includes('역할별 AI 분배'));
    assert.ok(estimateNote(summary({ tabs: 1 }), 'gemini-3.8-flash').includes('분당 호출 한도'));
    assert.ok(!estimateNote(summary({ tabs: 1 }, { model: 'claude-sonnet-5-5' }), 'claude-sonnet-5-5').includes('분당'));
});

/* ---------- 지금 설정 읽기(그림을 누가 그리는지, 역할별 분배) ---------- */
const TEXT_MODEL_OPTIONS = [
    { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (무료 등급 지원)' }
];
const IMAGE_MODEL_OPTIONS = [
    { value: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1 (권장 · 최고 성능)' },
    { value: 'gemini-3-pro-image', label: 'Nano Banana Pro' },
    { value: 'gemini-3.1-flash-image', label: 'Nano Banana 2' },
    { value: 'higgsfield:recraft', label: 'Higgsfield · Recraft V4.1 (벡터 일러스트)' },
    { value: 'svg-illustration', label: 'SVG 삽화 (텍스트 모델 · 과정 공용 화풍)' }
];
const confirms = [];
const settingsCtx = {
    console, window: {}, JSON, Math, Object,
    TEXT_MODEL: 'gemini-3.8-flash', TEXT_MODEL_OPTIONS, IMAGE_MODEL_OPTIONS, REASONING_EFFORT: 'medium', LESSON_IMAGE_AMOUNT: 'section',
    localStorage: { getItem: () => null, setItem() {} },
    usesSvgIllustration: () => { throw new Error('그림 모델을 고르지 않았으면 부르지 않는다'); },
    confirmAsync: async message => { confirms.push(message); return true; },
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
};
vm.createContext(settingsCtx);
vm.runInContext(SOURCE, settingsCtx);
const settings = () => plain(vm.runInContext('currentEstimateSettings()', settingsCtx));

test('설정: 그림은 SVG 삽화·Higgsfield·Gemini 가운데 실제로 그리는 쪽으로 본다', () => {
    assert.strictEqual(settings().imageSource, 'gemini', '그림 모델 설정을 읽을 수 없으면 Gemini로 본다');
    settingsCtx.IMAGE_MODEL = 'gemini-nano-banana-2.1';
    settingsCtx.usesSvgIllustration = () => true;
    assert.strictEqual(settings().imageSource, 'svg', 'Gemini 키가 없거나 SVG 삽화를 고르면 글 모델이 그린다');
    settingsCtx.IMAGE_MODEL = 'higgsfield:recraft';
    settingsCtx.usesSvgIllustration = () => false;
    settingsCtx.isHiggsfieldModel = model => String(model).startsWith('higgsfield:');
    settingsCtx.higgsfieldReady = () => true;
    assert.deepStrictEqual([settings().imageSource, settings().imageLabel], ['higgsfield', 'Higgsfield · Recraft V4.1']);
    settingsCtx.higgsfieldReady = () => false;
    const fallback = settings();
    assert.deepStrictEqual([fallback.imageSource, fallback.imageModel, fallback.imageLabel], ['gemini', 'gemini-nano-banana-2.1', 'Nano Banana 2.1'], 'Higgsfield 설정이 없으면 먼저 부르는 Gemini 그림 모델');
});

test('설정: 역할별 분배가 켜져 있으면 본문을 쓰는 모델로 비용과 이름을 보인다', () => {
    settingsCtx.roleModel = () => 'claude-opus-5-5';
    const routed = settings();
    assert.deepStrictEqual([routed.model, routed.modelLabel, routed.routed], ['claude-opus-5-5', 'Claude Opus 5.5', true]);
    assert.strictEqual(plain(vm.runInContext('estimateSummary({ tabs: 1 }, { ...currentEstimateSettings(), timings: {} })', settingsCtx)).costLabel, '높음');
    settingsCtx.TEXT_MODEL = '';
    settingsCtx.roleModel = () => { throw new Error('글 모델이 없으면 부르지 않는다'); };
    assert.strictEqual(settings().model, '');
    settingsCtx.TEXT_MODEL = 'gemini-3.8-flash';
    delete settingsCtx.roleModel;
});

(async () => {
    try {
        settingsCtx.IMAGE_MODEL = 'gemini-nano-banana-2.1';
        await vm.runInContext('confirmWithEstimate', settingsCtx)('그림 자리 6개를 채웁니다.', { images: 6 }, { title: '일괄 이미지 찾기', exactImages: true });
        const message = confirms.at(-1);
        assert.ok(message.startsWith('그림 자리 6개를 채웁니다.\n\n글: AI 호출 약'), message);
        assert.ok(message.includes('그림: 6장 · ') && message.includes('실제 비용은 AI 공급자 요금표를 따릅니다.'), message);
        const box = vm.runInContext('estimateBoxHtml', settingsCtx)(FULL);
        assert.strictEqual((box.match(/<li>/g) || []).length, 3, box);
        assert.ok(box.includes('미리 보기'));
        count++;
        console.log('ok - 확인 창과 예고 상자: 묻는 글 아래에 세 줄과 안내를 붙인다');
    } catch (e) {
        count++;
        failed++;
        console.log(`FAIL - 확인 창과 예고 상자\n  ${e.message}`);
    }
    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
