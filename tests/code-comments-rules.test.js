// 코드 블록 주석 규칙 테스트 (실행: node tests/code-comments-rules.test.js)
// 컨벤션 검수(lesson-lint.js)가 모든 탭에서 주석이 모자란 코드 블록을 필수로 알리는지, 검사 규칙 목록·안내, 일괄 작업 예고(cost-estimate.js),
// AI 지시(data.js·ui.js·gyosuan.js·lesson-objectives.js)와 컨벤션 문서(convention.js)·README에 주석 규칙이 들어갔는지 실제 파일로 확인한다.
// AI는 부르지 않는다. 주석 세기와 주석만 더하는 확인은 tests/code-comments.test.js가 본다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', 'js') + path.sep;
const source = file => fs.readFileSync(root + file, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const call = (ctx, name) => vm.runInContext(name, ctx);

function fakeElement() {
    return {
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', disabled: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener() {}, querySelector: () => fakeElement(), querySelectorAll: () => [], remove() {}
    };
}

// 화면 없이 파일을 차례로 싣는다(index.html과 같은 순서로 넘긴다)
function context(files) {
    const ctx = {
        console: { log() {}, warn() {}, error() {} }, JSON, Map, Set, Promise, Date,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        addEventListener() {},
        location: { hash: '' },
        document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeElement(), body: { appendChild() {} } },
        globalState: { subjects: [] }, currentSubjectId: null, courseData: [], instructorTone: 'formal',
        getReferenceContext: () => ''
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    files.forEach(file => vm.runInContext(source(file), ctx));
    return ctx;
}

let failed = 0;
let count = 0;
async function run(name, fn) {
    count++;
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (e) {
        failed++;
        console.log(`FAIL - ${name}\n  ${e.stack || e.message}`);
    }
}

const fence = (label, lines) => [`\`\`\`${label}`, ...lines, '```'].join('\n');
const BARE_PY = fence('python', ['scores = [80, 92, 75]', 'average = sum(scores) / len(scores)', 'print(round(average, 1))']);
const COMMENTED_PY = fence('python', ['# 점수 목록의 평균을 구해 출력합니다', 'scores = [80, 92, 75]  # 학생 세 명의 점수', 'average = sum(scores) / len(scores)', 'print(round(average, 1))']);
const lessonWith = (...blocks) => ['# 📝 평균 구하기', '', '## 1. 평균 구하기 (⏱ 30분)', '', '점수 목록의 평균을 구하는 코드입니다.', '', ...blocks.flatMap(block => [block, '']), '- 합계를 개수로 나눕니다.'].join('\n');
const BARE_MD = lessonWith(BARE_PY);
const COMMENT_ISSUE = { sev: 'bad', where: '1. 평균 구하기 (⏱ 30분)', msg: '코드 블록에 주석을 넣습니다.', snip: 'scores = [80, 92, 75] · 코드 3줄에 주석 0개(1개 필요)', codeComment: true };
const ALL_TABS = ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment', 'advAssessment', undefined];

(async () => {
    /* ---------- 검수 ---------- */
    const lctx = context(['data.js', 'code-comments.js', 'lesson-lint.js']);
    const lint = (md, tabId, opts) => plain(call(lctx, 'lintLessonMarkdown')(md, tabId, opts));
    const commentIssues = (md, tabId, opts) => lint(md, tabId, opts).filter(issue => issue.codeComment);

    await run('검수: 주석 없는 코드 블록은 모든 탭에서, 코드를 다루는 차시가 아니어도 필수로 알린다', () => {
        ALL_TABS.forEach(tabId => [undefined, {}, { codeTopic: false }, { codeTopic: true }, { objectiveCount: 2 }].forEach(opts => {
            assert.deepStrictEqual(commentIssues(BARE_MD, tabId, opts), [COMMENT_ISSUE], `${tabId} ${JSON.stringify(opts)}`);
        }));
        const counts = plain(call(lctx, 'lintCounts')(lint(BARE_MD, 'basicPrac')));
        assert.ok(counts.required >= 1, '필수 지적 수에 들어간다');
        assert.strictEqual(call(lctx, 'LESSON_CODE_COMMENT_MSG'), call(lctx, 'CODE_COMMENT_LINT_MSG'), '모듈과 같은 글이다');
    });

    await run('검수: 섹션 제목과 첫 코드 줄·주석 수를 보이고, CRLF 글도 같게 본다', () => {
        const md = ['```sql', 'SELECT name FROM users;', '```', '', '## 2. 이름 고르기', '', fence('csharp', ['int total = 0;', 'total += 3;']), ''].join('\n');
        assert.deepStrictEqual(commentIssues(md, 'basicLearn').map(issue => [issue.where, issue.snip]), [
            ['본문', 'SELECT name FROM users; · 코드 1줄에 주석 0개(1개 필요)'], ['2. 이름 고르기', 'int total = 0; · 코드 2줄에 주석 0개(1개 필요)']
        ], '## 제목이 없으면 본문');
        assert.deepStrictEqual(commentIssues(BARE_MD.replace(/\n/g, '\r\n'), 'basicLearn'), [COMMENT_ISSUE]);
        const twenty = Array.from({ length: 20 }, (_, i) => `x${i} = ${i}`);
        const one = commentIssues(lessonWith(fence('python', ['# 값 스무 개를 정합니다', ...twenty])), 'basicLearn');
        assert.deepStrictEqual(one.map(issue => issue.snip), ['# 값 스무 개를 정합니다 · 코드 20줄에 주석 1개(2개 필요)'], '코드 열 줄마다 주석 하나');
        assert.deepStrictEqual(commentIssues(lessonWith(fence('python', ['# 앞 열 개', ...twenty.slice(0, 10), '# 뒤 열 개', ...twenty.slice(10)])), 'basicLearn'), []);
    });

    await run('검수: 실행 결과·json·mermaid·콘솔 블록과 이름표 없는 블록, 주석이 넉넉한 블록은 알리지 않는다', () => {
        const skipped = lessonWith(fence('text', ['82.3']), fence('json', ['{"a": 1}']), fence('mermaid', ['flowchart LR', 'A-->B']), fence('console', ['$ python app.py', '82.3']), fence('output', ['82.3']), fence('', ['x = 1']));
        ALL_TABS.forEach(tabId => {
            assert.deepStrictEqual(commentIssues(skipped, tabId), [], `${tabId}`);
            assert.deepStrictEqual(commentIssues(lessonWith(COMMENTED_PY, fence('text', ['82.3'])), tabId), [], `${tabId} 주석이 있다`);
        });
    });

    await run('검수: 이름표를 몰라 세지 못한 블록은 정보(info)로만 알린다', () => {
        const issues = commentIssues(lessonWith(fence('zzlang', ['x = 1'])), 'basicLearn');
        assert.deepStrictEqual(issues, [{ sev: 'info', where: '1. 평균 구하기 (⏱ 30분)', msg: call(lctx, 'CODE_COMMENT_UNKNOWN_MSG'), snip: 'zzlang', codeComment: true }]);
        assert.strictEqual(plain(call(lctx, 'lintCounts')(issues)).required, 0, '필수로 세지 않는다');
    });

    await run('검수: codeComments: false면 보지 않고, 차시 목록 배지(필수 수)는 주석을 세지도 보지도 않는다', () => {
        ALL_TABS.forEach(tabId => assert.deepStrictEqual(commentIssues(BARE_MD, tabId, { codeComments: false, codeTopic: true }), [], `${tabId}`));
        const original = call(lctx, 'codeCommentIssues');
        let calls = 0;
        lctx.codeCommentIssues = (...args) => { calls += 1; return original(...args); };
        try {
            const mod = { tabContents: { basicLearn: BARE_MD, basicPrac: BARE_MD, assessment: BARE_MD } };
            assert.deepStrictEqual(plain(call(lctx, 'lessonRequiredIssues')(mod)).filter(issue => issue.codeComment || /주석/.test(issue.msg)), []);
            assert.deepStrictEqual(plain(call(lctx, 'lessonRequiredIssues')({ content: BARE_MD })).filter(issue => issue.codeComment), [], '탭 없는 예전 차시도');
            assert.strictEqual(calls, 0, '큰 탭에서 시간이 걸리는 주석 점검을 사이드바마다 돌리지 않는다');
            lint(BARE_MD, 'basicLearn');
            assert.strictEqual(calls, 1, '검수 창은 본다');
        } finally {
            lctx.codeCommentIssues = original;
        }
    });

    await run('검수: 주석 점검이 던져도 나머지 지적은 그대로 내고 콘솔에 경고를 남긴다', () => {
        const original = call(lctx, 'codeCommentIssues');
        const warnings = [];
        lctx.codeCommentIssues = () => { throw new Error('읽지 못한 문법'); };
        lctx.console.warn = (...args) => warnings.push(args.map(String).join(' '));
        try {
            const issues = lint(`${BARE_MD}\n\n앞에서 배운 내용을 씁니다.`, 'basicLearn');
            assert.ok(issues.some(issue => issue.msg === '다른 차시를 지칭하지 않습니다.') && !issues.some(issue => issue.codeComment), JSON.stringify(issues));
            assert.ok(warnings.length === 1 && warnings[0].includes('읽지 못한 문법'), warnings.join('\n'));
        } finally {
            lctx.codeCommentIssues = original;
            lctx.console.warn = () => {};
        }
    });

    await run('검수: code-comments.js 없이 실어도 돈다(주석은 보지 않는다)', () => {
        [['data.js', 'lesson-lint.js'], ['lesson-lint.js']].forEach(files => {
            const bare = context(files);
            const issues = plain(call(bare, 'lintLessonMarkdown')(BARE_MD, 'basicLearn', { codeTopic: true }));
            assert.deepStrictEqual(issues.filter(issue => issue.codeComment), [], files.join(','));
            assert.strictEqual(call(bare, 'LESSON_CODE_COMMENT_MSG'), '코드 블록에 주석을 넣습니다.');
        });
    });

    await run('검사 규칙 목록: 주석 필수 줄을 코드 예제 권장 두 줄 바로 앞에 두고 안내에 한 문장을 더한다', () => {
        const rows = plain(call(lctx, 'LESSON_RULE_LIST'));
        assert.strictEqual(rows.length, 20);
        assert.deepStrictEqual(rows[17], {
            sev: 'bad', area: '코드 예제', rule: '코드 블록에 주석을 넣습니다.',
            desc: '코드 첫 줄 위에 무엇을 하는 코드인지, 핵심 줄 위나 끝에 그 줄이 하는 일을 적습니다. 코드 열 줄마다 주석을 하나 이상 둡니다. 실행 결과·json·mermaid 블록은 보지 않고, 문제은행 문항의 주석은 정답을 알려 주지 않습니다.'
        });
        assert.deepStrictEqual(rows.slice(-2).map(row => [row.sev, row.area, row.rule]), [
            ['warn', '코드 예제', '코드를 설명하면 예제 코드 블록을 함께 둡니다.'], ['warn', '코드 예제', '코드 블록에 언어를 적고 닫습니다.']
        ], '끝 두 줄은 그대로');
        assert.deepStrictEqual([rows[16].rule, rows.slice(0, 17).filter(row => row.sev === 'bad').length], ['수업 진행은 교수안의 몫입니다.', 7], '원본 규칙표 17줄의 차례와 심각도는 그대로');
        const note = call(lctx, 'LESSON_RULE_NOTE');
        assert.ok(note.includes('코드 예제 규칙은 코드를 다루는 차시에만 검사합니다.'), note);
        assert.ok(note.endsWith("코드 블록 주석은 모든 탭에서 검사하고(실행 결과·json·mermaid 블록은 빼고), AI 수정 제안과 도구의 '코드 주석 넣기'가 코드는 그대로 두고 주석만 더합니다."), note);
    });

    /* ---------- 일괄 작업 예고 ---------- */
    await run('예고: 코드 주석 넣기 호출(work.codeComments)을 본문 호출과 기다리는 호출에 센다', () => {
        const ectx = { console, window: {}, JSON, Math, Object, localStorage: { getItem: () => null, setItem() {} } };
        vm.createContext(ectx);
        vm.runInContext(source('cost-estimate.js'), ectx);
        const split = work => plain(vm.runInContext('estimateCallSplit', ectx)(work));
        assert.deepStrictEqual(split({ codeComments: 3 }), { body: 3, bodyWait: 3, short: 0, images: 0 });
        assert.strictEqual(vm.runInContext('estimateCalls', ectx)({ codeComments: 3 }), 3);
        const FULL = { tabs: 5, images: 15, slideImages: 4, ncs: 1, gyosuan: 1, qbank: 1, art: 0 };
        assert.deepStrictEqual(split(FULL), { body: 25, bodyWait: 19, short: 23, images: 19 }, '주석 호출이 없으면 예전과 같다');
        assert.deepStrictEqual(split({ ...FULL, codeComments: 2 }), { body: 27, bodyWait: 21, short: 23, images: 19 });
        assert.deepStrictEqual(plain(vm.runInContext('sumWork', ectx)([{ codeComments: 1 }, { codeComments: 2, tabs: 1 }])), { codeComments: 3, tabs: 1 });
        const rules = plain(vm.runInContext('ESTIMATE_RULES', ectx));
        assert.deepStrictEqual([rules.tabCalls, rules.qbankCalls], [2, 2], '숫자는 그대로');
        const text = source('cost-estimate.js');
        assert.ok(text.includes('codeComments(코드 주석 넣기 호출 수') && text.includes('코드 주석 보강') && text.includes('주석 보강이 가끔 더해짐'), '주석에 적는다');
    });

    /* ---------- AI 지시 ---------- */
    const pctx = context(['data.js', 'lesson-lint.js', 'ui.js']);
    const build = (task, args) => call(pctx, 'buildTaskContext')(task, typeof args === 'string' ? args : { title: 'Python 반복문', description: '반복문', keyConcepts: [], ...args });
    const rules = call(pctx, 'CONTEXT_CORE').rules;
    const COMMENT_RULE = '- 모든 코드 블록에는 한국어 주석을 반드시 넣습니다. 코드 첫 줄 위에 무엇을 하는 코드인지 한 줄로 적고, 핵심 줄 위나 줄 끝에 그 줄이 하는 일을 짧게 적습니다. 코드 열 줄마다 주석이 하나 이상 있어야 합니다.\n';
    const MARK_RULE = '- 주석 기호는 그 언어의 것을 씁니다. python·bash·yaml은 #, javascript·typescript·java·csharp·cpp는 //, sql·lua는 --, css는 /* */, html·xml 코드 블록 안에서는 <!-- -->입니다. 실행 결과(```text)·json·mermaid 블록에는 주석을 넣지 않습니다.\n';
    const QUIZ_RULE = '- 문항 속 코드(문제 글·보기·시작 코드)에도 한국어 주석을 넣습니다. 주석은 코드가 무엇을 하는지만 적고 정답, 출력 결과, 고칠 곳을 알려 주지 않습니다. 시작 코드에는 학습자가 채울 자리마다 무엇을 채울지 주석으로 적습니다.';

    await run('지시: 본문 코드 예제 규칙이 모든 코드 블록에 한국어 주석을 넣게 하고 언어별 주석 기호를 알린다', () => {
        assert.ok(rules.code_examples.includes('- 예제는 생략 표시("...", "// 생략") 없이 완결된 코드로 씁니다.\n' + COMMENT_RULE + MARK_RULE), rules.code_examples);
        assert.ok(!rules.code_examples.includes('코드 안 주석은 짧은 한 줄로'), '예전 문구가 없다');
        ['basicLearn', 'basicPrac', 'advLearn', 'advPrac'].forEach(tabId => assert.ok(call(pctx, 'buildTabRules')(tabId, []).includes(COMMENT_RULE), tabId));
        assert.ok(build('module', {}).systemInstruction.includes(COMMENT_RULE), '교안 전체 생성');
        assert.ok(build('main_quest', '차시 정보').systemInstruction.includes(COMMENT_RULE), '최종 평가도 전체 규칙을 받는다');
    });

    await run('지시: 코드 예제의 30줄은 주석 줄을 빼고 세고, 그림 태그만 쓰라는 규칙은 코드 블록 밖 본문에만 둔다', () => {
        assert.ok(rules.code_examples.includes('- 예제 하나는 무엇을 하는 코드인지 한두 문장 → 코드 블록(주석 줄을 빼고 30줄 이하) → 핵심 줄 설명(불릿)'), rules.code_examples);
        assert.ok(!rules.code_examples.includes('코드 블록(30줄 이하)'), '주석을 넣으면 넘는 옛 문구가 없다');
        const scoped = '코드 블록 밖 본문에서는 오직 <!-- [IMG: "영어 키워드"] --> 형태의 주석 태그만 허용됩니다(html·xml 코드 블록 안의 코드 주석은 예외입니다). 각 태그 전후에 빈 줄을 반드시 삽입하세요.';
        assert.ok(rules.image_tags.endsWith(scoped), rules.image_tags.slice(-200));
        ['basicLearn', 'basicPrac'].forEach(tabId => assert.ok(call(pctx, 'buildTabRules')(tabId, []).includes(scoped), tabId));
    });

    await run('지시: 서식 예시의 코드 예제도 주석을 달고 핵심 줄 번호를 맞춘다', () => {
        const fewshot = call(pctx, 'CONTEXT_CORE').fewshot_cases;
        assert.ok(fewshot.includes('```python\n# 점수 목록의 평균을 구해 출력합니다\nscores = [80, 92, 75]  # 학생 세 명의 점수\naverage = sum(scores) / len(scores)  # 합계를 점수 개수로 나눕니다\nprint(round(average, 1))  # 소수 첫째 자리까지 반올림해 출력합니다\n```'), fewshot);
        assert.ok(fewshot.includes('- 3행: sum()으로 합계를 구하고 len()으로 나눠 평균을 냅니다.\n- 4행: round()로 소수 첫째 자리까지 반올림해 출력합니다.\n```text\n82.3\n```'));
        assert.deepStrictEqual(plain(call(lctx, 'codeCommentIssues')(fewshot, { sev: 'bad' })), [], '서식 예시가 주석 점검을 지난다');
    });

    await run('지시: 문항 규칙은 문항 속 코드에도 주석을 넣되 정답·출력 결과·고칠 곳을 알려 주지 않게 한다', () => {
        assert.ok(rules.assessment_design.endsWith('- 버전에 의존하는 정보(툴 버전 번호, 단축키, 메뉴 위치)를 묻지 않습니다.\n' + QUIZ_RULE), rules.assessment_design);
        ['assessment', 'advAssessment'].forEach(tabId => {
            const tabRules = call(pctx, 'buildTabRules')(tabId, []);
            assert.ok(tabRules.includes(QUIZ_RULE) && !tabRules.includes(COMMENT_RULE), tabId);
        });
    });

    await run('지시: 코드 차시 지시는 실습 단계 코드와 학습 예제에 한국어 주석을 요구한다', () => {
        const practice = '- 실습 단계마다 입력할 코드를 언어를 적은 코드 블록으로 보이고, 그 코드가 하는 일과 실행 결과(```text)를 함께 씁니다. 코드 블록 안에는 무엇을 하는 코드인지와 핵심 줄이 하는 일을 한국어 주석으로 적습니다.';
        ['basicPrac', 'advPrac'].forEach(tabId => assert.ok(call(pctx, 'codeTopicPrompt')(tabId).includes(practice), tabId));
        const learn = '- 예제마다 무엇을 하는 코드인지 → 한국어 주석을 단 코드 블록(```언어) → 핵심 줄 설명 → 실행 결과(```text) 순서로 씁니다.\n';
        ['basicLearn', 'advLearn'].forEach(tabId => assert.ok(call(pctx, 'codeTopicPrompt')(tabId).includes(learn), tabId));
        assert.ok(build('tab_content', { tabId: 'basicPrac', tabLabel: '기본실습', codeTopic: true }).userPrompt.includes(practice));
        assert.ok(build('module', { codeTopic: true }).userPrompt.includes(learn));
    });

    await run('지시: 분량 보강의 코드 예제 지시도 한국어 주석을 단 코드 블록을 요구한다', () => {
        const args = { tabId: 'basicLearn', tabLabel: '기본학습', targetMinutes: 480, outline: ['학습 목표', '1. 반복문 (⏱ 60분)'], objectives: [], sectionTitle: '1. 반복문 (⏱ 60분)', sectionText: '## 1. 반복문 (⏱ 60분)\n\n반복문은 같은 일을 되풀이합니다.', requestChars: 12000, subtopics: 5 };
        const needCode = build('volume_expand', { ...args, needCode: true }).userPrompt;
        assert.ok(needCode.includes('[코드 예제 — 이 섹션에는 아직 코드 예제가 없습니다]\n- 첫 새 소주제는 언어를 적고 한국어 주석을 단 코드 블록 예제로 시작합니다. 코드 앞에 무엇을 하는 코드인지, 코드 뒤에 핵심 줄 설명과 실행 결과(```text)를 씁니다.'), needCode);
        const codeSection = build('volume_expand', { ...args, codeSection: true }).userPrompt;
        assert.ok(codeSection.includes('[코드 예제 — 이 섹션은 코드를 다룹니다]\n- 새 소주제마다 언어를 적고 한국어 주석을 단 코드 블록 예제를 하나 이상 넣고, 코드 앞에 무엇을 하는 코드인지, 코드 뒤에 핵심 줄 설명과 실행 결과(```text)를 씁니다.\n- 코드 자체는 분량에 들어가지 않으므로 코드를 설명하는 문장을 충분히 씁니다.'), codeSection);
        const plainAsk = build('volume_expand', args);
        assert.ok(plainAsk.systemInstruction.includes(COMMENT_RULE) && !plainAsk.userPrompt.includes('한국어 주석'), '코드 섹션이 아니면 본문 규칙만');
    });

    await run('지시: 고른 글 고치기는 코드 블록마다 주석을 넣고, 문항(문제은행 탭·최종 평가)에서 고를 때만 답을 알려 주지 않게 하며, 최종 평가는 문항 주석 규칙을 받는다', () => {
        const editRule = `- ${rules.concise_edit}\n- 고친 글에 코드 블록이 있으면 코드 블록마다 한국어 주석을 넣고, 이미 있던 주석은 지우지 않습니다.`;
        const edit = quiz => build('edit', { context: '문맥', selectedText: '원본 글', command: '예제를 더해 주세요', ...(quiz === undefined ? {} : { quiz }) }).systemInstruction;
        assert.ok(edit().endsWith(editRule) && edit(false).endsWith(editRule), edit());
        assert.ok(edit(true).endsWith(`${editRule} 이 글은 문항(학습이해도·심화이해도·최종 평가)입니다. 주석에 정답, 출력 결과, 고칠 곳을 적지 않습니다.`), edit(true));
        assert.ok(!edit().includes('문항의 코드라면'), '탭을 모르는 조건 문장은 없다');
        const quest = build('main_quest', '차시 정보').systemInstruction;
        assert.ok(quest.endsWith(`\n${QUIZ_RULE}`), quest.slice(-300));
        assert.strictEqual(`- ${call(pctx, 'QUIZ_CODE_COMMENT_RULE')}`, QUIZ_RULE, '문항 규칙과 같은 글');
        assert.ok(/case 'main_quest':[\s\S]{0,300}buildFullRules\(\)/.test(source('ui.js')), 'final-round.test.js의 거리 확인이 그대로 맞는다');
    });

    await run('지시: 교수안·슬라이드 지시는 두 형식 모두 코드 블록마다 줄 끝 한국어 주석을 넣게 한다(교수안 화면은 줄 맨 앞 # 줄을 제목으로 읽는다)', () => {
        const gctx = context(['data.js', 'gyosuan.js']);
        const line = '- 교수안이나 슬라이드 문구에 코드 블록을 쓰면 코드 블록마다 한국어 주석을 줄 끝 주석으로 넣습니다. 첫 줄 끝에 무엇을 하는 코드인지, 핵심 줄 끝에 그 줄이 하는 일을 적어 코드 열 줄마다 주석을 하나 이상 둡니다(줄 맨 앞에서 시작하는 # 주석 줄은 교수안 화면에서 제목으로 읽힙니다).';
        ['presentation', 'detailed'].forEach(style => {
            const system = call(gctx, 'gyosuanSystemInstruction')(style);
            assert.ok(system.includes(`- 원고에 없는 사실은 지어내지 않습니다.\n${line}\n- 지정된 출력 형식만 출력하고 머리말·맺음말을 붙이지 않습니다.`), style);
        });
    });

    await run('지시: 학습 목표 세트 추가는 섹션 코드 블록에 한국어 주석을 넣게 한다', () => {
        const octx = context(['data.js', 'lesson-lint.js', 'lesson-objectives.js']);
        const prompt = call(octx, 'buildObjectiveSetPrompt')({ title: '반복문' }, '## 학습 목표\n\n- 합계를 구하는 코드를 작성할 수 있습니다.\n', '');
        assert.ok(prompt.includes('- section: "## 제목"으로 시작하는 학습 내용 마크다운입니다. 설명은 "~합니다"로 끝내고 학습자를 호칭하지 않습니다.\n- section에 코드 블록을 쓰면 언어를 적고, 코드 첫 줄 위에 무엇을 하는 코드인지, 핵심 줄 위나 줄 끝에 그 줄이 하는 일을 한국어 주석으로 적어 코드 열 줄마다 주석을 하나 이상 둡니다.\n- checklist:'), prompt);
    });

    await run('컨벤션 문서와 README: 코드 주석 규칙을 코드 예제 바로 뒤에 적는다', () => {
        const cctx = context(['convention.js']);
        const convention = call(cctx, 'getConventionMarkdown')();
        assert.ok(convention.includes('실행 결과(```text).\n- 모든 코드 블록에는 한국어 주석을 넣습니다. 코드 첫 줄 위에 무엇을 하는 코드인지, 핵심 줄 위나 줄 끝에 그 줄이 하는 일을 적고, 코드 열 줄마다 주석을 하나 이상 둡니다. 실행 결과(```text)·json·mermaid 블록에는 넣지 않고, 문제은행 문항의 주석은 정답·출력 결과·고칠 곳을 알려 주지 않습니다.\n- 코드 블록에는 언어 이름표와 복사 버튼이 붙습니다.'), convention.slice(convention.indexOf('### 14.'), convention.indexOf('### 코드 문제')));
        assert.ok(!convention.includes('Ctrl+Z'));
        const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8').split(/\r?\n/);
        const at = readme.findIndex(text => text.startsWith('- **코드 예제**:'));
        assert.ok(at > 0 && readme[at + 1].startsWith('- **코드 주석**: 교안의 코드 블록에는 주석을 반드시 넣음.'), readme[at + 1]);
        assert.ok(readme[at + 1].includes("도구의 '코드 주석 넣기'(이 차시의 모든 탭)") && readme[at + 1].endsWith('테스트: tests/code-comments.test.js, tests/code-comments-rules.test.js, tests/code-comments-flow.test.js, tests/code-comments-safety.test.js'), readme[at + 1]);
        assert.ok(readme[at + 1].includes('교수안·슬라이드 편성안은 교수안 화면이 코드 블록을 그리지 못해 고치지 않고'), readme[at + 1]);
    });

    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
