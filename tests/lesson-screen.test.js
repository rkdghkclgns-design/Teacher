// 차시 화면 그리기 테스트: 큰 그림 데이터는 글 처리 밖에 두고 맨 끝에 넣는다(api.js drawLessonScreen) (실행: node tests/lesson-screen.test.js)
// 화면과 같은 marked와 HTML 파서(domino)로 실제 파이프라인을 돌려, 예전 식 renderLessonHTML(preprocessMarkdown(inlineLessonImages(md, images)))과 글자 하나까지 같은지 본다.
// 탭 바꾸기는 tabs.js·api.js의 실제 switchLessonTab·renderEditor·toggleEditorMode를 돌린다(편집 영역은 id가 있는 요소만 흉내 낸다).
// 처음 한 번: npm install --no-save marked@15.0.12 turndown@7.2.4 (domino는 turndown과 함께 들어온다)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

let marked;
let domino;
let NodeFilter;
try {
    ({ marked } = require('marked'));
    domino = require('@mixmark-io/domino');
    NodeFilter = require('@mixmark-io/domino/lib/NodeFilter');
} catch (err) {
    console.log('FAIL - marked·domino가 없습니다. 먼저 실행: npm install --no-save marked@15.0.12 turndown@7.2.4');
    process.exit(1);
}

const root = path.join(__dirname, '..', 'js') + path.sep;
const read = file => fs.readFileSync(root + file, 'utf8');
const PIPELINE = ['data.js', 'lesson-sanitize.js', 'lesson-format.js', 'lesson-export.js', 'lesson-opening.js'];
const EDITOR = ['data.js', 'lesson-sanitize.js', 'lesson-format.js', 'lesson-export.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js',
    'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js'];
const quiet = { log() {}, warn() {}, error() {}, info() {} };

// 파일에서 함수 하나만 잘라 싣는다(ui.js는 화면 요소가 있어야 실린다)
function sliceFunction(source, head) {
    const text = source.replace(/\r\n/g, '\n');
    const at = text.indexOf(head);
    return text.slice(at, text.indexOf('\n}\n', at) + 2);
}

function baseContext(extra = {}) {
    const ctx = {
        console: quiet, setTimeout: () => 0, clearTimeout() {}, Promise, URL, Uint16Array, Blob, AbortController,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        marked, NodeFilter,
        DOMParser: function DOMParser() { this.parseFromString = html => domino.createDocument(String(html), true); },
        document: {
            readyState: 'complete', body: { classList: classList(), appendChild() {} },
            createElement: () => fakeElement(), getElementById: () => null,
            addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => []
        },
        ...extra
    };
    ctx.window = ctx;
    return ctx;
}

// 그리기 파이프라인만 싣는다
function pipelineContext() {
    const ctx = baseContext();
    vm.createContext(ctx);
    vm.runInContext(sliceFunction(read('ui.js'), 'function escapeHtml('), ctx);
    PIPELINE.forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    vm.runInContext(read('api.js'), ctx, { filename: 'api.js' });
    return ctx;
}

/* ---------- 편집 영역 흉내(tests/raw-edit.test.js와 같은 방식) ---------- */
function classList(names = []) {
    const set = new Set(names);
    return {
        add: (...items) => items.forEach(item => set.add(item)),
        remove: (...items) => items.forEach(item => set.delete(item)),
        toggle: (item, force) => { const on = force === undefined ? !set.has(item) : !!force; if (on) set.add(item); else set.delete(item); return on; },
        contains: item => set.has(item),
        replace: (from, to) => { if (set.delete(from)) set.add(to); }
    };
}

function fakeElement(id = '', classes = []) {
    return {
        id, style: {}, dataset: {}, value: '', innerHTML: '', textContent: '', className: '', title: '', disabled: false, classList: classList(classes),
        addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], remove() { this.removed = true; }
    };
}

const unescapeHtml = text => text.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const camel = name => name.replace(/-(\w)/g, (_, ch) => ch.toUpperCase());

