// 본문 블록 옆 접기·지우기 단추 테스트 (실행: node tests/block-tools.test.js)
// 실제 block-tools.js·api.js(보기 화면)·lesson-format.js·lesson-opening.js·image-slot-place.js·lesson-review.js(작업 기록)·format-toolbar.js(Ctrl+Z)를 vm에서 돌린다.
// 보기 화면은 domino로 흉내 내고 블록 자리는 getBoundingClientRect로 정한다(tests/tool-video-text.test.js와 같은 흉내).
// 처음 한 번: npm install --no-save marked@15.0.12 turndown@7.2.4
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

let Marked = null;
let domino = null;
let NodeFilter = null;
try {
    ({ Marked } = require('marked'));
    domino = require('@mixmark-io/domino');
    NodeFilter = require('@mixmark-io/domino/lib/NodeFilter');
} catch (err) {
    console.log('FAIL - marked·domino가 없습니다. 먼저 실행: npm install --no-save marked@15.0.12 turndown@7.2.4');
    process.exit(1);
}

const root = path.join(__dirname, '..', 'js');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const FILES = ['data.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js',
    'lesson-review.js', 'lesson-sanitize.js', 'lesson-format.js', 'lesson-export.js', 'format-toolbar.js', 'md-toolbar.js',
    'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js', 'image-slot-place.js', 'block-tools.js'];

function sliceSource(source, start, end = '\n}\n') {
    const at = source.indexOf(start);
    if (at < 0) throw new Error(`소스에서 찾지 못함: ${start}`);
    return source.slice(at, source.indexOf(end, at) + end.length);
}

/* ---------- domino 보완: 목록 반복, dataset, 화면 자리(테스트가 정한 _rect) ---------- */
const toAttr = key => `data-${String(key).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
function iterableList(proto) {
    if (!proto.forEach) Object.defineProperty(proto, 'forEach', { configurable: true, value(fn, self) { for (let i = 0; i < this.length; i++) fn.call(self, this.item(i), i, this); } });
    if (!proto[Symbol.iterator]) Object.defineProperty(proto, Symbol.iterator, { configurable: true, * value() { for (let i = 0; i < this.length; i++) yield this.item(i); } });
}
function patchDomino(doc) {
    [doc.querySelectorAll('x'), doc.body.children, doc.body.childNodes, doc.createElement('div').querySelectorAll('x')].forEach(list => iterableList(Object.getPrototypeOf(list)));
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
    if (!Object.getOwnPropertyDescriptor(htmlProto, 'hidden')) {
        Object.defineProperty(htmlProto, 'hidden', {
            configurable: true,
            get() { return this.hasAttribute('hidden'); },
            set(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
        });
    }
    if (!htmlProto.getBoundingClientRect) {
        Object.defineProperty(htmlProto, 'getBoundingClientRect', { configurable: true, value() { return this._rect || { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; } });
    }
}

// 보기 화면의 블록을 위에서부터 높이 60, 사이 20으로 놓는다(맨 위 100)
function layout(view) {
    let y = 100;
    for (const el of view.children) {
        el._rect = { top: y, bottom: y + 60, left: 100, right: 900, width: 800, height: 60 };
        y += 80;
    }
    view._rect = { top: 100, bottom: y, left: 100, right: 900, width: 800, height: y - 100 };
}

function ownMarked() {
    const instance = new Marked();
    return { parse: (...args) => instance.parse(...args), use: (...args) => instance.use(...args), lexer: (...args) => instance.lexer(...args) };
}

const LESSON = [
    '# 📝 게임 루프',
    '',
    '## 학습 목표',
    '',
    '- 게임 루프를 설명할 수 있습니다.',
    '',
    '## 1. 게임 루프의 구조',
    '',
    '게임 루프는 입력, 갱신, 그리기를 매 프레임 되풀이합니다.',
    '',
    '<br>',
    '',
    '지울 문단입니다. 이 문단은 X 단추로 지웁니다.',
    '',
    '<br>',
    '',
    '```js',
    '// 매 프레임 부르는 함수',
    'function update() {}',
    '```',
    '',
    '## 2. 레벨 디자인',
    '',
    '레벨은 플레이어가 지나가는 길입니다.',
    ''
].join('\n');

