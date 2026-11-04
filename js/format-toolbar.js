// format-toolbar.js - 교안 본문을 드래그하면 뜨는 서식 막대(슬랙과 같은 버튼 순서)
// 고른 글자를 lesson-format.js로 원문 마크다운에 반영하고, 저장한 뒤 다시 그린다. Ctrl+Z로 되돌린다.
// 막대 자리는 index.html의 #ai-floating-toolbar('AI로 수정' 버튼 옆)이고, 보이기·숨기기는 ui.js가 맡는다.

const FORMAT_TOOLS = [
    { id: 'bold', icon: 'ph-text-b', label: '굵게', keys: 'Ctrl+B' },
    { id: 'italic', icon: 'ph-text-italic', label: '기울임', keys: 'Ctrl+I' },
    { id: 'underline', icon: 'ph-text-underline', label: '밑줄', keys: 'Ctrl+U' },
    { id: 'strike', icon: 'ph-text-strikethrough', label: '취소선', keys: 'Ctrl+Shift+X' },
    { id: 'paragraph', icon: 'ph-paragraph', label: '문단 스타일', menu: true },
    null,
    { id: 'link', icon: 'ph-link', label: '링크' },
    { id: 'ordered', icon: 'ph-list-numbers', label: '번호 목록' },
    { id: 'bullet', icon: 'ph-list-bullets', label: '글머리 목록' },
    null,
    { id: 'quote', icon: 'ph-quotes', label: '인용' },
    { id: 'code', icon: 'ph-code', label: '코드' },
    { id: 'codeblock', icon: 'ph-code-block', label: '코드 블록' },
    { id: 'divider', icon: 'ph-minus', label: '구분선' }
];
const FORMAT_PARAGRAPH_STYLES = [
    { id: 'paragraph', label: '본문', size: '0.8125rem' },
    { id: 'h2', label: '큰 제목', size: '1.05rem' },
    { id: 'h3', label: '중간 제목', size: '0.95rem' },
    { id: 'h4', label: '작은 제목', size: '0.875rem' }
];
const FORMAT_INLINE = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link']);
const FORMAT_SHORTCUTS = { KeyB: 'bold', KeyI: 'italic', KeyU: 'underline' }; // 한글 입력 상태에서도 잡히도록 키 위치로 구분한다
const FORMAT_UNDO_LIMIT = 20;
const FORMAT_SKIP = /[\s:：]/;

let formatUndoStack = [];
let formatPending = null; // 링크 주소를 받는 동안 고른 자리를 기억한다
let formatStateTimer = null;
let formatHintShown = false;

const formatBar = () => document.getElementById('ai-floating-toolbar');
const formatRow = () => document.getElementById('format-toolbar');
const formatTabRaw = (mod, tabId) => (mod.tabContents ? mod.tabContents[tabId] : mod.content);

/* ---------- 막대 그리기 ---------- */
function formatButtonHtml(tool) {
    if (!tool) return '<span class="format-sep" aria-hidden="true"></span>';
    const title = tool.keys ? `${tool.label} (${tool.keys})` : tool.label;
    const caret = tool.menu ? '<i class="ph-bold ph-caret-down text-[0.625rem] -ml-0.5"></i>' : '';
    const action = tool.menu ? 'toggleFormatMenu()' : `onFormatTool('${tool.id}')`;
    return `<button type="button" class="format-btn${tool.menu ? ' format-btn-menu' : ''}" data-format="${tool.id}" title="${title}" aria-label="${title}" aria-pressed="false" onclick="${action}"><i class="ph ${tool.icon}"></i>${caret}</button>`;
}

function formatMenuHtml() {
    const items = FORMAT_PARAGRAPH_STYLES.map(style => `<button type="button" role="menuitem" class="format-menu-item" style="font-size:${style.size}" onclick="onFormatTool('${style.id}')">${style.label}</button>`).join('');
    return `<div id="format-menu" class="format-menu hidden" role="menu" aria-label="문단 스타일">${items}</div>`;
}

