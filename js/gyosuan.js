// gyosuan.js - 교수안·슬라이드 편성안 생성과 슬라이드 스튜디오 연결 (강사뷰는 gyosuan-view.js, 재생성·이전 교수안은 gyosuan-regen.js, 편성안 다듬기는 gyosuan-deck-tidy.js)
// 문서 양식과 조립은 develocket-slide(assets/generate.js @3a7303f)의 컨벤션을 따르고,
// 생성 프롬프트는 이 앱의 교안 생성 방식(페르소나·어투·참고 자료·멀티턴 few-shot)을 쓴다.
// 교수안은 갈래(data.js LESSON_TRACKS)마다 따로 만든다. 기본학습 갈래는 기본학습·기본실습 탭으로 mod.gyosuan에, 심화학습 갈래는 심화학습·심화실습 탭으로 mod.gyosuanAdv에
// { docMd, deckMd, deckHtml, sessionDecks, deckRev, deckDirty, images, slideStyle, sourceKey, sourceMap, previous, citedVideos, briefMd, updatedAt } 으로 저장한다(sourceMap·previous는 gyosuan-regen.js, citedVideos는 gyosuan-videos.js, briefMd(간이 교수안)는 gyosuan-brief.js).
// images는 교수안·편성안의 ![설명](local:id)가 가리키는 래스터 data URL이고, sessionDecks는 교시(1시간)별로 연 덱의 편집본이다(키는 0부터 센 교시 번호).
// 예전에 네 탭을 함께 담아 만든 mod.gyosuan은 그대로 기본학습 교수안으로 둔다(gyosuan-view.js가 그렇다고 알린다).

const GYOSUAN_MAX_SECTIONS = 14;
const GYOSUAN_SECTION_CHARS = 8000;
const GYOSUAN_INTRO_CHARS = 2000;
const GYOSUAN_REFERENCE_CHARS = 4000;
const GYOSUAN_CONCURRENCY = 3;
// 전개가 아닌 교안 머리말·강사 전용 섹션 (머리말은 교수안 머리말 작성 근거로만 쓴다)
const GYOSUAN_INTRO_TITLE = /학습\s*목표|^개요|들어가며/;
// 학습 정보(수업 시간·선행·툴, lesson-info.js)도 머리말이다. 제목이 꼭 '학습 정보'일 때만이다(lesson-lint.js isLessonInfoTitle, '학습 정보 시스템'은 전개)
const isGyosuanIntroTitle = title => GYOSUAN_INTRO_TITLE.test(title) || (typeof isLessonInfoTitle === 'function' && isLessonInfoTitle(title));
const GYOSUAN_SKIP_TITLE = /교강사 가이드|학습 후 체크리스트/;
const GYOSUAN_BLOCK_FORMAT =
    '**강사 활동**: (강사가 수업에서 실제로 할 행동 1~2문장)\n' +
    '**설명 내용**:\n- (강사가 설명할 내용을 항목으로. 비교·단계 정리는 마크다운 표도 가능)\n' +
    '**멘트 예시**: "(강사가 학생에게 건네듯 1~2문장)"\n' +
    '**학생 활동**: (학생이 할 일 한 문장)\n';

