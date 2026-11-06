// 시작할 때 저장본 읽기와 백업 ZIP·PC 폴더 되살리기 흐름 테스트 (실행: node tests/import-restore.test.js)
// 실제 data-safety.js와 state.js를 vm에서 돌린다. 브라우저 저장소·ZIP·폴더·화면은 메모리 속 가짜로 둔다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', 'js');
const plain = value => JSON.parse(JSON.stringify(value));
const PNG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(8);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// db: IndexedDB 대신 Map. fail: { get, set, setWhen(key), backup, cancel } 중 켤 것. legacy: 예전 localStorage 저장본(글자)
// document: 막는 창을 실제로 그릴 때 쓰는 가짜 화면(makeDom). realDialog: 막는 창을 그대로 둔다(아니면 연 횟수만 센다). extra: 문맥에 더할 것(Blob·URL 등)
function makeApp({ db = new Map(), fail = {}, legacy = null, legacyRemoveThrows = false, document = null, realDialog = false, extra = {} } = {}) {
    const local = new Map(legacy == null ? [] : [['k', legacy]]);
    const log = { writes: [], removed: 0, dialogs: 0, alerts: [], toasts: [], confirms: [], backups: 0 };
    const ctx = {
        console: { log() {}, info() {}, warn() {}, error() {} },
        JSON, Date, Map, Set, Promise, Symbol, Uint8Array, TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout, Buffer,
        STORAGE_KEY: 'k', INITIAL_MOCK_STATE: { courseTitle: '예시', subjects: [{ id: 'subject_1', title: '예시 교과', lessons: [{ id: 101, title: '1차시' }, { id: 102, title: '2차시' }] }] },
        localStorage: {
            getItem: key => (local.has(key) ? local.get(key) : null),
            setItem: (key, value) => local.set(key, String(value)),
            removeItem: key => { if (legacyRemoveThrows) throw new Error('SecurityError'); log.removed += 1; local.delete(key); }
        },
        document: document || { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, createElement: () => ({}), visibilityState: 'visible' },
        location: { hash: '#overview' },
        escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        safeJSONParse: text => { try { return JSON.parse(text); } catch (e) { return null; } },
        renderSidebar() {}, renderOverview() {}, toggleFolderDropdown() {}, viewModule() {}, saveAs() {},
        ...extra
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['filename-convention.js', 'data-safety.js', 'state.js'].forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file }));
    // 저장소와 화면 바깥쪽만 바꾼다(실제 함수는 그대로 돈다)
    ctx.__db = db;
    ctx.__fail = fail;
    ctx.__log = log;
    vm.runInContext(`
        DBManager.getItem = async key => { if (__fail.get) throw new Error('읽기 실패'); return __db.get(key); };
        DBManager.setItem = async (key, value) => { if (__fail.set || (__fail.setWhen && __fail.setWhen(key))) throw new Error('쓰기 실패'); __log.writes.push([key, JSON.parse(JSON.stringify(value))]); __db.set(key, value); };
        DBManager.deleteItem = async key => { __db.delete(key); };
        DBManager.keys = async () => [...__db.keys()];
        downloadSafetyBackup = async () => { __log.backups += 1; if (__fail.backup) throw new RangeError('Invalid string length'); };
        window.showAlert = text => __log.alerts.push(text);
        window.showToast = text => __log.toasts.push(text);
        window.showConfirm = (message, onOk, opts) => { __log.confirms.push(message); (__fail.cancel ? opts.onCancel : onOk)(); };
        this.__get = () => ({ globalState, contentHistory, stateLoadFailed, currentSubjectId, courseData, projectFolderHandle, unreadRecord });
        this.__set = (patch) => { if ('globalState' in patch) globalState = patch.globalState; if ('contentHistory' in patch) contentHistory = patch.contentHistory; if ('currentSubjectId' in patch) currentSubjectId = patch.currentSubjectId; if ('courseData' in patch) courseData = patch.courseData; if ('projectFolderHandle' in patch) projectFolderHandle = patch.projectFolderHandle; if ('stateLoadFailed' in patch) stateLoadFailed = patch.stateLoadFailed; };
    `, ctx);
    if (!realDialog) vm.runInContext('showStateLoadFailedDialog = () => { __log.dialogs += 1; };', ctx);
    return { ctx, log, local, get: () => ctx.__get() };
}

const stored = () => ({ state: { courseTitle: '내 과정', subjects: [{ id: 'subject_1', title: '내 교과', lessons: [{ id: 1, title: '내 차시', images: { '(': PNG, ok: PNG } }] }] }, history: [null, { id: 5, title: '기록' }] });

/* ---------- 시작할 때 저장본 읽기 ---------- */
test('읽기에서 던지면 덮어쓰지 않고 저장을 멈춘다. 풀면 다시 저장한다', async () => {
    const app = makeApp({ fail: { get: true } });
    assert.strictEqual(await app.ctx.restoreState(), 'failed');
    assert.deepStrictEqual([app.log.writes.length, app.log.removed, app.get().stateLoadFailed, app.get().globalState.subjects.length], [0, 0, true, 0]);
    assert.strictEqual(app.get().unreadRecord, undefined, '읽지 못했으니 내려받을 것도 없다');
    assert.strictEqual(await app.ctx.saveState(), false);
    assert.deepStrictEqual([app.log.writes.length, app.log.dialogs], [0, 1]);
    app.ctx.__fail.get = false;
    app.ctx.markStateLoaded();
    await app.ctx.saveState();
    assert.strictEqual(app.log.writes.length, 1);
});

test('모양이 틀린 저장본(state 없음·글자·쓰레기)도 덮어쓰지 않고, 읽어 온 값은 내려받을 수 있게 둔다', async () => {
    for (const data of [{ history: [{ id: 1 }] }, { state: 'x' }, { state: [] }, 'garbage', 5]) {
        const app = makeApp({ db: new Map([['k', data]]) });
        assert.strictEqual(await app.ctx.restoreState(), 'failed', JSON.stringify(data));
        assert.strictEqual(app.log.writes.length, 0);
        assert.deepStrictEqual(app.get().unreadRecord, data);
    }
});

test('예전 localStorage 저장본을 읽지 못하면 그대로 두고 멈춘다', async () => {
    const app = makeApp({ legacy: '{not json' });
    assert.strictEqual(await app.ctx.restoreState(), 'failed');
    assert.deepStrictEqual([app.log.writes.length, app.log.removed, app.local.get('k')], [0, 0, '{not json']);
    assert.strictEqual(app.get().unreadRecord, '{not json', '풀지 못한 글도 내려받을 수 있게 둔다');
});

test('아무것도 없으면 예시 과정을 넣는다', async () => {
    const app = makeApp();
    assert.strictEqual(await app.ctx.restoreState(), 'empty');
    assert.strictEqual(app.log.writes.length, 1);
    assert.strictEqual(app.get().globalState.subjects[0].id, 'subject_1');
});

test('바른 저장본: 쓰지 않고 열며, 이상한 그림 키와 기록만 뺀다(옛 저장본 지우기가 실패해도 괜찮다)', async () => {
    const app = makeApp({ db: new Map([['k', stored()]]), legacyRemoveThrows: true });
    assert.strictEqual(await app.ctx.restoreState(), 'ok');
    assert.strictEqual(app.log.writes.length, 0);
    const { globalState, contentHistory } = app.get();
    assert.strictEqual(globalState.courseTitle, '내 과정');
    assert.deepStrictEqual(Object.keys(globalState.subjects[0].lessons[0].images), ['ok']);
    assert.deepStrictEqual(plain(contentHistory.map(h => h.id)), [5]);
});

test('예전 localStorage 저장본은 옮긴 뒤에만 지운다. 옮기지 못하면 남긴다', async () => {
    const moved = makeApp({ legacy: JSON.stringify(stored()) });
    assert.strictEqual(await moved.ctx.restoreState(), 'ok');
    assert.deepStrictEqual([moved.log.writes.length, moved.log.removed, moved.local.has('k')], [1, 1, false]);
    const stuck = makeApp({ legacy: JSON.stringify(stored()), fail: { set: true } });
    assert.strictEqual(await stuck.ctx.restoreState(), 'ok');
    assert.deepStrictEqual([stuck.log.removed, stuck.local.has('k')], [0, true], '브라우저 저장소에 옮기지 못했으면 예전 저장본이 유일한 사본이다');
});

