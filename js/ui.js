// Custom Modal Utilities (Alert & Confirm Replacements)

// ------------------------------------------------------------------------

// XSS 방지: HTML 이스케이프 유틸리티
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

window.showToast = function (message, type = 'success') {
    const toast = document.createElement('div');
    // type에 따른 색상 및 아이콘 설정
    const bgClass = type === 'error' ? 'bg-red-500' : type === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';
    const iconClass = type === 'error' ? 'ph-warning-octagon' : type === 'warning' ? 'ph-warning' : 'ph-check-circle';

    toast.className = `fixed bottom-6 right-6 z-[9999] ${bgClass} text-white px-5 py-3 rounded-lg shadow-xl flex items-center gap-3 text-sm font-bold animate-fade-in-up transition-opacity duration-300`;
    // 먼저 뜬 알림이 있으면 그 위에 쌓는다(같은 자리에 겹치면 앞 알림을 읽을 수 없다. 작업 기록·휴지통 상한 알림 등)
    const below = [...document.querySelectorAll('[data-app-toast]')].reduce((sum, el) => sum + el.offsetHeight + 8, 0);
    toast.dataset.appToast = '';
    if (below) toast.style.bottom = `calc(1.5rem + ${below}px)`;
    toast.innerHTML = `
        <i class="ph-fill ${iconClass} text-xl"></i>
        <span>${escapeHtml(message)}</span>
    `;

    document.body.appendChild(toast);

    // 3초 뒤 페이드아웃 후 제거
    setTimeout(() => {
        toast.classList.replace('opacity-100', 'opacity-0'); // 만약 기존 opacity 유틸이 있다면 사용, 없으면 직접 style 제어
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

window.showAlert = function (message) {

    const overlay = document.createElement('div');

    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] animate-fade-in';
    overlay.dataset.appDialog = ''; // 저장본을 읽지 못한 창이 뒤 화면을 막을 때(inert)도 이 알림은 누를 수 있게(state.js)

    overlay.onclick = () => overlay.remove();

    overlay.innerHTML = `

                <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[320px] p-6 shadow-2xl flex flex-col items-center text-center" onclick="event.stopPropagation()">

                    <div class="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center mb-4">

                        <i class="ph-fill ph-info text-2xl text-accent"></i>

                    </div>

                    <p class="text-sm text-textLight mb-6 whitespace-pre-wrap">${escapeHtml(message)}</p>

                    <button class="w-full px-4 py-2.5 text-sm font-bold text-white bg-accent hover:bg-accentHover rounded-xl transition-colors" onclick="this.closest('.fixed').remove()">확인</button>

                </div>

            `;

    document.body.appendChild(overlay);

};



window.alert = window.showAlert;



// 같은 확인 창(제목·글·확인 버튼 이름이 같음)이 떠 있으면 하나 더 띄우지 않는다. 키보드로 두 번 누르거나, 늦게 뜨는 창의 버튼을 다시 눌러도 창이 겹치지 않게
const _openConfirms = new Map();
// 창이 뜬 뒤 이 시간 안의 클릭은 받지 않는다(바깥·취소·확인 모두). 두 번 누른 클릭의 둘째가 막 뜬 창을 바로 닫거나 확인하지 않게
const CONFIRM_CLICK_GRACE_MS = 500;

// opts: okLabel(확인 버튼 이름, 기본 '삭제'), cancelLabel(취소 버튼 이름, 기본 '취소'), tone('danger' 빨강 | 'primary' 보라), title, onCancel,
//       dismissible(false면 바깥을 눌러도 닫지 않는다. 버리면 다시 볼 수 없는 결과를 물을 때. Esc는 원래 이 창을 닫지 않는다)
// 같은 확인 창이 이미 떠 있으면 새로 띄우지 않고 onCancel을 부른다(confirmAsync는 false)
window.showConfirm = function (message, onConfirm, opts = {}) {
    const { okLabel = '삭제', cancelLabel = '취소', tone = 'danger', title = '확인', onCancel, dismissible = true } = opts;
    const key = JSON.stringify([title, message, okLabel]);
    if (_openConfirms.get(key)?.isConnected) {
        if (typeof onCancel === 'function') onCancel();
        return;
    }
    const okClass = tone === 'primary' ? 'bg-accent hover:bg-accentHover' : 'bg-red-500/80 hover:bg-red-500';
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] animate-fade-in';
    overlay.dataset.appDialog = ''; // 저장본을 읽지 못한 창이 뒤 화면을 막을 때(inert)도 이 확인 창은 누를 수 있게(state.js)
    const openedAt = Date.now();
    const tooSoon = () => Date.now() - openedAt < CONFIRM_CLICK_GRACE_MS;
    const close = () => {
        overlay.remove();
        if (_openConfirms.get(key) === overlay) _openConfirms.delete(key);
    };
    const cancel = () => {
        close();
        if (typeof onCancel === 'function') onCancel();
    };
    overlay.onclick = () => {
        if (!dismissible || tooSoon()) return;
        cancel();
    };
    overlay.innerHTML = `
                <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[360px] max-w-[92vw] p-6 shadow-2xl flex flex-col" onclick="event.stopPropagation()">
                    <div class="flex items-center gap-3 mb-4">
                        <i class="ph-fill ph-warning-circle text-2xl text-yellow-400"></i>
                        <h3 class="font-bold text-white text-sm">${escapeHtml(title)}</h3>
                    </div>
                    <p class="text-sm text-textMuted mb-6 leading-relaxed whitespace-pre-wrap max-h-[60vh] overflow-y-auto">${escapeHtml(message)}</p>
                    <div class="flex justify-end gap-2">
                        <button class="px-4 py-2 text-xs font-bold text-textLight bg-white/5 hover:bg-white/10 rounded-lg transition-colors" data-confirm-cancel>${escapeHtml(cancelLabel)}</button>
                        <button class="px-4 py-2 text-xs font-bold text-white ${okClass} rounded-lg transition-colors" data-confirm-ok>${escapeHtml(okLabel)}</button>
                    </div>
                </div>
            `;
    _openConfirms.set(key, overlay);
    document.body.appendChild(overlay);
    // 버튼은 이 창 안에서 찾는다. 창이 겹쳐도 위 창의 버튼이 아래 창을 움직이지 않게
    overlay.querySelector('[data-confirm-cancel]').onclick = () => {
        if (tooSoon()) return; // 막 뜬 창의 취소(버리기)도 받지 않는다
        cancel();
    };
    overlay.querySelector('[data-confirm-ok]').onclick = () => {
        if (tooSoon()) return;
        close();
        if (typeof onConfirm === 'function') onConfirm();
    };
};



window.showModal = function (title, contentHTML) {

    const overlay = document.createElement('div');

    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9998] animate-fade-in';

    overlay.onclick = () => overlay.remove();

    overlay.innerHTML = `

                <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[800px] max-w-[90vw] max-h-[85vh] shadow-2xl flex flex-col" onclick="event.stopPropagation()">

                    <div class="flex items-center justify-between p-5 border-b border-white/10 shrink-0">

                        <h3 class="font-bold text-white text-lg flex items-center gap-2"><i class="ph-fill ph-book-open-text text-accent"></i> ${title}</h3>

                        <button class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-textMuted hover:text-white transition-colors" onclick="this.closest('.fixed').remove()">

                            <i class="ph-bold ph-x text-lg"></i>

                        </button>

                    </div>

                    <div class="p-6 overflow-y-auto editor-scroll flex-1 text-sm bg-bgEditor markdown-body rounded-b-2xl">

                        ${contentHTML}

                    </div>

                </div>

            `;

    document.body.appendChild(overlay);

};

// ── F1-2: 핵심개념 입력 팝업 ──
// opts.warning: 버튼 위에 보일 경고(다시 만들기 등), opts.okLabel: 확인 버튼 이름,
// opts.estimateHtml: 시작하면 이어서 할 일의 미리 보기 상자(cost-estimate.js estimateBoxHtml이 만든 HTML. 글은 그 안에서 이스케이프한다)
window.showKeyConceptsPrompt = function (title, defaultConcepts, onConfirm, opts = {}) {
    const defaults = Array.isArray(defaultConcepts) ? defaultConcepts.filter(Boolean) : [];
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] animate-fade-in';
    overlay.onclick = () => overlay.remove();
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[420px] p-6 shadow-2xl flex flex-col" onclick="event.stopPropagation()">
            <div class="flex items-center gap-3 mb-4">
                <i class="ph-fill ph-lightbulb text-2xl text-accent"></i>
                <h3 class="font-bold text-white text-sm">${escapeHtml(title)}</h3>
            </div>
            <p class="text-xs text-textMuted mb-3 leading-relaxed">이 차시에서 반드시 다뤄야 할 핵심 개념을 입력하세요.<br>쉼표(,)로 구분하며, 비워두면 AI가 자동 구성합니다.</p>
            ${opts.warning ? `<p class="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-3 leading-relaxed"><i class="ph-bold ph-warning"></i> ${escapeHtml(opts.warning)}</p>` : ''}
            ${opts.estimateHtml ? `<div class="mb-3">${opts.estimateHtml}</div>` : ''}
            <input type="text" id="kc-prompt-input" value="${escapeHtml(defaults.join(', '))}"
                placeholder="예: 게임 루프, 프레임 레이트, 델타 타임"
                class="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent transition-colors mb-4"
                onkeydown="if(event.key==='Enter' && !event.isComposing){document.getElementById('kc-prompt-ok').click();}">
            <div class="flex justify-end gap-2">
                <button class="px-4 py-2 text-xs font-bold text-textLight bg-white/5 hover:bg-white/10 rounded-lg transition-colors" onclick="this.closest('.fixed').remove()">취소</button>
                <button id="kc-prompt-ok" class="px-4 py-2 text-xs font-bold text-white bg-accent hover:bg-accentHover rounded-lg transition-colors flex items-center gap-1">
                    <i class="ph-bold ph-sparkle"></i> ${escapeHtml(opts.okLabel || '생성')}
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    const input = document.getElementById('kc-prompt-input');
    setTimeout(() => input.focus(), 100);
    document.getElementById('kc-prompt-ok').onclick = () => {
        const raw = input.value.trim();
        const concepts = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
        overlay.remove();
        if (typeof onConfirm === 'function') onConfirm(concepts);
    };
};

// 전역 클릭 감지 (드롭다운 외부 클릭 시 닫기)
document.addEventListener('click', (event) => {
    // PDF 드롭다운 닫기
    const pdfMenu = document.getElementById('pdf-dropdown-menu');
    const pdfBtn = document.getElementById('pdf-dropdown-btn');

    if (pdfMenu && !pdfMenu.classList.contains('hidden') &&
        !pdfMenu.contains(event.target) && (!pdfBtn || !pdfBtn.contains(event.target))) {
        pdfMenu.classList.add('hidden');
        pdfMenu.classList.remove('flex');
    }

    // 폴더 연동 드롭다운 닫기
    const folderMenu = document.getElementById('folder-dropdown-menu');
    const folderIndicator = document.getElementById('folder-connection-indicator');

    if (folderMenu && !folderMenu.classList.contains('hidden') &&
        !folderMenu.contains(event.target) && (!folderIndicator || !folderIndicator.contains(event.target))) {
        folderMenu.classList.add('hidden');
        folderMenu.classList.remove('flex');
    }
});

window.addEventListener('hashchange', handleRoute);

