// 본문을 끌어 골라 GIF·판서 영상 만들기 테스트 (실행: node tests/selection-media.test.js)
// 실제 selection-media.js와 image-motion.js(새 그림으로 넣는 창)·whiteboard-link.js(스튜디오로 넘기기)·lesson-review.js(작업 기록에 남기고 반영)·
// lesson-format.js(고른 단락 찾기)·format-toolbar.js(Ctrl+Z)·cost-estimate.js(미리 보기)를 vm에서 돌린다.
// 화면은 domino(@mixmark-io/domino), 고른 범위는 흉내 낸 Selection으로 만들고, AI(callGemini)·그림 경로(extractSearchIntent·generateImageAPI)·캔버스는 바꿔 끼운다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

let domino = null;
let marked = null;
try {
    domino = require('@mixmark-io/domino');
    ({ marked } = require('marked'));
} catch (err) {
    console.log('FAIL - domino·marked가 없습니다. 먼저 실행: npm install --no-save marked@15.0.12 turndown@7.2.4');
}

const root = path.join(__dirname, '..', 'js');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const quiet = { log() {}, warn() {}, error() {} };
const sleep = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));
const flush = async (times = 3) => { for (let i = 0; i < times; i++) await sleep(); };
// 소스에서 함수 하나(시작 글부터 첫 '\n}\n'까지) 또는 정한 끝까지를 잘라 온다
function sliceSource(source, start, end = '\n}\n') {
    const at = source.indexOf(start);
    if (at < 0) throw new Error(`소스에서 찾지 못함: ${start}`);
    const stop = source.indexOf(end, at);
    if (stop < 0) throw new Error(`끝을 찾지 못함: ${start}`);
    return source.slice(at, stop + end.length);
}

const PNG = 'data:image/png;base64,QUFBQkJC';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACw=';
const PAGES = { protocol: 'https:', pathname: '/Teacher/', origin: 'https://rkdghkclgns-design.github.io' };
const HANDOFF_KEY = 'whiteboard-studio:handoff';
const RECT = { left: 200, top: 300, right: 500, bottom: 320, width: 300, height: 20 };
const REQUEST = '클라이언트가 서버에 요청을 보내면 서버가 응답을 돌려줍니다.';
const LOOP = '게임은 반복되는 행동의 묶음으로 굴러갑니다.';
const LESSON_MD = ['## 코어 루프', '', LOOP, '', REQUEST, '', '## 정리', '', '루프를 짧게 만듭니다.'].join('\n');
const INTENT_PROMPT = 'A flat diagram of a client computer and a server exchanging messages, symbolic icons only';
const PLAN = {
    title: '요청과 응답',
    groups: [{
        name: '요청과 응답', pattern: 'pairs', center: '', story: '클라이언트와 서버가 주고받습니다.',
        nodes: [{ id: 'c', label: '클라이언트', box: [300, 100, 500, 300] }, { id: 's', label: '서버', box: [300, 700, 500, 900] }],
        edges: [{ from: 'c', to: 's', dir: 'both', label: '요청·응답' }]
    }]
};
const aiReply = answer => ({ candidates: [{ content: { parts: [{ text: typeof answer === 'string' ? answer : JSON.stringify(answer) }] } }] });
const lesson = (extra = {}) => ({
    id: 7, title: '1차시: 개념 이해', images: {},
    tabContents: { basicLearn: LESSON_MD, assessment: '## 확인 문제\n\n1. 코어 루프란 무엇인가요?' }, ...extra
});

