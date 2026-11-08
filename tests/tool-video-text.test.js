// 도구 '동영상 넣기'·'텍스트 블록 넣기' 테스트 (실행: node tests/tool-video-text.test.js)
// 실제 lesson-insert-tools.js·image-slot-place.js(자리 고르기)·api.js(보기 화면)·lesson-format.js·lesson-review.js(작업 기록)·format-toolbar.js(Ctrl+Z)·
// lesson-sanitize.js(정리)·lesson-export.js(HTML 내보내기)·tabs.js(쓰지 않는 동영상 정리)·output-import.js(다시 불러오기 안내)를 vm에서 돌린다.
// 보기 화면은 domino로 흉내 내고 블록 자리는 getBoundingClientRect로 정한다. 저장·백업·작업 기록은 data-safety.js·state-store.js를 따로 불러 본다.
// 네트워크는 부르지 않는다(동영상 주소는 글자로만 다룬다). 처음 한 번: npm install --no-save marked@15.0.12 turndown@7.2.4
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
const MP4_BYTES = Buffer.from('\u0000\u0000\u0000\u0018ftypmp42teacher-video-bytes'.repeat(400), 'binary');
const MP4 = `data:video/mp4;base64,${MP4_BYTES.toString('base64')}`;
const WEBM = `data:video/webm;base64,${Buffer.from('webm-bytes'.repeat(900)).toString('base64')}`;
const PNG = `data:image/png;base64,${'iVBORw0KGgo'.repeat(20)}`;
const FILES = ['data.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js',
    'lesson-review.js', 'lesson-sanitize.js', 'lesson-format.js', 'lesson-export.js', 'import-stream.js', 'output-import.js', 'format-toolbar.js', 'md-toolbar.js',
    'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js', 'image-slot-place.js', 'lesson-insert-tools.js'];

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

const tabsOf = basicLearn => ({ basicLearn, basicPrac: null, advLearn: null, advPrac: null, assessment: '## 학습이해도\n\n1. 게임 루프는 무엇인가?\n', advAssessment: null });
const lesson = (md = LESSON, extra = {}) => ({ id: 7, title: '1차시 게임 루프', tabContents: tabsOf(md), content: md, images: {}, ...extra });

// 보기 화면 컨텍스트. 앱 창(openAppDialog)은 흉내 낸다: 닫기는 칸을 지우고, dismiss(Esc·바깥 클릭)는 onDismiss를 부른다
function toolContext(mod, { tabId = 'basicLearn' } = {}) {
    const doc = domino.createDocument([
        '<html><body>',
        '<details id="lesson-tools-menu"><summary>도구</summary><button id="video-insert-btn" type="button">동영상 넣기</button></details>',
        '<div id="editor-content-area"><div id="lesson-page"><div id="render-view" class="markdown-body"></div><textarea id="raw-view" class="hidden"></textarea></div></div>',
        '<div id="lesson-nav">탭 줄</div>',
        '</body></html>'
    ].join(''), true);
    patchDomino(doc);
    const ctx = {
        console: quiet, document: doc, Promise, URL, Blob, AbortController, Proxy, setTimeout, clearTimeout, atob, btoa, Uint8Array, ArrayBuffer,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        marked: ownMarked(), NodeFilter,
        DOMParser: function DOMParser() { this.parseFromString = html => domino.createDocument(String(html), true); },
        currentMod: mod, toasts: [], alerts: [], asked: [], archived: [], dialogs: [],
        saves: 0, rendered: 0, confirmAnswer: true
    };
    ctx.window = ctx;
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.saveState = async () => { ctx.saves += 1; return true; };
    ctx.archiveContent = async (entry, reason) => { ctx.archived.push({ content: entry.content, tabId: entry.tabId, reason, entry }); };
    ctx.renderSidebar = () => {};
    ctx.syncGyosuanView = () => {};
    ctx.DBManager = { getCache: async () => null, setCache: async () => {} };
    ctx.openAppDialog = (overlay, opts = {}) => {
        const entry = { overlay, opts, close: () => overlay.remove(), dismiss: reason => (opts.onDismiss ? opts.onDismiss(reason) : overlay.remove()) };
        ctx.dialogs.push(entry);
        return { tooSoon: () => false, close: entry.close };
    };
    vm.createContext(ctx);
    vm.runInContext(sliceSource(read('ui.js'), 'function escapeHtml('), ctx);
    FILES.forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    ctx.confirmAsync = async (message, opts) => { ctx.asked.push({ message, opts }); return ctx.confirmAnswer; };
    vm.runInContext(`globalState = { subjects: [{ id: 's1', title: '교과', lessons: [window.currentMod] }] }; currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons;
        currentEditingModuleId = window.currentMod.id; currentLessonTab = ${JSON.stringify(tabId)}; _lessonPanel = null;
        getEditingModule = (id = currentEditingModuleId) => (String(id) === String(window.currentMod?.id) ? window.currentMod : null);
        renderEditor = mod => { window.rendered += 1; window.drawView(mod); }; renderSidebar = () => {};`, ctx);
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
const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(resolve => setImmediate(resolve)); };
const stored = mod => mod.tabContents.basicLearn;
const placing = ctx => ctx.document.body.classList.contains('image-slot-placing');
const query = (ctx, selector) => ctx.document.querySelector(selector) || null;
const fakeFile = (name, type, bytes = MP4_BYTES, size = bytes.length) => ({ name, type, size, arrayBuffer: async () => Uint8Array.from(bytes).buffer });

// 도구를 누르고 그 블록의 위·아래를 누른 뒤 창이 뜰 때까지 기다린다
async function pickSpot(ctx, tool, el, where) {
    ctx[tool]();
    fire(ctx, el, 'click', where(el));
    await settle();
}
async function chooseUrl(ctx, url) {
    query(ctx, '[data-video-url]').value = url;
    fire(ctx, query(ctx, '[data-video-ok]'), 'click');
    await settle();
}
async function chooseFile(ctx, file) {
    const input = query(ctx, '[data-video-file]');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    fire(ctx, input, 'change');
    await settle();
}
async function writeText(ctx, text) {
    query(ctx, '[data-text-block]').value = text;
    fire(ctx, query(ctx, '[data-text-ok]'), 'click');
    await settle();
}
const snippetUrl = id => `<div class="lesson-video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="동영상"></iframe><p class="lesson-video-caption">동영상: <a href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">YouTube에서 보기</a></p></div>`;

