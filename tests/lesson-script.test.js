// 강사 대본(대본보기) 테스트 (실행: node tests/lesson-script.test.js)
// 실제 lesson-script.js·lesson-script-view.js와 api.js(보기 화면 렌더·toggleEditorMode)·lesson-pipeline.js(진행 막대·중지)·tabs.js·block-tools.js·paragraph-edit.js·
// format-toolbar.js·filename-convention.js를 vm에서 돌린다. 화면은 domino로 흉내 낸다(tests/block-tools.test.js와 같은 흉내).
// AI는 부르지 않는다(callGemini를 가짜로 바꾼다). 저장 모양 고르기는 data-safety.js를 따로 불러 본다.
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

const rootDir = path.join(__dirname, '..');
const root = path.join(rootDir, 'js');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const FILES = ['data.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js',
    'lesson-review.js', 'lesson-fix-run.js', 'lesson-sanitize.js', 'lesson-format.js', 'lesson-export.js', 'format-toolbar.js', 'md-toolbar.js',
    'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'ai-errors.js', 'api.js', 'cost-estimate.js', 'image-slot-place.js', 'block-tools.js', 'paragraph-edit.js',
    'filename-convention.js', 'lesson-script.js', 'lesson-script-view.js'];

function sliceSource(source, start, end = '\n}\n') {
    const at = source.indexOf(start);
    if (at < 0) throw new Error(`소스에서 찾지 못함: ${start}`);
    return source.slice(at, source.indexOf(end, at) + end.length);
}

/* ---------- domino 보완(tests/block-tools.test.js와 같다) ---------- */
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
        Object.defineProperty(htmlProto, 'getBoundingClientRect', { configurable: true, value() { return this._rect || { top: 100, bottom: 160, left: 100, right: 900, width: 800, height: 60 }; } });
    }
}

function ownMarked() {
    const instance = new Marked();
    return { parse: (...args) => instance.parse(...args), use: (...args) => instance.use(...args), lexer: (...args) => instance.lexer(...args) };
}

const LESSON = [
    '# 📝 게임 루프',
    '',
    '## 개요',
    '',
    '- 게임이 멈추지 않고 움직이는 까닭을 알아봅니다.',
    '',
    '## 학습 정보',
    '',
    '- 권장 수업 시간: 4시간',
    '',
    '## 학습 목표',
    '',
    '- 게임 루프를 설명할 수 있습니다.',
    '',
    '## 1. 게임 루프의 구조 (⏱ 30분)',
    '',
    '게임 루프는 입력, 갱신, 그리기를 매 프레임 되풀이합니다.',
    '',
    '<!-- [IMG: "game loop diagram"] -->',
    '',
    '```js',
    '// 매 프레임 부르는 함수',
    'function update() {}',
    '```',
    '',
    '## 2. 프레임과 시간 (⏱ 20분)',
    '',
    '프레임은 화면을 한 번 그리는 단위입니다.',
    '',
    '## ✅ 학습 후 체크리스트',
    '',
    '- [ ] 게임 루프를 설명할 수 있다 (다시 보기: 1. 게임 루프의 구조)',
    ''
].join('\n');

const tabsOf = (basicLearn, advLearn = null) => ({ basicLearn, basicPrac: null, advLearn, advPrac: null, assessment: null, advAssessment: null });
const lesson = (md = LESSON, extra = {}) => ({ id: 7, title: '게임 루프', tabContents: tabsOf(md), content: md, images: {}, ...extra });

// 프롬프트가 부탁한 글자 수의 절반 넘게 합쇼체 말로 채운 바른 답
function goodAnswer(prompt, { body = '' } = {}) {
    const want = Number((prompt.match(/공백 포함 약 (\d+)자/) || [])[1] || 400);
    const lines = [];
    for (let n = 1; lines.join(' ').length < want * 0.6; n++) lines.push(`${n}. 화면의 흐름을 함께 따라가며 입력과 갱신을 차례로 확인하겠습니다.`);
    return [
        '@@시작@@', '이어서 새 부분을 시작하겠습니다.',
        '@@본문@@', '[화면: 섹션을 띄운다]', body || lines.join('\n'), '[질문하고 10초 기다린다]',
        '@@마무리@@', '지금까지 내용을 정리했습니다. 다음 부분으로 넘어가겠습니다.',
        '@@질문@@', 'Q: 순서가 바뀌면 어떻게 됩니까?', 'A: 화면이 입력보다 늦게 반응합니다.',
        '@@막힐때@@', '- 그림을 다시 띄우고 입력부터 짚어 줍니다.',
        '@@끝@@'
    ].join('\n');
}

function scriptContext(mod, { tabId = 'basicLearn' } = {}) {
    const doc = domino.createDocument([
        '<html><body>',
        '<div id="editor-content-area"><details id="lesson-tools-menu"><summary>도구</summary></details><div id="lesson-edit-hint"></div>',
        '<div id="lesson-page" class="max-w-[800px]"><div id="render-view" class="markdown-body"></div><textarea id="raw-view" class="hidden"></textarea></div></div>',
        '<div id="ai-command-bar"></div><div id="format-toolbar" class="hidden"></div>',
        '</body></html>'
    ].join(''), true);
    patchDomino(doc);
    const ctx = {
        console: quiet, document: doc, Promise, URL, Blob, AbortController, Proxy, setTimeout, clearTimeout, atob, btoa, Uint8Array, ArrayBuffer, Event: function Event(type) { const e = doc.createEvent('Event'); e.initEvent(type, true, true); return e; },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        marked: ownMarked(), NodeFilter, innerWidth: 1400,
        getSelection: () => ({ rangeCount: 1, isCollapsed: false, getRangeAt: () => ({ intersectsNode: () => true }), removeAllRanges() {} }),
        DOMParser: function DOMParser() { this.parseFromString = html => domino.createDocument(String(html), true); },
        currentMod: mod, toasts: [], alerts: [], saves: 0, rendered: 0, calls: [], confirms: [], statuses: [], downloads: [], confirmAnswer: true
    };
    ctx.window = ctx;
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.saveState = async () => { ctx.saves += 1; return true; };
    ctx.archiveContent = async () => {};
    ctx.renderSidebar = () => {};
    ctx.syncGyosuanView = () => {};
    ctx.DBManager = { getCache: async () => null, setCache: async () => {} };
    vm.createContext(ctx);
    vm.runInContext(sliceSource(read('ui.js'), 'function escapeHtml('), ctx);
    FILES.forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    vm.runInContext(`globalState = { subjects: [{ id: 's1', title: '교과', lessons: [window.currentMod] }] }; currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons;
        currentEditingModuleId = window.currentMod.id; currentLessonTab = ${JSON.stringify(tabId)}; _lessonPanel = null;
        getEditingModule = (id = currentEditingModuleId) => (String(id) === String(window.currentMod?.id) ? window.currentMod : null);
        renderEditor = mod => { window.rendered += 1; window.drawView(mod); window.applyLessonScriptView(mod); }; renderSidebar = () => {};
        callGemini = (...args) => window.fakeGemini(...args);
        waitMs = (ms, signal) => (signal?.aborted ? Promise.reject(abortError()) : Promise.resolve());
        confirmWithEstimate = async (message, work, opts) => { window.confirms.push({ message, work, opts }); return window.confirmAnswer; };
        downloadMd = (md, name) => window.downloads.push({ md, name });`, ctx);
    ctx.reply = prompt => goodAnswer(prompt);
    ctx.fakeGemini = async (model, payload) => {
        const prompt = payload.contents[0].parts[0].text;
        ctx.calls.push({ prompt, part: (prompt.match(/^\[이 부분\] (.+)$/m) || [])[1] || '', system: payload.systemInstruction.parts[0].text, model });
        if (payload.signal?.aborted) throw vm.runInContext('abortError()', ctx);
        const reply = await ctx.reply(prompt, ctx.calls.length);
        if (reply instanceof Error) throw reply;
        return { candidates: [{ content: { parts: [{ text: reply }] }, finishReason: 'STOP' }] };
    };
    const update = ctx.updateLessonJob;
    ctx.updateLessonJob = step => { if (step.status) ctx.statuses.push(step.status); update(step); };
    ctx.drawView = target => {
        const raw = doc.getElementById('raw-view');
        raw.value = vm.runInContext('getActiveTabSource', ctx)(target);
        raw.setAttribute('data-module-id', String(target.id));
        raw.setAttribute('data-tab-id', vm.runInContext('currentLessonTab', ctx));
        vm.runInContext("toggleEditorMode('view')", ctx);
    };
    ctx.drawView(mod);
    return ctx;
}

