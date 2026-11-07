// 그림 → 움직이는 GIF 테스트 (실행: node tests/image-motion.test.js)
// 실제 image-motion-plan.js·image-motion.js·gif-encoder.js와 함께 고친 api.js(그림 지우기)·tabs.js(그림 정리)·data-safety.js(검사·작업 기록)·
// whiteboard-video.js(그림 버튼)를 vm에서 돌린다. AI(callGemini)와 캔버스 그리기(imageMotionCanvas)는 바꿔 끼우고,
// 보기 화면과 창은 domino(@mixmark-io/domino, output-import.test.js와 같은 꾸러미)로 흉내 낸다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

let domino = null;
try {
    domino = require('@mixmark-io/domino');
} catch (err) {
    console.log('FAIL - domino가 없습니다. 먼저 실행: npm install --no-save marked@15.0.12 turndown@7.2.4');
}

const root = path.join(__dirname, '..', 'js');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const quiet = { log() {}, warn() {}, error() {} };
const flush = async (times = 6) => { for (let i = 0; i < times; i++) await new Promise(resolve => setImmediate(resolve)); };
// 소스에서 함수 하나(시작 글부터 첫 '\n}\n'까지) 또는 정한 끝까지를 잘라 온다
function sliceSource(source, start, end = '\n}\n') {
    const at = source.indexOf(start);
    if (at < 0) throw new Error(`소스에서 찾지 못함: ${start}`);
    const stop = source.indexOf(end, at);
    if (stop < 0) throw new Error(`끝을 찾지 못함: ${start}`);
    return source.slice(at, stop + end.length);
}

const PNG = 'data:image/png;base64,QUFBQkJC';
const PNG_B = 'data:image/png;base64,Q0NDRERE';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACw=';
const GIF_B = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yw=';
const LONG_GIF = `data:image/gif;base64,R0lGODlh${'Q'.repeat(96)}`; // 백업이 그림 파일로 떼는 길이(64자 이상)
const LONG_PNG = `data:image/png;base64,iVBORw0K${'R'.repeat(96)}`;

/* ---------- 첨부 그림(서버 모델과 P2P 구조)을 AI가 읽은 답과 같은 모양 ---------- */
const SERVER_BOXES = [[95, 212, 217, 298], [204, 349, 324, 433], [450, 395, 569, 476], [702, 349, 823, 430], [802, 214, 923, 288], [702, 78, 820, 151], [450, 30, 569, 104], [204, 68, 327, 153]];
const PEER_BOXES = [[97, 715, 217, 789], [204, 856, 323, 930], [450, 899, 572, 978], [702, 857, 823, 936], [802, 715, 923, 789], [702, 580, 820, 654], [450, 527, 569, 600], [204, 574, 323, 649]];
function sampleAnswer() {
    const peers = PEER_BOXES.map((box, i) => ({ id: `p${i + 1}`, label: `피어 ${i + 1}`, box }));
    const peerEdges = [];
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) peerEdges.push({ from: `p${i + 1}`, to: `p${j + 1}`, dir: 'both', label: '' });
    return {
        title: '서버 모델과 P2P 구조',
        groups: [
            {
                name: '서버 모델', pattern: 'hub', center: 'srv', story: '모든 클라이언트가 가운데 서버에 요청을 보내고 서버가 응답합니다.',
                nodes: [{ id: 'srv', label: '서버', box: [366, 205, 634, 296] }, ...SERVER_BOXES.map((box, i) => ({ id: `c${i + 1}`, label: `클라이언트 ${i + 1}`, box }))],
                edges: SERVER_BOXES.map((box, i) => ({ from: `c${i + 1}`, to: 'srv', dir: 'both', label: '요청·응답' }))
            },
            { name: 'P2P 구조', pattern: 'mesh', center: '', story: '모든 컴퓨터가 가운데 없이 서로 직접 연결되어 주고받습니다.', nodes: peers, edges: peerEdges }
        ]
    };
}
const aiReply = answer => ({ candidates: [{ content: { parts: [{ text: typeof answer === 'string' ? answer : JSON.stringify(answer) }] } }] });

// 묶음 만들기: node(id, x, y)는 60×60 상자, edges는 [from, to, dir]
const node = (id, x, y) => ({ id, label: id, box: [y, x, y + 60, x + 60] });
const groupOf = (nodes, edges, extra = {}) => ({ name: '묶음', nodes, edges: edges.map(([from, to, dir = 'both']) => ({ from, to, dir, label: '' })), ...extra });

/* ---------- 실행 환경 ---------- */
// 계산만(image-motion-plan.js)
function planContext() {
    const ctx = { console: quiet, Math, JSON };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(read('image-motion-plan.js'), ctx);
    return ctx;
}
const P = planContext();
// vm 안에서 만든 객체는 프로토타입이 달라 견주기 전에 바깥 값으로 바꾼다
const sanitize = raw => {
    const plan = P.sanitizeMotionPlan(raw);
    return plan && plain(plan);
};

// 그림 지우기·정리(api.js·tabs.js, review-flow.test.js와 같은 파일)와 GIF 바꾸기·되돌리기
const API_FILES = ['data.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js', 'gif-encoder.js', 'image-motion-plan.js', 'image-motion.js'];
function fakeElement() {
    return {
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', disabled: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener() {}, querySelector: () => fakeElement(), querySelectorAll: () => [], remove() {}
    };
}
function apiContext(mod, { answer = true } = {}) {
    const ctx = {
        console: quiet, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1)), clearTimeout, Promise, URL, Uint16Array, Blob,
        localStorage: { getItem: () => null, setItem() {} },
        currentEditingModuleId: mod.id,
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''),
        saved: 0, rendered: 0, toasts: [], asked: [], written: [],
        saveState: async () => { ctx.saved += 1; return true; },
        renderSidebar() {}, showLessonView() {}, lessonDesignBrief: () => '', lessonGenBrief: () => '', archiveContent: async () => {},
        document: { readyState: 'complete', body: { appendChild() {} }, createElement: fakeElement, getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    API_FILES.forEach(file => vm.runInContext(read(file), ctx));
    ctx.currentMod = mod;
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    ctx.showAlert = message => ctx.toasts.push([message, 'alert']);
    ctx.confirmAsync = async (message, opts) => { ctx.asked.push({ message, opts }); return answer; };
    ctx.writeLessonTab = async (m, tab, md) => {
        vm.runInContext('setTabMarkdown', ctx)(m, tab, md);
        ctx.written.push({ tab, md });
        return ctx.saveState();
    };
    vm.runInContext("getEditingModule = (id = window.currentMod?.id) => (String(id) === String(window.currentMod?.id) ? window.currentMod : null); renderEditor = () => { window.rendered += 1; }; currentLessonTab = 'basicLearn';", ctx);
    return ctx;
}
const call = (ctx, name) => vm.runInContext(name, ctx);

