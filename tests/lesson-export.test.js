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
const { lessonTabSources, inlineLessonImages, lessonHtmlDocument, markShownImages } = ctx;

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
    assert.strictEqual(inlineLessonImages('(local:x)', { x: 'data:image/png;base64,a$&b' }), '(data:image/png;base64,a$&b)');
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

test('화면 그림 넣기: 이상한 그림 id로 멈추거나 깨지지 않는다(차시 화면도 이 함수를 쓴다)', () => {
    const png = 'data:image/png;base64,QUJD';
    const started = Date.now();
    const view = inlineLessonImages('local:' + 'a'.repeat(40) + '! <img src="local:(">', { '(a+)+$': png, '(': png });
    assert.ok(Date.now() - started < 200, '멈추지 않는다');
    // 그림 키 규칙([\w-] 80자까지, data-safety.js SAFE_IMAGE_KEY) 밖의 키는 앱이 만들지 않고 불러올 때 sanitizeState가 버린다. 그런 키는 쓰지 않고 그 자리는 없는 그림으로 둔다
    assert.ok(view.includes('src="" alt="[이미지 생성 누락]"') && !view.includes(png), '괄호가 든 id는 그림 키로 보지 않는다');
    // 차시 화면(렌더·보기 전환)도 그림 id로 정규식을 만들지 않고 이 함수로 그린다(묶음 6)
    const api = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');
    assert.strictEqual((api.match(/inlineLessonImages\(renderText, mod\.images\)/g) || []).length, 2, 'renderEditor·toggleEditorMode');
    assert.ok(!/new RegExp\(`local:\$\{imgId\}`/.test(api));
});

test('그림 넣기는 그림 키 모양 하나로 찾아 목록에서 꺼낸다: img_1·img_10, 뒤에 . ) 가 붙은 키, 목록에 없는 키, 진짜 그림이 아닌 값', () => {
    const A = 'data:image/png;base64,QUFB';
    const B = 'data:image/png;base64,QkJC';
    const md = '![a](local:img_1) ![b](local:img_10) 끝 local:img_1. 괄호 (local:img_10) <img src="local:img_2"> ![c](local:ref_1) ![d](local:empty_1)';
    const out = inlineLessonImages(md, { img_1: A, img_10: B, ref_1: 'teacher-image:0123456789abcdef01', empty_1: '' });
    assert.ok(out.includes(`![a](${A})`) && out.includes(`![b](${B})`), 'img_1과 img_10이 함께 있어도 제 그림');
    assert.ok(out.includes(`끝 ${A}.`) && out.includes(`괄호 (${B})`), "키 뒤에 '.'·')'가 붙어도 그 키");
    assert.ok(out.includes('<img src="" alt="[이미지 생성 누락]">'), '목록에 없는 키는 없는 그림 자리로');
    assert.ok(out.includes('![c]()') && out.includes('![d]()') && !out.includes('teacher-image:'), '찾지 못한 그림 자리(teacher-image:…)·빈 값은 넣지 않고 없는 그림으로');
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'lesson-export.js'), 'utf8');
    assert.ok(!/new RegExp\(/.test(source), '내보내기는 그림 키 같은 데이터로 정규식을 만들지 않는다');
});

test('보이는 그림에 키와 차시 번호를 달고, 같은 그림은 앞 키 하나만, 글에 미리 있던 표시는 지운다', () => {
    const A = 'data:image/png;base64,QUFB';
    const B = 'data:image/png;base64,QkJC';
    const Z = 'data:image/png;base64,WlpaWg==';
    const fake = attrs => ({ attrs, getAttribute: n => (n in attrs ? attrs[n] : null), setAttribute: (n, v) => { attrs[n] = String(v); }, removeAttribute: n => { delete attrs[n]; } });
    const imgs = [fake({ src: A }), fake({ src: A }), fake({ src: B, 'data-teacher-image': 'evil', 'data-teacher-lesson': '9' }), fake({ src: Z, 'data-teacher-image': 'x' }), fake({ src: '' })];
    const shown = new Map();
    markShownImages({ querySelectorAll: () => imgs }, { a1: A, a2: A, b: B, 'bad"key': Z, gone: '', ref: 'teacher-image:0123456789abcdef01' }, 3, shown);
    assert.deepStrictEqual(imgs.map(img => [img.attrs['data-teacher-image'], img.attrs['data-teacher-lesson']]), [['a1', '3'], ['a1', '3'], ['b', '3'], [undefined, undefined], [undefined, undefined]]);
    assert.deepStrictEqual([...shown.keys()], ['a1', 'b'], '빈 그림(찾지 못한 그림 자리·빈 값)에는 달지 않는다');
});

test('그림 넣기는 코드 블록 안을 바꾸지 않고, 빈 자리로 둘 괄호는 그림 키 모양((local:img_1))만 본다(코드 예제의 ToString(local: true)는 그대로)', () => {
    // 화면처럼 data.js의 코드 블록 따라가기를 함께 싣는다
    const dataSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8').replace(/\r\n/g, '\n');
    const slice = head => { const at = dataSource.indexOf(head); return dataSource.slice(at, dataSource.indexOf('\n}\n', at) + 2); };
    const withData = { console, window: {}, document: {}, LESSON_TABS };
    vm.createContext(withData);
    vm.runInContext(`${slice('function fenceStateAfter(')}\n${slice('function stashCodeFences(')}`, withData);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'lesson-export.js'), 'utf8'), withData);
    const inline = withData.inlineLessonImages;
    const code = '```csharp\nvar text = date.ToString(local: true);\nvar key = "local:img_1";\n```';
    const md = `${code}\n\n그림 ![a](local:img_1) 와 없는 그림 ![b](local:img_9), 문장 속 \`ToString(local: true)\`.`;
    const out = inline(md, { img_1: 'data:image/png;base64,AAA' });
    assert.ok(out.startsWith(code), out);
    assert.ok(out.includes('![a](data:image/png;base64,AAA)') && out.includes('![b]()') && out.includes('`ToString(local: true)`'), out);
});

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