test('새로 시작: 읽지 못한 저장본을 따로 옮겨 두고, 폴더 연결을 잊고, 예시 과정의 차시를 비우지 않는다', async () => {
    const unread = { state: 'x', keep: '내 원본' };
    const app = makeApp({ db: new Map([['k', unread], ['projectFolderHandle', { name: '옛 폴더' }]]) });
    assert.strictEqual(await app.ctx.restoreState(), 'failed');
    app.ctx.__set({ currentSubjectId: 'subject_1', courseData: [], projectFolderHandle: { name: '메모리 속 옛 폴더' } }); // #editor/subject_1 로 연 화면
    await app.ctx.startFreshAfterUnreadState();
    assert.ok(app.log.confirms[0].includes("'읽지 못한 저장본 내려받기'"), '먼저 파일로 받아 둘 수 있다고 알린다(작업 기록과 헷갈리지 않게 저장본이라고 부른다)');
    const { stateLoadFailed, currentSubjectId, projectFolderHandle } = app.get();
    assert.deepStrictEqual([stateLoadFailed, currentSubjectId, projectFolderHandle], [false, null, null]);
    const copy = app.log.writes.find(([key]) => key.startsWith('k:읽지못함:'));
    assert.ok(copy && copy[1].keep === '내 원본', '읽지 못한 저장본을 다른 이름으로 남긴다');
    const last = app.log.writes.filter(([key]) => key === 'k').pop();
    assert.strictEqual(last[1].state.subjects[0].lessons.length, 2);
    assert.ok(!app.ctx.__db.has('projectFolderHandle'));
    app.ctx.__fail.cancel = true;
    await app.ctx.startFreshAfterUnreadState();
    assert.strictEqual(app.log.writes.filter(([key]) => key === 'k').length, 1, '다시 눌러도 또 하지 않는다');
});

test('새로 시작: 저장본을 다시 읽어 이제 열 수 있으면(잠깐 생긴 문제였으면) 예시 과정으로 덮지 않고 다시 읽기로 열게 한다', async () => {
    const app = makeApp({ db: new Map([['k', stored()]]), fail: { get: true } });
    assert.strictEqual(await app.ctx.restoreState(), 'failed');
    app.ctx.__fail.get = false; // 이제 읽힌다
    await app.ctx.startFreshAfterUnreadState();
    assert.strictEqual(app.get().stateLoadFailed, true, '읽지 못한 창 그대로(다시 읽기로 연다)');
    assert.strictEqual(app.log.writes.length, 0, '저장본도 사본도 쓰지 않는다');
    assert.strictEqual(app.ctx.__db.get('k').state.courseTitle, '내 과정');
    assert.ok(app.log.alerts.at(-1).includes('새로 시작하지 않았습니다') && app.log.alerts.at(-1).includes("'다시 읽기'를 눌러"), app.log.alerts.at(-1));
    // 다시 읽어도 열 수 없으면(읽지 못한 그대로면) 새로 시작한다
    const broken = makeApp({ db: new Map([['k', { state: 'x' }]]) });
    await broken.ctx.restoreState();
    await broken.ctx.startFreshAfterUnreadState();
    assert.strictEqual(broken.get().stateLoadFailed, false);
    assert.strictEqual(broken.ctx.__db.get('k').state.subjects[0].id, 'subject_1');
});

test('따로 옮겨 둔 사본은 새것 셋만 남기고(다른 이름은 그대로), 옮기지 못하면 앞 사본을 지우지 않는다', async () => {
    const copies = ['k:읽지못함:100', 'k:읽지못함:200', 'k:읽지못함:300'];
    const db = new Map([['k', { state: 'x' }], ...copies.map((key, i) => [key, { old: i }]), ['k:읽지못함:메모', '그대로'], ['other', 1]]);
    const app = makeApp({ db });
    await app.ctx.restoreState();
    await app.ctx.setAsideUnreadState();
    const left = [...db.keys()].filter(key => /^k:읽지못함:\d+$/.test(key));
    assert.strictEqual(left.length, 3);
    assert.ok(!db.has('k:읽지못함:100') && db.has('k:읽지못함:200') && db.has('k:읽지못함:300'), '가장 오래된 사본을 지운다');
    assert.ok(db.has('k:읽지못함:메모') && db.has('other'), '이 모양이 아닌 이름은 건드리지 않는다');
    const stuckDb = new Map([['k', { state: 'x' }], ...copies.map(key => [key, 1]), ['k:읽지못함:400', 1]]);
    const stuck = makeApp({ db: stuckDb, fail: { setWhen: key => key.startsWith('k:읽지못함:') } });
    await stuck.ctx.restoreState();
    await stuck.ctx.setAsideUnreadState();
    assert.strictEqual([...stuckDb.keys()].filter(key => key.startsWith('k:읽지못함:')).length, 4, '새 사본을 남기지 못했으면 앞 사본을 지우지 않는다');
    assert.strictEqual(stuck.get().projectFolderHandle, null);
});

test('읽지 못한 저장본은 한 창에서 한 번만 옮겨 둔다(다시 해도 같은 사본이 늘거나 다른 날 옮겨 둔 사본을 밀어내지 않는다)', async () => {
    const older = ['k:읽지못함:100', 'k:읽지못함:200', 'k:읽지못함:300'];
    const db = new Map([['k', { state: 'x' }], ...older.map((key, i) => [key, { day: i }])]);
    const app = makeApp({ db });
    await app.ctx.restoreState();
    await app.ctx.setAsideUnreadState();
    await app.ctx.setAsideUnreadState();
    assert.strictEqual(app.log.writes.filter(([key]) => key.startsWith('k:읽지못함:')).length, 1, '한 번만 옮긴다');
    assert.ok(!db.has('k:읽지못함:100') && db.has('k:읽지못함:200') && db.has('k:읽지못함:300'), '두 번째에는 다른 사본을 밀어내지 않는다');
});

test('사본 정리는 이 창에서 방금 옮긴 사본을 지우지 않는다(시계가 뒤로 가서 앞 사본들이 더 새것으로 보여도)', async () => {
    const future = ['k:읽지못함:9000000000001', 'k:읽지못함:9000000000002', 'k:읽지못함:9000000000003'];
    const db = new Map([['k', { state: 'x' }], ...future.map(key => [key, 1])]);
    const app = makeApp({ db });
    await app.ctx.restoreState();
    await app.ctx.setAsideUnreadState();
    const copyKey = app.log.writes.find(([key]) => key.startsWith('k:읽지못함:'))[0];
    assert.deepStrictEqual(db.get(copyKey), { state: 'x' }, '방금 옮긴 사본은 남는다');
});

test('따로 옮겨 둔 사본: 내보내기·백업 메뉴에 새것부터 보이고(없거나 목록을 읽지 못하면 숨김), 누른 때 다시 확인한 사본만 고치지 않은 그대로 내려받는다', async () => {
    const blobs = [];
    const objects = [];
    class FakeBlob { constructor(parts, opts) { this.parts = parts; this.opts = opts; blobs.push(this); } }
    const extra = { Blob: FakeBlob, URL: { createObjectURL: blob => { objects.push(blob); return 'blob:1'; }, revokeObjectURL() {} } };
    const dom = makeDom();
    const [section, list] = ['div', 'div'].map(tag => dom.body.appendChild(dom.make(tag)));
    section.id = 'unread-copies-section';
    section.hidden = true;
    list.id = 'unread-copies-list';
    const jsonCopy = { state: 'x', note: '<b>원본 "따옴표"</b>' };
    const fileCopy = new FakeBlob(['{"state":'], { type: 'application/json' }); // 큰 작업은 JSON 파일(Blob)로 저장되므로 그 사본도 파일이다
    blobs.length = 0;
    const [older, newer, newest] = [Date.UTC(2026, 10, 4, 1, 0), Date.UTC(2026, 10, 5, 2, 30), Date.UTC(2026, 10, 6, 3, 45)];
    const db = new Map([['k', { state: '지금' }], ['projectFolderHandle', { name: '폴더' }], ['wbvideo:wb_1', '영상'], ['k:읽지못함:메모', '메모'],
        [`k:읽지못함:${newer}`, jsonCopy], [`k:읽지못함:${newest}`, fileCopy], [`k:읽지못함:${older}`, '{not json'], ['k:읽지못함:9999999999999999', '시각 밖']]);
    const app = makeApp({ db, document: dom.document, extra });
    vm.runInContext('(() => { const get = DBManager.getItem; DBManager.getItem = async key => { __log.reads = [...(__log.reads || []), key]; return get(key); }; })();', app.ctx);
    await app.ctx.renderUnreadCopies();
    assert.strictEqual(section.hidden, false);
    const shown = [...list.innerHTML.matchAll(/data-unread-copy="([^"]+)"/g)].map(match => match[1]);
    assert.deepStrictEqual(shown, [`k:읽지못함:${newest}`, `k:읽지못함:${newer}`, `k:읽지못함:${older}`], '사본만 새것부터(시각으로 읽을 수 없는 이름은 뺀다)');
    assert.ok(!list.innerHTML.includes('<b>') && list.innerHTML.includes('에 남긴 사본'), list.innerHTML);
    assert.deepStrictEqual(app.log.reads || [], [], '목록을 그릴 때는 사본을 읽지 않는다');
    // 버튼을 누르면 그 사본을 받고 메뉴를 닫는다
    let closed = 0;
    app.ctx.window.toggleExportDropdown = () => { closed += 1; };
    list.onclick({ target: { closest: () => ({ dataset: { unreadCopy: `k:읽지못함:${newer}` } }) } });
    await new Promise(resolve => setTimeout(resolve, 0));
    const link = () => dom.created.filter(el => el.tagName === 'a').at(-1);
    assert.strictEqual(closed, 1);
    assert.ok(/^교안_읽지못한저장본_사본_\d{8}-\d{4}\.json$/.test(link().download) && link().clicks === 1, link().download);
    assert.strictEqual(link().download, `교안_읽지못한저장본_사본_${vm.runInContext('backupStamp', app.ctx)(new Date(newer))}.json`, '옮긴 시각으로 이름을 짓는다');
    assert.strictEqual(blobs.at(-1).parts.join(''), JSON.stringify(jsonCopy), '고치지 않은 그대로');
    await app.ctx.downloadUnreadCopy(`k:읽지못함:${newest}`);
    assert.strictEqual(objects.at(-1), fileCopy, 'JSON 파일 사본은 그 파일 그대로');
    assert.ok(link().download.endsWith('.json'));
    await app.ctx.downloadUnreadCopy(`k:읽지못함:${older}`);
    assert.deepStrictEqual(plain(blobs.at(-1).parts), ['{not json']);
    assert.ok(link().download.endsWith('.txt'), '예전 글자 저장본의 사본은 .txt');
    // 사본이 아닌 이름(지금 저장본·폴더 연결·판서 영상), 목록에 없는 이름은 읽지 않고 알린다
    app.log.reads = [];
    for (const key of ['k', 'projectFolderHandle', 'wbvideo:wb_1', 'k:읽지못함:메모', 'k:읽지못함:9999999999999999', 'k:읽지못함:123', undefined]) await app.ctx.downloadUnreadCopy(key);
    assert.deepStrictEqual(app.log.reads, []);
    assert.ok(app.log.alerts.length === 7 && app.log.alerts.every(text => text.startsWith('그 사본을 찾지 못했습니다')), app.log.alerts.join('\n'));
    // 메뉴를 연 뒤 정리된 사본을 눌러도 멈추지 않고 알린다
    db.delete(`k:읽지못함:${newer}`);
    await app.ctx.downloadUnreadCopy(`k:읽지못함:${newer}`);
    assert.strictEqual(app.log.alerts.length, 8);
    // 사본이 없거나 목록을 읽지 못하면 칸을 숨긴다
    [...db.keys()].filter(key => /^k:읽지못함:\d+$/.test(key)).forEach(key => db.delete(key));
    await app.ctx.renderUnreadCopies();
    assert.deepStrictEqual([section.hidden, list.innerHTML], [true, '']);
    db.set(`k:읽지못함:${newer}`, jsonCopy);
    vm.runInContext('DBManager.keys = async () => { throw new Error("목록 읽기 실패"); };', app.ctx);
    await app.ctx.renderUnreadCopies();
    assert.strictEqual(section.hidden, true);
});

