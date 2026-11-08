// 그림 자리 넣기·눌러 그림 만들기 테스트 (실행: node tests/image-slot.test.js)
// 실제 image-slot-place.js와 api.js(그림 자리 넣기 버튼·그림 채우기·보기 화면 그리기), lesson-format.js(화면 블록 → 원문 블록), lesson-review.js(작업 기록),
// format-toolbar.js(Ctrl+Z), lesson-pipeline.js(진행 막대), cost-estimate.js(비용·시간 예고)를 vm에서 돌린다.
// 보기 화면은 domino로 흉내 내고 블록 자리는 getBoundingClientRect로 정한다. 검색어 정하기·그림 검색·그림 모델 호출은 모두 바꿔 끼운다(실제 AI·그림 서비스를 부르지 않는다).
// 처음 한 번: npm install --no-save marked@15.0.12 turndown@7.2.4 (domino는 turndown과 함께 들어온다)
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
const plain = value => JSON.parse(JSON.stringify(value));
const PNG = 'data:image/png;base64,QUFBQkJC';
const FILES = ['data.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js',
    'lesson-review.js', 'lesson-sanitize.js', 'lesson-format.js', 'lesson-export.js', 'format-toolbar.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js',
    'ai-routing.js', 'api.js', 'cost-estimate.js', 'image-slot-place.js'];

// 소스에서 함수 하나(시작 글부터 첫 '\n}\n'까지)를 잘라 온다
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
    if (!htmlProto.getBoundingClientRect) {
        Object.defineProperty(htmlProto, 'getBoundingClientRect', { configurable: true, value() { return this._rect || { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; } });
    }
}

// 보기 화면의 블록을 위에서부터 높이 60, 사이 20으로 놓는다(맨 위 100). 그림 자리 칸도 한 블록으로 놓는다
function layout(view) {
    let y = 100;
    for (const el of view.children) {
        el._rect = { top: y, bottom: y + 60, left: 100, right: 900, width: 800, height: 60 };
        y += 80;
    }
    view._rect = { top: 100, bottom: y, left: 100, right: 900, width: 800, height: y - 100 };
}

// 컨텍스트 하나만 쓰는 marked(api.js의 marked.use가 다른 컨텍스트의 렌더러를 덮지 않게)
function ownMarked() {
    const instance = new Marked();
    return { parse: (...args) => instance.parse(...args), use: (...args) => instance.use(...args), lexer: (...args) => instance.lexer(...args) };
}

const LESSON = [
    '# 1차시 게임 루프',
    '',
    '## 학습 목표',
    '',
    '- 게임 루프를 설명할 수 있다',
    '',
    '## 1. 게임 루프(Game Loop)의 구조',
    '',
    '게임 루프(Game Loop)는 입력, 갱신, 그리기를 매 프레임 되풀이합니다',
    '',
    '- 입력 처리',
    '- 상태 갱신',
    '',
    '| 단계 | 하는 일 |',
    '|---|---|',
    '| 입력 | 키를 읽는다 |',
    '',
    '```js',
    '// 매 프레임 부르는 함수',
    'function update() {}',
    '```',
    '',
    '## 2. 레벨 디자인',
    '',
    '레벨은 플레이어가 지나가는 길이고 난이도 곡선을 따라 장애물을 놓습니다',
    ''
].join('\n');

const tabsOf = basicLearn => ({ basicLearn, basicPrac: null, advLearn: null, advPrac: null, assessment: null, advAssessment: null });
const lesson = (md = LESSON, extra = {}) => ({ id: 7, title: '1차시 게임 루프', tabContents: tabsOf(md), content: md, images: {}, ...extra });

