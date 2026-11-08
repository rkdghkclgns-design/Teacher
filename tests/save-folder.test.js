// 기본 저장 폴더 테스트 (실행: node tests/save-folder.test.js)
// js/save-folder.js를 vm에서 돌린다. 고른 폴더는 메모리 속 가짜 FileSystemDirectoryHandle, 브라우저 다운로드는 가짜 <a>로 받는다(실제 파일은 쓰지 않는다).
// 내보내기·백업 자리들이 이 도우미를 부르는지, 설정 칸·index.html·README도 실제 파일로 확인한다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const fsError = (name, message = name) => Object.assign(new Error(message), { name });
const KEY = 'defaultSaveFolderHandle';

/* ---------- 가짜 폴더 ---------- */
// permission: queryPermission의 답, grant: requestPermission의 답(오류면 던진다), failWrite: 쓸 때 던질 오류
function fakeDir(name, { permission = 'granted', grant = 'granted', failWrite = null } = {}) {
    const files = new Map(); // 이름 → 쓴 내용(Blob). 손으로 넣은 파일은 글자
    const dir = {
        kind: 'directory', name, files, permission, grant, failWrite, modes: [], requests: 0, removed: [], aborted: 0,
        async queryPermission(opts) {
            dir.modes.push(opts?.mode);
            return dir.permission;
        },
        async requestPermission(opts) {
            dir.requests += 1;
            dir.modes.push(opts?.mode);
            if (dir.grant instanceof Error) throw dir.grant;
            dir.permission = dir.grant;
            return dir.permission;
        },
        async getFileHandle(child, opts = {}) {
            if (!files.has(child)) {
                if (!opts.create) throw fsError('NotFoundError');
                files.set(child, null);
            }
            return {
                kind: 'file', name: child,
                async createWritable() {
                    let next = null;
                    return {
                        async write(content) {
                            if (dir.failWrite) throw dir.failWrite;
                            next = content;
                        },
                        async close() { files.set(child, next); },
                        async abort() { dir.aborted += 1; }
                    };
                }
            };
        },
        async removeEntry(child) {
            dir.removed.push(child);
            files.delete(child);
        }
    };
    return dir;
}

/* ---------- 앱 ---------- */
const SETTING_IDS = ['settings-save-folder-name', 'settings-save-folder-pick', 'settings-save-folder-reset', 'settings-save-folder-note',
    'settings-project-folder-state', 'settings-project-folder-connect', 'settings-project-folder-disconnect'];

function fakeElement(id) {
    const classes = new Set(id === 'settings-save-folder-note' ? ['hidden'] : []);
    return {
        id, textContent: '', title: '', disabled: false,
        classList: {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name),
            toggle: (name, force) => {
                const on = force === undefined ? !classes.has(name) : !!force;
                if (on) classes.add(name);
                else classes.delete(name);
                return on;
            }
        }
    };
}

// stored: 저장소에 남아 있던 기본 저장 폴더, picker: 이 브라우저에 폴더 고르기 창이 있는지, dbFails: 저장소를 읽지 못한다, project: 이어 둔 프로젝트 폴더
// 받은 다운로드는 ctx.downloads, 만든 주소의 Blob은 ctx.urls, 걸어 둔 시간은 ctx.timers(바로 실행한다)
function makeApp({ stored = null, picker = true, dbFails = false, project = null } = {}) {
    const store = new Map(stored ? [[KEY, stored]] : []);
    const elements = Object.fromEntries(SETTING_IDS.map(id => [id, fakeElement(id)]));
    const ctx = {
        console: { log() {}, info() {}, warn() {}, error() {} },
        Blob,
        setTimeout: (fn, ms) => {
            ctx.timers.push(ms);
            fn();
            return 0;
        },
        clearTimeout() {},
        URL: {
            createObjectURL: blob => {
                ctx.urls.push(blob);
                return `blob:${ctx.urls.length}`;
            },
            revokeObjectURL: url => ctx.revoked.push(url)
        },
        document: {
            body: { appendChild: el => { el.attached = true; } },
            getElementById: id => elements[id] || null,
            createElement: tag => {
                const el = {
                    tagName: tag, href: '', download: '', attached: false,
                    click() { ctx.downloads.push({ name: el.download, href: el.href }); },
                    remove() { el.attached = false; }
                };
                return el;
            }
        },
        DBManager: {
            async getItem(key) {
                if (dbFails) throw new Error('저장소를 열지 못했습니다');
                ctx.dbReads += 1;
                return store.get(key);
            },
            async setItem(key, value) { store.set(key, value); },
            async deleteItem(key) { store.delete(key); }
        },
        projectFolderHandle: project,
        store, elements, downloads: [], urls: [], revoked: [], timers: [], toasts: [], alerts: [], picks: [], dbReads: 0, pickResult: null
    };
    ctx.window = ctx;
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    ctx.showAlert = message => ctx.alerts.push(message);
    if (picker) {
        ctx.showDirectoryPicker = async opts => {
            ctx.picks.push(opts);
            if (ctx.pickResult instanceof Error) throw ctx.pickResult;
            return ctx.pickResult;
        };
    }
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'save-folder.js'), 'utf8'), ctx, { filename: 'save-folder.js' });
    return ctx;
}