/* ---------- 화면(domino) ---------- */
// domino의 목록에는 forEach와 반복자가 없고 dataset도 없어 브라우저처럼 채운다(image-motion.test.js와 같다)
const toAttr = key => `data-${String(key).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
function iterableList(proto) {
    if (!proto.forEach) {
        Object.defineProperty(proto, 'forEach', { configurable: true, value(fn, self) { for (let i = 0; i < this.length; i++) fn.call(self, this.item(i), i, this); } });
    }
    if (!proto[Symbol.iterator]) {
        Object.defineProperty(proto, Symbol.iterator, { configurable: true, * value() { for (let i = 0; i < this.length; i++) yield this.item(i); } });
    }
}
function patchDomino(doc) {
    [doc.querySelectorAll('x'), doc.body.children, doc.createElement('div').querySelectorAll('x')].forEach(list => iterableList(Object.getPrototypeOf(list)));
    const htmlProto = Object.getPrototypeOf(Object.getPrototypeOf(doc.createElement('div')));
    if (!Object.getOwnPropertyDescriptor(htmlProto, 'dataset')) {
        Object.defineProperty(htmlProto, 'dataset', {
            configurable: true,
            get() {
                const el = this;
                return new Proxy({}, {
                    get: (t, key) => (typeof key === 'string' && el.hasAttribute(toAttr(key)) ? el.getAttribute(toAttr(key)) : undefined),
                    set: (t, key, value) => { el.setAttribute(toAttr(key), String(value)); return true; },
                    has: (t, key) => typeof key === 'string' && el.hasAttribute(toAttr(key)),
                    deleteProperty: (t, key) => { el.removeAttribute(toAttr(key)); return true; }
                });
            }
        });
    }
}

// 보기 화면: 그 탭의 저장된 글을 marked로 그린다(빈 탭은 안내만)
function drawView(ctx, mod) {
    const md = vm.runInContext('storedTabMarkdown', ctx)(mod, ctx.currentLessonTab);
    ctx.document.getElementById('render-view').innerHTML = md ? marked.parse(md) : '<div class="empty-tab"><p>아직 이 탭은 만들지 않았습니다. 탭 생성하기를 눌러 주세요.</p></div>';
}

// replies: 움직임을 읽는 AI 답(차례로). picture: 그림 모델이 돌려줄 그림(함수면 요청을 받아 돌려준다). answer: 비용 미리 보기 창의 답
function selectionContext(mod, { replies = [], keyOk = true, answer = true, picture = PNG } = {}) {
    const doc = domino.createDocument('<html><body><header id="lesson-head"><h2>1차시: 개념 이해</h2></header><div id="render-view" class="markdown-body"></div><textarea id="raw-view" class="hidden"></textarea></body></html>', true);
    patchDomino(doc);
    let clock = 1000;
    class FakeDate extends Date { static now() { return clock; } }
    const storage = {};
    const ctx = {
        console: quiet, document: doc, marked, Date: FakeDate, Promise, AbortController, Proxy, Blob, URL,
        setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 1)), clearTimeout,
        location: PAGES, innerWidth: 1280, innerHeight: 800,
        localStorage: { getItem: key => storage[key] ?? null, setItem: (key, value) => { storage[key] = String(value); }, removeItem: key => { delete storage[key]; } },
        LESSON_ACTIONS: {}, addEventListener() {}, LESSON_HISTORY_LIMIT: 20,
        storage, toasts: [], alerts: [], asked: [], archived: [], dialogs: [], opened: [], steps: [], calls: [], intents: [], pictures: [], renders: [],
        saves: 0, rendered: 0, replies: [...replies], selection: null, rect: null, panel: null,
        currentLessonTab: 'basicLearn', currentSubjectId: 's1', currentEditingModuleId: mod.id, currentMod: mod
    };
    ctx.window = ctx;
    ctx.globalState = { subjects: [{ id: 's1', title: '1. 게임 기획의 기초', lessons: [mod] }] };
    ctx.tick = (ms = 600) => { clock += ms; };
    ctx.getSelection = () => ctx.selection;
    ctx.getEditingModule = id => (id === undefined || String(id) === String(ctx.currentMod?.id) ? ctx.currentMod : null);
    ctx.isViewingTab = (m, tabId) => ctx.currentMod === m && ctx.currentLessonTab === tabId && !ctx.panel;
    ctx.saveState = async () => { ctx.saves += 1; return true; };
    ctx.archiveContent = async (item, reason) => { ctx.archived.push({ title: item.title, content: item.content, tabId: item.tabId, reason }); };
    ctx.renderEditor = m => { ctx.rendered += 1; drawView(ctx, m); };
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.confirmAsync = async (message, opts) => { ctx.asked.push({ message, opts }); return answer; };
    ctx.textModelHasKey = () => keyOk;
    ctx.DBManager = { getItem: async () => null, setItem: async () => {}, deleteItem: async () => {}, keys: async () => [] };
    ctx.callGemini = async (model, payload) => {
        ctx.steps.push('plan');
        ctx.calls.push(payload);
        const next = ctx.replies.shift();
        return typeof next === 'function' ? next(payload) : next;
    };
    // 앱의 그림 경로(api.js): 검색어·그림 요청 정하기(짧은 호출)와 그림 모델
    ctx.extractSearchIntent = async (keyword, context, signal) => {
        ctx.steps.push('intent');
        ctx.intents.push({ keyword, context, signal });
        return { search_query: 'client server request response', image_gen_prompt: INTENT_PROMPT, reasoning: '요청과 응답 흐름' };
    };
    ctx.generateImageAPI = async (prompt, opts = {}) => {
        ctx.steps.push('picture');
        ctx.pictures.push({ prompt, signal: opts.signal });
        return typeof picture === 'function' ? picture(prompt, opts) : picture;
    };
    vm.createContext(ctx);
    const ui = read('ui.js');
    vm.runInContext(sliceSource(ui, 'function escapeHtml('), ctx);
    vm.runInContext(sliceSource(ui, 'const APP_DIALOG_GRACE_MS', "window.addEventListener('keydown', onAppDialogKey, true);"), ctx);
    ['data.js', 'lesson-lint.js', 'lesson-opening.js', 'lesson-format.js', 'lesson-review.js', 'cost-estimate.js', 'whiteboard-link.js', 'whiteboard-video.js',
        'gif-encoder.js', 'image-motion-plan.js', 'image-motion.js', 'format-toolbar.js', 'selection-media.js'].forEach(file => vm.runInContext(read(file), ctx));
    const tabs = read('tabs.js');
    ['function legacyLessonBody(', 'function setTabMarkdown(', 'function setTabMarkdownKeyed(', 'function lessonImageRefTexts('].forEach(start => vm.runInContext(sliceSource(tabs, start), ctx));
    const api = read('api.js');
    ['function uniqueLessonImageId(', 'function imageWrapperHtml(', 'function imageSlotKeyword(', 'function withLessonImageStyle(', 'function textUsesImage(', 'function lessonStillUsesImage(']
        .forEach(start => vm.runInContext(sliceSource(api, start), ctx));
    vm.runInContext(sliceSource(api, 'const lessonViewCovered', '\n'), ctx);
    vm.runInContext('openWhiteboardTab = url => { window.opened.push(url); };', ctx); // 새 탭 열기만 적는다
    ctx.showWhiteboardDialog = (opts, onConfirm) => {
        ctx.dialogs.push(opts);
        onConfirm({ topic: opts.topic, markdown: opts.markdown });
    };
    ctx.imageMotionCanvas.inline = async () => ({ mimeType: 'image/png', data: 'QUFB' });
    ctx.imageMotionCanvas.render = async (source, plan, opts) => {
        ctx.steps.push('render');
        ctx.renders.push({ source, groups: plan.groups.map(group => group.name) });
        opts.onFrame?.(30, 30);
        return { dataUrl: GIF, bytes: 1536000, frames: 30, width: 800, height: 450, reduced: false, over: false };
    };
    drawView(ctx, mod);
    ctx.initSelectionMedia();
    return ctx;
}

/* ---------- 고르기·누르기 흉내 ---------- */
const viewOf = ctx => ctx.document.getElementById('render-view');
const blockAt = (ctx, index) => viewOf(ctx).children.item(index);
// 요소 안의 첫 글자 조각(빈칸뿐인 조각은 건너뛴다)
function textOf(el) {
    for (let node = el.firstChild; node; node = node.nextSibling) {
        if (node.nodeType === 3 && node.data.trim()) return node;
        const inner = node.nodeType === 1 ? textOf(node) : null;
        if (inner) return inner;
    }
    return null;
}
function fire(ctx, type, props = {}, target = ctx.document) {
    const event = ctx.document.createEvent('Event');
    event.initEvent(type, true, true);
    Object.assign(event, props);
    target.dispatchEvent(event);
    return event;
}
// 브라우저의 Selection처럼 고른다. anchor는 끌기 시작한 곳(기본은 시작 자리)
function choose(ctx, start, startOffset, end = start, endOffset = end.data.length, { anchor = start } = {}) {
    const range = {
        startContainer: start, startOffset, endContainer: end, endOffset,
        getBoundingClientRect: () => ctx.rect || RECT
    };
    const collapsed = start === end && startOffset === endOffset;
    ctx.selection = {
        rangeCount: 1, isCollapsed: collapsed, anchorNode: anchor, focusNode: anchor === start ? end : start,
        getRangeAt: () => range,
        removeAllRanges() { ctx.selection = { rangeCount: 0, isCollapsed: true, anchorNode: null, focusNode: null }; }
    };
    fire(ctx, 'selectionchange');
}
function clearChoice(ctx) {
    ctx.selection?.removeAllRanges();
    fire(ctx, 'selectionchange');
}
const menuOf = ctx => ctx.document.getElementById('selection-media-menu');
const menuShown = ctx => !!menuOf(ctx) && !menuOf(ctx).classList.contains('hidden');
const menuButton = (ctx, name) => menuOf(ctx)?.querySelector(`[data-selection-media="${name}"]`);
const shown = el => !!el && !el.classList.contains('hidden');
const dialogOf = ctx => [...ctx.document.body.children].find(el => el.querySelector?.('[data-motion-apply]')) || null;
const part = (overlay, name) => overlay.querySelector(`[data-motion-${name}]`);

// 두 번째 문단(REQUEST)을 다 골라 메뉴를 띄운다
async function chooseRequest(ctx) {
    const node = textOf(blockAt(ctx, 2));
    choose(ctx, node, 0, node, node.data.length);
    await sleep();
    return node;
}

// 두 번째 문단을 골라 GIF 만들기를 누르고 창이 GIF까지 만들기를 기다린다. 창의 막 뜬 시간은 넘긴다
async function makeGif(ctx) {
    await chooseRequest(ctx);
    menuButton(ctx, 'gif').click();
    await flush();
    ctx.tick();
    return dialogOf(ctx);
}

let failed = domino && marked ? 0 : 1;
let count = domino && marked ? 0 : 1;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

/* ======================= 메뉴: 보이기·숨기기 ======================= */
test('본문 안에서 끌어 고르면 잠깐 뒤 고른 글 아래 가운데에 GIF 만들기·판서 영상 만들기 메뉴가 뜬다', async () => {
    const ctx = selectionContext(lesson());
    const node = textOf(blockAt(ctx, 2));
    choose(ctx, node, 0, node, node.data.length);
    assert.ok(!menuShown(ctx), '고르는 사이에는 바로 띄우지 않는다');
    await sleep();
    assert.ok(menuShown(ctx));
    const buttons = [...menuOf(ctx).querySelectorAll('[data-selection-media]')].map(button => [button.getAttribute('data-selection-media'), button.textContent.trim()]);
    assert.deepStrictEqual(buttons, [['gif', 'GIF 만들기'], ['whiteboard', '판서 영상 만들기']]);
    assert.strictEqual(menuOf(ctx).getAttribute('role'), 'toolbar');
    assert.ok(menuOf(ctx).className.includes('fixed'), menuOf(ctx).className);
    assert.deepStrictEqual([menuOf(ctx).style.left, menuOf(ctx).style.top], ['350px', '328px'], '고른 글 가운데, 아래로 8px');
    const pick = ctx.readLessonSelection();
    assert.deepStrictEqual([pick.text, pick.heading, pick.tabId, pick.block.index], [REQUEST, '코어 루프', 'basicLearn', 2]);
    assert.strictEqual(pick.mod, ctx.currentMod);
});

test('마우스로 끄는 동안은 띄우지 않고 놓으면 띄운다. 메뉴를 눌러도 본문 선택이 풀리지 않고, 다른 곳을 누르면 숨긴다', async () => {
    const ctx = selectionContext(lesson());
    const node = textOf(blockAt(ctx, 2));
    fire(ctx, 'mousedown', { button: 0 }, blockAt(ctx, 2));
    choose(ctx, node, 0, node, 8);
    await sleep();
    assert.ok(!menuShown(ctx), '끄는 중');
    fire(ctx, 'mouseup', { button: 0 }, blockAt(ctx, 2));
    await sleep();
    assert.ok(menuShown(ctx), '놓으면 뜬다');
    const down = fire(ctx, 'mousedown', { button: 0 }, menuButton(ctx, 'gif'));
    assert.ok(down.defaultPrevented, '메뉴를 눌러도 고른 글이 풀리지 않게 막는다');
    assert.ok(menuShown(ctx));
    fire(ctx, 'mousedown', { button: 0 }, blockAt(ctx, 0));
    assert.ok(!menuShown(ctx), '다른 곳을 누르면 숨긴다');
});

test('본문 밖에서 시작한 선택, 버튼 글자만 고른 선택, 접힌 선택에는 띄우지 않는다. 본문에서 시작해 밖까지 끌면 본문 글만 쓴다', async () => {
    const wrapper = '<div class="image-wrapper"><img src="local:img_1" alt="루프 그림"><button class="image-regenerate-btn" data-lesson-action="regenerate-image" data-keyword="loop" data-img-id="img_1">다시 찾기</button><div class="image-caption">루프 그림 설명</div></div>';
    const md = ['## 코어 루프', '', LOOP, '', REQUEST, '', wrapper, '', '## 정리', '', '루프를 짧게 만듭니다.'].join('\n');
    const ctx = selectionContext(lesson({ tabContents: { basicLearn: md }, images: { img_1: PNG } }));
    const head = textOf(ctx.document.getElementById('lesson-head'));
    const request = textOf(blockAt(ctx, 2));
    choose(ctx, head, 0, request, 5);
    await sleep();
    assert.ok(!menuShown(ctx), '머리말에서 시작한 선택');
    const label = viewOf(ctx).querySelector('button').firstChild;
    choose(ctx, label, 0, label, label.data.length);
    await sleep();
    assert.ok(!menuShown(ctx), '버튼 글자만 골랐다');
    choose(ctx, request, 3, request, 3);
    await sleep();
    assert.ok(!menuShown(ctx), '접힌 선택');
    // 그림 칸을 지나 다음 제목까지 고르면 버튼 글자는 빼고 그림 설명은 둔다. 그림은 고른 글이 끝나는 블록 뒤에 넣는다
    const tidy = textOf(blockAt(ctx, 4));
    choose(ctx, request, 0, tidy, 2);
    await sleep();
    assert.ok(menuShown(ctx));
    const pick = ctx.readLessonSelection();
    assert.strictEqual(pick.text, `${REQUEST}\n\n루프 그림 설명\n\n정리`);
    assert.strictEqual(pick.block.index, 4);
    // 본문 끝을 넘어 끌면(끝이 본문 밖) 본문 안의 글만 쓴다
    const body = ctx.document.body;
    choose(ctx, request, 0, body, body.childNodes.length);
    await sleep();
    assert.ok(menuShown(ctx));
    assert.ok(ctx.readLessonSelection().text.endsWith('정리\n\n루프를 짧게 만듭니다.'), ctx.readLessonSelection().text);
});

test('고른 글의 모양: 목록 항목·표 줄·줄바꿈은 줄을 나누고 표 칸 사이는 띄우며, 코드 블록은 들여쓰기와 안의 빈 줄을 둔다', async () => {
    const md = ['## 반복', '', '첫 줄  ', '둘째 줄', '', '- 입력을 읽는다', '- 상태를 바꾼다', '', '| 단계 | 하는 일 |', '| --- | --- |', '| 1 | 입력 |', '',
        '```python', 'while running:', '    update()', '', '    draw()', '```'].join('\n');
    const ctx = selectionContext(lesson({ tabContents: { basicLearn: md } }));
    const code = blockAt(ctx, 4);
    assert.strictEqual(code.tagName, 'PRE');
    choose(ctx, textOf(blockAt(ctx, 1)), 0, code, code.childNodes.length);
    await sleep();
    assert.ok(menuShown(ctx));
    assert.strictEqual(ctx.readLessonSelection().text, ['첫 줄\n둘째 줄', '입력을 읽는다\n상태를 바꾼다', '단계 하는 일\n1 입력', 'while running:\n    update()\n\n    draw()'].join('\n\n'));
    assert.strictEqual(ctx.readLessonSelection().heading, '반복');
});

test('선택을 풀거나 Esc를 누르거나 고른 글이 화면 밖으로 멀리 가면 숨긴다. 굴리는 동안은 따라가고, Esc 뒤에는 다시 고를 때 뜬다', async () => {
    const ctx = selectionContext(lesson());
    const node = textOf(blockAt(ctx, 2));
    choose(ctx, node, 0, node, 10);
    await sleep();
    assert.ok(menuShown(ctx));
    fire(ctx, 'keydown', { key: 'Escape' });
    assert.ok(!menuShown(ctx), 'Esc');
    await sleep();
    assert.ok(!menuShown(ctx), 'Esc 뒤에는 그대로 숨긴다');
    choose(ctx, node, 0, node, 12);
    await sleep();
    assert.ok(menuShown(ctx), '다시 고르면 뜬다');
    ctx.rect = { ...RECT, top: 120, bottom: 140 };
    fire(ctx, 'scroll');
    assert.ok(menuShown(ctx));
    assert.strictEqual(menuOf(ctx).style.top, '148px', '굴리면 고른 글을 따라간다');
    ctx.rect = { ...RECT, top: -420, bottom: -400 };
    fire(ctx, 'scroll');
    assert.ok(!menuShown(ctx), '고른 글이 화면 위로 멀리 갔다');
    ctx.rect = null;
    choose(ctx, node, 0, node, 12);
    await sleep();
    assert.ok(menuShown(ctx));
    clearChoice(ctx);
    assert.ok(!menuShown(ctx), '선택을 풀면 바로 숨긴다');
});

test('원문 전체 수정 중·단락을 고치는 중·교수안이 가린 화면·슬라이드 같은 다른 항목·빈 탭에서는 띄우지 않는다', async () => {
    const ctx = selectionContext(lesson());
    const raw = ctx.document.getElementById('raw-view');
    const view = viewOf(ctx);
    const check = async (label, setup, undo) => {
        setup();
        const node = textOf(blockAt(ctx, 2));
        choose(ctx, node, 0, node, 10);
        await sleep();
        assert.ok(!menuShown(ctx), label);
        assert.strictEqual(ctx.readLessonSelection(), null, label);
        undo();
    };
    await check('원문 전체 수정', () => { raw.classList.remove('hidden'); view.classList.add('hidden'); }, () => { raw.classList.add('hidden'); view.classList.remove('hidden'); });
    const editor = ctx.document.createElement('div');
    editor.className = 'para-edit';
    editor.innerHTML = '<textarea></textarea>';
    await check('단락 고치는 중', () => view.appendChild(editor), () => editor.remove());
    await check('교수안이 가림', () => view.classList.add('gyosuan-covered'), () => view.classList.remove('gyosuan-covered'));
    await check('슬라이드 항목', () => { ctx.panel = 'slides'; }, () => { ctx.panel = null; });
    // 아직 만들지 않은 탭의 안내 글
    ctx.currentLessonTab = 'advLearn';
    drawView(ctx, ctx.currentMod);
    const hint = textOf(blockAt(ctx, 0));
    choose(ctx, hint, 0, hint, 10);
    await sleep();
    assert.ok(!menuShown(ctx), '빈 탭');
    // 다시 보통 화면
    ctx.currentLessonTab = 'basicLearn';
    drawView(ctx, ctx.currentMod);
    await chooseRequest(ctx);
    assert.ok(menuShown(ctx));
});

test('학습이해도(문제은행) 탭에서는 그림을 넣지 않아 GIF 만들기를 감추고 판서 영상 만들기만 보인다', async () => {
    const ctx = selectionContext(lesson());
    ctx.currentLessonTab = 'assessment';
    drawView(ctx, ctx.currentMod);
    const node = textOf(blockAt(ctx, 1));
    choose(ctx, node, 0, node, node.data.length);
    await sleep();
    assert.ok(menuShown(ctx));
    assert.deepStrictEqual([shown(menuButton(ctx, 'gif')), shown(menuButton(ctx, 'whiteboard'))], [false, true]);
    await ctx.makeSelectionGif(ctx.readLessonSelection());
    assert.ok(/그림을 넣지 않습니다/.test(ctx.alerts.at(-1)), ctx.alerts.at(-1));
    assert.deepStrictEqual([ctx.asked.length, ctx.pictures.length], [0, 0]);
    // 다른 탭으로 돌아오면 다시 보인다
    ctx.currentLessonTab = 'basicLearn';
    drawView(ctx, ctx.currentMod);
    await chooseRequest(ctx);
    assert.ok(shown(menuButton(ctx, 'gif')));
});

test('메뉴 자리: 아래에 자리가 없으면 고른 글 위로, 서식 막대가 고른 글 아래에 떴으면 그 아래로, 화면 양옆을 넘지 않게', () => {
    const ctx = selectionContext(lesson());
    const size = { width: 260, height: 36 };
    const viewport = { width: 1280, height: 800 };
    const at = (rect, bar = null) => plain(ctx.selectionMenuPosition(rect, bar, size, viewport));
    assert.deepStrictEqual(at(RECT), { left: 350, top: 328 });
    assert.deepStrictEqual(at({ ...RECT, top: 760, bottom: 780 }), { left: 350, top: 716 }, '아래가 모자라면 고른 글 위');
    assert.deepStrictEqual(at(RECT, { left: 100, right: 600, top: 328, bottom: 370, width: 500, height: 42 }), { left: 350, top: 378 }, '서식 막대 아래');
    assert.deepStrictEqual(at({ ...RECT, top: 760, bottom: 780 }, { left: 100, right: 600, top: 710, bottom: 752, width: 500, height: 42 }), { left: 350, top: 666 }, '서식 막대가 위에 있으면 그 위');
    assert.deepStrictEqual(at({ ...RECT, left: 0, right: 40, width: 40 }), { left: 138, top: 328 }, '왼쪽 끝');
    assert.deepStrictEqual(at({ ...RECT, left: 1250, right: 1280, width: 30 }), { left: 1142, top: 328 }, '오른쪽 끝');
});

/* ======================= 판서 영상 만들기 ======================= */
test('판서 영상 만들기: 고른 글과 그 글이 든 절의 제목만 스튜디오로 넘긴다(넘기기 약속 그대로, 돌려받을 그림 자리는 없다)', async () => {
    const ctx = selectionContext(lesson());
    await chooseRequest(ctx);
    menuButton(ctx, 'whiteboard').click();
    await flush();
    assert.ok(!menuShown(ctx), '누르면 메뉴를 닫는다');
    assert.strictEqual(ctx.selection.rangeCount, 0, '본문 선택도 푼다(서식 막대가 창 위에 남지 않게)');
    assert.strictEqual(ctx.dialogs.length, 1, '판서 영상 만들기 창에서 고쳐 쓸 수 있다');
    assert.deepStrictEqual([ctx.dialogs[0].topic, ctx.dialogs[0].markdown], ['코어 루프', `# 코어 루프\n\n${REQUEST}`]);
    assert.ok(ctx.dialogs[0].subtitle.includes('고른 글'), ctx.dialogs[0].subtitle);
    const stored = JSON.parse(ctx.storage[HANDOFF_KEY]);
    assert.deepStrictEqual(Object.keys(stored).sort(), ['audience', 'createdAt', 'fileName', 'from', 'markdown', 'topic', 'v']);
    assert.deepStrictEqual([stored.v, stored.from, stored.topic, stored.audience, stored.fileName, stored.markdown],
        [1, 'teacher', '코어 루프', '대학생·성인', '게임 기획의 기초 1차시 개념 이해 코어 루프.md', `# 코어 루프\n\n${REQUEST}`]);
    assert.deepStrictEqual(ctx.opened, ['https://rkdghkclgns-design.github.io/whiteboard-studio-web/#from=teacher']);
    assert.ok(/스튜디오로 넘겼습니다/.test(ctx.toasts.at(-1)[0]));
    assert.deepStrictEqual([ctx.calls.length, ctx.pictures.length, ctx.asked.length], [0, 0, 0], 'Teacher에서는 AI를 부르지 않는다');
    assert.strictEqual(ctx.currentMod.tabContents.basicLearn, LESSON_MD, '교안 글은 그대로');
});

