// lesson-objectives.js - 학습 목표 세트: 목표·내용 섹션·체크리스트를 한 벌로 더하거나 뺀다
// 흐름은 develocket-slide(assets/course-textbook.js 학습목표 추가·삭제 @3a7303f)를 따른다.
// Teacher는 구조화 필드 대신 탭 마크다운이 원본이므로 마크다운을 읽고 고쳐 쓴다.

const OBJECTIVE_SECTION = new RegExp(`${LESSON_HEADING_PREFIX}학습\\s*목표`);
const CHECKLIST_SECTION = new RegExp(`${LESSON_HEADING_PREFIX}학습\\s*후\\s*체크리스트`);
const OBJECTIVE_BULLETS = '학습\\s*목표';
const CHECKLIST_BULLETS = '학습\\s*후\\s*체크리스트';
const OBJECTIVE_LESSON_CHARS = 6000;

let _objectiveDialog = null;

const objectiveTabMd = (mod, tabId) => String(mod.tabContents?.[tabId] || '').replace(/\r\n/g, '\n');

// 내용 섹션과 그 위치. 제목이 같은 섹션이 있어도 위치로 구분한다
const objectiveContentSections = md => mdSections(md)
    .map((section, index) => ({ title: section.title, index }))
    .filter(section => section.title && lessonContentTitles([section.title]).length);

/* ---------- 불릿 편집 ---------- */
const bulletStarts = lines => lines.flatMap((line, index) => (/^[-*]\s+\S/.test(line) ? [index] : []));

// 들여쓴 세부 불릿까지 한 항목으로 본다
function bulletEnd(lines, start) {
    const rest = lines.slice(start + 1).findIndex(line => !/^\s+\S/.test(line));
    return rest < 0 ? lines.length : start + 1 + rest;
}

function withBullet(text, bullet) {
    const lines = text.split('\n');
    const starts = bulletStarts(lines);
    if (!starts.length) return `${text.trimEnd()}\n\n- ${bullet}`;
    const end = bulletEnd(lines, starts.at(-1));
    return [...lines.slice(0, end), `- ${bullet}`, ...lines.slice(end)].join('\n');
}

function withoutBullet(text, index) {
    const lines = text.split('\n');
    const start = bulletStarts(lines)[index];
    return start === undefined ? text : [...lines.slice(0, start), ...lines.slice(bulletEnd(lines, start))].join('\n');
}

/* ---------- 세트 추가·삭제 ---------- */
function insertObjectiveSet(md, { objective, section, checklist }) {
    const sections = mdSections(md);
    const goals = sections.findIndex(item => OBJECTIVE_SECTION.test(item.title));
    const checks = sections.findIndex(item => CHECKLIST_SECTION.test(item.title));
    const body = sections.map((item, index) => {
        if (index === goals) return withBullet(item.text, objective);
        return index === checks ? withBullet(item.text, checklist) : item.text;
    });
    const contentAt = checks < 0 ? body.length : checks;
    const filled = [...body.slice(0, contentAt), section, ...body.slice(contentAt)];
    const headAt = sections[0]?.title ? 0 : 1; // 제목만 있는 머리말 뒤에 넣는다
    const head = goals < 0 ? [`## 학습 목표\n\n- ${objective}`] : [];
    const tail = checks < 0 ? [`## 학습 후 체크리스트\n\n- ${checklist}`] : [];
    return `${[...filled.slice(0, headAt), ...head, ...filled.slice(headAt), ...tail].join('\n\n')}\n`;
}

// sectionIndexes: mdSections 기준 위치. 목표와 체크리스트는 검수가 읽는 첫 섹션만 고친다
function removeObjectiveSet(md, index, sectionIndexes) {
    const sections = mdSections(md);
    const dropped = new Set(sectionIndexes);
    const goals = sections.findIndex(section => OBJECTIVE_SECTION.test(section.title));
    const checks = sections.findIndex(section => CHECKLIST_SECTION.test(section.title));
    const kept = sections.flatMap((section, at) => {
        if (dropped.has(at)) return [];
        return [at === goals || at === checks ? withoutBullet(section.text, index) : section.text];
    });
    return `${kept.join('\n\n')}\n`;
}

function checklistRefIndex(titles, check) {
    const key = text => String(text).replace(/\(⏱[^)]*\)|[^\w가-힣]/g, '');
    const ref = key((check.match(LESSON_CHECK_REF) || [])[1] || '');
    return ref ? titles.findIndex(title => key(title).includes(ref) || ref.includes(key(title))) : -1;
}

