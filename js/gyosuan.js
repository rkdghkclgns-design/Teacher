// gyosuan.js - 교수안·슬라이드 편성안 생성과 강사뷰·슬라이드 스튜디오 연결
// 문서 양식과 조립은 develocket-slide(assets/generate.js @3a7303f)의 컨벤션을 따르고,
// 생성 프롬프트는 이 앱의 교안 생성 방식(페르소나·어투·참고 자료·멀티턴 few-shot)을 쓴다.
// 생성물은 차시에 mod.gyosuan = { docMd, deckMd, deckHtml, sourceKey, updatedAt } 으로 저장한다.

const GYOSUAN_MAX_SECTIONS = 14;
const GYOSUAN_SECTION_CHARS = 8000;
const GYOSUAN_INTRO_CHARS = 2000;
const GYOSUAN_REFERENCE_CHARS = 4000;
const GYOSUAN_CONCURRENCY = 3;
// 전개가 아닌 교안 머리말·강사 전용 섹션 (머리말은 교수안 머리말 작성 근거로만 쓴다)
const GYOSUAN_INTRO_TITLE = /학습\s*목표|^개요|들어가며/;
const GYOSUAN_SKIP_TITLE = /교강사 가이드|학습 후 체크리스트/;
const GYOSUAN_BLOCK_FORMAT =
    '**강사 활동**: (강사가 수업에서 실제로 할 행동 1~2문장)\n' +
    '**설명 내용**:\n- (강사가 설명할 내용을 항목으로. 비교·단계 정리는 마크다운 표도 가능)\n' +
    '**멘트 예시**: "(강사가 학생에게 건네듯 1~2문장)"\n' +
    '**학생 활동**: (학생이 할 일 한 문장)\n';

let _gyosuanRunning = false;
let _gyosuanEditingId = null;
let _gyosuanSaveTimer = null;

// 형식을 안정시키기 위한 멀티턴 예시 (규칙 문장만으로는 모델이 형식을 자주 벗어난다)
const GYOSUAN_FEWSHOT = [
    {
        role: 'user',
        parts: [{ text: '[섹션 제목] 훈련과 코칭\n[원고]\n교육에는 훈련과 코칭 두 접근이 있습니다. 훈련은 교수자 중심으로 지식과 기술을 전달하고, 코칭은 학습자 중심으로 성찰을 유도합니다. 이 과정은 코칭에 가깝습니다.' }]
    },
    {
        role: 'model',
        parts: [{ text:
            '@@GYOSUAN@@\n' +
            '**강사 활동**: 두 접근을 비교한 표를 화면에 띄우고, 지금까지 받아 온 교육이 어느 쪽에 가까운지 묻는다.\n\n' +
            '**설명 내용**:\n' +
            '- 교육에는 두 가지 접근이 있다. **훈련(Training)**과 **코칭(Coaching)**이다.\n\n' +
            '| 구분 | 훈련 | 코칭 |\n|---|---|---|\n| 중심 | 교수자 중심 | 학습자 중심 |\n| 목적 | 지식·기술 전달 | 성찰 유도 |\n\n' +
            '- 이 과정은 코칭에 더 가까운 성격이다. 강사가 정답을 떠먹여 주기보다 학생이 스스로 답을 찾도록 돕는다.\n\n' +
            '**멘트 예시**: "제가 정답을 다 알려 주는 수업이 아니에요. 여러분이 스스로 답을 찾도록 돕는 쪽이에요."\n\n' +
            '**학생 활동**: 자신이 받아 온 교육이 어느 쪽에 가까웠는지 말한다.\n' +
            '@@SLIDES@@\n' +
            "### 슬라이드 - 이 수업은 '코칭'에 가깝습니다\n" +
            '- 슬라이드 문구:\n' +
            '  - 훈련: 교수자 중심 · 지식 전달 · 정답 제시\n' +
            '  - 코칭: 학습자 중심 · 성찰 유도 · 정답 찾기\n' +
            '  - (하단) 답은 여러분 안에. 저는 끌어내는 역할\n' +
            '- 이미지/시각: 일방향 화살표(훈련) vs 양방향 화살표(코칭) 대비 도식\n' +
            '- 핵심 메시지: 스스로 답을 찾는 수업이다.'
        }]
    }
];

/* ---------- 원고 수집 ---------- */
function collectLessonSource(mod) {
    const tabs = LESSON_TABS.filter(t => t.id !== 'assessment');
    const parts = tabs
        .map(t => ({ practice: /Prac$/.test(t.id), text: mod.tabContents?.[t.id] }))
        .filter(p => p.text && p.text.trim());
    return parts.length || !mod.content ? parts : [{ practice: false, text: mod.content }];
}

