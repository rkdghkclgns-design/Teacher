// 코드 주석 시험이 함께 쓰는 실행 환경(tests/code-comments-flow.test.js·tests/code-comments-safety.test.js·tests/code-comments-notice.test.js): 실제 js 파일을 화면 차례대로 vm에 싣고 AI·저장·창만 흉내 낸다.
// AI는 가짜다: 지시의 <<<CODE n>>>…<<<END n>>>를 읽어 [블록 n] 줄의 주석 기호로 주석 줄을 붙인 답을 만든다. 키는 가짜 값만 쓰고 찍지 않는다.
// 컨벤션 점검의 주석 지적(codeComment: true, 주석이 모자라면 sev 'bad')은 lesson-lint.js가 낸다. 그 파일이 아직 내지 않으면 같은 모양으로 붙여 쓴다(appContext)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const rootDir = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(rootDir, file), 'utf8');
const source = file => read(`js/${file}`);
const plain = value => JSON.parse(JSON.stringify(value));
const reply = (text, finishReason = 'STOP') => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const quiet = { log() {}, warn() {}, error() {} };
const FAKE_KEY = 'AIza-FAKE-TEST-KEY';
const COMMENT_SYSTEM = '교안의 코드 예제에 주석을 더하는 일을 합니다.';
const QUIZ_LINE = '이 코드는 문항(문제)에 쓰는 코드입니다.';
const NOTE = '이 줄이 하는 일입니다';
const HISTORY_REASON = '코드 주석 넣기 전';
const DAILY_MESSAGE = '오늘 쓸 수 있는 AI 사용량을 다 썼습니다(429). 내일 다시 하거나 오른쪽 위 ⚙ 설정에서 다른 모델이나 키로 바꿔 주세요.';
const daily = () => Object.assign(new Error(DAILY_MESSAGE), { status: 429, quota: 'daily', noRetry: true });
const PY = (...lines) => ['```python', ...lines, '```'].join('\n');
const TAB_IDS = ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment', 'advAssessment'];

