// 판서 영상 테스트가 함께 쓰는 실행 환경: 실제 스크립트를 vm에서 돌리고 저장소·창·내려받기·IndexedDB만 흉내 낸다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.join(__dirname, '..');

const PAGES = { protocol: 'https:', pathname: '/Teacher/', origin: 'https://rkdghkclgns-design.github.io' };
const LOCAL = { protocol: 'http:', pathname: '/', origin: 'http://localhost:8080' };
const HANDOFF_KEY = 'whiteboard-studio:handoff';
const REQUESTS_KEY = 'teacher:whiteboard-requests';

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

// files: 불러올 js/ 파일. dialogEdit(opts)로 '판서 영상 만들기' 창에서 고친 값을 흉내 낸다 (null이면 창을 취소)
function makeContext({ loc = PAGES, mod = lesson(), setItemThrows = false, onSaveEdits, files = [], dialogEdit, stored = {} } = {}) {
    const storage = { ...stored };
    const db = {};
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        location: loc,
        storage, db, toasts: [], alerts: [], opened: [], downloads: [], saved: [], dialogs: [], inbox: [], saves: 0,
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
        Blob,
        globalState: { subjects: [{ id: 's1', title: '1. 게임 기획의 기초', lessons: [mod] }] },
        currentSubjectId: 's1',
        currentLessonTab: 'basicLearn',
        getEditingModule: id => (id === undefined || String(id) === String(mod.id) ? mod : null),
        saveOpenEditsFor: (m, tabId) => { ctx.saved.push(tabId); onSaveEdits?.(m); },
        downloadFile: (content, name, type) => ctx.downloads.push({ content, name, type }),
        saveState: async () => { ctx.saves++; },
        DBManager: {
            setItem: async (key, value) => { db[key] = value; },
            getItem: async key => db[key],
            deleteItem: async key => { delete db[key]; },
            keys: async () => Object.keys(db)
        },
        LESSON_ACTIONS: {}
    };
    ctx.window = ctx;
    ctx.open = () => { throw new Error('window.open은 쓰지 않는다'); };
    ctx.showToast = message => ctx.toasts.push(message);
    ctx.showAlert = message => ctx.alerts.push(message);
    vm.createContext(ctx);
    ['data.js', 'lesson-lint.js', 'lesson-opening.js', 'whiteboard-link.js', ...files]
        .forEach(file => vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), ctx));
    ctx.showWhiteboardDialog = (opts, onConfirm) => {
        ctx.dialogs.push(opts);
        const edited = dialogEdit === undefined ? { topic: opts.topic, markdown: opts.markdown } : dialogEdit?.(opts);
        if (edited) onConfirm(edited);
    };
    ctx.whiteboardInbox = {
        read: async () => ctx.inbox.slice(),
        remove: async requestId => { ctx.inbox = ctx.inbox.filter(record => record.requestId !== requestId); }
    };
    ctx.applied = [];
    ctx.realApplyWhiteboardVideos = ctx.applyWhiteboardVideos; // 보기 화면 그리기를 따로 볼 때 쓴다
    ctx.applyWhiteboardVideos = m => ctx.applied.push(m);
    return ctx;
}

function runTests(tests) {
    return (async () => {
        let failed = 0;
        for (const { name, fn } of tests) {
            try {
                await fn();
                console.log(`ok - ${name}`);
            } catch (e) {
                failed++;
                console.log(`FAIL - ${name}\n  ${e.message}`);
            }
        }
        console.log(`\n${tests.length - failed}/${tests.length} passed`);
        if (failed) process.exit(1);
    })();
}

module.exports = { PAGES, LOCAL, HANDOFF_KEY, REQUESTS_KEY, lesson, makeContext, runTests };
