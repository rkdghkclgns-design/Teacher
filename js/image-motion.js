// image-motion.js - 교안 그림을 관계가 보이게 '움직이는 GIF'로 바꾼다(보기 화면 그림의 '움직이는 GIF로')
// AI가 그림 속 요소와 연결을 한 번 읽고(image-motion-plan.js), 이 브라우저가 그림 위에 오가는 점·빛나는 테두리를 그려 GIF로 만든다(gif-encoder.js).
// 그림 자체는 다시 그리지 않는다. 바꾸면 원래 그림은 새 그림 키(원래 그림 키)로 간직하고, 그 자리(mod.images[그림 키])에 GIF를 넣고
// mod.imageMotions[그림 키]에 { still: 원래 그림 키, at, sig, patterns, summary }만 적는다(GIF는 적지 않는다). 교안 글은 바꾸지 않는다.
// '원래 그림으로'는 간직한 그림을 되돌린다. 그사이 그 자리 그림이 바뀌었으면(다시 찾기·삽화 다시 그리기·작업 기록 되돌리기 등) 지금 그림은 두고 기록만 정리한다
// 같은 창을 '새 그림으로 넣는 창'으로도 연다(openImageMotionInsert, 본문을 끌어 고른 글로 GIF 만들기 selection-media.js): 부른 쪽이 그림을 그리면 바로 관계를 읽고,
// 넣기(본문에 넣기·그림만 넣기)는 부른 쪽이 한다. 이 창은 차시·탭을 떠났는지만 본다(바꿀 그림 자리가 없다)

const MOTION_FRAMES = 30;
const MOTION_SPEEDS = [{ delay: 14, label: '느리게' }, { delay: 10, label: '보통' }, { delay: 7, label: '빠르게' }];
const MOTION_DEFAULT_DELAY = 10;
const MOTION_WIDTHS = [800, 640, 480]; // 4MB를 넘으면 차례로 줄여 다시 만든다
const MOTION_GIF_MAX_BYTES = 4 * 1024 * 1024;
const MOTION_SEND_SIDE = 1600; // AI에 보내는 그림의 긴 변
const MOTION_PICTURE_RE = /^data:image\//;
const MOTION_GIF_RE = /^data:image\/gif;base64,[A-Za-z0-9+/=]+$/;
const MOTION_SEND_TYPES = /^data:image\/(?:png|jpeg|webp|gif);base64,/; // 줄이지 않아도 되면 그대로 보내는 형식(Gemini·Claude가 모두 받는다)
const MOTION_TEXT = {
    lead: '그림 속 요소가 어떻게 이어져 있는지 AI가 읽고, 그 관계가 보이게 움직이는 GIF를 이 브라우저에서 만듭니다. 차시 글은 바뀌지 않습니다.',
    cost: '관계를 읽는 데 AI 호출 1번을 씁니다. 움직임·빠르기를 바꿔 다시 만드는 것은 AI를 부르지 않습니다.',
    placeholder: '어떻게 움직이면 좋을지 적어 주세요(선택) — 예: 서버가 요청을 받고 응답하는 흐름',
    noKey: 'AI 키가 없어 그림을 읽을 수 없습니다. 오른쪽 위 ⚙ 설정에서 키를 넣은 뒤 다시 눌러 주세요.',
    reading: '그림 속 연결을 읽고 있습니다…',
    noRelation: '그림에서 이어진 요소를 찾지 못했습니다. 아래 칸에 무엇이 무엇과 이어져 있는지 적고 다시 읽어 주세요.',
    readFailed: '그림 속 연결을 읽지 못했습니다.',
    drawFailed: 'GIF를 만들지 못했습니다.',
    moved: '다른 차시나 탭으로 옮겼거나 그 그림이 바뀌어 GIF로 바꾸지 않았습니다. 그림에서 다시 눌러 주세요.',
    applied: '움직이는 GIF로 바꿨습니다. 차시 글은 그대로입니다.',
    reverted: '원래 그림으로 되돌렸습니다.',
    staleReverted: '그림이 그사이 바뀌어 지금 그림은 그대로 두고, 움직이는 GIF 기록만 정리했습니다.',
    stillMissing: '간직해 둔 원래 그림을 이 작업에서 찾지 못해 되돌리지 않았습니다.',
    notPicture: '이 그림은 GIF로 바꿀 수 없습니다(찾지 못한 그림 자리이거나 그림 값이 없습니다).',
    inlineOnly: '이 그림은 교안 글에 그림 값이 바로 들어 있어 GIF로 바꿔도 화면이 바뀌지 않습니다.',
    hasVideo: '판서 영상으로 바꾼 그림입니다. 원래 그림으로 되돌린 뒤 다시 눌러 주세요.',
    alreadyMoving: "이미 움직이는 GIF입니다. '원래 그림으로'로 되돌린 뒤 다시 만들어 주세요.",
    // 새 그림으로 넣는 창(고른 글로 GIF 만들기)
    insertLead: '고른 글에 맞는 그림을 AI가 그린 뒤, 그림 속 요소가 어떻게 이어져 있는지 읽어 그 관계가 보이게 움직이는 GIF를 이 브라우저에서 만듭니다. 넣으면 고른 글이 든 단락 바로 아래에 새 그림으로 들어갑니다.',
    insertCost: '그림 그리기와 첫 관계 읽기는 시작할 때 보인 대로 씁니다. 다시 읽기는 AI 호출 1번을 더 씁니다. 움직임·빠르기를 바꿔 다시 만드는 것은 AI를 부르지 않습니다.',
    drawing: '고른 글에 맞는 그림을 그리고 있습니다… 한 장에 수십 초가 걸릴 수 있습니다.',
    pictureFailed: '그림을 그리지 못했습니다. 설정의 이미지 생성 모델과 키를 확인한 뒤 본문에서 다시 골라 눌러 주세요.',
    insertMoved: '다른 차시나 탭으로 옮겨 본문에 넣지 않았습니다. 그 탭에서 글을 다시 골라 눌러 주세요.',
    insertFailed: '본문에 넣지 못했습니다.'
};
const motionDrawing = (done, total) => `움직이는 GIF를 만들고 있습니다… (${done}/${total})`;
const motionRedrawing = (width, done, total) => `4MB를 넘어 가로 ${width}px로 다시 만들고 있습니다… (${done}/${total})`;

