// 슬라이드 글 겹침·핵심 요약 3줄·학습 영상 넣기 테스트 (실행: node tests/slide-fit-video.test.js)
// 1) 배치: 핵심 띠가 본문 위에 떠 있지 않고 제 자리를 차지하는지, 띠 글이 3줄에서 잘리는지, 본문이 줄어드는 규칙과 넘치는 항목을 다음 슬라이드로 넘기는지
// 2) 핵심 메시지: 만들 때 짧게 쓰라고 지시하는지, 긴 핵심 줄을 문장 단위로 안전하게 줄이는지
// 3) 영상: 갈래(기본학습·심화학습) 탭의 판서 영상·넣은 동영상·움직이는 GIF를 그 절의 슬라이드에 인용하는지, 화면·내보내기에서 종류마다 어떻게 그리는지
// 실제 파일(css/kbuilder/slides.css, js/kbuilder/*, js/gyosuan*.js)을 vm에서 돌린다. AI 응답과 그림 만들기만 스텁이고 네트워크는 부르지 않는다.
// DOM이 필요한 곳은 domino로 흉내 낸다. 처음 한 번: npm install --no-save marked@15.0.12 turndown@7.2.4
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { loadLessonTracks } = require('./lesson-tracks');

let domino = null;
try {
    domino = require('@mixmark-io/domino');
} catch (err) {
    console.log('FAIL - domino가 없습니다. 먼저 실행: npm install --no-save marked@15.0.12 turndown@7.2.4');
    process.exit(1);
}

const base = path.join(__dirname, '..');
const root = path.join(base, 'js') + path.sep;
const source = file => fs.readFileSync(root + file, 'utf8');
const text = file => fs.readFileSync(path.join(base, file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const call = (ctx, name) => vm.runInContext(name, ctx);
const reply = body => ({ candidates: [{ content: { parts: [{ text: body }] } }] });
const escapeHtml = s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : '');
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACw=';
const MP4 = `data:video/mp4;base64,${Buffer.from('ftypmp42-teacher-video'.repeat(40)).toString('base64')}`;
const YT = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';

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

const FILES = [
    'lesson-sanitize.js', 'filename-convention.js',
    'kbuilder/parser.js', 'kbuilder/render-doc.js', 'kbuilder/render-deck.js', 'kbuilder/deck-runtime.js', 'kbuilder/ref-images.js', 'kbuilder/import-html.js', 'kbuilder/auto-images.js',
    'kbuilder/export.js', 'kbuilder/sample-data.js', 'course-ncs.js', 'course-design.js', 'course-sessions.js', 'course-meta.js', 'gyosuan.js', 'gyosuan-view.js', 'gyosuan-images.js',
    'import-stream.js', 'gyosuan-io.js', 'gyosuan-deck-tidy.js', 'gyosuan-regen.js', 'gyosuan-videos.js', 'image-motion-plan.js', 'image-motion.js'
];

const META = '부제: 부제\n대상: 수강생\n선행: 없음\n결과물: 메모\n교보제: 슬라이드\n[학습목표]\n- 설명할 수 있다.\n[개요]\n개요 문단입니다.\n[수업흐름]\n단계 | 시간 | 핵심\n도입 | 10분 | 시작\n전개 | 60분 | 본문\n정리 | 10분 | 끝\n[준비물]\n- 빔프로젝터\n[산출물]\n- 메모\n[평가]\n- 확인\n[유의사항]\n- 검토한다.';
const SECTION = '@@GYOSUAN@@\n**강사 활동**: 화면을 띄운다.\n**설명 내용**:\n- 내용이다.\n**멘트 예시**: "시작합니다."\n**학생 활동**: 따라 한다.\n@@SLIDES@@\n### 슬라이드 - 본문\n- 슬라이드 문구:\n  - 핵심\n- 핵심 메시지: 메시지';
const OPEN_CLOSE = '@@INTRO@@\n제목: 열기\n**강사 활동**: 연다.\n@@CLOSE@@\n제목: 닫기\n**강사 활동**: 닫는다.';

// domino 문서로 DOMParser를 흉내 낸다(K.inertRoot · K.sanitizeDeckHtml)
class FakeDOMParser {
    parseFromString(html) { return domino.createDocument(String(html), true); }
}
// Blob → data URL (브라우저 FileReader 대신)
class FakeFileReader {
    readAsDataURL(blob) {
        blob.arrayBuffer().then(buffer => {
            this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
            if (this.onload) this.onload();
        });
    }
}

function makeContext({ storage = {}, videoStore = {} } = {}) {
    const elements = {};
    const stored = { 'kb-auto-img': '0', ...storage };
    const prompts = [];
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, URL, encodeURIComponent, Blob, TextDecoder, JSON, Date, Map, Set, Math, Uint8Array,
        atob: value => Buffer.from(String(value), 'base64').toString('binary'),
        btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
        DOMParser: FakeDOMParser, FileReader: FakeFileReader,
        TEXT_MODEL: 'claude-opus-5-5',
        CONTEXT_CORE: { personas: { instructor: '강사입니다.' } },
        INSTRUCTOR_TONE_PRESETS: [{ id: 'formal', label: '합쇼체' }], instructorTone: 'formal',
        getReferenceContext: () => '', stripInstructorCallouts: value => value,
        courseData: [], globalState: { subjects: [{ id: 's1', title: '게임 서버 입문' }], courseTitle: '과정' },
        currentSubjectId: 's1', currentEditingModuleId: 'm1',
        apiKey: 'test-key', claudeApiKey: '', isClaudeModel: () => true,
        extractText: data => data.candidates[0].content.parts[0].text,
        escapeHtml,
        localStorage: { getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = String(value); } },
        document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, getElementById: id => elements[id] || null, createElement: () => ({ appendChild() {}, setAttribute() {}, style: {} }) },
        BroadcastChannel: function () { this.postMessage = () => {}; },
        DBManager: { getItem: async key => (Object.prototype.hasOwnProperty.call(videoStore, key) ? videoStore[key] : null) },
        saveState: async () => { ctx.saved = (ctx.saved || 0) + 1; },
        renderEditor: () => {},
        generateImageAPI: async () => PNG,
        callGemini: async (model, payload) => {
            const body = payload.contents.at(-1).parts[0].text;
            if (body.includes('@@INTRO@@')) { prompts.push(body); return reply(OPEN_CLOSE); }
            if (body.includes('@@GYOSUAN@@')) { prompts.push(body); return reply(ctx.sectionReply || SECTION); }
            if (body.includes('교수안 머리말')) { prompts.push(body); return reply(META); }
            throw new Error('호출되면 안 됨');
        },
        confirm: () => { throw new Error('브라우저 기본 확인 창을 쓰면 안 된다'); },
        confirmAsync: async () => true,
        alerts: [], toasts: [], prompts, elements
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    loadLessonTracks(ctx, { tabs: true });
    FILES.forEach(file => vm.runInContext(source(file), ctx, { filename: file }));
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind });
    return ctx;
}

const LONG = '충분히 긴 본문 문장이 여기에 들어갑니다. 내용을 차근차근 풀어서 다룹니다.';
const wbPicture = id => `<div class="image-wrapper"><img src="local:${id}" alt="서버 구조 그림"></div>`;
const localVideo = (key, name) => `<div class="lesson-video"><video controls preload="metadata" src="local:${key}"></video><p class="lesson-video-caption">동영상: ${name}</p></div>`;
const youtubeVideo = id => `<div class="lesson-video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="동영상"></iframe><p class="lesson-video-caption">동영상: <a href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">YouTube에서 보기</a></p></div>`;
const fileVideo = url => `<div class="lesson-video"><video controls preload="metadata" src="${url}"></video><p class="lesson-video-caption">동영상: <a href="${url}">동영상 파일 주소</a></p></div>`;

// 기본학습: 1절에 넣은 동영상 파일, 2절에 판서 영상을 붙인 그림. 기본실습: YouTube. 심화학습: 움직이는 GIF와 mp4 주소
function videoLesson(ctx) {
    const mod = {
        id: 'm1', title: '서버와 클라이언트', hours: 2,
        images: { img_wb1: PNG, img_gif1: PNG, img_plain: PNG },
        lessonVideos: { vid_intro000001: MP4 },
        whiteboardVideos: { img_wb1: { id: 'wb_abc123', title: '서버 구조 판서', ext: 'mp4', at: 1 } },
        tabContents: {
            basicLearn: [
                `## 1. 서버의 역할 (⏱ 30분)\n\n역할표식 ${LONG}\n\n${localVideo('vid_intro000001', 'intro.mp4')}`,
                `## 2. 동기화 (⏱ 30분)\n\n동기화표식 ${LONG}\n\n${wbPicture('img_wb1')}\n\n![그냥 그림](local:img_plain)`
            ].join('\n\n'),
            basicPrac: `## 실습: 에코 서버 (⏱ 40분)\n\n실습표식 ${LONG}\n\n${youtubeVideo('dQw4w9WgXcQ')}`,
            advLearn: `## 1. 지연 보상 (⏱ 40분)\n\n심화표식 ${LONG}\n\n<div class="image-wrapper"><img src="local:img_gif1" alt="지연 보상 흐름"></div>\n\n${fileVideo('https://cdn.example.com/lag.mp4')}`,
            advPrac: null, assessment: null, advAssessment: null
        }
    };
    // 움직이는 GIF로 바꾼다(image-motion.js)
    call(ctx, 'applyImageMotionData')(mod, 'img_gif1', PNG, GIF, { summary: '요청과 응답이 오가는 흐름' }, 1700000000000);
    ctx.getEditingModule = id => (id === undefined || String(id) === 'm1' ? mod : null);
    return mod;
}

