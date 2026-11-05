// 드래그 서식 막대가 원문 마크다운을 고치는 규칙 테스트 (실행: node tests/lesson-format.test.js)
// 화면과 같은 marked로 토큰을 만든다. 처음 한 번: npm install --no-save marked@15.0.12
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

let marked;
try {
    ({ marked } = require('marked'));
} catch (err) {
    console.log('FAIL - marked가 없습니다. 먼저 실행: npm install --no-save marked@15.0.12');
    process.exit(1);
}

const ctx = { console, marked };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'lesson-format.js'), 'utf8'), ctx);
const { lessonBlocks, findInlineRange, inlineFormatState, applyInlineFormat, applyBlockFormat, normalizeLinkUrl, keepChosenNumbering, locateLessonBlock, replaceLessonBlock } = ctx;

let failed = 0;
let count = 0;
const test = (name, fn) => {
    count++;
    try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
};

// 화면 블록 하나에서 글자를 고른 모양. before는 블록 안에서 고른 글자 앞의 글
const pick = (index, text, selected, before = text.slice(0, text.indexOf(selected))) => ({ index, text, before, selected });
const inline = (md, part, style, opts) => {
    const result = applyInlineFormat(md, [part], style, opts);
    assert.ok(result.ok, result.reason);
    return result.source;
};

/* ---------- 블록 나누기 ---------- */
test('블록 raw를 이어 붙이면 원문이 되고, 빈 줄과 주석은 화면 순서에서 뺀다', () => {
    const md = '# 제목\n\n첫 문단\n\n<!-- 번호 목록 -->\n1. 하나\n2. 둘\n\n끝 문단\n';
    const blocks = lessonBlocks(md);
    assert.strictEqual(blocks.map(b => b.raw).join(''), md);
    assert.deepStrictEqual(blocks.filter(b => b.index >= 0).map(b => b.token.type), ['heading', 'paragraph', 'list', 'paragraph']);
    assert.strictEqual(blocks.find(b => b.raw.startsWith('<!--')).index, -1);
});

test('CRLF 원문도 나눈다', () => {
    assert.ok(lessonBlocks('가\r\n\r\n나\r\n'));
});

/* ---------- 고른 글자 → 원문 위치 ---------- */
test('굵은 글씨 안쪽 글자를 고르면 기호를 뺀 안쪽 위치를 돌려준다', () => {
    const raw = '가나다 **라마바** 사아\n';
    const range = findInlineRange(raw, '가나다 ', '라마바');
    assert.strictEqual(raw.slice(range.start, range.end), '라마바');
});

test('같은 글자가 여러 번 나오면 앞 글자 길이로 가까운 쪽을 고른다', () => {
    const raw = '사과 그리고 사과\n';
    const range = findInlineRange(raw, '사과 그리고 ', '사과');
    assert.strictEqual(range.start, raw.lastIndexOf('사과'));
});

test('화면에서 지워진 라벨 끝 콜론과 줄바꿈이 있어도 찾는다', () => {
    const raw = '**게임 기획의 본질:** 재미를 설계합니다. 그리고 검증합니다.\n';
    const range = findInlineRange(raw, '', '게임 기획의 본질 재미를');
    assert.strictEqual(raw.slice(range.start, range.end), '게임 기획의 본질:** 재미를');
    const label = findInlineRange(raw, '', '게임 기획의 본질');
    assert.strictEqual(raw.slice(label.start, label.end), '게임 기획의 본질:', '기호 앞 콜론까지 고른다');
});

/* ---------- 굵게·기울임·밑줄·취소선 ---------- */
test('보통 글자를 굵게 하고, 다시 누르면 푼다', () => {
    const md = '첫 문단\n\n몬스터의 체력을 설계합니다.\n';
    const bold = inline(md, pick(1, '몬스터의 체력을 설계합니다.', '체력'), 'bold');
    assert.strictEqual(bold, '첫 문단\n\n몬스터의 **체력**을 설계합니다.\n');
    assert.strictEqual(inline(bold, pick(1, '몬스터의 체력을 설계합니다.', '체력'), 'bold'), md);
});

test('문단 전체가 굵은 "라벨: 설명"에서 설명만 고르면 설명만 굵기를 푼다', () => {
    const md = '**드래곤의 상태 정의: 대기, 탐색 상태를 설계합니다.**\n';
    const out = inline(md, pick(0, '드래곤의 상태 정의: 대기, 탐색 상태를 설계합니다.', '대기, 탐색 상태를 설계합니다.'), 'bold');
    assert.strictEqual(out, '**드래곤의 상태 정의:** 대기, 탐색 상태를 설계합니다.\n');
});