let _motionSession = null; // 열린 'GIF 만들기' 창(하나만 연다)

/* ---------- 기록 ---------- */
const motionHas = (map, key) => !!map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, key);

// 그 그림 자리의 움직이는 GIF 기록(없거나 모양이 틀리면 null)
function imageMotionRecord(mod, imgId) {
    const record = motionHas(mod?.imageMotions, imgId) ? mod.imageMotions[imgId] : null;
    return record && typeof record === 'object' && !Array.isArray(record) ? record : null;
}

// 'none'(기록 없음) | 'valid'(그 자리가 이 기능이 만든 GIF 그대로) | 'stale'(그 자리 그림이 그사이 다른 그림으로 바뀜)
// | 'unknown'(그 자리 값이 그림이 아님: 따로 담은 백업의 찾지 못한 그림 자리 등. 손대지 않는다)
function imageMotionState(mod, imgId) {
    const record = imageMotionRecord(mod, imgId);
    if (!record) return 'none';
    const value = mod.images?.[imgId];
    if (typeof value !== 'string' || !MOTION_PICTURE_RE.test(value)) return 'unknown';
    return typeof record.sig === 'string' && record.sig === imageMotionSignature(value) ? 'valid' : 'stale';
}

// 차시에서 그림 키를 가리킬 수 있는 글(tabs.js lessonImageRefTexts)
function motionTexts(mod) {
    if (typeof lessonImageRefTexts === 'function') return lessonImageRefTexts(mod);
    return [mod?.content, ...Object.values(mod?.tabContents || {})].filter(text => typeof text === 'string');
}

// 원래 그림을 둘 새 키: 앱의 그림 키 모양(img_시각+수, data-safety.js SAFE_IMAGE_KEY를 지난다). 차시 그림에 없고 글이 가리키지도 않는 키
function freshMotionStillKey(mod, now = Date.now()) {
    const texts = motionTexts(mod);
    let n = Math.floor(Math.random() * 1000);
    for (let tries = 0; tries < 1000; tries++, n++) {
        const key = `img_${Math.floor(now)}${n}`;
        if (!motionHas(mod.images, key) && !texts.some(text => text.includes(`local:${key}`))) return key;
    }
    throw new Error('원래 그림을 둘 키를 만들지 못했습니다.');
}

// 그림 작업(생성·그림 찾기·AI 호출)이 도는 동안에는 낡은 기록을 정리하지 않는다(api.js pictureJobRunning, settleImageMotions)
const motionPictureBusy = () => typeof pictureJobRunning === 'function' && !!pictureJobRunning();

// 원래 그림 키를 아무 데서도 쓰지 않으면(글·삽화·판서 영상·다른 GIF 기록, api.js lessonStillUsesImage) 차시 그림에서 지운다. 지웠으면 true.
// 그림 작업이 도는 동안에도 지운다: 원래 그림 키는 글에 들어가지 않는 키라(freshMotionStillKey) 작업이 쥔 글(고정 섹션 등)도 가리키지 않는다.
// 기록을 뺀 뒤 사본이 남으면 같은 값의 그림 키를 가로챈다(판서 영상·GIF 버튼이 사본 키를 잡는다, whiteboard-video.js whiteboardImageIds)
function releaseMotionStill(mod, key) {
    if (!key || !motionHas(mod?.images, key)) return false;
    if (typeof lessonStillUsesImage !== 'function' || lessonStillUsesImage(mod, key)) return false; // 가릴 수 없으면 남긴다
    const rest = { ...mod.images };
    delete rest[key];
    mod.images = rest;
    return true;
}

// 그 그림 자리의 기록만 뺀다(그림을 지울 때 api.js deleteImage도 쓴다). 뺀 기록, 없으면 null
function dropImageMotion(mod, imgId) {
    const record = imageMotionRecord(mod, imgId);
    if (!record && !motionHas(mod?.imageMotions, imgId)) return null;
    const rest = { ...mod.imageMotions };
    delete rest[imgId];
    mod.imageMotions = rest;
    return record;
}

// 그 자리 그림(source 그대로일 때만)을 GIF로 바꾼다. 차시만 바꾸고 저장·화면은 부른 쪽이 한다. 원래 그림 키를 돌려준다.
// 그 자리에 낡은 기록이 있으면 새 기록으로 바꾸고 그 원래 그림은 아무 데서도 쓰지 않을 때만 지운다
function applyImageMotionData(mod, imgId, source, gif, meta = {}, now = Date.now()) {
    if (!mod || typeof source !== 'string' || !MOTION_PICTURE_RE.test(source) || mod.images?.[imgId] !== source) throw new Error(MOTION_TEXT.moved);
    if (imageMotionState(mod, imgId) === 'valid') throw new Error(MOTION_TEXT.alreadyMoving);
    if (typeof gif !== 'string' || !MOTION_GIF_RE.test(gif)) throw new Error(MOTION_TEXT.drawFailed);
    const old = imageMotionRecord(mod, imgId);
    const still = freshMotionStillKey(mod, now);
    const patterns = (Array.isArray(meta.patterns) ? meta.patterns : []).filter(pattern => MOTION_PATTERNS.includes(pattern)).slice(0, MOTION_LIMITS.groups);
    mod.images = { ...mod.images, [still]: source, [imgId]: gif };
    mod.imageMotions = {
        ...(mod.imageMotions && typeof mod.imageMotions === 'object' && !Array.isArray(mod.imageMotions) ? mod.imageMotions : {}),
        [imgId]: { still, at: now, sig: imageMotionSignature(gif), patterns, summary: motionText(meta.summary, 120) }
    };
    if (old?.still && old.still !== still) releaseMotionStill(mod, old.still);
    return still;
}

