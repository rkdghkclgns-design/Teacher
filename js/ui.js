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



window.showConfirm = function (message, onConfirm) {

    const overlay = document.createElement('div');

    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] animate-fade-in';

    overlay.onclick = () => overlay.remove();

    overlay.innerHTML = `

                <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[320px] p-6 shadow-2xl flex flex-col" onclick="event.stopPropagation()">

                    <div class="flex items-center gap-3 mb-4">

                        <i class="ph-fill ph-warning-circle text-2xl text-yellow-400"></i>

                        <h3 class="font-bold text-white text-sm">확인</h3>

                    </div>

                    <p class="text-sm text-textMuted mb-6 leading-relaxed whitespace-pre-wrap">${escapeHtml(message)}</p>

                    <div class="flex justify-end gap-2">

                        <button class="px-4 py-2 text-xs font-bold text-textLight bg-white/5 hover:bg-white/10 rounded-lg transition-colors" onclick="this.closest('.fixed').remove()">취소</button>

                        <button class="px-4 py-2 text-xs font-bold text-white bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors" id="btn-confirm-ok">삭제</button>

                    </div>

                </div>

            `;

    document.body.appendChild(overlay);



    document.getElementById('btn-confirm-ok').onclick = () => {

        overlay.remove();

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
window.showKeyConceptsPrompt = function (title, defaultConcepts, onConfirm) {
    const defaults = Array.isArray(defaultConcepts) ? defaultConcepts.filter(Boolean) : [];
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] animate-fade-in';
    overlay.onclick = () => overlay.remove();
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[420px] p-6 shadow-2xl flex flex-col" onclick="event.stopPropagation()">
            <div class="flex items-center gap-3 mb-4">
                <i class="ph-fill ph-lightbulb text-2xl text-accent"></i>
                <h3 class="font-bold text-white text-sm">${title}</h3>
            </div>
            <p class="text-xs text-textMuted mb-3 leading-relaxed">이 차시에서 반드시 다뤄야 할 핵심 개념을 입력하세요.<br>쉼표(,)로 구분하며, 비워두면 AI가 자동 구성합니다.</p>
            <input type="text" id="kc-prompt-input" value="${defaults.join(', ')}"
                placeholder="예: 게임 루프, 프레임 레이트, 델타 타임"
                class="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent transition-colors mb-4"
                onkeydown="if(event.key==='Enter'){document.getElementById('kc-prompt-ok').click();}">
            <div class="flex justify-end gap-2">
                <button class="px-4 py-2 text-xs font-bold text-textLight bg-white/5 hover:bg-white/10 rounded-lg transition-colors" onclick="this.closest('.fixed').remove()">취소</button>
                <button id="kc-prompt-ok" class="px-4 py-2 text-xs font-bold text-white bg-accent hover:bg-accentHover rounded-lg transition-colors flex items-center gap-1">
                    <i class="ph-bold ph-sparkle"></i> 생성
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
    // 1. 데이터 관리 메뉴 (좌상단 설정쪽) 닫기
    const dataMenu = document.getElementById('data-manage-menu');
    const dataBtn = document.getElementById('btn-data-manage');

    if (dataMenu && !dataMenu.classList.contains('hidden') &&
        !dataMenu.contains(event.target) && (!dataBtn || !dataBtn.contains(event.target))) {
        dataMenu.classList.add('hidden');
        dataMenu.classList.remove('flex');
    }

    // 2. PDF 드롭다운 닫기
    const pdfMenu = document.getElementById('pdf-dropdown-menu');
    const pdfBtn = document.getElementById('pdf-dropdown-btn');

    if (pdfMenu && !pdfMenu.classList.contains('hidden') &&
        !pdfMenu.contains(event.target) && (!pdfBtn || !pdfBtn.contains(event.target))) {
        pdfMenu.classList.add('hidden');
        pdfMenu.classList.remove('flex');
    }

    // 3. 폴더 연동 드롭다운 닫기
    const folderMenu = document.getElementById('folder-dropdown-menu');
    const folderIndicator = document.getElementById('folder-connection-indicator');

    if (folderMenu && !folderMenu.classList.contains('hidden') &&
        !folderMenu.contains(event.target) && (!folderIndicator || !folderIndicator.contains(event.target))) {
        folderMenu.classList.add('hidden');
        folderMenu.classList.remove('flex');
    }
});

window.addEventListener('hashchange', handleRoute);



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

                    </div>`;

        return;

    }



    list.innerHTML = globalState.subjects.map((subj, idx) => `

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

                            <h3 class="font-bold text-sm text-white truncate max-w-[140px]">${subj.title}</h3>

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

                    <div class="px-3.5 pb-3.5 pt-1 flex gap-2">

                        <span class="text-[0.65rem] font-bold bg-white/10 text-textLight px-2 py-1 rounded-md flex items-center gap-1">

                            <i class="ph-fill ph-file-text text-accent"></i> ${subj.lessons?.length || 0} 차시

                        </span>

                        ${subj.hasLevelTest ? `<span class="text-[0.65rem] font-bold bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded-md flex items-center gap-1"><i class="ph-fill ph-crown"></i> 메인 퀘스트</span>` : ''}

                    </div>

                </div>

            `).join('');

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

        lessonCount: 0,

        hasLevelTest: true,

        mainQuest: {

            id: 'mainQuest',

            title: '👑 메인 퀘스트 (최종 과제)',

            description: '모든 일일 퀘스트를 종합한 최종 평가입니다.',

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

    showConfirm('이 교과를 정말 삭제하시겠습니까? (하위 차시 모두 삭제됨)', () => {

        globalState.subjects = globalState.subjects.filter(s => String(s.id) !== String(id));

        saveState().then(() => {
            renderOverviewLNB();
            renderDiagram();
            closeDetailPanel();
        });

    });

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

                            <div class="text-sm font-bold text-white group-hover:text-accent transition-colors">${l.title}</div>

                            <div class="text-xs text-textMuted line-clamp-1">${l.description || '-'}</div>

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

                        <label class="text-[0.65rem] font-bold text-accent uppercase tracking-widest mb-1.5 block">Subject Title</label>

                        <div class="text-xl font-bold text-white">${subj.title}</div>

                    </div>

                    

                    <div>

                        <label class="text-[0.65rem] font-bold text-accent uppercase tracking-widest mb-1.5 block">Description</label>

                        <div class="text-sm text-textLight leading-relaxed bg-white/5 p-4 rounded-xl border border-white/5">

                            ${subj.description}

                        </div>

                    </div>

                    

                    <div class="border-t border-white/5 pt-6">

                        <div class="flex justify-between items-end mb-4">

                            <label class="text-[0.65rem] font-bold text-accent uppercase tracking-widest">Lessons</label>

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

function toggleExportDropdown(event) {
    if (event) event.stopPropagation();
    // 다른 드롭다운 닫기
    closeAllDropdowns('export-dropdown-menu');
    const menu = document.getElementById('export-dropdown-menu');
    if (!menu) return;
    const wasHidden = menu.classList.contains('hidden');
    menu.classList.toggle('hidden');
    menu.classList.toggle('flex');
    // 형식 선택 섹션 리셋
    const fmtSection = document.getElementById('export-format-section');
    if (fmtSection) fmtSection.classList.add('hidden');
    // 위치 조정
    if (wasHidden) {
        const btn = document.getElementById('export-dropdown-btn');
        if (btn) {
            const rect = btn.getBoundingClientRect();
            menu.style.top = (rect.bottom + 4) + 'px';
            menu.style.left = Math.max(4, rect.right - menu.offsetWidth) + 'px';
        }
    }
}
// 레거시 호환
function togglePdfDropdown(event) { toggleExportDropdown(event); }

function setExportScope(scope) { _exportScope = scope; }

function showExportFormatMenu() {
    const section = document.getElementById('export-format-section');
    if (section) section.classList.remove('hidden');
}

// v7.5: 드롭다운 내보내기 (export-modal.js의 executeExport와 충돌 방지)
window.executeDropdownExport = function (format) {
    toggleExportDropdown(); // 닫기
    switch (format) {
        case 'md':
            if (_exportScope === 'subject') exportSubjectToMD();
            else exportCurrentToMD();
            break;
        case 'pdf':
            if (_exportScope === 'subject') exportSubjectToPDF();
            else exportToPDF();
            break;
        case 'slide':
            if (_exportScope === 'subject') {
                if (typeof exportSubjectToPptx === 'function') exportSubjectToPptx();
                else if (typeof exportToPptx === 'function') exportToPptx();
            } else {
                if (typeof exportToPptx === 'function') exportToPptx();
            }
            break;
        case 'html':
            if (_exportScope === 'subject') exportSubjectToHTML();
            else exportCurrentToHTML();
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
    const tabContent = typeof getActiveTabContent === 'function' ? getActiveTabContent(mod) : mod.content;
    if (!tabContent) return window.showAlert('현재 탭에 내용이 없습니다.');
    const blob = new Blob([tabContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (mod.title || '교안') + '.md';
    a.click();
    URL.revokeObjectURL(url);
}

function exportSubjectToMD() {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return window.showAlert('교과를 먼저 선택해주세요.');
    const lessonList = subj.lessons || [];
    if (!lessonList.length) return window.showAlert('내보낼 차시가 없습니다.');
    lessonList.forEach(mod => {
        const allContent = Object.entries(mod.tabContents || {}).map(([k, v]) => v ? `# [${k}]\n\n${v}` : '').filter(Boolean).join('\n\n---\n\n');
        if (!allContent) return;
        const blob = new Blob([allContent], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (mod.title || '차시') + '.md';
        a.click();
        URL.revokeObjectURL(url);
    });
    window.showToast(`📁 ${lessonList.length}개 차시 MD 파일 다운로드`, 'success');
}