const tabsOf = basicLearn => ({ basicLearn, basicPrac: null, advLearn: null, advPrac: null, assessment: '## 학습이해도\n\n게임 루프가 하는 일을 고르세요.\n', advAssessment: null });
const lesson = (md = LESSON, extra = {}) => ({ id: 7, title: '게임 루프', tabContents: tabsOf(md), content: md, images: {}, ...extra });

function toolContext(mod, { tabId = 'basicLearn' } = {}) {
    const doc = domino.createDocument([
        '<html><body>',
        '<div id="editor-content-area"><div id="lesson-page"><div id="render-view" class="markdown-body"></div><textarea id="raw-view" class="hidden"></textarea></div></div>',
        '</body></html>'
    ].join(''), true);
    patchDomino(doc);
    const ctx = {
        console: quiet, document: doc, Promise, URL, Blob, AbortController, Proxy, setTimeout, clearTimeout, atob, btoa, Uint8Array, ArrayBuffer,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        marked: ownMarked(), NodeFilter, innerWidth: 1400,
        DOMParser: function DOMParser() { this.parseFromString = html => domino.createDocument(String(html), true); },
        currentMod: mod, toasts: [], alerts: [], archived: [], saves: 0, rendered: 0
    };
    ctx.window = ctx;
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.saveState = async () => { ctx.saves += 1; return true; };
    ctx.archiveContent = async (entry, reason) => { ctx.archived.push({ content: entry.content, tabId: entry.tabId, reason }); };
    ctx.renderSidebar = () => {};
    ctx.syncGyosuanView = () => {};
    ctx.DBManager = { getCache: async () => null, setCache: async () => {} };
    vm.createContext(ctx);
    vm.runInContext(sliceSource(read('ui.js'), 'function escapeHtml('), ctx);
    FILES.forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    vm.runInContext(`globalState = { subjects: [{ id: 's1', title: '교과', lessons: [window.currentMod] }] }; currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons;
        currentEditingModuleId = window.currentMod.id; currentLessonTab = ${JSON.stringify(tabId)}; _lessonPanel = null;
        getEditingModule = (id = currentEditingModuleId) => (String(id) === String(window.currentMod?.id) ? window.currentMod : null);
        renderEditor = mod => { window.rendered += 1; window.drawView(mod); }; renderSidebar = () => {};`, ctx);
    ctx.drawView = target => {
        const raw = doc.getElementById('raw-view');
        raw.value = vm.runInContext('getActiveTabSource', ctx)(target);
        raw.setAttribute('data-module-id', String(target.id));
        raw.setAttribute('data-tab-id', vm.runInContext('currentLessonTab', ctx));
        vm.runInContext("toggleEditorMode('view')", ctx);
        layout(doc.getElementById('render-view'));
    };
    ctx.drawView(mod);
    return ctx;
}

const call = (ctx, name) => vm.runInContext(name, ctx);
const viewOf = ctx => ctx.document.getElementById('render-view');
function block(ctx, text) {
    const found = [...viewOf(ctx).children].find(el => (el.textContent || '').includes(text));
    if (!found) throw new Error(`화면 블록을 찾지 못함: ${text}`);
    return found;
}
function fire(ctx, target, type, props = {}) {
    const event = ctx.document.createEvent('Event');
    event.initEvent(type, true, true);
    Object.assign(event, props);
    target.dispatchEvent(event);
    return event;
}
const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(resolve => setImmediate(resolve)); };
const stored = (mod, tabId = 'basicLearn') => mod.tabContents[tabId];
const bar = ctx => ctx.document.getElementById('block-tools');
const tool = (ctx, name) => bar(ctx).querySelector(`[data-block-tool="${name}"]`);

// 블록에 마우스를 올려 단추를 띄우고 그 단추를 누른다
async function press(ctx, el, name) {
    fire(ctx, el, 'mousemove');
    assert.ok(bar(ctx) && !bar(ctx).hidden, '단추 묶음이 떴다');
    fire(ctx, tool(ctx, name), 'click');
    await settle();
}

let failed = 0;
let count = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

