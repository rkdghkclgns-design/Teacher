// lesson-volume.js - 기본 학습을 강사가 소리 내어 읽어도 목표 시간(최소 480분)이 차는 분량까지 섹션마다 나눠 채운다
// 초안을 받은 뒤 목표에 못 미친 내용 섹션 끝에 새 ### 소주제를 이어 붙인다. 있던 글·고정 섹션·학습 목표·개요·체크리스트·그림 자리는 그대로 둔다.
// 분량은 lesson-lint.js spokenChars로 센다(공백 포함 1분에 250자, 코드·표·그림·서식 기호 제외).
// 탭 생성(tabs.js generateTabContent)·교안 전체 생성(api.js generateModuleContent)·탭 위 '분량 채우기'가 쓴다. 테스트: tests/lesson-volume.test.js

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
const VOLUME_DEFAULT_GOAL = Math.ceil(BASIC_LEARN_MIN_MINUTES * READ_CHARS_PER_MINUTE * VOLUME_MARGIN);
const VOLUME_TIME_LABEL = /\(\s*⏱[^)]*\)|⏱\S*\s*(?:약\s*)?\d+\s*분/;
const VOLUME_IMAGE_TAG = /<!--\s*\[IMG:[\s\S]*?-->/g;
const VOLUME_QUEST_HEADING = /^#\s.*일일\s*퀘스트/; // 교안 전체 생성이 본문 뒤에 붙이는 '# ⚔️ 일일 퀘스트 (실습 과제)'
// 늘리지 않는 섹션: 실습·심화·일일 퀘스트·과제·평가로 시작하거나, 루브릭·채점이 들거나, 요약·정리·마무리로 끝나는 제목.
// '기획 문서로 정리'처럼 을·를·로·에 뒤의 정리는 하는 일을 말하는 내용 섹션이므로 늘린다
const VOLUME_SKIP_TITLE = new RegExp(`${LESSON_HEADING_PREFIX}(?:실습|심화|일일\\s*퀘스트|과제|평가)|루브릭|채점|(?<![을를로에]\\s?)(?:요약|정리|마무리)$`);
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

// 늘릴 수 있는 내용 섹션: 제목이 있고, 학습 목표·개요·체크리스트·고정·실습·요약 섹션이 아니며, # 제목을 품지 않는다
function isVolumeContentSection(section, lockedKeys = new Set()) {
    const title = volumeCleanTitle(section.title);
    if (!title || LESSON_FRAME_TITLE.test(title) || LESSON_OVERVIEW_TITLE.test(title)) return false;
    if (lockedKeys.has(lockTitleKey(section.title)) || VOLUME_SKIP_TITLE.test(title)) return false;
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
function volumePlan(md, { goal = VOLUME_DEFAULT_GOAL, lockedKeys = new Set(), failures = new Map(), codeTopic = false, codeTried = new Set(), ratio = VOLUME_START_RATIO, avoid = null } = {}) {
    const rows = mdSections(md).map((section, index) => ({ ...section, index, key: lockTitleKey(section.title), spoken: spokenChars(section.text) }));
    const total = rows.reduce((sum, row) => sum + row.spoken, 0);
    const quest = volumeQuestStart(rows);
    const candidates = rows.filter(row => row.index < quest && isVolumeContentSection(row, lockedKeys) && (failures.get(row.key) || 0) < VOLUME_SECTION_FAILS);
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
// (코드 예제를 넣으라고 한 섹션은 예제가 들어왔으면 받는다. 코드는 분량에 들어가지 않는다). 받지 않으면 null
function mergeVolumeAddition(md, plan, data) {
    const addition = cleanVolumeAddition(data, { sectionText: plan.text });
    if (!addition) return null;
    const next = appendToSection(md, plan.index, addition);
    if (volumeTitleKeys(next) !== volumeTitleKeys(md)) return null;
    const gain = spokenChars(next) - spokenChars(md);
    return gain >= VOLUME_STALL_CHARS || (plan.needCode && lessonHasCodeExample(addition)) ? { md: next, gain } : null;
}

/* ---------- (⏱ N분) 다시 매기기 ---------- */
function withTitleMinutes(text, minutes) {
    const [head, ...rest] = String(text).split('\n');
    const label = `(⏱ ${minutes}분)`;
    const next = VOLUME_TIME_LABEL.test(head) ? head.replace(VOLUME_TIME_LABEL, label) : `${head.trimEnd()} ${label}`;
    return [next, ...rest].join('\n');
}

const volumeLabelSum = md => mdSections(md).reduce((sum, section) => sum + volumeTitleMinutes(section.title), 0);

// 내용 섹션의 (⏱ N분)을 낭독 길이에 맞춰 다시 매긴다. 학습 목표·개요·체크리스트·고정·실습·요약 섹션의 라벨은 그대로 두고,
// 목표 시간에서 그 합을 뺀 시간을 낭독 글자 비율로 5분 단위로 나눈다(섹션마다 5분 이상). 남은 시간은 5분 단위로 올려 라벨 합계가 목표 시간 이상이 된다
function retimeSections(md, targetMinutes, lockedKeys = new Set()) {
    const sections = mdSections(md).map((section, index) => ({ ...section, index }));
    const quest = volumeQuestStart(sections);
    const open = sections.filter(section => section.index < quest && isVolumeContentSection(section, lockedKeys));
    if (!open.length) return md;
    const openIndexes = new Set(open.map(section => section.index));
    const kept = sections.filter(section => !openIndexes.has(section.index)).reduce((sum, section) => sum + volumeTitleMinutes(section.title), 0);
    const total = Math.max(open.length * VOLUME_TIME_UNIT, Math.ceil((targetMinutes - kept) / VOLUME_TIME_UNIT) * VOLUME_TIME_UNIT);
    const minutes = allocateTime(open.length, total, open.map(section => spokenChars(section.text)), VOLUME_TIME_UNIT);
    const labels = new Map(open.map((section, i) => [section.index, minutes[i]]));
    return sections.map(section => (labels.has(section.index) ? withTitleMinutes(section.text, labels.get(section.index)) : section.text)).join('\n\n');
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
    const minutes = Number(targetMinutes) > 0 ? Number(targetMinutes) : basicLearnTargetMinutes(mod);
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
        calls: 0, added: 0, stalls: 0, requested: 0, gained: 0, retried: false, lastFailed: null,
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
        const plan = volumePlan(job.md, { goal: job.goal, lockedKeys: job.lockedKeys, failures: job.failures, codeTopic: job.codeTopic, codeTried: job.codeTried, ratio: volumeRatio(job), avoid: job.lastFailed });
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
            md = retimeSections(md, job.targetMinutes, job.lockedKeys);
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
        md, spoken, minutes: Math.round(spoken / READ_CHARS_PER_MINUTE), targetMinutes: job.targetMinutes, targetChars: job.targetChars,
        calls: job.calls, added: job.added, short: spoken < job.targetChars, stopped: job.stopped, gone: job.gone, error: job.error, reason: job.reason
    };
}

// 기본 학습 글(md)을 낭독 목표 분량까지 채운 결과를 돌려준다. 차시(mod)에는 쓰지 않고(부른 쪽이 저장한다) 어떤 실패도 던지지 않는다.
// 중지·차시가 사라짐(isLive)·한도와 키 문제·호출 상한·잇단 실패·늘릴 섹션 없음에서 멈춘다.
// 결과: { md, spoken, minutes, targetMinutes, targetChars, calls, added, short, stopped, gone, error, reason }
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
function volumeChipButton(mod) {
    return `<button type="button" data-volume-lesson="${escapeHtml(String(mod.id))}" onclick="fillLessonVolume(this.dataset.volumeLesson)" class="px-1.5 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors" title="모자란 섹션마다 새 소주제를 이어 붙여 목표 분량까지 채웁니다">분량 채우기</button>`;
}

// 탭 위 '낭독 약 N분 / 목표 480분'. 기본 학습 탭을 볼 때만 보이고(최종 평가와 교수안·슬라이드·문제은행 화면에서는 숨긴다) 모자라면 '분량 채우기'를 붙인다
window.syncVolumeChip = function (mod = getEditingModule()) {
    const chip = document.getElementById('lesson-volume-chip');
    if (!chip) return;
    const panelOpen = typeof _lessonPanel !== 'undefined' && !!_lessonPanel;
    const tab = typeof currentLessonTab !== 'undefined' ? currentLessonTab : '';
    const md = mod && mod.id !== 'mainQuest' && !panelOpen && tab === 'basicLearn' ? String(storedTabMarkdown(mod, 'basicLearn') || '') : '';
    if (!md.trim()) {
        chip.className = 'hidden';
        chip.innerHTML = '';
        return;
    }
    const spoken = spokenChars(md);
    const target = basicLearnTargetMinutes(mod);
    const short = spoken < target * READ_CHARS_PER_MINUTE;
    chip.className = `${VOLUME_CHIP_CLASS} ${short ? VOLUME_CHIP_TONES.short : VOLUME_CHIP_TONES.done}`;
    chip.title = VOLUME_CHIP_TITLE;
    chip.innerHTML = `<span>낭독 약 ${Math.round(spoken / READ_CHARS_PER_MINUTE)}분 / 목표 ${target}분</span>${short ? volumeChipButton(mod) : ''}`;
};

// '분량 채우기'가 끝난 뒤 알릴 글. md: 반영할 글
function volumeSummaryText(volume, md) {
    const minutes = readAloudMinutes(md);
    if (spokenChars(md) >= volume.targetChars) return `기본학습을 낭독 약 ${minutes}분(목표 ${volume.targetMinutes}분)까지 채웠습니다.`;
    return [
        `기본학습은 낭독 약 ${minutes}분으로 목표 ${volume.targetMinutes}분에 못 미칩니다.`,
        volume.stopped ? '중지해서 받은 데까지만 붙였습니다.' : '',
        volume.error?.message || '',
        volume.reason === 'none' ? '고정 섹션과 실습·요약 섹션은 늘리지 않습니다.' : '',
        "다시 '분량 채우기'를 누르면 이어서 늘립니다."
    ].filter(Boolean).join(' ');
}

// 진행 막대 안에서 채운다. 끝나면 컨벤션 필수 지적을 고쳐 받고, 바뀐 섹션을 골라 반영한다(이전 글은 작업 기록에 남는다). 그림은 만들지 않는다
async function fillVolumeJob({ id, mod, subj, subjectId, before, snapshot }) {
    const tabId = 'basicLearn';
    const lockedBlocks = lockedSectionBlocks(mod, tabId);
    const isStopped = () => !!window.isTabGenerationStopped?.();
    const volume = await ensureSpokenVolume({
        ...snapshot, md: before, mod, tabId, lockedBlocks, targetMinutes: basicLearnTargetMinutes(mod), codeTopic: lessonCodeTopic(mod), fromUpload: !!mod.uploadedMdContent,
        isStopped, isLive: () => !subj || typeof lessonStillLive !== 'function' || lessonStillLive(subj, mod),
        onStatus: window.setPipelineStatus, waitSignal: window.aiStopSignal?.() || null
    });
    if (volume.gone) return window.showAlert('차시가 지워졌거나 불러온 내용으로 바뀌어 분량 채우기를 멈췄습니다.');
    const fixable = !volume.stopped && !(typeof aiErrorStopsRun === 'function' && aiErrorStopsRun(volume.error));
    const next = fixable
        ? await autoFixGeneratedTab({ tabId, md: volume.md, lockedBlocks, onStatus: window.setPipelineStatus, rounds: VOLUME_FIX_ROUNDS, minSpokenChars: volume.targetChars, isStopped })
        : volume.md;
    if (currentSubjectId !== subjectId || getEditingModule(id) !== mod) return window.showAlert('다른 교과로 옮겼거나 차시가 바뀌어 분량 채우기를 반영하지 않았습니다. 그 차시로 돌아가 다시 눌러 주세요.');
    if (next === before) return window.showAlert(volumeSummaryText(volume, next));
    window.setPipelineStatus('바뀐 섹션을 골라 반영해 주세요.');
    const approved = await previewAiChange(before, next, { title: '기본학습 분량 채우기 미리보기', tabId, note: volumeSummaryText(volume, next) });
    if (approved === null) return;
    if (!(await commitTabChange(mod, tabId, before, approved, `기본학습 분량 채우기(낭독 약 ${readAloudMinutes(approved)}분)`))) return;
    window.notifyLessonJobDone(volumeSummaryText(volume, approved), spokenChars(approved) >= volume.targetChars ? 'success' : 'warning');
}

// 탭 위 '분량 채우기': 지금 기본 학습에서 모자란 분량만 이어서 채운다. 시작 전에 호출 수·시간을 보이고 묻는다
window.fillLessonVolume = async function (id) {
    const mod = getEditingModule(id);
    if (!mod || mod.id === 'mainQuest') return;
    if (window.isLessonPipelineRunning?.()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    saveOpenEditsFor(mod, 'basicLearn');
    const current = String(storedTabMarkdown(mod, 'basicLearn') || '');
    if (!current.trim()) return window.showAlert('먼저 기본학습 탭을 생성해 주세요.');
    const message = `기본학습은 지금 낭독 약 ${readAloudMinutes(current)}분입니다. 목표 ${basicLearnTargetMinutes(mod)}분에 못 미친 섹션마다 새 소주제를 이어 붙입니다. 있던 글은 바꾸지 않고, 끝나면 바뀐 섹션을 골라 반영합니다.`;
    if (!(await confirmWithEstimate(message, { volume: 1 }, { title: '기본학습 분량 채우기', okLabel: '분량 채우기' }))) return;
    if (getEditingModule(id) !== mod) return;
    saveOpenEditsFor(mod, 'basicLearn'); // 묻는 동안 고친 글도 넣고 시작한다
    const subjectId = currentSubjectId;
    const job = { id, mod, subjectId, subj: globalState.subjects.find(item => item.id === subjectId), before: String(storedTabMarkdown(mod, 'basicLearn') || ''), snapshot: volumeSnapshot(mod) };
    await window.runLessonJob(mod.id, { label: '기본학습 분량 채우기', current: 'basicLearn', alerts: true }, () => fillVolumeJob(job));
};
