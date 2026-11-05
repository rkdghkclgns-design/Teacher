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

test('되돌릴 곳: 같은 차시 id가 두 교과에 있으면 기록을 남긴 교과를 고른다', () => {
    const inCopy = { id: 7, title: '사본' };
    const inOrigin = { id: 7, title: '원래' };
    const subjects = [subj('copy', '사본 교과', [inCopy]), subj('origin', '원래 교과', [inOrigin])];
    assert.strictEqual(historyRestoreTarget({ lessonId: 7, subjectId: 'origin', tabContents: {} }, subjects).lesson, inOrigin);
    assert.strictEqual(historyRestoreTarget({ lessonId: 7, tabContents: {} }, subjects).lesson, inCopy, '교과 id가 없는 예전 기록은 처음 찾은 곳');
});

test('백업 파일을 불러와도 지금 히스토리·휴지통과 파일의 것을 합쳐 잃지 않는다', () => {
    const meta = {
        history: [{ id: 1, title: '파일' }, { id: 3, title: '겹침' }],
        trash: { lessonTrash: [{ at: 't1', lesson: { id: 'a' } }], subjectTrash: [{ at: 't2', subject: { id: 's' } }] }
    };
    const current = { history: [{ id: 3, title: '겹침' }, { id: 2, title: '지금' }], lessonTrash: [{ at: 't1', lesson: { id: 'a' } }, { at: 't9', lesson: { id: 'b' } }], subjectTrash: [] };
    const merged = ctx.mergeBackupExtras(meta, current);
    assert.strictEqual(JSON.stringify(merged.history.map(h => h.id)), '[1,2,3]');
    assert.strictEqual(merged.lessonTrash.length, 2, '같은 항목은 한 번만');
    assert.strictEqual(merged.subjectTrash.length, 1);
    const none = ctx.mergeBackupExtras({}, { history: [], lessonTrash: undefined, subjectTrash: undefined });
    assert.strictEqual(none.history.length + none.lessonTrash.length + none.subjectTrash.length, 0, '예전 백업(기록 없음)도 견딘다');
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

/* ---------- 불러온 상태 검사: 남이 준 백업 ZIP·폴더 ---------- */
const { isSafeStateId, stateText, safeReferenceUrls, assignLessonIds, renumberLessons, capHistory } = { ...ctx, ...ctx.window };

test('id는 안전한 글자만, 글 값은 문자열로, 참고 링크는 http(s)만', () => {
    assert.strictEqual(isSafeStateId('subject_1793844618467'), true);
    assert.strictEqual(isSafeStateId('x"><img src=x onerror=alert(1)>'), false);
    assert.strictEqual(isSafeStateId("a');alert(1);//"), false);
    assert.strictEqual(isSafeStateId(''), false);
    assert.strictEqual(stateText(null), '');
    assert.strictEqual(stateText(12345), '12345');
    assert.strictEqual(stateText('가'.repeat(5000)).length, 5000, '글은 자르지 않는다');
    assert.strictEqual(stateText({ toString: null }), '', '객체는 받지 않는다');
    const refs = JSON.parse(JSON.stringify(safeReferenceUrls([
        { url: 'javascript:alert(1)', title: 'x' }, { url: 'https://example.com/a', title: '<b>예</b>' }, null, 'https://문자열'
    ])));
    assert.deepStrictEqual(refs.map(ref => ref.url), ['https://example.com/a']);
});

test('차시 id: 숫자가 아니거나 교과 안에서 겹치면 새 숫자, 바른 id는 그대로', () => {
    const lists = [
        [{ id: 101 }, { id: '102' }, { id: 'lesson_abc' }, { id: 'viewModule(1)' }, { id: 101 }],
        [{ id: 101 }, { id: 103 }],
        [{ id: 'mainQuest' }, { id: 'x' }]
    ];
    const [first, second, third] = JSON.parse(JSON.stringify(assignLessonIds(lists)));
    assert.deepStrictEqual(first.map(l => l.id), [101, 102, 103, 104, 105], '가장 큰 id 다음 수부터');
    assert.deepStrictEqual(second.map(l => l.id), [101, 103], '다른 교과와 같은 id는 그대로 둔다(교과 id와 함께 가리킨다)');
    assert.deepStrictEqual(third.map(l => l.id), ['mainQuest', 1], '예전 형식의 최종 평가 id는 그대로');
    assert.strictEqual(JSON.stringify(assignLessonIds(lists)), JSON.stringify(assignLessonIds(lists)), '저장하지 않고 다시 열어도 같은 id');
    const renumbered = JSON.parse(JSON.stringify(renumberLessons([{ id: 'lesson_x', title: '가' }, { id: 5 }], [300, '301'], 300)));
    assert.deepStrictEqual(renumbered.map(l => l.id), [302, 303], '지금 있는 차시와 겹치지 않는 숫자');
    assert.strictEqual(renumbered[0].title, '가');
});

test('작업 기록은 상한을 넘으면 오래된 것부터 지운다', () => {
    const list = Array.from({ length: 205 }, (_, i) => ({ id: i }));
    const kept = capHistory(list);
    assert.strictEqual(kept.length, 200);
    assert.strictEqual(kept[0].id, 5);
    assert.strictEqual(capHistory([{ id: 1 }]).length, 1);
});

test('sanitizeState: 악성 백업의 id·과정명·링크·차시가 화면 코드에 들어갈 수 없게 바뀐다', () => {
    const stateSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'state.js'), 'utf8').replace(/\r\n/g, '\n');
    const extract = name => {
        const start = stateSource.indexOf(`function ${name}(`);
        const end = stateSource.indexOf('\n}\n', start);
        assert.ok(start >= 0 && end > start, `${name}을 찾지 못함`);
        return stateSource.slice(start, end + 2);
    };
    vm.runInContext(`${extract('generateUniqueId')}\n${extract('sanitizeState')}`, ctx);
    const evil = '"><img src=x onerror="window.pwned=1">';
    const state = ctx.sanitizeState(JSON.parse(JSON.stringify({
        apiKey: 'AIza-FAKE-TEST-KEY',
        courseId: evil,
        courseTitle: { toString: null },
        courseField: { toString: null },
        subjects: [
            null,
            {
                id: evil, title: evil, referenceUrls: [{ url: 'javascript:fetch(1)', title: 't' }],
                mainQuest: { id: evil, title: 7 },
                lessons: [{ id: "1);alert(1);//" }, { id: 7 }, null, { id: 7 }]
            },
            { id: 'subject_ok', lessons: [], referenceUrls: [{ url: { toString: null } }] },
            { id: { toString: null }, lessons: [] }
        ]
    })));
    assert.strictEqual(state.apiKey, undefined, '키는 불러오지 않는다');
    assert.ok(/^course_\d+$/.test(state.courseId));
    assert.strictEqual(typeof state.courseTitle, 'string');
    assert.strictEqual(state.subjects.length, 3, '객체가 아닌 교과는 뺀다');
    const [bad, ok, dup] = state.subjects;
    assert.ok(/^subject_[A-Za-z0-9]+$/.test(bad.id), bad.id);
    assert.strictEqual(ok.id, 'subject_ok');
    assert.ok(/^subject_/.test(dup.id) && dup.id !== 'subject_ok', '글자가 아닌 교과 id는 새로 준다');
    assert.strictEqual(ok.referenceUrls.length, 0);
    assert.strictEqual(state.courseField, '');
    assert.strictEqual(bad.referenceUrls.length, 0);
    assert.strictEqual(bad.mainQuest.id, 'mainQuest');
    assert.strictEqual(typeof bad.mainQuest.title, 'string');
    assert.strictEqual(bad.lessons.length, 3, '객체가 아닌 차시는 뺀다');
    bad.lessons.forEach(lesson => assert.ok(Number.isSafeInteger(lesson.id), String(lesson.id)));
    assert.strictEqual(new Set(bad.lessons.map(lesson => lesson.id)).size, 3, '겹치는 차시 id도 새로 준다');
    assert.strictEqual(bad.lessons[1].id, 7, '바른 id는 그대로');
});

