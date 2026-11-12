// 핵심 요약 상자와 💡·⚠️·✅ 상자 테스트 (실행: node tests/summary-box.test.js)
// 실제 js/lesson-summary.js와 그 상자를 쓰는 곳(생성 지시 ui.js·data.js, 그리기 api.js, 내보내기 lesson-export.js, 분량 채우기 lesson-volume.js,
// 섹션 고치기 lesson-review.js·lesson-fix-run.js, 탭 생성 tabs.js, 검수 lesson-lint.js, 지우기·접기 block-tools.js, 교수안 gyosuan.js, 예전 HTML 되살리기)을 vm에서 돌린다.
// AI 응답만 스텁이고 키는 쓰지 않는다. 처음 한 번: npm install --no-save marked@15.0.12 turndown@7.2.4
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

let Marked = null;
let domino = null;
let NodeFilter = null;
let TurndownService = null;
try {
    ({ Marked } = require('marked'));
    domino = require('@mixmark-io/domino');
    NodeFilter = require('@mixmark-io/domino/lib/NodeFilter');
    TurndownService = require('turndown');
} catch (err) {
    console.log('FAIL - marked·domino·turndown이 없습니다. 먼저 실행: npm install --no-save marked@15.0.12 turndown@7.2.4');
    process.exit(1);
}

const root = path.join(__dirname, '..', 'js');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const readRoot = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const call = (ctx, name) => vm.runInContext(name, ctx);
const plain = value => JSON.parse(JSON.stringify(value));
const reply = (text, finishReason = 'STOP') => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });

function sliceSource(source, start, end = '\n}\n') {
    const at = source.indexOf(start);
    if (at < 0) throw new Error(`소스에서 찾지 못함: ${start}`);
    return source.slice(at, source.indexOf(end, at) + end.length);
}

function ownMarked() {
    const instance = new Marked();
    return { parse: (...args) => instance.parse(...args), use: (...args) => instance.use(...args), lexer: (...args) => instance.lexer(...args) };
}

/* ---------- 글 ---------- */
const BOX = ['> 📌 **핵심 요약**', '> - 게임 루프는 입력, 갱신, 그리기를 매 프레임 되풀이합니다.', '> - 입력을 먼저 읽어야 같은 프레임에 반영됩니다.'];
const BOX2 = ['> 📌 **핵심 요약**', '> - 프레임 시간은 한 번 도는 데 걸린 시간입니다.', '> - 이동량에 프레임 시간을 곱해 속도를 맞춥니다.'];
const STALE = ['> 📌 **핵심 요약**', '> - 앞서 쓴 낡은 요약입니다.'];
const CODE = ['```python', '# 상자처럼 보이는 줄도 코드다', 'text = """', '> 📌 **핵심 요약**', '> - 코드 안 줄', '💡 코드 안 이모지', '"""', '```'];
const LESSON = [
    '# 📝 게임 루프', '',
    '## 개요', '', '- 입력을 늦게 읽으면 조작이 한 프레임 밀리는 상황입니다.', '', ...STALE, '',
    '## 학습 목표', '', '- 게임 루프의 순서를 정해 갱신 코드를 작성할 수 있습니다.', '- 프레임 시간으로 이동 속도를 맞추는 코드를 작성할 수 있습니다.', '',
    '## 1. 게임 루프의 구조 (⏱ 60분)', '', '게임 루프는 입력, 갱신, 그리기를 매 프레임 되풀이합니다.', '', ...BOX, '',
    '### ■ 순서의 의미', '', '입력을 먼저 읽어야 같은 프레임에 반영됩니다.', '', ...CODE, '', '<br>', '',
    '## 2. 프레임 시간 (⏱ 60분)', '', ...STALE, '', '프레임 시간은 한 번 도는 데 걸린 시간입니다.', '', ...BOX2, '', '<br>', '', '---', '', '<br>', '',
    '## ✅ 학습 후 체크리스트', '', '- 순서를 정했습니다. (다시 보기: 1. 게임 루프의 구조)', '- 속도를 맞췄습니다. (다시 보기: 2. 프레임 시간)'
].join('\n');
// 정리한 섹션 1·2(상자는 섹션마다 하나, 맨 끝. 끝의 <br>·구분선은 상자 뒤에 남는다)
const SECTION1 = ['## 1. 게임 루프의 구조 (⏱ 60분)', '', '게임 루프는 입력, 갱신, 그리기를 매 프레임 되풀이합니다.', '',
    '### ■ 순서의 의미', '', '입력을 먼저 읽어야 같은 프레임에 반영됩니다.', '', ...CODE, '', '<br>', '', ...BOX, '', '<br>'].join('\n');
const SECTION2 = ['## 2. 프레임 시간 (⏱ 60분)', '', '프레임 시간은 한 번 도는 데 걸린 시간입니다.', '', '<br>', '', ...BOX2, '', '<br>', '', '---', '', '<br>'].join('\n');
// 시험용 상자 떼기: 코드 블록 밖의 > 줄을 빼고 겹친 빈 줄과 <br> 간격을 하나로 줄인다(lesson-summary.js와 따로 센다)
function WITHOUT_BOXES(md) {
    let fenced = false;
    const kept = md.split('\n').filter(line => {
        if (/^```/.test(line)) fenced = !fenced;
        return fenced || /^```/.test(line) || !/^>/.test(line);
    });
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/<br>\n\n<br>/g, '<br>');
}

/* ---------- 문맥 ---------- */
// 상자 함수만(lesson-lint.js·lesson-editor-tools.js와 함께)
function summaryContext() {
    const ctx = { console: quiet, window: {} };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['lesson-lint.js', 'lesson-editor-tools.js', 'lesson-summary.js'].forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    return ctx;
}

// 실제 생성 지시(ui.js buildTaskContext). tests/tab-time.test.js의 promptContext와 같다
function promptContext() {
    const el = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
    const ctx = {
        console: quiet, JSON, Map, Set, Promise, Date,
        localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, location: { hash: '' },
        document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: { appendChild() {} } },
        globalState: { subjects: [] }, currentSubjectId: null, courseData: [], instructorTone: 'formal', getReferenceContext: () => ''
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['data.js', 'lesson-lint.js', 'course-design.js', 'ui.js'].forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    return ctx;
}

