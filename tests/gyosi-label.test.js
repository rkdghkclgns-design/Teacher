// 1시간 칸 이름 테스트 (실행: node tests/gyosi-label.test.js)
// 차시 하나가 하루 8시간이라 교수안·슬라이드가 1시간마다 나누는 칸은 '교시'로 부른다(20차).
// 새 산출물(교시별 교수안·편성안·파일 이름·화면 단추)은 교시로 쓰고, 같은 산출물 속 차시(하루 8시간 수업)를 가리키는 말은 그대로 둔다.
// 예전 이름('N차시')으로 받은 교수안·편성안 파일과 예전 이름으로 만든 교시 덱의 화면 편집본도 그대로 읽는지 본다.
// AI는 부르지 않는다(부르면 실패한다).
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { loadLessonTracks } = require('./lesson-tracks');
const root = path.join(__dirname, '..', 'js') + path.sep;
const FILES = [
    'filename-convention.js',
    'kbuilder/parser.js', 'kbuilder/render-doc.js', 'kbuilder/render-deck.js', 'kbuilder/ref-images.js', 'kbuilder/import-html.js', 'kbuilder/auto-images.js',
    'kbuilder/export.js', 'kbuilder/sample-data.js', 'course-ncs.js', 'course-design.js', 'course-sessions.js', 'course-meta.js', 'gyosuan.js', 'gyosuan-view.js', 'gyosuan-images.js',
    'import-stream.js', 'gyosuan-io.js', 'gyosuan-deck-tidy.js', 'gyosuan-regen.js'
];

// 차시(하루 8시간 수업)를 가리키는 말: 교시 이름으로 바꾸지 않는다
const LESSON_WORDS = ['이 차시의 재미 요소를 설명할 수 있다.', '이 차시에서 만든 메모는 다음 차시 실습에 쓴다.', '다음 차시 실습과 이어지도록 메모를 남긴다.'];

const DOC = `---
교과목: 게임 기획 입문
주제: 재미
소요: 2시수(약 120분)
date: 2026-11-12
status: 초안(AI 생성)
---

# 교수안 - 재미

## 학습 목표

- ${LESSON_WORDS[0]}
- 간단한 기획 메모를 작성할 수 있다.

## 개요

| 항목 | 내용 |
|---|---|
| 교과목 | 게임 기획 입문 |
| 주제 | 재미 |
| 소요 | 2시수(약 120분) |
| 대상 | 완전 초보 |

## 수업 흐름 한눈에 보기

| 단계 | 시간 | 핵심 |
|---|---|---|
| 도입 | 10분 | 재미란 |
| 전개 1 | 40분 | 재미 분석 |
| 전개 2 | 60분 | 기획 메모 실습 |
| 정리 | 10분 | 묶기 |

## 진행

### 도입 - 오늘의 주제 열기

**강사 활동**: 질문으로 연다.

### 전개 1 - 재미 분석

**설명 내용**: MDA를 설명한다.
**학생 활동**: 게임의 재미 요소를 고른다.

### 전개 2 - 활동: 기획 메모 실습

**설명 내용**: ${LESSON_WORDS[1]}
**학생 활동**: 기획 메모를 쓴다.

### 정리 - 오늘 배운 것 묶기

**설명 내용**: 핵심을 묶는다.

## 평가·체크포인트

- MDA를 설명했는가

## 강사 유의사항

- ${LESSON_WORDS[2]}
`;

const DECK = `---
교과목: 게임 기획 입문
주제: 재미
---

# 슬라이드 편성안 - 재미

## 슬라이드 편성

### 슬라이드 1 - 재미의 세 층
- 대응 교수안: 전개 1
- 슬라이드 문구:
  - 메카닉은 규칙입니다
- 이미지/시각: 세 층으로 쌓인 피라미드
- 핵심 메시지: 재미는 설계된다.

### 슬라이드 2 - 기획 메모 쓰는 법
- 대응 교수안: 전개 2
- 슬라이드 문구:
  - 목표를 적습니다
- 이미지/시각: 메모지를 쓰는 손
- 핵심 메시지: 메모가 기획의 시작이다.
`;

