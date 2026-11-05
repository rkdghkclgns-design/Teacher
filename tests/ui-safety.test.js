// 확인 창·Ctrl+S·창 닫기·교과 백업 ZIP·브라우저 저장 테스트 (실행: node tests/ui-safety.test.js)
// 실제 js/data-safety.js·js/ui.js를 vm에서 실행한다. state.js는 저장 부분(DBManager, saveState, isSavePending)만 떼어 가짜 IndexedDB로 돌린다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const js = file => fs.readFileSync(path.join(root, 'js', file), 'utf8');

let clock = 1000;
class FakeDate extends Date { static now() { return clock; } }
const tick = ms => { clock += ms; };
const flush = () => new Promise(resolve => setImmediate(resolve));

function fakeOverlay() {
    const buttons = {};
    return {
        className: '', innerHTML: '', isConnected: false, onclick: null, dataset: {},
        querySelector(sel) { return buttons[sel] || (buttons[sel] = { onclick: null, click() { this.onclick?.(); } }); },
        remove() { this.isConnected = false; }
    };
}
class FakeZip {
    constructor() { this.files = {}; }
    file(name, data) { this.files[name] = data; return this; }
    folder(name) { return { file: (n, d) => this.file(`${name}/${n}`, d), folder: n => this.folder(`${name}/${n}`) }; }
    async generateAsync() { return 'blob'; }
}

