// lesson-volume.js - 학습 탭(기본학습·심화학습)을 강사가 소리 내어 읽어도 목표 시간(480분)이 차는 분량까지 섹션마다 나눠 채운다
// 초안을 받은 뒤 목표에 못 미친 내용 섹션 끝에 새 ### 소주제를 이어 붙인다. 있던 글·고정 섹션·학습 목표·개요·체크리스트·그림 자리는 그대로 둔다.
// 분량은 lesson-lint.js spokenChars로 센다(공백 포함 1분에 250자, 코드·표·그림·서식 기호 제외). 목표는 lesson-lint.js learnTargetMinutes.
// 탭 생성(tabs.js generateTabContent)·교안 전체 생성(api.js generateModuleContent)·탭 위 '분량 채우기'가 쓴다. 테스트: tests/lesson-volume.test.js, tests/tab-time.test.js

const VOLUME_REQUEST_MIN = 3000;      // 한 번에 부탁하는 낭독 글자 수(공백 포함)
const VOLUME_REQUEST_MAX = 12000;
const VOLUME_REQUEST_STEP = 500;
const VOLUME_START_RATIO = 0.7;       // 부탁한 글자 가운데 실제로 늘어난 비율. 모르는 처음에는 70%로 본다
const VOLUME_RATIO_MIN = 0.4;
const VOLUME_RATIO_MAX = 1;
const VOLUME_CHARS_PER_CALL = 5000;   // 호출 상한 = 목표 글자 ÷ 이 값(480분이면 24번)
const VOLUME_CALL_LIMIT = 48;
const VOLUME_STALL_CHARS = 800;       // 이보다 적게 늘면 늘지 않은 것으로 본다
const VOLUME_STALL_LIMIT = 2;         // 잇달아 늘지 않으면 멈춘다
const VOLUME_SECTION_FAILS = 2;       // 한 섹션이 이만큼 늘지 않으면 그 섹션은 더 고르지 않는다
const VOLUME_COOLDOWN_MS = 1500;      // 호출 한도를 피하려고 호출 사이를 둔다
const VOLUME_RETRY_WAIT_MS = 30000;   // 잠깐의 오류는 한 번만 30초 뒤 다시 해 본다
const VOLUME_MARGIN = 1.03;           // 자동 수정이 조금 줄여도 목표 아래로 내려가지 않게 3% 더 채운다
const VOLUME_FIX_ROUNDS = 3;          // 분량을 채운 뒤 컨벤션 필수 지적을 고쳐 받는 최대 횟수
const VOLUME_SUBTOPIC_CHARS = 2500;   // 새 소주제 하나의 낭독 글자 수
const VOLUME_SUBTOPICS_MIN = 2;
const VOLUME_SUBTOPICS_MAX = 5;
const VOLUME_MIN_NEED = 1500;         // 한 번에 채우려는 최소 글자 수
const VOLUME_TIME_UNIT = 5;           // (⏱ N분)은 5분 단위로 다시 매긴다
const VOLUME_REFERENCE_CHARS = 4000;  // 보강 호출에 붙이는 참고 자료 길이
const VOLUME_MAX_OUTPUT_TOKENS = 65536;
const VOLUME_DEFAULT_GOAL = Math.ceil(LEARN_TARGET_MINUTES * READ_CHARS_PER_MINUTE * VOLUME_MARGIN);
const VOLUME_TIME_LABEL = /\(\s*⏱[^)]*\)|⏱\S*\s*(?:약\s*)?\d+\s*분/;
const VOLUME_IMAGE_TAG = /<!--\s*\[IMG:[\s\S]*?-->/g;
const VOLUME_QUEST_HEADING = /^#\s.*일일\s*퀘스트/; // 교안 전체 생성이 본문 뒤에 붙이는 '# ⚔️ 일일 퀘스트 (실습 과제)'
// 늘리지 않는 섹션: 실습·심화·일일 퀘스트·과제·평가로 시작하거나, 루브릭·채점이 들거나, 요약·정리·마무리로 끝나는 제목.
// '기획 문서로 정리'처럼 을·를·로·에 뒤의 정리는 하는 일을 말하는 내용 섹션이므로 늘린다.
// 심화학습 탭은 탭 전체가 심화 내용이라 '심화'로 시작하는 섹션도 늘린다(VOLUME_SKIP_TITLE_ADV)
const VOLUME_SKIP_TITLE = new RegExp(`${LESSON_HEADING_PREFIX}(?:실습|심화|일일\\s*퀘스트|과제|평가)|루브릭|채점|(?<![을를로에]\\s?)(?:요약|정리|마무리)$`);
const VOLUME_SKIP_TITLE_ADV = new RegExp(`${LESSON_HEADING_PREFIX}(?:실습|일일\\s*퀘스트|과제|평가)|루브릭|채점|(?<![을를로에]\\s?)(?:요약|정리|마무리)$`);
const VOLUME_CHIP_TITLE = `강사가 소리 내어 읽는 시간을 1분에 ${READ_CHARS_PER_MINUTE}자(공백 포함)로 셌습니다. 코드·표·그림·다이어그램·서식 기호는 세지 않습니다.`;
const VOLUME_CHIP_CLASS = 'ml-2 shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[0.6875rem] font-bold whitespace-nowrap';
const VOLUME_CHIP_TONES = { short: 'bg-amber-50 text-amber-700 border-amber-300', done: 'bg-emerald-50 text-emerald-700 border-emerald-300' };

let _volumeRunning = 0; // 분량을 채우는 중인 작업 수. 창을 닫기 전에 묻는다(ui.js hasUnsavedWork)

/* ---------- 늘릴 섹션 고르기 ---------- */
// (⏱ N분)의 분. 없으면 0
function volumeTitleMinutes(title) {
    const match = String(title || '').match(/⏱\S*\s*(?:약\s*)?(\d+)\s*분/);
    return match ? Number(match[1]) : 0;
}

const volumeCleanTitle = title => String(title || '').replace(/\s*\(⏱[^)]*\)\s*/g, ' ').trim();