test('판서 영상 만들기: 여러 단락은 빈 줄로 나눠 넘기고, 제목부터 고르면 제목은 주제로만 한 번 쓴다. 제목이 없으면 차시 제목을 주제로 쓴다', async () => {
    const ctx = selectionContext(lesson());
    choose(ctx, textOf(blockAt(ctx, 0)), 0, textOf(blockAt(ctx, 2)), 6);
    await sleep();
    menuButton(ctx, 'whiteboard').click();
    await flush();
    assert.deepStrictEqual([ctx.dialogs[0].topic, ctx.dialogs[0].markdown], ['코어 루프', `# 코어 루프\n\n${LOOP}\n\n클라이언트가`]);
    const flat = selectionContext(lesson({ tabContents: { basicLearn: `${LOOP}\n\n${REQUEST}` } }));
    const node = textOf(blockAt(flat, 1));
    choose(flat, node, 0, node, node.data.length);
    await sleep();
    menuButton(flat, 'whiteboard').click();
    await flush();
    assert.deepStrictEqual([flat.dialogs[0].topic, flat.dialogs[0].markdown], ['개념 이해', `# 개념 이해\n\n${REQUEST}`]);
    // 창을 취소하면 넘기지 않는다
    const cancel = selectionContext(lesson());
    cancel.showWhiteboardDialog = opts => cancel.dialogs.push(opts);
    await chooseRequest(cancel);
    menuButton(cancel, 'whiteboard').click();
    await flush();
    assert.deepStrictEqual([cancel.dialogs.length, cancel.storage[HANDOFF_KEY], cancel.opened.length], [1, undefined, 0]);
});

