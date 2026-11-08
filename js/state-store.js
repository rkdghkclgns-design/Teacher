// 브라우저 저장소(IndexedDB)에 작업을 쓸 때 그림을 따로 둔다(state.js writeBrowserState·storedRecordData와 읽지 못한 저장본 내려받기가 부른다).
// 큰 교안은 그림이 저장본의 거의 전부라, 글만 바꿔도 작업 전체(그림 포함)를 다시 쓰면 저장 한 번에 1초 가까이 걸렸다. 이제 바뀐 그림만 새로 쓴다.
// - 저장본(STORAGE_KEY): { teacherSplit: 1, body: { state, history } }. body 안의 긴 data: 글(그림)은 '\u0000img:<그림 id>' 자리 글로 바꾼다.
//   '\u0000'으로 시작하는 보통 글은 앞에 '\u0000str:'를 붙여 담는다(자리 글과 헷갈리지 않게. 풀 때 뗀다)
// - 그림(<STORAGE_KEY>#img:<그림 id>): data: 글 그대로. id는 처음 본 그림에 정하는 무작위 32자이고, 한 번 쓴 이름의 값은 바꾸지 않는다
// - 없는 그림 넣기·저장본 쓰기·어디에서도 쓰지 않는 그림 지우기를 한 번의 기록 단계(transaction)에서 한다. 끊기면 아무것도 바뀌지 않아 앞 저장본이 그대로 열린다
// - 예전 저장본(작업 전체를 값 하나나 JSON 파일로 쓴 것)을 처음 바꿀 때는 확인용 이름(<STORAGE_KEY>#check)에 먼저 쓰고 다시 읽어 같은지 본 뒤에야 바꾼다
// - 이 방식은 큰 작업에만 쓴다(예전 방식이면 작업 전체를 JSON 파일로 쓸 만큼 클 때. state.js writeBrowserState·splitSaveMinBytes가 고른다). 작은 작업은 예전처럼 { state, history }를 값 그대로 쓴다.
//   이 방식을 모르는 빌드는 이 저장본에 state가 없어 열지 못한다. 읽지 못한 창이 생긴 뒤(c8b9987, 2026-11-06)의 빌드는 '읽지 못한 저장본' 창으로 멈추지만(그 창의 내려받기에는 그림이 빠진다),
//   그보다 앞선 빌드는 예시 과정으로 덮어쓴다(JSON 파일 저장본도 그 빌드는 덮어쓴다). 그래서 앞선 빌드로 되돌리기 전에는 과정 전체 백업 ZIP을 받아 두게 한다(README)
// 기대는 것: state.js(DBManager), data.js(STORAGE_KEY). 테스트: tests/save-speed.test.js

const SPLIT_SAVE_MARK = 'teacherSplit';
const SPLIT_SAVE_VERSION = 1;
const SPLIT_SAVE_MIN = 8192; // 이보다 짧은 data: 글은 저장본에 그대로 둔다(따로 두어도 빨라지지 않는다)
const SPLIT_SAVE_TOKEN = '\u0000img:';
const SPLIT_SAVE_ESCAPE = '\u0000str:';
const splitSaveImagePrefix = () => `${STORAGE_KEY}#img:`;
const splitSaveCheckKey = () => `${STORAGE_KEY}#check`;
const splitSaveCopyPrefix = () => `${STORAGE_KEY}:`; // 따로 옮겨 둔 읽지 못한 저장본 사본(state.js setAsideUnreadState)

