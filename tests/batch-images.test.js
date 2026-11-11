// 빈 그림 모두 만들기(이 탭·이 차시) 테스트 (실행: node tests/batch-images.test.js)
// 실제 image-batch.js와 image-slot-place.js(그림 자리 찾기), api.js(그림 채우기·보기 화면), lesson-review.js, tabs.js, lesson-pipeline.js(진행 막대·중지),
// cost-estimate.js(비용·시간 예고), paragraph-edit.js(단락 편집 상자), data-safety.js(작업 기록 한 칸·되돌리기)를 vm에서 돌린다.
// 보기 화면은 domino로 흉내 낸다. 검색어 정하기·그림 검색·그림 모델·예시 게임 그림 찾기는 모두 바꿔 끼운다(실제 AI·그림 서비스를 부르지 않고 키는 가짜 값이다).
// 처음 한 번: npm install --no-save marked@15.0.12 turndown@7.2.4 (domino는 turndown과 함께 들어온다)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

let Marked = null;
let domino = null;
let NodeFilter = null;
let DomEvent = null;
try {
    ({ Marked } = require('marked'));
    domino = require('@mixmark-io/domino');
    NodeFilter = require('@mixmark-io/domino/lib/NodeFilter');
    DomEvent = require('@mixmark-io/domino/lib/Event');
} catch (err) {
    console.log('FAIL - marked·domino가 없습니다. 먼저 실행: npm install --no-save marked@15.0.12 turndown@7.2.4');
    process.exit(1);
}

const rootDir = path.join(__dirname, '..');
const root = path.join(rootDir, 'js');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const plain = value => JSON.parse(JSON.stringify(value));
const PNG = 'data:image/png;base64,QUFBQkJC';
const PNG_OLD = 'data:image/png;base64,T0xEUElDVFVSRQ==';
const FAKE_KEY = 'AIza-FAKE-TEST-KEY';
const FILES = ['data.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js',
    'lesson-review.js', 'lesson-sanitize.js', 'lesson-format.js', 'lesson-export.js', 'format-toolbar.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js',
    'ai-routing.js', 'api.js', 'cost-estimate.js', 'paragraph-edit.js', 'image-slot-place.js', 'image-batch.js', 'data-safety.js'];

// 소스에서 함수 하나(시작 글부터 첫 '\n}\n'까지)를 잘라 온다
function sliceSource(source, start, end = '\n}\n') {
    const at = source.indexOf(start);
    if (at < 0) throw new Error(`소스에서 찾지 못함: ${start}`);
    return source.slice(at, source.indexOf(end, at) + end.length);
}

/* ---------- domino 보완: 목록 반복, dataset, 화면 자리, 글 칸의 커서 ---------- */
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
    if (!htmlProto.setSelectionRange) Object.defineProperty(htmlProto, 'setSelectionRange', { configurable: true, value() {} });
}

// 컨텍스트 하나만 쓰는 marked(api.js의 marked.use가 다른 컨텍스트의 렌더러를 덮지 않게)
function ownMarked() {
    const instance = new Marked();
    return { parse: (...args) => instance.parse(...args), use: (...args) => instance.use(...args), lexer: (...args) => instance.lexer(...args) };
}

/* ---------- 교안 ---------- */
const tagLine = keyword => `<!-- [IMG: "${keyword}"] -->`;
const IMG_TAGS = /<!--\s*\[IMG:\s*"?([^"]+)"?\]\s*-->/g;
const OLD_PICTURE = '<div class="image-wrapper"><img src="local:img_old" alt="예전에 넣은 그림" class="rounded-lg"><div class="image-caption">예전에 넣은 그림</div></div>';
// 그림을 못 만든 자리(api.js imagePlaceholderHtml과 같은 모양). 앞뒤에 줄바꿈이 붙는다
const failedBox = (text, keyword) => `\n<div class="image-placeholder" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:24px;margin:12px 0;border:2px dashed rgba(156,163,175,0.4);border-radius:8px;background:rgba(31,41,55,0.3);color:#9ca3af;font-size:0.85rem;"><i class="ph-bold ph-image" style="font-size:1.4rem;opacity:0.6;"></i> <span>${text}</span> <button data-lesson-action="regenerate-image" data-keyword="${keyword}" class="ml-2 px-2 py-1 text-xs bg-accent/20 text-accent border border-accent/40 rounded hover:bg-accent/30 transition-colors" style="cursor:pointer;">🔄 다시 검색</button></div>\n`;
const BOX = failedBox('이미지 영역: 충돌 판정 그림', 'Collision Check');

const LEARN = [
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
    tagLine('Level Design'),
    '',
    OLD_PICTURE,
    '',
    tagLine('local:img_old'),
    '',
    '충돌 판정은 두 물체가 겹쳤는지 매 프레임 확인합니다',
    BOX,
    '## 3. 핵심 정리',
    '',
    '게임 루프는 입력과 갱신과 그리기를 되풀이합니다',
    '',
    tagLine('Loop Summary'),
    ''
].join('\n');
const PRAC = [
    '# 실습',
    '',
    '## 1. 스프라이트 준비',
    '',
    '스프라이트 시트(Sprite Sheet)를 잘라 애니메이션 프레임을 만듭니다',
    '',
    tagLine('Sprite Sheet'),
    '',
    // 두 자리의 둘레 글(앞뒤 400자)이 겹치지 않게 사이를 띄운다
    '프레임 크기와 간격을 표에 적어 두면 뒤에서 자를 위치를 계산하기 쉽습니다. '.repeat(14).trim(),
    '',
    '## 2. 스프라이트 그리기',
    '',
    '잘라 둔 프레임을 화면 좌표에 차례로 그려 캐릭터를 움직입니다',
    '',
    tagLine('Sprite Sheet'),
    ''
].join('\n');
const ADV = ['# 심화', '', '## 1. 상태 기계', '', '상태 기계는 캐릭터의 행동을 상태와 전이로 나눕니다', '', OLD_PICTURE, ''].join('\n');
const ADV_PRAC = ['# 심화 실습', '', '## 1. 보스 패턴', '', '보스는 체력에 따라 공격 패턴을 바꿉니다', '', tagLine('Boss Pattern'), ''].join('\n');
const QUIZ = ['### 문제 1. 게임 루프의 단계', '', tagLine('quiz board'), '', '보기에서 알맞은 것을 고르세요', ''].join('\n');
const ADV_QUIZ = ['### 문제 1. 상태 기계', failedBox('이미지 영역: 상태 그림', 'State Machine'), '보기에서 알맞은 것을 고르세요', ''].join('\n');
const TAB_ORDER = ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment', 'advAssessment'];
const FULL_TABS = { basicLearn: LEARN, basicPrac: PRAC, advLearn: ADV, advPrac: ADV_PRAC, assessment: QUIZ, advAssessment: ADV_QUIZ };

function lesson(tabs = FULL_TABS, extra = {}) {
    const tabContents = Object.fromEntries(TAB_ORDER.map(id => [id, tabs[id] ?? null]));
    return { id: 7, title: '1차시 게임 루프', tabContents, content: TAB_ORDER.map(id => tabContents[id] || '').filter(Boolean).join('\n\n---\n\n'), images: { img_old: PNG_OLD }, history: [], ...extra };
}