test('굵은 글씨를 걸쳐 고르면 하나로 합쳐 굵게 한다', () => {
    const out = inline('가 **나** 다\n', pick(0, '가 나 다', '가 나 다'), 'bold');
    assert.strictEqual(out, '**가 나 다**\n');
});

test('한글 바로 앞에서 문장부호로 끝나면 HTML 태그로 감싼다', () => {
    const out = inline('경험(Player)을 설계\n', pick(0, '경험(Player)을 설계', '경험(Player)'), 'bold');
    assert.strictEqual(out, '<strong>경험(Player)</strong>을 설계\n');
    assert.strictEqual(inline(out, pick(0, '경험(Player)을 설계', '경험(Player)'), 'bold'), '경험(Player)을 설계\n', 'HTML 굵게도 다시 누르면 푼다');
});

test('기울임, 취소선, 밑줄', () => {
    const part = pick(0, '한 단어 바꾸기', '단어');
    assert.strictEqual(inline('한 단어 바꾸기\n', part, 'italic'), '한 *단어* 바꾸기\n');
    assert.strictEqual(inline('한 단어 바꾸기\n', part, 'strike'), '한 ~~단어~~ 바꾸기\n');
    const under = inline('한 단어 바꾸기\n', part, 'underline');
    assert.strictEqual(under, '한 <u>단어</u> 바꾸기\n');
    assert.strictEqual(inline(under, part, 'underline'), '한 단어 바꾸기\n');
});

test('앞뒤 빈칸은 서식 기호 밖에 둔다', () => {
    const out = inline('가 나 다\n', pick(0, '가 나 다', ' 나 ', '가'), 'bold');
    assert.strictEqual(out, '가 **나** 다\n');
});

test('여러 문단에 걸쳐 고르면 각 문단에 입힌다', () => {
    const md = '첫째 문단입니다\n\n둘째 문단입니다\n';
    const parts = [pick(0, '첫째 문단입니다', '문단입니다'), pick(1, '둘째 문단입니다', '둘째')];
    const result = applyInlineFormat(md, parts, 'bold');
    assert.strictEqual(result.source, '첫째 **문단입니다**\n\n**둘째** 문단입니다\n');
});

test('목록 항목 안의 글자도 고친다', () => {
    const md = '- 체력 회복\n- 마나 회복\n';
    assert.strictEqual(inline(md, pick(0, '체력 회복마나 회복', '마나', '체력 회복'), 'bold'), '- 체력 회복\n- **마나** 회복\n');
});

/* ---------- 코드·링크 ---------- */
test('코드는 보이는 글자만 감싸고, 다시 누르면 푼다', () => {
    const md = '값은 hp 입니다\n';
    const code = inline(md, pick(0, '값은 hp 입니다', 'hp'), 'code');
    assert.strictEqual(code, '값은 `hp` 입니다\n');
    assert.strictEqual(inline(code, pick(0, '값은 hp 입니다', 'hp'), 'code'), md);
    // 굵은 글씨를 걸쳐 고르면 기호 없이 보이는 글자만 코드가 된다
    assert.strictEqual(inline('값은 **hp** 입니다\n', pick(0, '값은 hp 입니다', '값은 hp'), 'code'), '`값은 hp` 입니다\n');
});

test('링크를 걸고, 링크 안을 고르고 다시 누르면 링크를 푼다', () => {
    const md = '자료는 공식 문서를 보세요\n';
    const linked = inline(md, pick(0, '자료는 공식 문서를 보세요', '공식 문서'), 'link', { url: 'https://example.com' });
    assert.strictEqual(linked, '자료는 [공식 문서](https://example.com)를 보세요\n');
    assert.strictEqual(inline(linked, pick(0, '자료는 공식 문서를 보세요', '문서'), 'link'), md);
    assert.strictEqual(applyInlineFormat(md, [pick(0, '자료는 공식 문서를 보세요', '공식')], 'link').ok, false, '주소 없이는 걸지 않는다');
});

test('링크 주소 정리', () => {
    assert.strictEqual(normalizeLinkUrl('example.com/a'), 'https://example.com/a');
    assert.strictEqual(normalizeLinkUrl('https://a.b/x(1)'), 'https://a.b/x%281%29');
    assert.strictEqual(normalizeLinkUrl('mailto:a@b.c'), 'mailto:a@b.c');
    assert.strictEqual(normalizeLinkUrl('javascript:alert(1)'), null);
    assert.strictEqual(normalizeLinkUrl('주소 아님'), null);
});