let failed = 0;
let count = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

/* ======================= 동영상 주소 읽기 ======================= */
test('동영상 주소: YouTube(watch·짧은 주소·youtu.be·embed·nocookie)는 youtube-nocookie 삽입 주소로, 시작 시각(t·start)도 옮긴다', () => {
    const ctx = toolContext(lesson());
    const parse = call(ctx, 'parseLessonVideoUrl');
    const id = 'dQw4w9WgXcQ';
    const embed = `https://www.youtube-nocookie.com/embed/${id}`;
    [
        `https://www.youtube.com/watch?v=${id}`, `https://youtube.com/watch?feature=share&v=${id}`, `https://m.youtube.com/watch?v=${id}`,
        `https://www.youtube.com/shorts/${id}`, `https://youtu.be/${id}?si=AbCdEf`, `https://www.youtube.com/embed/${id}`,
        `https://www.youtube-nocookie.com/embed/${id}`, `  https://youtu.be/${id}  `, `http://www.youtube.com/watch?v=${id}`
    ].forEach(url => {
        const video = parse(url);
        assert.ok(video, url);
        assert.deepStrictEqual([video.kind, video.src, video.link], ['youtube', embed, `https://www.youtube.com/watch?v=${id}`], url);
    });
    assert.strictEqual(parse(`https://www.youtube.com/watch?v=${id}&t=90`).src, `${embed}?start=90`);
    assert.strictEqual(parse(`https://youtu.be/${id}?t=1m30s`).src, `${embed}?start=90`);
    assert.strictEqual(parse(`https://www.youtube.com/embed/${id}?start=15`).src, `${embed}?start=15`);
});

test('동영상 주소: Vimeo는 player.vimeo.com(dnt=1)로, .mp4·.webm 주소는 파일 그대로, 그 밖은 받지 않는다', () => {
    const ctx = toolContext(lesson());
    const parse = call(ctx, 'parseLessonVideoUrl');
    assert.deepStrictEqual(plain(parse('https://vimeo.com/123456789')), { kind: 'vimeo', id: '123456789', src: 'https://player.vimeo.com/video/123456789?dnt=1', link: 'https://vimeo.com/123456789' });
    assert.strictEqual(parse('https://vimeo.com/123456789/abcdef1234').src, 'https://player.vimeo.com/video/123456789?h=abcdef1234&dnt=1', '비공개 링크의 해시');
    assert.strictEqual(parse('https://player.vimeo.com/video/123456789').src, 'https://player.vimeo.com/video/123456789?dnt=1');
    const mp4 = parse('https://example.com/clips/loop.mp4');
    assert.deepStrictEqual([mp4.kind, mp4.src, mp4.type], ['file', 'https://example.com/clips/loop.mp4', 'video/mp4']);
    assert.strictEqual(parse('https://cdn.example.com/a/b.WEBM?x=1').type, 'video/webm');
    [
        '', '   ', 'javascript:alert(1)', 'data:video/mp4;base64,AAAA', 'ftp://example.com/a.mp4', 'https://example.com/a.avi', 'https://example.com/mp4',
        'https://www.youtube.com/watch?v=short', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
        'https://evil.com/embed/dQw4w9WgXcQ', 'https://vimeo.com/abc', 'https://user:pw@example.com/a.mp4', 'https://example.com/a.mp4 onerror=x',
        'https://www.youtube.com/@channel', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ"onload="x'
    ].forEach(url => assert.strictEqual(parse(url), null, `받지 않는다: ${url}`));
});

test('동영상 파일: mp4·webm만, 50MB가 넘으면 묻고, 100MB가 넘거나 빈 파일이면 넣지 않는다', () => {
    const ctx = toolContext(lesson());
    const check = call(ctx, 'lessonVideoFileCheck');
    const MB = 1024 * 1024;
    assert.deepStrictEqual(plain(check({ name: 'loop.mp4', type: 'video/mp4', size: 10 * MB })), { ok: true, type: 'video/mp4', warn: false, size: 10 * MB });
    assert.deepStrictEqual([check({ name: 'loop.webm', type: '', size: MB }).type, check({ name: 'a.MP4', type: 'application/octet-stream', size: MB }).type], ['video/webm', 'video/mp4'], '형식을 모르면 확장자로');
    assert.deepStrictEqual([check({ name: 'big.mp4', type: 'video/mp4', size: 60 * MB }).ok, check({ name: 'big.mp4', type: 'video/mp4', size: 60 * MB }).warn], [true, true]);
    const tooBig = check({ name: 'huge.mp4', type: 'video/mp4', size: 150 * MB });
    assert.ok(!tooBig.ok && tooBig.reason.includes('150MB') && tooBig.reason.includes('100MB'), tooBig.reason);
    assert.strictEqual(check({ name: 'clip.mov', type: 'video/quicktime', size: MB }).ok, false);
    assert.strictEqual(check({ name: 'clip.avi', type: '', size: MB }).ok, false);
    assert.strictEqual(check({ name: 'empty.mp4', type: 'video/mp4', size: 0 }).ok, false);
});

