// course-qbank.js - 차시 문제은행: 갈래(data.js LESSON_TRACKS)마다 문제은행 탭의 마크다운을 문항 단위로 관리한다
// 기본학습 갈래는 학습이해도 탭(tabContents.assessment), 심화학습 갈래는 심화이해도 탭(tabContents.advAssessment)이고 저장 형식은 같다.
// develocket-slide(assets/course-qbank.js, course-rules.js @3a7303f)의 분포·검수·CSV·문항 생성을 옮겼다.
// 원본은 마크다운 그대로 두고 문항만 읽고 고쳐 쓴다. 갈래(trackId)를 주지 않으면 기본학습 문제은행을 본다.

const QBANK_BANDS = {
    L1: { name: '수업과 같은 상황', desc: '수업에서 다룬 상황을 그대로 묻습니다. 배운 내용을 기억하고 있는지 확인합니다.', recommend: 10 },
    L2: { name: '같은 구조, 다른 맥락', desc: '배운 구조를 다른 상황에 적용하게 합니다. 원리를 옮겨 쓸 수 있는지 확인합니다.', recommend: 5 },
    L3: { name: '요구사항만 제시', desc: '해결할 요구사항만 주고 방법은 주지 않습니다. 배운 내용으로 스스로 구현할 수 있는지 확인합니다.', recommend: 3 }
};
const QBANK_BAND_L4 = { band: 'L4', name: '목표만 제시', desc: '최종 목표만 주고 수행 능력 전체를 평가합니다. 문제은행이 아니라 과정의 프로젝트에서 다룹니다.', types: '프로젝트에서 다룸 · 문제은행에 만들지 않음' };
const QBANK_BAND_INTRO = '밴드는 문항이 학습자에게 얼마나 많은 것을 스스로 하도록 요구하는지를 나타내는 단계입니다. 숫자가 클수록 주어지는 정보가 적습니다. 모든 문항에 학습 목표와 밴드를 함께 붙여 두면, 오답률이 높을 때 어느 목표의 어느 수준이 무너졌는지 찾을 수 있습니다.';
const QBANK_COUNTS = [1, 2, 3, 5, 8, 10];
const QBANK_LESSON_CHARS = 6000;   // 문항 생성에 보내는 교안 원고 상한
const QBANK_SECTION_CHARS = 4000;  // 그 학습 목표의 내용 섹션 원고 상한
const QBANK_PRACTICE_CHARS = 1500; // 이어 붙이는 실습 탭 앞부분
const QBANK_MAX_FLAGGED = 20;
const QBANK_FLASH_MS = 1600;
const QBANK_CHOICE_MARKS = '①②③④⑤⑥⑦⑧⑨⑩';
const QBANK_TYPE_FORMATS = {
    객관식: '보기는 ①~⑤로 쓰고, "✅ **정답:** ②"로 정답을 표기합니다. 복수 정답이면 제목 끝에 (복수정답)을 붙이고 문항에 「모두 고르시오」를 밝힙니다.',
    단답식: '"✅ **정답:** 값" 다음 줄에 "🔤 **허용 표기:** 대소문자·띄어쓰기 변형"을 적습니다. 정답은 단어나 값 하나로 확정되어야 합니다.',
    서술형: '"✅ **정답:** 모범 답안" 다음 줄에 "📏 **채점 기준:** 요소 (점수); 요소 (점수)"를 적습니다.',
    코드제출: '시작 코드가 필요하면 "🧩 **시작 코드:**" 다음 줄에 코드 블록으로 적고, 학습자가 채울 자리마다 무엇을 채울지 한국어 주석으로 적습니다(정답 코드는 주석에 적지 않습니다). "🧪 **테스트:** 입력과 기대 출력"을 적습니다.',
    파일제출: '"📏 **채점 기준:** 평가 기준 — 충족/부분/미흡 조건과 점수"를 관찰 가능한 기준으로 적습니다.'
};
// 교안 코드 블록의 언어 표기를 화면에 쓰는 이름으로 바꾼다 (course-rules.js @3a7303f)
const QBANK_LANG_NAMES = {
    cs: 'C#', csharp: 'C#', 'c#': 'C#', cpp: 'C++', 'c++': 'C++', c: 'C', py: 'Python', python: 'Python', js: 'JavaScript', javascript: 'JavaScript',
    ts: 'TypeScript', typescript: 'TypeScript', lua: 'Lua', java: 'Java', kotlin: 'Kotlin', swift: 'Swift', go: 'Go', rust: 'Rust', sql: 'SQL', json: 'JSON',
    yaml: 'YAML', bash: 'Bash', sh: 'Bash', powershell: 'PowerShell', html: 'HTML', css: 'CSS', mlua: 'mLua', gdscript: 'GDScript'
};
const QBANK_NON_CODE_TAGS = new Set(['md', 'markdown', 'mermaid', 'text', 'txt', 'plaintext']);
const QBANK_RULES = [
    '[문제은행 규칙 — 콘텐츠 업무 설계]',
    '- 모든 문항은 어느 학습 목표를 묻는지와 밴드를 가집니다.',
    '- L1은 수업과 같은 상황, L2는 같은 구조를 다른 맥락에 적용, L3는 요구사항만 제시합니다.',
    '- 체크리스트 문장을 그대로 문항으로 쓰지 않습니다. 문항은 구체적 상황에서의 판단을 묻습니다.',
    '- 버전에 의존하는 정보(툴 버전 번호, 단축키, 메뉴 위치)를 문항에 담지 않습니다.',
    '- 경어체로 쓰고 학습자를 호칭하지 않습니다.',
    '- 문항 속 코드에도 한국어 주석을 넣습니다. 주석은 코드가 무엇을 하는지만 적고 정답, 출력 결과, 고칠 곳을 알려 주지 않습니다.'
].join('\n');

const QBANK_RULE_LIST = [
    '공통: 문항 내용 작성, 학습 목표 연결, 밴드에 맞는 유형 사용, 체크리스트 문장 재사용 금지, 버전 정보 금지, 학습자 호칭 금지',
    '객관식: 정답 지정, 같은 보기 금지, 보기 4개 이상, 단일 선택은 정답 하나, 복수 정답은 정답 2개 이상과 오답 포함',
    '단답식: 정답 작성, 정답은 단어나 값 하나',
    '서술형: 요소별 채점 기준 작성',
    '코드제출: 기대 출력이나 테스트 케이스 작성',
    '파일제출: 관찰 가능한 기준과 충족·부분·미흡 조건의 루브릭 작성'
];

let _qbank = null;

const qbankMod = () => getEditingModule(_qbank?.moduleId);
const uniqueTexts = items => [...new Set(items)];
const qbankTrackId = () => lessonTrack(_qbank?.track).id; // 열어 둔 문제은행의 갈래
const qbankBankLabel = trackId => LESSON_TABS.find(tab => tab.id === lessonTrack(trackId).bank)?.label || '학습이해도'; // 학습이해도 | 심화이해도

function qbankMarkdown(mod, trackId = 'basic') {
    return String(mod.tabContents?.[lessonTrack(trackId).bank] || '').replace(/\r\n/g, '\n');
}

function qbankQuestions(mod, trackId = 'basic') {
    return lessonLintQuestions(qbankMarkdown(mod, trackId)).map(parseQuestionBlock);
}