// 화면과 같은 차례(index.html): code-comments.js는 data.js 바로 뒤, code-comments-tool.js는 lesson-volume.js 뒤
const APP_FILES = ['data.js', 'code-comments.js', 'ai-errors.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'lesson-fix-run.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js', 'course-design.js', 'course-flow.js', 'lesson-volume.js', 'code-comments-tool.js', 'merge.js', 'gyosuan.js', 'data-safety.js'];
const REAL_FILES = ['data.js', 'code-comments.js', 'ai-errors.js', 'claude.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'lesson-fix-run.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'cost-estimate.js', 'api.js', 'lesson-volume.js', 'code-comments-tool.js'];

function fakeElement() {
    const handlers = {};
    return {
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', title: '', disabled: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener(type, fn) { handlers[type] = fn; },
        fire(type, event) { return handlers[type]?.(event); },
        querySelector: () => fakeElement(),
        querySelectorAll: () => [],
        remove() { this.removed = true; }
    };
}

function fakeDocument(elements) {
    return {
        readyState: 'complete', hidden: false, title: '',
        body: { appendChild: el => { if (el.id) elements[el.id] = el; } },
        createElement: fakeElement,
        getElementById: id => elements[id] || null,
        addEventListener() {}, removeEventListener() {},
        querySelector: () => null, querySelectorAll: () => []
    };
}

// 지시의 블록마다 그 블록의 주석 기호로 코드 줄마다 주석을 붙인 답. transform(code, mark, no)으로 답을 바꿀 수 있다
const commentEvery = (code, mark) => code.split('\n').flatMap(line => (line.trim() ? [`${line.match(/^\s*/)[0]}${mark} ${NOTE}`, line] : [line])).join('\n');
function commentAnswer(user, transform = commentEvery) {
    const blocks = [...String(user).matchAll(/\[블록 (\d+)\][^\n]*?주석 기호: (\S+)[^\n]*\n[\s\S]*?<<<CODE \1>>>\n([\s\S]*?)\n<<<END \1>>>/g)];
    return `주석을 달았습니다.\n${blocks.map(([, no, mark, code]) => `<<<CODE ${no}>>>\n${transform(code, mark, Number(no))}\n<<<END ${no}>>>`).join('\n')}`;
}

// 가짜 AI: 지시를 보고 어느 호출인지 가려 handlers[kind](없으면 handlers.other)를 부른다. 부른 호출은 ctx.calls에 남는다
function callKind(system, user, payload) {
    if (system.startsWith(COMMENT_SYSTEM)) return 'comment';
    if (user.startsWith('[작업] 아래 교안이 컨벤션 검수에서')) return 'fix';
    if (payload.taskRole === 'qgen' || payload.taskRole === 'review') return payload.taskRole;
    const task = user.split('|')[0];
    return { tab_content: 'tab', tab_content_continue: 'continue', module: 'module', module_continue: 'continue', volume_expand: 'volume', main_quest: 'main' }[task] || 'other';
}

function route(ctx, handlers) {
    return async (model, payload) => {
        const system = String(payload?.systemInstruction?.parts?.[0]?.text || '');
        const user = String(payload?.contents?.[0]?.parts?.[0]?.text || '');
        const kind = callKind(system, user, payload || {});
        const item = { kind, model, system, user, payload, quiz: system.includes(QUIZ_LINE) };
        ctx.calls.push(item);
        const handler = handlers[kind] || handlers.other;
        if (!handler) throw new Error(`부르지 않을 호출입니다: ${kind}`);
        return handler(item);
    };
}

const commentReply = (transform = commentEvery) => ({ user }) => reply(commentAnswer(user, transform));
const callsOf = (ctx, kind) => ctx.calls.filter(item => item.kind === kind);

// 생성·고치기·일괄 도구를 돌리는 화면 흉내(lesson-volume.test.js genContext와 같은 틀). callGemini는 ctx.ai로 바꿔 끼운다(끊긴 신호면 진짜처럼 중지로 끝낸다)
function appContext() {
    const elements = {};
    const ctx = {
        console: quiet, Promise, URL, Uint16Array, Blob, AbortController,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''),
        saveState: async () => { ctx.saved += 1; return ctx.saveResult; },
        showLessonView() {}, lessonDesignBrief: () => '', lessonGenBrief: () => '',
        needsElementAutoAssign: () => false, lessonNeedsGyosuan: () => false, runGyosuanGeneration: async () => ({ ok: true }),
        elements, calls: [], toasts: [], alerts: [], confirms: [], estimates: [], previews: [], archived: [], announced: [], steps: [], statuses: [], order: [],
        saved: 0, saveResult: true, rendered: 0, hasKey: true,
        document: fakeDocument(elements)
    };
    ctx.window = ctx;
    ctx.setTimeout = (fn, ms) => setTimeout(fn, Math.min(ms, 1));
    ctx.clearTimeout = id => clearTimeout(id);
    ctx.setInterval = () => 0;
    ctx.clearInterval = () => {};
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind });
    vm.createContext(ctx);
    APP_FILES.forEach(file => vm.runInContext(source(file), ctx));
    ctx.confirmAsync = async (message, opts) => { ctx.confirms.push({ message, opts }); ctx.onConfirm?.(); return ctx.confirmAnswer !== false; };
    ctx.announceGyosuanChange = id => ctx.announced.push(id);
    ctx.ai = async () => { throw new Error('호출되면 안 됨'); };
    vm.runInContext(`callGemini = (model, payload, onRetry) => {
            if (payload?.signal?.aborted || payload?.waitSignal?.aborted) return Promise.reject(abortError());
            return window.ai(model, payload, onRetry);
        };
        buildTaskContext = (task, a) => ({ systemInstruction: '시스템', userPrompt: [task, a?.tabId, a?.sectionTitle, a?.requestChars, a?.needCode ? 'code' : ''].join('|') });
        getEditingModule = (id = currentEditingModuleId) => (id === 'mainQuest' ? (globalState.subjects.find(s => s.id === currentSubjectId) || {}).mainQuest : courseData.find(m => String(m.id) === String(id)));
        processImageTags = async (mod, md) => { window.order.push('images'); return md; };
        previewAiChange = async (before, after, opts) => { window.order.push('preview'); window.previews.push({ before, after, opts }); return window.previewAnswer === undefined ? after : window.previewAnswer; };
        // 작업 기록 한 칸(state.js archiveContents와 같이 그 차시가 든 교과 id를 남긴다. 탭 하나 기록은 교과를 알 때만 차시 id가 남는다)
        archiveContent = async (mod, reason = '') => {
            const lesson = mod.lesson && typeof mod.lesson === 'object' ? mod.lesson : mod;
            const owner = lessonOwnerId(lesson, globalState.subjects, currentSubjectId, courseData);
            window.archived.push({ reason, mod, entry: historyEntry(mod, { id: window.archived.length + 1, date: '오늘', reason, subjectId: owner ?? (lesson === mod ? currentSubjectId : null) }) });
        };
        archiveContents = async (mods, reason = '') => { for (const mod of mods) await archiveContent(mod, reason); };
        renderSidebar = () => {}; renderEditor = () => { window.rendered += 1; };
        sidebarSectionHtml = (id, meta, body) => body;
        textModelHasKey = () => window.hasKey;
        globalState = { subjects: [] }; currentSubjectId = null; courseData = []; currentEditingModuleId = null;
        // 점검의 주석 지적: lesson-lint.js가 아직 내지 않으면 약속한 모양(codeComment: true, 주석이 모자라면 'bad')으로 붙인다
        (() => {
            const realLint = lintLessonMarkdown;
            lintLessonMarkdown = (md, tabId, opts = {}) => {
                const issues = realLint(md, tabId, opts);
                if (opts?.codeComments === false || issues.some(issue => issue.codeComment)) return issues;
                return [...issues, ...codeCommentIssues(md, { sev: 'bad' }).map(issue => ({ ...issue, codeComment: true }))];
            };
        })();`, ctx);
    const realUpdate = ctx.updateLessonJob;
    ctx.updateLessonJob = step => { ctx.steps.push(step); return realUpdate(step); };
    const realStatus = ctx.setPipelineStatus;
    ctx.setPipelineStatus = text => { ctx.statuses.push(text); return realStatus(text); };
    const realEstimate = ctx.confirmWithEstimate;
    ctx.confirmWithEstimate = (message, work, opts) => { ctx.estimates.push({ message, work, opts }); return realEstimate(message, work, opts); };
    ['editor-loading', 'editor-loading-text', 'editor-loading-stop', 'ai-command-input', 'lesson-volume-chip'].forEach(id => { elements[id] = fakeElement(); });
    return ctx;
}