// 체크리스트의 "다시 보기"가 가리키는 섹션부터 다음 목표의 섹션 앞까지를 그 목표의 내용으로 본다.
// 대응을 읽지 못하면 비워 두고 사용자가 고른다
function objectiveContentRange(md, index) {
    const sections = objectiveContentSections(md);
    const titles = sections.map(section => section.title);
    const starts = lessonLintBullets(md, CHECKLIST_BULLETS).map(check => checklistRefIndex(titles, check));
    const start = starts[index];
    if (start === undefined || start < 0) return [];
    const later = starts.filter(at => at > start);
    return sections.slice(start, later.length ? Math.min(...later) : start + 1);
}

// 문항의 목표 번호는 문제은행 목록의 순서다. 목표가 빠지면 뒤 번호가 당겨지므로 문항 연결을 새 순서로 고친다
function remappedAssessment(md, before, after, deleteLinked) {
    return lessonLintQuestions(md).map(parseQuestionBlock).reduceRight((text, question, index) => {
        if (!before[question.objective - 1]) return text; // 연결이 없거나 번호가 이미 어긋난 문항은 지운 목표와 무관하다
        const objective = after.indexOf(before[question.objective - 1]) + 1;
        if (!objective && deleteLinked) return removeQuestionMd(text, index);
        return objective === question.objective ? text : updateQuestionMd(text, index, { ...question, objective: objective || null });
    }, md);
}

/* ---------- AI 추가 ---------- */
function buildObjectiveSetPrompt(mod, md, hint) {
    const goals = lessonLintBullets(md, OBJECTIVE_BULLETS);
    return [
        '아래 교안 탭에 학습 목표 세트 하나를 더합니다. 기존 학습 목표와 섹션은 그대로 두고 새 세트만 JSON으로 출력합니다.',
        '- objective: "~할 수 있습니다."로 끝나는 관찰 가능한 행동 한 문장입니다. 수행 조건과 제약을 담습니다.',
        '- section: "## 제목"으로 시작하는 학습 내용 마크다운입니다. 설명은 "~합니다"로 끝내고 학습자를 호칭하지 않습니다.',
        '- section에 코드 블록을 쓰면 언어를 적고, 코드 첫 줄 위에 무엇을 하는 코드인지, 핵심 줄 위나 줄 끝에 그 줄이 하는 일을 한국어 주석으로 적어 코드 열 줄마다 주석을 하나 이상 둡니다.',
        '- checklist: 목표를 스스로 확인하는 문장입니다. 끝에 "(다시 보기: 섹션 제목)"을 적습니다.',
        `[차시] ${mod.title}`,
        `[기존 학습 목표]\n${goals.map((goal, i) => `${i + 1}. ${goal}`).join('\n') || '(없음)'}`,
        hint ? `[새 목표에서 다룰 내용]\n${hint}` : '[새 목표] 기존 목표에서 빠진 내용을 골라 씁니다.',
        `[교안]\n${md.slice(0, OBJECTIVE_LESSON_CHARS)}`, '',
        '{"objective": "...", "section": "## 제목\\n\\n본문", "checklist": "..."}'
    ].join('\n');
}

