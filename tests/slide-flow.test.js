// 슬라이드 흐름 테스트 (실행: node tests/slide-flow.test.js)
// 편성안 수정·슬라이드 형식·차시별 산출물·참고 이미지·이미지 자동 생성·MD 변환·HTML 불러오기를 다룬다.
// AI 호출만 스텁으로 두고 실제 파일을 실행한다. DOM이 필요한 동작(print, DOMParser, 파일 선택)은 여기서 다루지 않는다.
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
    'import-stream.js', 'gyosuan-io.js'
];
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const SVG = 'data:image/svg+xml;base64,PHN2Zz4=';

function makeContext(options = {}) {
    const stored = { ...(options.storage || {}) };
    const elements = {};
    const channels = [];
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, URL, encodeURIComponent, Blob, TextDecoder,
        isBackupTooBig: err => err instanceof RangeError,
        LESSON_TABS: ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment'].map(id => ({ id })),
        TEXT_MODEL: 'claude-opus-5-5',
        CONTEXT_CORE: { personas: { instructor: '당신은 게임 기획 전문 강사입니다.' } },
        INSTRUCTOR_TONE_PRESETS: [{ id: 'formal', label: '합쇼체' }],
        instructorTone: 'formal',
        getReferenceContext: () => '',
        stripInstructorCallouts: text => text,
        courseData: [],
        globalState: { subjects: [{ id: 's1', title: '게임 기획 입문' }], courseTitle: '과정' },
        currentSubjectId: 's1', currentEditingModuleId: 'm1',
        apiKey: 'k', claudeApiKey: '', isClaudeModel: () => true,
        extractText: data => data.candidates[0].content.parts[0].text,
        escapeHtml: text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
        localStorage: { getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = String(value); } },
        document: {
            addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
            getElementById: id => elements[id] || null, createElement: () => ({ appendChild() {} })
        },
        BroadcastChannel: function () { channels.push(this); this.postMessage = message => { ctx.posted = message; }; },
        saveState: async () => { ctx.saved = (ctx.saved || 0) + 1; },
        renderEditor: () => {},
        generateImageAPI: options.generateImage || (async () => PNG),
        callGemini: options.callGemini || (async () => { throw new Error('호출되면 안 됨'); }),
        // 브라우저 기본 확인 창을 쓰면 실패한다. 앱의 확인 창(confirmAsync)은 options.confirm으로 답한다(함수면 묻는 동안 할 일까지)
        confirm: () => { throw new Error('브라우저 기본 확인 창을 쓰면 안 된다'); },
        confirmAsync: async (message, opts) => {
            ctx.asked.push({ message, opts });
            return typeof options.confirm === 'function' ? options.confirm(message, opts) : options.confirm ?? true;
        },
        asked: [],
        alerts: [],
        toasts: []
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = message => ctx.toasts.push(message);
    ctx.elements = elements;
    ctx.channels = channels;
    ctx.stored = stored;
    vm.createContext(ctx);
    loadLessonTracks(ctx); // 갈래(기본학습·심화학습) 정의
    FILES.forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), ctx));
    return ctx;
}

const plain = value => JSON.parse(JSON.stringify(value));
const call = (ctx, name) => vm.runInContext(name, ctx);

async function run(name, fn) {
    await fn();
    console.log('PASS', name);
}

const DOC = `---
교과목: 게임 기획 입문
주제: 재미
소요: 2시수(약 120분)
date: 2026-11-02
status: 초안(AI 생성)
---

# 교수안 - 재미

## 학습 목표

- 재미 요소를 설명할 수 있다.
- 간단한 기획 메모를 작성할 수 있다.

## 개요

| 항목 | 내용 |
|---|---|
| 교과목 | 게임 기획 입문 |
| 주제 | 재미 |
| 소요 | 2시수(약 120분) |
| 대상 | 완전 초보 |
| 교보제 | 교재 슬라이드 |

이 차시는 재미의 구조를 다룬다.

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
**학생 활동**: 좋아하는 게임을 말한다.

### 전개 1 - 재미 분석

**설명 내용**: MDA를 설명한다.
**학생 활동**: 게임의 재미 요소를 고른다.

### 전개 2 - 활동: 기획 메모 실습

**설명 내용**: 메모 양식을 안내한다.
**학생 활동**: 기획 메모를 쓴다.

### 정리 - 오늘 배운 것 묶기

**설명 내용**: 핵심을 묶는다.

## 평가·체크포인트

- MDA를 설명했는가

## 강사 유의사항

- 용어 암기를 강요하지 않는다.
`;

const DECK = `---
교과목: 게임 기획 입문
주제: 재미
---

# 슬라이드 편성안 - 재미

## 슬라이드 편성

### 슬라이드 1 - 표지
- 대응 교수안: -
- 슬라이드 문구:
  - (제목) 재미
- 이미지/시각: 강의 주제를 상징하는 대표 일러스트

### 슬라이드 2 - 목차
- 대응 교수안: -
- 슬라이드 문구:
  - 오늘의 여정
  - 1. 재미 분석
- 이미지/시각: 단계를 잇는 흐름 그래픽

### 슬라이드 3 - 재미의 세 층
- 대응 교수안: 전개 1
- 슬라이드 문구:
  - 메카닉은 규칙입니다
  - 다이내믹은 진행입니다
  - 미학은 감정입니다
  - 세 층을 함께 보면 어떤 규칙이 어떤 감정을 만드는지 알 수 있습니다
- 이미지/시각: 세 층으로 쌓인 피라미드
- 핵심 메시지: 재미는 설계된다.

### 슬라이드 4 - 기획 메모 쓰는 법
- 대응 교수안: 전개 2
- 슬라이드 문구:
  - 목표를 적습니다
  - 규칙을 적습니다
  - 예상 재미를 적습니다
  - 쓴 메모는 친구와 바꿔 읽고 고칠 점을 서로 한 줄씩 적어 줍니다
- 이미지/시각: 메모지를 쓰는 손
- 핵심 메시지: 메모가 기획의 시작이다.

### 슬라이드 5 - 메모 돌려 읽기
- 대응 교수안: 전개 2
- 슬라이드 문구:
  - 서로 읽고 한 줄씩 평합니다
  - 고칠 점을 표시합니다
  - 다시 씁니다
  - 처음 쓴 메모와 고쳐 쓴 메모를 짝과 나란히 놓고 비교합니다
- 이미지/시각: 메모를 주고받는 두 사람
- 핵심 메시지: 읽히는 메모가 좋은 메모다.

### 슬라이드 6 - 마무리
- 대응 교수안: 정리
- 슬라이드 문구:
  - (큰 문구) 오늘의 한 걸음
- 이미지/시각: 다음 단계로 나아가는 장면
- 핵심 메시지: 배운 것을 정리하고 이어 간다.

## 비고

- 초안입니다.
`;

const lesson = (gyosuan = { docMd: DOC, deckMd: DECK }) => ({
    id: 'm1', title: '재미', hours: 2, gyosuan,
    tabContents: {
        basicLearn: '# 재미\n\n## 재미 분석\n\n재미의 구조를 다룹니다.',
        basicPrac: '## ✅ 학습 후 체크리스트\n\n- MDA 세 층을 설명합니다. (다시 보기: 재미 분석)\n- 기획 메모를 씁니다. (다시 보기: 실습)\n\n## 다음\n\n- 제외',
        assessment: '### 문제 1. 재미\n\n### 문제 2. 메모\n'
    }
});

function withLesson(mod, options) {
    const ctx = makeContext(options);
    ctx.getEditingModule = () => mod;
    return ctx;
}

