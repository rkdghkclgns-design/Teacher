// 문제은행 재생성 테스트 (실행: node tests/qbank-regenerate.test.js)
// 갈래마다 문항을 만들 때의 교안 열쇠를 기억하고 비교하는지, 문제은행 화면의 알림·'재생성' 단추, 기록이 없는 예전 문제은행,
// 확인 창에서 취소하면 AI를 부르지 않는지, 재생성이 그 갈래만 기존 생성 길(초안 → 코드 주석 → 교차 검수)로 한 번씩 부르는지,
// 직접 만들거나 고친 문항을 두는지, 바꾸기 전 문제은행을 작업 기록에 남기는지, 멈추거나 실패하면 문제은행을 그대로 두는지를 실제 파일로 확인한다. AI 응답만 스텁이다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { loadLessonTracks } = require('./lesson-tracks');

const root = path.join(__dirname, '..', 'js') + path.sep;
const source = file => fs.readFileSync(root + file, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const call = (ctx, name) => vm.runInContext(name, ctx);
const reply = text => ({ candidates: [{ content: { parts: [{ text }] } }] });
const escapeHtml = s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : '');

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

// 문제은행·전체 생성 문맥(track-split.test.js의 flowContext와 같은 파일) + 교안 해시(gyosuan.js) + 재생성(course-qbank-regen.js)
const FILES = ['kbuilder/ncs-catalog.js', 'ai-errors.js', 'filename-convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-qbank.js', 'lesson-pipeline.js', 'ai-routing.js', 'course-ncs.js', 'course-design.js',
    'course-design-edit.js', 'course-sessions.js', 'course-meta.js', 'lesson-editor-tools.js', 'lesson-attachments.js', 'tabs.js', 'course-flow.js', 'cost-estimate.js', 'gyosuan.js', 'course-qbank-regen.js'];

function makeContext() {
    const elements = { 'qbank-body': { innerHTML: '' }, 'qbank-title': { textContent: '' } };
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: fn => { fn(); return 0; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, Promise, URL, Blob,
        TEXT_MODEL: 'gemini-4-argon', apiKey: 'k', claudeApiKey: '', isClaudeModel: () => false, needsElementAutoAssign: () => false,
        CONTEXT_CORE: { personas: { orchestrator: '설계자', instructor: '강사' }, rules: {} },
        INSTRUCTOR_TONE_PRESETS: [{ id: 'formal', label: '합쇼체' }], instructorTone: 'formal',
        globalState: { courseTitle: '과정', subjects: [] }, courseData: [], currentSubjectId: 's1', currentEditingModuleId: null,
        localStorage: { getItem: () => null, setItem() {} },
        alerts: [], toasts: [], archived: [], asked: [], order: [], calls: [], answer: true, elements,
        escapeHtml, safeJSONParse: t => JSON.parse(t), extractText: d => d.candidates[0].content.parts[0].text,
        document: { getElementById: id => elements[id] || null, createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} } },
        getEditingModule: id => ctx.courseData.find(mod => String(mod.id) === String(id)),
        archiveContent: async (item, reason) => { ctx.archived.push({ ...item, reason }); },
        saveState: async () => {}, showLessonView() {}, renderSidebar() {}, renderEditor() {}, renderOverviewLNB() {}, viewModule() {}, openEditor() {},
        confirm: () => { throw new Error('브라우저 기본 확인 창을 쓰면 안 된다'); },
        alert: () => { throw new Error('브라우저 기본 알림 창을 쓰면 안 된다'); },
        confirmAsync: async (message, opts) => { ctx.asked.push({ message, opts }); ctx.order.push('confirm'); return ctx.answer; },
        callGemini: async () => { throw new Error('호출되면 안 됨'); }
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind });
    vm.createContext(ctx);
    loadLessonTracks(ctx, { tabs: true });
    FILES.forEach(file => vm.runInContext(source(file), ctx));
    ctx.realGenerate = ctx.generateQuestions; // 스텁으로 바꾼 뒤 실제 생성 길로 되돌릴 때
    return ctx;
}