// mod: 연 차시. 화면 다시 그리기(renderEditor)는 원문 칸에 저장된 글을 넣고 실제 toggleEditorMode('view')로 보기 화면을 그린다
function slotContext(mod, { tabId = 'basicLearn' } = {}) {
    const doc = domino.createDocument([
        '<html><body>',
        '<details id="lesson-tools-menu"><summary>도구</summary><button id="image-slot-btn" type="button">그림 자리 넣기</button></details>',
        '<div id="editor-content-area"><div id="lesson-page"><div id="render-view" class="markdown-body"></div><textarea id="raw-view" class="hidden"></textarea></div></div>',
        '<div id="lesson-nav">탭 줄</div>',
        '</body></html>'
    ].join(''), true);
    patchDomino(doc);
    const ctx = {
        console: quiet, document: doc, Promise, URL, Blob, AbortController, Proxy, setTimeout, clearTimeout,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        marked: ownMarked(), NodeFilter,
        DOMParser: function DOMParser() { this.parseFromString = html => domino.createDocument(String(html), true); },
        currentMod: mod, toasts: [], alerts: [], asked: [], prompts: [], archived: [], imageCalls: [], intents: [], generated: [],
        saves: 0, rendered: 0, confirmAnswer: true, promptAnswer: null
    };
    ctx.window = ctx;
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.confirmAsync = async (message, opts) => { ctx.asked.push({ message, opts }); return ctx.confirmAnswer; };
    ctx.promptAsync = async (message, opts) => { ctx.prompts.push({ message, opts }); return ctx.promptAnswer; };
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
        renderEditor = mod => { window.rendered += 1; window.drawView(mod); }; renderSidebar = () => {};
        extractSearchIntent = async (keyword, context) => { window.intents.push({ keyword, context }); return { search_query: keyword, image_gen_prompt: 'A clean educational concept illustration with symbolic icons only, no text, no letters, no labels.', reasoning: '게임 루프 설명 그림' }; };
        searchImageAPI = async () => null;
        searchPixabayAPI = async () => null;
        generateImageAPI = async prompt => { window.generated.push(prompt); if (window.duringImage) await window.duringImage(); return window.madeImage === undefined ? ${JSON.stringify(PNG)} : window.madeImage; };
        window.realProcessImageTags = processImageTags;
        processImageTags = async (...args) => { window.imageCalls.push(args); return window.realProcessImageTags(...args); };`, ctx);
    ctx.drawView = target => {
        const raw = doc.getElementById('raw-view');
        raw.value = vm.runInContext('getActiveTabSource', ctx)(target);
        raw.lastSaved = raw.value;
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
// 보기 화면에서 글이 든 블록(그림 자리 칸은 빼고)
function block(ctx, text) {
    const found = [...viewOf(ctx).children].find(el => !el.hasAttribute('data-image-slot') && (el.textContent || '').includes(text));
    if (!found) throw new Error(`화면 블록을 찾지 못함: ${text}`);
    return found;
}
const upper = el => ({ clientX: 300, clientY: el._rect.top + 10 });
const lower = el => ({ clientX: 300, clientY: el._rect.bottom - 10 });
function fire(ctx, target, type, props = {}) {
    const event = ctx.document.createEvent('Event');
    event.initEvent(type, true, true);
    Object.assign(event, { button: type === 'contextmenu' ? 2 : 0 }, props);
    target.dispatchEvent(event);
    return event;
}
async function waitFor(condition, label) {
    for (let i = 0; i < 400; i++) {
        if (condition()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`기다려도 되지 않음: ${label}`);
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve)); };
const stored = mod => mod.tabContents.basicLearn;
const placing = ctx => ctx.document.body.classList.contains('image-slot-placing');
// 보기 화면에서 그림 자리를 하나 넣는다(자리 고르기를 열고 그 블록의 위·아래를 누른다)
async function placeAt(ctx, el, where) {
    ctx.insertImageSlot();
    fire(ctx, el, 'click', where(el));
    await settle();
}
const tagLine = keyword => `<!-- [IMG: "${keyword}"] -->`;
const IMG_TAGS = /<!--\s*\[IMG:\s*"?([^"]+)"?\]\s*-->/g;

let failed = 0;
let count = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

/* ======================= 넣을 자리(포인터 → 원문 위치) ======================= */
test('자리 고르기: 단락 아래쪽을 누르면 그 단락과 다음 블록 사이에 빈 줄로 띄운 그림 자리 줄 하나를 넣는다(검색어는 그 단락의 영어 낱말)', async () => {
    const mod = lesson();
    const ctx = slotContext(mod);
    await placeAt(ctx, block(ctx, '매 프레임 되풀이'), lower);
    assert.strictEqual(stored(mod), LESSON.replace('되풀이합니다\n\n', `되풀이합니다\n\n${tagLine('Game Loop')}\n\n`));
    const tags = call(ctx, 'pendingImageTags')(stored(mod), 'all').map(tag => tag.keyword);
    assert.deepStrictEqual(plain(tags), ['Game Loop'], '일괄 이미지 찾기가 같은 자리로 센다');
    const blocks = call(ctx, 'lessonBlocks')(stored(mod));
    assert.ok(blocks.some(item => item.token.type === 'html' && item.raw.trim() === tagLine('Game Loop')), '따로 선 그림 자리 블록이다');
});

test('자리 고르기: 단락 위쪽은 그 단락 앞에 넣는다. 제목 위쪽은 제목 앞(앞 섹션 끝), 아래쪽은 제목 바로 뒤이고 제목 줄은 그대로다', async () => {
    const mod = lesson();
    const ctx = slotContext(mod);
    await placeAt(ctx, block(ctx, '매 프레임 되풀이'), upper);
    assert.strictEqual(stored(mod), LESSON.replace('구조\n\n게임 루프(Game Loop)는', `구조\n\n${tagLine('Game Loop')}\n\n게임 루프(Game Loop)는`));
    const second = lesson();
    const ctx2 = slotContext(second);
    await placeAt(ctx2, block(ctx2, '2. 레벨 디자인'), upper);
    assert.strictEqual(stored(second), LESSON.replace('```\n\n## 2. 레벨 디자인', `\`\`\`\n\n${tagLine('Game Loop')}\n\n## 2. 레벨 디자인`), '제목 앞은 앞 섹션 끝이라 그 섹션 제목의 영어 낱말');
    const third = lesson();
    const ctx3 = slotContext(third);
    await placeAt(ctx3, block(ctx3, '2. 레벨 디자인'), lower);
    assert.strictEqual(stored(third), LESSON.replace('## 2. 레벨 디자인\n\n', `## 2. 레벨 디자인\n\n${tagLine('레벨 디자인')}\n\n`), '영어 낱말이 없으면 번호를 뗀 제목 글');
});

