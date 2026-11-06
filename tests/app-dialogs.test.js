// 브라우저 기본 창 대신 앱의 창으로 묻는 곳 테스트: 차시 병합(merge.js), 이미지 저장 고르기·그림 자리 넣기(api.js) (실행: node tests/app-dialogs.test.js)
// 실제 파일을 vm에서 돌리고 확인·입력 창(confirmAsync·showConfirm·promptAsync)만 흉내 낸다. 기본 confirm·prompt를 부르면 실패한다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', 'js') + path.sep;
const read = file => fs.readFileSync(root + file, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const noNativeDialogs = {
    confirm: () => { throw new Error('브라우저 기본 확인 창을 쓰면 안 된다'); },
    prompt: () => { throw new Error('브라우저 기본 입력 창을 쓰면 안 된다'); }
};

async function run(name, fn) {
    await fn();
    console.log('PASS', name);
}

/* ---------- 차시 병합(merge.js) ---------- */
// answer: 확인 창의 답(함수면 묻는 동안 할 일까지). busy·filling: 다른 생성·기본 학습 분량 채우기가 도는가
function mergeContext({ answer = true, busy = () => false, filling = () => false } = {}) {
    const loading = { style: { display: 'none' } };
    const lesson = (id, title) => ({ id, title, description: '설명', content: `${title} 본문`, tabContents: { basicLearn: `${title} 본문` } });
    const subject = { id: 's1', title: '교과', lessons: [lesson(1, '반복문'), lesson(2, '조건문')] };
    const ctx = {
        ...noNativeDialogs,
        console: { log() {}, warn() {}, error() {} }, Promise, Set,
        globalState: { subjects: [subject, { id: 's2', title: '다른 교과', lessons: [] }] },
        currentSubjectId: 's1', courseData: subject.lessons,
        TEXT_MODEL: 'model', buildTaskContext: () => ({ systemInstruction: '지시', userPrompt: '병합' }),
        calls: 0, callGemini: async () => { ctx.calls += 1; return {}; }, extractText: () => '병합한 본문',
        saveState: async () => {}, renderSidebar() {}, renderEditor() {},
        document: { getElementById: id => (id === 'editor-loading' ? loading : null), querySelectorAll: () => [] },
        generationBusy: busy, isVolumeFilling: filling,
        asked: [], alerts: [], toasts: [],
        confirmAsync: async (message, opts) => {
            ctx.asked.push({ message, opts });
            return typeof answer === 'function' ? answer(ctx) : answer;
        }
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = message => ctx.toasts.push(message);
    vm.createContext(ctx);
    vm.runInContext(read('merge.js'), ctx);
    vm.runInContext("mergeSelectedIds = new Set(['1', '2'])", ctx);
    return { ctx, subject, loading };
}

/* ---------- api.js(review-flow.test.js와 같은 파일을 싣는다) ---------- */
const API_FILES = ['data.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js'];

function fakeElement() {
    return {
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', disabled: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener() {}, querySelector: () => fakeElement(), querySelectorAll: () => [],
        remove() { this.removed = true; }
    };
}

// mod: 열어 둔 차시. 받은 그림(a.click)은 ctx.downloads에 모은다
function apiContext(mod) {
    const elements = {};
    const ctx = {
        ...noNativeDialogs,
        console: { log() {}, warn() {}, error() {} },
        setTimeout: fn => { fn(); return 0; }, clearTimeout() {}, Promise, URL, Uint16Array, Blob,
        localStorage: { getItem: () => null, setItem() {} },
        currentEditingModuleId: mod.id,
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''),
        saved: 0, rendered: 0, downloads: [], alerts: [], toasts: [], elements,
        saveState: async () => { ctx.saved += 1; },
        renderSidebar() {}, showLessonView() {}, lessonDesignBrief: () => '', lessonGenBrief: () => '', archiveContent: async () => {},
        document: {
            readyState: 'complete', body: { appendChild() {} },
            createElement: tag => (tag === 'a' ? { click() { ctx.downloads.push(this.download); } } : fakeElement()),
            getElementById: id => elements[id] || null,
            addEventListener() {}, querySelectorAll: () => []
        }
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    vm.createContext(ctx);
    API_FILES.forEach(file => vm.runInContext(read(file), ctx));
    ctx.currentMod = mod;
    vm.runInContext('getEditingModule = (id = window.currentMod?.id) => (String(id) === String(window.currentMod?.id) ? window.currentMod : null); renderEditor = () => { window.rendered += 1; };', ctx);
    return ctx;
}

const tabs = extra => ({ basicLearn: '기본 글', basicPrac: '실습 글', advLearn: null, advPrac: null, assessment: null, ...extra });

(async () => {
    await run('차시 병합: 앱의 확인 창으로 묻고, 취소하면 새 차시를 만들지 않는다', async () => {
        const { ctx, subject } = mergeContext({ answer: false });
        await ctx.executeMerge();
        assert.strictEqual(subject.lessons.length, 2);
        assert.strictEqual(ctx.calls, 0);
        assert.ok(ctx.asked[0].message.includes('반복문\n조건문'), ctx.asked[0].message);
        assert.deepStrictEqual(plain(ctx.asked[0].opts), { title: '차시 병합', okLabel: '병합해 만들기', tone: 'primary' });
    });

    await run('차시 병합: 묻는 동안 다른 교과로 옮겼거나 다른 생성이 시작됐으면 시작하지 않는다', async () => {
        const moved = mergeContext({ answer: ctx => { ctx.currentSubjectId = 's2'; return true; } });
        await moved.ctx.executeMerge();
        assert.deepStrictEqual([moved.subject.lessons.length, moved.ctx.globalState.subjects[1].lessons.length, moved.ctx.calls], [2, 0, 0], '어느 교과에도 넣지 않는다');
        assert.ok(moved.ctx.toasts.at(-1).includes('교과가 바뀌어'), moved.ctx.toasts.at(-1));
        let busy = false;
        const started = mergeContext({ answer: () => { busy = true; return true; }, busy: () => busy });
        await started.ctx.executeMerge();
        assert.deepStrictEqual([started.subject.lessons.length, started.ctx.calls], [2, 0]);
        assert.strictEqual(started.ctx.alerts.at(-1), '진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
        assert.strictEqual(started.loading.style.display, 'none', '다른 생성의 로딩 화면을 건드리지 않는다');
    });

    await run('차시 병합: 다른 생성이나 기본 학습 분량 채우기가 도는 동안은 묻지도 않는다', async () => {
        const busy = mergeContext({ busy: () => true });
        await busy.ctx.executeMerge();
        const filling = mergeContext({ filling: () => true });
        await filling.ctx.executeMerge();
        assert.deepStrictEqual([busy.ctx.asked.length, filling.ctx.asked.length], [0, 0]);
        assert.deepStrictEqual([busy.ctx.alerts.at(-1), filling.ctx.alerts.at(-1)], ['진행 중인 생성이 끝난 뒤 다시 시도해주세요.', '진행 중인 생성이 끝난 뒤 다시 시도해주세요.']);
    });

    await run('차시 병합: 확인하면 지금 교과에 병합한 차시를 하나 만든다', async () => {
        const { ctx, subject, loading } = mergeContext();
        await ctx.executeMerge();
        assert.deepStrictEqual([subject.lessons.length, ctx.calls], [3, 1]);
        assert.deepStrictEqual([subject.lessons[2].title, subject.lessons[2].tabContents.basicLearn, subject.lessons[2].status], ['[병합] 반복문 + 조건문', '병합한 본문', 'done']);
        assert.strictEqual(loading.style.display, 'none');
    });

    await run('이미지 저장: 현재 탭만·전체 차시를 버튼으로 고르고, 바깥 클릭·Esc·같은 창은 아무것도 받지 않는다', async () => {
        const mod = { id: 1, title: '차시 1', tabContents: tabs({ basicLearn: '![a](local:img_a)', basicPrac: '![b](local:img_b)' }), images: { img_a: PNG, img_b: PNG, img_c: PNG, img_x: 'teacher-image:0123456789abcdef1a' } };
        const ctx = apiContext(mod);
        let asked = null;
        ctx.showConfirm = (message, onOk, opts) => { asked = { message, onOk, opts }; };
        ctx.downloadImagesAsJPG(1);
        assert.deepStrictEqual([asked.opts.title, asked.opts.okLabel, asked.opts.cancelLabel, asked.opts.tone], ['이미지 저장', '현재 탭만', '전체 차시', 'primary']);
        assert.ok(asked.message.includes('현재 탭: 1개') && asked.message.includes('전체 차시: 3개'), asked.message);
        assert.ok(!asked.message.includes('[확인]') && !asked.message.includes('[취소]'), '버튼 이름이 무엇을 하는지 말한다');
        assert.deepStrictEqual([ctx.downloads.length, ctx.toasts.length], [0, 0], '고르기 전에는 받지 않는다');
        ['outside', 'escape', 'duplicate'].forEach(reason => asked.opts.onCancel(reason));
        assert.deepStrictEqual([ctx.downloads.length, ctx.toasts.length], [0, 0], '바깥 클릭·Esc·같은 창은 아무것도 받지 않는다(예전에는 전체를 받았다)');
        asked.onOk();
        assert.deepStrictEqual(plain(ctx.downloads), ['차시_1_img_1.jpg']);
        assert.deepStrictEqual(plain(ctx.toasts.at(-1)), ['📸 1개 이미지 다운로드 시작', 'success']);
        asked.opts.onCancel('button');
        assert.strictEqual(ctx.downloads.length, 4, '전체 차시 버튼은 받을 수 있는 그림을 모두 받는다');
        assert.deepStrictEqual(plain(ctx.toasts.at(-1)), ['📸 3개 이미지 다운로드 시작', 'success']);
        asked = null;
        mod.tabContents = tabs({ basicLearn: '![a](local:img_a) ![b](local:img_b) ![c](local:img_c)' });
        ctx.downloadImagesAsJPG(1);
        assert.deepStrictEqual([asked, ctx.downloads.length], [null, 7], '고를 것이 없으면 묻지 않고 받는다');
    });

    await run('그림 자리 넣기: 앱의 입력 창으로 묻고 보고 있는 탭 끝에 넣는다(최종 평가처럼 탭이 없으면 본문 끝에)', async () => {
        const mod = { id: 1, title: '차시', tabContents: tabs(), content: '기본 글\n\n---\n\n실습 글', images: {} };
        const ctx = apiContext(mod);
        vm.runInContext("currentLessonTab = 'basicPrac'", ctx);
        const asked = [];
        ctx.promptAsync = async (message, opts) => { asked.push(opts); return '  game loop  '; };
        await ctx.insertImageSlot();
        assert.strictEqual(mod.tabContents.basicPrac, '실습 글\n<!-- [IMG: "game loop"] -->\n', '보고 있는 탭에 넣는다');
        assert.strictEqual(mod.tabContents.basicLearn, '기본 글');
        assert.ok(mod.content.includes('<!-- [IMG: "game loop"] -->'), '합친 본문도 맞춘다');
        assert.deepStrictEqual([ctx.saved, ctx.rendered], [1, 1]);
        assert.ok(ctx.toasts.at(-1)[0].startsWith('그림 자리를 탭 끝에 넣었습니다.'));
        assert.deepStrictEqual([asked[0].title, asked[0].okLabel], ['그림 자리 넣기', '넣기']);
        const quest = { id: 'mainQuest', title: '최종 평가', content: '과제 글', images: {} };
        const questCtx = apiContext(quest);
        vm.runInContext("currentLessonTab = 'assessment'", questCtx);
        questCtx.promptAsync = async () => 'diagram';
        await questCtx.insertImageSlot();
        assert.strictEqual(quest.content, '과제 글\n<!-- [IMG: "diagram"] -->\n', '탭이 없으면 본문 끝에(본문을 지우지 않는다)');
        assert.strictEqual(quest.tabContents, undefined, '탭을 만들지 않는다');
    });

    await run('그림 자리 넣기: 따옴표·]·줄바꿈·--·앞의 local:은 표시를 깨지 않게 빼고, 비우거나 취소하면 넣지 않는다', async () => {
        const mod = { id: 1, title: '차시', tabContents: tabs({ basicLearn: '글' }), images: {} };
        const ctx = apiContext(mod);
        const answers = ['cat "loop"] -->\n end', 'local:img_1', '   ', null];
        ctx.promptAsync = async () => answers.shift();
        for (let i = 0; i < 4; i++) await ctx.insertImageSlot();
        assert.strictEqual(mod.tabContents.basicLearn, '글\n<!-- [IMG: "cat loop -> end"] -->\n\n<!-- [IMG: "img_1"] -->\n');
        const tags = [...mod.tabContents.basicLearn.matchAll(vm.runInContext('IMAGE_TAG_RE', ctx))].map(match => match[1]);
        assert.deepStrictEqual(tags, ['cat loop -> end', 'img_1'], '그림 찾기가 읽는 그대로');
        assert.ok(!/local:/.test(mod.tabContents.basicLearn), '저장한 그림 자리로 읽히지 않는다');
        assert.strictEqual(ctx.saved, 2, '비우거나 취소하면 저장하지 않는다');
    });

    await run('그림 자리 넣기: 묻는 동안 다른 차시·탭으로 옮기면 넣지 않고, 탭 대신 다른 화면을 보고 있으면 묻지 않는다', async () => {
        const mod = { id: 1, title: '차시', tabContents: tabs(), images: {} };
        const ctx = apiContext(mod);
        ctx.promptAsync = async () => { vm.runInContext("currentLessonTab = 'basicPrac'", ctx); return 'cat'; };
        await ctx.insertImageSlot();
        ctx.promptAsync = async () => { ctx.currentEditingModuleId = 2; return 'cat'; };
        vm.runInContext("currentLessonTab = 'basicLearn'", ctx);
        await ctx.insertImageSlot();
        assert.deepStrictEqual(plain(mod.tabContents), plain(tabs()), '어느 탭에도 넣지 않는다');
        assert.strictEqual(ctx.saved, 0);
        assert.ok(ctx.toasts.every(([text, type]) => text.includes('다른 차시나 탭으로 옮겨') && type === 'warning'), JSON.stringify(ctx.toasts));
        ctx.currentEditingModuleId = 1;
        vm.runInContext("_lessonPanel = 'gyosuan'", ctx);
        let prompted = 0;
        ctx.promptAsync = async () => { prompted += 1; return 'cat'; };
        await ctx.insertImageSlot();
        assert.deepStrictEqual([prompted, ctx.alerts.length], [0, 1], '교수안 화면에서는 묻지 않고 알린다');
    });

    await run('그림 자리 넣기: 원문 칸을 열어 두었으면 그 칸의 커서 자리에 넣는다(그 차시·탭의 칸일 때만)', async () => {
        const mod = { id: 1, title: '차시', tabContents: tabs(), images: {} };
        const ctx = apiContext(mod);
        const raw = { ...fakeElement(), dataset: { moduleId: '1', tabId: 'basicLearn' }, focus() { this.focused = true; } };
        ctx.elements['raw-view'] = raw;
        const inserted = [];
        ctx.insertTextAtCursor = (target, text) => inserted.push([target, text]);
        ctx.promptAsync = async () => 'cat';
        await ctx.insertImageSlot();
        assert.deepStrictEqual([inserted.length, inserted[0][0], inserted[0][1], raw.focused], [1, raw, '\n<!-- [IMG: "cat"] -->\n', true]);
        assert.strictEqual(mod.tabContents.basicLearn, '기본 글', '탭 글은 원문 칸이 저장한다(state.js insertTextAtCursor)');
        raw.dataset = { moduleId: '9', tabId: 'basicLearn' };
        await ctx.insertImageSlot();
        assert.strictEqual(inserted.length, 1, '다른 차시를 그린 칸에는 넣지 않는다');
        assert.strictEqual(mod.tabContents.basicLearn, '기본 글\n<!-- [IMG: "cat"] -->\n', '그때는 탭 끝에 넣는다');
    });

    console.log('ALL PASSED');
})().catch(error => {
    console.error('FAIL', error.message, error.stack);
    process.exit(1);
});