test("새로 시작 확인 창과 막는 창의 글: 읽지 못한 저장본을 사본으로 남기고 '내보내기·백업'에서 받을 수 있다고 알린다(지운다고 하지 않는다)", async () => {
    const app = makeApp({ db: new Map([['k', { state: 'x' }]]) });
    await app.ctx.restoreState();
    app.ctx.__fail.cancel = true;
    await app.ctx.startFreshAfterUnreadState();
    const text = app.log.confirms[0];
    assert.ok(text.includes("'내보내기·백업' 메뉴의 '읽지 못한 저장본 사본'") && !text.includes('지우고') && !text.includes('되돌릴 수 없습니다'), text);
    assert.ok(text.includes("'읽지 못한 저장본 내려받기'"), '읽어 온 저장본이 있으면 먼저 받아 둘 수 있다고 그대로 알린다');
    assert.strictEqual(app.get().stateLoadFailed, true, '취소하면 그대로');
    const dialog = vm.runInContext('stateLoadFailedText', app.ctx)({ folder: true, download: true });
    assert.ok(dialog.includes("'내보내기·백업' 메뉴에서 파일로 받을 수 있습니다") && !dialog.includes('읽지 못한 기록'), dialog);
    // 메뉴의 칸은 처음에 숨겨 두고, 메뉴를 열 때마다 다시 그린다
    const html = fs.readFileSync(path.join(root, '..', 'index.html'), 'utf8');
    assert.ok(html.includes('<div id="unread-copies-section" hidden>') && html.includes('<div id="unread-copies-list"'));
    assert.ok(/if \(wasHidden\) window\.renderUnreadCopies\?\.\(\);/.test(fs.readFileSync(path.join(root, 'ui.js'), 'utf8')));
});

/* ---------- 백업 ZIP ---------- */
const zipOf = files => ({ loadAsync: async () => ({ files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { dir: false, async: async kind => (kind === 'base64' ? Buffer.from(text).toString('base64') : text) }])) }) });
function backupFiles({ titles = ['C++ 기초', '1) 개요'], subjectTitle = '프로그래밍', context, md } = {}) {
    const lessons = titles.map((title, i) => ({ id: i + 1, title, content: `${title} 글`, images: {}, tabContents: { basicLearn: `${title} 탭` } }));
    const files = { '받은 과정/save_data.yaml': JSON.stringify({ project: '받은 과정', subject: subjectTitle, context: context ?? { courseTitle: '받은 과정', subjects: [{ id: 'subject_9', title: subjectTitle, lessons }] } }) };
    titles.forEach((title, i) => { files[`받은 과정/${subjectTitle}/0${i + 1}_${i}.md`] = md ? md(title, i) : `# ${title}\n\n${title} 새 글 ![img_${i}](../첨부파일/img_${i}.png)`; });
    files['받은 과정/첨부파일/img_0.png'] = 'PNGDATA';
    return files;
}
async function importZip(app, files) {
    app.ctx.JSZip = zipOf(files);
    await app.ctx.importProjectZip({ target: { files: [{ name: 'b.zip' }], value: 'x' } });
}
const mine = () => ({ courseTitle: '내 과정', subjects: [{ id: 'subject_1', title: '내 교과', lessons: [{ id: 1, title: '내 차시', content: '내 글', images: {} }] }] });

test('ZIP: 제목에 정규식 글자가 있어도 되살리고, MD와 첨부 그림을 그 차시에 맞춘다', async () => {
    const app = makeApp();
    const before = app.ctx.sanitizeState(mine());
    app.ctx.__set({ globalState: before, currentSubjectId: 'subject_1', courseData: before.subjects[0].lessons });
    await importZip(app, backupFiles());
    const { globalState, currentSubjectId, contentHistory } = app.get();
    assert.ok(contentHistory.some(h => h.reason === '불러오기 전' && h.content === '내 글'), '바꾸기 전 지금 차시를 작업 기록에 남긴다');
    assert.deepStrictEqual(app.log.alerts, ['백업 파일로 과정 전체를 되살렸습니다.']);
    assert.deepStrictEqual([globalState.courseTitle, currentSubjectId], ['받은 과정', 'subject_9']);
    const [first, second] = globalState.subjects[0].lessons;
    assert.strictEqual(first.content, 'C++ 기초 새 글 <!-- [IMG: "local:img_0"] -->');
    assert.ok(first.images.img_0.startsWith('data:image/png;base64,'));
    assert.strictEqual(second.content, '1) 개요 새 글 <!-- [IMG: "local:img_1"] -->', '첨부 파일이 없는 그림은 자리만 되돌린다');
    assert.ok(app.log.confirms[0].includes('이 파일의 내용(교과 1개)'));
    assert.strictEqual(app.log.writes.filter(([key]) => key === 'k').length, 2, '불러오기 전 기록 1번 + 바꾼 뒤 1번');
});

test('ZIP: 바꾸기 전에 멈추면(안전 백업 실패 후 취소) 지금 상태는 같은 객체 그대로다', async () => {
    const app = makeApp({ fail: { backup: true } });
    const before = app.ctx.sanitizeState(mine());
    app.ctx.__set({ globalState: before, currentSubjectId: 'subject_1', courseData: before.subjects[0].lessons });
    // 첫 확인(전체 불러오기)은 받고, 안전 백업을 받지 못한 뒤 '백업 없이 계속'은 취소한다
    app.ctx.window.showConfirm = (message, onOk, opts) => { app.log.confirms.push(message); (app.log.confirms.length === 1 ? onOk : opts.onCancel)(); };
    await importZip(app, backupFiles());
    assert.strictEqual(app.log.confirms.length, 2, '백업을 받지 못하면 계속할지 묻는다');
    const now = app.get();
    assert.strictEqual(now.globalState, before);
    assert.deepStrictEqual([now.currentSubjectId, now.courseData, app.log.writes.length], ['subject_1', before.subjects[0].lessons, 0]);
});

