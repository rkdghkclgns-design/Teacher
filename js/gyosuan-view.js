// gyosuan-view.js - 강사뷰: 교수안 보기, 교수안·편성안 MD 수정, 슬라이드 다시 만들기, 다른 탭 변경 안내
// 생성과 스튜디오 연결은 gyosuan.js, 변환·불러오기·참고 이미지는 gyosuan-io.js에 있다.
// 위쪽 기본학습 | 심화학습 고르기(tabs.js)로 고른 갈래의 교수안(mod.gyosuan · mod.gyosuanAdv)을 보인다.

const GYOSUAN_EDIT_LABELS = { docMd: 'MD 수정', deckMd: '편성안 수정', briefMd: '간이 교수안 수정' };
const _gyosuanTabs = typeof BroadcastChannel === 'function' ? new BroadcastChannel('gyosuan-lesson') : null;
let _gyosuanForeignChange = null; // 다른 탭이 고친 차시 id
let _gyosuanSampleFor = null; // 샘플을 펼친 차시 id
let _gyosuanDeckViewFor = null; // 편성안을 문서로 펼친 '차시 id~갈래'(gyosuanViewKey)
let _gyosuanBriefViewFor = null; // 간이 교수안(briefMd, gyosuan-brief.js)을 펼친 '차시 id~갈래'. 편성안 펼침과 함께 켜지지 않는다
const LEGACY_GYOSUAN_NOTE = '예전 방식으로 기본·심화를 함께 담은 교수안입니다. 다시 만들면 기본학습과 기본실습만으로 만듭니다.';

// 차시와 갈래를 함께 가리키는 키(편성안 펼침·원문 수정 상태)
const gyosuanViewKey = (mod, trackId) => `${mod.id}~${lessonTrack(trackId).id}`;

/* ---------- 다른 탭 변경 안내 ---------- */
// 저장은 브라우저 저장소를 통째로 덮어쓴다. 다른 탭이 고친 차시를 이 탭의 낡은 내용으로 덮기 전에 알리고 묻는다
window.announceGyosuanChange = function (moduleId) {
    _gyosuanTabs?.postMessage({ moduleId: String(moduleId) });
};

if (_gyosuanTabs) {
    _gyosuanTabs.onmessage = event => {
        _gyosuanForeignChange = String(event.data?.moduleId);
        const mod = getEditingModule();
        if (!mod || String(mod.id) !== _gyosuanForeignChange) return;
        window.showToast?.('다른 탭에서 이 차시가 바뀌었습니다. 새로고침하면 최신 내용을 불러옵니다.', 'warning');
        // 원문 칸에 아직 넣지 않은 글이 있으면 칸을 다시 그리지 않고 안내 문구만 바꾼다(쓰던 글이 옛 글로 바뀌지 않게. 덮어쓸지 묻는 동안도)
        if (pendingGyosuanRaw()) refreshGyosuanNote(mod);
        else renderGyosuanView(mod);
    };
}

const isGyosuanForeignChanged = mod => _gyosuanForeignChange === String(mod.id);

// 덮어쓸지 묻는 중인 물음 { mod, answer }. 묻는 동안 같은 차시를 다시 저장하면(칸을 벗어남·Ctrl+S·슬라이드 다시 만들기) 새로 묻지 않고 이 답을 기다린다
let _gyosuanOverwriteAsk = null;

// 다른 탭이 이 차시를 고쳤으면 덮어쓰기 전에 앱의 확인 창으로 묻는다(취소하면 false)
async function allowGyosuanOverwrite(mod) {
    if (_gyosuanOverwriteAsk?.mod === mod) return _gyosuanOverwriteAsk.answer;
    if (!isGyosuanForeignChanged(mod)) return true;
    // 물음을 먼저 걸어 두고 창은 다음 차례에 연다. 창으로 포커스가 옮겨 가며 원문 칸이 다시 저장해도(onchange) 이 답을 기다리게
    const ask = { mod };
    ask.answer = Promise.resolve()
        .then(() => confirmAsync('다른 탭에서 이 차시를 고쳤습니다. 이 탭의 내용으로 덮어쓸까요?\n취소한 뒤 새로고침하면 최신 내용을 불러옵니다.', { title: '다른 탭에서 고친 차시', okLabel: '덮어쓰기', tone: 'danger' }))
        .finally(() => {
            if (_gyosuanOverwriteAsk === ask) _gyosuanOverwriteAsk = null;
        });
    _gyosuanOverwriteAsk = ask;
    return ask.answer;
}

