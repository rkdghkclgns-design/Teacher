// 그림 → 판서 영상 바꾸기 테스트 (실행: node tests/whiteboard-video.test.js)
// 실제 whiteboard-link.js·whiteboard-video.js를 실행하고, 스튜디오가 영상을 넣는 IndexedDB(teacher-whiteboard-inbox)와
// Teacher 저장소(DBManager)는 tests/whiteboard-harness.js에서 흉내 낸다. 받는 쪽 형식은 스튜디오 src/lib/teacherInbox.ts와 같다
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { HANDOFF_KEY, REQUESTS_KEY, lesson, makeContext, runTests } = require('./whiteboard-harness');

const SECTIONED = [
    '# 1차시: 개념 이해',
    '',
    '## 1. 게임 기획이란',
    '',
    '기획은 재미를 설계하는 일이다.',
    '',
    '### ■ 시나리오 및 세계관 기획 (Narrative Design)',
    '',
    '세계관은 이야기의 무대다. 인물과 세력의 관계를 정한다.',
    '',
    '<div class="image-wrapper"><img src="local:img_story"><button class="image-regenerate-btn" data-img-id="img_story"></button></div>',
    '',
    '- 주인공의 목표',
    '- 갈등 구조',
    '',
    '### ■ 레벨 디자인',
    '',
    '난이도 곡선을 만든다.',
    '',
    '## 2. 다음 절',
    '',
    '다른 내용'
].join('\n');

const storyLesson = () => lesson({ tabContents: { basicLearn: SECTIONED }, images: { img_story: 'data:image/png;base64,STORY' } });
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('그림이 든 절만 뽑는다: 가까운 위 제목부터 같은 단계의 다음 제목 앞까지, 그림은 빼고', () => {
    const ctx = makeContext({ files: ['whiteboard-video.js'] });
    const section = ctx.whiteboardSectionFor(SECTIONED, 'img_story');
    assert.strictEqual(section.heading, '시나리오 및 세계관 기획 (Narrative Design)');
    assert.ok(section.found);
    assert.ok(section.markdown.includes('세계관은 이야기의 무대다'));
    assert.ok(section.markdown.includes('- 갈등 구조'));
    assert.ok(!section.markdown.includes('레벨 디자인'), '다음 같은 단계 제목에서 끊는다');
    assert.ok(!/<|local:|다시 생성/.test(section.markdown), `그림 틀·버튼·태그가 남으면 안 된다: ${section.markdown}`);
});

test('그림 틀·이미지 자리·버튼은 빼고 그림 설명과 글은 남긴다', () => {
    const ctx = makeContext({ files: ['whiteboard-video.js'] });
    const md = [
        '세계관 설명 <b>굵게</b>',
        '<div class="image-wrapper"><img src="local:img_a" alt="관계도"><button class="image-regenerate-btn" data-img-id="img_a">다시 생성</button></div>',
        '<div class="image-placeholder"><span>이미지 영역: 레벨</span><button data-lesson-action="regenerate-image">🔄 다시 검색</button></div>',
        '| 항목 | 값 |\n| --- | --- |\n| 목표 | 탈출 |'
    ].join('\n\n');
    const plain = ctx.whiteboardPlainMarkdown(md);
    assert.ok(plain.includes('세계관 설명 굵게'));
    assert.ok(plain.includes('(그림: 관계도)'));
    assert.ok(plain.includes('| 목표 | 탈출 |'), '마크다운 표는 그대로');
    assert.ok(!/<|다시 생성|다시 검색|이미지 영역/.test(plain), plain);
});

test("'■ 제목' 굵은 소제목 줄도 절의 시작으로 본다", () => {
    const ctx = makeContext({ files: ['whiteboard-video.js'] });
    const md = '## 큰 절\n\n앞 글\n\n**■ 캐릭터 설계**\n\n인물의 동기를 정한다.\n\n![그림](local:img_a)\n\n**■ 다음 소제목**\n\n다른 글';
    const section = ctx.whiteboardSectionFor(md, 'img_a');
    assert.strictEqual(section.heading, '캐릭터 설계');
    assert.ok(section.markdown.includes('인물의 동기') && !section.markdown.includes('다른 글') && !section.markdown.includes('앞 글'));
});

test('제목이 없거나 그림을 못 찾으면 탭 전체를 쓴다', () => {
    const ctx = makeContext({ files: ['whiteboard-video.js'] });
    const section = ctx.whiteboardSectionFor('첫 줄\n\n둘째 줄', 'img_none');
    assert.strictEqual(section.heading, '');
    assert.strictEqual(section.found, false);
    assert.ok(section.markdown.includes('첫 줄') && section.markdown.includes('둘째 줄'));
});

