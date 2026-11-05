// gyosuan.js - 교수안·슬라이드 편성안 생성과 슬라이드 스튜디오 연결 (강사뷰는 gyosuan-view.js)
// 문서 양식과 조립은 develocket-slide(assets/generate.js @3a7303f)의 컨벤션을 따르고,
// 생성 프롬프트는 이 앱의 교안 생성 방식(페르소나·어투·참고 자료·멀티턴 few-shot)을 쓴다.
// 생성물은 차시에 mod.gyosuan = { docMd, deckMd, deckHtml, sessionDecks, deckRev, deckDirty, images, slideStyle, sourceKey, updatedAt } 으로 저장한다.
// images는 교수안·편성안의 ![설명](local:id)가 가리키는 래스터 data URL이고, sessionDecks는 차시별로 연 덱의 편집본이다.

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

// 슬라이드 형식: 값과 저장 키는 develocket-slide(main.js·generate.js)와 같다
const GYOSUAN_SLIDE_STYLE_KEY = 'kb-slide-style';
const GYOSUAN_SLIDE_STYLES = [['presentation', '프레젠테이션용'], ['detailed', '상세 교재형']];
const GYOSUAN_SLIDE_SPECS = {
    presentation: {
        rule: '- 슬라이드 문구는 화면에 띄울 짧은 말만 쓰고, 설명 문장은 교수안에 둡니다.',
        ask: '발표 슬라이드 1~2장',
        lines: ['  - (화면에 띄울 짧은 문구)', "  - (핵심 키워드는 ' / '로 나열하거나 단계는 ' → '로 연결해도 됨)"]
    },
    detailed: {
        rule: '- 슬라이드 문구는 수강생이 슬라이드만 읽어도 이해되도록 완결된 설명 문장으로 쓰고, 필요한 정의·예시를 함께 담습니다.',
        ask: '교재형 슬라이드 2~4장(슬라이드마다 설명 문장 3~5개로 촘촘하게)',
        lines: ['  - (개념을 설명하는 완결된 문장 1~2문장)', '  - (정의·예시·주의점 등 설명 문장을 3~5개 항목으로)']
    }
};

const GYOSUAN_STOP_LABELS = { idle: '교수안 생성 중지', pending: '멈추고 있습니다...' };

let _gyosuanRunning = false;
let _gyosuanOnStatus = null;
let _gyosuanBackground = false;
let _gyosuanEditing = null; // 강사뷰에서 MD를 고치는 중인 { id, field }
let _gyosuanSaveTimer = null;

// 형식을 안정시키기 위한 멀티턴 예시 (규칙 문장만으로는 모델이 형식을 자주 벗어난다)
const GYOSUAN_FEWSHOT_INPUT = '[섹션 제목] 훈련과 코칭\n[원고]\n교육에는 훈련과 코칭 두 접근이 있습니다. 훈련은 교수자 중심으로 지식과 기술을 전달하고, 코칭은 학습자 중심으로 성찰을 유도합니다. 이 과정은 코칭에 가깝습니다.';
const GYOSUAN_FEWSHOT_DOC =
    '@@GYOSUAN@@\n' +
    '**강사 활동**: 두 접근을 비교한 표를 화면에 띄우고, 지금까지 받아 온 교육이 어느 쪽에 가까운지 묻는다.\n\n' +
    '**설명 내용**:\n' +
    '- 교육에는 두 가지 접근이 있다. **훈련(Training)**과 **코칭(Coaching)**이다.\n\n' +
    '| 구분 | 훈련 | 코칭 |\n|---|---|---|\n| 중심 | 교수자 중심 | 학습자 중심 |\n| 목적 | 지식·기술 전달 | 성찰 유도 |\n\n' +
    '- 이 과정은 코칭에 더 가까운 성격이다. 강사가 정답을 떠먹여 주기보다 학생이 스스로 답을 찾도록 돕는다.\n\n' +
    '**멘트 예시**: "제가 정답을 다 알려 주는 수업이 아니에요. 여러분이 스스로 답을 찾도록 돕는 쪽이에요."\n\n' +
    '**학생 활동**: 자신이 받아 온 교육이 어느 쪽에 가까웠는지 말한다.\n';
