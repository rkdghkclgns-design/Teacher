// gif-encoder.js - 여러 장면(RGBA 점 배열)을 움직이는 GIF(GIF89a) 파일 바이트로 만든다(움직이는 GIF, image-motion.js)
// 화면(DOM)을 쓰지 않는 계산만 있어 node 테스트에서 그대로 돈다(tests/gif-encoder.test.js).
// - 색: 여러 장면에서 고른 점으로 중앙값 자르기를 해 공통 색표 하나(최대 255색 + 투명 1칸)를 만들고, 가까운 색은 32×32×32 표에 적어 둔다
// - 장면: 첫 장면은 통째로, 다음 장면은 앞 장면과 달라진 곳만 잘라 넣는다(달라지지 않은 점은 투명, 앞 장면은 그대로 두기 1). 똑같은 장면은 앞 장면 시간에 더한다
// - 끝없이 되풀이(NETSCAPE2.0). LZW는 코드 길이를 늘려 가며 쓰고 코드 표가 차면 지우기 코드를 넣는다

const GIF_MAX_COLORS = 255; // 색표의 256번째 칸은 투명(앞 장면과 같은 점)
const GIF_MAX_CODE = 4096; // LZW 코드 표 크기(12비트)
const GIF_HASH_SIZE = 8192; // LZW 코드 찾기 표(2의 거듭제곱, 코드 표의 두 배)
const GIF_BINS = 32768; // 가까운 색 표: 빛깔마다 5비트(32×32×32)
const GIF_SAMPLE_LIMIT = 240000; // 색을 고를 때 모으는 점 수 상한
const GIF_MIN_DELAY = 2; // 장면 시간(1/100초). 브라우저는 1 이하를 0.1초로 읽는다
const GIF_MAX_DELAY = 65535;
const GIF_MAX_SIDE = 65535;
const GIF_CHANNEL = [bin => bin >> 10, bin => (bin >> 5) & 31, bin => bin & 31];

// 빛깔마다 5비트로 묶은 칸 번호
const gifBin = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

// 바이트를 모으는 그릇. 모자라면 두 배로 늘린다
function gifByteSink(initial = 1 << 16) {
    let buf = new Uint8Array(initial);
    let length = 0;
    const room = more => {
        if (length + more <= buf.length) return;
        let size = buf.length * 2;
        while (size < length + more) size *= 2;
        const next = new Uint8Array(size);
        next.set(buf.subarray(0, length));
        buf = next;
    };
    return {
        byte(value) {
            room(1);
            buf[length++] = value & 255;
        },
        word(value) {
            room(2);
            buf[length++] = value & 255;
            buf[length++] = (value >> 8) & 255;
        },
        bytes(list) {
            room(list.length);
            buf.set(list, length);
            length += list.length;
        },
        text(str) {
            for (let i = 0; i < str.length; i++) this.byte(str.charCodeAt(i));
        },
        result: () => buf.slice(0, length)
    };
}

/* ---------- 색 고르기: 중앙값 자르기 ---------- */
// 상자: 든 칸, 점 수, 가장 넓은 빛깔(자를 쪽), 자를 차례를 정하는 점수(점 수 × 부피)
function gifBox(bins, counts) {
    const low = [31, 31, 31];
    const high = [0, 0, 0];
    let total = 0;
    for (const bin of bins) {
        total += counts[bin];
        for (let c = 0; c < 3; c++) {
            const value = GIF_CHANNEL[c](bin);
            if (value < low[c]) low[c] = value;
            if (value > high[c]) high[c] = value;
        }
    }
    const ranges = high.map((value, c) => value - low[c]);
    const axis = ranges.indexOf(Math.max(...ranges));
    return { bins, total, axis, score: total * (ranges[0] + 1) * (ranges[1] + 1) * (ranges[2] + 1) };
}

// 가장 넓은 빛깔 쪽으로 늘어놓고 점 수의 절반에서 둘로 자른다(양쪽 모두 칸이 하나 이상 남는다)
function gifSplitBox(box, counts) {
    const value = GIF_CHANNEL[box.axis];
    const sorted = [...box.bins].sort((a, b) => value(a) - value(b) || a - b);
    let seen = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
        seen += counts[sorted[i]];
        cut = i + 1;
        if (seen * 2 >= box.total) break;
    }
    return [gifBox(sorted.slice(0, cut), counts), gifBox(sorted.slice(cut), counts)];
}

