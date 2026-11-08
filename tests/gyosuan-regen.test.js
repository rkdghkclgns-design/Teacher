// 교수안 재생성 단추·바뀐 내용 안내·이전 교수안 되돌리기와 슬라이드 편성안 다듬기 테스트 (실행: node tests/gyosuan-regen.test.js)
// 갈래마다 교안이 바뀌었는지 보고 교수안 화면 안내 옆에 재생성 단추를 두는지, 누르면 바뀐 탭·섹션과 비용·시간을 보이고 묻는지,
// 취소하면 아무것도 바꾸지 않고 확인하면 그 갈래만 기존 만들기 길(generateGyosuan)로 다시 만드는지, 바꾸기 전 교수안을 되돌릴 수 있는지,
// 편성안에서 빈 그림 자리·빈 표·빈 도식 블록을 덜어 내고 여러 문장을 이은 긴 문구를 나누는지(만들 때와 스튜디오에 넘길 때), 프롬프트 규칙을 실제 파일로 확인한다.
// AI 응답과 그림 만들기만 스텁이다. 키는 가짜 값만 쓴다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { loadLessonTracks } = require('./lesson-tracks');

const root = path.join(__dirname, '..', 'js') + path.sep;
const source = file => fs.readFileSync(root + file, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const call = (ctx, name) => vm.runInContext(name, ctx);
const reply = text => ({ candidates: [{ content: { parts: [{ text }] } }] });
const escapeHtml = s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : '');
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

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
    'data-safety.js', 'cost-estimate.js', 'filename-convention.js',
    'kbuilder/parser.js', 'kbuilder/render-doc.js', 'kbuilder/render-deck.js', 'kbuilder/ref-images.js', 'kbuilder/import-html.js', 'kbuilder/auto-images.js',
    'kbuilder/export.js', 'kbuilder/sample-data.js', 'course-ncs.js', 'course-design.js', 'course-sessions.js', 'course-meta.js', 'gyosuan.js', 'gyosuan-view.js', 'gyosuan-images.js',
    'import-stream.js', 'gyosuan-io.js', 'gyosuan-deck-tidy.js', 'gyosuan-regen.js'
];

const META = '부제: 부제\n대상: 수강생\n선행: 없음\n결과물: 메모\n교보제: 슬라이드\n[학습목표]\n- 설명할 수 있다.\n[개요]\n개요 문단입니다.\n[수업흐름]\n단계 | 시간 | 핵심\n도입 | 10분 | 시작\n전개 | 60분 | 본문\n정리 | 10분 | 끝\n[준비물]\n- 빔프로젝터\n[산출물]\n- 메모\n[평가]\n- 확인\n[유의사항]\n- 검토한다.';
const SECTION = '@@GYOSUAN@@\n**강사 활동**: 화면을 띄운다.\n**설명 내용**:\n- 내용이다.\n**멘트 예시**: "시작합니다."\n**학생 활동**: 따라 한다.\n@@SLIDES@@\n### 슬라이드 - 본문\n- 슬라이드 문구:\n  - 핵심\n- 이미지/시각: 도식\n- 핵심 메시지: 메시지';
const OPEN_CLOSE = '@@INTRO@@\n제목: 열기\n**강사 활동**: 연다.\n@@CLOSE@@\n제목: 닫기\n**강사 활동**: 닫는다.';

// confirm: 앱 확인 창(confirmAsync)의 답(함수면 묻는 동안 할 일까지). storage: 이 브라우저 저장소(이미지 자동 생성 장수 'kb-auto-img' 기본 0)
function makeContext({ confirm = true, storage = {} } = {}) {
    const elements = {};
    const stored = { 'kb-auto-img': '0', ...storage };
    const prompts = [];
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, URL, encodeURIComponent, Blob, TextDecoder, JSON, Date, Map, Set,
        TEXT_MODEL: 'claude-opus-5-5',
        CONTEXT_CORE: { personas: { instructor: '강사입니다.' } },
        INSTRUCTOR_TONE_PRESETS: [{ id: 'formal', label: '합쇼체' }], instructorTone: 'formal',
        getReferenceContext: () => '', stripInstructorCallouts: text => text,
        courseData: [], globalState: { subjects: [{ id: 's1', title: '게임 기획 입문' }], courseTitle: '과정' },
        currentSubjectId: 's1', currentEditingModuleId: 'm1',
        apiKey: 'test-key', claudeApiKey: '', isClaudeModel: () => true,
        extractText: data => data.candidates[0].content.parts[0].text,
        escapeHtml,
        localStorage: { getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = String(value); } },
        document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, getElementById: id => elements[id] || null, createElement: () => ({ appendChild() {} }) },
        BroadcastChannel: function () { this.postMessage = () => {}; },
        saveState: async () => { ctx.saved = (ctx.saved || 0) + 1; },
        renderEditor: () => { ctx.rendered = (ctx.rendered || 0) + 1; },
        generateImageAPI: async () => PNG,
        callGemini: async (model, payload) => {
            const text = payload.contents.at(-1).parts[0].text;
            if (text.includes('@@INTRO@@')) { prompts.push(text); return reply(OPEN_CLOSE); }
            if (text.includes('@@GYOSUAN@@')) { prompts.push(text); return reply(SECTION); }
            if (text.includes('교수안 머리말')) { prompts.push(text); return reply(META); }
            throw new Error('호출되면 안 됨');
        },
        confirm: () => { throw new Error('브라우저 기본 확인 창을 쓰면 안 된다'); },
        asked: [], alerts: [], toasts: [], prompts, elements
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    loadLessonTracks(ctx, { tabs: true });
    FILES.forEach(file => vm.runInContext(source(file), ctx));
    // 앱의 알림·확인 창(data-safety.js confirmAsync)은 실은 뒤에 바꾼다
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind });
    ctx.confirmAsync = async (message, opts) => {
        ctx.asked.push({ message, opts });
        return typeof confirm === 'function' ? confirm(message, opts) : confirm;
    };
    return ctx;
}

