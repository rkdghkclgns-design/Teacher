// code-comments-tool.js - 교안 코드 블록에 주석을 더하는 연결: 생성·고치기 뒤 자동 보강, 이미 만든 교안의 '코드 주석 넣기'(이 차시·이 교과·과정 전체), 차시를 열 때 한 번 알림
// 주석을 세고 확인해 끼우는 일은 code-comments.js(codeCommentRun·codeCommentTargets·codeCommentPreview)가 하고, 이 파일은 AI 호출·고정 섹션·저장·작업 기록·화면을 잇는다.
// 교수안·슬라이드 편성안은 고치지 않는다: 교수안 화면과 슬라이드 화면(js/kbuilder parseDoc·parseDeck)이 코드 블록을 몰라 줄 맨 앞의 # 주석 줄을 제목으로 읽는다.
// 부를 때만 쓰는 앞 파일: api.js(callGemini·lessonTextParts·cleanupTargets·lessonStillLive·SAVE_AGAIN_HINT), tabs.js(setTabMarkdown·saveOpenEditsFor·aiStopSignal·refreshLessonNav),
//   lesson-review.js(storedTabMarkdown), lesson-editor-tools.js(lockedSectionBlocks·lockTitleKey), lesson-pipeline.js(runLessonJob·updateLessonJob·notifyLessonJobDone·setPipelineStatus),
//   state.js(archiveContent·archiveContents·saveState), course-meta.js(withHistoryNote), gyosuan.js(collectLessonSource·legacyLessonSource·hashSource),
//   course-qbank.js(serializeQuestion), lesson-lint.js(lessonLintQuestions·parseQuestionBlock), cost-estimate.js(confirmWithEstimate), course-ncs.js(textModelHasKey), data-safety.js(HISTORY_LIMIT)
// 생성·고치기 쪽(tabs.js·api.js·lesson-volume.js·merge.js·course-qbank.js·lesson-review.js·lesson-objectives.js)은 typeof로 이 파일을 보고 부른다(캐시에 옛 파일이 남아도 화면이 깨지지 않게).
// 테스트: tests/code-comments-flow.test.js, tests/code-comments-safety.test.js, tests/code-comments-notice.test.js

const COMMENT_TOOL_LABEL = '코드 주석 넣기';
const COMMENT_TOOL_REASON = '코드 주석 넣기 전'; // 작업 기록에 보일 까닭
const COMMENT_TOOL_MAX_TOKENS = 65536;
const COMMENT_TOOL_SCOPES = ['lesson', 'subject', 'course'];
// 문항에서 코드가 들 수 있는 칸. 주석을 넣고 다시 읽어 바뀐 칸만 바꾼다(목표·밴드·유형은 그대로)
const COMMENT_TOOL_QUESTION_FIELDS = ['stem', 'code', 'answer', 'explanation', 'tests', 'hint', 'rubric'];

/* ---------- AI 호출 ---------- */
// ask({ system, user }) → AI 답의 날 글. 키(머리글)·모델(역할 분배 'fast')·다시 보내기·걸린 시간 기록은 다른 글 호출과 같다(api.js callGemini).
// 답은 생각 글을 뺀 글 조각을 이어 붙인 그대로다(gyosuan.js askGyosuanModel과 같다). extractText를 거치면 표시줄 사이 코드가 바뀌어 확인이 모두 버린다.
// 출력 한도로 잘려도 던지지 않는다(잘린 블록은 확인이 걸러 한 번 더 받는다)
function codeCommentAsk({ signal = null, waitSignal = null, onRetry = null } = {}) {
    return async ({ system, user }) => {
        const data = await callGemini(TEXT_MODEL, {
            taskRole: 'fast',
            contents: [{ role: 'user', parts: [{ text: user }] }],
            systemInstruction: { parts: [{ text: system }] },
            generationConfig: { maxOutputTokens: COMMENT_TOOL_MAX_TOKENS },
            signal, waitSignal
        }, onRetry);
        const parts = data?.candidates?.[0]?.content?.parts || [];
        return parts.filter(part => !part.thought).map(part => part.text || '').join('');
    };
}

// 다시 보내기 전에 진행 문구로 알린다(tabs.js generateTabContent와 같은 글)
function commentRetryNotice(status) {
    return ({ delayMs, isRateLimit } = {}) => {
        const sec = Math.round((delayMs || 0) / 1000);
        status(isRateLimit ? `⏳ API 호출 한도에 도달했습니다. ${sec}초 후 자동으로 다시 시도합니다...` : `⏳ 일시적인 응답 지연이 발생했습니다. ${sec}초 후 자동으로 다시 시도합니다...`);
    };
}

// 신호로 끊긴 호출은 '중지했습니다.' 오류로 돌아온다(api.js abortError). 오류가 아니라 중지다
const isCommentStopError = text => !!text && text === (typeof abortError === 'function' ? abortError().message : '중지했습니다.');

// codeCommentRun 결과에 중지를 적는다: 중지를 눌렀거나 끊겨 돌아온 호출이면 stopped이고 그 오류 글은 지운다(멈춘 오류만 error에 남는다)
function commentRunResult(run, isStopped) {
    const stopError = isCommentStopError(run.error);
    return { ...run, stopped: !!run.stopped || stopError || !!isStopped?.(), error: stopError ? '' : run.error };
}

