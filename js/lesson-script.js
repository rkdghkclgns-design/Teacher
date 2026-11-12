// lesson-script.js - 강사 대본: 기본학습·심화학습의 섹션마다 강의 경험이 없는 강사도 그대로 읽을 수 있는 말(합쇼체)과 짧은 행동 지시를 AI로 쓴다
// 이 파일은 계산만 맡는다: 섹션 나누기·열쇠·지문, 프롬프트, 답 읽기·검사, 저장 모양, 내려받을 MD. 화면(세로 2분할)과 만들기 실행은 lesson-script-view.js
// 나누기: 내용 ## 섹션마다 대본 하나. 첫머리(차시 제목·개요·학습 정보·학습 목표)는 '수업 시작' 대본 하나로, 학습 후 체크리스트는 '마무리' 대본으로 쓴다.
//  첫 내용 섹션 뒤에 나온 개요·학습 정보·학습 목표는 대본을 쓰지 않는다. 보낼 글이 길면(SCRIPT_CHUNK_CHARS) ### 소주제로 나눠(lesson-fix-run.js splitFixChunks) 조각마다 부르고 이어 붙인다.
// 저장: mod.lessonScripts = { basicLearn: { sections: [{ key, title, sourceHash, text, at, partial? }], updatedAt } }. 탭 글(tabContents)에는 넣지 않는다.
//  at: 쓴 시각. partial: 긴 섹션을 쓰다 멈춰 조각 일부만 쓴 대본 { done, parts }(다시 쓰면 남은 조각부터). 지금 글에 없는 열쇠의 대본(제목이 바뀐 대본)도 지우지 않는다.
//  key: 'opening'(수업 시작) · 'closing'(마무리) · 'c:' + 제목 키(내용 섹션, 같은 제목이 또 있으면 #2…). sourceHash: 대본을 쓸 때 그 섹션 글의 지문(그림·주석·간격은 보지 않는다).
//  지문이 지금 글과 다르면 화면이 그 섹션만 '교안이 바뀜'으로 보인다. 불러온 값은 data-safety.js safeLessonScripts가 탭·모양·크기를 맞춘다
// 기대는 것: lesson-editor-tools.js(mdSections), lesson-lint.js(LESSON_OVERVIEW_TITLE·LESSON_FRAME_TITLE·isLessonInfoTitle·lessonSectionKey·nextCodeFence),
//  lesson-opening.js(cleanLessonOpening), lesson-fix-run.js(splitFixChunks), tabs.js(tabSourceFor), filename-convention.js(lessonFileBase), course-sessions.js(downloadMd).
// 테스트: tests/lesson-script.test.js

const LESSON_SCRIPT_TABS = ['basicLearn', 'advLearn']; // data-safety.js SCRIPT_TAB_IDS와 같다
const SCRIPT_CHUNK_CHARS = 6000;          // 보낼 섹션 글이 이보다 길면 ### 소주제로 나눠 부른다
const SCRIPT_CHUNK_MIN = 1200;            // 이보다 작은 조각은 다음 조각과 붙여 보낸다(호출 수를 줄인다)
const SCRIPT_FRAME_MINUTES = 5;           // 시간 표시가 없는 수업 시작·마무리
const SCRIPT_READ_CHARS = 250;            // 시간 표시가 없는 내용 섹션의 시간을 어림할 때 쓰는 낭독 속도(lesson-lint.js READ_CHARS_PER_MINUTE와 같다)
const SCRIPT_SPEECH_PER_MINUTE = 150;     // 대본에 쓸 말의 글자/분. 화면을 보이고 질문을 기다리는 시간이 있어 낭독보다 적다
const SCRIPT_SPEECH_RANGE = [400, 3000];  // 호출 하나에 부탁하는 말 글자 수(최소, 최대)
const SCRIPT_MIN_BODY = 120;              // 이보다 짧은 본문은 받지 않는다
const SCRIPT_MAX_QUESTIONS = 2;
const SCRIPT_MAX_TIPS = 3;
const SCRIPT_MAX_TOKENS = 32768;
// 저장 크기(data-safety.js SCRIPT_FIELD_CHARS와 같다): 열쇠의 제목 키는 120자까지(#n을 붙여도 200자 안), 제목 300자, 대본 글 40,000자
const SCRIPT_KEY_CHARS = 120;
const SCRIPT_TITLE_CHARS = 300;
const SCRIPT_TEXT_CHARS = 40000;
const SCRIPT_MARKS = { intro: '@@시작@@', body: '@@본문@@', outro: '@@마무리@@', questions: '@@질문@@', tips: '@@막힐때@@', end: '@@끝@@' };
const SCRIPT_LABELS = { intro: '들어가며', body: '강의', outro: '넘어가며', questions: '예상 질문', tips: '막힐 때' };
const SCRIPT_TITLES = { opening: '수업 시작', closing: '마무리' };
const SCRIPT_NOTE = '이 대본은 교안을 바탕으로 AI가 쓴 초안입니다. 수업 전에 한 번 소리 내어 읽어 보고 말투와 예시를 다듬어 쓰세요.';
const SCRIPT_CUE_NOTE = '[대괄호] 안은 소리 내어 읽지 않고 하는 행동입니다.';
const SCRIPT_TIME_LABEL = /⏱\S*\s*(?:약\s*)?(\d+)\s*분/;
const SCRIPT_TAB_LIMIT = 80;              // 탭마다 남기는 대본 수(data-safety.js SCRIPT_SECTION_LIMIT와 같다). 넘으면 제목이 바뀐 대본의 오래된 것부터 버린다
const SCRIPT_PART_LIMIT = 50;             // 조각을 일부 써 둔 대본에 적는 조각 수 상한(data-safety.js와 같다)
// 마크다운이 HTML 블록으로 그리는 줄(줄 앞 빈칸 3칸까지 뒤의 <태그·<!--·</). 내려받는 MD에서는 이 줄의 < 앞에 \를 붙여 글자로 둔다
const SCRIPT_MD_HTML_LINE = /^( {0,3})<(?=[A-Za-z!/?])/gm;