// RGB 점(r, g, b, r, g, b, …) → 대표 색 목록(최대 maxColors개). 빛깔을 5비트로 묶은 칸에서 상자를 자르고, 대표 색은 상자에 든 점의 평균이다.
// 칸이 하나뿐인 상자는 더 자르지 않으므로 색이 적은 그림은 그 색 그대로 나온다
function gifMedianCut(samples, maxColors = GIF_MAX_COLORS) {
    const limit = Math.max(0, Math.min(GIF_MAX_COLORS, Math.floor(Number(maxColors) || 0)));
    if (!limit) return [];
    const counts = new Float64Array(GIF_BINS);
    const sums = new Float64Array(GIF_BINS * 3);
    for (let i = 0; i + 2 < samples.length; i += 3) {
        const bin = gifBin(samples[i], samples[i + 1], samples[i + 2]);
        counts[bin] += 1;
        sums[bin * 3] += samples[i];
        sums[bin * 3 + 1] += samples[i + 1];
        sums[bin * 3 + 2] += samples[i + 2];
    }
    const used = [];
    for (let bin = 0; bin < GIF_BINS; bin++) if (counts[bin]) used.push(bin);
    if (!used.length) return [];
    const boxes = [gifBox(used, counts)];
    while (boxes.length < limit) {
        let pick = -1;
        for (let i = 0; i < boxes.length; i++) {
            if (boxes[i].bins.length > 1 && (pick < 0 || boxes[i].score > boxes[pick].score)) pick = i;
        }
        if (pick < 0) break;
        boxes.splice(pick, 1, ...gifSplitBox(boxes[pick], counts));
    }
    return boxes.map(box => {
        let n = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (const bin of box.bins) {
            n += counts[bin];
            r += sums[bin * 3];
            g += sums[bin * 3 + 1];
            b += sums[bin * 3 + 2];
        }
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    });
}

const gifColorKey = rgb => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
const isGifColor = rgb => Array.isArray(rgb) && rgb.length === 3 && rgb.every(value => Number.isInteger(value) && value >= 0 && value <= 255);

// 공통 색표: 꼭 넣을 색(fixed: [[r, g, b], …], 같은 색은 한 번) 다음에 점에서 고른 색. 꼭 넣을 색과 똑같은 점은 고르는 데서 뺀다. 같은 색은 한 번만 둔다
function gifBuildPalette(samples, fixed = [], maxColors = GIF_MAX_COLORS) {
    const limit = Math.max(1, Math.min(GIF_MAX_COLORS, Math.floor(Number(maxColors) || 0)));
    const palette = [];
    const seen = new Set();
    for (const rgb of fixed) {
        if (!isGifColor(rgb) || seen.has(gifColorKey(rgb)) || palette.length >= limit) continue;
        seen.add(gifColorKey(rgb));
        palette.push([...rgb]);
    }
    const rest = new Uint8Array(samples.length - (samples.length % 3));
    let filled = 0;
    for (let i = 0; i + 2 < samples.length; i += 3) {
        if (seen.has((samples[i] << 16) | (samples[i + 1] << 8) | samples[i + 2])) continue;
        rest[filled++] = samples[i];
        rest[filled++] = samples[i + 1];
        rest[filled++] = samples[i + 2];
    }
    for (const rgb of gifMedianCut(rest.subarray(0, filled), limit - palette.length)) {
        if (seen.has(gifColorKey(rgb))) continue;
        seen.add(gifColorKey(rgb));
        palette.push(rgb);
    }
    if (!palette.length) palette.push([0, 0, 0]);
    return palette;
}

