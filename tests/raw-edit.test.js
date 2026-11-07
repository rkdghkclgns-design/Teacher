// 원문 칸(#raw-view) 테스트: 다시 그리거나 숨기기 전에 넣기, 칸을 그린 뒤 바뀐 탭('넣지 못한 원문'), 다른 교과에서 그린 칸, 탭이 없는 최종 평가 (실행: node tests/raw-edit.test.js)
// 실제 tabs.js·api.js의 renderEditor·toggleEditorMode·saveRawContent·generateTabContent를 돌린다. 화면은 id가 있는 요소와 원문 칸만 흉내 낸다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', 'js') + path.sep;
const FILES = ['data.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js'];

const plain = value => JSON.parse(JSON.stringify(value));
const reply = text => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
const unescapeHtml = text => text.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const camel = name => name.replace(/-(\w)/g, (_, ch) => ch.toUpperCase());

function classList(names = []) {
    const set = new Set(names);
    return {
        add: (...items) => items.forEach(item => set.add(item)),
        remove: (...items) => items.forEach(item => set.delete(item)),
        toggle: (item, force) => {
            const on = force === undefined ? !set.has(item) : !!force;
            if (on) set.add(item);
            else set.delete(item);
            return on;
        },
        contains: item => set.has(item),
        replace: (from, to) => { if (set.delete(from)) set.add(to); }
    };
}

function fakeElement(id = '', classes = []) {
    const handlers = {};
    return {
        id, style: {}, dataset: {}, value: '', innerHTML: '', textContent: '', className: '', title: '', disabled: false,
        classList: classList(classes),
        addEventListener(type, fn) { handlers[type] = fn; }, removeEventListener() {},
        fire(type, event) { return handlers[type]?.(event); },
        querySelector: () => null, querySelectorAll: () => [],
        remove() { this.removed = true; }
    };
}

// 편집 영역: innerHTML로 그린 글에서 id가 있는 요소를 만든다. 원문 칸은 브라우저처럼 첫 빈 줄을 떼고 줄바꿈을 \n으로 바꿔 담는다
function editorArea(elements) {
    const area = fakeElement('editor-content-area');
    let html = '';
    let owned = [];
    Object.defineProperty(area, 'innerHTML', {
        get: () => html,
        set(next) {
            owned.forEach(id => { delete elements[id]; });
            owned = [];
            html = String(next);
            for (const match of html.matchAll(/<(\w+)\b([^>]*?)\sid="([^"]+)"([^>]*)>/g)) {
                const [whole, tag, before, id, after] = match;
                const attrs = `${before} ${after}`;
                const el = fakeElement(id, ((attrs.match(/\sclass="([^"]*)"/) || [])[1] || '').split(/\s+/).filter(Boolean));
                for (const [, name, value] of attrs.matchAll(/\sdata-([\w-]+)="([^"]*)"/g)) el.dataset[camel(name)] = unescapeHtml(value);
                if (tag === 'textarea') {
                    const start = match.index + whole.length;
                    el.value = el.defaultValue = unescapeHtml(html.slice(start, html.indexOf('</textarea>', start))).replace(/\r\n?/g, '\n').replace(/^\n/, '');
                }
                elements[id] = el;
                owned.push(id);
            }
        }
    });
    return area;
}

function makeContext({ callGemini = async () => reply('') } = {}) {
    const elements = {};
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1)), clearTimeout, Promise, URL, Uint16Array, Blob, AbortController,
        localStorage: { getItem: () => null, setItem() {} },
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''),
        saveState: async () => { ctx.saved += 1; return true; },
        archiveContent: async (item, reason) => { ctx.archived.push({ ...item, reason }); },
        renderSidebar() {}, showLessonView() {}, syncGyosuanView() {}, syncSlidePanel() {},
        lessonDesignBrief: () => '', lessonGenBrief: () => '',
        inlineLessonImages: md => md,
        saved: 0, archived: [], alerts: [], toasts: [], overlays: [],
        elements,
        document: {
            readyState: 'complete',
            body: { classList: classList(), appendChild: el => { if (el.id) elements[el.id] = el; ctx.overlays.push(el); ctx.onOverlay?.(el); } },
            createElement: () => fakeElement(),
            getElementById: id => elements[id] || null,
            addEventListener() {}, removeEventListener() {},
            querySelector: () => null, querySelectorAll: () => []
        },
        callGemini
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind });
    elements['editor-content-area'] = editorArea(elements);
    elements['ai-command-bar'] = fakeElement('ai-command-bar', ['hidden']);
    ['editor-loading', 'editor-loading-text', 'editor-loading-stop', 'ai-command-input'].forEach(id => { elements[id] = fakeElement(id); });
    vm.createContext(ctx);
    FILES.forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), ctx));
    if (!ctx.confirmAsync) ctx.confirmAsync = async () => true;
    ctx.enhanceRawView = undefined; // 서식 도구 상자는 원문 칸을 옮겨 담는다(이 흉내에는 부모 요소가 없다)
    ctx.callGemini = callGemini; // api.js의 함수 선언이 전역을 차지하므로 불러온 뒤에 덮는다
    vm.runInContext(`buildTaskContext = (task, args) => ({ systemInstruction: '시스템', userPrompt: task + ':' + args.tabId });
        renderLessonHTML = md => md; preprocessMarkdown = md => md; processImageTags = async (mod, md) => md; renderSidebar = () => {};
        getEditingModule = (id = currentEditingModuleId) => id === 'mainQuest' ? (globalState.subjects.find(s => s.id === currentSubjectId) || {}).mainQuest : courseData.find(m => String(m.id) === String(id));`, ctx);
    return ctx;
}

