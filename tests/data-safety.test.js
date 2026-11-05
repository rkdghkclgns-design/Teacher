// 작업을 잃지 않게 하는 계산 테스트 (실행: node tests/data-safety.test.js)
// 교과 백업 합치기, 백업 나이, 히스토리 기록과 되돌릴 곳을 DOM 없이 확인한다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const ctx = { console, window: {}, JSON, Date, Map, Set, Promise };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'data-safety.js'), 'utf8'), ctx);
const {
    stateSnapshot, backupMeta, planSubjectImport, mergeSubjects, describeSubjectImport,
    backupAgeLabel, historyEntry, historyRestoreTarget, lessonFromHistory
} = ctx;

let failed = 0;
let count = 0;
const test = (name, fn) => {
    count++;
    try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
};

const subj = (id, title, lessons = []) => ({ id, title, lessons });

test('상태 사본: 지금 연 교과의 차시는 화면의 최신 차시로, API 키와 휴지통은 빼고 원본은 바꾸지 않는다', () => {
    const state = { courseTitle: '과정', apiKey: 'k', lessonTrash: [1], subjectTrash: [2], subjects: [subj('a', 'A', ['old']), subj('b', 'B', ['b1'])] };
    const snap = stateSnapshot(state, 'a', ['new']);
    assert.deepStrictEqual(snap.subjects.map(s => s.lessons), [['new'], ['b1']]);
    assert.strictEqual(snap.apiKey, undefined);
    assert.strictEqual(snap.lessonTrash, undefined);
    assert.strictEqual(snap.subjectTrash, undefined);
    assert.deepStrictEqual(state.subjects[0].lessons, ['old'], '원본은 그대로');
});

test('백업 데이터: 형식·범위·교과 수를 적는다', () => {
    const meta = backupMeta('subjects', { courseTitle: '과정', subjects: [subj('a', 'A')] }, new Date('2026-11-05T00:00:00Z'));
    assert.strictEqual(meta.format, 'teacher-backup');
    assert.strictEqual(meta.scope, 'subjects');
    assert.strictEqual(meta.subject_count, 1);
    assert.strictEqual(meta.timestamp, '2026-11-05T00:00:00.000Z');
});

test('교과 백업 불러오기: 같은 교과는 그 자리에서 바꾸고 새 교과는 뒤에 붙이며, 다른 교과는 그대로', () => {
    const current = [subj('a', 'A', ['a-old']), subj('b', 'B', ['b'])];
    const incoming = [subj('a', 'A', ['a-new']), subj('c', 'C', ['c'])];
    const plan = planSubjectImport(current, incoming);
    assert.deepStrictEqual(plan.replaced.map(s => s.id), ['a']);
    assert.deepStrictEqual(plan.added.map(s => s.id), ['c']);
    assert.strictEqual(JSON.stringify(mergeSubjects(current, incoming).map(s => [s.id, s.lessons[0]])), JSON.stringify([['a', 'a-new'], ['b', 'b'], ['c', 'c']]));
    const text = describeSubjectImport(plan);
    assert.ok(text.includes('A — 지금 교과를 파일 내용으로 바꿉니다'));
    assert.ok(text.includes('C — 새로 추가합니다'));
    assert.ok(text.includes('다른 교과는 그대로'));
});

test('마지막 백업 표시: 안 함·분·시간·일, 7일이 지나면 경고', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    assert.deepStrictEqual({ ...backupAgeLabel(null, now) }, { text: '백업 안 함', stale: true });
    assert.strictEqual(backupAgeLabel('2026-11-05T11:59:40Z', now).text, '방금 백업');
    assert.strictEqual(backupAgeLabel('2026-11-05T11:30:00Z', now).text, '30분 전 백업');
    assert.strictEqual(backupAgeLabel('2026-11-05T09:00:00Z', now).text, '3시간 전 백업');
    assert.deepStrictEqual({ ...backupAgeLabel('2026-11-02T12:00:00Z', now) }, { text: '3일 전 백업', stale: false });
    assert.strictEqual(backupAgeLabel('2026-10-28T12:00:00Z', now).stale, true);
});

test('히스토리 기록: 차시 id·5개 탭·이유를 남기고, 원본 그림과 이어지지 않는다', () => {
    const mod = { id: 7, title: '1차시', content: '합친 글', images: { a: 'data:1' }, tabContents: { basicLearn: '기본', basicPrac: null } };
    const entry = historyEntry(mod, { id: 100, date: 'd', reason: '다시 생성 전' });
    assert.strictEqual(entry.lessonId, 7);
    assert.deepStrictEqual({ ...entry.tabContents }, { basicLearn: '기본', basicPrac: null });
    assert.strictEqual(entry.reason, '다시 생성 전');
    mod.images.a = 'changed';
    assert.strictEqual(entry.images.a, 'data:1');
    const legacy = historyEntry({ title: '옛 글', content: '글' }, { id: 1, date: 'd' });
    assert.ok(!('lessonId' in legacy) && !('tabContents' in legacy) && !('reason' in legacy));
});

test('되돌릴 곳: 탭 기록이고 차시가 있으면 그 차시, 아니면 새 차시', () => {
    const lesson = { id: 7, title: '1차시' };
    const subjects = [subj('a', 'A', [{ id: 1 }]), subj('b', 'B', [lesson])];
    const hit = historyRestoreTarget({ lessonId: 7, tabContents: {} }, subjects);
    assert.strictEqual(hit.mode, 'replace');
    assert.strictEqual(hit.lesson, lesson);
    assert.strictEqual(hit.subject.id, 'b');
    assert.strictEqual(historyRestoreTarget({ lessonId: 99, tabContents: {} }, subjects).mode, 'new', '지운 차시');
    assert.strictEqual(historyRestoreTarget({ lessonId: 7 }, subjects).mode, 'new', '탭 없는 예전 기록');
});

test('새 차시로 되살리기: 예전 기록은 기본학습 칸에, 탭 기록은 탭 그대로', () => {
    const old = lessonFromHistory({ title: '옛 교안', content: '합친 글', images: { a: 1 } }, 5);
    assert.strictEqual(old.title, '옛 교안 (되살림)');
    assert.strictEqual(old.tabContents.basicLearn, '합친 글');
    assert.strictEqual(old.tabContents.assessment, null);
    const tabs = lessonFromHistory({ title: 'T', content: '', tabContents: { basicLearn: 'b', advLearn: 'c' } }, 6);
    assert.strictEqual(tabs.tabContents.advLearn, 'c');
    assert.strictEqual(tabs.status, 'done');
});

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
