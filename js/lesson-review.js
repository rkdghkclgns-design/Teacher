// lesson-review.js - 컨벤션 검수 패널, AI 수정 제안, 생성 직후 자동 수정, 수동 검수 기록
// develocket-slide(assets/course-textbook.js, course-ai-tb.js @3a7303f)의 검수 카드, fixTextbook, repairOnce를 마크다운 탭에 맞게 옮겼다.
// 원본의 교재는 짧아 통째로 고치지만 Teacher의 탭은 응답 한도를 넘을 수 있으므로, 지적이 있는 ## 섹션만 보내고 받은 섹션만 바꿔 끼운다.

const REVIEW_FIX_MAX_CHARS = 30000; // 한 번에 고칠 분량 상한. 넘으면 필수 지적이 있는 섹션부터 고른다
const REVIEW_FIX_MIN_KEEP = 0.7; // 이보다 짧아진 섹션은 내용이 잘린 것으로 보고 원문을 유지한다
const REVIEW_SUBHEADING = /^###\s/gm; // 문항과 소주제. 지적 수가 줄어도 이 수가 줄면 내용을 잃은 것이다
const REVIEW_MAX_OUTPUT_TOKENS = 65536;
const REVIEW_FRAME_WHERE = ['학습 목표', '학습 후 체크리스트'];
const REVIEW_REFERENCE_TITLE = /학습\s*목표|학습\s*후\s*체크리스트/;
const LESSON_CHECKLIST_TITLE = /학습\s*후\s*체크리스트/;
// 학습이해도는 차시의 학습 목표 수를 알아야 목표마다 문제가 있는지 본다. 코드를 다루는 차시는 코드 예제 규칙도 본다
const lessonLintContext = (mod, tabId) => ({
    ...(tabId === 'assessment' && mod ? { objectiveCount: qbankObjectives(mod).length } : {}),
    ...(mod && typeof lessonCodeTopic === 'function' && lessonCodeTopic(mod) ? { codeTopic: true } : {})
});
const REVIEW_MARKERS = /<!--\s*(?:CONTINUE|END)\s*-->/g;
const REVIEW_IMAGE_REF = /local:[\w-]+|\[IMG:[^\]]*\]/g;
const REVIEW_BADGE_STYLES = { bad: 'bg-rose-500 text-white', warn: 'bg-amber-400 text-amber-950', ok: 'bg-emerald-500 text-white' };

let _review = null;

const compactTitle = text => lockTitleKey(text).replace(/\s+/g, '');
const reviewTabLabel = tabId => (LESSON_TABS.find(tab => tab.id === tabId) || {}).label || '이 탭';
const textHash = text => [...String(text)].reduce((hash, ch) => Math.imul(hash ^ ch.codePointAt(0), 16777619) >>> 0, 2166136261);
const imageRefs = text => text.match(REVIEW_IMAGE_REF) || [];
const subheadingCount = text => (text.match(REVIEW_SUBHEADING) || []).length;
const keepsSection = (before, after) => after.length >= before.length * REVIEW_FIX_MIN_KEEP
    && subheadingCount(after) >= subheadingCount(before)
    && imageRefs(before).every(ref => after.includes(ref));
const storedTabMarkdown = (mod, tabId) => mod.tabContents?.[tabId] || (!mod.tabContents || tabId === 'basicLearn' ? mod.content : '') || '';
const reviewHistory =(mod, note) => [{ at: new Date().toISOString(), note }, ...(mod.history || [])].slice(0, LESSON_HISTORY_LIMIT);

/* ---------- 고칠 섹션 고르기와 병합 ---------- */
function issueInSection(issue, section) {
    if (issue.missing) return false;
    const question = String(issue.where).match(/^문제 (\d+)/);
    if (question) return new RegExp(`^###\\s*문제\\s*${question[1]}(?!\\d)`, 'm').test(section.text);
    if (REVIEW_FRAME_WHERE.includes(issue.where)) return compactTitle(section.title).includes(compactTitle(issue.where));
    return issue.where === section.title;
}