const GYOSUAN_FEWSHOT_SLIDES = {
    presentation:
        "### 슬라이드 - 이 수업은 '코칭'에 가깝습니다\n" +
        '- 슬라이드 문구:\n' +
        '  - 훈련: 교수자 중심 · 지식 전달 · 정답 제시\n' +
        '  - 코칭: 학습자 중심 · 성찰 유도 · 정답 찾기\n' +
        '  - (하단) 답은 여러분 안에. 저는 끌어내는 역할\n' +
        '- 이미지/시각: 일방향 화살표(훈련) vs 양방향 화살표(코칭) 대비 도식\n' +
        '- 핵심 메시지: 스스로 답을 찾는 수업이다.',
    detailed:
        '### 슬라이드 - 훈련과 코칭의 차이\n' +
        '- 슬라이드 문구:\n' +
        '  - 훈련은 교수자가 정한 지식과 기술을 순서대로 전달하는 교수자 중심 방식입니다.\n' +
        '  - 코칭은 학습자가 스스로 생각하도록 질문으로 성찰을 끌어내는 학습자 중심 방식입니다.\n' +
        '  - 예를 들어 절차를 그대로 따라 하게 하면 훈련이고, 왜 그렇게 하는지 스스로 답하게 하면 코칭입니다.\n' +
        '  - 이 과정은 코칭에 가까우므로 강사의 답보다 자신의 답을 먼저 찾아야 합니다.\n' +
        '- 이미지/시각: 일방향 화살표(훈련) vs 양방향 화살표(코칭) 대비 도식\n' +
        '- 핵심 메시지: 스스로 답을 찾는 수업이다.'
};

function gyosuanFewshot(style) {
    return [
        { role: 'user', parts: [{ text: GYOSUAN_FEWSHOT_INPUT }] },
        { role: 'model', parts: [{ text: `${GYOSUAN_FEWSHOT_DOC}@@SLIDES@@\n${GYOSUAN_FEWSHOT_SLIDES[style]}` }] }
    ];
}

function gyosuanSlideStyle() {
    try {
        return localStorage.getItem(GYOSUAN_SLIDE_STYLE_KEY) === 'detailed' ? 'detailed' : 'presentation';
    } catch (e) {
        return 'presentation'; // 저장소를 못 쓰는 환경은 기본 형식으로 만든다
    }
}

window.setGyosuanSlideStyle = function (style) {
    try {
        localStorage.setItem(GYOSUAN_SLIDE_STYLE_KEY, style === 'detailed' ? 'detailed' : 'presentation');
    } catch (e) {
        window.showToast?.('슬라이드 형식을 저장하지 못했습니다.', 'warning');
    }
};

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
function gyosuanSystemInstruction(style) {
    const tone = INSTRUCTOR_TONE_PRESETS.find(p => p.id === instructorTone);
    return [
        `${CONTEXT_CORE.personas.instructor} 직업훈련 교재 제작 전문가로서 강사가 그대로 들고 수업할 수 있는 교수안과 슬라이드 편성안을 씁니다.`,
        '[교수안 작성 규칙 — 콘텐츠 업무 설계]',
        '- 교안이 무엇을 배울지를 지정한다면 교수안은 어떻게 가르칠지를 씁니다. 교안 문장을 옮겨 적지 말고 강사의 행동과 말로 바꿉니다.',
        '- 각 전개는 강사가 실제로 설명할 내용 → 멘트 예시 → 학생 활동 순서로 씁니다.',
        '- 강사 활동·설명 내용·학생 활동은 "~한다"로 끝내고, 멘트 예시만 학생에게 건네는 말로 씁니다.' + (tone ? ` 멘트 예시 어투: ${tone.label}.` : ''),
        '- 학습 목표는 "~할 수 있다"로 끝내고 "이해한다·안다·익힌다"는 쓰지 않습니다.',
        '- 모호한 표현("상황에 맞게", "경우에 따라")은 판단 기준으로 바꿉니다.',
        GYOSUAN_SLIDE_SPECS[style].rule,
        '- 원고에 없는 사실은 지어내지 않습니다.',
        '- 지정된 출력 형식만 출력하고 머리말·맺음말을 붙이지 않습니다.'
    ].join('\n') + getReferenceContext(GYOSUAN_REFERENCE_CHARS);
}