const names = ctx => ctx.downloads.map(item => item.name);
const warnings = ctx => ctx.toasts.filter(([, type]) => type === 'warning').map(([message]) => message);
const textOf = async (dir, name) => dir.files.get(name)?.text();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

/* ---------- 폴더를 고르지 않았을 때 ---------- */
test('S1 기본 저장 폴더를 고르지 않았으면 예전처럼 같은 이름으로 내려받고(주소는 나중에 거둔다) 따로 알리지 않는다. 글은 Blob으로 만든다', async () => {
    const ctx = makeApp();
    const result = await ctx.saveFileToFolder('# 교안', '01_변수.md', 'text/markdown;charset=utf-8');
    assert.deepStrictEqual(names(ctx), ['01_변수.md']);
    assert.strictEqual(ctx.downloads[0].href, 'blob:1');
    assert.strictEqual(await ctx.urls[0].text(), '# 교안');
    assert.strictEqual(ctx.urls[0].type, 'text/markdown;charset=utf-8');
    assert.deepStrictEqual(ctx.revoked, ['blob:1'], '만든 주소를 거둔다');
    assert.ok(ctx.timers.some(ms => ms >= 10000), `받기가 시작될 시간을 두고 거둔다: ${ctx.timers.join(',')}`);
    assert.deepStrictEqual([ctx.toasts.length, ctx.alerts.length], [0, 0]);
    assert.deepStrictEqual(plain(result), { saved: 'download', fileName: '01_변수.md', folderName: '' });
    const zip = new Blob(['PK'], { type: 'application/zip' });
    await ctx.saveFileToFolder(zip, '백업.zip');
    assert.strictEqual(ctx.urls[1], zip, 'Blob은 그대로 내려받는다');
});

/* ---------- 폴더를 골라 두었을 때 ---------- */
test('S2 골라 둔 폴더가 있고 권한이 있으면 그 폴더에 같은 이름으로 쓰고(내려받지 않는다) 짧게 알린다. Blob은 그대로, 글은 Blob으로 쓴다', async () => {
    const dir = fakeDir('수업자료');
    const ctx = makeApp({ stored: dir });
    const zip = new Blob(['PK'], { type: 'application/zip' });
    const result = await ctx.saveFileToFolder(zip, '국어_교안.zip');
    assert.strictEqual(dir.files.get('국어_교안.zip'), zip, '받은 Blob을 그대로 쓴다');
    assert.deepStrictEqual(ctx.downloads, []);
    assert.deepStrictEqual(ctx.toasts, [['수업자료 폴더에 국어_교안.zip을 저장했습니다.', 'success']]);
    assert.deepStrictEqual(plain(result), { saved: 'folder', fileName: '국어_교안.zip', folderName: '수업자료' });
    await ctx.saveFileToFolder('글', '메모.md', 'text/markdown');
    assert.strictEqual(await textOf(dir, '메모.md'), '글');
    assert.strictEqual(dir.files.get('메모.md').type, 'text/markdown');
    assert.deepStrictEqual(dir.modes, ['readwrite', 'readwrite'], '쓰기 권한을 확인한다');
    assert.strictEqual(dir.requests, 0, '권한이 있으면 다시 묻지 않는다');
    assert.strictEqual(ctx.dbReads, 1, '저장소에서는 처음 저장할 때 한 번만 꺼낸다');
});

