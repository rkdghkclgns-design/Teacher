// 교수안·슬라이드·문제은행을 기본학습과 심화학습으로 나누기 테스트 (실행: node tests/track-split.test.js)
// 갈래 목록, 갈래마다 교수안 만들기(원고·저장 칸·알림), 스튜디오 주소(차시~adv)의 payload·저장·불러오기, 예전 교수안 안내와 심화학습 빈 화면,
// 그림 쓰임(지우기·덜어 내기·작업 기록), 불러온 저장본 검사·백업 그림 떼기, 갈래마다 문제은행(원고·목표·빈 목표·채우기·CSV),
// 여섯째 탭(심화이해도)의 내보내기·불러오기, 전체 생성·일괄 생성 단계와 미리 보기, 심화이해도 지시·검수를 실제 파일로 확인한다. AI 응답만 스텁이다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { loadLessonTracks } = require('./lesson-tracks');
const { makeContext: whiteboardContext, lesson: whiteboardLesson } = require('./whiteboard-harness');

const root = path.join(__dirname, '..', 'js') + path.sep;
const source = file => fs.readFileSync(root + file, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const call = (ctx, name) => vm.runInContext(name, ctx);
const reply = text => ({ candidates: [{ content: { parts: [{ text }] } }] });
// 소스에서 함수·상수 하나를 잘라 온다(start 글부터 end 글까지)
function slice(file, start, end = '\n}\n') {
    const text = source(file).replace(/\r\n/g, '\n');
    const from = text.indexOf(start);
    const to = text.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `${file}에서 ${start}를 찾지 못함`);
    return text.slice(from, to + end.length);
}
const escapeHtml = s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : '');
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

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

/* ---------- 교수안 만들기 문맥(gyosuan.test.js와 같은 파일) ---------- */
const META = '부제: 부제\n대상: 수강생\n선행: 없음\n결과물: 메모\n교보제: 슬라이드\n[학습목표]\n- 설명할 수 있다.\n[개요]\n개요 문단입니다.\n[수업흐름]\n단계 | 시간 | 핵심\n도입 | 10분 | 시작\n전개 | 60분 | 본문\n정리 | 10분 | 끝\n[준비물]\n- 빔프로젝터\n[산출물]\n- 메모\n[평가]\n- 확인\n[유의사항]\n- 검토한다.';
const SECTION = '@@GYOSUAN@@\n**강사 활동**: 화면을 띄운다.\n**설명 내용**:\n- 내용이다.\n**멘트 예시**: "시작합니다."\n**학생 활동**: 따라 한다.\n@@SLIDES@@\n### 슬라이드 - 본문\n- 슬라이드 문구:\n  - 핵심\n- 이미지/시각: 도식\n- 핵심 메시지: 메시지';
const OPEN_CLOSE = '@@INTRO@@\n제목: 열기\n**강사 활동**: 연다.\n@@CLOSE@@\n제목: 닫기\n**강사 활동**: 닫는다.';

function genContext() {
    const prompts = [];
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, URL, encodeURIComponent,
        TEXT_MODEL: 'claude-opus-5-5',
        CONTEXT_CORE: { personas: { instructor: '강사입니다.' } },
        INSTRUCTOR_TONE_PRESETS: [{ id: 'formal', label: '합쇼체' }], instructorTone: 'formal',
        getReferenceContext: () => '',
        stripInstructorCallouts: text => text,
        globalState: { subjects: [{ id: 's1', title: '게임 기획 입문' }], courseTitle: '과정' },
        currentSubjectId: 's1', currentEditingModuleId: 'm1',
        document: { addEventListener() {}, getElementById: () => null, createElement: () => ({}) },
        saveState: async () => {}, renderEditor() {},
        confirm: () => { throw new Error('브라우저 기본 확인 창을 쓰면 안 된다'); },
        confirmAsync: async (message, opts) => { ctx.asked.push({ message, opts }); return true; },
        asked: [], alerts: [], toasts: [], prompts
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = message => ctx.toasts.push(message);
    ctx.callGemini = async (model, payload) => {
        const text = payload.contents.at(-1).parts[0].text;
        prompts.push(text);
        if (text.includes('@@INTRO@@')) return reply(OPEN_CLOSE);
        if (text.includes('@@GYOSUAN@@')) return reply(SECTION);
        return reply(META);
    };
    vm.createContext(ctx);
    loadLessonTracks(ctx, { tabs: true });
    vm.runInContext(source('kbuilder/parser.js'), ctx);
    ['gyosuan.js', 'filename-convention.js', 'lesson-lint.js', 'course-ncs.js', 'course-design.js', 'course-sessions.js', 'course-meta.js'].forEach(file => vm.runInContext(source(file), ctx));
    return ctx;
}

const LONG = '충분히 긴 본문 문장이 여기에 들어갑니다. 내용을 차근차근 풀어서 다룹니다.';
const fourTabs = () => ({
    basicLearn: `## 1. 기본 섹션 (⏱ 30분)\n\n기본표식 ${LONG}`,
    basicPrac: `## 기본 실습 과제\n\n기본실습표식 ${LONG}`,
    advLearn: `## 1. 심화 섹션 (⏱ 40분)\n\n심화표식 ${LONG}`,
    advPrac: `## 심화 프로젝트\n\n심화실습표식 ${LONG}`,
    assessment: null, advAssessment: null
});
const genLesson = (tabs = fourTabs()) => ({ id: 'm1', title: '재미의 구조', hours: 2, tabContents: tabs });

/* ---------- 스튜디오·강사뷰 문맥(slide-flow.test.js와 같은 파일) ---------- */
const STUDIO_FILES = [
    'filename-convention.js',
    'kbuilder/parser.js', 'kbuilder/render-doc.js', 'kbuilder/render-deck.js', 'kbuilder/ref-images.js', 'kbuilder/import-html.js', 'kbuilder/auto-images.js',
    'kbuilder/export.js', 'kbuilder/sample-data.js', 'course-ncs.js', 'course-design.js', 'course-sessions.js', 'course-meta.js', 'gyosuan.js', 'gyosuan-view.js', 'gyosuan-images.js',
    'import-stream.js', 'gyosuan-io.js'
];
function studioContext() {
    const elements = {};
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, URL, encodeURIComponent, Blob, TextDecoder,
        isBackupTooBig: err => err instanceof RangeError,
        TEXT_MODEL: 'claude-opus-5-5',
        CONTEXT_CORE: { personas: { instructor: '강사입니다.' } },
        INSTRUCTOR_TONE_PRESETS: [{ id: 'formal', label: '합쇼체' }], instructorTone: 'formal',
        getReferenceContext: () => '', stripInstructorCallouts: text => text,
        courseData: [], globalState: { subjects: [{ id: 's1', title: '게임 기획 입문' }], courseTitle: '과정' },
        currentSubjectId: 's1', currentEditingModuleId: 'm1',
        apiKey: 'k', claudeApiKey: '', isClaudeModel: () => true,
        extractText: data => data.candidates[0].content.parts[0].text,
        escapeHtml,
        localStorage: { getItem: () => null, setItem() {} },
        document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, getElementById: id => elements[id] || null, createElement: () => ({ appendChild() {} }) },
        BroadcastChannel: function () { this.postMessage = () => {}; },
        saveState: async () => {}, renderEditor() {},
        callGemini: async () => { throw new Error('호출되면 안 됨'); },
        confirm: () => { throw new Error('브라우저 기본 확인 창을 쓰면 안 된다'); },
        confirmAsync: async (message, opts) => { ctx.asked.push({ message, opts }); return true; },
        asked: [], alerts: [], toasts: [], elements
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = message => ctx.toasts.push(message);
    vm.createContext(ctx);
    loadLessonTracks(ctx, { tabs: true });
    STUDIO_FILES.forEach(file => vm.runInContext(source(file), ctx));
    return ctx;
}

const docOf = (topic, mark) => `---\n교과목: 게임 기획 입문\n주제: ${topic}\n---\n\n# 교수안 - ${topic}\n\n## 학습 목표\n\n- ${mark} 목표를 설명할 수 있다.\n\n## 수업 흐름 한눈에 보기\n\n| 단계 | 시간 | 핵심 |\n|---|---|---|\n| 도입 | 10분 | 시작 |\n| 전개 | 70분 | ${mark} 본문 |\n| 정리 | 10분 | 끝 |\n\n## 진행\n\n### 도입 - 시작\n\n**강사 활동**: ${mark} 도입을 연다.\n\n### 전개 1 - ${mark} 본문\n\n**강사 활동**: ${mark} 본문을 설명한다.\n\n### 정리 - 끝\n\n**강사 활동**: ${mark} 정리를 한다.\n`;
const deckOf = mark => `# 슬라이드 편성안 - ${mark}\n\n## 슬라이드 편성\n\n### 슬라이드 1 - ${mark} 표지\n- 대응 교수안: -\n- 슬라이드 문구:\n  - ${mark}\n\n### 슬라이드 2 - ${mark} 본문\n- 대응 교수안: 전개 1\n- 슬라이드 문구:\n  - ${mark} 내용\n`;

/* ---------- 문제은행·전체 생성 문맥(course-flow.test.js와 같은 파일, 실제 여섯 탭) ---------- */
const FLOW_FILES = ['kbuilder/ncs-catalog.js', 'ai-errors.js', 'filename-convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-qbank.js', 'lesson-pipeline.js', 'ai-routing.js', 'course-ncs.js', 'course-design.js',
    'course-design-edit.js', 'course-sessions.js', 'course-meta.js', 'lesson-editor-tools.js', 'lesson-attachments.js', 'tabs.js', 'course-flow.js', 'cost-estimate.js'];
