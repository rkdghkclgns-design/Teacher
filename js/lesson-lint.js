// lesson-lint.js - 콘텐츠 업무 설계 규칙으로 교안 마크다운을 검사한다
// 금지 표현, 학습 목표, 체크리스트, 문항 규칙은 develocket-slide(assets/course-rules.js @3a7303f)의 검수 기준을 따른다.

const LESSON_LINT_MAX_SHOWN = 12;
const LESSON_LINT_MAX_OBJECTIVES = 3;
const LESSON_LINT_MIN_OBJECTIVE_LENGTH = 18;
const LESSON_LINT_MIN_CHOICES = 4;
const LESSON_LINT_MAX_SHORT_ANSWER = 30;
const LESSON_LINT_SIMILAR_TEXT = 0.55;
const LESSON_MANUAL_CHECKS = [
    '개요의 문제 상황을 과정 흐름이 아니라 도메인 상황으로 서술했습니다.',
    '지시 강도를 어미로 구분했습니다. (규칙 ~해야 합니다, 권장 ~하는 것이 좋습니다, 설명 ~입니다)',
    '각 학습 내용이 해당 학습 목표를 다루고, 어느 목표에도 속하지 않는 내용이 없습니다.',
    '메뉴·UI 위치처럼 키워드로 드러나지 않는 버전 의존 정보가 없습니다.'
];
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
const LESSON_QUESTION_LABEL = /학습\s*목표\s*(\d+)\s*·\s*밴드\s*(L[1-3])(?:\s*·\s*(객관식|단답식|서술형|코드제출|파일제출))?/;
const LESSON_QUESTION_FIELD = /^\s*(?:[^\s\w가-힣*]+\s*)?\*{0,2}\s*(힌트|정답|허용 표기|해설|채점 기준|테스트)\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*(.*)$/;
const LESSON_QUESTION_FIELD_KEYS = { 힌트: 'hint', 정답: 'answer', '허용 표기': 'accepted', 해설: 'explanation', '채점 기준': 'rubric', 테스트: 'tests' };
const LESSON_QUESTION_HEAD = /^###\s*문제\s*\d+/;
const LESSON_QUESTION_TAIL = /^\s*(?:<table\b|\*\*[^*]+\*\*\s*$)/; // 문항 뒤에 이어지는 채점 기준표 등
const LESSON_INLINE_SPAN = /<\/?span[^>]*>/g; // 교안 프롬프트가 정답 보기를 색 강조 span으로 감싼다
const LESSON_HTML_BLOCK = /^\s*<(?:div|img|figure)\b/; // 문항에 끼어드는 이미지 자리표시
const QUESTION_ANSWER_STYLE = 'color: #22c55e; font-weight: bold;';
const QUESTION_BAND_TYPES = { L1: ['객관식', '단답식'], L2: ['서술형', '코드제출'], L3: ['파일제출'] };
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