test('자리 고르기: 목록·표·코드 블록은 통째로 앞이나 뒤에 넣고 그 안에는 넣지 않는다', async () => {
    const list = lesson();
    const ctxList = slotContext(list);
    await placeAt(ctxList, block(ctxList, '입력 처리'), upper);
    assert.strictEqual(stored(list), LESSON.replace('되풀이합니다\n\n- 입력 처리', `되풀이합니다\n\n${tagLine('Game Loop')}\n\n- 입력 처리`));
    const table = lesson();
    const ctxTable = slotContext(table);
    await placeAt(ctxTable, block(ctxTable, '키를 읽는다'), lower);
    assert.strictEqual(stored(table), LESSON.replace('| 입력 | 키를 읽는다 |\n\n', `| 입력 | 키를 읽는다 |\n\n${tagLine('Game Loop')}\n\n`), '표 끝 줄 뒤(표 안이 아니다)');
    const code = lesson();
    const ctxCode = slotContext(code);
    await placeAt(ctxCode, block(ctxCode, 'function update'), lower);
    assert.strictEqual(stored(code), LESSON.replace('function update() {}\n```\n\n', `function update() {}\n\`\`\`\n\n${tagLine('Game Loop')}\n\n`), '닫는 펜스 뒤. 코드 글자는 검색어에 쓰지 않는다');
    const listEnd = lesson();
    const ctxEnd = slotContext(listEnd);
    await placeAt(ctxEnd, block(ctxEnd, '상태 갱신'), lower);
    assert.strictEqual(stored(listEnd), LESSON.replace('- 상태 갱신\n\n', `- 상태 갱신\n\n${tagLine('Game Loop')}\n\n`), '목록 항목 사이가 아니라 목록 끝');
    for (const md of [stored(list), stored(table), stored(code), stored(listEnd)]) {
        const tags = call(ctxList, 'pendingImageTags')(md, 'all');
        assert.strictEqual(tags.length, 1, '코드 블록 밖의 그림 자리 하나');
    }
    // 닫히지 않은 코드 블록 뒤에 넣으면 코드 안으로 들어간다: 넣지 않는다
    const open = '## 제목\n\n```js\n열린 코드\n';
    const plan = call(ctxList, 'imageSlotPlan')(open, { index: 1, text: '열린 코드' }, 'after');
    assert.deepStrictEqual([plan.ok, plan.reason.includes('코드 블록이나 목록 안')], [false, true]);
});

test('자리 고르기: \\r\\n 원문은 \\r\\n으로 넣고 다른 글자는 바꾸지 않는다', async () => {
    const crlf = LESSON.replace(/\n/g, '\r\n');
    const mod = lesson(crlf);
    const ctx = slotContext(mod);
    await placeAt(ctx, block(ctx, '매 프레임 되풀이'), lower);
    assert.strictEqual(stored(mod), crlf.replace('되풀이합니다\r\n\r\n', `되풀이합니다\r\n\r\n${tagLine('Game Loop')}\r\n\r\n`));
    const mod2 = lesson(crlf);
    const ctx2 = slotContext(mod2);
    await placeAt(ctx2, block(ctx2, '2. 레벨 디자인'), upper);
    assert.strictEqual(stored(mod2), crlf.replace('```\r\n\r\n## 2.', `\`\`\`\r\n\r\n${tagLine('Game Loop')}\r\n\r\n## 2.`));
    assert.ok(!/[^\r]\n/.test(stored(mod2)), '\\n만 쓴 줄이 생기지 않는다');
});

test('자리 고르기: 고정 섹션 제목 앞에 넣으면 고정 섹션 글은 그대로이고, 고정 섹션 안에 넣어도 제목으로 고정이 이어진다', async () => {
    const mod = lesson();
    const ctx = slotContext(mod);
    mod.lockedSections = { basicLearn: [call(ctx, 'lockTitleKey')('2. 레벨 디자인')] };
    const lockedBefore = plain(call(ctx, 'lockedSectionBlocks')(mod, 'basicLearn'));
    assert.strictEqual(lockedBefore.length, 1);
    await placeAt(ctx, block(ctx, '2. 레벨 디자인'), upper);
    assert.deepStrictEqual(plain(call(ctx, 'lockedSectionBlocks')(mod, 'basicLearn')), lockedBefore, '고정 섹션 글은 한 글자도 바뀌지 않는다');
    await placeAt(ctx, block(ctx, '2. 레벨 디자인'), lower);
    const locked = plain(call(ctx, 'lockedSectionBlocks')(mod, 'basicLearn'));
    assert.deepStrictEqual([locked.length, locked[0].title, locked[0].text.includes(tagLine('레벨 디자인'))], [1, '2. 레벨 디자인', true], '같은 제목으로 고정되고 넣은 자리를 담는다');
});

