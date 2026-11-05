// gyosuan-view.js - 강사뷰: 교수안 보기, 교수안·편성안 MD 수정, 슬라이드 다시 만들기, 다른 탭 변경 안내
// 생성과 스튜디오 연결은 gyosuan.js, 변환·불러오기·참고 이미지는 gyosuan-io.js에 있다.

const GYOSUAN_EDIT_LABELS = { docMd: 'MD 수정', deckMd: '편성안 수정' };
const _gyosuanTabs = typeof BroadcastChannel === 'function' ? new BroadcastChannel('gyosuan-lesson') : null;
let _gyosuanForeignChange = null; // 다른 탭이 고친 차시 id
let _gyosuanSampleFor = null; // 샘플을 펼친 차시 id
let _gyosuanDeckViewFor = null; // 편성안을 문서로 펼친 차시 id

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
        renderGyosuanView(mod);
    };
}

const isGyosuanForeignChanged = mod => _gyosuanForeignChange === String(mod.id);

function allowGyosuanOverwrite(mod) {
    if (!isGyosuanForeignChanged(mod)) return true;
    return confirm('다른 탭에서 이 차시를 고쳤습니다. 이 탭의 내용으로 덮어쓸까요?\n취소한 뒤 새로고침하면 최신 내용을 불러옵니다.');
}

/* ---------- 강사뷰 ---------- */
// mark(mount): 그린 문서를 글로 바꾸기 전에 고친다(HTML 내려받기의 다시 불러오기 표시, gyosuanExportDocument)
function gyosuanDocHtml(mod, mark = null) {
    if (!mod?.gyosuan?.docMd) return null;
    const mount = document.createElement('div');
    const parsed = window.KBuilder.parseDoc(resolveGyosuanImages(mod.gyosuan.docMd, mod));
    window.KBuilder.buildDoc(parsed, mount, { refs: mod.refImages || [] });
    if (mark) mark(mount);
    return mount.innerHTML;
}

function gyosuanDeckHtml(mod) {
    const md = stripFrontmatter(resolveGyosuanImages(mod.gyosuan.deckMd, mod));
    return `<div class="gyosuan-deck-view">${sanitizeLessonHtml(marked.parse(md))}</div>`;
}