// 덮어쓴 차시의 '다른 탭에서 바뀜' 표시만 지운다(묻는 동안 다른 차시의 알림이 왔으면 그 표시는 남긴다)
function clearGyosuanForeignChange(mod) {
    if (isGyosuanForeignChanged(mod)) _gyosuanForeignChange = null;
}

/* ---------- 강사뷰 ---------- */
// mark(mount): 그린 문서를 글로 바꾸기 전에 고친다(HTML 내려받기의 다시 불러오기 표시, gyosuanExportDocument)
function gyosuanDocHtml(mod, mark = null, trackId = 'basic') {
    const gyosuan = gyosuanOf(mod, trackId);
    if (!gyosuan?.docMd) return null;
    const mount = document.createElement('div');
    const parsed = window.KBuilder.parseDoc(resolveGyosuanImages(gyosuan.docMd, mod, trackId));
    window.KBuilder.buildDoc(parsed, mount, { refs: mod.refImages || [] });
    if (mark) mark(mount);
    return mount.innerHTML;
}

function gyosuanDeckHtml(mod, trackId = 'basic') {
    const md = stripFrontmatter(resolveGyosuanImages(gyosuanOf(mod, trackId).deckMd, mod, trackId));
    return `<div class="gyosuan-deck-view">${sanitizeLessonHtml(marked.parse(md))}</div>`;
}

// 간이 교수안은 그림 없는 짧은 글이라 편성안 보기와 같은 서식으로 그린다. 만든 뒤 교수안을 고쳤거나 바꿨으면 맨 위에 한 줄 알리고 다시 만들기 단추를 둔다
function gyosuanBriefHtml(mod, trackId = 'basic') {
    const track = lessonTrack(trackId).id;
    const gyosuan = gyosuanOf(mod, track);
    const stale = typeof isGyosuanBriefStale === 'function' && isGyosuanBriefStale(gyosuan)
        ? `<p class="gyosuan-brief-stale">⚠️ 간이 교수안을 만든 뒤 교수안이 바뀌었습니다. <button onclick="generateGyosuanBrief('${mod.id}', '${track}')" class="gyosuan-tool"><i class="ph-bold ph-arrows-clockwise"></i> 다시 만들기</button></p>` : '';
    return `<div class="gyosuan-deck-view gyosuan-brief-view">${stale}${sanitizeLessonHtml(marked.parse(String(gyosuan.briefMd || '')))}</div>`;
}

// 차시가 하나면 차시별 내려받기와 같으므로 보여 주지 않는다
function gyosuanSessionPickHtml(mod, trackId = 'basic') {
    const sessions = gyosuanSessionList(mod, trackId);
    if (sessions.length < 2) return '';
    const options = (kind, label) => `<optgroup label="${label}">${sessions.map(session => `<option value="${kind}:${session.index}">${session.index + 1}차시 ${label}</option>`).join('')}</optgroup>`;
    return `
        <select aria-label="차시 하나 받기" onchange="downloadGyosuanSession('${mod.id}', this.value, '${lessonTrack(trackId).id}'); this.value = ''" class="gyosuan-tool">
            <option value="">차시 하나 받기</option>
            ${options('doc', '교수안')}
            ${gyosuanOf(mod, trackId).deckMd ? options('deck', '편성안') : ''}
        </select>`;
}

function gyosuanOptionsHtml() {
    const style = gyosuanSlideStyle();
    const options = GYOSUAN_SLIDE_STYLES.map(([value, label]) => `<option value="${value}"${value === style ? ' selected' : ''}>${label}</option>`).join('');
    return `
        <label class="gyosuan-opt" title="생성할 슬라이드의 용도">슬라이드 형식
            <select onchange="setGyosuanSlideStyle(this.value)">${options}</select>
        </label>
        <label class="gyosuan-opt" title="생성할 때 슬라이드 내용에 맞는 이미지를 만듭니다. 교안에 내용이 맞는 이미지가 있으면 그 이미지를 쓰고, 새로 만드는 이미지마다 비용이 듭니다.">이미지 자동 생성
            <select data-auto-img></select>
        </label>`;
}