// Ctrl+S(맥은 Cmd+S). 한글 입력 상태에서도 잡히게 글자(key)뿐 아니라 키 위치(code)로도 본다
function isSaveShortcut(e) {
    return !!(e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyS' || String(e.key || '').toLowerCase() === 's');
}

// Ctrl+S: 열어 둔 원문 칸(교안·교수안)과 칸을 벗어날 때 저장하는 입력칸의 글을 먼저 넣고, 브라우저 저장이 끝난 뒤 실제 결과를 알린다
async function saveNow() {
    if (window.isStateLoadFailed?.()) return window.showStateLoadFailedDialog?.(); // 저장본을 읽지 못한 동안은 저장하지 않는다(거짓 '저장했습니다' 없이)
    window.flushVisibleRawView?.();
    // 단락 편집 상자·차시 카드 제목·교과 이름처럼 칸을 벗어날 때 저장하는 곳은 벗어나게 해서 저장한다. 원문 칸 둘은 여기서 넣으므로 커서를 그대로 둔다
    const active = document.activeElement;
    const leaveSaves = active && !['raw-view', 'gyosuan-raw'].includes(active.id)
        && (active.closest?.('.para-edit') || active.isContentEditable || active.matches?.('[onblur], [onchange]'));
    if (leaveSaves) active.blur();
    await window.saveGyosuanRaw?.();
    // 브라우저에 끝까지 저장했을 때만 저장했다고 알린다. 저장하지 못했으면 saveState가 까닭을 알린 뒤 이 알림을 더한다
    const saved = await saveState();
    if (saved !== true) return window.showToast?.('브라우저에 저장하지 못했습니다. 작업을 잃지 않게 내보내기·백업에서 과정 전체 백업 ZIP을 받아 두세요.', 'error');
    if (window.hasPendingGyosuanRaw?.()) return window.showAlert('저장했습니다. 다만 교수안 원문 칸의 글은 넣지 않았습니다(다른 브라우저 탭에서 이 차시를 고쳤습니다).\n고친 글을 복사해 둔 뒤 새로고침해 최신 내용을 불러오세요.');
    window.showToast?.('저장했습니다.', 'success');
}

// 창을 닫기 전에 물을 일: 열어 둔 원문 칸(교안·교수안)에 넣지 않은 글, 끝나지 않은 브라우저 저장, 아래 AI 명령줄에서 기다리거나 아직 넣지 않은 결과(api.js),
// 아직 저장하지 않은 기본 학습 분량 채우기(lesson-volume.js. 닫으면 채우던 분량을 잃는다)
function hasUnsavedWork() {
    return !!(window.hasPendingRawEdit?.() || window.hasPendingGyosuanRaw?.() || window.isSavePending?.() || window.isAiResultPending?.() || window.isVolumeFilling?.());
}

// 고치던 원문은 먼저 넣고, 넣지 못한 글, 끝나지 않은 저장, 아직 넣지 않은 AI 명령줄 결과가 있으면 브라우저의 '사이트에서 나가시겠습니까?' 창을 띄운다(문구는 브라우저가 정한다)
function warnBeforeUnload(event) {
    if (window.isStateLoadFailed?.()) return; // 읽지 못한 동안은 아무것도 저장하지 않으므로 묻지 않는다
    const waiting = !!window.isSavePending?.(); // 미뤄 둔 저장(참고자료 칸)은 아래에서 바로 시작하므로 먼저 본다
    window.flushVisibleRawView?.();
    window.flushSaveStateSoon?.(); // 입력이 멈추기를 기다리던 저장을 바로 한다
    Promise.resolve(window.saveGyosuanRaw?.()).catch(err => console.warn('[저장] 교수안 원문을 넣지 못했습니다:', err));
    if (!waiting && !hasUnsavedWork()) return;
    event.preventDefault();
    event.returnValue = true; // 옛 Chrome·Edge(119 미만)도 묻게 한다
}

window.addEventListener('beforeunload', warnBeforeUnload);



window.saveAndGoHome = function () {

    const rawView = document.getElementById('raw-view');

    if (rawView && !rawView.classList.contains('hidden')) {

        saveRawContent();

    }

    location.hash = '#overview';

};



function handleRoute() {

    try {

        const hash = window.location.hash;

        const overview = document.getElementById('overview-container');

        const editor = document.getElementById('editor-container');

        if (!overview || !editor) {
            console.warn("handleRoute: DOM 요소가 아직 준비되지 않았습니다.");
            return;
        }

        if (hash.startsWith('#editor')) {

            const parts = hash.split('/');

            const subjectId = parts[1] || 'subject_1';

            const moduleId = parts[2];

            openEditor(subjectId, moduleId);

            overview.classList.add('hidden');

            editor.classList.remove('hidden');

            closeDetailPanel();

        } else {

            renderOverview();

            overview.classList.remove('hidden');

            editor.classList.add('hidden');

        }

    } catch (e) {

        console.error("Routing Error:", e);

        window.showAlert("화면 전환 중 오류가 발생했습니다. 데이터가 손상되었을 수 있습니다.");

    }

}




// --- Overview UI Rendering ---

function renderOverview() {

    const titleEl = document.getElementById('overview-course-title');

    if (titleEl) titleEl.innerText = globalState.courseTitle || '이름 없는 과정';
    window.renderCourseInfo?.(); // 예시 표시와 분야

    renderOverviewLNB();

    renderDiagram();

}



function renderOverviewLNB() {

    const list = document.getElementById('overview-lnb-list');

    if (!list) return;



    if (!Array.isArray(globalState.subjects) || globalState.subjects.length === 0) {

        list.innerHTML = `

                    <div class="text-center p-8 border-2 border-dashed border-white/10 rounded-xl text-textMuted text-sm">

                        <i class="ph-duotone ph-books text-3xl mb-2 opacity-50"></i><br>

                        교과가 없습니다.<br>상단 <i class="ph-bold ph-plus inline-block"></i> 버튼을 눌러 추가하세요.

                    </div>${typeof renderTrashFooter === 'function' ? renderTrashFooter() : ''}`;

        return;

    }



    list.innerHTML = renderCourseTimeBar() + globalState.subjects.map((subj, idx) => `

                <div class="bg-white/5 border border-white/10 rounded-xl overflow-hidden group hover:border-accent/50 transition-colors shadow-sm"
                     draggable="true" data-subj-idx="${idx}"
                     ondragstart="handleSubjDragStart(event, ${idx})"
                     ondragover="handleSubjDragOver(event)"
                     ondragenter="event.currentTarget.classList.add('border-accent','bg-accent/10')"
                     ondragleave="event.currentTarget.classList.remove('border-accent','bg-accent/10')"
                     ondrop="handleSubjDrop(event, ${idx})"
                     ondragend="document.querySelectorAll('#overview-lnb-list > div').forEach(d=>d.classList.remove('border-accent','bg-accent/10'))">

                    <div class="p-3.5 flex items-center justify-between cursor-pointer" onclick="openSubjectDetail('${subj.id}')">

                        <div class="flex items-center gap-3">

                            <input type="checkbox" class="subj-zip-cb w-4 h-4 accent-emerald-500 rounded cursor-pointer shrink-0" data-subj-id="${subj.id}" onclick="event.stopPropagation(); updateZipSelection()" title="ZIP 내보내기 선택">

                            <span class="flex items-center justify-center w-7 h-7 rounded-lg bg-accent/20 text-accent font-bold text-xs cursor-grab active:cursor-grabbing" title="드래그하여 순서 변경">${idx + 1}</span>

                            <h3 class="font-bold text-sm text-white truncate max-w-[140px]">${escapeHtml(subj.title)}</h3>

                        </div>

                        <div class="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">

                            <button onclick="event.stopPropagation(); location.hash='#editor/${subj.id}'" class="w-7 h-7 flex items-center justify-center rounded bg-white/10 hover:bg-accent text-white transition-colors" title="이 교과 편집하기">

                                <i class="ph-bold ph-pencil-simple text-xs"></i>

                            </button>

                            <button onclick="event.stopPropagation(); deleteSubject('${subj.id}')" class="w-7 h-7 flex items-center justify-center rounded bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white transition-colors" title="삭제">

                                <i class="ph-bold ph-trash text-xs"></i>

                            </button>

                        </div>

                    </div>

                    <div class="px-3.5 pb-3.5 pt-1 flex flex-wrap gap-2">

                        <span class="text-[0.6875rem] font-bold bg-white/10 text-textLight px-2 py-1 rounded-md flex items-center gap-1">

                            <i class="ph-fill ph-file-text text-accent"></i> ${subj.lessons?.length || 0} 차시

                        </span>

                        ${subjectOverviewChips(subj)}
                        ${subj.hasLevelTest ? `<span class="text-[0.6875rem] font-bold bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded-md flex items-center gap-1"><i class="ph-fill ph-crown"></i> 최종 평가</span>` : ''}

                    </div>

                </div>

            `).join('') + (typeof renderTrashFooter === 'function' ? renderTrashFooter() : '');

}

// ── F1-1: 교과 순서 변경 DnD 핸들러 ──
let _subjDragIdx = -1;
window.handleSubjDragStart = function (e, idx) {
    _subjDragIdx = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.4';
    setTimeout(() => { e.target.style.opacity = ''; }, 0);
};
window.handleSubjDragOver = function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
};
window.handleSubjDrop = function (e, dropIdx) {
    e.preventDefault();
    if (_subjDragIdx < 0 || _subjDragIdx === dropIdx) return;
    const arr = globalState.subjects;
    const [moved] = arr.splice(_subjDragIdx, 1);
    arr.splice(dropIdx, 0, moved);
    _subjDragIdx = -1;
    saveState().then(() => {
        renderOverviewLNB();
        renderDiagram();
    });
};



function createNewSubject() {

    const newId = 'subject_' + Date.now();

    if (!Array.isArray(globalState.subjects)) globalState.subjects = [];



    globalState.subjects.push({

        id: newId,

        title: '새로운 교과',

        description: '이 교과에서 다룰 핵심 내용을 설명해주세요.',

        namingConvention: '',

        referenceUrls: [],

        referenceText: '',

        autoSlide: false,

        lessonCount: 0,

        hasLevelTest: true,

        mainQuest: {

            id: 'mainQuest',

            title: '👑 최종 평가',

            description: '모든 차시의 실습을 종합한 최종 평가입니다.',

            status: 'waiting',

            content: null,

            images: {}

        },

        lessons: []

    });

    saveState().then(() => {
        renderOverviewLNB();
        renderDiagram();
        setTimeout(() => openSubjectDetail(newId), 50);
    });

}



function deleteSubject(id) {

    const subject = globalState.subjects.find(s => String(s.id) === String(id));
    if (!subject) return;
    showConfirm(`'${subject.title}' 교과를 휴지통으로 옮깁니다(차시 ${(subject.lessons || []).length}개 포함).\n교과 목록 아래 휴지통에서 30일 동안 되살릴 수 있습니다.`, () => {

        moveSubjectToTrash(subject, '삭제');
        globalState.subjects = globalState.subjects.filter(s => String(s.id) !== String(id));
        if (String(id) === String(currentSubjectId)) {
            currentSubjectId = null;
            courseData = [];
            closeLessonEditor();
        }

        saveState().then(() => {
            renderOverviewLNB();
            renderDiagram();
            closeDetailPanel();
            window.showToast?.(`'${subject.title}' 교과를 휴지통으로 옮겼습니다.`, 'success');
        });

    }, { okLabel: '휴지통으로 옮기기', title: '교과 삭제' });

}



function openSubjectDetail(id) {

    if (window.hasDragged) return;

    const subj = globalState.subjects.find(s => s.id === id);

    if (!subj) return;

    const panel = document.getElementById('overview-detail-panel');

    if (!panel) return;



    const lessonListHTML = (subj.lessons && subj.lessons.length > 0)

        ? subj.lessons.map((l, i) => `

                    <div class="flex gap-3 items-start mb-1 p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors group" onclick="location.hash='#editor/${subj.id}/${l.id}'" title="해당 차시 편집기로 이동">

                        <span class="text-xs font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded shrink-0">${i + 1}</span>

                        <div>

                            <div class="text-sm font-bold text-white group-hover:text-accent transition-colors">${escapeHtml(l.title)}</div>

                            <div class="text-xs text-textMuted line-clamp-1">${escapeHtml(l.description || '-')}</div>

                        </div>

                    </div>

                `).join('')

        : '<div class="text-xs text-textMuted bg-white/5 p-3 rounded">등록된 차시가 없습니다. 편집기에서 추가해주세요.</div>';



    panel.innerHTML = `

                <div class="p-5 border-b border-white/10 flex justify-between items-center bg-black/20 shrink-0">

                    <div class="flex items-center gap-2">

                        <i class="ph-duotone ph-info text-xl text-accent"></i>

                        <h2 class="font-bold text-lg text-white">교과 상세 정보</h2>

                    </div>

                    <button onclick="closeDetailPanel()" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-textMuted hover:text-white transition-colors">

                        <i class="ph-bold ph-x text-lg"></i>

                    </button>

                </div>

                

                <div class="p-6 flex-1 overflow-y-auto editor-scroll flex flex-col gap-6">

                    <div>

                        <label class="text-[0.6875rem] font-bold text-accent tracking-widest mb-1.5 block">교과 이름</label>

                        <div class="text-xl font-bold text-white">${escapeHtml(subj.title)}</div>

                    </div>

                    

                    <div>

                        <label class="text-[0.6875rem] font-bold text-accent tracking-widest mb-1.5 block">교과 설명</label>

                        <div class="text-sm text-textLight leading-relaxed bg-white/5 p-4 rounded-xl border border-white/5">

                            ${escapeHtml(subj.description)}

                        </div>

                    </div>

                    

                    <div class="border-t border-white/5 pt-6">

                        <div class="flex justify-between items-end mb-4">

                            <label class="text-[0.6875rem] font-bold text-accent tracking-widest">차시</label>

                            <span class="text-xs font-bold text-textMuted">총 ${subj.lessons?.length || 0}개</span>

                        </div>

                        <div class="bg-black/20 p-4 rounded-xl border border-white/5">

                            ${lessonListHTML}

                        </div>

                    </div>

                </div>

                

                <div class="p-5 border-t border-white/10 bg-black/20 shrink-0">

                    <button onclick="location.hash='#editor/${subj.id}'" class="w-full py-3.5 bg-gradient-to-r from-accent to-accentHover text-white font-bold rounded-xl shadow-[0_4px_15px_rgba(124,91,245,0.3)] hover:shadow-[0_6px_20px_rgba(124,91,245,0.5)] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">

                        <i class="ph-bold ph-pencil-simple text-lg"></i> 이 교과 편집기 열기

                    </button>

                </div>

            `;



    panel.classList.remove('translate-x-full');

}



function closeDetailPanel() {

    const panel = document.getElementById('overview-detail-panel');

    if (panel) panel.classList.add('translate-x-full');

}




// UI Helpers & Interactions

// ------------------------------------------------------------------------

function initHeaderScroll() {

    const header = document.getElementById('toolbar-scroll');

    if (!header) return;



    // 휠 스크롤 연동

    header.addEventListener('wheel', (e) => {

        if (e.deltaY !== 0) {

            e.preventDefault();

            header.scrollLeft += e.deltaY;

        }

    }, { passive: false });



    // 드래그 스크롤 연동

    let isDown = false;

    let startX;

    let scrollLeft;



    header.addEventListener('mousedown', (e) => {

        // 버튼 등을 클릭했을 때는 드래그 무시

        if (e.target.closest('button')) return;



        isDown = true;

        header.classList.add('cursor-grabbing');

        startX = e.pageX - header.offsetLeft;

        scrollLeft = header.scrollLeft;

    });



    header.addEventListener('mouseleave', () => {

        isDown = false;

        header.classList.remove('cursor-grabbing');

    });



    header.addEventListener('mouseup', () => {

        isDown = false;

        header.classList.remove('cursor-grabbing');

    });



    header.addEventListener('mousemove', (e) => {

        if (!isDown) return;

        e.preventDefault();

        const x = e.pageX - header.offsetLeft;

        const walk = (x - startX) * 1.5; // 드래그 속도 조절 (1.5배)

        header.scrollLeft = scrollLeft - walk;

    });

}

