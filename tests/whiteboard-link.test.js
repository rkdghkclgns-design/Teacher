// 판서 영상(화이트보드 교안 스튜디오로 넘기기) 테스트 (실행: node tests/whiteboard-link.test.js)
// 실제 data.js·lesson-lint.js·lesson-opening.js·whiteboard-link.js를 실행하고 저장소·창 열기·내려받기만 스텁으로 둔다.
// 스튜디오(src/lib/handoff.ts)가 받는 형식: v 1, from 'teacher', 주제 300자·파일 이름 120자·본문 500만 자 이하, 10분 안
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');

const PAGES = { protocol: 'https:', pathname: '/Teacher/', origin: 'https://rkdghkclgns-design.github.io' };
const LOCAL = { protocol: 'http:', pathname: '/', origin: 'http://localhost:8080' };
const KEY = 'whiteboard-studio:handoff';

function lesson(over = {}) {
    return {
        id: 7,
        title: '1차시: 개념 이해',
        description: '게임 기획의 기본 개념',
        objectives: ['코어 루프를 설명할 수 있다', '게임 목표를 정할 수 있다'],
        tabContents: {
            basicLearn: '## 코어 루프\n\n반복되는 행동의 묶음이다.\n\n![루프 그림](data:image/png;base64,AAAA)\n<!-- [IMG: 코어 루프] -->\n<img src="x.png">',
            assessment: '## 확인 문제\n\n1. 코어 루프란?'
        },
        ...over
    };
}

function makeContext({ loc = PAGES, mod = lesson(), setItemThrows = false, onSaveEdits } = {}) {
    const storage = {};
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        location: loc,
        storage, toasts: [], alerts: [], opened: [], downloads: [], saved: [],
        localStorage: {
            getItem: key => storage[key] ?? null,
            setItem: (key, value) => { if (setItemThrows) throw new Error('QuotaExceededError'); storage[key] = String(value); },
            removeItem: key => { delete storage[key]; }
        },
        // 새 탭은 링크(a target=_blank)를 눌러 연다. 눌린 링크를 기록하고 문서에서 빠졌는지 본다
        document: {
            getElementById: () => null,
            createElement: () => ({
                click() { ctx.opened.push({ url: this.href, target: this.target, rel: this.rel }); },
                remove() { ctx.attached--; }
            }),
            body: { appendChild: () => { ctx.attached++; } }
        },
        attached: 0,
        globalState: { subjects: [{ id: 's1', title: '1. 게임 기획의 기초', lessons: [mod] }] },
        currentSubjectId: 's1',
        currentLessonTab: 'basicLearn',
        getEditingModule: id => (String(id) === String(mod.id) ? mod : null),
        saveOpenEditsFor: (m, tabId) => { ctx.saved.push(tabId); onSaveEdits?.(m); },
        downloadFile: (content, name, type) => ctx.downloads.push({ content, name, type })
    };
    ctx.window = ctx;
    ctx.open = () => { throw new Error('window.open은 쓰지 않는다'); };
    ctx.showToast = message => ctx.toasts.push(message);
    ctx.showAlert = message => ctx.alerts.push(message);
    vm.createContext(ctx);
    ['data.js', 'lesson-lint.js', 'lesson-opening.js', 'whiteboard-link.js'].forEach(file => vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), ctx));
    return ctx;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('탭마다 # 제목으로 나누고 그림·주석은 빼며 그림 설명만 남긴다', () => {
    const ctx = makeContext();
    const handoff = ctx.buildWhiteboardHandoff(lesson(), ctx.globalState.subjects[0], 1000);
    assert.strictEqual(handoff.v, 1);
    assert.strictEqual(handoff.from, 'teacher');
    assert.strictEqual(handoff.createdAt, 1000);
    assert.strictEqual(handoff.topic, '개념 이해 (게임 기획의 기초)');
    assert.strictEqual(handoff.audience, '대학생·성인');
    assert.strictEqual(handoff.fileName, '게임 기획의 기초 1차시 개념 이해.md');
    const md = handoff.markdown;
    assert.ok(md.startsWith('# 1차시: 개념 이해 — 수업 정보'), md.slice(0, 40));
    assert.ok(md.includes('- 교과: 1. 게임 기획의 기초'));
    assert.ok(md.includes('  - 코어 루프를 설명할 수 있다'));
    assert.ok(md.indexOf('# 기본학습') < md.indexOf('# 학습이해도'), '탭 순서대로');
    assert.ok(!md.includes('# 기본실습'), '빈 탭은 넣지 않는다');
    assert.ok(md.includes('(그림: 루프 그림)'));
    assert.ok(!/data:image|<!--|<img/.test(md), md);
});

test('교안이 없으면 넘기지 않고 알린다', () => {
    const empty = lesson({ tabContents: {}, content: '' });
    const ctx = makeContext({ mod: empty });
    assert.strictEqual(ctx.buildWhiteboardHandoff(empty, null), null);
    ctx.openWhiteboardStudio(7);
    assert.strictEqual(ctx.opened.length, 0);
    assert.ok(/아직 교안 내용이 없습니다/.test(ctx.alerts[0]));
    assert.strictEqual(ctx.storage[KEY], undefined);
});