function cleanGyosuanSource(md) {
    return stripInstructorCallouts(String(md)).replace(/\r\n/g, '\n')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function cleanSectionTitle(title) {
    const cleaned = title.replace(/\(?⏱[\s\S]*$/, '').replace(/^\d+(?:\.\d+)*[.)]\s*/, '').trim();
    return cleaned || title.trim();
}

function sectionMinutes(title) {
    const match = title.match(/⏱\S*\s*(\d+)\s*분/);
    return match ? Number(match[1]) : 0;
}

function splitLessonSections(parts) {
    const units = [];
    parts.forEach(part => {
        let current = null;
        cleanGyosuanSource(part.text).split('\n').forEach(line => {
            const heading = line.match(/^#{1,2}\s+(.+?)\s*$/);
            if (heading) {
                current = { title: cleanSectionTitle(heading[1]), minutes: sectionMinutes(heading[1]), practice: part.practice, text: '' };
                units.push(current);
            } else if (current) {
                current.text += line + '\n';
            }
        });
    });
    const intro = units.filter(u => GYOSUAN_INTRO_TITLE.test(u.title)).map(u => `${u.title}\n${u.text.trim()}`).join('\n\n');
    const sections = units.filter(u => u.text.trim().length > 30 && !GYOSUAN_INTRO_TITLE.test(u.title) && !GYOSUAN_SKIP_TITLE.test(u.title));
    return { intro, sections };
}

// 호출 수를 제한하기 위해 섹션이 많으면 이웃끼리 묶는다
function limitSections(sections) {
    if (sections.length <= GYOSUAN_MAX_SECTIONS) return sections;
    const size = Math.ceil(sections.length / GYOSUAN_MAX_SECTIONS);
    const merged = [];
    for (let i = 0; i < sections.length; i += size) {
        const group = sections.slice(i, i + size);
        merged.push({
            title: group[0].title,
            minutes: group.reduce((sum, s) => sum + s.minutes, 0),
            practice: group.some(s => s.practice),
            text: group.map(s => `### ${s.title}\n${s.text}`).join('\n')
        });
    }
    return merged;
}

function hashSource(parts) {
    let hash = 5381;
    const text = parts.map(p => p.text).join('\n');
    for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
    return String(hash);
}

/* ---------- AI 호출 ---------- */
function gyosuanSystemInstruction() {
    const tone = INSTRUCTOR_TONE_PRESETS.find(p => p.id === instructorTone);
    return [
        `${CONTEXT_CORE.personas.instructor} 직업훈련 교재 제작 전문가로서 강사가 그대로 들고 수업할 수 있는 교수안과 슬라이드 편성안을 씁니다.`,
        '[교수안 작성 규칙 — 콘텐츠 업무 설계]',
        '- 교안이 무엇을 배울지를 지정한다면 교수안은 어떻게 가르칠지를 씁니다. 교안 문장을 옮겨 적지 말고 강사의 행동과 말로 바꿉니다.',
        '- 각 전개는 강사가 실제로 설명할 내용 → 멘트 예시 → 학생 활동 순서로 씁니다.',
        '- 강사 활동·설명 내용·학생 활동은 "~한다"로 끝내고, 멘트 예시만 학생에게 건네는 말로 씁니다.' + (tone ? ` 멘트 예시 어투: ${tone.label}.` : ''),
        '- 학습 목표는 "~할 수 있다"로 끝내고 "이해한다·안다·익힌다"는 쓰지 않습니다.',
        '- 모호한 표현("상황에 맞게", "경우에 따라")은 판단 기준으로 바꿉니다.',
        '- 슬라이드 문구는 화면에 띄울 짧은 말만 쓰고, 설명 문장은 교수안에 둡니다.',
        '- 원고에 없는 사실은 지어내지 않습니다.',
        '- 지정된 출력 형식만 출력하고 머리말·맺음말을 붙이지 않습니다.'
    ].join('\n') + getReferenceContext(GYOSUAN_REFERENCE_CHARS);
}

async function askGyosuanModel(prompt, system, fewshot = []) {
    const data = await callGemini(TEXT_MODEL, {
        contents: [...fewshot, { role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: system }] }
    });
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.filter(p => !p.thought).map(p => p.text || '').join('');
}

async function mapLimited(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const run = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await worker(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
}

/* ---------- 머리말 ---------- */
function sectionListLine(section, index) {
    return `전개 ${index + 1}: ${section.practice ? '활동: ' : ''}${section.title}${section.minutes ? ` (${section.minutes}분)` : ''}`;
}

function buildMetaPrompt(info, sections) {
    return [
        '아래 차시의 교수안 머리말을 작성하세요. 아래 형식만 출력합니다.',
        '',
        '부제: (한 줄 부제)',
        '대상: (수강 대상)',
        '선행: (선행 학습, 없으면 없음)',
        '결과물: (학생이 만드는 산출물, 없으면 없음)',
        '교보제: (사용하는 자료·도구)',
        '[학습목표]',
        "- (4개 내외, 각 항목은 '~할 수 있다'로 끝남)",
        '[개요]',
        '(이 차시가 무엇을 왜 다루는지 2개 문단. 문단 사이는 빈 줄)',
        '[수업흐름]',
        '단계 | 시간 | 핵심',
        '(도입, 전개 묶음, 정리를 표의 행으로 3~6줄. 시간 합은 총 분량에 맞출 것)',
        '[준비물]',
        '- (강사가 수업 전에 챙길 것 3~5개)',
        '[산출물]',
        '- (학생 산출물과 제출 방법 1~3개)',
        '[평가]',
        '- (강사가 확인할 체크포인트 3~5개)',
        '[유의사항]',
        '- (강사가 유의할 점 3~6개)',
        '',
        `[교과목] ${info.subject}`,
        `[주제] ${info.topic}`,
        info.duration ? `[총 분량] ${info.duration}` : '',
        info.description ? `[차시 설명] ${info.description}` : '',
        info.intro ? `[교안 머리말]\n${info.intro.slice(0, GYOSUAN_INTRO_CHARS)}` : '',
        info.designBrief ? info.designBrief.trim() : '',
        `[전개 목록]\n${sections.map(sectionListLine).join('\n')}`
    ].filter(Boolean).join('\n');
}

function parseGyosuanMeta(text) {
    const meta = { 부제: '', 대상: '', 선행: '', 결과물: '', 교보제: '', 학습목표: [], 개요: [], 수업흐름: [], 준비물: [], 산출물: [], 평가: [], 유의사항: [] };
    let section = null;
    text.split('\n').forEach(raw => {
        const line = raw.trim();
        if (!line) return;
        const field = line.match(/^(부제|대상|선행|결과물|교보제)\s*[:：]\s*(.*)$/);
        if (field && !section) { meta[field[1]] = field[2].trim(); return; }
        const head = line.match(/^\[(학습목표|개요|수업흐름|준비물|산출물|평가|유의사항)\]/);
        if (head) { section = head[1]; return; }
        if (section === '개요') { meta.개요.push(line); return; }
        if (section === '수업흐름') {
            const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
            if (cells.length === 3 && cells[0] !== '단계' && !/^[-:]+$/.test(cells[0])) meta.수업흐름.push(cells);
            return;
        }
        const bullet = line.match(/^[-*]\s+(.*)$/);
        if (section && bullet) meta[section].push(bullet[1].trim());
    });
    return meta;
}

/* ---------- 도입·정리 ---------- */
function buildOpenClosePrompt(info, meta, sections) {
    return [
        '아래 차시의 도입과 정리 교수안을 작성하세요. 아래 형식만 출력합니다.',
        '',
        '@@INTRO@@',
        '제목: (학생의 호기심을 여는 도입 제목, 15자 내외)',
        GYOSUAN_BLOCK_FORMAT,
        '@@CLOSE@@',
        '제목: (정리 제목, 15자 내외)',
        GYOSUAN_BLOCK_FORMAT,
        `[주제] ${info.topic}`,
        `[학습 목표]\n${meta.학습목표.join('\n')}`,
        `[전개 목록]\n${sections.map(s => s.title).join('\n')}`
    ].join('\n');
}

function parseOpenCloseBlock(block) {
    const title = (block.match(/^제목\s*[:：]\s*(.+)$/m) || [])[1] || '';
    return { title: title.trim(), body: block.replace(/^제목\s*[:：].*$/m, '').trim() };
}

function parseOpenClose(text) {
    const introAt = text.indexOf('@@INTRO@@');
    const closeAt = text.indexOf('@@CLOSE@@');
    if (introAt === -1 || closeAt === -1) return { intro: parseOpenCloseBlock(text), close: { title: '', body: '' } };
    return {
        intro: parseOpenCloseBlock(text.slice(introAt + 9, closeAt)),
        close: parseOpenCloseBlock(text.slice(closeAt + 9))
    };
}

/* ---------- 전개 섹션 ---------- */
function buildSectionPrompt(section) {
    return [
        '아래 [원고]는 강의의 한 부분입니다. 완전 초보 수강생 대상으로 (1) 강사용 교수안 블록과 (2) 발표 슬라이드 1~2장을 작성하세요.',
        '아래 형식만 출력합니다.',
        '',
        '@@GYOSUAN@@',
        GYOSUAN_BLOCK_FORMAT.replace('**학생 활동**',
            (section.practice ? '**수행 내용(활동 단계)**:\n1. (학생이 따라 할 단계를 순서대로)\n' : '') + '**학생 활동**'),
        '@@SLIDES@@',
        '### 슬라이드 - (슬라이드 제목)',
        '- 슬라이드 문구:',
        '  - (화면에 띄울 짧은 문구)',
        "  - (핵심 키워드는 ' / '로 나열하거나 단계는 ' → '로 연결해도 됨)",
        '- 이미지/시각: (어울리는 이미지 한 줄 제안)',
        '- 핵심 메시지: (이 슬라이드의 한 줄 메시지)',
        '',
        `[섹션 제목] ${section.title}${section.minutes ? ` (${section.minutes}분 수업)` : ''}`,
        `[원고]\n${section.text.trim().slice(0, GYOSUAN_SECTION_CHARS)}`
    ].join('\n');
}

function parseSectionResult(text, section) {
    const docAt = text.indexOf('@@GYOSUAN@@');
    const deckAt = text.indexOf('@@SLIDES@@');
    const gyosuan = docAt !== -1 && deckAt !== -1 ? text.slice(docAt + 11, deckAt).trim()
        : deckAt === -1 ? text.trim() : '';
    const slides = deckAt !== -1 ? text.slice(deckAt + 10).trim() : '';
    return { title: section.title, practice: section.practice, gyosuan, slides };
}

/* ---------- 문서 조립 ---------- */
function todayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function frontmatter(info) {
    return ['---', `교과목: ${info.subject}`, `주제: ${info.topic}`]
        .concat(info.duration ? [`소요: ${info.duration}`] : [])
        .concat([`date: ${todayString()}`, 'status: 초안(AI 생성)', '---', '']);
}

function bulletLines(items, fallback) {
    return (items.length ? items : [fallback]).map(item => `- ${item}`);
}

function assembleGyosuanDoc(info, meta, openClose, results) {
    const progress = [
        `도입 - ${openClose.intro.title || '오늘의 주제 열기'}`,
        ...results.map((r, i) => `전개 ${i + 1} - ${r.practice ? '활동: ' : ''}${r.title}`),
        `정리 - ${openClose.close.title || '오늘 배운 것 묶기'}`
    ];
    // 앵커의 괄호는 마크다운 링크를 끊으므로 하이픈으로 바꾼다 (이동은 링크 글자로 헤딩을 찾는다)
    const tocItem = label => `[${label}](#${label.replace(/[^\w가-힣]+/g, '-')})`;
    const lines = [...frontmatter(info), `# 교수안 - ${info.topic}`, '', '## 학습 목표', ''];
    lines.push(...bulletLines(meta.학습목표, '이 차시의 핵심 개념을 이해하고 설명할 수 있다.'), '', '## 목차', '');
    ['학습 목표', '개요', '수업 흐름 한눈에 보기', '준비물·교보제', '진행'].forEach(label => lines.push(`- ${tocItem(label)}`));
    progress.forEach(label => lines.push(`  - ${tocItem(label)}`));
    ['학생 산출물·제출', '평가·체크포인트', '강사 유의사항'].forEach(label => lines.push(`- ${tocItem(label)}`));
    lines.push('', '## 개요', '', '| 항목 | 내용 |', '|---|---|', `| 교과목 | ${info.subject} |`, `| 주제 | ${info.topic} |`);
    if (info.duration) lines.push(`| 소요 | ${info.duration} |`);
    ['대상', '선행', '결과물', '교보제'].forEach(key => { if (meta[key]) lines.push(`| ${key} | ${meta[key]} |`); });
    if (info.ncs) lines.push(`| NCS | ${info.ncs} |`);
    if (info.ncsElements) lines.push(`| NCS 요소 | ${info.ncsElements} |`);
    if (info.tools) lines.push(`| 사용 툴 | ${info.tools} |`);
    lines.push('');
    meta.개요.forEach(paragraph => lines.push(paragraph, ''));
    lines.push('## 수업 흐름 한눈에 보기', '', '| 단계 | 시간 | 핵심 |', '|---|---|---|');
    meta.수업흐름.forEach(cells => lines.push(`| ${cells.join(' | ')} |`));
    lines.push('', ...gyosuanSessionTable(meta.수업흐름, info.topic));
    lines.push('## 준비물·교보제', '', ...bulletLines(meta.준비물, '교재 슬라이드'), '', '## 진행', '');
    lines.push('각 전개는 강사가 실제로 설명할 내용 → 멘트 예시 → 학생 활동 순으로 구성한다. 강사는 설명 내용을 자기 말로 풀되, 멘트 예시를 출발점으로 삼는다.', '');
    lines.push(`### ${progress[0]}`, '', openClose.intro.body || '**설명 내용**: 오늘 다룰 주제와 그 이유를 가볍게 연다.', '');
    results.forEach((r, i) => {
        lines.push(`### ${progress[i + 1]}`, '', r.gyosuan || '**설명 내용**: (생성 실패 - 다시 생성하거나 직접 작성해 주세요)', '');
    });
    lines.push(`### ${progress[progress.length - 1]}`, '', openClose.close.body || '**설명 내용**: 오늘 다룬 핵심을 정리하고 다음 차시와 연결한다.', '');
    lines.push('## 학생 산출물·제출', '', ...bulletLines(meta.산출물, '이 차시의 활동 결과물'), '');
    lines.push('## 평가·체크포인트', '', ...bulletLines(meta.평가, '학습 목표 달성 여부를 확인한다.'), '');
    lines.push('## 강사 유의사항', '', ...bulletLines(meta.유의사항, 'AI가 생성한 초안이므로 강의 전 내용을 검토·보완한다.'), '');
    return lines.join('\n');
}

function assembleGyosuanDeck(info, meta, results) {
    const lines = [...frontmatter({ ...info, duration: '' }), `# 슬라이드 편성안 - ${info.topic}`, '', '## 슬라이드 편성', ''];
    let number = 1;
    const addSlide = (title, maps, body) => lines.push(`### 슬라이드 ${number++} - ${title}`, `- 대응 교수안: ${maps}`, ...body, '');
    addSlide('표지', '-', [
        '- 슬라이드 문구:', `  - (제목) ${info.topic}`, ...(meta.부제 ? [`  - (부제) ${meta.부제}`] : []),
        '- 이미지/시각: 강의 주제를 상징하는 대표 일러스트'
    ]);
    addSlide('목차', '-', [
        '- 슬라이드 문구:', '  - 오늘의 여정', ...results.map((r, i) => `  - ${i + 1}. ${r.title}`),
        '- 이미지/시각: 단계를 잇는 흐름 그래픽'
    ]);
    results.forEach((r, i) => {
        const slides = r.slides || `### 슬라이드 - ${r.title}\n- 슬라이드 문구:\n  - ${r.title}\n- 이미지/시각: 관련 이미지\n- 핵심 메시지: ${r.title}`;
        slides.split(/\n(?=###\s)/).map(block => block.trim()).filter(Boolean).forEach(block => {
            const [head, ...rest] = block.split('\n');
            const title = head.replace(/^###\s*/, '').replace(/^슬라이드\s*/, '').replace(/^\d+\s*/, '').replace(/^[-–—:.]\s*/, '').trim();
            addSlide(title || r.title, `전개 ${i + 1}`, rest.filter(line => !/대응\s*교수안/.test(line)));
        });
    });
    addSlide('마무리', '정리', [
        '- 슬라이드 문구:', '  - (큰 문구) 오늘의 한 걸음', '  - 오늘 배운 핵심을 챙겨, 다음으로!',
        '- 이미지/시각: 다음 단계로 나아가는 장면', '- 핵심 메시지: 배운 것을 정리하고 이어 간다.'
    ]);
    lines.push('## 비고', '', '- AI가 교안에서 생성한 초안입니다. 문구·이미지 제안을 검토해 다듬어 사용하세요.', '');
    return lines.join('\n');
}

/* ---------- 생성 진입점 ---------- */
function setGyosuanProgress(text) {
    const el = document.getElementById('editor-loading-text');
    if (el) el.textContent = text;
}

async function buildGyosuanFromLesson(mod, parts) {
    const subject = globalState.subjects.find(s => s.id === currentSubjectId);
    const hours = Number(mod.hours) || 0;
    const info = {
        subject: subject?.title || globalState.courseTitle || mod.title,
        topic: mod.title,
        description: mod.description || '',
        duration: hours ? `${hours}시수(약 ${Math.round(hours * 60)}분)` : '',
        ncs: subjectNcsText(subject),
        ncsElements: (mod.ncsElements || []).map(elementLabel).join(', '),
        tools: (mod.tools || []).map(toolLabel).join(', '),
        designBrief: lessonDesignBrief(mod)
    };
    const { intro, sections: units } = splitLessonSections(parts);
    const sections = limitSections(units);
    info.intro = intro;
    if (!sections.length) throw new Error('교안에서 섹션(## 제목)을 찾지 못했습니다.');

    // 생성 중 다른 교과로 이동해도 같은 참고 자료를 쓰도록 시작할 때 한 번만 만든다
    const system = gyosuanSystemInstruction();
    setGyosuanProgress('교수안 머리말을 작성하고 있습니다...');
    const meta = parseGyosuanMeta(await askGyosuanModel(buildMetaPrompt(info, sections), system));
    if (!meta.학습목표.length && !meta.개요.length) throw new Error('머리말 응답이 비어 있습니다. 다시 시도해주세요.');

    let done = 0;
    let lastError = null;
    const results = await mapLimited(sections, GYOSUAN_CONCURRENCY, async section => {
        try {
            const result = parseSectionResult(await askGyosuanModel(buildSectionPrompt(section), system, GYOSUAN_FEWSHOT), section);
            if (!result.gyosuan) throw new Error('전개 응답이 비어 있습니다.');
            return result;
        } catch (err) {
            console.error('[교수안] 섹션 생성 실패:', section.title, err);
            lastError = err;
            return { title: section.title, practice: section.practice, gyosuan: '', slides: '', failed: true };
        } finally {
            setGyosuanProgress(`교수안·슬라이드 작성 중... (${++done}/${sections.length})`);
        }
    });
    if (results.every(r => r.failed)) throw lastError;

    setGyosuanProgress('도입과 정리를 작성하고 있습니다...');
    const openClose = parseOpenClose(await askGyosuanModel(buildOpenClosePrompt(info, meta, sections), system));
    return {
        docMd: assembleGyosuanDoc(info, meta, openClose, results),
        deckMd: assembleGyosuanDeck(info, meta, results),
        failedCount: results.filter(r => r.failed).length
    };
}

// opts.keepDoc: 강사가 고친 교수안은 두고 슬라이드 편성안만 교체
window.generateGyosuan = async function (moduleId, opts = {}) {
    const mod = getEditingModule(moduleId);
    if (!mod) { window.showAlert('교안을 먼저 선택해주세요.'); return false; }
    const parts = collectLessonSource(mod);
    if (!parts.length) { window.showAlert('교안 내용이 없습니다. 먼저 탭을 생성해주세요.'); return false; }
    const loading = document.getElementById('editor-loading');
    if (_gyosuanRunning || loading?.style.display === 'flex') { window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.'); return false; }

    _gyosuanRunning = true;
    if (loading) loading.style.display = 'flex';
    try {
        const built = await buildGyosuanFromLesson(mod, parts);
        const keepDoc = opts.keepDoc && mod.gyosuan?.docMd;
        mod.gyosuan = {
            docMd: keepDoc ? mod.gyosuan.docMd : built.docMd,
            deckMd: built.deckMd,
            deckHtml: null,
            sourceKey: keepDoc ? mod.gyosuan.sourceKey : hashSource(parts),
            updatedAt: new Date().toISOString()
        };
        _gyosuanEditingId = null;
        await saveState();
        if (String(currentEditingModuleId) === String(mod.id)) renderEditor(mod);
        if (built.failedCount) window.showAlert(`전개 ${built.failedCount}개를 생성하지 못해 빈칸으로 두었습니다. 다시 생성하거나 직접 작성해 주세요.`);
        else if (window.showToast) window.showToast('교수안과 슬라이드 편성안을 생성했습니다.', 'success');
        return true;
    } catch (err) {
        console.error('[교수안] 생성 실패:', err);
        window.showAlert('교수안 생성 실패: ' + (err && err.message ? err.message : err));
        return false;
    } finally {
        _gyosuanRunning = false;
        if (loading) loading.style.display = 'none';
        setGyosuanProgress('AI가 상세 교안을 작성하고 있습니다...');
    }
};

window.regenerateGyosuan = function (moduleId) {
    if (confirm('교수안을 다시 생성합니다. 직접 수정한 내용과 슬라이드 편집 내용은 사라집니다. 계속할까요?')) {
        window.generateGyosuan(moduleId);
    }
};

/* ---------- 강사뷰 ---------- */
function gyosuanDocHtml(mod) {
    if (!mod?.gyosuan?.docMd) return null;
    const mount = document.createElement('div');
    window.KBuilder.buildDoc(window.KBuilder.parseDoc(mod.gyosuan.docMd), mount);
    return mount.innerHTML;
}

function gyosuanEmptyHtml(mod) {
    return `
        <div class="flex flex-col items-center justify-center text-center py-20 px-6 select-none">
            <div class="w-16 h-16 mb-5 flex items-center justify-center rounded-2xl bg-orange-50 text-orange-500 text-3xl">
                <i class="ph-bold ph-chalkboard-teacher"></i>
            </div>
            <h3 class="text-lg font-bold text-gray-800 mb-2">이 차시의 교수안이 아직 없습니다</h3>
            <p class="text-sm text-gray-500 mb-6 leading-relaxed">교안을 바탕으로 AI가 강사 활동·설명 내용·멘트 예시·학생 활동을 담은 교수안과<br>슬라이드 편성안을 함께 만듭니다. 차시 분량에 따라 몇 분 걸릴 수 있습니다.</p>
            <div class="flex items-center gap-2">
                <button onclick="generateGyosuan('${mod.id}')"
                    class="px-5 py-2.5 text-sm font-bold text-white bg-accent rounded-lg hover:bg-accentHover transition-colors flex items-center gap-2 shadow-sm hover:-translate-y-0.5">
                    <i class="ph-bold ph-sparkle"></i> 교수안·슬라이드 생성
                </button>
                <button onclick="showLessonView()"
                    class="px-5 py-2.5 text-sm font-bold text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                    교안 보기
                </button>
            </div>
        </div>`;
}

function gyosuanToolbarHtml(mod) {
    const stale = mod.gyosuan.sourceKey !== hashSource(collectLessonSource(mod));
    const button = (action, icon, label) => `<button onclick="${action}" class="gyosuan-tool"><i class="ph-bold ${icon}"></i> ${label}</button>`;
    return `
        <div class="gyosuan-toolbar">
            <span class="gyosuan-note">${stale ? '⚠️ 교안이 바뀌었습니다. 교수안을 다시 생성하면 반영됩니다.' : '차시 전체 기준 교수안입니다. 탭별 교안은 학생뷰에서 볼 수 있습니다.'}</span>
            ${button(`toggleGyosuanEdit()`, 'ph-pencil-simple', _gyosuanEditingId === mod.id ? '보기' : 'MD 수정')}
            ${button(`downloadGyosuanMd('${mod.id}')`, 'ph-download-simple', 'MD')}
            ${button(`downloadGyosuanSessions('${mod.id}')`, 'ph-clock', '차시별 MD')}
            ${button(`downloadGyosuanSessionDecks('${mod.id}')`, 'ph-presentation', '차시별 편성안')}
            ${button(`printGyosuan('${mod.id}')`, 'ph-printer', 'PDF')}
            ${button(`regenerateGyosuan('${mod.id}')`, 'ph-arrow-clockwise', '재생성')}
        </div>`;
}

function renderGyosuanView(mod) {
    const el = document.getElementById('gyosuan-view');
    if (!el || !mod) return;
    if (!mod.gyosuan?.docMd) {
        el.innerHTML = gyosuanEmptyHtml(mod);
        return;
    }
    el.innerHTML = gyosuanToolbarHtml(mod) + (_gyosuanEditingId === mod.id
        ? '<textarea id="gyosuan-raw" class="gyosuan-raw" spellcheck="false" onchange="saveGyosuanRaw()"></textarea>'
        : gyosuanDocHtml(mod));
    const raw = document.getElementById('gyosuan-raw');
    if (raw) raw.value = mod.gyosuan.docMd;
}

// 보기 모드에서 강사뷰이면 교안 대신 교수안을 보여 준다. 수정 모드는 기존대로 탭 교안 원문을 편집한다.
window.syncGyosuanView = function () {
    const docEl = document.getElementById('gyosuan-view');
    const renderEl = document.getElementById('render-view');
    if (!docEl || !renderEl) return;
    const raw = document.getElementById('raw-view');
    const show = window.viewMode === 'instructor' && (!raw || raw.classList.contains('hidden'));
    docEl.classList.toggle('hidden', !show);
    renderEl.classList.toggle('gyosuan-covered', show);
    if (show) renderGyosuanView(getEditingModule());
};

// 탭 교안은 학생뷰에서 보여 주므로 강사뷰에서 탭을 다루면 학생뷰로 옮긴다
window.showLessonView = function () {
    if (window.viewMode === 'instructor') applyViewMode('student');
};

window.toggleGyosuanEdit = function () {
    const mod = getEditingModule();
    if (!mod) return;
    _gyosuanEditingId = _gyosuanEditingId === mod.id ? null : mod.id;
    renderGyosuanView(mod);
};

window.saveGyosuanRaw = async function () {
    const mod = getEditingModule();
    const raw = document.getElementById('gyosuan-raw');
    if (!mod?.gyosuan || !raw) return;
    mod.gyosuan.docMd = raw.value;
    await saveState();
};

window.downloadGyosuanMd = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod?.gyosuan?.docMd) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([mod.gyosuan.docMd], { type: 'text/markdown;charset=utf-8' }));
    a.download = `${mod.title.replace(/[^\w가-힣]/g, '_')}_교수안.md`;
    a.click();
    URL.revokeObjectURL(a.href);
};

window.printGyosuan = function (moduleId) {
    const html = gyosuanDocHtml(getEditingModule(moduleId));
    const win = html && window.open('', '_blank');
    if (!win) return window.showAlert('팝업이 차단되어 인쇄 창을 열 수 없습니다.');
    const cssHref = new URL('css/gyosuan-doc.css', location.href).href;
    win.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>교수안</title><link rel="stylesheet" href="${cssHref}"></head><body class="gyosuan-view">${html}</body></html>`);
    win.document.close();
    win.onload = () => win.print();
};

// 문서 안 '목차' 링크는 같은 제목의 헤딩으로 이동한다
document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('.gyosuan-view a[href^="#"]');
    if (!link) return;
    event.preventDefault();
    const label = link.textContent.trim();
    const headings = link.closest('.gyosuan-view').querySelectorAll('.doc-h2, .doc-h3');
    const target = Array.from(headings).find(h => h.textContent.trim() === label);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------- 슬라이드 스튜디오 (slide-studio.html) ---------- */
window.getSlideStudioPayload = function (moduleId) {
    const mod = getEditingModule(moduleId);
    const subject = globalState.subjects.find(s => s.id === currentSubjectId);
    return {
        deckMd: mod?.gyosuan?.deckMd || '',
        deckHtml: mod?.gyosuan?.deckHtml || null,
        title: mod?.title || '',
        subject: subject?.title || ''
    };
};

window.saveSlideStudioHtml = function (moduleId, html) {
    const mod = getEditingModule(moduleId);
    if (!mod?.gyosuan) return;
    mod.gyosuan.deckHtml = html;
    clearTimeout(_gyosuanSaveTimer);
    _gyosuanSaveTimer = setTimeout(() => saveState(), 1000);
};

function createSlideStudioFrame(moduleId) {
    const iframe = document.createElement('iframe');
    iframe.src = `slide-studio.html?module=${encodeURIComponent(moduleId)}`;
    iframe.title = '슬라이드 스튜디오';
    return iframe;
}

window.syncSlidePanel = function (mod) {
    const hasDeck = !!mod?.gyosuan?.deckMd;
    const badge = document.getElementById('slide-status-badge');
    const regenBtn = document.getElementById('slide-regen-btn');
    const generateLabel = document.getElementById('slide-generate-label');
    if (badge) {
        badge.textContent = hasDeck ? '생성됨' : '미생성';
        badge.className = `text-[0.6rem] px-2 py-0.5 rounded-full font-bold ${hasDeck ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-200 text-gray-500'}`;
    }
    if (regenBtn) regenBtn.classList.toggle('hidden', !hasDeck);
    if (regenBtn) regenBtn.classList.toggle('flex', hasDeck);
    if (generateLabel) generateLabel.textContent = hasDeck ? '슬라이드 열기' : '슬라이드 생성';
};

window.generateSlideView = async function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');
    if (!mod.gyosuan?.deckMd && !(await window.generateGyosuan(moduleId))) return;
    // 생성하는 동안 다른 차시로 옮겼다면 그 차시 패널에 넣지 않는다
    const area = String(currentEditingModuleId) === String(mod.id) && document.getElementById('slide-preview-area');
    if (!area) return;
    const iframe = createSlideStudioFrame(moduleId);
    iframe.className = 'slide-studio-inline';
    area.innerHTML = '';
    area.appendChild(iframe);
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.regenerateSlideView = async function (moduleId) {
    if (!confirm('슬라이드 편성안을 다시 생성합니다. 슬라이드에서 편집한 내용은 사라집니다. 계속할까요?')) return;
    const mod = getEditingModule(moduleId);
    if (mod && await window.generateGyosuan(mod.id, { keepDoc: true })) window.generateSlideView(mod.id);
};

// 내보내기 메뉴의 슬라이드 항목: 슬라이드는 차시 단위로 만들고 스튜디오에서 PPTX·HTML로 내보낸다
window.openCurrentSlideStudio = function () {
    const mod = getEditingModule();
    if (!mod) return window.showAlert('슬라이드는 차시별로 만듭니다. 좌측 목록에서 차시를 먼저 선택해주세요.');
    window.openSlideStudio(mod.id);
};

window.openSlideStudio = async function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');
    if (!mod.gyosuan?.deckMd && !(await window.generateGyosuan(moduleId))) return;
    if (document.getElementById('slide-studio-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'slide-studio-overlay';
    overlay.innerHTML = '<button type="button" class="slide-studio-close" title="닫기"><i class="ph-bold ph-x"></i> 닫기</button>';
    overlay.querySelector('button').onclick = () => overlay.remove();
    overlay.appendChild(createSlideStudioFrame(moduleId));
    document.body.appendChild(overlay);
};