function toggleFolderDropdown() {
    const menu = document.getElementById('folder-dropdown-menu');
    if (menu) {
        menu.classList.toggle('hidden');
        menu.classList.toggle('flex');
    }
}

// v7.2: 모든 드롭다운 닫기 유틸리티
function closeAllDropdowns(exceptId) {
    document.querySelectorAll('[id$="-dropdown-menu"]').forEach(menu => {
        if (menu.id !== exceptId) {
            menu.classList.add('hidden');
            menu.classList.remove('flex');
        }
    });
}

// v7.2: 내보내기 드롭다운 (PDF → 통합 내보내기)
let _exportScope = 'current'; // 'current' | 'subject'
let _exportTabs = 'all'; // 현재 차시를 내보낼 탭 범위: 'all'(5개 탭 전체) | 'current'(지금 탭)

function toggleExportDropdown(event) {
    if (event) event.stopPropagation();
    // 다른 드롭다운 닫기
    closeAllDropdowns('export-dropdown-menu');
    const menu = document.getElementById('export-dropdown-menu');
    if (!menu) return;
    const wasHidden = menu.classList.contains('hidden');
    if (wasHidden) window.renderBackupImageMode?.();
    menu.classList.toggle('hidden');
    menu.classList.toggle('flex');
    // 형식 선택 섹션 리셋
    const fmtSection = document.getElementById('export-format-section');
    if (fmtSection) fmtSection.classList.add('hidden');
    // 위치 조정
    if (wasHidden) {
        const btn = document.getElementById('export-dropdown-btn');
        if (btn) {
            // 버튼이 왼쪽에 있으므로 버튼 왼쪽 끝에 맞추고, 화면 밖으로 나가지 않게 한다
            const rect = btn.getBoundingClientRect();
            menu.style.top = (rect.bottom + 4) + 'px';
            menu.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 4)) + 'px';
        }
    }
}
// 레거시 호환
function togglePdfDropdown(event) { toggleExportDropdown(event); }

function setExportScope(scope) { _exportScope = scope; }

function showExportFormatMenu() {
    const section = document.getElementById('export-format-section');
    if (section) section.classList.remove('hidden');
    document.getElementById('export-tab-range')?.classList.toggle('hidden', _exportScope !== 'current');
    syncExportTabs();
}

// 현재 차시를 내보낼 탭 범위(MD·PDF·HTML에 쓴다)
window.setExportTabs = function (range) {
    _exportTabs = range === 'current' ? 'current' : 'all';
    syncExportTabs();
};

function syncExportTabs() {
    document.querySelectorAll('[data-export-tabs]').forEach(button => {
        const on = button.dataset.exportTabs === _exportTabs;
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
        button.classList.toggle('bg-accent', on);
        button.classList.toggle('text-white', on);
        button.classList.toggle('text-white/70', !on);
    });
}

const exportTabIds = () => (_exportTabs === 'current' ? [currentLessonTab] : null);
const currentExportSubject = () => globalState.subjects.find(s => s.id === currentSubjectId);

// 현재 차시는 고른 탭 범위로, 현재 교과(또는 차시를 고르지 않았을 때)는 교과 전체를 문서 하나로 (lesson-export.js)
function exportLessonOrSubject(format) {
    const mod = _exportScope === 'subject' ? null : (typeof getEditingModule === 'function' ? getEditingModule() : null);
    if (mod) return window.exportLessonDocument(mod, format, exportTabIds());
    return window.exportSubjectDocument(currentExportSubject(), format);
}

// v7.5: 드롭다운 내보내기
window.executeDropdownExport = function (format) {
    toggleExportDropdown(); // 닫기
    switch (format) {
        case 'md':
            if (_exportScope === 'subject') exportSubjectToMD();
            else exportCurrentToMD();
            break;
        case 'pdf':
            exportLessonOrSubject('pdf');
            break;
        case 'slide':
            if (_exportScope === 'subject') window.downloadSubjectBundle();
            else openCurrentSlideStudio();
            break;
        case 'material':
            window.downloadLessonMaterial(_exportScope);
            break;
        case 'html':
            exportLessonOrSubject('html');
            break;
    }
}

