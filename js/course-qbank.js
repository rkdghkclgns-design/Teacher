// course-qbank.js - 차시 문제은행: 학습이해도 탭의 마크다운을 문항 단위로 관리한다
// develocket-slide(assets/course-qbank.js, course-rules.js @3a7303f)의 분포·검수·CSV·문항 생성을 옮겼다.
// 원본은 마크다운 그대로 두고 문항만 읽고 고쳐 쓴다. 저장 형식은 학습이해도 탭과 같다.

const QBANK_BANDS = {
    L1: { name: '수업과 같은 상황', recommend: 10 },
    L2: { name: '같은 구조, 다른 맥락', recommend: 5 },
    L3: { name: '요구사항만 제시', recommend: 3 }
};
const QBANK_COUNTS = [1, 2, 3, 5, 8, 10];
const QBANK_LESSON_CHARS = 6000;
const QBANK_TYPE_FORMATS = {
    객관식: '보기는 ①~⑤로 쓰고, "✅ **정답:** ②"로 정답을 표기합니다. 복수 정답이면 제목 끝에 (복수정답)을 붙이고 문항에 「모두 고르시오」를 밝힙니다.',
    단답식: '"✅ **정답:** 값" 다음 줄에 "🔤 **허용 표기:** 대소문자·띄어쓰기 변형"을 적습니다. 정답은 단어나 값 하나로 확정되어야 합니다.',
    서술형: '"✅ **정답:** 모범 답안" 다음 줄에 "📏 **채점 기준:** 요소 (점수); 요소 (점수)"를 적습니다.',
    코드제출: '"🧪 **테스트:** 입력과 기대 출력"을 적습니다.',
    파일제출: '"📏 **채점 기준:** 평가 기준 — 충족/부분/미흡 조건과 점수"를 관찰 가능한 기준으로 적습니다.'
};
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
function serializeQuestion(q, no) {
    const label = q.objective && q.band ? `학습 목표 ${q.objective} · 밴드 ${q.band}${q.typed ? ` · ${q.type}` : ''}` : '';
    const field = (mark, name, value) => (value ? [`${mark} **${name}:** ${value}`, ''] : []);
    const answers = q.answer.match(LESSON_LINT_CHOICE_MARK) || [];
    const choiceLine = choice => {
        const text = `${choice.mark} ${choice.text}`;
        return answers.includes(choice.mark) ? `<span style="${QUESTION_ANSWER_STYLE}">${text}</span>` : text;
    };
    return [
        `### 문제 ${no}. ${q.title}${q.multi ? ' (복수정답)' : ''}`,
        ...(label ? [label] : []), '',
        ...(q.media ? [q.media, ''] : []),
        ...(q.stem ? [q.stem, ''] : []),
        ...(q.choices.length ? [...q.choices.map(choiceLine), ''] : []),
        ...field('💡', '힌트', q.hint), ...field('✅', '정답', q.answer), ...field('🔤', '허용 표기', q.accepted),
        ...field('📝', '해설', q.explanation), ...field('📏', '채점 기준', q.rubric), ...field('🧪', '테스트', q.tests), ...field('🔍', '교차 검수', q.review),
        '---'
    ].join('\n');
}

function replaceSpan(md, span, text) {
    return `${md.slice(0, span.start)}${text}${md.slice(span.end)}`;
}

