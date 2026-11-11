// 메인 지도(과정 → 교과 → 차시) 접기·펴기와 지우기 테스트 (실행: node tests/diagram-map.test.js)
// 실제 diagram.js를 vm에서 돌리고 화면은 domino로 흉내 낸다. 저장·휴지통·확인 창은 흉내 낸다.
// 처음 한 번: npm install --no-save marked@15.0.12 turndown@7.2.4 (domino는 turndown이 함께 넣는다)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

let domino = null;
try {
    domino = require('@mixmark-io/domino');
} catch (err) {
    console.log('FAIL - domino가 없습니다. 먼저 실행: npm install --no-save marked@15.0.12 turndown@7.2.4');
    process.exit(1);
}

const root = path.join(__dirname, '..', 'js');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const sliceSource = (source, start, end = '\n}\n') => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)) + end.length);

const toAttr = key => `data-${String(key).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
function patchDomino(doc) {
    const htmlProto = Object.getPrototypeOf(Object.getPrototypeOf(doc.createElement('div')));
    if (!Object.getOwnPropertyDescriptor(htmlProto, 'dataset')) {
        Object.defineProperty(htmlProto, 'dataset', {
            configurable: true,
            get() {
                const el = this;
                return new Proxy({}, { get: (t, key) => (typeof key === 'string' && el.hasAttribute(toAttr(key)) ? el.getAttribute(toAttr(key)) : undefined) });
            }
        });
    }
}

const subjects = () => [
    { id: 's1', title: '교과 하나', description: '설명', lessons: [{ id: 1, title: '변수' }, { id: 2, title: '자료형' }, { id: 'mainQuest', title: '최종 평가' }] },
    { id: 's2', title: '교과 둘', description: '설명', lessons: [{ id: 3, title: '반복문', content: '옛 본문' }] }
];

function mapContext({ current = 's1', storage = {}, busy = false, saved = true } = {}) {
    const doc = domino.createDocument('<html><body><div id="diagram-dynamic-content"></div><svg id="diagram-lines"></svg><div id="minimap-content"></div><div id="editor-content-area"><textarea id="raw-view"></textarea></div><div id="ai-command-bar"></div></body></html>', true);
    patchDomino(doc);
    const state = { courseTitle: '과정', subjects: subjects() };
    const ctx = {
        console: { log() {}, warn() {}, error() {} }, document: doc, Promise, JSON, Set, Map,
        setTimeout: () => 0, addEventListener() {},
        localStorage: { getItem: key => (key in storage ? storage[key] : null), setItem: (key, value) => { storage[key] = String(value); } },
        globalState: state, currentSubjectId: current, currentEditingModuleId: 2,
        trashed: [], archived: [], confirms: [], alerts: [], toasts: [], deletedSubjects: [], saves: 0, busy
    };
    ctx.window = ctx;
    ctx.courseData = state.subjects.find(subj => subj.id === current)?.lessons || [];
    ctx.subjectLessonList = subj => (subj?.id === ctx.currentSubjectId ? ctx.courseData : (subj?.lessons || []));
    ctx.showConfirm = (message, ok) => { ctx.confirms.push(message); ok(); };
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, type) => ctx.toasts.push([message, type]);
    ctx.saveState = async () => { ctx.saves += 1; return saved; };
    ctx.moveLessonsToTrash = (lessons, subjectId) => ctx.trashed.push({ ids: lessons.map(lesson => lesson.id), subjectId });
    ctx.archiveContent = mod => ctx.archived.push(mod.id);
    ctx.trashRestoreBlocked = () => ctx.busy;
    ctx.deleteSubject = id => ctx.deletedSubjects.push(id);
    ctx.renderOverviewLNB = () => {};
    vm.createContext(ctx);
    vm.runInContext(sliceSource(read('ui.js'), 'function escapeHtml('), ctx);
    vm.runInContext(read('diagram.js'), ctx, { filename: 'diagram.js' });
    vm.runInContext('renderDiagram()', ctx);
    return { ctx, storage, state };
}

const plain = value => JSON.parse(JSON.stringify(value));
const content = ctx => ctx.document.getElementById('diagram-dynamic-content');
const node = (ctx, id) => ctx.document.getElementById(id);
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
function click(ctx, el) {
    const event = ctx.document.createEvent('Event');
    event.initEvent('click', true, true);
    el.dispatchEvent(event);
    return event;
}
const button = (ctx, selector) => {
    const found = content(ctx).querySelector(selector);
    if (!found) throw new Error(`단추를 찾지 못함: ${selector}`);
    return found;
};

let failed = 0;
let count = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

test('그리기: 과정·교과 카드 오른쪽에 접기 단추, 교과에 휴지통, 차시에 X(최종 평가 제외)를 단다', () => {
    const { ctx } = mapContext();
    assert.ok(node(ctx, 'node-course') && node(ctx, 'node-subj-s1') && node(ctx, 'node-less-s1-1'));
    assert.strictEqual(content(ctx).querySelectorAll('[data-diagram-action="fold-root"]').length, 1);
    assert.strictEqual(content(ctx).querySelectorAll('[data-diagram-action="fold-subject"]').length, 2);
    assert.strictEqual(content(ctx).querySelectorAll('[data-diagram-action="delete-subject"]').length, 2);
    const lessonX = [...content(ctx).querySelectorAll('[data-diagram-action="delete-lesson"]')].map(el => el.getAttribute('data-lesson-id'));
    assert.deepStrictEqual(lessonX, ['1', '2', '3'], '최종 평가에는 X가 없다');
});

test('접기: 교과 단추를 누르면 그 교과의 차시만 접고 +차시 수를 보이며, 다시 누르면 편다. 이 브라우저에 기억한다', () => {
    const { ctx, storage } = mapContext();
    click(ctx, button(ctx, '[data-diagram-action="fold-subject"][data-subject-id="s1"]'));
    assert.ok(!node(ctx, 'node-less-s1-1') && !node(ctx, 'node-less-s1-2'), '그 교과의 차시는 접혔다');
    assert.ok(node(ctx, 'node-less-s2-3'), '다른 교과는 그대로');
    const folded = button(ctx, '[data-diagram-action="fold-subject"][data-subject-id="s1"]');
    assert.strictEqual(folded.getAttribute('data-diagram-fold'), 'folded');
    assert.ok(folded.textContent.includes('3'), '숨긴 차시 수');
    assert.deepStrictEqual(JSON.parse(storage['teacher:diagram-folds']).subjects, ['s1']);
    const again = mapContext({ storage });
    assert.ok(!node(again.ctx, 'node-less-s1-1'), '다시 열어도 접혀 있다');
    click(again.ctx, button(again.ctx, '[data-diagram-action="fold-subject"][data-subject-id="s1"]'));
    assert.ok(node(again.ctx, 'node-less-s1-1'), '다시 누르면 편다');
    assert.deepStrictEqual(JSON.parse(storage['teacher:diagram-folds']).subjects, []);
});

test('접기: 과정 단추를 누르면 교과를 모두 접는다(자식의 자식도 보이지 않는다)', () => {
    const { ctx } = mapContext();
    click(ctx, button(ctx, '[data-diagram-action="fold-root"]'));
    assert.ok(!node(ctx, 'node-subj-s1') && !node(ctx, 'node-less-s1-1') && !node(ctx, 'node-subj-s2'));
    assert.ok(button(ctx, '[data-diagram-action="fold-root"]').textContent.includes('2'), '숨긴 교과 수');
    click(ctx, button(ctx, '[data-diagram-action="fold-root"]'));
    assert.ok(node(ctx, 'node-subj-s1') && node(ctx, 'node-less-s1-1'));
});

test('접기: 저장된 값이 깨졌거나 저장소를 못 쓰면 모두 펼쳐 그린다', () => {
    const { ctx } = mapContext({ storage: { 'teacher:diagram-folds': '{깨진' } });
    assert.ok(node(ctx, 'node-subj-s1') && node(ctx, 'node-less-s1-1'));
    const odd = mapContext({ storage: { 'teacher:diagram-folds': JSON.stringify({ root: 'yes', subjects: [5, 's2'] }) } });
    assert.ok(node(odd.ctx, 'node-subj-s1'), '참/거짓이 아닌 root는 펼친 것으로');
    assert.ok(!node(odd.ctx, 'node-less-s2-3') && node(odd.ctx, 'node-less-s1-1'), '글자 id만 읽는다');
});

test('지우기: 교과 휴지통 단추는 교과 삭제(차시 포함)를 부른다', () => {
    const { ctx } = mapContext();
    click(ctx, button(ctx, '[data-diagram-action="delete-subject"][data-subject-id="s2"]'));
    assert.deepStrictEqual(plain(ctx.deletedSubjects), ['s2']);
});

test('지우기: 지금 연 교과가 아닌 교과의 차시 X는 그 차시만 휴지통으로 옮기고 지도를 다시 그린다', async () => {
    const { ctx, state } = mapContext();
    click(ctx, button(ctx, '[data-diagram-action="delete-lesson"][data-lesson-id="3"]'));
    await settle();
    assert.deepStrictEqual(plain(ctx.trashed), [{ ids: [3], subjectId: 's2' }]);
    assert.deepStrictEqual(plain(ctx.archived), [3], '옛 본문은 작업 기록에도 남긴다(차시 목록의 삭제와 같다)');
    assert.deepStrictEqual(plain(state.subjects[1].lessons), []);
    assert.strictEqual(ctx.saves, 1);
    assert.ok(!node(ctx, 'node-less-s2-3'), '지도에서도 사라졌다');
    assert.ok(ctx.confirms[0].includes('반복문'));
    assert.strictEqual(ctx.courseData.length, 3, '지금 연 교과의 목록은 그대로');
});

test('지우기: 지금 연 교과의 차시는 열린 차시 목록(courseData)에서도 빼고, 열어 둔 차시면 닫는다', async () => {
    const { ctx, state } = mapContext();
    click(ctx, button(ctx, '[data-diagram-action="delete-lesson"][data-lesson-id="2"]'));
    await settle();
    assert.deepStrictEqual(plain(ctx.courseData.map(lesson => lesson.id)), [1, 'mainQuest']);
    assert.strictEqual(state.subjects[0].lessons, ctx.courseData, '교과와 열린 목록이 같은 목록');
    assert.strictEqual(ctx.currentEditingModuleId, null);
});

test('지우기: 생성이 도는 동안에는 지우지 않고 알린다', async () => {
    const { ctx, state } = mapContext({ busy: true });
    click(ctx, button(ctx, '[data-diagram-action="delete-lesson"][data-lesson-id="3"]'));
    await settle();
    assert.strictEqual(ctx.trashed.length, 0);
    assert.strictEqual(state.subjects[1].lessons.length, 1);
    assert.ok(ctx.alerts[0].includes('생성'));
});

test('지우기: id에 따옴표가 있어도 단추는 그 글자 그대로 넘긴다(코드로 읽히지 않는다)', () => {
    const { ctx, state } = mapContext();
    state.subjects[1].id = `x"');alert(1);//`;
    vm.runInContext('renderDiagram()', ctx);
    const trash = [...content(ctx).querySelectorAll('[data-diagram-action="delete-subject"]')][1];
    assert.ok(!trash.hasAttribute('onclick'));
    click(ctx, trash);
    assert.deepStrictEqual(plain(ctx.deletedSubjects), [`x"');alert(1);//`]);
});