// 화면 그리기 파이프라인(api.js renderLessonHTML)과 내보내기. summary가 거짓이면 lesson-summary.js를 싣지 않는다(예전 그리기)
function renderContext({ summary = true } = {}) {
    const doc = domino.createDocument('<html><body></body></html>', true);
    patchDomino(doc);
    const ctx = {
        console: quiet, setTimeout: () => 0, clearTimeout() {}, Promise, URL, Uint16Array, Blob, AbortController,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        marked: ownMarked(), NodeFilter, document: doc,
        DOMParser: function DOMParser() { this.parseFromString = html => domino.createDocument(String(html), true); }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(sliceSource(read('ui.js'), 'function escapeHtml('), ctx);
    ['data.js', 'lesson-sanitize.js', ...(summary ? ['lesson-summary.js'] : []), 'lesson-format.js', 'lesson-export.js', 'lesson-opening.js', 'lesson-lint.js', 'checklist-links.js', 'api.js']
        .forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    return ctx;
}
const render = (ctx, md) => call(ctx, 'renderLessonHTML')(call(ctx, 'preprocessMarkdown')(md));

// 탭 생성·분량 채우기·섹션 고치기(tests/lesson-volume.test.js genContext와 같은 흉내에 lesson-summary.js를 더한다)
const GEN_FILES = ['data.js', 'ai-errors.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js',
    'lesson-review.js', 'lesson-fix-run.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js', 'course-design.js',
    'course-flow.js', 'lesson-summary.js', 'lesson-volume.js'];
function fakeElement() {
    const handlers = {};
    return {
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', title: '', disabled: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener(type, fn) { handlers[type] = fn; }, fire(type, event) { return handlers[type]?.(event); },
        querySelector: () => fakeElement(), querySelectorAll: () => [], remove() {}
    };
}
function genContext() {
    const elements = {};
    const ctx = {
        console: quiet, Promise, URL, Uint16Array, Blob, AbortController,
        localStorage: { getItem: () => null, setItem() {} },
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''),
        saveState: async () => {}, renderEditor() {}, renderSidebar() {}, showLessonView() {},
        archiveContent: async () => {},
        currentEditingModuleId: null, needsElementAutoAssign: () => false, lessonNeedsGyosuan: () => false, runGyosuanGeneration: async () => ({ ok: true }),
        alerts: [], toasts: [], prompts: [], volumeSent: [], elements,
        document: {
            readyState: 'complete', hidden: false, title: '',
            body: { appendChild: el => { if (el.id) elements[el.id] = el; } },
            createElement: fakeElement, getElementById: id => elements[id] || null,
            addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => []
        }
    };
    ctx.window = ctx;
    ctx.setTimeout = fn => setTimeout(fn, 0);
    ctx.clearTimeout = id => clearTimeout(id);
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = message => ctx.toasts.push(message);
    vm.createContext(ctx);
    GEN_FILES.forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    ctx.confirmAsync = async () => true;
    ctx.callGemini = async () => { throw new Error('호출되면 안 됨'); };
    // 분량 보강 지시에 상자가 들어갔는지(BOX)를 프롬프트에 적어 둔다
    vm.runInContext(`callGemini = (...args) => window.callGemini(...args);
        buildTaskContext = (task, a) => { if (task === 'volume_expand') window.volumeSent.push(String(a.sectionText || ''));
            return { systemInstruction: '시스템', userPrompt: [task, a.tabId, a.sectionTitle, a.requestChars, a.needCode ? 'code' : ''].join('|') }; };
        getEditingModule = (id = window.currentMod?.id) => (String(id) === String(window.currentMod?.id) ? window.currentMod : null);
        processImageTags = async (mod, md) => md;
        renderSidebar = () => {}; renderEditor = () => {};
        globalState = { subjects: [] }; currentSubjectId = null; courseData = [];`, ctx);
    ['editor-loading', 'editor-loading-text', 'editor-loading-stop', 'ai-command-input', 'lesson-volume-chip'].forEach(id => { elements[id] = fakeElement(); });
    return ctx;
}

// 섹션마다 상자 수와 상자가 맨 끝 블록인지(lesson-summary.js summaryTailStart)
function boxReport(ctx, md) {
    return plain(call(ctx, 'mdSections')(md).filter(section => section.title).map(section => {
        const lines = section.text.split('\n');
        return { title: section.title, boxes: call(ctx, 'summaryBoxSpans')(lines).length, last: call(ctx, 'summaryTailStart')(lines) >= 0 };
    }));
}

let failed = 0;
let count = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

/* ======================= 1. 생성 지시 ======================= */
test('지시: 상자 규칙은 > 📌 **핵심 요약** 다음 > - 줄 2~3개로 그 섹션을 다시 말하고, 새 사실·다른 이모지·틀 섹션 상자를 금한다', () => {
    const ctx = promptContext();
    const rule = call(ctx, 'CONTEXT_CORE').rules.section_summary;
    ['학습 탭의 내용 ## 섹션은 끝(다음 ## 제목 바로 앞)에 핵심 요약을 하나 둡니다.', '"> 📌 **핵심 요약**" 줄 다음에 "> - "로 시작하는 줄 2~3개를 쓰고, 그 섹션의 핵심을 짧은 문장으로 다시 말합니다.',
        '새 사실, 예시, 코드, 표, 그림은 넣지 않고 📌 말고 다른 이모지는 쓰지 않습니다(이 줄의 📌만 인용 표시 > 뒤에 둡니다).', '개요, 학습 정보, 학습 목표, 학습 후 체크리스트에는 두지 않습니다.']
        .forEach(part => assert.ok(rule.includes(part), part));
    assert.ok(/const EMOJI_SET = '[^']*📌/.test(read('api.js')), '📌은 이모지 후처리가 아는 아이콘이다');
});

test('지시: 학습 탭 생성·이어쓰기와 교안 전체 생성·병합만 상자를 쓰게 하고, 실습·문제은행·분량 보강·최종 평가는 쓰지 않는다', () => {
    const ctx = promptContext();
    const rule = call(ctx, 'CONTEXT_CORE').rules.section_summary;
    const build = (task, args) => call(ctx, 'buildTaskContext')(task, { title: '게임 루프', description: '루프', keyConcepts: [], targetMinutes: 480, ...args }).systemInstruction;
    const tabs = ['basicLearn', 'advLearn', 'basicPrac', 'advPrac', 'assessment', 'advAssessment'];
    assert.deepStrictEqual(tabs.map(tabId => build('tab_content', { tabId, tabLabel: tabId }).includes(rule)), [true, true, false, false, false, false]);
    assert.deepStrictEqual(tabs.map(tabId => build('tab_content_continue', { tabId, tabLabel: tabId, chunkIndex: 1, previousContent: '앞' }).includes(rule)), [true, true, false, false, false, false]);
    const volume = build('volume_expand', { tabId: 'basicLearn', tabLabel: '기본학습', outline: [], objectives: [], sectionTitle: '1. 가', sectionText: '## 1. 가', requestChars: 3000, subtopics: 2 });
    assert.ok(!volume.includes(rule), '분량 보강은 새 소주제만 쓴다(상자는 코드가 지킨다)');
    assert.ok(build('module', {}).includes(rule) && build('module_continue', { chunkIndex: 1, previousContent: '앞' }).includes(rule) && build('merge', { titles: ['가'], mergedContext: '글' }).includes(rule));
    assert.ok(!call(ctx, 'buildTaskContext')('main_quest', '차시 정보').systemInstruction.includes(rule), '최종 평가 설계에는 주지 않는다');
});

