// 움직이는 GIF 만들기(js/gif-encoder.js) 테스트 (실행: node tests/gif-encoder.test.js)
// 실제 gif-encoder.js를 vm에서 돌리고, 만든 바이트를 이 파일의 따로 짠 GIF 읽기(블록 나누기·LZW 풀기·투명과 장면 처리를 따라 겹치기)로 풀어
// 넣은 장면과 점 하나까지 같은지 본다. 색 고르기(중앙값 자르기)·가까운 색 표·base64도 본다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

function load({ withBtoa = false } = {}) {
    const ctx = { console, Math, Uint8Array, Int16Array, Int32Array, Float64Array, Set, Map, Promise, Error, Array, Number, String, Object };
    if (withBtoa) ctx.btoa = btoa;
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'gif-encoder.js'), 'utf8'), ctx);
    return ctx;
}
const G = load();

/* ---------- 따로 짠 GIF 읽기 (인코더 코드를 쓰지 않는다) ---------- */
function lzwDecode(data, minCode, expected) {
    const clear = 1 << minCode;
    const end = clear + 1;
    let size;
    let next;
    let dict;
    const reset = () => {
        dict = [];
        for (let i = 0; i < clear; i++) dict[i] = [i];
        size = minCode + 1;
        next = end + 1;
    };
    reset();
    const out = [];
    let bit = 0;
    let prev = null;
    const read = () => {
        let code = 0;
        for (let i = 0; i < size; i++) {
            const byte = data[(bit + i) >> 3];
            if (byte === undefined) throw new Error('그림 자료가 끝나기 전에 끊겼다');
            code |= ((byte >> ((bit + i) & 7)) & 1) << i;
        }
        bit += size;
        return code;
    };
    for (;;) {
        const code = read();
        if (code === clear) {
            reset();
            prev = null;
            continue;
        }
        if (code === end) break;
        let entry;
        if (code < next && dict[code]) entry = dict[code];
        else if (code === next && prev !== null) entry = [...dict[prev], dict[prev][0]];
        else throw new Error(`모르는 코드 ${code} (다음 ${next})`);
        for (const value of entry) out.push(value);
        if (prev !== null && next < 4096) dict[next++] = [...dict[prev], entry[0]];
        prev = code;
        if (next === 1 << size && size < 12) size += 1;
    }
    if (out.length !== expected) throw new Error(`점 수 ${out.length}, 바란 수 ${expected}`);
    return out;
}

function decodeGif(bytes) {
    let pos = 0;
    const u8 = () => {
        if (pos >= bytes.length) throw new Error('파일이 일찍 끝났다');
        return bytes[pos++];
    };
    const u16 = () => u8() | (u8() << 8);
    const text = n => String.fromCharCode(...Array.from({ length: n }, u8));
    const blocks = () => {
        const out = [];
        for (let size = u8(); size; size = u8()) for (let i = 0; i < size; i++) out.push(u8());
        return out;
    };
    const header = text(6);
    const width = u16();
    const height = u16();
    const packed = u8();
    const background = u8();
    u8();
    const table = [];
    if (packed & 0x80) for (let i = 0; i < 1 << ((packed & 7) + 1); i++) table.push([u8(), u8(), u8()]);
    const canvas = new Uint8Array(width * height * 4);
    const frames = [];
    let loop = null;
    let control = null;
    let disposeLast = null;
    for (;;) {
        const kind = u8();
        if (kind === 0x3b) break;
        if (kind === 0x21) {
            const label = u8();
            if (label === 0xf9) {
                u8();
                const flags = u8();
                control = { disposal: (flags >> 2) & 7, transparent: flags & 1 ? null : -1, delay: u16() };
                const index = u8();
                if (control.transparent === null) control.transparent = index;
                u8();
            } else if (label === 0xff) {
                const name = text(u8());
                const data = blocks();
                if (name === 'NETSCAPE2.0' && data[0] === 1) loop = data[1] | (data[2] << 8);
            } else {
                blocks();
            }
            continue;
        }
        if (kind !== 0x2c) throw new Error(`모르는 블록 ${kind}`);
        const x = u16();
        const y = u16();
        const w = u16();
        const h = u16();
        const flags = u8();
        if (flags & 0xc0) throw new Error('지역 색표·건너뛰기 줄은 쓰지 않는다');
        const minCode = u8();
        const indices = lzwDecode(blocks(), minCode, w * h);
        if (disposeLast?.disposal === 2) {
            for (let yy = disposeLast.y; yy < disposeLast.y + disposeLast.h; yy++) {
                for (let xx = disposeLast.x; xx < disposeLast.x + disposeLast.w; xx++) canvas.fill(0, (yy * width + xx) * 4, (yy * width + xx) * 4 + 4);
            }
        } else if (disposeLast?.disposal === 3) {
            canvas.set(disposeLast.saved);
        }
        const info = control || { disposal: 0, transparent: -1, delay: 0 };
        const saved = info.disposal === 3 ? canvas.slice() : null;
        indices.forEach((index, i) => {
            if (index === info.transparent) return;
            const px = x + (i % w);
            const py = y + Math.floor(i / w);
            if (px >= width || py >= height) return;
            const at = (py * width + px) * 4;
            canvas[at] = table[index][0];
            canvas[at + 1] = table[index][1];
            canvas[at + 2] = table[index][2];
            canvas[at + 3] = 255;
        });
        frames.push({ rgba: canvas.slice(), x, y, w, h, ...info });
        disposeLast = { ...info, x, y, w, h, saved };
        control = null;
    }
    if (pos !== bytes.length) throw new Error('끝 블록 뒤에 바이트가 남았다');
    return { header, width, height, background, table, loop, frames };
}