// innerHTML로 그린 글에서 id가 있는 요소를 만든다. 원문 칸은 브라우저처럼 첫 빈 줄을 떼고 줄바꿈을 \n으로 바꿔 담고,
// #render-view는 브라우저처럼 그 안에 그린 글을 innerHTML로 가진다(writes에 다시 넣은 횟수를 센다)
function editorArea(elements, writes) {
    const area = fakeElement('editor-content-area');
    let html = '';
    Object.defineProperty(area, 'innerHTML', {
        get: () => html,
        set(next) {
            html = String(next);
            Object.keys(elements).filter(id => elements[id].owned).forEach(id => { delete elements[id]; });
            for (const match of html.matchAll(/<(\w+)\b([^<>]*?)\sid="([^"]+)"([^<>]*)>/g)) {
                const [whole, tag, before, id, after] = match;
                const attrs = `${before} ${after}`;
                const el = fakeElement(id, ((attrs.match(/\sclass="([^"]*)"/) || [])[1] || '').split(/\s+/).filter(Boolean));
                el.owned = true;
                for (const [, name, value] of attrs.matchAll(/\sdata-([\w-]+)="([^"]*)"/g)) el.dataset[camel(name)] = unescapeHtml(value);
                const start = match.index + whole.length;
                if (tag === 'textarea') el.value = el.defaultValue = unescapeHtml(html.slice(start, html.indexOf('</textarea>', start))).replace(/\r\n?/g, '\n').replace(/^\n/, '');
                if (id === 'render-view') {
                    let inner = html.slice(start, html.indexOf('<textarea id="raw-view"', start)).replace(/<\/div>\s*$/, '');
                    Object.defineProperty(el, 'innerHTML', { get: () => inner, set(value) { writes.push(String(value)); inner = String(value); } });
                }
                elements[id] = el;
            }
        }
    });
    return area;
}

function editorContext() {
    const elements = {};
    const writes = [];
    const ctx = baseContext({
        saveState: async () => true, archiveContent: async () => {}, renderSidebar() {}, showLessonView() {}, syncGyosuanView() {}, syncSlidePanel() {},
        lessonDesignBrief: () => '', lessonGenBrief: () => '', showAlert() {}, showToast() {}, callGemini: async () => ({}), elements, writes
    });
    ctx.document.getElementById = id => elements[id] || null;
    elements['editor-content-area'] = editorArea(elements, writes);
    elements['ai-command-bar'] = fakeElement('ai-command-bar', ['hidden']);
    vm.createContext(ctx);
    vm.runInContext(sliceFunction(read('ui.js'), 'function escapeHtml('), ctx);
    EDITOR.forEach(file => vm.runInContext(read(file), ctx, { filename: file }));
    if (!ctx.confirmAsync) ctx.confirmAsync = async () => true;
    ctx.enhanceRawView = undefined; // 서식 도구 상자는 원문 칸을 옮겨 담는다(이 흉내에는 부모 요소가 없다)
    vm.runInContext(`renderSidebar = () => {};
        getEditingModule = (id = currentEditingModuleId) => courseData.find(m => String(m.id) === String(id));`, ctx);
    return ctx;
}

function openLesson(ctx, mod, tabId = 'basicLearn') {
    vm.runInContext(`currentLessonTab = '${tabId}'; _lessonPanel = null;`, ctx);
    ctx.globalState = { subjects: [{ id: 's1', title: '교과', lessons: [mod], mainQuest: { id: 'mainQuest', title: '최종 평가', images: {}, content: '' } }] };
    ctx.currentSubjectId = 's1';
    ctx.courseData = ctx.globalState.subjects[0].lessons;
    ctx.currentEditingModuleId = mod.id;
}

/* ---------- 그림과 교안 ---------- */
function bytes(seed, length) {
    const out = Buffer.alloc(length);
    let x = seed * 2654435761 >>> 0 || 1;
    for (let i = 0; i < length; i++) {
        x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
        out[i] = x & 255;
    }
    return out;
}
// base64 그림. length: 바이트 수(3으로 나눈 나머지에 따라 끝이 '', '==', '='로 끝난다)
const picture = (seed, length = 9000, mime = 'jpeg', head = `data:image/${mime};base64,`) => head + bytes(seed, length).toString('base64');
const bodyOf = data => data.slice(data.indexOf(',') + 1);

const WRAP = (key, caption) => `<div class="image-wrapper"><img src="local:${key}" alt="${caption}" class="rounded-lg border-2 border-accent/30 shadow-md max-w-full"><button class="image-regenerate-btn px-3 py-1.5 text-xs" data-lesson-action="regenerate-image" data-keyword="game loop" data-img-id="${key}"><i class="ph-bold ph-arrows-clockwise"></i> 다시 찾기</button><div class="image-caption" style="margin-top:8px;text-align:center;">${caption}</div></div>`;

const MIXED = [
    '# 1차시 게임 루프', '', '## 1. 개요 (Overview)', '', '게임 루프를 배웁니다. 이 차시를 마치면 다음을 할 수 있습니다.', '',
    '## 2. 학습 목표', '', '- 💡 입력을 읽는다', '- **갱신:** 상태를 바꾼다', '',
    '## 3. 상세 내용', '', WRAP('img_1', '그림 1: 게임 루프 도식'), '',
    '첫 문장입니다. 둘째 문장입니다. 셋째 문장은 길게 이어집니다. 💡 핵심: 순서를 지킵니다.', '',
    '![입력 단계](local:img_2)', '',
    '<img src="local:img_3" alt="inserted image" style="max-width:100%; border-radius:8px;">', '',
    '<!-- [IMG: "local:img_4"] -->', '', '<!-- [IMG: "game loop diagram"] -->', '',
    '```csharp', '// <!-- 주석처럼 보이는 글 --> data:image/png;base64,QUJD', 'var key = "local:img_1"; // ![](local:img_2)', 'int a = 2 ** 3;', '```', '',
    '```mermaid', 'flowchart TD', '    A[입력 (키보드)] --> B{갱신}', '    B --> C[그리기]', '```', '',
    '<div class="instructor-callout"><p>강사 메모입니다. 천천히 설명합니다.</p>', WRAP('img_5', '강사만 보는 그림'), '</div>', '',
    '- 항목 하나', '', '  **전투 설계**: 적의 체력을 정합니다.', '', '  **보상 설계**: 점수를 줍니다.', '',
    '| 구분 | 그림 |', '| --- | --- |', '| 입력 ✅ | ![표 그림](local:img_6) |', '',
    '<table><tr><th>구분</th><td>' + WRAP('img_7', '표 안 그림') + '</td></tr></table>', '',
    '1. 첫째 ![목록 그림](local:img_8)', '2. 둘째', '', '<!-- 번호 목록 -->', '1. 번호 하나', '2. 번호 둘', '',
    '> 인용 안의 그림 ![인용](local:img_9) 입니다. 다음 문장입니다.', '',
    '**굵게 ![굵은 그림](local:img_10) 끝:**', '',
    '**퀴즈**: 다음 중 갱신 단계는? ① ![보기](local:img_11) ② 갱신 ③ 그리기', '', '정답: ① ③', '',
    '### 그림이 붙은 제목 ![제목](local:img_12)', '',
    '![a](local:img_13)![b](local:img_14) 붙은 그림과 ![a again](local:img_13)', '',
    '`인라인 코드 "local:img_1"` 와 `![코드 속](local:img_2)`', '',
    '[그림 링크](local:img_15) 와 [![링크 속 그림](local:img_16)](local:img_15)', ''
].join('\n');

function mixedImages() {
    const images = {};
    for (let k = 1; k <= 16; k++) images[`img_${k}`] = picture(k, 6000 + k * 37 + (k % 3), k % 5 === 0 ? 'png' : k === 7 ? 'gif' : 'jpeg');
    return images;
}

const ODD_IMAGES = {
    big: picture(31, 12000),
    small: picture(32, 600),
    svg64: picture(33, 8000, 'svg+xml'),
    param: picture(34, 8000, 'png', 'data:image/png;charset=utf-8;base64,'),
    upper: picture(35, 8000, 'png', 'data:image/png;BASE64,'),
    svgtext: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10"><text x="0" y="9">가 "나" (다)</text></svg>' + ' x'.repeat(2500),
    spaced: 'data:image/png;base64,' + bytes(36, 6000).toString('base64').replace(/(.{76})/g, '$1\n'),
    ref: 'teacher-image:0123456789abcdef01',
    empty: '',
    img_1: picture(37, 7000), img_10: picture(38, 7000)
};
const ODD = [
    '## 이상한 그림들', '', '![큰](local:big) ![작은](local:small) ![svg](local:svg64) ![매개변수](local:param)', '',
    '![대문자](local:upper) ![글 svg](local:svgtext) ![줄바꿈](local:spaced) ![자리](local:ref) ![빈](local:empty) ![없는](local:missing)', '',
    '<img src="local:missing"> <img src="local:svgtext"> <div class="image-wrapper"><img src="local:big"></div>', '',
    '![1](local:img_1) ![10](local:img_10) local:img_1. 괄호 (local:img_10)', ''
].join('\n');

const LOOSE_IMAGES = { t: picture(41, 9000), p: picture(42, 9000), q: picture(43, 9000), both: picture(44, 9000), x: picture(45, 9000), e: picture(46, 9001), c: picture(47, 9002) };
const LOOSE = [
    '## 다른 자리에 쓰인 그림 키', '',
    '![제목 있는 그림](local:t "그림 제목")', '',
    '문장 속 local:p 💡 다음 글 local:p.', '',
    '괄호 (local:q) 와 따옴표 "local:q" 와 <local:q> 자리', '',
    '[r]: local:q', '', '[참고][r]', '',
    '![안전](local:both) 와 문장 속 local:both 끝', '',
    'xlocal:x 와 ![x](local:x)', '',
    '*강조 (local:e)*a 와 **굵게 "local:e"**b', '',
    '인라인 코드 `local:c` 와 ![c](local:c)', ''
].join('\n');

const toCrlf = text => text.replace(/\r?\n/g, '\r\n');

/* ---------- 실행 ---------- */
let failed = 0;
let count = 0;
const test = (name, fn) => {
    count++;
    try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.stack || e.message}`); }
};

const P = pipelineContext();
const oldScreen = (ctx, md, images) => ctx.renderLessonHTML(ctx.preprocessMarkdown(ctx.inlineLessonImages(md, images)));
const newScreen = (ctx, md, images) => { vm.runInContext('forgetLessonScreens()', ctx); return ctx.renderLessonScreen(md, images); };

// 그리기 함수들을 감싸 받은 글을 모은다. 끝나면 되돌린다
function recordPasses(ctx, fn) {
    const names = ['inlineLessonImages', 'preprocessMarkdown', 'renderLessonHTML', 'stripInstructorCallouts', 'applyPeriodLineBreakHTML', 'markTermParagraphs', 'postprocessHtml', 'keepChosenNumbering', 'sanitizeLessonHtml'];
    const seen = [];
    const originals = names.map(name => [name, ctx[name]]);
    const parse = ctx.marked.parse;
    names.forEach(name => { const original = ctx[name]; ctx[name] = function (...args) { seen.push([name, String(args[0])]); const out = original.apply(this, args); if (name === 'inlineLessonImages') seen.push([`${name}:out`, String(out)]); return out; }; });
    ctx.marked.parse = function (...args) { seen.push(['marked.parse', String(args[0])]); return parse.apply(this, args); };
    try { return { out: fn(), seen }; } finally {
        originals.forEach(([name, original]) => { ctx[name] = original; });
        ctx.marked.parse = parse;
    }
}

test('같은 HTML: 여러 모양의 그림(그림 틀·설명, 마크다운 그림, 붙여 넣은 그림, IMG 자리), 코드 블록 속 <!--·data:, mermaid, 강사 callout, 마침표 줄바꿈, 표·목록·인용·굵은 글 속 그림', () => {
    const images = mixedImages();
    const expected = oldScreen(P, MIXED, images);
    assert.strictEqual(newScreen(P, MIXED, images), expected);
    assert.strictEqual(P.renderLessonScreen(MIXED, images), expected, '기억한 결과로 다시 그려도 같다');
    assert.ok(expected.includes(images.img_1) && expected.includes(encodeURIComponent(images.img_2)), '그림 데이터가 화면에 들어간다(마크다운 그림은 data-imgid에 encodeURIComponent 모양도)');
});

test('같은 HTML: CRLF 줄바꿈, 빈 글, 빈칸만 있는 글, 그림이 없는 글', () => {
    const images = mixedImages();
    [toCrlf(MIXED), '', '   \n  ', '# 제목\n\n그림 없는 글입니다. 다음 문장입니다.', null, undefined].forEach(md => {
        assert.strictEqual(newScreen(P, md, images), oldScreen(P, md, images), JSON.stringify(String(md).slice(0, 30)));
    });
    assert.strictEqual(newScreen(P, MIXED, null), oldScreen(P, MIXED, null), '그림 목록이 없다');
});

test('같은 HTML: 작은 그림·base64가 아닌 data URL·대문자 BASE64·줄바꿈 든 base64·찾지 못한 그림 자리·빈 값·없는 키·img_1과 img_10', () => {
    assert.strictEqual(newScreen(P, ODD, ODD_IMAGES), oldScreen(P, ODD, ODD_IMAGES));
});

test('같은 HTML: 제목 있는 그림·문장 속 키·괄호와 따옴표 속 키·참조 링크·두 자리에 쓰인 키·xlocal:·강조 옆 키(이런 키는 그림을 그대로 넣는다)', () => {
    assert.strictEqual(newScreen(P, LOOSE, LOOSE_IMAGES), oldScreen(P, LOOSE, LOOSE_IMAGES));
});

test('같은 HTML: 같은 그림을 두 키가 쓰고, 코드 블록 안에만 쓰인 키는 그대로 둔다', () => {
    const shared = picture(51, 9000);
    const images = { a: shared, b: shared, code: picture(52, 9000) };
    const md = '![a](local:a) ![b](local:b)\n\n```js\nconst src = "local:code"; // (local:code)\n```\n';
    assert.strictEqual(newScreen(P, md, images), oldScreen(P, md, images));
});

