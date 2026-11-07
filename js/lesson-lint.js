// lesson-lint.js - 콘텐츠 업무 설계 규칙으로 교안 마크다운을 검사한다
// 금지 표현, 학습 목표, 체크리스트, 문항 규칙은 develocket-slide(assets/course-rules.js @3a7303f)의 검수 기준을 따른다.

const LESSON_LINT_VERSION_MSG = '버전 의존 정보를 본문에 쓰지 않습니다.';
const LESSON_CODE_EXAMPLE_MSG = '코드를 설명하면 예제 코드 블록을 함께 둡니다.';
const LESSON_CODE_COMMENT_MSG = '코드 블록에 주석을 넣습니다.'; // code-comments.js CODE_COMMENT_LINT_MSG와 같은 글(이 파일은 그 모듈 없이도 돈다)
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
// 다른 차시 지칭: '문 앞에서'처럼 낱말 뒤에 띄어 쓴 '앞에서'는 장소일 수 있어 '앞에서 배운'처럼 가리킬 때만 잡는다
const LESSON_LINT_RULES = [
    { re: /여러분|당신|우리(?=[는가를의도와])/g, sev: 'warn', msg: '학습자를 호칭하지 않습니다.' },
    { re: /(?<![가-힣][ \t])앞에서|앞에서(?=\s*(?:배운|다룬|살펴본|설명한|본|만든|정의한|소개한|언급한|말한|작성한|익힌|했던)(?![가-힣]))|앞서|이전 (?:시간|모듈|차시|장)|지난 시간|다음 (?:시간|모듈|차시|장)에/g, sev: 'bad', msg: '다른 차시를 지칭하지 않습니다.' },
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
const LESSON_QUESTION_FIELD = /^\s*(?:[^\s\w가-힣*]+\s*)?\*{0,2}\s*(힌트|시작 코드|정답|허용 표기|해설|채점 기준|테스트|교차 검수)\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*(.*)$/;
const LESSON_QUESTION_FIELD_KEYS = { 힌트: 'hint', '시작 코드': 'code', 정답: 'answer', '허용 표기': 'accepted', 해설: 'explanation', '채점 기준': 'rubric', 테스트: 'tests', '교차 검수': 'review' };
const LESSON_QUESTION_HEAD = /^###\s*문제\s*\d+/;
const LESSON_QUESTION_TAIL = /^\s*(?:<table\b|\*\*[^*]+\*\*\s*$)/; // 문항 뒤에 이어지는 채점 기준표 등
const LESSON_INLINE_SPAN = /<\/?span[^>]*>/g; // 교안 프롬프트가 정답 보기를 색 강조 span으로 감싼다
// 문항에 끼어드는 이미지 자리표시와 한 줄 주석(채우지 않고 남은 그림 자리 <!-- [IMG: "…"] --> 등). 문항 글·CSV에 넣지 않고 그대로 간직한다
const LESSON_HTML_BLOCK = /^\s*(?:<(?:div|img|figure)\b|<!--.*-->\s*$)/;
const QUESTION_ANSWER_STYLE = 'color: #22c55e; font-weight: bold;';
const QUESTION_BAND_TYPES = { L1: ['객관식', '단답식'], L2: ['서술형', '코드제출'], L3: ['파일제출'] };
const LESSON_LINT_MULTI_ANSWER = /복수\s*정답|모두 고르/;
const LESSON_LINT_CHOICE_MARK = /[①-⑩]/g;
// 원본 규칙표(course-rules.js @3a7303f)에서 필수(sev: bad)로 정한 항목. 나머지는 권장이다.
const LESSON_LINT_REQUIRED = /"~할 수 있습니다"로 끝냅니다|관찰 가능한 행동|체크리스트는 학습 목표와 같은 수|다른 차시를 지칭|문항 내용을 작성|학습 목표와 밴드를 표기|밴드에는 .+ 유형을 씁니다|체크리스트 문장을|정답을 표기|같은 보기|정답 번호가 보기에 없|단일 선택 문제에|모든 보기가 정답|채점 기준을 작성|기대 출력이나 테스트|채점 루브릭을 작성/;
const LESSON_LINT_QUESTION_VERSION = /(?:Ctrl|Cmd|Alt|Shift)\s*\+|단축키|20\d\d\.\d+\.\d+|버전\s*\d/i;
const LESSON_LINT_QUESTION_ADDRESS = /여러분|당신/;
const LESSON_LINT_MULTI_NOTICE = /모두|전부|있는 대로|복수/;
const LESSON_QUESTION_WARNINGS = [
    `보기는 ${LESSON_LINT_MIN_CHOICES}개 이상 둡니다.`, '복수 정답 문제에 정답이 하나입니다.', '정답이 단어나 값 하나로 확정되는지 확인합니다.',
    '채점 요소마다 점수를 적습니다.', '버전에 의존하는 정보를 쓰지 않습니다.', '학습자를 호칭하지 않습니다.'
];
// 개요·목표·체크리스트 구조를 갖는 탭. 실습·학습이해도·심화이해도 탭은 구조가 달라 어구와 문항만 검사한다.
const LESSON_STRUCTURED_TABS = ['basicLearn', 'advLearn'];
// 문제은행 탭(학습이해도·심화이해도). data.js LESSON_TRACKS의 bank와 같다(이 파일은 data.js 없이도 돈다). 목표 대응을 보고 코드 예제 규칙은 보지 않는다
const LESSON_BANK_TABS = ['assessment', 'advAssessment'];
const LESSON_HEADING_PREFIX = '^(?:[^\\s\\w가-힣]+\\s*)?(?:\\d+[.)]\\s*)?';
const LESSON_OVERVIEW_TITLE = new RegExp(`${LESSON_HEADING_PREFIX}(?:차시\\s*|수업\\s*|학습\\s*)?개요(?!서)`);
const LESSON_FRAME_TITLE = new RegExp(`${LESSON_HEADING_PREFIX}(?:학습\\s*목표|학습\\s*후\\s*체크리스트)`);
const LESSON_CHECK_REF = /다시\s*보기\s*:\s*([^)）]+)/;
const LESSON_RULE_NOTE = '개요, 목표와 내용의 대응은 기본학습·심화학습 탭에만 적용합니다. 코드 블록 안의 글과 이미지 태그는 어구 검사에서 뺍니다. 코드 예제 규칙은 코드를 다루는 차시에만 검사합니다. 코드 블록 주석은 모든 탭에서 검사하고(실행 결과·json·mermaid 블록은 빼고), AI 수정 제안과 도구의 \'코드 주석 넣기\'가 코드는 그대로 두고 주석만 더합니다.';
// 앞 17줄은 원본 규칙표(course-rules.js)와 같은 차례다(convention-parity.test.js는 영역·종류로 못 찾은 줄을 같은 차례의 줄과 견준다).
// 그래서 새 줄은 그 뒤, 코드 예제 권장 두 줄 바로 앞에 둔다(끝 두 줄은 lesson-code.test.js가 본다)
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
    { sev: 'warn', area: '교안/교수안', rule: '수업 진행은 교수안의 몫입니다.', desc: '교안은 무엇을 배울지 지정하고, 어떻게 가르칠지는 교수안에서 설계합니다.' },
    { sev: 'bad', area: '코드 예제', rule: LESSON_CODE_COMMENT_MSG, desc: '코드 첫 줄 위에 무엇을 하는 코드인지, 핵심 줄 위나 끝에 그 줄이 하는 일을 적습니다. 코드 열 줄마다 주석을 하나 이상 둡니다. 실행 결과·json·mermaid 블록은 보지 않고, 문제은행 문항의 주석은 정답을 알려 주지 않습니다.' },
    { sev: 'warn', area: '코드 예제', rule: LESSON_CODE_EXAMPLE_MSG, desc: '코드를 말로만 설명한 섹션을 찾습니다. 무엇을 하는 코드인지, 코드 블록, 핵심 줄 설명, 실행 결과 순서로 보입니다.' },
    { sev: 'warn', area: '코드 예제', rule: '코드 블록에 언어를 적고 닫습니다.', desc: '```python처럼 언어를 적어야 이름표가 붙습니다. 닫지 않은 코드 블록은 뒤의 본문까지 코드로 보입니다.' }
];

