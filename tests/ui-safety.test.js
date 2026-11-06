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

// 앱 창 하나를 흉내 낸다. innerHTML에 있는 [data-…] 칸만 찾고(같은 고른 글이면 같은 칸), 찾은 차례가 곧 화면 차례(Tab 순서)다.
// 포커스는 doc.activeElement에 남긴다
function fakeOverlay(doc) {
    const parts = new Map();
    const overlay = {
        className: '', innerHTML: '', isConnected: false, onclick: null, dataset: {},
        querySelector(sel) {
            if (!overlay.innerHTML.includes(sel.replace(/^\[|\]$/g, ''))) return null;
            if (!parts.has(sel)) parts.set(sel, fakePart(doc, overlay));
            return parts.get(sel);
        },
        // 창·제목·글과 본문(tabindex -1)은 Tab으로 가지 않는다
        querySelectorAll: () => [...parts].filter(([sel]) => !/^\[data-(app-dialog|modal-body)/.test(sel)).map(([, part]) => part),
        contains: el => el === overlay || [...parts.values()].includes(el),
        remove() { this.isConnected = false; }
    };
    return overlay;
}
function fakePart(doc, overlay) {
    return {
        id: '', value: '', attributes: {}, onclick: null, onkeydown: null,
        get isConnected() { return overlay.isConnected; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        querySelector: sel => overlay.querySelector(sel),
        querySelectorAll: sel => overlay.querySelectorAll(sel),
        contains: el => overlay.contains(el),
        getClientRects: () => [{}],
        focus() { doc.activeElement = this; },
        click() { this.onclick?.(); }
    };
}
// 키보드 이벤트 흉내. 막은 횟수를 센다
const keyEvent = (key, extra = {}) => ({ key, stopped: 0, prevented: 0, stopPropagation() { this.stopped += 1; }, preventDefault() { this.prevented += 1; }, ...extra });
const plain = value => JSON.parse(JSON.stringify(value));
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
            createElement: () => fakeOverlay(ctx.document),
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

// state.js의 저장 부분만 떼어 가짜 IndexedDB로 돌린다. 떼어 낸 함수가 쓰는 이름은 여기서 둔다(묶음 3·6이 넣은 이름 포함, 큰 작업을 JSON 파일로 쓰는 writeBrowserState도)
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
        let _stateForeignSaves = 0; let _stateForeignSeen = 0; let _stateOverwriteAsk = null;
        ${slice('const STATE_OVERWRITE_TEXT', ';\n')}
        ${slice('function allowStateOverwrite(', '\n}\n')}
        const saveSoonTask = { cancel() {}, pending: () => ${pendingSoon} };
        ${slice('const DBManager = {', '\n};\n')}
        ${slice('const STATE_BLOB_MIN_BYTES', ';\n')}
        ${slice('function storedSizeEstimate(', '\n}\n')}
        ${slice('const isValueTooLarge', ';\n')}
        ${slice('let browserStateAsFile', ';\n')}
        ${slice('async function writeBrowserState(', '\n}\n')}
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

// loadUi는 showAlert를 기록용으로 바꿔 둔다. 진짜 알림 창은 window.alert(ui.js가 showAlert로 바꿔 둔다)로 연다
test('앱 창: 알림·내용 보기도 막 뜬 창의 클릭은 받지 않고, 모든 창이 창 이름표(role·aria-modal·aria-labelledby)를 단다', () => {
    const { ctx, seen } = loadUi();
    ctx.alert('알림 <b>글</b>');
    const alert = seen.appended[0];
    assert.ok(alert.innerHTML.includes('알림 &lt;b&gt;글&lt;/b&gt;'), '알림 글은 이스케이프한다');
    alert.onclick();
    alert.querySelector('[data-alert-ok]').click();
    assert.strictEqual(alert.isConnected, true, '두 번 누른 클릭의 둘째가 막 뜬 알림을 닫지 않는다(바깥·확인 버튼)');
    tick(600);
    alert.querySelector('[data-alert-ok]').click();
    assert.strictEqual(alert.isConnected, false);
    ctx.showModal('기록: <i>제목</i>', '<p>내용</p>');
    const modal = seen.appended[1];
    assert.ok(modal.innerHTML.includes('기록: <i>제목</i>'), '내용 보기 제목은 부르는 쪽이 이스케이프한 HTML 그대로');
    modal.onclick();
    modal.querySelector('[data-modal-close]').click();
    assert.strictEqual(modal.isConnected, true, '내용 보기 창도 막 뜬 동안은 닫지 않는다');
    tick(600);
    modal.onclick();
    assert.strictEqual(modal.isConnected, false, '바깥을 누르면 닫는다');
    ctx.showConfirm('지울까요?', () => {}, { title: '지우기' });
    const confirmBox = seen.appended[2];
    const named = (box, role, label, described) => {
        const panel = box.querySelector('[data-app-dialog-panel]');
        assert.strictEqual(box.dataset.appDialog, '', '읽지 못한 저장본 창이 뒤를 막아도 누를 수 있다(state.js)');
        assert.deepStrictEqual([panel.attributes.role, panel.attributes['aria-modal'], panel.attributes.tabindex], [role, 'true', '-1']);
        assert.ok(label.id && panel.attributes['aria-labelledby'] === label.id, '창 이름은 제목(없으면 글)');
        assert.strictEqual(panel.attributes['aria-describedby'], described ? described.id : undefined);
    };
    named(alert, 'alertdialog', alert.querySelector('[data-app-dialog-text]'), null);
    named(modal, 'dialog', modal.querySelector('[data-app-dialog-title]'), null);
    named(confirmBox, 'alertdialog', confirmBox.querySelector('[data-app-dialog-title]'), confirmBox.querySelector('[data-app-dialog-text]'));
    assert.notStrictEqual(alert.querySelector('[data-app-dialog-text]').id, confirmBox.querySelector('[data-app-dialog-text]').id, '창마다 다른 id');
    assert.deepStrictEqual(['appModal' in modal.dataset, 'appModal' in alert.dataset, 'appModal' in confirmBox.dataset], [true, false, false], '내용 보기 창만 closeAppModal이 닫는 표시를 단다');
});

test('앱 창 키보드: Esc는 맨 위 창만 닫고(확인 창은 취소) 다른 처리로 넘기지 않는다. 막 뜬 창·닫지 않는 창·누르고 있는 키·한글 조합 중에는 닫지 않는다', () => {
    const { ctx, seen } = loadUi();
    const onKey = seen.listeners.keydown;
    assert.strictEqual(typeof onKey, 'function', '창 틀의 키 처리는 window에 건다(문서의 단축키 처리보다 먼저)');
    const reasons = [];
    ctx.showConfirm('아래', () => {}, { onCancel: reason => reasons.push(`아래:${reason}`) });
    ctx.showConfirm('위', () => {}, { onCancel: reason => reasons.push(`위:${reason}`) });
    const [below, above] = seen.appended;
    const early = keyEvent('Escape');
    onKey(early);
    assert.deepStrictEqual([above.isConnected, early.stopped, early.prevented], [true, 1, 1], '막 뜬 창은 Esc를 받지 않지만 아래 창·다른 화면으로도 넘기지 않는다');
    tick(600);
    const composing = keyEvent('Escape', { isComposing: true });
    onKey(composing);
    assert.deepStrictEqual([above.isConnected, composing.stopped, composing.prevented], [true, 0, 0], '한글 조합 중의 Esc는 조합에 맡긴다(전파도 막지 않는다)');
    const held = keyEvent('Escape', { repeat: true });
    onKey(held);
    assert.deepStrictEqual([above.isConnected, held.stopped], [true, 1], '누르고 있는 Esc는 겹친 창을 잇달아 닫지 않는다');
    const esc = keyEvent('Escape');
    onKey(esc);
    assert.deepStrictEqual([above.isConnected, below.isConnected, esc.stopped], [false, true, 1], 'Esc는 맨 위 창만 닫는다');
    onKey(keyEvent('Escape'));
    assert.deepStrictEqual(reasons, ['위:escape', '아래:escape'], 'Esc는 바깥 클릭처럼 취소');
    ctx.showConfirm('버리면 다시 볼 수 없습니다', () => {}, { dismissible: false, onCancel: reason => reasons.push(`고정:${reason}`) });
    const fixed = seen.appended[2];
    tick(600);
    const blocked = keyEvent('Escape');
    onKey(blocked);
    assert.deepStrictEqual([fixed.isConnected, blocked.stopped, reasons.length], [true, 1, 2], 'dismissible: false 창은 Esc로 닫지 않는다');
    const heldEnter = keyEvent('Enter', { repeat: true });
    onKey(heldEnter);
    assert.deepStrictEqual([heldEnter.prevented, heldEnter.stopped], [1, 1], '누르고 있는 Enter는 막 뜬 창을 확인하지 않는다');
    const enter = keyEvent('Enter');
    onKey(enter);
    assert.deepStrictEqual([enter.prevented, enter.stopped], [0, 0], '한 번 누른 Enter는 포커스 둔 버튼이 받는다');
    fixed.querySelector('[data-confirm-cancel]').click();
    const free = keyEvent('Escape');
    onKey(free);
    assert.deepStrictEqual([free.stopped, free.prevented], [0, 0], '창이 없으면 Esc를 건드리지 않는다(화이트보드 창 등이 받는다)');
    ctx.alert('다른 코드가 지울 알림');
    seen.appended.at(-1).remove();
    const after = keyEvent('Escape');
    onKey(after);
    assert.strictEqual(after.stopped, 0, '다른 코드가 지운 창은 Esc를 삼키지 않는다');
});

test('앱 창 포커스: 지우기는 취소에, primary는 확인에 처음 포커스를 두고, Tab은 창 안만 돌며, 닫으면 연 자리로 돌려준다', () => {
    const { ctx, seen } = loadUi();
    const onKey = seen.listeners.keydown;
    const page = { isConnected: true, focus() { ctx.document.activeElement = this; } };
    page.focus();
    ctx.showConfirm('지울까요?', () => {});
    const danger = seen.appended[0];
    const cancel = danger.querySelector('[data-confirm-cancel]');
    const ok = danger.querySelector('[data-confirm-ok]');
    assert.strictEqual(ctx.document.activeElement, cancel, '되돌리기 어려운 확인은 취소 버튼에 포커스(Enter가 바로 지우지 않게)');
    const tab = keyEvent('Tab');
    onKey(tab);
    assert.deepStrictEqual([ctx.document.activeElement === ok, tab.prevented], [true, 1]);
    onKey(keyEvent('Tab'));
    assert.strictEqual(ctx.document.activeElement, cancel, '끝에서 처음으로 돈다');
    onKey(keyEvent('Tab', { shiftKey: true }));
    assert.strictEqual(ctx.document.activeElement, ok, 'Shift+Tab은 거꾸로 돈다');
    page.focus();
    onKey(keyEvent('Tab'));
    assert.strictEqual(ctx.document.activeElement, cancel, '창 밖에 있던 포커스는 창 안으로 데려온다');
    ctx.showConfirm('만들까요?', () => {}, { tone: 'primary', okLabel: '만들기' });
    const primary = seen.appended[1];
    assert.strictEqual(ctx.document.activeElement, primary.querySelector('[data-confirm-ok]'), 'primary는 확인 버튼에 포커스(Enter로 확인)');
    tick(600);
    primary.querySelector('[data-confirm-cancel]').click();
    assert.strictEqual(ctx.document.activeElement, cancel, '닫으면 연 자리(아래 창의 취소 버튼)로 돌아간다');
    cancel.click();
    assert.strictEqual(ctx.document.activeElement, page, '마지막 창을 닫으면 창을 열기 전 자리로 돌아간다');
    ctx.alert('알림');
    const alert = seen.appended[2];
    assert.strictEqual(ctx.document.activeElement, alert.querySelector('[data-alert-ok]'), '알림은 확인 버튼에 포커스');
    ctx.showModal('기록', '<p>글</p>');
    const modal = seen.appended[3];
    assert.strictEqual(ctx.document.activeElement, alert.querySelector('[data-alert-ok]'), '내용 보기 창은 알림·확인 창 아래 층이라 포커스를 빼앗지 않는다');
    tick(600);
    onKey(keyEvent('Escape'));
    assert.deepStrictEqual([alert.isConnected, modal.isConnected], [false, true], 'Esc도 위 층(알림)부터 닫는다');
    assert.strictEqual(ctx.document.activeElement, modal.querySelector('[data-modal-body]'), '연 자리가 남은 창 밖이면 남은 창으로');
});

test('확인 창의 취소 까닭(onCancel): 취소 버튼·바깥 클릭·Esc·같은 창이 이미 떠 있음. confirmAsync는 모두 false', async () => {
    const { ctx, seen } = loadUi();
    const reasons = [];
    const ask = () => ctx.showConfirm('A', () => reasons.push('ok'), { onCancel: reason => reasons.push(reason) });
    ask();
    ask();
    tick(600);
    seen.appended[0].querySelector('[data-confirm-cancel]').click();
    ask();
    tick(600);
    seen.appended[1].onclick();
    ask();
    tick(600);
    seen.listeners.keydown(keyEvent('Escape'));
    assert.deepStrictEqual(reasons, ['duplicate', 'button', 'outside', 'escape']);
    const answers = [ctx.confirmAsync('B', { title: 'T', okLabel: '하기', tone: 'primary' }), ctx.confirmAsync('B', { title: 'T', okLabel: '하기', tone: 'primary' })];
    tick(600);
    seen.listeners.keydown(keyEvent('Escape'));
    const outside = ctx.confirmAsync('C', { title: 'T', okLabel: '하기', tone: 'primary' });
    tick(600);
    seen.appended.at(-1).onclick();
    assert.deepStrictEqual(await Promise.all([...answers, outside]), [false, false, false], '같은 창·Esc·바깥 클릭은 모두 취소');
});

test('promptAsync: 확인·Enter면 다듬은 글, 취소·Esc·바깥 클릭이면 null. 막 뜬 창과 한글 조합 중 Enter는 받지 않고, 글은 이스케이프한다', async () => {
    const { ctx, seen } = loadUi();
    const first = ctx.promptAsync('검색어 <b>', { title: '<제목>', value: '"처음"', placeholder: '<예>', okLabel: '넣기' });
    const box = seen.appended[0];
    ['&lt;제목&gt;', '검색어 &lt;b&gt;', 'value="&quot;처음&quot;"', 'placeholder="&lt;예&gt;"', '>넣기<', '>취소<'].forEach(part => assert.ok(box.innerHTML.includes(part), part));
    const panel = box.querySelector('[data-app-dialog-panel]');
    assert.deepStrictEqual([panel.attributes.role, panel.attributes['aria-modal']], ['dialog', 'true']);
    const input = box.querySelector('[data-prompt-input]');
    assert.strictEqual(ctx.document.activeElement, input, '입력칸에 포커스');
    input.value = '  game loop  ';
    input.onkeydown(keyEvent('Enter'));
    box.querySelector('[data-prompt-ok]').click();
    box.onclick();
    assert.strictEqual(box.isConnected, true, '막 뜬 창은 Enter·클릭을 받지 않는다');
    tick(600);
    const composing = keyEvent('Enter', { isComposing: true });
    input.onkeydown(composing);
    assert.deepStrictEqual([box.isConnected, composing.prevented], [true, 0], '한글 조합을 끝내는 Enter는 받지 않는다');
    input.onkeydown(keyEvent('Enter'));
    assert.strictEqual(await first, 'game loop');
    assert.strictEqual(box.isConnected, false);
    const second = ctx.promptAsync('둘째');
    tick(600);
    seen.appended[1].querySelector('[data-prompt-input]').value = ' x ';
    seen.appended[1].querySelector('[data-prompt-ok]').click();
    assert.strictEqual(await second, 'x');
    const third = ctx.promptAsync('셋째');
    tick(600);
    seen.listeners.keydown(keyEvent('Escape'));
    assert.strictEqual(await third, null, 'Esc는 null');
    const fourth = ctx.promptAsync('넷째');
    tick(600);
    seen.appended[3].onclick();
    assert.strictEqual(await fourth, null, '바깥 클릭은 null');
    const fifth = ctx.promptAsync('다섯째');
    tick(600);
    seen.appended[4].querySelector('[data-prompt-cancel]').click();
    assert.strictEqual(await fifth, null, '취소 버튼은 null');
});

test('closeAppModal: 내용 보기 창만 닫고 그 위의 확인 창·알림과 포커스는 그대로 둔다(작업 기록 되돌리기 뒤)', () => {
    const { ctx, seen } = loadUi();
    ctx.showModal('작업 기록', '<button>되돌리기</button>');
    const modal = seen.appended[0];
    ctx.showConfirm('되돌릴까요?', () => {}, { tone: 'primary', okLabel: '되돌리기', title: '작업 기록 되돌리기' });
    const confirmBox = seen.appended[1];
    ctx.alert('저장하지 못했습니다.');
    const alert = seen.appended[2];
    const focused = ctx.document.activeElement;
    ctx.closeAppModal();
    assert.deepStrictEqual([modal.isConnected, confirmBox.isConnected, alert.isConnected], [false, true, true], '내용 보기 창만 닫는다');
    assert.strictEqual(ctx.document.activeElement, focused, '위 창의 포커스는 그대로');
    ctx.closeAppModal();
    assert.deepStrictEqual([confirmBox.isConnected, alert.isConnected], [true, true], '내용 보기 창이 없으면 아무것도 닫지 않는다');
});

test("검색 그림 저장소: 앱의 확인 창으로 묻고, 확인을 누른 뒤에만 지운다('검색 그림 저장소'라고 부른다)", async () => {
    const { ctx, seen } = loadUi();
    const deleted = [];
    ctx.DBManager = { deleteCache: async keyword => { deleted.push(keyword); }, clearAllCaches: async () => { deleted.push('*'); }, getAllCaches: async () => [] };
    const single = ctx.deleteSingleCache('고양이');
    const ask = seen.appended[0];
    assert.ok(ask.innerHTML.includes('검색 그림 저장소') && ask.innerHTML.includes('&#039;고양이&#039;') && ask.innerHTML.includes('>지우기<'), ask.innerHTML);
    ask.querySelector('[data-confirm-ok]').click();
    assert.strictEqual(ask.isConnected, true, '막 뜬 창의 확인은 받지 않는다');
    tick(600);
    ask.querySelector('[data-confirm-ok]').click();
    await single;
    assert.deepStrictEqual(deleted, ['고양이']);
    const all = ctx.clearAllImageCaches();
    const askAll = seen.appended[1];
    assert.ok(askAll.innerHTML.includes('검색 그림 저장소') && askAll.innerHTML.includes('>모두 지우기<'), askAll.innerHTML);
    tick(600);
    askAll.querySelector('[data-confirm-cancel]').click();
    await all;
    assert.deepStrictEqual(deleted, ['고양이'], '취소하면 지우지 않는다');
});

test('핵심 개념 창: 앱 창 틀을 써서 막 뜬 창의 클릭·Enter를 받지 않고, Enter로 고르고, Esc로 닫는다', () => {
    const { ctx, seen } = loadUi();
    const got = [];
    ctx.showKeyConceptsPrompt('<탭>', ['루프'], concepts => got.push(concepts), { okLabel: '생성' });
    const box = seen.appended[0];
    const input = box.querySelector('[data-kc-input]');
    assert.strictEqual(ctx.document.activeElement, input, '입력칸에 포커스');
    assert.ok(box.innerHTML.includes('&lt;탭&gt;') && box.innerHTML.includes('value="루프"'));
    box.onclick();
    input.onkeydown(keyEvent('Enter'));
    assert.deepStrictEqual([box.isConnected, got.length], [true, 0], '두 번 누른 클릭의 둘째가 막 뜬 창을 닫지 않는다');
    tick(600);
    input.value = ' 게임 루프, 프레임 ,';
    input.onkeydown(keyEvent('Enter', { isComposing: true }));
    assert.strictEqual(got.length, 0, '한글 조합 중 Enter는 받지 않는다');
    input.onkeydown(keyEvent('Enter'));
    assert.deepStrictEqual(plain(got), [['게임 루프', '프레임']]);
    ctx.showKeyConceptsPrompt('둘째', [], () => got.push('둘째'));
    tick(600);
    seen.listeners.keydown(keyEvent('Escape'));
    assert.deepStrictEqual([seen.appended[1].isConnected, got.length], [false, 1], 'Esc는 만들지 않고 닫는다');
});

const NATIVE_DIALOG_CALL = /(^|[^.\w]|\bwindow\.)(confirm|prompt)\((?!\))/;

test('소스: 브라우저 기본 확인·입력 창(confirm·prompt)을 쓰지 않는다(kbuilder 밖의 js와 index.html)', () => {
    ["if (!confirm('x')) return;", "window.confirm('x')", "const k = prompt('x', '');"].forEach(line => assert.ok(NATIVE_DIALOG_CALL.test(line), line));
    ["await confirmAsync('x')", "showConfirm('x')", "opts.confirm('x')", "promptAsync('x')", '// prompt()는 Electron에서 뜨지 않는다'].forEach(line => assert.ok(!NATIVE_DIALOG_CALL.test(line), line));
    const files = fs.readdirSync(path.join(root, 'js')).filter(file => file.endsWith('.js')).map(file => [file, js(file)]);
    files.push(['index.html', fs.readFileSync(path.join(root, 'index.html'), 'utf8')]);
    const found = files.flatMap(([file, source]) => source.split(/\r?\n/).filter(line => NATIVE_DIALOG_CALL.test(line)).map(line => `${file}: ${line.trim()}`));
    assert.deepStrictEqual(found, []);
});

test('소스: Esc는 앱 창 틀이 맡고(없는 #custom-modal을 찾던 처리는 없다), F1 도움말이 그렇게 말한다', () => {
    const ui = js('ui.js');
    assert.ok(!ui.includes('custom-modal'));
    assert.ok(ui.includes("window.addEventListener('keydown', onAppDialogKey, true);"));
    assert.ok(ui.includes('• Esc: 열린 창 닫기(취소와 같습니다)') && !ui.includes('모달 닫기'));
    ['window.showAlert', 'window.showConfirm', 'window.showModal', 'window.promptAsync', 'window.showKeyConceptsPrompt'].forEach(name => {
        const start = ui.indexOf(`${name} = function`);
        const body = ui.slice(start, ui.indexOf('\n};', start));
        assert.ok(start >= 0 && body.includes('openAppDialog(overlay'), `${name}은 앱 창 틀을 쓴다`);
    });
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
    ctx.isAiWorkRunning = () => true;
    const working = ev();
    onUnload(working);
    assert.deepStrictEqual([working.prevented, working.returnValue], [true, true], 'AI 작업(생성·고치기·일괄 생성·과정 설계 등)이 돌고 있다(닫으면 만들던 결과를 잃는다)');
    ctx.isAiWorkRunning = () => false;
    const idle = ev();
    onUnload(idle);
    assert.strictEqual(!!idle.prevented, false, '돌던 작업이 끝났으면 묻지 않는다');
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

test('교과 열기: 고치던 원문은 교과를 바꾸기 전에(그 칸을 그린 교과가 열려 있을 때) 넣는다', () => {
    const { ctx } = loadUi();
    const s2 = { id: 's2', title: '교과2', lessons: [{ id: 1, title: 'B', tabContents: { basicLearn: '다른 글' }, images: {} }] };
    ctx.globalState.subjects.push(s2);
    const els = { 'topic-input': { value: '' }, 'editor-content-area': { innerHTML: '' }, 'ai-command-bar': { classList: { add() {} } } };
    ctx.document.getElementById = id => els[id] || null;
    ctx.renderSidebar = () => {};
    const seenWhileSaving = [];
    ctx.saveRawContent = () => seenWhileSaving.push([ctx.currentSubjectId, els['editor-content-area'].innerHTML]);
    ctx.openEditor('s2');
    assert.deepStrictEqual(seenWhileSaving, [['s1', '']], '교과와 편집 영역을 바꾸기 전에 넣는다');
    assert.strictEqual(ctx.currentSubjectId, 's2');
    assert.strictEqual(ctx.courseData, s2.lessons);
    assert.strictEqual(els['topic-input'].value, '교과2');
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

test('다른 탭이 저장한 뒤: 이 탭에서 저장하기 전에(오래 걸린 생성이 끝나 저절로 저장할 때도) 앱의 확인 창으로 한 번 묻고, 저장하지 않기면 쓰지 않으며 창을 닫기 전에 묻게 한다', async () => {
    const { ctx, txs } = loadSaving();
    const asked = [];
    let answer = false;
    ctx.confirmAsync = async (message, opts) => { asked.push({ message, opts }); return answer; };
    ctx.window.showToast = () => {};
    vm.runInContext('_stateForeignSaves = 1', ctx);
    const first = vm.runInContext('saveState()', ctx);
    const second = vm.runInContext('saveState()', ctx); // 묻는 동안 부른 저장은 같은 물음을 기다린다
    assert.strictEqual(vm.runInContext('isSavePending()', ctx), true, '묻는 동안은 저장 중');
    await flush(); await flush();
    assert.deepStrictEqual([asked.length, txs.length], [1, 0], '묻기 전에 쓰지 않는다');
    assert.deepStrictEqual([await first, await second], [false, false]);
    assert.deepStrictEqual([asked.length, txs.length], [1, 0], '한 번만 묻고 쓰지 않는다');
    assert.deepStrictEqual([asked[0].opts.title, asked[0].opts.okLabel, asked[0].opts.cancelLabel, asked[0].opts.dismissible], ['다른 탭에서 저장한 과정', '이 탭 내용으로 저장', '저장하지 않기', false]);
    assert.ok(asked[0].message.includes('그 탭에서 바꾼 내용이 사라집니다'), asked[0].message);
    assert.strictEqual(vm.runInContext('isSavePending()', ctx), true, '저장하지 않았으니 창을 닫기 전에 묻는다');
    answer = true;
    const third = vm.runInContext('saveState()', ctx);
    for (let i = 0; i < 20 && !txs.length; i++) await flush();
    txs[0].oncomplete();
    assert.strictEqual(await third, true);
    const fourth = vm.runInContext('saveState()', ctx);
    assert.strictEqual(vm.runInContext('DBManager.writing', ctx), 1, '덮어쓰기로 답한 뒤에는 묻지 않고 바로 쓴다');
    await flush(); await flush();
    txs[1].oncomplete();
    assert.strictEqual(await fourth, true);
    assert.strictEqual(asked.length, 2, '다른 탭이 또 저장할 때까지 묻지 않는다');
});

test('다른 탭 변경 알림: 다른 탭이 저장하면 세어 두고(1분에 한 번) 알린다', () => {
    const src = js('state.js').replace(/\r\n/g, '\n');
    const start = src.indexOf('/* ---------- 다른 탭 변경 알림 ---------- */');
    const end = src.indexOf('\n}\n', src.indexOf('function allowStateOverwrite(')) + 3;
    const channels = [];
    const toasts = [];
    const ctx = { Date, Promise, BroadcastChannel: function () { channels.push(this); }, window: { showToast: text => toasts.push(text) } };
    vm.createContext(ctx);
    vm.runInContext(src.slice(start, end), ctx);
    channels[0].onmessage();
    channels[0].onmessage();
    assert.strictEqual(vm.runInContext('_stateForeignSaves', ctx), 2);
    assert.deepStrictEqual([toasts.length, toasts[0].includes('저장하기 전에 덮어쓸지 묻습니다')], [1, true], toasts.join('|'));
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