// mod: 연 차시. renderEditor는 진짜처럼 고치던 원문을 먼저 넣고(saveRawContent) 실제 toggleEditorMode('view')로 보기 화면을 그린다
function batchContext(mod, { tabId = 'basicLearn' } = {}) {
    const doc = domino.createDocument([
        '<html><body>',
        '<details id="lesson-tools-menu"><summary>도구</summary></details>',
        '<div id="editor-content-area"><div id="lesson-page"><div id="render-view" class="markdown-body"></div><textarea id="raw-view" class="hidden"></textarea></div></div>',
        '<div id="lesson-nav">탭 줄</div>',
        '</body></html>'
    ].join(''), true);
    patchDomino(doc);
    const ctx = {
        console: quiet, document: doc, Promise, URL, Blob, AbortController, Proxy, Event: DomEvent,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        marked: ownMarked(), NodeFilter, getSelection: () => null,
        DOMParser: function DOMParser() { this.parseFromString = html => domino.createDocument(String(html), true); },
        currentMod: mod, toasts: [], alerts: [], asked: [], archived: [], imageCalls: [], intents: [], generated: [], gameCalls: [], barTexts: [], steps: [], statuses: [], waits: [],
        saves: 0, saveResult: true, rendered: 0, confirmAnswer: true
    };
    ctx.window = ctx;
    ctx.setTimeout = (fn, ms) => { ctx.waits.push(ms); ctx.onWait?.(ms); return setTimeout(fn, Math.min(Number(ms) || 0, 1)); }; // 그림 사이 7초 간격을 기다리지 않는다
    ctx.clearTimeout = id => clearTimeout(id);
    ctx.renderSidebar = () => {};
    ctx.syncGyosuanView = () => {};
    ctx.DBManager = { getCache: async () => null, setCache: async () => {} };
    vm.createContext(ctx);
    vm.runInContext(sliceSource(read('ui.js'), 'function escapeHtml('), ctx);
    FILES.forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    // 창·저장은 파일을 실은 뒤 바꿔 끼운다(data-safety.js가 confirmAsync를 정한다)
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.confirmAsync = async (message, opts) => { ctx.asked.push({ message, opts }); return ctx.confirmAnswer; };
    ctx.saveState = async () => { ctx.saves += 1; return ctx.saveResult; };
    vm.runInContext(`globalState = { subjects: [{ id: 's1', title: '교과', lessons: [window.currentMod] }] }; currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons;
        currentEditingModuleId = window.currentMod.id; currentLessonTab = ${JSON.stringify(tabId)}; _lessonPanel = null; apiKey = ${JSON.stringify(FAKE_KEY)};
        getEditingModule = (id = currentEditingModuleId) => (String(id) === String(window.currentMod?.id) ? window.currentMod : null);
        renderEditor = mod => { window.saveRawContent?.(); window.rendered += 1; document.getElementById('editor-content-area').scrollTop = 0; window.drawView(mod); }; renderSidebar = () => {};
        // 작업 기록 한 칸(state.js archiveContents와 같이 그 차시가 든 교과 id를 남긴다)
        archiveContent = async (item, reason = '') => {
            const owner = lessonOwnerId(item.lesson || item, globalState.subjects, currentSubjectId, courseData);
            window.archived.push({ reason, tabId: item.tabId, content: item.content, entry: historyEntry(item, { id: window.archived.length + 1, date: '오늘', reason, subjectId: owner ?? null }) });
        };
        extractSearchIntent = async (keyword, context) => { window.intents.push({ keyword, context }); return { search_query: keyword, image_gen_prompt: 'A clean educational concept illustration with symbolic icons only, no text, no letters, no labels.', reasoning: '그림 설명' }; };
        searchImageAPI = async () => null;
        searchPixabayAPI = async () => null;
        generateImageAPI = async (prompt, opts = {}) => {
            const n = window.generated.length;
            window.generated.push(prompt);
            window.barTexts.push(document.getElementById('lesson-pipeline-bar')?.textContent || '');
            if (window.duringImage) await window.duringImage(n);
            if (opts.signal?.aborted) throw abortError();
            const planned = window.imageResults ? window.imageResults[n] : undefined;
            return planned === undefined ? ${JSON.stringify(PNG)} : planned;
        };
        gameTagReplacement = async (tag, { taken = new Set() } = {}) => {
            window.gameCalls.push(tag.game);
            const imgId = uniqueLessonImageId(taken);
            return { fullMatch: tag.fullMatch, html: '\\n<div class="image-wrapper game-image"><img src="local:' + imgId + '" alt="게임 그림"></div>\\n', imgId, image: ${JSON.stringify(PNG)}, game: true };
        };
        window.realProcessImageTags = processImageTags;
        processImageTags = async (...args) => { window.imageCalls.push(args); return window.realProcessImageTags(...args); };`, ctx);
    const realUpdate = ctx.updateLessonJob;
    ctx.updateLessonJob = step => { ctx.steps.push(step); return realUpdate(step); };
    const realStatus = ctx.setPipelineStatus;
    ctx.setPipelineStatus = text => { ctx.statuses.push(text); return realStatus(text); };
    ctx.drawView = target => {
        const raw = doc.getElementById('raw-view');
        raw.value = vm.runInContext('getActiveTabSource', ctx)(target);
        raw.lastSaved = raw.value;
        raw.setAttribute('data-module-id', String(target.id));
        raw.setAttribute('data-tab-id', vm.runInContext('currentLessonTab', ctx));
        vm.runInContext("toggleEditorMode('view')", ctx);
    };
    ctx.drawView(mod);
    return ctx;
}

const call = (ctx, name) => vm.runInContext(name, ctx);
const viewOf = ctx => ctx.document.getElementById('render-view');
const rawOf = ctx => ctx.document.getElementById('raw-view');
function block(ctx, text) {
    const found = [...viewOf(ctx).children].find(el => !el.hasAttribute('data-image-slot') && (el.textContent || '').includes(text));
    if (!found) throw new Error(`화면 블록을 찾지 못함: ${text}`);
    return found;
}
const tabsOf = mod => ({ ...mod.tabContents });
const newImageIds = mod => Object.keys(mod.images).filter(id => id !== 'img_old');
const pictures = text => (String(text).match(/<div class="image-wrapper"><img src="local:img_\d+"/g) || []).length;
const tagCount = (text, keyword) => String(text).split(tagLine(keyword)).length - 1;
const lastToast = ctx => ctx.toasts.at(-1) || ['', ''];
const running = ctx => call(ctx, 'window.isLessonPipelineRunning')();
const calledKeywords = ctx => ctx.imageCalls.map(args => args[2].tags.map(tag => tag.keyword).join(','));

let failed = 0;
let count = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