const call = (ctx, name) => vm.runInContext(name, ctx);
const viewOf = ctx => ctx.document.getElementById('render-view');
const splitOf = ctx => ctx.document.getElementById('lesson-script-view');
const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(resolve => setImmediate(resolve)); };
const plain = value => JSON.parse(JSON.stringify(value));
const plan = (ctx, mod, tabId = 'basicLearn') => call(ctx, 'lessonScriptPlan')(mod, tabId);
function fire(ctx, target, type) {
    const event = ctx.document.createEvent('Event');
    event.initEvent(type, true, true);
    target.dispatchEvent(event);
    return event;
}
// 대본을 모두 써 둔 차시(AI를 부르지 않고 지금 글의 지문으로 넣는다)
function withAllScripts(ctx, mod, tabId = 'basicLearn', text = row => `### 강의\n${row.title}을 설명하겠습니다.\n[화면: 그림을 띄운다]`) {
    const rows = plan(ctx, mod, tabId).rows;
    rows.filter(row => row.scripted).forEach(row => {
        mod.lessonScripts = call(ctx, 'withLessonScript')(mod, tabId, { key: row.key, title: row.title, sourceHash: row.hash, text: text(row) }, rows);
    });
    return rows;
}

let failed = 0;
let count = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

/* ======================= 섹션 나누기·열쇠 ======================= */
test('나누기: 첫머리(제목·개요·학습 정보·학습 목표)는 수업 시작 하나, 내용 ## 섹션마다 하나, 체크리스트는 마무리', () => {
    const ctx = scriptContext(lesson());
    const rows = call(ctx, 'lessonScriptRows')(LESSON);
    assert.deepStrictEqual(plain(rows.map(row => [row.key, row.kind, row.minutes, row.scripted])), [
        ['opening', 'opening', 5, true], ['c:1게임루프의구조', 'content', 30, true], ['c:2프레임과시간', 'content', 20, true], ['closing', 'closing', 5, true]
    ]);
    assert.deepStrictEqual(plain(rows[0].titles), ['개요', '학습 정보', '학습 목표']);
    assert.ok(rows[0].estimated && !rows[1].estimated, '시간 표시가 없는 수업 시작은 어림한 시간');
    assert.strictEqual(call(ctx, 'scriptRowName')(rows[1]), '1. 게임 루프의 구조', '(⏱ N분)은 뗀다');
    assert.strictEqual(call(ctx, 'scriptRowName')(rows[3]), '마무리 · ✅ 학습 후 체크리스트');
    assert.strictEqual(call(ctx, 'scriptLessonTitle')(rows, {}), '게임 루프', '# 📝 제목의 그림 글자는 뗀다');
    const times = call(ctx, 'scriptTimeline')(rows);
    assert.strictEqual(call(ctx, 'scriptTimeText')(rows[2], times[2]), '⏱ 20분 · 수업 시작 후 35분~55분');
    assert.strictEqual(call(ctx, 'scriptTimeText')(rows[0], times[0]), '⏱ 약 5분 · 수업 시작 후 0분~5분');
});

test('나누기: 예전 순서(학습 목표 → 개요)도 수업 시작 하나, 같은 제목은 #2, 내용 뒤의 학습 목표는 대본 없음, 시간 표시가 없는 섹션은 어림', () => {
    const ctx = scriptContext(lesson());
    const md = ['# 📝 옛 차시', '', '## 학습 목표', '', '- 목표', '', '## 개요', '', '- 개요', '', '## 실습', '', '첫 실습입니다.', '', '## 학습 목표', '', '- 다시 적은 목표', '',
        '## 실습', '', `${'설명 문장입니다. '.repeat(200)}`, '', '## ✅ 학습 후 체크리스트', '', '- [ ] 확인'].join('\n');
    const rows = call(ctx, 'lessonScriptRows')(md);
    assert.deepStrictEqual(plain(rows.map(row => [row.key, row.kind, row.scripted])), [
        ['opening', 'opening', true], ['c:실습', 'content', true], ['f:학습목표', 'frame', false], ['c:실습#2', 'content', true], ['closing', 'closing', true]
    ]);
    assert.deepStrictEqual(plain(rows[0].titles), ['학습 목표', '개요']);
    assert.ok(rows[3].estimated && rows[3].minutes >= 5 && rows[3].minutes % 5 === 0, `${rows[3].minutes}`);
});

test('나누기: 코드 블록 안의 ## 은 섹션이 아니고, 긴 섹션은 ### 소주제로 나눠(작은 조각은 붙여) 조각마다 시간을 나눈다', () => {
    const ctx = scriptContext(lesson());
    const long = text => `${text} `.repeat(Math.ceil(3500 / (text.length + 1)));
    const md = ['## 1. 긴 섹션 (⏱ 60분)', '', '머리 문단입니다.', '', '### 가. 첫 소주제', '', long('첫 소주제 설명입니다.'), '', '```md', '## 코드 속 제목', '```', '',
        '### 나. 둘째 소주제', '', long('둘째 소주제 설명입니다.'), ''].join('\n');
    const rows = call(ctx, 'lessonScriptRows')(md);
    assert.strictEqual(rows.length, 1, '코드 속 ## 은 제목이 아니다');
    const units = call(ctx, 'scriptRowUnits')(rows[0]);
    assert.strictEqual(units.length, 2, units.map(unit => unit.text.slice(0, 30)).join(' | '));
    assert.ok(units[0].text.startsWith('## 1. 긴 섹션') && units[0].text.includes('### 가. 첫 소주제'), '머리 문단(작은 조각)은 첫 소주제와 붙인다');
    assert.ok(units[1].text.startsWith('### 나. 둘째 소주제') && units[1].label === '나. 둘째 소주제');
    assert.strictEqual(units[0].minutes + units[1].minutes, 60);
    assert.ok(units.every(unit => unit.parts === 2));
    const short = call(ctx, 'scriptRowUnits')(call(ctx, 'lessonScriptRows')(LESSON)[1]);
    assert.strictEqual(short.length, 1, '짧은 섹션은 한 번에');
    assert.ok(!short[0].text.includes('IMG') && short[0].text.includes('function update() {}'), '그림 자리는 빼고 코드는 보낸다');
});

test('지문: 그림을 채우거나 <br> 간격만 바뀌면 그대로, 글·시간 표시·코드가 바뀌면 달라진다', () => {
    const ctx = scriptContext(lesson());
    const hash = call(ctx, 'scriptHash');
    const base = '## 1. 구조 (⏱ 30분)\n\n문장입니다.\n\n<!-- [IMG: "loop"] -->\n\n```js\nf();\n```';
    assert.strictEqual(hash(base), hash(base.replace('<!-- [IMG: "loop"] -->', '![loop](local:img_1)\n\n<br>')));
    assert.strictEqual(hash(base), hash(base.replace('<!-- [IMG: "loop"] -->', '<div class="image-wrapper"><img src="local:img_1" alt="x"></div>')));
    assert.notStrictEqual(hash(base), hash(base.replace('문장입니다.', '고친 문장입니다.')));
    assert.notStrictEqual(hash(base), hash(base.replace('30분', '40분')));
    assert.notStrictEqual(hash(base), hash(base.replace('f();', 'g();')));
    assert.ok(/^[0-9a-z]{1,8}-[0-9a-z]{1,8}$/.test(hash(base)), hash(base));
});