// 코드 블록 밖의 # 제목(교안 전체 생성의 '# ⚔️ 일일 퀘스트')을 품은 섹션은 끝에 이어 붙이지 않는다
function hasTopHeading(text, heading = /^#\s/) {
    let fence = 0;
    return String(text || '').split('\n').some(line => {
        const wasFenced = fence;
        fence = nextCodeFence(fence, line);
        return !wasFenced && !fence && heading.test(line);
    });
}

// '# ⚔️ 일일 퀘스트'를 품은 섹션의 번호. 그 뒤의 ## 섹션은 퀘스트의 소제목이므로 늘리지 않고 시간도 다시 매기지 않는다. 없으면 섹션 수
function volumeQuestStart(sections) {
    const at = sections.findIndex(section => hasTopHeading(section.text, VOLUME_QUEST_HEADING));
    return at < 0 ? sections.length : at;
}

// 늘릴 수 있는 내용 섹션: 제목이 있고, 학습 목표·개요·체크리스트·고정·실습·요약 섹션이 아니며, # 제목을 품지 않는다. tabId: 채우는 탭
function isVolumeContentSection(section, lockedKeys = new Set(), tabId = 'basicLearn') {
    const title = volumeCleanTitle(section.title);
    if (!title || LESSON_FRAME_TITLE.test(title) || LESSON_OVERVIEW_TITLE.test(title)) return false;
    const skip = tabId === 'advLearn' ? VOLUME_SKIP_TITLE_ADV : VOLUME_SKIP_TITLE;
    if (lockedKeys.has(lockTitleKey(section.title)) || skip.test(title)) return false;
    return !hasTopHeading(section.text);
}

// 섹션마다 모자란 낭독 글자 수: (목표 − 늘리지 않는 섹션의 글자) × 그 섹션의 (⏱ N분) 비율 − 지금 글자. 라벨이 없으면 라벨 평균으로 본다
function volumeDeficits(open, total, goal) {
    const budget = goal - (total - open.reduce((sum, row) => sum + row.spoken, 0));
    const labels = open.map(row => volumeTitleMinutes(row.title));
    const labelled = labels.filter(Boolean);
    const average = labelled.length ? labelled.reduce((sum, n) => sum + n, 0) / labelled.length : 1;
    const weights = labels.map(n => n || average);
    const weightSum = weights.reduce((sum, n) => sum + n, 0);
    return open.map((row, i) => ({ ...row, deficit: budget * weights[i] / weightSum - row.spoken }));
}

// 부탁할 낭독 글자 수: 채울 글자 ÷ 지금까지 늘어난 비율(500자 단위, 3,000~12,000자). 소주제는 2,500자에 하나(2~5개)
function volumeRequestSize(need, ratio = VOLUME_START_RATIO) {
    const asked = Math.ceil(need / ratio / VOLUME_REQUEST_STEP) * VOLUME_REQUEST_STEP;
    const requestChars = Math.min(VOLUME_REQUEST_MAX, Math.max(VOLUME_REQUEST_MIN, asked));
    const subtopics = Math.min(VOLUME_SUBTOPICS_MAX, Math.max(VOLUME_SUBTOPICS_MIN, Math.round(requestChars / VOLUME_SUBTOPIC_CHARS)));
    return { need, requestChars, subtopics };
}

// 다음에 늘릴 섹션. 가장 많이 모자란 섹션을 고른다. 코드 차시에서 코드를 설명하는데 예제가 없는 섹션은 목표를 채운 뒤에도 한 번 먼저 고른다.
// avoid: 방금 늘지 않은 섹션. 다른 섹션이 있으면 바로 다시 고르지 않는다(한 섹션의 잇단 실패로 채우기 전체가 멈추지 않게). 고를 섹션이 없거나 목표를 채웠으면 null
function volumePlan(md, { goal = VOLUME_DEFAULT_GOAL, lockedKeys = new Set(), failures = new Map(), codeTopic = false, codeTried = new Set(), ratio = VOLUME_START_RATIO, avoid = null, tabId = 'basicLearn' } = {}) {
    const rows = mdSections(md).map((section, index) => ({ ...section, index, key: lockTitleKey(section.title), spoken: spokenChars(section.text) }));
    const total = rows.reduce((sum, row) => sum + row.spoken, 0);
    const quest = volumeQuestStart(rows);
    const candidates = rows.filter(row => row.index < quest && isVolumeContentSection(row, lockedKeys, tabId) && (failures.get(row.key) || 0) < VOLUME_SECTION_FAILS);
    const open = candidates.length ? volumeDeficits(candidates, total, goal) : [];
    const codeFirst = codeTopic ? open.find(row => !codeTried.has(row.key) && !lessonHasCodeExample(row.text) && lessonCodeSignals(row.text)) : null;
    if (!open.length || (total >= goal && !codeFirst)) return null;
    const others = open.filter(row => row.key !== avoid);
    const pick = codeFirst || (others.length ? others : open).reduce((best, row) => (row.deficit > best.deficit ? row : best));
    const need = total >= goal ? VOLUME_MIN_NEED : Math.min(Math.max(pick.deficit, VOLUME_MIN_NEED), goal - total);
    const codeSection = codeTopic && (lessonCodeSignals(pick.text) || lessonHasCodeExample(pick.text));
    return { ...pick, total, needCode: !!codeFirst, codeSection, ...volumeRequestSize(need, ratio) };
}

/* ---------- 받은 글 다듬기 ---------- */
// 출력 한도에서 잘린 답은 코드 블록 밖의 마지막 빈 줄에서 자른다(끝의 반쯤 쓴 문단을 버린다)
function cutAtLastBreak(text) {
    const lines = text.split('\n');
    let fence = 0;
    let cut = -1;
    lines.forEach((line, i) => {
        const wasFenced = fence;
        fence = nextCodeFence(fence, line);
        if (!wasFenced && !fence && !line.trim()) cut = i;
    });
    return cut > 0 ? lines.slice(0, cut).join('\n') : text;
}