// 색 → 색표 번호. 칸(5비트씩)마다 처음 한 번만 가장 가까운 색을 찾아 표에 적는다(칸 가운데 색으로 찾아 점의 차례와 상관없이 같은 답).
// 색표의 색은 먼저 제 칸에 적어 둔다(앞 칸이 이긴다). 그래서 색표에 있는 색의 점은 늘 그 색이 된다
function gifColorMapper(palette) {
    const count = palette.length;
    const reds = new Int32Array(count);
    const greens = new Int32Array(count);
    const blues = new Int32Array(count);
    palette.forEach((rgb, i) => {
        reds[i] = rgb[0];
        greens[i] = rgb[1];
        blues[i] = rgb[2];
    });
    const cache = new Int16Array(GIF_BINS).fill(-1);
    palette.forEach((rgb, i) => {
        const bin = gifBin(rgb[0], rgb[1], rgb[2]);
        if (cache[bin] < 0) cache[bin] = i;
    });
    const nearest = bin => {
        const r = (GIF_CHANNEL[0](bin) << 3) | 4;
        const g = (GIF_CHANNEL[1](bin) << 3) | 4;
        const b = (GIF_CHANNEL[2](bin) << 3) | 4;
        let best = 0;
        let bestDistance = Infinity;
        for (let i = 0; i < count; i++) {
            const dr = r - reds[i];
            const dg = g - greens[i];
            const db = b - blues[i];
            const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = i;
            }
        }
        cache[bin] = best;
        return best;
    };
    return {
        index(r, g, b) {
            const bin = gifBin(r, g, b);
            const known = cache[bin];
            return known >= 0 ? known : nearest(bin);
        },
        // RGBA 점 배열 → 색표 번호 배열(점마다 하나). 알파는 보지 않는다(장면은 불투명하게 그린다)
        indices(rgba, out = new Uint8Array(rgba.length >> 2)) {
            for (let p = 0, q = 0; q < out.length; p += 4, q++) {
                const bin = ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3);
                const known = cache[bin];
                out[q] = known >= 0 ? known : nearest(bin);
            }
            return out;
        }
    };
}

/* ---------- LZW ---------- */
// 색 번호 배열을 GIF의 그림 자료로 sink에 쓴다: 최소 코드 길이 1바이트, 255바이트 이하 조각들, 끝 0.
// 코드는 낮은 비트부터 채운다. 새 코드가 지금 길이에 들어가지 않으면 길이를 늘리고(12비트까지), 표가 차면 지우기 코드를 넣고 다시 시작한다
function gifLzw(indices, minCodeSize, sink) {
    const clear = 1 << minCodeSize;
    const end = clear + 1;
    const keys = new Int32Array(GIF_HASH_SIZE);
    const codes = new Int16Array(GIF_HASH_SIZE);
    const block = new Uint8Array(255);
    let blockLength = 0;
    let acc = 0;
    let bits = 0;
    let size = minCodeSize + 1;
    let next = end + 1;
    const pushByte = value => {
        block[blockLength++] = value;
        if (blockLength === 255) {
            sink.byte(255);
            sink.bytes(block);
            blockLength = 0;
        }
    };
    const emit = code => {
        acc |= code << bits;
        bits += size;
        while (bits >= 8) {
            pushByte(acc & 255);
            acc >>>= 8;
            bits -= 8;
        }
    };
    const reset = () => {
        keys.fill(-1);
        size = minCodeSize + 1;
        next = end + 1;
    };
    sink.byte(minCodeSize);
    reset();
    emit(clear);
    if (indices.length) {
        let prefix = indices[0];
        for (let i = 1; i < indices.length; i++) {
            const k = indices[i];
            const key = (prefix << 8) | k;
            let slot = Math.imul(key, 0x9e3779b1) >>> 19;
            while (keys[slot] !== -1 && keys[slot] !== key) slot = (slot + 1) & (GIF_HASH_SIZE - 1);
            if (keys[slot] === key) {
                prefix = codes[slot];
                continue;
            }
            emit(prefix);
            if (next < GIF_MAX_CODE) {
                if (next >= 1 << size && size < 12) size += 1;
                keys[slot] = key;
                codes[slot] = next++;
            } else {
                emit(clear);
                reset();
            }
            prefix = k;
        }
        emit(prefix);
        if (next >= 1 << size && size < 12) size += 1; // 읽는 쪽은 마지막 코드를 읽고 표를 늘린 뒤의 길이로 끝 코드를 읽는다
    }
    emit(end);
    if (bits > 0) pushByte(acc & 255);
    if (blockLength) {
        sink.byte(blockLength);
        sink.bytes(block.subarray(0, blockLength));
    }
    sink.byte(0);
}

/* ---------- 장면 쓰기 ---------- */
// 앞 장면과 달라진 점을 모두 담는 가장 작은 사각형. 같으면 null
function gifChangedBox(previous, current, width, height) {
    let top = -1;
    let bottom = -1;
    let left = width;
    let right = -1;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        let first = -1;
        for (let x = 0; x < width; x++) {
            if (previous[row + x] !== current[row + x]) {
                first = x;
                break;
            }
        }
        if (first < 0) continue;
        let last = first;
        for (let x = width - 1; x > first; x--) {
            if (previous[row + x] !== current[row + x]) {
                last = x;
                break;
            }
        }
        if (top < 0) top = y;
        bottom = y;
        if (first < left) left = first;
        if (last > right) right = last;
    }
    return top < 0 ? null : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

