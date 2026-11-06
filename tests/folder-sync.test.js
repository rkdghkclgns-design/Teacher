// PC 폴더 열기·저장 테스트 (실행: node tests/folder-sync.test.js)
// 실제 filename-convention.js·data-safety.js·state.js를 vm에서 돌리고, 폴더는 메모리 속 가짜 FileSystemDirectoryHandle로 둔다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const PNG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(20);
const PNG2 = 'data:image/png;base64,' + 'iVBORw0KGgoAAAAN'.repeat(20);
const JPG = 'data:image/jpeg;base64,' + '/9j/4AAQSkZJRg'.repeat(20);
const plain = value => JSON.parse(JSON.stringify(value));
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const imageBytes = dataUrl => new Uint8Array(Buffer.from(dataUrl.split(',')[1], 'base64'));

/* ---------- 가짜 폴더 ---------- */
// shared.log: 닫으며 쓴 파일 경로(쓴 순서), shared.reads: 내용·크기를 읽은 파일 경로, active/maxActive: 동시에 열린 쓰기 수
const makeShared = () => ({ log: [], reads: [], active: 0, maxActive: 0, clock: 1 });
const fsError = name => Object.assign(new Error(name), { name });
// 브라우저(File System Access)처럼 비었거나 '.'·'..'이거나 경로 글자('/', '\')가 든 이름은 TypeError
const checkName = child => {
    if (typeof child !== 'string' || !child || child === '.' || child === '..' || /[\/\\]/.test(child)) throw new TypeError(`바르지 않은 이름: ${child}`);
};

function fakeDir(name, shared = makeShared(), prefix = '') {
    const entries = new Map(); // 이름 → { kind: 'directory', dir } | { kind: 'file', data, fail, modified }
    const dir = {
        kind: 'directory', name, entries, shared, gate: null, permission: 'granted', requests: 0, grantOnRequest: false,
        async queryPermission() { return dir.permission; },
        async requestPermission() {
            dir.requests += 1;
            if (dir.grantOnRequest) dir.permission = 'granted';
            return dir.permission;
        },
        async getDirectoryHandle(child, opts = {}) {
            checkName(child);
            let entry = entries.get(child);
            if (!entry) {
                if (!opts.create) throw fsError('NotFoundError');
                entry = { kind: 'directory', dir: fakeDir(child, shared, `${prefix}${child}/`) };
                entries.set(child, entry);
            }
            if (entry.kind !== 'directory') throw fsError('TypeMismatchError');
            return entry.dir;
        },
        async getFileHandle(child, opts = {}) {
            checkName(child);
            let entry = entries.get(child);
            if (!entry) {
                if (!opts.create) throw fsError('NotFoundError');
                entry = { kind: 'file', data: new Uint8Array(0), modified: 0 };
                entries.set(child, entry);
            }
            if (entry.kind !== 'file') throw fsError('TypeMismatchError');
            const full = prefix + child;
            return {
                kind: 'file', name: child,
                async getFile() {
                    shared.reads.push(full);
                    if (entry.fail) throw fsError('NotReadableError');
                    const data = entry.data;
                    return {
                        size: data.length, lastModified: entry.modified,
                        async text() { return Buffer.from(data).toString('utf8'); },
                        async arrayBuffer() { return data.buffer.slice(data.byteOffset, data.byteOffset + data.length); }
                    };
                },
                async createWritable() {
                    shared.active += 1;
                    shared.maxActive = Math.max(shared.maxActive, shared.active);
                    let next = null;
                    return {
                        async write(content) { next = typeof content === 'string' ? new Uint8Array(Buffer.from(content, 'utf8')) : content; },
                        async close() {
                            try {
                                if (dir.gate) await dir.gate;
                                entry.data = next || new Uint8Array(0);
                                entry.modified = shared.clock++;
                                shared.log.push(full);
                            } finally {
                                shared.active -= 1;
                            }
                        },
                        async abort() { shared.active -= 1; }
                    };
                }
            };
        },
        async *keys() { for (const key of entries.keys()) yield key; }
    };
    return dir;
}

// 손으로(다른 PC가 쓴 것처럼) 파일을 넣는다. log에는 남기지 않는다
async function putFile(dir, filePath, content, { fail = false } = {}) {
    const parts = filePath.split('/');
    let target = dir;
    for (const part of parts.slice(0, -1)) target = await target.getDirectoryHandle(part, { create: true });
    const data = typeof content === 'string' ? new Uint8Array(Buffer.from(content, 'utf8')) : content;
    target.entries.set(parts[parts.length - 1], { kind: 'file', data, fail, modified: dir.shared.clock++ });
}

async function readText(dir, filePath, encoding = 'utf8') {
    const parts = filePath.split('/');
    let target = dir;
    for (const part of parts.slice(0, -1)) target = await target.getDirectoryHandle(part);
    const entry = target.entries.get(parts[parts.length - 1]);
    return entry ? Buffer.from(entry.data).toString(encoding) : null;
}

/* ---------- 앱 ---------- */
function makeApp({ mode = 'inline' } = {}) {
    const element = () => {
        const classes = [];
        return { innerHTML: '', textContent: '', onclick: null, classes, classList: { add: c => classes.push(`+${c}`), remove: c => classes.push(`-${c}`), toggle() {}, contains: () => false } };
    };
    const elements = Object.fromEntries(['folder-connection-indicator', 'folder-sync-banner', 'folder-sync-banner-text', 'folder-sync-banner-action'].map(id => [id, element()]));
    const store = new Map([['teacher:backup-images', mode]]);
    const listeners = {};
    const ctx = {
        console: { log() {}, info() {}, warn() {}, error() {} },
        JSON, Date, Map, Set, Promise, Symbol, Uint8Array, atob, btoa, setTimeout, clearTimeout,
        STORAGE_KEY: 'test-state', INITIAL_MOCK_STATE: { subjects: [] },
        localStorage: { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
        document: { getElementById: id => elements[id] || null, querySelectorAll: () => [], addEventListener: (type, fn) => { listeners[type] = fn; }, visibilityState: 'visible' },
        addEventListener: (type, fn) => { listeners[`window:${type}`] = fn; },
        location: { hash: '' },
        escapeHtml: text => String(text),
        toggleFolderDropdown() {}, renderSidebar() {},
        elements, store, listeners, toasts: [], alerts: [], confirms: [], confirmAnswer: true
    };
    ctx.window = ctx;
    ctx.showToast = message => ctx.toasts.push(message);
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showConfirm = (message, onOk, opts = {}) => {
        ctx.confirms.push({ message, opts });
        if (ctx.confirmAnswer) onOk();
        else opts.onCancel?.();
    };
    vm.createContext(ctx);
    ['filename-convention.js', 'data-safety.js', 'state.js'].forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), ctx, { filename: file }));
    const exec = code => vm.runInContext(code, ctx);
    exec('window.realDBManager = { ...DBManager }; DBManager.setItem = async () => {}; DBManager.getItem = async () => null; DBManager.deleteItem = async () => {}; downloadSafetyBackup = async () => {};');
    return { ctx, exec };
}