function loadUi() {
    const storage = {};
    const seen = { listeners: {}, appended: [], saved: [], toasts: [], alerts: [] };
    const subject = { id: 's1', title: '교과', lessons: [{ id: 1, title: 'A', tabContents: { basicLearn: '글' }, images: {} }] };
    const ctx = {
        console: { log() {}, warn() {}, error() {} }, JSON, Map, Set, Promise, Date: FakeDate,
        localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
        addEventListener: (type, fn) => { seen.listeners[type] = fn; },
        location: { hash: '#editor/s1' },
        document: {
            addEventListener() {}, getElementById: () => null, querySelector: () => null,
            querySelectorAll: sel => ctx.queried?.(sel) || [],
            createElement: () => fakeOverlay(),
            body: { appendChild: el => { el.isConnected = true; seen.appended.push(el); } },
            activeElement: null
        },
        JSZip: FakeZip, saveAs: (blob, name) => seen.saved.push(name),
        uniqueFileBase: base => base, lessonFileBase: mod => `L${mod.id}`, lessonGyosuanFiles: () => [], zipImageParts: () => ({}), lessonHtmlForZip: async () => null,
        globalState: { courseTitle: '과정', subjects: [subject] }, currentSubjectId: 's1', courseData: subject.lessons
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(js('data-safety.js'), ctx);
    vm.runInContext(js('ui.js'), ctx);
    ctx.showToast = (text, type) => seen.toasts.push([text, type]);
    ctx.showAlert = text => seen.alerts.push(text);
    return { ctx, storage, seen };
}

// state.js의 저장 부분만 떼어 가짜 IndexedDB로 돌린다. 떼어 낸 함수가 쓰는 이름은 여기서 둔다(묶음 3·6이 넣은 이름 포함)
function loadSaving({ pendingSoon = false } = {}) {
    const src = js('state.js').replace(/\r\n/g, '\n');
    const slice = (head, tail) => { const start = src.indexOf(head); const end = src.indexOf(tail, start); assert.ok(start >= 0 && end > start, head); return src.slice(start, end + tail.length); };
    const txs = [];
    const db = { objectStoreNames: { contains: () => true }, transaction() { const tx = { objectStore: () => ({ put() {} }) }; txs.push(tx); return tx; } };
    const alerts = [];
    const ctx = {
        console: { log() {}, warn() {}, error() {} }, Promise, setImmediate,
        indexedDB: { open() { const req = {}; setImmediate(() => req.onsuccess({ target: { result: db } })); return req; } },
        window: { showAlert: text => alerts.push(text) }
    };
    vm.createContext(ctx);
    vm.runInContext(`const STORAGE_KEY = 'state'; let globalState = { subjects: [] }; let contentHistory = []; let currentSubjectId = null; let courseData = [];
        const _stateTabs = null; let projectFolderHandle = null; let stateLoadFailed = false; function showStateLoadFailedDialog() {}
        let lastBrowserSaveFailed = false;
        const saveSoonTask = { cancel() {}, pending: () => ${pendingSoon} };
        ${slice('const DBManager = {', '\n};\n')}
        ${slice('async function saveState(', '\n}\n')}
        ${slice('function isSavePending(', '\n}\n')}`, ctx);
    return { ctx, txs, alerts };
}

let failed = 0;
let count = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

test('확인 창: 겹쳐도 각 창의 버튼은 그 창만 움직인다', () => {
    const { ctx, seen } = loadUi();
    const log = [];
    ctx.showConfirm('A', () => log.push('A'));
    ctx.showConfirm('B', () => log.push('B'));
    const [a, b] = seen.appended;
    tick(600);
    b.querySelector('[data-confirm-ok]').click();
    assert.deepStrictEqual(log, ['B']);
    assert.deepStrictEqual([a.isConnected, b.isConnected], [true, false], '위 창만 닫히고 아래 창은 남는다');
    a.querySelector('[data-confirm-ok]').click();
    assert.deepStrictEqual(log, ['B', 'A'], '아래 창의 버튼은 아래 창의 일을 한다');
    assert.strictEqual(a.isConnected, false);
    assert.strictEqual(a.dataset.appDialog, '', '읽지 못한 저장본 창이 뒤를 막아도 누를 수 있다(state.js)');
});

test('확인 창: 같은 확인은 하나만 뜨고 둘째는 취소로 끝난다(두 번 누른 되돌리기·삭제)', async () => {
    const { ctx, seen } = loadUi();
    const ask = () => ctx.confirmAsync('같은 질문', { title: 'T', okLabel: '만들기' });
    const first = ask();
    const second = ask();
    assert.strictEqual(seen.appended.length, 1);
    assert.strictEqual(await second, false, '둘째는 취소로 끝난다');
    tick(600);
    seen.appended[0].querySelector('[data-confirm-ok]').click();
    assert.strictEqual(await first, true);
    ask();
    assert.strictEqual(seen.appended.length, 2, '닫힌 뒤에는 같은 확인 창이 다시 뜬다(차례로 묻는 흐름은 막지 않는다)');
    seen.appended[1].remove(); // 다른 코드가 지운 창
    ask();
    assert.strictEqual(seen.appended.length, 3, '다른 코드가 지운 창은 막지 않는다');
    ctx.confirmAsync('같은 질문', { title: 'T', okLabel: '다른 버튼' });
    ctx.confirmAsync('다른 질문', { title: 'T', okLabel: '만들기' });
    assert.strictEqual(seen.appended.length, 5, '제목·글·버튼 이름이 하나라도 다르면 따로 뜬다');
    let cancelled = 0;
    ctx.showConfirm('삭제할까요?', () => {}, { onCancel: () => { cancelled += 1; } });
    ctx.showConfirm('삭제할까요?', () => { throw new Error('둘째 확인은 하지 않는다'); }, { onCancel: () => { cancelled += 1; } });
    assert.deepStrictEqual([seen.appended.length, cancelled], [6, 1]);
});

test('확인 창: 막 뜬 창의 클릭은 받지 않고, 취소 버튼 이름과 바깥 클릭을 정할 수 있다', () => {
    const { ctx, seen } = loadUi();
    let oks = 0;
    let cancels = 0;
    ctx.showConfirm('C', () => { oks += 1; }, { onCancel: () => { cancels += 1; }, cancelLabel: '<b>' });
    const c = seen.appended[0];
    assert.ok(c.innerHTML.includes('&lt;b&gt;'), '취소 버튼 이름도 이스케이프한다');
    c.onclick();
    c.querySelector('[data-confirm-cancel]').click();
    c.querySelector('[data-confirm-ok]').click();
    assert.deepStrictEqual([oks, cancels, c.isConnected], [0, 0, true], '두 번 누른 클릭의 둘째는 막 뜬 창을 닫거나(바깥·취소 버튼) 확인하지 않는다');
    tick(600);
    c.onclick();
    assert.deepStrictEqual([oks, cancels, c.isConnected], [0, 1, false], '바깥을 누르면 취소');
    ctx.showConfirm('E', () => { oks += 1; }, { dismissible: false, onCancel: () => { cancels += 1; } });
    const e = seen.appended[1];
    e.querySelector('[data-confirm-cancel]').click();
    assert.deepStrictEqual([oks, cancels, e.isConnected], [0, 1, true], '버리면 다시 볼 수 없는 결과를 묻는 창도 막 떴을 때는 버리기를 받지 않는다');
    tick(600);
    e.onclick();
    assert.deepStrictEqual([oks, cancels, e.isConnected], [0, 1, true], 'dismissible: false면 바깥을 눌러도 닫지 않는다');
    e.querySelector('[data-confirm-cancel]').click();
    assert.deepStrictEqual([oks, cancels, e.isConnected], [0, 2, false], '취소 버튼으로 닫는다');
    ctx.showConfirm('D', () => {}, { cancelLabel: '버리기' });
    assert.ok(seen.appended[2].innerHTML.includes('>버리기<'));
    ctx.showConfirm('F', () => {});
    assert.ok(seen.appended[3].innerHTML.includes('>취소<'), '기본 취소 버튼 이름');
});

test('Ctrl+S 판별: 한글 입력 상태(키 위치)와 Cmd+S도, Shift·Alt가 섞이면 아니다', () => {
    const { ctx } = loadUi();
    const is = ctx.isSaveShortcut;
    [{ ctrlKey: true, code: 'KeyS', key: 'ㄴ' }, { metaKey: true, code: 'KeyS', key: 's' }, { ctrlKey: true, key: 'S' }].forEach(e => assert.strictEqual(is(e), true, JSON.stringify(e)));
    [{ ctrlKey: true, shiftKey: true, code: 'KeyS' }, { ctrlKey: true, altKey: true, code: 'KeyS' }, { code: 'KeyS', key: 's' }, { ctrlKey: true, code: 'KeyA', key: 'a' }]
        .forEach(e => assert.strictEqual(is(e), false, JSON.stringify(e)));
});

test('Ctrl+S: 원문 칸을 먼저 넣고 저장이 끝난 뒤 실제 결과를 알린다', async () => {
    const { ctx, seen } = loadUi();
    const order = [];
    ctx.flushVisibleRawView = () => order.push('raw');
    ctx.saveGyosuanRaw = async () => order.push('gyosuan');
    ctx.saveState = async () => { order.push('state'); return true; };
    await ctx.saveNow();
    assert.deepStrictEqual(order, ['raw', 'gyosuan', 'state']);
    assert.deepStrictEqual(seen.toasts.at(-1), ['저장했습니다.', 'success']);
    ctx.saveState = async () => false;
    await ctx.saveNow();
    assert.strictEqual(seen.toasts.at(-1)[1], 'error');
    assert.ok(seen.toasts.at(-1)[0].startsWith('브라우저에 저장하지 못했습니다.'), seen.toasts.at(-1)[0]);
    ctx.saveState = async () => true;
    ctx.hasPendingGyosuanRaw = () => true;
    const toasts = seen.toasts.length;
    await ctx.saveNow();
    assert.ok(seen.alerts.at(-1).startsWith('저장했습니다. 다만 교수안 원문 칸의 글은 넣지 않았습니다(다른 브라우저 탭에서 이 차시를 고쳤습니다).'), seen.alerts.at(-1));
    assert.strictEqual(seen.toasts.length, toasts, '그때는 저장했다는 알림을 따로 띄우지 않는다');
    ctx.hasPendingGyosuanRaw = () => false;
    let blurred = 0;
    const blur = () => { blurred += 1; };
    ctx.document.activeElement = { closest: s => (s === '.para-edit' ? {} : null), blur };
    await ctx.saveNow();
    assert.strictEqual(blurred, 1, '단락 편집 상자는 벗어나게 해서 저장한다');
    ctx.document.activeElement = { closest: () => null, isContentEditable: true, blur };
    await ctx.saveNow();
    assert.strictEqual(blurred, 2, '고칠 수 있는 글(contenteditable)도');
    ctx.document.activeElement = { id: 'subject-title', closest: () => null, isContentEditable: false, matches: s => s === '[onblur], [onchange]', blur };
    await ctx.saveNow();
    assert.strictEqual(blurred, 3, '칸을 벗어날 때 저장하는 입력칸(교과 이름 등)도');
    ctx.document.activeElement = { id: 'raw-view', closest: () => null, matches: () => true, blur };
    await ctx.saveNow();
    ctx.document.activeElement = { id: 'gyosuan-raw', closest: () => null, matches: () => true, blur };
    await ctx.saveNow();
    assert.strictEqual(blurred, 3, '원문 칸 둘은 여기서 넣으므로 커서를 그대로 둔다');
    ctx.document.activeElement = null;
    let dialogs = 0;
    ctx.isStateLoadFailed = () => true;
    ctx.showStateLoadFailedDialog = () => { dialogs += 1; };
    order.length = 0;
    await ctx.saveNow();
    assert.deepStrictEqual([dialogs, order.length], [1, 0], '읽지 못한 동안은 아무것도 넣거나 저장하지 않고 그 창을 연다');
});

test('Ctrl+S: 누르고 있어도 한 번만 저장하고, 브라우저의 저장 창은 늘 막는다', async () => {
    const { ctx, seen } = loadUi();
    // ui.js의 단축키 처리(DOMContentLoaded 안)만 떼어 이 문맥에 건다
    const ui = js('ui.js').replace(/\r\n/g, '\n');
    const start = ui.indexOf("document.addEventListener('keydown'");
    const end = ui.indexOf('\n    });\n', start);
    assert.ok(start >= 0 && end > start, 'ui.js의 단축키 처리를 찾지 못함');
    let onKey = null;
    ctx.document.addEventListener = (type, fn) => { if (type === 'keydown') onKey = fn; };
    vm.runInContext(ui.slice(start, end + '\n    });'.length), ctx);
    let saves = 0;
    ctx.saveNow = async () => { saves += 1; };
    let prevented = 0;
    const press = extra => onKey({ ctrlKey: true, code: 'KeyS', key: 'ㄴ', preventDefault() { prevented += 1; }, ...extra });
    press({});
    press({ repeat: true });
    await flush();
    assert.deepStrictEqual([saves, prevented], [1, 2]);
    ctx.saveNow = async () => { throw new Error('깨짐'); };
    press({});
    await flush();
    assert.deepStrictEqual(seen.toasts.at(-1), ['저장하지 못했습니다. 잠시 뒤 다시 Ctrl+S를 눌러 주세요.', 'error'], '저장 중 오류도 알린다');
});

test('창 닫기: 넣지 않은 글이나 끝나지 않은 저장이 있을 때만 묻는다', () => {
    const { ctx, seen } = loadUi();
    const onUnload = seen.listeners.beforeunload;
    assert.strictEqual(typeof onUnload, 'function', '창 닫기 경고를 건다');
    const ev = () => ({ preventDefault() { this.prevented = true; } });
    let flushed = 0;
    ctx.flushVisibleRawView = () => { flushed += 1; };
    const clean = ev();
    onUnload(clean);
    assert.deepStrictEqual([!!clean.prevented, flushed], [false, 1], '넣을 것도 저장 중인 것도 없으면 묻지 않는다');
    ctx.isSavePending = () => true;
    const saving = ev();
    onUnload(saving);
    assert.deepStrictEqual([saving.prevented, saving.returnValue], [true, true]);
    ctx.isSavePending = () => false;
    ctx.hasPendingGyosuanRaw = () => true;
    const gyosuan = ev();
    onUnload(gyosuan);
    assert.strictEqual(gyosuan.prevented, true, '교수안 원문 칸에 넣지 못한 글');
    ctx.hasPendingGyosuanRaw = () => false;
    ctx.hasPendingRawEdit = () => true;
    const raw = ev();
    onUnload(raw);
    assert.strictEqual(raw.prevented, true, '교안 원문 칸에 넣지 못한 글');
    ctx.hasPendingRawEdit = () => false;
    ctx.isAiResultPending = () => true;
    const ai = ev();
    onUnload(ai);
    assert.strictEqual(ai.prevented, true, '아래 AI 명령줄에 보낸 명령의 결과를 기다리거나 아직 넣지 않았다(버리면 다시 볼 수 없다)');
    ctx.isAiResultPending = () => false;
    let soon = true;
    ctx.isSavePending = () => soon;
    ctx.flushSaveStateSoon = () => { soon = false; };
    const deferred = ev();
    onUnload(deferred);
    assert.strictEqual(deferred.prevented, true, '미뤄 둔 저장(참고자료 칸)을 막 시작했으면 묻는다');
    ctx.isStateLoadFailed = () => true;
    ctx.isSavePending = () => true;
    const unread = ev();
    onUnload(unread);
    assert.strictEqual(!!unread.prevented, false, '저장본을 읽지 못한 동안은 묻지 않는다');
});

test('교과 백업 ZIP: 편집 중에는 지금 교과, 개요에서는 고른 교과(고르지 않으면 모든 교과)', () => {
    const { ctx } = loadUi();
    const calls = [];
    ctx.exportAllToZip = () => calls.push('current');
    ctx.exportSelectedToZip = () => calls.push('selected');
    const box = { checked: true, dataset: { subjId: 's1' } };
    ctx.queried = sel => [box];
    ctx.location.hash = '#editor/s1';
    ctx.smartZipExport();
    ctx.location.hash = '#overview';
    ctx.smartZipExport();
    assert.deepStrictEqual(calls, ['current', 'selected']);
    const unchecked = { checked: false, dataset: { subjId: 's1' } };
    ctx.queried = sel => (sel.includes(':checked') ? [] : [unchecked]);
    ctx.smartZipExport();
    assert.deepStrictEqual([calls.at(-1), unchecked.checked], ['selected', true], '개요에서 고르지 않았으면 모든 교과를 골라 받는다');
});

test('교과 백업 ZIP은 마지막 전체 백업 시각을 바꾸지 않는다(과정 전체 백업만 센다)', async () => {
    const { ctx, storage, seen } = loadUi();
    ctx.queried = sel => (sel.includes(':checked') ? [{ dataset: { subjId: 's1' } }] : []);
    await ctx.exportSelectedToZip();
    await ctx.exportAllToZip();
    assert.strictEqual(seen.saved.length, 2, seen.alerts.join('|'));
    assert.ok(!('teacher:last-full-backup-at' in storage) && !('teacher:last-backup-at' in storage), JSON.stringify(storage));
    assert.ok(seen.toasts.some(([text, type]) => text.includes('ZIP으로 다운로드') && type === 'success'));
    ctx.finishBackupDownload({ mode: 'separate' });
    assert.ok(storage['teacher:last-full-backup-at'], '그림을 담은 과정 전체 백업은 새 열쇠에 시각을 남긴다');
    assert.ok(!('teacher:last-backup-at' in storage), '예전 열쇠는 다시 쓰지 않는다');
});

test('브라우저 저장: 트랜잭션이 끝나야 성공, 쓰는 동안은 저장 중', async () => {
    const { ctx, txs, alerts } = loadSaving();
    const done = vm.runInContext('saveState()', ctx);
    assert.strictEqual(vm.runInContext('isSavePending()', ctx), true, '부른 즉시 저장 중');
    await flush(); await flush();
    let settled = false;
    done.then(() => { settled = true; });
    await flush();
    assert.strictEqual(settled, false, '넣기 요청만으로는 끝나지 않는다');
    txs[0].oncomplete();
    assert.strictEqual(await done, true);
    assert.strictEqual(vm.runInContext('isSavePending()', ctx), false);
    const failing = vm.runInContext('saveState()', ctx);
    await flush(); await flush();
    txs[1].error = new Error('QuotaExceededError');
    txs[1].onabort({ target: txs[1] });
    assert.strictEqual(await failing, false, '공간이 모자라 취소되면 false');
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(vm.runInContext('DBManager.writing', ctx), 0, '실패해도 저장 중 수를 되돌린다');
    assert.strictEqual(vm.runInContext('isSavePending()', ctx), true, '마지막 브라우저 저장이 실패했으면 그 뒤 바뀐 내용은 아직 브라우저에 없어 창을 닫기 전에 묻는다');
    const again = vm.runInContext('saveState()', ctx);
    await flush(); await flush();
    txs[2].oncomplete();
    assert.strictEqual(await again, true);
    assert.strictEqual(vm.runInContext('isSavePending()', ctx), false, '다시 저장하면 묻지 않는다');
    assert.strictEqual(vm.runInContext('isSavePending()', loadSaving({ pendingSoon: true }).ctx), true, '미뤄 둔 저장도 센다');
});

test('소스: 머리줄 백업 시각은 과정 전체 백업을 받고, 옛 확인 버튼 id·Ctrl+S 글자 판별·원문 칸 따로 저장이 없다', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const ui = js('ui.js');
    const md = js('md-toolbar.js');
    assert.ok(/id="last-backup-indicator" onclick="exportAllModules\(\)"/.test(html));
    assert.ok(/>전체 백업 기록 없음<\/button>/.test(html), '처음 보이는 글도 전체 백업(기록이 없다고 말하고, 안 했다고 하지 않는다)');
    assert.ok(!ui.includes('btn-confirm-ok'), '확인 버튼은 그 창 안에서 찾는다');
    assert.ok(!ui.includes('recordBackupTime('), '교과 백업 ZIP은 백업 시각을 남기지 않는다');
    assert.ok(!ui.includes("e.key === 's'"));
    assert.ok(ui.includes('isSaveShortcut(e)') && ui.includes("addEventListener('beforeunload', warnBeforeUnload)"));
    assert.ok(!md.includes("event.code === 'KeyS'"), '원문 칸의 Ctrl+S도 문서의 단축키가 맡는다');
});

(async () => {
    for (const { name, fn } of pending) {
        count++;
        try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
    }
    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