// 고정 섹션은 대상에서 빼고, 분량이 넘으면 필수 지적이 있는 섹션부터 고른다. 결과는 문서 순서다.
function pickFixSections(md, issues, lockedBlocks = []) {
    const lockedKeys = new Set(lockedBlocks.map(block => lockTitleKey(block.title)));
    const rows = mdSections(md)
        .map((section, index) => ({ ...section, index, hits: issues.filter(issue => issueInSection(issue, section)) }))
        .filter(row => row.hits.length);
    const open = rows.filter(row => !lockedKeys.has(lockTitleKey(row.title)));
    const ordered = [...open].sort((a, b) => lintCounts(b.hits).required - lintCounts(a.hits).required);
    const chosen = ordered.reduce((picked, row) => {
        const used = picked.reduce((sum, item) => sum + item.text.length, 0);
        return !picked.length || used + row.text.length <= REVIEW_FIX_MAX_CHARS ? [...picked, row] : picked;
    }, []);
    return { targets: [...chosen].sort((a, b) => a.index - b.index), locked: rows.length - open.length, deferred: open.length - chosen.length };
}

function reviewSystemPrompt(tabId) {
    const { personas, rules } = CONTEXT_CORE;
    return [
        personas.instructor, '[작성 규칙]', rules.content_design,
        LESSON_STRUCTURED_TABS.includes(tabId) && rules.learning_checklist,
        tabId === 'assessment' && rules.assessment_design,
        tabId !== 'assessment' && rules.code_examples,
        rules.korean_period, rules.emoji_rule,
        '수정한 마크다운만 출력합니다. 설명이나 코드 펜스를 붙이지 않습니다.'
    ].filter(Boolean).join('\n');
}

const issueLine = issue => `- ${issue.where || '본문'}: ${issue.msg}${issue.snip ? ` (${issue.snip})` : ''}`;

function buildFixPrompt(md, issues, plan, lockedBlocks = []) {
    const sections = mdSections(md);
    const targetIndexes = plan.targets.map(target => target.index);
    const reference = sections.filter((section, index) => !targetIndexes.includes(index) && REVIEW_REFERENCE_TITLE.test(section.title));
    const scoped = issues.filter(issue => issue.missing || plan.targets.some(target => target.hits.includes(issue)));
    return [
        ['[작업] 아래 교안이 컨벤션 검수에서 지적을 받았습니다. [고칠 섹션]을 지적이 모두 해결되도록 고칩니다.',
            '- 지적과 관계없는 내용과 표현은 유지하고 분량을 줄이지 않습니다.',
            '- 고칠 섹션의 ## 제목을 그대로 쓰고, 고칠 섹션만 출력합니다. 다른 섹션은 출력하지 않습니다.',
            '- 이미지 태그(<!-- [IMG: ... ] -->), <img>, <div>, <table>, mermaid, 코드 블록은 바꾸지 않습니다.',
            issues.some(issue => issue.missing) ? '- 없는 섹션을 새로 써야 하면 ## 제목과 함께 출력합니다.' : '',
            lockedBlocks.length ? `- 고정 섹션(${lockedBlocks.map(block => block.title).join(', ')})은 출력하지 않습니다.` : ''
        ].filter(Boolean).join('\n'),
        `[문서 구조]\n${sections.filter(section => section.title).map(section => `- ${section.title}`).join('\n') || '(## 제목 없음)'}`,
        reference.length ? `[참고 섹션 — 고치지 않습니다]\n${reference.map(section => section.text).join('\n\n')}` : '',
        `[지적된 문제]\n${scoped.map(issueLine).join('\n')}`,
        plan.targets.length ? `[고칠 섹션]\n${plan.targets.map(target => target.text).join('\n\n')}` : ''
    ].filter(Boolean).join('\n\n');
}

function cleanFixResponse(text) {
    const body = String(text || '').replace(/\r\n/g, '\n').trim();
    const unwrapped = (body.match(/^```\w*\n([\s\S]*)\n```$/) || [])[1] ?? body;
    const cleaned = unwrapped.replace(REVIEW_MARKERS, '').trim();
    return typeof sanitizeMarkdownContent === 'function' ? sanitizeMarkdownContent(cleaned) : cleaned;
}

// 새 섹션의 자리: 학습 목표는 맨 앞, 개요는 학습 목표 다음, 체크리스트는 맨 끝, 나머지는 체크리스트 앞
function newSectionIndex(sections, title) {
    const start = sections[0] && !sections[0].title ? 1 : 0;
    const goals = sections.findIndex(section => /학습\s*목표/.test(section.title));
    const checklist = sections.findIndex(section => /체크리스트/.test(section.title));
    if (/학습\s*목표/.test(title)) return start;
    if (LESSON_OVERVIEW_TITLE.test(title)) return goals < 0 ? start : goals + 1;
    return /체크리스트/.test(title) || checklist < 0 ? sections.length : checklist;
}

