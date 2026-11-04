// sidebar-layout.js - 사이드바 정리: 목차 만들기 영역과 교과 도구를 접어 차시 목록이 먼저 보이게 한다
// 접힘 상태는 이 브라우저에 기억한다. 처음에는 차시가 있으면 목차 만들기를 접고, 교과 도구는 머리줄(요약·바로 쓰는 버튼)만 보인다.

const SIDEBAR_STATE_KEY = 'sidebar_sections';

function readSidebarState() {
    try {
        return JSON.parse(localStorage.getItem(SIDEBAR_STATE_KEY) || '{}') || {};
    } catch (e) {
        console.warn('사이드바 접힘 상태를 읽지 못했습니다:', e);
        return {};
    }
}

function saveSidebarState(id, open) {
    try {
        localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify({ ...readSidebarState(), [id]: open }));
    } catch (e) {
        console.warn('사이드바 접힘 상태를 저장하지 못했습니다:', e);
    }
}

// 고른 적이 없으면 기본값을 쓴다
const isSidebarSectionOpen = (id, fallback = false) => readSidebarState()[id] ?? fallback;

/* ---------- 접는 섹션 ---------- */
// 머리줄을 누르면 접고 편다. 접어도 요약(summaryHtml)과 바로 쓰는 버튼(actions)은 머리줄에 남는다
// summaryHtml·actions·body는 부르는 쪽이 이스케이프한 HTML이다
function sidebarSectionHtml(id, { icon, title, summaryHtml = '', actions = '' }, body) {
    const open = isSidebarSectionOpen(id);
    return `
        <section class="mb-2 rounded-xl border border-white/10 bg-bgSidebar" data-sidebar-section="${id}">
            <div class="flex items-center gap-2 px-2.5 py-2">
                <button type="button" onclick="toggleSidebarSection('${id}')" aria-expanded="${open}" class="flex items-center gap-2 min-w-0 flex-1 text-left" title="${escapeHtml(title)} 접기·펼치기">
                    <i class="ph-bold ph-caret-right text-textMuted transition-transform ${open ? 'rotate-90' : ''}" data-sidebar-caret></i>
                    <i class="ph-fill ${icon} text-accent"></i>
                    <span class="text-xs font-bold text-textLight shrink-0">${escapeHtml(title)}</span>
                    <span class="min-w-0 text-[0.6875rem] text-textMuted truncate">${summaryHtml}</span>
                </button>
                ${actions}
            </div>
            <div class="px-2.5 pb-2.5 ${open ? '' : 'hidden'}" data-sidebar-body>${body}</div>
        </section>`;
}

// 다시 그리지 않고 표시만 바꾼다. 안의 입력칸(파일명 규칙 등)이 그대로 남는다
window.toggleSidebarSection = function (id) {
    const section = document.querySelector(`[data-sidebar-section="${id}"]`);
    const body = section?.querySelector('[data-sidebar-body]');
    if (!body) return;
    const open = body.classList.contains('hidden');
    body.classList.toggle('hidden', !open);
    section.querySelector('[data-sidebar-caret]')?.classList.toggle('rotate-90', open);
    section.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', String(open));
    saveSidebarState(id, open);
};