test('ZIP: 바꾼 상태를 브라우저에 저장하지 못하면 바꾸기 전 상태(같은 객체)로 되돌리고 다시 저장한다', async () => {
    let stateWrites = 0;
    const app = makeApp({ fail: { setWhen: key => key === 'k' && ++stateWrites === 2 } }); // '불러오기 전' 기록 저장은 되고, 바꾼 뒤 저장은 실패한다
    const before = app.ctx.sanitizeState(mine());
    app.ctx.__set({ globalState: before, currentSubjectId: 'subject_1', courseData: before.subjects[0].lessons });
    await importZip(app, backupFiles());
    const now = app.get();
    assert.deepStrictEqual([now.globalState === before, now.currentSubjectId, now.courseData === before.subjects[0].lessons], [true, 'subject_1', true]);
    assert.ok(now.contentHistory.some(h => h.reason === '불러오기 전'), '바꾸기 전 기록은 남는다');
    const last = app.log.writes.filter(([key]) => key === 'k').pop();
    assert.strictEqual(last[1].state.courseTitle, '내 과정', '되돌린 상태를 다시 저장한다(이어진 PC 폴더에도 다시 쓴다)');
    assert.ok(!app.log.alerts.some(text => text.startsWith('백업 파일로 과정 전체를 되살렸습니다')), '되살렸다고 하지 않는다');
    assert.ok(app.log.alerts.at(-1).startsWith('이 파일의 작업을 브라우저에 저장하지 못해 되살리지 않았습니다'), app.log.alerts.at(-1));
    assert.ok(!app.log.alerts.at(-1).includes('Ctrl+S'), '되돌린 상태는 저장했다');
    // 되돌린 상태도 저장하지 못하면 그렇다고 알린다
    const worse = makeApp({ fail: { setWhen: key => key === 'k' && ++stateWrites > 3 } });
    const mineToo = worse.ctx.sanitizeState(mine());
    worse.ctx.__set({ globalState: mineToo, currentSubjectId: 'subject_1', courseData: mineToo.subjects[0].lessons });
    await importZip(worse, backupFiles());
    assert.strictEqual(worse.get().globalState, mineToo);
    assert.ok(worse.log.alerts.at(-1).includes('되살리기 전 작업도 다시 저장하지 못했습니다') && worse.log.alerts.at(-1).includes('Ctrl+S로 다시 저장해 주세요'), worse.log.alerts.at(-1));
});

test('ZIP: 이어진 PC 폴더에는 바꾼 상태를 브라우저에 저장한 뒤에만 쓴다(저장하지 못해 되돌리면 그 파일의 작업이 폴더에 남지 않는다)', async () => {
    // 글이 없는 과정이라 '불러오기 전' 기록을 남기지 않는다(그래서 바꾸기 전에 돌던 폴더 저장도 없다)
    const blank = () => ({ courseTitle: '내 과정', subjects: [{ id: 'subject_1', title: '내 교과', lessons: [{ id: 1, title: '내 차시' }] }] });
    const linked = fail => {
        const app = makeApp({ fail });
        const before = app.ctx.sanitizeState(blank());
        const yamlWrites = [];
        const entries = new Proxy({}, { set(target, name, value) { if (name === 'save_data.yaml' && value) yamlWrites.push(value); target[name] = value; return true; } });
        app.ctx.__set({ globalState: before, currentSubjectId: 'subject_1', courseData: before.subjects[0].lessons, projectFolderHandle: fakeFolder('내 폴더', entries) });
        return { app, before, entries, yamlWrites };
    };
    let stateWrites = 0;
    const failed = linked({ setWhen: key => key === 'k' && ++stateWrites === 1 }); // 바꾼 뒤 저장만 실패하고, 되돌린 상태는 저장된다
    await importZip(failed.app, backupFiles());
    await failed.app.ctx.waitFolderSync();
    assert.strictEqual(failed.app.get().globalState, failed.before);
    assert.ok(failed.app.log.alerts.at(-1).startsWith('이 파일의 작업을 브라우저에 저장하지 못해 되살리지 않았습니다'), failed.app.log.alerts.at(-1));
    assert.ok(failed.yamlWrites.length && failed.yamlWrites.every(text => !text.includes('받은 과정')), '폴더 저장본에 되돌린 파일의 작업을 쓰지 않는다');
    assert.ok(failed.yamlWrites.at(-1).includes('내 과정'), '되돌린 상태는 폴더에도 다시 쓴다');
    assert.ok(!('받은 과정' in failed.entries), '그 파일의 차시 MD·첨부 그림 폴더를 만들지 않는다');
    const done = linked({});
    await importZip(done.app, backupFiles());
    await done.app.ctx.waitFolderSync();
    assert.strictEqual(done.app.get().globalState.courseTitle, '받은 과정');
    assert.ok(done.yamlWrites.at(-1).includes('받은 과정') && '받은 과정' in done.entries, '브라우저에 저장한 뒤에는 폴더에도 쓴다');
});

test('ZIP: 되살릴 교과가 없으면 묻지 않고 멈춘다', async () => {
    const app = makeApp();
    const before = app.ctx.sanitizeState(mine());
    app.ctx.__set({ globalState: before });
    await importZip(app, backupFiles({ context: { subjects: 'x' } }));
    assert.strictEqual(app.get().globalState, before);
    assert.strictEqual(app.log.confirms.length, 0);
    assert.ok(app.log.alerts[0].includes('이 파일에는 되살릴 교과가 없습니다'));
});

test("ZIP: '심화'가 '개요 심화'의 글을 가져가지 않는다", async () => {
    const app = makeApp();
    app.ctx.__set({ globalState: app.ctx.sanitizeState(mine()) });
    await importZip(app, backupFiles({ titles: ['개요 심화', '심화'], md: title => `# ${title}\n\n${title}의 고친 글` }));
    assert.deepStrictEqual(plain(app.get().globalState.subjects[0].lessons.map(l => l.content)), ['개요 심화의 고친 글', '심화의 고친 글']);
});

test('ZIP: 읽지 못한 상태에서 되살리면 안전 백업 없이 묻고, 읽지 못한 저장본을 옮겨 두고, 폴더 연결을 잊는다', async () => {
    const app = makeApp({ db: new Map([['k', { state: 'x' }], ['projectFolderHandle', { name: '옛 폴더' }]]) });
    assert.strictEqual(await app.ctx.restoreState(), 'failed');
    app.ctx.__set({ projectFolderHandle: { name: '메모리 속 옛 폴더' } }); // 캐시가 섞여 옛 index.html이 폴더를 이었다
    await importZip(app, backupFiles());
    const now = app.get();
    assert.ok(app.log.confirms[0].startsWith('읽지 못한 브라우저 저장본 대신'));
    assert.deepStrictEqual([app.log.backups, now.stateLoadFailed, now.projectFolderHandle], [0, false, null]);
    assert.ok(app.log.writes.some(([key, value]) => key.startsWith('k:읽지못함:') && value.state === 'x'));
    assert.ok(!app.ctx.__db.has('projectFolderHandle'));
    assert.strictEqual(app.log.writes.filter(([key]) => key === 'k').length, 1);
    assert.strictEqual(now.unreadRecord, undefined, '되살린 뒤에는 읽지 못한 값을 붙잡아 두지 않는다');
});

test('ZIP: 읽지 못한 상태에서 되살린 것을 저장하지 못하면 읽지 못한 창으로 돌아간다(저장본은 그대로)', async () => {
    const app = makeApp({ db: new Map([['k', { state: 'x' }]]), fail: { setWhen: key => key === 'k' } });
    assert.strictEqual(await app.ctx.restoreState(), 'failed');
    await importZip(app, backupFiles());
    const now = app.get();
    assert.deepStrictEqual([now.stateLoadFailed, now.globalState.subjects.length, app.log.dialogs], [true, 0, 1]);
    assert.deepStrictEqual(app.ctx.__db.get('k'), { state: 'x' }, '읽지 못한 저장본은 그대로');
    assert.deepStrictEqual(now.unreadRecord, { state: 'x' }, '다시 내려받을 수 있다');
    assert.ok(app.log.alerts.at(-1).startsWith('이 파일의 작업을 브라우저에 저장하지 못해 되살리지 않았습니다'));
});

test('ZIP: 읽지 못한 상태에서 되살리기를 저장하지 못하면 이번에 옮긴 사본은 지우고(저장본이 제자리에 그대로) 다른 날의 사본은 그대로 둔다. 되살리면 그때 새것 셋만 남긴다', async () => {
    const older = ['k:읽지못함:100', 'k:읽지못함:200', 'k:읽지못함:300'];
    const db = new Map([['k', { state: 'x' }], ...older.map((key, i) => [key, { day: i }])]);
    const app = makeApp({ db, fail: { setWhen: key => key === 'k' } });
    await app.ctx.restoreState();
    const copies = () => [...db.keys()].filter(key => key.startsWith('k:읽지못함:')).sort();
    for (let attempt = 1; attempt <= 3; attempt++) {
        await importZip(app, backupFiles());
        assert.strictEqual(app.get().stateLoadFailed, true);
        assert.deepStrictEqual(copies(), older, `${attempt}번째: 이번 사본은 남지 않고 다른 날의 사본은 밀려나지 않는다`);
    }
    app.ctx.__fail.setWhen = () => false;
    await importZip(app, backupFiles());
    assert.strictEqual(app.get().stateLoadFailed, false);
    assert.strictEqual(db.get('k').state.courseTitle, '받은 과정');
    const left = copies();
    const fresh = left.filter(key => !older.includes(key));
    assert.deepStrictEqual([left.length, fresh.length, left.includes('k:읽지못함:100')], [3, 1, false], '되살린 뒤에 새것 셋만 남긴다');
    assert.deepStrictEqual(db.get(fresh[0]), { state: 'x' }, '남긴 사본은 되살리기 전 읽지 못한 저장본');
});