/* ======================= 프롬프트·답 읽기 ======================= */
test('프롬프트: 형식 표시, 합쇼체, 행동 지시 예, 시간·분량, 코드를 한 줄씩 읽지 않기, 교안에 없는 내용 금지, 앞뒤 부분과 섹션 글을 담는다', () => {
    const ctx = scriptContext(lesson());
    const rows = call(ctx, 'lessonScriptRows')(LESSON);
    const unit = call(ctx, 'scriptRowUnits')(rows[1])[0];
    const prompt = call(ctx, 'buildScriptPrompt')(unit, { lessonTitle: '게임 루프', tabLabel: '기본학습', prevTitle: '수업 시작', nextTitle: '2. 프레임과 시간' });
    ['@@시작@@', '@@본문@@', '@@마무리@@', '@@질문@@', '@@막힐때@@', '@@끝@@', '합쇼체', '[판서: 입력 → 갱신 → 그리기]', '[질문하고 10초 기다린다]', '[실습 시작 — 학생 화면 확인]',
        '수업 시간은 30분', '공백 포함 약 3000자', '코드는 한 줄씩 읽지 않습니다', '지어내지 않고', '[이 부분] «1. 게임 루프의 구조» · 30분', '[앞 부분] 수업 시작', '[다음 부분] 2. 프레임과 시간',
        '게임 루프는 입력, 갱신, 그리기를', 'function update() {}'].forEach(part => assert.ok(prompt.includes(part), part));
    assert.ok(!prompt.includes('[오늘 수업 순서]'), '수업 순서는 수업 시작에만');
    const opening = call(ctx, 'buildScriptPrompt')(call(ctx, 'scriptRowUnits')(rows[0])[0], { outline: ['1. 게임 루프의 구조', '2. 프레임과 시간'] });
    assert.ok(opening.includes('수업을 여는 부분') && opening.includes('[오늘 수업 순서]\n1. 1. 게임 루프의 구조\n2. 2. 프레임과 시간') && opening.includes('[앞 부분] 없음(수업의 처음)'));
    const closing = call(ctx, 'buildScriptPrompt')(call(ctx, 'scriptRowUnits')(rows[3])[0], {});
    assert.ok(closing.includes('체크리스트 항목을 학생과 하나씩 확인') && closing.includes('[다음 부분] 없음(수업의 끝)'));
    const again = call(ctx, 'buildScriptPrompt')(unit, { again: '형식 표시(@@본문@@)가 없습니다.' });
    assert.ok(again.endsWith('[다시 쓰기] 앞의 답은 쓸 수 없었습니다: 형식 표시(@@본문@@)가 없습니다. 형식과 규칙을 지켜 처음부터 다시 쓰세요.'));
    const piece = call(ctx, 'buildScriptPrompt')({ ...unit, part: 1, parts: 3, label: '나. 둘째' }, { prevTitle: '수업 시작', nextTitle: '2.' });
    assert.ok(piece.includes('3조각 가운데 2번째 조각(나. 둘째)') && piece.includes('앞 조각에서 이어지는 한 문장만') && piece.includes('다음 조각으로 넘어가는 한 문장만') && piece.includes('[앞 부분] 같은 섹션의 앞 조각'));
    assert.ok(call(ctx, 'scriptSystemInstruction')().includes('합쇼체'));
});

test('답 읽기: 바른 답은 들어가며·강의·넘어가며·질문(2개까지)·막힐 때(3개까지)로 읽고 굵게 표시는 떼되, <div>·vector<int> 같은 글은 쓴 그대로 둔다', () => {
    const ctx = scriptContext(lesson());
    const answer = [
        '**@@시작@@**', '시작하겠습니다.', '@@본문@@', '<div> 태그와 vector<int> 자료형을 함께 보겠습니다. [화면: 그림을 띄운다]', '<script>alert(1)</script>입력부터 차례로 짚겠습니다.',
        '| 표 | 줄 |', '(강사가 소리 내어 읽을 말)', '이 순서를 기억해 두시기 바랍니다. 다음 그림을 보시겠습니까?', '이제 갱신을 설명하겠습니다. 그리기는 마지막입니다.',
        '@@마무리@@', '다음으로 넘어가겠습니다.', '@@질문@@', 'Q1: 첫 질문입니까?', 'A1: 네, 맞습니다.', '질문: 둘째 질문입니까?', '답: 둘째 답입니다.', 'Q: 셋째입니까?', 'A: 셋째 답입니다.',
        '@@막힐 때@@', '- 하나', '- 둘', '- 셋', '- 넷', '@@끝@@'
    ].join('\n');
    const read = call(ctx, 'parseScriptAnswer')(answer, { target: 400 });
    assert.ok(!read.error, read.error);
    assert.strictEqual(read.intro, '시작하겠습니다.');
    assert.ok(read.body.startsWith('<div> 태그와 vector<int> 자료형을') && !/표 \||강사가 소리/.test(read.body), read.body);
    assert.ok(read.body.includes('<script>alert(1)</script>입력부터'), '글은 AI가 쓴 그대로(화면은 이스케이프해 그린다)');
    assert.deepStrictEqual(plain(read.questions), [{ q: '첫 질문입니까?', a: '네, 맞습니다.' }, { q: '둘째 질문입니까?', a: '둘째 답입니다.' }]);
    assert.deepStrictEqual(plain(read.tips), ['하나', '둘', '셋']);
    const text = call(ctx, 'scriptTextFrom')(read);
    assert.ok(text.startsWith('### 들어가며\n시작하겠습니다.') && text.includes('### 예상 질문\nQ. 첫 질문입니까?\nA. 네, 맞습니다.\n\nQ. 둘째') && text.endsWith('### 막힐 때\n- 하나\n- 둘\n- 셋'), text);
});

test('답 읽기: 망가진 답(한도에서 끊김·표시 없음·끝 표시 없음·코드 블록·짧은 본문·빈 이음 말·반말·질문 없음)은 까닭과 함께 받지 않는다', () => {
    const ctx = scriptContext(lesson());
    const parse = (text, opts = {}) => call(ctx, 'parseScriptAnswer')(text, { target: 400, ...opts });
    const good = goodAnswer('공백 포함 약 400자');
    assert.ok(!parse(good).error, parse(good).error);
    const cases = [
        [parse(good, { truncated: true }), '출력 한도'],
        [parse(good.replace('@@본문@@', '본문')), '@@본문@@'],
        [parse(good.replace('@@끝@@', '')), '끝 표시'],
        [parse(good.replace('@@마무리@@', '')), '@@시작@@·@@마무리@@'],
        [parse(good.replace('[질문하고 10초 기다린다]', '```js\nupdate();\n```')), '코드 블록'],
        [parse(good.replace(/@@본문@@[\s\S]*@@마무리@@/, '@@본문@@\n짧습니다.\n@@마무리@@')), '너무 짧습니다'],
        [parse(good.replace('이어서 새 부분을 시작하겠습니다.', '')), '들어가는 말'],
        [parse(good.replace(/하겠습니다\./g, '한다.')), '합쇼체'],
        [parse(good.replace(/@@질문@@[\s\S]*@@막힐때@@/, '@@질문@@\n없음\n@@막힐때@@')), '예상 질문'],
        [parse(good.replace('- 그림을 다시 띄우고 입력부터 짚어 줍니다.', '')), '막힐 때']
    ];
    cases.forEach(([read, part], i) => assert.ok(read.error && read.error.includes(part), `${i}: ${read.error}`));
    assert.ok(!parse(good.replace(/@@질문@@[\s\S]*@@막힐때@@/, '@@질문@@\n@@막힐때@@'), { kind: 'opening' }).error, '수업 시작·마무리는 질문이 없어도 받는다');
    assert.ok(!parse(good.replace('이어서 새 부분을 시작하겠습니다.', ''), { needIntro: false }).error, '뒤 조각은 들어가는 말이 비어도 된다');
    const tone = call(ctx, 'scriptToneShare')('설명하겠습니다. 보세요. [화면: 띄운다.] 그렇다. 맞습니까?');
    assert.deepStrictEqual(plain([tone.ends, tone.formal, tone.soft]), [4, 0.5, 0.25]);
});

test('잇기: 조각의 이음 말은 본문 사이에, 질문은 조각마다 하나씩 먼저, 같은 할 일은 하나', () => {
    const ctx = scriptContext(lesson());
    const part = (n, extra = {}) => ({ intro: `들어가며${n}`, body: `본문${n}`, outro: `넘어가며${n}`, questions: [{ q: `q${n}a`, a: 'a' }, { q: `q${n}b`, a: 'b' }], tips: ['같은 할 일', `할 일${n}`], ...extra });
    const joined = call(ctx, 'joinScriptParts')([part(1), part(2), part(3)]);
    assert.strictEqual(joined.intro, '들어가며1');
    assert.strictEqual(joined.body, '본문1\n\n넘어가며1\n\n들어가며2\n\n본문2\n\n넘어가며2\n\n들어가며3\n\n본문3');
    assert.strictEqual(joined.outro, '넘어가며3');
    assert.deepStrictEqual(plain(joined.questions.map(item => item.q)), ['q1a', 'q2a']);
    assert.deepStrictEqual(plain(joined.tips), ['같은 할 일', '할 일1', '할 일2']);
});