// 무작위 교안: 그림 키를 여러 모양·자리(마크다운·HTML·주석·링크·괄호·따옴표·강조·표·목록·코드·callout 등)에 넣어 이어 붙인다(씨앗이 같으면 같은 교안)
function randomLessons(seed, count) {
    let x = seed >>> 0 || 1;
    const rand = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
    const pick = list => list[Math.floor(rand() * list.length)];
    const keys = ['img_1', 'img_2', 'img_10', 'a-b', 'gif', 'small', 'svgtext', 'ref', 'empty', 'missing'];
    const ref = () => `local:${pick(keys)}`;
    const shapes = [
        r => `![그림](${r})`, r => `![](${r})`, r => `![설명](${r} "제목")`, r => `<img src="${r}">`, r => `<img alt="b" src="${r}" class="x">`, r => WRAP(r.slice(6), '그림: 설명'),
        r => `<!-- [IMG: "${r}"] -->`, r => `[링크](${r})`, r => `[![안](${r})](${r})`, r => `(${r})`, r => `"${r}"`, r => r, r => `\`${r}\``, r => `**(${r})**a`,
        r => `*${r}*`, r => `<${r}>`, r => `${r}.`, r => `${r} 💡`, r => `① (${r}) ②`, r => `x${r}`, r => `| (${r}) |`, r => `<p>•(${r})</p>`, r => `**라벨:** (${r})`,
        r => `<span title="${r}">t</span>`, r => `<a href="#" onclick="${r}">a</a>`, r => `http://a.com/(${r})`, r => `"${r}"\\`
    ];
    const text = ['첫 문장입니다. 둘째 문장입니다.', '💡 핵심: 순서를 지킵니다.', '**용어**: 설명입니다.', '**제목:**', '정답: ① ③', '개요 (Overview)', 'a**2 + b**2', '예: 보기', '<b>굵게</b> &amp;', '???'];
    const blocks = [
        () => `## ${Math.floor(rand() * 9)}. 제목 ${pick(text)}`, () => `### 소제목 ${pick(shapes)(ref())}`, () => `${pick(text)} ${pick(shapes)(ref())} ${pick(text)}`,
        () => `- ${pick(shapes)(ref())}\n- ${pick(text)}\n    - ${pick(shapes)(ref())}`, () => `<!-- 번호 목록 -->\n1. 하나\n2. ${pick(shapes)(ref())}`, () => `> ${pick(text)} ${pick(shapes)(ref())}`,
        () => `| 가 | 나 |\n| --- | --- |\n| ${pick(shapes)(ref())} | ${pick(text)} |`, () => `\`\`\`js\n// <!-- 주석 --> "${ref()}" (${ref()}) data:image/png;base64,QUJD\n\`\`\``,
        () => '```mermaid\nflowchart TD\n  A[가 (나)] --> B{다}\n```', () => `<div class="instructor-callout"><p>${pick(text)}</p>\n${pick(shapes)(ref())}\n</div>`,
        () => `<table><tr><td>${pick(shapes)(ref())}</td></tr></table>`, () => `<pre>${pick(shapes)(ref())}</pre>`, () => `${pick(shapes)(ref())}${pick(shapes)(ref())}`, () => `[r]: ${ref()}\n\n[참고][r]`
    ];
    return Array.from({ length: count }, () => {
        const md = Array.from({ length: 3 + Math.floor(rand() * 10) }, () => pick(blocks)()).join('\n\n');
        return rand() < 0.2 ? toCrlf(md) : md;
    });
}