// 폴더 저장본에 손으로 넣는 교과(차시 없음)
const FOLDER_SUBJECTS = [{ id: 's9', title: '폴더 교과', lessons: [] }];

// 교과 하나, 차시 하나(그림 두 장을 쓰는 글)
function seed(exec, { title = '과정', images = { img_1: PNG, img_2: JPG } } = {}) {
    const state = { courseTitle: title, subjects: [{ id: 's1', title: '교과', lessons: [{ id: 1, title: '차시', content: '글 <img src="local:img_1"> <img src="local:img_2">', images }] }] };
    exec(`globalState = sanitizeState(${JSON.stringify(state)}); currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons; contentHistory = [];`);
}

async function connect(ctx, dir) {
    ctx.showDirectoryPicker = async () => dir;
    await ctx.connectProjectFolder();
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

/* ---------- 저장 ---------- */
test('F1 따로 담기 첫 저장: 그림 파일을 먼저 쓰고 save_data.yaml을 쓰고, 이 브라우저의 이름표를 남긴다', async () => {
    const { ctx, exec } = makeApp({ mode: 'separate' });
    seed(exec);
    const dir = fakeDir('A');
    await connect(ctx, dir);
    const log = dir.shared.log;
    const yamlAt = log.indexOf('save_data.yaml');
    assert.ok(yamlAt === 2 && log.slice(0, 2).every(p => p.startsWith('그림/')), log.join(','));
    const yaml = await readText(dir, 'save_data.yaml');
    assert.ok(yaml.includes('teacher-image:') && yaml.includes('imageMode: "separate"'));
    const stamp = JSON.parse(ctx.store.get('teacher:folder-save-stamp'));
    assert.deepStrictEqual([stamp.name, stamp.size], ['A', Buffer.byteLength(yaml)]);
    assert.ok(ctx.toasts.some(t => t.includes('[A] 폴더가 연동되었습니다')));
});

test('F2 다음 저장은 바뀐 것만 쓴다(그림 크기도 다시 보지 않는다)', async () => {
    const { ctx, exec } = makeApp({ mode: 'separate' });
    seed(exec);
    const dir = fakeDir('A');
    await connect(ctx, dir);
    dir.shared.log.length = 0;
    dir.shared.reads.length = 0;
    await exec('saveState()');
    await exec('waitFolderSync()');
    assert.deepStrictEqual(dir.shared.log, ['save_data.yaml']);
    assert.ok(!dir.shared.reads.some(p => p.startsWith('그림/')), dir.shared.reads.join(','));
    dir.shared.log.length = 0;
    exec(`courseData[0].images.img_3 = ${JSON.stringify(PNG2)}; courseData[0].content += ' <img src="local:img_3">';`);
    await exec('saveState()');
    await exec('waitFolderSync()');
    const log = dir.shared.log;
    assert.strictEqual(log.filter(p => p.startsWith('그림/')).length, 1, '새 그림 파일 하나');
    assert.ok(log.includes('save_data.yaml') && log.includes('과정/첨부파일/img_3.png'), log.join(','));
    assert.ok(!log.includes('과정/첨부파일/img_1.png') && !log.includes('과정/첨부파일/img_2.jpg'), '이미 쓴 첨부 그림은 다시 쓰지 않는다');
    assert.strictEqual(log.filter(p => p.endsWith('.md')).length, 1, '바뀐 차시 MD 하나');
});

test('F3 겹친 저장은 줄을 서고 하나로 합친다', async () => {
    const { ctx, exec } = makeApp();
    seed(exec);
    const dir = fakeDir('A');
    await connect(ctx, dir);
    dir.shared.log.length = 0;
    dir.shared.maxActive = 0;
    let open;
    dir.gate = new Promise(resolve => { open = resolve; });
    const first = exec('syncToLinkedFolder()');
    await tick();
    for (let i = 1; i <= 4; i++) {
        exec(`globalState.courseTitle = '과정${i}'`);
        exec('syncToLinkedFolder()');
    }
    open();
    dir.gate = null;
    assert.strictEqual(await first, true);
    await exec('waitFolderSync()');
    assert.strictEqual(dir.shared.log.filter(p => p === 'save_data.yaml').length, 2, '도는 저장 하나 + 합친 저장 하나');
    assert.strictEqual(dir.shared.maxActive, 1, '한 번에 하나만 쓴다');
    assert.ok((await readText(dir, 'save_data.yaml')).includes('과정4'), '마지막 상태가 남는다');
});

test('F4 저장 중에 폴더와 상태가 바뀌어도 섞어 쓰지 않는다', async () => {
    const { ctx, exec } = makeApp();
    seed(exec, { title: '첫과정' });
    const a = fakeDir('A');
    await connect(ctx, a);
    a.shared.log.length = 0;
    let open;
    a.gate = new Promise(resolve => { open = resolve; });
    const first = exec('syncToLinkedFolder()');
    await tick();
    ctx.folderB = fakeDir('B');
    exec(`globalState = sanitizeState(${JSON.stringify({ courseTitle: '둘째과정', subjects: [] })}); useLinkedFolder(window.folderB);`);
    const second = exec('syncToLinkedFolder()');
    open();
    a.gate = null;
    await first;
    await second;
    const yamlA = await readText(a, 'save_data.yaml');
    assert.ok(yamlA.includes('첫과정') && !yamlA.includes('둘째과정'), '옛 폴더에는 옛 상태만');
    assert.ok((await readText(ctx.folderB, 'save_data.yaml')).includes('둘째과정'));
    assert.strictEqual(a.shared.log.filter(p => p === 'save_data.yaml').length, 1);
});

/* ---------- 권한·다시 연결 ---------- */
async function lockedApp() {
    const app = makeApp();
    seed(app.exec);
    const dir = fakeDir('A');
    await connect(app.ctx, dir);
    dir.shared.log.length = 0;
    dir.permission = 'prompt';
    const result = await app.exec('syncToLinkedFolder()');
    return { ...app, dir, result };
}

test('F5 권한이 풀리면 권한 창 없이 멈추고 다시 연결을 기다린다', async () => {
    const { ctx, exec, dir, result } = await lockedApp();
    assert.strictEqual(result, false);
    assert.strictEqual(dir.requests, 0, '저장 중에는 권한 창을 띄우지 않는다');
    assert.deepStrictEqual(dir.shared.log, []);
    assert.strictEqual(exec('projectFolderHandle'), null);
    assert.ok(ctx.elements['folder-sync-banner-text'].textContent.includes('권한이 풀려'));
    assert.strictEqual(ctx.elements['folder-sync-banner-action'].textContent, '다시 연결');
    assert.ok(ctx.elements['folder-connection-indicator'].innerHTML.includes('눌러서 다시 연결'));
});

test('F6 다시 연결하면 권한을 받고 바로 저장한다. 거절하면 띠를 다시 보인다', async () => {
    const { ctx, exec, dir } = await lockedApp();
    const banner = ctx.elements['folder-sync-banner'];
    banner.classes.length = 0;
    ctx.elements['folder-sync-banner-action'].onclick(); // 띠의 '다시 연결'(거절)
    await tick(5);
    assert.strictEqual(dir.requests, 1);
    assert.strictEqual(exec('projectFolderHandle'), null);
    assert.strictEqual(banner.classes[banner.classes.length - 1], '-hidden', '띠가 다시 보인다');
    dir.grantOnRequest = true;
    ctx.elements['folder-connection-indicator'].onclick(); // 머리줄의 '(눌러서 다시 연결)'(허락)
    await tick(5);
    await exec('waitFolderSync()');
    assert.strictEqual(dir.requests, 2);
    assert.ok(dir.shared.log.includes('save_data.yaml'), '다시 연결하면 바로 저장한다');
    assert.strictEqual(exec('projectFolderHandle'), dir);
    assert.ok(ctx.toasts.some(t => t.includes('[A] 폴더에 다시 저장했습니다')));
});

test('F7 다시 연결: 이 브라우저가 쓴 뒤 다른 곳에서 바뀐 저장본이면 먼저 묻고, 덮으면 사본을 남긴다', async () => {
    const { ctx, exec, dir } = await lockedApp();
    await putFile(dir, 'save_data.yaml', 'state:\n  courseTitle: "다른 PC"\n'); // 다른 PC가 씀
    dir.grantOnRequest = true;
    ctx.confirmAnswer = false;
    await ctx.regrantLinkedFolder(dir, exec('FOLDER_LOCKED_MESSAGE'));
    const ask = ctx.confirms[ctx.confirms.length - 1];
    assert.strictEqual(ask.opts.title, '폴더 저장본이 바뀌었습니다');
    assert.ok(ask.message.includes("이 브라우저가 마지막으로 저장한 뒤 'A' 폴더의 저장본이 바뀌었습니다"), ask.message);
    assert.deepStrictEqual(dir.shared.log, [], '취소하면 아무것도 쓰지 않는다');
    assert.strictEqual(exec('projectFolderHandle'), null, '멈춘 채로 둔다');
    assert.ok(ctx.elements['folder-sync-banner-text'].textContent.includes('저장본이 바뀌었거나'), '띠는 멈춘 까닭(저장본이 바뀜)을 말한다');
    ctx.confirmAnswer = true;
    await ctx.regrantLinkedFolder(dir, exec('FOLDER_LOCKED_MESSAGE'));
    await exec('waitFolderSync()');
    const log = dir.shared.log;
    const copy = log.find(p => p.startsWith('save_data_이전_'));
    assert.ok(copy && log.indexOf(copy) < log.indexOf('save_data.yaml'), log.join(','));
    assert.ok((await readText(dir, copy)).includes('다른 PC'), '다른 곳의 저장본이 사본으로 남는다');
    assert.ok(!(await readText(dir, 'save_data.yaml')).includes('다른 PC'));
});

test('F8 새로고침: 권한이 있어도 다른 곳에서 바뀐 저장본이면 멈추고, 그대로면 바로 잇는다', async () => {
    const { ctx, exec } = makeApp();
    seed(exec);
    const dir = fakeDir('A');
    await connect(ctx, dir);
    ctx.storedHandle = dir;
    exec('DBManager.getItem = async () => window.storedHandle; projectFolderHandle = null;');
    await ctx.restoreProjectFolderConnection();
    assert.strictEqual(exec('projectFolderHandle'), dir, '그대로면 바로 잇는다');
    exec('projectFolderHandle = null;');
    await putFile(dir, 'save_data.yaml', 'state:\n  courseTitle: "다른 PC"\n');
    await ctx.restoreProjectFolderConnection();
    assert.strictEqual(exec('projectFolderHandle'), null);
    assert.ok(ctx.elements['folder-sync-banner-text'].textContent.includes('저장본이 바뀌었거나'));
    dir.permission = 'prompt';
    await ctx.restoreProjectFolderConnection();
    assert.ok(ctx.elements['folder-sync-banner-text'].textContent.includes('브라우저를 다시 열어'));
});

test('F9 저장 중에 자동 저장을 끄면, 그 저장이 실패해도 실패 띠를 띄우지 않는다', async () => {
    const { ctx, exec } = makeApp();
    seed(exec);
    const dir = fakeDir('A');
    await connect(ctx, dir);
    let fail;
    dir.gate = new Promise((resolve, reject) => { fail = reject; });
    dir.gate.catch(() => {});
    const pending = exec('syncToLinkedFolder()');
    await tick();
    await ctx.disconnectProjectFolder();
    fail(fsError('InvalidStateError'));
    dir.gate = null;
    assert.strictEqual(await pending, false);
    assert.strictEqual(exec('folderSyncFailed'), false);
    assert.ok(!ctx.elements['folder-connection-indicator'].innerHTML.includes('저장 실패'));
});

/* ---------- 폴더 열기 ---------- */
test('F10 그림 읽기: 저장본이 가리키는 그림만 파일마다 따로 읽고, 찾지 못한 그림은 참조로 둔다', async () => {
    const { ctx } = makeApp();
    const key = dataUrl => ctx.window.backupImageKey(dataUrl);
    const dir = fakeDir('B');
    await putFile(dir, `그림/${key(PNG)}.png`, imageBytes(PNG));
    await putFile(dir, `그림/${key(JPG)}.jpg`, imageBytes(JPG), { fail: true });
    await putFile(dir, `그림/${key(PNG2)}.png`, new Uint8Array(0)); // 복사가 끊긴 빈 파일
    for (let i = 0; i < 5; i++) await putFile(dir, `그림/${'c'.repeat(17)}${i}.png`, imageBytes(PNG)); // 가리키지 않는 파일
    await putFile(dir, '그림/01_개념.md', '# 그림이라는 교과 폴더의 MD');
    const refs = { a: `teacher-image:${key(PNG)}`, b: `teacher-image:${key(JPG)}`, c: `teacher-image:${key(PNG2)}` };
    const saved = { state: { subjects: [{ lessons: [{ images: refs }] }] }, history: [{ images: { a: refs.a } }] };
    dir.shared.reads.length = 0;
    const result = await ctx.readFolderImages(dir, saved);
    assert.deepStrictEqual([result.total, result.missing], [3, 2]);
    assert.deepStrictEqual(dir.shared.reads.slice().sort(), [`그림/${key(JPG)}.jpg`, `그림/${key(PNG)}.png`, `그림/${key(PNG2)}.png`].sort(), '가리키지 않는 파일·MD는 읽지 않는다');
    const images = result.value.state.subjects[0].lessons[0].images;
    assert.deepStrictEqual([images.a, images.b, images.c], [PNG, refs.b, refs.c]);
    assert.strictEqual(result.value.history[0].images.a, PNG);
    assert.ok(ctx.toasts.some(t => t.includes('폴더의 그림 3장을 읽고 있습니다')));
    const none = await ctx.readFolderImages(fakeDir('C'), saved);
    assert.deepStrictEqual([none.total, none.missing], [3, 3], "'그림' 폴더가 없으면 모두 빠진 것");
});

test('F11 폴더 열기: 확인 → 사본 → 한 번에 바꾸기. 찾지 못한 그림은 참조로 남고 다음 저장에도 남는다', async () => {
    // 폴더 A에 '따로'로 저장한 뒤 save_data.yaml과 그림 한 장만 B로 옮긴다
    const src = makeApp({ mode: 'separate' });
    const srcState = { courseTitle: '원본', subjects: [{ id: 's1', title: '교과', lessons: [{ id: 1, title: '차시', content: '글', images: { a: PNG, b: JPG, c: PNG2 } }] }], lessonTrash: [{ at: '2026-11-01T00:00:00.000Z', lesson: { id: 9, title: '지운 차시' } }] };
    src.exec(`globalState = sanitizeState(${JSON.stringify(srcState)}); currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons;`);
    const a = fakeDir('A');
    await connect(src.ctx, a);
    const yaml = await readText(a, 'save_data.yaml');
    const b = fakeDir('B');
    await putFile(b, 'save_data.yaml', yaml);
    await putFile(b, `그림/${src.ctx.window.backupImageKey(PNG)}.png`, imageBytes(PNG));

    const { ctx, exec } = makeApp({ mode: 'inline' });
    seed(exec, { title: '지금 작업' });
    exec(`globalState.lessonTrash = [{ at: '2026-11-02T00:00:00.000Z', lesson: { id: 7, title: '내 휴지통' } }];`);
    const before = exec('globalState');
    ctx.showDirectoryPicker = async () => b;
    await ctx.loadFromProjectFolder();
    const ask = ctx.confirms[0];
    assert.strictEqual(ask.opts.title, '작업 폴더에서 불러오기');
    assert.ok(ask.message.includes("'B' 폴더의 작업(교과 1개)으로") && ask.message.includes('그림 3장 중 2장을'), ask.message);
    assert.strictEqual(ask.opts.okLabel, '빠진 채로 열기');
    const log = b.shared.log;
    const copy = log.find(p => p.startsWith('save_data_이전_'));
    assert.ok(copy && log.indexOf(copy) < log.indexOf('save_data.yaml'), log.join(','));
    assert.strictEqual(await readText(b, copy), yaml, '열기 전 저장본 그대로');
    assert.notStrictEqual(exec('globalState'), before);
    const lesson = exec('globalState.subjects[0].lessons[0]');
    assert.strictEqual(lesson.images.a, PNG);
    assert.ok(ctx.window.isBackupImageRef(lesson.images.b) && ctx.window.isBackupImageRef(lesson.images.c), '찾지 못한 그림은 참조로 남는다');
    assert.deepStrictEqual(plain(exec('globalState.lessonTrash')).map(entry => entry.lesson.title).sort(), ['내 휴지통', '지운 차시'], '휴지통은 합친다');
    assert.strictEqual(ctx.store.get('teacher:backup-images'), 'separate', '그림 담기를 폴더 방식에 맞춘다');
    const after = await readText(b, 'save_data.yaml');
    assert.ok(after.includes(lesson.images.b) && after.includes(lesson.images.c), '다음 저장도 참조를 지우지 않는다');
    const done = ctx.alerts[ctx.alerts.length - 1];
    assert.ok(done.includes('자동으로 저장합니다') && done.includes(`열기 전 폴더의 저장본은 ${copy}으로`) && done.includes("'따로·가볍게'로 바꿨습니다"), done);
    assert.ok(done.includes('그림 2장(작업 기록·휴지통의 그림도 셈)은 찾지 못해 빈칸으로 남았습니다'), '확인 창과 같은 수이고, 작업 기록·휴지통의 그림도 센다고 말한다');
});

test('F12 폴더 열기를 취소하면 폴더에도 브라우저에도 아무것도 바뀌지 않는다', async () => {
    const { ctx, exec } = makeApp();
    seed(exec);
    const b = fakeDir('B');
    // 교과가 하나 있는 폴더(교과가 없는 저장본은 묻지 않고 멈춘다. 묶음 6, tests/import-restore.test.js)
    await putFile(b, 'save_data.yaml', `state:\n  courseTitle: "폴더"\n  subjects: ${JSON.stringify(FOLDER_SUBJECTS)}\n`);
    const before = exec('globalState');
    ctx.confirmAnswer = false;
    ctx.showDirectoryPicker = async () => b;
    await ctx.loadFromProjectFolder();
    assert.strictEqual(ctx.confirms.length, 1);
    assert.ok(ctx.confirms[0].message.includes("'B' 폴더의 작업(교과 1개)으로"), '새 상태를 확인 창보다 먼저 만들어 폴더의 교과 수를 보인다');
    assert.deepStrictEqual(b.shared.log, []);
    assert.strictEqual(exec('globalState'), before);
    assert.strictEqual(exec('projectFolderHandle'), null);
});

test('F12b 생성·분량 채우기가 도는 동안에는 폴더를 열지 않고, 확인 창을 띄운 사이 시작된 생성이 있어도 바꾸지 않는다(만들던 차시가 버려진 객체에 쓰여 결과를 잃지 않게)', async () => {
    const { ctx, exec } = makeApp();
    seed(exec);
    const b = fakeDir('B');
    await putFile(b, 'save_data.yaml', `state:\n  courseTitle: "폴더"\n  subjects: ${JSON.stringify(FOLDER_SUBJECTS)}\n`);
    b.shared.log.length = 0;
    const before = exec('globalState');
    let picked = 0;
    ctx.showDirectoryPicker = async () => { picked += 1; return b; };
    ctx.isAiWorkRunning = () => true;
    await ctx.loadFromProjectFolder();
    assert.deepStrictEqual([picked, ctx.confirms.length], [0, 0], '폴더를 고르게 하지도 않는다');
    assert.ok(ctx.alerts.at(-1).includes('진행 중인 생성이 끝난 뒤'), ctx.alerts.at(-1));
    ctx.isAiWorkRunning = () => ctx.confirms.length > 0; // 확인 창을 띄운 사이 시작된 생성
    await ctx.loadFromProjectFolder();
    assert.deepStrictEqual([picked, ctx.confirms.length], [1, 1]);
    assert.deepStrictEqual(b.shared.log, [], '폴더에 사본도 쓰지 않는다');
    assert.strictEqual(exec('globalState'), before);
    assert.strictEqual(exec('projectFolderHandle'), null);
});

test('F13 사본 이름은 앞 사본을 덮지 않는다', async () => {
    const { ctx } = makeApp();
    const dir = fakeDir('A');
    assert.strictEqual(await ctx.freeFolderCopyName(dir, '20261105-1530'), 'save_data_이전_20261105-1530.yaml');
    await putFile(dir, 'save_data_이전_20261105-1530.yaml', 'x');
    await putFile(dir, 'save_data_이전_20261105-1530_2.yaml', 'y');
    assert.strictEqual(await ctx.freeFolderCopyName(dir, '20261105-1530'), 'save_data_이전_20261105-1530_3.yaml');
});

/* ---------- 도우미 ---------- */
test('F14 줄 세우기: 한 번에 하나(앞 일이 끝난 직후 틈에 온 요청도 겹치지 않음), 기다리는 일은 하나로 합쳐 최신 값을 읽고, 실패해도 다음은 돈다', async () => {
    const { ctx } = makeApp();
    // 하나가 돌고 하나가 기다리는 중에 도는 일이 끝나고, 그때부터 마이크로태스크 0~12단계 뒤에 요청이 또 와도 겹쳐 돌지 않는다
    // (앞 일이 끝난 뒤 기다리던 일이 시작하기 전의 틈에 온 요청을 바로 시작하는 줄 세우기는 여기서 둘이 겹친다)
    for (let hops = 0; hops <= 12; hops++) {
        let active = 0;
        let maxActive = 0;
        const releases = [];
        const runner = ctx.createSerialRunner(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => releases.push(resolve));
            active -= 1;
        });
        runner.request();
        await tick();
        runner.request(); // 기다리는 일
        releases.shift()(); // 도는 일이 끝난다
        let chain = Promise.resolve();
        for (let i = 0; i < hops; i++) chain = chain.then(() => {});
        chain.then(() => { runner.request(); });
        await tick(2);
        while (releases.length) {
            releases.shift()();
            await tick(2);
        }
        await runner.idle();
        assert.strictEqual(maxActive, 1, `${hops}단계 뒤 요청에서 두 일이 겹쳤다`);
    }
    // 기다리는 일은 하나로 합쳐 시작할 때의 최신 값을 읽고, 실패해도 다음 일은 돈다
    let value = 0;
    const seen = [];
    const releases = [];
    const runner = ctx.createSerialRunner(async () => {
        seen.push(value);
        await new Promise(resolve => releases.push(resolve));
        if (value === -1) throw new Error('실패');
        return value;
    });
    runner.request();
    await tick();
    for (let i = 1; i <= 4; i++) {
        value = i;
        runner.request();
    }
    releases.shift()();
    await tick(2);
    assert.deepStrictEqual(seen, [0, 4], '기다리던 일은 하나이고 시작할 때의 최신 값을 읽는다');
    releases.shift()();
    await runner.idle();
    value = -1;
    const failed = runner.request();
    await tick();
    releases.shift()();
    await assert.rejects(failed);
    value = 7;
    const after = runner.request();
    await tick();
    releases.shift()();
    assert.strictEqual(await after, 7, '실패한 뒤에도 다음 일은 돈다');
});

