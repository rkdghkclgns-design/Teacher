// 사이드바 교과 목록 테스트 (실행: node tests/sidebar-list.test.js)
// 교과가 많아도 교과 카드가 눌려 접히지 않고, 과정 시간 막대의 번호가 잘리지 않는지 실제 파일로 확인한다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// 파일에서 함수 하나만 잘라 싣는다(ui.js·course-meta.js는 화면 요소가 있어야 통째로 실린다)
function sliceFunction(source, head) {
    const text = source.replace(/\r\n/g, '\n');
    const at = text.indexOf(head);
    assert.ok(at >= 0, `${head}을 찾지 못함`);
    return text.slice(at, text.indexOf('\n}\n', at) + 2);
}

function makeContext(count) {
    const list = { innerHTML: '' };
    const subjects = Array.from({ length: count }, (_, i) => ({
        id: `s${i + 1}`, title: `교과 제목 ${i + 1}번`, lessons: [{ id: i + 1, title: `차시 ${i + 1}`, hours: 8 }]
    }));
    const ctx = {
        list,
        globalState: { courseTitle: '게임 네트워크 기초', subjects, lessonTrash: [{}, {}] },
        document: { getElementById: id => (id === 'overview-lnb-list' ? list : null) },
        // 화면과 상관없는 계산은 단순한 스텁으로 둔다
        subjectLessons: subject => subject.lessons || [],
        lessonMinutes: lesson => (Number(lesson.hours) || 0) * 60,
        fmtMinutes: minutes => `${minutes / 60}시간`,
        LESSON_TRACKS: [], trackHasContent: () => false, qbankQuestions: () => [], lessonStatus: () => '',
        liveSubjectTrash: () => [{}, {}], liveLessonTrash: entries => entries
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(sliceFunction(read('js/ui.js'), 'function escapeHtml('), ctx);
    vm.runInContext(read('js/course-design.js'), ctx); // 과정 목표 시간(단원 수 × 40시간, courseUnitCount)은 index.html처럼 먼저 싣는다
    vm.runInContext(read('js/course-overview.js'), ctx);
    vm.runInContext(sliceFunction(read('js/course-meta.js'), 'function renderTrashFooter('), ctx);
    vm.runInContext(sliceFunction(read('js/ui.js'), 'function renderOverviewLNB('), ctx);
    return ctx;
}

const classOf = tag => (tag.match(/class="([^"]*)"/) || [])[1] || '';

function run(name, fn) {
    fn();
    console.log('PASS', name);
}

run('목록 칸은 세로 flex로 길면 안에서 스크롤한다', () => {
    const tag = read('index.html').match(/<div id="overview-lnb-list"[^>]*>/)[0];
    ['flex-1', 'overflow-y-auto', 'flex-col'].forEach(name => assert.ok(classOf(tag).split(/\s+/).includes(name), name));
});

run('교과 25개: 카드가 눌리지 않고 제목이 모두 보인다', () => {
    const ctx = makeContext(25);
    vm.runInContext('renderOverviewLNB()', ctx);
    const html = ctx.list.innerHTML;
    const cards = html.match(/<div class="[^"]*"\s+draggable="true" data-subj-idx="\d+"/g) || [];
    assert.strictEqual(cards.length, 25, '교과마다 카드 하나');
    cards.forEach(card => {
        const names = classOf(card).split(/\s+/);
        // overflow-hidden인 flex 자식은 최소 높이가 0이라 shrink-0이 없으면 교과가 많을 때 납작하게 눌린다
        assert.ok(names.includes('shrink-0'), `카드가 줄어들지 않아야 한다: ${card}`);
    });
    ctx.globalState.subjects.forEach((subject, i) => {
        assert.ok(html.includes(`>${subject.title}</h3>`), `제목 ${i + 1}`);
        assert.ok(html.includes(`title="${subject.title}"`), `잘린 제목은 올려 두면 보인다 ${i + 1}`);
    });
    assert.ok(!/<details|max-h-0|line-clamp/.test(html), '접어 두는 요소가 없다');
    // 끌어 옮기기·열기·편집·삭제·ZIP 선택이 그대로 있다
    ['ondragstart="handleSubjDragStart(event, 24)"', 'ondrop="handleSubjDrop(event, 24)"', "openSubjectDetail('s25')", "location.hash='#editor/s25'", "deleteSubject('s25')", 'data-subj-id="s25"']
        .forEach(text => assert.ok(html.includes(text), text));
});

run('교과 25개: 과정 시간 상자와 휴지통 줄도 눌리지 않는다', () => {
    const ctx = makeContext(25);
    vm.runInContext('renderOverviewLNB()', ctx);
    const html = ctx.list.innerHTML;
    const box = html.match(/<div class="[^"]*">\s*<div class="[^"]*">\s*<span class="[^"]*">과정 시간<\/span>/);
    assert.ok(box && classOf(box[0]).split(/\s+/).includes('shrink-0'), '과정 시간 상자');
    const trash = html.match(/<button onclick="openLessonTrash\(\)"[^>]*>/);
    assert.ok(trash && classOf(trash[0]).split(/\s+/).includes('shrink-0'), '휴지통 줄');
    assert.ok(html.includes('휴지통 · 교과 2 · 차시 2'));
    assert.ok(html.trimEnd().endsWith('</button>'), '휴지통 줄이 목록 맨 아래에 있다');
});

run('과정 시간: 교과 25개의 번호가 잘리지 않게 줄을 나눈다', () => {
    const ctx = makeContext(25);
    const bar = vm.runInContext('renderCourseTimeBar()', ctx);
    const lines = bar.split('data-time-row').slice(1);
    // 교과 버튼만 센다(19차: 차시가 1개뿐인 교과라 목표(단원 수 × 40시간)와 달라 막대 아래에 맞추기 단추가 함께 보인다)
    assert.deepStrictEqual(lines.map(line => (line.match(/<button onclick="location/g) || []).length), [7, 6, 6, 6], '한 줄에 8개를 넘지 않고 고르게 나눈다');
    const buttons = bar.match(/<button onclick="location[^>]*>[^<]*<\/button>/g) || [];
    assert.deepStrictEqual(buttons.map(button => button.replace(/<[^>]*>/g, '')), Array.from({ length: 25 }, (_, i) => String(i + 1)), '번호 1~25가 차례로 모두 있다');
    buttons.forEach((button, i) => {
        const names = classOf(button).split(/\s+/);
        assert.ok(!names.includes('truncate') && !names.includes('min-w-0'), `말줄임(1··)으로 잘리지 않는다: ${i + 1}`);
        const min = Number((button.match(/min-width:([\d.]+)rem/) || [])[1]);
        assert.ok(min >= String(i + 1).length * 0.5 + 0.25, `번호가 들어갈 최소 너비: ${i + 1}`);
        assert.ok(/style="flex:480;/.test(button), '너비는 시간에 비례한다');
        assert.ok(button.includes(`title="${i + 1}. 교과 제목 ${i + 1}번 — 8시간"`), '올려 두면 교과와 시간이 보인다');
        assert.ok(button.includes(`location.hash='#editor/s${i + 1}'`), '누르면 그 교과로 간다');
    });
    assert.ok(bar.includes('합계 200시간'));
});

run('과정 시간: 교과가 적으면 한 줄 그대로이고, 시간이 없는 교과는 뺀다', () => {
    const ctx = makeContext(8);
    assert.strictEqual(vm.runInContext('renderCourseTimeBar()', ctx).split('data-time-row').length - 1, 1);
    ctx.globalState.subjects[2].lessons = [];
    const bar = vm.runInContext('renderCourseTimeBar()', ctx);
    assert.deepStrictEqual((bar.match(/>(\d+)<\/button>/g) || []).map(text => text.replace(/\D/g, '')), ['1', '2', '4', '5', '6', '7', '8'], '번호는 교과 순서 그대로');
    ctx.globalState.subjects = [];
    assert.strictEqual(vm.runInContext('renderCourseTimeBar()', ctx), '');
    assert.deepStrictEqual(vm.runInContext('JSON.stringify(timeBarLines(Array.from({ length: 17 }, (_, i) => i)).map(line => line.length))', ctx), '[6,6,5]');
});

console.log('ALL PASSED');