/* ======================= 빈 자리 세기 ======================= */
test('세기(탭): 그림 자리 표시와 그림을 못 만든 자리(이미지 영역)를 원문 순서로 센다. 정리 섹션의 자리도 세고, 코드 예제·local: 자리·이미 있는 그림은 세지 않는다', () => {
    const mod = lesson();
    const ctx = batchContext(mod);
    const slots = plain(call(ctx, 'emptyPictureSlots')(LEARN));
    assert.deepStrictEqual(slots.map(slot => [slot.kind, slot.keyword]), [['tag', 'Game Loop'], ['tag', 'Level Design'], ['placeholder', 'Collision Check'], ['tag', 'Loop Summary']]);
    assert.deepStrictEqual(slots.map(slot => LEARN.slice(slot.start, slot.start + slot.raw.length) === slot.raw), [true, true, true, true], '자리마다 원문 위치를 안다');
    assert.ok(slots[0].start < LEARN.indexOf('```html'), '코드 예제 속 같은 모양은 자리가 아니다');
    assert.strictEqual(slots[2].raw, BOX.trim(), '못 만든 자리는 그 칸 전체가 자리다');
    assert.deepStrictEqual(plain(call(ctx, 'pendingImageTags')(LEARN, 'all').map(tag => tag.keyword)), ['Game Loop', 'Level Design'], '일괄 이미지 찾기는 정리 섹션과 못 만든 자리를 세지 않는다');
    const plan = plain(call(ctx, 'emptyPicturePlan')(mod, 'basicLearn'));
    assert.deepStrictEqual([plan.total, plan.games, plan.retries, plan.tabs.map(tab => [tab.id, tab.label, tab.slots.length])], [4, 0, 1, [['basicLearn', '기본학습', 4]]]);
    assert.deepStrictEqual(plain(call(ctx, 'emptyPictureSlots')(ADV)), [], '그림이 이미 있는 탭');
    assert.deepStrictEqual(plain(call(ctx, 'emptyPictureSlots')('')), []);
    // 코드 예제 속 못 만든 자리 모양은 자리가 아니고, 못 만든 자리의 검색어는 HTML 표기를 풀어 읽는다(검색어가 없으면 칸에 적힌 글)
    const coded = `# 제목\n\n## 1. 본문\n\n글\n\n\`\`\`html${BOX}\`\`\`\n${failedBox('이미지 영역: 추격 장면', 'Tom &amp; Jerry&#039;s &quot;Chase&quot;')}\n글\n${failedBox('이미지 확보 실패: Boss Fight', '')}`;
    assert.deepStrictEqual(plain(call(ctx, 'emptyPictureSlots')(coded)).map(slot => [slot.kind, slot.keyword]), [['placeholder', 'Tom & Jerry\'s "Chase"'], ['placeholder', 'Boss Fight']]);
});

test('세기(차시): 그림을 넣는 탭마다 세어 더한다. 학습이해도·심화이해도의 자리는 세지 않는다', () => {
    const mod = lesson();
    const ctx = batchContext(mod);
    const plan = plain(call(ctx, 'emptyPicturePlan')(mod, null));
    assert.deepStrictEqual(plan.tabs.map(tab => [tab.id, tab.slots.length]), [['basicLearn', 4], ['basicPrac', 2], ['advPrac', 1]]);
    assert.deepStrictEqual([plan.total, plan.games, plan.retries], [7, 0, 1]);
    assert.strictEqual(call(ctx, 'countImageSlots')(mod), 5, '일괄 이미지 찾기가 세는 수(정리 섹션·못 만든 자리를 뺀다)');
    assert.strictEqual(plain(call(ctx, 'emptyPicturePlan')(mod, 'assessment')).total, 0, '문제은행 탭은 탭 범위로도 세지 않는다');
    assert.strictEqual(plain(call(ctx, 'emptyPicturePlan')(mod, 'advAssessment')).total, 0);
    // 첫머리 정리가 화면에서 숨기는 자리(첫 제목 바로 아래)는 세지 않는다(화면에 보이지 않는 그림을 만들지 않는다)
    const hidden = `# 제목\n\n${tagLine('Hidden Lead')}\n\n## 1. 본문\n\n글\n\n${tagLine('Shown')}\n`;
    assert.deepStrictEqual(plain(call(ctx, 'emptyPictureSlots')(hidden)).map(slot => slot.keyword), ['Shown']);
    // 예시 게임 그림 자리는 AI 그림과 따로 센다
    const games = lesson({ basicLearn: `# 제목\n\n## 1. 예시\n\n셀레스테는 정밀한 점프로 유명합니다\n\n${tagLine('game: Celeste')}\n\n${tagLine('Jump Arc')}\n` });
    const gamePlan = plain(call(batchContext(games), 'emptyPicturePlan')(games, null));
    assert.deepStrictEqual([gamePlan.total, gamePlan.games], [2, 1]);
});

/* ======================= 시작 전 ======================= */
test('빈 자리가 없으면 알림만 띄우고 묻지도 그림을 부르지도 않는다(탭·차시)', async () => {
    const mod = lesson({ basicLearn: ADV, basicPrac: '# 실습\n\n## 1. 준비\n\n글만 있는 탭입니다\n', assessment: QUIZ });
    const ctx = batchContext(mod);
    await ctx.fillEmptyPictures('tab');
    assert.deepStrictEqual(plain(lastToast(ctx)), ['이 탭에는 그림이 없는 그림 자리가 없습니다.', 'info']);
    await ctx.fillEmptyPictures('lesson');
    assert.deepStrictEqual(plain(lastToast(ctx)), ['이 차시에는 그림이 없는 그림 자리가 없습니다.', 'info'], '문제은행 탭에 남은 자리는 빈 자리로 치지 않는다');
    assert.deepStrictEqual([ctx.asked.length, ctx.imageCalls.length, ctx.generated.length, ctx.archived.length, ctx.saves, running(ctx)], [0, 0, 0, 0, 0, false]);
});

test('시작 전에 묻는다: 자리 수(차시는 탭마다)와 그림 장수·걸리는 시간을 보인다. 취소하면 그림을 부르지 않고 글·작업 기록도 그대로다', async () => {
    const mod = lesson();
    const before = tabsOf(mod);
    const ctx = batchContext(mod);
    ctx.confirmAnswer = false;
    await ctx.fillEmptyPictures('lesson');
    assert.strictEqual(ctx.asked.length, 1);
    const { message, opts } = ctx.asked[0];
    assert.deepStrictEqual([opts.title, opts.okLabel], ['빈 그림 모두 만들기', '만들기 시작']);
    assert.ok(message.includes('탭 3개') && message.includes('7개'), message);
    assert.ok(message.includes('기본학습 4개') && message.includes('기본실습 2개') && message.includes('심화실습 1개'), message);
    assert.ok(message.includes('못 만든 자리 1개'), message);
    assert.ok(message.includes('그림: 7장') && message.includes('걸리는 시간') && message.includes('작업 기록'), message);
    assert.ok(!message.includes('학습이해도'), '문제은행 탭은 말하지 않는다');
    await ctx.fillEmptyPictures('tab');
    assert.ok(ctx.asked[1].message.includes('«기본학습» 탭') && ctx.asked[1].message.includes('4개') && ctx.asked[1].message.includes('그림: 4장'), ctx.asked[1].message);
    assert.deepStrictEqual([ctx.imageCalls.length, ctx.intents.length, ctx.generated.length, ctx.archived.length, ctx.saves, running(ctx)], [0, 0, 0, 0, 0, false]);
    assert.deepStrictEqual(tabsOf(mod), before);
});