function gyosuanSourceToolsHtml(mod, trackId = 'basic') {
    const track = lessonTrack(trackId).id;
    const button = (action, icon, label) => `<button onclick="${action}" class="gyosuan-tool"><i class="ph-bold ${icon}"></i> ${label}</button>`;
    return button(`importGyosuanMdFiles('${mod.id}', '${track}')`, 'ph-file-arrow-up', '완성 MD 불러오기') +
        button(`importGyosuanHtmlFile('${mod.id}', '${track}')`, 'ph-file-html', '내보낸 HTML 불러오기');
}

// 그 갈래의 교수안이 없을 때. 갈래의 학습·실습 탭이 비어 있으면 먼저 만들라고 알린다(만들기를 누르면 같은 안내가 뜬다)
function gyosuanEmptyHtml(mod, trackId = 'basic') {
    const track = lessonTrack(trackId);
    const tabs = trackTabsLabel(track);
    const empty = !trackHasContent(mod, track.id)
        ? `<p class="text-sm text-amber-600 mb-4">${escapeHtml(`${tabs} 탭에 아직 교안이 없습니다. 먼저 그 탭을 만든 뒤 교수안을 만드세요.`)}</p>` : '';
    return `
        <div class="flex flex-col items-center justify-center text-center py-20 px-6 select-none">
            <div class="w-16 h-16 mb-5 flex items-center justify-center rounded-2xl bg-orange-50 text-orange-500 text-3xl">
                <i class="ph-bold ph-chalkboard-teacher"></i>
            </div>
            <h3 class="text-lg font-bold text-gray-800 mb-2">이 차시의 ${escapeHtml(track.label)} 교수안이 아직 없습니다</h3>
            <p class="text-sm text-gray-500 mb-6 leading-relaxed">${escapeHtml(tabs)} 탭 교안을 바탕으로 AI가 강사 활동·설명 내용·멘트 예시·학생 활동을 담은 교수안과<br>슬라이드 편성안을 함께 만듭니다. 차시 분량에 따라 몇 분 걸릴 수 있습니다.</p>
            ${empty}
            <div class="gyosuan-toolbar center">${gyosuanOptionsHtml()}</div>
            <div class="flex items-center gap-2">
                <button onclick="generateGyosuan('${mod.id}', { track: '${track.id}' })"
                    class="px-5 py-2.5 text-sm font-bold text-white bg-accent rounded-lg hover:bg-accentHover transition-colors flex items-center gap-2 shadow-sm hover:-translate-y-0.5">
                    <i class="ph-bold ph-sparkle"></i> ${escapeHtml(track.label)} 교수안·슬라이드 만들기
                </button>
                <button onclick="showLessonView()"
                    class="px-5 py-2.5 text-sm font-bold text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                    교안 보기
                </button>
            </div>
            <div class="gyosuan-toolbar center">
                ${gyosuanSourceToolsHtml(mod, track.id)}
                <button onclick="toggleGyosuanSample()" class="gyosuan-tool"><i class="ph-bold ph-eye"></i> 샘플 미리보기</button>
            </div>
            ${gyosuanRefTrayHtml(mod)}
        </div>`;
}

function gyosuanNoteText(mod, trackId = currentGyosuanTrack()) {
    const track = lessonTrack(trackId);
    const gyosuan = gyosuanOf(mod, track.id);
    if (isGyosuanForeignChanged(mod)) return '⚠️ 다른 탭에서 이 차시가 바뀌었습니다. 새로고침하면 최신 내용을 불러옵니다.';
    if (gyosuan.deckDirty) return '⚠️ 편성안이 바뀌었습니다. 슬라이드를 다시 만들면 반영됩니다.';
    if (!gyosuan.sourceKey) return `불러온 교수안입니다(${track.label}). 탭별 교안은 위 탐색줄에서 볼 수 있습니다.`;
    if (track.id === LESSON_TRACKS[0].id && isLegacyGyosuan(mod)) return LEGACY_GYOSUAN_NOTE;
    return gyosuan.sourceKey !== hashSource(collectLessonSource(mod, track.id))
        ? '⚠️ 교안이 바뀌었습니다. 교수안을 다시 생성하면 반영됩니다.'
        : `${trackTabsLabel(track)} 탭으로 만든 ${track.label} 교수안입니다. 탭별 교안은 위 탐색줄에서 볼 수 있습니다.`;
}