test('지우기: 저장하지 못했으면(saveState가 false) 옮겼다고 하지 않고 알린다', async () => {
    const { ctx } = mapContext({ saved: false });
    click(ctx, button(ctx, '[data-diagram-action="delete-lesson"][data-lesson-id="3"]'));
    await settle();
    assert.ok(ctx.toasts.some(([message, type]) => type === 'warning' && message.includes('저장하지 못했습니다')), JSON.stringify(ctx.toasts));
    assert.ok(!ctx.toasts.some(([, type]) => type === 'success'));
});

test('지우기: 열어 둔 차시를 지우면 편집 화면과 원문 칸을 비운다(휴지통의 차시에 글을 쓰지 않게)', async () => {
    const { ctx } = mapContext();
    click(ctx, button(ctx, '[data-diagram-action="delete-lesson"][data-lesson-id="2"]'));
    await settle();
    assert.ok(!ctx.document.getElementById('raw-view'), '원문 칸이 사라졌다');
    assert.ok(ctx.document.getElementById('editor-content-area').textContent.includes('휴지통'));
    assert.ok(ctx.document.getElementById('ai-command-bar').classList.contains('hidden'));
});

test('그리기: 지금 연 교과는 열린 차시 목록(courseData)으로 그리고, 그 목록에서 지운다', async () => {
    const { ctx, state } = mapContext();
    ctx.courseData = [...ctx.courseData, { id: 9, title: '새 차시' }];
    vm.runInContext('renderDiagram()', ctx);
    assert.ok(node(ctx, 'node-less-s1-9'), '교과 목록에 아직 없는 새 차시도 그린다');
    click(ctx, button(ctx, '[data-diagram-action="delete-lesson"][data-lesson-id="9"]'));
    await settle();
    assert.deepStrictEqual(plain(ctx.trashed), [{ ids: [9], subjectId: 's1' }]);
    assert.deepStrictEqual(plain(state.subjects[0].lessons.map(lesson => lesson.id)), [1, 2, 'mainQuest']);
});

(async () => {
    for (const { name, fn } of pending) {
        count++;
        try {
            await fn();
            console.log(`ok - ${name}`);
        } catch (e) {
            failed++;
            console.log(`FAIL - ${name}\n  ${e.stack || e.message}`);
        }
    }
    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