const LONG = '충분히 긴 본문 문장이 여기에 들어갑니다. 내용을 차근차근 풀어서 다룹니다.';
const learnTab = (sections = [['1. 재미의 구조', '구조표식'], ['2. 재미 분석', '분석표식'], ['3. 정리 노트', '노트표식']]) =>
    sections.map(([title, mark]) => `## ${title} (⏱ 30분)\n\n${mark} ${LONG}`).join('\n\n');
const lessonOf = () => ({
    id: 'm1', title: '재미의 구조', hours: 2, images: {},
    tabContents: {
        basicLearn: learnTab(), basicPrac: null,
        advLearn: `## 1. 심화 섹션 (⏱ 40분)\n\n심화표식 ${LONG}`,
        advPrac: `## 심화 프로젝트\n\n심화실습표식 ${LONG}`,
        assessment: null, advAssessment: null
    }
});

// 두 갈래 교수안을 만든 차시와 문맥
async function builtLesson(options) {
    const ctx = makeContext(options);
    const mod = lessonOf();
    ctx.getEditingModule = id => (id === undefined || String(id) === 'm1' ? mod : null);
    assert.strictEqual(await ctx.generateGyosuan('m1'), true, ctx.alerts.join('\n'));
    assert.strictEqual(await ctx.generateGyosuan('m1', { track: 'adv' }), true, ctx.alerts.join('\n'));
    ctx.prompts.length = 0;
    ctx.asked.length = 0;
    return { ctx, mod };
}

const DECK_IN = [
    '---', '교과목: 게임 기획 입문', '주제: 재미', '---', '', '# 슬라이드 편성안 - 재미', '', '## 슬라이드 편성', '',
    '### 슬라이드 1 - 표지', '- 대응 교수안: -', '- 슬라이드 문구:', '  - (제목) 재미', '- 이미지/시각: 강의 주제를 상징하는 대표 일러스트', '',
    '### 슬라이드 2 - 그림 있는 칸', '- 대응 교수안: 전개 1', '- 슬라이드 문구:', '  - 규칙 → 진행 → 감정', '- 이미지/시각: 3층 도식 ![](local:img_ok)', '- 핵심 메시지: 재미는 설계된다.', '',
    '### 슬라이드 3 - 빈 그림', '- 대응 교수안: 전개 1', '- 슬라이드 문구:', '  - 핵심 하나', '  - <img src="">', '  - 앞 <img alt="빈 칸"> 뒤', '  - ![]()', '  - [이미지: 도식 자리]', '  - <!-- [IMG: "도식"] -->',
    '- 이미지/시각: 없는 그림 ![](local:img_none)', '  - 덧붙인 시각 설명', '- 핵심 메시지: 메시지', '',
    '### 슬라이드 4 - 표', '- 대응 교수안: 전개 2', '- 슬라이드 문구:', '  - 비교', '', '| 구분 | 훈련 |', '|---|---|', '', '| 구분 | 코칭 |', '|---|---|', '| 중심 | 학습자 |', '', '| 가 | 나 |', '|---|---|', '|  |  |', '- 핵심 메시지: 비교한다', '',
    '### 슬라이드 5 - 도식', '- 대응 교수안: 전개 2', '- 슬라이드 문구:', '  - 흐름', '', '```mermaid', '', '```', '', '```mermaid', 'graph LR; A-->B', '```', '', '```text', '| 코드 속 | 표 |', '|---|---|', '```', '',
    '### 슬라이드 6 - 비울 슬라이드', '- 대응 교수안: 전개 3', '- 슬라이드 문구:', '  - ![](local:img_none)', '- 이미지/시각: 도식', '',
    '### 슬라이드 7 - 구분', '',
    '### 슬라이드 8 - 긴 문장', '- 대응 교수안: 전개 3', '- 슬라이드 문구:',
    '  - 훈련은 교수자가 정한 지식과 기술을 차례로 전달합니다. 코칭은 질문으로 학습자의 성찰을 끌어냅니다.',
    '  - (하단) 답은 여러분 안에 있습니다. 저는 그 답을 끌어내는 역할을 맡습니다.',
    '  - 한 문장으로 된 아주 긴 설명이라도 문장이 하나뿐이면 뜻을 지키려고 나누지 않고 그대로 둡니다',
    '  - 짧다. 둘이다.', '- 핵심 메시지: 스스로 답을 찾는다.', '',
    '## 비고', '', '- ![]() 비고는 그대로 둔다', '- | 표 | 아님 |', ''
].join('\n');

