// code-comments-tool.js - 교안 코드 블록에 주석을 더하는 연결: 생성·고치기 뒤 자동 보강, 이미 만든 교안의 '코드 주석 넣기'(이 차시·이 교과·과정 전체), 차시를 열 때 한 번 알림
// 주석을 세고 확인해 끼우는 일은 code-comments.js(codeCommentRun·codeCommentTargets·codeCommentPreview)가 하고, 이 파일은 AI 호출·고정 섹션·저장·작업 기록·화면을 잇는다.
// 부를 때만 쓰는 앞 파일: api.js(callGemini·lessonTextParts·cleanupTargets·lessonStillLive·SAVE_AGAIN_HINT), tabs.js(setTabMarkdown·saveOpenEditsFor·aiStopSignal·refreshLessonNav),
//   lesson-review.js(storedTabMarkdown), lesson-editor-tools.js(lockedSectionBlocks·lockTitleKey), lesson-pipeline.js(runLessonJob·updateLessonJob·notifyLessonJobDone·setPipelineStatus),
//   state.js(archiveContent·saveState), course-meta.js(withHistoryNote), gyosuan.js(freshDeckState), gyosuan-view.js(announceGyosuanChange·saveGyosuanRaw),
//   course-qbank.js(serializeQuestion), lesson-lint.js(lessonLintQuestions·parseQuestionBlock), cost-estimate.js(confirmWithEstimate), course-ncs.js(textModelHasKey), data-safety.js(HISTORY_LIMIT)
// 생성·고치기 쪽(tabs.js·api.js·lesson-volume.js·merge.js·course-qbank.js·lesson-review.js)은 typeof로 이 파일을 보고 부른다(캐시에 옛 파일이 남아도 화면이 깨지지 않게).
// 테스트: tests/code-comments-flow.test.js

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

/* ---------- 이미 만든 교안: 고칠 칸과 예고 ---------- */
// 슬라이드 화면에서 고친 편성안(화면 편집본·차시별 덱·고친 표시). 바꾸면 화면 편집본과 어긋나므로 고치지 않는다
const deckHasScreenEdits = gyosuan => !!gyosuan.deckHtml || Object.keys(gyosuan.sessionDecks || {}).length > 0 || !!gyosuan.deckDirty;

// 차시에서 주석을 넣을 칸: 글이 있는 탭(탭이 없는 최종 평가·옛 차시는 본문 하나), 두 갈래의 교수안(docMd)과 슬라이드 편성안(deckMd).
// { kind: 'tab'|'doc'|'deck', id, label, quiz, lockedBlocks, field·key(교수안 칸), studio(화면에서 고친 편성안) }
function lessonCommentParts(mod) {
    if (!mod) return [];
    const tabs = lessonTextParts(mod).map(part => ({
        kind: 'tab', id: part.id, quiz: isCodeCommentQuiz(mod, part.id), lockedBlocks: lockedSectionBlocks(mod, part.id),
        label: mod.id !== 'mainQuest' ? part.label : part.label === '본문' ? '최종 평가' : `최종 평가 · ${part.label}`
    }));
    const docs = LESSON_TRACKS.flatMap(track => {
        const gyosuan = mod[track.field];
        if (!gyosuan || typeof gyosuan !== 'object') return [];
        const has = key => typeof gyosuan[key] === 'string' && !!gyosuan[key].trim();
        return [
            ...(has('docMd') ? [{ kind: 'doc', id: `${track.field}.docMd`, field: track.field, key: 'docMd', label: `${track.label} 교수안`, quiz: false, lockedBlocks: [] }] : []),
            ...(has('deckMd') ? [{ kind: 'deck', id: `${track.field}.deckMd`, field: track.field, key: 'deckMd', label: `${track.label} 슬라이드 편성안`, quiz: false, lockedBlocks: [], studio: deckHasScreenEdits(gyosuan) }] : [])
        ];
    });
    return [...tabs, ...docs];
}

const commentPartText = (mod, part) => (part.kind === 'tab' ? String(storedTabMarkdown(mod, part.id) || '') : String(mod[part.field]?.[part.key] || ''));

// 범위의 차시: lesson(지금 차시) · subject(지금 교과의 차시와 최종 평가) · course(모든 교과의 차시와 최종 평가). [{ subj, mod }]
function commentTargets(scope) {
    const subj = globalState.subjects.find(item => item.id === currentSubjectId);
    if (scope === 'course') return globalState.subjects.flatMap(subject => cleanupTargets(subject).map(mod => ({ subj: subject, mod })));
    if (!subj) return [];
    if (scope === 'subject') return cleanupTargets(subj).map(mod => ({ subj, mod }));
    const mod = getEditingModule();
    return mod ? [{ subj, mod }] : [];
}