// 슬라이드 형식: 값과 저장 키는 develocket-slide(main.js·generate.js)와 같다. deck: 전개 지시의 [슬라이드 규칙](편성안에는 발표자 노트 칸이 없어 긴 설명은 교수안 블록에 둔다)
const GYOSUAN_SLIDE_STYLE_KEY = 'kb-slide-style';
const GYOSUAN_SLIDE_STYLES = [['presentation', '프레젠테이션용'], ['detailed', '상세 교재형']];
const GYOSUAN_SLIDE_SPECS = {
    presentation: {
        rule: '- 슬라이드 문구는 화면에 띄울 짧은 말만 쓰고, 설명 문장은 교수안에 둡니다.',
        ask: '발표 슬라이드 1~2장',
        lines: ['  - (화면에 띄울 짧은 문구)', "  - (핵심 키워드는 ' / '로 나열하거나 단계는 ' → '로 연결해도 됨)"],
        deck: '- 슬라이드 문구는 한 줄에 핵심 하나만 25자 안팎의 짧은 말로 씁니다. 설명을 늘어놓는 문장이나 문단은 슬라이드에 쓰지 않습니다(설명은 위 교수안 블록의 설명 내용에 둡니다).'
    },
    detailed: {
        rule: '- 슬라이드 문구는 수강생이 슬라이드만 읽어도 이해되도록 완결된 문장으로 쓰되, 한 줄에 핵심 하나만 담고 설명을 늘어놓지 않습니다.',
        ask: '교재형 슬라이드 2~4장(슬라이드마다 핵심 문장 3~5개)',
        lines: ['  - (개념을 설명하는 완결된 문장 한 문장. 한 줄에 핵심 하나)', '  - (정의·예시·주의점을 한 줄에 한 문장씩, 3~5개 항목으로)'],
        deck: '- 슬라이드 문구는 한 줄에 핵심 하나를 담은 한 문장으로 씁니다. 여러 문장을 한 줄에 잇거나 설명을 늘어놓지 않습니다(덧붙일 설명은 위 교수안 블록의 설명 내용에 둡니다).'
    }
};
const GYOSUAN_DECK_EMPTY_RULE = '- 빈 그림 자리(![](), <img>, [이미지])나 머리줄만 있는 표, 내용이 없는 도식·차트 블록(mermaid 등)은 넣지 않습니다. 표는 칸을 모두 채울 때만 쓰고, 그림은 이미지/시각 줄에 그릴 장면 한 줄로만 제안합니다.'; // 남은 것은 gyosuan-deck-tidy.js가 덜어 낸다

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
// 그 갈래의 학습·실습 탭 글. 탭 글이 하나도 없는 옛 차시의 본문(content)은 기본학습 갈래의 원고다
function collectLessonSource(mod, trackId = 'basic') {
    const track = lessonTrack(trackId);
    const parts = [track.learn, track.practice]
        .map(id => ({ practice: id === track.practice, text: mod.tabContents?.[id] }))
        .filter(p => p.text && p.text.trim());
    const legacyBody = !!mod.content && !LESSON_TABS.some(tab => mod.tabContents?.[tab.id]);
    return parts.length || !legacyBody || track.id !== LESSON_TRACKS[0].id ? parts : [{ practice: false, text: mod.content }];
}

// 예전에 네 탭(기본학습·기본실습·심화학습·심화실습)을 함께 담아 교수안을 만들 때의 원고(교안이 그대로면 그때의 sourceKey와 같다)
const LEGACY_GYOSUAN_TABS = ['basicLearn', 'basicPrac', 'advLearn', 'advPrac'];
function legacyLessonSource(mod) {
    const parts = LEGACY_GYOSUAN_TABS
        .map(id => ({ practice: /Prac$/.test(id), text: mod.tabContents?.[id] }))
        .filter(p => p.text && p.text.trim());
    return parts.length || !mod.content ? parts : [{ practice: false, text: mod.content }];
}