test('F15 미루기: 여러 번 불러도 마지막에서 한 번, flush는 바로, cancel은 버린다', async () => {
    const { ctx } = makeApp();
    const queue = [];
    const timers = { set: (fn, ms) => queue.push({ fn, ms }), clear: id => { queue[id - 1] = null; } };
    let calls = 0;
    const task = ctx.createDebouncedTask(() => { calls += 1; return 'done'; }, 1000, timers);
    task.schedule();
    task.schedule();
    task.schedule();
    const live = queue.filter(Boolean);
    assert.deepStrictEqual([live.length, live[0].ms], [1, 1000], '기다리는 일은 하나');
    live[0].fn();
    assert.deepStrictEqual([calls, task.pending()], [1, false]);
    assert.strictEqual(task.flush(), null, '기다리는 일이 없으면 하지 않는다');
    task.schedule();
    assert.strictEqual(task.flush(), 'done', 'flush는 바로 한다');
    assert.strictEqual(calls, 2);
    task.schedule();
    task.cancel();
    assert.deepStrictEqual([task.pending(), calls], [false, 2]);
});

test('F16 참고자료 칸 저장: 다른 저장이 미뤄 둔 저장을 대신하고, 창이 가려지거나 닫히면 바로 저장한다', async () => {
    const { ctx, exec } = makeApp();
    seed(exec);
    exec('DBManager.setItem = async () => { window.dbWrites = (window.dbWrites || 0) + 1; };');
    exec('saveStateSoon()');
    assert.strictEqual(exec('saveSoonTask.pending()'), true);
    await exec('saveState()');
    assert.strictEqual(exec('saveSoonTask.pending()'), false, '다른 저장이 대신한다');
    assert.strictEqual(ctx.dbWrites, 1);
    exec('saveStateSoon()');
    ctx.document.visibilityState = 'hidden';
    ctx.listeners.visibilitychange();
    assert.strictEqual(exec('saveSoonTask.pending()'), false);
    await tick();
    assert.strictEqual(ctx.dbWrites, 2);
    exec('saveStateSoon()');
    ctx.listeners['window:pagehide']();
    await tick();
    assert.strictEqual(ctx.dbWrites, 3);
});

