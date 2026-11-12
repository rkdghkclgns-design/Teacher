// 일괄 생성·블록 편집·다시 설계·묶음 내려받기 테스트 (실행: node tests/course-flow.test.js)
// AI 응답과 화면 갱신만 스텁으로 두고 실제 tabs.js, course-flow.js, course-design*.js를 실행한다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { loadLessonTracks } = require('./lesson-tracks');
const root = path.join(__dirname, '..', 'js') + path.sep;
const FILES = ['kbuilder/ncs-catalog.js', 'ai-errors.js', 'lesson-lint.js', 'lesson-opening.js', 'course-qbank.js', 'lesson-pipeline.js', 'ai-routing.js', 'course-ncs.js', 'course-design.js', 'course-design-edit.js', 'course-sessions.js', 'course-meta.js', 'lesson-editor-tools.js', 'lesson-attachments.js', 'tabs.js', 'course-flow.js'];
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
        TEXT_MODEL: 'gemini-4-argon', apiKey: 'k', claudeApiKey: '', isClaudeModel: () => false, needsElementAutoAssign: () => false,
        CONTEXT_CORE: { personas: { orchestrator: '설계자' } },
        globalState: { courseTitle: '과정', subjects: [] },
        courseData: [], currentSubjectId: null, currentEditingModuleId: null,
        alerts: [], toasts: [], viewed: [], switched: [], archived: [], saves: 0,
        elements: { 'editor-loading': { style: {} } },
        escapeHtml, safeJSONParse: t => JSON.parse(t), extractText: d => d.candidates[0].content.parts[0].text,
        document: { getElementById: id => ctx.elements[id] || null, createElement: () => ({}), head: { appendChild() {} }, body: { appendChild() {} } },
        getEditingModule: id => ctx.courseData.find(mod => String(mod.id) === String(id)),
        openEditor: id => {
            ctx.switched.push(id);
            ctx.currentSubjectId = id;
            ctx.courseData = ctx.globalState.subjects.find(subject => subject.id === id).lessons;
        },
        viewModule: id => ctx.viewed.push(id),
        buildTaskContext: (scope, args) => ({ systemInstruction: '지시', userPrompt: `${scope}:${args.tabId}:${args.title}` }),
        archiveContent: async item => { ctx.archived.push(item.title); },
        archiveContents: async items => { items.forEach(item => ctx.archived.push(item.title)); },
        saveState: async () => { ctx.saves += 1; },
        showLessonView() {}, renderSidebar() {}, renderEditor() {}, renderOverview() {}, renderOverviewLNB() {},
        // 브라우저 기본 확인 창을 쓰면 실패한다. 앱의 확인 창은 바로 승인한다(시험마다 바꿀 수 있다)
        confirm: () => { throw new Error('브라우저 기본 확인 창을 쓰면 안 된다'); },
        confirmAsync: async () => true,
        callGemini
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, type) => ctx.toasts.push({ message, type });
    vm.createContext(ctx);
    loadLessonTracks(ctx); // 갈래(기본학습·심화학습) 정의
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

    await run('일괄 실행 화면: 그림 모델이 막혀 남긴 자리 안내를 보고에 넣고, 연 그림 작업 기록은 끝에 한 번 닫는다', async () => {
        const start = local => vm.runInContext('startLessonRun', local)('subject');
        const prepare = ({ owns = true } = {}) => {
            const local = makeContext();
            const subject = { id: 's1', title: '교과', lessons: [lesson(1)] };
            local.globalState.subjects = [subject];
            local.currentSubjectId = 's1';
            local.courseData = subject.lessons;
            ['lesson-run-body', 'lesson-run-footer', 'lesson-run-status'].forEach(id => { local.elements[id] = { innerHTML: '', textContent: '' }; });
            local.ended = 0;
            local.beginImageRun = () => owns;
            local.endImageRun = () => { local.ended += 1; };
            local.imageRunNote = () => '그림 <메모>';
            return local;
        };
        const local = prepare();
        await start(local);
        const body = local.elements['lesson-run-body'].innerHTML;
        assert.ok(body.includes('완료 1개') && body.includes('그림 &lt;메모&gt;') && !body.includes('<메모>'), body);
        assert.strictEqual(local.ended, 1);

        const broken = prepare();
        broken.renderOverviewLNB = () => { throw new Error('그리기 실패'); };
        await start(broken);
        assert.ok(broken.elements['lesson-run-body'].innerHTML.includes('그리기 실패'));
        assert.ok(broken.elements['lesson-run-body'].innerHTML.includes('그림 &lt;메모&gt;'), '오류 화면에도 남긴 그림 자리 안내를 남긴다');
        assert.strictEqual(broken.ended, 1, '오류가 나도 닫는다');

        const other = prepare({ owns: false });
        await start(other);
        assert.ok(!other.elements['lesson-run-body'].innerHTML.includes('메모'), '다른 쪽이 연 기록의 안내는 보이지 않는다');
        assert.strictEqual(other.ended, 0, '연 쪽이 아니면 닫지 않는다');

        const report = { done: [], partial: [], failed: [], left: [], stopped: false };
        const html = call('lessonRunReportHtml')(report, { imageNote: '그림 <메모>' });
        assert.ok(html.includes('그림 &lt;메모&gt;') && !html.includes('<메모>'));
        assert.ok(!call('lessonRunReportHtml')(report).includes('text-amber-300'), '안내가 없으면 그 줄도 없다');
    });

    await run('일괄 실행: 예전 방식(기본·심화 네 탭을 함께 담은) 기본학습 교수안은 그대로 두고, 미리 보기와 보고에 그 차시와 심화 내용이 남는다는 것을 알린다', async () => {
        const local = makeContext();
        ['gyosuan.js', 'cost-estimate.js'].forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), local));
        const four ={ ...emptyTabs(), basicLearn: '## 기본\n\n기본 글', basicPrac: '## 기본 실습\n\n글', advLearn: '## 심화\n\n심화 글', advPrac: '## 심화 실습\n\n글', assessment: '### 문제 1. 가\n학습 목표 1 · 밴드 L1 · 객관식\n\n① 가\n② 나\n\n✅ **정답:** ②' };
        const legacyLesson = lesson(1, four, { title: '예전 차시' });
        legacyLesson.gyosuan = { docMd: '# 교수안 - 예전 차시', deckMd: '#', sourceKey: vm.runInContext('hashSource', local)(vm.runInContext('legacyLessonSource', local)(legacyLesson)) };
        const fresh = lesson(2, { ...four }, { title: '새 차시' });
        fresh.gyosuan = { docMd: '# 교수안 - 새 차시', deckMd: '#', sourceKey: vm.runInContext('hashSource', local)(vm.runInContext('collectLessonSource', local)(fresh, 'basic')) };
        assert.deepStrictEqual([vm.runInContext('isLegacyGyosuan', local)(legacyLesson), vm.runInContext('isLegacyGyosuan', local)(fresh)], [true, false]);
        const subject = { id: 's1', title: '교과', lessons: [legacyLesson, fresh] };
        local.globalState.subjects = [subject];
        local.currentSubjectId = 's1';
        local.courseData = subject.lessons;
        ['lesson-run-body', 'lesson-run-footer', 'lesson-run-status', 'lesson-run-queue', 'lesson-run-estimate'].forEach(id => { local.elements[id] = { innerHTML: '', textContent: '' }; });
        local.elements['lesson-run-gyosuan'] = { checked: true };
        local.elements['lesson-run-overwrite'] = { checked: false };
        local.document.querySelector = () => ({ disabled: false });
        local.localStorage = { getItem: () => null, setItem() {} };
        const built = [];
        local.runGyosuanGeneration = async (id, opts) => { built.push(`${id}:${opts.track}`); const mod = local.courseData.find(item => item.id === id); mod[opts.track === 'adv' ? 'gyosuanAdv' : 'gyosuan'] = { docMd: '#' }; return { ok: true }; };
        local.generateQuestions = async () => [];
        vm.runInContext('refreshLessonRunQueue', local)('subject');
        const queueHtml = local.elements['lesson-run-queue'].innerHTML;
        assert.ok(queueHtml.includes('예전 방식 기본학습 교수안을 그대로 두는 차시 1개') && queueHtml.includes('교과 · 예전 차시') && queueHtml.includes('심화 내용도 들어 있습니다'), queueHtml);
        assert.ok(!queueHtml.slice(queueHtml.indexOf('예전 방식 기본학습')).includes('새 차시'), '새 방식 교수안은 알리지 않는다');
        local.elements['lesson-run-overwrite'] = { checked: true };
        vm.runInContext('refreshLessonRunQueue', local)('subject');
        assert.ok(!local.elements['lesson-run-queue'].innerHTML.includes('예전 방식'), '모두 다시 만들면 교수안도 다시 만든다');
        local.elements['lesson-run-overwrite'] = { checked: false };
        await vm.runInContext('startLessonRun', local)('subject');
        assert.deepStrictEqual(built, ['1:adv', '2:adv'], '기본학습 교수안은 다시 만들지 않고 심화학습 교수안만 만든다');
        const report = local.elements['lesson-run-body'].innerHTML;
        assert.ok(report.includes('예전 방식 기본학습 교수안을 그대로 둔 차시 1개') && report.includes('교과 · 예전 차시') && report.includes('다시 만들기'), report);
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

    await run('창 닫기 전 AI 작업: 새 생성을 막는 작업에 더해 일괄 생성·과정 설계·차시 목차·분량 채우기·문제은행 창의 작업도 돌고 있다고 본다', async () => {
        const local = makeContext();
        const running = () => vm.runInContext('isAiWorkRunning()', local);
        assert.strictEqual(local.isAiWorkRunning, vm.runInContext('isAiWorkRunning', local), '창 닫기(ui.js)가 window로 부른다');
        assert.strictEqual(running(), false, '아무것도 돌지 않으면 묻지 않는다');
        assert.strictEqual(vm.runInContext("typeof _backfillRun === 'undefined' && typeof _lessonArt === 'undefined'", local), true, '보강·삽화 파일을 싣지 않은 화면에서도 멈추지 않는다');
        const check = (label, on, off) => {
            on();
            assert.strictEqual(running(), true, label);
            off();
            assert.strictEqual(running(), false, `${label} 끝`);
        };
        check('로딩 화면(최종 평가·막는 탭 생성)', () => { local.elements['editor-loading'].style.display = 'flex'; }, () => { local.elements['editor-loading'].style.display = 'none'; });
        check('진행 막대의 작업(전체 생성·탭 만들기·분량 채우기 뒤의 자동 수정과 저장)', () => local.beginLessonPipeline(3, { kind: 'job' }), () => local.finishLessonPipeline({ quiet: true }));
        check('일괄 생성', () => vm.runInContext('_lessonRun = { stopped: false }', local), () => vm.runInContext('_lessonRun = null', local));
        check('과정 설계', () => vm.runInContext('_designBusy = true', local), () => vm.runInContext('_designBusy = false', local));
        local.elements['sidebar-loading'] = { style: {} };
        check('차시 목차 만들기', () => { local.elements['sidebar-loading'].style.display = 'flex'; }, () => { local.elements['sidebar-loading'].style.display = 'none'; });
        check('기본 학습 분량 채우기', () => { local.isVolumeFilling = () => true; }, () => { local.isVolumeFilling = () => false; });
        check('문제은행 창의 문항 만들기', () => vm.runInContext('_qbank = { moduleId: 1, busy: true }', local), () => vm.runInContext('_qbank = null', local));
        check('답을 기다리는 AI 호출(창을 닫은 뒤에도 이어지는 삽화·참고 자료 판독·그림 다시 찾기 등, api.js callGemini)', () => { local.aiCallsWaiting = () => true; }, () => { local.aiCallsWaiting = () => false; });
        vm.runInContext('var _backfillRun = { stopped: false }; var _lessonArt = { busy: true };', local); // 기존 내용 보강·삽화 창을 싣고 돌린다
        assert.strictEqual(running(), true, '기존 내용 보강');
        vm.runInContext('_backfillRun = null;', local);
        assert.strictEqual(running(), true, '삽화 창에서 그리는 중');
        vm.runInContext('_lessonArt = { busy: false };', local);
        assert.strictEqual(running(), false);
        assert.strictEqual(vm.runInContext("typeof _review === 'undefined'", local), true, '컨벤션 검수 파일을 싣지 않아도 멈추지 않는다');
        vm.runInContext('var _review = { moduleId: 1, tabId: "basicLearn", busy: true };', local); // 컨벤션 검수 창에서 AI 수정 제안을 받는 중
        assert.strictEqual(running(), true, '컨벤션 검수의 AI 수정 제안');
        vm.runInContext('_review = { moduleId: 1, tabId: "basicLearn", busy: false };', local);
        assert.strictEqual(running(), false, '수정 제안이 끝났거나 창을 닫았다');
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
        assert.strictEqual(set(draft, 0, 0, 'minutes', '93'), draft, '19차: 차시 시간(8시간)은 고치지 않는다');
        assert.deepStrictEqual(plain(set(draft, 0, 0, 'objectives', '1. 첫째\n\n- 둘째\n셋째 ')).units[0].modules[0].objectives, ['첫째', '둘째', '셋째']);
    });

    await run('블록 편집: 고친 블록은 단원 시간을 바꿔도 사라지지 않음', async () => {
        const edited = call('setDesignModuleField')(draftOf(), 0, 0, 'title', '직접 고친 블록');
        const grown = plain(call('normalizeDesignUnit')({ ...edited.units[0], hours: 6 }));
        assert.strictEqual(grown.modules[0].title, '직접 고친 블록', '기본 블록으로 다시 만들지 않는다');
        assert.deepStrictEqual([grown.hours, grown.modules.reduce((sum, module) => sum + module.minutes, 0)], [40, 2400], '단원 시간을 바꿔도 5차시 × 8시간');
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
        // 19차: 단원은 5차시 × 8시간이어야 한다. 차시 수가 다른 예전 초안과 단계 합계가 다른 차시를 센다
        const off = call('setDesignStepField')(draft, 0, 0, 0, 'minutes', '60');
        assert.strictEqual(call('designTimeMismatches')(off), 1, '그 블록의 단계 합계');
        const short = { ...draft, units: [{ ...draft.units[0], modules: draft.units[0].modules.slice(0, 4).map(module => ({ ...module, isDefault: false })) }] };
        assert.strictEqual(call('designTimeMismatches')(short), 1, '4차시 단원');
        assert.ok(call('designUnitStatusHtml')(short.units[0], 0).includes('data-design-action="fit-unit"') && call('designUnitStatusHtml')(short.units[0], 0).includes('차시 4개'));
        assert.ok(call('designUnitStatusHtml')(draft.units[0], 0).includes('5차시 × 8시간 = 40시간 ✓'));
        const refit = call('designEditAction')(short, 'fit-unit', { unit: '0' });
        assert.deepStrictEqual([call('designTimeMismatches')(refit), refit.units[0].modules.length], [0, 5], '5차시로 맞추기');
        assert.strictEqual(call('designTimeMismatches')(call('designEditAction')(off, 'fit-unit', { unit: '0' })), 0);
        assert.strictEqual(call('designEditAction')(draft, 'draft', {}), null, '편집 동작이 아니면 null');
        assert.strictEqual(call('designEditAction')(draft, 'add-block', { unit: '0' }), null, '차시를 더하거나 지우지 않는다');
    });

    await run('블록 검사 표시: 목표 수·문장 형식', async () => {
        const notes = plain(call('designModuleNotes')({ minutes: 480, objectives: ['게임을 이해한다.', 'a', 'b', 'c'] }));
        assert.ok(notes[0].includes('3개 이하') && notes[1].startsWith('목표 1:'));
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

    await run('교시 구성: 표와 화면이 같은 내용을 씀', async () => {
        const modules = [{ title: '블록', minutes: 120, flow: [{ phase: '전개', title: '본문', minutes: 120 }] }];
        const rows = plain(call('sessionRows')(modules));
        assert.deepStrictEqual(rows.map(row => row.title), ['블록 (1/2)', '블록 (2/2)']);
        assert.ok(call('sessionTableLines')(modules).join('\n').includes('2교시. 블록 (2/2)'), '1시간 칸은 교시로 부른다');
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

    await run('교과로 추가: 시간이 맞지 않으면 앱의 확인 창으로 묻고, 취소하거나 묻는 동안 과정 설계 창을 닫으면 추가하지 않는다', async () => {
        const aiCtx = makeContext();
        aiCtx.apiKey = '';
        vm.runInContext("_designDraft = createCourseDesign({ title: '과정', units: ['단원'], hours: [2] }, 2, '수강생')", aiCtx);
        vm.runInContext('_designDraft = { ..._designDraft, units: _designDraft.units.map(unit => ({ ...unit, hours: unit.hours + 1 })) }', aiCtx);
        assert.ok(vm.runInContext('designTimeMismatches(_designDraft)', aiCtx) > 0, '시간이 맞지 않는 초안');
        const asked = [];
        aiCtx.confirmAsync = async (message, opts) => { asked.push({ message, opts }); return false; };
        const apply = vm.runInContext('applyCourseDesign', aiCtx);
        await apply({ disabled: false });
        assert.strictEqual(aiCtx.globalState.subjects.length, 0, '취소하면 추가하지 않는다');
        assert.ok(asked[0].message.startsWith('시간이 맞지 않는 항목이'), asked[0].message);
        assert.deepStrictEqual(plain(asked[0].opts), { title: '교과로 추가', okLabel: '그대로 추가', tone: 'primary' });
        aiCtx.confirmAsync = async () => { vm.runInContext('closeCourseDesign()', aiCtx); return true; };
        await apply({ disabled: false });
        assert.strictEqual(aiCtx.globalState.subjects.length, 0, '묻는 동안 창을 닫으면 확인해도 추가하지 않는다');
        aiCtx.confirmAsync = async () => true;
        await apply({ disabled: false });
        assert.strictEqual(aiCtx.globalState.subjects.length, 1, '확인하면 그대로 추가한다');
    });

    await run('과정 설계 다시 나누기: 고친 초안이 있으면 앱의 확인 창으로 묻고, 취소하면 초안을 그대로 둔다', async () => {
        const local = makeContext();
        vm.runInContext("_designDraft = { ...createCourseDesign({ title: '과정', units: ['단원'], hours: [2] }, 2, '수강생'), edited: true }", local);
        const before = vm.runInContext('_designDraft', local);
        const asked = [];
        local.confirmAsync = async (message, opts) => { asked.push(opts); return false; };
        await vm.runInContext('onDesignClick', local)({ target: { dataset: { designAction: 'draft' } } });
        assert.strictEqual(vm.runInContext('_designDraft', local), before, '고친 초안을 그대로 둔다');
        assert.deepStrictEqual(plain(asked), [{ title: '과정 설계', okLabel: '새 설계로 바꾸기', tone: 'danger' }]);
        local.confirmAsync = async () => { vm.runInContext('closeCourseDesign()', local); return true; };
        await vm.runInContext('onDesignClick', local)({ target: { dataset: { designAction: 'draft' } } });
        assert.strictEqual(vm.runInContext('_designDraft', local), before, '묻는 동안 창을 닫으면 닫힌 창의 입력을 읽지 않는다');
    });

    const PLAN = { modules: [{ title: '새 블록1', minutes: 60, objectives: ['설명할 수 있습니다.'], flow: [{ phase: '전개', title: '본문', minutes: 60 }] }, { title: '새 블록2', minutes: 60, objectives: [], flow: [] }] };
    // 19차: 교과는 늘 5차시 × 8시간이라 AI가 블록 2개만 보내도 5차시로 나눈다(앞 블록 3개, 뒤 블록 2개)
    const PLANNED = ['새 블록1 — 핵심 개념', '새 블록1 — 적용 실습', '새 블록1 — 종합 정리', '새 블록2 — 핵심 개념', '새 블록2 — 종합 정리'];

    function replanContext(ai) {
        const local = makeContext(ai);
        const filled = lesson(1, { ...emptyTabs(), basicLearn: '작성한 본문' }, { content: '작성한 본문', hours: 1 });
        const blank = lesson(2, emptyTabs(), { hours: 1 });
        const subject = { id: 's1', title: '교과', lessons: [filled, blank], ncs: { units: [{ code: 'C1' }] }, mainQuest: { id: 'mainQuest' } };
        local.globalState.subjects = [subject];
        local.currentSubjectId = 's1';
        local.courseData = subject.lessons;
        local.elements['replan-status'] = { textContent: '' };
        return { local, subject, filled, blank };
    }

    await run('블록 다시 설계: 자동 배정한 NCS는 새 블록에 맞춰 다시 배정한다', async () => {
        const { local, subject } = replanContext(async () => reply(PLAN));
        local.globalState.courseDesign = { title: '게임 과정', goal: '과정 목표', target: '입문자' };
        local.autoAssignNcs = async target => { target.ncs = { ...target.ncs, units: [{ code: 'C2' }] }; return target.ncs; };
        await vm.runInContext('runSubjectReplan', local)({ disabled: false }, subject);
        assert.deepStrictEqual(plain(subject.ncs.units), [{ code: 'C2' }]);
        const failed = replanContext(async () => reply(PLAN));
        failed.local.globalState.courseDesign = { title: '게임 과정', goal: '과정 목표', target: '입문자' };
        failed.local.autoAssignNcs = async () => { throw new Error('호출 한도'); };
        await vm.runInContext('runSubjectReplan', failed.local)({ disabled: false }, failed.subject);
        assert.deepStrictEqual(plain(failed.subject.lessons).map(item => item.title), PLANNED, 'NCS 실패로 새 블록을 되돌리지 않는다');
        assert.deepStrictEqual(plain(failed.subject.ncs.units), [{ code: 'C1' }]);
    });

    await run('블록 다시 설계: 이전 차시는 휴지통·보관함에 남고 NCS는 유지', async () => {
        const prompts = [];
        const { local, subject, filled, blank } = replanContext(async (model, payload) => { prompts.push(payload.contents[0].parts[0].text); return reply(PLAN); });
        local.globalState.courseDesign = { title: '게임 과정', goal: '과정 목표', target: '입문자' };
        await vm.runInContext('runSubjectReplan', local)({ disabled: false }, subject);
        assert.deepStrictEqual(plain(subject.ncs.units), [{ code: 'C1' }], '고를 단위를 못 찾으면 이전 배정을 남긴다');
        assert.deepStrictEqual(plain(subject.lessons).map(item => item.title), PLANNED);
        assert.deepStrictEqual([plain(subject.lessons).map(item => item.hours), subject.hours], [[8, 8, 8, 8, 8], 40], '차시마다 8시간, 교과 40시간');
        assert.deepStrictEqual(plain(subject.lessons).map(item => item.objectives), [['설명할 수 있습니다.'], ['설명할 수 있습니다.'], ['설명할 수 있습니다.'], [], []], '나눈 차시도 목표를 지닌다');
        assert.strictEqual(local.courseData, subject.lessons, '현재 교과면 편집 중인 목록도 바꾼다');
        assert.strictEqual(subject.lessons[0].status, 'waiting');
        assert.strictEqual(subject.lessonCount, 5);
        const trash = local.globalState.lessonTrash;
        assert.ok(trash[0].lesson === filled && trash[1].lesson === blank && trash.every(entry => entry.subjectId === 's1'));
        assert.strictEqual(filled.tabContents.basicLearn, '작성한 본문', '휴지통의 차시는 내용을 그대로 갖는다');
        assert.deepStrictEqual(plain(local.archived), ['차시 1'], '내용이 있는 차시만 보관함에 남긴다');
        assert.ok(prompts[0].includes('[과정] 게임 과정') && prompts[0].includes('[과정 목표] 과정 목표') && prompts[0].includes('40시간(5차시 × 8시간)'));
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

    await run('휴지통 되살리기·작업 기록 되돌리기·차시 삭제: 생성(진행 막대의 작업·전체 탭 생성·일괄 생성·기존 내용 보강·분량 채우기)과 창을 닫기 전에 묻는 AI 작업(과정 설계·차시 목차·문제은행 창)이 도는 동안에는 하지 않고, 끝나면 한다', async () => {
        const local = makeContext();
        // 교과 휴지통·작업 기록 되돌리기(data-safety.js)와 기존 내용 보강의 실행 표시(course-backfill.js)를 함께 올린다
        ['data-safety.js', 'course-backfill.js'].forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), local));
        const api = fs.readFileSync(root + 'api.js', 'utf8').replace(/\r\n/g, '\n');
        const from = api.indexOf('window.deleteModule = function (id) {');
        vm.runInContext(api.slice(from, api.indexOf('\n}\n', from) + 2), local); // 차시 삭제(휴지통으로 옮기기)만 떼어 돌린다
        const live = lesson(1, { ...emptyTabs(), basicLearn: '지금 글' });
        const subject = { id: 's1', title: '교과', lessons: [live] };
        local.globalState.subjects = [subject];
        local.currentSubjectId = 's1';
        local.courseData = subject.lessons;
        local.document.querySelector = () => null;
        local.applyLessonFilter = () => {}; // 차시 카드 거르기(course-list.js)는 이 테스트에 없다
        const confirms = [];
        local.showConfirm = (message, onOk) => { confirms.push(message); onOk(); };
        const at = minutes => new Date(Date.now() - minutes * 60000).toISOString();
        const copy = (id, minutes) => ({ lesson: lesson(id, { ...emptyTabs(), basicLearn: '옛 글' }), subjectId: 's1', at: at(minutes), reason: '다시 만들기 전', kind: 'rewrite', batch: 'run_1' });
        const resetTrash = () => {
            local.globalState.lessonTrash = [{ lesson: lesson(5, { ...emptyTabs(), basicLearn: '지운 글' }), subjectId: 's1', at: at(0) }, copy(22, 1), copy(21, 2)];
            local.globalState.subjectTrash = [{ subject: { id: 'x1', title: '지운 교과', lessons: [] }, at: at(0) }];
            vm.runInContext('renderTrashRows', local)();
        };
        local.contentHistory = [{ id: 5, title: '차시 1 · 기본 학습', date: '어제', lessonId: 1, subjectId: 's1', tabId: 'basicLearn', content: '예전 글', images: {} }];
        const click = (action, index) => vm.runInContext('onTrashClick', local)({ target: { dataset: { trashAction: action, index: String(index) } } });
        const tryAll = async () => {
            await click('restore', 0);
            await click('restore-batch', 0);
            await click('restore-subject', 0);
            await local.restoreHistoryItem(5);
            local.deleteModule(1);
        };
        const unchanged = name => {
            assert.deepStrictEqual([local.globalState.lessonTrash.length, local.globalState.subjectTrash.length, local.globalState.subjects.length], [3, 1, 1], name);
            assert.deepStrictEqual(plain(local.courseData).map(item => item.id), [1], `${name}: 차시 목록은 그대로`);
            assert.strictEqual(live.tabContents.basicLearn, '지금 글', `${name}: 작업 기록으로 되돌리지 않는다`);
        };
        const BUSY = '진행 중인 생성이 끝난 뒤 다시 시도해주세요.';
        const busyStates = [
            ['진행 막대의 작업', () => local.beginLessonPipeline(7, { kind: 'job' }), () => local.finishLessonPipeline({ quiet: true })],
            ['전체 탭 생성(로딩 화면)', () => { local.elements['editor-loading'].style.display = 'flex'; }, () => { local.elements['editor-loading'].style.display = 'none'; }],
            ['남은 차시 일괄 생성', () => vm.runInContext('_lessonRun = { stopped: false }', local), () => vm.runInContext('_lessonRun = null', local)],
            ['기존 내용 보강', () => vm.runInContext('_backfillRun = { stopped: false }', local), () => vm.runInContext('_backfillRun = null', local)],
            ['기본 학습 분량 채우기', () => { local.isVolumeFilling = () => true; }, () => { delete local.isVolumeFilling; }],
            // 창을 닫기 전에 묻는 AI 작업(isAiWorkRunning)도 센다
            ['과정 설계', () => vm.runInContext('_designBusy = true', local), () => vm.runInContext('_designBusy = false', local)],
            ['차시 목차 만들기', () => { local.elements['sidebar-loading'] = { style: { display: 'flex' } }; }, () => { delete local.elements['sidebar-loading']; }],
            ['문제은행 창의 문항 만들기', () => vm.runInContext('_qbank = { moduleId: 1, busy: true }', local), () => vm.runInContext('_qbank = null', local)]
        ];
        for (const [name, begin, end] of busyStates) {
            resetTrash();
            begin();
            local.alerts.length = 0;
            confirms.length = 0;
            await tryAll();
            assert.deepStrictEqual(plain(local.alerts), Array(5).fill(BUSY), name);
            assert.strictEqual(confirms.length, 0, `${name}: 묻지도 않는다`);
            unchanged(name);
            end();
        }
        // 확인 창을 띄운 사이 생성이 시작되면 확인을 눌러도 하지 않는다
        resetTrash();
        local.alerts.length = 0;
        local.showConfirm = (message, onOk) => { confirms.push(message); local.beginLessonPipeline(7, { kind: 'job' }); onOk(); };
        await click('restore-batch', 0);
        local.finishLessonPipeline({ quiet: true });
        await local.restoreHistoryItem(5);
        local.finishLessonPipeline({ quiet: true });
        local.deleteModule(1);
        local.finishLessonPipeline({ quiet: true });
        assert.deepStrictEqual([confirms.length, ...plain(local.alerts)], [3, BUSY, BUSY, BUSY]);
        unchanged('확인 창을 띄운 사이');
        // 작업 기록 되돌리기가 '되돌리기 전' 기록을 남겨 저장하는 사이 시작된 생성도 다시 보고 되돌리지 않는다
        resetTrash();
        local.alerts.length = 0;
        local.showConfirm = (message, onOk) => onOk();
        const archive = local.archiveContents;
        local.archiveContents = async items => { await archive(items); local.beginLessonPipeline(7, { kind: 'job' }); };
        await local.restoreHistoryItem(5);
        local.finishLessonPipeline({ quiet: true });
        local.archiveContents = archive;
        assert.deepStrictEqual(plain(local.alerts), [BUSY]);
        unchanged('기록을 남기는 사이');
        // 생성이 끝나면 모두 한다(사본 묶음은 오래된 것부터)
        resetTrash();
        local.alerts.length = 0;
        confirms.length = 0;
        local.showConfirm = (message, onOk) => { confirms.push(message); onOk(); };
        await tryAll();
        assert.deepStrictEqual(plain(local.alerts), []);
        assert.strictEqual(confirms.length, 3, '모두 복원·되돌리기·삭제는 묻는다');
        assert.deepStrictEqual(plain(local.courseData).map(item => item.id), [5, 21, 22], '되살린 차시가 생기고 지운 차시는 빠진다');
        assert.strictEqual(live.tabContents.basicLearn, '예전 글', '작업 기록으로 되돌렸다');
        assert.deepStrictEqual([local.globalState.lessonTrash.length, local.globalState.lessonTrash[0].lesson, local.globalState.subjects.length], [1, live, 2]);
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

    await run('ZIP: 교수안·편성안 파일 목록(탭 파일 01~06 다음 번호, 심화학습 교수안은 따로)', async () => {
        assert.deepStrictEqual(plain(call('lessonGyosuanFiles')({ gyosuan: { docMd: '교수안', deckMd: '편성안', deckHtml: null } })), [{ name: '07_교수안.md', content: '교수안' }, { name: '08_슬라이드편성안.md', content: '편성안' }]);
        assert.deepStrictEqual(plain(call('lessonGyosuanFiles')({ gyosuan: { docMd: '교수안' } })).map(file => file.name), ['07_교수안.md']);
        assert.deepStrictEqual(plain(call('lessonGyosuanFiles')({ gyosuan: { docMd: '기본' }, gyosuanAdv: { docMd: '심화', deckMd: '심화 편성안' } })),
            [{ name: '07_교수안.md', content: '기본' }, { name: '09_심화교수안.md', content: '심화' }, { name: '10_심화슬라이드편성안.md', content: '심화 편성안' }]);
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

    await run('덮어쓰기 시작: 앱의 확인 창으로 묻고, 취소하면 아무것도 지우지 않는다', async () => {
        const local = makeContext();
        const filled = lesson(1, Object.fromEntries(TAB_IDS.map(id => [id, `${id} 글`])), { status: 'done', images: { a: 'data:a' } });
        const subject = { id: 's1', title: '교과', lessons: [filled] };
        local.globalState.subjects = [subject];
        local.currentSubjectId = 's1';
        local.courseData = subject.lessons;
        ['lesson-run-body', 'lesson-run-footer', 'lesson-run-status'].forEach(id => { local.elements[id] = { innerHTML: '', textContent: '' }; });
        local.elements['lesson-run-overwrite'] = { checked: true };
        local.confirm = () => { throw new Error('브라우저 기본 확인 창을 쓰면 안 된다'); };
        const asked = [];
        const button = { disabled: false };
        local.confirmAsync = async (message, opts) => { asked.push({ message, opts, disabled: button.disabled }); return false; };
        await vm.runInContext('startLessonRun', local)('subject', button);
        assert.strictEqual(asked.length, 1);
        assert.strictEqual(asked[0].disabled, true, '확인 창이 떠 있는 동안 시작 버튼을 막는다');
        assert.strictEqual(button.disabled, false, '취소하면 다시 누를 수 있다');
        assert.deepStrictEqual([asked[0].opts.okLabel, asked[0].opts.title], ['휴지통에 넣고 다시 만들기', '이미 만든 내용 다시 만들기']);
        const lines = asked[0].message.split('\n');
        assert.strictEqual(lines[0], '차시 1개의 교안 탭을 지우고 다시 만듭니다. 교수안·슬라이드는 그대로 둡니다.');
        assert.ok(lines[1].includes('내용이 있는 차시 1개를 통째로') && lines[1].includes('휴지통'));
        assert.ok(asked[0].message.includes('30일'));
        assert.ok(!asked[0].message.includes('작업 기록'), '작업 기록에 남는다고 약속하지 않는다');
        assert.strictEqual(filled.tabContents.basicLearn, 'basicLearn 글');
        assert.strictEqual(local.globalState.lessonTrash, undefined);
        assert.strictEqual(local.globalState.courseDesign, undefined, '취소하면 생성 옵션도 저장하지 않는다');
        assert.strictEqual(vm.runInContext('_lessonRun', local), null);
    });

    await run('덮어쓰기 시작: 확인하면 내용이 있는 차시마다 휴지통에 넣고 다시 만든다. 교과가 달라 차시 id가 같아도 둘 다', async () => {
        const local = makeContext();
        const full = id => lesson(id, Object.fromEntries(TAB_IDS.map(tab => [tab, `${tab} 글`])), { status: 'done' });
        const first = { id: 's1', title: '교과 1', lessons: [full(1), lesson(2)] };
        const second = { id: 's2', title: '교과 2', lessons: [full(1)] };
        local.globalState.subjects = [first, second];
        local.currentSubjectId = 's1';
        local.courseData = first.lessons;
        ['lesson-run-body', 'lesson-run-footer', 'lesson-run-status'].forEach(id => { local.elements[id] = { innerHTML: '', textContent: '' }; });
        local.elements['lesson-run-overwrite'] = { checked: true };
        const asked = [];
        local.confirmAsync = async message => { asked.push(message); return true; };
        local.fillMissingTabs = async id => { local.courseData.find(mod => mod.id === id).tabContents = { basicLearn: '새 글' }; return { ok: true }; };
        local.runLessonExtras = async () => {};
        await vm.runInContext('startLessonRun', local)('course');
        assert.ok(asked[0].startsWith('차시 3개의 교안 탭을 지우고 다시 만듭니다.'));
        assert.ok(asked[0].includes('내용이 있는 차시 2개를 통째로'), '빈 차시는 사본으로 세지 않는다');
        const trash = local.globalState.lessonTrash;
        assert.deepStrictEqual(plain(trash.map(entry => [entry.subjectId, entry.lesson.id, entry.kind])).sort(), [['s1', 1, 'rewrite'], ['s2', 1, 'rewrite']]);
        assert.ok(trash.every(entry => entry.lesson.tabContents.basicLearn === 'basicLearn 글'), '사본은 지우기 전 내용');
        assert.deepStrictEqual([first.lessons[0].tabContents.basicLearn, second.lessons[0].tabContents.basicLearn], ['새 글', '새 글'], '둘째 교과의 같은 id 차시도 다시 만든다');
        assert.strictEqual(first.lessons[1].tabContents.basicLearn, '새 글', '빈 차시도 만든다');
        assert.deepStrictEqual(plain(local.archived), [], '작업 기록 칸을 쓰지 않는다');
        assert.ok(local.elements['lesson-run-body'].innerHTML.includes('차시 2개의 이전 내용은 휴지통에 있습니다'));
    });

    await run("덮어쓰기 실행: 한 실행이 넣은 사본은 모두 같은 실행 이름(batch)을 갖고, 다음 실행은 다른 이름을 쓴다(휴지통의 '모두 복원')", async () => {
        const local = makeContext();
        const full = id => lesson(id, Object.fromEntries(TAB_IDS.map(tab => [tab, `${tab} 글`])), { status: 'done' });
        const first = { id: 's1', title: '교과 1', lessons: [full(1), full(2), lesson(3)] };
        const second = { id: 's2', title: '교과 2', lessons: [full(1)] };
        local.globalState.subjects = [first, second];
        local.currentSubjectId = 's1';
        local.courseData = first.lessons;
        ['lesson-run-body', 'lesson-run-footer', 'lesson-run-status'].forEach(id => { local.elements[id] = { innerHTML: '', textContent: '' }; });
        local.elements['lesson-run-overwrite'] = { checked: true };
        local.confirmAsync = async () => true;
        local.fillMissingTabs = async id => { local.courseData.find(mod => mod.id === id).tabContents = { basicLearn: '새 글' }; return { ok: true }; };
        local.runLessonExtras = async () => {};
        await vm.runInContext('startLessonRun', local)('course');
        const once = plain(local.globalState.lessonTrash.map(entry => entry.batch));
        assert.strictEqual(once.length, 3, '내용이 있던 차시마다 사본 하나(두 교과 모두)');
        assert.ok(typeof once[0] === 'string' && once[0].startsWith('run_') && once.every(batch => batch === once[0]), JSON.stringify(once));
        local.currentSubjectId = 's1'; // 앞 실행이 교과 2로 옮겨 갔다
        local.courseData = first.lessons;
        await vm.runInContext('startLessonRun', local)('subject');
        const again = local.globalState.lessonTrash.slice(0, 3).map(entry => entry.batch);
        assert.ok(again.every(batch => batch === again[0]) && again[0] !== once[0], '다음 실행은 다른 이름');
        assert.deepStrictEqual(plain(local.globalState.lessonTrash.slice(3).map(entry => entry.batch)), once, '앞 실행의 사본은 그대로');
        // 예전처럼 실행 이름 없이 부르면(다른 곳의 다시 만들기) 이름을 붙이지 않는다
        await vm.runInContext('clearLessonForRewrite', local)(lesson(9, { ...emptyTabs(), basicLearn: '글' }), false, 's1');
        assert.ok(!('batch' in local.globalState.lessonTrash[0]));
    });

    await run('덮어쓰기 확인 글: 교수안까지면 슬라이드 화면 편집이 휴지통 사본에만 남는다고 알리고, 브라우저 기본 확인 창을 쓰지 않는다', async () => {
        const local = makeContext();
        local.gyosuanHasScreenEdits = gyosuan => !!gyosuan.deckHtml;
        const tabs = () => Object.fromEntries(TAB_IDS.map(id => [id, '글']));
        local.globalState.subjects = [{ id: 's1', title: '교과', lessons: [lesson(1, tabs(), { gyosuan: { docMd: '교수안', deckHtml: '<section></section>' } }), lesson(2, tabs())] }];
        local.currentSubjectId = 's1';
        const confirmText = vm.runInContext('rewriteConfirmText', local);
        const text = confirmText('subject', true, true);
        assert.ok(text.startsWith('차시 2개의 교안 탭과 교수안·슬라이드를 지우고 다시 만듭니다. 삽화도 다시 그립니다.'));
        assert.ok(text.includes('슬라이드 화면을 직접 고친 차시 1개는 새 슬라이드에 그 편집이 들어가지 않습니다. 휴지통의 사본에는 남습니다.'));
        assert.ok(text.includes('브라우저 저장 공간'));
        local.globalState.subjects = [{ id: 's1', title: '교과', lessons: [lesson(1)] }];
        assert.ok(!confirmText('subject', false).includes('휴지통'), '빈 차시뿐이면 휴지통 이야기를 하지 않는다');
        assert.ok(!/(^|[^.\w])confirm\(/m.test(fs.readFileSync(root + 'course-flow.js', 'utf8')), '브라우저 기본 확인 창을 쓰지 않는다');
    });

    /* ---------- 4차 교차 검토: 다른 생성이 도는 동안, 한도·키 오류, 고정 섹션 그림, 다른 교과로 옮긴 뒤 ---------- */
    const fullTabs = text => Object.fromEntries(TAB_IDS.map(id => [id, `${id} ${text}`]));
    const runContext = (lessons, aiCall) => {
        const local = makeContext(aiCall);
        const subject = { id: 's1', title: '교과', lessons };
        local.globalState.subjects = [subject];
        local.currentSubjectId = 's1';
        local.courseData = subject.lessons;
        ['lesson-run-body', 'lesson-run-footer', 'lesson-run-status'].forEach(id => { local.elements[id] = { innerHTML: '', textContent: '' }; });
        local.elements['lesson-run-overwrite'] = { checked: true };
        local.confirmAsync = async () => true;
        return local;
    };

    await run('일괄 실행: 진행 막대의 작업(알림을 켠 탭 만들기·일괄 이미지 찾기 등)이 돌면 진행 중으로 보고, 확인을 기다리는 사이 시작돼도 아무것도 비우지 않는다', async () => {
        const original = lesson(1, fullTabs('글'), { status: 'done', images: { a: 'data:a' } });
        const before = plain(original);
        const local = runContext([original], async () => { throw new Error('부르면 안 된다'); });
        const busy = () => vm.runInContext('generationBusy()', local);
        local.beginLessonPipeline(7, { kind: 'job', alerts: true });
        assert.strictEqual(busy(), true, '알림을 켠 작업도 진행 중이다');
        local.finishLessonPipeline({ quiet: true });
        assert.strictEqual(busy(), false);
        // 남은 차시 생성 창을 연 뒤, 덮어쓰기 확인 창을 기다리는 사이 다른 작업이 시작됐다
        local.confirmAsync = async () => { local.beginLessonPipeline(7, { kind: 'job', alerts: true }); return true; };
        await vm.runInContext('startLessonRun', local)('subject');
        assert.deepStrictEqual(plain(original), before, '차시를 비우지 않는다');
        assert.deepStrictEqual(plain(local.globalState.lessonTrash || []), [], '휴지통에 넣지 않는다');
        assert.strictEqual(local.alerts.at(-1), '진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
        assert.strictEqual(vm.runInContext('_lessonRun', local), null);
        // 일괄 생성 도중에 다른 작업이 시작돼도 그 차시를 비우지 않고 멈춘다
        const result = plain(await vm.runInContext('attemptLesson', local)({ subject: local.globalState.subjects[0], lessonId: 1, title: '차시 1' }, { stopped: false, overwrite: true, withGyosuan: true, cleared: new Map(), trashed: 0, restored: new Set() }));
        assert.deepStrictEqual([result.ok, result.halt], [false, true]);
        assert.deepStrictEqual(plain(original), before);
        local.finishLessonPipeline({ quiet: true });
    });

    await run('덮어쓰기 실행: 하루 한도에 걸리면 다시 해 보지 않고 멈추며, 탭을 하나도 만들지 못한 차시는 지우기 전 내용으로 되돌리고 휴지통 사본을 뺀다', async () => {
        const first = lesson(1, fullTabs('첫 차시'), { status: 'done', images: { a: 'data:a' }, history: [{ at: '2026-11-01T00:00:00.000Z', note: '이전' }] });
        const second = lesson(2, fullTabs('둘째 차시'), { status: 'done', images: { b: 'data:b' } });
        const before = plain([first, second]);
        let calls = 0;
        const local = runContext([first, second], async () => {
            calls += 1;
            throw vm.runInContext('aiError', local)(429, JSON.stringify({ error: { message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 250', details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] } }), 'Gemini');
        });
        await vm.runInContext('startLessonRun', local)('subject');
        assert.strictEqual(calls, 1, '30초 뒤 다시 해 보지 않고, 다음 차시도 비우지 않는다');
        assert.deepStrictEqual(plain([first, second]), before, '두 차시 모두 지우기 전 그대로(탭·그림·변경 이력)');
        assert.deepStrictEqual(plain(local.globalState.lessonTrash), [], '되돌린 차시의 사본은 휴지통에서 뺀다');
        assert.deepStrictEqual(plain(local.alerts), [], '차시마다 알림창을 띄우지 않는다');
        const body = local.elements['lesson-run-body'].innerHTML;
        assert.ok(body.includes('중지했습니다 · 완료 0개 · 실패 1개 · 남은 1개'), body);
        assert.ok(body.includes('남은 차시도 같은 까닭으로 만들 수 없어 일괄 생성을 멈췄습니다') && body.includes('오늘 쓸 수 있는 AI 사용량을 다 썼습니다'), body);
        assert.ok(body.includes('탭을 하나도 만들지 못한 차시 1개는 지우기 전 내용으로 되돌렸습니다'), body);
        assert.ok(!body.includes('휴지통에 있습니다') && !body.includes('남은 탭부터 이어서'), '있지 않은 휴지통 사본이나 만든 내용을 말하지 않는다');
    });

    await run('덮어쓰기(교수안까지): 움직이는 GIF로 바꾼 그림이 든 차시를 비웠다가 탭을 하나도 만들지 못해 되돌리면 두 갈래(기본학습·심화학습) 교수안과 GIF 기록도 함께 돌아오고, 다음 그림 정리가 간직한 원래 그림을 지우지 않는다', async () => {
        const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACw=';
        const PNG = 'data:image/png;base64,QUFBQkJC';
        const still = 'img_17938368000001';
        const mod = lesson(1, { ...fullTabs('글'), basicLearn: '## 구조\n\n![서버와 P2P](local:img_1)' }, {
            status: 'done', gyosuan: { docMd: '# 교수안' }, images: { img_1: GIF, [still]: PNG },
            gyosuanAdv: { docMd: '# 심화학습 교수안\n\n![서버와 P2P](local:img_1)', deckMd: '### 슬라이드 1 - 구조\n\n![서버와 P2P](local:img_1)' },
            imageMotions: { img_1: { still, at: 1793836800000, sig: '32-1sfx5hx', patterns: ['hub', 'mesh'], summary: '서버 모델: 중심과 주변' } }
        });
        const before = plain(mod);
        const local = runContext([mod], async () => {
            throw vm.runInContext('aiError', local)(429, JSON.stringify({ error: { message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 250', details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] } }), 'Gemini');
        });
        local.elements['lesson-run-gyosuan'] = { checked: true }; // 교수안·슬라이드·문제은행까지 다시 만들기: 비울 때 쓰지 않는 그림을 덜어 낸다
        local.gyosuanHasScreenEdits = () => false;
        const saved = []; // 저장할 때마다 차시의 탭·그림·기록·두 갈래 교수안
        local.saveState = async () => { saved.push(JSON.stringify([mod.tabContents, Object.keys(mod.images || {}), mod.imageMotions ?? null, mod.gyosuan ?? null, mod.gyosuanAdv ?? null])); };
        await vm.runInContext('startLessonRun', local)('subject');
        assert.ok(saved.includes(JSON.stringify([{}, [], {}, null, null])), `비운 차시를 저장할 때는 두 갈래 교수안을 비우고 GIF·원래 그림·기록을 함께 덜어 냈다: ${saved.join(' | ')}`);
        assert.deepStrictEqual(plain(mod), before, '되돌리면 글·그림·두 갈래 교수안과 움직이는 GIF 기록까지 지우기 전 그대로');
        assert.deepStrictEqual(plain(local.globalState.lessonTrash), [], '되돌린 차시의 사본은 휴지통에서 뺀다');
        vm.runInContext('dropUnusedLessonImages', local)(mod); // 다음 원문 저장의 그림 정리
        assert.deepStrictEqual([Object.keys(mod.images).sort(), Object.keys(mod.imageMotions)], [['img_1', still].sort(), ['img_1']], '원래 그림과 기록이 남는다');
    });

    await run('덮어쓰기 실행: 탭을 하나라도 만들고 실패한 차시는 되돌리지 않고(이전 내용은 휴지통), 분당 한도처럼 기다리면 풀리는 오류는 30초 뒤 한 번 더 해 본다', async () => {
        const first = lesson(1, fullTabs('첫 차시'), { status: 'done' });
        let calls = 0;
        const local = runContext([first], async (model, payload) => {
            calls += 1;
            if (tabOf(payload) === 'basicLearn') return reply('## 새 기본 학습\n\n새 글');
            throw Object.assign(new Error('잠시 바쁩니다(503)'), { status: 503 });
        });
        await vm.runInContext('startLessonRun', local)('subject');
        assert.strictEqual(first.tabContents.basicLearn.includes('새 기본 학습'), true);
        assert.strictEqual(first.tabContents.basicPrac, undefined, '만들지 못한 탭은 비어 있다');
        assert.strictEqual(local.globalState.lessonTrash.length, 1, '이전 내용은 휴지통에 있다');
        assert.strictEqual(calls, 3, '첫 시도(기본 학습·기본 실습) 뒤 한 번 더(기본 실습)');
        const body = local.elements['lesson-run-body'].innerHTML;
        assert.ok(body.includes('차시 1개의 이전 내용은 휴지통에 있습니다') && body.includes('남은 탭부터 이어서') && !body.includes('되돌렸습니다'), body);
    });

    await run('덮어쓰기: 교수안까지 다시 만들어도 다시 넣을 고정 섹션의 그림과 남는 삽화의 그림은 지우지 않고, 되돌릴 지우기 전 그림 목록은 그대로 둔다', async () => {
        const locked = '## 핵심 그림\n\n![화면](local:img_keep)';
        const mod = lesson(1, { ...emptyTabs(), basicLearn: `${locked}\n\n## 다른 섹션\n\n![옛 그림](local:img_old)` }, {
            images: { img_keep: 'data:image/png;base64,QQ==', img_old: 'data:image/png;base64,Qg==', img_illu: 'data:image/png;base64,Qw==' },
            illustrations: [{ id: 'i1', imgId: 'img_illu' }], gyosuan: { docMd: '# 교수안 ![도표](local:img_old)' }
        });
        const local = runContext([mod], async () => reply('x'));
        local.globalState.courseDesign = { autoArt: false };
        local.lockedSectionBlocks = (lessonMod, tabId) => (tabId === 'basicLearn' ? [{ title: '핵심 그림', text: locked }] : []);
        const cleared = await vm.runInContext('clearLessonForRewrite', local)(mod, true, 's1');
        assert.deepStrictEqual(Object.keys(mod.images).sort(), ['img_illu', 'img_keep'], '고정 섹션·삽화의 그림은 남고 옛 탭·교수안 그림만 덜어 낸다');
        assert.strictEqual(mod.gyosuan, null);
        assert.deepStrictEqual(Object.keys(cleared.before.images).sort(), ['img_illu', 'img_keep', 'img_old']);
        assert.deepStrictEqual(Object.keys(local.globalState.lessonTrash[0].lesson.images).sort(), ['img_illu', 'img_keep', 'img_old'], '휴지통 사본에는 모든 그림이 있다');
        const keep = lesson(2, { ...emptyTabs(), basicLearn: '글' }, { images: { z: 'data:image/png;base64,Wg==' } });
        await vm.runInContext('clearLessonForRewrite', local)(keep, false, 's1');
        assert.deepStrictEqual(Object.keys(keep.images), ['z'], '교수안을 다시 만들지 않으면 그림은 그대로 둔다');
    });

    await run('교안 탭 모두 다시 만들기: 도중에 다른 교과로 옮기면 그 교과의 최종 평가(같은 id)를 다시 만들지 않고 멈춘다', async () => {
        let calls = 0;
        const local = makeContext(async (model, payload) => {
            calls += 1;
            if (calls === 1) { // 첫 탭을 받는 사이 교과2를 연다
                local.currentSubjectId = 's2';
                local.courseData = local.globalState.subjects[1].lessons;
            }
            return reply(`## AI가 새로 쓴 글 ${calls}\n\n내용`);
        });
        const quest = text => ({ id: 'mainQuest', title: '👑 최종 평가', description: '평가', status: 'done', images: {}, tabContents: fullTabs(text), content: text });
        const s1 = { id: 's1', title: '교과1', lessons: [lesson(1)], mainQuest: quest('교과1 글') };
        const s2 = { id: 's2', title: '교과2', lessons: [lesson(1)], mainQuest: quest('교과2 글') };
        local.globalState.subjects = [s1, s2];
        local.currentSubjectId = 's1';
        local.courseData = s1.lessons;
        local.getEditingModule = id => (id === 'mainQuest' ? local.globalState.subjects.find(subject => subject.id === local.currentSubjectId)?.mainQuest : local.courseData.find(mod => String(mod.id) === String(id)));
        const s2Before = plain(s2.mainQuest);
        await vm.runInContext('generateAllTabs', local)('mainQuest');
        assert.strictEqual(calls, 1);
        assert.ok(s1.mainQuest.tabContents.basicLearn.includes('AI가 새로 쓴 글 1'), '시작한 교과의 첫 탭은 다시 만들었다');
        assert.deepStrictEqual(plain(s2.mainQuest), s2Before, '교과2의 최종 평가는 그대로');
        assert.ok(local.alerts.at(-1).includes('다른 교과로 옮겼거나 차시가 바뀌어 교안 탭 다시 만들기를 멈췄습니다'), local.alerts.at(-1));
        assert.ok(!local.toasts.some(item => item.message.includes('모두 다시 만들었습니다')), '다 만들었다고 하지 않는다');
    });

    console.log('ALL PASSED');
})().catch(e => { console.error('FAIL', e.stack || e.message); process.exit(1); });
