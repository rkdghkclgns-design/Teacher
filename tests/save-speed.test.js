// 큰 교안 저장을 바뀐 것만 쓰게 하기(js/state-store.js) 테스트 (실행: node tests/save-speed.test.js)
// 실제 filename-convention.js·data-safety.js·state-store.js·state.js를 vm에서 돌린다. DBManager는 그대로 두고 IndexedDB만 메모리 속 가짜로 둔다.
// 가짜는 기록 단계(transaction)를 흉내 낸다: 단계는 하나씩 돌고, 끝까지 가야 한꺼번에 들어가며, 요청이 실패하거나 abort하면 아무것도 바뀌지 않는다.
// 실패한 요청의 onerror가 preventDefault를 부르면 단계는 끊기지 않고 다음 요청으로 이어 간다(IndexedDB와 같다).
// 같은 가짜 저장소로 새 창을 열어 새로고침·다른 탭을 흉내 낸다. failWhen으로 요청 하나를 실패시키고, dead로 그 뒤 모든 단계를 막아 창이 꺼진 것처럼 한다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', 'js');
const KEY = 'teacher-test';
const IMG = `${KEY}#img:`;
const CHECK = `${KEY}#check`;
const plain = value => JSON.parse(JSON.stringify(value));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ---------- 가짜 IndexedDB ---------- */
const KeyRange = { bound: (lower, upper) => ({ lower, upper }) };
const inRange = (key, range) => !range || (typeof key === 'string' && key >= range.lower && key <= range.upper);

// 여러 창이 함께 쓰는 저장소. data: 들어간 값, log: 끝까지 들어간 쓰기({ op, key, tx })
function makeStore() {
    return { data: new Map(), log: [], failWhen: null, tamper: null, dead: false, names: new Set(), queue: Promise.resolve(), txCount: 0 };
}

function fakeIndexedDB(shared) {
    const db = {
        objectStoreNames: { contains: name => shared.names.has(name) },
        createObjectStore: name => { shared.names.add(name); return {}; },
        transaction: (names, mode = 'readonly') => fakeTransaction(shared, mode)
    };
    return {
        open() {
            const request = {};
            setImmediate(() => {
                if (!shared.names.size) request.onupgradeneeded?.({ target: { result: db } });
                request.onsuccess?.({ target: { result: db } });
            });
            return request;
        }
    };
}

function fakeTransaction(shared, mode) {
    const id = ++shared.txCount;
    const tx = { mode, error: null };
    const requests = [];
    const ops = [];
    let work = null;
    let state = 'waiting'; // waiting → running → done
    let release = () => {};
    const end = (ok, error = null) => {
        if (state === 'done') return;
        state = 'done';
        if (ok && mode === 'readwrite') {
            shared.data = work; // 한꺼번에 들어간다
            ops.forEach(op => shared.log.push({ ...op, tx: id }));
        }
        if (!ok) tx.error = error;
        setImmediate(() => {
            (ok ? tx.oncomplete : tx.onabort)?.({ target: tx });
            release();
        });
    };
    const perform = ({ op, key, value, range }) => {
        if (op === 'put') {
            work.set(key, value);
            ops.push({ op, key });
            return key;
        }
        if (op === 'delete') {
            if (work.has(key)) ops.push({ op, key });
            work.delete(key);
            return undefined;
        }
        if (op === 'get') {
            const found = work.has(key) ? structuredClone(work.get(key)) : undefined;
            return shared.tamper ? shared.tamper(key, found) : found;
        }
        if (op === 'getAllKeys') return [...work.keys()].filter(name => inRange(name, range)).sort();
        throw new Error(`모르는 요청 ${op}`);
    };
    const step = () => setImmediate(() => {
        if (state !== 'running') return;
        if (shared.dead) return end(false, new Error('창이 꺼졌습니다'));
        const next = requests.shift();
        if (!next) return end(true);
        const failure = shared.failWhen?.({ op: next.op, key: next.key, mode });
        if (failure) {
            next.request.error = failure instanceof Error ? failure : new Error('넣어 둔 실패');
            let prevented = false;
            next.request.onerror?.({ target: next.request, preventDefault: () => { prevented = true; } });
            if (!prevented) return end(false, next.request.error);
            return step();
        }
        try {
            next.request.result = perform(next);
            next.request.onsuccess?.({ target: next.request });
        } catch (err) {
            return end(false, err);
        }
        step();
    });
    const add = item => {
        if (state === 'done') throw new Error('TransactionInactiveError');
        if ((item.op === 'put' || item.op === 'delete') && mode !== 'readwrite') throw new Error('ReadOnlyError');
        const request = { result: undefined, error: null };
        requests.push({ ...item, request });
        return request;
    };
    tx.objectStore = () => ({
        put: (value, key) => add({ op: 'put', key, value: structuredClone(value) }),
        get: key => add({ op: 'get', key }),
        delete: key => add({ op: 'delete', key }),
        getAllKeys: range => add({ op: 'getAllKeys', range })
    });
    tx.abort = () => {
        if (state === 'done') throw new Error('InvalidStateError');
        end(false, null);
    };
    // 단계는 하나씩 돈다(앞 단계가 끝나야 다음 단계가 시작한다)
    shared.queue = shared.queue.then(() => new Promise(resolve => {
        release = resolve;
        if (state === 'done') return resolve();
        state = 'running';
        work = mode === 'readwrite' ? new Map(shared.data) : shared.data;
        step();
    }));
    return tx;
}

