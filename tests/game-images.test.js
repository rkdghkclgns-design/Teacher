// 예시 게임 그림 테스트 (실행: node tests/game-images.test.js)
// 실제 game-images.js·game-image-tags.js·api.js(processImageTags·일괄 이미지 찾기)·cost-estimate.js·lesson-export.js를 vm에서 돌린다.
// 인터넷은 부르지 않는다: fetch를 바꿔 끼우고 위키백과 API와 같은 모양의 JSON·그림 바이트를 돌려준다. AI 키는 가짜 값만 쓴다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

let domino = null;
try {
    domino = require('@mixmark-io/domino');
} catch (err) {
    console.log('FAIL - domino가 없습니다. 먼저 실행: npm install --no-save marked@15.0.12 turndown@7.2.4');
}

const rootDir = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(rootDir, file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const quiet = { log() {}, warn() {}, error() {} };
function sliceSource(source, start, end = '\n}\n') {
    const at = source.indexOf(start);
    if (at < 0) throw new Error(`소스에서 찾지 못함: ${start}`);
    const stop = source.indexOf(end, at);
    if (stop < 0) throw new Error(`끝을 찾지 못함: ${start}`);
    return source.slice(at, stop + end.length);
}

const FILES = ['data.js', 'ai-errors.js', 'claude.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'cost-estimate.js', 'game-images.js', 'game-image-tags.js', 'api.js'];

/* ---------- 그림 바이트와 위키백과 답 ---------- */
const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 9, 8, 7]);
const JPEG_A = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF_A = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
const dataUrl = (bytes, type = 'image/png') => `data:${type};base64,${bytes.toString('base64')}`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const picture = (bytes, type = 'image/png', headers = {}) => () => new Response(bytes, { status: 200, headers: { 'content-type': type, ...headers } });
const textReply = text => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