test('같은 HTML: 무작위 교안 120개(그림 키를 여러 모양·자리에, CRLF 섞어)', () => {
    const images = { img_1: picture(91, 5000), img_2: picture(92, 5001, 'png'), img_10: picture(93, 5002), 'a-b': picture(94, 4000, 'webp'), gif: picture(95, 4500, 'gif'), small: picture(96, 300), svgtext: ODD_IMAGES.svgtext, ref: ODD_IMAGES.ref, empty: '' };
    let marked = 0;
    const render = P.renderLessonHTML;
    P.renderLessonHTML = text => { if (/Lv[a-z0-9]{24}k\d+z/.test(text)) marked += 1; return render(text); };
    try {
        randomLessons(20261108, 120).forEach((md, i) => {
            const expected = render(P.preprocessMarkdown(P.inlineLessonImages(md, images)));
            assert.strictEqual(newScreen(P, md, images), expected, `${i}번 교안: ${JSON.stringify(md.slice(0, 200))}`);
        });
    } finally { P.renderLessonHTML = render; }
    assert.ok(marked >= 60, `표시로 그린 교안이 충분하다(${marked}개)`);
});

test('같은 HTML: 실제 크기에 가까운 그림(약 300KB 셋)과 긴 교안', () => {
    const images = { img_1: picture(61, 225000), img_2: picture(62, 225001, 'png'), img_3: picture(63, 225002, 'gif') };
    const md = Array.from({ length: 40 }, (_, i) => `## ${i + 1}. 단원\n\n문장입니다. 다음 문장입니다. ${i % 3 === 0 ? `![그림](local:img_${(i % 9) / 3 + 1})` : ''}\n\n${WRAP(`img_${(i % 3) + 1}`, `그림 ${i}`)}\n\n- **용어**: 설명`).join('\n\n');
    assert.strictEqual(newScreen(P, md, images), oldScreen(P, md, images));
});

