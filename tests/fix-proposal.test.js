// AI 수정 제안의 섹션 고치기 테스트 (실행: node tests/fix-proposal.test.js)
// 코드 블록을 자리 표시 줄로 바꿔 보내고 되돌리는지(코드는 한 글자도 바뀌지 않는다), 자리 표시가 어긋난 답을 한 번 더 받고 안전할 때만 되살리는지,
// 큰 섹션을 ### 소주제·문단 묶음으로 나눠 지적이 있는 조각만 차례로 고치는지(중지·호출 상한·오류), 안내 글이 고친 것과 못 고친 까닭을 적는지를 실제 파일로 확인한다.
// 실행 환경(가짜 AI·화면 흉내)은 tests/code-comments-harness.js에 있다. AI는 가짜다: 지시의 [고칠 섹션]·[고칠 부분] 뒤 글을 읽어 고친 답을 만든다. 키는 쓰지 않는다.
const {
    vm, assert, read, plain, reply, PY, route, commentReply, callsOf, appContext, call, lessonOf, openSubject, blocksOf, LEARN_GOALS, runner
} = require('./code-comments-harness');

const { run, finish } = runner();
const HOLDER = /\[\[CODE-BLOCK-[0-9a-z]+-\d+\]\]/g;
const holders = text => String(text).match(HOLDER) || [];
const isHolderLine = line => /^\[\[CODE-BLOCK-[0-9a-z]+-\d+\]\]$/.test(line.trim());
const fixBody = user => String(user).split(/\[고칠 (?:섹션|부분)\]\n/).pop();
const tidy = text => text.replace(/앞에서 다룬 /g, '').replace(/앞서 본 /g, '').replace(/매우 /g, '2배 ');
const fixer = (transform = tidy) => ({ user }) => reply(transform(fixBody(user)));
const dropHolders = text => text.split('\n').filter(line => !isHolderLine(line)).join('\n');
const lintOf = (ctx, md, tabId = 'basicPrac', extra = {}) => call(ctx, 'lintLessonMarkdown')(md, tabId, { codeComments: false, ...extra });
const fixOn = (ctx, md, { tabId = 'basicPrac', extra = {}, ...rest } = {}) => call(ctx, 'requestSectionFix')({ tabId, md, issues: lintOf(ctx, md, tabId, extra), ...rest });
// 문서에 적힌 그대로의 코드 블록 글(여는 펜스부터 닫는 펜스까지)
const codeTexts = (ctx, md) => Array.from(blocksOf(ctx, md)).map(block => md.split('\n').slice(block.openLine, block.closeLine + 1).join('\n'));
const statuses = report => plain(report.outcomes).map(outcome => outcome.status);

// 정리 규칙이 건드릴 만한 코드: 줄 끝 공백, 탭 들여쓰기, 빈 줄 셋, 코드 속 **, ~~~ 블록의 • 기호
const CODE = ['```python', '# 합계를 구합니다', 'total = 0  ', 'for n in [1, 2, 3]:', '\ttotal += n', '', '', '', 'print(total)  # **합계', '```'].join('\n');
const TILDE = ['~~~text', '• 6', '~~~'].join('\n');
const SUM_SECTION = ['## 1. 합계 구하기 (⏱ 30분)', '', '앞에서 다룬 반복문으로 합계를 구합니다.', '', CODE, '', '결과는 다음과 같습니다.', '', TILDE].join('\n');
// 코드 바로 앞 줄이 지적과 관계없는 글(자리를 되찾을 수 있다) / 지적이 있는 글(되찾을 수 없다)
const RUN_SECTION = ['## 1. 합계 구하기 (⏱ 30분)', '', '앞에서 다룬 반복문으로 합계를 구합니다.', '', '다음 코드를 실행합니다.', '', CODE, '', '결과를 확인합니다.'].join('\n');
const TIGHT_SECTION = ['## 1. 합계 구하기 (⏱ 30분)', '', '앞에서 다룬 반복문으로 합계를 구합니다.', '', CODE, '', '결과를 확인합니다.'].join('\n');
const LIST_SECTION = ['## 2. 차례로 실행하기 (⏱ 20분)', '', '앞서 본 명령을 차례로 실행합니다.', '', '1. 가상 환경을 만듭니다.', '',
    '   ```bash', '   # 가상 환경을 만듭니다', '   python -m venv .venv', '   ```', '', '2. 패키지를 설치합니다.', '', '   ~~~bash', '   pip install requests', '   ~~~'].join('\n');

// 큰 섹션: 소주제 하나가 7,000자쯤이라 여섯이면 한 번에 고칠 분량(30,000자)을 넘는다. 문장은 한 줄에 하나(받은 글 정리 규칙이 줄을 나누지 않게)
const lines = (n, seed) => Array.from({ length: n }, (_, i) => `${seed} 설명 문장 ${i + 1}번은 값을 하나씩 더해 합계를 구하는 과정을 차례로 살펴봅니다.`).join('\n');
const sub = (k, { extra = '', size = 110 } = {}) => [`### ■ 소주제 ${k}`, lines(size, `소주제 ${k}의`), ...(extra ? [extra] : [])].join('\n\n');
const SUB_CODE = PY('# 합계를 구합니다', 'total = sum([1, 2, 3])', 'print(total)   ');
const bigSection = (extras, title = '2. 큰 섹션 (⏱ 160분)') => [`## ${title}`, '큰 섹션의 첫머리입니다.', ...[1, 2, 3, 4, 5, 6].map(k => sub(k, { extra: extras[k] || '' }))].join('\n\n');
const SMALL = '## 1. 작은 섹션 (⏱ 10분)\n\n앞에서 다룬 작은 섹션입니다.';
const TAIL = '## 3. 마무리 (⏱ 10분)\n\n그대로 둘 마무리입니다.';
const BIG_EXTRAS = { 2: `앞에서 다룬 반복문을 다시 씁니다.\n\n${SUB_CODE}`, 3: SUB_CODE, 5: '매우 빠르게 끝납니다.' };
const BIG_DOC = [SMALL, bigSection(BIG_EXTRAS), TAIL].join('\n\n');

function openTab(md, { tabId = 'basicPrac', ...extra } = {}) {
    const ctx = appContext();
    const mod = lessonOf({ tabs: { basicLearn: `${LEARN_GOALS}\n\n## 1. 합계 (⏱ 30분)\n\n합계를 구합니다.`, [tabId]: md }, ...extra });
    openSubject(ctx, [mod]);
    vm.runInContext(`currentLessonTab = ${JSON.stringify(tabId)};`, ctx);
    return { ctx, mod };
}

