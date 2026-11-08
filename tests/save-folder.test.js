// 기본 저장 폴더 테스트 (실행: node tests/save-folder.test.js)
// js/save-folder.js를 vm에서 돌린다. 고른 폴더는 메모리 속 가짜 FileSystemDirectoryHandle, 브라우저 다운로드는 가짜 <a>로 받는다(실제 파일은 쓰지 않는다).
// 내보내기·백업 자리 15곳은 실제 함수로 돌리고(tests/save-folder-sites.js), 설정 칸의 PC 폴더 연결은 실제 state.js와 함께, index.html·README도 실제 파일로 확인한다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { SITES, runSite } = require('./save-folder-sites');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const fsError = (name, message = name) => Object.assign(new Error(message), { name });
const KEY = 'defaultSaveFolderHandle';

/* ---------- 가짜 폴더 ---------- */
// permission: queryPermission의 답, grant: requestPermission의 답(오류면 던진다), failWrite: 쓸 때 던질 오류,
// move: 다 쓴 파일을 이름만 바꿔 옮기기(FileSystemHandle.move, Chrome 111부터)를 지원하는지, failMove: 옮길 때 던질 오류,
// refuse: 브라우저가 받지 않는 이름인지(받지 않으면 TypeError 'Name is not allowed.'). 쓰는 동안 기다리게 하려면 dir.hold에 Promise를 둔다
function fakeDir(name, { permission = 'granted', grant = 'granted', failWrite = null, move = true, failMove = null, refuse = null } = {}) {
    const files = new Map(); // 이름 → 쓴 내용(Blob). 손으로 넣은 파일은 글자, 만들기만 하고 아직 다 쓰지 않은 파일은 null
    const dir = {
        kind: 'directory', name, files, permission, grant, failWrite, failMove, hold: null,
        modes: [], requests: 0, removed: [], created: [], aborted: 0,
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
            if (refuse?.(child)) throw new TypeError('Name is not allowed.');
            if (!files.has(child)) {
                if (!opts.create) throw fsError('NotFoundError');
                files.set(child, null);
                dir.created.push(child);
            }
            const handle = {
                kind: 'file', name: child,
                async createWritable() {
                    let next = null;
                    return {
                        async write(content) {
                            if (dir.hold) await dir.hold;
                            if (dir.failWrite) throw dir.failWrite;
                            next = content;
                        },
                        async close() { files.set(handle.name, next); },
                        async abort() { dir.aborted += 1; }
                    };
                }
            };
            if (move) {
                handle.move = async newName => {
                    if (dir.failMove) throw dir.failMove;
                    if (refuse?.(newName)) throw new TypeError('Name is not allowed.');
                    files.set(newName, files.get(handle.name));
                    files.delete(handle.name);
                    handle.name = newName;
                };
            }
            return handle;
        },
        async removeEntry(child) {
            dir.removed.push(child);
            files.delete(child);
        }
    };
    if (move === true) dir.move = async () => {}; // FileSystemHandle.prototype에 move가 있으면 폴더 손잡이에도 있다('file'이면 파일 손잡이에만)
    return dir;
}

