// 코드 주석 연결 테스트 (실행: node tests/code-comments-flow.test.js)
// 생성·고치기 길(탭 생성·카드 교안·최종 평가·분량 채우기·병합·탭 전체 AI 수정·AI 수정 제안·문제은행 문항)이 받은 글에 주석을 보강하는지,
// 이미 만든 교안의 '코드 주석 넣기'(차시·교과·과정), 차시를 열 때 알림, 화면 연결(index.html·도구 메뉴·교과 일괄 작업)을 실제 파일로 확인한다.
// AI는 가짜다: 지시의 <<<CODE n>>>…<<<END n>>>를 읽어 [블록 n] 줄의 주석 기호로 주석 줄을 붙인 답을 만든다. 키는 가짜 값만 쓰고 찍지 않는다.
// 컨벤션 점검의 주석 지적(codeComment: true, 주석이 모자라면 sev 'bad')은 lesson-lint.js가 낸다. 실행 환경(가짜 AI·화면 흉내)은 tests/code-comments-harness.js에 있다
const {
    vm, assert, read, plain, reply, json, FAKE_KEY, COMMENT_SYSTEM, NOTE, HISTORY_REASON, DAILY_MESSAGE, daily, PY, fakeElement, route, commentReply, callsOf,
    appContext, realContext, call, lessonOf, openSubject, needsOf, onlyComments, PRAC_DRAFT, LEARN_GOALS, QUESTION_MD, runner
} = require('./code-comments-harness');

const { run, finish } = runner();

