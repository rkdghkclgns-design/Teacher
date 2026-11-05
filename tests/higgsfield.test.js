// Higgsfield 이미지 생성과 중계 테스트 (실행: node tests/higgsfield.test.js)
// 앱 쪽은 fetch만 스텁으로 두고 실제 파일을 실행한다. 중계는 Worker 모듈을 그대로 불러 Request/Response로 확인한다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');
const root = path.join(__dirname, '..');

const RELAY = 'https://relay.test';
const IMAGE = 'https://cdn.higgsfield.ai/out/a.png';
const ORIGIN = 'https://rkdghkclgns-design.github.io';
const PNG = () => new Blob([Buffer.from('PNGDATA')], { type: 'image/png' });

function makeContext(fetchStub, stored = {}) {
    const storage = { ...stored };
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: fn => setTimeout(fn, 0), clearTimeout, Promise, URL, Blob,
        FileReader: class {
            readAsDataURL(blob) {
                blob.arrayBuffer().then(buf => {
                    this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
                    this.onload();
                });
            }
        },
        localStorage: { getItem: key => storage[key] ?? null, setItem: (key, value) => { storage[key] = String(value); }, removeItem: key => { delete storage[key]; } },
        fetch: (...args) => ctx.fetchStub(...args),
        fetchStub,
        storage, toasts: [], alerts: [],
        document: { getElementById: () => null }
    };
    ctx.window = ctx;
    ctx.showToast = message => ctx.toasts.push(message);
    ctx.showAlert = message => ctx.alerts.push(message);
    vm.createContext(ctx);
    ['data.js', 'higgsfield.js'].forEach(file => vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), ctx));
    return ctx;
}

