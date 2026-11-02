// 차시 분할·메타데이터·문제은행·SVG 삽화·AI 수정 비교 테스트 (실행: node tests/lesson-tools.test.js)
// AI 응답만 스텁으로 두고 실제 파일을 실행한다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', 'js') + path.sep;
const FILES = ['kbuilder/ncs-catalog.js', 'lesson-lint.js', 'course-ncs.js', 'course-ncs-ref.js', 'course-design.js', 'course-sessions.js', 'course-meta.js', 'course-elements.js', 'course-list.js', 'course-art.js', 'course-illustrations.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'course-refs.js'];

function makeContext(callGemini, keys = { gemini: '' }) {
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, URL, Blob, Uint16Array,
        TEXT_MODEL: 'gemini-4-argon',
        IMAGE_MODEL: 'gemini-nano-banana-2.1',
        SVG_IMAGE_MODEL: 'svg-illustration',
        apiKey: keys.gemini,
        claudeApiKey: keys.claude || '',
        isClaudeModel: m => /^claude-/.test(m),
        CONTEXT_CORE: { personas: { orchestrator: '설계자' } },
        globalState: { courseTitle: '과정', subjects: [] },
        courseData: [],
        archived: [],
        archiveContent: async item => { ctx.archived.push(item.content); },
        saveState: async () => {},
        currentSubjectId: 's1',
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''),
        safeJSONParse: t => JSON.parse(t),
        extractText: d => d.candidates[0].content.parts[0].text,
        document: { getElementById: () => null, createElement: () => ({}), querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} } },
        callGemini
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    FILES.forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), ctx));
    return ctx;
}

const reply = obj => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] });
const plain = v => JSON.parse(JSON.stringify(v));
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);

async function run(name, fn) {
    await fn();
    console.log('PASS', name);
}

const DOC = `# 교수안 - 재미

## 수업 흐름 한눈에 보기

| 단계 | 시간 | 핵심 |
|---|---|---|
| 도입 | 10분 | 재미란 |
| 전개 1 | 70분 | 재미 분석 |
| 정리 | 10분 | 묶기 |

## 진행

### 도입 - 오늘의 주제 열기

**설명 내용**: 도입 설명

### 전개 1 - 재미 분석

**설명 내용**: 분석 설명

### 정리 - 오늘 배운 것 묶기

**설명 내용**: 정리 설명

## 학생 산출물·제출

- 메모
`;
const DECK = `### 슬라이드 1 - 표지\n- 대응 교수안: -\n\n### 슬라이드 2 - 재미 분석 슬라이드\n- 대응 교수안: 전개 1\n`;

