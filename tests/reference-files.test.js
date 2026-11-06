// 참고 파일 읽기 테스트 (실행: node tests/reference-files.test.js)
// 큰 파일도 받는지 본다: 글 파일은 크기와 상관없이 넣을 만큼 앞부분만 읽고(파일 전체를 메모리에 올리지 않는다), PDF·PPTX는 넣을 만큼 모이면 멈추며,
// 칸에는 파일마다 앞 100,000자까지만 넣는다(AI에는 앞 8,000자만 간다). 큰 그림은 줄여 보낸다.
// 실제 course-refs.js·ui.js·api.js의 함수를 잘라 vm에서 돌린다. pdf.js·JSZip·캔버스는 가짜로 둔다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const source = file => fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8').replace(/\r\n/g, '\n');
const take = (text, start) => {
    const at = text.indexOf(start);
    if (at < 0) throw new Error(`찾지 못함: ${start}`);
    return text.slice(at, text.indexOf('\n}\n', at) + 3);
};

function makeContext(extra = {}) {
    const ctx = {
        console: { log() {}, warn() {}, error() {} }, TextDecoder, Uint8Array, Promise,
        importStop: message => Object.assign(new Error(message), { expected: true }),
        readFileAsDataUrl: async () => 'data:image/png;base64,SMALL',
        ...extra
    };
    vm.createContext(ctx);
    const refs = source('course-refs.js');
    vm.runInContext(refs.slice(0, refs.indexOf('function dataUrlToInline')), ctx); // 상수
    ['function decodeTextBuffer(', 'function trimUtf8Tail(', 'async function readTextPrefix(', 'async function referenceImageDataUrl(', 'async function pptxSlideNotes(']
        .forEach(start => vm.runInContext(take(refs, start), ctx));
    vm.runInContext(take(source('ui.js'), 'async function extractTextFromFile('), ctx);
    const api = source('api.js');
    const from = api.indexOf('const REFERENCE_FILE_MAX_BYTES');
    vm.runInContext(api.slice(from, api.indexOf('\n}\n', api.indexOf('async function readReferenceFile(')) + 3), ctx);
    return ctx;
}

// 크기만 크게 알리는 가짜 파일. 읽은 범위를 남긴다
const bigFile = (name, size, bytes = Buffer.alloc(0)) => ({
    name, size, reads: [],
    slice(from, to) { this.reads.push([from, to]); return { arrayBuffer: async () => bytes.subarray(from, Math.min(to, bytes.length)) }; },
    arrayBuffer: async () => bytes
});

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('글 파일: 900MB라도 넣을 만큼(100,000자 × 4바이트)만 앞에서 읽고, 잘린 끝의 한글 조각은 떼어 UTF-8로 읽는다', async () => {
    const ctx = makeContext();
    const korean = Buffer.from('가나다라마바사'.repeat(20000), 'utf8'); // 420,000바이트
    const file = bigFile('강의 녹취.txt', 900 * 1024 * 1024, korean);
    const text = await ctx.readReferenceFile(file);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(file.reads)), [[0, 400000]], '앞 400,000바이트만 한 번 읽는다');
    assert.ok(text.startsWith('[강의 녹취.txt]\n가나다라마바사'), 'UTF-8로 읽었다(CP949로 다시 읽지 않았다)');
    assert.ok(text.endsWith('\n...(파일이 길어 앞 100,000자만 넣었습니다)'), text.slice(-60));
    assert.strictEqual(text.length, '[강의 녹취.txt]\n'.length + 100000 + '\n...(파일이 길어 앞 100,000자만 넣었습니다)'.length);
    const cut = ctx.trimUtf8Tail(new Uint8Array(Buffer.from('가나', 'utf8').subarray(0, 5)));
    assert.strictEqual(Buffer.from(cut).toString('utf8'), '가', '끝에 걸린 글자 조각은 뗀다');
    assert.strictEqual(Buffer.from(ctx.trimUtf8Tail(new Uint8Array(Buffer.from('a😀', 'utf8')))).toString('utf8'), 'a😀', '온전한 글자는 그대로');
    const small = bigFile('짧은.md', 6, Buffer.from('짧은 글'.slice(0, 2), 'utf8'));
    assert.strictEqual(await ctx.readReferenceFile(small), '[짧은.md]\n짧은', '작은 파일은 그대로');
});