test('ZIP 단일 차시: 제목에 정규식 글자가 있어도 새 차시로 들어오고, 바른 첨부 그림만 붙는다', async () => {
    const app = makeApp();
    const before = app.ctx.sanitizeState(mine());
    app.ctx.__set({ globalState: before, currentSubjectId: 'subject_1', courseData: before.subjects[0].lessons });
    app.ctx.JSZip = zipOf({ 'p/save_data.yaml': JSON.stringify({ project: 'p', subject: '내 교과', module: '1) 개요', timestamp: 't' }), 'p/내 교과/01.md': '# 1) 개요\n\n본문 ![x](../첨부파일/img_1.png) <img src="../첨부파일/(bad.png">', 'p/첨부파일/img_1.png': 'PNGDATA' });
    await app.ctx.importProjectZip({ target: { files: [{ name: 'b.zip' }], value: 'x' } });
    const lessons = app.get().courseData;
    const added = lessons[lessons.length - 1];
    assert.deepStrictEqual([lessons.length, added.title], [2, '1) 개요']);
    assert.strictEqual(added.content, '본문 <!-- [IMG: "local:img_1"] --> <img src="../첨부파일/(bad.png">');
    assert.ok(added.images.img_1.startsWith('data:image/png;base64,'));
    assert.ok(Number.isSafeInteger(added.id) && added.id !== 1, '지금 차시와 겹치지 않는 숫자 id');
});

test('ZIP: 읽지 못한 상태에서는 교과·차시만 담은 백업으로 되살리지 않는다', async () => {
    for (const meta of [{ scope: 'subjects', context: { subjects: [{ id: 's', title: '교과', lessons: [] }] } }, { project: 'p', module: '차시 하나' }]) {
        const app = makeApp({ fail: { get: true } });
        await app.ctx.restoreState();
        app.ctx.JSZip = zipOf({ 'x/save_data.yaml': JSON.stringify(meta), 'x/a/01.md': '# 차시 하나\n\n글' });
        await app.ctx.importProjectZip({ target: { files: [{ name: 'b.zip' }], value: 'x' } });
        assert.deepStrictEqual(app.log.alerts, [app.ctx.window.UNREAD_PARTIAL_BACKUP_TEXT]);
        assert.strictEqual(app.get().stateLoadFailed, true);
    }
});

test('ZIP: 이상한 그림 키와 첨부 파일 이름에도 멈추지 않는다', async () => {
    const app = makeApp();
    app.ctx.__set({ globalState: app.ctx.sanitizeState(mine()) });
    const files = backupFiles({ md: () => '# C++ 기초\n\n![x](../첨부파일/(a+)+$.png) local:' + 'a'.repeat(40) + '!' });
    const meta = JSON.parse(files['받은 과정/save_data.yaml']);
    meta.context.subjects[0].lessons[0].images = { '(': PNG, '(a+)+$': PNG, ok: PNG };
    files['받은 과정/save_data.yaml'] = JSON.stringify(meta);
    files['받은 과정/첨부파일/(a+)+$.png'] = 'X';
    const started = Date.now();
    await importZip(app, files);
    assert.ok(Date.now() - started < 1000);
    assert.deepStrictEqual(Object.keys(app.get().globalState.subjects[0].lessons[0].images), ['ok']);
});

/* ---------- PC 폴더 ---------- */
test('읽지 못한 동안은 연결된 폴더가 메모리에 남아 있어도 폴더에 쓰지 않고, 폴더 연결도 시작하지 않는다', async () => {
    const app = makeApp({ fail: { get: true } });
    await app.ctx.restoreState();
    let touched = 0;
    app.ctx.__set({ projectFolderHandle: { name: 'f', queryPermission: async () => { touched += 1; return 'granted'; }, getDirectoryHandle: async () => { touched += 1; throw new Error('x'); } } });
    assert.strictEqual(await app.ctx.syncToLinkedFolder(), false);
    await app.ctx.syncHistoryItemToFolder({ id: 1, title: '기록' });
    assert.strictEqual(touched, 0);
    let asked = 0;
    app.ctx.window.showDirectoryPicker = async () => { asked += 1; throw Object.assign(new Error('x'), { name: 'AbortError' }); };
    await app.ctx.connectProjectFolder();
    assert.strictEqual(asked, 0, '읽지 못한 동안은 폴더에 쓰기 시작하지 않는다');
});

// 메모리 속 가짜 폴더(필요한 것만): 파일 읽기·쓰기, 하위 폴더, 권한
function fakeFolder(name, files = {}) {
    const notFound = () => Object.assign(new Error('없음'), { name: 'NotFoundError' });
    const dir = (dirName, entries) => ({
        name: dirName, kind: 'directory',
        queryPermission: async () => 'granted', requestPermission: async () => 'granted',
        async getFileHandle(fileName, opts = {}) {
            if (!(fileName in entries)) { if (!opts.create) throw notFound(); entries[fileName] = ''; }
            if (typeof entries[fileName] === 'object') throw Object.assign(new Error('폴더'), { name: 'TypeMismatchError' });
            return {
                name: fileName, kind: 'file',
                getFile: async () => ({ size: Buffer.byteLength(String(entries[fileName])), text: async () => String(entries[fileName]), arrayBuffer: async () => Buffer.from(String(entries[fileName])) }),
                createWritable: async () => { let data = ''; return { write: async chunk => { data += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('latin1'); }, close: async () => { entries[fileName] = data; }, abort: async () => {} }; }
            };
        },
        async getDirectoryHandle(dirChild, opts = {}) {
            if (!(dirChild in entries)) { if (!opts.create) throw notFound(); entries[dirChild] = {}; }
            return dir(dirChild, entries[dirChild]);
        },
        async *keys() { yield* Object.keys(entries); }
    });
    return dir(name, files);
}

test('PC 폴더: 읽지 못한 상태에서 열면 안전 백업 없이 묻고, 읽지 못한 저장본을 옮겨 두고, 폴더의 기록·휴지통을 받는다', async () => {
    const app = makeApp({ db: new Map([['k', { state: 'x' }], ['projectFolderHandle', { name: '옛 폴더' }]]) });
    assert.strictEqual(await app.ctx.restoreState(), 'failed');
    const iso = new Date().toISOString();
    const yaml = app.ctx.simpleYamlStringify({ state: { courseTitle: '폴더 과정', subjects: [{ id: 'subject_5', title: '폴더 교과', lessons: [{ id: 1, title: '차시', content: '글' }] }], lessonTrash: [{ at: iso, lesson: { id: 9, title: '지운 차시' } }] }, history: [null, { id: 4, title: '폴더 기록' }] });
    const folder = fakeFolder('내 폴더', { 'save_data.yaml': yaml });
    app.ctx.window.showDirectoryPicker = async () => folder;
    await app.ctx.loadFromProjectFolder();
    await app.ctx.waitFolderSync(); // 폴더 저장 줄이 끝날 때까지
    const now = app.get();
    assert.ok(app.log.confirms[0].startsWith("읽지 못한 브라우저 저장본 대신 '내 폴더' 폴더의 작업(교과 1개)"), app.log.confirms[0]);
    assert.deepStrictEqual([app.log.backups, now.stateLoadFailed, now.globalState.courseTitle, now.currentSubjectId], [0, false, '폴더 과정', 'subject_5']);
    assert.deepStrictEqual(plain(now.contentHistory.map(h => h.id)), [4]);
    assert.strictEqual(now.globalState.lessonTrash.length, 1, '폴더의 휴지통을 버리지 않는다');
    assert.ok(app.log.writes.some(([key, value]) => key.startsWith('k:읽지못함:') && value.state === 'x'));
    assert.strictEqual(now.projectFolderHandle, folder, '연 폴더에 이어 저장한다');
    assert.strictEqual(app.ctx.__db.get('projectFolderHandle'), folder, '브라우저에 저장한 뒤 이 폴더를 기억한다(옛 폴더는 잊는다)');
});

test('PC 폴더: 되살릴 교과가 없거나 풀지 못한 저장본이면 묻지 않고 그대로 두며, 풀지 못한 것은 교과가 없다고 하지 않는다', async () => {
    const cases = [
        [{ 'save_data.yaml': { state: 'x' } }, '(save_data.yaml)을 읽을 수 없습니다'],
        [{ 'save_data.yaml': { history: [] } }, '(save_data.yaml)을 읽을 수 없습니다'],
        [{ 'save_data.yaml': '망가진 글\n:::' }, '(save_data.yaml)을 읽을 수 없습니다'],
        [{ 'save_data.json': '{망가짐' }, '(save_data.json)을 읽을 수 없습니다'],
        [{ 'save_data.yaml': { state: { subjects: [] } } }, '(save_data.yaml)에는 되살릴 교과가 없습니다']
    ];
    for (const [files, says] of cases) {
        const app = makeApp();
        const before = app.ctx.sanitizeState(mine());
        app.ctx.__set({ globalState: before });
        const texts = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? value : app.ctx.simpleYamlStringify(value)]));
        app.ctx.window.showDirectoryPicker = async () => fakeFolder('빈 폴더', texts);
        await app.ctx.loadFromProjectFolder();
        assert.strictEqual(app.get().globalState, before, JSON.stringify(files));
        assert.deepStrictEqual([app.log.confirms.length, app.log.writes.length], [0, 0]);
        assert.ok(app.log.alerts[0].includes(says), app.log.alerts[0]);
        if (says.includes('읽을 수 없습니다')) assert.ok(!app.log.alerts[0].includes('교과가 없습니다'), '망가진 저장본을 빈 저장본처럼 말하지 않는다');
    }
});