/* ---------- 폴더 열기 마침 알림·차시 MD ---------- */
test('F17 폴더 열기: 칸이 모자라 넣지 못한 폴더의 작업 기록은 열기 전에 남긴 사본에 그대로 남는다고 그 파일 이름으로 알린다', async () => {
    const { ctx, exec } = makeApp();
    seed(exec);
    exec(`contentHistory = ${JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i, title: `내 기록 ${i}`, date: `d${i}` })))};`);
    const b = fakeDir('B');
    const folderHistory = [{ id: 5, title: '폴더 기록 1', date: 'f1' }, { id: 6, title: '폴더 기록 2', date: 'f2' }];
    await putFile(b, 'save_data.yaml', `state:\n  courseTitle: "폴더"\n  subjects: ${JSON.stringify(FOLDER_SUBJECTS)}\nhistory: ${JSON.stringify(folderHistory)}\n`);
    ctx.showDirectoryPicker = async () => b;
    await ctx.loadFromProjectFolder();
    const copy = b.shared.log.find(p => p.startsWith('save_data_이전_'));
    const done = ctx.alerts[ctx.alerts.length - 1];
    assert.ok(copy && done.includes('폴더에 있던 기록 2개는 넣지 않았고') && done.includes(`그 기록은 ${copy}에 그대로 남아 있습니다.`), done);
    assert.ok((await readText(b, copy)).includes('폴더 기록 1'), '사본에는 그 기록이 남아 있다');
    assert.ok(!(await readText(b, 'save_data.yaml')).includes('폴더 기록 1'), '이어지는 폴더 저장은 그 기록을 쓰지 않는다');
});