test('시작하지 않는 때: 다른 생성이 돌고 있으면, 글 모델 키나 그림을 만들 키가 없으면, 탭 범위를 문제은행 탭에서 누르면 까닭을 알리고 묻지 않는다', async () => {
    const mod = lesson();
    const ctx = batchContext(mod);
    ctx.beginLessonPipeline(mod.id, { kind: 'job', label: '다른 작업' });
    await ctx.fillEmptyPictures('lesson');
    assert.ok(String(ctx.alerts.at(-1)).includes('진행 중인 생성이 끝난 뒤'), String(ctx.alerts.at(-1)));
    ctx.finishLessonPipeline({ quiet: true });
    vm.runInContext('textModelHasKey = () => false', ctx);
    await ctx.fillEmptyPictures('lesson');
    assert.ok(String(ctx.alerts.at(-1)).includes('글 모델 키가 없어') && String(ctx.alerts.at(-1)).includes('설정'), String(ctx.alerts.at(-1)));
    vm.runInContext("textModelHasKey = () => true; apiKey = ''", ctx);
    await ctx.fillEmptyPictures('tab');
    assert.ok(String(ctx.alerts.at(-1)).includes('그림을 그리거나 찾을 키가 없어') && String(ctx.alerts.at(-1)).includes('설정'), String(ctx.alerts.at(-1)));
    assert.deepStrictEqual([ctx.asked.length, ctx.imageCalls.length, ctx.archived.length, tabsOf(mod).basicLearn], [0, 0, 0, LEARN]);
    // 예시 게임 그림 자리뿐이면 AI 키가 없어도 된다(위키백과에서 찾는다)
    const games = lesson({ basicLearn: `# 제목\n\n## 1. 예시\n\n셀레스테는 정밀한 점프로 유명합니다\n\n${tagLine('game: Celeste')}\n` });
    const gameCtx = batchContext(games);
    vm.runInContext("textModelHasKey = () => false; apiKey = ''", gameCtx);
    await gameCtx.fillEmptyPictures('tab');
    assert.ok(gameCtx.asked[0].message.includes('예시 게임 그림: 1장') && !/(^|\n)(글|그림): /.test(gameCtx.asked[0].message), gameCtx.asked[0].message);
    assert.deepStrictEqual([plain(gameCtx.gameCalls), gameCtx.intents.length, gameCtx.generated.length], [['Celeste'], 0, 0], '예시 게임 그림은 검색어 정하기·그림 모델을 부르지 않는다');
    assert.ok(games.tabContents.basicLearn.includes('game-image') && !games.tabContents.basicLearn.includes(tagLine('game: Celeste')));
    // 탭 범위는 문제은행 탭에서 쓰지 않는다
    const bank = lesson();
    const bankCtx = batchContext(bank, { tabId: 'assessment' });
    await bankCtx.fillEmptyPictures('tab');
    assert.ok(String(bankCtx.alerts.at(-1)).includes('학습이해도·심화이해도에는 그림을 넣지 않습니다'), String(bankCtx.alerts.at(-1)));
    assert.deepStrictEqual([bankCtx.asked.length, bankCtx.imageCalls.length], [0, 0]);
});

/* ======================= 채우기 ======================= */
test('이 탭: 그 탭의 빈 자리만 하나씩, 눌러 그림 만들기와 같은 길(processImageTags에 자리 하나)로 채운다. 다른 탭·코드 예제·local: 자리·이미 있는 그림은 그대로다', async () => {
    const mod = lesson();
    const before = tabsOf(mod);
    const ctx = batchContext(mod);
    ctx.document.getElementById('editor-content-area').scrollTop = 420; // 읽던 자리
    ctx.rendered = 0;
    await ctx.fillEmptyPictures('tab');
    assert.deepStrictEqual([ctx.rendered, ctx.document.getElementById('editor-content-area').scrollTop], [4, 420], '그림을 넣을 때마다 보고 있는 탭을 다시 그리고 읽던 자리는 그대로 둔다');
    assert.strictEqual(ctx.asked.length, 1, '한 번만 묻는다');
    assert.deepStrictEqual(calledKeywords(ctx), ['Game Loop', 'Level Design', 'Collision Check', 'Loop Summary'], '자리마다 한 번씩, 원문 순서로');
    ctx.imageCalls.forEach(([passedMod, passedMd, opts]) => {
        assert.strictEqual(passedMod, mod);
        assert.strictEqual([...passedMd.matchAll(IMG_TAGS)].length, 1, '채울 자리 하나만 그림 자리 표시로 넘긴다');
        assert.deepStrictEqual([opts.inject, opts.amount, opts.quiet, opts.tags.length], [false, 'all', true, 1]);
    });
    assert.deepStrictEqual(ctx.intents.map(item => item.keyword), ['Game Loop', 'Level Design', 'Collision Check', 'Loop Summary']);
    assert.ok(ctx.intents[0].context.includes('매 프레임 되풀이') && ctx.intents[2].context.includes('충돌 판정') && ctx.intents[3].context.includes('입력과 갱신과 그리기'), '자리마다 그 둘레 글을 읽는다');
    assert.strictEqual(ctx.generated.length, 4);
    const next = mod.tabContents.basicLearn;
    assert.deepStrictEqual([pictures(next), newImageIds(mod).length, newImageIds(mod).every(id => mod.images[id] === PNG && next.includes(`local:${id}`))], [4, 4, true]);
    assert.deepStrictEqual([tagCount(next, 'Game Loop'), tagCount(next, 'Level Design'), tagCount(next, 'Loop Summary'), next.includes('image-placeholder')], [1, 0, 0, false]);
    assert.ok(next.includes(`\`\`\`html\n${tagLine('Game Loop')}\n\`\`\``), '코드 예제는 한 글자도 바뀌지 않는다');
    assert.ok(next.includes(OLD_PICTURE) && next.includes(tagLine('local:img_old')) && mod.images.img_old === PNG_OLD, '이미 있는 그림과 local: 자리는 그대로');
    assert.ok(next.indexOf('매 프레임 되풀이') < next.indexOf('image-wrapper') && next.indexOf('image-wrapper') < next.indexOf('```html'), '첫 자리의 그림은 그 자리에');
    assert.strictEqual(next.replace(/\n<div class="image-wrapper"><img src="local:img_\d+"[\s\S]*?<\/div><\/div>\n/g, '«그림»'),
        LEARN.replace(tagLine('Game Loop'), '«그림»').replace(tagLine('Level Design'), '«그림»').replace(BOX.trim(), '«그림»').replace(tagLine('Loop Summary'), '«그림»'), '자리 밖의 글은 한 글자도 바뀌지 않는다');
    TAB_ORDER.filter(id => id !== 'basicLearn').forEach(id => assert.strictEqual(mod.tabContents[id], before[id], `${id} 탭은 그대로`));
    assert.deepStrictEqual(plain(lastToast(ctx)), ['빈 그림 모두 만들기를 마쳤습니다. 그림 4장을 넣었습니다.', 'success']);
    assert.deepStrictEqual([running(ctx), ctx.alerts.length], [false, 0], '진행 막대를 닫는다');
    assert.strictEqual(viewOf(ctx).querySelectorAll('[data-image-slot]').length, 0, '다시 그린 화면에 빈 자리 칸이 남지 않는다');
    assert.ok(ctx.waits.filter(ms => ms === 7000).length === 3, `AI 그림 사이에 7초씩 쉰다: ${ctx.waits.join(',')}`);
});