/* ---------- 고르기와 알림 ---------- */
// 문항 모드(정답·출력 결과·고칠 곳을 주석에 쓰지 않는다): 학습이해도·심화이해도 탭과 최종 평가
const isCodeCommentQuiz = (mod, tabId) => isQuestionBankTab(tabId) || mod?.id === 'mainQuest';

// 고정 섹션(lockedSectionBlocks)의 코드 블록을 빼는 skipBlock. 블록이 든 ## 제목을 고정 제목 키(lockTitleKey)로 견준다. 고정 섹션이 없으면 null
function lockedCommentSkip(lockedBlocks) {
    const keys = new Set((Array.isArray(lockedBlocks) ? lockedBlocks : []).map(block => lockTitleKey(block.title)));
    return keys.size ? block => !!block.section && keys.has(lockTitleKey(block.section)) : null;
}

// 미리보기 안내 글(run: codeCommentRun 결과). 있는 것만 잇는다
function commentRunNote(run) {
    if (!run) return '';
    const fixed = run.fixed?.length || 0;
    return [
        fixed ? `코드 블록 ${fixed}개에 주석을 넣었습니다.` : '',
        run.remaining ? `코드 블록 ${run.remaining}개는 주석을 다 넣지 못했습니다.` : '',
        run.held ? `고정 섹션의 코드 블록 ${run.held}개는 고치지 않았습니다.` : ''
    ].filter(Boolean).join(' ');
}

// 반영을 정한 뒤 끝 알림에 붙이는 주석 결과 { text, warn }(run: codeCommentRun 결과, 없으면 빈 글). 탭 생성·분량 채우기·탭 전체 AI 수정·병합이
// 저장하거나 반영한 다음에 쓴다(받기 전에 알리면 반영하지 않은 글의 주석도 넣었다고 알리게 된다). 중지로 보내지 못한 블록과 멈춘 오류도 적는다
function commentDoneNote(run) {
    if (!run) return { text: '', warn: false };
    if (run.error) return { text: `코드 주석을 넣다가 멈췄습니다. ${run.error}`, warn: true };
    const fixed = run.fixed?.length || 0;
    const parts = [
        fixed ? `코드 블록 ${fixed}개에 주석을 넣었습니다.` : '',
        run.remaining && run.stopped ? `중지해서 코드 블록 ${run.remaining}개에는 주석을 넣지 못했습니다. 도구의 '${COMMENT_TOOL_LABEL}'로 이어서 넣을 수 있습니다.` : '',
        run.remaining && !run.stopped ? `코드 블록 ${run.remaining}개는 주석을 다 넣지 못했습니다. 컨벤션 검수의 'AI 수정 제안'이나 도구의 '${COMMENT_TOOL_LABEL}'로 다시 넣을 수 있습니다.` : '',
        run.held && (fixed || run.remaining) ? `고정 섹션의 코드 블록 ${run.held}개는 고치지 않았습니다.` : ''
    ].filter(Boolean);
    return { text: parts.join(' '), warn: !!run.remaining };
}

// 끝 알림 글에 주석 결과를 잇는다. [글, 경고인가]
function withCommentNote(text, run) {
    const note = commentDoneNote(run);
    return [[text, note.text].filter(Boolean).join(' '), note.warn];
}

const commentTextCounts = texts => texts.reduce((counts, text) => counts.set(text, (counts.get(text) || 0) + 1), new Map());

// 미리보기에서 고른 글(applied: 반영한 글)에 맞춘 주석 결과(run: codeCommentRun 결과, base: 반영 전 글). 끝 알림(withCommentNote)에 넘긴다.
// 주석 단계가 넉넉히 넣은 블록(run.fixed, 넣은 뒤 글 run.md의 블록) 가운데 반영한 글에 그대로 들어갔고 반영 전 글에는 없던 블록만 넣은 블록으로 센다
// (같은 글의 블록이 여럿이면 늘어난 수만큼). 남은 블록과 고정 섹션의 블록은 반영한 글에서 다시 센다(반영하지 않은 섹션의 블록까지 넣었다고 알리지 않고, 남은 블록을 숨기지 않게)
function appliedCommentRun(run, { base = '', applied = '', lockedBlocks = [] } = {}) {
    if (!run || typeof codeCommentBlocks !== 'function' || typeof codeCommentPreview !== 'function') return run;
    const rawOf = block => block.raw.join('\n');
    const [inBase, inApplied] = [base, applied].map(md => commentTextCounts(codeCommentBlocks(String(md ?? '')).map(rawOf)));
    const spare = text => (inApplied.get(text) || 0) - (inBase.get(text) || 0);
    const fixed = new Set(run.fixed || []);
    const { kept } = codeCommentBlocks(String(run.md ?? '')).filter(block => fixed.has(block.index)).reduce(({ kept, used }, block) => {
        const text = rawOf(block);
        const taken = used.get(text) || 0;
        return taken < spare(text) ? { kept: [...kept, block.index], used: new Map(used).set(text, taken + 1) } : { kept, used };
    }, { kept: [], used: new Map() });
    const left = codeCommentPreview(String(applied ?? ''), { skipBlock: lockedCommentSkip(lockedBlocks) || (() => false) });
    return { ...run, fixed: kept, remaining: left.needs, held: left.held };
}

