// game-images.js - 교안이 예로 든 실제 게임의 그림을 인터넷(위키백과)에서 찾아 넣는다
// 그림 태그 <!-- [IMG: "game: 공식 영어 제목"] -->는 AI 그림 모델 대신 이 파일이 찾는다(api.js processImageTags).
// 영어 위키백과에서 그 게임 문서를 찾고(한글 제목이면 한국어 위키백과도), 대표 그림과 라이선스를 읽어 출처와 함께 넣는다.
// 위키백과에서 못 찾으면 강사가 Google 검색 키를 넣었을 때만 Google로 찾는다. Pixabay와 AI 그림 모델은 쓰지 않는다.
// 보내는 것은 게임 제목 검색어뿐이고 위키백과 API 두 곳과 그림 주소 두 곳(upload·thumb.wikimedia.org)만 부른다(키 없음). 테스트: tests/game-images.test.js
// 이미 만든 탭에 게임 그림 자리를 넣는 도구의 '예시 게임 그림 넣기'는 game-image-tags.js에 있다

/* ---------- 정해 둔 값 ---------- */
const GAME_WIKI_HOSTS = { en: 'en.wikipedia.org', ko: 'ko.wikipedia.org' };
const GAME_PICTURE_HOSTS = ['upload.wikimedia.org', 'thumb.wikimedia.org'];
const GAME_PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const GAME_PICTURE_MAX_BYTES = 8 * 1024 * 1024;
const GAME_FETCH_TIMEOUT_MS = 15000; // 요청 하나를 기다리는 시간
const GAME_RETRY_WAITS = [1500, 4000]; // 위키미디어가 바쁘다(429·503)고 하면 쉬고 다시 묻는 시간(두 번까지)
const GAME_RETRY_MAX_MS = 8000;
const GAME_API_GAP_MS = 500; // 위키백과 API 요청 사이 간격(1초에 두 번까지). 한꺼번에 보내면 위키미디어가 막는다
const GAME_SEARCH_LIMIT = 5;
const GAME_THUMB_WIDTH = 1000;
const GAME_CANDIDATE_TRIES = 4; // 다시 찾기 한 번에 차례로 받아 볼 그림 파일 수
const GAME_TITLE_MAX = 100;
const GAME_RASTER_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const GAME_SKIP_FILE_WORDS = ['icon', 'logo', 'wordmark'];
// 다시 찾기 후보 가운데 게임 화면·표지일 낱말(파일 이름). 이런 파일을 사람 사진보다 앞에 둔다
const GAME_PICTURE_WORDS = ['screenshot', 'screenshots', 'gameplay', 'screen', 'cover', 'boxart', 'boxshot', 'box', 'art', 'artwork', 'title', 'poster', 'cartridge', 'arcade', 'level', 'menu'];
// 문서 설명이 게임인지 가르는 낱말(영어는 낱말 단위, 한국어는 글자 그대로 찾는다)
const GAME_WORDS = ['game', 'games', 'videogame', 'videogames'];
const GAME_NOT_WORDS = ['company', 'corporation', 'developer', 'publisher', 'designer', 'programmer', 'person', 'console', 'consoles', 'character', 'mascot', 'engine', 'genre', 'studio', 'magazine', 'award', 'awards', 'convention', 'film'];
const GAME_PERSON_VIEWS = ['first', 'second', 'third']; // first-person shooter의 person은 사람 문서가 아니다
const GAME_NOT_WORDS_KO =['게임기', '콘솔', '회사', '기업', '개발사', '배급사', '유통사', '캐릭터', '엔진', '장르', '인물', '디자이너', '영화', '잡지'];
const GAME_CACHE_LABEL = { wikipedia: '위키백과 게임 그림', google: '웹 검색 게임 그림' };

const GAME_TEXT = {
    gone: '그사이 이 차시를 지우거나 백업·PC 폴더를 불러와 내용이 바뀌어 그림을 넣지 않았습니다.',
    searching: '인터넷에서 다른 그림을 찾는 중입니다…',
    slotMissing: '이 그림 자리를 교안 원문에서 찾지 못했습니다. 도구 → 원문 전체 수정에서 그 자리를 지운 뒤 다시 넣어 주세요.',
    slotMoved: '그림을 찾는 동안 탭 글이 바뀌어 그 자리를 찾지 못했습니다. 다시 눌러 주세요.',
    noOther: '이 게임의 다른 그림을 인터넷에서 찾지 못했습니다. 지금 그림은 그대로 둡니다.'
};