// GIF를 켜 둔 동안 만든 교수안·편성안(기본학습·심화학습, data.js LESSON_TRACKS)은 차시 그림을 사본(images)으로 옮겨 두어 그 GIF를 들고 있다.
// 되돌릴 때 그 사본도 원래 그림으로 바꾼다(교수안의 사본이 차시 그림보다 이긴다, gyosuan.js gyosuanImageMap). 사본이 다른 그림이면 그대로 둔다
function restoreMotionCopies(mod, imgId, gif, still) {
    const tracks = typeof LESSON_TRACKS !== 'undefined' ? LESSON_TRACKS : [];
    tracks.forEach(track => {
        const plan = mod[track.field];
        if (!plan || typeof plan !== 'object' || !motionHas(plan.images, imgId) || plan.images[imgId] !== gif) return;
        mod[track.field] = { ...plan, images: { ...plan.images, [imgId]: still } };
    });
}

// '원래 그림으로'(차시만 바꾼다). 'restored': 간직한 그림을 그 자리에 되돌림, 'stale': 그 자리 그림이 바뀌어 지금 그림은 두고 기록만 정리,
// 'missing': 간직한 그림이나 GIF 값을 찾지 못해 그대로 둠, 'none': 기록 없음
function undoImageMotion(mod, imgId) {
    const state = imageMotionState(mod, imgId);
    if (state === 'none') return 'none';
    if (state === 'unknown') return 'missing';
    const record = imageMotionRecord(mod, imgId);
    if (state === 'valid') {
        const still = mod.images?.[record.still];
        if (typeof still !== 'string' || !MOTION_PICTURE_RE.test(still)) return 'missing';
        restoreMotionCopies(mod, imgId, mod.images[imgId], still);
        mod.images = { ...mod.images, [imgId]: still };
    }
    dropImageMotion(mod, imgId);
    releaseMotionStill(mod, record.still);
    return state === 'valid' ? 'restored' : 'stale';
}

// 그 자리 그림이 그사이 바뀌었거나(낡은 기록) 그 그림 키가 차시에서 빠진(삽화 창에서 삽화를 지움 등) 기록을 정리한다(지금 그림은 건드리지 않는다).
// 간직한 원래 그림도 아무 데서도 쓰지 않으면 지운다. 찾지 못한 그림 자리(그림 키는 있다)는 두고 기다린다.
// 그림 작업이 도는 동안에는 두고, 바꾼 것은 다음 저장에 함께 들어간다. 정리한 수
function settleImageMotions(mod) {
    if (!mod?.imageMotions || typeof mod.imageMotions !== 'object' || motionPictureBusy()) return 0;
    let settled = 0;
    Object.keys(mod.imageMotions).forEach(imgId => {
        if (imageMotionState(mod, imgId) !== 'stale' && motionHas(mod.images, imgId)) return;
        releaseMotionStill(mod, dropImageMotion(mod, imgId)?.still);
        settled += 1;
    });
    return settled;
}

/* ---------- 보기 화면의 버튼 ---------- */
// 판서 영상 버튼(아래 가운데) 바로 위에 둔다. 다시 찾기(오른쪽 위)·삭제(왼쪽 위)와 겹치지 않는다. 마우스를 올리거나 그림 안 버튼에 포커스가 오면 보인다
const MOTION_BUTTON = 'absolute left-1/2 -translate-x-1/2 bottom-12 z-10 whitespace-nowrap inline-flex items-center gap-1 px-2.5 py-1 text-[0.6875rem] leading-4 font-bold rounded-full shadow transition-opacity opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100';

function motionButton(action, imgId, html, tone, title) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-lesson-action', action);
    button.setAttribute('data-img-id', imgId);
    button.className = `${MOTION_BUTTON} ${tone}`;
    button.title = title;
    button.innerHTML = html;
    return button;
}

// 글이 그 그림을 그림 키(local:키)로 가리키는지. 그림 값(data URL)을 글에 바로 쓴 그림은 GIF로 바꿔도 화면이 바뀌지 않는다(글은 바꾸지 않는다).
// local:img_1 뒤에 키 글자가 더 이어지면(local:img_10) 다른 그림이다
function motionShownByKey(mod, imgId) {
    const ref = `local:${imgId}`;
    return motionTexts(mod).some(text => {
        for (let at = text.indexOf(ref); at !== -1; at = text.indexOf(ref, at + 1)) if (!/[\w-]/.test(text.charAt(at + ref.length))) return true;
        return false;
    });
}

// 다른 기록이 간직한 원래 그림 키인지(화면에 그려지지 않는 사본)
const isMotionStill = (mod, key) => Object.values(mod.imageMotions && typeof mod.imageMotions === 'object' ? mod.imageMotions : {}).some(item => item?.still === key);

// 판서 영상 버튼을 단 그림(진짜 그림이고 판서 영상을 보이지 않는 그림) 가운데 글이 그림 키로 가리키는 그림에 '움직이는 GIF로',
// 이 기능이 만든 GIF에는 '원래 그림으로'를 단다. 판서 영상 버튼을 다시 달 때마다 부른다(whiteboard-video.js applyWhiteboardVideos)
window.applyImageMotions = function (mod) {
    const view = typeof document !== 'undefined' ? document.getElementById('render-view') : null;
    if (!view || !mod) return;
    view.querySelectorAll('[data-lesson-action^="image-motion"]').forEach(el => el.remove());
    settleImageMotions(mod);
    view.querySelectorAll('[data-lesson-action="whiteboard-video"]').forEach(anchor => {
        const imgId = anchor.getAttribute('data-img-id');
        const holder = anchor.parentElement;
        if (!imgId || !holder || motionHas(mod.whiteboardVideos, imgId) || !MOTION_PICTURE_RE.test(String(mod.images?.[imgId] || ''))) return;
        if (isMotionStill(mod, imgId) || !motionShownByKey(mod, imgId)) return;
        holder.appendChild(imageMotionState(mod, imgId) === 'valid'
            ? motionButton('image-motion-revert', imgId, '<i class="ph-bold ph-image" aria-hidden="true"></i> 원래 그림으로', 'bg-white/90 text-gray-700', '움직이는 GIF로 바꾸기 전 그림으로 되돌립니다')
            : motionButton('image-motion', imgId, '<i class="ph-bold ph-gif" aria-hidden="true"></i> 움직이는 GIF로', 'bg-emerald-600 text-white', '그림 속 연결을 AI가 읽어 관계가 보이게 움직이는 GIF로 바꿉니다(AI 호출 1번)'));
    });
};

