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

test('히스토리 기록: 차시 id·5개 탭·이유를 남기고, 그 차시가 쓰는 그림만 원본과 이어지지 않게 담는다', () => {
    const mod = { id: 7, title: '1차시', content: '합친 글 ![](local:a)', images: { a: 'data:1', unused: 'data:2' }, tabContents: { basicLearn: '기본 ![](local:a)', basicPrac: null } };
    const entry = historyEntry(mod, { id: 100, date: 'd', reason: '다시 생성 전' });
    assert.strictEqual(entry.lessonId, 7);
    assert.deepStrictEqual({ ...entry.tabContents }, { basicLearn: '기본 ![](local:a)', basicPrac: null });
    assert.strictEqual(entry.reason, '다시 생성 전');
    assert.deepStrictEqual(Object.keys(entry.images), ['a'], '쓰지 않는 그림은 담지 않는다');
    mod.images.a = 'changed';
    assert.strictEqual(entry.images.a, 'data:1');
    const legacy = historyEntry({ title: '옛 글', content: '글' }, { id: 1, date: 'd' });
    assert.ok(!('lessonId' in legacy) && !('tabContents' in legacy) && !('reason' in legacy) && !('tabId' in legacy));
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
    const [T1, T2, T9] = ['2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z']; // 지운 날짜는 ISO로 검사한다(묶음 6)
    const meta = {
        history: [{ id: 1, title: '파일' }, { id: 3, title: '겹침' }],
        trash: { lessonTrash: [{ at: T1, lesson: { id: 'a' } }], subjectTrash: [{ at: T2, subject: { id: 's' } }] }
    };
    const current = { history: [{ id: 3, title: '겹침' }, { id: 2, title: '지금' }], lessonTrash: [{ at: T1, lesson: { id: 'a' } }, { at: T9, lesson: { id: 'b' } }], subjectTrash: [] };
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
    Object.assign(ctx, { contentHistory: Array.from({ length: 199 }, (_, i) => ({ id: i + 1, title: `기록 ${i}` })), currentSubjectId: 's1', projectFolderHandle: null, saveState: async () => {}, globalState: { subjects: [] }, courseData: [] });
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
        currentSubjectId: null, projectFolderHandle: folder, folderWriteCache: null, FOLDER_STAMP_KEY: 'teacher:folder-save-stamp', stateLoadFailed: false,
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
        archived: 0, saves: 0,
        // state.js의 읽지 못한 상태 도우미와 값(묶음 6). 이 시험은 읽은 상태에서 되살린다. PC 폴더는 잇지 않았다(브라우저에 저장한 뒤에만 폴더에 쓴다)
        isStateLoadFailed: () => false, markStateLoaded() {}, showOverviewAfterRestore() {}, unreadRecord: undefined,
        projectFolderHandle: null, pruneUnreadCopies: async () => {}
    });
    env.c.archiveContents = async () => { env.c.archived++; };
    env.c.saveState = async () => { env.c.saves++; return true; }; // 진짜 saveState처럼 브라우저에 저장했으면 true
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

/* ---------- 작업 기록 창과 기록 크기 (묶음 5): 그 글이 쓰는 그림만, 탭 하나 기록은 그 차시의 그 탭으로 ---------- */
const hist = ctx.window; // 화살표 함수(const)는 window로만 읽힌다
// 실제 탭 이름표(data.js LESSON_TABS)와 탭 하나 바꾸기(tabs.js setTabMarkdown)를 이 문맥에 올린다
const DATA_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8').replace(/\r\n/g, '\n');
const TABS_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'tabs.js'), 'utf8').replace(/\r\n/g, '\n');
vm.runInContext(`${fnFrom(DATA_SRC, 'data.js')('const LESSON_TABS = [', '\n];\n')}\n${fnFrom(TABS_SRC, 'tabs.js')('function setTabMarkdown(')}`, ctx);

test('작업 기록: 차시 기록은 그 차시의 글(교수안 포함)이 쓰는 그림만 담는다', () => {
    const mod = { id: 3, title: '차시', content: '본문 ![](local:a)', tabContents: { basicLearn: '본문 ![](local:a)' }, gyosuan: { docMd: '![붙여 넣은 그림](local:b)' }, images: { a: 'data:a', b: 'data:b', unused: 'data:u', odd: 7 } };
    const entry = historyEntry(mod, { id: 1, date: 'd', subjectId: 's1' });
    assert.deepStrictEqual(Object.keys(entry.images).sort(), ['a', 'b']);
    assert.strictEqual(entry.lessonId, 3);
    assert.ok(!('tabId' in entry));
});

test('작업 기록: 탭 하나 기록은 차시 id·교과 id·탭 id를 남기고, 차시 객체는 넣지 않는다', () => {
    const lesson = { id: 9, title: '차시' };
    const entry = historyEntry({ title: '차시 · 학습이해도', content: '평가 ![](local:q)', images: { q: 'data:q', z: 'data:z' }, tabId: 'assessment', lesson }, { id: 2, date: 'd', subjectId: 's1', reason: '문제은행 수정 전' });
    assert.deepStrictEqual(plainJson(entry), { id: 2, title: '차시 · 학습이해도', content: '평가 ![](local:q)', images: { q: 'data:q' }, date: 'd', lessonId: 9, subjectId: 's1', tabId: 'assessment', reason: '문제은행 수정 전' });
    const lost = historyEntry({ title: 'T', content: '글', tabId: 'assessment', lesson }, { id: 3 });
    assert.ok(lost.tabId === 'assessment' && !('lessonId' in lost), '교과를 모르면 차시 id를 남기지 않는다(되돌리면 새 차시)');
    ['constructor', '__proto__', 'gyosuanDoc', 5].forEach(tabId => {
        const odd = historyEntry({ title: 'T', content: '글', tabId, lesson }, { id: 4, subjectId: 's1' });
        assert.ok(!('tabId' in odd) && !('lessonId' in odd), String(tabId));
    });
    const stray = historyEntry({ id: 5, title: '차시', content: '글', tabId: 'basicLearn', tabContents: { basicLearn: '글' } }, { id: 5, subjectId: 's1' });
    assert.ok(!('tabId' in stray) && stray.lessonId === 5 && stray.tabContents, '차시 객체에 tabId가 섞여 있어도 차시 기록이다');
});

test('그 글이 쓰는 그림 고르기: 글자 값만(찾지 못한 그림의 참조도 담는다), 객체가 아닌 그림 목록은 빈 것으로', () => {
    const ref = 'teacher-image:' + 'a'.repeat(18); // PC 폴더에서 찾지 못한 그림 자리(data:image가 아니어도 그 글이 쓰면 담는다)
    assert.deepStrictEqual(plainJson(hist.referencedImages('![](local:img_10) ![](local:gone)', { img_1: 'a', img_10: 'b', n: 1, gone: ref })), { img_1: 'a', img_10: 'b', gone: ref });
    assert.deepStrictEqual(plainJson(hist.referencedImages('local:a', null)), {});
    assert.deepStrictEqual(plainJson(hist.referencedImages('local:a', ['x'])), {});
});

test("그 글이 쓰는 그림 고르기: 글을 한 번만 훑어도 글에 'local:키'가 있는지 본 것과 같다(id 글자가 아닌 키는 늘 남긴다)", () => {
    // 여러 모양의 글에서 예전 방식(키마다 글 전체에서 local:키 찾기)과 같은 키를 고르는지 견준다. 조각을 이어 붙여 local:이 붙거나 겹치는 글도 만든다
    let seed = 7;
    const rand = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % n; };
    const pieces = ['local:', 'img_1', 'img_10', 'img_', 'a', '-', '_', ')', '"', ' ', ':', 'loc', 'al:', 'x9', '\n'];
    const keys = ['img_1', 'img_10', 'img_', 'img_100', 'a', 'a-', '-', '_', 'x9', 'loc', 'local', 'img_1a', 'b'];
    const images = Object.fromEntries(keys.map(key => [key, `data:${key}`]));
    for (let round = 0; round < 400; round++) {
        const text = Array.from({ length: rand(14) }, () => pieces[rand(pieces.length)]).join('');
        const expected = keys.filter(key => text.includes(`local:${key}`)).sort();
        assert.deepStrictEqual(Object.keys(hist.referencedImages(text, images)).sort(), expected, JSON.stringify(text));
    }
    assert.deepStrictEqual(plainJson(hist.referencedImages('local:xlocal:img_1', { img_1: 'a', xloc: 'b', local: 'c' })), { img_1: 'a', xloc: 'b' }, '붙어 있는 local:도 빠짐없이 본다');
    assert.deepStrictEqual(Object.keys(hist.referencedImages('글', { '그림 1': 'a', 'a.b': 'b', '': 'c', img_2: 'd' })).sort(), ['', 'a.b', '그림 1'], 'id 글자가 아닌 키는 가를 수 없어 늘 남긴다(넉넉하게)');
    assert.deepStrictEqual(plainJson(hist.referencedImages(null, { a: 'x' })), {}, '글이 아니면 빈 글로 본다');
});