function renumberQuestions(md) {
    let no = 0;
    return md.replace(/^(###\s*문제\s*)\d+/gm, (all, prefix) => `${prefix}${no += 1}`);
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
function csvCell(value) {
    const text = String(value ?? '');
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text; // 스프레드시트 수식으로 실행되지 않게 막는다
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const QBANK_CSV_HEAD = ['번호', '교과', '차시', '목표번호', '학습목표', '밴드', '유형', '복수정답', '제목', '문항', '보기1', '보기2', '보기3', '보기4', '보기5', '정답', '허용표기', '채점기준', '테스트', '해설', '교차검수', '검수'];

function questionCsvRows(questions, objectives, context) {
    return questions.map(q => {
        const issues = lintQuestion(q, context.checklist);
        return [
            q.no, context.subject, context.lesson, q.objective ?? '', (q.objective && objectives[q.objective - 1]) || '', q.band, q.type, q.multi ? 'Y' : '', q.title, q.stem,
            ...Array.from({ length: 5 }, (_, i) => q.choices[i]?.text ?? ''), q.answer, q.accepted, q.rubric, q.tests, q.explanation, q.review, issues.length ? `위반 ${issues.length}건` : '검수 통과'
        ];
    });
}

const toCsv = rows => `\uFEFF${[QBANK_CSV_HEAD, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;

function questionsCsv(questions, objectives, context) {
    return toCsv(questionCsvRows(questions, objectives, context));
}

function courseQuestionsCsv() {
    const rows = globalState.subjects.flatMap(subject => (subject.lessons || []).flatMap(lesson => (lesson.tabContents?.assessment
        ? questionCsvRows(qbankQuestions(lesson), qbankObjectives(lesson), { subject: subject.title, lesson: lesson.title, checklist: qbankChecklist(lesson) })
        : [])));
    return { rows: rows.length, csv: toCsv(rows) };
}

/* ---------- AI 문항 생성 ---------- */
function buildQuestionPrompt(mod, spec, objectives, questions) {
    const source = String(mod.tabContents?.basicLearn || mod.content || '').slice(0, QBANK_LESSON_CHARS);
    return [
        `아래 차시의 문제은행 문항을 ${spec.count}개 만드세요.`, '', QBANK_RULES, '',
        `[학습 목표 ${spec.objective}] ${objectives[spec.objective - 1] || mod.title}`,
        `[밴드] ${spec.band} — ${QBANK_BANDS[spec.band].name}`, `[유형] ${spec.type}: ${QBANK_TYPE_FORMATS[spec.type]}`,
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

// 모델이 쓴 태그와 달라도 사용자가 고른 목표·밴드·유형으로 맞춘다
function parseGeneratedQuestions(text, spec) {
    const body = String(text || '').replace(/\r\n/g, '\n').trim().replace(/^```\w*\n/, '').replace(/\n```$/, '');
    return lessonLintQuestions(body)
        .map(parseQuestionBlock)
        .map(q => ({ ...q, objective: spec.objective, band: spec.band, type: spec.type, typed: true }));
}

function buildReviewPrompt(mod, questions, objectives) {
    return [
        '당신은 평가 문항 검수자입니다. 다른 출제자가 만든 문항을 아래 기준으로 엄격히 검수하세요.',
        `[차시] ${mod.title}`, `[학습 목표]\n${objectives.map((text, i) => `${i + 1}. ${text}`).join('\n')}`,
        '[기준] 1) 태그한 학습 목표를 실제로 묻는가 2) 밴드 정의에 맞는가(L1 수업과 같은 상황 / L2 같은 구조·다른 맥락 / L3 요구사항만 제시) 3) 정답이 확정되는가 4) 해설과 채점 기준이 정답과 맞는가', '',
        JSON.stringify(questions.map((q, i) => ({ i, objective: q.objective, band: q.band, type: q.type, title: q.title, stem: q.stem, choices: q.choices, answer: q.answer, rubric: q.rubric, tests: q.tests, explanation: q.explanation }))), '',
        'JSON 배열만 출력합니다: [{"i": 0, "ok": true, "notes": "문제가 있으면 무엇을 고쳐야 하는지 경어체 1문장, 없으면 빈 문자열"}]'
    ].join('\n');
}

// 두 공급자의 키가 있으면 출제하지 않은 모델이 검수한다. 실패해도 문항은 버리지 않는다.
async function crossReviewQuestions(mod, questions, objectives) {
    const model = crossCheckModel();
    if (!model) return questions;
    try {
        const data = await callGemini(model, {
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
    const issues = first.flatMap(q => lintQuestion(q, checklist).map(msg => `- ${q.title}: ${msg}`));
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
    const body = rows.map((row, i) => `<tr><td class="p-1 text-textLight">${i + 1}. ${escapeHtml(objectives[i] || '(학습 목표 없음)')}</td>${bands.map(band => `<td class="p-1 text-center ${row[band] ? 'text-textLight' : 'text-textMuted/50'}">${row[band]}</td>`).join('')}</tr>`).join('');
    const foot = bands.map(band => `<td class="p-1 text-center font-bold ${total[band] >= QBANK_BANDS[band].recommend ? 'text-emerald-400' : 'text-amber-400'}">${total[band]} / ${QBANK_BANDS[band].recommend}</td>`).join('');
    return `
        <table class="w-full text-[0.65rem]">
            <thead><tr class="text-textMuted"><th class="p-1 text-left">학습 목표</th>${bands.map(band => `<th class="p-1" title="${escapeHtml(QBANK_BANDS[band].name)}">${band}</th>`).join('')}</tr></thead>
            <tbody>${body}</tbody>
            <tfoot><tr class="border-t border-white/10"><td class="p-1 text-textMuted">합계 / 권장</td>${foot}</tr></tfoot>
        </table>`;
}

function qbankFormHtml(objectives) {
    const { spec } = _qbank;
    const select = 'px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white';
    const types = QUESTION_BAND_TYPES[spec.band];
    return `
        <div class="flex flex-wrap items-center gap-2">
            <select data-qbank-spec="objective" class="${select} max-w-[210px]">${(objectives.length ? objectives : ['학습 목표 없음']).map((text, i) => qbankOption(i + 1, `${i + 1}. ${text}`, spec.objective)).join('')}</select>
            <select data-qbank-spec="band" class="${select}">${Object.keys(QBANK_BANDS).map(band => qbankOption(band, band, spec.band)).join('')}</select>
            <select data-qbank-spec="type" class="${select}">${types.map(type => qbankOption(type, type, spec.type)).join('')}</select>
            <select data-qbank-spec="count" class="${select}">${QBANK_COUNTS.map(count => qbankOption(count, `${count}문항`, spec.count)).join('')}</select>
            <button data-qbank-action="generate" class="px-3 py-1 text-xs font-bold text-white bg-accent rounded hover:bg-accentHover">AI로 생성</button>
        </div>`;
}

function qbankCardHtml(q, index, checklist) {
    const issues = lintQuestion(q, checklist);
    const answer = q.answer ? `<p class="text-[0.65rem] text-emerald-300 mt-1">정답: ${escapeHtml(q.answer)}${q.accepted ? ` · 허용 표기: ${escapeHtml(q.accepted)}` : ''}</p>` : '';
    return `
        <div class="p-2 rounded-lg bg-white/5 border ${issues.length ? 'border-amber-400/40' : 'border-white/10'}">
            <div class="flex items-center gap-2 text-[0.65rem]">
                <span class="font-bold text-accent">${escapeHtml(q.band || '밴드 없음')}</span><span class="text-textLight">${escapeHtml(q.type || '유형 없음')}</span>
                <span class="text-textMuted">${q.objective ? `목표 ${q.objective}` : '목표 없음'}</span>${q.multi ? '<span class="text-textMuted">복수 정답</span>' : ''}
                <span class="ml-auto ${issues.length ? 'text-amber-400' : 'text-emerald-400'}">${issues.length ? `위반 ${issues.length}` : '검수 통과'}</span>
                <button data-qbank-action="edit" data-index="${index}" class="text-textLight underline">편집</button>
                <button data-qbank-action="delete" data-index="${index}" class="text-rose-400 underline">삭제</button>
            </div>
            <p class="text-xs font-bold text-textLight mt-1">${q.no}. ${escapeHtml(q.title)}</p>
            ${q.stem ? `<p class="text-xs text-textLight mt-1 whitespace-pre-wrap">${escapeHtml(q.stem)}</p>` : ''}
            ${q.choices.length ? `<p class="text-[0.65rem] text-textMuted mt-1 whitespace-pre-wrap">${escapeHtml(q.choices.map(choice => `${choice.mark} ${choice.text}`).join('\n'))}</p>` : ''}
            ${answer}
            ${issues.map(msg => `<p class="text-[0.65rem] text-amber-300 mt-0.5">• ${escapeHtml(msg)}</p>`).join('')}
        </div>`;
}

function qbankEditHtml(q, index, objectives) {
    const field = 'w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white';
    const text = (name, label, value, rows = 2) => `<label class="block text-[0.65rem] text-textMuted">${label}<textarea data-qbank-field="${name}" rows="${rows}" class="${field} mt-0.5">${escapeHtml(value)}</textarea></label>`;
    const band = q.band || 'L1';
    return `
        <div class="p-2 rounded-lg bg-white/5 border border-accent/50 space-y-1">
            <div class="flex gap-2">
                <select data-qbank-field="objective" class="${field}">${(objectives.length ? objectives : ['학습 목표 없음']).map((item, i) => qbankOption(i + 1, `${i + 1}. ${item}`, q.objective || 1)).join('')}</select>
                <select data-qbank-field="band" class="${field} w-20">${Object.keys(QBANK_BANDS).map(item => qbankOption(item, item, band)).join('')}</select>
                <select data-qbank-field="type" class="${field} w-28">${qbankOption('', '유형 미표기', q.type)}${Object.values(QUESTION_BAND_TYPES).flat().map(item => qbankOption(item, item, q.type)).join('')}</select>
            </div>
            ${text('title', '제목', q.title, 1)}${text('stem', '문항', q.stem)}
            ${text('choices', '보기 (한 줄에 하나)', q.choices.map(choice => choice.text).join('\n'), 3)}
            ${text('answer', '정답 (객관식은 ② 또는 ①, ②)', q.answer, 1)}${text('accepted', '허용 표기', q.accepted, 1)}
            ${text('rubric', '채점 기준·루브릭', q.rubric)}${text('tests', '기대 출력·테스트 케이스', q.tests)}${text('explanation', '해설', q.explanation)}
            <div class="flex justify-end gap-2 pt-1">
                <button data-qbank-action="cancel" class="px-3 py-1 text-xs font-bold text-textLight bg-white/10 rounded">취소</button>
                <button data-qbank-action="save" data-index="${index}" class="px-3 py-1 text-xs font-bold text-white bg-accent rounded">저장</button>
            </div>
        </div>`;
}

function renderQbank() {
    const body = document.getElementById('qbank-body');
    const mod = qbankMod();
    if (!body || !mod) return;
    const questions = qbankQuestions(mod);
    const objectives = qbankObjectives(mod);
    const checklist = qbankChecklist(mod);
    const passed = questions.filter(q => !lintQuestion(q, checklist).length).length;
    const shown = questions.map((q, index) => ({ q, index })).filter(({ q }) => (!_qbank.band || q.band === _qbank.band) && (!_qbank.objective || q.objective === Number(_qbank.objective)));
    const select = 'px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white';
    body.innerHTML = `
        <div class="p-2 rounded-lg bg-black/20">${qbankDistributionHtml(questions, objectives)}<p class="text-[0.6rem] text-textMuted mt-1">권장: L1 10 · L2 5 · L3 3. L4는 프로젝트에서 다룹니다.</p></div>
        <div class="p-2 rounded-lg bg-black/20">${qbankFormHtml(objectives)}<p id="qbank-status" class="text-[0.65rem] text-accent mt-1 min-h-[1em]">${escapeHtml(_qbank.status)}</p></div>
        <div class="flex items-center gap-2">
            <span class="text-xs font-bold ${passed === questions.length ? 'text-emerald-400' : 'text-amber-400'}">검수 통과 ${passed}/${questions.length}</span>
            <select data-qbank-filter="band" class="${select} ml-auto">${qbankOption('', '전체 밴드', _qbank.band)}${Object.keys(QBANK_BANDS).map(band => qbankOption(band, band, _qbank.band)).join('')}</select>
            <select data-qbank-filter="objective" class="${select}">${qbankOption('', '전체 목표', _qbank.objective)}${objectives.map((_, i) => qbankOption(i + 1, `목표 ${i + 1}`, _qbank.objective)).join('')}</select>
            <button data-qbank-action="csv" class="px-2 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20">CSV 저장</button>
            <button data-qbank-action="course-csv" class="px-2 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20">과정 전체 CSV</button>
        </div>
        <div class="space-y-2">${shown.map(({ q, index }) => (_qbank.editing === index ? qbankEditHtml(q, index, objectives) : qbankCardHtml(q, index, checklist))).join('') || '<p class="text-xs text-textMuted p-2">문항이 없습니다. 학습이해도 탭을 생성하거나 AI로 문항을 만들어주세요.</p>'}</div>
        <details class="text-[0.65rem] text-textMuted"><summary class="cursor-pointer">검사 규칙 목록</summary><ul class="mt-1 space-y-0.5">${QBANK_RULE_LIST.map(rule => `<li>• ${escapeHtml(rule)}</li>`).join('')}</ul></details>`;
}

window.openQuestionBank = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod?.tabContents) return window.showAlert('문제은행은 차시에서 사용할 수 있습니다.');
    if (document.getElementById('qbank-dialog')) return;
    const spec = { objective: 1, band: 'L1', type: '객관식', count: 3 };
    _qbank = { moduleId, band: '', objective: '', editing: null, status: '', spec, dirty: false, busy: false };
    const overlay = document.createElement('div');
    overlay.id = 'qbank-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[720px] max-h-[88vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10 flex items-center">
                <h2 class="text-sm font-bold text-textLight">문제은행 · ${escapeHtml(mod.title)}</h2>
                <button data-qbank-action="close" class="ml-auto px-3 py-1 text-xs font-bold text-textLight bg-white/10 rounded hover:bg-white/20">닫기</button>
            </div>
            <div id="qbank-body" class="flex-1 overflow-y-auto p-4 space-y-3"></div>
        </div>`;
    overlay.addEventListener('click', onQbankClick);
    overlay.addEventListener('change', onQbankChange);
    document.body.appendChild(overlay);
    renderQbank();
};

function onQbankChange(event) {
    const { qbankSpec, qbankFilter } = event.target.dataset || {};
    if (qbankFilter) _qbank = { ..._qbank, [qbankFilter]: event.target.value };
    if (qbankSpec) {
        const value = ['objective', 'count'].includes(qbankSpec) ? Number(event.target.value) : event.target.value;
        const spec = { ..._qbank.spec, [qbankSpec]: value };
        const types = QUESTION_BAND_TYPES[spec.band];
        _qbank = { ..._qbank, spec: { ...spec, type: types.includes(spec.type) ? spec.type : types[0] } };
    }
    if (qbankFilter || qbankSpec) renderQbank();
}

// 저장이 끝날 때까지 다음 쓰기를 막아, 낡은 화면 번호로 다른 문항을 고치지 않게 한다. 바꾸기 전 내용은 히스토리에 남긴다.
async function commitQbankMarkdown(mod, md) {
    const { moduleId } = _qbank;
    _qbank = { ..._qbank, busy: true };
    await archiveContent({ title: `${mod.title} · 학습이해도`, content: qbankMarkdown(mod), images: mod.images });
    mod.tabContents = { ...mod.tabContents, assessment: md };
    await saveState();
    if (_qbank?.moduleId !== moduleId) return renderEditor(mod);
    _qbank = { ..._qbank, busy: false, dirty: true, editing: null };
    renderQbank();
}

function readQuestionForm(original) {
    const value = name => document.querySelector(`[data-qbank-field="${name}"]`)?.value.trim() ?? '';
    const type = value('type');
    const texts = value('choices').split('\n').map(text => text.trim()).filter(Boolean);
    const marks = '①②③④⑤⑥⑦⑧⑨⑩';
    return {
        ...original,
        objective: Number(value('objective')) || null, band: value('band'), type, typed: original.typed || type !== original.type,
        title: value('title'), stem: value('stem'),
        choices: !type || type === '객관식' ? texts.slice(0, marks.length).map((text, i) => ({ mark: marks[i], text })) : [],
        answer: value('answer'), accepted: value('accepted'), rubric: value('rubric'), tests: value('tests'), explanation: value('explanation'),
        review: '' // 사람이 고친 문항은 AI 검수 결과를 무효화한다
    };
}

function downloadCsv(csv, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${String(name).replace(/[^\w가-힣]/g, '_')}_문제은행.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function saveQbankCsv(mod) {
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    downloadCsv(questionsCsv(qbankQuestions(mod), qbankObjectives(mod), { subject: subject?.title || '', lesson: mod.title, checklist: qbankChecklist(mod) }), mod.title);
}

function saveCourseCsv() {
    const { rows, csv } = courseQuestionsCsv();
    if (!rows) return window.showAlert('내려받을 문항이 없습니다.');
    downloadCsv(csv, globalState.courseTitle);
}

async function runQuestionGenerate(mod) {
    const { moduleId, spec } = _qbank;
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
    const { dirty } = _qbank;
    const mod = qbankMod();
    document.getElementById('qbank-dialog')?.remove();
    _qbank = null;
    if (dirty && mod && typeof renderEditor === 'function') renderEditor(mod);
}

async function onQbankClick(event) {
    const action = event.target.dataset?.qbankAction;
    if (!action) return;
    if (action === 'close') return closeQbank();
    if (_qbank.busy) return;
    const mod = qbankMod();
    const index = Number(event.target.dataset.index);
    if (action === 'edit') _qbank = { ..._qbank, editing: index };
    if (action === 'cancel') _qbank = { ..._qbank, editing: null };
    if (action === 'csv') saveQbankCsv(mod);
    if (action === 'course-csv') saveCourseCsv();
    if (action === 'generate') return runQuestionGenerate(mod);
    if (action === 'delete') return window.showConfirm('이 문항을 삭제할까요? 삭제 전 내용은 히스토리에 보관됩니다.', () => commitQbankMarkdown(mod, removeQuestionMd(qbankMarkdown(mod), index)));
    if (action === 'save') return commitQbankMarkdown(mod, updateQuestionMd(qbankMarkdown(mod), index, readQuestionForm(qbankQuestions(mod)[index])));
    renderQbank();
}
