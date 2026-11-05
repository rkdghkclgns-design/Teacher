// 그림 → 판서 영상 바꾸기 테스트 (실행: node tests/whiteboard-video.test.js)
// 실제 whiteboard-link.js·whiteboard-video.js를 실행하고, 스튜디오가 영상을 넣는 IndexedDB(teacher-whiteboard-inbox)와
// Teacher 저장소(DBManager)는 tests/whiteboard-harness.js에서 흉내 낸다. 받는 쪽 형식은 스튜디오 src/lib/teacherInbox.ts와 같다
const assert = require('assert');
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
