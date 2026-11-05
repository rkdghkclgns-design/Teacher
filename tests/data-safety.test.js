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

/* ---------- 작업 기록 합치기와 상한 알림 ---------- */
const plainJson = value => JSON.parse(JSON.stringify(value));

test('작업 기록 합치기: 칸이 모자라면 이 브라우저의 기록을 먼저 남기고, 남는 칸에 파일의 새 기록부터 넣는다', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    const mine = [
        ...Array.from({ length: 195 }, (_, i) => ({ id: now - 1e9 + i, title: `내 기록 ${i}` })),
        ...Array.from({ length: 5 }, (_, i) => ({ id: now - 40 + i, title: `불러오기 전 ${i}`, reason: '불러오기 전' }))
    ];
    const newer = Array.from({ length: 200 }, (_, i) => ({ id: now - 1e6 + i, title: `동료 ${i}` }));
    const kept = ctx.mergeHistory(mine, newer, now);
    assert.strictEqual(kept.list.length, 200);
    assert.ok(kept.list.every(item => !item.title.startsWith('동료')), '동료의 새 기록이 내 기록을 밀어내지 않는다');
    assert.deepStrictEqual([kept.droppedIncoming, kept.droppedCurrent], [200, 0]);
    const room = ctx.mergeHistory(mine.slice(50), newer, now);
    assert.deepStrictEqual(plainJson(room.list.filter(item => item.title.startsWith('동료')).map(item => item.title)), Array.from({ length: 50 }, (_, i) => `동료 ${150 + i}`), '남는 칸에는 파일의 새 기록부터');
    assert.ok(room.list.every((item, i, list) => i === 0 || list[i - 1].id < item.id), '시각 순서로 둔다');
    assert.strictEqual(room.droppedIncoming, 150);
});

test('작업 기록 합치기: 미래 시각 id는 이 브라우저의 가장 새 기록 아래로 바꾸고, 방금 남긴 기록을 밀어내지 않는다', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    const justNow = Array.from({ length: 5 }, (_, i) => ({ id: now - 40 + i, title: `불러오기 전 ${i}` }));
    const future = Array.from({ length: 200 }, (_, i) => ({ id: now + 1e10 + i, title: `미래 ${i}` }));
    const merged = ctx.mergeHistory(justNow, future, now);
    assert.strictEqual(merged.list.length, 200);
    assert.ok(merged.list.every(item => item.id <= now));
    assert.strictEqual(new Set(merged.list.map(item => item.id)).size, 200, 'id가 겹치지 않는다');
    assert.deepStrictEqual(plainJson(merged.list.slice(-5).map(item => item.title)), justNow.map(item => item.title), '방금 남긴 기록이 가장 새 기록으로 남는다');
    assert.deepStrictEqual(plainJson(merged.list.slice(0, -5).map(item => item.title)), Array.from({ length: 195 }, (_, i) => `미래 ${5 + i}`), '서로의 순서는 지킨다');
    assert.strictEqual(merged.droppedIncoming, 5);
    const mineAhead = ctx.mergeHistory([{ id: now + 5000, title: '내 기록' }], [], now);
    assert.strictEqual(mineAhead.list[0].id, now + 5000, '이 브라우저의 기록 id는 바꾸지 않는다');
});

test('작업 기록 합치기: id는 숫자로 맞추고 이상한 id는 받지 않는다. 같은 기록은 한 번, id만 같은 다른 기록은 나눠서 모두 남긴다', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    const odd = ctx.mergeHistory([], [{ id: '12', title: '글자 id' }, { id: '', title: '빈' }, { id: true, title: '참' }, { id: [7], title: '배열' }, { id: null }, { id: '1.5' }, { id: 1.5 }, { id: -3 }, { id: 1e20 }, null, 3], now);
    assert.deepStrictEqual(plainJson(odd.list.map(item => [item.title, item.id])), [['글자 id', 12]]);
    assert.strictEqual(ctx.mergeHistory([], [{ id: 20, title: { toString: null }, date: { toString: null } }], now).list.length, 1, '글이 아닌 제목·날짜에도 멈추지 않는다');
    const mine = { id: 3, title: '지금', date: 'd1', content: '같은 글', lessonId: 7, images: { a: 'data:image/png;base64,MINE' } };
    const same = ctx.mergeHistory([mine], [{ id: 3, title: '지금', date: 'd1', content: '같은 글', lessonId: 7, images: { a: 'data:image/png;base64,FILE' } }, { id: 3, title: '파일', date: 'd2' }, { id: 5, title: '첫째' }, { id: 5, title: '둘째' }], now);
    assert.deepStrictEqual(plainJson(same.list.map(item => [item.id, item.title])), [[2, '파일'], [3, '지금'], [4, '둘째'], [5, '첫째']]);
    assert.strictEqual(same.list[1].images.a, 'data:image/png;base64,MINE', '같은 기록은 이 브라우저의 것을 쓴다');
    const burst = ctx.mergeHistory([{ id: 10, title: '가' }, { id: 10, title: '나' }, { id: 10, title: '다' }], [], now);
    assert.deepStrictEqual(plainJson(burst.list.map(item => [item.id, item.title])), [[8, '다'], [9, '나'], [10, '가']], '같은 순간에 남긴 기록도 잃지 않는다');
    const legacy = ctx.mergeHistory(Array.from({ length: 205 }, (_, i) => ({ id: i + 1 })), [], now);
    assert.deepStrictEqual([legacy.list.length, legacy.list[0].id, legacy.droppedCurrent], [200, 6, 5]);
});

test('작업 기록 합치기: 한 번에 남긴 기록은 제목이 같아도 차시·교과·탭 글이 다르면 모두 넣는다(같은 기록만 한 번)', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    // archiveContents 한 번은 날짜·까닭이 같다. 옛 본문(content) 없이 탭만 든 차시도 있다
    const batch = (id, lessonId, subjectId, basicLearn) => ({ id, title: '1차시', date: '2026. 11. 5. 오후 3:00:00', reason: '불러오기 전', lessonId, subjectId, tabContents: { basicLearn } });
    const file = [batch(now - 30, 1, 's1', '가'), batch(now - 29, 2, 's1', '가'), batch(now - 28, 1, 's2', '가'), batch(now - 27, 1, 's1', '가나')];
    const merged = ctx.mergeHistory([], file, now);
    assert.deepStrictEqual([merged.list.length, merged.droppedIncoming], [4, 0], '차시·교과·탭 글 길이가 다르면 다른 기록');
    const local = ctx.mergeHistory([batch(now - 100, 1, 's1', '가')], [batch(now - 30, 1, 's1', '가'), batch(now - 29, 1, 's1', '가나다')], now);
    assert.deepStrictEqual(plainJson(local.list.map(item => item.tabContents.basicLearn)), ['가', '가나다'], '같은 기록은 한 번만, 탭 글이 다른 기록은 넣는다');
});

test('작업 기록 합치기: 이 브라우저의 기록은 id가 이상해도 지우지 않고 쓸 수 있는 id를 준다. 나눈 id는 0 아래로 내려가지 않는다', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    // 예전 코드가 받아 둔 소수·지수 글자·빈 id·음수 id(옛 합치기가 0 아래로 나눈 것)
    const mine = [{ id: 1700000000000.5, title: '소수' }, { id: '1.7e12', title: '지수' }, { id: null, title: '없음' }, { id: -1, title: '음수' }, { id: 1700000000001, title: '보통' }, null];
    const kept = ctx.mergeHistory(mine, [{ id: 5, title: '파일' }], now);
    assert.deepStrictEqual(plainJson(kept.list.map(item => item.title)).sort(), ['보통', '소수', '없음', '음수', '지수', '파일'].sort());
    assert.ok(kept.list.every(item => Number.isSafeInteger(item.id) && item.id >= 0), '모두 화면에서 찾을 수 있는 id');
    assert.strictEqual(new Set(kept.list.map(item => item.id)).size, 6);
    assert.deepStrictEqual([kept.droppedIncoming, kept.droppedCurrent], [0, 0]);
    assert.strictEqual(kept.list.find(item => item.title === '보통').id, 1700000000001, '바른 id는 그대로');
    const low = ctx.mergeHistory([{ id: 0, title: '가', date: '1' }], [{ id: 0, title: '나', date: '2' }, { id: now + 9, title: '미래', date: '3' }], now);
    assert.ok(low.list.every(item => Number.isSafeInteger(item.id) && item.id >= 0 && item.id <= now), `0 아래로 나누지 않는다: ${JSON.stringify(low.list.map(item => item.id))}`);
    assert.strictEqual(new Set(low.list.map(item => item.id)).size, 3);
    const again = ctx.mergeHistory(low.list, [], now);
    assert.deepStrictEqual([again.list.length, again.droppedCurrent], [3, 0], '다음 합치기에서도 모두 남는다');
    assert.strictEqual(ctx.mergeHistory([], low.list, now).list.length, 3, '나눈 id는 다른 브라우저로 옮겨도 받는다');
});