// Chrome File System Access가 폴더에 쓰지 못하게 막는 이름(IsSafePathComponent: 앞의 점 하나는 받고 나머지에 base::i18n::IsFilenameLegal,
// net::IsReservedNameOnWindows). 어디에나 Cc·Cf·비문자·"*:<>?|\/ 금지, 처음과 끝에 빈칸·'.'·'~' 금지, CON·NUL·COM1… 과 desktop.ini·thumbs.db 금지
function chromiumRefuses(name) {
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) return true;
    const rest = name.startsWith('.') ? name.slice(1) : name;
    if (/["*:<>?|\p{Cc}\p{Cf}\p{Noncharacter_Code_Point}]/u.test(rest)) return true;
    const chars = [...rest];
    if (chars.length && (/[\s.~]/u.test(chars[0]) || /[\s.~]/u.test(chars[chars.length - 1]))) return true;
    return /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(\.|$)/i.test(rest) || /^(desktop\.ini|thumbs\.db)$/i.test(rest);
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
    assert.deepStrictEqual(ctx.toasts, [['수업자료 폴더에 국어_교안.zip 파일을 저장했습니다.', 'success']]);
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
    // 이름 끝 글자와 상관없이 맞는 조사('파일을')
    assert.deepStrictEqual(ctx.toasts.map(([message]) => message), ['수업자료 폴더에 교안 (2).md 파일을 저장했습니다.', '수업자료 폴더에 교안 (3).md 파일을 저장했습니다.', '수업자료 폴더에 README (2) 파일을 저장했습니다.']);
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
    assert.deepStrictEqual(dir.removed, ['a.md.저장중', 'b.md.저장중'], '쓰다 만 빈 파일(다 쓰기 전 이름)을 남기지 않는다');
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
    // 폴더를 지운 것이 아니라 지정을 푼 것이라고 말한다
    assert.deepStrictEqual(ctx.toasts.at(-1), ['기본 저장 폴더 지정을 풀었습니다. 이제 브라우저 기본 다운로드 폴더에 받습니다.', 'success']);
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

// 자리마다 실제 함수를 세 갈래로 돌린다(tests/save-folder-sites.js): 폴더를 골라 둠(새 창처럼 권한을 물어야 하고, ZIP·HTML을 다 만든 뒤에는 묻지 못한다),
// 이 도우미는 있지만 폴더를 고르지 않음, 이 도우미가 없는 옛 스크립트
test('S17 내보내기·백업 자리 15곳: 폴더를 골랐으면 그 폴더에(오래 걸리는 ZIP·HTML·안전 백업도 누를 때 받은 권한으로) 정확한 이름과 내용으로 쓰고 "다운로드"라고 알리지 않으며, 고르지 않았거나 옛 스크립트면 같은 이름·같은 내용으로 내려받는다. kbuilder는 건드리지 않는다', async () => {
    assert.strictEqual(SITES.length, 15);
    for (const site of SITES) {
        for (const mode of ['folder', 'download', 'old']) {
            const label = `${site.id} (${mode})`;
            const { ctx, folder, files, bytes } = await runSite(site, mode);
            const via = mode === 'folder' ? 'folder' : mode === 'old' ? site.old : 'download';
            assert.deepStrictEqual(files.map(file => [file.via, file.name]), [[via, site.name]], label);
            assert.ok(files[0].bytes.equals(bytes), `${label}: 받은 내용 ${files[0].bytes.toString('hex').slice(0, 48)}`);
            if (site.bom) assert.strictEqual(files[0].bytes.subarray(0, 3).toString('hex'), 'efbbbf', `${label}: 엑셀이 한글을 읽게 BOM으로 시작한다`);
            assert.deepStrictEqual(ctx.seen.alerts, [], label);
            const toasts = ctx.seen.toasts.map(([message]) => message);
            if (mode === 'folder') {
                assert.ok(toasts.includes(`수업자료 폴더에 ${site.name} 파일을 저장했습니다.`), `${label}: ${toasts.join(' | ')}`);
                assert.ok(!toasts.some(message => message.includes('다운로드')), `${label}: 폴더에 저장했는데 다운로드했다고 알리지 않는다: ${toasts.join(' | ')}`);
                assert.strictEqual(folder.permission, 'granted', label);
            } else if (site.toast) {
                assert.ok(toasts.some(message => site.toast.test(message)), `${label}: 내려받았으면 예전처럼 알린다: ${toasts.join(' | ')}`);
            }
        }
    }
    const kbuilder = fs.readdirSync(path.join(root, 'js', 'kbuilder')).filter(file => file.endsWith('.js')).map(file => read(`js/kbuilder/${file}`)).join('\n');
    assert.ok(!kbuilder.includes('saveFileToFolder'), 'kbuilder는 이 도우미를 쓰지 않는다');
    assert.ok(read('js/kbuilder/export.js').includes('a.href = url; a.download = filename;'), 'kbuilder 내려받기는 그대로');
});

test('S18 README 주요 기능에 기본 저장 폴더 한 줄', () => {
    const lines = read('README.md').split('\n').filter(line => line.startsWith('- **기본 저장 폴더**'));
    assert.strictEqual(lines.length, 1, '한 줄');
    assert.ok(lines[0].includes('설정') && lines[0].includes('다운로드 폴더') && lines[0].includes('(2)'), lines[0]);
});

/* ---------- 쓰는 동안 창 닫기 ---------- */
test('S19 고른 폴더에 쓰는 동안에는 창을 닫기 전에 묻고(isFolderSavePending), 다 쓸 때까지 "이름.저장중"에 써서 끊겨도 그 이름의 빈 파일이 남지 않는다', async () => {
    const dir = fakeDir('수업자료');
    let finish;
    dir.hold = new Promise(resolve => { finish = resolve; }); // 큰 ZIP을 쓰는 중
    const ctx = makeApp({ stored: dir });
    assert.strictEqual(ctx.isFolderSavePending(), false);
    const zip = new Blob(['PK'.padEnd(4096, 'x')], { type: 'application/zip' });
    const saving = ctx.saveFileToFolder(zip, '과정_과정전체백업_20261108-1030.zip');
    for (let i = 0; i < 10; i += 1) await flush();
    assert.strictEqual(ctx.isFolderSavePending(), true, '쓰는 동안 창을 닫으면 묻는다');
    assert.deepStrictEqual([...dir.files.keys()], ['과정_과정전체백업_20261108-1030.zip.저장중'], '다 쓰기 전에는 백업 이름의 파일이 없다');
    finish();
    const result = await saving;
    assert.deepStrictEqual([...dir.files.keys()], ['과정_과정전체백업_20261108-1030.zip'], '다 쓴 뒤 원래 이름으로 옮긴다');
    assert.strictEqual(dir.files.get('과정_과정전체백업_20261108-1030.zip'), zip);
    assert.deepStrictEqual([result.saved, result.fileName, ctx.isFolderSavePending()], ['folder', '과정_과정전체백업_20261108-1030.zip', false]);
    // 같은 이름이 있으면 ' (2)'도 그대로(임시 이름은 고른 이름 뒤에 붙인다)
    await ctx.saveFileToFolder('PK', '과정_과정전체백업_20261108-1030.zip');
    assert.ok(dir.files.has('과정_과정전체백업_20261108-1030 (2).zip') && dir.files.size === 2, [...dir.files.keys()].join(','));
});

test('S20 옮기기(move)가 없는 브라우저는 그 이름에 바로 쓰고, 옮기지 못하면(Safe Browsing 등) 그 이름에 다시 쓰고 임시 파일을 지운다', async () => {
    const old = fakeDir('수업자료', { move: false });
    const ctx = makeApp({ stored: old });
    await ctx.saveFileToFolder('글', 'a.md');
    assert.deepStrictEqual([old.created, await textOf(old, 'a.md')], [['a.md'], '글'], '임시 파일을 만들지 않는다');
    const blocked = fakeDir('수업자료', { failMove: fsError('AbortError', 'Blocked by Safe Browsing.') });
    const other = makeApp({ stored: blocked });
    const result = await other.saveFileToFolder('글', 'b.md');
    assert.strictEqual(result.saved, 'folder');
    assert.deepStrictEqual([[...blocked.files.keys()], await textOf(blocked, 'b.md')], [['b.md'], '글']);
    assert.deepStrictEqual(blocked.removed, ['b.md.저장중']);
    assert.deepStrictEqual([names(other), warnings(other)], [[], []]);
    // move가 파일 손잡이에만 있는 브라우저(FileSystemFileHandle.prototype.move)도 임시 이름에 쓴 뒤 옮긴다
    const fileOnly = fakeDir('수업자료', { move: 'file' });
    const third = makeApp({ stored: fileOnly });
    third.FileSystemFileHandle = { prototype: { move() {} } };
    await third.saveFileToFolder('글', 'c.md');
    assert.deepStrictEqual([fileOnly.created, [...fileOnly.files.keys()], await textOf(fileOnly, 'c.md')], [['c.md.저장중'], ['c.md'], '글']);
});

/* ---------- 권한 미리 받기 ---------- */
test('S21 오래 걸리는 내보내기는 누른 직후 prepareSaveFolder로 쓰기 권한을 받아 둔다(새 창은 "prompt"). 받았거나 폴더가 없거나 묻지 못해도 던지지 않는다', async () => {
    const dir = fakeDir('수업자료', { permission: 'prompt', grant: 'granted' });
    const ctx = makeApp({ stored: dir });
    await ctx.prepareSaveFolder();
    assert.deepStrictEqual([dir.requests, dir.permission, dir.modes], [1, 'granted', ['readwrite', 'readwrite']], '누른 직후 쓰기 권한을 묻는다');
    await ctx.prepareSaveFolder();
    assert.strictEqual(dir.requests, 1, '받았으면 다시 묻지 않는다');
    await ctx.saveFileToFolder('PK', '교과_교안.zip'); // 다 만든 뒤에는 묻지 않고 쓴다
    assert.deepStrictEqual([await textOf(dir, '교과_교안.zip'), dir.requests], ['PK', 1]);
    const none = makeApp();
    await none.prepareSaveFolder();
    assert.deepStrictEqual([none.toasts, none.alerts], [[], []], '폴더를 고르지 않았으면 아무것도 하지 않는다');
    const late = makeApp({ stored: fakeDir('B', { permission: 'prompt', grant: fsError('SecurityError', 'User activation is required to request permissions.') }) });
    await late.prepareSaveFolder(); // 묻지 못해도 던지지 않는다(저장할 때 다시 보고, 못 쓰면 내려받는다)
    assert.deepStrictEqual(late.toasts, []);
});

/* ---------- Chrome이 막는 이름 ---------- */
test('S22 Chrome이 폴더에 쓰지 못하게 막는 이름(앞 빈칸, ZWJ·ZWSP 같은 서식 글자, CON·NUL 같은 예약 이름, 앞뒤 ~·점)도 고쳐 폴더에 쓴다', async () => {
    const dir = fakeDir('수업자료', { refuse: chromiumRefuses });
    const ctx = makeApp({ stored: dir });
    const cases = [
        [' 파이썬 기초_교안.zip', '파이썬 기초_교안.zip'],
        ['코딩_01차시_🧑‍💻 변수와 자료형.md', '코딩_01차시_🧑_💻 변수와 자료형.md'],
        ['​숨은 글자.md', '_숨은 글자.md'],
        ['CON.md', 'CON_.md'],
        ['nul', 'nul_'],
        ['LPT1.backup.zip', 'LPT1_.backup.zip'],
        ['desktop.ini', 'desktop_.ini'],
        ['~임시 교안~.md', '임시 교안~.md'],
        ['끝에 점...', '끝에 점'],
        ['﷐비문자.md', '_비문자.md']
    ];
    for (const [given] of cases) await ctx.saveFileToFolder('글', given);
    assert.deepStrictEqual([...dir.files.keys()], cases.map(([, saved]) => saved));
    assert.ok([...dir.files.keys()].every(saved => !chromiumRefuses(saved)));
    assert.deepStrictEqual([names(ctx), warnings(ctx)], [[], []], '모두 폴더에 쓴다');
});

test('S23 브라우저가 그래도 이름을 받지 않으면(TypeError) 글자·숫자만 남긴 이름으로 한 번 더 쓰고, 그래도 안 되면 이름 때문이라고 알리며 내려받는다(폴더를 다시 고르라고 하지 않는다)', async () => {
    const dir = fakeDir('수업자료', { refuse: name => /\p{Extended_Pictographic}/u.test(name) }); // 그림 글자를 받지 않는 브라우저라고 친다
    const ctx = makeApp({ stored: dir });
    const result = await ctx.saveFileToFolder('글', '🐍 파이썬.md');
    assert.deepStrictEqual(plain(result), { saved: 'folder', fileName: '_ 파이썬.md', folderName: '수업자료' });
    assert.deepStrictEqual([await textOf(dir, '_ 파이썬.md'), names(ctx), warnings(ctx)], ['글', [], []]);
    const stubborn = makeApp({ stored: fakeDir('수업자료', { refuse: () => true }) });
    const fallback = await stubborn.saveFileToFolder('글', '교안.md');
    assert.deepStrictEqual([fallback.saved, names(stubborn)], ['download', ['교안.md']]);
    const [warning, ...more] = warnings(stubborn);
    assert.ok(warning.includes('파일 이름(교안.md) 때문에') && warning.includes('다운로드 폴더에 받았습니다') && !warning.includes('다시 고를'), warning);
    assert.deepStrictEqual(more, []);
});

/* ---------- 설정 칸의 PC 폴더 연결: 머리줄과 같은 상태 ---------- */
test('S24 설정 칸의 프로젝트 폴더는 머리줄과 같은 상태를 보인다: 멈춤이면 "다시 연결"(새 폴더를 고르지 않고 멈춘 연결을 다시 잇는다)과 "연결 끊기"를 켜고, 저장 실패도 보인다', async () => {
    const ctx = makeApp();
    const calls = [];
    let state = { kind: 'locked', name: '과정 폴더' };
    ctx.folderConnectionState = () => state;
    ctx.reconnectLockedFolder = async () => { calls.push('reconnect'); state = { kind: 'on', name: '과정 폴더' }; };
    ctx.connectProjectFolder = async () => { calls.push('connect'); };
    const el = id => ctx.elements[id];
    const shown = () => [el('settings-project-folder-state').textContent, el('settings-project-folder-connect').textContent, el('settings-project-folder-disconnect').disabled];
    ctx.renderSaveLocationSettings();
    await flush();
    assert.deepStrictEqual(shown(), ['멈춤: 과정 폴더(다시 연결 필요)', '다시 연결', false]);
    await ctx.connectProjectFolderFromSettings();
    assert.deepStrictEqual([calls, shown()], [['reconnect'], ['연결됨: 과정 폴더', '다른 폴더로 바꾸기', false]]);
    state = { kind: 'failed', name: '과정 폴더' };
    ctx.renderSaveLocationSettings();
    assert.deepStrictEqual(shown(), ['저장 실패: 과정 폴더', '다른 폴더로 바꾸기', false]);
    await ctx.connectProjectFolderFromSettings();
    assert.deepStrictEqual(calls, ['reconnect', 'connect'], '저장 실패면 머리줄 띠처럼 다른 폴더를 고른다');
});

// 실제 filename-convention.js·data-safety.js·state.js·save-folder.js를 한 문맥에서 돌린다. 머리줄·띠·설정 칸은 가짜 요소, ctx.db는 IndexedDB 대신.
// 확인 창은 묻기만 하고 취소한다(ctx.confirms)
const STATE_IDS = ['folder-connection-indicator', 'folder-sync-banner', 'folder-sync-banner-text', 'folder-sync-banner-action', ...SETTING_IDS];
function makeStateApp() {
    const elements = Object.fromEntries(STATE_IDS.map(id => [id, Object.assign(fakeElement(id), { innerHTML: '', onclick: null })]));
    elements['folder-sync-banner'].classList.add('hidden');
    const store = new Map();
    const ctx = {
        console: { log() {}, info() {}, warn() {}, error() {} },
        JSON, Date, Map, Set, Promise, Symbol, Uint8Array, Blob, atob, btoa, setTimeout, clearTimeout,
        STORAGE_KEY: 'test-state', INITIAL_MOCK_STATE: { subjects: [] },
        localStorage: { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
        document: { getElementById: id => elements[id] || null, querySelectorAll: () => [], addEventListener() {}, visibilityState: 'visible', body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) },
        addEventListener() {}, location: { hash: '' }, URL: { createObjectURL: () => 'blob:1', revokeObjectURL() {} },
        escapeHtml: value => String(value), toggleFolderDropdown() {}, renderSidebar() {},
        elements, store, db: {}, toasts: [], alerts: [], confirms: []
    };
    ctx.window = ctx;
    ctx.showDirectoryPicker = async () => null;
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showConfirm = (message, onOk, opts = {}) => {
        ctx.confirms.push({ message, opts });
        opts.onCancel?.();
    };
    vm.createContext(ctx);
    ['filename-convention.js', 'data-safety.js', 'state.js', 'save-folder.js'].forEach(file => vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), ctx, { filename: file }));
    const exec = code => vm.runInContext(code, ctx);
    exec(`DBManager.getItem = async key => window.db[key] ?? null; DBManager.setItem = async (key, value) => { window.db[key] = value; }; DBManager.deleteItem = async key => { delete window.db[key]; };
        globalState = sanitizeState({ courseTitle: '과정', subjects: [{ id: 's1', title: '교과', lessons: [] }] }); currentSubjectId = 's1'; courseData = []; contentHistory = [];`);
    return { ctx, exec };
}