const deckOf = (...slides) => ['---', '교과목: 게임 서버 입문', '주제: 서버', '---', '', '# 슬라이드 편성안 - 서버', '', '## 슬라이드 편성', '', ...slides.flat(), '## 비고', '', '- 초안입니다.', ''].join('\n');
const slide = (n, title, maps, lines, extra = []) => [`### 슬라이드 ${n} - ${title}`, ...(maps ? [`- 대응 교수안: ${maps}`] : []), '- 슬라이드 문구:', ...lines.map(line => `  - ${line}`), ...extra, ''];
const BASE_DECK = deckOf(
    slide(1, '표지', '-', ['(제목) 서버']),
    slide(2, '목차', '-', ['오늘의 여정', '1. 서버의 역할', '2. 동기화', '3. 실습: 에코 서버']),
    slide(3, '서버의 역할', '전개 1', ['서버는 심판이다'], ['- 핵심 메시지: 서버가 판정한다.']),
    slide(4, '동기화', '전개 2', ['상태를 맞춘다'], ['- 핵심 메시지: 같은 화면을 본다.']),
    slide(5, '에코 서버', '전개 3', ['받은 글을 돌려준다']),
    slide(6, '마무리', '정리', ['(큰 문구) 오늘의 한 걸음'])
);

/* css 규칙 읽기: 선택자가 정확히 같은 규칙의 선언(여러 번 나오면 이어 붙인다) */
function cssRule(sheet, selector) {
    const css = sheet.replace(/\/\*[\s\S]*?\*\//g, ''); // 주석은 뺀다
    const bodies = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    for (let m = re.exec(css); m; m = re.exec(css)) {
        if (m[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')).includes(selector)) bodies.push(m[2]);
    }
    return bodies.join(';');
}

(async () => {
    const CSS = text('css/kbuilder/slides.css');

    /* ======================= 1. 배치 ======================= */
    await run('배치(css): 핵심 띠는 본문 위에 떠 있지 않고 제 높이를 차지하며(줄지 않음), 본문 2단은 남은 높이 안으로 줄고 그림 칸도 그 높이를 넘지 않는다', () => {
        // 띠를 본문 위에 띄우는 규칙(absolute·fixed)이 없다
        const keybarRules = [...CSS.matchAll(/([^{}]*\.keybar[^{}]*)\{([^{}]*)\}/g)];
        assert.ok(keybarRules.length > 0);
        keybarRules.forEach(([, selector, body]) => assert.ok(!/position\s*:\s*(absolute|fixed)/.test(body), `띠를 띄우지 않는다: ${selector.trim()}`));
        assert.ok(/flex\s*:\s*0 0 auto/.test(cssRule(CSS, '.frame > .keybar')), '띠는 줄지 않는다');
        assert.ok(/margin-bottom\s*:\s*\d+px/.test(cssRule(CSS, '.frame > :has(+ .keybar)')), '띠 앞 요소와 띄운다');
        const cols = cssRule(CSS, '.cols');
        assert.ok(/min-height\s*:\s*0/.test(cols) && /flex\s*:\s*1/.test(cols), '본문 2단은 남은 높이 안으로 준다');
        assert.ok(/grid-template-rows\s*:\s*minmax\(0,\s*1fr\)/.test(cols), '행 높이를 본문 높이에 묶는다');
        const side = cssRule(CSS, '.col-side');
        assert.ok(/max-height\s*:\s*100%/.test(side) && /min-height\s*:\s*0/.test(side), '그림 칸은 본문 높이를 넘지 않는다');
        assert.ok(/flex\s*:\s*0 1 auto/.test(cssRule(CSS, '.col-side > image-slot')), '그림은 줄어든다');
        // 넘치면 줄이는 배율(실행 중에 잰다)
        assert.ok(/zoom\s*:\s*var\(--fit,\s*1\)/.test(cssRule(CSS, '[data-fit]')), '배율 변수');
        // 줄인 칸에서 손으로 옮긴 요소는 옮길 때의 배율을 지킨다(칸의 배율은 열 때마다 다시 재므로 옮긴 요소의 자리·크기가 그에 따라 바뀌면 안 된다)
        assert.ok(/zoom\s*:\s*calc\(var\(--abs-zoom,\s*1\)\s*\/\s*var\(--fit,\s*1\)\)/.test(cssRule(CSS, '[data-abs][style*="--abs-zoom"]')), '옮긴 요소의 배율');
        const editor = source('kbuilder/editor.js');
        assert.ok(/setProperty\("--abs-zoom"/.test(editor) && /positionedParent\(el\)/.test(editor), '편집기가 옮길 때 배율을 적는다');
    });

    await run('핵심 띠(css): 글은 3줄에서 말줄임으로 자르고, 고치는 동안에는 모두 보인다', () => {
        // '핵심' 딱지 다음 칸을 자른다(편집기가 고른 띠 끝에 손잡이를 달아도 그대로 잘리게 :last-child로 고르지 않는다)
        const clamp = cssRule(CSS, '.keybar > .klab + span');
        assert.ok(/-webkit-line-clamp\s*:\s*3/.test(clamp), clamp);
        assert.ok(/display\s*:\s*-webkit-box/.test(clamp) && /-webkit-box-orient\s*:\s*vertical/.test(clamp) && /overflow\s*:\s*hidden/.test(clamp), clamp);
        const editing = cssRule(CSS, '.keybar[contenteditable="true"] > .klab + span');
        assert.ok(/-webkit-line-clamp\s*:\s*(none|unset)/.test(editing), '고치는 동안에는 자르지 않는다');
        const ctx = makeContext();
        const drawn = ctx.KBuilder.renderDeckHtml(ctx.KBuilder.parseDeck(deckOf(slide(1, '가', '전개 1', ['첫 줄입니다'], ['- 핵심 메시지: 메시지 <b>굵게</b>']))));
        assert.ok(drawn.includes('<div class="keybar anim3"><span class="klab">핵심</span><span>메시지 &lt;b&gt;굵게&lt;/b&gt;</span></div>'), drawn);
        // 내보낸 HTML도 같은 css를 쓴다(export.js가 slides.css를 통째로 넣는다)
        assert.ok(source('kbuilder/export.js').includes('fetchText("css/kbuilder/slides.css")'));
    });

    await run('넘치면 줄이기(deck-runtime): 넘치는 동안 0.05씩 줄이고 0.7 아래로는 줄이지 않으며, 넘치지 않으면 표시를 지운다', () => {
        const ctx = makeContext();
        const fit = ctx.KBuilder.deckFit;
        assert.strictEqual(fit.FLOOR, 0.7);
        const fake = () => {
            const props = {};
            const attrs = {};
            return {
                props, attrs,
                style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: k => { delete props[k]; } },
                setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; }, hasAttribute: k => k in attrs
            };
        };
        const scale = el => Number(el.props['--fit'] || 1);
        // 0.85 이하에서 들어간다
        const a = fake();
        assert.strictEqual(fit.frame([a], () => (scale(a) > 0.86 ? 40 : 0)), 0.85);
        assert.deepStrictEqual([a.props['--fit'], 'data-fit' in a.attrs], ['0.85', true]);
        // 아무리 줄여도 넘치면 바닥에서 멈춘다
        const b = fake();
        let asked = 0;
        assert.strictEqual(fit.frame([b], () => { asked++; return 999; }), 0.7);
        assert.strictEqual(b.props['--fit'], '0.7');
        assert.ok(asked <= 8, `잰 횟수 ${asked}`);
        // 넘치지 않으면 예전 표시도 지운다
        const c = fake();
        c.props['--fit'] = '0.8';
        c.attrs['data-fit'] = '';
        assert.strictEqual(fit.frame([c], () => 0), 1);
        assert.deepStrictEqual([c.props, c.attrs], [{}, {}]);
        assert.strictEqual(fit.frame([], () => 999), 1, '줄일 칸이 없으면 그대로');
    });

    await run('넘치는 항목 넘기기(paginateDeck): 긴 목록은 (이어서) 슬라이드로 나누고 그림은 첫 장·핵심은 끝 장에 둔다. 짧은 슬라이드와 받은 값은 그대로', () => {
        const ctx = makeContext();
        const K = ctx.KBuilder;
        const long = n => `${n}번째 항목은 화면에 두 줄로 넘어갈 만큼 충분히 길게 쓴 설명 문장이며 서버와 클라이언트의 역할을 풀어 씁니다`;
        const deck = deckOf(
            slide(1, '표지', '-', ['(제목) 서버']),
            slide(2, '짧은 슬라이드', '전개 1', ['하나', '둘'], ['- 핵심 메시지: 짧다.']),
            ['### 슬라이드 3 - 긴 슬라이드', '- 대응 교수안: 전개 2', '- 슬라이드 문구:', ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap(n => [`  - ${long(n)}`, `    - ${n}의 덧붙임`]),
                `- 이미지/시각: 도식 ![](${PNG})`, '- 핵심 메시지: 길면 나눈다.', '']
        );
        const parsed = K.parseDeck(deck);
        const before = JSON.stringify(parsed);
        const paged = K.paginateDeck(parsed);
        assert.strictEqual(JSON.stringify(parsed), before, '받은 값은 바꾸지 않는다');
        const parts = paged.slides.filter(s => s.title.startsWith('긴 슬라이드'));
        assert.ok(parts.length >= 2, `나눈 장 수 ${parts.length}`);
        assert.deepStrictEqual(plain(parts.map(s => s.title)), ['긴 슬라이드', ...parts.slice(1).map(() => '긴 슬라이드 (이어서)')]);
        assert.deepStrictEqual(plain(parts.map(s => !!s.visual)), [true, ...parts.slice(1).map(() => false)], '그림은 첫 장에만');
        assert.deepStrictEqual(plain(parts.map(s => s.key)), [...parts.slice(1).map(() => ''), '길면 나눈다.'], '핵심은 끝 장에만');
        assert.strictEqual(new Set(paged.slides.map(s => s.num)).size, paged.slides.length, '번호(그림 칸 id)가 겹치지 않는다');
        assert.strictEqual(parts[0].num, '3', '첫 장은 번호 그대로(그림 칸 id가 바뀌지 않는다)');
        assert.ok(parts.every(s => (s.label || s.num) === '3'), '머리표 번호는 같다');
        assert.deepStrictEqual(plain(parts.flatMap(s => s.lines)), plain(parsed.slides[2].lines), '항목과 순서는 그대로');
        parts.forEach(s => assert.strictEqual(s.lines[0].depth, 0, '덧붙임 줄은 윗줄과 함께 간다'));
        const short = paged.slides.filter(s => s.title === '짧은 슬라이드');
        assert.strictEqual(short.length, 1);
        assert.deepStrictEqual(plain(short[0]), plain(parsed.slides[1]));
        // 그린 글: 나눈 장마다 핵심 띠는 많아야 하나, 본문 뒤에 온다
        const html = K.renderDeckHtml(paged);
        const sections = html.split('<section ').slice(1);
        assert.strictEqual(sections.length, paged.slides.length);
        sections.forEach(section => {
            assert.ok((section.match(/class="keybar/g) || []).length <= 1);
            if (section.includes('class="keybar')) assert.ok(section.indexOf('class="cols') < section.indexOf('class="keybar'), '띠는 본문 뒤(흐름 안)에 온다');
        });
    });

    /* ======================= 2. 핵심 메시지 ======================= */
    await run('만들 때 지시: 핵심 메시지는 한두 문장·90자 이내로 쓰라고 두 형식 모두에 넣는다', async () => {
        for (const style of ['presentation', 'detailed']) {
            const ctx = makeContext({ storage: { 'kb-slide-style': style } });
            videoLesson(ctx);
            assert.strictEqual(await ctx.generateGyosuan('m1'), true, ctx.alerts.join('\n'));
            const prompt = ctx.prompts.find(body => body.includes('@@GYOSUAN@@'));
            assert.ok(prompt.includes('[슬라이드 규칙]'));
            assert.ok(/- 핵심 메시지는 한두 문장[^\n]*90자 이내/.test(prompt), `${style}: ${prompt}`);
            assert.ok(/- 핵심 메시지: \([^)\n]*90자 이내[^)\n]*\)/.test(prompt), `${style}: 양식 줄에도 길이를 적는다`);
        }
    });

    await run('긴 핵심 줄 줄이기(tidy): 90자를 넘으면 들어가는 앞 문장까지만 남긴다. 낱말 가운데서 자르지 않고, 문장 경계가 없으면 그대로 둔다', () => {
        const ctx = makeContext();
        const tidy = call(ctx, 'tidyGyosuanDeck');
        const s1 = '완벽한 보안을 위해 클라이언트는 바보(Dumb Client)가 되어야 한다.';
        const s2 = '대규모 게임은 단일 서버로 감당할 수 없으므로 역할을 나눈 분산 아키텍처가 필수적임.';
        const s3 = '로그인 서버: 계정 인증 및 1차 접근 통제. 로비 서버: 유저 대기실 및 게임 월드 배정.';
        const head = ['### 슬라이드 1 - 서버-클라이언트의 역할 분담', '- 슬라이드 문구:', '  - 서버는 심판'];
        const deck = key => [...head, ...key, ''].join('\n');
        // 두 문장까지 들어간다(89자), 세 문장은 넘친다
        assert.ok(`${s1} ${s2}`.length <= 90 && `${s1} ${s2} ${s3}`.length > 90);
        assert.strictEqual(tidy(deck([`- 핵심 메시지: ${s1} ${s2} ${s3}`])), deck([`- 핵심 메시지: ${s1} ${s2}`]));
        // 덧붙임 줄로 이어 쓴 핵심도 합쳐서 본다(슬라이드는 이어 붙여 그린다)
        assert.strictEqual(tidy(deck([`- 핵심 메시지: ${s1}`, `  - ${s2}`, `  - ${s3}`])), deck([`- 핵심 메시지: ${s1} ${s2}`]));
        // 다시 다듬어도 같다 · 90자 이하는 그대로
        const once = tidy(deck([`- 핵심 메시지: ${s1} ${s2} ${s3}`]));
        assert.strictEqual(tidy(once), once);
        const short = deck([`- 핵심 메시지: ${s1}`]);
        assert.strictEqual(tidy(short), short);
        // 첫 문장부터 90자를 넘거나 문장 경계가 없으면 그대로(낱말 가운데서 자르지 않는다)
        const oneLong = deck([`- 핵심 메시지: ${'서버가 모든 판정을 맡고 클라이언트는 입력과 표현만 맡는 구조여야 한다는 점을 '.repeat(3)}기억한다.`]);
        assert.strictEqual(tidy(oneLong), oneLong);
        const noStop = deck([`- 핵심 메시지: ${'경계 없는 긴 글 '.repeat(14)}`.trimEnd()]);
        assert.strictEqual(tidy(noStop), noStop);
        // 굵게·코드 표시가 문장을 넘어 이어지면 그대로 둔다
        const bold = deck([`- 핵심 메시지: **${s1} ${s2}** ${s3}`]);
        assert.strictEqual(tidy(bold), bold);
        const code = deck([`- 핵심 메시지: \`${s1} ${s2}\` ${s3}`]);
        assert.strictEqual(tidy(code), code);
        // 숫자의 점(1.5배)에서는 끊지 않는다
        const number = deck([`- 핵심 메시지: 속도를 1.5배로 올리면 판정 오차도 1.5배로 커진다는 점을 기억해야 한다. ${s2} ${s3}`]);
        assert.ok(tidy(number).includes('- 핵심 메시지: 속도를 1.5배로 올리면 판정 오차도 1.5배로 커진다는 점을 기억해야 한다.\n'), tidy(number));
    });

    await run('스튜디오에 넘길 때: 화면 편집본이 없는 예전 편성안의 긴 핵심도 줄여 넘기고, 저장한 편성안과 화면 편집본이 있는 덱은 그대로 둔다', () => {
        const ctx = makeContext();
        const longKey = '완벽한 보안을 위해 클라이언트는 바보가 되어야 한다. 대규모 게임은 단일 서버로 감당할 수 없다. 로그인 서버는 계정 인증을 맡는다. 로비 서버는 대기실과 월드 배정을 맡는다. 게임 서버는 실시간 코어 루프를 맡는다.';
        const deckMd = deckOf(slide(1, '역할 분담', '전개 1', ['서버는 심판'], [`- 핵심 메시지: ${longKey}`]));
        const mod = { id: 'm1', title: '서버', images: {}, tabContents: { basicLearn: `## 역할\n\n${LONG}` }, gyosuan: { docMd: '# 교수안 - 서버', deckMd, deckRev: 1 } };
        ctx.getEditingModule = id => (String(id) === 'm1' ? mod : null);
        const keyOf = payload => ctx.KBuilder.parseDeck(payload.deckMd).slides[0].key;
        const shown = keyOf(ctx.getSlideStudioPayload('m1'));
        assert.ok(shown.length <= 90 && longKey.startsWith(shown) && /[.]$/.test(shown), shown);
        assert.strictEqual(mod.gyosuan.deckMd, deckMd, '저장한 편성안은 그대로');
        mod.gyosuan = { ...mod.gyosuan, deckHtml: '<section class="slide">편집</section>' };
        assert.strictEqual(keyOf(ctx.getSlideStudioPayload('m1')), longKey, '화면 편집본이 있으면 손대지 않는다(띠는 css가 3줄로 자른다)');
    });

    /* ======================= 3. 영상: 편성안 양식과 인용 ======================= */
    await run('편성안 양식(parseDeck): 영상 칸은 [제목](가리키는 값)으로 읽고, 허용한 모양(판서·넣은 파일·GIF·http 주소)만 받는다. 영상만 있는 슬라이드는 영상 슬라이드다', () => {
        const ctx = makeContext();
        const K = ctx.KBuilder;
        const deck = deckOf(
            slide(1, '서버의 역할', '전개 1', ['서버는 심판'], ['- 영상: [서버 구조 판서](wb:img_wb1)', '  - [intro.mp4](local:vid_intro000001)', '- 핵심 메시지: 서버가 판정한다.']),
            ['### 슬라이드 2 - 영상: 요청과 응답 정리', '- 영상: [요청과 응답 정리](gif:img_gif1)', ''],
            slide(3, '주소', '전개 2', ['주소로 넣은 영상'], [`- 영상: [YouTube 영상](${YT}?start=90)`]),
            slide(4, '글로 쓴 영상', '전개 2', ['첫 줄'], ['- 영상: 시청 후 토론', '- 영상: [나쁜 주소](javascript:alert(1))', '- 영상: [따옴표](https://a.example/"onload="x)'])
        );
        const slides = K.parseDeck(deck).slides;
        assert.deepStrictEqual(plain(slides[0].videos), [{ ref: 'wb:img_wb1', title: '서버 구조 판서' }, { ref: 'local:vid_intro000001', title: 'intro.mp4' }]);
        assert.strictEqual(slides[0].key, '서버가 판정한다.');
        assert.deepStrictEqual(plain([slides[1].kind, slides[1].videos]), ['video', [{ ref: 'gif:img_gif1', title: '요청과 응답 정리' }]], "제목에 '정리'가 있어도 영상 슬라이드다");
        assert.deepStrictEqual(plain(slides[2].videos), [{ ref: `${YT}?start=90`, title: 'YouTube 영상' }]);
        assert.deepStrictEqual(plain(slides[3].videos), [], '모양이 다른 값은 영상으로 읽지 않는다');
        assert.ok(slides[3].lines.some(line => line.text.includes('시청 후 토론')), '글로 쓴 줄은 예전처럼 문구로 남는다');
        assert.strictEqual(K.parseVideoField('[제목](wb:img_1)').ref, 'wb:img_1');
        // '영상:'으로 시작하는 문구(영상을 가리키지 않는 글)는 예전과 똑같이 읽고 다듬는다: 문구 칸 아래면 문구 줄, 그림 칸 아래면 그림 설명에 딸린 줄
        const texty = ['### 슬라이드 1 - 시청', '- 슬라이드 문구:', '  - 첫 줄', '- 영상:', '  - 시청 후 토론', '  - 느낀 점 나누기', '- 이미지/시각: 도식', '- 영상: 시청 안내', '- 핵심 메시지: 메시지', ''].join('\n');
        const [read] = K.parseDeck(texty).slides;
        assert.deepStrictEqual(plain([read.videos, read.lines.map(line => line.text), read.visual, read.kind]), [[], ['첫 줄', '영상:', '시청 후 토론', '느낀 점 나누기'], '도식 영상: 시청 안내', 'content']);
        const tidy = call(ctx, 'tidyGyosuanDeck');
        assert.strictEqual(tidy(texty), texty.replace('- 이미지/시각: 도식\n- 영상: 시청 안내\n', ''), '그림 없는 그림 칸에 딸린 글 줄은 예전처럼 함께 뺀다');
        // 값 없는 '영상:' 아래에 영상 줄을 들여 써도 영상 칸이다(그림 없는 그림 칸을 덜어도 남는다)
        const listed = ['### 슬라이드 1 - 가', '- 슬라이드 문구:', '  - 가', '- 이미지/시각: 도식', '- 영상:', '  - [판서](wb:img_wb1)', '  - [파일](local:vid_intro000001)', ''].join('\n');
        assert.deepStrictEqual(plain(K.parseDeck(listed).slides[0].videos.map(v => v.ref)), ['wb:img_wb1', 'local:vid_intro000001']);
        assert.strictEqual(tidy(listed), listed.replace('- 이미지/시각: 도식\n', ''));
        ['[x](data:video/mp4;base64,AAAA)', '[x](local:img_1)', '[x](wb:)', '[x](ftp://a/b.mp4)', 'wb:img 1'].forEach(bad => assert.strictEqual(K.parseVideoField(bad), null, bad));
    });

    await run('갈래의 영상 모으기: 그 갈래의 학습·실습 탭에 놓인 판서 영상·넣은 파일·YouTube·mp4 주소·움직이는 GIF만, 놓인 절과 함께 모은다(영상 값은 담지 않는다)', () => {
        const ctx = makeContext();
        const mod = videoLesson(ctx);
        const list = call(ctx, 'lessonTrackVideos');
        const basic = plain(list(mod, 'basic'));
        assert.deepStrictEqual(basic.map(v => [v.ref, v.section, v.number]), [
            ['local:vid_intro000001', '서버의 역할', 1],
            ['wb:img_wb1', '동기화', 2],
            [YT, '실습: 에코 서버', 3]
        ]);
        assert.deepStrictEqual(basic.map(v => v.title), ['intro.mp4', '서버 구조 판서', 'YouTube 영상']);
        const adv = plain(list(mod, 'adv'));
        assert.deepStrictEqual(adv.map(v => [v.ref, v.section, v.number]), [['gif:img_gif1', '지연 보상', 1], ['https://cdn.example.com/lag.mp4', '지연 보상', 1]]);
        assert.deepStrictEqual(adv.map(v => v.title), ['요청과 응답이 오가는 흐름', 'lag.mp4']);
        assert.ok(!JSON.stringify([basic, adv]).includes('base64'), '영상·그림 값은 담지 않는다');
        // 없는 파일·푼 판서 영상·되돌린 GIF·코드 블록 속 예제·허용하지 않은 삽입 주소는 모으지 않는다
        const gone = { ...mod, lessonVideos: {}, whiteboardVideos: {}, imageMotions: {}, tabContents: { ...mod.tabContents, basicPrac: '## 실습\n\n```html\n' + youtubeVideo('dQw4w9WgXcQ') + '\n```\n\n<iframe src="https://evil.example.com/embed/dQw4w9WgXcQ"></iframe>' } };
        assert.deepStrictEqual(plain(list(gone, 'basic')), []);
        assert.deepStrictEqual(plain(list(gone, 'adv')).map(v => v.ref), ['https://cdn.example.com/lag.mp4']);
    });

    await run('편성안에 인용하기: 그 절(전개 N)의 슬라이드에 영상 줄을 달고, 자리가 없으면 그 절 뒤에, 맞는 절이 없으면 마무리 앞에 영상 슬라이드를 넣는다. 다시 해도 같다', () => {
        const ctx = makeContext();
        const cite = call(ctx, 'citeDeckVideos');
        const videos = [
            { ref: 'wb:img_wb1', title: '서버 구조 판서', number: 1 },
            { ref: 'local:vid_intro000001', title: 'intro.mp4', number: 1 },
            { ref: YT, title: 'YouTube 영상', number: 0 }
        ];
        const out = cite(BASE_DECK, videos);
        assert.deepStrictEqual(plain(out.added), videos.map(v => v.ref));
        const slides = ctx.KBuilder.parseDeck(out.deckMd).slides;
        assert.deepStrictEqual(plain(slides.map(s => [s.num, s.title, s.maps, s.videos.map(v => v.ref)])), [
            ['1', '표지', '-', []],
            ['2', '목차', '-', []],
            ['3', '서버의 역할', '전개 1', ['wb:img_wb1']],
            ['4', '영상: intro.mp4', '전개 1', ['local:vid_intro000001']],
            ['5', '동기화', '전개 2', []],
            ['6', '에코 서버', '전개 3', []],
            ['7', '영상: YouTube 영상', '', [YT]],
            ['8', '마무리', '정리', []]
        ]);
        assert.strictEqual(slides[2].key, '서버가 판정한다.', '핵심 메시지는 그대로');
        assert.ok(out.deckMd.includes('- 영상: [서버 구조 판서](wb:img_wb1)\n- 핵심 메시지: 서버가 판정한다.'), '영상 줄은 핵심 메시지 앞에');
        assert.ok(out.deckMd.endsWith('## 비고\n\n- 초안입니다.\n'), '비고는 그대로');
        const again = cite(out.deckMd, videos);
        assert.deepStrictEqual([again.deckMd, plain(again.added)], [out.deckMd, []], '이미 인용한 영상은 다시 넣지 않는다');
        assert.strictEqual(cite(BASE_DECK, []).deckMd, BASE_DECK, '영상이 없으면 받은 글 그대로');
        // 제목의 대괄호·줄바꿈은 뺀다(양식이 깨지지 않게). CRLF 글은 CRLF로
        const odd = cite(BASE_DECK.replace(/\n/g, '\r\n'), [{ ref: 'wb:img_wb1', title: '판서 [1]\n둘째 줄', number: 2 }]).deckMd;
        assert.ok(odd.includes('- 영상: [판서 1 둘째 줄](wb:img_wb1)\r\n'), odd);
        assert.ok(!/[^\r]\n/.test(odd), 'CRLF 그대로');
        // 편성안이 이미 그 그림을 쓰면(GIF) 영상으로 한 번 더 넣지 않는다
        const withGif = BASE_DECK.replace('- 핵심 메시지: 같은 화면을 본다.', '- 이미지/시각: 흐름 ![](local:img_gif1)\n- 핵심 메시지: 같은 화면을 본다.');
        assert.deepStrictEqual(plain(cite(withGif, [{ ref: 'gif:img_gif1', title: '흐름', number: 2 }]).added), []);
    });

    await run('만들 때 인용: 갈래마다 그 갈래 탭의 영상만 그 절의 슬라이드에 넣고(영상 값은 편성안에 넣지 않는다), 다듬기를 지나도 영상 줄이 남는다', async () => {
        const ctx = makeContext();
        const mod = videoLesson(ctx);
        assert.strictEqual(await ctx.generateGyosuan('m1'), true, ctx.alerts.join('\n'));
        assert.strictEqual(await ctx.generateGyosuan('m1', { track: 'adv' }), true, ctx.alerts.join('\n'));
        const refs = gyosuan => ctx.KBuilder.parseDeck(gyosuan.deckMd).slides.filter(s => s.videos.length).map(s => [s.maps, s.videos.map(v => v.ref)]);
        assert.deepStrictEqual(plain(refs(mod.gyosuan)), [['전개 1', ['local:vid_intro000001']], ['전개 2', ['wb:img_wb1']], ['전개 3', [YT]]]);
        assert.deepStrictEqual(plain(refs(mod.gyosuanAdv)), [['전개 1', ['gif:img_gif1']], ['전개 1', ['https://cdn.example.com/lag.mp4']]]);
        assert.deepStrictEqual(plain(mod.gyosuan.citedVideos), ['local:vid_intro000001', 'wb:img_wb1', YT]);
        assert.ok(![mod.gyosuan.deckMd, mod.gyosuanAdv.deckMd].some(md => /data:(video|image)\//.test(md)), '영상·그림 값은 편성안에 넣지 않는다');
        const tidy = call(ctx, 'tidyGyosuanDeck');
        assert.strictEqual(tidy(mod.gyosuan.deckMd), mod.gyosuan.deckMd, '다듬어도 영상 줄은 그대로');
        // 그림 없는 이미지/시각 줄을 덜어도 그 아래 영상 줄은 남는다
        const dead = '### 슬라이드 1 - 가\n- 슬라이드 문구:\n  - 가\n- 이미지/시각: 도식\n- 영상: [판서](wb:img_wb1)\n- 핵심 메시지: 메시지\n';
        assert.strictEqual(tidy(dead), dead.replace('- 이미지/시각: 도식\n', ''));
        const only = '### 슬라이드 1 - 영상: 판서\n- 이미지/시각: 도식\n- 영상: [판서](wb:img_wb1)\n';
        assert.strictEqual(tidy(only), only.replace('- 이미지/시각: 도식\n', ''), '영상만 남은 슬라이드는 빼지 않는다');
        // 영상이 없는 차시는 예전과 같다(칸을 만들지 않는다)
        const none = makeContext();
        const bare = { id: 'm1', title: '서버', hours: 1, images: {}, tabContents: { basicLearn: `## 1. 역할 (⏱ 30분)\n\n${LONG}` } };
        none.getEditingModule = () => bare;
        assert.strictEqual(await none.generateGyosuan('m1'), true);
        assert.ok(!('citedVideos' in bare.gyosuan) && !bare.gyosuan.deckMd.includes('영상:'));
    });

    await run('이미 만든 덱: 화면 편집본이 없으면 열 때 그 갈래의 영상을 인용해 넘기고(저장한 편성안은 그대로), 화면 편집본이 있으면 손대지 않으며, 지운 영상 줄은 되살리지 않는다', () => {
        const ctx = makeContext();
        const mod = videoLesson(ctx);
        const doc = ['# 교수안 - 서버', '', '## 수업 흐름 한눈에 보기', '', '| 단계 | 시간 | 핵심 |', '|---|---|---|', '| 도입 | 10분 | 열기 |', '| 전개 1 | 30분 | 역할 |', '| 전개 2 | 30분 | 동기화 |', '| 전개 3 | 40분 | 실습 |', '| 정리 | 10분 | 닫기 |', '',
            '## 진행', '', '### 도입 - 열기', '', '**설명 내용**: 연다.', '', '### 전개 1 - 서버의 역할', '', '**설명 내용**: 역할.', '', '### 전개 2 - 동기화', '', '**설명 내용**: 동기화.', '',
            '### 전개 3 - 활동: 에코 서버', '', '**설명 내용**: 실습.', '', '### 정리 - 닫기', '', '**설명 내용**: 닫는다.', ''].join('\n');
        mod.gyosuan = { docMd: doc, deckMd: BASE_DECK, deckRev: 3 };
        const refsOf = payload => ctx.KBuilder.parseDeck(payload.deckMd).slides.filter(s => s.videos.length).map(s => [s.title, s.videos.map(v => v.ref)]);
        const whole = ctx.getSlideStudioPayload('m1');
        assert.deepStrictEqual(plain(refsOf(whole)), [['서버의 역할', ['local:vid_intro000001']], ['동기화', ['wb:img_wb1']], ['에코 서버', [YT]]]);
        assert.strictEqual(mod.gyosuan.deckMd, BASE_DECK, '저장한 편성안은 그대로');
        assert.ok(!('citedVideos' in mod.gyosuan));
        // 심화학습 덱은 심화 탭의 영상만
        mod.gyosuanAdv = { docMd: doc, deckMd: BASE_DECK.replace('1. 서버의 역할', '1. 지연 보상').replace('### 슬라이드 3 - 서버의 역할', '### 슬라이드 3 - 지연 보상'), deckRev: 1 };
        assert.deepStrictEqual(plain(refsOf(ctx.getSlideStudioPayload('m1~adv')).flatMap(([, refs]) => refs)), ['gif:img_gif1', 'https://cdn.example.com/lag.mp4']);
        // 차시 하나만 연 덱에도 그 차시에 든 절의 영상이 들어간다
        const sessions = whole.sessions.map(item => refsOf(ctx.getSlideStudioPayload('m1', item.index)).flatMap(([, refs]) => refs));
        assert.deepStrictEqual(plain(sessions.flat().sort()), ['local:vid_intro000001', 'wb:img_wb1', YT].sort(), JSON.stringify(sessions));
        // 그 덱이 보여야 하는 영상 목록(getSlideStudioVideos): 가리키는 값과 제목만(영상 값은 없다)
        const listed = plain(ctx.getSlideStudioVideos('m1'));
        assert.deepStrictEqual(listed, [{ ref: 'local:vid_intro000001', title: 'intro.mp4' }, { ref: 'wb:img_wb1', title: '서버 구조 판서' }, { ref: YT, title: 'YouTube 영상' }]);
        assert.deepStrictEqual(plain(ctx.getSlideStudioVideos('m1~adv')).map(v => v.ref), ['gif:img_gif1', 'https://cdn.example.com/lag.mp4']);
        assert.deepStrictEqual(plain(ctx.getSlideStudioVideos('none')), []);
        // 화면 편집본이 있으면 편성안을 건드리지 않는다. 영상 목록은 그대로 주어, 스튜디오가 그 덱에 아직 없는 영상을 영상 슬라이드로 더한다
        mod.gyosuan = { ...mod.gyosuan, deckHtml: '<section class="slide">편집</section>' };
        assert.deepStrictEqual(plain(refsOf(ctx.getSlideStudioPayload('m1'))), []);
        assert.deepStrictEqual(plain(ctx.getSlideStudioVideos('m1')), listed);
        const perSession = plain(whole.sessions).map(item => plain(ctx.getSlideStudioVideos('m1', item.index)).map(v => v.ref));
        assert.deepStrictEqual(perSession.flat().sort(), listed.map(v => v.ref).sort(), '차시 덱은 그 차시의 영상만');
        assert.ok(perSession.length > 1 && perSession.every(refs => refs.length < listed.length), JSON.stringify(perSession));
        // 차시 글이 이상해 영상을 모으다 멈춰도(남이 준 파일의 탭 값이 글이 아님) 슬라이드는 영상 없이 연다
        const broken = { ...mod, tabContents: { ...mod.tabContents, basicLearn: { not: 'text' } }, gyosuan: { docMd: doc, deckMd: BASE_DECK, deckRev: 5 } };
        ctx.getEditingModule = id => (String(id) === 'm1' ? broken : null);
        assert.throws(() => call(ctx, 'lessonTrackVideos')(broken, 'basic'));
        assert.deepStrictEqual(plain(refsOf(ctx.getSlideStudioPayload('m1'))), []);
        assert.strictEqual(ctx.KBuilder.parseDeck(ctx.getSlideStudioPayload('m1').deckMd).slides.length, 6, '덱은 그대로 연다');
        assert.deepStrictEqual(plain(ctx.getSlideStudioVideos('m1')), []);
        assert.strictEqual(call(ctx, 'withLessonVideos')({ deckMd: BASE_DECK }, broken, 'basic').deckMd, BASE_DECK, '만들 때도 영상 없이 이어 간다');
        ctx.getEditingModule = id => (String(id) === 'm1' ? mod : null);
        // 만들 때 인용했다가 강사가 편성안에서 지운 영상(citedVideos에 있다)은 되살리지 않고, 그 뒤에 넣은 영상만 더한다
        mod.gyosuan = { docMd: doc, deckMd: BASE_DECK, deckRev: 4, citedVideos: ['local:vid_intro000001', 'wb:img_wb1'] };
        assert.deepStrictEqual(plain(refsOf(ctx.getSlideStudioPayload('m1'))), [['에코 서버', [YT]]]);
    });

    await run('영상 찾기(getSlideStudioVideo): 가리키는 값을 그 차시의 영상으로 풀고(영상 값은 주지 않는다), 없는 것·허용하지 않은 주소는 null. 파일은 따로 Blob으로 준다', async () => {
        const blob = new Blob([Buffer.from('wb-video')], { type: 'video/mp4' });
        const ctx = makeContext({ videoStore: { 'wbvideo:wb_abc123': blob } });
        const mod = videoLesson(ctx);
        const info = ref => plain(ctx.getSlideStudioVideo('m1', ref));
        assert.deepStrictEqual(info('local:vid_intro000001'), { kind: 'local', type: 'video/mp4' });
        assert.deepStrictEqual(info('wb:img_wb1'), { kind: 'wb', title: '서버 구조 판서', poster: PNG });
        assert.deepStrictEqual(info('gif:img_gif1'), { kind: 'gif', src: GIF });
        assert.deepStrictEqual(info(`${YT}?start=90`), { kind: 'youtube', embed: `${YT}?start=90`, link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', linkText: 'YouTube에서 보기' });
        assert.deepStrictEqual(info('https://vimeo.com/123456'), { kind: 'vimeo', embed: 'https://player.vimeo.com/video/123456?dnt=1', link: 'https://vimeo.com/123456', linkText: 'Vimeo에서 보기' });
        assert.deepStrictEqual(info('https://cdn.example.com/lag.mp4'), { kind: 'file', src: 'https://cdn.example.com/lag.mp4', link: 'https://cdn.example.com/lag.mp4', linkText: '동영상 파일 주소' });
        ['local:vid_missing00001', 'wb:img_plain', 'gif:img_plain', 'gif:img_wb1', 'https://evil.example.com/embed/dQw4w9WgXcQ', 'https://evil.example.com/a.exe', 'javascript:alert(1)',
            'http://user:pw@cdn.example.com/a.mp4', 'local:img_wb1', 'wb:__proto__', '', null].forEach(ref => assert.strictEqual(ctx.getSlideStudioVideo('m1', ref), null, String(ref)));
        assert.strictEqual(ctx.getSlideStudioVideo('none', 'wb:img_wb1'), null, '없는 차시');
        // 심화학습 덱(~adv)도 같은 차시의 영상을 푼다
        assert.strictEqual(ctx.getSlideStudioVideo('m1~adv', 'gif:img_gif1').kind, 'gif');
        const local = await ctx.getSlideStudioVideoBlob('m1', 'local:vid_intro000001');
        assert.ok(local instanceof Blob && local.type === 'video/mp4' && local.size > 0);
        assert.strictEqual(await ctx.getSlideStudioVideoBlob('m1', 'wb:img_wb1'), blob);
        assert.strictEqual(await ctx.getSlideStudioVideoBlob('m1', 'gif:img_gif1'), null);
        assert.strictEqual(await ctx.getSlideStudioVideoBlob('m1', YT), null);
        mod.whiteboardVideos = { img_wb1: { id: 'wb_nofile', title: '없는 파일' } };
        assert.strictEqual(await ctx.getSlideStudioVideoBlob('m1', 'wb:img_wb1'), null, '이 브라우저에 파일이 없으면 null');
    });

    /* ======================= 4. 영상: 그리기 ======================= */
    const videoSource = {
        info: ref => ({
            'wb:img_wb1': { kind: 'wb', title: '서버 구조 판서', poster: PNG },
            'local:vid_intro000001': { kind: 'local', type: 'video/mp4' },
            'gif:img_gif1': { kind: 'gif', src: GIF },
            [YT]: { kind: 'youtube', embed: YT, link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', linkText: 'YouTube에서 보기' },
            'https://cdn.example.com/lag.mp4': { kind: 'file', src: 'https://cdn.example.com/lag.mp4', link: 'https://cdn.example.com/lag.mp4', linkText: '동영상 파일 주소' },
            'https://bad.example/x': { kind: 'youtube', embed: 'https://bad.example/embed/x', link: 'javascript:alert(1)', linkText: '나쁜 링크' }
        }[ref] || null),
        blob: async ref => (ref === 'local:vid_intro000001' || ref === 'wb:img_wb1' ? new Blob([Buffer.from('video-bytes')], { type: 'video/mp4' }) : null)
    };

    await run('슬라이드에 그리기: 글만 있는 슬라이드는 옆 칸에 영상을, 그림이 있거나 옆 칸이 없는 배치는 바로 뒤 영상 슬라이드에 그린다. 저장되는 글에는 가리키는 값과 제목·링크만 남는다', () => {
        const ctx = makeContext();
        const K = ctx.KBuilder;
        K.videoSource = videoSource;
        const deck = deckOf(
            slide(1, '서버의 역할', '전개 1', ['서버는 모든 판정을 맡는 심판 역할을 한다는 점을 기억합니다', '클라이언트는 입력을 받고 서버가 알려 준 결과를 화면에 그립니다'], ['- 영상: [서버 구조 판서](wb:img_wb1)', '- 핵심 메시지: 서버가 판정한다.']),
            slide(2, '동기화', '전개 2', ['상태를 맞춘다'], [`- 이미지/시각: 도식 ![](${PNG})`, `- 영상: [YouTube 영상](${YT})`]),
            slide(3, '비교', '전개 2', ['서버: 판정 · 저장', '클라이언트: 입력 · 표현'], ['- 영상: [intro.mp4](local:vid_intro000001)']),
            ['### 슬라이드 4 - 영상: 요청과 응답', '- 영상: [요청과 응답 <b>"흐름"</b>](gif:img_gif1)', '- 핵심 메시지: 오가는 흐름을 본다.', '']
        );
        const paged = K.paginateDeck(K.parseDeck(deck));
        assert.deepStrictEqual(plain(paged.slides.map(s => [s.title, s.kind, K.slideLayout(s), s.videos.map(v => v.ref)])), [
            ['서버의 역할', 'content', 'content', ['wb:img_wb1']],
            ['동기화', 'content', 'content', []],
            ['동기화', 'video', 'video', [YT]],
            ['비교', 'content', 'compare', []],
            ['비교', 'video', 'video', ['local:vid_intro000001']],
            ['영상: 요청과 응답', 'video', 'video', ['gif:img_gif1']]
        ]);
        const sections = K.renderDeckHtml(paged).split('<section ').slice(1);
        // 옆 칸 영상
        assert.ok(/class="cols has-video[^"]*"/.test(sections[0]) && /<div class="col-side pop"><div class="slide-video"/.test(sections[0]), sections[0]);
        assert.ok(sections[0].includes('data-video-ref="wb:img_wb1"') && sections[0].includes('data-video-kind="wb"'));
        assert.ok(sections[0].includes('<span class="sv-title">서버 구조 판서</span>'));
        assert.ok(sections[0].indexOf('slide-video') < sections[0].indexOf('class="keybar'), '핵심 띠는 영상 뒤에');
        // 그림이 있는 슬라이드는 그림을 두고 영상은 뒤 슬라이드에
        assert.ok(sections[1].includes('<image-slot') && !sections[1].includes('slide-video'));
        assert.ok(sections[2].includes('class="video-body"') && sections[2].includes(`data-video-ref="${YT}"`));
        assert.ok(sections[2].includes('<a class="sv-link" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer">YouTube에서 보기</a>'), sections[2]);
        // 비교 배치는 그대로 그리고 영상은 뒤 슬라이드에
        assert.ok(sections[3].includes('class="cmp-grid') && !sections[3].includes('slide-video'));
        assert.ok(sections[4].includes('data-video-ref="local:vid_intro000001"') && sections[4].includes('data-video-kind="local"'));
        // 영상 슬라이드: 제목의 '영상:'은 머리표로, 제목 글자는 이스케이프한다
        assert.ok(sections[5].includes('kind-video') && sections[5].includes('영상 · 04') && sections[5].includes('<h2 class="slidetitle">요청과 응답</h2>'), sections[5]);
        assert.ok(sections[5].includes('요청과 응답 &lt;b&gt;&quot;흐름&quot;&lt;/b&gt;') && !sections[5].includes('<b>"흐름"'), '제목은 글자로만');
        assert.ok(sections[5].includes('class="keybar'));
        // 그린 글에는 재생기·영상 값이 없다(재생기는 화면에서만 붙인다)
        const html = sections.join('');
        assert.ok(!/<iframe|<video|blob:|data:video/.test(html), '재생기와 영상 값은 저장되는 글에 없다');
        // 못 푼 값·나쁜 링크는 제목만 남긴다
        const odd = K.renderDeckHtml(K.paginateDeck(K.parseDeck(deckOf(
            ['### 슬라이드 1 - 영상: 없는 영상', '- 영상: [없는 영상](wb:img_none)', ''],
            ['### 슬라이드 2 - 영상: 나쁜 링크', '- 영상: [나쁜 링크](https://bad.example/x)', '']
        ))));
        assert.ok(odd.includes('data-video-ref="wb:img_none"') && odd.includes('data-video-kind=""'));
        assert.ok(!odd.includes('javascript:') && !odd.includes('sv-link'), odd);
    });

    await run('화면 편집본에 영상 더하기(deckVideo.offer): 그 덱에 아직 보인 적 없는 영상만 마무리 앞에 영상 슬라이드로 더하고, 보인 영상을 적어 두어 지운 영상 칸은 되살리지 않는다', () => {
        const ctx = makeContext();
        const K = ctx.KBuilder;
        K.videoSource = videoSource;
        const offer = K.deckVideo.offer;
        // 13차 전에 저장한 덱(영상 칸·표시 없음)
        const stage = K.inertRoot('<section class="slide kind-content"><div class="frame"><h2 class="slidetitle">본문</h2></div></section><section class="slide kind-closing"><div class="frame closing solo">끝</div></section>');
        const videos = [{ ref: 'wb:img_wb1', title: '서버 구조 판서' }, { ref: YT, title: 'YouTube <영상>' }, { ref: 'javascript:alert(1)', title: '나쁜 값' }, { ref: 'wb:img_wb1', title: '같은 영상' }];
        assert.strictEqual(offer(stage, videos, { '주제': '서버' }), 2);
        const list = (rootEl, selector, read) => Array.from(Array.prototype.slice.call(rootEl.querySelectorAll(selector)), read); // domino 목록 → 배열
        const kinds = () => list(stage, '.slide', el => el.getAttribute('class').replace('slide ', ''));
        const refs = () => list(stage, '[data-video-ref]', el => el.getAttribute('data-video-ref'));
        assert.deepStrictEqual(kinds(), ['kind-content', 'kind-video', 'kind-video', 'kind-closing'], '마무리 앞에 넣는다');
        assert.deepStrictEqual(refs(), ['wb:img_wb1', YT]);
        assert.ok(stage.innerHTML.includes('YouTube &lt;영상&gt;') && !stage.innerHTML.includes('javascript:'), '제목은 글자로, 나쁜 값은 버린다');
        const note = stage.firstChild;
        assert.strictEqual(note.getAttribute('class'), 'deck-videos');
        assert.ok(note.hasAttribute('hidden'));
        assert.deepStrictEqual(note.getAttribute('data-seen').split(' ').sort(), ['wb:img_wb1', YT].sort());
        const once = stage.innerHTML;
        assert.strictEqual(offer(stage, videos, {}), 0);
        assert.strictEqual(stage.innerHTML, once, '다시 해도 같다');
        // 강사가 영상 슬라이드를 지웠다 → 되살리지 않는다. 그 뒤에 넣은 영상만 더한다
        const gone = stage.querySelectorAll('.slide')[1];
        gone.parentNode.removeChild(gone);
        assert.strictEqual(offer(stage, [...videos, { ref: 'gif:img_gif1', title: '흐름' }], {}), 1);
        assert.deepStrictEqual(refs(), [YT, 'gif:img_gif1']);
        // 영상이 없는 덱은 건드리지 않는다(표시도 두지 않는다)
        const plainStage = K.inertRoot('<section class="slide kind-content">가</section>');
        const before = plainStage.innerHTML;
        assert.strictEqual(offer(plainStage, [], {}), 0);
        assert.strictEqual(plainStage.innerHTML, before);
        // 마무리 슬라이드가 없으면 맨 끝에. 표시는 저장본 정리(불러오기)를 지나도 남는다
        assert.strictEqual(offer(plainStage, [{ ref: 'wb:img_wb1', title: '판서' }], {}), 1);
        assert.deepStrictEqual(list(plainStage, '.slide', el => el.getAttribute('class')), ['slide kind-content', 'slide kind-video']);
        const kept = K.inertRoot(K.sanitizeDeckHtml(plainStage.innerHTML));
        assert.strictEqual(offer(kept, [{ ref: 'wb:img_wb1', title: '판서' }], {}), 0);
        assert.ok(/\.deck-videos\s*\{[^}]*display\s*:\s*none/.test(CSS), '표시는 화면에 보이지 않는다');
        const studio = source('kbuilder/studio.js');
        assert.ok(/parentFn\("getSlideStudioVideos"\)/.test(studio) && /deckVideo\.offer\(ctrl\.stageInner,/.test(studio), '스튜디오가 덱을 붙인 뒤 교안 도우미에 물어 더한다');
    });

    await run('화면 재생기(deckVideo.liveHtml): 종류마다 재생기를 만든다. 삽입 플레이어는 youtube-nocookie·player.vimeo.com 주소만, 파일은 http(s) 주소만 받는다', () => {
        const ctx = makeContext();
        const live = ctx.KBuilder.deckVideo.liveHtml;
        const yt = live({ kind: 'youtube', embed: `${YT}?start=90` }, '제목 "따옴표"');
        assert.ok(yt.startsWith('<iframe data-video-live') && yt.includes(`src="${YT}?start=90"`) && yt.includes('title="제목 &quot;따옴표&quot;"'), yt);
        assert.ok(yt.includes('sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"') && yt.includes('referrerpolicy="strict-origin-when-cross-origin"') && yt.includes('allowfullscreen'), yt);
        assert.ok(!/autoplay/.test(yt), '자동 재생 권한은 주지 않는다');
        assert.ok(live({ kind: 'vimeo', embed: 'https://player.vimeo.com/video/123456?h=abcdef12&dnt=1' }, 'v').includes('src="https://player.vimeo.com/video/123456?h=abcdef12&amp;dnt=1"'));
        const file = live({ kind: 'file', src: 'https://cdn.example.com/lag.mp4' }, 'lag');
        assert.ok(file.startsWith('<video data-video-live') && file.includes('controls') && file.includes('preload="metadata"') && file.includes('src="https://cdn.example.com/lag.mp4"'), file);
        const wb = live({ kind: 'wb', poster: PNG }, '판서');
        assert.ok(wb.includes('<video data-video-live') && wb.includes(`poster="${PNG}"`) && !/<video[^>]*\ssrc=/.test(wb), '파일은 뒤에 붙인다');
        assert.ok(wb.includes(`<img data-video-live class="sv-poster" src="${PNG}"`), '인쇄에 쓸 대표 그림');
        assert.ok(/<video data-video-live[^>]*>/.test(live({ kind: 'local', type: 'video/mp4' }, 'a')) && !live({ kind: 'local' }, 'a').includes('poster='));
        const gif = live({ kind: 'gif', src: GIF }, '흐름');
        assert.ok(gif.startsWith('<img data-video-live') && gif.includes(`src="${GIF}"`) && gif.includes('alt="흐름"'));
        // 허용하지 않는 주소·모양은 만들지 않는다
        [{ kind: 'youtube', embed: 'https://evil.example.com/embed/dQw4w9WgXcQ' }, { kind: 'youtube', embed: 'https://www.youtube-nocookie.com.evil.example/embed/x' }, { kind: 'vimeo', embed: 'javascript:alert(1)' },
            { kind: 'file', src: 'javascript:alert(1)' }, { kind: 'file', src: 'data:text/html,<script>1</script>' }, { kind: 'gif', src: 'data:image/svg+xml;base64,PHN2Zz4=' }, { kind: 'gif', src: 'https://a.example/x.gif' },
            { kind: 'wb', poster: 'javascript:alert(1)' }, { kind: 'what' }, null].forEach(meta => {
            const html = live(meta, 't');
            assert.ok(!/javascript:|evil\.example|svg\+xml|text\/html|a\.example/.test(html), `${JSON.stringify(meta)} → ${html}`);
            if (!meta || meta.kind !== 'wb') assert.strictEqual(html, '', JSON.stringify(meta));
        });
    });

    await run('저장·불러오기: 저장하는 글에서 재생기·배율 표시를 떼고(가리키는 값은 남긴다), 불러온 HTML의 재생기도 지운다', () => {
        const ctx = makeContext();
        const K = ctx.KBuilder;
        const html = '<section class="slide"><div class="frame"><div class="cols"><div class="col-main" data-fit="" style="--fit:0.85;color:red">글<div class="panel" data-abs="1" style="position:absolute;--abs-zoom:0.85;left:10px">옮긴 칸</div></div></div>'
            + `<div class="slide-video" data-video-ref="wb:img_wb1" data-video-kind="wb" data-video-state="ready"><div class="sv-stage"><div class="sv-card"><span class="sv-icon">▶</span></div>`
            + `<img data-video-live class="sv-poster" src="${PNG}"><video data-video-live controls src="blob:http://x/1"></video></div><div class="sv-cap"><span class="sv-title">판서</span></div></div></div></section>`;
        const rootEl = K.inertRoot(html);
        K.deckRuntime.strip(rootEl);
        const out = rootEl.innerHTML;
        assert.ok(!/data-video-live|blob:|data-video-state|data-fit|--fit/.test(out), out);
        assert.ok(out.includes('data-video-ref="wb:img_wb1"') && out.includes('data-video-kind="wb"') && out.includes('<span class="sv-title">판서</span>') && out.includes('sv-card'), out);
        assert.ok(/style="[^"]*color:\s*red/.test(out), '다른 꾸밈은 그대로');
        assert.ok(/data-abs="1" style="[^"]*--abs-zoom:\s*0\.85[^"]*left:\s*10px/.test(out), `손으로 옮긴 요소의 배율은 남긴다: ${out}`);
        // 내보낸 HTML을 다시 불러올 때: 파일 안에 넣은 재생기(영상 값)·삽입 플레이어는 버린다
        const exported = html.replace('src="blob:http://x/1"', `src="${MP4}"`).replace('</div><div class="sv-cap">', `<iframe data-video-live src="${YT}"></iframe></div><div class="sv-cap">`);
        const clean = K.sanitizeDeckHtml(exported);
        assert.ok(!/data:video|<iframe|<video|data-video-live|data-video-state/.test(clean), clean);
        assert.ok(clean.includes('data-video-ref="wb:img_wb1"'));
        // 스튜디오가 저장 글을 만들 때 이 정리를 쓴다
        assert.ok(/K\.deckRuntime\.strip\(root\)/.test(source('kbuilder/studio.js')), 'serializeDeck이 정리를 부른다');
    });

    /* ======================= 5. 영상·배치: 내보내기 ======================= */
    await run('HTML 내보내기(deckVideo.exportInto): 주소 영상은 재생기로, 넣은 파일·판서 영상은 파일 안에 넣고, GIF는 그림으로. 못 찾은 영상은 제목 칸으로 남는다', async () => {
        const ctx = makeContext();
        const K = ctx.KBuilder;
        K.videoSource = videoSource;
        const deck = deckOf(
            ['### 슬라이드 1 - 영상: 유튜브', `- 영상: [YouTube 영상](${YT})`, ''],
            ['### 슬라이드 2 - 영상: 파일', '- 영상: [intro.mp4](local:vid_intro000001)', ''],
            ['### 슬라이드 3 - 영상: 판서', '- 영상: [서버 구조 판서](wb:img_wb1)', ''],
            ['### 슬라이드 4 - 영상: 흐름', '- 영상: [흐름](gif:img_gif1)', ''],
            ['### 슬라이드 5 - 영상: 없는 영상', '- 영상: [없는 영상](wb:img_none)', '']
        );
        const rootEl = K.inertRoot(K.renderDeckHtml(K.paginateDeck(K.parseDeck(deck))));
        await K.deckVideo.exportInto(rootEl);
        const boxes = Array.prototype.slice.call(rootEl.querySelectorAll('.slide-video')).map(box => box.outerHTML);
        assert.ok(boxes[0].includes(`<iframe data-video-live`) && boxes[0].includes(`src="${YT}"`) && boxes[0].includes('data-video-state="ready"'), boxes[0]);
        assert.ok(boxes[0].includes('YouTube에서 보기'), '재생기가 막힌 곳에서도 링크가 보인다');
        const bytes = `data:video/mp4;base64,${Buffer.from('video-bytes').toString('base64')}`;
        assert.ok(boxes[1].includes(`src="${bytes}"`) && boxes[1].includes('data-video-state="ready"'), boxes[1]);
        assert.ok(boxes[2].includes(`src="${bytes}"`) && boxes[2].includes(`poster="${PNG}"`), boxes[2]);
        assert.ok(boxes[3].includes(`<img data-video-live`) && boxes[3].includes(`src="${GIF}"`), boxes[3]);
        assert.ok(!/<iframe|<video|<img/.test(boxes[4]) && boxes[4].includes('data-video-state="missing"') && boxes[4].includes('없는 영상'), boxes[4]);
        // export.js가 내보낼 사본에 이 처리를 하고, 그 전에 모든 슬라이드의 배율을 다시 잰다
        const exportJs = source('kbuilder/export.js');
        assert.ok(/deckVideo\.exportInto\(clone\)/.test(exportJs) && /deckFit\.all\(inner\)/.test(exportJs));
    });

    await run('PDF(인쇄, css): 재생기는 감추고 대표 그림이나 제목·링크 칸을 보인다(빈 상자를 남기지 않는다)', () => {
        const print = CSS.slice(CSS.lastIndexOf('@media print'));
        assert.ok(print.length > 20 && CSS.includes('@media print'));
        assert.ok(/\.slide-video iframe[^{]*\{[^}]*display\s*:\s*none\s*!important/.test(print) && /\.slide-video video/.test(print), print);
        assert.ok(/\.slide-video \.sv-poster[^{]*\{[^}]*display\s*:\s*block/.test(print), '대표 그림');
        assert.ok(/\.sv-card[^{]*\{[^}]*display\s*:\s*flex/.test(print), '제목 칸');
        // 화면에서는 대표 그림을 감춘다(재생기의 poster가 대신한다)
        assert.ok(/display\s*:\s*none/.test(cssRule(CSS, '.slide-video .sv-poster')));
        // 인쇄 전에 모든 슬라이드를 다시 재고 대표 그림을 붙인다
        const studio = source('kbuilder/studio.js');
        const printFn = studio.slice(studio.indexOf('function printDeck()'), studio.indexOf('function printDeck()') + 400);
        assert.ok(/deckFit\.all\(/.test(printFn) && /deckVideo\.hydrateAll\(/.test(printFn), printFn);
    });

    await run('PPTX 내보내기: 긴 핵심은 3줄 분량에서 말줄임으로 자르고 띠 높이만큼 본문 칸을 줄이며, 영상은 대표 그림이나 제목·링크 칸으로 넣는다', async () => {
        const ctx = makeContext();
        const K = ctx.KBuilder;
        K.videoSource = videoSource;
        const calls = [];
        ctx.PptxGenJS = function () {
            this.defineLayout = () => {};
            this.addSlide = () => {
                const record = { texts: [], images: [], shapes: [] };
                calls.push(record);
                return {
                    set background(value) { record.background = value; },
                    addText: (value, opts) => record.texts.push({ value, opts }),
                    addImage: opts => record.images.push(opts),
                    addShape: (kind, opts) => record.shapes.push({ kind, opts })
                };
            };
            this.writeFile = async opts => { ctx.pptxFile = opts.fileName; };
        };
        ctx.fetch = async () => ({ blob: async () => new Blob(['png'], { type: 'image/png' }), text: async () => '' });
        const button = { textContent: 'PPTX' };
        ctx.document.getElementById = id => (id === 'btn-pptx' ? button : null);
        const longKey = '완벽한 보안을 위해 클라이언트는 바보가 되어야 한다는 원칙을 끝까지 지킨다 '.repeat(8).trim();
        const deck = deckOf(
            slide(1, '서버의 역할', '전개 1', ['서버는 모든 판정을 맡는 심판 역할을 한다는 점을 기억합니다', '클라이언트는 입력을 받고 서버가 알려 준 결과를 화면에 그립니다'], ['- 영상: [서버 구조 판서](wb:img_wb1)', `- 핵심 메시지: ${longKey}`]),
            ['### 슬라이드 2 - 영상: 유튜브', `- 영상: [YouTube 영상](${YT})`, ''],
            ['### 슬라이드 3 - 영상: 없는 영상', '- 영상: [없는 영상](wb:img_none)', '']
        );
        const parsed = K.paginateDeck(K.parseDeck(deck));
        K.lastDeck = { parsed, key: 'd1', ctrl: null };
        K.exportPPTX();
        for (let i = 0; i < 20 && !ctx.pptxFile; i++) await new Promise(resolve => setImmediate(resolve));
        assert.ok(ctx.pptxFile, 'PPTX를 만들었다');
        assert.strictEqual(calls.length, parsed.slides.length);
        const flat = record => record.texts.map(t => (Array.isArray(t.value) ? t.value.map(r => r.text).join('') : String(t.value)));
        // 핵심 띠: 말줄임으로 자르고(낱말 가운데서 자르지 않는다) 띠가 슬라이드 안에 있다
        const keyText = flat(calls[0]).find(value => value.startsWith('핵심 '));
        assert.ok(keyText.endsWith('…') && keyText.length < longKey.length && keyText.length <= 100, keyText);
        const keptKey = keyText.slice(3, -1);
        assert.ok(longKey.startsWith(keptKey) && /^\s/.test(longKey.slice(keptKey.length)), `낱말 끝에서 자른다: ${keyText}`);
        const bar = calls[0].shapes.find(shape => shape.kind === 'roundRect' && shape.opts.y > 5.2);
        assert.ok(bar && bar.opts.y + bar.opts.h <= 7.5 && bar.opts.h > 0.7, JSON.stringify(bar));
        const body = calls[0].texts.find(t => Array.isArray(t.value) && t.value.some(r => r.text === '서버는 모든 판정을 맡는 심판 역할을 한다는 점을 기억합니다'));
        assert.ok(body.opts.y + body.opts.h <= bar.opts.y + 0.001, '본문 칸은 띠 위에서 끝난다');
        // 영상: 판서는 대표 그림 + 제목, 유튜브는 제목 + 링크, 못 찾은 영상은 제목만
        assert.ok(calls[0].images.some(image => image.data === PNG), '판서 영상의 대표 그림');
        assert.ok(flat(calls[0]).some(value => value.includes('▶') && value.includes('서버 구조 판서')));
        const link = calls[1].texts.flatMap(t => (Array.isArray(t.value) ? t.value : [])).find(r => r.options && r.options.hyperlink);
        assert.strictEqual(link.options.hyperlink.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        assert.ok(flat(calls[1]).some(value => value.includes('YouTube 영상')));
        assert.ok(flat(calls[2]).some(value => value.includes('없는 영상')) && !calls[2].images.length);
        calls.forEach(record => record.images.forEach(image => assert.ok(!/^data:video|^blob:/.test(String(image.data || image.path || '')), '영상 값은 넣지 않는다')));
    });

    /* ======================= 6. 연결 ======================= */
    await run('연결: 스튜디오가 새 파일(deck-runtime.js)을 그리기 파일 뒤에 싣고 나눈 슬라이드로 그리며, 앱은 인용 파일(gyosuan-videos.js)을 다듬기 파일 뒤에 싣는다', () => {
        const studioHtml = text('slide-studio.html');
        const at = name => studioHtml.indexOf(`<script src="js/kbuilder/${name}?v=`);
        assert.ok(at('deck-runtime.js') > at('render-deck.js') && at('deck-runtime.js') < at('editor.js') && at('deck-runtime.js') < at('studio.js'), '싣는 순서');
        const studio = source('kbuilder/studio.js');
        assert.ok(/K\.paginateDeck\(/.test(studio), '넘치는 항목을 나눈 슬라이드로 그린다');
        assert.ok(/getSlideStudioVideo/.test(studio) && /getSlideStudioVideoBlob/.test(studio), '영상은 부모 창에서 푼다');
        const index = text('index.html');
        const app = name => index.indexOf(`<script src="./js/${name}?v=`);
        assert.ok(app('gyosuan-videos.js') > app('gyosuan-deck-tidy.js') && app('gyosuan-videos.js') > app('gyosuan.js'), 'index.html');
        assert.ok(app('lesson-sanitize.js') < app('gyosuan-videos.js'), '주소 검사(lesson-sanitize.js)가 먼저');
        // 슬라이드를 보일 때마다 배율을 다시 재고 그 슬라이드의 재생기를 붙인다
        const deckJs = source('kbuilder/render-deck.js');
        assert.ok(/deckFit/.test(deckJs) && /deckVideo/.test(deckJs));
        // 편집기: 영상 칸을 고르고 지울 수 있고, 썸네일에는 재생기를 넣지 않는다
        const editor = source('kbuilder/editor.js');
        assert.ok(/SELECTABLE = "[^"]*\.slide-video/.test(editor), '영상 칸을 고를 수 있다');
        assert.ok(/data-video-live/.test(editor), '썸네일·되돌리기 사본에서 재생기를 뗀다');
    });

    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