const DECK_OUT = [
    '---', '교과목: 게임 기획 입문', '주제: 재미', '---', '', '# 슬라이드 편성안 - 재미', '', '## 슬라이드 편성', '',
    '### 슬라이드 1 - 표지', '- 대응 교수안: -', '- 슬라이드 문구:', '  - (제목) 재미', '',
    '### 슬라이드 2 - 그림 있는 칸', '- 대응 교수안: 전개 1', '- 슬라이드 문구:', '  - 규칙 → 진행 → 감정', '- 이미지/시각: 3층 도식 ![](local:img_ok)', '- 핵심 메시지: 재미는 설계된다.', '',
    '### 슬라이드 3 - 빈 그림', '- 대응 교수안: 전개 1', '- 슬라이드 문구:', '  - 핵심 하나', '  - 앞 뒤', '- 핵심 메시지: 메시지', '',
    '### 슬라이드 4 - 표', '- 대응 교수안: 전개 2', '- 슬라이드 문구:', '  - 비교', '', '| 구분 | 코칭 |', '|---|---|', '| 중심 | 학습자 |', '', '- 핵심 메시지: 비교한다', '',
    '### 슬라이드 5 - 도식', '- 대응 교수안: 전개 2', '- 슬라이드 문구:', '  - 흐름', '', '```mermaid', 'graph LR; A-->B', '```', '', '```text', '| 코드 속 | 표 |', '|---|---|', '```', '',
    '### 슬라이드 6 - 구분', '',
    '### 슬라이드 7 - 긴 문장', '- 대응 교수안: 전개 3', '- 슬라이드 문구:',
    '  - 훈련은 교수자가 정한 지식과 기술을 차례로 전달합니다.',
    '  - 코칭은 질문으로 학습자의 성찰을 끌어냅니다.',
    '  - (하단) 답은 여러분 안에 있습니다. 저는 그 답을 끌어내는 역할을 맡습니다.',
    '  - 한 문장으로 된 아주 긴 설명이라도 문장이 하나뿐이면 뜻을 지키려고 나누지 않고 그대로 둡니다',
    '  - 짧다. 둘이다.', '- 핵심 메시지: 스스로 답을 찾는다.', '',
    '## 비고', '', '- ![]() 비고는 그대로 둔다', '- | 표 | 아님 |', ''
].join('\n');