// legacy: lesson-fix-run.js가 없던 때의 길(첫 묶음만 코드를 보여 주며 한 번에 고친다)로 돌린다
async function propose(md, handlers, { legacy = false, ...opts } = {}) {
    const { ctx, mod } = openTab(md, opts);
    if (legacy) ctx.runSectionFix = undefined;
    ctx.ai = route(ctx, { comment: commentReply(), ...handlers });
    call(ctx, 'runConventionCheck')(1);
    await call(ctx, 'proposeLessonFix')();
    return { ctx, mod, saved: mod.tabContents[opts.tabId || 'basicPrac'] };
}

(async () => {
    /* ---------- 화면 연결 ---------- */
    await run('연결: index.html은 lesson-fix-run.js를 lesson-review.js 바로 뒤에 이웃과 같은 ?v=로 싣는다', () => {
        const html = read('index.html');
        const scripts = [...html.matchAll(/<script src="\.\/js\/([\w./-]+)\.js\?v=(\d+)"><\/script>/g)].map(match => [match[1], match[2]]);
        const order = scripts.map(([name]) => name);
        assert.ok(order.indexOf('lesson-review') >= 0 && order.indexOf('lesson-fix-run') === order.indexOf('lesson-review') + 1, order.join(','));
        assert.strictEqual(new Set(scripts.map(([, v]) => v)).size, 1, '새 태그도 이웃과 같은 ?v=');
        assert.ok(!html.endsWith('\n'), 'index.html 끝 줄바꿈은 그대로 없다');
    });

    /* ---------- 고치려던 상황 ---------- */
    await run('바뀐 것이 없던 상황: 큰 섹션 둘 가운데 하나는 분량 때문에 빠지고 하나는 코드가 바뀐 답이라 버려지던 글을, 이제는 한 번에 나눠 고친다', async () => {
        const A = bigSection({ 2: `앞에서 다룬 반복문을 다시 씁니다.\n\n${SUB_CODE}`, 4: SUB_CODE }, '1. 생성형 AI의 동작 원리 (⏱ 160분)');
        const B = bigSection({ 3: `매우 빠르게 끝납니다.\n\n${SUB_CODE}` }, '2. 도구 생태계 (⏱ 160분)');
        const md = [A, B].join('\n\n');
        const meddle = text => tidy(text).replace(/total = sum/g, 'total = max'); // 코드를 보면 바꿔 버리는 모델
        const before = await propose(md, { fix: fixer(meddle) }, { legacy: true });
        assert.strictEqual(before.ctx.previews[0].opts.note,
            '분량이 많아 섹션 1개는 이번 제안에서 뺐습니다. 반영한 뒤 다시 실행합니다. 코드 블록을 바꾼 답이라 섹션 1개(1. 생성형 AI의 동작 원리 (⏱ 160분))는 반영하지 않았습니다. 코드 블록 안을 고칠 지적은 원문에서 고칩니다.');
        assert.deepStrictEqual([before.saved, callsOf(before.ctx, 'fix').length], [md, 1], '예전에는 바뀐 것이 없었다');
        const after = await propose(md, { fix: fixer(meddle) });
        assert.strictEqual(callsOf(after.ctx, 'fix').length, 2, '지적이 있는 조각 둘');
        assert.ok(callsOf(after.ctx, 'fix').every(item => !item.user.includes('total = sum')), '코드를 보내지 않는다');
        assert.strictEqual(after.ctx.previews[0].opts.note, '분량이 많은 섹션 2개는 지적이 있는 부분 2곳만 나눠 고쳤습니다.');
        assert.strictEqual(after.saved, tidy(md), '두 곳의 글만 바뀐다');
        assert.deepStrictEqual(codeTexts(after.ctx, after.saved), codeTexts(after.ctx, md));
        assert.strictEqual(lintOf(after.ctx, after.saved).length, 0, '지적이 모두 풀렸다');
    });

    /* ---------- 코드 블록 지키기 ---------- */
    await run('코드 블록: 자리 표시 줄로 바꿔 보내 AI가 코드를 보지도 고치지도 못하고, 글만 고친 답에 원래 블록을 한 글자도 바꾸지 않고 되돌린다(예전 길은 그 답을 버렸다)', async () => {
        // 코드를 보면 바꿔 버리는 모델: 값을 바꾸고 ~~~ 블록의 기호도 고친다
        const meddle = text => tidy(text).replace(/total = 0/g, 'total = 100').replace(/• 6/g, '- 60');
        const ctx = appContext();
        ctx.ai = route(ctx, { fix: fixer(meddle) });
        const { text, plan, report } = await fixOn(ctx, SUM_SECTION);
        const [fix] = callsOf(ctx, 'fix');
        assert.strictEqual(callsOf(ctx, 'fix').length, 1);
        assert.ok(!fix.user.includes('total = 0') && !fix.user.includes('• 6') && !fix.user.includes('```') && !fix.user.includes('~~~'), '코드 블록을 보내지 않는다');
        assert.strictEqual(holders(fixBody(fix.user)).length, 2, fixBody(fix.user));
        assert.ok(fixBody(fix.user).split('\n').filter(isHolderLine).length === 2, '자리 표시는 한 줄에 하나');
        assert.ok(fix.user.includes('- 코드 블록은 [[CODE-BLOCK-…]] 꼴의 자리 표시 줄로 바꿔 두었습니다. 자리 표시 줄은 한 글자도 바꾸지 말고 있던 자리에 한 줄씩 그대로 두며, 지우거나 되풀이하거나 다른 글과 한 줄에 쓰지 않습니다. 자리 표시가 가리키는 코드는 다시 쓰지 않습니다.'), fix.user);
        assert.strictEqual(text, SUM_SECTION.replace('앞에서 다룬 ', ''), '글만 바뀌고 코드는 그대로');
        assert.deepStrictEqual(codeTexts(ctx, text), [CODE, TILDE]);
        assert.deepStrictEqual([plan.targets.length, statuses(report), holders(text).length], [1, ['applied'], 0]);
        // 이 파일이 없던 때의 길(코드를 그대로 보낸다): 같은 모델의 답은 코드가 바뀌어 섹션째 버려진다
        const old = appContext();
        old.runSectionFix = undefined;
        old.ai = route(old, { fix: fixer(meddle) });
        const legacy = await fixOn(old, SUM_SECTION);
        assert.ok(callsOf(old, 'fix')[0].user.includes('total = 0'));
        assert.ok(legacy.text.includes('앞에서 다룬') && legacy.dropped.length === 1, '예전 길은 반영하지 못했다');
    });

    await run('코드 블록: 목록 안에 들여쓴 블록과 ~~~ 블록도 자리 표시로 바꾸고 들여쓰기까지 그대로 되돌린다', async () => {
        const ctx = appContext();
        ctx.ai = route(ctx, { fix: fixer() });
        const { text } = await fixOn(ctx, LIST_SECTION);
        const body = fixBody(callsOf(ctx, 'fix')[0].user);
        assert.deepStrictEqual(body.split('\n').filter(isHolderLine).map(line => line.match(/^ */)[0].length), [3, 3], '자리 표시 줄은 여는 펜스의 들여쓰기를 따른다');
        assert.ok(!body.includes('pip install') && !body.includes('venv .venv'));
        assert.deepStrictEqual(codeTexts(ctx, text), codeTexts(ctx, LIST_SECTION));
        assert.ok(text.includes('명령을 차례로 실행합니다.') && !text.includes('앞서 본'), text);
        assert.strictEqual(holders(text).length, 0);
    });

    await run('코드 블록: 자리 표시를 빠뜨린 답은 까닭을 적어 한 번 더 받고, 다시 받은 답이 지켰으면 반영한다', async () => {
        const ctx = appContext();
        let n = 0;
        ctx.ai = route(ctx, { fix: ({ user }) => { n += 1; return reply(n === 1 ? dropHolders(tidy(fixBody(user))) : tidy(fixBody(user))); } });
        const { text, report } = await fixOn(ctx, RUN_SECTION);
        const [first, second] = callsOf(ctx, 'fix');
        assert.strictEqual(callsOf(ctx, 'fix').length, 2);
        assert.ok(!first.user.includes('[다시 요청]'));
        const [key] = holders(fixBody(first.user));
        assert.ok(second.user.includes(`[다시 요청]\n앞선 답은 쓰지 못했습니다. 코드 블록 자리 표시 줄 1개(${key})가 빠졌습니다. 자리 표시 줄(${key})을 한 글자도 바꾸지 말고 원래 있던 자리에 한 줄씩 그대로 둔 채, 다시 고쳐 출력합니다.`), second.user);
        assert.strictEqual(fixBody(second.user), fixBody(first.user), '같은 글을 다시 보낸다');
        assert.strictEqual(text, RUN_SECTION.replace('앞에서 다룬 ', ''));
        assert.deepStrictEqual([statuses(report), report.calls], [['applied'], 2]);
    });

    await run('코드 블록: 두 번 다 빠뜨렸으면 바로 앞 줄이 그대로 남은 블록만 원래 자리에 다시 넣고, 자리를 알 수 없으면 그 섹션은 그대로 두고 까닭을 적는다', async () => {
        const ctx = appContext();
        ctx.ai = route(ctx, { fix: fixer(text => dropHolders(tidy(text))) });
        const kept = await fixOn(ctx, RUN_SECTION);
        assert.strictEqual(callsOf(ctx, 'fix').length, 2, '한 번만 더 받는다');
        assert.strictEqual(kept.text, RUN_SECTION.replace('앞에서 다룬 ', ''), '바로 앞 줄(다음 코드를 실행합니다.) 뒤에 다시 넣는다');
        assert.deepStrictEqual(codeTexts(ctx, kept.text), [CODE]);
        // 바로 앞 줄이 고친 줄이면 자리를 알 수 없다
        const lost = appContext();
        lost.ai = route(lost, { fix: fixer(text => dropHolders(tidy(text))) });
        const gone = await fixOn(lost, TIGHT_SECTION);
        assert.deepStrictEqual([callsOf(lost, 'fix').length, gone.text, statuses(gone.report)], [2, TIGHT_SECTION, ['holder']]);
        const { ctx: shown } = await propose(TIGHT_SECTION, { fix: fixer(text => dropHolders(tidy(text))) });
        assert.strictEqual(shown.previews[0].opts.note, '코드 블록 자리를 지키지 않은 답이라 섹션 1개(1. 합계 구하기 (⏱ 30분))는 반영하지 않았습니다. 다시 실행하거나 원문에서 직접 고쳐 주세요.');
        assert.strictEqual(shown.previews[0].opts.emptyNote, '위 안내에 적은 까닭으로 반영할 수정안이 없습니다.');
        assert.strictEqual(shown.previews[0].after, TIGHT_SECTION);
        // 빠뜨린 자리에 코드를 새로 써 넣은 답은 원래 블록을 다시 넣지 않는다(코드가 두 벌이 된다)
        const wrote = appContext();
        wrote.ai = route(wrote, { fix: fixer(text => tidy(text).split('\n').map(line => (isHolderLine(line) ? PY('total = 6', 'print(total)') : line)).join('\n')) });
        const rewritten = await fixOn(wrote, RUN_SECTION);
        assert.deepStrictEqual([rewritten.text, statuses(rewritten.report), rewritten.dropped.length], [RUN_SECTION, ['code'], 1]);
    });

    await run('코드 블록: 자리 표시를 두 번 쓰거나 다른 글과 한 줄에 섞거나 글자를 바꾼 답은 한 번 더 받고, 그래도 같으면 반영하지 않는다. 자리 표시는 저장되는 글에 남지 않는다', async () => {
        const twice = text => tidy(text).split('\n').flatMap(line => (isHolderLine(line) ? [line, '', line] : [line])).join('\n');
        const inline = text => tidy(text).split('\n').map(line => (isHolderLine(line) ? `코드는 ${line.trim()}와 같습니다.` : line)).join('\n');
        const bullet = text => tidy(text).split('\n').map(line => (isHolderLine(line) ? `- ${line.trim()}` : line)).join('\n');
        const mangled = text => tidy(text).replace(HOLDER, '[[CODE-BLOCK-zzzz9999-1]]');
        const extra = text => `${tidy(text)}\n\n${holders(text)[0].replace(/-\d+\]\]$/, '-99]]')}`;
        for (const [name, bad, why] of [['두 번', twice, '두 번 넘게 나왔습니다.'], ['한 줄에 섞음', inline, '다른 글과 한 줄에 섞였거나 글자가 바뀌었습니다.'], ['목록 기호', bullet, '다른 글과 한 줄에 섞였거나 글자가 바뀌었습니다.'],
            ['바뀐 이름', mangled, ''], ['없는 번호', extra, '다른 글과 한 줄에 섞였거나 글자가 바뀌었습니다.']]) {
            const ctx = appContext();
            ctx.ai = route(ctx, { fix: fixer(bad) });
            const { text, report } = await fixOn(ctx, RUN_SECTION);
            assert.deepStrictEqual([callsOf(ctx, 'fix').length, text, statuses(report)], [2, RUN_SECTION, ['holder']], name);
            if (why) assert.ok(callsOf(ctx, 'fix')[1].user.includes(why), `${name}: ${callsOf(ctx, 'fix')[1].user}`);
            const { ctx: shown, saved } = await propose(RUN_SECTION, { fix: fixer(bad) });
            assert.deepStrictEqual([holders(saved).length, holders(shown.previews[0].after).length, saved], [0, 0, RUN_SECTION], name);
        }
        // 두 번째 답이 지키면 그 답을 쓴다
        const ctx = appContext();
        let n = 0;
        ctx.ai = route(ctx, { fix: ({ user }) => { n += 1; return reply(n === 1 ? twice(fixBody(user)) : tidy(fixBody(user))); } });
        assert.strictEqual((await fixOn(ctx, RUN_SECTION)).text, RUN_SECTION.replace('앞에서 다룬 ', ''));
        // 줄 전체가 자리 표시이면 AI가 덧붙인 꾸밈(` · ** · 대괄호 앞 \)은 벗겨 받는다(다시 받지 않는다)
        for (const dress of [key => `\`${key}\``, key => `**${key}**`, key => key.replace(/[[\]]/g, '\\$&')]) {
            const dressed = appContext();
            dressed.ai = route(dressed, { fix: fixer(text => tidy(text).split('\n').map(line => (isHolderLine(line) ? dress(line.trim()) : line)).join('\n')) });
            const { text } = await fixOn(dressed, RUN_SECTION);
            assert.deepStrictEqual([callsOf(dressed, 'fix').length, text], [1, RUN_SECTION.replace('앞에서 다룬 ', '')], dress('[[key]]'));
        }
    });

    await run('검토: 코드만 남기고 글을 지운 답, 닫지 않은 펜스를 새로 연 답은 받지 않고, 다른 섹션이나 새 섹션에 옮겨 적은 자리 표시는 저장되는 글에 남지 않는다', async () => {
        // 코드가 대부분인 섹션: 자리 표시를 지켜 되돌린 글의 길이는 비슷해도 글이 사라진 답이다
        const HEAVY = ['## 1. 합계 구하기 (⏱ 30분)', '', '앞에서 다룬 반복문으로 합계를 구합니다.', '', lines(3, '합계의'), '', PY('# 합계를 구합니다', ...Array.from({ length: 30 }, (_, i) => `total_${i} = ${i}`))].join('\n');
        const gut = appContext();
        gut.ai = route(gut, { fix: fixer(text => text.split('\n').filter(line => line.startsWith('## ') || isHolderLine(line)).join('\n\n')) });
        const gutted = await fixOn(gut, HEAVY);
        assert.deepStrictEqual([gutted.text, statuses(gutted.report), callsOf(gut, 'fix').length], [HEAVY, ['cut'], 1]);
        // 닫지 않은 코드 블록을 덧붙인 답: 뒤에 오는 글이 코드 안으로 들어간다
        const open = appContext();
        open.ai = route(open, { fix: fixer(text => `${tidy(text)}\n\n\`\`\`python\nprint(1)`) });
        const opened = await fixOn(open, TIGHT_SECTION);
        assert.deepStrictEqual([opened.text, statuses(opened.report)], [TIGHT_SECTION, ['code']]);
        // 한 호출에 묶인 두 섹션: 첫 섹션의 자리 표시를 코드가 없는 둘째 섹션으로 옮겨 적었다(다시 받은 답은 아예 빠뜨렸다)
        const NEXT = '## 2. 정리 (⏱ 10분)\n\n앞에서 다룬 내용을 정리합니다.';
        const TWO = [RUN_SECTION, NEXT].join('\n\n');
        const moved = appContext();
        moved.ai = route(moved, { fix: fixer(text => (text.includes('## 2. 정리') ? `${dropHolders(tidy(text))}\n\n${holders(text)[0]}` : dropHolders(tidy(text)))) });
        const across = await fixOn(moved, TWO);
        assert.deepStrictEqual([statuses(across.report), holders(across.text).length, callsOf(moved, 'fix').length], [['applied', 'holder'], 0, 2]);
        assert.strictEqual(across.text, [RUN_SECTION.replace('앞에서 다룬 ', ''), NEXT].join('\n\n'), '첫 섹션은 원래 자리에 블록을 되살리고, 자리 표시가 섞인 둘째 섹션은 그대로 둔다');
        assert.deepStrictEqual(codeTexts(moved, across.text), [CODE]);
        // 없던 섹션(개요)을 새로 쓰며 자리 표시를 옮겨 적었다: 그 새 섹션은 받지 않는다
        const LEARN = [LEARN_GOALS, RUN_SECTION, '## ✅ 학습 후 체크리스트\n\n- 합계를 구했습니다. (다시 보기: 1. 합계 구하기 (⏱ 30분))'].join('\n\n');
        const copy = appContext();
        copy.ai = route(copy, { fix: ({ user }) => reply(`## 개요\n\n- 값을 하나씩 더해야 하는 상황입니다.\n\n${holders(fixBody(user))[0]}\n\n${tidy(fixBody(user))}`) });
        const learned = await fixOn(copy, LEARN, { tabId: 'basicLearn' });
        assert.ok(lintOf(copy, LEARN, 'basicLearn').some(issue => issue.missing && issue.where === '개요'), '개요가 없다는 지적이 있다');
        assert.deepStrictEqual([holders(learned.text).length, learned.text.includes('## 개요'), learned.report.added], [0, false, 0]);
        assert.strictEqual(call(copy, 'fixRunNote')(learned.plan, learned.report), '지적이 있는 섹션 1개를 고쳤습니다. 없는 섹션(개요)은 새로 쓰지 못했습니다. 다시 실행해 주세요.');
        assert.ok(learned.text.includes('반복문으로 합계를 구합니다.') && !learned.text.includes('앞에서 다룬'), learned.text);
        assert.deepStrictEqual(codeTexts(copy, learned.text), [CODE]);
        // 자리 표시를 옮겨 적지 않은 새 섹션은 지금처럼 받는다
        const plainNew = appContext();
        plainNew.ai = route(plainNew, { fix: ({ user }) => reply(`## 개요\n\n- 값을 하나씩 더해야 하는 상황입니다.\n\n${tidy(fixBody(user))}`) });
        const withNew = await fixOn(plainNew, LEARN, { tabId: 'basicLearn' });
        assert.deepStrictEqual([withNew.text.includes('## 개요\n\n- 값을 하나씩 더해야 하는 상황입니다.'), withNew.report.added, holders(withNew.text).length], [true, 1, 0]);
        assert.ok(call(plainNew, 'fixRunNote')(withNew.plan, withNew.report).startsWith('지적이 있는 섹션 1개를 고쳤습니다. 없던 섹션 1개를 새로 썼습니다.'));
    });

    await run('코드 블록: 자리 표시 이름은 교안 글에 없는 것만 쓰고, 교안에 적힌 자리 표시 꼴의 글은 코드로 바뀌지 않는다', async () => {
        const ctx = appContext();
        const taken = (0.5).toString(36).slice(2, 10).padEnd(8, '0');
        vm.runInContext('Math.random = (() => { const seq = [0.5, 0.5, 0.25]; let i = 0; return () => seq[Math.min(i++, seq.length - 1)]; })();', ctx);
        const forged = `[[CODE-BLOCK-${taken}-1]]`;
        const md = ['## 1. 합계 구하기 (⏱ 30분)', '', '앞에서 다룬 반복문으로 합계를 구합니다.', '', forged, '', CODE, '', '결과를 확인합니다.'].join('\n');
        assert.notStrictEqual(call(ctx, 'fixCodeToken')(md), taken);
        assert.ok(!md.includes(call(ctx, 'fixCodeToken')(md)));
        ctx.ai = route(ctx, { fix: fixer() });
        const { text } = await fixOn(ctx, md);
        const sent = holders(fixBody(callsOf(ctx, 'fix')[0].user));
        assert.strictEqual(sent.length, 2, '교안의 글 하나와 이번 자리 표시 하나');
        assert.ok(sent.includes(forged) && sent.some(key => key !== forged && !key.includes(taken)), sent.join(' '));
        assert.strictEqual(text, md.replace('앞에서 다룬 ', ''), '교안에 적힌 글은 그대로 남고 코드로 바뀌지 않는다');
        assert.deepStrictEqual(codeTexts(ctx, text), [CODE]);
        // 되돌리기는 이번 자리 표시만 본다
        const shield = call(ctx, 'shieldFixCode')(md, 'tok12345');
        assert.deepStrictEqual([shield.codes.length, shield.codes[0].key, call(ctx, 'restoreFixCode')(shield.sent, shield.codes)], [1, '[[CODE-BLOCK-tok12345-1]]', md]);
    });

    await run('코드 블록: 펜스를 고쳐야 하는 지적(이름표)과 문항의 교차 검수 지적은 코드를 보여 주는 예전 길로 가고, 문항 탭의 다른 지적은 자리 표시로 보낸다', async () => {
        // 이름표가 없는 블록: 여는 펜스 줄에 언어 이름만 적은 답을 받는다
        const bare = ['## 1. 합계 구하기 (⏱ 30분)', '', '반복문으로 합계를 구합니다.', '', '```', '# 합계를 구합니다', 'total = 0', 'print(total)', '```'].join('\n');
        const ctx = appContext();
        ctx.ai = route(ctx, { fix: fixer(text => text.replace('```\n# 합계', '```python\n# 합계')) });
        const labelled = await fixOn(ctx, bare, { extra: { codeTopic: true } });
        const [fix] = callsOf(ctx, 'fix');
        assert.ok(fix.user.includes('total = 0') && holders(fix.user).length === 0 && !fix.user.includes('자리 표시'), fix.user);
        assert.ok(fix.user.includes('이름표가 없는 코드 블록은 여는 펜스 줄에 언어 이름만 적습니다.'));
        assert.strictEqual(labelled.text, bare.replace('```\n# 합계', '```python\n# 합계'));
        // 문항의 교차 검수 지적: 코드를 보고 정답을 드러내는 주석만 고친 답을 받는다
        const REVEALING = ['### 문제 1. 합계 구하기', '학습 목표 1 · 밴드 L2 · 코드제출', '', '빈칸을 채워 합계를 출력합니다.', '', '🧩 **시작 코드:**', '',
            PY('# 반복문으로 1, 2, 3을 더합니다', 'total = 0', 'for n in [1, 2, 3]:', '    total += n  # 정답: 여기서 6이 됩니다', 'print(total)'), '',
            '🧪 **테스트:** 입력 없음 → 6', '', '🔍 **교차 검수:** 수정 필요 - 시작 코드 주석이 정답과 출력 결과(6)를 알려 줍니다.', '', '---'].join('\n');
        const REVIEWED = REVEALING.replace('# 정답: 여기서 6이 됩니다', '# 수를 하나씩 합계에 더합니다').replace('수정 필요 - 시작 코드 주석이 정답과 출력 결과(6)를 알려 줍니다.', '통과');
        const quiz = await propose(REVEALING, { fix: () => reply(REVIEWED) }, { tabId: 'assessment' });
        const asked = callsOf(quiz.ctx, 'fix')[0];
        assert.ok(asked.user.includes('total += n  # 정답: 여기서 6이 됩니다') && holders(asked.user).length === 0, asked.user);
        assert.ok(asked.user.includes('코드 블록은 코드 줄을 한 글자도 바꾸지 않습니다. 정답·출력 결과·고칠 곳을 드러내는 주석 줄은 고쳐도 됩니다'));
        assert.ok(quiz.saved.includes('# 수를 하나씩 합계에 더합니다') && !quiz.saved.includes('정답: 여기서 6이 됩니다'), quiz.saved);
        // 문항 탭이어도 교차 검수 지적이 아니면(목표·밴드 줄이 없다) 코드를 보내지 않는다
        const noMeta = REVIEWED.replace('학습 목표 1 · 밴드 L2 · 코드제출\n', '');
        const meta = await propose(noMeta, { fix: fixer(text => text.replace('### 문제 1. 합계 구하기\n', '### 문제 1. 합계 구하기\n학습 목표 1 · 밴드 L2 · 코드제출\n')) }, { tabId: 'assessment' });
        const metaAsk = callsOf(meta.ctx, 'fix')[0];
        assert.ok(!metaAsk.user.includes('total = 0') && holders(fixBody(metaAsk.user)).length === 1, metaAsk.user);
        assert.deepStrictEqual(codeTexts(meta.ctx, meta.saved), codeTexts(meta.ctx, noMeta));
        assert.ok(meta.saved.includes('학습 목표 1 · 밴드 L2 · 코드제출'), meta.saved);
    });

    /* ---------- 큰 섹션 나누기 ---------- */
    await run('나누기: ### 소주제에서 자르고, 그래도 큰 조각은 문단 묶음으로 자르되 코드 블록·표·목록 안에서는 자르지 않는다. 이어 붙이면 원래 글이다', () => {
        const ctx = appContext();
        const split = call(ctx, 'splitFixChunks');
        const subs = ['## 제목', '', '첫머리입니다.', '', '### ■ 하나', '', '하나의 글입니다.', '', '```text', '### 코드 속 제목', '```', '', '### ■ 둘', '', '둘의 글입니다.'].join('\n');
        const bySub = plain(split(subs, 30));
        assert.deepStrictEqual([bySub.length, bySub.join('\n'), bySub[1].startsWith('### ■ 하나'), bySub[2].startsWith('### ■ 둘')], [3, subs, true, true]);
        assert.ok(bySub[1].includes('### 코드 속 제목'), '코드 블록 안의 ###에서는 자르지 않는다');
        const body = ['## 제목', '', '첫 문단입니다.', '', '- 목록 하나', '', '- 목록 둘', '', '  이어지는 설명입니다.', '', '| 가 | 나 |', '| --- | --- |', '| 1 | 2 |', '',
            '<div class="note">', '', '상자 안의 글입니다.', '', '</div>', '', '둘째 문단입니다.', '', '```python', 'x = 1', '', 'y = 2', '```', '', '셋째 문단입니다.'].join('\n');
        const parts = plain(split(body, 40));
        assert.strictEqual(parts.join('\n'), body);
        assert.ok(parts.length >= 4, String(parts.length));
        const together = (...texts) => assert.ok(parts.some(part => texts.every(text => part.includes(text))), texts.join(' / '));
        together('- 목록 하나', '- 목록 둘', '이어지는 설명입니다.');
        together('| 가 | 나 |', '| 1 | 2 |');
        together('<div class="note">', '상자 안의 글입니다.', '</div>');
        together('```python', 'x = 1', 'y = 2', '```');
        assert.ok(parts[0].includes('첫 문단입니다.'), '제목만 따로 떼지 않는다');
        assert.ok(parts.every(part => part.trim()), '빈 조각이 없다');
        // 나눌 곳이 없으면 통째로 둔다
        const one = `## 제목\n\n${'가나다라마바사. '.repeat(20).trim()}`;
        assert.deepStrictEqual(plain(split(one, 40)), [one]);
    });

    await run('나누기: 큰 섹션은 빼지 않고 지적이 있는 조각만 하나씩 차례로 고친다. 고치지 않은 글은 한 글자도 바뀌지 않는다', async () => {
        const ctx = appContext();
        assert.ok(bigSection(BIG_EXTRAS).length > call(ctx, 'REVIEW_FIX_MAX_CHARS'), '한 번에 고칠 분량을 넘는 섹션');
        const seen = [];
        ctx.ai = route(ctx, { fix: fixer() });
        const { text, plan, report } = await fixOn(ctx, BIG_DOC, { onStatus: step => seen.push(plain(step)) });
        const asks = callsOf(ctx, 'fix').map(item => item.user);
        assert.strictEqual(asks.length, 3, '작은 섹션 한 번, 큰 섹션의 조각 두 번');
        assert.ok(fixBody(asks[0]).startsWith('## 1. 작은 섹션') && asks[0].includes('[고칠 섹션]\n'));
        const [second, third] = [asks[1], asks[2]].map(fixBody);
        assert.ok(second.startsWith('### ■ 소주제 2') && !second.includes('소주제 3') && !second.includes('## 2. 큰 섹션'), second.slice(0, 80));
        assert.ok(third.startsWith('### ■ 소주제 5') && !third.includes('소주제 6'), third.slice(0, 80));
        assert.ok(asks[1].includes("- [고칠 부분]은 '## 2. 큰 섹션 (⏱ 160분)' 섹션에서 떼어 낸 한 부분입니다. 받은 부분만 고쳐 그 부분만 출력하고, 받지 않은 ## 제목이나 다른 부분을 더하지 않습니다."), asks[1].slice(0, 400));
        assert.ok(asks[1].includes('- 2. 큰 섹션 (⏱ 160분): 다른 차시를 지칭하지 않습니다.') && !asks[1].includes('정도는 수치로 씁니다.'), '그 조각의 지적만 보낸다');
        assert.ok(asks[2].includes('정도는 수치로 씁니다.') && !asks[2].includes('다른 차시를 지칭하지 않습니다.'));
        assert.ok(!second.includes('total = sum') && holders(second).length === 1, '조각의 코드 블록도 자리 표시로 보낸다');
        assert.strictEqual(text, tidy(BIG_DOC), '세 곳만 바뀌고 나머지는 그대로');
        assert.deepStrictEqual(codeTexts(ctx, text), codeTexts(ctx, BIG_DOC));
        assert.deepStrictEqual([plan.targets.length, plan.deferred, statuses(report), report.calls], [2, 0, ['applied', 'applied', 'applied'], 3]);
        assert.deepStrictEqual(seen, [{ no: 1, total: 3, again: false }, { no: 2, total: 3, again: false }, { no: 3, total: 3, again: false }]);
        assert.deepStrictEqual(lintOf(ctx, text).length, 0, '지적이 모두 풀렸다');
    });

    await run('나누기: 조각 답이 ## 제목을 덧붙이면 떼고, 다른 섹션을 더하거나 내용을 줄인 조각 답은 그 조각만 버린다', async () => {
        const ctx = appContext();
        ctx.ai = route(ctx, {
            fix: ({ user }) => {
                const body = fixBody(user);
                if (body.startsWith('### ■ 소주제 2')) return reply(`## 2. 큰 섹션 (⏱ 160분)\n\n${tidy(body)}`);
                if (body.startsWith('### ■ 소주제 5')) return reply(`${tidy(body)}\n\n## 새로 더한 섹션\n\n더한 글입니다.`);
                return reply(tidy(body));
            }
        });
        const { text, report } = await fixOn(ctx, BIG_DOC);
        assert.strictEqual(text, tidy(BIG_DOC).replace('2배 빠르게', '매우 빠르게'));
        assert.deepStrictEqual(statuses(report), ['applied', 'applied', 'absent']);
        const cut = appContext();
        cut.ai = route(cut, { fix: fixer(body => (body.startsWith('### ■ 소주제 5') ? tidy(body).slice(0, 2000) : tidy(body))) });
        const shrunk = await fixOn(cut, BIG_DOC);
        assert.deepStrictEqual(statuses(shrunk.report), ['applied', 'applied', 'cut']);
        assert.strictEqual(shrunk.text, tidy(BIG_DOC).replace('2배 빠르게', '매우 빠르게'), '줄어든 조각만 원문 그대로');
    });

    await run('차례: 중지하면 받은 데까지만 고치고, 호출 상한에 닿으면 남은 곳을 알린다. 한 곳의 오류는 다른 곳을 버리지 않는다', async () => {
        const stopped = appContext();
        stopped.ai = route(stopped, { fix: fixer() });
        const halted = await fixOn(stopped, BIG_DOC, { isStopped: () => callsOf(stopped, 'fix').length >= 1 });
        assert.deepStrictEqual([callsOf(stopped, 'fix').length, statuses(halted.report)], [1, ['applied', 'stop', 'stop']]);
        assert.strictEqual(halted.text, BIG_DOC.replace('앞에서 다룬 작은', '작은'), '받은 것은 남는다');
        const capped = appContext();
        capped.ai = route(capped, { fix: fixer() });
        const short = await fixOn(capped, BIG_DOC, { maxCalls: 2 });
        assert.deepStrictEqual([callsOf(capped, 'fix').length, statuses(short.report)], [2, ['applied', 'applied', 'cap']]);
        assert.ok(short.text.includes('매우 빠르게') && !short.text.includes('앞에서 다룬'));
        assert.strictEqual(call(capped, 'fixRunNote')(short.plan, short.report),
            '지적이 있는 섹션 1개를 고쳤습니다. 분량이 많은 섹션 1개는 지적이 있는 부분 1곳만 나눠 고쳤습니다. 한 번에 쓰는 AI 호출 2번을 다 써서 1곳(2. 큰 섹션 (⏱ 160분) › ■ 소주제 5)은 이번 제안에서 뺐습니다. 반영한 뒤 다시 실행하면 이어서 고칩니다.');
        assert.strictEqual(call(capped, 'FIX_MAX_CALLS'), 12);
        // 둘째 호출만 실패: 첫째와 셋째는 남는다
        const flaky = appContext();
        let n = 0;
        flaky.ai = route(flaky, { fix: item => { n += 1; if (n === 2) throw new Error('연결이 끊겼습니다'); return fixer()(item); } });
        const partial = await fixOn(flaky, BIG_DOC);
        assert.deepStrictEqual(statuses(partial.report), ['applied', 'error', 'applied']);
        assert.ok(partial.text.includes('앞에서 다룬 반복문을') && partial.text.includes('2배 빠르게'));
        assert.ok(call(flaky, 'fixRunNote')(partial.plan, partial.report).includes('AI 답을 받지 못해 1곳(2. 큰 섹션 (⏱ 160분) › ■ 소주제 2)은 고치지 못했습니다(연결이 끊겼습니다). 잠시 뒤 다시 실행해 주세요.'));
        // 하나도 받지 못했으면 지금처럼 오류로 알린다
        const dead = appContext();
        dead.ai = route(dead, { fix: () => { throw new Error('연결이 끊겼습니다'); } });
        await assert.rejects(() => fixOn(dead, BIG_DOC), /연결이 끊겼습니다/);
    });

    /* ---------- 검수 창 ---------- */
    await run('검수 창: 차례로 고치는 동안 몇 번째인지 보이고, 중지를 누르면 받은 데까지 미리 보인다', async () => {
        const { ctx, mod } = openTab(BIG_DOC);
        const panel = () => ctx.elements['lesson-review-dialog'];
        const shown = [];
        ctx.ai = route(ctx, {
            comment: commentReply(),
            fix: item => {
                shown.push(vm.runInContext('_review.status', ctx));
                if (callsOf(ctx, 'fix').length === 2) {
                    assert.ok(panel().innerHTML.includes('data-review-action="stop"'), '고치는 동안 중지 단추가 보인다');
                    panel().fire('click', { target: { dataset: { reviewAction: 'stop' } } });
                    assert.ok(panel().innerHTML.includes('중지하는 중입니다. 받고 있는 답까지만 고칩니다...'), panel().innerHTML.slice(-600));
                }
                return fixer()(item);
            }
        });
        call(ctx, 'runConventionCheck')(1);
        assert.ok(!panel().innerHTML.includes('data-review-action="stop"'), '쉬는 동안에는 중지 단추가 없다');
        await call(ctx, 'proposeLessonFix')();
        assert.deepStrictEqual(shown, ['지적이 있는 곳을 차례로 고치고 있습니다... (1/3)', '지적이 있는 곳을 차례로 고치고 있습니다... (2/3)']);
        assert.strictEqual(callsOf(ctx, 'fix').length, 2, '중지한 뒤에는 부르지 않는다');
        assert.strictEqual(ctx.previews[0].opts.note,
            '지적이 있는 섹션 1개를 고쳤습니다. 분량이 많은 섹션 1개는 지적이 있는 부분 1곳만 나눠 고쳤습니다. 중지해서 1곳(2. 큰 섹션 (⏱ 160분) › ■ 소주제 5)은 고치지 않았습니다. 다시 실행하면 이어서 고칩니다.');
        assert.ok(mod.tabContents.basicPrac.includes('매우 빠르게') && !mod.tabContents.basicPrac.includes('앞에서 다룬'), '받은 데까지 반영한다');
        assert.ok(!panel().innerHTML.includes('data-review-action="stop"') && vm.runInContext('_review.busy', ctx) === false);
    });

    await run('검수 창: 고치는 동안 창을 닫으면 받고 있는 답까지만 고치고(더 부르지 않는다) 받은 데까지 미리 보인다', async () => {
        const { ctx } = openTab(BIG_DOC);
        ctx.ai = route(ctx, {
            comment: commentReply(),
            fix: item => {
                ctx.elements['lesson-review-dialog'].fire('click', { target: { dataset: { reviewAction: 'close' } } });
                return fixer()(item);
            }
        });
        call(ctx, 'runConventionCheck')(1);
        await call(ctx, 'proposeLessonFix')();
        assert.strictEqual(callsOf(ctx, 'fix').length, 1);
        assert.strictEqual(ctx.previews[0].opts.note,
            '지적이 있는 섹션 1개를 고쳤습니다. 중지해서 2곳(2. 큰 섹션 (⏱ 160분) › ■ 소주제 2, 2. 큰 섹션 (⏱ 160분) › ■ 소주제 5)은 고치지 않았습니다. 다시 실행하면 이어서 고칩니다.');
        assert.strictEqual(ctx.previews[0].after, BIG_DOC.replace('앞에서 다룬 작은', '작은'));
    });

    await run('검수 창: 호출 상한(12번)을 넘는 조각은 이번 제안에서 빼고 안내에 적는다', async () => {
        const many = ['## 1. 큰 섹션 (⏱ 160분)', '큰 섹션의 첫머리입니다.', ...Array.from({ length: 14 }, (_, i) => sub(i + 1, { extra: '매우 빠르게 끝납니다.', size: 60 }))].join('\n\n');
        const { ctx, saved } = await propose(many, { fix: fixer() });
        assert.ok(many.length > call(ctx, 'REVIEW_FIX_MAX_CHARS'));
        assert.strictEqual(callsOf(ctx, 'fix').length, 12);
        assert.strictEqual((saved.match(/2배 빠르게/g) || []).length, 12);
        assert.strictEqual(ctx.previews[0].opts.note,
            '분량이 많은 섹션 1개는 지적이 있는 부분 12곳만 나눠 고쳤습니다. 한 번에 쓰는 AI 호출 12번을 다 써서 2곳(1. 큰 섹션 (⏱ 160분) › ■ 소주제 13, 1. 큰 섹션 (⏱ 160분) › ■ 소주제 14)은 이번 제안에서 뺐습니다. 반영한 뒤 다시 실행하면 이어서 고칩니다.');
    });

    await run('검수 창: 고친 것과 고치지 못한 까닭을 안내에 적고, 고정 섹션은 보내지도 바꾸지도 않는다', async () => {
        const LOCKED = ['## 고정 예제 (⏱ 10분)', '', '앞에서 다룬 고정 예제입니다.', '', PY('# 값을 출력합니다', 'print(1)')].join('\n');
        const md = [SUM_SECTION, LOCKED].join('\n\n');
        const { ctx, saved } = await propose(md, { fix: fixer() }, { lockedSections: { basicPrac: ['고정 예제'] } });
        const asks = callsOf(ctx, 'fix');
        assert.strictEqual(asks.length, 1);
        assert.ok(!fixBody(asks[0].user).includes('고정 예제입니다.') && asks[0].user.includes('고정 섹션(고정 예제 (⏱ 10분))은 출력하지 않습니다.'), asks[0].user);
        assert.strictEqual(ctx.previews[0].opts.note, '지적이 있는 섹션 1개를 고쳤습니다. 고정 섹션 1개는 고치지 않았습니다.');
        assert.strictEqual(ctx.previews[0].opts.emptyNote, undefined, '바뀐 것이 있으면 빈 안내는 없다');
        assert.strictEqual(saved, [SUM_SECTION.replace('앞에서 다룬 ', ''), LOCKED].join('\n\n'), '고정 섹션은 한 글자도 바뀌지 않는다');
    });

    await run('검수 창: 바뀐 것이 없으면 까닭을 적는다(그대로 돌려준 답·내용이 줄어든 답·섹션이 빠진 답)', async () => {
        const echo = await propose(TIGHT_SECTION, { fix: fixer(text => text) });
        assert.strictEqual(echo.ctx.previews[0].opts.note, 'AI가 고치지 않고 그대로 돌려주어 섹션 1개(1. 합계 구하기 (⏱ 30분))는 바뀌지 않았습니다. 다시 실행하거나 원문에서 직접 고쳐 주세요.');
        assert.strictEqual(echo.ctx.previews[0].opts.emptyNote, '위 안내에 적은 까닭으로 반영할 수정안이 없습니다.');
        assert.strictEqual(echo.saved, TIGHT_SECTION);
        const LONG_SECTION = `## 1. 긴 섹션 (⏱ 30분)\n\n앞에서 다룬 긴 섹션입니다.\n\n${lines(10, '긴 섹션의')}`;
        const cut = await propose(LONG_SECTION, { fix: () => reply('## 1. 긴 섹션 (⏱ 30분)\n\n짧습니다.') });
        assert.strictEqual(cut.ctx.previews[0].opts.note, '내용이 줄었거나 소주제·그림이 빠진 답이라 섹션 1개(1. 긴 섹션 (⏱ 30분))는 반영하지 않았습니다. 다시 실행해 주세요.');
        assert.deepStrictEqual([callsOf(cut.ctx, 'fix').length, cut.saved], [1, LONG_SECTION]);
        const absent = await propose(TIGHT_SECTION, { fix: () => reply('고칠 곳이 없습니다.') });
        assert.strictEqual(absent.ctx.previews[0].opts.note, 'AI 답에서 고칠 글을 찾지 못해 섹션 1개(1. 합계 구하기 (⏱ 30분))는 반영하지 않았습니다. 다시 실행해 주세요.');
        // 미리보기 창은 '바뀐 내용이 없습니다.' 뒤에 그 까닭을 잇는다
        const html = call(echo.ctx, 'aiChangeHtml')({ title: 'AI 수정 제안', note: '안내', summary: '', rows: [], accepted: new Set(), emptyNote: '위 안내에 적은 까닭으로 반영할 수정안이 없습니다.' });
        assert.ok(html.includes('바뀐 내용이 없습니다. 위 안내에 적은 까닭으로 반영할 수정안이 없습니다.'), html);
        assert.ok(call(echo.ctx, 'aiChangeHtml')({ title: '', note: '', summary: '', rows: [], accepted: new Set() }).includes('>바뀐 내용이 없습니다.<'), '까닭이 없으면 지금 글 그대로');
    });

    /* ---------- 생성 직후 자동 수정 ---------- */
    await run('자동 수정: 같은 방식으로 코드 블록을 지키고, 한 회차에 한 곳만 고친다(자리 표시가 어긋나면 한 번 더 받는다)', async () => {
        const ctx = appContext();
        ctx.ai = route(ctx, { fix: fixer(text => tidy(text).replace(/total = 0/g, 'total = 100')) });
        const fixed = await call(ctx, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md: SUM_SECTION });
        assert.strictEqual(fixed, SUM_SECTION.replace('앞에서 다룬 ', ''));
        assert.ok(!callsOf(ctx, 'fix')[0].user.includes('total = 0') && callsOf(ctx, 'fix').length === 1);
        // 큰 섹션: 기본(한 회차)은 필수 지적이 있는 첫 곳 하나만 부른다. 권장 지적만 있는 조각은 부르지 않는다
        const big = appContext();
        big.ai = route(big, { fix: fixer() });
        const once = await call(big, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md: BIG_DOC });
        assert.strictEqual(callsOf(big, 'fix').length, 1);
        assert.strictEqual(once, BIG_DOC.replace('앞에서 다룬 작은', '작은'));
        const rounds = appContext();
        const said = [];
        rounds.ai = route(rounds, { fix: fixer() });
        const all = await call(rounds, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md: BIG_DOC, rounds: 3, onStatus: text => said.push(text) });
        assert.strictEqual(callsOf(rounds, 'fix').length, 2, '필수 지적 두 곳');
        assert.strictEqual(all, tidy(BIG_DOC).replace('2배 빠르게', '매우 빠르게'));
        assert.deepStrictEqual(said, ['🔍 컨벤션 필수 지적 2건을 고치고 있습니다... (1/3)', '🔍 컨벤션 필수 지적 1건을 고치고 있습니다... (2/3)']);
        // 자리 표시를 빠뜨린 답: 한 번 더 받는다
        const again = appContext();
        const told = [];
        let n = 0;
        again.ai = route(again, { fix: ({ user }) => { n += 1; return reply(n === 1 ? dropHolders(tidy(fixBody(user))) : tidy(fixBody(user))); } });
        assert.strictEqual(await call(again, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md: TIGHT_SECTION, onStatus: text => told.push(text) }), TIGHT_SECTION.replace('앞에서 다룬 ', ''));
        assert.deepStrictEqual([callsOf(again, 'fix').length, told], [2, ['🔍 컨벤션 필수 지적 1건을 고치고 있습니다...', '🔍 코드 블록 자리를 지키지 않은 답이라 한 번 더 받고 있습니다...']]);
    });

    finish();
})();