test('검토 V4-05: 코드 블록 안의 # 주석 줄·■ 줄은 절 제목으로 보지 않는다(그림 앞뒤의 # 주석으로 시작하는 python 블록)', () => {
    const ctx = makeContext({ files: ['whiteboard-video.js'] });
    const PY = (...lines) => ['```python', ...lines, '```'].join('\n');
    const loop = PY('# 목록의 합계를 구합니다', 'total = 0', 'for n in [1, 2, 3]:', '    total += n  # 값을 하나씩 더합니다', 'print(total)');
    const DATA = `data:image/png;base64,${'A'.repeat(4000)}`;
    const md = [
        '## 1. 변수 (⏱ 30분)', '', '값을 담습니다.', '',
        '## 2. 반복문 (⏱ 30분)', '', '목록의 값을 하나씩 더합니다.', '',
        loop, '', '```text', '■ 실행 결과', '6', '```', '',
        '<!-- [IMG: loop diagram] -->',
        '<div class="image-wrapper"><img src="local:img_loop" alt="반복 그림"></div>', '',
        `![붙여 넣은 그림](${DATA})`, '', '반복이 끝나면 합계를 찍습니다.', '',
        '```bash', '## 설치 확인', 'python --version', '```', '',
        '## 3. 조건문 (⏱ 30분)', '', '조건에 따라 나눕니다.', '',
        PY('# 점수에 따라 등급을 고릅니다', 'score = 90', 'if score >= 80:', '    print("A")')
    ].join('\n');
    const section = ctx.whiteboardSectionFor(md, 'img_loop');
    assert.strictEqual(section.heading, '반복문 (⏱ 30분)');
    assert.ok(section.markdown.startsWith('## 2. 반복문 (⏱ 30분)\n\n목록의 값을 하나씩 더합니다.'), section.markdown);
    assert.ok(section.markdown.includes(loop) && section.markdown.includes('```bash\n## 설치 확인\npython --version\n```'), '코드 블록은 통째로 그대로 넘긴다');
    assert.ok(!section.markdown.includes('조건문') && !section.markdown.includes('점수에 따라'), `다음 절은 넘기지 않는다: ${section.markdown}`);
    assert.ok(section.markdown.includes('(그림: 반복 그림)') && section.markdown.includes('(그림: 붙여 넣은 그림)'), section.markdown);
    assert.ok(!/<img|<div|<!--|data:image/.test(section.markdown), `그림 틀·주석·data: 주소는 뺀다: ${section.markdown.slice(0, 300)}`);
});

test('판서 영상으로 바꾸기: 절 내용으로 창을 열고, 돌려받을 곳(returnTo)과 요청을 남긴다', () => {
    const mod = storyLesson();
    const ctx = makeContext({ mod, files: ['whiteboard-video.js'] });
    ctx.replaceImageWithWhiteboard('img_story');
    assert.ok(/그림 자리를 판서 영상으로 바꿉니다/.test(ctx.dialogs[0].subtitle));
    const handoff = JSON.parse(ctx.storage[HANDOFF_KEY]);
    assert.strictEqual(handoff.topic, '시나리오 및 세계관 기획 (Narrative Design)');
    assert.ok(handoff.markdown.includes('세계관은 이야기의 무대다') && !handoff.markdown.includes('난이도 곡선'));
    assert.match(handoff.returnTo.requestId, /^wb_[A-Za-z0-9]{8,}$/);
    assert.strictEqual(handoff.returnTo.label, '개념 이해 › 시나리오 및 세계관 기획 (Narrative Design)');
    const requests = JSON.parse(ctx.storage[REQUESTS_KEY]);
    assert.deepStrictEqual(Object.keys(requests), [handoff.returnTo.requestId]);
    const req = requests[handoff.returnTo.requestId];
    assert.deepStrictEqual([req.subjectId, req.lessonId, req.tabId, req.imgId], ['s1', 7, 'basicLearn', 'img_story']);
    assert.ok(/스튜디오의 'Teacher로 보내기'/.test(ctx.toasts[0]));
});

test('창을 취소하면 요청을 남기지 않는다', () => {
    const ctx = makeContext({ mod: storyLesson(), files: ['whiteboard-video.js'], dialogEdit: null });
    ctx.replaceImageWithWhiteboard('img_story');
    assert.strictEqual(ctx.storage[REQUESTS_KEY], undefined);
    assert.strictEqual(ctx.storage[HANDOFF_KEY], undefined);
});

test('돌아온 영상을 그 그림 자리에 붙이고, 받은편지함에서 지우고, 보는 중이면 다시 그린다', async () => {
    const mod = storyLesson();
    const now = Date.now();
    const request = { subjectId: 's1', lessonId: 7, tabId: 'basicLearn', imgId: 'img_story', label: '개념 이해 › 시나리오', createdAt: now };
    const ctx = makeContext({ mod, files: ['whiteboard-video.js'], stored: { [REQUESTS_KEY]: JSON.stringify({ wb_abcdef1234: request }) } });
    const blob = new Blob(['video-bytes'], { type: 'video/mp4' });
    ctx.inbox = [{ requestId: 'wb_abcdef1234', blob, extension: 'mp4', title: '세계관', createdAt: now }];
    const placed = await ctx.collectWhiteboardVideos();
    assert.strictEqual(placed.length, 1);
    assert.deepStrictEqual({ ...mod.whiteboardVideos.img_story, at: 0 }, { id: 'wb_abcdef1234', title: '세계관', ext: 'mp4', at: 0 });
    assert.strictEqual(ctx.db['wbvideo:wb_abcdef1234'], blob);
    assert.deepStrictEqual(ctx.inbox, []);
    assert.strictEqual(ctx.saves, 1);
    assert.deepStrictEqual(ctx.applied, [mod]);
    assert.ok(/판서 영상으로 바꿨습니다/.test(ctx.toasts[0]));
    assert.ok(JSON.parse(ctx.storage[REQUESTS_KEY]).wb_abcdef1234, '같은 그림으로 다시 보내면 또 바꿀 수 있게 요청은 남긴다');
    assert.strictEqual(mod.tabContents.basicLearn, SECTIONED, '교안 글은 바꾸지 않는다');
});