// state.js가 읽고 쓰는 PC 폴더(save_data.yaml 같은 글 파일만). 고친 시각은 늘 1
function stateDir(name, permission) {
    const files = new Map();
    const dir = {
        kind: 'directory', name, files, permission, requests: 0,
        async queryPermission() { return dir.permission; },
        async requestPermission() { dir.requests += 1; return dir.permission; },
        async getDirectoryHandle(child, opts = {}) {
            if (!opts.create) throw fsError('NotFoundError');
            return stateDir(child, 'granted');
        },
        async getFileHandle(child, opts = {}) {
            if (!files.has(child)) {
                if (!opts.create) throw fsError('NotFoundError');
                files.set(child, '');
            }
            return {
                kind: 'file', name: child,
                async getFile() {
                    const content = files.get(child);
                    return { size: Buffer.byteLength(content), lastModified: 1, async text() { return content; } };
                },
                async createWritable() {
                    let next = '';
                    return { async write(content) { next = String(content); }, async close() { files.set(child, next); }, async abort() {} };
                }
            };
        },
        async removeEntry(child) { files.delete(child); },
        async *keys() { yield* files.keys(); }
    };
    return dir;
}

test('S25 실제 state.js: 브라우저를 다시 열어 멈춘 PC 폴더 자동 저장을 설정 칸도 "멈춤"으로 보이고, "다시 연결"은 머리줄과 같은 길로(폴더가 더 새것이면 그 경고로) 묻고, "연결 끊기"는 기억한 폴더와 띠를 거둔다', async () => {
    // 1) 새로 연 창: 기억한 폴더의 권한이 'prompt'(Chrome은 창을 다시 열면 다시 묻는다)
    const { ctx, exec } = makeStateApp();
    const el = id => ctx.elements[id];
    const shown = () => [el('settings-project-folder-state').textContent, el('settings-project-folder-connect').textContent, el('settings-project-folder-disconnect').disabled];
    ctx.db.projectFolderHandle = stateDir('과정 폴더', 'prompt');
    await ctx.restoreProjectFolderConnection();
    assert.ok(el('folder-connection-indicator').innerHTML.includes('과정 폴더 (눌러서 다시 연결)'), '머리줄은 멈춤');
    ctx.renderSaveLocationSettings();
    await flush();
    assert.deepStrictEqual(shown(), ['멈춤: 과정 폴더(다시 연결 필요)', '다시 연결', false]);
    await ctx.disconnectProjectFolderFromSettings();
    assert.strictEqual(ctx.db.projectFolderHandle, undefined, '기억한 폴더를 잊는다');
    assert.ok(el('folder-sync-banner').classList.contains('hidden'), "띠의 '다시 연결'이 잊은 폴더를 다시 잇지 않게 띠를 거둔다");
    assert.ok(el('folder-connection-indicator').innerHTML.includes('PC 폴더 저장 꺼짐'));
    assert.deepStrictEqual(shown(), ['연결 안 됨', '폴더 연결', true]);
    assert.strictEqual(exec('folderConnectionState().kind'), 'off');

    // 2) 지난번에 브라우저에 저장하지 못한 작업이 폴더에만 있어(폴더가 더 새것) 멈췄다
    const behind = makeStateApp();
    const saved = 'state:\n  courseTitle: "폴더의 새 작업"\n  subjects: []\n';
    const folder = stateDir('과정 폴더', 'granted');
    folder.files.set('save_data.yaml', saved);
    behind.ctx.store.set('teacher:folder-save-stamp', JSON.stringify({ name: '과정 폴더', size: Buffer.byteLength(saved), modified: 1, browserBehind: true }));
    behind.ctx.db.projectFolderHandle = folder;
    await behind.ctx.restoreProjectFolderConnection();
    behind.ctx.renderSaveLocationSettings();
    await flush();
    const settingState = () => behind.ctx.elements['settings-project-folder-state'].textContent;
    assert.strictEqual(settingState(), '멈춤: 과정 폴더(다시 연결 필요)');
    await behind.ctx.connectProjectFolderFromSettings(); // 설정의 '다시 연결'
    const asked = behind.ctx.confirms.at(-1);
    assert.strictEqual(asked?.opts.title, '폴더에 더 새 작업이 있습니다', '일반 덮어쓰기 질문이 아니라 폴더가 더 새것이라고 묻는다');
    assert.ok(asked.message.includes('이 브라우저에 저장하지 못한 작업이 들어 있어'), asked.message);
    assert.deepStrictEqual([behind.exec('projectFolderHandle'), settingState(), folder.files.get('save_data.yaml')], [null, '멈춤: 과정 폴더(다시 연결 필요)', saved], '취소하면 멈춘 채로 두고 덮어쓰지 않는다');

    // 3) 이어 두었지만 저장이 실패했으면 머리줄처럼 '저장 실패'
    behind.ctx.otherDir = stateDir('새 폴더', 'granted');
    behind.exec("useLinkedFolder(window.otherDir); markFolderSyncFailed(new Error('쓰지 못했습니다'));");
    behind.ctx.renderSaveLocationSettings();
    assert.strictEqual(settingState(), '저장 실패: 새 폴더');
    assert.strictEqual(behind.ctx.elements['settings-project-folder-disconnect'].disabled, false);
});

