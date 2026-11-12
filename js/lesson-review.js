// lesson-review.js - 컨벤션 검수 패널, AI 수정 제안, 생성 직후 자동 수정, 수동 검수 기록
// develocket-slide(assets/course-textbook.js, course-ai-tb.js @3a7303f)의 검수 카드, fixTextbook, repairOnce를 마크다운 탭에 맞게 옮겼다.
// 원본의 교재는 짧아 통째로 고치지만 Teacher의 탭은 응답 한도를 넘을 수 있으므로, 지적이 있는 ## 섹션만 보내고 받은 섹션만 바꿔 끼운다.
// 코드 블록을 자리 표시 줄로 바꿔 지키고, 큰 섹션은 나눠 지적이 있는 곳을 차례로 고쳐 받는 실행은 lesson-fix-run.js에 있다(requestSectionFix가 부른다).

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

// 지적이 있는 섹션(rows), 그 가운데 고정하지 않은 섹션(open), 필수 지적이 많은 차례로 세운 고칠 섹션(ordered)
function fixSectionRows(md, issues, lockedBlocks = []) {
    const lockedKeys = new Set(lockedBlocks.map(block => lockTitleKey(block.title)));
    const rows = mdSections(md)
        .map((section, index) => ({ ...section, index, hits: issues.filter(issue => issueInSection(issue, section)) }))
        .filter(row => row.hits.length);
    const open = rows.filter(row => !lockedKeys.has(lockTitleKey(row.title)));
    return { rows, open, ordered: [...open].sort((a, b) => lintCounts(b.hits).required - lintCounts(a.hits).required) };
}