test('같은 그림에 새 영상이 오면 예전 영상 파일을 지운다', async () => {
    const mod = { ...storyLesson(), whiteboardVideos: { img_story: { id: 'wb_old0000001', title: '예전', ext: 'mp4', at: 1 } } };
    const now = Date.now();
    const request = { subjectId: 's1', lessonId: 7, tabId: 'basicLearn', imgId: 'img_story', label: 'x', createdAt: now };
    const ctx = makeContext({ mod, files: ['whiteboard-video.js'], stored: { [REQUESTS_KEY]: JSON.stringify({ wb_new0000001: request }) } });
    ctx.db['wbvideo:wb_old0000001'] = new Blob(['old']);
    ctx.inbox = [{ requestId: 'wb_new0000001', blob: new Blob(['new']), extension: 'webm', title: '새', createdAt: now }];
    await ctx.collectWhiteboardVideos();
    assert.strictEqual(mod.whiteboardVideos.img_story.id, 'wb_new0000001');
    assert.strictEqual(ctx.db['wbvideo:wb_old0000001'], undefined);
});

test('요청한 차시를 아직 못 찾으면(불러오는 중 등) 받은편지함에 남겨 두고, 요청이 없는 오래된 영상은 지운다', async () => {
    const now = Date.now();
    const request = { subjectId: 'other', lessonId: 99, tabId: 'basicLearn', imgId: 'img_x', label: 'x', createdAt: now };
    const ctx = makeContext({ files: ['whiteboard-video.js'], stored: { [REQUESTS_KEY]: JSON.stringify({ wb_keep000001: request }) } });
    ctx.inbox = [
        { requestId: 'wb_keep000001', blob: new Blob(['a']), extension: 'mp4', createdAt: now },
        { requestId: 'wb_stale00001', blob: new Blob(['b']), extension: 'mp4', createdAt: now - 8 * 24 * 3600 * 1000 }
    ];
    const placed = await ctx.collectWhiteboardVideos();
    assert.strictEqual(placed.length, 0);
    assert.deepStrictEqual(ctx.inbox.map(r => r.requestId), ['wb_keep000001']);
    assert.strictEqual(ctx.saves, 0);
});

test('원래 그림으로 되돌리면 영상 기록과 파일을 지운다', async () => {
    const mod = { ...storyLesson(), whiteboardVideos: { img_story: { id: 'wb_vid0000001', title: 't', ext: 'mp4', at: 1 }, img_other: { id: 'wb_vid0000002', title: 'u', ext: 'mp4', at: 1 } } };
    const ctx = makeContext({ mod, files: ['whiteboard-video.js'] });
    ctx.db['wbvideo:wb_vid0000001'] = new Blob(['v']);
    await ctx.revertWhiteboardVideo('img_story');
    assert.deepStrictEqual(Object.keys(mod.whiteboardVideos), ['img_other']);
    assert.strictEqual(ctx.db['wbvideo:wb_vid0000001'], undefined);
    assert.strictEqual(ctx.saves, 1);
});

// 일괄 다시 만들기의 '다시 만들기 전' 사본(휴지통)과 그 사본을 되살린 차시는 다시 만든 차시와 같은 영상 파일을 가리킨다
test('되돌려도 휴지통의 사본이나 다른 차시가 같은 영상 파일을 쓰면 파일은 남긴다', async () => {
    const video = { id: 'wb_vid0000001', title: 't', ext: 'mp4', at: 1 };
    const mod = { ...storyLesson(), whiteboardVideos: { img_story: video } };
    const ctx = makeContext({ mod, files: ['whiteboard-video.js'] });
    ctx.db['wbvideo:wb_vid0000001'] = new Blob(['v']);
    ctx.globalState.lessonTrash = [{ lesson: { ...storyLesson(), whiteboardVideos: { img_story: { ...video } } }, subjectId: 's1', at: new Date().toISOString(), reason: '다시 만들기 전', kind: 'rewrite' }];
    await ctx.revertWhiteboardVideo('img_story');
    assert.deepStrictEqual(Object.keys(mod.whiteboardVideos), [], '이 차시는 원래 그림으로 돌아간다');
    assert.ok(ctx.db['wbvideo:wb_vid0000001'], '휴지통의 사본이 쓰는 영상 파일은 남긴다');
    ctx.globalState.lessonTrash = [];
    ctx.globalState.subjectTrash = [{ subject: { id: 's9', title: '지운 교과', lessons: [{ id: 3, whiteboardVideos: { img_story: { ...video } } }] }, at: new Date().toISOString() }];
    mod.whiteboardVideos = { img_story: video };
    await ctx.revertWhiteboardVideo('img_story');
    assert.ok(ctx.db['wbvideo:wb_vid0000001'], '휴지통의 교과가 쓰는 영상 파일도 남긴다');
    ctx.globalState.subjectTrash = [];
    mod.whiteboardVideos = { img_story: video };
    await ctx.revertWhiteboardVideo('img_story');
    assert.strictEqual(ctx.db['wbvideo:wb_vid0000001'], undefined, '아무도 쓰지 않으면 지운다');
});