// 섹션 안 ### 소주제 제목(코드 블록 밖). 되풀이한 소주제를 알아본다
function subtopicTitles(text) {
    let fence = 0;
    return String(text || '').split('\n').flatMap(line => {
        const wasFenced = fence;
        fence = nextCodeFence(fence, line);
        const heading = !wasFenced && !fence && line.match(/^###\s+(.*)$/);
        return heading ? [compactTitle(heading[1])] : [];
    });
}

// 줄을 소주제 덩어리로 나눈다. mermaid는 뺀다(같은 탭에 같은 종류를 되풀이하지 않는다). 코드 블록 밖의 #·##·### 제목은 '### ■ 제목'으로 맞춘다
function volumeSplitBlocks(text) {
    const blocks = [{ title: '', lines: [] }];
    let fence = 0;
    let mermaid = false;
    let dropped = false; // 방금 뺀 다이어그램 뒤의 빈 줄도 뺀다
    text.split('\n').forEach(line => {
        const wasFenced = fence;
        fence = nextCodeFence(fence, line);
        if (!wasFenced && fence) mermaid = /^\s*`{3,}\s*mermaid\b/i.test(line);
        if (mermaid && (wasFenced || fence)) {
            if (!fence) [mermaid, dropped] = [false, true];
            return;
        }
        if (dropped && !line.trim()) {
            dropped = false;
            return;
        }
        dropped = false;
        const heading = !wasFenced && !fence && line.match(/^#{1,3}\s+(\S.*)$/);
        if (!heading) {
            blocks.at(-1).lines.push(line);
            return;
        }
        const title = volumeCleanTitle(heading[1]).replace(/^■\s*/, '');
        if (title) blocks.push({ title, lines: [`### ■ ${title}`] }); // 글자 없는 제목 줄은 버린다
    });
    return blocks;
}

// 번호·아이콘·(⏱ N분)을 뺀 제목 키. 섹션 제목을 소주제로 되풀이했는지 본다
const volumeBareKey = title => compactTitle(String(title || '').replace(new RegExp(LESSON_HEADING_PREFIX), ''));

// 받은 답을 섹션 끝에 붙일 소주제로 다듬는다. 감싼 펜스·이어쓰기 표시·그림 태그를 떼고, 잘린 답은 마지막 빈 줄에서 자른 뒤 코드 블록을 닫는다.
// 학습 목표·개요·체크리스트 소주제, 섹션 제목을 되풀이한 소주제, 섹션이나 답 안에서 되풀이한 소주제, 본문 없는 제목은 버린다. 붙일 글이 없으면 ''
function cleanVolumeAddition(data, { sectionText = '', truncated = data?.candidates?.[0]?.finishReason === 'MAX_TOKENS' } = {}) {
    let text = extractText(data, { unwrap: true }).replace(/\r\n/g, '\n').replace(REVIEW_MARKERS, '').replace(VOLUME_IMAGE_TAG, '');
    if (truncated) text = cutAtLastBreak(text);
    text = closeOpenFence(text.trim());
    if (typeof sanitizeMarkdownContent === 'function') text = sanitizeMarkdownContent(text) || '';
    const seen = new Set(subtopicTitles(sectionText));
    const own = volumeBareKey(mdSections(sectionText)[0]?.title);
    const kept = volumeSplitBlocks(text).filter(block => {
        if (!block.title) return true;
        if (LESSON_FRAME_TITLE.test(block.title) || LESSON_OVERVIEW_TITLE.test(block.title)) return false;
        if (own && volumeBareKey(block.title) === own) return false;
        const key = compactTitle(block.title);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return kept.map(block => block.lines.join('\n').trim()).filter(part => part && !/^###\s[^\n]*$/.test(part)).join('\n\n');
}

/* ---------- 이어 붙이기 ---------- */
// 섹션 끝(끝의 <br> 간격 줄 앞)에 덧붙인다. 섹션 사이는 빈 줄 하나로 잇는다(checklistLast와 같다). 다른 섹션은 그대로다
function appendToSection(md, index, addition) {
    const sections = mdSections(md);
    if (!sections[index] || !String(addition || '').trim()) return md;
    const lines = sections[index].text.split('\n');
    let end = lines.length;
    while (end > 1 && /^\s*(?:<br\s*\/?>\s*)*$/i.test(lines[end - 1])) end -= 1;
    const text = [lines.slice(0, end).join('\n').trimEnd(), '<br>', String(addition).trim(), lines.slice(end).join('\n').trim()].filter(Boolean).join('\n\n');
    return sections.map((section, i) => (i === index ? text : section.text)).join('\n\n');
}

const volumeTitleKeys = md => mdSections(md).map(section => lockTitleKey(section.title)).join('\n');

// 받은 답을 고른 섹션에 붙인 글. ## 제목의 순서와 이름이 그대로이고 낭독 글자가 800자 넘게 늘었을 때만 받는다
// (코드 예제를 넣으라고 한 섹션은 예제가 들어왔으면 받는다. 코드는 분량에 들어가지 않는다). 받지 않으면 null.
// addition: 붙인 소주제(채우는 동안 탭이 바뀌면 지금 글에 다시 붙인다, rebaseVolumeParts)
function mergeVolumeAddition(md, plan, data) {
    const addition = cleanVolumeAddition(data, { sectionText: plan.text });
    if (!addition) return null;
    const next = appendToSection(md, plan.index, addition);
    if (volumeTitleKeys(next) !== volumeTitleKeys(md)) return null;
    const gain = spokenChars(next) - spokenChars(md);
    return gain >= VOLUME_STALL_CHARS || (plan.needCode && lessonHasCodeExample(addition)) ? { md: next, gain, addition } : null;
}

/* ---------- (⏱ N분) 다시 매기기 ---------- */
function withTitleMinutes(text, minutes) {
    const [head, ...rest] = String(text).split('\n');
    const label = `(⏱ ${minutes}분)`;
    const next = VOLUME_TIME_LABEL.test(head) ? head.replace(VOLUME_TIME_LABEL, label) : `${head.trimEnd()} ${label}`;
    return [next, ...rest].join('\n');
}

const volumeLabelSum = md => mdSections(md).reduce((sum, section) => sum + volumeTitleMinutes(section.title), 0);

// 체크리스트의 다시 보기 표시와 그 뒤 섹션 이름에 붙은 시간((⏱ N분)·⏱ N분)
const VOLUME_CHECK_REF = /다시\s*보기\s*:/;
const VOLUME_REF_TIME = /\s*[(（]\s*⏱[^()（）]*[)）]|\s*⏱\S*\s*(?:약\s*)?\d+\s*분/g;

// 체크리스트 항목의 '다시 보기:' 뒤 섹션 이름에서 시간을 뗀다. AI는 ## 제목을 (⏱ N분)까지 옮겨 적으므로 시간을 다시 매기면 옛 시간이 남는다.
// 섹션 이름만 남기면 검수(lesson-lint.js lintChecklistRefs)가 시간 없이 같은 섹션을 찾는다. 고정한 체크리스트와 코드 블록 안은 그대로 둔다. 뗄 것이 없으면 받은 글 그대로다
function withoutChecklistRefTimes(md, lockedKeys = new Set()) {
    let changed = false;
    const texts = mdSections(md).map(section => {
        if (!LESSON_CHECKLIST_TITLE.test(section.title) || lockedKeys.has(lockTitleKey(section.title))) return section.text;
        let fence = 0;
        return section.text.split('\n').map(line => {
            const wasFenced = fence;
            fence = nextCodeFence(fence, line);
            const ref = !wasFenced && !fence ? line.match(VOLUME_CHECK_REF) : null;
            if (!ref) return line;
            const from = ref.index + ref[0].length;
            const next = line.slice(0, from) + line.slice(from).replace(VOLUME_REF_TIME, '');
            if (next !== line) changed = true;
            return next;
        }).join('\n');
    });
    return changed ? texts.join('\n\n') : md;
}

// 분량을 채운 학습 탭을 AI가 고쳐 준 뒤(tabs.js·api.js·fillVolumeJob)에도 다시 보기에 옛 시간이 남지 않게 뗀다. lockedBlocks: 고정 섹션
const volumeChecklistText = (md, lockedBlocks = []) => withoutChecklistRefTimes(md, new Set(lockedBlocks.map(block => lockTitleKey(block.title))));

// 내용 섹션의 (⏱ N분)을 낭독 길이에 맞춰 다시 매긴다. 학습 목표·개요·체크리스트·고정·실습·요약 섹션의 라벨은 그대로 두고,
// 목표 시간에서 그 합을 뺀 시간을 낭독 글자 비율로 5분 단위로 나눈다(섹션마다 5분 이상). 남은 시간은 5분 단위로 올려 라벨 합계가 목표 시간 이상이 된다.
// 다시 매긴 제목과 어긋나지 않게 체크리스트의 다시 보기에 적힌 옛 시간도 뗀다
function retimeSections(md, targetMinutes, lockedKeys = new Set(), tabId = 'basicLearn') {
    const sections = mdSections(md).map((section, index) => ({ ...section, index }));
    const quest = volumeQuestStart(sections);
    const open = sections.filter(section => section.index < quest && isVolumeContentSection(section, lockedKeys, tabId));
    if (!open.length) return md;
    const openIndexes = new Set(open.map(section => section.index));
    const kept = sections.filter(section => !openIndexes.has(section.index)).reduce((sum, section) => sum + volumeTitleMinutes(section.title), 0);
    const total = Math.max(open.length * VOLUME_TIME_UNIT, Math.ceil((targetMinutes - kept) / VOLUME_TIME_UNIT) * VOLUME_TIME_UNIT);
    const minutes = allocateTime(open.length, total, open.map(section => spokenChars(section.text)), VOLUME_TIME_UNIT);
    const labels = new Map(open.map((section, i) => [section.index, minutes[i]]));
    const retimed = sections.map(section => (labels.has(section.index) ? withTitleMinutes(section.text, labels.get(section.index)) : section.text)).join('\n\n');
    return withoutChecklistRefTimes(retimed, lockedKeys);
}

/* ---------- 채우기 ---------- */
// 분량 채우기에 붙일 참고 자료와 참고 파일. 작업을 시작할 때(기다리기 전에) 잡아 둔다. 기다리는 동안 다른 교과로 옮겨도 그 교과 자료를 섞지 않는다
function volumeSnapshot(mod) {
    return {
        referenceContext: typeof getReferenceContext === 'function' ? getReferenceContext(VOLUME_REFERENCE_CHARS) : '',
        attachmentPrompt: typeof lessonAttachmentPrompt === 'function' && mod ? lessonAttachmentPrompt(mod.id) : ''
    };
}

function volumeJob({ md = '', mod = null, tabId = 'basicLearn', lockedBlocks = [], targetMinutes = 0, codeTopic = false, referenceContext = '', attachmentPrompt = '', fromUpload = false, isStopped, isLive, onStatus, onRetry = null, waitSignal = null } = {}) {
    const minutes = Number(targetMinutes) > 0 ? Number(targetMinutes) : learnTargetMinutes(mod, tabId) || LEARN_TARGET_MINUTES;
    const targetChars = minutes * READ_CHARS_PER_MINUTE;
    const blocks = Array.isArray(lockedBlocks) ? lockedBlocks.filter(block => block && typeof block.text === 'string') : [];
    return {
        md: String(md ?? ''), mod: mod || {}, tabId, lockedBlocks: blocks, lockedKeys: new Set(blocks.map(block => lockTitleKey(block.title))),
        targetMinutes: minutes, targetChars, goal: Math.ceil(targetChars * VOLUME_MARGIN),
        cap: Math.min(VOLUME_CALL_LIMIT, Math.ceil(targetChars / VOLUME_CHARS_PER_CALL)),
        codeTopic: !!codeTopic, referenceContext: String(referenceContext || ''), attachmentPrompt: String(attachmentPrompt || ''), fromUpload: !!fromUpload,
        isStopped: typeof isStopped === 'function' ? isStopped : () => false,
        isLive: typeof isLive === 'function' ? isLive : () => true,
        onStatus: typeof onStatus === 'function' ? onStatus : () => {},
        onRetry, waitSignal,
        calls: 0, added: 0, stalls: 0, requested: 0, gained: 0, retried: false, lastFailed: null, parts: [],
        failures: new Map(), codeTried: new Set(), stopped: false, gone: false, error: null, reason: ''
    };
}

const volumeRatio = job => (job.requested ? Math.min(VOLUME_RATIO_MAX, Math.max(VOLUME_RATIO_MIN, job.gained / job.requested)) : VOLUME_START_RATIO);

// 일괄 작업을 멈출 오류(하루 한도·한도 0·키·연결 문제, ai-errors.js)와 다시 보내도 같은 오류(noRetry)는 바로 멈춘다
const isVolumeHalt = err => (typeof aiErrorStopsRun === 'function' && aiErrorStopsRun(err)) || !!err?.noRetry;

const volumeStatus = job => `📚 ${reviewTabLabel(job.tabId)} 분량 채우는 중 · 낭독 약 ${readAloudMinutes(job.md)}/${job.targetMinutes}분 · 보강 ${job.calls + 1}/${job.cap}회`;

// 고른 섹션 끝에 붙일 새 소주제를 받는다. 받고 있는 답은 끝까지 받고(waitSignal만 넘긴다), 다시 보내려고 기다리는 것만 중지로 끊는다.
// 프롬프트는 시작할 때 잡은 글·차시·참고 자료로 만든다(지금 열린 교과를 읽지 않는다)
function requestVolumeAddition(job, plan) {
    const { systemInstruction, userPrompt } = buildTaskContext('volume_expand', {
        tabId: job.tabId, tabLabel: reviewTabLabel(job.tabId), title: job.mod.title, description: job.mod.description, targetMinutes: job.targetMinutes,
        outline: mdSections(job.md).filter(section => section.title).map(section => section.title),
        objectives: lessonLintBullets(job.md, '학습\\s*목표'), sectionTitle: plan.title, sectionText: plan.text,
        requestChars: plan.requestChars, subtopics: plan.subtopics, codeSection: plan.codeSection, needCode: plan.needCode, fromUpload: job.fromUpload
    });
    const level = typeof lessonGenOptions === 'function' ? lessonGenOptions(job.mod).level : '';
    const text = userPrompt + (level ? `\n\n[생성 옵션 — 반드시 반영]\n- 학습자 수준: ${level}` : '') + job.referenceContext + job.attachmentPrompt;
    return callGemini(TEXT_MODEL, {
        contents: [{ role: 'user', parts: [{ text }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { maxOutputTokens: VOLUME_MAX_OUTPUT_TOKENS },
        waitSignal: job.waitSignal, timing: 'long'
    }, job.onRetry);
}

// 호출 하나. 잠깐의 오류는 한 번만 30초 기다렸다 같은 섹션을 다시 부르도록 null을 돌려준다. 중지·한도·키 문제·두 번째 실패는 던진다
async function volumeCall(job, plan) {
    job.onStatus(volumeStatus(job));
    try {
        const data = await requestVolumeAddition(job, plan);
        job.calls += 1;
        return data;
    } catch (err) {
        job.calls += 1;
        if (err?.name === 'AbortError' || isVolumeHalt(err) || job.retried) throw err;
        job.retried = true;
        console.warn('[분량 채우기] 호출이 실패해 30초 뒤 한 번 더 해 봅니다:', err?.message || err);
        job.onStatus('⏳ 분량 채우기 호출이 실패해 30초 뒤 한 번 더 해 봅니다...');
        await waitMs(VOLUME_RETRY_WAIT_MS, job.waitSignal);
        return null;
    }
}

// 받은 답을 붙이거나(늘어난 글자를 센다) 버린다(잇단 실패와 그 섹션의 실패로 센다. 다음에는 다른 섹션부터 고른다)
function volumeMerge(job, plan, data) {
    const merged = mergeVolumeAddition(job.md, plan, data);
    job.requested += plan.requestChars;
    if (plan.needCode) job.codeTried.add(plan.key);
    if (!merged) {
        job.stalls += 1;
        job.failures.set(plan.key, (job.failures.get(plan.key) || 0) + 1);
        job.lastFailed = plan.key;
        return;
    }
    job.md = merged.md;
    job.parts.push({ key: plan.key, text: merged.addition });
    job.gained += Math.max(0, merged.gain);
    job.added += 1;
    job.stalls = 0;
    job.lastFailed = null;
}

const volumeStop = job => {
    job.stopped = true;
    return 'stopped';
};

const volumeGone = job => {
    job.gone = true;
    return 'gone';
};

// 멈춘 까닭: target(목표를 채움) · none(늘릴 섹션 없음) · cap(호출 상한) · stall(잇달아 늘지 않음) · stopped · gone · error
async function volumeLoop(job) {
    while (true) {
        if (job.isStopped()) return volumeStop(job);
        if (!job.isLive()) return volumeGone(job);
        const plan = volumePlan(job.md, { goal: job.goal, lockedKeys: job.lockedKeys, failures: job.failures, codeTopic: job.codeTopic, codeTried: job.codeTried, ratio: volumeRatio(job), avoid: job.lastFailed, tabId: job.tabId });
        if (!plan) return spokenChars(job.md) >= job.goal ? 'target' : 'none';
        if (job.calls >= job.cap) return 'cap';
        if (job.calls > 0) await waitMs(VOLUME_COOLDOWN_MS, job.waitSignal);
        if (job.isStopped()) return volumeStop(job);
        const data = await volumeCall(job, plan);
        if (data === null) continue;
        if (!job.isLive()) return volumeGone(job);
        volumeMerge(job, plan, data); // 중지를 눌러도 받은 답은 붙인다
        if (job.isStopped()) return volumeStop(job);
        if (job.stalls >= VOLUME_STALL_LIMIT) return 'stall';
    }
}

function volumeFailure(job, err) {
    if (err?.name === 'AbortError') return volumeStop(job); // 기다리던 중 중지했다
    if (!isVolumeHalt(err)) console.warn('[분량 채우기] 멈춥니다:', err);
    job.error = err;
    return 'error';
}

// 끝난 글: 중지하지 않았으면 (⏱ N분)을 다시 매기고(붙인 글이 있거나 라벨 합계가 목표에서 벗어났을 때) 고정 섹션을 되돌리고 체크리스트를 맨 끝에 둔다
function volumeFinalText(job) {
    const sum = volumeLabelSum(job.md);
    const labelsFit = sum >= job.targetMinutes && sum <= job.targetMinutes + BASIC_LEARN_LABEL_SLACK;
    let md = job.md;
    if (!job.stopped && (job.added > 0 || !labelsFit)) {
        try {
            md = retimeSections(md, job.targetMinutes, job.lockedKeys, job.tabId);
        } catch (err) {
            console.warn('[분량 채우기] (⏱) 시간을 다시 매기지 못해 그대로 둡니다:', err);
        }
    }
    return checklistLast(restoreLockedSections(md, job.lockedBlocks), job.tabId);
}

function volumeResult(job) {
    const md = job.gone ? job.md : volumeFinalText(job);
    const spoken = spokenChars(md);
    return {
        md, spoken, minutes: readAloudMinutes(md), targetMinutes: job.targetMinutes, targetChars: job.targetChars,
        calls: job.calls, added: job.added, short: spoken < job.targetChars, stopped: job.stopped, gone: job.gone, error: job.error, reason: job.reason, parts: job.parts
    };
}

// 채우는 동안 탭이 바뀌었으면(그림을 지우거나 글을 고쳤다) 붙인 소주제를 지금 글(current)의 같은 제목 섹션 끝에 다시 붙이고 (⏱)를 다시 매긴다.
// 분량 채우기는 섹션 끝에 소주제를 붙이고 시간을 다시 매길 뿐이라 지금 글의 다른 곳은 그대로다. 붙일 섹션이 없어졌으면 null
function rebaseVolumeParts(current, parts, { targetMinutes, lockedBlocks = [], tabId = 'basicLearn', stopped = false } = {}) {
    let md = String(current ?? '');
    for (const part of parts || []) {
        const index = mdSections(md).findIndex(section => lockTitleKey(section.title) === part.key);
        if (index < 0) return null;
        md = appendToSection(md, index, part.text);
    }
    const lockedKeys = new Set(lockedBlocks.map(block => lockTitleKey(block.title)));
    return volumeFinalText({ md, added: (parts || []).length, stopped, targetMinutes, lockedKeys, lockedBlocks, tabId });
}

// 미리 보기에서 섹션을 골라 반영한 글은 (⏱) 합계가 목표에서 벗어날 수 있어 고른 글로 다시 매긴다(고정 섹션의 라벨은 그대로).
// 다시 매긴 섹션과 예전 체크리스트를 함께 고를 수 있어, 합계가 맞아 다시 매기지 않아도 다시 보기의 옛 시간은 뗀다
function retimeVolumeChoice(md, { targetMinutes, lockedBlocks = [], tabId = 'basicLearn' } = {}) {
    const sum = volumeLabelSum(md);
    if (sum >= targetMinutes && sum <= targetMinutes + BASIC_LEARN_LABEL_SLACK) return volumeChecklistText(md, lockedBlocks);
    try {
        return retimeSections(md, targetMinutes, new Set(lockedBlocks.map(block => lockTitleKey(block.title))), tabId);
    } catch (err) {
        console.warn('[분량 채우기] 고른 글의 (⏱) 시간을 다시 매기지 못해 그대로 둡니다:', err);
        return md;
    }
}

// 학습 탭 글(md)을 낭독 목표 분량까지 채운 결과를 돌려준다. 차시(mod)에는 쓰지 않고(부른 쪽이 저장한다) 어떤 실패도 던지지 않는다.
// 중지·차시가 사라짐(isLive)·한도와 키 문제·호출 상한·잇단 실패·늘릴 섹션 없음에서 멈춘다.
// 결과: { md, spoken, minutes, targetMinutes, targetChars, calls, added, short, stopped, gone, error, reason, parts(붙인 소주제 [{ key, text }]) }
async function ensureSpokenVolume(options = {}) {
    const job = volumeJob(options);
    _volumeRunning += 1;
    try {
        job.reason = await volumeLoop(job);
    } catch (err) {
        job.reason = volumeFailure(job, err);
    } finally {
        _volumeRunning -= 1;
    }
    return volumeResult(job);
}

window.isVolumeFilling = () => _volumeRunning > 0;

/* ---------- 탭 위 표시와 '분량 채우기' ---------- */
const VOLUME_UNAPPLIED_REASON = '분량 채우기 결과(반영 안 함)';

// tabId는 학습 탭 id(basicLearn·advLearn)만 온다(syncVolumeChip이 fillsLearnVolume으로 고른다)
function volumeChipButton(mod, tabId = 'basicLearn') {
    return `<button type="button" data-volume-lesson="${escapeHtml(String(mod.id))}" data-volume-tab="${escapeHtml(tabId)}" onclick="fillLessonVolume(this.dataset.volumeLesson, this.dataset.volumeTab)" class="px-1.5 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors" title="모자란 섹션마다 새 소주제를 이어 붙여 목표 분량까지 채웁니다">분량 채우기</button>`;
}

// 학습 탭에 보이는 글: 저장된 글에서 화면이 숨기는 첫머리(앞 그림·시간표·특징 목록)를 뺀다(lesson-opening.js).
// 다른 탭에만 글이 있는 차시의 비운 기본학습은 빈 글이다(lesson-review.js storedTabMarkdown)
function volumeShownText(mod, tabId = 'basicLearn') {
    const stored = String(storedTabMarkdown(mod, tabId) || '');
    return typeof cleanLessonOpening === 'function' ? cleanLessonOpening(stored) : stored;
}

// 탭 위 '낭독 약 N분 / 목표 480분'. 학습 탭(기본학습·심화학습)을 볼 때만 보이고(최종 평가와 교수안·슬라이드·문제은행 화면에서는 숨긴다) 모자라면 '분량 채우기'를 붙인다.
// 분은 내림이라 모자란 글이 목표 시간으로 보이지 않는다(lesson-lint.js readAloudMinutes)
window.syncVolumeChip = function (mod = getEditingModule()) {
    const chip = document.getElementById('lesson-volume-chip');
    if (!chip) return;
    const panelOpen = typeof _lessonPanel !== 'undefined' && !!_lessonPanel;
    const tab = typeof currentLessonTab !== 'undefined' ? currentLessonTab : '';
    const md = !panelOpen && fillsLearnVolume(mod, tab) ? volumeShownText(mod, tab) : '';
    if (!md.trim()) {
        chip.className = 'hidden';
        chip.innerHTML = '';
        return;
    }
    const spoken = spokenChars(md);
    const target = learnTargetMinutes(mod, tab);
    const short = spoken < target * READ_CHARS_PER_MINUTE;
    chip.className = `${VOLUME_CHIP_CLASS} ${short ? VOLUME_CHIP_TONES.short : VOLUME_CHIP_TONES.done}`;
    chip.title = VOLUME_CHIP_TITLE;
    chip.innerHTML = `<span>낭독 약 ${readAloudMinutes(md)}분 / 목표 ${target}분</span>${short ? volumeChipButton(mod, tab) : ''}`;
};

// '분량 채우기'가 끝난 뒤 알릴 글. md: 반영할 글, label: 채운 탭 이름(기본학습·심화학습)
function volumeSummaryText(volume, md, label = reviewTabLabel('basicLearn')) {
    const minutes = readAloudMinutes(md);
    if (spokenChars(md) >= volume.targetChars) return `${label}을 낭독 약 ${minutes}분(목표 ${volume.targetMinutes}분)까지 채웠습니다.`;
    return [
        `${label}은 낭독 약 ${minutes}분으로 목표 ${volume.targetMinutes}분에 못 미칩니다.`,
        volume.stopped ? '중지해서 받은 데까지만 붙였습니다.' : '',
        volume.error?.message || '',
        volume.reason === 'none' ? '고정 섹션과 실습·요약 섹션은 늘리지 않습니다.' : '',
        "다시 '분량 채우기'를 누르면 이어서 늘립니다."
    ].filter(Boolean).join(' ');
}

// '분량 채우기'가 쓸 AI 호출 수 어림(cost-estimate.js 예고): 모자란 낭독 글자를 호출 하나가 늘리는 글자(5,000자)로 나눈 수(호출 상한까지)와 채운 뒤 자동 수정 횟수
function volumeCallEstimate(md, targetMinutes) {
    const targetChars = targetMinutes * READ_CHARS_PER_MINUTE;
    const cap = Math.min(VOLUME_CALL_LIMIT, Math.ceil(targetChars / VOLUME_CHARS_PER_CALL));
    const need = Math.max(0, Math.ceil(targetChars * VOLUME_MARGIN) - spokenChars(md));
    return Math.min(cap, Math.max(1, Math.ceil(need / VOLUME_CHARS_PER_CALL))) + VOLUME_FIX_ROUNDS;
}

// 반영하지 않은 채운 글을 작업 기록에 남긴다(다시 채우지 않아도 그 글로 되돌릴 수 있게). 남긴 곳을 알리는 글을 돌려준다
async function keepVolumeText(mod, md, tabId = 'basicLearn') {
    await archiveContent({ title: mod.tabContents ? `${mod.title} · ${reviewTabLabel(tabId)}` : mod.title, content: md, images: mod.images, tabId, lesson: mod }, VOLUME_UNAPPLIED_REASON);
    return `채운 글은 작업 기록에 '${VOLUME_UNAPPLIED_REASON}'으로 남겼습니다.`;
}

// 진행 막대 안에서 채운다. 늘린 소주제가 있으면 컨벤션 필수 지적을 고쳐 받고, 바뀐 섹션을 골라 반영한다(이전 글은 작업 기록에 '분량 채우기 전'으로 남는다). 그림은 만들지 않는다.
// 다른 교과로 옮겨도 그 차시에 반영한다. 채우는 동안 그 학습 탭이 바뀌었으면(그림 지우기·두 번 눌러 고치기·원문 칸 등) 늘린 소주제를 지금 글에 이어 붙인다.
// 반영하지 못하거나 반영하지 않기를 고른 채운 글은 작업 기록에 남긴다. tabId: 채우는 학습 탭(기본학습·심화학습)
async function fillVolumeJob({ mod, subj, before, snapshot, tabId = 'basicLearn' }) {
    const label = reviewTabLabel(tabId);
    const targetMinutes = learnTargetMinutes(mod, tabId);
    const lockedBlocks = lockedSectionBlocks(mod, tabId);
    const keep = md => keepVolumeText(mod, md, tabId);
    const isStopped = () => !!window.isTabGenerationStopped?.();
    const isLive = () => !subj || typeof lessonStillLive !== 'function' || lessonStillLive(subj, mod);
    const volume = await ensureSpokenVolume({
        ...snapshot, md: before, mod, tabId, lockedBlocks, targetMinutes, codeTopic: lessonCodeTopic(mod), fromUpload: !!mod.uploadedMdContent,
        isStopped, isLive, onStatus: window.setPipelineStatus, waitSignal: window.aiStopSignal?.() || null
    });
    const gone = '차시가 지워졌거나 불러온 내용으로 바뀌어 분량 채우기를';
    if (volume.gone) return window.showAlert(`${gone} 멈췄습니다.${volume.added ? ` ${await keep(volume.md)}` : ''}`);
    // 늘린 소주제가 없으면 고쳐 받지 않는다(있던 글만 고치는 호출이 된다). 중지·한도·키 문제·다시 보내도 같은 오류로 멈췄을 때도.
    // 고쳐 받은 체크리스트에도 다시 보기의 옛 시간이 남지 않게 뗀다
    const fixable = volume.added > 0 && !volume.stopped && !isVolumeHalt(volume.error);
    const filled = fixable
        ? volumeChecklistText(await autoFixGeneratedTab({ tabId, md: volume.md, lockedBlocks, onStatus: window.setPipelineStatus, rounds: VOLUME_FIX_ROUNDS, minSpokenChars: volume.targetChars, isStopped }), lockedBlocks)
        : volume.md;
    if (!isLive()) return window.showAlert(`${gone} 반영하지 못했습니다. ${await keep(filled)}`);
    saveOpenEditsFor(mod, tabId); // 열어 둔 원문 칸의 글을 먼저 넣는다(미리 보기의 단추를 누르며 칸을 벗어나 넣으면 반영을 막는다)
    const current = String(storedTabMarkdown(mod, tabId) || '');
    let [base, next, rebaseNote] = [before, filled, ''];
    if (current !== before) {
        const rebased = rebaseVolumeParts(current, volume.parts, { targetMinutes, lockedBlocks: lockedSectionBlocks(mod, tabId), tabId, stopped: volume.stopped });
        if (rebased === null) return window.showAlert(`채우는 동안 ${label}의 섹션 제목이 바뀌어 늘린 소주제를 붙일 자리를 찾지 못했습니다. ${await keep(filled)}`);
        [base, next, rebaseNote] = [current, rebased, `채우는 동안 ${label}이 바뀌어, 늘린 소주제를 지금 글에 이어 붙였습니다(자동 수정은 반영하지 않았습니다).`];
    }
    if (next === base) return window.showAlert(volumeSummaryText(volume, next, label));
    window.setPipelineStatus('바뀐 섹션을 골라 반영해 주세요.');
    const choice = await previewAiChange(base, next, { title: `${label} 분량 채우기 미리보기`, tabId, note: [rebaseNote, volumeSummaryText(volume, next, label)].filter(Boolean).join(' '), cancelLabel: '반영하지 않기' });
    if (choice === null || choice === base) return window.showToast?.(`분량 채우기를 반영하지 않았습니다. ${await keep(next)}`, 'info');
    const approved = choice === next ? choice : retimeVolumeChoice(choice, { targetMinutes, lockedBlocks: lockedSectionBlocks(mod, tabId), tabId });
    saveOpenEditsFor(mod, tabId);
    if (!isLive() || storedTabMarkdown(mod, tabId) !== base) return window.showAlert(`고르는 동안 ${label}이 바뀌어 반영하지 못했습니다. ${await keep(approved)}`);
    if (!(await commitTabChange(mod, tabId, base, approved, `${label} 분량 채우기(낭독 약 ${readAloudMinutes(approved)}분)`, '분량 채우기 전'))) return;
    window.notifyLessonJobDone(volumeSummaryText(volume, approved, label), spokenChars(approved) >= volume.targetChars ? 'success' : 'warning');
}

// 탭 위 '분량 채우기': 지금 학습 탭(기본학습·심화학습)에서 모자란 분량만 이어서 채운다. 시작 전에 호출 수·시간을 보이고 묻는다.
// tabId는 화면의 단추가 넘긴 값이라 학습 탭인지 다시 본다(아니면 하지 않는다)
window.fillLessonVolume = async function (id, tabId = 'basicLearn') {
    const mod = getEditingModule(id);
    if (!fillsLearnVolume(mod, tabId)) return;
    if (window.isLessonPipelineRunning?.()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    const label = reviewTabLabel(tabId);
    saveOpenEditsFor(mod, tabId);
    const current = String(storedTabMarkdown(mod, tabId) || '');
    if (!current.trim()) return window.showAlert(`먼저 ${label} 탭을 생성해 주세요.`);
    const target = learnTargetMinutes(mod, tabId);
    const message = `${label}은 지금 낭독 약 ${readAloudMinutes(volumeShownText(mod, tabId))}분입니다. 목표 ${target}분이 될 때까지 모자란 내용 섹션 끝에 새 소주제를 이어 붙이고, 각 ## 제목의 시간(⏱)을 낭독 길이에 맞춰 다시 매깁니다. 컨벤션 필수 지적이 남은 섹션은 AI가 고쳐 쓸 수 있습니다. 끝나면 바뀐 섹션을 골라 반영하고, 채우기 전 글은 작업 기록에 남습니다.`;
    const work = { volume: 1, volumeCalls: volumeCallEstimate(current, target), volumeMinutes: target, ...(tabId === 'advLearn' ? { volumeAdv: 1 } : {}) };
    if (!(await confirmWithEstimate(message, work, { title: `${label} 분량 채우기`, okLabel: '분량 채우기' }))) return;
    if (getEditingModule(id) !== mod) return;
    saveOpenEditsFor(mod, tabId); // 묻는 동안 고친 글도 넣고 시작한다
    const subj = globalState.subjects.find(item => item.id === currentSubjectId);
    const job = { mod, subj, tabId, before: String(storedTabMarkdown(mod, tabId) || ''), snapshot: volumeSnapshot(mod) };
    await window.runLessonJob(mod.id, { label: `${label} 분량 채우기`, current: tabId, alerts: true }, () => fillVolumeJob(job));
};