const META = `부제: 재미
[학습목표]
- 재미 요소를 설명할 수 있다.
[개요]
재미를 다룬다.
[수업흐름]
단계 | 시간 | 핵심
도입 | 10분 | 재미란
[준비물]
- 빔프로젝터
[산출물]
- 메모
[평가]
- 설명했는가
[유의사항]
- 강요하지 않는다.`;
const SECTION = '@@GYOSUAN@@\n**강사 활동**: 띄운다.\n**학생 활동**: 고른다.\n@@SLIDES@@\n### 슬라이드 - 재미\n- 슬라이드 문구:\n  - 규칙\n- 이미지/시각: 도식\n- 핵심 메시지: 설계된다.';
const OPEN_CLOSE = '@@INTRO@@\n제목: 열기\n**설명 내용**: 연다.\n@@CLOSE@@\n제목: 닫기\n**설명 내용**: 닫는다.';
const reply = text => ({ candidates: [{ content: { parts: [{ text }] } }] });

function responder(calls) {
    return async (model, payload) => {
        const prompt = payload.contents.at(-1).parts[0].text;
        calls.push(payload);
        if (prompt.includes('@@INTRO@@')) return reply(OPEN_CLOSE);
        return reply(prompt.includes('@@GYOSUAN@@') ? SECTION : META);
    };
}

const draftLesson = () => ({ id: 'm1', title: '재미', hours: 1, tabContents: { basicLearn: '## 재미 분석\n\n충분히 긴 본문 문장이 여기에 들어갑니다. 재미의 구조를 설명합니다.' } });