test('막대 버튼 눌림 상태', () => {
    const state = inlineFormatState('가 **나** 다\n', [pick(0, '가 나 다', '나')]);
    assert.strictEqual(state.bold, true);
    assert.strictEqual(state.italic, false);
});

/* ---------- 화면 순서와 원문 순서가 어긋날 때 ---------- */
test('화면 블록 순서가 어긋나도 글자가 맞는 가까운 블록을 찾는다', () => {
    const md = '첫째\n\n둘째 문단\n\n셋째 문단\n';
    assert.strictEqual(inline(md, pick(0, '셋째 문단', '셋째'), 'bold'), '첫째\n\n둘째 문단\n\n**셋째** 문단\n');
});

test('원문에 없는 글자를 고르면 고치지 않고 이유를 알려 준다', () => {
    const result = applyInlineFormat('가나다\n', [pick(0, '가나다', '없는 글자', '')], 'bold');
    assert.strictEqual(result.ok, false);
    assert.ok(result.reason);
});

/* ---------- 블록 서식 ---------- */
const block = (index, text) => ({ index, text });
const blockOp = (md, parts, op, opts) => {
    const result = applyBlockFormat(md, parts, op, opts);
    assert.ok(result.ok, result.reason);
    return result.source;
};

test('문단 둘을 글머리 목록으로, 다시 누르면 문단으로', () => {
    const md = '머리\n\n사과\n\n배\n\n꼬리\n';
    const list = blockOp(md, [block(1, '사과'), block(2, '배')], 'bullet');
    assert.strictEqual(list, '머리\n\n- 사과\n- 배\n\n꼬리\n');
    assert.strictEqual(blockOp(list, [block(1, '사과배')], 'bullet'), md);
});

test('번호 목록은 표시 주석과 함께 만들고, 글머리 목록으로 바꾸면 주석을 뺀다', () => {
    const md = '사과\n\n배\n';
    const ordered = blockOp(md, [block(0, '사과'), block(1, '배')], 'ordered');
    assert.strictEqual(ordered, '<!-- 번호 목록 -->\n1. 사과\n2. 배\n');
    assert.strictEqual(blockOp(ordered, [block(0, '사과배')], 'bullet'), '- 사과\n- 배\n');
    assert.strictEqual(blockOp(ordered, [block(0, '사과배')], 'ordered'), '사과\n\n배\n');
});

test('인용으로 감싸고, 다시 누르면 푼다', () => {
    const md = '앞\n\n인용할 문장\n\n뒤\n';
    const quoted = blockOp(md, [block(1, '인용할 문장')], 'quote');
    assert.strictEqual(quoted, '앞\n\n> 인용할 문장\n\n뒤\n');
    assert.strictEqual(blockOp(quoted, [block(1, '인용할 문장')], 'quote'), md);
});

test('문단 스타일: 제목과 본문', () => {
    const md = '바꿀 줄\n';
    const heading = blockOp(md, [block(0, '바꿀 줄')], 'h3');
    assert.strictEqual(heading, '### 바꿀 줄\n');
    assert.strictEqual(blockOp(heading, [block(0, '바꿀 줄')], 'paragraph'), md);
});

test('코드 블록은 화면 글자를 담고, 다시 누르면 문단으로 푼다', () => {
    const md = '**x** = 1\n';
    const code = blockOp(md, [block(0, 'x = 1')], 'codeblock', { texts: ['x = 1'] });
    assert.strictEqual(code, '```\nx = 1\n```\n');
    assert.strictEqual(blockOp(code, [block(0, 'x = 1')], 'codeblock'), 'x = 1\n');
});

test('구분선은 고른 블록 뒤에 넣는다', () => {
    assert.strictEqual(blockOp('가\n\n나\n', [block(0, '가')], 'divider'), '가\n\n---\n\n나\n');
});

test('표나 그림 블록은 목록으로 바꾸지 않는다', () => {
    const md = '<table><tr><td>칸</td></tr></table>\n\n문단\n';
    const result = applyBlockFormat(md, [block(0, '칸'), block(1, '문단')], 'bullet');
    assert.strictEqual(result.ok, false);
});