function insertSection(sections, section) {
    const at = newSectionIndex(sections, section.title);
    return [...sections.slice(0, at), section, ...sections.slice(at)];
}

// 학습 탭의 체크리스트는 맨 끝에 둔다. 나눠 받은 응답에서 본문 섹션 사이에 끼면 뒤로 옮긴다
function checklistLast(md, tabId) {
    if (!LESSON_STRUCTURED_TABS.includes(tabId)) return md;
    const sections = mdSections(md);
    const at = sections.findIndex(section => LESSON_CHECKLIST_TITLE.test(section.title));
    if (at < 0 || at === sections.length - 1) return md;
    return [...sections.slice(0, at), ...sections.slice(at + 1), sections[at]].map(section => section.text).join('\n\n');
}

// 대상 섹션만 바꾼다. 다른 제목으로 돌아온 섹션은 본문이 비슷한 대상과만 짝지어, 새 개요가 지적된 섹션을 덮어쓰지 않게 한다.
// 짝이 없는 섹션을 받을 수 없으면 뒷부분을 나눠 쓴 응답일 수 있으므로 응답 전체를 쓰지 않는다.
function mergeFixedSections(md, fixedMd, targets, allowNew = false) {
    const doc = mdSections(md);
    const docKeys = new Set(doc.map(section => lockTitleKey(section.title)));
    const open = [...targets];
    const extras = [];
    const replaced = new Map();
    mdSections(fixedMd).filter(section => section.text.trim() && (section.title || targets.some(target => !target.title))).forEach(section => {
        const at = open.findIndex(target => lockTitleKey(target.title) === lockTitleKey(section.title));
        if (at >= 0) replaced.set(open.splice(at, 1)[0].index, section.text);
        else if (!docKeys.has(lockTitleKey(section.title))) extras.push(section);
    });
    const added = [];
    extras.forEach(section => {
        const at = open.findIndex(target => isRenamedSection(target.text, section.text));
        if (at >= 0) replaced.set(open.splice(at, 1)[0].index, section.text);
        else added.push(section);
    });
    if (added.length && !allowNew) return md;
    const base = doc.map((section, index) => {
        const next = replaced.get(index);
        return next !== undefined && keepsSection(section.text, next) ? { ...section, text: next } : section;
    });
    return added.reduce(insertSection, base).map(section => section.text).join('\n\n');
}

function isBetterFix(before, after) {
    const [a, b] = [lintCounts(before), lintCounts(after)];
    return b.required < a.required || (b.required === a.required && after.length < before.length);
}