const call = (ctx, name) => vm.runInContext(name, ctx);
const rawBox = ctx => ctx.elements['raw-view'];
const tabsOf = (texts = {}) => ({ basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null, ...texts });

// 교과 s1(차시 1, 최종 평가)과 s2(같은 번호 차시 1, 최종 평가)를 두고 s1의 차시 1을 연다
function twoSubjects(ctx, { quest1 = {}, quest2 = {} } = {}) {
    const L1 = { id: 1, title: '첫 차시', images: {}, tabContents: tabsOf({ basicLearn: '## 1. 기본\n\n기본 글입니다.', basicPrac: '## 1. 실습\n\n실습 글입니다.' }) };
    L1.content = [L1.tabContents.basicLearn, L1.tabContents.basicPrac].join('\n\n---\n\n');
    const L2 = { id: 1, title: '다른 교과 차시', images: {}, tabContents: tabsOf({ basicLearn: '## 다른 글\n\n다른 교과입니다.' }), content: '## 다른 글\n\n다른 교과입니다.' };
    const Q1 = { id: 'mainQuest', title: '👑 최종 평가', images: {}, content: '## 과제\n\n교과1 최종 평가 본문입니다.', ...quest1 };
    const Q2 = { id: 'mainQuest', title: '👑 최종 평가', images: {}, content: '## 과제\n\n교과2 최종 평가 본문입니다.', ...quest2 };
    const s1 = { id: 's1', title: '교과1', lessons: [L1], mainQuest: Q1 };
    const s2 = { id: 's2', title: '교과2', lessons: [L2], mainQuest: Q2 };
    vm.runInContext("currentLessonTab = 'basicLearn'; _lessonPanel = null;", ctx);
    ctx.globalState = { subjects: [s1, s2] };
    ctx.currentSubjectId = 's1';
    ctx.courseData = s1.lessons;
    ctx.currentEditingModuleId = 1;
    return { L1, L2, Q1, Q2, s1, s2 };
}

// 그 차시를 열고(renderEditor) 원문 전체 수정 칸을 연다
function openRaw(ctx, mod, tabId) {
    if (tabId) vm.runInContext(`currentLessonTab = '${tabId}'`, ctx);
    ctx.currentEditingModuleId = mod.id;
    call(ctx, 'renderEditor')(mod);
    call(ctx, 'toggleEditorMode')('edit');
    return rawBox(ctx);
}

async function run(name, fn) {
    await fn();
    console.log('PASS', name);
}