/* ---------- 앱 ---------- */
// splitFrom: 새 방식으로 쓸 어림 크기(state.js splitSaveMinBytes. 새 방식은 큰 작업에만 쓴다). 시험 자료는 작아서 0으로 낮춰 새 방식을 시험한다. null이면 실제 기준
function makeApp(shared, { splitFrom = 0 } = {}) {
    const log = { alerts: [], toasts: [], dialogs: 0, warns: [], errors: [], files: [] };
    const ctx = {
        console: { log() {}, info() {}, warn: (...args) => log.warns.push(args.join(' ')), error: (...args) => log.errors.push(args.join(' ')) },
        JSON, Date, Map, Set, Promise, Symbol, Uint8Array, TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout, Buffer, Blob,
        crypto: globalThis.crypto, indexedDB: fakeIndexedDB(shared), IDBKeyRange: KeyRange,
        STORAGE_KEY: KEY, INITIAL_MOCK_STATE: { courseTitle: '예시', subjects: [{ id: 'subject_1', title: '예시 교과', lessons: [{ id: 101, title: '1차시' }] }] },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, createElement: () => ({}), visibilityState: 'visible' },
        location: { hash: '#overview' },
        escapeHtml: s => String(s), safeJSONParse: text => { try { return JSON.parse(text); } catch (e) { return null; } },
        renderSidebar() {}, renderOverview() {}, toggleFolderDropdown() {}, viewModule() {}, saveAs() {},
        // 읽지 못한 저장본 내려받기는 기본 저장 폴더(save-folder.js)로 받는다. 받은 파일을 모은다
        saveFileToFolder: async (blob, name) => { log.files.push({ blob, name }); },
        showSaveFailure() {}
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['filename-convention.js', 'data-safety.js', 'state-store.js', 'state.js'].forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file }));
    if (splitFrom !== null) vm.runInContext(`splitSaveMinBytes = ${splitFrom}`, ctx);
    ctx.__log = log;
    vm.runInContext(`
        window.showAlert = text => __log.alerts.push(text);
        window.showToast = text => __log.toasts.push(text);
        showStateLoadFailedDialog = () => { __log.dialogs += 1; };
        this.__get = () => ({ globalState, contentHistory });
        this.__flags = () => ({ stateLoadFailed, unreadRecord });
    `, ctx);
    const run = code => vm.runInContext(code, ctx);
    return { ctx, log, run, work: () => plain(ctx.__get()) };
}

/* ---------- 시험 자료 ---------- */
// 긴 그림(SPLIT_SAVE_MIN 8192자보다 길다). seed마다 다른 그림
const picture = (seed, size = 9000) => 'data:image/png;base64,' + Buffer.from(String(seed).repeat(size)).toString('base64').slice(0, size);
const SMALL = 'data:image/png;base64,iVBORw0KGgo='; // 짧은 그림은 저장본에 그대로 둔다
const BIG = picture('A');
const OTHER = picture('B');
const REF = picture('R', 12000);
const TRASHED = picture('T');
const TOKEN_LIKE = '\u0000img:' + 'f'.repeat(32); // 그림 자리처럼 생긴 보통 글
const REF_LIKE = 'teacher-image:0123456789abcdef01'; // 폴더에서 찾지 못한 그림 자리(그대로 남는다)

// 예전 방식 저장본(작업 전체를 값 하나로). 같은 그림이 두 차시·교수안·작업 기록에 있고, 휴지통·참고 그림에도 그림이 있다
function legacyRecord() {
    return {
        state: {
            courseId: 'course_1', courseTitle: '큰 과정',
            subjects: [{
                id: 'subject_1', title: '교과',
                lessons: [
                    {
                        id: 101, title: '1차시', status: 'done', content: TOKEN_LIKE, uploadedMdContent: '\u0000',
                        images: { img_1: BIG, small: SMALL, lost: REF_LIKE },
                        tabContents: { basicLearn: '\u0000str:보통 글', basicPrac: '실습 ![](local:img_1)', advLearn: null, advPrac: null, assessment: null, advAssessment: null },
                        refImages: [{ url: REF, name: '참고' }],
                        gyosuan: { docMd: '교수안', images: { g1: OTHER } }
                    },
                    { id: 102, title: '2차시', content: '둘째 ![](local:img_2)', images: { img_2: BIG, img_3: OTHER } }
                ]
            }],
            lessonTrash: [{ at: new Date().toISOString(), lesson: { id: 103, title: '지운 차시', images: { t1: TRASHED } } }]
        },
        history: [{ id: 1, title: '1차시', content: '옛 글 ![](local:img_1)', images: { img_1: BIG }, date: '2026. 11. 8.', lessonId: 101, subjectId: 'subject_1' }]
    };
}

const imageKeys = shared => [...shared.data.keys()].filter(key => typeof key === 'string' && key.startsWith(IMG));
const writesSince = (shared, mark) => shared.log.slice(mark).map(({ op, key }) => `${op} ${key.startsWith(IMG) ? 'img' : key}`);

// 예전 저장본을 연 창에서 한 번 저장해 새 방식으로 옮긴 저장소와 그 창
async function migrated() {
    const shared = makeStore();
    shared.data.set(KEY, legacyRecord());
    const app = makeApp(shared);
    assert.strictEqual(await app.ctx.restoreState(), 'ok');
    assert.strictEqual(await app.ctx.saveState(), true);
    assert.strictEqual(shared.data.get(KEY).teacherSplit, 1, '새 방식으로 옮겼다');
    return { shared, app };
}