test('이 차시: 그림을 넣는 모든 탭을 차례로 돌고 문제은행 탭은 건드리지 않는다. 진행 막대에 탭 이름과 몇째인지 보인다. 같은 검색어의 자리도 저마다 제 둘레 글로 채운다', async () => {
    const mod = lesson();
    const before = tabsOf(mod);
    const ctx = batchContext(mod);
    ctx.rendered = 0;
    let retryNote = '';
    ctx.duringImage = async n => { // 그림 모델을 다시 부르기 전의 안내(api.js가 '이미지 1/1: …'로 보낸다)도 탭 이름과 차례를 붙여 보인다
        if (n !== 2) return;
        ctx.imageCalls.at(-1)[2].onStatus('🖼️ 이미지 1/1: 그림 모델 사용 한도에 걸려 7초 뒤 한 번 더 해 봅니다');
        retryNote = ctx.statuses.at(-1);
    };
    await ctx.fillEmptyPictures('lesson');
    assert.strictEqual(retryNote, '기본학습 · 3/7 · 그림 모델 사용 한도에 걸려 7초 뒤 한 번 더 해 봅니다');
    assert.strictEqual(ctx.rendered, 4, '보고 있는 탭(기본학습)에 넣을 때만 다시 그린다. 다른 탭에 넣을 때는 화면을 건드리지 않는다');
    assert.deepStrictEqual(calledKeywords(ctx), ['Game Loop', 'Level Design', 'Collision Check', 'Loop Summary', 'Sprite Sheet', 'Sprite Sheet', 'Boss Pattern']);
    assert.ok(ctx.intents[4].context.includes('애니메이션 프레임') && !ctx.intents[4].context.includes('화면 좌표'), ctx.intents[4].context);
    assert.ok(ctx.intents[5].context.includes('화면 좌표') && !ctx.intents[5].context.includes('애니메이션 프레임'), '둘째 같은 검색어 자리는 그 자리 둘레 글');
    assert.deepStrictEqual([pictures(mod.tabContents.basicLearn), pictures(mod.tabContents.basicPrac), pictures(mod.tabContents.advPrac)], [4, 2, 1]);
    assert.deepStrictEqual([tagCount(mod.tabContents.basicPrac, 'Sprite Sheet'), tagCount(mod.tabContents.advPrac, 'Boss Pattern')], [0, 0]);
    const prac = mod.tabContents.basicPrac;
    assert.ok(prac.indexOf('애니메이션 프레임') < prac.indexOf('image-wrapper') && prac.indexOf('image-wrapper') < prac.indexOf('## 2.') && prac.lastIndexOf('image-wrapper') > prac.indexOf('화면 좌표'), '두 자리 모두 제자리에');
    ['advLearn', 'assessment', 'advAssessment'].forEach(id => assert.strictEqual(mod.tabContents[id], before[id], `${id} 탭은 그대로`));
    assert.ok(mod.tabContents.assessment.includes(tagLine('quiz board')) && mod.tabContents.advAssessment.includes('image-placeholder'), '문제은행 탭의 자리는 채우지 않는다');
    assert.strictEqual(mod.content, TAB_ORDER.map(id => mod.tabContents[id]).filter(Boolean).join('\n\n---\n\n'), '합친 본문도 맞춘다');
    assert.deepStrictEqual(plain(ctx.steps.map(step => step.current)), ['basicLearn', 'basicLearn', 'basicLearn', 'basicLearn', 'basicPrac', 'basicPrac', 'advPrac'], '탐색줄 표시가 탭을 따라간다');
    assert.deepStrictEqual(plain(ctx.steps.map(step => step.done)), [0, 1, 2, 3, 4, 5, 6]);
    assert.ok(ctx.barTexts[2].includes('기본학습 · 3/7') && ctx.barTexts[4].includes('기본실습 · 5/7') && ctx.barTexts[6].includes('심화실습 · 7/7'), ctx.barTexts.join('\n'));
    assert.ok(ctx.barTexts[2].includes('빈 그림 모두 만들기') && ctx.barTexts[2].includes('중지'), ctx.barTexts[2]);
    assert.ok(ctx.statuses.some(text => text.includes('기본학습 · 2/7') && text.includes('남은 시간')), ctx.statuses.join('\n'));
    assert.deepStrictEqual(plain(lastToast(ctx)), ['빈 그림 모두 만들기를 마쳤습니다. 그림 7장을 넣었습니다.', 'success']);
    assert.strictEqual(ctx.waits.filter(ms => ms === 7000).length, 6);
    // 다시 누르면 남은 자리가 없다
    await ctx.fillEmptyPictures('lesson');
    assert.deepStrictEqual([plain(lastToast(ctx)), ctx.asked.length, ctx.imageCalls.length], [['이 차시에는 그림이 없는 그림 자리가 없습니다.', 'info'], 1, 7]);
});

/* ======================= 실패·중지 ======================= */
test('못 만든 그림: 멈추지 않고 다음 자리로 이어 가고, 그 자리는 그대로 둔다. 끝에 넣은 수·못 만든 수와 다시 만드는 법을 알린다. 바뀌지 않은 탭은 작업 기록에 남기지 않는다', async () => {
    const mod = lesson();
    const before = tabsOf(mod);
    const ctx = batchContext(mod);
    ctx.imageResults = [PNG, null, PNG, PNG, PNG, PNG, null]; // 둘째(Level Design)와 마지막(심화실습의 하나뿐인 자리)을 못 만든다
    await ctx.fillEmptyPictures('lesson');
    assert.strictEqual(ctx.imageCalls.length, 7, '못 만들어도 남은 자리를 모두 해 본다');
    const learn = mod.tabContents.basicLearn;
    assert.deepStrictEqual([pictures(learn), tagCount(learn, 'Level Design'), learn.includes('이미지 영역: Level') || learn.includes('이미지 확보 실패')], [3, 1, false], '못 만든 자리는 그림 자리 그대로(다시 누르면 다시 만든다)');
    assert.strictEqual(mod.tabContents.advPrac, before.advPrac, '하나도 못 넣은 탭은 그대로');
    assert.deepStrictEqual(plain(ctx.archived.map(item => item.tabId)), ['basicLearn', 'basicPrac'], '바뀐 탭만 작업 기록에 남긴다');
    const [text, kind] = lastToast(ctx);
    assert.ok(text.startsWith('빈 그림 모두 만들기를 마쳤습니다. 그림 5장을 넣었습니다.'), text);
    assert.ok(text.includes('2곳은 그림을 만들지 못해') && text.includes("'빈 그림 모두 만들기'를 다시 누르면") && text.includes('그 자리를 누르거나'), text);
    assert.strictEqual(kind, 'warning');
    assert.strictEqual(newImageIds(mod).length, 5, '못 만든 자리의 그림은 담지 않는다');
    // 모두 못 만들면 넣은 그림이 없다고 알리고 글은 그대로다
    const none = lesson();
    const noneCtx = batchContext(none);
    noneCtx.imageResults = [null, null, null, null];
    await noneCtx.fillEmptyPictures('tab');
    assert.deepStrictEqual([none.tabContents.basicLearn, noneCtx.archived.length, noneCtx.saves], [LEARN, 0, 0]);
    assert.ok(lastToast(noneCtx)[0].includes('넣은 그림은 없습니다.') && lastToast(noneCtx)[0].includes('4곳은 그림을 만들지 못해') && lastToast(noneCtx)[0].includes('설정의 이미지 생성 모델과 키'), lastToast(noneCtx)[0]);
    assert.strictEqual(lastToast(noneCtx)[1], 'error');
});