/* ---------- 섹션 나누기 ---------- */
const scriptMinutesOf = title => Number((String(title || '').match(SCRIPT_TIME_LABEL) || [])[1] || 0);
// 제목에서 (⏱ N분)을 뗀 글
const scriptCleanTitle = title => String(title || '').replace(/\s*[(（]\s*⏱[^)）]*[)）]\s*/g, ' ').replace(/\s+/g, ' ').trim();
const scriptTabLabel = tabId => (typeof LESSON_TABS !== 'undefined' && LESSON_TABS.find(tab => tab.id === tabId)?.label) || (tabId === 'advLearn' ? '심화학습' : '기본학습');
const isScriptTab = tabId => LESSON_SCRIPT_TABS.includes(tabId);

// 섹션 종류: head(첫 ## 앞 글) · frame(개요·학습 정보·학습 목표) · checklist(학습 후 체크리스트) · content(내용 섹션)
function scriptSectionKind(title) {
    if (!title) return 'head';
    if (LESSON_OVERVIEW_TITLE.test(title) || isLessonInfoTitle(title)) return 'frame';
    if (LESSON_FRAME_TITLE.test(title)) return /체크리스트/.test(title) ? 'checklist' : 'frame';
    return 'content';
}

// 코드 블록 밖의 그림·그림 자리·주석·동영상 줄과 <br>만 남은 줄을 뺀 글. AI에 보내는 글이자 지문을 재는 글이다(그림을 채워도 대본이 낡지 않게)
function scriptPlainSource(text) {
    const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let prose = [];
    let fence = 0;
    const flush = () => {
        if (prose.length) out.push(cleanScriptProse(prose.join('\n')));
        prose = [];
    };
    lines.forEach(line => {
        const was = fence;
        fence = nextCodeFence(fence, line);
        if (!was && !fence) return void prose.push(line);
        flush();
        out.push(line.replace(/[ \t]+$/, ''));
    });
    flush();
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const cleanScriptProse = text => text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^[ \t]*<(?:img|video|iframe|figure)\b[^\n]*$/gim, '')
    .replace(/^[ \t]*<div class="(?:image-[\w-]+|lesson-video[\w-]*)"[^\n]*$/gim, '')
    .replace(/^[ \t]*(?:<br\s*\/?>[ \t]*)+$/gim, '')
    .replace(/[ \t]+$/gm, '');

// 섹션 글의 지문: 'djb2 해시-글자 수'(36진수). data-safety.js SCRIPT_HASH_RE 모양이다
function scriptHash(text) {
    const source = scriptPlainSource(text);
    let hash = 5381;
    for (let i = 0; i < source.length; i++) hash = ((hash * 33) ^ source.charCodeAt(i)) >>> 0;
    return `${hash.toString(36)}-${source.length.toString(36)}`;
}

// 시간 표시가 없는 내용 섹션의 시간(5분 단위로 어림, 5분 이상)
const scriptGuessMinutes = text => Math.max(SCRIPT_FRAME_MINUTES, Math.round(scriptPlainSource(text).length / SCRIPT_READ_CHARS / 5) * 5);

// 같은 열쇠가 또 나오면 #2, #3을 붙인다
function uniqueScriptKey(base, used) {
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}#${n}`;
    used.add(key);
    return key;
}

// 탭 글을 대본 줄로 나눈다(화면에 보이는 글, 첫머리 정리를 거친 글로 센다) → [{ key, kind, title, titles, minutes, estimated, text, hash, scripted }]
// kind: opening(수업 시작: 첫 내용 섹션 앞의 모든 섹션) · content · closing(체크리스트) · frame(첫 내용 섹션 뒤의 개요·학습 정보·학습 목표, 대본 없음)
function lessonScriptRows(md) {
    const source = String(md ?? '');
    const display = typeof cleanLessonOpening === 'function' ? cleanLessonOpening(source) || '' : source;
    const sections = mdSections(display).filter(section => section.text.trim());
    const kinds = sections.map(section => scriptSectionKind(section.title));
    const firstContent = kinds.indexOf('content');
    const firstCheck = kinds.indexOf('checklist');
    const openEnd = firstContent >= 0 ? firstContent : firstCheck >= 0 ? firstCheck : sections.length;
    const used = new Set();
    const opening = sections.slice(0, openEnd);
    const rows = [];
    if (opening.length) {
        const text = opening.map(section => section.text).join('\n\n');
        const labelled = opening.reduce((sum, section) => sum + scriptMinutesOf(section.title), 0);
        rows.push({
            key: uniqueScriptKey('opening', used), kind: 'opening', title: SCRIPT_TITLES.opening, titles: opening.map(section => section.title).filter(Boolean),
            minutes: labelled || SCRIPT_FRAME_MINUTES, estimated: !labelled, text, hash: scriptHash(text), scripted: !!scriptPlainSource(text)
        });
    }
    sections.slice(openEnd).forEach((section, k) => {
        const kind = { content: 'content', checklist: 'closing' }[kinds[openEnd + k]] || 'frame';
        const labelled = scriptMinutesOf(section.title);
        const base = kind === 'closing' ? 'closing' : `${kind === 'frame' ? 'f' : 'c'}:${lessonSectionKey(section.title).slice(0, SCRIPT_KEY_CHARS) || openEnd + k}`;
        const minutes = labelled || (kind === 'content' ? scriptGuessMinutes(section.text) : kind === 'closing' ? SCRIPT_FRAME_MINUTES : 0);
        rows.push({
            key: uniqueScriptKey(base, used), kind, title: kind === 'closing' ? SCRIPT_TITLES.closing : section.title, titles: [section.title],
            minutes, estimated: !labelled && minutes > 0, text: section.text, hash: scriptHash(section.text), scripted: kind !== 'frame'
        });
    });
    return rows;
}