test('작업 기록 합치기: 같은 파일을 다시 불러와도 늘지 않고, 아주 긴 목록은 새것부터 일부만 살핀다', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    const file = [{ id: 50, title: 'A', date: 'y' }, { id: 50, title: 'B', date: 'y' }, { id: now + 1e10, title: '미래', date: 'x' }];
    const once = ctx.mergeHistory([{ id: 100, title: '내 것', date: 'z' }], file, now);
    assert.deepStrictEqual(plainJson(once.list.map(item => [item.id, item.title])), [[49, 'B'], [50, 'A'], [99, '미래'], [100, '내 것']]);
    const twice = ctx.mergeHistory(once.list, file, now);
    assert.deepStrictEqual(plainJson(twice.list), plainJson(once.list), '나눈 id·바꾼 미래 id의 기록도 같은 기록으로 알아본다');
    const long = ctx.mergeHistory([], Array.from({ length: 1500 }, (_, i) => ({ id: 1000 + i, title: `t${i}` })), now);
    assert.strictEqual(long.list.length, 200);
    assert.strictEqual(long.list[0].title, 't1300');
    assert.strictEqual(long.droppedIncoming, 1300);
    const sameId = ctx.mergeHistory([], Array.from({ length: 1500 }, (_, i) => ({ id: 5000, title: `s${i}` })), now);
    assert.deepStrictEqual([sameId.list.at(-1).title, sameId.list.at(-1).id, sameId.droppedIncoming], ['s500', 5000, 1300], '같은 id가 아주 많아도 목록 끝 1,000칸만 살핀다(멈추지 않게)');
});

test('작업 기록 합치기 알림: 남기지 못한 기록이 있을 때만 몇 개인지, 그 기록이 어디에 남는지 사실대로 말한다', () => {
    assert.strictEqual(ctx.historyMergeNote({ droppedIncoming: 0, droppedCurrent: 0 }), '');
    assert.strictEqual(ctx.historyMergeNote(), '');
    const folder = ctx.historyMergeNote({ droppedIncoming: 3, droppedCurrent: 0 }, '폴더');
    assert.ok(folder.includes('200개까지만') && folder.includes('이 브라우저의 기록을 먼저 남겼습니다'));
    assert.ok(folder.includes('폴더에 있던 기록 3개는 넣지 않았고, 폴더의 저장본(save_data.yaml)에서도 빠집니다.'), '이어지는 폴더 저장이 저장본을 다시 쓰므로 폴더에 남는다고 하지 않는다');
    const file = ctx.historyMergeNote({ droppedIncoming: 4 }, '파일');
    assert.ok(file.includes('파일에 있던 기록 4개는 넣지 않았습니다. 그 파일에는 그대로 남아 있습니다.'));
    assert.ok(!/에 있던 오래된 기록/.test(folder + file), '넣지 못한 기록이 더 새 기록일 수 있으므로 오래된 기록이라 하지 않는다');
    assert.ok(ctx.historyMergeNote({ droppedCurrent: 2 }).includes('이 브라우저의 오래된 기록 2개를 지웠습니다.'));
    // 이 브라우저의 기록이 200칸을 채우면 파일의 더 새 기록도 넣지 못한다
    const now = Date.parse('2026-11-05T12:00:00Z');
    const merged = ctx.mergeBackupExtras({ history: [{ id: now - 5, title: '더 새 기록' }] }, { history: Array.from({ length: 200 }, (_, i) => ({ id: 10 + i, title: `기록 ${i}` })) }, now);
    assert.deepStrictEqual(plainJson(merged.historyDropped), { droppedIncoming: 1, droppedCurrent: 0 });
});

test('작업 기록 상한: 넘쳐서 지우면 몇 개를 지웠는지 화면에 알리고, 불러오기는 같은 합치기를 쓴다', () => {
    const stateSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'state.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = stateSource.indexOf('async function archiveContents(');
    const end = stateSource.indexOf('\n}\n', start);
    assert.ok(start >= 0 && end > start, 'archiveContents를 찾지 못함');
    vm.runInContext(stateSource.slice(start, end + 2), ctx);
    const toasts = [];
    Object.assign(ctx, { contentHistory: Array.from({ length: 199 }, (_, i) => ({ id: i + 1, title: `기록 ${i}` })), currentSubjectId: 's1', projectFolderHandle: null, saveState: async () => {} });
    ctx.window.showToast = (message, type) => toasts.push([message, type]);
    ctx.archiveContents([{ title: '하나', content: '글' }]);
    assert.strictEqual(toasts.length, 0, '200개까지는 알리지 않는다');
    ctx.archiveContents([{ title: '둘', content: '글' }, { title: '셋', tabContents: { basicLearn: '글' } }, { title: '빈 글' }]);
    assert.strictEqual(ctx.contentHistory.length, 200);
    assert.deepStrictEqual(toasts, [['작업 기록은 200개까지 둡니다. 가장 오래된 기록 2개를 지웠습니다.', 'warning']]);
    // 백업 되살리기·폴더 열기가 같은 합치기(mergeBackupExtras)를 쓰고 마침 알림에 남기지 못한 기록을 말하는지(다른 묶음이 이 흐름을 다시 짜도 지킨다)
    assert.ok(stateSource.includes("historyMergeNote(extras.historyDropped, '파일')"), '백업 되살리기 알림');
    assert.ok(stateSource.includes("historyMergeNote(extras.historyDropped, '폴더')"), '폴더 열기 알림');
    assert.ok(!/new Map\(\[\.\.\.parsed\.history/.test(stateSource), '폴더 열기가 옛 합치기(같은 id 버림)를 쓰지 않는다');
});

test('알림은 먼저 뜬 알림 위에 쌓는다(상한 알림이 다른 알림에 가리지 않게)', () => {
    const uiSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = uiSource.indexOf('window.showToast = function');
    const end = uiSource.indexOf('\n};\n', start);
    assert.ok(start >= 0 && end > start, 'showToast를 찾지 못함');
    const shown = [];
    const element = () => ({ dataset: {}, style: {}, classList: { replace() {} }, offsetHeight: 40, remove() {} });
    const local = {
        window: {}, setTimeout: () => 0, escapeHtml: text => String(text),
        document: { createElement: element, querySelectorAll: selector => (selector === '[data-app-toast]' ? shown.filter(el => 'appToast' in el.dataset) : []), body: { appendChild: el => shown.push(el) } }
    };
    vm.createContext(local);
    vm.runInContext(uiSource.slice(start, end + 3), local);
    local.window.showToast('하나', 'warning');
    local.window.showToast('둘');
    assert.strictEqual(shown.length, 2);
    assert.strictEqual(shown[0].style.bottom, undefined, '첫 알림은 원래 자리');
    assert.strictEqual(shown[1].style.bottom, 'calc(1.5rem + 48px)', '둘째 알림은 첫 알림 위');
});

/* ---------- 그림 담기가 백업을 망가뜨리지 않게: '빼기'는 메뉴에서 바로 받는 백업 하나만, 자동 저장·안전 백업은 그림을 지킨다 ---------- */
const PNG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(20);
const png = i => PNG.replace('iVBOR', `iVB${i}R`);
const bigPng = i => `data:image/png;base64,iVB${i}R${'A'.repeat(600)}`;
const SAFETY_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'data-safety.js'), 'utf8');
const STATE_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'state.js'), 'utf8').replace(/\r\n/g, '\n');
const UI_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui.js'), 'utf8').replace(/\r\n/g, '\n');
// 소스에서 함수 하나를 잘라 온다(start 글부터 그 함수가 끝나는 줄까지)
const fnFrom = (source, file) => (start, end = '\n}\n') => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `${file}에서 ${start}을 찾지 못함`);
    return source.slice(from, to + end.length);
};
const stateFn = fnFrom(STATE_SRC, 'state.js');
const uiFn = fnFrom(UI_SRC, 'ui.js');
// JSZip 대신: 파일 이름과 내용만 모은다. maxText보다 긴 글을 넣거나 fail이 있으면 크기 오류처럼 던진다
class FakeZip {
    constructor() { this.files = {}; FakeZip.last = this; }
    static reset() { FakeZip.maxText = 0; FakeZip.fail = null; FakeZip.last = null; }
    static async loadAsync(file) { if (file.error) throw file.error; return file.zip; }
    file(name, data) {
        if (FakeZip.maxText && typeof data === 'string' && data.length > FakeZip.maxText) throw new RangeError('Invalid string length');
        this.files[name] = data;
        return this;
    }
    folder(name) { return { file: (n, d, o) => this.file(`${name}/${n}`, d, o), folder: n => this.folder(`${name}/${n}`) }; }
    async generateAsync() { if (FakeZip.fail) throw FakeZip.fail; return { files: Object.keys(this.files) }; }
}
FakeZip.reset();
// 저장소·알림·확인 창을 흉내 낸 새 창에 data-safety.js를 불러온다. seen.answers: 확인 창에 차례로 줄 답, extra.buttons: 그림 담기 버튼 흉내
function loadSafety(stored = {}, extra = {}) {
    const storage = { ...stored };
    const buttons = extra.buttons || [];
    const seen = { toasts: [], alerts: [], confirms: [], saved: [], answers: [], listeners: [] };
    const c = {
        console: { log() {}, info() {}, warn() {}, error() {} }, JSON, Date, Map, Set, Promise,
        localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
        document: {
            querySelectorAll: selector => (selector.includes('data-backup-images') ? buttons : []), getElementById: () => null,
            addEventListener: (type, fn, capture) => seen.listeners.push({ type, fn, capture })
        },
        saveAs: (blob, name) => seen.saved.push(name), JSZip: FakeZip,
        globalState: { courseTitle: '과정', subjects: [], lessonTrash: [], subjectTrash: [] }, courseData: null, currentSubjectId: null, contentHistory: [],
        window: {
            showToast: (text, type) => seen.toasts.push({ text, type }),
            showAlert: text => seen.alerts.push(text),
            showConfirm: (message, onOk, opts) => { seen.confirms.push({ message, ...opts }); (seen.answers.shift() ? onOk : opts.onCancel)(); }
        },
        ...extra
    };
    vm.createContext(c);
    vm.runInContext(SAFETY_SRC, c);
    const lastBackupAt = () => storage[vm.runInContext('BACKUP_TIME_KEY', c)]; // 묶음 8이 이름을 바꿔도 같은 열쇠를 읽는다
    return { c, W: c.window, storage, seen, lastBackupAt };
}
const pending = [];
const testAsync = (name, fn) => pending.push({ name, fn });