// 작업을 잃지 않게(data-safety.js)와 불러온 상태 검사(state.js sanitizeState), PC 폴더 저장(state.js YAML), 휴지통 사본(course-meta.js)
function safetyContext() {
    const ctx = { console: quiet, window: {}, JSON, Date, Map, Set, Promise, LESSON_TABS: ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment'].map(id => ({ id, label: id })) };
    vm.createContext(ctx);
    vm.runInContext(read('data-safety.js'), ctx);
    const state = read('state.js');
    ['function simpleYamlStringify(', 'function simpleYamlParse(', 'function generateUniqueId(', 'function sanitizeState('].forEach(start => vm.runInContext(sliceSource(state, start), ctx));
    vm.runInContext(sliceSource(read('tabs.js'), 'function setTabMarkdown('), ctx);
    vm.runInContext(sliceSource(read('course-meta.js'), 'const copyLessonTree', '\n\n'), ctx);
    return ctx;
}

// 보기 화면·창(domino). dataset과 select.value는 domino에 없어 data-* 속성과 option[selected]로 채운다(브라우저와 같게)
const toAttr = key => `data-${String(key).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
// domino의 목록(querySelectorAll·children)에는 forEach와 반복자가 없어 item(i)로 채운다
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
    const selectProto = Object.getPrototypeOf(doc.createElement('select'));
    if (!Object.getOwnPropertyDescriptor(selectProto, 'value')?.get?.call) {
        Object.defineProperty(selectProto, 'value', {
            configurable: true,
            get() {
                const options = Array.from(this.querySelectorAll('option'));
                const chosen = options.find(option => option.hasAttribute('selected')) || options[0];
                return chosen ? chosen.getAttribute('value') : '';
            },
            set(value) {
                Array.from(this.querySelectorAll('option')).forEach(option => {
                    if (option.getAttribute('value') === String(value)) option.setAttribute('selected', '');
                    else option.removeAttribute('selected');
                });
            }
        });
    }
}

// mod: 열어 둔 차시. replies: AI 답(차례로, 함수면 요청을 받아 답을 돌려준다). 창의 막 뜬 시간(APP_DIALOG_GRACE_MS)은 ctx.tick으로 넘긴다
function domContext(mod, { replies = [], keyOk = true } = {}) {
    const doc = domino.createDocument('<html><body><div id="render-view" class="markdown-body"></div></body></html>', true);
    patchDomino(doc);
    let clock = 1000;
    class FakeDate extends Date { static now() { return clock; } }
    const ctx = {
        console: quiet, document: doc, Date: FakeDate, Promise, AbortController, setTimeout, clearTimeout, Proxy, Blob, URL,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        LESSON_ACTIONS: {}, addEventListener() {},
        toasts: [], saves: 0, rendered: 0, calls: [], renders: [], replies: [...replies],
        currentLessonTab: 'basicLearn', currentMod: mod
    };
    ctx.window = ctx;
    ctx.tick = (ms = 600) => { clock += ms; };
    ctx.getEditingModule = () => ctx.currentMod;
    ctx.isViewingTab = (m, tabId) => ctx.currentMod === m && ctx.currentLessonTab === tabId;
    ctx.saveState = async () => { ctx.saves += 1; return true; };
    ctx.renderEditor = () => { ctx.rendered += 1; };
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    ctx.textModelHasKey = () => keyOk;
    ctx.DBManager = { getItem: async () => null, setItem: async () => {}, deleteItem: async () => {}, keys: async () => [] };
    ctx.callGemini = async (model, payload) => {
        ctx.calls.push(payload);
        const next = ctx.replies.shift();
        return typeof next === 'function' ? next(payload) : next;
    };
    vm.createContext(ctx);
    const ui = read('ui.js');
    vm.runInContext(sliceSource(ui, 'function escapeHtml('), ctx);
    vm.runInContext(sliceSource(ui, 'const APP_DIALOG_GRACE_MS', "window.addEventListener('keydown', onAppDialogKey, true);"), ctx);
    ['data.js', 'gif-encoder.js', 'image-motion-plan.js', 'whiteboard-video.js', 'image-motion.js'].forEach(file => vm.runInContext(read(file), ctx));
    // 원래 그림을 지워도 되는지 보는 실제 함수(api.js lessonStillUsesImage와 그 도우미)
    vm.runInContext(sliceSource(read('tabs.js'), 'function lessonImageRefTexts('), ctx);
    ['function textUsesImage(', 'function lessonStillUsesImage('].forEach(start => vm.runInContext(sliceSource(read('api.js'), start), ctx));
    ctx.imageMotionCanvas.inline = async () => ({ mimeType: 'image/png', data: 'QUFB' });
    ctx.imageMotionCanvas.render = async (source, plan, opts) => {
        ctx.renders.push({ source, groups: plan.groups.map(group => group.name), patterns: [...opts.patterns], delay: opts.delay });
        opts.onFrame?.(30, 30);
        return { dataUrl: GIF, bytes: 1536000, frames: 24, width: 800, height: 446, reduced: false, over: false };
    };
    return ctx;
}

// 창을 연다. 브라우저에서는 창 칸의 onclick="event.stopPropagation()"이 바깥 클릭으로 번지지 않게 막는다(domino는 인라인 처리기를 돌리지 않아 같은 일을 단다)
function openDialog(ctx, imgId) {
    ctx.openImageMotion(imgId);
    const overlay = [...ctx.document.body.children].find(el => el.querySelector?.('[data-motion-start]'));
    overlay?.querySelector('[data-app-dialog-panel]').addEventListener('click', event => event.stopPropagation());
    ctx.tick();
    return overlay;
}
const part = (overlay, name) => overlay.querySelector(`[data-motion-${name}]`);
const shown = el => !!el && !el.classList.contains('hidden');
function choose(ctx, select, value) {
    select.value = value;
    const event = ctx.document.createEvent('Event');
    event.initEvent('change', true, true);
    select.dispatchEvent(event);
}
const motionLesson = (extra = {}) => ({
    id: 7, title: '1차시', tabContents: { basicLearn: '## 구조\n\n![서버와 P2P](local:img_1)\n\n설명 글', basicPrac: '실습' }, images: { img_1: PNG }, ...extra
});

let failed = domino ? 0 : 1;
let count = domino ? 0 : 1;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

/* ======================= AI에 보낼 요청과 AI 답 검사 ======================= */
test('요청 글: 그려진 것만·꼭 맞는 상자(0~1000)·JSON만을 요구하고, 강사의 요청은 참고로 붙인다(꺾쇠는 빼고 300자까지)', () => {
    const prompt = P.buildMotionPrompt('서버가 요청을 받고 <b>응답</b>하는 흐름\n두 번째 줄');
    ['실제로 그려진 요소', '지어내지 않습니다', '꼭 맞게 감싸는 상자 [ymin, xmin, ymax, xmax]', '0~1000', 'JSON 하나만', '"groups"', '"pattern"', '"center"', '"dir"', 'hub', 'mesh', 'chain', 'cycle', 'tree', 'pairs']
        .forEach(text => assert.ok(prompt.includes(text), text));
    assert.ok(prompt.includes('[강사의 요청') && prompt.includes('서버가 요청을 받고') && prompt.includes('두 번째 줄'), prompt);
    assert.ok(!prompt.includes('<b>'), '요청의 꺾쇠는 뺀다');
    assert.ok(!P.buildMotionPrompt('').includes('강사의 요청'), '요청이 없으면 붙이지 않는다');
    const long = P.buildMotionPrompt('가'.repeat(500));
    assert.ok(long.includes('가'.repeat(300)) && !long.includes('가'.repeat(301)));
    assert.strictEqual(P.MOTION_SYSTEM, undefined, '시스템 지시는 창 객체에 내놓지 않아도 된다');
    assert.ok(vm.runInContext('MOTION_SYSTEM', P).includes('JSON'));
});

test('AI 답 검사: 첨부 그림(서버 모델과 P2P 구조)을 두 묶음으로 받는다', () => {
    const plan = sanitize(sampleAnswer());
    assert.strictEqual(plan.title, '서버 모델과 P2P 구조');
    assert.deepStrictEqual(plain(plan.groups.map(group => [group.name, group.pattern, group.center, group.nodes.length, group.edges.length])), [['서버 모델', 'hub', 'srv', 9, 8], ['P2P 구조', 'mesh', '', 8, 28]]);
    assert.deepStrictEqual(plain(plan.groups[0].nodes[0]), { id: 'srv', label: '서버', box: [366, 205, 634, 296] });
});

test('AI 답 검사: 상자(숫자 글·뒤바뀜·범위 밖·너무 작음·모양 틀림), 모르는 id·제 자신으로 가는 선, 겹친 id·연결 합치기, 꺾쇠가 든 글', () => {
    const plan = sanitize({ groups: [{
        name: '<b>묶음</b>',
        story: '<script>alert(1)</script> 오가는 흐름',
        nodes: [
            { id: 'a', label: 'A', box: ['100', '50', '300', '250'] },
            { id: 'b', box: [500, 900, 400, 700] },
            { id: 'c', box: [-50, 990, 2000, 1200] },
            { id: 'd', box: [300, 300, 302, 301] },
            { id: 'e', box: [1, 2, 3] },
            { id: 'f', box: [1, 2, 'x', 4] },
            { id: 'g', box: [NaN, 1, 2, 3] },
            { id: 'a', box: [0, 0, 100, 100] },
            { id: '', box: [0, 0, 10, 10] },
            { id: '<script>alert(1)</script>', label: '<img src=x onerror=alert(1)>', box: [600, 600, 700, 700] },
            { id: 'lonely', box: [10, 10, 90, 90] }
        ],
        edges: [
            { from: 'a', to: 'b' },
            { from: 'a', to: 'a' },
            { from: 'a', to: 'zzz' },
            { from: 'b', to: 'a', dir: 'forward' },
            { from: 'c', to: 'd', dir: 'forward' },
            { from: 'd', to: 'c', dir: 'forward' },
            { from: 'c', to: 'scriptalert1', dir: 'none' },
            { from: 'scriptalert1', to: 'c', dir: 'forward' },
            { from: 'a', to: 'd', dir: 'backward', label: '<b>뒤</b>' },
            { from: 'e', to: 'a' },
            'x', null
        ]
    }] });
    const group = plan.groups[0];
    assert.deepStrictEqual(plain(group.nodes.map(item => [item.id, item.box])), [
        ['a', [100, 50, 300, 250]], ['b', [400, 700, 500, 900]], ['c', [0, 990, 1000, 1000]], ['d', [297, 297, 305, 305]], ['scriptalert1', [600, 600, 700, 700]]
    ], '바른 상자만, 고쳐서. 연결이 없는 요소(lonely)는 뺀다');
    assert.deepStrictEqual(plain(group.edges.map(edge => [edge.from, edge.to, edge.dir])), [['a', 'b', 'both'], ['c', 'd', 'both'], ['scriptalert1', 'c', 'forward'], ['d', 'a', 'forward']]);
    const texts = JSON.stringify(plan);
    assert.ok(!/[<>]/.test(texts), `꺾쇠가 남지 않는다: ${texts}`);
    assert.strictEqual(group.nodes[4].label, 'img src=x onerror=al', '20자까지');
    assert.strictEqual(group.name, 'b 묶음 /b');
    assert.ok(group.edges[3].label === 'b 뒤 /b' && group.story.startsWith('script alert(1) /script'));
});

test('AI 답 검사: 상한(묶음 4·요소 24·연결 64)과 쓸 수 없는 답(연결 없음·요소 하나·모양 틀림)은 null', () => {
    const pair = name => ({ name, nodes: [node('a', 0, 0), node('b', 200, 0)], edges: [{ from: 'a', to: 'b' }] });
    assert.strictEqual(sanitize({ groups: [1, 2, 3, 4, 5, 6].map(i => pair(`g${i}`)) }).groups.length, 4);
    const many = Array.from({ length: 30 }, (_, i) => node(`n${i}`, i * 30, (i % 5) * 70));
    const chain = sanitize({ groups: [{ nodes: many, edges: many.slice(1).map((item, i) => ({ from: many[i].id, to: item.id })) }] }).groups[0];
    assert.deepStrictEqual([chain.nodes.length, chain.edges.length], [24, 23], '25번째 요소부터는 받지 않고 그 연결도 뺀다');
    const all = [];
    for (let i = 0; i < 24; i++) for (let j = i + 1; j < 24; j++) all.push({ from: `n${i}`, to: `n${j}` });
    const dense = sanitize({ groups: [{ nodes: many.slice(0, 24), edges: all }] }).groups[0];
    assert.deepStrictEqual([dense.nodes.length, dense.edges.length, dense.pattern, dense.center], [24, 64, 'hub', 'n0'], '앞 64개 연결에서 n0이 나머지 모두와 이어진다');
    assert.strictEqual(sanitize({ groups: [{ nodes: many.slice(0, 2), edges: Array.from({ length: 5000 }, () => ({ from: 'n0', to: 'n0' })).concat([{ from: 'n0', to: 'n1' }]) }] }), null, '긴 목록은 앞부분만 본다');
    [null, 'x', 3, [], {}, { groups: [] }, { groups: 'x' }, { groups: [{ nodes: [node('a', 0, 0), node('b', 100, 0)], edges: [] }] },
        { groups: [{ nodes: [node('a', 0, 0)], edges: [{ from: 'a', to: 'a' }] }] }, { groups: [{ nodes: 'x', edges: 'y' }] }]
        .forEach(raw => assert.strictEqual(sanitize(raw), null, JSON.stringify(raw)));
    const mixed = sanitize({ groups: [{ nodes: [node('a', 0, 0)], edges: [] }, pair('남는 묶음')] });
    assert.deepStrictEqual(plain(mixed.groups.map(group => group.name)), ['남는 묶음'], '쓸 수 없는 묶음만 뺀다');
    assert.strictEqual(sanitize([pair('배열')]).groups[0].name, '배열', '묶음 배열만 줘도 받는다');
    assert.strictEqual(sanitize({ nodes: pair('').nodes, edges: pair('').edges }).groups[0].name, '묶음 1', '묶음 하나만 줘도 받는다(이름이 없으면 묶음 N)');
});

test('무늬 고르기: AI가 준 무늬는 그대로(대소문자 무관), 없거나 모르면 모양으로(중심과 주변·서로 연결·차례 흐름·순환·나무 구조·짝)', () => {
    const star = [node('h', 300, 300), node('x', 300, 0), node('y', 600, 300), node('z', 300, 600), node('w', 0, 300)];
    const starEdges = ['x', 'y', 'z', 'w'].map(id => ({ from: id, to: 'h' }));
    const pick = (nodes, edges, extra = {}) => {
        const group = sanitize({ groups: [{ nodes, edges, ...extra }] }).groups[0];
        return [group.pattern, group.center];
    };
    assert.deepStrictEqual(pick(star, starEdges), ['hub', 'h']);
    const five = [0, 1, 2, 3, 4].map(i => node(`k${i}`, i * 100, (i % 2) * 100));
    const k5 = [];
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) k5.push({ from: `k${i}`, to: `k${j}` });
    assert.deepStrictEqual(pick(five, k5), ['mesh', '']);
    const line = [node('a', 0, 0), node('b', 100, 0), node('c', 200, 0), node('d', 300, 0)];
    const path3 = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }];
    assert.deepStrictEqual(pick(line, path3), ['chain', '']);
    assert.deepStrictEqual(pick(line, [...path3, { from: 'd', to: 'a' }]), ['cycle', '']);
    const tree = [node('r', 300, 0), node('x', 100, 150), node('y', 500, 150), node('x1', 0, 300), node('x2', 200, 300), node('x3', 100, 300)];
    assert.deepStrictEqual(pick(tree, [{ from: 'r', to: 'x' }, { from: 'r', to: 'y' }, { from: 'x', to: 'x1' }, { from: 'x', to: 'x2' }, { from: 'x', to: 'x3' }]), ['tree', 'r'], '나무는 맨 위 요소에서(더 많이 이어진 x가 아니라)');
    assert.deepStrictEqual(pick(line.slice(0, 2), path3.slice(0, 1)), ['pairs', '']);
    assert.deepStrictEqual(pick(star, starEdges, { pattern: 'TREE' }), ['tree', 'x'], 'AI가 준 무늬는 그대로, 맨 위 요소에서');
    assert.deepStrictEqual(pick(star, starEdges, { pattern: 'spiral', center: 'nope' }), ['hub', 'h'], '모르는 무늬·없는 center는 모양으로');
    assert.deepStrictEqual(pick(five, k5, { pattern: 'hub' }), ['hub', 'k0'], '가운데가 없으면 가장 많이 이어진(같으면 위쪽) 요소');
    assert.deepStrictEqual(pick(star, starEdges, { pattern: 'chain', center: 'y' }), ['chain', 'y'], '준 center는 남긴다(차례 흐름의 시작)');
});

/* ======================= 한 바퀴의 움직임 ======================= */
const eventsOf = (plan, patterns) => plain(P.planMotionTimeline(plan, patterns).groups);
const near = (a, b) => Math.abs(a - b) < 1e-9;
const idOf = (group, index) => group.nodes[index].id;

test('중심과 주변(서버 모델): 클라이언트가 위에서 시계 방향으로 차례로 서버에 요청하고, 뒤 절반에 서버가 같은 차례로 응답한다. 서버는 요청이 닿을 때마다 빛난다', () => {
    const plan = sanitize(sampleAnswer());
    const [hub] = eventsOf(plan);
    const group = plan.groups[0];
    assert.strictEqual(hub.pattern, 'hub');
    assert.strictEqual(hub.events.length, 16);
    const requests = hub.events.filter(event => event.tone === 'request');
    const responses = hub.events.filter(event => event.tone === 'response');
    assert.deepStrictEqual(plain(requests.map(event => idOf(group, event.from))), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'], '위(c1)에서 시계 방향');
    assert.ok(requests.every(event => idOf(group, event.to) === 'srv' && event.start >= 0.03 - 1e-9 && event.end <= 0.47 + 1e-9), '요청은 앞 절반, 서버로');
    assert.deepStrictEqual(plain(responses.map(event => idOf(group, event.to))), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
    assert.ok(responses.every(event => idOf(group, event.from) === 'srv' && event.start >= 0.53 - 1e-9 && event.end <= 0.97 + 1e-9), '응답은 뒤 절반, 서버에서');
    requests.slice(1).forEach((event, i) => assert.ok(event.start > requests[i].start, '요청은 어긋나 출발한다'));
    assert.ok(hub.events.every(event => event.end - event.start > 0.1 && event.end <= 1));
    const centerPulses = hub.pulses.filter(pulse => idOf(group, pulse.node) === 'srv');
    assert.deepStrictEqual(plain(centerPulses.map(pulse => pulse.at)), plain(requests.map(event => event.end)), '서버는 요청이 닿을 때마다 빛난다');
    assert.strictEqual(new Set(hub.events.map(event => event.edge)).size, 8, '연결 8개를 모두 쓴다');
});

// 진짜 Gemini가 첨부 그림의 서버 모델을 '서버 → 클라이언트(데이터 전송)' 한 방향으로만 읽었을 때, 앞 절반(요청 물결)이 통째로 비어 GIF의 절반이 멈춰 보였다
test('중심과 주변: 연결이 모두 한 방향(가운데에서만·가운데로만)이면 그 물결이 한 바퀴 내내 돌아 멈춘 구간이 없다', () => {
    const outward = sampleAnswer();
    outward.groups = [{ ...outward.groups[0], edges: outward.groups[0].edges.map(edge => ({ from: 'srv', to: edge.from, dir: 'forward', label: '데이터 전송' })) }];
    const inward = sampleAnswer();
    inward.groups = [{ ...inward.groups[0], edges: inward.groups[0].edges.map(edge => ({ from: edge.from, to: 'srv', dir: 'forward' })) }];
    for (const [answer, tone] of [[outward, 'response'], [inward, 'request']]) {
        const plan = sanitize(answer);
        const [hub] = eventsOf(plan);
        const group = plan.groups[0];
        assert.strictEqual(hub.pattern, 'hub', tone);
        assert.strictEqual(hub.events.length, 8, `${tone}: 연결마다 한 번`);
        assert.ok(hub.events.every(event => event.tone === tone), `${tone}: 한 가지 물결`);
        assert.ok(hub.events.every(event => idOf(group, tone === 'response' ? event.from : event.to) === 'srv'), `${tone}: 화살표 쪽으로만`);
        for (let t = 0.05; t < 0.951; t += 0.05) assert.ok(hub.events.some(event => event.start <= t && t <= event.end), `${tone}: ${t.toFixed(2)}에도 움직이는 점이 있다`);
        assert.ok(hub.events.every(event => event.start >= 0.03 - 1e-9 && event.end <= 0.97 + 1e-9), `${tone}: 0.03~0.97 안`);
        hub.events.slice(1).forEach((event, i) => assert.ok(event.start > hub.events[i].start, `${tone}: 위에서 시계 방향으로 어긋나 출발한다`));
    }
});

test('서로 연결(P2P): 가운데 없이 피어마다 차례로(위에서 시계 방향) 이웃 일곱에게 보낸다. 연결마다 양쪽으로 한 번씩, 모든 피어가 같은 수만큼 빛난다', () => {
    const plan = sanitize(sampleAnswer());
    const mesh = eventsOf(plan)[1];
    const group = plan.groups[1];
    assert.strictEqual(mesh.events.length, 56);
    const senders = [];
    mesh.events.forEach(event => { if (!senders.includes(idOf(group, event.from))) senders.push(idOf(group, event.from)); });
    assert.deepStrictEqual(senders, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    senders.forEach(id => {
        const sent = mesh.events.filter(event => idOf(group, event.from) === id);
        assert.strictEqual(sent.length, 7, id);
        assert.strictEqual(new Set(sent.map(event => event.start)).size, 1, `${id}: 이웃 모두에게 한꺼번에`);
    });
    group.edges.forEach((edge, i) => {
        const ways = mesh.events.filter(event => event.edge === i).map(event => `${idOf(group, event.from)}>${idOf(group, event.to)}`).sort();
        assert.deepStrictEqual(ways, [`${edge.from}>${edge.to}`, `${edge.to}>${edge.from}`].sort(), `연결 ${i}`);
    });
    const counts = group.nodes.map((item, i) => mesh.pulses.filter(pulse => pulse.node === i).length);
    assert.deepStrictEqual(counts, Array(8).fill(8), '보낼 때 한 번 + 받을 때 일곱 번');
    assert.ok(mesh.events.every(event => event.start >= 0 && event.end <= 1 && event.start < event.end && event.tone === 'flow'));
});

test('차례 흐름: 화살표를 따라 한쪽 끝에서 시작해 연결을 하나씩 차례로 건넌다(앞 걸음이 끝나면 다음 걸음)', () => {
    const line = [node('d', 300, 0), node('b', 100, 0), node('a', 0, 0), node('c', 200, 0)];
    const forward = sanitize({ groups: [{ pattern: 'chain', nodes: line, edges: [{ from: 'c', to: 'd', dir: 'forward' }, { from: 'a', to: 'b', dir: 'forward' }, { from: 'b', to: 'c', dir: 'forward' }] }] });
    const steps = eventsOf(forward)[0].events.map(event => `${idOf(forward.groups[0], event.from)}>${idOf(forward.groups[0], event.to)}`);
    assert.deepStrictEqual(steps, ['a>b', 'b>c', 'c>d']);
    const events = eventsOf(forward)[0].events;
    assert.ok(near(events[0].start, 0.03) && near(events[2].end, 0.97));
    events.slice(1).forEach((event, i) => assert.ok(near(event.start, events[i].end), '이어서'));
    const back = sanitize({ groups: [{ pattern: 'chain', nodes: line, edges: [{ from: 'b', to: 'a', dir: 'forward' }, { from: 'c', to: 'b', dir: 'forward' }, { from: 'd', to: 'c', dir: 'forward' }] }] });
    assert.deepStrictEqual(eventsOf(back)[0].events.map(event => `${idOf(back.groups[0], event.from)}>${idOf(back.groups[0], event.to)}`), ['d>c', 'c>b', 'b>a'], '화살표가 반대면 반대 끝에서');
    const plainLine = sanitize({ groups: [{ nodes: line, edges: [{ from: 'c', to: 'd' }, { from: 'b', to: 'c' }, { from: 'a', to: 'b' }] }] });
    assert.deepStrictEqual(eventsOf(plainLine)[0].events.map(event => `${idOf(plainLine.groups[0], event.from)}>${idOf(plainLine.groups[0], event.to)}`), ['a>b', 'b>c', 'c>d'], '화살표가 없으면 왼쪽 위 끝에서');
    const lit = eventsOf(plainLine)[0].pulses.map(pulse => idOf(plainLine.groups[0], pulse.node));
    assert.deepStrictEqual(lit, ['b', 'c', 'd'], '다음 요소를 밝힌다');
});

test('순환: 한 바퀴를 빈틈없이 나눠 돌고, 마지막 걸음이 처음 요소로 돌아와 끝과 처음이 이어진다', () => {
    const ring = [node('a', 200, 0), node('b', 400, 150), node('c', 300, 400), node('d', 100, 400), node('e', 0, 150)];
    const plan = sanitize({ groups: [{ nodes: ring, edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'a']].map(([from, to]) => ({ from, to })) }] });
    const [cycle] = eventsOf(plan);
    assert.strictEqual(cycle.pattern, 'cycle');
    const events = cycle.events;
    assert.strictEqual(events.length, 5);
    assert.ok(near(events[0].start, 0) && events[4].end === 1, '0부터 1까지');
    events.slice(1).forEach((event, i) => {
        assert.ok(near(event.start, events[i].end));
        assert.strictEqual(event.from, events[i].to, '앞 걸음이 닿은 요소에서 다음 걸음');
    });
    assert.strictEqual(events[4].to, events[0].from, '끝에서 처음으로');
    const atStart = P.motionScene(plan, { groups: [cycle] }, 0, 1000, 1000, 6);
    assert.ok(atStart.rings.some(ring => ring.alpha > 0.85), '1에서 닿은 요소는 다음 바퀴 처음(0)에 빛난다');
});

test('나무 구조: 맨 위 요소에서 단계마다 함께 내려간다(위에서 아래로, 화살표가 위로 가면 그 방향으로)', () => {
    const tree = [node('r', 300, 0), node('x', 100, 150), node('y', 500, 150), node('x1', 0, 300), node('x2', 200, 300), node('y1', 500, 300)];
    const edges = [['r', 'x'], ['r', 'y'], ['x', 'x1'], ['x', 'x2'], ['y', 'y1']];
    const plan = sanitize({ groups: [{ nodes: tree, edges: edges.map(([from, to]) => ({ from, to })) }] });
    const [level] = eventsOf(plan);
    assert.strictEqual(level.pattern, 'tree');
    const ways = level.events.map(event => [`${idOf(plan.groups[0], event.from)}>${idOf(plan.groups[0], event.to)}`, Number(event.start.toFixed(3))]);
    assert.deepStrictEqual(ways, [['r>x', 0.04], ['r>y', 0.04], ['x>x1', 0.49], ['x>x2', 0.49], ['y>y1', 0.49]]);
    const up = sanitize({ groups: [{ pattern: 'tree', center: 'r', nodes: tree, edges: edges.map(([from, to]) => ({ from: to, to: from, dir: 'forward' })) }] });
    assert.deepStrictEqual(eventsOf(up)[0].events.map(event => `${idOf(up.groups[0], event.from)}>${idOf(up.groups[0], event.to)}`), ['x>r', 'y>r', 'x1>x', 'x2>x', 'y1>y']);
});

test('나무 구조: 떨어진 부분은 그 부분의 맨 위 요소에서 시작한다(AI가 아래 요소를 먼저 적어도 위로 거슬러 오르지 않는다)', () => {
    // 오른쪽 나무는 r2가 맨 위, b1·b2가 그 아래, b3이 b1 아래. 목록에는 b1이 r2보다 먼저 나온다
    const plan = sanitize({ groups: [{ name: '두 나무', pattern: 'tree', nodes: [
        { id: 'r1', box: [50, 100, 150, 200] }, { id: 'a1', box: [400, 50, 500, 150] }, { id: 'a2', box: [400, 200, 500, 300] },
        { id: 'b1', box: [400, 600, 500, 700] }, { id: 'r2', box: [50, 700, 150, 800] }, { id: 'b2', box: [400, 800, 500, 900] }, { id: 'b3', box: [800, 600, 900, 700] }
    ], edges: [['r1', 'a1'], ['r1', 'a2'], ['r2', 'b1'], ['r2', 'b2'], ['b1', 'b3']].map(([from, to]) => ({ from, to, dir: 'none' })) }] });
    const [tree] = eventsOf(plan);
    const ways = tree.events.map(event => [`${idOf(plan.groups[0], event.from)}>${idOf(plan.groups[0], event.to)}`, Number(event.start.toFixed(3))]);
    assert.deepStrictEqual(ways, [['r1>a1', 0.04], ['r1>a2', 0.04], ['r2>b1', 0.04], ['r2>b2', 0.04], ['b1>b3', 0.49]], '두 나무 모두 맨 위에서 함께 내려간다');
});

test('긴 흐름: 차례 흐름·순환·나무 구조는 걸음이 많아도 걸음마다 30장면 가운데 3장면 넘게 보이고 모든 연결이 그려진다. 순환은 한 바퀴 끝과 처음이 끊기지 않는다', () => {
    const FRAMES = 30;
    const framesOf = event => Array.from({ length: FRAMES }, (_, i) => i / FRAMES).filter(t => t >= event.start && t < event.end).length;
    const plan = sanitize(sampleAnswer()); // P2P 묶음: 연결 28개를 차례로 걷는다
    for (const pattern of ['chain', 'cycle']) {
        const peers = eventsOf(plan, [pattern, pattern])[1];
        const shown = new Map(); // 연결마다 보이는 장면 수(순환의 끝에서 나눈 걸음은 두 조각을 합친다)
        peers.events.forEach(event => shown.set(event.edge, (shown.get(event.edge) || 0) + framesOf(event)));
        assert.strictEqual(shown.size, 28, `${pattern}: 모든 연결`);
        assert.ok(Math.min(...shown.values()) >= 3, `${pattern}: 걸음마다 3장면 넘게 ${[...shown.values()].join(',')}`);
        assert.ok(peers.events.every(event => event.start >= 0 && event.end <= 1 && event.start < event.end), `${pattern}: 시간은 0~1 안`);
    }
    const chain = eventsOf(plan, ['chain', 'chain'])[1].events;
    assert.ok(near(Math.min(...chain.map(event => event.start)), 0.03) && near(Math.max(...chain.map(event => event.end)), 0.97), '차례 흐름은 0.03에 떠나 0.97에 닿는다');
    chain.slice(1).forEach((event, k) => assert.ok(event.start > chain[k].start && event.start < chain[k].end, '다음 점은 앞 점이 닿기 전에 차례로 떠난다'));
    // 순환: 끝을 넘는 걸음은 끝까지(0~cut)와 다음 바퀴 처음(cut~1) 두 조각으로 나뉘어 같은 자리에서 이어진다
    const cycle = P.planMotionTimeline(plan, ['cycle', 'cycle']);
    const pieces = plain(cycle.groups[1].events.filter(event => event.p0 !== undefined));
    assert.ok(pieces.length >= 2 && pieces.length % 2 === 0, `나눈 조각 ${pieces.length}`);
    const only = events => ({ groups: [{ ...cycle.groups[0], events: [], pulses: [] }, { ...cycle.groups[1], events, pulses: [] }] });
    for (let k = 0; k < pieces.length; k += 2) {
        const [tail, head] = [pieces[k], pieces[k + 1]];
        assert.deepStrictEqual([tail.end, head.start, tail.p0, head.p1, tail.p1, head.edge, head.from, head.to], [1, 0, 0, 1, head.p0, tail.edge, tail.from, tail.to]);
        const late = P.motionScene(plan, only([tail]), 1 - 1e-9, 800, 446, 6.7).packets[0];
        const early = P.motionScene(plan, only([head]), 0, 800, 446, 6.7).packets[0];
        assert.ok(Math.abs(late.x - early.x) < 0.01 && Math.abs(late.y - early.y) < 0.01, '끝 장면과 처음 장면에서 점이 같은 자리');
    }
    const counts = Array.from({ length: FRAMES }, (_, i) => P.motionScene(plan, only(cycle.groups[1].events), i / FRAMES, 800, 446, 6.7).packets.length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `장면마다 점 수가 고르다(끝과 처음 사이에 빈 장면이 없다): ${counts.join(',')}`);
    // 나무 구조: 24개를 한 줄로 이은 나무(단계 23개)도 단계마다 3장면 넘게, 마지막 단계는 0.94에 닿는다
    const many = Array.from({ length: 24 }, (_, i) => node(`n${i}`, (i % 6) * 160, Math.floor(i / 6) * 220 + (i % 6) * 10));
    const line = sanitize({ groups: [{ pattern: 'tree', center: 'n0', nodes: many, edges: many.slice(1).map((item, i) => ({ from: many[i].id, to: item.id, dir: 'forward' })) }] });
    const deep = eventsOf(line)[0].events;
    assert.strictEqual(deep.length, 23);
    assert.ok(deep.every(event => framesOf(event) >= 3), deep.map(framesOf).join(','));
    assert.ok(near(Math.max(...deep.map(event => event.end)), 0.94) && deep.every(event => event.end <= 0.94 + 1e-9));
    deep.slice(1).forEach((event, k) => assert.ok(event.start > deep[k].start, '단계 차례대로'));
});

test('짝 주고받기: 연결마다 앞 절반에 한쪽으로, 뒤 절반에 반대로(한쪽 화살표는 두 절반 모두 화살표 쪽으로 보내 뒤 절반이 비지 않는다)', () => {
    const plan = sanitize({ groups: [{ pattern: 'pairs', nodes: [node('a', 0, 0), node('b', 300, 0), node('c', 600, 0)], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', dir: 'forward' }] }] });
    const events = eventsOf(plan)[0].events.map(event => [event.edge, idOf(plan.groups[0], event.from), idOf(plan.groups[0], event.to), event.start < 0.5, event.tone]);
    assert.deepStrictEqual(events, [[0, 'a', 'b', true, 'request'], [0, 'b', 'a', false, 'response'], [1, 'b', 'c', true, 'request'], [1, 'b', 'c', false, 'request']]);
});

test('어느 무늬로 골라도 모든 연결을 쓰고, 시간은 0~1 안이며, 한쪽 화살표를 거스르지 않는다(묶음마다 고른 무늬, 자동)', () => {
    const star = sanitize({ groups: [{ nodes: [node('h', 300, 300), node('x', 300, 0), node('y', 600, 300), node('z', 300, 600)], edges: [{ from: 'x', to: 'h' }, { from: 'h', to: 'y', dir: 'forward' }, { from: 'z', to: 'h', dir: 'none' }, { from: 'x', to: 'y', dir: 'forward' }] }] });
    const scattered = sanitize({ groups: [{ nodes: [node('a', 0, 0), node('b', 100, 0), node('c', 500, 500), node('d', 600, 500), node('e', 700, 500)], edges: [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }, { from: 'd', to: 'e', dir: 'forward' }, { from: 'e', to: 'c' }] }] });
    for (const plan of [sanitize(sampleAnswer()), star, scattered]) {
        for (const pattern of ['auto', 'hub', 'mesh', 'chain', 'cycle', 'tree', 'pairs']) {
            eventsOf(plan, plan.groups.map(() => pattern)).forEach((timeline, g) => {
                const group = plan.groups[g];
                assert.strictEqual(timeline.pattern, pattern === 'auto' ? group.pattern : pattern);
                assert.deepStrictEqual([...new Set(timeline.events.map(event => event.edge))].sort((a, b) => a - b), group.edges.map((edge, i) => i), `${pattern}: 모든 연결`);
                timeline.events.forEach(event => {
                    const edge = group.edges[event.edge];
                    const ends = [idOf(group, event.from), idOf(group, event.to)];
                    assert.ok(event.start >= 0 && event.end <= 1 && event.start < event.end, `${pattern}: 시간`);
                    assert.deepStrictEqual(ends.slice().sort(), [edge.from, edge.to].sort(), `${pattern}: 그 연결의 두 끝`);
                    if (edge.dir === 'forward') assert.deepStrictEqual(ends, [edge.from, edge.to], `${pattern}: 화살표 방향`);
                });
                timeline.pulses.forEach(pulse => assert.ok(pulse.at >= 0 && pulse.at <= 1 && pulse.node >= 0 && pulse.node < group.nodes.length));
            });
        }
    }
    const mixed = eventsOf(sanitize(sampleAnswer()), ['mesh', 'auto']);
    assert.deepStrictEqual(mixed.map(group => group.pattern), ['mesh', 'mesh']);
    assert.strictEqual(eventsOf(sanitize(sampleAnswer()), ['nope']).at(0).pattern, 'hub', '모르는 무늬는 계획의 무늬');
});

/* ======================= 그릴 자리 ======================= */
test('그릴 자리: 연결선은 상자 테두리(와 틈)에서 자르고 상자가 겹치면 가운데를 잇는다. 장면에는 지나가는 선·점·꼬리·테두리', () => {
    const ends = P.motionEdgeEnds([0, 0, 100, 100], [0, 300, 100, 400], 1000, 1000, 5);
    assert.deepStrictEqual(plain(ends), { x1: 105, y1: 50, x2: 295, y2: 50 });
    const diagonal = P.motionEdgeEnds([0, 0, 100, 100], [400, 400, 500, 500], 1000, 1000);
    assert.deepStrictEqual(plain([diagonal.x1, diagonal.y1, diagonal.x2, diagonal.y2]), [100, 100, 400, 400]);
    const overlap = P.motionEdgeEnds([0, 0, 100, 100], [0, 50, 100, 150], 1000, 1000);
    assert.deepStrictEqual(plain(overlap), { x1: 50, y1: 50, x2: 100, y2: 50 });
    const scaled = P.motionEdgeEnds([0, 0, 100, 100], [0, 300, 100, 400], 800, 446);
    assert.ok(near(scaled.x1, 80) && near(scaled.x2, 240) && near(scaled.y1, 22.3));
    const plan = sanitize({ groups: [{ pattern: 'pairs', nodes: [node('a', 0, 0), node('b', 400, 0)], edges: [{ from: 'a', to: 'b', dir: 'forward' }] }] });
    const timeline = P.planMotionTimeline(plan);
    const event = timeline.groups[0].events[0];
    const middle = P.motionScene(plan, timeline, (event.start + event.end) / 2, 1000, 1000, 6);
    assert.deepStrictEqual([middle.lines.length, middle.packets.length, middle.rings.length], [1, 1, 0]);
    const packet = middle.packets[0];
    assert.ok(packet.x > middle.lines[0].x1 && packet.x < middle.lines[0].x2 && packet.trail.length === 3, '점은 선 위, 꼬리 셋');
    assert.ok(packet.trail.every(ghost => ghost.x < packet.x && ghost.r < packet.r && ghost.alpha < 1), '꼬리는 뒤에 작고 옅게');
    assert.deepStrictEqual(P.motionScene(plan, timeline, 0.99, 1000, 1000, 6).packets.length, 0);
    const arrived = P.motionScene(plan, timeline, event.end + 0.01, 1000, 1000, 6);
    assert.ok(arrived.rings.length === 1 && arrived.rings[0].x < 400 && arrived.rings[0].w > 60, '닿은 요소의 상자를 둘러 빛난다');
    assert.deepStrictEqual(plain(P.motionFrameSize(2000, 1116, 800)), { width: 800, height: 446 });
    assert.deepStrictEqual(plain(P.motionFrameSize(500, 300, 800)), { width: 500, height: 300 }, '작은 그림은 키우지 않는다');
    assert.deepStrictEqual(plain(P.motionFrameSize(2000, 1116, 480)), { width: 480, height: 268 });
    assert.throws(() => P.motionFrameSize(0, 10, 800), /그림 크기/);
    const light = new Uint8Array(400).fill(240);
    const dark = new Uint8Array(400).fill(20);
    assert.strictEqual(P.motionColors(P.motionLuminance(light)).request, '#e11d48', '밝은 그림에는 짙은 색');
    assert.strictEqual(P.motionColors(P.motionLuminance(dark)).request, '#fb7185', '어두운 그림에는 옅은 색');
    assert.deepStrictEqual(plain(P.motionFixedColors(P.motionColors(1))), [[225, 29, 72], [5, 150, 105], [124, 58, 237], [255, 255, 255]]);
});

test('GIF 지문: 같은 값이면 같고, 한 글자·길이가 달라도 다르며, 검사(data-safety.js)가 받는 모양이다', () => {
    const a = P.imageMotionSignature(GIF);
    assert.strictEqual(a, P.imageMotionSignature(`${GIF}`));
    assert.notStrictEqual(a, P.imageMotionSignature(GIF_B));
    assert.notStrictEqual(a, P.imageMotionSignature(`${GIF}A`));
    const huge = `data:image/gif;base64,${'A'.repeat(3000000)}`;
    assert.notStrictEqual(P.imageMotionSignature(huge), P.imageMotionSignature(`${huge.slice(0, -1)}B`), '끝 글자도 본다');
    assert.match(a, /^[0-9a-z]{1,12}-[0-9a-z]{1,8}$/);
    assert.match(P.imageMotionSignature(huge), /^[0-9a-z]{1,12}-[0-9a-z]{1,8}$/);
});

/* ======================= 바꾸기·되돌리기·낡은 기록 ======================= */
const RECORD_KEY = /^img_\d{14,20}$/;

test('바꾸기: 원래 그림은 새 그림 키로 간직하고 그 자리에 GIF를 넣으며, 기록에는 작은 표시만 남는다(교안 글은 그대로)', () => {
    const mod = motionLesson();
    const ctx = apiContext(mod);
    const before = JSON.stringify(mod.tabContents);
    const still = ctx.applyImageMotionData(mod, 'img_1', PNG, GIF, { patterns: ['hub', 'mesh', 'bad'], summary: '서버 모델: 중심과 주변 · P2P 구조: 서로 연결' }, 1793836800000);
    assert.match(still, RECORD_KEY);
    assert.ok(/^[\w-]{1,80}$/.test(still), '그림 키 규칙(SAFE_IMAGE_KEY)을 지난다');
    assert.deepStrictEqual([mod.images.img_1, mod.images[still]], [GIF, PNG]);
    assert.deepStrictEqual(plain(mod.imageMotions.img_1), { still, at: 1793836800000, sig: P.imageMotionSignature(GIF), patterns: ['hub', 'mesh'], summary: '서버 모델: 중심과 주변 · P2P 구조: 서로 연결' });
    assert.ok(!JSON.stringify(mod.imageMotions).includes('base64'), '기록에 그림을 넣지 않는다');
    assert.strictEqual(JSON.stringify(mod.tabContents), before);
    assert.strictEqual(ctx.imageMotionState(mod, 'img_1'), 'valid');
    assert.throws(() => ctx.applyImageMotionData(mod, 'img_1', GIF, GIF_B), /이미 움직이는 GIF/);
    assert.throws(() => ctx.applyImageMotionData(motionLesson(), 'img_1', PNG_B, GIF), /그림이 바뀌어/);
    assert.throws(() => ctx.applyImageMotionData(motionLesson(), 'img_1', PNG, PNG_B), /GIF를 만들지 못했습니다/);
    // 글이 이미 그 키를 가리키는 키는 쓰지 않는다
    const taken = motionLesson({ tabContents: { basicLearn: '![](local:img_1) ![](local:img_1793836800000500)' } });
    let n = 0;
    const realRandom = Math.random;
    vm.runInContext('Math', ctx).random = () => (n++ ? 0.5004 : 0.5);
    try {
        assert.notStrictEqual(ctx.freshMotionStillKey(taken, 1793836800000), 'img_1793836800000500');
    } finally {
        vm.runInContext('Math', ctx).random = realRandom;
    }
});

test('되돌리기: GIF 그대로면 간직한 그림으로 되돌리고 원래 그림 키와 기록을 지운다. 간직한 그림이 없으면 그대로 둔다', () => {
    const mod = motionLesson();
    const ctx = apiContext(mod);
    const still = ctx.applyImageMotionData(mod, 'img_1', PNG, GIF);
    assert.strictEqual(ctx.undoImageMotion(mod, 'img_1'), 'restored');
    assert.deepStrictEqual(plain(mod.images), { img_1: PNG });
    assert.deepStrictEqual(plain(mod.imageMotions), {});
    assert.ok(!(still in mod.images));
    assert.strictEqual(ctx.undoImageMotion(mod, 'img_1'), 'none');
    const lost = motionLesson();
    const lostStill = ctx.applyImageMotionData(lost, 'img_1', PNG, GIF);
    lost.images[lostStill] = 'teacher-image:0123456789abcdef1a'; // 따로 담은 백업에서 원래 그림 파일을 찾지 못함
    const snapshot = JSON.stringify(lost);
    assert.strictEqual(ctx.undoImageMotion(lost, 'img_1'), 'missing');
    assert.strictEqual(JSON.stringify(lost), snapshot, '아무것도 바꾸지 않는다');
    const ref = motionLesson();
    ctx.applyImageMotionData(ref, 'img_1', PNG, GIF);
    ref.images.img_1 = 'teacher-image:0123456789abcdef1b'; // GIF 파일을 찾지 못함: 낡았다고 하지 않는다
    assert.strictEqual(ctx.imageMotionState(ref, 'img_1'), 'unknown');
    assert.strictEqual(ctx.undoImageMotion(ref, 'img_1'), 'missing');
    assert.strictEqual(ctx.settleImageMotions(ref), 0);
    assert.ok(ref.imageMotions.img_1, '찾지 못한 그림 자리는 기록을 두고 나중에 채워지기를 기다린다');
});

test('낡은 기록: 그 자리 그림이 다시 찾기 등으로 바뀌었으면 새 그림을 덮지 않고 기록만 정리한다(원래 그림 키는 아무 데서도 쓰지 않을 때만 지운다)', () => {
    const mod = motionLesson();
    const ctx = apiContext(mod);
    const still = ctx.applyImageMotionData(mod, 'img_1', PNG, GIF);
    mod.images = { ...mod.images, img_1: PNG_B }; // 다시 찾기·삽화 다시 그리기·작업 기록 되돌리기
    assert.strictEqual(ctx.imageMotionState(mod, 'img_1'), 'stale');
    assert.strictEqual(ctx.undoImageMotion(mod, 'img_1'), 'stale');
    assert.deepStrictEqual(plain(mod.images), { img_1: PNG_B }, '새 그림은 그대로, 원래 그림 키는 지운다');
    assert.deepStrictEqual(plain(mod.imageMotions), {});
    const shared = motionLesson();
    const keep = ctx.applyImageMotionData(shared, 'img_1', PNG, GIF);
    shared.tabContents = { ...shared.tabContents, basicPrac: `실습 ![](local:${keep})` };
    shared.images = { ...shared.images, img_1: GIF_B }; // 다른 GIF여도 이 기능이 만든 GIF가 아니면 낡은 기록이다
    assert.strictEqual(ctx.settleImageMotions(shared), 1);
    assert.deepStrictEqual([shared.images.img_1, shared.images[keep], Object.keys(shared.imageMotions).length], [GIF_B, PNG, 0], '다른 탭이 쓰는 원래 그림은 남긴다');
    assert.ok(still !== keep);
    // 그림 작업이 도는 동안에는 정리하지 않는다
    const busy = motionLesson();
    ctx.applyImageMotionData(busy, 'img_1', PNG, GIF);
    busy.images = { ...busy.images, img_1: PNG_B };
    ctx.isVolumeFilling = () => true;
    assert.strictEqual(ctx.settleImageMotions(busy), 0);
    assert.ok(busy.imageMotions.img_1);
    ctx.isVolumeFilling = () => false;
    // 낡은 기록이 있는 그림을 다시 바꾸면 새 기록으로 바꾸고 예전 원래 그림은 정리한다
    const again = motionLesson();
    const first = ctx.applyImageMotionData(again, 'img_1', PNG, GIF);
    again.images = { ...again.images, img_1: PNG_B };
    const second = ctx.applyImageMotionData(again, 'img_1', PNG_B, GIF_B, {}, Date.now() + 5);
    assert.deepStrictEqual([again.imageMotions.img_1.still, again.images[second], first in again.images], [second, PNG_B, false]);
});

// 보기 화면의 버튼 이름=그림 키
const actionsIn = view => [...view.querySelectorAll('[data-lesson-action]')].map(el => `${el.getAttribute('data-lesson-action')}=${el.getAttribute('data-img-id')}`);
// 붙여 넣은 그림(<img src="local:키">, 그림 틀·다시 찾기 버튼 없음)은 보기 화면에 그림 값으로 그려진다
const PASTED = '## 구조\n\n<img src="local:img_1" alt="붙여 넣은 그림">\n\n설명';
const drawPasted = (ctx, mod) => {
    const view = ctx.document.getElementById('render-view');
    view.innerHTML = `<p><span class="block"><img src="${mod.images.img_1}" alt="붙여 넣은 그림"></span></p>`;
    vm.runInContext('window.applyWhiteboardVideos', ctx)(mod);
    return view;
};

test('그림 작업이 도는 동안 원래 그림으로 되돌려도 간직한 원래 그림 사본을 지운다(기록 없이 남은 같은 값의 사본이 판서 영상·GIF 버튼의 그림 키를 가로채지 않게)', async () => {
    const mod = motionLesson({ tabContents: { basicLearn: PASTED } });
    const ctx = domContext(mod);
    const still = ctx.applyImageMotionData(mod, 'img_1', PNG, GIF);
    let busy = true;
    ctx.pictureJobRunning = () => busy; // 다른 차시 일괄 생성·다른 그림 다시 찾기·답을 기다리는 AI 호출 등
    await ctx.revertImageMotion('img_1');
    assert.deepStrictEqual([plain(Object.keys(mod.images)), mod.images.img_1, plain(mod.imageMotions)], [['img_1'], PNG, {}], `원래 그림 사본(${still})도 지운다`);
    assert.deepStrictEqual(ctx.toasts.at(-1), ['원래 그림으로 되돌렸습니다.', 'success']);
    busy = false;
    const view = drawPasted(ctx, mod);
    await flush();
    assert.deepStrictEqual(actionsIn(view), ['whiteboard-video=img_1', 'image-motion=img_1'], '되돌린 그림의 키에 버튼을 단다');
    // 다른 곳이 쓰는 원래 그림 키는 그림 작업 중에도 남긴다
    const shared = motionLesson();
    const sharedCtx = domContext(shared);
    const keep = sharedCtx.applyImageMotionData(shared, 'img_1', PNG, GIF);
    shared.tabContents = { ...shared.tabContents, basicPrac: `실습 ![](local:${keep})` };
    sharedCtx.pictureJobRunning = () => true;
    await sharedCtx.revertImageMotion('img_1');
    assert.deepStrictEqual([shared.images.img_1, shared.images[keep], plain(shared.imageMotions)], [PNG, PNG, {}]);
});

test('삽화 창에서 GIF로 바꾼 삽화를 지우면(그림 키가 빠짐) 다음에 그릴 때 그 기록과 간직한 원래 그림도 정리한다. 찾지 못한 그림 자리(키는 남음)는 기다린다', async () => {
    const X = 'img_1793836800123';
    const mod = motionLesson({
        tabContents: { basicLearn: `## 구조\n\n<div class="image-wrapper"><img src="local:${X}" alt="서버"></div>\n\n설명` },
        images: { [X]: PNG }, illustrations: [{ id: 'ill1', imgId: X, title: '서버', svg: '<svg/>' }]
    });
    const ctx = domContext(mod);
    // 삽화 창의 삭제가 부르는 실제 함수(course-illustrations.js placeIllustration·deleteIllustration)
    const ill = read('course-illustrations.js');
    ['const ILLUSTRATION_PLACE_NONE', 'const lessonArtTabMd', 'const ILLUSTRATION_BLOCKS'].forEach(start => vm.runInContext(sliceSource(ill, start, ';\n'), ctx));
    vm.runInContext(sliceSource(read('course-ncs-ref.js'), 'const withoutKey', ';\n'), ctx);
    ['function findIllustrationBlock(', 'function removeIllustrationMd(', 'function illustrationTab(', 'function updateIllustration(', 'function takeOutIllustration(', 'async function placeIllustration(']
        .forEach(start => vm.runInContext(sliceSource(ill, start), ctx));
    const still = ctx.applyImageMotionData(mod, X, PNG, GIF);
    await vm.runInContext('placeIllustration', ctx)(mod, 'ill1', 'basicLearn', '');
    mod.illustrations = mod.illustrations.filter(item => item.id !== 'ill1');
    assert.ok(!mod.tabContents.basicLearn.includes(X) && !(X in mod.images) && still in mod.images, '삽화 그림 키는 빠지고 원래 그림 사본과 기록이 남았다');
    ctx.document.getElementById('render-view').innerHTML = '<p>설명</p>';
    vm.runInContext('window.applyWhiteboardVideos', ctx)(mod);
    await flush();
    assert.deepStrictEqual([plain(mod.imageMotions), plain(Object.keys(mod.images))], [{}, []], '기록과 원래 그림을 정리한다(다음 저장에 들어간다)');
    // 그림 작업이 도는 동안에는 두었다가 끝난 뒤 정리한다
    const later = motionLesson();
    const laterCtx = domContext(later);
    const laterStill = laterCtx.applyImageMotionData(later, 'img_1', PNG, GIF);
    later.images = Object.fromEntries(Object.entries(later.images).filter(([key]) => key !== 'img_1'));
    laterCtx.pictureJobRunning = () => true;
    assert.strictEqual(laterCtx.settleImageMotions(later), 0);
    laterCtx.pictureJobRunning = () => false;
    assert.deepStrictEqual([laterCtx.settleImageMotions(later), plain(later.imageMotions), laterStill in later.images], [1, {}, false]);
    // 찾지 못한 그림 자리(따로 담은 백업에서 GIF 파일을 찾지 못함)는 그림 키가 남아 기록을 둔다
    const waiting = motionLesson();
    const waitingCtx = domContext(waiting);
    waitingCtx.applyImageMotionData(waiting, 'img_1', PNG, GIF);
    waiting.images.img_1 = 'teacher-image:0123456789abcdef1b';
    assert.deepStrictEqual([waitingCtx.settleImageMotions(waiting), Object.keys(waiting.imageMotions)], [0, ['img_1']]);
});