/* ======================= 쓰기(가짜 AI) ======================= */
test('쓰기: 처음 누르면 섹션 수·호출 수를 보이고 묻고, 진행 막대에 "대본 작성 중 (k/n)"을 보이며 섹션마다 저장한다. 다음에는 묻지 않고 바로 연다', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    await settle();
    assert.strictEqual(ctx.confirms.length, 1);
    assert.strictEqual(ctx.confirms[0].work.lessonScripts, 4, '줄 4개, 조각 4개');
    assert.ok(ctx.confirms[0].message.includes('«기본학습» 탭의 섹션 4개') && ctx.confirms[0].message.includes('AI 호출은 섹션마다 한 번씩 4번') && ctx.confirms[0].message.includes('멈춰도 다 쓴 섹션과 긴 섹션의 다 쓴 조각은 남습니다'), ctx.confirms[0].message);
    assert.deepStrictEqual(ctx.calls.map(item => item.part), ['«수업 시작» · 5분', '«1. 게임 루프의 구조» · 30분', '«2. 프레임과 시간» · 20분', '«마무리 · ✅ 학습 후 체크리스트» · 5분']);
    assert.ok(ctx.calls.every(item => item.system.includes('합쇼체')));
    assert.deepStrictEqual(ctx.statuses.filter(text => text.startsWith('대본 작성 중')).map(text => text.split(' · ')[0]), ['대본 작성 중 (1/4)', '대본 작성 중 (2/4)', '대본 작성 중 (3/4)', '대본 작성 중 (4/4)']);
    assert.strictEqual(ctx.saves, 4, '섹션마다 저장');
    const stored = mod.lessonScripts.basicLearn;
    assert.deepStrictEqual(plain(stored.sections.map(item => item.key)), ['opening', 'c:1게임루프의구조', 'c:2프레임과시간', 'closing']);
    assert.ok(stored.sections.every(item => Object.keys(item).join() === 'key,title,sourceHash,text,at' && typeof item.at === 'string') && stored.updatedAt);
    assert.ok(stored.sections[1].text.startsWith('### 들어가며\n'), stored.sections[1].text);
    assert.strictEqual(mod.tabContents.basicLearn, LESSON, '탭 글에는 넣지 않는다');
    assert.ok(splitOf(ctx), '대본 화면이 열렸다');
    assert.ok(ctx.toasts.some(([text, kind]) => text.includes('기본학습 대본 쓰기를 마쳤습니다. 섹션 4개의 대본을 썼습니다.') && kind === 'success'), JSON.stringify(ctx.toasts));
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn'); // 닫기
    assert.ok(!splitOf(ctx) && !viewOf(ctx).classList.contains('hidden'));
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn'); // 다시 열기
    assert.ok(splitOf(ctx) && ctx.confirms.length === 1 && ctx.calls.length === 4, '모두 있으면 묻지 않고 바로 연다');
});

test('쓰기: 묻는 창을 닫으면 AI를 부르지 않는다(쓴 대본이 없으면 화면도 열지 않는다)', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    ctx.confirmAnswer = false;
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    assert.strictEqual(ctx.calls.length, 0);
    assert.ok(!splitOf(ctx) && !mod.lessonScripts);
});

test('쓰기: 망가진 답은 까닭을 적어 한 번 더 받고, 그래도 망가지면 그 섹션만 쓰지 못한 것으로 두고 나머지는 쓴다', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    ctx.reply = prompt => (prompt.includes('«1. 게임 루프의 구조»') ? '대본입니다.' : prompt.includes('«2. 프레임과 시간»') && !prompt.includes('[다시 쓰기]') ? goodAnswer(prompt).replace('@@끝@@', '') : goodAnswer(prompt));
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    await settle();
    const parts = ctx.calls.map(item => [item.part.split(' · ')[0], item.prompt.includes('[다시 쓰기]')]);
    assert.deepStrictEqual(parts, [['«수업 시작»', false], ['«1. 게임 루프의 구조»', false], ['«1. 게임 루프의 구조»', true], ['«2. 프레임과 시간»', false], ['«2. 프레임과 시간»', true], ['«마무리', false]]);
    const p = plan(ctx, mod);
    assert.deepStrictEqual(plain(p.missing.map(row => row.key)), ['c:1게임루프의구조']);
    const cell = splitOf(ctx).querySelector('[data-script-cell="c:1게임루프의구조"]');
    assert.ok(cell.textContent.includes('대본을 쓰지 못했습니다: 형식 표시(@@본문@@)가 없습니다.') && cell.querySelector('[data-script-action="regen"]'), cell.textContent);
    assert.ok(ctx.toasts.some(([text, kind]) => text.includes('섹션 3개의 대본을 썼습니다. 1개는 쓰지 못했습니다') && kind === 'warning'), JSON.stringify(ctx.toasts));
    // 빠진 대본 쓰기: 없는 섹션만 다시 묻고 쓴다
    ctx.reply = prompt => goodAnswer(prompt);
    const before = ctx.calls.length;
    fire(ctx, splitOf(ctx).querySelector('[data-script-action="fill"]'), 'click');
    await settle();
    assert.ok(ctx.confirms[1].message.includes('아직 대본이 없는 섹션 1개(1. 게임 루프의 구조)의 대본을 이어서 씁니다'), ctx.confirms[1].message);
    assert.deepStrictEqual(ctx.calls.slice(before).map(item => item.part), ['«1. 게임 루프의 구조» · 30분']);
    assert.strictEqual(plan(ctx, mod).missing.length, 0);
    assert.ok(!splitOf(ctx).textContent.includes('쓰지 못했습니다'), '다시 쓰면 실패 표시를 지운다');
});

test('쓰기: 중지하면 받은 섹션까지 남기고, 다시 대본보기를 누르면 없는 섹션만 이어서 쓴다', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    ctx.reply = (prompt, no) => {
        if (no === 2) ctx.requestLessonPipelineStop();
        return goodAnswer(prompt);
    };
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    await settle();
    assert.strictEqual(ctx.calls.length, 2);
    assert.deepStrictEqual(plain(mod.lessonScripts.basicLearn.sections.map(item => item.key)), ['opening', 'c:1게임루프의구조'], '받은 섹션은 남긴다');
    assert.ok(ctx.toasts.some(([text, kind]) => text.includes('대본 쓰기를 멈췄습니다. 섹션 2개의 대본을 썼습니다. 2개는 아직 쓰지 않았습니다') && kind === 'warning'), JSON.stringify(ctx.toasts));
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn'); // 닫기
    ctx.reply = prompt => goodAnswer(prompt);
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    await settle();
    assert.ok(ctx.confirms[1].message.includes('아직 대본이 없는 섹션 2개'), ctx.confirms[1].message);
    assert.deepStrictEqual(ctx.calls.slice(2).map(item => item.part.split(' · ')[0]), ['«2. 프레임과 시간»', '«마무리']);
    assert.strictEqual(mod.lessonScripts.basicLearn.sections.length, 4);
});

test('쓰기: 하루 한도·키 문제 같은 오류는 남은 섹션을 부르지 않고 멈추며, 받은 섹션은 남는다', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    ctx.reply = (prompt, no) => {
        if (no < 2) return goodAnswer(prompt);
        const err = new Error('오늘 쓸 수 있는 호출을 다 썼습니다.');
        err.quota = true;
        return err;
    };
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    await settle();
    assert.strictEqual(ctx.calls.length, 2, '같은 까닭으로 실패할 곳은 부르지 않는다');
    assert.deepStrictEqual(plain(mod.lessonScripts.basicLearn.sections.map(item => item.key)), ['opening']);
    assert.ok(ctx.toasts.some(([text, kind]) => text.startsWith('기본학습 대본 쓰기를 멈췄습니다.') && text.includes('오늘 쓸 수 있는 호출을 다 썼습니다') && kind === 'error'), JSON.stringify(ctx.toasts));
});

test('쓰기: 다른 생성이 돌고 있으면 묻지도 부르지도 않는다', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    vm.runInContext('_lessonRun = { running: true }', ctx);
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    assert.deepStrictEqual([ctx.confirms.length, ctx.calls.length], [0, 0]);
    assert.ok(ctx.alerts.includes('진행 중인 생성이 끝난 뒤 다시 시도해주세요.'));
});

