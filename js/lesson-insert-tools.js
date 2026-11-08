// lesson-insert-tools.js - 도구의 '동영상 넣기'·'텍스트 블록 넣기'
// 둘 다 '그림 자리 넣기'와 같은 자리 고르기(image-slot-place.js startLessonBlockPlacing)로 넣을 경계(단락·제목·목록·표·코드 블록의 위나 아래)를 고른 뒤 작은 창을 띄운다.
// 넣을 글은 그 경계에 빈 줄로 띄운 따로 선 블록으로 넣고(lessonBlockInsertPlan: 앞뒤 블록과 섞이거나 화면이 숨기는 곳이면 넣지 않는다),
// 바꾸기 전 글은 작업 기록에 남기며(lesson-review.js commitTabChange) Ctrl+Z로 되돌린다(format-toolbar.js recordLessonEdit). 자리 고르기 중 Esc·오른쪽 클릭은 그만둔다.
// 동영상: 주소(YouTube·Vimeo는 youtube-nocookie·player.vimeo.com 삽입 플레이어로, .mp4·.webm 주소는 <video controls>) 또는 내 PC의 mp4·webm 파일(50MB가 넘으면 묻고 100MB까지).
//  파일은 차시의 lessonVideos[동영상 키]에 data URL로 두고 글에는 local:동영상 키로 가리킨다(그림의 mod.images · local:그림 키와 같은 방식).
//  그래서 브라우저 저장(큰 작업의 나눠 저장 state-store.js)·백업 ZIP·PC 폴더(data-safety.js '그림' 폴더)·작업 기록(historyEntry)·쓰지 않는 파일 정리(tabs.js)가 그림과 같은 길로 다룬다.
//  보기 화면은 그린 뒤 그 파일을 붙이고(applyLessonVideos), HTML 내보내기는 파일 안에 넣는다(lesson-export.js exportLessonVideos). 정리(lesson-sanitize.js)는 허용한 삽입 주소와 <video>만 남긴다.
//  학습이해도·심화이해도에는 넣지 않는다(그림과 같은 규칙).
// 텍스트 블록: 마크다운을 쓸 수 있는 글 칸. 빈 글·취소·Esc는 아무것도 바꾸지 않는다. 앞뒤 블록과 섞이는 글이면 쓴 글을 그대로 둔 채 다른 자리를 고르게 한다.
// 기대는 것: image-slot-place.js, lesson-sanitize.js(parseLessonVideoUrl 등), lesson-review.js, api.js·tabs.js(탭 글). 테스트: tests/tool-video-text.test.js

const LESSON_VIDEO_WARN_BYTES = 50 * 1024 * 1024; // 이보다 큰 파일은 넣기 전에 묻는다(저장·백업이 느려진다)
const LESSON_VIDEO_MAX_BYTES = 100 * 1024 * 1024; // 이보다 큰 파일은 넣지 않는다(브라우저 저장·백업 파일 한 개에 담기 어렵다)
const LESSON_VIDEO_NAME_CHARS = 80; // 동영상 설명에 보일 파일 이름 길이
const LESSON_VIDEO_KEY_CHARS = 12; // 동영상 키의 무작위 글자 수(vid_ 뒤)
const LESSON_VIDEO_PROBE = '<div class="lesson-video"><video controls preload="metadata" src="local:vid_probe000000"></video></div>'; // 창을 띄우기 전 자리 검사용
const TEXT_BLOCK_PROBE = '텍스트 블록';
const lessonVideoMb = bytes => Math.max(1, Math.round(Number(bytes) / (1024 * 1024)));