testAsync("기억한 방식: 처음은 '함께', 예전에 기억한 '빼기'는 '따로·가볍게'로 읽고, 이상한 값은 '함께'", () => {
    assert.strictEqual(loadSafety().W.storedBackupImageMode(), 'inline');
    assert.strictEqual(loadSafety({ 'teacher:backup-images': 'none' }).W.backupImageMode(), 'separate');
    assert.strictEqual(loadSafety({ 'teacher:backup-images': 'none' }).W.folderImageMode(), 'separate');
    assert.strictEqual(loadSafety({ 'teacher:backup-images': 'separate' }).W.folderImageMode(), 'separate');
    assert.strictEqual(loadSafety({ 'teacher:backup-images': 'zzz' }).W.backupImageMode(), 'inline');
});

testAsync("'빼기'는 기억하지 않고 PC 폴더 자동 저장에 쓰이지 않으며, 백업 하나를 만들기 시작하면 풀린다", () => {
    const buttons = ['inline', 'separate', 'none'].map(mode => ({ dataset: { backupImages: mode }, pressed: '', setAttribute(name, value) { if (name === 'aria-pressed') this.pressed = value; } }));
    const pressed = () => buttons.filter(button => button.pressed === 'true').map(button => button.dataset.backupImages);
    const { W, storage, seen } = loadSafety({ 'teacher:backup-images': 'separate' }, { buttons });
    W.setBackupImageMode('none');
    assert.strictEqual(W.backupImageMode(), 'none');
    assert.deepStrictEqual(pressed(), ['none'], '메뉴에는 빼기가 눌려 보인다');
    assert.strictEqual(storage['teacher:backup-images'], 'separate', '빼기는 저장하지 않는다');
    assert.strictEqual(W.folderImageMode(), 'separate', 'PC 폴더 자동 저장은 빼기를 받지 않는다');
    assert.ok(seen.toasts[0].text.includes('하나에만') && seen.toasts[0].text.includes("'따로·가볍게'로"), seen.toasts[0].text);
    assert.strictEqual(W.takeBackupImageMode(), 'none', '이 백업 하나에는 빼기');
    assert.strictEqual(W.takeBackupImageMode(), 'separate', '다음 백업은 기억한 방식');
    assert.deepStrictEqual(pressed(), ['separate']);
    W.setBackupImageMode('none');
    W.setBackupImageMode('inline');
    assert.strictEqual(W.backupImageMode(), 'inline', '다른 방식을 고르면 빼기는 풀린다');
    assert.strictEqual(storage['teacher:backup-images'], 'inline');
});

testAsync("'빼기'는 메뉴 밖을 누르면 그 버튼이 일하기 전에 풀린다(머리줄 백업 시각·교과 목록 ZIP 버튼)", () => {
    const { W, seen } = loadSafety();
    const click = seen.listeners.find(item => item.type === 'click');
    assert.ok(click && click.capture === true, '누름을 잡기 단계에서 먼저 본다');
    const at = inMenu => ({ target: { closest: selector => (inMenu && selector === '#export-dropdown-menu' ? {} : null) } });
    W.setBackupImageMode('none');
    click.fn(at(true));
    assert.strictEqual(W.backupImageMode(), 'none', '메뉴 안 누름은 그대로');
    click.fn(at(false));
    assert.strictEqual(W.backupImageMode(), 'inline', '메뉴 밖을 누르면 풀린다');
    click.fn({ target: null });
    assert.strictEqual(W.backupImageMode(), 'inline');
});

testAsync('백업 ZIP을 받은 뒤: 그림을 뺀 파일은 이름 끝 _그림없음, 백업 시각에 세지 않고, 그림이 든 백업은 센다', () => {
    const { W, seen, lastBackupAt, storage, c } = loadSafety();
    W.finishBackupDownload({ mode: 'none' }, { successText: '받음' });
    assert.strictEqual(lastBackupAt(), undefined, '그림을 뺀 파일은 백업 시각에 세지 않는다');
    assert.ok(seen.toasts.at(-1).text.includes('_그림없음') && seen.toasts.at(-1).type === 'warning');
    W.finishBackupDownload({ mode: 'separate' }, { successText: '받음' });
    assert.ok(lastBackupAt(), '그림이 든 백업은 센다');
    assert.strictEqual(seen.toasts.at(-1).text, '받음');
    delete storage[vm.runInContext('BACKUP_TIME_KEY', c)];
    W.finishBackupDownload({ mode: 'inline' }, { countsAsBackup: false });
    assert.strictEqual(lastBackupAt(), undefined, '세지 않게 고를 수 있다');
    assert.strictEqual(W.backupFileName('과정_과정전체백업_20261105-1530', 'none'), '과정_과정전체백업_20261105-1530_그림없음.zip');
    assert.strictEqual(W.backupFileName('국어_교안', 'separate'), '국어_교안.zip');
    assert.strictEqual(W.backupFileName('국어_교안', 'inline'), '국어_교안.zip');
});

testAsync('크기 한도 오류만 골라낸다', () => {
    const { W, c } = loadSafety();
    assert.ok(W.isBackupTooBig(new RangeError('Invalid string length')), '다른 창의 RangeError도 글로 알아본다');
    assert.ok(W.isBackupTooBig(new (vm.runInContext('RangeError', c))('x')));
    assert.ok(W.isBackupTooBig(new Error('Array buffer allocation failed')));
    assert.ok(W.isBackupTooBig(new Error('Invalid typed array length: 4294967296')));
    assert.ok(!W.isBackupTooBig(new RangeError('Maximum call stack size exceeded')), '깊은 구조는 크기 문제가 아니다');
    assert.ok(!W.isBackupTooBig(new Error('NotAllowedError')));
    assert.ok(!W.isBackupTooBig(null));
});

testAsync("'함께'가 크기 한도에 걸리면 '따로·가볍게'로 다시 만들고 기억한 방식도 바꾼다(PC 폴더가 이어져 있으면 그 말도 한다)", async () => {
    const { W, c, storage, seen } = loadSafety();
    FakeZip.maxText = 1000;
    const images = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`img_${i}`, png(i)]));
    const zip = new FakeZip();
    const result = await W.buildBackupZip(zip, zip, { context: { subjects: [{ id: 's', lessons: [{ id: 1, images }] }] } }, 'inline');
    assert.deepStrictEqual([result.mode, result.fellBack, result.switched], ['separate', true, true]);
    assert.ok(result.blob, '다시 만든 파일을 돌려준다');
    assert.ok(zip.files['save_data.yaml'].includes('"imageMode": "separate"'));
    assert.strictEqual(Object.keys(zip.files).filter(name => name.startsWith('그림/')).length, 8);
    assert.strictEqual(storage['teacher:backup-images'], 'separate');
    assert.strictEqual(W.folderImageMode(), 'separate');
    W.finishBackupDownload(result);
    assert.ok(seen.alerts[0].includes("'따로·가볍게'로 받았습니다") && seen.alerts[0].includes('내보내기·백업 → 그림 담기'), '바꾼 곳을 알려 준다');
    assert.ok(!seen.alerts[0].includes('PC 폴더 자동 저장도'), 'PC 폴더가 없으면 폴더 이야기는 하지 않는다');
    c.projectFolderHandle = { name: '작업' };
    W.notifyBackupFallback('download');
    assert.ok(seen.alerts[1].includes('PC 폴더 자동 저장도 다음 저장부터'));
});

testAsync('ZIP을 묶다 메모리 한도에 걸려도 따로 담아 다시 만들고, 크기 오류가 아니면 그대로 알린다', async () => {
    const { W } = loadSafety();
    let calls = 0;
    const zip = new FakeZip();
    zip.generateAsync = async () => { calls++; if (calls === 1) throw new Error('Array buffer allocation failed'); return 'blob'; };
    const result = await W.buildBackupZip(zip, zip.folder('과정'), { context: { a: { images: { x: PNG } } } }, 'inline');
    assert.strictEqual(result.mode, 'separate');
    assert.ok(zip.files['과정/save_data.yaml'].includes('teacher-image:'), '큰 save_data.yaml을 덮어쓴다');
    const other = loadSafety();
    FakeZip.fail = new Error('디스크 오류');
    await assert.rejects(other.W.buildBackupZip(new FakeZip(), new FakeZip(), {}, 'inline'), /디스크 오류/);
    assert.strictEqual(other.storage['teacher:backup-images'], undefined, '크기 오류가 아니면 방식을 바꾸지 않는다');
    FakeZip.fail = null;
    const modes = [];
    await W.withSeparateFallback('none', async mode => { modes.push(mode); });
    await W.withSeparateFallback('separate', async mode => { modes.push(mode); });
    assert.deepStrictEqual(modes, ['none', 'separate'], '빼기·따로는 한 번만 쓴다');
});