/* ======================= 교안이 바뀐 섹션 ======================= */
test('바뀜: 한 섹션의 글을 고치면 그 섹션만 "교안이 바뀜"과 다시 만들기를 보이고, 그 섹션만 다시 쓴다(그림을 채운 것은 바뀜이 아니다)', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    withAllScripts(ctx, mod);
    const edited = LESSON.replace('프레임은 화면을 한 번 그리는 단위입니다.', '프레임은 화면을 한 번 그리는 단위이고 초당 60번 그립니다.')
        .replace('<!-- [IMG: "game loop diagram"] -->', '![game loop](local:img_1)');
    vm.runInContext('setTabMarkdown', ctx)(mod, 'basicLearn', edited);
    const p = plan(ctx, mod);
    assert.deepStrictEqual(plain([...p.states.entries()]), [['opening', 'current'], ['c:1게임루프의구조', 'current'], ['c:2프레임과시간', 'outdated'], ['closing', 'current']]);
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    assert.strictEqual(ctx.confirms.length, 0, '바뀐 섹션만 있으면 묻지 않고 연다');
    const cell = splitOf(ctx).querySelector('[data-script-cell="c:2프레임과시간"]');
    assert.ok(cell.textContent.includes('이 대본을 쓴 뒤 교안이 바뀌었습니다') && cell.querySelector('.ls-btn-warn[data-script-action="regen"]'));
    assert.ok(!splitOf(ctx).querySelector('[data-script-cell="c:1게임루프의구조"]').textContent.includes('바뀌었습니다'));
    assert.ok(splitOf(ctx).querySelector('[data-script-count]').textContent.includes('교안이 바뀐 섹션 1개'));
    fire(ctx, cell.querySelector('[data-script-action="regen"]'), 'click');
    await settle();
    assert.ok(ctx.confirms[0].message.startsWith('«2. 프레임과 시간» 대본을 다시 씁니다. 지금 대본은 새 대본으로 바뀝니다.') && ctx.confirms[0].work.lessonScripts === 1, ctx.confirms[0].message);
    assert.deepStrictEqual(ctx.calls.map(item => item.part), ['«2. 프레임과 시간» · 20분']);
    assert.ok(ctx.calls[0].prompt.includes('초당 60번 그립니다'), '지금 글로 쓴다');
    assert.strictEqual(plan(ctx, mod).outdated.length, 0);
});

/* ======================= 화면 ======================= */
test('화면: 교안 자리를 세로 2분할로 바꾸고 줄마다 왼쪽 교안(같은 렌더)·오른쪽 대본을 둔다. 편집 도구는 숨기거나 움직이지 않는다', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    withAllScripts(ctx, mod);
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    const box = splitOf(ctx);
    assert.ok(box && viewOf(ctx).classList.contains('hidden') && box.previousSibling === viewOf(ctx));
    assert.ok(ctx.document.getElementById('lesson-page').classList.contains('lesson-script-wide'), '교안 칸을 넓힌다');
    const rows = Array.from(box.querySelectorAll('.lesson-script-row'));
    assert.strictEqual(rows.length, 4);
    rows.forEach(row => {
        assert.strictEqual(row.children.length, 2, '두 칸');
        assert.ok(row.children[0].classList.contains('lesson-script-lesson') && row.children[0].classList.contains('markdown-body') && row.children[1].querySelector('.lesson-script-card'));
    });
    assert.ok(rows[1].querySelector('.lesson-script-lesson h2') && rows[1].querySelector('.lesson-script-lesson pre'), '제목과 코드 블록을 보기 화면처럼 그린다');
    assert.ok(rows[1].querySelector('.ls-time').textContent.includes('⏱ 30분 · 수업 시작 후 5분~35분'));
    assert.ok(rows[0].querySelector('.lesson-script-lesson').textContent.includes('학습 목표'), '수업 시작 줄에 첫머리를 모두 그린다');
    assert.ok(box.querySelector('[data-script-action="download"]') && box.querySelector('[data-script-action="close"]'));
    ['lesson-tools-menu', 'ai-command-bar', 'lesson-edit-hint'].forEach(id => assert.ok(ctx.document.getElementById(id).classList.contains('hidden'), id));
    // 단락 단추(block-tools.js)는 대본 화면에서 뜨지 않는다
    fire(ctx, rows[1].querySelector('.lesson-script-lesson p'), 'mousemove');
    const bar = ctx.document.getElementById('block-tools');
    assert.ok(!bar || bar.hidden, '접기·지우기 단추를 띄우지 않는다');
    // 두 번 눌러 고치기(paragraph-edit.js)도 열리지 않는다
    const target = rows[1].querySelector('.lesson-script-lesson p');
    call(ctx, 'openParagraphEditor')({ target });
    assert.ok(!ctx.document.querySelector('.para-edit'));
    assert.strictEqual(call(ctx, 'formatContext')(), null, '서식 막대도 뜨지 않는다');
});

test('화면: 다시 그리면(renderEditor) 같은 탭이면 다시 열고, 탭을 바꾸거나 원문 전체 수정으로 가면 닫는다. 대본 닫기는 보기 화면으로 돌아간다', async () => {
    const mod = { ...lesson(), tabContents: tabsOf(LESSON, LESSON) };
    const ctx = scriptContext(mod);
    withAllScripts(ctx, mod);
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    call(ctx, 'renderEditor')(mod);
    assert.ok(splitOf(ctx) && viewOf(ctx).classList.contains('hidden'), '같은 탭은 다시 연다');
    call(ctx, 'toggleEditorMode')('view');
    assert.ok(splitOf(ctx) && viewOf(ctx).classList.contains('hidden'), '보기 모드를 다시 그려도 대본 화면을 둔다');
    vm.runInContext("currentLessonTab = 'advLearn'", ctx);
    call(ctx, 'renderEditor')(mod);
    assert.ok(!splitOf(ctx) && !call(ctx, '_scriptView'), '탭을 바꾸면 닫는다');
    vm.runInContext("currentLessonTab = 'basicLearn'", ctx);
    call(ctx, 'renderEditor')(mod);
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    call(ctx, 'toggleEditorMode')('edit');
    assert.ok(!splitOf(ctx) && !ctx.document.getElementById('lesson-page').classList.contains('lesson-script-wide') && !ctx.document.getElementById('raw-view').classList.contains('hidden'), '원문 전체 수정은 대본 화면을 닫는다');
    assert.ok(!ctx.document.getElementById('lesson-tools-menu').classList.contains('hidden'), '숨긴 도구를 되돌린다');
    call(ctx, 'toggleEditorMode')('view');
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    fire(ctx, splitOf(ctx).querySelector('[data-script-action="close"]'), 'click');
    assert.ok(!splitOf(ctx) && !viewOf(ctx).classList.contains('hidden'));
});

test('단추: 기본학습·심화학습에 글이 있을 때만, 최종 평가에는 없다. 열면 "대본 닫기"로 바뀐다', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    const html = call(ctx, 'lessonScriptButtonHtml');
    assert.ok(html(mod, 'basicLearn').includes('대본보기') && html(mod, 'basicLearn').includes('id="lesson-script-btn"'));
    assert.strictEqual(html(mod, 'advLearn'), '', '빈 탭에는 두지 않는다');
    assert.strictEqual(html(mod, 'basicPrac'), '');
    assert.strictEqual(html({ ...mod, id: 'mainQuest' }, 'basicLearn'), '');
    withAllScripts(ctx, mod);
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    assert.ok(html(mod, 'basicLearn').includes('대본 닫기') && html(mod, 'basicLearn').includes('aria-pressed="true"'));
    const api = read('api.js');
    assert.ok(api.includes("const script = typeof lessonScriptButtonHtml === 'function' ? lessonScriptButtonHtml(mod, currentLessonTab) : '';") && api.includes('return `${script}${practice}'), '이 탭 생성 앞에 둔다');
    assert.ok(api.includes('window.applyLessonScriptView?.(mod);') && api.includes('window.leaveLessonScriptView?.();') && api.includes('window.keepLessonScriptView?.();'));
});

test('이스케이프: AI가 쓴 HTML·스크립트는 글자로만 보이고, [행동 지시]만 표시한다', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    withAllScripts(ctx, mod, 'basicLearn', () => '### 강의\n<img src=x onerror="alert(1)"> 설명하겠습니다. [화면: <b>그림</b>]\n[판서: a → b]\nQ. <script>q()</script>\n- <a href="javascript:x">링크</a>');
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    const card = splitOf(ctx).querySelector('[data-script-cell="opening"]');
    assert.ok(!card.querySelector('img, script, a') && Array.from(card.querySelectorAll('b')).every(el => el.textContent === 'Q.'), card.innerHTML);
    assert.ok(card.textContent.includes('<img src=x onerror="alert(1)"> 설명하겠습니다.') && card.textContent.includes('<script>q()</script>'));
    assert.strictEqual(card.querySelector('.ls-cue-inline').textContent, '[화면: <b>그림</b>]');
    assert.strictEqual(card.querySelector('.ls-cue').textContent, '[판서: a → b]');
    assert.ok(card.querySelector('.ls-label').textContent === '강의' && card.querySelector('.ls-q') && card.querySelector('.ls-list li'));
    const html = call(ctx, 'scriptTextHtml')('"\'<>&');
    assert.strictEqual(html, '<p class="ls-say">&quot;&#39;&lt;&gt;&amp;</p>');
});