function gyosuanToolbarHtml(mod, trackId = 'basic') {
    const track = lessonTrack(trackId).id;
    const gyosuan = gyosuanOf(mod, track);
    const editing = gyosuanEditField(mod, track);
    const hasDoc = !!gyosuan.docMd;
    const button = (action, icon, label) => `<button onclick="${action}" class="gyosuan-tool"><i class="ph-bold ${icon}"></i> ${label}</button>`;
    const editButton = (field, icon) => button(`toggleGyosuanEdit('${field}')`, icon, editing === field ? '보기' : GYOSUAN_EDIT_LABELS[field]);
    const id = `'${mod.id}', '${track}'`;
    // 안내 바로 옆에 그 갈래의 재생성 단추, 끝에 바꾸기 전 교수안으로 되돌리는 단추(gyosuan-regen.js)
    return `
        <div class="gyosuan-toolbar">
            <div class="gyosuan-note-row"><span class="gyosuan-note">${escapeHtml(gyosuanNoteText(mod, track))}</span>${gyosuanRegenButtonHtml(mod, track)}</div>
            ${editButton('docMd', 'ph-pencil-simple')}
            ${editButton('deckMd', 'ph-slideshow')}
            ${gyosuan.deckMd && !editing ? button('toggleGyosuanDeckView()', 'ph-eye', _gyosuanDeckViewFor === gyosuanViewKey(mod, track) ? '교수안 보기' : '편성안 보기') : ''}
            ${gyosuanBriefToolsHtml(mod, track, editing, button, editButton)}
            ${editing === 'deckMd' || gyosuan.deckDirty ? button(`rebuildGyosuanDeck(${id})`, 'ph-arrows-clockwise', '슬라이드 다시 만들기') : ''}
            ${hasDoc ? button(`downloadGyosuanMd('${mod.id}', 'docMd', '${track}')`, 'ph-download-simple', 'MD') : ''}
            ${gyosuan.deckMd ? button(`downloadGyosuanMd('${mod.id}', 'deckMd', '${track}')`, 'ph-download-simple', '편성안 MD') : ''}
            ${gyosuan.briefMd ? button(`downloadGyosuanMd('${mod.id}', 'briefMd', '${track}')`, 'ph-download-simple', '간이 교수안 MD') : ''}
            ${hasDoc ? button(`downloadGyosuanSessions(${id})`, 'ph-clock', '차시별 MD') : ''}
            ${hasDoc ? button(`downloadGyosuanSessionDecks(${id})`, 'ph-presentation', '차시별 편성안') : ''}
            ${hasDoc ? gyosuanSessionPickHtml(mod, track) : ''}
            ${hasDoc ? button(`downloadGyosuanHtml(${id})`, 'ph-file-html', 'HTML') : ''}
            ${hasDoc ? button(`printGyosuan(${id})`, 'ph-file-pdf', 'PDF') : ''}
            ${gyosuanRestoreButtonHtml(mod, track)}
        </div>
        <div class="gyosuan-toolbar sub">${gyosuanOptionsHtml()}${gyosuanSourceToolsHtml(mod, track)}</div>
        ${gyosuanRefTrayHtml(mod)}`;
}

// 간이 교수안 단추: 있으면 보기 전환과 원문 수정, 교수안만 있으면 만들기(gyosuan-brief.js generateGyosuanBrief). 원문을 고치는 동안은 수정 단추만 보인다
// button·editButton: gyosuanToolbarHtml의 단추 모양
function gyosuanBriefToolsHtml(mod, trackId, editing, button, editButton) {
    const gyosuan = gyosuanOf(mod, trackId);
    if (!gyosuan.briefMd && editing !== 'briefMd') {
        return gyosuan.docMd && !editing && typeof window.generateGyosuanBrief === 'function' ? button(`generateGyosuanBrief('${mod.id}', '${trackId}')`, 'ph-sparkle', '간이 교수안 만들기') : '';
    }
    const shown = _gyosuanBriefViewFor === gyosuanViewKey(mod, trackId);
    return (editing ? '' : button('toggleGyosuanBriefView()', 'ph-list-checks', shown ? '교수안 보기' : '간이 교수안 보기')) + editButton('briefMd', 'ph-note-pencil');
}

