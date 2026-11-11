// block-tools.js - 교안 본문 블록(단락·목록·제목·표·코드 블록) 옆의 작은 단추: 접기·펴기와 지우기(X)
// 단추 묶음은 하나만 두고 마우스가 올라간 블록의 오른쪽 여백으로 옮긴다(body에 고정 위치로 둔다).
// #render-view 안에 넣지 않으므로 화면 블록 순서(두 번 눌러 고치기·자리 고르기가 쓰는 순서)가 바뀌지 않고, 내보내기·복사에도 섞이지 않는다.
// 지우기: 원문에서 그 블록만 뺀다. 화면 블록과 원문 블록은 글자가 같아야 짝짓고(lesson-format.js locateBlockToRemove),
//  지운 뒤 화면에서 그 글이 정확히 하나 줄었는지 본다(화면이 숨긴 첫머리에 같은 글이 있어도 그것을 지우지 않게).
//  바꾸기 전 글은 작업 기록에 남기고(lesson-review.js commitTabChange) Ctrl+Z로 되돌린다(format-toolbar.js recordLessonEdit).
// 접기: 사용자가 고른 블록만 접는다. 원문은 바꾸지 않는다. 차시에 탭별로 접은 블록 글의 지문(foldedBlocks)을 기억해 화면을 그릴 때마다 다시 접고,
//  접힌 블록을 누르면 펼친다. 글을 고쳐 지문이 바뀐 블록은 펼친 채로 그린다.
// 기대는 것: lesson-format.js, lesson-opening.js, image-slot-place.js(slotPart·slotShownText), lesson-review.js(storedTabMarkdown·commitTabChange), format-toolbar.js.
// 테스트: tests/block-tools.test.js

const BLOCK_TOOLS_ID = 'block-tools';
const BLOCK_TOOLS_HIDE_MS = 350; // 블록에서 단추로 옮겨 가는 사이 단추를 숨기지 않고 기다리는 시간
const BLOCK_TOOLS_GAP_PX = 6; // 블록 오른쪽 끝과 단추 사이
const BLOCK_TOOLS_WIDTH_PX = 24;
const BLOCK_FOLD_LIMIT = 300; // 탭 하나에 기억할 접은 블록 수(오래된 것부터 잊는다)
const BLOCK_TOOL_SKIP = 'br, hr, script, style, .para-edit, .hidden, [data-image-slot], .mermaid';
const BLOCK_TOOL_MEDIA = 'img, video, iframe, svg, .image-placeholder, [data-lesson-action="delete-image"]';
const BLOCK_FOLDED = 'block-folded';
const BLOCK_TARGET = 'block-tool-target';
const BLOCK_TARGET_DELETE = 'block-tool-target-delete';

const BLOCK_TOOL_TEXT = {
    odd: '이 탭은 원문 구조가 특이해 단락을 바로 지울 수 없습니다. 도구 → 원문 전체 수정에서 지워 주세요.',
    notFound: '이 단락을 원문에서 똑같이 찾지 못해 지우지 않았습니다. 두 번 눌러 고치거나 도구 → 원문 전체 수정에서 지워 주세요.',
    hidden: '화면이 정리해 보여 주는 곳이라 이 단락을 바로 지울 수 없습니다. 도구 → 원문 전체 수정에서 지워 주세요.',
    last: '탭에 남은 마지막 단락이라 지우지 않았습니다. 탭을 비우려면 도구 → 원문 전체 수정을 써 주세요.',
    deleted: '단락을 지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.',
    foldSaveFailed: '접은 상태를 저장하지 못했습니다. 화면에서는 접혀 있지만 다시 열면 펼쳐질 수 있습니다.'
};