test('글 처리(전처리·marked·마침표 줄바꿈·용어 문단·후처리·정리)는 그림 데이터를 받지 않는다', () => {
    const images = mixedImages();
    vm.runInContext('forgetLessonScreens()', P);
    const { out, seen } = recordPasses(P, () => P.renderLessonScreen(MIXED, images));
    assert.strictEqual(out, oldScreen(P, MIXED, images));
    const bodies = Object.values(images).map(bodyOf).map(body => body.slice(1000, 1064));
    const pictureChars = Object.values(images).reduce((sum, data) => sum + data.length, 0);
    const passes = new Set(seen.map(([name]) => name));
    ['inlineLessonImages:out', 'preprocessMarkdown', 'renderLessonHTML', 'stripInstructorCallouts', 'marked.parse', 'applyPeriodLineBreakHTML', 'markTermParagraphs', 'postprocessHtml', 'sanitizeLessonHtml'].forEach(name => assert.ok(passes.has(name), `${name}을 거친다`));
    seen.forEach(([name, text]) => {
        assert.ok(!bodies.some(chunk => text.includes(chunk)), `${name}이 그림 데이터를 받았다`);
        assert.ok(text.length < pictureChars / 2, `${name}이 받은 글이 그림 데이터보다 훨씬 짧다(${text.length}자 / 그림 ${pictureChars}자)`);
    });
});