test('저장해 둔 기록 정리: 그림 키가 아주 많고 글이 길어도 곧 끝난다(남이 준 백업의 기록으로 앱 열기가 멈추지 않게)', () => {
    // 백업 불러오기(mergeHistory)로 들어와 저장된 기록 하나: 그림 키 5만 개, 글 4백만 자(ZIP에서는 거의 0으로 줄어든다). 키마다 글 전체를 찾으면 몇 초가 걸린다
    const images = Object.fromEntries(Array.from({ length: 50000 }, (_, i) => [`img_${i}`, PNG]));
    const stored = ctx.mergeHistory([], [{ id: 1, title: '큰 기록', date: 'd', content: `${'a'.repeat(4e6)} ![](local:img_7)`, images }], Date.now()).list;
    const started = process.hrtime.bigint();
    const tidy = hist.tidyStoredHistory(stored);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.deepStrictEqual(Object.keys(tidy[0].images), ['img_7'], '그 글이 쓰는 그림만 남긴다');
    assert.ok(ms < 1500, `정리에 ${Math.round(ms)}ms 걸렸다`);
});

test('되돌릴 곳: 탭 하나 기록은 남긴 교과에서만 그 차시(최종 평가 포함)를 찾는다', () => {
    const inA = { id: 7, title: 'A의 7' };
    const inB = { id: 7, title: 'B의 7' };
    const subjects = [{ id: 's1', title: 'A', lessons: [inA], mainQuest: { id: 'mainQuest', title: '최종' } }, { id: 's2', title: 'B', lessons: [inB], mainQuest: { id: 'mainQuest' } }];
    const tab = extra => historyRestoreTarget({ tabId: 'basicPrac', lessonId: 7, subjectId: 's1', ...extra }, subjects);
    assert.strictEqual(tab().lesson, inA);
    assert.strictEqual(tab().part, 'basicPrac');
    assert.strictEqual(tab({ subjectId: 's2' }).lesson, inB);
    assert.deepStrictEqual(plainJson(tab({ subjectId: 'gone' })), { mode: 'new', part: 'basicPrac' });
    assert.strictEqual(tab({ subjectId: undefined }).mode, 'new', '교과 id가 없으면 새 차시');
    assert.strictEqual(tab({ lessonId: undefined }).mode, 'new');
    assert.strictEqual(tab({ lessonId: 'mainQuest' }).lesson, subjects[0].mainQuest);
    assert.strictEqual(historyRestoreTarget({ lessonId: 7, tabContents: {} }, subjects).part, null);
});

test('되돌릴 곳·확인 창: 남이 준 기록의 이상한 값으로 멈추지 않는다', () => {
    const odd = { tabId: 'basicLearn', lessonId: { toString: null }, subjectId: { toString: null }, tabContents: 'x', date: { toString: null }, title: { toString: null }, content: { toString: null } };
    const subjects = [{ id: 's1', title: 'A', lessons: [{ id: 1 }], mainQuest: {} }];
    assert.strictEqual(historyRestoreTarget(odd, subjects).mode, 'new');
    assert.strictEqual(historyRestoreTarget({ ...odd, tabId: undefined }, subjects).mode, 'new');
    const message = ctx.historyRestoreMessage(odd, { mode: 'new', part: 'basicLearn' }, null);
    assert.ok(message.text.includes('남긴 교과에서 그 차시를 찾지 못했습니다') && message.done.includes('되살린 교안'));
    assert.strictEqual(ctx.historyRowLabels(odd, { mode: 'new' }).kind, '기본학습 탭');
    assert.strictEqual(lessonFromHistory(odd, 1).tabContents.basicLearn, '', '글이 아닌 내용은 빈 글로 넣는다');
});

test('탭 하나 되돌리기: 그 탭만 바꾸고(옛 단일 본문·탭 없는 최종 평가 포함) 그림은 더하기만 한다', () => {
    const lesson = { id: 1, content: 'a\n\n---\n\nb', images: { x: 'X' }, tabContents: { basicLearn: 'a', basicPrac: 'b', advLearn: null, advPrac: null, assessment: null }, status: 'waiting' };
    ctx.applyHistoryEntry(lesson, { tabId: 'basicPrac', content: '옛 b ![](local:y)', images: { y: png(7), odd: 7 } });
    assert.deepStrictEqual(plainJson(lesson.tabContents), { basicLearn: 'a', basicPrac: '옛 b ![](local:y)', advLearn: null, advPrac: null, assessment: null });
    assert.strictEqual(lesson.content, 'a\n\n---\n\n옛 b ![](local:y)', '합친 글도 맞춘다');
    assert.deepStrictEqual(plainJson(lesson.images), { x: 'X', y: png(7) });
    const textOnly = { id: 9, content: '글', images: {}, tabContents: { basicLearn: '글' } };
    ctx.applyHistoryEntry(textOnly, { tabId: 'basicLearn', content: '글 ![](local:t)', images: { t: 'Y' } });
    assert.deepStrictEqual(plainJson(textOnly.images), {}, '그림이 아닌 글자 값은 차시에 넣지 않는다(묶음 6)');
    assert.strictEqual(lesson.status, 'done');
    const legacy = { id: 2, content: '옛 본문', tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null } };
    ctx.applyHistoryEntry(legacy, { tabId: 'basicPrac', content: '실습' });
    assert.strictEqual(legacy.tabContents.basicLearn, '옛 본문', '옛 단일 본문은 기본학습으로 옮긴 뒤 그 탭을 바꾼다');
    assert.strictEqual(legacy.tabContents.basicPrac, '실습');
    const quest = { id: 'mainQuest', content: '지금 과제' };
    ctx.applyHistoryEntry(quest, { tabId: 'basicLearn', content: '예전 과제' });
    assert.strictEqual(quest.content, '예전 과제');
    assert.strictEqual(quest.tabContents, undefined, '탭이 없는 최종 평가에 탭을 새로 만들지 않는다');
    const whole = { id: 3, content: '지금', images: { k: 'K' }, tabContents: { basicLearn: '지금' } };
    ctx.applyHistoryEntry(whole, { content: '예전', tabContents: { basicLearn: '예전', basicPrac: '실습' }, images: { j: png(8) } });
    assert.deepStrictEqual(plainJson(whole.tabContents), { basicLearn: '예전', basicPrac: '실습' }, '차시 기록은 5개 탭을 모두 바꾼다');
    assert.deepStrictEqual(plainJson(whole.images), { k: 'K', j: png(8) });
});

test('되돌리기의 그림: 찾지 못한 그림 자리·빈 값은 차시의 진짜 그림을 덮지 않고, 차시 쪽이 그림 자리면 기록의 그림으로 채운다', () => {
    const REAL = `data:image/png;base64,${'A'.repeat(80)}`;
    const NEWER = `data:image/png;base64,${'B'.repeat(80)}`;
    const ref = `teacher-image:${'c'.repeat(18)}`; // 백업·폴더에서 그림 파일을 찾지 못한 자리
    // 기본실습이 img_1을 쓴다. 기본학습 기록의 img_1은 그림 파일을 찾지 못한 자리다(지금 기본학습 글은 img_1을 쓰지 않아 '되돌리기 전' 기록에도 남지 않는다)
    const lesson = { id: 1, images: { img_1: REAL, img_2: ref, img_3: REAL }, tabContents: { basicLearn: '지금 글', basicPrac: '그림 ![](local:img_1)', advLearn: null, advPrac: null, assessment: null } };
    const entry = { tabId: 'basicLearn', content: '예전 글 ![](local:img_1) ![](local:img_2) ![](local:img_3) ![](local:img_4)', images: { img_1: ref, img_2: NEWER, img_3: '', img_4: ref } };
    assert.deepStrictEqual(plainJson(ctx.historyImagesFor(lesson, entry)), { img_2: NEWER, img_4: ref });
    ctx.applyHistoryEntry(lesson, entry);
    assert.strictEqual(lesson.images.img_1, REAL, '다른 탭이 쓰는 진짜 그림이 그림 자리로 바뀌지 않는다');
    assert.strictEqual(lesson.images.img_2, NEWER, '차시 쪽이 그림 자리면 기록의 그림으로 채운다');
    assert.strictEqual(lesson.images.img_3, REAL, '빈 값도 진짜 그림을 덮지 않는다');
    assert.strictEqual(lesson.images.img_4, ref, '차시에 없는 그림은 그림 자리라도 넣는다(그림 파일을 채우면 돌아온다)');
    assert.strictEqual(lesson.tabContents.basicLearn, entry.content);
    const regenerated = { id: 2, images: { img_1: NEWER }, tabContents: { basicLearn: '글 ![](local:img_1)' } };
    ctx.applyHistoryEntry(regenerated, { tabId: 'basicLearn', content: '예전 글 ![](local:img_1)', images: { img_1: REAL } });
    assert.strictEqual(regenerated.images.img_1, REAL, '둘 다 진짜 그림이면 예전처럼 기록의 그림(그때 그림)으로 되돌린다');
});