test('자리 고르기: 화면이 그림을 숨기는 곳(학습 목표·첫 제목 바로 아래)과 원문에서 찾지 못한 블록에는 넣지 않고 까닭을 알린 뒤 자리 고르기를 이어 간다', async () => {
    const mod = lesson();
    const ctx = slotContext(mod);
    ctx.insertImageSlot();
    fire(ctx, block(ctx, '게임 루프를 설명할 수 있다'), 'click', lower(block(ctx, '게임 루프를 설명할 수 있다')));
    await settle();
    fire(ctx, block(ctx, '1차시 게임 루프'), 'click', lower(block(ctx, '1차시 게임 루프')));
    await settle();
    assert.strictEqual(stored(mod), LESSON, '글은 그대로');
    const warnings = ctx.toasts.filter(([, type]) => type === 'warning').map(([text]) => text);
    assert.strictEqual(warnings.length, 2);
    assert.ok(warnings.every(text => text.includes('학습 목표·개요와 첫 제목 바로 아래')), warnings.join('\n'));
    assert.ok(placing(ctx) && ctx.document.getElementById('image-slot-marker'), '다른 자리를 고를 수 있게 그대로 둔다');
    const missing = call(ctx, 'imageSlotPlan')(LESSON, { index: 3, text: '원문에 없는 글입니다' }, 'after');
    assert.deepStrictEqual([missing.ok, missing.reason.includes('원문에서 찾지 못했습니다')], [false, true]);
    assert.strictEqual(ctx.archived.length, 0, '작업 기록도 남기지 않는다');
});