(async () => {
    /* ======================= 1. 교안이 바뀌었는지와 재생성 단추 ======================= */
    await run('바뀐 교안: 갈래마다 따로 본다. 만든 뒤 그 갈래의 학습·실습 탭이 바뀌어야 바뀐 것이고, 불러온 교수안·예전 방식 교수안·교수안 없는 갈래는 바뀌었다고 하지 않는다', async () => {
        const { ctx, mod } = await builtLesson();
        const stale = call(ctx, 'isGyosuanStale');
        assert.deepStrictEqual([stale(mod, 'basic'), stale(mod, 'adv')], [false, false]);
        mod.tabContents = { ...mod.tabContents, basicLearn: mod.tabContents.basicLearn.replace('분석표식', '분석표식 고침') };
        assert.deepStrictEqual([stale(mod, 'basic'), stale(mod, 'adv')], [true, false], '기본학습 탭만 바꾸면 기본학습 교수안만');
        mod.tabContents = { ...mod.tabContents, advPrac: `${mod.tabContents.advPrac}\n\n덧붙인 실습 문장입니다.` };
        assert.deepStrictEqual([stale(mod, 'basic'), stale(mod, 'adv')], [true, true]);
        assert.strictEqual(stale({ ...mod, gyosuan: { ...mod.gyosuan, sourceKey: null } }, 'basic'), false, '불러온 교수안');
        assert.strictEqual(stale({ ...mod, gyosuanAdv: undefined }, 'adv'), false, '교수안이 없는 갈래');
        const legacy = { ...mod, gyosuan: { ...mod.gyosuan } };
        legacy.gyosuan.sourceKey = call(ctx, 'hashSource')(call(ctx, 'legacyLessonSource')(legacy));
        assert.strictEqual(stale(legacy, 'basic'), false, '예전 방식(네 탭) 교수안은 따로 안내한다');
    });

    await run('재생성 단추: 교수안 화면 안내 바로 옆에 그 갈래의 단추 하나. 바뀌었으면 재생성, 그대로면 그래도 재생성. 교수안이 없는 갈래 화면에는 없다', async () => {
        const { ctx, mod } = await builtLesson();
        mod.tabContents = { ...mod.tabContents, basicLearn: mod.tabContents.basicLearn.replace('분석표식', '분석표식 고침') };
        const toolbar = call(ctx, 'gyosuanToolbarHtml');
        const basic = toolbar(mod, 'basic');
        assert.ok(/<div class="gyosuan-note-row"><span class="gyosuan-note">⚠️ 교안이 바뀌었습니다\. 교수안을 다시 생성하면 반영됩니다\.<\/span><button onclick="regenerateGyosuan\('m1', 'basic'\)" class="gyosuan-tool is-stale"[^>]*><i class="ph-bold ph-arrow-clockwise"><\/i> 재생성<\/button><\/div>/.test(basic), basic.slice(0, 600));
        assert.strictEqual(basic.split('regenerateGyosuan(').length - 1, 1, '재생성 단추는 하나');
        const adv = toolbar(mod, 'adv');
        assert.ok(/<span class="gyosuan-note">[^<]*심화학습 교수안입니다[^<]*<\/span><button onclick="regenerateGyosuan\('m1', 'adv'\)" class="gyosuan-tool"[^>]*> ?<i class="ph-bold ph-arrow-clockwise"><\/i> 그래도 재생성<\/button>/.test(adv), adv.slice(0, 600));
        assert.ok(!adv.includes("'basic'") && !basic.includes("'adv'"), '다른 갈래 단추는 없다');
        assert.ok(!basic.includes('이전 교수안으로') && !adv.includes('이전 교수안으로'), '바꾸기 전 교수안이 없으면 되돌리기 단추도 없다');
        // 교수안이 없는 갈래 화면: 만들기 단추만
        ctx.elements['gyosuan-view'] = { innerHTML: '', querySelectorAll: () => [] };
        ctx.lessonPanelTrack = () => 'adv';
        call(ctx, 'renderGyosuanView')({ ...mod, gyosuanAdv: undefined });
        const empty = ctx.elements['gyosuan-view'].innerHTML;
        assert.ok(empty.includes("generateGyosuan('m1', { track: 'adv' })") && !empty.includes('regenerateGyosuan('), empty.slice(0, 300));
    });

    /* ======================= 2. 바뀐 내용 요약 ======================= */
    await run('바뀐 내용: 탭마다 바뀐·새·빠진 섹션 이름을 짧게, 새로 채운 탭과 비운 탭, 교수안에 쓰지 않는 부분만 바뀐 탭, 기록이 없는 예전 교수안을 알린다', async () => {
        const { ctx, mod } = await builtLesson();
        const changes = (lesson, track) => plain(call(ctx, 'gyosuanChangeLines')(lesson, track));
        assert.deepStrictEqual(changes(mod, 'basic'), ['교수안을 만든 뒤 바뀐 교안이 없습니다.']);
        assert.ok(mod.gyosuan.sourceMap && mod.gyosuan.sourceMap.basicLearn.sections.length === 3, '만들 때 섹션 지문을 남긴다');
        mod.tabContents = {
            ...mod.tabContents,
            basicLearn: learnTab([['1. 재미의 구조', '구조표식'], ['2. 재미 분석', '분석표식 고침'], ['4. 새 활동', '새표식']]),
            basicPrac: `## 실습 과제\n\n실습표식 ${LONG}`
        };
        assert.deepStrictEqual(changes(mod, 'basic'), ["기본학습 탭: 바뀐 섹션 '재미 분석' · 새 섹션 '새 활동' · 빠진 섹션 '정리 노트'", '기본실습 탭: 새 글']);
        assert.deepStrictEqual(changes(mod, 'adv'), ['교수안을 만든 뒤 바뀐 교안이 없습니다.'], '다른 갈래는 그대로');
        // 시간만 바꾼 섹션도 바뀐 섹션이다(교수안이 시간을 쓴다)
        const timed = { ...mod, tabContents: { ...lessonOf().tabContents, basicLearn: learnTab().replace('## 3. 정리 노트 (⏱ 30분)', '## 3. 정리 노트 (⏱ 45분)') } };
        assert.deepStrictEqual(changes(timed, 'basic'), ["기본학습 탭: 바뀐 섹션 '정리 노트'"]);
        // 코드 블록만 더한 탭(교수안은 코드 블록을 쓰지 않는다)과 비운 탭
        const coded = { ...mod, tabContents: { ...lessonOf().tabContents, basicLearn: `${learnTab()}\n\n\`\`\`python\nprint(1)  # 1을 찍는다\n\`\`\`` } };
        assert.deepStrictEqual(changes(coded, 'basic'), ['기본학습 탭: 교수안에 쓰지 않는 부분(코드 블록·그림·첫 제목 앞 글 등)만 바뀜']);
        const advEmpty = { ...mod, tabContents: { ...mod.tabContents, advPrac: null } };
        assert.deepStrictEqual(changes(advEmpty, 'adv'), ['심화실습 탭: 비움']);
        // 이 기능 전에 만든 교수안(섹션 지문 없음)과 불러온 교수안
        const old = { ...mod, gyosuan: { ...mod.gyosuan, sourceMap: undefined } };
        assert.deepStrictEqual(changes(old, 'basic'), ['기본학습·기본실습 탭 글이 바뀌었습니다. 어느 섹션이 바뀌었는지는 이 교수안에 기록이 없어 알 수 없습니다.']);
        assert.deepStrictEqual(changes({ ...mod, gyosuan: { ...mod.gyosuan, sourceKey: null } }, 'basic'), ['불러온 교수안이라 견줄 교안 기록이 없습니다.']);
        // 남이 준 저장본의 이상한 지문은 읽지 않는다
        const odd = { ...mod, gyosuan: { ...mod.gyosuan, sourceMap: { basicLearn: { key: 5, sections: 'x' }, constructor: 1 } } };
        assert.deepStrictEqual(changes(odd, 'basic'), ['기본학습 탭: 새 글', '기본실습 탭: 새 글']);
    });

    /* ======================= 3. 재생성: 묻기·취소·그 갈래만 다시 만들기 ======================= */
    await run('재생성 묻기: 바뀐 내용과 되돌리기 안내, 비용·시간 미리 보기를 한 창에 보이고, 취소하면 AI를 부르지도 교수안을 바꾸지도 않는다', async () => {
        const { ctx, mod } = await builtLesson({ confirm: false });
        mod.tabContents = { ...mod.tabContents, basicLearn: mod.tabContents.basicLearn.replace('분석표식', '분석표식 고침') };
        const before = { basic: mod.gyosuan, adv: mod.gyosuanAdv, history: mod.history.length, saved: ctx.saved };
        let made = 0;
        const generate = ctx.generateGyosuan;
        ctx.generateGyosuan = async (...args) => { made++; return generate(...args); };
        await ctx.regenerateGyosuan('m1', 'basic');
        assert.deepStrictEqual([made, ctx.prompts.length, ctx.saved], [0, 0, before.saved], '취소하면 만들지 않는다');
        assert.ok(mod.gyosuan === before.basic && mod.gyosuanAdv === before.adv && mod.history.length === before.history, '교수안·변경 이력 그대로');
        assert.strictEqual(ctx.asked.length, 1);
        const { message, opts } = ctx.asked[0];
        assert.deepStrictEqual([opts.title, opts.okLabel], ['기본학습 교수안 다시 생성', '다시 생성']);
        assert.ok(message.startsWith("기본학습 교수안을 다시 생성합니다.\n\n[바뀐 내용]\n- 기본학습 탭: 바뀐 섹션 '재미 분석'\n\n"), message);
        assert.ok(message.includes("지금 교수안은 '이전 교수안으로' 단추로 되돌릴 수 있습니다."), message);
        assert.ok(message.includes('글: AI 호출 약 12회') && message.includes('걸리는 시간'), '비용·시간 미리 보기(confirmWithEstimate)');
    });

    await run('재생성 확인: 그 갈래만 기존 만들기 길로(교수안과 편성안을 함께) 지금 교안으로 다시 만들고, 바꾸기 전 교수안은 이전 교수안 칸에 남는다. 다른 갈래는 그대로', async () => {
        const { ctx, mod } = await builtLesson();
        mod.images = { img_tab: PNG };
        mod.tabContents = { ...mod.tabContents, advLearn: mod.tabContents.advLearn.replace('심화표식', '심화표식 고침') };
        mod.gyosuanAdv = { ...mod.gyosuanAdv, docMd: `${mod.gyosuanAdv.docMd}\n강사가 고친 줄 ![](local:img_tab)\n`, deckHtml: '<편집한 슬라이드>' };
        const edited = mod.gyosuanAdv;
        const basicPlan = mod.gyosuan;
        const calls = [];
        const generate = ctx.generateGyosuan;
        ctx.generateGyosuan = async (id, opts) => { calls.push([id, plain(opts)]); return generate(id, opts); };
        assert.strictEqual(await ctx.regenerateGyosuan('m1', 'adv'), true);
        assert.deepStrictEqual(calls, [['m1', { track: 'adv' }]], '만들기와 같은 길, 그 갈래만, 교수안까지');
        const prompts = ctx.prompts.join('\n');
        assert.ok(prompts.includes('심화표식 고침') && !prompts.includes('구조표식'), '지금 심화학습 원고로만');
        assert.strictEqual(mod.gyosuan, basicPlan, '기본학습 교수안은 건드리지 않는다');
        assert.ok(!mod.gyosuanAdv.docMd.includes('강사가 고친 줄') && mod.gyosuanAdv.deckHtml === null);
        assert.strictEqual(call(ctx, 'isGyosuanStale')(mod, 'adv'), false);
        const previous = mod.gyosuanAdv.previous;
        assert.ok(previous && previous.docMd === edited.docMd && previous.deckHtml === '<편집한 슬라이드>' && previous.deckMd === edited.deckMd, '바꾸기 전 교수안 그대로');
        assert.ok(!('previous' in previous) && typeof previous.replacedAt === 'string', '이전 교수안은 한 칸만');
        assert.strictEqual(previous.images.img_tab, PNG, '그 교수안이 가리키는 차시 그림 사본도 담는다');
        assert.ok(mod.history[0].note.startsWith('심화학습 교수안·슬라이드 편성안 AI 생성'));
        const toolbar = call(ctx, 'gyosuanToolbarHtml');
        assert.ok(toolbar(mod, 'adv').includes("restorePreviousGyosuan('m1', 'adv')") && toolbar(mod, 'adv').includes('이전 교수안으로'));
        assert.ok(!toolbar(mod, 'basic').includes('restorePreviousGyosuan('), '기본학습은 바꾼 적이 없다');
    });

    await run('재생성: 그 갈래의 학습·실습 탭이 비었으면 묻지 않고 알리며, 묻는 동안 차시가 바뀌면 만들지 않는다', async () => {
        const { ctx, mod } = await builtLesson();
        let made = 0;
        ctx.generateGyosuan = async () => { made++; return true; };
        const emptied = { ...mod, tabContents: { ...mod.tabContents, advLearn: null, advPrac: null } };
        ctx.getEditingModule = () => emptied;
        await ctx.regenerateGyosuan('m1', 'adv');
        assert.deepStrictEqual([made, ctx.asked.length], [0, 0]);
        assert.ok(ctx.alerts.at(-1).includes('심화학습·심화실습 탭에 교안 내용이 없습니다'), ctx.alerts.at(-1));
        ctx.getEditingModule = () => mod;
        ctx.confirmAsync = async () => { ctx.getEditingModule = () => lessonOf(); return true; };
        await ctx.regenerateGyosuan('m1', 'basic');
        assert.strictEqual(made, 0);
        assert.ok(ctx.toasts.at(-1).message.includes('차시가 바뀌어'), ctx.toasts.at(-1).message);
    });

    /* ======================= 4. 이전 교수안으로 ======================= */
    await run('이전 교수안으로: 묻고 되돌리며 지금 교수안은 이전 교수안 칸으로 옮긴다(한 번 더 누르면 돌아온다). 덱 번호를 올려 늦은 스튜디오 저장을 막고, 취소·없는 칸·이상한 칸은 바꾸지 않는다', async () => {
        const { ctx, mod } = await builtLesson();
        mod.tabContents = { ...mod.tabContents, basicLearn: mod.tabContents.basicLearn.replace('분석표식', '분석표식 고침') };
        mod.gyosuan = { ...mod.gyosuan, deckHtml: '<예전 편집>' };
        const old = mod.gyosuan;
        await ctx.regenerateGyosuan('m1', 'basic');
        const fresh = mod.gyosuan;
        const advPlan = mod.gyosuanAdv;
        ctx.asked.length = 0;
        ctx.confirmAsync = async (message, opts) => { ctx.asked.push({ message, opts }); return false; };
        await ctx.restorePreviousGyosuan('m1', 'basic');
        assert.strictEqual(mod.gyosuan, fresh, '취소하면 그대로');
        assert.deepStrictEqual([ctx.asked[0].opts.title, ctx.asked[0].opts.okLabel], ['기본학습 이전 교수안으로', '되돌리기']);
        assert.ok(ctx.asked[0].message.includes('바꾸기 전 교수안으로 되돌립니다'), ctx.asked[0].message);
        ctx.confirmAsync = async () => true;
        await ctx.restorePreviousGyosuan('m1', 'basic');
        assert.deepStrictEqual([mod.gyosuan.docMd, mod.gyosuan.deckMd, mod.gyosuan.deckHtml, mod.gyosuan.sourceKey], [old.docMd, old.deckMd, '<예전 편집>', old.sourceKey]);
        assert.ok(mod.gyosuan.deckRev > fresh.deckRev && mod.gyosuan.deckRev > old.deckRev, '덱 번호를 올린다');
        assert.strictEqual(mod.gyosuan.previous.docMd, fresh.docMd, '방금 교수안은 이전 교수안 칸에');
        assert.ok(!('replacedAt' in mod.gyosuan), '되돌린 교수안에는 바꾼 때 표시를 두지 않는다');
        assert.strictEqual(mod.gyosuanAdv, advPlan, '다른 갈래는 그대로');
        assert.strictEqual(mod.history[0].note, '기본학습 이전 교수안으로 되돌림');
        assert.strictEqual(call(ctx, 'isGyosuanStale')(mod, 'basic'), true, '되돌린 교수안은 예전 교안으로 만든 것이라 다시 바뀌었다고 알린다');
        assert.ok(ctx.toasts.at(-1).message.includes('이전 교수안으로 되돌렸습니다'));
        await ctx.restorePreviousGyosuan('m1', 'basic');
        assert.strictEqual(mod.gyosuan.docMd, fresh.docMd, '한 번 더 누르면 방금 교수안으로');
        // 되돌릴 칸이 없거나 남이 준 이상한 칸이면 알리고 그대로 둔다
        const kept = mod.gyosuanAdv;
        await ctx.restorePreviousGyosuan('m1', 'adv');
        assert.ok(ctx.alerts.at(-1).includes('되돌릴 이전 심화학습 교수안이 없습니다'), ctx.alerts.at(-1));
        mod.gyosuanAdv = { ...kept, previous: { docMd: 5, deckMd: ['x'] } };
        const odd = mod.gyosuanAdv;
        await ctx.restorePreviousGyosuan('m1', 'adv');
        assert.strictEqual(mod.gyosuanAdv, odd);
        assert.ok(!call(ctx, 'gyosuanToolbarHtml')(mod, 'adv').includes('restorePreviousGyosuan('), '이상한 칸에는 되돌리기 단추를 두지 않는다');
    });

    /* ======================= 5. 편성안 다듬기 ======================= */
    await run('편성안 다듬기: 그림 없는 이미지/시각 줄·빈 img·빈 그림 표시·머리줄만 있는 표·빈 표·빈 mermaid를 덜고, 그래서 빈 슬라이드는 빼고 번호를 다시 매기며, 여러 문장을 이은 긴 문구만 문장마다 나눈다', () => {
        const ctx = makeContext();
        const tidy = call(ctx, 'tidyGyosuanDeck');
        const out = tidy(DECK_IN, { img_ok: PNG });
        assert.strictEqual(out, DECK_OUT, out);
        assert.strictEqual(tidy(out, { img_ok: PNG }), out, '다시 다듬어도 같다');
        assert.strictEqual(tidy(DECK_IN.replace(/\n/g, '\r\n'), { img_ok: PNG }), DECK_OUT.replace(/\n/g, '\r\n'), 'CRLF 글은 CRLF로');
        const parsed = ctx.KBuilder.parseDeck(out).slides;
        assert.deepStrictEqual(plain(parsed.map(slide => [slide.num, !!slide.visual])), [['1', false], ['2', true], ['3', false], ['4', false], ['5', false], ['6', false], ['7', false]]);
        // 진짜 그림(자동 그림 표시·data URL·http 주소·있는 local 그림)은 그대로, 바꿀 것이 없으면 받은 글 그대로
        const keep = [
            '### 슬라이드 1 - 가', '- 슬라이드 문구:', '  - 가', '- 이미지/시각: 장면 [이미지:auto1]', '',
            '### 슬라이드 2 - 나', '- 슬라이드 문구:', `  - <img src="${PNG}">`, `- 이미지/시각: 장면 ![](${PNG})`, '',
            '### 슬라이드 3 - 다', '- 슬라이드 문구:', '  - 다', '- 이미지/시각: ![](https://example.com/a.png)', ''
        ].join('\n');
        assert.strictEqual(tidy(keep), keep);
        assert.strictEqual(tidy(''), '');
        assert.strictEqual(tidy(null), '');
        // 그림이 없는 슬라이드 그림 칸은 스튜디오가 그리지 않는다
        const only = tidy('### 슬라이드 1 - 가\n- 슬라이드 문구:\n  - 가\n- 이미지/시각: 그림 ![](local:gone)\n- 핵심 메시지: 메시지\n', { gone: 'teacher-image:abc' });
        assert.strictEqual(only, '### 슬라이드 1 - 가\n- 슬라이드 문구:\n  - 가\n- 핵심 메시지: 메시지\n', '찾지 못한 그림(참조)은 그림이 아니다');
    });

    await run('만들 때 다듬기: 자동 그림을 붙인 뒤 그림이 없는 이미지/시각 줄은 빼고 그림을 붙인 줄과 그 그림은 남긴다', async () => {
        const off = makeContext();
        const mod = lessonOf();
        off.getEditingModule = () => mod;
        assert.strictEqual(await off.generateGyosuan('m1'), true);
        assert.ok(!mod.gyosuan.deckMd.includes('이미지/시각'), mod.gyosuan.deckMd);
        assert.ok(off.KBuilder.parseDeck(mod.gyosuan.deckMd).slides.every(slide => !slide.visual));
        const on = makeContext({ storage: { 'kb-auto-img': '1' } });
        const pictured = lessonOf();
        on.getEditingModule = () => pictured;
        assert.strictEqual(await on.generateGyosuan('m1'), true);
        const withVisual = on.KBuilder.parseDeck(pictured.gyosuan.deckMd).slides.filter(slide => slide.visual);
        assert.strictEqual(withVisual.length, 1, pictured.gyosuan.deckMd);
        const [, id] = withVisual[0].visual.match(/local:([\w-]+)/);
        assert.strictEqual(pictured.gyosuan.images[id], PNG, '붙인 그림은 교수안 그림에 남는다');
    });

    await run('스튜디오에 넘길 때 다듬기: 화면 편집본이 없으면 다듬은 편성안을 넘기고, 있으면 받은 그대로. 저장한 편성안은 바꾸지 않는다', () => {
        const ctx = makeContext();
        const deckMd = ['# 슬라이드 편성안 - 재미', '', '## 슬라이드 편성', '',
            '### 슬라이드 1 - 그림', '- 슬라이드 문구:', '  - 가', '- 이미지/시각: 도식 ![](local:img_a)', '',
            '### 슬라이드 2 - 빈 칸', '- 슬라이드 문구:', '  - 나', '- 이미지/시각: 도식', ''].join('\n');
        const mod = { ...lessonOf(), gyosuan: { docMd: '# 교수안 - 재미', deckMd, images: { img_a: PNG }, deckRev: 1 } };
        ctx.getEditingModule = id => (String(id) === 'm1' ? mod : null);
        const slides = payload => ctx.KBuilder.parseDeck(payload.deckMd).slides.map(slide => [slide.title, slide.visual]);
        assert.deepStrictEqual(plain(slides(ctx.getSlideStudioPayload('m1'))), [['그림', `도식 ![](${PNG})`], ['빈 칸', '']]);
        assert.strictEqual(mod.gyosuan.deckMd, deckMd, '저장한 편성안은 그대로');
        mod.gyosuan = { ...mod.gyosuan, deckHtml: '<편집>' };
        assert.deepStrictEqual(plain(slides(ctx.getSlideStudioPayload('m1'))), [['그림', `도식 ![](${PNG})`], ['빈 칸', '도식']], '화면 편집본이 있으면 손대지 않는다');
    });

    /* ======================= 6. 프롬프트 ======================= */
    await run('편성안 지시: 두 형식 모두 한 줄에 핵심 하나(설명 나열은 슬라이드에 쓰지 않고 교수안에), 빈 그림 자리·머리줄만 있는 표·빈 도식 블록 금지를 넣는다', async () => {
        for (const style of ['presentation', 'detailed']) {
            const ctx = makeContext({ storage: { 'kb-slide-style': style } });
            const mod = lessonOf();
            ctx.getEditingModule = () => mod;
            const sections = [];
            const ask = ctx.callGemini;
            ctx.callGemini = async (model, payload) => {
                if (payload.contents.at(-1).parts[0].text.includes('@@GYOSUAN@@')) sections.push(payload);
                return ask(model, payload);
            };
            assert.strictEqual(await ctx.generateGyosuan('m1'), true);
            const prompt = sections[0].contents.at(-1).parts[0].text;
            const system = sections[0].systemInstruction.parts[0].text;
            assert.ok(prompt.includes('[슬라이드 규칙]'), prompt);
            assert.ok(prompt.includes('한 줄에 핵심 하나'), `${style}: 한 줄에 핵심 하나`);
            assert.ok(/설명을 늘어놓[^\n]*교수안 블록의 설명 내용/.test(prompt), `${style}: 설명은 교수안에`);
            assert.ok(prompt.includes('- 빈 그림 자리(![](), <img>, [이미지])나 머리줄만 있는 표, 내용이 없는 도식·차트 블록(mermaid 등)은 넣지 않습니다.'), prompt);
            assert.ok(prompt.includes('- 이미지/시각: (그릴 장면 한 줄 제안. 어울리는 그림이 없으면 이 줄을 뺀다)'), prompt);
            assert.ok(system.includes(style === 'detailed' ? '한 줄에 핵심 하나만 담고' : '화면에 띄울 짧은 말만'), system);
            assert.ok(!prompt.includes('설명 문장 3~5개로 촘촘하게'), '설명을 촘촘히 늘어놓으라고 하지 않는다');
        }
    });

    /* ======================= 7. 연결 ======================= */
    await run('연결: index.html이 교수안 파일 뒤에 다듬기·재생성 파일을 싣고, 새 파일은 kbuilder(js/kbuilder)를 고치지 않는다', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        const at = name => html.indexOf(`<script src="./js/${name}?v=`);
        ['gyosuan-io.js', 'gyosuan-deck-tidy.js', 'gyosuan-regen.js'].forEach(name => assert.ok(at(name) > 0, name));
        assert.ok(at('kbuilder/sample-data.js') < at('gyosuan.js') && at('gyosuan-io.js') < at('gyosuan-deck-tidy.js') && at('gyosuan-deck-tidy.js') < at('gyosuan-regen.js'));
        ['gyosuan-deck-tidy.js', 'gyosuan-regen.js'].forEach(name => assert.ok(!/KBuilder\.[\w.]+\s*=[^=]/.test(source(name)), `${name}는 KBuilder를 바꾸지 않는다`));
    });

    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
