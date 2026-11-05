// 교안 HTML 정리·학습 목표 세트·교과 현황·기존 내용 보강·일괄 교수안 테스트 (실행: node tests/final-round.test.js)
// AI 응답과 화면 갱신만 스텁으로 두고 실제 파일을 실행한다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', 'js') + path.sep;
const FILES = [
    'lesson-sanitize.js', 'filename-convention.js', 'kbuilder/ncs-catalog.js', 'lesson-lint.js', 'lesson-opening.js', 'lesson-objectives.js', 'lesson-material.js', 'lesson-pipeline.js', 'ai-routing.js', 'course-ncs.js', 'course-ncs-ref.js', 'course-design.js', 'course-design-edit.js',
    'course-sessions.js', 'course-meta.js', 'course-elements.js', 'course-art.js', 'course-illustrations.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js',
    'lesson-attachments.js', 'tabs.js', 'course-flow.js', 'course-overview.js', 'course-backfill.js', 'cost-estimate.js'
];
const TAB_IDS = ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment'];

function makeContext(extra = {}) {
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: fn => { fn(); return 0; }, clearTimeout, Promise, URL, Blob, Uint16Array, Map, Set,
        TEXT_MODEL: 'gemini-4-argon',
        apiKey: 'test-placeholder',
        claudeApiKey: '',
        isClaudeModel: m => /^claude-/.test(m),
        CONTEXT_CORE: { personas: { orchestrator: '설계자', instructor: '강사' }, rules: {} },
        LESSON_TABS: TAB_IDS.map(id => ({ id, label: id })),
        globalState: { courseTitle: '과정', subjects: [] },
        courseData: [],
        currentSubjectId: 's1',
        currentEditingModuleId: null,
        localStorage: { getItem: () => null, setItem() {} },
        saved: 0,
        saveState: async () => { ctx.saved += 1; },
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : ''),
        safeJSONParse: t => JSON.parse(t),
        extractText: d => d.candidates[0].content.parts[0].text,
        document: { getElementById: () => null, createElement: () => ({}), querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} } },
        getEditingModule: id => ctx.globalState.subjects.flatMap(subject => subject.lessons).find(lesson => String(lesson.id) === String(id)),
        stripInstructorCallouts: md => md.replace(/<div class="instructor-callout">[\s\S]*?<\/div>/g, ''),
        resolveMarkdownImages: (md, images) => Object.entries(images || {}).reduce((text, [id, url]) => text.split(`local:${id}`).join(url), md),
        openEditor() {}, renderSidebar() {}, renderOverviewLNB() {}, renderEditor() {}, showLessonView() {},
        viewModule() {},
        alerts: [],
        showAlert: text => ctx.alerts.push(text),
        callGemini: async () => { throw new Error('호출되면 안 됨'); },
        ...extra
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    FILES.forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), ctx));
    return ctx;
}

const plain = value => JSON.parse(JSON.stringify(value));

async function run(name, fn) {
    await fn();
    console.log('PASS', name);
}

const LESSON_MD = [
    '# 재미', '',
    '## 개요', '', '- 문제 상황을 다룹니다.', '',
    '## 학습 목표', '', '- 양식으로 기획서를 작성할 수 있습니다.', '- 기록으로 재미를 비교할 수 있습니다.', '',
    '## 재미의 구조', '', '- 구조를 다룹니다.', '',
    '## 구조 사례', '', '- 사례를 다룹니다.', '',
    '## 플레이 분석', '', '- 기록을 다룹니다.', '',
    '## ✅ 학습 후 체크리스트', '', '- 기획서를 설명합니다. (다시 보기: 재미의 구조)', '- 재미를 비교합니다. (다시 보기: 플레이 분석)'
].join('\n');