test('중지: 만들던 그림에서 멈추고 앞에서 넣은 그림은 저장된 채 남는다. 남은 자리는 그대로이고 다시 누르면 남은 자리부터 잇는다', async () => {
    const mod = lesson();
    const ctx = batchContext(mod);
    ctx.duringImage = async n => { if (n === 2) ctx.requestLessonPipelineStop(); };
    await ctx.fillEmptyPictures('lesson');
    assert.strictEqual(ctx.imageCalls.length, 3, '멈춘 뒤에는 그림을 더 부르지 않는다');
    const learn = mod.tabContents.basicLearn;
    assert.deepStrictEqual([pictures(learn), learn.includes(BOX.trim()), tagCount(learn, 'Loop Summary'), mod.tabContents.basicPrac, mod.tabContents.advPrac], [2, true, 1, PRAC, ADV_PRAC]);
    assert.ok(ctx.saves >= 2, '넣을 때마다 저장했다');
    assert.deepStrictEqual(plain(ctx.archived.map(item => [item.tabId, item.content === LEARN])), [['basicLearn', true]]);
    const [text, kind] = lastToast(ctx);
    assert.ok(text.startsWith('빈 그림 모두 만들기를 멈췄습니다. 그림 2장을 넣었습니다.') && text.includes('5곳은 아직 만들지 않았습니다') && text.includes('다시 누르면 남은 자리부터'), text);
    assert.deepStrictEqual([kind, running(ctx)], ['warning', false]);
    // 다시 누르면 남은 다섯 자리만 채운다
    ctx.duringImage = null;
    await ctx.fillEmptyPictures('lesson');
    assert.ok(ctx.asked[1].message.includes('5개') && ctx.asked[1].message.includes('기본학습 2개'), ctx.asked[1].message);
    assert.deepStrictEqual(calledKeywords(ctx).slice(3), ['Collision Check', 'Loop Summary', 'Sprite Sheet', 'Sprite Sheet', 'Boss Pattern']);
    assert.deepStrictEqual([pictures(mod.tabContents.basicLearn), pictures(mod.tabContents.basicPrac), pictures(mod.tabContents.advPrac)], [4, 2, 1]);
    // 그림 사이에 쉬는 동안 멈추면 다음 그림을 부르지 않는다
    const paused = lesson();
    const pauseCtx = batchContext(paused);
    pauseCtx.onWait = ms => { if (ms === 7000) pauseCtx.requestLessonPipelineStop(); };
    await pauseCtx.fillEmptyPictures('tab');
    assert.deepStrictEqual([pauseCtx.imageCalls.length, pauseCtx.generated.length, pictures(paused.tabContents.basicLearn)], [1, 1, 1]);
    assert.ok(lastToast(pauseCtx)[0].startsWith('빈 그림 모두 만들기를 멈췄습니다. 그림 1장을 넣었습니다.') && lastToast(pauseCtx)[0].includes('3곳은 아직 만들지 않았습니다'), lastToast(pauseCtx)[0]);
});

test('도중에 차시가 사라지거나(불러오기·삭제) 저장하지 못하면 멈추고 알린다', async () => {
    const mod = lesson();
    const ctx = batchContext(mod);
    ctx.duringImage = async n => { if (n === 1) vm.runInContext('globalState.subjects[0].lessons = []; courseData = globalState.subjects[0].lessons;', ctx); };
    await ctx.fillEmptyPictures('lesson');
    assert.strictEqual(ctx.imageCalls.length, 2);
    assert.strictEqual(pictures(mod.tabContents.basicLearn), 1, '사라진 차시에는 더 넣지 않는다');
    assert.ok(lastToast(ctx)[0].startsWith('빈 그림 모두 만들기를 멈췄습니다.') && lastToast(ctx)[0].includes('불러와'), lastToast(ctx)[0]);
    const unsaved = lesson();
    const saveCtx = batchContext(unsaved);
    saveCtx.saveResult = false;
    await saveCtx.fillEmptyPictures('lesson');
    assert.strictEqual(saveCtx.imageCalls.length, 1, '저장하지 못하면 그림을 더 부르지 않는다');
    assert.ok(lastToast(saveCtx)[0].startsWith('저장하지 못해 빈 그림 모두 만들기를 멈췄습니다.') && lastToast(saveCtx)[0].includes('Ctrl+S'), lastToast(saveCtx)[0]);
    assert.strictEqual(lastToast(saveCtx)[1], 'error');
});

/* ======================= 도는 동안 고친 글 ======================= */
test('도는 동안 탭 글이 바뀌면: 넣기 직전에 다시 읽은 글에 넣어 고친 글을 지킨다. 그사이 지워진 자리는 건너뛰고(그림을 부르지 않는다), 만들던 자리가 지워지면 그 그림은 버린다', async () => {
    const mod = lesson();
    const ctx = batchContext(mod);
    const EDITED = '레벨은 플레이어가 지나가는 길입니다. 강사가 그사이 고친 문장입니다';
    ctx.duringImage = async n => {
        if (n === 0) { // 첫 그림을 만드는 동안: 뒤 단락을 고치고, 둘째 자리(Level Design)를 지운다
            mod.tabContents.basicLearn = mod.tabContents.basicLearn
                .replace('레벨은 플레이어가 지나가는 길이고 난이도 곡선을 따라 장애물을 놓습니다', EDITED)
                .replace(`${tagLine('Level Design')}\n\n`, '');
        }
        if (n === 2) mod.tabContents.basicLearn = mod.tabContents.basicLearn.replace(tagLine('Loop Summary'), '정리 그림은 넣지 않기로 했습니다'); // 만들던 자리를 지운다
    };
    await ctx.fillEmptyPictures('tab');
    assert.deepStrictEqual(calledKeywords(ctx), ['Game Loop', 'Collision Check', 'Loop Summary'], '지워진 자리는 그림을 부르지 않는다');
    const next = mod.tabContents.basicLearn;
    assert.ok(next.includes(EDITED) && next.includes('정리 그림은 넣지 않기로 했습니다'), '그사이 고친 글이 남는다');
    assert.deepStrictEqual([pictures(next), newImageIds(mod).length, tagCount(next, 'Level Design'), next.includes('image-placeholder')], [2, 2, 0, false], '지워진 자리의 그림은 담지 않는다');
    const [text, kind] = lastToast(ctx);
    assert.ok(text.includes('그림 2장을 넣었습니다.') && text.includes('2곳은 만드는 동안 그 자리가 지워지거나 바뀌어 건너뛰었습니다'), text);
    assert.strictEqual(kind, 'warning');
    assert.deepStrictEqual(plain(ctx.archived.map(item => [item.tabId, item.content === LEARN])), [['basicLearn', false]]);
    assert.ok(ctx.archived[0].content.includes(EDITED) && tagCount(ctx.archived[0].content, 'Game Loop') === 2 && pictures(ctx.archived[0].content) === 0, '작업 기록에는 처음 넣기 직전의 글(고친 글 포함)이 남는다');
});

test('도는 동안 지운 자리와 같은 모양이 코드 예제에 남아 있어도 코드 예제를 그림 자리로 보지 않는다(그림을 부르지 않고 코드도 그대로다)', async () => {
    const CODE = `\`\`\`html\n${tagLine('Beta')}\n\`\`\``;
    const md = ['# 제목', '', '## 1. 가', '', '첫 단락입니다', '', tagLine('Alpha'), '', '## 2. 나', '', '둘째 단락입니다', '', tagLine('Beta'), '', CODE, ''].join('\n');
    const mod = lesson({ basicLearn: md });
    const ctx = batchContext(mod);
    ctx.duringImage = async n => { if (n === 0) mod.tabContents.basicLearn = mod.tabContents.basicLearn.replace(`둘째 단락입니다\n\n${tagLine('Beta')}\n`, '둘째 단락입니다\n'); };
    await ctx.fillEmptyPictures('tab');
    const next = mod.tabContents.basicLearn;
    assert.deepStrictEqual([calledKeywords(ctx).join(','), ctx.generated.length, pictures(next), next.includes(CODE), tagCount(next, 'Beta')], ['Alpha', 1, 1, true, 1]);
    assert.ok(lastToast(ctx)[0].includes('그림 1장을 넣었습니다.') && lastToast(ctx)[0].includes('1곳은 만드는 동안 그 자리가 지워지거나 바뀌어 건너뛰었습니다'), lastToast(ctx)[0]);
});

