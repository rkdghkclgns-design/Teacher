// 일괄 생성·블록 편집·다시 설계·묶음 내려받기 테스트 (실행: node tests/course-flow.test.js)
// AI 응답과 화면 갱신만 스텁으로 두고 실제 tabs.js, course-flow.js, course-design*.js를 실행한다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', 'js') + path.sep;
const FILES = ['kbuilder/ncs-catalog.js', 'course-ncs.js', 'course-design.js', 'course-design-edit.js', 'course-sessions.js', 'course-meta.js', 'lesson-editor-tools.js', 'tabs.js', 'course-flow.js'];
const TABS = [['basicLearn', '기본 학습'], ['basicPrac', '기본 실습'], ['advLearn', '심화 학습'], ['advPrac', '심화 실습'], ['assessment', '학습 이해도']].map(([id, label]) => ({ id, label }));
const TAB_IDS = TABS.map(tab => tab.id);

const reply = text => ({ candidates: [{ content: { parts: [{ text: typeof text === 'string' ? text : JSON.stringify(text) }] } }] });
const plain = value => JSON.parse(JSON.stringify(value));
const escapeHtml = s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : '');

function makeContext(callGemini = async () => reply('## 본문\n\n내용')) {
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: fn => { fn(); return 0; }, // 탭 사이 대기를 건너뛴다
        clearTimeout() {}, Promise, URL, Blob,
        LESSON_TABS: TABS,
        TEXT_MODEL: 'gemini-4-argon', apiKey: 'k', claudeApiKey: '', isClaudeModel: () => false,
        CONTEXT_CORE: { personas: { orchestrator: '설계자' } },
        globalState: { courseTitle: '과정', subjects: [] },
        courseData: [], currentSubjectId: null, currentEditingModuleId: null,
        alerts: [], toasts: [], viewed: [], switched: [], archived: [], saves: 0,
        elements: { 'editor-loading': { style: {} } },
        escapeHtml, safeJSONParse: t => JSON.parse(t), extractText: d => d.candidates[0].content.parts[0].text,
        document: { getElementById: id => ctx.elements[id] || null, createElement: () => ({}), head: { appendChild() {} } },
        getEditingModule: id => ctx.courseData.find(mod => String(mod.id) === String(id)),
        openEditor: id => {
            ctx.switched.push(id);
            ctx.currentSubjectId = id;
            ctx.courseData = ctx.globalState.subjects.find(subject => subject.id === id).lessons;
        },
        viewModule: id => ctx.viewed.push(id),
        buildTaskContext: (scope, args) => ({ systemInstruction: '지시', userPrompt: `${scope}:${args.tabId}:${args.title}` }),
        archiveContent: async item => { ctx.archived.push(item.title); },
        saveState: async () => { ctx.saves += 1; },
        showLessonView() {}, renderSidebar() {}, renderEditor() {}, renderOverview() {}, renderOverviewLNB() {},
        confirm: () => true,
        callGemini
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, type) => ctx.toasts.push({ message, type });
    vm.createContext(ctx);
    FILES.forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), ctx));
    return ctx;
}

const emptyTabs = () => ({ basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null });
const lesson = (id, tabContents = emptyTabs(), extra = {}) => ({ id, title: `차시 ${id}`, description: '설명', status: 'waiting', content: null, images: {}, tabContents, ...extra });

async function run(name, fn) {
    await fn();
    console.log('PASS', name);
}