// 저장본이 새 방식이고 긴 그림 글을 담지 않았는지
function assertSplitRecord(shared) {
    const raw = shared.data.get(KEY);
    assert.strictEqual(raw.teacherSplit, 1, '새 방식 저장본');
    assert.ok(![BIG, OTHER, REF, TRASHED].some(image => JSON.stringify(raw).includes(image.slice(30, 80))), '저장본에는 긴 그림 글이 없다');
}

// 같은 저장소를 새 창으로 열어 읽은 작업
async function reopen(shared) {
    const again = makeApp(shared);
    assert.strictEqual(await again.ctx.restoreState(), 'ok', again.log.errors.join('|'));
    return again;
}

/* ---------- 옮기기 ---------- */
test('예전 저장본(값 하나)을 처음 저장할 때 새 방식으로 옮긴다. 그림은 하나씩 따로 두고, 다시 열면 같은 작업이 열린다', async () => {
    const shared = makeStore();
    shared.data.set(KEY, legacyRecord());
    const app = makeApp(shared);
    assert.strictEqual(await app.ctx.restoreState(), 'ok');
    const before = app.work();
    assert.strictEqual(await app.ctx.saveState(), true);
    const raw = shared.data.get(KEY);
    assert.strictEqual(raw.teacherSplit, 1, '새 방식 저장본');
    assert.strictEqual(raw.state, undefined, '새 방식 저장본에는 state가 없다(이 방식을 모르는 빌드는 읽지 못해 큰 작업에만 쓴다)');
    assert.ok(!JSON.stringify(raw).includes(BIG.slice(30, 80)), '저장본에는 긴 그림 글이 없다');
    assert.strictEqual(imageKeys(shared).length, 4, '같은 그림은 하나만 둔다(BIG·OTHER·REF·TRASHED). 짧은 그림은 저장본에 그대로');
    assert.ok(!shared.data.has(CHECK), '확인용 이름은 다 옮긴 뒤 지운다');
    const again = await reopen(shared);
    assert.deepStrictEqual(again.work(), before);
});

test('예전 저장본(JSON 파일)도 옮기고 다시 열면 같다', async () => {
    const shared = makeStore();
    shared.data.set(KEY, new Blob([JSON.stringify(legacyRecord())], { type: 'application/json' }));
    const app = makeApp(shared);
    assert.strictEqual(await app.ctx.restoreState(), 'ok');
    const before = app.work();
    assert.strictEqual(await app.ctx.saveState(), true);
    assert.strictEqual(shared.data.get(KEY).teacherSplit, 1);
    assert.deepStrictEqual((await reopen(shared)).work(), before);
});

test('옮기기: 확인용 이름에 쓰다 창이 꺼지면 예전 저장본이 그대로 열린다', async () => {
    const shared = makeStore();
    shared.data.set(KEY, legacyRecord());
    const app = makeApp(shared);
    assert.strictEqual(await app.ctx.restoreState(), 'ok');
    const before = app.work();
    app.run("globalState.courseTitle = '저장하지 못한 제목'");
    shared.failWhen = ({ op, key }) => op === 'put' && key.startsWith(IMG) && (shared.dead = true);
    assert.strictEqual(await app.ctx.saveState(), false);
    Object.assign(shared, { dead: false, failWhen: null });
    assert.ok(!shared.data.get(KEY).teacherSplit && !shared.data.has(CHECK) && !imageKeys(shared).length, '아무것도 바뀌지 않았다');
    assert.deepStrictEqual((await reopen(shared)).work(), before);
});

test('옮기기: 확인용으로 다 쓴 뒤 저장본을 바꾸기 전에 창이 꺼지면 예전 저장본이 열리고, 다음 저장이 마저 옮기며 남은 그림을 정리한다', async () => {
    const shared = makeStore();
    shared.data.set(KEY, legacyRecord());
    const app = makeApp(shared);
    assert.strictEqual(await app.ctx.restoreState(), 'ok');
    const before = app.work();
    shared.failWhen = ({ op, key }) => op === 'put' && key === KEY && (shared.dead = true);
    assert.strictEqual(await app.ctx.saveState(), false);
    Object.assign(shared, { dead: false, failWhen: null });
    assert.ok(shared.data.has(CHECK) && imageKeys(shared).length === 4, '확인용으로 쓴 것은 남았다');
    assert.ok(!shared.data.get(KEY).teacherSplit, '예전 저장본은 그대로');
    const again = await reopen(shared);
    assert.deepStrictEqual(again.work(), before);
    assert.strictEqual(await again.ctx.saveState(), true);
    assert.strictEqual(shared.data.get(KEY).teacherSplit, 1);
    assert.ok(!shared.data.has(CHECK), '확인용 이름을 지운다');
    assert.strictEqual(imageKeys(shared).length, 4, '앞에서 남은 그림은 쓰지 않으니 지운다');
    assert.deepStrictEqual((await reopen(shared)).work(), before);
});

