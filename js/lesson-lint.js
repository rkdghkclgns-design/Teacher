// lesson-lint.js - 콘텐츠 업무 설계 규칙으로 교안 마크다운을 검사한다
// 금지 표현, 학습 목표, 체크리스트, 문항 규칙은 develocket-slide(assets/course-rules.js @3a7303f)의 검수 기준을 따른다.

const LESSON_LINT_MAX_SHOWN = 12;
const LESSON_LINT_MAX_OBJECTIVES = 3;
const LESSON_LINT_MIN_OBJECTIVE_LENGTH = 18;
const LESSON_LINT_MIN_CHOICES = 4;
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
const LESSON_LINT_PLAIN_ENDING = /([가-힣])다\.(?=\s|$)/g;
const LESSON_LINT_QUESTION_LABEL = /학습\s*목표\s*\d+\s*·\s*밴드\s*L[1-3]/;
const LESSON_LINT_MULTI_ANSWER = /복수\s*정답|모두 고르/;
const LESSON_LINT_CHOICE_MARK = /[①-⑩]/g;

// 코드·주석·HTML 태그·표 구분선은 검사하지 않는다
function lessonLintText(md) {
    return String(md || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ');
}

// 제목 앞의 이모지는 허용한다 (예: ## ✅ 학습 후 체크리스트). 들여쓴 세부 불릿은 항목으로 세지 않는다.
function lessonLintBullets(md, title) {
    const heading = new RegExp(`^##(?!#)\\s*(?:[^\\s\\w가-힣#]+\\s*)?${title}[^\\n]*\\n([\\s\\S]*?)(?=^#{1,2}\\s|(?![\\s\\S]))`, 'm');
    const section = md.match(heading);
    if (!section) return [];
    return section[1].split('\n')
        .map(line => (line.match(/^[-*]\s+(.*)$/) || [])[1])
        .filter(Boolean)
        .map(text => text.replace(/\*\*/g, '').trim());
}

function lintObjectiveBullets(goals) {
    const issues = goals.flatMap(goal => {
        if (!/수 (?:있다|있습니다)\.?$/.test(goal)) return [{ msg: '학습 목표는 "~할 수 있습니다"로 끝냅니다.', snip: goal }];
        if (LESSON_LINT_BANNED_OBJECTIVE.test(goal)) return [{ msg: '학습 목표는 관찰 가능한 행동으로 씁니다.', snip: goal }];
        return goal.length < LESSON_LINT_MIN_OBJECTIVE_LENGTH ? [{ msg: '학습 목표에 수행 조건과 제약을 담습니다.', snip: goal }] : [];
    });
    return goals.length > LESSON_LINT_MAX_OBJECTIVES
        ? [...issues, { msg: `학습 목표는 ${LESSON_LINT_MAX_OBJECTIVES}개 이하로 씁니다.`, snip: `${goals.length}개` }]
        : issues;
}

function lintChecklistBullets(goals, checks) {
    const missingRefs = checks
        .filter(check => !/다시\s*보기\s*:/.test(check))
        .map(check => ({ msg: '체크리스트에 다시 볼 섹션을 적습니다.', snip: check }));
    return goals.length && checks.length && goals.length !== checks.length
        ? [...missingRefs, { msg: '체크리스트는 학습 목표와 같은 수로 씁니다.', snip: `학습 목표 ${goals.length}개, 체크리스트 ${checks.length}개` }]
        : missingRefs;
}

// 문제 블록은 다음 제목(H1~H3)에서 끝난다
function lessonLintQuestions(md) {
    return [...md.matchAll(/^###\s*문제\s*\d+[^\n]*\n?[\s\S]*?(?=^#{1,3}\s|(?![\s\S]))/gm)].map(match => match[0]);
}

function lintAnswerCount(answers, choiceCount, isMulti) {
    if (!answers.length) return '정답을 표기합니다.';
    if (!isMulti) return answers.length > 1 ? '단일 선택 문제에 정답이 여러 개입니다.' : '';
    if (answers.length === 1) return '복수 정답 문제에 정답이 하나입니다.';
    return answers.length >= choiceCount ? '모든 보기가 정답입니다.' : '';
}

function lintQuestionBlock(block) {
    const [titleLine, ...lines] = block.split('\n');
    const snip = titleLine.replace(/^#+\s*/, '').trim();
    // 보기는 한 줄에 몰아 써도 나눠서 센다
    const choices = lines.filter(line => /^\s*[①-⑩]/.test(line)).join(' ').split(/(?=[①-⑩])/).map(part => part.trim()).filter(Boolean);
    const marks = choices.map(choice => choice[0]);
    const texts = choices.map(choice => choice.slice(1).trim());
    const answerLine = lines.find(line => /정답\s*\**\s*[:：]/.test(line)) || '';
    const answers = answerLine.match(LESSON_LINT_CHOICE_MARK) || [];
    const messages = [
        !LESSON_LINT_QUESTION_LABEL.test(block) && '문제마다 학습 목표와 밴드를 표기합니다.',
        choices.length < LESSON_LINT_MIN_CHOICES && `보기는 ${LESSON_LINT_MIN_CHOICES}개 이상 둡니다.`,
        new Set(texts).size !== texts.length && '같은 보기를 두지 않습니다.',
        answers.some(answer => !marks.includes(answer)) && '정답 번호가 보기에 없습니다.',
        lintAnswerCount(answers, choices.length, LESSON_LINT_MULTI_ANSWER.test(block))
    ];
    return messages.filter(Boolean).map(msg => ({ msg, snip }));
}

function lintLessonPhrases(text) {
    const issues = [];
    LESSON_LINT_RULES.forEach(rule => {
        const seen = new Set();
        for (const match of text.matchAll(rule.re)) {
            if (seen.has(match[0])) continue;
            seen.add(match[0]);
            const snip = text.slice(Math.max(0, match.index - 12), match.index + match[0].length + 10).replace(/\s+/g, ' ').trim();
            issues.push({ msg: rule.msg, snip });
        }
    });
    const plainEnding = [...text.matchAll(LESSON_LINT_PLAIN_ENDING)].find(match => match[1] !== '니');
    return plainEnding
        ? [...issues, { msg: '경어체(~합니다)로 종결합니다.', snip: text.slice(Math.max(0, plainEnding.index - 12), plainEnding.index + 3).replace(/\s+/g, ' ').trim() }]
        : issues;
}

function lintLessonMarkdown(md) {
    const source = String(md || '').replace(/\r\n/g, '\n');
    const goals = lessonLintBullets(source, '학습\\s*목표');
    const checks = lessonLintBullets(source, '학습\\s*후\\s*체크리스트');
    return [
        ...lintObjectiveBullets(goals),
        ...lintChecklistBullets(goals, checks),
        ...lessonLintQuestions(source).flatMap(lintQuestionBlock),
        ...lintLessonPhrases(lessonLintText(source))
    ];
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
