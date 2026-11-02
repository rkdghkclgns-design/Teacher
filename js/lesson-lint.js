// lesson-lint.js - 콘텐츠 업무 설계 규칙으로 교안 마크다운을 검사한다
// 금지 표현, 학습 목표, 체크리스트, 문항 규칙은 develocket-slide(assets/course-rules.js @3a7303f)의 검수 기준을 따른다.

const LESSON_LINT_VERSION_MSG = '버전 의존 정보를 본문에 쓰지 않습니다.';
const LESSON_LINT_MAX_OBJECTIVES = 3;
const LESSON_LINT_MIN_OBJECTIVE_LENGTH = 18;
const LESSON_LINT_MIN_CHOICES = 4;
const LESSON_LINT_MAX_SHORT_ANSWER = 30;
const LESSON_LINT_SIMILAR_TEXT = 0.55;
const LESSON_SECTION_RENAME_SIMILARITY = 0.5;
const LESSON_MANUAL_CHECKS = [
    { key: 'domain', structured: true, text: '개요의 문제 상황을 과정 흐름이 아니라 도메인 상황으로 서술했습니다.', hint: '「앞에서 만든 기능이 느려져서」가 아니라 「요청마다 새 연결을 여는 구조에서는」' },
    { key: 'strength', text: '지시 강도를 어미로 구분했습니다.', hint: '규칙 ~해야 합니다 · 권장 ~하는 것이 좋습니다 · 설명 ~입니다' },
    { key: 'mapping', structured: true, text: '각 학습 내용이 해당 학습 목표를 다루고, 어느 목표에도 속하지 않는 내용이 없습니다.', hint: '목표와 무관한 배경 설명이 섞였는지 확인합니다.' },
    { key: 'version', text: '메뉴·UI 위치처럼 키워드로 드러나지 않는 버전 의존 정보가 없습니다.', hint: '「상단 Window 메뉴의 세 번째 항목」 같은 위치 설명' }
];
// 심각도는 원본과 같다. bad는 필수, warn은 권장이다.
const LESSON_LINT_RULES = [
    { re: /여러분|당신|우리(?=[는가를의도와])/g, sev: 'warn', msg: '학습자를 호칭하지 않습니다.' },
    { re: /앞에서|앞서|이전 (?:시간|모듈|차시|장)|지난 시간|다음 (?:시간|모듈|차시|장)에/g, sev: 'bad', msg: '다른 차시를 지칭하지 않습니다.' },
    { re: /경우에 따라 다릅니다|경우에 따라 달라|상황에 맞게/g, sev: 'warn', msg: '판단 기준을 명시합니다.' },
    { re: /매우|아주|굉장히/g, sev: 'warn', msg: '정도는 수치로 씁니다.' },
    { re: /당연히|물론|쉽게/g, sev: 'warn', msg: '학습자에게 당연하지 않은 표현입니다.' },
    { re: /20\d\d\.\d+\.\d+|버전\s*\d/g, sev: 'warn', msg: LESSON_LINT_VERSION_MSG },
    { re: /강사는|교수자는|시연(?:한다|합니다)|수업에서는/g, sev: 'warn', msg: '수업 진행은 교수안의 몫입니다.' }
];
// 키 조합은 인라인 코드로 쓰는 일이 많아 인라인 코드 안까지 검사한다
const LESSON_LINT_SHORTCUT = { re: /\b(?:Ctrl|Cmd|Alt|Shift)\s*\+\s*[\w가-힣]|단축키/gi, sev: 'warn', msg: LESSON_LINT_VERSION_MSG };
const LESSON_LINT_BANNED_OBJECTIVE = /이해한다|이해합니다|이해할 수|안다(?=[.\s]|$)|알 수 있|익힌다|익힙니다|익힐 수/;
const LESSON_LINT_PLAIN_ENDING = /([가-힣])다\.(?=\s|$)/g;
const LESSON_QUESTION_LABEL = /학습\s*목표\s*(\d+)\s*·\s*밴드\s*(L[1-3])(?:\s*·\s*(객관식|단답식|서술형|코드제출|파일제출))?/;
const LESSON_QUESTION_FIELD = /^\s*(?:[^\s\w가-힣*]+\s*)?\*{0,2}\s*(힌트|정답|허용 표기|해설|채점 기준|테스트|교차 검수)\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*(.*)$/;
const LESSON_QUESTION_FIELD_KEYS = { 힌트: 'hint', 정답: 'answer', '허용 표기': 'accepted', 해설: 'explanation', '채점 기준': 'rubric', 테스트: 'tests', '교차 검수': 'review' };
const LESSON_QUESTION_HEAD = /^###\s*문제\s*\d+/;
const LESSON_QUESTION_TAIL = /^\s*(?:<table\b|\*\*[^*]+\*\*\s*$)/; // 문항 뒤에 이어지는 채점 기준표 등
const LESSON_INLINE_SPAN = /<\/?span[^>]*>/g; // 교안 프롬프트가 정답 보기를 색 강조 span으로 감싼다
const LESSON_HTML_BLOCK = /^\s*<(?:div|img|figure)\b/; // 문항에 끼어드는 이미지 자리표시
const QUESTION_ANSWER_STYLE = 'color: #22c55e; font-weight: bold;';
const QUESTION_BAND_TYPES = { L1: ['객관식', '단답식'], L2: ['서술형', '코드제출'], L3: ['파일제출'] };
const LESSON_LINT_MULTI_ANSWER = /복수\s*정답|모두 고르/;
const LESSON_LINT_CHOICE_MARK = /[①-⑩]/g;
const LESSON_QUESTION_WARNINGS = [`보기는 ${LESSON_LINT_MIN_CHOICES}개 이상 둡니다.`, '복수 정답 문제에 정답이 하나입니다.', '정답이 단어나 값 하나로 확정되는지 확인합니다.'];
// 개요·목표·체크리스트 구조를 갖는 탭. 실습·학습이해도 탭은 구조가 달라 어구와 문항만 검사한다.
const LESSON_STRUCTURED_TABS = ['basicLearn', 'advLearn'];
const LESSON_HEADING_PREFIX = '^(?:[^\\s\\w가-힣]+\\s*)?(?:\\d+[.)]\\s*)?';
const LESSON_OVERVIEW_TITLE = new RegExp(`${LESSON_HEADING_PREFIX}(?:차시\\s*|수업\\s*|학습\\s*)?개요(?!서)`);
const LESSON_FRAME_TITLE = new RegExp(`${LESSON_HEADING_PREFIX}(?:학습\\s*목표|학습\\s*후\\s*체크리스트)`);
const LESSON_CHECK_REF = /다시\s*보기\s*:\s*([^)）]+)/;
const LESSON_RULE_NOTE = '개요, 목표와 내용의 대응은 기본학습·심화학습 탭에만 적용합니다. 코드 블록과 이미지 태그는 검사하지 않습니다.';
const LESSON_RULE_LIST = [
    { sev: 'bad', area: '개요', rule: '개요를 작성합니다.', desc: '이 차시를 왜 배우는지 제시합니다. 문제 상황, 해결할 일, 학습 후 가능해지는 일을 담습니다.' },
    { sev: 'bad', area: '학습 목표', rule: '학습 목표를 1개 이상 작성합니다.', desc: '교안은 학습 목표로 시작해 그 목표를 확인하며 끝납니다.' },
    { sev: 'bad', area: '학습 목표', rule: '학습 목표는 "~할 수 있습니다"로 끝냅니다.', desc: '학습 후 할 수 있게 되는 행동을 선언하는 형식입니다.' },
    { sev: 'bad', area: '학습 목표', rule: '학습 목표는 관찰 가능한 행동으로 씁니다.', desc: '이해·앎·익힘은 밖에서 확인할 수 없습니다. 구현한다, 측정한다, 비교한다처럼 판정할 수 있는 동사를 씁니다.' },
    { sev: 'bad', area: '1:1 대응', rule: '학습 목표마다 내용 섹션을 둡니다.', desc: '학습 내용은 목표별 덩어리로 묶습니다. 덩어리는 ## 섹션 하나이거나 연속한 ## 섹션 여러 개입니다.' },
    { sev: 'bad', area: '1:1 대응', rule: '체크리스트는 학습 목표와 같은 수로 씁니다.', desc: '체크리스트 항목은 학습 목표를 하나씩 스스로 확인하는 문장입니다.' },
    { sev: 'bad', area: '재사용성', rule: '다른 차시를 지칭하지 않습니다.', desc: '다른 교과에서도 그대로 쓸 수 있도록 문제를 도메인 상황으로 서술합니다.' },
    { sev: 'warn', area: '학습 목표', rule: '학습 목표는 3개 이하로 씁니다.', desc: '4개 이상이면 한 차시가 다루는 범위가 넓은 것입니다. 차시 분할을 검토합니다.' },
    { sev: 'warn', area: '학습 목표', rule: '학습 목표에 수행 조건과 제약을 담습니다.', desc: '어떤 상황에서, 무엇을 써서, 어느 수준까지 하는지를 함께 적습니다.' },
    { sev: 'warn', area: '체크리스트', rule: '체크리스트에 다시 볼 섹션을 적습니다.', desc: '이해가 부족할 때 돌아갈 곳을 알려 줍니다. 교안에 있는 섹션 제목을 목표마다 다르게 적습니다.' },
    { sev: 'warn', area: '어투', rule: '학습자를 호칭하지 않습니다.', desc: '주어 없이 동작만 서술합니다.' },
    { sev: 'warn', area: '어투', rule: '경어체로 종결합니다.', desc: '「~합니다 / ~하지 않습니다」로 끝냅니다.' },
    { sev: 'warn', area: '모호한 표현', rule: '판단 기준을 명시합니다.', desc: '「경우에 따라」, 「상황에 맞게」 대신 어떤 조건에서 무엇을 선택하는지 적습니다.' },
    { sev: 'warn', area: '모호한 표현', rule: '정도는 수치로 씁니다.', desc: '「매우 느리다」 대신 「응답 시간이 2배로 늘어난다」처럼 씁니다.' },
    { sev: 'warn', area: '모호한 표현', rule: '당연하다는 표현을 쓰지 않습니다.', desc: '「당연히」, 「물론」, 「쉽게」는 모르는 학습자를 자책하게 만듭니다.' },
    { sev: 'warn', area: '버전 의존', rule: LESSON_LINT_VERSION_MSG, desc: '툴 버전, 단축키, 메뉴 위치는 차시 메타데이터의 사용 툴과 버전이 관리합니다.' },
    { sev: 'warn', area: '교안/교수안', rule: '수업 진행은 교수안의 몫입니다.', desc: '교안은 무엇을 배울지 지정하고, 어떻게 가르칠지는 교수안에서 설계합니다.' }
];