// HTML 내보내기
function exportCurrentToHTML() {
    const mod = typeof getEditingModule === 'function' ? getEditingModule() : null;
    if (!mod) {
        if (typeof exportSubjectToHTML === 'function') return exportSubjectToHTML();
        return window.showAlert('차시를 먼저 선택해주세요.');
    }
    const renderView = document.getElementById('render-view');
    if (!renderView) return;
    const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${mod.title || '교안'}</title><style>body{font-family:'Noto Sans KR',sans-serif;max-width:900px;margin:0 auto;padding:40px;line-height:1.8;color:#1a1a2e;}h1,h2,h3{margin-top:1.5em;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ddd;padding:8px 12px;text-align:left;}th{background:#f0f0f0;}img{max-width:100%;border-radius:8px;}</style></head><body>${renderView.innerHTML}</body></html>`;
    const blob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (mod.title || '교안') + '.html';
    a.click();
    URL.revokeObjectURL(url);
}

function exportSubjectToHTML() {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return window.showAlert('교과를 먼저 선택해주세요.');
    const lessonList = subj.lessons || [];
    if (!lessonList.length) return window.showAlert('내보낼 차시가 없습니다.');
    lessonList.forEach(mod => {
        const allContent = Object.entries(mod.tabContents || {}).map(([k, v]) => {
            if (!v) return '';
            const parsed = typeof marked !== 'undefined' ? marked.parse(v) : v;
            return `<h1>${k}</h1>${parsed}`;
        }).filter(Boolean).join('<hr>');
        if (!allContent) return;
        const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${mod.title || '교안'}</title><style>body{font-family:'Noto Sans KR',sans-serif;max-width:900px;margin:0 auto;padding:40px;line-height:1.8;color:#1a1a2e;}h1,h2,h3{margin-top:1.5em;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ddd;padding:8px 12px;}th{background:#f0f0f0;}img{max-width:100%;}</style></head><body>${allContent}</body></html>`;
        const blob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (mod.title || '차시') + '.html';
        a.click();
        URL.revokeObjectURL(url);
    });
    window.showToast(`📁 ${lessonList.length}개 차시 HTML 파일 다운로드`, 'success');
}

// 슬라이드 교과 전체 내보내기
function exportSubjectToSlide() {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return window.showAlert('교과를 먼저 선택해주세요.');
    const lessonList = subj.lessons || [];
    if (!lessonList.length) return window.showAlert('내보낼 차시가 없습니다.');
    // 각 차시별로 슬라이드 HTML 생성
    lessonList.forEach(mod => {
        const prevMod = typeof getEditingModule === 'function' ? getEditingModule() : null;
        // 임시로 현재 모듈 설정 후 슬라이드 내보내기
        if (typeof currentModuleId !== 'undefined') currentModuleId = mod.id;
        try {
            if (typeof exportToSlideHTML === 'function') exportToSlideHTML();
        } catch (e) { console.warn('슬라이드 내보내기 실패:', mod.title, e); }
    });
    window.showToast(`📁 ${lessonList.length}개 차시 슬라이드 다운로드`, 'success');
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

    const zip = new JSZip();
    let totalFiles = 0;

    checkedIds.forEach(subjId => {
        const subj = globalState.subjects.find(s => String(s.id) === String(subjId));
        if (!subj) { console.warn('[ZIP] 교과 ID 매칭 실패:', subjId); return; }
        const subjName = (subj.title || '교과').replace(/[^\w가-힣\s]/g, '').trim();
        const subjFolder = zip.folder(subjName);

        const lessonList = subj.lessons || subj.modules || [];
        lessonList.forEach((mod, modIdx) => {
            if (mod.id === 'mainQuest') return;
            const modName = `${String(modIdx + 1).padStart(2, '0')}_${(mod.title || '차시').replace(/[^\w가-힣\s]/g, '').trim()}`;
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

            if (mod.images && Object.keys(mod.images).length > 0) {
                const imgFolder = modFolder.folder('images');
                Object.entries(mod.images).forEach(([, b64], imgIdx) => {
                    if (!b64 || !b64.startsWith('data:image')) return;
                    const ext = (b64.match(/^data:image\/(\w+);/) || [, 'png'])[1];
                    const base64Data = b64.replace(/^data:image\/\w+;base64,/, '');
                    imgFolder.file(`img_${String(imgIdx + 1).padStart(2, '0')}.${ext}`, base64Data, { base64: true });
                    totalFiles++;
                });
            }
        });

        const mq = subj.mainQuest || (lessonList).find(m => m.id === 'mainQuest');
        if (mq && mq.content) { subjFolder.file('레벨테스트.md', mq.content); totalFiles++; }
    });

    if (totalFiles === 0) return window.showAlert('내보낼 내용이 없습니다.');

    try {
        const blob = await zip.generateAsync({ type: 'blob' });
        const zipName = checkedIds.length === 1
            ? `${(globalState.subjects.find(s => String(s.id) === String(checkedIds[0]))?.title || '교과').replace(/[^\w가-힣\s]/g, '')}_교안.zip`
            : `교안_${checkedIds.length}개교과.zip`;
        saveAs(blob, zipName);
        if (window.showToast) window.showToast(`📦 ${totalFiles}개 파일이 ZIP으로 다운로드되었습니다.`, 'success');
    } catch (e) {
        console.error('[ZIP]', e);
        window.showAlert('ZIP 생성 오류: ' + e.message);
    }
};

// v7.5: 스마트 ZIP — 선택된 교과가 있으면 선택만, 없으면 전체
window.smartZipExport = function () {
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

    const zip = new JSZip();
    const subjectName = (subj.title || subj.name || '교과').replace(/[^\w가-힣\s]/g, '').trim();
    const rootFolder = zip.folder(subjectName);
    let totalFiles = 0;

    lessonList.forEach((mod, modIdx) => {
        if (mod.id === 'mainQuest') return;
        const modName = `${String(modIdx + 1).padStart(2, '0')}_${(mod.title || '차시').replace(/[^\w가-힣\s]/g, '').trim()}`;
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

        // 이미지 폴더
        if (mod.images && Object.keys(mod.images).length > 0) {
            const imgFolder = modFolder.folder('images');
            Object.entries(mod.images).forEach(([imgId, b64], imgIdx) => {
                if (!b64 || !b64.startsWith('data:image')) return;
                // Base64 → Blob 데이터 추출
                const mimeMatch = b64.match(/^data:(image\/\w+);base64,/);
                const ext = mimeMatch ? mimeMatch[1].split('/')[1] : 'png';
                const base64Data = b64.replace(/^data:image\/\w+;base64,/, '');
                imgFolder.file(`img_${String(imgIdx + 1).padStart(2, '0')}.${ext}`, base64Data, { base64: true });
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

    if (totalFiles === 0) return window.showAlert('내보낼 내용이 없습니다.');

    try {
        const blob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
            // 진행률 (선택적)
            console.log(`[ZIP] ${Math.round(metadata.percent)}% 완료`);
        });
        saveAs(blob, `${subjectName}_전체교안.zip`);
        if (window.showToast) window.showToast(`📦 ${totalFiles}개 파일이 ZIP으로 다운로드되었습니다.`, 'success');
    } catch (e) {
        console.error('[ZIP Export]', e);
        window.showAlert('ZIP 생성 중 오류: ' + e.message);
    }
};

// ------------------------------------------------------------------------


// Batch Generation Modal UI Control (Step 1 & 2)

// ------------------------------------------------------------------------

let batchUploadedFileContent = null;

let batchUploadedFileName = null;



window.openBatchModal = function () {

    const modal = document.getElementById('batch-modal');

    const content = document.getElementById('batch-modal-content');



    // 현재 교과의 제목이 있다면 기본값으로 세팅

    const subj = globalState.subjects.find(s => s.id === currentSubjectId);

    if (subj && subj.title !== '새로운 교과') {

        document.getElementById('batch-title').value = subj.title;

    }



    // 사이드바 차시 수를 모달에 동기화
    const sidebarCount = document.getElementById('sidebar-batch-count');
    const batchCount = document.getElementById('batch-count');
    if (sidebarCount && batchCount) {
        batchCount.value = sidebarCount.value;
    }

    // 등록된 참고자료 목록 렌더링
    const refSection = document.getElementById('batch-ref-section');
    const refList = document.getElementById('batch-ref-list');
    if (refSection && refList && subj) {
        const urls = Array.isArray(subj.referenceUrls) ? subj.referenceUrls : [];
        const refText = subj.referenceText || '';
        const allRefs = [
            ...urls.map((u, i) => ({ type: 'url', idx: i, label: u.title || u.url, url: u.url })),
            ...(refText ? [{ type: 'text', idx: 0, label: refText.substring(0, 80) + (refText.length > 80 ? '...' : '') }] : [])
        ];
        if (allRefs.length > 0) {
            refSection.classList.remove('hidden');
            refList.innerHTML = allRefs.map((ref, i) => {
                const icon = ref.type === 'url' ? '🔗' : '📄';
                return `<label class="flex items-center gap-2 text-xs text-textLight hover:bg-white/5 rounded p-1.5 cursor-pointer">
                    <input type="checkbox" class="batch-ref-checkbox accent-accent" data-ref-type="${ref.type}" data-ref-idx="${ref.idx}" checked>
                    <span class="truncate">${icon} ${ref.label}</span>
                </label>`;
            }).join('');
        } else {
            refSection.classList.add('hidden');
        }
    }

    modal.classList.remove('hidden');

    requestAnimationFrame(() => {

        modal.classList.remove('opacity-0');

        content.classList.remove('scale-95');

        content.classList.add('scale-100');

    });

};

// 사이드바 차시 수 +/- 조절
window.adjustBatchCount = function (delta) {
    const input = document.getElementById('sidebar-batch-count');
    if (!input) return;
    let val = parseInt(input.value) || 5;
    val = Math.max(1, Math.min(30, val + delta));
    input.value = val;
};

// 사이드바 ↔ 모달 차시 수 동기화
window.syncBatchCount = function (val) {
    const num = Math.max(1, Math.min(30, parseInt(val) || 5));
    const sidebar = document.getElementById('sidebar-batch-count');
    const modal = document.getElementById('batch-count');
    if (sidebar) sidebar.value = num;
    if (modal) modal.value = num;
};



window.closeBatchModal = function () {

    const modal = document.getElementById('batch-modal');

    const content = document.getElementById('batch-modal-content');



    modal.classList.add('opacity-0');

    content.classList.remove('scale-100');

    content.classList.add('scale-95');



    setTimeout(() => {

        modal.classList.add('hidden');

    }, 300);

};



window.handleConceptEnter = function (e) {

    if (e.key === 'Enter') {

        e.preventDefault();

        addConceptField();

    }

};



window.addConceptField = function () {

    const list = document.getElementById('batch-concept-list');

    const count = list.children.length + 1;

    const newField = document.createElement('div');

    newField.className = 'flex gap-2 items-center concept-item group animate-fade-in';

    newField.innerHTML = `

                <div class="w-6 h-6 rounded bg-white/5 flex items-center justify-center text-textMuted text-xs font-bold shrink-0">${count}</div>

                <input type="text" class="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent transition-colors" placeholder="추가할 핵심 개념을 입력하세요" onkeydown="handleConceptEnter(event)">

                <button type="button" onclick="removeConceptField(this)" class="w-8 h-8 flex items-center justify-center rounded bg-white/5 hover:bg-red-500/20 text-textMuted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">

                    <i class="ph-bold ph-trash"></i>

                </button>

            `;

    list.appendChild(newField);



    // 새 입력 필드로 포커스 이동

    newField.querySelector('input').focus();



    // 넘버링 재정렬

    reindexConcepts();

};



window.removeConceptField = function (btn) {

    btn.closest('.concept-item').remove();

    reindexConcepts();

};



function reindexConcepts() {

    const list = document.getElementById('batch-concept-list');

    Array.from(list.children).forEach((item, idx) => {

        item.querySelector('div').innerText = idx + 1;

    });

}



function initBatchFileDropzone() {

    const dropzone = document.getElementById('batch-dropzone');

    const fileInput = document.getElementById('batch-file-input');

    if (!dropzone || !fileInput) return;



    dropzone.addEventListener('dragover', (e) => {

        e.preventDefault();

        dropzone.classList.add('border-accent', 'bg-accent/10');

    });



    // 드래그가 영역을 벗어나면 하이라이트 제거

    dropzone.addEventListener('dragleave', (e) => {

        e.preventDefault();

        dropzone.classList.remove('border-accent', 'bg-accent/10');

    });



    dropzone.addEventListener('drop', (e) => {

        e.preventDefault();

        dropzone.classList.remove('border-accent', 'bg-accent/10');

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {

            handleBatchFile(e.dataTransfer.files[0]);

        }

    });



    fileInput.addEventListener('change', (e) => {

        if (e.target.files && e.target.files.length > 0) {

            handleBatchFile(e.target.files[0]);

        }

    });

}



function handleBatchFile(file) {

    if (!file.name.endsWith('.md') && !file.name.endsWith('.txt')) {

        window.showAlert('지원하지 않는 파일 형식입니다. (.md, .txt 만 가능)');

        return;

    }



    const reader = new FileReader();

    reader.onload = (e) => {

        batchUploadedFileContent = e.target.result;

        batchUploadedFileName = file.name;



        // UI Update

        document.getElementById('batch-file-name-display').innerText = file.name;

        document.getElementById('batch-file-size').innerText = (file.size / 1024).toFixed(1) + ' KB';

        document.getElementById('batch-file-preview').classList.remove('hidden');



        // input 값 초기화 (같은 파일 재업로드 지원)

        document.getElementById('batch-file-input').value = '';

    };

    reader.readAsText(file);

}



window.clearBatchFile = function (e) {

    if (e) e.stopPropagation(); // 방해 방지

    document.getElementById('batch-file-input').value = '';

    document.getElementById('batch-file-preview').classList.add('hidden');

    batchUploadedFileContent = null;

    batchUploadedFileName = null;

};



window.startBatchGeneration = async function () {

    const title = document.getElementById('batch-title').value.trim();

    // 사이드바 차시 수 우선, 없으면 모달 값 사용
    const sidebarCountEl = document.getElementById('sidebar-batch-count');
    const batchCountEl = document.getElementById('batch-count');
    const count = parseInt(sidebarCountEl?.value || batchCountEl?.value || '5');

    const goal = document.getElementById('batch-goal').value.trim();



    const conceptInputs = document.querySelectorAll('#batch-concept-list input[type="text"]');

    const concepts = Array.from(conceptInputs).map(input => input.value.trim()).filter(val => val !== '');



    if (!title) return window.showAlert('교과 제목을 입력해주세요.');

    if (isNaN(count) || count < 1 || count > 15) return window.showAlert('생성할 차시 수를 1~15 사이로 입력해주세요.');



    const submitBtn = document.getElementById('batch-submit-btn');

    const cancelBtn = document.getElementById('batch-cancel-btn');

    const progressText = document.getElementById('batch-progress-text');

    const progressSpan = progressText.querySelector('span');



    submitBtn.classList.add('hidden');

    cancelBtn.classList.add('hidden');

    progressText.classList.remove('hidden');

    progressSpan.innerText = '목차(Blueprint) 설계 중... (1/' + (goal ? '3' : '2') + ')';



    try {

        // 1. Blueprint 생성 — 기존 차시가 있으면 이어서 생성
        const subj = globalState.subjects.find(s => s.id === currentSubjectId);
        const existingLessons = subj && Array.isArray(subj.lessons) ? subj.lessons : [];
        const existingInfo = existingLessons.length > 0
            ? `\n- 기존 차시 (${existingLessons.length}개, 이미 생성됨 — 이 차시들과 중복되지 않게 이어서 설계):\n${existingLessons.map((l, i) => `  ${i + 1}. ${l.title}: ${l.description || ''}`).join('\n')}\n- 새로 생성할 차시 수: ${count}개 (기존 ${existingLessons.length}개 이후 ${existingLessons.length + 1}번째부터)`
            : `\n- 차시 수: ${count}`;

        const blueprintPrompt = `
                    다음 조건에 맞춰 게임 기획 교육과정 목차를 설계해주세요.

                    - 교과 제목: ${title}
                    ${existingInfo}

                    - 최종 목표(레벨테스트): ${goal || '없음'}

                    - 핵심 개념: ${concepts.length > 0 ? concepts.join(', ') : '자유롭게 구성'}

                    ${batchUploadedFileContent ? `- 참고 자료 요약:\n${cleanForAPI(batchUploadedFileContent).substring(0, 3000)}` : ''}

                    응답은 반드시 순수 JSON 배열이어야 합니다. (새로 생성할 ${count}개만 반환)

                    예시: [{"title": "차시명", "description": "이 차시의 학습 목표 및 주요 내용 요약", "hours": 2}]

                `;



        const bpPayload = {
            contents: [{ parts: [{ text: blueprintPrompt }] }],
            systemInstruction: { parts: [{ text: CONTEXT_CORE.personas.orchestrator + "\n[규칙]\n- " + CONTEXT_CORE.rules.json_only }] }
        };



        const bpData = await fetchWithRetry(

            `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${apiKey}`,

            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bpPayload) }

        );



        const blueprint = safeJSONParse(extractText(bpData));

        if (!Array.isArray(blueprint)) throw new Error("유효하지 않은 목차 데이터가 반환되었습니다.");



        // 2. 상세 교안 순차 생성 및 에러 방어 로직 적용

        const generatedLessons = [];

        for (let idx = 0; idx < blueprint.length; idx++) {

            const item = blueprint[idx];

            progressSpan.innerText = `차시 교안 생성 중... (${idx + 1}/${blueprint.length} 진행)`;



            try {

                const lessonPrompt = `

                            [현재 작업: 상세 교안 작성 (단원 일괄 생성 중)]

                            교과 제목: ${title}

                            차시명: ${item.title}

                            설명/목표: ${item.description}

                            단원 전체 핵심 개념: ${concepts.join(', ')}

                            ${goal ? `최종 목표 연계성: 이 차시 내용은 최종적으로 '${goal}'을(를) 달성하기 위한 빌드업 과정이어야 합니다.` : ''}

                            ${batchUploadedFileContent ? `참고 자료:\n${cleanForAPI(batchUploadedFileContent).substring(0, 2000)}` : ''}

                            

                            위 내용을 바탕으로 우리 교안 규격(1.개요, 2.학습 목표, 3.핵심 내용, 4.실습/예제, 5.요약)에 맞게 마크다운 교안을 작성하세요.
                            [중요 지침] 본문 작성 시 단순한 이론 나열을 금지합니다. 반드시 최근 업계 트렌드에 부합하는 실제 고유명사 게임 사례나 명확한 실제 데이터를 적극적으로 예시로 들어 설명하세요. (단, 존재하지 않는 허위 데이터나 사례를 지어내는 환각은 절대 금지합니다.)

                            마지막에는 '# ⚔️ 일일 퀘스트 (실습 과제)'를 포함하세요.

                        `;



                const lessonPayload = {
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                    ],
                    contents: [{ parts: [{ text: lessonPrompt }] }],
                    systemInstruction: { parts: [{ text: buildTaskContext('module', { title: item.title, description: item.description, keyConcepts: concepts }).systemInstruction }] }
                };



                const lessonData = await fetchWithRetry(

                    `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${apiKey}`,

                    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lessonPayload) }

                );



                let rawMarkdown = extractText(lessonData);

                let tempMod = { images: {} };

                rawMarkdown = await processImageTags(tempMod, rawMarkdown);



                generatedLessons.push({

                    id: Date.now() + idx,

                    title: item.title,

                    description: item.description,

                    hours: item.hours || 2,

                    status: 'done',

                    content: rawMarkdown,

                    images: tempMod.images,

                    tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null },

                    uploadedMdName: null,

                    uploadedMdContent: null

                });



                // [방어 설정] API Rate Limit(RPM) 우회를 위해 차시 생성 간 4초 대기 (Gemini 무료 티어 방어)
                if (idx < blueprint.length - 1) {
                    progressSpan.innerText = `API 쿨다운 대기 중... (${idx + 1}/${blueprint.length})`;
                    await new Promise(resolve => setTimeout(resolve, 4000));
                }



            } catch (err) {

                console.error(`[차시 생성 실패] ${item.title}:`, err);

                // [방어 설정] 특정 차시가 실패해도 전체 프로세스가 중단되지 않고, 해당 차시를 '대기중' 상태로 등록

                generatedLessons.push({

                    id: Date.now() + idx,

                    title: item.title,

                    description: item.description,

                    hours: item.hours || 2,

                    status: 'waiting',

                    content: null,

                    images: {},

                    tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null },

                    uploadedMdName: null,

                    uploadedMdContent: null

                });

            }

        }



        // 3. 전역 상태 업데이트 (Step 4)

        const updatedSubj = globalState.subjects.find(s => s.id === currentSubjectId);

        if (updatedSubj) {

            updatedSubj.title = title;

            updatedSubj.lessons = generatedLessons;



            if (goal) {

                if (!updatedSubj.mainQuest) updatedSubj.mainQuest = { images: {}, status: 'waiting', content: null };

                updatedSubj.mainQuest.title = "👑 메인 퀘스트: " + goal;

                updatedSubj.mainQuest.description = "최종 결과물: " + goal + " (모든 차시의 내용을 종합하여 완성하세요.)";

                updatedSubj.mainQuest.status = 'waiting';

                updatedSubj.mainQuest.content = null;

            }



            courseData = updatedSubj.lessons;

        }



        await saveState();

        // 4. 메인 퀘스트 콘텐츠 자동 생성 (goal 입력 시)
        if (goal) {
            const subj = globalState.subjects.find(s => s.id === currentSubjectId);
            if (subj && subj.mainQuest) {
                progressSpan.innerText = 'API 쿨다운 대기 중... (메인 퀘스트)';
                await new Promise(resolve => setTimeout(resolve, 3000));
                progressSpan.innerText = '메인 퀘스트 교안 생성 중...';

                try {
                    // 생성된 차시들의 컨텍스트 수집
                    const contextStr = generatedLessons.map(l =>
                        `- ${l.title}: ${l.description}\n  내용 요약: ${l.content ? cleanForAPI(l.content).substring(0, 150) + '...' : '미작성'}`
                    ).join('\n\n');

                    const { systemInstruction, userPrompt } = buildTaskContext('main_quest', contextStr);

                    const mqPayload = {
                        contents: [{ parts: [{ text: userPrompt }] }],
                        systemInstruction: { parts: [{ text: systemInstruction }] }
                    };

                    const mqData = await fetchWithRetry(
                        `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${apiKey}`,
                        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mqPayload) }
                    );

                    let mqMarkdown = extractText(mqData);
                    mqMarkdown = await processImageTags(subj.mainQuest, mqMarkdown);

                    subj.mainQuest.content = mqMarkdown;
                    subj.mainQuest.status = 'done';
                    await saveState();

                } catch (mqErr) {
                    console.error('[메인 퀘스트 생성 실패]', mqErr);
                    // 실패해도 전체 프로세스는 중단하지 않음 — 수동 생성 가능
                }
            }
        }



        // 4.5. 각 차시에 대해 5탭 자동 생성 (기본학습 → 나머지 4탭)
        {
            const subjForTabs = globalState.subjects.find(s => s.id === currentSubjectId);
            if (subjForTabs && Array.isArray(subjForTabs.lessons)) {
                const doneLessons = subjForTabs.lessons.filter(l => l.status === 'done' && l.content);
                for (let ti = 0; ti < doneLessons.length; ti++) {
                    const lesson = doneLessons[ti];
                    progressSpan.innerText = `5탭 생성 중... (${ti + 1}/${doneLessons.length}: ${lesson.title})`;
                    try {
                        if (typeof generateAllTabs === 'function') {
                            await generateAllTabs(lesson.id);
                        }
                    } catch (tabErr) {
                        console.warn(`[5탭 생성 실패] ${lesson.title}:`, tabErr.message);
                    }
                    // API 쿨다운
                    if (ti < doneLessons.length - 1) {
                        progressSpan.innerText = `API 쿨다운 대기 중... (${ti + 1}/${doneLessons.length})`;
                        await new Promise(resolve => setTimeout(resolve, 4000));
                    }
                }
                await saveState();
            }
        }

        // 화면 동기화

        renderSidebar();

        renderOverviewLNB();

        renderDiagram();



        // 첫 번째 차시 열기

        if (courseData.length > 0) {

            viewModule(courseData[0].id);

        }



        closeBatchModal();

        const mqDone = goal && globalState.subjects.find(s => s.id === currentSubjectId)?.mainQuest?.status === 'done';
        window.showAlert(mqDone
            ? '🎉 단원 일괄 생성 + 5탭 생성 + 메인 퀘스트 생성이 완료되었습니다!'
            : '🎉 단원 단위 일괄 생성 + 5탭 생성이 완료되었습니다!' + (goal ? '\n⚠️ 메인 퀘스트는 생성에 실패했습니다. 수동으로 생성해 주세요.' : ''));



    } catch (e) {

        console.error("일괄 차시 생성 중 에러 발생 상세:", e, e.stack);

        window.showAlert('생성 중 오류가 발생했습니다.\n에러 내용: ' + e.message);

    } finally {

        submitBtn.classList.remove('hidden');

        cancelBtn.classList.remove('hidden');

        progressText.classList.add('hidden');

    }
}



