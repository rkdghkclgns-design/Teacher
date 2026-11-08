// course-qbank-regen.js - 문제은행 재생성. 갈래(기본학습·심화학습)마다 AI가 문항을 만들 때의 교안(학습·실습 탭 글과 학습 목표)을 기억해 두고,
// 교안이 바뀌면 문제은행 화면에 알린다. '재생성'은 바뀐 점과 비용·시간을 보이고 물은 뒤(cost-estimate.js confirmWithEstimate), 그 갈래에서 AI가 만든 문항만
// 지금 교안으로 다시 만든다(course-qbank.js generateQuestions: 초안 → 코드 주석 → 교차 검수). 직접 만들거나 고친 문항은 그대로 두고, 바꾸기 전 문제은행은 작업 기록에 남긴다.
// 진행 막대·중지는 전체 생성과 같다(lesson-pipeline.js runLessonJob). 다 만든 뒤에만 문제은행을 바꾸므로 멈추거나 실패하면 문제은행은 그대로다.
// 기록은 차시의 qbankSources 칸에 갈래별로 둔다: { key, tabs: { 탭 id: 글 해시 }, objectives, at, ai: [AI가 만든 문항의 지문] }.
// 지문은 문항 블록 글(번호만 뺀)의 해시라 사람이 고친 문항은 지문이 달라져 직접 만든 문항으로 본다. 기록이 없는 예전 문제은행은 가를 수 없어 모두 두고 새 문항을 더한다.
// 해시와 원고 모으기는 교수안과 같은 것을 쓴다(gyosuan.js hashSource·collectLessonSource). 테스트: tests/qbank-regenerate.test.js

const QBANK_SOURCE_FIELD = 'qbankSources';
const QBANK_AI_PRINT_LIMIT = 400; // 갈래마다 기억하는 AI 문항 지문 수(넘으면 오래된 것부터 버린다)
const QBANK_REGEN_DEFAULT = { band: 'L1', type: '객관식', multi: false }; // 전체 생성의 문제은행 채우기와 같은 모양(lesson-pipeline.js QBANK_FILL_COUNT 문항씩)
const QBANK_REGEN_TEXT = {
    stale: '교안이 바뀌었습니다. 최신 내용으로 문항을 다시 만들 수 있습니다.',
    idle: '지금 교안으로 AI가 만든 문항을 다시 만들 수 있습니다. 직접 만들거나 고친 문항은 그대로 둡니다.',
    running: '이 문제은행을 다시 만들고 있습니다. 오른쪽 아래 진행 막대에서 멈출 수 있습니다.',
    busy: '진행 중인 생성이 끝난 뒤 다시 시도해주세요.',
    noContent: '이 갈래의 학습·실습 탭에 아직 교안이 없습니다. 먼저 그 탭을 만들어 주세요.',
    nothing: '다시 만들 문항이 없습니다. 학습 목표마다 직접 만든 문항만 있습니다.',
    noGoals: '학습 목표가 없어 문항을 만들 수 없습니다. 이 갈래의 학습 탭에 학습 목표를 먼저 적어 주세요.',
    keep: '바꾸기 전 문제은행은 작업 기록에 남아 되돌릴 수 있습니다. 오른쪽 아래 진행 막대에서 언제든 멈출 수 있고, 멈추면 문제은행은 그대로입니다.'
};

let _qbankRegen = null; // 묻거나 만드는 중인 재생성 { moduleId, trackId, asking: 확인 창을 기다리는 중 }. 한 번에 하나만 돈다

const qbankSourceReady = () => typeof hashSource === 'function' && typeof collectLessonSource === 'function';
const qbankIsPlain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const qbankTextList = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);
const qbankTextHash = text => (text ? hashSource([{ text }]) : '');