// 고치는 중인 칸(docMd | deckMd | briefMd). 그 차시의 그 갈래를 고치는 중일 때만
function gyosuanEditField(mod, trackId = currentGyosuanTrack()) {
    return _gyosuanEditing?.id === mod.id && (_gyosuanEditing.track || LESSON_TRACKS[0].id) === lessonTrack(trackId).id ? _gyosuanEditing.field : null;
}

function gyosuanSampleHtml() {
    return `
        <div class="gyosuan-toolbar">
            <span class="gyosuan-note">출력 형식 샘플입니다. 이 차시에 저장되지 않습니다.</span>
            <button onclick="openGyosuanSampleDeck()" class="gyosuan-tool"><i class="ph-bold ph-presentation"></i> 슬라이드 샘플</button>
            <button onclick="downloadGyosuanSample('doc')" class="gyosuan-tool"><i class="ph-bold ph-download-simple"></i> 교수안.md</button>
            <button onclick="downloadGyosuanSample('deck')" class="gyosuan-tool"><i class="ph-bold ph-download-simple"></i> 슬라이드 편성안.md</button>
            <button onclick="toggleGyosuanSample()" class="gyosuan-tool"><i class="ph-bold ph-x"></i> 닫기</button>
        </div>
        ${gyosuanSampleDocHtml()}`;
}

function gyosuanBodyHtml(mod, trackId = 'basic') {
    if (gyosuanEditField(mod, trackId)) return '<textarea id="gyosuan-raw" class="gyosuan-raw" spellcheck="false" onchange="saveGyosuanRaw()"></textarea>';
    if (_gyosuanBriefViewFor === gyosuanViewKey(mod, trackId) && gyosuanOf(mod, trackId).briefMd) return gyosuanBriefHtml(mod, trackId);
    if (_gyosuanDeckViewFor === gyosuanViewKey(mod, trackId) && gyosuanOf(mod, trackId).deckMd) return gyosuanDeckHtml(mod, trackId);
    return gyosuanDocHtml(mod, null, trackId) || '<p class="gyosuan-note">교수안이 없습니다. 완성 MD를 불러오거나 재생성으로 만들 수 있습니다.</p>';
}

// 위쪽에 기본학습 | 심화학습 고르기를 두고, 고른 갈래의 교수안(없으면 만들기 안내)을 그린다
function renderGyosuanView(mod) {
    const el = document.getElementById('gyosuan-view');
    if (!el || !mod) return;
    const track = currentGyosuanTrack();
    const switcher = typeof lessonTrackSwitchHtml === 'function' ? lessonTrackSwitchHtml(mod, 'gyosuan') : '';
    if (_gyosuanSampleFor === mod.id) {
        el.innerHTML = switcher + gyosuanSampleHtml();
        return;
    }
    if (!gyosuanOf(mod, track)?.docMd && !gyosuanHasDeck(mod, track)) {
        el.innerHTML = switcher + gyosuanEmptyHtml(mod, track);
    } else {
        el.innerHTML = switcher + gyosuanToolbarHtml(mod, track) + gyosuanBodyHtml(mod, track);
    }
    window.KBuilder.autoImages?.wireSelects(el);
    const raw = document.getElementById('gyosuan-raw');
    if (raw) raw.value = gyosuanOf(mod, track)[gyosuanEditField(mod, track)] || '';
}

// 보기 모드에서 강사뷰이면 교안 대신 교수안을 보여 준다. 수정 모드는 기존대로 탭 교안 원문을 편집한다.
window.syncGyosuanView = function () {
    const docEl = document.getElementById('gyosuan-view');
    const renderEl = document.getElementById('render-view');
    if (!docEl || !renderEl) return;
    const raw = document.getElementById('raw-view');
    const show = window.viewMode === 'instructor' && (!raw || raw.classList.contains('hidden'));
    docEl.classList.toggle('hidden', !show);
    renderEl.classList.toggle('gyosuan-covered', show);
    if (show) renderGyosuanView(getEditingModule());
};