test('S3 같은 이름이 있으면 덮어쓰지 않고 " (2)", " (3)"을 붙인다(확장자가 없어도)', async () => {
    const dir = fakeDir('수업자료');
    dir.files.set('교안.md', '예전 글');
    dir.files.set('README', '예전');
    const ctx = makeApp({ stored: dir });
    await ctx.saveFileToFolder('새 글', '교안.md');
    await ctx.saveFileToFolder('또 새 글', '교안.md');
    await ctx.saveFileToFolder('읽어 보기', 'README');
    assert.strictEqual(dir.files.get('교안.md'), '예전 글', '있던 파일은 그대로');
    assert.strictEqual(await textOf(dir, '교안 (2).md'), '새 글');
    assert.strictEqual(await textOf(dir, '교안 (3).md'), '또 새 글');
    assert.strictEqual(await textOf(dir, 'README (2)'), '읽어 보기');
    assert.deepStrictEqual(ctx.toasts.map(([message]) => message), ['수업자료 폴더에 교안 (2).md을 저장했습니다.', '수업자료 폴더에 교안 (3).md을 저장했습니다.', '수업자료 폴더에 README (2)을 저장했습니다.']);
});

test('S4 폴더에 쓸 수 없는 글자(: ? 등)는 브라우저 다운로드처럼 _로 바꿔 쓴다. 다운로드로 받을 때는 이름을 그대로 넘긴다', async () => {
    const dir = fakeDir('수업자료');
    const ctx = makeApp({ stored: dir });
    await ctx.saveFileToFolder('글', 'C++: 포인터?.md');
    assert.ok(dir.files.has('C++_ 포인터_.md'), [...dir.files.keys()].join(','));
    const other = makeApp();
    await other.saveFileToFolder('글', 'C++: 포인터?.md');
    assert.deepStrictEqual(names(other), ['C++: 포인터?.md']);
});

test('S5 권한을 물어야 하면 묻고, 받으면 그 폴더에 쓴다', async () => {
    const dir = fakeDir('수업자료', { permission: 'prompt', grant: 'granted' });
    const ctx = makeApp({ stored: dir });
    await ctx.saveFileToFolder('글', 'a.md');
    assert.strictEqual(dir.requests, 1);
    assert.strictEqual(await textOf(dir, 'a.md'), '글');
    assert.deepStrictEqual(ctx.downloads, []);
});

test('S6 권한을 받지 못하면(거절, 사용자 동작 없이 물음) 같은 이름으로 내려받고 폴더 문제는 한 번만 알린다', async () => {
    const dir = fakeDir('수업자료', { permission: 'prompt', grant: 'denied' });
    const ctx = makeApp({ stored: dir });
    const first = await ctx.saveFileToFolder('글', 'a.md');
    await ctx.saveFileToFolder('글2', 'b.md');
    assert.deepStrictEqual(names(ctx), ['a.md', 'b.md']);
    assert.strictEqual(first.saved, 'download');
    assert.strictEqual(dir.files.size, 0, '폴더에는 아무것도 만들지 않는다');
    assert.strictEqual(warnings(ctx).length, 1, warnings(ctx).join(' | '));
    assert.ok(warnings(ctx)[0].includes('수업자료 폴더에 쓸 권한을 받지 못해') && warnings(ctx)[0].includes('다운로드 폴더에 받았습니다'), warnings(ctx)[0]);
    assert.ok(!ctx.toasts.some(([message]) => message.includes('저장했습니다')));
    // 긴 내보내기 뒤에는 사용자 동작이 끝나 브라우저가 권한 창 대신 SecurityError를 던진다
    const late = makeApp({ stored: fakeDir('B', { permission: 'prompt', grant: fsError('SecurityError', 'User activation is required to request permissions.') }) });
    await late.saveFileToFolder('글', 'c.md');
    assert.deepStrictEqual(names(late), ['c.md']);
    assert.ok(warnings(late)[0].includes('B 폴더에 쓸 권한을 받지 못해'), warnings(late)[0]);
});