/* ======================= GIF 만들기 ======================= */
test('GIF 만들기: 먼저 비용·시간 미리 보기(그림 1장, AI 호출 2번)를 보이고, 취소하면 그림·AI를 부르지 않고 아무것도 바꾸지 않는다', async () => {
    const ctx = selectionContext(lesson(), { answer: false });
    await chooseRequest(ctx);
    menuButton(ctx, 'gif').click();
    await flush();
    assert.ok(!menuShown(ctx));
    assert.strictEqual(ctx.asked.length, 1);
    const { message, opts } = ctx.asked[0];
    assert.ok(message.includes('그림: 1장') && message.includes('AI 호출 약 2회') && message.includes('걸리는 시간'), message);
    assert.ok(message.includes('단락 바로 아래') && message.includes('작업 기록'), message);
    assert.deepStrictEqual([opts.title, opts.tone], ['GIF 만들기', 'primary']);
    assert.deepStrictEqual([ctx.intents.length, ctx.pictures.length, ctx.calls.length, ctx.renders.length], [0, 0, 0, 0]);
    assert.strictEqual(dialogOf(ctx), null, '창을 열지 않는다');
    assert.deepStrictEqual([ctx.currentMod.tabContents.basicLearn, plain(ctx.currentMod.images), ctx.saves, ctx.archived.length], [LESSON_MD, {}, 0, 0]);
    // 키가 없으면 묻지도 않는다
    const noKey = selectionContext(lesson(), { keyOk: false });
    await chooseRequest(noKey);
    menuButton(noKey, 'gif').click();
    await flush();
    assert.deepStrictEqual([noKey.asked.length, noKey.pictures.length], [0, 0]);
    assert.ok(/키가 없어/.test(noKey.alerts.at(-1)), noKey.alerts.at(-1));
});