test('표시는 교안 글로 흉내 낼 수 없다: 표시 모양의 글·지난 그리기의 표시·이번 무작위 글자가 든 글은 그림으로 바뀌지 않는다', () => {
    const images = { img_1: picture(71, 9000), img_2: picture(72, 9000) };
    // 지난 그리기의 표시를 받아 둔다
    let captured = '';
    vm.runInContext('forgetLessonScreens()', P);
    recordPasses(P, () => P.renderLessonScreen('![a](local:img_1)', images)).seen.forEach(([name, text]) => {
        if (name === 'renderLessonHTML') captured = (text.match(/data:image\/jpeg;base64,Lv[a-z0-9]{24}k0zA*Q/) || [''])[0];
    });
    assert.ok(captured.length >= 200, '표시를 받았다');
    const forged = [
        `![옛 표시](${captured}) <img src="${captured}"> ${captured} ![진짜](local:img_2)`,
        `![가짜](data:image/jpeg;base64,Lv${'a'.repeat(24)}k0z${'A'.repeat(200)}Q) ![진짜](local:img_1)`,
        `![a](local:img_1) 글에 ${captured.slice(25, 51)} 가 있다`
    ];
    forged.forEach(md => {
        const out = newScreen(P, md, images);
        assert.strictEqual(out, oldScreen(P, md, images), md.slice(0, 40));
        assert.strictEqual(out.split(bodyOf(images.img_1)).length - 1, (oldScreen(P, md, images).split(bodyOf(images.img_1)).length - 1), '진짜 그림은 원래 자리에만');
    });
    // 이번 무작위 글자(조각 하나라도)가 글에 있으면 표시를 쓰지 않는다
    const nonce = P.lessonScreenNonce;
    P.lessonScreenNonce = () => 'fixednonce0123456789abcd';
    try {
        ['![a](local:img_1) fixednonce0123456789abcd', '![a](local:img_1) 조각 ce012345 만'].forEach(md => {
            const { out, seen } = recordPasses(P, () => newScreen(P, md, images));
            assert.strictEqual(out, oldScreen(P, md, images));
            assert.ok(seen.find(([name]) => name === 'renderLessonHTML')[1].includes(bodyOf(images.img_1)), `그림을 넣은 글로 그린다: ${md}`);
        });
        const { seen } = recordPasses(P, () => newScreen(P, '![a](local:img_1) 다른 글', images));
        assert.ok(!seen.find(([name]) => name === 'renderLessonHTML')[1].includes(bodyOf(images.img_1)), '조각이 없으면 표시로 그린다');
    } finally {
        P.lessonScreenNonce = nonce;
    }
});