/* ======================= 단추 띄우기 ======================= */
test('단추: 글 블록에 마우스를 올리면 그 블록 오른쪽 여백에 접기·지우기 단추가 뜬다', () => {
    const ctx = toolContext(lesson());
    const para = block(ctx, '지울 문단입니다');
    fire(ctx, para, 'mousemove');
    assert.ok(!bar(ctx).hidden);
    assert.strictEqual(bar(ctx).style.left, `${900 + 6}px`, '블록 오른쪽 끝 + 6px');
    assert.strictEqual(bar(ctx).style.top, `${para._rect.top}px`);
    assert.ok(!tool(ctx, 'delete').hidden && tool(ctx, 'fold').getAttribute('aria-label') === '이 블록 접기');
    assert.ok(!viewOf(ctx).contains(bar(ctx)) && bar(ctx).parentNode === ctx.document.body, '단추는 보기 화면 밖에 둔다(블록 순서·내보내기에 섞이지 않게)');
});

test('단추: 원문 칸이 가렸거나 단락을 고치는 중이면 띄우지 않는다', () => {
    const ctx = toolContext(lesson());
    const para = block(ctx, '지울 문단입니다');
    viewOf(ctx).classList.add('hidden');
    fire(ctx, para, 'mousemove');
    assert.ok(!bar(ctx) || bar(ctx).hidden);
    viewOf(ctx).classList.remove('hidden');
    const editing = ctx.document.createElement('div');
    editing.className = 'para-edit';
    viewOf(ctx).appendChild(editing);
    fire(ctx, para, 'mousemove');
    assert.ok(!bar(ctx) || bar(ctx).hidden);
});

test('단추: 문제은행 탭에는 지우기 단추를 두지 않는다(접기만)', () => {
    const ctx = toolContext(lesson(), { tabId: 'assessment' });
    fire(ctx, block(ctx, '게임 루프가 하는 일'), 'mousemove');
    assert.ok(!bar(ctx).hidden);
    assert.ok(tool(ctx, 'delete').hidden && !tool(ctx, 'fold').hidden);
});

/* ======================= 지우기 ======================= */
test('지우기: X를 누르면 그 단락만 원문에서 빼고, 앞뒤 <br> 간격은 한 벌만 남기며, 작업 기록에 남기고 Ctrl+Z로 되돌린다', async () => {
    const mod = lesson();
    const ctx = toolContext(mod);
    await press(ctx, block(ctx, '지울 문단입니다'), 'delete');
    const after = stored(mod);
    assert.ok(!after.includes('지울 문단입니다'), after);
    assert.ok(after.includes('되풀이합니다.\n\n<br>\n\n```js'), '<br> 간격 한 벌');
    assert.strictEqual(after.replace(/\n/g, ' ').match(/<br>/g).length, 1);
    assert.deepStrictEqual(ctx.archived.map(item => [item.reason, item.content === LESSON]), [['단락 지우기 전', true]]);
    assert.ok(ctx.toasts.some(([message]) => message.includes('Ctrl+Z')));
    assert.ok(!(viewOf(ctx).textContent || '').includes('지울 문단입니다'), '화면도 다시 그렸다');
    call(ctx, 'formatUndo')({ preventDefault() {} });
    await settle();
    assert.strictEqual(stored(mod), LESSON, 'Ctrl+Z로 되돌린다');
});

test('지우기: 제목·목록·코드 블록·HTML 표도 그 블록만 지운다', async () => {
    const table = '<table style="border-collapse: collapse; width: 100%;"><tr><th style="border: 1px solid black;">구분</th><th>설명</th></tr><tr><td>입력</td><td>키를 읽습니다</td></tr></table>';
    const md = LESSON.replace('## 2. 레벨 디자인', `${table}\n\n## 2. 레벨 디자인`);
    const mod = lesson(md);
    const ctx = toolContext(mod);
    await press(ctx, block(ctx, '키를 읽습니다'), 'delete');
    assert.ok(!stored(mod).includes('<table'), '표');
    await press(ctx, block(ctx, 'function update'), 'delete');
    assert.ok(!stored(mod).includes('function update') && !stored(mod).includes('```'), '코드 블록');
    await press(ctx, block(ctx, '2. 레벨 디자인'), 'delete');
    assert.ok(!stored(mod).includes('## 2. 레벨 디자인') && stored(mod).includes('레벨은 플레이어가'), '제목 줄만');
    await press(ctx, block(ctx, '게임 루프를 설명할 수'), 'delete');
    assert.ok(!stored(mod).includes('- 게임 루프를 설명할 수'), '목록');
    assert.strictEqual(ctx.archived.length, 4);
});