// 정보(info, 이름표를 몰라 주석을 세지 못한 코드 블록 따위)는 고칠 지적이 아니라 필수에도 권장에도 세지 않는다
const lintCounts = issues => {
    const required = issues.filter(issue => issue.sev === 'bad').length;
    return { required, recommended: issues.filter(issue => issue.sev !== 'bad' && issue.sev !== 'info').length };
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

// 코드 펜스를 줄 단위로 따라간다. 여는 펜스보다 짧은 ``` 는 코드의 일부다. 펜스 밖이면 0을 돌려준다.
// 언어 칸에 `가 든 줄(```npm install```)은 펜스가 아니라 인라인 코드다(marked도 그렇게 그린다)
function nextCodeFence(fence, line) {
    const [, marks, rest] = line.match(/^\s*(`{3,})(.*)$/) || [];
    if (!marks) return fence;
    if (!fence) return rest.includes('`') ? 0 : marks.length;
    return marks.length >= fence && !rest.trim() ? 0 : fence;
}

// 글이 코드 블록 안에서 끝나면 여는 펜스 길이만큼 닫는다. 이어 붙이는 글이 코드 안으로 들어가지 않게 한다
function closeOpenFence(md) {
    const text = String(md ?? '');
    const fence = text.split(/\r?\n/).reduce(nextCodeFence, 0);
    return fence ? `${text.trimEnd()}\n${'`'.repeat(fence)}` : text;
}

/* ---------- 낭독 분량 ---------- */
// 강사가 소리 내어 읽는 속도(공백 포함 1분에 250자)와 학습 탭(기본학습·심화학습)의 낭독 시간. (⏱ N분) 합계는 목표보다 30분까지 길어도 된다
const READ_CHARS_PER_MINUTE = 250;
const LEARN_TARGET_MINUTES = 480;
const BASIC_LEARN_MIN_MINUTES = LEARN_TARGET_MINUTES; // 예전 이름. 같은 값이다(새 코드는 LEARN_TARGET_MINUTES를 쓴다)
const BASIC_LEARN_LABEL_SLACK = 30;
const LEARN_VOLUME_TABS = ['basicLearn', 'advLearn']; // 낭독 분량까지 채우는 학습 탭
const SPOKEN_SKIP_LINE = /^\s*\|.*\|\s*$|class="image-(?:wrapper|placeholder)"/; // 파이프 표 줄과 저장된 그림 칸 줄(다시 찾기 버튼·그림 설명까지)
const SPOKEN_MARKS = /[■▣□▪◆●▶►•※]|\p{Extended_Pictographic}|\uFE0F|\u200D/gu; // 소리 내어 읽지 않는 장식 기호와 그림 문자

// 학습 탭(기본학습·심화학습)의 목표 낭독 시간(분). 차시 시간이 길어도 짧아도 늘 480분이다. 다른 탭은 0(분량을 채우지 않는다)
function learnTargetMinutes(mod, tabId = 'basicLearn') {
    return LEARN_VOLUME_TABS.includes(tabId) ? LEARN_TARGET_MINUTES : 0;
}

// 기본 학습의 목표 낭독 시간(분). learnTargetMinutes(mod, 'basicLearn')과 같다
function basicLearnTargetMinutes(mod) {
    return learnTargetMinutes(mod, 'basicLearn');
}

// 그 차시의 그 탭을 낭독 목표 분량까지 채우는가. 학습 탭만 채우고 최종 평가는 채우지 않는다
function fillsLearnVolume(mod, tabId) {
    return !!mod && mod.id !== 'mainQuest' && learnTargetMinutes(mod, tabId) > 0;
}

/* ---------- 실습 시간 ---------- */
// 강사가 정하는 실습 탭 시간(분). 생성 옵션(과정 기본값 globalState.courseDesign.genOptions, 차시 mod.gen)에 탭마다 이 키로 둔다
const PRACTICE_MINUTE_KEYS = { basicPrac: 'basicPracMinutes', advPrac: 'advPracMinutes' };
const PRACTICE_MINUTES_RANGE = { min: 10, max: 600, step: 10 };
const PRACTICE_MINUTES_PER_CHUNK = 90; // 실습 시간을 정한 실습 탭은 이 분마다 이어쓰기 청크를 하나씩 더 허용한다
const PRACTICE_LABEL_TOLERANCE = 0.1;  // ## 제목 (⏱ N분) 합계가 실습 시간에서 이 비율보다 벗어나면 알린다
const PRACTICE_TIME_LABEL = /⏱\S*\s*(?:약\s*)?(\d+)\s*분/;
const TAB_CHUNK_LIMITS = { learn: 6, other: 3 }; // 탭 생성의 이어쓰기 상한(청크 수)

// 실습 탭의 생성 옵션 키. 실습 탭이 아니면 ''(constructor 같은 이름도 실습 탭으로 보지 않는다)
const practiceKeyOf = tabId => (Object.prototype.hasOwnProperty.call(PRACTICE_MINUTE_KEYS, tabId) ? PRACTICE_MINUTE_KEYS[tabId] : '');

// 실습 시간 값(분). 10~600분 사이 10분 단위 정수만 받고, 그 밖의 값(빈 값·글자·소수·범위 밖·객체)은 null(정하지 않음)
function practiceMinutesValue(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const minutes = Number(value);
    const { min, max, step } = PRACTICE_MINUTES_RANGE;
    return Number.isInteger(minutes) && minutes >= min && minutes <= max && minutes % step === 0 ? minutes : null;
}

// 그 차시 실습 탭의 시간: { minutes, from }. 차시에서 정한 값(from 'lesson'), 없으면 과정 기본값('course'), 둘 다 없으면 0('', 지시문의 기본 90~120분).
// 실습 탭이 아니거나 최종 평가면 0. courseOptions: 과정 기본값 대신 볼 값(저장하기 전의 일괄 생성 창 칸)
function lessonPracticeTime(mod, tabId, courseOptions) {
    const key = practiceKeyOf(tabId);
    if (!key || !mod || mod.id === 'mainQuest') return { minutes: 0, from: '' };
    const own = practiceMinutesValue(mod.gen?.[key]);
    if (own) return { minutes: own, from: 'lesson' };
    const course = courseOptions !== undefined ? courseOptions : (typeof globalState !== 'undefined' && globalState ? globalState.courseDesign?.genOptions : null);
    const fallback = practiceMinutesValue(course?.[key]);
    return fallback ? { minutes: fallback, from: 'course' } : { minutes: 0, from: '' };
}

function lessonPracticeMinutes(mod, tabId, courseOptions) {
    return lessonPracticeTime(mod, tabId, courseOptions).minutes;
}

// 실습 시간 N분에 맞춘 실습 탭의 최소 분량: 글자 max(2,000, N×75를 백 단위로 반올림), 줄 round(N×2.4),
// 과제 수(기본실습 clamp(round(N/35), 1, 8)개·단계 5개, 심화실습 clamp(round(N/50), 1, 6)개·단계 7개), ## 파트 min(3, 과제 수)개. 정하지 않았으면 null
function practiceVolumeSpec(tabId, minutes) {
    const n = practiceMinutesValue(minutes);
    if (!n || !practiceKeyOf(tabId)) return null;
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    const advanced = tabId === 'advPrac';
    const tasks = advanced ? clamp(Math.round(n / 50), 1, 6) : clamp(Math.round(n / 35), 1, 8);
    return { minutes: n, chars: Math.max(2000, Math.round(n * 75 / 100) * 100), lines: Math.round(n * 2.4), tasks, steps: advanced ? 7 : 5, parts: Math.min(3, tasks) };
}

// 탭 생성의 이어쓰기 상한(청크 수). 학습 탭은 6, 실습 시간을 정한 실습 탭은 max(3, ⌈N÷90⌉)(6까지), 나머지는 3
function tabChunkLimit(tabId, practiceMinutes = 0) {
    if (LEARN_VOLUME_TABS.includes(tabId)) return TAB_CHUNK_LIMITS.learn;
    const minutes = practiceKeyOf(tabId) ? practiceMinutesValue(practiceMinutes) : null;
    if (!minutes) return TAB_CHUNK_LIMITS.other;
    return Math.min(TAB_CHUNK_LIMITS.learn, Math.max(TAB_CHUNK_LIMITS.other, Math.ceil(minutes / PRACTICE_MINUTES_PER_CHUNK)));
}

// ## 제목(코드 블록 밖)의 (⏱ N분) 분 목록. 시간 표시가 없는 제목은 뺀다
function practiceLabelMinutes(md) {
    return lessonLintSections(String(md || '').replace(/\r\n/g, '\n'))
        .map(section => Number((section.title.match(PRACTICE_TIME_LABEL) || [])[1]) || 0)
        .filter(minutes => minutes > 0);
}

// 실습 탭의 (⏱ N분) 합계가 정한 실습 시간에 맞는지: { minutes, sum, labelled, ok }. 시간 표시가 없거나 10%보다 벗어나면 ok가 아니다. 정하지 않았으면 null
function practiceTimeCheck(md, minutes) {
    const target = practiceMinutesValue(minutes);
    if (!target) return null;
    const labels = practiceLabelMinutes(md);
    const sum = labels.reduce((total, value) => total + value, 0);
    return { minutes: target, sum, labelled: labels.length, ok: labels.length > 0 && Math.abs(sum - target) <= target * PRACTICE_LABEL_TOLERANCE };
}

// 정한 실습 시간과 (⏱ N분) 합계가 맞지 않을 때 알릴 글. 맞거나 정하지 않았으면 ''
function practiceTimeNote(md, minutes, label = '실습 탭') {
    const check = practiceTimeCheck(md, minutes);
    if (!check || check.ok) return '';
    if (!check.labelled) return `${label}의 ## 제목에 (⏱ N분) 시간 표시가 없어 정한 실습 시간 ${check.minutes}분에 맞는지 알 수 없습니다. 제목마다 걸리는 시간을 적어 확인해 주세요.`;
    return `${label}의 ## 제목 시간(⏱) 합계가 ${check.sum}분으로, 정한 실습 시간 ${check.minutes}분과 10% 넘게 차이 납니다. 제목의 시간을 확인해 주세요.`;
}

// open(전역 정규식)이 찾은 자리부터 그 뒤 첫 close(전역 정규식)까지를 빈칸 하나로 바꾼다. 닫지 않은 자리가 나오면 거기서 멈춘다(뒤의 자리도 닫을 곳이 없다).
// 정규식 하나([\s\S]*?)로 찾으면 닫지 않은 자리마다 글 끝까지 다시 읽어, 남이 준 긴 글에서 화면이 멈춘다
function spokenWithoutSpans(text, open, close) {
    let out = '';
    let from = 0;
    open.lastIndex = 0;
    for (let start = open.exec(text); start; start = open.exec(text)) {
        close.lastIndex = start.index + start[0].length;
        const end = close.exec(text);
        if (!end) break;
        out += `${text.slice(from, start.index)} `;
        from = end.index + end[0].length;
        open.lastIndex = from;
    }
    return out + text.slice(from);
}

// 강사가 소리 내어 읽는 글만 남긴다. 코드 블록(mermaid·실행 결과 포함, 닫지 않은 블록은 끝까지)·표·그림·HTML·서식 기호·(⏱ N분)은 빼고,
// 제목·학습 목표·개요·체크리스트의 글과 인라인 코드의 글(문장 안에서 읽는다)은 남긴다.
// 그림·링크·태그 모양은 다음 여는 글자([·(·<)에서 멈춰, 닫지 않은 기호가 아주 많은 글도 길이에 비례해 센다
function spokenText(md) {
    let fence = 0;
    const prose = String(md ?? '').replace(/\r\n/g, '\n').split('\n').filter(line => {
        const wasFenced = fence;
        fence = nextCodeFence(fence, line);
        return !wasFenced && !fence && !SPOKEN_SKIP_LINE.test(line);
    }).join('\n');
    return spokenWithoutSpans(spokenWithoutSpans(prose, /<!--/g, /-->/g), /<table\b/gi, /<\/table>/gi)
        .replace(/!\[[^\[\]]*\]\([^()]*\)/g, ' ')
        .replace(/\[([^\[\]]*)\]\([^()]*\)/g, '$1')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/<[^<>]+>/g, ' ')
        .replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, ' ')
        .replace(/\(⏱[^()]*\)/g, ' ')
        .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, ' ')
        .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)+/gm, '')
        .replace(/\*+|__|~~|`/g, '')
        .replace(SPOKEN_MARKS, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// 낭독 글자 수(공백 포함)와 낭독 시간(분). 분은 내림이다(목표에 못 미친 글이 반올림으로 목표 시간처럼 보이지 않게)
function spokenChars(md) {
    return spokenText(md).length;
}

function readAloudMinutes(md) {
    return Math.floor(spokenChars(md) / READ_CHARS_PER_MINUTE);
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

// 학습 탭은 ## 대주제가 목표보다 많으므로(기본학습·심화학습은 최소 8개) 개수가 같은지가 아니라 목표마다 섹션이 있는지를 본다.
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
    let fence = 0;
    let lastField = '';
    let offset = 0;
    const close = end => {
        if (start !== null) spans.push({ start, end });
        start = null;
    };
    md.split('\n').forEach(line => {
        const next = Math.min(md.length, offset + line.length + 1);
        const field = line.match(LESSON_QUESTION_FIELD);
        const wasFenced = fence;
        fence = nextCodeFence(fence, line);
        if (!wasFenced && !fence && LESSON_QUESTION_HEAD.test(line)) {
            close(offset);
            start = offset;
            lastField = '';
        } else if (!wasFenced && !fence && start !== null) {
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

// 코드 블록은 줄을 그대로 둔다. 구분선이나 필드처럼 보이는 줄도 코드의 일부다.
// 제목만 바꾼 섹션인지 본문으로 판단한다. 제목이 다른 섹션을 같은 섹션으로 볼 때는 항상 이 기준을 쓴다.
const isRenamedSection = (beforeText, afterText) => textSimilarity(beforeText, afterText) >= LESSON_SECTION_RENAME_SIMILARITY;

function parseQuestionFields(lines) {
    const fields = {};
    const stem = [];
    const media = [];
    const choiceLines = [];
    let current = null;
    let label = null;
    let fence = 0;
    const addLine = line => (current ? fields[current].push(line) : stem.push(line));
    lines.forEach(raw => {
        const wasFenced = fence;
        fence = nextCodeFence(fence, raw);
        if (wasFenced || fence) return addLine(raw);
        const found = raw.match(LESSON_QUESTION_LABEL);
        if (found || /^\s*---\s*$/.test(raw)) {
            label = label || found;
            return;
        }
        const line = raw.replace(LESSON_INLINE_SPAN, '');
        const field = line.match(LESSON_QUESTION_FIELD);
        if (LESSON_HTML_BLOCK.test(line)) media.push(line.trim());
        else if (field) {
            current = LESSON_QUESTION_FIELD_KEYS[field[1]];
            fields[current] = [field[2].trim()];
        } else if (!current && /^\s*[①-⑩]/.test(line)) choiceLines.push(line);
        else addLine(line);
    });
    const joined = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.join('\n').trim()]));
    return { fields: joined, stem: stem.join('\n').trim(), media, choiceLines, label };
}

// 시작 코드는 코드 블록으로 저장한다. 펜스 없이 쓴 값은 코드 그대로 받는다.
function splitCodeField(value) {
    const text = String(value || '');
    const match = text.match(/^(`{3,})([^\n`]*)\n([\s\S]*?)\n?\1\s*$/);
    return match ? { code: match[3], lang: match[2].trim() } : { code: text, lang: '' };
}

// "### 문제 N. 제목" 블록을 문항 객체로 읽는다. 보기는 한 줄에 몰아 써도 나눠서 센다.
function parseQuestionBlock(block) {
    const [titleLine, ...lines] = block.trim().split('\n');
    const heading = titleLine.replace(/^#+\s*/, '').trim();
    const { fields, stem, media, choiceLines, label } = parseQuestionFields(lines);
    const choices = choiceLines.flatMap(line => line.trim().split(/\s+(?=[①-⑩]\s)/))
        .map(part => ({ mark: part[0], text: part.slice(1).trim() }));
    const { code, lang } = splitCodeField(fields.code);
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
        code,
        lang,
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
        texts.some(text => !text.trim()) && '빈 보기를 두지 않습니다.',
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
    if (q.type === '서술형') return [!q.rubric && '채점 기준을 작성합니다.', !!q.rubric && !/\d/.test(q.rubric) && '채점 요소마다 점수를 적습니다.'];
    if (q.type === '코드제출') return [!q.tests && '기대 출력이나 테스트 케이스를 작성합니다.'];
    if (q.type === '파일제출') return [!q.rubric && '채점 루브릭을 작성합니다.'];
    return [];
}

// objectiveCount: 차시의 학습 목표 수. 알 수 없으면 번호 범위는 보지 않는다
function lintQuestion(q, checklist = [], objectiveCount = Infinity) {
    const text = `${q.title} ${q.stem}`.trim();
    return [
        !text && '문항 내용을 작성합니다.',
        (!q.objective || !q.band) && '문제마다 학습 목표와 밴드를 표기합니다.',
        q.objective > objectiveCount && '대응하는 학습 목표가 없습니다.',
        q.typed && q.band && !QUESTION_BAND_TYPES[q.band].includes(q.type) && `${q.band} 밴드에는 ${QUESTION_BAND_TYPES[q.band].join('·')} 유형을 씁니다.`,
        ...lintQuestionByType(q),
        checklist.some(item => textSimilarity(item, text) > LESSON_LINT_SIMILAR_TEXT) && '체크리스트 문장을 그대로 쓰지 않습니다.',
        LESSON_LINT_QUESTION_VERSION.test(`${q.stem} ${q.choices.map(choice => choice.text).join(' ')}`) && '버전에 의존하는 정보를 쓰지 않습니다.',
        LESSON_LINT_QUESTION_ADDRESS.test(q.stem) && '학습자를 호칭하지 않습니다.',
        q.review.startsWith('수정 필요') && `AI 교차 검수: ${q.review}`
    ].filter(Boolean);
}

// 차시 목록 배지에 쓴다. 탭마다 검사해 원본 규칙표의 필수 규칙 위반만 센다.
// 코드 블록 주석은 세지 않는다. 큰 탭에서는 주석 점검에 시간이 걸려 사이드바를 그릴 때마다 모든 차시를 보지 않는다
function lessonRequiredIssues(mod) {
    const tabs = Object.values(mod.tabContents || {}).filter(Boolean);
    return (tabs.length ? tabs : [mod.content].filter(Boolean))
        .flatMap(md => lintLessonMarkdown(md, undefined, { codeComments: false }))
        .filter(issue => LESSON_LINT_REQUIRED.test(issue.msg));
}

const isQuestionWarning = msg => LESSON_QUESTION_WARNINGS.includes(msg) || msg.startsWith('AI 교차 검수');

function lintQuestionBlock(block, checklist, objectiveCount = Infinity) {
    const question = parseQuestionBlock(block);
    return lintQuestion(question, checklist, objectiveCount).map(msg => ({
        sev: isQuestionWarning(msg) ? 'warn' : 'bad',
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

// 학습이해도는 차시의 모든 학습 목표를 1문제 이상 묻는다. 목표 수를 알 때만 본다.
// 빠진 목표는 섹션 단위 AI 수정으로 채울 수 없어 권장으로 알리고, 문제은행에서 그 목표로 문항을 만들어 채운다.
function lintObjectiveCoverage(source, objectiveCount) {
    if (!objectiveCount) return [];
    const asked = new Set(lessonLintQuestions(source).map(block => parseQuestionBlock(block).objective).filter(Boolean));
    if (!asked.size) return []; // 문항이 없거나 목표 표기가 없으면 문항 검사가 따로 지적한다
    const missing = Array.from({ length: objectiveCount }, (_, i) => i + 1).filter(no => !asked.has(no));
    return missing.length ? [{ sev: 'warn', where: '학습 목표 대응', msg: '모든 학습 목표를 1문제 이상 묻습니다.', snip: `묻지 않은 학습 목표 ${missing.join(', ')}` }] : [];
}

/* ---------- 코드 예제 ---------- */
// 코드를 다루는 차시를 알아보는 말. 영어 이름은 다른 영문자에 붙어 있으면 보지 않는다(GitHub의 Git 등)
const LESSON_CODE_TOPIC = new RegExp([
    '코딩|프로그래밍|소스\\s*코드|코드\\s*(?:작성|구현|예제)|스크립트\\s*(?:작성|언어)|스크립팅|알고리즘|자료\\s*구조',
    '함수\\s*(?:작성|정의|호출)|반복문|조건문|객체\\s*지향|쿼리|정규\\s*표현식|API\\s*(?:호출|연동|개발)|명령어|터미널|셸',
    '파이썬|자바스크립트|타입스크립트|코틀린|블루프린트',
    '(?<![A-Za-z])(?:Python|JavaScript|TypeScript|Java|Kotlin|Swift|Rust|Ruby|PHP|SQL|HTML|CSS|C\\+\\+|C#|Lua|mLua|GDScript|Bash|PowerShell|React|Vue|Node\\.js|Django|Flask|Spring|Unity|Unreal|Git|Docker|Linux|JSON|YAML)(?![A-Za-z])'
].join('|'), 'i');
// 코드 같은 인라인 코드(영문·숫자·기호가 든 것)와 코드를 설명하는 말. g 정규식이므로 match로만 센다
const LESSON_CODE_SPAN = /`[^`\n]*[\w(){}[\]=<>;:.+\-*/%!&|$#'"][^`\n]*`/g;
const LESSON_CODE_TALK = /함수|변수|반복문|조건문|클래스|메서드|자료형|배열|문자열|딕셔너리|인스턴스|반환\s*값|코드|스크립트|쿼리|명령어|컴파일|디버깅|문법|주석|라이브러리|API/g;
const LESSON_CODE_SIGNAL = new RegExp(`${LESSON_CODE_SPAN.source}|${LESSON_CODE_TALK.source}`); // 지적에 보일 첫 근거 하나
// 예제로 세지 않는 코드 블록: 다이어그램, 실행 결과, 문서 예시
const LESSON_NON_CODE_FENCES = new Set(['mermaid', 'text', 'txt', 'plaintext', 'output', 'console', 'md', 'markdown']);

// 코드를 다루는 차시인지. 제목·설명·핵심 개념·학습 목표·사용 툴 이름을 보고, 교안에 코드 블록이 이미 있어도 그렇게 본다
function lessonCodeTopic(mod) {
    if (!mod) return false;
    const list = value => (Array.isArray(value) ? value : []);
    const tools = typeof lessonTools === 'function' && typeof globalState !== 'undefined' && globalState ? lessonTools(mod) : mod.tools;
    const text = [mod.title, mod.description, ...list(mod.keyConcepts), ...list(mod.objectives), ...list(tools).map(tool => tool?.name ?? tool)]
        .filter(value => typeof value === 'string').join(' ');
    return LESSON_CODE_TOPIC.test(text) || (typeof lessonCodeTags === 'function' && lessonCodeTags(mod).length > 0);
}

// 코드 블록 밖의 글이 코드를 설명하는지: 코드 같은 인라인 코드 2개, 인라인 코드 1개와 코드 말 1개, 또는 코드 말 3개
function lessonCodeSignals(text) {
    const prose = lessonLintText(text, { keepInlineCode: true });
    const spans = (prose.match(LESSON_CODE_SPAN) || []).length;
    const talk = (prose.replace(LESSON_CODE_SPAN, ' ').match(LESSON_CODE_TALK) || []).length;
    return spans >= 2 || (spans >= 1 && talk >= 1) || talk >= 3;
}

// 코드 블록 목록: 언어(소문자), 여는 줄, 첫 코드 줄, 닫혔는지
function lessonFences(text) {
    const fences = [];
    let fence = 0;
    String(text || '').split('\n').forEach(line => {
        const wasFenced = fence;
        fence = nextCodeFence(fence, line);
        const last = fences[fences.length - 1];
        if (!wasFenced && fence) fences.push({ lang: ((line.match(/^\s*`{3,}\s*([^\s`]*)/) || [])[1] || '').toLowerCase(), line: line.trim(), code: '', closed: false });
        else if (wasFenced && !fence) last.closed = true;
        else if (wasFenced && !last.code && line.trim()) last.code = line.trim().slice(0, 40);
    });
    return fences;
}

const isCodeExampleFence = fence => !LESSON_NON_CODE_FENCES.has(fence.lang);

// 실행 결과·다이어그램·문서 예시가 아닌 코드 블록이 있으면 예제가 있다고 본다
function lessonHasCodeExample(text) {
    return lessonFences(text).some(isCodeExampleFence);
}

// ## 기준으로 나누되 코드 블록은 그대로 둔다(lessonLintSections는 코드 블록을 지운다). 코드 블록 안의 ## 은 제목이 아니다
function lessonCodeSections(md) {
    const sections = [{ title: '', lines: [] }];
    let fence = 0;
    String(md || '').split('\n').forEach(line => {
        const wasFenced = fence;
        fence = nextCodeFence(fence, line);
        const heading = !wasFenced && !fence && line.match(/^##\s+(.*)/);
        if (heading) sections.push({ title: heading[1].trim(), lines: [line] });
        else sections[sections.length - 1].lines.push(line);
    });
    return sections.map(section => ({ title: section.title, text: section.lines.join('\n') })).filter(section => section.title || section.text.trim());
}

function codeSignalSnip(text) {
    const prose = lessonLintText(text.replace(/^##\s.*$/m, ' '), { keepInlineCode: true });
    const hit = LESSON_CODE_SIGNAL.exec(prose);
    return hit ? prose.slice(Math.max(0, hit.index - 12), hit.index + hit[0].length + 10).replace(/\s+/g, ' ').trim() : '';
}

// 코드를 다루는 차시에서만 본다: 코드를 설명하는 내용 섹션에 예제가 없음(학습이해도·심화이해도 제외), 언어를 적지 않은 코드 블록, 닫지 않은 코드 블록
function lintCodeExamples(source, tabId, codeTopic) {
    if (!codeTopic) return [];
    return lessonCodeSections(source).flatMap(section => {
        const where = section.title || '본문';
        const fences = lessonFences(section.text);
        const content = !!section.title && !LESSON_FRAME_TITLE.test(section.title) && !LESSON_OVERVIEW_TITLE.test(section.title);
        const missing = !LESSON_BANK_TABS.includes(tabId) && content && !fences.some(isCodeExampleFence) && lessonCodeSignals(section.text);
        return [
            missing && { sev: 'warn', where, msg: LESSON_CODE_EXAMPLE_MSG, snip: codeSignalSnip(section.text) },
            ...fences.filter(fence => !fence.lang).map(fence => ({ sev: 'warn', where, msg: '코드 블록에 언어를 적습니다.', snip: fence.code || fence.line })),
            ...fences.filter(fence => !fence.closed).map(fence => ({ sev: 'warn', where, msg: '닫히지 않은 코드 블록이 있습니다.', snip: fence.code || fence.line }))
        ].filter(Boolean);
    });
}

// 코드 블록 주석(code-comments.js codeCommentIssues): 모든 탭에서, 코드를 다루는 차시가 아니어도 본다. 실행 결과·json·mermaid 블록은 모듈이 뺀다.
// 주석이 모자란 블록은 필수(bad)이고, 이름표를 몰라 세지 못한 블록은 정보(info)다. 지적에는 codeComment: true를 붙인다.
// 섹션을 통째로 고쳐 쓰는 자동 수정은 코드를 바꿀 수 있어 이 지적을 고치지 않고, 코드는 그대로 두고 주석만 더하는 도구(codeCommentRun)가 고친다.
// code-comments.js 없이 이 파일만 실으면(시험 등) 보지 않는다. 점검이 던지면 콘솔에 남기고 이번 검수에서만 뺀다(검수 창·배지 그리기를 멈추지 않는다)
function lintCodeComments(source) {
    if (typeof codeCommentIssues !== 'function') return [];
    let issues;
    try {
        issues = codeCommentIssues(source, { sev: 'bad' });
    } catch (err) {
        console.warn('코드 블록 주석 점검에 실패해 이번 검수에서 뺍니다.', err);
        return [];
    }
    return issues.map(issue => ({
        sev: issue.sev,
        where: issue.where,
        msg: issue.msg,
        snip: Number.isFinite(issue.need)
            ? [issue.snip, `코드 ${issue.codeLines}줄에 주석 ${issue.comments}개(${issue.need}개 필요)`].filter(Boolean).join(' · ')
            : issue.snip,
        codeComment: true
    }));
}

// tabId를 주면 그 탭의 구조까지 검사한다. 지적은 { sev, where, msg, snip, missing, codeComment } 형식이다. missing은 없는 섹션을 새로 써야 한다는 뜻이고,
// codeComment는 코드 블록 주석 지적이라는 뜻이다(lintCodeComments).
// context.objectiveCount: 그 갈래의 학습 목표 수(qbankObjectives). 주면 문제은행 탭(학습이해도·심화이해도)의 목표 대응과 번호 범위를 검사한다.
// context.codeTopic: 코드를 다루는 차시(lessonCodeTopic)면 코드 예제 규칙도 검사한다.
// context.codeComments: false면 코드 블록 주석을 보지 않는다(기본은 모든 탭에서 본다)
function lintLessonMarkdown(md, tabId, { objectiveCount = 0, codeTopic = false, codeComments = true } = {}) {
    const source = String(md || '').replace(/\r\n/g, '\n');
    const goals = lessonLintBullets(source, '학습\\s*목표');
    const checks = lessonLintBullets(source, '학습\\s*후\\s*체크리스트');
    return [
        ...(LESSON_STRUCTURED_TABS.includes(tabId) ? lintLessonStructure(source, goals, checks) : []),
        ...lintObjectiveBullets(goals),
        ...lintChecklistBullets(goals, checks),
        ...lessonLintQuestions(source).flatMap(block => lintQuestionBlock(block, checks, objectiveCount || Infinity)),
        ...(LESSON_BANK_TABS.includes(tabId) ? lintObjectiveCoverage(source, objectiveCount) : []),
        ...lessonLintSections(source).flatMap(section => lintLessonPhrases(section.text, section.title)),
        ...lintCodeExamples(source, tabId, codeTopic),
        ...(codeComments ? lintCodeComments(source) : [])
    ];
}