test('PDF: 넣을 만큼 모이면 다음 쪽을 읽지 않는다(100쪽 상한 안에서)', async () => {
    let pages = 0;
    const pdf = { numPages: 100, getPage: async () => { pages += 1; return { getTextContent: async () => ({ items: [{ str: 'x'.repeat(30000) }] }) }; } };
    const ctx = makeContext({ window: { pdfjsLib: { getDocument: () => ({ promise: Promise.resolve(pdf) }) } } });
    const text = await ctx.readReferenceFile(bigFile('교재.pdf', 300 * 1024 * 1024));
    assert.strictEqual(pages, 4, '30,000자씩 네 쪽이면 100,000자를 넘는다');
    assert.ok(text.endsWith('앞 100,000자만 넣었습니다)'));
});

test('PPTX: 넣을 만큼 모이면 다음 슬라이드를 읽지 않는다', async () => {
    let slides = 0;
    const files = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`ppt/slides/slide${i + 1}.xml`, { async: async () => { slides += 1; return `<a:t>${'y'.repeat(30000)}</a:t>`; } }]));
    const ctx = makeContext({ JSZip: { loadAsync: async () => ({ files, file: () => null }) } });
    await ctx.readReferenceFile(bigFile('발표.pptx', 400 * 1024 * 1024));
    assert.strictEqual(slides, 4);
});

test('크기 상한: 그림은 64MB, PDF·PPTX·DOCX는 512MB를 넘으면 까닭을 알리고 일부러 건너뛴 것으로 남긴다(글 파일은 상한 없음)', async () => {
    const ctx = makeContext();
    await assert.rejects(ctx.readReferenceFile(bigFile('사진.png', 65 * 1024 * 1024)), err => err.expected === true && /64MB가 넘습니다/.test(err.message));
    await assert.rejects(ctx.readReferenceFile(bigFile('책.pdf', 513 * 1024 * 1024)), err => err.expected === true && /512MB가 넘습니다/.test(err.message));
    const text = await ctx.readReferenceFile(bigFile('메모.md', 2 * 1024 * 1024 * 1024, Buffer.from('메모 글')));
    assert.strictEqual(text, '[메모.md]\n메모 글');
    await assert.rejects(ctx.extractTextFromFile({ name: '문서.hwp', size: 10 }), err => err.expected === true && /지원하지 않는 파일 형식/.test(err.message));
    await assert.rejects(ctx.readReferenceFile(bigFile('빈.txt', 3, Buffer.from('   '))), err => err.expected === true && /읽을 글자가 없습니다/.test(err.message));
});

test('그림: 4MB가 넘으면 긴 변을 2,400으로 줄여 JPEG로 보내고, 작은 그림은 그대로 보낸다', async () => {
    const drawn = [];
    const canvas = { getContext: () => ({ drawImage: (...args) => drawn.push(args.slice(1)) }), toDataURL: (type, quality) => `data:${type};base64,Q${quality}` };
    let closed = false;
    const ctx = makeContext({
        createImageBitmap: async () => ({ width: 8000, height: 4000, close: () => { closed = true; } }),
        document: { createElement: () => canvas }
    });
    assert.strictEqual(await ctx.referenceImageDataUrl({ size: 1024 }), 'data:image/png;base64,SMALL');
    assert.strictEqual(await ctx.referenceImageDataUrl({ size: 30 * 1024 * 1024 }), 'data:image/jpeg;base64,Q0.85');
    assert.deepStrictEqual([canvas.width, canvas.height, JSON.parse(JSON.stringify(drawn[0]))], [2400, 1200, [0, 0, 2400, 1200]]);
    assert.ok(closed, '풀어 둔 화소는 바로 놓는다');
});

(async () => {
    let failed = 0;
    for (const [name, fn] of tests) {
        try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.stack || e.message}`); }
    }
    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    if (failed) process.exit(1);
})();