test('그림 정리(tabs.js): GIF 그림이 남는 동안 원래 그림 키를 남기고, GIF 그림이 빠지면 원래 그림과 기록도 함께 뺀다', () => {
    const mod = motionLesson();
    const ctx = apiContext(mod);
    const still = ctx.applyImageMotionData(mod, 'img_1', PNG, GIF);
    mod.images.img_old = PNG_B;
    const unused = m => plain(call(ctx, 'unusedLessonImageIds')(m));
    assert.deepStrictEqual(unused(mod), ['img_old'], '원래 그림은 글에 없어도 쓰는 그림');
    call(ctx, 'dropUnusedLessonImages')(mod);
    assert.deepStrictEqual(Object.keys(mod.images).sort(), ['img_1', still].sort());
    assert.ok(mod.imageMotions.img_1);
    // 다시 만들기로 그 그림이 글에서 빠지면 GIF·원래 그림·기록을 모두 덜어 낸다
    const regen = { ...mod, images: { ...mod.images }, tabContents: { basicLearn: null, basicPrac: '새 글' }, content: '' };
    assert.deepStrictEqual(unused(regen).sort(), ['img_1', still].sort());
    call(ctx, 'dropUnusedLessonImages')(regen);
    assert.deepStrictEqual([Object.keys(regen.images).length, plain(regen.imageMotions)], [0, {}]);
    // 고정 섹션(다시 넣을 글)이 GIF를 쓰면 함께 남긴다
    const locked = { ...mod, images: { ...mod.images }, tabContents: { basicLearn: null }, content: '' };
    call(ctx, 'dropUnusedLessonImages')(locked, ['## 고정\n\n![](local:img_1)']);
    assert.deepStrictEqual(Object.keys(locked.images).sort(), ['img_1', still].sort());
    assert.deepStrictEqual(unused({ images: { a: 1 }, imageMotions: 'x' }), ['a'], '모양이 틀린 기록은 건너뛴다');
    assert.deepStrictEqual(unused({ images: { a: 1 }, imageMotions: { a: null, b: { still: 7 } } }), ['a']);
    assert.ok(call(ctx, 'lessonStillUsesImage')(mod, still), '그림 지우기도 원래 그림을 쓰는 그림으로 본다');
});

