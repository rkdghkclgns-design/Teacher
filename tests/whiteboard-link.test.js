// 판서 영상(화이트보드 교안 스튜디오로 넘기기) 테스트 (실행: node tests/whiteboard-link.test.js)
// 실제 data.js·lesson-lint.js·lesson-opening.js·whiteboard-link.js를 실행하고 저장소·창 열기·내려받기만 흉내 낸다 (tests/whiteboard-harness.js).
// 스튜디오(src/lib/handoff.ts)가 받는 형식: v 1, from 'teacher', 주제 300자·파일 이름 120자·본문 500만 자 이하, 10분 안
const assert = require('assert');
const { LOCAL, HANDOFF_KEY: KEY, lesson, makeContext, runTests } = require('./whiteboard-harness');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('탭마다 # 제목으로 나누고 그림·주석은 빼며 그림 설명만 남긴다', () => {
    const ctx = makeContext();
    const handoff = ctx.buildWhiteboardHandoff(lesson(), ctx.globalState.subjects[0], 1000);
    assert.strictEqual(handoff.v, 1);
    assert.strictEqual(handoff.from, 'teacher');
    assert.strictEqual(handoff.createdAt, 1000);
    assert.strictEqual(handoff.topic, '개념 이해 (게임 기획의 기초)');
    assert.strictEqual(handoff.audience, '대학생·성인');
    assert.strictEqual(handoff.fileName, '게임 기획의 기초 1차시 개념 이해.md');
    const md = handoff.markdown;
    assert.ok(md.startsWith('# 1차시: 개념 이해 — 수업 정보'), md.slice(0, 40));
    assert.ok(md.includes('- 교과: 1. 게임 기획의 기초'));
    assert.ok(md.includes('  - 코어 루프를 설명할 수 있다'));
    assert.ok(md.indexOf('# 기본학습') < md.indexOf('# 학습이해도'), '탭 순서대로');
    assert.ok(!md.includes('# 기본실습'), '빈 탭은 넣지 않는다');
    assert.ok(md.includes('(그림: 루프 그림)'));
    assert.ok(!/data:image|<!--|<img/.test(ctx.stashCodeFences(md).text), md); // 코드 블록 밖의 글만 본다(코드의 <!-- --> 주석은 남는다)
});

test('검토 V3-1: 코드 블록 안의 html·xml 주석과 C# 제네릭 같은 코드 글자는 그대로 넘기고, 블록 밖의 주석·태그만 뺀다', () => {
    const HTML = ['```html', '<!-- 제목 영역을 만듭니다 -->', '<h1>점수판</h1>', '<!-- 점수를 보여 줄 칸입니다 -->', '<p id="score">0</p>', '```'].join('\n');
    const XML = ['```xml', '<!-- 게임 설정 파일입니다 -->', '<config>', '  <!-- 시작 체력입니다 -->', '  <hp>100</hp>', '</config>', '```'].join('\n');
    const CS = ['```csharp', '// 점수 목록을 만듭니다', 'List<int> scores = new List<int>();', '```'].join('\n');
    const body = `## 점수판 만들기\n\n<!-- [IMG: 점수판] -->\n화면에 점수를 보이는 <b>HTML</b>입니다.\n\n${HTML}\n\n설정은 XML로 둡니다.\n\n${XML}\n\n${CS}`;
    const mod = lesson({ tabContents: { basicLearn: body } });
    const ctx = makeContext({ mod });
    const md = ctx.buildWhiteboardHandoff(mod, ctx.globalState.subjects[0], 1000).markdown;
    assert.ok(md.includes(HTML) && md.includes(XML) && md.includes(CS), md);
    assert.ok(md.includes('화면에 점수를 보이는 HTML입니다.') && !md.includes('[IMG:'), md);
    assert.strictEqual(ctx.whiteboardPlainMarkdown(`글 <i>기울임</i>\n\n${CS}\n\n<!-- 끝 -->`), `글 기울임\n\n${CS}`);
});