// MD 내보내기
function exportCurrentToMD() {
    const mod = typeof getEditingModule === 'function' ? getEditingModule() : null;
    if (!mod) {
        // 차시 미선택 → 교과 전체로 자동 전환
        if (typeof exportSubjectToMD === 'function') return exportSubjectToMD();
        return window.showAlert('차시를 먼저 선택해주세요. (좌측 목록에서 차시 클릭)');
    }
    const tabs = lessonTabSources(mod, exportTabIds());
    if (!tabs.length) return window.showAlert(_exportTabs === 'current' ? '현재 탭에 내용이 없습니다.' : '내보낼 교안 내용이 없습니다.');
    // 차시·탭 표시를 넣어 '내보낸 교안 다시 불러오기'로 탭별로 되살린다(output-import.js)
    const blob = new Blob([lessonMarkdownExport(mod, tabs)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = lessonFileName(mod, 'md');
    a.click();
    URL.revokeObjectURL(url);
}

function exportSubjectToMD() {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return window.showAlert('교과를 먼저 선택해주세요.');
    const lessonList = subj.lessons || [];
    if (!lessonList.length) return window.showAlert('내보낼 차시가 없습니다.');
    lessonList.forEach(mod => {
        const tabs = lessonTabSources(mod);
        if (!tabs.length) return;
        const blob = new Blob([lessonMarkdownExport(mod, tabs)], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = lessonFileName(mod, 'md');
        a.click();
        URL.revokeObjectURL(url);
    });
    window.showToast(`📁 ${lessonList.length}개 차시 MD 파일 다운로드`, 'success');
}

// 외부 클릭 시 드롭다운 닫기
document.addEventListener('click', function (e) {
    const exportMenu = document.getElementById('export-dropdown-menu');
    const exportBtn = document.getElementById('export-dropdown-btn');
    if (exportMenu && !exportMenu.classList.contains('hidden') &&
        !exportMenu.contains(e.target) && exportBtn && !exportBtn.contains(e.target)) {
        exportMenu.classList.add('hidden');
        exportMenu.classList.remove('flex');
    }
});

// v7.5: 사이드바 체크박스 선택 관리
window.toggleSelectAllSubjects = function (checked) {
    document.querySelectorAll('.subj-zip-cb').forEach(cb => { cb.checked = checked; });
    updateZipSelection();
};

window.updateZipSelection = function () {
    const checked = document.querySelectorAll('.subj-zip-cb:checked');
    const btn = document.getElementById('zip-selected-btn');
    if (btn) {
        if (checked.length > 0) {
            btn.style.display = 'flex';
            btn.textContent = '';
            btn.innerHTML = `<i class="ph ph-file-zip"></i> ZIP (${checked.length}개)`;
        } else {
            btn.style.display = 'none';
        }
    }
    // 전체 선택 체크박스 동기화
    const allCb = document.getElementById('select-all-subjects');
    const totalCbs = document.querySelectorAll('.subj-zip-cb');
    if (allCb && totalCbs.length > 0) {
        allCb.checked = checked.length === totalCbs.length;
        allCb.indeterminate = checked.length > 0 && checked.length < totalCbs.length;
    }
};

window.exportSelectedToZip = async function () {
    if (typeof JSZip === 'undefined') return window.showAlert('JSZip을 불러오는 중입니다.');
    const checkedIds = [...document.querySelectorAll('.subj-zip-cb:checked')].map(cb => cb.dataset.subjId);
    if (checkedIds.length === 0) return window.showAlert('내보낼 교과를 선택해주세요.');
    const imageMode = takeBackupImageMode(); // 이 파일에 쓸 그림 담기. 골라 둔 '빼기'는 이 파일에만 쓴다(data-safety.js)

    const zip = new JSZip();
    let totalFiles = 0;
    const htmlJobs = []; // 차시마다 교안.html을 넣을 자리

    checkedIds.forEach(subjId => {
        const subj = globalState.subjects.find(s => String(s.id) === String(subjId));
        if (!subj) { console.warn('[ZIP] 교과 ID 매칭 실패:', subjId); return; }
        const subjName = (subj.title || '교과').replace(/[^\w가-힣\s]/g, '').trim();
        const subjFolder = zip.folder(subjName);

        const lessonList = subj.lessons || subj.modules || [];
        const usedNames = new Set();
        lessonList.forEach(mod => {
            if (mod.id === 'mainQuest') return;
            const modName = uniqueFileBase(lessonFileBase(mod, subj), usedNames);
            const modFolder = subjFolder.folder(modName);
            const tabs = mod.tabContents || {};
            const tabNames = { basicLearn: '01_기본학습', basicPrac: '02_기본실습', advLearn: '03_심화학습', advPrac: '04_심화실습', assessment: '05_학습이해도' };
            let hasTabContent = false;

            Object.entries(tabs).forEach(([tabId, content]) => {
                if (!content) return;
                modFolder.file(`${tabNames[tabId] || tabId}.md`, content);
                totalFiles++;
                hasTabContent = true;
            });

            // tabContents가 없으면 mod.content 사용 (단일 콘텐츠 모드)
            if (!hasTabContent && mod.content) {
                modFolder.file(`${modName}.md`, mod.content);
                totalFiles++;
            }

            lessonGyosuanFiles(mod).forEach(file => { modFolder.file(file.name, file.content); totalFiles++; });
            htmlJobs.push({ folder: modFolder, mod });

            if (mod.images && Object.keys(mod.images).length > 0) {
                const imgFolder = modFolder.folder('images');
                Object.entries(mod.images).forEach(([, b64], imgIdx) => {
                    const { ext, data } = zipImageParts(b64);
                    if (!data) return;
                    imgFolder.file(`img_${String(imgIdx + 1).padStart(2, '0')}.${ext}`, data, { base64: true });
                    totalFiles++;
                });
            }
        });

        const mq = subj.mainQuest || (lessonList).find(m => m.id === 'mainQuest');
        if (mq && mq.content) { subjFolder.file('레벨테스트.md', mq.content); totalFiles++; }
    });

    window.showToast?.('차시별 교안 HTML을 만드는 중입니다.', 'info');
    totalFiles += await addLessonHtmlToZip(htmlJobs);
    if (totalFiles === 0) return window.showAlert('내보낼 내용이 없습니다.');

    try {
        // 내보내기·백업 → 백업 ZIP으로 되살리기로 이 교과들을 되살린다. '함께'가 크기 한도에 걸리면 '따로·가볍게'로 다시 만든다(data-safety.js)
        const result = await buildBackupZip(zip, zip, subjectsBackupMeta(checkedIds), imageMode);
        const baseName = checkedIds.length === 1
            ? `${(globalState.subjects.find(s => String(s.id) === String(checkedIds[0]))?.title || '교과').replace(/[^\w가-힣\s]/g, '')}_교안`
            : `교안_${checkedIds.length}개교과`;
        saveAs(result.blob, backupFileName(baseName, result.mode));
        finishBackupDownload(result, { successText: `📦 ${totalFiles}개 파일이 ZIP으로 다운로드되었습니다.`, countsAsBackup: false }); // 교과 백업은 마지막 전체 백업 시각에 세지 않는다
    } catch (e) {
        console.error('[ZIP]', e);
        window.showAlert(isBackupTooBig(e) ? BACKUP_TOO_BIG_TEXT.subjects : 'ZIP 생성 오류: ' + e.message);
    }
};

// 차시마다 화면과 같은 모양의 교안.html(5개 탭, 그림 포함)을 ZIP에 넣는다. PDF는 인쇄로 만들므로 ZIP에는 HTML로 넣는다
async function addLessonHtmlToZip(jobs) {
    let added = 0;
    for (const { folder, mod } of jobs) {
        const doc = await window.lessonHtmlForZip(mod).catch(err => {
            console.warn('[ZIP] 교안 HTML을 만들지 못했습니다:', mod.title, err);
            return null;
        });
        if (!doc) continue;
        folder.file('교안.html', doc);
        added++;
    }
    return added;
}

// v7.5: 스마트 ZIP — 편집 중에는 지금 교과, 개요에서는 고른 교과(고르지 않으면 모든 교과)
window.smartZipExport = function () {
    // 개요의 체크 칸은 편집 화면에서 숨어 있을 뿐 남아 있으므로 편집 중에는 쓰지 않는다
    if (/^#editor/.test(window.location?.hash || '')) return exportAllToZip();
    const checked = document.querySelectorAll('.subj-zip-cb:checked');
    if (checked.length > 0) {
        exportSelectedToZip();
    } else {
        // 체크된 게 없으면 전체 교과 자동 선택 후 내보내기
        const allCbs = document.querySelectorAll('.subj-zip-cb');
        if (allCbs.length === 0) {
            // 사이드바에 체크박스가 없는 경우 (에디터 뷰) — exportAllToZip 사용
            exportAllToZip();
        } else {
            allCbs.forEach(cb => { cb.checked = true; });
            updateZipSelection();
            exportSelectedToZip();
        }
    }
};

// v7.5: 전체 커리큘럼 ZIP 내보내기 (단원/차시별 폴더 + 이미지)
window.exportAllToZip = async function () {
    if (typeof JSZip === 'undefined') {
        return window.showAlert('JSZip 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
    }
    const subj = globalState.subjects.find(s => String(s.id) === String(currentSubjectId));
    if (!subj) return window.showAlert('교과를 먼저 선택해주세요.');
    const lessonList = subj.lessons || subj.modules || [];
    if (!lessonList.length) return window.showAlert('내보낼 차시가 없습니다.');
    const imageMode = takeBackupImageMode(); // 이 파일에 쓸 그림 담기. 골라 둔 '빼기'는 이 파일에만 쓴다(data-safety.js)

    const zip = new JSZip();
    const subjectName = (subj.title || subj.name || '교과').replace(/[^\w가-힣\s]/g, '').trim();
    const rootFolder = zip.folder(subjectName);
    let totalFiles = 0;
    const usedNames = new Set();
    const htmlJobs = []; // 차시마다 교안.html을 넣을 자리

    lessonList.forEach(mod => {
        if (mod.id === 'mainQuest') return;
        const modName = uniqueFileBase(lessonFileBase(mod, subj), usedNames);
        const modFolder = rootFolder.folder(modName);

        // 각 탭의 마크다운 저장
        const tabs = mod.tabContents || {};
        const tabNames = { basicLearn: '01_기본학습', basicPrac: '02_기본실습', advLearn: '03_심화학습', advPrac: '04_심화실습', assessment: '05_학습이해도' };
        let hasTabContent = false;

        Object.entries(tabs).forEach(([tabId, content]) => {
            if (!content) return;
            const tabLabel = tabNames[tabId] || tabId;
            modFolder.file(`${tabLabel}.md`, content);
            totalFiles++;
            hasTabContent = true;
        });

        // tabContents가 없으면 mod.content 사용
        if (!hasTabContent && mod.content) {
            modFolder.file(`${modName}.md`, mod.content);
            totalFiles++;
        }

        // 전체 통합 마크다운
        const allContent = Object.entries(tabs)
            .filter(([, v]) => v)
            .map(([k, v]) => `# [${tabNames[k] || k}]\n\n${v}`)
            .join('\n\n---\n\n');
        if (allContent) {
            modFolder.file(`${modName}_전체.md`, allContent);
            totalFiles++;
        }

        lessonGyosuanFiles(mod).forEach(file => { modFolder.file(file.name, file.content); totalFiles++; });
            htmlJobs.push({ folder: modFolder, mod });

        // 이미지 폴더
        if (mod.images && Object.keys(mod.images).length > 0) {
            const imgFolder = modFolder.folder('images');
            Object.entries(mod.images).forEach(([imgId, b64], imgIdx) => {
                const { ext, data } = zipImageParts(b64);
                if (!data) return;
                imgFolder.file(`img_${String(imgIdx + 1).padStart(2, '0')}.${ext}`, data, { base64: true });
                totalFiles++;
            });
        }
    });

    // 레벨테스트 (mainQuest)
    const mainQuest = subj.mainQuest || lessonList.find(m => m.id === 'mainQuest');
    if (mainQuest && mainQuest.content) {
        rootFolder.file('레벨테스트.md', mainQuest.content);
        totalFiles++;
    }

    window.showToast?.('차시별 교안 HTML을 만드는 중입니다.', 'info');
    totalFiles += await addLessonHtmlToZip(htmlJobs);
    if (totalFiles === 0) return window.showAlert('내보낼 내용이 없습니다.');

    try {
        // 내보내기·백업 → 백업 ZIP으로 되살리기로 이 교과를 되살린다. '함께'가 크기 한도에 걸리면 '따로·가볍게'로 다시 만든다(data-safety.js)
        const result = await buildBackupZip(zip, zip, subjectsBackupMeta([subj.id]), imageMode);
        saveAs(result.blob, backupFileName(`${subjectName}_전체교안`, result.mode));
        finishBackupDownload(result, { successText: `📦 ${totalFiles}개 파일이 ZIP으로 다운로드되었습니다.`, countsAsBackup: false }); // 교과 백업은 마지막 전체 백업 시각에 세지 않는다
    } catch (e) {
        console.error('[ZIP Export]', e);
        window.showAlert(isBackupTooBig(e) ? BACKUP_TOO_BIG_TEXT.subjects : 'ZIP 생성 중 오류: ' + e.message);
    }
};

// 사이드바 차시 수 +/- 조절 (AI 차시 목차 생성에 쓴다)
window.adjustBatchCount = function (delta) {
    const input = document.getElementById('sidebar-batch-count');
    if (!input) return;
    input.value = Math.max(1, Math.min(30, (parseInt(input.value) || 5) + delta));
};

window.syncBatchCount = function (val) {
    const input = document.getElementById('sidebar-batch-count');
    if (input) input.value = Math.max(1, Math.min(30, parseInt(val) || 5));
};

// 참고 파일의 글자를 뽑는다: 차시 첨부(lesson-attachments.js)와 참고자료 탭(api.js importReferenceFiles)이 쓴다
// maxChars: 쓸 글자 수. 글 파일은 그만큼 앞부분만 읽고, PDF·PPTX는 그만큼 모이면 멈춘다(큰 파일도 다 읽지 않는다)
async function extractTextFromFile(file, { maxChars = Infinity } = {}) {

    const lower = file.name.toLowerCase();



    // .md, .txt — 텍스트 그대로

    if (lower.endsWith('.md') || lower.endsWith('.txt')) {

        return decodeTextBuffer(await readTextPrefix(file, maxChars));

    }



    // .pdf — pdf.js로 텍스트 추출

    if (lower.endsWith('.pdf')) {

        if (!window.pdfjsLib) throw new Error('PDF 파서(pdf.js)를 로드하지 못했습니다. 페이지를 새로고침 후 다시 시도하세요.');

        const buf = await file.arrayBuffer();

        // isEvalSupported: false — 조작된 PDF 글꼴로 이 페이지에서 코드가 실행되는 취약점(CVE-2024-4367)을 막는다. 키가 이 페이지 저장소에 있다
        const pdf = await window.pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;

        const pageTexts = [];

        const maxPages = Math.min(pdf.numPages, 100); // 페이지 수 상한

        for (let p = 1; p <= maxPages; p++) {

            const page = await pdf.getPage(p);

            const content = await page.getTextContent();

            const txt = content.items.map((it) => it.str).join(' ');

            if (txt.trim()) pageTexts.push(`[p.${p}] ${txt}`);

            if (pageTexts.reduce((sum, text) => sum + text.length, 0) >= maxChars) break; // 쓸 만큼 모였다

        }

        if (!pageTexts.length) return transcribeScannedPdf(pdf);
        return pageTexts.join('\n\n');

    }



    // .pptx — JSZip으로 슬라이드 XML에서 텍스트 추출

    if (lower.endsWith('.pptx')) {

        if (typeof JSZip === 'undefined') throw new Error('PPTX 파서(JSZip)를 로드하지 못했습니다.');

        const buf = await file.arrayBuffer();

        const zip = await JSZip.loadAsync(buf);

        const slideFiles = Object.keys(zip.files)

            .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))

            .sort((a, b) => {

                const na = parseInt(a.match(/slide(\d+)\.xml/)[1], 10);

                const nb = parseInt(b.match(/slide(\d+)\.xml/)[1], 10);

                return na - nb;

            });

        const parts = [];

        for (let i = 0; i < slideFiles.length; i++) {

            const xml = await zip.files[slideFiles[i]].async('string');

            // <a:t>…</a:t> 에서 텍스트 추출

            const matches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];

            const text = matches

                .map((m) => m.replace(/<[^>]+>/g, ''))

                .map((t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"))

                .filter(Boolean)

                .join(' ');

            const notes = await pptxSlideNotes(zip, slideFiles[i]);
            if (text.trim() || notes) parts.push(`[Slide ${i + 1}] ${text}${notes ? `\n[노트] ${notes}` : ''}`);
            if (parts.reduce((sum, part) => sum + part.length, 0) >= maxChars) break; // 쓸 만큼 모였다

        }

        return parts.join('\n\n');

    }



    // .docx — JSZip으로 본문 XML에서 문단별 텍스트 추출
    if (lower.endsWith('.docx')) {
        if (typeof JSZip === 'undefined') throw new Error('DOCX 파서(JSZip)를 로드하지 못했습니다.');
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const documentXml = zip.file('word/document.xml');
        if (!documentXml) throw new Error('DOCX 본문을 찾지 못했습니다.');
        const doc = new DOMParser().parseFromString(await documentXml.async('string'), 'application/xml');
        const paragraphs = Array.from(doc.getElementsByTagName('w:p'))
            .map(paragraph => Array.from(paragraph.getElementsByTagName('w:t')).map(node => node.textContent).join(''))
            .filter(text => text.trim());
        return paragraphs.join('\n\n');
    }

    // 이미지 — AI가 글자를 옮겨 적는다
    if (REF_IMAGE_EXTENSIONS.some(extension => lower.endsWith(extension))) return transcribeImageFile(file);

    // .ppt (레거시 바이너리) — 경고만

    if (lower.endsWith('.ppt')) {

        throw importStop('레거시 .ppt 형식은 지원되지 않습니다. .pptx로 저장 후 업로드하세요.');

    }



    throw importStop('지원하지 않는 파일 형식입니다.');

}


// ------------------------------------------------------------------------
// [신규] 텍스트 드래그 시 Floating AI 수정 툴팁 렌더링 로직 추가
// ------------------------------------------------------------------------
window.initSelectionHoverUI = function () {
    document.addEventListener('selectionchange', () => {
        // 막대 안의 링크 주소 칸에 입력하는 동안은 본문 선택이 풀려도 막대를 둔다
        if (document.getElementById('ai-floating-toolbar')?.contains(document.activeElement)) return;
        const renderView = document.getElementById('render-view');
        // 보기 모드가 아니거나, 마우스 클릭 유지중이면 무시
        if (!renderView || renderView.classList.contains('hidden')) {
            hideHoverTooltip();
            return;
        }

        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.toString().trim() === '') {
            hideHoverTooltip();
            return;
        }

        // 선택 영역이 render-view 내부인지 확인
        let node = sel.anchorNode;
        if (node && node.nodeType === 3) node = node.parentNode;
        if (!node || !renderView.contains(node)) {
            hideHoverTooltip();
            return;
        }
        // 아래 명령줄을 누르면 화면의 선택이 풀리므로 고른 글을 기억해 둔다(명령줄 위에 인용으로 보인다)
        rememberAISelection(sel.toString().trim());

        // 선택된 Range의 화면 좌표 계산
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        const tooltip = document.getElementById('ai-floating-toolbar');
        if (tooltip && rect.width > 0 && rect.height > 0) {
            clearTimeout(hoverTooltipHideTimer); // 숨기는 중이었으면 멈춘다(서식을 바꾼 뒤 다시 고를 때)
            tooltip.classList.remove('hidden'); // 너비를 재려면 먼저 보여야 한다
            if (window.positionFloatingToolbar) {
                window.positionFloatingToolbar(tooltip, rect);
            } else {
                tooltip.style.top = `${rect.top - 10}px`;
                tooltip.style.left = `${rect.left + rect.width / 2}px`;
            }
            window.refreshFormatToolbar?.();

            // 약간의 딜레이 후 opacity 전환하여 부드러운 페이드인
            setTimeout(() => {
                tooltip.classList.remove('opacity-0');
            }, 10);
        }
    });

    document.addEventListener('mousedown', (e) => {
        // 본문을 다시 누르면 기억한 선택을 버린다(새로 끌어 고르면 다시 기억한다)
        if (e.target.closest?.('#render-view')) window.clearAISelection?.();
        const tooltip = document.getElementById('ai-floating-toolbar');
        if (tooltip && !tooltip.contains(e.target)) {
            // 툴팁 외부 클릭 시 선택이 해제되므로 숨김 처리 보강
            hideHoverTooltip();
        }
    });
};

let hoverTooltipHideTimer = null;

function hideHoverTooltip() {
    const tooltip = document.getElementById('ai-floating-toolbar');
    if (tooltip && !tooltip.classList.contains('hidden')) {
        tooltip.classList.add('opacity-0');
        window.resetFormatToolbar?.();
        clearTimeout(hoverTooltipHideTimer);
        hoverTooltipHideTimer = setTimeout(() => {
            tooltip.classList.add('hidden');
        }, 200); // transition-opacity duration 후 hidden
    }
}

// 툴팁의 버튼 클릭 시 강제 모드 전환 빛 포커싱
window.activateHoverAIEdit = function () {
    hideHoverTooltip();

    // 선택된 텍스트 보관 및 UI 갱신(고를 때 이미 기억했지만, 그 사이 바뀌었을 수 있다)
    const sel = window.getSelection();
    rememberAISelection(sel ? sel.toString().trim() : '');

    // AI 커맨드 바가 숨겨져 있다면 강제로 보이게 전환 (로직 우회 등 대비)
    const cmdBar = document.getElementById('ai-command-bar');
    if (cmdBar) cmdBar.classList.remove('hidden');

    // api.js의 전역 함수 재활용하여 모드 전환
    if (typeof switchAIMode === 'function') switchAIMode('edit');

    // 입력창 포커싱
    const input = document.getElementById('ai-command-input');
    if (input) {
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' }); // 화면 가운데로 스크롤
    }
};

function rememberAISelection(text) {
    if (!text) return;
    window.currentCapturedSelection = text;
    const region = document.getElementById('ai-selected-text-display');
    const content = document.getElementById('ai-selected-text-content');
    if (region && content) {
        content.textContent = text;
        region.classList.remove('hidden');
    }
}

window.clearAISelection = function () {
    window.currentCapturedSelection = null;
    const displayRegion = document.getElementById('ai-selected-text-display');
    const displayContent = document.getElementById('ai-selected-text-content');
    if (displayRegion && displayContent) {
        displayContent.textContent = '';
        displayRegion.classList.add('hidden');
    }
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges(); // 브라우저 자체 선택 영역도 해제
};

// 즉시 시작
document.addEventListener('DOMContentLoaded', () => {
    initSelectionHoverUI();

    // v5.9: 스크롤-투-탑 버튼 표시/숨김
    const editorArea = document.getElementById('editor-content-area');
    const scrollBtn = document.getElementById('scroll-to-top-btn');
    if (editorArea && scrollBtn) {
        editorArea.addEventListener('scroll', () => {
            if (editorArea.scrollTop > 300) {
                scrollBtn.style.opacity = '1';
                scrollBtn.style.pointerEvents = 'auto';
            } else {
                scrollBtn.style.opacity = '0';
                scrollBtn.style.pointerEvents = 'none';
            }
        });
    }

    // v5.9: 어투 선택기 복원
    setInstructorTone(instructorTone);

    // 탭 교안을 기본으로 보여 준다. 교수안 항목을 고르면 강사뷰로 바뀐다
    window.viewMode = 'student';

    // v5.9: 키보드 단축키
    document.addEventListener('keydown', (e) => {
        // Escape: 모달 닫기
        if (e.key === 'Escape') {
            const modal = document.getElementById('custom-modal');
            if (modal && !modal.classList.contains('hidden')) modal.classList.add('hidden');
        }
        // Ctrl+S(맥은 Cmd+S): 고치던 원문 칸까지 넣고 저장한 뒤 실제 결과를 알린다(누르고 있어도 한 번만). 읽지 못한 동안은 saveNow가 막는다
        if (isSaveShortcut(e)) {
            e.preventDefault();
            if (!e.repeat) saveNow().catch(err => {
                console.error('[저장] Ctrl+S 저장 중 오류:', err);
                window.showToast?.('저장하지 못했습니다. 잠시 뒤 다시 Ctrl+S를 눌러 주세요.', 'error');
            });
        }
        // F1: 도움말
        if (e.key === 'F1') {
            e.preventDefault();
            window.showAlert('키보드 단축키:\n• Ctrl+S: 저장\n• Escape: 모달 닫기\n• F1: 이 도움말');
        }
    });
});
// ------------------------------------------------------------------------

// ------------------------------------------------------------------------


// Editor Functions & Config

// ------------------------------------------------------------------------

function openEditor(subjectId, targetModuleId = null) {

    currentSubjectId = subjectId;

    const subject = globalState.subjects.find(s => s.id === subjectId);

    if (subject) {

        document.getElementById('topic-input').value = subject.title;

        courseData = subject.lessons || [];

        // 5탭 마이그레이션: 기존 content → tabContents.basicLearn
        if (typeof migrateMonolithicContent === 'function') {
            courseData.forEach(l => migrateMonolithicContent(l));
        }

        // v5.9: 교과 전환 시 참고자료 UI 동기화
        if (typeof syncReferenceUI === 'function') syncReferenceUI();

        if (!subject.mainQuest) {

            subject.mainQuest = {

                id: 'mainQuest', title: '👑 최종 평가', description: '모든 차시의 실습을 종합한 최종 평가입니다.', status: 'waiting', content: null, images: {}

            };

        }

    } else {

        courseData = [];

        document.getElementById('topic-input').value = '새 교과';

    }

    currentEditingModuleId = null;

    document.getElementById('editor-content-area').innerHTML = `

                <div class="max-w-[800px] mx-auto p-12 flex flex-col items-center justify-center h-full text-center text-textMuted">

                    <i class="ph ph-file-text text-6xl mb-4 opacity-20"></i>

                    <h2 class="text-lg font-bold text-textMuted mb-2">교안 편집 영역</h2>

                    <p class="text-sm leading-relaxed">왼쪽 차시 목록에서 차시를 누르면<br>이곳에 교안이 열립니다.</p>

                </div>

            `;

    document.getElementById('ai-command-bar').classList.add('hidden');

    renderSidebar();



    if (targetModuleId) {

        const parsedId = targetModuleId === 'mainQuest' ? 'mainQuest' : parseInt(targetModuleId);

        setTimeout(() => viewModule(parsedId), 10);

    }

}



// CONTEXT_CORE moved to data.js



// API로 텍스트를 보내기 전, 보안 차단(WAF) 및 용량 초과를 방지하기 위한 정제 함수

// (안정화: 정규식 백트래킹 프리징 방어)

function cleanForAPI(text) {

    if (!text) return "";

    // 1. 이벤트 핸들러 제거

    let cleaned = text.replace(/on[a-z]+="[^"]*"/gi, "");

    // 2. Base64 이미지 데이터 치환 (백트래킹 방지 O(N) 정규식)

    cleaned = cleaned.replace(/data:image\/[^;]+;base64,[^"'\s\)>]+/gi, "[이미지 데이터 생략]");

    return cleaned;

}



// 코드를 다루는 차시(lessonCodeTopic)의 생성 지시에 붙인다. 실습 탭은 단계마다 입력할 코드를, 학습 탭은 설명 뒤 예제를 요구한다
function codeTopicPrompt(tabId) {
    const practice = tabId === 'basicPrac' || tabId === 'advPrac';
    return '\n\n[코드 예제 — 이 차시는 코드를 다룹니다]\n' + (practice
        ? '- 실습 단계마다 입력할 코드를 언어를 적은 코드 블록으로 보이고, 그 코드가 하는 일과 실행 결과(```text)를 함께 씁니다.'
        : '- 코드, 명령어, 쿼리를 설명하는 섹션은 개념 설명 바로 뒤에 예제 코드 블록을 둡니다. 설명만 있고 코드가 없는 코드 섹션을 만들지 않습니다.\n' +
          '- 예제마다 무엇을 하는 코드인지 → 코드 블록(```언어) → 핵심 줄 설명 → 실행 결과(```text) 순서로 씁니다.\n' +
          '- 학습 목표, 개요, 학습 후 체크리스트에는 코드를 넣지 않습니다.');
}

// 기본 학습의 분량 규칙(낭독 기준). 탭 생성·이어쓰기·교안 전체 생성이 같은 말로 준다(lesson-lint.js READ_CHARS_PER_MINUTE)
function basicLearnVolumeRule(minutes = BASIC_LEARN_MIN_MINUTES) {
    const perMinute = READ_CHARS_PER_MINUTE;
    const chars = (minutes * perMinute).toLocaleString('ko-KR');
    return `- 분량은 강사가 소리 내어 읽는 본문 글자 수(공백 포함)로 셉니다. 1분에 ${perMinute}자를 읽으므로 ${minutes}분은 ${chars}자 이상입니다.\n` +
        '- 코드 블록, 표, mermaid 다이어그램, 이미지 태그, 마크다운·HTML 기호는 분량에 들어가지 않습니다. 코드를 설명하는 문장은 분량에 들어갑니다.\n' +
        `- 각 ## 제목 끝에 (⏱ N분)을 적고 합계가 ${minutes}분 이상 ${minutes + BASIC_LEARN_LABEL_SLACK}분 이하가 되게 합니다. 완성된 탭에서 ## 섹션 하나의 본문은 (⏱ N분) × ${perMinute}자 이상입니다(예: (⏱ 60분)이면 ${(60 * perMinute).toLocaleString('ko-KR')}자 이상).\n` +
        '- 분량을 맞추려고 섹션을 생략하거나 요약하지 않고, 같은 내용을 되풀이해 늘리지 않습니다. 강의 대본처럼 말을 걸지 않고 교안 문체를 유지합니다.';
}

// 탭별 규칙 필터링 — 학습탭에 실습/평가/강사가이드 혼입 방지. 학습이해도는 코드제출 문항 형식을 따로 쓰므로 코드 예제 규칙을 뺀다
const TAB_RULE_EXCLUSIONS = {
    basicLearn: ['rubric_100', 'quiz_format', 'assessment_design'],
    advLearn: ['rubric_100', 'quiz_format', 'assessment_design'],
    basicPrac: ['rubric_100', 'quiz_format', 'assessment_design', 'learning_checklist'],
    advPrac: ['rubric_100', 'quiz_format', 'assessment_design', 'learning_checklist'],
    assessment: ['time_allocation', 'image_tags', 'mermaid_rules', 'learning_checklist', 'code_examples']
};

// 탭 전용 규칙 빌더 (buildFullRules 변형). 탭 생성과 탭 이어쓰기가 같은 규칙을 쓴다
// exclude: 이 작업에서 더 뺄 규칙(분량 보강은 문서 구조·시간·체크리스트·그림·mermaid 규칙을 뺀다) / fewshot: 서식 예시를 넣을지
function buildTabRules(tabId, keyConcepts, { exclude = [], fewshot = true } = {}) {
    const excludeKeys = [...(TAB_RULE_EXCLUSIONS[tabId] || []), ...exclude];
    const r = CONTEXT_CORE.rules;
    const ruleEntries = [
        ['priority_rules', r.priority_rules],
        ['element_definitions', r.element_definitions],
        ['glossary_terms', r.glossary_terms],
        ['markdown_structure', r.markdown_structure],
        ['image_tags', r.image_tags],
        ['tone', (function() {
            const preset = INSTRUCTOR_TONE_PRESETS.find(p => p.id === instructorTone);
            return preset ? preset.promptSuffix : r.tone;
        })()],
        ['heading_hierarchy', r.heading_hierarchy],
        ['semantic_icons', r.semantic_icons],
        ['indentation', r.indentation],
        ['body_lists', r.body_lists],
        ['numbering_usage', r.numbering_usage],
        ['text_emphasis', r.text_emphasis],
        ['code_examples', r.code_examples],
        ['evidence_based', r.evidence_based],
        ['table_html_style', r.table_html_style],
        ['spacing', r.spacing],
        ['formatting_workflow', r.formatting_workflow],
        ['time_allocation', r.time_allocation],
        ['content_design', r.content_design],
        ['learning_checklist', r.learning_checklist],
        ['assessment_design', r.assessment_design],
        ['mermaid_rules', r.mermaid_rules],
        ['rubric_100', r.rubric_100],
        ['korean_period', r.korean_period]
    ];

    let rules = ruleEntries
        .filter(([key]) => !excludeKeys.includes(key))
        .map(([, val]) => val)
        .filter(Boolean)
        .map(rule => `- ${rule}`)
        .join('\n');

    // 학습 탭 전용: 실습/평가 내용 금지 명시
    if (tabId === 'basicLearn' || tabId === 'advLearn') {
        rules += '\n\n[탭 범위 제한 — 절대 준수]\n' +
            '- 이 탭은 "학습" 전용입니다. 다음 내용을 절대 포함하지 마세요:\n' +
            '  * 실습 과제, 실습 가이드, 실습 예제\n' +
            '  * 평가 기준표, 채점 기준, 루브릭\n' +
            '  * 일일 퀘스트, 과제 제출\n' +
            '- 개념 설명, 이론, 사례 분석에만 집중하세요.';
    }

    if (keyConcepts && keyConcepts.length > 0) {
        rules += `\n- 다음 핵심 개념을 반드시 포함하여 교안을 구성하세요: ${keyConcepts.join(', ')}`;
    }

    // 메타 라벨 누출 방지 (요청#2): 작업용 표시가 학생 교안 본문에 노출되지 않도록
    rules += '\n\n[출력 금지 — 메타 라벨 누출 방지]\n' +
        '- 다음과 같은 내부 작업 라벨을 본문 헤딩이나 텍스트로 절대 출력하지 마세요: "[상세 교안]", "[현재 작업: ...]", "[기본 학습]", "[탭 범위 제한]", "교육용 일러스트", "[내부 프로세스]" 등.\n' +
        '- 이들은 집필 지시용 표시일 뿐이며, 학생이 읽는 교안 본문에 그대로 노출되어서는 안 됩니다.\n' +
        '- 교안은 실제 학습 내용(## 섹션 → 본문)으로 바로 시작하세요. 작업 설명·메타 헤더·따옴표로 감싼 라벨로 문서를 시작하지 마세요.';

    if (fewshot && CONTEXT_CORE.fewshot_cases && tabId !== 'assessment') {
        rules += '\n\n' + CONTEXT_CORE.fewshot_cases;
    }

    return rules;
}

function buildTaskContext(taskScope, additionalContext = "") {

    let systemInstruction = "";

    let userPrompt = "";

    // ── Phase 5 헬퍼: 전체 규칙 빌더 ──
    // Phase P0~P4의 모든 규칙을 하나의 문자열로 빌드
    // learning: 학습 탭(기본학습)을 쓰는 작업이면 체크리스트 규칙을 넣는다. 탭별 생성은 buildTabRules가 같은 규칙을 넣는다
    function buildFullRules(keyConcepts, learning = false) {
        const r = CONTEXT_CORE.rules;
        let rules = [
            r.priority_rules,
            r.element_definitions,
            r.glossary_terms,
            r.markdown_structure,
            r.image_tags,
            // v5.9: 강사 어투 동적 적용
            (function() {
                const preset = INSTRUCTOR_TONE_PRESETS.find(p => p.id === instructorTone);
                return preset ? preset.promptSuffix : r.tone;
            })(),
            r.heading_hierarchy,
            r.semantic_icons,
            r.indentation,
            r.body_lists,
            r.numbering_usage,
            r.text_emphasis,
            r.code_examples,
            r.evidence_based,
            r.table_html_style,
            r.spacing,
            r.formatting_workflow,
            r.time_allocation,
            r.content_design,
            learning && r.learning_checklist,
            r.mermaid_rules,
            r.rubric_100,
            r.korean_period,
            r.reference_policy
        ].filter(Boolean).map(rule => `- ${rule}`).join('\n');

        // 핵심개념 조건부 주입 (요청#3 선반영) + ## 최소치 동적 지정
        if (keyConcepts && keyConcepts.length > 0) {
            rules += `\n- 다음 핵심 개념을 반드시 포함하여 교안을 구성하세요: ${keyConcepts.join(', ')}`;
            rules += `\n- ## (Level 2) 헤딩 최소 개수: ${keyConcepts.length}개 (핵심 개념 각각이 최소 1개의 ## 섹션에 대응)`;
        }

        // Self-Correction 체크리스트 (Phase 5-2) + 정량 기준
        rules += '\n\n[자체 검증 체크리스트]\n' +
            '초안 작성 후 아래 8개 관점으로 자체 검토하고 최종본만 출력하세요:\n' +
            '1. 설계 의도 부합성: 차시 목표와 내용이 일관되는가?\n' +
            '2. 대상 수준 적합성: 학습자 수준에 맞는 용어와 설명인가?\n' +
            '3. 사실 기반 여부: 근거 없는 단정이나 추측이 포함되지 않았는가?\n' +
            '4. 분량 기준: 지시문에 분량 기준이 있으면 그 기준을 채웠는가? 기본 학습은 강사가 소리 내어 읽는 본문 글자(공백 포함, 코드 블록·표·그림·서식 기호 제외)로 셉니다. 기본 실습·심화는 필요한 항목만 포함되면 분량 무관.\n' +
            '5. 서식 준수: 헤딩 위계, 아이콘, 간격, 이미지 태그 규칙을 모두 지켰는가?\n' +
            '6. 구조 연결성: 학습목표→개요→핵심→실습→심화의 흐름이 자연스러운가? 학습 목표가 최상단, 그다음 개요인가?\n' +
            '7. 용어 일관성: 과정/교과/차시/레벨테스트/기본실습 등 glossary 정의와 일치하는가?\n' +
            '8. 서식 워크플로우 준수: 파싱→타이포매핑→아이콘주입→들여쓰기→간격적용→톤적용 순서를 따랐는가?';

        // 메타 라벨 누출 방지 (요청#2): 작업용 표시가 학생 교안 본문에 노출되지 않도록
        rules += '\n\n[출력 금지 — 메타 라벨 누출 방지]\n' +
            '- 다음과 같은 내부 작업 라벨을 본문 헤딩이나 텍스트로 절대 출력하지 마세요: "[상세 교안]", "[현재 작업: ...]", "[기본 학습]", "[탭 범위 제한]", "교육용 일러스트", "[내부 프로세스]" 등.\n' +
            '- 이들은 집필 지시용 표시일 뿐이며, 학생이 읽는 교안 본문에 그대로 노출되어서는 안 됩니다.\n' +
            '- 교안은 실제 학습 내용(# 제목 → ## 섹션 → 본문)으로 바로 시작하세요. 작업 설명·메타 헤더·따옴표로 감싼 라벨로 문서를 시작하지 마세요.';

        // Few-Shot 예시 주입 (Phase 6) — 토큰 예산에 따라 조건부 제어 가능
        if (CONTEXT_CORE.fewshot_cases) {
            rules += '\n\n' + CONTEXT_CORE.fewshot_cases;
        }

        return rules;
    }
    // RAG Lite: 현재 교과의 전체 커리큘럼 목차를 동적 생성 (필요 시에만 주입)
    function getCurriculumOutline() {
        const subj = globalState.subjects.find(s => s.id === currentSubjectId);
        if (!subj || !Array.isArray(subj.lessons) || subj.lessons.length === 0) return '';
        const outline = subj.lessons.map((m, i) => {
            const marker = m.id === 'mainQuest' ? '[MQ]' : `[${i + 1}차시]`;
            return `${marker} ${m.title} - ${m.description || '(설명 없음)'}`;
        }).join('\n');
        return `\n\n[전체 커리큘럼 목차 (맥락 참고용)]\n교과명: ${subj.title}\n${outline}\n\n위 목차의 앞뒤 흐름을 참고하되, 다른 차시와 핵심 내용이 중복되지 않도록 해주세요.`;
    }

    // Thinking Process 프리픽스 (Phase 5-3)
    const thinkingPrefix = '[내부 프로세스] 입력분석→의도검증→구조매핑→집필→자체검증 순서로 수행하세요.\n\n';



    switch (taskScope) {

        case 'blueprint':

            const sidebarLessonCount = parseInt(document.getElementById('sidebar-batch-count')?.value) || 5;
            const totalLessons = sidebarLessonCount; // 사용자가 설정한 차시 수를 그대로 사용
            systemInstruction = `${CONTEXT_CORE.personas.orchestrator}\n[규칙]\n- ${CONTEXT_CORE.rules.json_only}\n- 차시 수는 반드시 정확히 ${totalLessons}개로 구성하세요. (사용자가 ${totalLessons}차시를 요청했습니다. 더 적게 생성하지 마세요.)`;

            userPrompt = `[현재 작업: 목차 설계]\n주제: ${additionalContext}\n- 생성할 차시 수: ${totalLessons}개 (반드시 이 수만큼 생성)${getReferenceContext(4000)}`;

            break;

        case 'module':

            systemInstruction = `${CONTEXT_CORE.personas.instructor}\n[작성 규칙]\n${buildFullRules(additionalContext.keyConcepts, true)}`;

            // F2: 분할 생성 지시
            systemInstruction += '\n\n[분량 관리]\n' +
                '- 교안 전체를 한 번에 작성하세요. 단, 출력이 길어져 중간에 잘릴 경우를 대비하여 다음 규칙을 따르세요.\n' +
                '- 모든 섹션을 완전히 작성한 경우: 문서의 맨 마지막에 <!-- END -->를 붙이세요.\n' +
                '- 출력 한도에 도달하여 교안이 미완성인 경우: 자연스러운 문단/섹션 끝에서 멈추고 <!-- CONTINUE -->를 붙이세요. 문장 중간이나 코드 블록 안에서 끊지 마세요.';
            systemInstruction += '\n\n[기본 학습 분량 — 낭독 기준, 절대 준수]\n' + basicLearnVolumeRule(additionalContext.targetMinutes || BASIC_LEARN_MIN_MINUTES) + '\n- 출력 한도 안에서 학습 목표부터 모든 섹션을 끝까지 쓰는 것을 먼저 지킵니다. 핵심 내용 섹션마다 설명 글을 최소 2,500자 쓰고, 목표 분량에 못 미친 핵심 내용 섹션은 생성 뒤 섹션별로 이어서 보강합니다.';



            if (additionalContext.uploadedMdContent) {

                const safeMd = cleanForAPI(additionalContext.uploadedMdContent);

                userPrompt = `${thinkingPrefix}[현재 작업: 사용자 제공 문서 기반 교안 재구성]\n모듈명: ${additionalContext.title}\n설명: ${additionalContext.description}\n\n[사용자 제공 원본 마크다운 데이터]\n${safeMd}\n\n위 원본 데이터를 철저히 분석하여, 제공된 내용을 바탕으로 우리 교안 규격(1.학습 목표, 2.개요, 3.핵심 내용, 4.실습/예제, 5.심화) 순서에 맞게 다듬고 재구성해 주세요. 원본의 핵심 내용과 의도를 절대 누락하지 말고 최우선으로 반영해야 합니다.`;

            } else {

                userPrompt = `${thinkingPrefix}[현재 작업: 상세 교안 작성]\n모듈명: ${additionalContext.title}\n설명: ${additionalContext.description}`;

            }

            // 코드를 다루는 차시는 설명마다 예제 코드 블록을 함께 쓰게 한다
            if (additionalContext.codeTopic) userPrompt += codeTopicPrompt('basicLearn');

            // 커리큘럼 목차 맥락 주입 (앞뒤 흐름 유지 + 중복 방지)
            userPrompt += getCurriculumOutline();
            // v5.9: 참고자료 컨텍스트 주입
            userPrompt += getReferenceContext(8000);



            if (additionalContext.hasMainQuest) {

                systemInstruction += `\n- 차시 내용의 마지막(5번 항목 아래)에는 반드시 배운 내용을 실습할 수 있는 '# ⚔️ 일일 퀘스트 (실습 과제)' 항목을 만들어주세요.`;

                userPrompt += `\n\n[문맥 연동 정보]\n현재 교과의 '메인 퀘스트'가 기획되어 있습니다. 생성할 일일 퀘스트는 아래 메인 퀘스트를 달성하기 위한 징검다리 역할을 해야 합니다.\n- 메인 퀘스트: ${additionalContext.mainQuestText}`;



                if (additionalContext.otherLessonsText) {

                    userPrompt += `\n\n- 다른 차시들의 기존 퀘스트 요약:\n${additionalContext.otherLessonsText}\n\n위 내용들과 중복되지 않고 자연스러운 학습 맥락이 이어지도록 일일 퀘스트를 구성하세요.`;

                }

            } else {

                systemInstruction += `\n- 현재 메인 퀘스트가 설계되지 않았으므로 일일 퀘스트를 절대 생성하지 마세요. 대신 문서의 제일 마지막 줄에 정확히 <!-- 메인 퀘스트가 아직 작성되지 않았습니다. --> 라는 HTML 주석 구문을 하나 추가해 주세요.`;

            }

            break;

        // ── F2: 분할 생성 이어쓰기 케이스 ──
        case 'module_continue':
            systemInstruction = `${CONTEXT_CORE.personas.instructor}\n[작성 규칙]\n${buildFullRules(additionalContext.keyConcepts, true)}`;
            systemInstruction += '\n\n[이어쓰기 규칙]\n' +
                '- 아래 "이전 작성 내용"의 마지막 부분부터 이어서 작성하세요.\n' +
                '- 이전에 작성한 내용을 절대 반복하지 마세요. 중복 헤딩이나 중복 문단을 생성하면 안 됩니다.\n' +
                '- 이전 내용의 마지막 헤딩/문단을 확인하고, 그 다음 섹션부터 자연스럽게 연결하세요.\n' +
                '- 교안 구조에서 아직 작성되지 않은 남은 섹션을 모두 완성하세요.\n' +
                '- 아래 분량 기준을 채울 때까지 앞 청크와 같은 깊이로 이어 쓰고, 남은 섹션을 요약하지 않습니다.\n' + basicLearnVolumeRule(additionalContext.targetMinutes || BASIC_LEARN_MIN_MINUTES) + '\n' +
                '- 모든 내용을 마쳤으면 문서 끝에 <!-- END -->를 붙이세요. 아직 더 남았으면 자연스러운 문단/섹션 끝에서 멈추고 <!-- CONTINUE -->를 붙이세요. 문장 중간이나 코드 블록 안에서 끊지 마세요.';

            if (additionalContext.hasMainQuest) {
                systemInstruction += `\n- 차시 내용의 마지막(5번 항목 아래)에는 반드시 '# ⚔️ 일일 퀘스트 (실습 과제)' 항목을 만들어주세요.`;
            }

            userPrompt = `[현재 작업: 교안 이어쓰기 (${additionalContext.chunkIndex}번째 연속)]\n모듈명: ${additionalContext.title}\n설명: ${additionalContext.description}\n\n[이전 작성 내용 — 여기서부터 이어쓰세요]\n${additionalContext.previousContent}`;
            if (additionalContext.codeTopic) userPrompt += codeTopicPrompt('basicLearn');
            break;

        case 'main_quest':

            systemInstruction = `${CONTEXT_CORE.personas.orchestrator}\n[작성 규칙]\n${buildFullRules()}`;

            userPrompt = `${thinkingPrefix}[현재 작업: 메인 퀘스트(교과 최종 과제) 설계]\n다음은 이 교과에 속한 차시들과 일일 퀘스트 내용입니다. 이를 모두 종합하여, 학습자가 교과 과정을 마스터했는지 평가할 수 있는 흥미로운 '메인 퀘스트' 스토리를 작성해주세요.\n\n차시 정보:\n${additionalContext}`;

            break;

        case 'quiz':

            systemInstruction = `${CONTEXT_CORE.personas.instructor}\n[규칙]\n- ${CONTEXT_CORE.rules.quiz_format}`;

            const compressedText = additionalContext.length > 3000 ? additionalContext.substring(0, 3000) + "...(중략)" : additionalContext;

            userPrompt = `[현재 작업: 퀴즈 출제]\n다음 교안 내용을 바탕으로 퀴즈를 작성하세요:\n\n${cleanForAPI(compressedText)}`;

            break;

        case 'edit':

            systemInstruction = `${CONTEXT_CORE.personas.assistant}\n[규칙]\n- ${CONTEXT_CORE.rules.concise_edit}`;

            userPrompt = `[현재 작업: 텍스트 부분 수정]\n문맥:\n${cleanForAPI(additionalContext.context)}\n\n원본 텍스트:\n${additionalContext.selectedText}\n\n요청사항:\n${additionalContext.command}`;

            break;

        // ─── 병합 재생성 ───
        case 'merge':
            systemInstruction = `${CONTEXT_CORE.personas.instructor}\n[작성 규칙]\n${buildFullRules(undefined, true)}\n\n[병합 재생성 지시]\n- 아래 제공되는 여러 차시의 교안 내용을 하나의 통합된 교안으로 재구성하세요.\n- 중복되는 내용은 제거하고, 논리적 흐름으로 재배열하세요.\n- 모든 핵심 개념을 누락 없이 포함하세요.`;
            userPrompt = `${thinkingPrefix}[현재 작업: 교안 병합 재생성]\n병합 대상 차시: ${additionalContext.titles.join(', ')}\n\n[원본 차시 내용들]\n${additionalContext.mergedContext}`;
            break;

        // ─── 탭별 교안 생성 ───
        case 'tab_content': {
            const learnMinutes = additionalContext.targetMinutes || BASIC_LEARN_MIN_MINUTES; // 기본 학습의 낭독 목표(분)
            systemInstruction = `${CONTEXT_CORE.personas.instructor}\n[작성 규칙]\n${buildTabRules(additionalContext.tabId, additionalContext.keyConcepts)}`;

            // 분할 생성 지시 — 긴 탭(특히 기본 학습 480분)이 중간에 잘리는 것을 방지
            systemInstruction += '\n\n[분량 관리]\n' +
                '- 탭 내용을 한 번에 작성하세요. 단, 출력이 길어져 중간에 잘릴 경우를 대비하여 다음 규칙을 따르세요.\n' +
                '- 모든 섹션을 완전히 작성한 경우: 문서의 맨 마지막에 <!-- END -->를 붙이세요.\n' +
                '- 출력 한도에 도달하여 미완성인 경우: 자연스러운 문단/섹션 끝에서 멈추고 <!-- CONTINUE -->를 붙이세요. 문장 중간이나 코드 블록 안에서 끊지 마세요.';

            const tabPrompts = {
                basicLearn: '이 교안의 "기본 학습" 영역을 작성하세요. 반드시 [1.학습 목표] → [2.개요] → [3.핵심 내용(개념 정의, 이론 설명, 예시, 사례 분석)] 순서로 구성합니다. 학습 목표가 교안 최상단에 오고, 그 다음 개요가 옵니다. 실습 과제, 평가 루브릭, 별도 강사 가이드 섹션은 다른 탭에서 작성하므로 여기서는 포함하지 마세요. 초보자도 이해할 수 있는 수준으로 단계적으로 설명하세요.\n' +
                    `[시간 배분 — 이 탭 하나가 곧 ${learnMinutes}분 본과정입니다]\n` +
                    `이 "기본 학습" 탭 하나가 강사가 소리 내어 읽으며 강의할 때 ${learnMinutes}분이 걸리는 완결된 본 교안입니다. 다른 탭(실습/심화/평가)에 의존하지 말고, 이 탭만으로 ${learnMinutes}분 학습 내용이 끝까지 이어지도록 작성하세요.\n` +
                    '시간을 채우기 위해 각 개념을 충분히 깊고 상세하게, 다양한 예시·비유·단계적 설명으로 풀어쓰세요. 개념을 나열만 하지 말고 "왜 그런지"까지 설명하세요.\n\n' +
                    '[분량 규칙 — 낭독 기준, 절대 준수]\n' + basicLearnVolumeRule(learnMinutes) + '\n' +
                    '- ## 대주제 최소 8개, ### 소주제 최소 16개.\n' +
                    '- 각 소주제마다 Key Concept 불릿 최소 6개, 구체적 사례(게임명 명시) 최소 2개, 본문 설명 단락 최소 3개.\n' +
                    '- 표(Table) 최소 6개, mermaid 다이어그램 최소 3개. 표와 다이어그램은 설명 문장을 대신하지 않습니다.\n' +
                    '- 출력 한도 안에서 학습 목표부터 "## ✅ 학습 후 체크리스트"까지 모든 섹션을 끝까지 쓰는 것을 먼저 지킵니다. 섹션마다 설명 글을 최소 2,500자 쓰고, 출력 한도가 남으면 섹션을 더 깊게 씁니다. 목표 분량에 못 미친 섹션은 생성 뒤 섹션별로 이어서 보강합니다.\n\n' +
                    '[분할 출력 규칙 — 절대 준수]\n' +
                    '- 내용이 매우 길어 한 번에 다 출력하지 못할 수 있습니다.\n' +
                    '- 모든 섹션을 끝까지 완성했다면 문서 맨 끝에 <!-- END -->를 붙이세요.\n' +
                    '- 출력 한도에 도달하면 자연스러운 문단/섹션 끝에서 멈추고 <!-- CONTINUE -->를 붙이세요. 문장 중간이나 코드 블록 안에서 끊지 마세요.',
                basicPrac: '이 교안의 "기본 실습" 영역을 작성하세요. 학생이 핵심 내용을 직접 체험하는 실습 과제를 설계하세요.\n' +
                    '[시간 배분 — 이 탭: 90~120분]\n' +
                    '이 탭은 "기본 학습" 본과정을 보완하는 독립 기본 실습 모듈로, 90~120분 분량입니다.\n' +
                    '각 ## 제목 끝에 (⏱ N분)을 명시하고, 합계가 90~120분이 되게 하세요.\n\n' +
                    '[분량 규칙 — 절대 준수]\n' +
                    '- 순수 텍스트(마크다운 서식 제외) 최소 8,000자 이상.\n' +
                    '- 마크다운 줄 수 기준 최소 250줄 이상.\n' +
                    '- ## 대주제(실습 파트) 최소 3개.\n' +
                    '- 짧은 교안은 불합격 처리됩니다.\n\n' +
                    '[필수 포함 항목]\n' +
                    '- 실습 목표 및 개요 (기본학습에서 배운 핵심 개념과 연결)\n' +
                    '- 실습 과제 최소 3개 (각 과제에 아래 항목 모두 포함):\n' +
                    '  * 과제 제목, 과제 설명 (상세하게)\n' +
                    '  * 단계별 수행 절차 (Step-by-Step, 최소 5단계)\n' +
                    '  * ⏱️ 예상 소요시간, 🎚️ 난이도(초급)\n' +
                    '  * 예시 결과물 또는 기대 산출물 설명\n' +
                    '  * 평가 기준 (체크리스트 또는 루브릭)\n' +
                    '- 실습 중 자주 하는 실수 및 해결 가이드',
                advLearn: '이 교안의 "심화 학습" 영역을 작성하세요. 기본 학습의 개념을 더 깊이 파고들어 고급 이론, 업계 사례, 실무적 분석을 제공하세요. 실습, 평가, 강사 가이드는 다른 탭에서 작성하므로 여기서는 절대 포함하지 마세요.\n' +
                    '[시간 배분 — 이 탭: 90~120분]\n' +
                    '이 탭은 "기본 학습" 본과정 이후 진행하는 독립 심화 학습 모듈로, 90~120분 분량입니다.\n' +
                    '각 ## 제목 끝에 (⏱ N분)을 명시하고, 합계가 90~120분이 되게 하세요.\n\n' +
                    '[분량 규칙 — 절대 준수]\n' +
                    '- 순수 텍스트(마크다운 서식 제외) 최소 12,000자 이상.\n' +
                    '- 마크다운 줄 수 기준 최소 350줄 이상.\n' +
                    '- ## 대주제 최소 3개, ### 소주제 최소 6개.\n' +
                    '- 각 소주제마다 심화 분석, 실무 사례, 전문가 관점을 포함.\n' +
                    '- 짧은 교안은 불합격 처리됩니다.',
                advPrac: '이 교안의 "심화 실습" 영역을 작성하세요. 도전적이고 창의적인 프로젝트형 과제를 설계하세요.\n' +
                    '[시간 배분 — 이 탭: 90~120분]\n' +
                    '이 탭은 "기본 학습" 본과정을 보완하는 독립 심화 실습 모듈로, 90~120분 분량입니다.\n' +
                    '각 ## 제목 끝에 (⏱ N분)을 명시하고, 합계가 90~120분이 되게 하세요.\n\n' +
                    '[분량 규칙 — 절대 준수]\n' +
                    '- 순수 텍스트(마크다운 서식 제외) 최소 8,000자 이상.\n' +
                    '- 마크다운 줄 수 기준 최소 250줄 이상.\n' +
                    '- ## 대주제(실습 파트) 최소 3개.\n' +
                    '- 짧은 교안은 불합격 처리됩니다.\n\n' +
                    '[필수 포함 항목]\n' +
                    '- 심화 실습 목표 및 개요 (심화학습에서 배운 고급 개념과 연결)\n' +
                    '- 프로젝트형 실습 과제 최소 2개 (각 과제에 아래 항목 모두 포함):\n' +
                    '  * 프로젝트 제목, 시나리오 설명 (실무 상황 기반)\n' +
                    '  * 단계별 수행 절차 (Step-by-Step, 최소 7단계)\n' +
                    '  * ⏱️ 예상 소요시간, 🎚️ 난이도(중급~고급)\n' +
                    '  * 예시 결과물 또는 기대 산출물 설명\n' +
                    '  * 평가 기준 (100점 만점 루브릭: S/A/B/C/F)\n' +
                    '- 도전 과제 또는 보너스 미션 1개\n' +
                    '- 팀 프로젝트 진행 시 역할 분배 가이드',
                assessment: '이 교안의 "학습 이해도 점검" 영역을 작성하세요.\n' +
                    '[시간 배분 — 이 탭: 30~60분]\n' +
                    '이 탭은 "기본 학습" 본과정의 이해도를 점검하는 독립 평가 모듈로, 30~60분 분량입니다.\n\n' +
                    '[형식 규칙 — 반드시 준수]\n' +
                    '1. **문제 10개 이상**: 학습 목표가 10개보다 많으면 목표 수만큼 내어 모든 학습 목표를 1문제 이상 묻습니다. 유형은 밴드에 맞춥니다(L1 객관식·단답식, L2 서술형·코드제출, L3 파일제출). 객관식은 ①②③④⑤ 5개의 선택지를 주고 정답 1개 또는 복수정답으로 냅니다.\n' +
                    '2. 복수정답 문제는 제목에 "(복수정답)" 라벨 표기.\n' +
                    '3. 각 문제에 **힌트** 1줄 제공 (예: "💡 힌트: ○○ 섹션을 복습하세요").\n' +
                    '4. **정답 표기**: 정답 선택지는 <span style="color: #22c55e; font-weight: bold;"> 태그로 감싸서 녹색 강조.\n' +
                    '5. 각 문제 하단에 **해설** 포함.\n' +
                    '6. 각 문제 제목(### 문제 N. 제목) 바로 다음 줄에 "학습 목표 번호 · 밴드 · 유형"을 적으세요. 예: 학습 목표 1 · 밴드 L1 · 객관식. 밴드는 L1(수업과 같은 상황), L2(같은 구조를 다른 맥락에 적용), L3(요구사항만 제시) 중 하나입니다.\n' +
                    '7. 마지막에 **채점 기준표**를 100점 만점 루브릭(S/A/B/C/F)으로 작성.\n' +
                    '   - [필수] 채점 기준표는 반드시 인라인 스타일 HTML <table>로 출력하세요. 마크다운 파이프 표(| ... |)나 줄글로 작성하지 마세요.\n' +
                    '   - 표 구조: 1열 "등급"(S/A/B/C/F), 2열 "점수 범위"(예: 90~100점), 3열 "평가 기준 설명". 5개 등급을 각각 한 행으로 작성.\n' +
                    '   - 표 양식 예시: <table style="border-collapse: collapse; width: 100%;"><thead><tr><th style="border: 1px solid black; padding: 10px; background-color: #f2f2f2; text-align: center; width: 100px;">등급</th><th style="border: 1px solid black; padding: 10px; background-color: #f2f2f2; text-align: center; width: 140px;">점수 범위</th><th style="border: 1px solid black; padding: 10px; background-color: #f2f2f2; text-align: center;">평가 기준</th></tr></thead><tbody><tr><td style="border: 1px solid black; padding: 10px; font-weight: bold; text-align: center;">S</td><td style="border: 1px solid black; padding: 10px; text-align: center;">90~100점</td><td style="border: 1px solid black; padding: 10px; text-align: left;">설명...</td></tr></tbody></table>\n\n' +
                    '[단락 구분 규칙 — 절대 준수]\n' +
                    '- 각 문제는 반드시 `---` 수평선으로 구분하세요.\n' +
                    '- 문제 번호는 `### 문제 N.` 형식(H3 제목)으로 시작하세요.\n' +
                    '- 객관식 선택지는 각 줄에 하나씩 작성하세요 (① ② ③ ④ ⑤).\n' +
                    '- 힌트, 정답, 해설은 각각 별도 줄에 빈 줄로 구분하세요.\n' +
                    '- 복수정답인 경우 정답을 한 줄에 횡으로 나열하세요: `✅ **정답:** ①, ②, ④`\n' +
                    '- 단일정답인 경우: `✅ **정답:** ③`\n' +
                    '- 구조 예시:\n' +
                    '```\n### 문제 1. 제목\n학습 목표 1 · 밴드 L1 · 객관식\n\n① 선택지1\n② 선택지2\n③ 선택지3\n④ 선택지4\n⑤ 선택지5\n\n💡 **힌트:** 힌트 내용\n\n✅ **정답:** ②\n\n📝 **해설:** 해설 내용\n\n---\n\n### 문제 2. 제목\n학습 목표 2 · 밴드 L2 · 서술형\n\n문제 상황과 요구사항\n\n💡 **힌트:** 힌트 내용\n\n✅ **정답:** 모범 답안\n\n📏 **채점 기준:** 요소 (점수); 요소 (점수)\n\n📝 **해설:** 해설 내용\n\n---\n```'
            };
            const tabInstruction = tabPrompts[additionalContext.tabId] || tabPrompts.basicLearn;

            userPrompt = `${thinkingPrefix}[현재 작업: 탭별 교안 작성 — ${additionalContext.tabLabel}]\n모듈명: ${additionalContext.title}\n설명: ${additionalContext.description}\n\n[탭 작성 지시]\n${tabInstruction}` +
                (additionalContext.codeTopic && additionalContext.tabId !== 'assessment' ? codeTopicPrompt(additionalContext.tabId) : '');
            userPrompt += getCurriculumOutline();
            userPrompt += getReferenceContext(8000);

            if (additionalContext.otherTabContents) {
                userPrompt += '\n\n[다른 탭 내용 요약 — 중복 방지 참고용]\n' + additionalContext.otherTabContents;
            }
            break;
        }

        // ─── 탭 분할 생성 이어쓰기 (긴 탭, 특히 기본 학습 480분이 잘리지 않도록) ───
        case 'tab_content_continue': {
            // 1청크와 같은 탭 규칙을 준다. 규칙 없이 이어 쓰면 체크리스트가 본문 중간에 들어가는 등 구조가 흐트러진다
            const learningTab = additionalContext.tabId === 'basicLearn' || additionalContext.tabId === 'advLearn';
            systemInstruction = `${CONTEXT_CORE.personas.instructor}\n[작성 규칙]\n${buildTabRules(additionalContext.tabId, additionalContext.keyConcepts)}`;
            systemInstruction += '\n\n[이어쓰기 규칙]\n' +
                '- 반드시 한국어로 작성하세요. 영어로 작성하지 마세요.\n' +
                '- 마크다운 구조(##, ###, 표, mermaid, 불릿)와 이전 청크의 문체·깊이를 그대로 유지하세요. ## 제목은 "##"와 제목을 같은 줄에 씁니다.\n' +
                '- 이 탭의 성격에 맞지 않는 섹션을 새로 만들지 마세요. (학습 탭에 채점 루브릭·퀴즈를 추가하지 말 것)\n' +
                '- 이미지 태그 형식도 이전 청크와 동일하게 유지하세요.\n' +
                (learningTab ? '- "## ✅ 학습 후 체크리스트"는 모든 본문 섹션을 다 쓴 뒤 문서 맨 끝에 한 번만 둡니다. [지금까지 쓴 ## 제목]에 이미 있으면 다시 쓰지 않습니다.\n' : '') +
                (additionalContext.tabId === 'basicLearn' ? '- 분량 기준은 첫 청크와 같습니다. 남은 섹션을 요약하지 않습니다.\n' + basicLearnVolumeRule(additionalContext.targetMinutes || BASIC_LEARN_MIN_MINUTES) + '\n' : '') +
                '- 아래 "이전 작성 내용"의 마지막 지점부터 이어서 작성하세요. 절대 처음부터 다시 쓰지 마세요.\n' +
                '- 이미 작성된 내용을 반복하지 마세요. 중복 헤딩이나 중복 문단을 생성하면 안 됩니다.\n' +
                '- 이전 내용의 마지막 헤딩/문단을 확인하고, 그 다음 섹션부터 자연스럽게 연결하세요.\n' +
                '- 아직 작성되지 않은 남은 섹션을 모두 완성하세요.\n' +
                '- 모든 내용을 마쳤으면 문서 끝에 <!-- END -->를 붙이세요. 아직 더 남았으면 자연스러운 문단/섹션 끝에서 멈추고 <!-- CONTINUE -->를 붙이세요. 문장 중간이나 코드 블록 안에서 끊지 마세요.';

            // 이전 내용은 끝부분만 주므로, 이미 쓴 섹션을 제목 목록으로 알려 중복과 순서 꼬임을 막는다
            const writtenHeadings = (additionalContext.writtenHeadings || []).join('\n');
            userPrompt = `[현재 작업: 탭 이어쓰기 (${additionalContext.chunkIndex}번째 연속) — ${additionalContext.tabLabel}]\n모듈명: ${additionalContext.title}\n설명: ${additionalContext.description}` +
                (writtenHeadings ? `\n\n[지금까지 쓴 ## 제목 — 다시 쓰지 않습니다]\n${writtenHeadings}` : '') +
                `\n\n[이전 작성 내용 — 여기서부터 이어쓰세요. 반복 금지]\n${additionalContext.previousContent}`;
            if (additionalContext.codeTopic && additionalContext.tabId !== 'assessment') userPrompt += codeTopicPrompt(additionalContext.tabId);
            break;
        }

        // ─── 기본 학습 분량 보강: 섹션 하나 끝에 이어 붙일 새 ### 소주제 (lesson-volume.js) ───
        case 'volume_expand': {
            const a = additionalContext;
            const minutes = a.targetMinutes || BASIC_LEARN_MIN_MINUTES;
            systemInstruction = `${CONTEXT_CORE.personas.instructor}\n[작성 규칙]\n${buildTabRules(a.tabId, [], { exclude: ['markdown_structure', 'time_allocation', 'learning_checklist', 'image_tags', 'mermaid_rules'], fewshot: false })}` +
                '\n\n[분량 보강 규칙 — 절대 준수]\n' +
                '- 이미 작성한 교안 섹션 하나를 더 깊고 길게 만드는 작업입니다. [보강할 섹션] 끝에 이어 붙일 새 ### 소주제만 출력합니다.\n' +
                '- ## 제목, 학습 목표, 개요, 학습 후 체크리스트는 출력하지 않습니다. 다른 섹션의 내용도 쓰지 않습니다.\n' +
                '- [보강할 섹션]에 이미 있는 소주제 제목, 설명, 예시, 문장을 되풀이하지 않습니다. 같은 개념은 원리와 이유, 단계별 풀이, 비교, 흔한 오해와 바로잡기, 적용 사례, 판단 기준처럼 새 각도에서 더 깊이 설명합니다.\n' +
                '- 새 소주제는 "### ■ 제목"으로 시작하고 개념 정의 → 이론 설명 → 구체적 예시 → 사례 분석 흐름을 따릅니다. 소주제 제목에는 (⏱ N분)을 붙이지 않습니다.\n' +
                '- 이 섹션이 속한 학습 목표 범위 안에서만 씁니다. 다른 학습 목표의 내용이나 새 주제를 끌어오지 않습니다.\n' +
                '- 분량은 소리 내어 읽는 본문 글자 수(공백 포함)로 셉니다. 코드 블록, 표, mermaid, 이미지 태그는 분량에 들어가지 않습니다. 이미지 태그와 mermaid는 새로 넣지 않고, 표는 소주제마다 하나까지만 씁니다.\n' +
                '- 같은 교안의 다른 부분을 가리킬 때도 "앞에서", "앞서", "이전 시간", "다음 시간"을 쓰지 않고 그 개념의 이름을 직접 씁니다.\n' +
                '- 강의 대본처럼 말을 걸거나 수업 진행을 쓰지 않습니다. 코드 블록 밖의 본문에 "여러분", "당신", "우리는", "강사는", "교수자는", "수업에서는"이 없어야 하고, 문장 끝은 [작성 규칙]의 어투를 따릅니다.\n' +
                '- <!-- CONTINUE -->, <!-- END --> 같은 표시와 작업 설명을 붙이지 말고, 코드 펜스로 감싸지 않은 마크다운만 출력합니다.';
            userPrompt = `[현재 작업: ${a.tabLabel} 분량 보강 — 목표 낭독 ${minutes}분]\n모듈명: ${a.title}\n설명: ${a.description}` +
                `\n\n[문서 구조 — 이 순서와 제목은 바꾸지 않습니다]\n${(a.outline || []).map(title => `- ${title}`).join('\n')}` +
                (a.objectives?.length ? `\n\n[이 교안의 학습 목표 — 참고용]\n${a.objectives.map(goal => `- ${goal}`).join('\n')}` : '') +
                `\n\n[보강할 섹션 — 이 섹션 끝에 이어 붙일 내용만 씁니다]\n${a.sectionText}` +
                `\n\n[보강 분량]\n- 새 ### 소주제 ${a.subtopics}개 안팎, 소리 내어 읽는 본문 ${Number(a.requestChars).toLocaleString('ko-KR')}자 이상(공백 포함)을 씁니다. 소주제 하나는 2,000자 이상입니다.` +
                (a.needCode ? '\n\n[코드 예제 — 이 섹션에는 아직 코드 예제가 없습니다]\n- 첫 새 소주제는 언어를 적은 코드 블록 예제로 시작합니다. 코드 앞에 무엇을 하는 코드인지, 코드 뒤에 핵심 줄 설명과 실행 결과(```text)를 씁니다.' : '') +
                (a.codeSection ? '\n\n[코드 예제 — 이 섹션은 코드를 다룹니다]\n- 새 소주제마다 언어를 적은 코드 블록 예제를 하나 이상 넣고, 코드 앞에 무엇을 하는 코드인지, 코드 뒤에 핵심 줄 설명과 실행 결과(```text)를 씁니다.\n- 코드 자체는 분량에 들어가지 않으므로 코드를 설명하는 문장을 충분히 씁니다.' : '') +
                (a.fromUpload ? '\n\n[원본 문서]\n- 사용자가 올린 문서로 만든 교안입니다. 섹션에 이미 있는 사실과 어긋나는 내용을 만들지 않습니다.' : '');
            break;
        }

    }



    return { systemInstruction, userPrompt };
}

// =========================================================================
// 검색 그림 저장소(로컬 이미지 캐시) 패널. 설정 → 고급에서 연다
// =========================================================================

window.toggleCachePanel = function () {
    const root = document.getElementById('cache-panel');
    if (!root) return;

    // 히스토리 패널 열려있으면 닫기
    const histPanel = document.getElementById('history-panel');
    if (histPanel && !histPanel.classList.contains('hidden')) {
        histPanel.classList.add('hidden');
    }

    if (root.classList.contains('hidden')) {
        root.classList.remove('hidden');
        renderCacheList();
    } else {
        root.classList.add('hidden');
    }
};

window.renderCacheList = async function () {
    const listWrapper = document.getElementById('cache-list');
    const countBadge = document.getElementById('cache-count-badge');
    if (!listWrapper) return;

    try {
        const caches = await DBManager.getAllCaches();
        if (countBadge) countBadge.textContent = caches.length.toString();

        if (caches.length === 0) {
            listWrapper.innerHTML = `
                <div class="flex flex-col items-center justify-center p-6 text-center h-full opacity-50">
                    <i class="ph-fill ph-images text-2xl mb-2"></i>
                    <p class="text-xs">캐시된 이미지가 없습니다.</p>
                </div>
            `;
            return;
        }

        let html = '';
        for (const item of caches) {
            const dateStr = new Date(item.timestamp).toLocaleString();
            html += `
                <div class="group bg-black/20 border border-white/5 rounded-xl p-3 hover:bg-white/5 transition-colors relative overflow-hidden">
                    <div class="flex justify-between items-start mb-2">
                        <div class="flex-1 min-w-0 pr-2">
                            <h4 class="text-[0.75rem] font-bold text-white truncate" title="${escapeHtml(item.keyword)}">${escapeHtml(item.keyword)}</h4>
                            <p class="text-xs text-textMuted mt-0.5">${dateStr} · ${escapeHtml(item.format)}</p>
                        </div>
                        <button onclick="deleteSingleCache(${escapeHtml(JSON.stringify(String(item.keyword)))})" class="w-6 h-6 flex items-center justify-center rounded bg-rose-500/10 hover:bg-rose-500/30 text-rose-400 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                            <i class="ph-bold ph-trash text-xs"></i>
                        </button>
                    </div>
                    <div class="aspect-video bg-black/40 rounded flex items-center justify-center overflow-hidden border border-white/5">
                        <img src="${escapeHtml(item.base64)}" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt="Cached Image">
                    </div>
                </div>
            `;
        }
        listWrapper.innerHTML = html;

    } catch (e) {
        console.error("Cache rendering error:", e);
        listWrapper.innerHTML = `<p class="text-xs text-rose-400 p-4">캐시를 불러오는 중 오류가 발생했습니다.</p>`;
    }
};

window.deleteSingleCache = async function (keyword) {
    if (!confirm(`'${keyword}' 캐시를 삭제하시겠습니까?`)) return;
    try {
        await DBManager.deleteCache(keyword);
        renderCacheList(); // 리스트 갱신
        if (window.showToast) window.showToast(`캐시가 삭제되었습니다.`, 'success');
    } catch (e) {
        if (window.showToast) window.showToast(`캐시 삭제 실패!`, 'error');
    }
};

window.clearAllImageCaches = async function () {
    if (!confirm('경고: 로컬 시스템에 저장된 모든 이미지 캐시를 영구적으로 삭제합니다. 진행하시겠습니까?')) return;
    try {
        await DBManager.clearAllCaches();
        renderCacheList();
        if (window.showToast) window.showToast(`모든 이미지 캐시가 완전히 삭제되었습니다.`, 'success');
    } catch (e) {
        if (window.showToast) window.showToast(`캐시 전체 초기화 실패!`, 'error');
    }
};



// ------------------------------------------------------------------------