/* ---------- 지우기 계획(DOM을 쓰지 않는다) ---------- */
// 화면 블록(part: slotPart와 같은 { index, text, ... })을 원문에서 뺀 글. { ok: true, text } 또는 { ok: false, reason }.
// 글이 같은 원문 블록을 화면 순서에서 가까운 것부터 시험해, 지운 뒤 화면 글에서 그 블록이 하나 줄어드는 첫 블록을 지운다. 원문의 줄바꿈(\r\n·\n)을 따른다
function lessonBlockRemovePlan(source, part) {
    const text = String(source ?? '');
    if (!lessonBlocks(text)) return { ok: false, reason: BLOCK_TOOL_TEXT.odd };
    const candidates = blocksToRemove(text, part);
    if (!candidates.length) return { ok: false, reason: BLOCK_TOOL_TEXT.notFound };
    const shownBefore = slotSquash(slotShownText(text));
    const next = candidates.map(located => {
        const removed = removeLessonBlock(text, located);
        const visible = slotSquash(located.raw);
        if (removed == null || !visible) return null;
        const candidate = text.includes('\r\n') ? removed.replace(/\n/g, '\r\n') : removed;
        return slotCount(slotSquash(slotShownText(candidate)), visible) === slotCount(shownBefore, visible) - 1 ? candidate : null;
    }).find(item => item !== null);
    if (next == null) return { ok: false, reason: BLOCK_TOOL_TEXT.hidden };
    if (!slotSquash(slotShownText(next))) return { ok: false, reason: BLOCK_TOOL_TEXT.last };
    return { ok: true, text: next };
}

/* ---------- 접은 블록 기억 ---------- */
const blockToolObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

// 블록 글의 지문: 빈칸을 뺀 글자 수와 FNV-1a 해시
function blockFoldKey(text) {
    const squashed = String(text || '').replace(/\s+/g, '');
    const hash = [...squashed].reduce((acc, ch) => Math.imul(acc ^ ch.codePointAt(0), 16777619) >>> 0, 2166136261);
    return `${squashed.length}-${hash.toString(36)}`;
}

function foldedBlockKeys(mod, tabId) {
    const list = blockToolObject(mod?.foldedBlocks) ? mod.foldedBlocks[tabId] : null;
    return Array.isArray(list) ? list.filter(key => typeof key === 'string') : [];
}

// key를 접거나(folded true) 펼친 차시의 foldedBlocks. 빈 탭 칸은 지우고, 모두 비면 null
function nextFoldedBlocks(mod, tabId, key, folded) {
    const others = blockToolObject(mod?.foldedBlocks) ? mod.foldedBlocks : {};
    const kept = foldedBlockKeys(mod, tabId).filter(item => item !== key);
    const list = (folded ? [...kept, key] : kept).slice(-BLOCK_FOLD_LIMIT);
    const { [tabId]: dropped, ...rest } = others;
    const next = list.length ? { ...rest, [tabId]: list } : rest;
    return Object.keys(next).length ? next : null;
}

/* ---------- 화면 ---------- */
let blockToolsTarget = null;
let blockToolsTimer = 0;
let blockDeleteBusy = false;

const blockToolsTab = () => (typeof currentLessonTab !== 'undefined' ? currentLessonTab : 'basicLearn');
const blockToolsMod = () => (typeof getEditingModule === 'function' ? getEditingModule() : null);

// 단추를 띄울 보기 화면. 원문 칸·교수안이 가렸거나, 단락을 고치는 중이거나, 자리를 고르는 중이면 null
function blockToolsView() {
    const view = document.getElementById('render-view');
    if (!view || view.classList.contains('hidden') || view.classList.contains('gyosuan-covered')) return null;
    if (view.querySelector('.para-edit') || document.body.classList.contains('image-slot-placing')) return null;
    return view;
}

// 단추를 달 블록: 글이 있고 그림·동영상이 없는 블록(그림에는 따로 삭제 버튼이 있다). 그림 자리 칸·편집 상자·구분선·다이어그램은 뺀다
function isBlockToolTarget(view, el) {
    if (!el || el.parentElement !== view || el.matches(BLOCK_TOOL_SKIP)) return false;
    if (el.matches(BLOCK_TOOL_MEDIA) || el.querySelector(BLOCK_TOOL_MEDIA)) return false;
    return !!(el.textContent || '').trim();
}

// 문제은행 탭(학습이해도·심화이해도)은 문제 형식을 지켜야 해서 지우기 단추를 두지 않는다(접기만 둔다)
const blockDeleteAllowed = mod => !(mod?.tabContents && typeof isQuestionBankTab === 'function' && isQuestionBankTab(blockToolsTab()));