// 진짜 callGemini 길(game-images.test.js makeContext와 같은 틀): fetch만 바꿔 끼우고 키는 가짜 값이다
function realContext() {
    const elements = {};
    const ctx = {
        console: quiet, Promise, URL, Uint16Array, Blob, AbortController, Response,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        escapeHtml: s => String(s), toasts: [], fetched: [], elements, document: fakeDocument(elements)
    };
    ctx.window = ctx;
    ctx.setTimeout = (fn, ms) => setTimeout(fn, Math.min(ms, 1));
    ctx.clearTimeout = id => clearTimeout(id);
    ctx.showAlert = () => {};
    ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind });
    ctx.fetch = (url, init = {}) => { ctx.fetched.push({ url: String(url), init }); return ctx.fetchStub(String(url), init); };
    ctx.fetchStub = async url => { throw new Error(`fetchStub를 정하지 않았습니다: ${url}`); };
    vm.createContext(ctx);
    REAL_FILES.forEach(file => vm.runInContext(source(file), ctx));
    vm.runInContext(`apiKey = '${FAKE_KEY}'; globalState = { subjects: [] }; currentSubjectId = null; courseData = []; currentEditingModuleId = null;`, ctx);
    return ctx;
}

const call = (ctx, name) => vm.runInContext(name, ctx);

