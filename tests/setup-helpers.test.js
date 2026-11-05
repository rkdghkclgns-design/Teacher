// 처음 쓰는 사람을 돕는 계산 테스트 (실행: node tests/setup-helpers.test.js)
// AI 오류 문구(ai-errors.js), 빠른 설정·모델 자동 선택·예시 과정 판정(setup-helpers.js)을 DOM 없이 확인한다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const ctx = { console, window: {} };
vm.createContext(ctx);
['ai-errors.js', 'setup-helpers.js'].forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), ctx));
// function 선언은 ctx에, const 화살표 함수는 window로 내보낸 쪽에 있다
const { friendlyAiError, aiError, aiProviderOf, keyCheckResult, presetValues, activePreset, autoTextModel, isExampleCourse } = { ...ctx, ...ctx.window };

let failed = 0;
let count = 0;
const test = (name, fn) => {
    count++;
    try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
};

/* ---------- AI 오류 ---------- */
test('키가 틀리면(401, 400 API_KEY_INVALID) 키를 다시 넣으라고, 위치는 오른쪽 위 ⚙', () => {
    const invalid = friendlyAiError(400, '{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}', 'Gemini');
    assert.ok(invalid.startsWith('Gemini 키가 맞지 않습니다(400)'), invalid);
    assert.ok(invalid.includes('오른쪽 위 ⚙ 설정') && invalid.includes('연결 확인'));
    assert.ok(friendlyAiError(401, '', 'Claude').startsWith('Claude 키가 맞지 않습니다(401)'));
    assert.ok(!invalid.includes('{'), '원문 JSON을 화면에 보이지 않는다');
});

test('한도·권한·모델 없음·서버·인터넷 끊김은 각각 다음에 할 일을 알려 준다', () => {
    assert.ok(friendlyAiError(429).includes("'빠르고 저렴하게'"));
    assert.ok(friendlyAiError(403, '', 'Gemini').includes('쓸 수 없습니다(403)'));
    assert.ok(friendlyAiError(404).includes('다른 모델'));
    assert.ok(friendlyAiError(503).includes('1~2분 뒤'));
    assert.ok(friendlyAiError(0).includes('인터넷'));
    assert.ok(friendlyAiError(400, 'something else').includes('(400)'));
});