// 예고: 칸마다 codeCommentPreview(고정 섹션의 블록은 뺀다)를 더한다. 슬라이드 화면에서 고친 편성안은 고치지 않아 studioDecks로만 센다.
// { plans: [{ subj, mod, parts }], lessons(고칠 차시 수), tabs·docs(고칠 탭·교수안 칸 수), needs(블록 수), calls(호출 수, 다시 받기 빼고), held, studioDecks, quiz }
function commentPlan(targets) {
    const plans = targets.map(({ subj, mod }) => ({
        subj, mod,
        parts: lessonCommentParts(mod).map(part => {
            const preview = codeCommentPreview(commentPartText(mod, part), { skipBlock: lockedCommentSkip(part.lockedBlocks) || (() => false) });
            return part.studio
                ? { ...part, needs: 0, calls: 0, held: 0, screen: preview.needs }
                : { ...part, needs: preview.needs, calls: preview.calls, held: preview.held, screen: 0 };
        })
    }));
    const parts = plans.flatMap(plan => plan.parts);
    const sum = key => parts.reduce((total, part) => total + part[key], 0);
    return {
        plans,
        lessons: plans.filter(plan => plan.parts.some(part => part.needs)).length,
        tabs: parts.filter(part => part.kind === 'tab' && part.needs).length,
        docs: parts.filter(part => part.kind !== 'tab' && part.needs).length,
        needs: sum('needs'), calls: sum('calls'), held: sum('held'),
        studioDecks: parts.filter(part => part.screen).length,
        quiz: parts.some(part => part.quiz && part.needs)
    };
}

// 주석이 들어간 블록 수(블록마다 원래 줄과 견준다. 블록 수와 차례는 모듈의 확인이 지킨다)
function commentedBlockCount(before, after) {
    const [a, b] = [codeCommentBlocks(before), codeCommentBlocks(after)];
    return a.filter((block, k) => b[k] && b[k].raw.join('\n') !== block.raw.join('\n')).length;
}

/* ---------- 이미 만든 교안: 차시 하나 ---------- */
// 받은 글을 차시에 쓴다. 바뀐 탭이 있으면 차시 전체를 작업 기록 한 칸('코드 주석 넣기 전')에 남긴 뒤 쓰고(되돌리면 모든 탭이 함께 돌아온다),
// 교수안·편성안은 기록 없이 쓴다(교수안은 기록 항목이 없다). 저장하지 못하면 false
async function writeCommentedLesson(subj, mod, { tabs, docs, blocks }, totals) {
    const tabIds = Object.keys(tabs);
    const fields = Object.keys(docs);
    if (tabIds.length) await archiveContent(mod, COMMENT_TOOL_REASON);
    tabIds.forEach(tabId => setTabMarkdown(mod, tabId, tabs[tabId]));
    const at = new Date().toISOString();
    fields.forEach(field => {
        const base = mod[field];
        // 편성안이 바뀌면 덱 번호를 올려 이전 덱을 연 슬라이드 화면의 늦은 저장을 막는다(gyosuan.js freshDeckState)
        const deck = 'deckMd' in docs[field] && typeof freshDeckState === 'function' ? freshDeckState(base) : {};
        mod[field] = { ...base, ...docs[field], ...deck, updatedAt: at };
    });
    if (tabIds.some(tabId => Object.keys(mod.manualReview?.[tabId] || {}).length)) totals.manual += 1; // 글 해시가 바뀌어 수동 검수 표시가 '다시 확인'이 된다
    Object.assign(mod, withHistoryNote(mod, `${COMMENT_TOOL_LABEL} (코드 블록 ${blocks}개)`));
    totals.lessons += 1;
    totals.fixed += blocks;
    const saved = (await saveState()) !== false; // 브라우저에 저장하지 못하면 false(알림은 saveState가 띄운다)
    if (saved && fields.length) window.announceGyosuanChange?.(mod.id); // 다른 탭에 이 차시의 교수안이 바뀌었다고 알린다(gyosuan-view.js)
    if (currentSubjectId === subj.id && getEditingModule() === mod) renderEditor(mod);
    else window.refreshLessonNav?.(mod);
    return saved;
}