/* ---------- 도우미 ---------- */
// 색 목록에서 점마다 색을 골라 RGBA 장면을 만든다
function frameOf(width, height, colors, pick) {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const [r, g, b] = colors[pick(i % width, Math.floor(i / width))];
        rgba.set([r, g, b, 255], i * 4);
    }
    return rgba;
}
// 서로 멀리 떨어진 색(칸 가운데 색으로 찾아도 제 색이 된다)
const FAR = [[255, 255, 255], [0, 0, 0], [228, 30, 72], [5, 150, 105], [124, 58, 237], [250, 204, 21], [30, 64, 175], [120, 120, 120]];
let seed = 7;
const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
};
const sameBytes = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const plain = value => JSON.parse(JSON.stringify(value)); // vm 안에서 만든 배열은 프로토타입이 달라 그대로 견주지 않는다

let failed = 0;
let count = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

/* ---------- LZW ---------- */
test('LZW: 코드 길이 2~8과 코드 표가 차는 긴 자료(지우기 코드)를 따로 짠 읽기로 풀면 그대로다', () => {
    for (const minCode of [2, 3, 4, 5, 6, 7, 8]) {
        for (const length of [1, 2, 3, 7, 100, 5000, 40000]) {
            const indices = new Uint8Array(length).map(() => Math.floor(random() * (1 << minCode)));
            const sink = [];
            const fakeSink = { byte: v => sink.push(v & 255), bytes: list => list.forEach(v => sink.push(v)) };
            G.gifLzw(indices, minCode, fakeSink);
            assert.strictEqual(sink[0], minCode);
            const data = [];
            let at = 1;
            for (let size = sink[at++]; size; size = sink[at++]) {
                assert.ok(size <= 255, '조각은 255바이트까지');
                for (let i = 0; i < size; i++) data.push(sink[at++]);
            }
            assert.strictEqual(at, sink.length, '끝 0 뒤에 남는 것이 없다');
            assert.ok(sameBytes(lzwDecode(data, minCode, length), indices), `코드 길이 ${minCode}, 길이 ${length}`);
        }
    }
    // 같은 색이 길게 이어지면 코드 표가 4096을 넘도록 커진다(긴 줄)
    const flat = new Uint8Array(200000).fill(3);
    const sink = [];
    G.gifLzw(flat, 2, { byte: v => sink.push(v), bytes: list => list.forEach(v => sink.push(v)) });
    const data = [];
    for (let at = 1, size = sink[at++]; size; size = sink[at++]) for (let i = 0; i < size; i++) data.push(sink[at++]);
    assert.ok(sameBytes(lzwDecode(data, 2, flat.length), flat));
    assert.ok(sink.length < 4000, `같은 색은 짧게 줄어든다: ${sink.length}바이트`);
});

