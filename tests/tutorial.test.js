// 사용 가이드 테스트 (실행: node tests/tutorial.test.js)
// 실제 js/guide-shots.js·js/tutorial.js를 vm에서 실행해 단계 내용, 캡처와 번호 수, 그리기, 자동으로 여는 조건을 확인한다
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
        document: { querySelector: () => null, getElementById: () => null, querySelectorAll: () => [] },
        storage
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    for (const file of ['guide-shots.js', 'tutorial.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), ctx);
    return ctx;
}

const ctx = load();
const steps = vm.runInContext('TUTORIAL_STEPS', ctx);
const shots = vm.runInContext('GUIDE_SHOTS', ctx);
const key = vm.runInContext('TUTORIAL_KEY', ctx);
let failed = 0;
let count = 0;
const test = (name, fn) => {
    count++;
    try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
};

test('단계마다 목차 이름·분류·제목·설명·번호 설명이 있고 id가 겹치지 않는다', () => {
    assert.ok(steps.length >= 12, `단계 ${steps.length}개`);
    assert.strictEqual(new Set(steps.map(s => s.id)).size, steps.length);
    for (const step of steps) {
        for (const field of ['id', 'shot', 'nav', 'category', 'title', 'lead']) assert.ok(String(step[field] || '').trim(), `${step.id}.${field}`);
        assert.ok(step.points.length >= 1, `${step.id}.points`);
        for (const point of step.points) assert.ok(point.title && point.text, `${step.id} 번호 설명`);
    }
});

test('단계마다 캡처가 있고, 캡처 속 번호 수와 설명 수가 같다', () => {
    for (const step of steps) {
        const shot = shots[step.shot];
        assert.ok(shot, `${step.id}: 캡처 ${step.shot} 없음`);
        assert.strictEqual(shot.markers.length, step.points.length, `${step.id}: 번호 ${shot.markers.length}개, 설명 ${step.points.length}개`);
    }
});

test('캡처 파일이 있고 크기가 적당하며 번호가 화면 안에 있다', () => {
    for (const [id, shot] of Object.entries(shots)) {
        const file = path.join(root, shot.src.replace(/^\.\//, ''));
        assert.ok(fs.existsSync(file), `${id}: ${shot.src} 없음`);
        assert.ok(fs.statSync(file).size < 300 * 1024, `${id}: 300KB 넘음`);
        for (const m of shot.markers) {
            assert.ok(m.x >= 0 && m.y >= 0 && m.x < 100 && m.y < 100 && m.w > 0 && m.h > 0, `${id}: 번호 위치 ${JSON.stringify(m)}`);
        }
    }
});

test('본문: 진행·제목·캡처(번호와 테두리)·같은 번호 설명·안내 문구를 그린다', () => {
    const step = steps.find(s => s.id === 'tools');
    const index = steps.indexOf(step);
    const out = ctx.tutorialStepHtml(step, index, steps.length);
    assert.ok(out.includes(`${index + 1} / ${steps.length}`));
    assert.ok(out.includes(step.title) && out.includes(step.category));
    assert.ok(out.includes(shots.tools.src));
    assert.strictEqual((out.match(/class="guide-pin"/g) || []).length, step.points.length);
    assert.strictEqual((out.match(/class="guide-box"/g) || []).length, step.points.length);
    assert.strictEqual((out.match(/class="guide-point-num"/g) || []).length, step.points.length);
    assert.ok(out.includes('실제 화면 캡처 · 예시 데이터') && out.includes('화면 확대') && out.includes('캡처 안의 버튼은 안내 이미지입니다'));
});

test('번호는 요소 왼쪽 바깥에 두고, 화면 왼쪽 끝 요소는 안쪽 위에 둔다', () => {
    assert.ok(ctx.tutorialPinStyle({ x: 40, y: 10, w: 5, h: 4 }).includes('calc(-100% - 6px)'));
    assert.ok(ctx.tutorialPinStyle({ x: 1, y: 10, w: 5, h: 4 }).includes('translate(6px,6px)'));
});

test('작업별 바로가기는 지금 단계를 표시하고 번호를 두 자리로 쓴다', () => {
    const nav = ctx.tutorialNavHtml(2);
    assert.strictEqual((nav.match(/aria-current="step"/g) || []).length, 1);
    assert.ok(nav.includes('>01</span>') && nav.includes(`>${String(steps.length).padStart(2, '0')}</span>`));
});

test('끝까지 보거나 닫으면 다음부터 자동으로 열지 않는다 (자동 시작과 같은 키)', () => {
    assert.strictEqual(load().shouldAutoStartTutorial(), true);
    assert.strictEqual(load({ [key]: 'true' }).shouldAutoStartTutorial(), false);
    assert.ok(/shouldAutoStartTutorial\(\)/.test(html), 'index.html 자동 시작이 같은 판단을 쓴다');
    assert.ok(!/kyoan_tutorial_done_v\d/.test(html), 'index.html에 키 이름을 따로 적지 않는다');
    assert.ok(html.indexOf('guide-shots.js') < html.indexOf('tutorial.js'), '캡처 위치 파일을 먼저 불러온다');
});

test('예전 공지 창·말풍선·옆 패널은 남아 있지 않다', () => {
    assert.ok(!/showNoticePopup|tutorial-overlay|tutorial-popover|tutorial-spotlight|tutorial-aside|tutorial-docked/.test(html + scripts));
});

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
