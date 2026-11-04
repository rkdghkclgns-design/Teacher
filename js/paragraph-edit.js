// paragraph-edit.js - 교안 본문을 두 번 누르면 그 단락만 원문(마크다운) 편집 상자로 연다
// 화면 블록과 원문 블록은 순서가 아니라 글자로 짝짓는다(lesson-format.js의 locateLessonBlock).
// 화면 후처리가 블록을 나누거나 지워도 누른 단락이 열린다. 저장한 편집은 Ctrl+Z로 되돌린다(format-toolbar.js).

const PARA_EDIT_HINT = 'Enter 저장 · Shift+Enter 줄바꿈 · Esc 취소';
const PARA_EDIT_SKIP = 'button, a, video, input, textarea, select, [data-lesson-action], .para-edit';

function paraAutoSize(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight + 4, window.innerHeight * 0.6)}px`;
}

function paraEditHtml() {
    return `
        <div class="para-edit-head">
            <span><i class="ph-bold ph-pencil-simple"></i> 이 단락 수정 중</span>
            <span class="para-edit-hint">${PARA_EDIT_HINT}</span>
        </div>
        <textarea class="para-edit-input" spellcheck="false" aria-label="단락 원문(마크다운)"></textarea>
        <div class="para-edit-actions">
            <button type="button" data-para="cancel">취소</button>
            <button type="button" data-para="save">저장</button>
        </div>`;
}

// 저장: 원문에서 그 블록만 바꾸고 다시 그린다. 고치는 사이 탭이나 원문이 바뀌었으면 덮어쓰지 않는다
function commitParagraph(ctx, text) {
    const { mod, tabId, source, block } = ctx;
    const stale = currentLessonTab !== tabId || getActiveTabContent(mod) !== source;
    const next = stale ? null : replaceLessonBlock(source, block, text);
    if (next == null) {
        window.showToast?.('탭 내용이 바뀌어 고친 내용을 반영하지 않았습니다.', 'warning');
        renderEditor(mod);
        return;
    }
    const area = document.getElementById('editor-content-area');
    const scrollTop = area ? area.scrollTop : 0;
    window.recordLessonEdit?.(mod, tabId, source, next);
    setTabMarkdown(mod, tabId, next);
    saveState().then(() => {
        renderEditor(mod);
        if (area) area.scrollTop = scrollTop;
    }).catch(err => {
        console.error('[단락 수정] 저장 실패:', err);
        window.showToast?.('고친 단락을 저장하지 못했습니다. 다시 시도해 주세요.', 'error');
    });
}

function mountParagraphEditor(target, ctx) {
    const original = ctx.block.raw.trimEnd();
    const box = document.createElement('div');
    box.className = 'para-edit';
    box.innerHTML = paraEditHtml();
    const ta = box.querySelector('textarea');
    ta.value = original;
    target.classList.add('hidden');
    target.isEditing = true;
    target.after(box);

    let done = false;
    const finish = save => {
        if (done) return;
        done = true;
        const text = ta.value.trimEnd();
        if (save && text && text !== original) {
            commitParagraph(ctx, text);
            return;
        }
        box.remove();
        target.classList.remove('hidden');
        target.isEditing = false;
    };

    box.addEventListener('mousedown', event => {
        if (event.target.closest('[data-para]')) event.preventDefault(); // 버튼을 눌러도 입력칸 포커스를 지켜 blur 저장과 겹치지 않게
    });
    box.addEventListener('click', event => {
        const button = event.target.closest('[data-para]');
        if (button) finish(button.dataset.para === 'save');
    });
    ta.addEventListener('input', () => paraAutoSize(ta));
    ta.addEventListener('blur', () => finish(true));
    ta.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            finish(true);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
        }
    });
    paraAutoSize(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
}

window.openParagraphEditor = function (event) {
    const view = document.getElementById('render-view');
    const mod = typeof getEditingModule === 'function' ? getEditingModule() : null;
    const source = mod ? getActiveTabContent(mod) : '';
    if (!view || !source || typeof marked === 'undefined' || event.target.closest(PARA_EDIT_SKIP)) return;
    const target = event.target.closest('#render-view > *');
    if (!target || target.isEditing || view.querySelector('.para-edit')) return;
    const block = locateLessonBlock(source, { index: [...view.children].indexOf(target), text: target.textContent || '' });
    if (!block) {
        window.showToast?.('이 단락을 원문에서 찾지 못했습니다. 도구 → 원문 전체 수정에서 고쳐 주세요.', 'warning');
        return;
    }
    window.getSelection()?.removeAllRanges(); // 두 번 누르면 단어가 골라져 서식 막대가 뜬다
    window.hideHoverTooltip?.();
    mountParagraphEditor(target, { mod, tabId: currentLessonTab, source, block });
};