test('S7 쓰다 실패하면(디스크 부족 등) 쓰다 만 빈 파일을 지우고 같은 이름으로 내려받으며 한 번만 알린다. 다시 저장된 뒤의 실패는 또 알린다', async () => {
    const dir = fakeDir('수업자료', { failWrite: fsError('QuotaExceededError', '디스크 공간이 부족합니다') });
    const ctx = makeApp({ stored: dir });
    await ctx.saveFileToFolder('글', 'a.md');
    await ctx.saveFileToFolder('글', 'b.md');
    assert.deepStrictEqual(names(ctx), ['a.md', 'b.md']);
    assert.deepStrictEqual(dir.removed, ['a.md', 'b.md'], '쓰다 만 빈 파일을 남기지 않는다');
    assert.strictEqual(dir.aborted, 2);
    assert.strictEqual(dir.files.size, 0);
    assert.strictEqual(warnings(ctx).length, 1, warnings(ctx).join(' | '));
    assert.ok(warnings(ctx)[0].includes('수업자료 폴더에 저장하지 못해') && warnings(ctx)[0].includes('설정'), warnings(ctx)[0]);
    dir.failWrite = null;
    await ctx.saveFileToFolder('글', 'c.md');
    assert.strictEqual(await textOf(dir, 'c.md'), '글');
    dir.failWrite = fsError('NotFoundError', '폴더가 사라졌습니다');
    await ctx.saveFileToFolder('글', 'd.md');
    assert.strictEqual(warnings(ctx).length, 2, '폴더에 다시 저장된 뒤의 실패는 다시 알린다');
    assert.deepStrictEqual(names(ctx), ['a.md', 'b.md', 'd.md']);
});

test('S8 한꺼번에 맡긴 파일은 차례로 쓰고(같은 이름도 겹치지 않게) 알림은 하나로 묶는다. 다운로드로 받을 때는 맡긴 차례로 0.3초씩 띄운다', async () => {
    const dir = fakeDir('수업자료');
    const ctx = makeApp({ stored: dir });
    await Promise.all([ctx.saveFileToFolder('1', '같은이름.md'), ctx.saveFileToFolder('2', '같은이름.md'), ctx.saveFileToFolder('3', 'c.md')]);
    assert.strictEqual(await textOf(dir, '같은이름.md'), '1');
    assert.strictEqual(await textOf(dir, '같은이름 (2).md'), '2');
    assert.strictEqual(await textOf(dir, 'c.md'), '3');
    assert.deepStrictEqual(ctx.toasts, [['수업자료 폴더에 같은이름.md 외 2개를 저장했습니다.', 'success']]);
    const other = makeApp();
    await Promise.all(['a.md', 'b.md', 'c.md'].map(name => other.saveFileToFolder('글', name)));
    assert.deepStrictEqual(names(other), ['a.md', 'b.md', 'c.md'], '맡긴 차례대로 받는다');
    const gaps = other.timers.filter(ms => ms > 0 && ms <= 300);
    assert.strictEqual(gaps.length, 2, `둘째·셋째는 앞 다운로드와 띄운다: ${other.timers.join(',')}`);
});

/* ---------- 고르기·되돌리기·저장소 ---------- */
test('S9 폴더 고르기: 고르기 창을 쓰기 모드로 열고 고른 폴더를 저장소에 기억한다. 창을 닫으면 아무것도 바꾸지 않는다', async () => {
    const ctx = makeApp();
    ctx.pickResult = fsError('AbortError', 'The user aborted a request.');
    assert.strictEqual(await ctx.chooseSaveFolder(), false);
    assert.deepStrictEqual([ctx.store.has(KEY), ctx.alerts.length, ctx.toasts.length, ctx.saveFolderName()], [false, 0, 0, '']);
    const dir = fakeDir('내 교안');
    ctx.pickResult = dir;
    assert.strictEqual(await ctx.chooseSaveFolder(), true);
    assert.deepStrictEqual(plain(ctx.picks.at(-1)), { mode: 'readwrite' });
    assert.strictEqual(ctx.store.get(KEY), dir, '새로 열어도 쓰도록 기억한다');
    assert.strictEqual(ctx.saveFolderName(), '내 교안');
    assert.ok(ctx.toasts.at(-1)[0].includes('내 교안'), ctx.toasts.at(-1)[0]);
    assert.strictEqual(ctx.elements['settings-save-folder-name'].textContent, '내 교안', '설정 칸을 바로 고친다');
    assert.strictEqual(ctx.elements['settings-save-folder-reset'].disabled, false);
    await ctx.saveFileToFolder('글', 'a.md');
    assert.strictEqual(await textOf(dir, 'a.md'), '글');
    ctx.pickResult = new Error('고르기 창을 열지 못했습니다');
    assert.strictEqual(await ctx.chooseSaveFolder(), false);
    assert.ok(ctx.alerts.at(-1).includes('고르기 창을 열지 못했습니다'), ctx.alerts.at(-1));
    assert.strictEqual(ctx.saveFolderName(), '내 교안', '실패하면 고른 폴더는 그대로');
});