test('옮기기: 확인용으로 다시 읽은 값이 다르면 새 방식으로 바꾸지 않고 작업 전체를 예전 방식으로 쓰며, 그 창에서는 새 방식을 끈다', async () => {
    const shared = makeStore();
    shared.data.set(KEY, legacyRecord());
    const app = makeApp(shared);
    assert.strictEqual(await app.ctx.restoreState(), 'ok');
    shared.tamper = (key, value) => (key === CHECK && value ? { ...value, body: { ...value.body, state: { ...value.body.state, courseTitle: '바뀐 값' } } } : value);
    assert.strictEqual(await app.ctx.saveState(), true, '예전 방식으로는 저장했다');
    shared.tamper = null;
    const raw = shared.data.get(KEY);
    assert.ok(shared.log.some(write => write.key === CHECK), '새 방식으로 옮기려고 확인용 이름에 먼저 썼다');
    assert.ok(!raw.teacherSplit && raw.state && raw.state.courseTitle === '큰 과정', '저장본은 예전 방식(작업 전체)');
    const mark = shared.log.length;
    app.run("globalState.courseTitle = '다음 제목'");
    assert.strictEqual(await app.ctx.saveState(), true);
    assert.deepStrictEqual(writesSince(shared, mark), [`put ${KEY}`], '그 창에서는 예전 방식으로만 쓴다');
    assert.strictEqual(shared.data.get(KEY).state.courseTitle, '다음 제목');
});

test('옮기기: 확인용으로 쓴 것을 그사이 다른 탭이 정리했으면(값이 다른 것이 아니다) 이번에는 예전 방식으로 쓰고 새 방식은 끄지 않으며, 확인용으로 넣은 그림은 치운다', async () => {
    const shared = makeStore();
    shared.data.set(KEY, legacyRecord());
    const app = makeApp(shared);
    assert.strictEqual(await app.ctx.restoreState(), 'ok');
    shared.tamper = (key, value) => (key === CHECK ? undefined : value); // 다른 탭이 다 옮기며 확인용 이름을 지웠다
    assert.strictEqual(await app.ctx.saveState(), true);
    shared.tamper = null;
    assert.ok(shared.data.get(KEY).state, '이번에는 예전 방식으로 썼다');
    assert.deepStrictEqual([shared.data.has(CHECK), imageKeys(shared).length], [false, 0], '확인용으로 넣은 것은 치웠다');
    assert.strictEqual(await app.ctx.saveState(), true);
    assertSplitRecord(shared);
    assert.strictEqual(imageKeys(shared).length, 4, '다음 저장은 새 방식으로 옮긴다');
});

test('옮기기: 확인용으로 다시 읽은 값이 달라 새 방식을 끌 때도 확인용으로 넣은 그림과 이름을 치운다(다음 창에서 쌓이지 않게)', async () => {
    const shared = makeStore();
    shared.data.set(KEY, legacyRecord());
    const app = makeApp(shared);
    assert.strictEqual(await app.ctx.restoreState(), 'ok');
    shared.tamper = (key, value) => (key === CHECK && value ? { ...value, body: {} } : value);
    assert.strictEqual(await app.ctx.saveState(), true);
    shared.tamper = null;
    assert.deepStrictEqual([shared.data.has(CHECK), imageKeys(shared).length], [false, 0]);
});

test('옮기기: 확인용으로 쓴 그림을 다시 읽지 못하면 값이 다른 것과 같게 보아 작업 전체를 예전 방식으로 쓰고, 확인용으로 넣은 것을 치우며, 그 창에서는 새 방식을 끈다', async () => {
    const shared = makeStore();
    shared.data.set(KEY, legacyRecord());
    const app = makeApp(shared);
    assert.strictEqual(await app.ctx.restoreState(), 'ok');
    shared.failWhen = ({ op, key }) => (op === 'get' && key.startsWith(IMG) ? new Error('Failed to read large IndexedDB value') : null);
    assert.strictEqual(await app.ctx.saveState(), true, '예전 방식으로는 저장했다');
    shared.failWhen = null;
    const raw = shared.data.get(KEY);
    assert.ok(!raw.teacherSplit && raw.state && raw.state.courseTitle === '큰 과정', '저장본은 예전 방식(작업 전체)');
    assert.deepStrictEqual([shared.data.has(CHECK), imageKeys(shared).length], [false, 0], '확인용으로 넣은 것은 치웠다');
    const mark = shared.log.length;
    app.run("globalState.courseTitle = '다음 제목'");
    assert.strictEqual(await app.ctx.saveState(), true);
    assert.deepStrictEqual(writesSince(shared, mark), [`put ${KEY}`], '그 창에서는 예전 방식으로만 쓴다');
});

/* ---------- 큰 작업에만 ---------- */
test('작은 작업(예전 방식이면 작업 전체를 JSON 파일로 쓸 만큼 크지 않다)은 예전처럼 { state, history }를 값 그대로 쓴다. 그림을 따로 두지 않아 이 방식을 모르는 앞선 빌드도 그대로 읽는다', async () => {
    const shared = makeStore();
    shared.data.set(KEY, legacyRecord());
    const app = makeApp(shared, { splitFrom: null });
    assert.strictEqual(app.run('splitSaveMinBytes'), app.run('STATE_BLOB_MIN_BYTES'), '예전 방식이면 JSON 파일로 쓸 크기부터 새 방식으로 쓴다');
    assert.strictEqual(await app.ctx.restoreState(), 'ok');
    app.run("globalState.courseTitle = '작은 작업'");
    assert.strictEqual(await app.ctx.saveState(), true);
    const raw = shared.data.get(KEY);
    // 앞선 빌드는 저장본의 state만 읽는다(c8b9987보다 앞선 빌드는 state가 없으면 예시 과정으로 덮고, 그 뒤 빌드는 읽지 못한 창으로 막는다)
    assert.ok(!raw.teacherSplit && raw.state && raw.state.courseTitle === '작은 작업' && Array.isArray(raw.history), '예전 모양 그대로');
    assert.ok(JSON.stringify(raw).includes(BIG.slice(30, 80)), '그림도 저장본 안에');
    assert.deepStrictEqual([imageKeys(shared).length, shared.data.has(CHECK)], [0, false], '그림을 따로 두지 않고 확인용 이름도 쓰지 않는다');
    // 처음 쓰는 브라우저의 예시 과정도 같다
    const fresh = makeStore();
    const first = makeApp(fresh, { splitFrom: null });
    assert.strictEqual(await first.ctx.restoreState(), 'empty');
    assert.ok(fresh.data.get(KEY).state && !fresh.data.get(KEY).teacherSplit && !imageKeys(fresh).length, '예시 과정도 예전 모양');
});