/* ======================= 내려받기 ======================= */
test('내려받기: {차시 파일 이름}_기본학습_대본.md에 차시 제목, 섹션마다 이름·시간·대본(없으면 없다고, 바뀌었으면 알림)을 담는다. 글은 그대로, HTML 블록 줄만 글자로', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    const rows = plan(ctx, mod).rows;
    [rows[0], rows[1]].forEach(row => {
        const text = `### 강의\n${row.key} 대본입니다. vector<int>와 <b>굵게</b>를 봅니다.\n<div class="x">블록</div>\n   <!-- 주석 -->`;
        mod.lessonScripts = call(ctx, 'withLessonScript')(mod, 'basicLearn', { key: row.key, title: row.title, sourceHash: row.key === 'c:1게임루프의구조' ? '0-0' : row.hash, text }, rows);
    });
    call(ctx, 'downloadLessonScript')(7, 'basicLearn');
    assert.strictEqual(ctx.downloads.length, 1);
    const { md, name } = ctx.downloads[0];
    assert.strictEqual(name, '교과_01차시_게임 루프_기본학습_대본', 'lessonFileBase + 탭 + 대본(downloadMd가 .md를 붙인다)');
    assert.strictEqual(name, `${call(ctx, 'lessonFileBase')(mod)}_기본학습_대본`);
    assert.ok(md.startsWith('# 게임 루프 — 기본학습 강사 대본\n\n> 이 대본은 교안을 바탕으로 AI가 쓴 초안입니다.'), md);
    assert.ok(md.includes('## 수업 시작\n\n- 시간: ⏱ 약 5분 · 수업 시작 후 0분~5분\n- 교안: 개요 · 학습 정보 · 학습 목표\n\n### 강의\nopening 대본입니다. vector<int>와 <b>굵게</b>를 봅니다.\n\\<div class="x">블록</div>\n   \\<!-- 주석 -->'), md);
    assert.ok(md.includes('## 1. 게임 루프의 구조\n\n- 시간: ⏱ 30분 · 수업 시작 후 5분~35분\n- ⚠ 이 대본을 쓴 뒤 교안이 바뀌었습니다.'), md);
    assert.ok(md.includes('## 2. 프레임과 시간\n\n- 시간: ⏱ 20분 · 수업 시작 후 35분~55분\n\n_아직 대본이 없습니다.'), md);
    assert.ok(md.includes('## 마무리 · ✅ 학습 후 체크리스트') && !/^ {0,3}<[A-Za-z!/]/m.test(md), 'HTML 블록으로 그려질 줄은 없다');
    const empty = scriptContext(lesson());
    call(empty, 'downloadLessonScript')(7, 'basicLearn');
    assert.deepStrictEqual([empty.downloads.length, empty.alerts[0]], [0, '아직 쓴 대본이 없습니다. 대본보기를 눌러 대본을 먼저 만들어 주세요.']);
});

/* ======================= 저장 모양 ======================= */
test('저장: 대본을 넣으면 지금 글의 줄 차례로 두고, 지금 글에 없는 줄의 대본(제목이 바뀐 대본)도 뒤에 남기며 차시 객체의 다른 칸은 그대로다', () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    const rows = plan(ctx, mod).rows;
    mod.lessonScripts = { advLearn: { sections: [{ key: 'opening', title: 't', sourceHash: '1-1', text: 'x' }], updatedAt: 'a' }, basicLearn: { sections: [{ key: 'c:옛제목', title: '옛', sourceHash: '1-1', text: '옛 대본' }, { key: 'closing', title: 'c', sourceHash: '1-1', text: '마무리' }] } };
    const before = mod.lessonScripts;
    const at = '2026-11-12T00:00:00.000Z';
    const next = call(ctx, 'withLessonScript')(mod, 'basicLearn', { key: 'opening', title: '수업 시작', sourceHash: rows[0].hash, text: '새 대본', extra: 1 }, rows, at);
    assert.deepStrictEqual(plain(next.basicLearn), { sections: [
        { key: 'opening', title: '수업 시작', sourceHash: rows[0].hash, text: '새 대본', at }, { key: 'closing', title: 'c', sourceHash: '1-1', text: '마무리' },
        { key: 'c:옛제목', title: '옛', sourceHash: '1-1', text: '옛 대본' }
    ], updatedAt: at });
    assert.strictEqual(next.advLearn, before.advLearn, '다른 탭은 그대로');
    assert.strictEqual(mod.lessonScripts, before, '차시는 바꾸지 않고 새 값을 돌려준다');
});

test('저장: 탭마다 80개를 넘으면 제목이 바뀐 대본 가운데 오래된 것부터 뺀다(지금 섹션의 대본은 빼지 않는다)', () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    const rows = plan(ctx, mod).rows;
    const old = Array.from({ length: 80 }, (_, i) => ({ key: `c:옛${i}`, title: `옛${i}`, sourceHash: '1-1', text: 'x', at: `2026-11-${String(10 + (i % 2)).padStart(2, '0')}T00:00:${String(i % 60).padStart(2, '0')}.000Z` }));
    mod.lessonScripts = { basicLearn: { sections: [{ key: 'closing', title: 'c', sourceHash: '1-1', text: '마무리' }, ...old] } };
    const next = call(ctx, 'withLessonScript')(mod, 'basicLearn', { key: 'opening', title: '수업 시작', sourceHash: rows[0].hash, text: '새 대본' }, rows, '2026-11-12T00:00:00.000Z');
    const keys = plain(next.basicLearn.sections.map(item => item.key));
    assert.strictEqual(keys.length, 80);
    assert.deepStrictEqual(keys.slice(0, 2), ['opening', 'closing'], '지금 섹션의 대본이 앞');
    const dropped = old.filter(item => !keys.includes(item.key));
    assert.strictEqual(dropped.length, 2);
    assert.ok(dropped.every(item => item.at.startsWith('2026-11-10')), '가장 오래된 것부터 뺀다');
});

test('제목이 바뀜: 섹션 제목을 고친 뒤 다른 섹션을 다시 만들어도 옛 대본은 지우지 않고 "제목이 바뀐 대본 N개"로 보이며 내려받는 MD 끝에도 붙인다', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    withAllScripts(ctx, mod, 'basicLearn', row => `### 강의\n${row.key} 원래 대본입니다.`);
    vm.runInContext('setTabMarkdown', ctx)(mod, 'basicLearn', LESSON.replace('## 2. 프레임과 시간 (⏱ 20분)', '## 2. 프레임과 시간 관리 (⏱ 20분)'));
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    await settle();
    assert.ok(ctx.confirms[0].message.includes('아직 대본이 없는 섹션 1개(2. 프레임과 시간 관리)'), ctx.confirms[0].message);
    assert.deepStrictEqual(ctx.calls.map(item => item.part), ['«2. 프레임과 시간 관리» · 20분']);
    const keys = plain(mod.lessonScripts.basicLearn.sections.map(item => item.key));
    assert.deepStrictEqual(keys, ['opening', 'c:1게임루프의구조', 'c:2프레임과시간관리', 'closing', 'c:2프레임과시간'], '옛 대본은 뒤에 남는다');
    const cell = splitOf(ctx).querySelector('[data-script-cell="c:1게임루프의구조"]');
    fire(ctx, cell.querySelector('[data-script-action="regen"]'), 'click'); // 다른 섹션 다시 만들기
    await settle();
    assert.ok(mod.lessonScripts.basicLearn.sections.some(item => item.key === 'c:2프레임과시간' && item.text.includes('원래 대본')), '다시 만들어도 지우지 않는다');
    const orphans = splitOf(ctx).querySelector('.lesson-script-orphans');
    assert.ok(orphans && orphans.querySelector('summary').textContent === '제목이 바뀐 대본 1개' && orphans.textContent.includes('c:2프레임과시간 원래 대본입니다.'), orphans && orphans.textContent);
    call(ctx, 'downloadLessonScript')(7, 'basicLearn');
    const { md } = ctx.downloads[0];
    assert.ok(md.includes('## 제목이 바뀐 대본 · 2. 프레임과 시간 (⏱ 20분)\n\n- 교안에서 이 섹션의 제목이 바뀌었거나') && md.includes('c:2프레임과시간 원래 대본입니다.'), md);
    // 대본이 제목이 바뀐 것뿐이어도 내려받을 수 있다
    const only = lesson();
    const octx = scriptContext(only);
    only.lessonScripts = { basicLearn: { sections: [{ key: 'c:사라진섹션', title: '사라진 섹션', sourceHash: '1-1', text: '### 강의\n남은 대본' }] } };
    call(octx, 'downloadLessonScript')(7, 'basicLearn');
    assert.ok(octx.downloads.length === 1 && octx.downloads[0].md.includes('남은 대본'));
});

