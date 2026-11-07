// 코드 주석 연결의 안전 테스트 (실행: node tests/code-comments-safety.test.js)
// '코드 주석 넣기'가 넣는 동안 바뀐 글(앞에서 받은 탭·슬라이드 화면 편집본·지운 차시)을 덮지 않는지, 교수안·편성안을 고치지 않는지,
// 섹션 고치기가 코드가 바뀐 답을 받지 않는지, 정보 지적·고정 섹션 안내·최종 평가 세기·교수안 원고 표시·분량 채우기 예고·고른 글 고치기를 실제 파일로 확인한다.
// 실행 환경(가짜 AI·화면 흉내)은 tests/code-comments-harness.js에 있다. 키는 가짜 값만 쓰고 찍지 않는다.
const {
    vm, assert, source, plain, reply, NOTE, HISTORY_REASON, PY, fakeElement, route, commentReply, callsOf,
    appContext, call, lessonOf, openSubject, onlyComments, needsOf, PRAC_DRAFT, LEARN_GOALS, QUESTION_MD, runner
} = require('./code-comments-harness');

const { run, finish } = runner();
const QUIZ_RULE = '문항 속 코드(문제 글·보기·시작 코드)에도 한국어 주석을 넣습니다. 주석은 코드가 무엇을 하는지만 적고 정답, 출력 결과, 고칠 곳을 알려 주지 않습니다. 시작 코드에는 학습자가 채울 자리마다 무엇을 채울지 주석으로 적습니다.';
const FIX_CODE_LINE = '코드 블록은 주석을 포함해 한 글자도 바꾸지 않습니다(주석은 따로 넣습니다).';
const STALE_NOTE = '⚠️ 교안이 바뀌었습니다. 교수안을 다시 생성하면 반영됩니다.';
const SUM_CODE = ['total = 0', 'for n in [1, 2, 3]:', '    total += n', 'print(total)'];
// 다른 차시를 지칭하는 필수 지적('앞에서')과 주석 없는 코드 블록이 함께 든 섹션
const PHRASE_SECTION = ['## 1. 합계 구하기 (⏱ 30분)', '', '앞에서 다룬 반복문으로 합계를 구합니다.', '', PY(...SUM_CODE)].join('\n');
const fixedSection = (...code) => ['## 1. 합계 구하기 (⏱ 30분)', '', '반복문으로 합계를 구합니다.', '', PY(...code)].join('\n');
const gyosuanOf = extra => ({ docMd: '# 교수안 - 반복문\n\n## 진행\n\n### 전개 1 - 합계\n\n**설명 내용**: 합계를 구한다.', deckMd: '', deckHtml: null, sessionDecks: {}, deckDirty: false, deckRev: 1, images: {}, ...extra });
const sourceKey = (ctx, mod, track = 'basic') => call(ctx, 'hashSource')(call(ctx, 'collectLessonSource')(mod, track));

