// 사용 안내(옆 패널) 테스트 (실행: node tests/tutorial.test.js)
// 실제 js/tutorial.js를 vm에서 실행해 단계 내용·짚는 화면 요소·'다시 보지 않기'·본문 그리기를 확인한다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n');

function load(stored = {}) {
    const storage = { ...stored };
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: k => storage[k] ?? null, setItem: (k, v) => { storage[k] = String(v); }, removeItem: k => { delete storage[k]; } },
        document: { querySelector: () => null, getElementById: () => null },
        storage
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'tutorial.js'), 'utf8'), ctx);
    return ctx;
}

const ctx = load();
const steps = vm.runInContext('TUTORIAL_STEPS', ctx);
const key = vm.runInContext('TUTORIAL_KEY', ctx);
let failed = 0;
const test = (name, fn) => {
    try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
};

test('단계마다 제목·요약·무엇인가요·사용 순서가 있고 id가 겹치지 않는다', () => {
    assert.ok(steps.length >= 10, `단계 ${steps.length}개`);
    assert.strictEqual(new Set(steps.map(s => s.id)).size, steps.length);
    for (const step of steps) {
        for (const field of ['id', 'icon', 'title', 'summary', 'what']) assert.ok(String(step[field] || '').trim(), `${step.id}.${field}`);
        assert.ok(Array.isArray(step.how) && step.how.length >= 1, `${step.id}.how`);
    }
});

test('짚는 화면 요소가 실제로 있고, 처음 화면에 없는 요소는 어디서 보이는지 알려 준다', () => {
    for (const step of steps.filter(s => s.target)) {
        const id = step.target.replace(/^#/, '');
        assert.ok(new RegExp(`id="${id}"`).test(html + scripts), `${step.id}: ${step.target} 없음`);
        const alwaysThere = ['btn-settings', 'toolbar-scroll'].includes(id);
        assert.ok(alwaysThere || String(step.where || '').trim(), `${step.id}: where 없음`);
    }
});

test('첫 단계는 시작 전 공지(초안 도구·API 키·문제 발생 시)를 담는다', () => {
    const first = steps[0];
    const text = [first.summary, first.what, ...first.how, ...(first.tips || [])].join(' ');
    for (const word of ['초안', 'API 키', '플로우']) assert.ok(text.includes(word), word);
});

test('본문: 짚을 요소가 보이면 위치 보기 버튼, 없으면 어디서 보이는지 안내', () => {
    const step = steps.find(s => s.id === 'tools');
    const shown = ctx.tutorialStepHtml(step, 7, steps.length, true);
    assert.ok(shown.includes('data-tutorial-action="locate"') && !shown.includes('tutorial-where'));
    const hidden = ctx.tutorialStepHtml(step, 7, steps.length, false);
    assert.ok(hidden.includes('tutorial-where') && hidden.includes('지금 화면에는 없습니다'));
    for (const part of ['8 / ' + steps.length, '무엇인가요?', '이렇게 쓰세요', '알아 두면 좋아요']) assert.ok(shown.includes(part), part);
    assert.ok(!ctx.tutorialStepHtml(steps[0], 0, steps.length, false).includes('tutorial-where'), '짚을 곳이 없는 단계는 안내도 없다');
});

test('목차는 지금 단계를 표시한다', () => {
    const toc = ctx.tutorialTocHtml(2);
    assert.strictEqual((toc.match(/aria-current="step"/g) || []).length, 1);
    assert.ok(toc.includes(`data-tutorial-step="${steps.length - 1}"`));
});

test("'다시 보지 않기'를 고르면 자동으로 열지 않는다 (자동 시작과 같은 키를 쓴다)", () => {
    assert.strictEqual(load().shouldAutoStartTutorial(), true);
    assert.strictEqual(load({ [key]: 'true' }).shouldAutoStartTutorial(), false);
    assert.ok(/shouldAutoStartTutorial\(\)/.test(html), 'index.html 자동 시작이 같은 판단을 쓴다');
    assert.ok(!/kyoan_tutorial_done_v\d/.test(html), 'index.html에 키 이름을 따로 적지 않는다');
});

test('화면을 덮던 예전 공지 창·말풍선은 남아 있지 않다', () => {
    assert.ok(!/showNoticePopup|tutorial-overlay|tutorial-popover|tutorial-spotlight/.test(html + scripts));
});

console.log(`\n${7 - failed}/7 passed`);
if (failed) process.exit(1);