test('탭의 지금 글과 되돌리기 전에 남길 내용', () => {
    const tabs = (extra = {}) => ({ basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null, ...extra });
    assert.strictEqual(ctx.historyPartText({ content: '옛 본문', tabContents: tabs() }, 'basicLearn'), '옛 본문');
    assert.strictEqual(ctx.historyPartText({ content: '실습', tabContents: tabs({ basicPrac: '실습' }) }, 'basicLearn'), '', '다른 탭이 있으면 합친 글을 기본학습으로 보지 않는다');
    assert.strictEqual(ctx.historyPartText({ content: '과제' }, 'assessment'), '과제', '탭이 없으면 본문이 곧 그 탭');
    const lesson = { id: 4, title: '차시', images: { a: 'A' }, tabContents: tabs({ assessment: '평가' }) };
    const item = ctx.historyCurrentItem(lesson, 'assessment');
    assert.strictEqual(item.lesson, lesson);
    assert.deepStrictEqual(plainJson({ ...item, lesson: null }), { title: '차시 · 학습이해도', content: '평가', images: { a: 'A' }, tabId: 'assessment', lesson: null });
    assert.strictEqual(ctx.historyCurrentItem(lesson, null), lesson);
    const quest = ctx.historyCurrentItem({ id: 'mainQuest', title: '👑 최종 평가', content: '과제', images: {} }, 'assessment');
    assert.strictEqual(quest.title, '👑 최종 평가', '탭이 없는 최종 평가는 본문 전체라 제목에 탭 이름을 붙이지 않는다');
    assert.strictEqual(quest.content, '과제');
});

test('새 차시로 되살리기: 탭 하나 기록은 그 탭에 넣고 그림은 글자 값만', () => {
    const lesson = lessonFromHistory({ title: '차시 · 기본실습', content: '실습 ![](local:a)', tabId: 'basicPrac', images: { a: png(5), odd: 1 } }, 5);
    assert.strictEqual(lesson.title, '차시 · 기본실습 (되살림)');
    assert.strictEqual(lesson.tabContents.basicPrac, '실습 ![](local:a)');
    assert.strictEqual(lesson.tabContents.basicLearn, null);
    assert.strictEqual(lesson.content, '실습 ![](local:a)');
    assert.deepStrictEqual(plainJson(lesson.images), { a: png(5) });
    assert.deepStrictEqual(plainJson(lessonFromHistory({ content: '글', images: { a: 'A', '(': png(5) } }, 6).images), {}, '그림이 아닌 값과 바르지 않은 키는 넣지 않는다(묶음 6)');
});

test('되돌리기 확인 창: 무엇을 어디로 되돌리는지 말한다', () => {
    const A = { id: 's1', title: '게임 기획' };
    const B = { id: 's2', title: '레벨 디자인' };
    const tabs = (extra = {}) => ({ basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null, ...extra });
    const lesson = { id: 7, title: '1차시', tabContents: tabs({ assessment: '지금' }) };
    const entry = { date: '어제', tabId: 'assessment', content: '예전', title: '1차시 · 학습이해도' };
    const same = ctx.historyRestoreMessage(entry, { mode: 'replace', subject: A, lesson, part: 'assessment' }, A);
    assert.strictEqual(same.text, "'1차시' 차시의 학습이해도 탭을 이 기록(어제)으로 되돌립니다.\n다른 탭은 그대로 둡니다.\n지금 학습이해도 탭은 작업 기록에 먼저 남겨 다시 되돌릴 수 있습니다.");
    assert.strictEqual(same.okLabel, '되돌리기');
    assert.strictEqual(same.done, "'1차시' 차시의 학습이해도 탭을 되돌렸습니다.");
    const other = ctx.historyRestoreMessage(entry, { mode: 'replace', subject: A, lesson: { ...lesson, tabContents: tabs() }, part: 'assessment' }, B);
    assert.ok(other.text.startsWith("'1차시' 차시(게임 기획 교과)의 학습이해도 탭을"), other.text);
    assert.ok(!other.text.includes('먼저 남겨'), '지금 글이 비었으면 먼저 남긴다고 하지 않는다');
    // 최종 평가는 탭이 없어 본문 전체가 바뀐다. 기록의 탭 id는 그때 열려 있던 탭(currentLessonTab)일 뿐이라 어느 탭이든 탭 이름을 말하지 않는다
    const questLesson = { id: 'mainQuest', title: '👑 최종 평가', content: '과제' };
    ['basicLearn', 'assessment'].forEach(tabId => {
        const quest = ctx.historyRestoreMessage({ ...entry, tabId }, { mode: 'replace', subject: A, lesson: questLesson, part: tabId }, A);
        assert.strictEqual(quest.text, "'👑 최종 평가'의 내용을 이 기록(어제)으로 되돌립니다.\n지금 내용은 작업 기록에 먼저 남겨 다시 되돌릴 수 있습니다.", tabId);
        assert.strictEqual(quest.done, "'👑 최종 평가'의 내용을 되돌렸습니다.", tabId);
        assert.strictEqual(quest.okLabel, '되돌리기');
    });
    const otherQuest = ctx.historyRestoreMessage(entry, { mode: 'replace', subject: A, lesson: { ...questLesson, content: '' }, part: 'assessment' }, B);
    assert.strictEqual(otherQuest.text, "'👑 최종 평가'(게임 기획 교과)의 내용을 이 기록(어제)으로 되돌립니다.", '본문이 비었으면 먼저 남긴다고 하지 않는다');
    const gone = ctx.historyRestoreMessage(entry, { mode: 'new', part: 'assessment' }, B);
    // 남긴 교과에서만 찾으므로(교과 간 이동·휴지통 되살리기로 다른 교과에 있거나 id가 바뀌었을 수 있다) 차시가 '없다'고 하지 않는다
    assert.strictEqual(gone.text, "이 기록(어제)을 남긴 교과에서 그 차시를 찾지 못했습니다.\n'레벨 디자인'에 새 차시로 되살려 학습이해도 탭에 넣습니다.");
    assert.ok(!gone.text.includes('없습니다'), gone.text);
    assert.strictEqual(gone.okLabel, '새 차시로 되살리기');
    assert.strictEqual(gone.done, "'1차시 · 학습이해도 (되살림)' 차시로 되살렸습니다.");
    const old = ctx.historyRestoreMessage({ date: '작년', content: '글' }, { mode: 'new', part: null }, B);
    assert.ok(old.text.endsWith('이 기록에는 탭 구분이 없어 기본학습 칸에 들어갑니다.'), old.text);
    assert.ok(!old.text.includes('예전 기록이라'), '방금 남긴 기록에도 맞는 말로');
    const whole = ctx.historyRestoreMessage({ date: '어제', tabContents: {} }, { mode: 'replace', subject: A, lesson, part: null }, A);
    assert.strictEqual(whole.text, "'1차시' 차시를 이 기록(어제)으로 되돌립니다.\n지금 내용은 작업 기록에 먼저 남겨 다시 되돌릴 수 있습니다.");
});

test('작업 기록 목록 한 줄: 어떤 기록인지와 버튼 이름', () => {
    const tab = { tabId: 'basicPrac' };
    assert.deepStrictEqual(plainJson(ctx.historyRowLabels(tab, { mode: 'replace' })), { kind: '기본실습 탭', button: '되돌리기', tip: '그 차시의 기본실습 탭만 이 기록으로 되돌립니다' });
    assert.deepStrictEqual(plainJson(ctx.historyRowLabels(tab, { mode: 'new' })), { kind: '기본실습 탭', button: '새 차시로 되살리기', tip: '이 기록을 지금 연 교과에 새 차시로 되살립니다' });
    assert.strictEqual(ctx.historyRowLabels({ tabContents: {} }, { mode: 'replace' }).kind, '5개 탭');
    assert.strictEqual(ctx.historyRowLabels({ tabContents: {} }, { mode: 'replace' }).tip, '그 차시를 이 기록으로 되돌립니다');
    assert.strictEqual(ctx.historyRowLabels({}, { mode: 'new' }).kind, '');
    // 최종 평가(탭 없음)를 고친 기록: 기록의 탭 id가 무엇이든 본문 전체를 되돌린다고 말한다
    const quest = { id: 'mainQuest', title: '👑 최종 평가', content: '과제' };
    ['basicLearn', 'assessment'].forEach(tabId => {
        assert.deepStrictEqual(plainJson(ctx.historyRowLabels({ tabId, lessonId: 'mainQuest' }, { mode: 'replace', lesson: quest, part: tabId })), { kind: '최종 평가', button: '되돌리기', tip: '최종 평가를 이 기록으로 되돌립니다' }, tabId);
    });
    const bodyOnly = ctx.historyRowLabels({ tabId: 'basicLearn' }, { mode: 'replace', lesson: { id: 3, content: '옛 본문' }, part: 'basicLearn' });
    assert.deepStrictEqual(plainJson(bodyOnly), { kind: '', button: '되돌리기', tip: '그 차시를 이 기록으로 되돌립니다' }, '탭이 없는 옛 차시도 탭 이름을 말하지 않는다');
    const withTabs = ctx.historyRowLabels({ tabId: 'assessment' }, { mode: 'replace', lesson: { id: 3, tabContents: { assessment: '평가' } }, part: 'assessment' });
    assert.strictEqual(withTabs.kind, '학습이해도 탭', '탭이 있는 차시는 그 탭');
});

test('기록 크기: 글자 수를 더하고 이상한 값과 깊은 값도 견딘다', () => {
    assert.strictEqual(hist.historySizeBytes([{ id: 1, t: 'abc', images: { k: 'xy' } }, null, 'zz']), 'id'.length + 't'.length + 3 + 'images'.length + 'k'.length + 2 + 2);
    let deep = { s: 'x' };
    for (let i = 0; i < 50; i++) deep = { a: deep };
    assert.ok(Number.isFinite(hist.historySizeBytes([deep])));
    assert.strictEqual(hist.historySizeBytes(null), 0);
});