test('새 방식으로 쓴 작업이 작아지면 작업 전체를 값 그대로 쓰며 같은 기록 단계에서 이제 쓰지 않는 그림을 지운다(사본이 쓰는 그림은 남긴다). 다시 커지면 확인하고 새 방식으로 쓴다', async () => {
    const { shared, app } = await migrated();
    const trashedKey = imageKeys(shared).find(key => shared.data.get(key) === TRASHED);
    const copyKey = `${KEY}:읽지못함:${Date.now()}`;
    shared.data.set(copyKey, { teacherSplit: 1, body: { state: { lessonTrash: [{ lesson: { images: { t1: '\u0000img:' + trashedKey.slice(IMG.length) } } }] }, history: [] } });
    const mark = shared.log.length;
    app.run('splitSaveMinBytes = storedSizeEstimate({ state: globalState, history: contentHistory }) + 1000'); // 이제 기준보다 작다
    assert.strictEqual(await app.ctx.saveState(), true);
    const raw = shared.data.get(KEY);
    assert.ok(!raw.teacherSplit && raw.state && raw.state.courseTitle === '큰 과정', '작업 전체를 값 그대로');
    assert.deepStrictEqual(imageKeys(shared), [trashedKey], '사본이 쓰는 그림만 남긴다');
    assert.strictEqual(new Set(shared.log.slice(mark).map(write => write.tx)).size, 1, '저장본 쓰기와 그림 지우기는 한 번의 기록 단계');
    assert.deepStrictEqual((await reopen(shared)).work(), app.work());
    // 그 뒤 작은 저장은 예전처럼 저장본 하나만 쓴다
    const next = shared.log.length;
    app.run("globalState.courseTitle = '작은 저장'");
    assert.strictEqual(await app.ctx.saveState(), true);
    assert.deepStrictEqual(writesSince(shared, next), [`put ${KEY}`]);
    // 다시 커지면 확인용 이름에 먼저 쓰고 새 방식으로 바꾼다
    app.run('splitSaveMinBytes = 0');
    assert.strictEqual(await app.ctx.saveState(), true);
    assertSplitRecord(shared);
    assert.ok(shared.log.slice(next).some(write => write.key === CHECK), '확인하고 옮긴다');
    assert.deepStrictEqual((await reopen(shared)).work(), app.work());
});

test('작아진 작업을 쓰며 쓰지 않는 그림을 지우다 실패하면 그림은 지우지 않고 작업 전체를 예전처럼 쓴다', async () => {
    const { shared, app } = await migrated();
    app.run('splitSaveMinBytes = storedSizeEstimate({ state: globalState, history: contentHistory }) + 1000');
    let failed = false;
    shared.failWhen = ({ op, key }) => op === 'delete' && key.startsWith(IMG) && !failed && (failed = true);
    assert.strictEqual(await app.ctx.saveState(), true);
    shared.failWhen = null;
    const raw = shared.data.get(KEY);
    assert.ok(!raw.teacherSplit && raw.state && raw.state.courseTitle === '큰 과정', '작업 전체를 값 그대로');
    assert.strictEqual(imageKeys(shared).length, 4, '그림은 그대로(다음에 새 방식으로 쓸 때 정리한다)');
    assert.deepStrictEqual((await reopen(shared)).work(), app.work());
});

/* ---------- 다시 열기 ---------- */
test('여는 사이 다른 탭이 저장하며 그림을 정리했으면 새 저장본으로 다시 풀어 연다(읽지 못한 창을 띄우지 않는다)', async () => {
    const { shared } = await migrated();
    const tabA = await reopen(shared);
    tabA.run('globalState.lessonTrash = []');
    const opening = makeApp(shared);
    let first = true;
    opening.ctx.__afterRead = async key => {
        if (key !== KEY || !first) return;
        first = false;
        assert.strictEqual(await tabA.ctx.saveState(), true); // 저장본을 읽은 바로 뒤에 다른 탭이 저장한다
    };
    opening.run('(() => { const get = DBManager.getItem; DBManager.getItem = async key => { const value = await get.call(DBManager, key); await __afterRead(key); return value; }; })()');
    assert.strictEqual(await opening.ctx.restoreState(), 'ok', opening.log.errors.join('|'));
    assert.deepStrictEqual(opening.work(), tabA.work());
});

