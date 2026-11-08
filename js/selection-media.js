// selection-media.js - 교안 본문(보기 화면)에서 글을 끌어 고르면 고른 글 아래에 'GIF 만들기'·'판서 영상 만들기'를 띄운다
// GIF 만들기: 앱의 그림 경로(api.js extractSearchIntent·generateImageAPI)로 고른 글에 맞는 그림을 그리고, 움직이는 GIF 창(image-motion.js openImageMotionInsert)에서
//   그림 속 관계를 읽어 GIF로 만든 뒤 고른 글이 든 단락 바로 아래에 새 그림으로 넣는다. 넣기 전 글은 작업 기록에 남고(lesson-review.js commitTabChange) Ctrl+Z로도 되돌린다
// 판서 영상 만들기: 고른 글과 그 글이 든 절의 제목만 화이트보드 교안 스튜디오로 넘긴다(whiteboard-link.js와 같은 넘기기 약속, 돌려받을 그림 자리는 없다)
// 서식 막대(format-toolbar.js·ui.js)는 고른 글 위에 뜨고 이 메뉴는 고른 글 아래(서식 막대가 아래에 떴으면 그 밑)에 뜬다. 테스트: tests/selection-media.test.js

const SELECTION_MENU_ID = 'selection-media-menu';
const SELECTION_MEDIA_DELAY = 150; // 고르기를 멈춘 뒤 메뉴를 띄우기까지(ms). 두 번 눌러 단락을 고칠 때 잠깐 골라지는 낱말에는 뜨지 않게
const SELECTION_RELEASE_DELAY = 30; // 마우스를 놓은 뒤(ms). 서식 막대가 자리를 잡은 뒤 그 아래를 비켜 둔다
const SELECTION_MEDIA_MIN = 2; // 빈칸을 뺀 고른 글자가 이보다 적으면 띄우지 않는다
const SELECTION_MENU_SIZE = { width: 260, height: 36 }; // 메뉴 크기를 잴 수 없을 때
const SELECTION_VIEWPORT = { width: 1280, height: 800 }; // 화면 크기를 잴 수 없을 때
const SELECTION_MENU_GAP = 8; // 고른 글(서식 막대)과 메뉴 사이, 화면 가장자리와 메뉴 사이
const SELECTION_CONTEXT_MAX = 1200; // 그림 요청을 정할 때 함께 보내는 주변 글
const SELECTION_KEYWORD_MAX = 120; // 그림 칸의 다시 찾기 검색어
const SELECTION_CAPTION_MAX = 80; // 그림 설명(api.js 그림 칸과 같다)
// 고른 글로 치지 않는 화면 장치: 버튼(다시 찾기·삭제·판서 영상·GIF·코드 복사), 영상·다이어그램·입력칸, 단락 편집 상자
const SELECTION_SKIP = 'button, [data-lesson-action], video, audio, svg, canvas, script, style, textarea, input, select, .mermaid, .prompt-overlay, .para-edit';
const SELECTION_LINE = 'p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, tr, td, th, dt, dd, div, figcaption, caption'; // 줄을 나누는 요소
const SELECTION_CELL = /^(?:TD|TH)$/;
const SELECTION_HEADING = /^H[1-6]$/;
const SELECTION_MARK_HEADING = /^\s*[■□▶▷●◆◇★☆▣]/; // '■ 제목' 같은 굵은 소제목 줄(whiteboard-video.js와 같다)
const SELECTION_NO_TEXT = ' No text, no letters, no words, no labels, no watermark anywhere in the image.';
const SELECTION_PICTURE_LINKS = ' Draw the parts as separate simple shapes joined by clear arrows or lines so the flow between them is easy to follow.';
const SELECTION_META_LABELS = /["']?(상세\s*교안|교육용\s*일러스트|교안|학습\s*이해도|기본\s*학습|심화\s*학습)["']?/g; // 그림 요청에 섞인 한국어 표시(api.js processImageTags와 같다)
const DOC_PRECEDING = 2; // Node.DOCUMENT_POSITION_PRECEDING
const DOC_FOLLOWING = 4;
const DOC_CONTAINED_BY = 16;

const SELECTION_MEDIA_TEXT = {
    label: '고른 글로',
    gifTitle: '고른 글에 맞는 그림을 AI가 그리고 그림 속 연결이 보이게 움직이는 GIF로 만들어 이 단락 아래에 넣습니다(먼저 비용과 시간을 보여 줍니다)',
    whiteboardTitle: '고른 글을 화이트보드 교안 스튜디오로 넘겨 나레이션이 있는 판서 영상을 만듭니다(새 탭)',
    gifConfirm: '고른 글에 맞는 그림을 AI가 한 장 그린 뒤, 그림 속 연결을 읽어 움직이는 GIF로 만듭니다. 만든 GIF를 미리 보고 넣을지 고르며, 넣으면 고른 글이 든 단락 바로 아래에 들어갑니다. 넣기 전 글은 작업 기록에 남습니다.',
    bankTab: '학습이해도·심화이해도에는 그림을 넣지 않습니다. 이 탭에서는 판서 영상 만들기만 쓸 수 있습니다.',
    busy: '진행 중인 생성이 끝난 뒤 다시 시도해주세요.',
    noKey: 'AI 키가 없어 그림을 그릴 수 없습니다. 오른쪽 위 ⚙ 설정에서 키를 넣은 뒤 다시 눌러 주세요.',
    lost: '고른 글을 읽지 못했습니다. 본문 글자를 다시 끌어 골라 주세요.',
    moved: '다른 차시나 탭으로 옮겨 넣지 않았습니다. 그 탭에서 글을 다시 골라 눌러 주세요.',
    dialogOpen: '움직이는 GIF 창이 이미 열려 있습니다. 그 창을 닫은 뒤 다시 눌러 주세요.',
    emptyTab: '이 탭에 글이 없어 그림을 넣지 않았습니다.',
    insertedGif: '고른 글이 든 단락 아래에 움직이는 GIF를 넣었습니다. Ctrl+Z나 작업 기록에서 되돌릴 수 있습니다.',
    insertedStill: '고른 글이 든 단락 아래에 그림을 넣었습니다. Ctrl+Z나 작업 기록에서 되돌릴 수 있습니다.',
    insertedEnd: '고른 단락을 원문에서 찾지 못해 탭 끝에 넣었습니다. 원하는 자리로 옮겨 주세요. Ctrl+Z나 작업 기록에서 되돌릴 수 있습니다.',
    reason: '그림 넣기 전' // 작업 기록에 보일 까닭
};

let _selectionPick = null; // 메뉴가 가리키는 고른 글(readLessonSelection)
let _selectionTimer = null;
let _selectionDismissed = false; // Esc로 닫았다(다시 고르면 다시 띄운다)
let _selectionDragging = false; // 마우스로 끄는 중(놓을 때 띄운다)
let _selectionReady = false;

/* ---------- 고른 글 읽기 ---------- */
// 고를 수 있는 보기 화면. 원문 전체 수정·단락 고치기 중이거나 다른 항목이 가렸으면(슬라이드·문제은행·교수안, api.js lessonViewCovered) null
function selectionMediaView() {
    const view = document.getElementById('render-view');
    if (!view) return null;
    const covered = typeof lessonViewCovered === 'function' ? lessonViewCovered(view) : view.classList.contains('hidden');
    if (covered) return null;
    const raw = document.getElementById('raw-view');
    if (raw && !raw.classList.contains('hidden')) return null;
    return view.querySelector('.para-edit, textarea') ? null : view;
}

// 그 차시·탭의 저장된 글(lesson-review.js storedTabMarkdown)
function selectionTabText(mod, tabId) {
    if (typeof storedTabMarkdown === 'function') return String(storedTabMarkdown(mod, tabId) || '');
    return String(mod?.tabContents?.[tabId] || mod?.content || '');
}

// 조각(글자 조각·줄바꿈 요소)이 고른 범위의 시작 뒤에 있는가. 범위 끝은 글자 조각 안(글자 자리)이거나 요소 안(자식 자리)이다
function selectionAfterStart(node, range) {
    const box = range.startContainer;
    if (box.nodeType === 3) return node === box || !!(box.compareDocumentPosition(node) & DOC_FOLLOWING);
    const child = box.childNodes[range.startOffset];
    if (child) return node === child || !!(child.compareDocumentPosition(node) & DOC_FOLLOWING); // 그 자식 안도 뒤로 친다
    const at = box.compareDocumentPosition(node);
    return !!(at & DOC_FOLLOWING) && !(at & DOC_CONTAINED_BY); // 요소 끝 자리: 그 요소 밖의 뒤
}

function selectionBeforeEnd(node, range) {
    const box = range.endContainer;
    if (box.nodeType === 3) return node === box || !!(box.compareDocumentPosition(node) & DOC_PRECEDING);
    const child = range.endOffset > 0 ? box.childNodes[range.endOffset - 1] : null;
    if (child) return node === child || !!(child.compareDocumentPosition(node) & (DOC_PRECEDING | DOC_CONTAINED_BY));
    return !!(box.compareDocumentPosition(node) & DOC_PRECEDING); // 요소 첫 자리: 그 요소 앞
}

// 고른 범위 안의 글(시작·끝 조각은 고른 만큼만). 줄바꿈 요소(br)는 줄바꿈
function selectionPartOf(node, range) {
    if (!selectionAfterStart(node, range) || !selectionBeforeEnd(node, range)) return '';
    if (node.nodeType !== 3) return '\n';
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.data.length;
    return node.data.slice(from, to);
}

// 화면 장치를 뺀 글자 조각과 줄바꿈 요소(문서 순서)
function selectionTextNodes(el, out = []) {
    for (let child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) out.push(child);
        else if (child.nodeType === 1 && child.tagName === 'BR') out.push(child);
        else if (child.nodeType === 1 && !child.matches(SELECTION_SKIP)) selectionTextNodes(child, out);
    }
    return out;
}