test('저장해 둔 기록 정리: 객체가 아닌 칸만 빼고, 겹치거나 쓸 수 없는 id는 빈 수로 나누며(바른 id는 그대로), 예전 탭 기록은 쓰는 그림만', () => {
    const tidy = hist.tidyStoredHistory([{ id: 5, title: '가' }, { id: 5, title: '나' }, { id: 6 }, null, { id: 'x' }, { id: '7' }, { id: { toString: null } }, { id: true }, { id: '' }, { id: [7] }, { id: 5, title: '다' }, 3]);
    assert.deepStrictEqual(plainJson(tidy.map(item => item.id)), [5, 4, 6, 0, 7, 1, 2, 3, 8, 9], '같은 id는 아래쪽 빈 수로, 쓸 수 없는 id는 0부터(작업 기록 합치기 mergeHistory와 같은 freeHistoryId)');
    assert.deepStrictEqual(plainJson(tidy.map(item => item.title ?? null)), ['가', '나', null, null, null, null, null, null, null, '다'], '이 브라우저의 기록은 id 모양 때문에 지우지 않는다(객체가 아닌 칸만 뺀다)');
    const odd = hist.tidyStoredHistory([{ id: Number.MAX_SAFE_INTEGER }, { id: Number.MAX_SAFE_INTEGER }, { id: 2 ** 53 }, { id: 1.5 }, { id: 1.5 }, { id: 1e300 }, { id: 1e300 }, { id: NaN }, { id: -1 }]);
    assert.strictEqual(odd.length, 9);
    assert.ok(odd.every(item => Number.isSafeInteger(item.id) && item.id >= 0), '모두 화면에서 찾을 수 있는 id');
    assert.strictEqual(new Set(odd.map(item => item.id)).size, 9, '더 나눌 수 없는 큰 id에서도 끝없이 돌지 않고 겹치지 않는다');
    assert.strictEqual(odd[0].id, Number.MAX_SAFE_INTEGER, '바른 id는 그대로');
    const slim = hist.tidyStoredHistory([{ id: 1, content: '![](local:a)', images: { a: png(1), b: png(2) } }, { id: 2, content: '글', tabContents: {}, images: { a: png(1) } }]);
    assert.deepStrictEqual(plainJson(slim.map(item => Object.keys(item.images))), [['a'], ['a']], '차시 기록(5개 탭)은 그대로 둔다');
    const kept = { id: 3, content: '![](local:a)', images: { a: png(1) } };
    assert.strictEqual(hist.tidyStoredHistory([kept])[0], kept, '바꿀 것이 없으면 같은 객체');
    assert.deepStrictEqual(plainJson(hist.tidyStoredHistory([{ id: 4, content: '![](local:a)', images: { a: 'A' } }])[0].images), {}, '그림이 아닌 값은 뺀다(묶음 6)');
    assert.deepStrictEqual(plainJson(hist.tidyStoredHistory(undefined)), []);
    const again = hist.tidyStoredHistory(tidy);
    assert.deepStrictEqual(plainJson(again.map(item => item.id)), plainJson(tidy.map(item => item.id)), '다시 열어도 같은 id');
    assert.deepStrictEqual(plainJson(ctx.mergeHistory(tidy, [], Date.now()).list.map(item => item.id)).sort((a, b) => a - b), plainJson(tidy.map(item => item.id)).sort((a, b) => a - b), '정리한 기록은 합치기에서 id가 다시 바뀌지 않는다');
});

test('새 기록 id: 지금 기록과 겹치지 않는 다음 수', () => {
    assert.deepStrictEqual(plainJson(hist.freshHistoryIds(3, [{ id: 100 }, { id: 102 }], 100)), [101, 103, 104]);
    assert.deepStrictEqual(plainJson(hist.freshHistoryIds(1, [{ id: { toString: null } }, null], 5)), [5]);
});

test('차시가 든 교과 찾기: 연 교과는 화면의 차시 목록으로, 최종 평가도', () => {
    const open = { id: 1 };
    const other = { id: 1 };
    const quest = { id: 'mainQuest' };
    const subjects = [null, { id: 's1', lessons: [], mainQuest: quest }, { id: 's2', lessons: [other] }];
    assert.strictEqual(hist.lessonOwnerId(open, subjects, 's1', [open]), 's1', '교과의 차시 목록이 낡아도 연 교과는 화면 목록에서 찾는다');
    assert.strictEqual(hist.lessonOwnerId(other, subjects, 's1', [open]), 's2');
    assert.strictEqual(hist.lessonOwnerId(quest, subjects, 's2', []), 's1');
    assert.strictEqual(hist.lessonOwnerId({ id: 1 }, subjects, 's1', [open]), null);
    assert.strictEqual(hist.lessonOwnerId(null, subjects, 's1', [open]), null);
});

test('작업 기록 창: 기록 전체를 글 하나로 만들지 않고 크기를 보인다', () => {
    vm.runInContext(stateFn('function updateHistoryBadges('), ctx);
    const badges = { 'history-count-badge': { textContent: '' }, 'history-storage-badge': { textContent: '' } };
    const before = { document: ctx.document, JSON: ctx.JSON, contentHistory: ctx.contentHistory };
    Object.assign(ctx, {
        document: { getElementById: id => badges[id] || null },
        JSON: { parse: JSON.parse, stringify() { throw new Error('기록 전체를 글로 만들면 안 된다'); } },
        contentHistory: [{ id: 1, content: 'x'.repeat(2 * 1024 * 1024), images: {} }]
    });
    try {
        ctx.updateHistoryBadges();
    } finally {
        Object.assign(ctx, before);
    }
    assert.strictEqual(String(badges['history-count-badge'].textContent), '1');
    assert.strictEqual(badges['history-storage-badge'].textContent, '약 2.0 MB');
});