let splitSaveMemo = new Map(); // 그림 글 → 그림 id(이 창에서 읽었거나 쓴 그림). 같은 그림을 다시 쓰지 않게 한다. 저장할 때마다 그 저장이 쓰는 그림만 남긴다
let splitSaveStored = false; // 지금 저장본이 이 방식이고 이 창에서 읽었거나 썼다. 아니면 다음 저장을 확인용 이름에 먼저 쓴다
let splitSaveOff = false; // 확인용으로 다시 읽은 값이 쓴 값과 달랐다. 이 창에서는 예전 방식으로만 쓴다
let splitSaveQueue = Promise.resolve(); // 브라우저 쓰기를 한 번에 하나씩(늦게 부른 저장이 마지막에 남게)
const splitSaveCopyIds = new Map(); // 사본 이름 → 그 사본이 쓰는 그림 id. 사본은 바뀌지 않아 이 창에서 한 번만 읽는다

// prefix로 시작하는 이름의 범위(이 파일이 쓰는 이름은 prefix 뒤가 U+FFFF보다 작은 글자다)
const splitSaveRange = prefix => IDBKeyRange.bound(prefix, prefix + String.fromCharCode(0xffff));

// 배열이 아닌 보통 객체인지(다른 창·저장소에서 온 객체도. 날짜·파일 등은 아니다)
const splitSavePlain = value => value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';

// 이 방식으로 쓴 저장본인지
function isSplitSave(value) {
    return splitSavePlain(value) && value[SPLIT_SAVE_MARK] === SPLIT_SAVE_VERSION && splitSavePlain(value.body);
}

// 이 방식을 쓸 수 있는지(브라우저 저장소와 무작위 수가 있고, 이 창에서 끄지 않았다). 아니면 예전처럼 작업 전체를 쓴다
function splitSaveUsable() {
    return !splitSaveOff && typeof DBManager !== 'undefined' && typeof indexedDB !== 'undefined' && !!indexedDB
        && typeof IDBKeyRange !== 'undefined' && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
}

// 새 그림 id: 무작위 16바이트(32자). 이미 있는 이름과 겹치면 기록 단계에서 멈춘다(commitSplitSave)
function newSplitSaveId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// 따로 둘 그림인지(긴 data: 글. 그림이 아닌 data: 글도 그대로 옮겨 담는다)
const isSplitSaveImage = text => text.length >= SPLIT_SAVE_MIN && text.startsWith('data:');

// 값을 고치지 않고 옮겨 담는다. 배열·보통 객체만 새로 만들고(같은 객체는 한 번만), 글은 change로 바꾼다. 날짜·파일 등은 그대로 둔다(브라우저 저장소가 그대로 담는다)
function copySplitSaveTree(value, change) {
    const copies = new Map();
    const walk = node => {
        if (typeof node === 'string') return change(node);
        if (node === null || typeof node !== 'object') return node;
        if (copies.has(node)) return copies.get(node);
        if (Array.isArray(node)) {
            const out = new Array(node.length);
            copies.set(node, out);
            node.forEach((item, index) => { out[index] = walk(item); });
            return out;
        }
        if (!splitSavePlain(node)) return node;
        const out = {};
        copies.set(node, out);
        for (const key of Object.keys(node)) {
            const item = walk(node[key]);
            if (key === '__proto__') Object.defineProperty(out, key, { value: item, enumerable: true, writable: true, configurable: true });
            else out[key] = item;
        }
        return out;
    };
    return walk(value);
}

// 저장할 값 → { record: 저장본, images: 그림 id → 글, fresh: 이번에 처음 정한 id, memo: 이 저장이 쓰는 그림 글 → id }.
// 앞에서 본 그림(memo)은 그 id를 그대로 쓴다. 같은 그림이 여러 곳(차시·작업 기록·휴지통)에 있어도 그림은 하나만 둔다
function encodeSplitSave(data, memo = splitSaveMemo, makeId = newSplitSaveId) {
    const images = new Map();
    const fresh = new Set();
    const next = new Map();
    const body = copySplitSaveTree(data, text => {
        if (isSplitSaveImage(text)) {
            let id = next.get(text) ?? memo.get(text);
            if (id === undefined) {
                do { id = makeId(); } while (images.has(id));
                fresh.add(id);
            }
            next.set(text, id);
            images.set(id, text);
            return SPLIT_SAVE_TOKEN + id;
        }
        return text.startsWith('\u0000') ? SPLIT_SAVE_ESCAPE + text : text;
    });
    return { record: { [SPLIT_SAVE_MARK]: SPLIT_SAVE_VERSION, body }, images, fresh, memo: next };
}