test('여는 사이 다른 탭이 작아진 작업을 저장했으면(작업 전체를 값 그대로 쓰며 그림을 지웠다) 다시 읽은 예전 모양 저장본을 그대로 연다(읽지 못한 창도, 그림 수 글도 없다)', async () => {
    const { shared } = await migrated();
    const tabA = await reopen(shared);
    tabA.run("globalState.courseTitle = 'A가 줄인 작업'; splitSaveMinBytes = storedSizeEstimate({ state: globalState, history: contentHistory }) + 1000"); // A의 작업이 작아졌다
    const opening = makeApp(shared);
    let first = true;
    opening.ctx.__afterRead = async key => {
        if (key !== KEY || !first) return;
        first = false;
        assert.strictEqual(await tabA.ctx.saveState(), true); // 저장본을 읽은 바로 뒤에 다른 탭이 작아진 작업을 저장한다
        const raw = shared.data.get(KEY);
        assert.ok(!raw.teacherSplit && raw.state && Array.isArray(raw.history), '저장본은 예전 모양({ state, history })');
        assert.deepStrictEqual(imageKeys(shared), [], '그림은 지웠다');
    };
    opening.run('(() => { const get = DBManager.getItem; DBManager.getItem = async key => { const value = await get.call(DBManager, key); await __afterRead(key); return value; }; })()');
    assert.strictEqual(await opening.ctx.restoreState(), 'ok', opening.log.errors.join('|'));
    assert.deepStrictEqual(opening.work(), tabA.work());
    assert.strictEqual(opening.work().globalState.courseTitle, 'A가 줄인 작업');
    assert.deepStrictEqual([opening.ctx.__flags().stateLoadFailed, opening.run('unreadMissingImages'), opening.log.dialogs], [false, 0, 0], '읽지 못한 창을 띄우지 않는다');
    assert.ok(!opening.run("stateLoadFailedText({ download: true, missingImages: unreadMissingImages })").includes('찾지 못하거나'), '그림을 찾지 못했다는 글이 없다');
    // 연 탭의 다음 큰 저장은 예전 모양 저장본을 처음 바꾸는 것이라 확인용 이름에 먼저 쓴다
    const mark = shared.log.length;
    assert.strictEqual(await opening.ctx.saveState(), true);
    assert.ok(shared.log.slice(mark).some(write => write.key === CHECK), '확인하고 옮긴다');
    assertSplitRecord(shared);
    assert.deepStrictEqual((await reopen(shared)).work(), opening.work());
});

test('저장본 풀기는 쓴 값을 글자 하나 다르지 않게 돌려준다(\\u0000으로 시작하는 글, 그림 자리처럼 생긴 글, teacher-image 참조, 짧은 그림, 휴지통·참고 그림·교수안 그림)', async () => {
    const { shared, app } = await migrated();
    assertSplitRecord(shared);
    const saved = app.work();
    const data = plain(await app.ctx.storedRecordData(shared.data.get(KEY)));
    assert.deepStrictEqual(data, { state: saved.globalState, history: saved.contentHistory });
    const lesson = data.state.subjects[0].lessons[0];
    assert.deepStrictEqual([lesson.content, lesson.uploadedMdContent, lesson.tabContents.basicLearn, lesson.images.lost, lesson.images.small], [TOKEN_LIKE, '\u0000', '\u0000str:보통 글', REF_LIKE, SMALL]);
    assert.deepStrictEqual([lesson.images.img_1, lesson.refImages[0].url, lesson.gyosuan.images.g1, data.state.lessonTrash[0].lesson.images.t1, data.history[0].images.img_1], [BIG, REF, OTHER, TRASHED, BIG]);
});

test('저장본이 가리키는 그림이 없으면 덮어쓰지 않고 막으며, 읽지 못한 저장본 내려받기는 있는 그림을 제자리에 넣은 예전 모양 JSON으로 준다', async () => {
    const { shared } = await migrated();
    const raw = shared.data.get(KEY);
    const lostKey = imageKeys(shared).find(key => shared.data.get(key) === TRASHED);
    shared.data.delete(lostKey);
    const app = makeApp(shared);
    assert.strictEqual(await app.ctx.restoreState(), 'failed');
    assert.strictEqual(app.ctx.__flags().stateLoadFailed, true);
    assert.strictEqual(await app.ctx.saveState(), false, '읽지 못한 동안은 저장하지 않는다');
    assert.deepStrictEqual(plain(shared.data.get(KEY)), plain(raw), '저장본은 그대로');
    await app.ctx.downloadUnreadRecord();
    assert.strictEqual(app.log.files.length, 1, app.log.alerts.join('|'));
    assert.ok(app.log.files[0].name.endsWith('.json'), app.log.files[0].name);
    const file = JSON.parse(await app.log.files[0].blob.text());
    const lesson = file.state.subjects[0].lessons[0];
    assert.deepStrictEqual([lesson.images.img_1, lesson.gyosuan.images.g1, file.history[0].images.img_1], [BIG, OTHER, BIG], '있는 그림은 제자리에');
    assert.strictEqual(file.state.lessonTrash[0].lesson.images.t1, '\u0000img:' + lostKey.slice(IMG.length), '찾지 못한 그림은 자리 글 그대로');
});

