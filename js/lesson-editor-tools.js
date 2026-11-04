// lesson-editor-tools.js - 교안 섹션 고정
// develocket-slide(assets/course-textbook.js, course-ai-tb.js @3a7303f)의 칸 고정을 섹션 단위로 옮겼다.
// 고정한 섹션은 AI가 탭을 다시 쓸 때 프롬프트로 지시하고, 응답을 받은 뒤 원문으로 되돌려 한 글자도 바뀌지 않게 한다.

const LOCK_TITLE_NOISE = /\(⏱[^)]*\)|[^\s\w가-힣·:()-]/g;

const lockTitleKey = title => String(title).replace(LOCK_TITLE_NOISE, '').replace(/\s+/g, ' ').trim();

// H2 기준으로 나눈다. 코드 블록 안의 ## 은 제목이 아니다.
function mdSections(md) {
    const sections = [];
    let fenced = false;
    String(md || '').replace(/\r\n/g, '\n').split('\n').forEach(line => {
        if (/^\s*```/.test(line)) fenced = !fenced;
        if (!fenced && /^##\s+/.test(line)) sections.push({ title: line.replace(/^##\s+/, '').trim(), lines: [line] });
        else if (sections.length) sections.at(-1).lines.push(line);
        else sections.push({ title: '', lines: [line] });
    });
    return sections.map(section => ({ title: section.title, text: section.lines.join('\n').trimEnd() }));
}

function lockedTitles(mod, tabId) {
    return mod.lockedSections?.[tabId] || [];
}

function lockedSectionBlocks(mod, tabId) {
    const titles = new Set(lockedTitles(mod, tabId));
    return mdSections(mod.tabContents?.[tabId]).filter(section => titles.has(lockTitleKey(section.title)));
}

function lockedSectionPrompt(blocks) {
    if (!blocks.length) return '';
    return `\n\n[고정 섹션 — 아래 섹션은 한 글자도 바꾸지 말고 같은 제목으로 그대로 출력하세요. 나머지 섹션만 새로 씁니다.]\n${blocks.map(block => block.text).join('\n\n')}`;
}

// 모델이 고정 섹션을 고치거나 빠뜨려도 원문으로 되돌린다. 같은 제목은 나온 순서대로 짝짓는다.
function restoreLockedSections(nextMd, blocks) {
    if (!blocks.length) return nextMd;
    const pending = [...blocks];
    const replaced = mdSections(nextMd).map(section => {
        const index = pending.findIndex(block => lockTitleKey(block.title) === lockTitleKey(section.title));
        return index < 0 ? section.text : pending.splice(index, 1)[0].text;
    });
    return [...replaced, ...pending.map(block => block.text)].join('\n\n');
}

window.openSectionLocks = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod?.tabContents || document.getElementById('section-lock-dialog')) return;
    const tabId = currentLessonTab;
    const sections = mdSections(mod.tabContents[tabId]).filter(section => section.title);
    if (!sections.length) return window.showAlert('이 탭에 고정할 섹션이 없습니다.');
    const locked = new Set(lockedTitles(mod, tabId));
    const overlay = document.createElement('div');
    overlay.id = 'section-lock-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[480px] max-h-[80vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10">
                <h2 class="text-sm font-bold text-textLight">섹션 고정</h2>
                <p class="text-xs text-textMuted mt-1">고정한 섹션은 이 탭을 다시 생성해도 그대로 유지됩니다.</p>
            </div>
            <div class="flex-1 overflow-y-auto p-4 space-y-1">${sections.map(section => `
                <label class="flex items-center gap-2 text-xs text-textLight">
                    <input type="checkbox" data-lock-title="${escapeHtml(lockTitleKey(section.title))}" ${locked.has(lockTitleKey(section.title)) ? 'checked' : ''}> ${escapeHtml(section.title)}
                </label>`).join('')}
            </div>
            <div class="p-3 border-t border-white/10 flex justify-end gap-2">
                <button data-lock-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
                <button data-lock-action="save" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">저장</button>
            </div>
        </div>`;
    overlay.addEventListener('click', async event => {
        const action = event.target.dataset?.lockAction;
        if (!action) return;
        if (action === 'save') {
            const titles = [...overlay.querySelectorAll('[data-lock-title]:checked')].map(box => box.dataset.lockTitle);
            mod.lockedSections = { ...(mod.lockedSections || {}), [tabId]: titles };
            await saveState();
        }
        overlay.remove();
    });
    document.body.appendChild(overlay);
};

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
        reader.readAsDataURL(file);
    });
}