testAsync("'따로·가볍게'로 다시 만들어도 실패하면 그림 담기를 바꾸지 않고, 따로 담기에 성공한 때에만 바꿔 알린다", async () => {
    const { W, storage, seen } = loadSafety();
    FakeZip.fail = new RangeError('Array buffer allocation failed'); // 읽기용 파일까지 커서 어느 방식으로도 ZIP을 묶지 못함
    const zip = new FakeZip();
    await assert.rejects(W.buildBackupZip(zip, zip, { context: { a: { images: { x: PNG } } } }, 'inline'), err => W.isBackupTooBig(err));
    assert.strictEqual(storage['teacher:backup-images'], undefined, '둘 다 실패하면 기억한 방식은 그대로');
    assert.strictEqual(W.backupImageMode(), 'inline');
    assert.strictEqual(W.folderImageMode(), 'inline', "PC 폴더가 알림 없이 '그림' 폴더 방식으로 바뀌지 않는다");
    assert.strictEqual(seen.alerts.length, 0);
    FakeZip.fail = null;
    const tries = [];
    const result = await W.withSeparateFallback(W.folderImageMode(), async mode => {
        tries.push(mode);
        if (mode === 'inline') throw new RangeError('Invalid string length');
    });
    assert.deepStrictEqual(tries, ['inline', 'separate']);
    assert.deepStrictEqual([result.mode, result.fellBack, result.switched], ['separate', true, true], '따로 담기에 성공하면 그때 바꾸고 바꿨다고 알린다');
    assert.strictEqual(storage['teacher:backup-images'], 'separate');
    const failed = [];
    const other = loadSafety();
    await assert.rejects(other.W.withSeparateFallback('inline', async mode => {
        failed.push(mode);
        throw mode === 'inline' ? new RangeError('Invalid string length') : Object.assign(new Error('권한 없음'), { name: 'NotAllowedError' });
    }), /권한 없음/);
    assert.deepStrictEqual(failed, ['inline', 'separate']);
    assert.strictEqual(other.storage['teacher:backup-images'], undefined, '따로 쓰기가 다른 까닭으로 실패해도 바꾸지 않는다');
});

testAsync("방식을 주지 않은 writeBackupData는 '빼기'를 골라 두었어도 그림을 담는다", () => {
    const { W } = loadSafety();
    W.setBackupImageMode('none');
    const zip = new FakeZip();
    W.writeBackupData(zip, { context: { a: { images: { x: PNG } } } });
    assert.ok(zip.files['save_data.yaml'].includes(PNG));
});

testAsync("불러오기 전 안전 백업은 고른 방식과 상관없이 따로 담고, '빼기'를 쓰지도 풀지도 않는다", async () => {
    const { W, seen, lastBackupAt } = loadSafety({}, { globalState: { courseTitle: '과정', subjects: [{ id: 's1', title: 'A', lessons: [{ id: 1, images: { a: PNG } }] }], lessonTrash: [], subjectTrash: [] }, currentSubjectId: 's1' });
    await W.downloadSafetyBackup('불러오기전');
    assert.ok(FakeZip.last.files['save_data.yaml'].includes('"imageMode": "separate"'), "'함께'를 골랐어도 따로 담는다(큰 과정도 글자 수 한도에 걸리지 않게)");
    W.setBackupImageMode('none');
    await W.downloadSafetyBackup('불러오기전');
    const files = FakeZip.last.files;
    assert.ok(files['save_data.yaml'].includes('"imageMode": "separate"'));
    assert.ok(Object.keys(files).some(name => name.startsWith('그림/') && name.endsWith('.png')));
    const name = seen.saved.at(-1);
    assert.ok(name.startsWith('교안백업_') && name.endsWith('_불러오기전.zip'), name);
    assert.strictEqual(W.backupImageMode(), 'none');
    assert.ok(lastBackupAt());
});

testAsync('안전 백업을 받지 못하면 까닭을 알리고 계속할지 묻는다(먼저 만드는 중이라고 알린다)', async () => {
    const { W, seen } = loadSafety();
    FakeZip.fail = new RangeError('Invalid string length');
    seen.answers.push(false);
    assert.strictEqual(await W.safetyBackupOrAsk('불러오기전'), false);
    assert.ok(seen.toasts[0].text.includes('만드는 중'));
    const ask = seen.confirms.at(-1);
    assert.strictEqual(ask.title, '불러오기 전 백업 실패');
    assert.ok(ask.message.includes('받지 못했습니다') && ask.message.includes('크기를 넘었습니다') && !ask.message.includes('되살리지 못했습니다'));
    assert.ok(ask.message.includes('이대로 불러오면') && ask.message.includes('교과를 하나씩 체크해'));
    assert.strictEqual(ask.okLabel, '백업 없이 계속');
    assert.strictEqual(ask.tone, 'danger');
    seen.answers.push(true);
    assert.strictEqual(await W.safetyBackupOrAsk('폴더연결전'), true);
    assert.strictEqual(seen.confirms.at(-1).title, '폴더 열기 전 백업 실패');
    assert.ok(seen.confirms.at(-1).message.includes('이대로 폴더를 열면'));
    FakeZip.fail = null;
    const before = seen.confirms.length;
    assert.strictEqual(await W.safetyBackupOrAsk('불러오기전'), true);
    assert.strictEqual(seen.confirms.length, before, '받으면 묻지 않는다');
});

testAsync('교과 불러오기: 그림 없는 파일이면 확인 창에 빈칸이 될 지금 그림 수를 보이고, 안전 백업이 실패해 멈추면 아무것도 바꾸지 않는다', async () => {
    const make = () => {
        const env = loadSafety({}, {
            globalState: { courseTitle: '과정', subjects: [{ id: 's1', title: '내 교과', lessons: [{ id: 1, title: '1차시', images: { a: png(1), b: png(2) } }] }], lessonTrash: [], subjectTrash: [] },
            currentSubjectId: 'x', sanitizeState: s => JSON.parse(JSON.stringify(s)), location: { hash: '' }, saves: 0
        });
        env.c.saveState = async () => { env.c.saves++; };
        return env;
    };
    const meta = { scope: 'subjects', imageMode: 'none', context: { subjects: [{ id: 's1', title: '파일 교과', lessons: [{ id: 1, title: '1차시', images: {} }] }] } };
    FakeZip.fail = new RangeError('Invalid string length');
    const stop = make();
    stop.seen.answers.push(true, false); // 불러오기 확인은 예, 백업 실패 뒤에는 멈춤
    await stop.W.importSubjectsBackup(meta);
    assert.strictEqual(stop.seen.confirms.length, 2);
    assert.ok(stop.seen.confirms[0].message.includes("그림 담기 '빼기'") && stop.seen.confirms[0].message.includes('지금 그림 2장이 빈칸이 됩니다'), stop.seen.confirms[0].message);
    assert.strictEqual(stop.seen.confirms[0].tone, 'danger');
    assert.strictEqual(stop.c.globalState.subjects[0].title, '내 교과', '멈추면 그대로');
    assert.strictEqual(stop.c.globalState.subjectTrash.length, 0);
    assert.strictEqual(stop.c.saves, 0);
    const go = make();
    go.seen.answers.push(true, true);
    await go.W.importSubjectsBackup(meta);
    assert.strictEqual(go.c.globalState.subjects[0].title, '파일 교과', '백업 없이 계속을 고르면 불러온다');
    assert.strictEqual(go.c.globalState.subjectTrash.length, 1);
    assert.strictEqual(go.c.saves, 1);
    assert.strictEqual(go.seen.saved.length, 0);
    FakeZip.fail = null;
    const plain = make();
    plain.seen.answers.push(true);
    await plain.W.importSubjectsBackup({ ...meta, imageMode: 'separate' });
    assert.ok(!plain.seen.confirms[0].message.includes('그림'), '그림이 든 파일이면 덧붙이지 않는다');
    assert.strictEqual(plain.seen.confirms[0].tone, 'primary');
});

testAsync('그림 수와 불러오기 경고: 같은 그림은 한 번, 글 속 그림과 짧은 글은 세지 않고, 빈칸이 될 지금 그림 수를 말한다', () => {
    const { W } = loadSafety();
    assert.strictEqual(W.countBackupImages({ a: { images: { x: PNG, y: PNG } }, list: [png(2), '글', `본문 ![](${PNG})`], short: 'data:image/png;base64,AA' }), 2);
    assert.strictEqual(W.countBackupImages(null), 0);
    const full = W.noImagesImportNote('full', 3);
    assert.ok(full.startsWith('\n\n') && full.includes('지금 그림 3장이 빈칸이 될 수 있습니다') && full.includes('불러오기 전에 받는 백업 파일에 남습니다'));
    const folder = W.noImagesImportNote('folder', 1);
    assert.ok(folder.includes("그림 담기 '빼기'로 저장되어") && folder.includes('지금 그림 1장이 빈칸이 됩니다'));
    const subjects = W.noImagesImportNote('subjects', 2);
    assert.ok(subjects.includes('교과 휴지통'));
    // '빼기' 파일도 읽기용 교안.html·그림 파일(과정 전체 백업은 첨부파일)에는 그림이 있다. 없는 것은 되살리기용 정보의 그림이다
    [full, folder, subjects, W.noImagesImportNote('subjects', 0)].forEach(note => {
        assert.ok(!/(파일|폴더)에는 그림이 없습니다/.test(note), note);
        assert.ok(note.includes('되살리기용 정보에는 그림이 담기지 않았습니다'), note);
    });
    assert.ok(subjects.includes('읽기용 교안.html·그림 파일의 그림은 되살리지 않습니다'), '교과 백업은 안의 읽기용 그림으로 되살리지 않는다고 알린다');
    assert.ok(!full.includes('읽기용'), '과정 전체 백업은 첨부파일의 그림이 열린 교과에 돌아올 수 있어 그 말을 하지 않는다');
    const none = W.noImagesImportNote('full', 0);
    assert.ok(!/\d+장/.test(none) && none.includes('빈칸으로 보일 수 있습니다'), none);
    assert.ok(W.noImagesImportNote('subjects', 0).includes('읽기용 교안.html'));
    const plan = { replaced: [{ title: 'A' }], added: [] };
    assert.ok(!W.describeSubjectImport(plan).includes('그림'), '그림 있는 파일은 예전과 같은 글');
    assert.ok(W.describeSubjectImport(plan, { noImages: true, lostImages: 2 }).includes('지금 그림 2장이 빈칸이 됩니다'));
});