test('F18 차시 MD의 그림 자리: img_1이 img_10을 건드리지 않고, 정규식에 쓰이는 글자가 든 그림 이름에도 저장이 멈추지 않는다', async () => {
    const { ctx, exec } = makeApp();
    seed(exec, { images: { img_1: PNG, img_10: JPG } });
    // 불러온 상태 검사(묶음 6)는 이런 그림 이름을 받지 않는다. 그래도 그런 이름이 있으면 폴더 저장이 멈추지 않는지 본다
    exec(`courseData[0].images['img(2'] = ${JSON.stringify(PNG2)};`);
    exec(`courseData[0].content = '<!-- [IMG: "local:img_1"] --> <img src="local:img_10"> <img src="local:img(2">';`);
    const dir = fakeDir('A');
    await connect(ctx, dir);
    assert.ok(ctx.toasts.some(t => t.includes('[A] 폴더가 연동되었습니다')), '저장이 실패하지 않는다');
    const mdPath = dir.shared.log.find(p => p.endsWith('.md'));
    const md = await readText(dir, mdPath);
    assert.ok(md.includes('![img_1](../첨부파일/img_1.png)') && md.includes('src="../첨부파일/img_10.jpg"') && md.includes('src="../첨부파일/img(2.png"'), md);
    assert.ok(!md.includes('local:'), md);
});