test('지시: 섹션 고치기와 탭 전체 AI 수정도 학습 탭에서는 상자를 지키게 한다(문항 모드·다른 탭은 빼고)', () => {
    const ctx = genContext();
    const rule = call(ctx, 'CONTEXT_CORE').rules.section_summary;
    const review = call(ctx, 'reviewSystemPrompt');
    assert.deepStrictEqual([review('basicLearn').includes(rule), review('advLearn').includes(rule), review('basicLearn', true).includes(rule), review('basicPrac').includes(rule), review('assessment').includes(rule)],
        [true, true, false, false, false]);
    const tabs = read('tabs.js');
    assert.ok(/learnSummary = mod\.id !== 'mainQuest' && \(tabId === 'basicLearn' \|\| tabId === 'advLearn'\)/.test(tabs) && tabs.includes("(learnSummary ? CONTEXT_CORE.rules.section_summary + '\\n- ' : '')"), '탭 전체 AI 수정 지시');
});

/* ======================= 2. 상자 정리(마크다운) ======================= */
test('정리: 섹션마다 상자를 하나(마지막 상자)만 맨 끝에 두고, 끝의 <br>·구분선은 상자 뒤에, 틀 섹션의 상자는 뺀다', () => {
    const ctx = summaryContext();
    const out = call(ctx, 'summaryBoxesLast')(LESSON, 'basicLearn');
    const sections = plain(call(ctx, 'mdSections')(out));
    assert.strictEqual(sections.find(section => section.title.startsWith('1.')).text, SECTION1);
    assert.strictEqual(sections.find(section => section.title.startsWith('2.')).text, SECTION2, '앞의 낡은 상자는 빼고 마지막 상자를 남긴다');
    assert.ok(!sections.find(section => section.title === '개요').text.includes('핵심 요약'), '개요에는 두지 않는다');
    assert.ok(out.includes('## ✅ 학습 후 체크리스트\n\n- 순서를 정했습니다.'), '체크리스트는 그대로');
    assert.strictEqual(WITHOUT_BOXES(out), WITHOUT_BOXES(LESSON), '상자 말고 다른 글은 그대로');
});

test('정리: 다시 돌려도 같은 글이고(멱등), 상자가 없거나 학습 탭이 아니거나 고정 섹션이면 한 글자도 바꾸지 않는다', () => {
    const ctx = summaryContext();
    const last = call(ctx, 'summaryBoxesLast');
    const once = last(LESSON, 'basicLearn');
    assert.strictEqual(last(once, 'basicLearn'), once);
    assert.strictEqual(last(once, 'advLearn'), once);
    const noBox = WITHOUT_BOXES(LESSON);
    assert.strictEqual(last(noBox, 'basicLearn'), noBox);
    ['basicPrac', 'advPrac', 'assessment', 'advAssessment'].forEach(tabId => assert.strictEqual(last(LESSON, tabId), LESSON, tabId));
    const locked = last(LESSON, 'basicLearn', [{ title: '1. 게임 루프의 구조 (⏱ 60분)', text: '' }]);
    const section = title => plain(call(ctx, 'mdSections')(locked)).find(item => item.title.startsWith(title)).text;
    assert.ok(section('1.').includes(`반영됩니다.\n\n${BOX.join('\n')}`.replace('반영됩니다.', '되풀이합니다.')), '고정 섹션은 상자 자리도 그대로');
    assert.strictEqual(section('2.'), SECTION2, '다른 섹션은 정리한다');
});

test('정리: 윈도 줄바꿈(CRLF) 글은 같은 줄바꿈으로 돌려주고, 코드 블록 안의 상자 모양 줄은 상자로 보지도 옮기지도 않는다', () => {
    const ctx = summaryContext();
    const crlf = LESSON.replace(/\n/g, '\r\n');
    const out = call(ctx, 'summaryBoxesLast')(crlf, 'basicLearn');
    assert.strictEqual(out, call(ctx, 'summaryBoxesLast')(LESSON, 'basicLearn').replace(/\n/g, '\r\n'));
    assert.ok(!/[^\r]\n/.test(out), 'LF만 남은 줄이 없다');
    const code = ['## 1. 코드 (⏱ 30분)', '', '설명입니다.', '', ...CODE].join('\n');
    assert.strictEqual(call(ctx, 'summaryBoxesLast')(code, 'basicLearn'), code, '코드 안 줄은 상자가 아니다');
    assert.deepStrictEqual(plain(call(ctx, 'summaryItemsOf')(code)), []);
    assert.ok(call(ctx, 'summaryBoxesLast')(LESSON, 'basicLearn').includes(CODE.join('\n')), '코드 블록은 한 글자도 그대로');
});

test('정리: 머리·항목 줄을 정해 둔 모양으로 맞추고(굵게·콜론·번호·아이콘), 그림·표 줄은 빼며, 항목이 없는 상자는 지운다', () => {
    const ctx = summaryContext();
    const messy = ['## 1. 가 (⏱ 30분)', '', '본문입니다.', '', '> **📌 핵심 요약:**', '> 1. 첫째 요약입니다.', '>   이어 쓴 줄입니다.', '> • 💡 둘째 요약입니다.', '> <!-- [IMG: "그림"] -->', '> ![](local:img_1)'].join('\n');
    assert.strictEqual(call(ctx, 'summaryBoxesLast')(messy, 'basicLearn'),
        ['## 1. 가 (⏱ 30분)', '', '본문입니다.', '', '<br>', '', '> 📌 **핵심 요약**', '> - 첫째 요약입니다. 이어 쓴 줄입니다.', '> - 둘째 요약입니다.'].join('\n'));
    const empty = ['## 1. 가 (⏱ 30분)', '', '본문입니다.', '', '> 📌 **핵심 요약**', '>', '> <img src="x">'].join('\n');
    assert.strictEqual(call(ctx, 'summaryBoxesLast')(empty, 'basicLearn'), '## 1. 가 (⏱ 30분)\n\n본문입니다.\n');
    const sentences = ['## 1. 가', '', '본문입니다.', '', '> 📌 **핵심 요약**', '> 첫 문장입니다.', '> 둘째 문장입니다.'].join('\n');
    assert.ok(call(ctx, 'summaryBoxesLast')(sentences, 'basicLearn').endsWith('> - 첫 문장입니다.\n> - 둘째 문장입니다.'), '목록 기호가 없으면 줄마다 항목');
});