// 생성·고치기 뒤 알림(name: 탭 이름). 넣었으면 알리고, 남았거나 같은 오류로 멈췄으면 경고한다. 중지했거나 고칠 블록이 없으면 알리지 않는다
function notifyCodeComments(run, name) {
    if (!run || run.stopped) return;
    if (run.error) {
        window.showToast?.(`${name ? `${name}에 ` : ''}코드 주석을 넣다가 멈췄습니다. ${run.error}`, 'warning');
        return;
    }
    const head = name ? `${name} ` : '';
    const fixed = run.fixed.length;
    const parts = [
        fixed ? `${head}코드 블록 ${fixed}개에 주석을 넣었습니다.` : '',
        run.remaining ? `${fixed ? '' : head}코드 블록 ${run.remaining}개는 주석을 다 넣지 못했습니다. 컨벤션 검수의 'AI 수정 제안'이나 도구의 '${COMMENT_TOOL_LABEL}'로 다시 넣을 수 있습니다.` : '',
        run.held && (fixed || run.remaining) ? `고정 섹션의 코드 블록 ${run.held}개는 고치지 않았습니다.` : ''
    ].filter(Boolean);
    if (parts.length) window.showToast?.(parts.join(' '), run.remaining ? 'warning' : 'success');
}

/* ---------- 생성·고치기 뒤 자동 보강 ---------- */
// 받은 글(md)의 주석이 모자란 코드 블록에 주석만 더한 { md, run }. 고칠 블록이 없거나 모듈이 없으면 부르지 않고 { md, run: null, held }
// (held: 주석이 모자라지만 모두 고정 섹션에 있어 보내지 않은 블록 수). 고정 섹션의 블록은 보내지 않는다(run.held).
// 어떤 오류에도 받은 글을 돌려준다(코드 줄이 그대로인지는 모듈이 확인한다).
// quiz: 문항 모드 · label: 진행 문구와 알림의 이름(없으면 탭 이름) · signal: 중지하면 받던 호출도 끊는다 · waitSignal: 중지하면 다시 보내려고 기다리는 것만 끊는다
async function addGeneratedCodeComments({ md, tabId = '', quiz = false, lockedBlocks = [], label = '', onStatus = null, onRetry = null, isStopped = () => false, signal = null, waitSignal = null, notify = true } = {}) {
    const source = String(md ?? '');
    if (typeof codeCommentRun !== 'function' || typeof codeCommentTargets !== 'function') return { md: source, run: null, held: 0 };
    try {
        const skipBlock = lockedCommentSkip(lockedBlocks);
        if (!codeCommentTargets(source, { skipBlock }).length) return { md: source, run: null, held: skipBlock ? codeCommentTargets(source).length : 0 };
        const name = label || LESSON_TABS.find(tab => tab.id === tabId)?.label || '';
        const status = text => onStatus?.(name ? `${name} · ${text}` : text);
        const stopped = () => !!isStopped?.();
        const run = commentRunResult(await codeCommentRun({
            md: source, quiz: !!quiz, isStopped: stopped, onStatus: status, skipBlock,
            ask: codeCommentAsk({ signal, waitSignal, onRetry: onRetry || commentRetryNotice(status) })
        }), stopped);
        if (notify) notifyCodeComments(run, name);
        return { md: run.md, run };
    } catch (err) {
        console.warn('[코드 주석] 주석을 넣지 못해 받은 글을 그대로 둡니다:', err);
        return { md: source, run: null, held: 0 };
    }
}

// 예고에 쓰는 주석 호출 수 어림(lesson-volume.js 분량 채우기): 지금 글의 주석이 모자란 블록(고정 섹션 빼고)을 보내는 호출 수에,
// 새로 생길 블록(extraBlocks)을 한 번에 보내는 블록 수로 나눈 몫을 더한다. 다시 받기는 세지 않는다. 모듈이 없으면 0
function commentCallEstimate(md, { lockedBlocks = [], extraBlocks = 0 } = {}) {
    if (typeof codeCommentPreview !== 'function') return 0;
    const { calls } = codeCommentPreview(String(md ?? ''), { skipBlock: lockedCommentSkip(lockedBlocks) || (() => false) });
    return calls + Math.ceil(Math.max(0, Number(extraBlocks) || 0) / CODE_COMMENT_BATCH_BLOCKS);
}

// 문제은행 문항(course-qbank.js generateQuestions) 속 코드에 주석을 넣는다(문항 모드, 신호 없음). 문항을 이어 쓴 글에 고칠 블록이 있을 때만 부르고,
// 다시 읽은 문항 수가 같으면 코드가 들 수 있는 칸 가운데 바뀐 칸만 바꾼 새 문항을 돌려준다. 실패하면 받은 문항 그대로다
async function commentQuestionCode(questions) {
    const list = Array.isArray(questions) ? questions : [];
    if (!list.length || typeof codeCommentRun !== 'function' || typeof serializeQuestion !== 'function') return list;
    try {
        const md = list.map((question, i) => serializeQuestion(question, i + 1)).join('\n\n');
        if (!codeCommentTargets(md).length) return list;
        const run = await codeCommentRun({ md, quiz: true, ask: codeCommentAsk() });
        if (run.md === md) return list;
        const readBack = text => lessonLintQuestions(text).map(parseQuestionBlock);
        const [before, after] = [readBack(md), readBack(run.md)];
        if (before.length !== list.length || after.length !== list.length) return list;
        return list.map((question, i) => {
            const changed = COMMENT_TOOL_QUESTION_FIELDS.filter(key => after[i][key] !== before[i][key]);
            return changed.length ? { ...question, ...Object.fromEntries(changed.map(key => [key, after[i][key]])) } : question;
        });
    } catch (err) {
        console.warn('[문제은행] 문항 코드에 주석을 넣지 못해 문항을 그대로 둡니다:', err);
        return list;
    }
}

