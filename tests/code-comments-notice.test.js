// 코드 주석 보강의 끝 알림·작업 기록 테스트 (실행: node tests/code-comments-notice.test.js)
// 생성·고치기 뒤 주석 보강의 결과를 반영을 정한 뒤에 알리는지, 중지·실패를 숨기지 않는지, 분량 채우기가 다시 붙인 글에도 주석을 넣는지,
// '코드 주석 넣기 전' 기록이 최종 평가·탭이 없는 옛 차시를 제자리로 되돌리는지를 실제 파일로 확인한다.
// 실행 환경(가짜 AI·화면 흉내)은 tests/code-comments-harness.js에 있다. 키는 가짜 값만 쓰고 찍지 않는다.
const {
    vm, assert, source, reply, NOTE, HISTORY_REASON, PY, fakeElement, route, commentReply, callsOf,
    appContext, call, lessonOf, openSubject, needsOf, LEARN_GOALS, QUESTION_MD, PRAC_DRAFT, runner
} = require('./code-comments-harness');

const { run, finish } = runner();
const LEARN = `${LEARN_GOALS}\n\n## 1. 합계 (⏱ 30분)\n\n합계를 구합니다.`;
const SUBTOPIC = `\n\n### ■ 보강 소주제\n\n반복문으로 더합니다.\n\n${PY('x = 1', 'print(x)')}`;
// 코드를 바꾼 주석 답(확인이 버린다)
const swapAnswer = (from, to) => commentReply(code => `# 설명\n${code.replace(from, to)}`);

// 분량 채우기(lesson-volume.js fillVolumeJob)를 돌린다. 늘린 소주제 하나를 붙인 결과를 흉내 내고, onVolume은 채우는 동안 부른다
function volumeContext({ onVolume = () => {} } = {}) {
    const ctx = appContext();
    const mod = lessonOf({ tabs: { basicLearn: LEARN } });
    openSubject(ctx, [mod]);
    const key = call(ctx, 'lockTitleKey')('1. 합계 (⏱ 30분)');
    ctx.volume = opts => {
        onVolume(ctx, mod);
        return { md: `${opts.md}${SUBTOPIC}`, spoken: 0, minutes: 0, targetMinutes: 480, targetChars: 120000, calls: 1, added: 1, short: true, stopped: false, gone: false, error: null, reason: 'target', parts: [{ key, text: SUBTOPIC }] };
    };
    vm.runInContext(`ensureSpokenVolume = async opts => window.volume(opts);
        previewAiChange = async (before, after, opts) => { window.toastsAtPreview = window.toasts.slice(); window.previews.push({ before, after, opts }); return window.previewAnswer === undefined ? after : window.previewAnswer; };`, ctx);
    return { ctx, mod };
}