// state.js의 과정 전체 백업을 data-safety.js와 함께 실제로 돌린다(JSZip·파일 이름 도우미는 흉내)
function loadFullBackup(stored = {}) {
    const lessons = [{ id: 1, title: '1차시', content: '<img src="local:img_a"> <img src="local:img_b">', images: { img_a: bigPng(1), img_b: bigPng(2) } }];
    const env = loadSafety(stored, {
        globalState: { courseTitle: '과정', subjects: [{ id: 's1', title: '국어', lessons }], lessonTrash: [], subjectTrash: [] },
        courseData: lessons, currentSubjectId: 's1',
        lessonFileName: mod => `${mod.title}.md`, lessonGyosuanFiles: () => []
    });
    vm.runInContext(`${stateFn('function extractImagesToZip(')}\n${stateFn('window.exportAllModules = async function')}`, env.c);
    return env;
}

testAsync("과정 전체 백업: 골라 둔 '빼기'는 그 파일 하나에만(이름 끝 _그림없음, 백업 시각에 세지 않음), '함께'가 크기 한도에 걸리면 따로 담아 받는다", async () => {
    const drop = loadFullBackup();
    drop.W.setBackupImageMode('none');
    await drop.W.exportAllModules();
    const name = drop.seen.saved.at(-1);
    assert.ok(/^과정_과정전체백업_\d{8}-\d{4}_그림없음\.zip$/.test(name), name);
    const data = FakeZip.last.files['과정/save_data.yaml'];
    assert.ok(data.includes('"imageMode": "none"') && !data.includes('data:image'), '되살리기용 정보에는 그림이 없다');
    assert.ok(Object.keys(FakeZip.last.files).some(file => file.startsWith('과정/첨부파일/')), '읽기용 첨부파일의 그림은 그대로');
    assert.strictEqual(drop.lastBackupAt(), undefined);
    assert.strictEqual(drop.W.backupImageMode(), 'inline', '빼기는 그 파일 하나로 끝난다');
    await drop.W.exportAllModules();
    assert.ok(!drop.seen.saved.at(-1).includes('_그림없음') && FakeZip.last.files['과정/save_data.yaml'].includes(bigPng(1)), '다음 백업은 그림을 담는다');
    assert.ok(drop.lastBackupAt());

    const big = loadFullBackup();
    FakeZip.maxText = 1000;
    await big.W.exportAllModules();
    assert.ok(FakeZip.last.files['과정/save_data.yaml'].includes('"imageMode": "separate"'));
    assert.strictEqual(Object.keys(FakeZip.last.files).filter(file => file.startsWith('과정/그림/')).length, 2);
    assert.strictEqual(big.storage['teacher:backup-images'], 'separate');
    assert.ok(big.seen.alerts[0].includes("'따로·가볍게'로 받았습니다") && big.seen.alerts[0].includes('내보내기·백업 → 그림 담기'), big.seen.alerts[0]);
    assert.ok(big.lastBackupAt());
    FakeZip.maxText = 0;

    const fail = loadFullBackup({ 'teacher:backup-images': 'separate' });
    FakeZip.fail = new RangeError('Invalid string length');
    await fail.W.exportAllModules();
    assert.strictEqual(fail.seen.saved.length, 0);
    assert.strictEqual(fail.seen.alerts[0], fail.W.BACKUP_TOO_BIG_TEXT.full);

    const failBoth = loadFullBackup();
    FakeZip.fail = new RangeError('Array buffer allocation failed');
    await failBoth.W.exportAllModules();
    assert.strictEqual(failBoth.seen.saved.length, 0);
    assert.deepStrictEqual(failBoth.seen.alerts, [failBoth.W.BACKUP_TOO_BIG_TEXT.full], '크기 안내 하나만');
    assert.strictEqual(failBoth.storage['teacher:backup-images'], undefined, "'따로·가볍게'로도 만들지 못하면 그림 담기는 그대로");
    assert.strictEqual(failBoth.W.folderImageMode(), 'inline');
    assert.strictEqual(failBoth.lastBackupAt(), undefined);
});

// ui.js의 교과 백업 ZIP 둘(사이드바·개요의 고른 교과, 편집 중인 교과)을 data-safety.js와 함께 실제로 돌린다(교안 HTML·파일 이름 도우미는 흉내)
const COURSE_FLOW_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'course-flow.js'), 'utf8').replace(/\r\n/g, '\n');
function loadSubjectZip(stored = {}) {
    const lessons = [{ id: 1, title: '1차시', content: '본문 <img src="local:img_a">', images: { img_a: bigPng(1), img_b: bigPng(2) } }];
    const env = loadSafety(stored, {
        globalState: { courseTitle: '과정', subjects: [{ id: 's1', title: '국어', lessons }], lessonTrash: [], subjectTrash: [] },
        courseData: lessons, currentSubjectId: 's1',
        lessonFileBase: mod => mod.title, uniqueFileBase: base => base, lessonGyosuanFiles: () => [],
        addLessonHtmlToZip: async jobs => { jobs.forEach(({ folder, mod }) => folder.file('교안.html', `<html>${mod.title}</html>`)); return jobs.length; }
    });
    const listAll = env.c.document.querySelectorAll;
    env.c.document.querySelectorAll = selector => (selector === '.subj-zip-cb:checked' ? [{ dataset: { subjId: 's1' } }] : listAll(selector));
    vm.runInContext([fnFrom(COURSE_FLOW_SRC, 'course-flow.js')('function zipImageParts('),
        uiFn('window.exportSelectedToZip = async function', '\n};\n'), uiFn('window.exportAllToZip = async function', '\n};\n')].join('\n'), env.c);
    return env;
}

testAsync("교과 백업 ZIP(ui.js): 골라 둔 '빼기'는 그 파일 하나에만(이름 끝 _그림없음, 백업 시각에 세지 않음, 읽기용 그림은 그대로), 다음 파일은 기억한 방식", async () => {
    const env = loadSubjectZip({ 'teacher:backup-images': 'separate' });
    env.W.setBackupImageMode('none');
    await env.W.exportAllToZip();
    assert.strictEqual(env.seen.saved.at(-1), '국어_전체교안_그림없음.zip');
    const files = FakeZip.last.files;
    assert.ok(files['save_data.yaml'].includes('"imageMode": "none"') && !files['save_data.yaml'].includes('data:image'), '되살리기용 정보에는 그림이 없다');
    assert.strictEqual(Object.keys(files).filter(name => name.startsWith('국어/1차시/images/')).length, 2, '읽기용 그림 파일은 그대로');
    assert.ok(files['국어/1차시/교안.html']);
    assert.strictEqual(env.lastBackupAt(), undefined, '그림을 뺀 파일은 백업 시각에 세지 않는다');
    assert.ok(env.seen.toasts.at(-1).text.includes('_그림없음') && env.seen.toasts.at(-1).type === 'warning');
    assert.strictEqual(env.W.backupImageMode(), 'separate', '빼기는 그 파일 하나로 끝난다');

    await env.W.exportSelectedToZip();
    assert.strictEqual(env.seen.saved.at(-1), '국어_교안.zip', '다음 파일은 기억한 방식(따로·가볍게)');
    assert.ok(FakeZip.last.files['save_data.yaml'].includes('"imageMode": "separate"'));
    assert.ok(env.seen.toasts.at(-1).text.includes('ZIP으로 다운로드'));

    delete env.storage[vm.runInContext('BACKUP_TIME_KEY', env.c)]; // 여기서는 '빼기' 파일이 백업 시각을 남기지 않는지만 본다
    env.W.setBackupImageMode('none');
    await env.W.exportSelectedToZip();
    assert.strictEqual(env.seen.saved.at(-1), '국어_교안_그림없음.zip');
    assert.ok(!FakeZip.last.files['save_data.yaml'].includes('data:image'));
    assert.strictEqual(env.lastBackupAt(), undefined);
    assert.strictEqual(env.W.backupImageMode(), 'separate');

    const big = loadSubjectZip();
    FakeZip.maxText = 1000;
    await big.W.exportAllToZip();
    assert.strictEqual(big.seen.saved.at(-1), '국어_전체교안.zip');
    assert.ok(FakeZip.last.files['save_data.yaml'].includes('"imageMode": "separate"'), "'함께'가 크기 한도에 걸리면 따로 담아 받는다");
    assert.strictEqual(big.storage['teacher:backup-images'], 'separate');
    assert.ok(big.seen.alerts[0].includes("'따로·가볍게'로 받았습니다"), big.seen.alerts[0]);
    FakeZip.maxText = 0;

    const fail = loadSubjectZip();
    FakeZip.fail = new RangeError('Array buffer allocation failed');
    await fail.W.exportSelectedToZip();
    assert.strictEqual(fail.seen.saved.length, 0);
    assert.deepStrictEqual(fail.seen.alerts, [fail.W.BACKUP_TOO_BIG_TEXT.subjects]);
    assert.strictEqual(fail.storage['teacher:backup-images'], undefined);
});