test('F19 이름 규칙에 차시 번호가 없어 두 차시가 한 MD에 쓰면, 저장할 때마다 마지막 차시가 남는다(두 차시의 첨부 그림 이름이 겹쳐도 마지막 그림)', async () => {
    const { ctx, exec } = makeApp();
    const state = { courseTitle: '과정', subjects: [{ id: 's1', title: '교과', namingConvention: '같은이름', lessons: [
        { id: 1, title: 'A', content: 'AAA <img src="local:img_1">', images: { img_1: PNG } },
        { id: 2, title: 'B', content: 'BBB <img src="local:img_1">', images: { img_1: PNG2 } }
    ] }] };
    exec(`globalState = sanitizeState(${JSON.stringify(state)}); currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons; contentHistory = [];`);
    const dir = fakeDir('A');
    await connect(ctx, dir);
    for (let save = 1; save <= 3; save++) {
        if (save > 1) {
            await exec('saveState()');
            await exec('waitFolderSync()');
        }
        assert.ok((await readText(dir, '과정/교과/같은이름.md')).startsWith('# B\n\nBBB'), `${save}번째 저장 뒤 MD`);
        assert.strictEqual(await readText(dir, '과정/첨부파일/img_1.png', 'base64'), PNG2.split(',')[1], `${save}번째 저장 뒤 첨부 그림`);
    }
});

test('F20 그림 읽기: 내용이 이름과 맞지 않는 파일(복사가 끊겨 짧거나, 크기는 같은데 뒤가 빔)은 찾지 못한 것으로 두어 첫 저장 뒤에도 폴더 저장본이 원래 그림을 가리키고, 성한 파일을 넣고 다시 열면 돌아온다', async () => {
    const BMP = 'data:image/bmp;base64,' + 'Qk02AAAAAAAAADYAAAAoAAAA'.repeat(10); // 확장자가 없는 형식이라 .png로 쓴다
    const src = makeApp({ mode: 'separate' });
    const srcState = { courseTitle: '원본', subjects: [{ id: 's1', title: '교과', lessons: [{ id: 1, title: '차시', content: '글', images: { a: PNG, b: PNG2, c: JPG, d: BMP } }] }] };
    src.exec(`globalState = sanitizeState(${JSON.stringify(srcState)}); currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons;`);
    const a = fakeDir('A');
    await connect(src.ctx, a);
    const key = dataUrl => src.ctx.window.backupImageKey(dataUrl);
    const b = fakeDir('B');
    await putFile(b, 'save_data.yaml', await readText(a, 'save_data.yaml'));
    await putFile(b, `그림/${key(PNG)}.png`, imageBytes(PNG));
    await putFile(b, `그림/${key(BMP)}.png`, imageBytes(BMP));
    await putFile(b, `그림/${key(PNG2)}.png`, imageBytes(PNG2).slice(0, 10)); // 복사가 끊겨 짧아짐
    const hollow = imageBytes(JPG);
    hollow.fill(0, 100);
    await putFile(b, `그림/${key(JPG)}.jpg`, hollow); // 크기는 그대로인데 뒤가 빔

    const { ctx, exec } = makeApp({ mode: 'inline' });
    seed(exec, { title: '지금 작업', images: {} });
    ctx.showDirectoryPicker = async () => b;
    await ctx.loadFromProjectFolder();
    assert.ok(ctx.confirms[0].message.includes('그림 4장 중 2장을'), ctx.confirms[0].message);
    const images = exec('globalState.subjects[0].lessons[0].images');
    assert.deepStrictEqual([images.a, images.d], [PNG, BMP], '성한 파일은 받는다(.png로 쓴 다른 형식은 원래 글 그대로)');
    assert.deepStrictEqual([images.b, images.c], [`teacher-image:${key(PNG2)}`, `teacher-image:${key(JPG)}`], '망가진 파일은 받지 않고 참조로 둔다');
    const after = await readText(b, 'save_data.yaml');
    assert.ok([PNG, PNG2, JPG, BMP].every(dataUrl => after.includes(`teacher-image:${key(dataUrl)}`)), '첫 저장 뒤에도 폴더 저장본이 원래 그림을 모두 가리킨다');
    await putFile(b, `그림/${key(PNG2)}.png`, imageBytes(PNG2));
    await putFile(b, `그림/${key(JPG)}.jpg`, imageBytes(JPG));
    await ctx.loadFromProjectFolder();
    const back = exec('globalState.subjects[0].lessons[0].images');
    assert.deepStrictEqual([back.a, back.b, back.c, back.d], [PNG, PNG2, JPG, BMP], '성한 파일을 넣고 다시 열면 돌아온다');
});