// 차시가 하나면 차시별 내려받기와 같으므로 보여 주지 않는다
function gyosuanSessionPickHtml(mod) {
    const sessions = gyosuanSessionList(mod);
    if (sessions.length < 2) return '';
    const options = (kind, label) => `<optgroup label="${label}">${sessions.map(session => `<option value="${kind}:${session.index}">${session.index + 1}차시 ${label}</option>`).join('')}</optgroup>`;
    return `
        <select aria-label="차시 하나 받기" onchange="downloadGyosuanSession('${mod.id}', this.value); this.value = ''" class="gyosuan-tool">
            <option value="">차시 하나 받기</option>
            ${options('doc', '교수안')}
            ${mod.gyosuan.deckMd ? options('deck', '편성안') : ''}
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

function gyosuanSourceToolsHtml(mod) {
    const button = (action, icon, label) => `<button onclick="${action}" class="gyosuan-tool"><i class="ph-bold ${icon}"></i> ${label}</button>`;
    return button(`importGyosuanMdFiles('${mod.id}')`, 'ph-file-arrow-up', '완성 MD 불러오기') +
        button(`importGyosuanHtmlFile('${mod.id}')`, 'ph-file-html', '내보낸 HTML 불러오기');
}

function gyosuanEmptyHtml(mod) {
    return `
        <div class="flex flex-col items-center justify-center text-center py-20 px-6 select-none">
            <div class="w-16 h-16 mb-5 flex items-center justify-center rounded-2xl bg-orange-50 text-orange-500 text-3xl">
                <i class="ph-bold ph-chalkboard-teacher"></i>
            </div>
            <h3 class="text-lg font-bold text-gray-800 mb-2">이 차시의 교수안이 아직 없습니다</h3>
            <p class="text-sm text-gray-500 mb-6 leading-relaxed">교안을 바탕으로 AI가 강사 활동·설명 내용·멘트 예시·학생 활동을 담은 교수안과<br>슬라이드 편성안을 함께 만듭니다. 차시 분량에 따라 몇 분 걸릴 수 있습니다.</p>
            <div class="gyosuan-toolbar center">${gyosuanOptionsHtml()}</div>
            <div class="flex items-center gap-2">
                <button onclick="generateGyosuan('${mod.id}')"
                    class="px-5 py-2.5 text-sm font-bold text-white bg-accent rounded-lg hover:bg-accentHover transition-colors flex items-center gap-2 shadow-sm hover:-translate-y-0.5">
                    <i class="ph-bold ph-sparkle"></i> 교수안·슬라이드 생성
                </button>
                <button onclick="showLessonView()"
                    class="px-5 py-2.5 text-sm font-bold text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                    교안 보기
                </button>
            </div>
            <div class="gyosuan-toolbar center">
                ${gyosuanSourceToolsHtml(mod)}
                <button onclick="toggleGyosuanSample()" class="gyosuan-tool"><i class="ph-bold ph-eye"></i> 샘플 미리보기</button>
            </div>
            ${gyosuanRefTrayHtml(mod)}
        </div>`;
}

function gyosuanNoteText(mod) {
    const gyosuan = mod.gyosuan;
    if (isGyosuanForeignChanged(mod)) return '⚠️ 다른 탭에서 이 차시가 바뀌었습니다. 새로고침하면 최신 내용을 불러옵니다.';
    if (gyosuan.deckDirty) return '⚠️ 편성안이 바뀌었습니다. 슬라이드를 다시 만들면 반영됩니다.';
    if (!gyosuan.sourceKey) return '불러온 교수안입니다. 탭별 교안은 위 탐색줄에서 볼 수 있습니다.';
    return gyosuan.sourceKey !== hashSource(collectLessonSource(mod))
        ? '⚠️ 교안이 바뀌었습니다. 교수안을 다시 생성하면 반영됩니다.'
        : '차시 전체 기준 교수안입니다. 탭별 교안은 위 탐색줄에서 볼 수 있습니다.';
}

function gyosuanToolbarHtml(mod) {
    const editing = gyosuanEditField(mod);
    const hasDoc = !!mod.gyosuan.docMd;
    const button = (action, icon, label) => `<button onclick="${action}" class="gyosuan-tool"><i class="ph-bold ${icon}"></i> ${label}</button>`;
    const editButton = (field, icon) => button(`toggleGyosuanEdit('${field}')`, icon, editing === field ? '보기' : GYOSUAN_EDIT_LABELS[field]);
    return `
        <div class="gyosuan-toolbar">
            <span class="gyosuan-note">${gyosuanNoteText(mod)}</span>
            ${editButton('docMd', 'ph-pencil-simple')}
            ${editButton('deckMd', 'ph-slideshow')}
            ${mod.gyosuan.deckMd && !editing ? button('toggleGyosuanDeckView()', 'ph-eye', _gyosuanDeckViewFor === mod.id ? '교수안 보기' : '편성안 보기') : ''}
            ${editing === 'deckMd' || mod.gyosuan.deckDirty ? button(`rebuildGyosuanDeck('${mod.id}')`, 'ph-arrows-clockwise', '슬라이드 다시 만들기') : ''}
            ${hasDoc ? button(`downloadGyosuanMd('${mod.id}')`, 'ph-download-simple', 'MD') : ''}
            ${mod.gyosuan.deckMd ? button(`downloadGyosuanMd('${mod.id}', 'deckMd')`, 'ph-download-simple', '편성안 MD') : ''}
            ${hasDoc ? button(`downloadGyosuanSessions('${mod.id}')`, 'ph-clock', '차시별 MD') : ''}
            ${hasDoc ? button(`downloadGyosuanSessionDecks('${mod.id}')`, 'ph-presentation', '차시별 편성안') : ''}
            ${hasDoc ? gyosuanSessionPickHtml(mod) : ''}
            ${hasDoc ? button(`downloadGyosuanHtml('${mod.id}')`, 'ph-file-html', 'HTML') : ''}
            ${hasDoc ? button(`printGyosuan('${mod.id}')`, 'ph-file-pdf', 'PDF') : ''}
            ${button(`regenerateGyosuan('${mod.id}')`, 'ph-arrow-clockwise', '재생성')}
        </div>
        <div class="gyosuan-toolbar sub">${gyosuanOptionsHtml()}${gyosuanSourceToolsHtml(mod)}</div>
        ${gyosuanRefTrayHtml(mod)}`;
}

function gyosuanEditField(mod) {
    return _gyosuanEditing?.id === mod.id ? _gyosuanEditing.field : null;
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

function gyosuanBodyHtml(mod) {
    if (gyosuanEditField(mod)) return '<textarea id="gyosuan-raw" class="gyosuan-raw" spellcheck="false" onchange="saveGyosuanRaw()"></textarea>';
    if (_gyosuanDeckViewFor === mod.id && mod.gyosuan.deckMd) return gyosuanDeckHtml(mod);
    return gyosuanDocHtml(mod) || '<p class="gyosuan-note">교수안이 없습니다. 완성 MD를 불러오거나 재생성으로 만들 수 있습니다.</p>';
}

function renderGyosuanView(mod) {
    const el = document.getElementById('gyosuan-view');
    if (!el || !mod) return;
    if (_gyosuanSampleFor === mod.id) {
        el.innerHTML = gyosuanSampleHtml();
        return;
    }
    if (!mod.gyosuan?.docMd && !gyosuanHasDeck(mod)) {
        el.innerHTML = gyosuanEmptyHtml(mod);
    } else {
        el.innerHTML = gyosuanToolbarHtml(mod) + gyosuanBodyHtml(mod);
    }
    window.KBuilder.autoImages?.wireSelects(el);
    const raw = document.getElementById('gyosuan-raw');
    if (raw) raw.value = mod.gyosuan[gyosuanEditField(mod)] || '';
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

window.toggleGyosuanEdit = function (field = 'docMd') {
    const mod = getEditingModule();
    if (!mod) return;
    _gyosuanEditing = gyosuanEditField(mod) === field ? null : { id: mod.id, field };
    renderGyosuanView(mod);
};

window.toggleGyosuanDeckView = function () {
    const mod = getEditingModule();
    if (!mod) return;
    _gyosuanDeckViewFor = _gyosuanDeckViewFor === mod.id ? null : mod.id;
    renderGyosuanView(mod);
};

window.toggleGyosuanSample = function () {
    const mod = getEditingModule();
    if (!mod) return;
    _gyosuanSampleFor = _gyosuanSampleFor === mod.id ? null : mod.id;
    renderGyosuanView(mod);
};

const gyosuanHasScreenEdits = gyosuan => !!gyosuan.deckHtml || Object.keys(gyosuan.sessionDecks || {}).length > 0;

// 교수안 원문 칸에 아직 넣지 않은 글 { mod, raw, field }. 없으면 null(칸은 mod.gyosuan[field] || ''로 채운다)
function pendingGyosuanRaw() {
    const mod = getEditingModule();
    const raw = document.getElementById('gyosuan-raw');
    const field = mod && gyosuanEditField(mod);
    if (!mod?.gyosuan || !raw || !field || raw.value === (mod.gyosuan[field] || '')) return null;
    return { mod, raw, field };
}

window.saveGyosuanRaw = async function () {
    const pending = pendingGyosuanRaw();
    if (!pending) return;
    const { mod, raw, field } = pending;
    if (!allowGyosuanOverwrite(mod)) return;
    // 슬라이드 화면 편집은 편성안을 고쳤다고 지우지 않는다. '슬라이드 다시 만들기'를 눌러야 바뀐다
    const deckDirty = field === 'deckMd' ? gyosuanHasScreenEdits(mod.gyosuan) : !!mod.gyosuan.deckDirty;
    mod.gyosuan = { ...mod.gyosuan, [field]: raw.value, deckDirty, updatedAt: new Date().toISOString() };
    _gyosuanForeignChange = null;
    await saveGyosuan(mod);
    syncSlidePanel(mod);
    // 저장은 입력 칸을 벗어날 때 일어난다. 누르는 중인 버튼을 다시 그리면 클릭을 잃으므로 안내 문구만 바꾼다
    const note = document.querySelector?.('#gyosuan-view .gyosuan-note');
    if (note) note.textContent = gyosuanNoteText(mod);
};

// 교수안 원문 칸에 넣지 않은 글이 있는가(Ctrl+S 결과·창을 닫기 전에 묻는다)
window.hasPendingGyosuanRaw = () => !!pendingGyosuanRaw();

window.rebuildGyosuanDeck = async function (moduleId) {
    await window.saveGyosuanRaw();
    const mod = getEditingModule(moduleId);
    const deckMd = mod?.gyosuan?.deckMd || '';
    if (!window.KBuilder.parseDeck(deckMd).slides.length) return window.showAlert('슬라이드를 찾지 못했습니다. 편성안에 "### 슬라이드 1 - 제목" 형식의 블록이 있어야 합니다.');
    if (gyosuanHasScreenEdits(mod.gyosuan) && !confirm('편성안으로 슬라이드를 다시 만듭니다. 슬라이드 화면에서 편집한 내용은 사라집니다. 계속할까요?')) return;
    if (!allowGyosuanOverwrite(mod)) return;
    mod.gyosuan = { ...mod.gyosuan, ...freshDeckState(mod.gyosuan), updatedAt: new Date().toISOString() };
    _gyosuanForeignChange = null;
    await saveGyosuan(mod);
    syncSlidePanel(mod);
    renderGyosuanView(mod);
    window.generateSlideView(mod.id);
};

window.downloadGyosuanMd = function (moduleId, field = 'docMd') {
    const mod = getEditingModule(moduleId);
    const md = mod?.gyosuan?.[field];
    if (!md) return;
    downloadMd(resolveGyosuanImages(md, mod), `${lessonFileBase(mod)}_${field === 'deckMd' ? '슬라이드편성안' : '교수안'}`);
};

// 교수안 문서(HTML 한 파일). 교수안 서식(css/gyosuan-doc.css)을 문서 안에 넣어 따로 열어도 같은 모양이다
// shown(Map)을 주면 보이는 그림에 다시 불러오기 표시를 달고 그 그림을 모은다(HTML 내려받기). 인쇄에는 주지 않는다
async function gyosuanExportDocument(mod, shown = null) {
    const images = { ...(mod.images || {}), ...(mod.gyosuan?.images || {}) }; // 그릴 때와 같은 순서(교수안 그림이 이긴다, gyosuan.js resolveGyosuanImages)
    const html = gyosuanDocHtml(mod, shown ? mount => markShownImages(mount, images, 0, shown) : null);
    if (!html) return null;
    const cssUrl = new URL('css/gyosuan-doc.css', location.href).href;
    const css = await fetch(cssUrl).then(res => (res.ok ? res.text() : '')).catch(() => '');
    const style = css ? `<style>${css}</style>` : `<link rel="stylesheet" href="${cssUrl}">`;
    const print = '<style>@media print { @page { size: A4; margin: 1.5cm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }</style>';
    const title = `${mod.title || '차시'} 교수안`;
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${style}${print}</head><body class="gyosuan-view">${html}</body></html>`;
}