test('정리: 섹션 고치기(keepSectionSummary)는 빠뜨린 상자를 되붙이고, 겹친 상자는 하나로, 없던 상자는 빼며 다시 돌려도 같다', () => {
    const ctx = summaryContext();
    const keep = call(ctx, 'keepSectionSummary');
    const before = SECTION1;
    const dropped = WITHOUT_BOXES(SECTION1);
    assert.strictEqual(keep(before, dropped), SECTION1, '빠뜨린 상자를 끝(끝의 <br> 앞)에 되붙인다');
    assert.strictEqual(keep(before, SECTION1.replace(BOX.join('\n'), '').replace(/\n{3,}/g, '\n\n')), SECTION1, '상자만 지우고 앞뒤 <br>을 남긴 답도 같다');
    const twice = `${BOX.join('\n')}\n\n${SECTION1}`;
    assert.strictEqual(call(ctx, 'summaryBoxSpans')(keep(before, twice).split('\n')).length, 1);
    assert.ok(keep(before, twice).endsWith(`${BOX.join('\n')}\n\n<br>`));
    const plainSection = '## 3. 그리기 (⏱ 30분)\n\n그리기는 마지막입니다.';
    assert.strictEqual(keep(plainSection, `${plainSection}\n\n${BOX.join('\n')}`), `${plainSection}\n`, '원래 없던 상자는 더하지 않는다');
    assert.strictEqual(keep(plainSection, plainSection), plainSection);
    assert.strictEqual(keep(before, keep(before, dropped)), keep(before, dropped));
});

test('받은 글 정리: AI 답 정리(extractText·sanitizeMarkdownContent)가 상자 줄을 인용 밖으로 떼지 않는다(이모지·마침표 줄바꿈·라벨 콜론)', () => {
    const ctx = genContext();
    const extracted = call(ctx, 'extractText')(reply('본문입니다.\n\n> 📌 **핵심 요약**\n> - 루프는 되풀이합니다. 순서가 중요합니다.\n> - 둘째 요약입니다.'));
    assert.strictEqual(extracted, '본문입니다.\n\n> 📌 **핵심 요약**\n> - 루프는 되풀이합니다.\n> 순서가 중요합니다.\n> - 둘째 요약입니다.');
    assert.deepStrictEqual(plain(call(ctx, 'summaryItemsOf')(extracted)), ['루프는 되풀이합니다. 순서가 중요합니다.', '둘째 요약입니다.'], '나뉜 줄은 앞 항목에 잇는다');
    assert.strictEqual(call(ctx, 'extractText')(reply('설명입니다. 💡 팁입니다.')), '설명입니다.\n💡 팁입니다.', '인용이 아닌 줄은 예전과 같다');
    const colon = call(ctx, 'sanitizeMarkdownContent')('본문입니다.\n\n> 📌 **핵심 요약:**\n> - 첫째입니다.');
    assert.ok(colon.includes('> 📌 **핵심 요약:**\n> - 첫째입니다.'), colon);
    assert.ok(call(ctx, 'summaryBoxesLast')(`## 1. 가\n\n${colon}`, 'basicLearn').endsWith('> 📌 **핵심 요약**\n> - 첫째입니다.'));
});

/* ======================= 3. 그리기와 내보내기 ======================= */
const VIEW_MD = [
    '## 1. 게임 루프의 구조 (⏱ 60분)', '', '게임 루프는 입력, 갱신, 그리기를 매 프레임 되풀이합니다.', '',
    '💡 **핵심:** 입력을 먼저 읽습니다.', '', '⚠️ 순서를 바꾸면 한 프레임 늦습니다.', '', '✅ 확인할 것', '- 입력', '- 갱신', '',
    '설명 문장입니다. 💡 문장 중간의 이모지는 상자가 아닙니다.', '', ...CODE, '', '<br>', '', ...BOX, '', '<br>', '',
    '## ✅ 학습 후 체크리스트', '', '- 순서를 정했습니다. (다시 보기: 1. 게임 루프의 구조)'
].join('\n');
const CLASS_ATTRS = / class="(?:lesson-summary|lesson-summary-head|lesson-callout lesson-callout-(?:key|warn|check))"/g;

test('그리기: 상자는 머리 문단과 목록을 담은 blockquote.lesson-summary 하나로, 💡·⚠️·✅ 문단은 lesson-callout으로 그린다', () => {
    const ctx = renderContext();
    const html = render(ctx, VIEW_MD);
    assert.strictEqual((html.match(/<blockquote class="lesson-summary">/g) || []).length, 1, html);
    assert.ok(/<blockquote class="lesson-summary">\s*<p class="lesson-summary-head">📌 <strong>핵심 요약<\/strong><\/p>\s*<ul>\s*<li>게임 루프는[^<]*<\/li>\s*<li>입력을 먼저[^<]*<\/li>\s*<\/ul>\s*<\/blockquote>/.test(html), html);
    assert.ok(html.includes('<p class="lesson-callout lesson-callout-key">💡 <strong>핵심</strong>'), '💡');
    assert.ok(html.includes('<p class="lesson-callout lesson-callout-warn">⚠️ 순서를'), '⚠️');
    assert.ok(/<p class="lesson-callout lesson-callout-check">✅ 확인할 것<\/p>\s*<ul>/.test(html), '✅ 뒤 목록은 CSS가 같은 상자로 잇는다');
    assert.ok(!/class="lesson-callout[^"]*">설명 문장/.test(html), '문장 중간 이모지 문단은 상자가 아니다');
});

test('그리기: class만 붙인다. 떼면 예전 그리기와 한 글자도 같다(블록 수·글자·코드 블록 그대로, 코드 안에는 class가 없다)', () => {
    const now = render(renderContext(), VIEW_MD);
    const before = render(renderContext({ summary: false }), VIEW_MD);
    assert.strictEqual(now.replace(CLASS_ATTRS, ''), before);
    const pres = html => html.match(/<pre\b[\s\S]*?<\/pre>/g) || [];
    assert.deepStrictEqual(pres(now), pres(before));
    assert.ok(pres(now).length === 1 && !pres(now)[0].includes('class="lesson-summary') && pres(now)[0].includes('💡 코드 안 이모지'));
    const top = html => domino.createDocument(`<body>${html}</body>`, true).body.children.length;
    assert.strictEqual(top(now), top(before), '화면 블록 수가 같다(두 번 눌러 고치기·지우기 단추가 맞는다)');
});