test('F21 폴더 열기: 연 작업을 브라우저에 저장한 뒤에야 그 폴더를 기억한다. 브라우저 저장이 실패하면 앞서 기억한 폴더도 잊어, 다시 열어도 옛 작업이 어느 폴더도 덮지 않는다', async () => {
    const db = new Map();
    const useDb = app => {
        Object.assign(app.ctx, { db, dbLog: [] });
        app.exec(`DBManager.setItem = async (key, value) => {
            if (key === STORAGE_KEY && window.failStateWrite) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
            window.dbLog.push('set ' + key);
            window.db.set(key, value);
        };
        DBManager.getItem = async key => window.db.get(key);
        DBManager.deleteItem = async key => { window.dbLog.push('delete ' + key); window.db.delete(key); };`);
        return app;
    };
    const folderB = async () => {
        const dir = fakeDir('B');
        await putFile(dir, 'save_data.yaml', `state:\n  courseTitle: "폴더작업"\n  subjects: ${JSON.stringify(FOLDER_SUBJECTS)}\n`);
        return dir;
    };
    const a = fakeDir('A');
    // 브라우저 저장이 되면: 앞 폴더를 잊고 → 연 작업을 저장하고 → 이 폴더를 기억한다
    const ok = useDb(makeApp());
    seed(ok.exec, { title: '브라우저옛작업' });
    db.set('projectFolderHandle', a);
    const b1 = await folderB();
    ok.ctx.showDirectoryPicker = async () => b1;
    await ok.ctx.loadFromProjectFolder();
    assert.deepStrictEqual(ok.ctx.dbLog.slice(-3), ['delete projectFolderHandle', 'set test-state', 'set projectFolderHandle'], ok.ctx.dbLog.join(','));
    assert.strictEqual(db.get('projectFolderHandle'), b1);
    // 브라우저 저장이 실패하면: 이 폴더도 앞 폴더도 기억하지 않고 마침 알림에 그렇게 적는다. 이 창에서는 폴더에 이어 저장한다
    db.clear();
    const fail = useDb(makeApp());
    seed(fail.exec, { title: '브라우저옛작업' });
    await fail.exec('saveState()');
    db.set('projectFolderHandle', a);
    const b2 = await folderB();
    fail.ctx.failStateWrite = true;
    fail.ctx.showDirectoryPicker = async () => b2;
    await fail.ctx.loadFromProjectFolder();
    assert.strictEqual(db.has('projectFolderHandle'), false, '새로고침 뒤 이어 쓸 폴더를 기억하지 않는다');
    const done = fail.ctx.alerts[fail.ctx.alerts.length - 1];
    assert.ok(done.includes('브라우저에는 이 작업을 저장하지 못했습니다') && done.includes("'저장해 둔 폴더 열기'로 이 폴더를 다시 여세요"), done);
    assert.strictEqual(fail.exec('projectFolderHandle'), b2);
    assert.ok((await readText(b2, 'save_data.yaml')).includes('폴더작업'));
    // 새로고침: 브라우저에는 옛 작업이 남았지만 어느 폴더에도 잇지 않아 덮어쓰지 않는다
    const reload = useDb(makeApp());
    for (const [k, v] of fail.ctx.store) reload.ctx.store.set(k, v);
    reload.ctx.showDirectoryPicker = async () => null;
    reload.exec(`globalState = sanitizeState(${JSON.stringify(db.get('test-state').state)}); currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons; contentHistory = [];`);
    assert.strictEqual(reload.exec('globalState.courseTitle'), '브라우저옛작업');
    await reload.ctx.restoreProjectFolderConnection();
    assert.strictEqual(reload.exec('projectFolderHandle'), null, '새로고침 뒤 잇지 않는다');
    await reload.exec('saveState()');
    await reload.exec('waitFolderSync()');
    assert.ok((await readText(b2, 'save_data.yaml')).includes('폴더작업'), '연 폴더를 옛 작업으로 덮지 않는다');
    assert.strictEqual(await readText(a, 'save_data.yaml'), null, '앞 폴더도 덮지 않는다');
});

test('F22 불러온 파일에서 온 이름(그림 이름 a/b, 빈칸뿐인 교과 이름, 점뿐인 과정 이름)도 폴더 저장을 멈추지 않는다', async () => {
    const { ctx, exec } = makeApp();
    const state = { courseTitle: '..', subjects: [{ id: 's1', title: '   ', lessons: [{ id: 1, title: '차시', content: '글 <img src="local:a/b">', images: { 'a/b': PNG } }] }] };
    exec(`globalState = sanitizeState(${JSON.stringify(state)}); currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons; contentHistory = [];`);
    // 불러온 상태 검사(묶음 6)는 그림 이름 a/b를 받지 않는다. 그래도 그런 이름이 있으면 폴더 저장이 멈추지 않는지 본다
    exec(`courseData[0].images['a/b'] = ${JSON.stringify(PNG)};`);
    const dir = fakeDir('A');
    await connect(ctx, dir);
    assert.ok(ctx.toasts.some(t => t.includes('[A] 폴더가 연동되었습니다')), '저장이 실패하지 않는다');
    const mdPath = dir.shared.log.find(p => p.endsWith('.md'));
    assert.ok(mdPath && mdPath.startsWith('새_교안프로젝트/교과_s1/'), dir.shared.log.join(','));
    assert.ok(dir.shared.log.includes('새_교안프로젝트/첨부파일/a_b.png'), dir.shared.log.join(','));
    assert.ok((await readText(dir, mdPath)).includes('src="../첨부파일/a_b.png"'));
});

test('F23 폴더가 사라져 자동 저장을 끄면 띠는 그 까닭만 말한다(쓰기 권한이 풀린 것은 다시 연결 띠가 따로 알린다)', async () => {
    const { ctx, exec } = makeApp();
    seed(exec);
    const dir = fakeDir('A');
    await connect(ctx, dir);
    dir.getFileHandle = async () => { throw fsError('NotFoundError'); };
    assert.strictEqual(await exec('syncToLinkedFolder()'), false);
    assert.strictEqual(exec('projectFolderHandle'), null);
    const text = ctx.elements['folder-sync-banner-text'].textContent;
    assert.ok(text.includes('폴더가 옮겨졌거나 지워졌거나') && !text.includes('권한'), text);
});

test('F24 브라우저 저장(IndexedDB)은 기록이 끝까지 들어가야 저장한 것으로 본다: 요청은 성공해도 기록 단계에서 취소되면(저장 공간 부족) saveState가 false', async () => {
    const { ctx, exec } = makeApp();
    seed(exec);
    let outcome = 'complete';
    const puts = [];
    // 가짜 IndexedDB: put 요청은 늘 성공하고, 그 뒤 기록 단계에서 끝나거나(complete) 취소된다(abort)
    ctx.fakeDb = {
        transaction() {
            const tx = {
                error: null,
                objectStore: () => ({
                    put(value, key) {
                        puts.push(key);
                        const request = {};
                        setTimeout(() => {
                            request.onsuccess?.({ target: request });
                            if (outcome === 'quota') {
                                tx.error = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
                                tx.onabort?.();
                            } else tx.oncomplete?.();
                        });
                        return request;
                    }
                })
            };
            return tx;
        }
    };
    exec('Object.assign(DBManager, window.realDBManager); DBManager.dbInstance = window.fakeDb;');
    assert.strictEqual(await exec('saveState()'), true);
    outcome = 'quota';
    assert.strictEqual(await exec('saveState()'), false, '기록 단계에서 취소되면 저장하지 못한 것');
    assert.ok(ctx.alerts.some(a => a.includes('데이터베이스 저장 중 오류')), '저장하지 못했다고 알린다');
    assert.deepStrictEqual(puts, ['test-state', 'test-state']);
});