test('검색어: 둘레 단락의 영어 낱말을 먼저 쓰고, 없으면 위 제목의 영어·제목 글·단락 앞부분·차시 제목 순서로 고른다. 표시를 깨는 글자는 뺀다', () => {
    const ctx = slotContext(lesson());
    const keyword = call(ctx, 'imageSlotKeywordFor');
    assert.strictEqual(keyword({ text: 'Unity의 GameObject와 Component 구조를 살펴봅니다' }), 'Unity GameObject Component');
    assert.strictEqual(keyword({ text: '레벨은 플레이어가 지나가는 길입니다', heading: '3. 플레이어 경험(Player Experience) 설계' }), 'Player Experience');
    assert.strictEqual(keyword({ text: '레벨은 플레이어가 지나가는 길입니다', heading: '4. 레벨 디자인의 기본 원칙 (⏱ 30분)' }), '레벨 디자인의 기본 원칙');
    const prefix = keyword({ text: '레벨은 플레이어가 지나가는 길이며 난이도를 조절하는 핵심 도구입니다' });
    assert.ok(prefix.length <= 24 && '레벨은 플레이어가 지나가는 길이며 난이도를 조절하는 핵심 도구입니다'.startsWith(prefix) && prefix.length > 0, prefix);
    assert.strictEqual(keyword({ fallback: '1차시 게임 루프' }), '1차시 게임 루프');
    assert.strictEqual(keyword({ text: 'Input Update Render Physics Audio Network Save 단계' }), 'Input Update Render Physics Audio', '영어 낱말은 다섯 개까지');
    const odd = keyword({ text: '`code()` 말고 the "Boss" fight -- final ] stage를 봅니다 https://example.com/a' });
    assert.ok(!/["\]\r\n]|--|https|example|code/.test(odd) && odd.includes('Boss'), odd);
    assert.strictEqual(keyword({}), 'lesson illustration');
});

/* ======================= 도구 버튼 ======================= */
test('그림 자리 넣기 버튼: 보기 화면이면 검색어를 묻지 않고 자리 고르기를 시작한다. 원문 칸을 열어 두었으면 예전처럼 묻고 커서 자리에, 문제은행 탭에서는 넣지 않는다', async () => {
    const mod = lesson();
    const ctx = slotContext(mod);
    ctx.insertImageSlot();
    assert.deepStrictEqual([ctx.prompts.length, placing(ctx), !!ctx.document.getElementById('image-slot-marker')], [0, true, true]);
    assert.ok(ctx.toasts.at(-1)[0].includes('넣을 곳을 누르세요') && ctx.toasts.at(-1)[1] === 'info', ctx.toasts.at(-1)[0]);
    ctx.insertImageSlot();
    assert.strictEqual(ctx.document.querySelectorAll('#image-slot-marker').length, 1, '다시 눌러도 표시가 겹치지 않는다');
    ctx.stopImageSlotPlacing();
    // 원문 칸을 연 채로 누르면 검색어를 묻고 커서 자리에 넣는다(image-slot-place.js를 거치지 않는다)
    const raw = ctx.document.getElementById('raw-view');
    raw.classList.remove('hidden');
    const inserted = [];
    ctx.insertTextAtCursor = (target, text) => inserted.push(text);
    ctx.promptAnswer = 'game loop';
    await ctx.insertImageSlot();
    assert.deepStrictEqual([ctx.prompts.length, placing(ctx), plain(inserted)], [1, false, ['\n<!-- [IMG: "game loop"] -->\n']]);
    raw.classList.add('hidden');
    const bank = lesson(LESSON, { tabContents: { ...tabsOf(LESSON), assessment: '### 문제 1\n\n보기를 고르세요' } });
    const ctxBank = slotContext(bank, { tabId: 'assessment' });
    await ctxBank.insertImageSlot();
    assert.deepStrictEqual([placing(ctxBank), ctxBank.prompts.length], [false, 0]);
    assert.ok(String(ctxBank.alerts.at(-1)).includes('학습이해도·심화이해도에는 그림 자리를 넣지 않습니다'), String(ctxBank.alerts.at(-1)));
    const source = read('api.js');
    assert.ok(/onclick="insertImageSlot\(\); this\.closest\('details'\)\.open = false"[^>]*>[^<]*<i class="ph-bold [^"]+"><\/i> 그림 자리 넣기<\/button>/.test(source), '도구 메뉴에 글자가 있는 버튼으로 두고 누르면 메뉴를 닫는다');
});

/* ======================= 자리 고르기 화면 ======================= */
test('자리 고르기 화면: 마우스를 따라 그림 자리 표시가 움직이며 가리킨 블록의 위·아래 경계를 보여 준다(블록 사이 빈 곳은 가까운 블록, 교안 밖은 숨긴다)', async () => {
    const ctx = slotContext(lesson());
    ctx.insertImageSlot();
    const marker = ctx.document.getElementById('image-slot-marker');
    const line = marker.querySelector('.image-slot-marker-line');
    const label = marker.querySelector('.image-slot-marker-label');
    const para = block(ctx, '매 프레임 되풀이');
    fire(ctx, para, 'mousemove', { clientX: 320, clientY: para._rect.top + 5 });
    assert.deepStrictEqual([marker.style.display, marker.getAttribute('data-side'), line.style.top, line.style.left, line.style.width], ['block', 'before', `${para._rect.top - 6}px`, '100px', '800px']);
    assert.deepStrictEqual([label.style.left, label.style.top], ['334px', `${para._rect.top + 19}px`], '표시 글은 포인터 옆을 따라다닌다');
    assert.ok(label.textContent.includes('그림 자리') && label.textContent.includes('위에'), label.textContent);
    fire(ctx, para, 'mousemove', { clientX: 320, clientY: para._rect.bottom - 5 });
    assert.deepStrictEqual([marker.getAttribute('data-side'), line.style.top], ['after', `${para._rect.bottom + 6}px`]);
    assert.ok(label.textContent.includes('아래에'), label.textContent);
    fire(ctx, viewOf(ctx), 'mousemove', { clientX: 320, clientY: para._rect.bottom + 4 });
    assert.deepStrictEqual([marker.getAttribute('data-side'), line.style.top], ['after', `${para._rect.bottom + 6}px`], '블록 사이 빈 곳은 가까운 블록의 가까운 쪽');
    fire(ctx, ctx.document.getElementById('lesson-nav'), 'mousemove', { clientX: 320, clientY: 20 });
    assert.strictEqual(marker.style.display, 'none', '교안 밖에서는 숨긴다');
});

test('자리 고르기 화면: 누르면 그 자리에 넣고 작업 기록·변경 이력에 남긴 뒤 다시 그리고 자리 고르기를 끝낸다. Ctrl+Z로 되돌린다', async () => {
    const mod = lesson();
    const ctx = slotContext(mod);
    ctx.rendered = 0;
    ctx.insertImageSlot();
    const para = block(ctx, '매 프레임 되풀이');
    const click = fire(ctx, para, 'click', lower(para));
    assert.strictEqual(click.defaultPrevented, true, '누른 클릭은 다른 기능으로 넘기지 않는다');
    await settle();
    const next = LESSON.replace('되풀이합니다\n\n', `되풀이합니다\n\n${tagLine('Game Loop')}\n\n`);
    assert.strictEqual(stored(mod), next);
    assert.deepStrictEqual(plain(ctx.archived), [{ content: LESSON, tabId: 'basicLearn', reason: '그림 자리 넣기 전' }], '바꾸기 전 글을 작업 기록에 남긴다');
    assert.strictEqual(mod.history[0].note, '그림 자리 넣기 (기본학습)');
    assert.deepStrictEqual([placing(ctx), ctx.document.getElementById('image-slot-marker'), ctx.rendered > 0], [false, null, true]);
    assert.ok(ctx.toasts.at(-1)[0].includes('Ctrl+Z') && ctx.toasts.at(-1)[1] === 'success', ctx.toasts.at(-1)[0]);
    const slot = viewOf(ctx).querySelector('[data-image-slot="pending"]');
    assert.ok(slot && slot.getAttribute('data-slot-label').includes('Game Loop'), '넣은 자리가 보기 화면에 누를 수 있는 칸으로 보인다');
    const dbl = fire(ctx, block(ctx, '매 프레임 되풀이'), 'dblclick'); // 다시 그린 화면의 그 단락
    assert.strictEqual(dbl.defaultPrevented, true, '넣은 바로 뒤의 두 번 누르기는 단락 편집을 열지 않는다');
    call(ctx, 'formatUndo')({ preventDefault() {} });
    await settle();
    assert.strictEqual(stored(mod), LESSON, 'Ctrl+Z로 넣기 전 글로 돌아간다');
});

test('자리 고르기 화면: Esc·오른쪽 클릭·교안 밖 클릭은 넣지 않고 그만둔다. 도구 메뉴 안 클릭은 그대로 둔다', async () => {
    const mod = lesson();
    const ctx = slotContext(mod);
    const para = block(ctx, '매 프레임 되풀이');
    ctx.insertImageSlot();
    fire(ctx, ctx.document.body, 'keydown', { key: 'Escape' });
    assert.strictEqual(placing(ctx), false);
    assert.ok(ctx.toasts.at(-1)[0].includes('그만두었습니다'), ctx.toasts.at(-1)[0]);
    ctx.insertImageSlot();
    const menu = fire(ctx, para, 'contextmenu', lower(para));
    assert.deepStrictEqual([placing(ctx), menu.defaultPrevented], [false, true], '오른쪽 클릭은 메뉴를 띄우지 않고 그만둔다');
    ctx.insertImageSlot();
    fire(ctx, ctx.document.getElementById('image-slot-btn'), 'click', { clientX: 10, clientY: 10 });
    assert.strictEqual(placing(ctx), true, '도구 메뉴 안을 누르면 그대로 둔다');
    const outside = fire(ctx, ctx.document.getElementById('lesson-nav'), 'click', { clientX: 300, clientY: 20 });
    assert.deepStrictEqual([placing(ctx), outside.defaultPrevented], [false, false], '교안 밖 클릭은 그만두고 그 클릭은 그대로 간다');
    await settle();
    assert.deepStrictEqual([stored(mod), ctx.archived.length, ctx.document.getElementById('image-slot-marker')], [LESSON, 0, null]);
    ctx.insertImageSlot();
    vm.runInContext("currentLessonTab = 'basicPrac'", ctx);
    fire(ctx, para, 'click', lower(para));
    await settle();
    assert.deepStrictEqual([placing(ctx), stored(mod)], [false, LESSON], '다른 탭으로 옮기면 넣지 않고 그만둔다');
});

/* ======================= 눌러 그림 만들기 ======================= */
const SLOTTED = [
    '# 1차시 게임 루프',
    '',
    '## 1. 게임 루프(Game Loop)의 구조',
    '',
    '게임 루프(Game Loop)는 입력, 갱신, 그리기를 매 프레임 되풀이합니다',
    '',
    tagLine('Game Loop'),
    '',
    '```html',
    tagLine('Game Loop'),
    '```',
    '',
    '## 2. 레벨 디자인',
    '',
    '레벨은 플레이어가 지나가는 길이고 난이도 곡선을 따라 장애물을 놓습니다',
    '',
    tagLine('Game Loop'),
    '',
    tagLine('local:img_old'),
    ''
].join('\n');
const slotted = () => lesson(SLOTTED, { images: { img_old: PNG } });
const slotButtons = ctx => [...viewOf(ctx).querySelectorAll('[data-image-slot="pending"]')];

test('그림 자리 보이기: 보기 화면을 그리면 아직 그림이 없는 그림 자리(코드 블록 밖)를 누를 수 있는 칸으로 보인다. 코드 예제·local: 자리·문제은행 탭에는 달지 않는다', async () => {
    const ctx = slotContext(slotted());
    const buttons = slotButtons(ctx);
    assert.strictEqual(buttons.length, 2);
    buttons.forEach(button => {
        const label = button.getAttribute('data-slot-label');
        assert.deepStrictEqual([button.getAttribute('data-lesson-action'), button.getAttribute('type'), label.includes('그림 자리'), label.includes('Game Loop'), button.getAttribute('aria-label')], ['fill-image-slot', 'button', true, true, label]);
        assert.strictEqual(button.textContent, '', '칸에는 글자를 두지 않는다(보이는 글은 CSS). 끌어 고른 글·서식 막대·두 번 눌러 고치기에 섞이지 않게');
        assert.strictEqual(button.previousSibling.nodeType, 8, '그 그림 자리 주석 바로 뒤에 둔다');
    });
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').includes('content: attr(data-slot-label);'), '칸의 글은 CSS가 그린다');
    const exportControls = '[data-lesson-action], .image-regenerate-btn, .image-wrapper > span, .para-edit, button, textarea';
    assert.ok(read('lesson-export.js').includes(`const EXPORT_CONTROLS = '${exportControls}';`));
    assert.ok(buttons.every(el => el.matches(exportControls)), '내보내기에서 빠진다');
    ctx.drawView(ctx.currentMod);
    assert.strictEqual(slotButtons(ctx).length, 2, '다시 그려도 겹쳐 쌓이지 않는다');
    const bank = lesson(LESSON, { tabContents: { ...tabsOf(LESSON), assessment: `### 문제 1\n\n${tagLine('quiz board')}\n\n보기를 고르세요` } });
    const ctxBank = slotContext(bank, { tabId: 'assessment' });
    assert.strictEqual(viewOf(ctxBank).querySelectorAll('[data-image-slot]').length, 0, '문제은행 탭에는 그림 자리 칸을 달지 않는다');
});

test('눌러 그림 만들기: 그림 1장의 비용·시간을 보이고 묻는다. 취소하면 그림 찾기를 부르지 않고 글도 그대로다', async () => {
    const mod = slotted();
    const ctx = slotContext(mod);
    ctx.confirmAnswer = false;
    fire(ctx, slotButtons(ctx)[1], 'click');
    await settle();
    assert.strictEqual(ctx.asked.length, 1);
    const { message, opts } = ctx.asked[0];
    assert.deepStrictEqual([opts.title, opts.okLabel], ['그림 만들기', '만들기']);
    assert.ok(message.includes('Game Loop') && message.includes('그림: 1장') && message.includes('걸리는 시간'), message);
    assert.deepStrictEqual([ctx.imageCalls.length, ctx.intents.length, ctx.generated.length, ctx.archived.length, stored(mod)], [0, 0, 0, 0, SLOTTED]);
});

test('눌러 그림 만들기: 확인하면 일괄 이미지 찾기와 같은 길(processImageTags)을 그 자리 하나로 한 번만 부르고 그 자리만 그림으로 바꾼다(같은 검색어의 다른 자리·코드 예제는 그대로)', async () => {
    const mod = slotted();
    const ctx = slotContext(mod);
    fire(ctx, slotButtons(ctx)[1], 'click');
    await waitFor(() => ctx.toasts.some(([text]) => text.includes('그림을 만들어')), '끝 알림');
    assert.strictEqual(ctx.imageCalls.length, 1, '그림 찾기를 한 번만 부른다');
    const [passedMod, passedMd, opts] = ctx.imageCalls[0];
    assert.strictEqual(passedMod, mod);
    assert.deepStrictEqual(plain(opts.tags.map(tag => tag.keyword)), ['Game Loop'], '그 자리 하나');
    assert.strictEqual([...passedMd.matchAll(IMG_TAGS)].length, 1, '다른 그림 자리 표시(코드 예제 포함)는 잠시 다른 표시로 바꿔 넘긴다');
    assert.deepStrictEqual([opts.inject, opts.amount], [false, 'all']);
    assert.deepStrictEqual([ctx.intents.length, ctx.generated.length], [1, 1]);
    assert.strictEqual(ctx.intents[0].keyword, 'Game Loop');
    assert.ok(ctx.intents[0].context.includes('난이도 곡선'), '그 자리 둘레 글을 읽는다');
    const next = stored(mod);
    const newKey = Object.keys(mod.images).find(key => key !== 'img_old');
    assert.ok(newKey && mod.images[newKey] === PNG, '새 그림을 차시 그림에 담는다');
    assert.strictEqual(next.split(tagLine('Game Loop')).length - 1, 2, '첫 자리와 코드 예제의 표시는 그대로');
    assert.ok(next.includes(`\`\`\`html\n${tagLine('Game Loop')}\n\`\`\``) && next.includes(tagLine('local:img_old')));
    const at = next.indexOf(`local:${newKey}`);
    assert.ok(at > next.indexOf('난이도 곡선') && at < next.indexOf(tagLine('local:img_old')), '누른 자리(둘째 단락 뒤)만 그림으로 바뀐다');
    assert.deepStrictEqual(plain(ctx.archived.map(item => item.reason)), ['그림 만들기 전']);
    assert.strictEqual(ctx.archived[0].content, SLOTTED);
    assert.strictEqual(mod.history[0].note, '그림 자리 채우기 (기본학습)');
    assert.strictEqual(slotButtons(ctx).length, 1, '다시 그린 화면에는 남은 자리만 칸으로 보인다');
    assert.strictEqual(call(ctx, 'window.isLessonPipelineRunning')(), false, '진행 막대를 닫는다');
});

test('눌러 그림 만들기: 만드는 동안 그 자리를 지웠거나 그림을 못 만들면 글을 바꾸지 않고 알린다', async () => {
    const mod = slotted();
    const ctx = slotContext(mod);
    ctx.duringImage = async () => { mod.tabContents.basicLearn = SLOTTED.replace(`놓습니다\n\n${tagLine('Game Loop')}\n\n`, '놓습니다\n\n'); };
    fire(ctx, slotButtons(ctx)[1], 'click');
    await waitFor(() => ctx.toasts.some(([text]) => text.includes('그림을 넣지 않았습니다')), '지운 자리 알림');
    assert.deepStrictEqual([ctx.archived.length, Object.keys(mod.images)], [0, ['img_old']], '그림도 담지 않는다');
    assert.ok(!stored(mod).includes('image-wrapper'));
    const failing = slotted();
    const ctx2 = slotContext(failing);
    ctx2.madeImage = null;
    fire(ctx2, slotButtons(ctx2)[0], 'click');
    await waitFor(() => ctx2.toasts.some(([text]) => text.includes('그림을 만들지 못했습니다')), '못 만든 알림');
    assert.deepStrictEqual([stored(failing), ctx2.archived.length], [SLOTTED, 0], '못 만든 자리 칸으로 바꾸지 않고 그림 자리를 그대로 둔다');
    assert.strictEqual(ctx2.toasts.find(([text]) => text.includes('그림을 만들지 못했습니다'))[1], 'error');
});

test('눌러 그림 만들기: 그림을 못 만든 자리(이미지 영역)도 눌러 그 자리만 새 그림으로 바꾼다. 다시 검색 버튼은 예전대로 덮개 위에 둔다', async () => {
    const mod = lesson();
    const ctx = slotContext(mod);
    const box = call(ctx, 'imagePlaceholderHtml')('이미지 영역: 레벨 그림', 'Level Design');
    const md = `# 1차시\n\n## 2. 레벨 디자인\n\n레벨은 난이도 곡선을 따라 장애물을 놓습니다\n${box}\n끝 단락입니다\n`;
    mod.tabContents.basicLearn = md;
    ctx.drawView(mod);
    const holder = viewOf(ctx).querySelector('.image-placeholder');
    const fill = holder.querySelector('[data-image-slot="placeholder"]');
    const retry = holder.querySelector('[data-lesson-action="regenerate-image"]');
    assert.ok(fill && fill.getAttribute('data-lesson-action') === 'fill-image-slot' && holder.classList.contains('relative'));
    assert.ok(retry.classList.contains('relative') && retry.classList.contains('z-10'), '다시 검색은 덮개 위');
    fire(ctx, fill, 'click');
    await waitFor(() => ctx.toasts.some(([text]) => text.includes('그림을 만들어')), '끝 알림');
    assert.ok(ctx.asked[0].message.includes('Level Design'), ctx.asked[0].message);
    assert.deepStrictEqual(plain(ctx.imageCalls[0][2].tags.map(tag => tag.keyword)), ['Level Design']);
    const next = stored(mod);
    assert.ok(!next.includes('image-placeholder') && next.includes('<div class="image-wrapper"><img src="local:') && next.includes('끝 단락입니다'), next);
    assert.strictEqual(next.slice(0, next.indexOf('<div class="image-wrapper">')).trimEnd(), md.slice(0, md.indexOf('<div class="image-placeholder"')).trimEnd(), '그 자리 앞 글은 그대로');
});

test('눌러 그림 만들기: 일괄 이미지 찾기가 건너뛰는 섹션(정리·요약 등)의 그림 자리도 강사가 누르면 그 자리를 채운다', async () => {
    const md = ['# 1차시', '', '## 3. 핵심 정리', '', '게임 루프는 입력과 갱신과 그리기를 되풀이합니다', '', tagLine('Game Loop'), ''].join('\n');
    const mod = lesson(md);
    const ctx = slotContext(mod);
    assert.strictEqual(call(ctx, 'pendingImageTags')(md, 'all').length, 0, '일괄 이미지 찾기는 정리 섹션을 건너뛴다');
    assert.strictEqual(slotButtons(ctx).length, 1);
    fire(ctx, slotButtons(ctx)[0], 'click');
    await waitFor(() => ctx.toasts.some(([text]) => text.includes('그림을 만들어')), '끝 알림');
    assert.ok(stored(mod).includes('<div class="image-wrapper"><img src="local:') && !stored(mod).includes(tagLine('Game Loop')), stored(mod));
    assert.deepStrictEqual([ctx.imageCalls.length, ctx.generated.length], [1, 1]);
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