test('S10 기본으로 되돌리기: 저장소에서 지우고 다시 브라우저 다운로드로 받는다', async () => {
    const dir = fakeDir('수업자료');
    const ctx = makeApp({ stored: dir });
    await ctx.saveFileToFolder('글', 'a.md');
    await ctx.clearSaveFolder();
    assert.deepStrictEqual([ctx.store.has(KEY), ctx.saveFolderName()], [false, '']);
    assert.ok(ctx.toasts.at(-1)[0].includes('브라우저 기본 다운로드 폴더'), ctx.toasts.at(-1)[0]);
    assert.strictEqual(ctx.elements['settings-save-folder-name'].textContent, '브라우저 기본 다운로드 폴더');
    await ctx.saveFileToFolder('글', 'b.md');
    assert.deepStrictEqual(names(ctx), ['b.md']);
    assert.ok(!dir.files.has('b.md'));
});

test('S11 저장소를 읽지 못하거나 폴더가 아닌 값이 있으면 내려받는다', async () => {
    const broken = makeApp({ dbFails: true });
    await broken.saveFileToFolder('글', 'a.md');
    assert.deepStrictEqual(names(broken), ['a.md']);
    const odd = makeApp({ stored: { name: '가짜' } });
    await odd.saveFileToFolder('글', 'b.md');
    assert.deepStrictEqual(names(odd), ['b.md']);
    assert.strictEqual(odd.saveFolderName(), '');
});

test('S12 브라우저 다운로드마저 못 하면 거부하고(showSaveFailure가 앱 창으로 알린다), 뒤에 맡긴 저장은 막히지 않는다', async () => {
    const ctx = makeApp();
    ctx.URL.createObjectURL = () => { throw new Error('메모리가 부족합니다'); };
    await assert.rejects(ctx.saveFileToFolder('글', 'a.md'), /메모리가 부족합니다/);
    ctx.showSaveFailure(new Error('메모리가 부족합니다'));
    assert.ok(ctx.alerts.at(-1).includes('파일을 저장하지 못했습니다') && ctx.alerts.at(-1).includes('메모리가 부족합니다'), ctx.alerts.at(-1));
    ctx.URL.createObjectURL = () => 'blob:ok';
    await ctx.saveFileToFolder('글', 'b.md');
    assert.deepStrictEqual(names(ctx), ['b.md']);
});

/* ---------- 설정 칸 ---------- */
test('S13 설정 칸: 폴더가 없으면 "브라우저 기본 다운로드 폴더"(되돌리기 꺼짐), 저장소에 있으면 그 이름. 프로젝트 폴더 연결 상태와 단추도 보인다', async () => {
    const ctx = makeApp();
    ctx.renderSaveLocationSettings();
    await flush();
    const el = id => ctx.elements[id];
    assert.strictEqual(el('settings-save-folder-name').textContent, '브라우저 기본 다운로드 폴더');
    assert.deepStrictEqual([el('settings-save-folder-pick').disabled, el('settings-save-folder-reset').disabled], [false, true]);
    assert.ok(el('settings-save-folder-note').classList.contains('hidden'), '지원하는 브라우저에서는 안내를 숨긴다');
    assert.strictEqual(el('settings-project-folder-state').textContent, '연결 안 됨');
    assert.deepStrictEqual([el('settings-project-folder-connect').textContent, el('settings-project-folder-connect').disabled, el('settings-project-folder-disconnect').disabled], ['폴더 연결', false, true]);

    const set = makeApp({ stored: fakeDir('수업자료'), project: { name: '과정 폴더' } });
    set.renderSaveLocationSettings();
    await flush();
    const el2 = id => set.elements[id];
    assert.strictEqual(el2('settings-save-folder-name').textContent, '수업자료', '저장소에서 꺼내 이름을 보인다');
    assert.strictEqual(el2('settings-save-folder-reset').disabled, false);
    assert.strictEqual(el2('settings-project-folder-state').textContent, '연결됨: 과정 폴더');
    assert.deepStrictEqual([el2('settings-project-folder-connect').textContent, el2('settings-project-folder-disconnect').disabled], ['다른 폴더로 바꾸기', false]);
});