// 기본학습 교수안이 예전 방식(네 탭을 함께 담음)으로 만든 것인가. 교안이 그대로이고 지금 방식의 원고와 다를 때만 그렇다고 본다
function isLegacyGyosuan(mod) {
    const key = mod?.gyosuan?.sourceKey;
    if (!key) return false;
    const legacy = hashSource(legacyLessonSource(mod));
    return key === legacy && legacy !== hashSource(collectLessonSource(mod, 'basic'));
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

// 탭 맨 위의 # 제목(예: '# 📝 차시 제목')과 그 아래 첫머리(목표 미리 보기·배경 목록)는 전개가 아니라 머리말 근거로 본다(opening).
// 그 탭에 제목이 더 있을 때만 그렇게 본다(# 제목 하나에 본문을 모두 담은 탭은 예전처럼 그 제목을 전개로 쓴다)
function lessonPartUnits(part) {
    const units = [];
    let current = null;
    cleanGyosuanSource(part.text).split('\n').forEach(line => {
        const heading = line.match(/^(#{1,2})\s+(.+?)\s*$/);
        if (heading) {
            current = { title: cleanSectionTitle(heading[2]), minutes: sectionMinutes(heading[2]), practice: part.practice, text: '', top: heading[1] === '#' && !units.length };
            units.push(current);
        } else if (current) {
            current.text += line + '\n';
        }
    });
    const [first] = units;
    if (first?.top && units.length > 1 && !isGyosuanIntroTitle(first.title)) first.opening = true;
    return units;
}

// 첫머리는 머리말 근거의 끝에 둔다(학습 목표·개요가 머리말 길이 상한 안에 먼저 들어가게)
function splitLessonSections(parts) {
    const units = parts.flatMap(lessonPartUnits);
    const introUnits = [...units.filter(u => !u.opening && isGyosuanIntroTitle(u.title)), ...units.filter(u => u.opening && u.text.trim())];
    const intro = introUnits.map(u => `${u.title}\n${u.text.trim()}`).join('\n\n');
    const sections = units.filter(u => !u.opening && u.text.trim().length > 30 && !isGyosuanIntroTitle(u.title) && !GYOSUAN_SKIP_TITLE.test(u.title));
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
        '- 교수안이나 슬라이드 문구에 코드 블록을 쓰면 코드 블록마다 한국어 주석을 줄 끝 주석으로 넣습니다. 첫 줄 끝에 무엇을 하는 코드인지, 핵심 줄 끝에 그 줄이 하는 일을 적어 코드 열 줄마다 주석을 하나 이상 둡니다(줄 맨 앞에서 시작하는 # 주석 줄은 교수안 화면에서 제목으로 읽힙니다).',
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
// 원고 섹션 끝의 핵심 요약 상자(lesson-summary.js): 항목은 [핵심 요약]으로 따로 주고 원고에서는 뺀다(긴 섹션에서도 잘리지 않고, 슬라이드에 두 번 쓰지 않게)
const GYOSUAN_SUMMARY_RULE = '- [핵심 요약]이 있으면 슬라이드의 핵심 메시지는 그 요약에서 고르거나 줄여 쓰고, 같은 문장을 슬라이드 문구에 되풀이하지 않습니다.';

function gyosuanSectionSummary(text) {
    const items = typeof summaryItemsOf === 'function' ? summaryItemsOf(text) : [];
    return { items, text: items.length && typeof withoutSummaryBoxes === 'function' ? withoutSummaryBoxes(text) : text };
}

function buildSectionPrompt(section, style) {
    const slides = GYOSUAN_SLIDE_SPECS[style];
    const summary = gyosuanSectionSummary(section.text);
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
        '- 이미지/시각: (그릴 장면 한 줄 제안. 어울리는 그림이 없으면 이 줄을 뺀다)',
        '- 핵심 메시지: (이 슬라이드의 한 줄 메시지. 한두 문장, 90자 이내)', // 길이 규칙과 넘는 줄 줄이기는 gyosuan-deck-tidy.js(DECK_KEY_MAX · DECK_KEY_RULE)
        '',
        '[슬라이드 규칙]',
        slides.deck,
        GYOSUAN_DECK_EMPTY_RULE, ...(typeof DECK_KEY_RULE === 'string' ? [DECK_KEY_RULE] : []),
        ...(summary.items.length ? [GYOSUAN_SUMMARY_RULE] : []),
        '',
        `[섹션 제목] ${section.title}${section.minutes ? ` (${section.minutes}분 수업)` : ''}`,
        ...(summary.items.length ? [`[핵심 요약]\n${summary.items.map(item => `- ${item}`).join('\n')}`] : []),
        `[원고]\n${summary.text.trim().slice(0, GYOSUAN_SECTION_CHARS)}`
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

// 교수안 주제. 심화학습 갈래는 갈래 이름을 붙여 기본학습 교수안·슬라이드와 구별한다(기본학습은 예전과 같다)
const gyosuanTopic = (mod, trackId) => (lessonTrack(trackId).id === LESSON_TRACKS[0].id ? mod.title : `${mod.title} (${lessonTrack(trackId).label})`);

async function buildGyosuanFromLesson(mod, parts, style, trackId = 'basic') {
    const subject = globalState.subjects.find(s => s.id === currentSubjectId);
    const hours = Number(mod.hours) || 0;
    const info = {
        subject: subject?.title || globalState.courseTitle || mod.title,
        topic: gyosuanTopic(mod, trackId),
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

// 교수안·편성안이 쓰는 그림: 차시 그림 위에 그 갈래 교수안의 그림(교수안을 만들 때 옮겨 둔 사본)이 이긴다.
// 다만 차시에서 움직이는 GIF로 바꾼 그림(image-motion.js)은 GIF가 이긴다. 원래 그림으로 되돌리면 교수안의 사본이 다시 보이고,
// GIF를 켠 동안 만든 교수안이라 사본이 그 GIF였으면 되돌릴 때 사본도 원래 그림으로 바꾼다(image-motion.js restoreMotionCopies)
function gyosuanImageMap(mod, trackId = 'basic') {
    const images = { ...(mod?.images || {}), ...(gyosuanOf(mod, trackId)?.images || {}) };
    const motions = mod?.imageMotions && typeof mod.imageMotions === 'object' ? Object.keys(mod.imageMotions) : [];
    if (typeof imageMotionState === 'function') motions.filter(id => imageMotionState(mod, id) === 'valid').forEach(id => { images[id] = mod.images[id]; });
    return images;
}

// 교수안·편성안의 ![설명](local:id)를 data URL로 바꾼다. 찾지 못한 이미지(빈 값·폴더에서 찾지 못한 teacher-image 참조)는 줄에서 뺀다
function resolveGyosuanImages(md, mod, trackId = 'basic') {
    const images = gyosuanImageMap(mod, trackId);
    return String(md || '').replace(/!\[([^\]]*)\]\(local:([^)\s]+)\)/g, (match, alt, id) => (/^data:image\//.test(images[id] || '') ? `![${alt}](${images[id]})` : ''));
}

async function saveGyosuan(mod) {
    await saveState();
    window.announceGyosuanChange?.(mod.id);
}

function nextGyosuan(mod, parts, draft, style, keepDoc, trackId = 'basic') {
    const base = gyosuanOf(mod, trackId);
    const next = {
        docMd: keepDoc ? base.docMd : draft.docMd,
        deckMd: draft.deckMd,
        ...freshDeckState(base),
        images: { ...(keepDoc ? base.images : {}), ...draft.images },
        slideStyle: style,
        sourceKey: keepDoc ? base.sourceKey : hashSource(parts),
        // 교수안을 두고 편성안만 바꾸면 그 교수안의 간이 교수안과 그 지문도 둔다(새 교수안의 간이 교수안은 저장한 뒤 gyosuan-brief.js가 만든다)
        ...(keepDoc && typeof base.briefMd === 'string' && base.briefMd ? { briefMd: base.briefMd, ...(base.briefDocKey ? { briefDocKey: base.briefDocKey } : {}) } : {}),
        updatedAt: new Date().toISOString()
    };
    // 바뀐 섹션 안내에 쓰는 원고 지문과 되돌릴 수 있게 바꾸기 전 교수안(gyosuan-regen.js)
    const extra = typeof gyosuanRegenFields === 'function' ? gyosuanRegenFields(mod, base, parts, keepDoc, trackId) : {};
    return { ...next, images: usedGyosuanImages(next), ...(draft.citedVideos ? { citedVideos: draft.citedVideos } : {}), ...extra }; // citedVideos: 편성안을 만들 때 인용한 영상(gyosuan-videos.js)
}

// 갈래의 학습·실습 탭 이름(예: 심화학습·심화실습)
const trackTabsLabel = track => [track.learn, track.practice].map(id => LESSON_TABS.find(tab => tab.id === id)?.label || id).join('·');

// brief: 이어서 만든 간이 교수안의 결과(gyosuan-brief.js). 만들지 못했으면 그 까닭을 함께 알린다
function reportGyosuanBuilt(built, draft, trackId = 'basic', brief = null) {
    const label = lessonTrack(trackId).label;
    const briefNote = typeof gyosuanBriefNote === 'function' ? gyosuanBriefNote(brief) : '';
    if (built.failedCount) window.showAlert(`${label} 교수안의 전개 ${built.failedCount}개를 생성하지 못해 빈칸으로 두었습니다. 다시 생성하거나 직접 작성해 주세요.${briefNote ? `\n${briefNote}` : ''}`);
    else if (window.showToast) window.showToast(`${label} 교수안과 슬라이드 편성안을 만들었습니다.${draft.note ? ` ${draft.note}` : ''}${briefNote ? ` ${briefNote}` : ''}`, briefNote ? 'warning' : 'success');
}

// 실패를 던지지 않고 결과로 돌려준다. 일괄 생성은 차시별로 모으고, 버튼에서 부르면 generateGyosuan이 알린다
// opts.track: 만들 갈래(basic | adv, 없으면 기본학습) / opts.keepDoc: 강사가 고친 교수안은 두고 슬라이드 편성안만 교체 / opts.onStatus: 진행 문구를 받는다
async function runGyosuanGeneration(moduleId, opts = {}) {
    const mod = getEditingModule(moduleId);
    if (!mod) return { ok: false, error: '교안을 먼저 선택해주세요.' };
    const track = lessonTrack(opts.track);
    const parts = collectLessonSource(mod, track.id);
    if (!parts.length) return { ok: false, error: `${trackTabsLabel(track)} 탭에 교안 내용이 없습니다. 먼저 그 탭을 생성해주세요.` };
    const loading = document.getElementById('editor-loading');
    if (_gyosuanRunning || loading?.style.display === 'flex') return { ok: false, error: '진행 중인 생성이 끝난 뒤 다시 시도해주세요.' };
    // 진행 막대의 작업(분량 채우기·탭 만들기 등)은 로딩 화면을 띄우지 않는다. 같은 중지 표시를 써서 함께 돌면 서로의 중지를 풀거나 멈추므로 끝난 뒤에 만든다
    // (전체 생성이 부르는 교수안 단계는 background로 그 작업 안에서 돈다)
    if (!opts.background && (window.isLessonPipelineRunning?.() || window.isVolumeFilling?.())) return { ok: false, error: '진행 중인 생성이 끝난 뒤 다시 시도해주세요.' };

    _gyosuanRunning = true;
    _gyosuanOnStatus = opts.onStatus || null;
    _gyosuanBackground = !!opts.background;
    if (loading && !opts.background) loading.style.display = 'flex';
    if (!opts.background) window.beginGenerationStop?.(GYOSUAN_STOP_LABELS);
    try {
        const style = gyosuanSlideStyle();
        const built = await buildGyosuanFromLesson(mod, parts, style, track.id);
        if (!opts.background) window.endGenerationStop?.(); // 이미지 단계는 자체 건너뛰기 버튼을 쓴다
        const keepDoc = !!(opts.keepDoc && mod[track.field]?.docMd);
        const texts = { docMd: keepDoc ? '' : built.docMd, deckMd: built.deckMd };
        const attached = window.attachGyosuanImages ? await window.attachGyosuanImages(mod, texts, track.id) : texts;
        // 그림을 붙인 뒤 그림 없는 그림 칸·빈 표·빈 도식을 덜고 여러 문장을 이은 문구를 나눈다(gyosuan-deck-tidy.js)
        const draft = typeof tidyGyosuanDeck === 'function' ? { ...attached, deckMd: tidyGyosuanDeck(attached.deckMd, { ...mod.images, ...(keepDoc ? mod[track.field]?.images : {}), ...attached.images }) } : attached;
        mod[track.field] = nextGyosuan(mod, parts, typeof withLessonVideos === 'function' ? withLessonVideos(draft, mod, track.id) : draft, style, keepDoc, track.id); // 그 갈래 탭의 영상을 그 절의 슬라이드에 인용해 담는다(gyosuan-videos.js)
        Object.assign(mod, withHistoryNote(mod, `${track.label} ${keepDoc ? '슬라이드 편성안 AI 생성' : '교수안·슬라이드 편성안 AI 생성'}`));
        _gyosuanEditing = null;
        await saveGyosuan(mod);
        if (getEditingModule() === mod) { // 그 차시(같은 객체)를 보고 있을 때만. 다른 교과의 같은 번호 차시 화면은 그대로 둔다
            if (opts.background) window.refreshAfterGyosuan(mod);
            else renderEditor(mod);
        }
        // 저장한 교수안으로 간이 교수안을 만든다(호출 한 번, gyosuan-brief.js). 빈칸으로 둔 전개가 있으면 만들지 않는다. 실패하거나 멈춰도 교수안은 그대로이고 그 결과만 함께 돌려준다
        const brief = !keepDoc && typeof runGyosuanBriefStep === 'function' ? await runGyosuanBriefStep(mod, track.id, { background: !!opts.background, failedCount: built.failedCount }) : null;
        return { ok: true, built, draft, track: track.id, partial: built.failedCount > 0, ...(brief ? { brief } : {}) };
    } catch (err) {
        if (window.isTabGenerationStopped?.()) return { ok: false, stopped: true };
        console.error('[교수안] 생성 실패:', err);
        return { ok: false, error: `${track.label} 교수안 생성 실패: ${err && err.message ? err.message : err}` };
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

// opts.track: 만들 갈래(basic | adv). 버튼은 화면에서 고른 갈래를 넘긴다
window.generateGyosuan = async function (moduleId, opts = {}) {
    const result = await runGyosuanGeneration(moduleId, opts);
    const label = lessonTrack(opts.track).label;
    if (result.error) window.showAlert(result.error);
    else if (result.stopped) window.showToast?.(`${label} 교수안 생성을 중지했습니다. 기존 교수안은 그대로입니다.`, 'warning');
    else reportGyosuanBuilt(result.built, result.draft, result.track, result.brief);
    return result.ok;
};

// 확인 창을 기다리는 동안 그 차시가 지금 교과에서 사라졌거나, 다른 교과로 옮겨 같은 번호가 다른 차시가 됐는가. 그러면 알리고 멈춘다
function gyosuanTargetMoved(moduleId, mod) {
    if (getEditingModule(moduleId) === mod) return false;
    window.showToast?.('묻는 동안 차시가 바뀌어 아무것도 바꾸지 않았습니다. 다시 시도해 주세요.', 'warning');
    return true;
}

/* ---------- 슬라이드 스튜디오 (slide-studio.html) ---------- */
function gyosuanHasDeck(mod, trackId = 'basic') {
    const gyosuan = gyosuanOf(mod, trackId);
    return !!(gyosuan?.deckMd || gyosuan?.deckHtml);
}

// 화면에서 고른 갈래(tabs.js). 그 파일이 없으면 기본학습
const currentGyosuanTrack = () => lessonTrack(window.lessonPanelTrack?.()).id;

// 스튜디오 주소의 module 값. 스튜디오(js/kbuilder)는 이 값을 그대로 부모에 넘긴다(getSlideStudioPayload·saveSlideStudioHtml·importGyosuanHtml과 저장 알림 채널 이름).
// 기본학습은 차시 id 그대로(열어 둔 스튜디오가 그대로 돈다), 심화학습은 '차시 id~adv'다. 차시 id에는 '~'가 들어가지 않는다(data-safety.js SAFE_STATE_ID)
const STUDIO_TRACK_MARK = '~';
const studioModuleKey = (moduleId, trackId = 'basic') => (lessonTrack(trackId).id === LESSON_TRACKS[0].id ? moduleId : `${moduleId}${STUDIO_TRACK_MARK}${lessonTrack(trackId).id}`);

// module 값 → { moduleId, track }. 갈래 표시가 없거나 모르는 표시면 받은 값 그대로 기본학습이다
function parseStudioModuleKey(key) {
    const text = String(key ?? '');
    const at = text.lastIndexOf(STUDIO_TRACK_MARK);
    const track = at > 0 ? LESSON_TRACKS.find(item => item.id === text.slice(at + 1) && item.id !== LESSON_TRACKS[0].id) : null;
    return track ? { moduleId: text.slice(0, at), track: track.id } : { moduleId: key, track: LESSON_TRACKS[0].id };
}

// session: 한 교시(1시간)만 여는 번호, null이면 전체 덱. 범위를 벗어나면 전체 덱을 준다. moduleKey: studioModuleKey(심화학습은 '~adv'가 붙는다)
// 교시 덱의 화면 편집본이 있으면 그 편집본을 만든 주제로 편성안을 준다(예전 'N차시.' 주제로 만든 그림 칸 id, course-sessions.js sessionDeckTopic)
window.getSlideStudioPayload = function (moduleKey, session = null) {
    const { moduleId, track } = parseStudioModuleKey(moduleKey);
    const mod = getEditingModule(moduleId);
    const gyosuan = gyosuanOf(mod, track);
    const subject = globalState.subjects.find(s => s.id === currentSubjectId);
    const sessions = gyosuan?.docMd ? gyosuanSessionList(mod, track) : [];
    const index = sessions.some(item => item.index === session) ? session : null;
    const whole = index === null;
    const advanced = track !== LESSON_TRACKS[0].id;
    const deckHtml = (whole ? gyosuan?.deckHtml : gyosuan?.sessionDecks?.[index]) || null;
    const shown = !deckHtml && mod && typeof lateVideoLesson === 'function' ? lateVideoLesson(mod, track) : mod; // 화면 편집본이 없으면 편성안을 만든 뒤에 넣은 영상까지 인용한 편성안으로(저장한 편성안은 그대로, gyosuan-videos.js)
    const deckMd = resolveGyosuanImages(whole ? gyosuanOf(shown, track)?.deckMd : gyosuanSessionDeckMd(shown, index, track, deckHtml || ''), mod, track);
    return {
        deckMd: deckHtml || typeof tidyGyosuanDeck !== 'function' ? deckMd : tidyGyosuanDeck(deckMd), // 화면 편집본이 없을 때만 다듬어 넘긴다(저장한 편성안은 그대로, gyosuan-deck-tidy.js)
        deckHtml,
        docMd: resolveGyosuanImages(whole ? gyosuan?.docMd : gyosuanSessionPlanMd(mod, index, track), mod, track),
        title: mod ? gyosuanTopic(mod, track) : '',
        subject: subject?.title || '',
        fileBase: mod ? `${lessonFileBase(mod, subject)}${advanced ? '_심화' : ''}${whole ? '' : `_${index + 1}교시`}` : '',
        ncs: { list: (subject?.ncs?.units || []).map(unit => ({ code: unit.code, name: unit.name })), auto: !subject?.ncs?.confirmed },
        sessions,
        session: index,
        track,
        rev: gyosuan?.deckRev || 0,
        refs: mod?.refImages || []
    };
};

// target: 스튜디오가 연 덱 { rev, session }. 그사이 덱을 다시 만들었으면 false를 돌려주고 저장하지 않는다. moduleKey: studioModuleKey
window.saveSlideStudioHtml = function (moduleKey, html, target = {}) {
    const { moduleId, track } = parseStudioModuleKey(moduleKey);
    const mod = getEditingModule(moduleId);
    const field = lessonTrack(track).field;
    const gyosuan = mod?.[field];
    if (!gyosuan) return false;
    if (target.rev !== undefined && target.rev !== (gyosuan.deckRev || 0)) return false;
    mod[field] = Number.isInteger(target.session)
        ? { ...gyosuan, sessionDecks: { ...gyosuan.sessionDecks, [target.session]: html } }
        : { ...gyosuan, deckHtml: html };
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

const slideStudioQuery = (moduleId, trackId = 'basic') => `module=${encodeURIComponent(studioModuleKey(moduleId, trackId))}`;

function showSlideStudioOverlay(query) {
    if (document.getElementById('slide-studio-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'slide-studio-overlay';
    overlay.innerHTML = '<button type="button" class="slide-studio-close" title="닫기"><i class="ph-bold ph-x"></i> 닫기</button>';
    overlay.querySelector('button').onclick = () => overlay.remove();
    overlay.appendChild(createSlideStudioFrame(query));
    document.body.appendChild(overlay);
}

// 슬라이드 패널: 위쪽 기본학습 | 심화학습 고르기, 고른 갈래의 상태 표시와 단추 글
window.syncSlidePanel = function (mod) {
    const track = lessonTrack(currentGyosuanTrack());
    const hasDeck = gyosuanHasDeck(mod, track.id);
    const badge = document.getElementById('slide-status-badge');
    const regenBtn = document.getElementById('slide-regen-btn');
    const generateLabel = document.getElementById('slide-generate-label');
    const switcher = document.getElementById('slide-track-switch');
    const title = document.getElementById('slide-panel-title');
    if (switcher && mod && typeof lessonTrackSwitchHtml === 'function') switcher.innerHTML = lessonTrackSwitchHtml(mod, 'slides');
    if (title) title.textContent = `${track.label} 슬라이드 미리보기`;
    if (badge) {
        badge.textContent = hasDeck ? '생성됨' : '미생성';
        badge.className = `text-[0.6875rem] px-2 py-0.5 rounded-full font-bold ${hasDeck ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-200 text-gray-500'}`;
    }
    if (regenBtn) regenBtn.classList.toggle('hidden', !hasDeck);
    if (regenBtn) regenBtn.classList.toggle('flex', hasDeck);
    if (generateLabel) generateLabel.textContent = hasDeck ? '슬라이드 열기' : '슬라이드 생성';
};

// 교수안만 있으면(완성 MD 변환) 그 교수안은 두고 편성안만 만든다
async function ensureGyosuanDeck(mod, trackId = 'basic') {
    return gyosuanHasDeck(mod, trackId) || window.generateGyosuan(mod.id, { keepDoc: true, track: trackId });
}

// trackId: 열 갈래. 주지 않으면 화면에서 고른 갈래
window.generateSlideView = async function (moduleId, trackId = currentGyosuanTrack()) {
    const mod = getEditingModule(moduleId);
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');
    const track = lessonTrack(trackId).id;
    if (!(await ensureGyosuanDeck(mod, track))) return;
    // 생성하는 동안 다른 차시로 옮겼거나 다른 갈래를 골랐다면 그 패널에 넣지 않는다
    const area = String(currentEditingModuleId) === String(mod.id) && currentGyosuanTrack() === track && document.getElementById('slide-preview-area');
    if (!area) return;
    const iframe = createSlideStudioFrame(slideStudioQuery(moduleId, track));
    iframe.className = 'slide-studio-inline';
    area.innerHTML = '';
    area.appendChild(iframe);
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.regenerateSlideView = async function (moduleId, trackId = currentGyosuanTrack()) {
    const mod = getEditingModule(moduleId);
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');
    const track = lessonTrack(trackId);
    const ok = await confirmAsync(`${track.label} 슬라이드 편성안을 다시 생성합니다. 슬라이드에서 편집한 내용은 사라집니다. 계속할까요?`, { title: `${track.label} 슬라이드 다시 생성`, okLabel: '다시 생성', tone: 'danger' });
    if (!ok || gyosuanTargetMoved(moduleId, mod)) return;
    if (await window.generateGyosuan(mod.id, { keepDoc: true, track: track.id })) window.generateSlideView(mod.id, track.id);
};

// 내보내기 메뉴의 슬라이드 항목: 슬라이드는 차시 단위로 만들고 스튜디오에서 PPTX·HTML로 내보낸다. 화면에서 고른 갈래를 연다
window.openCurrentSlideStudio = function () {
    const mod = getEditingModule();
    if (!mod) return window.showAlert('슬라이드는 차시별로 만듭니다. 좌측 목록에서 차시를 먼저 선택해주세요.');
    window.openSlideStudio(mod.id, currentGyosuanTrack());
};

window.openSlideStudio = async function (moduleId, trackId = currentGyosuanTrack()) {
    const mod = getEditingModule(moduleId);
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');
    const track = lessonTrack(trackId).id;
    if (await ensureGyosuanDeck(mod, track)) showSlideStudioOverlay(slideStudioQuery(moduleId, track));
};

// 테스트가 읽는다(화살표 함수 const는 window에 붙지 않는다)
Object.assign(window, { collectLessonSource, isLegacyGyosuan, studioModuleKey, parseStudioModuleKey, gyosuanTopic });