const UP = 'https://upload.wikimedia.org/wikipedia';
const page = (pageid, title, extra = {}) => ({
    pageid, ns: 0, title, contentmodel: 'wikitext', pagelanguage: 'en', pagelanguagehtmlcode: 'en', pagelanguagedir: 'ltr', touched: '2026-11-01T00:00:00Z', lastrevid: 1, length: 90000,
    fullurl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, editurl: 'https://en.wikipedia.org/w/index.php?action=edit', canonicalurl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    descriptionsource: 'local', ...extra
});
// generator=search 답(formatversion 1: 문서 번호를 키로 한 객체). index는 검색 순위
const searchReply = pages => json({ batchcomplete: '', continue: { gsroffset: 5, continue: 'gsroffset||' }, query: { pages: Object.fromEntries(pages.map((item, i) => [String(item.pageid), { index: i + 1, ...item }])) } });
const TETRIS = page(30474, 'Tetris', { description: '1985 video game', thumbnail: { source: `${UP}/en/thumb/7/7d/Tetris_Boxshot.jpg/220px-Tetris_Boxshot.jpg`, width: 220, height: 314 }, pageimage: 'Tetris_Boxshot.jpg' });
const TETRIS_EFFECT = page(55555, 'Tetris Effect', { description: '2018 puzzle video game', thumbnail: { source: `${UP}/en/a/a1/Tetris_Effect.jpg`, width: 220, height: 300 }, pageimage: 'Tetris_Effect.jpg' });
const TETRIS_COMPANY = page(4444, 'The Tetris Company', { description: 'Company that owns the Tetris trademark' });
const fileInfo = (title, { url, thumburl, license = '', nonFree = false, repo = 'local' }) => ({
    pageid: 777, ns: 6, title, imagerepository: repo,
    imageinfo: [{
        ...(thumburl ? { thumburl, thumbwidth: 1000, thumbheight: 700 } : {}),
        url, descriptionurl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`, descriptionshorturl: 'https://en.wikipedia.org/w/index.php?curid=777',
        extmetadata: {
            ...(license ? { LicenseShortName: { value: license, source: 'commons-desc-page', hidden: '' } } : {}),
            ...(nonFree ? { NonFree: { value: 'true', source: 'commons-desc-page', hidden: '' } } : {})
        }
    }]
});
const infoReply = info => json({ batchcomplete: '', query: { normalized: [{ from: info.title.replace(/ /g, '_'), to: info.title }], pages: { [String(info.pageid)]: info } } });
const missingFile = title => json({ batchcomplete: '', query: { pages: { '-1': { ns: 6, title, missing: '', known: '' } } } });
const imagesReply = (title, names) => json({ continue: { imcontinue: '30474|Zz.jpg', continue: '||' }, query: { pages: { '30474': { pageid: 30474, ns: 0, title, images: names.map(name => ({ ns: 6, title: `File:${name}` })) } } } });

// 위키백과·그림 주소를 흉내 낸다. search: '위키:검색어' → 문서들 / info: '위키:File:이름' → 파일 정보 / images: '위키:문서' → 파일 이름들 / files: 주소 → 답
function wikiStub({ search = {}, info = {}, images = {}, files = {} } = {}) {
    return async url => {
        const u = new URL(url);
        const p = u.searchParams;
        if (u.hostname === 'en.wikipedia.org' || u.hostname === 'ko.wikipedia.org') {
            const wiki = u.hostname.slice(0, 2);
            if (p.get('generator') === 'search') return searchReply(search[`${wiki}:${p.get('gsrsearch')}`] || []);
            if (p.get('prop') === 'imageinfo') {
                const found = info[`${wiki}:${p.get('titles')}`];
                return found ? infoReply(found) : missingFile(p.get('titles'));
            }
            if (p.get('prop') === 'images') return imagesReply(p.get('titles'), images[`${wiki}:${p.get('titles')}`] || []);
        }
        if (files[url]) return files[url]();
        if (u.hostname === 'upload.wikimedia.org') return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });
        throw new Error(`부르면 안 되는 주소: ${url}`);
    };
}

const TETRIS_MAIN_URL = `${UP}/en/7/7d/Tetris_Boxshot.jpg`;
const TETRIS_STUB = {
    search: { 'en:Tetris video game': [TETRIS_EFFECT, TETRIS, TETRIS_COMPANY] },
    info: { 'en:File:Tetris Boxshot.jpg': fileInfo('File:Tetris Boxshot.jpg', { url: TETRIS_MAIN_URL, license: 'Fair use', nonFree: true }) },
    files: { [TETRIS_MAIN_URL]: picture(PNG_A) }
};

/* ---------- 실행 환경 ---------- */
function makeContext() {
    const elements = {};
    const fakeElement = () => ({
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', disabled: false, value: '', children: [],
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], appendChild(child) { this.children.push(child); },
        remove() { this.removed = true; if (elements[this.id] === this) delete elements[this.id]; }
    });
    const held = [];
    const ctx = {
        console: quiet, Promise, URL, Uint16Array, Blob, AbortController, Response, btoa,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        saveState: async () => { ctx.saved += 1; return true; },
        showLessonView() {}, lessonDesignBrief: () => '', lessonGenBrief: () => '',
        archiveContent: async (entry, reason) => { ctx.archived.push({ entry, reason }); },
        usesSvgIllustration: () => false,
        elements, fakeElement, held,
        saved: 0, rendered: 0, alerts: [], toasts: [], confirms: [], archived: [], fetched: [], previews: [], written: [], cacheSets: [], cacheGets: [],
        document: {
            readyState: 'complete', hidden: false, title: '',
            body: { appendChild: el => { if (el.id) elements[el.id] = el; } },
            createElement: fakeElement,
            getElementById: id => elements[id] || null,
            addEventListener() {}, removeEventListener() {},
            querySelectorAll: () => [], querySelector: () => null
        }
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = message => ctx.toasts.push(message);
    // 짧은 기다림은 바로 넘기고, 요청 하나의 시한(15초)은 붙잡아 두었다가 테스트가 부를 때만 끝낸다
    ctx.setTimeout = (fn, ms) => {
        if (ms >= 10000) {
            held.push(fn);
            return `held-${held.length}`;
        }
        return setTimeout(fn, 0);
    };
    ctx.clearTimeout = id => { if (typeof id === 'object') clearTimeout(id); };
    ctx.fetch = (url, init = {}) => { ctx.fetched.push({ url: String(url), init }); return ctx.fetchStub(String(url), init); };
    ctx.fetchStub = async url => { throw new Error(`fetchStub를 정하지 않았습니다: ${url}`); };
    ctx.DBManager = {
        store: new Map(),
        getCache: async key => { ctx.cacheGets.push(key); return ctx.DBManager.store.get(key) || null; },
        setCache: async (keyword, base64, source, format, meta) => { ctx.cacheSets.push({ keyword, base64, source, format, meta }); }
    };
    ctx.writeLessonTab = async (mod, tabId, md) => {
        vm.runInContext('setTabMarkdown', ctx)(mod, tabId, md);
        ctx.written.push({ tabId, md });
        return ctx.saveState();
    };
    vm.createContext(ctx);
    vm.runInContext(sliceSource(read('js/ui.js'), 'function escapeHtml('), ctx); // 화면과 같은 이스케이프(작은따옴표까지)
    FILES.forEach(file => vm.runInContext(read(`js/${file}`), ctx));
    vm.runInContext(`apiKey = 'AIza-FAKE-TEST-KEY'; globalState = { subjects: [] }; currentSubjectId = null; currentEditingModuleId = null; courseData = [];
        getEditingModule = (id = currentEditingModuleId) => (id === 'mainQuest' ? (globalState.subjects.find(s => s.id === currentSubjectId) || {}).mainQuest : courseData.find(m => String(m.id) === String(id)));
        renderEditor = () => { window.rendered += 1; }; renderSidebar = () => {};
        previewAiChange = async (before, after, opts) => { window.previews.push({ before, after, opts }); window.previewHook?.(); return window.previewAnswer === undefined ? after : window.previewAnswer; };`, ctx);
    ctx.realSaveRawContent = ctx.saveRawContent;
    ctx.confirmAsync = async message => { ctx.confirms.push(message); return true; };
    return ctx;
}

const ctx = makeContext();
const call = name => vm.runInContext(name, ctx);
const geminiCalls = () => ctx.fetched.filter(item => item.url.includes('generativelanguage'));
const hostsCalled = () => [...new Set(ctx.fetched.map(item => new URL(item.url).hostname))].sort();
const tabsOf = basicLearn => ({ basicLearn, basicPrac: null, advLearn: null, advPrac: null, assessment: null });

function reset() {
    call('endImageRun')();
    call('resetTabGenStop')();
    ['alerts', 'toasts', 'confirms', 'archived', 'fetched', 'previews', 'written', 'cacheSets', 'cacheGets', 'held'].forEach(key => { ctx[key].length = 0; });
    ctx.saved = 0;
    ctx.rendered = 0;
    ctx.previewAnswer = undefined;
    ctx.previewHook = undefined;
    ctx.saveRawContent = ctx.realSaveRawContent;
    delete ctx.elements['raw-view'];
    ctx.DBManager.store = new Map();
    ctx.fetchStub = async url => { throw new Error(`fetchStub를 정하지 않았습니다: ${url}`); };
    vm.runInContext("googleSearchCx = ''; googleSearchApiKeys = []; pixabayApiKey = ''; currentLessonTab = 'basicLearn'; _lessonPanel = null;", ctx);
}

// 차시 하나를 연 교과
function openLesson(md, extra = {}) {
    const mod = { id: 7, title: '퍼즐 게임 차시', images: {}, tabContents: tabsOf(md), content: md, ...extra };
    ctx.globalState = { subjects: [{ id: 's1', title: '게임 기획', lessons: [mod] }] };
    vm.runInContext("globalState = window.globalState; currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons; currentEditingModuleId = 7;", ctx);
    return mod;
}

async function waitFor(condition, label) {
    for (let i = 0; i < 400; i++) {
        if (condition()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`기다려도 되지 않음: ${label}`);
}

let failed = 0;
let count = 0;
async function run(name, fn) {
    count++;
    reset();
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (err) {
        failed++;
        console.log(`FAIL - ${name}\n  ${err.stack || err.message}`);
    }
}

(async () => {
    /* ---------- 위키백과에서 고르기 ---------- */
    await run('제목 맞추기: 정규화한 제목이 같은 문서를 고르고, 같으면 검색 순위로, 부제만 같은 이름도 알아본다', async () => {
        const pick = (pages, title) => call('pickGameArticle')(pages, title)?.title || null;
        assert.strictEqual(pick([TETRIS_EFFECT, TETRIS, TETRIS_COMPANY], 'Tetris'), 'Tetris', '검색 순위가 높아도 제목이 다른 Tetris Effect는 고르지 않는다');
        assert.strictEqual(pick([TETRIS_EFFECT, TETRIS], 'tetris'), 'Tetris', '대소문자는 보지 않는다');
        const doom16 = page(2, 'Doom (2016 video game)', { description: '2016 video game', index: 2 });
        const doom93 = page(3, 'Doom (1993 video game)', { description: '1993 video game', index: 1 });
        assert.strictEqual(pick([doom16, doom93], 'Doom'), 'Doom (1993 video game)', '괄호 설명을 떼고 견주고, 같으면 검색 순위');
        assert.strictEqual(pick([page(4, 'The Legend of Zelda: Breath of the Wild', { description: '2017 action-adventure game' })], 'Breath of the Wild'), 'The Legend of Zelda: Breath of the Wild', '부제만 같은 이름');
        assert.strictEqual(pick([page(5, 'Pokémon Red and Blue', { description: '1996 video game' })], 'Pokemon Red and Blue'), 'Pokémon Red and Blue', '악센트는 보지 않는다');
        assert.strictEqual(pick([page(6, 'Ratchet & Clank', { description: '2002 video game' })], 'Ratchet and Clank'), 'Ratchet & Clank', '&와 and를 같게 본다');
        assert.strictEqual(pick([TETRIS_EFFECT], 'Tetris'), null, '제목이 다르면 고르지 않는다');
        assert.strictEqual(call('gameTitleScore')('Tetris', 'Tetris Effect'), 0);
    });

    await run('설명 거르기: 게임 문서만 고르고 게임 회사·게임기·캐릭터·장르 문서와 설명 없는 문서는 고르지 않는다', async () => {
        const isGame = item => call('gamePageIsGame')(item);
        assert.strictEqual(isGame({ title: 'Tetris', description: '1985 video game' }), true);
        assert.strictEqual(isGame({ title: 'Catan', description: 'Multiplayer board game' }), true);
        assert.strictEqual(isGame({ title: 'Doom (1993 video game)' }), true, '설명이 없으면 제목의 괄호 설명을 본다');
        assert.strictEqual(isGame({ title: '메이플스토리', description: '넥슨의 온라인 게임' }), true);
        [
            { title: 'Nintendo', description: 'Japanese video game company' },
            { title: 'Nintendo Switch', description: 'Hybrid video game console' },
            { title: 'Mario', description: 'Nintendo video game character' },
            { title: 'Unreal Engine', description: 'Video game engine' },
            { title: 'Battle royale game', description: 'Video game genre' },
            { title: 'Tetris', description: '' },
            { title: 'Gamer', description: 'Person who plays video games' },
            { title: 'Gamer (2009 film)', description: '2009 American science fiction action film' },
            { title: '닌텐도 스위치', description: '닌텐도의 게임기' }
        ].forEach(item => assert.strictEqual(isGame(item), false, item.title));
        assert.strictEqual(call('pickGameArticle')([page(9, 'Nintendo', { description: 'Japanese video game company' })], 'Nintendo'), null, '제목이 같아도 회사 문서는 고르지 않는다');
    });

    await run('위키백과 찾기: 영어 위키백과에서 문서·라이선스·그림을 차례로 받고, 요청 주소는 글자를 모두 바꿔 붙인다', async () => {
        ctx.fetchStub = wikiStub(TETRIS_STUB);
        const found = plain(await call('findGamePicture')('Tetris'));
        assert.deepStrictEqual([found.vendor, found.wiki, found.page, found.name, found.file, found.pageUrl, found.license, found.nonFree],
            ['wikipedia', 'en', 'Tetris', 'Tetris', 'Tetris Boxshot.jpg', 'https://en.wikipedia.org/wiki/Tetris', '공정 이용 이미지', true]);
        assert.strictEqual(found.dataUrl, dataUrl(PNG_A));
        const [search, info, image] = ctx.fetched.map(item => item.url);
        assert.ok(search.startsWith('https://en.wikipedia.org/w/api.php?'), search);
        const sp = new URL(search).searchParams;
        assert.deepStrictEqual(['action', 'generator', 'gsrsearch', 'gsrlimit', 'prop', 'piprop', 'pithumbsize', 'pilicense', 'inprop', 'format', 'origin'].map(key => sp.get(key)),
            ['query', 'search', 'Tetris video game', '5', 'pageimages|description|info', 'thumbnail|name', '1000', 'any', 'url', 'json', '*']);
        assert.ok(search.includes('gsrsearch=Tetris%20video%20game') && search.includes('prop=pageimages%7Cdescription%7Cinfo'), '값은 모두 주소 글자로 바꾼다');
        const ip = new URL(info).searchParams;
        assert.deepStrictEqual([ip.get('titles'), ip.get('prop'), ip.get('iiprop'), ip.get('origin')], ['File:Tetris Boxshot.jpg', 'imageinfo', 'url|extmetadata', '*']);
        assert.strictEqual(image, TETRIS_MAIN_URL);
        assert.ok(ctx.fetched.every(item => item.init.credentials === 'omit' && item.init.signal), '쿠키를 보내지 않고 요청마다 끊을 수 있다');
        assert.deepStrictEqual(hostsCalled(), ['en.wikipedia.org', 'upload.wikimedia.org']);
    });

    await run('위키백과 찾기: 한글 제목은 영어 위키백과에서 못 찾으면 한국어 위키백과에서 찾고, 영어 제목은 한국어 위키백과를 부르지 않는다', async () => {
        const koPage = { ...page(8080, '메이플스토리', { description: '넥슨의 온라인 게임', pageimage: 'MapleStory_logo.png', thumbnail: { source: `${UP}/ko/1/12/Maple.png` } }), fullurl: 'https://ko.wikipedia.org/wiki/%EB%A9%94%EC%9D%B4%ED%94%8C%EC%8A%A4%ED%86%A0%EB%A6%AC' };
        const mapleUrl = `${UP}/ko/1/12/Maple.png`;
        ctx.fetchStub = wikiStub({
            search: { 'en:메이플스토리 video game': [page(1, 'MapleStory', { description: '2003 video game' })], 'ko:메이플스토리 게임': [koPage] },
            info: { 'ko:File:MapleStory logo.png': fileInfo('파일:MapleStory logo.png', { url: mapleUrl, license: 'CC BY-SA 4.0' }) },
            files: { [mapleUrl]: picture(PNG_B) }
        });
        const found = plain(await call('findGamePicture')('메이플스토리'));
        assert.deepStrictEqual([found.wiki, found.page, found.license, found.pageUrl], ['ko', '메이플스토리', 'CC BY-SA 4.0 라이선스', koPage.fullurl]);
        assert.deepStrictEqual(ctx.fetched.slice(0, 2).map(item => new URL(item.url).hostname), ['en.wikipedia.org', 'ko.wikipedia.org'], '영어 위키백과 먼저');
        assert.strictEqual(new URL(ctx.fetched[1].url).searchParams.get('gsrsearch'), '메이플스토리 게임');
        ctx.fetched.length = 0;
        assert.strictEqual(await call('findGamePicture')('Unknown Indie Game'), null);
        assert.deepStrictEqual(hostsCalled(), ['en.wikipedia.org'], '영어 제목은 한국어 위키백과를 부르지 않는다');
    });

    await run('그림 받기: https의 upload·thumb.wikimedia.org만, png·jpeg·webp·gif만, 8MB까지 받고 머리 바이트로 종류를 확인한다', async () => {
        const safe = url => call('gamePictureUrl')(url);
        assert.strictEqual(safe(`${UP}/en/a.png`), `${UP}/en/a.png`);
        assert.strictEqual(safe('https://thumb.wikimedia.org/x/a.jpg'), 'https://thumb.wikimedia.org/x/a.jpg');
        assert.strictEqual(safe('//upload.wikimedia.org/wikipedia/en/a.png'), 'https://upload.wikimedia.org/wikipedia/en/a.png', '//로 시작하면 https로 읽는다');
        ['http://upload.wikimedia.org/a.png', 'https://evil.example/a.png', 'https://upload.wikimedia.org.evil.example/a.png', 'https://user@upload.wikimedia.org/a.png',
            'https://upload.wikimedia.org:8443/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '', null].forEach(url => assert.strictEqual(safe(url), '', String(url)));
        const files = {
            [`${UP}/ok.png`]: picture(PNG_A),
            [`${UP}/ok.gif`]: picture(GIF_A, 'image/jpeg'),
            [`${UP}/page.html`]: picture(Buffer.from('<html></html>'), 'text/html'),
            [`${UP}/svg.svg`]: picture(Buffer.from('<svg/>'), 'image/svg+xml'),
            [`${UP}/fake.png`]: picture(Buffer.from('<script>x</script>'), 'image/png'),
            [`${UP}/big.png`]: picture(PNG_A, 'image/png', { 'content-length': String(9 * 1024 * 1024) }),
            [`${UP}/huge.png`]: picture(Buffer.concat([PNG_A, Buffer.alloc(8 * 1024 * 1024)]), 'image/png'),
            [`${UP}/gone.png`]: () => new Response('no', { status: 404 })
        };
        ctx.fetchStub = async url => {
            if (!files[url]) throw new Error(`부르면 안 되는 주소: ${url}`);
            return files[url]();
        };
        const get = url => call('gamePictureData')(url, null);
        assert.strictEqual(await get(`${UP}/ok.png`), dataUrl(PNG_A));
        assert.strictEqual(await get(`${UP}/ok.gif`), dataUrl(GIF_A, 'image/gif'), '머리 바이트의 종류로 적는다');
        for (const name of ['page.html', 'svg.svg', 'fake.png', 'big.png', 'huge.png', 'gone.png']) assert.strictEqual(await get(`${UP}/${name}`), null, name);
        ctx.fetched.length = 0;
        assert.strictEqual(await get('https://evil.example/a.png'), null);
        assert.strictEqual(await get('http://upload.wikimedia.org/a.png'), null);
        assert.strictEqual(ctx.fetched.length, 0, '허용하지 않은 주소는 부르지 않는다');
    });

    await run('요청 시한·중지: 답이 늦으면(15초) 그 위키백과는 건너뛰고(실패), 중지하면 AbortError로 멈춘다', async () => {
        const hang = init => new Promise((resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        });
        ctx.fetchStub = (url, init) => hang(init);
        const late = call('findGamePicture')('Tetris');
        await waitFor(() => ctx.fetched.length === 1 && ctx.held.length === 1, '요청이 걸린다');
        ctx.held.forEach(fn => fn()); // 15초가 지났다
        assert.strictEqual(await late, null, '늦은 답은 못 찾은 것으로 본다(중지가 아니다)');
        const controller = new AbortController();
        ctx.fetched.length = 0;
        const stopped = call('findGamePicture')('Tetris', { signal: controller.signal });
        await waitFor(() => ctx.fetched.length === 1, '요청이 걸린다');
        controller.abort();
        await assert.rejects(stopped, err => err.name === 'AbortError');
        await assert.rejects(call('findGamePicture')('Tetris', { signal: controller.signal }), err => err.name === 'AbortError', '이미 중지했으면 부르지 않는다');
    });

    await run('바쁨: 위키미디어가 429·503으로 답하면 쉬었다가(알려 준 시간, 8초까지) 두 번까지 다시 묻고, 그래도 바쁘면 못 찾은 것으로 본다', async () => {
        const waits = [];
        const realSet = ctx.setTimeout;
        ctx.setTimeout = (fn, ms) => { waits.push(ms); return realSet(fn, ms); };
        try {
            let busySearch = 0;
            let busyPicture = 0;
            const stub = wikiStub(TETRIS_STUB);
            ctx.fetchStub = async (url, init) => {
                if (new URL(url).searchParams.get('generator') === 'search' && busySearch < 2) {
                    busySearch += 1;
                    return new Response('busy', { status: 429, headers: busySearch === 1 ? { 'retry-after': '3' } : {} });
                }
                if (url === TETRIS_MAIN_URL && busyPicture < 1) {
                    busyPicture += 1;
                    return new Response('busy', { status: 503, headers: { 'retry-after': '60' } });
                }
                return stub(url, init);
            };
            const found = plain(await call('findGamePicture')('Tetris'));
            assert.deepStrictEqual([found.file, found.dataUrl], ['Tetris Boxshot.jpg', dataUrl(PNG_A)], '쉬었다가 다시 물어 찾는다');
            assert.deepStrictEqual(waits.filter(ms => ms > call('GAME_API_GAP_MS') && ms < 10000), [3000, 4000, 8000], '알려 준 시간(8초까지) 또는 정해 둔 시간만큼 쉰다(요청 사이 간격은 빼고 본다)');
            ctx.fetched.length = 0;
            ctx.fetchStub = async () => new Response('busy', { status: 429 });
            assert.strictEqual(await call('findGamePicture')('Tetris'), null);
            assert.strictEqual(ctx.fetched.length, 3, '처음 한 번과 다시 두 번');
        } finally {
            ctx.setTimeout = realSet;
        }
    });

    await run('제목의 괄호 설명: AI가 문서 제목 그대로(StarCraft (video game)) 보내도 괄호를 떼고 찾고, 같은 이름이면 괄호 설명이 맞는 문서를 고른다', async () => {
        const pick = (pages, title) => call('pickGameArticle')(pages, title)?.title || null;
        const sc = page(10, 'StarCraft (video game)', { description: '1998 real-time strategy game', index: 2 });
        const scSeries = page(11, 'StarCraft', { description: 'Military science fiction media franchise', index: 1 });
        assert.strictEqual(pick([scSeries, sc], 'StarCraft (video game)'), 'StarCraft (video game)');
        assert.strictEqual(call('gameTitleScore')('StarCraft (video game)', 'StarCraft (video game)'), 3);
        const doom93 = page(3, 'Doom (1993 video game)', { description: '1993 video game', index: 1 });
        const doom16 = page(2, 'Doom (2016 video game)', { description: '2016 video game', index: 2 });
        assert.strictEqual(pick([doom93, doom16], 'Doom (2016 video game)'), 'Doom (2016 video game)', '제목 전체가 같은 문서');
        assert.strictEqual(pick([doom93, doom16], 'Doom (2016)'), 'Doom (2016 video game)', '괄호 설명이 든 문서');
        assert.strictEqual(pick([doom93, doom16], 'Doom'), 'Doom (1993 video game)', '괄호가 없으면 검색 순위');
        const SC_URL = `${UP}/en/9/93/StarCraft_box_art.jpg`;
        ctx.fetchStub = wikiStub({
            search: { 'en:StarCraft video game': [scSeries, { ...sc, pageimage: 'StarCraft_box_art.jpg' }] },
            info: { 'en:File:StarCraft box art.jpg': fileInfo('File:StarCraft box art.jpg', { url: SC_URL, license: 'Fair use', nonFree: true }) },
            files: { [SC_URL]: picture(PNG_B) }
        });
        const found = plain(await call('findGamePicture')('StarCraft (video game)'));
        assert.deepStrictEqual([found.page, found.name, found.file, found.dataUrl], ['StarCraft (video game)', 'StarCraft', 'StarCraft box art.jpg', dataUrl(PNG_B)]);
        assert.strictEqual(new URL(ctx.fetched[0].url).searchParams.get('gsrsearch'), 'StarCraft video game', '검색어에는 괄호 설명을 떼고 넣는다');
    });

    await run('설명 거르기: first-person·third-person 슈팅 게임은 게임 문서로 보고, 사람 문서는 여전히 뺀다', async () => {
        const isGame = item => call('gamePageIsGame')(item);
        assert.strictEqual(isGame({ title: 'Doom (1993 video game)', description: 'First-person shooter game' }), true);
        assert.strictEqual(isGame({ title: 'Gears of War', description: '2006 third-person shooter video game' }), true);
        assert.strictEqual(isGame({ title: 'Gamer', description: 'Person who plays video games' }), false, '사람 문서');
        const pick = (pages, title) => call('pickGameArticle')(pages, title)?.title || null;
        const cs = page(20, 'Counter-Strike (video game)', { description: '2000 first-person shooter video game', index: 1 });
        const series = page(21, 'Counter-Strike', { description: 'Series of first-person shooter video games', index: 2 });
        assert.strictEqual(pick([cs, series], 'Counter-Strike'), 'Counter-Strike (video game)', '게임 문서를 시리즈 문서보다 먼저(검색 순위)');
        assert.strictEqual(pick([page(3, 'Doom (1993 video game)', { description: 'First-person shooter game' }), page(2, 'Doom (2016 video game)', { description: 'First-person shooter' })], 'Doom'), 'Doom (1993 video game)');
    });

    await run('답을 읽지 못함: 브라우저가 위키미디어의 429 답을 읽지 못해 요청이 실패하면(TypeError) 쉬었다가 두 번까지 다시 묻는다', async () => {
        const waits = [];
        const realSet = ctx.setTimeout;
        ctx.setTimeout = (fn, ms) => { waits.push(ms); return realSet(fn, ms); };
        try {
            let broken = 0;
            const stub = wikiStub(TETRIS_STUB);
            ctx.fetchStub = async (url, init) => {
                if (new URL(url).searchParams.get('generator') === 'search' && broken < 1) { broken += 1; throw new TypeError('Failed to fetch'); }
                if (url === TETRIS_MAIN_URL && broken < 2) { broken += 1; throw new TypeError('Failed to fetch'); }
                return stub(url, init);
            };
            const found = plain(await call('findGamePicture')('Tetris'));
            assert.deepStrictEqual([found.file, found.dataUrl], ['Tetris Boxshot.jpg', dataUrl(PNG_A)], '쉬었다가 다시 물어 찾는다');
            assert.deepStrictEqual(waits.filter(ms => ms > call('GAME_API_GAP_MS') && ms < 10000), [1500, 1500], '정해 둔 시간만큼 쉰다');
            ctx.fetched.length = 0;
            ctx.fetchStub = async () => { throw new TypeError('Failed to fetch'); };
            assert.strictEqual(await call('findGamePicture')('Tetris'), null);
            assert.strictEqual(ctx.fetched.length, 3, '처음 한 번과 다시 두 번');
        } finally {
            ctx.setTimeout = realSet;
        }
    });

    await run('요청 간격: 위키백과 API 요청을 잇달아 보내지 않고 사이에 0.5초까지 쉰다', async () => {
        const waits = [];
        const realSet = ctx.setTimeout;
        ctx.setTimeout = (fn, ms) => { waits.push(ms); return realSet(fn, ms); };
        try {
            ctx.fetchStub = wikiStub(TETRIS_STUB);
            assert.ok(await call('findGamePicture')('Tetris'));
            const gap = call('GAME_API_GAP_MS');
            assert.ok(gap >= 500 && waits.some(ms => ms > 0 && ms <= gap), `검색과 파일 정보 요청 사이에 쉰다: ${waits}`);
        } finally {
            ctx.setTimeout = realSet;
        }
    });

    await run('대표 그림이 로고면: 게임 화면·표지 후보를 먼저 넣고, 받지 못하면 로고를 쓴다', async () => {
        const LOGO_THUMB = `${UP}/en/thumb/1/10/Tetris_logo_2019.svg/1000px-Tetris_logo_2019.svg.png`;
        const SHOT_URL = `${UP}/commons/5/55/Tetris_screenshot.png`;
        const logoPage = page(30474, 'Tetris', { description: '1985 video game', pageimage: 'Tetris_logo_2019.svg', thumbnail: { source: LOGO_THUMB } });
        const stub = {
            search: { 'en:Tetris video game': [logoPage] },
            images: { 'en:Tetris': ['Alexey Pajitnov.jpg', 'Tetris logo 2019.svg', 'Tetris (Elektronika 60) screenshot.png'] },
            info: {
                'en:File:Tetris logo 2019.svg': fileInfo('File:Tetris logo 2019.svg', { url: `${UP}/en/1/10/Tetris_logo_2019.svg`, thumburl: LOGO_THUMB, license: 'Public domain' }),
                'en:File:Tetris (Elektronika 60) screenshot.png': fileInfo('File:Tetris (Elektronika 60) screenshot.png', { url: SHOT_URL, license: 'CC BY-SA 4.0' })
            },
            files: { [LOGO_THUMB]: picture(PNG_A), [SHOT_URL]: picture(PNG_B) }
        };
        ctx.fetchStub = wikiStub(stub);
        const shot = plain(await call('findGamePicture')('Tetris'));
        assert.deepStrictEqual([shot.file, shot.dataUrl, shot.license], ['Tetris (Elektronika 60) screenshot.png', dataUrl(PNG_B), 'CC BY-SA 4.0 라이선스']);
        ctx.fetchStub = wikiStub({ ...stub, files: { [LOGO_THUMB]: picture(PNG_A) } });
        const logo = plain(await call('findGamePicture')('Tetris'));
        assert.deepStrictEqual([logo.file, logo.dataUrl], ['Tetris logo 2019.svg', dataUrl(PNG_A)], '다른 그림을 받지 못하면 로고를 쓴다');
    });

    await run('Google 키를 다 쓰면: 예시 게임 그림 길은 AI 그림으로 바꾼다는 알림을 띄우지 않는다(보통 그림 검색은 그대로 알린다)', async () => {
        vm.runInContext("googleSearchCx = 'FAKE-CX'; googleSearchApiKeys = ['FAKE-KEY-1', 'FAKE-KEY-2']; currentSearchKeyIndex = 0;", ctx);
        try {
            ctx.fetchStub = async url => (new URL(url).hostname === 'www.googleapis.com' ? new Response('quota', { status: 429 }) : wikiStub({})(url));
            assert.strictEqual(await call('findGamePictureByGoogle')('Mystery Game'), null);
            assert.strictEqual(ctx.fetched.filter(item => new URL(item.url).hostname === 'www.googleapis.com').length, 2, '키마다 한 번');
            assert.ok(!ctx.toasts.some(text => text.includes('AI 이미지 생성')), ctx.toasts.join(' / '));
            ctx.toasts.length = 0;
            await call('searchImageAPI')('puzzle board');
            assert.ok(ctx.toasts.some(text => text.includes('AI 이미지 생성으로 자동 전환')), '보통 그림 검색은 그대로 알린다');
        } finally {
            vm.runInContext("googleSearchCx = ''; googleSearchApiKeys = []; currentSearchKeyIndex = 0;", ctx);
        }
    });

    await run('라이선스: NonFree는 공정 이용 이미지, 이름이 있으면 그 라이선스, 퍼블릭 도메인, 없으면 정보 없음(HTML은 글자로)', async () => {
        const license = meta => plain(call('gameLicense')(meta));
        assert.deepStrictEqual(license({ NonFree: { value: 'true' }, LicenseShortName: { value: 'Fair use' } }), { license: '공정 이용 이미지', nonFree: true });
        assert.deepStrictEqual(license({ NonFree: { value: 'true' } }), { license: '공정 이용 이미지', nonFree: true }, 'NonFree만 있어도');
        assert.deepStrictEqual(license({ NonFree: { value: 'true' }, LicenseShortName: { value: 'Copyrighted' } }), { license: '공정 이용 이미지', nonFree: true }, 'NonFree가 이름보다 먼저');
        assert.deepStrictEqual(license({ LicenseShortName: { value: 'Non-free media' } }), { license: '공정 이용 이미지', nonFree: true });
        assert.deepStrictEqual(license({ LicenseShortName: { value: 'CC BY-SA 4.0' } }), { license: 'CC BY-SA 4.0 라이선스', nonFree: false });
        assert.deepStrictEqual(license({ LicenseShortName: { value: '<a href="https://x.example">CC BY 3.0</a>' } }), { license: 'CC BY 3.0 라이선스', nonFree: false });
        assert.deepStrictEqual(license({ LicenseShortName: { value: 'Public domain' } }), { license: '퍼블릭 도메인', nonFree: false });
        assert.deepStrictEqual(license({}), { license: '라이선스 정보 없음', nonFree: false });
        assert.deepStrictEqual(license(null), { license: '라이선스 정보 없음', nonFree: false });
        assert.strictEqual(call('gameCaptionText')({ vendor: 'wikipedia', name: 'Tetris', license: '공정 이용 이미지' }), 'Tetris · 출처: 위키백과 · 공정 이용 이미지');
        assert.strictEqual(call('gameCaptionText')({ vendor: 'google', name: 'Tetris', pageUrl: 'https://www.example.com/a' }), 'Tetris · 출처: 웹 검색(www.example.com) · 이용 조건 확인 필요');
    });

    /* ---------- processImageTags의 게임 길 ---------- */
    const GAME_MD = '## 1. 퍼즐 게임의 예\n\n**테트리스**는 떨어지는 블록을 쌓는 게임입니다.\n\n<!-- [IMG: "game: Tetris"] -->\n\n더 씁니다.';
    await run('그림 채우기: 게임 태그는 검색어 정하기·AI 그림·Pixabay 없이 위키백과 그림을 출처와 함께 보통 그림 칸으로 넣고 저장소에 남긴다', async () => {
        vm.runInContext("pixabayApiKey = 'FAKE'; window.pixabayCalls = 0; window.realPixabay = searchPixabayAPI; searchPixabayAPI = async () => { window.pixabayCalls += 1; return null; };", ctx);
        try {
            ctx.fetchStub = wikiStub(TETRIS_STUB);
            const mod = { id: 1, images: {} };
            const stats = { made: 0, failed: 0 };
            const out = await call('processImageTags')(mod, GAME_MD, { amount: 'all', isStopped: () => false, quiet: true, stats });
            assert.strictEqual(geminiCalls().length, 0, 'AI를 부르지 않는다');
            assert.strictEqual(ctx.pixabayCalls, 0, 'Pixabay를 부르지 않는다');
            assert.deepStrictEqual(hostsCalled(), ['en.wikipedia.org', 'upload.wikimedia.org'], '위키백과와 그림 주소만 부른다');
            const [imgId] = Object.keys(mod.images);
            assert.ok(/^img_\d+$/.test(imgId) && mod.images[imgId] === dataUrl(PNG_A), imgId);
            assert.ok(out.includes(`<div class="image-wrapper"><img src="local:${imgId}" alt="Tetris 게임 그림"`), out);
            assert.ok(out.includes('data-lesson-action="regenerate-image" data-keyword="game: Tetris"') && out.includes('다시 찾기'), '다시 찾기 버튼이 있는 보통 그림 칸');
            assert.ok(out.includes('data-game-wiki="en" data-game-page="Tetris" data-game-file="Tetris Boxshot.jpg"'), out);
            assert.ok(out.includes('<div class="image-caption" data-source-url="https://en.wikipedia.org/wiki/Tetris"'), out);
            assert.ok(out.includes('>Tetris · 출처: 위키백과 · 공정 이용 이미지</div>'), out);
            assert.ok(!out.includes('<!-- [IMG:') && out.includes('더 씁니다.'));
            assert.deepStrictEqual(stats, { made: 1, failed: 0 });
            assert.strictEqual(ctx.cacheSets.length, 1);
            const saved = plain(ctx.cacheSets[0]);
            assert.deepStrictEqual([saved.keyword, saved.source, saved.format, saved.meta.license, saved.meta.file], ['game: tetris', 'https://en.wikipedia.org/wiki/Tetris', '위키백과 게임 그림', '공정 이용 이미지', 'Tetris Boxshot.jpg']);
            const frameShape = call('IMAGE_WRAPPER_BLOCK');
            frameShape.lastIndex = 0;
            const framed = frameShape.exec(out);
            frameShape.lastIndex = 0;
            assert.strictEqual(framed && framed[1], `local:${imgId}`, '그림 지우기·다시 찾기가 찾는 그림 칸 모양');
            assert.ok(framed[0].endsWith('공정 이용 이미지</div></div>'), '그림 설명까지 한 칸');
        } finally {
            vm.runInContext("pixabayApiKey = ''; searchPixabayAPI = window.realPixabay;", ctx);
        }
    });

    await run('그림 채우기: 저장소에 있으면 인터넷을 부르지 않고, 저장소의 글은 이스케이프하고 http·https가 아닌 주소는 버린다', async () => {
        ctx.DBManager.store.set('game: tetris', { keyword: 'game: tetris', base64: dataUrl(PNG_B), meta: { vendor: 'wikipedia', wiki: 'en', page: 'Tetris', name: '<b>Tetris</b>', file: 'x.png', pageUrl: 'javascript:alert(1)', license: '공정 이용 이미지', nonFree: true } });
        ctx.fetchStub = async url => { throw new Error(`부르면 안 된다: ${url}`); };
        const mod = { id: 1, images: {} };
        const out = await call('processImageTags')(mod, GAME_MD, { amount: 'all', isStopped: () => false, quiet: true });
        assert.strictEqual(ctx.fetched.length, 0);
        assert.deepStrictEqual(ctx.cacheGets, ['game: tetris']);
        assert.ok(out.includes('&lt;b&gt;Tetris&lt;/b&gt; · 출처: 위키백과 · 공정 이용 이미지') && !out.includes('<b>Tetris'), out);
        assert.ok(!out.includes('data-source-url') && !out.includes('javascript:'), '안전하지 않은 주소는 속성에 넣지 않는다');
        assert.strictEqual(Object.values(mod.images)[0], dataUrl(PNG_B));
        ctx.DBManager.store.set('game: tetris', { base64: 'javascript:alert(1)', meta: { vendor: 'wikipedia', name: 'x' } });
        ctx.fetchStub = wikiStub(TETRIS_STUB);
        await call('processImageTags')({ id: 1, images: {} }, GAME_MD, { amount: 'all', isStopped: () => false, quiet: true });
        assert.ok(ctx.fetched.length > 0, '그림이 아닌 저장소 기록은 쓰지 않고 다시 찾는다');
    });

    await run('그림 채우기: 못 찾으면 다시 검색이 있는 그림 자리와 못 찾았다는 글을 남기고, 끝 알림은 그림 모델 이야기를 하지 않는다', async () => {
        ctx.fetchStub = wikiStub({ search: { 'en:Mystery Game video game': [TETRIS_EFFECT] } });
        const stats = { made: 0, failed: 0 };
        const md = '## 1. 예\n\n<!-- [IMG: "game: Mystery Game"] -->';
        const out = await call('processImageTags')({ id: 1, images: {} }, md, { amount: 'all', isStopped: () => false, quiet: true, stats });
        assert.ok(out.includes('class="image-placeholder"') && out.includes('인터넷에서 &#039;Mystery Game&#039; 게임 그림을 찾지 못했습니다') && out.includes('🔄 다시 검색'), out);
        assert.ok(out.includes('data-keyword="game: Mystery Game"'), '다시 검색은 같은 게임을 찾는다');
        assert.deepStrictEqual(stats, { made: 0, failed: 1, gameFailed: 1 });
        assert.strictEqual(geminiCalls().length, 0);
        assert.strictEqual(ctx.cacheSets.length, 0, '못 찾은 것은 저장하지 않는다');
        const summary = plain(call('imageFillSummary')(stats, 1));
        assert.ok(summary.text.includes('인터넷에서 예시 게임 그림을 찾지 못했습니다(1곳)') && !summary.text.includes('이미지 생성 모델') && summary.kind === 'warning', summary.text);
        await call('processImageTags')({ id: 1, images: {} }, md, { amount: 'all', isStopped: () => false });
        assert.ok(ctx.toasts.at(-1).startsWith('인터넷에서 예시 게임 그림 1장을 찾지 못했습니다') && !ctx.toasts.at(-1).includes('모델'), ctx.toasts.at(-1));
    });

    await run('그림 채우기: 위키백과에서 못 찾으면 Google 검색 키가 있을 때만 Google로 찾고(지금의 고르기 판정), 없으면 Google을 부르지 않는다', async () => {
        vm.runInContext('window.googleQueries = []; window.realSearchImage = searchImageAPI; searchImageAPI = async query => { window.googleQueries.push(query); return { b64: "data:image/jpeg;base64,QUJD", source: "https://img.example.com/t.jpg", page: "https://www.example.com/mystery" }; };', ctx);
        try {
            const md = '## 1. 예\n\n**미스터리 게임**은 예시입니다.\n\n<!-- [IMG: "game: Mystery Game"] -->';
            const stub = wikiStub({});
            ctx.fetchStub = stub;
            await call('processImageTags')({ id: 1, images: {} }, md, { amount: 'all', isStopped: () => false, quiet: true });
            assert.deepStrictEqual(plain(ctx.googleQueries), [], '검색 키가 없으면 Google을 부르지 않는다');
            vm.runInContext("googleSearchCx = 'FAKE-CX'; googleSearchApiKeys = ['FAKE-KEY'];", ctx);
            ctx.fetchStub = async (url, init) => (url.includes('generativelanguage') ? json(textReply('{"isValid": true, "reason": "게임 화면", "confidence": 0.9}')) : stub(url, init));
            const mod = { id: 1, images: {} };
            const out = await call('processImageTags')(mod, md, { amount: 'all', isStopped: () => false, quiet: true });
            assert.deepStrictEqual(plain(ctx.googleQueries), ['Mystery Game video game screenshot']);
            const vlm = geminiCalls();
            assert.strictEqual(vlm.length, 1, '고르기 판정 한 번');
            assert.ok(JSON.parse(vlm[0].init.body).contents[0].parts.some(part => part.inlineData), '그림을 보고 판정한다');
            assert.ok(out.includes('Mystery Game · 출처: 웹 검색(www.example.com) · 이용 조건 확인 필요') && out.includes('data-source-url="https://www.example.com/mystery"'), out);
            assert.strictEqual(Object.values(mod.images)[0], 'data:image/jpeg;base64,QUJD');
            ctx.fetchStub = async (url, init) => (url.includes('generativelanguage') ? json(textReply('{"isValid": false, "reason": "팬아트"}')) : stub(url, init));
            ctx.DBManager.store = new Map();
            const rejected = await call('processImageTags')({ id: 1, images: {} }, md, { amount: 'all', isStopped: () => false, quiet: true });
            assert.ok(rejected.includes('게임 그림을 찾지 못했습니다') && !rejected.includes('image-wrapper'), '판정에서 떨어지면 그림 자리로 남긴다');
        } finally {
            vm.runInContext("googleSearchCx = ''; googleSearchApiKeys = []; searchImageAPI = window.realSearchImage;", ctx);
        }
    });

    await run('그림 고르기: 핵심만에서도 게임 태그는 모두 고르고(섹션의 한 장으로 세지 않음), 넣지 않음이면 고르지 않으며, 제목이 빈 게임 태그는 뺀다', async () => {
        const md = '## 1. 첫째\n\n<!-- [IMG: "a"] -->\n\n<!-- [IMG: "game: Tetris"] -->\n\n<!-- [IMG: "b"] -->\n\n<!-- [IMG: "Game: Doom"] -->\n\n<!-- [IMG: "game: "] -->\n\n## 2. 둘째\n\n<!-- [IMG: "game: Minecraft"] -->\n\n<!-- [IMG: "c"] -->';
        const pending = amount => plain(call('pendingImageTags')(md, amount)).map(tag => [tag.keyword, tag.game]);
        assert.deepStrictEqual(pending('section'), [['a', ''], ['game: Tetris', 'Tetris'], ['Game: Doom', 'Doom'], ['game: Minecraft', 'Minecraft'], ['c', '']]);
        assert.deepStrictEqual(pending('all').map(([keyword]) => keyword), ['a', 'game: Tetris', 'b', 'Game: Doom', 'game: Minecraft', 'c']);
        assert.deepStrictEqual(pending('none'), []);
        assert.strictEqual(call('gameImageTitle')('  GAME:  The   Sims  '), 'The Sims');
        assert.strictEqual(call('gameImageTitle')('game loop diagram'), '', 'game: 이 아니면 게임 태그가 아니다');
    });

    await run('그림 채우기: 그림 모델이 막히고 검색 키도 없으면 AI 그림 자리는 남기고 게임 그림은 위키백과에서 계속 찾는다(사이에 쉬지 않는다)', async () => {
        call('beginImageRun')();
        ['gemini-nano-banana-2.1', 'gemini-3-pro-image', 'gemini-3.1-flash-image'].forEach(model => call('markImageBlocked')(model, { quota: 'zero' }));
        ctx.fetchStub = wikiStub(TETRIS_STUB);
        const md = '## 1. 첫째\n\n<!-- [IMG: "puzzle board"] -->\n\n본문입니다.\n\n<!-- [IMG: "game: Tetris"] -->';
        const waits = [];
        const realSet = ctx.setTimeout;
        ctx.setTimeout = (fn, ms) => { waits.push(ms); return realSet(fn, ms); };
        try {
            const out = await call('processImageTags')({ id: 1, images: {} }, md, { amount: 'all', isStopped: () => false, quiet: true });
            assert.ok(out.includes('<!-- [IMG: "puzzle board"] -->'), 'AI 그림 자리는 남긴다');
            assert.ok(out.includes('Tetris · 출처: 위키백과'), '게임 그림은 넣는다');
            assert.strictEqual(geminiCalls().length, 0);
            assert.strictEqual(vm.runInContext('_imageRun.left', ctx), 1);
            assert.ok(!waits.includes(7000), `게임 그림 앞에서는 7초를 쉬지 않는다: ${waits}`);
        } finally {
            ctx.setTimeout = realSet;
        }
    });

    /* ---------- 다시 찾기 ---------- */
    const imagesList = ['Commons-logo.svg', 'Tetris Boxshot.jpg', 'Game Boy icon.png', 'Tetris logo.png', 'Tetris NES gameplay.png', 'Typical Tetris Game.svg', 'Alexey Pajitnov.jpg'];
    const NES_URL = `${UP}/en/thumb/3/3c/Tetris_NES_gameplay.png/1000px-Tetris_NES_gameplay.png`;
    const ALEXEY_URL = `${UP}/commons/1/1a/Alexey_Pajitnov.jpg`;
    const REDO_STUB = {
        ...TETRIS_STUB,
        images: { 'en:Tetris': imagesList },
        info: {
            ...TETRIS_STUB.info,
            'en:File:Tetris NES gameplay.png': fileInfo('File:Tetris NES gameplay.png', { url: `${UP}/en/3/3c/Tetris_NES_gameplay.png`, thumburl: NES_URL, license: 'CC BY-SA 4.0', repo: 'shared' }),
            'en:File:Alexey Pajitnov.jpg': fileInfo('File:Alexey Pajitnov.jpg', { url: ALEXEY_URL, license: 'CC BY 2.0', repo: 'shared' })
        },
        files: { ...TETRIS_STUB.files, [NES_URL]: picture(PNG_B), [ALEXEY_URL]: picture(JPEG_A, 'image/jpeg') }
    };
    // 보기 화면의 그림 칸과 그 다시 찾기 버튼(흉내)
    function frameButton(dataset) {
        const holder = { style: {}, classList: { contains: () => false }, children: [], querySelector: () => null, appendChild(child) { this.children.push(child); } };
        const button = { dataset, closest: selector => (selector === '.image-wrapper' ? holder : null) };
        return { holder, button };
    }
    const framedLesson = (file, shown = dataUrl(PNG_A)) => {
        const frame = call('gameImageWrapperHtml')('img_1', 'game: Tetris', { vendor: 'wikipedia', wiki: 'en', page: 'Tetris', name: 'Tetris', file, pageUrl: 'https://en.wikipedia.org/wiki/Tetris', license: '공정 이용 이미지', nonFree: true });
        const md = `## 1. 퍼즐\n\n테트리스 설명입니다.\n\n${frame}\n\n\`\`\`html\n${frame}\n\`\`\`\n\n뒤 글입니다.`;
        return openLesson(md, { images: { img_1: shown } });
    };

    await run("다시 찾기: 게임 그림은 AI 요청 창 없이 같은 문서의 다음 래스터 그림(아이콘·로고·svg 빼고)부터 받아 그 칸을 새 출처로 바꾼다", async () => {
        const mod = framedLesson('Tetris Boxshot.jpg');
        ctx.fetchStub = wikiStub(REDO_STUB);
        const { holder, button } = frameButton({ gameWiki: 'en', gamePage: 'Tetris', gameFile: 'Tetris Boxshot.jpg' });
        await call('promptRegenerateImage')(button, 'game: Tetris', 'img_1');
        assert.ok(holder.children.length === 1 && holder.children[0].className.includes('game-search-overlay') && holder.children[0].removed, '찾는 동안 안내를 띄웠다가 닫는다(AI 요청 창이 아니다)');
        assert.ok(!ctx.fetched.some(item => new URL(item.url).searchParams.get('generator') === 'search'), '같은 문서의 다음 그림이 있으면 다시 검색하지 않는다');
        const infoTitles = ctx.fetched.map(item => new URL(item.url).searchParams.get('titles')).filter(Boolean);
        assert.deepStrictEqual(infoTitles, ['Tetris', 'File:Tetris NES gameplay.png'], '문서 그림 목록을 읽고 지금 그림 다음 후보를 받는다');
        assert.strictEqual(mod.images.img_1, dataUrl(PNG_B));
        const md = mod.tabContents.basicLearn;
        assert.ok(md.includes('data-game-file="Tetris NES gameplay.png"') && md.includes('>Tetris · 출처: 위키백과 · CC BY-SA 4.0 라이선스</div>'), md);
        assert.ok(md.includes('```html\n<div class="image-wrapper"><img src="local:img_1"') && md.split('data-game-file="Tetris Boxshot.jpg"').length === 2, '코드 블록 안의 칸은 바꾸지 않는다');
        assert.strictEqual(geminiCalls().length, 0);
        assert.strictEqual(ctx.written.length, 1);
        // 실제 Tetris 문서처럼 사람 사진이 이름 차례로 앞에 와도 게임 화면을 먼저 본다
        ctx.fetchStub = wikiStub({ images: { 'en:Tetris': ['Alexey Pajitnov January 2008 cropped.jpg', 'Commons-logo.svg', 'EC1835 C cut.jpg', 'Henk Rogers face crop.png', 'Tetris (Elektronika 60) screenshot.png', 'Tetris logo 2019.svg'] } });
        assert.deepStrictEqual(plain(await call('gameArticleFiles')('en', 'Tetris', null)),
            ['Tetris (Elektronika 60) screenshot.png', 'Alexey Pajitnov January 2008 cropped.jpg', 'EC1835 C cut.jpg', 'Henk Rogers face crop.png']);
        const raster = name => call('gameRasterFile')(name);
        assert.deepStrictEqual(['a.jpg', 'b.JPEG', 'c.png', 'd.gif', 'e.webp'].map(raster), [true, true, true, true, true]);
        assert.deepStrictEqual(['a.svg', 'b.tif', 'Game Boy icon.png', 'Commons-logo.png', 'Nintendo wordmark.png', 'noext', '.png'].map(raster), [false, false, false, false, false, false, false]);
    });

    await run('다시 찾기: 문서의 마지막 후보면 목록 처음으로 돌아가고, 다른 후보를 받지 못하면 다시 검색해 대표 그림으로, 같은 그림밖에 없으면 그대로 두고 알린다', async () => {
        const mod = framedLesson('Alexey Pajitnov.jpg', dataUrl(JPEG_A, 'image/jpeg'));
        ctx.fetchStub = wikiStub(REDO_STUB);
        const { button } = frameButton({ gameWiki: 'en', gamePage: 'Tetris', gameFile: 'Alexey Pajitnov.jpg' });
        await call('regenerateGamePicture')(button, 'game: Tetris', 'img_1');
        assert.ok(!ctx.fetched.some(item => new URL(item.url).searchParams.get('generator') === 'search'), '목록 앞쪽 후보가 있으면 다시 검색하지 않는다');
        assert.strictEqual(mod.images.img_1, dataUrl(PNG_A));
        assert.ok(mod.tabContents.basicLearn.includes('data-game-file="Tetris Boxshot.jpg"'));
        reset();
        const lone = framedLesson('Alexey Pajitnov.jpg', dataUrl(JPEG_A, 'image/jpeg'));
        const { 'en:File:Tetris NES gameplay.png': unused, ...noNesInfo } = REDO_STUB.info;
        ctx.fetchStub = wikiStub({ ...REDO_STUB, info: noNesInfo, images: { 'en:Tetris': ['Tetris NES gameplay.png', 'Alexey Pajitnov.jpg'] } });
        await call('regenerateGamePicture')(frameButton({ gameWiki: 'en', gamePage: 'Tetris', gameFile: 'Alexey Pajitnov.jpg' }).button, 'game: Tetris', 'img_1');
        assert.ok(ctx.fetched.some(item => new URL(item.url).searchParams.get('generator') === 'search'), '다른 후보를 받지 못하면 다시 검색한다');
        assert.strictEqual(lone.images.img_1, dataUrl(PNG_A));
        assert.ok(lone.tabContents.basicLearn.includes('data-game-file="Tetris Boxshot.jpg"'));
        reset();
        const same = framedLesson('Tetris Boxshot.jpg');
        ctx.fetchStub = wikiStub({ ...TETRIS_STUB, images: { 'en:Tetris': ['Tetris Boxshot.jpg'] } });
        const before = same.tabContents.basicLearn;
        await call('regenerateGamePicture')(frameButton({ gameWiki: 'en', gamePage: 'Tetris', gameFile: 'Tetris Boxshot.jpg' }).button, 'game: Tetris', 'img_1');
        assert.deepStrictEqual(ctx.alerts, ['이 게임의 다른 그림을 인터넷에서 찾지 못했습니다. 지금 그림은 그대로 둡니다.']);
        assert.strictEqual(same.tabContents.basicLearn, before);
    });

    await run('다시 찾기: 지금 그림이 후보 목록 가운데에 있으면 다음 후보를 보고, 끝에 닿으면 목록 앞쪽의 게임 화면으로 돌아간다', async () => {
        const at = name => `${UP}/en/p/${encodeURIComponent(name.replace(/ /g, '_'))}`;
        const names = ['Pac-Man gameplay.png', 'Pac-Man cabinet.jpg', 'Pac flyer.png', 'Namco logo.png', 'TOMY handheld.jpg'];
        const bytes = { 'Pac-Man gameplay.png': PNG_B, 'Pac-Man cabinet.jpg': JPEG_A, 'Pac flyer.png': GIF_A, 'TOMY handheld.jpg': PNG_A };
        const pac = page(40, 'Pac-Man', { description: '1980 video game', pageimage: 'Pac_flyer.png' });
        ctx.fetchStub = wikiStub({
            search: { 'en:Pac-Man video game': [pac] },
            images: { 'en:Pac-Man': names },
            info: Object.fromEntries(Object.keys(bytes).map(name => [`en:File:${name}`, fileInfo(`File:${name}`, { url: at(name), license: 'Fair use', nonFree: true })])),
            files: Object.fromEntries(Object.entries(bytes).map(([name, data]) => [at(name), picture(data, name.endsWith('.jpg') ? 'image/jpeg' : (name.endsWith('.gif') ? 'image/gif' : 'image/png'))]))
        });
        const frame = file => call('gameImageWrapperHtml')('img_1', 'game: Pac-Man', { vendor: 'wikipedia', wiki: 'en', page: 'Pac-Man', name: 'Pac-Man', file, pageUrl: 'https://en.wikipedia.org/wiki/Pac-Man', license: '공정 이용 이미지', nonFree: true });
        const mod = openLesson(`## 1. 아케이드\n\n팩맨 설명입니다.\n\n${frame('Pac flyer.png')}\n\n뒤 글입니다.`, { images: { img_1: dataUrl(GIF_A, 'image/gif') } });
        const click = file => call('regenerateGamePicture')(frameButton({ gameWiki: 'en', gamePage: 'Pac-Man', gameFile: file }).button, 'game: Pac-Man', 'img_1');
        await click('Pac flyer.png');
        assert.ok(mod.tabContents.basicLearn.includes('data-game-file="TOMY handheld.jpg"'), '대표 그림 다음 후보');
        await click('TOMY handheld.jpg');
        assert.ok(mod.tabContents.basicLearn.includes('data-game-file="Pac-Man gameplay.png"'), '끝에 닿으면 목록 처음(게임 화면)으로 돌아간다');
        assert.strictEqual(mod.images.img_1, dataUrl(PNG_B));
        assert.ok(!ctx.fetched.some(item => new URL(item.url).searchParams.get('generator') === 'search'), '목록 안에서 돌면 다시 검색하지 않는다');
        assert.deepStrictEqual(ctx.alerts, []);
    });

    await run("다시 찾기: 찾는 동안 그 차시를 지우면 넣지 않고, 못 찾은 게임 자리의 '다시 검색'은 위키백과 그림 칸으로 바꾼다", async () => {
        framedLesson('Tetris Boxshot.jpg');
        let release;
        ctx.fetchStub = async (url, init) => {
            if (!release) await new Promise(resolve => { release = resolve; });
            return wikiStub(REDO_STUB)(url, init);
        };
        const pending = call('regenerateGamePicture')(frameButton({ gameWiki: 'en', gamePage: 'Tetris', gameFile: 'Tetris Boxshot.jpg' }).button, 'game: Tetris', 'img_1');
        await waitFor(() => !!release, '요청이 걸린다');
        vm.runInContext('courseData = []; globalState.subjects[0].lessons = courseData;', ctx); // 차시를 휴지통으로
        release();
        await pending;
        assert.ok(ctx.alerts.at(-1).includes('그사이 이 차시를 지우거나'), ctx.alerts.at(-1));
        assert.strictEqual(ctx.written.length, 0);

        reset();
        const holderHtml = call('imagePlaceholderHtml')(call('escapeHtml')(call('gameMissText')('Tetris')), 'game: Tetris');
        const mod = openLesson(`## 1. 퍼즐\n\n테트리스 설명입니다.\n${holderHtml}\n뒤 글입니다.`);
        const holder = { style: {}, children: [], classList: { contains: name => name === 'image-placeholder' }, querySelector: sel => (sel === 'span' ? { textContent: call('gameMissText')('Tetris') } : null), appendChild(child) { this.children.push(child); } };
        ctx.elements['render-view'] = { querySelectorAll: sel => (sel === '.image-placeholder' ? [holder] : []) };
        ctx.fetchStub = wikiStub(TETRIS_STUB);
        const button = { dataset: { lessonAction: 'regenerate-image', keyword: 'game: Tetris' }, closest: sel => (sel === '.image-placeholder' ? holder : null) };
        try {
            await call('promptRegenerateImage')(button, 'game: Tetris', null);
        } finally {
            delete ctx.elements['render-view'];
        }
        const md = mod.tabContents.basicLearn;
        assert.ok(!md.includes('image-placeholder') && md.includes('Tetris · 출처: 위키백과 · 공정 이용 이미지'), md);
        assert.strictEqual(Object.values(mod.images)[0], dataUrl(PNG_A));
        assert.strictEqual(geminiCalls().length, 0);
    });

    /* ---------- 예시 게임 그림 넣기(이미 만든 탭) ---------- */
    await run('AI 답 검사: 목록 모양이 아니면 오류, 쓸 수 없는 항목은 빼고 같은 게임은 한 번만, 12개까지, 제목은 태그에 맞게 다듬는다', async () => {
        const parse = value => plain(call('parseExampleGames')(value));
        assert.throws(() => call('parseExampleGames')({}), /게임 목록이 없습니다/);
        assert.throws(() => call('parseExampleGames')({ games: 'Tetris' }), /게임 목록이 없습니다/);
        assert.deepStrictEqual(parse({ games: [] }), []);
        assert.deepStrictEqual(parse({ games: [
            { title: 'Tetris', quote: '**테트리스**는' }, { title: 'tetris', quote: '다른 구절' }, { title: 'game: Doom', quote: '둠은 1인칭' },
            { title: 'Bad "]--> title', quote: '나쁜 제목' }, { title: '', quote: '빈 제목' }, { title: 'No Quote' }, { title: 'Lines', quote: '첫 줄\n둘째 줄' },
            { title: 42, quote: '숫자 제목' }, null, 'Tetris', { title: 'Long', quote: 'x'.repeat(301) }
        ] }), [{ title: 'Tetris', quote: '**테트리스**는' }, { title: 'Doom', quote: '둠은 1인칭' }, { title: 'Bad - title', quote: '나쁜 제목' }]);
        const many = Array.from({ length: 15 }, (item, i) => ({ title: `Game ${i}`, quote: `게임 ${i}번` }));
        assert.strictEqual(parse({ games: many }).length, 12);
        assert.strictEqual(parse(many.slice(0, 2)).length, 2, '목록만 온 답도 받는다');
    });

    const PLAN_MD = [
        '# 📝 퍼즐 게임', '', '테트리스는 첫머리에도 나옵니다.', '',
        '## 1. 퍼즐 게임 (⏱ 30분)', '', '**테트리스**는 떨어지는 블록을 쌓는 퍼즐 게임입니다.', '다음 줄도 같은 단락입니다.', '',
        '```js', '// 테트리스 코드 예제: 코드 안의 글', '```', '',
        '| 게임 | 특징 |', '|---|---|', '| 스타크래프트 | 실시간 전략 |', '',
        '<table><tr><td>디아블로</td></tr></table>', '',
        '### ■ 슈퍼 마리오 브라더스의 점프', '',
        '<!-- [IMG: "game: Minecraft"] -->', '', '마인크래프트는 블록으로 세상을 짓는 게임입니다.', '',
        '<div class="image-wrapper"><img src="local:img_9" alt="둠"><button class="image-regenerate-btn" data-lesson-action="regenerate-image" data-keyword="game: DOOM" data-img-id="img_9">다시 찾기</button></div>', '',
        '둠은 1인칭 슈팅 게임의 고전입니다.', '- 팩맨은 미로 게임입니다.', '',
        '## 학습 목표', '', '- 갤러그처럼 단순한 규칙을 설명할 수 있습니다.'
    ].join('\n');
    const PLAN_GAMES = [
        { title: 'Tetris', quote: '**테트리스**는 떨어지는 블록을' },
        { title: 'StarCraft', quote: '스타크래프트' },
        { title: 'Diablo', quote: '디아블로' },
        { title: 'Super Mario Bros.', quote: '슈퍼 마리오 브라더스의 점프' },
        { title: 'Minecraft', quote: '마인크래프트는 블록으로' },
        { title: 'Doom', quote: '둠은 1인칭' },
        { title: 'Pac-Man', quote: '팩맨은 미로 게임' },
        { title: 'Galaga', quote: '갤러그처럼 단순한' },
        { title: 'Ghost Game', quote: '없는 문장입니다' },
        { title: 'Code Game', quote: '테트리스 코드 예제' }
    ];

    await run('자리 정하기: 구절이 든 단락 바로 뒤에 태그를 넣고, 코드 블록·표·제목·이미 있는 게임·글 위주 섹션·없는 구절은 건너뛴다', async () => {
        const plan = plain(call('planGameTags')(PLAN_MD, PLAN_GAMES));
        assert.deepStrictEqual(plan.added.map(game => game.title), ['Tetris', 'Pac-Man']);
        assert.deepStrictEqual(plan.skipped.map(item => [item.title, item.reason]), [
            ['StarCraft', 'quote'], ['Diablo', 'quote'], ['Super Mario Bros.', 'quote'], ['Minecraft', 'exists'], ['Doom', 'exists'],
            ['Galaga', 'section'], ['Ghost Game', 'quote'], ['Code Game', 'quote']
        ]);
        assert.ok(plan.text.includes('다음 줄도 같은 단락입니다.\n\n<!-- [IMG: "game: Tetris"] -->\n\n```js'), '단락(이어진 줄) 끝 뒤에 빈 줄과 함께');
        assert.ok(plan.text.includes('- 팩맨은 미로 게임입니다.\n\n<!-- [IMG: "game: Pac-Man"] -->\n\n## 학습 목표'), '목록 덩어리 뒤에');
        const removed = plan.text.replace('\n\n<!-- [IMG: "game: Tetris"] -->', '').replace('\n\n<!-- [IMG: "game: Pac-Man"] -->', '');
        assert.strictEqual(removed, PLAN_MD, '다른 글은 그대로 둔다');
        const crlf = plain(call('planGameTags')(PLAN_MD.replace(/\n/g, '\r\n'), PLAN_GAMES.slice(0, 1)));
        assert.ok(crlf.text.includes('다음 줄도 같은 단락입니다.\r\n\r\n<!-- [IMG: "game: Tetris"] -->\r\n\r\n```js'), '윈도 줄바꿈 글은 넣는 줄도 같게');
        const htmlLesson = '## 1. 웹 게임\n\n`<table>` 태그로 점수판을 만듭니다.\n\n마인크래프트 웹 버전도 있습니다.';
        assert.deepStrictEqual(plain(call('planGameTags')(htmlLesson, [{ title: 'Minecraft', quote: '마인크래프트 웹 버전도' }])).added.map(game => game.title), ['Minecraft'], '글 속 `<table>` 설명 뒤의 글을 표로 보지 않는다');
        const nothing = plain(call('planGameTags')(PLAN_MD, PLAN_GAMES.slice(1, 4)));
        assert.deepStrictEqual([nothing.added.length, nothing.text === PLAN_MD], [0, true]);
        assert.ok(!call('gameLessonText')(PLAN_MD).includes('코드 안의 글') && !call('gameLessonText')(PLAN_MD).includes('image-wrapper'), 'AI에 코드 블록·그림 줄은 보내지 않는다');
    });

    const ACTION_MD = '## 1. 퍼즐 게임\n\n**테트리스**는 떨어지는 블록을 쌓는 퍼즐 게임입니다.\n\n## 2. 실시간 전략\n\n스타크래프트는 실시간 전략 게임입니다.\n\n<!-- [IMG: "strategy map"] -->';
    const gamesReply = games => json(textReply(JSON.stringify({ games })));

    await run('예시 게임 그림 넣기: AI 한 번으로 게임을 찾고, 미리보기로 보인 뒤 반영하면 게임 그림만 위키백과에서 채운다(다른 그림 자리는 AI를 부르지 않고 둔다)', async () => {
        const mod = openLesson(ACTION_MD);
        const wiki = wikiStub(TETRIS_STUB);
        ctx.fetchStub = async (url, init) => (url.includes('generativelanguage')
            ? gamesReply([{ title: 'Tetris', quote: '**테트리스**는 떨어지는 블록을' }, { title: 'StarCraft', quote: '스타크래프트는 실시간 전략 게임입니다' }])
            : wiki(url, init));
        await call('insertGamePictures')(7);
        const ai = geminiCalls();
        assert.strictEqual(ai.length, 1, 'AI 호출은 게임 목록 한 번');
        const body = JSON.parse(ai[0].init.body);
        assert.strictEqual(body.generationConfig.responseMimeType, 'application/json');
        assert.ok(body.contents[0].parts[0].text.includes('[교안]\n## 1. 퍼즐 게임') && body.contents[0].parts[0].text.includes('공식 영어 제목'), '새 프롬프트에 탭 글을 싣는다');
        assert.strictEqual(ctx.previews.length, 1);
        const preview = ctx.previews[0];
        assert.strictEqual(preview.before, ACTION_MD);
        assert.ok(preview.after.includes('<!-- [IMG: "game: Tetris"] -->') && preview.after.includes('<!-- [IMG: "game: StarCraft"] -->'));
        assert.ok(preview.opts.note.includes('예시 게임 2개의 그림 자리') && preview.opts.tabId === 'basicLearn', preview.opts.note);
        assert.strictEqual(ctx.archived.length, 1, '바꾸기 전 글은 작업 기록에 남긴다');
        const md = mod.tabContents.basicLearn;
        assert.ok(md.includes('Tetris · 출처: 위키백과 · 공정 이용 이미지'), md);
        assert.ok(md.includes("인터넷에서 &#039;StarCraft&#039; 게임 그림을 찾지 못했습니다"), '못 찾은 게임은 그림 자리로');
        assert.ok(md.includes('<!-- [IMG: "strategy map"] -->'), 'AI를 불러야 하는 그림 자리는 그대로 둔다');
        assert.ok(ctx.toasts.at(-1).startsWith('예시 게임 그림 1장을 인터넷에서 찾아 넣고 출처를 적었습니다.') && ctx.toasts.at(-1).includes('1곳은 인터넷에서'), ctx.toasts.at(-1));
        assert.ok(ctx.elements['lesson-pipeline-bar'] === undefined || ctx.elements['lesson-pipeline-bar'].removed, '진행 막대를 닫는다');
    });

    await run('예시 게임 그림 넣기: 기다리는 동안 다른 차시나 탭으로 옮기면 미리보기를 띄우지 않고 글을 바꾸지 않는다', async () => {
        const moves = [
            () => vm.runInContext("currentLessonTab = 'basicPrac';", ctx),
            () => {
                ctx.globalState.subjects[0].lessons.push({ id: 8, title: '다른 차시', images: {}, tabContents: tabsOf('## 다른 글'), content: '## 다른 글' });
                vm.runInContext('currentEditingModuleId = 8;', ctx);
            }
        ];
        for (const move of moves) {
            reset();
            const mod = openLesson(ACTION_MD);
            ctx.fetchStub = async url => {
                if (!url.includes('generativelanguage')) throw new Error(`부르면 안 된다: ${url}`);
                move();
                return gamesReply([{ title: 'Tetris', quote: '**테트리스**는 떨어지는 블록을' }]);
            };
            await call('insertGamePictures')(7);
            assert.strictEqual(ctx.previews.length, 0, '미리보기를 띄우지 않는다');
            assert.strictEqual(mod.tabContents.basicLearn, ACTION_MD);
            assert.ok(ctx.toasts.at(-1).includes('다른 차시나 탭으로 옮겨'), ctx.toasts.at(-1));
            assert.strictEqual(ctx.archived.length, 0);
        }
    });

    await run('예시 게임 그림 넣기: 미리보기를 보는 동안 원문 칸에서 그 탭을 고쳤으면 그 글을 먼저 넣고, 글이 바뀌었으니 반영하지 않는다', async () => {
        const mod = openLesson(ACTION_MD);
        const edited = `${ACTION_MD}\n\n원문 칸에서 고친 문단입니다.`;
        const raw = { classList: { contains: () => false }, dataset: { moduleId: '7', tabId: 'basicLearn' }, value: edited };
        ctx.fetchStub = async url => {
            if (!url.includes('generativelanguage')) throw new Error(`부르면 안 된다: ${url}`);
            return gamesReply([{ title: 'Tetris', quote: '**테트리스**는 떨어지는 블록을' }]);
        };
        ctx.previewHook = () => { ctx.elements['raw-view'] = raw; }; // 미리보기를 보는 동안 원문 칸을 열어 고쳤다
        ctx.saveRawContent = () => vm.runInContext('setTabMarkdown', ctx)(mod, 'basicLearn', raw.value);
        await call('insertGamePictures')(7);
        assert.ok(ctx.alerts.at(-1).includes('탭 내용이 바뀌어 반영하지 않았습니다'), ctx.alerts.at(-1));
        assert.strictEqual(mod.tabContents.basicLearn, edited, '고친 글을 지우지 않는다');
        assert.strictEqual(ctx.archived.length, 0);
        assert.ok(!ctx.fetched.some(item => item.url.includes('wikipedia')));
    });

    await run('예시 게임 그림 넣기: 미리보기에서 반영하지 않거나, 넣을 게임이 없거나, AI 답이 목록이 아니면 글을 바꾸지 않는다', async () => {
        const mod = openLesson(ACTION_MD);
        ctx.fetchStub = async url => (url.includes('generativelanguage') ? gamesReply([{ title: 'Tetris', quote: '**테트리스**는 떨어지는 블록을' }]) : wikiStub(TETRIS_STUB)(url));
        ctx.previewAnswer = null;
        await call('insertGamePictures')(7);
        assert.strictEqual(mod.tabContents.basicLearn, ACTION_MD);
        assert.strictEqual(ctx.toasts.at(-1), '예시 게임 그림 자리를 넣지 않았습니다.');
        assert.ok(!ctx.fetched.some(item => item.url.includes('wikipedia')), '반영하지 않으면 그림을 찾지 않는다');
        reset();
        openLesson(ACTION_MD);
        ctx.fetchStub = async () => gamesReply([]);
        await call('insertGamePictures')(7);
        assert.strictEqual(ctx.toasts.at(-1), '이 탭에서 예시로 든 실제 게임을 찾지 못했습니다.');
        reset();
        openLesson(ACTION_MD);
        ctx.fetchStub = async () => json(textReply('{"answer": "없음"}'));
        await call('insertGamePictures')(7);
        assert.ok(ctx.alerts.at(-1).includes('AI 답에 게임 목록이 없습니다'), ctx.alerts.at(-1));
        assert.strictEqual(ctx.previews.length, 0);
    });

    await run('예시 게임 그림 넣기·일괄 이미지 찾기: 학습이해도·심화이해도에는 그림 자리를 넣지도 채우지도 않는다(문항이 길어도)', async () => {
        const stem = `${'테트리스처럼 떨어지는 블록을 맞추는 게임에서 규칙과 보상이 어떻게 이어지는지 살펴봅니다. '.repeat(8)}가장 알맞은 설명을 고릅니다.`;
        const question = `### 문제 1. 블록 퍼즐 게임에서 규칙과 보상이 플레이어의 다음 행동을 어떻게 이끄는지 구조를 단계별로 분석하기\n학습 목표 1 · 밴드 L2 · 서술형\n\n${stem}\n\n✅ **정답:** 모범 답안`;
        for (const tabId of ['assessment', 'advAssessment']) {
            reset();
            const mod = openLesson('## 1. 퍼즐 게임\n\n본문입니다.');
            mod.tabContents = { ...mod.tabContents, [tabId]: question };
            vm.runInContext(`currentLessonTab = '${tabId}';`, ctx);
            // 부르면 게임을 찾았다고 답한다(막지 않으면 그 문항 뒤에 그림 자리를 넣으려 한다)
            ctx.fetchStub = async url => (url.includes('generativelanguage') ? gamesReply([{ title: 'Tetris', quote: '테트리스처럼 떨어지는 블록을' }]) : wikiStub(TETRIS_STUB)(url));
            await call('insertGamePictures')(7);
            assert.strictEqual(ctx.fetched.length, 0, `${tabId}: AI를 부르지 않는다`);
            assert.strictEqual(mod.tabContents[tabId], question, `${tabId}: 글을 바꾸지 않는다`);
            assert.strictEqual(ctx.alerts.at(-1), '학습이해도·심화이해도에는 그림을 넣지 않습니다. 기본학습·기본실습·심화학습·심화실습 탭에서 눌러 주세요.');
        }
        // 예전에 남은 그림 자리(제목이 길면 글 위주 섹션으로 보지 않는다)도 일괄 이미지 찾기·콘텐츠 정리가 세지도 채우지도 않는다
        reset();
        const leftover = question.replace('\n\n테트리스', '\n\n<!-- [IMG: "game: Tetris"] -->\n\n<!-- [IMG: "puzzle board"] -->\n\n테트리스');
        const mod = openLesson('## 1. 퍼즐 게임\n\n본문입니다.');
        mod.tabContents = { ...mod.tabContents, assessment: leftover };
        assert.strictEqual(call('pendingImageTags')(leftover).length, 2, '글만 보면 채울 자리다');
        assert.deepStrictEqual([call('countImageSlots')(mod), call('countGameImageSlots')(mod), plain(call('imageTagTabs')(mod)).length], [0, 0, 0]);
        await call('generateAllImagesInModule')(7);
        assert.strictEqual(ctx.toasts.at(-1), '아직 채우지 않은 그림 자리가 없습니다.');
        vm.runInContext('confirmWithEstimate = () => Promise.resolve(true); confirmAsync = () => Promise.resolve(true);', ctx);
        await call('sanitizeAllContent')();
        const cleaned = mod.tabContents.assessment;
        assert.ok(cleaned.includes('<!-- [IMG: "game: Tetris"] -->') && cleaned.includes('<!-- [IMG: "puzzle board"] -->') && !cleaned.includes('image-wrapper'), '콘텐츠 정리도 문제은행 탭의 그림 자리를 채우지 않는다(서식만 고친다)');
        assert.ok(!ctx.fetched.some(item => item.url.includes('wikipedia') || item.url.includes('generativelanguage')), '그림을 찾지 않는다');
        assert.ok(read('js/api.js').includes("${isQuestionBankTab(currentLessonTab) ? '' : `<button onclick=\"insertGamePictures("), '도구 메뉴: 문제은행 탭에서는 단추를 두지 않는다');
    });

    /* ---------- 예고·개수 ---------- */
    await run('예고: 게임 그림은 그림 자리 수에 세지만 AI 호출·그림 모델 장수에는 넣지 않고 위키백과에서 무료로 찾는다고 보인다', async () => {
        const text = '## 1. 첫째\n\n<!-- [IMG: "a"] -->\n\n<!-- [IMG: "game: Tetris"] -->\n\n<!-- [IMG: "game: Doom"] -->\n\n```md\n<!-- [IMG: "game: Code"] -->\n```';
        const mod = openLesson(text);
        assert.strictEqual(call('countImageSlots')(mod), 3);
        assert.strictEqual(call('countGameImageSlots')(mod), 2);
        vm.runInContext('confirmWithEstimate = (message, work, opts) => { window.estimates.push({ message, work, opts }); return Promise.resolve(false); };', ctx);
        ctx.estimates = [];
        await call('generateAllImagesInModule')(7);
        assert.deepStrictEqual(plain(ctx.estimates[0].work), { images: 1, gameImages: 2 });
        assert.ok(ctx.estimates[0].message.includes('그림 자리 3개'));
        ctx.estimates = [];
        await call('sanitizeAllContent')();
        assert.deepStrictEqual(plain(ctx.estimates[0].work), { images: 1, gameImages: 2 });
        const summary = plain(call('estimateSummary')({ images: 1, gameImages: 2 }, { model: 'gemini-3.8-flash', timings: {}, exactImages: true }));
        assert.deepStrictEqual([summary.calls, summary.images, summary.gameImages], [1, 1, 2], '검색어 정하기 1번만 센다');
        const lines = plain(call('estimateLines')(summary, {}));
        assert.ok(lines.includes('예시 게임 그림: 2장 · 위키백과에서 무료로 찾음(못 찾으면 검색 키가 있을 때 웹 검색)') && lines.includes('그림: 1장 · 그림 모델 · 장마다 요금'), JSON.stringify(lines));
        const gamesOnly = plain(call('estimateLines')(plain(call('estimateSummary')({ gameImages: 4 }, { model: 'gemini-3.8-flash', timings: {} })), {}));
        assert.ok(!gamesOnly.some(line => line.startsWith('글:') || line.startsWith('그림:')) && gamesOnly[0] === '예시 게임 그림: 약 4장 · 위키백과에서 무료로 찾음(못 찾으면 검색 키가 있을 때 웹 검색)', JSON.stringify(gamesOnly));
        assert.strictEqual(call('estimateCalls')({ gameImages: 9 }), 0);
        assert.strictEqual(call('estimateCalls')({ gameImages: 9 }, 'svg'), 0, 'SVG 삽화여도 게임 그림은 글 모델이 그리지 않는다');
    });

    /* ---------- 내보내기·저장소·연결 ---------- */
    await run('내보내기: 그림 설명의 출처 페이지 주소(http·https만)를 설명 아래 글자로 적는다', async () => {
        if (!domino) throw new Error('domino 없음');
        const doc = domino.createDocument('<html><body></body></html>', true);
        // domino의 목록에는 forEach가 없어 item(i)로 채운다(image-motion.test.js와 같다)
        [doc.querySelectorAll('x'), doc.body.children, doc.createElement('div').querySelectorAll('x')].forEach(list => {
            const proto = Object.getPrototypeOf(list);
            if (!proto.forEach) Object.defineProperty(proto, 'forEach', { configurable: true, value(fn) { for (let i = 0; i < this.length; i++) fn(this.item(i), i, this); } });
        });
        const ectx = { console: quiet, window: {}, document: doc, LESSON_TABS: [] };
        vm.createContext(ectx);
        vm.runInContext(read('js/lesson-export.js'), ectx);
        const frame = (url, name) => call('gameImageWrapperHtml')('img_1', `game: ${name}`, { vendor: 'wikipedia', wiki: 'en', page: name, name, file: 'a.png', pageUrl: url, license: '공정 이용 이미지' });
        const box = vm.runInContext('exportStrip', ectx)(`${frame('https://en.wikipedia.org/wiki/Tetris', 'Tetris')}${frame('', 'Doom').replace('<div class="image-caption"', '<div class="image-caption" data-source-url="javascript:alert(1)"')}`);
        const sources = [...Array(box.querySelectorAll('.image-source').length).keys()].map(i => box.querySelectorAll('.image-source').item(i).textContent);
        assert.deepStrictEqual(sources, ['출처 페이지: https://en.wikipedia.org/wiki/Tetris'], '안전하지 않은 주소는 적지 않는다');
        assert.strictEqual(box.querySelectorAll('button').length, 0, '다시 찾기 버튼은 내보내지 않는다');
        assert.ok(box.querySelector('.image-caption').textContent.includes('출처: 위키백과'));
        assert.ok(read('js/lesson-export.js').includes('.image-source {'), '내보낸 문서에 설명 글 서식');
    });

    await run('MD로 바꾸기(학습자용 교안·작업 기록): 게임 그림 틀은 그림과 출처·라이선스 줄로, 다른 그림 틀은 그림만 남기고 닫는 </div>를 남기지 않는다', async () => {
        vm.runInContext(sliceSource(read('js/state.js'), 'function resolveMarkdownImages('), ctx);
        vm.runInContext(read('js/lesson-material.js'), ctx);
        const PNG = 'data:image/png;base64,QUFBQkJC';
        const found = { vendor: 'wikipedia', wiki: 'en', page: 'Tetris', name: 'Tetris', file: 'a.png', pageUrl: 'https://en.wikipedia.org/wiki/Tetris?a=1&b=2', license: 'CC BY-SA 4.0' };
        const game = call('gameImageWrapperHtml')('img_9', 'game: Tetris', found);
        const other = call('imageWrapperHtml')('img_8', '서버 구조', '서버 구조', '서버와 클라이언트 연결');
        const md = `## 게임 예시\n\n앞 글\n\n${game}\n\n가운데 글\n\n${other}\n\n뒤 글`;
        const out = call('resolveMarkdownImages')(md, { img_9: PNG, img_8: PNG });
        assert.ok(out.includes(`![Tetris 게임 그림](${PNG})\n\nTetris · 출처: 위키백과 · CC BY-SA 4.0 · 출처 페이지: https://en.wikipedia.org/wiki/Tetris?a=1&b=2`), out);
        assert.ok(out.includes(`가운데 글\n\n![서버 구조](${PNG})\n\n뒤 글`), '다른 그림의 설명은 빼고 그림만');
        assert.ok(!out.includes('</div>') && !out.includes('image-caption') && !out.includes('서버와 클라이언트 연결'), out);
        const google = call('gameImageWrapperHtml')('img_7', 'game: Doom', { vendor: 'google', name: 'Doom', pageUrl: '', license: '이용 조건 확인 필요' });
        assert.ok(call('resolveMarkdownImages')(google, { img_7: PNG }).endsWith('\n\nDoom · 출처: 웹 검색 · 이용 조건 확인 필요'), '출처 페이지가 없어도 출처 줄은 남긴다');
        const lesson = { id: 7, title: '차시', images: { img_9: PNG }, tabContents: { basicLearn: md } };
        const material = call('materialTabMd')(lesson, 'basicLearn');
        assert.ok(material.includes('출처: 위키백과 · CC BY-SA 4.0') && !material.includes('</div>'), '학습자용 교안에도 출처를 남긴다');
    });

    await run('보기 화면: AI 그림의 설명은 예전처럼 숨기고, 출처 페이지를 단 게임 그림 설명(게임 · 출처 · 라이선스)은 숨기지 않는다', async () => {
        const html = read('index.html').replace(/\/\*[\s\S]*?\*\//g, ''); // 주석은 뺀다
        const hidden = [...html.matchAll(/([^{}]*\.image-caption[^{}]*)\{([^{}]*)\}/g)].filter(([, , body]) => /display:\s*none/.test(body)).map(([, selector]) => selector.trim());
        assert.deepStrictEqual(hidden, ['.image-wrapper .image-caption:not([data-source-url])'], hidden.join(' | '));
        // 보기 화면의 그림 틀은 가로 줄(flex)이라 설명이 그림 옆에 붙지 않게 줄을 바꿔 그림 아래에 둔다
        assert.ok(/\.markdown-body \.image-wrapper\s*\{\s*flex-wrap:\s*wrap;\s*\}/.test(html) && /\.markdown-body \.image-wrapper \.image-caption\[data-source-url\]\s*\{\s*flex-basis:\s*100%;\s*\}/.test(html), '설명은 그림 아래 한 줄');
        const caption = call('gameImageWrapperHtml')('img_9', 'game: Tetris', { vendor: 'wikipedia', wiki: 'en', page: 'Tetris', name: 'Tetris', file: 'a.png', pageUrl: 'https://en.wikipedia.org/wiki/Tetris', license: '공정 이용 이미지' });
        assert.ok(caption.includes('<div class="image-caption" data-source-url="https://en.wikipedia.org/wiki/Tetris"'), '게임 그림 설명에는 출처 페이지가 달린다');
    });

    await run('저장소: 검색 그림 저장소에 게임 그림 정보(meta)를 함께 담고, 주지 않으면 예전 모양 그대로 담는다', async () => {
        const dbCtx = { console: quiet, Date, Promise, indexedDB: null };
        vm.createContext(dbCtx);
        vm.runInContext(sliceSource(read('js/state.js'), 'const DBManager = {', '\n};\n'), dbCtx);
        const db = vm.runInContext('DBManager', dbCtx);
        const puts = [];
        db.dbInstance = { transaction: () => ({ objectStore: () => ({ put: payload => { puts.push(payload); const req = {}; setImmediate(() => req.onsuccess?.()); return req; } }) }) };
        await db.setCache('game: tetris', 'data:image/png;base64,QQ==', 'https://en.wikipedia.org/wiki/Tetris', '위키백과 게임 그림', { vendor: 'wikipedia', license: '공정 이용 이미지' });
        await db.setCache('puzzle', 'data:image/png;base64,QQ==', 'https://x.example/a.png', '웹 검색 연동');
        assert.deepStrictEqual(plain(puts[0].meta), { vendor: 'wikipedia', license: '공정 이용 이미지' });
        assert.ok(!('meta' in puts[1]), '보통 그림 기록은 그대로');
    });

    await run('연결: 프롬프트·도구 메뉴·index.html·README가 예시 게임 그림을 말한다', async () => {
        const rules = vm.runInContext('CONTEXT_CORE.rules.image_tags', ctx);
        assert.ok(rules.includes('<!-- [IMG: "game: 공식 영어 제목"] -->') && rules.includes('실제로 출시된 게임') && rules.includes('영어 위키백과 문서 제목'), rules);
        assert.ok(rules.includes('④실제로 출시된 게임을 예시로 들 경우 — 그 게임을 소개하는 제목이나 단락 바로 아래에') && rules.includes('탭마다 게임 하나에 한 번만'), '넣을 자리와 한 번만 넣는 규칙');
        assert.ok(rules.includes('①핵심 내용의 제목 수준 2(##) 마다') && rules.includes('오직 <!-- [IMG: "영어 키워드"] --> 형태의 주석 태그만 허용됩니다'), '나머지 그림 태그 규칙은 그대로');
        const api = read('js/api.js');
        const at = id => api.indexOf(`id="${id}"`);
        assert.ok(at('img-batch-btn') < at('sanitize-btn') && at('sanitize-btn') < at('game-picture-btn') && at('game-picture-btn') < api.indexOf('<i class="ph-bold ph-image"></i> 이미지 삽입'), '도구 메뉴: 콘텐츠 정리 바로 아래');
        assert.ok(api.includes("onclick=\"insertGamePictures('${mod.id}'); this.closest('details').open = false\""));
        const html = read('index.html');
        const scripts = [...html.matchAll(/<script src="\.\/js\/([\w-]+)\.js\?v=(\d+)"><\/script>/g)].map(match => [match[1], match[2]]);
        const order = scripts.map(([name]) => name);
        assert.ok(order.indexOf('game-images') >= 0 && order.indexOf('game-images') < order.indexOf('game-image-tags') && order.indexOf('game-image-tags') < order.indexOf('api'), order.join(','));
        assert.strictEqual(new Set(scripts.map(([, v]) => v)).size, 1, '새 태그도 이웃과 같은 ?v=');
        assert.ok(read('README.md').includes('예시 게임 그림은 위키백과에서 찾아 넣고 출처를 적습니다'));
        // 위키백과에서 못 찾으면 검색 키가 있을 때 Google로 찾으므로(findGamePictureCached) 단추 설명·README·예고·진행 문구도 그렇게 말한다
        assert.ok(read('js/game-images.js').includes('|| (await findGamePictureByGoogle(title, { signal, context }))'), '웹 검색으로 물러서는 길이 있다');
        const tip = (api.match(/id="game-picture-btn"[^>]*title="([^"]*)"/) || [])[1] || '';
        assert.ok(tip.includes('위키백과에서 찾아 넣습니다') && tip.includes('웹 검색') && tip.includes('이용 조건 확인 필요'), tip);
        const readme = read('README.md').split('\n').find(line => line.startsWith('- **예시 게임 그림**')) || '';
        assert.ok(readme.includes('웹 검색') && readme.includes('이용 조건 확인 필요'), readme);
        assert.ok(api.includes("${game ? '인터넷에서 찾는 중' : '만드는 중'}") && !api.includes('위키백과에서 찾는 중'), '진행 문구');
        assert.ok(read('js/game-image-tags.js').includes('못 찾으면 검색 키가 있을 때 웹 검색으로 찾습니다'), '미리보기 안내');
        const sources = ['js/game-images.js', 'js/game-image-tags.js'].map(read).join('\n');
        assert.ok(!/new RegExp\(/.test(sources), '데이터로 정규식을 만들지 않는다');
        assert.ok(!/(^|[^.\w])(confirm|prompt|alert)\((?!\))/m.test(sources), '브라우저 기본 창을 쓰지 않는다');
        const hosts = [...new Set([...sources.matchAll(/https?:\/\/([\w.-]+)/g)].map(match => match[1]))].sort();
        assert.deepStrictEqual(hosts, [], '주소는 정해 둔 호스트 목록에서만 만든다');
    });

    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