window.renderFormatToolbar = function () {
    const row = formatRow();
    if (!row) return;
    row.innerHTML = FORMAT_TOOLS.map(formatButtonHtml).join('') + formatMenuHtml();
    formatPending = null;
};

window.resetFormatToolbar = function () {
    if (formatPending || !formatRow()?.querySelector('[data-format]')) window.renderFormatToolbar();
    document.getElementById('format-menu')?.classList.add('hidden');
};

window.toggleFormatMenu = function () {
    const menu = document.getElementById('format-menu');
    const button = formatRow()?.querySelector('[data-format="paragraph"]');
    if (!menu || !button) return;
    menu.style.left = `${button.offsetLeft}px`; // 막대(.format-bar) 기준 ¶ 버튼 아래
    menu.classList.toggle('hidden');
};

// 선택 영역 위(자리가 없으면 아래) 가운데에 두고, 화면 밖으로 나가지 않게 한다
window.positionFloatingToolbar = function (bar, rect) {
    const margin = 8;
    const width = bar.offsetWidth || 480;
    const above = rect.top > bar.offsetHeight + 16;
    const center = rect.left + rect.width / 2;
    const left = Math.min(Math.max(center, width / 2 + margin), window.innerWidth - width / 2 - margin);
    bar.style.left = `${left}px`;
    bar.style.top = `${above ? rect.top - 8 : rect.bottom + 8}px`;
    bar.classList.toggle('-translate-y-full', above);
};

/* ---------- 고른 범위 읽기 ---------- */
function formatTopOf(view, node) {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el && el.parentElement !== view) el = el.parentElement;
    return el;
}

function formatEdgeIndex(view, container, offset, isEnd) {
    const children = [...view.children];
    if (container !== view) return children.indexOf(formatTopOf(view, container));
    const elementsBefore = [...view.childNodes].slice(0, offset).filter(node => node.nodeType === 1).length; // offset은 글자 노드까지 센다
    return Math.max(0, Math.min(children.length - 1, isEnd ? elementsBefore - 1 : elementsBefore));
}

// 본문 밖 빈 곳까지 끌어 고르면 범위 끝이 본문 바깥에 걸린다. 본문 안으로 잘라 읽는다
function formatClipRange(view, range) {
    const clipped = range.cloneRange();
    const whole = document.createRange();
    whole.selectNodeContents(view);
    if (clipped.compareBoundaryPoints(Range.START_TO_START, whole) < 0) clipped.setStart(view, 0);
    if (clipped.compareBoundaryPoints(Range.END_TO_END, whole) > 0) clipped.setEnd(view, view.childNodes.length);
    return clipped;
}

// 화면 블록 하나 안에서 고른 글자와 그 앞 글자
function formatPart(el, index, range) {
    const inside = document.createRange();
    inside.selectNodeContents(el);
    if (el.contains(range.startContainer)) inside.setStart(range.startContainer, range.startOffset);
    if (el.contains(range.endContainer)) inside.setEnd(range.endContainer, range.endOffset);
    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(inside.startContainer, inside.startOffset);
    return { index, before: before.toString(), selected: inside.toString(), text: el.textContent || '' };
}