test('GIF 만들기: 고른 글로 앱의 그림 경로(검색어·그림 요청 정하기 → 그림 모델)를 부른 뒤, 그린 그림과 고른 글로 움직임을 읽어 GIF를 미리 보인다(넣기 전에는 글을 바꾸지 않는다)', async () => {
    const ctx = selectionContext(lesson(), { replies: [aiReply(PLAN)] });
    const overlay = await makeGif(ctx);
    assert.ok(overlay, '움직이는 GIF 창이 뜬다');
    assert.deepStrictEqual(ctx.steps, ['intent', 'picture', 'plan', 'render'], '그림을 그린 뒤 움직임을 읽고 GIF를 만든다');
    assert.strictEqual(ctx.intents[0].keyword, REQUEST);
    assert.ok(ctx.intents[0].context.includes('코어 루프') && ctx.intents[0].context.includes(REQUEST), ctx.intents[0].context);
    const prompt = ctx.pictures[0].prompt;
    const style = vm.runInContext('LESSON_IMAGE_STYLE', ctx);
    assert.ok(prompt.startsWith(INTENT_PROMPT) && /no text/i.test(prompt) && /arrows/i.test(prompt) && prompt.includes(style), prompt);
    assert.ok(ctx.intents[0].signal && ctx.pictures[0].signal && typeof ctx.pictures[0].signal.aborted === 'boolean', '중지 신호를 넘긴다');
    const payload = ctx.calls[0];
    assert.deepStrictEqual(plain(payload.contents[0].parts[1]), { inlineData: { mimeType: 'image/png', data: 'QUFB' } });
    assert.ok(payload.contents[0].parts[0].text.includes(REQUEST), '고른 글을 움직임 요청으로 보낸다');
    assert.strictEqual(part(overlay, 'instruction').value, REQUEST, '움직임 요청 칸에 고른 글을 넣어 둔다');
    assert.deepStrictEqual(plain(ctx.renders), [{ source: PNG, groups: ['요청과 응답'] }], '그린 그림으로 GIF를 만든다');
    assert.strictEqual(part(overlay, 'preview').getAttribute('src'), GIF);
    assert.ok(overlay.querySelector('[data-app-dialog-text]').textContent.includes('단락 바로 아래'));
    assert.deepStrictEqual([shown(part(overlay, 'apply')), shown(part(overlay, 'still')), shown(part(overlay, 'reread')), shown(part(overlay, 'start'))], [true, true, true, false]);
    assert.deepStrictEqual([part(overlay, 'apply').textContent.trim(), part(overlay, 'still').textContent.trim()], ['본문에 넣기', '그림만 넣기']);
    assert.deepStrictEqual([ctx.currentMod.tabContents.basicLearn, plain(ctx.currentMod.images), ctx.saves], [LESSON_MD, {}, 0], '넣기 전에는 바꾸지 않는다');
    overlay.click(); // 바깥을 눌러도 그린 그림을 잃지 않게 닫지 않는다
    assert.ok(overlay.isConnected);
});