test('그림 지우기(api.js): GIF로 바꾼 그림을 지우면 기록과 간직한 원래 그림도 지운다. 다른 탭이 쓰거나 그림 작업이 도는 동안은 남긴다', async () => {
    const mod = motionLesson();
    const ctx = apiContext(mod);
    const still = ctx.applyImageMotionData(mod, 'img_1', PNG, GIF);
    await call(ctx, 'deleteImage')('img_1');
    assert.ok(!mod.tabContents.basicLearn.includes('local:img_1'));
    assert.deepStrictEqual([Object.keys(mod.images).length, plain(mod.imageMotions)], [0, {}], `GIF·원래 그림(${still})·기록을 함께 지운다`);
    assert.ok(ctx.toasts.some(([text]) => text === '그림을 지웠습니다.'));
    const shared = motionLesson({ tabContents: { basicLearn: '![](local:img_1)', advLearn: '심화 ![](local:img_1)' } });
    const sharedCtx = apiContext(shared);
    const sharedStill = sharedCtx.applyImageMotionData(shared, 'img_1', PNG, GIF);
    await call(sharedCtx, 'deleteImage')('img_1');
    assert.deepStrictEqual([shared.images.img_1, shared.images[sharedStill], !!shared.imageMotions.img_1], [GIF, PNG, true], '다른 탭이 쓰면 모두 남긴다');
    const busy = motionLesson();
    const busyCtx = apiContext(busy);
    busyCtx.applyImageMotionData(busy, 'img_1', PNG, GIF);
    busyCtx.isVolumeFilling = () => true;
    await call(busyCtx, 'deleteImage')('img_1');
    assert.deepStrictEqual([Object.keys(busy.images).length, Object.keys(busy.imageMotions).length], [2, 1], '그림 작업이 도는 동안은 글에서만 뺀다');
    // 다른 그림을 지워도 원래 그림 키는 남는다(같은 값의 키를 모두 고르는 주소 지우기에서도)
    const twin = motionLesson({ tabContents: { basicLearn: '![](local:img_1)\n\n<img src="local:img_2">' }, images: { img_1: PNG, img_2: PNG_B } });
    const twinCtx = apiContext(twin);
    const twinStill = twinCtx.applyImageMotionData(twin, 'img_1', PNG, GIF);
    twin.images.img_2 = PNG; // 원래 그림과 같은 값의 다른 그림
    await call(twinCtx, 'deleteImage')(encodeURIComponent(PNG));
    assert.deepStrictEqual([twin.images[twinStill], !!twin.imageMotions.img_1, 'img_2' in twin.images], [PNG, true, false]);
});