test('F25 브라우저 저장이 실패한 동안 폴더에만 저장된 작업은, 새로고침 뒤 브라우저의 옛 작업이 덮지 않게 멈추고 폴더 열기로 되찾게 한다', async () => {
    const { ctx, exec } = makeApp();
    seed(exec, { title: '첫작업' });
    const dir = fakeDir('A');
    await connect(ctx, dir);
    // 브라우저 저장 공간이 차서 브라우저 저장은 실패하고, 폴더에는 계속 쓴다
    exec("DBManager.setItem = async () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); };");
    exec("globalState.courseTitle = '새작업';");
    assert.strictEqual(await exec('saveState()'), false);
    await exec('waitFolderSync()');
    assert.ok((await readText(dir, 'save_data.yaml')).includes('새작업'), '폴더에는 새 작업이 있다');
    assert.strictEqual(JSON.parse(ctx.store.get('teacher:folder-save-stamp')).browserBehind, true, '폴더가 브라우저보다 앞섰다고 적는다');
    assert.strictEqual(exec('isSavePending()'), true, '창을 닫기 전에 묻는다');
    // 새로고침: 같은 이름표와 폴더 손잡이, 브라우저에는 옛 작업
    const reload = makeApp();
    for (const [key, value] of ctx.store) reload.ctx.store.set(key, value);
    seed(reload.exec, { title: '첫작업' });
    reload.ctx.storedHandle = dir;
    reload.ctx.showDirectoryPicker = async () => dir; // 폴더 열기를 지원하는 브라우저
    reload.exec('DBManager.getItem = async () => window.storedHandle;');
    await reload.ctx.restoreProjectFolderConnection();
    assert.strictEqual(reload.exec('projectFolderHandle'), null, '말없이 다시 잇지 않는다');
    const banner = reload.ctx.elements['folder-sync-banner-text'].textContent;
    assert.ok(banner.includes('브라우저에 저장하지 못한 작업이 PC 폴더에만') && banner.includes("'저장해 둔 폴더 열기'"), banner);
    await reload.exec('saveState()');
    await reload.exec('waitFolderSync()');
    assert.ok((await readText(dir, 'save_data.yaml')).includes('새작업'), '새로고침 뒤 첫 저장이 폴더의 새 작업을 덮지 않는다');
    // '다시 연결'은 먼저 묻는다. 덮으면 폴더의 새 작업은 사본으로 남는다
    reload.ctx.confirmAnswer = false;
    await reload.ctx.regrantLinkedFolder(dir);
    const ask = reload.ctx.confirms.at(-1);
    assert.strictEqual(ask.opts.title, '폴더에 더 새 작업이 있습니다');
    assert.ok(ask.message.includes('이 브라우저에 저장하지 못한 작업이 들어 있어') && ask.message.includes("'저장해 둔 폴더 열기'"), ask.message);
    assert.strictEqual(reload.exec('projectFolderHandle'), null);
    reload.ctx.confirmAnswer = true;
    await reload.ctx.regrantLinkedFolder(dir);
    await reload.exec('waitFolderSync()');
    const copy = dir.shared.log.find(p => p.startsWith('save_data_이전_'));
    assert.ok(copy && (await readText(dir, copy)).includes('새작업'), '폴더의 새 작업은 사본으로 남는다');
    assert.ok((await readText(dir, 'save_data.yaml')).includes('첫작업'));
    assert.strictEqual(JSON.parse(reload.ctx.store.get('teacher:folder-save-stamp')).browserBehind, undefined, '브라우저와 폴더에 모두 저장하면 앞섰다는 표시를 지운다');
    assert.strictEqual(reload.exec('isSavePending()'), false);
});

test('F26 폴더를 다시 열면 이 브라우저의 작업 기록·휴지통에 남은 찾지 못한 그림도 폴더의 그림 파일로 채운다', async () => {
    // 폴더 A에 '따로'로 저장한 뒤(작업 기록·휴지통에 그림) save_data.yaml만 B로 옮긴다(그림 파일은 아직 없다)
    const src = makeApp({ mode: 'separate' });
    const srcState = { courseTitle: '원본', subjects: [{ id: 's1', title: '교과', lessons: [{ id: 1, title: '차시', content: '글', images: {} }] }], lessonTrash: [{ at: new Date().toISOString(), lesson: { id: 9, title: '지운 차시', content: '<img src="local:t">', images: { t: PNG2 } } }] };
    src.exec(`globalState = sanitizeState(${JSON.stringify(srcState)}); currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons;
        contentHistory = [{ id: 1000, date: 'd', title: '기록', content: '<img src="local:h">', images: { h: ${JSON.stringify(PNG)} } }];`);
    const a = fakeDir('A');
    await connect(src.ctx, a);
    const b = fakeDir('B');
    await putFile(b, 'save_data.yaml', await readText(a, 'save_data.yaml'));
    const { ctx, exec } = makeApp({ mode: 'inline' });
    seed(exec, { title: '지금 작업', images: {} });
    ctx.showDirectoryPicker = async () => b;
    await ctx.loadFromProjectFolder();
    const isRef = value => ctx.window.isBackupImageRef(value);
    assert.ok(isRef(exec('contentHistory').find(item => item.title === '기록').images.h), '그림 파일이 없으면 참조로 남는다');
    assert.ok(isRef(exec('globalState.lessonTrash').find(entry => entry.lesson.title === '지운 차시').lesson.images.t));
    // 그림 파일을 채우고 같은 폴더를 다시 연다
    await putFile(b, `그림/${src.ctx.window.backupImageKey(PNG)}.png`, imageBytes(PNG));
    await putFile(b, `그림/${src.ctx.window.backupImageKey(PNG2)}.png`, imageBytes(PNG2));
    await ctx.loadFromProjectFolder();
    const history = exec('contentHistory').filter(item => item.title === '기록');
    assert.strictEqual(history.length, 1, '같은 기록은 한 번만');
    assert.strictEqual(history[0].images.h, PNG, '작업 기록의 그림이 돌아온다');
    const trash = exec('globalState.lessonTrash').filter(entry => entry.lesson.title === '지운 차시');
    assert.strictEqual(trash.length, 1, '같은 휴지통 항목은 한 번만');
    assert.strictEqual(trash[0].lesson.images.t, PNG2, '휴지통의 그림이 돌아온다');
    assert.ok(!ctx.alerts.at(-1).includes('찾지 못해'), ctx.alerts.at(-1));
});

test('F27 다시 연결: 폴더 저장본을 읽지 못하면 사본을 남길 수 없어 덮어쓰지 않고, 고르지도 않은 빈 폴더를 고르라고 하지 않는다', async () => {
    const { ctx, exec, dir } = await lockedApp();
    await putFile(dir, 'save_data.yaml', 'state:\n  courseTitle: "다른 PC"\n', { fail: true }); // 읽히지 않는 저장본(내려받지 않은 OneDrive 파일 등)
    dir.grantOnRequest = true;
    await ctx.regrantLinkedFolder(dir, exec('FOLDER_LOCKED_MESSAGE'));
    const told = ctx.alerts.at(-1);
    assert.ok(told.includes('사본을 남길 수 없어 덮어쓰지 않았습니다') && told.includes("'다시 연결'") && told.includes("'빈 폴더에 저장 시작'"), told);
    assert.ok(!told.includes('다른 빈 폴더를 골라 주세요'), told);
    assert.strictEqual(exec('projectFolderHandle'), null, '자동 저장은 멈춘 채로 둔다');
    assert.deepStrictEqual(dir.shared.log, [], '덮어쓰지도 사본을 만들지도 않는다');
});

(async () => {
    let failed = 0;
    for (const { name, fn } of cases) {
        try {
            await fn();
            console.log(`ok - ${name}`);
        } catch (e) {
            failed += 1;
            console.log(`FAIL - ${name}\n  ${e.stack || e.message}`);
        }
    }
    console.log(`\n${cases.length - failed}/${cases.length} passed`);
    if (failed) process.exit(1);
})();