test('PC 폴더: 읽지 못한 상태에서 열고 브라우저에 저장하지 못하면, 새로고침 뒤 열기 전 작업이 아니라 읽지 못한 창이 다시 뜰 수 있다고 알린다', async () => {
    const app = makeApp({ db: new Map([['k', { state: 'x' }]]), fail: { setWhen: key => key === 'k' } });
    assert.strictEqual(await app.ctx.restoreState(), 'failed');
    const yaml = app.ctx.simpleYamlStringify({ state: { courseTitle: '폴더 과정', subjects: [{ id: 'subject_5', title: '폴더 교과', lessons: [{ id: 1, title: '차시', content: '글' }] }] } });
    app.ctx.window.showDirectoryPicker = async () => fakeFolder('내 폴더', { 'save_data.yaml': yaml });
    await app.ctx.loadFromProjectFolder();
    await app.ctx.waitFolderSync();
    const last = app.log.alerts.at(-1);
    assert.ok(last.startsWith("'내 폴더' 폴더의 작업을 열었습니다.") && last.includes("'저장된 작업을 읽지 못했습니다' 창이 다시 뜰 수 있으니"), last);
    assert.ok(!last.includes('열기 전 작업이 보일'), last);
    assert.deepStrictEqual(app.ctx.__db.get('k'), { state: 'x' }, '읽지 못한 저장본은 제자리에 그대로(새로고침하면 읽지 못한 창)');
    assert.ok([...app.ctx.__db.keys()].some(key => key.startsWith('k:읽지못함:')), '폴더 열기는 되돌리지 않으므로 사본을 남긴다');
});

/* ---------- 막는 창과 내려받기 (가짜 화면) ---------- */
// 필요한 것만 흉내 낸 화면: body의 자식 목록, 만든 요소, 포커스. 요소의 querySelector는 고른 글마다 같은 가짜 요소를 돌려준다
function makeDom() {
    const body = { children: [], appendChild(el) { body.children.push(el); return el; } };
    const dom = { body, focused: null, created: [] };
    const make = tag => {
        const el = {
            tagName: tag, id: '', className: '', innerHTML: '', inert: false, dataset: {}, attributes: {}, listeners: {}, parts: {}, clicks: 0,
            setAttribute(name, value) { el.attributes[name] = String(value); },
            addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
            querySelector(selector) { if (!el.parts[selector]) el.parts[selector] = make('part'); return el.parts[selector]; },
            matches(selector) { return selector.split(',').map(s => s.trim()).some(s => (s === '[data-app-dialog]' && 'appDialog' in el.dataset) || (s === '[data-app-toast]' && 'appToast' in el.dataset)); },
            remove() { const at = body.children.indexOf(el); if (at >= 0) body.children.splice(at, 1); },
            focus() { dom.focused = el; },
            click() { el.clicks += 1; }
        };
        return el;
    };
    dom.make = make;
    dom.document = {
        body, visibilityState: 'visible',
        getElementById: id => body.children.find(el => el.id === id) || null,
        createElement: tag => { const el = make(tag); dom.created.push(el); return el; },
        querySelectorAll: () => [], querySelector: () => null, addEventListener() {}
    };
    return dom;
}

test('막는 창: 뒤 화면을 막고(알림·토스트는 막지 않는다), 읽어 온 저장본이 있을 때만 내려받기를 보이며, 되살리면 이 창이 막은 것만 푼다', async () => {
    const dom = makeDom();
    const [page, alertBox, toast, already] = ['main', 'div', 'div', 'div'].map(tag => dom.body.appendChild(dom.make(tag)));
    alertBox.dataset.appDialog = '';
    toast.dataset.appToast = '';
    already.inert = true;
    const app = makeApp({ db: new Map([['k', { state: 'x' }]]), document: dom.document, realDialog: true });
    assert.strictEqual(await app.ctx.restoreState(), 'failed');
    app.ctx.showStateLoadFailedDialog();
    app.ctx.showStateLoadFailedDialog(); // 두 번 열지 않는다
    const dialogs = dom.body.children.filter(el => el.id === 'state-load-dialog');
    assert.strictEqual(dialogs.length, 1);
    const overlay = dialogs[0];
    assert.deepStrictEqual([overlay.attributes.role, overlay.attributes['aria-modal']], ['alertdialog', 'true']);
    assert.ok(overlay.innerHTML.includes('data-state-load="download"') && overlay.innerHTML.includes('읽지 못한 저장본 내려받기'));
    assert.ok(!overlay.innerHTML.includes('읽지 못한 기록'), "'기록'은 작업 기록에만 쓴다");
    assert.ok(overlay.innerHTML.includes('data-state-load="zip"') && overlay.innerHTML.includes('data-state-load="fresh"') && overlay.innerHTML.includes('data-state-load-file'));
    assert.ok(!overlay.innerHTML.includes('data-state-load="folder"'), '폴더를 지원하지 않는 브라우저에는 폴더 버튼이 없다');
    assert.deepStrictEqual([page.inert, alertBox.inert, toast.inert, already.inert], [true, false, false, true], '뒤 화면만 막는다');
    assert.strictEqual(dom.focused, overlay.querySelector('[data-state-load="reload"]'), '첫 포커스는 다시 읽기');
    // 백업 ZIP 버튼은 창 안의 파일 칸을 연다(머리줄의 칸은 막힌 뒤 화면에 있다). 고르면 백업 ZIP 되살리기로 간다
    const press = action => overlay.listeners.click[0]({ target: { closest: () => ({ dataset: { stateLoad: action } }) }, currentTarget: overlay });
    press('zip');
    const fileInput = overlay.querySelector('[data-state-load-file]');
    assert.strictEqual(fileInput.clicks, 1);
    let picked = null;
    app.ctx.window.importProjectZip = event => { picked = event; };
    fileInput.listeners.change[0]({ target: fileInput });
    assert.strictEqual(picked.target, fileInput);
    // 되살리면 창을 닫고 이 창이 막은 것만 푼다
    app.ctx.markStateLoaded();
    assert.ok(!dom.body.children.includes(overlay));
    assert.deepStrictEqual([page.inert, already.inert], [false, true]);
    // 읽지도 못했으면 내려받기가 없다. 폴더를 지원하면 폴더 버튼이 있다
    const dom2 = makeDom();
    const blind = makeApp({ fail: { get: true }, document: dom2.document, realDialog: true });
    blind.ctx.window.showDirectoryPicker = async () => null;
    await blind.ctx.restoreState();
    blind.ctx.showStateLoadFailedDialog();
    const overlay2 = dom2.body.children.find(el => el.id === 'state-load-dialog');
    assert.ok(!overlay2.innerHTML.includes('읽지 못한 저장본 내려받기') && overlay2.innerHTML.includes('data-state-load="folder"'));
    // 저장을 시도하면(Ctrl+S·자동 저장) 창이 이미 떠 있으면 또 열지 않는다
    assert.strictEqual(await blind.ctx.saveState(), false);
    assert.strictEqual(dom2.body.children.filter(el => el.id === 'state-load-dialog').length, 1);
});

test('읽지 못한 저장본 내려받기: 저장소에 든 그대로 파일로 받는다(큰 저장본도 조각으로). 예전 저장본 글자는 그 글 그대로', async () => {
    const record = { state: 'x', history: [{ id: 1, images: { '(': 'y' } }], note: '원본 "따옴표"' };
    const blobs = [];
    const extra = { Blob: class { constructor(parts, opts) { blobs.push({ parts, opts }); } }, URL: { createObjectURL: () => 'blob:1', revokeObjectURL() {} } };
    const dom = makeDom();
    const app = makeApp({ db: new Map([['k', record]]), document: dom.document, realDialog: true, extra });
    await app.ctx.restoreState();
    await app.ctx.downloadUnreadRecord();
    assert.strictEqual(blobs.length, 1);
    assert.strictEqual(blobs[0].parts.join(''), JSON.stringify(record));
    const link = dom.created.find(el => el.tagName === 'a');
    assert.ok(/^교안_읽지못한저장본_\d{8}-\d{4}\.json$/.test(link.download) && link.clicks === 1, link.download);
    const legacyDom = makeDom();
    const legacy = makeApp({ legacy: '{not json', document: legacyDom.document, realDialog: true, extra });
    await legacy.ctx.restoreState();
    await legacy.ctx.downloadUnreadRecord();
    assert.deepStrictEqual(plain(blobs[1].parts), ['{not json']);
    assert.ok(legacyDom.created.find(el => el.tagName === 'a').download.endsWith('.txt'));
    // 저장소에서 다시 읽지 못하면 처음 읽은 것을 쓴다
    app.ctx.__fail.get = true;
    await app.ctx.downloadUnreadRecord();
    assert.strictEqual(blobs[2].parts.join(''), JSON.stringify(record));
});