// 사각형 안의 점: 달라진 점은 새 색, 같은 점은 투명
function gifCropChanges(previous, current, width, box, transparent) {
    const out = new Uint8Array(box.w * box.h);
    let at = 0;
    for (let y = box.y; y < box.y + box.h; y++) {
        const row = y * width;
        for (let x = box.x; x < box.x + box.w; x++) {
            const i = row + x;
            out[at++] = previous[i] === current[i] ? transparent : current[i];
        }
    }
    return out;
}

const gifDelay = value => Math.min(GIF_MAX_DELAY, Math.max(GIF_MIN_DELAY, Math.round(Number(value) || 0)));

// 장면을 차례로 받아 GIF 바이트로 쓴다. palette: [[r, g, b], …](255색 이하), 투명 칸은 palette.length번. loop: 되풀이 횟수(0은 끝없이)
// add(색 번호 배열, 시간)는 받은 배열을 그대로 붙잡으니 장면마다 새 배열을 준다. finish()는 { bytes, frames: 쓴 장면 수 }
function gifWriter({ width, height, palette, loop = 0 }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > GIF_MAX_SIDE || height > GIF_MAX_SIDE) {
        throw new Error('GIF 크기가 올바르지 않습니다.');
    }
    if (!Array.isArray(palette) || !palette.length || palette.length > GIF_MAX_COLORS || !palette.every(isGifColor)) {
        throw new Error('GIF 색표가 올바르지 않습니다.');
    }
    const transparent = palette.length;
    let tableBits = 1;
    while (1 << tableBits < palette.length + 1) tableBits += 1;
    const minCodeSize = Math.max(2, tableBits);
    const sink = gifByteSink();
    sink.text('GIF89a');
    sink.word(width);
    sink.word(height);
    sink.byte(0x80 | ((tableBits - 1) << 4) | (tableBits - 1)); // 공통 색표 있음, 색 깊이, 색표 크기
    sink.byte(transparent);
    sink.byte(0);
    for (let i = 0; i < 1 << tableBits; i++) {
        const rgb = palette[i] || [0, 0, 0];
        sink.byte(rgb[0]);
        sink.byte(rgb[1]);
        sink.byte(rgb[2]);
    }
    sink.byte(0x21);
    sink.byte(0xff);
    sink.byte(11);
    sink.text('NETSCAPE2.0');
    sink.byte(3);
    sink.byte(1);
    sink.word(Math.max(0, Math.min(GIF_MAX_DELAY, Math.floor(Number(loop) || 0))));
    sink.byte(0);
    let previous = null;
    let pending = null; // 다음 장면을 볼 때까지 시간이 정해지지 않은 장면
    let frames = 0;
    const writeFrame = frame => {
        sink.byte(0x21);
        sink.byte(0xf9);
        sink.byte(4);
        sink.byte((1 << 2) | (frame.transparent ? 1 : 0)); // 그대로 두기(1), 투명 칸을 쓰는지
        sink.word(frame.delay);
        sink.byte(frame.transparent ? transparent : 0);
        sink.byte(0);
        sink.byte(0x2c);
        sink.word(frame.x);
        sink.word(frame.y);
        sink.word(frame.w);
        sink.word(frame.h);
        sink.byte(0);
        gifLzw(frame.pixels, minCodeSize, sink);
        frames += 1;
    };
    return {
        add(indices, delay) {
            if (!(indices instanceof Uint8Array) || indices.length !== width * height) throw new Error('장면 크기가 GIF 크기와 다릅니다.');
            const time = gifDelay(delay);
            if (!previous) {
                pending = { x: 0, y: 0, w: width, h: height, pixels: indices, delay: time, transparent: false };
                previous = indices;
                return;
            }
            const box = gifChangedBox(previous, indices, width, height);
            if (!box) {
                pending.delay = Math.min(GIF_MAX_DELAY, pending.delay + time);
                return;
            }
            writeFrame(pending);
            pending = { ...box, pixels: gifCropChanges(previous, indices, width, box, transparent), delay: time, transparent: true };
            previous = indices;
        },
        finish() {
            if (pending) writeFrame(pending);
            pending = null;
            sink.byte(0x3b);
            return { bytes: sink.result(), frames };
        }
    };
}