const ready = { higgsfield_api_key: 'kid:ksecret', higgsfield_relay_url: RELAY };
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// 제출 → 상태(queued…completed) → 결과 내려받기 흐름을 흉내 낸다
function fakeHiggsfield({ statuses = ['queued', 'in_progress', 'completed'], cdnBlocked = false, submit = jsonResponse({ status: 'queued', request_id: 'req-1' }) } = {}) {
    const calls = [];
    let polls = 0;
    const stub = async (url, init = {}) => {
        const target = String(url);
        calls.push({ url: target, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
        if (target === IMAGE) {
            if (cdnBlocked) throw new TypeError('Failed to fetch');
            return new Response(PNG());
        }
        if (target.startsWith(`${RELAY}/media?url=`)) return new Response(PNG());
        if (target.startsWith(`${RELAY}/requests/`)) {
            const status = statuses[Math.min(polls++, statuses.length - 1)];
            return jsonResponse(status === 'completed' ? { status, request_id: 'req-1', images: [{ url: IMAGE }] } : { status, request_id: 'req-1' });
        }
        if (target.startsWith(`${RELAY}/`)) return submit;
        throw new Error(`예상하지 못한 호출: ${target}`);
    };
    return { stub, calls };
}

const call = (ctx, name) => vm.runInContext(name, ctx);
const plain = value => JSON.parse(JSON.stringify(value));

async function run(name, fn) {
    await fn();
    console.log('PASS', name);
}

(async () => {
    await run('설정: 키와 중계 주소 형식을 맞추고 저장한다', async () => {
        const ctx = makeContext(async () => { throw new Error('호출되면 안 됨'); });
        const update = call(ctx, 'updateHiggsfieldSetting');
        assert.strictEqual(call(ctx, 'normalizeHiggsfieldKey')('Key abc-1:sec_2'), 'abc-1:sec_2', '"Key " 머리말을 붙여 넣어도 받는다');
        assert.strictEqual(call(ctx, 'normalizeHiggsfieldKey')('abc'), null, '비밀값이 없으면 받지 않는다');
        assert.strictEqual(call(ctx, 'normalizeHiggsfieldRelay')('https://x.workers.dev/'), 'https://x.workers.dev');
        assert.strictEqual(call(ctx, 'normalizeHiggsfieldRelay')('http://localhost:8787'), 'http://localhost:8787', '내 컴퓨터 시험용');
        assert.strictEqual(call(ctx, 'normalizeHiggsfieldRelay')('http://example.com'), null, 'https가 아니면 받지 않는다');
        assert.strictEqual(plain(update('abc', '')).ok, false);
        assert.strictEqual(plain(update('kid:ksecret', 'ftp://x')).ok, false);
        assert.strictEqual(plain(update(' Key kid:ksecret ', 'https://x.workers.dev/')).ok, true);
        assert.deepStrictEqual([ctx.storage.higgsfield_api_key, ctx.storage.higgsfield_relay_url], ['kid:ksecret', 'https://x.workers.dev']);
        assert.strictEqual(call(ctx, 'higgsfieldReady')(), true);
        update('', '');
        assert.ok(!('higgsfield_api_key' in ctx.storage) && call(ctx, 'higgsfieldReady')() === false, '빈 칸으로 저장하면 지운다');
    });

    await run('생성: 중계로 요청하고 끝날 때까지 기다린 뒤 이미지를 내려받는다', async () => {
        const { stub, calls } = fakeHiggsfield();
        const ctx = makeContext(stub, ready);
        const data = await call(ctx, 'generateHiggsfieldImage')('higgsfield:recraft', '교실에서 토론하는 학생들');
        assert.strictEqual(data, `data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}`);
        const submit = calls[0];
        assert.strictEqual(submit.url, `${RELAY}/recraft/v4.1/text-to-image`);
        assert.strictEqual(submit.method, 'POST');
        assert.strictEqual(submit.headers.Authorization, 'Key kid:ksecret');
        assert.deepStrictEqual(JSON.parse(submit.body), { prompt: '교실에서 토론하는 학생들', aspect_ratio: '16:9', output_format: 'png' });
        assert.strictEqual(calls.filter(item => item.url === `${RELAY}/requests/req-1/status`).length, 3, '완료될 때까지 상태를 묻는다');
        assert.strictEqual(calls.at(-1).url, IMAGE, '결과 주소에서 바로 받는다');
        const soul = fakeHiggsfield();
        const soulCtx = makeContext(soul.stub, ready);
        await call(soulCtx, 'generateHiggsfieldImage')('higgsfield:soul', 'a'.repeat(3000));
        const body = JSON.parse(soul.calls[0].body);
        assert.strictEqual(soul.calls[0].url, `${RELAY}/higgsfield-ai/soul/v2/standard`);
        assert.strictEqual(body.resolution, '1080p');
        assert.strictEqual(body.prompt.length, 2000, '모델 상한에 맞춰 자른다');
    });

    await run('그림 형식: 서버가 형식 뒤에 매개변수·대문자를 붙여도 data URL에는 형식만 쓴다(다음에 열 때 그림을 지우지 않게)', async () => {
        const body = Buffer.from('PNGDATA');
        const ctx = makeContext(async () => new Response(body, { headers: { 'Content-Type': 'Image/PNG; charset=binary' } }), ready);
        assert.strictEqual(await call(ctx, 'higgsfieldImageData')(IMAGE), `data:image/png;base64,${body.toString('base64')}`);
        const asBlob = call(ctx, 'asImageBlob');
        assert.strictEqual(asBlob(new Blob(['x'], { type: 'image/png; charset=binary' }), IMAGE).type, 'image/png');
        const bare = new Blob(['x'], { type: 'image/webp' });
        assert.strictEqual(asBlob(bare, IMAGE), bare, '형식만 있으면 그대로');
        assert.strictEqual(asBlob(new Blob(['x'], { type: 'text/plain; charset=utf-8' }), 'https://cdn.test/a.webp?x=1').type, 'image/webp', '그림 형식이 아니면 주소의 확장자로');
        assert.strictEqual(asBlob(new Blob(['x'], { type: '' }), 'https://cdn.test/a.txt'), null);
    });

    await run('생성: 저장소가 브라우저 요청을 막으면 중계로 내려받는다', async () => {
        const { stub, calls } = fakeHiggsfield({ cdnBlocked: true });
        const ctx = makeContext(stub, ready);
        assert.ok((await call(ctx, 'generateHiggsfieldImage')('higgsfield:grok', '그림')).startsWith('data:image/png;base64,'));
        assert.strictEqual(calls.at(-1).url, `${RELAY}/media?url=${encodeURIComponent(IMAGE)}`);
    });

    await run('생성: 거절·키 오류·설정 누락은 이유를 담아 실패한다', async () => {
        const nsfw = makeContext(fakeHiggsfield({ statuses: ['queued', 'nsfw'] }).stub, ready);
        await assert.rejects(call(nsfw, 'generateHiggsfieldImage')('higgsfield:recraft', '그림'), /부적절한 내용/);
        const denied = makeContext(fakeHiggsfield({ submit: jsonResponse({ detail: 'Invalid credentials' }, 401) }).stub, ready);
        await assert.rejects(call(denied, 'generateHiggsfieldImage')('higgsfield:recraft', '그림'), /401: 키가 맞지 않습니다/);
        const empty = makeContext(fakeHiggsfield().stub);
        await assert.rejects(call(empty, 'generateHiggsfieldImage')('higgsfield:recraft', '그림'), /키와 중계 주소/);
        await assert.rejects(call(nsfw, 'generateHiggsfieldImage')('higgsfield:none', '그림'), /알 수 없는 Higgsfield 모델/);
        const offline = makeContext(async () => { throw new TypeError('Failed to fetch'); }, ready);
        await assert.rejects(call(offline, 'generateHiggsfieldImage')('higgsfield:recraft', '그림'), /중계에 연결하지 못했습니다/);
    });

    await run('생성: 상태 조회의 일시 오류는 다시 묻는다', async () => {
        let polls = 0;
        const stub = async url => {
            const target = String(url);
            if (target === IMAGE) return new Response(PNG());
            if (target.includes('/requests/')) {
                polls += 1;
                if (polls < 3) return jsonResponse({ error: '중계 오류' }, 502);
                return jsonResponse({ status: 'completed', images: [{ url: IMAGE }] });
            }
            return jsonResponse({ status: 'queued', request_id: 'req-1' });
        };
        const ctx = makeContext(stub, ready);
        assert.ok((await call(ctx, 'generateHiggsfieldImage')('higgsfield:recraft', '그림')).startsWith('data:image/png'));
        assert.strictEqual(polls, 3);
    });

    await run('생성: 상태를 묻는 동안 중지하면 기다림과 조회를 끊는다(중계 연결 오류로 보이지 않는다)', async () => {
        // 중지한 뒤에 또 물으면 완료로 답해, 중지를 무시하는 코드는 그림을 받아 이 테스트에 걸린다(끝없이 묻지 않는다)
        const stoppable = abortOnPoll => {
            const controller = new AbortController();
            const seen = { polls: 0, submitSignal: null };
            const stub = async (url, init = {}) => {
                const target = String(url);
                if (target === IMAGE) return new Response(PNG());
                if (target.includes('/requests/')) {
                    seen.polls += 1;
                    if (seen.polls > 1) return jsonResponse({ status: 'completed', images: [{ url: IMAGE }] });
                    controller.abort();
                    if (abortOnPoll) throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
                    return jsonResponse({ status: 'queued', request_id: 'req-1' });
                }
                seen.submitSignal = init.signal;
                return jsonResponse({ status: 'queued', request_id: 'req-1' });
            };
            return { controller, seen, ctx: makeContext(stub, ready) };
        };
        for (const abortOnPoll of [false, true]) {
            const { controller, seen, ctx } = stoppable(abortOnPoll);
            await assert.rejects(call(ctx, 'generateHiggsfieldImage')('higgsfield:recraft', '고양이', { signal: controller.signal }),
                err => err.name === 'AbortError' && !/중계에 연결하지 못했습니다/.test(err.message));
            assert.strictEqual(seen.polls, 1, '중지한 뒤에는 상태를 다시 묻지 않는다');
            assert.strictEqual(seen.submitSignal, controller.signal, '요청을 보낼 때도 같은 신호를 넘긴다');
        }
    });

    await run('연결 확인: 없는 요청을 물어 키와 중계를 확인한다', async () => {
        const check = async (response, stored = ready) => plain(await call(makeContext(async () => response, stored), 'checkHiggsfieldConnection')());
        assert.strictEqual((await check(jsonResponse({ detail: 'Request not found' }, 404))).ok, true, 'Higgsfield가 없는 요청이라고 답하면 통한 것');
        assert.ok((await check(jsonResponse({ detail: 'Invalid credentials' }, 401))).message.includes('키가 맞지 않습니다'));
        assert.strictEqual((await check(jsonResponse({ error: '중계하지 않는 경로입니다.' }, 404))).ok, false, '다른 서버의 404는 통한 것이 아니다');
        assert.ok((await check(jsonResponse({ error: '이 중계는 등록한 앱 주소에서 온 요청만 받습니다.' }, 403))).message.includes('등록한 앱 주소'));
        assert.strictEqual((await check(jsonResponse({}), {})).ok, false, '설정이 없으면 부르지 않는다');
    });

    await run('중계: 정해 둔 호출만 등록한 출처에서 받아 Higgsfield로 넘긴다', async () => {
        const worker = (await import(pathToFileURL(path.join(root, 'relay', 'higgsfield-relay.mjs')).href)).default;
        const upstream = [];
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (url, init = {}) => {
            upstream.push({ url: String(url), init });
            return String(url).startsWith('https://cdn.') ? new Response(PNG()) : jsonResponse({ status: 'queued', request_id: 'r1' });
        };
        try {
            const send = (target, init = {}, env = {}) => worker.fetch(new Request(`https://relay.test${target}`, init), env);
            const preflight = await send('/recraft/v4.1/text-to-image', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
            assert.strictEqual(preflight.status, 204);
            assert.strictEqual(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
            assert.ok(preflight.headers.get('Access-Control-Allow-Headers').includes('Authorization'));

            const posted = await send('/recraft/v4.1/text-to-image', { method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Key a:b', 'Content-Type': 'application/json' }, body: '{"prompt":"x"}' });
            assert.strictEqual(posted.status, 200);
            assert.strictEqual(posted.headers.get('Access-Control-Allow-Origin'), ORIGIN);
            assert.deepStrictEqual(await posted.json(), { status: 'queued', request_id: 'r1' });
            assert.strictEqual(upstream[0].url, 'https://api.higgsfield.ai/recraft/v4.1/text-to-image');
            assert.strictEqual(upstream[0].init.headers.Authorization, 'Key a:b', '받은 키를 그대로 넘긴다');
            assert.strictEqual(upstream[0].init.body, '{"prompt":"x"}');

            const id = '11111111-2222-3333-4444-555555555555';
            assert.strictEqual((await send(`/requests/${id}/status`, { headers: { Origin: ORIGIN, Authorization: 'Key a:b' } })).status, 200);
            assert.strictEqual(upstream[1].url, `https://api.higgsfield.ai/requests/${id}/status`);

            const before = upstream.length;
            assert.strictEqual((await send('/recraft/v4.1/text-to-image', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403, '등록하지 않은 출처');
            assert.strictEqual((await send('/recraft/v4.1/text-to-image', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).status, 403);
            assert.strictEqual((await send('/recraft/v4.1/text-to-image', { headers: { Origin: ORIGIN } })).status, 404, '모델 경로는 POST만');
            assert.strictEqual((await send(`/requests/${id}/status`, { method: 'POST', headers: { Origin: ORIGIN } })).status, 404);
            assert.strictEqual((await send('/requests/../status', { headers: { Origin: ORIGIN } })).status, 404);
            assert.strictEqual((await send(`/media?url=${encodeURIComponent('https://example.com/a.png')}`, { headers: { Origin: ORIGIN } })).status, 400, 'Higgsfield 저장소만 대신 받는다');
            assert.strictEqual((await send(`/media?url=${encodeURIComponent('http://cdn.higgsfield.ai/a.png')}`, { headers: { Origin: ORIGIN } })).status, 400);
            assert.strictEqual(upstream.length, before, '막은 요청은 Higgsfield로 보내지 않는다');

            const media = await send(`/media?url=${encodeURIComponent(IMAGE)}`, { headers: { Origin: ORIGIN } });
            assert.strictEqual(media.status, 200);
            assert.strictEqual(media.headers.get('Content-Type'), 'image/png');
            const local = await send('/recraft/v4.1/text-to-image', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3102' } }, { ALLOWED_ORIGINS: 'http://localhost:3102' });
            assert.strictEqual(local.status, 204, '변수로 출처를 더할 수 있다');
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    console.log('ALL PASSED');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