function lessonOf({ id = 1, title = 'Python 반복문', tabs = {}, ...extra } = {}) {
    const tabContents = Object.fromEntries(TAB_IDS.map(tab => [tab, tabs[tab] ?? null]));
    const content = TAB_IDS.map(tab => tabContents[tab] || '').filter(Boolean).join('\n\n---\n\n');
    return { id, title, description: '반복문으로 합계를 구합니다.', status: 'done', images: {}, history: [], tabContents, content, ...extra };
}

function openSubject(ctx, lessons, { mainQuest = null, id = 's1', title = '파이썬 기초', others = [] } = {}) {
    const subject = { id, title, lessons, ...(mainQuest ? { mainQuest } : {}) };
    ctx.globalState = { subjects: [subject, ...others] };
    vm.runInContext(`globalState = window.globalState; currentSubjectId = ${JSON.stringify(id)}; courseData = globalState.subjects[0].lessons;
        currentEditingModuleId = ${JSON.stringify(lessons[0]?.id ?? null)}; currentLessonTab = 'basicLearn'; _lessonPanel = null;`, ctx);
    return subject;
}

const blocksOf = (ctx, md) => call(ctx, 'codeCommentBlocks')(md);
const needsOf = (ctx, md, skipBlock = null) => call(ctx, 'codeCommentPreview')(md, skipBlock ? { skipBlock } : {}).needs;
// 주석만 더했는지: 블록 밖 글이 같고 블록마다 원래 줄이 차례대로 남았으며(code-comments.js 확인), 낭독 분량이 같다
function onlyComments(ctx, before, after) {
    assert.ok(call(ctx, 'ccKeepsCode')(before, after), '블록 밖 글과 코드 줄은 그대로');
    const [a, b] = [blocksOf(ctx, before), blocksOf(ctx, after)];
    assert.strictEqual(a.length, b.length);
    a.filter(block => !block.skip).forEach((block, k) => assert.ok(call(ctx, 'codeCommentVerify')(block, b[a.indexOf(block)].lines.join('\n')).ok, `블록 ${k}`));
    assert.strictEqual(call(ctx, 'spokenChars')(after), call(ctx, 'spokenChars')(before), '낭독 분량은 그대로');
}

const PRAC_DRAFT = ['## 1. 합계 구하기 (⏱ 30분)', '', '반복문으로 합계를 구합니다.', '', PY('total = 0', 'for n in [1, 2, 3]:', '    total += n', 'print(total)'), '', '## 2. 결과 확인 (⏱ 20분)', '', '결과를 확인합니다.', '', '```text', '6', '```'].join('\n');
const LEARN_GOALS = '## 학습 목표\n\n- 반복문으로 합계를 구하는 코드를 작성할 수 있습니다.';
const QUESTION_MD = ['### 문제 1. 합계 구하기', '학습 목표 1 · 밴드 L2 · 코드제출', '', '빈칸을 채워 합계를 출력합니다.', '', '🧩 **시작 코드:**', '', PY('total = 0', 'print(total)'), '', '🧪 **테스트:** 입력 없음 → 6', '', '---'].join('\n');

// 시험 하나씩 돌려 결과를 찍는다. finish()는 통과 수를 찍고 하나라도 실패하면 1로 끝낸다
function runner() {
    let failed = 0;
    let total = 0;
    return {
        async run(name, fn) {
            total++;
            try {
                await fn();
                console.log(`ok - ${name}`);
            } catch (err) {
                failed++;
                console.log(`FAIL - ${name}\n  ${err.stack || err.message}`);
            }
        },
        finish() {
            console.log(`\n${total - failed}/${total} passed`);
            if (failed) process.exit(1);
        }
    };
}

module.exports = {
    fs, vm, path, assert, rootDir, read, source, plain, reply, json, quiet, FAKE_KEY, COMMENT_SYSTEM, QUIZ_LINE, NOTE, HISTORY_REASON, DAILY_MESSAGE, daily, PY, TAB_IDS,
    APP_FILES, REAL_FILES, fakeElement, fakeDocument, commentEvery, commentAnswer, route, commentReply, callsOf, appContext, realContext, call, lessonOf, openSubject,
    blocksOf, needsOf, onlyComments, PRAC_DRAFT, LEARN_GOALS, QUESTION_MD, runner
};
