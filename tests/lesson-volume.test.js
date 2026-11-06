// 기본학습 낭독 분량 채우기 테스트 (실행: node tests/lesson-volume.test.js)
// 낭독 글자 세기, 늘릴 섹션 고르기, 받은 글 다듬기, 분량 채우기 반복(목표·중지·한도·호출 상한·잇단 실패)과
// 탭 생성·교안 전체 생성·일괄 생성·탭 위 표시·'분량 채우기'·생성 지시·미리 보기 예고의 연결을 실제 파일로 확인한다.
// AI 응답만 스텁이고, 부탁한 글자보다 덜 쓰는 모델을 흉내 낸다. 키는 쓰지 않는다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', 'js') + path.sep;
const source = file => fs.readFileSync(root + file, 'utf8');
const GEN_FILES = ['data.js', 'ai-errors.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js', 'course-design.js', 'course-flow.js', 'lesson-volume.js'];
const reply = (text, finishReason = 'STOP') => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });
const plain = value => JSON.parse(JSON.stringify(value));
const call = (ctx, name) => vm.runInContext(name, ctx);
const FILL_UNIT = '가나다라마바사아자차. ';
const filler = n => FILL_UNIT.repeat(Math.ceil(n / FILL_UNIT.length)).slice(0, n).trim();
const GOAL = Math.ceil(480 * 250 * 1.03);
const TARGET_CHARS = 480 * 250;
const DAILY_MESSAGE = '오늘 쓸 수 있는 AI 사용량을 다 썼습니다(429). 내일 다시 하거나 오른쪽 위 ⚙ 설정에서 다른 모델이나 키로 바꿔 주세요.';
const daily = () => Object.assign(new Error(DAILY_MESSAGE), { status: 429, quota: 'daily', noRetry: true });

function fakeElement() {
    const handlers = {};
    return {
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', title: '', disabled: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener(type, fn) { handlers[type] = fn; },
        fire(type, event) { return handlers[type]?.(event); },
        querySelector: () => fakeElement(),
        querySelectorAll: () => [],
        remove() { this.removed = true; }
    };
}

// 낭독 세기·시간·과정 설계 함수만 싣는다
function pureContext() {
    const ctx = { console, localStorage: { getItem: () => null, setItem() {} }, globalState: { subjects: [] }, escapeHtml: s => String(s),
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} } };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['data.js', 'lesson-lint.js', 'lesson-editor-tools.js', 'course-design.js'].forEach(file => vm.runInContext(source(file), ctx));
    return ctx;
}

// review-flow.test.js와 같은 화면 흉내에 오류 안내·과정 설계·일괄 생성·분량 채우기를 더한다.
// 프롬프트는 '작업|탭|섹션 제목|부탁 글자|code'로 만들어 스텁이 읽는다. setTimeout은 기다린 시간을 남기고 곧 넘긴다(holdTimers면 1초 넘는 기다림은 끝나지 않는다)
function genContext() {
    const elements = {};
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        Promise, URL, Uint16Array, Blob, AbortController,
        localStorage: { getItem: () => null, setItem() {} },
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''),
        saveState: async () => { ctx.saved += 1; },
        renderEditor() {}, renderSidebar() {}, showLessonView() {},
        archiveContent: async (item, reason) => { ctx.archived.push({ ...item, reason }); },
        // 전체 생성 단계가 묻는 교수안·NCS 상태(이 테스트는 교안 탭만 본다)
        currentEditingModuleId: null, needsElementAutoAssign: () => false, lessonNeedsGyosuan: () => false, runGyosuanGeneration: async () => ({ ok: true }),
        archived: [], alerts: [], toasts: [], overlays: [], prompts: [], payloads: [], sections: [], waits: [], confirms: [], pipelineCalls: [],
        imageCalls: 0, imageOpts: null, saved: 0, holdTimers: false,
        elements,
        document: {
            readyState: 'complete', hidden: false, title: '',
            body: { appendChild: el => { if (el.id) elements[el.id] = el; ctx.overlays.push(el); ctx.onOverlay?.(el); } },
            createElement: fakeElement,
            getElementById: id => elements[id] || null,
            addEventListener() {}, removeEventListener() {},
            querySelector: () => null, querySelectorAll: () => []
        }
    };
    ctx.window = ctx;
    ctx.setTimeout = (fn, ms) => { ctx.waits.push(ms); return ctx.holdTimers && ms >= 1000 ? -1 : setTimeout(fn, Math.min(ms, 1)); };
    ctx.clearTimeout = id => { if (id !== -1) clearTimeout(id); };
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = (message, kind) => ctx.toasts.push({ message, kind });
    vm.createContext(ctx);
    GEN_FILES.forEach(file => vm.runInContext(source(file), ctx));
    ctx.confirmAsync = async (message, opts) => { ctx.confirms.push({ message, opts }); return ctx.confirmAnswer !== false; };
    ctx.callGemini = async () => { throw new Error('호출되면 안 됨'); };
    vm.runInContext(`callGemini = (...args) => window.callGemini(...args);
        buildTaskContext = (task, a) => ({ systemInstruction: '시스템', userPrompt: [task, a.tabId, a.sectionTitle, a.requestChars, a.needCode ? 'code' : ''].join('|') });
        getEditingModule = (id = window.currentMod?.id) => (String(id) === String(window.currentMod?.id) ? window.currentMod : null);
        processImageTags = async (mod, md, opts) => { window.imageCalls += 1; window.imageOpts = opts; return md; };
        renderSidebar = () => {}; renderEditor = () => {};
        globalState = { subjects: [] }; currentSubjectId = null; courseData = [];`, ctx);
    ['editor-loading', 'editor-loading-text', 'editor-loading-stop', 'ai-command-input', 'lesson-volume-chip'].forEach(id => { elements[id] = fakeElement(); });
    return ctx;
}

// 덜 쓰는 모델 흉내. 첫 생성(tab_content·module)에는 초안을, 분량 보강에는 '### ■ 보강 k'와 부탁 글자의 deliver배를 돌려준다.
// onCall(k, 부탁): 보강 호출마다 먼저 부른다(던지면 그 호출이 실패한다) / replyFor(k, 부탁): 보강 답을 바꾼다 / fixReply(프롬프트): 컨벤션 수정('[작업]') 답
function volumeModel(ctx, { deliver = 0.75, draft = '', onCall = () => {}, replyFor = null, fixReply = () => reply('') } = {}) {
    let k = 0;
    return async (model, payload) => {
        const text = payload.contents[0].parts[0].text;
        ctx.payloads.push(payload);
        ctx.prompts.push(text);
        const [task, , sectionTitle, requestChars, code] = text.split('|');
        if (task === 'tab_content' || task === 'module') return reply(draft);
        if (task !== 'volume_expand') return fixReply(text);
        k += 1;
        const ask = { sectionTitle, requestChars: Number(requestChars), code: code === 'code', filling: call(ctx, 'isVolumeFilling')() };
        ctx.sections.push({ k, ...ask });
        await onCall(k, ask);
        return replyFor ? replyFor(k, ask) : reply(`### ■ 보강 ${k}\n\n${filler(Math.round(ask.requestChars * deliver))}`);
    };
}

const LABELS = [60, 60, 45, 60, 60, 45, 60, 60];
const GOALS = ['반복문으로 합계를 구하는 코드를 작성할 수 있습니다.', '조건에 맞는 값을 골라 세는 코드를 작성할 수 있습니다.'];
const CHECKLIST = '## ✅ 학습 후 체크리스트\n\n- 합계를 구했습니다. (다시 보기: 1. 내용 1)\n- 값을 골라 셌습니다. (다시 보기: 2. 내용 2)';
// 학습 목표·개요(⏱ 10분)·내용 섹션 8개(60/60/45/60/60/45/60/60분)·체크리스트로 된 약 2만 자 초안
function draftMd({ body = 2400, extra = [], sectionBody = null } = {}) {
    return [
        '# 📝 반복과 합계',
        `## 학습 목표\n\n${GOALS.map(goal => `- ${goal}`).join('\n')}`,
        '## 개요 (⏱ 10분)\n\n- 값을 하나씩 더해야 하는 상황입니다.\n- 반복 구조로 해결합니다.',
        ...LABELS.map((minutes, i) => `## ${i + 1}. 내용 ${i + 1} (⏱ ${minutes}분)\n\n${sectionBody ? sectionBody(i) : filler(body)}\n\n<br>`),
        ...extra,
        CHECKLIST
    ].join('\n\n');
}

const MOD = { id: 1, title: '반복과 합계', description: '합계를 구합니다.' };
const ensure = ctx => options => call(ctx, 'ensureSpokenVolume')({ mod: MOD, tabId: 'basicLearn', ...options });
const titleKeys = (ctx, md) => plain(call(ctx, 'mdSections')(md).map(section => call(ctx, 'lockTitleKey')(section.title)));
const sectionOf = (ctx, md, test) => call(ctx, 'mdSections')(md).find(section => test(section.title));
const volumePrompts = ctx => ctx.prompts.filter(text => text.startsWith('volume_expand'));

function answerPreview(ctx, action) {
    ctx.onOverlay = overlay => setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: action } } }));
}