(async () => {
    const ctx = makeContext(async () => { throw new Error('호출되면 안 됨'); });
    const call = name => vm.runInContext(name, ctx);

    await run('차시 분할: 60분 경계와 이어지는 단계', async () => {
        const modules = [{ title: '블록', minutes: 150, flow: [{ phase: '도입', title: '시작', minutes: 10 }, { phase: '전개', title: '본문', minutes: 130 }, { phase: '정리', title: '끝', minutes: 10 }] }];
        const sessions = plain(call('splitSessions')(modules));
        assert.deepStrictEqual(sessions.map(s => s.minutes), [60, 60, 30]);
        assert.strictEqual(sum(sessions, 'minutes'), 150);
        assert.strictEqual(sessions[1].items[0].cont, true);
        assert.strictEqual(sessions[0].items.at(-1).more, true);
        assert.strictEqual(call('sessionTitle')(modules, call('splitSessions')(modules)[1]), '블록 (2/3)');
    });

    await run('차시 분할: 도입·정리를 넣어도 차시 시간 유지', async () => {
        const modules = [{ title: '블록', minutes: 120, flow: [{ phase: '전개', title: '본문', minutes: 120 }] }];
        const sessions = call('splitSessions')(modules);
        const steps = plain(call('sessionSteps')(modules, sessions[1], 1, sessions.length));
        assert.deepStrictEqual(steps.map(step => step.kind), ['도입', '전개', '정리']);
        assert.strictEqual(sum(steps, 'minutes'), 60);
        assert.ok(steps[0].text.includes('이전 차시 연결'));
        assert.ok(steps[1].text.includes('(이어서)'));
    });

    await run('차시 구성표: 과정 설계서와 교수안', async () => {
        const table = call('subjectSessionLines')({ lessons: [{ title: '블록', hours: 2, flow: [{ phase: '전개', title: '본문', minutes: 120 }] }] }).join('\n');
        assert.ok(table.includes('### 차시 구성 (1차시 = 1시간)') && table.includes('2차시. 블록 (2/2)'));
        assert.deepStrictEqual(plain(call('gyosuanSessionTable')([['도입', '10분', '시작'], ['정리', '20분', '끝']], '짧은 수업')), [], '60분 이하는 표 없음');
        assert.ok(call('gyosuanSessionTable')([['전개', '1시간 30분', '본문']], '긴 수업').join('\n').includes('2차시.'));
    });

    await run('차시별 교수안: 교수안 본문과 슬라이드 재사용', async () => {
        const md = call('gyosuanSessionsMd')({ title: '재미', hours: 1.5, gyosuan: { docMd: DOC, deckMd: DECK } });
        ['# 차시별 교수안 - 재미', '# 1차시. 재미 (1/2)', '# 2차시. 재미 (2/2)', '**설명 내용**: 분석 설명', '앞 차시에서 시작한 활동을 이어서 진행한다.', '- 재미 분석 슬라이드'].forEach(text => assert.ok(md.includes(text), text));
        assert.strictEqual(call('gyosuanSessionsMd')({ title: '없음', hours: 1, gyosuan: { docMd: '' } }), '');
        const withTable = DOC.replace('## 진행', `### 차시 구성 (1차시 = 1시간)

| 차시 | 시간 | 진행 단계 |
|---|---|---|
| 1차시. 재미 | 1시간 | 전개 |

## 진행`);
        assert.deepStrictEqual(plain(call('gyosuanFlow')({ title: '재미', hours: 1.5, gyosuan: { docMd: withTable } })).map(step => step.minutes), [10, 70, 10], '차시 구성표를 수업 흐름으로 읽지 않는다');
        const grouped = DOC.replace('### 전개 1 - 재미 분석', '### 전개 1 - 재미 분석\n\n본문\n\n### 전개 2 - 재미 정리');
        assert.deepStrictEqual(plain(call('gyosuanFlow')({ title: '재미', gyosuan: { docMd: grouped } })).map(step => step.minutes), [10, 35, 35, 10], '표가 전개를 묶어도 표의 시간을 지킨다');
        assert.deepStrictEqual(['90분', '1시간 30분', '1.5시간', '90분 (1시간 30분)', '2시간'].map(call('readMinutes')), [90, 90, 90, 90, 120]);
        assert.deepStrictEqual(plain(call('subjectSessionLines')({ lessons: [{ title: '빈 차시' }] })), [], '시간이 없으면 표를 만들지 않는다');
        assert.ok(!call('gyosuanSessionTable')([['전개', '90분', '본문']], '수업').join('').includes('<br>'), '교수안 표에는 HTML을 쓰지 않는다');
        assert.ok(!md.includes('「재미 (2/2)」'), '멘트에는 차시 번호를 넣지 않는다');
        const fallback = plain(call('gyosuanFlow')({ title: '재미', hours: 1.5, gyosuan: { docMd: DOC.replace(/\| 전개 1 \| 70분[^\n]*\n/, '') } }));
        assert.strictEqual(fallback.length, 3, '표와 섹션 수가 달라도 섹션은 유지');
    });

    await run('차시 메타데이터: 파싱·이력·요소', async () => {
        assert.deepStrictEqual(plain(call('parseToolLines')('Unity | 6000.0 LTS\nBlender\n\n')), [{ name: 'Unity', version: '6000.0 LTS' }, { name: 'Blender', version: '' }]);
        assert.deepStrictEqual(plain(call('parseElementLines')('2001.1 | 요구 분석\n이름만')), [{ code: '2001.1', name: '요구 분석' }, { code: '', name: '이름만' }]);
        const mod = { reviewStatus: '작성중', tools: [], history: [] };
        const changed = plain(call('withMetaHistory')(mod, { reviewStatus: '완료', category: '기초', tools: [], prereqs: [], ncsElements: [] }));
        assert.strictEqual(changed.history.length, 1);
        assert.ok(changed.history[0].note.includes('상태: 작성중 → 완료') && changed.history[0].note.includes('카테고리'));
        assert.deepStrictEqual(mod.history, [], '원본 이력은 바꾸지 않음');
        const same = plain(call('withMetaHistory')({ reviewStatus: '완료', category: '기초', history: [{ at: 'x', note: 'y' }] }, { reviewStatus: '완료', category: '기초' }));
        assert.strictEqual(same.history.length, 1, '변경이 없으면 이력을 늘리지 않음');
    });

    await run('능력단위요소: 등록한 요소를 참조 목록으로 추천', async () => {
        const prompts = [];
        const aiCtx = makeContext(async (m, p) => {
            prompts.push(p.contents[0].parts[0].text);
            return reply({ recs: [
                { unitCode: 'U1', unitName: '단위', elementCode: 'E2', elementName: '요소 둘', fit: 88, covers: [1], reason: '근거' },
                { unitCode: 'U1', unitName: '단위', elementCode: 'E1', elementName: '요소 하나', fit: 40, covers: [], reason: '낮음' }
            ], note: '메모' });
        }, { gemini: 'k' });
        aiCtx.globalState.ncsElements = { U1: [{ code: 'E1', name: '요소 하나' }, { code: 'E2', name: '요소 둘' }] };
        aiCtx.globalState.ncsCustomUnits = [{ code: 'U1', name: '단위', level: 3, path: ['', '', '', '직접 추가'], verified: true, custom: true }];
        const subject = { title: '교과', ncs: { units: [{ code: 'U1', name: '단위' }] } };
        const { recs } = await vm.runInContext('recommendLessonElements', aiCtx)(subject, { title: '차시', objectives: ['목표'] });
        assert.deepStrictEqual(plain(recs).map(rec => rec.elementCode), ['E2', 'E1']);
        assert.deepStrictEqual(plain(vm.runInContext('pickLessonElements', aiCtx)(recs)).map(rec => rec.elementCode), ['E2'], '적합도 70 미만은 고르지 않음');
        assert.ok(prompts[0].includes('  - E2|요소 둘'));
    });

    await run('필터: 상태와 검색', async () => {
        const lesson = { title: '재미 분석', category: '기초', objectives: ['목표'], reviewStatus: '검수중' };
        assert.strictEqual(call('lessonMatchesFilter')(lesson), true);
        call('setLessonQueryFilter').call(ctx, '없는말');
        assert.strictEqual(call('lessonMatchesFilter')(lesson), false);
        call('setLessonQueryFilter').call(ctx, '기초');
        assert.strictEqual(call('lessonMatchesFilter')(lesson), true);
        call('setLessonQueryFilter').call(ctx, '');
    });

    const QB = `머리말입니다.

### 문제 1. 재미 판단 (복수정답)
학습 목표 1 · 밴드 L1 · 객관식

① 가
② 나
③ 다
④ 라

💡 **힌트:** 힌트 문장

✅ **정답:** ①, ②

📝 **해설:** 해설 문장
여러 줄 해설

---

### 문제 2. 서술 문제
학습 목표 2 · 밴드 L2 · 서술형

상황을 분석해 작성합니다.

✅ **정답:** 모범 답안

📏 **채점 기준:** 요소 (5점)

## 뒤 섹션

남는 본문입니다.
`;

    await run('문제은행: 읽기와 왕복', async () => {
        const blocks = call('lessonLintQuestions')(QB);
        assert.strictEqual(blocks.length, 2);
        const first = plain(call('parseQuestionBlock')(blocks[0]));
        assert.deepStrictEqual([first.no, first.title, first.objective, first.band, first.type, first.multi], [1, '재미 판단', 1, 'L1', '객관식', true]);
        assert.strictEqual(first.choices.length, 4);
        assert.strictEqual(first.answer, '①, ②');
        assert.strictEqual(first.explanation, '해설 문장\n여러 줄 해설');
        const second = plain(call('parseQuestionBlock')(blocks[1]));
        assert.deepStrictEqual([second.type, second.stem, second.rubric], ['서술형', '상황을 분석해 작성합니다.', '요소 (5점)']);
        assert.deepStrictEqual(plain(call('lintQuestion')(call('parseQuestionBlock')(blocks[1]))), []);
        const again = plain(call('parseQuestionBlock')(call('serializeQuestion')(call('parseQuestionBlock')(blocks[0]), 1)));
        assert.deepStrictEqual(again, first, '쓰고 다시 읽어도 같다');
    });

    await run('문제은행: 실제 교안 형식(색 강조, 이미지 자리, 해설의 보기 번호)', async () => {
        const block = `### 문제 1. 판별
<div class="image-wrapper"><img src="local:img_1"></div>
학습 목표 1 · 밴드 L1

상황 설명입니다.

① 첫째
<span style="color: #22c55e; font-weight: bold;">② 둘째</span>
③ 셋째
④ 넷째

💡 **힌트:** 힌트

✅ **정답:** ②

📝 **해설:** 둘째가 맞습니다.
①은 틀립니다.
③과 ④도 틀립니다.
`;
        const q = call('parseQuestionBlock')(block);
        assert.deepStrictEqual(plain(q.choices).map(c => c.text), ['첫째', '둘째', '셋째', '넷째']);
        assert.strictEqual(q.stem, '상황 설명입니다.');
        assert.ok(q.explanation.endsWith('③과 ④도 틀립니다.'));
        assert.deepStrictEqual(plain(call('lintQuestion')(q)), []);
        const written = call('serializeQuestion')(q, 1);
        assert.ok(written.includes('<span style="color: #22c55e; font-weight: bold;">② 둘째</span>'), '정답 강조 유지');
        assert.ok(written.includes('image-wrapper'), '이미지 유지');
        assert.deepStrictEqual(plain(call('parseQuestionBlock')(written)), plain(q));
    });

    await run('문제은행: 경계와 보기 분리', async () => {
        const code = '### 문제 1. 코드\n학습 목표 1 · 밴드 L2 · 코드제출\n\n```python\n# 입력 받기\nprint(1)\n```\n\n🧪 **테스트:** 1 출력\n\n---\n\n### 문제 2. 다음\n학습 목표 1 · 밴드 L1 · 단답식\n\n✅ **정답:** 값\n\n---\n\n**채점 기준표**\n\n<table><tr><td>기준</td></tr></table>\n';
        const blocks = call('lessonLintQuestions')(code);
        assert.strictEqual(blocks.length, 2);
        const first = call('parseQuestionBlock')(blocks[0]);
        assert.strictEqual(first.tests, '1 출력', '코드 블록의 # 은 제목이 아니다');
        assert.deepStrictEqual(plain(call('lintQuestion')(first)), []);
        const removed = call('removeQuestionMd')(code, 1);
        assert.ok(removed.includes('<table>') && !removed.includes('### 문제 2'), '문항 뒤 채점표는 남는다');
        const noRule = '### 문제 1. 끝\n학습 목표 1 · 밴드 L1 · 단답식\n\n✅ **정답:** 값\n\n📝 **해설:** 해설\n\n**채점 기준표**\n\n<table></table>\n';
        assert.strictEqual(call('removeQuestionMd')(noRule, 0).trim().startsWith('**채점 기준표**'), true, '구분선이 없어도 채점표를 지키지 않는다');
        const combo = call('parseQuestionBlock')('### 문제 1. 조합\n학습 목표 1 · 밴드 L1\n\n① 가\n② 나\n③ 다\n④ ①, ②\n⑤ ①, ②, ③\n\n✅ **정답:** ④\n');
        assert.deepStrictEqual(plain(combo.choices).map(c => c.text), ['가', '나', '다', '①, ②', '①, ②, ③'], '보기 안의 원문자는 나누지 않는다');
        const bare = call('parseQuestionBlock')('### 문제 1. 볼드 없음\n학습 목표 1 · 밴드 L1\n\n① 가\n② 나\n③ 다\n④ 라\n\n💡 힌트: 힌트\n\n✅ 정답: ②\n');
        assert.deepStrictEqual([bare.answer, bare.hint], ['②', '힌트'], '볼드 없는 필드도 읽는다');
        assert.ok(plain(call('lintQuestion')(call('parseQuestionBlock')('### 문제 1. 보기 없음\n학습 목표 1 · 밴드 L1\n\n✅ **정답:** ①\n'))).includes('보기는 4개 이상 둡니다.'));
        const parsed = plain(call('parseGeneratedQuestions')('```markdown\n### 문제 1. 펜스\n학습 목표 1 · 밴드 L1 · 단답식\n\n✅ **정답:** 값\n\n📝 **해설:** 해설\n```', { objective: 1, band: 'L1', type: '단답식' }));
        assert.strictEqual(parsed[0].explanation, '해설', '응답을 감싼 코드 펜스를 벗긴다');
    });

    await run('문제은행: 수정·삭제·추가는 다른 본문을 보존', async () => {
        const question = { ...call('parseQuestionBlock')(call('lessonLintQuestions')(QB)[1]), title: '고친 제목' };
        const edited = call('updateQuestionMd')(QB, 1, question);
        assert.ok(edited.includes('### 문제 2. 고친 제목') && edited.includes('머리말입니다.') && edited.includes('## 뒤 섹션'));
        const removed = call('removeQuestionMd')(QB, 0);
        assert.ok(removed.includes('### 문제 1. 서술 문제') && !removed.includes('재미 판단') && removed.includes('남는 본문입니다.'));
        const added = call('appendQuestionsMd')(QB, [question]);
        assert.strictEqual(call('lessonLintQuestions')(added).length, 3);
        assert.ok(added.indexOf('### 문제 3.') < added.indexOf('## 뒤 섹션'), '뒤 섹션 앞에 추가');
        assert.ok(call('appendQuestionsMd')('', [question]).startsWith('### 문제 1.'));
    });

    await run('문제은행: 유형별 검수', async () => {
        const lint = text => Array.from(call('lintQuestion')(call('parseQuestionBlock')(text), ['기획서의 핵심 구조를 스스로 설명할 수 있는가']));
        assert.ok(lint('### 문제 1. 제목\n학습 목표 1 · 밴드 L1 · 서술형\n').includes('L1 밴드에는 객관식·단답식 유형을 씁니다.'));
        assert.ok(lint('### 문제 1. 제목\n학습 목표 1 · 밴드 L1 · 단답식\n').includes('정답을 표기합니다.'));
        assert.ok(lint('### 문제 1. 제목\n학습 목표 1 · 밴드 L1 · 단답식\n\n✅ **정답:** 아주 긴 문장으로 답하는 내용이라 값 하나가 아닙니다\n').includes('정답이 단어나 값 하나로 확정되는지 확인합니다.'));
        assert.ok(lint('### 문제 1. 제목\n학습 목표 1 · 밴드 L2 · 서술형\n').includes('채점 기준을 작성합니다.'));
        assert.ok(lint('### 문제 1. 제목\n학습 목표 1 · 밴드 L2 · 코드제출\n').includes('기대 출력이나 테스트 케이스를 작성합니다.'));
        assert.ok(lint('### 문제 1. 제목\n학습 목표 1 · 밴드 L3 · 파일제출\n').includes('채점 루브릭을 작성합니다.'));
        assert.ok(lint('### 문제 1. 기획서의 핵심 구조를 스스로 설명할 수 있는가\n학습 목표 1 · 밴드 L2 · 서술형\n\n📏 **채점 기준:** 요소\n').includes('체크리스트 문장을 그대로 쓰지 않습니다.'));
    });

    await run('문제은행: 분포·CSV', async () => {
        const questions = call('lessonLintQuestions')(QB).map(call('parseQuestionBlock'));
        const dist = plain(call('questionDistribution')(questions, 2));
        assert.strictEqual(dist.rows[0].L1, 1);
        assert.strictEqual(dist.rows[1].L2, 1);
        assert.deepStrictEqual(dist.total, { L1: 1, L2: 1, L3: 0 });
        const csv = call('questionsCsv')(questions, ['목표 하나', '목표 둘'], { subject: '교과', lesson: '=차시', checklist: [] });
        assert.ok(csv.startsWith('﻿번호,교과,차시'));
        assert.ok(csv.includes("'=차시"), '수식 실행 방지');
        assert.ok(csv.includes('"해설 문장\n여러 줄 해설"'));
        assert.ok(csv.includes('검수 통과'));
    });

    await run('문제은행: AI 생성은 검수 지적을 한 번 고쳐 받음', async () => {
        const prompts = [];
        const aiCtx = makeContext(async (m, p) => {
            const text = p.contents[0].parts[0].text;
            prompts.push(text);
            return reply(text.includes('[자동 검수 지적]')
                ? '### 문제 1. 고친 문항\n학습 목표 2 · 밴드 L3 · 단답식\n\n✅ **정답:** 값\n'
                : '### 문제 1. 첫 문항\n학습 목표 9 · 밴드 L3 · 단답식\n');
        }, { gemini: 'k' });
        const mod = { title: '차시', objectives: ['목표1', '목표2'], tabContents: { assessment: QB, basicLearn: '교안 본문' } };
        const spec = { objective: 2, band: 'L1', type: '단답식', count: 1 };
        const questions = plain(await vm.runInContext('generateQuestions', aiCtx)(mod, spec));
        assert.strictEqual(prompts.length, 2);
        assert.strictEqual(questions[0].title, '고친 문항');
        assert.deepStrictEqual([questions[0].objective, questions[0].band, questions[0].type], [2, 'L1', '단답식'], '고른 목표·밴드·유형으로 맞춤');
        assert.ok(prompts[0].includes('재미 판단') && prompts[0].includes('교안 본문'), '기존 문항과 교안을 근거로 출제');
    });

    await run('SVG 삽화: 경로 선택과 팔레트 맞춤', async () => {
        assert.strictEqual(makeContext(async () => {}, { gemini: 'k' }).window.usesSvgIllustration(), false);
        assert.strictEqual(makeContext(async () => {}, { gemini: '', claude: '' }).window.usesSvgIllustration(), false);
        const claudeOnly = makeContext(async () => {}, { gemini: '', claude: 'k' });
        claudeOnly.TEXT_MODEL = 'claude-opus-5-5';
        vm.runInContext("TEXT_MODEL = 'claude-opus-5-5'", claudeOnly);
        assert.strictEqual(claudeOnly.window.usesSvgIllustration(), true, 'Gemini 키가 없으면 텍스트 모델로 그린다');
        const chosen = makeContext(async () => {}, { gemini: 'k' });
        vm.runInContext("IMAGE_MODEL = 'svg-illustration'", chosen);
        assert.strictEqual(chosen.window.usesSvgIllustration(), true, '설정에서 고를 수 있다');
        const palette = [{ role: '주색', hex: '#3D5FC4' }, { role: '바탕', hex: '#F6F4EE' }];
        assert.ok(call('snapSvgPalette')('<text fill="#3D5FC4">fill: #0000ff</text>', palette).svg.includes('>fill: #0000ff<'), '글자 내용은 바꾸지 않는다');
        const result = plain(call('snapSvgPalette')('<rect fill="#0000ff" stroke="#3D5FC4"/><rect fill="none"/><rect fill="#fff"/>', palette));
        assert.ok(result.svg.includes('fill="#3D5FC4"') && result.svg.includes('fill="none"') && result.svg.includes('fill="#F6F4EE"'));
        assert.strictEqual(result.replaced, 2);
        const prompt = call('buildSvgPrompt')({ ...plain(call('ART_DEFAULT')), anchorSvg: '<svg>기준</svg>' }, '게임 루프');
        assert.ok(prompt.includes('#3D5FC4') && prompt.includes('[기준 삽화 SVG') && prompt.includes('게임 루프'));
    });

    await run('섹션 고정: 다시 생성해도 원문 유지', async () => {
        const md = '# 제목\n\n## 학습 목표\n\n- 목표\n\n## 🎯 핵심 내용 (⏱ 30분)\n\n사용자가 다듬은 본문입니다.\n\n```md\n## 코드 안 제목\n```\n\n## 정리\n\n끝\n';
        const titles = plain(call('mdSections')(md)).map(section => section.title);
        assert.deepStrictEqual(titles, ['', '학습 목표', '🎯 핵심 내용 (⏱ 30분)', '정리'], '코드 안의 ## 은 나누지 않는다');
        const key = call('lockTitleKey')('🎯 핵심 내용 (⏱ 30분)');
        const mod = { tabContents: { basicLearn: md }, lockedSections: { basicLearn: [key] } };
        const blocks = call('lockedSectionBlocks')(mod, 'basicLearn');
        assert.strictEqual(blocks.length, 1);
        assert.ok(call('lockedSectionPrompt')(blocks).includes('사용자가 다듬은 본문입니다.'));
        const rewritten = call('restoreLockedSections')('## 학습 목표\n\n- 새 목표\n\n## 핵심 내용 (⏱ 45분)\n\n모델이 바꾼 본문입니다.\n', blocks);
        assert.ok(rewritten.includes('사용자가 다듬은 본문입니다.') && !rewritten.includes('모델이 바꾼 본문') && rewritten.includes('- 새 목표'));
        const missing = call('restoreLockedSections')('## 학습 목표\n\n- 새 목표\n', blocks);
        assert.ok(missing.includes('사용자가 다듬은 본문입니다.'), '모델이 빠뜨려도 복원');
        assert.strictEqual(call('restoreLockedSections')('그대로', []), '그대로');
        const twice = '## 실습\n\n첫 원문\n\n## 실습\n\n둘째 원문\n';
        const both = call('lockedSectionBlocks')({ tabContents: { t: twice }, lockedSections: { t: ['실습'] } }, 't');
        const repeated = call('restoreLockedSections')('## 실습\n\n새 글\n\n## 실습\n\n새 글\n', both);
        assert.ok(repeated.indexOf('첫 원문') < repeated.indexOf('둘째 원문') && repeated.includes('첫 원문') && !repeated.includes('새 글'), '같은 제목은 순서대로 짝짓는다');
    });

    await run('NCS: 두 모델 합의와 직접 추가', async () => {
        const merged = plain(call('mergeNcsRanks')([[{ code: 'A', score: 80, reason: '근거' }, { code: 'B', score: 90, reason: '' }], [{ code: 'A', score: 90, reason: '' }]]));
        assert.deepStrictEqual(merged.map(row => [row.code, row.score, row.agreed]), [['A', 85, true], ['B', 81, false]], '한 모델만 고르면 감점');
        assert.deepStrictEqual(plain(call('mergeNcsRanks')([[{ code: 'A', score: 80, reason: '' }]])).map(row => row.score), [80], '모델이 하나면 감점 없음');
        const real = plain(call('ncsSearch')('게임 기획', 1))[0];
        const models = [];
        const both = makeContext(async model => {
            models.push(model);
            return reply([{ code: real.code, score: 90, reason: '근거' }]);
        }, { gemini: 'k', claude: 'c' });
        const recs = plain(await vm.runInContext('rankNcsCandidates', both)('프롬프트', new Map([[real.code, real]])));
        assert.deepStrictEqual(models, ['gemini-4-argon', 'claude-opus-5-5']);
        assert.strictEqual(recs[0].agreed, true);
        assert.strictEqual(call('crossCheckModel')(), '', '키가 하나면 교차 판단 없음');
        const failing = makeContext(async model => {
            if (model === 'claude-opus-5-5') throw new Error('장애');
            return reply([{ code: real.code, score: 80, reason: '근거' }, { code: real.code, score: 80, reason: '중복' }]);
        }, { gemini: 'k', claude: 'c' });
        const solo = plain(await vm.runInContext('rankNcsCandidates', failing)('프롬프트', new Map([[real.code, real]])));
        assert.deepStrictEqual([solo.length, solo[0].score, solo[0].agreed], [1, 80, false], '교차 모델이 실패해도 감점하지 않고 중복은 하나로 센다');
        assert.strictEqual(plain(call('addCustomNcsUnit')({ code: real.code, name: '다른 이름', level: '' })).name, real.name, '공식 코드는 공식 단위를 쓴다');
        const unit = plain(call('addCustomNcsUnit')({ code: ' X1 ', name: ' 직접 단위 ', level: '3' }));
        assert.deepStrictEqual([unit.code, unit.name, unit.level, unit.verified], ['X1', '직접 단위', 3, false]);
        assert.strictEqual(plain(call('ncsUnit')('X1')).name, '직접 단위');
        assert.strictEqual(plain(call('ncsKeywordRows')('X1', 5))[0].code, 'X1', '코드로 바로 찾는다');
        assert.throws(() => call('addCustomNcsUnit')({ code: '', name: '', level: '' }), /코드와 이름/);
        ctx.globalState.ncsCustomUnits = [];
    });

    await run('문제은행: 교차 검수와 과정 전체 CSV', async () => {
        const aiCtx = makeContext(async (m, p) => {
            const text = p.contents[0].parts[0].text;
            if (text.includes('평가 문항 검수자')) return reply([{ i: 0, ok: false, notes: '정답이 둘입니다.' }]);
            return reply('### 문제 1. 첫 문항\n학습 목표 1 · 밴드 L1 · 단답식\n\n✅ **정답:** 값\n');
        }, { gemini: 'k', claude: 'c' });
        const mod = { title: '차시', objectives: ['목표1'], tabContents: { assessment: '' } };
        const [question] = await vm.runInContext('generateQuestions', aiCtx)(mod, { objective: 1, band: 'L1', type: '단답식', count: 1 });
        assert.ok(question.review.startsWith('수정 필요 · 정답이 둘입니다.'));
        assert.ok(plain(vm.runInContext('lintQuestion', aiCtx)(question)).some(msg => msg.startsWith('AI 교차 검수')));
        const reviewedMd = '### 문제 1. 제목\n학습 목표 1 · 밴드 L1 · 단답식\n\n✅ **정답:** 값\n\n🔍 **교차 검수:** 수정 필요 · 해석이 갈린다.\n';
        assert.ok(!Array.from(vm.runInContext('lintLessonMarkdown', aiCtx)(reviewedMd)).some(issue => issue.msg.includes('경어체')), '검수 메모는 본문 어투 검사에서 뺀다');
        const written = vm.runInContext('serializeQuestion', aiCtx)(question, 1);
        assert.strictEqual(vm.runInContext('parseQuestionBlock', aiCtx)(written).review, question.review, '검수 결과도 마크다운에 남는다');
        const silent = makeContext(async () => { throw new Error('장애'); }, { gemini: 'k', claude: 'c' });
        assert.strictEqual((await vm.runInContext('crossReviewQuestions', silent)(mod, [question], ['목표1'])).length, 1, '검수 실패해도 문항은 유지');
        ctx.globalState.subjects = [{ title: '교과', lessons: [{ title: '차시', objectives: ['목표'], tabContents: { assessment: QB } }, { title: '빈 차시', tabContents: {} }] }];
        const { rows, csv } = call('courseQuestionsCsv')();
        assert.strictEqual(rows, 2);
        assert.ok(csv.includes('재미 판단') && csv.includes('서술 문제'));
        ctx.globalState.subjects = [];
    });

    await run('차시별 편성안: 슬라이드 번호를 다시 매김', async () => {
        const md = call('gyosuanSessionDecksMd')({ title: '재미', hours: 1.5, gyosuan: { docMd: DOC, deckMd: DECK } });
        assert.ok(md.includes('# 슬라이드 편성안 - 1차시. 재미 (1/2)') && md.includes('### 슬라이드 2 - 재미 분석 슬라이드'));
        assert.ok(md.includes('이 차시에 대응하는 슬라이드가 없습니다.'));
        assert.ok(md.indexOf('표지') < md.indexOf('재미 분석 슬라이드'), '표지는 첫 차시에 싣는다');
        assert.strictEqual(call('gyosuanSessionDecksMd')({ title: '없음', gyosuan: { docMd: '' } }), '');
    });

    await run('레퍼런스 스타일: 형식 확인', async () => {
        const style = plain(call('normalizeArtStyle')({ name: '수채', palette: [{ role: '주색', hex: '#112233' }, { role: '잘못', hex: 'blue' }], stroke: '3' }));
        assert.deepStrictEqual(style.palette, [{ role: '주색', hex: '#112233' }]);
        assert.strictEqual(style.stroke, 3);
        assert.ok(style.rules.length > 0, '빠진 항목은 기본값');
        assert.strictEqual(plain(call('normalizeArtStyle')({ palette: [{ hex: '#000000' }], stroke: 40 })).stroke, 8, '선 굵기 상한');
        assert.strictEqual(call('artBackground')([{ role: '주색', hex: '#112233' }, { role: '밝은 색', hex: '#F0F0F0' }]), '#F0F0F0', '바탕 역할이 없으면 가장 밝은 색');
        assert.strictEqual(call('artBackground')([{ role: '배경', hex: '#223344' }, { role: '흰색', hex: '#FFFFFF' }]), '#223344');
        assert.throws(() => call('normalizeArtStyle')({ palette: [] }), /팔레트/);
        assert.throws(() => call('normalizeArtStyle')(null), /팔레트/);
    });

    await run('스캔 판독: 쪽 번호 유지', async () => {
        const aiCtx = makeContext(async (m, p) => reply(['첫 쪽']), { gemini: 'k' });
        const texts = plain(await vm.runInContext('transcribeImages', aiCtx)([{ data: 'a' }, { data: 'b' }, { data: 'c' }, { data: 'd' }, { data: 'e' }]));
        assert.deepStrictEqual(texts, ['첫 쪽', '', '', '', '첫 쪽'], '응답이 짧아도 페이지 위치를 지킨다');
    });

    await run('휴지통: 삭제와 복원', async () => {
        const lesson = { id: 1, title: '삭제할 차시' };
        ctx.globalState.subjects = [{ id: 's1', title: '교과', lessons: [] }];
        ctx.globalState.lessonTrash = [];
        call('moveLessonsToTrash')([lesson]);
        assert.ok(call('renderLessonTrashButton')().includes('휴지통 1'));
        assert.strictEqual(call('restoreLesson')(0), true);
        assert.deepStrictEqual(vm.runInContext('courseData.map(item => item.title)', ctx).length, 1);
        assert.strictEqual(ctx.globalState.subjects[0].lessons[0].title, '삭제할 차시');
        assert.strictEqual(ctx.globalState.lessonTrash.length, 0);
        assert.strictEqual(call('renderLessonTrashButton')(), '');
        ctx.globalState.subjects = [];
    });

    await run('참고 자료: 쪽 범위', async () => {
        assert.deepStrictEqual([...call('parsePageRange')('1-3, 7, 글자, 9-9')], [1, 2, 3, 7, 9]);
        const content = '[p.1] 하나\n\n[p.2] 둘\n\n[p.3] 셋';
        assert.strictEqual(call('filterPageRange')(content, '2-3'), '[p.2] 둘\n\n[p.3] 셋');
        assert.strictEqual(call('filterPageRange')(content, ''), content, '범위가 없으면 전체');
        assert.strictEqual(call('filterPageRange')(content, '50'), content, '해당 쪽이 없으면 전체');
        assert.strictEqual([...call('parsePageRange')('1-100000000')].length, 1000, '범위 상한');
        assert.strictEqual(call('filterPageRange')('[Slide 1] 가\n[노트] 메모\n\n[Slide 2] 나', '1'), '[Slide 1] 가\n[노트] 메모');
        assert.strictEqual(call('hasPageLabels')('본문만 있음'), false);
        const inline = plain(call('dataUrlToInline')('data:image/png;base64,QUJD'));
        assert.deepStrictEqual(inline, { mimeType: 'image/png', data: 'QUJD' });
    });

    await run('작업별 추론 강도: 기본은 설정값 유지', async () => {
        const settings = { window: {}, console: { warn() {} }, localStorage: { getItem: () => null, setItem() {} } };
        vm.createContext(settings);
        vm.runInContext(fs.readFileSync(root + 'data.js', 'utf8'), settings);
        vm.runInContext(fs.readFileSync(root + 'claude.js', 'utf8'), settings);
        const effort = name => vm.runInContext(`taskEffort(${JSON.stringify(name)})`, settings);
        const request = role => vm.runInContext('buildClaudeRequest', settings)('claude-opus-5-5', { taskRole: role, contents: [{ role: 'user', parts: [{ text: '질문' }] }] });
        assert.strictEqual(effort('fast'), 'max', '끄면 사용자의 최대 설정을 유지');
        assert.strictEqual(request('fast').output_config.effort, 'max');
        vm.runInContext('updateAutoTaskEffort(true)', settings);
        assert.deepStrictEqual(['plan', 'review', 'qgen', 'fast', undefined].map(effort), ['medium', 'medium', 'low', 'low', 'max'], '교안 본문은 낮추지 않는다');
        assert.strictEqual(request('qgen').output_config.effort, 'low');
        assert.ok(!('taskRole' in request('qgen')), '앱 내부 값은 요청에 싣지 않는다');
    });

    await run('AI 수정 비교', async () => {
        const html = call('wordDiffHtml')('재미를 매우 쉽게 설계합니다', '재미를 단계별로 설계합니다');
        assert.ok(html.includes('line-through">매우 쉽게</del>') && html.includes('단계별로</ins>') && html.includes('설계합니다'));
        assert.ok(!html.includes('line-through">재미를'));
        assert.ok(call('wordDiffHtml')('<b>', '<i>').includes('&lt;b&gt;'), '이스케이프');
        assert.ok(!call('wordDiffHtml')('같은 문장', '같은 문장').includes('<del'));
    });

    console.log('ALL PASSED');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
