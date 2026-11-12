// 과정 설계·NCS 테스트 (실행: node tests/course.test.js)
// AI 응답만 스텁으로 두고 실제 course-design.js, course-ncs.js와 NCS 카탈로그를 실행한다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', 'js') + path.sep;

function makeContext(callGemini, keys = { gemini: '' }) {
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, URL, Blob,
        TEXT_MODEL: 'gemini-4-argon',
        apiKey: keys.gemini,
        claudeApiKey: '',
        isClaudeModel: m => /^claude-/.test(m),
        CONTEXT_CORE: { personas: { orchestrator: '설계자' } },
        globalState: { courseTitle: '과정', subjects: [] },
        currentSubjectId: null,
        escapeHtml: s => String(s),
        safeJSONParse: t => JSON.parse(t),
        extractText: d => d.candidates[0].content.parts[0].text,
        document: { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } },
        callGemini
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['kbuilder/ncs-catalog.js', 'lesson-lint.js', 'ai-routing.js', 'course-ncs.js', 'course-ncs-ref.js', 'course-design.js', 'course-sessions.js', 'course-meta.js', 'course-qbank.js'].forEach(f => vm.runInContext(fs.readFileSync(root + f, 'utf8'), ctx));
    return ctx;
}

const reply = obj => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] });
const plain = v => JSON.parse(JSON.stringify(v));

async function run(name, fn) {
    await fn();
    console.log('PASS', name);
}

