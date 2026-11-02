// ai-edit-preview.js - AI 수정 결과를 단어 단위로 비교해 보여 주고 반영 여부를 고른다
// 비교 방식은 develocket-slide(assets/course-rules.js @3a7303f)의 wordDiff를 따른다.

const WORD_DIFF_MAX_CELLS = 4000000;
const DIFF_DEL_CLASS = 'bg-red-500/20 text-red-300 line-through';
const DIFF_INS_CLASS = 'bg-emerald-500/20 text-emerald-300';

const diffTag = (tag, text, className) => (text ? `<${tag} class="${className}">${escapeHtml(text)}</${tag}>` : '');

function buildLcsTable(before, after) {
    const table = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
    for (let i = before.length - 1; i >= 0; i--) {
        for (let j = after.length - 1; j >= 0; j--) {
            table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    return table;
}

function wordDiffHtml(beforeText, afterText) {
    const before = String(beforeText || '').split(/(\s+)/);
    const after = String(afterText || '').split(/(\s+)/);
    if (before.length * after.length > WORD_DIFF_MAX_CELLS) return diffTag('del', beforeText, DIFF_DEL_CLASS) + diffTag('ins', afterText, DIFF_INS_CLASS);
    const table = buildLcsTable(before, after);
    const pieces = [];
    let removed = '';
    let added = '';
    let i = 0;
    let j = 0;
    const flush = () => {
        pieces.push(diffTag('del', removed, DIFF_DEL_CLASS), diffTag('ins', added, DIFF_INS_CLASS));
        removed = '';
        added = '';
    };
    while (i < before.length && j < after.length) {
        if (before[i] === after[j]) {
            flush();
            pieces.push(escapeHtml(before[i]));
            i += 1;
            j += 1;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            removed += before[i++];
        } else {
            added += after[j++];
        }
    }
    removed += before.slice(i).join('');
    added += after.slice(j).join('');
    flush();
    return pieces.join('');
}

// 사용자가 반영을 고르면 true, 취소하면 false
function confirmAiEdit(beforeText, afterText) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9200]';
        overlay.innerHTML = `
            <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[640px] max-h-[80vh] flex flex-col shadow-2xl">
                <div class="p-4 border-b border-white/10"><h2 class="text-sm font-bold text-textLight">AI 수정 미리보기</h2></div>
                <div class="flex-1 overflow-y-auto p-4 text-sm text-textLight leading-relaxed whitespace-pre-wrap">${wordDiffHtml(beforeText, afterText)}</div>
                <div class="p-3 border-t border-white/10 flex justify-end gap-2">
                    <button data-diff-action="cancel" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">취소</button>
                    <button data-diff-action="apply" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">반영</button>
                </div>
            </div>`;
        overlay.addEventListener('click', event => {
            const action = event.target.dataset?.diffAction;
            if (!action) return;
            overlay.remove();
            resolve(action === 'apply');
        });
        document.body.appendChild(overlay);
    });
}
