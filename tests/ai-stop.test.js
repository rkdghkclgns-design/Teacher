// AI 호출 중지·다시 보내기·그림 한도·채우기 작업 테스트 (실행: node tests/ai-stop.test.js)
// 실제 callGemini·fetchWithRetry·processImageTags를 돌리고 fetch만 가짜로 둔다. 키는 가짜 값만 쓴다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', 'js') + path.sep;
const FILES = ['data.js', 'ai-errors.js', 'claude.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'cost-estimate.js', 'api.js'];

function makeContext() {
    const elements = {};
    const store = {};
    const fakeElement = () => ({
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', disabled: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
        remove() { this.removed = true; if (elements[this.id] === this) delete elements[this.id]; }
    });
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        Promise, URL, Uint16Array, Blob, AbortController, Response,
        localStorage: { getItem: key => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); }, removeItem: key => { delete store[key]; } },
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''),
        saveState: async () => { ctx.saved += 1; },
        showLessonView() {},
        lessonDesignBrief: () => '',
        lessonGenBrief: () => '',
        archiveContent: async () => {},
        DBManager: { getCache: async () => null, setCache: async () => {} },
        usesSvgIllustration: () => false,
        elements, store, fakeElement,
        saved: 0, rendered: 0,
        alerts: [], toasts: [], confirms: [], appended: [],
        waits: [], cleared: [], fetched: [], holdTimers: false,
        document: {
            readyState: 'complete', hidden: false, title: '',
            body: { appendChild: el => { ctx.appended.push(el); if (el.id) elements[el.id] = el; } },
            createElement: fakeElement,
            getElementById: id => elements[id] || null,
            addEventListener() {}, removeEventListener() {},
            querySelectorAll: () => [], querySelector: () => null
        }
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = message => ctx.toasts.push(message);
    // 다시 보내기 전 기다림은 바로 넘긴다. holdTimers면 1초 넘는 기다림은 끝나지 않는다(중지로만 끝난다)
    ctx.setTimeout = (fn, ms) => { ctx.waits.push(ms); return ctx.holdTimers && ms >= 1000 ? -1 : setTimeout(fn, 0); };
    ctx.clearTimeout = id => { ctx.cleared.push(id); if (id !== -1) clearTimeout(id); };
    ctx.fetch = (url, init = {}) => { ctx.fetched.push({ url: String(url), init }); return ctx.fetchStub(String(url), init); };
    ctx.fetchStub = async () => { throw new Error('fetchStub를 정하지 않았습니다'); };
    vm.createContext(ctx);
    FILES.forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), ctx));
    // api.js가 함수 선언으로 화면 함수를 덮으므로 불러온 뒤에 스텁으로 바꾼다
    vm.runInContext("apiKey = 'AIza-FAKE-TEST-KEY'; globalState = { subjects: [] }; currentSubjectId = null; currentEditingModuleId = null; courseData = []; getEditingModule = (id = currentEditingModuleId) => id === 'mainQuest' ? (globalState.subjects.find(s => s.id === currentSubjectId) || {}).mainQuest : courseData.find(m => String(m.id) === String(id)); renderEditor = () => { window.rendered += 1; }; renderSidebar = () => {};", ctx);
    ctx.confirmAsync = async message => { ctx.confirms.push(message); return true; };
    return ctx;
}

const ctx = makeContext();
const call = name => vm.runInContext(name, ctx);
const plain = value => JSON.parse(JSON.stringify(value));