const INSERT_KIND_TEXT = {
    video: {
        label: '동영상 자리', icon: 'ph-video',
        start: "넣을 곳을 누르세요. 마우스를 따라다니는 '동영상 자리'가 넣을 자리(단락·제목·목록·표·코드 블록의 위나 아래)를 보여 줍니다. 누르면 동영상 주소나 파일을 고르는 창이 뜹니다. Esc나 오른쪽 클릭으로 그만둡니다.",
        noView: '동영상은 교안 보기 화면에서 넣을 곳을 눌러 넣습니다. 원문 칸을 닫고 보기 화면에서 다시 눌러 주세요.',
        notViewing: '동영상은 보고 있는 교안 탭에 넣습니다. 교안 탭을 연 뒤 다시 눌러 주세요.',
        bank: '학습이해도·심화이해도에는 동영상을 넣지 않습니다. 기본학습·기본실습·심화학습·심화실습 탭에서 눌러 주세요.',
        cancelled: '동영상 넣기를 그만두었습니다.',
        failed: '동영상을 넣지 못했습니다. 잠시 뒤 다시 해 보세요.'
    },
    text: {
        label: '텍스트 블록', icon: 'ph-text-aa',
        start: "넣을 곳을 누르세요. 마우스를 따라다니는 '텍스트 블록'이 넣을 자리(단락·제목·목록·표·코드 블록의 위나 아래)를 보여 줍니다. 누르면 글을 쓰는 창이 뜹니다. Esc나 오른쪽 클릭으로 그만둡니다.",
        noView: '텍스트 블록은 교안 보기 화면에서 넣을 곳을 눌러 넣습니다. 원문 칸을 닫고 보기 화면에서 다시 눌러 주세요.',
        notViewing: '텍스트 블록은 보고 있는 교안 탭에 넣습니다. 교안 탭을 연 뒤 다시 눌러 주세요.',
        bank: '학습이해도·심화이해도는 문제 형식을 지켜야 해서 텍스트 블록을 넣지 않습니다. 문제는 문제은행 화면이나 도구 → 원문 전체 수정에서 고쳐 주세요.',
        cancelled: '텍스트 블록 넣기를 그만두었습니다.',
        failed: '텍스트 블록을 넣지 못했습니다. 잠시 뒤 다시 해 보세요.'
    }
};

const INSERT_TEXT = {
    emptyTab: '이 탭은 아직 비어 있습니다. 먼저 탭을 만든 뒤 넣어 주세요.',
    moved: '창을 띄운 동안 다른 차시나 탭으로 옮겨 넣지 않았습니다.',
    videoHelp: 'YouTube·Vimeo 주소를 넣으면 개인정보를 덜 남기는 삽입 플레이어(youtube-nocookie.com·player.vimeo.com)로 넣고, .mp4·.webm 파일 주소는 그 파일을 재생합니다. '
        + '내 PC의 mp4·webm 파일은 이 차시에 함께 저장되고 백업에도 담깁니다(50MB가 넘으면 저장·백업이 느려지고, 100MB까지 넣을 수 있습니다).',
    badUrl: '이 주소는 넣을 수 없습니다. YouTube·Vimeo 주소나 .mp4·.webm 파일 주소(https://…)를 넣어 주세요.',
    noUrl: '동영상 주소를 넣거나 내 PC의 동영상 파일을 골라 주세요.',
    badType: 'mp4나 webm 동영상 파일만 넣을 수 있습니다. 다른 형식은 mp4로 바꾸거나 YouTube·Vimeo에 올린 뒤 그 주소를 넣어 주세요.',
    emptyFile: '빈 파일이라 넣지 않았습니다. 다른 파일을 골라 주세요.',
    tooBig: size => `이 파일은 ${size}MB라 넣지 않았습니다. 동영상 파일은 ${lessonVideoMb(LESSON_VIDEO_MAX_BYTES)}MB까지 넣을 수 있습니다. 더 큰 동영상은 YouTube·Vimeo에 올린 뒤 그 주소를 넣어 주세요.`,
    bigAsk: size => `이 파일은 ${size}MB입니다. ${lessonVideoMb(LESSON_VIDEO_WARN_BYTES)}MB가 넘는 동영상은 이 차시에 함께 저장되어 저장·백업·PC 폴더 저장이 느려지고 백업 파일도 그만큼 커집니다. 그래도 넣을까요?`,
    readFailed: '동영상 파일을 읽지 못했습니다. 파일을 확인한 뒤 다시 골라 주세요.',
    videoPlaced: '동영상을 넣었습니다. Ctrl+Z로 되돌릴 수 있습니다.',
    filePlaced: '동영상 파일을 넣었습니다. 파일은 이 차시에 함께 저장되고 백업에도 담깁니다. Ctrl+Z로 되돌릴 수 있습니다.',
    textHelp: '고른 자리에 넣을 글을 쓰세요. 마크다운(**굵게**, - 목록, ### 소제목, 표, 코드 블록)을 쓸 수 있습니다. Ctrl+Enter로 넣습니다.',
    textEmpty: '글이 비어 있어 넣지 않았습니다.',
    textRetry: reason => `${reason} 쓴 글은 그대로 두었습니다. 다른 자리를 누르면 그 글로 창을 다시 엽니다. Esc로 그만둡니다.`,
    textPlaced: '텍스트 블록을 넣었습니다. Ctrl+Z로 되돌릴 수 있습니다.',
    missing: '이 동영상 파일을 찾지 못했습니다. 백업 ZIP에서 되살리거나 도구 → 동영상 넣기로 다시 넣어 주세요.'
};