// 줄이 바뀔 때 넣을 글: 같은 표 줄의 칸 사이는 빈칸, 나머지는 줄바꿈
const selectionLineBreak = (prev, next) => (SELECTION_CELL.test(prev.tagName) && SELECTION_CELL.test(next.tagName) && prev.parentElement === next.parentElement ? ' ' : '\n');

// 블록 하나의 글. 줄 단위 요소(문단·목록 항목·표 줄)가 바뀌면 줄을 나누고 블록 사이의 줄바꿈 조각은 뺀다. 코드 블록은 들여쓰기를 둔다.
// partOf(조각)이 돌려준 글만 쓴다(''이면 뺀다)
function selectionBlockText(block, partOf) {
    let text = '';
    let line = null;
    selectionTextNodes(block).forEach(node => {
        const part = partOf(node);
        if (!part || (node.nodeType === 3 && !part.trim() && part.includes('\n'))) return;
        const at = (node.parentElement || block).closest(SELECTION_LINE);
        const here = at && block.contains(at) ? at : block;
        if (line && here !== line) text += selectionLineBreak(line, here);
        line = here;
        text += part;
    });
    const rows = text.replace(/ /g, ' ').split('\n');
    if (block.matches('pre') || block.querySelector('pre')) return rows.map(row => row.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
    return rows.map(row => row.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

// 고른 범위의 글을 화면 블록(#render-view의 자식)마다 모은다: [{ el, index, text }]. 고른 글이 없는 블록은 뺀다
function selectionPieces(view, range) {
    return [...view.children]
        .map((el, index) => ({ el, index, text: selectionBlockText(el, node => selectionPartOf(node, range)) }))
        .filter(piece => piece.text);
}

// 고른 글이 든 절의 제목 { text, index }: 고른 첫 블록부터 위로 가장 가까운 제목(# 제목이나 '■ 제목' 줄). 없으면 { text: '', index: -1 }
function selectionHeading(view, index) {
    const blocks = [...view.children];
    for (let i = index; i >= 0; i--) {
        const text = (blocks[i].textContent || '').trim();
        const marked = blocks[i].tagName === 'P' && SELECTION_MARK_HEADING.test(text) && text.length <= SELECTION_CAPTION_MAX;
        if (SELECTION_HEADING.test(blocks[i].tagName) || marked) {
            return { text: typeof whiteboardHeadingText === 'function' ? whiteboardHeadingText(text) : text, index: i };
        }
    }
    return { text: '', index: -1 };
}

// 그림을 넣을 원문 블록을 찾는 화면 블록(paragraph-edit.js와 같은 모양, lesson-format.js locateLessonBlock). 그림 칸은 그림 id로 찾는다
function selectionBlockPart(view, el) {
    return {
        index: [...view.children].indexOf(el),
        text: el.textContent || '',
        media: el.matches('img, video, table, svg') || !!el.querySelector('img, video, table, svg'),
        mediaKey: el.querySelector('[data-img-id]')?.getAttribute('data-img-id') || ''
    };
}

// 지금 고른 글. 보기 화면의 교안 본문 안에서 시작한 선택만 받는다(끝이 본문 밖이면 본문 끝까지 쓴다). 쓸 수 없으면 null
// { mod, tabId, text(고른 글, 블록마다 빈 줄), heading(그 글이 든 절의 제목), block(그림을 넣을 단락), context(그림 요청에 쓸 주변 글), rect(고른 글의 화면 자리) }
function readLessonSelection(sel = window.getSelection?.()) {
    const view = selectionMediaView();
    if (!view || !sel || !sel.rangeCount || sel.isCollapsed) return null;
    const mod = typeof getEditingModule === 'function' ? getEditingModule() : null;
    const tabId = typeof currentLessonTab !== 'undefined' ? currentLessonTab : '';
    if (!mod || !tabId || (typeof isViewingTab === 'function' && !isViewingTab(mod, tabId))) return null;
    if (!selectionTabText(mod, tabId).trim()) return null; // 빈 탭의 안내·만드는 중 안내
    if (!sel.anchorNode || !view.contains(sel.anchorNode)) return null; // 본문 밖에서 시작한 선택
    const range = sel.getRangeAt(0);
    const pieces = selectionPieces(view, range);
    if (!pieces.length) return null;
    const heading = selectionHeading(view, pieces[0].index);
    // 제목부터 골랐으면 그 제목은 주제로만 쓴다(넘기는 글에 두 번 쓰지 않게)
    const body = pieces.length > 1 && heading.index === pieces[0].index ? pieces.slice(1) : pieces;
    const text = body.map(piece => piece.text).join('\n\n');
    if (text.replace(/\s/g, '').length < SELECTION_MEDIA_MIN) return null;
    const whole = pieces.map(piece => selectionBlockText(piece.el, node => (node.nodeType === 3 ? node.data : '\n')));
    return {
        mod, tabId, text, heading: heading.text,
        block: selectionBlockPart(view, pieces[pieces.length - 1].el),
        context: [heading.text, ...whole].filter(Boolean).join('\n').slice(0, SELECTION_CONTEXT_MAX),
        rect: typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null
    };
}

/* ---------- 메뉴 ---------- */
// 앱 창(z-[9100]부터)보다 아래, 진행 막대(z-[8000])보다 위에 둔다
function selectionMediaMenu() {
    const found = document.getElementById(SELECTION_MENU_ID);
    if (found) return found;
    const button = 'px-2.5 py-1.5 inline-flex items-center gap-1 text-xs font-bold whitespace-nowrap rounded-lg border transition-colors';
    const menu = document.createElement('div');
    menu.id = SELECTION_MENU_ID;
    menu.setAttribute('role', 'toolbar');
    menu.setAttribute('aria-label', '고른 글로 만들기');
    menu.className = 'fixed z-[9050] hidden transform -translate-x-1/2 flex items-center gap-1 px-1.5 py-1 bg-white border border-gray-200 rounded-xl shadow-lg';
    menu.innerHTML = `
        <span class="px-1 text-[0.6875rem] font-bold text-gray-500 whitespace-nowrap">${SELECTION_MEDIA_TEXT.label}</span>
        <button type="button" data-selection-media="gif" title="${SELECTION_MEDIA_TEXT.gifTitle}" class="${button} bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"><i class="ph-bold ph-gif" aria-hidden="true"></i> GIF 만들기</button>
        <button type="button" data-selection-media="whiteboard" title="${SELECTION_MEDIA_TEXT.whiteboardTitle}" class="${button} bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100"><i class="ph-bold ph-chalkboard-teacher" aria-hidden="true"></i> 판서 영상 만들기</button>`;
    menu.addEventListener('mousedown', event => event.preventDefault()); // 눌러도 본문 선택이 풀리지 않게(서식 막대와 같다)
    menu.addEventListener('click', onSelectionMediaClick);
    document.body.appendChild(menu);
    return menu;
}

function selectionMenuShown() {
    const menu = document.getElementById(SELECTION_MENU_ID);
    return !!menu && !menu.classList.contains('hidden');
}

// 문제은행 탭(학습이해도·심화이해도)에는 그림을 넣지 않는다(컨벤션. 도구 메뉴의 예시 게임 그림 넣기도 감춘다)
const selectionPictureFree = tabId => typeof isQuestionBankTab === 'function' && isQuestionBankTab(tabId);

// 메뉴 자리 { left(가운데), top }: 고른 글 아래 가운데. 서식 막대가 고른 글 아래에 떴으면 그 밑.
// 화면 아래로 넘치면 고른 글 위(서식 막대가 위에 떴으면 그 위)로 올리고, 양옆은 화면 안에 둔다
function selectionMenuPosition(rect, bar, size, viewport) {
    const gap = SELECTION_MENU_GAP;
    const width = size?.width || SELECTION_MENU_SIZE.width;
    const height = size?.height || SELECTION_MENU_SIZE.height;
    const hasBar = !!bar && bar.height > 0;
    const barBelow = hasBar && bar.top >= rect.bottom - 1;
    const barAbove = hasBar && bar.bottom <= rect.top + 1;
    let top = (barBelow ? bar.bottom : rect.bottom) + gap;
    if (top + height > viewport.height - gap) top = (barAbove ? bar.top : rect.top) - gap - height;
    const center = rect.left + rect.width / 2;
    const left = Math.min(Math.max(center, width / 2 + gap), viewport.width - width / 2 - gap);
    return { left: Math.round(left), top: Math.round(Math.max(gap, top)) };
}

function placeSelectionMedia(menu, rect) {
    if (!menu || !rect) return;
    const bar = document.getElementById('ai-floating-toolbar');
    const barRect = bar && !bar.classList.contains('hidden') && typeof bar.getBoundingClientRect === 'function' ? bar.getBoundingClientRect() : null;
    const size = { width: menu.offsetWidth || SELECTION_MENU_SIZE.width, height: menu.offsetHeight || SELECTION_MENU_SIZE.height };
    const viewport = { width: window.innerWidth || SELECTION_VIEWPORT.width, height: window.innerHeight || SELECTION_VIEWPORT.height };
    const at = selectionMenuPosition(rect, barRect, size, viewport);
    menu.style.left = `${at.left}px`;
    menu.style.top = `${at.top}px`;
}

function showSelectionMedia(pick) {
    const menu = selectionMediaMenu();
    _selectionPick = pick;
    menu.querySelector('[data-selection-media="gif"]')?.classList.toggle('hidden', selectionPictureFree(pick.tabId));
    menu.classList.remove('hidden'); // 너비를 재려면 먼저 보여야 한다
    placeSelectionMedia(menu, pick.rect);
}

function hideSelectionMedia() {
    clearTimeout(_selectionTimer);
    _selectionTimer = null;
    _selectionPick = null;
    document.getElementById(SELECTION_MENU_ID)?.classList.add('hidden');
}

function syncSelectionMedia() {
    _selectionTimer = null;
    if (_selectionDragging || _selectionDismissed) return;
    const pick = readLessonSelection();
    if (pick) showSelectionMedia(pick);
    else hideSelectionMedia();
}

/* ---------- 문서 이벤트 ---------- */
// 선택이 풀리면 바로 숨기고, 고르기를 멈추면(끄는 중이면 놓을 때) 다시 읽어 띄운다
function onSelectionMediaChange() {
    _selectionDismissed = false;
    const sel = window.getSelection?.();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return hideSelectionMedia();
    clearTimeout(_selectionTimer);
    _selectionTimer = _selectionDragging ? null : setTimeout(syncSelectionMedia, SELECTION_MEDIA_DELAY);
}

function onSelectionMediaMouseDown(event) {
    if (document.getElementById(SELECTION_MENU_ID)?.contains(event.target)) return;
    hideSelectionMedia();
    _selectionDragging = event.button === undefined || event.button === 0;
}

function onSelectionMediaMouseUp() {
    if (!_selectionDragging) return;
    _selectionDragging = false;
    clearTimeout(_selectionTimer);
    _selectionTimer = setTimeout(syncSelectionMedia, SELECTION_RELEASE_DELAY); // 놓은 뒤 선택이 정해지면 읽는다
}

function onSelectionMediaKey(event) {
    if (event.key !== 'Escape' || !selectionMenuShown()) return;
    _selectionDismissed = true;
    hideSelectionMedia();
}

// 굴리면 고른 글을 따라가고, 고른 글이 화면 밖으로 멀리 가면 숨긴다(서식 막대와 같다, format-toolbar.js onFormatScroll)
function onSelectionMediaScroll() {
    if (!selectionMenuShown()) return;
    const sel = window.getSelection?.();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return hideSelectionMedia();
    const rect = sel.getRangeAt(0).getBoundingClientRect?.();
    if (!rect) return;
    if (rect.bottom < 0 || rect.top > (window.innerHeight || SELECTION_VIEWPORT.height)) return hideSelectionMedia();
    placeSelectionMedia(document.getElementById(SELECTION_MENU_ID), rect);
}

// 메뉴 단추. 누를 때의 선택을 다시 읽고(못 읽으면 띄울 때 읽은 것), 본문 선택을 풀어 서식 막대가 열린 창 위에 남지 않게 한다
function onSelectionMediaClick(event) {
    const button = event.target?.closest?.('[data-selection-media]');
    if (!button) return null;
    const kept = _selectionPick;
    const pick = readLessonSelection() || (kept && typeof isViewingTab === 'function' && isViewingTab(kept.mod, kept.tabId) ? kept : null);
    hideSelectionMedia();
    if (!pick) return window.showToast?.(SELECTION_MEDIA_TEXT.lost, 'warning');
    window.getSelection?.()?.removeAllRanges?.();
    window.hideHoverTooltip?.();
    return button.getAttribute('data-selection-media') === 'gif' ? window.makeSelectionGif(pick) : window.makeSelectionWhiteboard(pick);
}

/* ---------- 판서 영상 만들기 ---------- */
// 스튜디오가 받는 기록(whiteboard-link.js buildWhiteboardHandoff와 같은 모양). 주제는 고른 글이 든 절의 제목(없으면 차시 제목), 내용은 '# 그 제목' 아래 고른 글
function selectionWhiteboardHandoff(mod, subject, pick, now = Date.now()) {
    const body = String(pick?.text || '').trim();
    if (!mod || !body) return null;
    const lessonTitle = stripLessonNumber(mod.title) || String(mod.title || '').trim() || '차시';
    const place = String(pick.heading || '').trim() || lessonTitle;
    const markdown = `# ${place}\n\n${body}`;
    return {
        v: 1,
        from: 'teacher',
        createdAt: now,
        topic: place.slice(0, WHITEBOARD_TOPIC_MAX),
        audience: WHITEBOARD_AUDIENCE,
        fileName: whiteboardFileName({ title: `${mod.title || ''} ${place}` }, subject),
        markdown: markdown.length > WHITEBOARD_MAX_CHARS ? `${markdown.slice(0, WHITEBOARD_MAX_CHARS)}\n\n(이하 생략)` : markdown
    };
}

// '판서 영상 만들기' 창(whiteboard-link.js)에서 주제와 내용을 고쳐 쓴 뒤 스튜디오로 넘긴다. Teacher에서는 AI를 부르지 않는다
window.makeSelectionWhiteboard = function (pick) {
    if (!pick?.mod) return;
    const subject = typeof globalState !== 'undefined' ? (globalState.subjects || []).find(item => item.id === currentSubjectId) : null;
    const handoff = selectionWhiteboardHandoff(pick.mod, subject, pick);
    if (!handoff) return window.showToast?.(SELECTION_MEDIA_TEXT.lost, 'warning');
    confirmWhiteboardHandoff(handoff, `'${handoff.topic}'에서 고른 글로 판서 영상을 만듭니다. 내용을 고쳐 쓰거나 설명을 더 적어도 됩니다.`);
};

/* ---------- GIF 만들기 ---------- */
const selectionOneLine = text => String(text || '').replace(/\s+/g, ' ').trim();
const selectionClip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
// 그림 칸의 다시 찾기 검색어이자 그림 요청을 정할 키워드(api.js imageSlotKeyword: 따옴표·] 등 그림 자리를 깨는 글자를 뺀다)
const selectionKeyword = text => (typeof imageSlotKeyword === 'function' ? imageSlotKeyword(text) : selectionOneLine(text)).slice(0, SELECTION_KEYWORD_MAX).trim();

// 그림 요청: 앱의 그림 경로가 정한 요청(api.js extractSearchIntent의 image_gen_prompt, 없으면 키워드)에 글자 금지와,
// 움직이는 GIF로 만들 수 있게 요소를 선·화살표로 잇는 그림을 붙인다. 화풍은 차시 그림과 같다(withLessonImageStyle)
function selectionImagePrompt(intent, keyword) {
    const asked = typeof intent?.image_gen_prompt === 'string' ? intent.image_gen_prompt.replace(SELECTION_META_LABELS, '').replace(/\s{2,}/g, ' ').trim() : '';
    const base = asked.length > 30 ? asked : `Educational concept diagram representing "${keyword}", 16:9 wide composition.`;
    const plain = /no text/i.test(base) ? base : `${base}${SELECTION_NO_TEXT}`;
    return withLessonImageStyle(`${plain}${SELECTION_PICTURE_LINKS}`);
}

// 고른 글에 맞는 그림 한 장(검색어·그림 요청 정하기 짧은 호출 1번 → 그림 모델). 못 그리면 null, 창을 닫으면 AbortError
async function drawSelectionPicture(pick, signal) {
    const keyword = selectionKeyword(pick.text);
    const intent = await extractSearchIntent(keyword, pick.context, signal);
    return generateImageAPI(selectionImagePrompt(intent, keyword), { signal });
}

// 고른 글이 든 단락(원문 블록) 바로 아래에 그림 칸을 넣은 탭 글 { text, at: 'after' | 'end' }. 그 단락을 원문에서 찾지 못하면 탭 끝에 넣는다.
// 그림 칸 앞뒤는 빈 줄 하나로 띄운다(HTML 블록이 다음 줄을 삼키지 않게)
function placeSelectionPicture(source, block, html) {
    const text = String(source || '').replace(/\r\n?/g, '\n');
    let located = null;
    try {
        located = block && typeof locateLessonBlock === 'function' ? locateLessonBlock(text, block) : null;
    } catch (err) {
        console.warn('[고른 글 GIF] 고른 단락을 원문에서 찾지 못했습니다:', err);
    }
    if (located && text.slice(located.start, located.start + located.raw.length) === located.raw) {
        const end = located.start + located.raw.trimEnd().length;
        const rest = text.slice(end).replace(/^(?:[ \t]*\n)+/, '');
        return { text: `${text.slice(0, end)}\n\n${html}\n${rest.trim() ? `\n${rest}` : ''}`, at: 'after' };
    }
    return { text: `${text.trimEnd()}\n\n${html}\n`, at: 'end' };
}

// 그림 칸(api.js imageWrapperHtml): 다시 찾기 검색어와 그림 설명은 고른 글
function selectionPictureHtml(imgId, pick) {
    const caption = escapeHtml(selectionClip(selectionOneLine(pick.text), SELECTION_CAPTION_MAX));
    return imageWrapperHtml(imgId, selectionKeyword(pick.text), caption, caption);
}

function restoreSelectionImages(mod, kept) {
    mod.images = kept.images;
    if (kept.hadMotions) mod.imageMotions = kept.motions;
    else delete mod.imageMotions;
}

// 넣기: 새 그림 키에 그린 그림을 두고(GIF면 움직이는 GIF로 바꾼 그림과 같은 모양: 그 자리는 GIF, 그린 그림은 원래 그림으로 간직, image-motion.js applyImageMotionData)
// 고른 단락 아래에 그림 칸을 넣는다. 넣기 전 글은 작업 기록에 남기고(lesson-review.js commitTabChange) Ctrl+Z로도 되돌린다(format-toolbar.js recordLessonEdit).
// 넣었으면 true. 그사이 탭을 옮겼거나 탭 글이 바뀌어 반영하지 못하면 차시 그림도 그대로 두고 false
async function insertSelectionPicture(pick, { still, gif = '', meta = {} }) {
    const { mod, tabId } = pick;
    if (!isViewingTab(mod, tabId)) {
        window.showToast?.(SELECTION_MEDIA_TEXT.moved, 'warning');
        return false;
    }
    if (typeof saveOpenEditsFor === 'function') saveOpenEditsFor(mod, tabId);
    const before = selectionTabText(mod, tabId);
    if (!before.trim()) {
        window.showToast?.(SELECTION_MEDIA_TEXT.emptyTab, 'warning');
        return false;
    }
    const kept = { images: mod.images, motions: mod.imageMotions, hadMotions: Object.prototype.hasOwnProperty.call(mod, 'imageMotions') };
    const imgId = uniqueLessonImageId(new Set(Object.keys(mod.images || {})));
    mod.images = { ...(mod.images || {}), [imgId]: still };
    try {
        if (gif) applyImageMotionData(mod, imgId, still, gif, meta);
    } catch (err) {
        restoreSelectionImages(mod, kept);
        throw err;
    }
    const placed = placeSelectionPicture(before, pick.block, selectionPictureHtml(imgId, pick));
    const label = (LESSON_TABS.find(tab => tab.id === tabId) || {}).label || '이 탭';
    const note = `${gif ? '고른 글로 움직이는 GIF 넣기' : '고른 글로 그림 넣기'} (${label})`;
    let committed = false;
    try {
        committed = await commitTabChange(mod, tabId, before, placed.text, note, SELECTION_MEDIA_TEXT.reason);
    } catch (err) {
        if (selectionTabText(mod, tabId) === before) restoreSelectionImages(mod, kept); // 글에 넣기 전에 멈췄으면 그림도 되돌린다
        throw err;
    }
    if (!committed) {
        restoreSelectionImages(mod, kept);
        return false;
    }
    window.recordLessonEdit?.(mod, tabId, before, placed.text);
    const done = placed.at === 'end' ? SELECTION_MEDIA_TEXT.insertedEnd : gif ? SELECTION_MEDIA_TEXT.insertedGif : SELECTION_MEDIA_TEXT.insertedStill;
    window.showToast?.(done, placed.at === 'end' ? 'warning' : 'success');
    return true;
}

// 'GIF 만들기': 그림 1장과 관계 읽기 1번의 비용·시간을 먼저 보이고(cost-estimate.js), 확인하면 움직이는 GIF 창을 연다. 창이 그림을 그리고 GIF를 만들면
// 강사가 '본문에 넣기'(GIF)나 '그림만 넣기'를 고른다. 열린 창(세션)을 돌려준다. 묻는 동안 다른 차시·탭으로 옮겼으면 열지 않는다
window.makeSelectionGif = async function (pick) {
    if (!pick?.mod) return null;
    const { mod, tabId } = pick;
    const blocked = selectionPictureFree(tabId) ? SELECTION_MEDIA_TEXT.bankTab
        : window.isLessonPipelineRunning?.() ? SELECTION_MEDIA_TEXT.busy
            : typeof textModelHasKey === 'function' && !textModelHasKey() ? SELECTION_MEDIA_TEXT.noKey : '';
    if (blocked) {
        window.showAlert(blocked);
        return null;
    }
    const work = { images: 1, motionPlans: 1 }; // 그림 1장(검색어·그림 요청 정하기 짧은 호출 1번 포함) + 그림 속 관계 읽기 1번
    if (!(await confirmWithEstimate(SELECTION_MEDIA_TEXT.gifConfirm, work, { title: 'GIF 만들기', okLabel: '그림 그리기', exactImages: true }))) return null;
    if (!isViewingTab(mod, tabId)) {
        window.showToast?.(SELECTION_MEDIA_TEXT.moved, 'warning');
        return null;
    }
    const session = window.openImageMotionInsert({
        mod, tabId,
        instruction: selectionOneLine(pick.text), // 고른 글을 움직임 요청으로 보낸다(창에서 고쳐 다시 읽을 수 있다)
        draw: signal => drawSelectionPicture(pick, signal),
        onApply: ({ still, gif, meta }) => insertSelectionPicture(pick, { still, gif, meta }),
        onStill: ({ still }) => insertSelectionPicture(pick, { still })
    });
    if (!session) window.showToast?.(SELECTION_MEDIA_TEXT.dialogOpen, 'warning');
    return session;
};

/* ---------- 시작 ---------- */
// 문서에 한 번만 단다(index.html이 모든 스크립트를 읽은 뒤)
function initSelectionMedia() {
    if (_selectionReady || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    _selectionReady = true;
    document.addEventListener('selectionchange', onSelectionMediaChange);
    document.addEventListener('mousedown', onSelectionMediaMouseDown, true);
    document.addEventListener('mouseup', onSelectionMediaMouseUp, true);
    document.addEventListener('keydown', onSelectionMediaKey);
    document.addEventListener('scroll', onSelectionMediaScroll, true);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSelectionMedia);
    else initSelectionMedia();
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        initSelectionMedia, readLessonSelection, selectionMenuPosition, selectionWhiteboardHandoff, selectionImagePrompt, placeSelectionPicture, SELECTION_MEDIA_TEXT
    });
}