// 차시 하나: 칸마다 주석을 넣고 받은 데까지 쓴다. 그사이 지운 차시는 건너뛰고(''), 교과째 없어졌으면 'gone', 저장하지 못하면 'save',
// 같은 오류(하루 한도·키 문제)면 그 안내 글을 돌려준다(부른 쪽이 멈춘다). 기다리는 동안 바뀐 칸은 쓰지 않고 센다(totals.meanwhile).
// onPart(part, k): 칸을 시작할 때(이 차시 범위의 진행 막대)
async function commentLesson({ subj, mod, parts }, run, totals, { onPart = null } = {}) {
    const lost = () => (globalState.subjects.includes(subj) ? '' : 'gone');
    if (!lessonStillLive(subj, mod)) return lost();
    const stopped = () => !!run.stopped || !!window.isTabGenerationStopped?.();
    const todo = parts.filter(part => part.needs);
    const next = { tabs: {}, docs: {}, blocks: 0 };
    let halt = '';
    for (let k = 0; k < todo.length && !halt && !stopped(); k++) {
        const part = todo[k];
        onPart?.(part, k);
        if (part.kind === 'tab') saveOpenEditsFor(mod, part.id); // 원문 칸에서 고치던 글을 먼저 넣는다(tabs.js)
        const before = commentPartText(mod, part);
        const skipBlock = part.kind === 'tab' ? lockedCommentSkip(lockedSectionBlocks(mod, part.id)) : null;
        const status = text => window.setPipelineStatus?.(`${part.label} · ${text}`);
        const result = commentRunResult(await codeCommentRun({
            md: before, quiz: part.quiz, isStopped: stopped, onStatus: status, skipBlock,
            ask: codeCommentAsk({ signal: window.aiStopSignal?.() || null, onRetry: commentRetryNotice(status) })
        }), stopped);
        if (!lessonStillLive(subj, mod)) return lost(); // 기다리는 동안 지운 차시에는 쓰지 않는다
        if (part.kind === 'tab') saveOpenEditsFor(mod, part.id);
        const changed = result.md !== before;
        if (changed && commentPartText(mod, part) !== before) {
            totals.meanwhile += 1; // 기다리는 동안 그 칸을 고쳤다: 쓰지 않는다
        } else {
            totals.remaining += result.remaining;
            if (changed && part.kind === 'tab') next.tabs[part.id] = result.md;
            if (changed && part.kind !== 'tab') next.docs[part.field] = { ...(next.docs[part.field] || {}), [part.key]: result.md };
            if (changed) next.blocks += commentedBlockCount(before, result.md);
        }
        if (result.error) halt = result.error; // 같은 오류: 받은 데까지 쓰고 멈춘다
    }
    if (!Object.keys(next.tabs).length && !Object.keys(next.docs).length) return halt;
    return (await writeCommentedLesson(subj, mod, next, totals)) ? halt : 'save';
}

/* ---------- 이미 만든 교안: 시작과 끝 ---------- */
// 다른 생성이 돌고 있다(진행 막대의 작업·교수안·로딩 화면, course-flow.js generationBusy)
const commentBusy = () => !!window.isLessonPipelineRunning?.() || (typeof generationBusy === 'function' && generationBusy());