test('그리기: 상자 안 글도 정리를 거친다(스크립트·핸들러 없음). 체크리스트 다시 보기 링크는 상자가 있는 섹션으로도 달린다', () => {
    const ctx = renderContext();
    const md = VIEW_MD.replace('> - 입력을 먼저 읽어야 같은 프레임에 반영됩니다.', '> - <script>alert(1)</script><img src=x onerror="alert(1)"> 요약입니다.');
    const html = render(ctx, md);
    assert.ok(!/<script/i.test(html) && !/onerror/i.test(html), html);
    assert.ok(/<a href="#lesson-sec-1" class="lesson-check-link">1\. 게임 루프의 구조<\/a>/.test(render(ctx, VIEW_MD)), '다시 보기 링크');
});

test('내보내기: HTML·PDF 문서에도 같은 class가 남고, 문서 서식에 상자·인쇄 규칙이 있다. 화면 CSS와 새 script 태그(?v=125)도 있다', async () => {
    const ctx = renderContext();
    const mod = { id: 3, title: '게임 루프', images: {}, content: '', tabContents: { basicLearn: VIEW_MD, basicPrac: null, advLearn: null, advPrac: null, assessment: null, advAssessment: null } };
    vm.runInContext('getEditingModule = () => null; currentLessonTab = "basicLearn";', ctx);
    const body = await call(ctx, 'lessonExportBody')(mod, ['basicLearn'], {});
    assert.ok(body.html.includes('<blockquote class="lesson-summary">') && body.html.includes('<p class="lesson-callout lesson-callout-warn">'), body.html.slice(0, 400));
    const css = call(ctx, 'LESSON_EXPORT_CSS');
    ['blockquote.lesson-summary {', 'blockquote.lesson-summary > p.lesson-summary-head', 'p.lesson-callout {', 'p.lesson-callout-key, p.lesson-callout-key + ul', 'p.lesson-callout-warn', 'p.lesson-callout-check',
        'p.lesson-callout + ul, p.lesson-callout + ol', 'p.lesson-callout { break-inside: avoid; }', 'print-color-adjust: exact'].forEach(rule => assert.ok(css.includes(rule), rule));
    const html = readRoot('index.html');
    ['.markdown-body blockquote.lesson-summary {', '.markdown-body p.lesson-callout-key', '.markdown-body p.lesson-callout-warn', '.markdown-body p.lesson-callout-check', '.markdown-body p.lesson-callout:has(+ ul, + ol)']
        .forEach(rule => assert.ok(html.includes(rule), rule));
    const scripts = [...html.matchAll(/<script src="\.\/js\/([\w./-]+)\.js\?v=(\d+)"><\/script>/g)].map(match => [match[1], match[2]]);
    const at = scripts.findIndex(([name]) => name === 'lesson-summary');
    assert.ok(at > 0 && scripts[at - 1][0] === 'lesson-sanitize' && scripts[at][1] === '125', JSON.stringify(scripts[at]));
    assert.deepStrictEqual([...new Set(scripts.map(([, v]) => v))], ['125'], '다른 ?v=는 그대로');
});

test('예전 HTML 되살리기: 그릴 때만 붙인 상자 class는 떼고 마크다운 인용·문단으로 돌아온다', () => {
    const ctx = renderContext();
    vm.runInContext(read('output-old-html.js'), ctx, { filename: 'output-old-html.js' });
    const doc = domino.createDocument(`<body><section>${render(ctx, VIEW_MD)}</section></body>`, true);
    const section = doc.querySelector('section');
    call(ctx, 'oldHtmlTidy')(section);
    assert.ok(!section.querySelector('.lesson-summary, .lesson-summary-head, .lesson-callout'));
    const md = call(ctx, 'oldHtmlMarkdown')(call(ctx, 'oldHtmlService')(TurndownService), section, { restore: text => text });
    assert.ok(/> 📌 \*\*핵심 요약\*\*/.test(md) && !md.includes('<p class='), md);
});

/* ======================= 4. 분량 채우기 ======================= */
test('분량 채우기: 새 소주제는 섹션 끝 상자 앞에 넣고(몇 번을 넣어도 상자가 맨 끝), 상자가 없는 섹션은 예전과 같다', () => {
    const ctx = genContext();
    const append = call(ctx, 'appendToSection');
    const md = `${SECTION1}\n\n## 2. 다음 (⏱ 30분)\n\n둘째입니다.`;
    const once = append(md, 0, '### ■ 보강 1\n\n새 글 하나입니다.');
    const twice = append(once, 0, '### ■ 보강 2\n\n새 글 둘입니다.');
    const first = plain(call(ctx, 'mdSections')(twice))[0].text;
    assert.ok(first.endsWith(`<br>\n\n### ■ 보강 1\n\n새 글 하나입니다.\n\n<br>\n\n### ■ 보강 2\n\n새 글 둘입니다.\n\n<br>\n\n${BOX.join('\n')}\n\n<br>`), first.slice(-300));
    assert.deepStrictEqual(boxReport(ctx, twice).map(row => [row.boxes, row.last]), [[1, true], [0, false]]);
    assert.strictEqual(call(ctx, 'summaryBoxesLast')(twice, 'basicLearn'), twice, '넣은 글은 이미 정리한 모양이다');
    const legacy = '## 1. 가 (⏱ 30분)\n\n본문입니다.\n\n<br>\n\n## 2. 나 (⏱ 30분)\n\n둘째입니다.';
    assert.strictEqual(append(legacy, 0, '### ■ 새 소주제\n\n새 글입니다.'), '## 1. 가 (⏱ 30분)\n\n본문입니다.\n\n<br>\n\n### ■ 새 소주제\n\n새 글입니다.\n\n<br>\n\n## 2. 나 (⏱ 30분)\n\n둘째입니다.');
    const rebased = call(ctx, 'rebaseVolumeParts')(md, [{ key: call(ctx, 'lockTitleKey')('1. 게임 루프의 구조'), text: '### ■ 다시 붙인 소주제\n\n글입니다.' }], { targetMinutes: 60 });
    assert.ok(boxReport(ctx, rebased)[0].last && rebased.indexOf('다시 붙인 소주제') < rebased.lastIndexOf('> 📌 **핵심 요약**'), '채우는 동안 바뀐 글에 다시 붙여도 상자 앞');
});

