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

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