/* ---------- 두 번 눌러 단락 고치기 ---------- */
test('두 번 누른 단락은 화면 순서가 어긋나도 글자로 원문 블록을 찾는다', () => {
    const md = '# 제목\n\n💡 핵심 개념: 첫 문단\n\n둘째 문단입니다\n';
    // 화면 후처리가 첫 문단을 지워 화면에서는 둘째 문단이 1번째 블록이 된 경우
    const found = locateLessonBlock(md, { index: 1, text: '둘째 문단입니다' });
    assert.strictEqual(found.raw, '둘째 문단입니다\n');
    assert.strictEqual(replaceLessonBlock(md, found, '고친 문단'), '# 제목\n\n💡 핵심 개념: 첫 문단\n\n고친 문단\n');
});

test('그림 블록은 그림 id로 찾고, 그림끼리일 때만 화면 순서로 짝짓는다. 원문이 바뀌었으면 바꾸지 않는다', () => {
    const md = '앞 문단\n\n<div class="image-wrapper"><img src="local:a"><button data-img-id="img_a">다시 생성</button></div>\n\n<div class="image-wrapper"><img src="local:b"><button data-img-id="img_b">다시 생성</button></div>\n\n뒤 문단\n';
    assert.ok(locateLessonBlock(md, { index: 0, text: '다시 생성', mediaKey: 'img_b' }).raw.includes('img_b'), '순서가 어긋나도 그림 id로');
    const found = locateLessonBlock(md, { index: 1, text: '다시 생성', media: true });
    assert.ok(found.raw.includes('img_a'));
    assert.strictEqual(replaceLessonBlock(md.replace('앞 문단', '앞 문단 고침'), found, 'x'), null);
    assert.strictEqual(locateLessonBlock(md, { index: 1, text: '다시 생성' }), null, '그림이 아닌 화면 블록은 순서만으로 그림과 짝짓지 않는다');
    assert.strictEqual(locateLessonBlock(md, { index: 0, text: '원문에 없는 글' }), null, '글자가 있는 단락은 순서만으로 짝짓지 않는다');
});

/* ---------- 검토에서 나온 경우 ---------- */
test('그림이 낀 범위는 코드 블록·목록으로 바꾸지 않아 그림을 잃지 않는다', () => {
    const md = '가나\n\n![그림](http://x/a.png)\n\n다라\n';
    const parts = [block(0, '가나'), block(2, '다라')];
    assert.strictEqual(applyBlockFormat(md, parts, 'codeblock', { texts: ['가나', '다라'] }).ok, false);
    assert.strictEqual(applyBlockFormat(md, parts, 'bullet').ok, false);
    assert.strictEqual(blockOp(md, parts, 'h3'), '### 가나\n\n![그림](http://x/a.png)\n\n### 다라\n', '제목은 그림 블록을 그대로 둔다');
});

test('목록 항목 둘에 걸쳐 굵게 하면 항목마다 따로 감싼다', () => {
    const md = '- 가나다\n- 라마바\n';
    const part = pick(0, '가나다라마바', '다라마', '가나');
    assert.strictEqual(inline(md, part, 'bold'), '- 가나**다**\n- **라마**바\n');
    assert.strictEqual(applyInlineFormat(md, [part], 'link', { url: 'https://a.b' }).ok, false, '링크는 한 줄 안에서만');
});

test('굵게 일부를 풀고 남은 조각이 한글 옆 문장부호면 HTML 태그로 남긴다', () => {
    const out = inline('**가나(다라)** 끝\n', pick(0, '가나(다라) 끝', '가나'), 'bold');
    assert.strictEqual(out, '가나<strong>(다라)</strong> 끝\n');
});

test('짧은 이웃 문단이 고른 문단 글자 안에 있어도 길이가 비슷한 문단을 고른다', () => {
    const md = '네.\n\n네. 그렇게 설계하면 됩니다.\n';
    const out = inline(md, pick(0, '네. 그렇게 설계하면 됩니다.', '설계'), 'bold');
    assert.strictEqual(out, '네.\n\n네. 그렇게 **설계**하면 됩니다.\n');
});

/* ---------- 번호 목록 표시 ---------- */
test('고른 번호 목록만 번호로 그린다', () => {
    const html = '<!-- 번호 목록 -->\n<ul style="list-style:disc;padding-left:1.5rem;"><li>a</li></ul><ul style="list-style:disc;padding-left:1.5rem;"><li>b</li></ul>';
    const out = keepChosenNumbering(html);
    assert.strictEqual((out.match(/list-style:decimal/g) || []).length, 1);
    assert.ok(!out.includes('번호 목록'));
});

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
