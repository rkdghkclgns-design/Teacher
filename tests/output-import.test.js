// 내보낸 교안 다시 불러오기 테스트 (실행: node tests/output-import.test.js)
// HTML에 담은 원본과 MD의 탭 표시를 읽어 고칠 수 있는 차시로 되살리는지, 남이 준 파일을 걸러 받는지 DOM 없이 확인한다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const LESSON_TABS = [
    { id: 'basicLearn', label: '기본학습' }, { id: 'basicPrac', label: '기본실습' }, { id: 'advLearn', label: '심화학습' },
    { id: 'advPrac', label: '심화실습' }, { id: 'assessment', label: '학습이해도' }
];
const alerts = [];
const ctx = { console, window: { showAlert: message => alerts.push(message) }, JSON, Date, Object, LESSON_TABS, location: { hash: '' }, encodeURIComponent, decodeURIComponent };
vm.createContext(ctx);
// 실제 data.js의 stripInstructorCallouts(읽기용 원본에서 예전 강사 안내를 뺀다)
const dataSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8').replace(/\r\n/g, '\n');
const calloutStart = dataSource.indexOf('function stripInstructorCallouts(');
vm.runInContext(dataSource.slice(calloutStart, dataSource.indexOf('\n}\n', calloutStart) + 2), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'output-import.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'lesson-export.js'), 'utf8'), ctx); // 내보낼 때 다는 표시(markShownImages)와의 왕복
const {
    lessonSourcePayload, lessonSourceScript, lessonMarkdownExport, parseOutputHtml, parseOutputMarkdown, normalizeImportedLesson,
    readShownImages, mergeTabFiles, dedupeImported, describeOutputImport, missingImageCount, outputFileProblem, readOutputText, markShownImages
} = { ...ctx, ...ctx.window };
const plain = value => JSON.parse(JSON.stringify(value));

let failed = 0;
let count = 0;
const test = (name, fn) => {
    count++;
    try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
};

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const PNG_B = 'data:image/png;base64,QkJC';
const PNG_C = 'data:image/png;base64,Q0ND';
const lesson = {
    id: 101, title: '1차시: 개념 이해', description: '설명', hours: 2,
    tabContents: { basicLearn: '## 개요\n\n본문 </script><script>alert(1)</script>\n\n![그림](local:img_1)', advLearn: '## 심화\n\n심화 글\n\n---\n\n구분선 뒤 글' },
    images: { img_1: PNG, img_unused: PNG },
    gyosuan: { docMd: '# 교수안', deckMd: '# 편성안', deckHtml: '<div>화면 편집</div>' }
};

test('HTML: 원본을 담고 다시 읽으면 탭·그림·교수안이 그대로다', () => {
    const script = lessonSourceScript(lessonSourcePayload([lesson], { withGyosuan: true }));
    assert.ok(!script.slice(0, -9).includes('</script'), '본문의 </script>가 태그를 끊지 않는다');
    const html = `<!DOCTYPE html><html><body><main>보이는 글</main>${script}</body></html>`;
    const lessons = plain(parseOutputHtml(html));
    assert.strictEqual(lessons.length, 1);
    const restored = plain(normalizeImportedLesson(lessons[0], 5));
    assert.strictEqual(restored.tabContents.basicLearn, lesson.tabContents.basicLearn);
    assert.strictEqual(restored.tabContents.advLearn, lesson.tabContents.advLearn);
    assert.strictEqual(restored.tabContents.basicPrac, null);
    assert.deepStrictEqual(Object.keys(restored.images), ['img_1'], '쓰는 그림만 담는다');
    assert.strictEqual(restored.gyosuan.docMd, '# 교수안');
    assert.strictEqual(restored.gyosuan.deckHtml, undefined, '화면 편집 HTML은 받지 않는다');
    assert.strictEqual(restored.id, 5);
    assert.strictEqual(restored.hours, 2);
    assert.strictEqual(restored.status, 'done');
});

test('HTML: 지금 탭만 내보내면 그 탭만, 원본이 없는 HTML은 null', () => {
    const payload = plain(lessonSourcePayload([lesson], { tabIds: ['advLearn'], withGyosuan: false }));
    assert.deepStrictEqual(Object.keys(payload.lessons[0].tabContents), ['advLearn']);
    assert.strictEqual(payload.lessons[0].gyosuan, null);
    assert.strictEqual(parseOutputHtml('<html><body>그냥 문서</body></html>'), null);
    assert.strictEqual(parseOutputHtml('<script type="application/json" id="teacher-source">{깨진</script>'), null);
});

test('MD: 차시·탭 표시로 탭별로 되살리고, 본문의 구분선은 지키며, 한 탭만 내보낸 파일도 그 탭으로', () => {
    const tabs = [{ id: 'basicLearn', label: '기본학습', md: '## 개요\n\n본문' }, { id: 'advLearn', label: '심화학습', md: lesson.tabContents.advLearn }];
    const md = lessonMarkdownExport({ title: '제목 -- 주석 --> 끊기' }, tabs);
    const [parsed] = plain(parseOutputMarkdown(md, '01_x.md'));
    assert.strictEqual(parsed.title, '제목 -- 주석 --> 끊기');
    assert.strictEqual(parsed.tabContents.basicLearn, '## 개요\n\n본문');
    assert.strictEqual(parsed.tabContents.advLearn, lesson.tabContents.advLearn);
    const [single] = plain(parseOutputMarkdown(lessonMarkdownExport({ title: 'A' }, [{ id: 'assessment', label: '학습이해도', md: '문항' }]), 'a.md'));
    assert.deepStrictEqual(single.tabContents, { assessment: '문항' });
});

test('MD: 교안 첫 줄의 [..] 제목과 마지막 탭 끝의 구분선은 교안 내용이라 지킨다', () => {
    const own = [{ id: 'basicLearn', label: '기본학습', md: '# [참고]\n\n본문' }, { id: 'advLearn', label: '심화학습', md: '끝 문단\n\n---' }];
    const [parsed] = plain(parseOutputMarkdown(lessonMarkdownExport({ title: 'B' }, own), 'b.md'));
    assert.strictEqual(parsed.tabContents.basicLearn, '# [참고]\n\n본문');
    assert.strictEqual(parsed.tabContents.advLearn, '끝 문단\n\n---');
    const one = [{ id: 'assessment', label: '학습이해도', md: '# [학습이해도]\n\n문항' }];
    const [single] = plain(parseOutputMarkdown(lessonMarkdownExport({ title: 'C' }, one), 'c.md'));
    assert.strictEqual(single.tabContents.assessment, '# [학습이해도]\n\n문항', '머리를 붙이지 않은 한 탭 내보내기는 첫 줄을 떼지 않는다');
});

test('MD: 예전 내보내기(# [기본학습]·# [basicLearn] 머리)와 그냥 MD도 읽는다', () => {
    const [old] = plain(parseOutputMarkdown('# [basicLearn]\n\n가\n\n---\n\n# [심화실습]\n\n나', '03_차시 이름.md'));
    assert.deepStrictEqual(old.tabContents, { basicLearn: '가', advPrac: '나' });
    assert.strictEqual(old.title, '차시 이름', '파일 이름 앞 번호를 뗀다');
    const [loose] = plain(parseOutputMarkdown('# 아무 문서\n\n내용', 'note.md'));
    assert.deepStrictEqual(loose.tabContents, { basicLearn: '# 아무 문서\n\n내용' });
});

test('남이 준 파일: 글은 문자열만, 그림은 data:image만, 객체는 걸러 받는다', () => {
    const evil = plain(normalizeImportedLesson({
        title: { toString: null },
        description: 7,
        tabContents: { basicLearn: { evil: 1 }, basicPrac: '정상' },
        images: { 'ok_1': PNG, 'bad"id': PNG, x: 'javascript:alert(1)', y: 'data:text/html;base64,PHNjcmlwdD4=' },
        gyosuan: { docMd: ['배열'] },
        hours: 'abc'
    }, 9));
    assert.strictEqual(evil.title, '불러온 차시');
    assert.strictEqual(evil.description, '');
    assert.strictEqual(evil.tabContents.basicLearn, null);
    assert.strictEqual(evil.tabContents.basicPrac, '정상');
    assert.deepStrictEqual(Object.keys(evil.images), ['ok_1']);
    assert.strictEqual(evil.gyosuan, undefined);
    assert.strictEqual(evil.hours, undefined);
    assert.strictEqual(plain(normalizeImportedLesson(null, 1)).title, '불러온 차시');
});

test('HTML(버전 2): 화면에 보인 그림은 원본에 null로만 적고 그 <img>에서 채운다. 화면 그림과 다르면 원본에 그대로 담는다', () => {
    const mod = { title: '그림 차시', tabContents: { basicLearn: '![a](local:img_1) ![b](local:img_2) <img src="local:img_3">' }, images: { img_1: PNG, img_2: PNG, img_3: PNG_B } };
    const shown = new Map([['img_1', PNG], ['img_3', PNG_C]]);
    const payload = plain(lessonSourcePayload([mod], { shown: [shown] }));
    assert.strictEqual(payload.version, 2);
    assert.deepStrictEqual(payload.lessons[0].images, { img_1: null, img_2: PNG, img_3: PNG_B });
    const html = `<main><img src="${PNG}" alt="a > b" data-teacher-image="img_1" data-teacher-lesson="0"></main>${lessonSourceScript(payload)}`;
    const restored = plain(normalizeImportedLesson(parseOutputHtml(html)[0], 1));
    assert.deepStrictEqual(restored.images, { img_1: PNG, img_2: PNG, img_3: PNG_B });
});

test('교과 HTML: 같은 키라도 차시 번호로 제 그림을 읽는다(작은따옴표·속성 순서가 달라도)', () => {
    const a = { title: 'A', tabContents: { basicLearn: '![](local:img_1)' }, images: { img_1: PNG } };
    const b = { title: 'B', tabContents: { basicLearn: '![](local:img_1)' }, images: { img_1: PNG_B } };
    const payload = lessonSourcePayload([a, b], { shown: [new Map([['img_1', PNG]]), new Map([['img_1', PNG_B]])] });
    assert.deepStrictEqual(plain(payload.lessons.map(item => item.images)), [{ img_1: null }, { img_1: null }], '보인 그림은 원본에 다시 담지 않는다');
    const html = `<article><img src="${PNG}" data-teacher-image="img_1" data-teacher-lesson="0"></article><article><img data-teacher-lesson='1' src='${PNG_B}' data-teacher-image='img_1'></article>${lessonSourceScript(payload)}`;
    const [ra, rb] = parseOutputHtml(html).map((raw, i) => plain(normalizeImportedLesson(raw, i)));
    assert.strictEqual(ra.images.img_1, PNG);
    assert.strictEqual(rb.images.img_1, PNG_B);
});

test('보이는 그림 표시도 남이 준 것: 키·차시 번호·data:image를 검사하고 못 찾은 그림은 빈 자리로 센다', () => {
    const payload = { format: 'teacher-lesson-export', version: 2, lessons: [{ title: 'x', tabContents: { basicLearn: '![](local:k1) ![](local:k2) ![](local:k3) ![](local:k4)' }, images: { k1: null, k2: null, k3: null, k4: null } }] };
    const html = [
        '<img src="javascript:alert(1)" data-teacher-image="k1" data-teacher-lesson="0">',
        `<img src="${PNG}" data-teacher-image="k2" data-teacher-lesson="x">`,
        `<img src="${PNG}" data-teacher-image="k3&quot;" data-teacher-lesson="0">`,
        `<img src="${PNG}" data-teacher-image="k4">`
    ].join('') + lessonSourceScript(payload);
    const restored = plain(normalizeImportedLesson(parseOutputHtml(html)[0], 1));
    assert.deepStrictEqual(Object.keys(restored.images), ['k4'], '차시 번호가 없으면 0번 차시로 본다');
    assert.strictEqual(missingImageCount(restored), 3);
});

test('브라우저(DOMParser가 있으면)도 같은 검사로 보이는 그림을 읽는다', () => {
    const imgs = [
        { 'data-teacher-image': 'k1', 'data-teacher-lesson': '0', src: PNG },
        { 'data-teacher-image': 'k2', src: 'javascript:alert(1)' },
        { 'data-teacher-image': 'k1', 'data-teacher-lesson': '0', src: PNG_B },
        { 'data-teacher-image': 'k3', src: PNG_C }
    ].map(attrs => ({ getAttribute: name => (name in attrs ? attrs[name] : null) }));
    const asked = [];
    ctx.DOMParser = function () {
        this.parseFromString = (html, type) => { asked.push(type); return { querySelectorAll: selector => { asked.push(selector); return imgs; } }; };
    };
    try {
        assert.deepStrictEqual(plain([...readShownImages('<html></html>').entries()]), [['0/k1', PNG], ['0/k3', PNG_C]], '검사를 통과한 것만, 같은 자리는 처음 것만');
        assert.deepStrictEqual(asked, ['text/html', 'img[data-teacher-image]']);
    } finally {
        delete ctx.DOMParser;
    }
});

test('예전(버전 1) HTML: 원본 안의 그림과 교수안을 그대로 읽고, 없는 교수안 그림은 빈 자리로 센다', () => {
    const v1 = { format: 'teacher-lesson-export', version: 1, exportedAt: '2026-11-05T00:00:00.000Z', lessons: [{ title: '옛 차시', description: '', tabContents: { basicLearn: '![](local:img_1)' }, images: { img_1: PNG }, gyosuan: { docMd: '# 교수안\n\n![](local:ai1)', deckMd: '' } }] };
    const html = `<main>보이는 글</main><script type="application/json" id="teacher-source">${JSON.stringify(v1)}</script>`;
    const restored = plain(normalizeImportedLesson(parseOutputHtml(html)[0], 3));
    assert.strictEqual(restored.images.img_1, PNG);
    assert.strictEqual(restored.gyosuan.docMd, '# 교수안\n\n![](local:ai1)');
    assert.deepStrictEqual(restored.gyosuan.images, {});
    assert.strictEqual(missingImageCount(restored), 1);
});

test('교수안은 교수안 HTML(withGyosuan)에만: 쓰는 교수안 그림까지 되살리고, 읽기용 원본은 교수안과 예전 강사 안내를 뺀다', () => {
    const mod = { title: 'G', tabContents: { basicLearn: '본문\n<div class="instructor-callout">강사 메모</div>\n끝' }, images: {},
        gyosuan: { docMd: '## 진행\n\n![](local:ai1)', deckMd: '### 슬라이드 1 - 시작\n\n![](local:ai2)', images: { ai1: PNG, ai2: PNG_B, unused: PNG } } };
    const reader = plain(lessonSourcePayload([mod]));
    assert.strictEqual(reader.lessons[0].gyosuan, null);
    assert.strictEqual(reader.lessons[0].tabContents.basicLearn, '본문\n끝');
    const full = plain(lessonSourcePayload([mod], { withGyosuan: true, shown: [new Map([['ai1', PNG]])] }));
    assert.ok(full.lessons[0].tabContents.basicLearn.includes('강사 메모'));
    assert.deepStrictEqual(full.lessons[0].gyosuan.images, { ai1: null, ai2: PNG_B }, '쓰는 교수안 그림만, 보인 그림은 null');
    const html = `<img src="${PNG}" data-teacher-image="ai1" data-teacher-lesson="0">${lessonSourceScript(full)}`;
    const restored = plain(normalizeImportedLesson(parseOutputHtml(html)[0], 1));
    assert.deepStrictEqual(restored.gyosuan.images, { ai1: PNG, ai2: PNG_B });
});

test('찾지 못한 그림 자리(teacher-image:…)·빈 값은 원본에 담지 않고, 다시 불러오면 빈 그림 자리로 센다', () => {
    const mod = { title: '빈 그림', tabContents: { basicLearn: '![](local:img_1) ![](local:img_ref) ![](local:img_empty)' },
        images: { img_1: PNG, img_ref: 'teacher-image:0123456789abcdef01', img_empty: '' },
        gyosuan: { docMd: '## 진행\n\n![](local:ai_ref)', deckMd: '', images: { ai_ref: 'teacher-image:0123456789abcdef02' } } };
    const full = plain(lessonSourcePayload([mod], { withGyosuan: true }));
    assert.deepStrictEqual(full.lessons[0].images, { img_1: PNG }, '진짜 그림만 담는다');
    assert.deepStrictEqual(full.lessons[0].gyosuan.images, {});
    const restored = plain(normalizeImportedLesson(parseOutputHtml(lessonSourceScript(full))[0], 1));
    assert.deepStrictEqual(restored.images, { img_1: PNG });
    assert.strictEqual(missingImageCount(restored), 3, '확인 창이 빈칸이 될 그림으로 센다');
});

test('MD: ZIP의 _전체.md처럼 # [01_기본학습] 번호 머리도 탭으로 읽고 제목에서 앞 번호와 _전체를 뗀다', () => {
    const [whole] = plain(parseOutputMarkdown('# [01_기본학습]\n\n가\n\n---\n\n# [02_기본실습]\n\n나\n\n---\n\n# [05_학습이해도]\n\n다', '01_변수와 자료형_전체.md'));
    assert.deepStrictEqual(whole.tabContents, { basicLearn: '가', basicPrac: '나', assessment: '다' });
    assert.strictEqual(whole.title, '변수와 자료형');
});

test('ZIP 탭 MD: 파일 이름으로 탭을 정하고 글 속 # [..] 줄로 나누지 않으며, 한 번에 고르면 한 차시로 묶는다', () => {
    const [one] = plain(parseOutputMarkdown('본문\n\n# [심화학습]\n\n더', '02_기본실습.md'));
    assert.deepStrictEqual(one, { title: '', tabContents: { basicPrac: '본문\n\n# [심화학습]\n\n더' }, images: {} });
    const files = [['01_기본학습.md', '가'], ['02_기본실습 (1).md', '나'], ['메모.md', '다']].flatMap(([name, text]) => readOutputText(name, text));
    assert.deepStrictEqual(files.map(item => item.tabFile || null), ['basicLearn', 'basicPrac', null], "내려받을 때 붙은 ' (1)'은 보지 않는다");
    const merged = plain(mergeTabFiles(files));
    assert.strictEqual(merged.length, 2);
    assert.deepStrictEqual(merged[0].raw.tabContents, { basicLearn: '가', basicPrac: '나' });
    assert.strictEqual(merged[1].raw.title, '메모');
    const twice = [['01_기본학습.md', '가'], ['1_기본학습.md', '나']].flatMap(([name, text]) => readOutputText(name, text));
    assert.strictEqual(mergeTabFiles(twice).length, 2, '같은 탭 파일이 둘이면 묶지 않는다');
    const spoof = [{ raw: { title: 'H', tabFile: 'basicLearn', tabContents: { basicLearn: 'h' } }, from: 'html' }, ...readOutputText('01_기본학습.md', '가'), ...readOutputText('02_기본실습.md', '나')];
    const kept = mergeTabFiles(spoof);
    assert.strictEqual(kept.length, 2, 'HTML 원본 글에 tabFile이 있어도 묶지 않는다');
    assert.strictEqual(kept[0].raw.title, 'H');
});

test('같은 차시는 한 번만: 교수안이 있는 쪽, 다음은 HTML, 다음은 그림이 많은 쪽을 남기고 교수안이 서로 다르면 둘 다 넣는다', () => {
    const lessonOf = raw => plain(normalizeImportedLesson(raw, 0));
    const md = lessonOf({ tabContents: { basicLearn: '가\n<div class="instructor-callout">메모</div>\n' } });
    const html = lessonOf({ title: 'A', tabContents: { basicLearn: '가' } });
    const withImage = lessonOf({ title: 'A', tabContents: { basicLearn: '가' }, images: { img_1: PNG } });
    const docA = lessonOf({ title: 'A', tabContents: { basicLearn: '가' }, gyosuan: { docMd: '## 진행\n\nA' } });
    const docB = lessonOf({ title: 'A', tabContents: { basicLearn: '가' }, gyosuan: { docMd: '## 진행\n\nB' } });
    const items = [md, html, withImage, docA, docB, md].map((lesson, i) => ({ lesson, from: i === 0 || i === 5 ? 'md' : 'html', file: i }));
    const { kept, dropped } = dedupeImported(items);
    assert.strictEqual(dropped, 4);
    assert.deepStrictEqual(plain(kept.map(item => item.lesson.gyosuan.docMd)), ['## 진행\n\nA', '## 진행\n\nB']);
    assert.deepStrictEqual(Object.keys(kept[0].lesson.images), ['img_1'], '버린 쪽에만 있던 그림은 남긴 쪽에 더한다');
    assert.deepStrictEqual(Object.keys(docA.images), [], '받은 차시 객체는 그대로 두고 새 객체에 더한다');
    const twins = dedupeImported([{ lesson: lessonOf({ title: 'A', tabContents: { basicLearn: '가' } }), from: 'html', file: 0 }, { lesson: lessonOf({ title: 'A', tabContents: { basicLearn: '가' } }), from: 'html', file: 0 }, { lesson: md, from: 'md', file: 1 }]);
    assert.strictEqual(twins.kept.length, 2, '한 파일 안에서 겹친 차시는 그대로 두고, 다른 파일의 같은 차시만 뺀다');
    assert.strictEqual(twins.dropped, 1);
    // 남길 쪽(교수안)이 다른 파일에서 먼저 와도, 한 파일(교과 HTML) 안의 같은 두 차시가 그 하나에 모두 접혀 사라지지 않는다
    const later = dedupeImported([{ lesson: docA, from: 'html', file: 0 }, { lesson: html, from: 'html', file: 1 }, { lesson: html, from: 'html', file: 1 }]);
    assert.deepStrictEqual([later.kept.length, later.dropped], [2, 1]);
});

test('확인 창 글: 제목·탭별 글자 수·그림, 숨은 원본, MD 그림 없음, 교수안 없음, 돌아오지 않는 것, 겹친 차시, 건너뛴 파일, 많으면 외 N개', () => {
    const long = '아주 긴 제목'.repeat(10);
    const items = Array.from({ length: 7 }, (_, i) => ({ from: 'html', lesson: plain(normalizeImportedLesson({ title: i ? `차시 ${i}` : long, tabContents: { basicLearn: 'ㄱ'.repeat(3200), basicPrac: 'ㄴ'.repeat(10) }, images: { img_1: PNG } }, i)) }));
    items.push({ from: 'md', lesson: plain(normalizeImportedLesson({ title: 'MD', tabContents: { basicLearn: '<img src="local:img_9">' } }, 9)) });
    const text = describeOutputImport(items, { fileCount: 2, where: "'프로그래밍 기초' 교과에", dropped: 1, failed: ['a.zip: x', 'b.zip: y', 'c.zip: z', 'd.zip: w'] });
    assert.ok(text.startsWith("파일 2개에서 차시 8개를 찾았습니다.\n'프로그래밍 기초' 교과에 새 차시로 넣습니다."));
    assert.ok(text.includes('   기본학습 3,200자 · 기본실습 10자 · 그림 1장'));
    assert.ok(text.includes(`· ${long.slice(0, 40)}…`) && text.includes('· 외 차시 3개'));
    assert.ok(text.includes('숨겨 둔 원본') && text.includes('고친 글은 들어오지 않습니다'));
    assert.ok(text.includes('MD 파일에는 그림이 담기지 않습니다. 그림 자리 1곳은 빈칸이 됩니다.'));
    assert.ok(text.includes('· 교수안은 들어 있지 않습니다. 교수안까지 되살리려면 교수안 화면의 HTML 버튼으로 받은 파일을 고르세요.'));
    assert.ok(!text.includes('에만 담깁니다'), '예전 파일에도 교수안이 들어 있을 수 있어 "그 파일에만 담긴다"고 하지 않는다');
    // 돌아오지 않는 것은 다 적을 수 없으므로 되살리는 것을 적고, 나머지는 예를 든다(차시 정보·검수 기록도 돌아오지 않는다)
    assert.ok(text.includes('· 되살리는 것은 파일에 담긴 차시 제목·설명·시간, 탭 글, 그림, 교수안뿐입니다.'));
    assert.ok(['차시 정보의 나머지 칸', '섹션 고정', '수동 검수 기록', '슬라이드 화면 편집', '참고 이미지', '삽화 목록', 'NCS', '판서 영상'].every(word => text.includes(word)));
    assert.ok(text.includes("같은 것은 돌아오지 않습니다. 모두 되살리려면 '백업 ZIP으로 되살리기'를 쓰세요."));
    assert.ok(text.includes('· 여러 파일에 같은 차시가 있어 겹친 1개는 빼고 한 번만 넣습니다.'), '찾은 차시 수와 헷갈리지 않게 뺀 수라고 말한다');
    assert.ok(text.includes('건너뛰는 파일 4개') && text.includes('· a.zip: x') && text.includes('· 외 1개') && !text.includes('d.zip'));
    const one = describeOutputImport([{ from: 'html', lesson: plain(normalizeImportedLesson({ title: 'G', gyosuan: { docMd: '## 진행' } }, 1)) }], { fileCount: 1, where: 'x' });
    assert.ok(one.includes('· G\n   교수안') && !one.includes('교수안은 들어 있지 않습니다') && !one.includes('건너뛰는') && !one.includes('MD 파일'));
});

test('읽지 못하는 파일은 까닭과 쓸 메뉴를 알린다: ZIP, 다른 형식, 80MB 넘음, 원본 없는 HTML, 잘린 원본, 빈 원본, 슬라이드 HTML, 교수안 MD', () => {
    assert.match(outputFileProblem({ name: '백업.zip', size: 10 }), /백업 ZIP으로 되살리기/);
    assert.match(outputFileProblem({ name: '그림.png', size: 10 }), /HTML이나 MD/);
    assert.match(outputFileProblem({ name: '교과.html', size: 80 * 1024 * 1024 + 1 }), /80MB.*MD/);
    assert.strictEqual(outputFileProblem({ name: '교과.HTML', size: 10 }), null);
    assert.throws(() => readOutputText('교안.html', '<html><body>x</body></html>'), /백업 ZIP으로 되살리기/);
    assert.throws(() => readOutputText('교안.html', '<main>x</main><script type="application/json" id="teacher-source">{"format":"teacher-'), /잘렸거나 깨져/);
    assert.throws(() => readOutputText('빈.html', lessonSourceScript({ format: 'teacher-lesson-export', version: 2, lessons: [] })), /차시가 없습니다/);
    assert.throws(() => readOutputText('slides.html', '<script type="application/json" id="kb-source">{}</script>'), /내보낸 HTML 불러오기/);
    assert.throws(() => readOutputText('06_교수안 (1).md', '# 교수안\n\n## 진행\n\n내용'), /완성 MD 불러오기/);
    assert.throws(() => readOutputText('01_변수와 자료형_07_슬라이드편성안.md', '### 슬라이드 1 - 시작\n\n- 내용'), /완성 MD 불러오기/, '과정 전체 백업의 <차시>_07_슬라이드편성안.md');
    assert.throws(() => readOutputText('게임_교수안_편성안_묶음.md', '# 모음\n\n## 진행\n\n내용'), /여러 차시/);
    assert.strictEqual(readOutputText('03_좋은 교수안.md', '# 좋은 교수안\n\n본문').length, 1, '제목에 교수안이 있어도 교안이면 읽는다');
    assert.strictEqual(readOutputText('01_교수안.md', lessonMarkdownExport({ title: '교수안' }, [{ id: 'basicLearn', label: '기본학습', md: '## 진행' }])).length, 1, '차시·탭 표시가 있는 MD는 교안이다');
});

test('내보낸 HTML이 80MB를 넘을 때만 다시 불러오기 안내를 띄운다', () => {
    assert.strictEqual(ctx.window.noteReimportSize(10), false);
    assert.strictEqual(alerts.length, 0);
    assert.strictEqual(ctx.window.noteReimportSize(80 * 1024 * 1024 + 1), true);
    assert.ok(alerts[0].includes('80MB') && alerts[0].includes('교과 백업 ZIP 받기'));
});

test('내보낼 때 단 표시(markShownImages) → 원본 → 다시 불러오기 왕복', () => {
    const fake = attrs => ({ attrs, getAttribute: n => (n in attrs ? attrs[n] : null), setAttribute: (n, v) => { attrs[n] = String(v); }, removeAttribute: n => { delete attrs[n]; } });
    const imgs = [fake({ src: PNG }), fake({ src: PNG_B, 'data-teacher-image': 'evil' })];
    const mod = { title: 'R', tabContents: { basicLearn: '![](local:a) ![](local:b)' }, images: { a: PNG, b: PNG_B } };
    const shown = new Map();
    markShownImages({ querySelectorAll: () => imgs }, mod.images, 0, shown);
    const tags = imgs.map(img => `<img ${Object.entries(img.attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>`).join('');
    const payload = lessonSourcePayload([mod], { shown: [shown] });
    assert.deepStrictEqual(plain(payload).lessons[0].images, { a: null, b: null });
    const restored = plain(normalizeImportedLesson(parseOutputHtml(tags + lessonSourceScript(payload))[0], 1));
    assert.deepStrictEqual(restored.images, { a: PNG, b: PNG_B });
});

// 고른 파일들을 importOutputFiles와 같은 차례로 읽는다: 파일마다 읽기 → 탭 MD 묶기 → 검사 → 겹친 차시 빼기
const importFiles = files => {
    const found = [];
    const skipped = [];
    files.forEach(([name, text], file) => {
        try { found.push(...readOutputText(name, text).map(item => ({ ...item, file }))); } catch (err) { skipped.push(name); }
    });
    const prepared = mergeTabFiles(found).map(item => ({ from: item.from, file: item.file, titleRank: item.titleRank, lesson: normalizeImportedLesson(item.raw, 0) }));
    return { ...dedupeImported(prepared), skipped };
};

test('ZIP 차시 폴더의 파일을 모두 고르면 한 차시로, 제목은 고른 순서와 상관없이 파일 안에 적힌 것 → 파일 이름에서 딴 것 순으로 남긴다', () => {
    const tabs = [['01_기본학습.md', '## 개념\n\n본문'], ['02_기본실습.md', '## 실습\n\n따라 하기']];
    const whole = ['GD_01차시_변수와 자료형_전체.md', '# [01_기본학습]\n\n## 개념\n\n본문\n\n---\n\n# [02_기본실습]\n\n## 실습\n\n따라 하기'];
    const titles = result => plain(result.kept.map(item => item.lesson.title));
    // 예전 ZIP(교안.html에 원본이 없다): 탭 MD가 먼저 와도 '불러온 차시'가 아니라 _전체.md 파일 이름에서 딴 제목
    const old = importFiles([...tabs, whole, ['06_교수안.md', '# 교수안\n\n## 진행\n\n내용'], ['교안.html', '<html><body>예전 교안</body></html>']]);
    assert.deepStrictEqual([titles(old), old.dropped, old.skipped], [['GD_01차시_변수와 자료형'], 1, ['06_교수안.md', '교안.html']]);
    assert.deepStrictEqual(titles(importFiles([whole, ...tabs])), ['GD_01차시_변수와 자료형']);
    // 새 ZIP: 교안.html 원본에 적힌 진짜 차시 이름이 남는다(파일 이름에서 딴 제목과 달라도 같은 차시로 본다)
    const mod = { title: '변수와 자료형', description: '설명', hours: 2, tabContents: { basicLearn: '## 개념\n\n본문', basicPrac: '## 실습\n\n따라 하기' }, images: {} };
    const fresh = importFiles([...tabs, whole, ['교안.html', `<main>교안</main>${lessonSourceScript(lessonSourcePayload([mod]))}`]]);
    assert.deepStrictEqual([titles(fresh), fresh.dropped], [['변수와 자료형'], 2]);
});

test('빈 파일과 빈 차시: 글이 없는 MD는 까닭을 알리고 건너뛰고, 글도 교수안도 없는 차시는 서로 겹친 것으로 보지 않는다', () => {
    assert.throws(() => readOutputText('a.md', ''), /불러올 교안 글이 없습니다/);
    assert.throws(() => readOutputText('b.md', '  \r\n  '), /불러올 교안 글이 없습니다/);
    assert.throws(() => readOutputText('c.md', lessonMarkdownExport({ title: '제목만' }, [])), /불러올 교안 글이 없습니다/);
    assert.deepStrictEqual(importFiles([['a.md', ''], ['b.md', '   ']]).skipped, ['a.md', 'b.md']);
    const blank = importFiles([['x.html', lessonSourceScript({ format: 'teacher-lesson-export', version: 2, lessons: [{ tabContents: {} }] })], ['y.html', lessonSourceScript({ format: 'teacher-lesson-export', version: 2, lessons: [{ tabContents: {} }] })]]);
    assert.deepStrictEqual([blank.kept.length, blank.dropped], [2, 0], '제목도 글도 없는 두 차시를 하나로 접지 않는다');
});

test('탭 글이 같아도 다른 차시는 둘 다 넣는다: 파일 안에 적힌 제목·설명·시간·편성안·같은 키의 그림 가운데 하나라도 다르면(하나를 빼면 잃는 것이 있으면)', () => {
    const asFile = (mod, name) => [name, lessonSourceScript(lessonSourcePayload([mod], { withGyosuan: true }))];
    const base = { title: 'A반 1차시', description: 'A반용', hours: 2, tabContents: { basicLearn: '같은 본문 ![](local:img_1)' }, images: { img_1: PNG },
        gyosuan: { docMd: '## 진행\n같은 교수안', deckMd: '### 슬라이드 1\n옛 슬라이드', images: {} } };
    const classB = { ...base, title: 'B반 1차시', description: 'B반용', gyosuan: { ...base.gyosuan, deckMd: '### 슬라이드 1\n새 슬라이드' } };
    const two = importFiles([asFile(base, 'A반_교수안.html'), asFile(classB, 'B반_교수안.html')]);
    assert.deepStrictEqual([two.kept.length, two.dropped], [2, 0], '두 반의 차시');
    assert.deepStrictEqual(plain(two.kept.map(item => [item.lesson.title, item.lesson.description, item.lesson.gyosuan.deckMd])),
        [['A반 1차시', 'A반용', '### 슬라이드 1\n옛 슬라이드'], ['B반 1차시', 'B반용', '### 슬라이드 1\n새 슬라이드']]);
    [
        { ...base, gyosuan: { ...base.gyosuan, deckMd: '### 슬라이드 1\n다시 만든 슬라이드' } },
        { ...base, description: '고친 설명' },
        { ...base, hours: 3 },
        { ...base, images: { img_1: PNG_B } }
    ].forEach((other, i) => assert.strictEqual(importFiles([asFile(base, 'a.html'), asFile(other, 'b.html')]).kept.length, 2, `다른 것 ${i}`));
    assert.deepStrictEqual([importFiles([asFile(base, 'a.html'), asFile(base, 'a (1).html')]).kept.length], [1], '모두 같으면 한 번만');
    // MD의 차시 표시에 적힌 제목도 파일 안에 적힌 제목이다: HTML과 제목이 다르면 둘 다, 같으면 하나로
    const md = title => ['a.md', lessonMarkdownExport({ title }, [{ id: 'basicLearn', label: '기본학습', md: '같은 본문 ![](local:img_1)' }])];
    assert.strictEqual(importFiles([asFile(base, 'a.html'), md('다른 제목')]).kept.length, 2);
    // 제목 없는 HTML이 MD의 제목을 받으면 그 제목도 파일 안에 적힌 제목으로 견준다(뒤에 온 다른 제목이 덮어쓰지 않게)
    const titled = importFiles([asFile({ ...base, title: '' }, 'a.html'), md('A반 1차시'), asFile({ ...base, title: 'B반 1차시' }, 'b.html')]);
    assert.deepStrictEqual(plain(titled.kept.map(item => item.lesson.title)), ['A반 1차시', 'B반 1차시']);
    const one = importFiles([md('A반 1차시'), asFile(base, 'a.html')]);
    assert.deepStrictEqual([one.kept.length, one.kept[0].lesson.gyosuan.deckMd, Object.keys(one.kept[0].lesson.images)], [1, '### 슬라이드 1\n옛 슬라이드', ['img_1']]);
    // 같은 교수안이면 버리는 쪽에만 있던 교수안 그림도 남기는 쪽에 더한다
    const withDocImage = { ...base, images: {}, gyosuan: { ...base.gyosuan, docMd: '## 진행\n같은 교수안 ![](local:ai1)', images: { ai1: PNG_C } } };
    const noDocImage = { ...base, gyosuan: { ...base.gyosuan, docMd: '## 진행\n같은 교수안 ![](local:ai1)' } };
    const merged = importFiles([asFile(noDocImage, 'a.html'), asFile(withDocImage, 'b.html')]);
    assert.deepStrictEqual(plain([merged.kept.length, merged.kept[0].lesson.images, merged.kept[0].lesson.gyosuan.images]), [1, { img_1: PNG }, { ai1: PNG_C }]);
});

test('차시가 아주 많아도 멈추지 않는다: 탭 글이 같은 것끼리만 견주고, 한 파일의 차시가 너무 많으면 까닭을 알리고 건너뛴다', () => {
    const many = (total, textOf, fileOf) => Array.from({ length: total }, (_, i) => ({ from: 'html', file: fileOf(i), titleRank: 2, lesson: { title: 'T', description: '', tabContents: { basicLearn: textOf(i) }, images: {} } }));
    let started = Date.now();
    const distinct = dedupeImported(many(30000, i => `글 ${i}`, i => i % 2));
    const distinctMs = Date.now() - started;
    assert.deepStrictEqual([distinct.kept.length, distinct.dropped], [30000, 0]);
    assert.ok(distinctMs < 1500, `서로 다른 차시 3만 개: ${distinctMs}ms`);
    started = Date.now();
    const same = dedupeImported(many(30000, () => '같은 글', () => 0));
    const sameMs = Date.now() - started;
    assert.deepStrictEqual([same.kept.length, same.dropped], [30000, 0], '한 파일 안의 같은 차시는 그대로 둔다');
    assert.ok(sameMs < 1500, `한 파일 안의 같은 차시 3만 개: ${sameMs}ms`);
    const source = total => lessonSourceScript({ format: 'teacher-lesson-export', version: 2, lessons: Array.from({ length: total }, (_, i) => ({ title: `${i}`, tabContents: { basicLearn: `${i}` } })) });
    assert.strictEqual(readOutputText('a.html', source(2000)).length, 2000);
    assert.throws(() => readOutputText('b.html', source(2001)), /차시가 너무 많은 파일입니다\(2,000개 넘음\)\. '백업 ZIP으로 되살리기'를 쓰세요/);
});

test("교수안 안내는 '그 파일에만 담긴다'고 못 박지 않고 교수안까지 되살리는 방법을 알린다(예전 HTML과 ZIP의 교수안 MD에도 교수안이 있다)", () => {
    const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const guide = '교수안까지 되살리려면 교수안 화면에서 받은 HTML을 고르세요';
    [read('index.html'), read('js/tutorial.js')].forEach(source => {
        assert.ok(!source.includes('교수안은 교수안 화면에서 받은 HTML에만'));
        assert.ok(source.includes(guide));
    });
});

test('HTML: 닫히지 않은 숨은 원본 여는 태그가 아주 많은 파일도 바로 끝난다(한 번만 훑는다)', () => {
    const opener = '<script type="application/json" id="teacher-source">';
    const crafted = `<html><body>${opener.repeat(32000)}x</body></html>`; // 1.6MB, 예전 정규식은 몇 초가 걸렸다
    const started = Date.now();
    assert.strictEqual(parseOutputHtml(crafted), null);
    const took = Date.now() - started;
    assert.ok(took < 1500, `${took}ms`);
    const script = lessonSourceScript(lessonSourcePayload([lesson], { withGyosuan: false }));
    const html = `<main>앞 ${opener}</main>${script}`; // 닫히지 않은 여는 태그 뒤의 원본은 쓰지 않는다(첫 여는 태그에서 첫 닫는 태그까지)
    assert.strictEqual(parseOutputHtml(html), null, '예전과 같이 첫 여는 태그부터 읽는다');
    assert.strictEqual(plain(parseOutputHtml(`<main>앞</main>${script}${opener}{깨진`)).length, 1, '원본 뒤에 남은 여는 태그는 보지 않는다');
});

test('확인 창: 받은 파일의 차시 제목은 한 줄로 모아 확인 창에 없는 줄을 꾸미지 못한다', () => {
    const fake = '차시\n\n· 차시 정보·NCS·판서 영상까지 모두 돌아옵니다.';
    const imported = plain(normalizeImportedLesson({ title: fake, tabContents: { basicLearn: '## 글\n\n본문' } }, 1));
    const text = describeOutputImport([{ from: 'html', lesson: imported }], { fileCount: 1, where: "'교과'에" });
    const lines = text.split('\n');
    assert.ok(!lines.some(line => line.startsWith('· 차시 정보·NCS·판서 영상까지')), text);
    assert.ok(lines.some(line => line.startsWith('· 차시 · 차시 정보·NCS·판서')), '제목은 한 줄로 보인다');
});

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