function flowContext() {
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: fn => { fn(); return 0; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, Promise, URL, Blob,
        TEXT_MODEL: 'gemini-4-argon', apiKey: 'k', claudeApiKey: '', isClaudeModel: () => false, needsElementAutoAssign: () => false,
        CONTEXT_CORE: { personas: { orchestrator: '설계자' }, rules: {} },
        globalState: { courseTitle: '과정', subjects: [] }, courseData: [], currentSubjectId: 's1', currentEditingModuleId: null,
        localStorage: { getItem: () => null, setItem() {} },
        alerts: [], toasts: [], archived: [],
        escapeHtml, safeJSONParse: t => JSON.parse(t), extractText: d => d.candidates[0].content.parts[0].text,
        document: { getElementById: () => null, createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} } },
        getEditingModule: id => ctx.courseData.find(mod => String(mod.id) === String(id)),
        archiveContent: async item => { ctx.archived.push(item); },
        saveState: async () => {}, showLessonView() {}, renderSidebar() {}, renderEditor() {}, renderOverviewLNB() {}, viewModule() {}, openEditor() {},
        confirmAsync: async () => true,
        callGemini: async () => { throw new Error('호출되면 안 됨'); }
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind });
    vm.createContext(ctx);
    loadLessonTracks(ctx, { tabs: true });
    FLOW_FILES.forEach(file => vm.runInContext(source(file), ctx));
    return ctx;
}

const goalsMd = (goals, body) => `## 학습 목표\n\n${goals.map(goal => `- ${goal}`).join('\n')}\n\n## 개요\n\n- 문제 상황입니다.\n\n${body}`;
const question = (no, objective, title) => `### 문제 ${no}. ${title}\n학습 목표 ${objective} · 밴드 L1 · 객관식\n\n① 가\n② 나\n③ 다\n④ 라\n\n✅ **정답:** ②\n\n---`;
const bankLesson = () => ({
    id: 1, title: '재미', status: 'done', images: {},
    tabContents: {
        basicLearn: goalsMd(['기본 목표 하나를 설명할 수 있습니다.', '기본 목표 둘을 비교할 수 있습니다.'], '## 기본 본문\n\n기본원고표식 글입니다.'),
        basicPrac: '## 기본 실습\n\n기본실습원고 글입니다.',
        advLearn: goalsMd(['심화 목표 하나를 분석할 수 있습니다.'], '## 심화 본문\n\n심화원고표식 글입니다.'),
        advPrac: '## 심화 실습\n\n심화실습원고 글입니다.',
        assessment: question(1, 1, '기본 문항'),
        advAssessment: null
    }
});