(async () => {
    const ctx = makeContext(async () => { throw new Error('호출되면 안 됨'); });
    const call = name => vm.runInContext(name, ctx);

    await run('주제 입력 해석', async () => {
        const parsed = plain(call('parseTopicInput')('주제 입력: 생성형 AI와 UGC\n - 생성형 AI의 종류\n * LLM 원리 (7시간)\n 1. 저작권\n - 생성형 AI의 종류\n'));
        assert.deepStrictEqual(parsed, { title: '생성형 AI와 UGC', units: ['생성형 AI의 종류', 'LLM 원리', '저작권'], hours: [0, 7, 0] });
        assert.strictEqual(plain(call('parseTopicInput')('게임 기획 입문\n- 재미\n- 밸런스')).title, '게임 기획 입문');
        const noTitle = plain(call('parseTopicInput')('- 게임 기획\n- 시장 분석\n- 밸런스'));
        assert.deepStrictEqual([noTitle.title, noTitle.units.length], ['', 3], '글머리는 주제로 삼지 않는다');
        assert.deepStrictEqual(plain(call('parseTopicInput')('과정\n- 단원\n  - 세부1\n  - 세부2\n- 다음 단원')).units, ['단원', '다음 단원'], '세부 항목은 단원이 아니다');
        assert.deepStrictEqual(plain(call('parseTopicInput')('과정\n단원1\n단원2')).units, ['단원1', '단원2']);
    });

    await run('시간 배분: 합계·최소값·가중치', async () => {
        const allocate = call('allocateTime');
        const sum = a => a.reduce((x, y) => x + y, 0);
        assert.strictEqual(sum(allocate(6, 40)), 40);
        assert.deepStrictEqual(plain(allocate(3, 10, [1, 1, 2])).length, 3);
        assert.ok(allocate(3, 10, [1, 1, 2])[2] > allocate(3, 10, [1, 1, 2])[0]);
        assert.strictEqual(sum(allocate(4, 240, [3, 1, 1, 1], 30)), 240);
        assert.ok(plain(allocate(5, 5)).every(x => x === 1));
        // 19차: 단원 시간은 고정(5차시 × 8시간 = 40시간)이라 (N시간) 표시와 적은 총 시간은 쓰지 않고, 과정 총 시간은 단원 수 × 40시간이다
        const design = plain(call('createCourseDesign')({ title: '과정', units: ['가', '나'], hours: [30, 10] }, 40, '수강생'));
        assert.deepStrictEqual([design.units.map(u => u.hours), design.totalHours, design.requestedHours], [[40, 40], 80, 40], '적은 40시간 대신 80시간(바꾼 까닭을 보이려고 적은 값을 남긴다)');
        assert.strictEqual(plain(call('createCourseDesign')({ title: '과정', units: ['가'], hours: [0] }, 40, '수강생')).requestedHours, undefined, '같으면 남기지 않는다');
        assert.deepStrictEqual(plain(allocate(0, 10)), []);
    });

    await run('기본 블록·진행 단계 합계: 단원마다 5차시 × 480분, 진행 단계는 도입·개념·실습(기본 120분)·정리로 480분', async () => {
        const modules = plain(call('defaultModules')('LLM 원리'));
        assert.deepStrictEqual(modules.map(m => m.minutes), [480, 480, 480, 480, 480]);
        assert.deepStrictEqual(modules.map(m => m.title), ['LLM 원리 — 핵심 개념', 'LLM 원리 — 구조와 사례', 'LLM 원리 — 적용 실습', 'LLM 원리 — 심화 활용', 'LLM 원리 — 종합 정리']);
        modules.forEach(m => {
            assert.strictEqual(m.flow.reduce((a, s) => a + s.minutes, 0), 480);
            assert.ok(m.flow.every(step => step.minutes % 5 === 0));
            assert.deepStrictEqual(m.flow.map(step => step.phase), ['도입', '전개', '전개', '정리']);
            assert.ok(m.flow[2].title.includes('실습') && m.flow[2].minutes === 120, '실습 단계는 실습 탭 기본 120분');
        });
    });

    await run('단원은 늘 5차시 × 8시간으로 맞춘다: 기본 블록은 다시 만들고, AI·고친 블록은 묶거나 나누며 목표를 남긴다', async () => {
        const unit = { title: 'A', hours: 4, modules: call('defaultModules')('A') };
        const fixed = plain(call('normalizeDesignUnit')(unit));
        assert.deepStrictEqual([fixed.hours, fixed.modules.length, fixed.modules.reduce((a, m) => a + m.minutes, 0)], [40, 5, 2400]);
        fixed.modules.forEach(m => assert.strictEqual(m.flow.reduce((a, s) => a + s.minutes, 0), m.minutes));
        assert.strictEqual(unit.hours, 4, '원본은 바꾸지 않음');
        assert.ok(plain(call('defaultFlow')(10, '짧은 블록')).every(step => step.minutes > 0), '짧은 블록도 음수·0분이 없다');
        const designed = { title: 'A', hours: 2, modules: [{ title: '설계 블록', minutes: 60, objectives: [], flow: [] }] };
        const split = plain(call('normalizeDesignUnit')(designed));
        assert.deepStrictEqual(split.modules.map(m => m.title), ['설계 블록 — 핵심 개념', '설계 블록 — 구조와 사례', '설계 블록 — 적용 실습', '설계 블록 — 심화 활용', '설계 블록 — 종합 정리'], 'AI 블록 하나는 5차시로 나눈다');
        const tooMany = { title: 'A', hours: 1, modules: Array.from({ length: 7 }, (_, i) => ({ title: `블록${i}`, minutes: 90, objectives: [`목표${i}`], flow: Array.from({ length: 5 }, () => ({ phase: '전개', title: '단계', minutes: 18 })) })) };
        const merged = plain(call('normalizeDesignUnit')(tooMany));
        assert.deepStrictEqual(merged.modules.map(m => m.title), ['블록0 · 블록1', '블록2 · 블록3', '블록4', '블록5', '블록6'], '차례를 지켜 이웃한 블록을 묶는다');
        assert.deepStrictEqual(merged.modules.flatMap(m => m.objectives), tooMany.modules.map(m => m.objectives[0]), '목표는 하나도 버리지 않는다');
        merged.modules.forEach(m => assert.deepStrictEqual([m.minutes, m.flow.reduce((a, s) => a + s.minutes, 0)], [480, 480]));
    });

    await run('학습목표 검사', async () => {
        const lint = call('lintObjective');
        assert.strictEqual(lint('주어진 양식으로 게임 기획서를 작성할 수 있다.'), '');
        assert.ok(lint('게임 기획을 이해한다.'));
        assert.ok(lint('게임 기획을 이해할 수 있다.'));
        assert.ok(lint('기획서를 쓴다.'));
        assert.ok(lint('기획서를 쓸 수 있다.'));
        assert.strictEqual(lint('주어진 양식으로 게임 기획서를 작성할 수 있습니다.'), '');
        assert.ok(lint('주어진 양식의 게임 기획 전체 내용을 이해할 수 있습니다.'));
    });

    await run('NCS 검색: 실제 카탈로그', async () => {
        const search = call('ncsSearch');
        const game = plain(search('게임 기획', 10));
        assert.ok(game.length > 0 && /게임/.test(`${game[0].name} ${game[0].path.join(' ')}`), JSON.stringify(game[0]));
        assert.ok(game[0].match >= game.at(-1).match);
        assert.strictEqual(new Set(game.map(u => u.code)).size, game.length);
        assert.deepStrictEqual(plain(search('', 5)), []);
        const expanded = plain(search('LLM 프롬프트', 10));
        assert.ok(expanded.length > 0, '동의어 확장');
        const unit = plain(call('ncsUnit')(game[0].code));
        assert.strictEqual(unit.code, game[0].code);
        assert.strictEqual(call('ncsUnit')('없는코드'), null);
        assert.ok(/수준\)$/.test(call('ncsLine')(unit)));
        const entity = vm.runInContext('window.KBuilder.NCS.units', ctx).find(row => row[1].includes('&amp;'));
        if (entity) assert.ok(!call('ncsUnit')(entity[0]).name.includes('&amp;'), '카탈로그 엔티티를 푼다');
    });

    await run('NCS 추천: 키가 없으면 키워드 추천', async () => {
        const recs = plain(await call('recommendSubjectNcs')({ title: '게임 기획', lessons: [{ title: '재미 설계' }] }));
        assert.ok(recs.length > 0 && recs.length <= 6);
        assert.ok(recs.every(r => r.by === '키워드' && r.score > 0));
    });

    await run('NCS 검색: 과정 주제를 함께 사용', async () => {
        const local = makeContext(async () => { throw new Error('호출되면 안 됨'); });
        local.globalState.courseDesign = { title: '게임 기획 입문' };
        const recs = plain(await vm.runInContext('recommendSubjectNcs', local)({ title: '코어 루프와 재미 설계', lessons: [] }));
        assert.ok(recs.some(rec => /게임/.test(`${rec.name} ${rec.path.join(' ')}`)), '교과 이름에 없어도 과정 주제로 찾는다');
        assert.ok(vm.runInContext('subjectNcsBrief', local)({ title: '교과' }).includes('[과정] 게임 기획 입문'));
    });

    await run('NCS 추천: AI 경로는 후보 안의 코드만 수용', async () => {
        const real = plain(call('ncsSearch')('게임 기획', 3));
        const seen = [];
        const aiCtx = makeContext(async (m, p) => {
            const t = p.contents[0].parts[0].text;
            seen.push(t.includes('세분류를') ? 'subd' : 'rank');
            assert.strictEqual(p.generationConfig.responseMimeType, 'application/json');
            if (t.includes('세분류를')) return reply({ subds: [real[0].subd, '99999999'] });
            return reply([{ code: real[0].code, score: 92, reason: '근거' }, { code: '지어낸코드', score: 99, reason: 'x' }, { code: real[1].code, score: 150, reason: '' }]);
        }, { gemini: 'k' });
        const recs = plain(await vm.runInContext('recommendSubjectNcs', aiCtx)({ title: '게임 기획' }));
        assert.deepStrictEqual(seen, ['subd', 'rank']);
        assert.strictEqual(recs.length, 2);
        assert.strictEqual(recs[0].score, 100, '점수 상한');
        assert.ok(!recs.some(r => r.code === '지어낸코드'));
    });

    await run('NCS 자동 배정 규칙', async () => {
        const pick = call('pickAutoNcs');
        const rec = score => ({ code: String(score), score });
        assert.deepStrictEqual(plain(pick([rec(90), rec(80), rec(75), rec(71), rec(60)])).map(r => r.score), [90, 80, 75]);
        assert.deepStrictEqual(plain(pick([rec(60), rec(50)])).map(r => r.score), [60], '기준 미달이면 1위');
        assert.deepStrictEqual(plain(pick([rec(30)])), [], '최소 기준 미달이면 배정하지 않는다');
        assert.deepStrictEqual(plain(pick([])), []);
        const subject = { title: '게임 기획', lessons: [] };
        await call('autoAssignNcs')(subject);
        assert.strictEqual(subject.ncs.confirmed, false);
        assert.strictEqual(subject.ncs.units.length, 0, '키워드 일치는 배정하지 않는다');
        assert.ok(subject.ncs.recs.length >= 1, '후보로는 남긴다');
        assert.strictEqual(call('subjectNcsText')(subject), '');
        const real = plain(call('ncsSearch')('게임 기획', 1))[0];
        const aiCtx = makeContext(async (m, p) => (p.contents[0].parts[0].text.includes('세분류를')
            ? reply({ subds: [real.subd] })
            : reply([{ code: real.code, score: 90, reason: '근거' }])), { gemini: 'k' });
        const assigned = { title: '게임 기획', lessons: [] };
        await vm.runInContext('autoAssignNcs', aiCtx)(assigned);
        assert.strictEqual(assigned.ncs.units[0].code, real.code, 'AI 적합도는 자동 배정');
        assert.ok(vm.runInContext('subjectNcsText', aiCtx)(assigned).endsWith('(미확정)'));
        assigned.ncs.confirmed = true;
        assert.ok(!vm.runInContext('subjectNcsText', aiCtx)(assigned).includes('미확정'));
        const confirmed = { title: '게임 기획', ncs: { units: [{ code: 'X' }], confirmed: true } };
        await call('autoAssignNcs')(confirmed);
        assert.strictEqual(confirmed.ncs.units[0].code, 'X', '확정한 교과는 유지');
    });

    await run('AI 과정 설계: 시간·블록·실패 단원 처리', async () => {
        const aiCtx = makeContext(async (m, p) => {
            const t = p.contents[0].parts[0].text;
            if (t.includes('과정 목표')  && t.includes('[단원]\n')) return reply({ goal: '기획서를 작성할 수 있다.', hours: [30, 10] });
            if (t.includes('[단원] 실패 단원')) throw new Error('API 실패');
            return reply({ modules: [{ title: '블록', minutes: 200, objectives: ['a', 'b', 'c', 'd'], flow: [{ phase: '도입부', title: '시작', minutes: 20 }, { phase: '본문', title: '전개', minutes: 160 }, { phase: '정리', title: '끝', minutes: 20 }] }] });
        });
        const design = vm.runInContext('createCourseDesign', aiCtx)({ title: '과정', units: ['성공 단원', '실패 단원'] }, 40, '수강생');
        const { design: planned, failed } = await vm.runInContext('planCourseDesign', aiCtx)(design);
        const result = plain(planned);
        assert.strictEqual(failed, 1);
        assert.strictEqual(result.goal, '기획서를 작성할 수 있다.');
        assert.deepStrictEqual([result.units.map(u => u.hours), result.totalHours], [[40, 40], 80], 'AI가 시간을 나눠 보내도 단원마다 40시간');
        // AI가 200분 블록 하나만 보내도 480분 차시 5개로 나누고, 목표 3개(넷째는 버린다)를 다섯 차시에 나눠 담는다
        const first = result.units[0].modules;
        assert.deepStrictEqual(first.map(m => m.minutes), [480, 480, 480, 480, 480]);
        assert.deepStrictEqual(first.map(m => m.objectives), [['a'], ['a'], ['b'], ['b'], ['c']]);
        first.forEach(m => assert.strictEqual(m.flow.reduce((a, s) => a + s.minutes, 0), 480));
        assert.strictEqual(result.units[1].modules.reduce((a, m) => a + m.minutes, 0), 2400, '실패 단원은 기본 5차시');
        let calls = 0;
        const cancelled = makeContext(async () => { calls += 1; return reply({ goal: '', hours: [] }); });
        await vm.runInContext('planCourseDesign', cancelled)(design, () => {}, () => true);
        assert.strictEqual(calls, 1, '취소하면 단원 호출을 멈춘다');
    });

    await run('교과·차시 변환과 교안 설계 정보', async () => {
        const unit = { title: '단원', hours: 3, modules: [{ title: '블록', minutes: 90, objectives: ['설명할 수 있다.'], flow: [{ phase: '도입', title: '시작', minutes: 10 }] }, { title: '블록2', minutes: 90, objectives: [], flow: [] }] };
        const subject = plain(call('unitToSubject')(unit, 's1', 100, '수강생'));
        assert.deepStrictEqual(subject.lessons.map(l => l.id), [100, 101]);
        assert.strictEqual(subject.lessons[0].hours, 1.5);
        assert.strictEqual(plain(call('moduleToLesson')({ title: '블록', minutes: 100, objectives: [], flow: [] }, 1)).hours, 1.67, '시수는 소수 둘째 자리까지');
        assert.strictEqual(subject.lessons[0].status, 'waiting');
        assert.strictEqual(subject.lessons[1].description, '블록2');
        assert.strictEqual(subject.mainQuest.id, 'mainQuest');
        assert.deepStrictEqual(subject.referenceUrls, [], '편집기가 쓰는 참고자료 필드를 갖춘다');
        const brief = call('lessonDesignBrief')(subject.lessons[0]);
        assert.ok(brief.includes('90분') && brief.includes('설명할 수 있다.') && brief.includes('도입: 시작 (10분)'));
        assert.strictEqual(call('lessonDesignBrief')({ title: '기존 차시' }), '');
    });

    await run('과정 설계서', async () => {
        ctx.globalState.courseTitle = '테스트 과정';
        ctx.globalState.courseDesign = { goal: '작성할 수 있다.' };
        ctx.globalState.subjects = [
            { title: '빈 교과', lessons: [] },
            { title: '단원', ncs: { units: [{ code: 'C1', name: '게임기획', level: 5 }], confirmed: true }, lessons: [{ title: 'A|B 블록', hours: 1.5, objectives: ['목표'], flow: [{ phase: '도입', title: '시작', minutes: 10 }] }, { title: '둘째', hours: 1.67, objectives: [], flow: [] }] }
        ];
        const md = call('courseDesignMd')();
        ['# 과정 설계서 - 테스트 과정', '작성할 수 있다.', '| 1. 단원 | 3시간 10분 | A\\|B 블록(1시간 30분)<br>둘째(1시간 40분) | C1 게임기획 (5수준) |', '| **합계** | **3시간 10분** |', '### 학습모듈 1-1. A|B 블록 (1시간 30분)', '| 도입 | 시작 | 10분 |'].forEach(t => assert.ok(md.includes(t), t));
        assert.ok(!md.includes('빈 교과'));
    });
    console.log('ALL PASSED');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