/* ---------- GIF 파일 왕복 ---------- */
test('GIF 파일: 머리·공통 색표·끝없는 되풀이·장면마다 바뀐 곳만 투명과 함께, 풀어서 겹치면 넣은 장면과 점 하나까지 같다', () => {
    const width = 40;
    const height = 30;
    const palette = FAR.slice(0, 5);
    const writer = G.gifWriter({ width, height, palette, loop: 0 });
    const frames = [
        frameOf(width, height, palette, (x, y) => ((x >> 2) + (y >> 2)) % 3),
        frameOf(width, height, palette, (x, y) => (x > 30 && y > 20 ? 4 : ((x >> 2) + (y >> 2)) % 3)),
        frameOf(width, height, palette, (x, y) => (x > 30 && y > 20 ? 4 : ((x >> 2) + (y >> 2)) % 3)), // 앞 장면과 같다 → 시간에 더한다
        frameOf(width, height, palette, (x, y) => (x === 0 || y === height - 1 ? 3 : ((x >> 2) + (y >> 2)) % 3)), // 가장자리만 바뀜
        frameOf(width, height, palette, (x, y) => ((x >> 2) + (y >> 2)) % 3) // 처음으로
    ];
    const map = new Map(palette.map((rgb, i) => [rgb.join(','), i]));
    frames.forEach((rgba, n) => {
        const indices = new Uint8Array(width * height);
        for (let i = 0; i < indices.length; i++) indices[i] = map.get([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]].join(','));
        writer.add(indices, [10, 10, 10, 7, 1][n]);
    });
    const { bytes, frames: written } = writer.finish();
    const gif = decodeGif(bytes);
    assert.strictEqual(gif.header, 'GIF89a');
    assert.deepStrictEqual([gif.width, gif.height, gif.loop], [width, height, 0], '끝없이 되풀이(NETSCAPE2.0, 0)');
    assert.strictEqual(gif.table.length, 8, '5색 + 투명 1칸 → 8칸 색표');
    assert.deepStrictEqual(gif.table.slice(0, 5), palette);
    assert.strictEqual(written, 4);
    assert.strictEqual(gif.frames.length, 4, '같은 장면은 하나로 합친다');
    assert.deepStrictEqual(gif.frames.map(frame => frame.delay), [10, 20, 7, 2], '합친 장면은 시간을 더하고, 1은 2로 올린다');
    [frames[0], frames[1], frames[3], frames[4]].forEach((rgba, i) => assert.ok(sameBytes(gif.frames[i].rgba, rgba), `장면 ${i}`));
    assert.deepStrictEqual([gif.frames[0].x, gif.frames[0].y, gif.frames[0].w, gif.frames[0].h, gif.frames[0].transparent], [0, 0, width, height, -1], '첫 장면은 통째로');
    assert.deepStrictEqual([gif.frames[1].x, gif.frames[1].y, gif.frames[1].w, gif.frames[1].h], [31, 21, 9, 9], '바뀐 곳만 잘라 넣는다');
    assert.ok(gif.frames.slice(1).every(frame => frame.transparent === 5 && frame.disposal === 1), '다음 장면은 투명(색표 다음 칸)과 그대로 두기');
    assert.strictEqual(gif.frames[0].disposal, 1);
});

test('GIF 파일: 색 255개(256칸 색표)와 2색(최소 코드 길이 2), 1×1 그림도 풀린다', () => {
    const big = Array.from({ length: 255 }, (_, i) => [i, (i * 7) & 255, (i * 13) & 255]);
    const writer = G.gifWriter({ width: 17, height: 15, palette: big });
    const first = new Uint8Array(17 * 15).map((_, i) => i % 255);
    const second = first.map((value, i) => (i % 5 ? value : (value + 1) % 255));
    writer.add(first, 10);
    writer.add(second, 10);
    const gif = decodeGif(writer.finish().bytes);
    assert.strictEqual(gif.table.length, 256);
    const expect = indices => {
        const out = new Uint8Array(indices.length * 4);
        indices.forEach((index, i) => out.set([...big[index], 255], i * 4));
        return out;
    };
    assert.ok(sameBytes(gif.frames[0].rgba, expect(first)) && sameBytes(gif.frames[1].rgba, expect(second)));
    const tiny = G.gifWriter({ width: 1, height: 1, palette: [[9, 9, 9]] });
    tiny.add(new Uint8Array([0]), 10);
    const one = decodeGif(tiny.finish().bytes);
    assert.deepStrictEqual([one.table.length, [...one.frames[0].rgba]], [2, [9, 9, 9, 255]]);
    assert.throws(() => G.gifWriter({ width: 0, height: 1, palette: [[0, 0, 0]] }), /크기/);
    assert.throws(() => G.gifWriter({ width: 1, height: 1, palette: Array.from({ length: 256 }, () => [0, 0, 0]) }), /색표/);
    assert.throws(() => tiny.add(new Uint8Array(2), 10), /크기/);
});