test('같은 그림에 새 영상이 와도 되살린 차시가 예전 영상을 쓰면 그 파일은 남긴다', async () => {
    const old = { id: 'wb_old0000001', title: '예전', ext: 'mp4', at: 1 };
    const mod = { ...storyLesson(), whiteboardVideos: { img_story: old } };
    const now = Date.now();
    const request = { subjectId: 's1', lessonId: 7, tabId: 'basicLearn', imgId: 'img_story', label: 'x', createdAt: now };
    const ctx = makeContext({ mod, files: ['whiteboard-video.js'], stored: { [REQUESTS_KEY]: JSON.stringify({ wb_new0000001: request }) } });
    ctx.globalState.subjects[0].lessons.push({ ...storyLesson(), id: 8, title: '1차시: 개념 이해 (복원)', whiteboardVideos: { img_story: { ...old } } });
    ctx.db['wbvideo:wb_old0000001'] = new Blob(['old']);
    ctx.inbox = [{ requestId: 'wb_new0000001', blob: new Blob(['new']), extension: 'webm', title: '새', createdAt: now }];
    await ctx.collectWhiteboardVideos();
    assert.strictEqual(mod.whiteboardVideos.img_story.id, 'wb_new0000001');
    assert.ok(ctx.db['wbvideo:wb_old0000001'], '되살린 차시의 영상 파일은 남긴다');
});

test('영상을 기다리는 동안 그 그림을 지웠으면 붙이지 않고(보이지 않는 영상이 파일을 붙잡지 않게) 받은편지함에서 지운 뒤 알린다', async () => {
    const mod = { ...storyLesson(), tabContents: { basicLearn: SECTIONED.replace('<div class="image-wrapper"><img src="local:img_story"><button class="image-regenerate-btn" data-img-id="img_story"></button></div>', '') } };
    const now = Date.now();
    const request = { subjectId: 's1', lessonId: 7, tabId: 'basicLearn', imgId: 'img_story', label: '개념 이해 › 시나리오', createdAt: now };
    const ctx = makeContext({ mod, files: ['whiteboard-video.js'], stored: { [REQUESTS_KEY]: JSON.stringify({ wb_gone0000001: request }) } });
    ctx.inbox = [{ requestId: 'wb_gone0000001', blob: new Blob(['v']), extension: 'mp4', title: '세계관', createdAt: now }];
    const placed = await ctx.collectWhiteboardVideos();
    assert.deepStrictEqual([placed.length, mod.whiteboardVideos, ctx.db['wbvideo:wb_gone0000001'], ctx.inbox.length, ctx.saves], [0, undefined, undefined, 0, 0]);
    assert.ok(ctx.toasts.some(text => text.includes("'개념 이해 › 시나리오' 그림은 판서 영상을 기다리는 동안 지워져")), ctx.toasts.join('|'));
    assert.ok(!ctx.toasts.some(text => text.includes('판서 영상으로 바꿨습니다')), '바꿨다고 하지 않는다');
    // 그림 값(data URL)을 글에 바로 쓴 자리와 local:img_story10 같은 다른 키는 가른다
    const direct = { ...storyLesson(), tabContents: { basicLearn: '## 1. 절\n\n![그림](data:image/png;base64,STORY)' } };
    assert.strictEqual(makeContext({ mod: direct, files: ['whiteboard-video.js'] }).whiteboardPictureInLesson(direct, 'img_story'), true);
    const longer = { ...storyLesson(), tabContents: { basicLearn: '![그림](local:img_story10)' }, images: {} };
    assert.strictEqual(makeContext({ mod: longer, files: ['whiteboard-video.js'] }).whiteboardPictureInLesson(longer, 'img_story'), false);
});