(async () => {
    /* ======================= 1. 갈래 목록 ======================= */
    await run('갈래 목록: 기본학습(기본학습·기본실습·학습이해도·gyosuan)과 심화학습(심화학습·심화실습·심화이해도·gyosuanAdv), 여섯째 탭 심화이해도', () => {
        const ctx = { window: {}, console: { warn() {} }, localStorage: { getItem: () => null } };
        vm.createContext(ctx);
        vm.runInContext(source('data.js'), ctx);
        assert.deepStrictEqual(plain(call(ctx, 'LESSON_TRACKS')), [
            { id: 'basic', label: '기본학습', learn: 'basicLearn', practice: 'basicPrac', bank: 'assessment', field: 'gyosuan' },
            { id: 'adv', label: '심화학습', learn: 'advLearn', practice: 'advPrac', bank: 'advAssessment', field: 'gyosuanAdv' }
        ]);
        const tabs = plain(call(ctx, 'LESSON_TABS'));
        assert.deepStrictEqual(tabs.map(tab => tab.id), ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment', 'advAssessment'], '심화이해도는 학습이해도 뒤');
        const adv = tabs.at(-1);
        assert.deepStrictEqual([adv.label, adv.icon, adv.color], ['심화이해도', 'ph-seal-check', 'fuchsia']);
        assert.ok(new Set(tabs.map(tab => tab.icon)).size === tabs.length, '탭마다 아이콘이 다르다');
        const colors = { window: {} };
        vm.createContext(colors);
        vm.runInContext(`${slice('tabs.js', 'const TAB_COLORS = {', '\n};\n')}\nwindow.colors = TAB_COLORS;`, colors);
        tabs.forEach(tab => assert.ok(colors.window.colors[tab.color]?.active, `${tab.id}의 색(${tab.color})이 TAB_COLORS에 있다`));
        const track = call(ctx, 'lessonTrack');
        assert.deepStrictEqual([track('adv').field, track('basic').field, track('zzz').id, track(undefined).id], ['gyosuanAdv', 'gyosuan', 'basic', 'basic'], '모르는 갈래는 기본학습');
        const of = call(ctx, 'tabTrack');
        assert.deepStrictEqual([of('advAssessment').id, of('advPrac').id, of('assessment').id, of('basicLearn').id, of('mainQuest')], ['adv', 'adv', 'basic', 'basic', null]);
        const bank = call(ctx, 'isQuestionBankTab');
        assert.deepStrictEqual(['assessment', 'advAssessment', 'advLearn', 'constructor'].map(bank), [true, true, false, false]);
        assert.deepStrictEqual([call(ctx, 'gyosuanOf')({ gyosuanAdv: { docMd: 'd' } }, 'adv').docMd, call(ctx, 'gyosuanOf')(null, 'adv')], ['d', undefined]);
        const has = call(ctx, 'trackHasContent');
        assert.deepStrictEqual([has({ tabContents: { advPrac: '글' } }, 'adv'), has({ tabContents: { advPrac: '글' } }, 'basic')], [true, false]);
        assert.deepStrictEqual([has({ content: '옛 본문' }, 'basic'), has({ content: '옛 본문' }, 'adv')], [true, false], '탭 글이 없는 옛 본문은 기본학습 갈래');
        assert.strictEqual(has({ tabContents: { assessment: '문항' }, content: '문항' }, 'basic'), false, '합친 본문은 옛 본문이 아니다');
        assert.strictEqual(has({ tabContents: { basicLearn: '   ' } }, 'basic'), false, '빈칸뿐인 탭은 글이 아니다');
    });

    /* ======================= 2. 갈래마다 교수안 만들기 ======================= */
    await run('교수안 만들기: 기본학습은 기본학습·기본실습 탭으로 gyosuan에, 심화학습은 심화학습·심화실습 탭으로 gyosuanAdv에 만들고 알림·변경 이력에 갈래를 적는다', async () => {
        const ctx = genContext();
        const mod = genLesson();
        ctx.getEditingModule = () => mod;
        assert.strictEqual(await ctx.generateGyosuan('m1'), true);
        const basic = ctx.prompts.join('\n');
        assert.ok(basic.includes('기본표식') && basic.includes('기본실습표식') && !basic.includes('심화표식') && !basic.includes('심화실습표식'), '기본학습 교수안은 기본 탭만 원고로 쓴다');
        assert.ok(mod.gyosuan.docMd.includes('# 교수안 - 재미의 구조\n') && mod.gyosuanAdv === undefined);
        assert.strictEqual(ctx.toasts.at(-1), '기본학습 교수안과 슬라이드 편성안을 만들었습니다.');
        assert.ok(mod.history[0].note.startsWith('기본학습 교수안·슬라이드 편성안 AI 생성'), mod.history[0].note);
        const basicPlan = mod.gyosuan;
        ctx.prompts.length = 0;
        assert.strictEqual(await ctx.generateGyosuan('m1', { track: 'adv' }), true);
        const adv = ctx.prompts.join('\n');
        assert.ok(adv.includes('심화표식') && adv.includes('심화실습표식') && !adv.includes('기본표식') && !adv.includes('기본실습표식'), '심화학습 교수안은 심화 탭만 원고로 쓴다');
        assert.ok(ctx.prompts[0].includes('[주제] 재미의 구조 (심화학습)'), '머리말 지시에 갈래 이름이 붙는다');
        assert.ok(mod.gyosuanAdv.docMd.includes('# 교수안 - 재미의 구조 (심화학습)') && mod.gyosuanAdv.deckMd.includes('# 슬라이드 편성안 - 재미의 구조 (심화학습)'));
        assert.strictEqual(mod.gyosuan, basicPlan, '기본학습 교수안은 건드리지 않는다');
        const hash = call(ctx, 'hashSource');
        const collect = call(ctx, 'collectLessonSource');
        assert.deepStrictEqual([mod.gyosuan.sourceKey, mod.gyosuanAdv.sourceKey], [hash(collect(mod, 'basic')), hash(collect(mod, 'adv'))]);
        assert.notStrictEqual(mod.gyosuan.sourceKey, mod.gyosuanAdv.sourceKey);
        assert.strictEqual(ctx.toasts.at(-1), '심화학습 교수안과 슬라이드 편성안을 만들었습니다.');
        assert.ok(mod.history[0].note.startsWith('심화학습 교수안·슬라이드 편성안 AI 생성'));
        // 편성안만 다시: 심화학습의 고친 교수안은 두고 편성안만 바꾼다
        mod.gyosuanAdv = { ...mod.gyosuanAdv, docMd: '강사가 고친 심화 교수안' };
        assert.strictEqual(await ctx.generateGyosuan('m1', { track: 'adv', keepDoc: true }), true);
        assert.strictEqual(mod.gyosuanAdv.docMd, '강사가 고친 심화 교수안');
        assert.strictEqual(mod.gyosuan, basicPlan);
    });

    await run('교수안 만들기: 갈래의 학습·실습 탭이 비면 만들지 않고 그 탭 이름으로 알린다. 다시 만들기도 그 갈래만 묻는다', async () => {
        const ctx = genContext();
        const mod = genLesson({ ...fourTabs(), advLearn: null, advPrac: null });
        ctx.getEditingModule = () => mod;
        assert.strictEqual(await ctx.generateGyosuan('m1', { track: 'adv' }), false);
        assert.ok(ctx.alerts.at(-1).includes('심화학습·심화실습 탭에 교안 내용이 없습니다'), ctx.alerts.at(-1));
        assert.strictEqual(ctx.prompts.length, 0, 'AI를 부르지 않는다');
        assert.strictEqual(mod.gyosuanAdv, undefined);
        const made = [];
        ctx.generateGyosuan = async (id, opts) => { made.push(opts.track); return true; };
        await ctx.regenerateGyosuan('m1', 'adv');
        assert.deepStrictEqual([made, ctx.asked.at(-1).opts.title], [['adv'], '심화학습 교수안 다시 생성']);
        assert.ok(ctx.asked.at(-1).message.startsWith('심화학습 교수안을 다시 생성합니다.'));
    });

    /* ======================= 3. 슬라이드 스튜디오: module=차시~adv ======================= */
    await run('스튜디오 주소: 기본학습은 차시 id 그대로, 심화학습은 차시 id~adv. 모르는 표시는 기본학습으로 그대로 둔다', () => {
        const ctx = studioContext();
        const key = call(ctx, 'studioModuleKey');
        const parse = call(ctx, 'parseStudioModuleKey');
        assert.deepStrictEqual([key('m1', 'basic'), key('m1', 'adv'), key(5, 'adv'), key(5)], ['m1', 'm1~adv', '5~adv', 5]);
        assert.deepStrictEqual(plain([parse('m1~adv'), parse('m1'), parse(7), parse('m1~zzz'), parse('mainQuest~adv')]),
            [{ moduleId: 'm1', track: 'adv' }, { moduleId: 'm1', track: 'basic' }, { moduleId: 7, track: 'basic' }, { moduleId: 'm1~zzz', track: 'basic' }, { moduleId: 'mainQuest', track: 'adv' }]);
        assert.deepStrictEqual([call(ctx, 'slideStudioQuery')('m1', 'adv'), call(ctx, 'slideStudioQuery')('m1')], ['module=m1~adv', 'module=m1']);
    });

    await run('스튜디오 payload·저장·불러오기: ~adv는 심화학습 덱(gyosuanAdv)을, 차시 id만이면 기본학습 덱을 다룬다', async () => {
        const ctx = studioContext();
        const mod = { id: 'm1', title: '재미', tabContents: fourTabs(), images: {},
            gyosuan: { docMd: docOf('재미', '기본덱'), deckMd: deckOf('기본덱'), deckRev: 1 },
            gyosuanAdv: { docMd: docOf('재미 (심화학습)', '심화덱'), deckMd: deckOf('심화덱'), deckRev: 3 } };
        ctx.getEditingModule = id => (String(id) === 'm1' ? mod : null); // 풀지 않은 '~adv' 그대로는 찾지 못한다
        const basic = plain(ctx.getSlideStudioPayload('m1'));
        const adv = plain(ctx.getSlideStudioPayload('m1~adv'));
        assert.ok(basic.deckMd.includes('기본덱') && !basic.deckMd.includes('심화덱') && basic.rev === 1 && basic.track === 'basic' && basic.title === '재미');
        assert.ok(adv.deckMd.includes('심화덱') && !adv.deckMd.includes('기본덱') && adv.rev === 3 && adv.track === 'adv' && adv.title === '재미 (심화학습)');
        assert.ok(adv.fileBase.endsWith('_심화') && !basic.fileBase.includes('심화'), `${basic.fileBase} / ${adv.fileBase}`);
        assert.strictEqual(adv.sessions.length, 2, '90분 심화학습 교수안은 차시 둘');
        const session = plain(ctx.getSlideStudioPayload('m1~adv', 1));
        assert.ok(session.session === 1 && session.docMd.includes('2차시') && session.deckMd.includes('심화덱'), '한 차시 덱도 심화학습 교수안에서');
        // 저장: 그 갈래의 덱에만, 덱 번호가 다르면 받지 않는다
        assert.strictEqual(ctx.saveSlideStudioHtml('m1~adv', '<낡은 심화>', { rev: 1, session: null }), false);
        assert.strictEqual(ctx.saveSlideStudioHtml('m1~adv', '<심화 편집>', { rev: 3, session: null }), true);
        assert.strictEqual(ctx.saveSlideStudioHtml('m1~adv', '<심화 1차시>', { rev: 3, session: 0 }), true);
        assert.strictEqual(ctx.saveSlideStudioHtml('m1', '<기본 편집>', { rev: 1, session: null }), true);
        assert.deepStrictEqual([mod.gyosuanAdv.deckHtml, mod.gyosuanAdv.sessionDecks[0], mod.gyosuan.deckHtml, mod.gyosuan.sessionDecks], ['<심화 편집>', '<심화 1차시>', '<기본 편집>', undefined]);
        // 불러오기: 스튜디오가 넘긴 '~adv'로 심화학습 덱을 바꾼다
        ctx.KBuilder.readExportedHtml = () => ({ html: '<불러온 심화>', theme: 'maple', source: null });
        assert.deepStrictEqual(plain(await ctx.importGyosuanHtml('m1~adv', '<html>')), { ok: true });
        assert.deepStrictEqual([mod.gyosuanAdv.deckHtml, mod.gyosuan.deckHtml], ['<불러온 심화>', '<기본 편집>']);
        assert.strictEqual(ctx.asked.at(-1).opts.title, '심화학습 슬라이드 바꾸기');
        // 심화학습 교수안이 없는 차시
        const bare = { ...mod, gyosuanAdv: undefined };
        ctx.getEditingModule = id => (String(id) === 'm1' ? bare : null);
        assert.strictEqual(ctx.saveSlideStudioHtml('m1~adv', '<x>', { rev: 0 }), false);
        assert.strictEqual(plain(ctx.getSlideStudioPayload('m1~adv')).deckMd, '');
    });

    /* ======================= 4. 예전 교수안 안내, 심화학습 빈 화면 ======================= */
    await run('예전 교수안: 네 탭으로 만든 기본학습 교수안은 그대로 두고 안내하고, 심화학습 화면은 만들기 단추가 있는 빈 화면이다', () => {
        const ctx = studioContext();
        const mod = { id: 'm1', title: '재미', tabContents: fourTabs(), images: {}, gyosuan: { docMd: docOf('재미', '옛') } };
        mod.gyosuan.sourceKey = call(ctx, 'hashSource')(call(ctx, 'legacyLessonSource')(mod));
        ctx.getEditingModule = () => mod;
        const note = call(ctx, 'gyosuanNoteText');
        const LEGACY = '예전 방식으로 기본·심화를 함께 담은 교수안입니다. 다시 만들면 기본학습과 기본실습만으로 만듭니다.';
        assert.strictEqual(note(mod, 'basic'), LEGACY);
        assert.strictEqual(call(ctx, 'isLegacyGyosuan')(mod), true);
        mod.gyosuan.sourceKey = call(ctx, 'hashSource')(call(ctx, 'collectLessonSource')(mod, 'basic'));
        assert.strictEqual(note(mod, 'basic'), '기본학습·기본실습 탭으로 만든 기본학습 교수안입니다. 탭별 교안은 위 탐색줄에서 볼 수 있습니다.');
        // 심화 탭이 비어 있던 차시는 예전과 지금 원고가 같아 예전 방식이라고 하지 않는다
        const basicOnly = { id: 'm1', title: '재미', tabContents: { ...fourTabs(), advLearn: null, advPrac: null }, gyosuan: { docMd: '## 진행' } };
        basicOnly.gyosuan.sourceKey = call(ctx, 'hashSource')(call(ctx, 'legacyLessonSource')(basicOnly));
        assert.strictEqual(call(ctx, 'isLegacyGyosuan')(basicOnly), false);
        mod.gyosuan.sourceKey = 'k';
        assert.ok(note(mod, 'basic').startsWith('⚠️ 교안이 바뀌었습니다'));
        // 화면: 고른 갈래가 심화학습이면 그 갈래의 빈 화면, 기본학습이면 예전 교수안과 안내
        ctx.elements['gyosuan-view'] = { innerHTML: '', querySelectorAll: () => [] };
        mod.gyosuan.sourceKey = call(ctx, 'hashSource')(call(ctx, 'legacyLessonSource')(mod));
        ctx.lessonPanelTrack = () => 'adv';
        call(ctx, 'renderGyosuanView')(mod);
        const advHtml = ctx.elements['gyosuan-view'].innerHTML;
        assert.ok(advHtml.includes('이 차시의 심화학습 교수안이 아직 없습니다') && advHtml.includes("generateGyosuan('m1', { track: 'adv' })") && advHtml.includes('심화학습 교수안·슬라이드 만들기'), advHtml.slice(0, 300));
        assert.ok(advHtml.includes("importGyosuanMdFiles('m1', 'adv')"), '완성 MD도 심화학습 칸에 넣는다');
        ctx.lessonPanelTrack = () => 'basic';
        ctx.gyosuanBodyHtml = (lesson, track) => `<본문 ${track}: ${lesson.gyosuan.docMd.includes('옛 도입') ? '옛 교수안' : '?'}>`; // 문서 그리기는 화면(DOM)이 있어야 한다
        call(ctx, 'renderGyosuanView')(mod);
        const basicHtml = ctx.elements['gyosuan-view'].innerHTML;
        assert.ok(basicHtml.includes(LEGACY) && basicHtml.includes("regenerateGyosuan('m1', 'basic')") && basicHtml.includes('<본문 basic: 옛 교수안>'), '기본학습 화면은 예전 교수안을 그대로 보인다');
        // 심화 탭이 빈 차시의 심화학습 화면은 먼저 그 탭을 만들라고 한다
        ctx.lessonPanelTrack = () => 'adv';
        call(ctx, 'renderGyosuanView')({ ...basicOnly, gyosuan: undefined });
        assert.ok(ctx.elements['gyosuan-view'].innerHTML.includes('심화학습·심화실습 탭에 아직 교안이 없습니다'));
    });

    await run('교수안 내려받기: 심화학습 교수안 파일 이름에 심화를 붙이고 기본학습은 예전 이름 그대로', () => {
        const ctx = studioContext();
        const mod = { id: 'm1', title: '재미', tabContents: fourTabs(), gyosuan: { docMd: docOf('재미', '기본'), deckMd: deckOf('기본') }, gyosuanAdv: { docMd: docOf('재미 (심화학습)', '심화'), deckMd: deckOf('심화') } };
        ctx.getEditingModule = () => mod;
        const saved = [];
        vm.runInContext('downloadMd = (md, name) => { window.savedMd.push({ md, name }); };', Object.assign(ctx, { savedMd: saved }));
        ctx.downloadGyosuanMd('m1', 'docMd', 'adv');
        ctx.downloadGyosuanMd('m1', 'deckMd', 'basic');
        ctx.downloadGyosuanSessions('m1', 'adv');
        ctx.downloadGyosuanSession('m1', 'deck:0', 'adv');
        assert.deepStrictEqual(saved.map(file => file.name.replace(/^.*?_(?=[^_]*$)/, '')), ['심화교수안', '슬라이드편성안', '심화차시별교수안', '심화편성안']);
        assert.ok(saved[0].md.includes('심화 본문') && saved[1].md.includes('기본') && saved[2].md.includes('심화') && saved[3].md.includes('심화'));
    });

    /* ======================= 5. 그림 쓰임 ======================= */
    await run('그림 쓰임: 심화학습 교수안·편성안·화면 편집본·차시 덱이 가리키는 그림은 덜어 내지 않고, 지울 때도 쓰는 곳으로 센다. 작업 기록도 그 그림을 담는다', () => {
        const pctx = { console };
        vm.createContext(pctx);
        loadLessonTracks(pctx, { tabs: true });
        vm.runInContext([slice('tabs.js', 'function lessonImageRefTexts('), slice('tabs.js', 'function unusedLessonImageIds('), slice('tabs.js', 'function dropUnusedLessonImages('),
            slice('api.js', 'function textUsesImage('), slice('api.js', 'function lessonStillUsesImage(')].join('\n'), pctx);
        const lesson = () => ({ content: '', tabContents: { basicLearn: '![](local:a)' }, images: { a: PNG, g: PNG, s: JPG, x: PNG, gone: PNG },
            gyosuanAdv: { docMd: '![](local:g)', deckHtml: '<img src="local:s">', sessionDecks: { 0: '<img src="local:x">' } } });
        assert.deepStrictEqual(plain(call(pctx, 'unusedLessonImageIds')(lesson())), ['gone']);
        const dropped = lesson();
        call(pctx, 'dropUnusedLessonImages')(dropped);
        assert.deepStrictEqual(Object.keys(dropped.images), ['a', 'g', 's', 'x']);
        assert.deepStrictEqual(plain(call(pctx, 'unusedLessonImageIds')({ ...lesson(), gyosuanAdv: undefined })).sort(), ['g', 'gone', 's', 'x']);
        assert.deepStrictEqual(['g', 's', 'x', 'gone'].map(key => call(pctx, 'lessonStillUsesImage')(lesson(), key)), [true, true, true, false], '그림 지우기: 다른 곳에서도 쓰는 그림');
        // 작업 기록(data-safety.js): 차시 기록은 심화학습 교수안이 쓰는 그림도 담고, 탭 하나 되돌리기의 '밖'에 심화학습 교수안을 센다
        for (const withTracks of [false, true]) {
            const sctx = { console, window: {}, JSON, Date, Map, Set, Promise };
            vm.createContext(sctx);
            if (withTracks) loadLessonTracks(sctx, { tabs: true });
            vm.runInContext(source('data-safety.js'), sctx);
            const entry = plain(call(sctx, 'historyEntry')({ id: 3, title: '차시', content: '', tabContents: { basicLearn: '![](local:a)' }, images: { a: PNG, g: PNG, z: PNG }, gyosuanAdv: { docMd: '![](local:g)' } }, { id: 1, date: 'd', subjectId: 's1' }));
            assert.deepStrictEqual(Object.keys(entry.images).sort(), ['a', 'g'], `차시 기록의 그림(${withTracks ? 'data.js 있음' : 'data.js 없음'})`);
            const outside = [...call(sctx, 'historyOutsideImageKeys')(lesson(), 'basicLearn')].sort();
            assert.deepStrictEqual(outside, ['g', 's', 'x']);
        }
    });

    /* ======================= 6. 불러온 저장본 검사·백업 ======================= */
    await run('불러온 저장본: 심화학습 교수안(gyosuanAdv)도 기본학습 교수안과 꼭 같은 규칙으로 검사하고, 바른 값은 같은 객체로 둔다. 백업은 그 그림도 따로 담았다가 되돌린다', () => {
        const sctx = { console, window: {}, JSON, Date, Map, Set, Promise };
        vm.createContext(sctx);
        loadLessonTracks(sctx, { tabs: true });
        vm.runInContext(source('data-safety.js'), sctx);
        const clean = call(sctx, 'cleanLessonFields');
        const junk = () => ({ docMd: 5, deckMd: 'ok', deckHtml: {}, sessionDecks: { 0: 'a', 1: 7 }, images: { ok: PNG, 'bad key!': PNG, z: 'javascript:alert(1)' }, deckRev: 2 });
        const both = clean({ gyosuan: junk(), gyosuanAdv: junk() });
        assert.deepStrictEqual(plain(both.gyosuanAdv), plain(both.gyosuan), '두 갈래를 같은 규칙으로');
        assert.deepStrictEqual(plain(both.gyosuanAdv), { docMd: null, deckMd: 'ok', deckHtml: null, sessionDecks: { 0: 'a' }, images: { ok: PNG }, deckRev: 2 });
        const good = { docMd: '# 교수안', deckMd: '', images: { g: PNG }, sessionDecks: { 0: '<x>' } };
        assert.strictEqual(clean({ gyosuanAdv: good }).gyosuanAdv, good, '바른 값은 그대로');
        assert.strictEqual(clean({ gyosuanAdv: 'x' }).gyosuanAdv, null);
        assert.ok(!('gyosuanAdv' in clean({ gyosuan: good })), '없는 칸은 만들지 않는다');
        assert.strictEqual(plain(call(sctx, 'cleanHistoryItem')({ id: 1, gyosuanAdv: junk() })).gyosuanAdv.docMd, null, '작업 기록 칸도 같은 검사');
        const tabs = clean({ tabContents: { advAssessment: '### 문제 1. 가', basicLearn: 3 } }).tabContents;
        assert.deepStrictEqual(plain(tabs), { advAssessment: '### 문제 1. 가', basicLearn: null }, '심화이해도 탭 글도 받는다');
        // 백업 ZIP·PC 폴더의 '따로·가볍게': 교수안 그림도 그림 파일로 떼었다가 되돌린다
        const big = `data:image/png;base64,${'A'.repeat(200)}`;
        const state = { subjects: [{ id: 's1', lessons: [{ id: 1, gyosuanAdv: { docMd: '![](local:g)', images: { g: big } } }] }] };
        const detached = call(sctx, 'detachBackupImages')(state, 'separate');
        const ref = detached.value.subjects[0].lessons[0].gyosuanAdv.images.g;
        assert.ok(call(sctx, 'isBackupImageRef')(ref) && Object.values(detached.files).includes(big));
        assert.deepStrictEqual(plain(call(sctx, 'attachBackupImages')(detached.value, detached.files)), state);
    });

    /* ======================= 7. 갈래마다 문제은행 ======================= */
    await run('문제은행: 문항·학습 목표·원고·빈 목표를 갈래마다 읽는다(심화학습은 심화이해도 탭과 심화학습·심화실습 탭)', () => {
        const ctx = flowContext();
        const mod = bankLesson();
        ctx.courseData = [mod];
        const objectives = call(ctx, 'qbankObjectives');
        assert.deepStrictEqual(plain(objectives(mod)), ['기본 목표 하나를 설명할 수 있습니다.', '기본 목표 둘을 비교할 수 있습니다.', '심화 목표 하나를 분석할 수 있습니다.'], '갈래를 주지 않으면 차시 전체(NCS·교육 자료)');
        assert.deepStrictEqual(plain(objectives(mod, 'basic')), ['기본 목표 하나를 설명할 수 있습니다.', '기본 목표 둘을 비교할 수 있습니다.']);
        assert.deepStrictEqual(plain(objectives(mod, 'adv')), ['심화 목표 하나를 분석할 수 있습니다.']);
        const noAdvGoals = { ...mod, tabContents: { ...mod.tabContents, advLearn: '## 심화 본문\n\n글' } };
        assert.deepStrictEqual(plain(objectives(noAdvGoals, 'adv')), plain(objectives(noAdvGoals)), '심화 탭에 목표가 없으면 차시의 목표');
        mod.tabContents.advAssessment = question(1, 1, '심화 문항');
        assert.deepStrictEqual([call(ctx, 'qbankQuestions')(mod, 'basic')[0].title, call(ctx, 'qbankQuestions')(mod, 'adv')[0].title, call(ctx, 'qbankQuestions')(mod)[0].title], ['기본 문항', '심화 문항', '기본 문항']);
        mod.tabContents.advAssessment = null;
        const gaps = call(ctx, 'questionBankGaps');
        assert.deepStrictEqual([plain(gaps(mod, 'basic')), plain(gaps(mod, 'adv')), call(ctx, 'lessonQuestionGaps')(mod)], [[2], [1], 2]);
        assert.deepStrictEqual(plain(gaps({ ...mod, tabContents: { ...mod.tabContents, advLearn: null, advPrac: null } }, 'adv')), [], '학습·실습 탭이 빈 갈래는 채우지 않는다');
        const prompt = call(ctx, 'buildQuestionPrompt');
        const spec = { objective: 1, band: 'L1', type: '객관식', multi: false, count: 3 };
        const advPrompt = prompt(mod, spec, objectives(mod, 'adv'), [], 'adv');
        assert.ok(advPrompt.includes('[학습 목표 1] 심화 목표 하나를 분석할 수 있습니다.') && advPrompt.includes('심화원고표식') && advPrompt.includes('심화실습원고') && !advPrompt.includes('기본원고표식'));
        const basicPrompt = prompt(mod, spec, objectives(mod, 'basic'), [], 'basic');
        assert.ok(basicPrompt.includes('기본원고표식') && !basicPrompt.includes('심화원고표식') && basicPrompt.includes('[학습 목표 1] 기본 목표 하나를 설명할 수 있습니다.'));
        // 학습이해도·심화이해도 탭 생성 지시에 붙이는 목표 목록과 생성 뒤 목표 점검 알림도 그 갈래
        const listFor = call(ctx, 'assessmentObjectivePrompt');
        assert.ok(listFor(mod, 'advAssessment').includes('1. 심화 목표 하나를 분석할 수 있습니다.') && !listFor(mod, 'advAssessment').includes('기본 목표'));
        assert.ok(listFor(mod, 'assessment').includes('2. 기본 목표 둘을 비교할 수 있습니다.') && !listFor(mod, 'assessment').includes('심화 목표'));
        assert.strictEqual(listFor(mod, 'advLearn'), '');
        call(ctx, 'warnUncoveredObjectives')(noAdvGoals, question(1, 1, '하나만'), 'advAssessment');
        assert.ok(ctx.toasts.at(-1).message.startsWith('심화이해도 점검:') && ctx.toasts.at(-1).message.includes('문제은행의 심화학습에서'), ctx.toasts.at(-1).message);
    });

    await run('문제은행 채우기와 CSV: 전체 생성은 두 문제은행을 모두 채우고, 교과 CSV는 머리줄을 그대로 두고 학습모듈 칸에 갈래를 적는다. 차시 CSV는 보는 갈래만', async () => {
        const ctx = flowContext();
        const mod = bankLesson();
        ctx.courseData = [mod];
        const asked = [];
        ctx.generateQuestions = async (lesson, spec, trackId) => {
            asked.push(`${trackId}:${spec.objective}`);
            return [{ no: 0, title: `${trackId} 새 문항`, objective: spec.objective, band: 'L1', type: '객관식', typed: true, multi: false, stem: '내용', media: '', choices: [{ mark: '①', text: '가' }, { mark: '②', text: '나' }, { mark: '③', text: '다' }, { mark: '④', text: '라' }], answer: '②', accepted: '', hint: '', code: '', lang: '', explanation: '', rubric: '', tests: '', review: '' }];
        };
        const statuses = [];
        assert.deepStrictEqual(plain(await call(ctx, 'fillQuestionBank')(1, { onStatus: text => statuses.push(text) })), { ok: true });
        assert.deepStrictEqual(asked, ['basic:2', 'adv:1']);
        assert.ok(mod.tabContents.assessment.includes('### 문제 2. basic 새 문항') && mod.tabContents.advAssessment.includes('### 문제 1. adv 새 문항'));
        assert.ok(statuses.some(text => text.startsWith('심화학습 학습 목표 1')) && mod.history.some(row => row.note.startsWith('심화학습 문제은행 문항 생성')));
        assert.deepStrictEqual([call(ctx, 'lessonQuestionGaps')(mod), asked.length], [0, 2]);
        const { rows, csv } = call(ctx, 'subjectQuestionsCsv')({ title: '교과', lessons: [mod] });
        const lines = csv.replace(/^﻿/, '').split('\r\n');
        assert.strictEqual(lines[0], '문항ID,단원,학습모듈,목표번호,학습목표,밴드,유형,복수정답,문항,보기1,보기2,보기3,보기4,보기5,정답,허용표기,모범답안,채점기준,시작코드,테스트케이스,루브릭,해설,검수', '머리줄은 그대로');
        assert.strictEqual(rows, 3);
        assert.ok(lines[1].startsWith('1-1,교과,재미 · 기본학습,1,') && lines[2].startsWith('1-2,교과,재미 · 기본학습,2,') && lines[3].startsWith('1-adv-1,교과,재미 · 심화학습,1,심화 목표 하나를 분석할 수 있습니다.'), lines.slice(1).join('\n'));
        const saved = [];
        vm.runInContext('downloadCsv = (csv, name) => { window.savedCsv.push({ csv, name }); };', Object.assign(ctx, { savedCsv: saved }));
        ctx.globalState.subjects = [{ id: 's1', title: '교과', lessons: [mod] }];
        call(ctx, 'saveQbankCsv')(mod, 'adv');
        assert.ok(saved[0].name.endsWith('_심화학습') && saved[0].csv.includes('1-adv-1') && !saved[0].csv.includes('재미 · 기본학습'), saved[0].name);
        call(ctx, 'saveQbankCsv')(mod, 'basic');
        assert.ok(saved[1].name.endsWith('_기본학습') && !saved[1].csv.includes('심화학습'));
    });

    await run('문제은행 화면: 위쪽 기본학습 | 심화학습 고르기(점은 그 갈래의 문항), 갈래를 바꾸면 그 자리에서 다시 그리고, 고치는 중에는 바꾸지 않는다', () => {
        const ctx = flowContext();
        const mod = bankLesson();
        ctx.courseData = [mod];
        ctx.currentEditingModuleId = 1;
        const html = call(ctx, 'lessonTrackSwitchHtml')(mod, 'qbank', 'dark');
        assert.ok(html.includes("setLessonPanelTrack('basic')") && html.includes("setLessonPanelTrack('adv')") && html.includes('aria-pressed="true"'));
        assert.ok(html.includes('심화학습 문항이 아직 없습니다') && html.includes('기본학습 문항이 있습니다'), '어느 갈래에 문항이 있는지 보인다');
        assert.ok(call(ctx, 'lessonTrackSwitchHtml')({ ...mod, tabContents: { ...mod.tabContents, advLearn: null, advPrac: null } }, 'gyosuan').includes('교안 없음'));
        let drawn = 0;
        vm.runInContext("renderQbank = () => { window.qbankDrawn += 1; }; _qbank = { moduleId: 1, track: 'basic', band: 'L1', objective: '2', editing: null, draft: null, status: '', spec: { objective: 2, band: 'L1', type: '객관식', multi: false, count: 3 }, busy: false, inline: true };", Object.assign(ctx, { qbankDrawn: drawn }));
        ctx.setLessonPanelTrack('adv');
        assert.deepStrictEqual([call(ctx, 'lessonPanelTrack')(), call(ctx, '_qbank.track'), call(ctx, '_qbank.objective'), call(ctx, '_qbank.spec.objective'), ctx.qbankDrawn], ['adv', 'adv', '', 1, 1], '목표 고르기는 1번부터');
        vm.runInContext("_qbank = { ..._qbank, editing: 0 };", ctx);
        ctx.setLessonPanelTrack('basic');
        assert.strictEqual(call(ctx, 'lessonPanelTrack')(), 'adv', '고치는 중에는 바꾸지 않는다');
        assert.ok(ctx.toasts.at(-1).message.includes('저장하거나 취소한 뒤'));
        vm.runInContext('_qbank = null;', ctx);
        ctx.setLessonPanelTrack('basic');
        assert.strictEqual(call(ctx, 'lessonPanelTrack')(), 'basic', '페이지를 연 동안 마지막 선택을 기억한다');
        // 탐색줄 점: 교안이 있는 갈래가 모두 그 항목을 가졌을 때
        const done = call(ctx, 'lessonPanelDone');
        assert.deepStrictEqual([done({ ...mod, gyosuan: { docMd: '#' } }, 'gyosuan'), done({ ...mod, gyosuan: { docMd: '#' }, gyosuanAdv: { docMd: '#' } }, 'gyosuan')], [false, true]);
        assert.strictEqual(done({ ...mod, tabContents: { ...mod.tabContents, advLearn: null, advPrac: null }, gyosuan: { docMd: '#' } }, 'gyosuan'), true, '교안이 없는 갈래는 세지 않는다');
        assert.deepStrictEqual([done({ id: 2, tabContents: {}, gyosuanAdv: { deckHtml: '<x>' } }, 'slides'), done({ id: 2, tabContents: {} }, 'slides')], [true, false], '교안이 없으면 어느 갈래든 항목이 있으면');
        assert.deepStrictEqual([done(mod, 'qbank'), done({ ...mod, tabContents: { ...mod.tabContents, advAssessment: question(1, 1, '심화') } }, 'qbank')], [false, true]);
    });

    /* ======================= 8. 여섯째 탭: 내보내기·불러오기 ======================= */
    await run('여섯째 탭: ZIP 파일 이름 06_심화이해도, 다시 불러오면 심화이해도 탭으로. 예전 다섯 탭 파일과 06_교수안도 그대로 읽는다', () => {
        const zip = { window: {} };
        vm.createContext(zip);
        vm.runInContext(`${slice('ui.js', 'const ZIP_TAB_FILE_NAMES = ', ';\n')}\nwindow.names = ZIP_TAB_FILE_NAMES;`, zip);
        assert.deepStrictEqual(plain(zip.window.names), { basicLearn: '01_기본학습', basicPrac: '02_기본실습', advLearn: '03_심화학습', advPrac: '04_심화실습', assessment: '05_학습이해도', advAssessment: '06_심화이해도' });
        const ctx = { console: { warn() {} }, window: {}, JSON, Date, Object, location: { hash: '' }, encodeURIComponent, decodeURIComponent, TextDecoder, TextEncoder, Uint8Array, Blob, atob, btoa, setTimeout };
        vm.createContext(ctx);
        loadLessonTracks(ctx, { tabs: true });
        vm.runInContext(slice('data.js', 'function stripInstructorCallouts('), ctx);
        ['import-stream.js', 'output-import.js'].forEach(file => vm.runInContext(source(file), ctx));
        const read = (name, text) => plain(call(ctx, 'readOutputText')(name, text)).map(item => item.raw.tabContents);
        assert.deepStrictEqual(read('06_심화이해도.md', '### 문제 1. 가'), [{ advAssessment: '### 문제 1. 가' }]);
        assert.deepStrictEqual(read('05_학습이해도 (1).md', '### 문제 1. 나'), [{ assessment: '### 문제 1. 나' }], '예전 파일');
        const whole = plain(call(ctx, 'parseOutputMarkdown')('# [05_학습이해도]\n\n기본 문항\n\n---\n\n# [06_심화이해도]\n\n심화 문항', '01_재미_전체.md'))[0].tabContents;
        assert.deepStrictEqual(whole, { assessment: '기본 문항', advAssessment: '심화 문항' });
        ['06_교수안.md', '07_교수안.md', '09_심화교수안.md', '10_심화슬라이드편성안.md'].forEach(name => {
            const text = name.includes('편성안') ? '### 슬라이드 1 - 시작' : '## 진행\n\n내용';
            assert.throws(() => call(ctx, 'readOutputText')(name, text), /완성 MD 불러오기/, `${name}은 교안 탭으로 넣지 않는다`);
        });
        const lesson = call(ctx, 'normalizeImportedLesson')({ title: '가', tabContents: { advAssessment: '심화 문항', basicLearn: '글' } }, 1);
        assert.deepStrictEqual([lesson.tabContents.advAssessment, lesson.content.includes('심화 문항')], ['심화 문항', true]);
    });

    await run('교수안 HTML 원본: 심화학습 교수안은 gyosuanAdv 칸에 담겨 그 칸으로 돌아오고, 예전 파일(gyosuan)은 기본학습 교수안이 된다. 같은 차시의 두 파일은 한 차시로 합친다', () => {
        const ctx = { console: { warn() {} }, window: {}, JSON, Date, Object, location: { hash: '' }, encodeURIComponent, decodeURIComponent, TextDecoder, TextEncoder, Uint8Array, Blob, atob, btoa, setTimeout };
        vm.createContext(ctx);
        loadLessonTracks(ctx, { tabs: true });
        vm.runInContext(slice('data.js', 'function stripInstructorCallouts('), ctx);
        ['import-stream.js', 'output-import.js'].forEach(file => vm.runInContext(source(file), ctx));
        const mod = { title: '재미', tabContents: { basicLearn: '기본 글', advLearn: '심화 글' }, images: { a: PNG, g: JPG },
            gyosuan: { docMd: '# 기본 교수안 ![](local:a)', deckMd: '# 기본 편성안', images: {} }, gyosuanAdv: { docMd: '# 심화 교수안 ![](local:g)', deckMd: '# 심화 편성안', images: { g: JPG } } };
        const payload = plain(call(ctx, 'lessonSourcePayload')([mod], { withGyosuan: true, track: 'adv' }));
        assert.deepStrictEqual([payload.lessons[0].gyosuan, payload.lessons[0].gyosuanAdv.docMd], [null, '# 심화 교수안 ![](local:g)']);
        const htmlOf = p => `<main>보이는 글</main>${call(ctx, 'lessonSourceScript')(p)}`;
        const advBack = plain(call(ctx, 'normalizeImportedLesson')(plain(call(ctx, 'parseOutputHtml')(htmlOf(payload)))[0], 1));
        assert.deepStrictEqual([advBack.gyosuan, advBack.gyosuanAdv.docMd, advBack.gyosuanAdv.images], [undefined, '# 심화 교수안 ![](local:g)', { g: JPG }]);
        const basicPayload = plain(call(ctx, 'lessonSourcePayload')([mod], { withGyosuan: true }));
        assert.ok(basicPayload.lessons[0].gyosuan.docMd.startsWith('# 기본 교수안') && !('gyosuanAdv' in basicPayload.lessons[0]), '기본학습은 예전과 같은 모양');
        const basicBack = plain(call(ctx, 'normalizeImportedLesson')(plain(call(ctx, 'parseOutputHtml')(htmlOf(basicPayload)))[0], 2));
        assert.deepStrictEqual([basicBack.gyosuan.docMd.startsWith('# 기본 교수안'), basicBack.gyosuanAdv], [true, undefined]);
        // 같은 차시의 기본학습·심화학습 교수안 HTML을 함께 고르면 두 교수안을 가진 한 차시가 된다
        const items = [{ lesson: basicBack, from: 'html', file: 0, titleRank: 2 }, { lesson: advBack, from: 'html', file: 1, titleRank: 2 }];
        const { kept, dropped } = call(ctx, 'dedupeImported')(items);
        assert.strictEqual(dropped, 1);
        assert.ok(kept[0].lesson.gyosuan.docMd.startsWith('# 기본 교수안') && kept[0].lesson.gyosuanAdv.docMd.startsWith('# 심화 교수안'));
        const text = call(ctx, 'describeOutputImport')(kept, { fileCount: 2, where: '교과에' });
        assert.ok(text.includes('기본학습 교수안 · 심화학습 교수안') && !text.includes('교수안은 들어 있지 않습니다'), text);
    });

    /* ======================= 9. 전체 생성·일괄 생성 ======================= */
    await run('전체 생성: 기본학습·심화학습 교수안·슬라이드를 따로 단계로 두고, 미리 보기는 교수안 둘과 문제은행 둘을 센다. 있는 갈래는 다시 만들지 않는다', async () => {
        const ctx = flowContext();
        const fresh = { id: 1, title: '새 차시', tabContents: {} };
        ctx.courseData = [fresh];
        const steps = plain(call(ctx, 'pipelineSteps')(1, {}));
        const plans = steps.filter(step => step.gyosuan);
        assert.deepStrictEqual(plans.map(step => [step.id, step.label]), [['gyosuan', '기본학습 교수안·슬라이드'], ['gyosuanAdv', '심화학습 교수안·슬라이드']]);
        assert.ok(steps.findIndex(step => step.id === 'advAssessment') < steps.findIndex(step => step.id === 'gyosuan'), '심화이해도 탭도 교수안 앞에 만든다');
        const seen = [];
        ctx.confirmWithEstimate = async (message, work) => { seen.push({ message, work: plain(work) }); return false; };
        await call(ctx, 'startLessonGeneration')(1);
        assert.ok(seen[0].message.includes('기본학습 교수안·슬라이드') && seen[0].message.includes('심화학습 교수안·슬라이드') && seen[0].message.includes('심화이해도'));
        assert.deepStrictEqual([seen[0].work.gyosuan, seen[0].work.qbank, seen[0].work.tabs], [2, 2, 6]);
        const half = { ...bankLesson(), gyosuan: { docMd: '#' } };
        half.tabContents.advAssessment = question(1, 1, '심화');
        half.tabContents.assessment = `${question(1, 1, '가')}\n\n${question(2, 2, '나')}`;
        ctx.courseData = [half];
        await call(ctx, 'startLessonGeneration')(1);
        assert.ok(seen[1].message.includes('심화학습 교수안·슬라이드') && !seen[1].message.includes('기본학습 교수안·슬라이드'), seen[1].message);
        assert.deepStrictEqual([seen[1].work.gyosuan, seen[1].work.qbank], [1, 0]);
        // 실제로 돌리면 빠진 갈래만 만든다
        const made = [];
        ctx.runGyosuanGeneration = async (id, opts) => { made.push(opts.track); half.gyosuanAdv = { docMd: '#' }; return { ok: true }; };
        await call(ctx, 'runLessonPipeline')(1);
        assert.deepStrictEqual(made, ['adv']);
        const needs = call(ctx, 'lessonNeedsGyosuan');
        assert.deepStrictEqual([needs(half, 'basic'), needs(half, 'adv'), needs(fresh, 'adv'), needs({ id: 3, tabContents: Object.fromEntries(['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment', 'advAssessment'].map(id => [id, id.startsWith('adv') ? '  ' : '글'])) }, 'adv')],
            [false, false, true, false], '빈칸뿐인 심화 탭은 만들 원고가 없다');
    });

    await run('일괄 생성: 대기열·미리 보기가 갈래마다 교수안을 센다. 덮어쓰기는 두 갈래 교수안을 모두 비우고 휴지통 사본에 담는다', async () => {
        const ctx = flowContext();
        const full = () => ({ ...bankLesson(), tabContents: { ...bankLesson().tabContents, advAssessment: question(1, 1, '심화') } });
        const subject = { id: 's1', title: '교과', lessons: [{ ...full(), id: 1, gyosuan: { docMd: '#' } }, { ...full(), id: 2, gyosuan: { docMd: '#' }, gyosuanAdv: { docMd: '#' } }] };
        subject.lessons[0].tabContents.assessment = `${question(1, 1, '가')}\n\n${question(2, 2, '나')}`;
        subject.lessons[1].tabContents.assessment = subject.lessons[0].tabContents.assessment;
        ctx.globalState.subjects = [subject];
        ctx.courseData = subject.lessons;
        assert.deepStrictEqual(plain(call(ctx, 'runnableLessons')([subject], true)).map(item => item.lessonId), [1], '심화학습 교수안이 빠진 차시만');
        const work = plain(call(ctx, 'lessonRunWork')(plain(call(ctx, 'runnableLessons')([subject], true)).map(item => ({ ...item, subject })), { withGyosuan: true, overwrite: false, art: false, genOptions: {} }));
        assert.deepStrictEqual([work.gyosuan, work.qbank], [1, 0]);
        const rewrite = plain(call(ctx, 'lessonRunWork')([{ subject, lessonId: 2, title: '가' }], { withGyosuan: true, overwrite: true, art: false, genOptions: {} }));
        assert.deepStrictEqual([rewrite.gyosuan, rewrite.qbank, rewrite.tabs], [2, 2, 6]);
        ctx.globalState.lessonTrash = [];
        ctx.trashLessonCopy = lesson => { ctx.globalState.lessonTrash.push({ lesson: JSON.parse(JSON.stringify(lesson)) }); return ctx.globalState.lessonTrash.at(-1).lesson; };
        const cleared = await call(ctx, 'clearLessonForRewrite')(subject.lessons[1], true, 's1');
        assert.deepStrictEqual([subject.lessons[1].gyosuan, subject.lessons[1].gyosuanAdv, cleared.trashed], [null, null, true]);
        assert.deepStrictEqual(ctx.globalState.lessonTrash[0].lesson.gyosuanAdv, { docMd: '#' }, '휴지통 사본에 심화학습 교수안도 있다');
        const bundle = call(ctx, 'subjectBundleMd')({ title: '교과', lessons: [{ id: 1, title: '첫째', tabContents: fourTabs(), gyosuan: { docMd: '# 교수안 - 첫째' }, gyosuanAdv: { docMd: '# 교수안 - 첫째 (심화학습)' } }, { id: 2, title: '둘째', tabContents: fourTabs(), gyosuan: { docMd: '# 교수안 - 둘째' } }] });
        assert.ok(bundle.indexOf('# 교수안 - 첫째\n') < bundle.indexOf('# 교수안 - 첫째 (심화학습)') && bundle.indexOf('# 교수안 - 첫째 (심화학습)') < bundle.indexOf('# 교수안 - 둘째'));
        assert.ok(bundle.includes('1. 첫째 (기본학습·심화학습)') && bundle.includes('## 교수안이 아직 없는 차시\n\n- 둘째 · 심화학습'), bundle.slice(0, 400));
    });

    /* ======================= 10. 심화이해도 지시·검수 ======================= */
    await run('심화이해도 지시: 학습이해도와 같은 규칙·형식으로 심화학습·심화실습을 점검하고, 학습이해도 지시는 예전 그대로다. 검수도 학습이해도와 같이 본다', () => {
        const ctx = {
            console: { log() {}, warn() {}, error() {} }, JSON, Map, Set, Promise, Date,
            localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, location: { hash: '' },
            document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add() {} } }), body: { appendChild() {} } },
            globalState: { subjects: [] }, currentSubjectId: null, courseData: [], instructorTone: 'formal', getReferenceContext: () => ''
        };
        ctx.window = ctx;
        vm.createContext(ctx);
        ['data.js', 'lesson-lint.js', 'course-design.js', 'ui.js', 'course-qbank.js', 'lesson-review.js'].forEach(file => vm.runInContext(source(file), ctx));
        const build = (tabId, extra = {}) => call(ctx, 'buildTaskContext')('tab_content', { tabId, tabLabel: tabId, title: '재미', description: '설명', ...extra });
        const adv = build('advAssessment');
        const basic = build('assessment');
        assert.ok(adv.userPrompt.includes('이 교안의 "심화 학습 이해도 점검" 영역을 작성하세요.') && adv.userPrompt.includes('"심화 학습"과 "심화 실습"의 이해도를 점검') && adv.userPrompt.includes('[형식 규칙 — 반드시 준수]') && adv.userPrompt.includes('심화 학습의 학습 목표 번호'));
        assert.ok(basic.userPrompt.includes('이 탭은 "기본 학습" 본과정의 이해도를 점검하는 독립 평가 모듈로, 30~60분 분량입니다.\n\n[형식 규칙 — 반드시 준수]') && !basic.userPrompt.includes('심화 학습 이해도'));
        assert.strictEqual(adv.systemInstruction, basic.systemInstruction, '규칙(빼는 규칙 포함)은 학습이해도와 같다');
        assert.strictEqual(call(ctx, 'buildTabRules')('advAssessment'), call(ctx, 'buildTabRules')('assessment'));
        assert.ok(!build('advAssessment', { codeTopic: true }).userPrompt.includes('[코드 예제 — 이 차시는 코드를 다룹니다]'), '코드 예제 지시는 붙이지 않는다');
        const cont = tabId => call(ctx, 'buildTaskContext')('tab_content_continue', { tabId, tabLabel: tabId, title: '재미', description: '설명', chunkIndex: 1, previousContent: '앞', codeTopic: true });
        assert.strictEqual(cont('advAssessment').systemInstruction, cont('assessment').systemInstruction);
        assert.ok(!cont('advAssessment').userPrompt.includes('[코드 예제'));
        // 검수: 목표 대응과 문항 규칙, 코드 예제 규칙을 빼는 것까지 학습이해도와 같다
        const md = `${question(1, 1, '하나')}\n`;
        const lint = (tabId, objectiveCount) => plain(call(ctx, 'lintLessonMarkdown')(md, tabId, { objectiveCount })).filter(issue => issue.where === '학습 목표 대응').length;
        assert.deepStrictEqual([lint('assessment', 2), lint('advAssessment', 2), lint('basicLearn', 2)], [1, 1, 0]);
        const review = call(ctx, 'reviewSystemPrompt');
        const rules = vm.runInContext('CONTEXT_CORE.rules', ctx);
        assert.ok(review('advAssessment').includes(rules.assessment_design) && !review('advAssessment').includes(rules.code_examples));
        assert.strictEqual(review('advAssessment'), review('assessment'));
        const mod = bankLesson();
        assert.deepStrictEqual([plain(call(ctx, 'lessonLintContext')(mod, 'advAssessment')).objectiveCount, plain(call(ctx, 'lessonLintContext')(mod, 'assessment')).objectiveCount], [1, 2], '그 갈래의 목표 수로 본다');
        assert.ok(call(ctx, 'reviewRulesHtml')('advAssessment').includes('<h4 class="font-bold text-textLight mt-2">문항</h4>'));
    });

    /* ======================= 11. 그 밖에 갈래를 보는 곳 ======================= */
    await run('학습 목표 지우기: 심화학습 탭의 목표를 지우면 심화이해도 문항 번호를 고치고 학습이해도는 그대로 둔다. 연결 문항 수도 그 갈래에서 센다', async () => {
        const ctx = flowContext();
        ['lesson-review.js', 'lesson-objectives.js'].forEach(file => vm.runInContext(source(file), ctx));
        const mod = bankLesson();
        mod.tabContents.advLearn = goalsMd(['심화 목표 하나를 분석할 수 있습니다.', '심화 목표 둘을 적용할 수 있습니다.'], '## 심화 본문\n\n심화원고표식 글입니다.');
        const basicBank = `${question(1, 1, '기본 하나')}\n\n${question(2, 2, '기본 둘')}\n`;
        mod.tabContents.assessment = basicBank;
        mod.tabContents.advAssessment = `${question(1, 1, '심화 하나')}\n\n${question(2, 2, '심화 둘')}\n`;
        ctx.courseData = [mod];
        ctx.currentLessonTab = 'advLearn';
        vm.runInContext("_objectiveDialog = { moduleId: 1, tabId: 'advLearn', pick: 0 };", ctx);
        assert.ok(call(ctx, 'objectiveImpactHtml')(mod, mod.tabContents.advLearn, 0).includes('이 목표에 연결된 문항 1개'), '심화이해도에서 1번 목표의 문항');
        const dialog = { querySelectorAll: () => [], querySelector: () => null }; // 함께 지울 섹션 없음, 문항은 남기고 연결만 푼다
        ctx.document.getElementById = id => (id === 'objective-dialog' ? dialog : null);
        await call(ctx, 'runObjectiveRemove')(mod, 'advLearn', 0);
        const parse = text => plain(call(ctx, 'lessonLintQuestions')(text).map(call(ctx, 'parseQuestionBlock')));
        assert.deepStrictEqual(parse(mod.tabContents.advAssessment).map(q => [q.title, q.objective]), [['심화 하나', null], ['심화 둘', 1]]);
        assert.strictEqual(mod.tabContents.assessment, basicBank, '학습이해도는 그대로');
        assert.deepStrictEqual(ctx.archived.map(item => [item.tabId, item.title]), [['advLearn', '재미 · 심화학습'], ['advAssessment', '재미 · 심화이해도']]);
    });

    await run('예전 학습이해도: 갈래를 나누기 전에 차시 전체 목표 번호로 만든 문항은 필수 지적 없이 예전 번호로 읽고 안내한다. 새로 만들거나 채울 때는 기본학습 목표만 쓴다', async () => {
        const ctx = flowContext();
        ['lesson-review.js', 'lesson-objectives.js'].forEach(file => vm.runInContext(source(file), ctx));
        const mod = bankLesson();
        mod.tabContents.advLearn = goalsMd(['심화 목표 하나를 분석할 수 있습니다.', '심화 목표 둘을 적용할 수 있습니다.'], '## 심화 본문\n\n심화원고표식 글입니다.');
        // 예전에는 학습이해도 번호가 기본 목표 1·2, 심화 목표 3·4였다
        mod.tabContents.assessment = `${question(1, 1, '기본 하나')}\n\n${question(2, 3, '심화 하나')}\n\n${question(3, 4, '심화 둘')}\n`;
        ctx.courseData = [mod];
        const all = ['기본 목표 하나를 설명할 수 있습니다.', '기본 목표 둘을 비교할 수 있습니다.', '심화 목표 하나를 분석할 수 있습니다.', '심화 목표 둘을 적용할 수 있습니다.'];
        assert.deepStrictEqual(plain(call(ctx, 'qbankObjectives')(mod, 'basic')), all, '예전 번호 목록');
        assert.deepStrictEqual(plain(call(ctx, 'qbankTrackObjectives')(mod, 'basic')), all.slice(0, 2));
        const context = plain(call(ctx, 'lessonLintContext')(mod, 'assessment'));
        const issues = plain(call(ctx, 'lintLessonMarkdown')(mod.tabContents.assessment, 'assessment', context));
        assert.ok(!issues.some(issue => issue.msg === '대응하는 학습 목표가 없습니다.'), JSON.stringify(issues));
        const rows = plain(call(ctx, 'lessonBankCsvRows')({ title: '교과' }, mod, 'basic'));
        assert.deepStrictEqual(rows.map(row => row[4]), [all[0], all[2], all[3]], 'CSV 학습목표 칸이 비지 않는다');
        assert.ok(call(ctx, 'reviewIssuesHtml')([], 'assessment', mod.tabContents.assessment, mod).includes('예전 방식으로 만든 학습이해도에 심화학습 목표 문항이 있습니다.'));
        assert.strictEqual(call(ctx, 'qbankLegacyNote')(mod, 'adv'), '');
        assert.strictEqual(call(ctx, 'qbankLegacyNote')(bankLesson(), 'basic'), '', '새 방식 차시는 안내하지 않는다');
        // 채우기는 기본학습 목표(2번)만, 다시 만드는 학습이해도 지시도 기본학습 목표만
        assert.deepStrictEqual(plain(call(ctx, 'questionBankGaps')(mod, 'basic')), [2]);
        const skipped = { ...mod, tabContents: { ...mod.tabContents, assessment: `${question(1, 1, '기본 하나')}\n\n${question(2, 4, '심화 둘')}\n` } };
        assert.deepStrictEqual(plain(call(ctx, 'questionBankGaps')(skipped, 'basic')), [2], '예전 번호의 심화학습 목표(3번)는 학습이해도에 채우지 않는다');
        const listed = call(ctx, 'assessmentObjectivePrompt')(mod, 'assessment');
        assert.ok(listed.includes('2. 기본 목표 둘을 비교할 수 있습니다.') && !listed.includes('심화 목표'), listed);
        // 심화학습 목표를 지우면 예전 학습이해도의 번호도 고친다(지운 목표의 문항은 연결만 푼다)
        const dialog = { querySelectorAll: () => [], querySelector: () => ({ value: 'delete' }) };
        ctx.document.getElementById = id => (id === 'objective-dialog' ? dialog : null);
        vm.runInContext("_objectiveDialog = { moduleId: 1, tabId: 'advLearn', pick: 0 };", ctx);
        await call(ctx, 'runObjectiveRemove')(mod, 'advLearn', 0);
        const parse = text => plain(call(ctx, 'lessonLintQuestions')(text).map(call(ctx, 'parseQuestionBlock')));
        assert.deepStrictEqual(parse(mod.tabContents.assessment).map(q => [q.title, q.objective]), [['기본 하나', 1], ['심화 하나', null], ['심화 둘', 3]]);
        assert.strictEqual(call(ctx, 'qbankObjectives')(mod, 'basic')[2], '심화 목표 둘을 적용할 수 있습니다.');
        assert.ok(ctx.archived.some(item => item.tabId === 'assessment'), '고치기 전 학습이해도를 작업 기록에 남긴다');
    });

    await run('교수안 그림 고르기: 그 갈래의 학습·실습 탭에 놓인 그림만 슬라이드 이미지 후보로 쓴다', () => {
        const ctx = studioContext();
        const mod = { id: 'm1', title: '재미', images: { pic_basic: PNG, pic_adv: JPG, pic_shared: PNG },
            tabContents: { basicLearn: '## 기본 그림\n\n![기본](local:pic_basic)\n\n![같이](local:pic_shared)', basicPrac: null, advLearn: '## 심화 그림\n\n![심화](local:pic_adv)', advPrac: '## 심화 실습\n\n![같이](local:pic_shared)' } };
        const pick = call(ctx, 'lessonImageCandidates');
        assert.deepStrictEqual(plain(pick(mod)).map(item => item.id), ['pic_basic', 'pic_shared']);
        assert.deepStrictEqual(plain(pick(mod, 'adv')).map(item => item.id), ['pic_adv', 'pic_shared']);
        // 그림 키가 다른 키의 앞부분이어도(local:b와 local:both) 그 키를 가리킨 자리만 본다. 다른 갈래의 그림이 섞이지 않고 설명도 제자리 글을 쓴다
        const prefix = { id: 'm2', title: '앞 글자', images: { b: PNG, both: JPG },
            tabContents: { basicLearn: '## 함께 쓰는 그림\n\n![둘](local:both)', advLearn: '## 혼자 쓰는 그림\n\n![하나](local:b)' } };
        assert.deepStrictEqual(plain(pick(prefix)).map(item => [item.id, item.title]), [['both', '둘']], 'local:both는 local:b가 아니다');
        assert.deepStrictEqual(plain(pick(prefix, 'adv')).map(item => [item.id, item.title]), [['b', '하나']]);
    });

    await run('판서 영상: 심화학습 교수안·편성안에만 남은 그림도 차시 글에 있는 것으로 보고, 같은 값의 그림 키가 여럿이면 그 교수안이 가리키는 키에 버튼을 단다', () => {
        const mod = whiteboardLesson({ images: { img_story: PNG }, tabContents: { basicLearn: '## 1. 절\n\n글' }, gyosuanAdv: { docMd: '## 진행\n\n![그림](local:img_story)' } });
        const ctx = whiteboardContext({ mod, files: ['whiteboard-video.js'] });
        const has = lesson => ctx.whiteboardPictureInLesson(lesson, 'img_story');
        assert.deepStrictEqual([has(mod), has({ ...mod, gyosuanAdv: { deckMd: '![](local:img_story)' } }), has({ ...mod, gyosuanAdv: { docMd: '![](local:img_story10)' } })], [true, true, false]);
        // 기록을 잃은 원래 그림 사본(img_copy)이 뒤에 있어도 심화학습 교수안이 가리키는 키를 고른다(whiteboardImageIds)
        const ids = lesson => plain([...ctx.whiteboardImageIds(lesson).entries()]);
        assert.deepStrictEqual(ids({ ...mod, images: { img_story: PNG, img_copy: PNG } }), [[PNG, 'img_story']], '심화학습 교수안이 가리키는 키');
        assert.deepStrictEqual(ids({ ...mod, images: { img_story: PNG, img_copy: PNG }, gyosuanAdv: { deckMd: '![](local:img_story)' } }), [[PNG, 'img_story']], '심화학습 편성안이 가리키는 키');
    });

    await run('차시 목록·교과 현황 배지: 문항은 두 문제은행을 더하고, 교수안은 교안이 있는 갈래를 모두 갖춘 차시만 센다', () => {
        const ctx = flowContext();
        ['course-list.js', 'course-overview.js'].forEach(file => vm.runInContext(source(file), ctx));
        const mod = { ...bankLesson(), tabContents: { ...bankLesson().tabContents, advAssessment: question(1, 1, '심화') } };
        ctx.courseData = [mod];
        ctx.globalState.subjects = [{ id: 's1', title: '교과', lessons: [mod] }];
        assert.ok(call(ctx, 'lessonListBadges')(mod).includes('문항 2'), '학습이해도 1 + 심화이해도 1');
        const badges = lessons => {
            ctx.courseData = lessons; // 열린 교과는 courseData의 차시를 센다
            return call(ctx, 'subjectStatusBadges')({ id: 's1', title: '교과', lessons });
        };
        assert.ok(badges([mod]).includes('문항 2'));
        assert.ok(!badges([{ ...mod, gyosuan: { docMd: '#' } }]).includes('교수안 '), '심화학습 교수안이 빠진 차시는 세지 않는다');
        assert.ok(badges([{ ...mod, gyosuan: { docMd: '#' }, gyosuanAdv: { docMd: '#' } }]).includes('교수안 1/1'));
        const basicOnly = { ...mod, tabContents: { ...mod.tabContents, advLearn: null, advPrac: null }, gyosuan: { docMd: '#' } };
        assert.ok(badges([basicOnly]).includes('교수안 1/1'), '교안이 없는 갈래는 세지 않는다');
    });

    await run('교안 생성 미리 보기(차시 카드): 탭을 모두 다시 만들어 빠진 갈래의 교수안과 두 문제은행을 센다', () => {
        const ctx = { console, lessonWork: work => work, estimateBoxHtml: work => work, lessonVolumeMinutes: () => 480, currentEstimateSettings: () => ({ imageAmount: 'normal' }), lessonPracticeWork: () => ({}) };
        vm.createContext(ctx);
        loadLessonTracks(ctx, { tabs: true });
        vm.runInContext(slice('api.js', 'function moduleGenerationEstimate('), ctx);
        const estimate = mod => plain(call(ctx, 'moduleGenerationEstimate')(mod));
        assert.deepStrictEqual([estimate({ id: 1 }).gyosuan, estimate({ id: 1 }).qbank, estimate({ id: 1 }).tabs.length], [2, 2, 6]);
        assert.strictEqual(estimate({ id: 1, gyosuan: { docMd: '#' } }).gyosuan, 1, '있는 교수안은 다시 만들지 않는다');
        assert.strictEqual(estimate({ id: 1, gyosuan: { docMd: '#' }, gyosuanAdv: { docMd: '#' } }).gyosuan, 0);
    });

    await run('빈 탭 목록: 과정 설계로 만든 새 차시와 탭이 없는 예전 저장본의 차시는 심화이해도 칸도 빈 채로 갖는다. 있는 탭 목록은 그대로 둔다', () => {
        const ctx = flowContext();
        const fresh = plain(call(ctx, 'moduleToLesson')({ title: '새 차시', objectives: ['목표'], minutes: 120, flow: [] }, 5));
        const EMPTY = { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null, advAssessment: null };
        assert.deepStrictEqual(fresh.tabContents, EMPTY);
        const sctx = {
            console: { log() {}, info() {}, warn() {}, error() {} }, JSON, Date, Map, Set, Promise, Symbol, Uint8Array, atob, btoa, setTimeout, clearTimeout,
            STORAGE_KEY: 'test-state', INITIAL_MOCK_STATE: { subjects: [] }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
            document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, visibilityState: 'visible' }, addEventListener() {}, location: { hash: '' }, escapeHtml: String
        };
        sctx.window = sctx;
        vm.createContext(sctx);
        ['filename-convention.js', 'data-safety.js', 'state.js'].forEach(file => vm.runInContext(source(file), sctx));
        const lessons = plain(call(sctx, 'sanitizeState')({ subjects: [{ id: 's1', title: '교과', lessons: [{ id: 1, title: '옛 차시', content: '옛 글' }, { id: 2, title: '탭 차시', tabContents: { basicLearn: '글' } }] }] })).subjects[0].lessons;
        assert.deepStrictEqual(lessons.map(lesson => lesson.tabContents), [EMPTY, { basicLearn: '글' }]);
    });

    await run('교육 자료 양식: 교과의 학습 목표는 차시마다 두 갈래의 목표를 모두 모은다(둘째 차시부터 기본학습 목표만 남지 않게)', () => {
        const ctx = flowContext();
        Object.assign(ctx, { stripInstructorCallouts: md => md, resolveMarkdownImages: md => md });
        ['lesson-sanitize.js', 'lesson-review.js', 'lesson-objectives.js', 'course-overview.js', 'lesson-material.js'].forEach(file => vm.runInContext(source(file), ctx));
        const lesson = (id, name) => ({ id, title: name, hours: 1, tabContents: {
            basicLearn: goalsMd([`${name} 기본 목표를 설명할 수 있습니다.`], `## ${name} 본문\n\n- 내용입니다.`),
            advLearn: goalsMd([`${name} 심화 목표를 분석할 수 있습니다.`], `## ${name} 심화\n\n- 내용입니다.`) } });
        const lessons = [lesson(1, '첫째'), lesson(2, '둘째')];
        const subject = { id: 's1', title: '기획', lessons };
        ctx.globalState.subjects = [subject];
        ctx.courseData = lessons;
        const md = call(ctx, 'materialDocMd')(subject, lessons);
        const goals = md.slice(md.indexOf('## 학습 목표'), md.indexOf('## 첫째'));
        ['첫째 기본', '첫째 심화', '둘째 기본', '둘째 심화'].forEach(text => assert.ok(goals.includes(`- ${text} 목표`), `${text}: ${goals}`));
    });

    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