// 고정 섹션은 대상에서 빼고, 분량이 넘으면 필수 지적이 있는 섹션부터 고른다. 결과는 문서 순서다.
// 한 호출에 담을 첫 묶음이다. 남은 섹션과 상한보다 큰 섹션은 lesson-fix-run.js(planFixRun)가 같은 실행에서 이어 고친다
function pickFixSections(md, issues, lockedBlocks = []) {
    const { rows, open, ordered } = fixSectionRows(md, issues, lockedBlocks);
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
// 문제은행 문항의 AI 교차 검수 지적(lesson-lint.js lintQuestion). 문항 모드에서는 이 지적이 가리키는 주석(정답을 드러내는 주석)을 고쳐도 된다
const isReviewIssue = issue => String(issue?.msg || '').startsWith('AI 교차 검수');
const LESSON_LABEL_ISSUE = '코드 블록에 언어를 적습니다.';
const LESSON_UNCLOSED_ISSUE = '닫히지 않은 코드 블록이 있습니다.';

// 섹션 고치기 지시의 코드 블록 문장(scoped: 이번에 고칠 지적). 코드 줄은 언제나 그대로 두고, 고칠 지적이 요구하는 곳만 고쳐도 된다고 더한다
// (mergeSectionFix의 sectionCodeLeeway와 같은 조건): 문항 모드의 교차 검수 지적은 정답을 드러내는 주석 줄, 이름표 지적은 여는 펜스 줄의 언어 이름, 닫는 지적은 닫는 펜스 줄
function fixCodeRule(scoped, quiz) {
    const review = quiz && scoped.some(isReviewIssue);
    const labels = scoped.some(issue => issue.msg === LESSON_LABEL_ISSUE);
    const closing = scoped.some(issue => issue.msg === LESSON_UNCLOSED_ISSUE);
    const keep = review
        ? '코드 블록은 코드 줄을 한 글자도 바꾸지 않습니다. 정답·출력 결과·고칠 곳을 드러내는 주석 줄은 고쳐도 됩니다(다른 주석은 그대로 둡니다).'
        : `코드 블록${labels || closing ? '의 코드 줄' : ''}은 주석을 포함해 한 글자도 바꾸지 않습니다(주석은 따로 넣습니다).`;
    return [
        keep,
        labels ? '이름표가 없는 코드 블록은 여는 펜스 줄에 언어 이름만 적습니다.' : '',
        closing ? '닫히지 않은 코드 블록은 코드가 끝나는 곳에 닫는 펜스만 넣습니다.' : ''
    ].filter(Boolean).join(' ');
}

// 코드 블록을 자리 표시 줄로 바꿔 보낼 때 붙이는 지시(lesson-fix-run.js shieldFixCode). AI는 코드를 보지 못하고, 받은 답의 자리 표시 줄을 원래 블록으로 되돌린다
const REVIEW_HOLDER_RULE = '- 코드 블록은 [[CODE-BLOCK-…]] 꼴의 자리 표시 줄로 바꿔 두었습니다. 자리 표시 줄은 한 글자도 바꾸지 말고 있던 자리에 한 줄씩 그대로 두며, 지우거나 되풀이하거나 다른 글과 한 줄에 쓰지 않습니다. 자리 표시가 가리키는 코드는 다시 쓰지 않습니다.';

// quiz: 문항 모드(code-comments-tool.js isCodeCommentQuiz). 교차 검수 지적을 고칠 때는 코드 줄만 지키고 정답을 드러내는 주석 줄은 고쳐도 된다고 적는다(mergeSectionFix가 같은 기준으로 받는다)
// 대상에 자리 표시로 바꾼 글(target.sent·target.codes)이 있으면 그 글을 보내고 자리 표시를 지키라고 적는다.
// part: 큰 섹션에서 떼어 낸 조각 하나를 고친다({ title: 그 섹션의 제목 }) · again: 자리 표시를 지키지 않은 답을 다시 받을 때 적는 까닭(lesson-fix-run.js)
function buildFixPrompt(md, issues, plan, lockedBlocks = [], { quiz = false, part = null, again = '' } = {}) {
    const sections = mdSections(md);
    const targetIndexes = plan.targets.map(target => target.index);
    const reference = sections.filter((section, index) => !targetIndexes.includes(index) && REVIEW_REFERENCE_TITLE.test(section.title));
    const scoped = issues.filter(issue => issue.missing || plan.targets.some(target => target.hits.includes(issue)));
    const codeRule = fixCodeRule(scoped, quiz);
    const label = part ? '고칠 부분' : '고칠 섹션';
    const keys = plan.targets.flatMap(target => (target.codes || []).map(code => code.key));
    return [
        [`[작업] 아래 교안이 컨벤션 검수에서 지적을 받았습니다. [${label}]을 지적이 모두 해결되도록 고칩니다.`,
            '- 지적과 관계없는 내용과 표현은 유지하고 분량을 줄이지 않습니다.',
            part
                ? `- [고칠 부분]은 ${part.title ? `'## ${part.title}' 섹션` : '교안 본문'}에서 떼어 낸 한 부분입니다. 받은 부분만 고쳐 그 부분만 출력하고, 받지 않은 ## 제목이나 다른 부분을 더하지 않습니다.`
                : '- 고칠 섹션의 ## 제목을 그대로 쓰고, 고칠 섹션만 출력합니다. 다른 섹션은 출력하지 않습니다.',
            // 코드 예제 규칙(시스템 글)의 '모든 코드 블록에 주석'과 어긋나지 않게, 있던 코드 블록의 주석은 따로 넣는다고 적는다(mergeSectionFix가 코드가 바뀐 섹션을 버린다)
            `- 이미지 태그(<!-- [IMG: ... ] -->), <img>, <div>, <table>, mermaid는 바꾸지 않고, ${codeRule}`,
            keys.length ? REVIEW_HOLDER_RULE : '',
            issues.some(issue => issue.missing) ? '- 없는 섹션을 새로 써야 하면 ## 제목과 함께 출력합니다.' : '',
            lockedBlocks.length ? `- 고정 섹션(${lockedBlocks.map(block => block.title).join(', ')})은 출력하지 않습니다.` : ''
        ].filter(Boolean).join('\n'),
        again ? `[다시 요청]\n앞선 답은 쓰지 못했습니다. ${again} 자리 표시 줄(${keys.join(', ')})을 한 글자도 바꾸지 말고 원래 있던 자리에 한 줄씩 그대로 둔 채, 다시 고쳐 출력합니다.` : '',
        `[문서 구조]\n${sections.filter(section => section.title).map(section => `- ${section.title}`).join('\n') || '(## 제목 없음)'}`,
        reference.length ? `[참고 섹션 — 고치지 않습니다]\n${reference.map(section => section.text).join('\n\n')}` : '',
        `[지적된 문제]\n${scoped.map(issueLine).join('\n')}`,
        plan.targets.length ? `[${label}]\n${plan.targets.map(target => target.sent ?? target.text).join('\n\n')}` : ''
    ].filter(Boolean).join('\n\n');
}

function cleanFixResponse(text) {
    const body = String(text || '').replace(/\r\n/g, '\n').trim();
    const unwrapped = (body.match(/^```\w*\n([\s\S]*)\n```$/) || [])[1] ?? body;
    const cleaned = unwrapped.replace(REVIEW_MARKERS, '').trim();
    return typeof sanitizeMarkdownContent === 'function' ? sanitizeMarkdownContent(cleaned) : cleaned;
}

// AI 답(data)을 섹션 고치기에 쓸 글로 다듬는다(data.js extractText의 정리 규칙을 거친 뒤 감싼 펜스·이어쓰기 표시를 뗀다)
const fixAnswerText = data => cleanFixResponse(extractText(data));
// 보낸 글이 그대로 돌아왔을 때의 꼴(답과 같은 정리 규칙을 거친 글). 고치지 않고 돌려준 답을 가리고, 빠진 자리 표시의 앞 줄을 찾을 때 견준다
const fixTextShape = text => fixAnswerText({ candidates: [{ content: { parts: [{ text: String(text ?? '') }] } }] });

// 새 섹션의 자리: 첫머리는 개요 → 학습 정보 → 학습 목표 차례다. 개요는 맨 앞, 학습 정보는 개요 다음(없으면 맨 앞),
// 학습 목표는 학습 정보나 개요 다음(둘 다 없으면 맨 앞), 체크리스트는 맨 끝, 나머지는 체크리스트 앞.
// 예전 차례(학습 목표 → 개요)의 탭에 빠진 개요를 넣어도 맨 앞에 둔다(새 차례가 된다)
function newSectionIndex(sections, title) {
    const start = sections[0] && !sections[0].title ? 1 : 0;
    const after = test => {
        const at = sections.findIndex(section => test(section.title));
        return at < 0 ? -1 : at + 1;
    };
    const checklist = sections.findIndex(section => /체크리스트/.test(section.title));
    if (LESSON_OVERVIEW_TITLE.test(title)) return start;
    if (LESSON_INFO_TITLE.test(title)) return Math.max(start, after(text => LESSON_OVERVIEW_TITLE.test(text)));
    if (/학습\s*목표/.test(title)) return Math.max(start, after(text => LESSON_INFO_TITLE.test(text)), after(text => LESSON_OVERVIEW_TITLE.test(text)));
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

// 고쳐 받은 블록(next)이 원래 블록(old)을 지켰는가(code-comments.js codeCommentBlocks 결과). 펜스 글자·길이·들여쓰기가 같고, 닫혔던 블록은 닫혀 있다.
// 주석을 세는 블록은 언어가 같고 같은 코드이거나 주석만 더한 코드여야 한다(codeCommentVerify가 다시 짠 코드가 답 그대로일 때. 빈 줄을 더하거나 줄 끝 공백만 바꿔도 받지 않는다).
// comments: 주석만 고치거나 지운 코드도 받는다(문항의 교차 검수 지적을 고칠 때, codeCommentSameCode).
// 세지 않는 블록(실행 결과·json·mermaid·이름표를 모르는 블록·~~~ 블록)은 이름표와 줄이 같아야 한다.
// labels: 이름표가 없던 블록에 이름표만 붙여도 된다(이름표를 적는 지적) · closing: 닫히지 않았던 블록을 원래 줄의 앞부분까지로 닫아도 된다(닫는 지적)
function keptSectionBlock(old, next, { comments = false, labels = false, closing = false } = {}) {
    const sameRaw = next.raw.join('\n') === old.raw.join('\n');
    const sameLabel = next.label.toLowerCase() === old.label.toLowerCase() || (labels && !old.label);
    if (next.fence !== old.fence || next.indent !== old.indent) return false;
    if (old.skip === 'unclosed') {
        if (next.skip === 'unclosed') return sameRaw && sameLabel;
        return closing && sameLabel && next.raw.length <= old.raw.length && next.raw.every((line, k) => line === old.raw[k]);
    }
    if (next.skip === 'unclosed') return false;
    if (old.skip === 'nolabel') return sameRaw && (labels || next.skip === 'nolabel');
    if (old.skip) return sameRaw && sameLabel && next.skip === old.skip;
    if (next.lang !== old.lang) return false;
    if (sameRaw) return true;
    const verified = codeCommentVerify(old, next.lines);
    if (verified.ok && verified.code === next.lines.join('\n')) return true;
    return comments && typeof codeCommentSameCode === 'function' && codeCommentSameCode(old, next.lines);
}

// 고쳐 받은 섹션이 원래 섹션의 코드 블록을 지켰는가: 원래 블록마다 차례대로 지킨 블록(keptSectionBlock)이 있어야 한다.
// 새로 더한 코드 블록은 괜찮다(그 블록의 주석은 뒤의 코드 주석 단계가 넣는다). 주석 모듈이 없으면 보지 않는다
function keepsSectionCode(before, after, opts = {}) {
    if (typeof codeCommentBlocks !== 'function' || typeof codeCommentVerify !== 'function') return true;
    const fixed = codeCommentBlocks(after);
    let at = 0;
    return codeCommentBlocks(before).every(block => {
        while (at < fixed.length) {
            if (keptSectionBlock(block, fixed[at++], opts)) return true;
        }
        return false;
    });
}

// 섹션의 지적으로 정하는 블록 확인 너그러움(keptSectionBlock). 교차 검수 지적은 문항 모드에서만 주석을 고쳐도 된다
const sectionCodeLeeway = (target, quiz) => ({
    comments: !!quiz && (target.hits || []).some(isReviewIssue),
    labels: (target.hits || []).some(issue => issue.msg === LESSON_LABEL_ISSUE),
    closing: (target.hits || []).some(issue => issue.msg === LESSON_UNCLOSED_ISSUE)
});

// 고쳐 받은 섹션(조각) 글 하나를 받을지 정한다 → { status, text(받을 글), problem }.
// status: applied(받는다) · same(고치지 않고 그대로 돌려준 답, target.shape와 같다) · cut(내용이 줄었거나 소주제·그림이 빠졌다, keepsSection)
//   · code(코드 블록을 바꿨다, keepsSectionCode: 섹션 고치기는 코드 줄을 고치지 않고, 주석은 확인하며 넣는 코드 주석 단계가 맡는다)
//   · holder(코드 블록 자리 표시가 빠졌거나 겹쳤거나 바뀌었다. problem이 그 까닭이고 lesson-fix-run.js가 한 번 더 받는다)
// 자리 표시로 보낸 대상(target.codes)은 원래 블록을 되돌린 글로 본다. 자리 표시를 빠뜨렸어도 코드 블록을 스스로 그대로 적어 지킨 답은 받는다.
// 다른 섹션의 자리 표시가 섞여 든 글(target.token: 이번 실행의 자리 표시 이름)도 받지 않는다. 자리 표시 글끼리도 견주어(target.sent) 코드만 남기고 글을 지운 답을 막는다
function settleFixText(target, answer, quiz) {
    const codes = target.codes || [];
    const state = codes.length ? fixCodeState(answer, codes, target.token) : null;
    const text = codes.length ? restoreFixCode(answer, codes) : answer;
    const stray = !!target.token && fixCodeLeftover(text, target.text, target.token);
    const keepsCode = keepsSectionCode(target.text, text, sectionCodeLeeway(target, quiz)) && !opensCodeFence(target.text, text);
    const wrote = !!state && state.problem === 'missing' && !stray && keepsCode;
    if (state && !state.ok && !wrote) return { status: 'holder', problem: state };
    if (stray) return { status: 'holder', problem: { ok: false, problem: 'changed', keys: [] } };
    if (typeof target.shape === 'string' && answer.trim() === target.shape.trim()) return { status: 'same' };
    if (!keepsSection(target.text, text) || (codes.length > 0 && !keepsSection(target.sent, answer))) return { status: 'cut' };
    return keepsCode ? { status: 'applied', text } : { status: 'code' };
}

// 고친 글이 닫지 않은 코드 블록을 새로 열었는가(뒤에 오는 글이 코드 안으로 들어간다). 원래 닫히지 않았던 글은 keptSectionBlock이 본다
function opensCodeFence(before, after) {
    if (typeof codeCommentBlocks !== 'function') return false;
    const open = text => codeCommentBlocks(text).some(block => block.skip === 'unclosed');
    return open(after) && !open(before);
}

// 받기로 한 결과(applied)의 글을 문서(doc: mdSections 결과)의 그 섹션에 넣는다
function applyFixOutcomes(doc, outcomes) {
    const texts = new Map(outcomes.filter(outcome => outcome.status === 'applied').map(outcome => [outcome.target.index, outcome.text]));
    return doc.map((section, index) => (texts.has(index) ? { ...section, text: texts.get(index) } : section));
}

// 답(fixedMd)의 섹션을 대상과 짝지어, 받을 섹션만 바꾼 문서(doc)와 새 섹션(added), 대상마다의 결과(outcomes: { target, status, text, answer(짝지은 답), problem })를 돌려준다.
// 다른 제목으로 돌아온 섹션은 본문이 비슷한 대상과만 짝지어, 새 개요가 지적된 섹션을 덮어쓰지 않게 한다.
// 짝이 없는 섹션을 받을 수 없으면 뒷부분을 나눠 쓴 응답일 수 있으므로 응답 전체를 쓰지 않는다(status 'split'). 답에 없는 대상은 'absent'다
function mergeFixSections(doc, fixedMd, targets, allowNew = false, { quiz = false } = {}) {
    const docKeys = new Set(doc.map(section => lockTitleKey(section.title)));
    const open = [...targets];
    const extras = [];
    const answers = new Map();
    const take = (at, text) => answers.set(open.splice(at, 1)[0], text);
    mdSections(fixedMd).filter(section => section.text.trim() && (section.title || targets.some(target => !target.title))).forEach(section => {
        const at = open.findIndex(target => lockTitleKey(target.title) === lockTitleKey(section.title));
        if (at >= 0) take(at, section.text);
        else if (!docKeys.has(lockTitleKey(section.title))) extras.push(section);
    });
    const added = [];
    extras.forEach(section => {
        const at = open.findIndex(target => isRenamedSection(target.sent ?? target.text, section.text));
        if (at >= 0) take(at, section.text);
        else added.push(section);
    });
    if (added.length && !allowNew) return { doc, added: [], outcomes: targets.map(target => ({ target, status: 'split' })) };
    const outcomes = targets.map(target => (answers.has(target) ? { target, answer: answers.get(target), ...settleFixText(target, answers.get(target), quiz) } : { target, status: 'absent' }));
    return { doc: applyFixOutcomes(doc, outcomes), added, outcomes };
}

// 지적 자리 이름(안내 글에 쓴다): 그 섹션(조각)의 지적이 가리키는 자리, 없으면 섹션 제목
const fixIssuePlaces = target => [...new Set((target.hits || []).map(issue => issue.where || target.title || '본문'))];

// 대상 섹션만 바꾼 글(mergeFixSections). 결과 { md, dropped: [{ title, where }], outcomes } — dropped는 코드 블록을 바꿔 쓰지 않은 대상 섹션(where는 그 섹션의 지적 자리). quiz: 문항 모드
function mergeSectionFix(md, fixedMd, targets, allowNew = false, { quiz = false } = {}) {
    const { doc, added, outcomes } = mergeFixSections(mdSections(md), fixedMd, targets, allowNew, { quiz });
    if (outcomes.some(outcome => outcome.status === 'split')) return { md, dropped: [], outcomes };
    const dropped = outcomes.filter(outcome => outcome.status === 'code').map(outcome => ({ title: outcome.target.title, where: fixIssuePlaces(outcome.target) }));
    return { md: added.reduce(insertSection, doc).map(section => section.text).join('\n\n'), dropped, outcomes };
}

// 병합한 글만 돌려준다(mergeSectionFix의 md)
function mergeFixedSections(md, fixedMd, targets, allowNew = false, opts = {}) {
    return mergeSectionFix(md, fixedMd, targets, allowNew, opts).md;
}

// 코드 블록을 바꿔 반영하지 않은 섹션 안내(미리보기 안내 글). 없으면 ''
function droppedSectionsNote(dropped) {
    if (!Array.isArray(dropped) || !dropped.length) return '';
    const names = [...new Set(dropped.flatMap(item => item.where))].join(', ');
    return `코드 블록을 바꾼 답이라 섹션 ${dropped.length}개(${names})는 반영하지 않았습니다. 코드 블록 안을 고칠 지적은 원문에서 고칩니다.`;
}

function isBetterFix(before, after) {
    const [a, b] = [lintCounts(before), lintCounts(after)];
    return b.required < a.required || (b.required === a.required && after.length < before.length);
}

// 섹션 고치기 호출 하나 → 다듬은 답 글(fixAnswerText). 출력 한도에서 잘린 답은 쓰지 않는다
async function askSectionFix({ tabId, quiz = false, onRetry = null }, prompt) {
    const data = await callGemini(TEXT_MODEL, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: reviewSystemPrompt(tabId, quiz) }] },
        generationConfig: { maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS }
    }, onRetry);
    if (data?.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new Error('응답이 출력 한도에서 잘렸습니다.');
    return fixAnswerText(data);
}