test('그림 하나를 읽지 못해도(크롬의 큰 값 읽기 실패) 나머지 그림은 끝까지 읽는다. 덮어쓰지 않고 막으며, 막는 창 글과 두 내려받기는 담지 못한 그림 수를 알리고 파일에는 읽은 그림을 제자리에 넣는다', async () => {
    const { shared } = await migrated();
    const broken = imageKeys(shared).find(key => shared.data.get(key) === TRASHED);
    shared.failWhen = ({ op, key }) => (op === 'get' && key === broken ? new Error('Failed to read large IndexedDB value') : null);
    const app = makeApp(shared);
    assert.strictEqual(await app.ctx.restoreState(), 'failed', '그림 없이 열어 덮어쓰지 않는다');
    const text = app.run('stateLoadFailedText({ folder: false, download: true, missingImages: unreadMissingImages })');
    assert.ok(text.includes('그림 1장'), text);
    await app.ctx.downloadUnreadRecord();
    assert.strictEqual(app.log.files.length, 1, app.log.alerts.join('|'));
    const file = JSON.parse(await app.log.files[0].blob.text());
    const lesson = file.state.subjects[0].lessons[0];
    assert.deepStrictEqual([lesson.images.img_1, lesson.refImages[0].url, lesson.gyosuan.images.g1, file.history[0].images.img_1], [BIG, REF, OTHER, BIG], '읽은 그림은 제자리에');
    assert.strictEqual(file.state.lessonTrash[0].lesson.images.t1, '\u0000img:' + broken.slice(IMG.length), '읽지 못한 그림만 자리 글');
    assert.deepStrictEqual(app.log.toasts, [], '다 담았다고 하지 않는다');
    assert.strictEqual(app.log.alerts.filter(alert => alert.includes('그림 1장')).length, 1, app.log.alerts.join('|'));
    // 따로 옮겨 둔 사본을 받을 때도 같다
    const copyKey = `${KEY}:읽지못함:${Date.now()}`;
    shared.data.set(copyKey, structuredClone(shared.data.get(KEY)));
    await app.ctx.downloadUnreadCopy(copyKey);
    assert.strictEqual(app.log.files.length, 2, app.log.alerts.join('|'));
    const copy = JSON.parse(await app.log.files[1].blob.text());
    assert.deepStrictEqual([copy.state.subjects[0].lessons[0].refImages[0].url, copy.state.lessonTrash[0].lesson.images.t1], [REF, '\u0000img:' + broken.slice(IMG.length)]);
    assert.deepStrictEqual(app.log.toasts, []);
    assert.strictEqual(app.log.alerts.filter(alert => alert.includes('그림 1장')).length, 2, app.log.alerts.join('|'));
});

/* ---------- 바뀐 것만 쓰기 ---------- */
test('글만 바꾸면 그림은 다시 쓰지 않고 저장본 하나만 쓴다', async () => {
    const { shared, app } = await migrated();
    const mark = shared.log.length;
    app.run("globalState.subjects[0].lessons[0].tabContents.basicPrac = '바뀐 실습 ![](local:img_1)'");
    assert.strictEqual(await app.ctx.saveState(), true);
    assert.deepStrictEqual(writesSince(shared, mark), [`put ${KEY}`]);
    assertSplitRecord(shared);
    assert.strictEqual((await reopen(shared)).work().globalState.subjects[0].lessons[0].tabContents.basicPrac, '바뀐 실습 ![](local:img_1)');
});

test('다시 연 창도 글만 바꾸면 그림을 다시 쓰지 않는다(읽은 그림을 기억한다)', async () => {
    const { shared } = await migrated();
    const again = await reopen(shared);
    const mark = shared.log.length;
    again.run("globalState.courseTitle = '새 제목'");
    assert.strictEqual(await again.ctx.saveState(), true);
    assert.deepStrictEqual(writesSince(shared, mark), [`put ${KEY}`]);
    assertSplitRecord(shared);
});

test('그림 하나를 바꾸면 그 그림만 쓰고, 어디에서도 쓰지 않게 된 그림은 같은 기록 단계에서 지운다', async () => {
    const { shared, app } = await migrated();
    const mark = shared.log.length;
    const fresh = picture('S', 12000);
    app.run(`globalState.subjects[0].lessons[0].refImages[0].url = ${JSON.stringify(fresh)}`);
    assert.strictEqual(await app.ctx.saveState(), true);
    const writes = shared.log.slice(mark);
    assert.deepStrictEqual(writes.map(({ op, key }) => `${op} ${key.startsWith(IMG) ? 'img' : key}`).sort(), ['delete img', `put ${KEY}`, 'put img'].sort());
    assert.strictEqual(new Set(writes.map(write => write.tx)).size, 1, '한 번의 기록 단계');
    assert.ok(!imageKeys(shared).some(key => shared.data.get(key) === REF), '바꾸기 전 그림은 지웠다');
    assert.strictEqual((await reopen(shared)).work().globalState.subjects[0].lessons[0].refImages[0].url, fresh);
});

test('같은 그림을 여러 곳에서 쓰면 한 곳에서 빼도 지우지 않는다', async () => {
    const { shared, app } = await migrated();
    app.run('delete globalState.subjects[0].lessons[1].images.img_2');
    assert.strictEqual(await app.ctx.saveState(), true);
    assert.ok(imageKeys(shared).some(key => shared.data.get(key) === BIG), '1차시와 작업 기록이 아직 쓴다');
});

test('겹쳐 부른 저장도 차례대로 쓰고 마지막 저장이 남는다. 부른 즉시 저장 중으로 센다', async () => {
    const { shared, app } = await migrated();
    const saves = [];
    ['하나', '둘', '셋'].forEach(title => {
        app.run(`globalState.courseTitle = '${title}'`);
        saves.push(app.ctx.saveState());
        assert.strictEqual(app.run('isSavePending()'), true);
    });
    assert.deepStrictEqual(await Promise.all(saves), [true, true, true]);
    assert.strictEqual(app.run('DBManager.writing'), 0);
    assert.strictEqual(app.run('isSavePending()'), false);
    assert.strictEqual((await reopen(shared)).work().globalState.courseTitle, '셋');
});