(async () => {
    const ctx = makeContext();
    const call = name => vm.runInContext(name, ctx);
    const missing = mod => plain(call('lessonMissingTabs')(mod));

    await run('남은 탭 판별: 합본 글을 기본 학습으로 착각하지 않음', async () => {
        assert.deepStrictEqual(missing(lesson(1)), TAB_IDS);
        assert.deepStrictEqual(missing(lesson(1, { ...emptyTabs(), basicLearn: '본문' })), TAB_IDS.slice(1));
        assert.deepStrictEqual(missing(lesson(1, undefined, { tabContents: undefined, content: '옛 단일 본문' })), TAB_IDS.slice(1), '탭이 없는 옛 본문은 기본 학습이다');
        assert.deepStrictEqual(missing(lesson(1, { ...emptyTabs(), assessment: '평가' }, { content: '평가' })), TAB_IDS.slice(0, 4), '탭을 합친 content는 기본 학습이 아니다');
        assert.deepStrictEqual(missing(lesson(1, Object.fromEntries(TAB_IDS.map(id => [id, '내용'])))), []);
    });

    await run('옛 본문 옮기기: 탭 합본은 복사하지 않음', async () => {
        const legacy = lesson(1, emptyTabs(), { content: '옛 본문' });
        call('migrateMonolithicContent')(legacy);
        assert.strictEqual(legacy.tabContents.basicLearn, '옛 본문');
        const joined = lesson(2, { ...emptyTabs(), assessment: '평가' }, { content: '평가' });
        call('migrateMonolithicContent')(joined);
        assert.strictEqual(joined.tabContents.basicLearn, null, '다음에 열어도 기본 학습 탭이 합본으로 채워지지 않는다');
    });

    await run('대기열: 빈 탭이 있는 차시만, 업로드 차시는 제외', async () => {
        const subjects = [
            { id: 's1', title: '교과1', lessons: [lesson(1), lesson(2, Object.fromEntries(TAB_IDS.map(id => [id, '내용']))), { id: 'mainQuest', title: '퀘스트' }] },
            { id: 's2', title: '교과2', lessons: [lesson(3, { ...emptyTabs(), basicLearn: '본문' }), lesson(4, emptyTabs(), { uploadedMdContent: '# 업로드' })] },
            { id: 's3', title: '빈 교과' }
        ];
        assert.deepStrictEqual(plain(call('pendingLessons')(subjects)).map(item => item.lessonId), [1, 3, 4]);
        assert.deepStrictEqual(plain(call('runnableLessons')(subjects)).map(item => item.lessonId), [1, 3], '탭 생성은 업로드 MD를 읽지 않는다');
    });

    const queueOf = (...ids) => ids.map(id => ({ lessonId: id, title: `차시 ${id}` }));

    await run('일괄 실행: 실패는 한 번 재시도 후 건너뛰고 끝까지 진행', async () => {
        const tries = {};
        const attempt = async item => {
            tries[item.lessonId] = (tries[item.lessonId] || 0) + 1;
            if (item.lessonId === 2) return { ok: false, error: '한도 초과' };
            if (item.lessonId === 3 && tries[3] === 1) throw new Error('일시 오류');
            return { ok: true };
        };
        const retried = [];
        const report = plain(await call('runLessonQueue')(queueOf(1, 2, 3, 4), attempt, { onRetry: item => retried.push(item.lessonId) }));
        assert.deepStrictEqual(tries, { 1: 1, 2: 2, 3: 2, 4: 1 }, '실패한 차시만 정확히 두 번');
        assert.deepStrictEqual(retried, [2, 3]);
        assert.deepStrictEqual(report.done.map(item => item.lessonId), [1, 3, 4]);
        assert.deepStrictEqual(report.failed.map(item => [item.lessonId, item.error]), [[2, '한도 초과']]);
        assert.strictEqual(report.stopped, false);
        assert.deepStrictEqual(report.left, []);
    });

    await run('일괄 실행: 중지는 다음 차시를 시작하지 않고 재시도도 하지 않음', async () => {
        let stopped = false;
        const seen = [];
        const attempt = async item => {
            seen.push(item.lessonId);
            if (item.lessonId === 2) stopped = true;
            return { ok: true };
        };
        const report = plain(await call('runLessonQueue')(queueOf(1, 2, 3, 4), attempt, { isStopped: () => stopped }));
        assert.deepStrictEqual(seen, [1, 2]);
        assert.deepStrictEqual(report.left.map(item => item.lessonId), [3, 4]);
        assert.strictEqual(report.stopped, true);

        let attempts = 0;
        const failing = async () => { attempts += 1; stopped = true; return { ok: false, error: '실패' }; };
        stopped = false;
        const noRetry = plain(await call('runLessonQueue')(queueOf(1, 2), failing, { isStopped: () => stopped }));
        assert.strictEqual(attempts, 1, '중지 뒤에는 재시도하지 않는다');
        assert.deepStrictEqual(noRetry.failed, [], '멈춘 차시는 실패가 아니라 남은 차시다');
        assert.deepStrictEqual(noRetry.left.map(item => item.lessonId), [1, 2]);

        let tries = 0;
        stopped = false;
        const waiting = plain(await call('runLessonQueue')(queueOf(1), async () => { tries += 1; return { ok: false, error: '한도' }; }, { isStopped: () => stopped, onRetry: () => { stopped = true; } }));
        assert.strictEqual(tries, 1, '재시도를 기다리는 동안 중지하면 다시 시도하지 않는다');
        assert.deepStrictEqual([waiting.stopped, waiting.left.length], [true, 1]);
    });

    await run('일괄 실행 화면: 끝나면 보고와 닫기 버튼을 보여 주고, 화면 갱신이 실패해도 닫을 수 있음', async () => {
        const start = local => vm.runInContext('startLessonRun', local)('subject');
        const prepare = () => {
            const local = makeContext();
            const subject = { id: 's1', title: '교과', lessons: [lesson(1)] };
            local.globalState.subjects = [subject];
            local.currentSubjectId = 's1';
            local.courseData = subject.lessons;
            ['lesson-run-body', 'lesson-run-footer', 'lesson-run-status'].forEach(id => { local.elements[id] = { innerHTML: '', textContent: '' }; });
            return local;
        };
        const local = prepare();
        await start(local);
        assert.ok(local.elements['lesson-run-body'].innerHTML.includes('완료 1개'));
        assert.ok(local.elements['lesson-run-footer'].innerHTML.includes('data-run-action="close"'));
        assert.strictEqual(vm.runInContext('_lessonRun', local), null);

        const broken = prepare();
        broken.renderOverviewLNB = () => { throw new Error('그리기 실패'); };
        await start(broken);
        assert.ok(broken.elements['lesson-run-footer'].innerHTML.includes('data-run-action="close"'), '대화상자에 갇히지 않는다');
        assert.ok(broken.elements['lesson-run-body'].innerHTML.includes('그리기 실패'));
        assert.strictEqual(vm.runInContext('_lessonRun', broken), null);
    });

    await run('일괄 실행 시작: 전체 탭 생성이 대기 중일 때도 진행 중으로 봄', async () => {
        const local = makeContext();
        const busy = () => vm.runInContext('generationBusy()', local);
        assert.strictEqual(busy(), false);
        local.elements['editor-loading'].style.display = 'flex';
        assert.strictEqual(busy(), true);
        local.elements['editor-loading'].style.display = 'none';
        vm.runInContext('_suppressTabAlert = true', local);
        assert.strictEqual(busy(), true, '탭 사이 대기로 로딩 화면이 내려간 때');
    });

    await run('일괄 실행: 일부 누락 표시는 재시도 뒤에도 남음', async () => {
        const results = [{ ok: false, partial: true, error: '둘째 탭 실패' }, { ok: true, partial: false }];
        const report = plain(await call('runLessonQueue')(queueOf(1), async () => results.shift()));
        assert.deepStrictEqual(report.done.map(item => item.lessonId), [1]);
        assert.deepStrictEqual(report.partial.map(item => item.lessonId), [1]);
    });

    // AI 호출을 탭 이름으로 구분한다
    const tabOf = payload => (payload.contents[0].parts[0].text.match(/tab_content(?:_continue)?:(\w+)/) || [])[1];

    await run('빈 탭 채우기: 있는 탭은 건드리지 않고 알림 없이 결과만 돌려줌', async () => {
        const calls = [];
        const aiCtx = makeContext(async (model, payload) => { calls.push(tabOf(payload)); return reply(`## ${tabOf(payload)}\n\n생성`); });
        const mod = lesson(1, { ...emptyTabs(), basicLearn: '손댄 본문', advLearn: '손댄 심화' }, { content: '손댄 본문' });
        aiCtx.courseData = [mod];
        const result = plain(await vm.runInContext('fillMissingTabs', aiCtx)(1));
        assert.deepStrictEqual(result, { ok: true, partial: false });
        assert.deepStrictEqual(calls, ['basicPrac', 'advPrac', 'assessment']);
        assert.strictEqual(mod.tabContents.basicLearn, '손댄 본문');
        assert.strictEqual(mod.tabContents.advLearn, '손댄 심화');
        assert.ok(mod.tabContents.assessment.includes('생성'));
        assert.deepStrictEqual(plain(aiCtx.alerts), [], '일괄 실행 중에는 알림창을 띄우지 않는다');
    });

    await run('빈 탭 채우기: 첫 실패에서 멈추고 재시도는 빈 탭만 생성', async () => {
        const calls = [];
        let failing = true;
        const aiCtx = makeContext(async (model, payload) => {
            const tab = tabOf(payload);
            calls.push(tab);
            if (tab === 'basicPrac' && failing) { failing = false; throw new Error('status: 429'); }
            return reply(`## ${tab}\n\n생성`);
        });
        const mod = lesson(1);
        aiCtx.courseData = [mod];
        const fill = vm.runInContext('fillMissingTabs', aiCtx);
        const first = plain(await fill(1));
        assert.strictEqual(first.ok, false);
        assert.ok(first.error.includes('429'), first.error);
        assert.deepStrictEqual(calls, ['basicLearn', 'basicPrac'], '실패한 탭 뒤로 진행하지 않는다');
        assert.deepStrictEqual(plain(aiCtx.alerts), []);
        calls.length = 0;
        assert.strictEqual((await fill(1)).ok, true);
        assert.deepStrictEqual(calls, TAB_IDS.slice(1), '성공한 기본 학습은 다시 만들지 않는다');
    });

    await run('탭 생성: 빈 응답은 실패로 처리하고 저장하지 않음', async () => {
        const aiCtx = makeContext(async () => reply('   '));
        const mod = lesson(1);
        aiCtx.courseData = [mod];
        const result = await vm.runInContext('fillMissingTabs', aiCtx)(1);
        assert.strictEqual(result.ok, false);
        assert.ok(result.error.includes('비어 있습니다'), result.error);
        assert.strictEqual(mod.tabContents.basicLearn, null);
        assert.strictEqual(mod.status, 'waiting');
    });

    await run('탭 생성: 단독 실행은 지금처럼 실패를 알림으로 보여 줌', async () => {
        const aiCtx = makeContext(async () => { throw new Error('장애'); });
        aiCtx.courseData = [lesson(1)];
        const result = await vm.runInContext('generateTabContent', aiCtx)(1, 'basicLearn');
        assert.strictEqual(result.ok, false);
        assert.strictEqual(aiCtx.alerts.length, 1);
        assert.ok(aiCtx.alerts[0].includes('장애'));
    });

    await run('탭 생성: 이어쓰기 실패는 일부 누락으로 보고하고 옵션은 이어쓰기에도 전달', async () => {
        const prompts = [];
        const aiCtx = makeContext(async (model, payload) => {
            const text = payload.contents[0].parts[0].text;
            prompts.push(text);
            if (prompts.length === 1) return reply('## 앞부분\n\n본문 <!-- CONTINUE -->');
            if (prompts.length === 2) return reply('## 뒷부분\n\n본문 <!-- CONTINUE -->');
            throw new Error('status: 429');
        });
        aiCtx.globalState.courseDesign = { genOptions: { level: '비전공 입문' } };
        const mod = lesson(1, emptyTabs(), { objectives: ['반복되면 안 되는 목표'] });
        aiCtx.courseData = [mod];
        const result = plain(await vm.runInContext('generateTabContent', aiCtx)(1, 'basicLearn', { quiet: true }));
        assert.deepStrictEqual(result, { ok: true, partial: true });
        assert.ok(mod.tabContents.basicLearn.includes('앞부분') && mod.tabContents.basicLearn.includes('뒷부분'));
        assert.ok(prompts.slice(0, 2).every(text => text.includes('학습자 수준: 비전공 입문')), '첫 청크와 이어쓰기 모두 옵션을 받는다');
        assert.ok(prompts[0].includes('반복되면 안 되는 목표') && !prompts[1].includes('반복되면 안 되는 목표'), '이어쓰기에는 목표를 다시 주지 않는다');
    });

    await run('과정 전체 실행: 교과를 옮겨 가며 생성하고 실패 차시는 건너뜀', async () => {
        const aiCtx = makeContext(async (model, payload) => {
            if (payload.contents[0].parts[0].text.includes('tab_content:assessment:차시 2')) throw new Error('장애');
            return reply('## 본문\n\n내용');
        });
        const done = lesson(9, Object.fromEntries(TAB_IDS.map(id => [id, '기존'])));
        aiCtx.globalState.subjects = [
            { id: 's1', title: '교과1', lessons: [lesson(1), done] },
            { id: 's2', title: '교과2', lessons: [lesson(2), lesson(3)] }
        ];
        aiCtx.currentSubjectId = 's1';
        aiCtx.courseData = aiCtx.globalState.subjects[0].lessons;
        const runner = { stopped: false };
        const queue = vm.runInContext('runnableLessons', aiCtx)(aiCtx.globalState.subjects);
        const report = plain(await vm.runInContext('runLessonQueue', aiCtx)(queue, item => vm.runInContext('attemptLesson', aiCtx)(item, runner)));
        assert.deepStrictEqual(report.done.map(item => item.lessonId), [1, 3]);
        assert.deepStrictEqual(report.failed.map(item => item.lessonId), [2]);
        assert.deepStrictEqual(plain(aiCtx.switched), ['s2'], '다른 교과 차시 앞에서 한 번만 옮긴다');
        assert.deepStrictEqual(aiCtx.globalState.subjects[1].lessons.map(item => item.tabContents.basicLearn !== null), [true, true]);
        assert.strictEqual(done.tabContents.basicLearn, '기존');
        assert.deepStrictEqual(plain(vm.runInContext('lessonMissingTabs', aiCtx)(aiCtx.globalState.subjects[1].lessons[0])), ['assessment'], '실패한 차시는 만든 탭을 남겨 다음에 이어 간다');
    });

    await run('과정 전체 실행: 도중에 지운 차시는 실패로 보고', async () => {
        const aiCtx = makeContext();
        aiCtx.globalState.subjects = [{ id: 's1', title: '교과', lessons: [lesson(1)] }];
        aiCtx.currentSubjectId = 's1';
        aiCtx.courseData = [];
        const result = await vm.runInContext('attemptLesson', aiCtx)({ subject: aiCtx.globalState.subjects[0], lessonId: 1, title: '차시' }, { stopped: false });
        assert.strictEqual(result.ok, false);
        assert.ok(result.error.includes('찾지 못했습니다'));
    });

    await run('생성 옵션: 지정하지 않으면 프롬프트를 바꾸지 않음', async () => {
        const brief = call('lessonDesignBrief');
        assert.strictEqual(brief({ title: '기존 차시', gen: { objectives: '', level: '', length: '' } }), '');
        ctx.globalState.courseDesign = { genOptions: { objectives: '2', level: '비전공 입문', length: '' } };
        const text = brief({ title: '차시', gen: { level: '실무 경험자', objectives: '', length: '길게 (약 1,500자)' }, objectives: ['목표'] });
        assert.ok(text.includes('학습 목표 수: 2개'), '과정 기본값을 이어받는다');
        assert.ok(text.includes('학습자 수준: 실무 경험자') && !text.includes('비전공 입문'), '차시 값이 우선한다');
        assert.ok(text.includes('섹션 하나당 분량: 길게 (약 1,500자)'));
        assert.ok(text.includes('출력 형식과 구성 순서는 바꾸지 않습니다.'));
        ctx.globalState.courseDesign = undefined;
    });

    await run('생성 옵션: 선택 값과 이스케이프', async () => {
        const html = call('lessonGenFieldsHtml')('run', { level: '실무 경험자' });
        assert.ok(html.includes('value="실무 경험자" selected'));
        assert.ok(html.includes('id="run-gen-objectives"') && html.includes('1개'));
        const elements = { 'run-gen-objectives': { value: '3' }, 'run-gen-level': { value: '' } };
        const local = makeContext();
        Object.assign(local.elements, elements);
        assert.deepStrictEqual(plain(vm.runInContext('readLessonGenFields', local)('run')), { objectives: '3' }, '고른 값만 저장한다');
        local.elements['run-gen-objectives'] = { value: '' };
        const untouched = plain(vm.runInContext('withMetaHistory', local)({ reviewStatus: '작성중' }, { reviewStatus: '작성중', gen: vm.runInContext('readLessonGenFields', local)('run') }));
        assert.deepStrictEqual(untouched.history, [], '옵션을 고르지 않으면 변경 이력을 늘리지 않는다');
        const changed = plain(vm.runInContext('withMetaHistory', local)({ reviewStatus: '작성중' }, { reviewStatus: '작성중', gen: { level: '실무 경험자' } }));
        assert.ok(changed.history[0].note.includes('생성 옵션'));
    });

    await run('과정 공통 툴: 차시 툴이 없을 때만 이어받음', async () => {
        ctx.globalState.courseDesign = { tools: [{ name: 'Unity', version: '6' }] };
        const brief = call('lessonDesignBrief');
        assert.ok(brief({ title: '차시' }).includes('- Unity 6'));
        const own = brief({ title: '차시', tools: [{ name: 'Blender', version: '' }] });
        assert.ok(own.includes('- Blender') && !own.includes('Unity'));
        assert.strictEqual(call('designToolLines')(ctx.globalState.courseDesign.tools), 'Unity | 6');
        ctx.globalState.courseDesign = undefined;
    });

    await run('차시 시간 변경: 분·진행 단계를 함께 맞추고 원본은 유지', async () => {
        const flow = [{ phase: '도입', title: '시작', minutes: 10 }, { phase: '전개', title: '본문', minutes: 40 }, { phase: '정리', title: '끝', minutes: 10 }];
        const original = { id: 1, title: '차시', hours: 1, minutes: 60, flow };
        const next = plain(call('lessonWithHours')(original, '2'));
        assert.deepStrictEqual([next.hours, next.minutes], [2, 120]);
        assert.strictEqual(next.flow.reduce((sum, step) => sum + step.minutes, 0), 120);
        assert.deepStrictEqual(next.flow.map(step => step.title), ['시작', '본문', '끝'], '단계는 유지');
        assert.strictEqual(original.hours, 1);
        assert.strictEqual(flow[1].minutes, 40);
        const rounded = plain(call('lessonWithHours')({ id: 1, title: '차시' }, '1.1'));
        assert.deepStrictEqual([rounded.minutes, rounded.hours], [65, 1.08], '5분 단위로 맞추고 시수는 분과 왕복된다');
        assert.strictEqual(call('lessonMinutes')(rounded), 65);
        assert.strictEqual(rounded.flow, undefined, '진행 단계가 없는 차시에 새로 만들지 않는다');
        assert.strictEqual(plain(call('lessonWithHours')(original, '0.05')).minutes, 5, '최소 5분');
        ['', '0', '-1', 'abc'].forEach(value => assert.strictEqual(call('lessonWithHours')(original, value), null, value));
        const short = plain(call('lessonWithHours')(original, '0.1'));
        assert.strictEqual(short.flow.reduce((sum, step) => sum + step.minutes, 0), short.minutes, '단계를 담지 못하면 기본 흐름으로');
    });

    await run('차시 시간 입력: 잘못된 값은 저장하지 않고 안내', async () => {
        const local = makeContext();
        const mod = lesson(1, emptyTabs(), { hours: 2, minutes: 120 });
        local.courseData = [mod];
        await local.updateLessonHours('1', 'abc');
        assert.strictEqual(mod.hours, 2);
        assert.strictEqual(local.toasts[0].type, 'warning');
        await local.updateLessonHours('1', '1.5');
        assert.deepStrictEqual([mod.hours, mod.minutes], [1.5, 90]);
        assert.strictEqual(local.toasts.length, 1, '내용이 없으면 재생성 안내를 띄우지 않는다');
        mod.tabContents.basicLearn = '본문';
        await local.updateLessonHours('1', '2');
        assert.ok(local.toasts.at(-1).message.includes('다시 생성'));
        assert.ok(vm.runInContext('lessonHoursChip', local)({ id: 'lesson_1"x', hours: 1.5 }).includes('data-hours-lesson="lesson_1&quot;x"'));
    });

    const draftOf = () => plain(call('createCourseDesign')({ title: '과정', units: ['단원'], hours: [4] }, 4, '수강생'));

    await run('블록 편집: 초안을 새로 만들고 값을 다듬음', async () => {
        const draft = draftOf();
        const before = JSON.stringify(draft);
        const set = call('setDesignModuleField');
        const titled = plain(set(draft, 0, 0, 'title', '  새 제목 '));
        assert.strictEqual(titled.units[0].modules[0].title, '새 제목');
        assert.strictEqual(titled.edited, true);
        assert.strictEqual(JSON.stringify(draft), before, '원본 초안은 바뀌지 않는다');
        assert.strictEqual(plain(set(draft, 0, 0, 'title', '   ')).units[0].modules[0].title, draft.units[0].modules[0].title, '빈 제목은 무시');
        assert.strictEqual(plain(set(draft, 0, 0, 'minutes', '93')).units[0].modules[0].minutes, 95, '5분 단위');
        assert.strictEqual(plain(set(draft, 0, 0, 'minutes', '')).units[0].modules[0].minutes, 10, '최소 10분');
        assert.deepStrictEqual(plain(set(draft, 0, 0, 'objectives', '1. 첫째\n\n- 둘째\n셋째 ')).units[0].modules[0].objectives, ['첫째', '둘째', '셋째']);
    });

    await run('블록 편집: 고친 블록은 단원 시간을 바꿔도 사라지지 않음', async () => {
        const edited = call('setDesignModuleField')(draftOf(), 0, 0, 'title', '직접 고친 블록');
        const grown = plain(call('normalizeDesignUnit')({ ...edited.units[0], hours: 6 }));
        assert.strictEqual(grown.modules[0].title, '직접 고친 블록', '기본 블록으로 다시 만들지 않는다');
        assert.strictEqual(grown.modules.reduce((sum, module) => sum + module.minutes, 0), 360);
        const objectives = call('setDesignModuleField')(draftOf(), 0, 0, 'objectives', '제약 조건에 맞게 기획서를 작성할 수 있습니다.');
        assert.ok(plain(call('normalizeDesignUnit')({ ...objectives.units[0], hours: 2 })).modules[0].objectives.length === 1);
    });

    await run('진행 단계 편집: 추가·삭제·합계 불일치·맞추기', async () => {
        const draft = draftOf();
        const module = draft.units[0].modules[0];
        const added = plain(call('addDesignStep')(draft, 0, 0)).units[0].modules[0];
        assert.strictEqual(added.flow.length, module.flow.length + 1);
        assert.strictEqual(added.flow.at(-1).phase, '정리', '새 단계는 정리 앞에 들어간다');
        assert.strictEqual(added.flow.at(-2).title, '새 활동');
        assert.strictEqual(call('designFlowMatches')(added), false);
        assert.ok(call('designBlockStatusHtml')(added, 0, 0).includes('≠ 블록'));
        assert.ok(call('designBlockStatusHtml')(added, 0, 0).includes('data-design-action="fit-block"'));
        assert.ok(call('designBlockStatusHtml')(module, 0, 0).includes('✓'));

        const set = call('setDesignStepField');
        const changed = plain(set(draft, 0, 0, 0, 'minutes', '13')).units[0].modules[0];
        assert.strictEqual(changed.flow[0].minutes, 15);
        assert.strictEqual(plain(set(draft, 0, 0, 0, 'minutes', '0')).units[0].modules[0].flow[0].minutes, 5, '최소 5분');
        assert.strictEqual(plain(set(draft, 0, 0, 0, 'title', '새 도입')).units[0].modules[0].flow[0].title, '새 도입');
        assert.strictEqual(plain(set(draft, 0, 0, 0, 'phase', '없는 단계')).units[0].modules[0].flow[0].phase, module.flow[0].phase);

        const fitted = plain(call('fitDesignBlock')(plain(call('addDesignStep')(draft, 0, 0)), 0, 0)).units[0].modules[0];
        assert.strictEqual(fitted.flow.reduce((sum, step) => sum + step.minutes, 0), fitted.minutes);
        assert.strictEqual(fitted.flow.length, module.flow.length + 1, '맞추기는 단계를 지우지 않는다');

        const removed = plain(call('removeDesignStep')(draft, 0, 0, 1)).units[0].modules[0];
        assert.strictEqual(removed.flow.length, module.flow.length - 1);
        const single = { ...draft, units: [{ ...draft.units[0], modules: [{ ...module, flow: [module.flow[0]] }] }] };
        assert.strictEqual(plain(call('removeDesignStep')(single, 0, 0, 0)).units[0].modules[0].flow.length, 1, '마지막 단계는 지우지 않는다');
    });

    await run('시간 불일치: 단원·블록을 세고 시간 맞추기로 해소', async () => {
        const draft = draftOf();
        assert.strictEqual(call('designTimeMismatches')(draft), 0);
        const off = call('setDesignModuleField')(draft, 0, 0, 'minutes', '60');
        assert.strictEqual(call('designTimeMismatches')(off), 2, '단원 합계와 그 블록의 단계 합계');
        assert.ok(call('designUnitStatusHtml')(off.units[0], 0).includes('data-design-action="fit-unit"'));
        assert.strictEqual(call('designTimeMismatches')(call('designEditAction')(off, 'fit-unit', { unit: '0' })), 0);
        assert.strictEqual(call('designEditAction')(draft, 'draft', {}), null, '편집 동작이 아니면 null');
    });

    await run('블록 검사 표시: 3시간 초과·목표 수·문장 형식', async () => {
        const notes = plain(call('designModuleNotes')({ minutes: 200, objectives: ['게임을 이해한다.', 'a', 'b', 'c'] }));
        assert.ok(notes[0].includes('3시간') && notes[1].includes('3개 이하') && notes[2].startsWith('목표 1:'));
    });

    await run('화면: 사용자·AI 문자열은 이스케이프', async () => {
        const evil = '"><img src=x onerror=alert(1)>';
        const draft = plain(call('createCourseDesign')({ title: evil, units: [evil], hours: [2] }, 2, evil));
        draft.units[0].modules[0] = { ...draft.units[0].modules[0], title: evil, objectives: [evil], flow: [{ phase: '전개', title: evil, minutes: 120 }] };
        const html = [call('designUnitHtml')(draft.units[0], 0), call('designGoalHtml')('목표', evil, 'data-design-goal')].join('');
        assert.ok(!html.includes('<img'), html.slice(0, 200));
        vm.runInContext('resetDesignSessions()', ctx);
        vm.runInContext('_designSessionsOpen = new Set([0])', ctx);
        assert.ok(call('designSessionsHtml')(draft.units[0], 0).includes('<table'));
        assert.ok(!call('designSessionsHtml')(draft.units[0], 0).includes('<img'), '차시 구성표');
        vm.runInContext('resetDesignSessions()', ctx);
        const item = { subject: { title: evil }, title: evil, error: evil };
        const report = call('lessonRunReportHtml')({ done: [], partial: [item], failed: [item], left: [item], stopped: true });
        assert.ok(!report.includes('<img') && report.includes('남은 1개'));
        assert.ok(!call('lessonRunIntroHtml')([item], []).includes('<img'));
        assert.ok(!call('lessonRunProgressHtml')(item, 0, 2).includes('<img'));
        const notice = call('replanNoticeHtml')({ lessons: [lesson(1, emptyTabs(), { title: evil, content: '본문' })] });
        assert.ok(!notice.includes('<img') && notice.includes('내용이 있는 차시 1개'));
    });

    await run('차시 구성: 표와 화면이 같은 내용을 씀', async () => {
        const modules = [{ title: '블록', minutes: 120, flow: [{ phase: '전개', title: '본문', minutes: 120 }] }];
        const rows = plain(call('sessionRows')(modules));
        assert.deepStrictEqual(rows.map(row => row.title), ['블록 (1/2)', '블록 (2/2)']);
        assert.ok(call('sessionTableLines')(modules).join('\n').includes('2차시. 블록 (2/2)'));
        assert.deepStrictEqual(plain(call('sessionRows')([{ title: '빈 블록', minutes: 0, flow: [] }])), []);
        assert.deepStrictEqual(plain(call('sessionTableLines')([{ title: '빈 블록', minutes: 0, flow: [] }])), [], '시간이 없으면 표도 없다');
    });

    await run('과정 목표: 사용자가 적은 목표를 AI 제안보다 우선', async () => {
        const prompts = [];
        const aiCtx = makeContext(async (model, payload) => {
            const text = payload.contents[0].parts[0].text;
            prompts.push(text);
            return reply(text.includes('학습모듈(교육의 최소 단위 블록)') ? { modules: [{ title: '블록', minutes: 60, objectives: [], flow: [] }] } : { goal: 'AI 목표', hours: [1] });
        });
        const design = { ...vm.runInContext('createCourseDesign', aiCtx)({ title: '과정', units: ['단원'] }, 1, '수강생'), goal: '내가 적은 목표' };
        const { design: planned } = await vm.runInContext('planCourseDesign', aiCtx)(design);
        assert.strictEqual(planned.goal, '내가 적은 목표');
        assert.ok(prompts[1].includes('[과정 목표] 내가 적은 목표'), '블록 설계에도 쓴다');
    });

    await run('과정 목표: 같은 과정을 다시 나누면 초안·저장된 목표를 이어받음', async () => {
        const local = makeContext();
        const carried = title => vm.runInContext('carriedDesignGoal', local)(title);
        assert.strictEqual(carried('과정'), '');
        local.globalState.courseDesign = { title: '과정', goal: '저장된 목표' };
        assert.strictEqual(carried('과정'), '저장된 목표', '대화상자를 다시 열어도 잃지 않는다');
        assert.strictEqual(carried('다른 과정'), '', '다른 과정에는 넘기지 않는다');
        vm.runInContext("_designDraft = { title: '과정', goal: '초안 목표' }", local);
        assert.strictEqual(carried('과정'), '초안 목표', '초안이 우선한다');
    });

    await run('교과로 추가: 과정 공통 툴과 생성 옵션을 유지', async () => {
        const aiCtx = makeContext();
        aiCtx.apiKey = '';
        aiCtx.globalState.courseDesign = { tools: [{ name: 'Unity', version: '' }], genOptions: { level: '비전공 입문' } };
        vm.runInContext("_designDraft = createCourseDesign({ title: '과정', units: ['단원'], hours: [2] }, 2, '수강생')", aiCtx);
        vm.runInContext("_designDraft = { ..._designDraft, goal: '고친 목표' }", aiCtx);
        await vm.runInContext('applyCourseDesign', aiCtx)({ disabled: false });
        const saved = plain(aiCtx.globalState.courseDesign);
        assert.strictEqual(saved.goal, '고친 목표');
        assert.deepStrictEqual(saved.tools, [{ name: 'Unity', version: '' }]);
        assert.deepStrictEqual(saved.genOptions, { level: '비전공 입문' });
        assert.strictEqual(aiCtx.globalState.subjects.length, 1);
    });

    const PLAN = { modules: [{ title: '새 블록1', minutes: 60, objectives: ['설명할 수 있습니다.'], flow: [{ phase: '전개', title: '본문', minutes: 60 }] }, { title: '새 블록2', minutes: 60, objectives: [], flow: [] }] };

    function replanContext(ai) {
        const local = makeContext(ai);
        const filled = lesson(1, { ...emptyTabs(), basicLearn: '작성한 본문' }, { content: '작성한 본문', hours: 1 });
        const blank = lesson(2, emptyTabs(), { hours: 1 });
        const subject = { id: 's1', title: '교과', lessons: [filled, blank], ncs: { units: [{ code: 'C1' }] }, mainQuest: { id: 'mainQuest' } };
        local.globalState.subjects = [subject];
        local.currentSubjectId = 's1';
        local.courseData = subject.lessons;
        local.elements['replan-hours'] = { value: '2' };
        local.elements['replan-status'] = { textContent: '' };
        return { local, subject, filled, blank };
    }

    await run('블록 다시 설계: 이전 차시는 휴지통·보관함에 남고 NCS는 유지', async () => {
        const prompts = [];
        const { local, subject, filled, blank } = replanContext(async (model, payload) => { prompts.push(payload.contents[0].parts[0].text); return reply(PLAN); });
        local.globalState.courseDesign = { title: '게임 과정', goal: '과정 목표', target: '입문자' };
        await vm.runInContext('runSubjectReplan', local)({ disabled: false }, subject);
        assert.deepStrictEqual(plain(subject.lessons).map(item => item.title), ['새 블록1', '새 블록2']);
        assert.strictEqual(local.courseData, subject.lessons, '현재 교과면 편집 중인 목록도 바꾼다');
        assert.strictEqual(subject.lessons[0].status, 'waiting');
        assert.strictEqual(subject.lessonCount, 2);
        assert.deepStrictEqual(subject.ncs.units, [{ code: 'C1' }]);
        const trash = local.globalState.lessonTrash;
        assert.ok(trash[0].lesson === filled && trash[1].lesson === blank && trash.every(entry => entry.subjectId === 's1'));
        assert.strictEqual(filled.tabContents.basicLearn, '작성한 본문', '휴지통의 차시는 내용을 그대로 갖는다');
        assert.deepStrictEqual(plain(local.archived), ['차시 1'], '내용이 있는 차시만 보관함에 남긴다');
        assert.ok(prompts[0].includes('[과정] 게임 과정') && prompts[0].includes('[과정 목표] 과정 목표') && prompts[0].includes('2시간'));
        assert.ok(local.toasts[0].message.includes('이전 차시 2개'));
    });

    await run('블록 다시 설계: 실패하면 차시를 그대로 둠', async () => {
        const { local, subject, filled } = replanContext(async () => reply({ modules: [] }));
        const button = { disabled: false };
        await vm.runInContext('runSubjectReplan', local)(button, subject);
        assert.deepStrictEqual(subject.lessons.map(item => item.id), [1, 2]);
        assert.strictEqual(subject.lessons[0], filled);
        assert.strictEqual(local.globalState.lessonTrash, undefined);
        assert.ok(local.elements['replan-status'].textContent.includes('지금 차시는 그대로입니다'));
        assert.strictEqual(button.disabled, false, '다시 시도할 수 있다');
    });

    await run('블록 다시 설계: 닫은 뒤 도착한 응답은 버림', async () => {
        let resolve;
        const { local, subject } = replanContext(() => new Promise(done => { resolve = done; }));
        const pending = vm.runInContext('runSubjectReplan', local)({ disabled: false }, subject);
        vm.runInContext('closeSubjectReplan', local)();
        resolve(reply(PLAN));
        await pending;
        assert.deepStrictEqual(subject.lessons.map(item => item.id), [1, 2]);
        assert.strictEqual(local.globalState.lessonTrash, undefined);
    });

    await run('블록 다시 설계: 교과 시간 기본값과 내용 판별', async () => {
        assert.strictEqual(call('subjectPlanHours')({ lessons: [{ hours: 1.5 }, { hours: 1.5 }] }), 3);
        assert.strictEqual(call('subjectPlanHours')({ lessons: [{}], hours: 5 }), 5, '차시 시간이 없으면 교과 시간');
        assert.strictEqual(call('subjectPlanHours')({ lessons: [] }), 1);
        const has = call('lessonHasContent');
        assert.strictEqual(has(lesson(1)), false);
        assert.strictEqual(has(lesson(1, emptyTabs(), { gyosuan: { docMd: '교수안' } })), true);
        assert.strictEqual(has(lesson(1, emptyTabs(), { uploadedMdContent: '# 업로드' })), true);
        assert.strictEqual(has(lesson(1, { ...emptyTabs(), advPrac: '실습' })), true);
    });

    await run('휴지통: 다른 교과의 차시는 그 교과로 복원', async () => {
        const local = makeContext();
        const other = { id: 's2', title: '다른 교과', lessons: [] };
        local.globalState.subjects = [{ id: 's1', title: '현재', lessons: [] }, other];
        local.currentSubjectId = 's1';
        vm.runInContext('moveLessonsToTrash', local)([lesson(5)], 's2');
        assert.strictEqual(local.globalState.lessonTrash[0].subjectId, 's2');
        vm.runInContext('restoreLesson', local)(0);
        assert.deepStrictEqual(plain(other.lessons).map(item => item.id), [5]);
    });

    await run('묶음 내려받기: 차시 순서대로 한 파일, 머리말 제거, 없는 차시 안내', async () => {
        const doc = title => `---\n교과목: 교과\n주제: ${title}\nstatus: 초안(AI 생성)\n---\n\n# 교수안 - ${title}\n\n## 진행\n`;
        const deck = title => `---\n교과목: 교과\n---\n\n# 슬라이드 편성안 - ${title}\n\n## 슬라이드 편성\n`;
        const subject = {
            title: '교과',
            lessons: [
                { id: 1, title: '첫째', gyosuan: { docMd: doc('첫째'), deckMd: deck('첫째') } },
                { id: 2, title: '둘째' },
                { id: 3, title: '셋째', gyosuan: { docMd: doc('셋째') } }
            ]
        };
        const md = call('subjectBundleMd')(subject);
        assert.ok(md.startsWith('# 교수안·슬라이드 편성안 모음 - 교과'));
        assert.ok(md.indexOf('# 교수안 - 첫째') < md.indexOf('# 슬라이드 편성안 - 첫째') && md.indexOf('# 슬라이드 편성안 - 첫째') < md.indexOf('# 교수안 - 셋째'));
        assert.ok(md.includes('## 교수안이 아직 없는 차시\n\n- 둘째'));
        assert.ok(!md.includes('status: 초안'), '문서마다 붙은 머리말은 뺀다');
        assert.strictEqual(call('subjectBundleMd')({ title: '빈 교과', lessons: [{ id: 1, title: '차시' }] }), '');
    });

    await run('ZIP: 교수안·편성안 파일 목록', async () => {
        assert.deepStrictEqual(plain(call('lessonGyosuanFiles')({ gyosuan: { docMd: '교수안', deckMd: '편성안', deckHtml: null } })), [{ name: '06_교수안.md', content: '교수안' }, { name: '07_슬라이드편성안.md', content: '편성안' }]);
        assert.deepStrictEqual(plain(call('lessonGyosuanFiles')({ gyosuan: { docMd: '교수안' } })).map(file => file.name), ['06_교수안.md']);
        assert.deepStrictEqual(plain(call('lessonGyosuanFiles')({})), []);
    });

    await run('ZIP: 이미지 data URL 분리', async () => {
        const parts = call('zipImageParts');
        assert.deepStrictEqual(plain(parts('data:image/png;base64,QUJD')), { ext: 'png', data: 'QUJD' });
        assert.deepStrictEqual(plain(parts('data:image/jpeg;base64,QUJD')), { ext: 'jpeg', data: 'QUJD' });
        assert.deepStrictEqual(plain(parts('data:image/svg+xml;base64,PHN2Zz4=')), { ext: 'svg', data: 'PHN2Zz4=' }, '예제 차시의 SVG가 ZIP 전체를 실패시키지 않는다');
        assert.strictEqual(parts('data:image/svg+xml;charset=utf-8,%3Csvg%3E').data, '', 'base64가 아니면 건너뛴다');
        assert.strictEqual(parts('https://example.com/a.png').data, '');
        assert.strictEqual(parts(null).data, '');
    });

    console.log('ALL PASSED');
})().catch(e => { console.error('FAIL', e.stack || e.message); process.exit(1); });