test('저장 고르기(data-safety.js): 기본학습·심화학습만, 바른 섹션만(열쇠·지문·글·크기·시각·일부 표시), 같은 열쇠는 하나, 80개까지. 바르면 같은 객체, 남길 것이 없으면 칸을 지운다', () => {
    const sctx = { console: quiet, window: {}, JSON, Date, Map, Set, Promise };
    vm.createContext(sctx);
    vm.runInContext(read('data-safety.js'), sctx);
    const { safeLessonScripts, cleanLessonFields, historyEntry } = sctx;
    const entry = (key, extra = {}) => ({ key, title: '제목', sourceHash: 'abc-1z', text: '### 강의\n말입니다.', ...extra });
    const good = { basicLearn: { sections: [entry('opening', { at: '2026-11-12T00:00:00.000Z' }), entry('c:a', { partial: { done: 1, parts: 3 } })], updatedAt: '2026-11-12T00:00:00.000Z' }, advLearn: { sections: [entry('closing')] } };
    assert.strictEqual(safeLessonScripts(good), good, '바르면 같은 객체');
    const odd = safeLessonScripts({
        basicLearn: { sections: [entry('opening'), entry('opening', { text: '겹침' }), entry('c:b', { sourceHash: 'BAD hash' }), entry('c:c', { text: '   ' }), entry('c:d', { text: 'x'.repeat(40001) }),
            entry('k'.repeat(201)), entry('c:e', { title: 5 }), 'not an object', entry('c:f', { extra: 'drop', at: 'x'.repeat(41) }),
            entry('c:g', { partial: { done: 3, parts: 3 } }), entry('c:h', { partial: { done: 0, parts: 2 } }), entry('c:i', { partial: { done: 1, parts: 2, x: 1 } }), entry('c:j', { partial: { done: 1, parts: 2 } })],
        updatedAt: 'x'.repeat(41), other: 1 },
        basicPrac: { sections: [entry('opening')] }, ['__proto__']: { sections: [entry('p')] }, advLearn: 'not a tab', assessment: null
    });
    assert.deepStrictEqual(plain(odd), { basicLearn: { sections: [entry('opening'), entry('c:f'), entry('c:j', { partial: { done: 1, parts: 2 } })] } }, '틀린 일부 표시는 섹션째 뺀다');
    const many = safeLessonScripts({ advLearn: { sections: Array.from({ length: 90 }, (_, i) => entry(`c:${i}`)) } });
    assert.strictEqual(many.advLearn.sections.length, 80);
    const lessonA = cleanLessonFields({ images: {}, lessonScripts: good });
    assert.strictEqual(lessonA.lessonScripts, good);
    const lessonB = cleanLessonFields({ images: {}, lessonScripts: { basicLearn: { sections: [] }, x: 1 } });
    assert.ok(!('lessonScripts' in lessonB), '남길 것이 없으면 칸을 지운다');
    const lessonC = cleanLessonFields({ images: {}, lessonScripts: [entry('opening')] });
    assert.ok(!('lessonScripts' in lessonC));
    const record = historyEntry({ id: 3, title: '차시', content: '글', images: {}, tabContents: { basicLearn: '글' }, lessonScripts: good }, { id: 1, date: 'd' });
    assert.ok(!('lessonScripts' in record), '작업 기록은 대본을 담지 않는다(되돌린 글과 지문이 다르면 화면이 바뀜으로 보인다)');
});

test('비용 미리 보기: 대본 호출은 따로 세고(말 최대 약 3,000자라 본문의 1.5배로 어림, 잰 기록은 대본 호출로 따로), 형식이 틀린 답을 한 번 더 받아 최대 두 배까지 는다고 알린다', () => {
    const ctx = scriptContext(lesson());
    const split = call(ctx, 'estimateCallSplit')({ lessonScripts: 6 });
    assert.deepStrictEqual(plain(split), { body: 0, bodyWait: 0, short: 0, images: 0, scripts: 6 });
    assert.ok(!('scripts' in plain(call(ctx, 'estimateCallSplit')({ tabs: 1 }))), '대본이 없으면 칸도 없다(다른 기능의 셈은 그대로)');
    const opts = { model: 'gemini-2.5-pro', effort: 'medium', timings: {} };
    const summary = call(ctx, 'estimateSummary')({ lessonScripts: 6 }, opts);
    const body = call(ctx, 'secondsPerCall')('gemini-2.5-pro', 'medium', {}).seconds;
    assert.deepStrictEqual([summary.calls, summary.scriptCalls], [6, 6]);
    const minutes = 6 * (body * 1.5 + 2) / 60;
    assert.deepStrictEqual([summary.minutesLow, summary.minutesHigh], [Math.max(1, Math.round(minutes * 0.7)), Math.ceil(minutes * 1.5)]);
    const note = call(ctx, 'estimateNote')(summary, 'gemini-2.5-pro');
    assert.ok(note.includes('강사 대본은 형식이 맞지 않는 답을 한 번 더 받으므로 호출과 시간이 최대 두 배(호출 약 12회)까지 늘 수 있습니다.'), note);
    assert.strictEqual(call(ctx, 'aiTimingKey')('m', 'script'), 'm#script');
    const measured = call(ctx, 'estimateSummary')({ lessonScripts: 6 }, { ...opts, timings: { 'gemini-2.5-pro#script': { count: 5, avg: 60000 } } });
    assert.deepStrictEqual([measured.minutesLow, measured.minutesHigh], [Math.round(6.2 * 0.7), Math.ceil(6.2 * 1.5)], '잰 대본 호출 60초 + 사이 2초');
    assert.ok(read('lesson-script-view.js').includes("timing: 'script'"), '대본 호출은 대본 호출로 잰다');
});

/* ======================= 긴 섹션 조각 ======================= */
const longText = text => `${text} `.repeat(Math.ceil(3500 / (text.length + 1)));
const LONG_LESSON = LESSON.replace('## 2. 프레임과 시간 (⏱ 20분)', [
    '## 2. 긴 섹션 (⏱ 60분)', '', '머리 문단입니다.', '', '### 가. 첫 소주제', '', longText('첫 소주제 설명입니다.'), '', '### 나. 둘째 소주제', '', longText('둘째 소주제 설명입니다.'), '',
    '## 3. 프레임과 시간 (⏱ 20분)'
].join('\n'));
const pieceTag = prompt => (prompt.includes('2조각 가운데 1번째 조각') ? '첫조각' : prompt.includes('2조각 가운데 2번째 조각') ? '둘째조각' : '');
const taggedAnswer = prompt => goodAnswer(prompt).replace('이어서 새 부분을 시작하겠습니다.', `${pieceTag(prompt) || '새'} 부분을 시작하겠습니다.`);

test('조각: 긴 섹션을 쓰다 중지하면 받은 조각을 "일부만 쓴 대본"으로 남기고, 다시 누르면 남은 조각부터 이어 쓴다', async () => {
    const mod = lesson(LONG_LESSON);
    const ctx = scriptContext(mod);
    assert.strictEqual(plan(ctx, mod).rows.find(row => row.key === 'c:2긴섹션') && call(ctx, 'scriptRowUnits')(plan(ctx, mod).rows[2]).length, 2);
    ctx.reply = prompt => {
        if (pieceTag(prompt) === '첫조각') ctx.requestLessonPipelineStop();
        return taggedAnswer(prompt);
    };
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    await settle();
    assert.strictEqual(ctx.confirms[0].work.lessonScripts, 6, '줄 5개, 긴 섹션은 조각 2개');
    assert.deepStrictEqual(ctx.calls.map(item => pieceTag(item.prompt) || item.part.split(' · ')[0]), ['«수업 시작»', '«1. 게임 루프의 구조»', '첫조각']);
    const partial = mod.lessonScripts.basicLearn.sections.find(item => item.key === 'c:2긴섹션');
    assert.deepStrictEqual(plain(partial.partial), { done: 1, parts: 2 }, '받은 조각은 버리지 않는다');
    assert.ok(partial.text.includes('첫조각 부분을 시작하겠습니다.'));
    const toast = ctx.toasts.find(([text]) => text.includes('대본 쓰기를 멈췄습니다'));
    assert.ok(toast && toast[0].includes('섹션 2개의 대본을 썼습니다. «2. 긴 섹션»은 조각 1/2까지 써 두었습니다. 2개는 아직 쓰지 않았습니다. 대본보기를 다시 누르면 남은 조각과 남은 섹션만 이어서 씁니다.'), JSON.stringify(ctx.toasts));
    const p = plan(ctx, mod);
    assert.deepStrictEqual([p.states.get('c:2긴섹션'), p.written, p.missing.length], ['partial', 2, 3]);
    const cell = splitOf(ctx).querySelector('[data-script-cell="c:2긴섹션"]');
    assert.ok(cell.textContent.includes('조각 1/2까지만 썼습니다') && cell.querySelector('[data-script-action="regen"]').textContent === '남은 조각 쓰기', cell.textContent);
    // 다시 누르면 남은 조각과 남은 섹션만
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    ctx.reply = prompt => taggedAnswer(prompt);
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    await settle();
    assert.ok(ctx.confirms[1].message.includes('조각을 일부 써 둔 섹션 1개는 남은 조각만 씁니다') && ctx.confirms[1].work.lessonScripts === 3, ctx.confirms[1].message);
    assert.deepStrictEqual(ctx.calls.slice(3).map(item => pieceTag(item.prompt) || item.part.split(' · ')[0]), ['둘째조각', '«3. 프레임과 시간»', '«마무리']);
    const done = mod.lessonScripts.basicLearn.sections.find(item => item.key === 'c:2긴섹션');
    assert.ok(!('partial' in done), '다 쓰면 일부 표시를 지운다');
    assert.ok(done.text.startsWith('### 들어가며\n첫조각 부분을 시작하겠습니다.') && done.text.includes('둘째조각 부분을 시작하겠습니다.'), done.text);
    assert.strictEqual(plan(ctx, mod).missing.length, 0);
});