// 문항(문제은행 창·전체 생성이 만든 문항) 속 코드 블록 가운데 주석이 모자란 블록 수. 코드를 바꾼 답·서버 오류·하루 한도로 주석을 넣지 못한 블록이 남는다
function questionCommentGaps(questions) {
    const list = Array.isArray(questions) ? questions : [];
    if (!list.length || typeof codeCommentTargets !== 'function' || typeof serializeQuestion !== 'function') return 0;
    return codeCommentTargets(list.map((question, i) => serializeQuestion(question, i + 1)).join('\n\n')).length;
}

// 문항을 넣은 뒤 상태 글·알림에 붙일 글(주석을 다 넣었으면 '')
function questionCommentNote(questions) {
    const gaps = typeof questions === 'number' ? questions : questionCommentGaps(questions);
    return gaps ? `문항 코드 블록 ${gaps}개에는 주석을 다 넣지 못했습니다. 문제은행 탭의 'AI 수정 제안'이나 도구의 '${COMMENT_TOOL_LABEL}'로 다시 넣을 수 있습니다.` : '';
}

/* ---------- 이미 만든 교안: 고칠 칸과 예고 ---------- */
// 차시에서 주석을 넣을 칸: 글이 있는 탭(탭이 없는 최종 평가·옛 차시는 본문 하나). { id, label, quiz, lockedBlocks }
// 교수안·슬라이드 편성안은 넣지 않는다. 교수안 화면(KBuilder parseDoc)은 코드 블록을 몰라 줄 맨 앞의 # 주석 줄을 제목으로 읽어 버리고,
// 슬라이드 화면(parseDeck)은 ## 주석 줄에서 슬라이드를 끊는다. 바꾸면 슬라이드 화면 편집본과도 어긋난다
function lessonCommentParts(mod) {
    if (!mod) return [];
    return lessonTextParts(mod).map(part => ({
        id: part.id, quiz: isCodeCommentQuiz(mod, part.id), lockedBlocks: lockedSectionBlocks(mod, part.id),
        label: mod.id !== 'mainQuest' ? part.label : part.label === '본문' ? '최종 평가' : `최종 평가 · ${part.label}`
    }));
}

const commentPartText = (mod, part) => String(storedTabMarkdown(mod, part.id) || '');

// 범위의 차시: lesson(지금 차시) · subject(지금 교과의 차시와 최종 평가) · course(모든 교과의 차시와 최종 평가). [{ subj, mod }]
function commentTargets(scope) {
    const subj = globalState.subjects.find(item => item.id === currentSubjectId);
    if (scope === 'course') return globalState.subjects.flatMap(subject => cleanupTargets(subject).map(mod => ({ subj: subject, mod })));
    if (!subj) return [];
    if (scope === 'subject') return cleanupTargets(subj).map(mod => ({ subj, mod }));
    const mod = getEditingModule();
    return mod ? [{ subj, mod }] : [];
}

// 예고: 칸마다 codeCommentPreview(고정 섹션의 블록은 뺀다)를 더한다.
// { plans: [{ subj, mod, parts }], lessons·finals(고칠 차시 수·최종 평가 수), tabs(고칠 칸 수), needs(블록 수), calls(호출 수, 다시 받기 빼고), held, quiz }
function commentPlan(targets) {
    const plans = targets.map(({ subj, mod }) => ({
        subj, mod,
        parts: lessonCommentParts(mod).map(part => {
            const preview = codeCommentPreview(commentPartText(mod, part), { skipBlock: lockedCommentSkip(part.lockedBlocks) || (() => false) });
            return { ...part, needs: preview.needs, calls: preview.calls, held: preview.held };
        })
    }));
    const parts = plans.flatMap(plan => plan.parts);
    const sum = key => parts.reduce((total, part) => total + part[key], 0);
    const fixing = plans.filter(plan => plan.parts.some(part => part.needs));
    return {
        plans,
        lessons: fixing.filter(plan => plan.mod.id !== 'mainQuest').length,
        finals: fixing.filter(plan => plan.mod.id === 'mainQuest').length,
        tabs: parts.filter(part => part.needs).length,
        needs: sum('needs'), calls: sum('calls'), held: sum('held'),
        quiz: parts.some(part => part.quiz && part.needs)
    };
}

// 주석이 들어간 블록 수(블록마다 원래 줄과 견준다. 블록 수와 차례는 모듈의 확인이 지킨다)
function commentedBlockCount(before, after) {
    const [a, b] = [codeCommentBlocks(before), codeCommentBlocks(after)];
    return a.filter((block, k) => b[k] && b[k].raw.join('\n') !== block.raw.join('\n')).length;
}