// 그 차시의 그 탭을 아직 보고 있으면 다시 그린다(그림이 바뀌었으니 버튼·삭제 버튼의 그림 주소도 새로)
function refreshMotionView(mod, tabId) {
    const viewing = typeof isViewingTab === 'function' ? isViewingTab(mod, tabId) : getEditingModule() === mod;
    if (getEditingModule() === mod && viewing && typeof renderEditor === 'function') renderEditor(mod);
}

window.revertImageMotion = async function (imgId) {
    const mod = getEditingModule();
    if (!mod || !imgId) return;
    const tabId = currentLessonTab;
    const outcome = undoImageMotion(mod, imgId);
    if (outcome === 'none') return refreshMotionView(mod, tabId);
    if (outcome === 'missing') return window.showToast?.(MOTION_TEXT.stillMissing, 'warning');
    const saved = await saveState();
    refreshMotionView(mod, tabId);
    if (saved !== false) window.showToast?.(outcome === 'restored' ? MOTION_TEXT.reverted : MOTION_TEXT.staleReverted, outcome === 'restored' ? 'success' : 'warning');
};

if (typeof LESSON_ACTIONS !== 'undefined') {
    LESSON_ACTIONS['image-motion'] = button => window.openImageMotion(button.dataset.imgId);
    LESSON_ACTIONS['image-motion-revert'] = button => window.revertImageMotion(button.dataset.imgId);
}

/* ---------- 그리기 (브라우저 캔버스) ---------- */
function motionAbortError() {
    const err = new Error('중지했습니다.');
    err.name = 'AbortError';
    return err;
}

const motionPause = () => new Promise(resolve => setTimeout(resolve, 0));

function loadMotionImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('그림을 읽지 못했습니다.'));
        image.src = src;
    });
}

function motionCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

// AI에 보낼 그림(inlineData). 긴 변이 1600을 넘거나 AI가 받지 않는 형식이면 흰 바탕에 줄여 JPEG로 보낸다
async function motionInlineImage(source) {
    const image = await loadMotionImage(source);
    const scale = Math.min(1, MOTION_SEND_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    if (!(scale > 0)) throw new Error('그림 크기를 읽지 못했습니다.');
    if (scale === 1 && MOTION_SEND_TYPES.test(source)) return dataUrlToInline(source);
    const canvas = motionCanvas(Math.max(1, Math.round(image.naturalWidth * scale)), Math.max(1, Math.round(image.naturalHeight * scale)));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return dataUrlToInline(canvas.toDataURL('image/jpeg', 0.9));
}

function motionRoundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function motionDot(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
}

// 한 장면의 덧그림: 지나가는 연결선은 옅게, 도착한 요소는 둥근 테두리로 빛나고, 점은 흰 테두리와 그림자에 짧은 꼬리를 단다(글자를 덮지 않게 상자 안은 칠하지 않는다)
function drawMotionOverlay(ctx, scene, colors, width) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    scene.lines.forEach(line => {
        ctx.globalAlpha = 0.34 * line.fade;
        ctx.strokeStyle = colors[line.tone];
        ctx.lineWidth = Math.max(3, width / 110);
        ctx.beginPath();
        ctx.moveTo(line.x1, line.y1);
        ctx.lineTo(line.x2, line.y2);
        ctx.stroke();
    });
    scene.rings.forEach(ring => {
        ctx.globalAlpha = ring.alpha;
        ctx.strokeStyle = colors[ring.tone];
        ctx.lineWidth = Math.max(2, width / 260);
        motionRoundRect(ctx, ring.x, ring.y, ring.w, ring.h, Math.min(14, ring.w / 4, ring.h / 4));
        ctx.stroke();
    });
    scene.packets.forEach(packet => {
        ctx.fillStyle = colors[packet.tone];
        packet.trail.forEach(ghost => {
            ctx.globalAlpha = ghost.alpha;
            motionDot(ctx, ghost.x, ghost.y, ghost.r);
            ctx.fill();
        });
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.halo;
        motionDot(ctx, packet.x, packet.y, packet.r + Math.max(2, packet.r * 0.45));
        ctx.fill();
        ctx.fillStyle = colors[packet.tone];
        motionDot(ctx, packet.x, packet.y, packet.r);
        ctx.fill();
        ctx.strokeStyle = colors.outline;
        ctx.lineWidth = Math.max(1.5, packet.r * 0.32);
        ctx.stroke();
    });
    ctx.restore();
}

// 가로 maxWidth로 30장면을 그려 GIF로. 바탕은 흰색 위의 원래 그림(그림 자체는 다시 그리지 않는다)
async function encodeMotionAt(image, plan, timeline, maxWidth, { delay, onFrame, cancelled }) {
    const { width, height } = motionFrameSize(image.naturalWidth, image.naturalHeight, maxWidth);
    const base = motionCanvas(width, height);
    const baseCtx = base.getContext('2d');
    baseCtx.fillStyle = '#ffffff';
    baseCtx.fillRect(0, 0, width, height);
    baseCtx.imageSmoothingQuality = 'high';
    baseCtx.drawImage(image, 0, 0, width, height);
    const colors = motionColors(motionLuminance(baseCtx.getImageData(0, 0, width, height).data));
    const ctx = motionCanvas(width, height).getContext('2d', { willReadFrequently: true });
    const radius = Math.max(5, width / 120);
    const frameAt = index => {
        if (cancelled()) throw motionAbortError();
        ctx.globalAlpha = 1;
        ctx.drawImage(base, 0, 0);
        drawMotionOverlay(ctx, motionScene(plan, timeline, index / MOTION_FRAMES, width, height, radius), colors, width);
        return ctx.getImageData(0, 0, width, height).data;
    };
    const encoded = await gifEncodeAnimation({
        width, height, frameCount: MOTION_FRAMES, frameAt, delay, fixedColors: motionFixedColors(colors),
        onFrame: async (done, total) => {
            onFrame?.(done, total);
            await motionPause(); // 창이 멈추지 않게 장면마다 숨을 돌린다
        }
    });
    return { dataUrl: `data:image/gif;base64,${gifBase64(encoded.bytes)}`, bytes: encoded.bytes.length, frames: encoded.frames, width, height };
}