(async () => {
    /* ---------- 분량 채우기·탭 전체 AI 수정: 반영을 정한 뒤에 알린다 ---------- */
    await run('검토 V2-01·V3-3: 분량 채우기 중 탭이 바뀌면 이어 붙인 글에 주석을 넣어 미리 보이고, 주석 결과는 반영한 뒤 끝 알림에 적는다', async () => {
        const edited = LEARN.replace('합계를 구합니다.', '합계를 구합니다. 고친 문장입니다.');
        // 채우는 동안 강사가 같은 탭의 다른 글을 고쳤다: 바뀐 것을 안 뒤 이어 붙인 글에 한 번만 넣는다
        const { ctx, mod } = volumeContext({ onVolume: (c, m) => call(c, 'setTabMarkdown')(m, 'basicLearn', edited) });
        ctx.ai = route(ctx, { comment: commentReply(), fix: () => reply('') });
        await call(ctx, 'fillLessonVolume')(1, 'basicLearn');
        const preview = ctx.previews[0];
        assert.ok(preview.after.includes('고친 문장입니다.') && preview.after.includes(`# ${NOTE}\nx = 1`), preview.after);
        assert.strictEqual(needsOf(ctx, preview.after), 0, '이어 붙인 글에 주석이 들어 있다');
        assert.strictEqual(callsOf(ctx, 'comment').length, 1, '버릴 글에는 주석을 넣지 않는다');
        assert.ok(preview.opts.note.startsWith('채우는 동안 기본학습이 바뀌어, 늘린 소주제를 지금 글에 이어 붙였습니다(자동 수정은 반영하지 않았습니다).') && preview.opts.note.includes('코드 블록 1개에 주석을 넣었습니다.'), preview.opts.note);
        assert.ok(!ctx.toastsAtPreview.some(toast => toast.message.includes('주석을 넣었습니다')), '미리 보기 전에는 알리지 않는다');
        assert.strictEqual(mod.tabContents.basicLearn, preview.after);
        assert.ok(ctx.toasts.at(-1).message.endsWith(' 코드 블록 1개에 주석을 넣었습니다.'), JSON.stringify(ctx.toasts));
        assert.strictEqual(ctx.toasts.filter(toast => toast.message.includes('주석을 넣었습니다')).length, 1, '한 번만 알린다');
        // 주석을 받는 동안 탭이 바뀌면 지금 글에 다시 붙이고 주석을 한 번 더 넣는다
        const late = volumeContext();
        let first = true;
        late.ctx.ai = route(late.ctx, {
            fix: () => reply(''),
            comment: item => {
                if (first) call(late.ctx, 'setTabMarkdown')(late.mod, 'basicLearn', edited);
                first = false;
                return commentReply()(item);
            }
        });
        await call(late.ctx, 'fillLessonVolume')(1, 'basicLearn');
        const latePreview = late.ctx.previews[0];
        assert.ok(latePreview.after.includes('고친 문장입니다.') && needsOf(late.ctx, latePreview.after) === 0, latePreview.after);
        assert.strictEqual(callsOf(late.ctx, 'comment').length, 2);
        // 반영하지 않기를 고르면 주석을 넣었다고 알리지 않는다
        const skip = volumeContext();
        skip.ctx.ai = route(skip.ctx, { comment: commentReply(), fix: () => reply('') });
        skip.ctx.previewAnswer = null;
        await call(skip.ctx, 'fillLessonVolume')(1, 'basicLearn');
        assert.ok(!skip.ctx.toasts.some(toast => toast.message.includes('주석을 넣었습니다')), JSON.stringify(skip.ctx.toasts));
        assert.strictEqual(skip.mod.tabContents.basicLearn, LEARN);
    });

    await run('검토 V3-3: 탭 전체 AI 수정은 기다리는 동안 탭이 바뀌어 반영하지 않으면 주석을 넣었다고 알리지 않고, 반영하면 끝 알림에 적는다', async () => {
        const ctx = appContext();
        const original = '## 1. 본문 (⏱ 30분)\n\n원래 글입니다.';
        const edited = `## 1. 본문 (⏱ 30분)\n\n보강한 글입니다.\n\n${PY('total = 0', 'print(total)')}`;
        const mod = lessonOf({ tabs: { basicLearn: original } });
        openSubject(ctx, [mod]);
        ctx.ai = route(ctx, { other: () => reply(edited), comment: item => { call(ctx, 'setTabMarkdown')(mod, 'basicLearn', `${original}\n\n고친 문장입니다.`); return commentReply()(item); } });
        await call(ctx, 'reinforceCurrentTab')(1, '예제 코드를 더해 줘');
        assert.strictEqual(ctx.alerts.at(-1), '고치는 동안 탭 내용이 바뀌어 반영하지 않았습니다. 다시 실행해 주세요.');
        assert.ok(!ctx.toasts.some(toast => toast.message.includes('주석을 넣었습니다')), JSON.stringify(ctx.toasts));
        const ok = appContext();
        const mod2 = lessonOf({ tabs: { basicLearn: original } });
        openSubject(ok, [mod2]);
        ok.ai = route(ok, { other: () => reply(edited), comment: commentReply() });
        await call(ok, 'reinforceCurrentTab')(1, '예제 코드를 더해 줘');
        assert.strictEqual(ok.previews[0].opts.note, '코드 블록 1개에 주석을 넣었습니다.', '미리보기 안내');
        assert.deepStrictEqual(ok.toasts.at(-1), { message: '기본학습에 AI 수정을 반영했습니다. 코드 블록 1개에 주석을 넣었습니다.', kind: 'success' });
        assert.strictEqual(ok.toasts.filter(toast => toast.message.includes('주석을 넣었습니다')).length, 1);
    });

    await run('검토 V4-02: 미리보기에서 섹션 일부만 반영하면 끝 알림은 반영한 글로 다시 세고, 남은 블록이 있으면 경고로 알린다(탭 전체 AI 수정·분량 채우기·탭 다시 만들기)', async () => {
        const LEFT = "코드 블록 1개는 주석을 다 넣지 못했습니다. 컨벤션 검수의 'AI 수정 제안'이나 도구의 '코드 주석 넣기'로 다시 넣을 수 있습니다.";
        const sec = (no, title, word) => [`## ${no}. ${title} (⏱ 30분)`, '', `${word} 설명입니다.`, '', PY(`value_${no} = ${no}`, `print(value_${no} * 2)`)].join('\n');
        const two = word => [sec(1, '첫 섹션', word), sec(2, '둘째 섹션', word)].join('\n\n');
        // 미리보기에서 둘째 섹션은 지금 글을 그대로 둔다(첫 섹션만 반영)
        const keepSecond = ctx => vm.runInContext(`previewAiChange = async (before, after, opts) => {
                window.previews.push({ before, after, opts });
                const old = mdSections(before);
                return mdSections(after).map(section => (/^2\\./.test(section.title) ? (old.find(item => item.title === section.title) || section) : section).text).join('\\n\\n');
            };`, ctx);
        // 탭 전체 AI 수정: 두 섹션의 설명을 고친 답에 주석 단계가 두 블록 모두 주석을 넣었다
        const ctx = appContext();
        const mod = lessonOf({ tabs: { basicLearn: two('원래') } });
        openSubject(ctx, [mod]);
        ctx.ai = route(ctx, { other: () => reply(two('고친')), comment: commentReply() });
        keepSecond(ctx);
        await call(ctx, 'reinforceCurrentTab')(1, '설명을 다듬어 줘');
        assert.strictEqual(ctx.previews[0].opts.note, '코드 블록 2개에 주석을 넣었습니다.', '미리보기 안내는 제안 전체를 센다');
        assert.ok(mod.tabContents.basicLearn.includes('고친 설명입니다.') && mod.tabContents.basicLearn.includes('원래 설명입니다.'), mod.tabContents.basicLearn);
        assert.strictEqual(needsOf(ctx, mod.tabContents.basicLearn), 1);
        assert.deepStrictEqual(ctx.toasts.at(-1), { message: `기본학습에 AI 수정을 반영했습니다. 코드 블록 1개에 주석을 넣었습니다. ${LEFT}`, kind: 'warning' });
        // 분량 채우기: 첫 섹션에 붙인 소주제와 둘째 섹션의 있던 블록에 주석을 넣었고, 둘째 섹션은 반영하지 않았다
        const { ctx: vol, mod: volMod } = volumeContext();
        const learn = `${LEARN_GOALS}\n\n${two('원래')}`;
        vm.runInContext(`setTabMarkdown(courseData[0], 'basicLearn', ${JSON.stringify(learn)});`, vol);
        const key = call(vol, 'lockTitleKey')('1. 첫 섹션 (⏱ 30분)');
        vol.volume = () => ({ md: learn.replace('원래 설명입니다.', `원래 설명입니다.${SUBTOPIC}`), spoken: 0, minutes: 0, targetMinutes: 480, targetChars: 120000, calls: 1, added: 1, short: true, stopped: false, gone: false, error: null, reason: 'target', parts: [{ key, text: SUBTOPIC }] });
        vol.ai = route(vol, { comment: commentReply(), fix: () => reply('') });
        keepSecond(vol);
        await call(vol, 'fillLessonVolume')(1, 'basicLearn');
        assert.strictEqual(vol.previews[0].opts.note.endsWith('코드 블록 3개에 주석을 넣었습니다.'), true, vol.previews[0].opts.note);
        assert.strictEqual(needsOf(vol, volMod.tabContents.basicLearn), 1, volMod.tabContents.basicLearn);
        assert.ok(vol.toasts.at(-1).message.endsWith(` 코드 블록 2개에 주석을 넣었습니다. ${LEFT}`) && vol.toasts.at(-1).kind === 'warning', JSON.stringify(vol.toasts.at(-1)));
        // 탭 다시 만들기(기본실습): 새 글의 두 블록에 주석을 넣었고, 둘째 섹션은 지금 글을 둔다
        const gen = appContext();
        const prac = lessonOf({ tabs: { basicLearn: LEARN, basicPrac: two('원래') } });
        openSubject(gen, [prac]);
        gen.ai = route(gen, { tab: () => reply(two('새')), comment: commentReply(), fix: () => reply('') });
        keepSecond(gen);
        await call(gen, 'runTabJob')(1, 'basicPrac');
        assert.ok(prac.tabContents.basicPrac.includes('새 설명입니다.') && prac.tabContents.basicPrac.includes('원래 설명입니다.'), prac.tabContents.basicPrac);
        assert.ok(gen.toasts.at(-1).message.endsWith(` 코드 블록 1개에 주석을 넣었습니다. ${LEFT}`) && gen.toasts.at(-1).kind === 'warning', JSON.stringify(gen.toasts));
    });

    /* ---------- 중지·실패를 숨기지 않는다 ---------- */
    await run('검토 V2-07: 탭 생성의 주석 단계에서 중지하면 남은 블록을 끝 알림에 적고 경고로 알린다(분량 채우기·병합도 같다)', async () => {
        const ctx = appContext();
        const mod = lessonOf({ tabs: { basicLearn: LEARN } });
        openSubject(ctx, [mod]);
        const prac = Array.from({ length: 12 }, (_, i) => `## ${i + 1}. 실습 ${i + 1} (⏱ 10분)\n\n실습 ${i + 1}을 합니다.\n\n${PY(`step_${i} = ${i}`, `print(step_${i})`)}`).join('\n\n');
        ctx.ai = route(ctx, { tab: () => reply(prac), comment: item => { call(ctx, 'requestLessonPipelineStop')(); return commentReply()(item); } });
        await call(ctx, 'runTabJob')(1, 'basicPrac');
        assert.strictEqual(callsOf(ctx, 'comment').length, 1, '받던 묶음까지만 넣는다');
        assert.strictEqual(needsOf(ctx, mod.tabContents.basicPrac), 4);
        assert.deepStrictEqual(ctx.toasts.at(-1), { message: "기본실습 탭이 생성되었습니다. 코드 블록 8개에 주석을 넣었습니다. 중지해서 코드 블록 4개에는 주석을 넣지 못했습니다. 도구의 '코드 주석 넣기'로 이어서 넣을 수 있습니다.", kind: 'warning' });
        // 분량 채우기
        const { ctx: vol } = volumeContext();
        const many = Array.from({ length: 9 }, (_, i) => PY(`v${i} = ${i}`)).join('\n\n');
        vol.volume = opts => ({ md: `${opts.md}\n\n### ■ 보강 소주제\n\n${many}`, spoken: 0, minutes: 0, targetMinutes: 480, targetChars: 120000, calls: 1, added: 1, short: true, stopped: false, gone: false, error: null, reason: 'target', parts: [] });
        vol.ai = route(vol, { fix: () => reply(''), comment: item => { vm.runInContext('_tabGenStop = true;', vol); return commentReply()(item); } });
        await call(vol, 'fillLessonVolume')(1, 'basicLearn');
        assert.ok(vol.toasts.at(-1).message.endsWith("중지해서 코드 블록 1개에는 주석을 넣지 못했습니다. 도구의 '코드 주석 넣기'로 이어서 넣을 수 있습니다.") && vol.toasts.at(-1).kind === 'warning', JSON.stringify(vol.toasts.at(-1)));
        // 병합
        const done = call(ctx, 'mergeDoneText');
        const stopped = { fixed: [0], remaining: 2, held: 0, stopped: true, error: '' };
        assert.ok(done({ md: LEARN, volume: null, comments: stopped }).endsWith("중지해서 코드 블록 2개에는 주석을 넣지 못했습니다. 도구의 '코드 주석 넣기'로 이어서 넣을 수 있습니다."), done({ md: LEARN, volume: null, comments: stopped }));
    });

    await run('검토 V4-04: 카드 교안 생성·최종 평가 만들기는 주석 결과를 저장한 뒤에 알리고, 중지로 남은 블록은 멈춘 알림에 적으며, 차시·교과가 없어지면 알리지 않는다', async () => {
        const VOLUME_STUB = `ensureSpokenVolume = async opts => ({ md: opts.md, spoken: 0, minutes: 0, targetMinutes: 480, targetChars: 120000, calls: 0, added: 0, short: true, stopped: false, gone: false, error: null, reason: 'none', parts: [] });`;
        // 알림마다 그때까지 저장한 횟수를 남긴다(저장한 뒤에 알리는지 본다)
        const moduleContext = () => {
            const ctx = appContext();
            const mod = lessonOf({ tabs: {}, status: 'pending', content: '' });
            const subject = openSubject(ctx, [mod]);
            ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind, saved: ctx.saved });
            vm.runInContext(VOLUME_STUB, ctx);
            return { ctx, mod, subject };
        };
        const learnWith = count => `${LEARN_GOALS}\n\n${Array.from({ length: count }, (_, i) => `## ${i + 1}. 소주제 ${i + 1} (⏱ 30분)\n\n설명 ${i + 1}입니다.\n\n${PY(`step_${i} = ${i}`, `print(step_${i})`)}`).join('\n\n')}`;
        // 주석 단계에서 막대의 '중지'를 누르면 받은 데까지 저장하고, 남은 블록을 멈춘 창에 적는다(다음 단계로 가지 않는다)
        const stop = moduleContext();
        stop.ctx.ai = route(stop.ctx, {
            module: () => reply(learnWith(12)), fix: () => reply(''),
            comment: item => { call(stop.ctx, 'requestLessonPipelineStop')(); return commentReply()(item); },
            other: () => { stop.ctx.continued = true; return reply(''); }
        });
        await call(stop.ctx, 'generateModuleContent')(1, []);
        const saved = stop.mod.tabContents?.basicLearn || stop.mod.content;
        assert.strictEqual(needsOf(stop.ctx, saved), 4, '받던 묶음까지만 넣고 저장한다');
        assert.ok(!stop.ctx.continued, '중지하면 다음 단계로 가지 않는다');
        assert.strictEqual(stop.ctx.alerts.length, 1, JSON.stringify(stop.ctx.alerts));
        assert.ok(stop.ctx.alerts[0].startsWith('교안 생성을 중단했습니다. 받은 내용까지 저장했습니다(') && stop.ctx.alerts[0].endsWith(" 코드 블록 8개에 주석을 넣었습니다. 중지해서 코드 블록 4개에는 주석을 넣지 못했습니다. 도구의 '코드 주석 넣기'로 이어서 넣을 수 있습니다."), stop.ctx.alerts[0]);
        assert.ok(!stop.ctx.toasts.some(toast => toast.message.includes('주석')), JSON.stringify(stop.ctx.toasts));
        // 끝까지 넣으면 저장한 뒤에 알리고 다음 단계로 간다
        const ok = moduleContext();
        vm.runInContext(`window.runLessonPipeline = async () => { window.order.push('pipeline'); };`, ok.ctx);
        ok.ctx.ai = route(ok.ctx, { module: () => reply(learnWith(1)), fix: () => reply(''), comment: commentReply() });
        await call(ok.ctx, 'generateModuleContent')(1, []);
        const told = ok.ctx.toasts.find(toast => toast.message === '기본학습 코드 블록 1개에 주석을 넣었습니다.');
        assert.ok(told && told.kind === 'success' && told.saved > 0, JSON.stringify(ok.ctx.toasts));
        assert.deepStrictEqual(ok.ctx.order.slice(-2), ['images', 'pipeline']);
        // 그림을 그리는 동안 차시를 지우면 멈춘 창만 띄우고 주석을 넣었다고 알리지 않는다
        const gone = moduleContext();
        vm.runInContext(`window.runLessonPipeline = async () => {};
            processImageTags = async (m, md) => { courseData.splice(0, courseData.length); return md; };`, gone.ctx);
        gone.ctx.ai = route(gone.ctx, { module: () => reply(learnWith(1)), fix: () => reply(''), comment: commentReply() });
        await call(gone.ctx, 'generateModuleContent')(1, []);
        assert.ok(gone.ctx.alerts.some(text => text.startsWith('차시가 지워졌거나 불러온 내용으로 바뀌어 기본학습 만들기를 멈췄습니다.')), JSON.stringify(gone.ctx.alerts));
        assert.ok(!gone.ctx.toasts.some(toast => toast.message.includes('주석')), JSON.stringify(gone.ctx.toasts));
        // 최종 평가 만들기: 넣은 뒤에 알리고, 그사이 교과를 지웠으면 넣지 못했다는 알림만 띄운다
        const questContext = () => {
            const ctx = appContext();
            const quest = { id: 'mainQuest', title: '최종 평가', description: '종합 과제', status: 'pending', images: {} };
            openSubject(ctx, [lessonOf({ tabs: { basicLearn: PRAC_DRAFT } })], { mainQuest: quest });
            ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind, saved: ctx.saved });
            vm.runInContext('cleanForAPI = text => String(text || "");', ctx);
            ctx.ai = route(ctx, { main: () => reply(QUESTION_MD), comment: commentReply() });
            return { ctx, quest };
        };
        const made = questContext();
        await call(made.ctx, 'generateMainQuest')();
        assert.ok(made.quest.content.includes(NOTE), made.quest.content);
        assert.deepStrictEqual(made.ctx.toasts.map(toast => [toast.message, toast.kind, toast.saved > 0]), [['최종 평가 코드 블록 1개에 주석을 넣었습니다.', 'success', true]]);
        const lost = questContext();
        vm.runInContext('processImageTags = async (m, md) => { globalState.subjects.splice(0, globalState.subjects.length); return md; };', lost.ctx);
        await call(lost.ctx, 'generateMainQuest')();
        assert.deepStrictEqual(lost.ctx.toasts.map(toast => [toast.message, toast.kind]), [['최종 평가를 만드는 동안 그 교과를 지웠거나 백업·PC 폴더를 불러와, 만든 최종 평가를 넣지 못했습니다.', 'warning']]);
    });

    await run('검토 N3-01: 탭을 묶어 만들 때(전체 생성·탭 모두 다시 만들기·일괄 생성) 주석 단계에서 중지하면 중지로 남은 블록 수를 멈춘 알림에 적고, 중지하지 않았거나 남은 블록이 없으면 적지 않는다', async () => {
        const STOP_NOTE = left => `중지해서 코드 블록 ${left}개에는 주석을 넣지 못했습니다. 도구의 '코드 주석 넣기'로 이어서 넣을 수 있습니다.`;
        const stopNotes = ctx => [...ctx.toasts.map(toast => toast.message), ...ctx.alerts].filter(text => text.includes('중지해서'));
        // 코드 블록 count개를 든 글(주석은 한 번에 8블록씩 받는다)
        const practice = count => Array.from({ length: count }, (_, i) => `## ${i + 1}. 실습 ${i + 1} (⏱ 10분)\n\n실습 ${i + 1}을 합니다.\n\n${PY(`step_${i} = ${i}`, `print(step_${i})`)}`).join('\n\n');
        const OTHER = '## 1. 글 (⏱ 30분)\n\n글뿐입니다.';
        // 기본실습만 빈 차시(교수안이 있고 학습 목표가 없어 전체 생성은 기본실습만 만든다). 분량 채우기는 받은 글 그대로 둔다(목표를 넘어 낭독 분량 안내가 붙지 않는다).
        // 탭마다 코드 블록 count개를 든 글을 받고, 첫 주석 호출 때 stop(중지)을 누른다. answer: 주석 답
        const lessonRun = ({ count, stop = null, answer = commentReply() }) => {
            const ctx = appContext();
            const gyosuan = { docMd: '# 교수안', deckMd: '#' };
            const mod = lessonOf({ tabs: { basicLearn: OTHER, advLearn: OTHER, advPrac: OTHER, assessment: OTHER, advAssessment: OTHER }, gyosuan, gyosuanAdv: { ...gyosuan } });
            openSubject(ctx, [mod]);
            vm.runInContext(`ensureSpokenVolume = async opts => ({ md: opts.md, spoken: 0, minutes: 0, targetMinutes: 480, targetChars: 1, calls: 0, added: 0, short: false, stopped: false, gone: false, error: null, reason: 'none', parts: [] });
                renderOverviewLNB = () => {};`, ctx);
            ['lesson-run-body', 'lesson-run-footer', 'lesson-run-status'].forEach(id => { ctx.elements[id] = fakeElement(); });
            let pressed = false;
            ctx.ai = route(ctx, {
                tab: () => reply(practice(count)), fix: () => reply(''),
                comment: item => {
                    if (stop && !pressed) {
                        pressed = true;
                        stop(ctx);
                    }
                    return answer(item);
                }
            });
            return { ctx, mod };
        };
        const barStop = ctx => call(ctx, 'requestLessonPipelineStop')(); // 진행 막대의 '중지'
        const dialogStop = ctx => call(ctx, 'onLessonRunClick')({ target: Object.assign(fakeElement(), { dataset: { runAction: 'stop' } }) }); // 일괄 생성 창의 '중지'
        const badAnswer = swapAnswer('= ', '== '); // 코드를 바꾼 답(확인이 버려 중지하지 않아도 블록이 남는다)

        // 전체 생성: 기본학습이 아닌 탭(기본실습)의 주석 단계에서 중지하면 끝 알림에 남은 블록을 적는다
        const pipe = lessonRun({ count: 12, stop: barStop });
        await call(pipe.ctx, 'runLessonPipeline')(1);
        assert.strictEqual(callsOf(pipe.ctx, 'comment').length, 1, '받던 묶음까지만 넣는다');
        assert.strictEqual(needsOf(pipe.ctx, pipe.mod.tabContents.basicPrac), 4);
        assert.deepStrictEqual(pipe.ctx.toasts.at(-1), { message: `전체 생성을 중지했습니다. 만든 내용은 저장했습니다. ${STOP_NOTE(4)}`, kind: 'warning' });
        assert.strictEqual(stopNotes(pipe.ctx).length, 1, '한 번만 알린다');
        // 중지했지만 남은 블록이 없거나, 중지하지 않았으면 적지 않는다
        const pipeFull = lessonRun({ count: 8, stop: barStop });
        await call(pipeFull.ctx, 'runLessonPipeline')(1);
        assert.strictEqual(needsOf(pipeFull.ctx, pipeFull.mod.tabContents.basicPrac), 0);
        assert.deepStrictEqual(pipeFull.ctx.toasts.at(-1), { message: '전체 생성을 중지했습니다. 만든 내용은 저장했습니다.', kind: 'warning' });
        const pipeBad = lessonRun({ count: 2, answer: badAnswer });
        await call(pipeBad.ctx, 'runLessonPipeline')(1);
        assert.strictEqual(needsOf(pipeBad.ctx, pipeBad.mod.tabContents.basicPrac), 2);
        assert.ok(pipeBad.ctx.toasts.some(toast => toast.kind === 'warning' && toast.message.startsWith('기본실습 코드 블록 2개는 주석을 다 넣지 못했습니다.')), '중지하지 않고 남은 블록은 지금처럼 탭마다 알린다');
        assert.deepStrictEqual(pipeBad.ctx.toasts.at(-1), { message: '전체 생성을 마쳤습니다.', kind: 'success' });
        assert.deepStrictEqual(stopNotes(pipeBad.ctx), []);
        // 만들지 못한 항목이 있거나 그림 자리를 남겨 창으로 알릴 때도 적는다
        const summary = call(pipe.ctx, 'pipelineSummary');
        const stoppedRun = { kind: 'all', stopped: true, moved: false, halted: false, failed: [], skipped: [], partial: [], short: [], imageNote: '', commentLeft: 3 };
        assert.ok(summary({ ...stoppedRun, failed: ['심화학습: 오류'] }).alert.includes(`\n\n${STOP_NOTE(3)}\n\n`), summary({ ...stoppedRun, failed: ['심화학습: 오류'] }).alert);
        assert.strictEqual(summary({ ...stoppedRun, imageNote: '그림 안내' }).alert, `전체 생성을 중지했습니다. 만든 내용은 저장했습니다. ${STOP_NOTE(3)}\n\n그림 안내`);

        // 탭 모두 다시 만들기: 멈춘 창에 남은 블록을 적는다(첫 탭 기본학습에서 중지)
        const all = lessonRun({ count: 12, stop: barStop });
        await call(all.ctx, 'generateAllTabs')(1);
        assert.strictEqual(needsOf(all.ctx, all.mod.tabContents.basicLearn), 4);
        assert.deepStrictEqual(all.ctx.alerts, [`전체 탭 생성을 중단했습니다. 받은 내용까지 저장했습니다. ${STOP_NOTE(4)}`]);
        const allFull = lessonRun({ count: 8, stop: barStop });
        await call(allFull.ctx, 'generateAllTabs')(1);
        assert.deepStrictEqual(allFull.ctx.alerts, ['전체 탭 생성을 중단했습니다. 받은 내용까지 저장했습니다.']);
        const allBad = lessonRun({ count: 2, answer: badAnswer });
        await call(allBad.ctx, 'generateAllTabs')(1);
        assert.deepStrictEqual(allBad.ctx.toasts.at(-1), { message: '교안 탭을 모두 다시 만들었습니다. 이전 글은 작업 기록에 남았습니다.', kind: 'success' });
        assert.deepStrictEqual(stopNotes(allBad.ctx), []);

        // 일괄 생성(이 교과): 창의 '중지'를 누르면 보고에 남은 블록을 적는다
        const bulk = lessonRun({ count: 12, stop: dialogStop });
        await call(bulk.ctx, 'startLessonRun')('subject');
        const report = bulk.ctx.elements['lesson-run-body'].innerHTML;
        assert.strictEqual(needsOf(bulk.ctx, bulk.mod.tabContents.basicPrac), 4);
        assert.ok(report.includes('중지했습니다') && report.includes(call(bulk.ctx, 'escapeHtml')(STOP_NOTE(4))), report);
        const bulkFull = lessonRun({ count: 8, stop: dialogStop });
        await call(bulkFull.ctx, 'startLessonRun')('subject');
        const fullReport = bulkFull.ctx.elements['lesson-run-body'].innerHTML;
        assert.ok(fullReport.includes('중지했습니다') && !fullReport.includes('주석'), fullReport);
        const bulkBad = lessonRun({ count: 2, answer: badAnswer });
        await call(bulkBad.ctx, 'startLessonRun')('subject');
        const badReport = bulkBad.ctx.elements['lesson-run-body'].innerHTML;
        assert.ok(badReport.includes('일괄 생성을 마쳤습니다 · 완료 1개') && !badReport.includes('주석'), badReport);
    });

    await run('검토 V2-06: 학습 목표 세트 추가는 주석을 넣지 못하면 미리보기 안내에 적는다', async () => {
        const ctx = appContext();
        vm.runInContext(source('lesson-objectives.js'), ctx);
        const learn = `${LEARN_GOALS}\n\n## 1. 합계 (⏱ 30분)\n\n합계를 구합니다.\n\n## 학습 후 체크리스트\n\n- 합계를 구할 수 있다 (다시 보기: 1. 합계)`;
        const mod = lessonOf({ tabs: { basicLearn: learn } });
        openSubject(ctx, [mod]);
        ['objective-hint', 'objective-status'].forEach(id => { ctx.elements[id] = fakeElement(); });
        const section = `## 2. 점수 (⏱ 30분)\n\n점수를 셉니다.\n\n${PY('score = 0', 'score += 1', 'print(score)')}`;
        ctx.ai = route(ctx, {
            other: () => reply(JSON.stringify({ objective: '점수를 세는 코드를 작성할 수 있습니다.', section, checklist: '점수를 셀 수 있다 (다시 보기: 2. 점수)' })),
            comment: swapAnswer('score = 0', 'score = 1')
        });
        await call(ctx, 'runObjectiveAdd')(mod, 'basicLearn', fakeElement());
        assert.strictEqual(ctx.previews[0].opts.note, '코드 블록 1개는 주석을 다 넣지 못했습니다.');
    });

    await run('검토 V2-03: 문제은행 문항 생성은 문항 코드에 주석을 다 넣지 못하면 창 상태 글과 전체 생성 알림에 적는다', async () => {
        const ctx = appContext();
        const mod = lessonOf({ tabs: { basicLearn: LEARN } });
        openSubject(ctx, [mod]);
        vm.runInContext("crossCheckModel = () => null; keepQbankDraft = () => {}; renderQbank = () => {}; _qbank = { moduleId: 1, spec: { objective: 1, band: 'L2', type: '코드제출', count: 1 } };", ctx);
        const DRAFT = ['### 문제 1. 합계 구하기', '학습 목표 1 · 밴드 L2 · 코드제출', '', '빈칸을 채워 합계를 출력합니다.', '', '🧩 **시작 코드:**', '', PY('total = ___', 'print(total)'), '', '🧪 **테스트:** 입력 없음 → 6', '', '📝 **해설:** 반복문으로 더합니다.'].join('\n');
        const NOTE_TEXT = "문항 코드 블록 1개에는 주석을 다 넣지 못했습니다. 문제은행 탭의 'AI 수정 제안'이나 도구의 '코드 주석 넣기'로 다시 넣을 수 있습니다.";
        // 주석 답이 빈칸을 채워 코드를 바꿨다(확인이 버린다)
        ctx.ai = route(ctx, { qgen: () => reply(DRAFT), comment: swapAnswer('___', '0') });
        await call(ctx, 'runQuestionGenerate')(mod);
        assert.strictEqual(vm.runInContext('_qbank.status', ctx), `기본학습 문제은행에 1문항을 추가했습니다. ${NOTE_TEXT}`);
        // 주석을 넣으면 덧붙이지 않는다
        ctx.ai = route(ctx, { qgen: () => reply(DRAFT), comment: commentReply() });
        await call(ctx, 'runQuestionGenerate')(mod);
        assert.strictEqual(vm.runInContext('_qbank.status', ctx), '기본학습 문제은행에 1문항을 추가했습니다.');
        // 전체 생성의 문제은행 채우기(lesson-pipeline.js fillQuestionBank)
        const fill = appContext();
        const lesson = lessonOf({ tabs: { basicLearn: LEARN } });
        openSubject(fill, [lesson]);
        vm.runInContext('crossCheckModel = () => null;', fill);
        const CHOICE = ['### 문제 1. 출력 고르기', '학습 목표 1 · 밴드 L1 · 객관식', '', '다음 코드의 출력을 고릅니다.', '', PY('print(1 + 2)'), '', '① 1 ② 2 ③ 3 ④ 4', '', '✅ **정답:** ③', '', '📝 **해설:** 두 수를 더합니다.'].join('\n');
        fill.ai = route(fill, { qgen: () => reply(CHOICE), comment: () => { throw new Error('연결이 끊겼습니다'); } });
        assert.ok((await call(fill, 'fillQuestionBank')(1)).ok);
        assert.ok(fill.toasts.some(toast => toast.kind === 'warning' && toast.message === `기본학습 문제은행의 ${NOTE_TEXT}`), JSON.stringify(fill.toasts));
    });

    /* ---------- 작업 기록 ---------- */
    await run('검토 V2-02: 최종 평가·탭이 없는 옛 차시의 \'코드 주석 넣기 전\' 기록은 확인 창을 거쳐 제자리로 되돌아간다', async () => {
        const ctx = appContext();
        const legacyBody = '## 1. 질의 (⏱ 30분)\n\n표를 만듭니다.\n\n```sql\nCREATE TABLE t (id INT);\nINSERT INTO t VALUES (1);\n```';
        const quest = { id: 'mainQuest', title: '최종 평가', status: 'done', images: {}, content: QUESTION_MD };
        const legacy = { id: 3, title: 'SQL 옛 차시', status: 'done', images: {}, content: legacyBody };
        const s2 = { id: 's2', title: '데이터 다루기', lessons: [legacy] };
        openSubject(ctx, [lessonOf({ title: '글만 있는 차시', tabs: { basicLearn: '## 1. 글 (⏱ 30분)\n\n글뿐입니다.' } })], { mainQuest: quest, others: [s2] });
        ctx.ai = route(ctx, { comment: commentReply() });
        await call(ctx, 'startCodeComments')('course');
        assert.ok(quest.content.includes(NOTE) && legacy.content.includes(NOTE));
        const entries = ctx.archived.filter(item => item.reason === HISTORY_REASON).map(item => item.entry);
        vm.runInContext(`contentHistory = window.archived.map(item => item.entry);`, ctx);
        for (const entry of entries) await call(ctx, 'restoreHistoryItem')(entry.id); // 진짜 되돌리기(확인 창은 '되돌리기'를 누른다)
        assert.deepStrictEqual([quest.content, legacy.content], [QUESTION_MD, legacyBody], '제자리로 되돌린다');
        assert.ok(!vm.runInContext('courseData', ctx).some(lesson => /\(되살림\)/.test(lesson.title)), '새 차시로 되살리지 않는다');
        assert.ok(ctx.confirms.slice(-2).every(item => item.message.includes('의 내용을 이 기록(오늘)으로 되돌립니다.')), JSON.stringify(ctx.confirms.slice(-2)));
        assert.deepStrictEqual(entries.map(entry => [entry.subjectId, entry.lessonId, entry.tabId]), [['s1', 'mainQuest', 'basicLearn'], ['s2', 3, 'basicLearn']], '탭이 없는 칸은 탭 하나 기록으로 남긴다');
        assert.ok(!('tabContents' in quest) && !('tabContents' in legacy), '탭이 없는 꼴은 그대로');
        // 예전에 탭으로 만든 최종 평가는 고친 탭마다 탭 하나 기록으로 남겨 그 탭으로 되돌린다(차시 전체 기록은 최종 평가를 찾지 못한다)
        const tabbed = appContext();
        const learnTab = `## 과제\n\n${PY('total = 0', 'print(total)')}`;
        const oldQuest = { id: 'mainQuest', title: '최종 평가', status: 'done', images: {}, tabContents: { basicLearn: learnTab, assessment: QUESTION_MD }, content: `${learnTab}\n\n---\n\n${QUESTION_MD}` };
        openSubject(tabbed, [lessonOf({ title: '글만 있는 차시', tabs: { basicLearn: '## 1. 글 (⏱ 30분)\n\n글뿐입니다.' } })], { mainQuest: oldQuest });
        tabbed.ai = route(tabbed, { comment: commentReply() });
        await call(tabbed, 'startCodeComments')('subject');
        const records = tabbed.archived.filter(item => item.reason === HISTORY_REASON).map(item => item.entry);
        assert.deepStrictEqual(records.map(entry => [entry.lessonId, entry.tabId, entry.title]), [['mainQuest', 'basicLearn', '최종 평가 · 기본학습'], ['mainQuest', 'assessment', '최종 평가 · 학습이해도']]);
        vm.runInContext(`contentHistory = window.archived.map(item => item.entry);`, tabbed);
        for (const entry of records) await call(tabbed, 'restoreHistoryItem')(entry.id);
        assert.deepStrictEqual([oldQuest.tabContents.basicLearn, oldQuest.tabContents.assessment], [learnTab, QUESTION_MD]);
        assert.ok(!vm.runInContext('courseData', tabbed).some(lesson => /\(되살림\)/.test(lesson.title)));
    });

    finish();
})();