/* ======================= 정리(sanitize) ======================= */
test('정리: 허용한 삽입 주소(youtube-nocookie·player.vimeo.com)의 iframe만 새로 만들어 남기고, 다른 iframe·스크립트·핸들러는 지운다', () => {
    const ctx = toolContext(lesson());
    const clean = call(ctx, 'sanitizeLessonHtml');
    const frameOf = html => {
        const box = ctx.document.createElement('div');
        box.innerHTML = clean(html);
        return [...box.querySelectorAll('iframe')];
    };
    const good = frameOf('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" onload="alert(1)" srcdoc="<script>alert(1)</script>" allow="camera; microphone" name="x"><p>안쪽</p></iframe>');
    assert.strictEqual(good.length, 1);
    const frame = good[0];
    assert.strictEqual(frame.getAttribute('src'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    assert.deepStrictEqual(['onload', 'srcdoc', 'name'].map(name => frame.hasAttribute(name)), [false, false, false], '핸들러·srcdoc·다른 속성은 없다');
    assert.ok(!/camera|microphone/.test(frame.getAttribute('allow') || ''), '카메라·마이크는 허용하지 않는다');
    assert.ok((frame.getAttribute('sandbox') || '').includes('allow-scripts') && !(frame.getAttribute('sandbox') || '').includes('allow-top-navigation'), frame.getAttribute('sandbox'));
    assert.ok(frame.hasAttribute('allowfullscreen') && frame.childNodes.length === 0, '전체 화면만 열고 안쪽 글은 버린다');
    assert.strictEqual(frameOf('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=30&autoplay=1"></iframe>')[0].getAttribute('src'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30', 'youtube.com 삽입은 nocookie로 바꾸고 시작 시각만 둔다');
    assert.strictEqual(frameOf('<iframe src="https://player.vimeo.com/video/123456789?h=abcdef1234&autoplay=1"></iframe>')[0].getAttribute('src'), 'https://player.vimeo.com/video/123456789?h=abcdef1234&dnt=1');
    [
        '<iframe src="https://evil.com/embed/dQw4w9WgXcQ"></iframe>', '<iframe src="javascript:alert(1)"></iframe>', '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
        '<iframe src="https://www.youtube-nocookie.com.evil.com/embed/dQw4w9WgXcQ"></iframe>', '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ/../../x"></iframe>',
        '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>', '<iframe src="https://player.vimeo.com/video/123/../../evil"></iframe>',
        '<iframe src="https://user:pw@www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>'
    ].forEach(html => assert.strictEqual(frameOf(html).length, 0, `지운다: ${html}`));
    const rest = clean('<script>alert(1)</script><object data="x"></object><embed src="x"><video controls src="javascript:alert(1)" onerror="alert(1)"></video><video controls src="local:vid_abc123def456"></video><a href="javascript:alert(1)">x</a>');
    assert.ok(!/<script|<object|<embed|onerror|javascript:/i.test(rest), rest);
    assert.ok(rest.includes('<video controls="" src="local:vid_abc123def456"></video>') || rest.includes('<video controls src="local:vid_abc123def456"></video>'), rest);
});

test('정리: 넣은 동영상 줄을 마크다운으로 그려도 플레이어가 남는다(renderLessonHTML)', () => {
    const ctx = toolContext(lesson());
    const html = call(ctx, 'renderLessonHTML')(`앞 단락\n\n${snippetUrl('dQw4w9WgXcQ')}\n\n뒤 단락\n`);
    assert.ok(html.includes('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"') && html.includes('YouTube에서 보기'), html);
    const local = call(ctx, 'renderLessonHTML')(call(ctx, 'inlineLessonImages')('<div class="lesson-video"><video controls preload="metadata" src="local:vid_abc123def456"></video><p class="lesson-video-caption">동영상: 루프.mp4</p></div>\n', {}));
    assert.ok(local.includes('src="local:vid_abc123def456"') && !local.includes('이미지 생성 누락'), '없는 그림 자리처럼 비우지 않는다');
});

/* ======================= 동영상 넣기(주소) ======================= */
test('동영상 넣기(주소): 누른 블록 아래에 따로 선 동영상 블록을 넣고 작업 기록에 남긴 뒤 보기 화면에 플레이어를 그린다. Ctrl+Z로 되돌린다', async () => {
    const mod = lesson();
    const ctx = toolContext(mod);
    await pickSpot(ctx, 'insertLessonVideo', block(ctx, '매 프레임 되풀이'), lower);
    assert.strictEqual(placing(ctx), false, '누르면 자리 고르기를 끝내고 창을 띄운다');
    assert.ok(query(ctx, '[data-video-url]') && query(ctx, '[data-video-file]') && query(ctx, '[data-video-pick]'), '주소 칸과 파일 고르기(키보드로 누를 수 있는 버튼)가 있다');
    let opened = 0;
    Object.defineProperty(query(ctx, '[data-video-file]'), 'click', { configurable: true, value: () => { opened += 1; } });
    fire(ctx, query(ctx, '[data-video-pick]'), 'click');
    assert.strictEqual(opened, 1, '버튼이 파일 고르기 창을 연다');
    assert.strictEqual(stored(mod), LESSON, '창을 띄운 동안은 글을 바꾸지 않는다');
    await chooseUrl(ctx, 'https://youtu.be/dQw4w9WgXcQ');
    const next = LESSON.replace('되풀이합니다\n\n', `되풀이합니다\n\n${snippetUrl('dQw4w9WgXcQ')}\n\n`);
    assert.strictEqual(stored(mod), next);
    assert.strictEqual(query(ctx, '[data-video-url]'), null, '창을 닫는다');
    assert.deepStrictEqual(ctx.archived.map(item => [item.content, item.tabId, item.reason]), [[LESSON, 'basicLearn', '동영상 넣기 전']]);
    assert.strictEqual(mod.history[0].note, '동영상 넣기 (기본학습)');
    const frame = viewOf(ctx).querySelector('.lesson-video iframe');
    assert.ok(frame && frame.getAttribute('src') === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', '보기 화면에 삽입 플레이어');
    assert.ok(ctx.toasts.at(-1)[0].includes('Ctrl+Z') && ctx.toasts.at(-1)[1] === 'success', ctx.toasts.at(-1)[0]);
    const blocks = call(ctx, 'lessonBlocks')(stored(mod));
    assert.ok(blocks.some(item => item.token.type === 'html' && item.raw.trim() === snippetUrl('dQw4w9WgXcQ')), '따로 선 블록이다');
    call(ctx, 'formatUndo')({ preventDefault() {} });
    await settle();
    assert.strictEqual(stored(mod), LESSON, 'Ctrl+Z로 넣기 전 글로 돌아간다');
});

test('동영상 넣기(주소): 위쪽은 그 블록 앞, 목록·코드 블록은 통째로 앞뒤, mp4 주소는 <video controls>, 동영상 블록 옆에도 넣는다', async () => {
    const mod = lesson();
    const ctx = toolContext(mod);
    await pickSpot(ctx, 'insertLessonVideo', block(ctx, '2. 레벨 디자인'), upper);
    await chooseUrl(ctx, 'https://example.com/clips/loop.mp4');
    const fileSnippet = '<div class="lesson-video"><video controls preload="metadata" src="https://example.com/clips/loop.mp4"></video><p class="lesson-video-caption">동영상: <a href="https://example.com/clips/loop.mp4" target="_blank" rel="noopener noreferrer">동영상 파일 주소</a></p></div>';
    assert.strictEqual(stored(mod), LESSON.replace('```\n\n## 2. 레벨 디자인', `\`\`\`\n\n${fileSnippet}\n\n## 2. 레벨 디자인`));
    const player = viewOf(ctx).querySelector('.lesson-video video');
    assert.ok(player && player.getAttribute('src') === 'https://example.com/clips/loop.mp4' && player.hasAttribute('controls'));
    await pickSpot(ctx, 'insertLessonVideo', block(ctx, '입력 처리'), lower);
    await chooseUrl(ctx, 'https://vimeo.com/123456789');
    assert.ok(stored(mod).includes('- 상태 갱신\n\n<div class="lesson-video"><iframe src="https://player.vimeo.com/video/123456789?dnt=1"'), '목록 항목 사이가 아니라 목록 끝');
    const videoBlock = [...viewOf(ctx).children].find(el => el.querySelector?.('video'));
    await pickSpot(ctx, 'insertLessonVideo', videoBlock, lower);
    await chooseUrl(ctx, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.ok(stored(mod).includes(`${fileSnippet}\n\n${snippetUrl('dQw4w9WgXcQ')}\n\n## 2. 레벨 디자인`), '방금 넣은 동영상 블록 아래');
});

test('동영상 넣기 창: 받을 수 없는 주소는 창 안에 까닭을 보이고 그대로 둔다. 취소·Esc는 아무것도 바꾸지 않는다', async () => {
    const mod = lesson();
    const ctx = toolContext(mod);
    await pickSpot(ctx, 'insertLessonVideo', block(ctx, '매 프레임 되풀이'), lower);
    await chooseUrl(ctx, 'https://evil.com/watch?v=dQw4w9WgXcQ');
    const error = query(ctx, '[data-video-error]');
    assert.ok(error && !error.classList.contains('hidden') && error.textContent.includes('YouTube'), '창 안 안내');
    assert.ok(query(ctx, '[data-video-url]'), '창은 그대로');
    await chooseUrl(ctx, '');
    assert.ok(query(ctx, '[data-video-error]').textContent.includes('주소'), '빈 주소');
    fire(ctx, query(ctx, '[data-video-cancel]'), 'click');
    await settle();
    assert.deepStrictEqual([stored(mod), ctx.archived.length, query(ctx, '[data-video-url]')], [LESSON, 0, null]);
    assert.ok(ctx.toasts.at(-1)[0].includes('그만두었습니다'));
    await pickSpot(ctx, 'insertLessonVideo', block(ctx, '매 프레임 되풀이'), lower);
    ctx.dialogs.at(-1).dismiss('escape');
    await settle();
    assert.deepStrictEqual([stored(mod), ctx.archived.length, query(ctx, '[data-video-url]')], [LESSON, 0, null], 'Esc');
    ctx.insertLessonVideo();
    fire(ctx, ctx.document.body, 'keydown', { key: 'Escape' });
    assert.strictEqual(placing(ctx), false, '자리 고르기 중 Esc는 그만둔다');
});

/* ======================= 동영상 넣기(내 PC 파일) ======================= */
test('동영상 넣기(파일): 차시의 lessonVideos에 data URL로 두고 글에는 local:동영상 키로 넣는다. 보기 화면은 그 파일을 재생한다', async () => {
    const mod = lesson();
    const ctx = toolContext(mod);
    await pickSpot(ctx, 'insertLessonVideo', block(ctx, '매 프레임 되풀이'), lower);
    await chooseFile(ctx, fakeFile('게임 루프 "시연".mp4', 'video/mp4'));
    const keys = Object.keys(mod.lessonVideos || {});
    assert.strictEqual(keys.length, 1);
    assert.ok(/^vid_[a-z0-9]{6,40}$/.test(keys[0]), keys[0]);
    assert.strictEqual(mod.lessonVideos[keys[0]], MP4, '파일 바이트 그대로');
    const snippet = `<div class="lesson-video"><video controls preload="metadata" src="local:${keys[0]}"></video><p class="lesson-video-caption">동영상: 게임 루프 &quot;시연&quot;.mp4</p></div>`;
    assert.strictEqual(stored(mod), LESSON.replace('되풀이합니다\n\n', `되풀이합니다\n\n${snippet}\n\n`));
    assert.ok(ctx.saves > 0, '저장했다');
    const player = viewOf(ctx).querySelector('.lesson-video video');
    assert.strictEqual(player.getAttribute('data-video-id'), keys[0]);
    assert.ok(/^(blob:|data:video\/mp4;base64,)/.test(player.getAttribute('src') || ''), player.getAttribute('src'));
    assert.ok(ctx.toasts.at(-1)[0].includes('백업') && ctx.toasts.at(-1)[1] === 'success', ctx.toasts.at(-1)[0]);
    // Ctrl+Z: 글을 되돌린다. 동영상 값은 쓰지 않는 그림처럼 정리할 때 빠진다(tabs.js dropUnusedLessonImages)
    call(ctx, 'formatUndo')({ preventDefault() {} });
    await settle();
    assert.strictEqual(stored(mod), LESSON);
    call(ctx, 'dropUnusedLessonImages')(mod);
    assert.deepStrictEqual(plain(mod.lessonVideos), {}, '어느 글도 가리키지 않으면 정리된다');
});

test('동영상 넣기(파일): 50MB가 넘으면 묻고(아니오면 넣지 않는다), 100MB가 넘거나 mp4·webm이 아니면 알리고 넣지 않는다', async () => {
    const mod = lesson();
    const ctx = toolContext(mod);
    const MB = 1024 * 1024;
    ctx.confirmAnswer = false;
    await pickSpot(ctx, 'insertLessonVideo', block(ctx, '매 프레임 되풀이'), lower);
    await chooseFile(ctx, fakeFile('big.mp4', 'video/mp4', MP4_BYTES, 60 * MB));
    assert.ok(ctx.asked.length === 1 && ctx.asked[0].message.includes('60MB') && ctx.asked[0].message.includes('50MB'), ctx.asked[0]?.message);
    assert.deepStrictEqual([stored(mod), Object.keys(mod.lessonVideos || {}).length], [LESSON, 0]);
    await pickSpot(ctx, 'insertLessonVideo', block(ctx, '매 프레임 되풀이'), lower);
    await chooseFile(ctx, fakeFile('huge.mp4', 'video/mp4', MP4_BYTES, 150 * MB));
    assert.ok(ctx.alerts.at(-1).includes('100MB'), ctx.alerts.at(-1));
    await pickSpot(ctx, 'insertLessonVideo', block(ctx, '매 프레임 되풀이'), lower);
    await chooseFile(ctx, fakeFile('clip.mov', 'video/quicktime'));
    assert.ok(ctx.alerts.at(-1).includes('mp4'), ctx.alerts.at(-1));
    assert.deepStrictEqual([stored(mod), Object.keys(mod.lessonVideos || {}).length, ctx.archived.length], [LESSON, 0, 0]);
    ctx.confirmAnswer = true;
    await pickSpot(ctx, 'insertLessonVideo', block(ctx, '매 프레임 되풀이'), lower);
    await chooseFile(ctx, fakeFile('big.webm', 'video/webm', Buffer.from('webm-bytes'.repeat(900)), 60 * MB));
    assert.strictEqual(Object.values(mod.lessonVideos)[0], WEBM, '예라고 하면 넣는다');
});

test('동영상 넣기(파일): 작업 기록에 남기지 못해 넣지 못하면 차시에 둔 파일을 거두고 글도 그대로 둔다(다른 동영상은 그대로)', async () => {
    const mod = lesson(LESSON, { lessonVideos: { vid_keep00000000: WEBM } });
    const ctx = toolContext(mod);
    ctx.archiveContent = async () => { throw new Error('기록 저장 실패'); };
    await pickSpot(ctx, 'insertLessonVideo', block(ctx, '매 프레임 되풀이'), lower);
    await chooseFile(ctx, fakeFile('loop.mp4', 'video/mp4'));
    assert.deepStrictEqual([stored(mod), Object.keys(mod.lessonVideos)], [LESSON, ['vid_keep00000000']]);
    assert.ok(ctx.toasts.at(-1)[1] === 'error' && ctx.toasts.at(-1)[0].includes('동영상을 넣지 못했습니다'), plain(ctx.toasts.at(-1)));
    const fresh = lesson();
    const ctx2 = toolContext(fresh);
    ctx2.archiveContent = async () => { throw new Error('기록 저장 실패'); };
    await pickSpot(ctx2, 'insertLessonVideo', block(ctx2, '매 프레임 되풀이'), lower);
    await chooseFile(ctx2, fakeFile('loop.mp4', 'video/mp4'));
    assert.strictEqual('lessonVideos' in fresh, false, '처음에 없던 칸은 남기지 않는다');
});

test('동영상 넣기: 학습이해도·심화이해도 탭과 빈 탭, 원문 칸에서는 넣지 않고 알린다', async () => {
    const mod = lesson();
    const bank = toolContext(mod, { tabId: 'assessment' });
    bank.insertLessonVideo();
    assert.ok(bank.alerts.at(-1).includes('학습이해도') && !placing(bank), bank.alerts.at(-1));
    bank.insertTextBlock();
    assert.ok(bank.alerts.at(-1).includes('학습이해도') && !placing(bank), '텍스트 블록도 문제은행 탭에는 넣지 않는다');
    const empty = toolContext(lesson(LESSON), { tabId: 'basicPrac' });
    empty.insertLessonVideo();
    assert.ok(empty.alerts.at(-1).includes('비어 있습니다') && !placing(empty), empty.alerts.at(-1));
    const raw = toolContext(lesson());
    viewOf(raw).classList.add('hidden');
    raw.insertLessonVideo();
    assert.ok(raw.alerts.at(-1).includes('보기 화면') && !placing(raw), raw.alerts.at(-1));
});

/* ======================= 텍스트 블록 넣기 ======================= */
test('텍스트 블록 넣기: 누른 자리에 쓴 글(마크다운)을 따로 선 블록으로 넣고 작업 기록에 남긴다. Ctrl+Z로 되돌린다', async () => {
    const mod = lesson();
    const ctx = toolContext(mod);
    await pickSpot(ctx, 'insertTextBlock', block(ctx, '2. 레벨 디자인'), upper);
    const area = query(ctx, '[data-text-block]');
    assert.ok(area && area.tagName.toLowerCase() === 'textarea', '글 칸');
    await writeText(ctx, '\n**직접 쓴 정리**\n\n- 첫째 항목\n- 둘째 항목\n\n');
    const next = LESSON.replace('```\n\n## 2. 레벨 디자인', '```\n\n**직접 쓴 정리**\n\n- 첫째 항목\n- 둘째 항목\n\n## 2. 레벨 디자인');
    assert.strictEqual(stored(mod), next);
    assert.deepStrictEqual(ctx.archived.map(item => [item.content, item.reason]), [[LESSON, '텍스트 블록 넣기 전']]);
    assert.strictEqual(mod.history[0].note, '텍스트 블록 넣기 (기본학습)');
    assert.ok([...viewOf(ctx).children].some(el => (el.textContent || '').includes('직접 쓴 정리')), '보기 화면에 보인다');
    call(ctx, 'formatUndo')({ preventDefault() {} });
    await settle();
    assert.strictEqual(stored(mod), LESSON);
});

test('텍스트 블록 넣기: 빈 글·취소·Esc는 아무것도 바꾸지 않는다. \\r\\n 원문은 \\r\\n으로 넣는다', async () => {
    const mod = lesson();
    const ctx = toolContext(mod);
    await pickSpot(ctx, 'insertTextBlock', block(ctx, '매 프레임 되풀이'), lower);
    await writeText(ctx, '   \n\n  ');
    await pickSpot(ctx, 'insertTextBlock', block(ctx, '매 프레임 되풀이'), lower);
    fire(ctx, query(ctx, '[data-text-cancel]'), 'click');
    await settle();
    await pickSpot(ctx, 'insertTextBlock', block(ctx, '매 프레임 되풀이'), lower);
    ctx.dialogs.at(-1).dismiss('escape');
    await settle();
    assert.deepStrictEqual([stored(mod), ctx.archived.length, query(ctx, '[data-text-block]')], [LESSON, 0, null]);
    const crlf = LESSON.replace(/\n/g, '\r\n');
    const win = lesson(crlf);
    const ctx2 = toolContext(win);
    await pickSpot(ctx2, 'insertTextBlock', block(ctx2, '매 프레임 되풀이'), lower);
    await writeText(ctx2, '첫 줄\n둘째 줄');
    assert.strictEqual(stored(win), crlf.replace('되풀이합니다\r\n\r\n', '되풀이합니다\r\n\r\n첫 줄\r\n둘째 줄\r\n\r\n'));
    assert.ok(!/[^\r]\n/.test(stored(win)), '\\n만 쓴 줄이 생기지 않는다');
});

test('텍스트 블록 넣기: 앞뒤 목록·코드 블록과 섞이는 글은 넣지 않고, 쓴 글을 그대로 둔 채 다른 자리를 고르게 한다', async () => {
    const mod = lesson();
    const ctx = toolContext(mod);
    await pickSpot(ctx, 'insertTextBlock', block(ctx, '입력 처리'), lower);
    await writeText(ctx, '- 이어 쓴 항목');
    assert.strictEqual(stored(mod), LESSON, '목록에 섞이는 자리에는 넣지 않는다');
    assert.ok(ctx.toasts.some(([text, type]) => type === 'warning' && text.includes('그대로')), plain(ctx.toasts));
    assert.strictEqual(placing(ctx), true, '자리 고르기를 다시 연다');
    fire(ctx, block(ctx, '2. 레벨 디자인'), 'click', lower(block(ctx, '2. 레벨 디자인')));
    await settle();
    assert.strictEqual(query(ctx, '[data-text-block]').value, '- 이어 쓴 항목', '쓴 글로 창을 다시 연다');
    fire(ctx, query(ctx, '[data-text-ok]'), 'click');
    await settle();
    assert.strictEqual(stored(mod), LESSON.replace('## 2. 레벨 디자인\n\n', '## 2. 레벨 디자인\n\n- 이어 쓴 항목\n\n'));
    for (const where of ['매 프레임 되풀이', '레벨은 플레이어가']) {
        await pickSpot(ctx, 'insertTextBlock', block(ctx, where), lower);
        await writeText(ctx, '```js\n닫지 않은 코드');
        assert.ok(!stored(mod).includes('닫지 않은 코드'), `닫지 않은 코드 블록은 넣지 않는다(${where})`);
        assert.ok(ctx.toasts.at(-1)[0].includes('닫히지 않았습니다'), ctx.toasts.at(-1)[0]);
        ctx.stopImageSlotPlacing();
    }
    const plan = call(ctx, 'lessonBlockInsertPlan')(LESSON, { index: 4, text: '게임 루프(Game Loop)는 입력, 갱신, 그리기를 매 프레임 되풀이합니다' }, 'after', '    들여 쓴 줄');
    assert.ok(plan.ok, '들여 쓴 줄(코드 블록)도 앞뒤와 섞이지 않으면 넣는다');
    const listPlan = call(ctx, 'lessonBlockInsertPlan')(LESSON, { index: 5, text: '입력 처리상태 갱신' }, 'after', '    목록에 붙는 줄');
    assert.deepStrictEqual([listPlan.ok, listPlan.reason.includes('섞여')], [false, true], '목록 뒤의 들여 쓴 줄은 목록 항목에 붙어 넣지 않는다');
});

/* ======================= 내보내기·다시 불러오기 ======================= */
test('HTML 내보내기: 내 PC 동영상은 파일 안에 data URL로 넣고, 인쇄(PDF)에는 재생하지 못한다는 칸으로 바꾼다. 없는 파일은 알린다', async () => {
    const md = `# 차시\n\n본문\n\n<div class="lesson-video"><video controls preload="metadata" src="local:vid_abc123def456"></video><p class="lesson-video-caption">동영상: 루프.mp4</p></div>\n\n${snippetUrl('dQw4w9WgXcQ')}\n\n<div class="lesson-video"><video controls preload="metadata" src="local:vid_gone00000000"></video></div>\n`;
    const mod = lesson(md, { lessonVideos: { vid_abc123def456: MP4 } });
    const ctx = toolContext(mod);
    const onScreen = viewOf(ctx).querySelectorAll('video');
    assert.strictEqual(onScreen.length, 2);
    assert.ok(viewOf(ctx).querySelector('.lesson-video-missing'), '보기 화면에 없는 파일 안내');
    const tab = { id: 'basicLearn', label: '기본학습', md };
    const html = await call(ctx, 'lessonTabHtml')(mod, tab, { mark: { index: 0, shown: new Map() } });
    assert.ok(html.html.includes(`src="${MP4}"`), '파일 안에 넣는다');
    assert.ok(html.html.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ'), '삽입 동영상은 그대로');
    assert.ok(html.html.includes('찾지 못해'), '없는 파일은 안내 글');
    assert.strictEqual(html.localVideos, 1);
    const fromScreen = await call(ctx, 'lessonTabHtml')(mod, tab, { useView: true, mark: { index: 0, shown: new Map() } });
    assert.ok(fromScreen.html.includes(`src="${MP4}"`) && !fromScreen.html.includes('blob:'), '화면을 그대로 쓸 때도 data URL로 바꾼다');
    const print = await call(ctx, 'lessonTabHtml')(mod, tab, {});
    assert.ok(!/<video|<iframe/.test(print.html) && print.html.includes('인쇄본'), print.html);
    assert.ok(print.html.includes('YouTube에서 보기'), '주소 링크는 인쇄본에 남는다');
    const zip = await call(ctx, 'lessonTabHtml')(mod, tab, { mark: { index: 0, shown: new Map() }, videoFiles: false });
    assert.ok(!zip.html.includes('data:video/') && zip.html.includes('되살리기용 정보') && zip.html.includes('youtube-nocookie'), '백업 ZIP의 읽기용 파일은 동영상 파일 대신 안내 글(파일은 save_data.yaml에)');
});

test('다시 불러오기(HTML·MD): 직접 넣은 동영상 파일은 되살리지 않는다고 확인 창에 적는다', () => {
    const ctx = toolContext(lesson());
    const notes = call(ctx, 'outputRestoreNotes')([{ title: '차시', tabContents: { basicLearn: '<video src="local:vid_abc123def456"></video> <video src="local:vid_abc123def456"></video> <video src="local:vid_zzz999zzz999"></video>' } }]);
    assert.ok(notes.some(note => note.includes('동영상 파일 2개') && note.includes('백업 ZIP')), plain(notes));
    assert.ok(!call(ctx, 'outputRestoreNotes')([{ title: '차시', tabContents: { basicLearn: '글' } }]).some(note => note.includes('동영상 파일')));
});

/* ======================= 저장·백업·작업 기록 (data-safety.js · state-store.js) ======================= */
function safetyContext() {
    const ctx = { console: quiet, window: {}, JSON, Date, Map, Set, Promise, STORAGE_KEY: 'teacher-test', crypto: require('crypto').webcrypto };
    ctx.LESSON_TABS = ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment', 'advAssessment'].map(id => ({ id, label: id }));
    vm.createContext(ctx);
    ['data-safety.js', 'state-store.js'].forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    vm.runInContext(sliceSource(read('tabs.js'), 'function setTabMarkdown('), ctx); // 되돌릴 때 탭 글을 바꾸는 함수(작업 기록이 부른다)
    return ctx;
}
class FakeZip {
    constructor() { this.files = {}; }
    file(name, data) { this.files[name] = data; return this; }
    folder(name) { return { file: (n, d) => this.file(`${name}/${n}`, d), folder: n => this.folder(`${name}/${n}`) }; }
}
const ref = key => `local:${key}`;
const videoLesson = () => ({
    id: 3, title: '차시', images: { img_1: PNG },
    tabContents: { basicLearn: `본문 <video src="${ref('vid_abc123def456')}"></video> ![](local:img_1)`, basicPrac: '실습' },
    lessonVideos: { vid_abc123def456: MP4, vid_other0000000: WEBM }
});

test('저장·열기: 큰 작업의 나눠 저장이 동영상을 따로 두었다가 그대로 되돌리고, 열 때 검사가 바른 동영상만 남긴다', () => {
    const ctx = safetyContext();
    const data = { state: { subjects: [{ id: 's', lessons: [videoLesson()] }] }, history: [] };
    const encoded = call(ctx, 'encodeSplitSave')(data, new Map(), (() => { let n = 0; return () => `id${++n}`; })());
    assert.ok(!JSON.stringify(encoded.record).includes('data:video/'), '저장본 본문에는 동영상 글이 없다');
    assert.ok([...encoded.images.values()].includes(MP4) && [...encoded.images.values()].includes(WEBM), '동영상은 따로 쓴다');
    const back = call(ctx, 'decodeSplitSave')(encoded.record, encoded.images);
    assert.deepStrictEqual(plain(back.data), plain(data));
    const lessonBack = call(ctx, 'cleanLessonFields')(back.data.state.subjects[0].lessons[0]);
    assert.strictEqual(lessonBack.lessonVideos.vid_abc123def456, MP4, '바른 동영상은 그대로');
    const dirty = call(ctx, 'cleanLessonFields')({ lessonVideos: { vid_abc123def456: MP4, 'bad key': MP4, vid_js00000000: 'javascript:alert(1)', vid_html0000000: 'data:text/html;base64,PHNjcmlwdD4=', vid_png00000000: PNG, vid_ref00000000: 'teacher-image:0123456789abcdef01' } });
    assert.deepStrictEqual(Object.keys(dirty.lessonVideos).sort(), ['vid_abc123def456', 'vid_ref00000000'], '찾지 못한 파일 참조는 남기고(다음에 채운다) 나머지는 뺀다');
    assert.deepStrictEqual(plain(call(ctx, 'cleanLessonFields')({ lessonVideos: ['x'] }).lessonVideos), {});
});

test("백업 ZIP·PC 폴더: '함께'는 저장 정보 안에, '따로·가볍게'는 '그림' 폴더의 .mp4·.webm 파일로 담고 되살리면 그대로다. '빼기'도 동영상은 빼지 않는다", () => {
    const ctx = safetyContext();
    const meta = { format: 'teacher-backup', context: { subjects: [{ id: 's', lessons: [videoLesson()] }] }, history: [{ id: 1, content: ref('vid_abc123def456'), lessonVideos: { vid_abc123def456: MP4 } }] };
    const inline = new FakeZip();
    call(ctx, 'writeBackupData')(inline, meta, 'inline');
    assert.deepStrictEqual(JSON.parse(inline.files['save_data.yaml']), plain(meta), '함께: 그대로');
    const separate = new FakeZip();
    call(ctx, 'writeBackupData')(separate, meta, 'separate');
    const saved = JSON.parse(separate.files['save_data.yaml']);
    assert.ok(!separate.files['save_data.yaml'].includes('data:video/'), '저장 정보에는 이름만');
    const names = Object.keys(separate.files).filter(name => name.startsWith('그림/'));
    assert.deepStrictEqual(names.map(name => name.split('.').pop()).sort(), ['mp4', 'png', 'webm'], '같은 동영상은 한 번만');
    // 되살리기: state.js importProjectZip·readFolderImages와 같은 길(파일 이름 → 키 → 내용이 이름과 맞는지 → 제자리)
    const files = {};
    names.forEach(name => {
        const fileName = name.split('/').pop();
        assert.ok(call(ctx, 'isBackupImageName')(fileName), fileName);
        const key = fileName.replace(/\.[^.]+$/, '');
        files[key] = call(ctx, 'backupImageFromKeyedFile')(key, fileName, Buffer.from(separate.files[name], 'base64').toString('base64'));
    });
    const restored = call(ctx, 'attachBackupImages')(saved, files);
    delete restored.imageMode;
    assert.deepStrictEqual(plain(restored), plain(meta), '따로·가볍게: 되살리면 그대로');
    const lessonBack = call(ctx, 'cleanLessonFields')(restored.context.subjects[0].lessons[0]);
    assert.deepStrictEqual(plain(lessonBack.lessonVideos), plain(videoLesson().lessonVideos));
    const none = new FakeZip();
    call(ctx, 'writeBackupData')(none, meta, 'none');
    const dropped = JSON.parse(none.files['save_data.yaml']);
    assert.deepStrictEqual(plain(dropped.context.subjects[0].lessons[0].lessonVideos), plain(videoLesson().lessonVideos), '빼기는 그림만 뺀다');
    assert.deepStrictEqual(plain(dropped.context.subjects[0].lessons[0].images), {}, '그림은 뺀다');
    assert.strictEqual(call(ctx, 'countBackupImages')(meta), 1, '그림 수에는 동영상을 세지 않는다');
    const wrong = call(ctx, 'backupImageFromKeyedFile')(call(ctx, 'backupImageKey')(MP4), 'x.mp4', Buffer.from('cut').toString('base64'));
    assert.strictEqual(wrong, null, '복사가 끊긴 동영상 파일은 받지 않는다');
});

test('작업 기록: 그 글이 쓰는 동영상만 담고, 되돌리거나 새 차시로 되살리면 동영상도 돌아온다. 남이 준 기록의 이상한 값은 뺀다', () => {
    const ctx = safetyContext();
    const mod = videoLesson();
    const entry = call(ctx, 'historyEntry')({ title: '차시 · 기본학습', content: mod.tabContents.basicLearn, images: mod.images, tabId: 'basicLearn', lesson: mod }, { id: 10, date: 'd', reason: '고치기 전', subjectId: 's' });
    assert.deepStrictEqual(Object.keys(entry.lessonVideos), ['vid_abc123def456'], '탭 글이 가리키는 동영상만');
    const whole = call(ctx, 'historyEntry')(mod, { id: 11, date: 'd' });
    assert.deepStrictEqual(Object.keys(whole.lessonVideos), ['vid_abc123def456'], '차시 기록도 글이 가리키는 것만');
    assert.strictEqual(call(ctx, 'historyEntry')({ ...mod, tabContents: { basicLearn: '동영상 없음' }, content: '' }, { id: 12 }).lessonVideos, undefined, '없으면 칸을 두지 않는다');
    const now = { ...videoLesson(), lessonVideos: {}, tabContents: { basicLearn: '지운 뒤', basicPrac: '실습' } };
    assert.strictEqual(call(ctx, 'historyMatchesNow')({ ...now, tabContents: { ...now.tabContents, basicLearn: entry.content } }, entry, 'basicLearn'), false, '글이 같아도 동영상이 없으면 되돌린다');
    call(ctx, 'applyHistoryEntry')(now, entry);
    assert.deepStrictEqual([now.tabContents.basicLearn, now.lessonVideos.vid_abc123def456], [entry.content, MP4]);
    const fresh = call(ctx, 'lessonFromHistory')(entry, 99);
    assert.strictEqual(fresh.lessonVideos.vid_abc123def456, MP4);
    const cleaned = call(ctx, 'cleanHistoryItem')({ id: 5, content: 'x', lessonVideos: { vid_abc123def456: MP4, vid_bad0000000: 'javascript:x' } });
    assert.deepStrictEqual(Object.keys(cleaned.lessonVideos), ['vid_abc123def456']);
    assert.strictEqual('lessonVideos' in call(ctx, 'cleanHistoryItem')({ id: 6, content: 'x', lessonVideos: 'x' }), false);
});

test('작업 기록(화면): 동영상을 넣은 뒤 다음 편집의 기록에는 그 동영상 파일이 함께 담긴다', async () => {
    const mod = lesson();
    const ctx = toolContext(mod);
    await pickSpot(ctx, 'insertLessonVideo', block(ctx, '매 프레임 되풀이'), lower);
    await chooseFile(ctx, fakeFile('loop.mp4', 'video/mp4'));
    await pickSpot(ctx, 'insertTextBlock', block(ctx, '2. 레벨 디자인'), lower);
    await writeText(ctx, '덧붙인 글');
    const second = ctx.archived.at(-1);
    assert.ok(second.content.includes('local:vid_'), '두 번째 기록은 동영상을 넣은 글');
    const safety = safetyContext();
    const entry = call(safety, 'historyEntry')(second.entry, { id: 1, date: 'd', subjectId: 's1' });
    assert.deepStrictEqual(Object.values(entry.lessonVideos), [MP4], '기록에 동영상 파일이 담긴다');
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