// 저장본 → { data: { state, history }, missing: 찾지 못한 그림 id }. images: 그림 id → 글. 찾지 못한 그림은 자리 글 그대로 둔다
function decodeSplitSave(record, images) {
    const missing = new Set();
    const data = copySplitSaveTree(record.body, text => {
        if (text.startsWith(SPLIT_SAVE_ESCAPE)) return text.slice(SPLIT_SAVE_ESCAPE.length);
        if (!text.startsWith(SPLIT_SAVE_TOKEN)) return text;
        const id = text.slice(SPLIT_SAVE_TOKEN.length);
        if (images.has(id)) return images.get(id);
        missing.add(id);
        return text;
    });
    return { data, missing: [...missing] };
}

// 저장본이 쓰는 그림 id
function splitSaveIds(record) {
    const ids = new Set();
    const seen = new Set();
    const stack = [record.body];
    while (stack.length) {
        const node = stack.pop();
        if (typeof node === 'string') {
            if (node.startsWith(SPLIT_SAVE_TOKEN)) ids.add(node.slice(SPLIT_SAVE_TOKEN.length));
        } else if (node && typeof node === 'object' && !seen.has(node) && (Array.isArray(node) || splitSavePlain(node))) {
            seen.add(node);
            for (const key of Object.keys(node)) stack.push(node[key]);
        }
    }
    return ids;
}

// 두 값이 같은지(다시 읽은 저장본 확인). 글·수는 값으로, 배열·객체는 안을 차례로 견준다
function sameSplitSaveValue(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a !== a && b !== b; // 둘 다 NaN
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameSplitSaveValue(a[key], b[key]));
}

// 그림들(과 extraKey 값 하나)을 한 번의 읽기 단계로 읽는다 → { images: id → 글, extra, failed: 읽지 못한 그림 id }. 없거나 읽지 못한 그림은 images에서 빠진다.
// 그림 하나를 읽지 못해도(크롬의 'Failed to read large IndexedDB value'처럼 그 값만 깨졌을 때) 단계를 끊지 않고 나머지를 끝까지 읽는다
async function readSplitSaveParts(ids, extraKey = null) {
    const db = await DBManager.init();
    const prefix = splitSaveImagePrefix();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DBManager.storeName, 'readonly');
        const store = tx.objectStore(DBManager.storeName);
        const images = new Map();
        const failed = [];
        let extra;
        tx.oncomplete = () => resolve({ images, extra, failed });
        tx.onabort = () => reject(tx.error || new Error('IndexedDB 읽기가 취소되었습니다'));
        for (const id of ids) {
            const request = store.get(prefix + id);
            request.onsuccess = () => { if (typeof request.result === 'string') images.set(id, request.result); };
            request.onerror = event => {
                event.preventDefault(); // 막지 않으면 실패한 요청 하나가 읽기 단계 전체를 취소한다
                failed.push(id);
            };
        }
        if (extraKey) {
            const request = store.get(extraKey);
            request.onsuccess = () => { extra = request.result; };
        }
    });
}