// PC 폴더 흉내: 파일은 이름과 내용만, 폴더는 안에 폴더를 둔다
function fakeFolder(name = '작업') {
    const files = {};
    const dirs = {};
    const notFound = () => Object.assign(new Error('없음'), { name: 'NotFoundError' });
    return {
        name, files, dirs, kind: 'directory',
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        getDirectoryHandle: async (dir, opts = {}) => {
            if (!dirs[dir]) { if (!opts.create) throw notFound(); dirs[dir] = fakeFolder(dir); }
            return dirs[dir];
        },
        getFileHandle: async (file, opts = {}) => {
            if (!(file in files) && !opts.create) throw notFound();
            return {
                getFile: async () => ({ size: files[file]?.length || 0 }),
                createWritable: async () => {
                    let data = '';
                    return { write: async value => { data = value; }, close: async () => { files[file] = data; }, abort: async () => {} };
                }
            };
        }
    };
}
// state.js의 PC 폴더 저장을 실제로 돌린다(교과 MD는 지금 연 교과가 없어 건너뛴다). 줄 세우기(syncToLinkedFolder) 없이 저장 한 번(syncLinkedFolderNow)을 부른다
function loadFolderSync(stored = {}) {
    const lessons = [{ id: 1, title: '1차시', images: { img_a: png(1) } }];
    const folder = fakeFolder();
    const env = loadSafety(stored, {
        globalState: { courseTitle: '과정', subjects: [{ id: 's1', title: '국어', lessons }], lessonTrash: [], subjectTrash: [] },
        currentSubjectId: null, projectFolderHandle: folder, folderWriteCache: null, FOLDER_STAMP_KEY: 'teacher:folder-save-stamp',
        atob: text => Buffer.from(text, 'base64').toString('binary'),
        markFolderSyncOk() {}, markFolderSyncFailed(err) { throw err; }, notifyFolderStopped() {}
    });
    vm.runInContext(['function simpleYamlStringify(', 'function base64ToUint8Array(', 'async function writeTextFile(', 'async function writeBinaryFile(',
        'function folderWriteCacheFor(', 'async function syncLinkedFolderNow(', 'async function rememberFolderSaveStamp(', 'async function writeSubjectExport(',
        'async function writeFolderImages(', 'async function folderFileSize('].map(start => stateFn(start)).join('\n'), env.c);
    return { ...env, folder };
}

testAsync("PC 폴더 자동 저장: '빼기'는 받지 않고, '함께'가 크기 한도에 걸리면 따로 담아 저장한 뒤 한 번만 알린다", async () => {
    const plain = loadFolderSync();
    plain.W.setBackupImageMode('none');
    assert.strictEqual(await plain.c.syncLinkedFolderNow(), true);
    const kept = plain.folder.files['save_data.yaml'];
    assert.ok(kept.includes(png(1)) && !kept.includes('imageMode'), "골라 둔 '빼기'여도 폴더에는 그림을 담는다(기억한 '함께')");

    const big = loadFolderSync();
    const realYaml = big.c.simpleYamlStringify;
    let inlineTries = 0;
    big.c.simpleYamlStringify = (obj, indent = 0) => {
        if (!indent && obj?.state && obj.imageMode === undefined) { inlineTries++; throw new RangeError('Invalid string length'); }
        return realYaml(obj, indent);
    };
    assert.strictEqual(await big.c.syncLinkedFolderNow(), true);
    const data = big.folder.files['save_data.yaml'];
    assert.ok(data.includes('imageMode: "separate"') && data.includes('teacher-image:'), data.slice(0, 200));
    assert.strictEqual(Object.keys(big.folder.dirs['그림'].files).length, 1);
    assert.strictEqual(big.storage['teacher:backup-images'], 'separate');
    assert.strictEqual(big.seen.alerts.length, 1);
    assert.ok(big.seen.alerts[0].includes("'따로·가볍게'로 저장했습니다") && big.seen.alerts[0].includes("'그림' 폴더도 함께 옮기세요"));
    assert.strictEqual(await big.c.syncLinkedFolderNow(), true);
    assert.strictEqual(inlineTries, 1, '다음 저장부터는 바로 따로 담는다');
    assert.strictEqual(big.seen.alerts.length, 1, '알림은 한 번');
});

testAsync("PC 폴더 자동 저장: '따로·가볍게'로도 저장하지 못하면 방식을 그대로 두고, 나중에 따로 저장되는 때 '그림' 폴더 안내를 한다", async () => {
    const env = loadFolderSync();
    const realYaml = env.c.simpleYamlStringify;
    let separateFails = true;
    env.c.simpleYamlStringify = (obj, indent = 0) => {
        if (!indent && obj?.state && (obj.imageMode === undefined || separateFails)) throw new RangeError('Invalid string length');
        return realYaml(obj, indent);
    };
    const failures = [];
    env.c.markFolderSyncFailed = err => failures.push(err);
    assert.strictEqual(await env.c.syncLinkedFolderNow(), false);
    assert.strictEqual(failures.length, 1);
    assert.ok(env.W.isBackupTooBig(failures[0]), '띠에는 크기 안내가 나간다');
    assert.strictEqual(env.folder.files['save_data.yaml'], undefined, '저장 파일은 쓰지 못했다');
    assert.strictEqual(env.storage['teacher:backup-images'], undefined, '그림 담기는 그대로');
    assert.strictEqual(env.W.folderImageMode(), 'inline');
    assert.strictEqual(env.seen.alerts.length, 0);

    separateFails = false;
    assert.strictEqual(await env.c.syncLinkedFolderNow(), true);
    assert.ok(env.folder.files['save_data.yaml'].includes('imageMode: "separate"'));
    assert.strictEqual(env.storage['teacher:backup-images'], 'separate');
    assert.strictEqual(env.seen.alerts.length, 1, "폴더가 처음 '그림' 폴더 방식이 되는 때 알린다");
    assert.ok(env.seen.alerts[0].includes("'그림' 폴더도 함께 옮기세요"), env.seen.alerts[0]);
});

// state.js의 백업 ZIP 되살리기를 실제로 돌린다(ZIP은 흉내, 상태 검사·기록·저장은 스텁)
function loadZipImport() {
    const lessons = [{ id: 1, title: '1차시', images: { a: png(1), b: png(2) } }];
    const env = loadSafety({}, {
        globalState: { courseTitle: '과정', subjects: [{ id: 's1', title: '내 교과', lessons }], lessonTrash: [], subjectTrash: [] },
        courseData: lessons, currentSubjectId: 's1', location: { hash: '' },
        safeJSONParse: text => JSON.parse(text),
        sanitizeState: state => (state ? JSON.parse(JSON.stringify({ subjects: [], ...state })) : null),
        archived: 0, saves: 0
    });
    env.c.archiveContents = async () => { env.c.archived++; };
    env.c.saveState = async () => { env.c.saves++; };
    env.c.renderSidebar = () => {};
    vm.runInContext(stateFn('window.importProjectZip = async function', '\n};\n'), env.c);
    return env;
}
const zipFile = (meta, error = null) => ({ target: { value: 'x', files: [{ name: '백업.zip', error, zip: { files: { 'save_data.yaml': { dir: false, async: async () => JSON.stringify(meta) } } } }] } });

testAsync('백업 ZIP 되살리기: 그림을 뺀 파일이면 확인 창에 지금 그림 수를 보이고, 안전 백업을 받지 못하면 묻고, 멈추면 아무것도 바꾸지 않는다', async () => {
    const meta = { format: 'teacher-backup', scope: 'full', imageMode: 'none', context: { courseTitle: '파일 과정', subjects: [{ id: 's9', title: '파일 교과', lessons: [{ id: 1, title: '1차시', images: {} }] }] } };
    const stop = loadZipImport();
    const before = stop.c.globalState;
    FakeZip.fail = new RangeError('Invalid string length');
    stop.seen.answers.push(true, false);
    const event = zipFile(meta);
    await stop.W.importProjectZip(event);
    assert.strictEqual(stop.seen.confirms.length, 2);
    assert.ok(stop.seen.confirms[0].message.includes("그림 담기 '빼기'") && stop.seen.confirms[0].message.includes('지금 그림 2장이 빈칸이 될 수 있습니다'), stop.seen.confirms[0].message);
    assert.strictEqual(stop.seen.confirms[1].title, '불러오기 전 백업 실패');
    assert.strictEqual(stop.c.globalState, before, '멈추면 지금 작업은 그대로');
    assert.strictEqual(stop.c.archived + stop.c.saves, 0);
    assert.ok(!stop.seen.alerts.some(text => text.includes('되살리지 못했습니다')), '파일 탓으로 돌리지 않는다');
    assert.strictEqual(event.target.value, '');

    FakeZip.fail = null;
    const go = loadZipImport();
    go.seen.answers.push(true);
    await go.W.importProjectZip(zipFile({ ...meta, imageMode: 'separate' }));
    assert.strictEqual(go.seen.confirms.length, 1);
    assert.ok(!go.seen.confirms[0].message.includes('그림'), '그림이 든 파일이면 덧붙이지 않는다');
    assert.ok(go.seen.saved.at(-1).endsWith('_불러오기전.zip'));
    assert.strictEqual(go.c.globalState.subjects[0].title, '파일 교과');
    assert.ok(go.seen.alerts.at(-1).startsWith('백업 파일로 과정 전체를 되살렸습니다'), go.seen.alerts.at(-1));

    const huge = loadZipImport();
    await huge.W.importProjectZip(zipFile(meta, new RangeError('Invalid string length')));
    assert.strictEqual(huge.seen.alerts[0], huge.W.BACKUP_TOO_BIG_TEXT.openFile);
});