test("S26 내보내기 메뉴에서 '빼기'를 고르고 ZIP을 누른 뒤 권한 창이 떠 있는 동안 메뉴 밖을 눌러도 그 ZIP은 그림을 뺀다(권한을 묻기 전에 그림 담기를 정한다)", async () => {
    const base = SITES.find(site => site.id === 'ui.js exportAllToZip');
    const site = {
        ...base,
        setup: (ctx, exec, activation, folder) => {
            base.setup(ctx, exec, activation, folder);
            ctx.setBackupImageMode('none'); // 메뉴에서 '빼기'
            const ask = folder.requestPermission;
            folder.requestPermission = async () => {
                ctx.clearBackupImagesDrop(); // 권한 창이 떠 있는 동안 메뉴 밖을 눌렀다(data-safety.js의 잡기 단계 click)
                return ask();
            };
        }
    };
    const { files } = await runSite(site, 'folder');
    assert.deepStrictEqual(files.map(file => [file.via, file.name]), [['folder', '파이썬_전체교안_그림없음.zip']]);
});

test('S27 교과 MD 내보내기: 차시는 있는데 내용이 든 차시가 없으면 파일을 만들지 않고 내보낼 내용이 없다고 알린다. 빈 차시가 섞이면 내용이 든 차시만 받고, 폴더·다운로드 알림은 받은 파일대로 낸다', async () => {
    const base = SITES.find(site => site.id === 'ui.js exportSubjectToMD');
    const empty = { ...base, setup: (ctx, ...rest) => { base.setup(ctx, ...rest); ctx.lessonTabSources = () => []; } };
    const mixed = {
        ...base,
        setup: (ctx, ...rest) => {
            base.setup(ctx, ...rest);
            const tabs = ctx.lessonTabSources;
            ctx.globalState.subjects[0].lessons.push({ id: 2, title: '빈 차시', content: '', tabContents: {}, images: {} });
            ctx.lessonTabSources = mod => (mod.id === 2 ? [] : tabs(mod));
        }
    };
    for (const mode of ['folder', 'download', 'old']) {
        const none = await runSite(empty, mode);
        assert.deepStrictEqual(none.files, [], `${mode}: 파일을 만들지 않는다`);
        assert.deepStrictEqual([none.ctx.seen.alerts, none.ctx.seen.toasts], [['내보낼 교안 내용이 없습니다. 교안을 먼저 생성해주세요.'], []], `${mode}: 아무 말 없이 끝나지 않는다`);
        if (none.folder) assert.strictEqual(none.folder.requests, 0, '저장할 파일이 없으면 폴더 권한을 묻지 않는다');
        const some = await runSite(mixed, mode);
        assert.deepStrictEqual(some.files.map(file => [file.via, file.name]), [[mode === 'folder' ? 'folder' : 'download', base.name]], mode);
        assert.deepStrictEqual(some.ctx.seen.alerts, [], mode);
        const toasts = some.ctx.seen.toasts.map(([message]) => message);
        assert.deepStrictEqual(toasts, mode === 'folder' ? [`수업자료 폴더에 ${base.name} 파일을 저장했습니다.`] : ['📁 1개 차시 MD 파일 다운로드'], `${mode}: ${toasts.join(' | ')}`);
    }
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