// 화면·MD에 보이는 줄 이름. 내용 섹션은 (⏱ N분)을 뗀 제목, 마무리는 체크리스트 제목을 붙인다
function scriptRowName(row) {
    if (row.kind === 'closing') return `${SCRIPT_TITLES.closing} · ${scriptCleanTitle(row.titles[0])}`;
    return row.kind === 'opening' ? SCRIPT_TITLES.opening : scriptCleanTitle(row.title);
}

// 차시 제목: 첫머리의 '# 📝 제목', 없으면 차시 이름
function scriptLessonTitle(rows, mod) {
    const head = rows.find(row => row.kind === 'opening');
    const line = head ? (head.text.match(/^#\s+(.+)$/m) || [])[1] : '';
    const title = String(line || '').replace(/[\u{1F300}-\u{1FAFF}☀-➿️]/gu, '').trim();
    return title || String(mod?.title || '').trim() || '차시';
}

// 줄마다 수업 안의 시작·끝 분(앞 줄의 시간을 더한다)
function scriptTimeline(rows) {
    let at = 0;
    return rows.map(row => {
        const start = at;
        at += row.minutes || 0;
        return { start, end: at };
    });
}

const scriptClock = minutes => (minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`);

// ⏱ 10분 · 수업 시작 후 15분~25분 (시간 표시가 없으면 '약')
function scriptTimeText(row, span) {
    const about = row.estimated ? '약 ' : '';
    return `⏱ ${about}${row.minutes}분 · 수업 시작 후 ${scriptClock(span.start)}~${scriptClock(span.end)}`;
}

/* ---------- 부를 조각 ---------- */
// 큰 글을 ### 소주제(그래도 크면 문단 묶음)로 나눈다. lesson-fix-run.js가 없으면(테스트 일부) ### 줄에서만 자른다. 작은 조각은 다음 조각과 붙인다
function scriptChunks(text) {
    const pieces = typeof splitFixChunks === 'function' ? splitFixChunks(text, SCRIPT_CHUNK_CHARS) : scriptHeadingPieces(text);
    return pieces.map(piece => piece.trim()).filter(Boolean).reduce((list, piece) => {
        const prev = list[list.length - 1];
        if (prev !== undefined && (prev.length < SCRIPT_CHUNK_MIN || piece.length < SCRIPT_CHUNK_MIN) && prev.length + piece.length + 2 <= SCRIPT_CHUNK_CHARS) {
            return [...list.slice(0, -1), `${prev}\n\n${piece}`];
        }
        return [...list, piece];
    }, []);
}

function scriptHeadingPieces(text) {
    const lines = String(text).split('\n');
    let fence = 0;
    const heads = [0];
    lines.forEach((line, no) => {
        const was = fence;
        fence = nextCodeFence(fence, line);
        if (no > 0 && !was && !fence && /^###\s/.test(line)) heads.push(no);
    });
    return heads.map((start, k) => lines.slice(start, heads[k + 1] ?? lines.length).join('\n'));
}

// 줄 하나를 부를 조각으로 → [{ row, part, parts, text, minutes, label }]. 조각의 시간은 글 길이로 나눈다(1분 이상)
function scriptRowUnits(row) {
    const source = scriptPlainSource(row.text);
    const pieces = source.length > SCRIPT_CHUNK_CHARS ? scriptChunks(source) : [source];
    const total = pieces.reduce((sum, piece) => sum + piece.length, 0) || 1;
    return pieces.map((piece, part) => ({
        row, part, parts: pieces.length, text: piece,
        minutes: pieces.length > 1 ? Math.max(1, Math.round(row.minutes * piece.length / total)) : Math.max(1, row.minutes),
        label: ((piece.match(/^###\s+(.+)$/m) || [])[1] || '').trim()
    }));
}

const scriptSpeechChars = minutes => Math.min(SCRIPT_SPEECH_RANGE[1], Math.max(SCRIPT_SPEECH_RANGE[0], Math.round(minutes * SCRIPT_SPEECH_PER_MINUTE / 50) * 50));

/* ---------- 프롬프트 ---------- */
function scriptSystemInstruction() {
    const persona = typeof CONTEXT_CORE !== 'undefined' ? CONTEXT_CORE?.personas?.instructor || '' : '';
    return [
        `${persona} 강의 경험이 전혀 없는 초보 강사가 교안 화면을 띄워 두고 그대로 읽으며 수업할 수 있는 강의 대본을 씁니다.`.trim(),
        '- 지정된 출력 형식만 출력하고 머리말·맺음말·설명을 붙이지 않습니다.',
        '- 말은 학생에게 건네는 공손한 합쇼체로 씁니다.',
        '- 교안에 있는 내용만 말하고, 교안에 없는 사실·수치·예시를 지어내지 않습니다.'
    ].join('\n');
}

const SCRIPT_ROLE_RULES = {
    opening: '이 부분은 수업을 여는 부분입니다. @@시작@@에는 인사와 오늘 차시 소개를, @@본문@@에는 개요(왜 배우는지)와 학습 목표를 학생에게 풀어 말하고 [오늘 수업 순서]를 짧게 안내하는 말을 씁니다. 학습 정보(시간·선행·사용 툴)는 필요한 것만 짧게 알립니다.',
    closing: '이 부분은 수업을 맺는 부분입니다. @@본문@@에는 체크리스트 항목을 학생과 하나씩 확인하는 말을 쓰고, 자신 없는 항목은 적힌 다시 보기 섹션으로 돌아가 보라고 안내합니다. @@마무리@@에는 수고했다는 인사로 수업을 마치는 말을 씁니다.'
};

// 조각을 나눈 섹션의 이음 규칙
function scriptPieceRule(unit) {
    if (unit.parts < 2) return '';
    return [
        '이 섹션은 길어서 조각으로 나눠 씁니다. 조각마다의 대본을 차례로 이어 붙여 한 섹션의 대본이 됩니다.',
        unit.part > 0 ? '@@시작@@에는 앞 조각에서 이어지는 한 문장만 씁니다.' : '',
        unit.part < unit.parts - 1 ? '@@마무리@@에는 다음 조각으로 넘어가는 한 문장만 씁니다.' : '',
        '예상 질문은 이 조각 내용으로 1개만 씁니다.'
    ].filter(Boolean).join(' ');
}

// 조각 하나의 프롬프트. context: { lessonTitle, tabLabel, prevTitle, nextTitle, outline(내용 섹션 이름, 수업 시작에만), again(다시 부탁하는 까닭) }
function buildScriptPrompt(unit, { lessonTitle = '', tabLabel = '', prevTitle = '', nextTitle = '', outline = [], again = '' } = {}) {
    const { row } = unit;
    const name = scriptRowName(row);
    const chunked = unit.parts > 1;
    const where = chunked ? `«${name}» 섹션을 나눈 ${unit.parts}조각 가운데 ${unit.part + 1}번째 조각${unit.label ? `(${unit.label})` : ''}` : `«${name}»`;
    const prev = chunked && unit.part > 0 ? `같은 섹션의 앞 조각` : prevTitle;
    const next = chunked && unit.part < unit.parts - 1 ? `같은 섹션의 다음 조각` : nextTitle;
    const chars = scriptSpeechChars(unit.minutes);
    const extra = [SCRIPT_ROLE_RULES[row.kind], scriptPieceRule(unit)].filter(Boolean);
    return [
        '아래 [교안 부분]을 강의 경험이 없는 강사가 수업에서 그대로 읽을 대본으로 바꾸세요. 아래 형식만 출력합니다. 표시 줄(@@…@@)은 글자를 바꾸지 말고 한 줄에 하나씩 씁니다.',
        '',
        SCRIPT_MARKS.intro,
        '(이 부분에 들어가며 하는 말. 앞 부분에서 이어 받는 1~2문장)',
        SCRIPT_MARKS.body,
        '(강사가 소리 내어 읽을 말. 말 사이사이에 하는 행동을 대괄호로 짧게 넣습니다)',
        SCRIPT_MARKS.outro,
        '(이 부분을 한 문장으로 정리하고 다음 부분으로 넘기는 1~2문장)',
        SCRIPT_MARKS.questions,
        'Q: (학생이 할 만한 질문)',
        'A: (짧은 답 1~2문장)',
        SCRIPT_MARKS.tips,
        '- (학생이 막히거나 따라오지 못할 때 강사가 할 일. 한 줄에 하나)',
        SCRIPT_MARKS.end,
        '',
        '[작성 규칙]',
        '- 말은 학생에게 건네는 공손한 합쇼체(~입니다, ~합니다, ~하겠습니다, ~해 보시겠습니까?)로 씁니다. 반말과 해요체를 쓰지 않습니다.',
        '- 행동 지시는 말하지 않고 하는 일이라 대괄호 안에 짧게 씁니다. 예: [화면: 코드 블록을 띄운다] [판서: 입력 → 갱신 → 그리기] [질문하고 10초 기다린다] [실습 시작 — 학생 화면 확인]',
        `- 이 부분의 수업 시간은 ${unit.minutes}분입니다. @@본문@@의 말은 공백 포함 약 ${chars}자로 쓰고, ${unit.minutes}분 안에 끝나게 중간에 [⏱ 약 N분 지점] 같은 시간 확인 지시를 한두 번 넣습니다.`,
        '- 코드는 한 줄씩 읽지 않습니다. [화면: …]으로 코드를 띄우고, 무엇을 하는 코드인지와 눈여겨볼 곳(함수 이름·핵심 줄)을 가리키며 말합니다. 대본 안에 코드 블록(```)을 쓰지 않습니다.',
        '- 표·그림·다이어그램은 [화면: …]으로 띄우고 무엇을 보면 되는지 말합니다.',
        '- [교안 부분]에 있는 내용만 말합니다. 교안에 없는 사실·수치·예시·도구 이름을 지어내지 않고, 다른 차시 이름도 지어내지 않습니다.',
        '- 예상 질문은 1~2개, 답은 [교안 부분]에 있는 내용으로만 짧게 씁니다. 막힐 때 할 일은 1~3개 씁니다.',
        '- 제목(#)·표(|)·HTML 태그를 쓰지 않습니다.',
        ...extra.map(rule => `- ${rule}`),
        '',
        `[차시] ${lessonTitle}${tabLabel ? ` (${tabLabel})` : ''}`,
        `[이 부분] ${where} · ${unit.minutes}분`,
        `[앞 부분] ${prev || '없음(수업의 처음)'}`,
        `[다음 부분] ${next || '없음(수업의 끝)'}`,
        ...(row.kind === 'opening' && outline.length ? ['[오늘 수업 순서]', ...outline.map((title, i) => `${i + 1}. ${title}`)] : []),
        '[교안 부분]',
        unit.text,
        ...(again ? ['', `[다시 쓰기] 앞의 답은 쓸 수 없었습니다: ${again} 형식과 규칙을 지켜 처음부터 다시 쓰세요.`] : [])
    ].join('\n');
}