function blockToolsBar() {
    const found = document.getElementById(BLOCK_TOOLS_ID);
    if (found) return found;
    const bar = document.createElement('div');
    bar.id = BLOCK_TOOLS_ID;
    bar.className = 'block-tools';
    bar.hidden = true;
    bar.innerHTML = '<button type="button" data-block-tool="fold"></button>'
        + '<button type="button" data-block-tool="delete" title="이 단락 지우기 (Ctrl+Z로 되돌립니다)" aria-label="이 단락 지우기"><i class="ph-bold ph-x" aria-hidden="true"></i></button>';
    bar.addEventListener('mousedown', event => event.preventDefault()); // 고른 글자와 포커스를 그대로 둔다
    bar.addEventListener('mouseover', event => {
        clearTimeout(blockToolsTimer);
        markBlockTarget(event.target.closest?.('[data-block-tool]')?.dataset.blockTool || '');
    });
    bar.addEventListener('mouseleave', () => {
        markBlockTarget('');
        scheduleBlockToolsHide();
    });
    bar.addEventListener('click', onBlockToolClick);
    document.body.appendChild(bar);
    return bar;
}

// 단추에 마우스가 올라가면 어느 블록에 쓰는지 테두리로 보인다(지우기는 빨갛게)
function markBlockTarget(tool) {
    document.querySelectorAll(`.${BLOCK_TARGET}, .${BLOCK_TARGET_DELETE}`).forEach(el => el.classList.remove(BLOCK_TARGET, BLOCK_TARGET_DELETE));
    if (!tool || !blockToolsTarget?.isConnected) return;
    blockToolsTarget.classList.add(tool === 'delete' ? BLOCK_TARGET_DELETE : BLOCK_TARGET);
}

function syncFoldButton(bar, el) {
    const button = bar.querySelector('[data-block-tool="fold"]');
    const folded = el.classList.contains(BLOCK_FOLDED);
    const label = folded ? '이 블록 펼치기' : '이 블록 접기';
    button.title = folded ? '이 블록 펼치기' : '이 블록 접기 (이 차시에 기억합니다)';
    button.setAttribute('aria-label', label);
    button.innerHTML = `<i class="ph-bold ${folded ? 'ph-caret-down' : 'ph-caret-up'}" aria-hidden="true"></i>`;
}

// 블록 오른쪽 여백에 단추를 놓는다. 위쪽 고정 막대(탭 줄)에 가리면 그 아래로 내리고, 블록이 거의 다 가렸으면 숨긴다
function placeBlockTools(bar, el) {
    const rect = el.getBoundingClientRect();
    const header = document.querySelector('#editor-content-area > .sticky')?.getBoundingClientRect();
    const floor = header ? header.bottom + 4 : 0;
    if (rect.bottom < floor + 12) return hideBlockTools();
    bar.style.top = `${Math.max(rect.top, floor)}px`;
    bar.style.left = `${Math.min(rect.right + BLOCK_TOOLS_GAP_PX, window.innerWidth - BLOCK_TOOLS_WIDTH_PX - 4)}px`;
    bar.hidden = false;
    return true;
}

function showBlockTools(el) {
    clearTimeout(blockToolsTimer);
    const bar = blockToolsBar();
    if (blockToolsTarget !== el) markBlockTarget('');
    blockToolsTarget = el;
    bar.querySelector('[data-block-tool="delete"]').hidden = !blockDeleteAllowed(blockToolsMod());
    syncFoldButton(bar, el);
    placeBlockTools(bar, el);
}

function hideBlockTools() {
    clearTimeout(blockToolsTimer);
    markBlockTarget('');
    blockToolsTarget = null;
    const bar = document.getElementById(BLOCK_TOOLS_ID);
    if (bar) bar.hidden = true;
    return false;
}

function scheduleBlockToolsHide() {
    clearTimeout(blockToolsTimer);
    blockToolsTimer = setTimeout(hideBlockTools, BLOCK_TOOLS_HIDE_MS);
}

