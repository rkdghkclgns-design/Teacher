// output-import.test.js가 부르는 시험(이 파일만 따로 돌리지 않는다): 큰 파일 조각 읽기, 숨은 원본이 없는 예전 HTML, 판서 영상,
// AVIF, 예전(af5287a) 교수안 HTML의 교수안 그림, 한 번에 불러오는 차시 상한, 건너뛴 파일 기록, 넣기·되돌리기
// 큰 파일은 크기만 크게 알리는 가짜 파일로 본다(수백 MB를 만들지 않는다)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

module.exports = ({ ctx, test, testAsync, TurndownService, DominoParser, plain }) => {
    const run = code => vm.runInContext(code, ctx);
    const jsSource = file => fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8').replace(/\r\n/g, '\n');
    const W = name => ctx.window[name] || ctx[name];
    // 512자가 넘는 data URL(조각 읽기가 떼어 두는 크기)
    const big = (type, seed) => `data:${type};base64,${Buffer.from(seed.repeat(400)).toString('base64')}`;
    const JPG = big('image/jpeg', 'JPEG-PICTURE-');
    const POSTER = big('image/png', 'POSTER-PNG-');
    const CELL = big('image/png', 'TABLE-CELL-');
    const MP4 = big('video/mp4', 'MP4-VIDEO-');
    const AVIF = 'data:image/avif;base64,AAAAHGZ0eXBhdmlm';

    // 브라우저 File처럼 slice·arrayBuffer로만 읽히는 가짜 파일. size를 주면 그만큼 크다고 알린다(뒤는 빈 조각)
    const fakeFile = (name, text, { size, onSlice } = {}) => {
        const bytes = Buffer.from(text, 'utf8');
        return {
            name,
            size: size ?? bytes.length,
            slice: (from, to) => {
                onSlice?.(from, to);
                return { arrayBuffer: async () => bytes.subarray(Math.min(from, bytes.length), Math.min(to, bytes.length)) };
            },
            text: async () => { throw new Error('file.text()를 부르면 안 됩니다'); }
        };
    };
    const withDom = async fn => {
        if (!TurndownService) throw new Error('turndown이 없습니다(npm install --no-save marked@15.0.12 turndown@7.2.4)');
        ctx.DOMParser = DominoParser;
        ctx.TurndownService = TurndownService;
        try {
            return await fn();
        } finally {
            delete ctx.DOMParser;
            delete ctx.TurndownService;
        }
    };

    // 이 앱이 원본 없이 내보낸 교안 HTML(lesson-export.js lessonHtmlDocument와 같은 틀, af5287a 전)
    const oldHtml = ({ video = MP4, poster = POSTER } = {}) => `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>3차시: 예전 교안</title><style>body { color: #000; }</style></head>
<body>
<main class="lesson-doc">
<section class="lesson-tab"><div class="lesson-tab-label">기본학습</div><h2>개요 &amp; 목표</h2>
<p>문장에 <strong>굵게</strong>와 <em>기울임</em>, <code>코드</code>, <a href="https://example.com/a">링크</a>가 있습니다.<br>다음 줄 &lt;b&gt;글자&lt;/b&gt;&nbsp;끝</p>
<ul>
<li>항목 하나<ul>
<li>안쪽 항목</li>
</ul>
</li>
<li>항목 둘</li>
</ul>
<br>

<div class="image-wrapper relative group"><video src="${video}" poster="${poster}" controls="" data-wb-video="wb_old" aria-label="판서 영상: 개요 판서"></video><div class="image-caption" style="margin-top:8px;">개요 그림</div></div>
<div class="image-wrapper"><img src="${JPG}" alt="그림 설명" class="rounded-lg border-2 border-accent/30 shadow-md max-w-full"><div class="image-caption" style="margin-top:8px;">그림 설명</div></div>
<table style="border-collapse: collapse; width: 100%;">
  <thead><tr><th style="border: 1px solid black;">가</th></tr></thead>
  <tbody><tr><td style="border: 1px solid black;"><img src="${CELL}" alt="표 안 그림"></td></tr></tbody>
</table>
<pre><code class="language-js">const a = <strong>b</strong>;
if (a &lt; 3) {}</code></pre>
<blockquote>
<p>인용 글</p>
</blockquote>
<hr>
<ul>
<li></li>
</ul>
<p class="lesson-term"> <strong>용어</strong>: 설명</p>
<ul style="list-style:decimal;padding-left:1.5rem;">
<li>고른 번호 하나</li>
<li>고른 번호 둘</li>
</ul>
<ul style="list-style:disc;padding-left:1.5rem;">
<li>바뀐 번호 목록</li>
</ul>
<div class="mermaid"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" style="max-width: 120px;"><style>.n{fill:#eef}</style><rect class="n" width="120" height="80"></rect></svg></div>
<script>alert(1)</script>
<p><span style="color: red;" onclick="alert(2)">빨강</span> <a href="java&#9;script:alert(3)">나쁜 링크</a></p>
</section>
<section class="lesson-tab"><div class="lesson-tab-label">학습 이해도</div><p>③ <span style="color: #22c55e; font-weight: bold;">정답 보기</span></p>
<div class="relative group my-6 flex justify-center" data-imgid="img_old"><img src="" alt="[이미지 생성 누락]" title="" class="rounded-xl"><div class="absolute top-2 right-2"></div></div>
</section>
</main>
</body>
</html>`;

    /* ---------- 조각 읽기 ---------- */
    test('조각 읽기: 조각 경계에 걸친 UTF-8 글자와 data URL도 그대로 잇고, 작은 data URL과 data URL이 아닌 글은 글에 둔다', () => {
        const SMALL = 'data:image/png;base64,iVBORw0KGgo=';
        const text = `<p>한글 😀 é</p><img src="${JPG}" alt="가"><p>${SMALL}</p><a href="data:text/plain,hello">data:</a>{"k":"${MP4}"}끝 dat`;
        const bytes = Buffer.from(text, 'utf8');
        const prefixes = new Set();
        for (let size = 1; size <= 41; size += size < 12 ? 1 : 7) {
            const scan = W('streamScanner')();
            for (let at = 0; at < bytes.length; at += size) scan.push(new Uint8Array(bytes.subarray(at, at + size)));
            const read = scan.finish();
            assert.strictEqual(read.count, 2, `조각 ${size}바이트: 큰 data URL 둘만 뗀다`);
            assert.ok(!read.text.includes(JPG) && !read.text.includes(MP4) && read.text.includes(SMALL) && read.text.includes('한글 😀 é') && read.text.endsWith('끝 dat'), `조각 ${size}`);
            assert.strictEqual(read.restore(read.text), text, `조각 ${size}바이트: 되돌리면 원래 글`);
            const token = read.text.match(/src="([^"]+)"/)[1];
            assert.strictEqual(read.dataOf(token), JPG);
            assert.strictEqual(read.dataOf(`${token} `), `${token} `, '값 전체가 표시 하나가 아니면 그대로');
            prefixes.add(token.replace(/\d+x$/, ''));
        }
        assert.ok(prefixes.size > 1, '표시 앞말은 읽을 때마다 새로 뽑는다');
    });

    test('진행 글: 8MB가 넘는 파일만 화면 왼쪽 아래에 읽은 MB를 글자로 보인다(파일 이름도 글자로만)', () => {
        const made = [];
        ctx.document = { body: { appendChild: el => made.push(el) }, createElement: () => ({ attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, remove() { this.removed = true; } }) };
        try {
            W('showReadProgress')({ name: 'a.html', size: 10 }).update(5, 10);
            assert.strictEqual(made.length, 0, '작은 파일은 보이지 않는다');
            const progress = W('showReadProgress')({ name: '<b>큰</b>.html', size: 50 * 1024 * 1024 });
            progress.update(25 * 1024 * 1024, 50 * 1024 * 1024);
            assert.strictEqual(made[0].textContent, "'<b>큰</b>.html' 읽는 중… 25.0 / 50.0MB");
            assert.strictEqual(made[0].attrs.role, 'status');
            progress.close();
            assert.ok(made[0].removed);
        } finally {
            delete ctx.document;
        }
    });

    testAsync('큰 파일: 80MB가 넘어도 4MB 조각으로만 읽고(file.text()를 부르지 않는다) 읽은 만큼 알리며, 확인 창에 큰 파일이라고 적는다', async () => {
        const payload = { format: 'teacher-lesson-export', version: 2, lessons: [{ title: '큰 차시', tabContents: { basicLearn: '![](local:img_1)' }, images: { img_1: JPG } }] };
        const slices = [];
        const file = fakeFile('큰 교안.html', `<main>본문</main>${ctx.lessonSourceScript(payload)}`, { size: 90 * 1024 * 1024, onSlice: (from, to) => slices.push(to - from) });
        const seen = [];
        const items = await W('readOutputFile')(file, { update: (read, total) => seen.push([read, total]), say() {}, close() {} });
        const lesson = ctx.normalizeImportedLesson(items[0].raw, 1);
        assert.strictEqual(lesson.images.img_1, JPG, '원본 JSON 안에서 떼어 둔 그림을 되돌린다');
        assert.deepStrictEqual([slices.length, Math.max(...slices)], [Math.ceil(90 / 4), 4 * 1024 * 1024]);
        assert.deepStrictEqual(seen.at(-1), [file.size, file.size]);
        const text = ctx.describeOutputImport([{ from: 'html', lesson }], { fileCount: 1, where: 'x', bigFile: file.size });
        assert.ok(text.includes('· 큰 파일(90MB)도 조각으로 나눠 읽었습니다.'), text);
        assert.ok(!/저장하지 못|되돌립니다/.test(text), '큰 작업도 브라우저에 저장하므로(state.js writeBrowserState) 넣지 못한다고 미리 말하지 않는다');
        assert.ok(!ctx.describeOutputImport([{ from: 'html', lesson }], { fileCount: 1, where: 'x' }).includes('큰 파일'));
    });

    test('조각 읽기: 파일 첫머리의 BOM은 file.text()처럼 떼고, data URL 바로 뒤의 U+FEFF는 글 그대로 둔다(조각 크기와 상관없이)', () => {
        const text = `\uFEFF앞 ${JPG}\uFEFF뒤 ${MP4}\uFEFF`;
        const bytes = Buffer.from(text, 'utf8');
        [1, 2, 3, 5, 64].forEach(size => {
            const scan = W('streamScanner')();
            for (let at = 0; at < bytes.length; at += size) scan.push(new Uint8Array(bytes.subarray(at, at + size)));
            const read = scan.finish();
            assert.strictEqual(read.count, 2);
            assert.strictEqual(read.restore(read.text), text.slice(1), `조각 ${size}바이트`);
        });
    });

    /* ---------- 숨은 원본이 없는 예전 HTML ---------- */
    testAsync('예전 HTML(원본 없음): 탭 띠로 탭을 나누고 화면 글을 같은 모양의 교안 마크다운으로, 표·색 글씨·용어 문단은 HTML 그대로 되살린다', async () => withDom(async () => {
        const items = await W('readOutputFile')(fakeFile('GD_03차시_예전 교안.html', oldHtml()));
        assert.strictEqual(items.length, 1);
        assert.deepStrictEqual([items[0].from, items[0].titleRank], ['html', 2], '문서 제목은 파일 안에 적힌 제목');
        const lesson = ctx.normalizeImportedLesson(items[0].raw, 1);
        assert.strictEqual(lesson.title, '3차시: 예전 교안');
        assert.deepStrictEqual(Object.keys(lesson.tabContents).filter(id => lesson.tabContents[id]), ['basicLearn', 'assessment'], "'학습 이해도'처럼 띄어 써도 그 탭");
        const md = lesson.tabContents.basicLearn;
        [
            '## 개요 & 목표',
            '문장에 **굵게**와 *기울임*, `코드`, [링크](https://example.com/a)가 있습니다.<br>다음 줄 &lt;b>글자&lt;/b>&nbsp;끝',
            '-   항목 하나\n    -   안쪽 항목\n-   항목 둘',
            '\n\n<br>\n\n',
            '<div class="image-wrapper"><img src="local:img_r1" alt="개요 그림"',
            '<div class="image-wrapper"><img src="local:img_r2" alt="그림 설명"',
            'data-lesson-action="regenerate-image" data-keyword="그림 설명" data-img-id="img_r2"',
            '<table style="border-collapse: collapse; width: 100%;">',
            '<img src="local:img_r3" alt="표 안 그림">',
            '```js\nconst a = **b**;\nif (a < 3) {}\n```',
            '> 인용 글',
            '\n---\n',
            '\n-\n',
            '<strong>용어</strong>: 설명</p>',
            '<!-- 번호 목록 -->\n1.  고른 번호 하나\n2.  고른 번호 둘',
            '1.  바뀐 번호 목록',
            '![다이어그램](local:img_r4)'
        ].forEach(part => assert.ok(md.includes(part), `빠짐: ${part}\n---\n${md}`));
        assert.ok(md.includes('<p class="lesson-term">'), '용어 문단은 HTML 그대로');
        assert.ok(!md.includes('<script') && !/alert\(\d\)/.test(md) && !/onclick|javascript/i.test(md) && !md.includes('tdata'), '실행되는 요소·핸들러·스크립트 주소와 남은 표시는 없다');
        assert.ok(md.includes('<span style="color: red;">빨강</span> 나쁜 링크'), md.slice(-200));
        assert.ok(lesson.tabContents.assessment.includes('③ <span style="color: #22c55e; font-weight: bold;">정답 보기</span>'), '정답 색 글씨는 HTML 그대로');
        assert.ok(lesson.tabContents.assessment.includes('![\\[이미지 생성 누락\\]](local:img_r5)'), '찾지 못한 그림은 빈 그림 자리로');
        assert.deepStrictEqual(Object.keys(lesson.images), ['img_r1', 'img_r2', 'img_r3', 'img_r4'], '키 번호는 글 차례대로');
        assert.deepStrictEqual([lesson.images.img_r1, lesson.images.img_r2, lesson.images.img_r3], [POSTER, JPG, CELL]);
        const svg = Buffer.from(lesson.images.img_r4.split(',')[1], 'base64').toString('utf8');
        assert.ok(lesson.images.img_r4.startsWith('data:image/svg+xml;base64,') && svg.includes('<style>') && svg.includes('width="120"') && !svg.includes('max-width'), svg);
        assert.deepStrictEqual(plain(lesson.videos), [{ key: 'img_r1', data: MP4, title: '개요 판서' }], '판서 영상은 표지 그림 자리에');
        assert.deepStrictEqual(plain(lesson.importNotes), { old: 1, diagrams: 1 });
        assert.strictEqual(ctx.missingImageCount(lesson), 1);
        const text = ctx.describeOutputImport([{ from: 'html', lesson }], { fileCount: 1, where: 'x' });
        ['숨은 원본이 없는 예전 HTML(차시 1개)은 화면에 보이는 글을 교안 글로 바꿔 되살립니다', '차시 설명·시간은 파일에 없어 비워 둡니다', '다이어그램 1개는 파일에 원본 코드가 없어 그림으로 넣습니다',
            '· 판서 영상 1개는 그 그림 자리에 되살립니다.', '· 그림 1곳은 파일에서 찾지 못해 빈칸이 됩니다.', '그림 4장 · 판서 영상 1개'].forEach(part => assert.ok(text.includes(part), `${part}\n${text}`));
        assert.ok(!text.includes('숨겨 둔 원본'), '숨은 원본으로 되살린다고 하지 않는다');
    }));

    testAsync('예전 HTML: 표지 그림이나 영상이 없는 판서 영상은 되살리지 못한다고 센다(표지가 있으면 그림으로 남는다)', async () => withDom(async () => {
        const noPoster = ctx.normalizeImportedLesson((await W('readOutputFile')(fakeFile('a.html', oldHtml({ poster: '' }))))[0].raw, 1);
        assert.deepStrictEqual([noPoster.videos, noPoster.images.img_r1, plain(noPoster.importNotes).videosLost], [undefined, undefined, 1]);
        assert.strictEqual(ctx.missingImageCount(noPoster), 2, '표지가 없으면 빈 그림 자리');
        const noVideo = ctx.normalizeImportedLesson((await W('readOutputFile')(fakeFile('b.html', oldHtml({ video: 'blob:http://x/1' }))))[0].raw, 1);
        assert.deepStrictEqual([noVideo.videos, noVideo.images.img_r1, plain(noVideo.importNotes).videosLost], [undefined, POSTER, 1]);
        assert.ok(ctx.describeOutputImport([{ from: 'html', lesson: noVideo }], { fileCount: 1, where: 'x' }).includes('판서 영상 1개는 영상이나 표지 그림이 파일에 없어 되살리지 못합니다'));
    }));

    testAsync('예전 HTML: 243a92e 전의 차시 HTML(<body>에 바로, 탭 id 머리와 구분선)과 한 탭 화면 HTML도 되살린다', async () => withDom(async () => {
        const style = "<style>body{font-family:'Noto Sans KR',sans-serif;max-width:900px;margin:0 auto;padding:40px;line-height:1.8;color:#1a1a2e;}</style>";
        const tabs = await W('readOutputFile')(fakeFile('a.html', `<!DOCTYPE html><html><head><title>옛 차시</title>${style}</head><body><h1>basicLearn</h1><p>가</p><hr><h1>advPrac</h1><p>나</p><img src="local:img_9"></body></html>`));
        const lesson = ctx.normalizeImportedLesson(tabs[0].raw, 1);
        assert.deepStrictEqual([lesson.tabContents.basicLearn, lesson.tabContents.advPrac], ['가', '나\n\n![](local:img_r1)']);
        assert.strictEqual(ctx.missingImageCount(lesson), 1, '그림이 담기지 않은 파일이라 빈 그림 자리');
        const view = await W('readOutputFile')(fakeFile('b.html', `<html><head>${style}</head><body><p>한 탭 글</p><button data-lesson-action="delete-image">삭제</button></body></html>`));
        const one = ctx.normalizeImportedLesson(view[0].raw, 1);
        assert.deepStrictEqual([one.title, one.tabContents.basicLearn, plain(one.importNotes).unlabeled], ['b', '한 탭 글', 1], '제목은 파일 이름, 글은 기본학습 탭에, 버튼은 뺀다');
        await assert.rejects(W('readOutputFile')(fakeFile('c.html', '<html><body><p>남의 문서</p></body></html>')), /되살릴 원본이 없는 HTML입니다/);
    }));

    test('Turndown 무결성 값은 npm turndown@7.2.4 꾸러미의 dist/turndown.js와 같다(두 CDN이 같은 파일을 준다)', () => {
        if (!TurndownService) throw new Error('turndown이 없습니다');
        assert.strictEqual(require('turndown/package.json').version, '7.2.4');
        const file = fs.readFileSync(require.resolve('turndown/dist/turndown.js'));
        assert.strictEqual(run('OLD_HTML_TURNDOWN_SRI'), `sha384-${crypto.createHash('sha384').update(file).digest('base64')}`);
        assert.deepStrictEqual(plain(run('OLD_HTML_TURNDOWN_SOURCES').map(url => /turndown(@|\/)7\.2\.4\//.test(url))), [true, true]);
    });

    testAsync('Turndown은 예전 HTML을 고를 때만 받고(무결성 확인), 받지 못하면 인터넷이 필요하다고 알리며 다음에 다시 받아 본다', async () => {
        const appended = [];
        const local = { console: { warn() {} }, setTimeout, clearTimeout };
        local.document = { createElement: () => ({ remove() {} }), head: { appendChild: script => { appended.push(script); setTimeout(() => script.onerror(), 0); } } };
        local.window = local;
        vm.createContext(local);
        vm.runInContext(jsSource('output-old-html.js'), local);
        await assert.rejects(local.loadTurndown(), /인터넷에 연결된 상태에서 다시 불러오세요/);
        assert.deepStrictEqual(appended.map(script => script.src), plain(run('OLD_HTML_TURNDOWN_SOURCES')));
        assert.ok(appended.every(script => script.integrity === run('OLD_HTML_TURNDOWN_SRI') && script.crossOrigin === 'anonymous'));
        await assert.rejects(local.loadTurndown());
        assert.strictEqual(appended.length, 4);
    });

    /* ---------- 원본이 있는 HTML의 판서 영상, AVIF ---------- */
    const videoFile = () => {
        const mod = { title: '영상 차시', tabContents: { basicLearn: '<div class="image-wrapper"><img src="local:img_1" alt="판서"></div>' }, images: { img_1: POSTER } };
        const payload = ctx.lessonSourcePayload([mod], { shown: [new Map()] }); // 영상 뒤의 표지 <img>는 내보낼 때 빠져 그림이 원본에 남는다
        return fakeFile('영상.html', `<main><div class="image-wrapper"><video src="${MP4}" poster="${POSTER}" data-wb-video="wb_1" aria-label="판서 영상: 절 제목"></video></div>`
            + `<video src="${MP4}" poster="${JPG}" data-wb-video="wb_2"></video></main>${ctx.lessonSourceScript(payload)}`);
    };
    testAsync('원본이 있는 HTML(버전 2): 판서 영상을 표지 그림과 같은 그림 키에 다시 붙이고, 맞는 그림이 없는 영상은 센다', async () => {
        const lesson = ctx.normalizeImportedLesson((await W('readOutputFile')(videoFile()))[0].raw, 1);
        assert.deepStrictEqual(plain(lesson.videos), [{ key: 'img_1', data: MP4, title: '절 제목' }]);
        assert.deepStrictEqual(plain(lesson.importNotes), { videosLost: 1 });
        await withDom(async () => {
            const viaDom = ctx.normalizeImportedLesson((await W('readOutputFile')(videoFile()))[0].raw, 1);
            assert.deepStrictEqual(plain(viaDom.videos), plain(lesson.videos), '브라우저(DOMParser)도 같게 읽는다');
        });
        const crafted = ctx.normalizeImportedLesson({ title: 'x', tabContents: { basicLearn: '가' }, images: { k: POSTER }, videos: [{ key: 'k', data: 'data:text/html;base64,PHNjcmlwdD4=' }, { key: 'none', data: MP4 }, { key: 'k', data: MP4, title: 7 }] }, 1);
        assert.deepStrictEqual(plain(crafted.videos), [{ key: 'k', data: MP4, title: '' }], '영상은 data:video만, 그림이 있는 키에 하나만');
    });

    testAsync('원본이 있는 HTML: 판서 영상은 내보낼 때 적은 그림 키(data-wb-image)에 붙이고(같은 그림을 가진 다른 키가 아니라), 같은 영상이 두 번 들어 있으면 한 번만 붙이고 잃었다고 세지 않는다', async () => {
        const two = { title: '같은 그림 두 자리', tabContents: { basicLearn: '![a](local:img_1)\n\n![b](local:img_3)' }, images: { img_1: POSTER, img_3: POSTER } };
        const marked = fakeFile('키.html', `<main><video src="${MP4}" poster="${POSTER}" data-wb-video="wb_3" data-wb-image="img_3"></video></main>${ctx.lessonSourceScript(ctx.lessonSourcePayload([two], { shown: [new Map()] }))}`);
        const lesson = ctx.normalizeImportedLesson((await W('readOutputFile')(marked))[0].raw, 1);
        assert.deepStrictEqual(plain(lesson.videos).map(video => video.key), ['img_3'], '영상을 만든 그림 자리에');
        const once = { title: '한 키 두 자리', tabContents: { basicLearn: '![a](local:img_1)\n\n![a](local:img_1)' }, images: { img_1: POSTER } };
        const repeated = fakeFile('두번.html', `<main><video src="${MP4}" poster="${POSTER}" data-wb-video="wb_1"></video><video src="${MP4}" poster="${POSTER}" data-wb-video="wb_1"></video></main>${ctx.lessonSourceScript(ctx.lessonSourcePayload([once], { shown: [new Map()] }))}`);
        const again = ctx.normalizeImportedLesson((await W('readOutputFile')(repeated))[0].raw, 1);
        assert.deepStrictEqual([plain(again.videos).map(video => video.key), again.importNotes], [['img_1'], undefined], '잃은 영상이 없다');
        assert.ok(jsSource('whiteboard-video.js').includes('player.dataset.wbImage = imgId'), '보기 화면의 영상에 그림 키를 단다(내보내기가 그대로 담는다)');
    });

    test('조각 읽기: 글이 너무 많은 파일의 안내는 글자 수를 그대로 적는다(268백만 자처럼 어색하게 쓰지 않는다)', () => {
        const message = W('streamTooLong')().message;
        assert.ok(message.includes('그림·영상을 뺀 글만 268,435,456자가 넘습니다') && !message.includes('백만'), message);
    });

    test('원본이 있는 HTML: 차시가 2,000개를 넘는 파일은 그림·영상을 맞춰 보기 전에 알린다(남이 만든 아주 긴 목록에서 멈추지 않게)', () => {
        const lessons = Array.from({ length: 5000 }, (unused, i) => ({ title: `차시 ${i}`, tabContents: { basicLearn: '글' }, images: { [`img_${i}`]: POSTER } }));
        const videos = Array.from({ length: 5000 }, (unused, i) => `<video src="${MP4}" poster="data:image/png;base64,${Buffer.from(`no-${i}`).toString('base64')}" data-wb-video="wb_${i}"></video>`).join('');
        const html = `<main>${videos}</main>${ctx.lessonSourceScript({ format: 'teacher-lesson-export', version: 2, lessons })}`;
        const started = Date.now();
        assert.throws(() => W('readOutputText')('많은.html', html), /차시가 너무 많은 파일입니다\(2,000개 넘음\)/);
        assert.ok(Date.now() - started < 2000, `${Date.now() - started}ms`);
    });

    testAsync('예전 HTML: 코드 안에서 들여쓴 ``` 줄보다 긴 펜스로 감싸고, 이상한 언어 표기는 버리며, 코드의 빈 줄 둘·줄 끝 공백은 그대로 둔다', async () => withDom(async () => {
        const nested = '<pre><code class="language-md">- 목록\n  ```js\n  let a = 1;\n  ```\n</code></pre>';
        const crafted = '<pre><code class="language-x```">a\n</code></pre>';
        const spaced = '<pre><code class="language-python">def a():\n    pass\n\n\ndef b():   \n    pass\n</code></pre>';
        const html = `<!DOCTYPE html><html><head><title>코드 차시</title></head><body><main class="lesson-doc"><section class="lesson-tab"><div class="lesson-tab-label">기본학습</div><h2>코드</h2>${nested}<p>뒤의 설명 문단입니다.</p><h2>다음 섹션</h2>${crafted}${spaced}<p>끝</p></section></main></body></html>`;
        const items = await W('readOutputFile')(fakeFile('코드.html', html));
        const md = ctx.normalizeImportedLesson(items[0].raw, 1).tabContents.basicLearn;
        assert.ok(md.includes('````md\n- 목록\n  ```js\n  let a = 1;\n  ```\n````'), md);
        assert.ok(md.includes('```\na\n```') && !md.includes('x```'), '언어 표기가 앱의 모양이 아니면 버린다');
        assert.ok(md.includes('def a():\n    pass\n\n\ndef b():   \n    pass'), '코드의 빈 줄 둘과 줄 끝 공백은 코드다');
        assert.ok(md.includes('```\n\n뒤의 설명 문단입니다.\n\n## 다음 섹션'), '코드 블록 뒤의 글과 제목은 글로 남는다');
    }));

    test('AVIF 그림(Higgsfield)도 원본과 화면 표시에서 받고 빈칸으로 세지 않는다', () => {
        const payload = { format: 'teacher-lesson-export', version: 2, lessons: [{ title: 'a', tabContents: { basicLearn: '![](local:k1) ![](local:k2)' }, images: { k1: AVIF, k2: null } }] };
        const html = `<img src="${AVIF}" data-teacher-image="k2" data-teacher-lesson="0">${ctx.lessonSourceScript(payload)}`;
        const lesson = plain(ctx.normalizeImportedLesson(ctx.parseOutputHtml(html)[0], 1));
        assert.deepStrictEqual(lesson.images, { k1: AVIF, k2: AVIF });
        assert.strictEqual(ctx.missingImageCount(lesson), 0);
    });

    test('화면 태그 읽기는 닫히지 않은 <img가 아주 많아도 바로 끝난다(한 번만 훑는다)', () => {
        const crafted = `${'<img a="'.repeat(20000)}${'<img b'.repeat(20000)}`;
        const started = Date.now();
        assert.strictEqual(ctx.readShownImages(crafted).size, 0);
        assert.deepStrictEqual(plain(W('outputTags')('<img src="a"><img alt=\'>\' src="b"><img x', 'img').map(attrs => attrs.get('src'))), ['a', 'b']);
        assert.ok(Date.now() - started < 1500, `${Date.now() - started}ms`);
    });

    /* ---------- 예전(af5287a) 교수안 HTML의 교수안 그림 ---------- */
    const pic = tag => `data:image/png;base64,${Buffer.from(tag.repeat(30)).toString('base64')}`;
    const [NEW, OLD, A, B, C, FIX, REF, DECK] = ['NEW', 'OLD', 'AAA', 'BBB', 'CCC', 'FIX', 'REF', 'DECK'].map(pic);
    const gyosuanLesson = (images = { ai_a: A, ai_b: B, ai_c: C, img_1: OLD }) => ({
        title: '변수', tabContents: { basicLearn: '![](local:img_1)' }, images: { img_1: NEW }, refImages: [{ name: '참고', url: REF }],
        gyosuan: {
            docMd: `## 진행\n\n![](local:ai_a)\n\n**강사 활동**: 설명 ![](local:ai_b) 이어서\n\n- 항목 ![](local:ai_c)\n\n| 키 | 값 |\n|---|---|\n| 그림 | ![](local:img_1) |\n\n본문 ![](${FIX}) 끝\n\n![](local:ai_a)`,
            deckMd: '### 슬라이드 1 - 시작\n- 이미지/시각: 그림 ![](local:ai_deck)', images
        }
    });
    // af5287a가 만든 교수안 HTML: 원본은 version 1(교수안 그림 칸 없음), 교수안 그림은 화면 문서에만(교수안 그림이 차시 그림 위에 얹힌다)
    const oldGyosuanFile = (mod, tamper = html => html) => {
        const K = ctx.window.KBuilder;
        const images = { ...mod.images, ...mod.gyosuan.images };
        const resolved = mod.gyosuan.docMd.replace(/!\[([^\]]*)\]\(local:([^)\s]+)\)/g, (match, alt, id) => (images[id] ? `![${alt}](${images[id]})` : ''));
        const mount = { innerHTML: '', querySelectorAll: () => [] };
        K.buildDoc(K.parseDoc(resolved), mount, { refs: mod.refImages });
        const texts = [...Object.values(mod.tabContents), mod.gyosuan.docMd, mod.gyosuan.deckMd].join('\n');
        const used = Object.fromEntries(Object.entries(mod.images).filter(([id]) => texts.includes(`local:${id}`)));
        const payload = { format: 'teacher-lesson-export', version: 1, lessons: [{ title: mod.title, description: '', tabContents: mod.tabContents, images: used, gyosuan: { docMd: mod.gyosuan.docMd, deckMd: mod.gyosuan.deckMd } }] };
        return `<!DOCTYPE html><html><body class="gyosuan-view">${tamper(mount.innerHTML)}${ctx.lessonSourceScript(payload)}</body></html>`;
    };
    const readGyosuan = html => plain(ctx.normalizeImportedLesson(ctx.parseOutputHtml(html)[0], 1));

    test('예전 교수안 HTML: 화면 교수안의 블록·글 속·목록·표 그림을 되찾고, 참고 이미지는 빼고, 편성안에만 있던 그림은 빈칸으로 센다', () => {
        const lesson = readGyosuan(oldGyosuanFile(gyosuanLesson()));
        assert.deepStrictEqual(lesson.gyosuan.images, { ai_a: A, ai_b: B, ai_c: C, img_1: OLD }, '다시 그린 차시 그림이면 교수안 쪽은 옛 그림을 남긴다');
        assert.strictEqual(lesson.images.img_1, NEW);
        assert.strictEqual(ctx.missingImageCount(lesson), 1, '편성안에만 있던 그림(ai_deck)');
        const same = readGyosuan(oldGyosuanFile(gyosuanLesson({ ai_a: A, ai_b: B, ai_c: C })));
        assert.deepStrictEqual(Object.keys(same.gyosuan.images), ['ai_a', 'ai_b', 'ai_c'], '차시 그림과 같은 그림은 다시 담지 않는다');
    });

    test('예전 교수안 HTML: 그림 하나가 빠졌거나, 글에 박힌 그림이 자리를 옮겼거나, 한 키가 두 그림이면 아무것도 채우지 않는다', () => {
        assert.deepStrictEqual(readGyosuan(oldGyosuanFile(gyosuanLesson({ ai_a: A, ai_c: C, img_1: OLD }))).gyosuan.images, {}, '빠진 그림');
        assert.deepStrictEqual(readGyosuan(oldGyosuanFile(gyosuanLesson(), html => html.replace(FIX, pic('XXX')))).gyosuan.images, {}, '글에 박힌 그림');
        const lastA = html => { const at = html.lastIndexOf(A); return html.slice(0, at) + pic('ZZZ') + html.slice(at + A.length); };
        assert.deepStrictEqual(readGyosuan(oldGyosuanFile(gyosuanLesson(), lastA)).gyosuan.images, {}, '한 키가 두 그림');
        const slotText = gyosuanLesson();
        slotText.gyosuan.docMd += '\n\n![](data:image/x-teacher-slot,99) ![](data:image/x-teacher-slot,1)';
        assert.doesNotThrow(() => readGyosuan(oldGyosuanFile(slotText)), '교수안 글에 자리 표시 모양의 글이 있어도 멈추지 않는다');
        const v2 = { ...JSON.parse(oldGyosuanFile(gyosuanLesson()).match(/teacher-source">(.*)<\/script>/)[1]), version: 2 };
        assert.deepStrictEqual(readGyosuan(`<body class="gyosuan-view">${ctx.lessonSourceScript(v2)}</body>`).gyosuan.images, {}, '버전 2 파일은 손대지 않는다');
        const started = Date.now();
        readGyosuan(`<body class="gyosuan-view"><div class="doc-body">${'<img a'.repeat(30000)}${ctx.lessonSourceScript(JSON.parse(oldGyosuanFile(gyosuanLesson()).match(/teacher-source">(.*)<\/script>/)[1]))}`);
        assert.ok(Date.now() - started < 1500, `닫히지 않은 그림 태그가 많아도 바로 끝난다: ${Date.now() - started}ms`);
    });

    testAsync('예전 교수안 HTML: 브라우저(DOMParser)로 읽어도, 큰 그림을 조각 읽기로 떼어 둬도 같은 그림을 되찾는다', async () => withDom(async () => {
        const BIG = { ai_a: big('image/png', 'BIG-A-'), ai_b: big('image/png', 'BIG-B-'), ai_c: C, img_1: OLD };
        const items = await W('readOutputFile')(fakeFile('교수안.html', oldGyosuanFile(gyosuanLesson(BIG))));
        assert.deepStrictEqual(plain(ctx.normalizeImportedLesson(items[0].raw, 1).gyosuan.images), BIG);
    }));

    /* ---------- 고른 파일 모두: 상한, 기록, 넣기 ---------- */
    function flowSetup({ confirm = true, saveFails = false, unread = false } = {}) {
        const flow = { alerts: [], toasts: [], confirms: [], saved: 0, db: { set: [], deleted: [] } };
        Object.assign(ctx, {
            globalState: { subjects: [{ id: 'subject_a', title: '내 교과', lessons: [] }] },
            currentSubjectId: 'subject_a',
            courseData: [],
            location: { hash: '#overview' },
            isStateLoadFailed: () => unread,
            confirmAsync: async message => { flow.confirms.push(message); return confirm; },
            saveState: async () => { flow.saved += 1; return !saveFails; },
            renumberLessons: (items, existing) => items.map((item, i) => ({ ...item, id: 100 + existing.length + i })),
            sanitizeState: state => state,
            generateUniqueId: prefix => `${prefix}new`,
            renderSidebar() {},
            viewModule() {},
            projectFolderHandle: null,
            DBManager: { setItem: async (key, value) => { flow.db.set.push([key, value]); }, deleteItem: async key => { flow.db.deleted.push(key); } },
            WB_VIDEO_KEY: id => `wbvideo:${id}`,
            newWhiteboardRequestId: () => `wb_${flow.db.set.length + 1}abc`
        });
        Object.assign(ctx.window, { showAlert: text => flow.alerts.push(text), showToast: text => flow.toasts.push(text), saveRawContent() {} });
        return flow;
    }
    const importFiles = files => ctx.window.importOutputFiles({ target: { files, value: 'x' } });
    const many = (name, total) => fakeFile(name, ctx.lessonSourceScript({ format: 'teacher-lesson-export', version: 2, lessons: Array.from({ length: total }, (_, i) => ({ title: `${name} ${i}`, tabContents: { basicLearn: `${name} ${i}` } })) }));

    testAsync('한 번에 불러오는 차시: 고른 파일을 모두 합쳐 2,000개를 넘으면 그 파일에서 멈추고 아무것도 넣지 않는다(넘지 않으면 묻는다)', async () => {
        const flow = flowSetup();
        let lateReads = 0;
        await importFiles([many('a.html', 1500), many('b.html', 600), fakeFile('c.md', '나'), many('d.html', 499), fakeFile('e.md', '가', { onSlice: () => { lateReads += 1; } })]);
        assert.deepStrictEqual([flow.confirms.length, flow.saved, lateReads], [0, 0, 0], '묻지도 넣지도 않고 넘은 뒤의 파일은 읽지 않는다');
        assert.ok(flow.alerts[0].includes('모두 합쳐 2,000개를 넘습니다') && flow.alerts[0].includes("'b.html'에서 넘음") && flow.alerts[0].includes('아무것도 넣지 않았습니다'), flow.alerts[0]);
        const fits = flowSetup({ confirm: false });
        await importFiles([many('a.html', 1500), fakeFile('c.md', '나'), many('d.html', 499)]);
        assert.ok(fits.confirms[0].startsWith('파일 3개에서 차시 2,000개를 찾았습니다.'), fits.confirms[0]);
    });

    testAsync('일부러 건너뛴 파일(ZIP, 남의 HTML)은 콘솔에 경고로만 남기고 오류로 남기지 않는다', async () => {
        const flow = flowSetup({ confirm: false });
        const logs = { warn: 0, error: 0 };
        const saved = ctx.console;
        ctx.console = { ...console, warn: () => { logs.warn += 1; }, error: () => { logs.error += 1; } };
        try {
            await importFiles([fakeFile('백업.zip', 'PK'), fakeFile('남의 문서.html', '<html><body>x</body></html>'), fakeFile('a.md', '글')]);
        } finally {
            ctx.console = saved;
        }
        assert.deepStrictEqual(logs, { warn: 2, error: 0 });
        assert.ok(flow.confirms[0].includes('건너뛰는 파일 2개'));
    });

    testAsync('저장된 작업을 읽지 못한 동안에는 파일을 읽지 않고 알린다', async () => {
        const flow = flowSetup({ unread: true });
        let reads = 0;
        await importFiles([fakeFile('a.md', '글', { onSlice: () => { reads += 1; } })]);
        assert.strictEqual(reads, 0);
        assert.ok(flow.alerts[0].startsWith('저장된 작업을 읽지 못한 동안에는 내보낸 교안을 불러오지 않습니다'), flow.alerts[0]);
    });

    testAsync('넣기: 판서 영상은 whiteboard-video.js와 같은 자리(wbvideo:새 id)에 Blob으로 저장하고, 브라우저에 저장하지 못하면 되돌리며 영상 파일도 지운다', async () => withDom(async () => {
        const flow = flowSetup();
        await importFiles([fakeFile('예전.html', oldHtml())]);
        const subject = ctx.globalState.subjects.at(-1);
        assert.strictEqual(subject.id, 'subject_new', '개요 화면에서는 새 교과에');
        const [lesson] = subject.lessons;
        const video = lesson.whiteboardVideos.img_r1;
        assert.deepStrictEqual([Object.keys(lesson.whiteboardVideos), video.title, video.ext, typeof video.at, video.id], [['img_r1'], '개요 판서', 'mp4', 'number', 'wb_1abc']);
        const [key, blob] = flow.db.set[0];
        assert.strictEqual(key, 'wbvideo:wb_1abc');
        assert.ok(blob instanceof Blob && blob.type === 'video/mp4' && blob.size === Buffer.from(MP4.split(',')[1], 'base64').length);
        assert.ok(!('videos' in lesson) && !('importNotes' in lesson), '넣기 전에 떼는 칸은 차시에 남기지 않는다');
        assert.ok(flow.toasts[0].includes('차시 1개를 불러왔습니다'));
        const failing = flowSetup({ saveFails: true });
        const before = ctx.globalState.subjects;
        await importFiles([fakeFile('예전.html', oldHtml())]);
        assert.strictEqual(ctx.globalState.subjects, before, '넣기 전으로 돌린다');
        assert.deepStrictEqual(failing.db.deleted, failing.db.set.map(([stored]) => stored), '방금 저장한 영상 파일을 지운다');
        assert.ok(failing.alerts.at(-1).startsWith('불러온 차시를 브라우저에 저장하지 못해 넣지 않았습니다') && failing.toasts.length === 0, failing.alerts.at(-1));
    }));
};
