// 교수안·슬라이드 편성안 생성과 컨벤션 검수 테스트 (실행: node tests/gyosuan.test.js)
// AI 응답만 스텁으로 두고 실제 parser.js, gyosuan.js, lesson-lint.js를 실행한다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { loadLessonTracks } = require('./lesson-tracks');
const root = path.join(__dirname, '..', 'js') + path.sep;

// data.js 전체를 읽어 실제 stripInstructorCallouts를 가져온다
const dataCtx = { window: {}, console: { warn() {} }, localStorage: { getItem: () => null } };
vm.createContext(dataCtx);
vm.runInContext(fs.readFileSync(root + 'data.js', 'utf8'), dataCtx);
const stripCallouts = dataCtx.window.stripInstructorCallouts;

function makeContext(aiStub) {
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, URL, encodeURIComponent,
        LESSON_TABS: ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment'].map(id => ({ id })),
        TEXT_MODEL: 'claude-opus-5-5',
        CONTEXT_CORE: { personas: { instructor: '당신은 게임 기획 전문 강사입니다.' } },
        INSTRUCTOR_TONE_PRESETS: [{ id: 'formal', label: '합쇼체' }],
        instructorTone: 'formal',
        getReferenceContext: () => '\n\n[참고 자료 — 테스트]',
        globalState: { subjects: [{ id: 's1', title: '게임 기획 입문' }], courseTitle: '과정' },
        currentSubjectId: 's1', currentEditingModuleId: 'm1',
        document: { addEventListener() {}, getElementById: () => null, createElement: () => ({}) },
        saveState: async () => { ctx.saved = (ctx.saved || 0) + 1; },
        renderEditor: () => { ctx.rendered = (ctx.rendered || 0) + 1; },
        // 브라우저 기본 확인 창을 쓰면 실패한다. 앱의 확인 창은 바로 승인한다
        confirm: () => { throw new Error('브라우저 기본 확인 창을 쓰면 안 된다'); },
        confirmAsync: async () => true,
        alerts: []
    };
    ctx.window = ctx;
    ctx.showAlert = m => ctx.alerts.push(m);
    ctx.showToast = () => {};
    ctx.callGemini = aiStub;
    vm.createContext(ctx);
    loadLessonTracks(ctx); // 갈래(기본학습·심화학습) 정의
    vm.runInContext(fs.readFileSync(root + 'kbuilder/parser.js', 'utf8'), ctx);
    ctx.stripInstructorCallouts = stripCallouts;
    ['gyosuan.js', 'filename-convention.js', 'lesson-lint.js', 'course-ncs.js', 'course-design.js', 'course-sessions.js', 'course-meta.js', 'gyosuan-deck-tidy.js'].forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), ctx));
    return ctx;
}

const META = `부제: 재미를 설계하는 첫걸음
대상: 완전 초보(직업훈련 수강생)
선행: 없음
결과물: 게임 기획 메모
교보제: 교재 슬라이드
[학습목표]
- MDA 프레임워크를 설명할 수 있다.
- 간단한 재미 요소를 기획할 수 있다.
[개요]
이 차시는 재미의 구조를 다룬다.

학생은 직접 기획 메모를 쓴다.
[수업흐름]
단계 | 시간 | 핵심
|---|---|---|
도입 | 15분 | 재미란 무엇인가
전개 | 1시간 30분 | MDA
정리 | 15분 | 핵심 정리
[준비물]
- 빔프로젝터
[산출물]
- 기획 메모
[평가]
- MDA를 설명했는가
[유의사항]
- 용어 암기를 강요하지 않는다.`;

const SECTION = `@@GYOSUAN@@
**강사 활동**: 게임 화면을 띄운다.
**설명 내용**:
- MDA는 세 층이다.
**멘트 예시**: "재밌는 게임, 왜 재밌을까요?"
**학생 활동**: 좋아하는 게임을 떠올린다.
@@SLIDES@@
### 슬라이드 - 재미의 구조
- 슬라이드 문구:
  - 메카닉 → 다이내믹 → 미학
- 이미지/시각: 3층 구조 도식
- 핵심 메시지: 재미는 설계된다.

### 슬라이드 3 - 예시
- 대응 교수안: 전개 99
- 슬라이드 문구:
  - 슈퍼마리오의 점프
- 이미지/시각: 점프 장면
- 핵심 메시지: 규칙이 감정을 만든다.`;