function parseObjectiveSet(parsed) {
    const [objective, section, checklist] = ['objective', 'section', 'checklist'].map(key => String(parsed?.[key] || '').trim());
    if (!objective || !section || !checklist) throw new Error('AI 응답에 목표, 내용, 체크리스트가 모두 있어야 합니다. 다시 시도해주세요.');
    return { objective, checklist, section: /^##\s/.test(section) ? section : `## ${section}` };
}

async function runObjectiveAdd(mod, tabId, button) {
    const hint = document.getElementById('objective-hint').value.trim();
    const before = storedTabMarkdown(mod, tabId);
    button.disabled = true;
    setObjectiveStatus('새 학습 목표 세트를 만들고 있습니다...');
    try {
        const drafted = parseObjectiveSet(await askDesignJson(buildObjectiveSetPrompt(mod, objectiveTabMd(mod, tabId), hint)));
        // 새 섹션의 주석이 모자란 코드 블록에는 주석만 더한다(code-comments-tool.js). 탭 전체는 돌리지 않고, 결과(넣지 못한 블록 포함)는 미리보기 안내에 적는다
        const commented = typeof addGeneratedCodeComments === 'function'
            ? await addGeneratedCodeComments({ md: drafted.section, tabId, quiz: isCodeCommentQuiz(mod, tabId), onStatus: setObjectiveStatus, notify: false })
            : { md: drafted.section, run: null };
        const set = { ...drafted, section: commented.md };
        const note = typeof commentRunNote === 'function' ? commentRunNote(commented.run) : '';
        setObjectiveStatus('');
        const approved = await previewAiChange(before, insertObjectiveSet(before, set), { title: '학습 목표 세트 미리보기', tabId, note });
        if (approved === null || !(await commitTabChange(mod, tabId, before, approved, `학습 목표 추가: ${set.objective}`))) return;
        if (mod.objectives?.length && approved.includes(set.objective)) mod.objectives = [...mod.objectives, set.objective];
        await saveState();
        renderObjectiveDialog();
    } catch (err) {
        console.error('[학습 목표] 세트 추가 실패:', err);
        setObjectiveStatus(`세트를 만들지 못했습니다: ${err.message}`);
    } finally {
        button.disabled = false;
    }
}

// 목표를 지운 탭이 든 갈래(기본학습·심화학습)의 문제은행 탭 문항 번호를 고친다.
// 다른 갈래의 문제은행도 번호 목록이 바뀌면 고친다(예전 방식의 학습이해도는 차시 전체 목표로 번호를 센다). 연결 문항 지우기는 지운 탭의 갈래에만 쓴다
async function runObjectiveRemove(mod, tabId, index) {
    const dialog = document.getElementById('objective-dialog');
    const track = tabTrack(tabId) || lessonTrack('basic');
    const before = storedTabMarkdown(mod, tabId);
    const goal = lessonLintBullets(objectiveTabMd(mod, tabId), OBJECTIVE_BULLETS)[index];
    const banksBefore = LESSON_TRACKS.map(item => ({ item, objectives: qbankObjectives(mod, item.id) }));
    const sections = [...dialog.querySelectorAll('[data-objective-section]:checked')].map(box => Number(box.dataset.objectiveSection));
    const deleteLinked = dialog.querySelector('[name="objective-questions"]:checked')?.value === 'delete';
    if (!(await commitTabChange(mod, tabId, before, removeObjectiveSet(before, index, sections), `학습 목표 삭제: ${goal}`))) return;
    mod.objectives = (mod.objectives || []).filter(text => text !== goal); // 문제은행 목록이 이 값을 쓸 수 있어 번호를 고치기 전에 뺀다
    const remaps = banksBefore.map(({ item, objectives }) => {
        const assessment = qbankMarkdown(mod, item.id);
        return { item, assessment, remapped: remappedAssessment(assessment, objectives, qbankObjectives(mod, item.id), deleteLinked && item.id === track.id) };
    });
    for (const { item, assessment, remapped } of remaps) {
        if (remapped === assessment) continue;
        const bankLabel = LESSON_TABS.find(tab => tab.id === item.bank)?.label || item.bank;
        await archiveContent({ title: `${mod.title} · ${bankLabel}`, content: assessment, images: mod.images, tabId: item.bank, lesson: mod }, '학습 목표 삭제 전');
        setTabMarkdown(mod, item.bank, remapped);
    }
    _objectiveDialog = { ..._objectiveDialog, pick: null };
    await saveState();
    renderObjectiveDialog();
}

/* ---------- 대화상자 ---------- */
function setObjectiveStatus(text) {
    const status = document.getElementById('objective-status');
    if (status) status.textContent = text;
}

function objectiveImpactHtml(mod, md, index) {
    const goals = lessonLintBullets(md, OBJECTIVE_BULLETS);
    const trackId = (tabTrack(_objectiveDialog?.tabId) || lessonTrack('basic')).id; // 그 탭이 든 갈래의 문제은행 문항
    const linkedNo = qbankObjectives(mod, trackId).indexOf(goals[index]) + 1;
    const linked = qbankQuestions(mod, trackId).filter(question => linkedNo && question.objective === linkedNo).length;
    const chosen = new Set(objectiveContentRange(md, index).map(section => section.index));
    const check = lessonLintBullets(md, CHECKLIST_BULLETS)[index];
    const rows = objectiveContentSections(md).map(({ title, index: at }) => `
        <label class="flex items-center gap-2 text-xs text-textLight"><input type="checkbox" data-objective-section="${at}" ${chosen.has(at) ? 'checked' : ''}> <span class="truncate">${escapeHtml(title)}</span></label>`).join('');
    return `
        <div class="mt-1 p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 space-y-2">
            <p class="text-xs text-textLight">학습 목표와 체크리스트 항목을 지웁니다.${check ? ` 체크리스트: ${escapeHtml(check)}` : ''}</p>
            <div><p class="text-xs font-bold text-textMuted mb-1">함께 지울 내용 섹션</p><div class="max-h-28 overflow-y-auto space-y-0.5">${rows || '<p class="text-xs text-textMuted">내용 섹션이 없습니다.</p>'}</div></div>
            ${linked ? `<div class="text-xs text-textLight space-y-0.5"><p class="text-xs font-bold text-textMuted">이 목표에 연결된 문항 ${linked}개</p>
                <label class="flex items-center gap-2"><input type="radio" name="objective-questions" value="keep" checked> 문항은 남기고 연결만 해제 (목표·밴드 표기가 빠집니다)</label>
                <label class="flex items-center gap-2"><input type="radio" name="objective-questions" value="delete"> 문항도 함께 삭제</label></div>` : ''}
            <button data-objective-action="remove" class="px-3 py-1 text-xs font-bold text-white bg-rose-500 rounded">세트 삭제</button>
        </div>`;
}

function objectiveRowHtml(mod, md, goal, index, pick) {
    return `
        <div>
            <div class="flex items-start gap-2 text-xs text-textLight">
                <span class="flex-1 min-w-0">${index + 1}. ${escapeHtml(goal)}</span>
                <button data-objective-action="pick" data-index="${index}" class="px-2 py-0.5 text-[0.6875rem] font-bold text-rose-300 bg-white/10 rounded shrink-0">${pick === index ? '접기' : '삭제'}</button>
            </div>
            ${pick === index ? objectiveImpactHtml(mod, md, index) : ''}
        </div>`;
}

function objectiveDialogBody(mod, tabId, pick) {
    const md = objectiveTabMd(mod, tabId);
    const goals = lessonLintBullets(md, OBJECTIVE_BULLETS);
    return `
        <p class="text-xs text-textMuted">학습 목표, 내용 섹션, 체크리스트는 1:1로 대응하므로 한 벌로 움직입니다.</p>
        <div class="space-y-2">${goals.map((goal, index) => objectiveRowHtml(mod, md, goal, index, pick)).join('') || '<p class="text-xs text-textMuted">이 탭에 학습 목표가 없습니다.</p>'}</div>
        ${goals.length >= LESSON_LINT_MAX_OBJECTIVES ? `<p class="text-xs text-amber-300">학습 목표가 이미 ${goals.length}개입니다. 더 늘리면 차시 분할을 검토합니다.</p>` : ''}
        <label class="block text-[0.6875rem] font-bold text-textMuted">새 학습 목표에서 다룰 내용 (비우면 빠진 내용을 골라 씁니다)
            <textarea id="objective-hint" rows="2" class="mt-1 w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white"></textarea>
        </label>
        <p id="objective-status" class="text-xs text-accent min-h-[1em]"></p>`;
}

function renderObjectiveDialog() {
    const body = document.getElementById('objective-body');
    if (!body || !_objectiveDialog) return;
    const { moduleId, tabId, pick } = _objectiveDialog;
    body.innerHTML = objectiveDialogBody(getEditingModule(moduleId), tabId, pick);
}

function closeObjectiveDialog() {
    document.getElementById('objective-dialog')?.remove();
    _objectiveDialog = null;
}

async function onObjectiveClick(event) {
    const action = event.target.dataset?.objectiveAction;
    if (!action) return;
    if (action === 'close') return closeObjectiveDialog();
    const { moduleId, tabId, pick } = _objectiveDialog;
    const mod = getEditingModule(moduleId);
    if (action === 'add') return runObjectiveAdd(mod, tabId, event.target);
    if (action === 'remove') return runObjectiveRemove(mod, tabId, pick);
    const index = Number(event.target.dataset.index);
    _objectiveDialog = { ..._objectiveDialog, pick: pick === index ? null : index };
    renderObjectiveDialog();
}

// 체크리스트 구조가 있는 탭만 다룬다. 다른 탭을 보고 있으면 기본 학습을 연다
window.openObjectiveSets = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod || document.getElementById('objective-dialog')) return;
    const tabId = LESSON_STRUCTURED_TABS.includes(currentLessonTab) ? currentLessonTab : 'basicLearn';
    if (!mod.tabContents?.[tabId]) return window.showAlert('먼저 교안 탭을 생성해주세요.');
    _objectiveDialog = { moduleId, tabId, pick: null };
    const label = LESSON_TABS.find(tab => tab.id === tabId)?.label || tabId;
    const overlay = document.createElement('div');
    overlay.id = 'objective-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[520px] max-w-[94vw] max-h-[84vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10"><h2 class="text-sm font-bold text-textLight">학습 목표 세트 · ${escapeHtml(label)}</h2></div>
            <div id="objective-body" class="flex-1 overflow-y-auto p-4 space-y-3"></div>
            <div class="p-3 border-t border-white/10 flex justify-end gap-2">
                <button data-objective-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
                <button data-objective-action="add" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover disabled:opacity-50">AI로 세트 추가</button>
            </div>
        </div>`;
    overlay.addEventListener('click', onObjectiveClick);
    document.body.appendChild(overlay);
    renderObjectiveDialog();
};
