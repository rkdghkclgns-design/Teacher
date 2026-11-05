// 내보낸 교안 다시 불러오기 테스트 (실행: node tests/output-import.test.js)
// HTML에 담은 원본과 MD의 탭 표시를 읽어 고칠 수 있는 차시로 되살리는지, 남이 준 파일을 걸러 받는지 DOM 없이 확인한다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const LESSON_TABS = [
    { id: 'basicLearn', label: '기본학습' }, { id: 'basicPrac', label: '기본실습' }, { id: 'advLearn', label: '심화학습' },
    { id: 'advPrac', label: '심화실습' }, { id: 'assessment', label: '학습이해도' }
];
const ctx = { console, window: {}, JSON, Date, Object, LESSON_TABS, location: { hash: '' }, encodeURIComponent, decodeURIComponent };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'output-import.js'), 'utf8'), ctx);
const { lessonSourcePayload, lessonSourceScript, lessonMarkdownExport, parseOutputHtml, parseOutputMarkdown, normalizeImportedLesson } = { ...ctx, ...ctx.window };
const plain = value => JSON.parse(JSON.stringify(value));

let failed = 0;
let count = 0;
const test = (name, fn) => {
    count++;
    try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
};

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const lesson = {
    id: 101, title: '1차시: 개념 이해', description: '설명', hours: 2,
    tabContents: { basicLearn: '## 개요\n\n본문 </script><script>alert(1)</script>\n\n![그림](local:img_1)', advLearn: '## 심화\n\n심화 글\n\n---\n\n구분선 뒤 글' },
    images: { img_1: PNG, img_unused: PNG },
    gyosuan: { docMd: '# 교수안', deckMd: '# 편성안', deckHtml: '<div>화면 편집</div>' }
};

test('HTML: 원본을 담고 다시 읽으면 탭·그림·교수안이 그대로다', () => {
    const script = lessonSourceScript(lessonSourcePayload([lesson]));
    assert.ok(!script.slice(0, -9).includes('</script'), '본문의 </script>가 태그를 끊지 않는다');
    const html = `<!DOCTYPE html><html><body><main>보이는 글</main>${script}</body></html>`;
    const lessons = plain(parseOutputHtml(html));
    assert.strictEqual(lessons.length, 1);
    const restored = plain(normalizeImportedLesson(lessons[0], 5));
    assert.strictEqual(restored.tabContents.basicLearn, lesson.tabContents.basicLearn);
    assert.strictEqual(restored.tabContents.advLearn, lesson.tabContents.advLearn);
    assert.strictEqual(restored.tabContents.basicPrac, null);
    assert.deepStrictEqual(Object.keys(restored.images), ['img_1'], '쓰는 그림만 담는다');
    assert.strictEqual(restored.gyosuan.docMd, '# 교수안');
    assert.strictEqual(restored.gyosuan.deckHtml, undefined, '화면 편집 HTML은 받지 않는다');
    assert.strictEqual(restored.id, 5);
    assert.strictEqual(restored.hours, 2);
    assert.strictEqual(restored.status, 'done');
});

test('HTML: 지금 탭만 내보내면 그 탭만, 원본이 없는 HTML은 null', () => {
    const payload = plain(lessonSourcePayload([lesson], { tabIds: ['advLearn'], withGyosuan: false }));
    assert.deepStrictEqual(Object.keys(payload.lessons[0].tabContents), ['advLearn']);
    assert.strictEqual(payload.lessons[0].gyosuan, null);
    assert.strictEqual(parseOutputHtml('<html><body>그냥 문서</body></html>'), null);
    assert.strictEqual(parseOutputHtml('<script type="application/json" id="teacher-source">{깨진</script>'), null);
});