// 한 번의 기록 단계로 쓴다: 저장소에 없는 그림만 넣고, 저장본을 key에 쓰고, drop 이름을 지운다. sweep이면 이 저장본도 사본도 쓰지 않는 그림을 지운다.
// 이번에 처음 정한 id(fresh)가 이미 있으면 멈춘다(다른 그림을 가리키지 않게). 그림이 있는지는 이 단계 안에서 본다(다른 탭이 그사이 지웠어도 다시 넣는다).
// 끝까지 들어가야(complete) 풀린다 → { written, removed }(그림 id). 하나라도 실패하면 아무것도 바뀌지 않고 던진다
async function commitSplitSave({ key, record, images, fresh = new Set(), sweep = false, drop = [] }) {
    const db = await DBManager.init();
    const prefix = splitSaveImagePrefix();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DBManager.storeName, 'readwrite');
        const store = tx.objectStore(DBManager.storeName);
        const done = { written: [], removed: [] };
        let failure = null;
        const stop = err => {
            failure = failure || err;
            try { tx.abort(); } catch (e) { /* 이미 끝났다 */ }
        };
        tx.oncomplete = () => resolve(done);
        tx.onabort = () => reject(failure || tx.error || new Error('IndexedDB 저장이 취소되었습니다'));
        const listed = store.getAllKeys(splitSaveRange(prefix));
        listed.onsuccess = () => {
            try {
                const existing = new Set(listed.result.map(name => String(name).slice(prefix.length)));
                if ([...fresh].some(id => existing.has(id))) return stop(new Error('새 그림 이름이 이미 있습니다'));
                images.forEach((text, id) => {
                    if (existing.has(id)) return;
                    store.put(text, prefix + id);
                    done.written.push(id);
                });
                store.put(record, key);
                drop.forEach(name => store.delete(name));
                if (sweep) sweepSplitSave(store, { prefix, existing, images, done, stop });
            } catch (err) {
                stop(err);
            }
        };
    });
}

// 어느 사본(<STORAGE_KEY>:…)도 쓰지 않는 그림을 지운다(commitSplitSave가 같은 기록 단계에서 부른다). 사본이 쓰는 그림 id는 이 창에서 한 번 읽어 기억한다
function sweepSplitSave(store, { prefix, existing, images, done, stop }) {
    const copyPrefix = splitSaveCopyPrefix();
    const listed = store.getAllKeys(splitSaveRange(copyPrefix));
    listed.onsuccess = () => {
        const names = listed.result.map(String);
        [...splitSaveCopyIds.keys()].forEach(name => { if (!names.includes(name)) splitSaveCopyIds.delete(name); });
        const keep = new Set();
        let waiting = 0;
        const finish = () => existing.forEach(id => {
            if (images.has(id) || keep.has(id)) return;
            store.delete(prefix + id);
            done.removed.push(id);
        });
        names.forEach(name => {
            if (splitSaveCopyIds.has(name)) return splitSaveCopyIds.get(name).forEach(id => keep.add(id));
            waiting += 1;
            const read = store.get(name);
            read.onsuccess = () => {
                try {
                    const ids = isSplitSave(read.result) ? splitSaveIds(read.result) : new Set(); // 예전 방식 사본은 그림을 안에 담고 있다
                    splitSaveCopyIds.set(name, ids);
                    ids.forEach(id => keep.add(id));
                    waiting -= 1;
                    if (!waiting) finish();
                } catch (err) {
                    stop(err);
                }
            };
        });
        if (!waiting) finish();
    };
}

// 작업을 이 방식으로 쓴다. whole: 작업 전체를 예전 방식으로 쓰는 함수(그 약속을 돌려준다). 이 방식이 실패했을 때와 작은 작업일 때 부른다.
// big: 이 방식으로 쓸 만큼 큰 작업인지(쓸 차례가 왔을 때 본다. state.js writeBrowserState). 아니면 writeSplitSaveWhole로 작업 전체를 쓴다.
// 한 번에 하나씩 쓴다(앞 쓰기와 그 다시 쓰기가 끝난 뒤 시작해 늦게 부른 저장이 마지막에 남는다). 부른 즉시 저장 중으로 센다(창을 닫기 전에 묻게, state.js isSavePending)
function writeSplitSave(data, whole, big = () => true) {
    DBManager.writing += 1;
    const run = splitSaveQueue.then(() => (big() ? writeSplitSaveNow(data, whole) : writeSplitSaveWhole(data, whole)));
    splitSaveQueue = run.then(() => undefined, () => undefined);
    return run.finally(() => { DBManager.writing -= 1; });
}