// 탭 교안은 학생뷰에서 보여 주므로 강사뷰에서 탭을 다루면 학생뷰로 옮긴다
window.showLessonView = function () {
    const closed = window.clearLessonPanel?.();
    if (window.viewMode === 'instructor') applyViewMode('student');
    const mod = closed && getEditingModule();
    if (mod) renderEditor(mod);
};

// 고른 갈래의 교수안·편성안·간이 교수안 원문 칸을 열고 닫는다. 간이 교수안을 고치러 열면 '보기'로 닫을 때 간이 교수안이 보인다
window.toggleGyosuanEdit = function (field = 'docMd') {
    const mod = getEditingModule();
    if (!mod) return;
    const track = currentGyosuanTrack();
    _gyosuanEditing = gyosuanEditField(mod, track) === field ? null : { id: mod.id, field, track };
    if (_gyosuanEditing && field === 'briefMd') {
        _gyosuanBriefViewFor = gyosuanViewKey(mod, track);
        _gyosuanDeckViewFor = null;
    }
    renderGyosuanView(mod);
};

// 편성안 보기와 간이 교수안 보기는 함께 켜지지 않는다(하나를 켜면 다른 하나는 끈다)
window.toggleGyosuanDeckView = function () {
    const mod = getEditingModule();
    if (!mod) return;
    const key = gyosuanViewKey(mod, currentGyosuanTrack());
    _gyosuanDeckViewFor = _gyosuanDeckViewFor === key ? null : key;
    _gyosuanBriefViewFor = null;
    renderGyosuanView(mod);
};

window.toggleGyosuanBriefView = function () {
    const mod = getEditingModule();
    if (!mod) return;
    const key = gyosuanViewKey(mod, currentGyosuanTrack());
    _gyosuanBriefViewFor = _gyosuanBriefViewFor === key ? null : key;
    _gyosuanDeckViewFor = null;
    renderGyosuanView(mod);
};

// 간이 교수안을 막 만들었을 때 그 갈래의 간이 교수안을 펼친다(gyosuan-brief.js). 화면에서 다른 갈래를 골랐으면 펼침만 기억하고 그 갈래 화면을 그린다
window.openGyosuanBriefView = function (mod, trackId = currentGyosuanTrack()) {
    if (!mod) return;
    _gyosuanBriefViewFor = gyosuanViewKey(mod, trackId);
    _gyosuanDeckViewFor = null;
    renderGyosuanView(mod);
};

window.toggleGyosuanSample = function () {
    const mod = getEditingModule();
    if (!mod) return;
    _gyosuanSampleFor = _gyosuanSampleFor === mod.id ? null : mod.id;
    renderGyosuanView(mod);
};

const gyosuanHasScreenEdits = gyosuan => !!gyosuan.deckHtml || Object.keys(gyosuan.sessionDecks || {}).length > 0;

// 교수안 원문 칸에 아직 넣지 않은 글 { mod, raw, field, track }. 없으면 null(칸은 고치는 갈래의 교수안[field] || ''로 채운다)
function pendingGyosuanRaw() {
    const mod = getEditingModule();
    const raw = document.getElementById('gyosuan-raw');
    const track = lessonTrack(_gyosuanEditing?.track).id;
    const field = mod && gyosuanEditField(mod, track);
    const gyosuan = gyosuanOf(mod, track);
    if (!gyosuan || !raw || !field || raw.value === (gyosuan[field] || '')) return null;
    return { mod, raw, field, track };
}

// 안내 문구만 바꾼다(누르는 중인 버튼이나 쓰던 원문 칸은 다시 그리지 않는다)
function refreshGyosuanNote(mod) {
    const note = document.querySelector?.('#gyosuan-view .gyosuan-note');
    if (note) note.textContent = gyosuanNoteText(mod);
}