/* ---------- 색 고르기 ---------- */
test('중앙값 자르기: 색이 적으면 그 색 그대로, 많아도 상한(255)을 넘지 않고, 빈 점에는 빈 목록', () => {
    const samples = [];
    FAR.forEach((rgb, i) => { for (let k = 0; k <= i; k++) samples.push(...rgb); });
    const few = plain(G.gifMedianCut(Uint8Array.from(samples), 255).map(rgb => rgb.join(',')).sort());
    assert.deepStrictEqual(few, FAR.map(rgb => rgb.join(',')).sort());
    const many = [];
    for (let r = 0; r < 256; r += 8) for (let g = 0; g < 256; g += 8) for (let b = 0; b < 256; b += 16) many.push(r, g, b);
    const cut = G.gifMedianCut(Uint8Array.from(many), 255);
    assert.ok(cut.length <= 255 && cut.length > 200, `${cut.length}색`);
    assert.ok(cut.every(rgb => rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255)));
    assert.strictEqual(G.gifMedianCut(Uint8Array.from(many), 1).length, 1);
    assert.strictEqual(G.gifMedianCut(new Uint8Array(0), 255).length, 0);
    assert.strictEqual(G.gifMedianCut(Uint8Array.from(many), 999).length <= 255, true, '255를 넘겨 물어도 255까지');
});

test('색표: 꼭 넣을 색이 먼저(겹친 색은 한 번), 점에서 고른 색은 그 뒤, 모두 255색 이하이고 가까운 색 표는 색표의 색을 제 번호로 찾는다', () => {
    const fixed = [[225, 29, 72], [5, 150, 105], [225, 29, 72], [255, 255, 255]];
    const samples = [];
    for (let i = 0; i < 3000; i++) samples.push(Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256));
    for (let i = 0; i < 50; i++) samples.push(225, 29, 72);
    const palette = G.gifBuildPalette(Uint8Array.from(samples), fixed);
    assert.deepStrictEqual(plain(palette.slice(0, 3)), [[225, 29, 72], [5, 150, 105], [255, 255, 255]]);
    assert.ok(palette.length <= 255, `${palette.length}색`);
    assert.strictEqual(new Set(palette.map(rgb => rgb.join(','))).size, palette.length, '같은 색은 한 번만');
    const mapper = G.gifColorMapper(palette);
    palette.slice(0, 3).forEach((rgb, i) => assert.strictEqual(mapper.index(...rgb), i, `꼭 넣을 색 ${i}`));
    // 칸 가운데 색으로 찾으므로 점의 차례와 상관없이 같은 답이다
    const colors = Array.from({ length: 500 }, () => [Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256)]);
    const forward = colors.map(rgb => G.gifColorMapper(palette).index(...rgb));
    const shared = G.gifColorMapper(palette);
    const backward = [...colors].reverse().map(rgb => shared.index(...rgb)).reverse();
    assert.deepStrictEqual(plain(backward), plain(forward));
    const rgba = new Uint8Array(colors.length * 4);
    colors.forEach((rgb, i) => rgba.set([...rgb, 255], i * 4));
    assert.deepStrictEqual([...shared.indices(rgba)], plain(forward), '한꺼번에 바꿔도 같다');
    assert.deepStrictEqual(plain(G.gifBuildPalette(new Uint8Array(0))), [[0, 0, 0]], '점이 없어도 한 색은 둔다');
    assert.deepStrictEqual(plain(G.gifBuildPalette(new Uint8Array(0), [[1, 2, 3], [300, 0, 0], 'x'])), [[1, 2, 3]], '모양이 틀린 색은 뺀다');
});

