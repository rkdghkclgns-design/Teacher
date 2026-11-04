// md-toolbar.js - 수정 모드(#raw-view) 서식 도구와 나란히 보기, 탭 복사, AI 수정 빠른 지시
// develocket-slide(assets/md-editor.js, course-ai-tb.js @3a7303f)를 옮겼다. 표는 Teacher 컨벤션대로 인라인 스타일 HTML 표를 넣는다.
// 값을 바꾸는 계산은 순수 함수가 { from, to, text, selStart, selEnd } 편집으로 돌려주고, 화면에 적용하는 곳은 applyMdEdit 하나다.

const MD_VIEW_KEY = 'teacher-md-view';
const MD_PREVIEW_DELAY = 250;
const MD_SPLIT_MAX_WIDTH = 'min(1400px, 100%)';
const MD_LIST_LINE = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;
const MD_ANY_LIST = /^([-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/;
const MD_CELL = 'border: 1px solid black; padding: 10px;';
const MD_HEAD_CELL = `${MD_CELL} background-color: #f2f2f2; text-align: center;`;
const MD_TABLE = `<table style="border-collapse: collapse; width: 100%;">\n<thead><tr><th style="${MD_HEAD_CELL}">항목</th><th style="${MD_HEAD_CELL}">내용</th></tr></thead>\n<tbody><tr><td style="${MD_CELL}">항목</td><td style="${MD_CELL}">내용</td></tr></tbody>\n</table>\n`;
const MD_VIEWS = [['write', '작성'], ['split', '나란히']];
const MD_SHORTCUTS = { KeyB: 'bold', KeyI: 'italic', KeyK: 'link' }; // 한글 입력 상태에서도 잡히도록 키 위치로 구분한다
const AI_EDIT_CHIPS = [
    { label: '더 짧게' }, { label: '더 자세하게' }, { label: '예시 추가' }, { label: '쉬운 말로 풀어서' },
    { label: '현업 상황 예시로 바꾸기' }, { label: '코드 예제 보강' }, { label: '문장 다듬기' },
    { label: '규칙 위반 고치기', text: '콘텐츠 업무 설계 규칙에 맞게 고치기(학습자 호칭, 다른 차시 지칭, 모호한 표현, 버전 의존 정보를 없애고 ~합니다로 종결)' }
];

function mdWrapEdit(value, start, end, before, after, placeholder) {
    const selected = value.slice(start, end);
    if (selected && value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
        return { from: start - before.length, to: end + after.length, text: selected, selStart: start - before.length, selEnd: end - before.length };
    }
    const body = selected || placeholder;
    return { from: start, to: end, text: `${before}${body}${after}`, selStart: start + before.length, selEnd: start + before.length + body.length };
}

// 선택한 줄마다 앞머리를 붙이거나, 모두 같은 앞머리면 뗀다. 들여쓰기는 그대로 두고 다른 목록 기호는 바꿔 단다.
function mdPrefixEdit(value, start, end, { make, strip, clear = strip }) {
    const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
    const from = start ? value.lastIndexOf('\n', start - 1) + 1 : 0;
    const lineEnd = value.indexOf('\n', last);
    const to = lineEnd === -1 ? value.length : lineEnd;
    const lines = value.slice(from, to).split('\n');
    const filled = lines.filter(line => line.trim());
    const remove = filled.length > 0 && filled.every(line => strip.test(line.trimStart()));
    let count = 0;
    const text = lines.map(line => {
        if (!line.trim() && lines.length > 1) return line;
        const indent = line.match(/^\s*/)[0];
        const rest = line.slice(indent.length);
        count += 1;
        return remove ? indent + rest.replace(strip, '') : indent + make(count) + rest.replace(clear, '');
    }).join('\n');
    return { from, to, text, selStart: from, selEnd: from + text.length };
}

// 한 줄 선택은 인라인 코드, 여러 줄이나 빈 선택은 코드 블록으로 감싼다
function mdCodeEdit(value, start, end) {
    const selected = value.slice(start, end);
    if (selected && !selected.includes('\n')) return mdWrapEdit(value, start, end, '`', '`', '코드');
    const lead = start && value[start - 1] !== '\n' ? '\n' : '';
    const body = selected || '코드';
    const bodyStart = start + lead.length + 4;
    return { from: start, to: end, text: `${lead}\`\`\`\n${body}\n\`\`\`\n`, selStart: bodyStart, selEnd: bodyStart + body.length };
}

function mdTableEdit(value, start, end) {
    const lead = start && value[start - 1] !== '\n' ? '\n\n' : '';
    const cell = start + lead.length + MD_TABLE.indexOf('항목');
    return { from: start, to: end, text: `${lead}${MD_TABLE}`, selStart: cell, selEnd: cell + 2 };
}

// 목록 줄에서 Enter를 누르면 다음 기호를 잇는다. 빈 항목이면 기호를 지워 목록을 끝낸다. 목록이 아니면 null
function mdListEnterEdit(value, pos) {
    const lineStart = pos ? value.lastIndexOf('\n', pos - 1) + 1 : 0;
    const match = value.slice(lineStart, pos).match(MD_LIST_LINE);
    if (!match) return null;
    const [, indent, mark, gap, check, body] = match;
    if (!body.trim()) return { from: lineStart, to: pos, text: indent, selStart: lineStart + indent.length, selEnd: lineStart + indent.length };
    const nextMark = /\d/.test(mark) ? `${parseInt(mark, 10) + 1}${mark.replace(/\d+/, '')}` : mark;
    const text = `\n${indent}${nextMark}${gap}${check ? '[ ] ' : ''}`;
    return { from: pos, to: pos, text, selStart: pos + text.length, selEnd: pos + text.length };
}

const MD_TOOLS = [
    { id: 'heading', label: '제목', title: '제목 (## )', edit: (v, s, e) => mdPrefixEdit(v, s, e, { make: () => '## ', strip: /^#{1,6}\s+/ }) },
    { id: 'bold', label: '<b>B</b>', title: '굵게 (Ctrl+B)', edit: (v, s, e) => mdWrapEdit(v, s, e, '**', '**', '굵은 글씨') },
    { id: 'italic', label: '<i>I</i>', title: '기울임 (Ctrl+I)', edit: (v, s, e) => mdWrapEdit(v, s, e, '*', '*', '기울인 글씨') },
    { id: 'bullet', label: '• 목록', title: '글머리표 목록', edit: (v, s, e) => mdPrefixEdit(v, s, e, { make: () => '- ', strip: /^[-*+]\s+(?!\[[ xX]\])/, clear: MD_ANY_LIST }) },
    { id: 'number', label: '1. 번호', title: '번호 목록', edit: (v, s, e) => mdPrefixEdit(v, s, e, { make: n => `${n}. `, strip: /^\d+[.)]\s+/, clear: MD_ANY_LIST }) },
    { id: 'check', label: '☐ 체크', title: '체크 목록', edit: (v, s, e) => mdPrefixEdit(v, s, e, { make: () => '- [ ] ', strip: /^[-*+]\s+\[[ xX]\]\s+/, clear: MD_ANY_LIST }) },
    { id: 'quote', label: '❝ 인용', title: '인용', edit: (v, s, e) => mdPrefixEdit(v, s, e, { make: () => '> ', strip: /^>\s?/ }) },
    { id: 'code', label: '&lt;/&gt; 코드', title: '코드 (여러 줄이면 코드 블록)', edit: mdCodeEdit },
    { id: 'table', label: '▦ 표', title: 'HTML 표 넣기', edit: mdTableEdit },
    { id: 'link', label: '🔗 링크', title: '링크 (Ctrl+K)', edit: (v, s, e) => mdWrapEdit(v, s, e, '[', '](https://)', '링크 글자') }
];

function mdSavedView() {
    try {
        const saved = localStorage.getItem(MD_VIEW_KEY);
        if (MD_VIEWS.some(([id]) => id === saved)) return saved;
    } catch (err) {
        console.warn('[서식 도구] 보기 설정을 읽지 못했습니다:', err.message);
    }
    return 'write';
}

// 실행 취소가 되도록 execCommand를 먼저 쓴다
function applyMdEdit(ta, edit) {
    ta.focus();
    ta.setSelectionRange(edit.from, edit.to);
    let done = false;
    try {
        done = document.execCommand(edit.text ? 'insertText' : 'delete', false, edit.text);
    } catch (err) {
        done = false;
    }
    if (!done) {
        ta.setRangeText(edit.text, edit.from, edit.to, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        saveRawContent(); // 코드로 바꾼 값은 change가 발생하지 않는다
    }
    ta.setSelectionRange(edit.selStart, edit.selEnd);
}

function runMdTool(ta, id) {
    const tool = MD_TOOLS.find(item => item.id === id);
    if (tool) applyMdEdit(ta, tool.edit(ta.value, ta.selectionStart, ta.selectionEnd));
}

function mdPreviewHtml(mod, text) {
    const withImages = Object.entries(mod?.images || {}).reduce((md, [id, src]) => md.split(`local:${id}`).join(src), text);
    const clean = withImages.replace(/src="local:[^"]+"/g, 'src="" alt="[이미지 생성 누락]"').replace(/\(local:[^)]+\)/g, '()');
    return renderLessonHTML(preprocessMarkdown(clean));
}

// 미리 보기는 입력하는 동안 계속 그리므로, 붙여 넣은 글의 스크립트가 돌지 않게 비활성 template에서 걷어 낸 뒤 넣는다
function safePreviewNodes(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script, iframe, object, embed').forEach(el => el.remove());
    template.content.querySelectorAll('*').forEach(el => {
        [...el.attributes].filter(attr => /^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)).forEach(attr => el.removeAttribute(attr.name));
    });
    return template.content;
}

function paintMdPreview() {
    const box = document.getElementById('md-editor');
    const ta = document.getElementById('raw-view');
    const pane = box?.querySelector('[data-md-preview]');
    if (!pane || box.dataset.view !== 'split' || box.classList.contains('hidden')) return;
    try {
        pane.replaceChildren(safePreviewNodes(mdPreviewHtml(getEditingModule(ta.dataset.moduleId), ta.value)));
    } catch (err) {
        console.warn('[서식 도구] 미리 보기 실패:', err.message);
        pane.textContent = `미리 보기를 그리지 못했습니다: ${err.message}`;
    }
}

function applyMdView(box, view) {
    box.dataset.view = view;
    box.querySelector('[data-md-preview]').classList.toggle('hidden', view !== 'split');
    box.querySelector('[data-md-body]').classList.toggle('grid-cols-2', view === 'split');
    box.querySelectorAll('[data-md-view]').forEach(button => {
        const on = button.dataset.mdView === view;
        button.classList.toggle('bg-white', on);
        button.classList.toggle('shadow-sm', on);
        button.setAttribute('aria-pressed', String(on));
    });
    syncMdWidth(box);
    paintMdPreview();
}

// 나란히 볼 때만 본문 폭 제한을 풀어 두 칸의 폭을 확보한다
function syncMdWidth(box) {
    box.parentElement.style.maxWidth = box.dataset.view === 'split' && !box.classList.contains('hidden') ? MD_SPLIT_MAX_WIDTH : '';
}

function mdToolbarHtml() {
    const tools = MD_TOOLS.map(tool => `<button type="button" data-md-tool="${tool.id}" title="${tool.title}" class="px-2 py-1 text-[0.7rem] text-gray-700 rounded hover:bg-gray-200">${tool.label}</button>`).join('');
    const views = MD_VIEWS.map(([id, label]) => `<button type="button" data-md-view="${id}" class="px-2 py-1 text-[0.7rem] font-bold text-gray-600 rounded">${label}</button>`).join('');
    return `
        <div class="flex items-center gap-1 mb-2 px-1 py-1 bg-gray-100 border border-gray-200 rounded-lg">
            <div class="flex flex-wrap gap-0.5 flex-1" role="toolbar" aria-label="마크다운 서식">${tools}</div>
            <div class="flex gap-0.5 shrink-0" aria-label="보기">${views}</div>
        </div>
        <div data-md-body class="grid gap-3">
            <div data-md-preview class="hidden markdown-body h-[600px] overflow-y-auto p-6 bg-white border border-gray-200 rounded-xl"></div>
        </div>`;
}

function bindMdToolbar(box, ta) {
    box.addEventListener('mousedown', event => {
        if (event.target.closest('[data-md-tool]')) event.preventDefault(); // 선택 영역 유지
    });
    box.addEventListener('click', event => {
        const tool = event.target.closest('[data-md-tool]');
        const view = event.target.closest('[data-md-view]');
        if (tool) runMdTool(ta, tool.dataset.mdTool);
        if (!view) return;
        applyMdView(box, view.dataset.mdView);
        try {
            localStorage.setItem(MD_VIEW_KEY, view.dataset.mdView);
        } catch (err) {
            console.warn('[서식 도구] 보기 설정을 저장하지 못했습니다:', err.message);
        }
    });
}

function bindMdTextarea(box, ta) {
    let timer = null;
    let shiftEnter = false;
    ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(paintMdPreview, MD_PREVIEW_DELAY);
    });
    ta.addEventListener('keydown', event => {
        shiftEnter = event.key === 'Enter' && event.shiftKey;
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
        if (event.code === 'KeyS') saveRawContent(); // 전역 Ctrl+S는 입력 중인 내용을 모른다
        if (MD_SHORTCUTS[event.code]) {
            event.preventDefault();
            runMdTool(ta, MD_SHORTCUTS[event.code]);
        }
    });
    // 한글 조합 중 Enter는 keydown에서 구분할 수 없어, 줄바꿈이 실제로 들어가는 시점에 잇는다
    ta.addEventListener('beforeinput', event => {
        if (event.inputType !== 'insertLineBreak' || event.isComposing || shiftEnter || ta.selectionStart !== ta.selectionEnd) return;
        const edit = mdListEnterEdit(ta.value, ta.selectionStart);
        if (!edit) return;
        event.preventDefault();
        applyMdEdit(ta, edit);
    });
    ta.addEventListener('scroll', () => {
        if (box.dataset.view !== 'split') return;
        const pane = box.querySelector('[data-md-preview]');
        pane.scrollTop = (ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight)) * (pane.scrollHeight - pane.clientHeight);
    });
}

window.enhanceRawView = function () {
    const ta = document.getElementById('raw-view');
    if (!ta || ta.dataset.mdReady) return;
    ta.dataset.mdReady = '1';
    const box = document.createElement('div');
    box.id = 'md-editor';
    box.className = 'hidden';
    box.innerHTML = mdToolbarHtml();
    ta.parentNode.insertBefore(box, ta);
    const body = box.querySelector('[data-md-body]');
    body.insertBefore(ta, body.firstChild);
    bindMdToolbar(box, ta);
    bindMdTextarea(box, ta);
    applyMdView(box, mdSavedView());
};

window.syncMdToolbar = function () {
    const box = document.getElementById('md-editor');
    const ta = document.getElementById('raw-view');
    if (!box || !ta) return;
    box.classList.toggle('hidden', ta.classList.contains('hidden'));
    syncMdWidth(box);
    paintMdPreview();
};

window.refreshMdPreview = paintMdPreview;

window.copyTabMarkdown = async function (moduleId) {
    const mod = getEditingModule(moduleId);
    const md = mod && getActiveTabContent(mod);
    if (!md || !md.trim()) return window.showAlert('복사할 내용이 없습니다.');
    try {
        await navigator.clipboard.writeText(md);
        window.showToast?.('현재 탭의 마크다운을 복사했습니다.', 'success');
    } catch (err) {
        console.warn('[복사] 실패:', err.message);
        window.showAlert('복사하지 못했습니다. 수정 모드에서 내용을 선택해 복사해 주세요.');
    }
};

function appendAiInstruction(current, instruction) {
    const text = current.trim();
    if (!text) return instruction;
    return `${text}${/[.。]$/.test(text) ? ' ' : ', '}${instruction}`;
}

function onAiChipClick(event) {
    const chip = AI_EDIT_CHIPS[Number(event.target.dataset?.aiChip)];
    const input = document.getElementById('ai-command-input');
    if (!chip || !input) return;
    if (aiCommandMode !== 'edit') switchAIMode('edit');
    input.value = appendAiInstruction(input.value, chip.text || chip.label);
    input.focus();
}

function renderAiEditChips() {
    const box = document.getElementById('ai-edit-chips');
    if (!box) return;
    box.innerHTML = AI_EDIT_CHIPS.map((chip, index) => `<button type="button" data-ai-chip="${index}" class="px-2 py-0.5 text-[0.6875rem] text-white/70 bg-white/5 border border-white/10 rounded-full hover:bg-white/10">${chip.label}</button>`).join('');
    box.addEventListener('mousedown', event => event.preventDefault()); // 드래그한 선택 영역 유지
    box.addEventListener('click', onAiChipClick);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderAiEditChips);
else renderAiEditChips();