test('S14 설정 칸: 폴더 고르기 창이 없는 브라우저(Firefox·Safari)는 다운로드 폴더에 저장된다고 알리고 단추를 끈다', async () => {
    const ctx = makeApp({ picker: false });
    ctx.renderSaveLocationSettings();
    await flush();
    const note = ctx.elements['settings-save-folder-note'];
    assert.strictEqual(note.textContent, '이 브라우저는 폴더 지정을 지원하지 않아 다운로드 폴더에 저장됩니다.');
    assert.ok(!note.classList.contains('hidden'));
    ['settings-save-folder-pick', 'settings-save-folder-reset', 'settings-project-folder-connect', 'settings-project-folder-disconnect']
        .forEach(id => assert.strictEqual(ctx.elements[id].disabled, true, id));
    assert.strictEqual(ctx.elements['settings-save-folder-name'].textContent, '브라우저 기본 다운로드 폴더');
    assert.strictEqual(await ctx.chooseSaveFolder(), false);
    assert.ok(ctx.alerts[0].includes('지원하지 않아'), ctx.alerts[0]);
    await ctx.saveFileToFolder('글', 'a.md');
    assert.deepStrictEqual(names(ctx), ['a.md']);
});

test('S15 설정 칸의 프로젝트 폴더 단추는 있던 연결·끊기를 그대로 부르고 칸을 다시 그린다', async () => {
    const ctx = makeApp();
    const calls = [];
    ctx.connectProjectFolder = async () => { calls.push('connect'); ctx.projectFolderHandle = { name: '새 폴더' }; };
    ctx.disconnectProjectFolder = async () => { calls.push('disconnect'); ctx.projectFolderHandle = null; };
    await ctx.connectProjectFolderFromSettings();
    assert.strictEqual(ctx.elements['settings-project-folder-state'].textContent, '연결됨: 새 폴더');
    await ctx.disconnectProjectFolderFromSettings();
    assert.deepStrictEqual(calls, ['connect', 'disconnect']);
    assert.strictEqual(ctx.elements['settings-project-folder-state'].textContent, '연결 안 됨');
});

/* ---------- 실제 파일 ---------- */
test('S16 index.html: 설정 패널 고급 앞에 저장 위치 칸(두 줄·단추·안내)이 있고 열 때 칸을 채우며, save-folder.js는 state.js 바로 뒤에 같은 ?v=로 싣는다', () => {
    const html = read('index.html');
    const panel = html.slice(html.indexOf('<div id="settings-panel"'), html.indexOf('<!-- 작업 기록 패널'));
    ['저장 위치', '기본 저장 폴더', '프로젝트 폴더 연결', 'id="settings-save-folder-name"', 'id="settings-save-folder-note"', 'id="settings-project-folder-state"',
        'onclick="chooseSaveFolder()"', 'onclick="clearSaveFolder()"', '>폴더 고르기</button>', '>기본으로 되돌리기</button>',
        'onclick="connectProjectFolderFromSettings()"', 'onclick="disconnectProjectFolderFromSettings()"',
        '웹 페이지는 경로를 글자로 적을 수 없어 폴더 고르기 창으로 고릅니다.']
        .forEach(text => assert.ok(panel.includes(text), text));
    assert.ok(panel.indexOf('기본 저장 폴더') < panel.indexOf('>고급<'), '고급 앞에 둔다');
    assert.ok(html.includes('window.renderSaveLocationSettings?.();'), '설정을 열 때 칸을 채운다');
    const scripts = [...html.matchAll(/<script src="\.\/js\/([\w./-]+)\.js\?v=(\d+)"><\/script>/g)].map(match => [match[1], match[2]]);
    const order = scripts.map(([name]) => name);
    assert.ok(order.indexOf('state') >= 0 && order.indexOf('save-folder') === order.indexOf('state') + 1, order.join(','));
    assert.strictEqual(new Set(scripts.map(([, v]) => v)).size, 1, '새 태그도 이웃과 같은 ?v=');
    assert.ok(!fs.readFileSync(path.join(root, 'index.html'), 'utf8').endsWith('\n'), 'index.html 끝 줄바꿈은 그대로 없다');
});