/* ---------- 끊긴 저장 ---------- */
[['그림 넣기', ({ op, key }) => op === 'put' && key.startsWith(IMG)],
    ['저장본 쓰기', ({ op, key }) => op === 'put' && key === KEY],
    ['쓰지 않는 그림 지우기', ({ op, key }) => op === 'delete' && key.startsWith(IMG)]
].forEach(([stepName, match]) => {
    test(`저장하다 '${stepName}'에서 창이 꺼지면 아무것도 바뀌지 않아 앞 저장본이 그대로 열린다`, async () => {
        const { shared, app } = await migrated();
        const before = app.work();
        const stored = plain([...shared.data.entries()].filter(([key]) => !String(key).startsWith('projectFolder')));
        app.run(`globalState.courseTitle = '끊긴 저장'; globalState.subjects[0].lessons[0].refImages[0].url = ${JSON.stringify(picture('X', 12000))}`);
        shared.failWhen = request => match(request) && (shared.dead = true);
        assert.strictEqual(await app.ctx.saveState(), false);
        Object.assign(shared, { dead: false, failWhen: null });
        assert.deepStrictEqual(plain([...shared.data.entries()].filter(([key]) => !String(key).startsWith('projectFolder'))), stored, '저장소는 그대로');
        assert.deepStrictEqual((await reopen(shared)).work(), before);
    });
});

test('새 방식 저장이 실패하면(창은 그대로) 작업 전체를 예전 방식으로 다시 써서 저장은 된다', async () => {
    const { shared, app } = await migrated();
    app.run("globalState.courseTitle = '다시 쓴 저장'");
    let failed = false;
    shared.failWhen = ({ op, key }) => op === 'put' && key === KEY && !failed && (failed = true);
    assert.strictEqual(await app.ctx.saveState(), true);
    shared.failWhen = null;
    const raw = shared.data.get(KEY);
    assert.ok(!raw.teacherSplit && raw.state.courseTitle === '다시 쓴 저장', '예전 방식으로 썼다');
    assert.deepStrictEqual((await reopen(shared)).work(), app.work());
    assert.strictEqual(await app.ctx.saveState(), true, '다음 저장은 다시 새 방식(확인하고)');
    assert.strictEqual(shared.data.get(KEY).teacherSplit, 1);
});

/* ---------- 지우기는 안전할 때만 ---------- */
test('따로 옮겨 둔 사본(새 방식)이 쓰는 그림은 지우지 않고, 사본이 없어진 뒤에 지운다. 예전 방식 사본은 그림을 안에 담아 막지 않는다', async () => {
    const { shared, app } = await migrated();
    const copyKey = `${KEY}:읽지못함:${Date.now()}`;
    const oldCopyKey = `${KEY}:읽지못함:1`;
    const oldCopy = legacyRecord();
    shared.data.set(copyKey, structuredClone(shared.data.get(KEY)));
    shared.data.set(oldCopyKey, structuredClone(oldCopy));
    app.run('globalState.lessonTrash = []');
    assert.strictEqual(await app.ctx.saveState(), true);
    assert.ok(imageKeys(shared).some(key => shared.data.get(key) === TRASHED), '사본이 쓰는 그림은 남긴다');
    shared.data.delete(copyKey);
    assert.strictEqual(await app.ctx.saveState(), true);
    assert.ok(!imageKeys(shared).some(key => shared.data.get(key) === TRASHED), '사본이 없어지면 지운다(예전 방식 사본은 그림을 안에 담고 있어 막지 않는다)');
    assert.deepStrictEqual(plain(shared.data.get(oldCopyKey)), plain(oldCopy), '예전 방식 사본은 건드리지 않는다');
});

test('다른 탭이 지운 그림도 이 탭이 아직 쓰면 다음 저장이 다시 넣는다', async () => {
    const { shared } = await migrated();
    const tabA = await reopen(shared);
    const tabB = await reopen(shared);
    tabA.run('globalState.lessonTrash = []');
    assert.strictEqual(await tabA.ctx.saveState(), true);
    assert.ok(!imageKeys(shared).some(key => shared.data.get(key) === TRASHED), 'A가 지웠다');
    assert.strictEqual(await tabB.ctx.saveState(), true);
    const opened = await reopen(shared);
    assert.deepStrictEqual(opened.work(), tabB.work());
    assert.strictEqual(opened.work().globalState.lessonTrash[0].lesson.images.t1, TRASHED);
});

test('처음 옮기는 저장의 확인 단계는 그림을 지우지 않는다(다른 탭이 이미 옮긴 저장본의 그림을 지키게)', async () => {
    const shared = makeStore();
    shared.data.set(KEY, legacyRecord());
    const late = makeApp(shared);
    assert.strictEqual(await late.ctx.restoreState(), 'ok');
    const first = makeApp(shared);
    assert.strictEqual(await first.ctx.restoreState(), 'ok');
    assert.strictEqual(await first.ctx.saveState(), true);
    assertSplitRecord(shared);
    const theirs = first.work();
    late.run('globalState.lessonTrash = []; globalState.courseTitle = "늦은 탭"');
    shared.failWhen = ({ op, key }) => op === 'put' && key === KEY && (shared.dead = true); // 확인용 이름에만 쓰고 꺼진다
    assert.strictEqual(await late.ctx.saveState(), false);
    Object.assign(shared, { dead: false, failWhen: null });
    assert.deepStrictEqual((await reopen(shared)).work(), theirs, '먼저 옮긴 탭의 저장본과 그림이 그대로');
});

(async () => {
    let failed = 0;
    for (const [name, fn] of tests) {
        try {
            await fn();
            console.log(`✓ ${name}`);
        } catch (err) {
            failed += 1;
            console.log(`✗ ${name}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n  ') : err}`);
        }
    }
    console.log(failed ? `\n${failed}개 실패 / ${tests.length}개` : `\n모두 통과 (${tests.length}개)`);
    process.exit(failed ? 1 : 0);
})();