test('백업의 휴지통·작업 기록은 모양이 맞는 것만 받고, 되살리는 차시도 검사한다', () => {
    const merged = ctx.mergeBackupExtras({
        history: [null, { id: 'abc' }, { id: 9, title: '기록' }],
        trash: {
            lessonTrash: [null, { at: 't', lesson: 'x' }, { at: 't2', lesson: { id: '1);alert(1)//', title: { toString: null } } }],
            subjectTrash: [{ at: 't3', subject: [] }, { at: 't4', subject: { id: 'x" onmouseover="a()' } }]
        }
    }, { history: [], lessonTrash: [], subjectTrash: [] });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(merged.history.map(h => h.id))), [9]);
    assert.strictEqual(merged.lessonTrash.length, 1);
    assert.strictEqual(merged.subjectTrash.length, 1);
    const cleaned = JSON.parse(JSON.stringify((ctx.cleanTrashLesson || ctx.window.cleanTrashLesson)(merged.lessonTrash[0].lesson)));
    assert.ok(Number.isSafeInteger(cleaned.id), String(cleaned.id));
    assert.strictEqual(cleaned.title, '차시');
});

/* ---------- 백업에 그림 담는 방식 ---------- */
test('그림 따로 담기: 떼었다 돌려놓으면 그대로이고, 같은 그림은 한 번만 담는다', () => {
    const W = ctx.window;
    const png = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(20);
    const jpg = 'data:image/jpeg;base64,' + '/9j/4AAQSkZJRg'.repeat(20);
    const meta = {
        context: { subjects: [{ lessons: [{ images: { a: png, b: jpg }, tabContents: { basicLearn: `본문 ![](${png}) 글 속 그림은 그대로` } }] }] },
        history: [{ images: { a: png } }, { images: { c: png } }],
        trash: { subjectTrash: [{ subject: { lessons: [{ images: { z: jpg } }] } }] },
        short: 'data:image/png;base64,AA'
    };
    const { value, files } = W.detachBackupImages(meta, 'separate');
    assert.strictEqual(Object.keys(files).length, 2, '같은 그림 다섯 군데를 두 장으로');
    assert.ok(!JSON.stringify(value).includes('"data:image/png;base64,iVBOR'), '값으로 든 그림은 이름으로 바뀐다');
    assert.ok(value.context.subjects[0].lessons[0].tabContents.basicLearn.includes(png), '글 속 그림은 건드리지 않는다');
    assert.strictEqual(value.short, meta.short, '짧은 글은 그림으로 보지 않는다');
    assert.strictEqual(JSON.stringify(W.attachBackupImages(value, files)), JSON.stringify(meta));
    const file = W.backupImageFile(W.backupImageKey(jpg), jpg);
    assert.ok(file.name.endsWith('.jpg'));
    const back = W.backupImageFromFile(file.name, file.base64);
    assert.strictEqual(back.dataUrl, jpg);
    assert.strictEqual(back.key, W.backupImageKey(jpg));
    assert.notStrictEqual(W.backupImageKey(png), W.backupImageKey(jpg));
    assert.ok(W.isBackupImageName(file.name), '백업이 쓴 그림 이름');
    assert.ok(!W.isBackupImageName('01_개념 이해.md'), "'그림' 교과 폴더의 MD는 그림이 아니다");
    assert.ok(!W.isBackupImageName('img_12345.png'), '첨부 그림 이름도 백업 그림이 아니다');
    ['', 'QQ==', 'QUI=', 'QUJD', 'iVBORw0KGgo'.repeat(20)].forEach(b64 => {
        assert.strictEqual(W.base64ByteLength(b64), Buffer.from(b64, 'base64').length, `${b64.slice(0, 8)} 바이트 수`);
    });
});

test('그림 빼기: 그림 항목을 빼고 글은 남긴다', () => {
    const W = ctx.window;
    const png = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(20);
    const { value, files } = W.detachBackupImages({ images: { a: png, keep: '글' }, list: [png, '글'] }, 'none');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(value)), { images: { keep: '글' }, list: ['글'] });
    assert.strictEqual(Object.keys(files).length, 0);
    assert.strictEqual(W.backupImageMode(), 'inline', '저장소가 없으면 예전 방식');
});

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