async function askGyosuanModel(prompt, system, fewshot = []) {
    const data = await callGemini(TEXT_MODEL, {
        contents: [...fewshot, { role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: system }] },
        signal: window.aiStopSignal?.() || null // 중지하면 받던 응답을 끊는다(중지하면 받은 전개를 어차피 버린다)
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
function buildSectionPrompt(section, style) {
    const slides = GYOSUAN_SLIDE_SPECS[style];
    return [
        `아래 [원고]는 강의의 한 부분입니다. 완전 초보 수강생 대상으로 (1) 강사용 교수안 블록과 (2) ${slides.ask}을 작성하세요.`,
        '아래 형식만 출력합니다.',
        '',
        '@@GYOSUAN@@',
        GYOSUAN_BLOCK_FORMAT.replace('**학생 활동**',
            (section.practice ? '**수행 내용(활동 단계)**:\n1. (학생이 따라 할 단계를 순서대로)\n' : '') + '**학생 활동**'),
        '@@SLIDES@@',
        '### 슬라이드 - (슬라이드 제목)',
        '- 슬라이드 문구:',
        ...slides.lines,
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
    if (el && !_gyosuanBackground) el.textContent = text; // 화면을 막지 않을 때는 다른 작업의 문구를 건드리지 않는다
    _gyosuanOnStatus?.(text);
}

// 중지하면 받은 전개를 버린다. 빈칸이 있는 교수안으로 기존 교수안을 덮지 않는다
function stopGyosuanIfRequested() {
    if (window.isTabGenerationStopped?.()) throw new Error('교수안 생성을 중지했습니다.');
}

async function buildGyosuanFromLesson(mod, parts, style) {
    const subject = globalState.subjects.find(s => s.id === currentSubjectId);
    const hours = Number(mod.hours) || 0;
    const info = {
        subject: subject?.title || globalState.courseTitle || mod.title,
        topic: mod.title,
        description: mod.description || '',
        duration: hours ? `${hours}시수(약 ${Math.round(hours * 60)}분)` : '',
        ncs: subjectNcsText(subject),
        ncsElements: (mod.ncsElements || []).map(elementLabel).join(', '),
        tools: lessonTools(mod).map(toolLabel).join(', '),
        designBrief: lessonDesignBrief(mod)
    };
    const { intro, sections: units } = splitLessonSections(parts);
    const sections = limitSections(units);
    info.intro = intro;
    if (!sections.length) throw new Error('교안에서 섹션(## 제목)을 찾지 못했습니다.');

    // 생성 중 다른 교과로 이동해도 같은 참고 자료를 쓰도록 시작할 때 한 번만 만든다
    const system = gyosuanSystemInstruction(style);
    setGyosuanProgress('교수안 머리말을 작성하고 있습니다...');
    const meta = parseGyosuanMeta(await askGyosuanModel(buildMetaPrompt(info, sections), system));
    if (!meta.학습목표.length && !meta.개요.length) throw new Error('머리말 응답이 비어 있습니다. 다시 시도해주세요.');
    stopGyosuanIfRequested();

    let done = 0;
    let lastError = null;
    const results = await mapLimited(sections, GYOSUAN_CONCURRENCY, async section => {
        if (window.isTabGenerationStopped?.()) return { title: section.title, failed: true };
        try {
            const result = parseSectionResult(await askGyosuanModel(buildSectionPrompt(section, style), system, gyosuanFewshot(style)), section);
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
    stopGyosuanIfRequested();
    if (results.every(r => r.failed)) throw lastError;

    setGyosuanProgress('도입과 정리를 작성하고 있습니다...');
    const openClose = parseOpenClose(await askGyosuanModel(buildOpenClosePrompt(info, meta, sections), system));
    return {
        docMd: assembleGyosuanDoc(info, meta, openClose, results),
        deckMd: assembleGyosuanDeck(info, meta, results),
        failedCount: results.filter(r => r.failed).length
    };
}

// 덱이 바뀌면 화면 편집본은 더 쓰지 않는다. 번호를 올려 이전 덱을 연 스튜디오의 늦은 저장을 막는다
function freshDeckState(gyosuan) {
    return { deckHtml: null, sessionDecks: {}, deckDirty: false, deckRev: (gyosuan?.deckRev || 0) + 1 };
}

function usedGyosuanImages(gyosuan) {
    const text = `${gyosuan.docMd || ''}\n${gyosuan.deckMd || ''}`;
    return Object.fromEntries(Object.entries(gyosuan.images || {}).filter(([id]) => text.includes(`local:${id}`)));
}

// 교수안·편성안의 ![설명](local:id)를 data URL로 바꾼다. 찾지 못한 이미지(빈 값·폴더에서 찾지 못한 teacher-image 참조)는 줄에서 뺀다
function resolveGyosuanImages(md, mod) {
    const images = { ...(mod?.images || {}), ...(mod?.gyosuan?.images || {}) };
    return String(md || '').replace(/!\[([^\]]*)\]\(local:([^)\s]+)\)/g, (match, alt, id) => (/^data:image\//.test(images[id] || '') ? `![${alt}](${images[id]})` : ''));
}

async function saveGyosuan(mod) {
    await saveState();
    window.announceGyosuanChange?.(mod.id);
}

function nextGyosuan(mod, parts, draft, style, keepDoc) {
    const base = mod.gyosuan;
    const next = {
        docMd: keepDoc ? base.docMd : draft.docMd,
        deckMd: draft.deckMd,
        ...freshDeckState(base),
        images: { ...(keepDoc ? base.images : {}), ...draft.images },
        slideStyle: style,
        sourceKey: keepDoc ? base.sourceKey : hashSource(parts),
        updatedAt: new Date().toISOString()
    };
    return { ...next, images: usedGyosuanImages(next) };
}

function reportGyosuanBuilt(built, draft) {
    if (built.failedCount) window.showAlert(`전개 ${built.failedCount}개를 생성하지 못해 빈칸으로 두었습니다. 다시 생성하거나 직접 작성해 주세요.`);
    else if (window.showToast) window.showToast(draft.note || '교수안과 슬라이드 편성안을 생성했습니다.', 'success');
}

// 실패를 던지지 않고 결과로 돌려준다. 일괄 생성은 차시별로 모으고, 버튼에서 부르면 generateGyosuan이 알린다
// opts.keepDoc: 강사가 고친 교수안은 두고 슬라이드 편성안만 교체 / opts.onStatus: 진행 문구를 받는다
async function runGyosuanGeneration(moduleId, opts = {}) {
    const mod = getEditingModule(moduleId);
    if (!mod) return { ok: false, error: '교안을 먼저 선택해주세요.' };
    const parts = collectLessonSource(mod);
    if (!parts.length) return { ok: false, error: '교안 내용이 없습니다. 먼저 탭을 생성해주세요.' };
    const loading = document.getElementById('editor-loading');
    if (_gyosuanRunning || loading?.style.display === 'flex') return { ok: false, error: '진행 중인 생성이 끝난 뒤 다시 시도해주세요.' };

    _gyosuanRunning = true;
    _gyosuanOnStatus = opts.onStatus || null;
    _gyosuanBackground = !!opts.background;
    if (loading && !opts.background) loading.style.display = 'flex';
    if (!opts.background) window.beginGenerationStop?.(GYOSUAN_STOP_LABELS);
    try {
        const style = gyosuanSlideStyle();
        const built = await buildGyosuanFromLesson(mod, parts, style);
        if (!opts.background) window.endGenerationStop?.(); // 이미지 단계는 자체 건너뛰기 버튼을 쓴다
        const keepDoc = !!(opts.keepDoc && mod.gyosuan?.docMd);
        const texts = { docMd: keepDoc ? '' : built.docMd, deckMd: built.deckMd };
        const draft = window.attachGyosuanImages ? await window.attachGyosuanImages(mod, texts) : texts;
        mod.gyosuan = nextGyosuan(mod, parts, draft, style, keepDoc);
        Object.assign(mod, withHistoryNote(mod, keepDoc ? '슬라이드 편성안 AI 생성' : '교수안·슬라이드 편성안 AI 생성'));
        _gyosuanEditing = null;
        await saveGyosuan(mod);
        if (String(currentEditingModuleId) === String(mod.id)) {
            if (opts.background) window.refreshAfterGyosuan(mod);
            else renderEditor(mod);
        }
        return { ok: true, built, draft, partial: built.failedCount > 0 };
    } catch (err) {
        if (window.isTabGenerationStopped?.()) return { ok: false, stopped: true };
        console.error('[교수안] 생성 실패:', err);
        return { ok: false, error: `교수안 생성 실패: ${err && err.message ? err.message : err}` };
    } finally {
        _gyosuanRunning = false;
        _gyosuanOnStatus = null;
        _gyosuanBackground = false;
        if (!opts.background) {
            if (loading) loading.style.display = 'none';
            window.endGenerationStop?.();
            setGyosuanProgress('AI가 상세 교안을 작성하고 있습니다...');
        }
    }
}

window.generateGyosuan = async function (moduleId, opts = {}) {
    const result = await runGyosuanGeneration(moduleId, opts);
    if (result.error) window.showAlert(result.error);
    else if (result.stopped) window.showToast?.('교수안 생성을 중지했습니다. 기존 교수안은 그대로입니다.', 'warning');
    else reportGyosuanBuilt(result.built, result.draft);
    return result.ok;
};

window.regenerateGyosuan = function (moduleId) {
    if (confirm('교수안을 다시 생성합니다. 직접 수정한 내용과 슬라이드 편집 내용은 사라집니다. 계속할까요?')) {
        window.generateGyosuan(moduleId);
    }
};

/* ---------- 슬라이드 스튜디오 (slide-studio.html) ---------- */
function gyosuanHasDeck(mod) {
    return !!(mod?.gyosuan?.deckMd || mod?.gyosuan?.deckHtml);
}

// session: 한 차시만 여는 번호, null이면 전체 덱. 범위를 벗어나면 전체 덱을 준다
window.getSlideStudioPayload = function (moduleId, session = null) {
    const mod = getEditingModule(moduleId);
    const gyosuan = mod?.gyosuan;
    const subject = globalState.subjects.find(s => s.id === currentSubjectId);
    const sessions = gyosuan?.docMd ? gyosuanSessionList(mod) : [];
    const index = sessions.some(item => item.index === session) ? session : null;
    const whole = index === null;
    return {
        deckMd: resolveGyosuanImages(whole ? gyosuan?.deckMd : gyosuanSessionDeckMd(mod, index), mod),
        deckHtml: (whole ? gyosuan?.deckHtml : gyosuan?.sessionDecks?.[index]) || null,
        docMd: resolveGyosuanImages(whole ? gyosuan?.docMd : gyosuanSessionPlanMd(mod, index), mod),
        title: mod?.title || '',
        subject: subject?.title || '',
        fileBase: mod ? `${lessonFileBase(mod, subject)}${whole ? '' : `_${index + 1}차시`}` : '',
        ncs: { list: (subject?.ncs?.units || []).map(unit => ({ code: unit.code, name: unit.name })), auto: !subject?.ncs?.confirmed },
        sessions,
        session: index,
        rev: gyosuan?.deckRev || 0,
        refs: mod?.refImages || []
    };
};

// target: 스튜디오가 연 덱 { rev, session }. 그사이 덱을 다시 만들었으면 false를 돌려주고 저장하지 않는다
window.saveSlideStudioHtml = function (moduleId, html, target = {}) {
    const mod = getEditingModule(moduleId);
    if (!mod?.gyosuan) return false;
    if (target.rev !== undefined && target.rev !== (mod.gyosuan.deckRev || 0)) return false;
    mod.gyosuan = Number.isInteger(target.session)
        ? { ...mod.gyosuan, sessionDecks: { ...mod.gyosuan.sessionDecks, [target.session]: html } }
        : { ...mod.gyosuan, deckHtml: html };
    clearTimeout(_gyosuanSaveTimer);
    _gyosuanSaveTimer = setTimeout(() => saveGyosuan(mod), 1000);
    return true;
};

function createSlideStudioFrame(query) {
    const iframe = document.createElement('iframe');
    iframe.src = `slide-studio.html?${query}`;
    iframe.title = '슬라이드 스튜디오';
    return iframe;
}

const slideStudioQuery = moduleId => `module=${encodeURIComponent(moduleId)}`;

function showSlideStudioOverlay(query) {
    if (document.getElementById('slide-studio-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'slide-studio-overlay';
    overlay.innerHTML = '<button type="button" class="slide-studio-close" title="닫기"><i class="ph-bold ph-x"></i> 닫기</button>';
    overlay.querySelector('button').onclick = () => overlay.remove();
    overlay.appendChild(createSlideStudioFrame(query));
    document.body.appendChild(overlay);
}

window.syncSlidePanel = function (mod) {
    const hasDeck = gyosuanHasDeck(mod);
    const badge = document.getElementById('slide-status-badge');
    const regenBtn = document.getElementById('slide-regen-btn');
    const generateLabel = document.getElementById('slide-generate-label');
    if (badge) {
        badge.textContent = hasDeck ? '생성됨' : '미생성';
        badge.className = `text-[0.6875rem] px-2 py-0.5 rounded-full font-bold ${hasDeck ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-200 text-gray-500'}`;
    }
    if (regenBtn) regenBtn.classList.toggle('hidden', !hasDeck);
    if (regenBtn) regenBtn.classList.toggle('flex', hasDeck);
    if (generateLabel) generateLabel.textContent = hasDeck ? '슬라이드 열기' : '슬라이드 생성';
};

// 교수안만 있으면(완성 MD 변환) 그 교수안은 두고 편성안만 만든다
async function ensureGyosuanDeck(mod) {
    return gyosuanHasDeck(mod) || window.generateGyosuan(mod.id, { keepDoc: true });
}

window.generateSlideView = async function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');
    if (!(await ensureGyosuanDeck(mod))) return;
    // 생성하는 동안 다른 차시로 옮겼다면 그 차시 패널에 넣지 않는다
    const area = String(currentEditingModuleId) === String(mod.id) && document.getElementById('slide-preview-area');
    if (!area) return;
    const iframe = createSlideStudioFrame(slideStudioQuery(moduleId));
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
    if (await ensureGyosuanDeck(mod)) showSlideStudioOverlay(slideStudioQuery(moduleId));
};
