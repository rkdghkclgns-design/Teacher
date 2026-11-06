// import-stream.js - 큰 파일을 조각으로 읽고 data URL을 따로 떼어 둔다(내보낸 교안 다시 불러오기, 교수안·편성안 파일 불러오기)
// 파일 전체를 글 하나로 만들지 않는다. 브라우저가 다루는 글 하나의 길이 한도(약 5억 자)를 넘는 수백 MB 파일도 읽는다.
// 바이트 조각에서 data:<형식>;base64,<내용>을 찾아 그 자리에 짧은 표시를 두고 내용은 따로 모은다
// (UTF-8의 여러 바이트 글자에는 ASCII 바이트가 들지 않아 바이트로 찾아도 된다). 나머지 글은 조각마다 UTF-8로 이어 푼다.
// 조각 사이에 걸친 글자와 data URL도 그대로 잇는다. 표시에는 읽을 때마다 새로 뽑은 낱말을 넣어 파일 안의 글과 겹치지 않는다.
// 표시는 글자·숫자뿐이라 HTML 속성, JSON 글, 마크다운 주소 어디에 있어도 모양이 바뀌지 않는다. 테스트: tests/output-import.test.js

const STREAM_CHUNK_BYTES = 4 * 1024 * 1024; // 한 번에 읽는 바이트
const STREAM_HEAD_MAX = 160; // data:…;base64, 머리로 보는 최대 바이트
const STREAM_MIN_DATA = 512; // 이보다 짧은 data URL은 글에 그대로 둔다(작은 아이콘, 글 속 예시)
const STREAM_TEXT_MAX = 256 * 1024 * 1024; // 떼고 남은 글의 상한(글자). 브라우저의 글 길이 한도에 닿기 전에 까닭을 알리고 멈춘다
const STREAM_DATA_MAX = 256 * 1024 * 1024; // data URL 하나의 상한(글자). 넘는 것은 담지 않고 센다
const STREAM_PROGRESS_MIN = 8 * 1024 * 1024; // 이보다 큰 파일만 읽는 동안 진행을 보인다
const STREAM_HEAD_RE = /^data:[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[a-z0-9!#$&^_.+-]+=[a-z0-9!#$&^_.+=-]+)*;base64,$/i;
const STREAM_DATA_WORD = [0x64, 0x61, 0x74, 0x61, 0x3a]; // 'data:'
const STREAM_MORE = Object.freeze({ more: true }); // 조각이 끝나 머리인지 아직 모른다(다음 조각과 이어 본다)
const STREAM_B64 = streamByteTable('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=');
const STREAM_HEAD_BYTE = streamByteTable('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$&^_.+-=;/');

// 바이트가 글자 목록에 들면 1인 표
function streamByteTable(chars) {
    const table = new Uint8Array(256);
    for (const ch of chars) table[ch.charCodeAt(0)] = 1;
    return table;
}

// 표시 앞말. 읽을 때마다 새로 뽑는다(파일 안의 글이 표시를 흉내 내지 못하게)
function streamTokenPrefix() {
    const random = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
        ? Array.from(crypto.getRandomValues(new Uint8Array(9)), byte => byte.toString(36).padStart(2, '0')).join('')
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    return `tdata${random}n`;
}

const streamAscii = (bytes, from, to) => String.fromCharCode.apply(null, bytes.subarray(from, to));
const streamMb = bytes => (Number(bytes) / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1);

function streamJoin(head, tail) {
    const joined = new Uint8Array(head.length + tail.length);
    joined.set(head, 0);
    joined.set(tail, head.length);
    return joined;
}

// at에서 data URL 머리가 시작하면 그 머리 글('data:image/png;base64,'), 아니면 null. 조각이 끝나 아직 모르면 STREAM_MORE
function streamHeadAt(bytes, at) {
    const n = bytes.length;
    for (let k = 0; k < STREAM_DATA_WORD.length; k++) {
        if (at + k >= n) return STREAM_MORE;
        if (bytes[at + k] !== STREAM_DATA_WORD[k]) return null;
    }
    let end = at + STREAM_DATA_WORD.length;
    while (end < n && end - at < STREAM_HEAD_MAX && STREAM_HEAD_BYTE[bytes[end]] === 1) end++;
    if (end >= n && end - at < STREAM_HEAD_MAX) return STREAM_MORE;
    if (bytes[end] !== 0x2c) return null; // ','
    const head = streamAscii(bytes, at, end + 1);
    return STREAM_HEAD_RE.test(head) ? head : null;
}

function streamTooLong() {
    return new Error(`글이 너무 많은 파일입니다(그림·영상을 뺀 글만 ${STREAM_TEXT_MAX.toLocaleString('ko-KR')}자가 넘습니다). 파일을 나눠 내보낸 뒤 불러오세요`);
}

// 바이트 조각을 차례로 받아 표시를 넣은 글과 떼어 낸 data URL 표를 만든다
function streamScanner() {
    const prefix = streamTokenPrefix();
    let textDecoder = new TextDecoder('utf-8'); // 파일 첫머리의 BOM은 file.text()처럼 뗀다
    const asciiDecoder = new TextDecoder('utf-8'); // base64 내용은 ASCII뿐이라 조각마다 따로 푼다
    const texts = [];
    const table = [];
    let textLength = 0;
    let oversized = 0;
    let pending = null; // 조각 끝에 걸린 data: 머리 바이트
    let current = null; // 모으는 중인 data URL { head, parts, length }. parts가 null이면 너무 커서 담지 않는다

    const addText = text => {
        if (!text) return;
        textLength += text.length;
        if (textLength > STREAM_TEXT_MAX) throw streamTooLong();
        texts.push(text);
    };
    const textBytes = (bytes, from, to) => {
        if (to > from) addText(textDecoder.decode(bytes.subarray(from, to), { stream: true }));
    };
    // 끊긴 UTF-8 글자를 마무리해 표시 앞뒤의 글 순서가 섞이지 않게 한다. 그 뒤 글 가운데의 U+FEFF는 BOM으로 보고 떼지 않게 새로 푼다
    const flushText = () => {
        addText(textDecoder.decode());
        textDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
    };
    const dataBytes = (bytes, from, to) => {
        if (to <= from) return;
        current.length += to - from;
        if (!current.parts) return;
        if (current.head.length + current.length > STREAM_DATA_MAX) {
            current.parts = null;
            return;
        }
        current.parts.push(asciiDecoder.decode(bytes.subarray(from, to)));
    };
    const endData = () => {
        const { head, parts, length } = current;
        current = null;
        if (parts && length < STREAM_MIN_DATA) return addText(head + parts.join(''));
        if (!parts) oversized++;
        table.push(parts ? head + parts.join('') : null);
        addText(`${prefix}${table.length - 1}x`);
    };

    const push = chunk => {
        const bytes = pending ? streamJoin(pending, chunk) : chunk;
        pending = null;
        const n = bytes.length;
        let i = 0;
        while (i < n) {
            if (current) {
                let end = i;
                while (end < n && STREAM_B64[bytes[end]] === 1) end++;
                dataBytes(bytes, i, end);
                if (end === n) return; // 내용이 다음 조각으로 이어진다
                endData();
                i = end;
                continue;
            }
            // 글: 다음 data: 머리까지 한 번에 푼다
            let search = i;
            let head = null;
            let at = bytes.indexOf(0x64, search);
            while (at >= 0) {
                head = streamHeadAt(bytes, at);
                if (head) break;
                search = at + 1;
                at = bytes.indexOf(0x64, search);
            }
            if (at < 0) return textBytes(bytes, i, n);
            textBytes(bytes, i, at);
            if (head === STREAM_MORE) {
                pending = bytes.slice(at);
                return;
            }
            flushText();
            current = { head, parts: [], length: 0 };
            i = at + head.length;
        }
    };

    const finish = () => {
        if (current) endData();
        if (pending) {
            textBytes(pending, 0, pending.length);
            pending = null;
        }
        flushText();
        const text = texts.join('');
        texts.length = 0;
        return streamResult(text, table, prefix, oversized);
    };
    return { push, finish };
}

// 읽은 결과. restore: 글 속 표시를 원래 data URL로(담지 못한 큰 것은 빈 글), dataOf: 값 전체가 표시 하나면 그 data URL
function streamResult(text, table, prefix, oversized) {
    const tokens = new RegExp(`${prefix}(\\d+)x`, 'g');
    const exact = new RegExp(`^${prefix}(\\d+)x$`);
    const valueAt = index => table[index] ?? '';
    return {
        text,
        oversized,
        count: table.length,
        restore: value => (typeof value === 'string' && value.includes(prefix) ? value.replace(tokens, (whole, index) => valueAt(Number(index))) : value),
        dataOf: value => {
            const match = typeof value === 'string' ? exact.exec(value) : null;
            return match ? valueAt(Number(match[1])) : value;
        },
        hasToken: value => typeof value === 'string' && value.includes(prefix)
    };
}

// 이미 글로 가진 파일(테스트, 작은 글)을 같은 모양으로 쓴다. 떼어 낸 것이 없어 되돌릴 것도 없다
function streamPlain(text) {
    return { text: String(text ?? ''), oversized: 0, count: 0, restore: value => value, dataOf: value => value, hasToken: () => false };
}

const streamPause = () => new Promise(resolve => setTimeout(resolve, 0));

// 파일을 조각으로 읽는다. onProgress(읽은 바이트, 전체 바이트)를 조각마다 부르고 한 번 쉬어 화면이 그려지게 한다
async function readFileSkeleton(file, { onProgress = null, chunkBytes = STREAM_CHUNK_BYTES } = {}) {
    const scanner = streamScanner();
    const size = Math.max(0, Number(file?.size) || 0);
    for (let at = 0; at < size; at += chunkBytes) {
        const end = Math.min(size, at + chunkBytes);
        scanner.push(new Uint8Array(await file.slice(at, end).arrayBuffer()));
        if (onProgress) {
            onProgress(end, size);
            await streamPause();
        }
    }
    return { ...scanner.finish(), size };
}

// data URL 글 → Blob(영상 등). 4의 배수 글자씩 풀어 큰 영상도 한 번에 풀지 않는다
const STREAM_DECODE_STEP = 4 * 1024 * 1024;
function dataUrlBlob(dataUrl) {
    const text = String(dataUrl);
    const comma = text.indexOf(',');
    const type = text.slice(5, text.indexOf(';'));
    const parts = [];
    for (let at = comma + 1; at < text.length; at += STREAM_DECODE_STEP) {
        const binary = atob(text.slice(at, at + STREAM_DECODE_STEP));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        parts.push(bytes);
    }
    return new Blob(parts, { type });
}

// 큰 파일을 읽는 동안 화면 왼쪽 아래에 읽은 MB를 보인다. 작은 파일이거나 화면이 없으면 아무것도 하지 않는다
function showReadProgress(file, label = '읽는 중') {
    const size = Number(file?.size) || 0;
    const idle = { update() {}, say() {}, close() {} };
    if (size < STREAM_PROGRESS_MIN || typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') return idle;
    const box = document.createElement('div');
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.className = 'fixed bottom-6 left-6 z-[9999] max-w-[440px] bg-[#1a1a2e] border border-white/10 text-white px-4 py-3 rounded-xl shadow-2xl text-sm font-bold';
    const chars = Array.from(String(file.name || ''));
    const name = chars.length > 40 ? `${chars.slice(0, 40).join('')}…` : chars.join('');
    const say = text => { box.textContent = text; }; // 파일 이름은 글자로만 넣는다
    say(`'${name}' ${label}… 0 / ${streamMb(size)}MB`);
    document.body.appendChild(box);
    return {
        update: (read, total) => say(`'${name}' ${label}… ${streamMb(read)} / ${streamMb(total)}MB`),
        say: text => say(`'${name}' ${text}`),
        close: () => box.remove()
    };
}

if (typeof window !== 'undefined') {
    Object.assign(window, { readFileSkeleton, streamScanner, streamPlain, dataUrlBlob, showReadProgress });
}