/* ---------- 답 읽기·검사 ---------- */
// 표시 줄을 고른다: '**@@본문@@**'의 굵게, '@@막힐 때@@'의 빈칸
const normalizeScriptMarks = text => String(text ?? '').replace(/\r\n/g, '\n')
    .replace(/\*{1,2}\s*(@@[^@\n]{1,12}@@)\s*\*{1,2}/g, '$1')
    .replace(/@@\s*([^@\n]{1,12}?)\s*@@/g, (whole, inner) => `@@${inner.replace(/\s+/g, '')}@@`);

// 표시 뒤부터 다음 표시 앞까지. 표시가 없으면 null
function scriptBlock(text, mark) {
    const at = text.indexOf(mark);
    if (at < 0) return null;
    const rest = text.slice(at + mark.length);
    const ends = Object.values(SCRIPT_MARKS).map(other => rest.indexOf(other)).filter(i => i >= 0);
    return rest.slice(0, ends.length ? Math.min(...ends) : rest.length);
}

// 말 줄 정리: 남은 표시·제목 기호를 떼고, 표 줄과 형식 설명 '(…)' 줄은 뺀다.
// 글은 AI가 쓴 그대로 둔다(<div>·vector<int> 같은 글도 지우지 않는다). 화면은 이스케이프해 그리고(scriptTextHtml), 내려받는 MD는 HTML 블록 줄만 글자로 바꾼다
function cleanScriptLines(block) {
    const lines = String(block ?? '').split('\n')
        .map(line => line.replace(/@@[^@\n]*@@/g, '').replace(/^\s*#{1,6}\s+/, '').replace(/[ \t]+$/, ''))
        .filter(line => !/^\s*\|/.test(line) && !/^\s*\(.*\)\s*$/.test(line));
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 예상 질문: Q:·A: 줄을 짝짓는다(질문:·답: 도 받는다). 이어지는 줄은 앞 줄에 붙인다
function scriptQuestions(block) {
    const pairs = [];
    let side = '';
    cleanScriptLines(block).split('\n').forEach(raw => {
        const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*/g, '').trim();
        if (!line) return;
        const q = line.match(/^(?:Q|질문)\s*\d*\s*[:：.)]\s*(.*)$/i);
        const a = line.match(/^(?:A|답변|답)\s*\d*\s*[:：.)]\s*(.*)$/i);
        if (q) {
            pairs.push({ q: q[1].trim(), a: '' });
            side = 'q';
        } else if (a && pairs.length) {
            pairs[pairs.length - 1] = { ...pairs[pairs.length - 1], a: `${pairs[pairs.length - 1].a} ${a[1]}`.trim() };
            side = 'a';
        } else if (side && pairs.length) {
            const last = pairs[pairs.length - 1];
            pairs[pairs.length - 1] = { ...last, [side]: `${last[side]} ${line}`.trim() };
        }
    });
    return pairs.filter(pair => pair.q && pair.a);
}