test('분량 채우기: AI에게 보내는 섹션에서 상자를 빼고, 받은 소주제에 상자가 있으면 뗀다', () => {
    const ctx = genContext();
    const clean = call(ctx, 'cleanVolumeAddition')(reply(`### ■ 새 소주제\n\n새 글입니다.\n\n${BOX.join('\n')}\n\n### ■ 둘째 소주제\n\n둘째 글입니다.`), { sectionText: SECTION1 });
    assert.strictEqual(clean, '### ■ 새 소주제\n\n새 글입니다.\n\n### ■ 둘째 소주제\n\n둘째 글입니다.');
    assert.strictEqual(call(ctx, 'withoutSummaryBoxes')(SECTION1).replace(/<br>\n\n<br>/g, '<br>'), WITHOUT_BOXES(SECTION1));
    assert.ok(call(ctx, 'withoutSummaryBoxes')(SECTION1).includes(CODE.join('\n')), '코드 블록 안의 상자 모양 줄은 그대로');
});

test('탭 생성: 초안 상자를 정리하고, 분량을 채우고 섹션을 고친 뒤에도 내용 섹션마다 상자는 하나·맨 끝이며 보낸 섹션에는 상자가 없다', async () => {
    const FILL = '가나다라마바사아자차. ';
    const filler = n => FILL.repeat(Math.ceil(n / FILL.length)).slice(0, n).trim();
    const box = i => [`> 📌 **핵심 요약**`, `> - 내용 ${i + 1}의 첫째 핵심입니다.`, `> - 내용 ${i + 1}의 둘째 핵심입니다.`].join('\n');
    const labels = [60, 60, 45, 60, 60, 45, 60, 60];
    const body = i => (i === 0 ? `앞에서 다룬 반복입니다. ${filler(2400)}\n\n${box(i)}` : i === 1 ? `${box(i)}\n\n${filler(2400)}` : `${filler(2400)}\n\n${box(i)}`);
    const draft = [
        '# 📝 반복과 합계',
        '## 학습 목표\n\n- 반복문으로 합계를 구하는 코드를 작성할 수 있습니다.\n- 조건에 맞는 값을 골라 세는 코드를 작성할 수 있습니다.',
        `## 개요 (⏱ 10분)\n\n- 값을 하나씩 더해야 하는 상황입니다.\n\n${box(9)}`,
        ...labels.map((minutes, i) => `## ${i + 1}. 내용 ${i + 1} (⏱ ${minutes}분)\n\n${body(i)}\n\n<br>`),
        '## ✅ 학습 후 체크리스트\n\n- 합계를 구했습니다. (다시 보기: 1. 내용 1)\n- 값을 골라 셌습니다. (다시 보기: 2. 내용 2)'
    ].join('\n\n');
    const ctx = genContext();
    const mod = { id: 1, title: '반복과 합계', description: '합계를 구합니다.', tabContents: {} };
    ctx.currentMod = mod;
    let k = 0;
    let fixes = 0;
    ctx.callGemini = async (model, payload) => {
        const text = payload.contents[0].parts[0].text;
        ctx.prompts.push(text);
        const [task, , , requestChars] = text.split('|');
        if (task === 'tab_content') return reply(`${draft}\n<!-- END -->`);
        if (task === 'volume_expand') {
            k += 1;
            const extra = k === 1 ? '\n\n> 📌 **핵심 요약**\n> - 보강 답에 딸려 온 요약입니다.' : ''; // 첫 보강 답에는 AI가 상자를 써 넣었다
            return reply(`### ■ 보강 ${k}\n\n${filler(Math.round(Number(requestChars) * 0.8))}${extra}`);
        }
        // 섹션 고치기: 지적은 고치지만 상자를 빠뜨린 답
        fixes += 1;
        const sent = text.slice(text.indexOf('[고칠 섹션]\n') + '[고칠 섹션]\n'.length);
        return reply(sent.split('\n').filter(line => !line.startsWith('>')).join('\n').replace('앞에서 다룬 반복입니다.', '반복을 다룹니다.'));
    };
    const result = plain(await call(ctx, 'generateTabContent')(1, 'basicLearn', { quiet: true }));
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    const saved = mod.tabContents.basicLearn;
    assert.ok(fixes >= 1 && !saved.includes('앞에서 다룬'), '섹션을 고쳤다');
    const rows = boxReport(ctx, saved);
    const content = rows.filter(row => /^\d\. 내용/.test(row.title));
    assert.strictEqual(content.length, 8);
    content.forEach(row => assert.deepStrictEqual([row.boxes, row.last], [1, true], row.title));
    assert.ok(rows.filter(row => !/^\d\. 내용/.test(row.title)).every(row => row.boxes === 0), '개요·학습 목표·체크리스트에는 상자가 없다');
    assert.ok(k > 3, `분량을 채웠다(${k})`);
    call(ctx, 'mdSections')(saved).filter(section => /^\d\. 내용/.test(section.title)).forEach(section => {
        const at = section.text.indexOf('> 📌 **핵심 요약**');
        assert.ok(!section.text.slice(at).includes('### ■ 보강'), `${section.title}: 새 소주제는 상자 앞`);
    });
    assert.ok(saved.includes('> - 내용 1의 첫째 핵심입니다.'), '고친 섹션에 원래 상자를 되붙였다');
    assert.ok(!saved.includes('보강 답에 딸려 온 요약'), 'AI가 소주제에 써 넣은 상자는 뗐다');
    assert.ok(!saved.includes('내용 10의 첫째'), '개요의 상자는 뺐다');
    assert.ok(ctx.volumeSent.length > 3 && ctx.volumeSent.every(text => !text.includes('핵심 요약')), '분량 보강에 보낸 섹션에는 상자가 없다');
    assert.strictEqual(call(ctx, 'summaryBoxesLast')(saved, 'basicLearn'), saved, '저장한 글은 이미 정리한 모양이다');
});

/* ======================= 5. 섹션 고치기 ======================= */
test('섹션 고치기: 고친 답이 상자를 빠뜨리거나 겹치면 원래 상자 하나를 맨 끝에 두고, 없던 섹션에 더한 상자는 뺀다', () => {
    const ctx = genContext();
    const md = ['## 학습 목표', '', '- 게임 루프의 순서를 정해 갱신 코드를 작성할 수 있습니다.', '', SECTION1.replace('게임 루프는 입력', '앞에서 배운 게임 루프는 입력'), '',
        '## 3. 그리기 (⏱ 30분)', '', '앞서 그리기는 마지막입니다.'].join('\n');
    const issues = plain(call(ctx, 'lintLessonMarkdown')(md, 'basicLearn')).filter(issue => issue.sev === 'bad' && !issue.missing);
    const plan = call(ctx, 'pickFixSections')(md, issues, []);
    assert.strictEqual(plan.targets.length, 2);
    const third = `## 3. 그리기 (⏱ 30분)\n\n그리기는 마지막입니다.\n\n${BOX2.join('\n')}`; // 원래 상자가 없던 섹션에 AI가 상자를 더했다
    const merged = call(ctx, 'mergeSectionFix')(md, `${WITHOUT_BOXES(SECTION1)}\n\n${third}`, plan.targets).md;
    const rows = boxReport(ctx, merged);
    assert.deepStrictEqual(rows.map(row => [row.title.slice(0, 2), row.boxes, row.last]), [['학습', 0, false], ['1.', 1, true], ['3.', 0, false]]);
    assert.strictEqual(plain(call(ctx, 'mdSections')(merged))[1].text, SECTION1, '빠뜨린 상자를 되붙였다');
    const doubledSection = SECTION1.replace('되풀이합니다.\n\n', `되풀이합니다.\n\n${BOX.join('\n')}\n\n`);
    const doubled = call(ctx, 'mergeSectionFix')(md, `${doubledSection}\n\n${third}`, plan.targets).md;
    assert.strictEqual(plain(call(ctx, 'mdSections')(doubled))[1].text, SECTION1, '겹친 상자는 하나로');
});