// [파일, 함수 머리, 파일 이름 식(예전과 같다), 넘기는 내용]
const SITES = [
    ['js/api.js', 'function downloadLessonJpgs(', '_img_${index + 1}.jpg', 'dataUrlBlob(b64)'],
    ['js/course-design.js', 'window.downloadCourseDesignMd = function', '_과정설계서.md', 'blob'],
    ['js/course-illustrations.js', 'async function saveIllustrationPng(', "illustrationFileName(illustration, 'png')", 'dataUrlBlob(png)'],
    ['js/course-qbank.js', 'function downloadCsv(', '_문제은행.csv', 'blob'],
    ['js/course-sessions.js', 'function downloadMd(', '`${safeFileName(name)}.md`', 'blob'],
    ['js/lesson-export.js', 'function downloadTextFile(', 'fileName', 'blob'],
    ['js/ui.js', 'function exportCurrentToMD(', "lessonFileName(mod, 'md')", 'blob'],
    ['js/ui.js', 'function exportSubjectToMD(', "lessonFileName(mod, 'md')", 'blob'],
    ['js/ui.js', 'window.exportSelectedToZip = async function', 'backupFileName(baseName, result.mode)', 'result.blob'],
    ['js/ui.js', 'window.exportAllToZip = async function', 'backupFileName(`${subjectName}_전체교안`, result.mode)', 'result.blob'],
    ['js/state.js', 'function downloadFile(', 'fileName', 'blob'],
    ['js/state.js', 'function downloadRecordFile(', "`${baseName}.${isText ? 'txt' : 'json'}`", 'blob'],
    ['js/state.js', 'window.exportCurrentModule = async function', "`${safeCourseName}_${fileName.replace('.md', '')}.zip`", 'content'],
    ['js/state.js', 'window.exportAllModules = async function', 'backupFileName(`${safeCourseName}_과정전체백업_${backupStamp()}`, result.mode)', 'result.blob'],
    ['js/data-safety.js', 'async function downloadSafetyBackup(', '`교안백업_${backupStamp()}_${label}.zip`', 'blob']
];

test('S17 내보내기·백업 자리는 모두 이 도우미로 저장하고(이 도우미가 없는 옛 스크립트면 예전 다운로드), 파일 이름과 넘기는 Blob은 그대로다. kbuilder는 건드리지 않는다', () => {
    SITES.forEach(([file, head, fileName, data]) => {
        const source = read(file);
        const at = source.indexOf(head);
        assert.ok(at >= 0, `${file}: ${head}`);
        const body = source.slice(at, source.indexOf('\n}', at));
        assert.ok(body.includes("typeof saveFileToFolder === 'function'"), `${file} ${head}: 도우미가 있는지 본다`);
        assert.ok(body.includes(`saveFileToFolder(${data}`), `${file} ${head}: ${data}를 넘긴다`);
        assert.ok(body.includes(fileName), `${file} ${head}: 파일 이름 ${fileName}`);
        assert.ok(/saveAs\(|\.download = /.test(body), `${file} ${head}: 예전 다운로드 길을 남긴다`);
    });
    const kbuilder = fs.readdirSync(path.join(root, 'js', 'kbuilder')).filter(file => file.endsWith('.js')).map(file => read(`js/kbuilder/${file}`)).join('\n');
    assert.ok(!kbuilder.includes('saveFileToFolder'), 'kbuilder는 이 도우미를 쓰지 않는다');
    assert.ok(read('js/kbuilder/export.js').includes('a.href = url; a.download = filename;'), 'kbuilder 내려받기는 그대로');
});

test('S18 README 주요 기능에 기본 저장 폴더 한 줄', () => {
    const lines = read('README.md').split('\n').filter(line => line.startsWith('- **기본 저장 폴더**'));
    assert.strictEqual(lines.length, 1, '한 줄');
    assert.ok(lines[0].includes('설정') && lines[0].includes('다운로드 폴더') && lines[0].includes('(2)'), lines[0]);
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
