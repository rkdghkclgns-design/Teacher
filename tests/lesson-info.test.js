// 학습 탭 첫머리(개요 → 학습 정보 → 학습 목표)와 체크리스트 다시 보기 링크 테스트 (실행: node tests/lesson-info.test.js)
// 학습 정보는 차시 메타데이터로 코드가 쓴다(js/lesson-info.js). 다시 보기 링크는 그릴 때만 단다(js/checklist-links.js).
// 생성 길(탭 생성·다시 만들기·교안 전체 생성·병합·일괄 생성)은 실제 파일을 싣고 AI 응답만 스텁으로 둔다. 키는 쓰지 않는다.
// 그리기와 내보내기는 화면과 같은 marked와 HTML 파서(domino)로 돈다. 처음 한 번: npm install --no-save marked@15.0.12 turndown@7.2.4
const { vm, assert, read, source, plain, reply, route, callsOf, call, lessonOf, openSubject, runner, quiet } = require('./code-comments-harness');

let Marked;
let domino;
let NodeFilter;
try {
    ({ Marked } = require('marked'));
    domino = require('@mixmark-io/domino');
    NodeFilter = require('@mixmark-io/domino/lib/NodeFilter');
} catch (err) {
    console.log('FAIL - marked·domino가 없습니다. 먼저 실행: npm install --no-save marked@15.0.12 turndown@7.2.4');
    process.exit(1);
}

const { run, finish } = runner();
const titlesOf = (ctx, md) => plain(call(ctx, 'mdSections')(md)).map(section => section.title);

// 예전 차례(학습 목표 → 개요)로 쓴 학습 탭 초안. 컨벤션 필수 지적이 없어 자동 수정 호출이 나가지 않는다
const OLD_ORDER = [
    '# 📝 반복문', '',
    '## 학습 목표', '', '- 반복문으로 합계를 구하는 코드를 작성할 수 있습니다.', '- 조건문으로 짝수만 고르는 코드를 작성할 수 있습니다.', '',
    '## 개요', '', '- 같은 계산을 손으로 되풀이하면 실수가 늘어납니다.', '- 반복과 조건을 묶어 자동으로 처리합니다.', '',
    '## 1. 합계 구하기 (⏱ 240분)', '', '반복문은 같은 일을 되풀이합니다.', '',
    '## 🎮 2. 짝수 고르기 (⏱ 240분)', '', '조건문은 값을 가려 냅니다.', '',
    '## ✅ 학습 후 체크리스트', '', '- 합계를 구하는 반복문을 설명합니다. (다시 보기: 1. 합계 구하기)', '- 짝수만 고르는 조건을 설명합니다. (다시 보기: 2. 짝수 고르기)'
].join('\n');
const FRAME_TITLES = ['', '개요', '학습 정보', '학습 목표', '1. 합계 구하기 (⏱ 240분)', '🎮 2. 짝수 고르기 (⏱ 240분)', '✅ 학습 후 체크리스트'];
const META = {
    hours: 1.5,
    prereqs: [{ id: 7, title: '변수와 자료형' }],
    tools: [{ name: 'Visual Studio', version: '2022' }, { name: '사내 도구', version: '3', url: 'https://tools.example.com/docs' }, { name: 'Figma', version: '' }]
};
const META_INFO = [
    '## 학습 정보', '',
    '- 권장 수업 시간: 1시간 30분',
    '- 선행: 변수와 자료형',
    '- 후속: 반복문 응용',
    '- 사용 툴과 버전: [Visual Studio 2022](https://visualstudio.microsoft.com/), [사내 도구 3](https://tools.example.com/docs), Figma'
].join('\n');
const NEXT_LESSON = () => lessonOf({ id: 2, title: '반복문 응용', prereqs: [{ id: 1, title: '반복문' }] });
const PRAC = '## 1. 실습 과제 (⏱ 60분)\n\n과제를 수행합니다.';
const volumeStub = opts => ({ md: opts.md, spoken: 0, minutes: 0, targetMinutes: 480, targetChars: 0, calls: 0, added: 0, short: false, stopped: false, gone: false, error: null, reason: 'none', parts: [] });

// 생성·고치기 길을 돌리는 화면 흉내(code-comments-harness appContext)에 이 묶음 파일을 화면 차례대로 더한다. 분량 채우기는 받은 글 그대로 돌려준다
function appWithInfo() {
    const ctx = require('./code-comments-harness').appContext();
    ['lesson-objectives.js', 'lesson-info.js', 'checklist-links.js', 'course-sessions.js'].forEach(file => vm.runInContext(source(file), ctx));
    ctx.volumeStub = volumeStub;
    vm.runInContext('ensureSpokenVolume = async opts => window.volumeStub(opts); window.runLessonPipeline = async () => {};', ctx);
    return ctx;
}

// domino의 querySelectorAll 결과에는 브라우저 NodeList의 forEach가 없다. 내보내기(lesson-export.js exportStrip)가 만든 상자에서 쓰므로 그 상자만 배열로 돌려주게 한다
function withArrayQueries(document) {
    const create = document.createElement.bind(document);
    Object.defineProperty(document, 'createElement', {
        value: name => {
            const el = create(name);
            const query = el.querySelectorAll;
            Object.defineProperty(el, 'querySelectorAll', { value: selector => Array.from(query.call(el, selector)) });
            return el;
        }
    });
    return document;
}