const insertEscape = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const lessonVideoMap = mod => (mod?.lessonVideos && typeof mod.lessonVideos === 'object' && !Array.isArray(mod.lessonVideos) ? mod.lessonVideos : {});

/* ---------- 동영상 파일 ---------- */
// 넣을 수 있는 동영상 파일인지: mp4·webm(형식을 모르면 확장자로), 빈 파일이 아니고 100MB까지. { ok: true, type, warn(50MB 넘음), size } 또는 { ok: false, reason }
function lessonVideoFileCheck(file) {
    const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(String(file?.name || '')) || [])[1]?.toLowerCase() || '';
    const declared = String(file?.type || '').toLowerCase();
    const known = Object.values(LESSON_VIDEO_FILE_TYPES);
    const type = known.includes(declared) ? declared : (!declared || declared === 'application/octet-stream') ? (LESSON_VIDEO_FILE_TYPES[ext] || '') : '';
    if (!type) return { ok: false, reason: INSERT_TEXT.badType };
    const size = Number(file?.size) || 0;
    if (size <= 0) return { ok: false, reason: INSERT_TEXT.emptyFile };
    if (size > LESSON_VIDEO_MAX_BYTES) return { ok: false, reason: INSERT_TEXT.tooBig(lessonVideoMb(size)) };
    return { ok: true, type, warn: size > LESSON_VIDEO_WARN_BYTES, size };
}

// 바이트 → base64(나눠 바꾼다. 큰 파일도 인자 수 한도에 걸리지 않게)
function lessonVideoBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

// 파일 → 'data:형식;base64,…'. 브라우저는 FileReader로 읽고, 없으면 바이트로 읽는다. 머리는 고른 형식으로 맞춘다(형식을 모르는 파일도 video/mp4 등으로). 못 읽으면 ''
async function readLessonVideoFile(file, type) {
    const data = typeof FileReader === 'function'
        ? await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다'));
            reader.readAsDataURL(file);
        })
        : `data:${type};base64,${lessonVideoBase64(new Uint8Array(await file.arrayBuffer()))}`;
    const comma = data.indexOf(',');
    const head = comma > 0 ? data.slice(0, comma) : '';
    const url = /;base64$/.test(head) ? `data:${type};base64,${data.slice(comma + 1)}` : '';
    return isLessonVideoData(url) ? url : '';
}

