// 차시 병합 재생성 테스트 (실행: node tests/merge.test.js)
// 병합한 기본학습도 탭 생성과 같은 분량 채우기(lesson-volume.js ensureSpokenVolume)로 낭독 목표(480분 − 기본실습 시간, 기본 360분)까지 채우는지 본다.
// 실제 merge.js·lesson-lint.js·lesson-volume.js·cost-estimate.js를 vm에서 돌리고, AI 호출과 채우기·자동 수정만 바꿔 끼운다
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', 'js') + path.sep;
const read = file => fs.readFileSync(root + file, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const FILL_UNIT = '가나다라마바사아자차. ';
const DRAFT = '## 학습 목표\n\n- 반복문을 설명할 수 있습니다.\n\n## 1. 짧은 병합 교안 (⏱ 60분)\n\n본문 몇 줄입니다.';
const FILLED = `## 학습 목표\n\n- 반복문을 설명할 수 있습니다.\n\n## 1. 채운 병합 교안 (⏱ 480분)\n\n${FILL_UNIT.repeat(11000).trim()}`;
const FIX_MARK = '\n\n고쳐 받은 표시입니다.';

let failed = 0;
let count = 0;
async function run(name, fn) {
    count++;
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (err) {
        failed++;
        console.log(`FAIL - ${name}\n  ${err.stack || err.message}`);
    }
}

// volume(job): 채우기 결과를 돌려준다(부른 값을 받는다). 없으면 채운 글(FILLED)
function mergeContext({ volume = null } = {}) {
    const elements = { 'editor-loading': { style: { display: 'none' } }, 'editor-loading-text': { textContent: '' } };
    const lesson = (id, title) => ({ id, title, description: '설명', content: `${title} 본문`, tabContents: { basicLearn: `${title} 본문` } });
    const subject = { id: 's1', title: '교과', lessons: [lesson(1, '반복문'), lesson(2, '조건문')] };
    const ctx = {
        console: { log() {}, warn() {}, error() {} }, Promise, Set, Map, Math, JSON,
        localStorage: { getItem: () => null, setItem() {} },
        globalState: { subjects: [subject] }, currentSubjectId: 's1', courseData: subject.lessons,
        TEXT_MODEL: 'gemini-3.8-flash', buildTaskContext: () => ({ systemInstruction: '지시', userPrompt: '병합' }),
        mergeCalls: 0, fills: [], fixes: [], asked: [], alerts: [], archived: [],
        saveState: async () => {}, renderSidebar() {}, renderEditor() {},
        archiveContent: async (item, reason) => { ctx.archived.push({ item, reason }); },
        document: { getElementById: id => elements[id] || null, querySelectorAll: () => [] },
        confirmAsync: async (message, opts) => { ctx.asked.push({ message, opts }); return true; }
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = () => {};
    ctx.callGemini = async () => { ctx.mergeCalls += 1; return { candidates: [{ content: { parts: [{ text: DRAFT }] } }] }; }; // data.js extractText가 읽는 모양
    vm.createContext(ctx);
    ['data.js', 'lesson-lint.js', 'lesson-editor-tools.js', 'lesson-review.js', 'lesson-volume.js', 'cost-estimate.js', 'merge.js'].forEach(file => vm.runInContext(read(file), ctx));
    ctx.fillWith = volume;
    ctx.fillResult = job => ({ md: FILLED, spoken: 0, minutes: 0, targetMinutes: job.targetMinutes, targetChars: job.targetMinutes * 250, calls: 20, added: 5, short: false, stopped: false, gone: false, error: null, reason: 'target', parts: [] });
    vm.runInContext(`
        ensureSpokenVolume = async options => { window.fills.push(options); return (window.fillWith || window.fillResult)(options); };
        autoFixGeneratedTab = async options => { window.fixes.push(options); return options.md + ${JSON.stringify(FIX_MARK)}; };
        mergeSelectedIds = new Set(['1', '2']);`, ctx);
    return { ctx, subject, elements };
}

(async () => {
    await run('차시 병합: 병합한 기본학습을 탭 생성과 같은 채우기로 낭독 목표(실습을 정하지 않으면 360분)까지 채우고 고쳐 받아 저장한다. 묻는 창에 분량 채우기 호출 수·시간을 보인다', async () => {
        const { ctx, subject, elements } = mergeContext();
        await ctx.executeMerge();
        assert.strictEqual(ctx.mergeCalls, 1, '병합 호출은 한 번');
        assert.strictEqual(ctx.fills.length, 1, '분량 채우기를 한 번 부른다');
        const fill = ctx.fills[0];
        const made = subject.lessons[2];
        assert.deepStrictEqual([fill.tabId, fill.targetMinutes, fill.md, fill.mod === made, plain(fill.lockedBlocks)], ['basicLearn', 360, DRAFT, true, []]);
        assert.ok(typeof fill.isLive === 'function' && fill.isLive() === true && typeof fill.isStopped === 'function', '차시가 그대로인지·중지했는지 본다');
        assert.strictEqual(ctx.fixes.length, 1);
        assert.deepStrictEqual([ctx.fixes[0].tabId, ctx.fixes[0].md === FILLED, ctx.fixes[0].rounds, ctx.fixes[0].minSpokenChars], ['basicLearn', true, 3, 90000], '채운 분량 아래로 줄이지 않게 고쳐 받는다');
        assert.ok(made.tabContents.basicLearn === `${FILLED}${FIX_MARK}`, `채우고 고친 글을 기본학습에 넣는다: ${String(made.tabContents.basicLearn).slice(0, 80)} / ${ctx.alerts.at(-1)}`);
        assert.deepStrictEqual([made.content === `${FILLED}${FIX_MARK}`, made.status], [true, 'done']);
        assert.ok(ctx.alerts.at(-1).startsWith('병합 재생성이 완료되었습니다. 기본학습은 낭독 약') && ctx.alerts.at(-1).includes('(목표 360분)'), ctx.alerts.at(-1));
        const asked = ctx.asked[0];
        assert.ok(asked.message.includes('반복문\n조건문') && asked.message.includes('360분이 걸리는 분량까지'), asked.message);
        assert.ok(asked.message.includes('AI 호출 약') && asked.message.includes('걸리는 시간') && asked.message.includes('낭독 360분'), '분량 채우기 호출 수·시간을 함께 보인다');
        assert.deepStrictEqual([asked.opts.title, asked.opts.okLabel], ['차시 병합', '병합해 만들기']);
        assert.strictEqual(elements['editor-loading'].style.display, 'none');
        assert.strictEqual(elements['editor-loading-text'].textContent, 'AI가 상세 교안을 작성하고 있습니다...', '로딩 문구를 되돌린다');
    });

    await run('차시 병합: 분량 채우기를 중단하면 받은 데까지 저장하고 고쳐 받지 않으며, 못 미친 분량을 알린다', async () => {
        const { ctx, subject } = mergeContext({ volume: job => ({ ...ctx.fillResult(job), md: DRAFT, added: 0, stopped: true, reason: 'stopped' }) });
        await ctx.executeMerge();
        assert.strictEqual(ctx.fixes.length, 0, '중단하면 고쳐 받지 않는다');
        assert.strictEqual(subject.lessons[2].tabContents.basicLearn, DRAFT);
        assert.ok(ctx.alerts.at(-1).includes('분량 채우기를 중단해') && ctx.alerts.at(-1).includes("'분량 채우기'로 이어서"), ctx.alerts.at(-1));
    });

    await run('차시 병합: 채우는 동안 새 차시를 지우면 차시에 넣지 않고, 채운 글은 작업 기록에 남긴다', async () => {
        let removed = null;
        const { ctx, subject } = mergeContext({
            volume: job => {
                removed = subject.lessons.pop(); // 채우는 동안 사이드바에서 새 차시를 지웠다
                return { ...ctx.fillResult(job), md: `${DRAFT}\n\n늘린 소주제입니다.`, added: 1, gone: true, reason: 'gone' };
            }
        });
        await ctx.executeMerge();
        assert.ok(removed && removed.title.startsWith('[병합]'), '지운 것은 새 차시');
        assert.strictEqual(ctx.fixes.length, 0);
        assert.strictEqual(removed.tabContents.basicLearn, null, '지운 차시에 넣지 않는다');
        assert.strictEqual(ctx.archived.length, 1);
        assert.deepStrictEqual([ctx.archived[0].reason, ctx.archived[0].item.content], ['분량 채우기 결과(반영 안 함)', `${DRAFT}\n\n늘린 소주제입니다.`]);
        assert.ok(ctx.alerts.at(-1).startsWith('병합한 기본학습을 채우는 동안 그 차시를 지웠거나') && ctx.alerts.at(-1).includes('작업 기록'), ctx.alerts.at(-1));
    });

    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