/* ======================= 검사·저장·백업·휴지통·작업 기록 ======================= */
function recordedLesson() {
    return {
        id: 3, title: '차시', content: '![](local:img_1)', tabContents: { basicLearn: '![](local:img_1)' },
        images: { img_1: LONG_GIF, img_17938368000001: LONG_PNG },
        imageMotions: { img_1: { still: 'img_17938368000001', at: 1793836800000, sig: P.imageMotionSignature(LONG_GIF), patterns: ['hub'], summary: '서버 모델: 중심과 주변' } }
    };
}

test('검사(data-safety.js): 바른 기록은 같은 객체로 두고, 틀린 기록(키·원래 그림 없음·같은 키·겹친 원래 그림·지문 없음)은 빼며 모르는 칸과 긴 글은 줄인다', () => {
    const S = safetyContext();
    const lesson = recordedLesson();
    const records = lesson.imageMotions;
    assert.strictEqual(S.safeImageMotions(records, lesson.images), records);
    const images = { a: GIF, b: GIF_B, s1: PNG, s2: PNG_B, '(bad': PNG };
    const sig = P.imageMotionSignature(GIF);
    const out = plain(S.safeImageMotions({
        a: { still: 's1', at: 5, sig, patterns: ['hub', 'BAD', 7, 'mesh', 'tree', 'pairs', 'chain'], summary: 'x'.repeat(500), gif: GIF, extra: { deep: 1 } },
        b: { still: 's1', at: 1, sig, patterns: [], summary: '' },
        missing: { still: 's2', at: 1, sig, patterns: [], summary: '' },
        s2: { still: 's2', at: 1, sig, patterns: [], summary: '' },
        '(bad': { still: 's2', at: 1, sig, patterns: [], summary: '' },
        nosig: { still: 's2', at: 1, patterns: [] },
        odd: 'x'
    }, { ...images, missing: GIF, nosig: GIF, odd: GIF }));
    assert.deepStrictEqual(Object.keys(out), ['a']);
    assert.deepStrictEqual(out.a, { still: 's1', at: 5, sig, patterns: ['hub', 'mesh', 'tree', 'pairs'], summary: 'x'.repeat(120) });
    assert.deepStrictEqual(plain(S.safeImageMotions({ b: { still: 's2', sig, at: -1, summary: 3 } }, images)), { b: { still: 's2', at: 0, sig, patterns: [], summary: '3' } });
    assert.deepStrictEqual(plain(S.safeImageMotions({ s1: { still: 's2', sig }, s2: { still: 's1', sig } }, images)), {}, '원래 그림 키가 다른 기록의 GIF 키면 뺀다(서로 가리키면 둘 다)');
    assert.deepStrictEqual(plain(S.safeImageMotions('x', images)), {});
    // 그림 값을 고른 뒤에 본다: 바르지 않은 원래 그림 값이 빠지면 그 기록도 빠진다
    const broken = { ...recordedLesson(), images: { img_1: LONG_GIF, img_17938368000001: 'javascript:alert(1)' } };
    S.cleanLessonFields(broken);
    assert.deepStrictEqual([Object.keys(broken.images), plain(broken.imageMotions)], [['img_1'], {}]);
    const fine = recordedLesson();
    const kept = fine.imageMotions;
    S.cleanLessonFields(fine);
    assert.strictEqual(fine.imageMotions, kept, '바른 차시는 그대로');
});

test('저장·불러오기: 저장본(JSON)·백업 ZIP(따로 담기·함께)·PC 폴더(YAML)를 거쳐도 기록이 남고, 그림을 뺀 백업은 기록도 뺀다', () => {
    const S = safetyContext();
    const state = { courseTitle: '과정', subjects: [{ id: 's1', title: '교과', lessons: [recordedLesson()], mainQuest: { id: 'mainQuest', title: '최종 평가', content: null, images: {} } }] };
    const wanted = plain(state.subjects[0].lessons[0].imageMotions);
    const reloaded = S.sanitizeState(JSON.parse(JSON.stringify(state)));
    assert.deepStrictEqual(plain(reloaded.subjects[0].lessons[0].imageMotions), wanted, '브라우저 저장본');
    const { value, files } = S.window.detachBackupImages(plain(state), 'separate');
    const detached = value.subjects[0].lessons[0];
    assert.ok(Object.values(detached.images).every(ref => String(ref).startsWith('teacher-image:')) && Object.keys(files).length === 2, 'GIF와 원래 그림은 그림 파일로');
    assert.ok(Object.values(files).some(data => data.startsWith('data:image/gif')), 'GIF 그림 파일');
    assert.deepStrictEqual(plain(S.sanitizeState(plain(value)).subjects[0].lessons[0].imageMotions), wanted, '그림 파일을 찾기 전(참조)에도 기록을 둔다');
    const restored = S.sanitizeState(S.window.attachBackupImages(plain(value), files));
    assert.deepStrictEqual([plain(restored.subjects[0].lessons[0].imageMotions), restored.subjects[0].lessons[0].images.img_1], [wanted, LONG_GIF], '따로 담은 백업');
    const dropped = S.window.detachBackupImages(plain(state), 'none').value;
    assert.deepStrictEqual(plain(S.sanitizeState(dropped).subjects[0].lessons[0].imageMotions), {}, "'빼기' 백업은 그림이 없어 기록도 뺀다");
    const yaml = S.simpleYamlStringify({ state: plain(state), history: [] });
    assert.deepStrictEqual(plain(S.sanitizeState(S.simpleYamlParse(yaml).state).subjects[0].lessons[0].imageMotions), wanted, 'PC 폴더 save_data.yaml');
});