// 넣을 글과 차시는 묻기 전에 잡아 둔다. 덮어쓰기를 묻는 동안 다른 차시로 옮겨도 쓰던 글은 그 차시에 넣는다.
// 부를 때마다 그때 칸의 글을 넣는다(앞 저장이 끝나기를 기다리는 동안 더 고친 글도 넣게). 덮어쓸지는 한 번만 묻는다(allowGyosuanOverwrite)
window.saveGyosuanRaw = async function () {
    const pending = pendingGyosuanRaw();
    if (!pending) return;
    const { mod, raw, field, track } = pending;
    const slot = lessonTrack(track).field; // 고치던 갈래의 교수안 칸(묻는 동안 갈래를 바꿔도 그 칸에 넣는다)
    if (!(await allowGyosuanOverwrite(mod))) return;
    // 같은 답을 기다린 다른 저장이 이 글을 이미 넣었으면 다시 저장하지 않는다. 묻는 동안 그 교수안이 없어졌으면(다시 만들기·불러오기) 넣지 않는다
    if (!mod[slot] || raw.value === (mod[slot][field] || '')) return;
    // 슬라이드 화면 편집은 편성안을 고쳤다고 지우지 않는다. '슬라이드 다시 만들기'를 눌러야 바뀐다
    const deckDirty = field === 'deckMd' ? gyosuanHasScreenEdits(mod[slot]) : !!mod[slot].deckDirty;
    mod[slot] = { ...mod[slot], [field]: raw.value, deckDirty, updatedAt: new Date().toISOString() };
    clearGyosuanForeignChange(mod);
    await saveGyosuan(mod);
    // 그사이 다른 차시를 열었으면 그 차시의 슬라이드 패널과 안내는 건드리지 않는다
    if (getEditingModule() !== mod) return;
    syncSlidePanel(mod);
    // 저장은 입력 칸을 벗어날 때 일어난다. 누르는 중인 버튼을 다시 그리면 클릭을 잃으므로 안내 문구만 바꾼다
    refreshGyosuanNote(mod);
};

// 교수안 원문 칸에 넣지 않은 글이 있는가(Ctrl+S 결과·창을 닫기 전에 묻는다)
window.hasPendingGyosuanRaw = () => !!pendingGyosuanRaw();

window.rebuildGyosuanDeck = async function (moduleId, trackId = currentGyosuanTrack()) {
    await window.saveGyosuanRaw();
    const mod = getEditingModule(moduleId);
    const track = lessonTrack(trackId);
    const deckMd = gyosuanOf(mod, track.id)?.deckMd || '';
    if (!window.KBuilder.parseDeck(deckMd).slides.length) return window.showAlert('슬라이드를 찾지 못했습니다. 편성안에 "### 슬라이드 1 - 제목" 형식의 블록이 있어야 합니다.');
    if (gyosuanHasScreenEdits(mod[track.field]) && !(await confirmAsync(`${track.label} 편성안으로 슬라이드를 다시 만듭니다. 슬라이드 화면에서 편집한 내용은 사라집니다. 계속할까요?`, { title: `${track.label} 슬라이드 다시 만들기`, okLabel: '다시 만들기', tone: 'danger' }))) return;
    if (!(await allowGyosuanOverwrite(mod))) return;
    // 묻는 동안 다른 교과로 옮겼으면 그 교과의 같은 번호 차시로 슬라이드를 만들지 않는다. 그 교수안이 없어졌어도 만들지 않는다
    if (gyosuanTargetMoved(moduleId, mod) || !mod[track.field]) return;
    mod[track.field] = { ...mod[track.field], ...freshDeckState(mod[track.field]), updatedAt: new Date().toISOString() };
    clearGyosuanForeignChange(mod);
    await saveGyosuan(mod);
    refreshGyosuanViews(mod); // 지금 연 차시일 때만 다시 그린다(gyosuan-io.js)
    window.generateSlideView(mod.id, track.id);
};

// 갈래 교수안 파일 이름의 꼬리: 기본학습은 예전과 같고(교수안·슬라이드편성안), 심화학습은 '심화'를 붙인다
const gyosuanFileTag = (trackId, name) => `${lessonTrack(trackId).id === LESSON_TRACKS[0].id ? '' : '심화'}${name}`;