async function requestSectionFix({ tabId, md, issues, lockedBlocks = [], onRetry = null }) {
    const plan = pickFixSections(md, issues, lockedBlocks);
    const needsNew = issues.some(issue => issue.missing);
    if (!plan.targets.length && !needsNew) return { text: md, plan };
    const data = await callGemini(TEXT_MODEL, {
        contents: [{ role: 'user', parts: [{ text: buildFixPrompt(md, issues, plan, lockedBlocks) }] }],
        systemInstruction: { parts: [{ text: reviewSystemPrompt(tabId) }] },
        generationConfig: { maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS }
    }, onRetry);
    if (data?.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new Error('응답이 출력 한도에서 잘렸습니다.');
    const merged = mergeFixedSections(md, cleanFixResponse(extractText(data)), plan.targets, needsNew);
    return { text: restoreLockedSections(merged, lockedBlocks), plan };
}

// 생성 직후 필수 지적이 남으면 고쳐 받고, 나아졌을 때만 바꾼다. 어떤 실패도 생성 결과를 잃게 하지 않는다.
// rounds: 고쳐 받는 최대 횟수(기본 한 번). 지적이 없거나, 나아지지 않거나, 중지하면 멈춘다
// minSpokenChars: 분량을 채운 기본 학습은 고친 글의 낭독 글자 수가 이 값(또는 고치기 전 글자 수 중 작은 값)보다 줄면 쓰지 않는다
async function autoFixGeneratedTab({ tabId, md, lockedBlocks = [], onStatus, onRetry, rounds = 1, minSpokenChars = 0, isStopped = () => false }) {
    let current = md;
    for (let round = 1; round <= rounds; round++) {
        if (round > 1 && isStopped()) break;
        const before = lintLessonMarkdown(current, tabId);
        const required = before.filter(issue => issue.sev === 'bad');
        if (!required.length) break;
        const next = await fixRoundText({ tabId, md: current, required, lockedBlocks, onRetry, onStatus: text => onStatus?.(rounds > 1 ? `${text} (${round}/${rounds})` : text) });
        const shrank = minSpokenChars > 0 && next !== null && spokenChars(next) < Math.min(minSpokenChars, spokenChars(current));
        if (next === null || shrank || !isBetterFix(before, lintLessonMarkdown(next, tabId))) break;
        current = next;
    }
    if (current !== md) window.showToast?.('컨벤션 필수 지적을 자동으로 고쳤습니다.', 'success');
    return current;
}

// 한 번 고쳐 받은 글. 실패하면 null(부른 쪽이 지금 글을 지킨다)
async function fixRoundText({ tabId, md, required, lockedBlocks, onRetry, onStatus }) {
    try {
        onStatus(`🔍 컨벤션 필수 지적 ${required.length}건을 고치고 있습니다...`);
        return (await requestSectionFix({ tabId, md, issues: required, lockedBlocks, onRetry })).text;
    } catch (err) {
        console.warn('[자동 수정] 실패해 생성 결과를 유지합니다:', err.message);
        return null;
    }
}

/* ---------- 수동 검수 기록 ---------- */
const manualChecksFor = tabId => LESSON_MANUAL_CHECKS.filter(check => !check.structured || LESSON_STRUCTURED_TABS.includes(tabId));

function withManualCheck(mod, tabId, key, confirmed, md, at) {
    const { [key]: removed, ...rest } = mod.manualReview?.[tabId] || {};
    return { ...(mod.manualReview || {}), [tabId]: confirmed ? { ...rest, [key]: { at, hash: textHash(md) } } : rest };
}

function manualCheckState(record, md) {
    if (!record) return 'none';
    return record.hash === textHash(md) ? 'ok' : 'stale';
}

/* ---------- 탭 반영 ---------- */
// 바꾸기 전 내용은 히스토리에 남긴다. AI를 기다리는 동안 탭이 바뀌었으면 낡은 글로 덮어쓰지 않고 false를 돌려준다.
async function commitTabChange(mod, tabId, before, next, note) {
    if (storedTabMarkdown(mod, tabId) !== before) {
        window.showAlert('수정안을 만드는 동안 탭 내용이 바뀌어 반영하지 않았습니다. 다시 실행해 주세요.');
        return false;
    }
    // 탭이 없는 최종 평가(·옛 차시)는 본문 전체를 고치므로 제목에 탭 이름을 붙이지 않는다
    await archiveContent({ title: mod.tabContents ? `${mod.title} · ${reviewTabLabel(tabId)}` : mod.title, content: before, images: mod.images, tabId, lesson: mod }, '고치기 전');
    setTabMarkdown(mod, tabId, next);
    mod.history = reviewHistory(mod, note);
    await saveState();
    // 그 차시(같은 객체)를 보고 있을 때만 다시 그린다. 다른 교과의 같은 번호 차시나 같은 id의 최종 평가 화면에 이 차시를 그리지 않는다
    if (getEditingModule() === mod && currentLessonTab === tabId) renderEditor(mod);
    return true;
}

function fixPlanNote({ locked, deferred }) {
    return [locked ? `고정 섹션 ${locked}개는 고치지 않았습니다.` : '', deferred ? `분량이 많아 섹션 ${deferred}개는 이번 제안에서 뺐습니다. 반영한 뒤 다시 실행합니다.` : ''].filter(Boolean).join(' ');
}

async function proposeLessonFix() {
    const { moduleId, tabId } = _review;
    const mod = getEditingModule(moduleId);
    const md = storedTabMarkdown(mod, tabId);
    const issues = lintLessonMarkdown(md, tabId, lessonLintContext(mod, tabId));
    setReviewBusy(true);
    try {
        const { text, plan } = await requestSectionFix({ tabId, md, issues, lockedBlocks: lockedSectionBlocks(mod, tabId) });
        if (!plan.targets.length && !issues.some(issue => issue.missing)) return window.showAlert('고칠 수 있는 섹션이 없습니다. 지적된 섹션이 모두 고정되어 있습니다.');
        const next = await previewAiChange(md, text, { title: 'AI 수정 제안', tabId, note: fixPlanNote(plan) });
        if (next !== null) await commitTabChange(mod, tabId, md, next, `AI 수정 제안 반영 (${reviewTabLabel(tabId)})`);
    } catch (err) {
        console.error('[컨벤션 검수] AI 수정 제안 실패:', err);
        window.showAlert(`AI 수정 제안을 만들지 못했습니다: ${err.message}`);
    } finally {
        setReviewBusy(false);
    }
}

/* ---------- 패널 ---------- */
function reviewIssueRow(issue) {
    return `
        <li class="text-xs text-textLight bg-white/5 rounded-lg px-2 py-1.5">
            ${issue.where ? `<b>${escapeHtml(issue.where)}</b> · ` : ''}${escapeHtml(issue.msg)}
            ${issue.snip ? `<div class="text-[0.6875rem] text-textMuted break-all">${escapeHtml(issue.snip)}</div>` : ''}
        </li>`;
}

function reviewIssueGroup(label, tone, issues) {
    if (!issues.length) return '';
    return `<section><h3 class="text-xs font-bold ${tone} mb-1">${label} ${issues.length}건</h3><ul class="space-y-1">${issues.map(reviewIssueRow).join('')}</ul></section>`;
}

// 기본 학습은 낭독 분량도 보인다(탭 위 표시와 같은 저장 글로 센다)
function reviewVolumeStat(mod, tabId, md) {
    if (tabId !== 'basicLearn' || !mod || mod.id === 'mainQuest' || typeof readAloudMinutes !== 'function') return '';
    return ` · 낭독 약 ${readAloudMinutes(storedTabMarkdown(mod, tabId) || md)}분(목표 ${basicLearnTargetMinutes(mod)}분)`;
}

function reviewIssuesHtml(issues, tabId, md, mod = null) {
    const stats = LESSON_STRUCTURED_TABS.includes(tabId) ? lessonStructureStats(md) : null;
    return `
        ${stats ? `<p class="text-xs text-textMuted">학습 목표 ${stats.objectives}개 · 내용 섹션 ${stats.sections}개 · 체크리스트 ${stats.checklist}개${reviewVolumeStat(mod, tabId, md)}</p>` : ''}
        ${issues.length ? '' : '<p class="text-xs text-emerald-300">콘텐츠 업무 설계 규칙에 어긋난 곳이 없습니다.</p>'}
        ${reviewIssueGroup('필수', 'text-rose-300', issues.filter(issue => issue.sev === 'bad'))}
        ${reviewIssueGroup('권장', 'text-amber-300', issues.filter(issue => issue.sev !== 'bad'))}`;
}

function manualCheckRow(check, record, md) {
    const state = manualCheckState(record, md);
    const detail = { none: escapeHtml(check.hint), ok: `확인함 · ${escapeHtml(localTimeText(record?.at))}`, stale: '확인한 뒤 내용이 바뀌었습니다. 다시 확인합니다.' }[state];
    return `
        <label class="flex items-start gap-2 text-xs text-textLight">
            <input type="checkbox" class="mt-0.5" data-manual-key="${escapeHtml(check.key)}" ${state === 'ok' ? 'checked' : ''}>
            <span>${escapeHtml(check.text)}<span class="block text-[0.6875rem] ${state === 'stale' ? 'text-amber-300' : 'text-textMuted'}">${detail}</span></span>
        </label>`;
}

function reviewManualHtml(mod, tabId, md) {
    const checks = manualChecksFor(tabId);
    const records = mod.manualReview?.[tabId] || {};
    const done = checks.filter(check => manualCheckState(records[check.key], md) === 'ok').length;
    return `
        <section>
            <h3 class="text-xs font-bold text-textLight mb-1">수동 검수 ${done}/${checks.length}</h3>
            <div class="space-y-1.5">${checks.map(check => manualCheckRow(check, records[check.key], md)).join('')}</div>
        </section>`;
}

function reviewRuleItems(sev) {
    return LESSON_RULE_LIST.filter(rule => rule.sev === sev)
        .map(rule => `<li><b class="text-textLight">${escapeHtml(rule.rule)}</b> <span class="opacity-70">${escapeHtml(rule.area)}</span><br>${escapeHtml(rule.desc)}</li>`).join('');
}

function reviewRulesHtml(tabId) {
    const questionRules = tabId === 'assessment' ? `<h4 class="font-bold text-textLight mt-2">문항</h4><ul class="space-y-1">${QBANK_RULE_LIST.map(rule => `<li>${escapeHtml(rule)}</li>`).join('')}</ul>` : '';
    return `
        <details class="text-[0.6875rem] text-textMuted">
            <summary class="cursor-pointer text-xs font-bold text-textLight">검사 규칙 목록</summary>
            <h4 class="font-bold text-rose-300 mt-2">필수</h4><ul class="space-y-1">${reviewRuleItems('bad')}</ul>
            <h4 class="font-bold text-amber-300 mt-2">권장</h4><ul class="space-y-1">${reviewRuleItems('warn')}</ul>
            ${questionRules}
            <p class="mt-2">${escapeHtml(LESSON_RULE_NOTE)}</p>
        </details>`;
}

function reviewPanelHtml(mod, tabId, md, busy) {
    const issues = lintLessonMarkdown(md, tabId, lessonLintContext(mod, tabId));
    const fixLabel = busy ? '수정안을 만들고 있습니다...' : 'AI 수정 제안';
    return `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[640px] max-w-[92vw] max-h-[84vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10">
                <h2 class="text-sm font-bold text-textLight">컨벤션 검수 · ${escapeHtml(reviewTabLabel(tabId))}</h2>
                <p class="text-xs text-textMuted mt-1">콘텐츠 업무 설계 규칙으로 현재 탭을 검사했습니다.</p>
            </div>
            <div class="flex-1 overflow-y-auto p-4 space-y-3">
                ${reviewIssuesHtml(issues, tabId, md, mod)}
                ${reviewManualHtml(mod, tabId, md)}
                ${reviewRulesHtml(tabId)}
            </div>
            <div class="p-3 border-t border-white/10 flex justify-end gap-2">
                <button data-review-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
                <button data-review-action="fix" ${issues.length && !busy ? '' : 'disabled'} class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover disabled:opacity-50" title="지적이 있는 섹션만 고친 수정안을 미리 본 뒤 반영합니다">${fixLabel}</button>
            </div>
        </div>`;
}

function renderReviewPanel() {
    const overlay = document.getElementById('lesson-review-dialog');
    const mod = _review && getEditingModule(_review.moduleId);
    if (overlay && mod) overlay.innerHTML = reviewPanelHtml(mod, _review.tabId, getActiveTabContent(mod), _review.busy);
}

function setReviewBusy(busy) {
    if (!_review) return;
    _review = { ..._review, busy };
    renderReviewPanel();
}

function closeReviewPanel() {
    document.getElementById('lesson-review-dialog')?.remove();
    _review = null;
}

function onReviewClick(event) {
    const action = event.target.dataset?.reviewAction;
    if (action === 'close') closeReviewPanel();
    if (action === 'fix' && _review && !_review.busy) proposeLessonFix();
}

async function onReviewChange(event) {
    const { manualKey } = event.target.dataset || {};
    if (!manualKey || !_review) return;
    const { moduleId, tabId } = _review;
    const mod = getEditingModule(moduleId);
    const at = new Date().toISOString();
    const text = (LESSON_MANUAL_CHECKS.find(check => check.key === manualKey) || {}).text;
    mod.manualReview = withManualCheck(mod, tabId, manualKey, event.target.checked, getActiveTabContent(mod), at);
    mod.history = reviewHistory(mod, `수동 검수 ${event.target.checked ? '확인' : '해제'}: ${text}`);
    await saveState();
    renderReviewPanel();
}

window.runConventionCheck = function (moduleId) {
    const mod = getEditingModule(moduleId);
    const md = mod && getActiveTabContent(mod);
    if (!md || !md.trim()) return window.showAlert('검사할 내용이 없습니다.');
    closeReviewPanel();
    _review = { moduleId: mod.id, tabId: currentLessonTab, busy: false };
    const overlay = document.createElement('div');
    overlay.id = 'lesson-review-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.addEventListener('click', onReviewClick);
    overlay.addEventListener('change', onReviewChange);
    document.body.appendChild(overlay);
    renderReviewPanel();
};

// 탭 전환과 저장 때만 다시 센다. 입력할 때마다 세지 않는다.
window.syncReviewBadge = function (mod = getEditingModule()) {
    window.syncVolumeChip?.(mod); // 탭 위 낭독 분량 표시(lesson-volume.js)도 같은 때 다시 센다
    const badge = document.getElementById('convention-check-count');
    if (!badge || !mod) return;
    const md = getActiveTabContent(mod);
    if (!md || !md.trim()) {
        badge.className = 'hidden';
        badge.textContent = '';
        return;
    }
    const { required, recommended } = lintCounts(lintLessonMarkdown(md, currentLessonTab, lessonLintContext(mod, currentLessonTab)));
    const tone = required ? 'bad' : recommended ? 'warn' : 'ok';
    badge.className = `ml-1 px-1.5 py-0.5 rounded-full text-[0.6875rem] font-bold ${REVIEW_BADGE_STYLES[tone]}`;
    badge.textContent = required || recommended ? `필수 ${required} · 권장 ${recommended}` : '통과';
};