// ------------------------------------------------------------------------
// [신규] 텍스트 드래그 시 Floating AI 수정 툴팁 렌더링 로직 추가
// ------------------------------------------------------------------------
window.initSelectionHoverUI = function () {
    document.addEventListener('selectionchange', () => {
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

        // 선택된 Range의 화면 좌표 계산
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        const tooltip = document.getElementById('ai-floating-toolbar');
        if (tooltip && rect.width > 0 && rect.height > 0) {
            // 위치 계산 (선택 영역의 중앙 상단 바깥쪽)
            const top = rect.top + window.scrollY - 10; // 10px 위로 띄움
            const left = rect.left + window.scrollX + (rect.width / 2);

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
            tooltip.classList.remove('hidden');

            // 약간의 딜레이 후 opacity 전환하여 부드러운 페이드인
            setTimeout(() => {
                tooltip.classList.remove('opacity-0');
            }, 10);
        }
    });

    document.addEventListener('mousedown', (e) => {
        const tooltip = document.getElementById('ai-floating-toolbar');
        if (tooltip && !tooltip.contains(e.target)) {
            // 툴팁 외부 클릭 시 선택이 해제되므로 숨김 처리 보강
            hideHoverTooltip();
        }
    });
};

function hideHoverTooltip() {
    const tooltip = document.getElementById('ai-floating-toolbar');
    if (tooltip && !tooltip.classList.contains('hidden')) {
        tooltip.classList.add('opacity-0');
        setTimeout(() => {
            tooltip.classList.add('hidden');
        }, 200); // transition-opacity duration 후 hidden
    }
}

