// lesson-lint.js - 콘텐츠 업무 설계 규칙으로 교안 마크다운을 검사한다
// 금지 표현과 학습 목표 규칙은 develocket-slide(assets/course-rules.js @3a7303f)의 검수 기준을 따른다.

const LESSON_LINT_MAX_SHOWN = 12;
const LESSON_LINT_RULES = [
    { re: /여러분|당신|우리(?=[는가를의도와])/g, msg: '학습자를 호칭하지 않습니다.' },
    { re: /앞에서|앞서|이전 (?:시간|모듈|차시|장)|지난 시간|다음 (?:시간|모듈|차시|장)에/g, msg: '다른 차시를 지칭하지 않습니다.' },
    { re: /경우에 따라 다릅니다|경우에 따라 달라|상황에 맞게/g, msg: '판단 기준을 명시합니다.' },
    { re: /매우|아주|굉장히/g, msg: '정도는 수치로 씁니다.' },
    { re: /당연히|물론|쉽게/g, msg: '학습자에게 당연하지 않은 표현입니다.' },
    { re: /20\d\d\.\d+\.\d+|버전\s*\d/g, msg: '버전 의존 정보를 본문에 쓰지 않습니다.' },
    { re: /강사는|교수자는|시연(?:한다|합니다)|수업에서는/g, msg: '수업 진행은 교수안의 몫입니다.' }
];
const LESSON_LINT_BANNED_OBJECTIVE = /이해한다|이해합니다|이해할 수|안다(?=[.\s]|$)|알 수 있|익힌다|익힙니다|익힐 수/;

// 코드·주석·HTML 태그·표 구분선은 검사하지 않는다
function lessonLintText(md) {
    return String(md || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ');
}

function lessonLintObjectives(md) {
    const section = String(md || '').match(/^##\s*학습\s*목표[^\n]*\n([\s\S]*?)(?=^#{1,2}\s|(?![\s\S]))/m);
    if (!section) return [];
    return section[1].split('\n')
        .map(line => (line.match(/^\s*[-*]\s+(.*)$/) || [])[1])
        .filter(Boolean)
        .map(text => text.replace(/\*\*/g, '').trim());
}

function lintLessonMarkdown(md) {
    const issues = [];
    lessonLintObjectives(md).forEach(goal => {
        if (!/수 (?:있다|있습니다)\.?$/.test(goal)) issues.push({ msg: '학습 목표는 "~할 수 있습니다"로 끝냅니다.', snip: goal });
        else if (LESSON_LINT_BANNED_OBJECTIVE.test(goal)) issues.push({ msg: '학습 목표는 관찰 가능한 행동으로 씁니다.', snip: goal });
    });
    const text = lessonLintText(md);
    LESSON_LINT_RULES.forEach(rule => {
        const seen = new Set();
        for (const match of text.matchAll(rule.re)) {
            if (seen.has(match[0])) continue;
            seen.add(match[0]);
            const snip = text.slice(Math.max(0, match.index - 12), match.index + match[0].length + 10).replace(/\s+/g, ' ').trim();
            issues.push({ msg: rule.msg, snip });
        }
    });
    return issues;
}

window.runConventionCheck = function (moduleId) {
    const mod = getEditingModule(moduleId);
    const md = mod && getActiveTabContent(mod);
    if (!md || !md.trim()) return window.showAlert('검사할 내용이 없습니다.');
    const issues = lintLessonMarkdown(md);
    if (!issues.length) return window.showAlert('✅ 컨벤션 검수 통과\n콘텐츠 업무 설계 규칙에 어긋난 곳이 없습니다.');
    const shown = issues.slice(0, LESSON_LINT_MAX_SHOWN).map(issue => `• ${issue.msg}\n  …${issue.snip}…`);
    const rest = issues.length - shown.length;
    window.showAlert(`⚠️ 컨벤션 검수 ${issues.length}건\n\n${shown.join('\n')}${rest > 0 ? `\n\n외 ${rest}건` : ''}`);
};