const goalsMd = (goals, body) => `## 학습 목표\n\n${goals.map(goal => `- ${goal}`).join('\n')}\n\n## 개요\n\n- 문제 상황입니다.\n\n${body}`;
const BASIC_GOALS = ['기본 목표 하나를 설명할 수 있습니다.', '기본 목표 둘을 비교할 수 있습니다.'];
const lesson = () => ({
    id: 1, title: '재미', status: 'done', images: {},
    tabContents: {
        basicLearn: goalsMd(BASIC_GOALS, '## 기본 본문\n\n기본원고 글입니다.'),
        basicPrac: '## 기본 실습\n\n기본실습 글입니다.',
        advLearn: goalsMd(['심화 목표 하나를 분석할 수 있습니다.'], '## 심화 본문\n\n심화원고 글입니다.'),
        advPrac: '## 심화 실습\n\n심화실습 글입니다.',
        assessment: null, advAssessment: null
    }
});
const CHOICES = [{ mark: '①', text: '가' }, { mark: '②', text: '나' }, { mark: '③', text: '다' }, { mark: '④', text: '라' }];
let serial = 0;
const fakeQuestions = (spec, tag) => Array.from({ length: spec.count }, () => {
    serial += 1;
    const choice = spec.type === '객관식';
    return { no: 0, title: `${tag} 문항 ${serial}`, objective: spec.objective, band: spec.band, type: spec.type, typed: true, multi: !!spec.multi, stem: `${tag} 내용 ${serial}`, media: '',
        choices: choice ? CHOICES : [], answer: choice ? '②' : '모범 답안입니다.', accepted: '', hint: '', code: '', lang: '', explanation: '해설입니다.', rubric: '', tests: '', review: '' };
});
// 문항 생성 길을 스텁으로 바꾼다. tag: 만든 문항 제목에 붙는 표시. hook: 부를 때마다 먼저 돈다(멈추기·실패 흉내)
function stubGenerate(ctx, tag, hook = null) {
    ctx.generateQuestions = async (mod, spec, trackId) => {
        ctx.calls.push({ trackId, spec: plain(spec), bank: mod.tabContents[trackId === 'adv' ? 'advAssessment' : 'assessment'] || '' });
        ctx.order.push(`generate:${trackId}`);
        if (hook) await hook(spec);
        return fakeQuestions(spec, `${trackId}-${tag}`);
    };
}
// 전체 생성의 문제은행 채우기로 두 갈래 문제은행을 AI 문항으로 채운다(기본학습 목표 둘 × 3, 심화학습 목표 하나 × 3)
async function seeded() {
    const ctx = makeContext();
    const mod = lesson();
    ctx.courseData = [mod];
    stubGenerate(ctx, '첫');
    assert.deepStrictEqual(plain(await call(ctx, 'fillQuestionBank')(1)), { ok: true });
    ctx.calls.length = 0;
    ctx.order.length = 0;
    return { ctx, mod };
}
const titles = md => (String(md || '').match(/^### 문제 \d+\. .+$/gm) || []).map(line => line.replace(/^### 문제 \d+\. /, ''));
const openPanel = (ctx, track = 'basic') => vm.runInContext(`_qbank = { moduleId: 1, track: '${track}', band: '', objective: '', editing: null, draft: null, help: false, status: '', spec: { objective: 1, band: 'L1', type: '객관식', multi: false, count: 3 }, dirty: false, busy: false, inline: true };`, ctx);
const STALE = '교안이 바뀌었습니다. 최신 내용으로 문항을 다시 만들 수 있습니다.';

(async () => {
    await run('교안 열쇠: 문제은행에 AI 문항을 넣으면 갈래마다 그때의 교안 열쇠와 AI 문항 지문을 남기고, 그 갈래의 교안이 바뀌었을 때만 바뀌었다고 본다', async () => {
        const { ctx, mod } = await seeded();
        const snapshot = call(ctx, 'qbankSourceSnapshot');
        const stale = call(ctx, 'qbankIsStale');
        assert.ok(mod.qbankSources?.basic && mod.qbankSources?.adv, '두 갈래 모두 기록');
        assert.strictEqual(mod.qbankSources.basic.key, snapshot(mod, 'basic').key);
        assert.strictEqual(mod.qbankSources.adv.key, snapshot(mod, 'adv').key);
        assert.notStrictEqual(mod.qbankSources.basic.key, mod.qbankSources.adv.key, '갈래마다 다른 원고');
        assert.deepStrictEqual([mod.qbankSources.basic.ai.length, mod.qbankSources.adv.ai.length], [6, 3], 'AI 문항 지문');
        assert.deepStrictEqual(plain(mod.qbankSources.basic.objectives), BASIC_GOALS);
        assert.deepStrictEqual([stale(mod, 'basic'), stale(mod, 'adv')], [false, false]);
        mod.tabContents.basicLearn += '\n\n새로 쓴 문단입니다.';
        assert.deepStrictEqual([stale(mod, 'basic'), stale(mod, 'adv')], [true, false], '기본학습만 바뀌었다');
        assert.deepStrictEqual(plain(call(ctx, 'qbankChangeLines')(mod, 'basic')), ['바뀐 탭: 기본학습']);
        mod.tabContents.basicLearn = goalsMd([...BASIC_GOALS, '기본 목표 셋을 만들 수 있습니다.'], '## 기본 본문\n\n기본원고 글입니다.');
        const lines = call(ctx, 'qbankChangeLines')(mod, 'basic');
        assert.ok(lines.length <= 2 && lines.some(line => line.includes('학습 목표') && line.includes('새 목표 1개')), lines.join(' / '));
        mod.tabContents.advPrac += '\n\n추가 실습입니다.';
        assert.strictEqual(stale(mod, 'adv'), true, '심화실습이 바뀌면 심화학습 문제은행');
        assert.deepStrictEqual(plain(call(ctx, 'qbankChangeLines')(mod, 'adv')), ['바뀐 탭: 심화실습']);
        // 망가진 기록은 없는 것으로 본다
        mod.qbankSources = { basic: 'x', adv: { key: 5 } };
        assert.deepStrictEqual([call(ctx, 'qbankSourceRecord')(mod, 'basic'), call(ctx, 'qbankSourceRecord')(mod, 'adv'), stale(mod, 'basic')], [null, null, false]);
    });

    await run('문제은행 화면: 갈래마다 재생성 단추가 있고, 교안이 바뀐 갈래에만 알림을 보인다. 단추를 누르면 그 갈래로 재생성을 부른다', async () => {
        const { ctx, mod } = await seeded();
        openPanel(ctx, 'basic');
        call(ctx, 'renderQbank')();
        let html = ctx.elements['qbank-body'].innerHTML;
        assert.ok(html.includes('data-qbank-action="regenerate"') && html.includes('>재생성</button>'), '단추');
        assert.ok(!html.includes(STALE), '교안이 그대로면 알림 없음');
        mod.tabContents.basicLearn += '\n\n새로 쓴 문단입니다.';
        call(ctx, 'renderQbank')();
        assert.ok(ctx.elements['qbank-body'].innerHTML.includes(STALE), '바뀐 갈래에 알림');
        vm.runInContext("_qbank = { ..._qbank, track: 'adv' };", ctx);
        call(ctx, 'renderQbank')();
        html = ctx.elements['qbank-body'].innerHTML;
        assert.ok(html.includes('data-qbank-action="regenerate"') && !html.includes(STALE), '심화학습은 그대로');
        // 교안이 없는 갈래는 단추를 두지 않는다(만들 원고가 없다)
        assert.strictEqual(call(ctx, 'qbankRegenHtml')({ ...mod, tabContents: { ...mod.tabContents, advLearn: null, advPrac: null } }, 'adv'), '');
        const asked = [];
        ctx.runQbankRegenerate = (lessonMod, trackId) => { asked.push([lessonMod === mod, trackId]); };
        await call(ctx, 'onQbankClick')({ target: { closest: () => ({ dataset: { qbankAction: 'regenerate' } }) } });
        assert.deepStrictEqual(asked, [[true, 'adv']], '보고 있는 갈래로');
    });

    await run('예전 문제은행(기록 없음): 알림 없이 단추만 보이고, AI 문항을 가를 수 없어 모든 문항을 두고 목표마다 새 문항을 더한다고 묻는다', async () => {
        const ctx = makeContext();
        const mod = lesson();
        mod.tabContents.assessment = '### 문제 1. 예전 문항\n학습 목표 1 · 밴드 L1 · 객관식\n\n① 가\n② 나\n③ 다\n④ 라\n\n✅ **정답:** ②\n\n---';
        ctx.courseData = [mod];
        const html = call(ctx, 'qbankRegenHtml')(mod, 'basic');
        assert.ok(html.includes('data-qbank-action="regenerate"') && !html.includes(STALE));
        assert.strictEqual(call(ctx, 'qbankIsStale')(mod, 'basic'), false);
        const plan = call(ctx, 'qbankRegenPlan')(mod, 'basic');
        assert.deepStrictEqual([plan.known, plan.replaced, plan.kept, plan.total], [false, 0, 1, 6]);
        assert.deepStrictEqual(plain(plan.specs), [1, 2].map(objective => ({ objective, band: 'L1', type: '객관식', multi: false, count: 3 })), '전체 생성의 문제은행 채우기와 같은 모양');
        stubGenerate(ctx, '새');
        await call(ctx, 'runQbankRegenerate')(mod, 'basic');
        assert.ok(ctx.asked[0].message.includes('가를 수 없습니다') && ctx.asked[0].message.includes('그대로 두고'), ctx.asked[0].message);
        const after = titles(mod.tabContents.assessment);
        assert.strictEqual(after[0], '예전 문항', '예전 문항은 그대로');
        assert.strictEqual(after.length, 7);
        assert.ok(mod.qbankSources.basic && call(ctx, 'qbankIsStale')(mod, 'basic') === false, '이제 기록이 생긴다');
        assert.strictEqual(call(ctx, 'qbankRegenPlan')(mod, 'basic').replaced, 6, '다음에는 새로 만든 문항만 AI 문항으로 가른다');
    });

    await run('확인 창: 바뀐 점과 비용·시간을 먼저 보이고, 취소하면 AI를 부르지 않고 문제은행·기록을 그대로 둔다', async () => {
        const { ctx, mod } = await seeded();
        mod.tabContents.basicLearn += '\n\n새로 쓴 문단입니다.';
        const before = mod.tabContents.assessment;
        const record = plain(mod.qbankSources);
        stubGenerate(ctx, '새');
        ctx.answer = false;
        await call(ctx, 'runQbankRegenerate')(mod, 'basic');
        assert.strictEqual(ctx.asked.length, 1);
        const { message, opts } = ctx.asked[0];
        assert.ok(message.startsWith('교안이 바뀌었습니다.') && message.includes('바뀐 탭: 기본학습'), message);
        assert.ok(message.includes('AI가 만든 문항 6개') && message.includes('작업 기록') && message.includes('멈출 수 있'), message);
        assert.ok(message.includes('미리 보기') || /호출|분/.test(message), '비용·시간 미리 보기 줄');
        assert.deepStrictEqual([opts.title, opts.okLabel], ['기본학습 문제은행 재생성', '재생성']);
        assert.deepStrictEqual([ctx.calls.length, ctx.archived.length], [0, 0], 'AI를 부르지 않는다');
        assert.strictEqual(mod.tabContents.assessment, before);
        assert.deepStrictEqual(plain(mod.qbankSources), record);
        assert.strictEqual(call(ctx, '_qbankRegen'), null, '다시 누를 수 있다');
    });

    await run('재생성: 확인 뒤 그 갈래만 목표마다 한 번씩 부르고, AI 문항을 새 문항으로 바꾼다. 다른 갈래는 그대로다', async () => {
        const { ctx, mod } = await seeded();
        mod.tabContents.basicLearn += '\n\n새로 쓴 문단입니다.';
        const adv = mod.tabContents.advAssessment;
        const advRecord = plain(mod.qbankSources.adv);
        stubGenerate(ctx, '새');
        await call(ctx, 'runQbankRegenerate')(mod, 'basic');
        assert.deepStrictEqual(ctx.order, ['confirm', 'generate:basic', 'generate:basic'], '묻고 나서 목표마다 한 번');
        assert.deepStrictEqual(ctx.calls.map(row => row.spec), [1, 2].map(objective => ({ objective, band: 'L1', type: '객관식', multi: false, count: 3 })));
        assert.ok(ctx.calls.every(row => !titles(row.bank).some(title => title.includes('basic-첫'))), '바꿀 AI 문항은 겹치면 안 되는 기존 문항으로 보내지 않는다');
        assert.ok(titles(ctx.calls[1].bank).length === 3, '앞 목표에서 새로 만든 문항은 보낸다');
        const after = titles(mod.tabContents.assessment);
        assert.strictEqual(after.length, 6);
        assert.ok(after.every(title => title.startsWith('basic-새')), after.join(', '));
        assert.ok(/^### 문제 1\. /m.test(mod.tabContents.assessment) && /^### 문제 6\. /m.test(mod.tabContents.assessment), '번호를 다시 매긴다');
        assert.deepStrictEqual([mod.tabContents.advAssessment, plain(mod.qbankSources.adv)], [adv, advRecord], '심화학습은 그대로');
        assert.strictEqual(call(ctx, 'qbankIsStale')(mod, 'basic'), false, '이제 최신');
        assert.ok(mod.history[0].note.startsWith('기본학습 문제은행 재생성'), mod.history[0].note);
        assert.ok(ctx.toasts.some(row => row.message.includes('새 문항 6개') && row.kind === 'success'), JSON.stringify(ctx.toasts));
        assert.strictEqual(call(ctx, '_qbankRegen'), null);
        assert.strictEqual(call(ctx, 'window.isLessonPipelineRunning')(), false, '진행 막대를 닫는다');
    });

    await run('재생성은 기존 생성 길을 쓴다: 목표마다 초안 → 코드 주석 → 교차 검수', async () => {
        const { ctx, mod } = await seeded();
        mod.tabContents.basicLearn += '\n\n새로 쓴 문단입니다.';
        const events = [];
        let made = 0;
        ctx.generateQuestions = ctx.realGenerate; // 스텁을 걷어 내고 실제 generateQuestions로
        assert.strictEqual(typeof ctx.generateQuestions, 'function');
        ctx.crossCheckModel = () => 'review-model';
        ctx.commentQuestionCode = async questions => { events.push('comment'); return questions; };
        ctx.callGemini = async (model, payload) => {
            if (payload.taskRole === 'review') {
                events.push('review');
                return reply(JSON.stringify([0, 1, 2].map(i => ({ i, ok: true, notes: '' }))));
            }
            events.push('draft');
            const goal = Number((payload.contents[0].parts[0].text.match(/\[학습 목표 (\d+)\]/) || [])[1]);
            return reply([0, 1, 2].map(() => {
                made += 1;
                return `### 문제 1. 실제 길 문항 ${made}\n학습 목표 ${goal} · 밴드 L1 · 객관식\n\n알맞은 것을 고르시오.\n\n① 가\n② 나\n③ 다\n④ 라\n\n✅ **정답:** ②\n\n📝 **해설:** 나가 맞습니다.\n\n---`;
            }).join('\n\n'));
        };
        await call(ctx, 'runQbankRegenerate')(mod, 'basic');
        const steps = events.filter((event, i) => event !== events[i - 1]);
        assert.deepStrictEqual(steps, ['draft', 'comment', 'review', 'draft', 'comment', 'review'], events.join(','));
        assert.ok(mod.tabContents.assessment.includes('🔍 **교차 검수:** 통과 · review-model'), '검수 결과를 남긴다');
        assert.strictEqual(titles(mod.tabContents.assessment).length, 6);
    });

    await run('직접 만들거나 고친 문항은 그대로 두고, AI 문항은 같은 목표·밴드·유형·수로 다시 만든다', async () => {
        const { ctx, mod } = await seeded();
        // 문제은행 화면의 AI로 생성(L2 서술형)도 AI 문항으로 기록한다
        await call(ctx, 'writeQuestionsIfOpen')(mod, 1, fakeQuestions({ objective: 1, band: 'L2', type: '서술형', multi: false, count: 1 }, 'basic-첫'), 'basic');
        assert.strictEqual(mod.qbankSources.basic.ai.length, 7);
        // 빈 문항 추가로 직접 쓴 문항, 편집으로 고친 AI 문항
        const md = call(ctx, 'qbankMarkdown')(mod, 'basic');
        const first = call(ctx, 'qbankQuestions')(mod, 'basic')[0];
        const edited = call(ctx, 'updateQuestionMd')(md, 0, { ...first, stem: '강사가 고친 문항입니다.', review: '' });
        mod.tabContents.assessment = call(ctx, 'appendQuestionsMd')(edited, [{ ...fakeQuestions({ objective: 2, band: 'L1', type: '단답식', count: 1 }, '직접')[0], choices: [], answer: '답' }]);
        mod.tabContents.basicLearn += '\n\n새로 쓴 문단입니다.';
        const plan = call(ctx, 'qbankRegenPlan')(mod, 'basic');
        assert.deepStrictEqual([plan.known, plan.replaced, plan.kept, plan.total], [true, 6, 2, 6]);
        assert.deepStrictEqual(plain(plan.specs), [
            { objective: 1, band: 'L1', type: '객관식', multi: false, count: 2 },
            { objective: 1, band: 'L2', type: '서술형', multi: false, count: 1 },
            { objective: 2, band: 'L1', type: '객관식', multi: false, count: 3 }
        ]);
        stubGenerate(ctx, '새');
        await call(ctx, 'runQbankRegenerate')(mod, 'basic');
        assert.ok(ctx.asked[0].message.includes('직접 만들거나 고친 문항 2개는 그대로'), ctx.asked[0].message);
        const bank = mod.tabContents.assessment;
        assert.ok(bank.includes('강사가 고친 문항입니다.') && titles(bank).some(title => title.startsWith('직접')), '고친 문항과 직접 쓴 문항은 그대로');
        assert.strictEqual(titles(bank).filter(title => title.startsWith('basic-첫')).length, 1, '남은 basic-첫 문항은 고친 문항 하나뿐');
        assert.strictEqual(titles(bank).filter(title => title.startsWith('basic-새')).length, 6);
        assert.strictEqual(call(ctx, 'qbankRegenPlan')(mod, 'basic').kept, 2, '다음 재생성에도 직접 만든 문항으로 둔다');
    });

    await run('바꾸기 전 문제은행은 작업 기록에 남고, 그 기록으로 되돌리면 예전 AI 문항도 AI 문항으로 가른다', async () => {
        const { ctx, mod } = await seeded();
        mod.tabContents.basicLearn += '\n\n새로 쓴 문단입니다.';
        const before = mod.tabContents.assessment;
        stubGenerate(ctx, '새');
        await call(ctx, 'runQbankRegenerate')(mod, 'basic');
        assert.strictEqual(ctx.archived.length, 1);
        const [entry] = ctx.archived;
        assert.deepStrictEqual([entry.tabId, entry.content, entry.reason, entry.lesson === mod, entry.title], ['assessment', before, '문제은행 다시 만들기 전', true, '재미 · 학습이해도']);
        mod.tabContents.assessment = entry.content; // 작업 기록에서 되돌린다
        assert.deepStrictEqual([call(ctx, 'qbankRegenPlan')(mod, 'basic').replaced, call(ctx, 'qbankRegenPlan')(mod, 'basic').kept], [6, 0]);
    });

    await run('멈추거나 실패하면 문제은행·기록을 그대로 두고 알린다', async () => {
        const stop = await seeded();
        stop.mod.tabContents.basicLearn += '\n\n새로 쓴 문단입니다.';
        const before = stop.mod.tabContents.assessment;
        const record = plain(stop.mod.qbankSources);
        stubGenerate(stop.ctx, '새', () => stop.ctx.requestLessonPipelineStop());
        await call(stop.ctx, 'runQbankRegenerate')(stop.mod, 'basic');
        assert.strictEqual(stop.ctx.calls.length, 1, '멈추면 다음 목표를 부르지 않는다');
        assert.deepStrictEqual([stop.mod.tabContents.assessment, plain(stop.mod.qbankSources), stop.ctx.archived.length], [before, record, 0]);
        assert.ok(stop.ctx.toasts.some(row => row.message.includes('멈췄습니다') && row.message.includes('그대로')), JSON.stringify(stop.ctx.toasts));
        assert.strictEqual(call(stop.ctx, 'qbankIsStale')(stop.mod, 'basic'), true, '여전히 바뀐 교안');

        const fail = await seeded();
        fail.mod.tabContents.basicLearn += '\n\n새로 쓴 문단입니다.';
        const failBefore = fail.mod.tabContents.assessment;
        stubGenerate(fail.ctx, '새', spec => { if (spec.objective === 2) throw new Error('하루 한도를 넘었습니다.'); });
        await call(fail.ctx, 'runQbankRegenerate')(fail.mod, 'basic');
        assert.deepStrictEqual([fail.mod.tabContents.assessment, fail.ctx.archived.length], [failBefore, 0]);
        assert.ok(fail.ctx.alerts.some(text => text.includes('하루 한도를 넘었습니다.') && text.includes('그대로 두었습니다')), fail.ctx.alerts.join('\n'));

        // 다 만든 뒤 작업 기록을 남기는 동안 멈춰도 바꾸지 않는다
        const late = await seeded();
        late.mod.tabContents.basicLearn += '\n\n새로 쓴 문단입니다.';
        const lateBefore = late.mod.tabContents.assessment;
        stubGenerate(late.ctx, '새');
        late.ctx.archiveContent = async () => { late.ctx.requestLessonPipelineStop(); };
        await call(late.ctx, 'runQbankRegenerate')(late.mod, 'basic');
        assert.strictEqual(late.mod.tabContents.assessment, lateBefore);
        assert.ok(late.ctx.toasts.some(row => row.message.includes('멈췄습니다')));
    });

    await run('학습 목표가 없으면 묻지 않고 알리고, 문항이 없는 문제은행은 새로 만든다고 묻는다', async () => {
        const ctx = makeContext();
        const mod = lesson();
        mod.tabContents.basicLearn = '## 기본 본문\n\n학습 목표 없는 글입니다.';
        ctx.courseData = [mod];
        stubGenerate(ctx, '새');
        await call(ctx, 'runQbankRegenerate')(mod, 'basic');
        assert.deepStrictEqual([ctx.asked.length, ctx.calls.length], [0, 0]);
        assert.ok(ctx.alerts.at(-1).includes('학습 목표가 없어'), ctx.alerts.at(-1));
        // 비어 있는 심화이해도: "0개는 그대로"라고 쓰지 않고 새로 만든다고 묻는다
        ctx.answer = false;
        const empty = lesson();
        ctx.courseData = [empty];
        await call(ctx, 'runQbankRegenerate')(empty, 'adv');
        const { message } = ctx.asked.at(-1);
        assert.ok(message.includes('심화학습 문제은행에 문항이 없어') && !message.includes('0개'), message);
    });

    await run('두 번 누르거나 다른 생성이 도는 동안에는 다시 시작하지 않는다', async () => {
        const { ctx, mod } = await seeded();
        mod.tabContents.basicLearn += '\n\n새로 쓴 문단입니다.';
        const during = [];
        stubGenerate(ctx, '새', () => { during.push(call(ctx, 'qbankRegenHtml')(mod, 'basic')); });
        let release;
        ctx.confirmAsync = (message, opts) => { ctx.asked.push({ message, opts }); return new Promise(resolve => { release = resolve; }); };
        const first = call(ctx, 'runQbankRegenerate')(mod, 'basic');
        const asking = call(ctx, 'qbankRegenHtml')(mod, 'basic');
        const locked = html => html.includes('data-qbank-action="regenerate" disabled');
        assert.ok(locked(asking) && asking.includes(STALE) && !asking.includes('다시 만들고 있습니다'), '묻는 동안은 단추만 막는다');
        await call(ctx, 'runQbankRegenerate')(mod, 'basic');
        await call(ctx, 'runQbankRegenerate')(mod, 'adv');
        assert.strictEqual(ctx.asked.length, 1, '두 번째는 묻지도 않는다');
        assert.ok(ctx.alerts.length === 2 && ctx.alerts.every(text => text.includes('끝난 뒤')), ctx.alerts.join('\n'));
        release(true);
        await first;
        assert.strictEqual(ctx.calls.length, 2, '한 번만 돈다');
        assert.ok(during.length === 2 && during.every(html => html.includes('다시 만들고 있습니다') && locked(html)), '만드는 동안 진행 안내');
        assert.ok(!locked(call(ctx, 'qbankRegenHtml')(mod, 'basic')), '끝나면 다시 누를 수 있다');
        // 전체 생성 같은 다른 작업이 돌면 묻지 않는다
        ctx.alerts.length = 0;
        ctx.beginLessonPipeline(1, { kind: 'job', label: '다른 작업' });
        await call(ctx, 'runQbankRegenerate')(mod, 'basic');
        ctx.finishLessonPipeline({ quiet: true });
        assert.deepStrictEqual([ctx.asked.length, ctx.alerts.length], [1, 1]);
    });

    await run('문제은행 탭을 AI로 만들면 새 문항만 AI 문항으로 기록한다(미리 보기에서 그대로 둔 예전 문항은 빼고)', async () => {
        const ctx = makeContext();
        const mod = lesson();
        ctx.courseData = [mod];
        const keep = '### 문제 1. 직접 쓴 문항\n학습 목표 1 · 밴드 L1 · 단답식\n\n답을 쓰시오.\n\n✅ **정답:** 답\n\n---';
        const previous = keep;
        mod.tabContents.assessment = call(ctx, 'appendQuestionsMd')(keep, fakeQuestions({ objective: 2, band: 'L1', type: '객관식', count: 2 }, '탭'));
        call(ctx, 'noteQbankTabQuestions')(mod, 'assessment', previous);
        assert.strictEqual(mod.qbankSources.basic.ai.length, 2);
        const plan = call(ctx, 'qbankRegenPlan')(mod, 'basic');
        assert.deepStrictEqual([plan.known, plan.replaced, plan.kept], [true, 2, 1]);
        call(ctx, 'noteQbankTabQuestions')(mod, 'basicLearn', '');
        assert.deepStrictEqual(Object.keys(mod.qbankSources), ['basic'], '문제은행 탭이 아니면 적지 않는다');
        // 탭 만들기가 문제은행 탭을 쓴 뒤 이 기록을 부른다(tabs.js generateTabContent)
        assert.ok(/mod\.tabContents\[tabId\] = resultText;\s*\n\s*if \(isQuestionBankTab\(tabId\)\) warnUncoveredObjectives[^\n]*\n\s*if \(isQuestionBankTab\(tabId\) && typeof noteQbankTabQuestions === 'function'\) noteQbankTabQuestions\(mod, tabId, previous\);/.test(source('tabs.js').replace(/\r\n/g, '\n')));
    });

    await run('연결: index.html은 course-qbank-regen.js를 course-qbank.js 바로 뒤에 이웃과 같은 ?v=로 싣는다', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        const scripts = [...html.matchAll(/<script src="\.\/js\/([\w./-]+)\.js\?v=(\d+)"><\/script>/g)].map(match => [match[1], match[2]]);
        const at = scripts.findIndex(([name]) => name === 'course-qbank');
        assert.ok(at >= 0 && scripts[at + 1]?.[0] === 'course-qbank-regen', scripts.slice(at, at + 2).join(' | '));
        assert.strictEqual(scripts[at + 1][1], scripts[at][1], '같은 ?v=');
    });

    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