test('휴지통: 다시 만들기 전 사본은 기록까지 따로 복사하고, 되살리면 같은 검사를 거친다', () => {
    const S = safetyContext();
    const lesson = recordedLesson();
    const copy = vm.runInContext('copyLessonTree', S)(lesson);
    assert.notStrictEqual(copy.imageMotions, lesson.imageMotions);
    lesson.imageMotions = {};
    const back = S.cleanTrashLesson(copy);
    assert.deepStrictEqual(Object.keys(back.imageMotions), ['img_1']);
    const forged = S.cleanTrashLesson({ ...copy, imageMotions: { img_1: { still: 'img_none', sig: copy.imageMotions.img_1.sig } } });
    assert.deepStrictEqual(plain(forged.imageMotions), {}, '남이 준 휴지통의 틀린 기록은 뺀다');
});

test('작업 기록: 기록은 GIF와 원래 그림·기록을 함께 담고, 되돌리면 GIF가 돌아간 자리에만 기록을 넣으며, 새 차시로 되살려도 함께 간다', () => {
    const S = safetyContext();
    const lesson = recordedLesson();
    const entry = S.historyEntry(lesson, { id: 1, date: 'd', reason: '다시 생성 전' });
    assert.deepStrictEqual(Object.keys(entry.images).sort(), ['img_1', 'img_17938368000001']);
    assert.deepStrictEqual(plain(entry.imageMotions), plain(lesson.imageMotions));
    assert.notStrictEqual(entry.imageMotions.img_1, lesson.imageMotions.img_1, '기록은 차시와 이어지지 않는다');
    const tabItem = S.historyEntry({ title: '차시 · 기본학습', content: '![](local:img_1)', images: lesson.images, tabId: 'basicLearn', lesson }, { id: 2, subjectId: 's1' });
    assert.deepStrictEqual([Object.keys(tabItem.images).length, Object.keys(tabItem.imageMotions)], [2, ['img_1']], '탭 하나 기록도');
    assert.ok(!('imageMotions' in S.historyEntry({ title: '옛 글', content: '글' }, { id: 3 })), 'GIF가 없으면 칸을 만들지 않는다');
    assert.strictEqual(S.slimHistoryEntry(tabItem), tabItem, '줄여도 원래 그림은 남는다');
    const slim = S.slimHistoryEntry({ ...tabItem, images: { ...tabItem.images, img_9: PNG_B } });
    assert.deepStrictEqual([Object.keys(slim.images).sort(), Object.keys(slim.imageMotions)], [['img_1', 'img_17938368000001'], ['img_1']]);
    assert.strictEqual(S.cleanHistoryItem(entry), entry, '바른 기록은 그대로');
    const forged = S.cleanHistoryItem({ ...entry, imageMotions: { img_1: { still: 'img_none', sig: 'a-b' } } });
    assert.ok(!('imageMotions' in forged), '틀린 기록은 칸째 뺀다');
    // 되돌리기: 다시 만들어 그림이 빠진 차시에 그 기록을 돌려놓으면 GIF·원래 그림·기록이 함께 돌아온다
    const regenerated = { id: 3, title: '차시', content: '새 글', tabContents: { basicLearn: '새 글' }, images: {}, imageMotions: {} };
    S.applyHistoryEntry(regenerated, entry);
    assert.deepStrictEqual([regenerated.images.img_1, regenerated.images.img_17938368000001, Object.keys(regenerated.imageMotions)], [LONG_GIF, LONG_PNG, ['img_1']]);
    // 지금 그림을 그대로 두는 자리(다른 탭·교수안에서도 쓰는 새 그림)에는 기록을 넣지 않는다
    const keepsNew = { id: 3, title: '차시', content: '', tabContents: { basicLearn: '![](local:img_1)', basicPrac: '![](local:img_1)' }, images: { img_1: PNG_B } };
    S.applyHistoryEntry(keepsNew, { ...entry, tabId: 'basicLearn', tabContents: undefined });
    assert.deepStrictEqual([keepsNew.images.img_1, keepsNew.imageMotions], [PNG_B, undefined]);
    const revived = S.lessonFromHistory(entry, 9);
    assert.deepStrictEqual([revived.images.img_1, Object.keys(revived.imageMotions)], [LONG_GIF, ['img_1']]);
    assert.ok(!('imageMotions' in S.lessonFromHistory({ ...entry, images: { img_1: LONG_GIF } }, 10)), '원래 그림이 없는 기록은 넣지 않는다');
});

test('작업 기록 되돌리기: GIF 자리를 지금 그림으로 두면(다른 탭도 그 그림을 씀) 그 GIF의 원래 그림도 넣지 않는다(기록 없는 같은 값의 사본이 그림 키를 가로채지 않게)', () => {
    const S = safetyContext();
    const lesson = recordedLesson();
    const still = 'img_17938368000001';
    const entry = S.historyEntry({ title: '차시 · 기본학습', content: '![](local:img_1)', images: lesson.images, tabId: 'basicLearn', lesson }, { id: 2, date: 'd', subjectId: 's1' });
    assert.deepStrictEqual(Object.keys(entry.images).sort(), ['img_1', still]);
    // 그 뒤 강사가 원래 그림으로 되돌렸고(img_1은 원래 그림, 사본은 지워짐) 실습 탭도 그 그림을 쓴다
    const now = { id: 3, title: '차시', content: '', tabContents: { basicLearn: '![](local:img_1) 고친 글', basicPrac: '![](local:img_1) 실습' }, images: { img_1: LONG_PNG } };
    const plan = S.historyImagePlan(now, entry);
    assert.deepStrictEqual([plain(plan.kept), Object.keys(plan.images)], [['img_1'], []], 'GIF 자리는 지금 그림, 그 원래 그림도 넣지 않는다');
    S.applyHistoryEntry(now, entry);
    assert.deepStrictEqual([plain(Object.keys(now.images)), now.images.img_1, now.imageMotions, now.tabContents.basicLearn], [['img_1'], LONG_PNG, undefined, '![](local:img_1)']);
    assert.strictEqual(S.historyMatchesNow(now, entry, 'basicLearn'), true, '글이 같으면 원래 그림 사본 때문에 다르다고 하지 않는다');
    // GIF가 함께 돌아가면 원래 그림과 기록도 함께 돌아온다
    const emptied = { id: 3, title: '차시', content: '', tabContents: { basicLearn: '새 글' }, images: {} };
    S.applyHistoryEntry(emptied, entry);
    assert.deepStrictEqual([Object.keys(emptied.images).sort(), Object.keys(emptied.imageMotions)], [['img_1', still], ['img_1']]);
    // 기록 글이 그 키를 그림으로 쓰면 기록이 돌아가지 않아도 넣는다
    const pictured = { ...entry, content: `![](local:img_1) ![](local:${still})` };
    const keeps = { id: 3, title: '차시', content: '', tabContents: { basicLearn: '글', basicPrac: '![](local:img_1)' }, images: { img_1: LONG_PNG } };
    assert.deepStrictEqual(Object.keys(S.historyImagePlan(keeps, pictured).images), [still]);
});

test('내보내기·백업·불러오기의 그림 거르기를 GIF가 지나고, 교수안·슬라이드는 교수안의 옛 사본보다 바꾼 GIF를 쓴다(되돌리면 사본)', () => {
    const S = safetyContext();
    assert.ok(S.window.isSafeImageValue(LONG_GIF), '불러온 상태 검사(SAFE_IMAGE_DATA)');
    assert.ok(S.window.backupImageFile('0123456789abcdef01', LONG_GIF).name.endsWith('.gif'), '백업 그림 파일 이름(BACKUP_IMAGE_EXT)');
    assert.ok(S.window.isBackupImageName('0123456789abcdef01.gif'), '백업 그림 폴더에서 읽는 이름(BACKUP_IMAGE_NAME)');
    assert.ok(S.window.backupImageFromFile('0123456789abcdef01.gif', 'R0lG').dataUrl.startsWith('data:image/gif;base64,'));
    const ctx = { console: quiet };
    vm.createContext(ctx);
    vm.runInContext(sliceSource(read('output-import.js'), 'const OUTPUT_IMAGE_RE', ';\n'), ctx);
    assert.ok(vm.runInContext('OUTPUT_IMAGE_RE', ctx).test(LONG_GIF), '내보낸 교안 다시 불러오기(OUTPUT_IMAGE_RE)');
    const exporter = read('lesson-export.js');
    vm.runInContext(sliceSource(exporter, 'const EXPORT_PICTURE_RE', ';'), ctx);
    vm.runInContext(sliceSource(exporter, 'function inlineLessonImages('), ctx);
    assert.strictEqual(vm.runInContext('inlineLessonImages', ctx)('앞 ![](local:img_1) 뒤', { img_1: LONG_GIF }), `앞 ![](${LONG_GIF}) 뒤`, '화면·교안 HTML·PDF가 그림을 넣는 길');
    assert.ok(/^data:image\/\w+;base64,/.test(LONG_GIF), '교수안 슬라이드 그림 검사(kbuilder ref-images.js RASTER)와 같은 모양');
    // 교수안·슬라이드: 교수안을 만들 때 옮겨 둔 사본(gyosuan.images)보다 바꾼 GIF가 이긴다
    const mod = motionLesson({ gyosuan: { docMd: '![](local:img_1)', deckMd: '![](local:img_1)', images: { img_1: PNG } } });
    const api = apiContext(mod);
    vm.runInContext(sliceSource(read('gyosuan.js'), 'function gyosuanImageMap('), api);
    vm.runInContext(sliceSource(read('gyosuan.js'), 'function resolveGyosuanImages('), api);
    const resolve = () => call(api, 'resolveGyosuanImages')('![](local:img_1)', mod);
    assert.strictEqual(resolve(), `![](${PNG})`, '바꾸기 전에는 교수안 사본');
    api.applyImageMotionData(mod, 'img_1', PNG, GIF);
    assert.strictEqual(resolve(), `![](${GIF})`, '바꾼 뒤에는 GIF');
    mod.images = { ...mod.images, img_1: PNG_B }; // 다시 찾기로 바뀌어 기록이 낡았다
    assert.strictEqual(resolve(), `![](${PNG})`, '낡은 기록은 쓰지 않는다');
    mod.images = { ...mod.images, img_1: GIF };
    api.undoImageMotion(mod, 'img_1');
    assert.strictEqual(resolve(), `![](${PNG})`, '되돌리면 교수안 사본');
    assert.ok(read('gyosuan-view.js').includes('const images = gyosuanImageMap(mod);'), '교수안 HTML 내려받기도 같은 그림을 쓴다');
});

/* ======================= 그리기(캔버스) ======================= */
// 캔버스를 흉내 낸다: 그린 일을 적고, 점 배열은 고른 색으로 채워 돌려준다. naturalWidth·naturalHeight는 Image가 읽는 그림 크기
function canvasContext({ width: naturalWidth = 2000, height: naturalHeight = 1116, sizes = () => 1000 } = {}) {
    const drawn = [];
    const encoded = [];
    const canvases = [];
    const context2d = canvas => ({
        canvas, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, lineCap: '', lineJoin: '', imageSmoothingQuality: '',
        fillRect: () => drawn.push('fillRect'), drawImage: () => drawn.push('drawImage'),
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(235) }),
        save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
        arc(x, y, r) { drawn.push(['arc', Math.round(r * 10) / 10]); }, arcTo() { drawn.push('arcTo'); },
        stroke() { drawn.push(['stroke', this.strokeStyle]); }, fill() { drawn.push(['fill', this.fillStyle]); }
    });
    const ctx = {
        console: quiet, Math, JSON, Promise, Uint8Array, Uint8ClampedArray, setTimeout,
        document: {
            createElement: tag => {
                const canvas = { tag, width: 0, height: 0, toDataURL: (type, quality) => `data:${type};base64,${quality}` };
                canvas.getContext = () => context2d(canvas);
                canvases.push(canvas);
                return canvas;
            }
        },
        Image: class {
            set src(value) {
                this.loaded = value;
                this.naturalWidth = naturalWidth;
                this.naturalHeight = naturalHeight;
                setTimeout(() => (value.startsWith('data:image/') ? this.onload() : this.onerror()));
            }
        },
        dataUrlToInline: url => ({ mimeType: url.slice(5, url.indexOf(';')), data: url.slice(url.indexOf(',') + 1) }),
        gifBase64: bytes => `B${bytes.length}`,
        gifEncodeAnimation: async opts => {
            encoded.push({ width: opts.width, height: opts.height, frames: opts.frameCount, delay: opts.delay, fixed: opts.fixedColors.map(rgb => rgb.join(',')) });
            for (const i of [0, 3, 10, 18, 24]) await opts.frameAt(i); // 장면을 그려 본다
            await opts.onFrame(opts.frameCount, opts.frameCount);
            return { bytes: new Uint8Array(sizes(opts.width)), frames: 27 };
        }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['image-motion-plan.js', 'image-motion.js'].forEach(file => vm.runInContext(read(file), ctx));
    return { ctx, drawn, encoded, canvases };
}

test('GIF 만들기(캔버스): 가로 800(원래가 작으면 원래)으로 30장면을 그리고, 4MB를 넘으면 640·480으로 줄여 다시 만든다(그래도 넘으면 크기를 알린다)', async () => {
    const plan = sanitize(sampleAnswer());
    const MB = 1024 * 1024;
    const small = canvasContext({ sizes: () => 900000 });
    const ok = await small.ctx.imageMotionCanvas.render(PNG, plan, { patterns: ['auto', 'pairs'], delay: 14, onFrame: () => {} });
    assert.deepStrictEqual(plain(small.encoded.map(item => [item.width, item.height, item.frames, item.delay])), [[800, 446, 30, 14]]);
    assert.deepStrictEqual(plain(small.encoded[0].fixed), ['225,29,72', '5,150,105', '124,58,237', '255,255,255'], '점 색은 색표에 꼭 넣는다(밝은 그림)');
    assert.deepStrictEqual([ok.width, ok.height, ok.bytes, ok.frames, ok.reduced, ok.over, ok.dataUrl], [800, 446, 900000, 27, false, false, 'data:image/gif;base64,B900000']);
    assert.ok(small.drawn.some(item => Array.isArray(item) && item[0] === 'arc' && item[1] === 6.7), '점(반지름 가로/120)');
    assert.ok(small.drawn.some(item => Array.isArray(item) && item[0] === 'stroke' && item[1] === '#ffffff'), '점의 흰 테두리');
    assert.ok(small.drawn.includes('arcTo'), '닿은 요소의 둥근 테두리');
    const big = canvasContext({ sizes: width => (width > 480 ? 4.5 * MB : 3 * MB) });
    const reduced = await big.ctx.imageMotionCanvas.render(PNG, plan, {});
    assert.deepStrictEqual(plain(big.encoded.map(item => item.width)), [800, 640, 480]);
    assert.deepStrictEqual([reduced.width, reduced.height, reduced.reduced, reduced.over, big.encoded[0].delay], [480, 268, true, false, 10]);
    const huge = canvasContext({ sizes: () => 5 * MB });
    const over = await huge.ctx.imageMotionCanvas.render(PNG, plan, {});
    assert.deepStrictEqual([over.width, over.reduced, over.over, over.bytes], [480, true, true, 5 * MB]);
    const narrow = canvasContext({ width: 500, height: 300, sizes: () => 5 * MB });
    await narrow.ctx.imageMotionCanvas.render(PNG, plan, {});
    assert.deepStrictEqual(plain(narrow.encoded.map(item => item.width)), [500, 480], '작은 그림은 키우지 않고 더 작은 크기만 해 본다');
    let cancel = false;
    const stopped = canvasContext();
    const pending = stopped.ctx.imageMotionCanvas.render(PNG, plan, { cancelled: () => cancel });
    cancel = true;
    await assert.rejects(pending, error => error.name === 'AbortError', '창을 닫거나 다시 고르면 그리기를 멈춘다');
    await assert.rejects(canvasContext().ctx.imageMotionCanvas.render('teacher-image:0123456789abcdef1a', plan, {}), /그림을 읽지 못했습니다/);
});