/* ---------- 시작 순서 (소스 검사) ---------- */
test('시작: 읽지 못하면 폴더를 다시 잇지 않고 막는 창을 열며, 사용 가이드를 띄우지 않고, Ctrl+S가 저장한다고 하지 않는다', () => {
    const html = fs.readFileSync(path.join(root, '..', 'index.html'), 'utf8');
    assert.ok(/DBManager\.init\(\)\.catch\(/.test(html), '저장소를 열지 못해도 멈추지 않고 읽지 못한 것으로 알린다');
    assert.ok(/const loaded = await restoreState\(\);/.test(html));
    assert.ok(/if \(loaded !== 'failed' && typeof restoreProjectFolderConnection === 'function'\)/.test(html));
    assert.ok(/if \(loaded === 'failed'\) \{\s*showStateLoadFailedDialog\(\);/.test(html));
    assert.ok(/if \(!window\.isStateLoadFailed\?\.\(\)\) startTutorial\(\);/.test(html));
    const ui = fs.readFileSync(path.join(root, 'ui.js'), 'utf8').replace(/\r\n/g, '\n');
    // Ctrl+S는 saveNow로 저장한다. saveNow는 무엇보다 먼저 읽지 못한 상태를 막는다(묶음 8이 원문 칸 넣기를 더했다)
    assert.ok(/if \(isSaveShortcut\(e\)\) \{\n\s*e\.preventDefault\(\);\n\s*if \(!e\.repeat\) saveNow\(\)/.test(ui), 'Ctrl+S는 saveNow로 저장한다');
    assert.ok(/async function saveNow\(\) \{\n\s*if \(window\.isStateLoadFailed\?\.\(\)\) return window\.showStateLoadFailedDialog\?\.\(\);/.test(ui), 'Ctrl+S는 저장하기 전에 막는다');
    assert.strictEqual((ui.match(/overlay\.dataset\.appDialog = '';/g) || []).length, 2, '알림·확인 창은 막는 창 위에서도 누를 수 있다');
});

test("Ctrl+S: 브라우저에 저장했을 때만 '저장했습니다'라고 한다(저장하지 못하면 saveState의 오류 알림 뒤에 저장하지 못했다고 알린다)", async () => {
    const ui = fs.readFileSync(path.join(root, 'ui.js'), 'utf8').replace(/\r\n/g, '\n');
    const slice = (head, tail) => {
        const start = ui.indexOf(head);
        const end = ui.indexOf(tail, start);
        assert.ok(start >= 0 && end > start, `ui.js에서 ${head}을 찾지 못함`);
        return ui.slice(start, end + tail.length);
    };
    const source = [slice('function isSaveShortcut(', '\n}\n'), slice('async function saveNow(', '\n}\n'), slice("document.addEventListener('keydown'", '\n    });')].join('\n');
    const press = async ({ saved, unread = false }) => {
        const seen = { alerts: [], toasts: [], dialogs: 0, saves: 0 };
        const keyCtx = {
            console: { error() {} },
            document: { addEventListener: (type, fn) => { if (type === 'keydown') keyCtx.onKey = fn; }, getElementById: () => null, activeElement: null },
            window: {
                showAlert: text => seen.alerts.push(text), showToast: (text, type) => seen.toasts.push([text, type]),
                isStateLoadFailed: () => unread, showStateLoadFailedDialog: () => { seen.dialogs += 1; }
            },
            saveState: async () => { seen.saves += 1; return saved; }
        };
        vm.createContext(keyCtx);
        vm.runInContext(source, keyCtx);
        keyCtx.onKey({ ctrlKey: true, key: 's', code: 'KeyS', preventDefault() {} });
        await new Promise(resolve => setTimeout(resolve, 0));
        return seen;
    };
    assert.deepStrictEqual(await press({ saved: true }), { alerts: [], toasts: [['저장했습니다.', 'success']], dialogs: 0, saves: 1 });
    const failed = await press({ saved: false });
    assert.deepStrictEqual([failed.saves, failed.alerts.length, failed.toasts.length, failed.toasts[0][1]], [1, 0, 1, 'error'], '저장하지 못했으면 저장했다고 하지 않는다');
    assert.ok(failed.toasts[0][0].startsWith('브라우저에 저장하지 못했습니다'), failed.toasts[0][0]);
    assert.deepStrictEqual(await press({ saved: true, unread: true }), { alerts: [], toasts: [], dialogs: 1, saves: 0 }, '읽지 못한 동안은 저장하지 않고 그 창을 연다');
});

test('ZIP·PC 폴더: 읽지 못한 창에서 되살리기 직전에 저장본을 다시 읽어 이제 열 수 있으면 바꾸지 않고 다시 읽기로 열게 한다(새로 시작과 같은 규칙)', async () => {
    const app = makeApp({ db: new Map([['k', stored()]]), fail: { get: true } });
    assert.strictEqual(await app.ctx.restoreState(), 'failed');
    app.ctx.__fail.get = false; // 이제 읽힌다(잠깐 생긴 문제였거나 다른 창이 저장했다)
    await importZip(app, backupFiles());
    assert.strictEqual(app.get().stateLoadFailed, true, '읽지 못한 창 그대로(다시 읽기로 연다)');
    assert.strictEqual(app.log.writes.length, 0, '저장본도 사본도 쓰지 않는다');
    assert.strictEqual(app.ctx.__db.get('k').state.courseTitle, '내 과정', '지금 열 수 있는 작업을 그 파일로 바꾸지 않는다');
    const zipTold = app.log.alerts.at(-1);
    assert.ok(zipTold.includes('이 파일로 바꾸지 않았습니다(지운 것은 없습니다)') && zipTold.includes("'다시 읽기'를 눌러"), zipTold);
    const entries = { 'save_data.yaml': app.ctx.simpleYamlStringify({ state: { courseTitle: '폴더 과정', subjects: [{ id: 'subject_5', title: '폴더 교과', lessons: [] }] } }) };
    app.ctx.window.showDirectoryPicker = async () => fakeFolder('내 폴더', entries);
    await app.ctx.loadFromProjectFolder();
    assert.strictEqual(app.get().stateLoadFailed, true);
    assert.strictEqual(app.log.writes.length, 0);
    assert.ok(app.log.alerts.at(-1).includes('이 폴더로 바꾸지 않았습니다'), app.log.alerts.at(-1));
    assert.deepStrictEqual(Object.keys(entries), ['save_data.yaml'], '폴더에 사본도 쓰지 않는다');
    assert.strictEqual(app.get().projectFolderHandle, null);
});

// 콘솔에 남긴 것을 모은다(makeApp은 extra를 맨 뒤에 펼친다)
const consoleSpy = () => {
    const log = { warn: [], error: [] };
    return { log, console: { log() {}, info() {}, warn: (...args) => log.warn.push(args), error: (...args) => log.error.push(args) } };
};

test('콘솔 기록: 일부러 멈춘 되살리기(save_data.yaml 없음, 되살릴 교과 없음, ZIP이 아닌 파일, 폴더 권한 거절)는 경고로만, 코드 오류는 오류로 남긴다', async () => {
    const cases = [
        ['save_data.yaml 없음', app => importZip(app, { 'x/안내.md': '# 안내' }), '되살릴 수 있는 백업 파일이 아닙니다'],
        ['되살릴 교과 없음', app => importZip(app, backupFiles({ context: { subjects: 'x' } })), '이 파일에는 되살릴 교과가 없습니다'],
        ['ZIP이 아닌 파일', async app => {
            app.ctx.JSZip = { loadAsync: async () => { throw new Error("Can't find end of central directory : is this a zip file ?"); } };
            await app.ctx.importProjectZip({ target: { files: [{ name: 'b.zip' }], value: 'x' } });
        }, "백업 파일을 되살리지 못했습니다: Can't find end of central directory"],
        ['폴더 권한 거절', async app => {
            app.ctx.window.showDirectoryPicker = async () => { throw Object.assign(new Error('권한을 주지 않았습니다'), { name: 'NotAllowedError' }); };
            await app.ctx.loadFromProjectFolder();
        }, '권한을 주지 않았습니다']
    ];
    for (const [name, act, alert] of cases) {
        const spy = consoleSpy();
        const app = makeApp({ extra: { console: spy.console } });
        app.ctx.__set({ globalState: app.ctx.sanitizeState(mine()) });
        await act(app);
        assert.deepStrictEqual([spy.log.warn.length, spy.log.error.length], [1, 0], name);
        assert.ok(app.log.alerts.at(-1).includes(alert), `${name}: ${app.log.alerts.at(-1)}`);
    }
    const spy = consoleSpy();
    const app = makeApp({ extra: { console: spy.console } });
    app.ctx.__set({ globalState: app.ctx.sanitizeState(mine()) });
    app.ctx.applyBackupMarkdown = () => { throw new TypeError('x is not a function'); };
    await importZip(app, backupFiles());
    assert.deepStrictEqual([spy.log.warn.length, spy.log.error.length], [0, 1], '코드 오류는 오류로');
    assert.ok(spy.log.error[0][1] instanceof Error, '스택이 남게 오류 그대로');
});

test('ZIP: 그림을 따로 담은 백업의 AVIF 그림은 형식 그대로, 예전에 .png로 쓴 AVIF도 원래 글로 되살린다', async () => {
    const app = makeApp();
    app.ctx.__set({ globalState: app.ctx.sanitizeState(mine()) });
    const avif = 'data:image/avif;base64,' + 'AAAAHGZ0eXBhdmlm'.repeat(15);
    const oldAvif = 'data:image/avif;base64,' + 'AAAAHGZ0eXBhdmlmb2xk'.repeat(12);
    const key = app.ctx.backupImageKey(avif);
    const oldKey = app.ctx.backupImageKey(oldAvif);
    const meta = { project: '받은 과정', subject: '교과', imageMode: 'separate', context: { courseTitle: '받은 과정', subjects: [{ id: 'subject_9', title: '교과', lessons: [{ id: 1, title: '차시', images: { a: `teacher-image:${key}`, b: `teacher-image:${oldKey}` } }] }] } };
    const entries = { 'p/save_data.yaml': { text: JSON.stringify(meta) }, [`p/그림/${key}.avif`]: { base64: avif.split(',')[1] }, [`p/그림/${oldKey}.png`]: { base64: oldAvif.split(',')[1] } };
    app.ctx.JSZip = { loadAsync: async () => ({ files: Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, { dir: false, async: async kind => (kind === 'base64' ? value.base64 : value.text) }])) }) };
    await app.ctx.importProjectZip({ target: { files: [{ name: 'b.zip' }], value: 'x' } });
    assert.deepStrictEqual(plain(app.get().globalState.subjects[0].lessons[0].images), { a: avif, b: oldAvif });
});

/* ---------- 아주 큰 작업: JSON 파일(Blob)로 저장하고 그대로 되살린다 ---------- */
// 크롬은 IndexedDB 값 하나를 127MiB까지만 받아(큰 교안 HTML을 불러온 교과) 큰 작업은 JSON 파일로 저장한다(state.js writeBrowserState).
// 512자가 넘는 그림 글(조각 읽기가 떼어 두는 크기)과 한글·이모지·글 속 U+FEFF가 든 작업으로 본다
const bigPicture = 'data:image/jpeg;base64,' + Buffer.from('JPEG-PICTURE-'.repeat(200)).toString('base64');
const bigWork = () => ({
    state: { courseTitle: '큰 과정 😀', subjects: [{ id: 'subject_1', title: '교과', lessons: [{ id: 1, title: '차시', tabContents: { basicLearn: '본문 ![](local:img_1)\uFEFF끝' }, images: { img_1: bigPicture } }] }] },
    history: [{ id: 3, title: '기록', content: '옛 글 ![](local:img_1)', images: { img_1: bigPicture } }]
});
// 조각 읽기(import-stream.js)도 싣는다. 없으면 파일 전체를 글 하나로 읽는다
const withStream = app => {
    vm.runInContext(fs.readFileSync(path.join(root, 'import-stream.js'), 'utf8'), app.ctx, { filename: 'import-stream.js' });
    return app;
};

test('저장 크기 어림: 그림 글은 한 글자 1바이트, 다른 글은 2바이트로 넉넉히 세고 같은 객체는 한 번만 센다(돌아가는 참조에도 멈추지 않는다)', () => {
    const app = makeApp();
    const shared = { a: 'data:x' };
    const loop = { s: 'ab', shared, again: shared };
    loop.self = loop;
    assert.strictEqual(app.ctx.storedSizeEstimate(loop), 48 + 6 + 6 + 4, '키 넷(2바이트 + 4) · 같은 객체 한 번 · 그림 글 1바이트 · 글 2바이트');
    assert.strictEqual(app.ctx.storedSizeEstimate({ n: 5, b: true, u: undefined }), 18 + 27);
});

test('큰 작업: 어림이 크면 JSON 파일(Blob)로 저장하고, 시작할 때 그 파일을 그대로 되살린다(조각 읽기로도, 글 하나로 읽어도)', async () => {
    const app = withStream(makeApp({ extra: { Blob } }));
    const work = bigWork();
    await app.ctx.writeBrowserState(work, { blobMin: 10 });
    const saved = app.ctx.__db.get('k');
    assert.ok(saved instanceof Blob && saved.type === 'application/json', '값이 아니라 JSON 파일');
    assert.deepStrictEqual(JSON.parse(await saved.text()), plain(work));
    await app.ctx.writeBrowserState(work);
    assert.ok(!(app.ctx.__db.get('k') instanceof Blob), '작은 작업은 예전처럼 값 그대로');
    for (const reader of [withStream(makeApp({ db: new Map([['k', saved]]), extra: { Blob } })), makeApp({ db: new Map([['k', saved]]), extra: { Blob } })]) {
        assert.strictEqual(await reader.ctx.restoreState(), 'ok');
        const { globalState, contentHistory, stateLoadFailed } = reader.get();
        const lesson = globalState.subjects[0].lessons[0];
        assert.deepStrictEqual([stateLoadFailed, globalState.courseTitle, lesson.tabContents.basicLearn, lesson.images.img_1, contentHistory[0].images.img_1],
            [false, '큰 과정 😀', '본문 ![](local:img_1)\uFEFF끝', bigPicture, bigPicture]);
        assert.strictEqual(reader.log.writes.length, 0, '열기만 하고 쓰지 않는다');
        assert.strictEqual(await reader.ctx.storedRecordStatus(), 'loads', '읽지 못한 창의 다시 읽어 보기도 JSON 파일을 푼다');
    }
});

test('큰 작업: 브라우저가 값이 너무 크다고 거절하면 같은 작업을 JSON 파일로 다시 저장해 저장했다고 알리고, 그 창에서는 처음부터 JSON 파일로 쓴다(다른 까닭의 실패는 그대로 실패)', async () => {
    // 값(Blob이 아닌 것)을 넣으면 rejectWith로 거절하는 저장소
    const rejecting = rejectWith => {
        const app = withStream(makeApp({ extra: { Blob } }));
        app.ctx.__set({ globalState: app.ctx.sanitizeState(bigWork().state) });
        app.ctx.__reject = { message: rejectWith, tries: 0 };
        vm.runInContext(`(() => {
            const write = DBManager.setItem;
            DBManager.setItem = async (key, value) => {
                if (key === 'k' && !(value instanceof Blob)) {
                    __reject.tries += 1;
                    throw Object.assign(new Error(__reject.message), { name: 'DataError' });
                }
                return write(key, value);
            };
        })();`, app.ctx);
        return app;
    };
    const app = rejecting("Failed to execute 'put' on 'IDBObjectStore': The serialized keys and/or value are too large (size=163040138 bytes, max=133169152 bytes).");
    assert.strictEqual(await app.ctx.saveState(), true);
    const saved = app.ctx.__db.get('k');
    assert.ok(saved instanceof Blob);
    assert.strictEqual(JSON.parse(await saved.text()).state.subjects[0].lessons[0].images.img_1, bigPicture);
    assert.deepStrictEqual(app.log.alerts, [], '알릴 실패가 없다');
    assert.strictEqual(await app.ctx.saveState(), true);
    assert.strictEqual(app.ctx.__reject.tries, 1, '다음 저장은 값으로 바꿔 보지 않고 바로 JSON 파일로 쓴다');
    const quota = rejecting('QuotaExceededError');
    assert.strictEqual(await quota.ctx.saveState(), false, '저장 공간이 모자란 것은 JSON 파일로 바꿔도 소용없다');
    assert.deepStrictEqual([quota.log.alerts.length, quota.ctx.__db.has('k')], [1, false]);
});

test('큰 작업: 풀지 못한 JSON 파일 저장본은 덮어쓰지 않고 막으며, 내려받기는 그 파일을 고치지 않고 그대로 준다', async () => {
    const broken = new Blob(['{"state":{"subjects":['], { type: 'application/json' });
    const dom = makeDom();
    const objects = [];
    const app = withStream(makeApp({ db: new Map([['k', broken]]), document: dom.document, realDialog: true,
        extra: { Blob, URL: { createObjectURL: blob => { objects.push(blob); return 'blob:1'; }, revokeObjectURL() {} } } }));
    assert.strictEqual(await app.ctx.restoreState(), 'failed');
    assert.deepStrictEqual([app.get().stateLoadFailed, app.get().unreadRecord === broken, app.log.writes.length], [true, true, 0]);
    assert.strictEqual(await app.ctx.storedRecordStatus(), 'unread');
    await app.ctx.downloadUnreadRecord();
    assert.strictEqual(objects[0], broken, '저장소에 든 그 파일 그대로');
    assert.ok(dom.created.find(el => el.tagName === 'a').download.endsWith('.json'));
});

(async () => {
    let failed = 0;
    for (const [name, fn] of tests) {
        try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.stack || e.message}`); }
    }
    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    if (failed) process.exit(1);
})();
