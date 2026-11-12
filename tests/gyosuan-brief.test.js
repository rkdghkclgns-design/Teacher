// 간이 교수안 테스트 (실행: node tests/gyosuan-brief.test.js)
// 교과 안 차시 시간으로 일차·같은 날 교안 순서를 정하는지(8시간 경계, 시간 없는 차시), 교과 번호 규칙, 마크다운 모양,
// AI 답 읽기·검사(나쁜 답과 실패에도 교수안은 그대로), 갈래마다 따로 두는지, 데이터 보호(safeGyosuan·이전 교수안·내보내기·불러오기),
// 비용 미리 보기의 호출 수, 교수안 화면 단추, 일괄 생성 보고를 실제 파일로 확인한다. AI 응답만 스텁이다. 키는 가짜 값만 쓴다.
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
    'import-stream.js', 'output-import.js', 'gyosuan-io.js', 'gyosuan-deck-tidy.js', 'gyosuan-regen.js', 'gyosuan-brief.js', 'course-flow.js'
];

const META = '부제: 부제\n대상: 수강생\n선행: 없음\n결과물: 메모\n교보제: 슬라이드\n[학습목표]\n- 설명할 수 있다.\n[개요]\n개요 문단입니다.\n[수업흐름]\n단계 | 시간 | 핵심\n도입 | 10분 | 시작\n전개 | 60분 | 본문\n정리 | 10분 | 끝\n[준비물]\n- 빔프로젝터\n[산출물]\n- 재미 분석 메모\n[평가]\n- 확인\n[유의사항]\n- 검토한다.';
const SECTION = '@@GYOSUAN@@\n**강사 활동**: 화면을 띄운다.\n**설명 내용**:\n- 내용이다.\n**멘트 예시**: "시작합니다."\n**학생 활동**: 따라 한다.\n@@SLIDES@@\n### 슬라이드 - 본문\n- 슬라이드 문구:\n  - 핵심\n- 이미지/시각: 도식\n- 핵심 메시지: 메시지';
const OPEN_CLOSE = '@@INTRO@@\n제목: 열기\n**강사 활동**: 연다.\n@@CLOSE@@\n제목: 닫기\n**강사 활동**: 닫는다.';
// 간이 교수안 답: 굵게·번호 글머리·형식 설명 줄·끝 마침표가 빠진 과제를 함께 넣어 읽기 규칙을 본다
const BRIEF = [
    '@@필수@@',
    '- MDA 세 층을 게임 예시로 설명한다.',
    '* **재미 분석표**를 함께 채운다.',
    '- (이 차시에서 빠뜨리면 안 되는 것. 2~5개, 한 줄에 하나)',
    '@@과제@@',
    '- 과제: 재미 분석 메모를 써서 제출한다',
    '@@권장@@',
    '1. 다른 장르 게임으로 MDA를 비교한다.'
].join('\n');

const LONG = '충분히 긴 본문 문장이 여기에 들어갑니다. 내용을 차근차근 풀어서 다룹니다.';
const lessonOf = () => ({
    id: 'm1', title: '재미의 구조', hours: 2, images: {},
    tabContents: {
        basicLearn: `## 1. 재미의 구조 (⏱ 30분)\n\n구조표식 ${LONG}\n\n## 2. 재미 분석 (⏱ 30분)\n\n분석표식 ${LONG}`,
        basicPrac: `## 실습 과제 (⏱ 30분)\n\n분석 메모를 써서 제출합니다. ${LONG}\n\n\`\`\`python\n# 코드 주석은 제목이 아니다\nx = 1\n\`\`\``,
        advLearn: `## 1. 심화 섹션 (⏱ 40분)\n\n심화표식 ${LONG}`,
        advPrac: null, assessment: null, advAssessment: null
    }
});

// 교과 목록: 둘째 교과(번호 2)가 지금 연 교과. 그 차시들의 시간 3 · 2(이 차시) · 3 · 1.5시간이면 넷째 차시는 8시간째에 시작해 2일차다
function makeContext({ confirm = true, briefReply = () => reply(BRIEF) } = {}) {
    const elements = {};
    const stored = { 'kb-auto-img': '0' };
    const prompts = [];
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, URL, encodeURIComponent, Blob, TextDecoder, JSON, Date, Map, Set,
        TEXT_MODEL: 'claude-opus-5-5',
        CONTEXT_CORE: { personas: { instructor: '강사입니다.' } },
        INSTRUCTOR_TONE_PRESETS: [{ id: 'formal', label: '합쇼체' }], instructorTone: 'formal',
        getReferenceContext: () => '', stripInstructorCallouts: text => text,
        courseData: [], globalState: { subjects: [{ id: 's0', title: '오리엔테이션', lessons: [] }, { id: 's1', title: 'C++ 프로그래밍 입문' }], courseTitle: '과정' },
        currentSubjectId: 's1', currentEditingModuleId: 'm1',
        apiKey: 'test-key', claudeApiKey: '', isClaudeModel: () => true,
        extractText: data => data.candidates[0].content.parts[0].text,
        escapeHtml, sanitizeLessonHtml: html => html, marked: { parse: md => `<md>${md}</md>` },
        localStorage: { getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = String(value); } },
        location: { hash: '' }, decodeURIComponent, TextEncoder, Uint8Array, atob, btoa,
        document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, getElementById: id => elements[id] || null, createElement: () => ({ appendChild() {} }) },
        BroadcastChannel: function () { this.postMessage = () => {}; },
        saveState: async () => { ctx.saved = (ctx.saved || 0) + 1; },
        renderEditor: () => { ctx.rendered = (ctx.rendered || 0) + 1; },
        refreshAfterGyosuan: () => {},
        generateImageAPI: async () => 'data:image/png;base64,iVBORw0KGgo=',
        callGemini: async (model, payload) => {
            const text = payload.contents.at(-1).parts[0].text;
            prompts.push(text);
            if (text.includes('@@필수@@')) {
                ctx.briefCalls = (ctx.briefCalls || 0) + 1;
                ctx.briefSystem = payload.systemInstruction.parts[0].text;
                return ctx.briefReply(text);
            }
            if (text.includes('@@INTRO@@')) return reply(OPEN_CLOSE);
            if (text.includes('@@GYOSUAN@@')) return reply(SECTION);
            if (text.includes('교수안 머리말')) return reply(META);
            throw new Error('호출되면 안 됨');
        },
        confirm: () => { throw new Error('브라우저 기본 확인 창을 쓰면 안 된다'); },
        asked: [], alerts: [], toasts: [], prompts, elements, briefReply
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    loadLessonTracks(ctx, { tabs: true });
    FILES.forEach(file => vm.runInContext(source(file), ctx));
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind });
    ctx.confirmAsync = async (message, opts) => {
        ctx.asked.push({ message, opts });
        return typeof confirm === 'function' ? confirm(message, opts) : confirm;
    };
    const mod = lessonOf();
    ctx.courseData = [{ id: 'L1', title: '변수', hours: 3 }, mod, { id: 'L3', title: '자료형', hours: 3 }, { id: 'L4', title: '포인터', hours: 1.5 }];
    ctx.getEditingModule = id => (id === undefined || String(id) === 'm1' ? mod : null);
    return { ctx, mod };
}