function makeContext() {
    const elements = {};
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, URL, encodeURIComponent, Blob, TextDecoder,
        isBackupTooBig: err => err instanceof RangeError,
        LESSON_TABS: ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment'].map(id => ({ id })),
        TEXT_MODEL: 'claude-opus-5-5',
        CONTEXT_CORE: { personas: { instructor: '강사' } },
        INSTRUCTOR_TONE_PRESETS: [], instructorTone: '',
        getReferenceContext: () => '',
        stripInstructorCallouts: text => text,
        courseData: [],
        globalState: { subjects: [{ id: 's1', title: '게임 기획 입문' }], courseTitle: '과정' },
        currentSubjectId: 's1', currentEditingModuleId: 'm1',
        escapeHtml: text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
        localStorage: { getItem: () => null, setItem() {} },
        document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, getElementById: id => elements[id] || null, createElement: () => ({ appendChild() {} }) },
        BroadcastChannel: function () { this.postMessage = () => {}; },
        saveState: async () => {},
        renderEditor: () => {},
        callGemini: async () => { throw new Error('AI를 부르면 안 된다'); },
        confirmAsync: async () => true,
        alerts: [], toasts: [], saved: []
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = message => ctx.toasts.push(message);
    vm.createContext(ctx);
    loadLessonTracks(ctx);
    FILES.forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), ctx));
    vm.runInContext('downloadMd = (md, name) => { window.saved.push({ md, name }); };', ctx);
    return ctx;
}

const plain = value => JSON.parse(JSON.stringify(value));
const call = (ctx, name) => vm.runInContext(name, ctx);
const lesson = () => ({ id: 'm1', title: '재미', hours: 2, gyosuan: { docMd: DOC, deckMd: DECK }, gyosuanAdv: { docMd: DOC, deckMd: DECK }, tabContents: {} });

// 차시(하루 수업)를 가리키는 말을 빼면 '차시'가 남지 않는다 = 1시간 칸에는 차시라는 이름이 없다
function assertNoHourlyChasi(text, label) {
    const rest = LESSON_WORDS.reduce((left, words) => left.split(words).join(''), String(text));
    assert.ok(!rest.includes('차시'), `${label}: 1시간 칸에 '차시'가 남았다 → ${(rest.match(/.{0,30}차시.{0,30}/) || [''])[0]}`);
}

// 예전(19차까지) 이름으로 받은 파일: 1시간 칸 이름만 차시였다
const asOldExport = text => String(text).replace(/교시/g, '차시');

let failed = 0;
async function run(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (err) {
        failed += 1;
        console.log('FAIL', name);
        console.log(err);
    }
}