/* ---------- 목차 만들기 영역 ---------- */
// 주제·참고자료·단원 수·AI 차시 목차 생성. 차시가 생기면 처음에는 접는다 (머리줄의 차시 수와 AI 목차 생성은 늘 보인다)
window.applySidebarSetupState = function (lessonCount) {
    const body = document.getElementById('sidebar-setup-body');
    const toggle = document.getElementById('sidebar-setup-toggle');
    if (!body || !toggle) return;
    const open = isSidebarSectionOpen('setup', lessonCount === 0);
    body.classList.toggle('hidden', !open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('[data-setup-caret]')?.classList.toggle('rotate-90', open);
};

window.toggleSidebarSetup = function () {
    const body = document.getElementById('sidebar-setup-body');
    if (!body) return;
    saveSidebarState('setup', body.classList.contains('hidden'));
    window.applySidebarSetupState(courseData.length);
};

/* ---------- 차시 카드 ---------- */
const LESSON_CARD_ICON = 'w-6 h-6 inline-flex items-center justify-center rounded hover:bg-white/10 transition-colors';
const LESSON_CARD_QUIET = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100';

function lessonUploadHtml(mod) {
    if (mod.uploadedMdName) return '';
    return `<label class="${LESSON_CARD_ICON} ${LESSON_CARD_QUIET} text-white/70 hover:text-white cursor-pointer" onclick="event.stopPropagation();" title="기존 마크다운 파일 올리기">
        <i class="ph-bold ph-upload-simple"></i><input type="file" accept=".md" class="hidden" aria-label="마크다운 파일 올리기" onchange="handleFileUpload(event, ${mod.id})"></label>`;
}

// 올린 파일은 상태 칩 줄에 보이고 거기서 취소한다
function lessonUploadedChip(mod) {
    if (!mod.uploadedMdName) return '';
    const name = escapeHtml(mod.uploadedMdName);
    return `<span class="inline-flex items-center gap-1 text-[0.6875rem] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
        <i class="ph-bold ph-file-md"></i><span class="max-w-[90px] truncate" title="${name}">${name}</span>
        <button onclick="event.stopPropagation(); cancelFileUpload(${mod.id})" class="hover:text-white" title="올린 파일 취소" aria-label="올린 파일 취소"><i class="ph-bold ph-x"></i></button></span>`;
}

// 번호·코드·제목·설명 한 줄과 상태 칩만 늘 보인다. 교안 생성은 늘 보이고, 올리기·순서·삭제는 카드에 마우스를 올리면 보인다
function lessonCardHtml(mod, idx) {
    const generated = mod.status === 'done';
    const generateLabel = generated ? '교안 다시 생성' : '교안 생성';
    return `
        <div class="module-card group ${lessonMatchesFilter(mod) ? '' : 'hidden'} bg-white/5 border ${generated ? 'border-green-500/30' : 'border-white/10'} rounded-xl p-3 mb-2 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg transition-all"
             data-id="${mod.id}" draggable="true" onclick="viewModule(${mod.id})" style="animation-delay: ${idx * 0.05}s">
            <div class="flex items-center justify-between gap-2 mb-1">
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <input type="checkbox" class="merge-checkbox w-3.5 h-3.5 accent-accent shrink-0 cursor-pointer" data-lesson-id="${mod.id}" onchange="toggleMergeCheckbox('${mod.id}')" onclick="event.stopPropagation()" aria-label="병합할 차시로 고르기">
                    <span class="inline-flex items-center justify-center w-6 h-6 rounded bg-accent/20 text-accent font-bold text-xs shrink-0">${idx + 1}</span>
                    ${lessonNcsCodeHtml(mod)}
                </div>
                <div class="flex items-center shrink-0">
                    <button onclick="event.stopPropagation(); promptAndGenerateModule(${mod.id})" class="${LESSON_CARD_ICON} ${generated ? 'text-white/70 hover:text-white' : 'text-accent'}" title="${generateLabel}" aria-label="${generateLabel}"><i class="ph-bold ${generated ? 'ph-arrows-clockwise' : 'ph-sparkle'}"></i></button>
                    ${lessonUploadHtml(mod)}
                    <button class="${LESSON_CARD_ICON} ${LESSON_CARD_QUIET} text-white/70 hover:text-white cursor-grab drag-handle" title="순서 변경" aria-label="순서 변경"><i class="ph-bold ph-list"></i></button>
                    <button onclick="event.stopPropagation(); deleteModule(${mod.id})" class="${LESSON_CARD_ICON} ${LESSON_CARD_QUIET} text-red-400/80 hover:text-red-400" title="차시 삭제" aria-label="차시 삭제"><i class="ph-bold ph-x"></i></button>
                </div>
            </div>
            <h3 class="font-bold text-sm text-white outline-none focus:bg-white/10 rounded px-1 -ml-1" contenteditable="true" spellcheck="false" onblur="updateModuleMeta(${mod.id}, 'title', this.innerText)" onclick="event.stopPropagation()">${escapeHtml(mod.title)}</h3>
            <p class="text-xs text-textMuted line-clamp-1 focus:line-clamp-none outline-none focus:bg-white/10 rounded px-1 -ml-1" contenteditable="true" spellcheck="false" onblur="updateModuleMeta(${mod.id}, 'description', this.innerText)" onclick="event.stopPropagation()">${escapeHtml(mod.description)}</p>
            ${renderLessonMetaChips(mod, { extra: lessonUploadedChip(mod) })}
        </div>`;
}