/* ======================= 6. 검수·낭독·시간 ======================= */
test('검수: 상자는 지적을 늘리지 않고(구조 수·필수·권장 같음), (⏱) 합계도 같다. 상자 글은 낭독 분량에 센다', () => {
    const ctx = genContext();
    const boxed = call(ctx, 'summaryBoxesLast')(LESSON, 'basicLearn');
    const bare = WITHOUT_BOXES(LESSON);
    const lint = md => plain(call(ctx, 'lintLessonMarkdown')(md, 'basicLearn')).map(issue => `${issue.sev}|${issue.where}|${issue.msg}`).filter(line => !line.includes('지칭')).sort();
    assert.deepStrictEqual(lint(boxed), lint(bare));
    assert.ok(!lint(boxed).some(line => line.startsWith('bad')), lint(boxed).join('\n'));
    assert.deepStrictEqual(plain(call(ctx, 'lessonStructureStats')(boxed)), plain(call(ctx, 'lessonStructureStats')(bare)));
    assert.strictEqual(call(ctx, 'volumeLabelSum')(boxed), call(ctx, 'volumeLabelSum')(bare));
    assert.deepStrictEqual(plain(call(ctx, 'practiceLabelMinutes')(boxed)), plain(call(ctx, 'practiceLabelMinutes')(bare)));
    const spoken = call(ctx, 'spokenText');
    assert.ok(spoken(BOX.join('\n')) === '핵심 요약 게임 루프는 입력, 갱신, 그리기를 매 프레임 되풀이합니다. 입력을 먼저 읽어야 같은 프레임에 반영됩니다.', spoken(BOX.join('\n')));
    assert.ok(call(ctx, 'spokenChars')(boxed) > call(ctx, 'spokenChars')(bare));
});

/* ======================= 7. 지우기·접기 ======================= */
// tests/block-tools.test.js와 같은 보기 화면 흉내에 lesson-summary.js를 더한다
const TOOL_FILES = ['data.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js',
    'lesson-review.js', 'lesson-sanitize.js', 'lesson-summary.js', 'lesson-format.js', 'lesson-export.js', 'format-toolbar.js', 'md-toolbar.js',
    'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js', 'image-slot-place.js', 'block-tools.js'];