// 새 동영상 키: vid_ + 무작위 글자. 차시 동영상에도, 차시 글(local:키)에도 없는 것
function newLessonVideoKey(mod) {
    const taken = new Set(Object.keys(lessonVideoMap(mod)));
    const texts = typeof lessonImageRefTexts === 'function' ? lessonImageRefTexts(mod) : [];
    const letters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (;;) {
        const bytes = new Uint8Array(LESSON_VIDEO_KEY_CHARS);
        if (typeof crypto !== 'undefined' && crypto?.getRandomValues) crypto.getRandomValues(bytes);
        else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
        const key = `vid_${Array.from(bytes, byte => letters[byte % letters.length]).join('')}`;
        if (!taken.has(key) && !texts.some(text => text.includes(`local:${key}`))) return key;
    }
}

// 설명에 보일 파일 이름(줄바꿈·제어 문자를 빼고 줄인다)
const lessonVideoName = name => String(name || '동영상').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LESSON_VIDEO_NAME_CHARS) || '동영상';

// 고른 파일을 확인하고 읽는다. 큰 파일은 묻는다. 넣을 동영상({ kind: 'local', key, data, name }) 또는 null(알렸거나 그만두었다)
async function localLessonVideo(mod, file) {
    const check = lessonVideoFileCheck(file);
    if (!check.ok) {
        window.showAlert(check.reason);
        return null;
    }
    const ask = typeof confirmAsync === 'function' ? confirmAsync : async () => true;
    if (check.warn && !(await ask(INSERT_TEXT.bigAsk(lessonVideoMb(check.size)), { title: '큰 동영상 파일', okLabel: '넣기', tone: 'primary' }))) {
        window.showToast?.(INSERT_KIND_TEXT.video.cancelled, 'info');
        return null;
    }
    let data = '';
    try {
        data = await readLessonVideoFile(file, check.type);
    } catch (err) {
        console.warn('[동영상 넣기] 파일을 읽지 못했습니다:', err?.message || err);
    }
    if (!data) {
        window.showAlert(INSERT_TEXT.readFailed);
        return null;
    }
    return { kind: 'local', key: newLessonVideoKey(mod), data, name: lessonVideoName(file.name) };
}