window.downloadGyosuanMd = function (moduleId, field = 'docMd', trackId = currentGyosuanTrack()) {
    const mod = getEditingModule(moduleId);
    const md = gyosuanOf(mod, trackId)?.[field];
    if (!md) return;
    const name = { deckMd: '슬라이드편성안', briefMd: '간이교수안' }[field] || '교수안';
    downloadMd(resolveGyosuanImages(md, mod, trackId), `${lessonFileBase(mod)}_${gyosuanFileTag(trackId, name)}`);
};

// 교수안 문서(HTML 한 파일). 교수안 서식(css/gyosuan-doc.css)을 문서 안에 넣어 따로 열어도 같은 모양이다
// shown(Map)을 주면 보이는 그림에 다시 불러오기 표시를 달고 그 그림을 모은다(HTML 내려받기). 인쇄에는 주지 않는다
async function gyosuanExportDocument(mod, shown = null, trackId = 'basic') {
    const images = gyosuanImageMap(mod, trackId); // 그릴 때와 같은 그림(교수안 그림이 이기고 움직이는 GIF는 GIF가 이긴다, gyosuan.js resolveGyosuanImages)
    const html = gyosuanDocHtml(mod, shown ? mount => markShownImages(mount, images, 0, shown) : null, trackId);
    if (!html) return null;
    const cssUrl = new URL('css/gyosuan-doc.css', location.href).href;
    const css = await fetch(cssUrl).then(res => (res.ok ? res.text() : '')).catch(() => '');
    const style = css ? `<style>${css}</style>` : `<link rel="stylesheet" href="${cssUrl}">`;
    const print = '<style>@media print { @page { size: A4; margin: 1.5cm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }</style>';
    const title = `${mod.title || '차시'} ${gyosuanFileTag(trackId, '교수안')}`;
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${style}${print}</head><body class="gyosuan-view">${html}</body></html>`;
}

window.downloadGyosuanHtml = async function (moduleId, trackId = currentGyosuanTrack()) {
    const mod = getEditingModule(moduleId);
    const track = lessonTrack(trackId).id;
    const shown = new Map();
    const doc = mod && await gyosuanExportDocument(mod, shown, track);
    if (!doc) return window.showAlert(`내보낼 ${lessonTrack(track).label} 교수안이 없습니다.`);
    // 다시 불러오면 이 차시(교안 탭, 그 갈래의 교수안·편성안, 교수안 그림)가 고칠 수 있게 되살아난다(output-import.js)
    // 교수안을 원본에 담는 내보내기는 이것뿐이다. 메뉴의 차시·교과 HTML과 ZIP의 교안.html(읽기용)에는 넣지 않는다
    // 바꿀 글을 함수로 넘긴다. 글자로 넘기면 교안 속 $$·$'·$& 가 치환 패턴으로 읽혀 원본이 깨진다
    const source = lessonSourceScript(lessonSourcePayload([mod], { withGyosuan: true, track, shown: [shown] }));
    const withSource = doc.replace('</body>', () => `${source}</body>`);
    downloadTextFile(withSource, `${lessonFileBase(mod)}_${gyosuanFileTag(track, '교수안')}.html`, 'text/html;charset=utf-8');
};

// 새 창 없이 인쇄 창을 연다(lesson-export.js). 인쇄 창에서 'PDF로 저장'을 고른다
window.printGyosuan = async function (moduleId, trackId = currentGyosuanTrack()) {
    const mod = getEditingModule(moduleId);
    const doc = mod && await gyosuanExportDocument(mod, null, trackId);
    if (!doc) return window.showAlert(`내보낼 ${lessonTrack(trackId).label} 교수안이 없습니다.`);
    window.showToast?.('인쇄 창에서 "PDF로 저장"을 고르세요.', 'info');
    await printHtmlDocument(doc);
};

// 문서 안 '목차' 링크는 같은 제목의 헤딩으로 이동한다
document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('.gyosuan-view a[href^="#"]');
    if (!link) return;
    event.preventDefault();
    const label = link.textContent.trim();
    const headings = link.closest('.gyosuan-view').querySelectorAll('.doc-h2, .doc-h3');
    const target = Array.from(headings).find(h => h.textContent.trim() === label);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