// 탭 글의 불릿. trackId를 주면 그 갈래의 학습·실습 탭만, 주지 않으면 모든 탭(차시 전체)
function qbankTabBullets(mod, title, trackId = null) {
    const track = trackId ? lessonTrack(trackId) : null;
    const texts = track ? [mod.tabContents?.[track.learn], mod.tabContents?.[track.practice]] : Object.values(mod.tabContents || {});
    return texts.flatMap(md => (md ? lessonLintBullets(String(md).replace(/\r\n/g, '\n'), title) : []));
}

// 그 갈래의 학습 목표. trackId를 주면 그 갈래의 학습·실습 탭에 적힌 목표, 없으면 과정 설계의 목표다(다른 갈래 탭의 목표는 쓰지 않는다.
// 심화학습 탭이 비었을 때 심화이해도에 기본학습 목표가 섞이지 않게). 주지 않으면 차시 전체 탭의 목표, 없으면 과정 설계의 목표(NCS 배정·교육 자료가 쓴다).
// 새로 만드는 문항·탭은 이 목록으로 만든다. 갈래를 나누기 전의 학습이해도 번호는 qbankLegacyObjectives가 따로 읽는다
function qbankTrackObjectives(mod, trackId = null) {
    const listed = uniqueTexts(trackId ? qbankTabBullets(mod, '학습\\s*목표', trackId) : qbankTabBullets(mod, '학습\\s*목표'));
    return listed.length ? listed : (mod.objectives || []);
}

// 갈래를 나누기 전에 만든 학습이해도는 차시 전체 탭의 목표를 이어 센 번호를 쓴다.
// 기본학습 목표 수보다 큰 번호의 문항이 남아 있으면 그 예전 목록을 돌려준다(아니면 null)
function qbankLegacyObjectives(mod, trackId) {
    if (!trackId || lessonTrack(trackId).id !== LESSON_TRACKS[0].id) return null;
    const own = uniqueTexts(qbankTabBullets(mod, '학습\\s*목표', trackId));
    if (!own.length) return null;
    const highest = Math.max(0, ...qbankQuestions(mod, trackId).map(q => q.objective || 0));
    if (highest <= own.length) return null;
    const all = uniqueTexts(qbankTabBullets(mod, '학습\\s*목표'));
    return all.length > own.length ? all : null;
}

// 학습 목표 목록. 문항의 목표 번호는 이 목록의 순서다(예전 방식의 학습이해도는 예전 번호를 그대로 읽는다)
function qbankObjectives(mod, trackId = null) {
    return qbankLegacyObjectives(mod, trackId) || qbankTrackObjectives(mod, trackId);
}

// 예전 방식의 학습이해도를 보고 있으면 화면에 붙이는 안내(아니면 빈 글)
function qbankLegacyNote(mod, trackId) {
    if (!qbankLegacyObjectives(mod, trackId)) return '';
    return '예전 방식으로 만든 학습이해도에 심화학습 목표 문항이 있습니다. 문항 번호는 예전처럼 차시 전체의 학습 목표 순서를 따릅니다. 학습이해도 탭을 다시 만들면 기본학습 목표만으로 만듭니다.';
}

const qbankChecklist = (mod, trackId = null) => qbankTabBullets(mod, '학습\\s*후\\s*체크리스트', trackId);

// 화면에서 쓰는 문항 검수. 학습 목표를 지운 뒤 남은 번호도 잡는다
function lintBankQuestion(q, checklist) {
    const mod = _qbank ? qbankMod() : null;
    return lintQuestion(q, checklist, (mod && qbankObjectives(mod, qbankTrackId()).length) || Infinity);
}