test('바뀐 예전 영상 파일을 지우지 못해도 새 영상은 화면에 붙이고 알린다(남은 파일은 나중에 정리한다)', async () => {
    const mod = { ...storyLesson(), whiteboardVideos: { img_story: { id: 'wb_old0000001', title: '예전', ext: 'mp4', at: 1 } } };
    const now = Date.now();
    const request = { subjectId: 's1', lessonId: 7, tabId: 'basicLearn', imgId: 'img_story', label: 'x', createdAt: now };
    const ctx = makeContext({ mod, files: ['whiteboard-video.js'], stored: { [REQUESTS_KEY]: JSON.stringify({ wb_new0000001: request }) } });
    ctx.DBManager.deleteItem = async () => { throw new Error('TransactionInactiveError'); };
    ctx.inbox = [{ requestId: 'wb_new0000001', blob: new Blob(['new']), extension: 'mp4', title: '새', createdAt: now }];
    const placed = await ctx.collectWhiteboardVideos();
    assert.deepStrictEqual([placed.length, mod.whiteboardVideos.img_story.id], [1, 'wb_new0000001']);
    assert.deepStrictEqual(ctx.applied, [mod], '새 영상을 그린다');
    assert.ok(ctx.toasts.some(text => text.includes('판서 영상으로 바꿨습니다')), ctx.toasts.join('|'));
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 6);
const ORPHANS_KEY = 'teacher:whiteboard-orphans';
const VIDEO = id => `wbvideo:${id}`;
const videoOf = id => ({ id, title: '판서', ext: 'mp4', at: 1 });

test('새 영상을 붙였어도 저장하지 못하면 예전 영상 파일은 남긴다(저장된 작업이 아직 그 영상을 가리킨다)', async () => {
    const mod = { ...storyLesson(), whiteboardVideos: { img_story: videoOf('wb_old0000001') } };
    const request = { subjectId: 's1', lessonId: 7, tabId: 'basicLearn', imgId: 'img_story', label: 'x', createdAt: Date.now() };
    const ctx = makeContext({ mod, files: ['whiteboard-video.js'], stored: { [REQUESTS_KEY]: JSON.stringify({ wb_new0000001: request }) } });
    ctx.db[VIDEO('wb_old0000001')] = new Blob(['old']);
    ctx.saveState = async () => false;
    ctx.inbox = [{ requestId: 'wb_new0000001', blob: new Blob(['new']), extension: 'mp4', title: '새', createdAt: Date.now() }];
    await ctx.collectWhiteboardVideos();
    assert.strictEqual(mod.whiteboardVideos.img_story.id, 'wb_new0000001');
    assert.ok(ctx.db[VIDEO('wb_old0000001')], '남은 파일은 저장된 작업을 열 때 정리한다');
});

test('되돌리기: 저장한 뒤에만 영상 파일을 지운다(저장하지 못하면 남긴다)', async () => {
    const mod = { ...storyLesson(), whiteboardVideos: { img_story: videoOf('wb_vid0000001') } };
    const ctx = makeContext({ mod, files: ['whiteboard-video.js'] });
    ctx.db[VIDEO('wb_vid0000001')] = new Blob(['v']);
    const order = [];
    const remove = ctx.DBManager.deleteItem;
    ctx.DBManager.deleteItem = async key => { order.push('지움'); return remove(key); };
    ctx.saveState = async () => { order.push('저장'); return false; };
    await ctx.revertWhiteboardVideo('img_story');
    assert.deepStrictEqual(Object.keys(mod.whiteboardVideos), []);
    assert.ok(ctx.db[VIDEO('wb_vid0000001')], '저장하지 못했으면 파일을 남긴다');
    mod.whiteboardVideos = { img_story: videoOf('wb_vid0000001') };
    ctx.saveState = async () => { order.push('저장'); return true; };
    await ctx.revertWhiteboardVideo('img_story');
    assert.deepStrictEqual(order, ['저장', '저장', '지움'], '저장한 뒤에 지운다');
    assert.strictEqual(ctx.db[VIDEO('wb_vid0000001')], undefined);
});

test('그림을 지울 때(dropWhiteboardVideo)는 영상 연결만 풀고 파일은 남긴다', () => {
    const mod = { ...storyLesson(), whiteboardVideos: { img_story: videoOf('wb_vid0000001'), img_b: videoOf('wb_vid0000002') } };
    const ctx = makeContext({ mod, files: ['whiteboard-video.js'] });
    ctx.db[VIDEO('wb_vid0000001')] = new Blob(['v']);
    const before = mod.whiteboardVideos;
    assert.strictEqual(ctx.dropWhiteboardVideo(mod, 'img_story').id, 'wb_vid0000001');
    assert.deepStrictEqual(Object.keys(mod.whiteboardVideos), ['img_b']);
    assert.ok(before.img_story, '예전 연결 객체는 바꾸지 않는다');
    assert.ok(ctx.db[VIDEO('wb_vid0000001')]);
    assert.strictEqual(ctx.dropWhiteboardVideo(mod, 'img_none'), null);
    assert.strictEqual(ctx.dropWhiteboardVideo(null, 'img_story'), null);
});

// 정리 실험: 휴지통 보관 기간(course-meta.js)과 정리(whiteboard-video.js)를 싣는다. 저장본(STORAGE_KEY)은 state.js storedRecordData처럼 푼다
function sweepContext({ mod = storyLesson(), db = {}, stored = {}, setItemThrows = false } = {}) {
    const ctx = makeContext({ mod, files: ['course-meta.js', 'whiteboard-video.js'], stored, setItemThrows });
    ctx.storageKey = vm.runInContext('STORAGE_KEY', ctx);
    Object.assign(ctx.db, { [ctx.storageKey]: { state: { subjects: [] }, history: [] } }, db);
    ctx.storedRecordData = async record => (record instanceof Blob ? JSON.parse(await record.text()) : record);
    return ctx;
}
const marksOf = ctx => JSON.parse(ctx.storage[ORPHANS_KEY] || '{}');
// 30일 넘게 쓰는 곳이 없던 영상(wb_orphan0001)을 정리한다
function sweepDue(ctx) {
    ctx.storage[ORPHANS_KEY] = JSON.stringify({ wb_orphan0001: NOW - 31 * DAY });
    return ctx.sweepWhiteboardVideosOnce(NOW);
}
const orphanDb = () => ({ [VIDEO('wb_orphan0001')]: new Blob(['o']) });

test('쓰는 곳이 없는 영상 파일은 처음에는 표시만 하고, 30일(휴지통 보관 기간)이 지나야 지운다', async () => {
    const mod = { ...storyLesson(), whiteboardVideos: { img_story: videoOf('wb_story00001') } };
    const ctx = sweepContext({ mod, db: { ...orphanDb(), [VIDEO('wb_story00001')]: new Blob(['s']), [VIDEO('not-ours')]: new Blob(['x']), projectFolderHandle: { name: 'f' } } });
    let result = await ctx.sweepWhiteboardVideosOnce(NOW);
    assert.deepStrictEqual([result.removed.length, result.waiting], [0, 1]);
    assert.deepStrictEqual(marksOf(ctx), { wb_orphan0001: NOW }, '쓰는 영상과 이 앱이 만들지 않은 이름은 표시하지 않는다');
    await ctx.sweepWhiteboardVideosOnce(NOW + 29 * DAY);
    assert.deepStrictEqual(marksOf(ctx), { wb_orphan0001: NOW }, '처음 본 시각은 그대로다');
    assert.ok(ctx.db[VIDEO('wb_orphan0001')]);
    result = await ctx.sweepWhiteboardVideosOnce(NOW + 31 * DAY);
    assert.deepStrictEqual([...result.removed], ['wb_orphan0001']);
    assert.strictEqual(ctx.db[VIDEO('wb_orphan0001')], undefined);
    assert.ok(ctx.db[VIDEO('wb_story00001')] && ctx.db[VIDEO('not-ours')] && ctx.db.projectFolderHandle && ctx.db[ctx.storageKey], '다른 이름은 그대로다');
    assert.strictEqual(ctx.storage[ORPHANS_KEY], undefined, '지운 영상의 표시도 지운다');
});

test('그사이 다시 쓰거나 파일이 없어진 영상의 표시는 지우고, 앞날 표시는 오늘부터 센다', async () => {
    const mod = storyLesson();
    const ctx = sweepContext({ mod, db: orphanDb(), stored: { [ORPHANS_KEY]: JSON.stringify({ wb_orphan0001: NOW - 40 * DAY, wb_gone000001: NOW - 40 * DAY }) } });
    mod.whiteboardVideos = { img_story: videoOf('wb_orphan0001') }; // 휴지통에서 되살린 차시 등
    assert.deepStrictEqual([...(await ctx.sweepWhiteboardVideosOnce(NOW)).removed], []);
    assert.ok(ctx.db[VIDEO('wb_orphan0001')]);
    assert.strictEqual(ctx.storage[ORPHANS_KEY], undefined);
    const later = sweepContext({ db: { [VIDEO('wb_future0001')]: new Blob(['f']) }, stored: { [ORPHANS_KEY]: JSON.stringify({ wb_future0001: NOW + 5 * DAY }) } });
    await later.sweepWhiteboardVideosOnce(NOW);
    assert.deepStrictEqual(marksOf(later), { wb_future0001: NOW }, '시계가 뒤로 갔으면 오늘부터 센다');
});

test('휴지통·지운 교과·최종 평가·지금 연 교과의 차시가 쓰는 영상은 표시하지 않는다', async () => {
    const ids = ['wb_trash00001', 'wb_subject001', 'wb_quest00001', 'wb_course0001'];
    const ctx = sweepContext({ db: Object.fromEntries(ids.map(id => [VIDEO(id), new Blob([id])])) });
    ctx.globalState.lessonTrash = [{ lesson: { id: 3, whiteboardVideos: { a: videoOf(ids[0]) } }, subjectId: 's1', at: new Date(NOW).toISOString() }];
    ctx.globalState.subjectTrash = [{ subject: { id: 's9', lessons: [{ id: 4, whiteboardVideos: { b: videoOf(ids[1]) } }] }, at: new Date(NOW).toISOString() }];
    ctx.globalState.subjects.push({ id: 's2', title: '다른 교과', lessons: [], mainQuest: { id: 'mainQuest', whiteboardVideos: { c: videoOf(ids[2]) } } });
    ctx.courseData = [{ id: 9, whiteboardVideos: { d: videoOf(ids[3]) } }]; // 불러와 아직 교과에 맞추지 않은 차시
    await ctx.sweepWhiteboardVideosOnce(NOW);
    assert.strictEqual(ctx.storage[ORPHANS_KEY], undefined);
    assert.ok(ids.every(id => ctx.db[VIDEO(id)]));
});

test('다른 탭이 저장한 저장본·읽지 못한 저장본 사본(객체·글자·파일)·남은 예전 저장본이 쓰는 영상은 지우지 않는다', async () => {
    const using = () => ({ id: 1, whiteboardVideos: { img: videoOf('wb_orphan0001') } });
    const saved = lessons => ({ state: { subjects: [{ id: 's1', lessons }] }, history: [] });
    const cases = [
        ['다른 탭의 저장본', ctx => { ctx.db[ctx.storageKey] = saved([using()]); }],
        ['저장본 파일(Blob)', ctx => { ctx.db[ctx.storageKey] = new Blob([JSON.stringify(saved([using()]))]); }],
        ['사본(모양이 다른 객체)', ctx => { ctx.db[`${ctx.storageKey}:읽지못함:1`] = { broken: [{ deep: 'x wb_orphan0001 y' }] }; }],
        ['사본(글자)', ctx => { ctx.db[`${ctx.storageKey}:읽지못함:2`] = '{"state":{"subjects":[{"lessons":[{"whiteboardVideos":{"i":{"id":"wb_orphan0001"'; }],
        ['사본(파일)', ctx => { ctx.db[`${ctx.storageKey}:읽지못함:3`] = new Blob(['{"망가진 ', 'wb_orphan0001']); }],
        ['예전 localStorage 저장본', ctx => { ctx.storage[ctx.storageKey] = JSON.stringify(saved([using()])); }]
    ];
    for (const [name, setup] of cases) {
        const ctx = sweepContext({ db: orphanDb() });
        setup(ctx);
        const result = await sweepDue(ctx);
        assert.deepStrictEqual([...result.removed], [], name);
        assert.ok(ctx.db[VIDEO('wb_orphan0001')], name);
        assert.deepStrictEqual(marksOf(ctx), { wb_orphan0001: NOW }, `${name}: 오늘부터 다시 센다`);
    }
});

test('저장본이 없거나 모양이 틀리거나 무엇이든 읽지 못하면 지우지 않는다', async () => {
    const failGet = (ctx, pick) => {
        const get = ctx.DBManager.getItem;
        ctx.DBManager.getItem = async key => { if (pick(key)) throw new Error('읽기 실패'); return get(key); };
    };
    const skips = [
        ['저장본 없음', ctx => { delete ctx.db[ctx.storageKey]; }],
        ['모양이 틀린 저장본', ctx => { ctx.db[ctx.storageKey] = { subjects: [] }; }],
        ['state가 배열인 저장본', ctx => { ctx.db[ctx.storageKey] = { state: [] }; }]
    ];
    for (const [name, setup] of skips) {
        const ctx = sweepContext({ db: orphanDb() });
        setup(ctx);
        assert.strictEqual((await sweepDue(ctx)).skipped, 'stored', name);
        assert.ok(ctx.db[VIDEO('wb_orphan0001')], name);
    }
    const failures = [
        ['저장본을 읽지 못함', ctx => failGet(ctx, key => key === ctx.storageKey)],
        ['저장본 파일을 풀지 못함', ctx => { ctx.db[ctx.storageKey] = new Blob(['{망가짐']); }],
        ['사본을 읽지 못함', ctx => { ctx.db[`${ctx.storageKey}:읽지못함:1`] = 'x'; failGet(ctx, key => key.includes('읽지못함')); }],
        ['저장소 이름 목록을 읽지 못함', ctx => { ctx.DBManager.keys = async () => { throw new Error('목록 실패'); }; }]
    ];
    for (const [name, setup] of failures) {
        const ctx = sweepContext({ db: orphanDb() });
        setup(ctx);
        await assert.rejects(sweepDue(ctx), /실패|JSON/, name);
        assert.ok(ctx.db[VIDEO('wb_orphan0001')], name);
    }
});

test('저장본을 읽지 못한 동안·PC 폴더가 브라우저보다 앞선 동안·표시를 저장하지 못하면 지우지 않는다', async () => {
    const unread = sweepContext({ db: orphanDb() });
    unread.isStateLoadFailed = () => true;
    assert.strictEqual((await sweepDue(unread)).skipped, 'unread');
    const ahead = sweepContext({ db: orphanDb() });
    ahead.readFolderSaveStamp = () => ({ name: '작업 폴더', size: 1, modified: 1, browserBehind: true });
    assert.strictEqual((await sweepDue(ahead)).skipped, 'folder');
    const full = sweepContext({ db: orphanDb(), stored: { [ORPHANS_KEY]: JSON.stringify({ wb_orphan0001: NOW - 31 * DAY }) }, setItemThrows: true });
    await assert.rejects(full.sweepWhiteboardVideosOnce(NOW), /QuotaExceededError/);
    [unread, ahead, full].forEach(ctx => assert.ok(ctx.db[VIDEO('wb_orphan0001')]));
    assert.deepStrictEqual(marksOf(unread), { wb_orphan0001: NOW - 31 * DAY }, '읽지 못한 동안은 표시도 고치지 않는다');
});

test('저장본 파일은 조각으로 읽고, 조각 사이에 걸친 영상 id도 찾는다', async () => {
    const ctx = makeContext({ files: ['whiteboard-video.js'] });
    const id = 'wb_abcdefgh12';
    for (let pad = 0; pad < 16; pad++) {
        const found = new Set();
        await ctx.whiteboardBlobMentions(new Blob(['가'.repeat(pad), id, 'zzz']), [id], found, 7); // '가'는 3바이트라 조각이 글자 가운데서 잘린다
        assert.ok(found.has(id), `앞 글 ${pad}자`);
    }
    const none = new Set();
    await ctx.whiteboardBlobMentions(new Blob(['wb_abcdefgh1 ', 'x'.repeat(30)]), [id], none, 7);
    assert.strictEqual(none.size, 0, '앞부분만 같은 글은 그 영상이 아니다');
});

test('여러 번 불러도 정리는 한 번만 돌고, 정리하다 멈추면 아무것도 지우지 않고 넘어간다', async () => {
    const ctx = sweepContext({ db: orphanDb() });
    let listed = 0;
    const keys = ctx.DBManager.keys;
    ctx.DBManager.keys = async () => { listed += 1; return keys(); };
    const first = ctx.sweepWhiteboardVideos();
    assert.strictEqual(ctx.sweepWhiteboardVideos(), first);
    await first;
    assert.strictEqual(listed, 1);
    const failing = sweepContext({ db: orphanDb() });
    failing.DBManager.keys = async () => { throw new Error('목록 실패'); };
    assert.strictEqual((await failing.sweepWhiteboardVideos()).skipped, 'error');
    assert.ok(failing.db[VIDEO('wb_orphan0001')]);
});

test('index.html은 저장된 작업을 읽었을 때(ok)만 restoreState 바로 뒤에서 정리를 한 번 부른다', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /const loaded = await restoreState\(\);[^\n]*\n(?:[^\n]*\n){0,3}\s*if \(loaded === 'ok'\) window\.sweepWhiteboardVideos\?\.\(\);/);
    assert.strictEqual(html.split('sweepWhiteboardVideos').length - 1, 1, '한 곳에서만 부른다');
});