test('GIF 만들기(캔버스): 4MB를 넘어 줄여 다시 만들 때는 장면 진행에 몇 번째 다시 만들기인지와 그 가로를 함께 넘기고, 크기 알림은 줄이지 않은 GIF에 줄였다고 하지 않는다', async () => {
    const plan = sanitize(sampleAnswer());
    const MB = 1024 * 1024;
    const steps = [];
    const big = canvasContext({ sizes: width => (width > 480 ? 4.5 * MB : 3 * MB) });
    await big.ctx.imageMotionCanvas.render(PNG, plan, { onFrame: (done, total, step) => steps.push([done, total, plain(step)]) });
    assert.deepStrictEqual(steps, [[30, 30, { attempt: 0, width: 800 }], [30, 30, { attempt: 1, width: 640 }], [30, 30, { attempt: 2, width: 480 }]]);
    const narrow = canvasContext({ width: 300, height: 1600, sizes: () => 7 * MB });
    const over = await narrow.ctx.imageMotionCanvas.render(PNG, plan, {});
    assert.deepStrictEqual([over.width, over.reduced, over.over], [300, false, true], '원래 가로 300이면 한 번만 만든다');
    const note = vm.runInContext('motionResultNote', narrow.ctx);
    assert.strictEqual(note(over), '가로 300px GIF가 7.0MB입니다(4MB 넘음). 바꾸면 저장 공간을 많이 씁니다.');
    assert.strictEqual(note({ width: 480, bytes: 5 * MB, reduced: true, over: true }), '가로 480px로 줄여도 5.0MB입니다(4MB 넘음). 바꾸면 저장 공간을 많이 씁니다.');
    assert.strictEqual(note({ width: 640, bytes: 3 * MB, reduced: true, over: false }), '4MB를 넘어 가로 640px로 줄여 만들었습니다(3.0MB).');
    assert.strictEqual(note({ width: 800, bytes: MB, reduced: false, over: false }), '');
});

test('AI에 보낼 그림: 긴 변 1600 이하의 PNG·JPEG·WebP·GIF는 그대로, 크거나 다른 형식은 흰 바탕에 줄여 JPEG로', async () => {
    const large = canvasContext({ width: 2000, height: 1116 });
    const sent = await large.ctx.imageMotionCanvas.inline(PNG);
    assert.deepStrictEqual(plain(sent), { mimeType: 'image/jpeg', data: '0.9' });
    const shrunk = large.canvases.at(-1);
    assert.deepStrictEqual([shrunk.width, shrunk.height], [1600, 893]);
    assert.ok(large.drawn.includes('fillRect') && large.drawn.includes('drawImage'), '흰 바탕 위에 그린다');
    const fits = canvasContext({ width: 1200, height: 700 });
    assert.deepStrictEqual(plain(await fits.ctx.imageMotionCanvas.inline(PNG)), { mimeType: 'image/png', data: 'QUFBQkJC' });
    assert.strictEqual(fits.canvases.length, 0, '줄이지 않으면 캔버스를 쓰지 않는다');
    const avif = await fits.ctx.imageMotionCanvas.inline('data:image/avif;base64,QUFB');
    assert.strictEqual(avif.mimeType, 'image/jpeg', 'AI가 받지 않을 수 있는 형식은 JPEG로');
});

/* ======================= 보기 화면의 버튼 ======================= */
test('보기 화면: 판서 영상 버튼을 단 진짜 그림 가운데 글이 그림 키로 가리키는 그림에 GIF 버튼(겹치지 않는 자리, 포커스에도 보임), 이 기능의 GIF에는 원래 그림으로. 판서 영상 그림·찾지 못한 그림·글에 값으로 쓴 그림에는 달지 않는다', async () => {
    const INLINE = 'data:image/png;base64,R0dH';
    const mod = {
        id: 7, title: '차시',
        tabContents: { basicLearn: `![](local:img_a) ![](local:img_b) ![](local:img_c) ![](local:img_d) ![](local:img_e) ![](local:img_f) ![g](${INLINE})` },
        images: { img_a: PNG, img_b: PNG_B, img_c: 'data:image/png;base64,Q0Q=', img_d: GIF, img_f: 'data:image/png;base64,RkY=', img_s: PNG_B, img_e: 'teacher-image:0123456789abcdef1a', img_old: 'data:image/png;base64,T0xE', img_g: INLINE },
        whiteboardVideos: { img_c: { id: 'wb_video000001', title: '판서', ext: 'mp4', at: 1 } },
        imageMotions: {
            img_d: { still: 'img_s', at: 1, sig: P.imageMotionSignature(GIF), patterns: ['hub'], summary: '' }, // 원래 그림이 img_b와 같은 값
            img_f: { still: 'img_old', at: 1, sig: P.imageMotionSignature(GIF_B), patterns: [], summary: '' } // 그사이 다시 찾기로 바뀐 그림
        }
    };
    const ctx = domContext(mod);
    const view = ctx.document.getElementById('render-view');
    const frame = (src, id) => `<div class="image-wrapper"><img src="${src}"><button class="image-regenerate-btn" data-lesson-action="regenerate-image" data-img-id="${id}">다시 찾기</button></div>`;
    view.innerHTML = [
        frame(PNG, 'img_a'),
        `<div class="relative group my-6 flex justify-center" data-imgid="x"><img src="${PNG_B}"></div>`,
        frame('data:image/png;base64,Q0Q=', 'img_c'),
        frame(GIF, 'img_d'),
        frame('', 'img_e'),
        frame('data:image/png;base64,RkY=', 'img_f'),
        `<div class="relative group my-6 flex justify-center" data-imgid="y"><img src="${INLINE}"></div>`
    ].join('');
    const apply = vm.runInContext('window.applyWhiteboardVideos', ctx);
    apply(mod);
    await flush();
    const holders = [...view.children];
    const actions = holders.map(holder => [...holder.querySelectorAll('[data-lesson-action]')].map(el => el.getAttribute('data-lesson-action')).filter(action => action !== 'regenerate-image'));
    assert.deepStrictEqual(actions, [
        ['whiteboard-video', 'image-motion'],
        ['whiteboard-video', 'image-motion'],
        ['whiteboard-video'], // 판서 영상 그림(파일이 없어 다시 만들기 버튼만)
        ['whiteboard-video', 'image-motion-revert'],
        [],
        ['whiteboard-video', 'image-motion'],
        ['whiteboard-video'] // 글에 그림 값을 바로 쓴 그림: GIF로 바꿔도 화면이 바뀌지 않는다
    ]);
    assert.deepStrictEqual([...holders[1].querySelectorAll('[data-img-id]')].map(el => el.getAttribute('data-img-id')), ['img_b', 'img_b'], '같은 값의 원래 그림 키(img_s)가 아니라 그 그림의 키');
    const gifButton = holders[0].querySelector('[data-lesson-action="image-motion"]');
    const whiteboard = holders[0].querySelector('[data-lesson-action="whiteboard-video"]');
    assert.strictEqual(gifButton.getAttribute('data-img-id'), 'img_a');
    assert.ok(gifButton.textContent.includes('움직이는 GIF로') && gifButton.innerHTML.includes('ph-gif'));
    ['bottom-12', 'left-1/2', '-translate-x-1/2', 'z-10', 'opacity-0', 'group-hover:opacity-100', 'group-focus-within:opacity-100', 'focus:opacity-100']
        .forEach(name => assert.ok(gifButton.classList.contains(name), name));
    assert.ok(whiteboard.classList.contains('bottom-3') && !whiteboard.classList.contains('bottom-12'), '판서 영상 버튼은 그대로 아래(bottom-3), GIF 버튼은 그 위(bottom-12)');
    assert.strictEqual(gifButton.getAttribute('type'), 'button');
    const revert = holders[3].querySelector('[data-lesson-action="image-motion-revert"]');
    assert.ok(revert.getAttribute('data-img-id') === 'img_d' && revert.textContent.includes('원래 그림으로'));
    assert.deepStrictEqual([plain(Object.keys(mod.imageMotions)), 'img_old' in mod.images, mod.images.img_f], [['img_d'], false, 'data:image/png;base64,RkY='], '낡은 기록은 그릴 때 정리한다(다음 저장에 들어간다)');
    apply(mod);
    await flush();
    assert.strictEqual(view.querySelectorAll('[data-lesson-action^="image-motion"]').length, 4, '다시 그려도 버튼이 겹쳐 쌓이지 않는다');
    assert.deepStrictEqual(Object.keys(ctx.LESSON_ACTIONS).sort(), ['image-motion', 'image-motion-revert', 'whiteboard-revert', 'whiteboard-video']);
    const exportControls = '[data-lesson-action], .image-regenerate-btn, .image-wrapper > span, .para-edit, button, textarea';
    assert.ok(read('lesson-export.js').includes(`const EXPORT_CONTROLS = '${exportControls}';`));
    assert.ok([...view.querySelectorAll('[data-lesson-action^="image-motion"]')].every(el => el.matches(exportControls)), '내보내기에서 빠진다');
    ctx.openImageMotion('img_s');
    ctx.openImageMotion('img_g');
    assert.deepStrictEqual(ctx.toasts.map(([text]) => text.includes('GIF로 바꿀 수 없습니다') || text.includes('그림 값이 바로 들어 있어')), [true, true], '원래 그림 키·글에 값으로 쓴 그림은 열지 않는다');
});

test('보기 화면: 같은 값의 그림 키가 여럿이면 글이 가리키는 키에 판서 영상·GIF 버튼을 단다(기록을 잃은 원래 그림 사본처럼 글에 없는 키가 가로채지 않는다)', async () => {
    const copy = 'img_17940000000001'; // 기록 없이 남은 원래 그림 사본(예전 작업에서 남은 것)
    const mod = motionLesson({ tabContents: { basicLearn: PASTED }, images: { img_1: PNG, [copy]: PNG } });
    const ctx = domContext(mod);
    const view = drawPasted(ctx, mod);
    await flush();
    assert.deepStrictEqual(actionsIn(view), ['whiteboard-video=img_1', 'image-motion=img_1']);
    const ids = mod2 => plain([...vm.runInContext('whiteboardImageIds', ctx)(mod2).entries()]);
    assert.deepStrictEqual(ids({ ...mod, images: { [copy]: PNG, img_1: PNG } }), [[PNG, 'img_1']], '차례와 상관없이 글이 가리키는 키');
    assert.deepStrictEqual(ids({ ...mod, tabContents: { basicLearn: `${PASTED} <img src="local:${copy}">` } }), [[PNG, copy]], '둘 다 가리키면 예전처럼 뒤의 키');
    assert.deepStrictEqual(ids({ ...mod, tabContents: { basicLearn: '글' } }), [[PNG, copy]], '둘 다 가리키지 않아도 뒤의 키');
});