test('지우기: 화면이 숨긴 첫머리에 같은 글이 있어도 보이는 블록을 지운다', async () => {
    const preamble = ['- 게임 루프를 설명할 수 있습니다.', '', '<br><br>', '', '---', '', '<br>', ''].join('\n');
    const md = preamble + LESSON;
    const mod = lesson(md);
    const ctx = toolContext(mod);
    await press(ctx, block(ctx, '게임 루프를 설명할 수'), 'delete');
    const after = stored(mod);
    assert.strictEqual(after.split('게임 루프를 설명할 수').length - 1, 1, '하나만 지웠다');
    assert.ok(after.indexOf('게임 루프를 설명할 수') < after.indexOf('# 📝'), '남은 것은 숨긴 첫머리의 것');
    assert.ok(!(viewOf(ctx).textContent || '').includes('게임 루프를 설명할 수'), '화면에서 사라졌다');
});

test('지우기: 같은 글 블록이 여럿이면 누른 그 블록을 지운다(숨긴 첫머리로 화면 순서가 어긋나도)', async () => {
    const md = ['- 목표 하나', '', '- 목표 둘', '', '---', '', '# 📝 1차시', '', '따라 해 보세요.', '', 'A 단계입니다.', '', '따라 해 보세요.', '', 'B 단계입니다.', ''].join('\n');
    for (const nth of [0, 1]) {
        const mod = lesson(md);
        const ctx = toolContext(mod);
        const twins = [...viewOf(ctx).children].filter(el => el.textContent.trim() === '따라 해 보세요.');
        assert.strictEqual(twins.length, 2);
        await press(ctx, twins[nth], 'delete');
        const left = stored(mod);
        assert.strictEqual(left.split('따라 해 보세요.').length - 1, 1, `${nth}째: 하나만 지웠다`);
        const keptBefore = left.indexOf('따라 해 보세요.') < left.indexOf('A 단계');
        assert.strictEqual(keptBefore, nth === 1, `${nth}째를 눌렀으면 그것이 사라진다`);
    }
});

test('지우기: 차시 제목을 지우면 숨긴 첫머리가 드러나므로 지우지 않고 알린다', async () => {
    const md = ['- 숨긴 목표입니다.', '', '---', '', '# 📝 1차시', '', '본문 가입니다.', '', '본문 나입니다.', ''].join('\n');
    const mod = lesson(md);
    const ctx = toolContext(mod);
    await press(ctx, block(ctx, '1차시'), 'delete');
    assert.strictEqual(stored(mod), md);
    assert.ok(ctx.toasts.some(([message, type]) => type === 'warning' && message.includes('드러나거나')), JSON.stringify(ctx.toasts));
    const plain = lesson(['# 📝 1차시', '', '본문 가입니다.', ''].join('\n'));
    const plainCtx = toolContext(plain);
    await press(plainCtx, block(plainCtx, '1차시'), 'delete');
    assert.ok(!stored(plain).includes('1차시'), '숨긴 첫머리가 없으면 제목도 지운다');
});

test('지우기: 화면이 나눠 그린 블록(이모지 줄)처럼 원문과 글이 다르면 지우지 않고 알린다', async () => {
    const md = LESSON.replace('레벨은 플레이어가 지나가는 길입니다.', '- 💡 핵심 항목입니다\n- 둘째 항목입니다');
    const mod = lesson(md);
    const ctx = toolContext(mod);
    await press(ctx, block(ctx, '핵심 항목입니다'), 'delete');
    assert.strictEqual(stored(mod), md);
    assert.ok(ctx.toasts.some(([message, type]) => type === 'warning' && message.includes('찾지 못해')), JSON.stringify(ctx.toasts));
    assert.strictEqual(ctx.archived.length, 0);
});