test('검토 V4-05: 닫히지 않은 코드 블록은 닫아 넘기고(다음 탭 # 제목이 코드가 되지 않게), 그 블록에 든 그림 틀·data: 주소는 그림 설명으로 바꾼다', () => {
    const DATA = `data:image/png;base64,${'B'.repeat(3000)}`;
    const body = ['## 반복', '', '합계를 구합니다.', '', '```python', '# 합계를 구합니다', 'List<int> = 0', '',
        '<!-- [IMG: loop] -->', '<div class="image-wrapper"><img src="local:img_a" alt="반복 그림"></div>', '', `![붙인 그림](${DATA})`, '', 'print(total)'].join('\n');
    const mod = lesson({ tabContents: { basicLearn: body, assessment: '## 확인 문제\n\n1. 합계란?' } });
    const ctx = makeContext({ mod });
    const md = ctx.buildWhiteboardHandoff(mod, ctx.globalState.subjects[0], 1000).markdown;
    assert.ok(!/data:image|<img|<div|\[IMG:/.test(md), md.slice(0, 400));
    assert.ok(md.includes('(그림: 반복 그림)') && md.includes('(그림: 붙인 그림)'), md);
    assert.ok(md.includes('```python\n# 합계를 구합니다\nList<int> = 0\n'), '그림이 없는 코드 줄은 그대로');
    assert.ok(md.includes('print(total)\n```\n\n# 학습이해도'), md);
    assert.ok(ctx.stashCodeFences(md).text.includes('# 학습이해도\n\n## 확인 문제'), '다음 탭 제목은 코드 블록 밖');
    // 들여쓴 펜스는 같은 들여쓰기로 닫는다
    assert.strictEqual(ctx.whiteboardPlainMarkdown('1. 설치\n\n   ```bash\n   pip install pygame'), '1. 설치\n\n   ```bash\n   pip install pygame\n   ```');
});

test('교안이 없으면 넘기지 않고 알린다', () => {
    const empty = lesson({ tabContents: {}, content: '' });
    const ctx = makeContext({ mod: empty });
    assert.strictEqual(ctx.buildWhiteboardHandoff(empty, null), null);
    ctx.openWhiteboardStudio(7);
    assert.strictEqual(ctx.opened.length, 0);
    assert.ok(/아직 교안 내용이 없습니다/.test(ctx.alerts[0]));
    assert.strictEqual(ctx.storage[KEY], undefined);
});

test('탭이 없는 예전 차시는 본문(content)을 넘긴다', () => {
    const old = lesson({ tabContents: undefined, content: '## 옛 본문\n\n내용' });
    const ctx = makeContext({ mod: old });
    const handoff = ctx.buildWhiteboardHandoff(old, null);
    assert.ok(handoff.markdown.includes('# 교안\n\n## 옛 본문'));
    assert.strictEqual(handoff.topic, '개념 이해');
    assert.strictEqual(handoff.fileName, '1차시 개념 이해.md');
});

test('GitHub Pages에서는 저장소에 남기고 같은 주소의 스튜디오를 #from=teacher로 새 탭에 연다', () => {
    const ctx = makeContext();
    ctx.openWhiteboardStudio(7);
    const stored = JSON.parse(ctx.storage[KEY]);
    assert.strictEqual(stored.topic, '개념 이해 (게임 기획의 기초)');
    assert.ok(Date.now() - stored.createdAt < 5000);
    assert.deepStrictEqual(ctx.opened, [{ url: 'https://rkdghkclgns-design.github.io/whiteboard-studio-web/#from=teacher', target: '_blank', rel: 'noopener' }]);
    assert.strictEqual(ctx.attached, 0, '연 뒤 링크를 문서에서 뺀다');
    assert.strictEqual(ctx.downloads.length, 0);
    assert.ok(/스튜디오로 넘겼습니다/.test(ctx.toasts[0]));
});

test('다시 누르면 기록이 새것으로 바뀐다 (스튜디오는 읽을 때 지운다)', () => {
    const mod = lesson();
    const ctx = makeContext({ mod });
    ctx.openWhiteboardStudio(7);
    mod.tabContents.basicLearn = '## 고친 뒤 다시 넘김';
    ctx.openWhiteboardStudio(7);
    assert.strictEqual(ctx.opened.length, 2);
    assert.ok(JSON.parse(ctx.storage[KEY]).markdown.includes('## 고친 뒤 다시 넘김'));
});

test('넘기기 전에 수정 모드에서 고치던 글을 먼저 반영한다', () => {
    const mod = lesson();
    const ctx = makeContext({ mod, onSaveEdits: m => { m.tabContents.basicLearn = '## 방금 고친 글'; } });
    ctx.openWhiteboardStudio(7);
    assert.deepStrictEqual(ctx.saved, ['basicLearn']);
    assert.ok(JSON.parse(ctx.storage[KEY]).markdown.includes('## 방금 고친 글'));
});

test('주소가 다르면 교안 파일을 내려받고 공개 스튜디오를 열어 보관함에 넣도록 안내한다', () => {
    const ctx = makeContext({ loc: LOCAL });
    ctx.openWhiteboardStudio(7);
    assert.strictEqual(ctx.storage[KEY], undefined);
    assert.strictEqual(ctx.downloads.length, 1);
    assert.strictEqual(ctx.downloads[0].name, '게임 기획의 기초 1차시 개념 이해.md');
    assert.ok(ctx.downloads[0].content.includes('# 기본학습'));
    assert.strictEqual(ctx.opened[0].url, 'https://rkdghkclgns-design.github.io/whiteboard-studio-web/');
    assert.ok(/다른 주소/.test(ctx.alerts[0]) && /지식 보관함/.test(ctx.alerts[0]));
});

test('저장소에 넣지 못하면 파일로 넘긴다', () => {
    const ctx = makeContext({ setItemThrows: true });
    ctx.openWhiteboardStudio(7);
    assert.strictEqual(ctx.downloads.length, 1);
    assert.ok(/저장소에 교안을 넣지 못해/.test(ctx.alerts[0]));
});

test('스튜디오가 받는 길이를 넘지 않는다 (주제 300자, 파일 이름 120자, 본문 100만 자)', () => {
    const long = lesson({ title: '가'.repeat(400), tabContents: { basicLearn: '나'.repeat(1200000) } });
    const ctx = makeContext({ mod: long });
    const handoff = ctx.buildWhiteboardHandoff(long, { title: '다'.repeat(200) });
    assert.ok(handoff.topic.length <= 300);
    assert.ok(handoff.fileName.length <= 120 && handoff.fileName.endsWith('.md'));
    assert.ok(handoff.markdown.length <= 1000000 + 20 && handoff.markdown.endsWith('(이하 생략)'));
    assert.ok(!/[\\/:*?"<>|]/.test(ctx.buildWhiteboardHandoff(lesson({ title: 'a/b:c*d?' }), null).fileName));
});

test('판서 영상 만들기 창에서 고쳐 쓴 주제와 내용이 그대로 넘어간다', () => {
    const ctx = makeContext({ dialogEdit: () => ({ topic: '내가 정한 주제', markdown: '# 내가 쓴 내용\n\n강조할 예시' }) });
    ctx.openWhiteboardStudio(7);
    assert.strictEqual(ctx.dialogs.length, 1);
    assert.ok(ctx.dialogs[0].markdown.includes('# 기본학습'), '창에는 차시 교안이 미리 채워진다');
    assert.ok(/교안 전체/.test(ctx.dialogs[0].subtitle));
    const stored = JSON.parse(ctx.storage[KEY]);
    assert.strictEqual(stored.topic, '내가 정한 주제');
    assert.strictEqual(stored.markdown, '# 내가 쓴 내용\n\n강조할 예시');
    assert.strictEqual(ctx.opened.length, 1);
});

test('창을 취소하면 아무것도 넘기지 않는다', () => {
    const ctx = makeContext({ dialogEdit: null });
    ctx.openWhiteboardStudio(7);
    assert.strictEqual(ctx.storage[KEY], undefined);
    assert.strictEqual(ctx.opened.length, 0);
});

test('창의 입력을 검사한다 (빈 주제·빈 내용·너무 긴 값)', () => {
    const ctx = makeContext();
    assert.deepStrictEqual({ ...ctx.readWhiteboardDialog('  주제 ', ' 내용\r\n둘째 줄 ') }, { topic: '주제', markdown: '내용\n둘째 줄' });
    assert.ok(ctx.readWhiteboardDialog('', '내용').error.includes('주제'));
    assert.ok(ctx.readWhiteboardDialog('주제', '   ').error.includes('내용'));
    assert.ok(ctx.readWhiteboardDialog('가'.repeat(301), '내용').error.includes('300자'));
    assert.ok(ctx.readWhiteboardDialog('주제', '가'.repeat(1000001)).error);
});

runTests(tests);