/* ---------- 장면들 → GIF ---------- */
test('장면들 → GIF: 여러 장면의 점으로 색을 고르고, 풀면 장면마다 색표 번호 그대로의 색이며 꼭 넣을 색은 그대로다', async () => {
    const width = 48;
    const height = 27;
    const colors = [[245, 241, 232], [30, 41, 59], [61, 95, 196], [225, 29, 72], [255, 255, 255]];
    const scene = n => frameOf(width, height, colors, (x, y) => {
        const dx = x - (6 + n * 3);
        const dy = y - 13;
        if (dx * dx + dy * dy <= 4) return dx * dx + dy * dy <= 1 ? 3 : 4; // 움직이는 점(가운데 빨강, 흰 테두리)
        if (y === 13) return 1;
        return (x < 10 || x > 37) && y > 8 && y < 18 ? 2 : 0;
    });
    let asked = 0;
    const done = [];
    const result = await G.gifEncodeAnimation({
        width, height, frameCount: 10, frameAt: async n => { asked += 1; return scene(n); }, delay: 14,
        fixedColors: [[225, 29, 72], [255, 255, 255]], onFrame: (k, total) => done.push(`${k}/${total}`)
    });
    assert.deepStrictEqual(plain(result.palette.slice(0, 2)), [[225, 29, 72], [255, 255, 255]]);
    assert.ok(asked >= 10 && asked <= 16, `색 고르기(6장)와 쓰기(10장): ${asked}`);
    assert.deepStrictEqual(done, Array.from({ length: 10 }, (_, k) => `${k + 1}/10`));
    const gif = decodeGif(result.bytes);
    assert.strictEqual(gif.frames.length, result.frames);
    for (let n = 0; n < 10; n++) {
        const want = scene(n);
        for (let i = 0; i < width * height; i++) want.set([...result.palette[result.colorOf(want[i * 4], want[i * 4 + 1], want[i * 4 + 2])], 255], i * 4);
        assert.ok(sameBytes(gif.frames[n].rgba, want), `장면 ${n}`);
        assert.strictEqual(gif.frames[n].delay, 14);
    }
    await assert.rejects(G.gifEncodeAnimation({ width, height, frameCount: 0, frameAt: () => null }), /장면이 없습니다/);
});

test('매끈한 그러데이션(어두운 남색·밝은 바탕): 색 칸이 4단계씩이라 계단 띠 없이 이어지고(이웃 점 차이 5 이하, 원래 색과 3 이하), 풀면 장면마다 색표 번호 그대로다', async () => {
    const width = 320;
    const height = 6;
    for (const [from, to, name] of [[[15, 23, 42], [30, 58, 138], '어두운 남색'], [[248, 250, 252], [186, 200, 222], '밝은 바탕']]) {
        const base = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) base.set([...from.map((v, c) => Math.round(v + (to[c] - v) * x / (width - 1))), 255], (y * width + x) * 4);
        }
        const scene = n => { // 그러데이션 위를 지나가는 작은 점
            const out = base.slice();
            for (let x = 10 + n * 4; x < 14 + n * 4; x++) out.set([225, 29, 72, 255], (2 * width + x) * 4);
            return out;
        };
        const result = await G.gifEncodeAnimation({ width, height, frameCount: 4, frameAt: scene, delay: 10, fixedColors: [[225, 29, 72], [255, 255, 255]] });
        const gif = decodeGif(result.bytes);
        const row = gif.frames[0].rgba.subarray(0, width * 4); // 점이 지나가지 않는 맨 윗줄
        let error = 0;
        let step = 0;
        const shades = new Set();
        for (let x = 0; x < width; x++) {
            shades.add(`${row[x * 4]},${row[x * 4 + 1]},${row[x * 4 + 2]}`);
            for (let c = 0; c < 3; c++) {
                error = Math.max(error, Math.abs(row[x * 4 + c] - base[x * 4 + c]));
                if (x) step = Math.max(step, Math.abs(row[x * 4 + c] - row[(x - 1) * 4 + c]));
            }
        }
        assert.ok(error <= 3 && step <= 5 && shades.size >= 30, `${name}: 원래 색과 차이 ${error}, 이웃 점 차이 ${step}, 색 ${shades.size}개`);
        for (let n = 0; n < 4; n++) {
            const want = scene(n);
            for (let i = 0; i < width * height; i++) want.set([...result.palette[result.colorOf(want[i * 4], want[i * 4 + 1], want[i * 4 + 2])], 255], i * 4);
            assert.ok(sameBytes(gif.frames[n].rgba, want), `${name} 장면 ${n}`);
        }
    }
});

test('base64: 브라우저 btoa가 있든 없든 Buffer와 같은 글이다(조각 경계·채움 글자)', () => {
    const withBtoa = load({ withBtoa: true });
    for (const length of [0, 1, 2, 3, 4, 5, 24575, 24576, 24577, 100001]) {
        const bytes = new Uint8Array(length).map(() => Math.floor(random() * 256));
        const want = Buffer.from(bytes).toString('base64');
        assert.strictEqual(G.gifBase64(bytes), want, `직접 ${length}`);
        assert.strictEqual(withBtoa.gifBase64(bytes), want, `btoa ${length}`);
    }
});

(async () => {
    for (const { name, fn } of pending) {
        count++;
        try {
            await fn();
            console.log(`ok - ${name}`);
        } catch (e) {
            failed++;
            console.log(`FAIL - ${name}\n  ${e.stack || e.message}`);
        }
    }
    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