/* ---------- 교수안 원고 표시 ---------- */
// 두 글이 코드 블록에 더한 주석만 다른가: 블록 밖 글과 블록 수가 같고(ccKeepsCode), 바뀐 블록은 원래 줄에 허용된 주석만 더했다(codeCommentVerify)
function onlyCodeCommentsAdded(before, after) {
    if (before === after) return true;
    if (typeof ccKeepsCode !== 'function' || !ccKeepsCode(before, after)) return false;
    const [a, b] = [codeCommentBlocks(before), codeCommentBlocks(after)];
    return a.every((block, k) => block.raw.join('\n') === b[k].raw.join('\n') || (!block.skip && codeCommentVerify(block, b[k].lines).ok));
}

// 탭 글을 바꾸기 직전에 부른다: 교수안이 지금 교안 원고로 만든 것(sourceKey가 원고 해시와 같다)인 갈래와 그 원고를 읽는 법을 고른다.
// 기본학습 갈래는 예전 방식(네 탭을 함께 담은 원고, gyosuan.js legacyLessonSource)으로 만든 교수안도 고른다
function gyosuanKeyedTracks(mod) {
    if (!mod || typeof collectLessonSource !== 'function' || typeof hashSource !== 'function') return [];
    return LESSON_TRACKS.flatMap(track => {
        const key = mod[track.field]?.sourceKey;
        if (!key) return [];
        const legacy = track.id === LESSON_TRACKS[0].id && typeof legacyLessonSource === 'function' ? [legacyLessonSource] : [];
        const read = [item => collectLessonSource(item, track.id), ...legacy].find(reader => hashSource(reader(mod)) === key);
        return read ? [{ track, read, parts: read(mod) }] : [];
    });
}

// 탭 글을 바꾼 뒤에 부른다: 고른 갈래의 원고가 코드 블록 주석만 달라졌으면 sourceKey를 새 원고 해시로 맞춘다.
// 교수안은 원고에서 코드 블록을 지우고 만들므로(gyosuan.js cleanGyosuanSource) 주석만 더한 교안으로 다시 만들 까닭이 없다
// ('교안이 바뀌었습니다. 교수안을 다시 생성하면 반영됩니다' 안내를 띄우지 않는다). 다른 글도 바뀌었으면 그대로 두어 다시 만들라고 알린다
function rekeyCommentedGyosuan(mod, keyed) {
    (Array.isArray(keyed) ? keyed : []).forEach(({ track, read, parts }) => {
        const next = read(mod);
        const same = next.length === parts.length
            && next.every((part, k) => part.practice === parts[k].practice && onlyCodeCommentsAdded(String(parts[k].text ?? ''), String(part.text ?? '')));
        if (same && mod[track.field]) mod[track.field] = { ...mod[track.field], sourceKey: hashSource(next) };
    });
}

/* ---------- 이미 만든 교안: 차시 하나 ---------- */
// 받은 칸 가운데 지금도 받기 전 글 그대로인 칸. 열어 둔 원문 칸의 글을 먼저 넣고 본다(tabs.js).
// 그사이 원문 칸·AI 수정 제안·문제은행 창 등에서 고친 칸은 뺀다(옛 글에 주석만 단 글로 덮지 않게)
function untouchedTaken(mod, taken) {
    taken.forEach(item => saveOpenEditsFor(mod, item.part.id));
    return taken.filter(item => commentPartText(mod, item.part) === item.before);
}

// 쓰기 전 글을 작업 기록에 남긴다. 탭이 있는 차시는 차시 전체 한 칸(되돌리면 모든 탭이 함께 돌아온다).
// 탭이 없는 칸(최종 평가·옛 차시의 본문)과 최종 평가의 탭은 그 칸의 탭 하나 기록으로 남긴다. 차시 전체 기록은 최종 평가와 탭 구분이 없는 차시를
// 제자리에서 찾지 못해(data-safety.js historyRestoreTarget) 지금 연 교과에 새 차시로 되살린다. 탭 하나 기록은 그 교과의 그 칸으로 돌아간다
function archiveBeforeComments(mod, items) {
    if (mod.tabContents && mod.id !== 'mainQuest') return archiveContent(mod, COMMENT_TOOL_REASON);
    const title = item => (mod.tabContents ? `${mod.title} · ${LESSON_TABS.find(tab => tab.id === item.part.id)?.label || item.part.label}` : mod.title);
    return archiveContents(items.map(item => ({ title: title(item), content: item.before, images: mod.images, tabId: item.part.id, lesson: mod })), COMMENT_TOOL_REASON);
}