// GIF를 만든다. 4MB를 넘으면 가로 640, 480으로 줄여 다시 만든다(그래도 넘으면 그대로 두고 over로 알린다).
// onFrame(그린 장면 수, 모든 장면 수, { attempt, width }): attempt는 줄여 다시 만드는 차례(처음 만들 때 0), width는 그 차례의 가로
async function buildMotionGif(source, plan, { patterns = [], delay = MOTION_DEFAULT_DELAY, onFrame = null, cancelled = () => false } = {}) {
    const image = await loadMotionImage(source);
    const timeline = planMotionTimeline(plan, patterns);
    const first = Math.min(MOTION_WIDTHS[0], image.naturalWidth);
    const widths = [first, ...MOTION_WIDTHS.slice(1).filter(width => width < first)];
    let result = null;
    for (const [attempt, width] of widths.entries()) {
        const report = typeof onFrame === 'function' ? (done, total) => onFrame(done, total, { attempt, width }) : null;
        result = { ...(await encodeMotionAt(image, plan, timeline, width, { delay, onFrame: report, cancelled })), reduced: attempt > 0 };
        if (result.bytes <= MOTION_GIF_MAX_BYTES) break;
    }
    return { ...result, over: result.bytes > MOTION_GIF_MAX_BYTES };
}

// 테스트에서 바꿔 끼울 수 있게 창 객체에 둔다(node에는 캔버스가 없다)
window.imageMotionCanvas = { inline: motionInlineImage, render: buildMotionGif };

/* ---------- 'GIF 만들기' 창 ---------- */
const motionSize = bytes => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);
const MOTION_FIELD = 'bg-black/30 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-accent disabled:opacity-50';
const MOTION_SECONDARY = 'px-4 py-2 text-xs font-bold text-textLight bg-white/5 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-40';

// 창 칸은 화면 높이의 90%까지 커지고 넘치면 창 안이 스크롤된다. 버튼 줄은 창 칸 아래 끝에 붙여(sticky) 1366x768 노트북처럼 낮은 화면에서도
// 미리 보기를 만든 뒤 바꾸기·다시 읽기·취소가 바로 보이게 한다(창 칸 여백 p-6만큼 -bottom-6·-mx-6·-mb-6로 끝까지 펴고, 같은 바탕색으로 지나가는 내용을 가린다).
// scroll-pb-20은 포커스 받은 칸을 굴려 보일 때 그 버튼 줄 높이만큼 띄운다(openMotionDialog).
// 새 그림으로 넣는 창은 그림을 그리기 전까지 미리 보기 칸을 감추고, '그림만 넣기'와 '본문에 넣기'를 둔다
function motionDialogHtml(session = {}) {
    const insert = !!session.insert;
    const still = insert ? `<button type="button" data-motion-still class="hidden ${MOTION_SECONDARY}">그림만 넣기</button>` : '';
    return `
        <div data-app-dialog-panel class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[560px] max-w-[94vw] max-h-[90vh] overflow-y-auto scroll-pb-20 p-6 shadow-2xl flex flex-col gap-3" onclick="event.stopPropagation()">
            <h3 data-app-dialog-title class="font-bold text-white text-sm flex items-center gap-2"><i class="ph-bold ph-gif text-emerald-400" aria-hidden="true"></i> 움직이는 GIF 만들기</h3>
            <p data-app-dialog-text class="text-xs text-textMuted leading-relaxed">${escapeHtml(insert ? MOTION_TEXT.insertLead : MOTION_TEXT.lead)}</p>
            <div data-motion-frame class="${insert ? 'hidden ' : ''}rounded-lg bg-black/30 border border-white/10 p-2 flex justify-center"><img data-motion-preview alt="${insert ? '고른 글로 그린 그림' : '바꿀 그림'}" class="max-h-[260px] max-w-full w-auto rounded"></div>
            <p data-motion-info class="hidden text-[0.6875rem] text-textMuted"></p>
            <div data-motion-controls class="hidden flex flex-col gap-2"></div>
            <label class="block text-[0.6875rem] text-textMuted">움직임 요청(선택)
                <textarea data-motion-instruction rows="2" maxlength="${MOTION_LIMITS.instruction}" placeholder="${escapeHtml(MOTION_TEXT.placeholder)}" class="mt-1 w-full p-2 resize-none ${MOTION_FIELD}"></textarea>
            </label>
            <p class="text-[0.6875rem] text-textMuted"><i class="ph-bold ph-info" aria-hidden="true"></i> ${escapeHtml(insert ? MOTION_TEXT.insertCost : MOTION_TEXT.cost)}</p>
            <p data-motion-status role="status" aria-live="polite" class="text-xs min-h-[1rem] whitespace-pre-wrap"></p>
            <div class="sticky -bottom-6 -mx-6 -mb-6 -mt-3 px-6 pt-3 pb-6 bg-[#1a1a2e] flex flex-wrap justify-end gap-2">
                <button type="button" data-motion-cancel class="${MOTION_SECONDARY}">취소</button>
                <button type="button" data-motion-reread class="hidden ${MOTION_SECONDARY}">다시 읽기</button>
                ${still}
                <button type="button" data-motion-start class="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors disabled:opacity-40">관계 읽고 GIF 만들기</button>
                <button type="button" data-motion-apply class="hidden px-4 py-2 text-xs font-bold text-white bg-accent hover:bg-accentHover rounded-lg transition-colors disabled:opacity-40">${insert ? '본문에 넣기' : '이 GIF로 바꾸기'}</button>
            </div>
        </div>`;
}