test('본문에 넣기: 고른 글이 든 단락 바로 아래에 새 그림 칸(GIF 자리, 원래 그림은 따로 간직)을 넣고, 넣기 전 글은 작업 기록에 남아 Ctrl+Z로도 되돌린다', async () => {
    const ctx = selectionContext(lesson(), { replies: [aiReply(PLAN)] });
    const mod = ctx.currentMod;
    const overlay = await makeGif(ctx);
    part(overlay, 'apply').click();
    await flush();
    const imgId = Object.keys(mod.images).find(key => mod.images[key] === GIF);
    assert.ok(imgId, 'GIF를 새 그림 키에 넣는다');
    const record = mod.imageMotions[imgId];
    assert.strictEqual(mod.images[record.still], PNG, '그린 그림은 원래 그림으로 간직한다(원래 그림으로 되돌릴 수 있다)');
    assert.deepStrictEqual([plain(record.patterns), record.summary], [['pairs'], '요청과 응답: 짝 주고받기']);
    const wrapper = ctx.imageWrapperHtml(imgId, REQUEST, REQUEST, REQUEST);
    assert.strictEqual(mod.tabContents.basicLearn, ['## 코어 루프', '', LOOP, '', REQUEST, '', wrapper, '', '## 정리', '', '루프를 짧게 만듭니다.'].join('\n'));
    assert.ok(wrapper.includes('data-lesson-action="regenerate-image"') && wrapper.includes(`data-keyword="${REQUEST}"`), '다시 찾기 검색어는 고른 글');
    assert.deepStrictEqual(ctx.archived, [{ title: '1차시: 개념 이해 · 기본학습', content: LESSON_MD, tabId: 'basicLearn', reason: '그림 넣기 전' }], '넣기 전 글을 작업 기록에 남긴다');
    assert.ok(mod.history[0].note.includes('움직이는 GIF'), mod.history[0].note);
    assert.ok(!overlay.isConnected, '넣으면 창을 닫는다');
    assert.ok(ctx.saves >= 1 && ctx.rendered >= 1);
    assert.ok(viewOf(ctx).innerHTML.includes(`local:${imgId}`), '다시 그린 화면에 새 그림');
    assert.deepStrictEqual(ctx.toasts.at(-1), ['고른 글이 든 단락 아래에 움직이는 GIF를 넣었습니다. Ctrl+Z나 작업 기록에서 되돌릴 수 있습니다.', 'success']);
    // Ctrl+Z(format-toolbar.js)로 넣기 전 글로 되돌린다
    vm.runInContext('formatUndo', ctx)({ preventDefault() {} });
    await flush();
    assert.strictEqual(mod.tabContents.basicLearn, LESSON_MD);
    assert.deepStrictEqual(ctx.toasts.at(-1), ['되돌렸습니다.', 'success']);
});