const OPEN_CLOSE = `@@INTRO@@
제목: 재미란 무엇일까(질문)
**강사 활동**: 질문으로 연다.
**설명 내용**: 재미의 정의를 묻는다.
**멘트 예시**: "오늘 재미를 해부합니다."
**학생 활동**: 답을 말한다.
@@CLOSE@@
제목: 재미 설계 정리
**강사 활동**: 핵심을 묶는다.
**설명 내용**: MDA를 복습한다.
**멘트 예시**: "오늘의 한 줄을 적어 봅시다."
**학생 활동**: 한 줄을 쓴다.`;

function reply(text) { return { candidates: [{ content: { parts: [{ text: 'think', thought: true }, { text }] } }] }; }
function responder(failOn) {
    const prompts = [];
    const fn = async (model, payload) => {
        const p = payload.contents.at(-1).parts[0].text;
        prompts.push(p);
        const system = payload.systemInstruction.parts[0].text;
        assert.ok(system.includes('게임 기획 전문 강사') && system.includes('[참고 자료 — 테스트]') && system.includes('합쇼체'));
        assert.strictEqual(payload.contents.at(-1).role, 'user');
        if (p.includes('@@GYOSUAN@@')) {
            assert.strictEqual(payload.contents.length, 3, '전개 생성은 few-shot 예시 턴을 함께 보낸다');
            assert.strictEqual(payload.contents[1].role, 'model');
        }
        if (failOn && failOn(p)) throw new Error('API 실패');
        if (p.includes('@@INTRO@@')) return reply(OPEN_CLOSE);
        if (p.includes('@@GYOSUAN@@')) return reply(SECTION);
        return reply(META);
    };
    fn.prompts = prompts;
    return fn;
}

const lesson = n => ({
    id: 'm1', title: '재미의 구조', hours: 3, description: '재미를 분석한다',
    tabContents: {
        basicLearn: '# 📝 재미의 구조\n\n## 학습 목표\n\n- 교안머리말표식 MDA를 설명할 수 있습니다.\n\n## 개요\n\n- 재미의 구조를 다룹니다. 타임테이블이 들어갑니다. 충분히 긴 문장입니다.\n\n' + Array.from({ length: n }, (_, i) => `## ${i + 1}. 섹션 ${i + 1} (⏱ 30분)\n\n<div class="instructor-callout">⏰ 강사 전용 비밀</div>\n\n본문 내용이 충분히 길게 들어갑니다. 재미의 구조를 설명합니다. ![그림](local:img1)\n\n\`\`\`mermaid\ngraph TD\n\`\`\`\n`).join('\n'),
        basicPrac: '## ✅ 학습 후 체크리스트\n\n- 체크리스트 항목입니다. 전개가 아니므로 제외되어야 하는 충분히 긴 문장입니다.\n\n## 실습 과제\n\n직접 기획 메모를 작성합니다. 충분히 긴 실습 설명 문장입니다.\n\n## 🎓 교강사 가이드 (강사 전용)\n\n이 섹션은 제외되어야 하는 긴 안내 문장입니다. 제외 확인용.',
        advLearn: null, advPrac: null, assessment: '## 평가\n\n평가 문항은 제외되어야 합니다. 충분히 긴 문장입니다.'
    }
});

async function run(name, fn) {
    await fn();
    console.log('PASS', name);
}