test("백업 ZIP은 모두 buildBackupZip으로, 불러오기 전 백업은 모두 safetyBackupOrAsk로, '빼기'를 품은 방식은 takeBackupImageMode로만", () => {
    const jsDir = path.join(__dirname, '..', 'js');
    const sources = fs.readdirSync(jsDir).filter(f => f.endsWith('.js') && f !== 'data-safety.js').map(f => [f, fs.readFileSync(path.join(jsDir, f), 'utf8')]);
    const users = pattern => sources.filter(([, s]) => pattern.test(s)).map(([f]) => f);
    assert.deepStrictEqual(users(/\bwriteBackupData\(/), [], '크기 한도에 걸리면 따로 담아 다시 만드는 길(buildBackupZip)을 거친다');
    assert.deepStrictEqual(users(/\bdownloadSafetyBackup\(/), [], '받지 못하면 묻는 길(safetyBackupOrAsk)을 거친다');
    assert.deepStrictEqual(users(/\bbackupImageMode\(/), [], "'빼기'를 품은 방식은 백업 ZIP을 만들 때 takeBackupImageMode로만 가져간다");
    assert.ok(STATE_SRC.includes('folderImageMode()'), "PC 폴더 자동 저장은 '빼기'를 받지 않는 방식으로 담는다");
});

test('화면·설명 글: 뺀 그림을 일괄 이미지 찾기로 채운다는 말이 없고, 빼기는 바로 받는 백업 하나만이라고 알린다', () => {
    const rootDir = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
    const js = fs.readdirSync(path.join(rootDir, 'js')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(rootDir, 'js', f), 'utf8')).join('\n');
    assert.ok(!/일괄 이미지 찾기로 (다시 )?채[울운]/.test(html + readme + js), '일괄 이미지 찾기는 아직 채우지 않은 그림 태그만 채운다');
    const none = html.match(/data-backup-images="none"[^>]*title="([^"]+)"/)[1];
    assert.ok(none.includes('하나만') && none.includes('_그림없음') && none.includes('PC 폴더 자동 저장'), none);
    assert.ok(!none.includes('가장 가벼움'), '읽기용 파일의 그림은 그대로라 가장 가볍다고 하지 않는다');
    // '빼기'는 같은 메뉴의 백업 버튼에 쓰이므로, 그 버튼에 마우스를 올린 때 '글·그림과 함께'만 말하지 않는다
    const subjectZip = html.match(/onclick="smartZipExport\(\); toggleExportDropdown\(\);" title="([^"]+)"/)[1];
    assert.ok(subjectZip.includes('빼기') && subjectZip.includes('되살리기용 그림'), subjectZip);
});

test('크기 안내는 할 수 있는 길을 말한다(개요 화면 교과 목록에서 교과를 하나씩 체크해 나눠 받기)', () => {
    const texts = ctx.window.BACKUP_TOO_BIG_TEXT;
    Object.entries(texts).forEach(([kind, text]) => assert.ok(!text.includes('교과별로'), `${kind}: ${text}`));
    ['full', 'subjects', 'folder', 'openFile'].forEach(kind => assert.ok(texts[kind].includes('개요 화면 교과 목록에서 교과를 하나씩 체크해'), kind));
});

/* ---------- PC 폴더 열기·저장 (묶음 3) ---------- */
test('찾지 못한 그림은 참조를 그대로 두고, 모양이 맞는 참조만 바꾼다', () => {
    const W = ctx.window;
    const png = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(20);
    const jpg = 'data:image/jpeg;base64,' + '/9j/4AAQSkZJRg'.repeat(20);
    const { value, files } = W.detachBackupImages({ images: { a: png, b: jpg }, title: 'teacher-image:hello' }, 'separate');
    const jpgRef = value.images.b;
    delete files[W.backupImageKey(jpg)];
    const back = W.attachBackupImages(value, files);
    assert.strictEqual(back.images.a, png, '찾은 그림은 돌아온다');
    assert.strictEqual(back.images.b, jpgRef, '찾지 못한 그림은 참조 그대로');
    assert.ok(W.isBackupImageRef(jpgRef));
    assert.strictEqual(back.title, 'teacher-image:hello', '모양이 틀린 글은 그대로');
    assert.ok(W.isBackupImageRef('teacher-image:' + W.backupImageKey(png)));
    ['', 'teacher-image:', 'teacher-image:../x', 'teacher-image:' + 'g'.repeat(18), 'teacher-image:' + 'a'.repeat(16), 'teacher-image:' + 'a'.repeat(25), png, null, 5]
        .forEach(bad => assert.ok(!W.isBackupImageRef(bad), String(bad).slice(0, 30)));
});

test('저장본이 가리키는 그림 키를 한 번씩 모으고, 그림 폴더의 파일 이름과 맞춘다', () => {
    const W = ctx.window;
    const k1 = 'a'.repeat(18);
    const k2 = 'b'.repeat(20);
    const refs = W.backupImageRefs({
        state: { subjects: [{ lessons: [{ images: { x: 'teacher-image:' + k1, y: 'teacher-image:' + k2 } }] }], lessonTrash: [{ lesson: { images: { z: 'teacher-image:' + k1 } } }] },
        history: [{ images: { w: 'teacher-image:' + k2 } }],
        bad: ['teacher-image:xyz', 'teacher-image:' + k1 + '.png']
    });
    assert.deepStrictEqual([...refs].sort(), [k1, k2]);
    const byKey = W.backupImageFileNames([`${k1}.png`, `${k1}.jpg`, `${k2}.webp`, '01_개념.md', 'img_1.png', 'readme.txt']);
    assert.deepStrictEqual(JSON.parse(JSON.stringify([...byKey.entries()])), [[k1, `${k1}.png`], [k2, `${k2}.webp`]]);
});

test('그림 이름표를 기억하면 같은 그림을 다시 해시하지 않고, 결과는 그대로다', () => {
    const W = ctx.window;
    const png = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(20);
    const jpg = 'data:image/jpeg;base64,' + '/9j/4AAQSkZJRg'.repeat(20);
    const meta = { a: { images: { x: png, y: jpg } }, h: [{ images: { x: png } }] };
    const first = W.detachBackupImages(meta, 'separate');
    const again = W.detachBackupImages(meta, 'separate', first.memo);
    assert.strictEqual(JSON.stringify(again.value), JSON.stringify(first.value));
    assert.deepStrictEqual(Object.keys(again.files).sort(), Object.keys(first.files).sort());
    assert.strictEqual(first.memo.size, 2, '같은 그림은 한 번만 센다');
    const info = first.memo.get(png);
    assert.strictEqual(info.key, W.backupImageKey(png));
    assert.strictEqual(info.name, W.backupImageFile(info.key, png).name);
    assert.strictEqual(info.bytes, Buffer.from(png.split(',')[1], 'base64').length);
    const fake = new Map(first.memo);
    fake.set(png, { key: 'abc', name: 'abc.png', bytes: 1 });
    assert.strictEqual(W.detachBackupImages(meta, 'separate', fake).value.a.images.x, 'teacher-image:abc', '기억한 이름표를 쓴다');
    assert.strictEqual(W.detachBackupImages({ a: { images: { y: jpg } } }, 'separate', first.memo).memo.size, 1, '돌려준 기억에는 이번에 본 그림만');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(W.detachBackupImages({ images: { x: png } }, 'none', first.memo).value)), { images: {} });
});