const lintCounts = issues => {
    const required = issues.filter(issue => issue.sev === 'bad').length;
    return { required, recommended: issues.length - required };
};

// 코드·주석·HTML 태그·표 구분선은 검사하지 않는다. keepInlineCode는 인라인 코드 안의 키 조합을 볼 때만 쓴다.
function lessonLintText(md, { keepInlineCode = false } = {}) {
    const unfenced = String(md || '').replace(/```[\s\S]*?```/g, ' ');
    return (keepInlineCode ? unfenced : unfenced.replace(/`[^`]*`/g, ' '))
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/^.*교차 검수\s*\**\s*[:：].*$/gm, ' ');
}

// ## 기준으로 나눈다. 코드 블록 안의 ## 은 제목이 아니다.
function lessonLintSections(md) {
    return md.replace(/```[\s\S]*?```/g, ' ').split(/^(?=##\s)/m).map(text => ({ title: (text.match(/^##\s+(.*)/) || [])[1]?.trim() || '', text }));
}

const lessonContentTitles = titles => titles.filter(title => !LESSON_FRAME_TITLE.test(title) && !LESSON_OVERVIEW_TITLE.test(title));

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
    const where = '학습 목표';
    const issues = goals.flatMap(goal => {
        if (!/수 (?:있다|있습니다)\.?$/.test(goal)) return [{ sev: 'bad', where, msg: '학습 목표는 "~할 수 있습니다"로 끝냅니다.', snip: goal }];
        if (LESSON_LINT_BANNED_OBJECTIVE.test(goal)) return [{ sev: 'bad', where, msg: '학습 목표는 관찰 가능한 행동으로 씁니다.', snip: goal }];
        return goal.length < LESSON_LINT_MIN_OBJECTIVE_LENGTH ? [{ sev: 'warn', where, msg: '학습 목표에 수행 조건과 제약을 담습니다.', snip: goal }] : [];
    });
    return goals.length > LESSON_LINT_MAX_OBJECTIVES
        ? [...issues, { sev: 'warn', where, msg: `학습 목표는 ${LESSON_LINT_MAX_OBJECTIVES}개 이하로 씁니다.`, snip: `${goals.length}개` }]
        : issues;
}

function lintChecklistBullets(goals, checks) {
    const where = '학습 후 체크리스트';
    const missingRefs = checks
        .filter(check => !/다시\s*보기\s*:/.test(check))
        .map(check => ({ sev: 'warn', where, msg: '체크리스트에 다시 볼 섹션을 적습니다.', snip: check }));
    return goals.length && checks.length && goals.length !== checks.length
        ? [...missingRefs, { sev: 'bad', where, msg: '체크리스트는 학습 목표와 같은 수로 씁니다.', snip: `학습 목표 ${goals.length}개, 체크리스트 ${checks.length}개` }]
        : missingRefs;
}

// 체크리스트의 "다시 보기"로 목표와 내용 섹션의 대응을 확인한다. 제목 앞 이모지나 시간 표기는 달라도 같은 섹션으로 본다.
function lintChecklistRefs(titles, checks) {
    const where = '학습 후 체크리스트';
    const key = text => String(text).replace(/\(⏱[^)]*\)|[^\w가-힣]/g, '');
    const keys = titles.map(key).filter(Boolean);
    const resolve = ref => keys.find(title => title === key(ref)) || keys.find(title => title.includes(key(ref)) || key(ref).includes(title));
    const refs = checks.map(check => (check.match(LESSON_CHECK_REF) || [])[1]).filter(ref => ref && key(ref));
    const unknown = refs.filter(ref => !resolve(ref)).map(ref => ({ sev: 'warn', where, msg: '체크리스트의 다시 볼 섹션이 교안에 없습니다.', snip: ref }));
    const found = refs.map(resolve).filter(Boolean);
    return new Set(found).size < found.length
        ? [...unknown, { sev: 'warn', where, msg: '학습 목표마다 다른 섹션을 다시 보도록 적습니다.', snip: `다시 보기 ${found.length}개, 서로 다른 섹션 ${new Set(found).size}개` }]
        : unknown;
}

// 학습 탭은 ## 대주제가 목표보다 많으므로(기본학습은 최소 8개) 개수가 같은지가 아니라 목표마다 섹션이 있는지를 본다.
// 어느 섹션이 어느 목표에 속하는지는 체크리스트의 "다시 보기"와 수동 검수로 확인한다.
function lintLessonStructure(source, goals, checks) {
    const titles = lessonLintSections(source).map(section => section.title).filter(Boolean);
    const content = lessonContentTitles(titles);
    const hasOverview = titles.some(title => LESSON_OVERVIEW_TITLE.test(title));
    const counts = `학습 목표 ${goals.length}개`;
    return [
        !goals.length && { sev: 'bad', where: '학습 목표', msg: '학습 목표를 1개 이상 작성합니다.', missing: true },
        !hasOverview && { sev: 'bad', where: '개요', msg: '개요를 작성합니다.', missing: true },
        content.length < goals.length && { sev: 'bad', where: '학습 내용', msg: '학습 목표마다 내용 섹션을 둡니다.', snip: `${counts}, 내용 섹션 ${content.length}개`, missing: true },
        goals.length && !checks.length && { sev: 'bad', where: '학습 후 체크리스트', msg: '체크리스트는 학습 목표와 같은 수로 씁니다.', snip: `${counts}, 체크리스트 0개`, missing: true },
        ...lintChecklistRefs(titles, checks)
    ].filter(Boolean);
}

function lessonStructureStats(md) {
    const source = String(md || '').replace(/\r\n/g, '\n');
    const titles = lessonLintSections(source).map(section => section.title).filter(Boolean);
    return {
        objectives: lessonLintBullets(source, '학습\\s*목표').length,
        sections: lessonContentTitles(titles).length,
        checklist: lessonLintBullets(source, '학습\\s*후\\s*체크리스트').length
    };
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

// 제목만 바꾼 섹션인지 본문으로 판단한다. 제목이 다른 섹션을 같은 섹션으로 볼 때는 항상 이 기준을 쓴다.
const isRenamedSection = (beforeText, afterText) => textSimilarity(beforeText, afterText) >= LESSON_SECTION_RENAME_SIMILARITY;

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
        tests: fields.tests || '',
        review: fields.review || ''
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
        checklist.some(item => textSimilarity(item, text) > LESSON_LINT_SIMILAR_TEXT) && '체크리스트 문장을 그대로 쓰지 않습니다.',
        q.review.startsWith('수정 필요') && `AI 교차 검수: ${q.review}`
    ].filter(Boolean);
}

function lintQuestionBlock(block, checklist) {
    const question = parseQuestionBlock(block);
    return lintQuestion(question, checklist).map(msg => ({
        sev: LESSON_QUESTION_WARNINGS.includes(msg) || msg.startsWith('AI 교차 검수') ? 'warn' : 'bad',
        where: `문제 ${question.no}`,
        msg,
        snip: `문제 ${question.no}. ${question.title}`.trim()
    }));
}

function lintRuleMatches(rule, text, where) {
    const seen = new Set();
    return [...text.matchAll(rule.re)].filter(match => !seen.has(match[0]) && seen.add(match[0])).map(match => ({
        sev: rule.sev, where, msg: rule.msg,
        snip: text.slice(Math.max(0, match.index - 12), match.index + match[0].length + 10).replace(/\s+/g, ' ').trim()
    }));
}

function lintLessonPhrases(sectionText, where) {
    const text = lessonLintText(sectionText);
    const issues = [...LESSON_LINT_RULES.flatMap(rule => lintRuleMatches(rule, text, where)), ...lintRuleMatches(LESSON_LINT_SHORTCUT, lessonLintText(sectionText, { keepInlineCode: true }), where)];
    const plainEnding = [...text.matchAll(LESSON_LINT_PLAIN_ENDING)].find(match => match[1] !== '니');
    return plainEnding
        ? [...issues, { sev: 'warn', where, msg: '경어체(~합니다)로 종결합니다.', snip: text.slice(Math.max(0, plainEnding.index - 12), plainEnding.index + 3).replace(/\s+/g, ' ').trim() }]
        : issues;
}

// tabId를 주면 그 탭의 구조까지 검사한다. 지적은 { sev, where, msg, snip, missing } 형식이다. missing은 없는 섹션을 새로 써야 한다는 뜻이다.
function lintLessonMarkdown(md, tabId) {
    const source = String(md || '').replace(/\r\n/g, '\n');
    const goals = lessonLintBullets(source, '학습\\s*목표');
    const checks = lessonLintBullets(source, '학습\\s*후\\s*체크리스트');
    return [
        ...(LESSON_STRUCTURED_TABS.includes(tabId) ? lintLessonStructure(source, goals, checks) : []),
        ...lintObjectiveBullets(goals),
        ...lintChecklistBullets(goals, checks),
        ...lessonLintQuestions(source).flatMap(block => lintQuestionBlock(block, checks)),
        ...lessonLintSections(source).flatMap(section => lintLessonPhrases(section.text, section.title))
    ];
}