/* ======================= 'GIF 만들기' 창 ======================= */
test('창: 그림 미리 보기·요청 칸·AI 1번 안내로 열고, 관계를 읽어(그림은 inlineData, JSON만) GIF를 보인 뒤 움직임·빠르기를 바꿔도 AI를 다시 부르지 않고, 바꾸면 저장하고 다시 그린다', async () => {
    const mod = motionLesson();
    const ctx = domContext(mod, { replies: [aiReply(sampleAnswer())] });
    const overlay = openDialog(ctx, 'img_1');
    assert.ok(overlay, '창이 뜬다');
    const panel = overlay.querySelector('[data-app-dialog-panel]');
    assert.deepStrictEqual([panel.getAttribute('role'), panel.getAttribute('aria-modal')], ['dialog', 'true']);
    assert.strictEqual(overlay.querySelector('[data-app-dialog-title]').textContent.trim(), '움직이는 GIF 만들기');
    assert.strictEqual(part(overlay, 'preview').getAttribute('src'), PNG);
    assert.strictEqual(part(overlay, 'instruction').getAttribute('placeholder'), '어떻게 움직이면 좋을지 적어 주세요(선택) — 예: 서버가 요청을 받고 응답하는 흐름');
    assert.ok(overlay.textContent.includes('AI 호출 1번') && overlay.textContent.includes('이 브라우저에서 만듭니다'));
    assert.strictEqual(part(overlay, 'start').textContent.trim(), '관계 읽고 GIF 만들기');
    assert.deepStrictEqual([shown(part(overlay, 'start')), shown(part(overlay, 'apply')), shown(part(overlay, 'reread'))], [true, false, false]);
    ctx.openImageMotion('img_1');
    assert.strictEqual([...ctx.document.body.children].filter(el => el.querySelector?.('[data-motion-start]')).length, 1, '창은 하나만');
    part(overlay, 'instruction').value = '서버가 요청을 받고 응답하는 흐름';
    part(overlay, 'start').click();
    await flush();
    assert.strictEqual(ctx.calls.length, 1);
    const payload = ctx.calls[0];
    assert.strictEqual(payload.generationConfig.responseMimeType, 'application/json');
    assert.strictEqual(payload.taskRole, 'plan');
    assert.ok(payload.signal && typeof payload.signal.aborted === 'boolean', '중지 신호를 넘긴다');
    assert.deepStrictEqual(plain(payload.contents[0].parts[1]), { inlineData: { mimeType: 'image/png', data: 'QUFB' } });
    assert.ok(payload.contents[0].parts[0].text.includes('서버가 요청을 받고 응답하는 흐름'), '요청 칸의 글을 참고로 보낸다');
    assert.deepStrictEqual(plain(ctx.renders), [{ source: PNG, groups: ['서버 모델', 'P2P 구조'], patterns: ['auto', 'auto'], delay: 10 }]);
    assert.strictEqual(part(overlay, 'preview').getAttribute('src'), GIF);
    assert.ok(part(overlay, 'info').textContent.includes('GIF 1.5MB') && part(overlay, 'info').textContent.includes('장면 24개'), part(overlay, 'info').textContent);
    assert.deepStrictEqual([shown(part(overlay, 'start')), shown(part(overlay, 'apply')), shown(part(overlay, 'reread'))], [false, true, true]);
    const selects = [...overlay.querySelectorAll('[data-motion-pattern]')];
    assert.strictEqual(selects.length, 2);
    assert.deepStrictEqual([...selects[0].querySelectorAll('option')].map(option => option.textContent), ['자동(중심과 주변)', '중심과 주변', '서로 연결', '차례 흐름', '순환', '나무 구조', '짝 주고받기']);
    assert.deepStrictEqual([...part(overlay, 'speed').querySelectorAll('option')].map(option => [option.getAttribute('value'), option.textContent]), [['14', '느리게'], ['10', '보통'], ['7', '빠르게']]);
    choose(ctx, selects[1], 'pairs');
    await flush();
    choose(ctx, part(overlay, 'speed'), '7');
    await flush();
    assert.deepStrictEqual(plain(ctx.renders.slice(1).map(item => [item.patterns, item.delay])), [[['auto', 'pairs'], 10], [['auto', 'pairs'], 7]]);
    assert.strictEqual(ctx.calls.length, 1, '다시 만들 때 AI를 부르지 않는다');
    part(overlay, 'apply').click();
    await flush();
    assert.strictEqual(mod.images.img_1, GIF);
    const record = mod.imageMotions.img_1;
    assert.deepStrictEqual([mod.images[record.still], plain(record.patterns), record.summary], [PNG, ['hub', 'pairs'], '서버 모델: 중심과 주변 · P2P 구조: 짝 주고받기']);
    assert.strictEqual(mod.tabContents.basicLearn, '## 구조\n\n![서버와 P2P](local:img_1)\n\n설명 글', '교안 글은 그대로');
    assert.deepStrictEqual([ctx.saves, ctx.rendered, overlay.isConnected], [1, 1, false]);
    assert.deepStrictEqual(ctx.toasts.at(-1), ['움직이는 GIF로 바꿨습니다. 차시 글은 그대로입니다.', 'success']);
    // GIF가 된 그림은 다시 열지 않는다(원래 그림으로 되돌린 뒤)
    ctx.openImageMotion('img_1');
    assert.ok(ctx.toasts.at(-1)[0].includes('이미 움직이는 GIF입니다'));
    // 원래 그림으로
    await ctx.revertImageMotion('img_1');
    assert.deepStrictEqual([mod.images.img_1, Object.keys(mod.imageMotions).length, ctx.saves], [PNG, 0, 2]);
    assert.deepStrictEqual(ctx.toasts.at(-1), ['원래 그림으로 되돌렸습니다.', 'success']);
});

test('창: 관계를 찾지 못하면 창을 열어 둔 채 알리고, 요청을 적어 다시 읽을 수 있다. AI가 실패해도 창은 열려 있다', async () => {
    const mod = motionLesson();
    const ctx = domContext(mod, { replies: [aiReply('{"groups":[]}'), () => { throw new Error('호출 한도를 넘었습니다.'); }, aiReply(sampleAnswer())] });
    const overlay = openDialog(ctx, 'img_1');
    part(overlay, 'start').click();
    await flush();
    assert.ok(overlay.isConnected);
    assert.ok(part(overlay, 'status').textContent.includes('이어진 요소를 찾지 못했습니다') && part(overlay, 'status').textContent.includes('다시 읽어'), part(overlay, 'status').textContent);
    assert.deepStrictEqual([shown(part(overlay, 'start')), shown(part(overlay, 'apply')), part(overlay, 'start').disabled], [true, false, false]);
    assert.strictEqual(ctx.renders.length, 0);
    part(overlay, 'start').click();
    await flush();
    assert.ok(part(overlay, 'status').textContent.includes('호출 한도를 넘었습니다'), part(overlay, 'status').textContent);
    assert.ok(overlay.isConnected && !part(overlay, 'instruction').disabled);
    part(overlay, 'instruction').value = '왼쪽은 서버와 클라이언트, 오른쪽은 서로 이어진 컴퓨터';
    part(overlay, 'start').click();
    await flush();
    assert.strictEqual(ctx.calls.length, 3);
    assert.ok(ctx.calls[2].contents[0].parts[0].text.includes('왼쪽은 서버와 클라이언트'));
    assert.deepStrictEqual([ctx.renders.length, shown(part(overlay, 'apply'))], [1, true]);
    // 다시 읽기가 실패해도 앞서 만든 GIF는 그대로 둔다
    ctx.replies.push(aiReply('not json'));
    part(overlay, 'reread').click();
    await flush();
    assert.deepStrictEqual([shown(part(overlay, 'apply')), part(overlay, 'preview').getAttribute('src')], [true, GIF]);
    assert.ok(part(overlay, 'status').textContent.includes('찾지 못했습니다'));
    assert.strictEqual(mod.images.img_1, PNG, '바꾸기를 누르기 전에는 차시를 바꾸지 않는다');
});

test('창: 기다리는 동안 다른 차시로 옮기거나 그림이 바뀌면 바꾸지 않고 알리며, 닫으면 AI 호출을 끊는다. 키가 없으면 부르지 않는다', async () => {
    const mod = motionLesson();
    const other = motionLesson({ id: 8 });
    let release;
    const ctx = domContext(mod, { replies: [() => new Promise(resolve => { release = resolve; })] });
    const overlay = openDialog(ctx, 'img_1');
    part(overlay, 'start').click();
    await flush();
    assert.ok(part(overlay, 'start').disabled && part(overlay, 'instruction').disabled, '읽는 동안은 막는다');
    assert.ok(part(overlay, 'status').textContent.includes('읽고 있습니다'));
    overlay.click(); // 읽는 동안 바깥을 눌러도 닫지 않는다
    assert.ok(overlay.isConnected);
    ctx.currentMod = other; // 다른 차시를 열었다
    release(aiReply(sampleAnswer()));
    await flush();
    assert.strictEqual(ctx.renders.length, 0, 'GIF를 만들지 않는다');
    assert.ok(part(overlay, 'status').textContent.includes('다른 차시나 탭으로 옮겼거나'));
    assert.deepStrictEqual([shown(part(overlay, 'start')), shown(part(overlay, 'apply')), shown(part(overlay, 'reread'))], [false, false, false]);
    assert.strictEqual(mod.images.img_1, PNG);
    part(overlay, 'cancel').click();
    assert.ok(!overlay.isConnected);

    const changed = motionLesson();
    const ctx2 = domContext(changed, { replies: [() => { changed.images = { ...changed.images, img_1: PNG_B }; return aiReply(sampleAnswer()); }] });
    const overlay2 = openDialog(ctx2, 'img_1');
    part(overlay2, 'start').click();
    await flush();
    assert.ok(part(overlay2, 'status').textContent.includes('그 그림이 바뀌어'));
    assert.strictEqual(ctx2.renders.length, 0);

    // 미리 본 뒤 탭을 옮기고 바꾸기를 누르면 바꾸지 않는다
    const moved = motionLesson();
    const ctx3 = domContext(moved, { replies: [aiReply(sampleAnswer())] });
    const overlay3 = openDialog(ctx3, 'img_1');
    part(overlay3, 'start').click();
    await flush();
    ctx3.currentLessonTab = 'basicPrac';
    part(overlay3, 'apply').click();
    await flush();
    assert.deepStrictEqual([moved.images.img_1, moved.imageMotions, ctx3.saves], [PNG, undefined, 0]);
    assert.ok(part(overlay3, 'status').textContent.includes('다른 차시나 탭으로 옮겼거나'));

    let signal = null;
    const closing = motionLesson();
    const ctx4 = domContext(closing, { replies: [payload => { signal = payload.signal; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('중지했습니다.'), { name: 'AbortError' })))); }] });
    const overlay4 = openDialog(ctx4, 'img_1');
    part(overlay4, 'start').click();
    await flush();
    part(overlay4, 'cancel').click();
    await flush();
    assert.deepStrictEqual([signal.aborted, overlay4.isConnected, ctx4.renders.length, closing.images.img_1], [true, false, 0, PNG]);
    const again = openDialog(ctx4, 'img_1');
    assert.ok(again && again.isConnected, '닫은 뒤에는 다시 열린다');

    const noKey = domContext(motionLesson(), { keyOk: false });
    const overlay5 = openDialog(noKey, 'img_1');
    part(overlay5, 'start').click();
    await flush();
    assert.strictEqual(noKey.calls.length, 0);
    assert.ok(part(overlay5, 'status').textContent.includes('AI 키가 없어'));

    const video = domContext(motionLesson({ whiteboardVideos: { img_1: { id: 'wb_1' } } }));
    video.openImageMotion('img_1');
    assert.ok(video.toasts.at(-1)[0].includes('판서 영상으로 바꾼 그림'));
    const missing = domContext(motionLesson({ images: { img_1: 'teacher-image:0123456789abcdef1a' } }));
    missing.openImageMotion('img_1');
    assert.ok(missing.toasts.at(-1)[0].includes('GIF로 바꿀 수 없습니다'));
});

test('창: 4MB를 넘어 줄여 다시 만드는 동안 장면 수가 처음부터 다시 세어지는 까닭을 보이고, 줄이지 않은 GIF가 4MB를 넘으면 줄였다고 하지 않는다', async () => {
    const mod = motionLesson();
    const ctx = domContext(mod, { replies: [aiReply(sampleAnswer())] });
    const seen = [];
    ctx.imageMotionCanvas.render = async (source, plan, opts) => {
        const status = () => ctx.document.querySelector('[data-motion-status]').textContent;
        opts.onFrame(12, 30, { attempt: 0, width: 300 });
        seen.push(status());
        opts.onFrame(5, 30, { attempt: 1, width: 640 });
        seen.push(status());
        return { dataUrl: GIF, bytes: 7 * 1024 * 1024, frames: 30, width: 300, height: 1600, reduced: false, over: true };
    };
    const overlay = openDialog(ctx, 'img_1');
    part(overlay, 'start').click();
    await flush();
    assert.deepStrictEqual(seen, ['움직이는 GIF를 만들고 있습니다… (12/30)', '4MB를 넘어 가로 640px로 다시 만들고 있습니다… (5/30)']);
    assert.strictEqual(part(overlay, 'status').textContent, '가로 300px GIF가 7.0MB입니다(4MB 넘음). 바꾸면 저장 공간을 많이 씁니다.');
    assert.ok(!part(overlay, 'status').textContent.includes('줄여도'));
    assert.ok(shown(part(overlay, 'apply')), '크기를 알리고 바꾸기는 강사가 고른다');
});

test('창: 버튼 줄은 스크롤되는 창 칸 아래 끝에 붙어, 낮은 화면(1366x768 노트북 등)에서 미리 보기를 만든 뒤에도 바꾸기·다시 읽기·취소가 바로 보인다', async () => {
    const mod = motionLesson();
    const ctx = domContext(mod, { replies: [aiReply(sampleAnswer())] });
    const overlay = openDialog(ctx, 'img_1');
    const panel = overlay.querySelector('[data-app-dialog-panel]');
    const panelClasses = panel.className.split(/\s+/);
    assert.ok(panelClasses.includes('overflow-y-auto') && panelClasses.includes('p-6'), panel.className);
    const row = part(overlay, 'start').parentElement;
    assert.strictEqual(row.parentElement, panel, '버튼 줄은 스크롤되는 창 칸 바로 안에 있다');
    ['cancel', 'reread', 'apply'].forEach(name => assert.strictEqual(part(overlay, name).parentElement, row, `${name}도 같은 줄`));
    const rowClasses = row.className.split(/\s+/);
    // 창 칸 여백(p-6)만큼 펴서 창 아래 끝에 닿고(브라우저는 붙는 자리를 창 칸 여백 안쪽에서 잰다), 창 칸과 같은 바탕색으로 밑으로 지나가는 내용을 가린다
    ['sticky', '-bottom-6', '-mx-6', '-mb-6', 'px-6', 'pb-6'].forEach(name => assert.ok(rowClasses.includes(name), `${name}: ${row.className}`));
    const background = panelClasses.find(name => name.startsWith('bg-['));
    assert.ok(background && rowClasses.includes(background), `창 칸과 같은 바탕색: ${row.className}`);
    part(overlay, 'start').click();
    await flush();
    assert.deepStrictEqual([shown(part(overlay, 'apply')), shown(part(overlay, 'reread')), shown(part(overlay, 'cancel'))], [true, true, true]);
    assert.strictEqual(part(overlay, 'apply').parentElement, row, '만든 뒤의 바꾸기 버튼도 붙은 줄에 있다');
    // 창의 Tab 처리는 굴리지 않으므로, 포커스를 받은 칸(버튼 줄 밖)은 창 칸을 굴려 버튼 줄 위로 보인다(창 칸의 scroll-pb-20만큼 띄운다). 버튼 줄의 버튼은 굴리지 않는다
    assert.ok(panelClasses.includes('scroll-pb-20'), panel.className);
    const scrolled = [];
    const focusIn = el => {
        el.scrollIntoView = options => scrolled.push([el.getAttribute('data-motion-speed') !== null ? 'speed' : el.hasAttribute('data-motion-instruction') ? 'instruction' : el.textContent.trim(), options]);
        const event = ctx.document.createEvent('Event');
        event.initEvent('focusin', true, true);
        el.dispatchEvent(event);
    };
    [part(overlay, 'speed'), part(overlay, 'instruction'), part(overlay, 'apply'), part(overlay, 'cancel')].forEach(focusIn);
    assert.deepStrictEqual(plain(scrolled), [['speed', { block: 'nearest' }], ['instruction', { block: 'nearest' }]]);
});

(async () => {
    if (domino) {
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