// 그리기·내보내기 화면 흉내: 문서는 domino, marked는 이 컨텍스트만 쓰는 것(tests/lesson-screen.test.js와 같은 틀)
function renderContext() {
    const instance = new Marked();
    const document = withArrayQueries(domino.createDocument('<!doctype html><html><body></body></html>', true));
    const ctx = {
        console: quiet, setTimeout: () => 0, clearTimeout() {}, Promise, URL, Blob,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        marked: { parse: (...args) => instance.parse(...args), use: (...args) => instance.use(...args) }, NodeFilter, document,
        DOMParser: function DOMParser() { this.parseFromString = html => domino.createDocument(String(html), true); }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    const ui = read('js/ui.js').replace(/\r\n/g, '\n');
    const at = ui.indexOf('function escapeHtml(');
    vm.runInContext(ui.slice(at, ui.indexOf('\n}\n', at) + 2), ctx);
    ['data.js', 'lesson-sanitize.js', 'lesson-format.js', 'lesson-export.js', 'lesson-lint.js', 'lesson-opening.js', 'checklist-links.js', 'output-old-html.js', 'api.js']
        .forEach(file => vm.runInContext(source(file), ctx, { filename: file }));
    return ctx;
}

(async () => {
    const ctx = appWithInfo();
    const mod = { id: 1, title: '반복문', ...META };
    const lessons = [mod, NEXT_LESSON()];
    const frame = (md, extra = {}) => call(ctx, 'applyLessonInfoFrame')(md, { mod, tabId: 'basicLearn', lessons, ...extra });
    const order = md => call(ctx, 'orderLessonOpening')(md);

    /* ---------- 첫머리 차례 ---------- */
    await run('차례: 예전 차례(학습 목표 → 개요)는 개요 → 학습 정보 → 학습 목표로 바뀌고 다른 섹션의 글과 차례는 그대로다', () => {
        const out = frame(OLD_ORDER);
        assert.deepStrictEqual(titlesOf(ctx, out), FRAME_TITLES);
        assert.ok(out.startsWith('# 📝 반복문\n\n## 개요\n'), out.slice(0, 80));
        assert.ok(out.includes(`${META_INFO}\n\n## 학습 목표\n\n- 반복문으로`), out);
        assert.ok(out.includes('## 1. 합계 구하기 (⏱ 240분)\n\n반복문은 같은 일을 되풀이합니다.\n\n## 🎮 2. 짝수 고르기'), '내용 섹션은 그대로');
        assert.ok(out.endsWith('(다시 보기: 2. 짝수 고르기)'), '체크리스트는 맨 끝, 다시 보기 글은 그대로');
        assert.deepStrictEqual(titlesOf(ctx, order(OLD_ORDER)), ['', '개요', '학습 목표', '1. 합계 구하기 (⏱ 240분)', '🎮 2. 짝수 고르기 (⏱ 240분)', '✅ 학습 후 체크리스트'], '차례만 맞추면 학습 정보를 새로 넣지 않는다');
    });

    await run('차례: 이미 새 차례면 글자 하나 바뀌지 않고, 두 번 해도 같다', () => {
        const once = frame(OLD_ORDER);
        assert.strictEqual(frame(once), once, '두 번 해도 같다');
        assert.strictEqual(order(once), once, '새 차례는 그대로');
        const plainNew = order(OLD_ORDER);
        assert.strictEqual(order(plainNew), plainNew);
        const crlf = once.replace(/\n/g, '\r\n');
        assert.strictEqual(frame(crlf), crlf, '윈도 줄바꿈 글도 바꿀 것이 없으면 그대로');
    });

    await run('차례: 제목 앞 머리말의 목표, 제목 없는 글, 학습 목표가 내용 뒤에 있는 글, 코드 블록 안의 ## 제목', () => {
        const head = '## 학습 목표\n\n- 목표를 쓸 수 있습니다.\n\n# 📝 제목\n\n## 개요\n\n- 문제입니다.\n\n## 본문\n\n글입니다.';
        assert.ok(frame(head).startsWith('## 학습 목표\n\n- 목표를 쓸 수 있습니다.\n\n# 📝 제목\n\n## 개요\n\n- 문제입니다.\n\n## 학습 정보\n'), '제목 앞 머리말의 목표는 # 제목을 넘어 옮기지 않는다(첫머리 정리가 남긴 그대로)');
        assert.deepStrictEqual(titlesOf(ctx, frame(head)), ['학습 목표', '개요', '학습 정보', '본문']);
        const bare = '## 학습 목표\n\n- 목표\n\n## 개요\n\n- 문제\n\n## 본문\n\n글';
        assert.deepStrictEqual(titlesOf(ctx, frame(bare)), ['개요', '학습 정보', '학습 목표', '본문']);
        assert.deepStrictEqual(titlesOf(ctx, frame('## 본문\n\n글')), ['학습 정보', '본문'], '틀이 없으면 맨 앞에 학습 정보만');
        assert.deepStrictEqual(titlesOf(ctx, frame('앞 글입니다.\n\n## 본문\n\n글')), ['', '학습 정보', '본문'], '제목 없는 머리 글 뒤');
        const late = '# 📝 제목\n\n## 개요\n\n- 문제\n\n## 본문\n\n글\n\n## 학습 목표\n\n- 목표';
        assert.deepStrictEqual(titlesOf(ctx, frame(late)), ['', '개요', '학습 정보', '학습 목표', '본문']);
        const code = '# 📝 제목\n\n## 개요\n\n- 문제\n\n## 본문\n\n```python\n## 학습 목표\nprint(1)\n```';
        assert.deepStrictEqual(titlesOf(ctx, frame(code)), ['', '개요', '학습 정보', '본문'], '코드 블록 안의 ## 줄은 제목이 아니다');
        assert.ok(frame(code).includes('```python\n## 학습 목표\nprint(1)\n```'));
    });

    await run('차례: 학습 탭이 아니거나 최종 평가·빈 글이면 그대로 둔다', () => {
        ['basicPrac', 'advPrac', 'assessment', 'advAssessment'].forEach(tabId => assert.strictEqual(frame(OLD_ORDER, { tabId }), OLD_ORDER, tabId));
        assert.strictEqual(call(ctx, 'applyLessonInfoFrame')(OLD_ORDER, { mod: { id: 'mainQuest', ...META }, tabId: 'basicLearn' }), OLD_ORDER);
        assert.strictEqual(frame('  '), '  ');
        assert.deepStrictEqual(titlesOf(ctx, frame(OLD_ORDER, { tabId: 'advLearn' })), FRAME_TITLES, '심화학습도 같다');
        assert.strictEqual(call(ctx, 'orderLessonOpening')(OLD_ORDER, { mod, tabId: 'basicPrac' }), OLD_ORDER);
    });

    /* ---------- 독립 검토 지적(18차 후속) ---------- */
    await run('검토 1: 제목이 꼭 \'학습 정보\'인 섹션만 학습 정보다. \'학습 정보 시스템\' 같은 내용 섹션은 본문을 지우지 않고 내용으로 본다', () => {
        const is = call(ctx, 'isLessonInfoTitle');
        ['학습 정보', '학습정보', '📌 학습 정보', '1. 학습 정보', '학습 정보 (⏱ 5분)', ' 학습 정보 ', '학습 정보（⏱ 5분）'].forEach(title => assert.strictEqual(is(title), true, title));
        ['학습 정보 시스템', '학습 정보 시스템 (⏱ 10분)', '학습 정보처리', '학습 정보 (⏱ 10분) 정리', '학습 정보와 보안', '개인 학습 정보'].forEach(title => assert.strictEqual(is(title), false, title));
        const body = '## 학습 정보 시스템 (⏱ 10분)\n\n학습 정보 시스템은 수강 기록을 모아 둡니다.';
        const md = OLD_ORDER.replace('## 1. 합계 구하기', `${body}\n\n## 1. 합계 구하기`);
        const out = frame(md);
        assert.ok(out.includes(body), '내용 섹션의 본문이 남는다');
        assert.deepStrictEqual(titlesOf(ctx, out), ['', '개요', '학습 정보', '학습 목표', '학습 정보 시스템 (⏱ 10분)', ...FRAME_TITLES.slice(4)], '학습 정보는 따로 넣고 내용 섹션은 제자리');
        assert.strictEqual(call(ctx, 'lessonContentTitles')(['학습 정보 시스템 (⏱ 10분)', '학습 정보']).length, 1, '검수: 내용 섹션');
        assert.strictEqual(call(ctx, 'isVolumeContentSection')({ title: '학습 정보 시스템 (⏱ 10분)', text: body }), true, '분량 채우기: 늘릴 수 있는 섹션');
        assert.ok(call(ctx, 'spokenChars')(body) > 20, '낭독 분량에 든다');
        assert.ok(plain(call(ctx, 'lintLessonMarkdown')(`${body} 버전 3입니다.`, 'basicLearn')).some(issue => issue.msg === '버전 의존 정보를 본문에 쓰지 않습니다.'), '어구 검사도 한다');
        const { sections } = plain(call(ctx, 'splitLessonSections')([{ text: `# 📝 제목\n\n${body}${' 설명 문장입니다.'.repeat(4)}\n\n## 학습 정보\n\n- 선행: 없음`, practice: false }]));
        assert.deepStrictEqual(sections.map(section => section.title), ['학습 정보 시스템'], '교수안: 내용 섹션은 전개, 학습 정보는 머리말');
        const image = call(ctx, 'IMAGE_SKIP_SECTIONS');
        assert.deepStrictEqual(['## 학습 정보', '## 📌 1. 학습 정보 (⏱ 5분)\r', '# 학습 정보\n\n본문', '## 학습 정보 시스템', '## 학습 정보 시스템 (⏱ 10분)'].map(text => image.test(text)), [true, true, true, false, false], '그림: 학습 정보 제목 줄만 건너뛴다');
        assert.ok(/## 학습 정보 시스템 \(⏱ 10분\)\n\n<!-- \[IMG/.test(call(ctx, 'autoInjectImageTags')(out)), '내용 섹션에는 그림 자리를 넣는다');
        const sectionsOf = text => plain(call(ctx, 'mdSections')(text));
        const noGoals = sectionsOf('# 제목\n\n## 학습 정보 시스템\n\n글\n\n## ✅ 학습 후 체크리스트\n\n- 항목');
        assert.strictEqual(call(ctx, 'newSectionIndex')(noGoals, '학습 목표'), 1, '자동 수정: 내용 섹션 뒤로 학습 목표를 넣지 않는다');
        const set = { objective: '표로 정리할 수 있습니다.', section: '## 3. 결과\n\n- 결과', checklist: '정리합니다. (다시 보기: 3. 결과)' };
        assert.deepStrictEqual(titlesOf(ctx, call(ctx, 'insertObjectiveSet')('# 제목\n\n## 학습 정보 시스템\n\n글', set)).slice(0, 3), ['', '학습 목표', '학습 정보 시스템'], '학습 목표 세트도 같다');
    });

    await run('검토 2: # 제목을 넘어 섹션을 옮기지 않는다. 뒤에 붙은 # 일일 퀘스트의 개요·학습 목표·학습 정보는 그대로다', () => {
        const quest = '# ⚔️ 일일 퀘스트 (실습 과제)\n\n## 개요\n\n- 퀘스트의 상황입니다.\n\n## 학습 목표\n\n- 퀘스트를 마칠 수 있습니다.\n\n## 학습 정보\n\n- 퀘스트 메모입니다.\n';
        const noOverview = OLD_ORDER.replace(/## 개요\n\n- [^\n]+\n- [^\n]+\n\n/, '');
        const out = frame(`${noOverview}\n\n${quest}`);
        assert.ok(out.endsWith(quest), `퀘스트 글이 한 글자도 바뀌지 않는다:\n${out.slice(out.indexOf('# ⚔️'))}`);
        assert.ok(out.startsWith(`# 📝 반복문\n\n${META_INFO}\n\n## 학습 목표\n`), '이 차시의 학습 목표만 옮기고 학습 정보는 이 차시에 넣는다');
        assert.strictEqual((out.match(/^## 개요$/gm) || []).length, 1, '퀘스트의 개요를 위로 옮기지 않는다');
        const bare = '## 학습 목표\n\n- 목표\n\n## 본문\n\n글\n\n# ⚔️ 일일 퀘스트\n\n## 개요\n\n- 퀘스트\n\n## 학습 정보\n\n- 퀘스트 메모';
        const bareOut = frame(bare);
        assert.ok(bareOut.endsWith('# ⚔️ 일일 퀘스트\n\n## 개요\n\n- 퀘스트\n\n## 학습 정보\n\n- 퀘스트 메모'), bareOut);
        assert.ok(bareOut.startsWith(`${META_INFO}\n\n## 학습 목표`), '제목 없는 탭은 맨 앞부터 첫 # 제목 앞까지가 이 차시다');
        assert.strictEqual(order(`${noOverview}\n\n${quest}`), `${noOverview}\n\n${quest}`, '차례만 맞출 때도 퀘스트의 섹션을 끌어오지 않는다');
    });

    await run('검토 3: 없는 학습 목표는 맨 앞에서 이어진 개요·학습 정보 뒤에 넣는다(본문 뒤쪽의 개요 섹션은 보지 않는다)', () => {
        const set = { objective: '표로 결과를 정리할 수 있습니다.', section: '## 4. 결과 정리\n\n- 표를 다룹니다.', checklist: '결과를 정리합니다. (다시 보기: 4. 결과 정리)' };
        const noGoals = frame(OLD_ORDER).replace(/## 학습 목표\n\n- [^\n]+\n- [^\n]+\n\n/, '').replace('## ✅ 학습 후 체크리스트', '## 3. 개요\n\n- 본문 뒤쪽의 개요 섹션입니다.\n\n## ✅ 학습 후 체크리스트');
        assert.deepStrictEqual(titlesOf(ctx, call(ctx, 'insertObjectiveSet')(noGoals, set)).slice(0, 5), ['', '개요', '학습 정보', '학습 목표', '1. 합계 구하기 (⏱ 240분)']);
        const noFrame = '# 제목\n\n## 1. 본문\n\n글\n\n## 개요\n\n- 뒤쪽 개요';
        assert.deepStrictEqual(titlesOf(ctx, call(ctx, 'insertObjectiveSet')(noFrame, set)).slice(0, 2), ['', '학습 목표'], '맨 앞에 틀이 없으면 머리말 바로 뒤');
        const sections = plain(call(ctx, 'mdSections')(noGoals));
        assert.strictEqual(call(ctx, 'newSectionIndex')(sections, '학습 목표'), 3, '자동 수정의 새 섹션 자리도 맨 앞에서 이어진 틀만 본다');
    });

    await run('검토 4: 차례를 바꿔도 파트의 글은 그대로다(줄 끝 빈칸 두 개의 줄바꿈, 파트 끝 빈 줄·<br>, 글 끝 줄바꿈)', () => {
        const goals = '## 학습 목표\n\n- 반복문으로 합계를 구하는 코드를 작성할 수 있습니다.  \n  이어지는 줄입니다.  \n\n<br>\n\n\n';
        const overview = '## 개요\n\n- 같은 계산을 손으로 되풀이하면 실수가 늘어납니다.  \n- 자동으로 처리합니다.\n\n';
        const content = '## 1. 합계 구하기 (⏱ 240분)\n\n첫 줄입니다.  \n둘째 줄입니다.  ';
        const md = `# 📝 반복문\n\n${goals}${overview}${content}\n\n`;
        const out = order(md);
        assert.ok(out.includes(goals) && out.includes(overview) && out.includes(content), out);
        assert.ok(out.startsWith(`# 📝 반복문\n\n${overview}${goals}${content}`), JSON.stringify(out));
        assert.ok(out.endsWith('둘째 줄입니다.  \n\n'), '글 끝 줄바꿈은 받은 글과 같다');
        const tight = '# 📝 제목\n## 학습 목표\n- 목표\n## 개요\n- 문제';
        assert.strictEqual(order(tight), '# 📝 제목\n\n## 개요\n- 문제\n\n## 학습 목표\n- 목표', '새로 이웃이 된 파트 사이에만 빈 줄을 넣는다');
        const framed = frame(md);
        assert.ok(framed.includes(`${overview}${META_INFO}\n\n${goals}`), '학습 정보 뒤에는 빈 줄 하나');
    });

    await run('학습 정보: AI가 쓴 학습 정보는 메타데이터로 바꿔 쓰고, 고정한 학습 정보는 그대로 둔다', () => {
        const written = OLD_ORDER.replace('## 개요', '## 학습 정보 (⏱ 5분)\n\n- 권장 수업 시간: 3시간\n- 선행: 아무거나\n\n## 개요');
        const out = frame(written);
        assert.deepStrictEqual(titlesOf(ctx, out), FRAME_TITLES);
        assert.ok(out.includes(META_INFO) && !out.includes('아무거나') && !out.includes('3시간'), out);
        const locked = frame(written, { lockedBlocks: [{ title: '학습 정보 (⏱ 5분)', text: '' }] });
        assert.ok(locked.includes('- 선행: 아무거나') && !locked.includes(META_INFO), '고정한 섹션은 한 글자도 바꾸지 않는다');
        assert.deepStrictEqual(titlesOf(ctx, locked), ['', '개요', '학습 정보 (⏱ 5분)', '학습 목표', ...FRAME_TITLES.slice(4)], '자리는 맞춘다');
    });

    /* ---------- 학습 정보 줄 ---------- */
    await run('학습 정보: 권장 수업 시간은 차시 시간으로 쓰고, 모르면 줄을 뺀다', () => {
        const hours = call(ctx, 'lessonInfoHours');
        assert.deepStrictEqual([1, 1.5, 0.75, 2, '2', 1.25, 8].map(hours), ['1시간', '1시간 30분', '45분', '2시간', '2시간', '1시간 15분', '8시간']);
        [0, -1, '', 'abc', null, undefined, NaN, {}, true].forEach(value => assert.strictEqual(hours(value), '', String(value)));
        const lines = call(ctx, 'lessonInfoLines')({ id: 3, title: '혼자' }, []);
        assert.deepStrictEqual(plain(lines), ['- 선행: 없음'], '시간·선행·후속·툴이 모두 없으면 선행 없음 한 줄');
    });

    await run('학습 정보: 선행은 직접 선행 차시 제목을 잇고, 없으면 없음이다', () => {
        const lines = mod2 => plain(call(ctx, 'lessonInfoLines')(mod2, []));
        assert.ok(lines({ id: 3, prereqs: [{ id: 1, title: '변수' }, { id: 2, title: '조건문' }] }).includes('- 선행: 변수, 조건문'));
        assert.ok(lines({ id: 3, prereqs: [] }).includes('- 선행: 없음'));
        assert.ok(lines({ id: 3, prereqs: [{ id: 1, title: '  ' }, null, { id: 2 }] }).includes('- 선행: 없음'), '제목 없는 칸은 빼고 남는 것이 없으면 없음');
        assert.ok(lines({ id: 3, prereqs: [{ title: '변수 *강조* [링크]' }] }).includes('- 선행: 변수 \\*강조\\* \\[링크\\]'), '서식 기호는 글자로');
    });

    await run('학습 정보: 후속은 같은 교과의 바로 다음 차시가 이 차시를 선행으로 적었을 때(연속편)만 쓴다', () => {
        const next = (list, target = list[0]) => call(ctx, 'lessonInfoNext')(target, list);
        const a = { id: 1, title: '반복문' };
        assert.strictEqual(next([a, { id: 2, title: '응용', prereqs: [{ id: 1, title: '반복문' }] }]), '응용');
        assert.strictEqual(next([a, { id: 2, title: '응용', prereqs: [{ title: '반복문' }] }]), '응용', 'id가 없으면 제목으로 잇는다');
        assert.strictEqual(next([a, { id: 2, title: '다른 주제', prereqs: [] }]), '', '다음 차시가 선행으로 적지 않았다');
        assert.strictEqual(next([a, { id: 2, title: '다른 주제' }, { id: 3, title: '먼 연속편', prereqs: [{ id: 1, title: '반복문' }] }]), '', '바로 다음 차시만 본다');
        assert.strictEqual(next([{ id: 0, title: '앞' }, a]), '', '마지막 차시');
        assert.strictEqual(next([a, { id: 'mainQuest', title: '최종 평가', prereqs: [{ id: 1 }] }]), '', '최종 평가는 후속이 아니다');
        assert.strictEqual(next([], a), '', '교과를 모르면 쓰지 않는다');
        const siblings = call(ctx, 'lessonInfoSiblings');
        const subject = openSubject(ctx, [lessonOf({ id: 1, title: '반복문' }), NEXT_LESSON()]);
        assert.strictEqual(siblings(subject.lessons[0]), subject.lessons, '그 차시가 든 교과의 차시 목록');
        assert.deepStrictEqual(plain(siblings({ id: 99 })), []);
    });

    await run('학습 정보: 툴은 [이름 버전](주소), 주소는 차시 정보의 https 주소 → 흔한 툴의 공식 페이지 → 없으면 이름만', () => {
        const tool = call(ctx, 'lessonInfoTool');
        assert.strictEqual(tool({ name: 'Visual Studio', version: '2022' }), '[Visual Studio 2022](https://visualstudio.microsoft.com/)');
        assert.strictEqual(tool({ name: 'Visual Studio Code', version: '1.90' }), '[Visual Studio Code 1.90](https://code.visualstudio.com/)', 'Visual Studio보다 먼저 찾는다');
        assert.strictEqual(tool({ name: 'visual studio 2022' }), '[visual studio 2022](https://visualstudio.microsoft.com/)', '이름에 버전을 붙여 적어도 찾는다');
        [['Unity', 'https://unity.com/'], ['Unreal Engine', 'https://www.unrealengine.com/'], ['Python', 'https://www.python.org/'], ['Node.js', 'https://nodejs.org/'], ['Git', 'https://git-scm.com/'],
            ['Blender', 'https://www.blender.org/'], ['Godot', 'https://godotengine.org/'], ['IntelliJ IDEA', 'https://www.jetbrains.com/idea/'], ['Android Studio', 'https://developer.android.com/studio'], ['ECLIPSE', 'https://www.eclipse.org/']]
            .forEach(([name, url]) => assert.strictEqual(tool({ name, version: '' }), `[${name}](${url})`, name));
        assert.strictEqual(tool({ name: 'GitHub', version: '' }), 'GitHub', '이름이 다른 툴(GitHub의 Git)은 링크하지 않는다');
        assert.strictEqual(tool({ name: 'Unity Hub', version: '3' }), 'Unity Hub 3');
        assert.strictEqual(tool({ name: '사내 도구', version: '3', url: 'https://tools.example.com/docs' }), '[사내 도구 3](https://tools.example.com/docs)');
        assert.strictEqual(tool({ name: 'Unity', version: '6', url: 'https://docs.unity3d.com/Manual' }), '[Unity 6](https://docs.unity3d.com/Manual)', '적은 주소가 먼저다');
        ['http://unity.com', 'javascript:alert(1)', 'https://a.kr/x y', 'https://a.kr/(x)', 'https://user:pw@a.kr', 'ftp://a.kr', 'https://a.kr/"onmouseover=x', 5].forEach(url => {
            assert.strictEqual(tool({ name: 'Unity', version: '6', url }), '[Unity 6](https://unity.com/)', `받지 않는 주소는 공식 페이지로: ${url}`);
            assert.strictEqual(tool({ name: '사내 도구', version: '', url }), '사내 도구', `공식 페이지도 없으면 이름만: ${url}`);
        });
        assert.strictEqual(tool({ name: 'A<b>[x]', version: '1' }), 'A&lt;b&gt;\\[x\\] 1', '이름은 글자로 넣는다');
        assert.strictEqual(tool({ name: '', version: '1' }), '', '이름 없는 툴은 뺀다');
        assert.ok(!plain(call(ctx, 'lessonInfoLines')({ id: 3, tools: [] }, [])).some(line => line.includes('사용 툴')), '툴이 없으면 줄을 뺀다');
        ctx.globalState.courseDesign = { tools: [{ name: 'Python', version: '3.12' }] };
        assert.ok(plain(call(ctx, 'lessonInfoLines')({ id: 3 }, [])).includes('- 사용 툴과 버전: [Python 3.12](https://www.python.org/)'), '차시에 툴이 없으면 과정 공통 툴');
        delete ctx.globalState.courseDesign;
    });

    await run('툴 칸: "이름 | 버전 | 주소"를 읽고 다시 쓴다. 주소는 https만 받는다(차시 정보·과정 공통 툴·불러오기)', () => {
        const parse = text => plain(call(ctx, 'parseToolLines')(text));
        assert.deepStrictEqual(parse('Unity | 6000.0 LTS\nBlender\n\n'), [{ name: 'Unity', version: '6000.0 LTS' }, { name: 'Blender', version: '' }], '주소가 없으면 예전과 같다');
        assert.deepStrictEqual(parse('사내 도구 | 3 | https://tools.example.com/docs\nFigma |  | https://www.figma.com/'), [
            { name: '사내 도구', version: '3', url: 'https://tools.example.com/docs' }, { name: 'Figma', version: '', url: 'https://www.figma.com/' }]);
        assert.deepStrictEqual(parse('Unity | 6 | http://unity.com\nGit | 2 | javascript:alert(1)\nA | 1 | https://a.kr/x y'), [
            { name: 'Unity', version: '6' }, { name: 'Git', version: '2' }, { name: 'A', version: '1' }], 'https가 아닌 주소는 버린다');
        const tools = [{ name: '사내 도구', version: '3', url: 'https://tools.example.com/docs' }, { name: 'Figma', version: '', url: 'https://www.figma.com/' }, { name: 'Unity', version: '6' }, { name: 'Blender', version: '' }];
        const text = tools.map(call(ctx, 'toolLineText')).join('\n');
        assert.strictEqual(text, '사내 도구 | 3 | https://tools.example.com/docs\nFigma |  | https://www.figma.com/\nUnity | 6\nBlender');
        assert.deepStrictEqual(parse(text), tools.map(tool => ({ version: '', ...tool })), '다시 읽어도 같다');
        assert.strictEqual(call(ctx, 'designToolLines')(tools), text, '과정 공통 툴 칸도 같은 모양');
        const rule = call(ctx, 'LESSON_ROW_RULES').tools;
        const row = { name: 'A', version: '1', url: 'https://a.kr/' };
        assert.strictEqual(rule(row), row, '바른 줄은 그대로(불러오기·저장 파일)');
        assert.deepStrictEqual(plain(rule({ name: 'A', url: 5 })), { name: 'A', url: '5' }, '글이 아닌 주소는 글로 맞춘다(링크는 https만 쓴다)');
    });

    /* ---------- 학습 정보를 내용으로 보지 않는 곳(예전·새 차례 모두) ---------- */
    const NEW_ORDER = frame(OLD_ORDER);
    await run('검수: 예전 차례와 새 차례 모두 구조 지적이 없고, 학습 정보는 내용 섹션·어구 검사에 들지 않는다', () => {
        const lint = md => plain(call(ctx, 'lintLessonMarkdown')(md, 'basicLearn', { codeComments: false })).filter(issue => issue.sev === 'bad');
        assert.deepStrictEqual(lint(OLD_ORDER), []);
        assert.deepStrictEqual(lint(NEW_ORDER), []);
        const stats = md => plain(call(ctx, 'lessonStructureStats')(md));
        assert.deepStrictEqual(stats(NEW_ORDER), stats(OLD_ORDER), '내용 섹션 수에 학습 정보를 세지 않는다');
        assert.deepStrictEqual(stats(NEW_ORDER), { objectives: 2, sections: 2, checklist: 2 });
        const versioned = NEW_ORDER.replace('Figma', 'Unity 2022.3.10f1 (버전 3)');
        assert.ok(!plain(call(ctx, 'lintLessonMarkdown')(versioned, 'basicLearn')).some(issue => issue.where === '학습 정보'), '학습 정보의 버전은 지적하지 않는다');
        assert.ok(plain(call(ctx, 'lintLessonMarkdown')(versioned.replace('반복문은 같은', 'Unity 2022.3.10에서 반복문은 같은'), 'basicLearn')).some(issue => issue.msg === '버전 의존 정보를 본문에 쓰지 않습니다.'), '본문의 버전은 그대로 지적한다');
        assert.strictEqual(call(ctx, 'lessonContentTitles')(['학습 정보', '개요', '학습 목표', '1. 합계']).length, 1);
    });

    await run('낭독 분량·시간: 학습 정보는 낭독 분량에 들지 않고, (⏱) 합계도 그대로다. 분량 채우기는 학습 정보를 늘리지 않는다', () => {
        const spoken = call(ctx, 'spokenChars');
        assert.strictEqual(spoken(NEW_ORDER), spoken(OLD_ORDER), '학습 정보를 넣어도 낭독 분량은 같다');
        assert.strictEqual(spoken('## 학습 정보\n\n- 선행: 없음\n\n### 소제목\n\n글'), 0, '학습 정보 안의 ### 소제목도 세지 않는다');
        assert.ok(spoken('## 학습 정보\n\n- 선행: 없음\n\n## 본문\n\n본문 글입니다.') > 0, '다음 ## 제목부터 다시 센다');
        assert.ok(spoken('```text\n## 학습 정보\n```\n\n본문 글입니다.') > 0, '코드 블록 안의 줄은 제목이 아니다');
        assert.strictEqual(call(ctx, 'volumeLabelSum')(NEW_ORDER), call(ctx, 'volumeLabelSum')(OLD_ORDER));
        const isContent = call(ctx, 'isVolumeContentSection');
        assert.strictEqual(isContent({ title: '학습 정보', text: '## 학습 정보\n\n- 선행: 없음' }), false);
        const retimed = call(ctx, 'retimeSections')(NEW_ORDER, 480);
        assert.ok(retimed.includes('## 학습 정보\n') && !/## 학습 정보 \(⏱/.test(retimed), '시간을 다시 매겨도 학습 정보에는 (⏱)을 붙이지 않는다');
        const plan = call(ctx, 'volumePlan')(NEW_ORDER, { goal: 999999 });
        assert.ok(plan && !/학습 정보|개요|학습 목표/.test(plan.title), plan && plan.title);
    });

    await run('첫머리 정리·문제은행·학습 목표 세트·교육 자료: 예전 차례와 새 차례 모두 같게 읽는다', () => {
        const clean = call(ctx, 'cleanLessonOpening');
        assert.strictEqual(clean(OLD_ORDER), OLD_ORDER, '예전 차례 그대로');
        assert.strictEqual(clean(NEW_ORDER), NEW_ORDER, '새 차례 그대로');
        const preamble = `## 학습 정보\n\n- 선행: 없음\n\n## 개요\n\n- 문제\n\n${OLD_ORDER}`;
        assert.strictEqual(clean(preamble), OLD_ORDER, '제목 앞 머리말의 학습 정보·개요는 뺀다');
        const lessonOld = lessonOf({ tabs: { basicLearn: OLD_ORDER } });
        const lessonNew = lessonOf({ tabs: { basicLearn: NEW_ORDER } });
        assert.deepStrictEqual(plain(call(ctx, 'qbankObjectives')(lessonNew, 'basic')), plain(call(ctx, 'qbankObjectives')(lessonOld, 'basic')));
        assert.deepStrictEqual(plain(call(ctx, 'qbankChecklist')(lessonNew, 'basic')).length, 2);
        assert.deepStrictEqual(plain(call(ctx, 'lessonChecklist')(lessonNew, 'basic')), plain(call(ctx, 'lessonChecklist')(lessonOld, 'basic')), '교수안·슬라이드가 읽는 체크리스트(course-sessions.js)도 같다');
        assert.deepStrictEqual(plain(call(ctx, 'lessonChecklist')(lessonNew, 'basic')), ['합계를 구하는 반복문을 설명합니다.', '짝수만 고르는 조건을 설명합니다.']);
        assert.strictEqual(call(ctx, 'qbankObjectiveSection')(NEW_ORDER, '조건문으로 짝수만 고르는 코드를 작성할 수 있습니다.').split('\n')[0], '## 🎮 2. 짝수 고르기 (⏱ 240분)');
        const range = md => plain(call(ctx, 'objectiveContentRange')(md, 0)).map(section => section.title);
        assert.deepStrictEqual(range(NEW_ORDER), range(OLD_ORDER));
        assert.deepStrictEqual(range(NEW_ORDER), ['1. 합계 구하기 (⏱ 240분)']);
        assert.ok(!plain(call(ctx, 'objectiveContentSections')(NEW_ORDER)).some(section => section.title === '학습 정보'), '학습 정보는 목표의 내용 섹션이 아니다');
        const set = { objective: '표로 결과를 정리할 수 있습니다.', section: '## 3. 결과 정리\n\n- 표를 다룹니다.', checklist: '결과를 정리합니다. (다시 보기: 3. 결과 정리)' };
        const added = call(ctx, 'insertObjectiveSet')(NEW_ORDER, set);
        assert.strictEqual(call(ctx, 'lessonLintBullets')(added, '학습\\s*목표').length, 3);
        const noGoals = NEW_ORDER.replace(/## 학습 목표\n\n- [^\n]+\n- [^\n]+\n\n/, '');
        const inserted = call(ctx, 'insertObjectiveSet')(noGoals, set);
        assert.deepStrictEqual(titlesOf(ctx, inserted).slice(0, 4), ['', '개요', '학습 정보', '학습 목표'], '없는 학습 목표는 학습 정보 바로 뒤에 넣는다');
        const oldNoGoals = OLD_ORDER.replace(/## 학습 목표\n\n- [^\n]+\n- [^\n]+\n\n/, '');
        assert.deepStrictEqual(titlesOf(ctx, call(ctx, 'insertObjectiveSet')(oldNoGoals, set)).slice(0, 3), ['', '개요', '학습 목표'], '학습 정보가 없으면 개요 뒤');
    });

    await run('자동 수정의 새 섹션 자리: 개요는 맨 앞, 학습 정보는 개요 뒤, 학습 목표는 학습 정보(없으면 개요) 뒤', () => {
        const place = (md, title) => {
            const sections = plain(call(ctx, 'mdSections')(md));
            return call(ctx, 'newSectionIndex')(sections, title);
        };
        const noGoals = NEW_ORDER.replace(/## 학습 목표\n\n- [^\n]+\n- [^\n]+\n\n/, '');
        assert.strictEqual(place(noGoals, '학습 목표'), 3, '학습 정보 바로 뒤');
        const noInfo = NEW_ORDER.replace(`${META_INFO}\n\n`, '');
        assert.strictEqual(place(noInfo, '학습 정보'), 2, '개요 바로 뒤');
        assert.strictEqual(place(OLD_ORDER.replace(/## 개요\n\n- [^\n]+\n- [^\n]+\n\n/, ''), '개요'), 1, '예전 차례의 탭에도 빠진 개요는 맨 앞');
        assert.strictEqual(place(OLD_ORDER, '✅ 학습 후 체크리스트'), 6);
    });

    await run('그림·교수안: 학습 정보에는 그림 자리를 넣지 않고, 교수안은 학습 정보를 전개가 아니라 머리말로 읽는다', () => {
        assert.ok(call(ctx, 'IMAGE_SKIP_SECTIONS').test('## 학습 정보'));
        const injected = call(ctx, 'autoInjectImageTags')(NEW_ORDER);
        assert.ok(!/## 학습 정보\n\n<!-- \[IMG/.test(injected) && !/## 개요\n\n<!-- \[IMG/.test(injected), '학습 정보·개요 아래에는 넣지 않는다');
        assert.ok(/## 1\. 합계 구하기 \(⏱ 240분\)\n\n<!-- \[IMG/.test(injected), '내용 섹션에는 넣는다');
        const { intro, sections } = plain(call(ctx, 'splitLessonSections')([{ text: `${NEW_ORDER}\n\n${'설명 문장입니다. '.repeat(5)}`, practice: false }]));
        assert.ok(intro.includes('학습 정보') && intro.includes('권장 수업 시간: 1시간 30분'), intro);
        assert.ok(!sections.some(section => /학습 정보|개요|학습 목표/.test(section.title)), plain(sections).map(section => section.title).join(', '));
    });

    /* ---------- 생성 길 ---------- */
    await run('탭 생성: 새 기본학습·심화학습은 자동 수정·분량 채우기 뒤 첫머리를 맞추고 학습 정보를 넣는다. 실습 탭은 그대로다', async () => {
        const gen = appWithInfo();
        const lesson = lessonOf({ id: 1, title: '반복문', ...META });
        openSubject(gen, [lesson, NEXT_LESSON()]);
        gen.ai = route(gen, { tab: item => reply(item.user.includes('basicPrac') ? PRAC : OLD_ORDER) });
        for (const tabId of ['basicLearn', 'advLearn', 'basicPrac']) {
            const result = await call(gen, 'generateTabContent')(1, tabId);
            assert.ok(result.ok, JSON.stringify(result));
        }
        assert.deepStrictEqual(titlesOf(gen, lesson.tabContents.basicLearn), FRAME_TITLES);
        assert.ok(lesson.tabContents.basicLearn.includes(META_INFO), lesson.tabContents.basicLearn);
        assert.deepStrictEqual(titlesOf(gen, lesson.tabContents.advLearn), FRAME_TITLES, '심화학습');
        assert.strictEqual(lesson.tabContents.basicPrac, PRAC, '실습 탭에는 넣지 않는다');
        assert.deepStrictEqual(callsOf(gen, 'fix'), [], '자동 수정 호출 없음(초안에 필수 지적이 없다)');
    });

    await run('탭 다시 만들기: 미리 보기에 학습 정보가 든 글이 가고, 고른 글은 차례만 다시 맞춘다(반영하지 않은 학습 정보는 다시 넣지 않는다)', async () => {
        const gen = appWithInfo();
        const lesson = lessonOf({ id: 1, title: '반복문', ...META, tabs: { basicLearn: OLD_ORDER.replace('반복문은 같은 일을', '예전 글: 반복문은 같은 일을') } });
        openSubject(gen, [lesson]);
        gen.ai = route(gen, { tab: () => reply(OLD_ORDER) });
        await call(gen, 'generateTabContent')(1, 'basicLearn');
        assert.ok(gen.previews[0].after.includes('## 학습 정보\n\n- 권장 수업 시간: 1시간 30분'), '미리 보기 글');
        assert.deepStrictEqual(titlesOf(gen, lesson.tabContents.basicLearn), FRAME_TITLES);
        const again = appWithInfo();
        const lesson2 = lessonOf({ id: 1, title: '반복문', ...META, tabs: { basicLearn: OLD_ORDER } });
        openSubject(again, [lesson2]);
        again.previewAnswer = OLD_ORDER.replace('반복문은 같은 일을', '고른 글: 반복문은 같은 일을');
        again.ai = route(again, { tab: () => reply(OLD_ORDER) });
        await call(again, 'generateTabContent')(1, 'basicLearn');
        assert.deepStrictEqual(titlesOf(again, lesson2.tabContents.basicLearn), ['', '개요', '학습 목표', ...FRAME_TITLES.slice(4)], '학습 정보를 반영하지 않았으면 넣지 않고 차례만 맞춘다');
        assert.ok(lesson2.tabContents.basicLearn.includes('고른 글: 반복문은'));
    });

    await run('교안 전체 생성: 기본학습 첫머리를 맞추고 학습 정보를 넣는다(최종 평가는 그대로)', async () => {
        const gen = appWithInfo();
        const lesson = lessonOf({ id: 1, title: '반복문', ...META, tabs: {}, status: 'pending', content: '' });
        openSubject(gen, [lesson, NEXT_LESSON()]);
        gen.ai = route(gen, { module: () => reply(OLD_ORDER) });
        await call(gen, 'generateModuleContent')(1, []);
        assert.deepStrictEqual(titlesOf(gen, lesson.tabContents.basicLearn), FRAME_TITLES);
        assert.ok(lesson.tabContents.basicLearn.includes(META_INFO), lesson.tabContents.basicLearn);
        const quest = { id: 'mainQuest', title: '최종 평가', description: '종합 과제', status: 'pending', images: {} };
        const final = appWithInfo();
        openSubject(final, [lessonOf({ tabs: { basicLearn: PRAC } })], { mainQuest: quest });
        vm.runInContext("currentEditingModuleId = 'mainQuest';", final);
        final.ai = route(final, { module: () => reply(OLD_ORDER) });
        await call(final, 'generateModuleContent')('mainQuest', []);
        assert.ok(!quest.content.includes('학습 정보'), '최종 평가에는 넣지 않는다');
    });

    await run('병합: 병합한 기본학습도 첫머리를 맞추고 새 차시의 메타데이터(선행 없음)로 학습 정보를 넣는다', async () => {
        const gen = appWithInfo();
        const subject = openSubject(gen, [lessonOf({ id: 1, title: '반복문', tabs: { basicLearn: OLD_ORDER } }), lessonOf({ id: 2, title: '조건문', tabs: { basicLearn: OLD_ORDER } })]);
        // 병합은 받은 글에 마크다운 정리(sanitizeMarkdownContent)를 하지 않아 이모지로 시작하는 ## 제목이 갈라진다(예전부터 그렇다). 그래서 이모지 없는 제목으로 본다
        const draft = OLD_ORDER.replace('## 🎮 2.', '## 2.').replace('## ✅ 학습 후', '## 학습 후');
        gen.ai = route(gen, { other: () => reply(draft) });
        vm.runInContext("mergeSelectedIds = new Set(['1', '2']);", gen);
        await call(gen, 'executeMerge')();
        const merged = subject.lessons.at(-1);
        assert.ok(merged.title.startsWith('[병합]'), merged.title);
        assert.deepStrictEqual(titlesOf(gen, merged.tabContents.basicLearn), ['', '개요', '학습 정보', '학습 목표', '1. 합계 구하기 (⏱ 240분)', '2. 짝수 고르기 (⏱ 240분)', '학습 후 체크리스트']);
        assert.ok(merged.tabContents.basicLearn.includes('## 학습 정보\n\n- 선행: 없음\n\n## 학습 목표'), merged.tabContents.basicLearn);
        assert.strictEqual(merged.content, merged.tabContents.basicLearn);
    });

    await run('일괄 생성(빈 탭 채우기): 과정 일괄 생성이 부르는 길도 학습 탭에 학습 정보를 넣는다', async () => {
        const gen = appWithInfo();
        const lesson = lessonOf({ id: 1, title: '반복문', ...META, tabs: { basicPrac: PRAC, advPrac: PRAC, assessment: '### 문제 1. 합계', advAssessment: '### 문제 1. 짝수' } });
        openSubject(gen, [lesson, NEXT_LESSON()]);
        gen.ai = route(gen, { tab: () => reply(OLD_ORDER) });
        const result = await call(gen, 'fillMissingTabs')(1, {});
        assert.ok(result.ok, JSON.stringify(plain(result)));
        ['basicLearn', 'advLearn'].forEach(tabId => assert.ok(lesson.tabContents[tabId].includes(META_INFO), tabId));
        assert.strictEqual(lesson.tabContents.basicPrac, PRAC);
    });

    await run('프롬프트: AI에게 개요를 먼저, 학습 목표를 다음에 쓰게 하고 학습 정보는 쓰지 말라고 한다', () => {
        const data = source('data.js');
        const structure = data.slice(data.indexOf('markdown_structure:'), data.indexOf('image_tags:'));
        assert.ok(structure.indexOf('1. [개요(Overview)] — 교안의 가장 처음(최상단)에 위치') > 0 && structure.indexOf('2. [학습 목표(Objectives)] — 개요 바로 다음에 위치') > 0, structure);
        assert.ok(structure.includes("'학습 정보'(수업 시간·선행·사용 툴) 섹션은 프로그램이 넣으므로 쓰지 마세요."));
        const ui = source('ui.js');
        assert.ok(ui.includes('반드시 [1.개요] → [2.학습 목표] → [3.핵심 내용') && ui.includes('개요가 교안 최상단에 오고, 그 다음 학습 목표가 옵니다.'));
        assert.ok(ui.includes('6. 구조 연결성: 개요→학습목표→핵심') && ui.includes('(1.개요, 2.학습 목표, 3.핵심 내용'));
        assert.ok(!/학습 목표가 교안 최상단|학습 목표가 최상단|\[1\.학습 목표\]/.test(ui));
    });

    await run('화면 싣기: 새 파일 두 개를 첫머리 정리 뒤에 ?v=125로 싣는다', () => {
        const html = read('index.html');
        const at = name => html.indexOf(`<script src="./js/${name}?v=125"></script>`);
        assert.ok(at('lesson-opening.js') > 0 && at('lesson-info.js') > at('lesson-opening.js') && at('checklist-links.js') > at('lesson-info.js'));
        assert.ok(!html.endsWith('\n'), 'index.html 끝에는 줄바꿈이 없다');
    });

    /* ---------- 체크리스트 다시 보기 링크 ---------- */
    const view = renderContext();
    const render = md => call(view, 'renderLessonHTML')(md);
    await run('링크: 체크리스트의 다시 보기 섹션 제목을 그 ## 제목으로 가는 링크로 그린다(앞 이모지·(⏱)는 빼고 견준다). 저장한 글은 그대로다', () => {
        // ## 제목 차례: 개요 1, 학습 정보 2, 학습 목표 3, 합계 4, 짝수 5, 체크리스트 6(# 📝 제목은 h1이다)
        const html = render(NEW_ORDER);
        assert.ok(/<h2 id="lesson-sec-4">1\. 합계 구하기 \(⏱ 240분\)<\/h2>/.test(html), html);
        assert.ok(html.includes('(다시 보기: <a href="#lesson-sec-4" class="lesson-check-link">1. 합계 구하기</a>)'), html);
        assert.ok(/<h2 id="lesson-sec-5">🎮 2\. 짝수 고르기/.test(html) && html.includes('<a href="#lesson-sec-5" class="lesson-check-link">2. 짝수 고르기</a>)'), '제목 앞 이모지는 빼고 견준다');
        assert.strictEqual((html.match(/class="lesson-check-link"/g) || []).length, 2);
        const split = render(NEW_ORDER.replace('(다시 보기: 2. 짝수 고르기)', '(다시 보기: 🎮 2. 짝수 고르기)'));
        assert.ok(split.includes('(다시 보기:<br><a href="#lesson-sec-5" class="lesson-check-link">🎮 2. 짝수 고르기</a>)'), `이모지 앞 줄바꿈(후처리)으로 나뉜 제목도 잇는다: ${split.slice(split.indexOf('체크리스트'))}`);
        assert.ok(!/<h2 id="lesson-sec-[1236]"/.test(html), '가리키지 않은 제목에는 id를 달지 않는다');
        const loose = NEW_ORDER.replace('(다시 보기: 1. 합계 구하기)', '(다시 보기:  합계 구하기 )');
        assert.ok(render(loose).includes('(다시 보기:  <a href="#lesson-sec-4" class="lesson-check-link">합계 구하기</a> )'), '번호를 빼고 적어도 같은 섹션(검수와 같은 규칙), 앞뒤 빈칸은 링크에 넣지 않는다');
        const timed = NEW_ORDER.replace('## 1. 합계 구하기 (⏱ 240분)', '## 1. 합계 구하기 ⏱ 240분');
        assert.strictEqual(call(ctx, 'findLessonSection')(['1합계구하기240분'], '1. 합계 구하기'), 0, '시간을 괄호 없이 쓴 제목도 품는 쪽으로 찾는다');
        assert.ok(render(timed).includes('<a href="#lesson-sec-4" class="lesson-check-link">1. 합계 구하기</a>'));
        assert.ok(!NEW_ORDER.includes('lesson-check-link'), '마크다운은 바꾸지 않는다');
        assert.ok(render(OLD_ORDER).includes('class="lesson-check-link"'), '예전 교안에도 그릴 때 단다');
    });

    await run('링크: 큰 그림이 든 탭도 차시 화면 그리기(그림 데이터를 표시로 바꿔 그리고 맨 끝에 되돌림)가 링크를 단 같은 HTML을 낸다', () => {
        const picture = `data:image/png;base64,${'QUJD'.repeat(3000)}`;
        const md = NEW_ORDER.replace('반복문은 같은 일을 되풀이합니다.', '반복문은 같은 일을 되풀이합니다.\n\n![합계](local:img_1)');
        const images = { img_1: picture };
        const warns = [];
        view.console = { ...quiet, warn: (...args) => warns.push(args.join(' ')) };
        const drawn = call(view, 'renderLessonScreen')(md, images);
        view.console = quiet;
        assert.deepStrictEqual(warns, [], '그림 표시를 되돌리지 못해 다시 그리지 않는다(링크를 다는 정리가 표시를 깨지 않는다)');
        const expected = render(call(view, 'preprocessMarkdown')(call(view, 'inlineLessonImages')(md, images)));
        assert.strictEqual(drawn, expected, '예전 식과 글자 하나까지 같다');
        assert.ok(drawn.includes(picture) && drawn.includes('<a href="#lesson-sec-4" class="lesson-check-link">1. 합계 구하기</a>'));
        assert.strictEqual(call(view, 'renderLessonScreen')(md, images), drawn, '기억해 둔 결과도 같다');
    });

    await run('검토 5: 다시 보기에 (⏱ N분)까지 옮겨 적어도 링크 글자는 섹션 제목만이고 괄호가 짝을 잃지 않는다', () => {
        const md = '# 📝 제목\n\n## 핵심 개념 (⏱ 10분)\n\n글\n\n## 묶음 (A) 정리\n\n글\n\n## ✅ 학습 후 체크리스트\n\n- 항목 (다시 보기: 핵심 개념 (⏱ 10분))\n- 항목 (다시 보기: 묶음 (A) 정리)\n- 항목 (다시 보기: 닫지 않은 (괄호';
        const html = render(md);
        assert.ok(html.includes('(다시 보기: <a href="#lesson-sec-1" class="lesson-check-link">핵심 개념</a> (⏱ 10분))'), html);
        assert.ok(html.includes('(다시 보기: <a href="#lesson-sec-2" class="lesson-check-link">묶음 (A) 정리</a>)'), '제목 안의 짝 맞는 괄호는 제목이다');
        assert.ok(html.includes('(다시 보기: 닫지 않은 (괄호'), '맞는 제목이 없으면 글자로');
        const range = call(view, 'checklistTitleRange');
        assert.deepStrictEqual(plain(range('다시 보기: 핵심 개념 (⏱ 10분))', 7)), { start: 7, end: 12, title: '핵심 개념' });
        assert.deepStrictEqual(plain(range('다시 보기: 핵심 개념（⏱ 10분）)', 7)).title, '핵심 개념', '전각 괄호도 같다');
    });

    await run('링크: 맞는 제목이 없거나 체크리스트가 아니면 글자로 둔다. 체크리스트가 없는 글은 그린 결과를 그대로 돌려준다', () => {
        const missing = NEW_ORDER.replace('(다시 보기: 1. 합계 구하기)', '(다시 보기: 없는 섹션)');
        const html = render(missing);
        assert.ok(html.includes('(다시 보기: 없는 섹션)') && (html.match(/lesson-check-link/g) || []).length === 1, html);
        const outside = '# 📝 제목\n\n## 1. 본문\n\n글 (다시 보기: 1. 본문)\n\n## ✅ 학습 후 체크리스트\n\n- 항목 `(다시 보기: 1. 본문)`';
        assert.ok(!render(outside).includes('lesson-check-link'), '체크리스트 밖과 인라인 코드 안은 바꾸지 않는다');
        const link = call(view, 'linkChecklistReviews');
        const noList = '<h2>본문</h2><p>(다시 보기: 본문)</p>';
        assert.strictEqual(link(noList), noList, '체크리스트가 없으면 그대로');
        assert.strictEqual(link('<p>글</p>'), '<p>글</p>');
    });

    await run('링크: 글자는 글자로만 넣는다(꺾쇠·따옴표·앰퍼샌드), 링크 주소는 #id뿐이다', () => {
        const md = '# 📝 제목\n\n## A & "B" <tag>\n\n글\n\n## ✅ 학습 후 체크리스트\n\n- 항목 (다시 보기: A & "B" &lt;tag&gt;)';
        const html = render(md);
        const linked = html.match(/<a [^>]*class="lesson-check-link"[^>]*>([^<]*)<\/a>/);
        assert.ok(linked, html);
        assert.ok(!linked[1].includes('<') && linked[1].includes('&amp;'), linked[1]);
        const hrefs = [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*class="lesson-check-link"/g)].map(match => match[1]);
        assert.ok(hrefs.length && hrefs.every(href => /^#[\w-]+$/.test(href)), hrefs.join(','));
        const own = '<h2 id="x&quot;onclick">본문</h2><h2>✅ 학습 후 체크리스트</h2><ul><li>(다시 보기: 본문)</li></ul>';
        assert.ok(call(view, 'linkChecklistReviews')(own).includes('href="#lesson-sec-1"'), '쓸 수 없는 id는 이 파일의 id로 바꾼다');
    });

    await run('링크: 화면에서 누르면 주소의 #은 그대로 두고 그 제목으로 스크롤한다(링크가 아니면 아무것도 하지 않는다)', () => {
        const scrolled = [];
        const heading = { scrollIntoView: opts => scrolled.push(opts) };
        const box = { querySelector: selector => (selector === '[id="lesson-sec-5"]' ? heading : null), parentElement: null };
        const linkTo = href => ({ getAttribute: () => href, parentElement: { querySelector: () => null, parentElement: box } });
        const click = target => {
            const event = { prevented: false, target: { closest: selector => (selector === 'a.lesson-check-link' ? target : null) }, preventDefault() { this.prevented = true; } };
            call(view, 'onChecklistLinkClick')(event);
            return event.prevented;
        };
        assert.strictEqual(click(linkTo('#lesson-sec-5')), true, '주소의 #을 바꾸지 않는다');
        assert.deepStrictEqual(plain(scrolled), [{ behavior: 'smooth', block: 'start' }]);
        assert.strictEqual(click(linkTo('#"]x')), true, '이상한 주소는 스크롤하지 않지만 이동도 막는다');
        assert.strictEqual(click(linkTo('#lesson-sec-9')), true, '없는 제목');
        assert.strictEqual(scrolled.length, 1);
        assert.strictEqual(click(null), false, '링크가 아니면 그대로');
        assert.ok(source('paragraph-edit.js').includes("const PARA_EDIT_SKIP = 'button, a,"), '링크를 두 번 눌러도 단락 고치기가 열리지 않는다');
    });

    await run('내보내기: 탭·차시마다 id 앞말을 붙여 한 문서에 여럿 들어가도 링크가 제 제목으로 간다', async () => {
        const lesson = { id: 12, title: '반복문', images: {}, tabContents: { basicLearn: NEW_ORDER, advLearn: OLD_ORDER } };
        const body = await call(view, 'lessonExportBody')(lesson, null, {});
        assert.strictEqual(body.tabs, 2);
        assert.ok(body.html.includes('<h2 id="ls-12-basicLearn-lesson-sec-4">') && body.html.includes('href="#ls-12-basicLearn-lesson-sec-4"'), body.html);
        // 예전 차례 탭: 학습 목표 1, 개요 2, 합계 3
        assert.ok(body.html.includes('<h2 id="ls-12-advLearn-lesson-sec-3">') && body.html.includes('href="#ls-12-advLearn-lesson-sec-3"'));
        const ids = [...body.html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
        assert.strictEqual(new Set(ids).size, ids.length, '문서 안에서 id가 겹치지 않는다');
        [...body.html.matchAll(/href="#([^"]+)"/g)].forEach(match => assert.ok(ids.includes(match[1]), `링크가 가리키는 id가 있다: ${match[1]}`));
        const doc = call(view, 'lessonHtmlDocument')('반복문', body.html);
        assert.ok(doc.includes('a { color'), '문서 서식에 링크 모양이 있다');
    });

    await run('되살리기: 원본 없는 HTML을 마크다운으로 되돌릴 때 다시 보기 링크는 글자로 바꾼다(저장한 글에 링크가 남지 않는다)', () => {
        const doc = domino.createDocument('<!doctype html><body><section><ul><li>항목 (다시 보기: <a href="#ls-1-basicLearn-lesson-sec-5" class="lesson-check-link">1. 합계 구하기</a>)</li></ul></section></body>', true);
        const section = doc.querySelector('section');
        call(view, 'oldHtmlTidy')(section);
        assert.ok(!section.querySelector('a'), '링크가 남지 않는다');
        assert.strictEqual(section.textContent, '항목 (다시 보기: 1. 합계 구하기)');
    });

    finish();
})();