// 교안 코드 블록의 언어 표기. trackId를 주면 그 갈래의 학습·실습·문제은행 탭(옛 차시의 본문은 기본학습)만 본다
function lessonCodeTags(mod, trackId = null) {
    const track = trackId ? lessonTrack(trackId) : null;
    const legacy = !LESSON_TABS.some(tab => mod.tabContents?.[tab.id]);
    const sources = track
        ? [mod.tabContents?.[track.learn], mod.tabContents?.[track.practice], mod.tabContents?.[track.bank], ...(legacy && track.id === LESSON_TRACKS[0].id ? [mod.content] : [])]
        : [...Object.values(mod.tabContents || {}), mod.content];
    const tags = sources.flatMap(md => [...String(md || '').matchAll(/^[ \t]*```[ \t]*([\w#+.-]+)[ \t]*$/gm)].map(match => match[1].toLowerCase()));
    return uniqueTexts(tags).filter(tag => !QBANK_NON_CODE_TAGS.has(tag));
}

const lessonCodeLangs = (mod, trackId = null) => uniqueTexts(lessonCodeTags(mod, trackId).map(tag => QBANK_LANG_NAMES[tag] || tag));

// 사람이 직접 쓰는 빈 문항. 생성 폼에서 고른 목표·밴드·유형으로 시작한다.
function blankQuestion(spec, mod, trackId = 'basic') {
    return {
        no: 0, title: '', objective: spec.objective, band: spec.band, type: spec.type, typed: true,
        multi: spec.type === '객관식' && !!spec.multi, stem: '', media: '', choices: [], answer: '', accepted: '', hint: '',
        code: '', lang: spec.type === '코드제출' ? (lessonCodeTags(mod, trackId)[0] || '') : '',
        explanation: '', rubric: '', tests: '', review: ''
    };
}

function questionDistribution(questions, objectiveCount) {
    const blank = () => Object.fromEntries(Object.keys(QBANK_BANDS).map(band => [band, 0]));
    const rows = Array.from({ length: objectiveCount }, blank);
    const total = blank();
    questions.forEach(q => {
        if (q.objective && rows[q.objective - 1] && q.band in rows[q.objective - 1]) rows[q.objective - 1][q.band] += 1;
        if (q.band in total) total[q.band] += 1;
    });
    return { rows, total };
}

/* ---------- 마크다운 읽고 쓰기 ---------- */
// 코드 안의 ``` 에 닫히지 않도록 펜스를 더 길게 만든다
function codeFieldLines(q) {
    if (!q.code) return [];
    const longest = Math.max(0, ...(q.code.match(/`+/g) || []).map(run => run.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return ['🧩 **시작 코드:**', '', `${fence}${q.lang || ''}`, q.code, fence, ''];
}

function serializeQuestion(q, no) {
    const label = q.objective && q.band ? `학습 목표 ${q.objective} · 밴드 ${q.band}${q.typed ? ` · ${q.type}` : ''}` : '';
    const field = (mark, name, value) => (value ? [`${mark} **${name}:** ${value}`, ''] : []);
    const answers = q.answer.match(LESSON_LINT_CHOICE_MARK) || [];
    const choiceLine = choice => {
        const text = `${choice.mark} ${choice.text}`;
        return answers.includes(choice.mark) ? `<span style="${QUESTION_ANSWER_STYLE}">${text}</span>` : text;
    };
    const fields = [
        ...field('💡', '힌트', q.hint), ...codeFieldLines(q), ...field('✅', '정답', q.answer), ...field('🔤', '허용 표기', q.accepted),
        ...field('📝', '해설', q.explanation), ...field('📏', '채점 기준', q.rubric), ...field('🧪', '테스트', q.tests), ...field('🔍', '교차 검수', q.review)
    ];
    return [
        `### 문제 ${no}. ${q.title}${q.multi ? ' (복수정답)' : ''}`,
        ...(label ? [label] : []), '',
        ...(q.media ? [q.media, ''] : []),
        ...(q.stem ? [q.stem, ''] : []),
        ...(q.choices.length ? [...q.choices.map(choiceLine), ''] : []),
        // 필드가 하나도 없으면 뒤따르는 구분선이 문항 끝으로 읽히지 않으므로 빈 정답 칸을 남긴다
        ...(fields.length ? fields : ['✅ **정답:**', '']),
        '---'
    ].join('\n');
}

function replaceSpan(md, span, text) {
    return `${md.slice(0, span.start)}${text}${md.slice(span.end)}`;
}

// 코드 블록 안의 "### 문제 N" 줄은 번호를 매기지 않는다. 자릿수가 바뀌어도 앞 위치가 밀리지 않게 뒤에서부터 고친다.
function renumberQuestions(md) {
    return lessonQuestionSpans(md).reduceRight((text, span, index) => {
        const rest = text.slice(span.start).replace(/^(###\s*문제\s*)\d+/, (all, prefix) => `${prefix}${index + 1}`);
        return `${text.slice(0, span.start)}${rest}`;
    }, md);
}

function updateQuestionMd(md, index, question) {
    return replaceSpan(md, lessonQuestionSpans(md)[index], `${serializeQuestion(question, index + 1)}\n\n`);
}

function removeQuestionMd(md, index) {
    return renumberQuestions(replaceSpan(md, lessonQuestionSpans(md)[index], ''));
}

function appendQuestionsMd(md, questions) {
    const spans = lessonQuestionSpans(md);
    const offset = spans.length;
    const body = questions.map((q, i) => serializeQuestion(q, offset + i + 1)).join('\n\n');
    if (!spans.length) return [md.trim(), body].filter(Boolean).join('\n\n') + '\n';
    const end = spans.at(-1).end;
    return `${md.slice(0, end).trimEnd()}\n\n${body}\n\n${md.slice(end)}`;
}

/* ---------- CSV ---------- */
// 스프레드시트 수식으로 실행되지 않게 막는다. 보기와 정답 칸은 '-1'이나 '='도 맞는 값이고 따옴표가 붙으면 LMS 채점이 틀리므로
// 실행될 수 있는 수식(함수 호출, 외부 참조)만 막는다. 코드 칸(code: 시작코드·테스트케이스)은 한 글자도 바뀌면 안 되므로 정답 칸처럼 다루고,
// 첫 줄이 SQL·Lua 주석(-- 뒤 공백, 코드 주석 규칙대로 첫 줄 위에 단 주석)인 코드는 외부 참조(|)가 없으면 함수 호출이 있어도 막지 않는다
function csvCell(value, { answer = false, code = false } = {}) {
    const text = String(value ?? '');
    const commentFirst = code && /^--[ \t]/.test(text) && !text.includes('|');
    const formula = /^[=+\-@]/.test(text) && !commentFirst && (!(answer || code) || /[(|!]/.test(text));
    const safe = formula ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// 열은 LMS 업로드에 쓰는 develocket-slide(assets/course-model.js questionsToCsv @3a7303f)와 같다. 단원은 교과, 학습모듈은 차시다
const QBANK_CSV_HEAD = ['문항ID', '단원', '학습모듈', '목표번호', '학습목표', '밴드', '유형', '복수정답', '문항', '보기1', '보기2', '보기3', '보기4', '보기5', '정답', '허용표기', '모범답안', '채점기준', '시작코드', '테스트케이스', '루브릭', '해설', '검수'];
const QBANK_CSV_ANSWER_HEADS = ['보기1', '보기2', '보기3', '보기4', '보기5', '정답', '허용표기'];
const QBANK_CSV_CODE_HEADS = ['시작코드', '테스트케이스'];
const QBANK_CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

function choiceNumbers(answer) {
    const marks = String(answer || '').match(/[①-⑩]/g);
    return marks ? marks.map(mark => QBANK_CIRCLED.indexOf(mark) + 1).join(', ') : answer;
}

// 객관식 정답은 보기 번호로 쓴다. 모범답안은 서술형, 루브릭은 파일제출 칸에 넣고, 코드제출의 채점 기준도 버리지 않는다
function questionCsvAnswers(q) {
    const written = ['서술형', '파일제출'].includes(q.type);
    return {
        answer: written ? '' : (q.type === '객관식' ? choiceNumbers(q.answer) : q.answer),
        model: q.type === '서술형' ? q.answer : '',
        criteria: q.type === '파일제출' ? '' : q.rubric,
        rubric: q.type === '파일제출' ? q.rubric : ''
    };
}

function questionCsvStatus(issues) {
    if (!issues.length) return '검수 통과';
    return issues.every(isQuestionWarning) ? '권장 위반' : '필수 위반';
}

function questionCsvRows(questions, objectives, context) {
    return questions.map(q => {
        const issues = lintQuestion(q, context.checklist, objectives.length || Infinity);
        const { answer, model, criteria, rubric } = questionCsvAnswers(q);
        return [
            [context.lessonId, q.no].filter(Boolean).join('-'), context.subject, context.lesson, q.objective ?? '', (q.objective && objectives[q.objective - 1]) || '', q.band, q.type, q.multi ? 'Y' : '', [q.title, q.stem].filter(Boolean).join('\n'),
            ...Array.from({ length: 5 }, (_, i) => q.choices[i]?.text ?? ''), answer, String(q.accepted || '').split(/\n|,\s*/).filter(Boolean).join(' / '), model, criteria, q.code, q.tests, rubric, q.explanation, questionCsvStatus(issues)
        ];
    });
}

const csvRow = row => row.map((cell, index) => csvCell(cell, { answer: QBANK_CSV_ANSWER_HEADS.includes(QBANK_CSV_HEAD[index]), code: QBANK_CSV_CODE_HEADS.includes(QBANK_CSV_HEAD[index]) })).join(',');
const toCsv = rows => `\uFEFF${[QBANK_CSV_HEAD, ...rows].map(csvRow).join('\r\n')}`;

function questionsCsv(questions, objectives, context) {
    return toCsv(questionCsvRows(questions, objectives, context));
}

// CSV 한 차시·갈래의 칸 값. 갈래는 학습모듈 칸에 '차시 · 기본학습/심화학습'으로 보이고, 심화학습 문항ID는 '차시 id-adv-번호'다(두 문제은행을 한 파일에 담아도 겹치지 않게)
function qbankCsvContext(subject, lesson, trackId) {
    const track = lessonTrack(trackId);
    const basic = track.id === LESSON_TRACKS[0].id;
    return { subject: subject?.title || '', lesson: `${lesson.title} · ${track.label}`, lessonId: basic ? lesson.id : `${lesson.id}-${track.id}`, checklist: qbankChecklist(lesson, track.id) };
}

function lessonBankCsvRows(subject, lesson, trackId) {
    return questionCsvRows(qbankQuestions(lesson, trackId), qbankObjectives(lesson, trackId), qbankCsvContext(subject, lesson, trackId));
}

// 교과 CSV: 차시마다 기본학습 문제은행 다음에 심화학습 문제은행(문항이 든 탭만)
function subjectCsvRows(subject) {
    return subjectLessons(subject).flatMap(lesson => LESSON_TRACKS.flatMap(track => (lesson.tabContents?.[track.bank] ? lessonBankCsvRows(subject, lesson, track.id) : [])));
}

function subjectQuestionsCsv(subject) {
    const rows = subjectCsvRows(subject);
    return { rows: rows.length, csv: toCsv(rows) };
}

function courseQuestionsCsv() {
    const rows = globalState.subjects.flatMap(subject => subjectCsvRows(subject));
    return { rows: rows.length, csv: toCsv(rows) };
}

/* ---------- AI 문항 생성 ---------- */
function qbankCodeRule(mod, type, trackId = 'basic') {
    const langs = lessonCodeLangs(mod, trackId);
    if (langs.length) return `학습내용에 쓰인 언어(${langs.join(', ')})를 그대로 사용합니다.`;
    const tools = (mod.tools || []).map(toolLabel).join(', ') || '없음';
    const pick = type === '코드제출' ? ' 코드제출 유형이므로 학습내용과 사용 툴에 맞는 언어 하나를 골라 문항 첫 줄에 언어를 밝힙니다.' : '';
    return `학습내용에 코드가 없습니다. 사용 툴(${tools})과 학습내용을 보고 코드가 꼭 필요한 경우에만 쓰고, 그렇지 않으면 코드 없이 출제합니다.${pick}`;
}

function qbankChoiceRule(spec) {
    if (spec.type !== '객관식') return '';
    return spec.multi ? '[정답 수] 정답 2개 이상, 오답 1개 이상이며 문항에 「모두 고르시오」를 밝힙니다.' : '[정답 수] 정답이 될 수 있는 보기는 정확히 하나입니다.';
}

// 그 학습 목표의 내용 섹션: 학습 탭 체크리스트의 '다시 보기'가 가리키는 섹션부터 다음 목표의 섹션 앞까지(lesson-objectives.js objectiveContentRange).
// 그 탭의 목표 목록에서 목표 글로 찾는다(예전 방식 학습이해도의 번호와 섞이지 않게). 찾지 못하면 ''
function qbankObjectiveSection(learn, goal) {
    if (!goal || typeof objectiveContentRange !== 'function' || typeof mdSections !== 'function') return '';
    const index = lessonLintBullets(learn, '학습\\s*목표').indexOf(goal);
    if (index < 0) return '';
    const sections = mdSections(learn);
    return objectiveContentRange(learn, index).map(item => sections[item.index]?.text || '').filter(Boolean).join('\n\n');
}

// 문항을 만들 교안 원고: 그 갈래의 학습 탭에서 그 목표의 섹션(4,000자까지, 찾지 못하면 학습 탭 앞부분), 이어서 실습 탭 앞부분(1,500자). 모두 6,000자까지.
// 480분 학습 탭은 12만 자쯤이라 앞부분만 보내면 뒤쪽 목표의 섹션과 실습 탭이 빠진다. 탭 글이 하나도 없는 옛 차시의 본문은 기본학습 갈래의 원고다.
// goal: 문항을 만들 학습 목표 글(주지 않으면 학습 탭 앞부분)
function qbankLessonSource(mod, trackId = 'basic', goal = '') {
    const track = lessonTrack(trackId);
    const legacy = track.id === LESSON_TRACKS[0].id && !LESSON_TABS.some(tab => mod.tabContents?.[tab.id]) ? mod.content : '';
    const learn = String(mod.tabContents?.[track.learn] || legacy || '').replace(/\r\n/g, '\n');
    const practice = String(mod.tabContents?.[track.practice] || '').replace(/\r\n/g, '\n').slice(0, QBANK_PRACTICE_CHARS);
    const section = qbankObjectiveSection(learn, goal).slice(0, QBANK_SECTION_CHARS);
    return [(section || learn).slice(0, QBANK_LESSON_CHARS - practice.length), practice].filter(Boolean).join('\n\n');
}

function buildQuestionPrompt(mod, spec, objectives, questions, trackId = 'basic') {
    const source = qbankLessonSource(mod, trackId, objectives[spec.objective - 1]);
    return [
        `아래 차시의 문제은행 문항을 ${spec.count}개 만드세요.`, '', QBANK_RULES, '',
        `[학습 목표 ${spec.objective}] ${objectives[spec.objective - 1] || mod.title}`,
        `[밴드] ${spec.band} — ${QBANK_BANDS[spec.band].name}`, `[유형] ${spec.type}${spec.multi ? ' (복수 정답)' : ''}: ${QBANK_TYPE_FORMATS[spec.type]}`,
        qbankChoiceRule(spec), `[코드] ${qbankCodeRule(mod, spec.type, trackId)}`,
        questions.length ? `[겹치면 안 되는 기존 문항]\n${questions.map(q => `- ${q.title} ${q.stem}`.trim()).join('\n')}` : '',
        source ? `[교안]\n${source}` : '', '',
        '[출력 형식] 문항마다 아래 형식의 마크다운만 출력합니다.',
        `### 문제 1. 제목\n학습 목표 ${spec.objective} · 밴드 ${spec.band} · ${spec.type}\n\n(문항 본문)\n\n📝 **해설:** 해설`
    ].filter(Boolean).join('\n');
}

async function askQuestionModel(prompt) {
    const data = await callGemini(TEXT_MODEL, {
        taskRole: 'qgen',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: '평가 문항 출제 전문가로서 지정된 마크다운 형식만 출력합니다.' }] }
    });
    return extractText(data);
}

const withMultiNotice = stem => (LESSON_LINT_MULTI_NOTICE.test(stem) ? stem : `${stem} (모두 고르시오)`.trim());

// 문항 생성 답의 본문: 답 전체를 감싼 펜스(첫 줄의 펜스와 끝 줄의 펜스, 안쪽 펜스 짝이 맞을 때)만 벗긴다. 앞 펜스가 없는 답 끝의 ```는
// 마지막 문항 해설의 풀이 코드 블록을 닫는 펜스라 남긴다. 감싼 펜스를 닫기 전에 출력 한도로 잘렸으면(뒤 줄의 짝이 맞으면) 여는 줄만 떼고,
// 코드 블록 안에서 끝났으면 닫는다(뒤에 넣는 문항이 코드로 들어가지 않게)
function questionAnswerBody(text) {
    const body = String(text || '').replace(/\r\n/g, '\n').trim();
    const lines = body.split('\n');
    const balanced = list => !list.reduce(nextCodeFence, 0);
    const opened = lines.length > 1 && /^```[\w-]*$/.test(lines[0]);
    const inner = opened && lines.length > 2 && /^```$/.test(lines[lines.length - 1]) && balanced(lines.slice(1, -1)) ? lines.slice(1, -1)
        : opened && balanced(lines.slice(1)) ? lines.slice(1) : lines;
    return closeOpenFence(inner.join('\n'));
}

// 모델이 쓴 태그와 달라도 사용자가 고른 목표·밴드·유형으로 맞춘다
function parseGeneratedQuestions(text, spec) {
    const body = questionAnswerBody(text);
    const multi = spec.type === '객관식' && !!spec.multi;
    return lessonLintQuestions(body)
        .map(parseQuestionBlock)
        .map(q => ({ ...q, objective: spec.objective, band: spec.band, type: spec.type, typed: true, multi, stem: multi ? withMultiNotice(q.stem) : q.stem }));
}

function buildReviewPrompt(mod, questions, objectives) {
    return [
        '당신은 평가 문항 검수자입니다. 다른 출제자가 만든 문항을 아래 기준으로 엄격히 검수하세요.',
        `[차시] ${mod.title}`, `[학습 목표]\n${objectives.map((text, i) => `${i + 1}. ${text}`).join('\n')}`,
        '[기준] 1) 태그한 학습 목표를 실제로 묻는가 2) 밴드 정의에 맞는가(L1 수업과 같은 상황 / L2 같은 구조·다른 맥락 / L3 요구사항만 제시) 3) 정답이 확정되는가 4) 해설과 채점 기준이 정답과 맞는가 5) 문항 속 코드에 주석이 있고 그 주석이 정답, 출력 결과, 고칠 곳을 알려 주지 않는가', '',
        JSON.stringify(questions.map((q, i) => ({ i, objective: q.objective, band: q.band, type: q.type, multi: q.multi, title: q.title, stem: q.stem, code: q.code, choices: q.choices, answer: q.answer, rubric: q.rubric, tests: q.tests, explanation: q.explanation }))), '',
        'JSON 배열만 출력합니다: [{"i": 0, "ok": true, "notes": "문제가 있으면 무엇을 고쳐야 하는지 경어체 1문장, 없으면 빈 문자열"}]'
    ].join('\n');
}

// 두 공급자의 키가 있으면 출제하지 않은 모델이 검수한다. 실패해도 문항은 버리지 않는다.
async function crossReviewQuestions(mod, questions, objectives) {
    const model = crossCheckModel('qgen');
    if (!model) return questions;
    try {
        const data = await callGemini(model, {
            pinModel: true,
            taskRole: 'review',
            contents: [{ role: 'user', parts: [{ text: buildReviewPrompt(mod, questions, objectives) }] }],
            systemInstruction: { parts: [{ text: '평가 문항 검수자로서 지정된 JSON만 출력합니다.' }] },
            generationConfig: { responseMimeType: 'application/json' }
        });
        const parsed = safeJSONParse(extractText(data));
        const rows = Array.isArray(parsed) ? parsed : (parsed?.results || parsed?.items || []);
        const reviews = new Map(rows.map(row => [Number(row.i), row]));
        return questions.map((q, i) => {
            const row = reviews.get(i);
            if (!row) return q;
            const notes = String(row.notes || '').replace(/\s+/g, ' ').trim();
            return { ...q, review: row.ok === false ? `수정 필요 · ${notes} · ${model}` : `통과 · ${model}` };
        });
    } catch (err) {
        console.warn('[문제은행] 교차 검수 실패:', err);
        return questions;
    }
}

// 자동 검수에 걸린 문항은 한 번 더 고쳐 받는다. trackId: 문항을 넣을 갈래(그 갈래의 원고·목표·기존 문항으로 만든다)
// 문항 속 코드에 주석이 모자라면 주석만 더한 뒤(code-comments-tool.js, 정답을 알려 주지 않는 문항 모드) 교차 검수한다. 검수자가 주석까지 본다
async function generateQuestions(mod, spec, trackId = 'basic') {
    const drafted = await draftQuestions(mod, spec, trackId);
    const questions = typeof commentQuestionCode === 'function' ? await commentQuestionCode(drafted) : drafted;
    return crossReviewQuestions(mod, questions, qbankObjectives(mod, trackId));
}

async function draftQuestions(mod, spec, trackId = 'basic') {
    const objectives = qbankObjectives(mod, trackId);
    const existing = qbankQuestions(mod, trackId);
    const checklist = qbankChecklist(mod, trackId);
    const prompt = buildQuestionPrompt(mod, spec, objectives, existing, trackId);
    const draft = await askQuestionModel(prompt);
    const first = parseGeneratedQuestions(draft, spec);
    if (!first.length) throw new Error('문항을 읽지 못했습니다. 다시 생성해주세요.');
    const issues = first.flatMap(q => lintQuestion(q, checklist, objectives.length || Infinity).map(msg => `- ${q.title}: ${msg}`));
    if (!issues.length) return first;
    const repaired = parseGeneratedQuestions(await askQuestionModel(`${prompt}\n\n[초안]\n${draft}\n\n[자동 검수 지적]\n${issues.join('\n')}\n\n지적을 모두 고친 전체 문항을 같은 형식으로 다시 출력합니다.`), spec);
    return repaired.length === first.length ? repaired : first;
}

/* ---------- 화면 ---------- */
function qbankOption(value, label, current) {
    return `<option value="${escapeHtml(String(value))}" ${String(value) === String(current) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function qbankDistributionHtml(questions, objectives) {
    const bands = Object.keys(QBANK_BANDS);
    const { rows, total } = questionDistribution(questions, Math.max(1, objectives.length));
    const body = rows.map((row, i) => `<tr><td class="p-1 text-textLight">${i + 1}. ${escapeHtml(objectives[i] || '(학습 목표 없음)')}</td>${bands.map(band => `<td class="p-1 text-center ${row[band] ? 'text-textLight' : 'text-textMuted'}">${row[band]}</td>`).join('')}</tr>`).join('');
    const foot = bands.map(band => `<td class="p-1 text-center font-bold ${total[band] >= QBANK_BANDS[band].recommend ? 'text-emerald-400' : 'text-amber-400'}">${total[band]} / ${QBANK_BANDS[band].recommend}</td>`).join('');
    return `
        <table class="w-full text-[0.6875rem]">
            <thead><tr class="text-textMuted"><th class="p-1 text-left">학습 목표</th>${bands.map(band => `<th class="p-1" title="${escapeHtml(QBANK_BANDS[band].name)}">${band}</th>`).join('')}</tr></thead>
            <tbody>${body}</tbody>
            <tfoot><tr class="border-t border-white/10"><td class="p-1 text-textMuted">합계 / 권장</td>${foot}</tr></tfoot>
        </table>`;
}

function qbankBandCardsHtml() {
    const cards = [
        ...Object.entries(QBANK_BANDS).map(([band, info]) => ({ band, ...info, types: QUESTION_BAND_TYPES[band].join(' · ') })),
        QBANK_BAND_L4
    ];
    return `
        <p class="text-xs text-textMuted mt-1">${escapeHtml(QBANK_BAND_INTRO)}</p>
        <div class="grid grid-cols-4 gap-2 mt-1">${cards.map(card => `
            <div class="p-2 rounded bg-white/5 text-[0.6875rem] text-textMuted">
                <p class="font-bold text-textLight"><span class="text-accent">${card.band}</span> ${escapeHtml(card.name)}</p>
                <p class="mt-1">${escapeHtml(card.desc)}</p>
                <p class="mt-1 text-textMuted">${escapeHtml(card.types)}</p>
            </div>`).join('')}
        </div>`;
}

function qbankFormHtml(objectives, mod) {
    const { spec } = _qbank;
    const select = 'px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white';
    const types = QUESTION_BAND_TYPES[spec.band];
    const langs = lessonCodeLangs(mod, qbankTrackId());
    return `
        <div class="flex flex-wrap items-center gap-2">
            <select data-qbank-spec="objective" class="${select} max-w-[210px]">${(objectives.length ? objectives : ['학습 목표 없음']).map((text, i) => qbankOption(i + 1, `${i + 1}. ${text}`, spec.objective)).join('')}</select>
            <select data-qbank-spec="band" class="${select}">${Object.keys(QBANK_BANDS).map(band => qbankOption(band, band, spec.band)).join('')}</select>
            <select data-qbank-spec="type" class="${select}">${types.map(type => qbankOption(type, type, spec.type)).join('')}</select>
            ${spec.type === '객관식' ? `<label class="text-xs text-textLight flex items-center gap-1"><input type="checkbox" data-qbank-spec="multi" ${spec.multi ? 'checked' : ''}> 복수 정답</label>` : ''}
            <select data-qbank-spec="count" class="${select}">${QBANK_COUNTS.map(count => qbankOption(count, `${count}문항`, spec.count)).join('')}</select>
            <button data-qbank-action="generate" class="px-3 py-1 text-xs font-bold text-white bg-accent rounded hover:bg-accentHover">AI로 생성</button>
            <button data-qbank-action="add" class="px-3 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20">빈 문항 추가</button>
        </div>
        <p class="text-xs text-textMuted mt-1">${escapeHtml(langs.length ? `코드는 학습내용에 쓰인 ${langs.join(', ')} 기준입니다.` : '학습내용에 코드가 없으면 사용 툴을 보고 꼭 필요할 때만 코드를 씁니다.')}</p>`;
}

function qbankFlaggedHtml(questions, checklist) {
    const flagged = questions.map((q, index) => ({ q, index, issues: lintBankQuestion(q, checklist) })).filter(row => row.issues.length);
    return flagged.slice(0, QBANK_MAX_FLAGGED).map(({ q, index, issues }) => `
        <button data-qbank-action="jump" data-index="${index}" class="px-2 py-0.5 text-[0.6875rem] text-left rounded bg-amber-500/10 text-amber-300 hover:bg-amber-500/20">
            ${escapeHtml(q.band || '밴드 없음')} ${q.no}. ${escapeHtml(String(q.title || q.stem || '(빈 문항)').slice(0, 24))} · ${escapeHtml(issues[0].slice(0, 20))}${issues.length > 1 ? ` 외 ${issues.length - 1}` : ''}
        </button>`).join('');
}

function qbankCardHtml(q, index, checklist) {
    const issues = lintBankQuestion(q, checklist);
    const answer = q.answer ? `<p class="text-xs text-emerald-300 mt-1">정답: ${escapeHtml(q.answer)}${q.accepted ? ` · 허용 표기: ${escapeHtml(q.accepted)}` : ''}</p>` : '';
    return `
        <div id="qbank-q-${index}" class="p-2 rounded-lg bg-white/5 border ${issues.length ? 'border-amber-400/40' : 'border-white/10'}">
            <div class="flex items-center gap-2 text-[0.6875rem]">
                <span class="font-bold text-accent">${escapeHtml(q.band || '밴드 없음')}</span><span class="text-textLight">${escapeHtml(q.type || '유형 없음')}</span>
                <span class="text-textMuted">${q.objective ? `목표 ${q.objective}` : '목표 없음'}</span>${q.multi ? '<span class="text-textMuted">복수 정답</span>' : ''}
                <span class="ml-auto ${issues.length ? 'text-amber-400' : 'text-emerald-400'}">${issues.length ? `위반 ${issues.length}` : '검수 통과'}</span>
                <button data-qbank-action="edit" data-index="${index}" class="text-textLight underline">편집</button>
                <button data-qbank-action="delete" data-index="${index}" class="text-rose-400 underline">삭제</button>
            </div>
            <p class="text-xs font-bold text-textLight mt-1">${q.no}. ${escapeHtml(q.title)}</p>
            ${q.stem ? `<p class="text-xs text-textLight mt-1 whitespace-pre-wrap">${escapeHtml(q.stem)}</p>` : ''}
            ${q.code ? `<pre class="text-[0.6875rem] text-textLight mt-1 p-2 rounded bg-black/30 overflow-x-auto">${escapeHtml(q.code)}</pre>` : ''}
            ${q.choices.length ? `<p class="text-xs text-textMuted mt-1 whitespace-pre-wrap">${escapeHtml(q.choices.map(choice => `${choice.mark} ${choice.text}`).join('\n'))}</p>` : ''}
            ${answer}
            ${issues.map(msg => `<p class="text-xs text-amber-300 mt-0.5">• ${escapeHtml(msg)}</p>`).join('')}
        </div>`;
}

function qbankEditHtml(q, index, objectives) {
    const field = 'w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white';
    const text = (name, label, value, rows = 2) => `<label class="block text-[0.6875rem] text-textMuted">${label}<textarea data-qbank-field="${name}" rows="${rows}" class="${field} mt-0.5">${escapeHtml(value)}</textarea></label>`;
    const band = q.band || 'L1';
    return `
        <div class="p-2 rounded-lg bg-white/5 border border-accent/50 space-y-1">
            <div class="flex items-center gap-2">
                <select data-qbank-field="objective" class="${field}">${(objectives.length ? objectives : ['학습 목표 없음']).map((item, i) => qbankOption(i + 1, `${i + 1}. ${item}`, q.objective || 1)).join('')}</select>
                <select data-qbank-field="band" class="${field} w-20">${Object.keys(QBANK_BANDS).map(item => qbankOption(item, item, band)).join('')}</select>
                <select data-qbank-field="type" class="${field} w-28">${qbankOption('', '유형 미표기', q.type)}${Object.values(QUESTION_BAND_TYPES).flat().map(item => qbankOption(item, item, q.type)).join('')}</select>
                <label class="text-[0.6875rem] text-textLight flex items-center gap-1 shrink-0"><input type="checkbox" data-qbank-field="multi" ${q.multi ? 'checked' : ''}> 복수 정답</label>
            </div>
            ${text('title', '제목', q.title, 1)}${text('stem', '문항', q.stem)}
            ${text('choices', '보기 (한 줄에 하나)', q.choices.map(choice => choice.text).join('\n'), 3)}
            ${text('answer', '정답 (객관식은 ② 또는 ①, ②)', q.answer, 1)}${text('accepted', '허용 표기', q.accepted, 1)}
            ${text('rubric', '채점 기준·루브릭', q.rubric)}
            <label class="block text-[0.6875rem] text-textMuted">코드 언어 (코드제출, 예: python)<input data-qbank-field="lang" value="${escapeHtml(q.lang || '')}" class="${field} mt-0.5"></label>
            ${text('code', '시작 코드', q.code || '', 3)}
            ${text('tests', '기대 출력·테스트 케이스', q.tests)}${text('explanation', '해설', q.explanation)}
            <div class="flex justify-end gap-2 pt-1">
                <button data-qbank-action="cancel" class="px-3 py-1 text-xs font-bold text-textLight bg-white/10 rounded">취소</button>
                <button data-qbank-action="save" data-index="${index}" class="px-3 py-1 text-xs font-bold text-white bg-accent rounded">저장</button>
            </div>
        </div>`;
}

function qbankListHtml(questions, objectives, checklist) {
    const shown = questions.map((q, index) => ({ q, index })).filter(({ q }) => (!_qbank.band || q.band === _qbank.band) && (!_qbank.objective || q.objective === Number(_qbank.objective)));
    const adding = _qbank.editing === 'new' ? qbankEditHtml(_qbank.draft, 'new', objectives) : '';
    const rows = shown.map(({ q, index }) => (_qbank.editing === index ? qbankEditHtml(_qbank.draft || q, index, objectives) : qbankCardHtml(q, index, checklist))).join('');
    return adding + rows || `<p class="text-xs text-textMuted p-2">문항이 없습니다. ${escapeHtml(qbankBankLabel(qbankTrackId()))} 탭을 생성하거나 AI로 문항을 만들어주세요.</p>`;
}

// 그 갈래의 학습·실습 탭이 비어 있으면 문항을 만들 원고가 없다고 알린다
function qbankEmptyTrackHtml(mod, trackId) {
    if (trackHasContent(mod, trackId)) return '';
    const track = lessonTrack(trackId);
    const tabs = [track.learn, track.practice].map(id => LESSON_TABS.find(tab => tab.id === id)?.label || id).join('·');
    return `<p class="text-xs text-amber-300">${escapeHtml(`${tabs} 탭에 아직 교안이 없습니다. 먼저 그 탭을 만들면 그 내용과 학습 목표로 문항을 만듭니다.`)}</p>`;
}

function renderQbank() {
    const body = document.getElementById('qbank-body');
    const mod = qbankMod();
    if (!body || !mod) return;
    const trackId = qbankTrackId();
    const questions = qbankQuestions(mod, trackId);
    const objectives = qbankObjectives(mod, trackId);
    const checklist = qbankChecklist(mod, trackId);
    const passed = questions.filter(q => !lintBankQuestion(q, checklist).length).length;
    const select = 'px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white';
    const button = 'px-2 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20';
    const heading = document.getElementById('qbank-title');
    if (heading) heading.textContent = `문제은행 · ${mod.title} · ${lessonTrack(trackId).label}`;
    body.innerHTML = `
        ${typeof lessonTrackSwitchHtml === 'function' ? lessonTrackSwitchHtml(mod, 'qbank', 'dark') : ''}
        ${qbankEmptyTrackHtml(mod, trackId)}
        ${qbankLegacyNote(mod, trackId) ? `<p class="text-xs text-amber-300">${escapeHtml(qbankLegacyNote(mod, trackId))}</p>` : ''}
        <div class="p-2 rounded-lg bg-black/20">${qbankDistributionHtml(questions, objectives)}
            <p class="text-xs text-textMuted mt-1">권장: L1 10 · L2 5 · L3 3. L4는 프로젝트에서 다룹니다. <button data-qbank-action="help" class="underline text-textLight">밴드란? · ${_qbank.help ? '접기' : '펼치기'}</button></p>
            ${_qbank.help ? qbankBandCardsHtml() : ''}
        </div>
        <div class="p-2 rounded-lg bg-black/20">${qbankFormHtml(objectives, mod)}<p id="qbank-status" class="text-xs text-accent mt-1 min-h-[1em]">${escapeHtml(_qbank.status)}</p></div>
        <div class="flex items-center gap-2">
            <span class="text-xs font-bold ${passed === questions.length ? 'text-emerald-400' : 'text-amber-400'}">검수 통과 ${passed}/${questions.length}</span>
            <select data-qbank-filter="band" class="${select} ml-auto">${qbankOption('', '전체 밴드', _qbank.band)}${Object.keys(QBANK_BANDS).map(band => qbankOption(band, band, _qbank.band)).join('')}</select>
            <select data-qbank-filter="objective" class="${select}">${qbankOption('', '전체 목표', _qbank.objective)}${objectives.map((_, i) => qbankOption(i + 1, `목표 ${i + 1}`, _qbank.objective)).join('')}</select>
            <button data-qbank-action="csv" class="${button}">CSV 저장</button>
            <button data-qbank-action="subject-csv" class="${button}">교과 CSV</button>
            <button data-qbank-action="course-csv" class="${button}">과정 전체 CSV</button>
        </div>
        <div class="flex flex-wrap gap-1">${qbankFlaggedHtml(questions, checklist)}</div>
        <div class="space-y-2">${qbankListHtml(questions, objectives, checklist)}</div>
        <details class="text-[0.6875rem] text-textMuted"><summary class="cursor-pointer">검사 규칙 목록</summary><ul class="mt-1 space-y-0.5">${QBANK_RULE_LIST.map(rule => `<li>• ${escapeHtml(rule)}</li>`).join('')}</ul></details>`;
}

// opts.inline: 대화상자 대신 탐색줄의 문제은행 자리에 넣는다 / opts.track: 볼 갈래(basic | adv, 없으면 기본학습)
window.openQuestionBank = function (moduleId, opts = {}) {
    const mod = getEditingModule(moduleId);
    if (!mod?.tabContents) return window.showAlert('문제은행은 차시에서 사용할 수 있습니다.');
    if (document.getElementById('qbank-dialog')) return;
    const spec = { objective: 1, band: 'L1', type: '객관식', multi: false, count: 3 };
    const host = opts.inline ? document.getElementById('lesson-inline-panel') : null;
    _qbank = { moduleId, track: lessonTrack(opts.track).id, band: '', objective: '', editing: null, draft: null, help: false, status: '', spec, dirty: false, busy: false, inline: !!host };
    const overlay = document.createElement('div');
    overlay.id = 'qbank-dialog';
    overlay.className = host ? '' : 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl ${host ? 'w-full' : 'w-[720px] max-h-[88vh]'} flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10 flex items-center">
                <h2 id="qbank-title" class="text-sm font-bold text-textLight">문제은행 · ${escapeHtml(mod.title)}</h2>
                <button data-qbank-action="close" class="ml-auto px-3 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20">닫기</button>
            </div>
            <div id="qbank-body" class="flex-1 overflow-y-auto p-4 space-y-3"></div>
        </div>`;
    overlay.addEventListener('click', onQbankClick);
    overlay.addEventListener('change', onQbankChange);
    (host || document.body).appendChild(overlay);
    renderQbank();
};

window.forgetInlineQbank = function () {
    if (_qbank?.inline) _qbank = null;
};

// 문항을 고치거나 만들거나 저장하는 중이면 갈래를 바꾸지 않는다(그 문항은 지금 갈래의 문제은행에 들어간다)
window.qbankTrackLocked = () => !!_qbank && (_qbank.busy || _qbank.editing !== null);

// 열어 둔 문제은행을 다른 갈래로 바꿔 그 자리에서 다시 그린다(목표 번호는 갈래마다 달라 1번부터). 열어 둔 문제은행이 없으면 false
window.switchQbankTrack = function (trackId) {
    if (!_qbank) return false;
    _qbank = { ..._qbank, track: lessonTrack(trackId).id, band: '', objective: '', editing: null, draft: null, status: '', spec: { ..._qbank.spec, objective: 1 } };
    renderQbank();
    return true;
};

function qbankSpecValue(target, name) {
    if (name === 'multi') return target.checked;
    return ['objective', 'count'].includes(name) ? Number(target.value) : target.value;
}

function onQbankChange(event) {
    const { qbankSpec, qbankFilter } = event.target.dataset || {};
    if (!qbankFilter && !qbankSpec) return;
    keepQbankDraft();
    if (qbankFilter) _qbank = { ..._qbank, [qbankFilter]: event.target.value };
    if (qbankSpec) {
        const spec = { ..._qbank.spec, [qbankSpec]: qbankSpecValue(event.target, qbankSpec) };
        const types = QUESTION_BAND_TYPES[spec.band];
        const type = types.includes(spec.type) ? spec.type : types[0];
        _qbank = { ..._qbank, spec: { ...spec, type, multi: type === '객관식' && spec.multi } };
    }
    renderQbank();
}

// 저장이 끝날 때까지 다음 쓰기를 막아, 낡은 화면 번호로 다른 문항을 고치지 않게 한다. 바꾸기 전 내용은 히스토리에 남긴다.
// 열어 둔 갈래의 문제은행 탭(학습이해도·심화이해도)에 쓰고, 작업 기록(그 탭 이름)과 변경 이력(갈래 이름)에 어느 문제은행인지 적는다
async function commitQbankMarkdown(mod, md) {
    const { moduleId } = _qbank;
    const track = lessonTrack(qbankTrackId());
    _qbank = { ..._qbank, busy: true };
    await archiveContent({ title: `${mod.title} · ${qbankBankLabel(track.id)}`, content: qbankMarkdown(mod, track.id), images: mod.images, tabId: track.bank, lesson: mod }, '문제은행 수정 전');
    mod.tabContents = { ...mod.tabContents, [track.bank]: md };
    Object.assign(mod, withHistoryNote(mod, `${track.label} 문제은행 수정 (문항 ${lessonLintQuestions(md).length}개)`));
    await saveState();
    // 그사이 창을 닫았으면 그 차시(같은 객체)를 보고 있을 때만 다시 그린다. 다른 교과의 같은 번호 차시 화면은 그대로 둔다
    if (_qbank?.moduleId !== moduleId) return getEditingModule() === mod ? renderEditor(mod) : undefined;
    _qbank = { ..._qbank, busy: false, dirty: true, editing: null, draft: null, status: '' };
    renderQbank();
}

function readQuestionForm(original) {
    const field = name => document.querySelector(`[data-qbank-field="${name}"]`);
    const value = name => field(name)?.value.trim() ?? '';
    const type = value('type');
    const texts = value('choices').split('\n').map(text => text.trim()).filter(Boolean);
    const isChoice = !type || type === '객관식';
    return {
        ...original,
        objective: Number(value('objective')) || null, band: value('band'), type, typed: original.typed || type !== original.type,
        multi: isChoice && !!field('multi')?.checked, title: value('title'), stem: value('stem'),
        choices: isChoice ? texts.slice(0, QBANK_CHOICE_MARKS.length).map((text, i) => ({ mark: QBANK_CHOICE_MARKS[i], text })) : [],
        answer: value('answer'), accepted: value('accepted'), rubric: value('rubric'), tests: value('tests'), explanation: value('explanation'),
        code: (field('code')?.value ?? '').replace(/\s+$/, ''), lang: value('lang'), // 코드 첫 줄의 들여쓰기는 지키고 끝 공백만 지운다
        review: '' // 사람이 고친 문항은 AI 검수 결과를 무효화한다
    };
}

// 화면을 다시 그려도 쓰던 내용이 사라지지 않게 폼 값을 초안에 옮겨 둔다
function keepQbankDraft() {
    if (_qbank.editing === null || !document.querySelector('[data-qbank-field="title"]')) return;
    _qbank = { ..._qbank, draft: readQuestionForm(_qbank.draft) };
}

function jumpToQuestion(index) {
    keepQbankDraft();
    _qbank = { ..._qbank, band: '', objective: '' };
    renderQbank();
    const card = document.getElementById(`qbank-q-${index}`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card?.classList.add('ring-2', 'ring-amber-400');
    setTimeout(() => card?.classList.remove('ring-2', 'ring-amber-400'), QBANK_FLASH_MS);
}

async function saveQuestionDraft(mod, index) {
    const trackId = qbankTrackId();
    if (index !== 'new') return commitQbankMarkdown(mod, updateQuestionMd(qbankMarkdown(mod, trackId), Number(index), readQuestionForm(_qbank.draft)));
    const question = readQuestionForm(_qbank.draft);
    if (!`${question.title}${question.stem}`.trim()) {
        _qbank = { ..._qbank, draft: question, status: '제목이나 문항 내용을 입력해주세요.' };
        return renderQbank();
    }
    return commitQbankMarkdown(mod, appendQuestionsMd(qbankMarkdown(mod, trackId), [question]));
}

function downloadCsv(csv, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${safeFileName(name)}_문제은행.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// 보고 있는 갈래의 문제은행만 받는다. 파일 이름에 갈래를 붙인다(…_기본학습_문제은행.csv)
function saveQbankCsv(mod, trackId = qbankTrackId()) {
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    downloadCsv(toCsv(lessonBankCsvRows(subject, mod, trackId)), `${lessonFileBase(mod, subject)}_${lessonTrack(trackId).label}`);
}

function saveCourseCsv() {
    const { rows, csv } = courseQuestionsCsv();
    if (!rows) return window.showAlert('내려받을 문항이 없습니다.');
    downloadCsv(csv, globalState.courseTitle);
}

function saveSubjectCsv() {
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    const { rows, csv } = subject ? subjectQuestionsCsv(subject) : { rows: 0, csv: '' };
    if (!rows) return window.showAlert('내려받을 문항이 없습니다.');
    downloadCsv(csv, subject.title);
}

// 만들기 시작한 갈래를 잡아 두고 그 갈래의 문제은행에 넣는다(만드는 동안 창을 닫거나 다시 열어도 같다)
async function runQuestionGenerate(mod) {
    const { moduleId, spec } = _qbank;
    const trackId = qbankTrackId();
    keepQbankDraft();
    _qbank = { ..._qbank, busy: true, status: '문항을 만들고 검수하고 있습니다...' };
    renderQbank();
    try {
        const questions = await generateQuestions(mod, spec, trackId);
        await writeQuestionsIfOpen(mod, moduleId, questions, trackId);
    } catch (err) {
        console.error('[문제은행] 문항 생성 실패:', err);
        if (_qbank?.moduleId === moduleId) _qbank = { ..._qbank, status: `생성 실패: ${err.message}` };
    }
    if (_qbank?.moduleId === moduleId) {
        _qbank = { ..._qbank, busy: false };
        renderQbank();
    }
}

// 생성 중에 대화상자를 닫아도 비용을 들여 만든 문항은 버리지 않는다. trackId: 만들기 시작한 갈래.
// 문항 코드에 주석을 다 넣지 못했으면(코드를 바꾼 답·서버 오류·하루 한도) 상태 글에 적는다(code-comments-tool.js questionCommentNote)
async function writeQuestionsIfOpen(mod, moduleId, questions, trackId = 'basic') {
    const track = lessonTrack(trackId);
    const md = appendQuestionsMd(qbankMarkdown(mod, track.id), questions);
    mod.tabContents = { ...mod.tabContents, [track.bank]: md };
    await saveState();
    const note = typeof questionCommentNote === 'function' ? questionCommentNote(questions) : '';
    if (_qbank?.moduleId === moduleId) _qbank = { ..._qbank, dirty: true, status: [`${track.label} 문제은행에 ${questions.length}문항을 추가했습니다.`, note].filter(Boolean).join(' ') };
}

function closeQbank() {
    const { dirty, inline } = _qbank;
    const mod = qbankMod();
    document.getElementById('qbank-dialog')?.remove();
    _qbank = null;
    if (inline) window.clearLessonPanel();
    if ((dirty || inline) && mod && typeof renderEditor === 'function') renderEditor(mod);
}

async function onQbankClick(event) {
    const button = event.target.closest?.('[data-qbank-action]');
    const action = button?.dataset.qbankAction;
    if (!action) return;
    if (action === 'close') return closeQbank();
    if (action === 'jump') return jumpToQuestion(Number(button.dataset.index));
    if (_qbank.busy) return;
    const mod = qbankMod();
    const index = Number(button.dataset.index);
    if (action === 'help') {
        keepQbankDraft();
        _qbank = { ..._qbank, help: !_qbank.help };
    }
    const trackId = qbankTrackId();
    if (action === 'add') _qbank = { ..._qbank, editing: 'new', draft: blankQuestion(_qbank.spec, mod, trackId), status: '' };
    if (action === 'edit') _qbank = { ..._qbank, editing: index, draft: qbankQuestions(mod, trackId)[index] };
    if (action === 'cancel') _qbank = { ..._qbank, editing: null, draft: null };
    if (action === 'csv') saveQbankCsv(mod, trackId);
    if (action === 'subject-csv') saveSubjectCsv();
    if (action === 'course-csv') saveCourseCsv();
    if (action === 'generate') return runQuestionGenerate(mod);
    // 묻는 동안 문제은행을 닫았거나 다른 갈래로 바꿨으면 지우지 않는다(번호가 다른 갈래의 문항을 가리킨다)
    if (action === 'delete') return window.showConfirm('이 문항을 삭제할까요? 삭제 전 내용은 작업 기록에 남습니다.', () => (_qbank && qbankTrackId() === trackId ? commitQbankMarkdown(mod, removeQuestionMd(qbankMarkdown(mod, trackId), index)) : undefined));
    if (action === 'save') return saveQuestionDraft(mod, button.dataset.index);
    renderQbank();
}