test('표시가 다른 모양으로 남으면(처리 규칙이 표시를 바꾸면) 결과를 버리고 그림을 넣은 글로 다시 그린다: 화면에 표시가 남지 않는다', () => {
    const images = { img_1: picture(81, 9000), img_2: picture(82, 9000) };
    const md = '![a](local:img_1)\n\n<div class="image-wrapper"><img src="local:img_2"></div>';
    const real = P.postprocessHtml;
    [html => real(html).replace(/AQ"/g, 'Aq"'), html => real(html).replace(/data:image\/jpeg;base64,Lv/g, 'Lv'), html => real(html).replace(/(Lv[a-z0-9]{10})/g, '$1 ')].forEach((mangle, i) => {
        P.postprocessHtml = mangle;
        try {
            const out = newScreen(P, md, images);
            assert.strictEqual(out, oldScreen(P, md, images), `규칙 ${i}`);
            assert.ok(!/Lv[a-z0-9]{24}k\d+z/.test(out) && !/Lv[a-z0-9]{10} /.test(out), `규칙 ${i}: 표시가 남지 않는다`);
        } finally { P.postprocessHtml = real; }
    });
    // 그리다 오류가 나면 그림을 넣은 글로 다시 그리고, 그것도 오류면 같은 오류를 던진다
    const render = P.renderLessonHTML;
    P.renderLessonHTML = text => { if (/Lv[a-z0-9]{24}k/.test(text)) throw new Error('표시를 못 그림'); return render(text); };
    try { assert.strictEqual(newScreen(P, md, images), oldScreen(P, md, images)); } finally { P.renderLessonHTML = render; }
    P.renderLessonHTML = () => { throw new Error('그리기 실패'); };
    try { assert.throws(() => newScreen(P, md, images), /그리기 실패/); } finally { P.renderLessonHTML = render; }
});

test('기억한 결과: 같은 글·그림이면 다시 그리지 않고, 글을 고치거나 그림 값이 바뀌거나(같은 목록을 고쳐도) 그림을 지우거나 다른 차시의 그림이면 새로 그린다', () => {
    const C = pipelineContext();
    let renders = 0;
    const render = C.renderLessonHTML;
    vm.runInContext('renderLessonHTML = (...args) => { countRender(); return realRender(...args); }', Object.assign(C, { countRender: () => { renders += 1; }, realRender: render }));
    const images = mixedImages();
    const check = (md, imgs, expectRender, label) => {
        const before = renders;
        const out = C.renderLessonScreen(md, imgs);
        assert.strictEqual(renders - before, expectRender ? 1 : 0, `${label}: renderLessonHTML ${renders - before}번`);
        assert.strictEqual(out, oldScreen(C, md, imgs), `${label}: 예전 식과 같다`);
        return out;
    };
    check(MIXED, images, true, '처음');
    check(MIXED, images, false, '같은 글·그림');
    check(MIXED + '\n추가 문장입니다.', images, true, '글을 고쳤다');
    check(MIXED, images, false, '고치기 전 글로 돌아왔다(기억해 둔 결과)');
    images.img_2 = picture(99, 6500); // 같은 목록 객체의 값만 바꾼다
    const changed = check(MIXED, images, true, '그림 값이 바뀌었다');
    assert.ok(changed.includes(bodyOf(images.img_2)) && !changed.includes(bodyOf(picture(2, 6000 + 2 * 37 + 2))), '새 그림만 보인다');
    // 살펴본 그림과 길이가 같아도 base64가 아닌 글자가 든 값은 표시로 바꾸지 않는다(살펴본 그림 기억은 같은 글자열에만)
    const broken = { ...images, img_4: `${images.img_4.slice(0, 3000)})" <b>${images.img_4.slice(3006)}` };
    assert.strictEqual(broken.img_4.length, images.img_4.length);
    check(MIXED, broken, true, '같은 길이의 깨진 그림');
    const removed = { ...images };
    delete removed.img_3;
    check(MIXED, removed, true, '그림을 지웠다');
    const other = mixedImages();
    other.img_1 = picture(98, 7000);
    check(MIXED, other, true, '다른 차시(같은 글, 다른 그림)');
    check(MIXED, { ...other, unused: picture(97, 7000) }, false, '글에 없는 그림만 늘었다(결과가 같다)');
    C.viewMode = 'instructor'; // 보기 모드는 화면 HTML을 바꾸지 않는다(그린 뒤 applyViewMode가 고른다)
    check(MIXED, other, false, '강사뷰로 바꿨다');
    vm.runInContext("postprocessHtml = html => html + '<!-- 바꾼 후처리 -->'", C);
    assert.ok(check(MIXED, other, true, '그리는 함수가 바뀌었다').endsWith('<!-- 바꾼 후처리 -->'));
    // 기억할 수를 넘으면 오래된 결과부터 잊는다
    for (let i = 0; i < 8; i++) check(`# ${i}번 글`, images, true, `${i}번 글`);
    check(MIXED, other, true, '오래되어 잊은 결과');
});

/* ---------- 탭 바꾸기·차시 열기 ---------- */
function editorLesson() {
    const images = { ...mixedImages(), ...LOOSE_IMAGES };
    const tabContents = { basicLearn: MIXED, basicPrac: '## 실습\n\n![실습](local:img_5)\n\n실습 글입니다.', advLearn: LOOSE, advPrac: null, assessment: null };
    const mod = { id: 1, title: '게임 루프', images, tabContents };
    mod.content = Object.values(tabContents).filter(Boolean).join('\n\n---\n\n');
    return mod;
}

