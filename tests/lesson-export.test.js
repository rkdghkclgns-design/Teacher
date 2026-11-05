// 교안 HTML·PDF 내보내기의 DOM 없는 부분 테스트 (실행: node tests/lesson-export.test.js)
// 화면 렌더(renderLessonHTML)는 브라우저에서 확인한다. 여기서는 탭 고르기, 그림 치환, 문서 틀을 본다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const LESSON_TABS = [
    { id: 'basicLearn', label: '기본학습' }, { id: 'basicPrac', label: '기본실습' }, { id: 'advLearn', label: '심화학습' },
    { id: 'advPrac', label: '심화실습' }, { id: 'assessment', label: '학습이해도' }
];
const ctx = { console, window: {}, document: {}, LESSON_TABS };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'lesson-export.js'), 'utf8'), ctx);
const { lessonTabSources, inlineLessonImages, lessonHtmlDocument } = ctx;

let failed = 0;
let count = 0;
const test = (name, fn) => {
    count++;
    try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
};

test('탭 순서대로 내용이 있는 탭만 고르고, 지금 탭만 고를 수도 있다', () => {
    const mod = { tabContents: { advLearn: '# 심화', basicLearn: '# 기본', basicPrac: '  ', assessment: '# 평가' } };
    assert.deepStrictEqual(lessonTabSources(mod).map(tab => tab.label), ['기본학습', '심화학습', '학습이해도']);
    assert.deepStrictEqual(lessonTabSources(mod, ['advLearn']).map(tab => tab.md), ['# 심화']);
    assert.deepStrictEqual(lessonTabSources(mod, ['basicPrac']), [], '빈 탭은 내보내지 않는다');
});

test('탭이 모두 비고 옛 단일 본문만 있으면 기본학습으로 본다', () => {
    const tabs = lessonTabSources({ content: '# 옛 본문', tabContents: {} });
    assert.deepStrictEqual(tabs.map(tab => [tab.id, tab.md]), [['basicLearn', '# 옛 본문']]);
    assert.deepStrictEqual(lessonTabSources(null), []);
});

test('local: 그림을 저장된 그림으로 바꾸고, img_1이 img_10을 건드리지 않는다', () => {
    const md = '![a](local:img_1) ![b](local:img_10) <img src="local:img_9">';
    const out = inlineLessonImages(md, { img_1: 'data:image/png;base64,AAA', img_10: 'data:image/png;base64,BBB' });
    assert.ok(out.includes('![a](data:image/png;base64,AAA)'));
    assert.ok(out.includes('![b](data:image/png;base64,BBB)'));
    assert.ok(out.includes('src="" alt="[이미지 생성 누락]"'), '없는 그림 자리는 비운다');
});

test('그림 데이터에 $가 있어도 그대로 넣는다', () => {
    assert.strictEqual(inlineLessonImages('(local:x)', { x: 'data:a$&b' }), '(data:a$&b)');
});

test('문서 틀: 제목을 이스케이프하고, 화면과 같은 서식과 인쇄 규칙을 넣는다', () => {
    const doc = lessonHtmlDocument('<게임> & "기획"', '<p>본문</p>');
    assert.ok(doc.startsWith('<!DOCTYPE html>'));
    assert.ok(doc.includes('<title>&lt;게임&gt; &amp; &quot;기획&quot;</title>'));
    assert.ok(doc.includes('<main class="lesson-doc">\n<p>본문</p>\n</main>'));
    ['p.lesson-term', 'ol { list-style: decimal; }', '@media print', 'break-before: page', 'a { color'].forEach(rule => {
        assert.ok(doc.includes(rule), `서식에 ${rule}`);
    });
});

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