// 확인 창 글. 해당할 때만 붙이는 문장은 세 범위가 같다
function commentConfirmText(scope, plan, subj) {
    const extras = [
        plan.quiz ? '학습이해도·심화이해도·최종 평가 문항의 코드에는 정답·출력 결과·고칠 곳을 알려 주지 않는 주석만 넣습니다.' : '',
        plan.docs ? '교수안·슬라이드 편성안은 작업 기록에 남지 않습니다(주석 줄만 더합니다).' : '',
        plan.held ? `고정 섹션의 코드 블록 ${plan.held}개는 고치지 않습니다.` : '',
        plan.studioDecks ? `슬라이드 화면에서 고친 편성안 ${plan.studioDecks}개는 바꾸지 않습니다.` : ''
    ].filter(Boolean);
    if (scope === 'lesson') {
        const places = [plan.tabs ? `탭 ${plan.tabs}개` : '', plan.docs ? `교수안·편성안 ${plan.docs}개` : ''].filter(Boolean).join('와 ');
        return [`이 차시의 ${places}에서 주석이 모자란 코드 블록 ${plan.needs}개에 AI가 주석만 더합니다. 코드 줄은 한 글자도 바꾸지 않고(코드가 바뀐 답은 버립니다), 바꾸기 전 탭 글은 작업 기록에 '${COMMENT_TOOL_REASON}'으로 남깁니다. 주석이 덜 붙은 블록은 한 번 더 받아 호출이 최대 ${plan.calls * 2}회까지 늘 수 있습니다. 오른쪽 아래 막대에서 언제든 멈출 수 있습니다.`, ...extras].join(' ');
    }
    const lessons = plan.plans.filter(item => item.mod.id !== 'mainQuest').length;
    const finals = plan.plans.filter(item => item.mod.id === 'mainQuest' && lessonTextParts(item.mod).length).length;
    const where = scope === 'course'
        ? `과정 전체 교과 ${globalState.subjects.length}개의 차시 ${lessons}개${finals ? `와 최종 평가 ${finals}개` : ''}에서`
        : `${subj?.title ? `'${subj.title}'의` : '이 교과의'} 차시 ${lessons}개${finals ? '와 최종 평가' : ''}에서`;
    const limit = typeof HISTORY_LIMIT !== 'undefined' ? HISTORY_LIMIT : 200;
    return [`${where} 주석이 모자란 코드 블록 ${plan.needs}개(고칠 차시 ${plan.lessons}개)에 AI가 주석만 더합니다. 코드 줄은 한 글자도 바꾸지 않고, 바꾸는 차시마다 바꾸기 전 글을 작업 기록에 '${COMMENT_TOOL_REASON}'으로 한 칸씩 남깁니다(작업 기록은 ${limit}개까지 두어 오래된 기록이 밀릴 수 있습니다). 오른쪽 아래 막대에서 언제든 멈출 수 있고, 멈추면 받은 데까지 저장합니다.`, ...extras].join(' ');
}

// 끝 알림 [글, 종류]. halt: 'gone' · 'save' · 같은 오류 안내 글 · ''
function commentDoneText(scope, totals, halt, stopped) {
    if (halt === 'gone') return [`${COMMENT_TOOL_LABEL}를 멈췄습니다. 그사이 ${scope === 'course' ? '교과를' : '이 교과를'} 지우거나 백업·PC 폴더를 불러와 내용이 바뀌었습니다.`, 'warning'];
    if (halt === 'save') return [`저장하지 못해 ${COMMENT_TOOL_LABEL}를 멈췄습니다. 마지막에 고친 차시는 아직 저장되지 않았습니다. ${typeof SAVE_AGAIN_HINT !== 'undefined' ? SAVE_AGAIN_HINT : ''}`.trim(), 'error'];
    if (halt) return [`${COMMENT_TOOL_LABEL}를 멈췄습니다. ${halt} 넣은 데까지는 저장했습니다.`, 'warning'];
    if (stopped) return [`${COMMENT_TOOL_LABEL}를 멈췄습니다. 받은 데까지 넣고 저장했습니다(코드 블록 ${totals.fixed}개). 다시 누르면 남은 블록부터 이어서 합니다.`, 'warning'];
    if (!totals.lessons && totals.meanwhile) return [`넣는 동안 고친 탭 ${totals.meanwhile}개는 바꾸지 않았습니다. 다시 누르면 그 탭에 주석을 넣습니다.`, 'warning'];
    if (!totals.lessons) return ['주석을 넣은 코드 블록이 없습니다. AI 답이 코드를 바꿔 모두 버렸거나 답을 받지 못했습니다. 잠시 뒤 다시 눌러 보세요.', 'warning'];
    const notes = [
        totals.remaining ? `코드 블록 ${totals.remaining}개는 주석을 다 넣지 못했습니다. 다시 누르면 남은 블록만 다시 합니다.` : '',
        totals.held ? `고정 섹션의 코드 블록 ${totals.held}개는 고치지 않았습니다.` : '',
        totals.studio ? `슬라이드 화면에서 고친 편성안 ${totals.studio}개는 바꾸지 않았습니다.` : '',
        totals.meanwhile ? `넣는 동안 고친 탭 ${totals.meanwhile}개는 바꾸지 않았습니다.` : '',
        totals.manual ? '바뀐 탭의 수동 검수 표시는 다시 확인으로 바뀝니다.' : ''
    ].filter(Boolean);
    const lessons = scope === 'lesson' ? '' : `(차시 ${totals.lessons}개)`;
    const head = `${COMMENT_TOOL_LABEL}를 마쳤습니다. 코드 블록 ${totals.fixed}개에 주석을 넣었습니다${lessons}. 바꾸기 전 글은 작업 기록에 '${COMMENT_TOOL_REASON}'으로 남겼습니다.`;
    return [[head, ...notes].join(' '), notes.length ? 'warning' : 'success'];
}