test('잔액 부족은 충전하라고 알리고, 원문에 billing이 있는 429는 한도로 본다', () => {
    const credit = friendlyAiError(400, 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing', 'Claude');
    assert.ok(credit.startsWith('Claude 콘솔의 잔액(크레딧)이 부족'), credit);
    assert.ok(!credit.includes('내용을 조금 줄이거나'), '내용을 줄이라는 엉뚱한 안내를 하지 않는다');
    assert.ok(friendlyAiError(402, '', 'Gemini').includes('Google AI Studio'));
    const quota = friendlyAiError(429, 'You exceeded your current quota, please check your plan and billing details.', 'Gemini');
    assert.ok(quota.startsWith('AI 사용 한도를 넘었습니다(429)'), quota);
});

test('오류 객체: 화면 문장, 상태 코드, 원문은 detail로, 키·모델 문제는 다시 시도하지 않는다', () => {
    const err = aiError(401, 'x'.repeat(500), 'Gemini');
    assert.strictEqual(err.status, 401);
    assert.strictEqual(err.detail.length, 300);
    assert.strictEqual(err.noRetry, true);
    assert.strictEqual(aiError(429).noRetry, false);
    assert.strictEqual(aiError(503).noRetry, false);
    assert.strictEqual(aiProviderOf('https://generativelanguage.googleapis.com/v1beta/models/x'), 'Gemini');
    assert.strictEqual(aiProviderOf('https://api.anthropic.com/v1/models'), 'Claude');
});

test('키 연결 확인 결과', () => {
    assert.strictEqual(keyCheckResult(200).ok, true);
    assert.strictEqual(keyCheckResult(400).text, '키가 맞지 않습니다');
    assert.strictEqual(keyCheckResult(401).ok, false);
    assert.strictEqual(keyCheckResult(429).ok, true, '한도에 걸려도 키는 맞다');
    assert.ok(keyCheckResult(0).text.includes('인터넷'));
});

/* ---------- 빠른 설정 ---------- */
test('빠른 설정은 가진 키에 맞는 모델을 고른다(Gemini 키가 있으면 Gemini, Claude 키만 있으면 Claude)', () => {
    assert.strictEqual(presetValues('saving', true, false).textModel, 'gemini-3.8-flash');
    assert.strictEqual(presetValues('saving', false, true).textModel, 'claude-haiku-5-5');
    assert.strictEqual(presetValues('saving', false, false).textModel, 'gemini-3.8-flash', '키가 없으면 무료로 시작할 수 있는 Gemini');
    assert.strictEqual(presetValues('quality', true, true).textModel, 'gemini-4-argon');
    assert.strictEqual(presetValues('saving', true, false).images, 'section');
    assert.strictEqual(presetValues('없음', true, false), null);
});

test('지금 설정과 같은 빠른 설정 묶음을 찾는다', () => {
    assert.strictEqual(activePreset({ textModel: 'gemini-3.8-flash', effort: 'medium', images: 'section' }, true, false), 'saving');
    assert.strictEqual(activePreset({ textModel: 'claude-fable-5-1', effort: 'high', images: 'all' }, false, true), 'quality');
    assert.strictEqual(activePreset({ textModel: 'gemini-3.8-flash', effort: 'high', images: 'section' }, true, false), null, '하나라도 다르면 없음');
});

test('키를 저장하면 고른 모델에 맞는 키가 없을 때만 가진 키의 모델로 바꾼다', () => {
    const isClaude = model => model.startsWith('claude');
    assert.strictEqual(autoTextModel('gemini-3.8-flash', false, true, isClaude), 'claude-sonnet-5-5', 'Claude 키만 있음');
    assert.strictEqual(autoTextModel('claude-opus-5-5', true, false, isClaude), 'gemini-3.8-flash', 'Gemini 키만 있음');
    assert.strictEqual(autoTextModel('gemini-4-argon', true, true, isClaude), null);
    assert.strictEqual(autoTextModel('claude-opus-5-5', false, false, isClaude), null, '키가 하나도 없으면 그대로');
});

test('분야를 넣기 전 과정은 과정명에서 분야를 읽는다', () => {
    const { fieldFromCourseTitle } = { ...ctx, ...ctx.window };
    assert.strictEqual(fieldFromCourseTitle('게임 기획 전문가 양성 과정'), '게임 기획');
    assert.strictEqual(fieldFromCourseTitle('간호 실무 과정'), '간호 실무');
    assert.strictEqual(fieldFromCourseTitle('웹 개발 부트캠프'), '웹 개발 부트캠프');
    assert.strictEqual(fieldFromCourseTitle('새 과정'), '', '이름 없는 과정은 분야를 읽지 않는다');
    assert.strictEqual(fieldFromCourseTitle('새로운 과정'), '');
    assert.strictEqual(fieldFromCourseTitle('제목 없음'), '');
    assert.strictEqual(fieldFromCourseTitle('새싹 코딩 과정'), '새싹 코딩', "'새'로 시작하는 진짜 과정명은 읽는다");
    assert.strictEqual(fieldFromCourseTitle('새내기 간호 교육'), '새내기 간호');
    assert.strictEqual(fieldFromCourseTitle(''), '');
});

test('예시 과정 판정: 표시가 있거나, 표시 전에 저장한 예시 과정 id. 과정 정보를 저장하면 아니다', () => {
    assert.strictEqual(isExampleCourse({ isExample: true }), true);
    assert.strictEqual(isExampleCourse({ courseId: 'course_mock_1' }), true);
    assert.strictEqual(isExampleCourse({ courseId: 'course_mock_1', isExample: false }), false);
    assert.strictEqual(isExampleCourse({ courseId: 'course_123' }), false);
    assert.strictEqual(isExampleCourse(null), false);
});

/* ---------- 키 연결 확인(가짜 fetch, 실제 호출 없음) ---------- */
const asyncTests = [];
const testAsync = (name, fn) => asyncTests.push([name, fn]);

// 키 칸 아래 상태 글자를 흉내 낸다
const labels = {};
ctx.document = {
    getElementById: id => (labels[id] = labels[id] || { className: '', textContent: '', classList: { toggle() {} } })
};
ctx.GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

testAsync('키에 공백·한글이 섞이면 호출하지 않고 그 이유를 알린다(인터넷 문제로 보이지 않게)', async () => {
    let called = 0;
    ctx.fetch = async () => { called++; return { status: 200 }; };
    const result = await ctx.checkAiKey('gemini', 'AIza-FAKE 한글');
    assert.strictEqual(result.ok, false);
    assert.ok(result.text.includes('쓸 수 없는 글자'), result.text);
    assert.ok(!result.text.includes('인터넷'));
    assert.strictEqual(called, 0);
    assert.strictEqual((await ctx.checkAiKey('gemini', 'AIza-FAKE-TEST-KEY')).text, '연결됨');
    assert.strictEqual(called, 1);
});

testAsync('연결 확인을 빠르게 두 번 누르면 늦게 온 예전 결과가 새 결과를 덮지 않는다', async () => {
    ctx.apiKey = 'AIza-FAKE-TEST-KEY';
    const pending = [];
    ctx.fetch = () => new Promise(resolve => pending.push(resolve));
    const first = ctx.verifyAiKey('gemini');
    const second = ctx.verifyAiKey('gemini');
    pending[1]({ status: 200 }); // 새 확인이 먼저 끝나고
    await second;
    pending[0]({ status: 401 }); // 예전 확인이 늦게 온다
    await first;
    assert.strictEqual(labels['api-key-status-text'].textContent, '연결됨');
});

(async () => {
    for (const [name, fn] of asyncTests) {
        count++;
        try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
    }
    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