test('도는 동안 같은 검색어의 앞 자리를 채워도 뒤 자리를 제자리에서 찾고, 그사이 위에 글을 보태 위치가 밀려도 찾는다', async () => {
    const mod = lesson({ basicPrac: PRAC });
    const ctx = batchContext(mod, { tabId: 'basicPrac' });
    ctx.duringImage = async n => { if (n === 0) mod.tabContents.basicPrac = mod.tabContents.basicPrac.replace('# 실습\n', '# 실습\n\n강사가 맨 위에 보탠 안내 문단입니다\n'); };
    await ctx.fillEmptyPictures('tab');
    const next = mod.tabContents.basicPrac;
    assert.deepStrictEqual([ctx.imageCalls.length, pictures(next), tagCount(next, 'Sprite Sheet'), next.includes('강사가 맨 위에 보탠 안내 문단입니다')], [2, 2, 0, true]);
    assert.ok(ctx.intents[1].context.includes('화면 좌표'), '둘째 자리의 그림은 둘째 자리 둘레 글로 만든다');
    assert.ok(next.indexOf('image-wrapper') < next.indexOf('## 2.') && next.lastIndexOf('image-wrapper') > next.indexOf('화면 좌표'));
});

test('같은 검색어의 자리: 앞 자리를 못 만들어도 뒤 자리는 제자리에 넣는다. 도는 동안 같은 글자의 자리가 늘어 어느 자리인지 알 수 없으면 넣지 않고 건너뛴다', async () => {
    const mod = lesson({ basicPrac: PRAC });
    const ctx = batchContext(mod, { tabId: 'basicPrac' });
    ctx.imageResults = [null, PNG];
    await ctx.fillEmptyPictures('tab');
    const next = mod.tabContents.basicPrac;
    assert.deepStrictEqual([ctx.imageCalls.length, pictures(next), tagCount(next, 'Sprite Sheet')], [2, 1, 1]);
    assert.ok(next.indexOf(tagLine('Sprite Sheet')) < next.indexOf('## 2.') && next.indexOf('image-wrapper') > next.indexOf('화면 좌표'), '못 만든 앞 자리는 그대로, 그림은 뒤 자리에');
    // 같은 검색어의 자리가 셋이고 코드 예제에도 같은 모양이 있어도 셋 모두 제자리에 넣는다
    const three = ['# 제목', '', '## 1. 가', '', '첫 단락입니다', '', tagLine('Same'), '', '## 2. 나', '', '둘째 단락입니다', '', tagLine('Same'), '', `\`\`\`html\n${tagLine('Same')}\n\`\`\``, '', '## 3. 다', '', '셋째 단락입니다', '', tagLine('Same'), ''].join('\n');
    const triple = lesson({ basicLearn: three });
    const ctx3 = batchContext(triple);
    await ctx3.fillEmptyPictures('tab');
    const filled = triple.tabContents.basicLearn;
    assert.deepStrictEqual([ctx3.imageCalls.length, pictures(filled), tagCount(filled, 'Same'), filled.includes(`\`\`\`html\n${tagLine('Same')}\n\`\`\``)], [3, 3, 1, true]);
    assert.strictEqual(filled.replace(/\n<div class="image-wrapper"><img src="local:img_\d+"[\s\S]*?<\/div><\/div>\n/g, '«그림»'), three.split(`단락입니다\n\n${tagLine('Same')}`).join('단락입니다\n\n«그림»'), '세 자리 모두 제자리에');
    assert.deepStrictEqual(plain(lastToast(ctx3)), ['빈 그림 모두 만들기를 마쳤습니다. 그림 3장을 넣었습니다.', 'success']);
    // 도는 동안 강사가 같은 검색어의 자리를 하나 더 넣었다: 만든 그림을 엉뚱한 자리에 넣지 않는다
    const added = lesson({ basicPrac: PRAC });
    const ctx2 = batchContext(added, { tabId: 'basicPrac' });
    ctx2.duringImage = async n => { if (n === 0) added.tabContents.basicPrac = added.tabContents.basicPrac.replace('# 실습\n', `# 실습\n\n## 0. 미리 보기\n\n미리 보는 글입니다\n\n${tagLine('Sprite Sheet')}\n`); };
    await ctx2.fillEmptyPictures('tab');
    const kept = added.tabContents.basicPrac;
    assert.deepStrictEqual([ctx2.imageCalls.length, pictures(kept), tagCount(kept, 'Sprite Sheet'), newImageIds(added).length, ctx2.archived.length], [1, 0, 3, 0, 0]);
    assert.ok(lastToast(ctx2)[0].includes('넣은 그림은 없습니다.') && lastToast(ctx2)[0].includes('2곳은 만드는 동안 그 자리가 지워지거나 바뀌어 건너뛰었습니다'), lastToast(ctx2)[0]);
});

test('그림 모델을 더 쓸 수 없게 되면(사용 한도 등): 남은 AI 그림 자리는 부르지 않고 건너뛴 수를 알린다. 예시 게임 그림 자리는 이어서 채운다', async () => {
    const md = ['# 제목', '', '## 1. 가', '', '첫 단락입니다', '', tagLine('First'), '', '## 2. 나', '', '둘째 단락입니다', '', tagLine('Second'), '', '## 3. 다', '', '셋째 단락입니다', '', tagLine('Third'), '',
        '## 4. 라', '', '셀레스테는 정밀한 점프로 유명합니다', '', tagLine('game: Celeste'), ''].join('\n');
    const mod = lesson({ basicLearn: md });
    const ctx = batchContext(mod);
    ctx.imageResults = [PNG, null];
    ctx.duringImage = async n => { if (n === 1) vm.runInContext("imageModelChain().forEach(model => markImageBlocked(model, { quota: 'daily' }))", ctx); }; // 둘째 그림에서 그림 모델이 모두 막힌다
    await ctx.fillEmptyPictures('tab');
    assert.deepStrictEqual([ctx.generated.length, ctx.intents.map(item => item.keyword).join(','), plain(ctx.gameCalls)], [2, 'First,Second', ['Celeste']], '막힌 뒤에는 검색어 정하기도 그림 모델도 부르지 않는다');
    const next = mod.tabContents.basicLearn;
    assert.deepStrictEqual([pictures(next), next.includes('game-image'), tagCount(next, 'Second'), tagCount(next, 'Third'), tagCount(next, 'game: Celeste')], [1, true, 1, 1, 0]);
    assert.deepStrictEqual(plain(lastToast(ctx)), ['빈 그림 모두 만들기를 마쳤습니다. 그림 2장을 넣었습니다. 2곳은 그림 모델을 더 쓸 수 없어 건너뛰었습니다.', 'warning']);
    assert.strictEqual(ctx.waits.filter(ms => ms === 7000).length, 1, '부르지 않는 자리 앞에서는 쉬지 않는다');
});