// 도구의 '코드 주석 넣기'(lesson)와 교과 일괄 작업의 '코드 주석 넣기'(subject)·'과정 코드 주석 넣기'(course).
// 확인 창(블록 수·호출 수·시간) → 진행 막대·중지 → 차시마다 작업 기록 한 칸·저장·다시 그리기·교수안 알림 → 끝 알림. 미리보기는 두지 않는다(코드 줄은 모듈의 확인이 지킨다)
window.startCodeComments = async function (scope = 'lesson') {
    const kind = COMMENT_TOOL_SCOPES.includes(scope) ? scope : 'lesson';
    if (commentBusy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    if (typeof textModelHasKey === 'function' && !textModelHasKey()) return window.showAlert('글 모델 키가 없어 코드 주석을 넣을 수 없습니다. 오른쪽 위 ⚙ 설정에서 키를 넣어 주세요.');
    const subj = globalState.subjects.find(item => item.id === currentSubjectId) || null;
    if (kind !== 'course' && !subj) return window.showAlert('교과를 먼저 선택하세요.');
    window.saveRawContent?.(); // 원문 칸에서 고치던 글을 넣고 센다(api.js)
    await window.saveGyosuanRaw?.(); // 교수안 원문 칸에서 고치던 글도(gyosuan-view.js)
    const plan = commentPlan(commentTargets(kind));
    if (!plan.needs) {
        const kept = plan.held || plan.studioDecks;
        return window.showToast?.(kept ? '주석이 모자란 코드 블록은 고정 섹션이나 슬라이드 화면에서 고친 편성안에만 있어 고치지 않습니다.' : '주석이 모자란 코드 블록이 없습니다.', kept ? 'info' : 'success');
    }
    if (!(await confirmWithEstimate(commentConfirmText(kind, plan, subj), { codeComments: plan.calls }, { title: COMMENT_TOOL_LABEL, okLabel: '주석 넣기' }))) return;
    if (kind !== 'course' && globalState.subjects.find(item => item.id === currentSubjectId) !== subj) return window.showToast?.('묻는 동안 교과가 바뀌어 코드 주석을 넣지 않았습니다.', 'warning');
    const rows = plan.plans.filter(row => row.parts.some(part => part.needs));
    const single = kind === 'lesson';
    const totals = { lessons: 0, fixed: 0, remaining: 0, meanwhile: 0, manual: 0, held: plan.held, studio: plan.studioDecks };
    const total = single ? rows[0].parts.filter(part => part.needs).length : rows.length;
    let halt = '';
    const outcome = await window.runLessonJob(currentEditingModuleId ?? rows[0].mod.id, { label: COMMENT_TOOL_LABEL, total }, async run => {
        try {
            // 이 차시 범위는 칸(탭·교수안)마다, 교과·과정 범위는 차시마다 막대를 넘긴다
            const onPart = single ? (part, k) => window.updateLessonJob({ label: `${COMMENT_TOOL_LABEL} · ${part.label}`, done: k, ...(part.kind === 'tab' ? { current: part.id } : {}) }) : null;
            for (let i = 0; i < rows.length && !halt && !run.stopped; i++) {
                if (!single) window.updateLessonJob({ label: `${COMMENT_TOOL_LABEL} · ${rows[i].mod.title || '차시'}`, done: i });
                halt = await commentLesson(rows[i], run, totals, { onPart });
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
// 탭만 세고 고정 섹션의 블록은 세지 않는다(도구가 고치지 않는다)
window.noteCodeCommentGaps = function (mod = getEditingModule()) {
    if (!mod || typeof codeCommentTargets !== 'function' || commentBusy()) return;
    const key = `${currentSubjectId}:${mod.id}`;
    if (_commentGapsSeen.has(key)) return;
    _commentGapsSeen.add(key);
    const count = lessonCommentParts(mod).filter(part => part.kind === 'tab')
        .reduce((sum, part) => sum + codeCommentTargets(commentPartText(mod, part), { skipBlock: lockedCommentSkip(part.lockedBlocks) }).length, 0);
    if (count) window.showToast?.(`이 차시에 주석이 모자란 코드 블록이 ${count}개 있습니다. 도구의 '${COMMENT_TOOL_LABEL}'를 누르면 코드는 그대로 두고 주석만 더합니다.`, 'warning');
};