test('작업 기록: 탭 하나만 남기는 네 곳은 모두 그 탭 id와 그 차시를 함께 넘긴다', () => {
    const calls = ['tabs.js', 'course-qbank.js', 'lesson-objectives.js', 'lesson-review.js']
        .flatMap(file => fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8').match(/archiveContent\(\{.*$/gm) || []);
    assert.ok(calls.length >= 4, calls.join('\n')); // 네 곳(다른 묶음이 더해도 모두 탭 id와 차시를 넘겨야 한다)
    calls.forEach(line => assert.ok(/\btabId\b/.test(line) && /\blesson: mod\b/.test(line), line));
});

test('작업 기록 창(state.js): 저장해 둔 기록은 따로 감싼 정리를 거쳐 열고, 창 그리기 실패를 잡고, DB라는 말을 쓰지 않는다', () => {
    assert.ok(!/JSON\.stringify\(contentHistory\)/.test(STATE_SRC), '기록 전체를 글 하나로 만들지 않는다');
    assert.ok(/try \{\n\s*contentHistory = tidyStoredHistory\([^\n]*\n\s*\} catch/.test(STATE_SRC), '정리만 따로 try로 감싼다(정리가 실패해도 예시로 덮어쓰지 않고 저장된 그대로 연다)');
    assert.ok(/renderHistoryUI\(area\)\.catch\(/.test(STATE_SRC));
    assert.ok(!/DB 사용량|DB 용량|용량 측정 API/.test(STATE_SRC));
});

test('모든 js 파일의 맨 위 const·let·class 이름은 서로, 그리고 다른 파일의 맨 위 function 이름과 겹치지 않는다(겹치면 브라우저가 뒤 파일을 통째로 싣지 않는다)', () => {
    const dir = path.join(__dirname, '..', 'js');
    const sources = fs.readdirSync(dir).filter(name => name.endsWith('.js')).map(file => [file, fs.readFileSync(path.join(dir, file), 'utf8')]);
    const owners = new Map();
    const clashes = [];
    sources.forEach(([file, source]) => {
        for (const match of source.matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
            const name = match[1];
            if (owners.has(name) && owners.get(name) !== file) clashes.push(`${name}: ${owners.get(name)}, ${file}`);
            if (!owners.has(name)) owners.set(name, file);
        }
    });
    sources.forEach(([file, source]) => {
        for (const match of source.matchAll(/^(?:async\s+)?(?:function\s*\*?|var)\s*([A-Za-z_$][\w$]*)/gm)) {
            if (owners.has(match[1]) && owners.get(match[1]) !== file) clashes.push(`${match[1]}: ${owners.get(match[1])}, ${file}(function)`);
        }
    });
    assert.deepStrictEqual(clashes, []);
    assert.strictEqual(owners.get('referencedImages'), 'data-safety.js', '그 글이 쓰는 그림 고르기는 data-safety.js 한 곳에만 둔다');
});

testAsync('작업 기록 남기기: 같은 순간에 남겨도 id가 다르고, 교과 id는 그 차시가 든 교과다', async () => {
    vm.runInContext(stateFn('async function archiveContents('), ctx);
    const open = { id: 1, title: '열린 차시', content: '열린 글', tabContents: { basicLearn: '열린 글' } };
    const other = { id: 1, title: '다른 교과 차시', content: '다른 글', tabContents: { basicLearn: '다른 글' } };
    Object.assign(ctx, {
        contentHistory: [], saveState: async () => {}, projectFolderHandle: null, currentSubjectId: 's1', courseData: [open],
        globalState: { subjects: [{ id: 's1', title: 'A', lessons: [], mainQuest: {} }, { id: 's2', title: 'B', lessons: [other], mainQuest: {} }] }
    });
    const realDate = ctx.Date;
    ctx.Date = class extends Date { static now() { return 1000; } }; // 모두 같은 순간(같은 ms)에 남긴다
    try {
        await Promise.all([
            ctx.archiveContents([open]),
            ctx.archiveContents([other], '다시 생성 전'),
            ctx.archiveContents([{ title: '다른 교과 차시 · 기본학습', content: '다른 글', images: {}, tabId: 'basicLearn', lesson: other }]),
            ctx.archiveContents([{ title: '지운 차시 · 기본학습', content: '글', images: {}, tabId: 'basicLearn', lesson: { id: 3 } }])
        ]);
    } finally {
        ctx.Date = realDate;
    }
    const history = ctx.contentHistory;
    assert.deepStrictEqual(plainJson(history.map(item => item.id)), [1000, 1001, 1002, 1003], '같은 순간이어도 id가 겹치지 않는다');
    assert.deepStrictEqual(plainJson(history.map(item => [item.subjectId ?? null, item.lessonId ?? null, item.tabId ?? null])),
        [['s1', 1, null], ['s2', 1, null], ['s2', 1, 'basicLearn'], [null, null, 'basicLearn']]);
    assert.ok(history.every(item => !('lesson' in item)), '차시 객체는 기록에 넣지 않는다');
    assert.strictEqual(history[1].reason, '다시 생성 전');
});

// 되돌리기 시험용 상태: s1 교과의 7차시(학습이해도 '지금 평가'). 연 교과는 s2이고 거기에도 7차시가 있다
function historyRestoreSetup() {
    const asked = [];
    const archived = [];
    const notes = [];
    const inA = { id: 7, title: '7차시', content: '지금 평가', images: {}, tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: '지금 평가' } };
    const inB = { id: 7, title: 'B의 7차시', content: 'B 글', images: {}, tabContents: { basicLearn: 'B 글' } };
    Object.assign(ctx, {
        globalState: { subjects: [{ id: 's1', title: 'A', lessons: [inA], mainQuest: {} }, { id: 's2', title: 'B', lessons: [inB], mainQuest: {} }] },
        currentSubjectId: 's2', courseData: [inB], saveState: async () => {},
        archiveContents: async (items, reason) => { archived.push({ items, reason }); },
        document: { querySelector: () => null, getElementById: () => null }
    });
    Object.assign(ctx.window, {
        showConfirm: (message, onOk, opts) => { asked.push({ message, opts }); onOk(); },
        showToast: (message, type) => notes.push([message, type]),
        showAlert: message => notes.push([message, 'alert'])
    });
    return { asked, archived, notes, inA, inB };
}

testAsync('탭 하나 되돌리기: 남긴 교과의 그 차시의 그 탭만 바꾸고, 지금 글을 먼저 남긴다', async () => {
    const { asked, archived, notes, inA, inB } = historyRestoreSetup();
    ctx.contentHistory = [{ id: 5, title: '7차시 · 학습이해도', date: '어제', lessonId: 7, subjectId: 's1', tabId: 'assessment', content: '예전 평가 ![](local:b)', images: { b: png(3) } }];
    await ctx.restoreHistoryItem(5);
    assert.strictEqual(inA.tabContents.assessment, '예전 평가 ![](local:b)');
    assert.strictEqual(inA.images.b, png(3));
    assert.strictEqual(inB.tabContents.basicLearn, 'B 글', '연 교과의 같은 id 차시는 그대로');
    assert.strictEqual(archived.length, 1);
    assert.strictEqual(archived[0].reason, '되돌리기 전');
    assert.strictEqual(archived[0].items[0].lesson, inA);
    assert.strictEqual(archived[0].items[0].content, '지금 평가');
    assert.strictEqual(archived[0].items[0].tabId, 'assessment');
    assert.ok(asked[0].message.startsWith("'7차시' 차시(A 교과)의 학습이해도 탭을 이 기록(어제)으로 되돌립니다."), asked[0].message);
    assert.strictEqual(asked[0].opts.okLabel, '되돌리기');
    assert.deepStrictEqual(notes.at(-1), ["'7차시' 차시(A 교과)의 학습이해도 탭을 되돌렸습니다.", 'success']);
    await ctx.restoreHistoryItem(5);
    assert.strictEqual(asked.length, 1, '같은 내용이면 확인 창을 띄우지 않는다');
    assert.strictEqual(archived.length, 1, '쓸데없는 되돌리기 전 기록을 만들지 않는다');
    assert.deepStrictEqual(notes.at(-1), ['지금 내용이 이 기록과 같습니다.', 'info']);
});

testAsync('탭 하나 되돌리기: 글이 같아도 차시가 잃은 그림을 기록이 갖고 있으면 되돌려 그림을 돌려놓고, 기록 쪽이 그림 자리뿐이면 같다고 알린다', async () => {
    const { asked, archived, notes, inA } = historyRestoreSetup();
    const REAL = `data:image/png;base64,${'A'.repeat(80)}`;
    const ref = `teacher-image:${'c'.repeat(18)}`;
    inA.tabContents = { ...inA.tabContents, assessment: '지금 평가 ![](local:img_1)' };
    inA.content = inA.tabContents.assessment;
    inA.images = { img_1: ref }; // 폴더를 열 때 이 그림 파일을 찾지 못했다
    ctx.contentHistory = [
        { id: 5, title: '7차시 · 학습이해도', date: '어제', lessonId: 7, subjectId: 's1', tabId: 'assessment', content: '지금 평가 ![](local:img_1)', images: { img_1: REAL } },
        { id: 6, title: '7차시 · 학습이해도', date: '그제', lessonId: 7, subjectId: 's1', tabId: 'assessment', content: '지금 평가 ![](local:img_1)', images: { img_1: ref } }
    ];
    await ctx.restoreHistoryItem(5);
    assert.strictEqual(asked.length, 1, '글이 같아도 그림이 다르면 확인 창을 띄운다');
    assert.strictEqual(inA.images.img_1, REAL, '기록의 그림이 돌아온다');
    assert.strictEqual(archived.length, 1, '지금 내용을 먼저 남긴다');
    assert.deepStrictEqual(notes.at(-1), ["'7차시' 차시(A 교과)의 학습이해도 탭을 되돌렸습니다.", 'success']);
    await ctx.restoreHistoryItem(6);
    assert.strictEqual(asked.length, 1, '기록 쪽이 그림 자리뿐이면 되돌려도 바뀌는 것이 없어 묻지 않는다');
    assert.deepStrictEqual(notes.at(-1), ['지금 내용이 이 기록과 같습니다.', 'info']);
    assert.strictEqual(inA.images.img_1, REAL, '진짜 그림이 그대로 남는다');
});

testAsync('최종 평가 기록 되돌리기: 그때 열려 있던 탭과 상관없이 본문을 되돌리고, 탭 이름을 말하지 않는다', async () => {
    const { asked, archived, notes } = historyRestoreSetup();
    const quest = { id: 'mainQuest', title: '👑 최종 평가', content: '지금 과제', images: {} };
    ctx.globalState.subjects[0].mainQuest = quest;
    ctx.contentHistory = [{ id: 9, title: '👑 최종 평가', date: '어제', lessonId: 'mainQuest', subjectId: 's1', tabId: 'assessment', content: '예전 과제', images: {} }];
    await ctx.restoreHistoryItem(9);
    assert.strictEqual(quest.content, '예전 과제');
    assert.strictEqual(quest.tabContents, undefined, '탭을 새로 만들지 않는다');
    assert.strictEqual(asked[0].message, "'👑 최종 평가'(A 교과)의 내용을 이 기록(어제)으로 되돌립니다.\n지금 내용은 작업 기록에 먼저 남겨 다시 되돌릴 수 있습니다.");
    assert.strictEqual(archived[0].items[0].title, '👑 최종 평가', "'되돌리기 전' 기록 제목에도 탭 이름을 붙이지 않는다");
    assert.strictEqual(archived[0].items[0].content, '지금 과제');
    assert.deepStrictEqual(notes.at(-1), ["'👑 최종 평가'(A 교과)의 내용을 되돌렸습니다.", 'success']);
});

testAsync('차시 기록(5개 탭) 되돌리기는 예전처럼 그 차시를 통째로 바꾸고, 차시 전체를 먼저 남긴다', async () => {
    const { asked, archived, inA } = historyRestoreSetup();
    ctx.contentHistory = [{ id: 8, title: '7차시', date: '그제', lessonId: 7, subjectId: 's1', content: '옛 기본', images: {}, tabContents: { basicLearn: '옛 기본', basicPrac: null, advLearn: null, advPrac: null, assessment: null } }];
    await ctx.restoreHistoryItem(8);
    assert.strictEqual(archived[0].items[0], inA, '되돌리기 전에 차시 전체를 남긴다');
    assert.strictEqual(archived[0].reason, '되돌리기 전');
    assert.deepStrictEqual(plainJson(inA.tabContents), { basicLearn: '옛 기본', basicPrac: null, advLearn: null, advPrac: null, assessment: null });
    assert.strictEqual(inA.content, '옛 기본');
    assert.strictEqual(asked[0].message, "'7차시' 차시(A 교과)를 이 기록(그제)으로 되돌립니다.\n지금 내용은 작업 기록에 먼저 남겨 다시 되돌릴 수 있습니다.");
});

testAsync('차시가 없으면 연 교과에 새 차시로 그 탭에 넣고, 연 교과가 없으면 먼저 알린다', async () => {
    const { asked, notes } = historyRestoreSetup();
    ctx.contentHistory = [{ id: 6, title: '지운 차시 · 기본실습', date: '어제', lessonId: 99, subjectId: 's2', tabId: 'basicPrac', content: '실습 글' }];
    await ctx.restoreHistoryItem(6);
    const added = ctx.courseData.at(-1);
    assert.strictEqual(added.title, '지운 차시 · 기본실습 (되살림)');
    assert.strictEqual(added.tabContents.basicPrac, '실습 글');
    assert.strictEqual(added.tabContents.basicLearn, null);
    assert.ok(Number.isSafeInteger(added.id) && added.id !== 7, String(added.id));
    assert.strictEqual(asked[0].message, "이 기록(어제)을 남긴 교과에서 그 차시를 찾지 못했습니다.\n'B'에 새 차시로 되살려 기본실습 탭에 넣습니다.");
    assert.strictEqual(asked[0].opts.okLabel, '새 차시로 되살리기');
    assert.deepStrictEqual(notes.at(-1), ["'지운 차시 · 기본실습 (되살림)' 차시로 되살렸습니다.", 'success']);
    ctx.currentSubjectId = null;
    await ctx.restoreHistoryItem(6);
    assert.strictEqual(asked.length, 1, '연 교과가 없으면 확인 창을 띄우지 않는다');
    assert.deepStrictEqual(notes.at(-1), ['되살릴 교과를 먼저 여세요(교과 편집기에서 다시 누르세요).', 'alert']);
});

/* ---------- 불러온 상태의 안쪽 값(묶음 6) ---------- */
const W6 = { ...ctx, ...ctx.window };
const plain6 = value => JSON.parse(JSON.stringify(value));
const PNG6 = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(8);
const JPG6 = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const REF6 = 'teacher-image:0123456789abcdef1a';
const sanitize6 = state => ctx.sanitizeState(JSON.parse(JSON.stringify(state)));

test('그림: 앱이 만든 키·값은 그대로(같은 객체), 정규식·속성을 깨는 키와 값은 뺀다', () => {
    const good = {
        img_17300000000001: PNG6, img_mock_123: 'data:image/svg+xml;base64,PHN2Zz4=', ai1x2y3: 'data:image/webp;base64,UklGRg==',
        img_1730: JPG6, gif_1: 'data:image/gif;base64,R0lGODlh', kept_ref: REF6, img_param: 'data:image/png;charset=binary;base64,QUJD'
    };
    assert.strictEqual(W6.safeImageMap(good), good, '고칠 것이 없으면 같은 객체');
    const bad = {
        ...good, '(': PNG6, '(a+)+$': PNG6, 'a b': PNG6, ['x'.repeat(81)]: PNG6,
        num: 5, empty: '', js: 'javascript:alert(1)', html: 'data:text/html;base64,PHNjcmlwdD4=',
        quote: 'data:image/png;base64,AAA" onerror="x', svgText: 'data:image/svg+xml;utf8,<svg onload=alert(1)>',
        upper: 'data:image/PNG;base64,QUJD', under: 'data:image/x_y;base64,QUJD', shortRef: 'teacher-image:abc', noData: 'data:image/png;base64,'
    };
    assert.deepStrictEqual(Object.keys(W6.safeImageMap(bad)).sort(), Object.keys(good).sort());
    assert.deepStrictEqual(plain6(W6.safeImageMap(null)), {});
    assert.deepStrictEqual(plain6(W6.safeImageMap([PNG6])), {});
    assert.strictEqual(W6.isSafeImageKey(JSON.parse('{"toString":null}')), false, '객체 키에도 던지지 않는다');
    assert.strictEqual(W6.isSafeImageKey(5), true);
    assert.strictEqual(W6.isSafeImageValue(JSON.parse('{"toString":null}')), false);
});

test('탭 글: 글이 아니면 빈 탭, 이름이 이상한 탭은 뺀다. 모두 바르면 같은 객체', () => {
    const tabs = { basicLearn: '# 기본', basicPrac: null, advLearn: '심화' };
    assert.strictEqual(W6.safeTabContents(tabs), tabs);
    const out = W6.safeTabContents({ basicLearn: '# 기본', basicPrac: { evil: 1 }, advLearn: 5, advPrac: null, '../x': 'a', 'a b': 'b', '1abc': 'c', __proto__x: 'd', newTab2: '미래 탭' });
    assert.deepStrictEqual(plain6(out), { basicLearn: '# 기본', basicPrac: null, advLearn: null, advPrac: null, newTab2: '미래 탭' });
    assert.strictEqual(W6.safeTabContents('글'), null);
    assert.strictEqual(W6.safeTabContents([]), null);
});

test('차시 안쪽 값: 글·목록·삽화·교수안을 고치고, 바른 값과 없는 칸은 그대로 둔다', () => {
    const lesson = {
        content: { a: 1 }, uploadedMdContent: 7, images: { '(': PNG6, ok_1: PNG6 }, objectives: '목표', tools: [{ name: 'x' }], refImages: null,
        illustrations: [null, { id: 'a', imgId: '(a+)+$' }, { id: 'b', imgId: 'img_1' }, { id: 'c', imgId: null }, { id: 'd', imgId: JSON.parse('{"toString":null}') }],
        tabContents: { basicLearn: { x: 1 } },
        gyosuan: { docMd: '# 교수안', deckMd: {}, deckHtml: 3, sessionDecks: { 0: '<div>1</div>', 1: { x: 1 } }, images: { '(': PNG6, g: PNG6 }, deckRev: 2 }
    };
    W6.cleanLessonFields(lesson);
    assert.strictEqual(lesson.content, null);
    assert.strictEqual(lesson.uploadedMdContent, null);
    assert.deepStrictEqual(Object.keys(lesson.images), ['ok_1']);
    assert.deepStrictEqual(plain6(lesson.objectives), []);
    assert.strictEqual(lesson.tools.length, 1);
    assert.strictEqual(lesson.refImages, null, 'null 목록은 그대로');
    assert.deepStrictEqual(plain6(lesson.illustrations.map(item => item.imgId)), [null, 'img_1', null, null]);
    assert.deepStrictEqual(plain6(lesson.tabContents), { basicLearn: null });
    assert.deepStrictEqual(plain6(lesson.gyosuan), { docMd: '# 교수안', deckMd: null, deckHtml: null, sessionDecks: { 0: '<div>1</div>' }, images: { g: PNG6 }, deckRev: 2 });
    const empty = W6.cleanLessonFields({});
    assert.ok(!('content' in empty) && !('gyosuan' in empty) && !('tabContents' in empty), '없는 칸은 만들지 않는다(그림 목록만 만든다)');
    assert.strictEqual(W6.cleanLessonFields({ gyosuan: null }).gyosuan, null);
    const illustrations = [{ id: 'a', imgId: 'img_1', svg: '<svg/>' }, { id: 'b', imgId: null }];
    assert.strictEqual(W6.cleanLessonFields({ illustrations }).illustrations, illustrations, '바른 삽화 목록은 같은 목록');
});

test('sanitizeState: 바른 차시는 바뀌지 않고(그림·탭·교수안은 같은 객체), 이상한 안쪽 값만 고친다', () => {
    const images = { img_1: PNG6, img_2: JPG6 };
    const tabContents = { basicLearn: '# 기본 <img src="local:img_1">', basicPrac: null, advLearn: '심화', advPrac: null, assessment: '평가' };
    const gyosuan = { docMd: '# 교수안', deckMd: '# 편성안', deckHtml: null, sessionDecks: {}, images: { g1: PNG6 }, deckRev: 3, deckDirty: false, sourceKey: '123', updatedAt: '2026-11-05T00:00:00.000Z' };
    const lesson = { id: 101, title: 'C++ 기초', description: '설명', status: 'done', content: '합친 글', images, tabContents, gyosuan, illustrations: [{ id: 'i1', imgId: 'img_2', svg: '<svg/>' }], objectives: ['목표'], history: [{ at: '2026-11-05T00:00:00.000Z', note: '노트' }] };
    const before = plain6(lesson);
    const state = { courseTitle: '과정', subjects: [{ id: 'subject_1', title: '교과', lessons: [lesson, { id: 102, tabContents: { basicLearn: { x: 1 } }, images: { '(': PNG6 } }], mainQuest: { title: '평가', content: 5, images: { '(': PNG6, m: PNG6 }, tabContents: { basicLearn: [] } } }] };
    const out = ctx.sanitizeState(state);
    const [kept, odd] = out.subjects[0].lessons;
    assert.deepStrictEqual(plain6(kept), before, '앱이 만든 차시는 한 글자도 바뀌지 않는다');
    assert.ok(kept.images === images && kept.tabContents === tabContents && kept.gyosuan === gyosuan, '바른 묶음은 같은 객체(시작할 때 큰 그림 목록을 복사하지 않는다)');
    assert.strictEqual(odd.tabContents.basicLearn, null);
    assert.deepStrictEqual(plain6(odd.images), {});
    const mq = out.subjects[0].mainQuest;
    assert.deepStrictEqual([mq.content, Object.keys(mq.images), plain6(mq.tabContents)], [null, ['m'], { basicLearn: null }]);
    assert.doesNotThrow(() => sanitize6({ subjects: [{ lessons: [{ illustrations: [{ imgId: { toString: null } }] }] }] }), '어떤 값에도 던지지 않는다');
});

test('sanitizeState: 휴지통은 모양을 보고 지운 날짜를 ISO로 맞춘다(먼 미래는 지금으로). 없으면 만들지 않는다', () => {
    const iso = '2026-11-01T00:00:00.000Z';
    const good = { at: iso, lesson: { id: 1, title: '바른' } };
    const out = sanitize6({ subjects: [], lessonTrash: [good, null, { at: 1793836800000, lesson: {} }, { at: '2026-11-05', lesson: {} }, { at: 'abc', lesson: {} }, { at: 8.64e15, lesson: {} }, { at: iso, lesson: 'x' }], subjectTrash: {} });
    assert.strictEqual(out.lessonTrash.length, 5);
    assert.deepStrictEqual(plain6(out.lessonTrash[0]), plain6(good));
    assert.strictEqual(out.lessonTrash[1].at, '2026-11-05T00:00:00.000Z');
    assert.strictEqual(out.lessonTrash[2].at, '2026-11-05T00:00:00.000Z');
    out.lessonTrash.slice(3).forEach(entry => assert.ok(Math.abs(Date.parse(entry.at) - Date.now()) < 60000, '못 읽거나 먼 미래면 지금 시각'));
    assert.deepStrictEqual(plain6(out.subjectTrash), []);
    assert.ok(!('lessonTrash' in sanitize6({ subjects: [] })));
    const now = Date.parse('2026-11-06T00:00:00.000Z');
    const once = W6.validTrash([{ at: 1793836800000, lesson: { id: 2 } }], 'lesson', now);
    assert.deepStrictEqual(plain6(W6.validTrash(once, 'lesson', now)), plain6(once), '다시 해도 같다');
    assert.strictEqual(W6.validTrash(once, 'lesson', now)[0], once[0], '바른 칸은 같은 객체');
    assert.strictEqual(W6.validTrash([{ at: { x: 1 }, lesson: {} }], 'lesson', now)[0].at, '2026-11-06T00:00:00.000Z');
    const rewrite = { at: '2026-11-05T09:00:00.000Z', kind: 'rewrite', subjectId: 's1', lesson: { id: 3 } };
    assert.strictEqual(W6.validTrash([rewrite], 'lesson', now)[0], rewrite, '다시 만들기 전 사본도 그대로(묶음 1)');
});

test('작업 기록 한 칸: id는 숫자로, 있는 칸만 고친다. 바르면 같은 객체, 모양이 틀리면 뺀다', () => {
    const item = { id: 1793836800000, title: '기록', date: '2026. 11. 5.', content: '글 local:a', images: { a: PNG6 }, lessonId: 101, subjectId: 'subject_1', tabContents: { basicLearn: '글' }, reason: '다시 생성 전', tabId: 'basicLearn' };
    assert.strictEqual(W6.cleanHistoryItem(item), item);
    const out = W6.cleanHistoryItem({ id: '1793836800000', title: 7, date: null, content: {}, reason: 3, images: { '(': PNG6, ok: PNG6 }, tabContents: { basicLearn: '글', advLearn: {} }, lessonId: '101', subjectId: 'x" onmouseover="a()', tabId: 'basicLearn' });
    assert.deepStrictEqual(plain6(out), { id: 1793836800000, title: '7', date: '', content: null, reason: '3', images: { ok: PNG6 }, tabContents: { basicLearn: '글', advLearn: null }, lessonId: 101, tabId: 'basicLearn' });
    assert.ok(!('images' in W6.cleanHistoryItem({ id: 5, title: 't' })), '없는 칸은 만들지 않는다');
    assert.strictEqual(W6.cleanHistoryItem({ id: 5, lessonId: 'mainQuest' }).lessonId, 'mainQuest', '최종 평가 기록은 그대로');
    [null, 5, 'x', [], { id: 'abc' }, { id: null }, { id: '' }, { id: true }, { id: ' 12' }, { id: 1.5 }, { id: -1 }].forEach(bad => assert.strictEqual(W6.cleanHistoryItem(bad), null, JSON.stringify(bad)));
    assert.deepStrictEqual(plain6(W6.validHistory([null, { id: 3, title: 'a' }, { id: 'x' }]).map(h => h.id)), [3]);
});

test('저장해 둔 기록 정리: 이 브라우저의 기록은 id가 이상해도 빼지 않고(새 수를 준다) 칸 검사를 거친다', () => {
    const tidy = W6.tidyStoredHistory([{ id: 'x', title: 7, images: { '(': PNG6, ok: PNG6 }, content: '![](local:ok)' }, { id: 5, tabContents: 'x', lessonId: '9' }]);
    assert.strictEqual(tidy.length, 2, '이 브라우저의 기록은 id 모양 때문에 지우지 않는다');
    assert.deepStrictEqual(plain6(tidy[0]), { id: 0, title: '7', images: { ok: PNG6 }, content: '![](local:ok)' });
    assert.deepStrictEqual(plain6(tidy[1]), { id: 5, lessonId: 9 });
    const same = { id: 6, title: '그대로', content: '글', images: { a: PNG6 }, tabContents: { basicLearn: '글' } };
    assert.strictEqual(W6.tidyStoredHistory([same])[0], same);
});

test('작업 기록 합치기: 이 브라우저의 기록과 파일에서 온 같은 기록은 같은 칸 검사를 거쳐 같은 기록으로 알아본다', () => {
    const record = { id: 10, title: '기록', date: 'd', reason: '다시 생성 전', lessonId: '7', subjectId: 's1', content: { x: 1 }, tabContents: { basicLearn: '글', advLearn: { x: 1 }, '../x': 'y' } };
    const mine = W6.tidyStoredHistory([plain6(record)]);
    const merged = ctx.mergeHistory(mine, [plain6(record)], Date.parse('2026-11-06T00:00:00.000Z'));
    assert.strictEqual(merged.list.length, 1, '파일의 같은 기록을 또 넣지 않는다');
    assert.strictEqual(merged.list[0], mine[0]);
});

test('백업·폴더 기록 합치기도 칸마다 검사한다(같은 기록은 지금 것 그대로)', () => {
    const mine = { id: 3, title: '지금', date: 'd1' };
    const merged = ctx.mergeBackupExtras({ history: [null, { id: 1, title: '파일', images: { '(': PNG6, ok: PNG6 }, tabContents: { basicLearn: {} } }] }, { history: [mine], lessonTrash: [], subjectTrash: [] });
    assert.deepStrictEqual(plain6(merged.history.map(h => h.id)), [1, 3]);
    assert.deepStrictEqual(Object.keys(merged.history[0].images), ['ok']);
    assert.strictEqual(merged.history[0].tabContents.basicLearn, null);
    assert.strictEqual(merged.history[1], mine, '지금 기록은 같은 객체');
});

test('기록의 그림을 차시에 넣는 길(historyImages)도 차시 그림과 같은 규칙(바른 키, 그림 값·찾지 못한 그림 자리)', () => {
    assert.deepStrictEqual(plain6(W6.historyImages({ images: { ok: PNG6, ref: REF6, '(': PNG6, text: 'A', num: 1, empty: '' } })), { ok: PNG6, ref: REF6 });
    assert.deepStrictEqual(plain6(W6.historyImages({ images: null })), {});
});

test('백업 MD: 제목을 글자 그대로 비교하고, 제목이 꼭 같은 파일을 한 번씩만 쓴다', () => {
    ['C++ 기초', '1) 개요', '(a+)+$', '[심화] 자료 (스택', 'a\\b'].forEach(title => {
        assert.strictEqual(W6.backupMarkdownBody(`# ${title}\n\n본문`, title), '본문', title);
        assert.strictEqual(W6.backupMarkdownBody(`# ${title}\r\n\r\n본문`, title), '본문', `${title} CRLF`);
    });
    assert.strictEqual(W6.backupMarkdownBody('---\nk: v\n---\n\n본문', 'x'), '본문');
    assert.strictEqual(W6.backupMarkdownBody('# 다른 제목\n\n본문', 'x'), '# 다른 제목\n\n본문');
    const files = ['# 개요 심화\n\n심화 글', '# 개요\n\n첫 글', '# 개요\n\n둘째 글'].map(content => ({ path: 'a.md', content }));
    const used = new Set();
    assert.strictEqual(W6.takeBackupMarkdown(files, '심화', used), null, '제목 일부만 같으면 쓰지 않는다');
    assert.strictEqual(W6.takeBackupMarkdown(files, '개요', used).content, '# 개요\n\n첫 글');
    assert.strictEqual(W6.takeBackupMarkdown(files, '개요', used).content, '# 개요\n\n둘째 글');
    assert.strictEqual(W6.takeBackupMarkdown(files, '개요', used), null);
});

test('백업 MD 첨부 그림: 바른 키만 되돌리고, 이미 있는 그림은 바꾸지 않으며(찾지 못한 그림 자리는 채운다), 이상한 이름에도 멈추지 않는다', () => {
    const attached = new Map([['img_1.png', PNG6], ['img_2.jpg', JPG6], ['(a+)+$.png', PNG6], ['img_3.svg', 'data:image/png;base64,AA" x'], ['constructor.png', PNG6], ['__proto__.png', PNG6]]);
    const md = '![a](../첨부파일/img_1.png) ![b](../첨부파일/(a+)+$.png) <img src="../첨부파일/img_3.svg"> ![c](../첨부파일/img_2.jpg) ![d](../첨부파일/img_9.png) ![e](../첨부파일/constructor.png) ![f](../첨부파일/__proto__.png)';
    const kept = { img_2: JPG6 };
    const out = W6.relinkAttachedImages(md, attached, kept);
    assert.ok(out.content.startsWith('<!-- [IMG: "local:img_1"] --> ![b](../첨부파일/(a+)+$.png) <img src="local:img_3"> <!-- [IMG: "local:img_2"] --> <!-- [IMG: "local:img_9"] -->'));
    assert.deepStrictEqual(Object.keys(out.images).sort(), ['__proto__', 'constructor', 'img_1', 'img_2'].sort());
    assert.strictEqual(out.images.img_2, JPG6);
    assert.strictEqual(({}).polluted, undefined);
    assert.strictEqual(Object.getPrototypeOf(out.images), vm.runInContext('Object.prototype', ctx), '프로토타입은 바뀌지 않는다');
    assert.strictEqual(W6.relinkAttachedImages('![a](../첨부파일/img_1.png)', attached, { img_1: REF6 }).images.img_1, PNG6, '찾지 못한 그림 자리는 첨부 그림으로 채운다');
    const subject = { lessons: [{ title: 'C++ 기초', content: '옛 글', images: {} }, { title: '다른', content: '그대로', images: {} }] };
    W6.applyBackupMarkdown(subject, [{ path: 'x/01.md', content: '# C++ 기초\r\n\r\n새 글 ![a](../첨부파일/img_1.png)' }], attached);
    assert.deepStrictEqual(plain6(subject.lessons.map(l => l.content)), ['새 글 <!-- [IMG: "local:img_1"] -->', '그대로']);
    assert.strictEqual(subject.lessons[0].images.img_1, PNG6);
    assert.strictEqual(W6.applyBackupMarkdown(undefined, [], attached), undefined);
});

test('백업 ZIP·PC 폴더 MD의 첨부 그림: id를 정규식에 넣지 않고 글자 그대로 바꾼다', () => {
    const png = 'data:image/png;base64,QUJD';
    const jpg = 'data:image/jpeg;base64,REVG';
    const md = '<!-- [IMG: "local:img_1"] --> <!-- [IMG: local:img_1] --> <img src="local:img_1"> <img src="local:img_10"> <img src="local:(a+)+$"> ![](local:img_1) <!-- [IMG: "local:none"] -->';
    const out = W6.attachmentImages(md, { img_1: png, img_10: jpg, '(a+)+$': png, svg: 'data:image/svg+xml;base64,PHN2Zz4=', bad: 5 });
    assert.strictEqual(out.content, '![img_1](../첨부파일/img_1.png) ![img_1](../첨부파일/img_1.png) <img src="../첨부파일/img_1.png"> <img src="../첨부파일/img_10.jpg"> <img src="../첨부파일/(a+)+$.png"> ![](local:img_1) <!-- [IMG: "local:none"] -->');
    assert.deepStrictEqual(plain6(out.files.map(f => f.name)), ['img_1.png', 'img_10.jpg', '(a+)+$.png'], 'svg와 글이 아닌 값은 파일로 쓰지 않는다(예전과 같음)');
    assert.strictEqual(out.files[0].base64, 'QUJD');
    assert.strictEqual(W6.relinkLocalImages('src="local:img_10"', new Map([['img_1', 'img_1.png']])), 'src="local:img_10"', 'img_1이 img_10을 건드리지 않는다');
    const started = Date.now();
    W6.attachmentImages('local:' + 'a'.repeat(5000) + '!', { '(a+)+$': png });
    assert.ok(Date.now() - started < 200, '멈추지 않는다');
});

test('그림 id·제목으로 정규식을 만들지 않는다(되돌아옴 방지)', () => {
    const re = /new RegExp\(`[^`]*\$\{(?:imgId|id|key|[\w.]*[tT]itle)\}/;
    ['state.js', 'api.js', 'course-illustrations.js', 'data-safety.js'].forEach(file => {
        assert.ok(!re.test(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8')), file);
    });
    assert.ok(!/new RegExp\(/.test(fs.readFileSync(path.join(__dirname, '..', 'js', 'course-illustrations.js'), 'utf8')), '삽화 블록은 정해 둔 정규식으로 찾고 id를 글자 그대로 견준다');
});

test('읽지 못한 저장본 내려받기: 조각을 이으면 JSON.stringify와 같다(아주 큰 저장본도 글 하나로 만들지 않는다)', () => {
    const sparse = [1];
    sparse[3] = 'x';
    const values = [
        { state: { courseTitle: '과정 "따옴표" \\ 역슬래시', subjects: [{ id: 's1', lessons: [{ id: 1, images: { a: PNG6 }, n: NaN, u: undefined, f() {} }] }] }, history: [null, 1.5, true, '줄\n바꿈', [undefined, () => 1]] },
        { d: new Date(Date.UTC(2026, 10, 6)), empty: {}, list: [], deep: { a: { b: { c: [{}] } } }, 숫자키: { 2: 'b', 1: 'a' } },
        sparse, 'x', 7, null
    ];
    values.forEach(value => [1, 5, 64, 1 << 20].forEach(size => {
        const parts = W6.jsonTextParts(value, size);
        assert.strictEqual(parts.join(''), JSON.stringify(value), `${JSON.stringify(value).slice(0, 30)} / ${size}`);
        if (size === 5) assert.ok(parts.length > 1 || JSON.stringify(value).length <= 5, '조각으로 나눈다');
    }));
});

test('읽지 못한 저장본 사본은 새것 셋만 남긴다(이 모양이 아닌 이름은 건드리지 않는다)', () => {
    const prefix = 'k:읽지못함:';
    const keys = [`${prefix}100`, `${prefix}400`, 'k', `${prefix}메모`, `${prefix}300`, `${prefix}200`, 5, `${prefix}12a`];
    assert.deepStrictEqual(plain6(W6.staleUnreadCopies(keys, prefix, 3)), [`${prefix}100`]);
    assert.deepStrictEqual(plain6(W6.staleUnreadCopies(keys, prefix, 1)), [`${prefix}300`, `${prefix}200`, `${prefix}100`]);
    assert.deepStrictEqual(plain6(W6.staleUnreadCopies(null, prefix, 3)), []);
});

test("'저장해 둔 폴더 열기' 확인 창: 읽지 못한 저장본 대신 열 때는 백업을 받지 않는다고 말한다", () => {
    const unread = W6.folderOpenPrompt({ folderName: '내 폴더', subjectCount: 0, incomingCount: 2, unread: true });
    assert.ok(unread.message.startsWith("읽지 못한 브라우저 저장본 대신 '내 폴더' 폴더의 작업(교과 2개)으로 엽니다.\n읽지 못한 저장본은 이 폴더 내용으로 바뀝니다."), unread.message);
    assert.ok(!unread.message.includes('백업 파일로 내려받습니다'));
    assert.strictEqual(unread.okLabel, '이 폴더로 되살리기');
    assert.strictEqual(W6.folderOpenPrompt({ folderName: 'A', subjectCount: 1, incomingCount: 2, unread: true, total: 2, missing: 1 }).okLabel, '빠진 채로 열기');
    const normal = W6.folderOpenPrompt({ folderName: 'A', subjectCount: 1, incomingCount: 2 });
    assert.ok(normal.message.startsWith("'A' 폴더의 작업(교과 2개)으로 지금 브라우저의 모든 작업(교과 1개)을 바꿉니다."));
    assert.strictEqual(normal.okLabel, '백업 받고 바꾸기');
});

test('폴더를 연 뒤 알림: 읽지 못한 상태에서 열어 브라우저에 저장하지 못했으면 새로고침 뒤 열기 전 작업이 아니라 읽지 못한 창이 다시 뜰 수 있다고 말한다', () => {
    const unread = W6.folderOpenedMessage({ folderName: 'A', browserSaved: false, unread: true });
    assert.ok(unread.includes("'저장된 작업을 읽지 못했습니다' 창이 다시 뜰 수 있으니") && unread.includes("그 창의 '저장해 둔 폴더 열기'로 이 폴더를 다시 여세요"), unread);
    assert.ok(!unread.includes('열기 전 작업이 보일'), unread);
    assert.ok(W6.folderOpenedMessage({ folderName: 'A', browserSaved: false }).includes('열기 전 작업이 보일 수 있으니'), '읽은 상태에서 열었으면 그대로');
    assert.strictEqual(W6.folderOpenedMessage({ folderName: 'A', unread: true }), W6.folderOpenedMessage({ folderName: 'A' }), '브라우저에 저장했으면 같은 글');
});

test('폴더의 저장본을 풀지 못했으면 교과가 없다고 하지 않고 읽을 수 없다고 알린다(save_data.yaml이면 열 때 남긴 사본으로 여는 길)', () => {
    const yaml = W6.folderSaveUnreadableText('save_data.yaml');
    assert.ok(yaml.startsWith('이 폴더의 저장본(save_data.yaml)을 읽을 수 없습니다.') && yaml.includes('지금 작업은 바뀌지 않았습니다') && yaml.includes('save_data_이전_날짜.yaml 사본'), yaml);
    assert.ok(!yaml.includes('교과가 없습니다'), yaml);
    const json = W6.folderSaveUnreadableText('save_data.json');
    assert.ok(json.startsWith('이 폴더의 저장본(save_data.json)을 읽을 수 없습니다.') && !json.includes('save_data_이전'), '예전 save_data.json 폴더는 사본을 만들지 않는다');
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
