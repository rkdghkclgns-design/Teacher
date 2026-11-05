// 일괄 작업 예고 계산 테스트 (실행: node tests/cost-estimate.test.js)
// 할 일 개수 → AI 호출 수·그림 장수·시간 범위·비용 수준, 잰 시간 기록을 DOM 없이 확인한다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const store = {};
const ctx = {
    console, window: {}, JSON, Math, Object,
    localStorage: { getItem: key => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); } }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cost-estimate.js'), 'utf8'), ctx);
const { modelCostTier, lessonWork, sumWork, estimateCalls, recordAiTiming, readAiTimings, estimateSummary, estimateLine, estimateNote } = { ...ctx, ...ctx.window };
const plain = value => JSON.parse(JSON.stringify(value));

let failed = 0;
let count = 0;
const test = (name, fn) => {
    count++;
    try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
};

test('비용 수준: 빠른 모델은 낮음, 최고 모델은 높음, 나머지는 보통', () => {
    assert.strictEqual(modelCostTier('gemini-3.8-flash'), 'low');
    assert.strictEqual(modelCostTier('claude-haiku-5-5'), 'low');
    assert.strictEqual(modelCostTier('claude-opus-5-5'), 'high');
    assert.strictEqual(modelCostTier('claude-fable-5-1'), 'high');
    assert.strictEqual(modelCostTier('gemini-4-argon'), 'mid', "'gemini' 안의 mini로 낮음이 되지 않는다");
    assert.strictEqual(modelCostTier('gpt-5-mini'), 'low');
    assert.strictEqual(modelCostTier(''), 'mid');
});

test('할 일 개수: 탭과 그림 자리, 교수안·문제은행·삽화·NCS를 더한다', () => {
    const one = plain(lessonWork({ tabs: 5, gyosuan: true, qbank: true }, 'section'));
    assert.deepStrictEqual(one, { tabs: 5, images: 15, ncs: 1, gyosuan: 1, qbank: 1, art: 0 });
    assert.strictEqual(plain(lessonWork({ tabs: 2 }, 'none')).images, 0, '이미지 양이 넣지 않음이면 그림 없음');
    assert.strictEqual(plain(lessonWork({}, 'all')).ncs, 0, '탭을 만들지 않으면 NCS 배정도 없다');
    const total = plain(sumWork([one, plain(lessonWork({ tabs: 1 }, 'all'))]));
    assert.strictEqual(total.tabs, 6);
    assert.strictEqual(total.images, 19);
    // 5×1.3 + 15×2 + 1 + 3 + 2 = 42.5 → 43
    assert.strictEqual(estimateCalls(one), 43);
    assert.strictEqual(estimateCalls({}), 0);
    assert.strictEqual(estimateCalls({ ocr: 3 }), 3);
});

test('시간: 잰 기록이 없으면 모델·추론 강도로, 3번 넘게 재면 그 평균으로', () => {
    const guessed = plain(estimateSummary({ tabs: 10 }, { model: 'gemini-3.8-flash', effort: 'medium', timings: {} }));
    // 13회 × 20초 = 260초 ≈ 4.3분 → 3~7분
    assert.deepStrictEqual([guessed.calls, guessed.minutesLow, guessed.minutesHigh, guessed.measured, guessed.costLabel], [13, 3, 7, false, '낮음']);
    const slow = plain(estimateSummary({ tabs: 10 }, { model: 'claude-opus-5-5', effort: 'max', timings: {} }));
    assert.ok(slow.minutesHigh > guessed.minutesHigh * 4, '최고 모델·최대 강도는 훨씬 오래 걸린다');
    ['a', 'b', 'c'].forEach(() => recordAiTiming('gemini-3.8-flash', 6000));
    assert.strictEqual(readAiTimings()['gemini-3.8-flash'].avg, 6000);
    const measured = plain(estimateSummary({ tabs: 10 }, { model: 'gemini-3.8-flash', effort: 'medium' }));
    assert.strictEqual(measured.measured, true);
    assert.strictEqual(measured.minutesLow, 1, '짧아도 1분부터');
    recordAiTiming('', 100);
    recordAiTiming('x', -5);
    assert.deepStrictEqual(Object.keys(readAiTimings()), ['gemini-3.8-flash'], '잘못된 기록은 넣지 않는다');
});

test('보이는 글: 호출·그림·시간·비용 수준과 안내', () => {
    const summary = plain(estimateSummary({ tabs: 2, images: 6 }, { model: 'gemini-3.8-flash', timings: {} }));
    const line = estimateLine(summary, 'Gemini 3.8 Flash');
    assert.ok(line.startsWith('AI 호출 약 15회 · 그림 최대 6장 · '), line);
    assert.ok(line.endsWith('비용 수준 낮음(Gemini 3.8 Flash)'), line);
    assert.ok(estimateNote(summary, 'gemini-3.8-flash').includes('분당 호출 한도'));
    assert.ok(!estimateNote(plain(estimateSummary({ tabs: 1 }, { model: 'claude-sonnet-5-5', timings: {} })), 'claude-sonnet-5-5').includes('분당'));
    assert.ok(estimateLine(plain(estimateSummary({ ocr: 1 }, { model: 'gemini-3.8-flash', timings: {} }))).includes('1분 안쪽'));
});

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