const CONTENTS = [{ role: 'user', parts: [{ text: '질문' }] }];
const IMAGE_MODELS = ['gemini-nano-banana-2.1', 'gemini-3-pro-image', 'gemini-3.1-flash-image'];
const isImageUrl = url => IMAGE_MODELS.some(model => url.includes(`/${model}:`));
const textReply = text => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
const IMAGE_REPLY = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'QUJD' } }] } }] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const quotaBody = (limit, quotaId) => JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: ' + limit + ', model: gemini-nano-banana-2.1', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '41s' }] } });
const PER_MINUTE = () => new Response(quotaBody(15, 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'), { status: 429 });
const ZERO = () => new Response(quotaBody(0, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'), { status: 429 });
const DAILY = () => new Response(quotaBody(250, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'), { status: 429 });
const INTENT = () => json(textReply('{"search_query":"x"}'));
const BLOCK_NOTICE = '그림 모델을 더 쓸 수 없어 남은 그림은 건너뜁니다. 그림 자리는 그대로 둡니다.';
const abortRejection = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

// 단계 사이에 남은 상태를 지운다(그림 작업 기록·중지 상태·기록한 호출)
function reset() {
    call('endImageRun')();
    call('resetTabGenStop')();
    ctx.holdTimers = false;
    ['waits', 'cleared', 'fetched', 'toasts', 'alerts', 'confirms', 'appended'].forEach(key => { ctx[key].length = 0; });
    ctx.saved = 0;
    ctx.rendered = 0;
}

async function waitFor(condition, label) {
    for (let i = 0; i < 200; i++) {
        if (condition()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`기다려도 되지 않음: ${label}`);
}

async function run(name, fn) {
    reset();
    await fn();
    console.log('PASS', name);
}

(async () => {
    await run('다시 보내기: 분당 한도는 서버가 알려 준 시간만큼 기다렸다 보내고, 한도 0·하루 한도는 바로 멈춘다', async () => {
        const replies = [PER_MINUTE(), json(textReply('됐습니다'))];
        ctx.fetchStub = async () => replies.shift();
        const data = await call('callGemini')('gemini-3.8-flash', { contents: CONTENTS });
        assert.strictEqual(call('extractText')(data), '됐습니다');
        assert.strictEqual(ctx.fetched.length, 2);
        assert.ok(ctx.waits.includes(41000), `retryDelay를 따른다: ${ctx.waits}`);

        ctx.fetched.length = 0;
        ctx.fetchStub = async () => ZERO();
        await assert.rejects(call('callGemini')('gemini-3.8-flash', { contents: CONTENTS }), err => err.quota === 'zero' && err.message.includes('무료 사용량 0'));
        assert.strictEqual(ctx.fetched.length, 1, '한도 0은 다시 보내지 않는다');

        ctx.fetched.length = 0;
        ctx.fetchStub = async () => DAILY();
        await assert.rejects(call('callGemini')('gemini-3.8-flash', { contents: CONTENTS }), err => err.quota === 'daily');
        assert.strictEqual(ctx.fetched.length, 1, '하루 한도도 다시 보내지 않는다');

        ctx.fetched.length = 0;
        ctx.fetchStub = async () => new Response('busy', { status: 503 });
        await assert.rejects(call('callGemini')('gemini-3.8-flash', { contents: CONTENTS, attempts: 2 }), err => err.status === 503);
        assert.strictEqual(ctx.fetched.length, 2, 'attempts만큼만 보낸다');
    });

    await run('호출 설정은 요청 본문에 싣지 않는다(signal·waitSignal·attempts·timing·pinModel·taskRole)', async () => {
        ctx.fetchStub = async () => json(textReply('ok'));
        const controller = new AbortController();
        const waiter = new AbortController();
        await call('callGemini')('gemini-3.8-flash', { contents: CONTENTS, signal: controller.signal, waitSignal: waiter.signal, attempts: 2, timing: 'short', pinModel: true, taskRole: 'fast' });
        const sent = ctx.fetched[0];
        const body = JSON.parse(sent.init.body);
        ['signal', 'waitSignal', 'attempts', 'timing', 'pinModel', 'taskRole'].forEach(key => assert.ok(!(key in body), key));
        assert.ok(body.contents, '요청 내용은 그대로');
        assert.strictEqual(sent.init.signal, controller.signal, '보낸 호출을 끊을 신호는 fetch에 넘긴다');
        await call('callGemini')('gemini-3.8-flash', { contents: CONTENTS, waitSignal: waiter.signal });
        assert.strictEqual(ctx.fetched[1].init.signal, undefined, '기다림만 끊는 신호는 fetch에 넘기지 않는다');
    });

    await run('중지: 받던 호출을 끊으면 앱 문구의 AbortError로 끝난다(인터넷 오류로 보이지 않는다)', async () => {
        ctx.fetchStub = (url, init) => new Promise((resolve, reject) => {
            if (init.signal?.aborted) return reject(abortRejection());
            init.signal?.addEventListener('abort', () => reject(abortRejection()), { once: true });
        });
        const controller = new AbortController();
        const pending = call('callGemini')('gemini-3.8-flash', { contents: CONTENTS, signal: controller.signal });
        await waitFor(() => ctx.fetched.length === 1, '첫 호출');
        controller.abort();
        await assert.rejects(pending, err => err.name === 'AbortError' && err.message === '중지했습니다.' && !err.message.includes('인터넷'));
        await assert.rejects(call('callGemini')('gemini-3.8-flash', { contents: CONTENTS, signal: controller.signal }), { name: 'AbortError' });
        assert.strictEqual(ctx.fetched.length, 1, '이미 끊긴 신호면 보내지 않는다');
    });

    await run('중지: 다시 보내려고 기다리던 호출은 기다림을 끊고 다시 보내지 않는다', async () => {
        ctx.holdTimers = true;
        ctx.fetchStub = async () => new Response('busy', { status: 503 });
        const controller = new AbortController();
        const pending = call('callGemini')('gemini-3.8-flash', { contents: CONTENTS, waitSignal: controller.signal });
        await waitFor(() => ctx.waits.includes(1500), '다시 보내기 기다림');
        controller.abort();
        await assert.rejects(pending, { name: 'AbortError' });
        assert.strictEqual(ctx.fetched.length, 1);
        assert.ok(ctx.cleared.length > 0, '기다리던 타이머를 지운다');
    });

    await run('걸린 시간: 짧은 호출은 모델#short로 따로 잰다', async () => {
        delete ctx.store['teacher:ai-timing'];
        ctx.fetchStub = () => new Promise(resolve => setTimeout(() => resolve(json(textReply('ok'))), 5));
        await call('callGemini')('gemini-3.8-flash', { contents: CONTENTS, timing: 'short' });
        assert.deepStrictEqual(Object.keys(JSON.parse(ctx.store['teacher:ai-timing'])), ['gemini-3.8-flash#short']);
        await call('callGemini')('gemini-3.8-flash', { contents: CONTENTS });
        assert.ok('gemini-3.8-flash' in JSON.parse(ctx.store['teacher:ai-timing']));
    });

    await run('그림 생성: 작업 밖에서는 모델마다 한 번만 다시 보내고 실패를 알린다(15·30초 기다림 없음)', async () => {
        ctx.fetchStub = async url => (isImageUrl(url) ? PER_MINUTE() : INTENT());
        assert.strictEqual(await call('generateImageAPI')('그림'), null);
        assert.strictEqual(ctx.fetched.length, 6, '그림 모델 3개 × 2번');
        assert.ok(!ctx.waits.includes(15000) && !ctx.waits.includes(30000), `${ctx.waits}`);
        assert.ok(ctx.toasts.at(-1).startsWith('⚠️ 이미지 생성 실패'), ctx.toasts.at(-1));
    });

    await run('그림 작업: 그림 모델이 모두 막히면 한 번 알리고 그 작업 동안 다시 부르지 않는다', async () => {
        assert.strictEqual(call('beginImageRun')(), true);
        assert.strictEqual(call('beginImageRun')(), false, '이미 열려 있으면 연 쪽이 아니다');
        ctx.fetchStub = async url => (isImageUrl(url) ? ZERO() : INTENT());
        assert.strictEqual(await call('generateImageAPI')('그림'), null);
        assert.strictEqual(ctx.fetched.length, 3, '한도 0은 모델마다 한 번만');
        assert.strictEqual(call('imageGenerationBlocked')(), true);
        assert.strictEqual(ctx.toasts.filter(message => message === BLOCK_NOTICE).length, 1);
        assert.ok(!ctx.toasts.some(message => message.includes('⚠️ 이미지 생성 실패')));
        assert.strictEqual(await call('generateImageAPI')('그림'), null);
        assert.strictEqual(ctx.fetched.length, 3, '막힌 뒤에는 부르지 않는다');
        assert.strictEqual(ctx.toasts.filter(message => message === BLOCK_NOTICE).length, 1, '알림은 한 번');
        assert.ok(call('imageRunNote')().includes("'SVG 삽화'"), call('imageRunNote')());
        call('endImageRun')();
        assert.strictEqual(call('imageGenerationBlocked')(), false, '작업이 끝나면 잊는다');

        call('beginImageRun')();
        ctx.fetched.length = 0;
        ctx.fetchStub = async url => (url.includes('/gemini-nano-banana-2.1:') ? ZERO() : json(IMAGE_REPLY));
        assert.strictEqual(await call('generateImageAPI')('그림'), 'data:image/png;base64,QUJD');
        ctx.fetched.length = 0;
        await call('generateImageAPI')('그림');
        assert.ok(!ctx.fetched.some(item => item.url.includes('/gemini-nano-banana-2.1:')), '막힌 모델은 건너뛴다');
        assert.strictEqual(call('imageGenerationBlocked')(), false, '다른 모델로 그렸으면 막힌 것이 아니다');
    });

    await run('그림 작업: Higgsfield 잔액 부족(402)은 막힘으로 보고 충전하라고 안내한다', async () => {
        vm.runInContext("IMAGE_MODEL = 'higgsfield:recraft'; apiKey = ''; generateHiggsfieldImage = async () => { throw Object.assign(new Error('Higgsfield 402: API 잔액이 부족합니다'), { status: 402 }); };", ctx);
        try {
            call('beginImageRun')();
            assert.strictEqual(await call('generateImageAPI')('그림'), null);
            assert.strictEqual(call('imageGenerationBlocked')(), true);
            assert.ok(call('imageRunNote')().includes('잔액(크레딧)'), call('imageRunNote')());
        } finally {
            vm.runInContext("IMAGE_MODEL = 'gemini-nano-banana-2.1'; apiKey = 'AIza-FAKE-TEST-KEY';", ctx);
        }
    });

    const BLOCK_MD = [
        '## 1. 첫째', '', '<!-- [IMG: "one"] -->', '', '본문입니다.', '',
        '## 2. 둘째', '', '<!-- [IMG: "two"] -->', '', '본문입니다.', '',
        '## 3. 셋째', '', '<!-- [IMG: "three"] -->', '', '본문입니다.', '',
        '## 학습 목표', '', '<!-- [IMG: "goal"] -->', '', '- 목표입니다.', '',
        '## 4. 넷째', '', '<!-- [IMG: "local:img_1"] -->', '', '본문입니다.'
    ].join('\n');
    const fillTags = (md, opts = {}) => call('processImageTags')({ id: 1, images: {} }, md, { amount: 'all', isStopped: () => false, ...opts });

    await run('그림 처리: 막히고 검색 키도 없으면 남은 자리는 부르지 않고 남기며, 끝 알림 대신 작업 끝 안내에 센다', async () => {
        call('beginImageRun')();
        ctx.fetchStub = async url => (isImageUrl(url) ? ZERO() : INTENT());
        const stats = { made: 0, failed: 0 };
        const statuses = [];
        const out = await fillTags(BLOCK_MD, { stats, onStatus: text => statuses.push(text) }); // 작업은 진행 막대에 장수를 보인다
        assert.ok(statuses[0].includes('이미지 1/3'), statuses[0]);
        ['"one"', '"two"', '"three"', '"goal"', '"local:img_1"'].forEach(tag => assert.ok(out.includes(`<!-- [IMG: ${tag}] -->`), tag));
        assert.strictEqual(ctx.fetched.filter(item => !isImageUrl(item.url)).length, 1, '검색어 정하기는 첫 자리 한 번');
        assert.strictEqual(ctx.fetched.filter(item => isImageUrl(item.url)).length, 3, '그림 모델은 막히기 전까지 한 번씩');
        assert.deepStrictEqual(stats, { made: 0, failed: 0 });
        assert.ok(call('imageRunNote')().startsWith('그림 자리 3개는 그림 없이 남겼습니다.'), call('imageRunNote')());
        assert.deepStrictEqual(ctx.toasts, [BLOCK_NOTICE], '막힘 알림 하나만');
    });

    await run('그림 처리: 그림 모델이 막혀도 검색 키가 있으면 검색으로 채우고, 못 찾은 자리만 남긴다', async () => {
        vm.runInContext("window.realSearchPixabay = searchPixabayAPI; pixabayApiKey = 'FAKE'; searchPixabayAPI = async () => ({ b64: 'data:image/png;base64,QUJD', source: 'x', vendor: 'Pixabay' });", ctx);
        try {
            call('beginImageRun')();
            IMAGE_MODELS.forEach(model => call('markImageBlocked')(model, { quota: 'zero' }));
            ctx.fetchStub = async url => (isImageUrl(url) ? json(IMAGE_REPLY) : INTENT());
            const md = '## 1. 첫째\n\n<!-- [IMG: "a"] -->\n\n## 2. 둘째\n\n<!-- [IMG: "b"] -->';
            const out = await fillTags(md);
            assert.ok(!out.includes('<!-- [IMG:'), '두 자리 모두 검색으로 채운다');
            assert.ok(!ctx.fetched.some(item => isImageUrl(item.url)), '그림 모델은 부르지 않는다');

            vm.runInContext('window.pixabayCalls = 0; searchPixabayAPI = async () => (++window.pixabayCalls === 1 ? { b64: "data:image/png;base64,QUJD", source: "x", vendor: "Pixabay" } : null);', ctx);
            const before = vm.runInContext('_imageRun.left', ctx);
            const partly = await fillTags(md);
            assert.ok(!partly.includes('<!-- [IMG: "a"] -->') && partly.includes('<!-- [IMG: "b"] -->'), '못 찾은 자리는 남긴다');
            assert.strictEqual(vm.runInContext('_imageRun.left', ctx), before + 1);
            assert.ok(!ctx.fetched.some(item => isImageUrl(item.url)));
        } finally {
            vm.runInContext("pixabayApiKey = ''; searchPixabayAPI = window.realSearchPixabay;", ctx);
        }
    });

    await run('그림 처리: 검색 키가 있으면 막힘 알림은 교안 그림을 검색으로만 찾는다고 말하고, 실제로 검색으로 채운다', async () => {
        vm.runInContext("window.realSearchPixabay = searchPixabayAPI; pixabayApiKey = 'FAKE'; window.pixabayCalls = 0; searchPixabayAPI = async () => (++window.pixabayCalls === 1 ? null : { b64: 'data:image/png;base64,QUJD', source: 'x', vendor: 'Pixabay' });", ctx);
        try {
            call('beginImageRun')();
            ctx.fetchStub = async url => (isImageUrl(url) ? ZERO() : INTENT());
            const out = await fillTags('## 1. 첫째\n\n<!-- [IMG: "a"] -->\n\n본문입니다.\n\n## 2. 둘째\n\n<!-- [IMG: "b"] -->\n\n본문입니다.', { onStatus: () => {} }); // 작업은 진행 막대에 장수를 보인다
            assert.deepStrictEqual(ctx.toasts, ['그림 모델을 더 쓸 수 없어 남은 교안 그림은 검색으로만 찾습니다. 못 찾은 자리는 그대로 둡니다.']);
            assert.ok(out.includes('<!-- [IMG: "a"] -->') && !out.includes('<!-- [IMG: "b"] -->'), '막힌 자리는 남기고 다음 자리는 검색으로 채운다');
        } finally {
            vm.runInContext("pixabayApiKey = ''; searchPixabayAPI = window.realSearchPixabay;", ctx);
        }
    });

    await run('그림 처리: 다시 보내기 안내는 까닭(사용 한도·호출 실패)을 맞게 말한다', async () => {
        const statuses = [];
        const once = failure => {
            let first = true;
            return async url => {
                if (!isImageUrl(url)) return INTENT();
                if (first) {
                    first = false;
                    return failure();
                }
                return json(IMAGE_REPLY);
            };
        };
        ctx.fetchStub = once(PER_MINUTE);
        await fillTags('## 1. 첫째\n\n<!-- [IMG: "a"] -->\n\n본문입니다.', { onStatus: text => statuses.push(text) });
        assert.ok(statuses.some(text => text.includes('그림 모델 사용 한도에 걸려 41초 뒤 한 번 더 해 봅니다')), JSON.stringify(statuses));
        ctx.fetchStub = once(() => new Response('busy', { status: 503 }));
        await fillTags('## 1. 첫째\n\n<!-- [IMG: "a"] -->\n\n본문입니다.', { onStatus: text => statuses.push(text) });
        assert.ok(statuses.some(text => text.includes('그림 모델 호출이 실패해 2초 뒤 한 번 더 해 봅니다')), JSON.stringify(statuses));
        assert.ok(!statuses.some(text => text.includes('응답하지 않아')), '답을 받은 한도 오류를 응답이 없다고 하지 않는다');
    });

    await run('그림 작업 끝 안내: 슬라이드 그림만 못 만들었으면 일괄 이미지 찾기가 아니라 슬라이드에서 채우라고 한다', async () => {
        call('beginImageRun')();
        ctx.fetchStub = async url => (isImageUrl(url) ? DAILY() : INTENT());
        assert.strictEqual(await call('generateImageAPI')('슬라이드 그림'), null); // 교수안 슬라이드 그림에서 처음 막힌다
        call('noteSlideImagesLeft')(2);
        const slidesOnly = call('imageRunNote')();
        assert.strictEqual(slidesOnly, '교수안 슬라이드 그림 2장은 만들지 못했습니다. 오늘 쓸 수 있는 그림 모델 사용량을 다 썼습니다. 내일 슬라이드 스튜디오에서 빈 이미지 칸에 AI 그림을 넣거나 교수안을 다시 만드세요.');
        assert.ok(!slidesOnly.includes('일괄 이미지 찾기') && !slidesOnly.includes('그림 자리'), '교안에 남지 않은 자리를 일괄 작업으로 채우라고 하지 않는다');
        vm.runInContext('_imageRun.left = 3;', ctx);
        const both = call('imageRunNote')();
        assert.ok(both.startsWith('그림 자리 3개는 그림 없이 남겼습니다. 교수안 슬라이드 그림 2장은 만들지 못했습니다.'), both);
        assert.ok(both.includes("내일 '일괄 이미지 찾기'(차시)나 '콘텐츠 정리'(교과 전체)로 채우세요. 슬라이드 그림은 슬라이드 스튜디오에서"), both);
        call('endImageRun')();
        call('noteSlideImagesLeft')(5);
        assert.strictEqual(call('imageRunNote')(), '', '작업 밖에서는 적지 않는다');
    });

    await run('그림 처리: 그리는 중에 중지하면 그 호출을 끊고 자리는 그대로 남긴다', async () => {
        call('resetTabGenStop')();
        ctx.fetchStub = (url, init) => {
            if (!isImageUrl(url)) return Promise.resolve(INTENT());
            call('requestTabGenerationStop')();
            return new Promise((resolve, reject) => {
                if (init.signal?.aborted) return reject(abortRejection());
                init.signal?.addEventListener('abort', () => reject(abortRejection()), { once: true });
            });
        };
        const out = await call('processImageTags')({ id: 1, images: {} }, '## 1. 첫째\n\n<!-- [IMG: "a"] -->\n\n본문입니다.', { amount: 'all' });
        assert.ok(out.includes('<!-- [IMG: "a"] -->'), out);
        assert.ok(!out.includes('이미지 확보 실패') && !out.includes('이미지 영역'), '실패 자리로 바꾸지 않는다');
        assert.ok(ctx.toasts.some(message => message.includes('남겨 두었습니다')), JSON.stringify(ctx.toasts));
        assert.strictEqual(call('aiStopSignal')().aborted, true);
        call('resetTabGenStop')();
        assert.strictEqual(call('aiStopSignal')().aborted, false, '다음 생성은 새 신호로 시작한다');
        assert.strictEqual(call('isTabGenerationStopped')(), false);
    });

    await run('그림 처리: 남은 자리를 채울 때는 태그를 보태지 않아 이미 그림이 있는 섹션에 또 그리지 않는다', async () => {
        ctx.fetchStub = async url => (isImageUrl(url) ? json(IMAGE_REPLY) : INTENT());
        const md = '## 1. 첫째\n\n<div class="image-wrapper"><img src="local:img_9"></div>\n\n본문입니다.\n\n## 2. 둘째\n\n<!-- [IMG: "two"] -->\n\n본문입니다.';
        await fillTags(md, { inject: false });
        assert.strictEqual(ctx.fetched.filter(item => isImageUrl(item.url)).length, 1);
        ctx.fetched.length = 0;
        await fillTags(md, { inject: true });
        assert.strictEqual(ctx.fetched.filter(item => isImageUrl(item.url)).length, 2, '새로 만든 글에서는 빈 섹션에 태그를 보탠다');
    });

    await run('그림 처리: 키워드와 AI 설명을 HTML로 이스케이프하고 $ 기호를 바꿀 규칙으로 읽지 않는다', async () => {
        const realCache = ctx.DBManager;
        ctx.DBManager = { getCache: async () => { throw new Error('캐시 실패'); }, setCache: async () => {} };
        try {
            ctx.fetchStub = async () => INTENT();
            const out = await fillTags('## 1. 본문\n\n<!-- [IMG: "<b>x</b>"] -->\n\n설명입니다.');
            assert.ok(out.includes('이미지 확보 실패: &lt;b&gt;x&lt;/b&gt;') && out.includes('🔄 다시 검색'), out);
            assert.ok(!out.includes('<b>x</b>'));
        } finally {
            ctx.DBManager = realCache;
        }
        ctx.fetchStub = async url => (isImageUrl(url) ? json(IMAGE_REPLY) : json(textReply('{"search_query":"x","reasoning":"가 $& 나"}')));
        const made = await fillTags('## 1. 본문\n\n<!-- [IMG: "그림"] -->\n\n설명입니다.');
        assert.ok(made.includes('가 $&amp; 나'), made);
        assert.ok(!made.includes('<!-- [IMG:'), '그림 설명의 $&가 태그 글로 펼쳐지지 않는다');
    });

    await run('그림 자리: 글 위주 섹션과 local: 태그는 빼고, 이미지 양으로 고른다', async () => {
        const md = '## 학습 목표\n\n<!-- [IMG: "goal"] -->\n\n## 1. 첫째\n\n<!-- [IMG: "a"] -->\n\n<!-- [IMG: "b"] -->\n\n<!-- [IMG: "local:img_2"] -->\n\n## 2. 둘째\n\n<!-- [IMG: "c"] -->';
        const pending = amount => plain(call('pendingImageTags')(md, amount)).map(tag => tag.keyword);
        assert.deepStrictEqual(pending(), ['a', 'b', 'c']);
        assert.deepStrictEqual(pending('section'), ['a', 'c']);
        assert.deepStrictEqual(pending('none'), []);
    });

    await run('그림 자리 수: 탭이 있으면 탭마다, 옛 본문·최종 평가는 본문 하나로 센다', async () => {
        const empty = { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null };
        const tabbedText = '## 1. 가\n\n<!-- [IMG: "a"] -->\n\n<!-- [IMG: "b"] -->';
        const count = (mod, ...args) => call('countImageSlots')(mod, ...args);
        assert.strictEqual(count({ tabContents: { ...empty, basicLearn: tabbedText }, content: tabbedText }), 2);
        assert.strictEqual(count({ content: '## 1. 가\n\n<!-- [IMG: "a"] -->' }), 1, '탭 없는 옛 본문을 탭 다섯 번으로 세지 않는다');
        const prac = '## 1. 실습\n\n<!-- [IMG: "p"] -->';
        assert.strictEqual(count({ tabContents: { ...empty, basicPrac: prac }, content: prac }), 1, '합친 본문을 기본 학습으로 또 세지 않는다');
        assert.deepStrictEqual(plain(call('lessonTextParts')({ id: 'mainQuest', content: '## 과제\n\n본문' })), [{ id: 'basicLearn', label: '본문' }]);
        const broken = { content: '## 1. 가\n\n<!- [IMG: "y"] -->' };
        assert.strictEqual(count(broken), 0);
        assert.strictEqual(count(broken, undefined, text => text.replace('<!- [IMG: "y"] -->', '<!-- [IMG: "y"] -->')), 1, '정리한 뒤의 글로 센다');
    });

    await run('채우기 끝 알림: 넣은 장수, 못 만든 곳, 남긴 자리를 함께 말한다', async () => {
        const summary = (stats, slots) => plain(call('imageFillSummary')(stats, slots));
        const left = summary({ made: 0, failed: 0 }, 3);
        assert.ok(left.kind === 'warning' && left.text.includes('그대로 남겨 두었습니다'), left.text);
        assert.strictEqual(left.text, '넣은 그림은 없습니다. 그림 자리 3개는 그대로 남겨 두었습니다.', '하나도 못 넣었으면 0장이라고 하지 않는다');
        const mixed = summary({ made: 2, failed: 1 }, 5).text;
        assert.ok(mixed.includes('2장') && mixed.includes('1곳') && mixed.includes('2개'), mixed);
        const none = summary({ made: 0, failed: 2 }, 2);
        assert.ok(none.kind === 'error' && none.text.startsWith('그림을 하나도 넣지 못했습니다(2곳)'), none.text);
        assert.deepStrictEqual(summary({ made: 3, failed: 0 }, 3), { text: '그림 3장을 넣었습니다.', kind: 'success' });
    });

    // 콘텐츠 정리용 교과: A(탭, 그림 자리 1) · C(그림 자리 없음, 서식도 그대로) · 최종 평가(본문, 그림 자리 1)
    const tagged = '## 1. 첫째\n\n본문입니다.\n\n<!-- [IMG: "a"] -->\n\n더 씁니다.';
    const plainText = '## 1. 셋째\n\n본문입니다.';
    const tabsOf = basicLearn => ({ basicLearn, basicPrac: null, advLearn: null, advPrac: null, assessment: null });
    function cleanupSubject({ editing = null } = {}) {
        const A = { id: 1, title: '차시 A', images: {}, tabContents: tabsOf(tagged), content: tagged };
        const C = { id: 2, title: '차시 C', images: {}, tabContents: tabsOf(plainText), content: plainText };
        const MQ = { id: 'mainQuest', title: '👑 최종 평가', images: {}, content: '## 1. 과제\n\n<!-- [IMG: "m"] -->\n\n설명입니다.' };
        const s1 = { id: 's1', title: '기획', lessons: [A, C], mainQuest: MQ };
        ctx.globalState = { subjects: [s1] };
        ctx.currentSubjectId = 's1';
        ctx.courseData = s1.lessons;
        ctx.currentEditingModuleId = editing;
        ctx.elements['editor-loading'] = ctx.fakeElement();
        delete ctx.elements['lesson-pipeline-bar'];
        return { A, C, MQ, s1 };
    }
    const sanitize = text => call('sanitizeMarkdownContent')(text);

    await run('콘텐츠 정리: 화면을 막지 않고 교과의 차시와 최종 평가의 남은 그림 자리를 이미지 양과 상관없이 채운다', async () => {
        assert.strictEqual(sanitize(plainText), plainText, 'C는 서식 정리로 바뀌지 않는 글');
        assert.strictEqual(sanitize(tagged), tagged, 'A도 서식 정리로 바뀌지 않는 글');
        vm.runInContext("LESSON_IMAGE_AMOUNT = 'none';", ctx);
        try {
            const { A, MQ } = cleanupSubject();
            let blocked = false;
            ctx.fetchStub = async url => {
                blocked = blocked || ctx.elements['editor-loading'].style.display === 'flex';
                return isImageUrl(url) ? json(IMAGE_REPLY) : INTENT();
            };
            await call('sanitizeAllContent')();
            assert.ok(ctx.confirms[0].includes('아직 채우지 않은 그림 자리 2개') && ctx.confirms[0].includes('그림: 2장'), ctx.confirms[0]);
            assert.ok(ctx.confirms[0].includes("'기획'의 차시 2개와 최종 평가에서"), ctx.confirms[0]);
            assert.ok(!blocked && ctx.elements['editor-loading'].style.display !== 'flex', '전체 화면을 막지 않는다');
            const bar = ctx.appended.find(el => el.id === 'lesson-pipeline-bar');
            assert.ok(bar && bar.removed, '진행 막대를 띄웠다가 닫는다');
            assert.strictEqual(ctx.fetched.filter(item => !isImageUrl(item.url)).length, 2, '검색어 정하기 2번');
            assert.strictEqual(ctx.fetched.filter(item => isImageUrl(item.url)).length, 2, '그림 2장');
            assert.ok(A.tabContents.basicLearn.includes('local:') && !A.tabContents.basicLearn.includes('<!-- [IMG:'));
            assert.ok(A.content.includes('local:') && !A.content.includes('<!-- [IMG:'), '합친 본문도 다시 만든다');
            assert.ok(MQ.content.includes('local:') && !MQ.content.includes('<!-- [IMG:'), '최종 평가도 채운다');
            assert.strictEqual(ctx.saved, 2, '바뀐 차시만 저장한다(C는 저장하지 않는다)');
            assert.ok(ctx.toasts.at(-1).startsWith('콘텐츠 정리를 마쳤습니다.') && ctx.toasts.at(-1).includes('그림 2장을 넣었습니다'), ctx.toasts.at(-1));
        } finally {
            vm.runInContext("LESSON_IMAGE_AMOUNT = 'section';", ctx);
        }
    });

    await run('콘텐츠 정리: 중지하면 다음 차시로 가지 않고 멈췄다고 알린다', async () => {
        const { MQ } = cleanupSubject();
        let first = true;
        ctx.fetchStub = async url => {
            if (!isImageUrl(url)) return INTENT();
            if (first) call('requestLessonPipelineStop')();
            first = false;
            return json(IMAGE_REPLY);
        };
        await call('sanitizeAllContent')();
        assert.ok(ctx.toasts.at(-1).startsWith('콘텐츠 정리를 멈췄습니다'), ctx.toasts.at(-1));
        assert.ok(MQ.content.includes('<!-- [IMG: "m"] -->'), '최종 평가는 건드리지 않는다');
        assert.ok(ctx.toasts.at(-1).includes('다시 누르면 남은 곳부터'), ctx.toasts.at(-1));
    });

    await run('콘텐츠 정리: 다른 생성이 돌고 있으면 묻지 않고 알린다', async () => {
        cleanupSubject();
        call('beginLessonPipeline')(1);
        try {
            await call('sanitizeAllContent')();
            assert.strictEqual(ctx.alerts.at(-1), '진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
            assert.strictEqual(ctx.confirms.length, 0);
        } finally {
            call('finishLessonPipeline')({ quiet: true });
        }
    });

    await run('콘텐츠 정리: 도중에 다른 교과의 같은 번호 차시를 열면 그 화면을 다시 그리지 않는다', async () => {
        const { s1 } = cleanupSubject({ editing: 1 });
        const other = { id: 1, title: '다른 교과 차시', images: {}, tabContents: tabsOf('## 다른 글\n\n내용입니다.'), content: '## 다른 글\n\n내용입니다.' };
        ctx.globalState.subjects = [s1, { id: 's2', title: '다른 교과', lessons: [other] }];
        let switched = false;
        ctx.fetchStub = async url => {
            if (!switched) {
                switched = true;
                vm.runInContext("currentSubjectId = 's2'; courseData = globalState.subjects[1].lessons;", ctx);
            }
            return isImageUrl(url) ? json(IMAGE_REPLY) : INTENT();
        };
        await call('sanitizeAllContent')();
        assert.ok(switched);
        assert.strictEqual(ctx.rendered, 0, '다른 교과의 1번 차시 화면에 이 교과의 글을 그리지 않는다');
        assert.strictEqual(other.content, '## 다른 글\n\n내용입니다.', '다른 교과 차시는 그대로');
    });

    await run('일괄 이미지 찾기: 남은 자리 수를 그대로 예고하고 끝에 넣은 장수를 알린다', async () => {
        const text = '## 1. 첫째\n\n<!-- [IMG: "a"] -->\n\n본문입니다.';
        const mod = { id: 7, title: '차시', images: {}, tabContents: tabsOf(text), content: text };
        ctx.globalState = { subjects: [{ id: 's1', title: '기획', lessons: [mod] }] };
        ctx.currentSubjectId = 's1';
        ctx.courseData = [mod];
        ctx.fetchStub = async url => (isImageUrl(url) ? json(IMAGE_REPLY) : INTENT());
        await call('generateAllImagesInModule')(7);
        assert.ok(ctx.confirms[0].includes('그림: 1장'), ctx.confirms[0]);
        assert.strictEqual(ctx.toasts.at(-1), '일괄 이미지 찾기를 마쳤습니다. 그림 1장을 넣었습니다.');
        assert.ok(!mod.tabContents.basicLearn.includes('<!-- [IMG:'));
        await call('generateAllImagesInModule')(7);
        assert.strictEqual(ctx.toasts.at(-1), '아직 채우지 않은 그림 자리가 없습니다.');
    });

    // 일괄 작업 도중 데이터가 바뀌는 경우: 백업 되살리기(같은 번호의 새 객체), 차시 삭제, 저장 실패
    const withRenders = async fn => {
        const rendered = [];
        ctx.renderedMods = rendered;
        vm.runInContext('renderEditor = mod => { window.rendered += 1; window.renderedMods.push(mod); };', ctx);
        try {
            await fn();
        } finally {
            vm.runInContext('renderEditor = () => { window.rendered += 1; };', ctx);
        }
        return rendered;
    };
    const failSaves = async fn => {
        const realSave = ctx.saveState;
        ctx.saveState = async () => { ctx.saved += 1; return false; }; // 브라우저에 저장하지 못하면 saveState는 false(state.js)
        try {
            await fn();
        } finally {
            ctx.saveState = realSave;
        }
    };
    const imageCalls = () => ctx.fetched.filter(item => isImageUrl(item.url)).length;

    await run('콘텐츠 정리: 도중에 같은 과정을 불러와 바뀌면 옛 차시에 넣지도 그리지도 않고, 넣은 그림 수를 말하지 않는다', async () => {
        const { A } = cleanupSubject({ editing: 1 });
        let restored = null;
        ctx.fetchStub = async url => {
            if (!restored) { // 과정 전체 백업 되살리기: 같은 번호의 새 객체로 바뀐다
                restored = { id: 1, title: '차시 A', images: {}, tabContents: tabsOf(tagged), content: tagged };
                ctx.globalState = { subjects: [{ id: 's1', title: '기획', lessons: [restored], mainQuest: null }] };
                vm.runInContext('courseData = globalState.subjects[0].lessons;', ctx);
            }
            return isImageUrl(url) ? json(IMAGE_REPLY) : INTENT();
        };
        const rendered = await withRenders(() => call('sanitizeAllContent')());
        assert.ok(!rendered.includes(A), '같은 번호로 열린 불러온 차시 화면에 옛 차시를 그리지 않는다');
        assert.strictEqual(restored.tabContents.basicLearn, tagged, '불러온 차시는 그대로');
        assert.strictEqual(ctx.saved, 0);
        assert.strictEqual(imageCalls(), 1, '최종 평가 그림은 부르지 않는다');
        const last = ctx.toasts.at(-1);
        assert.ok(last.startsWith('콘텐츠 정리를 멈췄습니다.') && last.includes('불러와') && !last.includes('그림 1장'), last);
    });

    await run('콘텐츠 정리: 도중에 지운 차시는 넣지 않고 건너뛰며, 끝 알림은 지금 데이터에 넣은 그림만 센다', async () => {
        const { MQ } = cleanupSubject({ editing: 1 });
        let deleted = false;
        ctx.fetchStub = async url => {
            if (!deleted) { // 차시 A를 휴지통으로 옮긴다(열린 교과의 목록에서 빠진다)
                deleted = true;
                vm.runInContext('courseData = courseData.filter(lesson => lesson.id !== 1);', ctx);
            }
            return isImageUrl(url) ? json(IMAGE_REPLY) : INTENT();
        };
        await withRenders(() => call('sanitizeAllContent')());
        assert.ok(MQ.content.includes('local:') && !MQ.content.includes('<!-- [IMG:'), '남은 최종 평가는 채운다');
        assert.strictEqual(ctx.saved, 1, '최종 평가만 저장한다');
        assert.strictEqual(ctx.rendered, 0);
        assert.strictEqual(ctx.toasts.at(-1), '콘텐츠 정리를 마쳤습니다. 고칠 서식은 없었습니다. 그림 1장을 넣었습니다.');
    });

    await run('콘텐츠 정리: 서식을 고친 글 수를 문장으로 말한다', async () => {
        const { s1 } = cleanupSubject();
        const broken = '## 1. 넷째\n\n본문입니다.\n\n<!- [IMG: "d"] -->\n\n더 씁니다.';
        assert.notStrictEqual(sanitize(broken), broken, '서식 정리가 깨진 태그를 고친다');
        s1.lessons.push({ id: 3, title: '차시 D', images: {}, tabContents: tabsOf(broken), content: broken });
        ctx.fetchStub = async url => (isImageUrl(url) ? json(IMAGE_REPLY) : INTENT());
        await call('sanitizeAllContent')();
        assert.ok(ctx.confirms[0].includes('아직 채우지 않은 그림 자리 3개'), ctx.confirms[0]);
        assert.strictEqual(ctx.toasts.at(-1), '콘텐츠 정리를 마쳤습니다. 글 1개의 서식을 고쳤습니다. 그림 3장을 넣었습니다.');
    });

    await run('콘텐츠 정리: 저장하지 못하면 그림을 더 부르지 않고 멈췄다고 알린다', async () => {
        const { MQ } = cleanupSubject();
        ctx.fetchStub = async url => (isImageUrl(url) ? json(IMAGE_REPLY) : INTENT());
        await failSaves(() => call('sanitizeAllContent')());
        assert.strictEqual(ctx.saved, 1, '첫 차시를 저장하지 못하면 멈춘다');
        assert.strictEqual(imageCalls(), 1, '다음 차시의 그림은 부르지 않는다');
        assert.ok(MQ.content.includes('<!-- [IMG: "m"] -->'));
        const last = ctx.toasts.at(-1);
        assert.ok(last.startsWith('저장하지 못해 콘텐츠 정리를 멈췄습니다.') && last.includes('Ctrl+S') && !last.includes('마쳤습니다'), last);
    });

    await run('일괄 이미지 찾기: 도중에 차시를 불러온 내용으로 바뀌면 넣지도 그리지도 않고, 저장하지 못하면 멈춘다', async () => {
        const first = '## 1. 첫째\n\n<!-- [IMG: "a"] -->\n\n본문입니다.';
        const second = '## 2. 실습\n\n<!-- [IMG: "b"] -->\n\n본문입니다.';
        const fresh = () => ({ id: 7, title: '차시', images: {}, tabContents: { ...tabsOf(first), basicPrac: second }, content: first });
        const open = mod => {
            ctx.globalState = { subjects: [{ id: 's1', title: '기획', lessons: [mod] }] };
            ctx.currentSubjectId = 's1';
            ctx.courseData = ctx.globalState.subjects[0].lessons;
            ctx.currentEditingModuleId = 7;
        };
        open(fresh());
        let restored = null;
        ctx.fetchStub = async url => {
            if (!restored) open(restored = fresh()); // 백업 되살리기: 같은 번호의 새 차시가 열린다
            return isImageUrl(url) ? json(IMAGE_REPLY) : INTENT();
        };
        await withRenders(() => call('generateAllImagesInModule')(7));
        assert.strictEqual(ctx.rendered, 0, '불러온 차시 화면에 옛 차시를 그리지 않는다');
        assert.strictEqual(restored.tabContents.basicLearn, first, '불러온 차시는 그대로');
        assert.strictEqual(ctx.saved, 0);
        assert.strictEqual(imageCalls(), 1, '다음 탭 그림은 부르지 않는다');
        assert.ok(ctx.toasts.at(-1).startsWith('일괄 이미지 찾기를 멈췄습니다.') && ctx.toasts.at(-1).includes('불러와'), ctx.toasts.at(-1));

        reset();
        const mod = fresh();
        open(mod);
        ctx.fetchStub = async url => (isImageUrl(url) ? json(IMAGE_REPLY) : INTENT());
        await failSaves(() => call('generateAllImagesInModule')(7));
        assert.strictEqual(ctx.saved, 1);
        assert.strictEqual(imageCalls(), 1, '저장하지 못하면 다음 탭 그림을 부르지 않는다');
        assert.ok(mod.tabContents.basicPrac.includes('<!-- [IMG: "b"] -->'));
        assert.ok(ctx.toasts.at(-1).startsWith('저장하지 못해 일괄 이미지 찾기를 멈췄습니다.'), ctx.toasts.at(-1));
    });

    await run("그림을 못 만든 자리: '다시 검색'은 새 그림을 만들어 누른 자리에 넣고, 찾지 못하면 만들지 않는다", async () => {
        const holder = (text, keyword) => call('imagePlaceholderHtml')(text, keyword);
        const md = `## 학습 목표\n${holder('이미지 영역: 목표 그림', 'goal')}\n- 목표입니다.\n\n## 1. 첫째\n\n본문입니다.\n${holder('이미지 영역: 첫째 그림', 'one')}\n## 2. 둘째\n\n본문입니다.\n${holder('이미지 확보 실패: two', 'two')}\n더 씁니다.`;
        const mod = { id: 5, title: '차시', images: {}, tabContents: tabsOf(md), content: md };
        ctx.globalState = { subjects: [{ id: 's1', title: '기획', lessons: [mod] }] };
        ctx.currentSubjectId = 's1';
        ctx.courseData = [mod];
        ctx.currentEditingModuleId = 5;
        // 화면: 학습 목표의 자리는 첫머리 정리(cleanLessonOpening)로 숨고 두 자리만 보인다
        const spot = text => ({ style: {}, classList: { contains: name => name === 'image-placeholder' }, querySelector: sel => (sel === 'span' ? { textContent: text } : null) });
        const shown = [spot('이미지 영역: 첫째 그림'), spot('이미지 확보 실패: two')];
        ctx.elements['render-view'] = { querySelectorAll: sel => (sel === '.image-placeholder' ? shown : []) };
        const press = async (container, keyword, imgId = null) => {
            const overlay = {
                innerHTML: '', parentNode: container, removed: false,
                closest: sel => (sel === (imgId ? '.image-wrapper' : '.image-placeholder') ? container : null),
                querySelector: sel => (sel === 'textarea' ? { value: '' } : null),
                remove() { this.removed = true; }
            };
            await call('doRegenerateImage')({ closest: sel => (sel === '.prompt-overlay' ? overlay : null) }, keyword, imgId);
            return overlay;
        };
        ctx.fetchStub = async url => (isImageUrl(url) ? json(IMAGE_REPLY) : INTENT());
        try {
            const overlay = await press(shown[1], 'two');
            const ids = Object.keys(mod.images);
            assert.ok(ids.length === 1 && /^img_\d+$/.test(ids[0]), `새 그림 id로 넣는다: ${ids}`);
            const after = mod.tabContents.basicLearn;
            assert.ok(after.includes(`<div class="image-wrapper"><img src="local:${ids[0]}" alt="two"`), after);
            assert.ok(!after.includes('이미지 확보 실패: two') && after.includes('이미지 영역: 첫째 그림') && after.includes('이미지 영역: 목표 그림'), '누른 자리만 바꾼다');
            assert.ok(mod.content.includes(`local:${ids[0]}`), '합친 본문도 다시 만든다');
            assert.strictEqual(ctx.saved, 1);
            assert.strictEqual(ctx.rendered, 1, '보고 있는 탭을 다시 그린다');
            assert.deepStrictEqual(ctx.alerts, []);
            assert.ok(overlay.removed);

            // 화면과 원문의 자리가 맞지 않으면 넣을 곳을 모르므로 그림을 만들지 않는다(비용만 든다)
            ctx.fetched.length = 0;
            const stray = spot('이미지 영역: 엉뚱한 자리');
            shown.splice(0, shown.length, spot('이미지 영역: 첫째 그림'), stray);
            const refused = await press(stray, 'stray');
            assert.ok(refused.removed && ctx.alerts.at(-1).includes('찾지 못했습니다'), ctx.alerts.at(-1));
            assert.strictEqual(ctx.fetched.length, 0);
            assert.strictEqual(mod.tabContents.basicLearn, after, '글은 그대로');

            // 그림 칸의 '다시 찾기'는 그 그림만 바꾼다(빈 id 그림을 만들지 않는다)
            const img = { src: 'old' };
            await press({ querySelector: sel => (sel === 'img' ? img : null) }, 'two', ids[0]);
            await waitFor(() => img.src !== 'old', '그림 칸 바꾸기');
            assert.deepStrictEqual(Object.keys(mod.images), ids);
            assert.strictEqual(mod.images[ids[0]], 'data:image/png;base64,QUJD');
        } finally {
            delete ctx.elements['render-view'];
        }
    });

    /* ---------- 4차 교차 검토: 그리는 동안의 원문 저장, 다른 교과로 옮긴 뒤 끝난 생성, 중지 신호, 카드 생성 미리 보기 ---------- */
    // 그리는 동안 원문 칸(#raw-view)에 고친 글이 있다. tabId 탭을 보는 칸
    const openRawEdit = (mod, tabId, value) => {
        const raw = ctx.fakeElement();
        raw.id = 'raw-view';
        Object.assign(raw.dataset, { moduleId: String(mod.id), tabId });
        raw.defaultValue = mod.tabContents[tabId];
        raw.value = value;
        ctx.elements['raw-view'] = raw;
        return raw;
    };
    const missingRefs = mod => Object.values(mod.tabContents).filter(Boolean).join('\n').match(/local:img_\d+/g)?.map(ref => ref.slice(6)).filter(id => !(id in mod.images)) || [];

    await run('그림 처리: 그리는 동안 같은 차시의 다른 탭 원문을 저장해도 이미 만든 그림을 지우지 않는다(그림은 글에 넣을 때 담는다)', async () => {
        const learn = '## 1. 첫째\n\n<!-- [IMG: "a"] -->\n\n본문입니다.\n\n## 2. 둘째\n\n<!-- [IMG: "b"] -->\n\n본문입니다.';
        const prac = '## 1. 실습\n\n실습 글입니다.';
        const mod = { id: 7, title: '차시', images: {}, tabContents: { ...tabsOf(learn), basicPrac: prac }, content: learn };
        ctx.globalState = { subjects: [{ id: 's1', title: '기획', lessons: [mod] }] };
        ctx.currentSubjectId = 's1';
        ctx.courseData = [mod];
        openRawEdit(mod, 'basicPrac', prac + '\n\n강사가 고친 줄');
        let pictures = 0;
        ctx.fetchStub = async url => {
            if (!isImageUrl(url)) return INTENT();
            pictures += 1;
            if (pictures === 2) call('saveRawContent')(); // 둘째 그림을 그리는 사이 기본 실습 원문을 저장한다(쓰지 않는 그림을 덜어 낸다)
            return json(IMAGE_REPLY);
        };
        try {
            await call('generateAllImagesInModule')(7);
        } finally {
            delete ctx.elements['raw-view'];
        }
        assert.strictEqual(pictures, 2);
        assert.ok(mod.tabContents.basicPrac.includes('강사가 고친 줄'), '고친 원문은 저장된다');
        const ids = mod.tabContents.basicLearn.match(/local:img_\d+/g) || [];
        assert.strictEqual(ids.length, 2, mod.tabContents.basicLearn);
        assert.deepStrictEqual(missingRefs(mod), [], '글이 가리키는 그림은 모두 차시 그림에 있다');
        assert.strictEqual(Object.keys(mod.images).length, 2);
        assert.strictEqual(ctx.toasts.at(-1), '일괄 이미지 찾기를 마쳤습니다. 그림 2장을 넣었습니다.');
    });

    await run('그림 처리: 그 탭 원문을 고치고 있었으면 그 글 위에 그림을 넣고, 그사이 지운 자리의 그림은 담지도 세지도 않는다', async () => {
        const learn = '## 1. 첫째\n\n<!-- [IMG: "a"] -->\n\n본문입니다.\n\n## 2. 둘째\n\n<!-- [IMG: "b"] -->\n\n본문입니다.';
        const mod = { id: 8, title: '차시', images: { img_old: 'data:image/png;base64,T0xE' }, tabContents: tabsOf(learn), content: learn };
        ctx.globalState = { subjects: [{ id: 's1', title: '기획', lessons: [mod] }] };
        ctx.currentSubjectId = 's1';
        ctx.courseData = [mod];
        // 기본 학습 원문 칸에서 둘째 그림 자리를 지우고 한 줄을 더했다(아직 넣지 않음). 그림을 다 만들면 이 글을 먼저 저장한다(latestTabMarkdown)
        openRawEdit(mod, 'basicLearn', learn.replace('<!-- [IMG: "b"] -->', '') + '\n\n강사가 고친 줄');
        ctx.fetchStub = async url => (isImageUrl(url) ? json(IMAGE_REPLY) : INTENT());
        try {
            await call('generateAllImagesInModule')(8);
        } finally {
            delete ctx.elements['raw-view'];
        }
        const text = mod.tabContents.basicLearn;
        assert.ok(text.includes('강사가 고친 줄') && !text.includes('<!-- [IMG:'), text);
        assert.strictEqual((text.match(/local:img_\d+/g) || []).length, 1);
        assert.deepStrictEqual(missingRefs(mod), [], '고친 원문을 저장하며 덜어 내도 넣은 그림은 남는다');
        assert.deepStrictEqual(Object.keys(mod.images).filter(id => id !== 'img_old').length, 1, '지운 자리의 그림은 담지 않는다');
        assert.ok(!('img_old' in mod.images), '쓰지 않는 옛 그림은 원문 저장이 덜어 낸다');
        assert.strictEqual(ctx.toasts.at(-1), '일괄 이미지 찾기를 마쳤습니다. 그림 1장을 넣었습니다.', '지운 자리를 넣은 그림이나 남긴 자리로 세지 않는다');
    });

    const mainQuestSubjects = () => {
        const mq1 = { id: 'mainQuest', title: '👑 최종 평가', description: '교과1 평가', status: 'waiting', content: null, images: {} };
        const mq2 = { id: 'mainQuest', title: '👑 최종 평가', description: '교과2 평가', status: 'done', content: '교과2가 이미 쓴 최종 평가입니다.', images: {} };
        const s1 = { id: 's1', title: '교과1', lessons: [{ id: 1, title: '1차시', description: '설명' }], mainQuest: mq1 };
        const s2 = { id: 's2', title: '교과2', lessons: [{ id: 1, title: '1차시', description: '설명' }], mainQuest: mq2 };
        ctx.globalState = { subjects: [s1, s2] };
        ctx.currentSubjectId = 's1';
        ctx.courseData = s1.lessons;
        ctx.currentEditingModuleId = 1;
        ctx.elements['editor-loading'] = ctx.fakeElement();
        ctx.buildTaskContext = () => ({ systemInstruction: '지시', userPrompt: '최종 평가를 만드세요' });
        return { s1, s2, mq1, mq2 };
    };

    await run('최종 평가 만들기: 만드는 동안 다른 교과로 옮기면 그 교과 화면에 그리지 않고, 원문 칸도 다른 교과의 최종 평가에 넣지 않는다', async () => {
        const { s2, mq1, mq2 } = mainQuestSubjects();
        ctx.fetchStub = async url => {
            vm.runInContext("currentSubjectId = 's2'; courseData = globalState.subjects[1].lessons;", ctx); // 기다리는 동안 교과2를 연다
            return json(textReply('교과1 새 최종 평가 본문입니다.'));
        };
        await call('generateMainQuest')();
        assert.strictEqual(mq1.content, '교과1 새 최종 평가 본문입니다.', '시작한 교과의 최종 평가에 넣는다');
        assert.strictEqual(ctx.rendered, 0, '교과2 화면에 교과1의 최종 평가를 그리지 않는다');
        assert.notStrictEqual(vm.runInContext('currentEditingModuleId', ctx), 'mainQuest', '교과2의 편집 중 차시를 최종 평가로 바꾸지 않는다');
        assert.ok(ctx.toasts.some(text => text.includes("'교과1' 교과의 최종 평가를 만들었습니다")), JSON.stringify(ctx.toasts));
        assert.strictEqual(mq2.content, '교과2가 이미 쓴 최종 평가입니다.');
        // 그래도 교과1의 최종 평가를 그린 원문 칸이 남아 있으면(예전 화면) 교과2의 최종 평가가 아니라 그린 교과1의 최종 평가에 넣는다
        const raw = ctx.fakeElement();
        raw.id = 'raw-view';
        Object.assign(raw.dataset, { moduleId: 'mainQuest', subjectId: 's1', tabId: 'basicLearn' });
        raw.defaultValue = raw.storedFrom = mq1.content;
        raw.value = mq1.content + '\n\n강사가 덧붙인 문장입니다.';
        ctx.elements['raw-view'] = raw;
        try {
            call('saveRawContent')();
            assert.strictEqual(mq1.content, '교과1 새 최종 평가 본문입니다.\n\n강사가 덧붙인 문장입니다.', '그린 교과1의 최종 평가에 넣는다');
            assert.strictEqual(mq2.content, '교과2가 이미 쓴 최종 평가입니다.', '다른 교과의 최종 평가를 덮지 않는다');
            assert.strictEqual(call('hasPendingRawEdit')(), false);
            const raw2 = ctx.fakeElement(); // 교과2에서 그린 칸이면 교과2의 최종 평가에 넣는다
            raw2.id = 'raw-view';
            Object.assign(raw2.dataset, { moduleId: 'mainQuest', subjectId: 's2', tabId: 'basicLearn' });
            raw2.defaultValue = raw2.storedFrom = mq2.content;
            raw2.value = mq2.content + ' 고침';
            ctx.elements['raw-view'] = raw2;
            call('saveRawContent')();
            assert.strictEqual(mq2.content, '교과2가 이미 쓴 최종 평가입니다. 고침');
            assert.strictEqual(mq1.content, '교과1 새 최종 평가 본문입니다.\n\n강사가 덧붙인 문장입니다.', '교과1은 그대로');
        } finally {
            delete ctx.elements['raw-view'];
        }
        assert.strictEqual(s2.mainQuest, mq2);
    });

    await run('전체 생성이 끝날 때: 빈 탭을 손으로 쓰던 원문 칸은 먼저 그 탭에 넣고, 다시 그리지 않아 쓰던 칸을 그대로 둔다', async () => {
        const learn = '## 1. 첫째\n\n본문입니다.';
        const mod = { id: 7, title: '차시', images: {}, tabContents: tabsOf(learn), content: learn };
        ctx.globalState = { subjects: [{ id: 's1', title: '기획', lessons: [mod] }] };
        ctx.currentSubjectId = 's1';
        ctx.courseData = [mod];
        ctx.currentEditingModuleId = 7;
        vm.runInContext("currentLessonTab = 'basicPrac'; _lessonPanel = null;", ctx);
        const raw = openRawEdit(mod, 'basicPrac', '## 1. 실습\n\n강사가 손으로 쓰는 실습입니다.');
        call('beginLessonPipeline')(7, { kind: 'job', label: '심화 학습 만들기', current: 'advLearn' }); // 다른 탭을 만드는 작업
        try {
            call('finishLessonPipeline')({ quiet: true });
            assert.strictEqual(mod.tabContents.basicPrac, '## 1. 실습\n\n강사가 손으로 쓰는 실습입니다.', '쓰던 글을 그 탭에 넣는다');
            assert.strictEqual(ctx.rendered, 0, '탭이 비지 않았으므로 다시 그리지 않는다(쓰던 칸이 그대로다)');
            assert.strictEqual(ctx.elements['raw-view'], raw);
            assert.strictEqual(ctx.saved, 1);
        } finally {
            delete ctx.elements['raw-view'];
            vm.runInContext("currentLessonTab = 'basicLearn';", ctx);
        }
    });

    await run('AI 수정 반영: 다른 교과로 옮겨 같은 id의 최종 평가를 보고 있으면 그 화면을 다시 그리지 않는다(같은 객체일 때만)', async () => {
        const { s1, s2, mq1, mq2 } = mainQuestSubjects();
        mq1.content = '## 과제\n\n교과1 본문입니다.';
        vm.runInContext("currentSubjectId = 's2'; courseData = globalState.subjects[1].lessons; currentEditingModuleId = 'mainQuest'; currentLessonTab = 'basicLearn';", ctx);
        const commit = call('commitTabChange');
        assert.strictEqual(await commit(mq1, 'basicLearn', mq1.content, '## 과제\n\n교과1 고친 본문입니다.', 'AI 수정'), true);
        assert.strictEqual(s1.mainQuest.content, '## 과제\n\n교과1 고친 본문입니다.');
        assert.strictEqual(ctx.rendered, 0, '교과2의 최종 평가 화면에 교과1의 최종 평가를 그리지 않는다');
        assert.strictEqual(await commit(mq2, 'basicLearn', mq2.content, '교과2 고친 글입니다.', 'AI 수정'), true);
        assert.strictEqual(ctx.rendered, 1, '보고 있는 그 최종 평가는 다시 그린다');
        assert.strictEqual(s2.mainQuest.content, '교과2 고친 글입니다.');
        ctx.currentEditingModuleId = 1;
    });

    await run('최종 평가 만들기: 앞서 중지한 작업의 신호가 남아도 그림을 만들고, 진행 막대의 생성이 돌면 시작하지 않는다', async () => {
        const { mq1 } = mainQuestSubjects();
        call('requestTabGenerationStop')(); // 앞 작업을 중지했다(신호가 남는다)
        ctx.fetchStub = async url => {
            if (isImageUrl(url)) return json(IMAGE_REPLY);
            if (ctx.fetched.length === 1) return json(textReply('## 1. 과제\n\n<!-- [IMG: "과제 그림"] -->\n\n과제 설명입니다.'));
            return INTENT();
        };
        await call('generateMainQuest')();
        assert.strictEqual(imageCalls(), 1, '새 신호로 시작해 그림을 만든다');
        assert.ok(mq1.content.includes('local:img_') && !mq1.content.includes('<!-- [IMG:'), mq1.content);
        assert.ok(!ctx.toasts.some(text => text.includes('남겨 두었습니다')), JSON.stringify(ctx.toasts));
        assert.strictEqual(ctx.rendered, 1, '시작한 교과를 보고 있으면 그린다');

        reset();
        mainQuestSubjects();
        call('beginLessonPipeline')(1, { kind: 'job', alerts: true });
        try {
            await call('generateMainQuest')();
            assert.strictEqual(ctx.alerts.at(-1), '진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
            assert.strictEqual(ctx.fetched.length, 0);
            call('promptAndGenerateMainQuest')();
            assert.strictEqual(ctx.alerts.length, 2, '핵심 개념 창도 띄우지 않는다');
        } finally {
            call('finishLessonPipeline')({ quiet: true });
        }
    });

    await run('카드의 교안 생성·다시 생성: 핵심 개념 창에 이어서 할 일의 미리 보기(호출·그림·시간)를 넣는다', async () => {
        const mod = { id: 4, title: '차시', status: 'done', images: {}, tabContents: tabsOf('## 1. 본문\n\n글입니다.'), content: '글' };
        ctx.globalState = { subjects: [{ id: 's1', title: '기획', lessons: [mod] }] };
        ctx.currentSubjectId = 's1';
        ctx.courseData = [mod];
        const asked = [];
        const realPrompt = ctx.showKeyConceptsPrompt;
        ctx.showKeyConceptsPrompt = (title, defaults, onConfirm, opts) => asked.push({ title, opts });
        try {
            call('promptAndGenerateModule')(4);
        } finally {
            ctx.showKeyConceptsPrompt = realPrompt;
        }
        assert.strictEqual(asked.length, 1);
        const box = asked[0].opts.estimateHtml;
        assert.ok(box.includes('미리 보기') && box.includes('글: AI 호출 약') && box.includes('그림: 약 15장') && box.includes('걸리는 시간'), box);
        assert.strictEqual(asked[0].opts.okLabel, '모두 다시 생성', '다시 만들기 경고와 함께 보인다');
        assert.ok(asked[0].opts.warning);
    });

    console.log('ALL PASSED');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