async function waitFor(condition, label) {
    for (let i = 0; i < 400; i++) {
        if (condition()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`기다려도 되지 않음: ${label}`);
}

let failed = 0;
let count = 0;
async function run(name, fn) {
    count++;
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (e) {
        failed++;
        console.log(`FAIL - ${name}\n  ${e.stack || e.message}`);
    }
}

(async () => {
    const pure = pureContext();

    /* ---------- 낭독 세기 ---------- */
    await run('낭독 글자 세기: 코드·mermaid·닫지 않은 코드·표·그림·태그·기호를 빼고 읽는 글만 공백 포함으로 센다', () => {
        const md = [
            '# 📝 변수와 자료형', '',
            '## 학습 목표', '', '- 변수를 선언할 수 있습니다.', '',
            '## ■ 변수 정의 (⏱ 60분)', '', '<!-- [IMG: "변수 그림"] -->', '',
            '변수는 값을 담는 이름입니다.', '',
            '```python', '# 값을 담습니다. 다음 줄에서 씁니다.', 'score = 90', '```', '',
            '- `score = 90`은 값을 넣습니다.', '',
            '<table style="border: 1px"><tr><td>표 안 글</td></tr></table>', '',
            '| 이름 | 값 |', '|---|---|', '| a | 1 |', '',
            '<div class="image-wrapper"><img src="local:img_1" alt="변수"><button data-lesson-action="regenerate-image">다시 찾기</button><div class="image-caption">그림 설명 글</div></div>', '',
            '```mermaid', 'flowchart LR', 'A-->B', '```', '',
            '&nbsp;&nbsp;들여쓴 글입니다.<br>', '',
            '💡 [공식 문서](https://example.com)를 봅니다.', '',
            '```js', 'const open = 1;'
        ].join('\n');
        assert.strictEqual(call(pure, 'spokenText')(md), '변수와 자료형 학습 목표 변수를 선언할 수 있습니다. 변수 정의 변수는 값을 담는 이름입니다. score = 90은 값을 넣습니다. 들여쓴 글입니다. 공식 문서를 봅니다.');
        assert.strictEqual(call(pure, 'spokenChars')(md), 95);
        assert.strictEqual(call(pure, 'readAloudMinutes')('가'.repeat(120000)), 480, '1분에 250자');
        assert.strictEqual(call(pure, 'spokenChars')('<div class="image-placeholder"><span>그림 자리</span> <button>🔄 다시 검색</button></div>\n\n본문'), 2, '그림 자리 줄도 세지 않는다');
    });

    await run('목표 낭독 시간: 최소 480분이고 차시 시간이 더 길면 그 시간이다', () => {
        const target = call(pure, 'basicLearnTargetMinutes');
        assert.strictEqual(target({}), 480);
        assert.strictEqual(target({ hours: 2, minutes: 120 }), 480, '과정 설계의 2시간 차시도 480분');
        assert.strictEqual(target({ hours: 10 }), 600);
        assert.strictEqual(target(null), 480);
    });

    await run('코드 블록 닫기: 열린 펜스의 길이로 닫고 닫힌 글은 그대로 둔다', () => {
        const close = call(pure, 'closeOpenFence');
        assert.strictEqual(close('글\n````python\nx = 1'), '글\n````python\nx = 1\n````');
        assert.strictEqual(close('글\n```js\nx\n```'), '글\n```js\nx\n```');
    });

    /* ---------- 늘릴 섹션 고르기 ---------- */
    await run('늘릴 섹션 고르기: (⏱ N분) 비율만큼 모자란 섹션부터 고르고, 학습 목표·개요·체크리스트·고정·실습·# 제목 섹션은 고르지 않는다', () => {
        const ctx = genContext();
        const extra = [
            `## 9. 고정 섹션 (⏱ 30분)\n\n${filler(1500)}`,
            `## 4. 실습/예제 (⏱ 20분)\n\n${filler(1500)}`,
            `## 10. 퀘스트 안내 (⏱ 20분)\n\n${filler(800)}\n\n# ⚔️ 일일 퀘스트 (실습 과제)\n\n- 합계를 구해 제출합니다.`
        ];
        let md = draftMd({ extra });
        const lockedKeys = new Set([call(ctx, 'lockTitleKey')('9. 고정 섹션 (⏱ 30분)')]);
        const plan = call(ctx, 'volumePlan');
        const spoken = call(ctx, 'spokenChars');
        const content = LABELS.map((minutes, i) => `${i + 1}. 내용 ${i + 1} (⏱ ${minutes}분)`);
        const fixed = call(ctx, 'mdSections')(md).filter(section => !content.includes(section.title)).reduce((sum, section) => sum + spoken(section.text), 0);
        const picks = [];
        for (let k = 1; k < 40; k++) {
            const next = plan(md, { goal: GOAL, lockedKeys });
            if (!next) break;
            picks.push(next.title);
            md = call(ctx, 'appendToSection')(md, next.index, `### ■ 보강 ${k}\n\n${filler(Math.round(next.need))}`);
        }
        assert.ok(picks.length >= 8 && picks.every(title => content.includes(title)), picks.join(' / '));
        assert.deepStrictEqual(picks.slice(0, 6).map(title => title.endsWith('(⏱ 60분)')), [true, true, true, true, true, true], '60분 섹션이 더 많이 모자라 먼저 고른다');
        assert.ok(spoken(md) >= GOAL);
        assert.strictEqual(plan(md, { goal: GOAL, lockedKeys }), null, '목표를 채우면 고르지 않는다');
        const budget = GOAL - fixed;
        content.forEach((title, i) => {
            const want = budget * LABELS[i] / 450;
            const got = spoken(sectionOf(ctx, md, t => t === title).text);
            assert.ok(Math.abs(got - want) < 60, `${title}: ${got} / ${want}`);
        });
    });

    await run('늘릴 섹션 고르기: 코드 차시에서 코드를 말로만 설명한 섹션은 목표를 채운 뒤에도 한 번 먼저 고른다', () => {
        const ctx = genContext();
        const md = draftMd({ body: 16000, sectionBody: i => (i === 2 ? `함수와 변수를 \`print()\`로 확인합니다. ${filler(16000)}` : filler(16000)) });
        assert.ok(call(ctx, 'spokenChars')(md) >= GOAL, '초안이 이미 목표를 넘는다');
        const plan = call(ctx, 'volumePlan');
        const first = plan(md, { goal: GOAL, codeTopic: true });
        assert.deepStrictEqual([first.title, first.needCode, first.codeSection, first.requestChars], ['3. 내용 3 (⏱ 45분)', true, true, 3000]);
        assert.strictEqual(plan(md, { goal: GOAL, codeTopic: true, codeTried: new Set([first.key]) }), null, '한 섹션에 한 번만');
        assert.strictEqual(plan(md, { goal: GOAL }), null, '코드 차시가 아니면 고르지 않는다');
    });

    await run('부탁 분량: 모자란 만큼을 받은 비율로 나눠 500자 단위로, 3,000~12,000자, 소주제 2~5개', () => {
        const ctx = genContext();
        const size = (need, ratio) => plain(call(ctx, 'volumeRequestSize')(need, ratio));
        assert.deepStrictEqual(size(14000, 0.7), { need: 14000, requestChars: 12000, subtopics: 5 });
        assert.deepStrictEqual(size(1500, 0.7), { need: 1500, requestChars: 3000, subtopics: 2 });
        assert.deepStrictEqual(size(4000, 0.5), { need: 4000, requestChars: 8000, subtopics: 3 });
    });

    /* ---------- 받은 글 다듬기 ---------- */
    await run('받은 글 다듬기: 제목을 ### ■ 소주제로 맞추고, 감싼 펜스·표시·그림 태그·mermaid·학습 틀·되풀이 소주제를 뺀다', () => {
        const ctx = genContext();
        const clean = (text, opts) => call(ctx, 'cleanVolumeAddition')(reply(text), opts);
        assert.strictEqual(clean('## 새 섹션 (⏱ 20분)\n\n새 본문입니다.'), '### ■ 새 섹션\n\n새 본문입니다.');
        assert.strictEqual(clean('# 새 큰 제목\n\n본문입니다.\n\n#### 세부\n\n세부 글입니다.'), '### ■ 새 큰 제목\n\n본문입니다.\n\n#### 세부\n\n세부 글입니다.', '#### 세부 항목은 그대로');
        assert.strictEqual(clean('### ■ 반복 원리\n\n원리 설명입니다.\n\n### ■ 학습 후 체크리스트\n\n- 확인합니다.'), '### ■ 반복 원리\n\n원리 설명입니다.');
        assert.strictEqual(clean('```markdown\n### ■ 감싼 소주제\n\n본문입니다.\n<!-- END -->\n```'), '### ■ 감싼 소주제\n\n본문입니다.');
        const repeated = clean('### ■ 이미 있는 소주제\n\n되풀이입니다.\n\n### ■ 새 소주제\n\n새 글입니다.\n\n### ■ 새 소주제\n\n두 번째입니다.', { sectionText: '## 1. 내용\n\n### ■ 이미 있는 소주제\n\n원래 글입니다.' });
        assert.strictEqual(repeated, '### ■ 새 소주제\n\n새 글입니다.', '섹션에 있던 소주제와 답 안에서 되풀이한 소주제');
        assert.strictEqual(clean('### ■ 그림 없는 소주제\n\n<!-- [IMG: "그림"] -->\n\n설명입니다.\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n```python\nx = 1\n```'), '### ■ 그림 없는 소주제\n\n설명입니다.\n\n```python\nx = 1\n```');
        assert.strictEqual(clean('### ■ 잘린 소주제\n\n첫 문단입니다.\n\n둘째 문단이 끊어', { truncated: true }), '### ■ 잘린 소주제\n\n첫 문단입니다.', '출력 한도에서 잘린 답은 마지막 빈 줄에서 자른다');
        assert.strictEqual(call(ctx, 'cleanVolumeAddition')(reply('### ■ 잘린 소주제\n\n첫 문단입니다.\n\n둘째 문단이 끊어', 'MAX_TOKENS')), '### ■ 잘린 소주제\n\n첫 문단입니다.', 'finishReason으로도 안다');
        assert.strictEqual(clean('### ■ 코드 소주제\n\n설명입니다.\n\n```python\nx = 1'), '### ■ 코드 소주제\n\n설명입니다.\n\n```python\nx = 1\n```', '닫지 않은 코드 블록은 닫는다');
        assert.strictEqual(clean('<!-- CONTINUE -->'), '');
    });

    await run('이어 붙이기: 섹션 끝의 <br> 간격 앞에 붙이고 다른 섹션은 그대로 둔다', () => {
        const ctx = genContext();
        const md = '## 1. 가 (⏱ 30분)\n\n본문입니다.\n\n<br>\n\n## 2. 나 (⏱ 30분)\n\n둘째입니다.';
        assert.strictEqual(call(ctx, 'appendToSection')(md, 0, '### ■ 새 소주제\n\n새 글입니다.'), '## 1. 가 (⏱ 30분)\n\n본문입니다.\n\n<br>\n\n### ■ 새 소주제\n\n새 글입니다.\n\n<br>\n\n## 2. 나 (⏱ 30분)\n\n둘째입니다.');
        assert.strictEqual(call(ctx, 'appendToSection')(md, 5, '### ■ 없음'), md, '없는 섹션이면 그대로');
    });

    await run('(⏱ N분) 다시 매기기: 내용 섹션만 낭독 길이에 맞추고 개요·고정·실습 라벨은 둔 채 합계를 목표 시간으로 맞춘다', () => {
        const ctx = genContext();
        const md = draftMd({ extra: [`## 9. 고정 섹션 (⏱ 30분)\n\n${filler(1000)}`, `## 4. 실습/예제 (⏱ 20분)\n\n${filler(1000)}`, `## 11. 라벨 없는 섹션\n\n${filler(2400)}`], sectionBody: i => filler(i === 0 ? 7200 : 2400) });
        const locked = new Set([call(ctx, 'lockTitleKey')('9. 고정 섹션 (⏱ 30분)')]);
        const out = call(ctx, 'retimeSections')(md, 480, locked);
        const minutes = call(ctx, 'volumeTitleMinutes');
        const titles = call(ctx, 'mdSections')(out).map(section => section.title);
        assert.strictEqual(call(ctx, 'volumeLabelSum')(out), 480);
        assert.ok(titles.includes('개요 (⏱ 10분)') && titles.includes('9. 고정 섹션 (⏱ 30분)') && titles.includes('4. 실습/예제 (⏱ 20분)'), titles.join(' / '));
        assert.ok(titles.some(title => /^11\. 라벨 없는 섹션 \(⏱ \d+분\)$/.test(title)), '라벨이 없으면 붙인다');
        const first = minutes(titles.find(title => title.startsWith('1. 내용 1')));
        const second = minutes(titles.find(title => title.startsWith('2. 내용 2')));
        assert.ok(first > second * 2.5 && titles.every(title => !minutes(title) || minutes(title) % 5 === 0), `${first} / ${second}`);
        assert.deepStrictEqual(titleKeys(ctx, out), titleKeys(ctx, md), '제목 키(고정·체크리스트 대응)는 그대로');
    });

    /* ---------- 분량 채우기 ---------- */
    await run('분량 채우기: 부탁의 75%만 쓰는 모델로도 24번 안에 목표에 닿고, 학습 틀과 고정 섹션은 그대로, 라벨 합계는 480분', async () => {
        const ctx = genContext();
        const lockedText = `## 9. 고정 섹션 (⏱ 30분)\n\n${filler(1200)}`;
        const md = draftMd({ extra: [lockedText] });
        const controller = new AbortController();
        ctx.callGemini = volumeModel(ctx, { deliver: 0.75 });
        const result = await ensure(ctx)({ md, lockedBlocks: [{ title: '9. 고정 섹션 (⏱ 30분)', text: lockedText }], waitSignal: controller.signal });
        assert.ok(result.spoken >= GOAL && result.calls <= 24, `${result.spoken}자 · ${result.calls}번`);
        assert.deepStrictEqual([result.short, result.stopped, result.gone, result.reason, result.added], [false, false, false, 'target', result.calls]);
        assert.strictEqual(result.spoken, call(ctx, 'spokenChars')(result.md));
        assert.deepStrictEqual(titleKeys(ctx, result.md), titleKeys(ctx, md), '## 제목의 순서와 이름이 그대로');
        const before = call(ctx, 'mdSections')(md);
        const after = call(ctx, 'mdSections')(result.md);
        ['학습 목표', '개요 (⏱ 10분)', '9. 고정 섹션 (⏱ 30분)', '✅ 학습 후 체크리스트'].forEach(title => {
            assert.strictEqual(after.find(section => section.title === title)?.text, before.find(section => section.title === title).text, title);
        });
        assert.strictEqual(after.at(-1).title, '✅ 학습 후 체크리스트', '체크리스트는 맨 끝');
        ctx.sections.forEach(({ k, sectionTitle }) => {
            const home = after.find(section => section.text.includes(`### ■ 보강 ${k}\n`));
            assert.ok(home && call(ctx, 'lockTitleKey')(home.title) === call(ctx, 'lockTitleKey')(sectionTitle), `보강 ${k}는 ${sectionTitle} 안에`);
        });
        assert.strictEqual(call(ctx, 'volumeLabelSum')(result.md), 480, '개요 10분과 고정 30분을 포함해 480분');
        const asked = ctx.payloads.filter(payload => payload.contents[0].parts[0].text.startsWith('volume_expand'));
        assert.ok(asked.length === result.calls && asked.every(payload => payload.waitSignal === controller.signal && !('signal' in payload) && payload.generationConfig.maxOutputTokens === 65536 && payload.timing === 'long'));
        assert.ok(ctx.sections.every(item => item.filling), '채우는 동안은 창을 닫기 전에 묻는다');
        assert.strictEqual(call(ctx, 'isVolumeFilling')(), false, '끝나면 묻지 않는다');
        assert.ok(ctx.waits.filter(ms => ms === 1500).length === result.calls - 1, '호출 사이를 둔다(첫 호출 앞은 두지 않는다)');
    });

    await run('분량 채우기: 잇달아 늘지 않으면 두 번 만에, 늘어도 모자라면 호출 상한(480분이면 24번)에서 멈추고 받은 글은 남긴다', async () => {
        const md = draftMd();
        const stall = genContext();
        stall.callGemini = volumeModel(stall, { replyFor: k => reply(`### ■ 짧은 보강 ${k}\n\n${filler(500)}`) });
        const stalled = await ensure(stall)({ md });
        assert.deepStrictEqual([stalled.calls, stalled.added, stalled.reason, stalled.short], [2, 0, 'stall', true]);
        const cap = genContext();
        cap.callGemini = volumeModel(cap, { replyFor: k => reply(`### ■ 보강 ${k}\n\n${filler(3000)}`) });
        const capped = await ensure(cap)({ md });
        assert.deepStrictEqual([capped.calls, capped.added, capped.reason, capped.short], [24, 24, 'cap', true]);
        assert.ok(capped.spoken > call(cap, 'spokenChars')(md) + 24 * 2900);
        const long = genContext();
        long.callGemini = volumeModel(long, { replyFor: k => reply(`### ■ 보강 ${k}\n\n${filler(3000)}`) });
        assert.strictEqual((await ensure(long)({ md, targetMinutes: 600 })).calls, 30, '600분이면 30번');
    });

    await run('분량 채우기: 뒤의 ## 섹션을 코드 블록으로 삼키는 답은 제목 검사에서 버리고 늘지 않은 것으로 센다', async () => {
        const ctx = genContext();
        const md = draftMd();
        ctx.callGemini = volumeModel(ctx, { replyFor: k => reply(`### ■ 삼키는 소주제 ${k}\n\n${filler(1500)}\n\n\`\`\`python\nx = 1\n\`\`\` 끝\n\n${filler(1500)}`) });
        const result = await ensure(ctx)({ md });
        assert.deepStrictEqual([result.calls, result.added, result.reason], [2, 0, 'stall']);
        assert.deepStrictEqual(titleKeys(ctx, result.md), titleKeys(ctx, md));
        assert.ok(!result.md.includes('삼키는 소주제'));
    });

    await run('분량 채우기: 중지하면 받던 답까지 붙이고 다음 호출을 하지 않으며 (⏱)를 다시 매기지 않는다. 기다리는 중 중지도 멈춘다', async () => {
        const md = draftMd();
        const ctx = genContext();
        call(ctx, 'resetTabGenStop')();
        ctx.callGemini = volumeModel(ctx, { onCall: k => { if (k === 2) call(ctx, 'requestTabGenerationStop')(); } });
        const result = await ensure(ctx)({ md, isStopped: () => call(ctx, 'isTabGenerationStopped')(), waitSignal: call(ctx, 'aiStopSignal')() });
        assert.deepStrictEqual([result.calls, result.added, result.stopped, result.reason], [2, 2, true, 'stopped']);
        assert.strictEqual(call(ctx, 'volumeLabelSum')(result.md), call(ctx, 'volumeLabelSum')(md), '라벨은 그대로');
        assert.ok(result.md.includes('### ■ 보강 2'), '받던 답은 붙인다');

        const cool = genContext();
        const controller = new AbortController();
        cool.holdTimers = true;
        cool.callGemini = volumeModel(cool, {});
        const pending = ensure(cool)({ md, waitSignal: controller.signal });
        await waitFor(() => cool.waits.includes(1500), '호출 사이 기다림');
        controller.abort();
        const waited = await pending;
        assert.deepStrictEqual([waited.calls, waited.stopped, waited.reason], [1, true, 'stopped']);
        assert.strictEqual(volumePrompts(cool).length, 1, '다음 호출을 하지 않는다');
    });

    await run('분량 채우기: 하루 한도는 던지지 않고 바로 멈춰 받은 글을 남기고, 잠깐의 오류는 30초 뒤 같은 섹션을 한 번 더 부른다', async () => {
        const md = draftMd();
        const quota = genContext();
        quota.callGemini = volumeModel(quota, { onCall: k => { if (k === 3) throw daily(); } });
        const halted = await ensure(quota)({ md });
        assert.deepStrictEqual([halted.calls, halted.added, halted.reason, halted.error?.quota, halted.short], [3, 2, 'error', 'daily', true]);
        assert.ok(halted.md.includes('### ■ 보강 1') && halted.md.includes('### ■ 보강 2'));
        assert.ok(!quota.waits.includes(30000), '한도는 기다려도 풀리지 않는다');
        const busy = genContext();
        busy.callGemini = volumeModel(busy, { onCall: k => { if (k === 2) throw Object.assign(new Error('AI 서버가 잠시 바쁩니다(503).'), { status: 503 }); } });
        const retried = await ensure(busy)({ md });
        assert.ok(busy.waits.includes(30000), '30초 기다린다');
        assert.strictEqual(busy.sections[2].sectionTitle, busy.sections[1].sectionTitle, '같은 섹션을 다시 부른다');
        assert.deepStrictEqual([retried.reason, retried.short, retried.error], ['target', false, null]);
        const twice = genContext();
        twice.callGemini = volumeModel(twice, { onCall: k => { if (k >= 2) throw Object.assign(new Error('바쁩니다'), { status: 503 }); } });
        const gaveUp = await ensure(twice)({ md });
        assert.deepStrictEqual([gaveUp.calls, gaveUp.reason, gaveUp.error?.status], [3, 'error', 503], '두 번째 실패에서 멈춘다');
    });

    await run('분량 채우기: 코드 차시는 코드 예제를 부탁하고, 예제를 받으면 그 섹션의 예제 없음 지적이 사라진다', async () => {
        const ctx = genContext();
        const md = draftMd({ body: 16000, sectionBody: i => (i === 2 ? `함수와 변수를 \`print()\`로 확인합니다. ${filler(16000)}` : filler(16000)) });
        const lint = text => plain(call(ctx, 'lintLessonMarkdown')(text, 'basicLearn', { codeTopic: true })).filter(issue => issue.msg === '코드를 설명하면 예제 코드 블록을 함께 둡니다.').map(issue => issue.where);
        assert.deepStrictEqual(lint(md), ['3. 내용 3 (⏱ 45분)']);
        ctx.callGemini = volumeModel(ctx, { replyFor: (k, ask) => reply(`### ■ 합계 예제 ${k}\n\n점수의 합을 구하는 코드입니다.\n\n\`\`\`python\ntotal = 0\nfor n in [1, 2, 3]:\n    total += n\nprint(total)\n\`\`\`\n\n- 3행: 값을 하나씩 더합니다.${ask.code ? '' : ' 코드 없음.'}`) });
        const result = await ensure(ctx)({ md, mod: { id: 1, title: 'Python 반복문' }, codeTopic: true });
        assert.deepStrictEqual([result.calls, result.added, result.reason], [1, 1, 'target'], '한 번만 부탁한다');
        assert.ok(volumePrompts(ctx)[0].includes('|3. 내용 3 (⏱ 45분)|3000|code'), volumePrompts(ctx)[0].slice(0, 80));
        assert.deepStrictEqual(lint(result.md), [], '예제를 받은 섹션은 지적이 없다');
        const noCode = genContext();
        noCode.callGemini = volumeModel(noCode, { replyFor: k => reply(`### ■ 말로만 ${k}\n\n${filler(1500)}`) });
        const once = await ensure(noCode)({ md, mod: { id: 1, title: 'Python 반복문' }, codeTopic: true });
        assert.strictEqual(once.calls, 1, '예제가 오지 않아도 한 섹션에 한 번만');
    });

    /* ---------- 탭 생성 ---------- */
    await run('탭 생성: 기본학습은 초안 → 분량 보강 순서로 부르고, 저장한 탭은 낭독 480분을 넘고, 진행 문구와 끝 알림에 낭독 분량을 보인다', async () => {
        const mod = { ...MOD, tabContents: {} };
        const ctx = genContext();
        ctx.currentMod = mod;
        const statuses = [];
        ctx.callGemini = volumeModel(ctx, { draft: `${draftMd()}\n<!-- END -->` });
        const result = plain(await call(ctx, 'generateTabContent')(1, 'basicLearn', { onStatus: text => statuses.push(text) }));
        assert.deepStrictEqual(result, { ok: true, partial: false });
        const order = ctx.prompts.map(text => text.split('|')[0]);
        assert.strictEqual(order[0], 'tab_content');
        assert.ok(order.length > 5 && order.slice(1).every(task => task === 'volume_expand'), order.join(','));
        const saved = mod.tabContents.basicLearn;
        assert.ok(call(ctx, 'spokenChars')(saved) >= TARGET_CHARS);
        assert.ok(statuses.some(text => text.includes('낭독 약') && text.includes('/480분') && text.includes('보강 1/24회')), statuses.find(text => text.includes('낭독')));
        assert.ok(ctx.alerts.at(-1).includes('낭독 약') && ctx.alerts.at(-1).includes('(목표 480분)'), ctx.alerts.at(-1));
        assert.deepStrictEqual([ctx.imageCalls, ctx.imageOpts.inject], [1, false], '그림 자리는 초안에만 미리 넣었으므로 더 넣지 않는다');
        assert.ok(saved.includes('<!-- [IMG: "1. 내용 1 (⏱ '), '초안의 ## 섹션에 그림 자리를 넣었다');
        assert.strictEqual(call(ctx, 'volumeLabelSum')(saved), 480);
    });

    await run('탭 생성: 필수 지적이 있으면 분량을 채운 뒤에만 고치고, 기본학습이 아니거나 최종 평가·이어쓰기 실패면 분량을 채우지 않는다', async () => {
        const mod = { ...MOD, tabContents: {} };
        const ctx = genContext();
        ctx.currentMod = mod;
        ctx.callGemini = volumeModel(ctx, { draft: draftMd({ sectionBody: i => (i === 0 ? `앞에서 다룬 반복입니다. ${filler(2400)}` : filler(2400)) }) });
        await call(ctx, 'generateTabContent')(1, 'basicLearn', { quiet: true });
        const order = ctx.prompts.map(text => (text.startsWith('[작업]') ? '[작업]' : text.split('|')[0]));
        const fixAt = order.indexOf('[작업]');
        assert.ok(fixAt > order.lastIndexOf('volume_expand') && order.lastIndexOf('volume_expand') > 0, order.join(','));
        const prac = genContext();
        prac.currentMod = { id: 1, title: '실습', tabContents: {} };
        prac.callGemini = volumeModel(prac, { draft: '## 1. 반복 실습 (⏱ 60분)\n\n실습합니다.' });
        await call(prac, 'generateTabContent')(1, 'basicPrac', { quiet: true });
        const quest = genContext();
        quest.currentMod = { id: 'mainQuest', title: '👑 최종 평가', tabContents: {} };
        quest.callGemini = volumeModel(quest, { draft: '## 최종 과제\n\n과제입니다.' });
        await call(quest, 'generateTabContent')('mainQuest', 'basicLearn', { quiet: true });
        const part = genContext();
        part.currentMod = { ...MOD, tabContents: {} };
        let calls = 0;
        part.callGemini = async (model, payload) => {
            part.prompts.push(payload.contents[0].parts[0].text);
            calls += 1;
            if (calls === 1) return reply(`${draftMd()}\n<!-- CONTINUE -->`);
            throw Object.assign(new Error('status: 429'), { status: 429 });
        };
        const partial = plain(await call(part, 'generateTabContent')(1, 'basicLearn', { quiet: true }));
        assert.strictEqual(partial.partial, true);
        [prac, quest, part].forEach(item => assert.strictEqual(volumePrompts(item).length, 0));
    });

    await run('탭 생성: 분량 채우기가 하루 한도에 걸리면 받은 글을 저장하고 고치기·그림 없이 한도 안내를 창으로 알리며, 일괄 생성을 멈추게 한다', async () => {
        const mod = { ...MOD, tabContents: {} };
        const ctx = genContext();
        ctx.currentMod = mod;
        ctx.callGemini = volumeModel(ctx, { draft: draftMd({ sectionBody: i => (i === 0 ? `앞에서 다룬 반복입니다. ${filler(2400)}` : filler(2400)) }), onCall: k => { if (k === 2) throw daily(); } });
        const result = plain(await call(ctx, 'generateTabContent')(1, 'basicLearn'));
        assert.deepStrictEqual([result.ok, result.partial, result.short, result.halt, result.error, result.targetMinutes], [true, false, true, true, DAILY_MESSAGE, 480]);
        assert.ok(result.readMinutes > 0 && result.readMinutes < 480);
        assert.ok(mod.tabContents.basicLearn.includes('### ■ 보강 1'), '받은 보강은 저장한다');
        assert.ok(!ctx.prompts.some(text => text.startsWith('[작업]')), '고치기도 같은 까닭으로 실패하므로 부르지 않는다');
        assert.strictEqual(ctx.imageCalls, 0);
        assert.ok(ctx.alerts.at(-1).includes(DAILY_MESSAGE) && ctx.alerts.at(-1).includes('낭독 약') && ctx.alerts.at(-1).includes("'분량 채우기'"), ctx.alerts.at(-1));

        const batch = genContext();
        batch.currentMod = { ...MOD, tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null } };
        batch.callGemini = volumeModel(batch, { draft: draftMd(), onCall: k => { if (k === 1) throw daily(); } });
        const filled = plain(await call(batch, 'fillMissingTabs')(1));
        assert.deepStrictEqual([filled.ok, filled.halt, filled.short, filled.error], [false, true, true, DAILY_MESSAGE]);
        assert.ok(!batch.prompts.some(text => text.startsWith('tab_content|basicPrac')), '다음 탭으로 가지 않는다');
        const item = { lessonId: 1, title: '반복과 합계', subject: { id: 's1', title: '교과' } };
        const report = plain(await call(batch, 'runLessonQueue')([item, { ...item, lessonId: 2 }], async () => filled));
        assert.deepStrictEqual([report.halted, report.stopped, report.failed.length, report.left.length, report.short.length], [true, true, 1, 1, 1]);
        assert.strictEqual(report.short[0].readMinutes, filled.readMinutes);
        const html = call(batch, 'lessonRunReportHtml')(report);
        assert.ok(html.includes('기본 학습 분량이 목표에 못 미친 차시 1개') && html.includes(`낭독 약 ${filled.readMinutes}분`) && html.includes("'분량 채우기'"), html);
    });

    await run('탭 생성: 분량 채우기 중에 중지하면 받은 데까지 저장하고 고치기·그림 없이 중단을 알린다', async () => {
        const mod = { ...MOD, tabContents: {} };
        const ctx = genContext();
        ctx.currentMod = mod;
        ctx.callGemini = volumeModel(ctx, { draft: draftMd({ sectionBody: i => (i === 0 ? `앞에서 다룬 반복입니다. ${filler(2400)}` : filler(2400)) }), onCall: k => { if (k === 1) call(ctx, 'requestTabGenerationStop')(); } });
        const result = plain(await call(ctx, 'generateTabContent')(1, 'basicLearn'));
        assert.deepStrictEqual([result.ok, result.partial, result.short, result.halt], [true, true, true, undefined]);
        assert.strictEqual(volumePrompts(ctx).length, 1);
        assert.ok(!ctx.prompts.some(text => text.startsWith('[작업]')));
        assert.strictEqual(ctx.imageCalls, 0);
        assert.ok(mod.tabContents.basicLearn.includes('### ■ 보강 1'));
        assert.ok(ctx.alerts.at(-1).includes('중단했습니다') && ctx.alerts.at(-1).includes('낭독 약'), ctx.alerts.at(-1));
    });

    await run('탭 다시 만들기: 분량 채우기를 멈춘 글은 미리보기에 그렇다고 적고, 마지막 섹션도 기본으로 고르며, 이전 글은 작업 기록에 남긴다', async () => {
        const previous = '## 학습 목표\n\n- 이전에 쓴 목표입니다.\n\n## 1. 이전 섹션 (⏱ 60분)\n\n이전에 완성한 글입니다.';
        const mod = { ...MOD, tabContents: { basicLearn: previous } };
        const ctx = genContext();
        ctx.currentMod = mod;
        ctx.callGemini = volumeModel(ctx, { draft: draftMd(), onCall: k => { if (k === 2) call(ctx, 'requestTabGenerationStop')(); } });
        let note = '';
        ctx.onOverlay = overlay => setImmediate(() => {
            note = overlay.innerHTML;
            overlay.fire('click', { target: { dataset: { diffAction: 'apply' } } });
        });
        const result = plain(await call(ctx, 'generateTabContent')(1, 'basicLearn'));
        assert.deepStrictEqual([result.ok, result.partial, result.short], [true, true, true]);
        assert.ok(note.includes('분량 채우기를 중간에 멈춘 글입니다(낭독 약 ') && note.includes('/목표 480분).'), note.slice(0, 400));
        assert.ok(mod.tabContents.basicLearn.includes('### ■ 보강 2'), '고른 글에 보강이 들어 있다');
        assert.ok(mod.tabContents.basicLearn.includes('✅ 학습 후 체크리스트'), '마지막 섹션도 골랐다');
        assert.deepStrictEqual(ctx.archived.map(item => [item.tabId, item.reason, item.content]), [['basicLearn', '다시 생성 전', previous]]);
    });

    await run('탭 생성: 채우는 동안 다른 교과로 옮겨도 시작한 차시에만 쓰고 그 교과 자료를 섞지 않는다. 차시가 지워지면 멈추고 쓰지 않는다', async () => {
        const mod = { ...MOD, tabContents: {} };
        const otherMod = { id: 1, title: '다른 교과 차시', tabContents: { basicLearn: '## 그대로\n\n다른 교과 글입니다.' } };
        const s1 = { id: 's1', title: '교과1', referenceText: '교과1 참고 자료입니다.', lessons: [mod] };
        const s2 = { id: 's2', title: '교과2', referenceText: '교과2 참고 자료입니다.', lessons: [otherMod] };
        const ctx = genContext();
        Object.assign(ctx, { currentMod: mod, globalState: { subjects: [s1, s2] }, currentSubjectId: 's1', courseData: s1.lessons });
        ctx.callGemini = volumeModel(ctx, { draft: draftMd(), onCall: k => { if (k === 2) Object.assign(ctx, { currentSubjectId: 's2', courseData: s2.lessons, currentMod: otherMod }); } });
        const result = plain(await call(ctx, 'generateTabContent')(1, 'basicLearn', { quiet: true }));
        assert.deepStrictEqual(result, { ok: true, partial: false });
        assert.ok(call(ctx, 'spokenChars')(mod.tabContents.basicLearn) >= TARGET_CHARS, '시작한 차시에 저장한다');
        assert.strictEqual(otherMod.tabContents.basicLearn, '## 그대로\n\n다른 교과 글입니다.');
        assert.ok(volumePrompts(ctx).length > 2 && volumePrompts(ctx).every(text => text.includes('교과1 참고 자료입니다.') && !text.includes('교과2 참고 자료입니다.')));

        const gone = { ...MOD, tabContents: {} };
        const g1 = { id: 's1', title: '교과1', lessons: [gone] };
        const removing = genContext();
        Object.assign(removing, { currentMod: gone, globalState: { subjects: [g1] }, currentSubjectId: 's1', courseData: g1.lessons });
        removing.callGemini = volumeModel(removing, { draft: draftMd(), onCall: k => { if (k === 2) removing.courseData.splice(0, 1); } });
        const stopped = plain(await call(removing, 'generateTabContent')(1, 'basicLearn', { quiet: true }));
        assert.strictEqual(stopped.ok, false);
        assert.ok(stopped.error.includes('지워졌거나'), stopped.error);
        assert.strictEqual(volumePrompts(removing).length, 2, '더 부르지 않는다');
        assert.ok(!gone.tabContents.basicLearn, '쓰지 않는다');
    });

    /* ---------- 교안 전체 생성 ---------- */
    await run('교안 전체 생성: 초안 → 분량 보강 뒤 남은 탭 생성으로 이어지고, 청크 끝의 코드 블록 닫는 펜스는 남는다. 하루 한도면 저장하고 한 번만 알린 뒤 멈춘다', async () => {
        const body = `${draftMd()}\n\n## 9. 출력 확인 (⏱ 30분)\n\n출력을 확인합니다.\n\n\`\`\`python\ntotal = 6\nprint(total)\n\`\`\``;
        const mod = { id: 7, title: '반복과 합계', description: '합계를 구합니다.', status: 'waiting' };
        const ctx = genContext();
        ctx.currentMod = mod;
        ctx.runLessonPipeline = async (...args) => { ctx.pipelineCalls.push(plain(args)); };
        ctx.callGemini = volumeModel(ctx, { draft: body });
        await call(ctx, 'generateModuleContent')(7, []);
        const order = ctx.prompts.map(text => text.split('|')[0]);
        assert.ok(order[0] === 'module' && order.length > 5 && order.slice(1).every(task => task === 'volume_expand'), order.join(','));
        const saved = mod.tabContents.basicLearn;
        assert.ok(call(ctx, 'spokenChars')(saved) >= TARGET_CHARS);
        assert.ok(saved.includes('print(total)\n```'), '코드 블록을 닫는 펜스를 지우지 않는다');
        assert.ok(saved.trim().endsWith('(다시 보기: 2. 내용 2)'), '체크리스트는 맨 끝');
        assert.deepStrictEqual(ctx.pipelineCalls.map(([id, opts]) => [id, opts.continuing, opts.shortNote]), [[7, true, '']]);
        assert.ok(ctx.payloads.slice(0, 1).every(payload => payload.generationConfig?.maxOutputTokens === 65536 && !payload.waitSignal), '초안 호출은 받던 글을 끊지 않는다');

        const quotaMod = { id: 8, title: '반복과 합계', description: '합계를 구합니다.', status: 'waiting' };
        const quota = genContext();
        quota.currentMod = quotaMod;
        quota.runLessonPipeline = async (...args) => { quota.pipelineCalls.push(args); };
        quota.callGemini = volumeModel(quota, { draft: body, onCall: k => { if (k === 2) throw daily(); } });
        await call(quota, 'generateModuleContent')(8, []);
        assert.ok(quotaMod.tabContents.basicLearn.includes('### ■ 보강 1'), '받은 글은 저장한다');
        assert.strictEqual(quota.alerts.length, 1, quota.alerts.join(' | '));
        assert.ok(quota.alerts[0].includes(DAILY_MESSAGE) && quota.alerts[0].includes('낭독 약'), quota.alerts[0]);
        assert.strictEqual(quota.pipelineCalls.length, 0, '남은 탭은 만들지 않는다');
        assert.strictEqual(quota.imageCalls, 0);
    });

    /* ---------- 일괄 생성·전체 생성 ---------- */
    await run('전체 생성: 분량 채우기가 한도로 멈추면 남은 항목을 만들지 않고, 모자란 기본학습을 끝 알림에 적는다', async () => {
        const ctx = genContext();
        const lesson = { id: 1, title: '반복과 합계', tabContents: {} };
        Object.assign(ctx, { currentMod: lesson, globalState: { subjects: [{ id: 's1', title: '교과', lessons: [lesson] }] }, currentSubjectId: 's1' });
        ctx.courseData = ctx.globalState.subjects[0].lessons;
        const order = [];
        ctx.generateTabContent = async (id, tabId) => {
            order.push(tabId);
            lesson.tabContents[tabId] = `## ${tabId}\n\n- 내용입니다.`;
            return tabId === 'basicLearn' ? { ok: true, partial: false, short: true, readMinutes: 300, targetMinutes: 480, halt: true, error: DAILY_MESSAGE } : { ok: true };
        };
        await call(ctx, 'runLessonPipeline')(1);
        assert.deepStrictEqual(order, ['basicLearn']);
        const alert = ctx.alerts.at(-1);
        ['기본학습 분량 채우기: 오늘 쓸 수 있는', '같은 까닭으로 남은 항목은 만들지 않았습니다.', '기본 학습 분량이 목표에 못 미친 항목: 기본학습(낭독 약 300분/목표 480분)', "'분량 채우기'"].forEach(text => assert.ok(alert.includes(text), `${text}\n${alert}`));
        order.length = 0;
        ctx.generateTabContent = async (id, tabId) => { order.push(tabId); return tabId === 'basicLearn' ? { ok: true, short: true, readMinutes: 410, targetMinutes: 480 } : { ok: true }; };
        lesson.tabContents = {};
        await call(ctx, 'runLessonPipeline')(1);
        assert.deepStrictEqual(order.slice(0, 5), ['basicLearn', 'basicPrac', 'advLearn', 'advPrac', 'assessment'], '모자라기만 하면 이어서 만든다');
        assert.ok(ctx.alerts.at(-1).includes('기본학습(낭독 약 410분/목표 480분)') && !ctx.alerts.at(-1).includes('내용이 빠진 탭은'), ctx.alerts.at(-1));
    });

    await run('교안 탭 모두 다시 만들기: 한도로 멈추면 남은 탭을 부르지 않고 알리며, 모자란 기본학습을 알린다', async () => {
        const ctx = genContext();
        const lesson = { id: 1, title: '반복과 합계', tabContents: {} };
        ctx.currentMod = lesson;
        const order = [];
        ctx.generateTabContent = async (id, tabId) => { order.push(tabId); return { ok: true, short: true, readMinutes: 300, targetMinutes: 480, halt: true, error: DAILY_MESSAGE }; };
        await call(ctx, 'generateAllTabs')(1);
        assert.deepStrictEqual(order, ['basicLearn']);
        assert.ok(ctx.alerts.at(-1).startsWith(DAILY_MESSAGE) && ctx.alerts.at(-1).includes('기본학습(낭독 약 300분)'), ctx.alerts.at(-1));
        order.length = 0;
        ctx.generateTabContent = async (id, tabId) => { order.push(tabId); return tabId === 'basicLearn' ? { ok: true, short: true, readMinutes: 420, targetMinutes: 480 } : { ok: true }; };
        await call(ctx, 'generateAllTabs')(1);
        assert.strictEqual(order.length, 5);
        assert.ok(ctx.toasts.at(-1).message.includes('기본학습(낭독 약 420분)') && ctx.toasts.at(-1).kind === 'warning', JSON.stringify(ctx.toasts.at(-1)));
    });

    await run('일괄 생성 안내: 기본학습 분량 때문에 오래 걸린다고 알린다', () => {
        const ctx = genContext();
        assert.ok(call(ctx, 'lessonRunIntroHtml')([], [], false).includes('기본 학습은 낭독 480분 분량을 채우느라 차시마다 20분 넘게 걸릴 수 있습니다.'));
        const plainReport = call(ctx, 'lessonRunReportHtml')({ done: [], partial: [], failed: [], left: [], stopped: false });
        assert.ok(!plainReport.includes('분량'), '모자란 차시가 없으면 그 줄도 없다');
    });

    /* ---------- 자동 수정 ---------- */
    await run('자동 수정: 분량을 채운 글은 세 번까지 고쳐 받고, 낭독 글자가 목표 아래로 줄어든 수정은 버린다. 기본은 한 번', async () => {
        const doc = [
            '## 학습 목표\n\n- 반복문으로 합계를 구하는 코드를 작성할 수 있습니다.',
            '## 개요\n\n- 값을 하나씩 더해야 하는 상황입니다.',
            ...[1, 2, 3].map(no => `## ${no}. 내용 ${no}\n\n${filler(40300)} 앞에서 다룬 반복입니다.`),
            '## ✅ 학습 후 체크리스트\n\n- 합계를 구했습니다. (다시 보기: 1. 내용 1)'
        ].join('\n\n');
        const fixOne = text => reply(text.split('[고칠 섹션]\n')[1].replace('앞에서 다룬', '이 절에서 다룬'));
        const ctx = genContext();
        assert.ok(Math.abs(call(ctx, 'spokenChars')(doc) - 121000) < 1500, String(call(ctx, 'spokenChars')(doc)));
        const statuses = [];
        ctx.callGemini = volumeModel(ctx, { fixReply: fixOne });
        const fixed = await call(ctx, 'autoFixGeneratedTab')({ tabId: 'basicLearn', md: doc, rounds: 3, minSpokenChars: TARGET_CHARS, onStatus: text => statuses.push(text) });
        assert.strictEqual(ctx.prompts.length, 3, '한 번에 한 섹션씩 세 번');
        assert.ok(!fixed.includes('앞에서'), '세 섹션을 모두 고쳤다');
        assert.deepStrictEqual(statuses, ['🔍 컨벤션 필수 지적 3건을 고치고 있습니다... (1/3)', '🔍 컨벤션 필수 지적 2건을 고치고 있습니다... (2/3)', '🔍 컨벤션 필수 지적 1건을 고치고 있습니다... (3/3)']);
        assert.strictEqual(ctx.toasts.filter(item => item.message.includes('자동으로 고쳤습니다')).length, 1, '알림은 한 번');
        const shrink = genContext();
        shrink.callGemini = volumeModel(shrink, { fixReply: text => { const part = fixOne(text).candidates[0].content.parts[0].text; return reply(part.slice(0, Math.floor(part.length * 0.8))); } });
        assert.strictEqual(await call(shrink, 'autoFixGeneratedTab')({ tabId: 'basicLearn', md: doc, rounds: 3, minSpokenChars: TARGET_CHARS }), doc, '120,000자 아래로 줄인 수정은 쓰지 않는다');
        assert.strictEqual(shrink.prompts.length, 1, '그리고 멈춘다');
        const once = genContext();
        once.callGemini = volumeModel(once, { fixReply: fixOne });
        await call(once, 'autoFixGeneratedTab')({ tabId: 'basicLearn', md: doc });
        assert.strictEqual(once.prompts.length, 1, '기본은 한 번');
        const stopping = genContext();
        stopping.callGemini = volumeModel(stopping, { fixReply: fixOne });
        await call(stopping, 'autoFixGeneratedTab')({ tabId: 'basicLearn', md: doc, rounds: 3, isStopped: () => true });
        assert.strictEqual(stopping.prompts.length, 1, '중지하면 다음 회차를 부르지 않는다');
    });

    /* ---------- 과정 설계 지시 ---------- */
    await run('과정 설계 지시: 기본학습은 차시 시간으로 줄이지 않고 진행 단계는 순서만 참고하며 섹션당 분량 옵션을 넣지 않는다. 다른 탭과 교수안은 그대로', () => {
        const brief = call(pure, 'lessonDesignBrief');
        const lesson = { minutes: 120, hours: 2, flow: [{ phase: '도입', title: '시작', minutes: 10 }] };
        const learn = brief(lesson, 'basicLearn');
        assert.ok(!learn.includes('비례해 줄이세요') && !learn.includes('(10분)') && learn.includes('낭독 480분') && learn.includes('120,000자') && learn.includes('[진행 단계 — 내용 순서만 참고합니다]'), learn);
        const gyosuan = brief(lesson);
        assert.ok(gyosuan.includes('120분') && gyosuan.includes('비례해 줄이세요') && gyosuan.includes('(10분)') && gyosuan.includes('[진행 단계]\n'), gyosuan);
        assert.strictEqual(brief(lesson, 'basicPrac'), gyosuan);
        assert.ok(brief({ minutes: 600, hours: 10 }, 'basicLearn').includes('낭독 600분(공백 포함 약 150,000자)'));
        const gen = { gen: { length: '길게 (약 1,500자)', level: '실무 경험자' } };
        assert.ok(!call(pure, 'lessonGenBrief')(gen, 'basicLearn').includes('섹션 하나당 분량') && call(pure, 'lessonGenBrief')(gen, 'basicLearn').includes('실무 경험자'));
        assert.ok(call(pure, 'lessonGenBrief')(gen, 'basicPrac').includes('섹션 하나당 분량: 길게 (약 1,500자)'));
        assert.ok(call(pure, 'lessonGenFieldsHtml')('run').includes('섹션당 분량(기본 학습 제외)'));
    });

    /* ---------- 탭 위 표시와 분량 채우기 ---------- */
    await run("탭 위 표시: 기본학습이 모자라면 '분량 채우기' 버튼을 보이고, 다 차면 버튼이 없으며, 다른 탭·옆 화면·최종 평가에서는 숨긴다", () => {
        const ctx = genContext();
        const chip = ctx.elements['lesson-volume-chip'];
        const short = { id: 3, title: '반복', tabContents: { basicLearn: `## 1. 내용 (⏱ 60분)\n\n${filler(75000)}` } };
        vm.runInContext("currentLessonTab = 'basicLearn'; _lessonPanel = null;", ctx);
        call(ctx, 'syncVolumeChip')(short);
        assert.ok(chip.className.includes('amber') && chip.innerHTML.includes('낭독 약 300분 / 목표 480분') && chip.innerHTML.includes('data-volume-lesson="3"') && chip.innerHTML.includes('분량 채우기'), chip.innerHTML);
        assert.ok(chip.title.includes('1분에 250자'));
        const full = { id: 4, title: '반복', tabContents: { basicLearn: `## 1. 내용 (⏱ 480분)\n\n${filler(121000)}` } };
        call(ctx, 'syncVolumeChip')(full);
        assert.ok(chip.className.includes('emerald') && !chip.innerHTML.includes('<button'), chip.innerHTML);
        vm.runInContext("_lessonPanel = 'gyosuan';", ctx);
        call(ctx, 'syncVolumeChip')(short);
        assert.strictEqual(chip.className, 'hidden', '교수안 화면');
        vm.runInContext("_lessonPanel = null; currentLessonTab = 'basicPrac';", ctx);
        call(ctx, 'syncVolumeChip')(short);
        assert.strictEqual(chip.className, 'hidden', '다른 탭');
        vm.runInContext("currentLessonTab = 'basicLearn';", ctx);
        call(ctx, 'syncVolumeChip')({ ...short, id: 'mainQuest' });
        assert.strictEqual(chip.className, 'hidden', '최종 평가');
        ctx.currentMod = short;
        call(ctx, 'syncReviewBadge')(short);
        assert.ok(chip.className.includes('amber'), '검수 배지를 셀 때 함께 센다');
        const panel = call(ctx, 'reviewPanelHtml')(short, 'basicLearn', short.tabContents.basicLearn, false);
        assert.ok(panel.includes(' · 낭독 약 300분(목표 480분)'), '검수 패널에도 보인다');
    });

    await run("분량 채우기 버튼: 호출 수·시간을 묻고, 채운 뒤 바뀐 섹션을 골라 반영하며 이전 글은 작업 기록에 남긴다. 그사이 탭이 바뀌면 반영하지 않는다", async () => {
        const start = draftMd();
        const mod = { ...MOD, tabContents: { basicLearn: start, basicPrac: null, advLearn: null, advPrac: null, assessment: null } };
        const ctx = genContext();
        ctx.currentMod = mod;
        ctx.callGemini = volumeModel(ctx, {});
        answerPreview(ctx, 'apply');
        await call(ctx, 'fillLessonVolume')('1');
        assert.ok(ctx.confirms[0].message.includes('낭독 약') && ctx.confirms[0].message.includes('AI 호출 약 16회') && ctx.confirms[0].message.includes('낭독 480분'), ctx.confirms[0].message);
        assert.strictEqual(ctx.confirms[0].opts.title, '기본학습 분량 채우기');
        assert.ok(call(ctx, 'spokenChars')(mod.tabContents.basicLearn) >= TARGET_CHARS, '반영했다');
        assert.deepStrictEqual(ctx.archived.map(item => [item.tabId, item.reason, item.content === start]), [['basicLearn', '고치기 전', true]]);
        assert.ok(mod.history[0].note.startsWith('기본학습 분량 채우기(낭독 약 '), mod.history[0].note);
        assert.ok(ctx.toasts.at(-1).message.includes('채웠습니다'), JSON.stringify(ctx.toasts.at(-1)));
        assert.strictEqual(ctx.imageCalls, 0, '그림은 만들지 않는다');

        const changing = genContext();
        const edited = { ...MOD, tabContents: { basicLearn: start } };
        changing.currentMod = edited;
        changing.callGemini = volumeModel(changing, { onCall: k => { if (k === 1) edited.tabContents.basicLearn = '## 고친 글\n\n기다리는 동안 고쳤습니다.'; } });
        answerPreview(changing, 'apply');
        await call(changing, 'fillLessonVolume')(1);
        assert.strictEqual(edited.tabContents.basicLearn, '## 고친 글\n\n기다리는 동안 고쳤습니다.');
        assert.ok(changing.alerts.at(-1).includes('탭 내용이 바뀌어 반영하지 않았습니다'), changing.alerts.at(-1));

        const declined = genContext();
        declined.currentMod = { ...MOD, tabContents: { basicLearn: start } };
        declined.confirmAnswer = false;
        await call(declined, 'fillLessonVolume')(1);
        assert.strictEqual(declined.prompts.length, 0, '묻는 창에서 그만두면 부르지 않는다');
    });

    await run('긴 탭 전체 AI 수정: 80,000자가 넘으면 먼저 묻고, 그만두면 부르지 않는다', async () => {
        const ctx = genContext();
        ctx.currentMod = { ...MOD, tabContents: { basicLearn: `## 본문\n\n${filler(90000)}` } };
        ctx.confirmAnswer = false;
        ctx.callGemini = volumeModel(ctx, {});
        await call(ctx, 'reinforceCurrentTab')(1, '예시 추가');
        assert.deepStrictEqual(ctx.confirms.map(item => [item.opts.title, item.opts.okLabel]), [['긴 탭 전체 고치기', '그래도 탭 전체 고치기']]);
        assert.strictEqual(ctx.prompts.length, 0);
        const small = genContext();
        small.currentMod = { ...MOD, tabContents: { basicLearn: '## 본문\n\n짧은 글입니다.' } };
        small.callGemini = async () => reply('## 본문\n\n고친 글입니다.');
        answerPreview(small, 'cancel');
        await call(small, 'reinforceCurrentTab')(1, '예시 추가');
        assert.strictEqual(small.confirms.length, 0, '짧은 탭은 묻지 않는다');
    });

    await run('마크다운 정리: 분량 보강 지시의 대괄호 라벨 줄만 지운다', () => {
        const clean = call(pure, 'sanitizeMarkdownContent');
        const out = clean('[보강할 섹션 — 이 섹션 끝에 이어 붙일 내용만 씁니다]\n\n[문서 구조 — 바꾸지 않습니다]\n\n[보강 분량]\n\n[분량 보강 규칙 — 절대 준수]\n\n[이 교안의 학습 목표 — 참고용]\n\n[원본 문서]\n\n본문입니다.\n\n## 문서 구조와 흐름\n\n설명입니다.');
        assert.ok(!/\[(?:보강|문서 구조|분량 보강|이 교안|원본)/.test(out), out);
        assert.ok(out.includes('본문입니다.') && out.includes('## 문서 구조와 흐름'), '대괄호 없는 제목은 둔다');
    });

    /* ---------- 생성 지시 ---------- */
    const promptCtx = (() => {
        const ctx = {
            console: { log() {}, warn() {}, error() {} }, JSON, Map, Set, Promise, Date,
            localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, location: { hash: '' },
            document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeElement(), body: { appendChild() {} } },
            globalState: { subjects: [] }, currentSubjectId: null, courseData: [], instructorTone: 'formal',
            getReferenceContext: () => ''
        };
        ctx.window = ctx;
        vm.createContext(ctx);
        ['data.js', 'lesson-lint.js', 'course-design.js', 'ui.js'].forEach(file => vm.runInContext(source(file), ctx));
        return ctx;
    })();
    const build = (task, args) => call(promptCtx, 'buildTaskContext')(task, { title: 'Python 반복문', description: '반복문', keyConcepts: [], ...args });

    await run('지시: 기본학습 탭은 낭독 기준 분량(분 × 250자)을 주고 옛 40,000자·900줄 기준은 없다', () => {
        const learn = build('tab_content', { tabId: 'basicLearn', tabLabel: '기본학습', targetMinutes: 600 });
        const text = learn.userPrompt;
        ['600분', '150,000자', '× 250자', '[분량 규칙 — 낭독 기준, 절대 준수]', '강사가 소리 내어 읽으며 강의할 때 600분', '600분 이상 630분 이하', '섹션마다 설명 글을 최소 2,500자'].forEach(part => assert.ok(text.includes(part), part));
        ['40,000자', '900줄', '480분(±30분)', '짧은 교안은 불합격'].forEach(part => assert.ok(!text.includes(part), part));
        assert.ok(build('tab_content', { tabId: 'basicLearn', tabLabel: '기본학습' }).userPrompt.includes('480분은 120,000자 이상입니다.'), '목표를 모르면 480분');
        const code = build('tab_content', { tabId: 'basicLearn', tabLabel: '기본학습', codeTopic: true }).userPrompt;
        assert.ok(code.includes('[코드 예제 — 이 차시는 코드를 다룹니다]'));
        assert.ok(!build('tab_content', { tabId: 'assessment', tabLabel: '학습이해도', codeTopic: true }).userPrompt.includes('[코드 예제 — 이 차시는 코드를 다룹니다]'));
        assert.ok(!build('tab_content', { tabId: 'basicPrac', tabLabel: '기본실습', targetMinutes: 600 }).userPrompt.includes('낭독'), '다른 탭은 그대로');
    });

    await run('지시: 교안 전체 생성·이어쓰기·탭 이어쓰기도 같은 낭독 기준을 주고, 자체 검증의 7,000자 기준은 없다', () => {
        const module = build('module', { targetMinutes: 480 });
        assert.ok(module.systemInstruction.includes('[기본 학습 분량 — 낭독 기준, 절대 준수]') && module.systemInstruction.includes('480분은 120,000자 이상입니다.'));
        assert.ok(!module.systemInstruction.includes('7,000자') && module.systemInstruction.includes('강사가 소리 내어 읽는 본문 글자(공백 포함, 코드 블록·표·그림·서식 기호 제외)'));
        const cont = build('module_continue', { chunkIndex: 2, previousContent: '앞 글', targetMinutes: 600 });
        assert.ok(cont.systemInstruction.includes('남은 섹션을 요약하지 않습니다.') && cont.systemInstruction.includes('600분은 150,000자 이상입니다.') && cont.systemInstruction.includes('코드 블록 안에서 끊지 마세요.'));
        const tabCont = build('tab_content_continue', { tabId: 'basicLearn', tabLabel: '기본학습', chunkIndex: 1, previousContent: '앞 글' });
        assert.ok(tabCont.systemInstruction.includes('- 분량 기준은 첫 청크와 같습니다.') && tabCont.systemInstruction.includes('480분은 120,000자 이상입니다.'));
        assert.ok(!build('tab_content_continue', { tabId: 'basicPrac', tabLabel: '기본실습', chunkIndex: 1, previousContent: '앞 글' }).systemInstruction.includes('분량 기준은 첫 청크와 같습니다'));
    });

    await run('지시: 분량 보강은 섹션 원문과 부탁 분량을 주고, 구조·시간·체크리스트·그림·mermaid 규칙과 서식 예시는 빼며 말 걸기·다른 차시 지칭을 막는다', () => {
        const args = { tabId: 'basicLearn', tabLabel: '기본학습', targetMinutes: 480, outline: ['학습 목표', '1. 반복문 (⏱ 60분)'], objectives: ['반복문으로 합계를 구하는 코드를 작성할 수 있습니다.'], sectionTitle: '1. 반복문 (⏱ 60분)', sectionText: '## 1. 반복문 (⏱ 60분)\n\n반복문은 같은 일을 되풀이합니다.', requestChars: 12000, subtopics: 5 };
        const plainAsk = build('volume_expand', args);
        const all = plainAsk.systemInstruction + plainAsk.userPrompt;
        ['반복문은 같은 일을 되풀이합니다.', '12,000자 이상', '새 ### 소주제 5개 안팎', '이미지 태그와 mermaid는 새로 넣지 않고', '[문서 구조 — 이 순서와 제목은 바꾸지 않습니다]\n- 학습 목표\n- 1. 반복문 (⏱ 60분)', '[이 교안의 학습 목표 — 참고용]', '"앞에서", "앞서"', '"여러분"', '[코드 예제 규칙]', '[현재 작업: 기본학습 분량 보강 — 목표 낭독 480분]'].forEach(part => assert.ok(all.includes(part), part));
        ['교안 구조를 다음 위계로', '탭 마지막에 "## ✅ 학습 후 체크리스트"', '[서식 예시', '[코드 예제 — 이 섹션', '[원본 문서]'].forEach(part => assert.ok(!all.includes(part), part));
        const coded = build('volume_expand', { ...args, needCode: true, codeSection: true, fromUpload: true }).userPrompt;
        ['[코드 예제 — 이 섹션에는 아직 코드 예제가 없습니다]', '[코드 예제 — 이 섹션은 코드를 다룹니다]', '[원본 문서]\n- 사용자가 올린 문서로 만든 교안입니다.'].forEach(part => assert.ok(coded.includes(part), part));
        assert.ok(call(promptCtx, 'buildTabRules')('basicPrac', []).includes('[코드 예제 규칙]') && !call(promptCtx, 'buildTabRules')('assessment', []).includes('[코드 예제 규칙]'));
        assert.ok(call(promptCtx, 'buildTabRules')('basicLearn', []).includes('[서식 예시') && !call(promptCtx, 'buildTabRules')('basicLearn', [], { fewshot: false }).includes('[서식 예시'));
        const rules = call(promptCtx, 'CONTEXT_CORE');
        assert.ok(!rules.rules.text_emphasis.includes('단축키') && !rules.fewshot_cases.includes('단축키'));
    });

    await run('창 닫기: 분량을 채우는 동안에는 닫기 전에 묻는다', () => {
        promptCtx.isVolumeFilling = () => true;
        assert.strictEqual(call(promptCtx, 'hasUnsavedWork')(), true);
        promptCtx.isVolumeFilling = () => false;
        assert.strictEqual(call(promptCtx, 'hasUnsavedWork')(), false);
    });

    /* ---------- 미리 보기 예고 ---------- */
    await run('미리 보기: 기본학습을 만들면 분량 보강 긴 호출 16번을 더하고, 잰 긴 호출 시간이 있으면 그 시간을 쓴다', () => {
        const ectx = { console, window: {}, JSON, Math, Object, localStorage: { getItem: () => null, setItem() {} } };
        vm.createContext(ectx);
        vm.runInContext(source('cost-estimate.js'), ectx);
        const work = vm.runInContext('lessonWork', ectx);
        assert.strictEqual(plain(work({ tabs: ['basicLearn'] }, 'section', 0)).volume, 1);
        assert.ok(!('volume' in plain(work({ tabs: ['basicPrac'] }, 'section', 0))) && !('volume' in plain(work({ tabs: 5 }, 'section', 0))), '탭 수만 알면 세지 않는다');
        assert.deepStrictEqual(plain(vm.runInContext('estimateCallSplit', ectx)({ tabs: 1, volume: 1 })), { body: 2, bodyWait: 2, short: 0, images: 0, long: 16 });
        assert.strictEqual(vm.runInContext('estimateCalls', ectx)({ tabs: 1, volume: 1 }), 18);
        const summary = (timings = {}) => plain(vm.runInContext('estimateSummary', ectx)({ tabs: 1, volume: 1 }, { model: 'gemini-3.8-flash', effort: 'medium', timings }));
        assert.deepStrictEqual([summary().minutesLow, summary().minutesHigh], [12, 26], '긴 호출은 본문 호출의 3배(60초)');
        const measured = summary({ 'gemini-3.8-flash#long': { count: 3, avg: 30000 } });
        assert.deepStrictEqual([measured.minutesLow, measured.minutesHigh], [6, 14], '2×20초 + 16×30초 + 4초');
        assert.ok(vm.runInContext('estimateNote', ectx)(summary(), 'gemini-3.8-flash').includes('기본 학습은 낭독 480분(공백 포함 약 120,000자)이 될 때까지'));
        assert.ok(!vm.runInContext('estimateNote', ectx)(plain(vm.runInContext('estimateSummary', ectx)({ tabs: 1 }, { model: 'gemini-3.8-flash', timings: {} })), 'gemini-3.8-flash').includes('낭독'));
        const lexport = { console, window: {}, document: {}, LESSON_TABS: [] };
        vm.createContext(lexport);
        vm.runInContext(source('lesson-export.js'), lexport);
        const css = vm.runInContext('LESSON_EXPORT_CSS', lexport);
        assert.ok(css.includes('.lesson-code') && css.includes('attr(data-lang)'));
    });

    console.log(`\n${count - failed}/${count} passed`);
    if (failed) process.exit(1);
})();