// 문제 블록의 범위를 줄 단위로 찾는다. 코드 블록 안의 # 은 제목이 아니다.
// 다음 제목, 필드 뒤의 구분선, 필드 뒤의 표·굵은 제목에서 끝나므로 뒤따르는 본문을 건드리지 않는다.
function lessonQuestionSpans(md) {
    const spans = [];
    let start = null;
    let fenced = false;
    let lastField = '';
    let offset = 0;
    const close = end => {
        if (start !== null) spans.push({ start, end });
        start = null;
    };
    md.split('\n').forEach(line => {
        const next = Math.min(md.length, offset + line.length + 1);
        const field = line.match(LESSON_QUESTION_FIELD);
        if (/^\s*```/.test(line)) fenced = !fenced;
        else if (!fenced && LESSON_QUESTION_HEAD.test(line)) {
            close(offset);
            start = offset;
            lastField = '';
        } else if (!fenced && start !== null) {
            if (/^#{1,3}\s/.test(line) || (lastField && lastField !== '채점 기준' && LESSON_QUESTION_TAIL.test(line))) close(offset);
            else if (lastField && /^\s*---\s*$/.test(line)) close(next);
            else if (field) lastField = field[1];
        }
        offset = next;
    });
    close(md.length);
    return spans;
}

function lessonLintQuestions(md) {
    return lessonQuestionSpans(md).map(span => md.slice(span.start, span.end));
}

function textBigrams(text) {
    const compact = String(text || '').replace(/\s+/g, '');
    return new Set(Array.from({ length: Math.max(0, compact.length - 1) }, (_, i) => compact.slice(i, i + 2)));
}

function textSimilarity(left, right) {
    const a = textBigrams(left);
    const b = textBigrams(right);
    if (!a.size || !b.size) return 0;
    const shared = [...a].filter(pair => b.has(pair)).length;
    return shared / (a.size + b.size - shared);
}

function parseQuestionFields(lines) {
    const fields = {};
    const stem = [];
    const media = [];
    const choiceLines = [];
    let current = null;
    lines.filter(line => !LESSON_QUESTION_LABEL.test(line) && !/^\s*---\s*$/.test(line)).forEach(raw => {
        const line = raw.replace(LESSON_INLINE_SPAN, '');
        const field = line.match(LESSON_QUESTION_FIELD);
        if (LESSON_HTML_BLOCK.test(line)) media.push(line.trim());
        else if (field) {
            current = LESSON_QUESTION_FIELD_KEYS[field[1]];
            fields[current] = field[2].trim();
        } else if (current) fields[current] = `${fields[current]}\n${line}`.trim();
        else if (/^\s*[①-⑩]/.test(line)) choiceLines.push(line);
        else stem.push(line);
    });
    return { fields, stem: stem.join('\n').trim(), media, choiceLines };
}

// "### 문제 N. 제목" 블록을 문항 객체로 읽는다. 보기는 한 줄에 몰아 써도 나눠서 센다.
function parseQuestionBlock(block) {
    const [titleLine, ...lines] = block.trim().split('\n');
    const heading = titleLine.replace(/^#+\s*/, '').trim();
    const label = lines.map(line => line.match(LESSON_QUESTION_LABEL)).find(Boolean);
    const { fields, stem, media, choiceLines } = parseQuestionFields(lines);
    const choices = choiceLines.flatMap(line => line.trim().split(/\s+(?=[①-⑩]\s)/))
        .map(part => ({ mark: part[0], text: part.slice(1).trim() }));
    return {
        no: Number((heading.match(/^문제\s*(\d+)/) || [])[1]) || 0,
        title: heading.replace(/^문제\s*\d+[.)]?\s*/, '').replace(/\s*\(복수\s*정답\)\s*$/, '').trim(),
        objective: label ? Number(label[1]) : null,
        band: label ? label[2] : '',
        type: label?.[3] || (choices.length || !label || label[2] === 'L1' ? '객관식' : ''),
        typed: !!label?.[3],
        multi: LESSON_LINT_MULTI_ANSWER.test(`${heading} ${stem}`),
        stem,
        media: media.join('\n'),
        choices,
        answer: fields.answer || '',
        accepted: fields.accepted || '',
        hint: fields.hint || '',
        explanation: fields.explanation || '',
        rubric: fields.rubric || '',
        tests: fields.tests || ''
    };
}

function lintAnswerCount(answers, choiceCount, isMulti) {
    if (!answers.length) return '정답을 표기합니다.';
    if (!isMulti) return answers.length > 1 ? '단일 선택 문제에 정답이 여러 개입니다.' : '';
    if (answers.length === 1) return '복수 정답 문제에 정답이 하나입니다.';
    return answers.length >= choiceCount ? '모든 보기가 정답입니다.' : '';
}

function lintChoiceQuestion(q) {
    const marks = q.choices.map(choice => choice.mark);
    const texts = q.choices.map(choice => choice.text);
    const answers = q.answer.match(LESSON_LINT_CHOICE_MARK) || [];
    return [
        q.choices.length < LESSON_LINT_MIN_CHOICES && `보기는 ${LESSON_LINT_MIN_CHOICES}개 이상 둡니다.`,
        new Set(texts).size !== texts.length && '같은 보기를 두지 않습니다.',
        answers.some(answer => !marks.includes(answer)) && '정답 번호가 보기에 없습니다.',
        lintAnswerCount(answers, q.choices.length, q.multi)
    ];
}

function lintQuestionByType(q) {
    if (q.type === '객관식') return lintChoiceQuestion(q);
    if (q.type === '단답식') {
        const longAnswer = q.answer.length > LESSON_LINT_MAX_SHORT_ANSWER || q.answer.split(/\s+/).length > 3 || q.answer.includes('\n');
        return [!q.answer && '정답을 표기합니다.', longAnswer && '정답이 단어나 값 하나로 확정되는지 확인합니다.'];
    }
    if (q.type === '서술형') return [!q.rubric && '채점 기준을 작성합니다.'];
    if (q.type === '코드제출') return [!q.tests && '기대 출력이나 테스트 케이스를 작성합니다.'];
    if (q.type === '파일제출') return [!q.rubric && '채점 루브릭을 작성합니다.'];
    return [];
}

function lintQuestion(q, checklist = []) {
    const text = `${q.title} ${q.stem}`.trim();
    return [
        !text && '문항 내용을 작성합니다.',
        (!q.objective || !q.band) && '문제마다 학습 목표와 밴드를 표기합니다.',
        q.typed && q.band && !QUESTION_BAND_TYPES[q.band].includes(q.type) && `${q.band} 밴드에는 ${QUESTION_BAND_TYPES[q.band].join('·')} 유형을 씁니다.`,
        ...lintQuestionByType(q),
        checklist.some(item => textSimilarity(item, text) > LESSON_LINT_SIMILAR_TEXT) && '체크리스트 문장을 그대로 쓰지 않습니다.'
    ].filter(Boolean);
}

function lintQuestionBlock(block, checklist) {
    const question = parseQuestionBlock(block);
    return lintQuestion(question, checklist).map(msg => ({ msg, snip: `문제 ${question.no}. ${question.title}`.trim() }));
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
        ...lessonLintQuestions(source).flatMap(block => lintQuestionBlock(block, checks)),
        ...lintLessonPhrases(lessonLintText(source))
    ];
}

window.runConventionCheck = function (moduleId) {
    const mod = getEditingModule(moduleId);
    const md = mod && getActiveTabContent(mod);
    if (!md || !md.trim()) return window.showAlert('검사할 내용이 없습니다.');
    const issues = lintLessonMarkdown(md);
    const manual = `\n\n사람이 확인할 항목\n${LESSON_MANUAL_CHECKS.map(item => `• ${item}`).join('\n')}`;
    if (!issues.length) return window.showAlert(`✅ 컨벤션 검수 통과\n콘텐츠 업무 설계 규칙에 어긋난 곳이 없습니다.${manual}`);
    const shown = issues.slice(0, LESSON_LINT_MAX_SHOWN).map(issue => `• ${issue.msg}\n  …${issue.snip}…`);
    const rest = issues.length - shown.length;
    window.showAlert(`⚠️ 컨벤션 검수 ${issues.length}건\n\n${shown.join('\n')}${rest > 0 ? `\n\n외 ${rest}건` : ''}${manual}`);
};