test('지우기: 탭에 보이는 마지막 단락은 지우지 않고, \\r\\n 원문은 줄바꿈을 지킨다', async () => {
    const only = lesson('## 하나뿐인 제목\n');
    const ctx = toolContext(only);
    await press(ctx, block(ctx, '하나뿐인 제목'), 'delete');
    assert.strictEqual(stored(only), '## 하나뿐인 제목\n');
    assert.ok(ctx.toasts.some(([message]) => message.includes('마지막 단락')));
    const crlf = LESSON.replace(/\n/g, '\r\n');
    const mod = lesson(crlf);
    const crCtx = toolContext(mod);
    await press(crCtx, block(crCtx, '지울 문단입니다'), 'delete');
    assert.ok(!stored(mod).includes('지울 문단입니다') && !/[^\r]\n/.test(stored(mod)), '모든 줄바꿈이 \\r\\n');
});

/* ======================= 접기 ======================= */
test('접기: 고른 블록만 접고 차시에 기억해 다시 그려도 접혀 있으며, 누르면 펼친다', async () => {
    const mod = lesson();
    const ctx = toolContext(mod);
    await press(ctx, block(ctx, 'function update'), 'fold');
    assert.ok(block(ctx, 'function update').classList.contains('block-folded'));
    assert.ok(!block(ctx, '지울 문단입니다').classList.contains('block-folded'), '고르지 않은 블록은 그대로');
    assert.strictEqual(mod.foldedBlocks.basicLearn.length, 1);
    assert.ok(ctx.saves >= 1, '저장한다');
    assert.strictEqual(stored(mod), LESSON, '원문은 바꾸지 않는다');
    assert.strictEqual(tool(ctx, 'fold').getAttribute('aria-label'), '이 블록 펼치기');
    ctx.drawView(mod);
    assert.ok(block(ctx, 'function update').classList.contains('block-folded'), '다시 그려도 접혀 있다');
    fire(ctx, block(ctx, 'function update'), 'click');
    await settle();
    assert.ok(!block(ctx, 'function update').classList.contains('block-folded'), '누르면 펼친다');
    assert.strictEqual(mod.foldedBlocks, undefined, '모두 펼치면 기억을 지운다');
});

test('접기: 탭마다 따로 기억하고, 글을 고친 블록은 펼친 채로 그린다', async () => {
    const mod = lesson();
    const ctx = toolContext(mod);
    await press(ctx, block(ctx, '지울 문단입니다'), 'fold');
    await press(ctx, block(ctx, '레벨은 플레이어가'), 'fold');
    assert.strictEqual(mod.foldedBlocks.basicLearn.length, 2);
    mod.tabContents.basicLearn = LESSON.replace('레벨은 플레이어가 지나가는 길입니다.', '레벨은 고친 문장입니다.');
    ctx.drawView(mod);
    assert.ok(block(ctx, '지울 문단입니다').classList.contains('block-folded'));
    assert.ok(!block(ctx, '레벨은 고친 문장').classList.contains('block-folded'), '지문이 바뀐 블록');
    const other = toolContext(mod, { tabId: 'assessment' });
    assert.ok(![...viewOf(other).children].some(el => el.classList.contains('block-folded')), '다른 탭은 접지 않는다');
    assert.strictEqual(call(ctx, 'nextFoldedBlocks')({ foldedBlocks: { basicLearn: ['a'], advLearn: 'odd' } }, 'advLearn', 'b', true).advLearn.length, 1, '모양이 틀린 기억은 버리고 새로 적는다');
    await press(ctx, block(ctx, '지울 문단입니다'), 'fold');
    assert.strictEqual(mod.foldedBlocks, undefined, '펼칠 때 화면에 없는 낡은 열쇠(고친 블록)도 버린다');
});

test('접기: 같은 글 블록은 따로 접힌다', async () => {
    const md = LESSON.replace('레벨은 플레이어가 지나가는 길입니다.', '정리해 봅시다.\n\n레벨은 길입니다.\n\n정리해 봅시다.');
    const mod = lesson(md);
    const ctx = toolContext(mod);
    const twins = () => [...viewOf(ctx).children].filter(el => el.textContent.trim() === '정리해 봅시다.');
    await press(ctx, twins()[1], 'fold');
    assert.deepStrictEqual(twins().map(el => el.classList.contains('block-folded')), [false, true]);
    ctx.drawView(mod);
    assert.deepStrictEqual(twins().map(el => el.classList.contains('block-folded')), [false, true], '다시 그려도 그 블록만');
});

(async () => {
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
    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
