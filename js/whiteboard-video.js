// whiteboard-video.js - 교안 그림을 판서 영상으로 바꾼다
// 그림 위 '판서 영상으로 바꾸기' → 그 그림이 든 절의 내용으로 '판서 영상 만들기' 창 → 스튜디오에서 만든 영상을
// 'Teacher로 보내기' → 같은 주소의 IndexedDB(teacher-whiteboard-inbox)로 돌아온 영상을 그 그림 자리에 붙인다.
// 교안 글은 바꾸지 않는다. 차시의 whiteboardVideos[그림 id]에 영상을 적어 두고 보기 화면에서만 그림 대신 재생한다
// (그림은 영상 표지로 쓰고, PDF·슬라이드·MD 내보내기에는 원래 그림이 나간다). 이름은 스튜디오 src/lib/teacherInbox.ts와 맞춘다.

const WB_INBOX_DB = 'teacher-whiteboard-inbox';
const WB_INBOX_STORE = 'videos';
const WB_CHANNEL = 'teacher-whiteboard';
const WB_REQUESTS_KEY = 'teacher:whiteboard-requests';
const WB_REQUEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 같은 그림으로 다시 보내면 영상을 바꿔 준다
const WB_VIDEO_PREFIX = 'wbvideo:'; // 영상 파일을 둔 DBManager 이름의 앞말
const WB_VIDEO_KEY = id => `${WB_VIDEO_PREFIX}${id}`;
const WB_LABEL_MAX = 200;
const WB_PSEUDO_HEADING_LEVEL = 7; // '■ 제목' 같은 굵은 소제목 줄은 # 제목보다 아래 단계로 본다

/* ---------- 그림이 든 절 ---------- */
function whiteboardHeadingOf(line) {
    const hash = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (hash) return { level: hash[1].length, text: hash[2] };
    const mark = /^\s*(?:\*\*|__)?\s*([■□▶▷●◆◇★☆▣])\s*(.+?)\s*(?:\*\*|__)?\s*$/.exec(line);
    return mark ? { level: WB_PSEUDO_HEADING_LEVEL, text: mark[2] } : null;
}