test('그림만 넣기: 움직임을 읽지 못해도 그린 그림만 단락 아래에 넣는다(움직이는 GIF 기록 없이)', async () => {
    const ctx = selectionContext(lesson(), { replies: [aiReply('{"groups":[]}')] });
    const mod = ctx.currentMod;
    const overlay = await makeGif(ctx);
    assert.ok(part(overlay, 'status').textContent.includes('이어진 요소를 찾지 못했습니다'), part(overlay, 'status').textContent);
    assert.deepStrictEqual([shown(part(overlay, 'apply')), shown(part(overlay, 'still')), shown(part(overlay, 'start'))], [false, true, true], '요청을 고쳐 다시 읽거나 그림만 넣는다');
    part(overlay, 'still').click();
    await flush();
    const imgId = Object.keys(mod.images).find(key => mod.images[key] === PNG);
    assert.ok(imgId);
    assert.strictEqual(Object.keys(mod.images).length, 1);
    assert.ok(!mod.imageMotions || !Object.keys(mod.imageMotions).length, '움직이는 GIF 기록은 없다');
    assert.ok(mod.tabContents.basicLearn.includes(`${REQUEST}\n\n${ctx.imageWrapperHtml(imgId, REQUEST, REQUEST, REQUEST)}\n\n## 정리`));
    assert.strictEqual(ctx.archived.length, 1);
    assert.ok(mod.history[0].note.includes('그림 넣기'), mod.history[0].note);
    assert.ok(!overlay.isConnected);
    assert.deepStrictEqual(ctx.toasts.at(-1), ['고른 글이 든 단락 아래에 그림을 넣었습니다. Ctrl+Z나 작업 기록에서 되돌릴 수 있습니다.', 'success']);
});