const EXPECTED_BASIC = [
    '# 재미의 구조 교수안', '',
    '이 교수안은 참고용입니다. 수업에 필요하면 절을 새로 만들거나 기존 절을 고쳐 써도 됩니다.', '',
    '- 교과: 2 C++ 프로그래밍 입문 · 1일차',
    '- 교안 순서와 권장 수업 시간:',
    '  1. 변수 — 3시간',
    '  2. 재미의 구조 — 2시간',
    '  3. 자료형 — 3시간', '',
    '## 필수', '',
    '- MDA 세 층을 게임 예시로 설명한다.',
    '- 재미 분석표를 함께 채운다.',
    '- 과제: 재미 분석 메모를 써서 제출한다. 제출 기한은 수업 중에 반드시 고지한다.', '',
    '## 시간이 되면 권장', '',
    '- 다른 장르 게임으로 MDA를 비교한다.', ''
].join('\n');

(async () => {
    /* ======================= 1. 일차와 같은 날 교안 순서 ======================= */
    await run('일차: 앞 차시 시간 합 ÷ 8시간의 몫 + 1. 8시간째에 시작하면 다음 날, 7시간 59분째면 그날. 같은 날 차시만 교과 순서대로 시간과 함께', async () => {
        const { ctx } = makeContext();
        const plan = (lessons, mod) => plain(call(ctx, 'briefDayPlan')(lessons, mod));
        const L = (id, hours) => ({ id, title: id, ...(hours === undefined ? {} : { hours }) });
        const list = [L('A', 3), L('B', 2), L('C', 3), L('D', 1.5), L('E'), L('F', 4), L('G', 0.75)];
        // 시작(분): A 0 · B 180 · C 300 · D 480 · E 570(시간 없음) · F 570 · G 810
        assert.deepStrictEqual(plan(list, list[0]), { day: 1, items: [{ title: 'A', minutes: 180 }, { title: 'B', minutes: 120 }, { title: 'C', minutes: 180 }] });
        assert.deepStrictEqual(plan(list, list[2]).day, 1, '8시간을 넘겨 끝나도 시작이 그날이면 그날');
        assert.deepStrictEqual(plan(list, list[3]), { day: 2, items: [{ title: 'D', minutes: 90 }, { title: 'F', minutes: 240 }, { title: 'G', minutes: 45 }] }, '정확히 8시간째에 시작하면 2일차, 시간 없는 E는 목록에 없다');
        assert.deepStrictEqual(plan(list, list[4]), { day: null, items: [{ title: 'E', minutes: 0 }] }, '시간이 없으면 일차 없이 그 차시만');
        const edge = [L('X', 479 / 60), L('Y', 1), L('Z', 1)];
        assert.deepStrictEqual(plan(edge, edge[1]), { day: 1, items: [{ title: 'X', minutes: 479 }, { title: 'Y', minutes: 60, to: 2 }] }, '7시간 59분째에 시작하면 1일차(2일차로 넘어간다)');
        assert.deepStrictEqual(plan(edge, edge[2]), { day: 2, items: [{ title: 'Y', minutes: 60, from: 1 }, { title: 'Z', minutes: 60 }] }, 'Z는 8시간 59분째에 시작해 2일차, 1일차에서 넘어온 Y도 그날 목록에 있다');
        const missing = [L('A', 'x'), L('B', -1), L('C', 2)];
        assert.deepStrictEqual(plan(missing, missing[2]), { day: 1, items: [{ title: 'C', minutes: 120 }] }, '숫자가 아니거나 0 이하인 시간은 0시간');
        assert.deepStrictEqual(plan(list, { id: 'B', title: 'B 사본', hours: 2 }).day, 1, '같은 객체가 없으면 id로 찾는다');
        assert.deepStrictEqual(plan(list, { id: 'Q', title: 'Q', hours: 1 }), { day: null, items: [{ title: 'Q', minutes: 60 }] }, '교과에서 찾지 못하면 일차 없이 그 차시만(시간은 보인다)');
        assert.deepStrictEqual(plan(null, list[0]), { day: null, items: [{ title: 'A', minutes: 180 }] });
    });

    await run('여러 날에 걸친 차시: 걸친 모든 날(시작 포함, 끝 제외)의 목록에 넣고 이어지는 날을 적는다. 그 차시의 일차는 시작한 날', async () => {
        const { ctx } = makeContext();
        const plan = (lessons, mod) => plain(call(ctx, 'briefDayPlan')(lessons, mod));
        const L = (id, hours) => ({ id, title: id, hours });
        // 시작(분): A 0 · B 360(20시간, 1560분 앞까지: 1~4일차) · C 1560(7시간, 1980분 앞까지: 4~5일차) · D 1980
        const list = [L('A', 6), L('B', 20), L('C', 7), L('D', 1)];
        assert.deepStrictEqual(plan(list, list[0]), { day: 1, items: [{ title: 'A', minutes: 360 }, { title: 'B', minutes: 1200, to: 4 }] });
        assert.deepStrictEqual(plan(list, list[1]), { day: 1, items: [{ title: 'A', minutes: 360 }, { title: 'B', minutes: 1200, to: 4 }] }, '긴 차시의 일차는 시작한 날');
        assert.deepStrictEqual(plan(list, list[2]), { day: 4, items: [{ title: 'B', minutes: 1200, from: 1 }, { title: 'C', minutes: 420, to: 5 }] }, 'B는 4일차 안에서 끝나 4일차 목록에도 있다');
        assert.deepStrictEqual(plan(list, list[3]), { day: 5, items: [{ title: 'C', minutes: 420, from: 4 }, { title: 'D', minutes: 60 }] });
        const exact = [L('E', 8), L('F', 8)];
        assert.deepStrictEqual(plan(exact, exact[1]), { day: 2, items: [{ title: 'F', minutes: 480 }] }, '정확히 8시간째에 끝난 차시는 다음 날에 넣지 않는다(끝 제외)');
        assert.deepStrictEqual(plan(exact, exact[0]), { day: 1, items: [{ title: 'E', minutes: 480 }] });
        const middle = [L('G', 1), L('H', 20)];
        const { ctx: head } = makeContext();
        head.globalState.subjects = [{ id: 's7', title: '긴 교과' }];
        head.currentSubjectId = 's7';
        head.courseData = middle;
        assert.ok(call(head, 'gyosuanBriefHeader')(middle[1], 'basic').includes('- 교과: 1 긴 교과 · 1일차\n- 교안 순서와 권장 수업 시간:\n  1. G — 1시간\n  2. H — 20시간 (3일차까지 이어짐)'));
        assert.strictEqual(call(head, 'briefSpanText')({ from: 1, to: 3 }), ' (1일차부터 3일차까지 이어짐)');
        assert.strictEqual(call(head, 'briefSpanText')({ from: 2 }), ' (2일차부터 이어짐)');
    });

    await run('시간 글: 1시간 · 1시간 30분 · 45분 · 2시간 5분', async () => {
        const { ctx } = makeContext();
        const text = call(ctx, 'briefDurationText');
        assert.deepStrictEqual([60, 90, 45, 125].map(text), ['1시간', '1시간 30분', '45분', '2시간 5분']);
    });

    await run('교과 줄: 교과 목록의 차례(1부터)를 앞에 붙이고, 이름이 숫자로 시작하면 붙이지 않는다', async () => {
        const { ctx } = makeContext();
        const label = call(ctx, 'briefSubjectLabel');
        const subjects = [{ id: 'a', title: 'C++ 프로그래밍 입문' }, { id: 'b', title: '2 자료구조' }, { id: 'c', title: '03. 알고리즘' }, { id: 'd', title: '  게임 엔진  ' }];
        assert.deepStrictEqual(subjects.map(subject => label(subjects, subject)), ['1 C++ 프로그래밍 입문', '2 자료구조', '03. 알고리즘', '4 게임 엔진']);
        assert.strictEqual(label(subjects, { id: 'zz', title: '목록 밖' }), '목록 밖', '목록에 없으면 번호 없이');
        assert.strictEqual(label(subjects, { id: 'b', title: '복사본' }), '2 복사본', 'id로도 찾는다');
        assert.strictEqual(label(subjects, null), '');
        // 차례 번호로 보는 것은 두 자리까지의 숫자 뒤에 빈칸이나 . ) · : - 가 오고 숫자가 아닌 글이 이어질 때뿐이다
        const named = ['1. 게임 기획', '1 C++ 프로그래밍 입문', '3D 모델링', '2024 신규 과정', '12) 졸업 작품', '1.5 업데이트'].map((title, i) => ({ id: `n${i}`, title }));
        assert.deepStrictEqual(named.map(subject => label(named, subject)), ['1. 게임 기획', '1 C++ 프로그래밍 입문', '3 3D 모델링', '4 2024 신규 과정', '12) 졸업 작품', '6 1.5 업데이트']);
    });

    await run('머리: 시간이 없는 차시는 일차 없이 그 차시만 시간 없이 쓰고, 교과를 찾지 못하면 과정 이름을 쓴다', async () => {
        const { ctx } = makeContext();
        const quest = { id: 'mainQuest', title: '최종 과제' };
        ctx.courseData = [...ctx.courseData, quest];
        assert.strictEqual(call(ctx, 'gyosuanBriefHeader')(quest, 'basic'), [
            '# 최종 과제 교수안', '', '이 교수안은 참고용입니다. 수업에 필요하면 절을 새로 만들거나 기존 절을 고쳐 써도 됩니다.', '',
            '- 교과: 2 C++ 프로그래밍 입문', '- 교안 순서와 권장 수업 시간:', '  1. 최종 과제'
        ].join('\n'));
        ctx.globalState.subjects = [];
        assert.ok(call(ctx, 'gyosuanBriefHeader')(quest, 'basic').includes('\n- 교과: 과정\n'), '교과가 없으면 과정 이름');
        // 다른 교과의 차시(그 객체를 담은 교과를 찾는다)
        const other = { id: 'o1', title: '함수', hours: 1 };
        ctx.globalState.subjects = [{ id: 's1', title: '지금 교과' }, { id: 's9', title: '다른 교과', lessons: [{ id: 'o0', title: '앞 차시', hours: 8 }, other] }];
        assert.ok(call(ctx, 'gyosuanBriefHeader')(other, 'adv').includes('# 함수 (심화학습) 교수안\n') && call(ctx, 'gyosuanBriefHeader')(other, 'adv').includes('- 교과: 2 다른 교과 · 2일차\n- 교안 순서와 권장 수업 시간:\n  1. 함수 — 1시간'));
    });

    /* ======================= 2. AI 답 읽기·검사 ======================= */
    await run('답 읽기: 표시 사이 글머리 항목만, 굵게·번호·형식 설명 줄·겹친 항목을 덜고 과제 끝에 제출 기한 고지를 붙인다. 넘치면 필수 5·권장 4까지', async () => {
        const { ctx } = makeContext();
        const parse = text => plain(call(ctx, 'parseBriefAnswer')(text));
        assert.deepStrictEqual(parse(BRIEF), {
            must: ['MDA 세 층을 게임 예시로 설명한다.', '재미 분석표를 함께 채운다.'],
            task: '재미 분석 메모를 써서 제출한다. 제출 기한은 수업 중에 반드시 고지한다.',
            extra: ['다른 장르 게임으로 MDA를 비교한다.']
        });
        const many = ['@@필수@@', ...[1, 2, 3, 4, 5, 6, 6].map(n => `- 필수 ${n}`), '@@과제@@', '없음', '@@권장@@', ...[1, 2, 3, 4, 5].map(n => `- 권장 ${n}`)].join('\r\n');
        assert.deepStrictEqual(parse(many), { must: ['필수 1', '필수 2', '필수 3', '필수 4', '필수 5'], task: '', extra: ['권장 1', '권장 2', '권장 3', '권장 4'] }, '없음이면 과제 없음, 넘치면 앞에서부터');
        assert.strictEqual(parse('@@필수@@\n- 가\n- 나\n@@과제@@\n- 보고서를 낸다. 제출 기한은 다음 주로 정해 고지한다.\n@@권장@@\n- 다\n').task,
            '보고서를 낸다. 제출 기한은 다음 주로 정해 고지한다. 제출 기한은 수업 중에 반드시 고지한다.', '기한 이야기만으로는 넘기지 않는다(수업 중에 고지한다는 말이 있어야 한다)');
        assert.strictEqual(parse('@@필수@@\n- 가\n- 나\n@@과제@@\n- 보고서를 낸다. 제출 기한은 수업 중에 고지한다.\n@@권장@@\n- 다\n').task, '보고서를 낸다. 제출 기한은 수업 중에 고지한다.', '수업 중에 고지한다는 말이 있으면 그대로');
        assert.strictEqual(parse('@@필수@@\n- 가\n- 나\n@@과제@@\n- 기한 안에 보고서를 낸다\n@@권장@@\n- 다\n').task, '기한 안에 보고서를 낸다. 제출 기한은 수업 중에 반드시 고지한다.');
        assert.strictEqual(parse('@@필수@@\n- 가\n- 나\n@@권장@@\n- 다').task, '', '과제 표시가 없으면 과제가 없는 것');
        assert.strictEqual(parse('@@필수@@\n- 가\n- 나\n@@과제@@\n- 해당 없음\n@@권장@@\n- 다').task, '');
        assert.strictEqual(parse('@@필수@@\n- 가\n- 나\n@@과제@@\n과제 없음\n@@권장@@\n- 다').task, '');
    });

    await run('답 읽기: 들여쓴 하위 글머리와 글머리 없이 이어지는 줄은 앞 항목에 한 줄로 붙이고, 붙인 뒤에 상한을 센다. 필수와 같은 말인 권장은 뺀다', async () => {
        const { ctx } = makeContext();
        const parse = text => plain(call(ctx, 'parseBriefAnswer')(text));
        const nested = [
            '@@필수@@',
            '시작 전에 덧붙인 말은 버린다',
            '- 변수 선언을 보여 준다.',
            '  - int와 double을 비교한다.',
            '    * 출력 결과를 함께 본다.',
            '- 자료형 표를 채운다.',
            '- 셋',
            '  이어지는 설명 줄도 붙인다.',
            '- 넷', '- 다섯', '- 여섯',
            '@@과제@@',
            '- 실습 결과를 제출한다',
            '  - 제출 방법: LMS 업로드',
            '@@권장@@',
            '- 변수 선언을 보여 준다!',
            '- 자료형  표를 채운다',
            '- 형 변환 예제를 더 푼다.',
            '  - 오류가 나는 경우도 본다.'
        ].join('\n');
        assert.deepStrictEqual(parse(nested), {
            must: ['변수 선언을 보여 준다. int와 double을 비교한다. 출력 결과를 함께 본다.', '자료형 표를 채운다.', '셋 이어지는 설명 줄도 붙인다.', '넷', '다섯'],
            task: '실습 결과를 제출한다 제출 방법: LMS 업로드. 제출 기한은 수업 중에 반드시 고지한다.',
            extra: ['변수 선언을 보여 준다!', '형 변환 예제를 더 푼다. 오류가 나는 경우도 본다.']
        }, '하위 글머리는 항목으로 세지 않아 필수 상한 5를 붙인 뒤에 센다. 권장의 \'자료형  표를 채운다\'는 필수와 문장부호·빈칸만 달라 뺀다');
        const folded = parse('@@필수@@\n- 하나뿐이다.\n  - 하위 글머리는 항목이 아니다.\n@@권장@@\n- 둘');
        assert.strictEqual(folded.error, '간이 교수안 응답의 필수 항목이 2개보다 적습니다.', '하위 글머리를 붙이면 필수가 하나다');
        assert.strictEqual(parse('@@필수@@\n- 가.\n- 나\n@@권장@@\n- 가!\n- 나 .').error, '간이 교수안 응답에 시간이 되면 권장할 항목이 없습니다.', '권장이 모두 필수와 같은 말이면 받지 않는다');
        assert.deepStrictEqual(parse('@@필수@@\n- 가.\n- 가!\n- 나\n@@권장@@\n- 다\n---').must, ['가.', '나'], '필수 안에서도 문장부호만 다른 항목은 하나만, 문장부호뿐인 줄은 버린다');
    });

    await run('답 검사: 표시가 없거나 필수가 2개보다 적거나 권장이 없으면 받지 않는다', async () => {
        const { ctx } = makeContext();
        const parse = text => plain(call(ctx, 'parseBriefAnswer')(text));
        assert.strictEqual(parse('필수: 설명한다.\n권장: 비교한다.').error, '간이 교수안 응답에 필수·권장 표시가 없습니다.');
        assert.strictEqual(parse('@@필수@@\n- 설명한다.\n@@과제@@\n없음').error, '간이 교수안 응답에 필수·권장 표시가 없습니다.');
        assert.strictEqual(parse('@@필수@@\n- 하나뿐이다.\n@@권장@@\n- 비교한다.').error, '간이 교수안 응답의 필수 항목이 2개보다 적습니다.');
        assert.strictEqual(parse('@@필수@@\n- 가\n- 가\n@@권장@@\n- 비교한다.').error, '간이 교수안 응답의 필수 항목이 2개보다 적습니다.', '겹친 항목은 하나로 센다');
        assert.strictEqual(parse('@@필수@@\n- 가\n- 나\n@@권장@@\n(시간이 남으면 더 다룰 것)\n- (형식 설명)').error, '간이 교수안 응답에 시간이 되면 권장할 항목이 없습니다.');
        assert.strictEqual(parse('').error, '간이 교수안 응답에 필수·권장 표시가 없습니다.');
    });

    await run('보내는 교수안: 머리글·그림·목차를 빼고, 길면 진행 절만 줄여 뒤의 학생 산출물·제출 절은 그대로 보낸다', async () => {
        const { ctx } = makeContext();
        const doc = ['---', '교과목: 과목', '---', '', '# 교수안 - 주제', '', '## 목차', '', '- [진행](#진행)', '', '## 진행', '', `![그림](local:img_1)${'가'.repeat(5000)}`, '', '## 학생 산출물·제출', '', '- 메모를 제출한다.'].join('\n');
        const sent = call(ctx, 'briefSourceDoc')(doc, 1000);
        assert.ok(!sent.includes('교과목:') && !sent.includes('local:img_1') && !sent.includes('## 목차'), sent.slice(0, 200));
        assert.ok(sent.includes('…(진행 일부 생략)') && sent.endsWith('## 학생 산출물·제출\n\n- 메모를 제출한다.'), sent.slice(-120));
        assert.ok(sent.length <= 1000 + 20, `길이 ${sent.length}`);
        assert.strictEqual(call(ctx, 'briefSourceDoc')('## 진행\n\n짧다.'), '## 진행\n\n짧다.');
    });

    /* ======================= 3. 교수안을 만들 때 함께 만든다 ======================= */
    await run('만들기: 교수안을 저장한 뒤 그 교수안으로 간이 교수안을 한 번 불러 그 갈래 칸(briefMd)에 넣는다. 머리는 코드가, 필수·과제·권장은 답에서', async () => {
        const { ctx, mod } = makeContext();
        assert.strictEqual(await ctx.generateGyosuan('m1'), true, ctx.alerts.join('\n'));
        assert.strictEqual(ctx.briefCalls, 1, '갈래 하나에 호출 하나');
        assert.ok(mod.gyosuan.docMd.includes('## 진행'), '교수안');
        assert.strictEqual(mod.gyosuan.briefMd, EXPECTED_BASIC);
        assert.strictEqual(mod.gyosuan.briefDocKey, call(ctx, 'gyosuanBriefDocKey')(mod.gyosuan.docMd), '만든 교수안의 지문을 함께 둔다');
        assert.strictEqual(mod.gyosuanAdv, undefined, '다른 갈래는 그대로');
        assert.strictEqual(ctx.saved, 2, '교수안을 먼저 저장하고 간이 교수안을 넣어 한 번 더 저장한다');
        const prompt = ctx.prompts.find(text => text.includes('@@필수@@'));
        assert.ok(prompt.includes('[차시] 재미의 구조') && prompt.includes('[교수안]\n# 교수안 - 재미의 구조') && prompt.includes('## 학생 산출물·제출'), prompt.slice(0, 400));
        assert.ok(prompt.includes('[기본학습 탭 제목]\n- 재미의 구조\n- 재미 분석') && prompt.includes('[기본실습 탭 제목]\n- 실습 과제\n['), '탭 제목(⏱ 시간은 뺀다)');
        assert.ok(!prompt.includes('코드 주석은 제목이 아니다') && !prompt.includes('교과목:') && !prompt.includes('## 목차'), '코드 블록 속 # 줄·머리글·목차는 보내지 않는다');
        assert.ok(prompt.includes('제출 기한은 정하지 말고 "제출 기한은 수업 중에 반드시 고지한다."로 끝냅니다.'));
        assert.ok(ctx.briefSystem.startsWith('강사입니다. 직업훈련 강사가 수업 전에 한눈에 보는 간이 교수안을 씁니다.'), ctx.briefSystem);
        assert.deepStrictEqual(plain(ctx.toasts.at(-1)), { message: '기본학습 교수안과 슬라이드 편성안을 만들었습니다.', kind: 'success' });
    });

    await run('갈래마다 따로: 심화학습 교수안을 만들면 gyosuanAdv.briefMd에 심화학습 주제로 넣고 기본학습 간이 교수안은 그대로 둔다', async () => {
        const { ctx, mod } = makeContext();
        await ctx.generateGyosuan('m1');
        const basic = mod.gyosuan.briefMd;
        ctx.briefReply = () => reply('@@필수@@\n- 심화 섹션을 설명한다.\n- 심화 예제를 함께 푼다.\n@@과제@@\n없음\n@@권장@@\n- 추가 예제를 보인다.');
        assert.strictEqual(await ctx.generateGyosuan('m1', { track: 'adv' }), true, ctx.alerts.join('\n'));
        assert.strictEqual(mod.gyosuan.briefMd, basic);
        assert.ok(mod.gyosuanAdv.briefMd.startsWith('# 재미의 구조 (심화학습) 교수안\n\n'), mod.gyosuanAdv.briefMd.slice(0, 80));
        assert.ok(mod.gyosuanAdv.briefMd.includes('## 필수\n\n- 심화 섹션을 설명한다.\n- 심화 예제를 함께 푼다.\n\n## 시간이 되면 권장\n\n- 추가 예제를 보인다.\n'), '과제가 없으면 과제 줄이 없다');
        assert.ok(!mod.gyosuanAdv.briefMd.includes('과제:'));
    });

    await run('실패: 호출이 실패하면 교수안은 그대로 두고 briefMd를 두지 않으며, 까닭과 다시 만드는 길을 알린다(만들기는 성공)', async () => {
        const { ctx, mod } = makeContext({ briefReply: () => { throw new Error('호출 한도'); } });
        assert.strictEqual(await ctx.generateGyosuan('m1'), true);
        assert.ok(mod.gyosuan.docMd.includes('## 진행') && mod.gyosuan.deckMd, '교수안·편성안은 남는다');
        assert.ok(!('briefMd' in mod.gyosuan));
        assert.deepStrictEqual(plain(ctx.toasts.at(-1)), {
            message: "기본학습 교수안과 슬라이드 편성안을 만들었습니다. 간이 교수안을 만들지 못했습니다: 호출 한도. 교수안 화면의 '간이 교수안 만들기'로 다시 만들 수 있습니다.",
            kind: 'warning'
        });
        assert.strictEqual(ctx.saved, 1, '교수안만 저장했다');
    });

    await run('나쁜 답: 형식이 맞지 않으면 받지 않고(교수안은 그대로) 형식 까닭을 알린다', async () => {
        const { ctx, mod } = makeContext({ briefReply: () => reply('간이 교수안입니다. 수업을 잘 하세요.') });
        const result = await call(ctx, 'runGyosuanGeneration')('m1', {});
        assert.strictEqual(result.ok, true);
        assert.deepStrictEqual(plain(result.brief), { ok: false, error: '간이 교수안을 만들지 못했습니다: 간이 교수안 응답에 필수·권장 표시가 없습니다.' });
        assert.ok(mod.gyosuan.docMd && !mod.gyosuan.briefMd);
    });

    await run('빈 전개: 전개를 만들지 못해 빈칸으로 둔 교수안으로는 간이 교수안을 부르지 않고, 그 까닭과 빈 전개를 채운 뒤 만드는 길을 알린다. 일괄 생성 보고에도 까닭을 적는다', async () => {
        const { ctx, mod } = makeContext();
        const answer = ctx.callGemini;
        let sections = 0;
        ctx.callGemini = async (model, payload) => {
            if (payload.contents.at(-1).parts[0].text.includes('@@GYOSUAN@@') && ++sections === 1) throw new Error('전개 실패');
            return answer(model, payload);
        };
        assert.strictEqual(await ctx.generateGyosuan('m1'), true);
        assert.ok(mod.gyosuan.docMd.includes('(생성 실패') && !('briefMd' in mod.gyosuan), '교수안은 남기고 간이 교수안은 만들지 않는다');
        assert.strictEqual(ctx.briefCalls || 0, 0, '간이 교수안을 부르지 않는다');
        assert.strictEqual(ctx.alerts.at(-1), "기본학습 교수안의 전개 1개를 생성하지 못해 빈칸으로 두었습니다. 다시 생성하거나 직접 작성해 주세요.\n전개 1개를 만들지 못한 교수안이라 간이 교수안을 만들지 않았습니다. 빈 전개를 채운 뒤 교수안 화면의 '간이 교수안 만들기'로 만들 수 있습니다.");
        mod.gyosuan = undefined;
        ctx.runGyosuanGeneration = async () => ({ ok: true, partial: true, brief: { ok: false, skipped: true, error: '전개 1개를 만들지 못한 교수안이라 간이 교수안을 만들지 않았습니다.' } });
        const filled = plain(await call(ctx, 'fillRunGyosuan')('m1', { stopped: false }));
        assert.deepStrictEqual(filled, { ok: true, partial: true, briefMissed: ['기본학습(빈 전개가 있어 건너뜀)', '심화학습(빈 전개가 있어 건너뜀)'] });
    });

    await run('기다리는 동안 교수안이 바뀌면 그 교수안과 맞지 않는 간이 교수안을 넣지 않는다', async () => {
        const { ctx, mod } = makeContext();
        await ctx.generateGyosuan('m1');
        ctx.briefReply = () => { mod.gyosuan = { ...mod.gyosuan, docMd: '강사가 고친 교수안' }; return reply(BRIEF); };
        const result = plain(await call(ctx, 'fillGyosuanBrief')(mod, 'basic'));
        assert.deepStrictEqual(result, { ok: false, error: '만드는 동안 교수안이 바뀌어 간이 교수안을 넣지 않았습니다.' });
        assert.strictEqual(mod.gyosuan.docMd, '강사가 고친 교수안');
        assert.strictEqual(mod.gyosuan.briefMd, EXPECTED_BASIC, '전에 만든 간이 교수안은 그대로');
    });

    await run('편성안만 다시 만들면(교수안 그대로) 간이 교수안도 그대로 두고 부르지 않는다', async () => {
        const { ctx, mod } = makeContext();
        await ctx.generateGyosuan('m1');
        ctx.briefCalls = 0;
        mod.gyosuan = { ...mod.gyosuan, briefMd: '강사가 고친 간이 교수안' };
        const key = mod.gyosuan.briefDocKey;
        assert.strictEqual(await ctx.generateGyosuan('m1', { keepDoc: true }), true);
        assert.deepStrictEqual([ctx.briefCalls, mod.gyosuan.briefMd, mod.gyosuan.briefDocKey], [0, '강사가 고친 간이 교수안', key], '간이 교수안과 그 지문을 그대로 둔다');
    });

    await run('일괄 생성(background): 그 작업이 이미 멈췄으면 부르지 않고, 간이 교수안을 만들지 못한 갈래를 보고에 남긴다', async () => {
        const { ctx, mod } = makeContext();
        let stopNow = false;
        ctx.isTabGenerationStopped = () => stopNow;
        ctx.refreshAfterGyosuan = () => { stopNow = true; }; // 교수안을 저장한 뒤 일괄 생성의 중지를 누른다
        const stopped = await call(ctx, 'runGyosuanGeneration')('m1', { background: true });
        assert.deepStrictEqual([stopped.ok, plain(stopped.brief), ctx.briefCalls || 0], [true, { ok: false, stopped: true, error: '간이 교수안 만들기를 중지했습니다.' }, 0]);
        assert.ok(mod.gyosuan.docMd && !mod.gyosuan.briefMd, '교수안은 남는다');
        stopNow = false;
        mod.gyosuan = undefined;
        ctx.briefReply = text => (text.includes('(심화학습)') ? reply('형식 없음') : reply(BRIEF));
        const filled = plain(await call(ctx, 'fillRunGyosuan')('m1', { stopped: false }));
        assert.deepStrictEqual(filled, { ok: true, partial: false, briefMissed: ['심화학습'] });
        assert.ok(mod.gyosuan.briefMd && mod.gyosuanAdv.docMd && !mod.gyosuanAdv.briefMd);
        const item = { title: '재미의 구조', subject: { title: '교과' }, lessonId: 'm1' };
        const report = plain(call(ctx, 'recordLessonResult')({ done: [], partial: [], failed: [], short: [], left: [], stopped: false }, item, { ok: true, briefMissed: filled.briefMissed }));
        assert.deepStrictEqual([report.done.length, report.brief], [1, [{ ...item, briefTracks: ['심화학습'] }]]);
        const html = call(ctx, 'lessonRunReportHtml')(report);
        assert.ok(html.includes('간이 교수안을 만들지 못한 차시 1개') && html.includes('교과 · 재미의 구조 <span class="text-textMuted">— 심화학습</span>'), html);
        assert.ok(!('brief' in plain(call(ctx, 'recordLessonResult')({ done: [], partial: [], failed: [], short: [], left: [], stopped: false }, item, { ok: true }))), '다 만들었으면 보고 칸이 없다');
    });

    /* ======================= 4. 교수안 화면의 '간이 교수안 만들기' ======================= */
    await run('간이 교수안 만들기: 비용·시간(호출 1회)을 보이고 물은 뒤 그 호출만 하고, 작업 기록에 남기며 간이 교수안을 펼친다. 취소하면 부르지 않는다', async () => {
        const { ctx, mod } = makeContext();
        await ctx.generateGyosuan('m1');
        const { briefMd: _made, ...withoutBrief } = mod.gyosuan;
        mod.gyosuan = withoutBrief;
        const doc = mod.gyosuan.docMd;
        ctx.prompts.length = 0;
        ctx.briefCalls = 0;
        let answer = false;
        ctx.confirmAsync = async (message, opts) => { ctx.asked.push({ message, opts }); return answer; };
        assert.strictEqual(await ctx.generateGyosuanBrief('m1', 'basic'), false);
        assert.deepStrictEqual([ctx.prompts.length, ctx.asked.length, 'briefMd' in mod.gyosuan], [0, 1, false], '취소하면 부르지 않는다');
        const { message, opts } = ctx.asked[0];
        assert.deepStrictEqual([opts.title, opts.okLabel], ['기본학습 간이 교수안 만들기', '만들기']);
        assert.ok(message.startsWith('기본학습 교수안을 바탕으로 간이 교수안(필수·과제·시간이 되면 권장)을 만듭니다.') && message.includes('글: AI 호출 약 1회'), message);

        answer = true;
        let opened = null;
        ctx.openGyosuanBriefView = (target, track) => { opened = [target === mod, track]; };
        assert.strictEqual(await ctx.generateGyosuanBrief('m1', 'basic'), true, ctx.alerts.join('\n'));
        assert.deepStrictEqual([ctx.briefCalls, ctx.prompts.length], [1, 1], '간이 교수안 호출만');
        assert.strictEqual(mod.gyosuan.briefMd, EXPECTED_BASIC);
        assert.strictEqual(mod.gyosuan.docMd, doc, '교수안은 그대로');
        assert.strictEqual(mod.history[0].note, '기본학습 간이 교수안 AI 생성');
        assert.deepStrictEqual(opened, [true, 'basic']);
        assert.deepStrictEqual(plain(ctx.toasts.at(-1)), { message: '기본학습 간이 교수안을 만들었습니다.', kind: 'success' });
        assert.strictEqual(vm.runInContext('_gyosuanRunning', ctx), false, '끝나면 생성 중 표시를 푼다');
    });

    await run('간이 교수안 만들기: 교수안이 없거나 다른 생성이 돌면 묻지 않고 알린다. 실패하면 교수안은 그대로 두고 까닭을 알린다', async () => {
        const { ctx, mod } = makeContext();
        assert.strictEqual(await ctx.generateGyosuanBrief('m1', 'adv'), false);
        assert.strictEqual(ctx.alerts.at(-1), '먼저 심화학습 교수안을 만들어 주세요.');
        mod.gyosuan = { docMd: '## 진행\n\n교수안' };
        ctx.isLessonPipelineRunning = () => true;
        assert.strictEqual(await ctx.generateGyosuanBrief('m1', 'basic'), false);
        assert.deepStrictEqual([ctx.alerts.at(-1), ctx.asked.length], ['진행 중인 생성이 끝난 뒤 다시 시도해주세요.', 0]);
        ctx.isLessonPipelineRunning = () => false;
        ctx.briefReply = () => reply('@@필수@@\n- 하나\n@@권장@@\n- 둘');
        assert.strictEqual(await ctx.generateGyosuanBrief('m1', 'basic'), false);
        assert.strictEqual(ctx.alerts.at(-1), '간이 교수안을 만들지 못했습니다: 간이 교수안 응답의 필수 항목이 2개보다 적습니다.');
        assert.deepStrictEqual(plain(mod.gyosuan), { docMd: '## 진행\n\n교수안' }, '교수안은 그대로, briefMd 없음');
    });

    /* ======================= 5. 데이터 보호·내보내기·불러오기 ======================= */
    await run('데이터 보호: safeGyosuan은 간이 교수안 글을 그대로 두고 글이 아니면 null로 바꾼다. 이전 교수안 칸과 되돌리기도 간이 교수안을 함께 옮긴다', async () => {
        const { ctx, mod } = makeContext();
        const safe = call(ctx, 'safeGyosuan');
        const kept = { docMd: 'd', briefMd: '# 간이' };
        assert.strictEqual(safe(kept), kept, '바르면 같은 객체');
        assert.deepStrictEqual(plain(safe({ docMd: 'd', briefMd: { x: 1 }, briefDocKey: 5 })), { docMd: 'd', briefMd: null, briefDocKey: null });
        assert.ok(plain(call(ctx, 'GYOSUAN_TEXT_FIELDS')).includes('briefMd'));
        await ctx.generateGyosuan('m1');
        const first = mod.gyosuan;
        ctx.briefReply = () => reply('@@필수@@\n- 새 필수 하나\n- 새 필수 둘\n@@권장@@\n- 새 권장');
        await ctx.generateGyosuan('m1'); // 재생성과 같은 길
        assert.strictEqual(mod.gyosuan.previous.briefMd, first.briefMd, '바꾸기 전 교수안 칸에 옛 간이 교수안');
        assert.ok(mod.gyosuan.briefMd.includes('- 새 필수 하나'));
        const restored = call(ctx, 'restoredGyosuan')(mod, mod.gyosuan, call(ctx, 'previousGyosuanOf')(mod.gyosuan));
        assert.strictEqual(restored.briefMd, first.briefMd, '되돌리면 옛 간이 교수안');
        assert.ok(restored.previous.briefMd.includes('- 새 필수 하나'), '방금 간이 교수안은 이전 칸에');
    });

    await run('내보내기·불러오기: 교수안 HTML 원본에 간이 교수안을 담고 다시 불러오면 되살린다. 글이 아니면 받지 않는다', async () => {
        const { ctx, mod } = makeContext();
        await ctx.generateGyosuan('m1');
        const payload = plain(call(ctx, 'lessonSourcePayload')([mod], { withGyosuan: true }));
        assert.strictEqual(payload.lessons[0].gyosuan.briefMd, EXPECTED_BASIC);
        assert.ok(!('briefMd' in plain(call(ctx, 'lessonSourcePayload')([{ ...mod, gyosuan: { ...mod.gyosuan, briefMd: '' } }], { withGyosuan: true })).lessons[0].gyosuan), '비었으면 칸이 없다');
        assert.strictEqual(plain(call(ctx, 'lessonSourcePayload')([mod], { withGyosuan: false })).lessons[0].gyosuan, null, '읽기용 HTML에는 교수안이 없다');
        assert.strictEqual(payload.lessons[0].gyosuan.briefDocKey, mod.gyosuan.briefDocKey, '교수안 지문도 담는다');
        const back = plain(call(ctx, 'normalizeImportedLesson')(payload.lessons[0], 'n1'));
        assert.deepStrictEqual([back.gyosuan.briefMd, back.gyosuan.briefDocKey], [EXPECTED_BASIC, mod.gyosuan.briefDocKey]);
        assert.strictEqual(call(ctx, 'isGyosuanBriefStale')(back.gyosuan), false, '되살린 간이 교수안은 그 교수안과 맞는다');
        const odd = plain(call(ctx, 'normalizeImportedLesson')({ ...payload.lessons[0], gyosuan: { docMd: 'd', briefMd: ['x'], briefDocKey: 7 } }, 'n2'));
        assert.ok(odd.gyosuan.docMd === 'd' && !('briefMd' in odd.gyosuan) && !('briefDocKey' in odd.gyosuan));
    });

    await run('완성 MD 불러오기: 간이 교수안 파일을 가려 그 칸에 넣는다. 내려받은 교수안을 그대로 다시 불러오면(그림 키가 바뀌어도) 간이 교수안을 그대로 두고, 다른 교수안이면 두되 다시 만들기를 권한다', async () => {
        const { ctx, mod } = makeContext();
        const kind = call(ctx, 'gyosuanFileKind');
        assert.deepStrictEqual([kind('a.md', EXPECTED_BASIC), kind('01_간이교수안.md', '# 메모'), kind('x_교수안.md', '## 진행'), kind('x_교수안.md', '# 메모')], ['briefMd', 'briefMd', 'docMd', 'docMd']);
        const sorted = plain(call(ctx, 'sortGyosuanFiles')([{ name: 'a_교수안.md', text: '## 진행\n\n본문' }, { name: 'a_간이교수안.md', text: EXPECTED_BASIC }]));
        assert.deepStrictEqual(Object.keys(sorted).sort(), ['briefMd', 'docMd']);
        const key = call(ctx, 'gyosuanBriefDocKey');
        const stale = call(ctx, 'isGyosuanBriefStale');
        const convert = (base, files) => plain(call(ctx, 'convertedGyosuan')(base, files));
        // 그림이 든 교수안: 내려받으면 local: 그림이 data URL로 바뀌고(없는 그림 줄은 빠진다) 다시 불러오면 다른 키(img_해시)가 된다
        const PNG = 'data:image/png;base64,iVBORw0KGgo=';
        const docMd = '---\n교과목: 과목\n---\n\n# 교수안\n\n## 진행\n\n도식을 본다. ![도식](local:img_a)\n\n![없는 그림](local:img_none)\n\n마무리한다.\n';
        const base = { docMd, deckMd: '', images: { img_a: PNG }, briefMd: '# 간이', briefDocKey: key(docMd) };
        mod.gyosuan = base;
        const exported = call(ctx, 'resolveGyosuanImages')(docMd, mod, 'basic');
        assert.ok(exported.includes(`![도식](${PNG})`) && !exported.includes('img_none'), exported);
        const reread = plain(call(ctx, 'sortGyosuanFiles')([{ name: '재미의 구조_교수안.md', text: `﻿${exported.replace(/\n/g, '\r\n')}` }]));
        const again = convert(base, reread);
        assert.ok(again.docMd !== docMd && /local:img_\d+/.test(again.docMd), '다시 불러온 교수안은 그림 키가 다르다');
        assert.deepStrictEqual([again.briefMd, again.briefDocKey, stale(again)], ['# 간이', base.briefDocKey, false], '같은 교수안이면 간이 교수안을 그대로 두고 다시 만들기를 권하지 않는다');
        const other = convert(base, { docMd: '## 진행\n\n새 교수안' });
        assert.deepStrictEqual([other.briefMd, stale(other)], ['# 간이', true], '다른 교수안이면 간이 교수안은 두고 다시 만들기를 권한다');
        assert.strictEqual(convert(base, { deckMd: '### 슬라이드 1 - 표지' }).briefMd, '# 간이', '편성안만 바꾸면 둔다');
        const uploaded = convert(base, { docMd: '## 진행\n\n새 교수안', briefMd: '# 새 간이' });
        assert.deepStrictEqual([uploaded.briefMd, stale(uploaded)], ['# 새 간이', false], '함께 올린 간이 교수안은 함께 올린 교수안의 것으로 본다');
        const html = plain(call(ctx, 'importedGyosuan')(base, { html: '<html></html>', source: { doc: '## 진행\n\n다른 교수안', deck: '' } }, null));
        assert.deepStrictEqual([html.briefMd, stale(html)], ['# 간이', true], '내보낸 HTML로 다른 교수안을 불러와도 간이 교수안은 두고 다시 만들기를 권한다');
        assert.strictEqual(stale({ docMd: '바뀐 교수안', briefMd: '# 예전 간이' }), false, '지문이 없는 예전 간이 교수안은 알 수 없어 권하지 않는다');
    });

    await run('바뀐 교수안: 원문 칸에서 교수안을 고치면 간이 교수안 보기 맨 위에 한 줄 알리고 다시 만들기 단추를 둔다. 다시 만들면 바꾼다고 묻고 지문을 새로 단다', async () => {
        const { ctx, mod } = makeContext();
        await ctx.generateGyosuan('m1');
        ctx.elements['gyosuan-view'] = { innerHTML: '', querySelectorAll: () => [] };
        ctx.toggleGyosuanBriefView();
        assert.ok(!ctx.elements['gyosuan-view'].innerHTML.includes('gyosuan-brief-stale'), '교수안이 그대로면 알리지 않는다');
        const raw = { value: '' };
        ctx.elements['gyosuan-raw'] = raw;
        ctx.toggleGyosuanEdit('docMd');
        raw.value = `${mod.gyosuan.docMd}\n강사가 더한 줄\n`;
        await ctx.saveGyosuanRaw();
        ctx.toggleGyosuanEdit('docMd'); // 원문 칸을 닫으면 펼쳐 둔 간이 교수안이 다시 보인다
        const view = ctx.elements['gyosuan-view'].innerHTML;
        assert.ok(view.includes(`<p class="gyosuan-brief-stale">⚠️ 간이 교수안을 만든 뒤 교수안이 바뀌었습니다. <button onclick="generateGyosuanBrief('m1', 'basic')" class="gyosuan-tool"><i class="ph-bold ph-arrows-clockwise"></i> 다시 만들기</button></p>`), view.slice(0, 600));
        assert.strictEqual(call(ctx, 'isGyosuanBriefStale')(mod.gyosuan), true);
        ctx.briefReply = () => reply('@@필수@@\n- 고친 교수안의 필수 하나\n- 고친 교수안의 필수 둘\n@@권장@@\n- 고친 교수안의 권장');
        assert.strictEqual(await ctx.generateGyosuanBrief('m1', 'basic'), true, ctx.alerts.join('\n'));
        assert.ok(ctx.asked.at(-1).message.includes('지금 간이 교수안(직접 고친 내용 포함)은 새 간이 교수안으로 바뀝니다.'), ctx.asked.at(-1).message);
        assert.ok(mod.gyosuan.briefMd.includes('- 고친 교수안의 필수 하나') && call(ctx, 'isGyosuanBriefStale')(mod.gyosuan) === false);
        assert.ok(!ctx.elements['gyosuan-view'].innerHTML.includes('gyosuan-brief-stale'), '다시 만든 뒤에는 알리지 않는다');
    });

    /* ======================= 6. 비용 미리 보기 ======================= */
    await run('비용: 교수안 하나는 교수안 호출 12번에 간이 교수안 1번을 더 세고(기다리는 시간도 1), 간이 교수안만 만들면 1번', async () => {
        const { ctx } = makeContext();
        const split = work => plain(call(ctx, 'estimateCallSplit')(work));
        assert.deepStrictEqual(split({ gyosuan: 1 }), { body: 13, bodyWait: 7, short: 0, images: 0 });
        assert.deepStrictEqual(split({ gyosuan: 2 }), { body: 26, bodyWait: 14, short: 0, images: 0 }, '갈래마다 하나');
        assert.deepStrictEqual(split({ brief: 1 }), { body: 1, bodyWait: 1, short: 0, images: 0 });
        assert.strictEqual(call(ctx, 'estimateCalls')(call(ctx, 'lessonWork')({ gyosuan: 1, ncs: false }, 'section', 0)), 13);
        assert.strictEqual(plain(call(ctx, 'ESTIMATE_RULES')).gyosuanBriefCalls, 1);
    });

    /* ======================= 7. 교수안 화면 ======================= */
    await run('화면: 간이 교수안이 없으면 만들기 단추, 있으면 보기 전환·원문 수정·MD 받기. 보기는 편성안 보기와 함께 켜지지 않고, 원문 칸은 그 칸의 글로 채운다', async () => {
        const { ctx, mod } = makeContext();
        await ctx.generateGyosuan('m1');
        const toolbar = () => call(ctx, 'gyosuanToolbarHtml')(mod, 'basic');
        const brief = mod.gyosuan.briefMd;
        mod.gyosuan = { ...mod.gyosuan, briefMd: undefined };
        assert.ok(toolbar().includes(`<button onclick="generateGyosuanBrief('m1', 'basic')" class="gyosuan-tool"><i class="ph-bold ph-sparkle"></i> 간이 교수안 만들기</button>`));
        assert.ok(!toolbar().includes('toggleGyosuanBriefView') && !toolbar().includes("'briefMd'"));
        mod.gyosuan = { ...mod.gyosuan, briefMd: brief };
        const shown = toolbar();
        assert.ok(shown.includes('toggleGyosuanBriefView()') && shown.includes('</i> 간이 교수안 보기</button>') && shown.includes("toggleGyosuanEdit('briefMd')") && shown.includes('</i> 간이 교수안 수정</button>'), shown);
        assert.ok(shown.includes(`downloadGyosuanMd('m1', 'briefMd', 'basic')`) && shown.includes('</i> 간이 교수안 MD</button>') && !shown.includes('간이 교수안 만들기'));
        ctx.elements['gyosuan-view'] = { innerHTML: '', querySelectorAll: () => [] };
        ctx.toggleGyosuanBriefView();
        assert.ok(ctx.elements['gyosuan-view'].innerHTML.includes(`<div class="gyosuan-deck-view gyosuan-brief-view"><md>${brief}</md></div>`), '간이 교수안을 그린다');
        assert.ok(ctx.elements['gyosuan-view'].innerHTML.includes('</i> 교수안 보기</button>'));
        ctx.toggleGyosuanDeckView();
        assert.ok(!ctx.elements['gyosuan-view'].innerHTML.includes('gyosuan-brief-view') && ctx.elements['gyosuan-view'].innerHTML.includes('gyosuan-deck-view'), '편성안 보기를 켜면 간이 교수안 보기는 꺼진다');
        const raw = { value: '' };
        ctx.elements['gyosuan-raw'] = raw;
        ctx.toggleGyosuanEdit('briefMd');
        assert.ok(ctx.elements['gyosuan-view'].innerHTML.includes('id="gyosuan-raw"') && raw.value === brief, '원문 칸');
        raw.value = `${brief}- 강사가 더한 줄\n`;
        await ctx.saveGyosuanRaw();
        assert.ok(mod.gyosuan.briefMd.endsWith('- 강사가 더한 줄\n') && mod.gyosuan.docMd.includes('## 진행'), '고친 간이 교수안만 바꾼다');
        ctx.toggleGyosuanEdit('briefMd');
        assert.ok(ctx.elements['gyosuan-view'].innerHTML.includes('gyosuan-brief-view'), "'보기'로 닫으면 간이 교수안이 보인다");
        const downloads = [];
        ctx.downloadMd = (md, name) => downloads.push([md, name]);
        ctx.downloadGyosuanMd('m1', 'briefMd', 'adv'); // 심화학습 교수안이 없으면 받지 않는다
        mod.gyosuanAdv = { docMd: 'd', briefMd: '# 심화 간이' };
        ctx.downloadGyosuanMd('m1', 'briefMd', 'adv');
        ctx.downloadGyosuanMd('m1', 'briefMd', 'basic');
        assert.deepStrictEqual(downloads.map(([, name]) => name.replace(/^.*_(?=[^_]+$)/, '')), ['심화간이교수안', '간이교수안']);
    });

    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