(async () => {
    /* ---------- 코드 주석 넣기: 넣는 동안 바뀐 글 ---------- */
    await run('코드 주석 넣기: 교수안·편성안은 고치지 않아, 넣는 동안 슬라이드 화면에서 저장한 편집본이 남는다', async () => {
        const ctx = appContext();
        const DOC = ['# 교수안 - 반복문', '', '## 진행', '', '### 전개 1 - 합계 시연', '', '**강사 활동**: 다음 코드를 시연한다.', '', PY(...SUM_CODE)].join('\n');
        const DECK = ['## 슬라이드 편성', '', '### 슬라이드 1 - 합계', '- 슬라이드 문구:', '  - 합계를 구합니다', PY('y = 2'), '- 핵심 메시지: 반복으로 더한다'].join('\n');
        const mod = lessonOf({ tabs: { basicPrac: `## 1. 실습 (⏱ 30분)\n\n${PY('name = input()', 'print(name)')}` }, gyosuan: gyosuanOf({ docMd: DOC, deckMd: DECK, deckRev: 3 }) });
        const before = plain(mod.gyosuan);
        openSubject(ctx, [mod]);
        let studioSaved = null;
        ctx.ai = route(ctx, {
            comment: item => {
                if (studioSaved === null) studioSaved = call(ctx, 'saveSlideStudioHtml')(1, '<section>스튜디오에서 고친 슬라이드</section>', { rev: 3 });
                return commentReply()(item);
            }
        });
        await call(ctx, 'startCodeComments')('lesson');
        assert.strictEqual(studioSaved, true, '넣는 동안 슬라이드 화면이 저장했다');
        assert.deepStrictEqual(plain(mod.gyosuan), { ...before, deckHtml: '<section>스튜디오에서 고친 슬라이드</section>' }, '화면 편집본이 남고 교수안·편성안·덱 번호는 그대로');
        assert.deepStrictEqual([callsOf(ctx, 'comment').length, mod.tabContents.basicPrac.includes(NOTE)], [1, true], '탭에만 넣는다');
        const asked = ctx.estimates[0].message;
        assert.ok(asked.startsWith("이 차시의 탭 1개에서 주석이 모자란 코드 블록 1개에 AI가 주석만 더합니다. 코드 줄은 한 글자도 바꾸지 않고(코드가 바뀐 답은 버립니다), 바꾸기 전 글은 작업 기록에 '코드 주석 넣기 전'으로 남깁니다."), asked);
        assert.ok(!/교수안|편성안/.test(asked), asked);
        assert.deepStrictEqual(ctx.toasts.at(-1), { message: "코드 주석 넣기를 마쳤습니다. 코드 블록 1개에 주석을 넣었습니다. 바꾸기 전 글은 작업 기록에 '코드 주석 넣기 전'으로 남겼습니다.", kind: 'success' });
        // 교수안에만 주석이 모자란 블록이 있으면 묻지도 기록을 남기지도 않는다(작업 기록에 남겼다고 알리지 않는다)
        const only = appContext();
        const docOnly = lessonOf({ tabs: { basicLearn: '## 1. 글 (⏱ 30분)\n\n글뿐입니다.' }, gyosuan: gyosuanOf({ docMd: `# 교수안\n\n${PY('x = 1', 'print(x)')}` }) });
        const docBefore = docOnly.gyosuan.docMd;
        openSubject(only, [docOnly]);
        only.ai = route(only, {});
        await call(only, 'startCodeComments')('lesson');
        assert.deepStrictEqual([only.estimates.length, only.archived.length, only.calls.length, docOnly.gyosuan.docMd], [0, 0, 0, docBefore]);
        assert.deepStrictEqual(only.toasts.at(-1), { message: '주석이 모자란 코드 블록이 없습니다.', kind: 'success' });
        call(only, 'noteCodeCommentGaps')(docOnly);
        assert.strictEqual(only.toasts.length, 1, '차시를 열 때도 교수안은 세지 않는다');
    });

    await run('코드 주석 넣기: 앞에서 받은 탭을 넣는 동안 고쳤거나 원문 칸에서 고치는 중이면 그 탭은 쓰지 않고 알린다', async () => {
        const ctx = appContext();
        const learn = `## 1. 합계 (⏱ 30분)\n\n합계를 구합니다.\n\n${PY('total = 0', 'print(total)')}`;
        const prac = `## 1. 실습 (⏱ 30분)\n\n${PY('name = input()', 'print(name)')}`;
        const mod = lessonOf({ tabs: { basicLearn: learn, basicPrac: prac, assessment: QUESTION_MD } });
        openSubject(ctx, [mod]);
        const edited = `${learn}\n\n손으로 더한 기본학습 문단입니다.`;
        const typed = `${prac}\n\n원문 칸에서 고치는 중인 글입니다.`;
        const raw = fakeElement();
        raw.dataset = { moduleId: '1', tabId: 'basicPrac' };
        let n = 0;
        ctx.ai = route(ctx, {
            comment: item => {
                n += 1;
                // 둘째 호출(기본실습)을 기다리는 동안 이미 받은 기본학습을 고쳐 저장했다(원문 칸 저장과 같은 setTabMarkdown)
                if (n === 2) call(ctx, 'setTabMarkdown')(mod, 'basicLearn', edited);
                // 셋째 호출(학습이해도)을 기다리는 동안 이미 받은 기본실습을 원문 칸에서 고치는 중이다(아직 넣지 않았다)
                if (n === 3) {
                    ctx.elements['raw-view'] = raw;
                    ctx.saveRawContent = () => call(ctx, 'setTabMarkdown')(mod, 'basicPrac', typed);
                }
                return commentReply()(item);
            }
        });
        await call(ctx, 'startCodeComments')('lesson');
        assert.strictEqual(n, 3);
        assert.deepStrictEqual([mod.tabContents.basicLearn, mod.tabContents.basicPrac], [edited, typed], '고친 글을 옛 글에 주석만 단 글로 덮지 않는다');
        onlyComments(ctx, QUESTION_MD, mod.tabContents.assessment);
        assert.ok(mod.tabContents.assessment.includes(NOTE));
        assert.deepStrictEqual([ctx.archived.map(item => item.reason), mod.history[0].note], [[HISTORY_REASON], '코드 주석 넣기 (코드 블록 1개)']);
        assert.deepStrictEqual(ctx.toasts.at(-1), { message: "코드 주석 넣기를 마쳤습니다. 코드 블록 1개에 주석을 넣었습니다. 바꾸기 전 글은 작업 기록에 '코드 주석 넣기 전'으로 남겼습니다. 넣는 동안 고친 탭 2개는 바꾸지 않았습니다.", kind: 'warning' });
    });

    await run('코드 주석 넣기: 그사이 지운 차시는 AI가 답을 버렸다고 알리지 않고 지웠다고 알린다', async () => {
        const ctx = appContext();
        const one = lessonOf({ id: 1, title: '1차시', tabs: { basicPrac: `## 1. 실습 (⏱ 30분)\n\n${PY('print(1)')}` } });
        const two = lessonOf({ id: 2, title: '2차시', tabs: { basicPrac: '## 1. 글 (⏱ 30분)\n\n글뿐입니다.' } });
        openSubject(ctx, [one, two]);
        ctx.ai = route(ctx, {
            comment: item => {
                vm.runInContext('courseData = courseData.filter(lesson => lesson.id !== 1); globalState.subjects[0].lessons = courseData;', ctx); // 기다리는 동안 1차시를 휴지통으로 옮긴다
                return commentReply()(item);
            }
        });
        await call(ctx, 'startCodeComments')('lesson');
        assert.deepStrictEqual([ctx.archived.length, one.tabContents.basicPrac.includes(NOTE)], [0, false]);
        assert.deepStrictEqual(ctx.toasts.at(-1), { message: '그사이 이 차시를 지워 주석을 넣지 않았습니다.', kind: 'warning' });
    });

    await run('코드 주석 넣기(교과·과정): 최종 평가는 차시로 세지 않고 따로 적으며, 최종 평가를 열고 누르면 이 최종 평가라고 한다', async () => {
        const quiz = () => ({ id: 'mainQuest', title: '최종 평가', status: 'done', images: {}, content: QUESTION_MD });
        const lessons = () => [
            lessonOf({ id: 1, title: '1차시', tabs: { basicLearn: `## 1. 합계 (⏱ 30분)\n\n${PY('total = 0', 'print(total)')}` } }),
            lessonOf({ id: 2, title: '2차시', tabs: { basicLearn: '## 1. 글 (⏱ 30분)\n\n글뿐입니다.' } }),
            lessonOf({ id: 3, title: '3차시', tabs: { basicLearn: '## 1. 글 (⏱ 30분)\n\n글뿐입니다.' } })
        ];
        const ctx = appContext();
        const quest = quiz();
        const [one] = openSubject(ctx, lessons(), { mainQuest: quest }).lessons;
        ctx.ai = route(ctx, { comment: commentReply() });
        await call(ctx, 'startCodeComments')('subject');
        assert.ok(ctx.estimates[0].message.startsWith("'파이썬 기초'의 차시 3개와 최종 평가에서 주석이 모자란 코드 블록 2개(고칠 차시 1개와 최종 평가)에 AI가 주석만 더합니다."), ctx.estimates[0].message);
        assert.ok(one.tabContents.basicLearn.includes(NOTE) && quest.content.includes(NOTE));
        assert.deepStrictEqual(ctx.toasts.at(-1), { message: "코드 주석 넣기를 마쳤습니다. 코드 블록 2개에 주석을 넣었습니다(차시 1개와 최종 평가). 바꾸기 전 글은 작업 기록에 '코드 주석 넣기 전'으로 남겼습니다.", kind: 'success' });
        const course = appContext();
        openSubject(course, lessons(), { mainQuest: quiz() });
        course.ai = route(course, { comment: commentReply() });
        await call(course, 'startCodeComments')('course');
        assert.ok(course.estimates[0].message.startsWith('과정 전체 교과 1개의 차시 3개와 최종 평가 1개에서 주석이 모자란 코드 블록 2개(고칠 차시 1개와 최종 평가 1개)에'), course.estimates[0].message);
        assert.ok(course.toasts.at(-1).message.startsWith('코드 주석 넣기를 마쳤습니다. 코드 블록 2개에 주석을 넣었습니다(차시 1개와 최종 평가 1개).'), course.toasts.at(-1).message);
        // 최종 평가를 열고 도구의 '코드 주석 넣기'를 누른다
        const fin = appContext();
        const quest2 = quiz();
        openSubject(fin, [lessonOf({ tabs: { basicLearn: '## 1. 글 (⏱ 30분)\n\n글뿐입니다.' } })], { mainQuest: quest2 });
        vm.runInContext("currentEditingModuleId = 'mainQuest';", fin);
        call(fin, 'noteCodeCommentGaps')(quest2);
        assert.deepStrictEqual(fin.toasts.at(-1), { message: "이 최종 평가에 주석이 모자란 코드 블록이 1개 있습니다. 도구의 '코드 주석 넣기'를 누르면 코드는 그대로 두고 주석만 더합니다.", kind: 'warning' });
        fin.confirmAnswer = false;
        await call(fin, 'startCodeComments')('lesson');
        assert.ok(fin.estimates[0].message.startsWith('이 최종 평가에서 주석이 모자란 코드 블록 1개에 AI가 주석만 더합니다.'), fin.estimates[0].message);
    });

    /* ---------- 교수안 원고 표시 ---------- */
    await run('교수안: 탭에 주석만 더했으면 교수안을 다시 만들라고 하지 않고, 다른 글이 바뀌었거나 이미 어긋난 교수안은 그대로 알린다', async () => {
        const ctx = appContext();
        vm.runInContext(source('gyosuan-view.js'), ctx); // 교수안 화면 안내 문구(gyosuanNoteText)
        const mod = lessonOf({ tabs: { basicLearn: `## 1. 합계 (⏱ 30분)\n\n합계를 구합니다.\n\n${PY('total = 0', 'print(total)')}`, advLearn: `## 1. 심화 (⏱ 30분)\n\n심화입니다.\n\n${PY('x = 1')}` } });
        mod.gyosuan = gyosuanOf({ sourceKey: sourceKey(ctx, mod, 'basic') });
        mod.gyosuanAdv = gyosuanOf({ sourceKey: 'old-key' }); // 이미 교안이 바뀐 심화 교수안
        openSubject(ctx, [mod]);
        const note = track => call(ctx, 'gyosuanNoteText')(mod, track);
        assert.ok(!note('basic').startsWith('⚠️'), note('basic'));
        ctx.ai = route(ctx, { comment: commentReply() });
        await call(ctx, 'startCodeComments')('lesson');
        assert.ok(mod.tabContents.basicLearn.includes(NOTE) && mod.tabContents.advLearn.includes(NOTE));
        assert.strictEqual(mod.gyosuan.sourceKey, sourceKey(ctx, mod, 'basic'), '주석만 더한 원고로 맞춘다');
        assert.ok(!note('basic').startsWith('⚠️'), note('basic'));
        assert.deepStrictEqual([mod.gyosuanAdv.sourceKey, note('adv')], ['old-key', STALE_NOTE], '이미 어긋난 교수안은 그대로');
        // AI 수정 제안으로 주석만 더해도 맞추고, 탭 전체 AI 수정으로 글이 바뀌면 맞추지 않는다
        const fix = appContext();
        const mod2 = lessonOf({ tabs: { basicPrac: PRAC_DRAFT } });
        mod2.gyosuan = gyosuanOf({ sourceKey: sourceKey(fix, mod2) });
        openSubject(fix, [mod2]);
        vm.runInContext("currentLessonTab = 'basicPrac';", fix);
        fix.ai = route(fix, { comment: commentReply(), other: () => reply(`${PRAC_DRAFT}\n\n## 3. 정리 (⏱ 10분)\n\n새로 더한 글입니다.`) });
        call(fix, 'runConventionCheck')(1);
        await call(fix, 'proposeLessonFix')();
        assert.ok(mod2.tabContents.basicPrac.includes(NOTE));
        assert.strictEqual(mod2.gyosuan.sourceKey, sourceKey(fix, mod2), 'AI 수정 제안(주석만)');
        const kept = mod2.gyosuan.sourceKey;
        await call(fix, 'reinforceCurrentTab')(1, '정리 섹션을 더해 줘');
        assert.ok(mod2.tabContents.basicPrac.includes('새로 더한 글입니다.'));
        assert.deepStrictEqual([mod2.gyosuan.sourceKey === kept, kept === sourceKey(fix, mod2)], [true, false], '글이 바뀌면 다시 만들라고 둔다');
    });

    /* ---------- 섹션 고치기(생성 직후 자동 수정·AI 수정 제안) ---------- */
    await run('자동 수정: 코드 줄을 바꾼 섹션 답은 받지 않고(주석 지적은 나아졌는지 셀 때도 뺀다), 지시는 코드 블록을 주석까지 그대로 두게 한다', async () => {
        // 탭 생성: 다른 필수 지적은 못 고치고 코드 값을 바꾸며 주석을 단 답
        const ctx = appContext();
        const mod = lessonOf({ tabs: {} });
        openSubject(ctx, [mod]);
        const DRAFT = [PHRASE_SECTION, '', '## 2. 결과 확인 (⏱ 20분)', '', '결과를 확인합니다.', '', '```text', '6', '```'].join('\n');
        const changed = PHRASE_SECTION.replace(PY(...SUM_CODE), PY('# 합계를 구합니다', 'total = 100  # 시작 값', 'for n in [1, 2, 3]:  # 하나씩 돕니다', '    total += n  # 더합니다', 'print(total)  # 출력합니다'));
        ctx.ai = route(ctx, { tab: () => reply(DRAFT), fix: () => reply(changed), comment: commentReply() });
        await call(ctx, 'generateTabContent')(1, 'basicPrac');
        const saved = mod.tabContents.basicPrac;
        assert.deepStrictEqual(ctx.calls.map(item => item.kind), ['tab', 'fix', 'comment']);
        assert.ok(!saved.includes('total = 100') && saved.includes(PY(`# ${NOTE}`, 'total = 0', `# ${NOTE}`, 'for n in [1, 2, 3]:', `    # ${NOTE}`, '    total += n', `# ${NOTE}`, 'print(total)')), saved);
        assert.ok(!ctx.toasts.some(toast => toast.message === '컨벤션 필수 지적을 자동으로 고쳤습니다.'), JSON.stringify(ctx.toasts));
        const fixCall = callsOf(ctx, 'fix')[0];
        assert.ok(fixCall.user.includes(`- 이미지 태그(<!-- [IMG: ... ] -->), <img>, <div>, <table>, mermaid는 바꾸지 않고, ${FIX_CODE_LINE}`), fixCall.user);
        assert.ok(fixCall.system.includes('[코드 예제 규칙]'), '새로 쓰는 코드 블록은 코드 예제 규칙을 따른다');
        // 지적은 고쳤지만 코드 값을 바꾼 답도 받지 않는다
        const auto = appContext();
        auto.ai = route(auto, { fix: () => reply(fixedSection('# 합계를 구합니다', 'total = 10  # 시작값', 'for n in [1, 2, 3]:', '    total += n  # 하나씩 더합니다', 'print(total)')) });
        assert.strictEqual(await call(auto, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md: PHRASE_SECTION }), PHRASE_SECTION);
        // 지적을 고치고 코드는 그대로 둔 채 주석만 더한 답은 받는다
        const good = fixedSection('# 합계를 구합니다', 'total = 0  # 시작값', 'for n in [1, 2, 3]:', '    total += n  # 하나씩 더합니다', 'print(total)');
        auto.ai = route(auto, { fix: () => reply(good) });
        assert.strictEqual(await call(auto, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md: PHRASE_SECTION }), good);
        // 섹션 병합: 원래 코드 블록을 지키면 새 코드 블록을 더한 답은 받고, 원래 블록을 지운 답은 받지 않는다
        const merge = call(auto, 'mergeFixedSections');
        const targets = () => call(auto, 'pickFixSections')(PHRASE_SECTION, call(auto, 'lintLessonMarkdown')(PHRASE_SECTION, 'basicPrac', { codeComments: false })).targets;
        const added = `${fixedSection(...SUM_CODE)}\n\n하나 더 봅니다.\n\n${PY('print(len([1, 2, 3]))')}`;
        assert.strictEqual(merge(PHRASE_SECTION, added, targets()), added);
        assert.strictEqual(merge(PHRASE_SECTION, `${fixedSection('print(6)')}\n\n합계를 구하는 반복문을 설명합니다. 반복문으로 합계를 구합니다.`, targets()), PHRASE_SECTION);
    });

    await run('AI 수정 제안: 최종 평가의 섹션 고치기는 문항 속 코드 주석 규칙을 받고, 주석이 모자란 블록이 고정 섹션에만 있으면 안내에 적는다', async () => {
        const ctx = appContext();
        const quest = { id: 'mainQuest', title: '최종 평가', status: 'done', images: {}, content: PHRASE_SECTION };
        openSubject(ctx, [lessonOf({ tabs: { basicLearn: '## 1. 글 (⏱ 30분)\n\n글뿐입니다.' } })], { mainQuest: quest });
        vm.runInContext("currentEditingModuleId = 'mainQuest';", ctx);
        ctx.ai = route(ctx, { fix: () => reply(fixedSection(...SUM_CODE)), comment: commentReply() });
        call(ctx, 'runConventionCheck')('mainQuest');
        await call(ctx, 'proposeLessonFix')();
        assert.ok(callsOf(ctx, 'fix')[0].system.includes(`\n- ${QUIZ_RULE}`), callsOf(ctx, 'fix')[0].system);
        assert.deepStrictEqual(callsOf(ctx, 'comment').map(item => item.quiz), [true]);
        const review = call(ctx, 'reviewSystemPrompt');
        assert.ok(!review('basicLearn').includes(QUIZ_RULE) && review('basicLearn', true).includes(QUIZ_RULE));
        assert.strictEqual(review('assessment', true), review('assessment'), '문제은행 탭은 문항 규칙에 이미 있다');
        // 최종 평가의 탭 전체 AI 수정도 문항 주석 규칙을 받는다
        ctx.calls.length = 0;
        ctx.ai = route(ctx, { other: () => reply(`${quest.content}\n\n## 시작 코드\n\n시작 코드입니다.\n\n${PY('total = 0')}`), comment: commentReply() });
        await call(ctx, 'reinforceCurrentTab')('mainQuest', '시작 코드를 더해 줘');
        assert.ok(callsOf(ctx, 'other')[0].system.endsWith(`\n- ${QUIZ_RULE}`), callsOf(ctx, 'other')[0].system.slice(-300));
        assert.deepStrictEqual(callsOf(ctx, 'comment').map(item => item.quiz), [true]);
        // 일반 차시의 섹션 고치기에는 붙이지 않는다
        const plainCtx = appContext();
        openSubject(plainCtx, [lessonOf({ tabs: { basicLearn: PHRASE_SECTION } })]);
        plainCtx.ai = route(plainCtx, { fix: () => reply(fixedSection(...SUM_CODE)), comment: commentReply() });
        call(plainCtx, 'runConventionCheck')(1);
        await call(plainCtx, 'proposeLessonFix')();
        assert.ok(!callsOf(plainCtx, 'fix')[0].system.includes(QUIZ_RULE));
        // 섹션 지적은 고치고, 주석이 모자란 블록은 고정 섹션에만 있다(주석 호출 없음)
        const held = appContext();
        const md = ['## 1. 합계 (⏱ 30분)', '', '앞에서 다룬 반복문으로 합계를 구합니다.', '', '## 고정 예제 (⏱ 10분)', '', '고정한 예제입니다.', '', PY('print(1)')].join('\n');
        const mod = lessonOf({ tabs: { basicPrac: md }, lockedSections: { basicPrac: ['고정 예제'] } });
        openSubject(held, [mod]);
        vm.runInContext("currentLessonTab = 'basicPrac';", held);
        held.ai = route(held, { fix: () => reply('## 1. 합계 (⏱ 30분)\n\n반복문으로 합계를 구합니다.'), comment: commentReply() });
        call(held, 'runConventionCheck')(1);
        await call(held, 'proposeLessonFix')();
        assert.deepStrictEqual(held.calls.map(item => item.kind), ['fix']);
        assert.strictEqual(held.previews[0].opts.note, '고정 섹션의 코드 블록 1개는 고치지 않았습니다.');
    });

    await run('검수: 이름표를 몰라 세지 못한 블록(정보)은 권장으로 세지 않고 따로 보이며, 그것만 있으면 AI 수정 제안을 켜지 않고 알린다', async () => {
        const ctx = appContext();
        const md = ['## 1. 게임 루프 (⏱ 30분)', '', '게임 루프를 의사코드로 보입니다.', '', '```pseudocode', 'WHILE 게임이 끝나지 않음', '    입력을 읽음', 'END WHILE', '```'].join('\n');
        const mod = lessonOf({ title: '게임 루프', tabs: { basicPrac: md } });
        openSubject(ctx, [mod]);
        vm.runInContext("currentLessonTab = 'basicPrac';", ctx);
        const issues = call(ctx, 'lintLessonMarkdown')(md, 'basicPrac', call(ctx, 'lessonLintContext')(mod, 'basicPrac'));
        assert.deepStrictEqual(plain(issues).map(issue => [issue.sev, issue.msg]), [['info', '이름표를 몰라 주석을 확인하지 못한 코드 블록입니다.']]);
        assert.deepStrictEqual(plain(call(ctx, 'lintCounts')(issues)), { required: 0, recommended: 0 });
        const html = call(ctx, 'reviewIssuesHtml')(issues, 'basicPrac', md, mod);
        assert.ok(!html.includes('권장') && html.includes('정보 1건') && html.includes('이름표를 몰라 주석을 확인하지 못한 코드 블록입니다.'), html);
        assert.ok(html.includes('콘텐츠 업무 설계 규칙에 어긋난 곳이 없습니다.'), '고칠 지적은 없다');
        assert.ok(/data-review-action="fix" disabled/.test(call(ctx, 'reviewPanelHtml')(mod, 'basicPrac', md, false)), 'AI 수정 제안은 꺼진다');
        ctx.elements['convention-check-count'] = fakeElement();
        call(ctx, 'syncReviewBadge')(mod);
        assert.strictEqual(ctx.elements['convention-check-count'].textContent, '통과');
        ctx.ai = route(ctx, {});
        call(ctx, 'runConventionCheck')(1);
        await call(ctx, 'proposeLessonFix')();
        assert.deepStrictEqual([ctx.calls.length, ctx.previews.length], [0, 0], '바뀐 것 없는 미리보기를 열지 않는다');
        assert.strictEqual(ctx.alerts.at(-1), '고칠 수 있는 지적이 없습니다. 이름표를 몰라 세지 못한 코드 블록은 원문에서 언어 이름을 적어 주세요.');
    });

    await run('검수 창·배지·미리보기 머리말: 주석이 모자란 블록을 필수로 보이고, 주석을 넣으면 사라진다', async () => {
        const ctx = appContext();
        const mod = lessonOf({ tabs: { basicPrac: PRAC_DRAFT } });
        openSubject(ctx, [mod]);
        vm.runInContext("currentLessonTab = 'basicPrac';", ctx);
        const issues = call(ctx, 'lintLessonMarkdown')(PRAC_DRAFT, 'basicPrac', call(ctx, 'lessonLintContext')(mod, 'basicPrac'));
        const html = call(ctx, 'reviewIssuesHtml')(issues, 'basicPrac', PRAC_DRAFT, mod);
        const required = html.slice(html.indexOf('필수 1건'), html.indexOf('</section>', html.indexOf('필수 1건')));
        assert.ok(required.includes('<b>1. 합계 구하기 (⏱ 30분)</b> · 코드 블록에 주석을 넣습니다.') && required.includes('total = 0 · 코드 4줄에 주석 0개(1개 필요)'), html);
        ctx.elements['convention-check-count'] = fakeElement();
        call(ctx, 'syncReviewBadge')(mod);
        assert.strictEqual(ctx.elements['convention-check-count'].textContent, '필수 1 · 권장 0');
        ctx.ai = route(ctx, { comment: commentReply() });
        const commented = (await call(ctx, 'addGeneratedCodeComments')({ md: PRAC_DRAFT, tabId: 'basicPrac', notify: false })).md;
        assert.strictEqual(call(ctx, 'lintDeltaLabel')(PRAC_DRAFT, commented, 'basicPrac'), '검수 지적 필수 1 → 0 · 권장 0 → 0', '미리보기 머리말(진짜 lintDeltaLabel)');
        call(ctx, 'setTabMarkdown')(mod, 'basicPrac', commented);
        call(ctx, 'syncReviewBadge')(mod);
        assert.strictEqual(ctx.elements['convention-check-count'].textContent, '통과');
    });

    /* ---------- 분량 채우기 예고 ---------- */
    await run('분량 채우기: 예고에 늘린 뒤 주석 단계 호출(있던 블록과 새 소주제 몫)을 세고, 묻는 글에 적는다', async () => {
        const ctx = appContext();
        const blocks = Array.from({ length: 40 }, (_, i) => `## ${i + 2}. 예제 ${i + 1} (⏱ 10분)\n\n예제 ${i + 1}을 살펴봅니다.\n\n${PY(`v${i} = ${i}`, `print(v${i})`)}`);
        const before = [LEARN_GOALS, '', ...blocks].join('\n');
        openSubject(ctx, [lessonOf({ tabs: { basicLearn: before } })]);
        ctx.confirmAnswer = false;
        await call(ctx, 'fillLessonVolume')(1, 'basicLearn');
        const { work, message } = ctx.estimates[0];
        const old = call(ctx, 'codeCommentPreview')(before).calls;
        const fill = work.volumeCalls - call(ctx, 'VOLUME_FIX_ROUNDS');
        assert.strictEqual(old, 5);
        assert.strictEqual(work.codeComments, old + Math.ceil(fill * call(ctx, 'VOLUME_SUBTOPICS_MAX') / call(ctx, 'CODE_COMMENT_BATCH_BLOCKS')), JSON.stringify(work));
        assert.ok(message.includes('컨벤션 필수 지적이 남은 섹션은 AI가 고쳐 쓸 수 있습니다. 주석이 모자란 코드 블록에는 주석만 더하며, 이미 있던 블록도 함께 보아 AI 호출이 더 들 수 있습니다. 끝나면 바뀐 섹션을 골라 반영하고'), message);
        // 코드를 다루지 않는 차시의 코드 없는 탭은 세지 않는다
        const plainCtx = appContext();
        openSubject(plainCtx, [lessonOf({ title: '게임 기획 개론', description: '기획 문서를 씁니다.', tabs: { basicLearn: `${LEARN_GOALS.replace('반복문으로 합계를 구하는 코드를 작성할', '기획 문서의 목차를 정리할')}\n\n## 1. 기획 (⏱ 30분)\n\n기획 문서를 씁니다.` } })]);
        plainCtx.confirmAnswer = false;
        await call(plainCtx, 'fillLessonVolume')(1, 'basicLearn');
        assert.ok(!('codeComments' in plainCtx.estimates[0].work), JSON.stringify(plainCtx.estimates[0].work));
    });

    /* ---------- 고른 글 AI 고치기 ---------- */
    await run('고른 글 고치기: 고른 글이 코드 블록으로 끝나거나 코드 블록뿐이면 답의 펜스를 지키고, 답 전체를 감싼 펜스만 벗긴다', () => {
        const ctx = appContext();
        const strip = call(ctx, 'editAnswerText');
        const code = PY('total = 0', 'print(total)');
        const answer = PY('# 합계를 구해 출력합니다', 'total = 0  # 합계의 시작값', 'print(total)  # 합계를 출력합니다');
        assert.strictEqual(strip(`합계를 구하는 코드입니다.\n\n${answer}`, `합계를 구하는 코드입니다.\n\n${code}`), `합계를 구하는 코드입니다.\n\n${answer}`, '코드 블록으로 끝나는 글');
        assert.strictEqual(strip(answer, code), answer, '코드 블록뿐인 글');
        assert.strictEqual(strip('```\n고친 글입니다.\n```', '고칠 글입니다.'), '고친 글입니다.', '답 전체를 감싼 펜스');
        assert.strictEqual(strip('```text\n고친 글입니다.\n```', '고칠 글입니다.'), '고친 글입니다.');
        assert.strictEqual(strip(`\`\`\`\n고친 글입니다.\n\n${code}\n\`\`\``, '고칠 글입니다.'), `고친 글입니다.\n\n${code}`, '코드 블록이 든 글을 통째 감싼 펜스');
        assert.strictEqual(strip(PY('# 주석', 'total = 0'), 'total = 0'), '# 주석\ntotal = 0', '코드 블록 안의 줄만 골랐다');
        assert.strictEqual(strip(`${code}\n\n${PY('print(1)')}`, '고칠 글입니다.'), `${code}\n\n${PY('print(1)')}`, '코드 블록 두 개');
        assert.strictEqual(strip(`고친 글입니다.\n\n${code}`, '고칠 글입니다.'), `고친 글입니다.\n\n${code}`, '글 뒤에 새 코드 블록을 더한 답');
        assert.strictEqual(strip(`${code}\n\n뒤 글입니다.`, '고칠 글입니다.'), `${code}\n\n뒤 글입니다.`, '코드 블록으로 시작하는 답');
        assert.strictEqual(strip('  고친 글입니다.  ', '고칠 글입니다.'), '고친 글입니다.');
    });

    await run('고른 글 고치기: 문제은행 탭·최종 평가에서 고를 때만 문항 모드로 묻는다', async () => {
        const ctx = appContext();
        const quest = { id: 'mainQuest', title: '최종 평가', status: 'done', images: {}, content: `## 과제\n\n${PY('total = 0')}` };
        const mod = lessonOf({ tabs: { basicLearn: `## 1. 합계 (⏱ 30분)\n\n${PY('total = 0')}`, assessment: QUESTION_MD } });
        openSubject(ctx, [mod], { mainQuest: quest });
        ctx.asks = [];
        vm.runInContext('buildTaskContext = (task, a) => { window.asks.push([task, a?.quiz]); return { systemInstruction: "시스템", userPrompt: "고른 글 고치기" }; };', ctx);
        ctx.ai = route(ctx, { other: () => { throw new Error('여기서 멈춥니다'); } }); // 답을 넣는 길은 보지 않는다
        const hidden = fakeElement();
        hidden.classList = { add() {}, remove() {}, toggle() {}, contains: name => name === 'hidden' }; // 보기 화면이 숨은 원문 전체 수정
        Object.assign(ctx.elements, { 'render-view': hidden, 'ai-command-send': fakeElement() });
        ctx.elements['ai-command-input'].focus = () => {};
        ctx.location = { hash: '#editor/s1' };
        ctx.toggleEditorMode = () => {};
        const ask = async (moduleId, tabId, text) => {
            const raw = fakeElement();
            raw.value = text;
            raw.dataset = { moduleId: String(moduleId), tabId };
            raw.selectionStart = text.indexOf('total = 0');
            raw.selectionEnd = raw.selectionStart + 'total = 0'.length;
            ctx.elements['raw-view'] = raw;
            ctx.elements['ai-command-input'].value = '주석을 달아 주세요';
            vm.runInContext(`aiCommandMode = 'edit'; currentEditingModuleId = ${JSON.stringify(moduleId)}; currentLessonTab = ${JSON.stringify(tabId)};`, ctx);
            await call(ctx, 'executeAICommand')();
        };
        await ask(1, 'assessment', mod.tabContents.assessment);
        await ask(1, 'basicLearn', mod.tabContents.basicLearn);
        await ask('mainQuest', 'basicLearn', quest.content);
        assert.deepStrictEqual(plain(ctx.asks), [['edit', true], ['edit', false], ['edit', true]]);
        assert.strictEqual(ctx.alerts.at(-1), '여기서 멈춥니다');
    });

    /* ---------- 학습 목표 세트 추가 ---------- */
    await run('학습 목표 세트 추가: 받은 섹션의 주석이 모자란 코드 블록에 주석만 더해 미리 보인다', async () => {
        const ctx = appContext();
        vm.runInContext(source('lesson-objectives.js'), ctx);
        const learn = `${LEARN_GOALS}\n\n## 1. 합계 (⏱ 30분)\n\n합계를 구합니다.\n\n## 학습 후 체크리스트\n\n- 합계를 구할 수 있다 (다시 보기: 1. 합계)`;
        const mod = lessonOf({ tabs: { basicLearn: learn } });
        openSubject(ctx, [mod]);
        ['objective-hint', 'objective-status'].forEach(id => { ctx.elements[id] = fakeElement(); });
        const section = `## 2. 평균 (⏱ 30분)\n\n평균을 구합니다.\n\n${PY('scores = [80, 92]', 'print(sum(scores) / len(scores))')}`;
        ctx.ai = route(ctx, {
            other: () => reply(JSON.stringify({ objective: '점수 목록의 평균을 구하는 코드를 작성할 수 있습니다.', section, checklist: '평균을 구할 수 있다 (다시 보기: 2. 평균)' })),
            comment: commentReply()
        });
        await call(ctx, 'runObjectiveAdd')(mod, 'basicLearn', fakeElement());
        assert.deepStrictEqual(ctx.calls.map(item => item.kind), ['other', 'comment']);
        assert.ok(ctx.previews[0].after.includes(PY(`# ${NOTE}`, 'scores = [80, 92]', `# ${NOTE}`, 'print(sum(scores) / len(scores))')), ctx.previews[0].after);
        assert.strictEqual(mod.tabContents.basicLearn, ctx.previews[0].after);
    });

    /* ---------- 2차 검토: 섹션 고치기의 코드 블록 ---------- */
    const REVEALING = ['### 문제 1. 합계 구하기', '학습 목표 1 · 밴드 L2 · 코드제출', '', '빈칸을 채워 합계를 출력합니다.', '', '🧩 **시작 코드:**', '',
        PY('# 반복문으로 1, 2, 3을 더합니다', 'total = 0', 'for n in [1, 2, 3]:', '    total += n  # 정답: 여기서 6이 됩니다', 'print(total)'), '',
        '🧪 **테스트:** 입력 없음 → 6', '', '🔍 **교차 검수:** 수정 필요 - 시작 코드 주석이 정답과 출력 결과(6)를 알려 줍니다.', '', '---'].join('\n');
    const REVIEWED = REVEALING.replace('# 정답: 여기서 6이 됩니다', '# 수를 하나씩 합계에 더합니다').replace('수정 필요 - 시작 코드 주석이 정답과 출력 결과(6)를 알려 줍니다.', '통과');
    const DROPPED_NOTE = '코드 블록을 바꾼 답이라 섹션 1개(문제 1)는 반영하지 않았습니다. 코드 블록 안을 고칠 지적은 원문에서 고칩니다.';
    const proposeOn = async (tabId, md, fixed) => {
        const ctx = appContext();
        const mod = lessonOf({ tabs: { basicLearn: `${LEARN_GOALS}\n\n## 1. 합계 (⏱ 30분)\n\n합계를 구합니다.`, [tabId]: md } });
        openSubject(ctx, [mod]);
        vm.runInContext(`currentLessonTab = ${JSON.stringify(tabId)};`, ctx);
        ctx.ai = route(ctx, { fix: () => reply(fixed), comment: commentReply() });
        call(ctx, 'runConventionCheck')(1);
        await call(ctx, 'proposeLessonFix')();
        return { ctx, mod };
    };

    await run('검토 V1-01: 문항의 교차 검수가 정답을 드러낸다고 지적한 주석은 코드 줄을 지킨 채 고친 답을 받고, 코드를 바꾼 섹션은 안내에 적는다', async () => {
        const { ctx, mod } = await proposeOn('assessment', REVEALING, REVIEWED);
        const fix = callsOf(ctx, 'fix')[0];
        assert.ok(fix.user.includes('코드 블록은 코드 줄을 한 글자도 바꾸지 않습니다. 정답·출력 결과·고칠 곳을 드러내는 주석 줄은 고쳐도 됩니다'), fix.user);
        assert.ok(ctx.previews[0].after.includes('    total += n  # 수를 하나씩 합계에 더합니다') && !ctx.previews[0].after.includes('정답: 여기서 6이 됩니다'), ctx.previews[0].after);
        assert.ok(!mod.tabContents.assessment.includes('정답: 여기서 6이 됩니다'), '반영한 탭에서 정답 주석이 빠진다');
        // 교차 검수 지적이어도 코드 줄을 바꾼 답은 받지 않고, 바뀐 것이 없는 까닭을 안내에 적는다
        const changed = await proposeOn('assessment', REVEALING, REVIEWED.replace('total = 0', 'total = 6'));
        assert.strictEqual(changed.ctx.previews[0].opts.note, DROPPED_NOTE);
        assert.ok(changed.mod.tabContents.assessment.includes('total = 0'));
        // 문항이 아닌 탭의 섹션 고치기는 지시도 그대로이고 주석 줄을 바꾼 답도 받지 않는다
        const prose = ['## 1. 합계 구하기 (⏱ 30분)', '', '앞에서 다룬 반복문으로 합계를 구합니다.', '', PY('# 합계를 구합니다', ...SUM_CODE)].join('\n');
        const learn = await proposeOn('basicPrac', prose, fixedSection('# 반복문으로 더합니다', ...SUM_CODE));
        assert.ok(callsOf(learn.ctx, 'fix')[0].user.includes(FIX_CODE_LINE), '일반 탭 지시는 그대로');
        assert.ok(learn.mod.tabContents.basicPrac.includes('앞에서 다룬'), '주석 줄을 바꾼 섹션은 받지 않는다');
        assert.strictEqual(learn.ctx.previews[0].opts.note, '코드 블록을 바꾼 답이라 섹션 1개(1. 합계 구하기 (⏱ 30분))는 반영하지 않았습니다. 코드 블록 안을 고칠 지적은 원문에서 고칩니다.');
        // 모듈의 확인: 주석을 뺀 코드 줄이 차례대로 같은가
        const same = (code, answer) => call(ctx, 'codeCommentSameCode')({ lang: 'python', label: 'python', lines: code }, answer);
        assert.ok(same(['x = 1  # 정답은 1', 'print(x)'], ['# 값을 정합니다', 'x = 1  # 시작값', 'print(x)']));
        assert.ok(same(['# 정답: 1', 'x = 1'], ['x = 1']), '주석 줄을 지운 답');
        assert.ok(!same(['x = 1', 'print(x)'], ['x = 2', 'print(x)']), '코드 값을 바꾼 답');
        assert.ok(!same(['s = """', '# 문자열', '"""'], ['s = """', '# 고친 문자열', '"""']), '문자열 안의 줄은 코드다');
        assert.ok(!same(['x = 1', '', 'y = 2'], ['x = 1', 'y = 2']), '빈 줄을 지운 답');
    });

    await run('검토 V1-02: 섹션 고치기는 닫는 펜스를 빠뜨리거나 이름표·펜스를 바꾸거나 실행 결과·json 값을 바꾼 답을 받지 않는다(자동 수정도 그런 답을 저장하지 않는다)', async () => {
        const ctx = appContext();
        const RESULT = ['## 2. 결과 확인 (⏱ 20분)', '', '결과를 확인합니다.', '', '```text', '6', '```'].join('\n');
        const DOC = `${PHRASE_SECTION}\n\n${RESULT}`;
        const lint = (md, extra = {}) => call(ctx, 'lintLessonMarkdown')(md, 'basicPrac', { codeComments: false, ...extra });
        const mergeOn = (md, fixed, extra) => call(ctx, 'mergeFixedSections')(md, fixed, call(ctx, 'pickFixSections')(md, lint(md, extra)).targets);
        const head = '## 1. 합계 구하기 (⏱ 30분)\n\n반복문으로 합계를 구합니다.\n\n';
        const takes = fixed => mergeOn(DOC, fixed) !== DOC;
        assert.ok(takes(head + PY(...SUM_CODE)), '코드 블록을 그대로 둔 답은 받는다');
        assert.ok(!takes(head + ['```python', ...SUM_CODE].join('\n')), '닫는 펜스를 빠뜨린 답');
        assert.ok(!takes(head + ['```text', ...SUM_CODE, '```'].join('\n')), 'python → text');
        assert.ok(!takes(head + ['```javascript', ...SUM_CODE, '```'].join('\n')), 'python → javascript');
        assert.ok(!takes(head + ['````python', ...SUM_CODE, '````'].join('\n')), '펜스 길이');
        assert.ok(!takes(head + ['  ```python', ...SUM_CODE.map(line => `  ${line}`), '  ```'].join('\n')), '펜스 들여쓰기');
        assert.ok(!takes(head + PY('total = 0', '', 'for n in [1, 2, 3]:', '    total += n', 'print(total)')), '코드 줄 사이에 빈 줄을 더한 답');
        // 주석을 세지 않는 블록(실행 결과·json)은 값이 같아야 받는다
        const OUT = [PHRASE_SECTION, '', '```text', '6', '```', '', '```json', '{ "start": 0 }', '```'].join('\n');
        const keptOut = [head + PY(...SUM_CODE), '', '```text', '6', '```', '', '```json', '{ "start": 0 }', '```'].join('\n');
        assert.strictEqual(mergeOn(OUT, keptOut.replace('```text\n6', '```text\n10')), OUT, '실행 결과 값을 바꾼 답');
        assert.strictEqual(mergeOn(OUT, keptOut.replace('"start": 0', '"start": 100')), OUT, 'json 값을 바꾼 답');
        assert.strictEqual(mergeOn(OUT, keptOut), keptOut, '값을 지킨 답은 받는다');
        // 이름표를 적는 지적을 고칠 때는 이름표만 붙인 답을 받고, 그 지적이 없으면 이름표를 바꾼 것도 받지 않는다
        const bare = ['## 1. 합계 구하기 (⏱ 30분)', '', '반복문으로 합계를 구합니다.', '', '```', ...SUM_CODE, '```'].join('\n');
        assert.ok(lint(bare, { codeTopic: true }).some(issue => issue.msg === '코드 블록에 언어를 적습니다.'));
        assert.notStrictEqual(mergeOn(bare, bare.replace('```\ntotal', '```python\ntotal'), { codeTopic: true }), bare, '이름표를 적는 지적');
        const phraseBare = bare.replace('반복문으로', '앞에서 다룬 반복문으로');
        assert.strictEqual(mergeOn(phraseBare, bare.replace('```\ntotal', '```python\ntotal')), phraseBare, '다른 지적만 고칠 때');
        // 탭 생성의 자동 수정: 닫는 펜스를 빠뜨린 답을 저장하지 않는다(뒤 섹션이 코드 블록에 들어가 지적이 숨지 않게)
        const gen = appContext();
        const mod = lessonOf({ tabs: {} });
        openSubject(gen, [mod]);
        gen.ai = route(gen, { tab: () => reply(DOC), fix: () => reply(head + ['```python', ...SUM_CODE].join('\n')), comment: commentReply() });
        await call(gen, 'generateTabContent')(1, 'basicPrac');
        const saved = mod.tabContents.basicPrac;
        assert.deepStrictEqual(plain(call(gen, 'mdSections')(saved).map(section => section.title).filter(Boolean)), ['1. 합계 구하기 (⏱ 30분)', '2. 결과 확인 (⏱ 20분)'], saved);
        assert.ok(!gen.toasts.some(toast => toast.message === '컨벤션 필수 지적을 자동으로 고쳤습니다.'), JSON.stringify(gen.toasts));
    });

    /* ---------- 2차 검토: 고른 글 AI 고치기 ---------- */
    // 아래 AI 명령줄의 고른 글 고치기(executeAICommand)를 원문 칸에서 고른 글로 돌린다. 확인 창은 '반영'을 누른다
    async function editSelection(ctx, { moduleId = 1, tabId = 'basicLearn', text, from, to, command = '주석을 달아 주세요' }) {
        const raw = fakeElement();
        Object.assign(raw, { value: text, selectionStart: from, selectionEnd: to, lastSaved: text, storedFrom: text });
        raw.dataset = { moduleId: String(moduleId), tabId };
        const hidden = fakeElement();
        hidden.classList = { add() {}, remove() {}, toggle() {}, contains: name => name === 'hidden' };
        Object.assign(ctx.elements, { 'raw-view': raw, 'render-view': hidden, 'ai-command-send': fakeElement() });
        ctx.elements['ai-command-input'].focus = () => {};
        ctx.elements['ai-command-input'].value = command;
        ctx.location = { hash: '#editor/s1' };
        ctx.toggleEditorMode = () => {};
        ctx.edits = [];
        vm.runInContext(`aiCommandMode = 'edit'; currentEditingModuleId = ${JSON.stringify(moduleId)}; currentLessonTab = ${JSON.stringify(tabId)};
            confirmAiEdit = async (before, after, opts) => { window.edits.push({ before, after, opts }); return true; };`, ctx);
        await call(ctx, 'executeAICommand')();
        return ctx.edits[0];
    }

    await run('검토 V1-03: 고른 글 고치기는 코드 블록을 고른 답을 한 겹 더 감싼 펜스와, 코드 블록 끝을 걸쳐 고른 글을 감싼 펜스를 벗긴다', () => {
        const ctx = appContext();
        // runAICommand와 같은 길: 답(AI 응답)을 정리하고 감싼 펜스를 벗긴다. 코드 블록 안에서 시작해 걸쳐 고른 글은 그 블록의 여는 펜스(```)를 넘긴다
        const strip = (answer, selected, fence = selected.startsWith('print(total)') ? '```' : '') => call(ctx, 'editAnswerFromResponse')(reply(answer), selected, fence);
        const code = PY('total = 0', 'for n in [1, 2, 3]:', '    total += n', 'print(total)');
        const commented = PY('# 1부터 3까지 더해 합계를 출력합니다', 'total = 0  # 합계의 시작값', 'for n in [1, 2, 3]:  # 수를 하나씩 꺼냅니다', '    total += n  # 합계에 더합니다', 'print(total)  # 합계를 출력합니다');
        assert.strictEqual(strip(`\`\`\`\n${commented}\n\`\`\``, code), commented, '코드 블록을 골랐고 답을 이름표 없는 ```로 한 겹 더 감쌌다');
        assert.strictEqual(strip(`\`\`\`markdown\n${commented}\n\`\`\``, code), commented, '```markdown으로 한 겹 더');
        assert.strictEqual(strip(commented, code), commented, '감싸지 않은 답은 그대로');
        // 펜스 쓰는 법을 보이는 예제(```` 안에 ```python)를 고르면 같은 꼴의 답은 벗기지 않고, 그 위에 한 겹 더 감싼 답은 한 겹만 벗긴다
        const example = ['````', code, '````'].join('\n');
        const exampleFixed = ['````', commented, '````'].join('\n');
        assert.strictEqual(strip(exampleFixed, example), exampleFixed, '같은 꼴의 답');
        assert.strictEqual(strip(`\`\`\`\`\`\n${exampleFixed}\n\`\`\`\`\``, example), exampleFixed, '한 겹 더 감싼 답');
        const across = 'print(total)\n```\n\n## 2. 결과 확인 (⏱ 20분)\n\n결과를 확인합니다.';
        const acrossFixed = 'print(total)  # 합계를 출력합니다\n```\n\n## 2. 결과 확인 (⏱ 20분)\n\n결과를 확인합니다.';
        assert.strictEqual(strip(`\`\`\`markdown\n${acrossFixed}\n\`\`\``, across), acrossFixed, '코드 블록 끝을 걸쳐 고른 글을 ```markdown으로 감쌌다');
        assert.strictEqual(strip(`\`\`\`\n${acrossFixed}\n\`\`\``, across), acrossFixed, '이름표 없는 ```로 감쌌다');
        assert.strictEqual(strip(acrossFixed, across), acrossFixed, '감싸지 않은 답은 그대로');
        // 넣은 글의 블록과 섹션이 그대로다
        const doc = ['## 1. 합계 구하기 (⏱ 30분)', '', '반복문으로 합계를 구합니다.', '', code, '', '## 2. 결과 확인 (⏱ 20분)', '', '결과를 확인합니다.', '', '## 3. 정리 (⏱ 10분)', '', '정리합니다.'].join('\n');
        const place = (selected, answer) => {
            const at = doc.indexOf(selected);
            return call(ctx, 'placeAiEdit')(doc, { selStart: at, selEnd: at + selected.length, selectedText: selected, newText: strip(answer, selected) });
        };
        assert.strictEqual(place(code, `\`\`\`\n${commented}\n\`\`\``), doc.replace(code, commented));
        assert.strictEqual(place(across, `\`\`\`markdown\n${acrossFixed}\n\`\`\``), doc.replace(across, acrossFixed));
        // 코드 블록 안의 들여쓴 줄부터 걸쳐 고르면 정리가 # 줄 들여쓰기를 지우거나 닫는 펜스 앞에 빈 줄을 넣지 않는다
        const tail = '    total += n\nprint(total)\n```\n\n## 2. 결과 확인 (⏱ 20분)';
        const tailFixed = '    # 수를 하나씩 더합니다\n    total += n\nprint(total)\n```\n\n## 2. 결과 확인 (⏱ 20분)';
        assert.strictEqual(call(ctx, 'editAnswerFromResponse')(reply(tailFixed), tail, '```'), tailFixed);
    });

    await run('검토 V1-04: 고른 글 AI 고치기·원문 칸 저장으로 코드 블록에 주석만 더해도 교수안을 다시 만들라고 하지 않는다', async () => {
        const ctx = appContext();
        vm.runInContext(source('gyosuan-view.js'), ctx);
        const code = PY('total = 0', 'print(total)');
        const learn = `## 1. 합계 (⏱ 30분)\n\n합계를 구합니다.\n\n${code}`;
        const mod = lessonOf({ tabs: { basicLearn: learn } });
        mod.gyosuan = gyosuanOf({ sourceKey: sourceKey(ctx, mod, 'basic') });
        openSubject(ctx, [mod]);
        const note = () => call(ctx, 'gyosuanNoteText')(mod, 'basic');
        ctx.ai = route(ctx, { other: () => reply(PY('# 합계를 구해 출력합니다', 'total = 0', 'print(total)')), comment: commentReply() });
        await editSelection(ctx, { text: learn, from: learn.indexOf(code), to: learn.indexOf(code) + code.length });
        assert.ok(mod.tabContents.basicLearn.includes('# 합계를 구해 출력합니다'), mod.tabContents.basicLearn);
        assert.strictEqual(mod.gyosuan.sourceKey, sourceKey(ctx, mod, 'basic'), '고른 글 고치기(주석만)');
        assert.ok(!note().startsWith('⚠️'), note());
        // 원문 칸에서 손으로 주석만 더해 넣어도 맞춘다. 다른 글을 고치면 다시 만들라고 둔다
        const typed = mod.tabContents.basicLearn.replace('print(total)', 'print(total)  # 합계를 보입니다');
        const raw = ctx.elements['raw-view'];
        Object.assign(raw, { value: typed, lastSaved: mod.tabContents.basicLearn, storedFrom: mod.tabContents.basicLearn });
        call(ctx, 'saveRawContent')();
        assert.deepStrictEqual([mod.tabContents.basicLearn, mod.gyosuan.sourceKey], [typed, sourceKey(ctx, mod, 'basic')], '원문 칸 저장(주석만)');
        const kept = mod.gyosuan.sourceKey;
        Object.assign(raw, { value: typed.replace('합계를 구합니다.', '합계를 구하는 법을 봅니다.'), lastSaved: typed, storedFrom: typed });
        call(ctx, 'saveRawContent')();
        assert.deepStrictEqual([mod.gyosuan.sourceKey, note()], [kept, STALE_NOTE], '글이 바뀌면 다시 만들라고 둔다');
    });

    await run('검토 V3-2: 코드 블록 안의 줄만 골라 고치면 글 정리 없이 받아 들여쓰기·목록 줄이 그대로고, 코드 줄을 바꾼 답은 확인 창에 알린다', async () => {
        const ctx = appContext();
        const learn = ['## 1. 합계 (⏱ 30분)', '', '합계를 구합니다.', '', '```python', 'def total(nums):', '    result = 0', '    for n in nums:', '        result += n', '    return result', '```', '',
            '## 2. 설정 (⏱ 10분)', '', '```yaml', 'items:', '    - sword', '    - shield', '```'].join('\n');
        const mod = lessonOf({ tabs: { basicLearn: learn } });
        openSubject(ctx, [mod]);
        ctx.asks = [];
        vm.runInContext('(() => { const stub = buildTaskContext; buildTaskContext = (task, a) => { window.asks.push(a); return stub(task, a); }; })();', ctx);
        const body = '    result = 0\n    for n in nums:';
        // 줄 가운데에서 골라도 줄 단위로 넓혀 보내고, 답의 첫 줄 들여쓰기를 지키며, 감싼 펜스는 벗긴다
        ctx.ai = route(ctx, { other: () => reply(['```python', '    # 합계를 0으로 시작합니다', '    result = 0', '    # 수를 하나씩 꺼냅니다', '    for n in nums:', '```'].join('\n')) });
        const first = await editSelection(ctx, { text: learn, from: learn.indexOf(body) + 4, to: learn.indexOf(body) + body.length - 3 });
        assert.deepStrictEqual([ctx.asks[0].selectedText, ctx.asks[0].codeLang], [body, 'python'], '줄 단위로 넓혀 코드 블록 안의 줄이라고 알린다');
        assert.ok(mod.tabContents.basicLearn.includes('    # 합계를 0으로 시작합니다\n    result = 0\n    # 수를 하나씩 꺼냅니다\n    for n in nums:\n        result += n'), mod.tabContents.basicLearn);
        assert.strictEqual(first.opts?.note || '', '', '주석만 더한 답은 알릴 것이 없다');
        // YAML 목록 줄: 들여쓰기가 2칸으로 줄지 않는다
        const yamlLine = '    - sword';
        ctx.calls.length = 0;
        ctx.ai = route(ctx, { other: () => reply('    - sword  # 기본 무기입니다') });
        const current = mod.tabContents.basicLearn;
        await editSelection(ctx, { text: current, from: current.indexOf(yamlLine), to: current.indexOf(yamlLine) + yamlLine.length });
        assert.ok(mod.tabContents.basicLearn.includes('items:\n    - sword  # 기본 무기입니다\n    - shield'), mod.tabContents.basicLearn);
        // 코드 줄을 바꾼 답은 넣기 전 확인 창에 까닭을 적는다
        const now = mod.tabContents.basicLearn;
        const line = '        result += n';
        ctx.ai = route(ctx, { other: () => reply('        result = result + n  # 더합니다') });
        const swapped = await editSelection(ctx, { text: now, from: now.indexOf(line), to: now.indexOf(line) + line.length });
        assert.ok(/^AI 답이 원래 코드 줄을 바꿨습니다/.test(swapped.opts?.note || ''), JSON.stringify(swapped.opts));
    });

    await run('검토 V2-05: 고른 글 AI 고치기의 답에 주석이 모자란 코드 블록이 있으면 주석만 더해 미리 보이고, 넣지 못하면 확인 창에 적는다', async () => {
        const ctx = appContext();
        const code = PY('# 합을 구합니다', 'total = 0', 'print(total)');
        const learn = `## 1. 합계 (⏱ 30분)\n\n합계를 구합니다.\n\n${code}`;
        const mod = lessonOf({ tabs: { basicLearn: learn, assessment: QUESTION_MD } });
        openSubject(ctx, [mod]);
        ctx.ai = route(ctx, { other: () => reply(PY('total = 0', 'print(total)')), comment: commentReply() });
        const shown = await editSelection(ctx, { text: learn, from: learn.indexOf(code), to: learn.indexOf(code) + code.length, command: '코드를 다듬어 주세요' });
        assert.deepStrictEqual(callsOf(ctx, 'comment').map(item => item.quiz), [false]);
        assert.strictEqual(needsOf(ctx, mod.tabContents.basicLearn), 0, mod.tabContents.basicLearn);
        assert.strictEqual(shown.after, mod.tabContents.basicLearn.slice(mod.tabContents.basicLearn.indexOf('```python')), '확인 창에 주석이 든 글을 보인다');
        // 문제은행 탭은 문항 모드로 넣고, 넣지 못하면 확인 창에 적는다
        const bank = mod.tabContents.assessment;
        const start = PY('total = 0', 'print(total)');
        ctx.calls.length = 0;
        ctx.ai = route(ctx, { other: () => reply(start), comment: () => { throw new Error('연결이 끊겼습니다'); } });
        const failed = await editSelection(ctx, { tabId: 'assessment', text: bank, from: bank.indexOf(start), to: bank.indexOf(start) + start.length });
        assert.deepStrictEqual(callsOf(ctx, 'comment').map(item => item.quiz), [true], '문항 모드');
        assert.strictEqual(failed.opts?.note, '코드 블록 1개는 주석을 다 넣지 못했습니다.');
    });

    finish();
})();