test('그리는 동안: 안내만 보이고 버튼은 막으며, 취소하면 그림 호출을 끊는다. 그리지 못하면 창에 알리고 움직임을 읽지 않는다', async () => {
    let release;
    let signal = null;
    const ctx = selectionContext(lesson(), {
        picture: (prompt, opts) => new Promise((resolve, reject) => {
            signal = opts.signal;
            release = resolve;
            opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('중지했습니다.'), { name: 'AbortError' })));
        })
    });
    const overlay = await makeGif(ctx);
    assert.ok(part(overlay, 'status').textContent.includes('그림을 그리고 있습니다'), part(overlay, 'status').textContent);
    assert.ok(part(overlay, 'frame').classList.contains('hidden'), '그림이 나오기 전에는 미리 보기 칸을 감춘다');
    assert.deepStrictEqual([shown(part(overlay, 'start')), shown(part(overlay, 'still')), shown(part(overlay, 'apply'))], [false, false, false]);
    part(overlay, 'cancel').click();
    await flush();
    assert.deepStrictEqual([signal.aborted, overlay.isConnected, ctx.calls.length], [true, false, 0]);
    assert.ok(typeof release === 'function');

    const broken = selectionContext(lesson(), { picture: null });
    const overlay2 = await makeGif(broken);
    assert.ok(part(overlay2, 'status').textContent.includes('그림을 그리지 못했습니다'), part(overlay2, 'status').textContent);
    assert.deepStrictEqual([shown(part(overlay2, 'start')), shown(part(overlay2, 'still')), shown(part(overlay2, 'apply'))], [false, false, false]);
    assert.deepStrictEqual([broken.calls.length, broken.renders.length, broken.saves], [0, 0, 0]);
    assert.strictEqual(broken.currentMod.tabContents.basicLearn, LESSON_MD);
});

test('넣을 때: 그사이 탭을 옮겼으면 넣지 않고, 고른 단락이 원문에서 사라졌으면 탭 끝에 넣고 알린다', async () => {
    const ctx = selectionContext(lesson(), { replies: [aiReply(PLAN)] });
    const overlay = await makeGif(ctx);
    ctx.currentLessonTab = 'basicPrac';
    part(overlay, 'apply').click();
    await flush();
    assert.ok(part(overlay, 'status').textContent.includes('다른 차시나 탭으로 옮겨'), part(overlay, 'status').textContent);
    assert.deepStrictEqual([ctx.currentMod.tabContents.basicLearn, plain(ctx.currentMod.images), ctx.archived.length], [LESSON_MD, {}, 0]);

    const moved = selectionContext(lesson(), { replies: [aiReply(PLAN)] });
    const mod = moved.currentMod;
    const overlay2 = await makeGif(moved);
    const changed = '## 다른 글\n\n완전히 다른 내용입니다.';
    mod.tabContents = { ...mod.tabContents, basicLearn: changed };
    part(overlay2, 'apply').click();
    await flush();
    const imgId = Object.keys(mod.images).find(key => mod.images[key] === GIF);
    assert.strictEqual(mod.tabContents.basicLearn, `${changed}\n\n${moved.imageWrapperHtml(imgId, REQUEST, REQUEST, REQUEST)}\n`);
    assert.strictEqual(moved.archived[0].content, changed, '넣기 직전 글을 남긴다');
    assert.deepStrictEqual(moved.toasts.at(-1), ['고른 단락을 원문에서 찾지 못해 탭 끝에 넣었습니다. 원하는 자리로 옮겨 주세요. Ctrl+Z나 작업 기록에서 되돌릴 수 있습니다.', 'warning']);
});

(async () => {
    if (domino && marked) {
        for (const { name, fn } of pending) {
            count++;
            try {
                await fn();
                console.log(`ok - ${name}`);
            } catch (e) {
                failed++;
                console.log(`FAIL - ${name}\n  ${e.stack || e.message}`);
            }
        }
    }
    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