// 예전 화면: renderEditor가 넣은 뒤 toggleEditorMode('view')가 원문 칸의 글(첫머리 정리)로 다시 그린 HTML
const oldView = (ctx, mod) => oldScreen(ctx, ctx.cleanLessonOpening(ctx.elements['raw-view'].value), mod.images);

test('탭을 바꾸면 renderLessonHTML을 한 번만 부르고(처음 연 탭), 다시 연 탭은 기억한 결과를 쓴다. 화면은 예전과 같다', () => {
    const E = editorContext();
    const mod = editorLesson();
    openLesson(E, mod);
    let renders = 0;
    const render = E.renderLessonHTML;
    E.renderLessonHTML = (...args) => { renders += 1; return render(...args); };
    const view = () => E.elements['render-view'].innerHTML;
    [['basicLearn', 1], ['basicPrac', 1], ['advLearn', 1], ['basicLearn', 0], ['advLearn', 0]].forEach(([tabId, expected]) => {
        renders = 0;
        E.writes.length = 0;
        E.switchLessonTab(tabId);
        assert.strictEqual(renders, expected, `${tabId}: renderLessonHTML ${renders}번`);
        assert.strictEqual(E.writes.length, 0, `${tabId}: 그린 교안을 #render-view에 다시 넣지 않는다`);
        assert.strictEqual(view(), oldView(E, mod), `${tabId}: 화면이 예전과 같다`);
        assert.ok(E.elements['editor-content-area'].innerHTML.includes(view()), `${tabId}: 편집 영역에 넣은 교안`);
    });
});

test('차시를 열 때도(viewModule) renderLessonHTML을 한 번만 부른다', () => {
    const E = editorContext();
    const mod = editorLesson();
    openLesson(E, mod);
    let renders = 0;
    const render = E.renderLessonHTML;
    E.renderLessonHTML = (...args) => { renders += 1; return render(...args); };
    E.viewModule(1);
    assert.strictEqual(renders, 1);
    assert.strictEqual(E.elements['render-view'].innerHTML, oldView(E, mod));
});

test('CRLF로 저장된 탭: 원문 칸의 글(\\n)이 다르면 보기 전환이 그 글로 다시 그리고, 화면은 예전과 같다', () => {
    const E = editorContext();
    const mod = editorLesson();
    mod.tabContents.basicLearn = toCrlf(MIXED);
    openLesson(E, mod);
    E.switchLessonTab('basicLearn');
    const drawnText = E.getActiveTabContent(mod);
    const rawText = E.cleanLessonOpening(E.elements['raw-view'].value);
    assert.strictEqual(E.writes.length, drawnText === rawText ? 0 : 1, '글이 다를 때만 다시 넣는다');
    assert.strictEqual(E.elements['render-view'].innerHTML, oldView(E, mod));
});

test('원문을 고치고 보기로 돌아오면 고친 글로 다시 그린다(방금 그린 화면 표시는 renderEditor 안에서만 쓴다)', () => {
    const E = editorContext();
    const mod = editorLesson();
    openLesson(E, mod);
    E.switchLessonTab('basicLearn');
    E.toggleEditorMode('edit');
    E.toggleEditorMode('view');
    assert.strictEqual(E.writes.length, 1, '고치지 않아도 보기 전환은 예전처럼 다시 넣는다');
    E.elements['raw-view'].value = MIXED.replace('첫 문장입니다.', '고친 첫 문장입니다.');
    E.toggleEditorMode('view');
    assert.strictEqual(mod.tabContents.basicLearn, E.elements['raw-view'].value);
    assert.strictEqual(E.elements['render-view'].innerHTML, oldView(E, mod));
    assert.ok(E.elements['render-view'].innerHTML.includes('고친 첫 문장입니다.'));
});

test('그리기 오류: 화면에는 예전처럼 오류와 그림을 넣고 전처리한 글을 보인다', () => {
    const E = editorContext();
    const mod = editorLesson();
    mod.tabContents = { basicLearn: '# 제목\n\n![a](local:img_1) <b>', basicPrac: null, advLearn: null, advPrac: null, assessment: null };
    openLesson(E, mod);
    E.renderLessonHTML = () => { throw new Error('파싱 실패'); };
    E.renderEditor(mod);
    const shown = E.preprocessMarkdown(E.inlineLessonImages(E.getActiveTabContent(mod), mod.images));
    assert.ok(E.elements['editor-content-area'].innerHTML.includes(`마크다운 파싱 오류: 파싱 실패</div><pre class="text-gray-200 mt-4">${shown.replace(/</g, '&lt;')}</pre>`));
});

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