// quiz: 문항 모드(문제은행 탭·최종 평가의 AI 수정 제안). 최종 평가의 시스템 글에 문항 속 코드 주석 규칙을 붙이고, 교차 검수 지적은 주석을 고친 답도 받는다.
// 결과 { text, plan, dropped(코드 블록을 바꿔 반영하지 않은 섹션), report(고친 곳과 고치지 못한 까닭, lesson-fix-run.js가 있을 때) }
// lesson-fix-run.js가 있으면 코드 블록을 자리 표시로 지키고 큰 섹션은 나눠, 지적이 있는 곳을 차례로 고친다(runSectionFix. run: onStatus·isStopped·maxCalls·maxUnits).
// 그 파일이 없으면(옛 화면이 캐시에 남은 때) 첫 묶음(pickFixSections)만 한 번에 고친다
async function requestSectionFix({ tabId, md, issues, lockedBlocks = [], onRetry = null, quiz = false, ...run }) {
    if (typeof runSectionFix === 'function') return runSectionFix({ tabId, md, issues, lockedBlocks, onRetry, quiz, ...run });
    const plan = pickFixSections(md, issues, lockedBlocks);
    const needsNew = issues.some(issue => issue.missing);
    if (!plan.targets.length && !needsNew) return { text: md, plan, dropped: [] };
    const answer = await askSectionFix({ tabId, quiz, onRetry }, buildFixPrompt(md, issues, plan, lockedBlocks, { quiz }));
    const merged = mergeSectionFix(md, answer, plan.targets, needsNew, { quiz });
    return { text: restoreLockedSections(merged.md, lockedBlocks), plan, dropped: merged.dropped };
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
// 한 회차에 한 곳(첫 묶음이나 큰 섹션의 조각 하나)만 고쳐 호출 수는 지금까지와 같다. 코드 블록 자리 표시가 어긋난 답만 한 번 더 받는다(maxCalls 2)
async function fixRoundText({ tabId, md, required, lockedBlocks, onRetry, onStatus }) {
    try {
        onStatus(`🔍 컨벤션 필수 지적 ${required.length}건을 고치고 있습니다...`);
        const again = step => { if (step.again) onStatus('🔍 코드 블록 자리를 지키지 않은 답이라 한 번 더 받고 있습니다...'); };
        return (await requestSectionFix({ tabId, md, issues: required, lockedBlocks, onRetry, maxUnits: 1, maxCalls: 2, onStatus: again })).text;
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
    // 바뀐 것이 코드 블록 주석뿐이면 교수안이 교안과 어긋났다고 하지 않는다(tabs.js setTabMarkdownKeyed)
    setTabMarkdownKeyed(mod, tabId, next);
    mod.history = reviewHistory(mod, note);
    await saveState();
    // 그 차시(같은 객체)를 보고 있을 때만 다시 그린다. 다른 교과의 같은 번호 차시나 같은 id의 최종 평가 화면에 이 차시를 그리지 않는다
    if (getEditingModule() === mod && currentLessonTab === tabId) renderEditor(mod);
    return true;
}

// 고정 섹션과 분량 때문에 뺀 섹션 안내. deferred는 lesson-fix-run.js 없이 첫 묶음만 고칠 때만 생긴다(그 파일이 있으면 큰 섹션도 나눠 고친다)
function fixPlanNote({ locked, deferred }) {
    return [locked ? `고정 섹션 ${locked}개는 고치지 않았습니다.` : '', deferred ? `분량이 많아 섹션 ${deferred}개는 이번 제안에서 뺐습니다. 반영한 뒤 다시 실행합니다.` : ''].filter(Boolean).join(' ');
}

// 차례로 고치는 동안 검수 창에 보일 글(step: lesson-fix-run.js runSectionFix가 호출마다 알린다). 호출 하나로 끝나면 단추 글만 보인다
function reviewFixStatus({ no, total, again }) {
    if (again) return `코드 블록 자리를 지키지 않은 답이라 다시 받고 있습니다... (${no}/${total})`;
    return total > 1 ? `지적이 있는 곳을 차례로 고치고 있습니다... (${no}/${total})` : '';
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
    const run = _review.run;
    // 중지를 눌렀거나 검수 창을 닫았으면(다시 열어도) 받고 있는 답까지만 고치고 미리 보인다
    const isStopped = () => !_review || _review.run !== run || !!_review.stop;
    try {
        const { text, plan, dropped = [], report = null } = sectionIssues.length
            ? await requestSectionFix({ tabId, md, issues: sectionIssues, lockedBlocks, quiz, isStopped, onStatus: step => setReviewStatus(reviewFixStatus(step)) })
            : { text: md, plan: { targets: [], locked: 0, deferred: 0 } };
        const commented = canComment
            ? await addGeneratedCodeComments({ md: text, tabId, quiz, lockedBlocks, notify: false, isStopped, onStatus: setReviewStatus })
            : { md: text, run: null, held: 0 };
        // 고친 것과 고치지 못한 까닭·다음에 할 일(lesson-fix-run.js fixRunNote). 그 파일이 없으면 고정 섹션과 코드 블록을 바꿔 버린 섹션만 적는다
        const fixNote = report && typeof fixRunNote === 'function' ? fixRunNote(plan, report) : [fixPlanNote(plan), droppedSectionsNote(dropped)].filter(Boolean).join(' ');
        // 섹션 지적이 모두 고정 섹션에 있거나, 주석이 모자란 블록이 모두 고정 섹션에 있어(부르지 않았다) 고칠 곳이 없다
        const noTargets = sectionIssues.length > 0 && !plan.targets.length && !sectionIssues.some(issue => issue.missing);
        const lockedSections = noTargets && (plan.locked > 0 || !fixNote);
        const noComments = !sectionIssues.length && !commented.run; // 섹션 지적도, 보낸 주석 블록도 없다
        if (commented.md === md && (lockedSections || (noComments && commented.held > 0))) return window.showAlert('고칠 수 있는 섹션이 없습니다. 지적된 섹션이 모두 고정되어 있습니다.');
        if (commented.md === md && noTargets && !commented.run) return window.showAlert(fixNote); // 어느 섹션의 지적인지 찾지 못한 지적뿐이다
        if (commented.md === md && noComments) return window.showAlert(`고칠 수 있는 지적이 없습니다.${infoIssueHint(issues)}`);
        if (commented.md === md && commented.run && !sectionIssues.length) return window.showAlert('주석을 넣지 못했습니다. AI 답이 코드를 바꿔 버렸거나 답을 받지 못했습니다. 잠시 뒤 다시 눌러 보세요.');
        // 주석 호출이 없었어도 고정 섹션에 남긴 블록은 적는다(반영한 뒤에도 그 필수 지적이 남는 까닭)
        const run = commented.run || (commented.held ? { fixed: [], remaining: 0, held: commented.held } : null);
        const note = [fixNote, typeof commentRunNote === 'function' ? commentRunNote(run) : ''].filter(Boolean).join(' ');
        // 바뀐 섹션이 하나도 없으면 미리보기의 '바뀐 내용이 없습니다.' 뒤에 까닭을 잇는다
        const unchanged = !alignMdSections(md, commented.md).some(sectionChanged);
        const emptyNote = note ? '위 안내에 적은 까닭으로 반영할 수정안이 없습니다.' : 'AI가 고친 곳이 없습니다. 다시 실행하거나 원문에서 직접 고쳐 주세요.';
        const next = await previewAiChange(md, commented.md, { title: 'AI 수정 제안', tabId, note, ...(unchanged ? { emptyNote } : {}) });
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

// 정보(info: 이름표를 몰라 주석을 세지 못한 코드 블록 · ~~~ 펜스로 쓴 코드 블록)는 고칠 지적이 아니라 권장과 나눠 맨 아래에 보인다
const fixableIssues = issues => issues.filter(issue => issue.sev !== 'info');

// 고칠 지적이 정보뿐일 때 알림에 붙이는 도움말(code-comments.js의 정보 지적)
function infoIssueHint(issues) {
    const info = issues.filter(issue => issue.sev === 'info');
    const isTilde = issue => typeof CODE_COMMENT_TILDE_MSG === 'string' && issue.msg === CODE_COMMENT_TILDE_MSG;
    return [
        info.some(issue => !isTilde(issue)) ? ' 이름표를 몰라 세지 못한 코드 블록은 원문에서 언어 이름을 적어 주세요.' : '',
        info.some(isTilde) ? ' ~~~ 펜스로 쓴 코드 블록은 원문에서 펜스를 ```로 바꿔 주세요.' : ''
    ].join('');
}

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

// busy: 수정안을 만드는 중(진행 글 status와 중지 단추를 보인다. stopping: 중지를 눌러 받고 있는 답을 기다리는 중)
function reviewPanelHtml(mod, tabId, md, busy, { status = '', stopping = false } = {}) {
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
            <div class="p-3 border-t border-white/10 flex items-center justify-end gap-2">
                ${busy ? `<p data-review-status class="flex-1 text-xs text-textMuted">${escapeHtml(status)}</p>` : ''}
                <button data-review-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
                ${busy ? `<button data-review-action="stop" ${stopping ? 'disabled' : ''} class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20 disabled:opacity-50" title="받고 있는 답까지만 고치고 멈춥니다. 고친 데까지 미리 보입니다">중지</button>` : ''}
                <button data-review-action="fix" ${fixableIssues(issues).length && !busy ? '' : 'disabled'} class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover disabled:opacity-50" title="지적이 있는 섹션만 고치고 주석이 모자란 코드 블록에는 주석만 더한 수정안을 미리 본 뒤 반영합니다">${fixLabel}</button>
            </div>
        </div>`;
}

function renderReviewPanel() {
    const overlay = document.getElementById('lesson-review-dialog');
    const mod = _review && getEditingModule(_review.moduleId);
    if (overlay && mod) overlay.innerHTML = reviewPanelHtml(mod, _review.tabId, getActiveTabContent(mod), _review.busy, { status: _review.status, stopping: _review.stop });
}

// 시작하거나 끝날 때 진행 글과 중지 표시를 지운다. 시작할 때마다 실행 표시(run)를 새로 붙인다(창을 닫았다 다시 열면 앞선 실행은 멈춘다)
function setReviewBusy(busy) {
    if (!_review) return;
    _review = { ..._review, busy, status: '', stop: false, ...(busy ? { run: {} } : {}) };
    renderReviewPanel();
}

// 진행 글만 바꾼다(창을 통째로 다시 그리면 긴 탭을 호출마다 다시 검사한다). 중지를 누른 뒤에는 중지 글을 남긴다
function setReviewStatus(text) {
    if (!_review?.busy || _review.stop) return;
    _review = { ..._review, status: text };
    const line = document.getElementById('lesson-review-dialog')?.querySelector?.('[data-review-status]');
    if (line) line.textContent = text;
}

function closeReviewPanel() {
    document.getElementById('lesson-review-dialog')?.remove();
    _review = null;
}

function onReviewClick(event) {
    const action = event.target.dataset?.reviewAction;
    if (action === 'close') closeReviewPanel();
    if (action === 'fix' && _review && !_review.busy) proposeLessonFix();
    if (action === 'stop' && _review?.busy && !_review.stop) {
        _review = { ..._review, stop: true, status: '중지하는 중입니다. 받고 있는 답까지만 고칩니다...' };
        renderReviewPanel();
    }
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