/* ---------- 지문과 교안 열쇠 ---------- */
// 문항 블록의 지문: 번호(### 문제 N)만 빼고 블록 글 전체의 해시. 앞 문항을 지워 번호가 당겨져도 같다
function qbankQuestionPrint(block) {
    return qbankTextHash(String(block || '').replace(/\r\n/g, '\n').trim().replace(/^(#+\s*문제\s*)\d+/, '$1'));
}

const qbankPrintsOf = md => lessonLintQuestions(String(md || '').replace(/\r\n/g, '\n')).map(qbankQuestionPrint);

// 지금 교안: 그 갈래의 학습·실습 탭 글(옛 차시는 본문)과 학습 목표를 하나의 열쇠로, 탭마다 글 해시(바뀐 탭을 알린다)
function qbankSourceSnapshot(mod, trackId) {
    const track = lessonTrack(trackId);
    const parts = collectLessonSource(mod, track.id);
    const objectives = qbankTrackObjectives(mod, track.id).map(String);
    const textOf = practice => parts.filter(part => !!part.practice === practice).map(part => part.text).join('\n');
    return {
        key: hashSource([...parts, { text: objectives.join('\n') }]),
        tabs: { [track.learn]: qbankTextHash(textOf(false)), [track.practice]: qbankTextHash(textOf(true)) },
        objectives
    };
}

// 저장된 기록을 읽는다. 모양이 틀리면(남이 고친 저장본·예전 차시) 없는 것으로 본다
function qbankSourceRecord(mod, trackId) {
    const all = mod?.[QBANK_SOURCE_FIELD];
    const record = qbankIsPlain(all) ? all[lessonTrack(trackId).id] : null;
    if (!qbankIsPlain(record) || typeof record.key !== 'string' || !record.key) return null;
    const tabs = qbankIsPlain(record.tabs) ? Object.fromEntries(Object.entries(record.tabs).filter(([, value]) => typeof value === 'string')) : {};
    return { key: record.key, tabs, objectives: qbankTextList(record.objectives), ai: qbankTextList(record.ai), at: typeof record.at === 'string' ? record.at : '' };
}

function writeQbankSource(mod, trackId, record) {
    const all = qbankIsPlain(mod[QBANK_SOURCE_FIELD]) ? mod[QBANK_SOURCE_FIELD] : {};
    mod[QBANK_SOURCE_FIELD] = { ...all, [lessonTrack(trackId).id]: record };
}

// AI가 만든 문항을 그 갈래 문제은행에 넣은 뒤 부른다(prints: 넣은 문항의 지문). 지금 교안으로 만들었다고 적는다.
// 예전 교안으로 만든 AI 문항이 아직 남아 있으면 그때의 교안을 그대로 둔다(알림이 사라지지 않게). fresh: 재생성이 남은 AI 문항을 모두 바꿨다
function noteQbankAiQuestions(mod, trackId, prints, { fresh = false } = {}) {
    if (!mod || !qbankSourceReady()) return;
    const track = lessonTrack(trackId);
    const now = qbankSourceSnapshot(mod, track.id);
    const old = qbankSourceRecord(mod, track.id);
    const added = qbankTextList(prints);
    const inBank = new Set(qbankPrintsOf(qbankMarkdown(mod, track.id)));
    const staleLeft = !!old && old.key !== now.key && old.ai.some(print => inBank.has(print) && !added.includes(print));
    const base = !fresh && staleLeft ? { key: old.key, tabs: old.tabs, objectives: old.objectives, at: old.at } : { ...now, at: new Date().toISOString() };
    const ai = [...new Set([...(old?.ai || []), ...added])].slice(-QBANK_AI_PRINT_LIMIT);
    writeQbankSource(mod, track.id, { ...base, ai });
}

// 문제은행 끝에 AI 문항 count개를 붙인 뒤 부른다(문제은행 화면의 AI로 생성·전체 생성의 문제은행 채우기)
function noteQbankAppended(mod, trackId, count) {
    if (!mod || !qbankSourceReady() || !(count > 0)) return;
    noteQbankAiQuestions(mod, trackId, qbankPrintsOf(qbankMarkdown(mod, trackId)).slice(-count));
}

// 문제은행 탭(학습이해도·심화이해도)을 AI로 만들거나 다시 만든 뒤 부른다(tabs.js generateTabContent). previous: 바꾸기 전 탭 글.
// 다시 만들기 미리 보기에서 그대로 둔 예전 문항은 새로 만든 문항으로 치지 않는다
function noteQbankTabQuestions(mod, tabId, previous = '') {
    const track = typeof tabTrack === 'function' ? tabTrack(tabId) : null;
    if (!mod || mod.id === 'mainQuest' || !track || track.bank !== tabId || !qbankSourceReady()) return;
    const before = new Set(qbankPrintsOf(previous));
    noteQbankAiQuestions(mod, track.id, qbankPrintsOf(qbankMarkdown(mod, track.id)).filter(print => !before.has(print)));
}

// 지금 문제은행에서 AI가 만든 문항(기록의 지문과 같은 블록)의 번호. 기록이 없으면 빈 목록
function qbankAiIndexes(mod, trackId, record = qbankSourceRecord(mod, trackId)) {
    if (!record || !qbankSourceReady()) return [];
    const ai = new Set(record.ai);
    return qbankPrintsOf(qbankMarkdown(mod, trackId)).flatMap((print, index) => (ai.has(print) ? [index] : []));
}

// AI 문항을 만들 때와 지금 교안이 다른가. 기록이 없는 예전 문제은행과 AI 문항이 하나도 남지 않은 문제은행은 알리지 않는다
function qbankIsStale(mod, trackId) {
    const record = qbankSourceRecord(mod, trackId);
    return !!record && qbankAiIndexes(mod, trackId, record).length > 0 && record.key !== qbankSourceSnapshot(mod, trackId).key;
}

// 무엇이 바뀌었는지 한두 줄(바뀐 탭, 늘거나 빠진 학습 목표). 알 수 없으면 빈 목록
function qbankChangeLines(mod, trackId) {
    const record = qbankSourceRecord(mod, trackId);
    if (!record || !qbankSourceReady()) return [];
    const now = qbankSourceSnapshot(mod, trackId);
    if (record.key === now.key) return [];
    const tabs = Object.keys(now.tabs).filter(id => (record.tabs[id] ?? '') !== now.tabs[id]).map(id => LESSON_TABS.find(tab => tab.id === id)?.label || id);
    const added = now.objectives.filter(goal => !record.objectives.includes(goal)).length;
    const removed = record.objectives.filter(goal => !now.objectives.includes(goal)).length;
    const counts = [added ? `새 목표 ${added}개` : '', removed ? `빠진 목표 ${removed}개` : ''].filter(Boolean).join(', ');
    const goals = counts ? `학습 목표가 바뀌었습니다(${counts}).` : record.objectives.join('\n') !== now.objectives.join('\n') ? '학습 목표의 순서가 바뀌었습니다.' : '';
    return [tabs.length ? `바뀐 탭: ${tabs.join(', ')}` : '', goals].filter(Boolean);
}

/* ---------- 계획 ---------- */
// 바꿀 AI 문항을 밴드·유형·복수 정답이 같은 것끼리 묶어 같은 수만큼 다시 만든다(유형이 그 밴드에 맞지 않으면 L1 객관식)
function qbankRegenGroups(questions) {
    const groups = new Map();
    questions.forEach(q => {
        const valid = !!QBANK_BANDS[q.band] && (QUESTION_BAND_TYPES[q.band] || []).includes(q.type);
        const shape = valid ? { band: q.band, type: q.type, multi: q.type === '객관식' && !!q.multi } : QBANK_REGEN_DEFAULT;
        const key = `${shape.band}|${shape.type}|${shape.multi}`;
        groups.set(key, { ...shape, count: (groups.get(key)?.count || 0) + 1 });
    });
    return [...groups.values()];
}

// 고른 번호의 문항을 지우고 번호를 다시 매긴다. 뒤에서부터 지워 앞 위치가 밀리지 않게 한다
function qbankDropQuestionsMd(md, indexes) {
    const drop = new Set(indexes);
    if (!drop.size) return md;
    const left = lessonQuestionSpans(md).reduceRight((text, span, index) => (drop.has(index) ? replaceSpan(text, span, '') : text), md);
    return renumberQuestions(left);
}

const qbankDropPrintsMd = (md, prints) => {
    const drop = new Set(prints);
    return qbankDropQuestionsMd(md, qbankPrintsOf(md).flatMap((print, index) => (drop.has(print) ? [index] : [])));
};

// 재생성 계획: 바꿀 AI 문항의 지문, 그대로 둘 문항 수, 만들 문항 spec 목록(목표·밴드·유형·복수 정답·수).
// AI 문항을 가를 수 있으면 목표마다 바꿀 문항과 같은 모양·수로 만들고, 문항이 하나도 남지 않는 목표는 L1 객관식을 채운다.
// 가를 수 없으면(예전 문제은행) 모든 문항을 두고 목표마다 L1 객관식을 더한다. 지금 교안에 없는 목표의 AI 문항은 다시 만들지 않는다
function qbankRegenPlan(mod, trackId) {
    const track = lessonTrack(trackId);
    const md = qbankMarkdown(mod, track.id);
    const blocks = lessonLintQuestions(md);
    const questions = blocks.map(parseQuestionBlock);
    const aiIndexes = new Set(qbankAiIndexes(mod, track.id));
    const known = aiIndexes.size > 0;
    const replaced = questions.filter((_, index) => aiIndexes.has(index));
    const kept = questions.filter((_, index) => !aiIndexes.has(index));
    // 목표 번호는 바꿀 문항을 뺀 문제은행으로 센다(예전 방식의 학습이해도 번호도 generateQuestions와 같게)
    const base = { ...mod, tabContents: { ...mod.tabContents, [track.bank]: qbankDropQuestionsMd(md, [...aiIndexes]) } };
    const goals = new Set(qbankTrackObjectives(mod, track.id));
    const numbers = qbankObjectives(base, track.id).flatMap((goal, index) => (goals.has(goal) ? [index + 1] : []));
    const covered = new Set(kept.map(q => q.objective));
    const fill = { ...QBANK_REGEN_DEFAULT, count: QBANK_FILL_COUNT };
    const specs = numbers.flatMap(objective => {
        const groups = known ? qbankRegenGroups(replaced.filter(q => q.objective === objective)) : [];
        if (groups.length) return groups.map(group => ({ objective, ...group }));
        return !known || !covered.has(objective) ? [{ objective, ...fill }] : [];
    });
    return {
        known, prints: [...aiIndexes].map(index => qbankQuestionPrint(blocks[index])),
        replaced: replaced.length, kept: kept.length, objectives: numbers.length, specs, total: specs.reduce((sum, spec) => sum + spec.count, 0)
    };
}

function qbankRegenConfirmText(mod, track, plan) {
    const changes = qbankChangeLines(mod, track.id);
    const kept = plan.kept ? ` 직접 만들거나 고친 문항 ${plan.kept}개는 그대로 둡니다.` : '';
    const what = plan.known
        ? `${track.label} 문제은행에서 AI가 만든 문항 ${plan.replaced}개를 지금 교안으로 다시 만듭니다(새 문항 ${plan.total}개).${kept}`
        : plan.kept
            ? `예전에 만든 ${track.label} 문제은행이라 AI가 만든 문항과 직접 만든 문항을 가를 수 없습니다. 지금 문항 ${plan.kept}개는 모두 그대로 두고, 지금 교안으로 학습 목표 ${plan.objectives}개에 새 문항 ${plan.total}개를 더합니다.`
            : `${track.label} 문제은행에 문항이 없어 지금 교안으로 학습 목표 ${plan.objectives}개에 새 문항 ${plan.total}개를 만듭니다.`;
    return [changes.length ? ['교안이 바뀌었습니다.', ...changes].join('\n') : '', what, QBANK_REGEN_TEXT.keep].filter(Boolean).join('\n\n');
}

/* ---------- 실행 ---------- */
// 그 갈래에서 AI가 만든 문항을 지금 교안으로 다시 만든다. 목표마다 기존 생성 길(generateQuestions)을 한 번씩 부른다.
// 다 만든 뒤에만 바꾼다: 그사이 고친 문제은행에서 바꾸기로 한 AI 문항만 빼고(그사이 고치거나 더한 문항은 둔다) 새 문항을 끝에 붙인다
async function regenerateQuestionBank(mod, trackId, plan, { isStopped = () => false, onStatus = () => {}, onStep = () => {} } = {}) {
    const track = lessonTrack(trackId);
    const made = [];
    try {
        for (const [index, spec] of plan.specs.entries()) {
            if (isStopped()) return { ok: false, stopped: true };
            onStep(index);
            onStatus(`${track.label} 학습 목표 ${spec.objective}의 문항을 다시 만들고 있습니다...`);
            // 겹치면 안 되는 기존 문항: 그대로 둘 문항과 앞에서 새로 만든 문항(바꿀 AI 문항은 빼고 보낸다)
            const working = qbankDropPrintsMd(qbankMarkdown(mod, track.id), plan.prints);
            const view = { ...mod, tabContents: { ...mod.tabContents, [track.bank]: made.length ? appendQuestionsMd(working, made) : working } };
            made.push(...await generateQuestions(view, spec, track.id));
        }
    } catch (err) {
        if (isStopped()) return { ok: false, stopped: true };
        console.error('[문제은행] 재생성 실패:', err);
        return { ok: false, error: err?.message || String(err) };
    }
    if (isStopped()) return { ok: false, stopped: true };
    try {
        await archiveContent({ title: `${mod.title} · ${qbankBankLabel(track.id)}`, content: qbankMarkdown(mod, track.id), images: mod.images, tabId: track.bank, lesson: mod }, '문제은행 다시 만들기 전');
    } catch (err) {
        console.error('[문제은행] 재생성 전 작업 기록 실패:', err);
        return { ok: false, error: '바꾸기 전 문제은행을 작업 기록에 남기지 못해 새 문항을 넣지 않았습니다.' };
    }
    if (isStopped()) return { ok: false, stopped: true }; // 기록을 남기는 동안 멈췄다
    const left = qbankDropPrintsMd(qbankMarkdown(mod, track.id), plan.prints); // 기록을 남기는 동안 바뀌었어도 지금 글로
    const kept = lessonLintQuestions(left).length;
    const next = made.length ? appendQuestionsMd(left, made) : left;
    setTabMarkdown(mod, track.bank, next);
    noteQbankAiQuestions(mod, track.id, made.length ? qbankPrintsOf(next).slice(-made.length) : [], { fresh: true });
    Object.assign(mod, withHistoryNote(mod, `${track.label} 문제은행 재생성 (새 문항 ${made.length}개, 그대로 둔 문항 ${kept}개)`));
    await saveState();
    return { ok: true, added: made.length, kept, questions: made };
}

// 문제은행 화면이 이 차시를 열어 두었으면 쓰던 편집 칸을 지키며 다시 그린다
function qbankRedraw(mod) {
    if (!_qbank || qbankMod() !== mod || typeof renderQbank !== 'function') return false;
    keepQbankDraft();
    renderQbank();
    return true;
}

function finishQbankRegenerate(mod, track, result = {}) {
    if (result.busy) return void qbankRedraw(mod); // 다른 생성이 돌아 runLessonJob이 이미 알렸다. 막아 둔 단추만 푼다
    if (!result.ok && !result.stopped) {
        window.showAlert(`${track.label} 문제은행을 다시 만들지 못했습니다. ${result.error || ''} 문제은행은 그대로 두었습니다.`.replace(/\s+/g, ' '));
        return void qbankRedraw(mod);
    }
    const note = result.ok && typeof questionCommentNote === 'function' ? questionCommentNote(result.questions) : '';
    const message = result.ok
        ? [`${track.label} 문제은행을 다시 만들었습니다. 새 문항 ${result.added}개, 그대로 둔 문항 ${result.kept}개입니다. 바꾸기 전 문항은 작업 기록에 남았습니다.`, note].filter(Boolean).join(' ')
        : `${track.label} 문제은행 재생성을 멈췄습니다. 문제은행은 그대로 두었습니다.`;
    const notify = window.notifyLessonJobDone || window.showToast;
    notify?.(message, result.ok && !note ? 'success' : 'warning');
    if (_qbank && qbankMod() === mod) _qbank = { ..._qbank, dirty: _qbank.dirty || !!result.ok, status: message };
    // 문제은행 화면을 닫았으면 그 차시를 보고 있을 때만 화면을 고친다(문제은행 탭 글이 바뀌었다)
    if (!qbankRedraw(mod) && result.ok && getEditingModule() === mod && typeof renderEditor === 'function') renderEditor(mod);
}

// 문제은행 화면의 '재생성' 단추. 바뀐 점과 비용·시간을 보이고 물은 뒤 진행 막대(중지)와 함께 돌린다. 한 번에 하나만 돈다
async function runQbankRegenerate(mod, trackId) {
    if (!mod) return;
    const track = lessonTrack(trackId);
    if (_qbankRegen || window.isLessonPipelineRunning?.()) return window.showAlert(QBANK_REGEN_TEXT.busy);
    if (!trackHasContent(mod, track.id)) return window.showAlert(QBANK_REGEN_TEXT.noContent);
    const plan = qbankRegenPlan(mod, track.id);
    if (!plan.specs.length) return window.showAlert(plan.objectives ? QBANK_REGEN_TEXT.nothing : QBANK_REGEN_TEXT.noGoals);
    _qbankRegen = { moduleId: mod.id, trackId: track.id, asking: true }; // 묻는 동안에도 다시 누르지 못하게 먼저 잡는다
    try {
        // 전체 생성이 그 갈래 문제은행 하나를 채울 때와 같은 수로 가늠한다
        const work = typeof lessonWork === 'function' ? lessonWork({ qbank: 1 }) : { qbank: 1 };
        const ok = await confirmWithEstimate(qbankRegenConfirmText(mod, track, plan), work, { title: `${track.label} 문제은행 재생성`, okLabel: '재생성' });
        if (!ok || getEditingModule(mod.id) !== mod) return; // 취소했거나 묻는 동안 다른 교과·차시로 옮겼다
        _qbankRegen = { ..._qbankRegen, asking: false };
        qbankRedraw(mod);
        const result = await window.runLessonJob(mod.id, { label: `${track.label} 문제은행 재생성`, current: 'qbank', total: plan.specs.length }, run =>
            regenerateQuestionBank(mod, track.id, plan, {
                isStopped: () => !!run.stopped,
                onStatus: text => window.setPipelineStatus?.(text),
                onStep: done => window.updateLessonJob?.({ done })
            }));
        _qbankRegen = null;
        finishQbankRegenerate(mod, track, result);
    } finally {
        if (_qbankRegen) {
            _qbankRegen = null;
            qbankRedraw(mod);
        }
    }
}

// 문제은행 화면 위쪽 줄: 교안이 바뀐 갈래는 알림, 아니면 안내와 '재생성' 단추. 그 갈래에 교안이 없으면 그리지 않는다
function qbankRegenHtml(mod, trackId) {
    if (!mod || !trackHasContent(mod, trackId)) return '';
    const track = lessonTrack(trackId);
    const mine = !!_qbankRegen && String(_qbankRegen.moduleId) === String(mod.id) && _qbankRegen.trackId === track.id;
    const running = mine && !_qbankRegen.asking; // 묻는 동안은 아직 만들지 않는다
    const stale = !running && qbankIsStale(mod, track.id);
    const text = running ? QBANK_REGEN_TEXT.running : stale ? QBANK_REGEN_TEXT.stale : QBANK_REGEN_TEXT.idle;
    return `
        <div class="flex items-center gap-2 p-2 rounded-lg ${stale ? 'bg-amber-500/10' : 'bg-black/20'}">
            <p class="flex-1 text-xs ${stale ? 'text-amber-300' : 'text-textMuted'}">${escapeHtml(text)}</p>
            <button data-qbank-action="regenerate" ${mine ? 'disabled' : ''} title="${escapeHtml(`${track.label} 문제은행에서 AI가 만든 문항을 지금 교안으로 다시 만듭니다`)}" class="shrink-0 px-3 py-1 text-xs font-bold text-white bg-accent rounded hover:bg-accentHover disabled:opacity-50">재생성</button>
        </div>`;
}