test('보기 화면: 판서 영상 버튼은 그림 틀의 키를 저장된 버튼에서 읽고, 화면에 단 삭제 버튼은 보지 않는다', () => {
    const PNG = 'data:image/png;base64,QUFB';
    const mod = { ...storyLesson(), images: { a1: PNG, a2: PNG } }; // 같은 그림 값을 가진 키가 둘이라 삭제 버튼은 그림 주소를 든다
    const ctx = makeContext({ mod, files: ['whiteboard-video.js'] });
    const node = (tag, props = {}) => ({ tagName: tag.toUpperCase(), dataset: {}, children: [], className: '', classList: { add() {} }, ...props });
    const img = node('img', { getAttribute: name => (name === 'src' ? PNG : null), style: { removeProperty() {} } });
    const remove = node('button', { dataset: { lessonAction: 'delete-image', imgId: encodeURIComponent(PNG) } });
    const frame = node('div', { querySelector: () => remove, querySelectorAll: () => [remove], appendChild(child) { this.children.push(child); } });
    img.closest = selector => (selector.includes('.image-wrapper') ? frame : null);
    const view = { querySelectorAll: selector => (selector === 'img' ? [img] : []) };
    ctx.document.getElementById = id => (id === 'render-view' ? view : null);
    ctx.document.createElement = tag => node(tag);
    ctx.realApplyWhiteboardVideos(mod);
    assert.deepStrictEqual(frame.children.map(child => [child.dataset.lessonAction, child.dataset.imgId]), [['whiteboard-video', 'a2']]);
});

test('교안 안 버튼(data-lesson-action)으로 바꾸기·되돌리기를 부를 수 있다', () => {
    const ctx = makeContext({ files: ['whiteboard-video.js'] });
    assert.strictEqual(typeof ctx.LESSON_ACTIONS['whiteboard-video'], 'function');
    assert.strictEqual(typeof ctx.LESSON_ACTIONS['whiteboard-revert'], 'function');
});

test('오래된 요청(7일 넘음)은 읽을 때 버린다', () => {
    const now = Date.now();
    const old = { subjectId: 's1', lessonId: 7, imgId: 'a', createdAt: now - 8 * 24 * 3600 * 1000 };
    const fresh = { ...old, createdAt: now };
    const ctx = makeContext({ files: ['whiteboard-video.js'], stored: { [REQUESTS_KEY]: JSON.stringify({ wb_old: old, wb_new: fresh }) } });
    assert.deepStrictEqual(Object.keys(ctx.readWhiteboardRequests(now)), ['wb_new']);
});

runTests(tests);