const toAttr = key => `data-${String(key).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
function patchDomino(doc) {
    [doc.querySelectorAll('x'), doc.body.children, doc.body.childNodes, doc.createElement('div').querySelectorAll('x')].forEach(list => {
        const proto = Object.getPrototypeOf(list);
        if (!proto.forEach) Object.defineProperty(proto, 'forEach', { configurable: true, value(fn, self) { for (let i = 0; i < this.length; i++) fn.call(self, this.item(i), i, this); } });
        if (!proto[Symbol.iterator]) Object.defineProperty(proto, Symbol.iterator, { configurable: true, * value() { for (let i = 0; i < this.length; i++) yield this.item(i); } });
    });
    const htmlProto = Object.getPrototypeOf(Object.getPrototypeOf(doc.createElement('div')));
    if (!Object.getOwnPropertyDescriptor(htmlProto, 'dataset')) {
        Object.defineProperty(htmlProto, 'dataset', {
            configurable: true,
            get() {
                const el = this;
                return new Proxy({}, {
                    get: (t, key) => (typeof key === 'string' && el.hasAttribute(toAttr(key)) ? el.getAttribute(toAttr(key)) : undefined),
                    set: (t, key, value) => { el.setAttribute(toAttr(key), String(value)); return true; },
                    has: (t, key) => typeof key === 'string' && el.hasAttribute(toAttr(key)),
                    deleteProperty: (t, key) => { el.removeAttribute(toAttr(key)); return true; }
                });
            }
        });
    }
    if (!Object.getOwnPropertyDescriptor(htmlProto, 'hidden')) {
        Object.defineProperty(htmlProto, 'hidden', { configurable: true, get() { return this.hasAttribute('hidden'); }, set(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); } });
    }
    if (!htmlProto.getBoundingClientRect) {
        Object.defineProperty(htmlProto, 'getBoundingClientRect', { configurable: true, value() { return this._rect || { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; } });
    }
}
function layout(view) {
    let y = 100;
    for (const el of view.children) {
        el._rect = { top: y, bottom: y + 60, left: 100, right: 900, width: 800, height: 60 };
        y += 80;
    }
}
function toolContext(mod) {
    const doc = domino.createDocument('<html><body><div id="editor-content-area"><div id="lesson-page"><div id="render-view" class="markdown-body"></div><textarea id="raw-view" class="hidden"></textarea></div></div></body></html>', true);
    patchDomino(doc);
    const ctx = {
        console: quiet, document: doc, Promise, URL, Blob, AbortController, Proxy, setTimeout, clearTimeout, atob, btoa, Uint8Array, ArrayBuffer,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        marked: ownMarked(), NodeFilter, innerWidth: 1400,
        DOMParser: function DOMParser() { this.parseFromString = html => domino.createDocument(String(html), true); },
        currentMod: mod, toasts: [], alerts: [], archived: []
    };
    ctx.window = ctx;
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.saveState = async () => true;
    ctx.archiveContent = async (entry, reason) => { ctx.archived.push({ content: entry.content, reason }); };
    ctx.renderSidebar = () => {};
    ctx.syncGyosuanView = () => {};
    ctx.DBManager = { getCache: async () => null, setCache: async () => {} };
    vm.createContext(ctx);
    vm.runInContext(sliceSource(read('ui.js'), 'function escapeHtml('), ctx);
    TOOL_FILES.forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    vm.runInContext(`globalState = { subjects: [{ id: 's1', title: '교과', lessons: [window.currentMod] }] }; currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons;
        currentEditingModuleId = window.currentMod.id; currentLessonTab = 'basicLearn'; _lessonPanel = null;
        getEditingModule = (id = currentEditingModuleId) => (String(id) === String(window.currentMod?.id) ? window.currentMod : null);
        renderEditor = mod => window.drawView(mod); renderSidebar = () => {};`, ctx);
    ctx.drawView = target => {
        const raw = doc.getElementById('raw-view');
        raw.value = vm.runInContext('getActiveTabSource', ctx)(target);
        raw.setAttribute('data-module-id', String(target.id));
        raw.setAttribute('data-tab-id', 'basicLearn');
        vm.runInContext("toggleEditorMode('view')", ctx);
        layout(doc.getElementById('render-view'));
    };
    ctx.drawView(mod);
    return ctx;
}
const fire = (ctx, target, type) => {
    const event = ctx.document.createEvent('Event');
    event.initEvent(type, true, true);
    target.dispatchEvent(event);
};
const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(resolve => setImmediate(resolve)); };

test('지우기·접기: 상자는 화면 블록 하나라 X로 그 상자만 원문에서 빼고(작업 기록·Ctrl+Z), 접기도 그 블록만 접는다', async () => {
    const md = ['# 📝 게임 루프', '', '## 학습 목표', '', '- 게임 루프의 순서를 정해 갱신 코드를 작성할 수 있습니다.', '', SECTION1, '', '## 2. 다음 (⏱ 30분)', '', '둘째입니다.', ''].join('\n');
    const mod = { id: 7, title: '게임 루프', images: {}, content: md, tabContents: { basicLearn: md, basicPrac: null, advLearn: null, advPrac: null, assessment: null, advAssessment: null } };
    const ctx = toolContext(mod);
    const view = ctx.document.getElementById('render-view');
    const box = [...view.children].find(el => el.nodeName === 'BLOCKQUOTE');
    assert.ok(box && box.getAttribute('class') === 'lesson-summary' && box.textContent.includes('핵심 요약'), view.innerHTML.slice(0, 300));
    const located = call(ctx, 'locateLessonBlock')(md, call(ctx, 'blockRemovePart')(view, box));
    assert.ok(located && located.raw.startsWith(BOX.join('\n')), `두 번 눌러 고치기도 상자 원문을 찾는다: ${JSON.stringify(located)}`);
    fire(ctx, box, 'mousemove');
    const bar = ctx.document.getElementById('block-tools');
    assert.ok(bar && !bar.hidden, '상자에도 단추가 뜬다');
    fire(ctx, bar.querySelector('[data-block-tool="fold"]'), 'click');
    await settle();
    const folded = [...view.children].find(el => el.nodeName === 'BLOCKQUOTE');
    assert.ok(folded.getAttribute('class').includes('block-folded') && mod.foldedBlocks?.basicLearn?.length === 1, '접기');
    fire(ctx, folded, 'mousemove');
    fire(ctx, bar.querySelector('[data-block-tool="delete"]'), 'click');
    await settle();
    const after = mod.tabContents.basicLearn;
    assert.ok(!after.includes('> - 게임 루프는') && after.includes('### ■ 순서의 의미') && after.includes(CODE.join('\n')) && after.includes('## 2. 다음'), `${JSON.stringify(ctx.toasts)}\n${after}`);
    assert.deepStrictEqual(ctx.archived.map(item => [item.reason, item.content === md]), [['단락 지우기 전', true]]);
    call(ctx, 'formatUndo')({ preventDefault() {} });
    await settle();
    assert.strictEqual(mod.tabContents.basicLearn, md, 'Ctrl+Z로 되돌린다');
});

/* ======================= 8. 교수안·슬라이드·판서 ======================= */
function gyosuanContext({ summary = true } = {}) {
    const ctx = {
        console: quiet, setTimeout, clearTimeout, Promise, URL, encodeURIComponent,
        localStorage: { getItem: () => null, setItem() {} }, instructorTone: 'formal', getReferenceContext: () => '',
        globalState: { subjects: [] }, document: { addEventListener() {}, getElementById: () => null, createElement: () => ({}) }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['data.js', 'lesson-lint.js', ...(summary ? ['lesson-summary.js'] : []), 'gyosuan.js', 'gyosuan-deck-tidy.js'].forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    return ctx;
}

test('슬라이드: 상자 항목은 [핵심 요약]으로 따로 주어 핵심 메시지로 쓰게 하고 원고에서는 뺀다. 상자가 없는 섹션의 지시는 예전과 같다', () => {
    const ctx = gyosuanContext();
    const { sections } = plain(call(ctx, 'splitLessonSections')([{ text: call(ctx, 'summaryBoxesLast')(LESSON, 'basicLearn'), practice: false }]));
    const first = sections.find(section => section.title.startsWith('게임 루프의 구조'));
    const prompt = call(ctx, 'buildSectionPrompt')(first, 'presentation');
    assert.ok(prompt.includes(`[핵심 요약]\n- 게임 루프는 입력, 갱신, 그리기를 매 프레임 되풀이합니다.\n- 입력을 먼저 읽어야 같은 프레임에 반영됩니다.\n[원고]\n`), prompt.slice(-600));
    assert.ok(prompt.includes(call(ctx, 'GYOSUAN_SUMMARY_RULE')));
    assert.ok(!prompt.slice(prompt.lastIndexOf('[원고]\n')).includes('핵심 요약'), '원고에는 상자를 두 번 넣지 않는다');
    const bare = { title: '그리기', minutes: 30, practice: false, text: '그리기는 마지막입니다. 화면을 지우고 다시 그립니다.\n' };
    assert.strictEqual(call(ctx, 'buildSectionPrompt')(bare, 'presentation'), call(gyosuanContext({ summary: false }), 'buildSectionPrompt')(bare, 'presentation'));
    assert.ok(!call(ctx, 'buildSectionPrompt')(bare, 'detailed').includes('[핵심 요약]'));
});

test('판서 영상·문제은행: 상자 글은 학습 탭 글 그대로 넘어간다(따로 바꾸지 않는다)', () => {
    const ctx = { console: quiet, window: {}, globalState: { subjects: [] } };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['data.js', 'lesson-lint.js', 'whiteboard-link.js'].forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    const md = call(ctx, 'whiteboardPlainMarkdown')(SECTION1);
    assert.ok(md.includes('> 📌 **핵심 요약**') && md.includes('> - 게임 루프는'), md.slice(-300));
});

(async () => {
    for (const { name, fn } of pending) {
        count += 1;
        try {
            await fn();
            console.log(`ok - ${name}`);
        } catch (err) {
            failed += 1;
            console.log(`FAIL - ${name}\n  ${err.stack || err.message}`);
        }
    }
    console.log(`\n${count - failed}/${count} passed`);
    process.exit(failed ? 1 : 0);
})();