test('폴더 열기: 폴더의 그림 담기, 사본 이름, 확인 창·알림 글', () => {
    const W = ctx.window;
    assert.strictEqual(W.folderImageModeOf({ imageMode: 'separate' }), 'separate');
    assert.strictEqual(W.folderImageModeOf({ imageMode: 'none' }), 'separate', '빼기로 저장된 폴더는 앞으로 따로 담는다');
    [{}, { imageMode: 'inline' }, { imageMode: '이상한값' }, null, undefined].forEach(saved => assert.strictEqual(W.folderImageModeOf(saved), 'inline'));
    assert.strictEqual(W.folderCopyName('20261105-1530'), 'save_data_이전_20261105-1530.yaml');
    assert.strictEqual(W.folderCopyName('20261105-1530', 2), 'save_data_이전_20261105-1530_2.yaml');
    const base = { folderName: '교안<폴더>', subjectCount: 2, incomingCount: 3 };
    const none = W.folderOpenPrompt(base);
    assert.strictEqual(none.okLabel, '백업 받고 바꾸기');
    assert.ok(none.message.startsWith("'교안<폴더>' 폴더의 작업(교과 3개)으로 지금 브라우저의 모든 작업(교과 2개)을 바꿉니다."), none.message);
    assert.ok(!none.message.includes('그림'), '빠진 그림이 없으면 그림 줄이 없다');
    const some = W.folderOpenPrompt({ ...base, total: 3, missing: 1, imageNote: '\n\n[빼기 안내]' });
    assert.strictEqual(some.okLabel, '빠진 채로 열기');
    assert.ok(some.message.includes('그림 3장 중 1장을') && some.message.includes('작업 기록·휴지통의 그림도 셈'));
    assert.ok(some.message.indexOf('[빼기 안내]') < some.message.indexOf('그림 3장 중'), '빼기 안내 다음에 빠진 그림 줄');
    assert.strictEqual(W.folderOpenPrompt({ ...base, total: 3, missing: 3 }).okLabel, '그림 없이 열기');
    const done = W.folderOpenedMessage({ folderName: 'A', keptName: 'save_data_이전_x.yaml', missing: 2, mode: 'separate' });
    assert.ok(done.includes('이 폴더에 자동으로 저장합니다') && done.includes('save_data_이전_x.yaml으로') && done.includes("'따로·가볍게'로 바꿨습니다"), done);
    assert.ok(done.includes('그림 2장(작업 기록·휴지통의 그림도 셈)은 찾지 못해 빈칸으로 남았습니다'), '확인 창처럼 작업 기록·휴지통의 그림도 센다고 말한다');
    assert.strictEqual(W.folderOpenedMessage({ folderName: 'A' }).split('\n').length, 1, '해당하는 줄만');
    assert.ok(W.folderOpenedMessage({ folderName: 'A', mode: 'separate', wasNone: true }).includes('그림을 빼고 저장되어 있었습니다'));
    const unsynced = W.folderOpenedMessage({ folderName: 'A', synced: false });
    assert.ok(unsynced.includes('이 폴더에 저장하지 못했습니다') && unsynced.includes('브라우저에는 저장됩니다'), unsynced);
    // 연 작업을 브라우저에 저장하지 못했으면 새로고침 뒤 이 폴더에 이어지지 않는다고 알리고, 브라우저에 저장된다고 하지 않는다
    const unsaved = W.folderOpenedMessage({ folderName: 'A', browserSaved: false });
    assert.ok(unsaved.includes('이 폴더에 자동으로 저장합니다') && unsaved.includes('브라우저에는 이 작업을 저장하지 못했습니다') && unsaved.includes("'저장해 둔 폴더 열기'로 이 폴더를 다시 여세요"), unsaved);
    const neither = W.folderOpenedMessage({ folderName: 'A', synced: false, browserSaved: false });
    assert.ok(neither.includes('이 폴더에 저장하지 못했습니다') && neither.includes('브라우저에는 이 작업을 저장하지 못했습니다') && !neither.includes('브라우저에는 저장됩니다'), neither);
});

test('그림 파일은 내용이 이름(키)과 맞을 때만 받는다: 짧아지거나 뒤가 빈 파일은 받지 않고, .png로 쓴 다른 형식과 = 채움이 없던 글은 받는다', () => {
    const W = ctx.window;
    const body = dataUrl => dataUrl.split(',')[1];
    const fromFile = dataUrl => Buffer.from(body(dataUrl), 'base64').toString('base64'); // 파일에서 다시 읽은 글(= 채움이 붙는다)
    const read = (dataUrl, base64 = fromFile(dataUrl)) => {
        const key = W.backupImageKey(dataUrl);
        return W.backupImageFromKeyedFile(key, W.backupImageFile(key, dataUrl).name, base64);
    };
    const png = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(20);
    const jpg = 'data:image/jpeg;base64,' + '/9j/4AAQSkZJRg'.repeat(20);
    const bmp = 'data:image/bmp;base64,' + 'Qk02AAAAAAAAADYAAAAoAAAA'.repeat(10);
    const avif = 'data:image/avif;base64,' + 'AAAAHGZ0eXBhdmlm'.repeat(15);
    const unpadded = png + 'AQ';
    assert.strictEqual(read(png), png);
    assert.strictEqual(read(jpg), jpg);
    assert.ok(W.backupImageFile('k', bmp).name.endsWith('.png') && W.backupImageFile('k', avif).name.endsWith('.png'), '확장자가 없는 형식은 .png로 쓴다');
    assert.strictEqual(read(bmp), bmp, "'image/png'와 이름 길이가 같은 형식은 키로 가려 원래 글 그대로");
    assert.strictEqual(read(avif), 'data:image/png;base64,' + body(avif), '이름 길이가 다른 형식은 글 길이로 보고 받는다');
    assert.ok(fromFile(unpadded).endsWith('AQ=='));
    assert.strictEqual(read(unpadded), unpadded, '= 채움이 없던 글은 원래 글 그대로');
    [png, jpg, bmp, avif].forEach(dataUrl => assert.strictEqual(read(dataUrl, fromFile(dataUrl).slice(0, 40)), null, `짧아진 파일 ${dataUrl.slice(0, 16)}`));
    const hollow = dataUrl => {
        const bytes = Buffer.from(body(dataUrl), 'base64');
        bytes.fill(0, 30);
        return bytes.toString('base64');
    };
    [png, jpg, bmp].forEach(dataUrl => assert.strictEqual(read(dataUrl, hollow(dataUrl)), null, `크기는 같고 뒤가 빈 파일 ${dataUrl.slice(0, 16)}`));
});

test('폴더 열기 마침 알림: 넣지 못한 폴더의 작업 기록이 그대로 남는 파일(열기 전에 남긴 사본) 이름을 알린다', () => {
    const note = ctx.historyMergeNote({ droppedIncoming: 3, droppedCurrent: 0, keptIn: 'save_data_이전_20261105-1530.yaml' }, '폴더');
    assert.ok(note.includes('폴더에 있던 기록 3개는 넣지 않았고, 폴더의 저장본(save_data.yaml)에서도 빠집니다.'), note);
    assert.ok(note.includes('그 기록은 save_data_이전_20261105-1530.yaml에 그대로 남아 있습니다.'), note);
    assert.ok(!ctx.historyMergeNote({ droppedIncoming: 0, droppedCurrent: 2, keptIn: 'x.yaml' }, '폴더').includes('x.yaml'), '넣지 못한 폴더 기록이 없으면 사본 이야기는 하지 않는다');
    assert.ok(!ctx.historyMergeNote({ droppedIncoming: 3, keptIn: 'x.yaml' }, '파일').includes('x.yaml'), '백업 파일은 그 파일에 남는다고만 한다');
});

test('불러온 상태 검사(sanitizeState)는 찾지 못한 그림의 참조를 지우지 않고, MD 내보내기에서는 빈 그림이 된다', () => {
    // 묶음 6이 그림 값 검사를 넣어도 지켜야 하는 약속(값은 data:image 또는 isBackupImageRef)
    const stateSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'state.js'), 'utf8').replace(/\r\n/g, '\n');
    const extract = name => {
        const start = stateSource.indexOf(`function ${name}(`);
        const end = stateSource.indexOf('\n}\n', start);
        assert.ok(start >= 0 && end > start, `${name}을 찾지 못함`);
        return stateSource.slice(start, end + 2);
    };
    vm.runInContext(`${extract('generateUniqueId')}\n${extract('sanitizeState')}\n${extract('resolveMarkdownImages')}`, ctx);
    const png = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(20);
    const ref = 'teacher-image:' + ctx.window.backupImageKey(png);
    const state = ctx.sanitizeState(JSON.parse(JSON.stringify({ subjects: [{ id: 's1', lessons: [{ id: 1, title: '가', images: { a: ref } }], mainQuest: { title: '평가', images: { q: ref } } }] })));
    assert.strictEqual(state.subjects[0].lessons[0].images.a, ref);
    assert.strictEqual(state.subjects[0].mainQuest.images.q, ref);
    assert.strictEqual(ctx.resolveMarkdownImages('![a](local:x) ![b](local:y)', { x: ref, y: png }), `![a]() ![b](${png})`);
});

test('PC 폴더: 폴더 저장은 모두 줄을 서고, 폴더 열기는 앞 묶음의 안전장치를 그대로 쓴다(소스 검사)', () => {
    const state = fs.readFileSync(path.join(__dirname, '..', 'js', 'state.js'), 'utf8').replace(/\r\n/g, '\n');
    const body = marker => {
        const start = state.indexOf(marker);
        assert.ok(start >= 0, marker);
        return state.slice(start, state.indexOf('\n}\n', start));
    };
    const sync = body('async function syncLinkedFolderNow(');
    assert.ok(sync.includes('folderImageMode()') && !sync.includes('backupImageMode(') && !sync.includes('requestPermission'), '빼기를 받지 않고, 저장 중에 권한 창을 띄우지 않는다');
    assert.ok(/function syncToLinkedFolder\(\) \{\n {4}return folderSyncRunner\.request\(\);/.test(state), '모든 폴더 저장은 줄을 선다');
    const open = body('window.loadFromProjectFolder = async function');
    ['readFolderImages(', 'freeFolderCopyName(', 'safetyBackupOrAsk(', 'mergeBackupExtras(', "historyMergeNote(extras.historyDropped, '폴더')", 'isBackupTooBig(', 'keptIn:'].forEach(name => assert.ok(open.includes(name), name));
    assert.ok(open.indexOf('freeFolderCopyName(') < open.indexOf('safetyBackupOrAsk(') && open.indexOf('safetyBackupOrAsk(') < open.indexOf('globalState = '), '사본 → 안전 백업 → 한 번에 바꾸기 순서');
    assert.ok(!open.includes('downloadSafetyBackup('), '폴더 열기 전 백업은 safetyBackupOrAsk로');
    const [forget, save, remember] = ['forgetFolderHandle(', 'await saveState()', 'rememberFolderHandle('].map(marker => open.indexOf(marker));
    assert.ok(forget > 0 && forget < save && save < remember, '앞 폴더를 잊고 → 브라우저에 저장한 뒤에야 이 폴더를 기억한다');
});

(async () => {
    for (const { name, fn } of pending) {
        count++;
        FakeZip.reset();
        try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
    }
    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