// 막힐 때 할 일: 글머리 줄마다 하나. 글머리 없는 줄은 앞 항목에 붙인다(첫 항목이면 항목으로). 같은 말은 하나만
function scriptTips(block) {
    const items = cleanScriptLines(block).split('\n').reduce((list, raw) => {
        const bullet = raw.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
        const text = (bullet ? bullet[1] : raw).replace(/\*\*/g, '').trim();
        if (!text) return list;
        if (bullet || !list.length) return [...list, text];
        return [...list.slice(0, -1), `${list[list.length - 1]} ${text}`];
    }, []);
    const key = text => text.replace(/[\s\p{P}\p{S}]+/gu, '');
    return items.filter((item, i) => items.findIndex(other => key(other) === key(item)) === i);
}

// 말의 끝맺음 비율: formal(합쇼체 ~니다·~니까·~시오·~시다), soft(~요·~죠), 그 밖은 반말로 본다. 대괄호 지시는 세지 않는다
function scriptToneShare(text) {
    const speech = String(text || '').replace(/\[[^\]\n]*\]/g, ' ');
    const ends = [...speech.matchAll(/([가-힣]{1,3})\s*[.?!](?=["'”’)\s]|$)/g)].map(match => match[1]);
    if (!ends.length) return { ends: 0, formal: 1, soft: 0, banmal: 0 };
    const formal = ends.filter(end => /(?:니다|니까|시오|시다)$/.test(end)).length / ends.length;
    const soft = ends.filter(end => /(?:요|죠)$/.test(end)).length / ends.length;
    return { ends: ends.length, formal, soft, banmal: Math.max(0, 1 - formal - soft) };
}

// AI 답 → { intro, body, outro, questions, tips } 또는 { error }. 뚜렷하게 망가진 답만 받지 않는다(한 번 더 부탁한다):
// 출력 한도에서 끊김·표시 없음·끝 표시 없음·코드 블록·너무 짧은 본문·빈 이음 말·합쇼체가 아님·(내용 섹션에서) 예상 질문이나 막힐 때가 없음.
// opts: { kind, needIntro, needOutro, target(부탁한 말 글자 수), truncated }
function parseScriptAnswer(answer, { kind = 'content', needIntro = true, needOutro = true, target = 0, truncated = false } = {}) {
    if (truncated) return { error: '답이 출력 한도에서 끊겼습니다.' };
    const text = normalizeScriptMarks(answer);
    if (!text.includes(SCRIPT_MARKS.body)) return { error: '형식 표시(@@본문@@)가 없습니다.' };
    if (!text.includes(SCRIPT_MARKS.end)) return { error: '끝 표시(@@끝@@)가 없어 끊긴 답으로 봅니다.' };
    if (!text.includes(SCRIPT_MARKS.intro) || !text.includes(SCRIPT_MARKS.outro)) return { error: '형식 표시(@@시작@@·@@마무리@@)가 없습니다.' };
    const raw = name => scriptBlock(text, SCRIPT_MARKS[name]) ?? '';
    if (['intro', 'body', 'outro', 'questions', 'tips'].some(name => /```|~~~/.test(raw(name)))) {
        return { error: '대본에 코드 블록(```)을 썼습니다. 코드는 한 줄씩 읽지 않고 화면에 띄워 가리키며 말합니다.' };
    }
    const [intro, body, outro] = ['intro', 'body', 'outro'].map(name => cleanScriptLines(raw(name)));
    const least = Math.max(SCRIPT_MIN_BODY, Math.round(target * 0.25));
    if (body.length < least) return { error: `본문 대본이 너무 짧습니다(${body.length}자, ${least}자 이상 필요).` };
    if (needIntro && !intro) return { error: '들어가는 말(@@시작@@)이 비었습니다.' };
    if (needOutro && !outro) return { error: '넘어가는 말(@@마무리@@)이 비었습니다.' };
    const tone = scriptToneShare([intro, body, outro].join('\n'));
    if (tone.ends >= 4 && (tone.formal < 0.4 || tone.banmal > 0.25)) return { error: '말이 공손한 합쇼체(~입니다, ~합니다)가 아닙니다.' };
    const questions = scriptQuestions(raw('questions')).slice(0, SCRIPT_MAX_QUESTIONS);
    const tips = scriptTips(raw('tips')).slice(0, SCRIPT_MAX_TIPS);
    if (kind === 'content' && !questions.length) return { error: '예상 질문(Q·A)이 없습니다.' };
    if (kind === 'content' && !tips.length) return { error: '막힐 때 할 일이 없습니다.' };
    return { intro, body, outro, questions, tips };
}

// 조각들의 대본을 잇는다: 첫 조각의 들어가는 말, 본문(뒤 조각의 이음 말을 사이에 넣는다), 마지막 조각의 넘어가는 말. 질문은 조각마다 하나씩 먼저 고른다
function joinScriptParts(parts) {
    const last = parts.length - 1;
    const body = parts.flatMap((part, i) => [i > 0 ? part.intro : '', part.body, i < last ? part.outro : '']).filter(Boolean).join('\n\n');
    const questions = [0, 1].flatMap(i => parts.map(part => part.questions[i]).filter(Boolean)).slice(0, SCRIPT_MAX_QUESTIONS);
    const tips = parts.flatMap(part => part.tips);
    const key = text => text.replace(/[\s\p{P}\p{S}]+/gu, '');
    return {
        intro: parts[0].intro, body, outro: parts[last].outro, questions,
        tips: tips.filter((tip, i) => tips.findIndex(other => key(other) === key(tip)) === i).slice(0, SCRIPT_MAX_TIPS)
    };
}

// 저장하는 대본 글(### 이름 아래 말·지시·질문·할 일)
function scriptTextFrom(script) {
    const part = (label, lines) => (lines.length ? [`### ${label}`, ...lines, ''] : []);
    return [
        ...part(SCRIPT_LABELS.intro, script.intro ? [script.intro] : []),
        ...part(SCRIPT_LABELS.body, script.body ? [script.body] : []),
        ...part(SCRIPT_LABELS.outro, script.outro ? [script.outro] : []),
        ...part(SCRIPT_LABELS.questions, script.questions.flatMap((pair, i) => [...(i ? [''] : []), `Q. ${pair.q}`, `A. ${pair.a}`])),
        ...part(SCRIPT_LABELS.tips, script.tips.map(tip => `- ${tip}`))
    ].join('\n').trim();
}

// 저장한 대본 글을 다시 읽는다(### 이름 아래 글) → { intro, body, outro, questions, tips }. 조각을 일부 써 둔 대본을 이어 쓸 때 앞 조각들을 한 조각으로 다시 잇는다
// (말 줄은 cleanScriptLines가 # 기호를 떼어 ### 이름 줄과 섞이지 않는다)
function scriptPartFromText(text) {
    const names = Object.keys(SCRIPT_LABELS);
    const blocks = String(text ?? '').replace(/\r\n/g, '\n').split('\n').reduce((acc, line) => {
        const head = line.match(/^###\s+(.+?)\s*$/);
        const name = head ? names.find(item => SCRIPT_LABELS[item] === head[1]) : '';
        if (name) return { ...acc, current: name, [name]: [] };
        return acc.current ? { ...acc, [acc.current]: [...acc[acc.current], line] } : acc;
    }, { current: '' });
    const block = name => (blocks[name] || []).join('\n').trim();
    return { intro: block('intro'), body: block('body'), outro: block('outro'), questions: scriptQuestions(block('questions')), tips: scriptTips(block('tips')) };
}

/* ---------- 저장 ---------- */
// 조각을 일부 써 둔 대본의 표시 { done(쓴 조각 수), parts(모든 조각 수) }
const isScriptPartial = value => !!value && typeof value === 'object' && Number.isInteger(value.done) && Number.isInteger(value.parts) && value.done >= 1 && value.done < value.parts && value.parts <= SCRIPT_PART_LIMIT;
const isScriptEntry = item => !!item && typeof item === 'object' && typeof item.key === 'string' && typeof item.text === 'string' && typeof item.sourceHash === 'string'
    && (item.partial === undefined || isScriptPartial(item.partial));

// 그 탭의 대본 { sections, updatedAt }. 없거나 모양이 틀리면 빈 목록
function lessonScriptTab(mod, tabId) {
    const tab = mod?.lessonScripts && typeof mod.lessonScripts === 'object' ? mod.lessonScripts[tabId] : null;
    const sections = tab && Array.isArray(tab.sections) ? tab.sections.filter(isScriptEntry) : [];
    return { sections, updatedAt: typeof tab?.updatedAt === 'string' ? tab.updatedAt : '' };
}

// 줄의 상태: none(대본을 쓰지 않는 줄) · missing(대본 없음) · partial(조각을 일부만 썼다. 이어 쓴다) · current · outdated(대본을 쓴 뒤 교안이 바뀌었다)
function scriptRowState(row, entry) {
    if (!row.scripted) return 'none';
    if (!entry) return 'missing';
    if (entry.sourceHash !== row.hash) return 'outdated';
    return entry.partial ? 'partial' : 'current';
}

// 이어 쓸 조각. 같은 글로 조각을 일부 써 둔 대본이면 남은 조각만, 아니면 모든 조각
function scriptRemainingUnits(row, entry) {
    const units = scriptRowUnits(row);
    const resume = !!entry?.partial && entry.sourceHash === row.hash && entry.partial.parts === units.length;
    return resume ? units.slice(entry.partial.done) : units;
}

// 지금 글의 줄과 저장된 대본을 짝지은 계획 → { rows, entries(줄 열쇠 → 대본), states, missing(대본이 없거나 조각을 일부만 쓴 줄), partial, outdated, written(다 쓴 줄 수),
// scripted, orphans(지금 글에 그 열쇠의 줄이 없는 대본: 섹션 제목이 바뀌었거나 섹션을 지웠다) }
function lessonScriptPlan(mod, tabId) {
    const rows = lessonScriptRows(typeof tabSourceFor === 'function' ? tabSourceFor(mod, tabId) : mod?.tabContents?.[tabId] || '');
    const sections = lessonScriptTab(mod, tabId).sections;
    const stored = new Map(sections.map(entry => [entry.key, entry]));
    const live = new Set(rows.map(row => row.key));
    const entries = new Map(rows.filter(row => row.scripted && stored.has(row.key)).map(row => [row.key, stored.get(row.key)]));
    const states = new Map(rows.map(row => [row.key, scriptRowState(row, entries.get(row.key))]));
    const pick = (...wanted) => rows.filter(row => wanted.includes(states.get(row.key)));
    return {
        rows, entries, states, missing: pick('missing', 'partial'), partial: pick('partial'), outdated: pick('outdated'), written: pick('current', 'outdated').length,
        scripted: rows.filter(row => row.scripted), orphans: sections.filter(entry => !live.has(entry.key))
    };
}

// 대본 하나를 넣은 새 lessonScripts(차시 객체는 바꾸지 않는다). 지금 글의 줄 차례로 두고, 지금 글에 없는 줄의 대본(제목이 바뀐 대본)은 버리지 않고 뒤에 둔다.
// 탭마다 SCRIPT_TAB_LIMIT개를 넘으면 제목이 바뀐 대본 가운데 오래된 것(시각이 없으면 가장 오래된 것으로 본다)부터 뺀다.
// entry.partial: 조각을 일부만 쓴 대본 { done, parts }
function withLessonScript(mod, tabId, entry, rows, at = new Date().toISOString()) {
    const all = mod?.lessonScripts && typeof mod.lessonScripts === 'object' ? mod.lessonScripts : {};
    const stored = lessonScriptTab(mod, tabId).sections.filter(item => item.key !== entry.key);
    const fresh = {
        key: entry.key, title: String(entry.title ?? '').slice(0, SCRIPT_TITLE_CHARS), sourceHash: entry.sourceHash, text: entry.text, at,
        ...(isScriptPartial(entry.partial) ? { partial: { done: entry.partial.done, parts: entry.partial.parts } } : {})
    };
    const byKey = new Map([...stored, fresh].map(item => [item.key, item]));
    const live = new Set(rows.map(row => row.key));
    const matched = rows.filter(row => byKey.has(row.key)).map(row => byKey.get(row.key));
    const orphans = [...byKey.values()].filter(item => !live.has(item.key))
        .map((item, order) => ({ item, order }))
        .sort((a, b) => String(a.item.at || '').localeCompare(String(b.item.at || '')) || a.order - b.order)
        .map(({ item }) => item);
    const room = Math.max(0, SCRIPT_TAB_LIMIT - matched.length);
    const kept = orphans.slice(Math.max(0, orphans.length - room)); // 오래된 것부터 뺀다
    return { ...all, [tabId]: { sections: [...matched, ...kept].slice(0, SCRIPT_TAB_LIMIT), updatedAt: at } };
}

/* ---------- 내려받기 ---------- */
// 내려받는 MD에 넣는 대본 글. 글은 그대로 두고, 마크다운이 HTML 블록으로 그릴 줄만 < 앞에 \를 붙여 글자로 둔다(줄 가운데의 vector<int> 같은 글은 그대로)
const scriptMarkdownText = text => String(text ?? '').trim().replace(SCRIPT_MD_HTML_LINE, '$1\\<');

// 내려받을 MD: 차시 제목, 안내, 줄마다 이름·시간·대본(대본이 없으면 그렇다고, 바뀌었거나 일부만 썼으면 알린다). 끝에 제목이 바뀐 대본을 붙인다
function lessonScriptMarkdown(mod, tabId) {
    const plan = lessonScriptPlan(mod, tabId);
    const times = scriptTimeline(plan.rows);
    const lines = [`# ${scriptLessonTitle(plan.rows, mod)} — ${scriptTabLabel(tabId)} 강사 대본`, '', `> ${SCRIPT_NOTE}`, `> ${SCRIPT_CUE_NOTE}`, ''];
    plan.rows.forEach((row, i) => {
        if (!row.scripted) return;
        const entry = plan.entries.get(row.key);
        const state = plan.states.get(row.key);
        lines.push(`## ${scriptRowName(row)}`, '', `- 시간: ${scriptTimeText(row, times[i])}`);
        if (row.kind === 'opening' && row.titles.length) lines.push(`- 교안: ${row.titles.map(scriptCleanTitle).join(' · ')}`);
        if (state === 'outdated') lines.push('- ⚠ 이 대본을 쓴 뒤 교안이 바뀌었습니다. 앱의 대본보기에서 이 섹션만 다시 만들 수 있습니다.');
        if (state === 'partial') lines.push(`- ⚠ 조각 ${entry.partial.done}/${entry.partial.parts}까지만 쓴 대본입니다. 앱의 대본보기에서 남은 조각을 이어 쓸 수 있습니다.`);
        lines.push('', entry ? scriptMarkdownText(entry.text) : '_아직 대본이 없습니다. 앱의 대본보기에서 만들 수 있습니다._', '', '---', '');
    });
    plan.orphans.forEach(entry => {
        lines.push(`## 제목이 바뀐 대본 · ${entry.title || entry.key}`, '', '- 교안에서 이 섹션의 제목이 바뀌었거나 섹션이 지워져 지금 섹션과 짝짓지 못한 대본입니다.', '', scriptMarkdownText(entry.text), '', '---', '');
    });
    return `${lines.join('\n').trimEnd()}\n`;
}

// {차시 파일 이름}_{기본학습|심화학습}_대본 (downloadMd가 .md를 붙인다)
const lessonScriptFileName = (mod, tabId, subject) => `${lessonFileBase(mod, subject)}_${scriptTabLabel(tabId)}_대본`;

/* ---------- 화면에 그릴 대본 ---------- */
const scriptEscape = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// 줄 안의 [행동 지시]를 표시한다(먼저 이스케이프한 글이라 지시 안의 글도 글자로만 나온다)
const scriptInlineHtml = text => scriptEscape(text).replace(/\[([^[\]\n]{1,200})\]/g, '<span class="ls-cue-inline">[$1]</span>');
const SCRIPT_LABEL_CLASS = { [SCRIPT_LABELS.intro]: 'ls-intro', [SCRIPT_LABELS.body]: 'ls-body', [SCRIPT_LABELS.outro]: 'ls-outro', [SCRIPT_LABELS.questions]: 'ls-questions', [SCRIPT_LABELS.tips]: 'ls-tips' };

// 저장한 대본 글 → HTML. 모든 글은 이스케이프한다(AI 답이라 HTML로 넣지 않는다). ### 이름 · [지시] 줄 · Q./A. · 글머리 목록 · 말 문단
function scriptTextHtml(text) {
    const out = [];
    let list = [];
    const flush = () => {
        if (list.length) out.push(`<ul class="ls-list">${list.map(item => `<li>${scriptInlineHtml(item)}</li>`).join('')}</ul>`);
        list = [];
    };
    String(text ?? '').replace(/\r\n/g, '\n').split('\n').forEach(raw => {
        const line = raw.trim();
        const head = line.match(/^#{1,6}\s+(.+)$/);
        const item = line.match(/^[-*•]\s+(.+)$/);
        const qa = line.match(/^([QA])[.:：]\s*(.+)$/);
        if (item) return void list.push(item[1]);
        flush();
        if (!line) return;
        if (head) return void out.push(`<h4 class="ls-label ${SCRIPT_LABEL_CLASS[head[1].trim()] || ''}">${scriptEscape(head[1].trim())}</h4>`);
        if (/^\[[^\]]+\]$/.test(line)) return void out.push(`<p class="ls-cue">${scriptEscape(line)}</p>`);
        if (qa) return void out.push(`<p class="ls-${qa[1].toLowerCase()}"><b>${qa[1]}.</b> ${scriptInlineHtml(qa[2])}</p>`);
        out.push(`<p class="ls-say">${scriptInlineHtml(line)}</p>`);
    });
    flush();
    return out.join('');
}

if (typeof window !== 'undefined') {
    Object.assign(window, { lessonScriptRows, lessonScriptPlan, scriptRowUnits, buildScriptPrompt, parseScriptAnswer, joinScriptParts, scriptTextFrom, scriptHash, lessonScriptMarkdown, scriptTextHtml });
}