/* ---------- 장면들 → GIF ---------- */
// 색을 고를 장면: 처음부터 끝까지 고르게 count장
function gifSamplePicks(frameCount, count) {
    const picks = new Set();
    const n = Math.max(1, Math.min(frameCount, Math.floor(Number(count) || 1)));
    for (let k = 0; k < n; k++) picks.add(Math.floor(k * frameCount / n));
    return [...picks];
}

// frameAt(i)는 i번째 장면의 RGBA 점 배열(width×height×4)을 돌려준다(약속이어도 된다). 색은 sampleFrames장의 점을 고르게 모아 고른다.
// delay: 장면 시간(1/100초, 장면마다 다르면 배열). onFrame(쓴 장면 수, 모든 장면 수)은 장면마다 기다린다(화면에 진행을 보이고 숨을 돌린다)
// 돌려줌: { bytes, frames(실제로 쓴 장면 수), palette, colorOf(r, g, b) → 색표 번호 }
async function gifEncodeAnimation({ width, height, frameCount, frameAt, delay = 10, fixedColors = [], sampleFrames = 6, loop = 0, onFrame = null }) {
    const count = Math.floor(Number(frameCount) || 0);
    if (count < 1 || typeof frameAt !== 'function') throw new Error('GIF로 만들 장면이 없습니다.');
    const pixels = width * height;
    const picks = gifSamplePicks(count, sampleFrames);
    const step = Math.max(1, Math.ceil(picks.length * pixels / GIF_SAMPLE_LIMIT));
    const samples = new Uint8Array(Math.ceil(pixels / step) * picks.length * 3);
    let filled = 0;
    for (const [n, index] of picks.entries()) {
        const rgba = await frameAt(index);
        for (let p = n % step; p < pixels; p += step) {
            samples[filled++] = rgba[p * 4];
            samples[filled++] = rgba[p * 4 + 1];
            samples[filled++] = rgba[p * 4 + 2];
        }
    }
    const palette = gifBuildPalette(samples.subarray(0, filled), fixedColors);
    const mapper = gifColorMapper(palette);
    const writer = gifWriter({ width, height, palette, loop });
    for (let i = 0; i < count; i++) {
        const rgba = await frameAt(i);
        writer.add(mapper.indices(rgba, new Uint8Array(pixels)), Array.isArray(delay) ? delay[i] : delay);
        if (typeof onFrame === 'function') await onFrame(i + 1, count);
    }
    const { bytes, frames } = writer.finish();
    return { bytes, frames, palette, colorOf: mapper.index };
}

/* ---------- base64 (data URL) ---------- */
const GIF_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const GIF_BASE64_CHUNK = 3 * 8192; // 3의 배수라 조각 사이에 채움 글자(=)가 끼지 않는다

// 바이트 → base64 글. 브라우저의 btoa가 있으면 조각마다 쓰고, 없으면 직접 바꾼다
function gifBase64(bytes) {
    const parts = [];
    for (let start = 0; start < bytes.length; start += GIF_BASE64_CHUNK) {
        const piece = bytes.subarray(start, Math.min(bytes.length, start + GIF_BASE64_CHUNK));
        if (typeof btoa === 'function') {
            parts.push(btoa(String.fromCharCode.apply(null, piece)));
            continue;
        }
        let out = '';
        for (let i = 0; i < piece.length; i += 3) {
            const a = piece[i];
            const b = i + 1 < piece.length ? piece[i + 1] : 0;
            const c = i + 2 < piece.length ? piece[i + 2] : 0;
            out += GIF_BASE64[a >> 2] + GIF_BASE64[((a & 3) << 4) | (b >> 4)]
                + (i + 1 < piece.length ? GIF_BASE64[((b & 15) << 2) | (c >> 6)] : '=')
                + (i + 2 < piece.length ? GIF_BASE64[c & 63] : '=');
        }
        parts.push(out);
    }
    return parts.join('');
}

if (typeof window !== 'undefined') {
    Object.assign(window, { gifMedianCut, gifBuildPalette, gifColorMapper, gifLzw, gifWriter, gifEncodeAnimation, gifBase64, gifChangedBox });
}