test('조각: 조각이 올 때마다 대본 크기를 보고, 40,000자를 넘으면 남은 조각을 부르지 않고 그 섹션만 멈춘다', async () => {
    const mod = lesson(LONG_LESSON);
    const ctx = scriptContext(mod);
    const huge = Array.from({ length: 2200 }, (_, i) => `${i}. 긴 설명을 이어서 하겠습니다.`).join('\n');
    ctx.reply = prompt => (pieceTag(prompt) === '첫조각' ? goodAnswer(prompt, { body: huge }) : goodAnswer(prompt));
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    await settle();
    assert.deepStrictEqual(ctx.calls.filter(item => pieceTag(item.prompt)).map(item => pieceTag(item.prompt)), ['첫조각'], '둘째 조각은 부르지 않는다');
    assert.ok(!mod.lessonScripts.basicLearn.sections.some(item => item.key === 'c:2긴섹션'));
    const cell = splitOf(ctx).querySelector('[data-script-cell="c:2긴섹션"]');
    assert.ok(cell.textContent.includes('대본이 너무 깁니다(조각 1/2까지') && cell.textContent.includes('40,000자까지 저장'), cell.textContent);
    assert.strictEqual(mod.lessonScripts.basicLearn.sections.length, 4, '다른 섹션은 쓴다');
});

/* ======================= 교과 ======================= */
test('교과: 다른 교과의 같은 번호 차시와 쓰는 중 표시·쓰지 못한 까닭이 섞이지 않는다(차시 객체로 가린다)', async () => {
    const modA = lesson();
    const ctx = scriptContext(modA);
    ctx.reply = prompt => (prompt.includes('«1. 게임 루프의 구조»') ? '대본입니다.' : goodAnswer(prompt));
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    await settle();
    assert.ok(splitOf(ctx).querySelector('[data-script-cell="c:1게임루프의구조"]').textContent.includes('쓰지 못했습니다'));
    const modB = lesson();
    Object.assign(ctx, { modA, modB });
    vm.runInContext("globalState.subjects.push({ id: 's2', title: '다른 교과', lessons: [window.modB] }); currentSubjectId = 's2'; courseData = globalState.subjects[1].lessons; window.currentMod = window.modB;", ctx);
    call(ctx, 'renderEditor')(modB);
    assert.ok(!splitOf(ctx), '다른 교과로 옮기면 대본 화면을 닫는다');
    withAllScripts(ctx, modB);
    vm.runInContext("_scriptJob = { mod: window.modA, tabId: 'basicLearn', current: 'c:2프레임과시간', pending: new Set(['closing']) }", ctx);
    assert.strictEqual(call(ctx, 'scriptJobFor')(modB, 'basicLearn'), null);
    assert.ok(call(ctx, 'scriptJobFor')(modA, 'basicLearn'));
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    const box = splitOf(ctx);
    assert.ok(box, 'B 교과 차시의 대본 화면');
    assert.ok(!box.textContent.includes('쓰지 못했습니다'), 'A 교과 차시의 실패가 보이지 않는다');
    assert.ok(!box.textContent.includes('대본을 쓰고 있습니다') && !box.textContent.includes('차례를 기다리고'), 'A 교과 차시의 쓰는 중 표시가 보이지 않는다');
    assert.strictEqual(call(ctx, 'scriptFailureOf')(modB, 'basicLearn', 'c:1게임루프의구조'), '');
    assert.ok(call(ctx, 'scriptFailureOf')(modA, 'basicLearn', 'c:1게임루프의구조').includes('@@본문@@'));
    vm.runInContext('_scriptJob = null', ctx);
});

/* ======================= 코드 복사 ======================= */
test('코드 복사: 대본 화면의 교안 칸에서도 코드 블록 복사 단추가 돈다. 그림 다시 찾기 같은 고치는 단추는 돌지 않는다', async () => {
    const mod = lesson();
    const ctx = scriptContext(mod);
    ctx.copied = [];
    ctx.regenerated = 0;
    ctx.promptRegenerateImage = () => { ctx.regenerated += 1; };
    vm.runInContext('copyPlainText = async text => { window.copied.push(text); };', ctx);
    withAllScripts(ctx, mod);
    await call(ctx, 'toggleLessonScript')(7, 'basicLearn');
    const copy = splitOf(ctx).querySelector('.lesson-script-lesson [data-lesson-action="copy-code"]');
    assert.ok(copy, '코드 블록에 복사 단추가 있다');
    fire(ctx, copy, 'click');
    await settle();
    assert.deepStrictEqual(ctx.copied, ['// 매 프레임 부르는 함수\nfunction update() {}']);
    assert.ok(ctx.toasts.some(([text]) => text === '코드를 복사했습니다.'));
    const regen = ctx.document.createElement('button');
    regen.setAttribute('data-lesson-action', 'regenerate-image');
    splitOf(ctx).querySelector('.lesson-script-lesson').appendChild(regen);
    fire(ctx, regen, 'click');
    assert.strictEqual(ctx.regenerated, 0, '대본 화면에서는 그림을 다시 찾지 않는다');
    const css = fs.readFileSync(path.join(rootDir, 'css', 'lesson-script.css'), 'utf8');
    assert.ok(css.includes('#lesson-script-view .lesson-code-copy {') && css.includes('[data-lesson-action]:not([data-lesson-action="copy-code"])'), '복사 단추는 보이고 다른 단추는 숨긴다');
});

test('연결: index.html이 lesson-script.js·lesson-script-view.js를 course-refs.js 뒤에, CSS를 교수안 CSS 뒤에 이웃과 같은 ?v=로 싣는다. README에 적는다', () => {
    const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script src="\.\/js\/([\w./-]+)\.js\?v=(\d+)"><\/script>/g)].map(match => [match[1], match[2]]);
    const order = scripts.map(([name]) => name);
    assert.strictEqual(order.indexOf('lesson-script'), order.indexOf('course-refs') + 1, order.join(','));
    assert.strictEqual(order.indexOf('lesson-script-view'), order.indexOf('lesson-script') + 1);
    assert.strictEqual(new Set(scripts.map(([, v]) => v)).size, 1, '새 태그도 이웃과 같은 ?v=');
    assert.ok(html.includes('<link rel="stylesheet" href="./css/gyosuan-doc.css?v=125">\r\n    <link rel="stylesheet" href="./css/lesson-script.css?v=125">') || html.includes('<link rel="stylesheet" href="./css/gyosuan-doc.css?v=125">\n    <link rel="stylesheet" href="./css/lesson-script.css?v=125">'));
    assert.ok(fs.existsSync(path.join(rootDir, 'css', 'lesson-script.css')));
    const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
    assert.ok(readme.includes('lesson-script.js') && readme.includes('lesson-script-view.js'));
});

(async () => {
    for (const { name, fn } of pending) {
        count++;
        try {
            await fn();
            console.log(`ok - ${name}`);
        } catch (err) {
            failed++;
            console.log(`FAIL - ${name}\n  ${err.stack || err.message}`);
        }
    }
    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