// 받은 글(taken: [{ part, before, md, remaining, blocks }])을 차시에 쓴다. 쓰기 직전에 그사이 고친 칸을 다시 보고 쓰지 않으며 센다(totals.meanwhile).
// 쓸 칸이 있으면 바꾸기 전 글을 작업 기록('코드 주석 넣기 전', archiveBeforeComments)에 남긴 뒤 쓰고, 주석만 더해 어긋난 교수안 원고 표시를 맞춘다.
// 저장하지 못하면 false
async function writeCommentedLesson(subj, mod, taken, totals) {
    const fresh = untouchedTaken(mod, taken);
    if (fresh.length) await archiveBeforeComments(mod, fresh);
    const write = fresh.length ? untouchedTaken(mod, fresh) : []; // 기록을 남기는 동안 고친 칸도 쓰지 않는다
    totals.meanwhile += taken.length - write.length;
    if (!write.length) return true;
    const keyed = gyosuanKeyedTracks(mod);
    write.forEach(item => setTabMarkdown(mod, item.part.id, item.md));
    rekeyCommentedGyosuan(mod, keyed);
    const blocks = write.reduce((sum, item) => sum + item.blocks, 0);
    if (write.some(item => Object.keys(mod.manualReview?.[item.part.id] || {}).length)) totals.manual += 1; // 글 해시가 바뀌어 수동 검수 표시가 '다시 확인'이 된다
    Object.assign(mod, withHistoryNote(mod, `${COMMENT_TOOL_LABEL} (코드 블록 ${blocks}개)`));
    totals.lessons += 1;
    if (mod.id === 'mainQuest') totals.finals += 1;
    totals.fixed += blocks;
    totals.remaining += write.reduce((sum, item) => sum + item.remaining, 0);
    const saved = (await saveState()) !== false; // 브라우저에 저장하지 못하면 false(알림은 saveState가 띄운다)
    if (currentSubjectId === subj.id && getEditingModule() === mod) renderEditor(mod);
    else window.refreshLessonNav?.(mod);
    return saved;
}

// 차시 하나: 칸마다 주석을 넣고, 받은 칸은 차시 끝에 한꺼번에 쓴다(writeCommentedLesson이 쓰기 직전에 그사이 고친 칸을 다시 본다).
// 그사이 지운 차시는 'deleted'(부른 쪽이 세고 다음 차시로 간다), 교과째 없어졌으면 'gone', 저장하지 못하면 'save',
// 같은 오류(하루 한도·키 문제)면 그 안내 글을 돌려준다(부른 쪽이 멈춘다). onPart(part, k): 칸을 시작할 때(이 차시 범위의 진행 막대)
async function commentLesson({ subj, mod, parts }, run, totals, { onPart = null } = {}) {
    const lost = () => (globalState.subjects.includes(subj) ? 'deleted' : 'gone');
    if (!lessonStillLive(subj, mod)) return lost();
    const stopped = () => !!run.stopped || !!window.isTabGenerationStopped?.();
    const todo = parts.filter(part => part.needs);
    const taken = [];
    let halt = '';
    for (let k = 0; k < todo.length && !halt && !stopped(); k++) {
        const part = todo[k];
        onPart?.(part, k);
        saveOpenEditsFor(mod, part.id); // 원문 칸에서 고치던 글을 먼저 넣는다(tabs.js)
        const before = commentPartText(mod, part);
        const status = text => window.setPipelineStatus?.(`${part.label} · ${text}`);
        const result = commentRunResult(await codeCommentRun({
            md: before, quiz: part.quiz, isStopped: stopped, onStatus: status, skipBlock: lockedCommentSkip(lockedSectionBlocks(mod, part.id)),
            ask: codeCommentAsk({ signal: window.aiStopSignal?.() || null, onRetry: commentRetryNotice(status) })
        }), stopped);
        if (!lessonStillLive(subj, mod)) return lost(); // 기다리는 동안 지운 차시에는 쓰지 않는다
        if (result.md !== before) taken.push({ part, before, md: result.md, remaining: result.remaining, blocks: commentedBlockCount(before, result.md) });
        else totals.remaining += result.remaining;
        if (result.error) halt = result.error; // 같은 오류: 받은 데까지 쓰고 멈춘다
    }
    if (!taken.length) return halt;
    return (await writeCommentedLesson(subj, mod, taken, totals)) ? halt : 'save';
}

/* ---------- 이미 만든 교안: 시작과 끝 ---------- */
// 다른 생성이 돌고 있다(진행 막대의 작업·교수안·로딩 화면, course-flow.js generationBusy)
const commentBusy = () => !!window.isLessonPipelineRunning?.() || (typeof generationBusy === 'function' && generationBusy());

// 차시 수 글: 최종 평가는 차시로 세지 않고 따로 붙인다. 교과 범위에는 최종 평가가 하나라 수를 적지 않는다. 예: '차시 1개와 최종 평가'
function commentCountText(scope, lessons, finals) {
    return [lessons ? `차시 ${lessons}개` : '', finals ? (scope === 'course' ? `최종 평가 ${finals}개` : '최종 평가') : ''].filter(Boolean).join('와 ');
}

