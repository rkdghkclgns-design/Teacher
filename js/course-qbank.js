// course-qbank.js - 차시 문제은행: 학습이해도 탭의 마크다운을 문항 단위로 관리한다
// develocket-slide(assets/course-qbank.js, course-rules.js @3a7303f)의 분포·검수·CSV·문항 생성을 옮겼다.
// 원본은 마크다운 그대로 두고 문항만 읽고 고쳐 쓴다. 저장 형식은 학습이해도 탭과 같다.

const QBANK_BANDS = {
    L1: { name: '수업과 같은 상황', desc: '수업에서 다룬 상황을 그대로 묻습니다. 배운 내용을 기억하고 있는지 확인합니다.', recommend: 10 },
    L2: { name: '같은 구조, 다른 맥락', desc: '배운 구조를 다른 상황에 적용하게 합니다. 원리를 옮겨 쓸 수 있는지 확인합니다.', recommend: 5 },
    L3: { name: '요구사항만 제시', desc: '해결할 요구사항만 주고 방법은 주지 않습니다. 배운 내용으로 스스로 구현할 수 있는지 확인합니다.', recommend: 3 }
};
const QBANK_BAND_L4 = { band: 'L4', name: '목표만 제시', desc: '최종 목표만 주고 수행 능력 전체를 평가합니다. 문제은행이 아니라 과정의 프로젝트에서 다룹니다.', types: '프로젝트에서 다룸 · 문제은행에 만들지 않음' };
const QBANK_BAND_INTRO = '밴드는 문항이 학습자에게 얼마나 많은 것을 스스로 하도록 요구하는지를 나타내는 단계입니다. 숫자가 클수록 주어지는 정보가 적습니다. 모든 문항에 학습 목표와 밴드를 함께 붙여 두면, 오답률이 높을 때 어느 목표의 어느 수준이 무너졌는지 찾을 수 있습니다.';
const QBANK_COUNTS = [1, 2, 3, 5, 8, 10];
const QBANK_LESSON_CHARS = 6000;
const QBANK_MAX_FLAGGED = 20;
const QBANK_FLASH_MS = 1600;
const QBANK_CHOICE_MARKS = '①②③④⑤⑥⑦⑧⑨⑩';
const QBANK_TYPE_FORMATS = {
    객관식: '보기는 ①~⑤로 쓰고, "✅ **정답:** ②"로 정답을 표기합니다. 복수 정답이면 제목 끝에 (복수정답)을 붙이고 문항에 「모두 고르시오」를 밝힙니다.',
    단답식: '"✅ **정답:** 값" 다음 줄에 "🔤 **허용 표기:** 대소문자·띄어쓰기 변형"을 적습니다. 정답은 단어나 값 하나로 확정되어야 합니다.',
    서술형: '"✅ **정답:** 모범 답안" 다음 줄에 "📏 **채점 기준:** 요소 (점수); 요소 (점수)"를 적습니다.',
    코드제출: '시작 코드가 필요하면 "🧩 **시작 코드:**" 다음 줄에 코드 블록으로 적고, "🧪 **테스트:** 입력과 기대 출력"을 적습니다.',
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
    '- 경어체로 쓰고 학습자를 호칭하지 않습니다.'
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

function qbankMarkdown(mod) {
    return String(mod.tabContents?.assessment || '').replace(/\r\n/g, '\n');
}

function qbankQuestions(mod) {
    return lessonLintQuestions(qbankMarkdown(mod)).map(parseQuestionBlock);
}

function qbankTabBullets(mod, title) {
    return Object.values(mod.tabContents || {}).flatMap(md => (md ? lessonLintBullets(String(md).replace(/\r\n/g, '\n'), title) : []));
}

function qbankObjectives(mod) {
    const fromTabs = uniqueTexts(qbankTabBullets(mod, '학습\\s*목표'));
    return fromTabs.length ? fromTabs : (mod.objectives || []);
}

const qbankChecklist = mod => qbankTabBullets(mod, '학습\\s*후\\s*체크리스트');

// 화면에서 쓰는 문항 검수. 학습 목표를 지운 뒤 남은 번호도 잡는다
function lintBankQuestion(q, checklist) {
    const mod = _qbank ? qbankMod() : null;
    return lintQuestion(q, checklist, (mod && qbankObjectives(mod).length) || Infinity);
}

function lessonCodeTags(mod) {
    const sources = [...Object.values(mod.tabContents || {}), mod.content];
    const tags = sources.flatMap(md => [...String(md || '').matchAll(/^[ \t]*```[ \t]*([\w#+.-]+)[ \t]*$/gm)].map(match => match[1].toLowerCase()));
    return uniqueTexts(tags).filter(tag => !QBANK_NON_CODE_TAGS.has(tag));
}

const lessonCodeLangs = mod => uniqueTexts(lessonCodeTags(mod).map(tag => QBANK_LANG_NAMES[tag] || tag));

// 사람이 직접 쓰는 빈 문항. 생성 폼에서 고른 목표·밴드·유형으로 시작한다.
function blankQuestion(spec, mod) {
    return {
        no: 0, title: '', objective: spec.objective, band: spec.band, type: spec.type, typed: true,
        multi: spec.type === '객관식' && !!spec.multi, stem: '', media: '', choices: [], answer: '', accepted: '', hint: '',
        code: '', lang: spec.type === '코드제출' ? (lessonCodeTags(mod)[0] || '') : '',
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
// 실행될 수 있는 수식(함수 호출, 외부 참조)만 막는다
function csvCell(value, { answer = false } = {}) {
    const text = String(value ?? '');
    const formula = /^[=+\-@]/.test(text) && (!answer || /[(|!]/.test(text));
    const safe = formula ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// 열은 LMS 업로드에 쓰는 develocket-slide(assets/course-model.js questionsToCsv @3a7303f)와 같다. 단원은 교과, 학습모듈은 차시다
const QBANK_CSV_HEAD = ['문항ID', '단원', '학습모듈', '목표번호', '학습목표', '밴드', '유형', '복수정답', '문항', '보기1', '보기2', '보기3', '보기4', '보기5', '정답', '허용표기', '모범답안', '채점기준', '시작코드', '테스트케이스', '루브릭', '해설', '검수'];
const QBANK_CSV_ANSWER_HEADS = ['보기1', '보기2', '보기3', '보기4', '보기5', '정답', '허용표기'];
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

const csvRow = row => row.map((cell, index) => csvCell(cell, { answer: QBANK_CSV_ANSWER_HEADS.includes(QBANK_CSV_HEAD[index]) })).join(',');
const toCsv = rows => `\uFEFF${[QBANK_CSV_HEAD, ...rows].map(csvRow).join('\r\n')}`;

function questionsCsv(questions, objectives, context) {
    return toCsv(questionCsvRows(questions, objectives, context));
}

function subjectCsvRows(subject) {
    return subjectLessons(subject).flatMap(lesson => (lesson.tabContents?.assessment
        ? questionCsvRows(qbankQuestions(lesson), qbankObjectives(lesson), { subject: subject.title, lesson: lesson.title, lessonId: lesson.id, checklist: qbankChecklist(lesson) })
        : []));
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
function qbankCodeRule(mod, type) {
    const langs = lessonCodeLangs(mod);
    if (langs.length) return `학습내용에 쓰인 언어(${langs.join(', ')})를 그대로 사용합니다.`;
    const tools = (mod.tools || []).map(toolLabel).join(', ') || '없음';
    const pick = type === '코드제출' ? ' 코드제출 유형이므로 학습내용과 사용 툴에 맞는 언어 하나를 골라 문항 첫 줄에 언어를 밝힙니다.' : '';
    return `학습내용에 코드가 없습니다. 사용 툴(${tools})과 학습내용을 보고 코드가 꼭 필요한 경우에만 쓰고, 그렇지 않으면 코드 없이 출제합니다.${pick}`;
}

function qbankChoiceRule(spec) {
    if (spec.type !== '객관식') return '';
    return spec.multi ? '[정답 수] 정답 2개 이상, 오답 1개 이상이며 문항에 「모두 고르시오」를 밝힙니다.' : '[정답 수] 정답이 될 수 있는 보기는 정확히 하나입니다.';
}

function buildQuestionPrompt(mod, spec, objectives, questions) {
    const source = String(mod.tabContents?.basicLearn || mod.content || '').slice(0, QBANK_LESSON_CHARS);
    return [
        `아래 차시의 문제은행 문항을 ${spec.count}개 만드세요.`, '', QBANK_RULES, '',
        `[학습 목표 ${spec.objective}] ${objectives[spec.objective - 1] || mod.title}`,
        `[밴드] ${spec.band} — ${QBANK_BANDS[spec.band].name}`, `[유형] ${spec.type}${spec.multi ? ' (복수 정답)' : ''}: ${QBANK_TYPE_FORMATS[spec.type]}`,
        qbankChoiceRule(spec), `[코드] ${qbankCodeRule(mod, spec.type)}`,
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

// 모델이 쓴 태그와 달라도 사용자가 고른 목표·밴드·유형으로 맞춘다
function parseGeneratedQuestions(text, spec) {
    const body = String(text || '').replace(/\r\n/g, '\n').trim().replace(/^```\w*\n/, '').replace(/\n```$/, '');
    const multi = spec.type === '객관식' && !!spec.multi;
    return lessonLintQuestions(body)
        .map(parseQuestionBlock)
        .map(q => ({ ...q, objective: spec.objective, band: spec.band, type: spec.type, typed: true, multi, stem: multi ? withMultiNotice(q.stem) : q.stem }));
}

function buildReviewPrompt(mod, questions, objectives) {
    return [
        '당신은 평가 문항 검수자입니다. 다른 출제자가 만든 문항을 아래 기준으로 엄격히 검수하세요.',
        `[차시] ${mod.title}`, `[학습 목표]\n${objectives.map((text, i) => `${i + 1}. ${text}`).join('\n')}`,
        '[기준] 1) 태그한 학습 목표를 실제로 묻는가 2) 밴드 정의에 맞는가(L1 수업과 같은 상황 / L2 같은 구조·다른 맥락 / L3 요구사항만 제시) 3) 정답이 확정되는가 4) 해설과 채점 기준이 정답과 맞는가', '',
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

// 자동 검수에 걸린 문항은 한 번 더 고쳐 받는다
async function generateQuestions(mod, spec) {
    const questions = await draftQuestions(mod, spec);
    return crossReviewQuestions(mod, questions, qbankObjectives(mod));
}

async function draftQuestions(mod, spec) {
    const objectives = qbankObjectives(mod);
    const existing = qbankQuestions(mod);
    const checklist = qbankChecklist(mod);
    const prompt = buildQuestionPrompt(mod, spec, objectives, existing);
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
    const langs = lessonCodeLangs(mod);
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
    return adding + rows || '<p class="text-xs text-textMuted p-2">문항이 없습니다. 학습이해도 탭을 생성하거나 AI로 문항을 만들어주세요.</p>';
}

function renderQbank() {
    const body = document.getElementById('qbank-body');
    const mod = qbankMod();
    if (!body || !mod) return;
    const questions = qbankQuestions(mod);
    const objectives = qbankObjectives(mod);
    const checklist = qbankChecklist(mod);
    const passed = questions.filter(q => !lintBankQuestion(q, checklist).length).length;
    const select = 'px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white';
    const button = 'px-2 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20';
    body.innerHTML = `
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

// opts.inline: 대화상자 대신 탐색줄의 문제은행 자리에 넣는다
window.openQuestionBank = function (moduleId, opts = {}) {
    const mod = getEditingModule(moduleId);
    if (!mod?.tabContents) return window.showAlert('문제은행은 차시에서 사용할 수 있습니다.');
    if (document.getElementById('qbank-dialog')) return;
    const spec = { objective: 1, band: 'L1', type: '객관식', multi: false, count: 3 };
    const host = opts.inline ? document.getElementById('lesson-inline-panel') : null;
    _qbank = { moduleId, band: '', objective: '', editing: null, draft: null, help: false, status: '', spec, dirty: false, busy: false, inline: !!host };
    const overlay = document.createElement('div');
    overlay.id = 'qbank-dialog';
    overlay.className = host ? '' : 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl ${host ? 'w-full' : 'w-[720px] max-h-[88vh]'} flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10 flex items-center">
                <h2 class="text-sm font-bold text-textLight">문제은행 · ${escapeHtml(mod.title)}</h2>
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
async function commitQbankMarkdown(mod, md) {
    const { moduleId } = _qbank;
    _qbank = { ..._qbank, busy: true };
    await archiveContent({ title: `${mod.title} · 학습이해도`, content: qbankMarkdown(mod), images: mod.images });
    mod.tabContents = { ...mod.tabContents, assessment: md };
    Object.assign(mod, withHistoryNote(mod, `문제은행 수정 (문항 ${lessonLintQuestions(md).length}개)`));
    await saveState();
    if (_qbank?.moduleId !== moduleId) return String(currentEditingModuleId) === String(mod.id) ? renderEditor(mod) : undefined;
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
    if (index !== 'new') return commitQbankMarkdown(mod, updateQuestionMd(qbankMarkdown(mod), Number(index), readQuestionForm(_qbank.draft)));
    const question = readQuestionForm(_qbank.draft);
    if (!`${question.title}${question.stem}`.trim()) {
        _qbank = { ..._qbank, draft: question, status: '제목이나 문항 내용을 입력해주세요.' };
        return renderQbank();
    }
    return commitQbankMarkdown(mod, appendQuestionsMd(qbankMarkdown(mod), [question]));
}

function downloadCsv(csv, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${safeFileName(name)}_문제은행.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function saveQbankCsv(mod) {
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    downloadCsv(questionsCsv(qbankQuestions(mod), qbankObjectives(mod), { subject: subject?.title || '', lesson: mod.title, lessonId: mod.id, checklist: qbankChecklist(mod) }), lessonFileBase(mod, subject));
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

async function runQuestionGenerate(mod) {
    const { moduleId, spec } = _qbank;
    keepQbankDraft();
    _qbank = { ..._qbank, busy: true, status: '문항을 만들고 검수하고 있습니다...' };
    renderQbank();
    try {
        const questions = await generateQuestions(mod, spec);
        await writeQuestionsIfOpen(mod, moduleId, questions);
    } catch (err) {
        console.error('[문제은행] 문항 생성 실패:', err);
        if (_qbank?.moduleId === moduleId) _qbank = { ..._qbank, status: `생성 실패: ${err.message}` };
    }
    if (_qbank?.moduleId === moduleId) {
        _qbank = { ..._qbank, busy: false };
        renderQbank();
    }
}

// 생성 중에 대화상자를 닫아도 비용을 들여 만든 문항은 버리지 않는다
async function writeQuestionsIfOpen(mod, moduleId, questions) {
    const md = appendQuestionsMd(qbankMarkdown(mod), questions);
    mod.tabContents = { ...mod.tabContents, assessment: md };
    await saveState();
    if (_qbank?.moduleId === moduleId) _qbank = { ..._qbank, dirty: true, status: `${questions.length}문항을 추가했습니다.` };
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
    if (action === 'add') _qbank = { ..._qbank, editing: 'new', draft: blankQuestion(_qbank.spec, mod), status: '' };
    if (action === 'edit') _qbank = { ..._qbank, editing: index, draft: qbankQuestions(mod)[index] };
    if (action === 'cancel') _qbank = { ..._qbank, editing: null, draft: null };
    if (action === 'csv') saveQbankCsv(mod);
    if (action === 'subject-csv') saveSubjectCsv();
    if (action === 'course-csv') saveCourseCsv();
    if (action === 'generate') return runQuestionGenerate(mod);
    if (action === 'delete') return window.showConfirm('이 문항을 삭제할까요? 삭제 전 내용은 작업 기록에 남습니다.', () => commitQbankMarkdown(mod, removeQuestionMd(qbankMarkdown(mod), index)));
    if (action === 'save') return saveQuestionDraft(mod, button.dataset.index);
    renderQbank();
}