(async () => {
    /* ---------- 화면 연결 ---------- */
    await run('연결: index.html은 code-comments.js를 data.js 바로 뒤에, code-comments-tool.js를 lesson-volume.js 바로 뒤에 이웃과 같은 ?v=로 싣는다', () => {
        const html = read('index.html');
        const scripts = [...html.matchAll(/<script src="\.\/js\/([\w./-]+)\.js\?v=(\d+)"><\/script>/g)].map(match => [match[1], match[2]]);
        const order = scripts.map(([name]) => name);
        const at = name => order.indexOf(name);
        assert.ok(at('data') >= 0 && at('code-comments') === at('data') + 1, order.join(','));
        assert.ok(at('lesson-volume') >= 0 && at('code-comments-tool') === at('lesson-volume') + 1, order.join(','));
        ['lesson-lint', 'tabs', 'api', 'course-qbank', 'gyosuan', 'lesson-review', 'merge'].forEach(name => assert.ok(at('code-comments') < at(name), `주석 모듈은 ${name}.js보다 먼저`));
        ['api', 'tabs', 'lesson-pipeline', 'lesson-review', 'lesson-lint', 'course-qbank', 'cost-estimate', 'gyosuan', 'course-meta', 'lesson-editor-tools', 'course-flow'].forEach(name => assert.ok(at(name) < at('code-comments-tool'), `연결 파일은 ${name}.js 뒤`));
        assert.strictEqual(new Set(scripts.map(([, v]) => v)).size, 1, '새 태그도 이웃과 같은 ?v=');
        assert.ok(!html.endsWith('\n'), 'index.html 끝 줄바꿈은 그대로 없다');
    });

    await run('연결: 도구 메뉴의 코드 주석 넣기는 예시 게임 그림 넣기 아래에 모든 탭에서 보이고, 교과 일괄 작업에는 두 단추가 기존 내용 보강 앞에 있다', () => {
        const api = read('js/api.js');
        const at = text => api.indexOf(text);
        assert.ok(at('id="game-picture-btn"') < at('id="code-comment-btn"') && at('id="code-comment-btn"') < at('<i class="ph-bold ph-image"></i> 이미지 삽입'), '예시 게임 그림 넣기와 이미지 삽입 사이');
        assert.ok(at('예시 게임 그림 넣기</button>`}') < at('id="code-comment-btn"'), '문제은행 탭에서도 보인다(예시 게임 그림 조건 밖)');
        assert.ok(api.includes(`onclick="startCodeComments('lesson'); this.closest('details').open = false" id="code-comment-btn"`));
        const classes = ((api.match(/id="code-comment-btn" class="([^"]*)"/) || [])[1] || '').split(/\s+/);
        ['bg-cyan-50', 'text-cyan-700', 'border-cyan-200', 'hover:bg-cyan-100', 'px-3', 'py-1.5', 'text-xs', 'font-bold'].forEach(name => assert.ok(classes.includes(name), name));
        assert.ok(/id="code-comment-btn"[^>]*>\s*<i class="ph-bold ph-chat-text"><\/i> 코드 주석 넣기<\/button>/.test(api));
        const tip = (api.match(/id="code-comment-btn"[^>]*title="([^"]*)"/) || [])[1] || '';
        assert.strictEqual(tip, '이 차시의 모든 탭에서 주석이 모자란 코드 블록에 AI가 주석만 더합니다. 코드 줄은 한 글자도 바꾸지 않고, 바꾸기 전 글은 작업 기록에 남깁니다');
        const ctx = appContext();
        const card = call(ctx, 'renderSubjectFlowCard')({ id: 's1', title: '교과', lessons: [] });
        const subjectAt = card.indexOf(`onclick="startCodeComments('subject')"`);
        const courseAt = card.indexOf(`onclick="startCodeComments('course')"`);
        assert.ok(subjectAt > 0 && subjectAt < courseAt && courseAt < card.indexOf('기존 내용 보강</button>'), card);
        assert.ok(card.includes('title="이 교과의 모든 차시와 최종 평가에서 주석이 모자란 코드 블록에 AI가 주석만 더함">코드 주석 넣기</button>'));
        assert.ok(card.includes('title="과정 전체의 차시와 최종 평가에서 주석이 모자란 코드 블록에 AI가 주석만 더함">과정 코드 주석 넣기</button>'));
    });

    await run('지시: 문제은행 문항·교차 검수는 문항 속 코드 주석이 답을 알려 주지 않게 하고, 분량 채우기·AI 수정 제안 안내에 주석을 적는다', async () => {
        const ctx = appContext();
        const formats = call(ctx, 'QBANK_TYPE_FORMATS');
        assert.strictEqual(formats.코드제출, '시작 코드가 필요하면 "🧩 **시작 코드:**" 다음 줄에 코드 블록으로 적고, 학습자가 채울 자리마다 무엇을 채울지 한국어 주석으로 적습니다(정답 코드는 주석에 적지 않습니다). "🧪 **테스트:** 입력과 기대 출력"을 적습니다.');
        const rules = call(ctx, 'QBANK_RULES').split('\n');
        assert.deepStrictEqual(rules.slice(-2), ['- 경어체로 쓰고 학습자를 호칭하지 않습니다.', '- 문항 속 코드에도 한국어 주석을 넣습니다. 주석은 코드가 무엇을 하는지만 적고 정답, 출력 결과, 고칠 곳을 알려 주지 않습니다.']);
        const review = call(ctx, 'buildReviewPrompt')({ title: '차시' }, [], ['목표']);
        assert.ok(review.includes('4) 해설과 채점 기준이 정답과 맞는가 5) 문항 속 코드에 주석이 있고 그 주석이 정답, 출력 결과, 고칠 곳을 알려 주지 않는가'), review);
        const panel = call(ctx, 'reviewPanelHtml')({ id: 1, title: '차시' }, 'basicPrac', '## 본문\n\n앞에서 다룹니다.', false);
        assert.ok(panel.includes('title="지적이 있는 섹션만 고치고 주석이 모자란 코드 블록에는 주석만 더한 수정안을 미리 본 뒤 반영합니다"'), 'AI 수정 제안 단추 설명');
        const mod = lessonOf({ tabs: { basicLearn: `${LEARN_GOALS}\n\n## 1. 합계 (⏱ 30분)\n\n합계를 구합니다.` } });
        openSubject(ctx, [mod]);
        ctx.confirmAnswer = false;
        await call(ctx, 'fillLessonVolume')(1, 'basicLearn');
        assert.ok(ctx.estimates[0].message.includes('컨벤션 필수 지적이 남은 섹션은 AI가 고쳐 쓸 수 있습니다. 주석이 모자란 코드 블록에는 주석만 더하며, 이미 있던 블록도 함께 보아 AI 호출이 더 들 수 있습니다. 끝나면 바뀐 섹션을 골라 반영하고'), ctx.estimates[0].message);
    });

    /* ---------- AI 호출(날 글) ---------- */
    await run('AI 호출: 답은 날 글 그대로(생각 글만 빼고) 받아 들여 쓴 주석 줄까지 바이트 그대로 넣고, 키는 주소가 아니라 머리글로만 보낸다', async () => {
        const ctx = realContext();
        const RAW = ['<<<CODE 1>>>', '# 합계를 구합니다', 'total = 0', 'for n in [1, 2]:', '    # 하나씩 더합니다', '    total += n', '<<<END 1>>>'].join('\n');
        ctx.fetchStub = async () => json({ candidates: [{ content: { parts: [{ text: '생각하는 중입니다.', thought: true }, { text: RAW }] }, finishReason: 'STOP' }] });
        assert.strictEqual(await call(ctx, 'codeCommentAsk')()({ system: '지시 글', user: '코드 글' }), RAW, '날 글 그대로');
        const sent = ctx.fetched[0];
        assert.ok(sent.url.includes('generativelanguage') && !sent.url.includes(FAKE_KEY), '키는 주소에 없다');
        assert.ok(sent.init.headers['x-goog-api-key'] === FAKE_KEY, '키는 머리글로 간다');
        const body = JSON.parse(sent.init.body);
        assert.deepStrictEqual([body.systemInstruction.parts[0].text, body.contents[0].role, body.contents[0].parts[0].text, body.generationConfig.maxOutputTokens], ['지시 글', 'user', '코드 글', 65536]);
        assert.notStrictEqual(call(ctx, 'extractText')(reply(RAW)), RAW, 'extractText는 # 줄 앞에 빈 줄을 넣고 들여쓰기를 떼어 코드가 바뀐 답이 된다');
        const DOC = ['## 1. 합계 (⏱ 30분)', '', '합계를 구합니다.', '', PY('total = 0', 'for n in [1, 2]:', '    total += n')].join('\n');
        ctx.fetched.length = 0;
        ctx.fetchStub = async (url, init) => {
            const asked = JSON.parse(init.body);
            assert.ok(asked.systemInstruction.parts[0].text.startsWith(COMMENT_SYSTEM) && asked.contents[0].parts[0].text.includes('<<<CODE 1>>>\ntotal = 0'));
            return json(reply(RAW));
        };
        const out = await call(ctx, 'addGeneratedCodeComments')({ md: DOC, tabId: 'basicPrac', label: '기본실습' });
        assert.ok(out.md.includes(PY('# 합계를 구합니다', 'total = 0', 'for n in [1, 2]:', '    # 하나씩 더합니다', '    total += n')), out.md);
        assert.strictEqual(ctx.fetched.length, 1);
        assert.deepStrictEqual(ctx.toasts, [{ message: '기본실습 코드 블록 1개에 주석을 넣었습니다.', kind: 'success' }]);
        // 끊긴 신호: 보내지 않고 중지로 끝난다. 받은 글은 그대로이고 알리지 않는다
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(call(ctx, 'codeCommentAsk')({ signal: controller.signal })({ system: 'S', user: 'U' }), err => err.name === 'AbortError' && err.message === '중지했습니다.');
        ctx.toasts.length = 0;
        const stopped = await call(ctx, 'addGeneratedCodeComments')({ md: DOC, tabId: 'basicPrac', label: '기본실습', signal: controller.signal });
        assert.deepStrictEqual([stopped.md, stopped.run.stopped, stopped.run.error, ctx.toasts.length], [DOC, true, '', 0]);
    });

    /* ---------- 생성 뒤 보강(addGeneratedCodeComments) ---------- */
    await run('생성 뒤 보강: 고정 섹션의 블록은 보내지 않고 바이트 그대로 두며 알림에 적는다. 고칠 블록이 없으면 부르지 않는다', async () => {
        const ctx = appContext();
        const md = ['## 1. 합계 (⏱ 30분)', '', PY('total = 0', 'print(total)'), '', '## 고정 예제 (⏱ 10분)', '', PY('print(1)'), '', '## 3. 출력 (⏱ 10분)', '', PY('print(2)')].join('\n');
        const locked = call(ctx, 'mdSections')(md).filter(section => section.title.startsWith('고정'));
        ctx.ai = route(ctx, { comment: commentReply() });
        const out = await call(ctx, 'addGeneratedCodeComments')({ md, tabId: 'basicPrac', lockedBlocks: locked, label: '기본실습' });
        assert.ok(out.md.includes(`## 고정 예제 (⏱ 10분)\n\n${PY('print(1)')}`), '고정 섹션의 블록은 그대로');
        assert.ok(!callsOf(ctx, 'comment')[0].user.includes('print(1)'), '고정 섹션의 블록은 보내지 않는다');
        assert.deepStrictEqual(plain([out.run.fixed, out.run.held, out.run.remaining]), [[0, 2], 1, 0]);
        onlyComments(ctx, md, out.md);
        assert.deepStrictEqual(ctx.toasts, [{ message: '기본실습 코드 블록 2개에 주석을 넣었습니다. 고정 섹션의 코드 블록 1개는 고치지 않았습니다.', kind: 'success' }]);
        const calls = ctx.calls.length;
        const none = await call(ctx, 'addGeneratedCodeComments')({ md: out.md, tabId: 'basicPrac', lockedBlocks: locked, label: '기본실습' });
        assert.deepStrictEqual([none.md, none.run, none.held, ctx.calls.length, ctx.toasts.length], [out.md, null, 1, calls, 1], '고칠 블록이 없으면 부르지도 알리지도 않고, 고정 섹션에 남은 수만 돌려준다');
        assert.strictEqual(call(ctx, 'lockedCommentSkip')([]), null);
        assert.strictEqual(call(ctx, 'commentRunNote')(null), '');
        assert.strictEqual(call(ctx, 'commentRunNote')({ fixed: [0, 1], remaining: 1, held: 2 }), '코드 블록 2개에 주석을 넣었습니다. 코드 블록 1개는 주석을 다 넣지 못했습니다. 고정 섹션의 코드 블록 2개는 고치지 않았습니다.');
        const quizOf = (mod, tab) => call(ctx, 'isCodeCommentQuiz')(mod, tab);
        assert.deepStrictEqual([quizOf({ id: 1 }, 'assessment'), quizOf({ id: 1 }, 'advAssessment'), quizOf({ id: 1 }, 'basicLearn'), quizOf({ id: 1 }, 'basicPrac'), quizOf({ id: 'mainQuest' }, 'basicLearn')], [true, true, false, false, true]);
    });

    await run('생성 뒤 보강: 중지하면 받은 주석만 남기고 알리지 않는다. AI가 실패하거나 코드를 바꾼 답이면 받은 글을 지키고 알린다', async () => {
        const ctx = appContext();
        const many = Array.from({ length: 9 }, (_, i) => `## ${i + 1}. 값 ${i + 1} (⏱ 10분)\n\n${PY(`v${i} = ${i}`)}`).join('\n\n');
        let stop = false;
        ctx.ai = route(ctx, { comment: item => { stop = true; return commentReply()(item); } });
        const stopped = await call(ctx, 'addGeneratedCodeComments')({ md: many, tabId: 'basicPrac', label: '기본실습', isStopped: () => stop });
        assert.deepStrictEqual([callsOf(ctx, 'comment').length, stopped.run.fixed.length, stopped.run.stopped, ctx.toasts.length], [1, 8, true, 0], '한 묶음(8블록)을 받고 멈춘다');
        assert.ok(stopped.md.includes(PY(`# ${NOTE}`, 'v0 = 0')) && stopped.md.includes(PY('v8 = 8')), '받은 주석은 남고 못 보낸 블록은 그대로');
        const md = `## 1. 합계 (⏱ 30분)\n\n${PY('total = 0', 'print(total)')}`;
        ctx.ai = route(ctx, { comment: () => { throw new Error('연결이 끊겼습니다'); } });
        const lost = await call(ctx, 'addGeneratedCodeComments')({ md, tabId: 'basicPrac', label: '기본실습' });
        assert.strictEqual(lost.md, md, 'AI가 실패하면 받은 글 그대로');
        assert.deepStrictEqual(ctx.toasts.at(-1), { message: "기본실습 코드 블록 1개는 주석을 다 넣지 못했습니다. 컨벤션 검수의 'AI 수정 제안'이나 도구의 '코드 주석 넣기'로 다시 넣을 수 있습니다.", kind: 'warning' });
        ctx.calls.length = 0;
        ctx.ai = route(ctx, { comment: commentReply(code => `# 설명\n${code.replace('total = 0', 'total = 1')}`) });
        const swapped = await call(ctx, 'addGeneratedCodeComments')({ md, tabId: 'basicPrac', label: '기본실습' });
        assert.deepStrictEqual([swapped.md, callsOf(ctx, 'comment').length, ctx.toasts.at(-1).kind], [md, 2, 'warning'], '코드를 바꾼 답은 버리고 한 번 더 받는다');
        assert.ok(callsOf(ctx, 'comment')[1].user.includes('지난 답에서 고칠 점'), '다시 받을 때는 까닭을 붙인다');
        ctx.ai = route(ctx, { comment: () => { throw daily(); } });
        const halted = await call(ctx, 'addGeneratedCodeComments')({ md, tabId: 'basicPrac', label: '기본실습' });
        assert.deepStrictEqual([halted.md, halted.run.error], [md, DAILY_MESSAGE]);
        assert.deepStrictEqual(ctx.toasts.at(-1), { message: `기본실습에 코드 주석을 넣다가 멈췄습니다. ${DAILY_MESSAGE}`, kind: 'warning' });
        const count = ctx.toasts.length;
        ctx.ai = route(ctx, { comment: () => { throw call(ctx, 'abortError')(); } });
        const aborted = await call(ctx, 'addGeneratedCodeComments')({ md, tabId: 'basicPrac', label: '기본실습' });
        assert.deepStrictEqual([aborted.md, aborted.run.stopped, aborted.run.error, ctx.toasts.length], [md, true, '', count], "끊겨 돌아온 '중지했습니다.'는 오류가 아니라 중지다");
        vm.runInContext('codeCommentRun = async () => { throw new Error("고장"); };', ctx);
        assert.deepStrictEqual(plain(await call(ctx, 'addGeneratedCodeComments')({ md, tabId: 'basicPrac' })), { md, run: null, held: 0 }, '어떤 오류에도 받은 글을 돌려준다');
    });

    /* ---------- 생성 길 ---------- */
    await run('탭 생성: 코드 차시의 기본실습은 자동 수정 뒤, 그림·저장 전에 주석을 보강한다(코드·블록 밖 글·낭독 분량은 그대로)', async () => {
        const ctx = appContext();
        const mod = lessonOf({ tabs: {} });
        openSubject(ctx, [mod]);
        assert.deepStrictEqual(plain(call(ctx, 'lintLessonMarkdown')(PRAC_DRAFT, 'basicPrac', call(ctx, 'lessonLintContext')(mod, 'basicPrac'))).filter(issue => !issue.codeComment), [], '초안의 다른 지적은 없다');
        const seen = [];
        const realAdd = ctx.addGeneratedCodeComments;
        ctx.addGeneratedCodeComments = async options => { seen.push(options); return realAdd(options); };
        ctx.ai = route(ctx, {
            tab: () => { ctx.order.push('tab'); return reply(PRAC_DRAFT); },
            comment: item => { ctx.order.push('comment'); ctx.loadingDuring = ctx.elements['editor-loading-text'].textContent; return commentReply()(item); }
        });
        const result = await call(ctx, 'generateTabContent')(1, 'basicPrac');
        assert.ok(result.ok, JSON.stringify(result));
        assert.deepStrictEqual(ctx.order, ['tab', 'comment', 'images'], '자동 수정(필수 지적 없음) 뒤, 그림 앞');
        const comment = callsOf(ctx, 'comment')[0];
        assert.ok(!comment.quiz, '실습 탭은 본문 모드');
        assert.deepStrictEqual([comment.payload.taskRole, comment.payload.generationConfig.maxOutputTokens, comment.payload.signal, !!comment.payload.waitSignal], ['fast', 65536, null, true]);
        assert.deepStrictEqual([seen.length, seen[0].tabId, seen[0].label, seen[0].quiz], [1, 'basicPrac', '기본실습', false]);
        const saved = mod.tabContents.basicPrac;
        assert.strictEqual(needsOf(ctx, saved), 0, '저장한 글은 주석이 모자란 블록이 없다');
        assert.ok(saved.includes(PY(`# ${NOTE}`, 'total = 0', `# ${NOTE}`, 'for n in [1, 2, 3]:', `    # ${NOTE}`, '    total += n', `# ${NOTE}`, 'print(total)')), saved);
        assert.ok(saved.includes('```text\n6\n```'), '실행 결과 블록은 그대로');
        onlyComments(ctx, seen[0].md, saved);
        assert.ok(ctx.loadingDuring.startsWith('기본실습 · 💬 코드 블록에 주석을 다는 중입니다 · 1/1개'), `로딩 화면에 진행을 보인다: ${ctx.loadingDuring}`);
        assert.ok(ctx.toasts.some(toast => toast.message === '기본실습 코드 블록 1개에 주석을 넣었습니다.' && toast.kind === 'success'), JSON.stringify(ctx.toasts));
        assert.ok(ctx.alerts.at(-1).startsWith('기본실습 탭이 생성되었습니다'), ctx.alerts.at(-1));
    });

    await run('탭 다시 만들기: 미리보기에 주석이 든 글이 가고, 고정 섹션의 블록은 보내지 않고 바이트 그대로 둔다. 코드를 바꾼 답이면 원래 코드가 남는다', async () => {
        const ctx = appContext();
        const LOCKED = `## 고정 예제 (⏱ 10분)\n\n${PY("print('고정')")}`;
        const mod = lessonOf({ tabs: { basicPrac: `## 1. 예전 실습 (⏱ 30분)\n\n예전 글입니다.\n\n${LOCKED}` }, lockedSections: { basicPrac: ['고정 예제'] } });
        openSubject(ctx, [mod]);
        ctx.ai = route(ctx, {
            tab: () => { ctx.order.push('tab'); return reply(`${PRAC_DRAFT}\n\n## 고정 예제 (⏱ 10분)\n\n${PY("print('바뀜')")}`); },
            comment: item => { ctx.order.push('comment'); return commentReply()(item); }
        });
        await call(ctx, 'generateTabContent')(1, 'basicPrac');
        assert.deepStrictEqual(ctx.order, ['tab', 'comment', 'preview', 'images']);
        const preview = ctx.previews[0];
        assert.ok(preview.after.includes(LOCKED) && mod.tabContents.basicPrac.includes(LOCKED), '고정 섹션은 원문 그대로');
        assert.ok(!callsOf(ctx, 'comment')[0].user.includes("print('고정')"), '고정 섹션의 블록은 보내지 않는다');
        assert.strictEqual(needsOf(ctx, preview.after, block => block.section.startsWith('고정')), 0, '미리보기 글에 주석이 들어 있다');
        assert.strictEqual(mod.tabContents.basicPrac, preview.after);
        assert.ok(ctx.toasts.some(toast => toast.message === '기본실습 코드 블록 1개에 주석을 넣었습니다. 고정 섹션의 코드 블록 1개는 고치지 않았습니다.'), JSON.stringify(ctx.toasts));
        const bad = appContext();
        const fresh = lessonOf({ tabs: {} });
        openSubject(bad, [fresh]);
        bad.ai = route(bad, { tab: () => reply(PRAC_DRAFT), comment: commentReply(code => `# 설명\n${code.replace('total = 0', 'total = 100')}`) });
        await call(bad, 'generateTabContent')(1, 'basicPrac');
        assert.strictEqual(callsOf(bad, 'comment').length, 2, '코드를 바꾼 답은 버리고 한 번 더 받는다');
        assert.ok(fresh.tabContents.basicPrac.includes(PY('total = 0', 'for n in [1, 2, 3]:', '    total += n', 'print(total)')) && !fresh.tabContents.basicPrac.includes('total = 100'), '원래 코드가 남는다');
        assert.ok(bad.toasts.some(toast => toast.kind === 'warning' && toast.message.startsWith('기본실습 코드 블록 1개는 주석을 다 넣지 못했습니다.')), JSON.stringify(bad.toasts));
    });

    await run('탭 생성: 중지했거나, 일부 단락이 빠졌거나, 한도로 분량 채우기가 멈춘 글에는 주석을 보강하지 않는다', async () => {
        const stopCtx = appContext();
        openSubject(stopCtx, [lessonOf({ tabs: {} })]);
        stopCtx.ai = route(stopCtx, { tab: () => { call(stopCtx, 'requestTabGenerationStop')(); return reply(PRAC_DRAFT); }, comment: commentReply() });
        await call(stopCtx, 'generateTabContent')(1, 'basicPrac');
        assert.deepStrictEqual(stopCtx.calls.map(item => item.kind), ['tab'], '중지');
        const partCtx = appContext();
        openSubject(partCtx, [lessonOf({ tabs: {} })]);
        partCtx.ai = route(partCtx, { tab: () => reply(`${PRAC_DRAFT}\n\n<!-- CONTINUE -->`), continue: () => { throw new Error('연결 오류'); }, comment: commentReply() });
        await call(partCtx, 'generateTabContent')(1, 'basicPrac');
        assert.deepStrictEqual(partCtx.calls.map(item => item.kind), ['tab', 'continue'], '일부 단락이 빠짐');
        const volCtx = appContext();
        openSubject(volCtx, [lessonOf({ tabs: {} })]);
        volCtx.ai = route(volCtx, { tab: () => reply(`${LEARN_GOALS}\n\n${PRAC_DRAFT}`), volume: () => { throw daily(); }, comment: commentReply() });
        const result = await call(volCtx, 'generateTabContent')(1, 'basicLearn');
        assert.ok(result.halt, '한도로 분량 채우기가 멈췄다');
        assert.ok(!callsOf(volCtx, 'comment').length && !callsOf(volCtx, 'fix').length, '한도로 멈춘 글');
    });

    await run('문항 모드: 학습이해도·심화이해도 탭 생성, 최종 평가(카드 생성·최종 평가 만들기)는 정답·출력 결과를 주석에 쓰지 않게 지시한다', async () => {
        const ctx = appContext();
        const mod = lessonOf({ tabs: { basicLearn: `${LEARN_GOALS}\n\n${PRAC_DRAFT}`, advLearn: `${LEARN_GOALS}\n\n${PRAC_DRAFT}` } });
        openSubject(ctx, [mod]);
        ctx.ai = route(ctx, { tab: () => reply(QUESTION_MD), comment: commentReply() });
        await call(ctx, 'generateTabContent')(1, 'assessment');
        await call(ctx, 'generateTabContent')(1, 'advAssessment');
        assert.deepStrictEqual(callsOf(ctx, 'comment').map(item => item.quiz), [true, true], '문제은행 탭은 문항 모드');
        ['assessment', 'advAssessment'].forEach(tab => assert.ok(mod.tabContents[tab].includes(PY(`# ${NOTE}`, 'total = 0', `# ${NOTE}`, 'print(total)')), tab));
        const final = appContext();
        const quest = { id: 'mainQuest', title: '최종 평가', description: '종합 과제', status: 'pending', images: {} };
        openSubject(final, [lessonOf({ tabs: { basicLearn: PRAC_DRAFT } })], { mainQuest: quest });
        vm.runInContext("currentEditingModuleId = 'mainQuest'; window.runLessonPipeline = async () => { window.pipelineContinued = true; };", final);
        final.ai = route(final, { module: () => { final.order.push('module'); return reply(QUESTION_MD); }, comment: item => { final.order.push('comment'); return commentReply()(item); } });
        await call(final, 'generateModuleContent')('mainQuest', []);
        assert.deepStrictEqual([final.order, callsOf(final, 'comment').map(item => item.quiz)], [['module', 'comment', 'images'], [true]]);
        assert.ok(quest.content.includes(PY(`# ${NOTE}`, 'total = 0', `# ${NOTE}`, 'print(total)')), quest.content);
        const main = appContext();
        const quest2 = { id: 'mainQuest', title: '최종 평가', description: '종합 과제', status: 'pending', images: {} };
        openSubject(main, [lessonOf({ tabs: { basicLearn: PRAC_DRAFT } })], { mainQuest: quest2 });
        vm.runInContext('cleanForAPI = text => String(text || "");', main); // ui.js의 요약 정리(이 테스트는 싣지 않는다)
        main.ai = route(main, { main: () => reply(QUESTION_MD), comment: item => { main.loadingDuring = main.elements['editor-loading-text'].textContent; return commentReply()(item); } });
        await call(main, 'generateMainQuest')();
        assert.deepStrictEqual(callsOf(main, 'comment').map(item => item.quiz), [true], '최종 평가 만들기');
        assert.ok(quest2.content.includes(PY(`# ${NOTE}`, 'total = 0', `# ${NOTE}`, 'print(total)')), quest2.content);
        assert.ok(main.loadingDuring.startsWith('최종 평가 · 💬 코드 블록에 주석을 다는 중입니다'), main.loadingDuring);
        assert.strictEqual(main.elements['editor-loading-text'].textContent, '', '끝나면 로딩 화면 글을 되돌린다');
    });

    await run('카드 교안 생성: 기본학습은 분량 채우기·자동 수정 뒤, 그림·저장 전에 주석을 보강한다', async () => {
        const ctx = appContext();
        const mod = lessonOf({ tabs: {}, status: 'pending', content: '' });
        openSubject(ctx, [mod]);
        vm.runInContext(`window.runLessonPipeline = async () => {};
            ensureSpokenVolume = async opts => { window.order.push('volume'); return { md: opts.md, spoken: 0, minutes: 0, targetMinutes: 480, targetChars: 120000, calls: 0, added: 0, short: true, stopped: false, gone: false, error: null, reason: 'none', parts: [] }; };`, ctx);
        ctx.ai = route(ctx, { module: () => { ctx.order.push('module'); return reply(`${LEARN_GOALS}\n\n${PRAC_DRAFT}`); }, comment: item => { ctx.order.push('comment'); return commentReply()(item); } });
        await call(ctx, 'generateModuleContent')(1, []);
        assert.deepStrictEqual(ctx.order, ['module', 'volume', 'comment', 'images']);
        assert.deepStrictEqual(callsOf(ctx, 'comment').map(item => [item.quiz, !!item.payload.waitSignal]), [[false, true]]);
        assert.strictEqual(needsOf(ctx, mod.tabContents.basicLearn), 0, mod.tabContents.basicLearn);
        assert.ok(ctx.statuses.some(text => text.startsWith('기본학습 · 💬 코드 블록에 주석을 다는 중입니다')), ctx.statuses.join(' | '));
    });

    await run('분량 채우기·병합: 늘린 글은 자동 수정 뒤 주석을 보강해 미리 보이고, 중지·한도로 멈춘 글에는 하지 않는다', async () => {
        const ctx = appContext();
        const before = `${LEARN_GOALS}\n\n## 1. 합계 (⏱ 30분)\n\n합계를 구합니다.`;
        const mod = lessonOf({ tabs: { basicLearn: before } });
        openSubject(ctx, [mod]);
        const ADDED = `\n\n### ■ 보강 소주제\n\n${PY('x = 1', 'print(x)')}`;
        ctx.volume = opts => ({ md: `${opts.md}${ADDED}`, spoken: 0, minutes: 0, targetMinutes: 480, targetChars: 120000, calls: 1, added: 1, short: true, stopped: false, gone: false, error: null, reason: 'target', parts: [] });
        vm.runInContext('ensureSpokenVolume = async opts => window.volume(opts);', ctx);
        ctx.ai = route(ctx, { comment: commentReply() });
        await call(ctx, 'fillLessonVolume')(1, 'basicLearn');
        assert.strictEqual(callsOf(ctx, 'comment').length, 1);
        assert.ok(callsOf(ctx, 'comment')[0].payload.waitSignal, '중지하면 다시 보내려고 기다리는 것을 끊는다');
        assert.strictEqual(needsOf(ctx, ctx.previews[0].after), 0, '미리보기 글에 주석이 들어 있다');
        assert.strictEqual(mod.tabContents.basicLearn, ctx.previews[0].after);
        assert.deepStrictEqual(ctx.archived.map(item => item.reason), ['분량 채우기 전']);
        assert.ok(ctx.statuses.includes('기본학습 · 💬 코드 블록에 주석을 다는 중입니다 · 1/1개'), ctx.statuses.join(' | '));
        // 병합한 기본학습(merge.js fillMergedLearn)
        const lesson = lessonOf({ id: 9, title: '[병합] 반복 + 조건', tabs: {} });
        const subject = ctx.globalState.subjects[0];
        subject.lessons.push(lesson);
        ctx.calls.length = 0;
        ctx.ai = route(ctx, { comment: item => { ctx.mergeStatus = ctx.elements['editor-loading-text'].textContent; return commentReply()(item); } });
        const merged = await call(ctx, 'fillMergedLearn')(subject, lesson, before, {}, 480);
        assert.ok(!merged.gone && needsOf(ctx, merged.md) === 0 && merged.md.includes(`# ${NOTE}\nx = 1`), merged.md);
        assert.ok(ctx.mergeStatus.startsWith('기본학습 · 💬 코드 블록에 주석을 다는 중입니다'), ctx.mergeStatus);
        ctx.calls.length = 0;
        ctx.volume = opts => ({ md: `${opts.md}${ADDED}`, spoken: 0, minutes: 0, targetMinutes: 480, targetChars: 120000, calls: 1, added: 1, short: true, stopped: true, gone: false, error: null, reason: 'stopped', parts: [] });
        const quit = await call(ctx, 'fillMergedLearn')(subject, lesson, before, {}, 480);
        assert.deepStrictEqual([ctx.calls.length, quit.md.includes(PY('x = 1', 'print(x)'))], [0, true], '중지한 병합에는 보강하지 않는다');
    });

    /* ---------- 고치기 길 ---------- */
    await run('탭 전체 AI 수정: 미리보기에 주석이 든 글이 가고, 중지하면 반영하지 않는다. 문제은행 탭 지시에는 문항 속 코드 주석 규칙이 붙는다', async () => {
        const ctx = appContext();
        const original = '## 1. 본문 (⏱ 30분)\n\n원래 글입니다.';
        const edited = `## 1. 본문 (⏱ 30분)\n\n보강한 글입니다.\n\n${PY('total = 0', 'print(total)')}`;
        const mod = lessonOf({ tabs: { basicLearn: original, assessment: QUESTION_MD } });
        openSubject(ctx, [mod]);
        ctx.ai = route(ctx, { other: () => reply(edited), comment: commentReply() });
        await call(ctx, 'reinforceCurrentTab')(1, '예제 코드를 더해 줘');
        assert.deepStrictEqual(ctx.calls.map(item => item.kind), ['other', 'comment']);
        assert.ok(!ctx.calls[0].system.includes('문항 속 코드'), '학습 탭에는 문항 규칙을 붙이지 않는다');
        assert.strictEqual(needsOf(ctx, ctx.previews[0].after), 0);
        assert.strictEqual(mod.tabContents.basicLearn, ctx.previews[0].after);
        assert.deepStrictEqual(ctx.archived.map(item => item.reason), ['고치기 전']);
        assert.ok(callsOf(ctx, 'comment')[0].payload.signal, '중지하면 받던 주석 호출도 끊는다');
        const stopCtx = appContext();
        const mod2 = lessonOf({ tabs: { basicLearn: original } });
        openSubject(stopCtx, [mod2]);
        stopCtx.ai = route(stopCtx, { other: () => reply(edited), comment: item => { call(stopCtx, 'requestLessonPipelineStop')(); return commentReply()(item); } });
        await call(stopCtx, 'reinforceCurrentTab')(1, '예제 코드를 더해 줘');
        assert.deepStrictEqual([stopCtx.previews.length, mod2.tabContents.basicLearn, stopCtx.archived.length], [0, original, 0], '중지하면 반영하지 않는다');
        assert.ok(!stopCtx.toasts.some(toast => toast.kind === 'warning'), '중지는 경고하지 않는다');
        ctx.calls.length = 0;
        vm.runInContext("currentLessonTab = 'assessment';", ctx);
        ctx.ai = route(ctx, { other: () => reply(QUESTION_MD.replace('빈칸을 채워', '빈칸 두 곳을 채워')), comment: commentReply() });
        await call(ctx, 'reinforceCurrentTab')(1, '문항을 다듬어 줘');
        assert.ok(ctx.calls[0].system.includes('\n- 문항 속 코드(문제 글·보기·시작 코드)에도 한국어 주석을 넣습니다. 주석은 코드가 무엇을 하는지만 적고 정답, 출력 결과, 고칠 곳을 알려 주지 않습니다. 시작 코드에는 학습자가 채울 자리마다 무엇을 채울지 주석으로 적습니다.'), ctx.calls[0].system);
        assert.deepStrictEqual(callsOf(ctx, 'comment').map(item => item.quiz), [true], '문제은행 탭은 문항 모드');
    });

    await run('AI 수정 제안: 주석 지적만 있으면 섹션을 고쳐 쓰지 않고 주석만 더해 미리 보인다. 지적 섹션이 모두 고정이거나 주석을 못 넣으면 알린다', async () => {
        const ctx = appContext();
        const mod = lessonOf({ tabs: { basicPrac: PRAC_DRAFT } });
        openSubject(ctx, [mod]);
        vm.runInContext("currentLessonTab = 'basicPrac';", ctx);
        ctx.ai = route(ctx, { comment: commentReply() });
        call(ctx, 'runConventionCheck')(1);
        await call(ctx, 'proposeLessonFix')();
        assert.deepStrictEqual(ctx.calls.map(item => item.kind), ['comment'], '섹션 고치기를 부르지 않는다');
        assert.strictEqual(ctx.previews[0].opts.note, '코드 블록 1개에 주석을 넣었습니다.');
        assert.strictEqual(needsOf(ctx, mod.tabContents.basicPrac), 0);
        assert.deepStrictEqual(ctx.archived.map(item => item.reason), ['고치기 전']);
        assert.ok(!ctx.toasts.some(toast => toast.message.includes('주석을 넣었습니다')), '알림 대신 미리보기 안내에 적는다');
        const locked = appContext();
        const lockedMd = `## 고정\n\n앞에서 다룹니다.\n\n${PY('print(1)')}`;
        const mod2 = lessonOf({ tabs: { basicPrac: lockedMd }, lockedSections: { basicPrac: ['고정'] } });
        openSubject(locked, [mod2]);
        vm.runInContext("currentLessonTab = 'basicPrac';", locked);
        locked.ai = route(locked, {});
        call(locked, 'runConventionCheck')(1);
        await call(locked, 'proposeLessonFix')();
        assert.deepStrictEqual([locked.calls.length, mod2.tabContents.basicPrac], [0, lockedMd]);
        assert.strictEqual(locked.alerts.at(-1), '고칠 수 있는 섹션이 없습니다. 지적된 섹션이 모두 고정되어 있습니다.');
        // 주석 지적만 있고 그 블록이 모두 고정 섹션에 있으면 부르지 않고 같은 알림을 띄운다(빈 미리보기를 열지 않는다)
        const heldMd = `## 고정\n\n고정한 예제입니다.\n\n${PY('print(1)')}`;
        const mod4 = lessonOf({ tabs: { basicPrac: heldMd }, lockedSections: { basicPrac: ['고정'] } });
        openSubject(locked, [mod4]);
        vm.runInContext("currentLessonTab = 'basicPrac';", locked);
        assert.deepStrictEqual(plain(call(locked, 'lintLessonMarkdown')(heldMd, 'basicPrac').map(issue => [issue.sev, !!issue.codeComment])), [['bad', true]], '고정 섹션의 블록도 점검에는 보인다');
        call(locked, 'runConventionCheck')(1);
        await call(locked, 'proposeLessonFix')();
        assert.deepStrictEqual([locked.calls.length, locked.previews.length, mod4.tabContents.basicPrac], [0, 0, heldMd]);
        assert.strictEqual(locked.alerts.at(-1), '고칠 수 있는 섹션이 없습니다. 지적된 섹션이 모두 고정되어 있습니다.');
        const fail = appContext();
        const mod3 = lessonOf({ tabs: { basicPrac: PRAC_DRAFT } });
        openSubject(fail, [mod3]);
        vm.runInContext("currentLessonTab = 'basicPrac';", fail);
        fail.ai = route(fail, { comment: () => { throw new Error('연결이 끊겼습니다'); } });
        call(fail, 'runConventionCheck')(1);
        await call(fail, 'proposeLessonFix')();
        assert.deepStrictEqual([fail.previews.length, mod3.tabContents.basicPrac], [0, PRAC_DRAFT]);
        assert.strictEqual(fail.alerts.at(-1), '주석을 넣지 못했습니다. AI 답이 코드를 바꿔 버렸거나 답을 받지 못했습니다. 잠시 뒤 다시 눌러 보세요.');
    });

    await run('자동 수정: 주석 지적은 섹션을 고쳐 쓰지 않는다(주석 지적만 있으면 부르지 않고, 섞이면 고치기 지시에 주석 지적이 없다)', async () => {
        const ctx = appContext();
        ctx.ai = route(ctx, { fix: () => reply('') });
        const same = await call(ctx, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md: PRAC_DRAFT });
        assert.deepStrictEqual([same, ctx.calls.length], [PRAC_DRAFT, 0]);
        const mixed = PRAC_DRAFT.replace('반복문으로 합계를 구합니다.', '앞에서 다룬 반복문으로 합계를 구합니다.');
        assert.ok(call(ctx, 'lintLessonMarkdown')(mixed, 'basicPrac').some(issue => issue.sev === 'bad' && !issue.codeComment), '다른 필수 지적이 있다');
        await call(ctx, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md: mixed });
        const fix = callsOf(ctx, 'fix')[0];
        assert.ok(fix && !fix.user.includes(call(ctx, 'CODE_COMMENT_LINT_MSG')), fix?.user);
    });

    await run('문제은행 문항: 주석(문항 모드)을 넣은 뒤 교차 검수하고, 코드 칸만 바뀐다. 주석 호출이 실패하면 문항 그대로다', async () => {
        const ctx = appContext();
        const mod = lessonOf({ tabs: { basicLearn: `${LEARN_GOALS}\n\n## 1. 합계 (⏱ 30분)\n\n합계를 구합니다.` } });
        openSubject(ctx, [mod]);
        vm.runInContext("crossCheckModel = () => 'review-model';", ctx);
        const DRAFT = ['### 문제 1. 합계 구하기', '학습 목표 1 · 밴드 L2 · 코드제출', '', '아래 목록의 합계를 출력합니다.', '', PY('nums = [1, 2, 3]', 'print(nums)'), '', '🧩 **시작 코드:**', '', PY('total = 0', 'for n in nums:', '    pass'), '', '🧪 **테스트:** 입력 없음 → 6', '', '📝 **해설:** 반복문으로 더합니다.'].join('\n');
        ctx.ai = route(ctx, {
            qgen: () => { ctx.order.push('qgen'); return reply(DRAFT); },
            comment: item => { ctx.order.push('comment'); return commentReply()(item); },
            review: item => { ctx.order.push('review'); ctx.reviewed = item.user; return reply('[{"i": 0, "ok": true, "notes": ""}]'); }
        });
        const spec = { objective: 1, band: 'L2', type: '코드제출', count: 1 };
        const [q] = plain(await call(ctx, 'generateQuestions')(mod, spec, 'basic'));
        assert.deepStrictEqual(ctx.order, ['qgen', 'comment', 'review'], '주석을 넣은 뒤 교차 검수한다');
        assert.ok(callsOf(ctx, 'comment')[0].quiz, '문항 모드');
        assert.strictEqual(q.code, [`# ${NOTE}`, 'total = 0', `# ${NOTE}`, 'for n in nums:', `    # ${NOTE}`, '    pass'].join('\n'));
        assert.ok(q.stem.includes(PY(`# ${NOTE}`, 'nums = [1, 2, 3]', `# ${NOTE}`, 'print(nums)')), q.stem);
        assert.deepStrictEqual([q.objective, q.band, q.type, q.lang, q.tests, q.explanation, q.title], [1, 'L2', '코드제출', 'python', '입력 없음 → 6', '반복문으로 더합니다.', '합계 구하기']);
        assert.ok(ctx.reviewed.includes(`# ${NOTE}`), '검수자가 주석까지 본다');
        assert.strictEqual(q.review, '통과 · review-model');
        ctx.order.length = 0;
        ctx.ai = route(ctx, { qgen: () => reply(DRAFT), comment: () => { throw new Error('연결이 끊겼습니다'); }, review: () => reply('[]') });
        const [kept] = plain(await call(ctx, 'generateQuestions')(mod, spec, 'basic'));
        assert.deepStrictEqual([kept.code, kept.stem.includes(`# ${NOTE}`)], ['total = 0\nfor n in nums:\n    pass', false], '실패하면 문항 그대로');
    });

    /* ---------- 이미 만든 교안: 코드 주석 넣기 ---------- */
    const lessonFixture = () => lessonOf({
        lockedSections: { basicLearn: ['고정 예제'] },
        tabs: {
            basicLearn: ['## 1. 합계 (⏱ 30분)', '', '합계를 구합니다.', '', PY('total = 0', 'for n in [1, 2]:', '    total += n'), '', '## 고정 예제 (⏱ 10분)', '', PY('print(total)')].join('\n'),
            basicPrac: `## 1. 실습 (⏱ 30분)\n\n${PY('name = input()', 'print(name)')}`,
            assessment: QUESTION_MD
        },
        gyosuan: { docMd: `# 교수안\n\n${PY('x = 1')}`, deckMd: `### 슬라이드 1 - 코드\n\n${PY('y = 2')}`, deckHtml: null, sessionDecks: {}, deckDirty: false, deckRev: 3, images: {} },
        gyosuanAdv: { docMd: '', deckMd: `### 슬라이드 1 - 심화\n\n${PY('z = 3')}`, deckHtml: '<section>화면 편집본</section>', sessionDecks: {}, deckDirty: false, deckRev: 1, images: {} }
    });

    await run('코드 주석 넣기(이 차시): 묻고(블록 수·호출 수), 진행 막대에서 탭마다 주석만 넣고(교수안·편성안은 그대로), 작업 기록 한 칸으로 되돌릴 수 있다', async () => {
        const ctx = appContext();
        const mod = lessonFixture();
        const tabsBefore = plain(mod.tabContents);
        const gyosuanBefore = plain([mod.gyosuan, mod.gyosuanAdv]);
        openSubject(ctx, [mod]);
        const bars = [];
        ctx.ai = route(ctx, { comment: item => { bars.push(ctx.elements['lesson-pipeline-bar']?.innerHTML || ''); return commentReply()(item); } });
        await call(ctx, 'startCodeComments')('lesson');
        const asked = ctx.estimates[0];
        assert.ok(asked.message.startsWith("이 차시의 탭 3개에서 주석이 모자란 코드 블록 3개에 AI가 주석만 더합니다. 코드 줄은 한 글자도 바꾸지 않고(코드가 바뀐 답은 버립니다), 바꾸기 전 글은 작업 기록에 '코드 주석 넣기 전'으로 남깁니다. 주석이 덜 붙은 블록은 한 번 더 받아 호출이 최대 6회까지 늘 수 있습니다. 오른쪽 아래 막대에서 언제든 멈출 수 있습니다."), asked.message);
        ['학습이해도·심화이해도·최종 평가 문항의 코드에는 정답·출력 결과·고칠 곳을 알려 주지 않는 주석만 넣습니다.', '고정 섹션의 코드 블록 1개는 고치지 않습니다.']
            .forEach(text => assert.ok(asked.message.includes(text), text));
        assert.ok(!/교수안|편성안/.test(asked.message), asked.message);
        const previewCalls = ['basicLearn', 'basicPrac', 'assessment'].reduce((sum, tab) => sum + call(ctx, 'codeCommentPreview')(tabsBefore[tab], { skipBlock: block => block.section.startsWith('고정') }).calls, 0);
        assert.deepStrictEqual([plain(asked.work), plain(asked.opts)], [{ codeComments: previewCalls }, { title: '코드 주석 넣기', okLabel: '주석 넣기' }]);
        assert.strictEqual(callsOf(ctx, 'comment').length, 3);
        assert.deepStrictEqual(callsOf(ctx, 'comment').map(item => item.quiz), [false, false, true], '학습이해도만 문항 모드');
        assert.ok(callsOf(ctx, 'comment').every(item => item.payload.signal && item.payload.taskRole === 'fast'), '중지 신호를 넘긴다');
        assert.ok(bars.every(html => html.includes('코드 주석 넣기 · ')), '진행 막대');
        assert.deepStrictEqual(ctx.steps.map(step => step.label), ['코드 주석 넣기 · 기본학습', '코드 주석 넣기 · 기본실습', '코드 주석 넣기 · 학습이해도']);
        assert.ok(ctx.statuses.includes('기본학습 · 💬 코드 블록에 주석을 다는 중입니다 · 1/1개'), ctx.statuses.join(' | '));
        assert.ok(mod.tabContents.basicLearn.includes(`## 고정 예제 (⏱ 10분)\n\n${PY('print(total)')}`), '고정 섹션은 그대로');
        ['basicLearn', 'basicPrac', 'assessment'].forEach(tab => onlyComments(ctx, tabsBefore[tab], mod.tabContents[tab]));
        assert.strictEqual(needsOf(ctx, mod.tabContents.basicPrac) + needsOf(ctx, mod.tabContents.assessment), 0);
        assert.deepStrictEqual(plain([mod.gyosuan, mod.gyosuanAdv]), gyosuanBefore, '교수안·편성안은 고치지 않는다(교수안 화면이 코드 블록을 그리지 못한다)');
        assert.deepStrictEqual(ctx.archived.map(item => item.reason), [HISTORY_REASON], '작업 기록은 차시마다 한 칸');
        assert.deepStrictEqual(plain(ctx.archived[0].entry.tabContents), tabsBefore, '바꾸기 전 모든 탭');
        assert.deepStrictEqual([ctx.announced, mod.history[0].note], [[], '코드 주석 넣기 (코드 블록 3개)']);
        assert.ok(ctx.saved >= 1 && ctx.rendered >= 1);
        assert.deepStrictEqual(ctx.toasts.at(-1), { message: "코드 주석 넣기를 마쳤습니다. 코드 블록 3개에 주석을 넣었습니다. 바꾸기 전 글은 작업 기록에 '코드 주석 넣기 전'으로 남겼습니다. 고정 섹션의 코드 블록 1개는 고치지 않았습니다.", kind: 'warning' });
        call(ctx, 'applyHistoryEntry')(mod, ctx.archived[0].entry);
        assert.deepStrictEqual(plain(mod.tabContents), tabsBefore, '그 기록으로 되돌리면 모든 탭이 돌아온다');
    });

    await run('코드 주석 넣기(이 교과): 차시마다 작업 기록 한 칸, 최종 평가는 문항 모드, 그사이 지운 차시는 건너뛰고 알린다', async () => {
        const ctx = appContext();
        const one = lessonOf({ id: 1, title: '1차시', tabs: { basicLearn: `## 1. 합계 (⏱ 30분)\n\n${PY('total = 0', 'print(total)')}` } });
        const two = lessonOf({ id: 2, title: '2차시', tabs: { basicPrac: `## 1. 실습 (⏱ 30분)\n\n${PY('print(2)')}` } });
        const three = lessonOf({ id: 3, title: '3차시', tabs: { basicLearn: '## 1. 글 (⏱ 30분)\n\n글뿐입니다.' } });
        const quest = { id: 'mainQuest', title: '최종 평가', status: 'done', images: {}, content: QUESTION_MD };
        const before = { one: plain(one.tabContents), quest: quest.content };
        openSubject(ctx, [one, two, three], { mainQuest: quest });
        ctx.ai = route(ctx, {
            comment: item => {
                if (callsOf(ctx, 'comment').length === 1) vm.runInContext('courseData = courseData.filter(lesson => lesson.id !== 2);', ctx); // 첫 차시를 넣는 동안 2차시를 지운다
                return commentReply()(item);
            }
        });
        await call(ctx, 'startCodeComments')('subject');
        assert.ok(ctx.estimates[0].message.startsWith("'파이썬 기초'의 차시 3개와 최종 평가에서 주석이 모자란 코드 블록 3개(고칠 차시 2개와 최종 평가)에 AI가 주석만 더합니다. 코드 줄은 한 글자도 바꾸지 않고, 바꾸는 차시마다 바꾸기 전 글을 작업 기록에 '코드 주석 넣기 전'으로 한 칸씩 남깁니다(작업 기록은 200개까지 두어 오래된 기록이 밀릴 수 있습니다). 오른쪽 아래 막대에서 언제든 멈출 수 있고, 멈추면 받은 데까지 저장합니다."), ctx.estimates[0].message);
        assert.ok(ctx.estimates[0].message.includes('최종 평가 문항의 코드에는'), '최종 평가는 문항 모드');
        assert.deepStrictEqual(callsOf(ctx, 'comment').map(item => item.quiz), [false, true], '지운 2차시는 부르지 않는다');
        assert.ok(two.tabContents.basicPrac.includes(PY('print(2)')) && !two.tabContents.basicPrac.includes(NOTE));
        assert.deepStrictEqual(ctx.archived.map(item => [item.mod, item.reason]), [[one, HISTORY_REASON], [quest, HISTORY_REASON]]);
        assert.ok(quest.content.includes(PY(`# ${NOTE}`, 'total = 0', `# ${NOTE}`, 'print(total)')), quest.content);
        assert.deepStrictEqual(ctx.steps.map(step => step.label), ['코드 주석 넣기 · 1차시', '코드 주석 넣기 · 2차시', '코드 주석 넣기 · 최종 평가']);
        assert.deepStrictEqual(ctx.toasts.at(-1), { message: "코드 주석 넣기를 마쳤습니다. 코드 블록 2개에 주석을 넣었습니다(차시 1개와 최종 평가). 바꾸기 전 글은 작업 기록에 '코드 주석 넣기 전'으로 남겼습니다. 그사이 지운 차시 1개에는 주석을 넣지 않았습니다.", kind: 'warning' });
        call(ctx, 'applyHistoryEntry')(one, ctx.archived[0].entry);
        call(ctx, 'applyHistoryEntry')(quest, ctx.archived[1].entry);
        assert.deepStrictEqual([plain(one.tabContents), quest.content], [before.one, before.quest], '기록으로 되돌린다');
    });

    await run('코드 주석 넣기(이 교과): 저장 실패·중지·같은 오류면 멈추고 받은 데까지 남기며, 넣는 동안 고친 탭은 쓰지 않는다', async () => {
        const two = () => [
            lessonOf({ id: 1, title: '1차시', tabs: { basicLearn: `## 1. 합계 (⏱ 30분)\n\n${PY('total = 0')}` } }),
            lessonOf({ id: 2, title: '2차시', tabs: { basicLearn: `## 1. 출력 (⏱ 30분)\n\n${PY('print(2)')}` } })
        ];
        const save = appContext();
        const [s1, s2] = two();
        openSubject(save, [s1, s2]);
        save.saveResult = false;
        save.ai = route(save, { comment: commentReply() });
        await call(save, 'startCodeComments')('subject');
        assert.deepStrictEqual([callsOf(save, 'comment').length, s2.tabContents.basicLearn.includes(NOTE)], [1, false], '저장하지 못하면 다음 차시로 가지 않는다');
        assert.deepStrictEqual(save.toasts.at(-1), { message: `저장하지 못해 코드 주석 넣기를 멈췄습니다. 마지막에 고친 차시는 아직 저장되지 않았습니다. ${call(save, 'SAVE_AGAIN_HINT')}`, kind: 'error' });
        const stop = appContext();
        const [t1, t2] = two();
        openSubject(stop, [t1, t2]);
        stop.ai = route(stop, { comment: item => { call(stop, 'requestLessonPipelineStop')(); return commentReply()(item); } });
        await call(stop, 'startCodeComments')('subject');
        assert.deepStrictEqual([callsOf(stop, 'comment').length, t1.tabContents.basicLearn.includes(`# ${NOTE}\ntotal = 0`), t2.tabContents.basicLearn.includes(NOTE)], [1, true, false], '받은 데까지 넣는다');
        assert.deepStrictEqual(stop.archived.length, 1);
        assert.deepStrictEqual(stop.toasts.at(-1), { message: '코드 주석 넣기를 멈췄습니다. 받은 데까지 넣고 저장했습니다(코드 블록 1개). 다시 누르면 남은 블록부터 이어서 합니다.', kind: 'warning' });
        const quota = appContext();
        const [u1, u2] = two();
        openSubject(quota, [u1, u2]);
        quota.ai = route(quota, { comment: () => { throw daily(); } });
        await call(quota, 'startCodeComments')('subject');
        assert.deepStrictEqual([callsOf(quota, 'comment').length, quota.archived.length], [1, 0], '같은 오류면 다음 차시를 부르지 않는다');
        assert.deepStrictEqual(quota.toasts.at(-1), { message: `코드 주석 넣기를 멈췄습니다. ${DAILY_MESSAGE} 넣은 데까지는 저장했습니다.`, kind: 'warning' });
        const busy = appContext();
        const [v1, v2] = two();
        openSubject(busy, [v1, v2]);
        busy.ai = route(busy, {
            comment: item => {
                if (callsOf(busy, 'comment').length === 1) call(busy, 'setTabMarkdown')(v1, 'basicLearn', `${v1.tabContents.basicLearn}\n\n손으로 더한 글입니다.`);
                return commentReply()(item);
            }
        });
        await call(busy, 'startCodeComments')('subject');
        assert.ok(v1.tabContents.basicLearn.endsWith('손으로 더한 글입니다.') && !v1.tabContents.basicLearn.includes(NOTE), '넣는 동안 고친 탭은 쓰지 않는다');
        assert.ok(v2.tabContents.basicLearn.includes(NOTE));
        assert.deepStrictEqual(busy.archived.map(item => item.mod), [v2]);
        assert.deepStrictEqual(busy.toasts.at(-1), { message: "코드 주석 넣기를 마쳤습니다. 코드 블록 1개에 주석을 넣었습니다(차시 1개). 바꾸기 전 글은 작업 기록에 '코드 주석 넣기 전'으로 남겼습니다. 넣는 동안 고친 탭 1개는 바꾸지 않았습니다.", kind: 'warning' });
    });

    await run('코드 주석 넣기(과정 전체): 모든 교과의 차시를 돌고 차시마다 기록을 남긴다', async () => {
        const ctx = appContext();
        const mine = lessonOf({ id: 1, title: '1차시', tabs: { basicLearn: `## 1. 합계 (⏱ 30분)\n\n${PY('total = 0')}` } });
        const theirs = lessonOf({ id: 1, title: '다른 교과 1차시', tabs: { basicPrac: `## 1. 실습 (⏱ 30분)\n\n${PY('print(1)')}` } });
        openSubject(ctx, [mine], { others: [{ id: 's2', title: '다른 교과', lessons: [theirs] }] });
        ctx.ai = route(ctx, { comment: commentReply() });
        await call(ctx, 'startCodeComments')('course');
        assert.ok(ctx.estimates[0].message.startsWith('과정 전체 교과 2개의 차시 2개에서 주석이 모자란 코드 블록 2개(고칠 차시 2개)에 AI가 주석만 더합니다.'), ctx.estimates[0].message);
        assert.ok(mine.tabContents.basicLearn.includes(NOTE) && theirs.tabContents.basicPrac.includes(NOTE));
        assert.deepStrictEqual(ctx.archived.map(item => item.mod), [mine, theirs]);
        assert.deepStrictEqual(ctx.toasts.at(-1).message, "코드 주석 넣기를 마쳤습니다. 코드 블록 2개에 주석을 넣었습니다(차시 2개). 바꾸기 전 글은 작업 기록에 '코드 주석 넣기 전'으로 남겼습니다.");
    });

    await run('코드 주석 넣기: 진행 중인 생성·키 없음·고칠 블록 없음·고정 섹션에만 남음·묻는 동안 교과가 바뀜이면 시작하지 않는다', async () => {
        const ctx = appContext();
        const mod = lessonOf({ tabs: { basicLearn: `## 1. 합계 (⏱ 30분)\n\n${PY('total = 0')}` } });
        openSubject(ctx, [mod]);
        ctx.ai = route(ctx, { comment: commentReply() });
        call(ctx, 'beginLessonPipeline')(1);
        await call(ctx, 'startCodeComments')('lesson');
        call(ctx, 'finishLessonPipeline')({ quiet: true });
        assert.strictEqual(ctx.alerts.at(-1), '진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
        ctx.hasKey = false;
        await call(ctx, 'startCodeComments')('lesson');
        assert.strictEqual(ctx.alerts.at(-1), '글 모델 키가 없어 코드 주석을 넣을 수 없습니다. 오른쪽 위 ⚙ 설정에서 키를 넣어 주세요.');
        ctx.hasKey = true;
        ctx.onConfirm = () => vm.runInContext("currentSubjectId = 's9';", ctx);
        await call(ctx, 'startCodeComments')('lesson');
        assert.deepStrictEqual(ctx.toasts.at(-1), { message: '묻는 동안 교과가 바뀌어 코드 주석을 넣지 않았습니다.', kind: 'warning' });
        ctx.onConfirm = null;
        ctx.confirmAnswer = false;
        vm.runInContext("currentSubjectId = 's1';", ctx);
        await call(ctx, 'startCodeComments')('lesson');
        assert.deepStrictEqual([callsOf(ctx, 'comment').length, ctx.estimates.length, mod.tabContents.basicLearn.includes(NOTE)], [0, 2, false], '취소하면 하지 않는다');
        const done = appContext();
        openSubject(done, [lessonOf({ tabs: { basicLearn: `## 1. 합계 (⏱ 30분)\n\n${PY('# 이미 있습니다', 'total = 0')}` } })]);
        await call(done, 'startCodeComments')('lesson');
        assert.deepStrictEqual([done.toasts.at(-1), done.estimates.length], [{ message: '주석이 모자란 코드 블록이 없습니다.', kind: 'success' }, 0]);
        const held = appContext();
        openSubject(held, [lessonOf({ tabs: { basicLearn: `## 고정 (⏱ 10분)\n\n${PY('total = 0')}` }, lockedSections: { basicLearn: ['고정'] } })]);
        await call(held, 'startCodeComments')('lesson');
        assert.deepStrictEqual([held.toasts.at(-1), held.estimates.length], [{ message: '주석이 모자란 코드 블록은 고정 섹션에만 있어 고치지 않습니다.', kind: 'info' }, 0]);
    });

    /* ---------- 차시를 열 때 한 번 알림 ---------- */
    await run('차시를 열 때: 주석이 모자란 코드 블록이 있으면 차시마다 한 번 알리고, 생성 중에는 세지 않는다', async () => {
        const ctx = appContext();
        const one = lessonOf({ id: 1, lockedSections: { basicLearn: ['고정'] }, tabs: { basicLearn: `## 1. 합계 (⏱ 30분)\n\n${PY('total = 0')}\n\n## 고정 (⏱ 10분)\n\n${PY('print(1)')}`, basicPrac: `## 1. 실습 (⏱ 30분)\n\n${PY('print(2)')}` } });
        const two = lessonOf({ id: 2, tabs: { basicPrac: `## 1. 실습 (⏱ 30분)\n\n${PY('print(3)')}` } });
        const clean = lessonOf({ id: 3, tabs: { basicPrac: '## 1. 글 (⏱ 30분)\n\n글뿐입니다.' } });
        openSubject(ctx, [one, two, clean]);
        const note = count => ({ message: `이 차시에 주석이 모자란 코드 블록이 ${count}개 있습니다. 도구의 '코드 주석 넣기'를 누르면 코드는 그대로 두고 주석만 더합니다.`, kind: 'warning' });
        call(ctx, 'noteCodeCommentGaps')(one);
        call(ctx, 'noteCodeCommentGaps')(one);
        assert.deepStrictEqual(ctx.toasts, [note(2)], '한 번만, 고정 섹션의 블록은 세지 않는다');
        call(ctx, 'beginLessonPipeline')(2);
        call(ctx, 'noteCodeCommentGaps')(two);
        call(ctx, 'finishLessonPipeline')({ quiet: true });
        assert.strictEqual(ctx.toasts.length, 1, '생성 중에는 알리지 않는다');
        call(ctx, 'noteCodeCommentGaps')(two);
        call(ctx, 'noteCodeCommentGaps')(clean);
        assert.deepStrictEqual(ctx.toasts, [note(2), note(1)], '생성이 끝난 뒤에는 알린다');
        const badge = appContext();
        const mod = lessonOf({ tabs: { basicPrac: `## 1. 실습 (⏱ 30분)\n\n${PY('print(2)')}` } });
        openSubject(badge, [mod]);
        badge.elements['convention-check-count'] = fakeElement();
        call(badge, 'syncReviewBadge')(mod);
        call(badge, 'syncReviewBadge')(mod);
        assert.deepStrictEqual(badge.toasts, [note(1)], '차시를 열면(검수 배지를 셀 때) 알린다');
    });

    finish();
})();