/* ---------- 넣을 글 ---------- */
// 동영상 블록(한 줄의 HTML 블록). 플레이어 아래에 설명 줄을 둔다(인쇄본·플레이어가 막힌 곳에서도 원래 주소나 파일 이름이 보이게). 주소·이름은 속성·글자로 이스케이프한다
function lessonVideoSnippet(video) {
    const caption = body => `<p class="lesson-video-caption">동영상: ${body}</p>`;
    if (video.kind === 'local') {
        return `<div class="lesson-video"><video controls preload="metadata" src="local:${video.key}"></video>${caption(insertEscape(video.name))}</div>`;
    }
    const linkText = { youtube: 'YouTube에서 보기', vimeo: 'Vimeo에서 보기', file: '동영상 파일 주소' }[video.kind];
    const link = `<a href="${insertEscape(video.link)}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
    const player = video.kind === 'file'
        ? `<video controls preload="metadata" src="${insertEscape(video.src)}"></video>`
        : `<iframe src="${insertEscape(video.src)}" title="동영상"></iframe>`;
    return `<div class="lesson-video">${player}${caption(link)}</div>`;
}

/* ---------- 창 ---------- */
const INSERT_OVERLAY_CLASS = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] animate-fade-in';
const INSERT_PANEL_CLASS = 'bg-[#1a1a2e] border border-white/10 rounded-2xl w-[460px] max-w-[92vw] p-6 shadow-2xl flex flex-col';
const INSERT_CANCEL_CLASS = 'px-4 py-2 text-xs font-bold text-textLight bg-white/5 hover:bg-white/10 rounded-lg transition-colors';
const INSERT_OK_CLASS = 'px-4 py-2 text-xs font-bold text-white bg-accent hover:bg-accentHover rounded-lg transition-colors';
const INSERT_FIELD_CLASS = 'w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent transition-colors';

// 앱 창(ui.js openAppDialog)으로 띄운다. 창 안 클릭이 바깥 클릭(닫기)으로 번지지 않게 한다
function openInsertDialog(overlay, opts) {
    document.body.appendChild(overlay);
    overlay.querySelector('[data-app-dialog-panel]')?.addEventListener('click', event => event.stopPropagation());
    if (typeof openAppDialog === 'function') return openAppDialog(overlay, opts);
    return { tooSoon: () => false, close: () => overlay.remove() };
}

// 동영상 고르기 창. { kind: 'url', video } | { kind: 'file', file } | null(취소·Esc·바깥 클릭)
window.askLessonVideo = function () {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = INSERT_OVERLAY_CLASS;
        overlay.innerHTML = `
            <div data-app-dialog-panel class="${INSERT_PANEL_CLASS}">
                <h3 data-app-dialog-title class="font-bold text-white text-sm mb-2 flex items-center gap-2"><i class="ph-bold ph-video" aria-hidden="true"></i> 동영상 넣기</h3>
                <p data-app-dialog-text class="text-xs text-textMuted mb-3 leading-relaxed whitespace-pre-wrap">${insertEscape(INSERT_TEXT.videoHelp)}</p>
                <input type="url" data-video-url aria-label="동영상 주소" placeholder="예: https://www.youtube.com/watch?v=…" class="${INSERT_FIELD_CLASS} mb-2">
                <p data-video-error role="alert" class="hidden text-xs text-red-300 mb-2 leading-relaxed"></p>
                <button type="button" data-video-pick class="self-start mb-4 px-3 py-1.5 text-xs font-bold text-textLight bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg flex items-center gap-1 transition-colors">
                    <i class="ph-bold ph-folder-open" aria-hidden="true"></i> 내 PC의 동영상 파일 고르기(mp4·webm)
                </button>
                <input type="file" data-video-file accept=".mp4,.webm,video/mp4,video/webm" class="hidden" tabindex="-1" aria-hidden="true">
                <div class="flex justify-end gap-2">
                    <button type="button" data-video-cancel class="${INSERT_CANCEL_CLASS}">취소</button>
                    <button type="button" data-video-ok class="${INSERT_OK_CLASS}">넣기</button>
                </div>
            </div>`;
        const input = overlay.querySelector('[data-video-url]');
        const error = overlay.querySelector('[data-video-error]');
        let done = false;
        const answer = value => {
            if (done) return;
            done = true;
            dialog.close();
            resolve(value);
        };
        const dialog = openInsertDialog(overlay, { onDismiss: () => answer(null), focus: input });
        const submit = () => {
            if (dialog.tooSoon()) return;
            const text = String(input.value ?? '').trim();
            const video = text ? parseLessonVideoUrl(text) : null;
            if (video) return answer({ kind: 'url', video });
            error.textContent = text ? INSERT_TEXT.badUrl : INSERT_TEXT.noUrl;
            error.classList.remove('hidden');
            input.focus?.();
        };
        overlay.querySelector('[data-video-ok]').addEventListener('click', submit);
        overlay.querySelector('[data-video-cancel]').addEventListener('click', () => {
            if (!dialog.tooSoon()) answer(null);
        });
        input.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || (typeof isImeKey === 'function' && isImeKey(event))) return;
            event.preventDefault();
            submit();
        });
        const fileInput = overlay.querySelector('[data-video-file]');
        overlay.querySelector('[data-video-pick]').addEventListener('click', () => {
            if (!dialog.tooSoon()) fileInput.click(); // 키보드로도 고를 수 있게 버튼이 숨긴 파일 칸을 연다
        });
        fileInput.addEventListener('change', event => {
            const file = event.target?.files?.[0];
            if (file) answer({ kind: 'file', file });
        });
    });
};

// 텍스트 블록 쓰기 창. draft: 처음 글. 쓴 글(그대로) 또는 null(취소·Esc·바깥 클릭)
window.askTextBlock = function (draft = '') {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = INSERT_OVERLAY_CLASS;
        overlay.innerHTML = `
            <div data-app-dialog-panel class="${INSERT_PANEL_CLASS} w-[560px]">
                <h3 data-app-dialog-title class="font-bold text-white text-sm mb-2 flex items-center gap-2"><i class="ph-bold ph-text-aa" aria-hidden="true"></i> 텍스트 블록 넣기</h3>
                <p data-app-dialog-text class="text-xs text-textMuted mb-3 leading-relaxed whitespace-pre-wrap">${insertEscape(INSERT_TEXT.textHelp)}</p>
                <textarea data-text-block rows="9" aria-label="넣을 글" placeholder="예: **정리** 게임 루프는 입력·갱신·그리기를 되풀이합니다." class="${INSERT_FIELD_CLASS} mb-4 font-mono leading-relaxed resize-y">${insertEscape(draft)}</textarea>
                <div class="flex justify-end gap-2">
                    <button type="button" data-text-cancel class="${INSERT_CANCEL_CLASS}">취소</button>
                    <button type="button" data-text-ok class="${INSERT_OK_CLASS}">넣기</button>
                </div>
            </div>`;
        const area = overlay.querySelector('[data-text-block]');
        let done = false;
        const answer = value => {
            if (done) return;
            done = true;
            dialog.close();
            resolve(value);
        };
        const dialog = openInsertDialog(overlay, { onDismiss: () => answer(null), focus: area });
        const submit = () => {
            if (!dialog.tooSoon()) answer(String(area.value ?? ''));
        };
        overlay.querySelector('[data-text-ok]').addEventListener('click', submit);
        overlay.querySelector('[data-text-cancel]').addEventListener('click', () => {
            if (!dialog.tooSoon()) answer(null);
        });
        area.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || (typeof isImeKey === 'function' && isImeKey(event))) return;
            event.preventDefault();
            submit();
        });
    });
};

/* ---------- 넣기 ---------- */
// 넣을 차시·탭. 보고 있는 교안 탭이 아니거나 문제은행 탭이거나 빈 탭이면 알리고 null(그림 자리 넣기와 같은 규칙)
function insertToolTarget(which) {
    const text = INSERT_KIND_TEXT[which];
    const mod = typeof getEditingModule === 'function' ? getEditingModule() : null;
    const tabId = typeof currentLessonTab !== 'undefined' ? currentLessonTab : 'basicLearn';
    if (!mod || !isViewingTab(mod, tabId)) {
        window.showAlert(text.notViewing);
        return null;
    }
    if (mod.tabContents && isQuestionBankTab(tabId)) {
        window.showAlert(text.bank);
        return null;
    }
    // 빈 탭에는 넣을 블록이 없다(넣으면 탭을 만든 것으로 보여 '탭 생성하기' 안내가 사라진다). 비운 기본학습에 보이는 다른 탭 글은 이 탭 글이 아니다(showsOtherTabsText)
    const own = mod.tabContents ? (showsOtherTabsText(mod, tabId) ? '' : tabSourceFor(mod, tabId)) : mod.content;
    if (!String(own || '').trim()) {
        window.showAlert(INSERT_TEXT.emptyTab);
        return null;
    }
    return { mod, tabId };
}

// 바꾸기 전 글을 작업 기록에 남기고 넣는다. Ctrl+Z로 되돌릴 수 있게 기억한다. 넣었으면 true
async function commitInsertedBlock(mod, tabId, before, after, what) {
    const label = mod.tabContents ? reviewTabLabel(tabId) : '본문';
    if (!(await commitTabChange(mod, tabId, before, after, `${what} (${label})`, `${what} 전`))) return false;
    window.recordLessonEdit?.(mod, tabId, before, after);
    return true;
}

// 고른 자리에 동영상을 넣는다. 창을 띄우기 전에 그 자리에 블록을 넣을 수 있는지 먼저 본다(아니면 까닭을 알리고 자리 고르기를 이어 간다)
async function placeLessonVideoAt(state, view, spot) {
    const { mod, tabId } = state;
    const part = slotPart(view, spot.el);
    const probe = lessonBlockInsertPlan(storedTabMarkdown(mod, tabId), part, spot.side, LESSON_VIDEO_PROBE);
    if (!probe.ok) return window.showToast?.(probe.reason, 'warning');
    window.leaveLessonBlockPlacing();
    const choice = await window.askLessonVideo();
    if (!choice) return window.showToast?.(INSERT_KIND_TEXT.video.cancelled, 'info');
    const video = choice.kind === 'file' ? await localLessonVideo(mod, choice.file) : choice.video;
    if (!video) return;
    if (!isViewingTab(mod, tabId)) return window.showToast?.(INSERT_TEXT.moved, 'warning');
    const before = storedTabMarkdown(mod, tabId);
    const plan = lessonBlockInsertPlan(before, part, spot.side, lessonVideoSnippet(video));
    if (!plan.ok) return window.showAlert(plan.reason);
    const local = video.kind === 'local';
    const had = Object.prototype.hasOwnProperty.call(mod, 'lessonVideos');
    if (local) mod.lessonVideos = { ...lessonVideoMap(mod), [video.key]: video.data }; // 글보다 먼저 둔다(넣으며 저장할 때 함께 저장되게)
    let placed = false;
    try {
        placed = await commitInsertedBlock(mod, tabId, before, plan.text, '동영상 넣기');
    } finally {
        if (local && !placed) dropPendingLessonVideo(mod, video.key, had); // 넣지 못했으면(멈췄거나 오류) 둔 파일을 거둔다
    }
    if (placed) window.showToast?.(local ? INSERT_TEXT.filePlaced : INSERT_TEXT.videoPlaced, 'success');
}

// 넣지 못한 동영상 파일을 차시에서 뺀다. 그사이 다른 동영상이 들어왔어도 그 키 하나만 뺀다. 처음에 칸이 없었고 비면 칸도 지운다
function dropPendingLessonVideo(mod, key, had) {
    const { [key]: dropped, ...rest } = lessonVideoMap(mod);
    if (!had && !Object.keys(rest).length) delete mod.lessonVideos;
    else mod.lessonVideos = rest;
}

const videoKind = () => ({ ...INSERT_KIND_TEXT.video, place: placeLessonVideoAt });

// 고른 자리에 쓴 글을 넣는다. draft: 앞에서 넣지 못한 글(창에 다시 채운다)
async function placeTextBlockAt(state, view, spot, draft) {
    const { mod, tabId } = state;
    const part = slotPart(view, spot.el);
    const probe = lessonBlockInsertPlan(storedTabMarkdown(mod, tabId), part, spot.side, TEXT_BLOCK_PROBE);
    if (!probe.ok) return window.showToast?.(probe.reason, 'warning');
    window.leaveLessonBlockPlacing();
    const text = await window.askTextBlock(draft);
    if (text === null) return window.showToast?.(INSERT_KIND_TEXT.text.cancelled, 'info');
    if (!String(text).trim()) return window.showToast?.(INSERT_TEXT.textEmpty, 'info');
    if (!isViewingTab(mod, tabId)) return window.showToast?.(INSERT_TEXT.moved, 'warning');
    const before = storedTabMarkdown(mod, tabId);
    const plan = lessonBlockInsertPlan(before, part, spot.side, text);
    if (!plan.ok) return window.startLessonBlockPlacing(mod, tabId, textKind(text, INSERT_TEXT.textRetry(plan.reason)));
    if (await commitInsertedBlock(mod, tabId, before, plan.text, '텍스트 블록 넣기')) window.showToast?.(INSERT_TEXT.textPlaced, 'success');
}

// retry: 넣지 못한 까닭(다시 고르기를 열며 보인다)
const textKind = (draft = '', retry = '') => ({
    ...INSERT_KIND_TEXT.text,
    ...(retry ? { start: retry, startType: 'warning' } : {}),
    place: (state, view, spot) => placeTextBlockAt(state, view, spot, draft)
});

// 도구 → 동영상 넣기
window.insertLessonVideo = function () {
    const target = insertToolTarget('video');
    if (target) window.startLessonBlockPlacing(target.mod, target.tabId, videoKind());
};

// 도구 → 텍스트 블록 넣기
window.insertTextBlock = function () {
    const target = insertToolTarget('text');
    if (target) window.startLessonBlockPlacing(target.mod, target.tabId, textKind());
};

/* ---------- 보기 화면: 직접 넣은 동영상 재생 ---------- */
// 동영상 data URL → 재생 주소(blob:). 같은 동영상은 한 번만 바꾼다(큰 파일을 그릴 때마다 풀지 않게). 바꿀 수 없으면 data URL 그대로
let lessonVideoUrls = new Map();
function lessonVideoPlayUrl(data) {
    if (lessonVideoUrls.has(data)) return lessonVideoUrls.get(data);
    let url = data;
    try {
        if (typeof dataUrlBlob === 'function' && typeof URL !== 'undefined' && URL.createObjectURL) url = URL.createObjectURL(dataUrlBlob(data));
    } catch (err) {
        console.warn('[동영상] 재생 주소를 만들지 못해 파일 글 그대로 씁니다:', err?.message || err);
        url = data;
    }
    lessonVideoUrls.set(data, url);
    return url;
}

// 보기 화면을 그린 뒤 부른다(api.js toggleEditorMode). <video src="local:vid_키">에 차시의 파일을 붙이고(data-video-id로 키를 적어 둔다),
// 파일이 없으면(다른 곳에서 불러온 글 등) 감추고 안내를 단다. 이 화면이 쓰지 않는 재생 주소는 놓는다(keepUrls: 원문 칸 미리 보기처럼 보기 화면 옆에 그릴 때는 놓지 않는다)
window.applyLessonVideos = function (view, mod, { keepUrls = false } = {}) {
    if (!view || !mod) return;
    const videos = lessonVideoMap(mod);
    const used = new Set();
    Array.from(view.querySelectorAll('video')).forEach(player => {
        if (player.hasAttribute('data-wb-video')) return; // 판서 영상은 whiteboard-video.js가 다룬다
        const key = lessonVideoKeyOf(player);
        if (!key) return;
        player.setAttribute('data-video-id', key);
        Array.from(player.parentNode?.querySelectorAll?.('.lesson-video-missing') || []).forEach(el => el.remove());
        const data = Object.prototype.hasOwnProperty.call(videos, key) ? videos[key] : '';
        if (!isLessonVideoData(data)) {
            player.removeAttribute('src');
            player.setAttribute('hidden', '');
            const note = document.createElement('div');
            note.className = 'lesson-video-missing';
            note.textContent = INSERT_TEXT.missing;
            player.parentNode?.insertBefore(note, player.nextSibling);
            return;
        }
        player.removeAttribute('hidden');
        used.add(data);
        const url = lessonVideoPlayUrl(data);
        if (player.getAttribute('src') !== url) player.setAttribute('src', url);
    });
    if (keepUrls) return;
    lessonVideoUrls.forEach((url, data) => {
        if (used.has(data)) return;
        if (url.startsWith('blob:')) URL.revokeObjectURL?.(url);
        lessonVideoUrls.delete(data);
    });
};

if (typeof window !== 'undefined') Object.assign(window, { lessonVideoFileCheck, lessonVideoSnippet });