function formatContext() {
    const view = document.getElementById('render-view');
    const sel = window.getSelection();
    if (!view || view.classList.contains('hidden') || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    if (view.querySelector('textarea')) return null; // 두 번 눌러 고치는 중
    if (!sel.getRangeAt(0).intersectsNode(view)) return null;
    const range = formatClipRange(view, sel.getRangeAt(0));
    if (range.collapsed) return null;
    const first = formatEdgeIndex(view, range.startContainer, range.startOffset, false);
    const last = formatEdgeIndex(view, range.endContainer, range.endOffset, true);
    if (first < 0 || last < first) return null;
    const elements = [...view.children].slice(first, last + 1);
    const parts = elements.map((el, i) => formatPart(el, first + i, range))
        .filter(part => part.selected.replace(/[\s:：]/g, '')); // 세 번 눌러 고르면 다음 블록 맨 앞까지 잡힌다
    if (!parts.length) return null;
    const texts = elements.filter((el, i) => parts.some(part => part.index === first + i)).map(el => el.innerText.trim());
    return { parts, texts };
}

/* ---------- 적용·저장·되돌리기 ---------- */
function formatWrite(mod, tabId, md, part) {
    const area = document.getElementById('editor-content-area');
    const scrollTop = area ? area.scrollTop : 0;
    setTabMarkdown(mod, tabId, md);
    return saveState().then(() => {
        renderEditor(mod);
        if (area) area.scrollTop = scrollTop;
        if (part) formatReselect(part);
    });
}

// 서식 막대와 두 번 눌러 고치기(paragraph-edit.js)의 저장을 Ctrl+Z로 되돌릴 수 있게 기억한다
window.recordLessonEdit = function (mod, tabId, before, after) {
    if (before === after) return;
    formatUndoStack = [...formatUndoStack, { modId: mod.id, tabId, before, after }].slice(-FORMAT_UNDO_LIMIT);
};

function commitFormatChange(mod, before, after, part) {
    const tabId = currentLessonTab;
    if (before === after) return;
    window.recordLessonEdit(mod, tabId, before, after);
    formatWrite(mod, tabId, after, part).catch(err => {
        console.error('[서식 막대] 저장 실패:', err);
        window.showToast?.('서식을 저장하지 못했습니다. 다시 시도해 주세요.', 'error');
    });
    if (!formatHintShown) {
        formatHintShown = true;
        window.showToast?.('서식을 바꿨습니다. Ctrl+Z로 되돌릴 수 있습니다.', 'success');
    }
}

function formatUndo(event) {
    const mod = typeof getEditingModule === 'function' ? getEditingModule() : null;
    const last = formatUndoStack[formatUndoStack.length - 1];
    if (!mod || !last || last.modId !== mod.id || last.tabId !== currentLessonTab || formatTabRaw(mod, last.tabId) !== last.after) return;
    event.preventDefault();
    formatUndoStack = formatUndoStack.slice(0, -1);
    formatWrite(mod, last.tabId, last.before, null).then(() => window.showToast?.('되돌렸습니다.', 'success'));
}

function runFormat(id, ctx, opts) {
    const mod = getEditingModule();
    const source = mod ? getActiveTabContent(mod) : '';
    if (!mod || !source) return;
    const result = FORMAT_INLINE.has(id)
        ? applyInlineFormat(source, ctx.parts, id, opts)
        : applyBlockFormat(source, ctx.parts, id, { texts: ctx.texts });
    if (!result.ok) {
        window.showToast?.(result.reason, 'warning');
        return;
    }
    const reselect = FORMAT_INLINE.has(id) && ctx.parts.length === 1 ? ctx.parts[0] : null;
    commitFormatChange(mod, source, result.source, reselect);
}

window.onFormatTool = function (id) {
    const ctx = formatContext();
    document.getElementById('format-menu')?.classList.add('hidden');
    if (!ctx) {
        window.showToast?.('고른 범위를 읽지 못했습니다. 본문 글자를 다시 드래그해 주세요.', 'warning');
        return;
    }
    if (id === 'link' && !formatLinkActive(ctx)) {
        showFormatLinkInput(ctx);
        return;
    }
    runFormat(id, ctx, {});
};

/* ---------- 링크 주소 입력 ---------- */
function formatLinkActive(ctx) {
    const mod = getEditingModule();
    return !!mod && inlineFormatState(getActiveTabContent(mod), ctx.parts).link;
}

function showFormatLinkInput(ctx) {
    const row = formatRow();
    if (!row) return;
    formatPending = ctx;
    row.innerHTML = `<i class="ph ph-link text-gray-500 text-base px-1"></i>
        <input id="format-link-input" type="text" inputmode="url" placeholder="https://" aria-label="링크 주소"
            class="w-56 px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-accent"
            onkeydown="onFormatLinkKey(event)">
        <button type="button" class="format-text-btn" onclick="confirmFormatLink()">적용</button>
        <button type="button" class="format-text-btn text-gray-500" onclick="cancelFormatLink()">취소</button>`;
    const bar = formatBar();
    if (bar && window.getSelection().rangeCount) window.positionFloatingToolbar(bar, window.getSelection().getRangeAt(0).getBoundingClientRect());
    document.getElementById('format-link-input')?.focus();
}

window.onFormatLinkKey = function (event) {
    if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        window.confirmFormatLink();
    } else if (event.key === 'Escape') {
        window.cancelFormatLink();
    }
};