window.downloadGyosuanHtml = async function (moduleId) {
    const mod = getEditingModule(moduleId);
    const shown = new Map();
    const doc = mod && await gyosuanExportDocument(mod, shown);
    if (!doc) return window.showAlert('내보낼 교수안이 없습니다.');
    // 다시 불러오면 이 차시(교안 탭, 교수안·편성안, 교수안 그림)가 고칠 수 있게 되살아난다(output-import.js)
    // 교수안을 원본에 담는 내보내기는 이것뿐이다. 메뉴의 차시·교과 HTML과 ZIP의 교안.html(읽기용)에는 넣지 않는다
    // 바꿀 글을 함수로 넘긴다. 글자로 넘기면 교안 속 $$·$'·$& 가 치환 패턴으로 읽혀 원본이 깨진다
    const source = lessonSourceScript(lessonSourcePayload([mod], { withGyosuan: true, shown: [shown] }));
    const withSource = doc.replace('</body>', () => `${source}</body>`);
    window.noteReimportSize?.(downloadTextFile(withSource, `${lessonFileBase(mod)}_교수안.html`, 'text/html;charset=utf-8'));
};

// 새 창 없이 인쇄 창을 연다(lesson-export.js). 인쇄 창에서 'PDF로 저장'을 고른다
window.printGyosuan = async function (moduleId) {
    const mod = getEditingModule(moduleId);
    const doc = mod && await gyosuanExportDocument(mod);
    if (!doc) return window.showAlert('내보낼 교수안이 없습니다.');
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