// 확인 창 글. 해당할 때만 붙이는 문장은 세 범위가 같다
function commentConfirmText(scope, plan, subj) {
    const extras = [
        plan.quiz ? '학습이해도·심화이해도·최종 평가 문항의 코드에는 정답·출력 결과·고칠 곳을 알려 주지 않는 주석만 넣습니다.' : '',
        plan.held ? `고정 섹션의 코드 블록 ${plan.held}개는 고치지 않습니다.` : ''
    ].filter(Boolean);
    if (scope === 'lesson') {
        const where = plan.plans[0]?.mod.id === 'mainQuest' ? '이 최종 평가에서' : `이 차시의 탭 ${plan.tabs}개에서`;
        return [`${where} 주석이 모자란 코드 블록 ${plan.needs}개에 AI가 주석만 더합니다. 코드 줄은 한 글자도 바꾸지 않고(코드가 바뀐 답은 버립니다), 바꾸기 전 글은 작업 기록에 '${COMMENT_TOOL_REASON}'으로 남깁니다. 주석이 덜 붙은 블록은 한 번 더 받아 호출이 최대 ${plan.calls * 2}회까지 늘 수 있습니다. 오른쪽 아래 막대에서 언제든 멈출 수 있습니다.`, ...extras].join(' ');
    }
    const lessons = plan.plans.filter(item => item.mod.id !== 'mainQuest').length;
    const finals = plan.plans.filter(item => item.mod.id === 'mainQuest' && lessonTextParts(item.mod).length).length;
    const where = scope === 'course'
        ? `과정 전체 교과 ${globalState.subjects.length}개의 차시 ${lessons}개${finals ? `와 최종 평가 ${finals}개` : ''}에서`
        : `${subj?.title ? `'${subj.title}'의` : '이 교과의'} 차시 ${lessons}개${finals ? '와 최종 평가' : ''}에서`;
    const limit = typeof HISTORY_LIMIT !== 'undefined' ? HISTORY_LIMIT : 200;
    return [`${where} 주석이 모자란 코드 블록 ${plan.needs}개(고칠 ${commentCountText(scope, plan.lessons, plan.finals)})에 AI가 주석만 더합니다. 코드 줄은 한 글자도 바꾸지 않고, 바꾸는 차시마다 바꾸기 전 글을 작업 기록에 '${COMMENT_TOOL_REASON}'으로 한 칸씩 남깁니다(작업 기록은 ${limit}개까지 두어 오래된 기록이 밀릴 수 있습니다). 오른쪽 아래 막대에서 언제든 멈출 수 있고, 멈추면 받은 데까지 저장합니다.`, ...extras].join(' ');
}

// 끝 알림 [글, 종류]. halt: 'gone' · 'save' · 같은 오류 안내 글 · ''. 기록을 남긴 차시만 셌으므로(totals.lessons) '작업 기록에 남겼습니다'는 쓴 차시가 있을 때만 쓴다
function commentDoneText(scope, totals, halt, stopped) {
    if (halt === 'gone') return [`${COMMENT_TOOL_LABEL}를 멈췄습니다. 그사이 ${scope === 'course' ? '교과를' : '이 교과를'} 지우거나 백업·PC 폴더를 불러와 내용이 바뀌었습니다.`, 'warning'];
    if (halt === 'save') return [`저장하지 못해 ${COMMENT_TOOL_LABEL}를 멈췄습니다. 마지막에 고친 차시는 아직 저장되지 않았습니다. ${typeof SAVE_AGAIN_HINT !== 'undefined' ? SAVE_AGAIN_HINT : ''}`.trim(), 'error'];
    if (halt) return [`${COMMENT_TOOL_LABEL}를 멈췄습니다. ${halt} 넣은 데까지는 저장했습니다.`, 'warning'];
    if (stopped) return [`${COMMENT_TOOL_LABEL}를 멈췄습니다. 받은 데까지 넣고 저장했습니다(코드 블록 ${totals.fixed}개). 다시 누르면 남은 블록부터 이어서 합니다.`, 'warning'];
    const deleted = !totals.deleted ? '' : scope === 'lesson' ? '그사이 이 차시를 지워 주석을 넣지 않았습니다.' : `그사이 지운 차시 ${totals.deleted}개에는 주석을 넣지 않았습니다.`;
    const meanwhile = totals.meanwhile ? `넣는 동안 고친 탭 ${totals.meanwhile}개는 바꾸지 않았습니다.` : '';
    if (!totals.lessons && (deleted || meanwhile)) return [[deleted, meanwhile && `${meanwhile} 다시 누르면 그 탭에 주석을 넣습니다.`].filter(Boolean).join(' '), 'warning'];
    if (!totals.lessons) return ['주석을 넣은 코드 블록이 없습니다. AI 답이 코드를 바꿔 모두 버렸거나 답을 받지 못했습니다. 잠시 뒤 다시 눌러 보세요.', 'warning'];
    const notes = [
        totals.remaining ? `코드 블록 ${totals.remaining}개는 주석을 다 넣지 못했습니다. 다시 누르면 남은 블록만 다시 합니다.` : '',
        totals.held ? `고정 섹션의 코드 블록 ${totals.held}개는 고치지 않았습니다.` : '',
        meanwhile, deleted,
        totals.manual ? '바뀐 탭의 수동 검수 표시는 다시 확인으로 바뀝니다.' : ''
    ].filter(Boolean);
    const lessons = scope === 'lesson' ? '' : `(${commentCountText(scope, totals.lessons - totals.finals, totals.finals)})`;
    const head = `${COMMENT_TOOL_LABEL}를 마쳤습니다. 코드 블록 ${totals.fixed}개에 주석을 넣었습니다${lessons}. 바꾸기 전 글은 작업 기록에 '${COMMENT_TOOL_REASON}'으로 남겼습니다.`;
    return [[head, ...notes].join(' '), notes.length ? 'warning' : 'success'];
}