// 툴팁의 버튼 클릭 시 강제 모드 전환 빛 포커싱
window.activateHoverAIEdit = function () {
    hideHoverTooltip();

    // 선택된 텍스트 보관 및 UI 갱신
    const sel = window.getSelection();
    let text = sel ? sel.toString().trim() : '';
    if (text) {
        window.currentCapturedSelection = text;
        const displayRegion = document.getElementById('ai-selected-text-display');
        const displayContent = document.getElementById('ai-selected-text-content');
        if (displayRegion && displayContent) {
            displayContent.textContent = text;
            displayRegion.classList.remove('hidden');
        }
    }

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

    // v5.9: 강사/학생 뷰 상태 (기본: 강사)
    window.viewMode = 'instructor';

    // v5.9: 키보드 단축키
    document.addEventListener('keydown', (e) => {
        // Escape: 모달 닫기
        if (e.key === 'Escape') {
            const modal = document.getElementById('custom-modal');
            if (modal && !modal.classList.contains('hidden')) modal.classList.add('hidden');
            const batch = document.getElementById('batch-modal');
            if (batch && !batch.classList.contains('hidden')) batch.classList.add('hidden');
        }
        // Ctrl+S: 수동 저장
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveState();
            window.showAlert('저장되었습니다.');
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

                id: 'mainQuest', title: '👑 메인 퀘스트 (최종 과제)', description: '모든 일일 퀘스트를 종합한 최종 평가입니다.', status: 'waiting', content: null, images: {}

            };

        }

    } else {

        courseData = [];

        document.getElementById('topic-input').value = '새 교과';

    }

    currentEditingModuleId = null;

    document.getElementById('editor-content-area').innerHTML = `

                <div class="max-w-[800px] mx-auto p-12 flex flex-col items-center justify-center h-full text-center text-textMuted/50">

                    <i class="ph ph-file-text text-6xl mb-4 opacity-20"></i>

                    <h2 class="text-lg font-bold text-textMuted/60 mb-2">교안 편집 영역</h2>

                    <p class="text-sm leading-relaxed">좌측 목차에서 항목을 선택하거나 생성하면<br>이곳에 상세 내용이 렌더링됩니다.</p>

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



function buildTaskContext(taskScope, additionalContext = "") {

    let systemInstruction = "";

    let userPrompt = "";

    // ── Phase 5 헬퍼: 전체 규칙 빌더 ──
    // Phase P0~P4의 모든 규칙을 하나의 문자열로 빌드
    function buildFullRules(keyConcepts) {
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
            r.evidence_based,
            r.table_html_style,
            r.spacing,
            r.formatting_workflow,
            r.instructor_callout,
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
            '4. 분량 기준: 기본 학습(개요+학습목표+핵심내용) 영역은 공백과 서식(마크다운 기호, HTML 태그)을 제외한 순수 텍스트 기준 최소 7,000자를 충족하는가? 기본 실습·심화는 필요한 항목만 포함되면 분량 무관.\n' +
            '5. 서식 준수: 헤딩 위계, 아이콘, 간격, 이미지 태그 규칙을 모두 지켰는가?\n' +
            '6. 구조 연결성: 개요→핵심→실습→심화의 흐름이 자연스러운가?\n' +
            '7. 용어 일관성: 과정/교과/차시/레벨테스트/기본실습 등 glossary 정의와 일치하는가?\n' +
            '8. 서식 워크플로우 준수: 파싱→타이포매핑→아이콘주입→들여쓰기→간격적용→톤적용 순서를 따랐는가?';

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
            const unitCount = parseInt(document.getElementById('unit-count-input')?.value) || 1;
            const totalLessons = sidebarLessonCount; // 사용자가 설정한 차시 수를 그대로 사용
            systemInstruction = `${CONTEXT_CORE.personas.orchestrator}\n[규칙]\n- ${CONTEXT_CORE.rules.json_only}\n- 차시 수는 반드시 정확히 ${totalLessons}개로 구성하세요. (사용자가 ${totalLessons}차시를 요청했습니다. 더 적게 생성하지 마세요.)`;

            userPrompt = `[현재 작업: 목차 설계]\n주제: ${additionalContext}\n- 생성할 차시 수: ${totalLessons}개 (반드시 이 수만큼 생성)${getReferenceContext(4000)}`;

            break;

        case 'module':

            systemInstruction = `${CONTEXT_CORE.personas.instructor}\n[작성 규칙]\n${buildFullRules(additionalContext.keyConcepts)}`;

            // F2: 분할 생성 지시
            systemInstruction += '\n\n[분량 관리]\n' +
                '- 교안 전체를 한 번에 작성하세요. 단, 출력이 길어져 중간에 잘릴 경우를 대비하여 다음 규칙을 따르세요.\n' +
                '- 모든 섹션을 완전히 작성한 경우: 문서의 맨 마지막에 <!-- END -->를 붙이세요.\n' +
                '- 출력 한도에 도달하여 교안이 미완성인 경우: 자연스러운 문단/섹션 끝에서 멈추고 <!-- CONTINUE -->를 붙이세요. 문장 중간에서 끊지 마세요.';



            if (additionalContext.uploadedMdContent) {

                const safeMd = cleanForAPI(additionalContext.uploadedMdContent);

                userPrompt = `${thinkingPrefix}[현재 작업: 사용자 제공 문서 기반 교안 재구성]\n모듈명: ${additionalContext.title}\n설명: ${additionalContext.description}\n\n[사용자 제공 원본 마크다운 데이터]\n${safeMd}\n\n위 원본 데이터를 철저히 분석하여, 제공된 내용을 바탕으로 우리 교안 규격(1.개요, 2.학습 목표, 3.핵심 내용, 4.실습/예제, 5.심화)에 맞게 다듬고 재구성해 주세요. 원본의 핵심 내용과 의도를 절대 누락하지 말고 최우선으로 반영해야 합니다.`;

            } else {

                userPrompt = `${thinkingPrefix}[현재 작업: 상세 교안 작성]\n모듈명: ${additionalContext.title}\n설명: ${additionalContext.description}`;

            }

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
            systemInstruction = `${CONTEXT_CORE.personas.instructor}\n[작성 규칙]\n${buildFullRules(additionalContext.keyConcepts)}`;
            systemInstruction += '\n\n[이어쓰기 규칙]\n' +
                '- 아래 "이전 작성 내용"의 마지막 부분부터 이어서 작성하세요.\n' +
                '- 이전에 작성한 내용을 절대 반복하지 마세요. 중복 헤딩이나 중복 문단을 생성하면 안 됩니다.\n' +
                '- 이전 내용의 마지막 헤딩/문단을 확인하고, 그 다음 섹션부터 자연스럽게 연결하세요.\n' +
                '- 교안 구조에서 아직 작성되지 않은 남은 섹션을 모두 완성하세요.\n' +
                '- 모든 내용을 마쳤으면 문서 끝에 <!-- END -->를 붙이세요.';

            if (additionalContext.hasMainQuest) {
                systemInstruction += `\n- 차시 내용의 마지막(5번 항목 아래)에는 반드시 '# ⚔️ 일일 퀘스트 (실습 과제)' 항목을 만들어주세요.`;
            }

            userPrompt = `[현재 작업: 교안 이어쓰기 (${additionalContext.chunkIndex}번째 연속)]\n모듈명: ${additionalContext.title}\n설명: ${additionalContext.description}\n\n[이전 작성 내용 — 여기서부터 이어쓰세요]\n${additionalContext.previousContent}`;
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

        case 'tone':

            systemInstruction = `${CONTEXT_CORE.personas.assistant}\n[규칙]\n- 반드시 한국어로만 작성하세요. 영어로 작성하지 마세요.\n- 마크다운 구조(#, ##, ###, *, - 등)를 원본과 동일하게 유지하세요.\n- <!-- IMG --> 태그, <div>, <img>, <button> 등 모든 HTML 요소는 절대 수정하지 말고 원본 그대로 보존하세요.\n- 텍스트 내용의 문체(톤앤매너)만 변환하고, 핵심 정보와 의미를 누락하지 마세요.\n- ${CONTEXT_CORE.rules.concise_edit}`;

            userPrompt = `[현재 작업: 문체 변환]\n[변환 지시]\n${additionalContext.tonePrompt}\n\n[원본 교안 — 반드시 한국어로 변환 결과를 출력하세요]\n${additionalContext.content}`;

            break;

        case 'volume':

            systemInstruction = `${CONTEXT_CORE.personas.assistant}\n[규칙]\n- 반드시 한국어로만 작성하세요. 영어로 작성하지 마세요.\n- 마크다운 구조(#, ##, ###, *, - 등)를 원본과 동일하게 유지하세요.\n- <!-- IMG --> 태그, <div>, <img>, <button> 등 모든 HTML 요소는 절대 수정하지 말고 원본 그대로 보존하세요.\n- 텍스트 분량만 조절하고, 핵심 정보와 의미를 누락하지 마세요.\n- ${CONTEXT_CORE.rules.concise_edit}`;

            userPrompt = `[현재 작업: 분량 조절]\n[조절 지시]\n${additionalContext.volumePrompt}\n\n[원본 교안 — 반드시 한국어로 조절 결과를 출력하세요]\n${additionalContext.content}`;

            break;

        // ─── 병합 재생성 ───
        case 'merge':
            systemInstruction = `${CONTEXT_CORE.personas.instructor}\n[작성 규칙]\n${buildFullRules()}\n\n[병합 재생성 지시]\n- 아래 제공되는 여러 차시의 교안 내용을 하나의 통합된 교안으로 재구성하세요.\n- 중복되는 내용은 제거하고, 논리적 흐름으로 재배열하세요.\n- 모든 핵심 개념을 누락 없이 포함하세요.`;
            userPrompt = `${thinkingPrefix}[현재 작업: 교안 병합 재생성]\n병합 대상 차시: ${additionalContext.titles.join(', ')}\n\n[원본 차시 내용들]\n${additionalContext.mergedContext}`;
            break;

        // ─── 탭별 교안 생성 ───
        case 'tab_content': {
            // 탭별 규칙 필터링 — 학습탭에 실습/평가/강사가이드 혼입 방지
            // v8: 학습 탭에도 강사 callout 포함 (읽기만 해도 수업 가능)
            // "교강사 가이드 섹션"은 탭 범위 제한에서 금지하되, 각 ##섹션 뒤 인라인 callout은 허용
            const tabRuleExclusions = {
                basicLearn: ['rubric_100', 'quiz_format'],
                advLearn: ['rubric_100', 'quiz_format'],
                basicPrac: ['rubric_100', 'quiz_format'],
                advPrac: ['rubric_100', 'quiz_format'],
                assessment: ['instructor_callout', 'image_tags', 'mermaid_rules']
            };
            const excludeKeys = tabRuleExclusions[additionalContext.tabId] || [];

            // 탭 전용 규칙 빌더 (buildFullRules 변형)
            function buildTabRules(keyConcepts) {
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
                    ['evidence_based', r.evidence_based],
                    ['table_html_style', r.table_html_style],
                    ['spacing', r.spacing],
                    ['formatting_workflow', r.formatting_workflow],
                    ['instructor_callout', r.instructor_callout],
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
                if (additionalContext.tabId === 'basicLearn' || additionalContext.tabId === 'advLearn') {
                    rules += '\n\n[탭 범위 제한 — 절대 준수]\n' +
                        '- 이 탭은 "학습" 전용입니다. 다음 내용을 절대 포함하지 마세요:\n' +
                        '  * 실습 과제, 실습 가이드, 실습 예제\n' +
                        '  * 평가 기준표, 채점 기준, 루브릭\n' +
                        '  * 일일 퀘스트, 과제 제출\n' +
                        '- 개념 설명, 이론, 사례 분석에만 집중하세요.\n\n' +
                        '[강사 스크립트 규칙 — 학습 탭에서도 반드시 포함]\n' +
                        '- 각 ## 섹션 직후에 <div class="instructor-callout"> 강사 스크립트를 반드시 삽입하세요.\n' +
                        '- 이 스크립트는 강사가 교안을 읽기만 해도 바로 수업할 수 있도록 충분히 상세하게 작성하세요.\n' +
                        '- 단, ## 🎓 교강사 가이드 (강사 전용) "섹션"은 학습 탭에 포함하지 마세요. (이 섹션은 기본실습/심화실습 탭에서 작성)';
                }

                if (keyConcepts && keyConcepts.length > 0) {
                    rules += `\n- 다음 핵심 개념을 반드시 포함하여 교안을 구성하세요: ${keyConcepts.join(', ')}`;
                }

                if (CONTEXT_CORE.fewshot_cases && additionalContext.tabId !== 'assessment') {
                    rules += '\n\n' + CONTEXT_CORE.fewshot_cases;
                }

                return rules;
            }

            systemInstruction = `${CONTEXT_CORE.personas.instructor}\n[작성 규칙]\n${buildTabRules(additionalContext.keyConcepts)}`;

            const tabPrompts = {
                basicLearn: '이 교안의 "기본 학습" 영역을 작성하세요. 개요, 학습 목표, 핵심 내용(개념 정의, 이론 설명, 예시, 사례 분석)만 포함합니다. 실습, 평가, 강사 가이드는 다른 탭에서 작성하므로 여기서는 절대 포함하지 마세요. 초보자도 이해할 수 있는 수준으로 설명하세요.\n' +
                    '[분량 규칙 — 절대 준수]\n' +
                    '- 순수 텍스트(마크다운 서식 제외) 최소 12,000자 이상.\n' +
                    '- 마크다운 줄 수 기준 최소 350줄 이상.\n' +
                    '- ## 대주제 최소 4개, ### 소주제 최소 8개.\n' +
                    '- 각 소주제마다 Key Concept 불릿 최소 6개, 구체적 사례(게임명 명시) 최소 2개.\n' +
                    '- 표(Table) 최소 3개, mermaid 다이어그램 최소 1개.\n' +
                    '- 짧은 교안은 불합격 처리됩니다. 충분히 상세하게 작성하세요.',
                basicPrac: '이 교안의 "기본 실습" 영역을 작성하세요. 학생이 핵심 내용을 직접 체험하는 실습 과제를 설계하세요. 각 실습에 예상 소요시간, 난이도(초급), 평가 기준을 명시하세요. 이론 설명은 최소화하고 실습 과제 설계에 집중하세요.',
                advLearn: '이 교안의 "심화 학습" 영역을 작성하세요. 기본 학습의 개념을 더 깊이 파고들어 고급 이론, 업계 사례, 실무적 분석을 제공하세요. 실습, 평가, 강사 가이드는 다른 탭에서 작성하므로 여기서는 절대 포함하지 마세요.\n' +
                    '[분량 규칙 — 절대 준수]\n' +
                    '- 순수 텍스트(마크다운 서식 제외) 최소 12,000자 이상.\n' +
                    '- 마크다운 줄 수 기준 최소 350줄 이상.\n' +
                    '- ## 대주제 최소 3개, ### 소주제 최소 6개.\n' +
                    '- 각 소주제마다 심화 분석, 실무 사례, 전문가 관점을 포함.\n' +
                    '- 짧은 교안은 불합격 처리됩니다.',
                advPrac: '이 교안의 "심화 실습" 영역을 작성하세요. 도전적이고 창의적인 프로젝트형 과제를 설계하세요. 난이도(중급~고급), 평가 기준을 명시하세요. 이론 설명은 최소화하고 실습 과제 설계에 집중하세요.',
                assessment: '이 교안의 "학습 이해도 점검" 영역을 작성하세요.\n' +
                    '[형식 규칙 — 반드시 준수]\n' +
                    '1. **5지선다 객관식 10문제**: 각 문제에 ①②③④⑤ 5개의 선택지를 제공. 단답형(정답 1개) 또는 복수정답 가능.\n' +
                    '2. 복수정답 문제는 제목에 "(복수정답)" 라벨 표기.\n' +
                    '3. 각 문제에 **힌트** 1줄 제공 (예: "💡 힌트: ○○ 섹션을 복습하세요").\n' +
                    '4. **정답 표기**: 정답 선택지는 <span style="color: #22c55e; font-weight: bold;"> 태그로 감싸서 녹색 강조.\n' +
                    '5. 각 문제 하단에 **해설** 포함.\n' +
                    '6. 마지막에 **채점 기준표**를 100점 만점 루브릭(S/A/B/C/F)으로 작성.\n\n' +
                    '[단락 구분 규칙 — 절대 준수]\n' +
                    '- 각 문제는 반드시 `---` 수평선으로 구분하세요.\n' +
                    '- 문제 번호는 `### 문제 N.` 형식(H3 제목)으로 시작하세요.\n' +
                    '- 선택지는 각 줄에 하나씩 작성하세요 (① ② ③ ④ ⑤).\n' +
                    '- 힌트, 정답, 해설은 각각 별도 줄에 빈 줄로 구분하세요.\n' +
                    '- 복수정답인 경우 정답을 한 줄에 횡으로 나열하세요: `✅ **정답:** ①, ②, ④`\n' +
                    '- 단일정답인 경우: `✅ **정답:** ③`\n' +
                    '- 구조 예시:\n' +
                    '```\n### 문제 1. 제목\n\n① 선택지1\n② 선택지2\n③ 선택지3\n④ 선택지4\n⑤ 선택지5\n\n💡 **힌트:** 힌트 내용\n\n✅ **정답:** ②\n\n📝 **해설:** 해설 내용\n\n---\n\n### 문제 2. 제목 (복수정답)\n\n① 선택지1\n② 선택지2\n③ 선택지3\n④ 선택지4\n⑤ 선택지5\n\n💡 **힌트:** 힌트 내용\n\n✅ **정답:** ①, ②, ④\n\n📝 **해설:** 해설 내용\n\n---\n```'
            };
            const tabInstruction = tabPrompts[additionalContext.tabId] || tabPrompts.basicLearn;

            userPrompt = `${thinkingPrefix}[현재 작업: 탭별 교안 작성 — ${additionalContext.tabLabel}]\n모듈명: ${additionalContext.title}\n설명: ${additionalContext.description}\n\n[탭 작성 지시]\n${tabInstruction}`;
            userPrompt += getCurriculumOutline();
            userPrompt += getReferenceContext(8000);

            if (additionalContext.otherTabContents) {
                userPrompt += '\n\n[다른 탭 내용 요약 — 중복 방지 참고용]\n' + additionalContext.otherTabContents;
            }
            break;
        }

    }



    return { systemInstruction, userPrompt };
}

// =========================================================================
// [Phase F10] 캐시 보관함 (로컬 이미지 저장소) UI 컨트롤러
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
                            <h4 class="text-[0.75rem] font-bold text-white truncate" title="${item.keyword}">${item.keyword}</h4>
                            <p class="text-[0.6rem] text-textMuted mt-0.5">${dateStr} · ${item.format}</p>
                        </div>
                        <button onclick="deleteSingleCache('${item.keyword}')" class="w-6 h-6 flex items-center justify-center rounded bg-rose-500/10 hover:bg-rose-500/30 text-rose-400 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                            <i class="ph-bold ph-trash text-xs"></i>
                        </button>
                    </div>
                    <div class="aspect-video bg-black/40 rounded flex items-center justify-center overflow-hidden border border-white/5">
                        <img src="${item.base64}" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt="Cached Image">
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