async function writeSplitSaveNow(data, whole) {
    try {
        const encoded = encodeSplitSave(data);
        const checked = !splitSaveStored;
        if (checked) await checkSplitSave(encoded);
        await commitSplitSave({ key: STORAGE_KEY, record: encoded.record, images: encoded.images, fresh: checked ? new Set() : encoded.fresh, sweep: true, drop: [splitSaveCheckKey()] });
        splitSaveMemo = encoded.memo;
        splitSaveStored = true;
    } catch (err) {
        splitSaveStored = false;
        console.warn('[저장] 그림을 따로 두는 저장을 하지 못해 작업 전체를 한 번에 씁니다:', err?.message || err);
        return whole();
    }
}

// 작은 작업은 예전처럼 작업 전체({ state, history })를 값 그대로 쓴다(이 방식을 모르는 앞선 빌드도 그대로 읽게). 다음에 이 방식으로 쓸 때는 확인용 이름에 먼저 쓴다.
// 지금 저장본이 이 방식이면(이 창에서 읽었거나 썼다) 저장본 쓰기와 이제 쓰지 않는 그림 지우기(사본이 쓰는 그림은 남긴다)를 한 번의 기록 단계로 한다.
// 그렇게 쓰지 못하면 그림은 지우지 않고 whole로 쓴다(남은 그림은 다음에 이 방식으로 쓸 때 정리한다. whole도 실패하면 저장본은 그대로 이 방식이다)
async function writeSplitSaveWhole(data, whole) {
    if (!splitSaveStored) return whole();
    try {
        await commitSplitSave({ key: STORAGE_KEY, record: data, images: new Map(), sweep: true, drop: [splitSaveCheckKey()] });
    } catch (err) {
        console.warn('[저장] 작업 전체를 쓰며 쓰지 않는 그림을 지우지 못해, 그림은 그대로 두고 작업 전체를 씁니다:', err?.message || err);
        await whole();
    }
    splitSaveStored = false;
}

// 처음 이 방식으로 쓸 때: 확인용 이름에 먼저 쓰고 다시 읽어, 쓴 값과 같아야 지금 저장본을 바꾼다(그때까지 예전 저장본은 그대로). 넣은 그림은 다음 저장이 다시 쓰지 않게 기억한다.
// 같지 않으면 확인용으로 넣은 것(이번에 처음 정한 그림·확인용 이름)을 치우고 던진다(예전 방식으로 다시 쓴다). 값이 달랐거나 그림을 다시 읽지 못했으면 이 창에서는 이 방식을 끈다.
// 확인용으로 쓴 것이 없어졌으면(같은 때 옮기던 다른 탭이 정리했다) 끄지 않는다(다음 저장이 다시 옮긴다)
async function checkSplitSave(encoded) {
    await commitSplitSave({ key: splitSaveCheckKey(), record: encoded.record, images: encoded.images, fresh: encoded.fresh });
    splitSaveMemo = encoded.memo;
    const back = await readSplitSaveParts(encoded.images.keys(), splitSaveCheckKey());
    const unreadable = back.failed.length; // 브라우저가 쓴 그림을 돌려주지 못했다(없어진 것이 아니다)
    const gone = !unreadable && (back.extra === undefined || [...encoded.images.keys()].some(id => !back.images.has(id)));
    if (!gone && !unreadable && sameSplitSaveValue(back.extra, encoded.record) && [...encoded.images].every(([id, text]) => back.images.get(id) === text)) return;
    if (!gone) splitSaveOff = true;
    await discardSplitCheck(encoded.fresh);
    throw new Error(gone ? '확인용으로 쓴 것이 그사이 없어졌습니다' : unreadable ? `확인용으로 쓴 그림 ${unreadable}개를 다시 읽지 못했습니다` : '확인용으로 다시 읽은 저장본이 쓴 것과 다릅니다');
}