// 도구의 '코드 주석 넣기'(lesson)와 교과 일괄 작업의 '코드 주석 넣기'(subject)·'과정 코드 주석 넣기'(course).
// 확인 창(블록 수·호출 수·시간) → 진행 막대·중지 → 차시마다 작업 기록 한 칸·저장·다시 그리기(교수안 원고 표시도 맞춘다) → 끝 알림. 미리보기는 두지 않는다(코드 줄은 모듈의 확인이 지킨다)
window.startCodeComments = async function (scope = 'lesson') {
    const kind = COMMENT_TOOL_SCOPES.includes(scope) ? scope : 'lesson';
    if (commentBusy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    if (typeof textModelHasKey === 'function' && !textModelHasKey()) return window.showAlert('글 모델 키가 없어 코드 주석을 넣을 수 없습니다. 오른쪽 위 ⚙ 설정에서 키를 넣어 주세요.');
    const subj = globalState.subjects.find(item => item.id === currentSubjectId) || null;
    if (kind !== 'course' && !subj) return window.showAlert('교과를 먼저 선택하세요.');
    window.saveRawContent?.(); // 원문 칸에서 고치던 글을 넣고 센다(api.js)
    const plan = commentPlan(commentTargets(kind));
    if (!plan.needs) return window.showToast?.(plan.held ? '주석이 모자란 코드 블록은 고정 섹션에만 있어 고치지 않습니다.' : '주석이 모자란 코드 블록이 없습니다.', plan.held ? 'info' : 'success');
    if (!(await confirmWithEstimate(commentConfirmText(kind, plan, subj), { codeComments: plan.calls }, { title: COMMENT_TOOL_LABEL, okLabel: '주석 넣기' }))) return;
    if (kind !== 'course' && globalState.subjects.find(item => item.id === currentSubjectId) !== subj) return window.showToast?.('묻는 동안 교과가 바뀌어 코드 주석을 넣지 않았습니다.', 'warning');
    const rows = plan.plans.filter(row => row.parts.some(part => part.needs));
    const single = kind === 'lesson';
    const totals = { lessons: 0, finals: 0, fixed: 0, remaining: 0, meanwhile: 0, manual: 0, deleted: 0, held: plan.held };
    const total = single ? rows[0].parts.filter(part => part.needs).length : rows.length;
    let halt = '';
    const outcome = await window.runLessonJob(currentEditingModuleId ?? rows[0].mod.id, { label: COMMENT_TOOL_LABEL, total }, async run => {
        try {
            // 이 차시 범위는 탭마다, 교과·과정 범위는 차시마다 막대를 넘긴다
            const onPart = single ? (part, k) => window.updateLessonJob({ label: `${COMMENT_TOOL_LABEL} · ${part.label}`, done: k, current: part.id }) : null;
            for (let i = 0; i < rows.length && !halt && !run.stopped; i++) {
                if (!single) window.updateLessonJob({ label: `${COMMENT_TOOL_LABEL} · ${rows[i].mod.title || '차시'}`, done: i });
                const result = await commentLesson(rows[i], run, totals, { onPart });
                if (result === 'deleted') totals.deleted += 1; // 그사이 지운 차시: 세고 다음 차시로 간다
                else halt = result;
            }
            return { ok: true, stopped: !!run.stopped };
        } catch (err) {
            console.error('[코드 주석 넣기]', err);
            window.showAlert(`코드 주석을 넣다가 오류가 나 멈췄습니다. 앞의 차시까지 넣은 주석은 저장했습니다.\n${err.message || err}`);
            return { ok: false };
        }
    });
    if (!outcome?.ok) return; // 다른 생성이 돌고 있었거나(busy) 오류를 이미 알렸다
    const [text, tone] = commentDoneText(kind, totals, halt, outcome.stopped || !!window.isTabGenerationStopped?.());
    window.notifyLessonJobDone(text, tone);
};

/* ---------- 차시를 열 때 한 번 알림 ---------- */
const _commentGapsSeen = new Set(); // 이번 세션에 본 차시('교과 id:차시 id')

// 주석이 모자란 코드 블록이 있는 차시를 처음 열 때 한 번 알린다(lesson-review.js syncReviewBadge가 부른다). 생성 중에는 세지 않는다(끝난 뒤 다시 본다).
// 도구가 고치는 탭만 센다(고정 섹션의 블록과 교수안·편성안은 세지 않는다). 최종 평가는 '이 최종 평가'라고 한다
window.noteCodeCommentGaps = function (mod = getEditingModule()) {
    if (!mod || typeof codeCommentTargets !== 'function' || commentBusy()) return;
    const key = `${currentSubjectId}:${mod.id}`;
    if (_commentGapsSeen.has(key)) return;
    _commentGapsSeen.add(key);
    const count = lessonCommentParts(mod)
        .reduce((sum, part) => sum + codeCommentTargets(commentPartText(mod, part), { skipBlock: lockedCommentSkip(part.lockedBlocks) }).length, 0);
    const where = mod.id === 'mainQuest' ? '이 최종 평가' : '이 차시';
    if (count) window.showToast?.(`${where}에 주석이 모자란 코드 블록이 ${count}개 있습니다. 도구의 '${COMMENT_TOOL_LABEL}'를 누르면 코드는 그대로 두고 주석만 더합니다.`, 'warning');
};
