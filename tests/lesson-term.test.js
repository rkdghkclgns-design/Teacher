// '용어: 설명' 문단을 위 항목에 딸린 인용처럼 보이기 테스트 (실행: node tests/lesson-term.test.js)
// 실제 js/lesson-sanitize.js의 markTermParagraphs를 vm에서 돌린다 (marked가 만드는 HTML 모양을 입력으로 쓴다)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const ctx = { console, document: { addEventListener() {} }, window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'lesson-sanitize.js'), 'utf8'), ctx);
const mark = ctx.markTermParagraphs;
const marked = html => (html.match(/class="lesson-term"/g) || []).length;

let failed = 0;
let count = 0;
const test = (name, fn) => {
    count++;
    try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
};

// 질문 화면의 모양: "• 핵심 역할" 목록 다음에 굵은 용어로 시작하는 문단 둘
const ROLES = [
    '<ul>\n<li>핵심 역할</li>\n</ul>',
    '<p><strong>전투 및 조작 체계 설계</strong>: 캐릭터의 이동, 공격, 방어, 스킬 사용 등에 대한 물리적 규칙과 판정 방식을 정의합니다.</p>',
    '<p><strong>경제 및 성장 밸런싱</strong>: 재화의 획득과 소모 흐름을 설계하고,<br>경험치 곡선을 계산합니다.</p>',
    '<h3>다음 절</h3>',
    '<p>평범한 문단입니다.</p>'
].join('\n');

test('목록 다음의 용어 문단들에 표시를 붙이고, 다른 문단과 블록 수는 그대로 둔다', () => {
    const out = mark(ROLES);
    assert.strictEqual(marked(out), 2);
    assert.ok(out.includes('<p>평범한 문단입니다.</p>'));
    assert.strictEqual((out.match(/<p/g) || []).length, (ROLES.match(/<p/g) || []).length, '문단 수가 바뀌지 않는다');
    assert.strictEqual(out.replace(/ class="lesson-term"/g, ''), ROLES, '표시 말고는 아무것도 바꾸지 않는다');
});

test("굵은 글씨만 있는 짧은 문단이나 '• 항목' 문단도 머리가 된다", () => {
    assert.strictEqual(marked(mark('<p><strong>핵심 역할</strong></p>\n<p><strong>레벨 디자인</strong>: 공간을 설계합니다.</p>')), 1);
    assert.strictEqual(marked(mark('<p>• 핵심 역할</p>\n<p><strong>레벨 디자인</strong>: 공간을 설계합니다.</p>')), 1);
});

test('콜론이 굵은 글씨 안에 있어도 용어 문단으로 본다', () => {
    assert.strictEqual(marked(mark('<ul><li>역할</li></ul>\n<p><strong>시스템 기획:</strong> 규칙을 정합니다.</p>')), 1);
});

test('머리 없이 하나만 있는 "라벨: 설명"은 그대로, 둘 이상 이어지면 묶는다', () => {
    const single = '<p>앞 문단</p>\n<p><strong>참고</strong>: 한 줄 메모</p>\n<p>뒤 문단</p>';
    assert.strictEqual(mark(single), single);
    const pair = '<p>앞 문단입니다. 설명이 길게 이어집니다.</p>\n<p><strong>강점</strong>: 빠르다</p>\n<p><strong>약점</strong>: 비싸다</p>';
    assert.strictEqual(marked(mark(pair)), 2);
});

test('굵은 글씨로 시작하지만 콜론이 없는 문단이나 긴 굵은 글씨는 건드리지 않는다', () => {
    const plain = '<ul><li>항목</li></ul>\n<p><strong>강조</strong> 문장이 이어집니다.</p>';
    assert.strictEqual(mark(plain), plain);
    const long = `<ul><li>항목</li></ul>\n<p><strong>${'가'.repeat(41)}</strong>: 설명</p>`;
    assert.strictEqual(mark(long), long);
});

// 질문의 두 번째 화면: "• 시스템 기획적 접근:" 다음에 문단 전체가 굵은 "라벨: 설명" 둘과 보통 "**라벨**: 설명" 하나
const SYSTEM = [
    '<ul>\n<li><strong>시스템 기획적 접근:</strong></li>\n</ul>',
    '<p><strong>드래곤의 상태 정의: 대기, 탐색, 공격 준비, 공격 실행, 피격, 사망 등의 상태를 유한 상태 기계(FSM) 구조로 설계합니다.</strong></p>',
    '<p><strong>공격 패턴의 수치화: &#39;불 뿜기&#39; 스킬의 사거리는 15미터로 설정합니다.</strong></p>',
    '<p><strong>플레이어의 대응 수단</strong>: 구르기 스킬의 무적 시간을 0.3초로 정의합니다.</p>'
].join('\n');

test('문단 전체가 굵은 "라벨: 설명"도 용어 문단으로 묶는다 (질문 화면 그대로)', () => {
    const out = mark(SYSTEM);
    assert.strictEqual(marked(out), 3);
    assert.strictEqual(out.replace(/ class="lesson-term"/g, ''), SYSTEM);
});

test('목록 항목 안에 들여쓴 용어 문단(느슨한 목록)도 묶는다', () => {
    const loose = '<ul>\n<li><p><strong>시스템 기획적 접근:</strong></p>\n<p><strong>드래곤의 상태 정의:</strong> 대기 상태를 설계합니다.</p>\n<p><strong>공격 패턴의 수치화:</strong> 사거리는 15미터입니다.</p>\n</li>\n</ul>';
    const out = mark(loose);
    assert.strictEqual(marked(out), 2);
    assert.ok(out.includes('<li><p><strong>시스템 기획적 접근:</strong></p>'), '항목 첫 문단은 그대로');
    // marked가 실제로 내는 모양: 들여쓴 문단 앞에 공백이 남는다
    const spaced = loose.replace(/<p><strong>(드래곤|공격)/g, '<p>  <strong>$1');
    assert.strictEqual(marked(mark(spaced)), 2);
});

test('콜론이 없는 굵은 문장 문단은 용어 문단이 아니다', () => {
    const bold = '<ul><li>항목</li></ul>\n<p><strong>이 문장은 처음부터 끝까지 굵게 쓴 강조 문장입니다.</strong></p>';
    assert.strictEqual(mark(bold), bold);
});

test('빈 값도 견딘다', () => {
    assert.strictEqual(mark(''), '');
    assert.strictEqual(mark(null), '');
});

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