// 확인하지 못한 확인용 쓰기를 치운다(확인용 이름과 이번에 처음 정한 그림. 그 그림은 이 창만 안다). 치우지 못해도 멈추지 않는다(다음에 옮길 때 정리한다)
async function discardSplitCheck(fresh) {
    try {
        const db = await DBManager.init();
        const prefix = splitSaveImagePrefix();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(DBManager.storeName, 'readwrite');
            const store = tx.objectStore(DBManager.storeName);
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error || new Error('IndexedDB 지우기가 취소되었습니다'));
            store.delete(splitSaveCheckKey());
            fresh.forEach(id => store.delete(prefix + id));
        });
    } catch (err) {
        console.warn('[저장] 확인용으로 쓴 것을 치우지 못했습니다:', err?.message || err);
    }
}

// 저장본(STORAGE_KEY)의 그림을 읽어 { state, history }로 푼다. 그림을 하나라도 찾지 못하거나 읽지 못하면 던진다(record와 그 그림 수 missingImages를 담아. 막는 창에서 알리고 내려받는다).
// 저장본을 읽은 뒤 그림을 읽기 전에 다른 탭이 저장하며 그 그림을 정리했을 수 있어, 그림이 없으면 저장본을 다시 읽어 바뀌었으면 새 저장본으로 한 번 더 푼다.
// 다시 읽은 저장본이 예전 모양({ state, history })이면(다른 탭이 작아진 작업을 작업 전체로 쓰며 그림을 지웠다. writeSplitSaveWhole) 그 저장본을 예전 저장본처럼 그대로 돌려준다
async function readSplitSave(record) {
    let current = record;
    try {
        let opened = await openStoredSplitSave(current);
        if (opened.missing.length) {
            const now = await DBManager.getItem(STORAGE_KEY);
            if (isSplitSave(now) && !sameSplitSaveValue(now, current)) {
                current = now;
                opened = await openStoredSplitSave(current);
            } else if (splitSavePlain(now) && splitSavePlain(now.state) && Array.isArray(now.history)) {
                splitSaveStored = false; // 지금 저장본은 이 방식이 아니다(다음에 이 방식으로 쓸 때 확인용 이름에 먼저 쓴다)
                return now;
            }
        }
        if (opened.missing.length) throw Object.assign(new Error(`저장본이 가리키는 그림 ${opened.missing.length}개를 찾지 못하거나 읽지 못했습니다`), { missingImages: opened.missing.length });
        opened.images.forEach((text, id) => { if (!splitSaveMemo.has(text)) splitSaveMemo.set(text, id); });
        splitSaveStored = true;
        return opened.data;
    } catch (err) {
        throw Object.assign(new Error(`그림을 따로 둔 저장본을 풀지 못했습니다: ${err.message}`), { record: current, missingImages: err.missingImages || 0 });
    }
}

// 저장본의 그림을 읽어 푼다 → { data, missing, images }
async function openStoredSplitSave(record) {
    const { images } = await readSplitSaveParts(splitSaveIds(record));
    return { ...decodeSplitSave(record, images), images };
}

// 내려받기용 → { data: 그림을 제자리에 넣은 { state, history }(예전 저장본과 같은 모양), missing: 찾지 못하거나 읽지 못해 자리 글 그대로 둔 그림 id }(부르는 쪽이 알린다)
async function openSplitSave(record) {
    let images = new Map();
    try {
        images = (await readSplitSaveParts(splitSaveIds(record))).images;
    } catch (err) {
        console.warn('[저장된 작업] 그림을 읽지 못해 그림 자리만 담습니다:', err?.message || err);
    }
    return decodeSplitSave(record, images);
}