function onBlockToolsMove(event) {
    const el = event.target;
    if (!el?.closest || el.closest(`#${BLOCK_TOOLS_ID}`)) return;
    const view = blockToolsView();
    if (!view) return void (blockToolsTarget && hideBlockTools());
    const block = el.closest('#render-view > *');
    if (block && isBlockToolTarget(view, block) && block.getBoundingClientRect().height > 0) return void showBlockTools(block);
    if (block || !view.contains(el)) scheduleBlockToolsHide(); // 블록 사이 빈 곳(보기 화면 자신)에서는 단추를 그대로 둔다
}

function onBlockToolClick(event) {
    const tool = event.target.closest?.('[data-block-tool]')?.dataset.blockTool;
    const el = blockToolsTarget;
    if (!tool || !el?.isConnected) return void hideBlockTools();
    if (tool === 'fold') toggleBlockFold(el);
    else if (tool === 'delete') deleteLessonBlock(el);
}

/* ---------- 지우기 ---------- */
async function deleteLessonBlock(el) {
    const view = blockToolsView();
    const mod = blockToolsMod();
    const tabId = blockToolsTab();
    hideBlockTools();
    if (blockDeleteBusy || !view || !mod || el.parentElement !== view || !blockDeleteAllowed(mod)) return;
    const before = storedTabMarkdown(mod, tabId);
    const plan = lessonBlockRemovePlan(before, slotPart(view, el));
    if (!plan.ok) return void window.showToast?.(plan.reason, 'warning');
    const label = mod.tabContents ? reviewTabLabel(tabId) : '본문';
    blockDeleteBusy = true;
    try {
        if (!(await commitTabChange(mod, tabId, before, plan.text, `단락 지우기 (${label})`, '단락 지우기 전'))) return;
        window.recordLessonEdit?.(mod, tabId, before, plan.text);
        window.showToast?.(BLOCK_TOOL_TEXT.deleted, 'success');
    } catch (err) {
        console.error('[단락 지우기] 실패:', err);
        window.showToast?.('단락을 지우지 못했습니다. 잠시 뒤 다시 해 보세요.', 'error');
    } finally {
        blockDeleteBusy = false;
    }
}

/* ---------- 접기 ---------- */
// 보기 화면을 그린 뒤 부른다(api.js toggleEditorMode). 기억한 지문과 같은 글의 블록을 접는다
window.applyBlockFolds = function (view, mod) {
    if (!view) return;
    const keys = new Set(foldedBlockKeys(mod, blockToolsTab()));
    [...view.children].forEach(el => {
        el.classList.toggle(BLOCK_FOLDED, keys.size > 0 && isBlockToolTarget(view, el) && keys.has(blockFoldKey(el.textContent)));
    });
};

function toggleBlockFold(el) {
    const view = blockToolsView();
    const mod = blockToolsMod();
    if (!view || !mod || el.parentElement !== view) return;
    const folded = !el.classList.contains(BLOCK_FOLDED);
    const next = nextFoldedBlocks(mod, blockToolsTab(), blockFoldKey(el.textContent), folded);
    if (next) mod.foldedBlocks = next;
    else delete mod.foldedBlocks;
    window.applyBlockFolds(view, mod);
    if (blockToolsTarget === el) {
        syncFoldButton(blockToolsBar(), el);
        placeBlockTools(blockToolsBar(), el); // 접으면 블록 높이가 줄어 단추 자리를 다시 잡는다
    }
    if (typeof saveState === 'function') {
        Promise.resolve(saveState()).catch(err => {
            console.error('[블록 접기] 저장 실패:', err);
            window.showToast?.(BLOCK_TOOL_TEXT.foldSaveFailed, 'warning');
        });
    }
}

// 접힌 블록을 누르면 펼친다. 글자를 끌어 고르는 중이거나 블록 안의 단추·링크를 누르면 두고 넘어간다
function onFoldedBlockClick(event) {
    const el = event.target.closest?.(`#render-view > .${BLOCK_FOLDED}`);
    if (!el || event.target.closest('button, a, input, textarea, select, [data-lesson-action]')) return;
    if (window.getSelection && !window.getSelection().isCollapsed) return;
    toggleBlockFold(el);
}

if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('mousemove', onBlockToolsMove, { passive: true });
    document.addEventListener('scroll', () => blockToolsTarget && hideBlockTools(), { capture: true, passive: true });
    document.addEventListener('click', onFoldedBlockClick);
}