// 묶음마다 움직임 고르기와 빠르기. 묶음 이름·설명은 AI가 준 글이라 escapeHtml로 넣는다
function motionControlsHtml(session) {
    const select = `px-2 py-1 ${MOTION_FIELD}`;
    const rows = session.plan.groups.map((group, index) => {
        const options = ['auto', ...MOTION_PATTERNS].map(value => {
            const label = value === 'auto' ? `${MOTION_PATTERN_LABELS.auto}(${MOTION_PATTERN_LABELS[group.pattern]})` : MOTION_PATTERN_LABELS[value];
            return `<option value="${value}"${session.patterns[index] === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        }).join('');
        return `<label class="flex items-center gap-2 text-xs text-textLight"><span class="flex-1 min-w-0 truncate" title="${escapeHtml(group.story)}">${escapeHtml(group.name)}</span><select data-motion-pattern="${index}" class="${select}">${options}</select></label>`;
    }).join('');
    const speeds = MOTION_SPEEDS.map(speed => `<option value="${speed.delay}"${speed.delay === session.delay ? ' selected' : ''}>${speed.label}</option>`).join('');
    return `${rows}<label class="flex items-center gap-2 text-xs text-textLight"><span class="flex-1">빠르기</span><select data-motion-speed class="${select}">${speeds}</select></label>`;
}

function motionPart(session, name) {
    return session.overlay.querySelector(`[data-motion-${name}]`);
}

function motionStatus(session, text, tone = 'info') {
    const box = motionPart(session, 'status');
    if (!box) return;
    box.textContent = text || '';
    box.className = `text-xs min-h-[1rem] whitespace-pre-wrap ${tone === 'warn' ? 'text-amber-200' : tone === 'busy' ? 'text-emerald-300' : 'text-textMuted'}`;
}

// 단계에 맞춰 버튼·고르기 칸을 보이고 막는다. 새 그림으로 넣는 창은 그림을 그린 뒤에야 읽기·그림만 넣기를 보인다
function syncMotionButtons(session) {
    const show = (name, visible) => motionPart(session, name)?.classList.toggle('hidden', !visible);
    const live = !session.gone;
    const drawn = !!session.source;
    show('start', live && drawn && !session.plan);
    show('reread', live && !!session.plan);
    show('apply', live && !!session.gif);
    show('still', live && drawn);
    ['start', 'reread', 'apply', 'still'].forEach(name => {
        const button = motionPart(session, name);
        if (button) button.disabled = session.busy;
    });
    const instruction = motionPart(session, 'instruction');
    if (instruction) instruction.disabled = session.busy || session.gone;
    session.overlay.querySelectorAll('select').forEach(select => { select.disabled = session.busy || session.gone; });
}

// 기다리는 동안 다른 차시·탭으로 옮겼거나, 그 그림이 바뀌었거나, 판서 영상·GIF가 됐는지. 새 그림으로 넣는 창은 바꿀 그림 자리가 없어 차시·탭만 본다
function motionMoved(session) {
    const { mod, imgId, tabId, source } = session;
    if (getEditingModule() !== mod) return true;
    if (typeof isViewingTab === 'function' && !isViewingTab(mod, tabId)) return true;
    if (session.insert) return false;
    return mod.images?.[imgId] !== source || motionHas(mod.whiteboardVideos, imgId) || imageMotionState(mod, imgId) === 'valid';
}

function motionGone(session) {
    session.gone = true;
    session.busy = false;
    motionStatus(session, session.insert ? MOTION_TEXT.insertMoved : MOTION_TEXT.moved, 'warn');
    syncMotionButtons(session);
}

function closeMotionDialog(session) {
    if (session.closed) return;
    session.closed = true;
    session.controller?.abort();
    session.dialog?.close();
    if (_motionSession === session) _motionSession = null;
}

// AI가 그림 속 연결을 읽는다(AI 호출 1번). 쓸 수 있는 계획이나 null(찾지 못함)
async function requestMotionPlan(session) {
    const instruction = String(motionPart(session, 'instruction')?.value || '').trim();
    const inlineData = await window.imageMotionCanvas.inline(session.source);
    if (session.closed) throw motionAbortError();
    if (motionMoved(session)) return undefined;
    const data = await callGemini(TEXT_MODEL, {
        taskRole: 'plan',
        contents: [{ role: 'user', parts: [{ text: buildMotionPrompt(instruction) }, { inlineData }] }],
        systemInstruction: { parts: [{ text: MOTION_SYSTEM }] },
        generationConfig: { responseMimeType: 'application/json' },
        ...(session.controller ? { signal: session.controller.signal } : {})
    });
    return sanitizeMotionPlan(safeJSONParse(extractText(data)));
}

// '관계 읽고 GIF 만들기'·'다시 읽기'. 찾지 못하거나 실패하면 창을 열어 둔 채 알리고(요청을 적어 다시 읽을 수 있게) 앞서 만든 GIF는 그대로 둔다
async function readImageMotion(session) {
    if (session.busy || session.closed || session.gone) return;
    if (typeof textModelHasKey === 'function' && !textModelHasKey()) return motionStatus(session, MOTION_TEXT.noKey, 'warn');
    if (motionMoved(session)) return motionGone(session);
    session.busy = true;
    session.controller = typeof AbortController === 'function' ? new AbortController() : null;
    syncMotionButtons(session);
    motionStatus(session, MOTION_TEXT.reading, 'busy');
    let plan;
    try {
        plan = await requestMotionPlan(session);
    } catch (err) {
        if (session.closed || err?.name === 'AbortError') return;
        console.warn('[움직이는 GIF] 그림을 읽지 못했습니다:', err);
        session.busy = false;
        motionStatus(session, `${MOTION_TEXT.readFailed} ${err?.message || ''}`.trim(), 'warn');
        return syncMotionButtons(session);
    }
    if (session.closed) return;
    if (plan === undefined || motionMoved(session)) return motionGone(session);
    session.busy = false;
    if (!plan) {
        motionStatus(session, MOTION_TEXT.noRelation, 'warn');
        return syncMotionButtons(session);
    }
    session.plan = plan;
    session.gif = null; // 앞서 만든 GIF는 앞 계획의 것이라 새 GIF가 나올 때까지 바꾸지 않는다
    session.patterns = plan.groups.map(() => 'auto');
    motionPart(session, 'controls').innerHTML = motionControlsHtml(session);
    motionPart(session, 'controls').classList.remove('hidden');
    await renderImageMotion(session);
}

// 크기 알림. 줄여 다시 만들지 않은 GIF(원래 그림이 작아 더 줄일 크기가 없음)에는 '줄여도'라고 하지 않는다
function motionResultNote(gif) {
    if (gif.over && gif.reduced) return `가로 ${gif.width}px로 줄여도 ${motionSize(gif.bytes)}입니다(4MB 넘음). 바꾸면 저장 공간을 많이 씁니다.`;
    if (gif.over) return `가로 ${gif.width}px GIF가 ${motionSize(gif.bytes)}입니다(4MB 넘음). 바꾸면 저장 공간을 많이 씁니다.`;
    if (gif.reduced) return `4MB를 넘어 가로 ${gif.width}px로 줄여 만들었습니다(${motionSize(gif.bytes)}).`;
    return '';
}

// 계획·움직임·빠르기로 GIF를 만들어 창에 보인다(AI를 부르지 않는다). 그사이 다시 고르면 마지막 것만 보인다
async function renderImageMotion(session) {
    if (!session.plan || session.closed || session.gone) return;
    const seq = ++session.seq;
    const current = () => !session.closed && seq === session.seq;
    session.busy = true;
    syncMotionButtons(session);
    motionStatus(session, motionDrawing(0, MOTION_FRAMES), 'busy');
    try {
        const gif = await window.imageMotionCanvas.render(session.source, session.plan, {
            patterns: session.patterns,
            delay: session.delay,
            // 4MB를 넘어 줄여 다시 만들면 장면 수가 처음부터 다시 세어지므로 그 까닭을 함께 보인다
            onFrame: (done, total, step) => {
                if (current()) motionStatus(session, step?.attempt > 0 ? motionRedrawing(step.width, done, total) : motionDrawing(done, total), 'busy');
            },
            cancelled: () => !current()
        });
        if (!current()) return;
        if (motionMoved(session)) return motionGone(session);
        session.gif = gif;
        motionPart(session, 'preview').setAttribute('src', gif.dataUrl);
        motionPart(session, 'preview').setAttribute('alt', '만든 움직이는 GIF 미리 보기');
        const info = motionPart(session, 'info');
        info.textContent = `GIF ${motionSize(gif.bytes)} · 장면 ${gif.frames}개 · 가로 ${gif.width}px`;
        info.classList.remove('hidden');
        motionStatus(session, motionResultNote(gif), gif.over ? 'warn' : 'info');
    } catch (err) {
        if (!current() || err?.name === 'AbortError') return;
        console.warn('[움직이는 GIF] 만들지 못했습니다:', err);
        motionStatus(session, `${MOTION_TEXT.drawFailed} ${err?.message || ''}`.trim(), 'warn');
    } finally {
        if (seq === session.seq) {
            session.busy = false;
            if (!session.closed) syncMotionButtons(session);
        }
    }
}

function onMotionChange(session, event) {
    const target = event.target;
    if (!session.plan || session.busy || !target?.matches) return;
    if (target.matches('[data-motion-pattern]')) {
        const index = Number(target.getAttribute('data-motion-pattern'));
        const value = MOTION_PATTERNS.includes(target.value) ? target.value : 'auto';
        session.patterns = session.patterns.map((pattern, i) => (i === index ? value : pattern));
    } else if (target.matches('[data-motion-speed]')) {
        const delay = Number(target.value);
        session.delay = MOTION_SPEEDS.some(speed => speed.delay === delay) ? delay : MOTION_DEFAULT_DELAY;
    } else {
        return;
    }
    renderImageMotion(session);
}

// '이 GIF로 바꾸기': 그 차시·탭·그림이 그대로일 때만 바꾸고 저장한 뒤 다시 그린다. 새 그림으로 넣는 창의 '본문에 넣기'는 부른 쪽이 넣는다
async function applyImageMotion(session) {
    if (session.busy || session.closed || session.gone || !session.gif) return;
    if (motionMoved(session)) return motionGone(session);
    const { mod, imgId, tabId, plan } = session;
    const patterns = plan.groups.map((group, index) => motionPatternOf(group, session.patterns[index]));
    const summary = plan.groups.map((group, index) => `${group.name}: ${MOTION_PATTERN_LABELS[patterns[index]]}`).join(' · ');
    if (session.insert) return insertMotionResult(session, () => session.insert.onApply({ still: session.source, gif: session.gif.dataUrl, meta: { patterns, summary } }));
    try {
        applyImageMotionData(mod, imgId, session.source, session.gif.dataUrl, { patterns, summary });
    } catch (err) {
        return motionStatus(session, err.message, 'warn');
    }
    closeMotionDialog(session);
    const saved = await saveState();
    refreshMotionView(mod, tabId);
    if (saved !== false) window.showToast?.(MOTION_TEXT.applied, 'success');
}

// 새 그림으로 넣는 창의 '본문에 넣기'·'그림만 넣기'. 넣고 저장하고 다시 그리는 일은 run(부른 쪽)이 한다.
// 넣었으면(true) 창을 닫고, 못 넣었으면 창을 열어 둔 채 다시 누르거나 취소할 수 있게 한다(그린 그림을 잃지 않게)
async function insertMotionResult(session, run) {
    if (session.busy || session.closed || session.gone || !session.source) return;
    if (motionMoved(session)) return motionGone(session);
    session.busy = true;
    syncMotionButtons(session);
    let placed = false;
    try {
        placed = (await run()) === true;
    } catch (err) {
        console.warn('[움직이는 GIF] 본문에 넣지 못했습니다:', err);
        motionStatus(session, `${MOTION_TEXT.insertFailed} ${err?.message || ''}`.trim(), 'warn');
    }
    session.busy = false;
    if (placed) return closeMotionDialog(session);
    if (!session.closed) syncMotionButtons(session);
}

function showMotionPreview(session) {
    motionPart(session, 'preview')?.setAttribute('src', session.source);
    motionPart(session, 'frame')?.classList.remove('hidden');
}

// 새 그림으로 넣는 창: 부른 쪽(draw)이 그림을 그리면 그 그림으로 바로 관계를 읽는다(그리기와 첫 읽기는 부른 쪽이 비용을 미리 물었다).
// 그리지 못하면 창을 열어 둔 채 알린다. 취소(창 닫기)하면 그리던 호출도 끊는다
async function drawInsertPicture(session) {
    session.busy = true;
    session.controller = typeof AbortController === 'function' ? new AbortController() : null;
    syncMotionButtons(session);
    motionStatus(session, MOTION_TEXT.drawing, 'busy');
    let source = null;
    try {
        source = await session.insert.draw(session.controller?.signal || null);
    } catch (err) {
        if (session.closed || err?.name === 'AbortError') return;
        console.warn('[움직이는 GIF] 그림을 그리지 못했습니다:', err);
    }
    if (session.closed) return;
    session.busy = false;
    if (motionMoved(session)) return motionGone(session);
    if (typeof source !== 'string' || !MOTION_PICTURE_RE.test(source)) {
        motionStatus(session, MOTION_TEXT.pictureFailed, 'warn');
        return syncMotionButtons(session);
    }
    session.source = source;
    showMotionPreview(session);
    await readImageMotion(session);
}

function openMotionDialog(session) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9100] animate-fade-in';
    overlay.innerHTML = motionDialogHtml(session);
    document.body.appendChild(overlay);
    session.overlay = overlay;
    if (session.source) motionPart(session, 'preview').setAttribute('src', session.source);
    if (session.insert) motionPart(session, 'instruction').value = session.instruction || ''; // 고른 글을 움직임 요청으로 넣어 둔다(고쳐 다시 읽을 수 있다)
    // 읽거나 만드는 중이거나 만든 GIF가 있으면 바깥을 눌러도 닫지 않는다(Esc·취소로 닫는다). 새 그림으로 넣는 창은 그린 그림을 잃지 않게 늘 그렇다
    session.dialog = openAppDialog(overlay, {
        onDismiss: reason => {
            if (reason === 'outside' && (session.busy || session.gif || session.insert)) return;
            closeMotionDialog(session);
        },
        focus: session.insert ? null : motionPart(session, 'instruction') // 새 그림으로 넣는 창은 그리는 동안 요청 칸을 막아 창에 포커스를 둔다
    });
    // 창의 Tab 처리는 포커스만 옮기고 굴리지 않는다(ui.js keepAppDialogFocus). 낮은 화면에서 옮겨 간 칸이 아래에 붙은 버튼 줄에 가리지 않게 창 칸을 굴린다
    const buttonRow = motionPart(session, 'apply').parentElement;
    overlay.addEventListener('focusin', event => {
        if (!buttonRow.contains(event.target)) event.target.scrollIntoView?.({ block: 'nearest' });
    });
    const guard = run => () => {
        if (!session.dialog.tooSoon()) run();
    };
    motionPart(session, 'cancel').onclick = guard(() => closeMotionDialog(session));
    motionPart(session, 'start').onclick = guard(() => readImageMotion(session));
    motionPart(session, 'reread').onclick = guard(() => readImageMotion(session));
    motionPart(session, 'apply').onclick = guard(() => applyImageMotion(session));
    const still = motionPart(session, 'still');
    if (still) still.onclick = guard(() => insertMotionResult(session, () => session.insert.onStill({ still: session.source })));
    overlay.addEventListener('change', event => onMotionChange(session, event));
    syncMotionButtons(session);
}

// 보기 화면의 '움직이는 GIF로'
window.openImageMotion = function (imgId) {
    const mod = getEditingModule();
    if (!mod || !imgId) return;
    if (_motionSession) {
        if (_motionSession.overlay?.isConnected) return; // 이미 열린 창이 있다
        closeMotionDialog(_motionSession); // 다른 코드가 창을 치웠다
    }
    const source = mod.images?.[imgId];
    if (typeof source !== 'string' || !MOTION_PICTURE_RE.test(source) || isMotionStill(mod, imgId)) return window.showToast?.(MOTION_TEXT.notPicture, 'warning');
    if (!motionShownByKey(mod, imgId)) return window.showToast?.(MOTION_TEXT.inlineOnly, 'warning');
    if (motionHas(mod.whiteboardVideos, imgId)) return window.showToast?.(MOTION_TEXT.hasVideo, 'warning');
    if (imageMotionState(mod, imgId) === 'valid') return window.showToast?.(MOTION_TEXT.alreadyMoving, 'warning');
    if (typeof saveOpenEditsFor === 'function') saveOpenEditsFor(mod, currentLessonTab);
    const session = { mod, imgId, source, tabId: currentLessonTab, plan: null, patterns: [], delay: MOTION_DEFAULT_DELAY, gif: null, busy: false, gone: false, closed: false, seq: 0, controller: null };
    _motionSession = session;
    openMotionDialog(session);
    return session;
};

// 본문을 끌어 고른 글로 GIF 만들기(selection-media.js): 그림을 그려(draw) 움직이는 GIF로 만든 뒤 본문에 새 그림으로 넣는 창.
// opts: { mod, tabId, instruction(움직임 요청 칸에 넣을 고른 글), draw(signal) → 그림 data URL(못 그리면 null),
//         onApply({ still, gif, meta }) · onStill({ still }) → 넣었으면 true }. 차시는 넣을 때 부른 쪽이 바꾼다. 이미 열린 창이 있으면 null
window.openImageMotionInsert = function ({ mod, tabId, instruction = '', draw, onApply, onStill } = {}) {
    if (!mod || !tabId || typeof draw !== 'function' || typeof onApply !== 'function' || typeof onStill !== 'function') return null;
    if (_motionSession) {
        if (_motionSession.overlay?.isConnected) return null;
        closeMotionDialog(_motionSession); // 다른 코드가 창을 치웠다
    }
    const session = {
        mod, imgId: '', source: '', tabId, insert: { draw, onApply, onStill }, instruction: String(instruction || '').slice(0, MOTION_LIMITS.instruction),
        plan: null, patterns: [], delay: MOTION_DEFAULT_DELAY, gif: null, busy: false, gone: false, closed: false, seq: 0, controller: null
    };
    _motionSession = session;
    openMotionDialog(session);
    drawInsertPicture(session).catch(err => console.warn('[움직이는 GIF] 그림을 그리다 멈췄습니다:', err));
    return session;
};

Object.assign(window, {
    imageMotionRecord, imageMotionState, freshMotionStillKey, applyImageMotionData, dropImageMotion, releaseMotionStill,
    undoImageMotion, settleImageMotions, drawMotionOverlay, MOTION_TEXT
});