test('도는 동안 원문 칸에 쓰던 글과 두 번 눌러 고치던 단락: 그림을 넣기 전에 먼저 그 탭에 넣어 잃지 않는다', async () => {
    const mod = lesson();
    const ctx = batchContext(mod);
    const TYPED = '강사가 원문 칸에 쓰던 새 단락입니다';
    ctx.duringImage = async n => {
        if (n !== 0) return;
        call(ctx, 'toggleEditorMode')('edit'); // 원문 칸을 열고 아직 저장하지 않은 글을 쓴다
        rawOf(ctx).value = `${mod.tabContents.basicLearn}\n${TYPED}\n`;
    };
    await ctx.fillEmptyPictures('tab');
    const next = mod.tabContents.basicLearn;
    assert.deepStrictEqual([next.includes(TYPED), pictures(next)], [true, 4], '쓰던 글 위에 그림을 넣는다');
    assert.ok(!ctx.toasts.some(([text]) => text.includes('넣지 않았습니다')), JSON.stringify(ctx.toasts));
    assert.ok(ctx.archived[0].content.includes(TYPED) && pictures(ctx.archived[0].content) === 0, '작업 기록의 글에도 쓰던 글이 들어 있다');
    // 단락 편집 상자
    const second = lesson();
    const ctx2 = batchContext(second);
    const FIXED = '레벨은 플레이어가 지나가는 길입니다(강사가 두 번 눌러 고치던 문장)';
    ctx2.duringImage = async n => {
        if (n !== 0) return;
        ctx2.openParagraphEditor({ target: block(ctx2, '난이도 곡선') });
        const input = viewOf(ctx2).querySelector('.para-edit textarea');
        assert.ok(input, '단락 편집 상자가 열렸다');
        input.value = FIXED; // 아직 저장하지 않았다
    };
    await ctx2.fillEmptyPictures('tab');
    const fixed = second.tabContents.basicLearn;
    assert.deepStrictEqual([fixed.includes(FIXED), fixed.includes('난이도 곡선'), pictures(fixed)], [true, false, 4], '고치던 단락을 저장한 글에 그림을 넣는다');
    assert.ok(!ctx2.toasts.some(([text]) => text.includes('탭 내용이 바뀌어')), JSON.stringify(ctx2.toasts));
    assert.ok(!viewOf(ctx2).querySelector('.para-edit'), '다시 그린 화면에 편집 상자가 남지 않는다');
});

/* ======================= 작업 기록 ======================= */
test('작업 기록: 바뀐 탭마다 처음 넣기 직전의 글을 한 번만 남긴다(그림 만들기 전). 그 기록으로 탭마다 되돌릴 수 있다', async () => {
    const mod = lesson();
    const before = tabsOf(mod);
    const ctx = batchContext(mod);
    await ctx.fillEmptyPictures('lesson');
    assert.deepStrictEqual(plain(ctx.archived.map(item => [item.tabId, item.reason])), [['basicLearn', '그림 만들기 전'], ['basicPrac', '그림 만들기 전'], ['advPrac', '그림 만들기 전']], '그림 7장을 넣어도 탭마다 한 칸');
    ctx.archived.forEach(item => {
        assert.strictEqual(item.content, before[item.tabId], `${item.tabId}: 넣기 전 글`);
        assert.deepStrictEqual([item.entry.tabId, item.entry.lessonId, item.entry.subjectId, item.entry.reason], [item.tabId, 7, 's1', '그림 만들기 전']);
    });
    assert.strictEqual(ctx.archived[0].entry.title, '1차시 게임 루프 · 기본학습');
    assert.deepStrictEqual(Object.keys(ctx.archived[0].entry.images), ['img_old'], '기록에는 넣기 전 글이 쓰는 그림만 담는다');
    assert.deepStrictEqual(plain(mod.history.slice(0, 3).map(item => item.note)), ['빈 그림 모두 만들기 (심화실습)', '빈 그림 모두 만들기 (기본실습)', '빈 그림 모두 만들기 (기본학습)']);
    // 되돌리기: 탭마다 그 기록을 돌려놓으면 넣기 전 글로 돌아간다(다른 탭은 그대로)
    const filledPrac = mod.tabContents.basicPrac;
    call(ctx, 'applyHistoryEntry')(mod, ctx.archived[0].entry);
    assert.deepStrictEqual([mod.tabContents.basicLearn, mod.tabContents.basicPrac], [LEARN, filledPrac]);
    call(ctx, 'applyHistoryEntry')(mod, ctx.archived[1].entry);
    call(ctx, 'applyHistoryEntry')(mod, ctx.archived[2].entry);
    assert.deepStrictEqual(tabsOf(mod), before);
    assert.strictEqual(mod.images.img_old, PNG_OLD);
});

test('탭이 없는 본문(최종 평가·옛 차시)도 본문 하나로 채우고 작업 기록에 남긴다', async () => {
    const body = `# 최종 평가\n\n## 1. 과제\n\n게임 루프를 구현해 제출합니다\n\n${tagLine('Final Project')}\n`;
    const mod = { id: 9, title: '최종 평가', content: body, images: {}, history: [] };
    const ctx = batchContext(mod);
    await ctx.fillEmptyPictures('lesson');
    assert.ok(ctx.asked[0].message.includes('1개'), ctx.asked[0].message);
    assert.deepStrictEqual([pictures(mod.content), tagCount(mod.content, 'Final Project'), mod.tabContents], [1, 0, undefined]);
    assert.deepStrictEqual(plain(ctx.archived.map(item => [item.content === body, item.entry.title])), [[true, '최종 평가']]);
});

/* ======================= 연결 ======================= */
test('연결: 도구 메뉴에 두 단추가 있고(이 탭 단추는 문제은행 탭에서 숨긴다), index.html이 image-slot-place.js 바로 뒤에 이웃과 같은 ?v=로 싣는다', () => {
    const api = read('api.js');
    const tabButton = api.match(/<button onclick="fillEmptyPictures\('tab'\); this\.closest\('details'\)\.open = false" id="picture-batch-tab-btn"[^>]*title="([^"]*)"[^>]*><i class="ph-bold [^"]+"><\/i> 빈 그림 모두 만들기 \(이 탭\)<\/button>/);
    const lessonButton = api.match(/<button onclick="fillEmptyPictures\('lesson'\); this\.closest\('details'\)\.open = false" id="picture-batch-lesson-btn"[^>]*title="([^"]*)"[^>]*><i class="ph-bold [^"]+"><\/i> 빈 그림 모두 만들기 \(이 차시\)<\/button>/);
    assert.ok(tabButton && lessonButton, '글자가 있는 단추 둘, 누르면 메뉴를 닫는다');
    assert.ok(tabButton[1].includes('이 탭') && lessonButton[1].includes('모든 탭') && lessonButton[1].includes('학습이해도·심화이해도'), `${tabButton[1]}\n${lessonButton[1]}`);
    assert.ok(api.includes("${isQuestionBankTab(currentLessonTab) ? '' : `<button onclick=\"fillEmptyPictures('tab');"), '이 탭 단추는 문제은행 탭에서 보이지 않는다');
    const at = id => api.indexOf(`id="${id}"`);
    assert.ok(at('image-slot-btn') < at('picture-batch-tab-btn') && at('picture-batch-tab-btn') < at('picture-batch-lesson-btn') && at('picture-batch-lesson-btn') < at('video-insert-btn'), '그림 자리 넣기 바로 아래');
    const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script src="\.\/js\/([\w-]+)\.js\?v=(\d+)"><\/script>/g)].map(match => [match[1], match[2]]);
    const order = scripts.map(([name]) => name);
    assert.strictEqual(order.indexOf('image-batch'), order.indexOf('image-slot-place') + 1, order.join(','));
    assert.strictEqual(new Set(scripts.map(([, v]) => v)).size, 1, '새 태그도 이웃과 같은 ?v=');
    assert.strictEqual(order.filter(name => name === 'image-batch').length, 1);
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