test('탭이 없는 예전 차시는 본문(content)을 넘긴다', () => {
    const old = lesson({ tabContents: undefined, content: '## 옛 본문\n\n내용' });
    const ctx = makeContext({ mod: old });
    const handoff = ctx.buildWhiteboardHandoff(old, null);
    assert.ok(handoff.markdown.includes('# 교안\n\n## 옛 본문'));
    assert.strictEqual(handoff.topic, '개념 이해');
    assert.strictEqual(handoff.fileName, '1차시 개념 이해.md');
});

test('GitHub Pages에서는 저장소에 남기고 같은 주소의 스튜디오를 #from=teacher로 새 탭에 연다', () => {
    const ctx = makeContext();
    ctx.openWhiteboardStudio(7);
    const stored = JSON.parse(ctx.storage[KEY]);
    assert.strictEqual(stored.topic, '개념 이해 (게임 기획의 기초)');
    assert.ok(Date.now() - stored.createdAt < 5000);
    assert.deepStrictEqual(ctx.opened, [{ url: 'https://rkdghkclgns-design.github.io/whiteboard-studio-web/#from=teacher', target: '_blank', rel: 'noopener' }]);
    assert.strictEqual(ctx.attached, 0, '연 뒤 링크를 문서에서 뺀다');
    assert.strictEqual(ctx.downloads.length, 0);
    assert.ok(/스튜디오로 넘겼습니다/.test(ctx.toasts[0]));
});

test('다시 누르면 기록이 새것으로 바뀐다 (스튜디오는 읽을 때 지운다)', () => {
    const mod = lesson();
    const ctx = makeContext({ mod });
    ctx.openWhiteboardStudio(7);
    mod.tabContents.basicLearn = '## 고친 뒤 다시 넘김';
    ctx.openWhiteboardStudio(7);
    assert.strictEqual(ctx.opened.length, 2);
    assert.ok(JSON.parse(ctx.storage[KEY]).markdown.includes('## 고친 뒤 다시 넘김'));
});

test('넘기기 전에 수정 모드에서 고치던 글을 먼저 반영한다', () => {
    const mod = lesson();
    const ctx = makeContext({ mod, onSaveEdits: m => { m.tabContents.basicLearn = '## 방금 고친 글'; } });
    ctx.openWhiteboardStudio(7);
    assert.deepStrictEqual(ctx.saved, ['basicLearn']);
    assert.ok(JSON.parse(ctx.storage[KEY]).markdown.includes('## 방금 고친 글'));
});

test('주소가 다르면 교안 파일을 내려받고 공개 스튜디오를 열어 보관함에 넣도록 안내한다', () => {
    const ctx = makeContext({ loc: LOCAL });
    ctx.openWhiteboardStudio(7);
    assert.strictEqual(ctx.storage[KEY], undefined);
    assert.strictEqual(ctx.downloads.length, 1);
    assert.strictEqual(ctx.downloads[0].name, '게임 기획의 기초 1차시 개념 이해.md');
    assert.ok(ctx.downloads[0].content.includes('# 기본학습'));
    assert.strictEqual(ctx.opened[0].url, 'https://rkdghkclgns-design.github.io/whiteboard-studio-web/');
    assert.ok(/다른 주소/.test(ctx.alerts[0]) && /지식 보관함/.test(ctx.alerts[0]));
});

test('저장소에 넣지 못하면 파일로 넘긴다', () => {
    const ctx = makeContext({ setItemThrows: true });
    ctx.openWhiteboardStudio(7);
    assert.strictEqual(ctx.downloads.length, 1);
    assert.ok(/저장소에 교안을 넣지 못해/.test(ctx.alerts[0]));
});

test('스튜디오가 받는 길이를 넘지 않는다 (주제 300자, 파일 이름 120자, 본문 100만 자)', () => {
    const long = lesson({ title: '가'.repeat(400), tabContents: { basicLearn: '나'.repeat(1200000) } });
    const ctx = makeContext({ mod: long });
    const handoff = ctx.buildWhiteboardHandoff(long, { title: '다'.repeat(200) });
    assert.ok(handoff.topic.length <= 300);
    assert.ok(handoff.fileName.length <= 120 && handoff.fileName.endsWith('.md'));
    assert.ok(handoff.markdown.length <= 1000000 + 20 && handoff.markdown.endsWith('(이하 생략)'));
    assert.ok(!/[\\/:*?"<>|]/.test(ctx.buildWhiteboardHandoff(lesson({ title: 'a/b:c*d?' }), null).fileName));
});

let failed = 0;
for (const { name, fn } of tests) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (e) {
        failed++;
        console.log(`FAIL - ${name}\n  ${e.message}`);
    }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