test('MD: 차시·탭 표시로 탭별로 되살리고, 본문의 구분선은 지키며, 한 탭만 내보낸 파일도 그 탭으로', () => {
    const tabs = [{ id: 'basicLearn', label: '기본학습', md: '## 개요\n\n본문' }, { id: 'advLearn', label: '심화학습', md: lesson.tabContents.advLearn }];
    const md = lessonMarkdownExport({ title: '제목 -- 주석 --> 끊기' }, tabs);
    const [parsed] = plain(parseOutputMarkdown(md, '01_x.md'));
    assert.strictEqual(parsed.title, '제목 -- 주석 --> 끊기');
    assert.strictEqual(parsed.tabContents.basicLearn, '## 개요\n\n본문');
    assert.strictEqual(parsed.tabContents.advLearn, lesson.tabContents.advLearn);
    const [single] = plain(parseOutputMarkdown(lessonMarkdownExport({ title: 'A' }, [{ id: 'assessment', label: '학습이해도', md: '문항' }]), 'a.md'));
    assert.deepStrictEqual(single.tabContents, { assessment: '문항' });
});

test('MD: 교안 첫 줄의 [..] 제목과 마지막 탭 끝의 구분선은 교안 내용이라 지킨다', () => {
    const own = [{ id: 'basicLearn', label: '기본학습', md: '# [참고]\n\n본문' }, { id: 'advLearn', label: '심화학습', md: '끝 문단\n\n---' }];
    const [parsed] = plain(parseOutputMarkdown(lessonMarkdownExport({ title: 'B' }, own), 'b.md'));
    assert.strictEqual(parsed.tabContents.basicLearn, '# [참고]\n\n본문');
    assert.strictEqual(parsed.tabContents.advLearn, '끝 문단\n\n---');
    const one = [{ id: 'assessment', label: '학습이해도', md: '# [학습이해도]\n\n문항' }];
    const [single] = plain(parseOutputMarkdown(lessonMarkdownExport({ title: 'C' }, one), 'c.md'));
    assert.strictEqual(single.tabContents.assessment, '# [학습이해도]\n\n문항', '머리를 붙이지 않은 한 탭 내보내기는 첫 줄을 떼지 않는다');
});

test('MD: 예전 내보내기(# [기본학습]·# [basicLearn] 머리)와 그냥 MD도 읽는다', () => {
    const [old] = plain(parseOutputMarkdown('# [basicLearn]\n\n가\n\n---\n\n# [심화실습]\n\n나', '03_차시 이름.md'));
    assert.deepStrictEqual(old.tabContents, { basicLearn: '가', advPrac: '나' });
    assert.strictEqual(old.title, '차시 이름', '파일 이름 앞 번호를 뗀다');
    const [loose] = plain(parseOutputMarkdown('# 아무 문서\n\n내용', 'note.md'));
    assert.deepStrictEqual(loose.tabContents, { basicLearn: '# 아무 문서\n\n내용' });
});

test('남이 준 파일: 글은 문자열만, 그림은 data:image만, 객체는 걸러 받는다', () => {
    const evil = plain(normalizeImportedLesson({
        title: { toString: null },
        description: 7,
        tabContents: { basicLearn: { evil: 1 }, basicPrac: '정상' },
        images: { 'ok_1': PNG, 'bad"id': PNG, x: 'javascript:alert(1)', y: 'data:text/html;base64,PHNjcmlwdD4=' },
        gyosuan: { docMd: ['배열'] },
        hours: 'abc'
    }, 9));
    assert.strictEqual(evil.title, '불러온 차시');
    assert.strictEqual(evil.description, '');
    assert.strictEqual(evil.tabContents.basicLearn, null);
    assert.strictEqual(evil.tabContents.basicPrac, '정상');
    assert.deepStrictEqual(Object.keys(evil.images), ['ok_1']);
    assert.strictEqual(evil.gyosuan, undefined);
    assert.strictEqual(evil.hours, undefined);
    assert.strictEqual(plain(normalizeImportedLesson(null, 1)).title, '불러온 차시');
});

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
