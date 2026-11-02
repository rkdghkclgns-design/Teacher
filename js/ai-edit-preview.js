// ai-edit-preview.js - AI 수정 결과를 단어 단위로 비교해 보여 주고 반영 여부를 고른다
// 비교 방식은 develocket-slide(assets/course-rules.js @3a7303f)의 wordDiff를 따른다.
// 탭 전체를 바꾸는 작업은 ## 섹션별로 비교한다. 긴 탭을 통째로 비교하면 표 크기가 상한을 넘어 차이를 보여 주지 못한다.

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

// 제목이 같은 섹션끼리 먼저 짝짓고, 남은 섹션은 본문이 비슷하면 제목만 바뀐 것으로 본다. 사라진 섹션은 원래 자리에 넣어 둔다.
function alignMdSections(beforeMd, afterMd) {
    const pending = mdSections(beforeMd).map((section, index) => ({ ...section, index }));
    const take = at => (at < 0 ? null : pending.splice(at, 1)[0]);
    const matched = mdSections(afterMd).map(section => ({ section, match: take(pending.findIndex(item => lockTitleKey(item.title) === lockTitleKey(section.title))) }));
    const rows = matched.map(({ section, match }) => {
        const pair = match || take(pending.findIndex(item => isRenamedSection(item.text, section.text)));
        return { title: section.title, before: pair?.text ?? '', after: section.text, index: pair?.index ?? -1 };
    });
    const merged = pending.reduce((list, gone) => {
        const at = list.findIndex(row => row.index > gone.index);
        const row = { title: gone.title, before: gone.text, after: '', index: gone.index };
        return at < 0 ? [...list, row] : [...list.slice(0, at), row, ...list.slice(at)];
    }, rows);
    return merged.filter(row => row.before.trim() || row.after.trim());
}

const sectionChanged = row => row.before.trim() !== row.after.trim();

// 사라진 섹션은 모델이 빠뜨렸을 수 있으므로 기본으로 원문을 남긴다. 응답이 잘렸으면 마지막 섹션도 잘린 글이므로 고르지 않는다.
function defaultAcceptedRows(rows, truncated = false) {
    const cut = truncated ? rows.map(row => !!row.after.trim()).lastIndexOf(true) : -1;
    return new Set(rows.flatMap((row, index) => (index !== cut && sectionChanged(row) && row.after.trim() ? [index] : [])));
}

// 고르지 않은 섹션은 원문을 유지한다
function composeSectionChoice(rows, accepted) {
    return rows.map((row, index) => (accepted.has(index) ? row.after : row.before)).filter(text => text.trim()).join('\n\n');
}

function lintDeltaLabel(beforeMd, afterMd, tabId) {
    const before = lintCounts(lintLessonMarkdown(beforeMd, tabId));
    const after = lintCounts(lintLessonMarkdown(afterMd, tabId));
    return `검수 지적 필수 ${before.required} → ${after.required} · 권장 ${before.recommended} → ${after.recommended}`;
}

function sectionRowHtml(row, index, checked) {
    const state = !row.before.trim() ? '새 섹션' : !row.after.trim() ? '삭제 제안 · 기본은 유지' : '변경';
    return `
        <div class="border border-white/10 rounded-lg p-2">
            <label class="flex items-center gap-2 text-xs font-bold text-textLight">
                <input type="checkbox" data-section-row="${index}" ${checked ? 'checked' : ''}>
                <span class="flex-1 truncate">${escapeHtml(row.title || '머리말')}</span>
                <span class="text-[0.6rem] font-normal text-textMuted">${state}</span>
            </label>
            <div class="mt-1 text-sm text-textLight leading-relaxed whitespace-pre-wrap">${wordDiffHtml(row.before, row.after)}</div>
        </div>`;
}

function aiChangeHtml({ title, note, summary, rows, accepted }) {
    const changed = rows.map((row, index) => ({ row, index })).filter(({ row }) => sectionChanged(row));
    return `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[720px] max-w-[92vw] max-h-[84vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10">
                <h2 class="text-sm font-bold text-textLight">${escapeHtml(title)}</h2>
                <p data-diff-summary class="text-[0.65rem] text-textMuted mt-1">${escapeHtml(summary)}</p>
                ${note ? `<p class="text-[0.65rem] text-amber-300 mt-1">${escapeHtml(note)}</p>` : ''}
            </div>
            <div class="flex-1 overflow-y-auto p-4 space-y-2">
                ${changed.length ? changed.map(({ row, index }) => sectionRowHtml(row, index, accepted.has(index))).join('') : '<p class="text-xs text-textMuted">바뀐 내용이 없습니다.</p>'}
                ${changed.length && changed.length < rows.length ? `<p class="text-[0.65rem] text-textMuted">변경 없는 섹션 ${rows.length - changed.length}개는 그대로 둡니다.</p>` : ''}
            </div>
            <div class="p-3 border-t border-white/10 flex justify-end gap-2">
                <button data-diff-action="cancel" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">취소</button>
                <button data-diff-action="apply" ${changed.length ? '' : 'disabled'} class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover disabled:opacity-50">선택한 섹션 반영</button>
            </div>
        </div>`;
}

// 고른 섹션을 반영한 마크다운을 돌려준다. 취소하면 null
function previewAiChange(beforeMd, afterMd, { title = 'AI 수정 미리보기', tabId, note = '', truncated = false } = {}) {
    const rows = alignMdSections(beforeMd, afterMd);
    let accepted = defaultAcceptedRows(rows, truncated);
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9200]';
        overlay.innerHTML = aiChangeHtml({ title, note, summary: lintDeltaLabel(beforeMd, composeSectionChoice(rows, accepted), tabId), rows, accepted });
        overlay.addEventListener('change', event => {
            const index = Number(event.target.dataset?.sectionRow);
            if (Number.isNaN(index)) return;
            accepted = new Set([...accepted].filter(item => item !== index).concat(event.target.checked ? [index] : []));
            overlay.querySelector('[data-diff-summary]').textContent = lintDeltaLabel(beforeMd, composeSectionChoice(rows, accepted), tabId);
        });
        overlay.addEventListener('click', event => {
            const action = event.target.dataset?.diffAction;
            if (!action) return;
            overlay.remove();
            resolve(action === 'apply' ? composeSectionChoice(rows, accepted) : null);
        });
        document.body.appendChild(overlay);
    });
}