window.confirmFormatLink = function () {
    const url = normalizeLinkUrl(document.getElementById('format-link-input')?.value);
    if (!url) {
        window.showToast?.('http(s) 주소나 mailto: 주소를 넣어 주세요.', 'warning');
        return;
    }
    const ctx = formatPending;
    window.cancelFormatLink();
    if (ctx) runFormat('link', ctx, { url });
};

window.cancelFormatLink = function () {
    window.renderFormatToolbar();
    window.hideHoverTooltip?.();
};

/* ---------- 눌린 버튼 표시·다시 고르기 ---------- */
window.refreshFormatToolbar = function () {
    clearTimeout(formatStateTimer);
    formatStateTimer = setTimeout(() => {
        const ctx = formatContext();
        const mod = ctx && typeof getEditingModule === 'function' ? getEditingModule() : null;
        const state = mod ? inlineFormatState(getActiveTabContent(mod), ctx.parts) : {};
        formatRow()?.querySelectorAll('[data-format]').forEach(button => {
            button.setAttribute('aria-pressed', state[button.dataset.format] ? 'true' : 'false');
        });
    }, 120);
};

function formatTextPoints(el) {
    const points = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        for (let i = 0; i < node.data.length; i++) {
            if (!FORMAT_SKIP.test(node.data[i])) points.push({ node, offset: i, c: node.data[i] });
        }
    }
    return points;
}

// 다시 그린 화면에서 같은 글자를 다시 골라, 이어서 다른 서식을 누를 수 있게 한다
function formatReselect(part) {
    const view = document.getElementById('render-view');
    const needle = part.selected.replace(/[\s:：]/g, '');
    const near = part.before.replace(/[\s:：]/g, '').length;
    if (!view || !needle) return;
    const nearest = [...view.children].map((el, i) => ({ el, gap: Math.abs(i - part.index) })).sort((a, b) => a.gap - b.gap);
    for (const { el } of nearest) {
        const points = formatTextPoints(el);
        const text = points.map(point => point.c).join('');
        let best = -1;
        for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
            if (best === -1 || Math.abs(i - near) < Math.abs(best - near)) best = i;
        }
        if (best === -1) continue;
        const end = points[best + needle.length - 1];
        const range = document.createRange();
        range.setStart(points[best].node, points[best].offset);
        range.setEnd(end.node, end.offset + 1);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return;
    }
}

/* ---------- 단축키·스크롤 ---------- */
function formatIsTyping(target) {
    return !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
}

function onFormatKeydown(event) {
    if (event.key === 'Escape') {
        window.resetFormatToolbar();
        return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || formatIsTyping(event.target)) return;
    if (event.code === 'KeyZ' && !event.shiftKey) {
        formatUndo(event);
        return;
    }
    const tool = event.shiftKey ? (event.code === 'KeyX' ? 'strike' : null) : FORMAT_SHORTCUTS[event.code];
    if (!tool || !formatContext()) return;
    event.preventDefault();
    window.onFormatTool(tool);
}

function onFormatScroll() {
    const bar = formatBar();
    const sel = window.getSelection();
    if (!bar || bar.classList.contains('hidden') || !sel || !sel.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) window.hideHoverTooltip?.();
    else window.positionFloatingToolbar(bar, rect);
}

document.addEventListener('DOMContentLoaded', () => {
    window.renderFormatToolbar();
    // 막대를 눌러도 본문 선택이 풀리지 않게 한다(링크 주소 입력칸은 예외)
    formatBar()?.addEventListener('mousedown', event => {
        if (!event.target.closest('input')) event.preventDefault();
    });
    document.addEventListener('keydown', onFormatKeydown);
    document.addEventListener('scroll', onFormatScroll, true);
});