// 제목의 꾸밈(**, `, 앞 번호, 기호)을 뗀다
function whiteboardHeadingText(text) {
    return String(text || '')
        .replace(/[*_`]/g, '')
        .replace(/^[\s■□▶▷●◆◇★☆▣#]+/, '')
        .replace(/^\d+(?:\.\d+)*[.)]?\s+/, '')
        .trim();
}

// 그림(local:그림 id)이 든 절: 가장 가까운 위 제목부터 같은 단계 이상의 다음 제목 앞까지. 제목이 없으면 탭 전체
function whiteboardSectionFor(md, imgId) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    const at = lines.findIndex(line => line.includes(`local:${imgId}`));
    let start = 0;
    let level = 0;
    let heading = '';
    for (let i = at; i >= 0; i--) {
        const found = whiteboardHeadingOf(lines[i]);
        if (found) { start = i; level = found.level; heading = whiteboardHeadingText(found.text); break; }
    }
    let end = lines.length;
    if (level) {
        for (let i = start + 1; i < lines.length; i++) {
            const found = whiteboardHeadingOf(lines[i]);
            if (found && found.level <= level) { end = i; break; }
        }
    }
    return { heading, found: at >= 0, markdown: whiteboardPlainMarkdown(lines.slice(start, end).join('\n')) };
}

/* ---------- 보낸 요청 (돌아올 영상이 붙을 그림) ---------- */
function readWhiteboardRequests(now = Date.now()) {
    try {
        const all = JSON.parse(localStorage.getItem(WB_REQUESTS_KEY) || '{}') || {};
        return Object.fromEntries(Object.entries(all).filter(([, req]) => req && now - req.createdAt <= WB_REQUEST_MAX_AGE_MS));
    } catch (e) {
        console.warn('[판서 영상] 요청 기록을 읽지 못했습니다:', e);
        return {};
    }
}

function writeWhiteboardRequests(requests) {
    try {
        localStorage.setItem(WB_REQUESTS_KEY, JSON.stringify(requests));
    } catch (e) {
        console.warn('[판서 영상] 요청 기록을 저장하지 못했습니다:', e);
    }
}

function newWhiteboardRequestId() {
    const random = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return `wb_${random.slice(0, 24)}`;
}

function findWhiteboardLesson(req) {
    const subject = globalState?.subjects?.find(item => item.id === req.subjectId);
    if (!subject) return null;
    if (req.lessonId === 'mainQuest') return subject.mainQuest || null;
    return (subject.lessons || []).find(lesson => String(lesson.id) === String(req.lessonId)) || null;
}

/* ---------- 그림 → 판서 영상 만들기 ---------- */
window.replaceImageWithWhiteboard = function (imgId) {
    const mod = getEditingModule();
    if (!mod || !imgId) return;
    if (typeof saveOpenEditsFor === 'function') saveOpenEditsFor(mod, currentLessonTab);
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    const tabMarkdown = mod.tabContents?.[currentLessonTab] || mod.content || '';
    const section = whiteboardSectionFor(tabMarkdown, imgId);
    const lessonTitle = stripLessonNumber(mod.title) || String(mod.title || '차시').trim();
    const place = section.heading || lessonTitle;
    const markdown = section.markdown || whiteboardLessonMarkdown(mod, subject);
    if (!markdown) return window.showAlert('이 그림 주변에 글이 없습니다. 판서 영상 만들기 창에 내용을 직접 써 주세요.');
    const requestId = newWhiteboardRequestId();
    const label = `${lessonTitle} › ${place}`.slice(0, WB_LABEL_MAX);
    const handoff = {
        v: 1,
        from: 'teacher',
        createdAt: Date.now(),
        topic: place.slice(0, WHITEBOARD_TOPIC_MAX),
        audience: WHITEBOARD_AUDIENCE,
        fileName: whiteboardFileName({ title: `${mod.title || ''} ${place}` }, subject),
        markdown,
        returnTo: { requestId, label }
    };
    const request = { subjectId: currentSubjectId, lessonId: mod.id, tabId: currentLessonTab, imgId, label, createdAt: Date.now() };
    confirmWhiteboardHandoff(handoff, `'${place}' 그림 자리를 판서 영상으로 바꿉니다. 이 절의 글을 넣어 두었으니 원하는 내용으로 고쳐 쓰세요.`, () => {
        writeWhiteboardRequests({ ...readWhiteboardRequests(), [requestId]: request });
    });
};

// whiteboardVideos가 가리키는 영상 id. 차시가 어디에 있든(교과의 차시·최종 평가, 휴지통의 차시·교과, 불러온 차시) 받은 값을 끝까지 훑는다(글은 보지 않는다)
function whiteboardVideoIdsIn(roots) {
    const ids = new Set();
    const seen = new Set();
    const stack = [...roots];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        const videos = node.whiteboardVideos;
        if (videos && typeof videos === 'object') {
            Object.values(videos).forEach(video => {
                if (video?.id != null && video.id !== '') ids.add(String(video.id));
            });
        }
        Object.values(node).forEach(value => {
            if (value && typeof value === 'object') stack.push(value);
        });
    }
    return ids;
}

// 이 창의 작업(교과·휴지통·지금 연 교과의 차시 목록)이 쓰는 영상 id
function whiteboardIdsInMemory() {
    return whiteboardVideoIdsIn([typeof globalState === 'undefined' ? null : globalState, typeof courseData === 'undefined' ? null : courseData]);
}

// 같은 영상 파일을 아직 쓰는 차시가 있는지. 휴지통의 '다시 만들기 전' 사본과 그 사본을 되살린 차시는 다시 만든 차시와
// 같은 파일을 가리키므로, 한쪽에서 되돌리거나 새 영상으로 바꿔도 다른 쪽 영상이 사라지지 않게 지우기 전에 본다
function whiteboardVideoInUse(videoId) {
    return whiteboardIdsInMemory().has(String(videoId));
}

// 그림 자리의 판서 영상 연결만 푼다(그림을 지울 때, api.js deleteImage). 영상 파일은 두고, 쓰는 곳이 없으면 저장된 작업을 열 때 정리한다.
// 푼 영상 { id, title, ext, at }. 연결이 없으면 null
function dropWhiteboardVideo(mod, imgId) {
    const video = mod?.whiteboardVideos?.[imgId];
    if (!video) return null;
    const rest = { ...mod.whiteboardVideos };
    delete rest[imgId];
    mod.whiteboardVideos = rest;
    return video;
}

// 그림 자리를 원래 그림으로 되돌리고 영상 파일을 지운다. 파일은 저장한 뒤에, 다른 차시가 같은 파일을 쓰지 않을 때만 지운다
// (저장하지 못하면 저장된 작업이 아직 그 영상을 가리킨다. 남은 파일은 저장된 작업을 열 때 정리한다)
window.revertWhiteboardVideo = async function (imgId) {
    const mod = getEditingModule();
    const video = dropWhiteboardVideo(mod, imgId);
    if (!video) return;
    try {
        const saved = await saveState();
        if (saved !== false && !whiteboardVideoInUse(video.id)) await DBManager.deleteItem(WB_VIDEO_KEY(video.id));
    } catch (e) {
        console.warn('[판서 영상] 되돌리기 저장 실패:', e);
    }
    window.applyWhiteboardVideos(mod);
    window.showToast?.('원래 그림으로 되돌렸습니다.', 'success');
};

if (typeof LESSON_ACTIONS !== 'undefined') {
    LESSON_ACTIONS['whiteboard-video'] = button => window.replaceImageWithWhiteboard(button.dataset.imgId);
    LESSON_ACTIONS['whiteboard-revert'] = button => window.revertWhiteboardVideo(button.dataset.imgId);
}

/* ---------- 스튜디오에서 돌아온 영상 받기 ---------- */
function openWhiteboardInbox() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(WB_INBOX_DB, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(WB_INBOX_STORE)) req.result.createObjectStore(WB_INBOX_STORE, { keyPath: 'requestId' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function whiteboardInboxCall(mode, run) {
    return openWhiteboardInbox().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(WB_INBOX_STORE, mode);
        const request = run(tx.objectStore(WB_INBOX_STORE));
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    }));
}

// 테스트에서 바꿔 끼울 수 있게 창 객체에 둔다
window.whiteboardInbox = {
    read: () => whiteboardInboxCall('readonly', store => store.getAll()),
    remove: requestId => whiteboardInboxCall('readwrite', store => store.delete(requestId))
};

let whiteboardCollecting = null;

// 돌아온 영상을 요청한 그림 자리에 붙인다. 차시를 못 찾으면(아직 불러오는 중 등) 받은편지함에 남겨 다음에 다시 본다
async function collectWhiteboardVideosOnce(now = Date.now()) {
    if (!globalState?.subjects?.length) return [];
    const records = await window.whiteboardInbox.read();
    const requests = readWhiteboardRequests(now);
    const placed = [];
    const replaced = [];
    for (const record of records || []) {
        const req = requests[record.requestId];
        const mod = req && findWhiteboardLesson(req);
        if (!mod) {
            if (!req && now - (record.createdAt || 0) > WB_REQUEST_MAX_AGE_MS) await window.whiteboardInbox.remove(record.requestId);
            continue;
        }
        const previous = mod.whiteboardVideos?.[req.imgId];
        await DBManager.setItem(WB_VIDEO_KEY(record.requestId), record.blob);
        mod.whiteboardVideos = {
            ...(mod.whiteboardVideos || {}),
            [req.imgId]: { id: record.requestId, title: record.title || req.label, ext: record.extension || 'mp4', at: now }
        };
        if (previous && previous.id !== record.requestId) replaced.push(previous.id);
        await window.whiteboardInbox.remove(record.requestId);
        placed.push({ mod, label: req.label });
    }
    if (!placed.length) return placed;
    const saved = await saveState();
    // 예전 영상 파일은 저장한 뒤에, 다른 차시(휴지통의 사본 등)가 쓰지 않을 때만 지운다(저장하지 못하면 저장된 작업이 아직 그 영상을 가리킨다)
    if (saved !== false) {
        for (const id of replaced) if (!whiteboardVideoInUse(id)) await DBManager.deleteItem(WB_VIDEO_KEY(id));
    }
    const showing = typeof getEditingModule === 'function' ? getEditingModule() : null;
    if (showing && placed.some(item => item.mod === showing)) window.applyWhiteboardVideos(showing);
    window.showToast?.(`${placed.map(item => `'${item.label}'`).join(', ')} 그림을 판서 영상으로 바꿨습니다.`, 'success');
    return placed;
}

window.collectWhiteboardVideos = function () {
    if (!whiteboardCollecting) {
        whiteboardCollecting = collectWhiteboardVideosOnce()
            .catch(e => { console.warn('[판서 영상] 돌아온 영상을 붙이지 못했습니다:', e); return []; })
            .finally(() => { whiteboardCollecting = null; });
    }
    return whiteboardCollecting;
};

/* ---------- 쓰는 곳이 없는 영상 파일 정리 (저장된 작업을 연 뒤 한 번, index.html) ---------- */
// 차시를 지우거나 휴지통을 비우거나 그림을 지우거나 백업으로 작업을 바꾸면 영상 파일(wbvideo:…)만 남는다. 쓰는 곳이 없는 파일은 처음 본 시각을 적어 두고
// 휴지통 보관 기간(30일, course-meta.js)이 지나도록 계속 쓰는 곳이 없을 때 지운다. 지우기 직전에 다른 탭이 저장한 저장본과
// 따로 옮겨 둔 읽지 못한 저장본 사본까지 다시 본다. 무엇이든 읽지 못하거나 표시를 저장하지 못하면 지우지 않는다
const WB_ORPHANS_KEY = 'teacher:whiteboard-orphans'; // { 영상 id: 쓰는 곳이 없다고 처음 본 시각(ms) }
const WB_VIDEO_ID_RE = /^wb_[A-Za-z0-9]{1,64}$/; // 이 앱이 만든 영상 id(newWhiteboardRequestId)만 정리한다
const WB_SCAN_BYTES = 4 * 1024 * 1024; // 저장본 파일을 한 번에 읽는 바이트
let whiteboardSweeping = null;

const isWhiteboardBlob = value => typeof Blob !== 'undefined' && value instanceof Blob;

// 표시를 읽지 못하면 처음부터 센다(지우는 날이 늦어질 뿐이다)
function readWhiteboardOrphans() {
    try {
        const marks = JSON.parse(localStorage.getItem(WB_ORPHANS_KEY) || '{}');
        return marks && typeof marks === 'object' && !Array.isArray(marks) ? marks : {};
    } catch (e) {
        console.warn('[판서 영상] 정리 표시를 읽지 못해 처음부터 셉니다:', e);
        return {};
    }
}

// 저장하지 못하면 던진다(그러면 이번에는 지우지 않는다)
function writeWhiteboardOrphans(marks) {
    if (Object.keys(marks).length) localStorage.setItem(WB_ORPHANS_KEY, JSON.stringify(marks));
    else localStorage.removeItem(WB_ORPHANS_KEY);
}

// 저장본 파일(Blob)에 ids가 글자 그대로 들어 있는지 조각으로 읽어 본다(큰 저장본을 글 하나로 만들지 않는다).
// id는 ASCII뿐이라 바이트 자리로 잘라도 되고, 조각 사이에 걸친 id도 찾게 앞 조각 끝을 id 길이만큼 겹쳐 읽는다
async function whiteboardBlobMentions(blob, ids, found, chunkBytes = WB_SCAN_BYTES) {
    const overlap = Math.max(0, ...ids.map(id => id.length - 1));
    for (let at = 0; at < blob.size; at += chunkBytes) {
        const left = ids.filter(id => !found.has(id));
        if (!left.length) return;
        const text = await blob.slice(Math.max(0, at - overlap), Math.min(blob.size, at + chunkBytes)).text();
        left.forEach(id => { if (text.includes(id)) found.add(id); });
    }
}

// 값(글·객체·저장본 파일) 어디에든 ids가 글자 그대로 들어 있으면 그 id를 found에 넣는다. 모양은 보지 않는다(읽지 못한 저장본 사본도 훑는다)
async function whiteboardMentions(value, ids, found) {
    const seen = new Set();
    const stack = [value];
    while (stack.length) {
        const left = ids.filter(id => !found.has(id));
        if (!left.length) break;
        const node = stack.pop();
        if (typeof node === 'string') {
            left.forEach(id => { if (node.includes(id)) found.add(id); });
        } else if (isWhiteboardBlob(node)) {
            await whiteboardBlobMentions(node, left, found);
        } else if (node && typeof node === 'object' && !seen.has(node)) {
            seen.add(node);
            Object.entries(node).forEach(([key, item]) => stack.push(key, item));
        }
    }
    return found;
}

// 다른 탭이 저장한 저장본과 따로 옮겨 둔 사본(<STORAGE_KEY>:…, 남은 예전 localStorage 저장본)이 쓰는 영상 id.
// 저장본은 시작할 때와 같이 풀어 모양을 본다(없거나 모양이 틀리면 null: 지우지 않는다). 사본은 모양과 상관없이 id 글자를 찾는다. 읽지 못하면 던진다
async function storedWhiteboardMentions(keys, ids) {
    const record = await DBManager.getItem(STORAGE_KEY);
    const legacy = localStorage.getItem(STORAGE_KEY);
    let data = null;
    if (record != null) data = typeof storedRecordData === 'function' ? await storedRecordData(record) : (isWhiteboardBlob(record) ? null : record);
    else if (legacy != null) data = JSON.parse(legacy);
    if (!data || typeof data !== 'object' || !data.state || typeof data.state !== 'object' || Array.isArray(data.state)) return null;
    const found = await whiteboardMentions(data, ids, new Set());
    if (legacy != null) await whiteboardMentions(legacy, ids, found);
    for (const key of keys) {
        if (typeof key === 'string' && key.startsWith(`${STORAGE_KEY}:`)) await whiteboardMentions(await DBManager.getItem(key), ids, found);
    }
    return found;
}

// 한 번 정리한다. { removed: 지운 영상 id, waiting: 기다리는 영상 수 } 또는 { removed: [], skipped: 까닭 }
async function sweepWhiteboardVideosOnce(now = Date.now()) {
    if (typeof isStateLoadFailed === 'function' && isStateLoadFailed()) return { removed: [], skipped: 'unread' };
    if (typeof readFolderSaveStamp === 'function' && readFolderSaveStamp()?.browserBehind) return { removed: [], skipped: 'folder' }; // PC 폴더가 브라우저보다 앞섰다
    const keys = await DBManager.keys();
    const stored = keys
        .filter(key => typeof key === 'string' && key.startsWith(WB_VIDEO_PREFIX))
        .map(key => key.slice(WB_VIDEO_PREFIX.length))
        .filter(id => WB_VIDEO_ID_RE.test(id));
    // 쓰는 곳이 없는 영상만 표시한다. 다시 쓰이거나 파일이 없어진 영상의 표시는 지운다
    const used = whiteboardIdsInMemory();
    const before = readWhiteboardOrphans();
    const marks = Object.fromEntries(stored.filter(id => !used.has(id)).map(id => [id, Number.isFinite(before[id]) && before[id] <= now ? before[id] : now]));
    writeWhiteboardOrphans(marks);
    const due = Object.keys(marks).filter(id => now - marks[id] >= LESSON_TRASH_DAYS * DAY_MS);
    if (!due.length) return { removed: [], waiting: Object.keys(marks).length };
    const found = await storedWhiteboardMentions(keys, due);
    if (!found) return { removed: [], skipped: 'stored' };
    const removed = [];
    for (const id of due) {
        if (found.has(id) || whiteboardIdsInMemory().has(id)) continue; // 그사이 이 창에서 다시 쓰게 된 영상도 남긴다
        await DBManager.deleteItem(WB_VIDEO_KEY(id));
        removed.push(id);
    }
    // 지운 영상의 표시는 빼고, 저장본이나 이 창이 아직 쓰는 영상은 오늘부터 다시 센다
    const rest = Object.fromEntries(Object.entries(marks).filter(([id]) => !removed.includes(id)).map(([id, at]) => [id, due.includes(id) ? now : at]));
    try {
        writeWhiteboardOrphans(rest);
    } catch (e) {
        console.warn('[판서 영상] 정리 표시를 저장하지 못했습니다:', e);
    }
    return { removed, waiting: Object.keys(rest).length };
}

// 저장된 작업을 연 뒤 한 번 부른다(index.html, restoreState가 'ok'일 때). 다시 불러도 같은 결과를 돌려준다
window.sweepWhiteboardVideos = function () {
    if (!whiteboardSweeping) {
        whiteboardSweeping = sweepWhiteboardVideosOnce().catch(e => {
            console.warn('[판서 영상] 쓰는 곳이 없는 영상 파일 정리를 멈췄습니다:', e);
            return { removed: [], skipped: 'error' };
        });
    }
    return whiteboardSweeping;
};

/* ---------- 보기 화면: 그림에 버튼을 달고, 바꾼 그림은 영상으로 재생 ---------- */
const WB_BUTTON = 'absolute left-1/2 -translate-x-1/2 z-10 whitespace-nowrap inline-flex items-center gap-1 px-2.5 py-1 text-[0.6875rem] font-bold rounded-full shadow transition-opacity';
let whiteboardObjectUrls = [];

function whiteboardImageIds(mod) {
    return new Map(Object.entries(mod.images || {}).map(([id, src]) => [src, id]));
}

function whiteboardButton(action, imgId, html, tone) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.lessonAction = action;
    button.dataset.imgId = imgId;
    button.className = `${WB_BUTTON} ${tone}`;
    button.innerHTML = html;
    return button;
}

async function mountWhiteboardVideo(img, holder, imgId, video) {
    const blob = await DBManager.getItem(WB_VIDEO_KEY(video.id)).catch(() => null);
    if (!img.isConnected) return;
    if (!(blob instanceof Blob)) {
        holder.appendChild(whiteboardButton('whiteboard-video', imgId, '<i class="ph-bold ph-warning"></i> 판서 영상 파일이 이 브라우저에 없습니다 · 다시 만들기', 'bottom-3 bg-amber-100 text-amber-800'));
        return;
    }
    const url = URL.createObjectURL(blob);
    whiteboardObjectUrls.push(url);
    const player = document.createElement('video');
    player.src = url;
    player.poster = img.getAttribute('src') || '';
    player.controls = true;
    player.playsInline = true;
    player.preload = 'metadata';
    player.className = 'w-full rounded-lg bg-black';
    player.dataset.wbVideo = video.id;
    player.setAttribute('aria-label', `판서 영상: ${video.title || ''}`);
    img.style.display = 'none'; // .markdown-body img { display: block }이 hidden 클래스보다 앞선다
    img.dataset.wbPoster = 'true';
    img.after(player);
    // 영상 아래쪽은 재생 막대라 버튼을 위에 둔다
    holder.appendChild(whiteboardButton('whiteboard-revert', imgId, '<i class="ph-bold ph-image"></i> 원래 그림으로',
        'top-3 bg-white/90 text-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100'));
}

window.applyWhiteboardVideos = function (mod) {
    const view = document.getElementById('render-view');
    if (!view || !mod) return;
    whiteboardObjectUrls.forEach(url => URL.revokeObjectURL(url));
    whiteboardObjectUrls = [];
    view.querySelectorAll('[data-lesson-action^="whiteboard-"], video[data-wb-video]').forEach(el => el.remove());
    const ids = whiteboardImageIds(mod);
    view.querySelectorAll('img').forEach(img => {
        if (img.dataset.wbPoster) {
            img.style.removeProperty('display');
            delete img.dataset.wbPoster;
        }
        // 그림 틀의 키는 저장된 버튼(다시 찾기)에서 읽는다. 화면에 단 삭제 버튼(api.js addImageDeleteButtons)은 그림 주소를 들 수 있어 보지 않는다
        const wrapper = img.closest('.image-wrapper');
        const own = wrapper && [...wrapper.querySelectorAll('[data-img-id]')].find(el => el.dataset.lessonAction !== 'delete-image')?.dataset.imgId;
        const imgId = own || ids.get(img.getAttribute('src'));
        if (!imgId || !/^data:image\//.test(String(mod.images?.[imgId] || ''))) return; // 찾지 못한 그림(teacher-image 참조)·빈 값에는 버튼을 달지 않는다
        const holder = img.closest('.image-wrapper, [data-imgid]') || img.parentElement;
        holder.classList.add('relative', 'group');
        const video = mod.whiteboardVideos?.[imgId];
        if (video) mountWhiteboardVideo(img, holder, imgId, video);
        else holder.appendChild(whiteboardButton('whiteboard-video', imgId, '<i class="ph-bold ph-chalkboard-teacher"></i> 판서 영상으로 바꾸기',
            'bottom-3 bg-indigo-600 text-white opacity-0 group-hover:opacity-100 focus:opacity-100'));
    });
};

// HTML 내보내기: 영상은 파일 안에 넣고(따로 파일이 필요 없음) 영상 뒤에 숨긴 원래 그림과 판서 영상 버튼은 뺀다
window.whiteboardHtmlForExport = async function (view) {
    const copy = view.cloneNode(true);
    copy.querySelectorAll('[data-lesson-action^="whiteboard-"]').forEach(el => el.remove());
    let videos = 0;
    for (const player of copy.querySelectorAll('video[data-wb-video]')) {
        const poster = player.previousElementSibling?.matches?.('img[data-wb-poster]') ? player.previousElementSibling : null;
        const blob = await DBManager.getItem(WB_VIDEO_KEY(player.dataset.wbVideo)).catch(() => null);
        if (!(blob instanceof Blob)) { // 영상이 없으면 원래 그림을 내보낸다
            player.remove();
            poster?.style.removeProperty('display');
            poster?.removeAttribute('data-wb-poster');
            continue;
        }
        player.src = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
        player.setAttribute('style', 'width:100%;border-radius:8px;');
        poster?.remove();
        videos++;
    }
    return { html: copy.innerHTML, videos };
};

/* ---------- 영상이 돌아오는 때: 스튜디오 알림, 이 탭으로 돌아옴, 처음 열림 ---------- */
if (typeof BroadcastChannel !== 'undefined') {
    try {
        new BroadcastChannel(WB_CHANNEL).onmessage = event => {
            if (event.data?.type === 'video-ready') window.collectWhiteboardVideos();
        };
    } catch (e) {
        console.warn('[판서 영상] 알림 채널을 열지 못했습니다:', e);
    }
}
if (typeof window.addEventListener === 'function') {
    window.addEventListener('focus', () => window.collectWhiteboardVideos());
    window.addEventListener('load', () => setTimeout(() => window.collectWhiteboardVideos(), 1500));
}