(async () => {
    await run('교시별 교수안: 머리·표·교시마다의 제목과 개요·흐름·안내를 교시로 쓰고, 차시(하루 수업)를 가리키는 말은 그대로 둔다', () => {
        const ctx = makeContext();
        const md = call(ctx, 'gyosuanSessionsMd')(lesson());
        [
            '주제: 재미 (교시별 교수안)', '소요: 2교시', '# 교시별 교수안 - 재미',
            '### 교시 구성 (1교시 = 1시간)', '| 교시 | 시간 | 진행 단계 |', '| 1교시. 재미 (1/2) |', '| 2교시. 재미 (2/2) |',
            '# 1교시. 재미 (1/2)', '- 시간: 1시간 (1/2교시)', '| 교시 | 1 / 2교시 (약 1시간) |', '| **합계** | **1시간** | 1교시 |',
            '(다음 교시에 계속)', '*남은 활동은 다음 교시에 이어서 진행한다.*', '체크리스트는 수업을 마치는 교시에 확인한다.',
            '# 2교시. 재미 (2/2)', '이전 교시 연결과 이번 교시 목표 확인', '**강사 활동**: 이전 교시에서 다룬 내용을', '**설명 내용**: 이번 교시 흐름 - ',
            '*앞 교시에서 시작한 활동을 이어서 진행한다.*', "'(이어서)'·'(다음 교시에 계속)'은 한 단계가 교시 경계에 걸쳐 나뉜 것이다.",
            '교시 도입·정리(각 5분)를 넣기 위해'
        ].forEach(text => assert.ok(md.includes(text), text));
        LESSON_WORDS.forEach(words => assert.ok(md.includes(words), `차시(하루 수업)를 가리키는 말은 그대로: ${words}`));
        assertNoHourlyChasi(md, '교시별 교수안');
        const one = call(ctx, 'gyosuanSessionPlanMd')(lesson(), 1);
        assert.ok(one.startsWith('# 2교시. 재미 (2/2)'), one.slice(0, 40));
        assertNoHourlyChasi(one, '교시 하나 교수안');
    });

    await run('교수안 개요의 구성표: 60분이 넘으면 교시 구성표, 과정 설계서는 같은 교시 시간표', () => {
        const ctx = makeContext();
        const table = call(ctx, 'gyosuanSessionTable')([['도입', '10분', '시작'], ['전개', '80분', '본문']], '긴 수업').join('\n');
        assert.ok(table.startsWith('### 교시 구성 (1교시 = 1시간)') && table.includes('| 교시 | 시간 | 진행 단계 |') && table.includes('| 2교시. 긴 수업 (2/2) |'), table);
        assertNoHourlyChasi(table, '교시 구성표');
        const design = call(ctx, 'subjectSessionLines')({ lessons: [{ title: '블록', hours: 2, flow: [{ phase: '전개', title: '본문', minutes: 120 }] }] }).join('\n');
        assert.ok(design.startsWith('### 시간표 (1교시 = 1시간)') && design.includes('2교시. 블록 (2/2)'), '과정 설계서는 예전처럼 시간표');
    });

    await run('교시별 편성안: 주제·표지·목차·목표·마무리를 교시로 쓰고, 교안 목표의 차시는 그대로 둔다', () => {
        const ctx = makeContext();
        const md = call(ctx, 'gyosuanSessionDeckMd')(lesson(), 0);
        const deck = ctx.KBuilder.parseDeck(md);
        assert.strictEqual(deck.meta['주제'], '1교시. 재미 (1/2)');
        assert.strictEqual(deck.meta['교시'], '1/2');
        const texts = deck.slides.flatMap(slide => slide.lines.map(line => line.text));
        ['(하단) 1교시 / 2교시 · 1시간', '이번 교시 흐름', '(큰 문구) 1교시 정리 - 재미 (1/2)', '다음 교시: 재미'].forEach(text => assert.ok(texts.includes(text), text));
        ['# 슬라이드 편성안 - 1교시. 재미 (1/2)', '- 이미지/시각: 교시 주제를 상징하는 대표 일러스트', '- 핵심 메시지: 이번 교시에서 확인할 목표입니다.',
            '- 핵심 메시지: 이번 교시 핵심을 확인하고 다음 교시로 이어 갑니다.', '- 1교시 편성안 초안입니다.'].forEach(text => assert.ok(md.includes(text), text));
        assert.ok(texts.includes(`1. ${LESSON_WORDS[0]}`), '학습목표 슬라이드의 차시(하루 수업)는 그대로');
        assertNoHourlyChasi(md, '교시 편성안');
        const all = call(ctx, 'gyosuanSessionDecksMd')(lesson());
        assert.ok(all.includes('주제: 재미 (교시별 슬라이드)') && all.includes('# 슬라이드 편성안 - 2교시. 재미 (2/2)'));
        assertNoHourlyChasi(all, '교시별 편성안 묶음');
    });

    await run('파일 이름: 교시별 MD·편성안과 교시 하나는 교시로, 앞의 차시 파일 이름(NN차시)은 그대로', () => {
        const ctx = makeContext();
        const mod = lesson();
        ctx.courseData = [mod];
        ctx.getEditingModule = () => mod;
        const base = call(ctx, 'lessonFileBase')(mod);
        assert.strictEqual(base, '게임기획입문_01차시_재미', '차시 파일 이름은 차시 번호 그대로');
        ctx.downloadGyosuanSessions('m1', 'basic');
        ctx.downloadGyosuanSessionDecks('m1', 'basic');
        ctx.downloadGyosuanSession('m1', 'doc:1', 'basic');
        ctx.downloadGyosuanSession('m1', 'deck:0', 'basic');
        ctx.downloadGyosuanSessions('m1', 'adv');
        ctx.downloadGyosuanSessionDecks('m1', 'adv');
        ctx.downloadGyosuanSession('m1', 'doc:0', 'adv');
        assert.deepStrictEqual(ctx.saved.map(file => file.name), [
            `${base}_교시별교수안`, `${base}_교시별편성안`, `${base}_2교시_교수안`, `${base}_1교시_편성안`,
            `${base}_심화교시별교수안`, `${base}_심화교시별편성안`, `${base}_1교시_심화교수안`
        ]);
        ctx.downloadGyosuanSession('m1', 'doc:9', 'basic');
        assert.strictEqual(ctx.alerts.at(-1), '교시를 찾지 못했습니다. 교수안을 확인해주세요.');
        // 슬라이드 스튜디오가 내보내는 교시 덱 파일 이름의 앞말
        const payload = plain(ctx.getSlideStudioPayload('m1', 1));
        assert.strictEqual(payload.fileBase, `${base}_2교시`);
        assert.deepStrictEqual(plain(ctx.getSlideStudioPayload('m1~adv', 0)).fileBase, `${base}_심화_1교시`);
        assert.strictEqual(plain(ctx.getSlideStudioPayload('m1')).fileBase, base, '전체 덱은 차시 파일 이름 그대로');
        assert.ok(payload.sessions.every(item => !/교시|차시/.test(item.title)), '스튜디오에 넘기는 교시 목록 제목에는 번호를 붙이지 않는다(스튜디오가 붙인다)');
    });

    await run('교수안 화면 단추: 교시별 MD·교시별 편성안·교시 하나 받기', () => {
        const ctx = makeContext();
        const mod = lesson();
        ctx.getEditingModule = () => mod;
        const pick = call(ctx, 'gyosuanSessionPickHtml')(mod, 'basic');
        ['aria-label="교시 하나 받기"', '<option value="">교시 하나 받기</option>', '>1교시 교수안</option>', '>2교시 교수안</option>', '>1교시 편성안</option>'].forEach(text => assert.ok(pick.includes(text), text));
        assert.ok(!pick.includes('차시'), pick);
        const toolbar = call(ctx, 'gyosuanToolbarHtml')(mod, 'basic');
        assert.ok(toolbar.includes('교시별 MD') && toolbar.includes('교시별 편성안') && !toolbar.includes('차시별'), '교수안 도구 줄');
        const studio = fs.readFileSync(path.join(__dirname, '..', 'slide-studio.html'), 'utf8');
        assert.ok(studio.includes('title="한 교시(1시간)만 따로 열기"'), '스튜디오의 교시 고르기 칸 도움말');
    });

    await run('예전 교수안의 구성표: 예전 이름(### 차시 구성)과 새 이름(### 교시 구성) 모두 수업 흐름으로 읽지 않는다', () => {
        const ctx = makeContext();
        const table = call(ctx, 'gyosuanSessionTable')([['전개', '90분', '본문']], '재미').join('\n');
        [table, asOldExport(table)].forEach(block => {
            const docMd = DOC.replace('## 진행', `${block}\n## 진행`);
            assert.deepStrictEqual(plain(call(ctx, 'gyosuanFlow')({ ...lesson(), gyosuan: { docMd } })).map(step => step.minutes), [10, 40, 60, 10], block.split('\n')[0]);
            assert.strictEqual(plain(call(ctx, 'gyosuanSessionList')({ ...lesson(), gyosuan: { docMd } })).length, 2);
        });
    });

    await run('완성 MD 불러오기: 예전 이름(N차시·차시별)과 새 이름(N교시·교시별)으로 받은 교수안·편성안을 모두 읽는다', () => {
        const ctx = makeContext();
        const sort = call(ctx, 'sortGyosuanFiles');
        const mod = lesson();
        const exports = {
            sessionDoc: call(ctx, 'gyosuanSessionPlanMd')(mod, 1),
            sessionDeck: call(ctx, 'gyosuanSessionDeckMd')(mod, 0),
            allDocs: call(ctx, 'gyosuanSessionsMd')(mod),
            allDecks: call(ctx, 'gyosuanSessionDecksMd')(mod)
        };
        const base = '게임기획입문_01차시_재미';
        [['교시', text => text], ['차시', asOldExport]].forEach(([period, age]) => {
            const doc = plain(sort([{ name: `${base}_2${period}_교수안.md`, text: age(exports.sessionDoc) }, { name: `${base}_1${period}_편성안.md`, text: age(exports.sessionDeck) }]));
            assert.ok(doc.docMd && doc.docMd.startsWith(`# 2${period}. 재미 (2/2)`) && doc.deckMd && doc.deckMd.includes(`주제: 1${period}. 재미 (1/2)`), `${period} 하나 받은 파일`);
            const all = plain(sort([{ name: `${base}_${period}별교수안.md`, text: age(exports.allDocs) }, { name: `${base}_${period}별편성안.md`, text: age(exports.allDecks) }]));
            assert.ok(all.docMd && all.deckMd, `${period}별 파일`);
            // 받은 교시 교수안을 다시 나눠도 개요의 '몇 번째 1시간' 줄은 교시마다 새로 한 번만 쓴다(예전 '| 차시 | 2 / 2차시 |' 줄도 남기지 않는다)
            const again = call(ctx, 'gyosuanSessionsMd')({ ...mod, gyosuan: { docMd: doc.docMd, deckMd: doc.deckMd } });
            const blocks = again.split(/^(?=# \d+교시\. )/m).slice(1);
            assert.ok(blocks.length >= 1, again.slice(0, 300));
            blocks.forEach(block => assert.strictEqual((block.match(/^\| 교시 \| \d+ \/ \d+교시/gm) || []).length, 1, block.slice(0, 600)));
            assert.ok(!/^\| 차시 \| \d+ \/ \d+차시/m.test(again), '예전 이름의 교시 줄은 빼고 다시 쓴다');
            // 받은 파일의 단계 제목·본문은 받은 글 그대로 둔다(예전 파일이면 그 안의 '이전 차시 연결' 같은 글도 그대로). 새로 쓰는 머리와 표만 교시다
            assert.ok(again.includes('# 교시별 교수안 - 재미') && again.includes('### 교시 구성 (1교시 = 1시간)') && again.includes('# 1교시. '), `${period} 이름 파일을 다시 나눈 교수안`);
            if (period === '교시') assertNoHourlyChasi(again, '새 이름 파일을 다시 나눈 교수안');
        });
        // 차시 번호를 적은 다른 개요 줄(완성 MD)은 그대로 둔다
        const custom = DOC.replace('| 대상 | 완전 초보 |', '| 대상 | 완전 초보 |\n| 차시 | 3차시 |');
        assert.ok(call(ctx, 'gyosuanSessionsMd')({ ...mod, gyosuan: { docMd: custom } }).includes('| 차시 | 3차시 |'));
    });

    await run('내보낸 교안 다시 불러오기: 예전·새 이름의 교시 교수안·편성안 MD는 교안 차시로 넣지 않고 교수안 화면으로 안내한다', () => {
        const octx = { console: { log() {}, warn() {}, error() {} }, window: {}, JSON, Date, Object, LESSON_TABS: [{ id: 'basicLearn', label: '기본학습' }], location: { hash: '' },
            encodeURIComponent, decodeURIComponent, TextDecoder, TextEncoder, Uint8Array, Blob, atob, btoa, setTimeout };
        vm.createContext(octx);
        ['import-stream.js', 'output-import.js'].forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), octx));
        const ctx = makeContext();
        const mod = lesson();
        const docMd = call(ctx, 'gyosuanSessionsMd')(mod);
        const deckMd = call(ctx, 'gyosuanSessionDeckMd')(mod, 0);
        const base = '게임기획입문_01차시_재미';
        [
            [`${base}_교시별교수안.md`, docMd], [`${base}_차시별교수안.md`, asOldExport(docMd)],
            [`${base}_교시별편성안.md`, deckMd], [`${base}_차시별편성안.md`, asOldExport(deckMd)],
            [`${base}_2교시_교수안.md`, docMd], [`${base}_2차시_교수안.md`, asOldExport(docMd)],
            [`${base}_1교시_심화편성안.md`, deckMd], [`${base}_1차시_심화편성안.md`, asOldExport(deckMd)]
        ].forEach(([name, text]) => {
            assert.throws(() => vm.runInContext('readOutputText', octx)(name, text), /교수안·편성안 MD입니다/, name);
        });
    });

    await run('교시 덱 화면 편집본: 예전 이름(N차시.)으로 만든 편집본은 그 주제로 열어 그림 칸 id가 맞고, 새 편집본·편집본이 없으면 교시로 연다', () => {
        const ctx = makeContext();
        const K = ctx.KBuilder;
        const mod = lesson();
        ctx.getEditingModule = () => mod;
        const fresh = call(ctx, 'gyosuanSessionDeckMd')(mod, 1);
        const old = fresh.replace('주제: 2교시. 재미 (2/2)', '주제: 2차시. 재미 (2/2)'); // 예전 앱이 스튜디오에 넘긴 편성안의 주제
        const slotIds = html => [...String(html).matchAll(/<image-slot id="([^"]+)"/g)].map(match => match[1]);
        const oldHtml = K.renderDeckHtml(K.parseDeck(old));
        const newHtml = K.renderDeckHtml(K.parseDeck(fresh));
        assert.ok(slotIds(oldHtml).length && slotIds(oldHtml)[0] !== slotIds(newHtml)[0], '주제가 바뀌면 그림 칸 id도 바뀐다(js/kbuilder/render-deck.js deckKey)');
        assert.ok(slotIds(oldHtml)[0].startsWith(`${call(ctx, 'studioSlotPrefix')('2차시. 재미 (2/2)')}-img-`), '앞말 셈은 스튜디오와 같다');
        mod.gyosuan = { ...mod.gyosuan, sessionDecks: { 1: oldHtml } };
        const legacy = plain(ctx.getSlideStudioPayload('m1', 1));
        assert.strictEqual(K.parseDeck(legacy.deckMd).meta['주제'], '2차시. 재미 (2/2)', '예전 편집본은 예전 주제로');
        assert.deepStrictEqual(slotIds(K.renderDeckHtml(K.parseDeck(legacy.deckMd))), slotIds(oldHtml), 'PPTX가 찾는 그림 칸 id가 편집본과 같다');
        assert.strictEqual(legacy.fileBase.endsWith('_2교시'), true, '내보내는 파일 이름은 교시');
        mod.gyosuan = { ...mod.gyosuan, sessionDecks: { 1: newHtml } };
        assert.strictEqual(K.parseDeck(plain(ctx.getSlideStudioPayload('m1', 1)).deckMd).meta['주제'], '2교시. 재미 (2/2)', '새 편집본은 교시로');
        mod.gyosuan = { ...mod.gyosuan, sessionDecks: { 1: '<section class="slide">그림 칸 없음</section>' } };
        assert.strictEqual(K.parseDeck(plain(ctx.getSlideStudioPayload('m1', 1)).deckMd).meta['주제'], '2교시. 재미 (2/2)', '그림 칸이 없는 편집본은 교시로');
        mod.gyosuan = { ...mod.gyosuan, sessionDecks: {} };
        assert.strictEqual(K.parseDeck(plain(ctx.getSlideStudioPayload('m1', 1)).deckMd).meta['주제'], '2교시. 재미 (2/2)', '편집본이 없으면 교시로');
        assert.strictEqual(K.parseDeck(call(ctx, 'gyosuanSessionDeckMd')(mod, 1)).meta['주제'], '2교시. 재미 (2/2)', '내려받는 편성안은 늘 교시');
    });

    await run('내보낸 슬라이드 HTML 불러오기: 그 수업에 없는 교시 덱이면 교시로 알린다', () => {
        const ctx = makeContext();
        const target = call(ctx, 'importTarget')({ source: { session: 4 } }, null, 2);
        assert.strictEqual(target.error, '이 파일은 5교시 슬라이드입니다. 이 수업은 2교시까지 있어 넣을 수 없습니다.');
        assert.strictEqual(call(ctx, 'importTarget')({ source: { session: 1 } }, null, 2).session, 1, '교시 번호(sessionDecks 키)는 그대로');
    });

    if (failed) {
        console.log(`${failed}개 실패`);
        process.exit(1);
    }
})();
