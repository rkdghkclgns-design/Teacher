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
// 문제은행 탭(학습이해도·심화이해도)은 그 갈래의 학습 목표 수를 알아야 목표마다 문제가 있는지 본다. 코드를 다루는 차시는 코드 예제 규칙도 본다
const lessonLintContext = (mod, tabId) => ({
    ...(isQuestionBankTab(tabId) && mod ? { objectiveCount: qbankObjectives(mod, tabTrack(tabId).id).length } : {}),
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
// 탭의 저장된 글. 탭이 없는 최종 평가는 본문(content), 탭 글이 없는 옛 차시는 기본학습이 본문이다.
// 다른 탭에만 글이 있으면 비운 기본학습은 빈 글이다(content는 그 탭들을 합친 글이다, tabs.js legacyLessonBody)
const storedTabMarkdown = (mod, tabId) => mod.tabContents?.[tabId] || (!mod.tabContents ? mod.content : tabId === 'basicLearn' ? legacyLessonBody(mod) : '') || '';
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

// quiz: 문항 모드(최종 평가, code-comments-tool.js isCodeCommentQuiz). 문제은행 탭은 문항 속 코드 주석 규칙이 assessment_design에 이미 있다
function reviewSystemPrompt(tabId, quiz = false) {
    const { personas, rules } = CONTEXT_CORE;
    return [
        personas.instructor, '[작성 규칙]', rules.content_design,
        LESSON_STRUCTURED_TABS.includes(tabId) && rules.learning_checklist,
        isQuestionBankTab(tabId) && rules.assessment_design,
        !isQuestionBankTab(tabId) && rules.code_examples,
        quiz && !isQuestionBankTab(tabId) && `- ${QUIZ_CODE_COMMENT_RULE}`,
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
            // 코드 예제 규칙(시스템 글)의 '모든 코드 블록에 주석'과 어긋나지 않게, 있던 코드 블록의 주석은 따로 넣는다고 적는다(mergeFixedSections가 코드가 바뀐 섹션을 버린다)
            '- 이미지 태그(<!-- [IMG: ... ] -->), <img>, <div>, <table>, mermaid는 바꾸지 않고, 코드 블록은 주석을 포함해 한 글자도 바꾸지 않습니다(주석은 따로 넣습니다).',
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

// 고쳐 받은 섹션이 원래 섹션의 코드 블록을 지켰는가: 주석을 세는 코드 블록(code-comments.js)마다 차례대로, 같거나 주석만 더한 블록이 있어야 한다
// (확인은 코드 주석 넣기와 같은 codeCommentVerify다). 새로 더한 코드 블록은 괜찮다. 주석 모듈이 없으면 보지 않는다
function keepsSectionCode(before, after) {
    if (typeof codeCommentBlocks !== 'function' || typeof codeCommentVerify !== 'function') return true;
    const fixed = codeCommentBlocks(after);
    let at = 0;
    return codeCommentBlocks(before).filter(block => !block.skip).every(block => {
        while (at < fixed.length) {
            const next = fixed[at++];
            if (next.raw.join('\n') === block.raw.join('\n') || codeCommentVerify(block, next.lines).ok) return true;
        }
        return false;
    });
}

// 대상 섹션만 바꾼다. 다른 제목으로 돌아온 섹션은 본문이 비슷한 대상과만 짝지어, 새 개요가 지적된 섹션을 덮어쓰지 않게 한다.
// 짝이 없는 섹션을 받을 수 없으면 뒷부분을 나눠 쓴 응답일 수 있으므로 응답 전체를 쓰지 않는다.
// 코드 줄이 바뀐 섹션도 쓰지 않는다(keepsSectionCode: 섹션 고치기는 코드 줄을 고치지 않고, 주석은 확인하며 넣는 코드 주석 단계가 맡는다)
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
        return next !== undefined && keepsSection(section.text, next) && keepsSectionCode(section.text, next) ? { ...section, text: next } : section;
    });
    return added.reduce(insertSection, base).map(section => section.text).join('\n\n');
}

function isBetterFix(before, after) {
    const [a, b] = [lintCounts(before), lintCounts(after)];
    return b.required < a.required || (b.required === a.required && after.length < before.length);
}

// quiz: 문항 모드(최종 평가의 AI 수정 제안). 시스템 글에 문항 속 코드 주석 규칙을 붙인다
async function requestSectionFix({ tabId, md, issues, lockedBlocks = [], onRetry = null, quiz = false }) {
    const plan = pickFixSections(md, issues, lockedBlocks);
    const needsNew = issues.some(issue => issue.missing);
    if (!plan.targets.length && !needsNew) return { text: md, plan };
    const data = await callGemini(TEXT_MODEL, {
        contents: [{ role: 'user', parts: [{ text: buildFixPrompt(md, issues, plan, lockedBlocks) }] }],
        systemInstruction: { parts: [{ text: reviewSystemPrompt(tabId, quiz) }] },
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
    // 주석 지적(codeComment)은 고칠 지적에서도, 나아졌는지 셀 때도 뺀다. 섹션을 통째로 고쳐 쓰면 코드가 바뀔 수 있고 같은 지적이 남아 헛호출이 된다.
    // 셀 때 넣으면 코드를 바꾸며 주석만 단 답도 '나아졌다'로 받는다. 부른 쪽이 바로 뒤 주석 단계에서 코드는 그대로 두고 주석만 넣는다
    const lint = text => lintLessonMarkdown(text, tabId, { codeComments: false });
    for (let round = 1; round <= rounds; round++) {
        if (round > 1 && isStopped()) break;
        const before = lint(current);
        const required = before.filter(issue => issue.sev === 'bad');
        if (!required.length) break;
        const next = await fixRoundText({ tabId, md: current, required, lockedBlocks, onRetry, onStatus: text => onStatus?.(rounds > 1 ? `${text} (${round}/${rounds})` : text) });
        const shrank = minSpokenChars > 0 && next !== null && spokenChars(next) < Math.min(minSpokenChars, spokenChars(current));
        if (next === null || shrank || !isBetterFix(before, lint(next))) break;
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
// reason: 작업 기록에 보일 까닭(분량 채우기는 '분량 채우기 전')
async function commitTabChange(mod, tabId, before, next, note, reason = '고치기 전') {
    if (storedTabMarkdown(mod, tabId) !== before) {
        window.showAlert('수정안을 만드는 동안 탭 내용이 바뀌어 반영하지 않았습니다. 다시 실행해 주세요.');
        return false;
    }
    // 탭이 없는 최종 평가(·옛 차시)는 본문 전체를 고치므로 제목에 탭 이름을 붙이지 않는다
    await archiveContent({ title: mod.tabContents ? `${mod.title} · ${reviewTabLabel(tabId)}` : mod.title, content: before, images: mod.images, tabId, lesson: mod }, reason);
    // 바뀐 것이 코드 블록 주석뿐이면 교수안이 교안과 어긋났다고 하지 않는다(code-comments-tool.js)
    const keyed = typeof gyosuanKeyedTracks === 'function' ? gyosuanKeyedTracks(mod) : [];
    setTabMarkdown(mod, tabId, next);
    if (typeof rekeyCommentedGyosuan === 'function') rekeyCommentedGyosuan(mod, keyed);
    mod.history = reviewHistory(mod, note);
    await saveState();
    // 그 차시(같은 객체)를 보고 있을 때만 다시 그린다. 다른 교과의 같은 번호 차시나 같은 id의 최종 평가 화면에 이 차시를 그리지 않는다
    if (getEditingModule() === mod && currentLessonTab === tabId) renderEditor(mod);
    return true;
}

function fixPlanNote({ locked, deferred }) {
    return [locked ? `고정 섹션 ${locked}개는 고치지 않았습니다.` : '', deferred ? `분량이 많아 섹션 ${deferred}개는 이번 제안에서 뺐습니다. 반영한 뒤 다시 실행합니다.` : ''].filter(Boolean).join(' ');
}

// 지적을 섹션 지적과 주석 지적(codeComment)으로 나눈다. 섹션 지적은 지적이 있는 섹션만 고쳐 받고, 그 글의 주석이 모자란 코드 블록에는 주석만 더한다(code-comments-tool.js).
// 정보 지적(이름표를 몰라 세지 못한 블록)은 고칠 수 없어 보내지 않는다. 최종 평가는 문항 모드로 고친다
async function proposeLessonFix() {
    const { moduleId, tabId } = _review;
    const mod = getEditingModule(moduleId);
    const md = storedTabMarkdown(mod, tabId);
    const issues = lintLessonMarkdown(md, tabId, lessonLintContext(mod, tabId));
    const sectionIssues = issues.filter(issue => !issue.codeComment && issue.sev !== 'info');
    const lockedBlocks = lockedSectionBlocks(mod, tabId);
    const canComment = typeof addGeneratedCodeComments === 'function';
    const quiz = typeof isCodeCommentQuiz === 'function' ? isCodeCommentQuiz(mod, tabId) : isQuestionBankTab(tabId);
    setReviewBusy(true);
    try {
        const { text, plan } = sectionIssues.length
            ? await requestSectionFix({ tabId, md, issues: sectionIssues, lockedBlocks, quiz })
            : { text: md, plan: { targets: [], locked: 0, deferred: 0 } };
        const commented = canComment
            ? await addGeneratedCodeComments({ md: text, tabId, quiz, lockedBlocks, notify: false })
            : { md: text, run: null, held: 0 };
        // 섹션 지적이 모두 고정 섹션에 있거나, 주석이 모자란 블록이 모두 고정 섹션에 있어(부르지 않았다) 고칠 곳이 없다
        const lockedSections = sectionIssues.length > 0 && !plan.targets.length && !sectionIssues.some(issue => issue.missing);
        const noComments = !sectionIssues.length && !commented.run; // 섹션 지적도, 보낸 주석 블록도 없다
        if (commented.md === md && (lockedSections || (noComments && commented.held > 0))) return window.showAlert('고칠 수 있는 섹션이 없습니다. 지적된 섹션이 모두 고정되어 있습니다.');
        if (commented.md === md && noComments) {
            const unknown = issues.some(issue => issue.sev === 'info') ? ' 이름표를 몰라 세지 못한 코드 블록은 원문에서 언어 이름을 적어 주세요.' : '';
            return window.showAlert(`고칠 수 있는 지적이 없습니다.${unknown}`);
        }
        if (commented.md === md && commented.run && !sectionIssues.length) return window.showAlert('주석을 넣지 못했습니다. AI 답이 코드를 바꿔 버렸거나 답을 받지 못했습니다. 잠시 뒤 다시 눌러 보세요.');
        // 주석 호출이 없었어도 고정 섹션에 남긴 블록은 적는다(반영한 뒤에도 그 필수 지적이 남는 까닭)
        const run = commented.run || (commented.held ? { fixed: [], remaining: 0, held: commented.held } : null);
        const note = [fixPlanNote(plan), typeof commentRunNote === 'function' ? commentRunNote(run) : ''].filter(Boolean).join(' ');
        const next = await previewAiChange(md, commented.md, { title: 'AI 수정 제안', tabId, note });
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

// 학습 탭(기본학습·심화학습)은 낭독 분량도 보인다(탭 위 표시와 같은 저장 글로 센다)
function reviewVolumeStat(mod, tabId, md) {
    if (!fillsLearnVolume(mod, tabId) || typeof readAloudMinutes !== 'function') return '';
    return ` · 낭독 약 ${readAloudMinutes(storedTabMarkdown(mod, tabId) || md)}분(목표 ${learnTargetMinutes(mod, tabId)}분)`;
}

// 실습 탭은 실습 시간을 보인다(차시 값 → 과정 기본값 → 기본 90~120분). 정한 시간이 있으면 ## 제목 (⏱ N분) 합계와 견주고 10%보다 벗어나면 알린다(lesson-lint.js)
function reviewPracticeStat(mod, tabId, md) {
    if (!mod || mod.id === 'mainQuest' || !practiceKeyOf(tabId)) return '';
    const { minutes, from } = lessonPracticeTime(mod, tabId);
    if (!minutes) return '<p class="text-xs text-textMuted">실습 시간: 정하지 않음(기본 90~120분)</p>';
    const check = practiceTimeCheck(md, minutes);
    const sum = check.labelled ? `(⏱) 합계 ${check.sum}분` : '(⏱) 시간 표시 없음';
    const note = check.ok ? '' : check.labelled ? ' · 정한 시간과 10% 넘게 차이 납니다. ## 제목의 시간을 확인해 주세요.' : ' · ## 제목마다 (⏱ N분)을 적어 주세요.';
    return `<p class="text-xs ${check.ok ? 'text-textMuted' : 'text-amber-300'}">실습 시간 ${minutes}분${from === 'course' ? '(과정 기본값)' : ''} · ${sum}${note}</p>`;
}

// 갈래를 나누기 전에 만든 학습이해도는 예전 번호로 검사한다고 알린다(course-qbank.js qbankLegacyNote)
function reviewLegacyBankNote(mod, tabId) {
    if (!mod || !isQuestionBankTab(tabId) || typeof qbankLegacyNote !== 'function') return '';
    const note = qbankLegacyNote(mod, tabTrack(tabId).id);
    return note ? `<p class="text-xs text-amber-300">${escapeHtml(note)}</p>` : '';
}

// 정보(info: 이름표를 몰라 주석을 세지 못한 코드 블록)는 고칠 지적이 아니라 권장과 나눠 맨 아래에 보인다
const fixableIssues = issues => issues.filter(issue => issue.sev !== 'info');

function reviewIssuesHtml(issues, tabId, md, mod = null) {
    const stats = LESSON_STRUCTURED_TABS.includes(tabId) ? lessonStructureStats(md) : null;
    return `
        ${stats ? `<p class="text-xs text-textMuted">학습 목표 ${stats.objectives}개 · 내용 섹션 ${stats.sections}개 · 체크리스트 ${stats.checklist}개${reviewVolumeStat(mod, tabId, md)}</p>` : ''}
        ${reviewPracticeStat(mod, tabId, md)}
        ${reviewLegacyBankNote(mod, tabId)}
        ${fixableIssues(issues).length ? '' : '<p class="text-xs text-emerald-300">콘텐츠 업무 설계 규칙에 어긋난 곳이 없습니다.</p>'}
        ${reviewIssueGroup('필수', 'text-rose-300', issues.filter(issue => issue.sev === 'bad'))}
        ${reviewIssueGroup('권장', 'text-amber-300', issues.filter(issue => issue.sev !== 'bad' && issue.sev !== 'info'))}
        ${reviewIssueGroup('정보', 'text-sky-300', issues.filter(issue => issue.sev === 'info'))}`;
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
    const questionRules = isQuestionBankTab(tabId) ? `<h4 class="font-bold text-textLight mt-2">문항</h4><ul class="space-y-1">${QBANK_RULE_LIST.map(rule => `<li>${escapeHtml(rule)}</li>`).join('')}</ul>` : '';
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
                <button data-review-action="fix" ${fixableIssues(issues).length && !busy ? '' : 'disabled'} class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover disabled:opacity-50" title="지적이 있는 섹션만 고치고 주석이 모자란 코드 블록에는 주석만 더한 수정안을 미리 본 뒤 반영합니다">${fixLabel}</button>
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
    window.noteCodeCommentGaps?.(mod); // 주석이 모자란 코드 블록이 있으면 차시마다 한 번 알린다(code-comments-tool.js). 지금 탭이 비어도 다른 탭을 본다
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