(async () => {
    await run('슬라이드 형식: 기본은 프레젠테이션용', async () => {
        const calls = [];
        const ctx = withLesson(draftLesson(), { callGemini: responder(calls) });
        await ctx.generateGyosuan('m1');
        const section = calls.find(payload => payload.contents.at(-1).parts[0].text.includes('@@GYOSUAN@@'));
        assert.ok(section.contents.at(-1).parts[0].text.includes('발표 슬라이드 1~2장'));
        assert.ok(section.systemInstruction.parts[0].text.includes('화면에 띄울 짧은 말만'));
        assert.ok(section.contents[1].parts[0].text.includes("'코칭'에 가깝습니다"), '발표용 few-shot');
    });

    await run('슬라이드 형식: 상세 교재형은 프롬프트와 few-shot을 함께 바꾼다', async () => {
        const calls = [];
        const mod = draftLesson();
        const ctx = withLesson(mod, { callGemini: responder(calls) });
        ctx.setGyosuanSlideStyle('detailed');
        assert.strictEqual(ctx.stored['kb-slide-style'], 'detailed', '원본과 같은 저장 키');
        await ctx.generateGyosuan('m1');
        const section = calls.find(payload => payload.contents.at(-1).parts[0].text.includes('@@GYOSUAN@@'));
        const prompt = section.contents.at(-1).parts[0].text;
        assert.ok(prompt.includes('교재형 슬라이드 2~4장') && prompt.includes('개념을 설명하는 완결된 문장'));
        assert.ok(!prompt.includes('화면에 띄울 짧은 문구'));
        assert.ok(section.systemInstruction.parts[0].text.includes('슬라이드만 읽어도 이해되도록'));
        assert.ok(!section.systemInstruction.parts[0].text.includes('화면에 띄울 짧은 말만'), '두 형식의 규칙이 충돌하지 않는다');
        assert.ok(section.contents[1].parts[0].text.includes('완결') === false && section.contents[1].parts[0].text.includes('훈련은 교수자가 정한'), '교재형 few-shot');
        assert.strictEqual(mod.gyosuan.slideStyle, 'detailed');
    });

    await run('편성안 수정: 저장해도 화면 편집은 남기고 다시 만들기를 안내', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, deckHtml: '<section class="slide">편집</section>', deckRev: 3, sourceKey: 'k' });
        const ctx = withLesson(mod);
        ctx.toggleGyosuanEdit('deckMd');
        ctx.elements['gyosuan-raw'] = { value: `${DECK}\n` };
        await ctx.saveGyosuanRaw();
        assert.strictEqual(mod.gyosuan.deckMd, `${DECK}\n`);
        assert.strictEqual(mod.gyosuan.docMd, DOC, '교수안은 그대로');
        assert.strictEqual(mod.gyosuan.deckDirty, true);
        assert.ok(mod.gyosuan.deckHtml.includes('편집'));
        assert.ok(call(ctx, 'gyosuanToolbarHtml')(mod).includes('슬라이드 다시 만들기'));
        assert.ok(call(ctx, 'gyosuanNoteText')(mod).includes('편성안이 바뀌었습니다'));
        const saved = ctx.saved;
        await ctx.saveGyosuanRaw();
        assert.strictEqual(ctx.saved, saved, '바뀐 것이 없으면 저장하지 않는다');
    });

    await run('교수안 원문 칸: 넣지 않은 글이 있는지 알려 준다(Ctrl+S 결과·창 닫기 경고)', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, sourceKey: 'k' });
        const ctx = withLesson(mod);
        assert.strictEqual(ctx.hasPendingGyosuanRaw(), false, '칸이 없으면 없음');
        ctx.toggleGyosuanEdit('docMd');
        ctx.elements['gyosuan-raw'] = { value: DOC };
        assert.strictEqual(ctx.hasPendingGyosuanRaw(), false, '같은 글');
        ctx.elements['gyosuan-raw'].value = `${DOC}\n추가`;
        assert.strictEqual(ctx.hasPendingGyosuanRaw(), true);
        await ctx.saveGyosuanRaw();
        assert.strictEqual(ctx.hasPendingGyosuanRaw(), false);
        assert.strictEqual(mod.gyosuan.docMd, `${DOC}\n추가`);
        const noDeck = lesson({ docMd: DOC, sourceKey: 'k' });
        const ctx2 = withLesson(noDeck);
        ctx2.toggleGyosuanEdit('deckMd');
        ctx2.elements['gyosuan-raw'] = { value: '' };
        assert.strictEqual(ctx2.hasPendingGyosuanRaw(), false, '빈 칸과 없는 편성안은 같은 글로 본다');
        await ctx2.saveGyosuanRaw();
        assert.strictEqual(ctx2.saved, undefined, '빈 칸과 없는 편성안은 같은 글로 본다(저장하지 않는다)');
        assert.strictEqual(noDeck.gyosuan.deckMd, undefined);
    });

    await run('편성안 수정: 차시 덱만 고쳐 둔 경우에도 다시 만들기를 안내', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, sessionDecks: { 1: '<y>' }, sourceKey: 'k' });
        const ctx = withLesson(mod);
        ctx.toggleGyosuanEdit('deckMd');
        ctx.elements['gyosuan-raw'] = { value: `${DECK}\n` };
        await ctx.saveGyosuanRaw();
        assert.strictEqual(mod.gyosuan.deckDirty, true);
    });

    await run('슬라이드 다시 만들기: 편성안 기준으로 덱을 비우고 번호를 올린다', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, deckHtml: '<x>', sessionDecks: { 0: '<y>' }, deckRev: 3, deckDirty: true });
        const ctx = withLesson(mod);
        ctx.generateSlideView = async () => { ctx.opened = true; };
        await ctx.rebuildGyosuanDeck('m1');
        assert.strictEqual(mod.gyosuan.deckHtml, null);
        assert.deepStrictEqual(plain(mod.gyosuan.sessionDecks), {});
        assert.strictEqual(mod.gyosuan.deckRev, 4);
        assert.strictEqual(mod.gyosuan.deckDirty, false);
        assert.strictEqual(ctx.opened, true);
    });

    await run('슬라이드 다시 만들기: 취소하거나 슬라이드가 없으면 그대로', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, deckHtml: '<x>', deckRev: 1 });
        await withLesson(mod, { confirm: false }).rebuildGyosuanDeck('m1');
        assert.strictEqual(mod.gyosuan.deckHtml, '<x>');
        const empty = lesson({ docMd: DOC, deckMd: '', deckHtml: '<x>', deckRev: 1 });
        const ctx = withLesson(empty);
        await ctx.rebuildGyosuanDeck('m1');
        assert.strictEqual(empty.gyosuan.deckHtml, '<x>');
        assert.ok(ctx.alerts[0].includes('슬라이드를 찾지 못했습니다'));
    });

    await run('슬라이드 다시 만들기: 앱의 확인 창으로 묻고, 묻는 동안 다른 교과로 옮기면(같은 번호의 다른 차시) 만들지 않는다', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, deckHtml: '<x>', deckRev: 1 });
        const ctx = withLesson(mod, { confirm: () => { ctx.getEditingModule = () => lesson(); return true; } });
        ctx.generateSlideView = async () => { ctx.opened = true; };
        await ctx.rebuildGyosuanDeck('m1');
        assert.deepStrictEqual(plain(ctx.asked.map(ask => [ask.opts.title, ask.opts.okLabel, ask.opts.tone])), [['기본학습 슬라이드 다시 만들기', '다시 만들기', 'danger']]);
        assert.deepStrictEqual([mod.gyosuan.deckHtml, mod.gyosuan.deckRev, ctx.opened], ['<x>', 1, undefined], '덱을 비우지도 스튜디오를 열지도 않는다');
        assert.ok(ctx.toasts.at(-1).includes('차시가 바뀌어'), ctx.toasts.at(-1));
    });

    await run('교수안·슬라이드 재생성: 앱의 확인 창으로 묻고, 취소하거나 묻는 동안 차시가 바뀌면 만들지 않는다', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, sourceKey: 'k' });
        const made = [];
        const answers = [false, true, true];
        const ctx = withLesson(mod, { confirm: () => {
            const answer = answers.shift();
            if (!answers.length) ctx.getEditingModule = () => lesson(); // 마지막 물음 동안 다른 교과의 같은 번호 차시로 옮겼다
            return answer;
        } });
        ctx.generateGyosuan = async (id, opts) => { made.push([id, opts?.keepDoc || false]); return true; };
        ctx.generateSlideView = async () => {};
        await ctx.regenerateGyosuan('m1');
        assert.deepStrictEqual(made, [], '취소하면 만들지 않는다');
        await ctx.regenerateSlideView('m1');
        assert.deepStrictEqual(made, [['m1', true]], '확인하면 편성안만 다시 만든다');
        await ctx.regenerateGyosuan('m1');
        assert.deepStrictEqual(made, [['m1', true]], '묻는 동안 차시가 바뀌면 만들지 않는다');
        assert.ok(ctx.toasts.at(-1).includes('차시가 바뀌어'));
        assert.deepStrictEqual(plain(ctx.asked.map(ask => [ask.opts.title, ask.opts.okLabel, ask.opts.tone])),
            [['기본학습 교수안 다시 생성', '다시 생성', 'danger'], ['기본학습 슬라이드 다시 생성', '다시 생성', 'danger'], ['기본학습 교수안 다시 생성', '다시 생성', 'danger']]);
    });

    await run('스튜디오 저장: 다시 만든 뒤 도착한 이전 덱의 저장은 버린다', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, deckHtml: '<새 덱>', deckRev: 2 });
        const ctx = withLesson(mod);
        assert.strictEqual(ctx.saveSlideStudioHtml('m1', '<낡은 덱>', { rev: 1, session: null }), false);
        assert.strictEqual(mod.gyosuan.deckHtml, '<새 덱>');
        assert.strictEqual(ctx.saveSlideStudioHtml('m1', '<편집>', { rev: 2, session: null }), true);
        assert.strictEqual(mod.gyosuan.deckHtml, '<편집>');
        assert.strictEqual(ctx.saveSlideStudioHtml('m1', '<1차시>', { rev: 2, session: 1 }), true);
        assert.strictEqual(mod.gyosuan.deckHtml, '<편집>', '차시 덱 저장은 전체 덱을 건드리지 않는다');
        assert.strictEqual(mod.gyosuan.sessionDecks[1], '<1차시>');
    });

    await run('스튜디오 payload: 차시를 고르면 그 차시 덱과 저장본을 준다', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, deckHtml: '<전체>', sessionDecks: { 1: '<2차시>' }, deckRev: 5 });
        const ctx = withLesson(mod);
        const whole = ctx.getSlideStudioPayload('m1');
        assert.strictEqual(whole.session, null);
        assert.strictEqual(whole.deckHtml, '<전체>');
        assert.strictEqual(whole.sessions.length, 2);
        assert.strictEqual(whole.rev, 5);
        const second = ctx.getSlideStudioPayload('m1', 1);
        assert.strictEqual(second.session, 1);
        assert.strictEqual(second.deckHtml, '<2차시>');
        assert.ok(second.deckMd.includes('주제: 2차시. 재미 (2/2)'));
        assert.ok(second.docMd.includes('# 2차시. 재미 (2/2)'));
        assert.strictEqual(ctx.getSlideStudioPayload('m1', 9).session, null, '없는 차시는 전체 덱');
        assert.strictEqual(ctx.getSlideStudioPayload('m1', NaN).session, null);
    });

    await run('차시별 교수안: 목표·개요·흐름·평가·유의사항을 차시마다 갖춘다', async () => {
        const ctx = makeContext();
        const md = call(ctx, 'gyosuanSessionsMd')(lesson());
        assert.ok(md.startsWith('---\n교과목: 게임 기획 입문'));
        const first = md.slice(md.indexOf('# 1차시.'), md.indexOf('# 2차시.'));
        const second = md.slice(md.indexOf('# 2차시.'));
        [first, second].forEach(block => {
            ['## 학습 목표', '- 재미 요소를 설명할 수 있다.', '## 개요', '| 대상 | 완전 초보 |', '## 수업 흐름 한눈에 보기', '**합계**', '## 진행', '## 평가·체크포인트', '## 강사 유의사항', '- 용어 암기를 강요하지 않는다.']
                .forEach(text => assert.ok(block.includes(text), text));
            assert.ok(!block.includes('| 소요 |'), '소요는 차시 시간으로 바꾼다');
        });
        assert.ok(first.includes('| 차시 | 1 / 2차시 (약 1시간) |'));
        assert.ok(first.includes('| 다루는 내용 | 재미 분석 · 활동: 기획 메모 실습 |'), first.slice(0, 600));
        assert.ok(first.includes('- 학생 활동 확인: 게임의 재미 요소를 고른다.'));
        assert.ok(first.includes('체크리스트는 수업을 마치는 차시에 확인한다.'));
        assert.ok(second.includes('- MDA를 설명했는가'), '교수안의 평가는 마지막 차시에');
        assert.ok(second.includes('학습 후 체크리스트 2항목, 문제은행 2문항으로 학습 목표 도달을 확인한다.'));
        assert.ok(first.includes('*남은 활동은 다음 차시에 이어서 진행한다.*'));
        assert.ok(second.includes('*앞 차시에서 시작한 활동을 이어서 진행한다.*'));
        assert.ok(second.includes('**설명 내용**: 메모 양식을 안내한다.'), '이어지는 단계도 지침을 싣는다');
        assert.ok(second.includes('**설명 내용**: 이번 차시 흐름 - '), '연결 도입에도 설명 내용을 넣는다');
        assert.ok(second.includes("'(이어서)'·'(다음 차시에 계속)'"));
        assert.ok(second.includes('가장 긴 전개 단계에서 시간을 덜었다'));
    });

    await run('차시별 편성안: 차시마다 표지·목차·목표·체크리스트·마무리', async () => {
        const ctx = makeContext();
        const parse = md => ctx.KBuilder.parseDeck(md);
        const mod = lesson();
        const first = parse(call(ctx, 'gyosuanSessionDeckMd')(mod, 0));
        const second = parse(call(ctx, 'gyosuanSessionDeckMd')(mod, 1));
        assert.strictEqual(first.meta['주제'], '1차시. 재미 (1/2)');
        assert.strictEqual(first.meta['차시'], '1/2');
        [first, second].forEach(deck => {
            deck.slides.forEach((slide, index) => assert.strictEqual(slide.num, String(index + 1), '번호를 1번부터 다시 매긴다'));
            assert.strictEqual(deck.slides[0].kind, 'cover');
            assert.strictEqual(deck.slides[1].kind, 'toc');
            assert.ok(deck.slides[2].title.startsWith('학습목표:'));
            assert.strictEqual(deck.slides.at(-1).kind, 'closing');
            assert.ok(deck.slides.at(-2).title.startsWith('체크리스트:'));
            assert.strictEqual(deck.slides.filter(slide => slide.kind === 'cover').length, 1, '원래 표지는 다시 싣지 않는다');
            assert.strictEqual(deck.slides.filter(slide => slide.title === '마무리').length, 1, '원래 마무리는 다시 싣지 않는다');
        });
        assert.ok(first.slides[0].lines.some(line => line.text === '(하단) 1차시 / 2차시 · 1시간'));
        assert.ok(first.slides[1].lines.some(line => line.text.startsWith('도입. ')), '목차는 이번 차시 흐름');
        assert.ok(first.slides.at(-1).lines.some(line => line.text === '다음 차시: 재미'));
        assert.ok(second.slides.at(-1).lines.some(line => line.text.includes('스스로 확인합니다')));
        assert.ok(first.slides.at(-2).lines.some(line => line.text === '□ 재미 분석'), '중간 차시 체크리스트는 다룬 내용');
        assert.deepStrictEqual(plain(second.slides.at(-2).lines.map(line => line.text)), ['□ MDA 세 층을 설명합니다.', '□ 기획 메모를 씁니다.'], '마지막 차시는 교안 체크리스트');
    });

    await run('차시별 편성안: 걸친 단계의 슬라이드는 시간 비율로 나눈다', async () => {
        const ctx = makeContext();
        const mod = lesson();
        const titles = index => ctx.KBuilder.parseDeck(call(ctx, 'gyosuanSessionDeckMd')(mod, index)).slides.map(slide => slide.title);
        assert.ok(titles(0).includes('재미의 세 층'));
        assert.ok(!titles(0).includes('기획 메모 쓰는 법'), '전개 2는 60분 중 10분만 1차시에 있다');
        assert.ok(titles(1).includes('기획 메모 쓰는 법') && titles(1).includes('메모 돌려 읽기'));
        assert.deepStrictEqual(plain(call(ctx, 'shareSlides')([{}, {}], [0, 0])), [0, 0], '대응 단계가 없으면 첫 차시');
        assert.deepStrictEqual(plain(call(ctx, 'shareSlides')([{}, {}, {}, {}], [30, 30])), [0, 0, 1, 1]);
        const unmapped = { ...lesson(), gyosuan: { docMd: DOC, deckMd: DECK.replace('대응 교수안: 전개 1', '대응 교수안: 전개 9') } };
        assert.ok(ctx.KBuilder.parseDeck(call(ctx, 'gyosuanSessionDeckMd')(unmapped, 0)).slides.some(slide => slide.title === '재미의 세 층'), '대응 단계를 찾지 못해도 슬라이드를 버리지 않는다');
    });

    await run('차시 산출물: 문서 주제를 제목으로 쓴다', async () => {
        const ctx = makeContext();
        const renamed = { ...lesson(), title: '차시 이름이 다름' };
        const list = plain(call(ctx, 'gyosuanSessionList')(renamed));
        assert.strictEqual(list[0].title, '재미 (1/2)', '완성 MD는 차시 이름과 주제가 다를 수 있다');
        assert.ok(call(ctx, 'gyosuanSessionsMd')(renamed).includes('# 차시별 교수안 - 재미'));
    });

    await run('차시별 편성안: 대응 교수안을 차시 교수안 번호로 바꾼다', async () => {
        const ctx = makeContext();
        const deck = ctx.KBuilder.parseDeck(call(ctx, 'gyosuanSessionDeckMd')(lesson(), 1));
        assert.strictEqual(deck.slides.find(slide => slide.title === '메모 돌려 읽기').maps, '전개 1', '2차시 교수안에서는 첫 전개다');
    });

    await run('참고 이미지: 래스터 data URL만 받고 24장까지', async () => {
        const K = makeContext().KBuilder;
        assert.strictEqual(K.isRasterImage(PNG), true);
        assert.strictEqual(K.isRasterImage('data:image/webp;base64,AAAA'), true);
        assert.strictEqual(K.isRasterImage(SVG), false, '내보내기 정규식이 svg+xml을 읽지 못한다');
        assert.strictEqual(K.isRasterImage('https://example.com/a.png'), false);
        assert.strictEqual(K.isRasterImage(null), false);
        const refs = plain(K.normalizeRefImages([{ name: 'a', url: PNG }, { name: 'b', url: SVG }, null, { url: PNG }]));
        assert.deepStrictEqual(refs, [{ name: 'a', url: PNG }, { name: '이미지 2', url: PNG }]);
        assert.strictEqual(K.normalizeRefImages(Array.from({ length: 30 }, () => ({ name: 'x', url: PNG }))).length, 24);
        assert.deepStrictEqual(plain(K.normalizeRefImages('없음')), []);
    });

    await run('참고 이미지: 교수안 문서에 싣고 이름은 이스케이프한다', async () => {
        const ctx = makeContext();
        const attack = '<img src=x onerror=alert(1)>';
        const mod = { ...lesson(), refImages: [{ name: attack, url: PNG }] };
        const tray = call(ctx, 'gyosuanRefTrayHtml')(mod);
        assert.ok(!tray.includes(attack));
        assert.ok(tray.includes('&lt;img src=x onerror=alert(1)&gt;'));
        assert.ok(tray.includes("removeGyosuanRef('m1', 0)"));
        const mount = { querySelector: () => null, querySelectorAll: () => [] };
        ctx.KBuilder.buildDoc(ctx.KBuilder.parseDoc(DOC), mount, { refs: mod.refImages });
        assert.ok(mount.innerHTML.includes('참고 이미지') && mount.innerHTML.includes(PNG));
        assert.ok(!mount.innerHTML.includes(attack));
        ctx.KBuilder.buildDoc(ctx.KBuilder.parseDoc(DOC), mount);
        assert.ok(!mount.innerHTML.includes('doc-refs'), '없으면 갤러리도 없다');
    });

    await run('참고 이미지: 제거', async () => {
        const mod = { ...lesson(), refImages: [{ name: 'a', url: PNG }, { name: 'b', url: PNG }] };
        const ctx = withLesson(mod);
        await ctx.removeGyosuanRef('m1', 0);
        assert.deepStrictEqual(plain(mod.refImages).map(ref => ref.name), ['b']);
        assert.strictEqual(ctx.saved, 1);
    });

    await run('이미지 local 참조: 문서·덱에서 data URL로 풀고 모르는 참조는 뺀다', async () => {
        const ctx = makeContext();
        const resolve = call(ctx, 'resolveGyosuanImages');
        const mod = { images: { lesson1: PNG }, gyosuan: { images: { made1: PNG } } };
        assert.strictEqual(resolve('![a](local:made1) ![b](local:lesson1)', mod), `![a](${PNG}) ![b](${PNG})`);
        assert.strictEqual(resolve('앞 ![a](local:none) 뒤', mod), '앞  뒤');
        assert.strictEqual(resolve('앞 ![r](local:gone) 뒤', { images: { gone: 'teacher-image:' + 'a'.repeat(18) } }), '앞  뒤', '폴더에서 찾지 못한 그림(참조)도 줄에서 뺀다');
        assert.strictEqual(resolve(null, mod), '');
    });

    await run('이미지 자동 생성: 장수만큼 만들어 편성안·교수안·참고 이미지에 넣는다', async () => {
        const made = [];
        const mod = lesson(undefined);
        const ctx = withLesson(mod, { storage: { 'kb-auto-img': '2' }, generateImage: async prompt => { made.push(prompt); return PNG; } });
        const out = await ctx.attachGyosuanImages(mod, { docMd: DOC, deckMd: DECK });
        assert.strictEqual(made.length, 2, '설정한 장수');
        const ids = Object.keys(out.images);
        assert.strictEqual(ids.length, 2);
        ids.forEach(id => assert.strictEqual(out.images[id], PNG));
        assert.ok(!out.deckMd.includes('[이미지:'), '내보내기에 남지 않는 표시는 쓰지 않는다');
        assert.strictEqual((out.deckMd.match(/!\[\]\(local:/g) || []).length, 2);
        assert.ok(out.docMd.includes(`![](local:${ids[0]})`) || out.docMd.includes(`![](local:${ids[1]})`), '대응 단계 아래에도 넣는다');
        assert.strictEqual(mod.refImages.length, 2, '참고 이미지에서도 고를 수 있다');
        assert.ok(out.note.includes('이미지 2장'));
        const covers = ctx.KBuilder.parseDeck(out.deckMd).slides.filter(slide => slide.kind === 'cover' && /local:/.test(slide.visual));
        assert.strictEqual(covers.length, 0, '표지·목차·마무리에는 넣지 않는다');
    });

    await run('이미지 자동 생성: 끄면 호출하지 않는다', async () => {
        let called = 0;
        const mod = lesson(undefined);
        const ctx = withLesson(mod, { storage: { 'kb-auto-img': '0' }, generateImage: async () => { called++; return PNG; } });
        const texts = { docMd: DOC, deckMd: DECK };
        assert.strictEqual(await ctx.attachGyosuanImages(mod, texts), texts);
        assert.strictEqual(called, 0);
    });

    await run('이미지 자동 생성: 내용이 같은 교안 이미지는 새로 만들지 않는다', async () => {
        let called = 0;
        const mod = {
            ...lesson(undefined), images: { img_keep: PNG, img_orphan: PNG, img_svg: SVG },
            tabContents: { basicLearn: '## 재미의 세 층\n\n<div class="image-wrapper"><img src="local:img_keep" alt="재미의 세 층"></div>\n\n메카닉은 규칙입니다. 다이내믹은 진행입니다.\n\n![재미의 세 층](local:img_svg)\n' }
        };
        const ctx = withLesson(mod, { storage: { 'kb-auto-img': '1' }, generateImage: async () => { called++; return PNG; } });
        const candidates = plain(call(ctx, 'lessonImageCandidates')(mod));
        assert.deepStrictEqual(candidates.map(item => item.id), ['img_keep'], '본문에 없거나 SVG인 이미지는 후보가 아니다');
        assert.strictEqual(candidates[0].title, '재미의 세 층');
        const out = await ctx.attachGyosuanImages(mod, { docMd: '', deckMd: DECK });
        assert.strictEqual(called, 0);
        assert.ok(out.deckMd.includes('![](local:img_keep)'));
        assert.strictEqual(out.images.img_keep, PNG, '교안을 다시 생성해도 남도록 교수안 쪽에 복사한다');
        assert.strictEqual(mod.images.img_orphan, PNG, '교안 이미지는 그대로');
    });

    await run('이미지 자동 생성: 연달아 실패하면 멈추고 글은 살린다', async () => {
        let called = 0;
        const mod = lesson(undefined);
        const ctx = withLesson(mod, { storage: { 'kb-auto-img': '8' }, generateImage: async () => { called++; return null; } });
        const out = await ctx.attachGyosuanImages(mod, { docMd: DOC, deckMd: DECK });
        assert.strictEqual(called, 2, '두 번 연속 실패하면 멈춘다');
        assert.strictEqual(out.deckMd, DECK);
        assert.deepStrictEqual(plain(out.images), {});
    });

    await run('이미지 자동 생성: 래스터가 아닌 결과는 레슨 데이터에 넣지 않는다', async () => {
        const mod = lesson(undefined);
        const ctx = withLesson(mod, { storage: { 'kb-auto-img': '1' }, generateImage: async () => SVG });
        const out = await ctx.attachGyosuanImages(mod, { docMd: DOC, deckMd: DECK });
        assert.deepStrictEqual(plain(out.images), {});
        assert.ok(!out.deckMd.includes('[이미지:') && !out.deckMd.includes('local:'));
    });

    await run('이미지 자동 생성: 중지 신호는 교수안 이미지 단계에서만 넘기고, 그림 모델이 막히면 새 그림을 시작하지 않는다', async () => {
        const seen = [];
        const controller = new AbortController();
        const mod = lesson(undefined);
        const ctx = withLesson(mod, { storage: { 'kb-auto-img': '1' }, generateImage: async (prompt, opts) => { seen.push(opts?.signal ?? null); return PNG; } });
        ctx.aiStopSignal = () => controller.signal;
        const notedOk = [];
        ctx.noteSlideImagesLeft = count => notedOk.push(count);
        await ctx.attachGyosuanImages(mod, { docMd: DOC, deckMd: DECK });
        assert.ok(seen.length >= 1 && seen.every(signal => signal === controller.signal), '교수안 이미지 단계의 그림은 중지하면 끊는다');
        assert.deepStrictEqual(notedOk, [], '그림 모델이 막히지 않았으면 못 만든 슬라이드 그림으로 적지 않는다');
        const planned = seen.length; // 이 교수안에 넣을 슬라이드 그림 수
        await vm.runInContext('KBuilder.genImage', ctx)('그림');
        assert.strictEqual(seen.at(-1), null, '작업 밖의 슬라이드 칸 그림 만들기는 지난 중지 신호에 끊기지 않는다');

        let called = 0;
        const blockedMod = lesson(undefined);
        const blocked = withLesson(blockedMod, { storage: { 'kb-auto-img': '1' }, generateImage: async () => { called++; return PNG; } });
        blocked.imageGenerationBlocked = () => true;
        const noted = [];
        blocked.noteSlideImagesLeft = count => noted.push(count);
        const out = await blocked.attachGyosuanImages(blockedMod, { docMd: DOC, deckMd: DECK });
        assert.strictEqual(called, 0, '그림 모델이 모두 막혔으면 부르지 않는다');
        assert.deepStrictEqual(noted, [planned], '막혀 못 만든 슬라이드 그림 수를 작업 끝 안내에 넣는다(교안에는 자리가 남지 않는다)');
        assert.deepStrictEqual(plain(out.images), {});
        assert.strictEqual(out.deckMd, DECK, '글은 그대로');
        assert.ok(out.note.includes('건너뛰었습니다'), out.note);
    });

    await run('생성 흐름: 슬라이드만 재생성하면 교수안 이미지를 지키고 쓰지 않는 이미지는 지운다', async () => {
        const calls = [];
        const mod = { ...draftLesson(), gyosuan: { docMd: '![](local:keep)', deckMd: '옛', images: { keep: PNG, gone: PNG }, sourceKey: 'k', deckRev: 7 } };
        const ctx = withLesson(mod, { callGemini: responder(calls), storage: { 'kb-auto-img': '0' } });
        await ctx.generateGyosuan('m1', { keepDoc: true });
        assert.strictEqual(mod.gyosuan.docMd, '![](local:keep)');
        assert.deepStrictEqual(Object.keys(mod.gyosuan.images), ['keep']);
        assert.strictEqual(mod.gyosuan.deckRev, 8);
    });

    await run('완성 MD 변환: 내용으로 교수안과 편성안을 가른다', async () => {
        const ctx = makeContext();
        const sort = call(ctx, 'sortGyosuanFiles');
        const both = plain(sort([{ name: 'a.md', text: `﻿${DECK.replace(/\n/g, '\r\n')}` }, { name: 'b.md', text: DOC }]));
        assert.strictEqual(both.docMd, DOC);
        assert.ok(both.deckMd.startsWith('---\n') && !both.deckMd.includes('\r'), 'BOM·CRLF 정리');
        assert.ok(sort([{ name: 'a.md', text: DOC }, { name: 'b.md', text: DOC }]).error.includes('두 개'));
        assert.ok(sort([{ name: '메모.md', text: '그냥 글' }]).error.includes('메모.md'));
        assert.strictEqual(plain(sort([{ name: '교수안.md', text: '짧은 글' }])).docMd, '짧은 글', '내용으로 모르면 파일 이름을 본다');
        assert.ok(plain(sort([{ name: 'x.md', text: call(ctx, 'gyosuanSessionsMd')(lesson()) }])).docMd, '차시별 교수안의 ## 슬라이드 목록을 편성안으로 보지 않는다');
        const samples = ctx.KBuilder.samples;
        const sample = plain(sort([{ name: 'x.md', text: samples.doc }, { name: 'y.md', text: samples.deck }]));
        assert.ok(sample.docMd && sample.deckMd, '원본 샘플 형식');
    });

    await run('완성 MD 변환: AI 없이 만들고 올리지 않은 쪽은 유지한다', async () => {
        const ctx = makeContext();
        const convert = call(ctx, 'convertedGyosuan');
        const full = plain(convert(undefined, { docMd: DOC, deckMd: DECK }));
        assert.strictEqual(full.docMd, DOC);
        assert.strictEqual(full.deckMd, DECK);
        assert.strictEqual(full.sourceKey, null, '교안과 비교하지 않는다');
        assert.strictEqual(full.deckRev, 1);
        const base = { docMd: '옛 교수안', deckMd: '옛 편성안', deckHtml: '<x>', sourceKey: 'k', deckRev: 4 };
        const docOnly = plain(convert(base, { docMd: DOC }));
        assert.strictEqual(docOnly.deckMd, '옛 편성안');
        assert.strictEqual(docOnly.deckHtml, '<x>', '편성안을 안 올리면 슬라이드 편집을 남긴다');
        const deckOnly = plain(convert(base, { deckMd: DECK }));
        assert.strictEqual(deckOnly.docMd, '옛 교수안');
        assert.strictEqual(deckOnly.deckHtml, null);
        assert.strictEqual(deckOnly.deckRev, 5);
        assert.strictEqual(deckOnly.sourceKey, 'k');
        const view = call(ctx, 'gyosuanNoteText');
        assert.ok(view({ ...lesson(), gyosuan: full }).includes('불러온 교수안'));
    });

    await run('완성 MD 변환: 박힌 이미지는 레지스트리로 옮기고 SVG는 뺀다', async () => {
        const ctx = makeContext();
        const adopt = call(ctx, 'adoptInlineImages');
        const out = plain(adopt(`앞 ![그림](${PNG}) 뒤 ![도식](${SVG})`));
        const [id] = Object.keys(out.images);
        assert.strictEqual(out.md, `앞 ![그림](local:${id}) 뒤 도식`);
        assert.strictEqual(out.images[id], PNG);
        assert.strictEqual(Object.keys(plain(adopt(`![a](${PNG}) ![b](${PNG})`)).images).length, 1, '같은 그림은 하나로');
        const mod = { ...lesson(), gyosuan: { docMd: DOC, deckMd: `### 슬라이드 1 - 그림\n- 이미지/시각: 도식 ![그림](${PNG})\n` } };
        const converted = call(ctx, 'convertedGyosuan')(undefined, mod.gyosuan);
        const payload = withLesson({ ...lesson(), gyosuan: converted }).getSlideStudioPayload('m1');
        assert.ok(!converted.deckMd.includes('base64'));
        assert.strictEqual(ctx.KBuilder.parseDeck(payload.deckMd).slides[0].visual.includes(PNG), true, '스튜디오에는 그림으로 넘긴다');
    });

    await run('완성 MD 변환: 교수안만 있으면 슬라이드 생성이 교수안을 지운다고 가정하지 않는다', async () => {
        const calls = [];
        const mod = { ...draftLesson(), gyosuan: { docMd: DOC, deckMd: '', sourceKey: null } };
        const ctx = withLesson(mod, { callGemini: responder(calls), storage: { 'kb-auto-img': '0' } });
        await ctx.openSlideStudio('m1').catch(() => {});
        assert.strictEqual(mod.gyosuan.docMd, DOC);
        assert.ok(mod.gyosuan.deckMd.includes('슬라이드 편성안'));
    });

    await run('HTML 내보내기·불러오기: 내장 소스가 왕복한다', async () => {
        const ctx = makeContext();
        const K = ctx.KBuilder;
        const source = { doc: DOC, deck: `${DECK}</script><script>alert(1)</script>`, source: '', refs: [{ name: '그림', url: PNG }], session: null };
        K.getSource = () => source;
        const parsed = { meta: { 주제: '재미' }, slides: [{}, {}] };
        const html = K.standaloneDoc(parsed, '<section class="slide">가</section>', 'css', '', null, 7);
        assert.ok(html.includes('<span class="dc-tot">7</span>'), '슬라이드 수는 지금 화면 기준');
        const json = html.match(/<script type="application\/json" id="kb-source">([\s\S]*?)<\/script>/)[1];
        assert.ok(!json.includes('<'), '내장 소스가 script를 닫지 못한다');
        assert.deepStrictEqual(plain(K.readEmbeddedSource(json)), source);
    });

    await run('HTML 불러오기: 내장 소스는 외부 입력으로 다룬다', async () => {
        const K = makeContext().KBuilder;
        assert.strictEqual(K.readEmbeddedSource('깨진 JSON'), null);
        assert.strictEqual(K.readEmbeddedSource('[]'), null);
        assert.strictEqual(K.readEmbeddedSource('null'), null);
        const odd = plain(K.readEmbeddedSource(JSON.stringify({ doc: 1, deck: null, refs: [{ name: 'x', url: SVG }, { name: 'y', url: PNG }], session: '1' })));
        assert.deepStrictEqual(odd, { doc: '', deck: '', source: '', refs: [{ name: 'y', url: PNG }], session: null });
        assert.strictEqual(K.readEmbeddedSource(JSON.stringify({ session: 2 })).session, 2);
        assert.strictEqual(K.readEmbeddedSource(JSON.stringify({ session: -1 })).session, null);
    });

    await run('HTML 불러오기: 어느 덱으로 넣을지 정한다', async () => {
        const target = call(makeContext(), 'importTarget');
        const withSource = session => ({ source: { session } });
        assert.strictEqual(target(withSource(null), 1, 3).session, null, '전체 덱 파일은 전체 덱으로');
        assert.strictEqual(target(withSource(1), null, 3).session, 1, '차시 파일은 전체 화면에서 열어도 그 차시로');
        assert.strictEqual(target({ source: null }, 2, 3).session, 2, '소스가 없으면 지금 연 덱');
        assert.ok(target(withSource(5), null, 3).error.includes('6차시'));
    });

    await run('HTML 불러오기: 전체 덱은 MD와 번호를 함께, 차시 덱은 편집본만 바꾼다', async () => {
        const ctx = makeContext();
        const imported = call(ctx, 'importedGyosuan');
        const base = { docMd: '옛', deckMd: '옛덱', deckHtml: '<옛>', sessionDecks: { 0: '<a>' }, deckRev: 2, sourceKey: 'k' };
        const file = { html: '<section class="slide">새</section>', source: { doc: DOC, deck: `${DECK}\n![이미지](${PNG})`, session: null } };
        const whole = plain(imported(base, file, null));
        assert.strictEqual(whole.docMd, DOC);
        assert.ok(whole.deckMd.includes('local:img_') && !whole.deckMd.includes('base64'));
        assert.strictEqual(whole.deckHtml, file.html);
        assert.strictEqual(whole.deckRev, 3, '열려 있던 스튜디오의 저장을 막는다');
        assert.deepStrictEqual(whole.sessionDecks, {});
        assert.strictEqual(whole.sourceKey, null);
        const session = plain(imported(base, file, 1));
        assert.strictEqual(session.docMd, '옛');
        assert.strictEqual(session.deckHtml, '<옛>');
        assert.strictEqual(session.sessionDecks[1], file.html);
        assert.strictEqual(session.sessionDecks[0], '<a>');
        assert.strictEqual(session.deckRev, 2);
        const bare = plain(imported(base, { html: '<x>', source: null }, null));
        assert.strictEqual(bare.docMd, '옛', '소스가 없는 파일은 MD를 건드리지 않는다');
        assert.strictEqual(bare.sourceKey, 'k');
    });

    // 브라우저 File처럼 조각으로만 읽히는 가짜 파일. size를 주면 그만큼 크다고 알린다(뒤는 빈 조각)
    const sliceFile = (name, text, size) => {
        const bytes = Buffer.from(text, 'utf8');
        return {
            name, size: size ?? bytes.length, slices: 0,
            slice(from, to) { this.slices += 1; return { arrayBuffer: async () => bytes.subarray(Math.min(from, bytes.length), Math.min(to, bytes.length)) }; },
            text: async () => { throw new Error('file.text()를 부르면 안 됩니다'); }
        };
    };
    const BIG_PNG = `data:image/png;base64,${Buffer.from('BIG-PNG-'.repeat(300)).toString('base64')}`;

    await run('큰 파일: 64MB가 넘는 완성 MD도 조각으로 읽고(file.text()를 부르지 않는다) 박힌 그림까지 원래 글 그대로 돌려준다', async () => {
        const ctx = makeContext();
        const md = `## 진행\n\n![그림](${BIG_PNG})\n\n한글 끝`;
        const file = sliceFile('06_교수안.md', md, 100 * 1024 * 1024);
        assert.strictEqual(await call(ctx, 'readGyosuanFile')(file), md);
        assert.strictEqual(file.slices, 25, '4MB씩');
        const converted = call(ctx, 'convertedGyosuan')(undefined, call(ctx, 'sortGyosuanFiles')([{ name: file.name, text: md }]));
        assert.ok(converted.docMd.includes('local:img_') && Object.values(converted.images).includes(BIG_PNG), '박힌 그림은 그림 목록으로 옮긴다');
    });

    await run('큰 슬라이드 HTML: 그림을 떼어 둔 글로 읽고 슬라이드 HTML과 내장 원본(편성안·참고 이미지)에 그림을 되돌린다', async () => {
        const ctx = makeContext();
        const source = JSON.stringify({ doc: DOC, deck: `${DECK}\n![이미지](${BIG_PNG})`, source: '', refs: [{ name: '참고', url: BIG_PNG }], session: null });
        const html = `<div class="deck-stage-inner"><section class="slide"><img src="${BIG_PNG}"></section></div><script type="application/json" id="kb-source">${source}</script>`;
        const read = await ctx.readFileSkeleton(sliceFile('슬라이드.html', html));
        let seen = '';
        ctx.KBuilder.readExportedHtml = text => {
            seen = text;
            return { html: text.match(/<section class="slide">[\s\S]*?<\/section>/)[0], theme: 'maple', source: { doc: '', deck: '', source: '', refs: [], session: null } };
        };
        ctx.DOMParser = function () { this.parseFromString = text => ({ getElementById: () => ({ textContent: text.match(/id="kb-source">([\s\S]*?)<\/script>/)[1] }) }); };
        const imported = call(ctx, 'readExportedGyosuanHtml')(read);
        assert.ok(!seen.includes(BIG_PNG), '파서에는 그림을 뗀 글만 넘긴다');
        assert.strictEqual(imported.html, `<section class="slide"><img src="${BIG_PNG}"></section>`);
        assert.ok(imported.source.deck.includes(BIG_PNG) && imported.source.refs[0].url === BIG_PNG && imported.source.doc === DOC);
        const warned = [];
        ctx.console = { log() {}, warn: (...args) => warned.push(args), error: () => { throw new Error('오류로 남기면 안 됨'); } };
        ctx.KBuilder.readExportedHtml = () => { throw new Error('지원하지 않는 HTML입니다.'); };
        ctx.getEditingModule = () => ({ id: 'm1', title: '차시' });
        const result = await ctx.importGyosuanHtml('m1', read.text, null, read);
        assert.deepStrictEqual(plain(result), { ok: false, error: '지원하지 않는 HTML입니다.' });
        assert.strictEqual(warned.length, 1, '일부러 받지 않는 파일은 경고로만');
    });

    await run('내보낸 HTML 불러오기: 지금 슬라이드를 바꾸기 전에 앱의 확인 창으로 묻고, 취소하거나 묻는 동안 차시가 바뀌면 아무것도 바꾸지 않는다', async () => {
        const answers = [false, 'moved', true];
        const mod = lesson({ docMd: DOC, deckMd: DECK, deckHtml: '<옛 덱>', deckRev: 2 });
        const ctx = withLesson(mod, { confirm: () => {
            const answer = answers.shift();
            if (answer === 'moved') ctx.getEditingModule = () => lesson(); // 묻는 동안 다른 교과의 같은 번호 차시로 옮겼다
            return !!answer;
        } });
        ctx.KBuilder.readExportedHtml = () => ({ html: '<새 덱>', theme: 'maple', source: null });
        const before = plain(mod.gyosuan);
        assert.deepStrictEqual(plain(await ctx.importGyosuanHtml('m1', '<html>')), { ok: false }, '취소');
        assert.deepStrictEqual(plain(mod.gyosuan), before);
        assert.deepStrictEqual(plain(await ctx.importGyosuanHtml('m1', '<html>')), { ok: false }, '묻는 동안 차시가 바뀜');
        assert.deepStrictEqual(plain(mod.gyosuan), before);
        assert.ok(ctx.toasts.at(-1).includes('차시가 바뀌어'));
        ctx.getEditingModule = () => mod;
        assert.deepStrictEqual(plain(await ctx.importGyosuanHtml('m1', '<html>')), { ok: true });
        assert.strictEqual(mod.gyosuan.deckHtml, '<새 덱>');
        assert.deepStrictEqual(plain(ctx.asked[0].opts), { title: '기본학습 슬라이드 바꾸기', okLabel: '바꾸기', tone: 'danger' });
    });

    await run('완성 MD 불러오기: 있던 교수안을 바꾸기 전에 앱의 확인 창으로 묻고, 취소하거나 묻는 동안 차시가 바뀌면 그대로 둔다', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, sourceKey: 'k' });
        const answers = [false, 'moved'];
        const ctx = withLesson(mod, { confirm: () => {
            const answer = answers.shift();
            if (answer === 'moved') ctx.getEditingModule = () => lesson();
            return !!answer;
        } });
        vm.runInContext("pickGyosuanFiles = async () => [{ name: '06_교수안.md' }]; readGyosuanFile = async () => '## 진행\\n\\n### 도입 - 새 교수안';", ctx);
        await ctx.importGyosuanMdFiles('m1');
        assert.strictEqual(mod.gyosuan.docMd, DOC, '취소하면 바꾸지 않는다');
        await ctx.importGyosuanMdFiles('m1');
        assert.strictEqual(mod.gyosuan.docMd, DOC, '묻는 동안 차시가 바뀌면 바꾸지 않는다');
        assert.deepStrictEqual(plain(ctx.asked.map(ask => ask.opts)), [{ title: '기본학습 교수안 바꾸기', okLabel: '바꾸기', tone: 'danger' }, { title: '기본학습 교수안 바꾸기', okLabel: '바꾸기', tone: 'danger' }]);
        assert.strictEqual(ctx.saved, undefined, '저장하지 않는다');
    });

    await run('화면 편집만 있는 덱도 슬라이드로 친다', async () => {
        const ctx = makeContext();
        const has = call(ctx, 'gyosuanHasDeck');
        assert.strictEqual(has({ gyosuan: { deckMd: '', deckHtml: '<x>' } }), true);
        assert.strictEqual(has({ gyosuan: { deckMd: 'd' } }), true);
        assert.strictEqual(has({ gyosuan: {} }), false);
        assert.strictEqual(has(null), false);
    });

    await run('다른 탭 변경: 알리고 덮어쓰기 전에 묻는다', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, sourceKey: 'k' });
        const ctx = withLesson(mod, { confirm: false });
        ctx.announceGyosuanChange('m1');
        assert.deepStrictEqual(plain(ctx.posted), { moduleId: 'm1' });
        ctx.channels[0].onmessage({ data: { moduleId: 'm1' } });
        assert.ok(ctx.toasts[0].includes('다른 탭'));
        assert.ok(call(ctx, 'gyosuanNoteText')(mod).includes('다른 탭'));
        ctx.toggleGyosuanEdit('deckMd');
        ctx.elements['gyosuan-raw'] = { value: '바꾼 편성안' };
        await ctx.saveGyosuanRaw();
        assert.strictEqual(mod.gyosuan.deckMd, DECK, '취소하면 저장하지 않는다');
        ctx.channels[0].onmessage({ data: { moduleId: 'other' } });
        assert.strictEqual(call(ctx, 'isGyosuanForeignChanged')(mod), false, '다른 차시 변경은 묻지 않는다');
        assert.deepStrictEqual(plain(ctx.asked.map(ask => [ask.opts.title, ask.opts.okLabel, ask.opts.tone])), [['다른 탭에서 고친 차시', '덮어쓰기', 'danger']], '앱의 확인 창으로 묻는다');
    });

    await run('다른 탭 변경: 묻는 동안 다시 저장해도(칸을 벗어남·Ctrl+S) 한 번만 묻고, 그사이 온 다른 차시의 알림은 남기며, 쓰던 원문 칸을 다시 그리지 않는다', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, sourceKey: 'k' });
        let answer;
        const ctx = withLesson(mod, { confirm: () => new Promise(resolve => { answer = resolve; }) });
        ctx.channels[0].onmessage({ data: { moduleId: 'm1' } });
        ctx.toggleGyosuanEdit('deckMd');
        const raw = { value: '내 편성안' };
        ctx.elements['gyosuan-raw'] = raw;
        ctx.elements['gyosuan-view'] = { innerHTML: '', querySelectorAll: () => [] };
        const first = ctx.saveGyosuanRaw();
        const again = ctx.saveGyosuanRaw();
        await new Promise(resolve => setImmediate(resolve));
        assert.strictEqual(ctx.asked.length, 1, '묻는 동안 다시 불러도 같은 물음의 답을 기다린다');
        ctx.channels[0].onmessage({ data: { moduleId: 'm1' } });
        assert.deepStrictEqual([raw.value, ctx.elements['gyosuan-view'].innerHTML], ['내 편성안', ''], '넣지 않은 글이 있으면 칸을 옛 글로 다시 그리지 않는다');
        ctx.channels[0].onmessage({ data: { moduleId: 'other' } });
        answer(true);
        await first;
        await again;
        assert.strictEqual(mod.gyosuan.deckMd, '내 편성안');
        assert.strictEqual(ctx.saved, 1, '한 번만 저장한다');
        assert.strictEqual(vm.runInContext('_gyosuanForeignChange', ctx), 'other', '묻는 동안 온 다른 차시의 알림은 지우지 않는다');
        ctx.channels[0].onmessage({ data: { moduleId: 'm1' } });
        assert.ok(ctx.elements['gyosuan-view'].innerHTML.includes('다른 탭에서 이 차시가 바뀌었습니다'), '넣을 글이 없으면 다시 그려 알린다');
    });

    await run('다른 탭 변경: 확인 창으로 포커스가 옮겨 가며 원문 칸이 다시 저장해도(onchange) 한 번만 묻고, 묻는 동안 다시 누른 Ctrl+S도 답을 기다린다', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, sourceKey: 'k' });
        const flush = () => new Promise(resolve => setImmediate(resolve));
        let answer;
        let open = false;
        const nested = [];
        const ctx = withLesson(mod, { confirm: () => {
            if (open) return false; // 같은 확인 창이 떠 있으면 앱의 확인 창(showConfirm)은 겹쳐 띄우지 않고 false
            open = true;
            nested.push(ctx.saveGyosuanRaw()); // 창이 뜨며 칸을 벗어나 onchange가 그 자리에서 다시 부른다
            return new Promise(resolve => { answer = resolve; });
        } });
        ctx.channels[0].onmessage({ data: { moduleId: 'm1' } });
        ctx.toggleGyosuanEdit('deckMd');
        ctx.elements['gyosuan-raw'] = { value: '내 편성안' };
        const first = ctx.saveGyosuanRaw();
        await flush();
        let done = false;
        const again = ctx.saveGyosuanRaw().then(() => { done = true; });
        await flush();
        assert.deepStrictEqual([ctx.asked.length, done], [1, false], '한 번만 묻고, 다시 누른 저장도 답할 때까지 끝나지 않는다');
        answer(true);
        await Promise.all([first, again, ...nested]);
        assert.deepStrictEqual([mod.gyosuan.deckMd, ctx.saved], ['내 편성안', 1]);
    });

    await run('교수안 원문 칸: 저장하는 동안 더 고친 글도 칸을 벗어날 때 넣는다(먼저 시작한 저장에 묻히지 않게)', async () => {
        const mod = lesson({ docMd: DOC, deckMd: DECK, sourceKey: 'k' });
        const ctx = withLesson(mod);
        const writes = [];
        ctx.saveState = () => new Promise(resolve => writes.push(resolve)); // 큰 작업은 브라우저 저장이 오래 걸린다
        const settle = async () => {
            for (let i = 0; i < 6; i++) {
                writes.splice(0).forEach(done => done());
                await new Promise(resolve => setImmediate(resolve));
            }
        };
        ctx.toggleGyosuanEdit('deckMd');
        const raw = { value: '처음 고친 편성안' };
        ctx.elements['gyosuan-raw'] = raw;
        const first = ctx.saveGyosuanRaw(); // Ctrl+S
        await new Promise(resolve => setImmediate(resolve));
        raw.value = '이어서 더 고친 편성안'; // 저장이 끝나기 전에 이어 쓴다
        const second = ctx.saveGyosuanRaw(); // 칸을 벗어남(onchange)
        await settle();
        await Promise.all([first, second]);
        assert.strictEqual(mod.gyosuan.deckMd, '이어서 더 고친 편성안', '나중에 고친 글을 넣는다');
        assert.strictEqual(ctx.hasPendingGyosuanRaw(), false, '넣지 않은 글이 남지 않는다');
    });

    await run('샘플: 스튜디오는 저장 없이 샘플 덱을 받는다', async () => {
        const ctx = makeContext();
        const payload = ctx.getSlideStudioSample();
        assert.ok(ctx.KBuilder.parseDeck(payload.deckMd).slides.length > 3);
        assert.strictEqual(payload.deckHtml, null);
        assert.deepStrictEqual(plain(payload.sessions), []);
    });

    console.log('ALL PASSED');
})().catch(error => {
    console.error('FAIL', error.message);
    process.exit(1);
});