(async () => {
    /* ---------- 다시 그리거나 숨기기 전에 넣는다 ---------- */
    await run('원문 칸: 칸을 벗어나기 전에 탭을 바꿔도(다시 그리기) 고친 글을 그린 탭에 넣고, 새 칸은 그 탭의 저장된 글을 기준으로 둔다', async () => {
        const ctx = makeContext();
        const { L1 } = twoSubjects(ctx);
        const raw = openRaw(ctx, L1, 'basicLearn');
        assert.deepStrictEqual([raw.dataset.moduleId, raw.dataset.subjectId, raw.dataset.tabId, raw.value, raw.storedFrom], ['1', 's1', 'basicLearn', L1.tabContents.basicLearn, L1.tabContents.basicLearn]);
        raw.value += '\n\n강사가 쓴 줄';
        call(ctx, 'switchLessonTab')('basicPrac'); // change가 오기 전에 다시 그린다
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 기본\n\n기본 글입니다.\n\n강사가 쓴 줄');
        assert.ok(L1.content.includes('강사가 쓴 줄'), '합친 본문도 다시 만든다');
        assert.strictEqual(L1.tabContents.basicPrac, '## 1. 실습\n\n실습 글입니다.', '새로 연 탭은 그대로');
        const next = rawBox(ctx);
        assert.notStrictEqual(next, raw);
        assert.deepStrictEqual([next.dataset.tabId, next.storedFrom], ['basicPrac', L1.tabContents.basicPrac]);
        assert.strictEqual(ctx.saved, 1);
    });

    await run('원문 칸: 보기로 돌아가면 숨기기 전에 넣고, 화면은 넣은 글로 그린다', async () => {
        const ctx = makeContext();
        const { L1 } = twoSubjects(ctx);
        const raw = openRaw(ctx, L1, 'basicLearn');
        raw.value = '## 1. 기본\n\n고친 기본 글입니다.';
        call(ctx, 'toggleEditorMode')('view');
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 기본\n\n고친 기본 글입니다.');
        assert.ok(raw.classList.contains('hidden'));
        assert.ok(ctx.elements['render-view'].innerHTML.includes('고친 기본 글입니다.'));
        assert.strictEqual(call(ctx, 'hasPendingRawEdit')(), false);
    });

    /* ---------- 칸을 그린 뒤 다른 기능이 탭을 바꿨다 ---------- */
    await run("원문 칸: 그린 뒤 다른 기능이 탭을 바꿨으면 칸의 글로 덮지 않고 작업 기록에 '넣지 못한 원문'으로 남긴 뒤 칸을 맞춘다", async () => {
        const ctx = makeContext();
        const { L1 } = twoSubjects(ctx);
        const raw = openRaw(ctx, L1, 'basicLearn');
        call(ctx, 'setTabMarkdown')(L1, 'basicLearn', '## 1. 기본\n\n삽화를 넣은 글입니다.'); // 칸을 그대로 둔 사이 다른 기능이 탭을 바꿨다
        raw.value = '## 1. 기본\n\n기본 글입니다. 강사가 고침';
        assert.strictEqual(call(ctx, 'hasPendingRawEdit')(), true, '넣기 전에는 넣지 않은 글로 센다(창을 닫기 전에 묻는다)');
        call(ctx, 'flushVisibleRawView')();
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 기본\n\n삽화를 넣은 글입니다.', '바뀐 탭을 지킨다');
        assert.deepStrictEqual(ctx.archived.map(item => [item.reason, item.content, item.tabId, item.lesson === L1, item.title]),
            [['넣지 못한 원문', '## 1. 기본\n\n기본 글입니다. 강사가 고침', 'basicLearn', true, '첫 차시 · 기본학습']]);
        assert.deepStrictEqual([raw.value, raw.storedFrom], [L1.tabContents.basicLearn, L1.tabContents.basicLearn], '칸을 지금 글로 맞춘다');
        assert.strictEqual(ctx.toasts.at(-1).kind, 'warning');
        assert.ok(ctx.toasts.at(-1).message.includes("작업 기록에 '넣지 못한 원문'으로 남겼습니다"), ctx.toasts.at(-1).message);
        assert.strictEqual(call(ctx, 'hasPendingRawEdit')(), false);
        assert.strictEqual(ctx.saved, 0, '탭은 바꾸지 않았다');
        raw.value += '\n\n맞춘 칸에서 고친 줄'; // 맞춘 뒤에 고친 글은 넣는다
        call(ctx, 'flushVisibleRawView')();
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 기본\n\n삽화를 넣은 글입니다.\n\n맞춘 칸에서 고친 줄');
        assert.strictEqual(ctx.archived.length, 1);
        // 비운 칸은 남길 글이 없다: 넣지 않고 알리기만 한다
        call(ctx, 'setTabMarkdown')(L1, 'basicLearn', '## 1. 기본\n\n또 바뀐 글입니다.');
        raw.value = '';
        call(ctx, 'saveRawContent')();
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 기본\n\n또 바뀐 글입니다.');
        assert.strictEqual(ctx.archived.length, 1);
        assert.ok(!ctx.toasts.at(-1).message.includes('작업 기록'), ctx.toasts.at(-1).message);
    });

    await run('원문 칸: 다른 기능이 탭을 바꾸며 칸도 맞췄으면 그 뒤에 고친 글은 그대로 넣는다(칸이 저장된 글과 같을 때 기준을 옮긴다)', async () => {
        const ctx = makeContext();
        const { L1 } = twoSubjects(ctx);
        const raw = openRaw(ctx, L1, 'basicLearn');
        call(ctx, 'setTabMarkdown')(L1, 'basicLearn', '## 1. 기본\n\n그림을 지운 글입니다.');
        raw.value = raw.lastSaved = L1.tabContents.basicLearn; // 그림 지우기처럼 칸만 맞추고 기준(storedFrom)은 그대로 둔 기능
        call(ctx, 'flushVisibleRawView')();
        assert.strictEqual(raw.storedFrom, L1.tabContents.basicLearn);
        raw.value += ' 고침';
        call(ctx, 'flushVisibleRawView')();
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 기본\n\n그림을 지운 글입니다. 고침');
        // 칸을 맞춘 뒤 넣기 전에 바로 고쳐도: 칸의 기준(lastSaved)이 지금 글이면 그 글 위에서 고친 것이다
        call(ctx, 'setTabMarkdown')(L1, 'basicLearn', '## 1. 기본\n\n또 그림을 지운 글입니다.');
        raw.value = raw.lastSaved = L1.tabContents.basicLearn;
        raw.value += ' 바로 고침';
        call(ctx, 'flushVisibleRawView')();
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 기본\n\n또 그림을 지운 글입니다. 바로 고침');
        assert.deepStrictEqual(ctx.archived, []);
    });

    await run('그림 지우기(실제 deleteImage): 숨은 원문 칸과 기준(storedFrom)을 지운 글로 맞춰, 저장을 기다리는 동안 칸에 쓴 글도 넣고 지운 그림은 되살리지 않는다(탭이 없는 최종 평가도)', async () => {
        const ctx = makeContext();
        const { L1, Q1 } = twoSubjects(ctx);
        const PNG = 'data:image/png;base64,iVBORw0KGgo=';
        L1.images = { img_1: PNG };
        call(ctx, 'setTabMarkdown')(L1, 'basicLearn', '## 1. 기본\n\n![그림](local:img_1)\n\n기본 글입니다.');
        Object.assign(Q1, { images: { img_q: PNG }, content: '## 과제\n\n![도식](local:img_q)\n\n교과1 최종 평가 본문입니다.' });
        // format-toolbar.js writeLessonTab과 같은 차례(탭에 넣기 → 저장 → 다시 그리기)
        ctx.writeLessonTab = async (mod, tabId, md) => {
            call(ctx, 'setTabMarkdown')(mod, tabId, md);
            await ctx.saveState();
            call(ctx, 'renderEditor')(mod);
        };
        let typing = false;
        ctx.saveState = async () => { // 지운 뒤 저장을 기다리는 동안 원문 전체 수정을 열어 쓴다
            ctx.saved += 1;
            if (typing) {
                typing = false;
                call(ctx, 'toggleEditorMode')('edit');
                rawBox(ctx).value += '\n\n저장을 기다리며 쓴 줄';
            }
            return true;
        };
        const deleteIn = async (mod, imgId) => {
            ctx.currentEditingModuleId = mod.id;
            call(ctx, 'renderEditor')(mod);
            typing = true;
            await ctx.deleteImage(imgId);
        };
        await deleteIn(L1, 'img_1');
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 기본\n\n기본 글입니다.\n\n저장을 기다리며 쓴 줄', '지운 글 위에 쓴 글을 넣는다');
        assert.deepStrictEqual(Object.keys(L1.images), [], '어디에도 쓰지 않게 된 그림 값은 지운다');
        await deleteIn(Q1, 'img_q');
        assert.strictEqual(Q1.content, '## 과제\n\n교과1 최종 평가 본문입니다.\n\n저장을 기다리며 쓴 줄');
        assert.strictEqual(Q1.tabContents, undefined, '탭을 만들지 않는다');
        assert.deepStrictEqual(ctx.archived, [], "그림 지우기가 맞춘 칸은 '넣지 못한 원문'으로 보지 않는다");
        assert.deepStrictEqual(ctx.toasts.map(toast => toast.kind), ['success', 'success'], JSON.stringify(ctx.toasts));
    });

    await run('원문 칸: 칸이 줄바꿈(CRLF)과 첫 빈 줄을 바꿔 담아도 저장된 글로 견주므로 다른 기능이 바꾼 것으로 보지 않는다', async () => {
        const ctx = makeContext();
        const { L1 } = twoSubjects(ctx);
        const stored = '\r\n## 1. 기본\r\n\r\n불러온 윈도우 줄바꿈 글입니다.';
        call(ctx, 'setTabMarkdown')(L1, 'basicLearn', stored);
        const raw = openRaw(ctx, L1, 'basicLearn');
        assert.strictEqual(raw.value, '## 1. 기본\n\n불러온 윈도우 줄바꿈 글입니다.', '칸은 바꿔 담는다');
        assert.strictEqual(raw.storedFrom, stored, '기준은 저장된 글 그대로');
        call(ctx, 'flushVisibleRawView')();
        assert.strictEqual(L1.tabContents.basicLearn, stored, '손대지 않은 칸은 넣지 않는다');
        raw.value += '\n\n고친 줄';
        call(ctx, 'flushVisibleRawView')();
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 기본\n\n불러온 윈도우 줄바꿈 글입니다.\n\n고친 줄');
        assert.deepStrictEqual(ctx.archived, []);
    });

    await run('원문 칸: 비어 있는 기본학습(다른 탭에만 글이 있는 차시)은 다른 탭이 그사이 바뀌어도 바뀐 것으로 보지 않고 쓴 글을 기본학습에 넣는다', async () => {
        const ctx = makeContext();
        const { L1 } = twoSubjects(ctx);
        Object.assign(L1, { tabContents: tabsOf(), content: null, gyosuan: { docMd: '# 교수안' } }); // 교수안만 있는 차시
        const raw = openRaw(ctx, L1, 'basicLearn');
        assert.deepStrictEqual([raw.value, raw.storedFrom], ['', '']);
        raw.value = '## 1. 손으로 쓴 기본\n\n강사가 쓴 기본 학습입니다.';
        call(ctx, 'setTabMarkdown')(L1, 'basicPrac', '## 1. 실습\n\nAI가 만든 실습입니다.'); // 그사이 다른 탭 만들기가 끝났다
        call(ctx, 'saveRawContent')();
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 손으로 쓴 기본\n\n강사가 쓴 기본 학습입니다.');
        assert.strictEqual(L1.tabContents.basicPrac, '## 1. 실습\n\nAI가 만든 실습입니다.');
        assert.strictEqual(raw.value, L1.tabContents.basicLearn, '칸을 다른 탭의 글로 바꾸지 않는다');
        // 비워 넣은 기본학습도 같다(칸의 기준은 다른 탭을 합친 글이 된다). 다른 탭이 바뀐 뒤 새로 쓴 글도 넣는다
        raw.value = '';
        call(ctx, 'saveRawContent')();
        assert.strictEqual(L1.tabContents.basicLearn, '');
        call(ctx, 'setTabMarkdown')(L1, 'advLearn', '## 1. 심화\n\n새 심화입니다.');
        raw.value = '## 1. 다시 쓴 기본\n\n새로 씁니다.';
        call(ctx, 'saveRawContent')();
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 다시 쓴 기본\n\n새로 씁니다.');
        assert.deepStrictEqual(ctx.archived, []);
        assert.ok(!ctx.toasts.some(toast => toast.kind === 'warning'), JSON.stringify(ctx.toasts));
        // 그사이 기본학습을 만들었으면 바뀐 것이다: 만든 글을 지키고 쓴 글은 작업 기록에 남긴다
        const other = makeContext();
        const { L1: lesson } = twoSubjects(other);
        Object.assign(lesson, { tabContents: tabsOf({ basicPrac: '## 1. 실습\n\n실습입니다.' }), content: '## 1. 실습\n\n실습입니다.' });
        const box = openRaw(other, lesson, 'basicLearn');
        box.value = '## 1. 손으로 쓴 기본\n\n쓰던 글입니다.';
        call(other, 'setTabMarkdown')(lesson, 'basicLearn', '## 1. 만든 기본\n\nAI가 만든 기본 학습입니다.');
        call(other, 'saveRawContent')();
        assert.strictEqual(lesson.tabContents.basicLearn, '## 1. 만든 기본\n\nAI가 만든 기본 학습입니다.');
        assert.deepStrictEqual(other.archived.map(item => [item.reason, item.content]), [['넣지 못한 원문', '## 1. 손으로 쓴 기본\n\n쓰던 글입니다.']]);
    });

    await run('탭 생성의 그림 단계: 옛 글을 보이던 원문 칸에 그사이 쓴 글이 새로 만든 탭을 덮지 않고 작업 기록에 남는다', async () => {
        const fresh = '## 1. 실습\n\nAI가 새로 쓴 실습입니다.';
        const ctx = makeContext({ callGemini: async (model, payload) => reply(String(payload.contents[0].parts[0].text).includes('[작업]') ? '' : fresh) });
        const { L1 } = twoSubjects(ctx);
        const raw = openRaw(ctx, L1, 'basicPrac');
        let typed = false;
        vm.runInContext('processImageTags = async (mod, md, opts) => { window.typeWhileDrawing(); return opts.latest(); };', ctx);
        ctx.typeWhileDrawing = () => { // 그림을 그리는 동안 아직 옛 실습을 보이는 칸에 쓴다
            raw.value = '## 1. 실습\n\n실습 글입니다. 강사가 덧붙임';
            typed = true;
        };
        const result = await call(ctx, 'generateTabContent')(1, 'basicPrac', { background: true, quiet: true });
        assert.ok(result.ok && typed, JSON.stringify(result));
        assert.strictEqual(L1.tabContents.basicPrac, fresh, '새로 만든 탭을 지킨다');
        assert.deepStrictEqual(ctx.archived.map(item => [item.reason, item.content]), [['넣지 못한 원문', '## 1. 실습\n\n실습 글입니다. 강사가 덧붙임']]);
        assert.strictEqual(rawBox(ctx).value, fresh, '보던 탭을 새 글로 다시 그린다');
    });

    await run('AI 명령줄 결과: 넣은 뒤 원문 칸을 새 글로 맞추고 기준도 옮긴다. 저장을 기다리는 동안 칸에 쓴 글은 넣지 못한 원문으로 남긴다', async () => {
        const ctx = makeContext();
        const { L1 } = twoSubjects(ctx);
        ctx.location = { hash: '#editor/s1/1' };
        const raw = openRaw(ctx, L1, 'basicLearn');
        const before = L1.tabContents.basicLearn;
        const selectedText = '기본 글입니다.';
        const selStart = before.indexOf(selectedText);
        const result = { kind: 'edit', target: { subjectId: 's1', moduleId: 1, tabId: 'basicLearn' }, selStart, selEnd: selStart + selectedText.length, selectedText, newText: 'AI가 고친 글입니다.' };
        ctx.onOverlay = overlay => setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: 'apply' } } }));
        let typed = false;
        ctx.saveState = async () => { // 브라우저 저장을 기다리는 동안 칸에 쓴다
            ctx.saved += 1;
            if (!typed) {
                typed = true;
                raw.value = `${before} 저장을 기다리며 쓴 줄`;
            }
            return true;
        };
        assert.strictEqual(await call(ctx, 'applyAiCommandResult')(result), true);
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 기본\n\nAI가 고친 글입니다.', 'AI 결과를 지킨다');
        assert.deepStrictEqual(ctx.archived.map(item => [item.reason, item.content]), [['넣지 못한 원문', `${before} 저장을 기다리며 쓴 줄`]]);
        assert.deepStrictEqual([raw.value, raw.storedFrom], [L1.tabContents.basicLearn, L1.tabContents.basicLearn], '칸과 기준을 새 글로 맞춘다');
        raw.value += ' 이어서 고침';
        call(ctx, 'saveRawContent')();
        assert.strictEqual(L1.tabContents.basicLearn, '## 1. 기본\n\nAI가 고친 글입니다. 이어서 고침', '맞춘 뒤에 고친 글은 넣는다');
        assert.strictEqual(ctx.archived.length, 1);
    });

    /* ---------- 다른 교과에서 그린 칸 ---------- */
    await run('원문 칸: 다른 교과로 옮긴 뒤 넣어도 그린 교과의 그 차시에 넣고, 지금 교과의 같은 번호 차시·최종 평가는 그대로 둔다', async () => {
        const ctx = makeContext();
        const { L1, L2, Q1, Q2, s2 } = twoSubjects(ctx);
        const raw = openRaw(ctx, Q1, 'basicLearn');
        assert.strictEqual(raw.dataset.subjectId, 's1');
        raw.value = Q1.content + ' 강사가 고침';
        ctx.currentSubjectId = 's2'; // 칸을 그대로 둔 채 교과2가 열렸다(예전 화면)
        ctx.courseData = s2.lessons;
        call(ctx, 'saveRawContent')();
        assert.strictEqual(Q1.content, '## 과제\n\n교과1 최종 평가 본문입니다. 강사가 고침', '그린 교과1의 최종 평가');
        assert.strictEqual(Q2.content, '## 과제\n\n교과2 최종 평가 본문입니다.', '교과2의 최종 평가는 그대로');
        assert.strictEqual(call(ctx, 'hasPendingRawEdit')(), false);
        // 차시도 같다: 교과1의 1번 차시를 그린 칸은 교과2의 1번 차시에 넣지 않는다
        ctx.currentSubjectId = 's1';
        ctx.courseData = [L1];
        const lessonRaw = openRaw(ctx, L1, 'basicLearn');
        lessonRaw.value += ' 차시 고침';
        ctx.currentSubjectId = 's2';
        ctx.courseData = s2.lessons;
        call(ctx, 'saveRawContent')();
        assert.ok(L1.tabContents.basicLearn.endsWith(' 차시 고침'));
        assert.strictEqual(L2.tabContents.basicLearn, '## 다른 글\n\n다른 교과입니다.');
    });

    await run('원문 칸: 그린 교과가 불러온 내용으로 바뀌었으면(같은 id의 새 최종 평가) 덮지 않고 넣지 못한 원문으로 남긴다', async () => {
        const ctx = makeContext();
        const { Q1, s1, s2 } = twoSubjects(ctx);
        const raw = openRaw(ctx, Q1, 'basicLearn');
        raw.value = Q1.content + ' 강사가 고침';
        const imported = { id: 'mainQuest', title: '👑 최종 평가', images: {}, content: '## 과제\n\n불러온 최종 평가입니다.' };
        s1.mainQuest = imported; // 교과1을 백업에서 불러왔다(열린 교과는 교과2)
        ctx.currentSubjectId = 's2';
        ctx.courseData = s2.lessons;
        call(ctx, 'saveRawContent')();
        assert.strictEqual(imported.content, '## 과제\n\n불러온 최종 평가입니다.', '불러온 최종 평가를 옛 칸의 글로 덮지 않는다');
        assert.deepStrictEqual(ctx.archived.map(item => [item.reason, item.lesson === imported, item.title]), [['넣지 못한 원문', true, '👑 최종 평가']]);
    });

    /* ---------- 탭이 없는 최종 평가 ---------- */
    await run('탭이 없는 최종 평가: 본문 하나로 보고 탭 단추가 없다. 탭이 있는 최종 평가와 차시는 그대로', async () => {
        const ctx = makeContext();
        const tabless = call(ctx, 'isTablessQuest');
        const bar = call(ctx, 'renderTabBar');
        const quest = { id: 'mainQuest', title: '최종 평가', content: '## 과제\n\n본문' };
        const tabbedQuest = { id: 'mainQuest', title: '최종 평가', content: '본문', tabContents: tabsOf({ basicLearn: '본문' }) };
        const lesson = { id: 3, title: '차시', tabContents: tabsOf({ basicLearn: '글' }) };
        assert.deepStrictEqual([tabless(quest), tabless(tabbedQuest), tabless(lesson), tabless(null), tabless({ id: 'mainQuest', content: null })], [true, false, false, false, true]);
        assert.strictEqual(bar(quest), '');
        assert.strictEqual((bar(tabbedQuest).match(/switchLessonTab\(/g) || []).length, 6, '이미 탭이 있는 최종 평가는 탭을 둔다(심화이해도까지 여섯 탭)');
        assert.ok(!bar(tabbedQuest).includes('showLessonPanel('), '최종 평가에는 교수안·슬라이드·문제은행 항목이 없다');
        assert.strictEqual((bar(lesson).match(/switchLessonTab\(/g) || []).length, 6);
        assert.ok(bar(lesson).includes('showLessonPanel('));
    });

    await run('탭이 없는 최종 평가: 다른 탭에 있다 열어도 기본학습 칸에 본문을 보이고 탭 생성 단추를 두지 않으며, 고친 글은 본문이 된다', async () => {
        const ctx = makeContext();
        const { Q1 } = twoSubjects(ctx);
        vm.runInContext("currentLessonTab = 'advLearn'", ctx);
        ctx.currentEditingModuleId = 'mainQuest';
        call(ctx, 'renderEditor')(Q1);
        assert.strictEqual(vm.runInContext('currentLessonTab', ctx), 'basicLearn', '기본학습으로 옮긴다');
        const html = ctx.elements['editor-content-area'].innerHTML;
        ['switchLessonTab(', 'runTabJob(', 'startLessonGeneration(', 'lesson-tab-generate'].forEach(text => assert.ok(!html.includes(text), text));
        const raw = rawBox(ctx);
        assert.deepStrictEqual([raw.dataset.tabId, raw.value], ['basicLearn', Q1.content]);
        call(ctx, 'toggleEditorMode')('edit');
        raw.value = '## 과제\n\n고친 최종 평가 본문입니다.';
        call(ctx, 'toggleEditorMode')('view');
        assert.strictEqual(Q1.content, '## 과제\n\n고친 최종 평가 본문입니다.');
        assert.strictEqual(Q1.tabContents, undefined, '탭을 만들지 않는다');
        // 이미 탭이 있는 최종 평가와 차시는 탭 생성 단추를 둔다
        const tabbed = { id: 'mainQuest', title: '최종 평가', images: {}, content: '## 과제\n\n탭 본문', tabContents: tabsOf({ basicLearn: '## 과제\n\n탭 본문' }) };
        call(ctx, 'renderEditor')(tabbed);
        const tabbedHtml = ctx.elements['editor-content-area'].innerHTML;
        assert.ok(tabbedHtml.includes('runTabJob(') && tabbedHtml.includes('startLessonGeneration(') && tabbedHtml.includes('switchLessonTab('));
    });

    await run("탭이 없는 최종 평가: 본문이 비어 보이면 '탭 생성하기' 대신 최종 평가 만들기를 보인다", () => {
        const ctx = makeContext();
        const { Q1 } = twoSubjects(ctx, { quest1: { content: '   ' } });
        ctx.currentEditingModuleId = 'mainQuest';
        call(ctx, 'renderEditor')(Q1);
        const html = ctx.elements['editor-content-area'].innerHTML;
        assert.ok(html.includes('promptAndGenerateMainQuest()') && html.includes('아직 최종 평가 내용이 없습니다'), html.slice(0, 400));
        assert.ok(!html.includes('runTabJob(') && !html.includes('탭 생성하기'));
        const prompt = call(ctx, 'emptyTabPromptHtml');
        vm.runInContext("currentLessonTab = 'advPrac'", ctx);
        assert.ok(prompt({ id: 3 }, false).includes("runTabJob('3', currentLessonTab)") && prompt({ id: 3 }, false).includes('«심화실습» 탭 생성하기'), '차시의 빈 탭은 그대로');
        assert.strictEqual(call(ctx, 'tabGenerateButtonsHtml')({ id: 'mainQuest' }, true), '');
    });

    await run('탭이 없는 최종 평가: 그래도 탭 생성에 닿으면 본문을 기본 학습 탭으로 옮겨 지키고, 기본 학습을 다시 만들면 미리 보고 작업 기록에 남긴다', async () => {
        const made = '## 1. 새로 만든 글\n\n탭 생성이 쓴 글입니다.';
        const ctx = makeContext({ callGemini: async (model, payload) => reply(String(payload.contents[0].parts[0].text).includes('[작업]') ? '' : made) });
        const { Q1 } = twoSubjects(ctx);
        const body = Q1.content;
        ctx.currentEditingModuleId = 'mainQuest';
        const result = await call(ctx, 'generateTabContent')('mainQuest', 'basicPrac', { background: true, quiet: true });
        assert.ok(result.ok, JSON.stringify(result));
        assert.deepStrictEqual([Q1.tabContents.basicLearn, Q1.tabContents.basicPrac], [body, made], '본문은 기본 학습 탭에 남는다');
        assert.ok(Q1.content.includes(body) && Q1.content.includes(made));
        const ctx2 = makeContext({ callGemini: async (model, payload) => reply(String(payload.contents[0].parts[0].text).includes('[작업]') ? '' : made) });
        const { Q1: quest } = twoSubjects(ctx2);
        const questBody = quest.content;
        ctx2.currentEditingModuleId = 'mainQuest';
        let previewed = 0;
        ctx2.onOverlay = overlay => { previewed += 1; setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: 'apply' } } })); };
        const again = await call(ctx2, 'generateTabContent')('mainQuest', 'basicLearn', { background: true });
        assert.ok(again.ok, JSON.stringify(again));
        assert.strictEqual(previewed, 1, '있던 본문을 바꾸기 전에 미리 보인다');
        assert.deepStrictEqual(ctx2.archived.map(item => [item.reason, item.content, item.tabId]), [['다시 생성 전', questBody, 'basicLearn']], '이전 본문은 작업 기록에 남는다');
    });

    console.log('ALL PASSED');
})().catch(e => { console.error('FAIL', e.message, e.stack); process.exit(1); });