(async () => {
    const ctx = makeContext();
    const call = name => vm.runInContext(name, ctx);
    ctx.needsElementAutoAssign = () => false;

    await run('HTML 정리: 실행되는 주소를 막고 교안 주소는 남긴다', async () => {
        const safe = call('isSafeLessonUrl');
        ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', ' \njavascript:x', 'vbscript:x', 'data:text/html,<script>1</script>'].forEach(url => assert.strictEqual(safe(url), false, url));
        ['https://a.kr/b', 'http://a.kr', 'mailto:a@b.kr', '#section', './a.png', '문서.md', 'local:img_1', 'data:image/png;base64,AAAA', 'blob:http://a'].forEach(url => assert.strictEqual(safe(url), true, url));
    });

    await run('HTML 정리: 저장된 재생성 버튼은 값만 읽고 호출은 버린다', async () => {
        const args = text => plain(call('legacyRegenerateArgs')(text));
        assert.deepStrictEqual(args("promptRegenerateImage(this, '게임 화면', 'img_1')"), { keyword: '게임 화면', imgId: 'img_1' });
        assert.deepStrictEqual(args("promptRegenerateImage(this,'플레이어\\'s 화면',null)"), { keyword: "플레이어's 화면", imgId: '' });
        ["alert(1)", "promptRegenerateImage(this,'a');alert(1)", "promptRegenerateImage(this,'a\\', alert(1), 'b',null)", "promptRegenerateImage(this, 'a', 'b');fetch('x')", ''].forEach(code => assert.strictEqual(args(code), null, code));
    });

    await run('교안 버튼: 교안 영역 안의 data 동작만 실행한다', async () => {
        const calls = [];
        ctx.promptRegenerateImage = (button, keyword, imgId) => calls.push(['재생성', keyword, imgId]);
        ctx.deleteImage = imgId => calls.push(['삭제', imgId]);
        const button = (action, inView, dataset = {}) => ({ dataset: { lessonAction: action, ...dataset }, closest: selector => (selector === '#render-view' && !inView ? null : {}) });
        const click = target => call('onLessonActionClick')({ target: { closest: () => target } });
        click(button('regenerate-image', true, { keyword: '"><img src=x onerror=alert(1)>', imgId: 'img_1' }));
        click(button('delete-image', true, { imgId: 'img_2' }));
        click(button('delete-image', false, { imgId: 'img_3' }));
        click(button('없는 동작', true));
        click(null);
        assert.deepStrictEqual(calls, [['재생성', '"><img src=x onerror=alert(1)>', 'img_1'], ['삭제', 'img_2']]);
    });

    await run('진행 단계: 줄을 읽고 합계가 차시 시간이 된다', async () => {
        const flow = plain(call('parseFlowLines')('도입 | 문제 제시 | 10\n실습 | 만들기 | 30\n마무리 | 15\n\n정리 | 묶기 | -\n| | '));
        assert.deepStrictEqual(flow, [
            { phase: '도입', title: '문제 제시', minutes: 10 },
            { phase: '전개', title: '만들기', minutes: 30 },
            { phase: '전개', title: '마무리', minutes: 15 },
            { phase: '정리', title: '묶기', minutes: 5 }
        ]);
        assert.deepStrictEqual(plain(call('parseFlowLines')(call('flowLinesText')(flow))), flow, '다시 읽어도 같다');
        assert.deepStrictEqual(plain(call('lessonFlowPatch')(flow)), { flow, minutes: 60, hours: 1 });
        assert.deepStrictEqual(plain(call('lessonFlowPatch')([])), { flow: [] }, '비우면 시간을 건드리지 않는다');
        assert.ok(call('metaFlowNote')('도입 | 가 | 30', { hours: 1 }).includes('이 됩니다'));
        assert.ok(!call('metaFlowNote')('도입 | 가 | 60', { hours: 1 }).includes('이 됩니다'));
    });

    await run('학습 목표 세트: 추가하면 검수 지적이 늘지 않는다', async () => {
        const set = { objective: '표로 결과를 정리할 수 있습니다.', section: '## 결과 정리\n\n- 표를 다룹니다.', checklist: '결과를 정리합니다. (다시 보기: 결과 정리)' };
        const md = call('insertObjectiveSet')(LESSON_MD, set);
        const bullets = call('lessonLintBullets');
        assert.strictEqual(bullets(md, '학습\\s*목표').length, 3);
        assert.strictEqual(bullets(md, '학습\\s*후\\s*체크리스트').length, 3);
        assert.ok(md.indexOf('## 결과 정리') < md.indexOf('학습 후 체크리스트'));
        assert.ok(md.indexOf('## 결과 정리') > md.indexOf('## 플레이 분석'));
        assert.ok(md.includes('- 구조를 다룹니다.'), '기존 내용 유지');
        const bare = call('insertObjectiveSet')('# 제목\n\n본문입니다.', set);
        assert.ok(bare.indexOf('## 학습 목표') < bare.indexOf('## 결과 정리') && bare.indexOf('# 제목') === 0);
        assert.ok(bare.includes('## 학습 후 체크리스트'));
    });

    await run('학습 목표 세트: 다시 보기로 대응 섹션을 찾고 함께 지운다', async () => {
        const range = (md, index) => plain(call('objectiveContentRange')(md, index));
        assert.deepStrictEqual(range(LESSON_MD, 0).map(section => section.title), ['재미의 구조', '구조 사례'], '연속한 섹션 덩어리');
        assert.deepStrictEqual(range(LESSON_MD, 1).map(section => section.title), ['플레이 분석']);
        assert.deepStrictEqual(range(LESSON_MD.replace(/ \(다시 보기: [^)]+\)/g, ''), 0), [], '대응을 못 읽으면 고르지 않는다');
        const md = call('removeObjectiveSet')(LESSON_MD, 0, range(LESSON_MD, 0).map(section => section.index));
        const bullets = call('lessonLintBullets');
        assert.deepStrictEqual(plain(bullets(md, '학습\\s*목표')), ['기록으로 재미를 비교할 수 있습니다.']);
        assert.strictEqual(bullets(md, '학습\\s*후\\s*체크리스트').length, 1);
        assert.ok(!md.includes('## 재미의 구조') && md.includes('## 플레이 분석') && md.includes('## 개요'));
    });

    await run('학습 목표 세트: 같은 제목과 비슷한 제목의 섹션을 건드리지 않는다', async () => {
        const md = ['## 학습 목표', '', '- 첫째', '- 둘째', '', '## 사례', '', '- 앞 사례', '', '## 사례', '', '- 뒤 사례', '', '## 학습 목표별 실습', '', '- 실습 하나', '- 실습 둘', '', '## 학습 후 체크리스트', '', '- 확인 하나', '- 확인 둘'].join('\n');
        const sections = plain(call('objectiveContentSections')(md));
        assert.deepStrictEqual(sections.map(section => section.title), ['사례', '사례']);
        const removed = call('removeObjectiveSet')(md, 0, [sections[0].index]);
        assert.ok(!removed.includes('앞 사례') && removed.includes('뒤 사례'), '고른 위치의 섹션만 지운다');
        assert.ok(removed.includes('- 실습 하나') && removed.includes('- 실습 둘'), '접두사가 같은 섹션의 불릿은 남긴다');
        assert.ok(!removed.includes('- 첫째') && !removed.includes('- 확인 하나'));
        assert.strictEqual(call('withoutBullet')('- \n- 첫째\n- 둘째', 0), '- \n- 둘째', '빈 불릿은 세지 않는다');
    });

    await run('학습 목표 세트: 세부 불릿은 항목과 함께 움직인다', async () => {
        const text = '## 학습 목표\n\n- 첫째\n  - 세부\n- 둘째';
        assert.strictEqual(call('withoutBullet')(text, 0), '## 학습 목표\n\n- 둘째');
        assert.strictEqual(call('withBullet')(text, '셋째'), `${text}\n- 셋째`);
        assert.strictEqual(call('withBullet')('## 학습 목표', '첫째'), '## 학습 목표\n\n- 첫째');
    });

    await run('학습 목표 세트: 문항 연결 번호를 새 순서로 고친다', async () => {
        const question = (no, objective) => [`### 문제 ${no}. 문항${no}`, `학습 목표 ${objective} · 밴드 L1 · 객관식`, '', '내용', '', '① 가', '② 나', '③ 다', '④ 라', '', '✅ **정답:** ①', '', '---'].join('\n');
        const md = `${[question(1, 1), question(2, 2)].join('\n\n')}\n`;
        const remap = call('remappedAssessment');
        const before = ['가', '나'];
        const kept = remap(md, before, ['나'], false);
        const parse = text => plain(call('lessonLintQuestions')(text).map(call('parseQuestionBlock')));
        assert.deepStrictEqual(parse(kept).map(q => q.objective), [null, 1], '지운 목표는 연결만 해제, 뒤 번호는 당긴다');
        const dropped = parse(remap(md, before, ['나'], true));
        assert.deepStrictEqual(dropped.map(q => [q.title, q.objective]), [['문항2', 1]], '문항도 함께 삭제');
        assert.strictEqual(remap(md, before, before, false), md, '바뀐 번호가 없으면 그대로');
        const stray = `${question(1, 5)}\n`;
        assert.strictEqual(remap(stray, before, ['나'], true), stray, '번호가 어긋난 문항은 지우지 않는다');
    });

    await run('학습 목표 세트: AI 응답을 검증한다', async () => {
        assert.throws(() => call('parseObjectiveSet')({ objective: '가' }), /모두/);
        assert.strictEqual(call('parseObjectiveSet')({ objective: '가', section: '제목만', checklist: '나' }).section, '## 제목만');
    });

    await run('파일명: 위험한 글자를 빼고 겹치면 번호를 붙인다', async () => {
        const subject = { id: 's1', title: '게임 기획', namingConvention: 'GD/nn:교안', lessons: [{ id: 1, title: '재미' }, { id: 2, title: '분석' }] };
        ctx.globalState.subjects = [subject];
        ctx.courseData = subject.lessons;
        assert.strictEqual(call('lessonFileBase')({ id: 2, title: '분석' }, subject), 'GD_02_교안');
        const used = new ctx.Set();
        const unique = call('uniqueFileBase');
        assert.deepStrictEqual([unique('가', used), unique('가', used), unique('나', used)], ['가', '가_2', '나']);
    });

    await run('오늘의 퀘스트: 제출 파일명을 한 번만 넣는다', async () => {
        const subject = { id: 's1', title: '게임', lessons: [{ id: 1, title: '재미' }, { id: 2, title: '재미 분석: 플레이 로그와 사례' }] };
        ctx.globalState.subjects = [{ id: 's0', title: '앞', lessons: [] }, subject];
        ctx.courseData = subject.lessons;
        const name = call('questFileName')(subject.lessons[1], subject);
        assert.strictEqual(name, 'YYMMDD_2-2_재미분석플레이로그와사례_Ver0n_조or이름'.replace('재미분석플레이로그와사례', '재미분석플레이로그와사례'.slice(0, 12)));
        const md = call('withQuestFileName')('## 과제\n\n- 만듭니다.', subject.lessons[1], subject);
        assert.ok(md.includes(`\`${name}\``));
        assert.strictEqual(call('withQuestFileName')(md, subject.lessons[1], subject), md);
        assert.strictEqual(call('lintLessonMarkdown')(md, 'basicPrac').filter(issue => /버전/.test(issue.msg)).length, 0, '버전 규칙에 걸리지 않는다');
    });

    await run('교과 현황: 시간 비율과 배지', async () => {
        const subjects = [
            { id: 's1', title: '기획', ncs: { units: [{ code: 'a' }], confirmed: false }, lessons: [{ id: 1, title: '가', hours: 3, reviewStatus: '완료', gyosuan: { docMd: '#' } }, { id: 2, title: '나', hours: 3 }] },
            { id: 's2', title: '개발', ncs: { units: [{ code: 'b' }], confirmed: true }, lessons: [{ id: 3, title: '다', hours: 2 }] }
        ];
        ctx.globalState.subjects = subjects;
        ctx.courseData = subjects[0].lessons;
        ctx.globalState.courseDesign = { totalHours: 10 };
        const chips = call('subjectOverviewChips')(subjects[0]);
        ['75%', '교수안 1/2', 'NCS 1 확정 전', '완료 1/2'].forEach(text => assert.ok(chips.includes(text), text));
        assert.ok(call('subjectOverviewChips')(subjects[1]).includes('25%'));
        const bar = call('renderCourseTimeBar')();
        assert.ok(bar.includes('fitSubjectHours') && bar.includes('목표'), '목표와 다르면 맞추기 버튼을 보여 준다');
        ctx.globalState.courseDesign = { totalHours: 8 };
        assert.ok(!call('renderCourseTimeBar')().includes('fitSubjectHours'));
    });

    await run('교과 현황: 비율대로 맞추면 합계가 목표가 되고 진행 단계도 따라간다', async () => {
        const flow = [{ phase: '도입', title: '가', minutes: 60 }, { phase: '정리', title: '나', minutes: 120 }];
        const subjects = [
            { id: 's1', title: '기획', lessons: [{ id: 'mainQuest', title: '퀘스트' }, { id: 1, title: '가', hours: 3, flow }, { id: 2, title: '나', hours: 3 }] },
            { id: 's2', title: '개발', lessons: [{ id: 3, title: '다', hours: 2 }] }
        ];
        ctx.globalState.subjects = subjects;
        ctx.globalState.courseDesign = { totalHours: 16 };
        ctx.courseData = subjects[0].lessons;
        await call('applySubjectHours')();
        assert.strictEqual(call('courseLessonMinutes')(subjects[0]) + call('courseLessonMinutes')(subjects[1]), 960);
        assert.strictEqual(subjects[0].lessons[0].id, 'mainQuest', '메인 퀘스트는 그대로');
        assert.strictEqual(ctx.courseData, subjects[0].lessons, '현재 교과 목록도 함께 바뀐다');
        const lesson = subjects[0].lessons[1];
        assert.strictEqual(lesson.flow.reduce((sum, step) => sum + step.minutes, 0), call('lessonMinutes')(lesson));
    });

    await run('차시 구성: 잘못된 값은 저장 전에 막는다', async () => {
        ctx.globalState.subjects = [{ id: 's1', title: '기획', lessons: [{ id: 1, title: '가', hours: 1 }, { id: 2, title: '나', hours: 1 }] }];
        ctx.courseData = ctx.globalState.subjects[0].lessons;
        const problem = call('blockRowProblem');
        const lesson = ctx.courseData[0];
        assert.ok(problem({ lesson, title: '', hours: '1' }).includes('제목'));
        assert.ok(problem({ lesson, title: '나', hours: '1' }).includes('이미 있습니다'));
        const swap = [{ lesson, title: '나', hours: '1' }, { lesson: ctx.courseData[1], title: '가', hours: '1' }];
        assert.strictEqual(swap.map(row => problem(row, swap)).find(Boolean), undefined, '맞바꾸는 제목은 허용');
        const clash = [{ lesson, title: '새 제목', hours: '1' }, { lesson: ctx.courseData[1], title: '새 제목', hours: '1' }];
        assert.ok(clash.map(row => problem(row, clash)).find(Boolean).includes('이미 있습니다'), '한 번에 같은 새 제목으로 바꾸면 막는다');
        assert.ok(problem({ lesson, title: '가', hours: '-1' }).includes('0보다'));
        assert.strictEqual(problem({ lesson, title: '가', hours: '' }), '');
        const moved = plain(call('blockRowLesson')({ lesson, title: '새 제목', hours: '2' }));
        assert.deepStrictEqual([moved.title, moved.hours, moved.minutes], ['새 제목', 2, 120]);
        assert.strictEqual(call('blockRowLesson')({ lesson, title: '가', hours: '1' }), lesson, '바뀐 값이 없으면 그대로');
    });

    await run('NCS: 차시 요소에서 교과 후보가 올라온다', async () => {
        const subject = { id: 's1', title: '기획', lessons: [
            { id: 1, title: '가', ncsElements: [{ code: 'x.1', name: '요소', unitCode: 'U1', unitName: '단위' }, { code: 'x.2', name: '요소2', unitCode: 'U1', unitName: '단위' }] },
            { id: 2, title: '나', ncsElements: [{ code: 'x.3', name: '요소3', unitCode: 'U1', unitName: '단위' }, { name: '코드 없음' }] }
        ] };
        ctx.globalState.subjects = [subject];
        ctx.courseData = subject.lessons;
        const rows = plain(call('elementUnitRows')(subject));
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].code, 'U1');
        assert.ok(rows[0].reason.includes('가, 나'));
    });

    await run('기존 내용 보강: 대상을 고르고 실패와 중지를 모은다', async () => {
        const body = { basicLearn: LESSON_MD };
        const subject = { id: 's1', title: '기획', ncs: { autoTried: true }, lessons: [
            { id: 'mainQuest', title: '퀘스트', tabContents: body },
            { id: 1, title: '가', tabContents: body },
            { id: 2, title: '나', tabContents: body, ncsAutoTried: true, artAutoDone: true },
            { id: 3, title: '다', tabContents: {} }
        ] };
        ctx.globalState.subjects = [subject];
        ctx.courseData = subject.lessons;
        const withArt = plain(call('backfillWork')([subject], true));
        assert.deepStrictEqual(withArt.lessons.map(row => row.lesson.id), [1]);
        assert.strictEqual(withArt.units.length, 0, '이미 배정해 본 교과는 빼고');
        const work = call('backfillWork');
        assert.strictEqual(plain(work([{ ...subject, ncs: {} }], false)).units.length, 1, '처음 보는 교과는 넣는다');
        const order = [];
        const runner = call('runBackfillSteps');
        const live = { stopped: false };
        const report = plain(await runner([
            { label: '성공', task: async () => { order.push('성공'); } },
            { label: '실패', task: async () => { throw new Error('장애'); } },
            { label: '중지', task: async () => { live.stopped = true; } },
            { label: '남음', task: async () => { order.push('남음'); } }
        ], live, () => {}));
        assert.deepStrictEqual([report.done, report.failed[0].error, report.left], [2, '장애', 1]);
        assert.deepStrictEqual(order, ['성공']);
    });

    await run('기존 내용 보강: 삽화가 실패하면 다시 시도할 수 있다', async () => {
        const failing = { id: 1, title: '가', tabContents: { basicLearn: LESSON_MD } };
        ctx.suggestIllustrationIdeas = async () => [{ section: 0, description: '그림' }];
        ctx.drawLessonSvg = async () => { throw new Error('호출 한도'); };
        await assert.rejects(call('fillLessonArt')(failing, () => false), /호출 한도/);
        assert.strictEqual(call('lessonNeedsArt')(failing), true);
        await call('fillLessonArt')(failing, () => true);
        assert.strictEqual(call('lessonNeedsArt')(failing), true, '중지해도 다시 할 수 있다');
        ctx.suggestIllustrationIdeas = async () => [];
        await call('fillLessonArt')(failing, () => false);
        assert.strictEqual(call('lessonNeedsArt')(failing), false, '끝까지 돌면 다시 하지 않는다');
    });

    await run('일괄 생성: 교수안 옵션은 탭이 찬 차시도 넣고 교수안까지 만든다', async () => {
        const tabs = Object.fromEntries(TAB_IDS.map(id => [id, '내용']));
        const subject = { id: 's1', title: '기획', lessons: [{ id: 1, title: '가', tabContents: tabs }, { id: 2, title: '나', tabContents: tabs, gyosuan: { docMd: '#' } }] };
        ctx.globalState.subjects = [subject];
        ctx.courseData = subject.lessons;
        assert.strictEqual(plain(call('runnableLessons')([subject])).length, 0);
        assert.deepStrictEqual(plain(call('runnableLessons')([subject], true)).map(item => item.lessonId), [1]);
        const calls = [];
        ctx.runGyosuanGeneration = async (id, opts) => { calls.push(id); opts.onStatus('진행'); return { ok: true, partial: true, built: {}, draft: {} }; };
        const attempt = call('attemptLesson');
        const item = { subject, lessonId: 1, title: '가' };
        assert.deepStrictEqual(plain(await attempt(item, { stopped: false, withGyosuan: false })), { ok: true, partial: false });
        assert.deepStrictEqual(calls, [], '옵션을 끄면 부르지 않는다');
        assert.deepStrictEqual(plain(await attempt(item, { stopped: false, withGyosuan: true })), { ok: true, partial: true });
        assert.deepStrictEqual(calls, [1]);
        const stopped = plain(await attempt(item, { stopped: true, withGyosuan: true }));
        assert.strictEqual(stopped.ok, false);
        assert.strictEqual(stopped.stopped, true);
        await attempt({ ...item, lessonId: 2 }, { stopped: false, withGyosuan: true });
        assert.deepStrictEqual(calls, [1], '교수안이 있는 차시는 다시 만들지 않는다');
    });

    await run('교안 첫머리: 머리말의 목표·시간표·특징 목록과 이미지를 뺀다', async () => {
        const clean = call('cleanLessonOpening');
        const shot = ['- 기획의 본질을 설명할 수 있습니다.', '', '- **0분 ~ 60분** 게임 기획의 본질', '- **60분 ~ 120분** 기획자의 마인드셋', '', '- **게임 기획의 기초**', '    - 기초부터 접근합니다.', '', '<!-- [IMG: "lightbulb"] -->', '', '# 📝 1. 게임 기획의 본질과 역할', '', '## 학습 목표', '', '- 차이를 비교할 수 있습니다.', '', '## 개요', '', '- 문제 상황입니다.', '', '## 재미의 구조', '', '- 내용입니다.'].join('\n');
        const md = clean(shot);
        assert.ok(md.startsWith('# 📝 1. 게임 기획의 본질과 역할'), md.slice(0, 80));
        ['기획의 본질을 설명', '0분 ~ 60분', '게임 기획의 기초', 'IMG:'].forEach(text => assert.ok(!md.includes(text), text));
        assert.ok(md.includes('- 차이를 비교할 수 있습니다.') && md.includes('## 재미의 구조'));
    });

    await run('교안 첫머리: 개요에는 문제 상황만 남기고 본문 이미지는 그대로 둔다', async () => {
        const clean = call('cleanLessonOpening');
        const md = clean(['<!-- [IMG: "cover"] -->', '', '# 📝 재미', '', '<!-- [IMG: "title"] -->', '', '## 학습 목표', '', '<!-- [IMG: "goal"] -->', '- 비교할 수 있습니다.', '', '## 개요', '', '<!-- [IMG: "road"] -->', '- 문제 상황입니다.', '- **핵심 개념:**', '  - 정의를 다룹니다.', '', '**타임테이블**', '- 0~20분: 개념', '- 20~55분: 모델', '', '| 시간 | 주제 |', '|---|---|', '| 0~30분 | 개념 |', '', '## 재미의 구조', '', '<!-- [IMG: "body"] -->', '- 내용입니다.', '', '| 구분 | 설명 |', '|---|---|', '| 가 | 나 |'].join('\n'));
        ['cover', 'title', 'goal', 'road', '핵심 개념', '타임테이블', '0~20분', '0~30분'].forEach(text => assert.ok(!md.includes(text), text));
        ['# 📝 재미', '- 비교할 수 있습니다.', '- 문제 상황입니다.', '[IMG: "body"]', '| 구분 | 설명 |'].forEach(text => assert.ok(md.includes(text), text));
        assert.strictEqual(clean(md), md, '두 번 지나도 같다');
    });

    await run('교안 첫머리: 끝에 큰 제목이 붙은 교안을 머리말로 오해하지 않는다', async () => {
        const clean = call('cleanLessonOpening');
        const body = ['## 학습 목표', '', '- 비교할 수 있습니다.', '', '## 재미의 구조', '', '- 내용입니다.', '', '# ⚔️ 일일 퀘스트', '', '- 과제입니다.'].join('\n');
        assert.strictEqual(clean(body), body);
        const noGoalAfter = ['## 학습 목표', '', '- 비교할 수 있습니다.', '', '# 📝 재미', '', '## 구조', '', '- 내용입니다.'].join('\n');
        assert.ok(clean(noGoalAfter).includes('- 비교할 수 있습니다.'), '차시에 목표가 없으면 남긴다');
        const code = ['## 개요', '', '- 문제입니다.', '', '## 예시', '', '```md', '![그림](a.png)', '# 제목', '```'].join('\n');
        assert.strictEqual(clean(code), code, '코드 블록은 그대로');
    });

    await run('전체 생성: 빈 항목을 순서대로 만들고 문제은행까지 채운다', async () => {
        const goal = '- 비교할 수 있습니다.';
        const lesson = { id: 1, title: '재미', tabContents: { basicLearn: `## 학습 목표\n\n${goal}\n\n## 개요\n\n- 문제입니다.` } };
        const subject = { id: 's1', title: '기획', lessons: [lesson] };
        ctx.globalState.subjects = [subject];
        ctx.courseData = subject.lessons;
        const order = [];
        const options = [];
        ctx.generateTabContent = async (id, tabId, opts) => { order.push(tabId); options.push(opts); lesson.tabContents[tabId] = `## ${tabId}\n\n- 내용입니다.`; return { ok: true }; };
        ctx.runGyosuanGeneration = async () => { order.push('gyosuan'); lesson.gyosuan = { docMd: '#' }; return { ok: true }; };
        ctx.generateQuestions = async (mod, spec) => { order.push(`qbank:${spec.objective}`); return [{ no: 0, title: '문항', objective: spec.objective, band: 'L1', type: '객관식', typed: true, multi: false, stem: '내용', media: '', choices: [{ mark: '①', text: '가' }], answer: '①', accepted: '', hint: '', code: '', lang: '', explanation: '', rubric: '', tests: '', review: '' }]; };
        const toasts = [];
        ctx.showToast = text => toasts.push(text);
        await call('runLessonPipeline')(1);
        assert.deepStrictEqual(order, ['basicPrac', 'advLearn', 'advPrac', 'assessment', 'gyosuan', 'qbank:1']);
        assert.ok(options.every(opts => opts.background && opts.quiet), '화면을 막지 않는다');
        assert.ok(lesson.tabContents.assessment.includes('학습 목표 1'), '문제은행은 학습이해도 탭에 저장한다');
        assert.ok(lesson.history.some(row => row.note.includes('문제은행')));
        assert.ok(toasts.at(-1).includes('마쳤습니다'));
        assert.strictEqual(call('isLessonPipelineRunning')(), false);
        order.length = 0;
        const asked = [];
        ctx.confirmAsync = async message => { asked.push(message); return false; };
        await call('startLessonGeneration')(1);
        assert.deepStrictEqual(order, [], '빈 항목이 없으면 다시 만들지 않는다');
        assert.ok(asked[0].includes('모두 다시 만듭니다') && asked[0].includes('AI 호출 약'), '다시 만들기 전에 호출 수를 보인다');
    });

    await run('전체 생성: 실패한 항목을 건너뛰고 끝까지 간 뒤 알린다, 중지하면 멈춘다', async () => {
        const lesson = { id: 1, title: '재미', tabContents: {} };
        ctx.globalState.subjects = [{ id: 's1', title: '기획', lessons: [lesson] }];
        ctx.courseData = ctx.globalState.subjects[0].lessons;
        const order = [];
        ctx.generateTabContent = async (id, tabId) => { order.push(tabId); if (tabId === 'basicPrac') throw new Error('호출 한도'); lesson.tabContents[tabId] = '- 내용'; return { ok: true }; };
        ctx.runGyosuanGeneration = async () => { order.push('gyosuan'); return { ok: false, error: '교수안 실패' }; };
        ctx.alerts.length = 0;
        await call('runLessonPipeline')(1);
        assert.deepStrictEqual(order, ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment'], '교안 탭이 빠지면 교수안과 문제은행을 만들지 않는다');
        assert.ok(ctx.alerts.at(-1).includes('호출 한도') && ctx.alerts.at(-1).includes('교수안·슬라이드'));
        const stopped = { id: 1, title: '재미', tabContents: {} };
        ctx.globalState.subjects = [{ id: 's1', title: '기획', lessons: [stopped] }];
        ctx.courseData = ctx.globalState.subjects[0].lessons;
        order.length = 0;
        ctx.generateTabContent = async (id, tabId) => { order.push(tabId); call('requestLessonPipelineStop')(); return { ok: true }; };
        await call('runLessonPipeline')(1);
        assert.deepStrictEqual(order, ['basicLearn'], '다음 항목으로 넘어가지 않는다');
    });

    await run('전체 생성: 일부 누락과 교과 이동을 성공으로 보고하지 않는다', async () => {
        const toasts = [];
        ctx.showToast = text => toasts.push(text);
        const partial = { id: 1, title: '재미', tabContents: {} };
        ctx.globalState.subjects = [{ id: 's1', title: '기획', lessons: [partial] }];
        ctx.courseData = ctx.globalState.subjects[0].lessons;
        ctx.alerts.length = 0;
        ctx.generateTabContent = async (id, tabId) => { partial.tabContents[tabId] = '- 내용'; return { ok: true, partial: tabId === 'advLearn' }; };
        ctx.runGyosuanGeneration = async () => { partial.gyosuan = { docMd: '#' }; return { ok: true }; };
        await call('runLessonPipeline')(1);
        assert.ok(ctx.alerts.at(-1).includes('빠졌을 수 있는 항목') && ctx.alerts.at(-1).includes('advLearn'));
        const moved = { id: 2, title: '이동', tabContents: {} };
        ctx.globalState.subjects = [{ id: 's1', title: '기획', lessons: [moved] }];
        ctx.courseData = ctx.globalState.subjects[0].lessons;
        ctx.generateTabContent = async () => { ctx.currentSubjectId = 's2'; return { ok: true }; };
        await call('runLessonPipeline')(2);
        ctx.currentSubjectId = 's1';
        assert.ok(ctx.alerts.at(-1).includes('다른 교과로 옮기거나'));
        assert.strictEqual(toasts.length, 0, '성공 알림을 띄우지 않는다');
    });

    await run('전체 생성: 교안 뒤에 삽화와 NCS 요소를 채우고 실패해도 잇는다', async () => {
        const lesson = { id: 1, title: '재미', tabContents: Object.fromEntries(TAB_IDS.map(id => [id, LESSON_MD])) };
        ctx.globalState.subjects = [{ id: 's1', title: '기획', lessons: [lesson] }];
        ctx.courseData = ctx.globalState.subjects[0].lessons;
        ctx.globalState.courseDesign = { autoArt: true };
        ctx.alerts.length = 0;
        const order = [];
        const original = { art: ctx.fillLessonArt, assign: ctx.assignLessonElements, gyosuan: ctx.runGyosuanGeneration, questions: ctx.generateQuestions };
        ctx.needsElementAutoAssign = () => !order.includes('ncs');
        ctx.fillLessonArt = async mod => { order.push('art'); mod.artAutoDone = true; };
        ctx.assignLessonElements = async () => { order.push('ncs'); throw new Error('호출 한도'); };
        ctx.runGyosuanGeneration = async () => { order.push('gyosuan'); lesson.gyosuan = { docMd: '#' }; return { ok: true }; };
        ctx.generateQuestions = async () => { order.push('qbank'); return []; };
        await call('runLessonPipeline')(1);
        assert.deepStrictEqual(order.slice(0, 3), ['art', 'ncs', 'gyosuan'], 'NCS 요소가 교수안 프롬프트에 들어가도록 먼저 만든다');
        assert.strictEqual(order[3], 'qbank');
        assert.ok(ctx.alerts.at(-1).includes('NCS 요소 배정: 호출 한도'));
        order.length = 0;
        ctx.needsElementAutoAssign = () => !order.includes('ncs');
        lesson.gyosuan = null;
        lesson.artAutoDone = false;
        ctx.globalState.courseDesign = {};
        const toasts = [];
        ctx.showToast = text => toasts.push(text);
        await call('runLessonExtras')(1, { isStopped: () => false, onStatus() {} });
        assert.deepStrictEqual(order, ['ncs'], '삽화는 켠 경우에만 그린다');
        assert.ok(toasts[0].includes('NCS 요소 배정 실패: 호출 한도'), '일괄 생성은 실패를 안내만 하고 잇는다');
        order.length = 0;
        ctx.needsElementAutoAssign = () => true;
        ctx.assignLessonElements = async () => { order.push('ncs'); };
        ctx.fillMissingTabs = async () => ({ ok: true });
        const queue = { subject: ctx.globalState.subjects[0], lessonId: 1, title: '재미' };
        const stopping = { stopped: true, withGyosuan: false };
        const stopped = await call('attemptLesson')(queue, stopping);
        assert.strictEqual(stopped.stopped, true, '보강 중 중지하면 완료로 세지 않는다');
        Object.assign(ctx, { fillLessonArt: original.art, assignLessonElements: original.assign, runGyosuanGeneration: original.gyosuan, generateQuestions: original.questions, needsElementAutoAssign: () => false });
    });

    await run('NCS 요소 배정: 호출이 실패하면 다음에 다시 시도한다', async () => {
        const lesson = { id: 1, title: '재미' };
        const original = ctx.recommendLessonElements;
        ctx.recommendLessonElements = async () => { throw new Error('호출 한도'); };
        await assert.rejects(call('assignLessonElements')({ id: 's1' }, lesson));
        assert.strictEqual(lesson.ncsAutoTried, false);
        ctx.recommendLessonElements = original;
    });

    await run('차시 정보: NCS 요소를 직접 찾는다', async () => {
        const [unit, other] = plain(call('ncsSearch')('게임 기획', 2));
        ctx.globalState.ncsElements = { [unit.code]: [{ code: 'E1', name: '재미 요소 분석하기' }] };
        const search = query => plain(call('searchElementOptions')(query));
        assert.deepStrictEqual(search('   '), []);
        const byName = search('재미 요소').find(option => option.code === 'E1');
        assert.strictEqual(byName.unitCode, unit.code);
        assert.ok(!byName.unitLevel);
        assert.strictEqual(search(other.code)[0].code, other.code, '코드를 넣으면 그 단위가 먼저');
        assert.strictEqual(search(other.code)[0].unitLevel, true, '요소가 없으면 능력단위 수준');
        delete ctx.globalState.ncsElements;
    });

    await run('일괄 생성 덮어쓰기: 비우기 전에 차시를 통째로 휴지통에 넣고(작업 기록은 쓰지 않음) 재시도에서는 다시 지우지 않는다', async () => {
        const lesson = {
            id: 1, title: '재미', content: LESSON_MD, tabContents: Object.fromEntries(TAB_IDS.map(id => [id, LESSON_MD])), images: { a: 'data:a', b: 'data:b' },
            gyosuan: { docMd: '# 교수안\n\n![도표](local:g)', deckMd: '# 편성안', deckHtml: '<section>고친 화면</section>', sessionDecks: { 1: '<section>1차시</section>' }, images: { g: 'data:g' } },
            illustrations: [{ id: 'ill_1', svg: '<svg></svg>' }], artAutoDone: true, whiteboardVideos: { a: { id: 'wb_1', title: '판서', ext: 'mp4', at: 1 } }, questions: []
        };
        const subject = { id: 's1', title: '기획', lessons: [lesson] };
        const kept = { design: ctx.globalState.courseDesign, trash: ctx.globalState.lessonTrash };
        ctx.globalState.subjects = [subject];
        ctx.globalState.lessonTrash = [];
        ctx.globalState.courseDesign = { autoArt: true };
        ctx.courseData = subject.lessons;
        assert.strictEqual(plain(call('runnableLessons')([subject])).length, 0, '모두 만들었으면 평소에는 대기열이 없다');
        assert.strictEqual(call('runnableLessons')([subject], true, true).length, 1, '덮어쓰기면 대기열에 넣는다');
        const archived = [];
        const original = { archive: ctx.archiveContents, fill: ctx.fillMissingTabs, locked: ctx.lockedSectionBlocks };
        ctx.archiveContents = async list => { archived.push(...list); };
        ctx.lockedSectionBlocks = (mod, tabId) => (tabId === 'basicLearn' && mod.tabContents?.basicLearn ? ['고정 섹션'] : []);
        let fills = 0;
        let locked = null;
        ctx.fillMissingTabs = async (id, opts) => { fills += 1; locked = opts.lockedByTab; if (fills === 1) lesson.tabContents.basicLearn = '새 내용'; return { ok: false, error: '한도' }; };
        const run = { stopped: false, withGyosuan: true, overwrite: true, cleared: new Map(), trashed: 0 };
        const item = { subject, lessonId: 1, title: '재미' };
        const before = plain(lesson);
        await call('attemptLesson')(item, run);
        const trash = ctx.globalState.lessonTrash;
        assert.strictEqual(trash.length, 1);
        assert.deepStrictEqual(plain(trash[0].lesson), before, '탭·교수안과 슬라이드 화면 편집·그림·삽화·판서 영상 연결까지 그대로');
        assert.deepStrictEqual([trash[0].subjectId, trash[0].reason, trash[0].kind], ['s1', '다시 만들기 전', 'rewrite']);
        assert.strictEqual(run.trashed, 1);
        assert.deepStrictEqual(archived, [], '작업 기록 칸을 쓰지 않는다(200개 상한에 밀리지 않게)');
        assert.strictEqual(lesson.gyosuan, null);
        assert.deepStrictEqual(plain(lesson.images), {});
        assert.deepStrictEqual(plain(lesson.illustrations), [], '삽화를 켰으면 다시 그린다');
        assert.strictEqual(lesson.history[0].note, '일괄 생성으로 내용을 다시 만듦(이전 내용은 휴지통)');
        lesson.tabContents.basicPrac = '바뀐 글';
        assert.strictEqual(trash[0].lesson.tabContents.basicPrac, LESSON_MD, '사본은 지금 차시와 이어지지 않는다');
        assert.deepStrictEqual(plain(locked.basicLearn), ['고정 섹션'], '고정 섹션은 비우기 전에 챙긴다');
        await call('attemptLesson')(item, run);
        assert.strictEqual(lesson.tabContents.basicLearn, '새 내용', '재시도는 먼저 만든 탭을 지우지 않는다');
        assert.deepStrictEqual([ctx.globalState.lessonTrash.length, run.trashed], [1, 1], '재시도는 사본을 또 넣지 않는다');
        assert.deepStrictEqual(plain(locked.basicLearn), ['고정 섹션'], '재시도에도 고정 섹션을 넘긴다');
        const legacy = { id: 2, title: '옛 차시', content: '옛 본문입니다.', tabContents: null, images: { x: 'data:x' } };
        subject.lessons.push(legacy);
        await call('attemptLesson')({ subject, lessonId: 2, title: '옛 차시' }, { ...run, withGyosuan: false });
        const legacyCopy = ctx.globalState.lessonTrash[0].lesson;
        assert.deepStrictEqual([legacyCopy.id, legacyCopy.content, legacyCopy.tabContents], [2, '옛 본문입니다.', null], '옛 단일 본문은 탭으로 옮기기 전 그대로 남긴다');
        assert.deepStrictEqual(plain(legacy.images), { x: 'data:x' }, '교수안까지 만들지 않으면 그림은 차시에 그대로 둔다');
        assert.strictEqual(legacy.content, null);
        const blank = { id: 3, title: '빈 차시', content: null, tabContents: { basicLearn: null }, images: {} };
        subject.lessons.push(blank);
        await call('attemptLesson')({ subject, lessonId: 3, title: '빈 차시' }, run);
        assert.strictEqual(ctx.globalState.lessonTrash.length, 2, '비울 것이 없는 차시는 휴지통에 넣지 않는다');
        assert.strictEqual(blank.history[0].note, '일괄 생성으로 내용을 다시 만듦');
        assert.deepStrictEqual(archived, []);
        Object.assign(ctx.globalState, { courseDesign: kept.design, lessonTrash: kept.trash });
        Object.assign(ctx, { archiveContents: original.archive, fillMissingTabs: original.fill, lockedSectionBlocks: original.locked });
    });

    await run('과정 설계: 단원명과 블록을 초안에서 고친다', async () => {
        const draft = { units: [{ title: '단원', hours: 2, modules: [{ title: '블록', minutes: 120, objectives: [], flow: [], isDefault: true }] }] };
        const named = call('setDesignUnitTitle')(draft, 0, ' 새 단원 ');
        assert.strictEqual(named.units[0].title, '새 단원');
        assert.strictEqual(call('setDesignUnitTitle')(draft, 0, '  ').units[0].title, '단원', '빈 제목은 되돌린다');
        assert.strictEqual(draft.units[0].title, '단원', '초안을 바꾸지 않고 새로 돌려준다');
        const added = call('designEditAction')(draft, 'add-block', { unit: '0' });
        assert.strictEqual(added.units[0].modules.length, 2);
        assert.strictEqual(call('designFlowMatches')(added.units[0].modules[1]), true);
        assert.strictEqual(added.edited, true);
        const kept = call('designEditAction')(added, 'del-block', { unit: '0', module: '1' });
        assert.strictEqual(kept.units[0].modules[0].isDefault, false, '지운 블록이 시간 맞추기로 되살아나지 않는다');
        const removed = call('designEditAction')(added, 'del-block', { unit: '0', module: '0' });
        assert.deepStrictEqual(plain(removed.units[0].modules).map(block => block.title), ['새 블록']);
        assert.strictEqual(call('designEditAction')(removed, 'del-block', { unit: '0', module: '0' }).units[0].modules.length, 1, '마지막 블록은 지우지 않는다');
        const html = call('designUnitHtml')({ ...draft.units[0], title: '"><script>' }, 0);
        assert.ok(!html.includes('"><script>') && html.includes('data-design-action="add-block"') && html.includes('data-design-action="del-block"'));
    });

    await run('참고 파일: 그 차시의 프롬프트에만 붙는다', async () => {
        const originalRead = ctx.extractTextFromFile;
        ctx.extractTextFromFile = async file => `${file.name} 본문`;
        ctx.currentEditingModuleId = 1;
        const input = { files: [{ name: 'a.md' }, { name: 'b.md' }, { name: 'c.md' }, { name: 'd.md' }], value: 'x' };
        const toasts = [];
        ctx.showToast = text => toasts.push(text);
        await call('addLessonAttachments')({ target: input });
        const prompt = call('lessonAttachmentPrompt');
        assert.ok(prompt(1).includes('### a.md\na.md 본문') && prompt(1).includes('c.md') && !prompt(1).includes('d.md'), '3개까지만 붙인다');
        assert.ok(toasts[0].includes('3개'));
        assert.strictEqual(prompt(2), '', '다른 차시에는 붙지 않는다');
        assert.strictEqual(input.value, '');
        call('onLessonAttachmentClick')({ target: { dataset: { attachRemove: '0' } } });
        assert.ok(!prompt(1).includes('a.md') && prompt(1).includes('b.md'));
        ctx.extractTextFromFile = originalRead;
    });

    await run('화면: 입력칸은 모두 어딘가에서 읽고 히스토리 패널은 hidden으로 여닫는다', async () => {
        const html = fs.readFileSync(path.join(root, '..', 'index.html'), 'utf8');
        const js = fs.readdirSync(root).filter(file => file.endsWith('.js')).map(file => fs.readFileSync(root + file, 'utf8')).join(' ');
        const fields = [...html.matchAll(/<(?:input|textarea|select)\s[^>]*>/g)].map(match => match[0]);
        const unread = fields.filter(tag => !/\son\w+=/.test(tag)).map(tag => tag.match(/\sid="([^"]+)"/)?.[1]).filter(Boolean)
            .filter(id => !js.includes(id) && html.split(id).length <= 2);
        assert.ok(fields.length > 10, '입력칸을 실제로 찾았는지 확인한다');
        assert.deepStrictEqual(unread, [], '입력해도 아무도 읽지 않는 칸이 있으면 안 된다');
        const state = fs.readFileSync(root + 'state.js', 'utf8');
        assert.ok(/<aside id="history-panel"\s+class="hidden /.test(html));
        assert.ok(/function toggleHistoryPanel[\s\S]{0,400}classList\.remove\('hidden'\)/.test(state), '패널이 hidden이면 여는 코드가 그것을 지워야 보인다');
    });

    await run('생성 프롬프트: 기본학습 경로에 체크리스트 규칙, 학습이해도에 밴드별 유형을 준다', async () => {
        const ui = fs.readFileSync(root + 'ui.js', 'utf8');
        assert.ok(/learning && r\.learning_checklist/.test(ui));
        assert.ok(/case 'module':[\s\S]{0,300}buildFullRules\([^)]*, true\)/.test(ui), '교안 생성(기본학습)은 체크리스트를 쓰게 한다');
        assert.ok(/case 'module_continue':[\s\S]{0,300}buildFullRules\([^)]*, true\)/.test(ui), '이어쓰기에도 같은 규칙을 준다');
        assert.ok(/case 'main_quest':[\s\S]{0,300}buildFullRules\(\)/.test(ui), '메인 퀘스트에는 체크리스트를 요구하지 않는다');
        const data = fs.readFileSync(root + 'data.js', 'utf8');
        assert.ok(data.includes('L1은 객관식이나 단답식, L2는 서술형이나 코드제출, L3는 파일제출'));
        assert.ok(call('LESSON_QUESTION_LABEL').test('학습 목표 2 · 밴드 L2 · 서술형'), '프롬프트 예시 표기를 검수기가 읽는다');
        assert.ok(!ui.includes('5지선다 객관식 10문제'), '학습이해도를 객관식 10문제로 묶지 않는다 (밴드별 유형, 목표 수와 충돌)');
        assert.ok(/case 'tab_content_continue':[\s\S]{0,600}buildTabRules\(additionalContext\.tabId/.test(ui), '탭 이어쓰기도 탭 규칙을 받는다');
        assert.ok(/case 'tab_content_continue':[\s\S]{0,2000}학습 후 체크리스트"는 모든 본문 섹션을 다 쓴 뒤/.test(ui), '체크리스트는 맨 끝에 한 번만');
        assert.ok(/case 'tab_content_continue':[\s\S]{0,2600}지금까지 쓴 ## 제목/.test(ui), '쓴 제목 목록을 준다');
        const html = fs.readFileSync(path.join(root, '..', 'index.html'), 'utf8');
        assert.ok(html.includes('id="settings-image-amount"') && html.includes("populateModelSelect('settings-image-amount'"), '설정에서 교안 이미지 양을 고른다');
        assert.ok(ui.includes('학습 목표 2 · 밴드 L2 · 서술형') && ui.includes('학습 목표 1 · 밴드 L1 · 객관식'), '예시가 밴드별 유형을 따른다');
    });

    await run('역할별 AI 분배: 켠 경우에만 나누고 교차 검수는 다른 공급자가 맡는다', async () => {
        const model = call('roleModel');
        const cross = call('crossCheckModel');
        const update = call('updateRoleRouting');
        ctx.claudeApiKey = 'test-placeholder';
        assert.strictEqual(model('write'), 'gemini-4-argon', '끄면 고른 모델');
        update(true);
        assert.strictEqual(model('write'), 'claude-opus-5-5');
        assert.strictEqual(model(undefined), 'claude-opus-5-5', '역할을 적지 않으면 본문 작성');
        assert.strictEqual(model('qgen'), 'gemini-4-argon');
        assert.strictEqual(cross('qgen'), 'claude-opus-5-5', '문항은 Gemini가 쓰고 Claude가 검수');
        assert.strictEqual(cross('plan'), 'gemini-4-argon', '구조는 Claude가 쓰고 Gemini가 교차 판단');
        assert.ok(call('roleRouteNote')().includes('claude-opus-5-5: 구조 설계·본문 작성·교차 검수'));
        ctx.TEXT_MODEL = 'claude-sonnet-5-5';
        assert.strictEqual(model('write'), 'claude-sonnet-5-5', '같은 공급자 몫은 고른 모델');
        assert.strictEqual(model('fast'), 'gemini-4-argon');
        ctx.claudeApiKey = '';
        ctx.TEXT_MODEL = 'gemini-4-argon';
        assert.strictEqual(model('write'), 'gemini-4-argon', '키가 하나면 나누지 않는다');
        assert.ok(call('roleRouteNote')().includes('모두 저장하면'));
        update(false);
    });

    await run('전체 생성: 교수안이 실패해도 문제은행은 만든다', async () => {
        const lesson = { id: 1, title: '재미', tabContents: { basicLearn: '## 학습 목표\n\n- 비교할 수 있습니다.', basicPrac: '- 내용', advLearn: '- 내용', advPrac: '- 내용', assessment: '- 내용' } };
        ctx.globalState.subjects = [{ id: 's1', title: '기획', lessons: [lesson] }];
        ctx.courseData = ctx.globalState.subjects[0].lessons;
        ctx.alerts.length = 0;
        ctx.runGyosuanGeneration = async () => ({ ok: false, error: '호출 한도' });
        const asked = [];
        ctx.generateQuestions = async (mod, spec) => { asked.push(spec.objective); return []; };
        await call('runLessonPipeline')(1);
        assert.deepStrictEqual(asked, [1]);
        assert.ok(ctx.alerts.at(-1).includes('호출 한도') && !ctx.alerts.at(-1).includes('건너뛴'));
    });

    await run('전체 생성: 만드는 차시에만 진행 표시를 한다', async () => {
        ctx.globalState.subjects = [{ id: 's1', title: '기획', lessons: [{ id: 1, title: '재미', tabContents: {} }] }];
        ctx.courseData = ctx.globalState.subjects[0].lessons;
        call('beginLessonPipeline')(1);
        assert.strictEqual(call('isPipelineStep')('basicLearn', 1), true);
        assert.strictEqual(call('isPipelineStep')('basicLearn', 2), false);
        assert.strictEqual(call('isLessonPipelineRunning')(2), false);
        assert.strictEqual(call('isLessonPipelineRunning')(), true);
        call('finishLessonPipeline')({ quiet: true });
        assert.strictEqual(call('isLessonPipelineRunning')(), false);
    });

    await run('교안 첫머리: 본문의 표·코드·간격과 정상 이미지는 그대로 둔다', async () => {
        const clean = call('cleanLessonOpening');
        const body = ['## 재미의 구조', '', '| A | 첫 문단<br><br>둘째 |', '|---|---|', '| 1 | 2 |', '', '<br><br>', '', '```html', '<p>a<br><br>b</p>', '```', '', '- 항목<br><br>- 항목', '', '![그림](local:img_1)', '', '# ⚔️ 일일 퀘스트', '', '- 과제입니다.'].join('\n');
        assert.strictEqual(clean(body), body);
        const steps = ['# 실습', '', '### Step 1', '', '![그림](local:img_1)', '', '### Step 2', '', '<!-- [IMG: "둘째"] -->', '', '- 내용입니다.'].join('\n');
        assert.strictEqual(clean(steps), steps, '내용이 시작된 뒤의 이미지는 본문이다');
        const fenced = ['## 학습 목표', '', '- 비교할 수 있습니다.', '', '```md', '![그림](a.png)', '```'].join('\n');
        assert.strictEqual(clean(fenced), fenced, '코드 블록 안은 이미지가 아니다');
    });

    await run('교안 첫머리: 개요의 정상 내용을 지우지 않는다', async () => {
        const clean = call('cleanLessonOpening');
        assert.ok(clean('<br>\n\n<br/>\n## 학습 목표\n\n- 비교할 수 있습니다.').startsWith('## 학습 목표'), '첫 제목 앞의 빈 간격을 뺀다');
        const keep = text => assert.ok(clean(['## 개요', '', ...text].join('\n')).includes(text[0]), text[0]);
        keep(['- 5~10분 안에 장애 원인을 찾아야 합니다.']);
        keep(['| 구분 | 설명 |', '|---|---|', '| 가 | 나 |']);
        keep(['| 응답 시간 | 설명 |', '|---|---|', '| 2초 | 나 |']);
        keep(['| 분류 | 설명 |', '|---|---|', '| 가 | 나 |']);
        keep(['| 시간복잡도 | 설명 |', '|---|---|', '| O(n) | 나 |']);
        assert.ok(!clean(['## 개요', '', '| 시간 | 주제 |', '|---|---|', '| 0~30분 | 개념 |', '', '## 구조', '', '- 내용입니다.'].join('\n')).includes('## 개요'), '시간표뿐인 개요는 제목도 뺀다');
        keep(['- **문제 상황**', '    - 응답이 2배로 늘어납니다.']);
        const coded = ['## 개요', '', '- 문제입니다.', '', '```text', '- 0~10분: 준비', '| 시간 | 주제 |', '```'].join('\n');
        assert.strictEqual(clean(coded), coded);
    });

    await run('교육 자료 양식: 강사 전용 내용과 옛 첫머리를 내보내지 않는다', async () => {
        const basic = ['## 개요', '', '- 문제입니다.', '- 0~20분: 개념', '', '## 구조', '', '- 내용입니다.', '', '<div class="instructor-callout">강사 전용</div>', '', '```text', 'a', '', '', 'b', '```'].join('\n');
        const lesson = { id: 1, title: '재미', hours: 1, tabContents: { basicLearn: basic } };
        const subject = { id: 's1', title: '기획', lessons: [lesson] };
        ctx.globalState.subjects = [subject];
        ctx.courseData = subject.lessons;
        const md = call('materialDocMd')(subject, [lesson]);
        assert.ok(!md.includes('강사 전용') && !md.includes('0~20분'));
        assert.ok(md.includes('a\n\n\nb'), '코드의 빈 줄은 그대로');
    });

    await run('교육 자료 양식: 탭 마크다운을 내보낼 때만 바꾼다', async () => {
        const basic = ['# 재미', '', '## 학습 목표', '', '- 비교할 수 있습니다.', '', '## 개요', '', '- 문제 상황입니다.', '', '## 재미의 구조 (⏱ 30분)', '', '- 코어 루프: 반복 구조입니다.', '', '### 사례', '', '- 내용입니다. ![그림](local:img_1)', '', '```md', '## 코드 속 제목', '- 용어: 설명', '```', '', '## ✅ 학습 후 체크리스트', '', '- 비교합니다. (다시 보기: 재미의 구조)'].join('\n');
        const lesson = { id: 1, title: '재미 분석', hours: 1, tools: [{ name: '엑셀', version: '365' }], images: { img_1: 'data:image/png;base64,AAAA' }, tabContents: { basicLearn: basic, basicPrac: '## 과제\n\n- 만듭니다.', advLearn: '## 심화 주제\n\n- 심화입니다.', advPrac: null, assessment: '### 문제 1. 비밀\n\n정답 표기' } };
        const subject = { id: 's1', title: '기획', lessons: [lesson] };
        ctx.globalState.subjects = [subject];
        ctx.globalState.courseTitle = '게임 과정';
        ctx.courseData = subject.lessons;
        const before = JSON.stringify(lesson);
        const md = call('materialDocMd')(subject, [lesson], [subject]);
        ['# 📝 기획', '## 게임 과정 교육 목차', '| 기획 | 재미 분석 |', '## 사용 툴 버전', '- 엑셀 : 365', '## 재미 분석', '### ■ 재미의 구조', '- **코어 루프** | 반복 구조입니다.', '#### ▣ 사례', '### ■ 심화 학습: 심화 주제', '- [ ] 비교합니다. → 다시 보기: 재미의 구조', '### ■ ❗오늘의 퀘스트(기본 실습)', '#### ▣ 과제', '(data:image/png;base64,AAAA)', '- 용어: 설명', '## 코드 속 제목'].forEach(text => assert.ok(md.includes(text), text));
        assert.ok(!md.includes('비밀'), '학습이해도 문항과 정답은 넣지 않는다');
        assert.ok(!md.includes('⏱'));
        assert.ok(md.includes('<!--\n차시 정보') && md.includes('예상 소요 시간: 1시간'));
        assert.strictEqual(JSON.stringify(lesson), before, '저장된 교안은 그대로');
        const course = call('materialCourseMd')();
        assert.ok(course.includes('교육 목차') && course.includes('## 재미 분석'));
    });

    await run('문항 검수: develocket-slide의 문항 규칙을 모두 본다', async () => {
        const check = (over, count) => plain(call('lintQuestion')({ title: '문항', stem: '재미의 근거는 무엇입니까?', objective: 1, band: 'L1', type: '객관식', typed: true, multi: false, choices: ['가', '나', '다', '라'].map((text, i) => ({ mark: '①②③④'[i], text })), answer: '①', rubric: '', tests: '', review: '', ...over }, [], count));
        assert.deepStrictEqual(check({}), []);
        assert.ok(check({ stem: '여러분은 무엇을 고릅니까?' }).includes('학습자를 호칭하지 않습니다.'));
        assert.ok(check({ stem: 'Ctrl+S는 무엇입니까?' }).includes('버전에 의존하는 정보를 쓰지 않습니다.'));
        assert.ok(check({ choices: [{ mark: '①', text: '버전 3 기능' }, { mark: '②', text: '나' }, { mark: '③', text: '다' }, { mark: '④', text: '라' }] }).includes('버전에 의존하는 정보를 쓰지 않습니다.'));
        assert.ok(check({ choices: [{ mark: '①', text: '' }, { mark: '②', text: '나' }, { mark: '③', text: '다' }, { mark: '④', text: '라' }] }).includes('빈 보기를 두지 않습니다.'));
        assert.deepStrictEqual(check({ multi: true, answer: '①, ②' }), [], '제목의 (복수정답) 표기가 복수 선택을 알린다');
        assert.ok(check({ type: '서술형', band: 'L2', rubric: '요소를 설명함' }).includes('채점 요소마다 점수를 적습니다.'));
        assert.deepStrictEqual(check({ type: '서술형', band: 'L2', rubric: '요소를 설명함 (10점)', choices: [] }), []);
        assert.ok(check({ objective: 3 }, 2).includes('대응하는 학습 목표가 없습니다.'));
        assert.deepStrictEqual(check({ objective: 3 }), [], '목표 수를 모르면 번호 범위는 보지 않는다');
    });

    await run('일괄 생성: 안내 화면에 옵션이 보인다', async () => {
        const html = call('lessonRunIntroHtml')([], [], true);
        assert.ok(html.includes('lesson-run-gyosuan') && /id="lesson-run-gyosuan" type="checkbox" checked/.test(html));
        assert.ok(html.includes('생성할 차시가 없습니다'));
    });

    console.log('ALL PASSED');
})().catch(err => {
    console.error('FAIL', err);
    process.exit(1);
});