/* ---------- 글자 다루기 ---------- */
const gameStopError = () => (typeof abortError === 'function' ? abortError() : Object.assign(new Error('중지했습니다.'), { name: 'AbortError' }));
const gameWikiHost = wiki => (Object.prototype.hasOwnProperty.call(GAME_WIKI_HOSTS, wiki) ? GAME_WIKI_HOSTS[wiki] : '');

// 견주기용 제목: 악센트·대소문자·문장부호·띄어쓰기 차이를 지운다(정해 둔 모양의 정규식만 쓴다)
function gameTitleKey(title) {
    return String(title ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').normalize('NFC').toLowerCase()
        .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// 태그에 넣을 게임 제목: 태그를 깨는 글자(" ] < > 줄바꿈)와 주석을 닫는 --를 지운다. AI가 game:을 붙여 보내도 떼어 낸다
function gameTagTitle(title) {
    const text = String(title ?? '').trim();
    const bare = isGameImageKeyword(text) ? gameImageTitle(text) : text;
    return bare.replace(/["\]<>\r\n]/g, ' ').replace(/-{2,}/g, '-').replace(/\s+/g, ' ').trim().slice(0, GAME_TITLE_MAX).trim();
}

// 문서 제목 끝의 괄호 설명((1993 video game) 등)을 뗀 이름과 그 설명
function gameArticleParts(title) {
    const text = String(title ?? '').trim();
    const open = text.lastIndexOf(' (');
    return open > 0 && text.endsWith(')') ? { base: text.slice(0, open).trim(), note: text.slice(open + 2, -1) } : { base: text, note: '' };
}

// 찾는 제목과 문서 제목이 얼마나 맞는지: 3 같음 · 2 앞의 The만 다름 · 1 부제만 같음 · 0 다름
// 둘 다 끝의 괄호 설명은 떼고 견준다(AI가 'StarCraft (video game)'처럼 문서 제목 그대로 보내도 맞는다)
function gameTitleScore(articleTitle, wantedTitle) {
    const { base } = gameArticleParts(articleTitle);
    const wanted = gameArticleParts(wantedTitle).base;
    const have = gameTitleKey(base);
    const want = gameTitleKey(wanted);
    if (!have || !want) return 0;
    if (have === want) return 3;
    const bare = key => (key.startsWith('the ') ? key.slice(4) : key);
    if (bare(have) === bare(want)) return 2;
    const tail = text => {
        const at = String(text).lastIndexOf(':');
        return at > 0 ? bare(gameTitleKey(String(text).slice(at + 1))) : '';
    };
    const haveTail = tail(base);
    const wantTail = tail(wanted);
    return (haveTail && haveTail === bare(want)) || (wantTail && wantTail === bare(have)) ? 1 : 0;
}

// 문서 설명(없으면 제목의 괄호 설명)이 게임을 말하는지. 게임 회사·게임기·캐릭터·엔진·장르 문서는 아니다
function gamePageIsGame(page) {
    const text = [page?.description, gameArticleParts(page?.title).note].filter(item => typeof item === 'string' && item.trim()).join(' ');
    if (!text) return false;
    const words = gameTitleKey(text).split(' ');
    const game = words.some(word => GAME_WORDS.includes(word)) || text.includes('게임');
    const notWord = (word, i) => GAME_NOT_WORDS.includes(word) && !(word === 'person' && GAME_PERSON_VIEWS.includes(words[i - 1]));
    const other = words.some(notWord) || GAME_NOT_WORDS_KO.some(word => text.includes(word));
    return game && !other;
}

// 찾는 제목에 괄호 설명((1993 video game) 등)이 있을 때 문서가 그 설명과 맞는지: 2 제목 전체가 같음 · 1 설명이 듦 · 0 아님
function gameNoteFit(articleTitle, wantedTitle) {
    const wantNote = gameTitleKey(gameArticleParts(wantedTitle).note);
    if (!wantNote) return 0;
    if (gameTitleKey(articleTitle) === gameTitleKey(wantedTitle)) return 2;
    return gameTitleKey(gameArticleParts(articleTitle).note).includes(wantNote) ? 1 : 0;
}

// 검색 결과 가운데 제목이 가장 잘 맞고 설명이 게임인 문서. 점수가 같으면 괄호 설명이 맞는 것, 그다음 검색 순위가 높은 것. 없으면 null
function pickGameArticle(pages, wanted) {
    const ranked = (Array.isArray(pages) ? pages : [])
        .map(page => ({ page, score: gameTitleScore(page?.title, wanted), fit: gameNoteFit(page?.title, wanted), rank: Number.isFinite(Number(page?.index)) ? Number(page.index) : 99 }))
        .filter(item => item.score > 0 && gamePageIsGame(item.page))
        .sort((a, b) => b.score - a.score || b.fit - a.fit || a.rank - b.rank);
    return ranked[0]?.page || null;
}

/* ---------- 주소·그림 검사 ---------- */
// 그림을 받을 수 있는 주소: https의 upload·thumb.wikimedia.org만(//로 시작하면 https로 읽는다). 아니면 ''
function gamePictureUrl(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    let url;
    try {
        url = new URL(text.startsWith('//') ? `https:${text}` : text);
    } catch (err) {
        return '';
    }
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && GAME_PICTURE_HOSTS.includes(url.hostname) ? url.href : '';
}

// 출처 페이지 주소: http·https만. 아니면 ''
function gameSourceUrl(value) {
    const text = String(value ?? '').trim();
    if (!text || text.length > 2000) return '';
    let url;
    try {
        url = new URL(text);
    } catch (err) {
        return '';
    }
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : '';
}

function gameUrlHost(value) {
    try {
        return value ? new URL(value).hostname : '';
    } catch (err) {
        return '';
    }
}

// 받은 바이트의 그림 종류(PNG·JPEG·GIF·WebP 머리). 아니면 ''
function gamePictureType(bytes) {
    const starts = (...head) => head.every((byte, i) => bytes[i] === byte);
    if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
    if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
    if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return '';
}

function gameBase64(bytes) {
    let binary = '';
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
    return btoa(binary);
}

// 파일 이름: 이름공간(File:·파일:)을 떼고 밑줄을 띄어쓰기로
function gameFileName(title) {
    const text = String(title ?? '').trim();
    const at = text.indexOf(':');
    return (at >= 0 ? text.slice(at + 1) : text).replace(/_/g, ' ').trim();
}
const gameFileKey = name => gameFileName(name).toLowerCase();

// 다시 찾기 후보가 될 그림 파일: 래스터 그림(jpg·png·gif·webp)만. 아이콘·로고와 svg는 뺀다
function gameRasterFile(name) {
    const lower = String(name ?? '').toLowerCase();
    const dot = lower.lastIndexOf('.');
    return dot > 0 && GAME_RASTER_EXTS.includes(lower.slice(dot + 1)) && !GAME_SKIP_FILE_WORDS.some(word => lower.includes(word));
}

// extmetadata 값(HTML이 섞일 수 있다)을 글자로
function gameMetaText(entry) {
    const value = entry && typeof entry === 'object' ? entry.value : entry;
    return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// 그림 라이선스를 한국어로: 공정 이용 이미지(NonFree) · 퍼블릭 도메인 · 'CC BY-SA 4.0 라이선스' · 라이선스 정보 없음
function gameLicense(meta) {
    const nonFree = /^(?:true|1|yes)$/i.test(gameMetaText(meta?.NonFree));
    const name = gameMetaText(meta?.LicenseShortName);
    const lower = name.toLowerCase();
    if (nonFree || lower.includes('fair use') || lower.includes('non-free')) return { license: '공정 이용 이미지', nonFree: true };
    if (!name) return { license: '라이선스 정보 없음', nonFree: false };
    if (lower.includes('public domain') || lower === 'pd' || lower.startsWith('pd-')) return { license: '퍼블릭 도메인', nonFree: false };
    return { license: `${name.slice(0, 40)} 라이선스`, nonFree: false };
}

/* ---------- 인터넷 요청 ---------- */
// 요청 하나: 15초 안에 답(read까지)이 없으면 실패로, 중지하면 AbortError로 끝낸다
async function gameFetch(url, signal, read) {
    if (signal?.aborted) throw gameStopError();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const stop = () => controller?.abort();
    signal?.addEventListener?.('abort', stop, { once: true });
    let late = false;
    const timer = setTimeout(() => {
        late = true;
        stop();
    }, GAME_FETCH_TIMEOUT_MS);
    let reached = false;
    try {
        const res = await fetch(url, { credentials: 'omit', ...(controller ? { signal: controller.signal } : {}) });
        reached = true;
        return await read(res);
    } catch (err) {
        if (signal?.aborted) throw gameStopError();
        if (late) throw new Error('인터넷 응답이 늦어 멈췄습니다');
        // 답을 읽지 못한 요청(브라우저는 위키미디어의 429 답을 CORS 때문에 읽지 못해 이렇게 끝난다)
        if (!reached) throw Object.assign(new Error(`인터넷에서 답을 받지 못했습니다: ${err?.message || err}`), { name: 'GameNetworkError' });
        throw err;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', stop);
    }
}

// 위키미디어가 바쁘다(429·503)고 하면 쉴 시간: 알려 준 시간(Retry-After, 8초까지) 또는 차례대로 정해 둔 시간
function gameRetryDelay(res, attempt) {
    const seconds = Number(res.headers?.get?.('retry-after'));
    return seconds > 0 ? Math.min(seconds * 1000, GAME_RETRY_MAX_MS) : GAME_RETRY_WAITS[attempt];
}

// ms만큼 쉰다(중지하면 AbortError)
async function gameWait(ms, signal) {
    if (typeof waitMs === 'function') await waitMs(ms, signal);
    else await new Promise(resolve => setTimeout(resolve, ms));
    if (signal?.aborted) throw gameStopError();
}

// 요청 하나를 보내고, 위키미디어가 바쁘다고 하거나(429·503) 답을 읽지 못하면(브라우저에서 본 429) 잠깐 쉬었다가 두 번까지 다시 보낸다.
// 쉬는 동안 중지하면 AbortError. 시한(15초)을 넘긴 요청은 다시 보내지 않는다. read(res)는 받은 답을 읽는다
async function gameFetchPolitely(url, signal, read) {
    for (let attempt = 0; ; attempt++) {
        const retry = attempt < GAME_RETRY_WAITS.length;
        let outcome;
        try {
            outcome = await gameFetch(url, signal, async res => (
                (res.status === 429 || res.status === 503) && retry ? { wait: gameRetryDelay(res, attempt) } : { value: await read(res) }
            ));
        } catch (err) {
            if (err?.name !== 'GameNetworkError' || !retry) throw err;
            outcome = { wait: GAME_RETRY_WAITS[attempt] };
        }
        if (!('wait' in outcome)) return outcome.value;
        await gameWait(outcome.wait, signal);
    }
}

// 위키백과 API 요청 차례: 앞 요청과 GAME_API_GAP_MS 넘게 떨어지게 자리를 잡고 그때까지 쉰다(한 번에 그 간격까지만 쉰다)
let gameApiNextAt = 0;
async function gameApiPace(signal) {
    const now = Date.now();
    const at = Math.min(Math.max(now, gameApiNextAt), now + GAME_API_GAP_MS);
    gameApiNextAt = at + GAME_API_GAP_MS;
    if (at > now) await gameWait(at - now, signal);
}

// 위키백과 API GET. 값은 모두 주소 글자로 바꿔 붙이고 답의 모양을 본다
async function gameApiGet(wiki, params, signal) {
    const host = gameWikiHost(wiki);
    if (!host) throw new Error('알 수 없는 위키백과입니다');
    const query = Object.entries({ ...params, format: 'json', origin: '*' }).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
    if (signal?.aborted) throw gameStopError();
    await gameApiPace(signal);
    return gameFetchPolitely(`https://${host}/w/api.php?${query}`, signal, async res => {
        if (!res.ok) throw new Error(`위키백과가 ${res.status}로 답했습니다`);
        const data = await res.json();
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new Error('위키백과 답을 읽지 못했습니다');
        return data;
    });
}

// 위키백과 답의 문서 목록(번호를 키로 한 객체나 배열). 모양이 다르면 빈 목록
function gameApiPages(data) {
    const pages = data?.query?.pages;
    const list = Array.isArray(pages) ? pages : (pages && typeof pages === 'object' ? Object.values(pages) : []);
    return list.filter(page => page && typeof page === 'object' && typeof page.title === 'string');
}

// 그림 주소에서 그림을 받아 data URL로. 주소·종류(png·jpeg·webp·gif)·크기(8MB)를 보고 아니면 null
async function gamePictureData(url, signal) {
    const safe = gamePictureUrl(url);
    if (!safe) return null;
    return gameFetchPolitely(safe, signal, async res => {
        if (!res.ok) return null;
        const type = String(res.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
        const size = Number(res.headers?.get?.('content-length') || 0);
        if (!GAME_PICTURE_TYPES.includes(type) || size > GAME_PICTURE_MAX_BYTES) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        const sniffed = bytes.length && bytes.length <= GAME_PICTURE_MAX_BYTES ? gamePictureType(bytes) : '';
        return sniffed ? `data:${sniffed};base64,${gameBase64(bytes)}` : null;
    });
}

/* ---------- 위키백과에서 찾기 ---------- */
const gameArticleUrl = (wiki, page) => gameSourceUrl(page?.fullurl) || gameSourceUrl(page?.canonicalurl)
    || (gameWikiHost(wiki) && page?.title ? `https://${gameWikiHost(wiki)}/wiki/${encodeURIComponent(String(page.title).replace(/ /g, '_'))}` : '');

// 그 위키백과에서 게임 문서 하나(제목이 맞고 설명이 게임인 문서). 없으면 null
// 검색어에는 제목 끝의 괄호 설명((video game) 등)을 떼고 넣는다. 그 설명은 같은 이름의 문서를 고를 때 쓴다
async function findGameArticle(wiki, title, signal) {
    const base = gameArticleParts(title).base || title;
    const search = wiki === 'ko' ? `${base} 게임` : `${base} video game`;
    const data = await gameApiGet(wiki, {
        action: 'query', generator: 'search', gsrsearch: search, gsrlimit: GAME_SEARCH_LIMIT,
        prop: 'pageimages|description|info', piprop: 'thumbnail|name', pithumbsize: GAME_THUMB_WIDTH, pilicense: 'any', inprop: 'url'
    }, signal);
    return pickGameArticle(gameApiPages(data), title);
}

// 그림 파일의 주소(너비 1000 썸네일 먼저)와 라이선스. 답이 없으면 null
async function gameFileInfo(wiki, file, signal) {
    const data = await gameApiGet(wiki, {
        action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: GAME_THUMB_WIDTH, iiextmetadatafilter: 'LicenseShortName|NonFree'
    }, signal);
    const info = gameApiPages(data).map(page => (Array.isArray(page.imageinfo) ? page.imageinfo[0] : null)).find(item => item && typeof item === 'object');
    if (!info) return null;
    return { urls: [info.thumburl, info.url].filter(url => typeof url === 'string'), ...gameLicense(info.extmetadata) };
}

// 문서의 그림 파일 하나: 라이선스를 읽고 그림을 받는다. hint: 검색 결과에 온 썸네일 주소. 받지 못하면 null
async function gameFilePicture(wiki, page, file, signal, hint = '') {
    const info = (await gameFileInfo(wiki, file, signal)) || { urls: [], license: '라이선스 정보 없음', nonFree: false };
    for (const url of [...info.urls, hint].filter(Boolean)) {
        const dataUrl = await gamePictureData(url, signal);
        if (dataUrl) {
            return {
                dataUrl, vendor: 'wikipedia', wiki, page: page.title, name: gameArticleParts(page.title).base, file: gameFileName(file),
                pageUrl: gameArticleUrl(wiki, page), license: info.license, nonFree: info.nonFree
            };
        }
    }
    return null;
}

// 다시 찾기 후보의 점수: 게임 화면·표지 낱말이 들면 2, 문서 제목 낱말이 모두 들면 1을 더한다
function gameCandidateScore(name, articleTitle) {
    const text = String(name ?? '');
    const dot = text.lastIndexOf('.');
    const words = gameTitleKey(dot > 0 ? text.slice(0, dot) : text).split(' ');
    const titleWords = gameTitleKey(gameArticleParts(articleTitle).base).split(' ').filter(word => word.length > 1);
    const visual = words.some(word => GAME_PICTURE_WORDS.includes(word)) ? 2 : 0;
    return visual + (titleWords.length > 0 && titleWords.every(word => words.includes(word)) ? 1 : 0);
}

// 문서에 든 그림 가운데 다시 찾기 후보(래스터 그림, 아이콘·로고·svg는 뺀다). 점수가 높은 것(게임 화면·표지) 먼저, 같으면 위키백과가 돌려준 차례
async function gameArticleCandidates(wiki, title, signal) {
    const data = await gameApiGet(wiki, { action: 'query', titles: title, prop: 'images', imlimit: 50 }, signal);
    const names = gameApiPages(data).flatMap(page => (Array.isArray(page.images) ? page.images : []))
        .map(image => (typeof image?.title === 'string' ? gameFileName(image.title) : '')).filter(gameRasterFile);
    return [...new Map(names.map(name => [gameFileKey(name), name])).values()]
        .map((name, index) => ({ name, index, score: gameCandidateScore(name, title) }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
}
const gameArticleFiles = async (wiki, title, signal) => (await gameArticleCandidates(wiki, title, signal)).map(item => item.name);

// 게임 문서의 그림: 대표 그림 → 문서의 다른 그림 차례. 대표 그림이 로고·아이콘·svg면 게임 화면·표지 후보(점수 2 이상)를 먼저 보고, 받지 못하면 대표 그림을 쓴다.
// after: 다시 찾기. 후보 목록에서 이 파일 다음부터 보고 끝에 닿으면 목록 처음으로 돌아간다(앞쪽 후보도 차례가 온다) / avoid: 이 파일은 건너뛴다
async function gameArticlePicture(wiki, page, { signal = null, after = '', avoid = '' } = {}) {
    const main = typeof page.pageimage === 'string' ? gameFileName(page.pageimage) : '';
    const hint = typeof page.thumbnail?.source === 'string' ? page.thumbnail.source : '';
    const skip = new Set([gameFileKey(avoid), gameFileKey(after)].filter(Boolean));
    const tryFile = async file => {
        skip.add(gameFileKey(file));
        return gameFilePicture(wiki, page, file, signal, gameFileKey(file) === gameFileKey(main) ? hint : '');
    };
    let listed = null;
    const candidates = async () => (listed ||= await gameArticleCandidates(wiki, page.title, signal));
    if (!after && main && !skip.has(gameFileKey(main))) {
        if (!gameRasterFile(main)) {
            const better = (await candidates()).filter(item => item.score >= 2 && !skip.has(gameFileKey(item.name))).slice(0, GAME_CANDIDATE_TRIES);
            for (const item of better) {
                const found = await tryFile(item.name);
                if (found) return found;
            }
        }
        const found = await tryFile(main);
        if (found) return found;
    }
    const names = [...new Map([gameRasterFile(main) ? main : '', ...(await candidates()).map(item => item.name)].filter(Boolean).map(name => [gameFileKey(name), name])).values()];
    const at = after ? names.findIndex(name => gameFileKey(name) === gameFileKey(after)) : -1;
    const order = at >= 0 ? [...names.slice(at + 1), ...names.slice(0, at)] : names;
    for (const file of order.filter(name => !skip.has(gameFileKey(name))).slice(0, GAME_CANDIDATE_TRIES)) {
        const found = await tryFile(file);
        if (found) return found;
    }
    return null;
}

// 위키백과에서 게임 그림 하나: 영어 위키백과 먼저, 한글 제목이면 한국어 위키백과도. avoid: 이 파일은 건너뛴다(다시 찾기)
// 인터넷이 끊기거나 늦으면 그 위키백과는 건너뛰고(null), 중지하면 AbortError
async function findGamePicture(title, { signal = null, avoid = '' } = {}) {
    const name = gameTagTitle(title);
    if (!name) return null;
    for (const wiki of /[가-힣]/.test(name) ? ['en', 'ko'] : ['en']) {
        try {
            const page = await findGameArticle(wiki, name, signal);
            const found = page ? await gameArticlePicture(wiki, page, { signal, avoid }) : null;
            if (found) return found;
        } catch (err) {
            if (err?.name === 'AbortError') throw err;
            console.warn(`[예시 게임 그림] ${gameWikiHost(wiki)}에서 찾지 못했습니다:`, err?.message || err);
        }
    }
    return null;
}

/* ---------- Google(검색 키가 있을 때만) ---------- */
const gameSearchKeysReady = () => typeof googleSearchCx !== 'undefined' && !!googleSearchCx
    && typeof googleSearchApiKeys !== 'undefined' && Array.isArray(googleSearchApiKeys) && googleSearchApiKeys.length > 0;

// 위키백과에서 못 찾았을 때 강사가 넣은 Google 검색 키로만 찾는다(지금 쓰는 고르기 판정을 그대로 거친다). 키가 없으면 부르지 않고 null
// 이 길의 그림은 지금 Google 검색처럼 api.js의 중계(fetchImageAsBase64)를 거쳐 받는다. 키를 다 써도 AI 그림으로 바꾸지 않으니 그 알림은 띄우지 않는다
async function findGamePictureByGoogle(title, { signal = null, context = '' } = {}) {
    if (!gameSearchKeysReady() || typeof searchImageAPI !== 'function') return null;
    const name = gameArticleParts(gameTagTitle(title)).base;
    const query = `${name} video game screenshot`;
    const result = await searchImageAPI(query, { quiet: true });
    if (signal?.aborted) throw gameStopError();
    if (typeof result?.b64 !== 'string' || !result.b64.startsWith('data:image/')) return null;
    const verdict = typeof validateImageWithVLM === 'function'
        ? await validateImageWithVLM(result.b64, { search_query: query, intent_type: 'screenshot' }, context || `${name} 게임 화면`, signal)
        : null;
    if (verdict && verdict.isValid === false) return null;
    const pageUrl = gameSourceUrl(result.page) || gameSourceUrl(result.source);
    return { dataUrl: result.b64, vendor: 'google', wiki: '', page: '', name, file: '', pageUrl, license: '이용 조건 확인 필요', nonFree: false };
}

/* ---------- 검색 그림 저장소(DBManager) ---------- */
const gameCacheKey = title => `${GAME_TAG_PREFIX} ${gameTitleKey(title)}`;

// 저장소의 기록을 쓸 수 있는 모양으로. 그림·출처 정보가 맞지 않으면 null
function gameCacheRecord(record) {
    const meta = record?.meta;
    if (!record || typeof record.base64 !== 'string' || !/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(record.base64) || !meta || typeof meta !== 'object') return null;
    const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
    const vendor = meta.vendor === 'google' || meta.vendor === 'wikipedia' ? meta.vendor : '';
    const name = text(meta.name, GAME_TITLE_MAX);
    if (!vendor || !name) return null;
    return {
        dataUrl: record.base64, vendor, wiki: gameWikiHost(meta.wiki) ? meta.wiki : '', page: text(meta.page, 300), name, file: text(meta.file, 300),
        pageUrl: gameSourceUrl(meta.pageUrl), license: text(meta.license, 60) || '라이선스 정보 없음', nonFree: meta.nonFree === true
    };
}

// 예시 게임 그림 찾기: 검색 그림 저장소 → 위키백과 → (검색 키가 있으면) Google. 찾으면 저장소에 남긴다. 중지하면 AbortError
async function findGamePictureCached(title, { signal = null, context = '' } = {}) {
    const key = gameCacheKey(title);
    const store = typeof DBManager !== 'undefined' ? DBManager : null;
    try {
        const cached = gameCacheRecord(await store?.getCache?.(key));
        if (cached) return cached;
    } catch (err) {
        console.warn('[예시 게임 그림] 저장소를 읽지 못해 인터넷에서 찾습니다:', err?.message || err);
    }
    const found = (await findGamePicture(title, { signal })) || (await findGamePictureByGoogle(title, { signal, context }));
    if (!found) return null;
    try {
        const meta = { vendor: found.vendor, wiki: found.wiki, page: found.page, name: found.name, file: found.file, pageUrl: found.pageUrl, license: found.license, nonFree: found.nonFree };
        await store?.setCache?.(key, found.dataUrl, found.pageUrl, GAME_CACHE_LABEL[found.vendor], meta);
    } catch (err) {
        console.warn('[예시 게임 그림] 저장소에 남기지 못했습니다:', err?.message || err);
    }
    return found;
}

/* ---------- 그림 칸 ---------- */
// 그림 설명: '게임 이름 · 출처: 위키백과 · 라이선스'(웹 검색이면 그 사이트). 이스케이프 전 글
function gameCaptionText(found) {
    const name = String(found?.name || '').slice(0, 60);
    if (found?.vendor === 'google') {
        const host = gameUrlHost(found.pageUrl);
        return `${name} · 출처: 웹 검색${host ? `(${host})` : ''} · 이용 조건 확인 필요`;
    }
    return `${name} · 출처: 위키백과 · ${found?.license || '라이선스 정보 없음'}`;
}

// 예시 게임 그림 칸: 보통 그림 칸(다시 찾기·삭제·판서 영상·움직이는 GIF·내보내기가 그대로 된다)에 출처 설명을 단다.
// 다시 찾기가 같은 문서의 다음 그림을 찾도록 문서·파일을, 내보내기가 글자로 적도록 출처 페이지 주소(http·https만)를 속성에 둔다
function gameImageWrapperHtml(imgId, keyword, found) {
    return imageWrapperHtml(imgId, keyword, escapeHtml(`${String(found.name || '').slice(0, 60)} 게임 그림`), escapeHtml(gameCaptionText(found)), {
        button: { 'data-game-wiki': gameWikiHost(found.wiki) ? found.wiki : '', 'data-game-page': String(found.page || '').slice(0, 300), 'data-game-file': String(found.file || '').slice(0, 300) },
        caption: { 'data-source-url': gameSourceUrl(found.pageUrl) }
    });
}

// processImageTags(api.js)의 예시 게임 태그 하나. 검색어 정하기·AI 그림을 부르지 않는다(Google 검색 키가 있을 때 그 그림의 고르기 판정만 든다)
// 찾으면 그림 칸, 못 찾으면 '다시 검색'이 있는 그림 자리와 못 찾았다는 글. 중지하면 AbortError
async function gameTagReplacement(tag, { signal = null, context = '', taken = new Set() } = {}) {
    const found = await findGamePictureCached(tag.game, { signal, context });
    if (!found) return { fullMatch: tag.fullMatch, html: imagePlaceholderHtml(escapeHtml(gameMissText(tag.game)), tag.keyword), game: true };
    const imgId = uniqueLessonImageId(taken);
    return { fullMatch: tag.fullMatch, html: `\n${gameImageWrapperHtml(imgId, tag.keyword, found)}\n`, imgId, image: found.dataUrl, game: true };
}

/* ---------- 다시 찾기 ---------- */
// 그림 칸의 다음 그림: 같은 문서의 다음 후보 → 다 봤으면 다시 검색(위키백과 → 검색 키가 있으면 Google). 저장소는 거치지 않는다
async function nextGamePicture(title, current, { signal = null } = {}) {
    if (current?.page && gameWikiHost(current.wiki)) {
        const next = await gameArticlePicture(current.wiki, { title: current.page }, { signal, after: current.file || '' });
        if (next) return next;
    }
    return (await findGamePicture(title, { signal, avoid: current?.file || '' })) || (await findGamePictureByGoogle(title, { signal }));
}

// 찾는 동안 그 칸 위에 띄우는 안내(글자로만 넣는다)
function gameSearchOverlay(holder) {
    const overlay = document.createElement('div');
    overlay.className = 'game-search-overlay prompt-overlay absolute inset-0 bg-black/70 flex items-center justify-center p-4 z-20 rounded-lg text-xs font-bold text-white';
    overlay.textContent = GAME_TEXT.searching;
    if (holder.classList?.contains('image-placeholder')) holder.style.position = 'relative';
    holder.appendChild(overlay);
    return overlay;
}

// 탭 글에서 그 그림 키의 그림 칸을 새 게임 그림 칸으로 바꿔 저장한다. 코드 블록 안은 보지 않는다. 그 칸을 찾지 못하면 false
async function replaceGamePicture(mod, tabId, imgId, keyword, found) {
    const target = `local:${imgId}`;
    let count = 0;
    const html = gameImageWrapperHtml(imgId, keyword, found);
    const next = mapPictureProse(storedTabMarkdown(mod, tabId), prose => prose.replace(IMAGE_WRAPPER_BLOCK, (whole, url) => {
        if (url !== target) return whole;
        count += 1;
        return html;
    }));
    if (!count) return false;
    mod.images = { ...(mod.images || {}), [imgId]: found.dataUrl };
    await window.writeLessonTab(mod, tabId, next); // 저장하지 못하면 saveState가 알린다
    return true;
}

// 예시 게임 그림 칸의 '다시 찾기'와 못 찾은 자리의 '다시 검색'(api.js promptRegenerateImage가 부른다). AI 그림 모델을 부르지 않는다.
// 그림 칸은 같은 문서의 다음 그림부터 보고 다 보면 다시 검색한다. 찾는 동안 다른 차시·탭으로 옮겨도 누른 차시에 넣는다(그 차시가 그대로 있을 때만)
window.regenerateGamePicture = async function (button, keyword, imgId) {
    const title = gameImageTitle(keyword);
    const wrapper = button?.closest?.('.image-wrapper') || null;
    const holder = wrapper || button?.closest?.('.image-placeholder') || null;
    const mod = getEditingModule();
    const tabId = typeof currentLessonTab !== 'undefined' ? currentLessonTab : 'basicLearn';
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!title || !holder || !mod || holder.querySelector?.('.prompt-overlay')) return;
    const slot = wrapper ? null : locateImagePlaceholder(storedTabMarkdown(mod, tabId), holder);
    if (wrapper ? !imgId : !slot) return window.showAlert(GAME_TEXT.slotMissing);
    const data = button.dataset || {};
    const current = wrapper ? { wiki: data.gameWiki || '', page: data.gamePage || '', file: data.gameFile || '' } : null;
    const overlay = gameSearchOverlay(holder);
    let found = null;
    try {
        found = wrapper ? await nextGamePicture(title, current) : await findGamePictureCached(title);
    } catch (err) {
        console.warn('[예시 게임 그림] 다시 찾지 못했습니다:', err?.message || err);
    } finally {
        overlay.remove();
    }
    if (found && wrapper && found.dataUrl === mod.images?.[imgId]) found = null; // 같은 그림이면 새로 찾지 못한 것이다
    if (!found) return window.showAlert(wrapper ? GAME_TEXT.noOther : `${gameMissText(title)}. 나중에 다시 해 보세요.`);
    if (!lessonStillLive(subj, mod)) return window.showAlert(GAME_TEXT.gone);
    const placed = wrapper
        ? await replaceGamePicture(mod, tabId, imgId, keyword, found)
        : await fillImagePlaceholder(mod, tabId, slot, found.dataUrl, keyword, '', id => gameImageWrapperHtml(id, keyword, found));
    if (!placed) window.showAlert(GAME_TEXT.slotMoved);
};

if (typeof window !== 'undefined') {
    Object.assign(window, {
        gameTitleKey, gameTagTitle, gameTitleScore, gamePageIsGame, pickGameArticle, gamePictureUrl, gameSourceUrl, gamePictureType, gameRasterFile, gameLicense,
        gamePictureData, findGamePicture, findGamePictureByGoogle, findGamePictureCached, gameCaptionText, gameImageWrapperHtml, gameTagReplacement, nextGamePicture
    });
}