(async () => {
    await run('정상 생성: 문서 구조', async () => {
        const ai = responder();
        const ctx = makeContext(ai);
        const mod = lesson(3);
        ctx.getEditingModule = () => mod;
        assert.strictEqual(await ctx.generateGyosuan('m1'), true);
        assert.strictEqual(ai.prompts.length, 1 + 4 + 1, '머리말 + 섹션 4(학습3·실습1) + 도입정리');
        const doc = ctx.KBuilder.parseDoc(mod.gyosuan.docMd);
        const headings = doc.blocks.filter(b => b.type === 'heading').map(b => b.text);
        for (const h of ['학습 목표', '목차', '개요', '수업 흐름 한눈에 보기', '준비물·교보제', '진행', '학생 산출물·제출', '평가·체크포인트', '강사 유의사항']) {
            assert.ok(headings.includes(h), '누락: ' + h);
        }
        assert.ok(headings.includes('도입 - 재미란 무엇일까(질문)'));
        const tocList = doc.blocks.find((b, i) => b.type === 'list' && doc.blocks[i - 1].text === '목차');
        assert.ok(tocList.items.every(it => /^<a href="#[^"]+"[^>]*>[^<]+<\/a>$/.test(it.text)), tocList.items.map(i => i.text).join(' / '));
        assert.ok(tocList.items.some(it => it.text.includes('>도입 - 재미란 무엇일까(질문)<')));
        assert.ok(headings.includes('전개 1 - 섹션 1'));
        assert.ok(headings.includes('전개 4 - 활동: 실습 과제'), headings.join(' | '));
        assert.ok(headings.includes('정리 - 재미 설계 정리'));
        assert.strictEqual(doc.meta['소요'], '3시수(약 180분)');
        assert.strictEqual(doc.meta['교과목'], '게임 기획 입문');
        const labels = doc.blocks.filter(b => b.type === 'labelpara').map(b => b.label);
        assert.ok(labels.includes('강사 활동') && labels.includes('설명 내용') && labels.includes('학생 활동'));
        assert.ok(doc.blocks.some(b => b.type === 'callout' && /멘트/.test(b.label)));
        const tables = doc.blocks.filter(b => b.type === 'table');
        assert.strictEqual(tables.length, 3);
        assert.deepStrictEqual(Array.from(tables[2].headers), ['교시', '시간', '진행 단계'], '60분이 넘으면 교시 구성표를 넣는다(1시간 칸은 교시)');
        assert.deepStrictEqual(Array.from(tables[1].headers), ['단계', '시간', '핵심']);
        assert.strictEqual(tables[1].rows.length, 3, '구분선 행은 제외');
        assert.ok(tables[0].rows.some(r => r[0] === '대상'));
        assert.strictEqual(ctx.saved, 1);
        assert.strictEqual(ctx.rendered, 1);
    });

    await run('끝난 뒤 화면: 만드는 동안 다른 교과의 같은 번호 차시를 열었으면 그 화면을 다시 그리지 않는다(같은 객체일 때만 그린다)', async () => {
        const ctx = makeContext(responder());
        const mod = lesson(1);
        const other = { ...lesson(1), title: '다른 교과의 같은 번호 차시' };
        let open = mod;
        ctx.getEditingModule = () => open;
        ctx.saveState = async () => { ctx.saved = (ctx.saved || 0) + 1; open = other; }; // 저장하는 사이 다른 교과를 연다
        assert.strictEqual(await ctx.generateGyosuan('m1'), true);
        assert.ok(mod.gyosuan?.docMd, '시작한 차시에 넣는다');
        assert.strictEqual(other.gyosuan, undefined);
        assert.strictEqual(ctx.rendered, undefined, '다른 교과의 차시 화면은 그대로 둔다');
    });

    await run('원고 정리: 강사 전용·이미지·코드·평가·교강사 가이드 제외', async () => {
        const ai = responder();
        const ctx = makeContext(ai);
        const mod = lesson(1);
        ctx.getEditingModule = () => mod;
        await ctx.generateGyosuan('m1');
        const all = ai.prompts.join('\n');
        for (const banned of ['전개가 아니므로', '강사 전용 비밀', 'local:img1', 'graph TD', '평가 문항은', '제외 확인용']) {
            assert.ok(!all.includes(banned), '원고에 남음: ' + banned);
        }
        assert.ok(all.includes('**수행 내용(활동 단계)**'), '실습 섹션은 수행 내용 요청');
        const sections = ai.prompts.filter(p => p.includes('@@GYOSUAN@@'));
        assert.ok(!sections[0].includes('수행 내용'), '학습 섹션은 수행 내용 미요청');
    });

    await run('슬라이드 편성안: 파서 호환', async () => {
        const ctx = makeContext(responder());
        const mod = lesson(2);
        ctx.getEditingModule = () => mod;
        await ctx.generateGyosuan('m1');
        const deck = ctx.KBuilder.parseDeck(mod.gyosuan.deckMd);
        assert.strictEqual(deck.slides.length, 2 + 3 * 2 + 1, '표지·목차 + 섹션당 2장 + 마무리');
        deck.slides.forEach((s, i) => assert.strictEqual(s.num, String(i + 1)));
        assert.strictEqual(deck.slides[0].kind, 'cover');
        assert.strictEqual(deck.slides[1].kind, 'toc');
        assert.strictEqual(deck.slides.at(-1).kind, 'closing');
        assert.strictEqual(deck.slides[2].title, '재미의 구조');
        assert.strictEqual(deck.slides[2].maps, '전개 1');
        assert.strictEqual(deck.slides[3].title, '예시', '모델이 붙인 번호는 제거');
        assert.strictEqual(deck.slides[3].maps, '전개 1', '모델이 쓴 대응 교수안 대신 실제 전개 번호');
        assert.ok(deck.slides[2].lines.length > 0 && deck.slides[2].key);
        assert.ok(deck.slides.every(s => !s.visual), '그림을 붙이지 않은 이미지/시각 줄은 빈 그림 칸이 되므로 뺀다(gyosuan-deck-tidy.js)');
    });

    await run('Teacher 교안: 머리말은 전개에서 빼고 시간은 프롬프트로 전달', async () => {
        const ai = responder();
        const ctx = makeContext(ai);
        const mod = lesson(2);
        ctx.getEditingModule = () => mod;
        await ctx.generateGyosuan('m1');
        const sections = ai.prompts.filter(p => p.includes('@@GYOSUAN@@'));
        assert.strictEqual(sections.length, 3, '학습 2 + 실습 1 (학습 목표·개요 제외)');
        assert.ok(sections[0].includes('[섹션 제목] 섹션 1 (30분 수업)'), sections[0].slice(-200));
        const meta = ai.prompts[0];
        assert.ok(meta.includes('교안머리말표식'), '머리말은 교수안 머리말 근거로 전달');
        assert.ok(meta.includes('전개 1: 섹션 1 (30분)'));
        assert.ok(meta.includes('전개 3: 활동: 실습 과제'));
        assert.ok(!mod.gyosuan.docMd.includes('### 전개 1 - 학습 목표'));
    });

    await run('탭 맨 위의 # 제목과 첫머리: 전개로 만들지 않고 머리말 근거의 끝에 둔다. 제목이 하나뿐인 탭은 예전처럼 전개로 쓴다', async () => {
        const ai = responder();
        const ctx = makeContext(ai);
        const opening = '- 첫머리표식 이 차시에서 심화 시스템 아키텍처를 분석하고 설계하는 목표를 미리 봅니다.\n- 배경: 게임 시스템이 커지면 층 사이의 관계를 설계해야 합니다.';
        const advLearn = `# 📝 MDA 프레임워크 기반의 게임 시스템 아키텍처 심화\n\n${opening}\n\n## 학습 목표\n\n- 머리말표식 시스템 층을 분석할 수 있습니다.\n\n## 1. 시스템 층 분석 (⏱ 60분)\n\n본문 내용이 충분히 길게 들어갑니다. 시스템 층을 하나씩 분석합니다.\n`;
        const advPrac = '# 📝 동적 시스템 시뮬레이션 및 밸런스 튜닝\n\n- 실습첫머리표식 실습의 배경을 소개하는 충분히 긴 문장입니다.\n\n## 실습 1. 밸런스 표 만들기\n\n직접 밸런스 표를 만들고 값을 바꿔 결과를 비교합니다. 충분히 긴 실습 설명입니다.\n';
        const titles = list => JSON.parse(JSON.stringify(list.map(s => s.title))); // vm 안의 배열을 바깥 배열로 견준다
        const split = lessonMod => vm.runInContext('splitLessonSections', ctx)(vm.runInContext('collectLessonSource', ctx)(lessonMod, 'adv'));
        const mod = { id: 'm1', title: '심화', tabContents: { basicLearn: null, basicPrac: null, advLearn, advPrac, assessment: null } };
        const { intro, sections } = split(mod);
        assert.deepStrictEqual(titles(sections), ['시스템 층 분석', '실습 1. 밸런스 표 만들기'], '# 제목은 전개가 아니다');
        assert.ok(intro.indexOf('머리말표식') >= 0 && intro.indexOf('첫머리표식') > intro.indexOf('머리말표식') && intro.includes('실습첫머리표식'), '첫머리는 학습 목표 뒤 머리말 근거로');
        const single = { ...mod, tabContents: { ...mod.tabContents, advLearn: null, advPrac: '# 실습 과제\n\n직접 기획 메모를 작성합니다. 충분히 긴 실습 설명 문장이 들어갑니다.' } };
        assert.deepStrictEqual(titles(split(single).sections), ['실습 과제'], '제목이 하나뿐인 탭은 그 제목을 전개로 쓴다');
        const legacy = { id: 'm1', title: '옛 차시', content: '# 1. 개요\n게임 기획은 재미를 설계하는 일이라는 개요 문장이 충분히 깁니다.\n\n# 2. 핵심 내용\n\n## 재미의 본질\n재미는 플레이어가 겪는 도전과 보상의 순환이라는 설명이 충분히 길게 들어갑니다.' };
        const old = vm.runInContext('splitLessonSections', ctx)(vm.runInContext('collectLessonSource', ctx)(legacy, 'basic'));
        assert.ok(old.intro.startsWith('개요\n게임 기획은'), '맨 위 # 개요는 예전처럼 머리말');
        assert.deepStrictEqual(titles(old.sections), ['재미의 본질']);
    });

    await run('컨벤션 검수', async () => {
        const ctx = makeContext(responder());
        const issues = md => vm.runInContext('lintLessonMarkdown', ctx)(md).map(i => i.msg);
        assert.deepStrictEqual(Array.from(issues('## 학습 목표\n\n- 조건을 지켜 기획서를 작성할 수 있습니다.\n\n## 본문\n\n기획서는 규칙을 정의합니다.\n')), []);
        const bad = issues('## 학습 목표\n\n- 게임 기획을 이해한다.\n- 재미 요소를 이해할 수 있습니다.\n\n## 본문\n\n여러분은 앞에서 배운 내용을 매우 쉽게 쓸 수 있습니다.\n');
        assert.ok(bad.includes('학습 목표는 "~할 수 있습니다"로 끝냅니다.'));
        assert.ok(bad.includes('학습 목표는 관찰 가능한 행동으로 씁니다.'));
        ['학습자를 호칭하지 않습니다.', '다른 차시를 지칭하지 않습니다.', '정도는 수치로 씁니다.', '학습자에게 당연하지 않은 표현입니다.'].forEach(m => assert.ok(bad.includes(m), m));
        assert.deepStrictEqual(Array.from(issues('```js\n// 여러분 매우\n```\n`앞에서`\n<!-- [IMG: "매우"] -->\n')), [], '코드·주석은 검사하지 않음');
    });

    await run('컨벤션 검수: 학습 목표·체크리스트 구조', async () => {
        const ctx = makeContext(responder());
        const issues = md => vm.runInContext('lintLessonMarkdown', ctx)(md).map(i => i.msg);
        const goal = '주어진 양식으로 게임 기획서를 작성할 수 있습니다.';
        const passed = `## 학습 목표\n\n- ${goal}\n\n## 본문\n\n기획서는 규칙을 정의합니다.\n\n## ✅ 학습 후 체크리스트\n\n- 기획서 항목을 설명합니다. (다시 보기: 본문)\n`;
        assert.deepStrictEqual(Array.from(issues(passed)), []);
        const many = `## 학습 목표\n\n${Array(4).fill(`- ${goal}`).join('\n')}\n`;
        assert.ok(issues(many).includes('학습 목표는 3개 이하로 씁니다.'));
        assert.ok(issues('## 학습 목표\n\n- 기획서를 쓸 수 있습니다.\n').includes('학습 목표에 수행 조건과 제약을 담습니다.'));
        assert.deepStrictEqual(Array.from(issues(`## 학습 목표\n\n- ${goal}\n  - 세부 조건입니다\n\n## ✅ 학습 후 체크리스트\n\n- 항목 (다시 보기: 본문)\n`)), [], '세부 불릿은 세지 않는다');
        const mismatch = issues(`## 학습 목표\n\n- ${goal}\n\n## ✅ 학습 후 체크리스트\n\n- 하나 (다시 보기: 본문)\n- 둘\n`);
        assert.ok(mismatch.includes('체크리스트는 학습 목표와 같은 수로 씁니다.'));
        assert.ok(mismatch.includes('체크리스트에 다시 볼 섹션을 적습니다.'));
        assert.ok(issues('기획서는 규칙을 정의한다.\n').includes('경어체(~합니다)로 종결합니다.'));
    });

    await run('컨벤션 검수: 문항', async () => {
        const ctx = makeContext(responder());
        const issues = md => vm.runInContext('lintLessonMarkdown', ctx)(md).map(i => i.msg);
        const question = (title, label, answer, choices = '① 가\n② 나\n③ 다\n④ 라\n⑤ 마') => `### 문제 1. ${title}\n${label}\n\n${choices}\n\n✅ **정답:** ${answer}\n`;
        assert.deepStrictEqual(Array.from(issues(question('제목', '학습 목표 1 · 밴드 L1', '②'))), []);
        assert.deepStrictEqual(Array.from(issues(question('제목 (복수정답)', '학습 목표 2 · 밴드 L2', '①, ②'))), []);
        assert.ok(issues(question('제목', '', '②')).includes('문제마다 학습 목표와 밴드를 표기합니다.'));
        assert.ok(issues(question('제목', '학습 목표 1 · 밴드 L1', '')).includes('정답을 표기합니다.'));
        assert.ok(issues(question('제목', '학습 목표 1 · 밴드 L1', '①, ②')).includes('단일 선택 문제에 정답이 여러 개입니다.'));
        assert.ok(issues(question('제목 (복수정답)', '학습 목표 1 · 밴드 L1', '①')).includes('복수 정답 문제에 정답이 하나입니다.'));
        assert.ok(issues(question('제목 (복수정답)', '학습 목표 1 · 밴드 L1', '①, ②, ③, ④, ⑤')).includes('모든 보기가 정답입니다.'));
        assert.ok(issues(question('제목', '학습 목표 1 · 밴드 L1', '⑥')).includes('정답 번호가 보기에 없습니다.'));
        assert.ok(issues(question('제목', '학습 목표 1 · 밴드 L1', '①', '① 가\n② 가\n③ 다\n④ 라')).includes('같은 보기를 두지 않습니다.'));
        assert.ok(issues(question('제목', '학습 목표 1 · 밴드 L1', '①', '① 가\n② 나')).includes('보기는 4개 이상 둡니다.'));
        assert.deepStrictEqual(Array.from(issues(question('제목', '학습 목표 1 · 밴드 L1', '②', '① 가 ② 나 ③ 다 ④ 라'))), [], '보기를 한 줄에 써도 센다');
        assert.deepStrictEqual(Array.from(issues(question('제목', '학습 목표 1 · 밴드 L1', '②').replace('**정답:**', '**정답**:'))), [], '콜론이 볼드 밖이어도 정답으로 읽는다');
        assert.deepStrictEqual(Array.from(issues(question('제목', '학습 목표 1 · 밴드 L1', '②').replace(/\n/g, '\r\n'))), [], 'CRLF 입력');
        assert.ok(!issues(`${question('제목', '학습 목표 1 · 밴드 L1', '②')}\n## 다음 섹션\n\n① 정리 항목입니다.\n`).includes('같은 보기를 두지 않습니다.'));
        assert.deepStrictEqual(Array.from(issues('### 학습 목표 확인 질문\n\n- 무엇을 배웠습니까\n')), [], 'H3 제목은 학습 목표 섹션이 아니다');
    });

    await run('과정 설계·NCS가 교수안에 반영', async () => {
        const ai = responder();
        const ctx = makeContext(ai);
        const subject = ctx.globalState.subjects[0];
        subject.ncs = { units: [{ code: '2001020101_23v1', name: '게임 기획', level: 5 }], confirmed: true };
        const base = lesson();
        const longIntro = `## 개요\n\n${'긴 개요 문장입니다. '.repeat(400)}\n\n`;
        const mod = {
            ...base, hours: 1.5, minutes: 90, objectives: ['설계한 목표를 설명할 수 있다.'], flow: [{ phase: '도입', title: '설계한 도입', minutes: 10 }],
            tabContents: { ...base.tabContents, basicLearn: longIntro + base.tabContents.basicLearn }
        };
        ctx.getEditingModule = () => mod;
        assert.strictEqual(await ctx.generateGyosuan('m1'), true);
        assert.ok(mod.gyosuan.docMd.includes('| NCS | 2001020101_23v1 게임 기획 (5수준) |'));
        assert.ok(mod.gyosuan.docMd.includes('1.5시수(약 90분)'));
        assert.ok(!mod.gyosuan.docMd.includes('<br>'), '교수안 뷰어가 글자로 보여 주는 HTML을 쓰지 않는다');
        subject.ncs = { ...subject.ncs, confirmed: false };
        assert.strictEqual(await ctx.generateGyosuan('m1'), true);
        assert.ok(mod.gyosuan.docMd.includes('게임 기획 (5수준) (미확정) |'), '확정 전 배정은 미확정으로 표기');
        assert.ok(ai.prompts.some(text => text.includes('설계한 목표를 설명할 수 있다.') && text.includes('도입: 설계한 도입 (10분)')));
    });

    await run('이전 강사 콜아웃 제거', async () => {
        const open = '<div class="instructor-callout">';
        assert.strictEqual(stripCallouts(`앞\n${open}\n메모\n</div>\n뒤`), '앞\n뒤');
        assert.strictEqual(stripCallouts(`${open}\n<div>중첩</div>\n- 강조\n</div>\n본문`), '본문', '중첩 div');
        assert.strictEqual(stripCallouts(`${open}\n잘린 메모\n\n## 다음\n\n본문`), '## 다음\n\n본문', '닫히지 않으면 다음 헤딩까지만');
        assert.strictEqual(stripCallouts(`${open}\n잘린 메모\n\n## 다음\n\n<div>보존</div>`), '## 다음\n\n<div>보존</div>', '뒤쪽 div의 닫는 태그와 짝짓지 않음');
        assert.strictEqual(stripCallouts(`<div class="x instructor-callout y">메모</div>본문`), '본문');
        assert.strictEqual(stripCallouts('콜아웃 없는 문서'), '콜아웃 없는 문서');
    });

    await run('제목의 숫자는 번호일 때만 제거', async () => {
        const ai = responder();
        const ctx = makeContext(ai);
        const mod = { id: 'm1', title: 't', tabContents: { basicLearn: '## 3D 렌더링의 기초\n\n충분히 긴 본문 문장이 여기에 들어갑니다. 내용을 차근차근 풀어서 다룹니다. 렌더링을 설명합니다.\n\n## 5가지 원칙\n\n충분히 긴 본문 문장이 여기에 들어갑니다. 내용을 차근차근 풀어서 다룹니다. 원칙을 설명합니다.\n\n## 2. 번호 제목\n\n충분히 긴 본문 문장이 여기에 들어갑니다. 내용을 차근차근 풀어서 다룹니다. 번호를 설명합니다.\n\n## 1.2 소번호\n\n충분히 긴 본문 문장이 여기에 들어갑니다. 내용을 차근차근 풀어서 다룹니다. 소번호를 설명합니다.\n' } };
        ctx.getEditingModule = () => mod;
        await ctx.generateGyosuan('m1');
        ['### 전개 1 - 3D 렌더링의 기초', '### 전개 2 - 5가지 원칙', '### 전개 3 - 번호 제목'].forEach(h => assert.ok(mod.gyosuan.docMd.includes(h), h));
    });

    await run('빈 AI 응답은 성공으로 치지 않음', async () => {
        const emptySection = async (m, p) => {
            const t = p.contents.at(-1).parts[0].text;
            if (t.includes('@@GYOSUAN@@')) return reply('');
            return reply(t.includes('@@INTRO@@') ? OPEN_CLOSE : META);
        };
        const ctx = makeContext(emptySection);
        const mod = { ...lesson(1), gyosuan: { docMd: '기존', deckMd: '덱' } };
        ctx.getEditingModule = () => mod;
        assert.strictEqual(await ctx.generateGyosuan('m1'), false);
        assert.strictEqual(mod.gyosuan.docMd, '기존');
        const emptyMeta = makeContext(async () => reply(''));
        emptyMeta.getEditingModule = () => mod;
        assert.strictEqual(await emptyMeta.generateGyosuan('m1'), false);
        assert.ok(emptyMeta.alerts[0].includes('비어 있습니다'));
    });

    await run('섹션이 많으면 호출 수 제한', async () => {
        const ai = responder();
        const ctx = makeContext(ai);
        const mod = lesson(40);
        ctx.getEditingModule = () => mod;
        await ctx.generateGyosuan('m1');
        assert.ok(ai.prompts.filter(p => p.includes('@@GYOSUAN@@')).length <= 14);
    });

    await run('일부 실패: 나머지는 살리고 안내', async () => {
        const ctx = makeContext(responder(p => p.includes('@@GYOSUAN@@') && p.includes('섹션 2')));
        const mod = lesson(3);
        ctx.getEditingModule = () => mod;
        assert.strictEqual(await ctx.generateGyosuan('m1'), true);
        assert.ok(mod.gyosuan.docMd.includes('생성 실패'));
        assert.ok(ctx.alerts.some(a => a.includes('1개')), ctx.alerts.join());
    });

    await run('전부 실패: 기존 교수안 보존, 오류 안내', async () => {
        const ctx = makeContext(responder(p => p.includes('@@GYOSUAN@@')));
        const mod = { ...lesson(2), gyosuan: { docMd: '기존', deckMd: '기존덱' } };
        ctx.getEditingModule = () => mod;
        assert.strictEqual(await ctx.generateGyosuan('m1'), false);
        assert.strictEqual(mod.gyosuan.docMd, '기존');
        assert.ok(ctx.alerts[0].includes('교수안 생성 실패'));
    });

    await run('슬라이드만 재생성: 수정한 교수안 유지', async () => {
        const ctx = makeContext(responder());
        const mod = { ...lesson(2), gyosuan: { docMd: '강사가 고친 교수안', deckMd: '옛덱', deckHtml: '<x>', sourceKey: 'k' } };
        ctx.getEditingModule = () => mod;
        await ctx.generateGyosuan('m1', { keepDoc: true });
        assert.strictEqual(mod.gyosuan.docMd, '강사가 고친 교수안');
        assert.notStrictEqual(mod.gyosuan.deckMd, '옛덱');
        assert.strictEqual(mod.gyosuan.deckHtml, null);
        assert.strictEqual(mod.gyosuan.sourceKey, 'k');
    });

    await run('진행 막대의 작업(분량 채우기 등)이 도는 동안 교수안 생성 버튼은 시작하지 않는다(같은 중지 표시를 써서 서로의 중지를 풀거나 멈추지 않게). 전체 생성의 교수안 단계(background)는 그대로 돈다', async () => {
        const ai = responder();
        const ctx = makeContext(ai);
        const mod = lesson(3);
        ctx.getEditingModule = () => mod;
        let stops = 0;
        ctx.beginGenerationStop = () => { stops += 1; };
        ctx.isLessonPipelineRunning = () => true;
        assert.strictEqual(await ctx.generateGyosuan('m1'), false);
        assert.deepStrictEqual([ai.prompts.length, stops], [0, 0], '부르지도 중지 표시를 풀지도 않는다');
        assert.ok(ctx.alerts.at(-1).includes('진행 중인 생성이 끝난 뒤'), ctx.alerts.at(-1));
        ctx.refreshAfterGyosuan = () => {};
        const step = await vm.runInContext('runGyosuanGeneration', ctx)('m1', { background: true });
        assert.strictEqual(step.ok, true, `전체 생성의 교수안 단계: ${step.error || ''}`);
    });

    await run('교안 없음·메인 퀘스트(content만) 처리', async () => {
        const ctx = makeContext(responder());
        const empty = { id: 'm1', title: 'x', tabContents: {} };
        ctx.getEditingModule = () => empty;
        assert.strictEqual(await ctx.generateGyosuan('m1'), false);
        assert.ok(ctx.alerts[0].includes('교안 내용이 없습니다'));
        const quest = { id: 'mainQuest', title: '메인 퀘스트', content: '## 최종 과제\n\n최종 과제 내용이 충분히 길게 들어갑니다. 게임을 기획합니다.' };
        ctx.getEditingModule = () => quest;
        assert.strictEqual(await ctx.generateGyosuan('mainQuest'), true);
        assert.ok(!/^소요:/m.test(quest.gyosuan.docMd), '시수가 없으면 소요 생략');
    });

    await run('스튜디오 계약', async () => {
        const ctx = makeContext(responder());
        const mod = { ...lesson(1), gyosuan: { docMd: 'd', deckMd: 'deck', deckHtml: null } };
        ctx.getEditingModule = () => mod;
        ctx.courseData = [mod];
        const payload = ctx.getSlideStudioPayload('m1');
        assert.strictEqual(payload.deckMd, 'deck');
        assert.strictEqual(payload.title, '재미의 구조');
        assert.strictEqual(payload.subject, '게임 기획 입문');
        ctx.saveSlideStudioHtml('m1', '<div>편집</div>');
        assert.strictEqual(mod.gyosuan.deckHtml, '<div>편집</div>');
    });
    console.log('ALL PASSED');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
