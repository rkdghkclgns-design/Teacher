// 컨벤션 검수·AI 수정 제안·자동 수정·미리보기·수동 검수·서식 도구 테스트 (실행: node tests/review-flow.test.js)
// AI 응답만 스텁으로 두고 실제 파일을 실행한다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', 'js') + path.sep;
const FILES = ['data.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'lesson-pipeline.js', 'ai-routing.js', 'api.js', 'cost-estimate.js'];

function fakeElement() {
    const handlers = {};
    return {
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', disabled: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener(type, fn) { handlers[type] = fn; },
        fire(type, event) { return handlers[type]?.(event); }, // 진행 막대처럼 처리기가 없는 요소는 무시한다
        querySelector: () => fakeElement(),
        querySelectorAll: () => [],
        remove() { this.removed = true; }
    };
}

function makeContext(callGemini = async () => { throw new Error('호출되면 안 됨'); }) {
    const elements = {};
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1)), clearTimeout, Promise, URL, Uint16Array, Blob,
        localStorage: { getItem: () => null, setItem() {} },
        currentEditingModuleId: null,
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''),
        saveState: async () => { ctx.saved = (ctx.saved || 0) + 1; },
        renderEditor: () => { ctx.rendered = (ctx.rendered || 0) + 1; },
        renderSidebar() {},
        showLessonView() {},
        lessonDesignBrief: () => '',
        lessonGenBrief: () => '',
        archiveContent: async (item, reason) => { ctx.archived.push({ ...item, reason }); },
        archived: [],
        alerts: [],
        toasts: [],
        elements,
        document: {
            readyState: 'complete',
            body: { appendChild: el => { if (el.id) elements[el.id] = el; ctx.overlays.push(el); ctx.onOverlay?.(el); } },
            createElement: fakeElement,
            getElementById: id => elements[id] || null,
            addEventListener() {},
            querySelectorAll: () => []
        },
        overlays: [],
        callGemini
    };
    ctx.window = ctx;
    ctx.showAlert = message => ctx.alerts.push(message);
    ctx.showToast = message => ctx.toasts.push(message);
    vm.createContext(ctx);
    FILES.forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), ctx));
    if (!ctx.confirmAsync) ctx.confirmAsync = async () => true; // data-safety.js 없이 확인 창은 바로 승인한다
    // api.js의 callGemini와 tabs.js가 쓰는 함수는 스텁으로 바꾼다. 실제 파일에서 함수 선언이 전역을 차지하므로 로드 후에 덮는다.
    ctx.callGemini = callGemini;
    vm.runInContext('callGemini = window.callGemini; buildTaskContext = (task, args) => ({ systemInstruction: "시스템", userPrompt: `${task}:${args.tabId}` }); getEditingModule = (id = window.currentMod?.id) => (String(id) === String(window.currentMod?.id) ? window.currentMod : window.otherMod); window.realProcessImageTags = processImageTags; processImageTags = async (mod, md) => md; renderSidebar = () => {}; renderEditor = () => { window.rendered = (window.rendered || 0) + 1; };', ctx);
    return ctx;
}

const call = (ctx, name) => vm.runInContext(name, ctx);
const reply = (text, finishReason = 'STOP') => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });
const plain = value => JSON.parse(JSON.stringify(value));

// 시각을 이 컴퓨터 시각으로 보이는지 보려고 잠시 시간대를 정한다(node는 TZ를 바꾸면 바로 따른다). 끝나면 되돌린다
function withTimeZone(tz, fn) {
    const before = process.env.TZ;
    process.env.TZ = tz;
    try {
        return fn();
    } finally {
        if (before === undefined) delete process.env.TZ;
        else process.env.TZ = before;
    }
}

async function run(name, fn) {
    await fn();
    console.log('PASS', name);
}

const GOALS = ['주어진 양식으로 게임 기획서를 작성할 수 있습니다.', '플레이 기록을 근거로 재미 요소를 비교할 수 있습니다.'];
const lesson = ({ goals = GOALS, sections = ['재미의 구조', '플레이 분석'], overview = true, checklist = true, body = '기획서는 규칙을 정의합니다.' } = {}) => [
    '# 📝 재미',
    goals.length ? `## 학습 목표\n\n${goals.map(goal => `- ${goal}`).join('\n')}` : '',
    overview ? '## 개요 (⏱ 10분)\n\n- 요청마다 새 연결을 여는 구조에서는 응답이 2배로 늘어납니다.' : '',
    ...sections.map(title => `## ${title} (⏱ 30분)\n\n${body}`),
    checklist ? `## ✅ 학습 후 체크리스트\n\n${sections.slice(0, goals.length).map(title => `- 기획서를 설명합니다. (다시 보기: ${title})`).join('\n')}` : ''
].filter(Boolean).join('\n\n');

function answerPreview(ctx, action, toggles = []) {
    ctx.onOverlay = overlay => setImmediate(() => {
        toggles.forEach(([index, checked]) => overlay.fire('change', { target: { dataset: { sectionRow: String(index) }, checked } }));
        overlay.fire('click', { target: { dataset: { diffAction: action } } });
    });
}

function generationContext(callGemini, mod) {
    const ctx = makeContext(callGemini);
    ['editor-loading', 'editor-loading-text', 'editor-loading-stop', 'ai-command-input'].forEach(id => { ctx.elements[id] = fakeElement(); });
    ctx.currentMod = mod;
    vm.runInContext('globalState = { subjects: [] }; currentSubjectId = null;', ctx);
    return ctx;
}

(async () => {
    const ctx = makeContext();
    const lint = (md, tabId) => plain(call(ctx, 'lintLessonMarkdown')(md, tabId));
    const msgs = (md, tabId) => lint(md, tabId).map(issue => issue.msg);

    await run('프롬프트 규칙: 원본 규칙 반영과 단축키 일치', async () => {
        const rules = call(ctx, 'CONTEXT_CORE').rules;
        ['어떤 문제 상황이 있는지', '무엇을 해결해야 하는지', '학습 후 무엇이 가능해지는지', '1:1로 대응', '지시 강도는 어미로 구분', '~하는 것이 좋습니다', '단축키'].forEach(text => assert.ok(rules.content_design.includes(text), text));
        assert.ok(rules.assessment_design.includes('단축키'));
        assert.ok(!rules.text_emphasis.includes('단축키'), '강조 규칙이 단축키를 쓰라고 시키지 않는다');
        assert.ok(!call(ctx, 'CONTEXT_CORE').fewshot_cases.includes('단축키'), 'few-shot도 같다');
        const convention = call(ctx, 'getConventionMarkdown')();
        assert.ok(!convention.includes('Ctrl+Z'), '컨벤션 예시가 금지 규칙과 어긋나지 않는다');
        assert.ok(convention.includes('어미로 구분') && convention.includes('단축키'));
    });

    await run('검수: 필수·권장 구분', async () => {
        const issues = lint('## 본문\n\n앞에서 배운 내용을 매우 빠르게 씁니다.\n');
        assert.strictEqual(issues.find(issue => issue.msg === '다른 차시를 지칭하지 않습니다.').sev, 'bad');
        assert.strictEqual(issues.find(issue => issue.msg === '정도는 수치로 씁니다.').sev, 'warn');
        assert.strictEqual(issues[0].where, '본문', '어느 섹션의 지적인지 남긴다');
        const question = lint('### 문제 1. 제목\n학습 목표 1 · 밴드 L1\n\n① 가\n② 나\n\n✅ **정답:**\n');
        assert.strictEqual(question.find(issue => issue.msg === '정답을 표기합니다.').sev, 'bad');
        assert.strictEqual(question.find(issue => issue.msg === '보기는 4개 이상 둡니다.').sev, 'warn');
        assert.strictEqual(question[0].where, '문제 1');
        assert.deepStrictEqual(plain(call(ctx, 'lintCounts')(issues)), { required: 1, recommended: 1 });
    });

    await run('검수: 단축키와 키 조합', async () => {
        const version = '버전 의존 정보를 본문에 쓰지 않습니다.';
        ['저장 단축키를 씁니다.', 'Ctrl+S로 저장합니다.', '`Cmd + Z`로 되돌립니다.', 'Shift+클릭으로 고릅니다.'].forEach(line => assert.ok(msgs(`## 본문\n\n${line}\n`).includes(version), line));
        assert.ok(!msgs('## 본문\n\n```bash\nCtrl+C\n```\n').includes(version), '코드 블록은 검사하지 않는다');
        assert.strictEqual(lint('## 본문\n\n단축키를 씁니다.\n')[0].sev, 'warn');
    });

    await run('검수: 학습 탭 구조', async () => {
        assert.deepStrictEqual(msgs(lesson(), 'basicLearn'), []);
        const eight = lesson({ sections: Array.from({ length: 8 }, (_, i) => `대주제 ${i + 1}`) });
        assert.deepStrictEqual(msgs(eight, 'basicLearn'), [], '기본학습의 ## 대주제 8개는 위반이 아니다');
        assert.ok(msgs(lesson({ overview: false }), 'basicLearn').includes('개요를 작성합니다.'));
        assert.ok(msgs(lesson({ goals: [] }), 'basicLearn').includes('학습 목표를 1개 이상 작성합니다.'));
        assert.ok(msgs(lesson({ sections: ['하나'] }), 'basicLearn').includes('학습 목표마다 내용 섹션을 둡니다.'));
        assert.ok(msgs(lesson({ checklist: false }), 'basicLearn').includes('체크리스트는 학습 목표와 같은 수로 씁니다.'));
        assert.ok(lint(lesson({ overview: false }), 'basicLearn').find(issue => issue.where === '개요').missing);
        assert.deepStrictEqual(plain(call(ctx, 'lessonStructureStats')(eight)), { objectives: 2, sections: 8, checklist: 2 });
    });

    await run('검수: 구조 검사는 학습 탭에만', async () => {
        const practice = '## 실습 과제 1 (⏱ 30분)\n\n기획서를 작성합니다.\n';
        assert.deepStrictEqual(msgs(practice, 'basicPrac'), []);
        assert.deepStrictEqual(msgs(practice, 'advPrac'), []);
        assert.deepStrictEqual(msgs('### 문제 1. 제목\n학습 목표 1 · 밴드 L1\n\n① 가\n② 나\n③ 다\n④ 라\n\n✅ **정답:** ②\n', 'assessment'), []);
        assert.deepStrictEqual(msgs(practice), [], '탭을 주지 않으면 구조를 보지 않는다');
    });

    await run('검수: 체크리스트의 다시 보기', async () => {
        const bad = lesson().replace('다시 보기: 플레이 분석', '다시 보기: 없는 섹션');
        assert.ok(msgs(bad, 'basicLearn').includes('체크리스트의 다시 볼 섹션이 교안에 없습니다.'));
        const same = lesson().replace('다시 보기: 플레이 분석', '다시 보기: 재미의 구조');
        assert.ok(msgs(same, 'basicLearn').includes('학습 목표마다 다른 섹션을 다시 보도록 적습니다.'));
        const similar = lesson({ sections: ['재미의 구조', '재미의 구조 심화'] });
        assert.deepStrictEqual(msgs(similar, 'basicLearn'), [], '비슷한 제목은 정확히 같은 제목을 먼저 찾는다');
    });

    const DOC = '# 제목\n\n## 학습 목표\n\n- 목표\n\n## 첫 섹션 (⏱ 30분)\n\n앞에서 다룬 내용입니다.\n\n<!-- [IMG: "fun"] -->\n\n## 고정 섹션\n\n앞서 다룬 고정 본문입니다.\n\n## 뒤 섹션\n\n그대로 둘 본문입니다.';

    await run('AI 수정: 지적이 있는 섹션만 고른다', async () => {
        const issues = call(ctx, 'lintLessonMarkdown')(DOC);
        const blocks = [{ title: '고정 섹션', text: '' }];
        const plan = plain(call(ctx, 'pickFixSections')(DOC, issues, blocks));
        assert.deepStrictEqual(plan.targets.map(target => target.title), ['학습 목표', '첫 섹션 (⏱ 30분)']);
        assert.strictEqual(plan.locked, 1);
        const question = '### 문제 1. 가\n학습 목표 1 · 밴드 L1\n\n✅ **정답:**\n\n## 채점 기준\n\n기준입니다.\n';
        assert.deepStrictEqual(plain(call(ctx, 'pickFixSections')(question, call(ctx, 'lintLessonMarkdown')(question), [])).targets.map(target => target.title), [''], '문제 지적은 문제가 든 섹션으로 간다');
    });

    await run('AI 수정: 분량 상한을 넘으면 필수 지적부터', async () => {
        const long = '가'.repeat(20000);
        const md = `## 권장 섹션\n\n${long}\n매우 깁니다.\n\n## 필수 섹션\n\n${long}\n앞에서 다룹니다.\n`;
        const plan = plain(call(ctx, 'pickFixSections')(md, call(ctx, 'lintLessonMarkdown')(md), []));
        assert.deepStrictEqual(plan.targets.map(target => target.title), ['필수 섹션']);
        assert.strictEqual(plan.deferred, 1);
    });

    await run('AI 수정: 받은 섹션만 바꿔 끼운다', async () => {
        const plan = call(ctx, 'pickFixSections')(DOC, call(ctx, 'lintLessonMarkdown')(DOC), [{ title: '고정 섹션', text: '' }]);
        const fixed = '## 첫 섹션 (⏱ 30분)\n\n도메인 상황을 다룬 내용입니다.\n\n<!-- [IMG: "fun"] -->\n\n## 고정 섹션\n\n모델이 바꾼 글입니다.\n\n## 뒤 섹션\n\n모델이 바꾼 글입니다.';
        const merged = call(ctx, 'mergeFixedSections')(DOC, fixed, plan.targets);
        assert.ok(merged.includes('도메인 상황을 다룬 내용입니다.'));
        assert.ok(merged.includes('앞서 다룬 고정 본문입니다.') && merged.includes('그대로 둘 본문입니다.'), '대상이 아닌 섹션은 그대로');
        assert.ok(!merged.includes('모델이 바꾼 글'));
        const body = '재미의 구조를 세 층으로 나누어 설명합니다. 각 층은 플레이어의 행동과 감정을 연결합니다.';
        const old = `## 옛 제목\n\n앞에서 다룹니다. ${body}`;
        const renamed = call(ctx, 'mergeFixedSections')(old, `## 새 제목\n\n도메인을 다룹니다. ${body}`, call(ctx, 'pickFixSections')(old, call(ctx, 'lintLessonMarkdown')(old), []).targets);
        assert.ok(renamed.includes('## 새 제목') && !renamed.includes('옛 제목'), '제목만 바꿔 쓰면 짝지어 바꾼다');
    });

    await run('AI 수정: 새 개요가 지적된 섹션을 덮어쓰지 않는다', async () => {
        const md = '## 학습 목표\n\n- 주어진 양식으로 게임 기획서를 작성할 수 있습니다.\n\n## 본문\n\n앞에서 다룬 내용을 정리합니다.\n\n## ✅ 학습 후 체크리스트\n\n- 항목 (다시 보기: 본문)';
        const issues = call(ctx, 'lintLessonMarkdown')(md, 'basicLearn');
        assert.ok(plain(issues).some(issue => issue.where === '개요' && issue.missing));
        const merged = call(ctx, 'mergeFixedSections')(md, '## 개요\n\n- 문제 상황입니다.', call(ctx, 'pickFixSections')(md, issues, []).targets, true);
        assert.ok(merged.includes('앞에서 다룬 내용을 정리합니다.'), '대상 섹션의 본문이 남는다');
        assert.ok(merged.indexOf('## 개요') < merged.indexOf('## 본문') && merged.indexOf('## 학습 목표') < merged.indexOf('## 개요'), '개요는 정해진 자리에 들어간다');
    });

    await run('AI 수정: 내용을 나누거나 줄인 응답은 쓰지 않는다', async () => {
        const body = '설명 문장입니다. '.repeat(30).trim();
        const md = `## 섹션\n\n${body}앞에서 다룹니다.\n\n둘째 단락입니다. ${body}`;
        const targets = call(ctx, 'pickFixSections')(md, call(ctx, 'lintLessonMarkdown')(md), []).targets;
        assert.strictEqual(call(ctx, 'mergeFixedSections')(md, `## 섹션\n\n${body}도메인을 다룹니다.\n\n## 나뉜 뒷부분\n\n전혀 다른 글로 바꾼 둘째 단락입니다.`, targets), md, '나뉜 뒷부분을 버리지 않는다');
        const sub = `## 섹션\n\n앞에서 다룹니다.\n\n### ■ 첫째\n\n${body}\n\n### ■ 둘째\n\n${body}`;
        const subTargets = call(ctx, 'pickFixSections')(sub, call(ctx, 'lintLessonMarkdown')(sub), []).targets;
        assert.strictEqual(call(ctx, 'mergeFixedSections')(sub, `## 섹션\n\n도메인을 다룹니다.\n\n### ■ 첫째\n\n${body}${body}`, subTargets), sub, '소주제가 줄면 분량이 같아도 원문 유지');
    });

    await run('자동 수정: 지적된 문항만 돌려줘 지적이 줄어도 채택하지 않는다', async () => {
        const good = n => `### 문제 ${n}. 제목 ${n}\n학습 목표 1 · 밴드 L1\n\n① 가\n② 나\n③ 다\n④ 라\n\n✅ **정답:** ②\n\n📝 **해설:** 해설 문장입니다.`;
        const bad = n => good(n).replace('학습 목표 1 · 밴드 L1\n', '');
        const md = [good(1), good(2), good(3), bad(4), bad(5)].join('\n\n---\n\n');
        const aiCtx = makeContext(async () => reply([good(1), good(2), good(3), good(4)].join('\n\n---\n\n')));
        assert.strictEqual(await call(aiCtx, 'autoFixGeneratedTab')({ tabId: 'assessment', md }), md, '문항을 잃은 결과는 지적이 줄어도 버린다');
    });

    await run('AI 수정: 잘린 섹션과 이미지가 빠진 섹션은 버린다', async () => {
        const body = '설명 문장입니다. '.repeat(40);
        const md = `## 섹션\n\n${body}앞에서 다룹니다.\n\n<div class="image-wrapper"><img src="local:img_1"></div>`;
        const targets = call(ctx, 'pickFixSections')(md, call(ctx, 'lintLessonMarkdown')(md), []).targets;
        assert.strictEqual(call(ctx, 'mergeFixedSections')(md, '## 섹션\n\n짧습니다.', targets), md, '내용이 크게 줄면 원문 유지');
        assert.strictEqual(call(ctx, 'mergeFixedSections')(md, `## 섹션\n\n${body}도메인을 다룹니다.`, targets), md, '이미지 참조가 빠지면 원문 유지');
    });

    await run('AI 수정: 없는 섹션은 정해진 자리에 넣는다', async () => {
        const base = '# 제목\n\n## 학습 목표\n\n- 목표\n\n## 본문\n\n내용\n\n## ✅ 학습 후 체크리스트\n\n- 항목';
        const titles = md => plain(call(ctx, 'mdSections')(md)).map(section => section.title);
        const merged = call(ctx, 'mergeFixedSections')(base, '## 개요\n\n- 문제 상황입니다.\n\n## 새 내용\n\n설명입니다.', [], true);
        assert.deepStrictEqual(titles(merged), ['', '학습 목표', '개요', '본문', '새 내용', '✅ 학습 후 체크리스트']);
        const noChecklist = call(ctx, 'mergeFixedSections')('## 학습 목표\n\n- 목표', '## ✅ 학습 후 체크리스트\n\n- 항목', [], true);
        assert.deepStrictEqual(titles(noChecklist), ['학습 목표', '✅ 학습 후 체크리스트']);
        assert.strictEqual(call(ctx, 'mergeFixedSections')(base, '## 다른 섹션\n\n글', []), base, '새 섹션을 허용하지 않으면 버린다');
        assert.strictEqual(call(ctx, 'mergeFixedSections')(base, '## 본문\n\n모델이 바꾼 글', [], true), base, '이미 있는 제목은 새 섹션이 아니다');
    });

    await run('AI 수정: 프롬프트에 지적과 고정 섹션을 담고 응답의 펜스를 벗긴다', async () => {
        const prompts = [];
        const aiCtx = makeContext(async (model, payload) => {
            prompts.push({ user: payload.contents[0].parts[0].text, system: payload.systemInstruction.parts[0].text, config: payload.generationConfig });
            return reply('```markdown\n## 첫 섹션 (⏱ 30분)\n\n도메인을 다룬 내용입니다.\n\n<!-- [IMG: "fun"] -->\n\n<!-- END -->\n```');
        });
        const issues = call(aiCtx, 'lintLessonMarkdown')(DOC).filter(issue => issue.where === '첫 섹션 (⏱ 30분)');
        const blocks = [{ title: '고정 섹션', text: '## 고정 섹션\n\n앞서 다룬 고정 본문입니다.' }];
        const { text } = await call(aiCtx, 'requestSectionFix')({ tabId: 'basicLearn', md: DOC, issues, lockedBlocks: blocks });
        assert.ok(prompts[0].user.includes('다른 차시를 지칭하지 않습니다.') && prompts[0].user.includes('고정 섹션(고정 섹션)은 출력하지 않습니다.'));
        assert.ok(prompts[0].user.includes('[참고 섹션') && prompts[0].user.includes('- 목표'), '학습 목표를 참고로 보낸다');
        assert.ok(!prompts[0].user.includes('그대로 둘 본문입니다.'), '고치지 않을 본문은 보내지 않는다');
        assert.ok(prompts[0].system.includes('콘텐츠 업무 설계') && prompts[0].system.includes('학습 후 체크리스트'));
        assert.strictEqual(prompts[0].config.maxOutputTokens, 65536);
        assert.ok(text.includes('도메인을 다룬 내용입니다.') && !text.includes('```') && !text.includes('<!-- END -->'));
    });

    await run('자동 수정: 필수 지적이 없으면 호출하지 않는다', async () => {
        let calls = 0;
        const aiCtx = makeContext(async () => { calls += 1; return reply(''); });
        const md = '## 본문\n\n매우 빠른 구조입니다.';
        assert.strictEqual(await call(aiCtx, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md }), md);
        assert.strictEqual(calls, 0);
    });

    await run('자동 수정: 나아졌을 때만 바꾸고 한 번만 호출한다', async () => {
        const md = '## 본문\n\n앞에서 다룬 내용을 정리합니다.';
        let calls = 0;
        const better = makeContext(async () => { calls += 1; return reply('## 본문\n\n도메인을 다룬 내용을 정리합니다.'); });
        assert.ok((await call(better, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md })).includes('도메인'));
        assert.strictEqual(calls, 1);
        const same = makeContext(async () => reply('## 본문\n\n앞서 다룬 내용을 다시 정리합니다.'));
        assert.strictEqual(await call(same, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md }), md, '지적이 줄지 않으면 원문 유지');
    });

    await run('자동 수정: 실패하면 생성 결과를 지킨다', async () => {
        const md = '## 본문\n\n앞에서 다룬 내용을 정리합니다.';
        const failing = makeContext(async () => { throw new Error('장애'); });
        assert.strictEqual(await call(failing, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md }), md);
        const truncated = makeContext(async () => reply('## 본문\n\n도메인을 다룬', 'MAX_TOKENS'));
        assert.strictEqual(await call(truncated, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md }), md, '잘린 응답은 지적이 줄어도 쓰지 않는다');
    });

    await run('자동 수정: 고정 섹션은 건드리지 않는다', async () => {
        const md = '## 고정\n\n앞서 다룬 원문입니다.\n\n## 풀린 섹션\n\n앞에서 다룬 글입니다.';
        const blocks = [{ title: '고정', text: '## 고정\n\n앞서 다룬 원문입니다.' }];
        const aiCtx = makeContext(async () => reply('## 고정\n\n모델이 고친 글입니다.\n\n## 풀린 섹션\n\n도메인을 다룬 글입니다.'));
        const result = await call(aiCtx, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md, lockedBlocks: blocks });
        assert.ok(result.includes('앞서 다룬 원문입니다.') && result.includes('도메인을 다룬 글입니다.') && !result.includes('모델이 고친 글'));
        let calls = 0;
        const onlyLocked = makeContext(async () => { calls += 1; return reply(''); });
        const lockedMd = '## 고정\n\n앞서 다룬 원문입니다.';
        assert.strictEqual(await call(onlyLocked, 'autoFixGeneratedTab')({ tabId: 'basicPrac', md: lockedMd, lockedBlocks: blocks }), lockedMd);
        assert.strictEqual(calls, 0, '고칠 대상이 없으면 호출하지 않는다');
    });

    await run('탭 생성: 생성 뒤 한 번 고치고 저장한다', async () => {
        const prompts = [];
        const mod = { id: 1, title: '차시', tabContents: {} };
        const aiCtx = generationContext(async (model, payload) => {
            const text = payload.contents[0].parts[0].text;
            prompts.push(text);
            return reply(text.includes('[작업]') ? '## 본문\n\n도메인을 다룹니다.' : '## 본문\n\n앞에서 다룹니다.');
        }, mod);
        await call(aiCtx, 'generateTabContent')(1, 'basicPrac');
        assert.strictEqual(prompts.length, 2);
        assert.ok(mod.tabContents.basicPrac.includes('도메인을 다룹니다.'));
        assert.ok(mod.content.includes('도메인을 다룹니다.'));
    });

    await run('탭 생성: 고치기 실패와 일부 누락에도 생성 결과를 지킨다', async () => {
        const mod = { id: 1, title: '차시', tabContents: {} };
        let calls = 0;
        const failing = generationContext(async () => {
            calls += 1;
            if (calls > 1) throw new Error('장애');
            return reply('## 본문\n\n앞에서 다룹니다.');
        }, mod);
        await call(failing, 'generateTabContent')(1, 'basicPrac');
        assert.ok(mod.tabContents.basicPrac.includes('앞에서 다룹니다.'));
        assert.ok(failing.alerts.at(-1).includes('생성되었습니다'), JSON.stringify(failing.alerts));
        const partialMod = { id: 1, title: '차시', tabContents: {} };
        let partialCalls = 0;
        const partial = generationContext(async () => {
            partialCalls += 1;
            if (partialCalls === 2) throw new Error('429');
            return reply('## 본문\n\n앞에서 다룹니다.\n<!-- CONTINUE -->');
        }, partialMod);
        await call(partial, 'generateTabContent')(1, 'basicPrac');
        assert.strictEqual(partialCalls, 2, '끝까지 받지 못한 글은 고치지 않는다');
        assert.ok(partialMod.tabContents.basicPrac.includes('앞에서 다룹니다.'));
    });

    await run('탭 생성: 중단하면 받은 단락까지 저장하고 수신 글자 수를 보여 준다', async () => {
        const mod = { id: 1, title: '차시', tabContents: {} };
        let calls = 0;
        const aiCtx = generationContext(async () => {
            calls += 1;
            if (calls === 1) call(aiCtx, 'requestTabGenerationStop')();
            return reply('## 본문\n\n앞에서 다룹니다.\n<!-- CONTINUE -->');
        }, mod);
        await call(aiCtx, 'generateTabContent')(1, 'basicLearn');
        assert.strictEqual(calls, 1, '다음 단락과 자동 수정을 호출하지 않는다');
        assert.ok(mod.tabContents.basicLearn.includes('앞에서 다룹니다.') && !mod.tabContents.basicLearn.includes('CONTINUE'));
        assert.ok(aiCtx.alerts.at(-1).includes('중단했습니다'));
        const previous = { id: 1, title: '차시', tabContents: { basicLearn: '## 완성본\n\n이전에 완성한 글입니다.' } };
        const stopping = generationContext(async () => {
            call(stopping, 'requestTabGenerationStop')();
            return reply('## 본문\n\n조각\n<!-- CONTINUE -->');
        }, previous);
        answerPreview(stopping, 'apply', [[0, true]]);
        await call(stopping, 'generateTabContent')(1, 'basicLearn');
        assert.ok(stopping.archived[0].content.includes('이전에 완성한 글입니다.'), '완성본을 덮기 전에 히스토리에 남긴다');
        assert.strictEqual(stopping.archived[0].tabId, 'basicLearn', '그 탭과 그 차시를 함께 남긴다');
        assert.strictEqual(stopping.archived[0].lesson, previous);
        assert.strictEqual(stopping.archived[0].reason, '다시 생성 전');
        assert.ok(stopping.alerts.at(-1).includes('작업 기록에 남겼'));
        const labels = [];
        const counting = generationContext(async () => reply(calls++ === 1 ? '## 본문\n\n가나다\n<!-- CONTINUE -->' : '## 뒤\n\n끝입니다.'), { id: 1, title: '차시', tabContents: {} });
        Object.defineProperty(counting.elements['editor-loading-text'], 'textContent', { set: value => labels.push(value), get: () => '' });
        await call(counting, 'generateTabContent')(1, 'basicLearn');
        assert.ok(labels.some(label => /2\/6 단락, \d+자 수신/.test(label)), '수신 글자 수');
    });

    await run('탭 재생성: 미리보기에서 고르면 반영하고 취소하면 그대로 둔다', async () => {
        const answer = async () => reply('## 완성본\n\n새로 쓴 글입니다.');
        const kept = { id: 1, title: '차시', tabContents: { basicPrac: '## 완성본\n\n이전 글입니다.' } };
        const cancelling = generationContext(answer, kept);
        answerPreview(cancelling, 'cancel');
        const cancelled = await call(cancelling, 'generateTabContent')(1, 'basicPrac');
        assert.strictEqual(cancelled.cancelled, true);
        assert.ok(kept.tabContents.basicPrac.includes('이전 글입니다.'));
        assert.strictEqual(cancelling.archived.length, 0, '바꾸지 않았으면 히스토리에 남기지 않는다');
        const changed = { id: 1, title: '차시', tabContents: { basicPrac: '## 완성본\n\n이전 글입니다.' } };
        const applying = generationContext(answer, changed);
        answerPreview(applying, 'apply');
        await call(applying, 'generateTabContent')(1, 'basicPrac');
        assert.ok(changed.tabContents.basicPrac.includes('새로 쓴 글입니다.'));
        assert.ok(applying.archived[0].content.includes('이전 글입니다.'));
        assert.strictEqual(applying.archived[0].tabId, 'basicPrac');
        assert.ok(changed.history[0].note.includes('재생성'), '변경 이력');
        const fresh = { id: 1, title: '차시', tabContents: {} };
        await call(generationContext(answer, fresh), 'generateTabContent')(1, 'basicPrac');
        assert.ok(fresh.history[0].note.includes('AI 생성'));
    });

    await run('탭 생성: 전체 재생성 전에 챙긴 고정 섹션을 다시 넣는다', async () => {
        const mod = { id: 1, title: '차시', tabContents: {}, lockedSections: { basicPrac: ['고정'] } };
        const aiCtx = generationContext(async () => reply('## 고정\n\n모델이 바꾼 글입니다.\n\n## 새 글\n\n내용입니다.'), mod);
        await call(aiCtx, 'generateTabContent')(1, 'basicPrac', { lockedBlocks: [{ title: '고정', text: '## 고정\n\n원래 글입니다.' }] });
        assert.ok(mod.tabContents.basicPrac.includes('원래 글입니다.') && !mod.tabContents.basicPrac.includes('모델이 바꾼 글'));
    });

    await run('탭 생성: 중단한 글은 일부 누락으로 돌려준다', async () => {
        const mod = { id: 1, title: '차시', tabContents: {} };
        const aiCtx = generationContext(async () => {
            call(aiCtx, 'requestTabGenerationStop')();
            return reply('## 본문\n\n앞입니다.\n<!-- CONTINUE -->');
        }, mod);
        assert.strictEqual((await call(aiCtx, 'generateTabContent')(1, 'basicLearn', { quiet: true })).partial, true);
    });

    await run('탭 생성: 일괄 생성은 중단하면 남은 탭과 다음 차시로 넘어가지 않는다', async () => {
        const mod = { id: 1, title: '차시', tabContents: {} };
        const seen = [];
        const aiCtx = generationContext(async (model, payload) => {
            seen.push(payload.contents[0].parts[0].text);
            if (seen.length === 1) call(aiCtx, 'requestTabGenerationStop')();
            return reply('## 본문\n\n조각\n<!-- CONTINUE -->');
        }, mod);
        await call(aiCtx, 'generateAllTabs')(1);
        assert.deepStrictEqual(seen, ['tab_content:basicLearn'], '다음 탭을 호출하지 않는다');
        assert.strictEqual(call(aiCtx, 'isTabGenerationStopped')(), true, '차시 묶음 생성이 멈출 수 있게 상태를 유지한다');
        assert.ok(aiCtx.alerts.at(-1).includes('중단했습니다'));
        const next = call(aiCtx, 'generateTabContent')(1, 'basicPrac');
        assert.strictEqual(call(aiCtx, 'isTabGenerationStopped')(), false, '다음 생성을 시작하면 초기화한다');
        await next;
    });

    await run('중지 신호: 생성마다 새로 만들고, 중지하면 끊으며, 지난번 끊긴 신호를 다시 쓰지 않는다', async () => {
        const stopCtx = makeContext();
        stopCtx.AbortController = AbortController;
        call(stopCtx, 'resetTabGenStop')();
        const first = call(stopCtx, 'aiStopSignal')();
        assert.ok(first && first.aborted === false);
        call(stopCtx, 'requestTabGenerationStop')();
        assert.strictEqual(first.aborted, true, '중지하면 끊는다');
        assert.strictEqual(call(stopCtx, 'isTabGenerationStopped')(), true);
        call(stopCtx, 'resetTabGenStop')();
        const second = call(stopCtx, 'aiStopSignal')();
        assert.ok(second !== first && second.aborted === false, '새 생성은 새 신호');
        assert.strictEqual(call(stopCtx, 'isTabGenerationStopped')(), false);
        const bare = makeContext();
        call(bare, 'resetTabGenStop')();
        assert.strictEqual(call(bare, 'aiStopSignal')(), null, 'AbortController가 없으면 신호 없이 예전처럼');
    });

    await run('탭 생성: 단락 호출에는 다시 보내기 기다림만 끊는 신호를 넘긴다(받고 있는 단락은 끝까지 받는다)', async () => {
        const seen = [];
        const mod = { id: 1, title: '차시', tabContents: {} };
        const aiCtx = generationContext(async (model, payload) => { seen.push(payload); return reply('## 본문\n\n완성한 글입니다.'); }, mod);
        aiCtx.AbortController = AbortController;
        await call(aiCtx, 'generateTabContent')(1, 'basicPrac', { quiet: true });
        assert.ok(seen[0].waitSignal && seen[0].waitSignal === call(aiCtx, 'aiStopSignal')());
        assert.ok(!('signal' in seen[0]), '받고 있는 단락은 끊지 않는다');
    });

    await run('탭 생성: 첫 단락을 다시 보내려고 기다리다 중지하면 실패가 아니라 멈춤으로 알린다', async () => {
        const mod = { id: 1, title: '차시', tabContents: {} };
        const aiCtx = generationContext(async () => { throw Object.assign(new Error('중지했습니다.'), { name: 'AbortError' }); }, mod);
        const result = plain(await call(aiCtx, 'generateTabContent')(1, 'basicPrac'));
        assert.deepStrictEqual(result, { ok: false, stopped: true });
        assert.strictEqual(aiCtx.alerts.length, 0, '오류 창을 띄우지 않는다');
        assert.ok(aiCtx.toasts.some(message => message.includes('생성을 멈췄습니다')), JSON.stringify(aiCtx.toasts));
    });

    await run('탭 생성: 이어 쓸 단락을 기다리다 중지하면 받은 단락은 남기고 중단으로 알린다', async () => {
        let calls = 0;
        const mod = { id: 1, title: '차시', tabContents: {} };
        const aiCtx = generationContext(async () => {
            calls += 1;
            if (calls === 1) return reply('## 1. 첫째\n\n받은 단락입니다.\n<!-- CONTINUE -->');
            call(aiCtx, 'requestTabGenerationStop')();
            throw Object.assign(new Error('중지했습니다.'), { name: 'AbortError' });
        }, mod);
        const result = await call(aiCtx, 'generateTabContent')(1, 'basicLearn');
        assert.ok(mod.tabContents.basicLearn.includes('받은 단락입니다.'));
        assert.strictEqual(result.partial, true);
        assert.ok(aiCtx.alerts.at(-1).includes('생성을 중단했습니다'), aiCtx.alerts.at(-1));
    });

    await run('탭 전체 AI 수정: 중지하면 받던 글을 끊고 알리지 않으며 탭은 그대로', async () => {
        const original = '## 본문\n\n원래 글입니다.';
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: original } };
        let sentSignal;
        const aiCtx = generationContext(async (model, payload) => { sentSignal = payload.signal; throw Object.assign(new Error('중지했습니다.'), { name: 'AbortError' }); }, mod);
        aiCtx.AbortController = AbortController;
        await call(aiCtx, 'reinforceCurrentTab')(1, '예시 추가');
        assert.ok(sentSignal && sentSignal === call(aiCtx, 'aiStopSignal')(), '받던 글을 끊을 신호를 넘긴다');
        assert.strictEqual(aiCtx.alerts.length, 0);
        assert.strictEqual(mod.tabContents.basicLearn, original);
    });

    await run('탭 생성: 하루 한도·한도 0은 1~2분 뒤 다시 하라고 하지 않고 그 안내를 그대로 보인다', async () => {
        const daily = () => Object.assign(new Error('오늘 쓸 수 있는 AI 사용량을 다 썼습니다(429). 내일 다시 하거나 오른쪽 위 ⚙ 설정에서 다른 모델이나 키로 바꿔 주세요.'), { status: 429, quota: 'daily' });
        const mod = { id: 1, title: '차시', tabContents: {} };
        const aiCtx = generationContext(async () => { throw daily(); }, mod);
        const result = await call(aiCtx, 'generateTabContent')(1, 'basicPrac', { quiet: true });
        assert.ok(result.error.includes('오늘 쓸 수 있는 AI 사용량') && !result.error.includes('API 호출 한도(429)에 도달했습니다'), result.error);
        let calls = 0;
        const contMod = { id: 1, title: '차시', tabContents: {} };
        const contCtx = generationContext(async () => {
            calls += 1;
            if (calls === 1) return reply('## 1. 첫째\n\n받은 단락입니다.\n<!-- CONTINUE -->');
            throw daily();
        }, contMod);
        await call(contCtx, 'generateTabContent')(1, 'basicLearn');
        assert.ok(contCtx.alerts.at(-1).includes('뒷부분을 받지 못했습니다') && contCtx.alerts.at(-1).includes('오늘 쓸 수 있는'), contCtx.alerts.at(-1));
        assert.ok(contMod.tabContents.basicLearn.includes('받은 단락입니다.'), '받은 단락은 남긴다');
    });

    await run('미리보기: 제목만 바뀐 섹션은 한 행이고 두 벌로 남지 않는다', async () => {
        const body = '재미의 구조를 세 층으로 나누어 설명합니다. 각 층은 플레이어의 행동과 감정을 연결합니다.';
        const before = `## 옛 제목\n\n${body}\n\n## 다른 섹션\n\n그대로 둘 본문입니다.`;
        const after = `## 새 제목\n\n${body} 한 문장을 더합니다.\n\n## 다른 섹션\n\n그대로 둘 본문입니다.`;
        const rows = call(ctx, 'alignMdSections')(before, after);
        assert.deepStrictEqual(plain(rows).map(row => row.title), ['새 제목', '다른 섹션']);
        const merged = call(ctx, 'composeSectionChoice')(rows, call(ctx, 'defaultAcceptedRows')(rows));
        assert.ok(merged.includes('## 새 제목') && !merged.includes('옛 제목'));
        const unrelated = plain(call(ctx, 'alignMdSections')('## 옛 제목\n\n오래된 설명입니다.', '## 새 제목\n\n완전히 다른 내용을 담은 글입니다.'));
        assert.strictEqual(unrelated.length, 2, '본문이 다르면 새 섹션과 삭제 제안으로 둔다');
    });

    await run('미리보기: 응답이 잘리면 마지막 섹션을 기본으로 고르지 않는다', async () => {
        const rows = call(ctx, 'alignMdSections')('## 하나\n\n첫 원문\n\n## 둘\n\n둘째 원문 전체입니다.', '## 하나\n\n첫 수정\n\n## 둘\n\n둘째');
        assert.deepStrictEqual([...call(ctx, 'defaultAcceptedRows')(rows, true)], [0]);
        assert.deepStrictEqual([...call(ctx, 'defaultAcceptedRows')(rows)], [0, 1]);
    });

    await run('미리보기: 탭 전체를 다시 쓰면 이전 섹션을 기본으로 지운다', async () => {
        const rows = call(ctx, 'alignMdSections')('## 학습 목표\n\n- 목표\n\n## 옛 섹션\n\n오래된 설명입니다.', '## 학습 목표\n\n- 목표\n\n## 1. 새 섹션\n\n완전히 다른 내용을 담은 글입니다.');
        assert.strictEqual(call(ctx, 'defaultAcceptedRows')(rows).size, 1, '부분 수정은 사라진 섹션을 남긴다');
        const merged = call(ctx, 'composeSectionChoice')(rows, call(ctx, 'defaultAcceptedRows')(rows, false, true));
        assert.ok(merged.includes('## 1. 새 섹션') && !merged.includes('옛 섹션'), '두 벌로 남지 않는다');
        const cut = call(ctx, 'composeSectionChoice')(rows, call(ctx, 'defaultAcceptedRows')(rows, true, true));
        assert.ok(cut.includes('옛 섹션'), '잘린 응답이면 이전 섹션을 남긴다');
        const aiCtx = makeContext();
        let html = '';
        aiCtx.onOverlay = overlay => { html = overlay.innerHTML; setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: 'cancel' } } })); };
        await call(aiCtx, 'previewAiChange')('## 옛 섹션\n\n오래된 설명입니다.', '## 새 섹션\n\n완전히 다른 내용을 담은 글입니다.', { rewrite: true });
        assert.ok(html.includes('이전 섹션 · 기본은 삭제'));
    });

    await run('생성 정리: 줄이 나뉜 제목을 잇고 체크리스트를 학습 탭 끝으로 옮긴다', async () => {
        const raw = '## 4. 넷째 (⏱ 40분)\n\n본문입니다.\n\n##\n✅ 학습 후 체크리스트\n\n- 넷째를 확인합니다. (다시 보기: 4. 넷째 (⏱ 40분))\n\n## 5. 다섯째 (⏱ 20분)\n\n본문입니다.';
        const fixed = call(ctx, 'sanitizeMarkdownContent')(raw);
        assert.ok(fixed.includes('## ✅ 학습 후 체크리스트'), '"##" 다음 줄의 제목을 잇는다');
        assert.ok(!call(ctx, 'sanitizeMarkdownContent')('본문\n\n##\n- 목록').includes('## - 목록'), '목록은 제목으로 잇지 않는다');
        const moved = call(ctx, 'checklistLast')(fixed, 'basicLearn');
        assert.deepStrictEqual(plain(call(ctx, 'mdSections')(moved)).map(section => section.title), ['4. 넷째 (⏱ 40분)', '5. 다섯째 (⏱ 20분)', '✅ 학습 후 체크리스트']);
        assert.strictEqual(call(ctx, 'checklistLast')(moved, 'basicLearn'), moved, '이미 끝이면 그대로');
        assert.strictEqual(call(ctx, 'checklistLast')(fixed, 'assessment'), fixed, '학습 탭에만 적용한다');
    });

    await run('학습이해도: 목표가 10개보다 많으면 목표 수만큼 내게 한다', async () => {
        const prompt = n => call(ctx, 'assessmentObjectivePrompt')({ id: 1, tabContents: {}, objectives: Array.from({ length: n }, (_, i) => `목표 ${i + 1}을 설명할 수 있습니다.`) }, 'assessment');
        assert.ok(prompt(12).includes('문제는 12개 이상'));
        assert.ok(prompt(3).includes('문제는 10개 이상'));
        assert.strictEqual(call(ctx, 'assessmentObjectivePrompt')({ objectives: ['목표'] }, 'basicLearn'), '');
    });

    await run('이미지 생성: Higgsfield를 고르면 먼저 쓰고, Gemini 키가 없으면 Gemini로 넘어가지 않는다', async () => {
        let geminiCalls = 0;
        const imgCtx = makeContext(async () => { geminiCalls += 1; throw new Error('Gemini 호출'); });
        vm.runInContext("usesSvgIllustration = () => false; IMAGE_MODEL = 'higgsfield:recraft'; apiKey = '';", imgCtx);
        imgCtx.generateHiggsfieldImage = async (model, prompt) => `data:image/png;base64,${model}|${prompt}`;
        vm.runInContext('generateHiggsfieldImage = window.generateHiggsfieldImage;', imgCtx);
        assert.strictEqual(await call(imgCtx, 'generateImageAPI')('고양이'), 'data:image/png;base64,higgsfield:recraft|고양이');
        imgCtx.generateHiggsfieldImage = async () => { throw new Error('Higgsfield 401: 키가 맞지 않습니다'); };
        vm.runInContext('generateHiggsfieldImage = window.generateHiggsfieldImage;', imgCtx);
        assert.strictEqual(await call(imgCtx, 'generateImageAPI')('고양이'), null);
        assert.strictEqual(geminiCalls, 0, 'Gemini 키가 없으면 부르지 않는다');
        assert.ok(imgCtx.toasts.at(-1).includes('키가 맞지 않습니다'), '실패 이유를 알린다');
        vm.runInContext("apiKey = 'k'; IMAGE_MODEL = 'gemini-nano-banana-2.1';", imgCtx);
        await call(imgCtx, 'generateImageAPI')('고양이');
        assert.strictEqual(geminiCalls, 3, 'Gemini 체인에는 Higgsfield 모델을 넣지 않는다 (Gemini 이미지 모델 3개)');
    });

    await run('검수: 학습이해도가 묻지 않은 학습 목표와 없는 목표 번호를 잡는다', async () => {
        const question = (n, goal) => `### 문제 ${n}. 제목 ${n}\n학습 목표 ${goal} · 밴드 L1 · 객관식\n\n① 가\n② 나\n③ 다\n④ 라\n\n✅ **정답:** ②\n\n📝 **해설:** 해설 문장입니다.`;
        const md = [question(1, 1), question(2, 3)].join('\n\n---\n\n');
        const coverage = lint(md, 'assessment').filter(issue => issue.where === '학습 목표 대응');
        assert.strictEqual(coverage.length, 0, '목표 수를 모르면 보지 않는다');
        const issues = plain(call(ctx, 'lintLessonMarkdown')(md, 'assessment', { objectiveCount: 3 }));
        const gap = issues.find(issue => issue.where === '학습 목표 대응');
        assert.ok(gap && gap.sev === 'warn' && gap.snip === '묻지 않은 학습 목표 2', JSON.stringify(gap));
        assert.ok(!plain(call(ctx, 'lintLessonMarkdown')(md, 'basicLearn', { objectiveCount: 3 })).some(issue => issue.where === '학습 목표 대응'), '학습이해도 탭에만');
        const outOfRange = plain(call(ctx, 'lintLessonMarkdown')(question(1, 5), 'assessment', { objectiveCount: 3 }));
        assert.ok(outOfRange.some(issue => issue.msg === '대응하는 학습 목표가 없습니다.'), '없는 목표 번호');
        const mod = { id: 1, tabContents: {}, objectives: ['가를 설명할 수 있습니다.', '나를 비교할 수 있습니다.', '다를 만들 수 있습니다.'] };
        assert.deepStrictEqual(plain(call(ctx, 'lessonLintContext')(mod, 'assessment')), { objectiveCount: 3 });
        assert.deepStrictEqual(plain(call(ctx, 'lessonLintContext')(mod, 'basicLearn')), {});

        const genMod = { id: 1, title: '차시', tabContents: {}, objectives: mod.objectives };
        const genCtx = generationContext(async () => reply(md), genMod);
        await call(genCtx, 'generateTabContent')(1, 'assessment');
        assert.ok(genCtx.toasts.some(message => message.includes('묻지 않은 학습 목표 2') && message.includes('문제은행')), JSON.stringify(genCtx.toasts));
    });

    await run('탭 이어쓰기: 지금까지 쓴 ## 제목을 함께 넘긴다', async () => {
        let calls = 0;
        const mod = { id: 1, title: '차시', tabContents: {} };
        const contCtx = generationContext(async () => reply(calls++ === 0 ? '## 학습 목표\n\n- 목표\n\n## 1. 첫째 (⏱ 60분)\n\n본문입니다.\n<!-- CONTINUE -->' : '## 2. 둘째 (⏱ 60분)\n\n끝입니다.'), mod);
        vm.runInContext("buildTaskContext = (task, args) => { window.taskArgs = [...(window.taskArgs || []), { task, args }]; return { systemInstruction: '시스템', userPrompt: task }; }", contCtx);
        await call(contCtx, 'generateTabContent')(1, 'basicLearn');
        const cont = contCtx.taskArgs.find(item => item.task === 'tab_content_continue');
        assert.deepStrictEqual(plain(cont.args.writtenHeadings), ['## 학습 목표', '## 1. 첫째 (⏱ 60분)']);
    });

    await run('긴 작업: 탭 하나 만들기는 화면을 막지 않고 진행 막대·알림으로 보이며 한 번에 하나만 돈다', async () => {
        const mod = { id: 1, title: '차시', tabContents: {} };
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const jobCtx = generationContext(async () => { await gate; return reply('## 본문\n\n완성한 글입니다.'); }, mod);
        const running = call(jobCtx, 'runTabJob')(1, 'basicPrac');
        await new Promise(resolve => setImmediate(resolve));
        const bar = jobCtx.elements['lesson-pipeline-bar'];
        const tabLabel = call(jobCtx, 'LESSON_TABS').find(tab => tab.id === 'basicPrac').label;
        assert.ok(bar?.innerHTML.includes(`${tabLabel} 만들기`), '진행 막대에 작업 이름');
        assert.ok(call(jobCtx, 'isPipelineStep')('basicPrac', 1), '탭 표시가 이 탭을 만드는 중');
        assert.strictEqual(call(jobCtx, 'lessonPipelineKind')(), 'job');
        const busy = await call(jobCtx, 'runTabJob')(1, 'advPrac');
        assert.ok(busy.busy && jobCtx.alerts.at(-1).includes('진행 중인 생성'), '다른 작업은 끝난 뒤에');
        release();
        await running;
        assert.ok(mod.tabContents.basicPrac.includes('완성한 글입니다.'));
        assert.notStrictEqual(jobCtx.elements['editor-loading'].style.display, 'flex', '화면을 막지 않는다');
        assert.ok(bar.removed && !call(jobCtx, 'isLessonPipelineRunning')(), '끝나면 막대를 닫는다');
        assert.ok(jobCtx.toasts.some(message => message.includes('탭이 생성되었습니다')), '완료는 알림으로');

        const previous = { id: 1, title: '차시', tabContents: { basicLearn: '## 이전\n\n이전 글입니다.' } };
        const regenCtx = generationContext(async () => reply('## 새 글\n\n다시 쓴 글입니다.'), previous);
        answerPreview(regenCtx, 'apply');
        await call(regenCtx, 'runTabJob')(1, 'basicLearn');
        assert.ok(previous.tabContents.basicLearn.includes('다시 쓴 글입니다.'));
        assert.notStrictEqual(regenCtx.elements['editor-loading'].style.display, 'flex', '미리보기를 반영한 뒤에도 화면을 막지 않는다');
    });

    await run('긴 작업: 이미지는 양 설정·중지·진행·최신 글을 따른다', async () => {
        const imgCtx = makeContext();
        const process = (md, opts) => call(imgCtx, 'realProcessImageTags')({ id: 1, images: {} }, md, opts);
        const md = '## 1. 첫째 (⏱ 30분)\n\n본문 하나입니다.\n\n<!-- [IMG: "a"] -->\n\n더 쓴 글입니다.\n\n<!-- [IMG: "b"] -->\n\n## 2. 둘째 (⏱ 30분)\n\n본문 둘입니다.\n\n<!-- [IMG: "c"] -->';
        const picked = plain(call(imgCtx, 'pickImageTags')(md, ['a', 'b', 'c'].map(k => ({ fullMatch: `<!-- [IMG: "${k}"] -->`, keyword: k })), 'section')).map(tag => tag.keyword);
        assert.deepStrictEqual(picked, ['a', 'c'], '핵심만은 ## 섹션마다 한 장');
        assert.strictEqual(await process(md, { amount: 'none' }), md, '넣지 않음은 태그를 그대로 둔다');

        const statuses = [];
        const sectionOut = await process(md, { amount: 'section', onStatus: text => statuses.push(text), isStopped: () => false });
        assert.ok(!sectionOut.includes('[IMG: "a"]') && sectionOut.includes('[IMG: "b"]') && !sectionOut.includes('[IMG: "c"]'), '고르지 않은 태그는 남긴다');
        assert.ok(statuses[0].includes('이미지 1/2') && statuses[0].includes('계산 중'), statuses[0]);
        assert.ok(statuses[1].includes('이미지 2/2') && statuses[1].includes('남은 시간 약'), statuses[1]);

        let checks = 0;
        const stopped = await process(md, { amount: 'all', isStopped: () => checks++ >= 1 });
        assert.ok(!stopped.includes('[IMG: "a"]') && stopped.includes('[IMG: "b"]') && stopped.includes('[IMG: "c"]'), '중지하면 남은 태그를 둔다');
        assert.ok(imgCtx.toasts.some(message => message.includes('2건은 남겨 두었습니다')), '이어서 만드는 법을 알린다');

        const latest = await process(md, { amount: 'section', isStopped: () => false, latest: () => `${md}\n\n기다리는 동안 덧붙인 문단입니다.` });
        assert.ok(latest.includes('덧붙인 문단') && !latest.includes('[IMG: "a"]'), '기다리는 동안 고친 글 위에 이미지를 넣는다');
    });

    await run('긴 작업: 일괄 이미지 찾기는 탭마다 채워 저장한다', async () => {
        const body = '## 1. 첫째 (⏱ 30분)\n\n본문입니다.\n\n<!-- [IMG: "a"] -->';
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: body, basicPrac: '## 실습\n\n내용입니다.' }, content: '' };
        const batchCtx = generationContext(async () => reply('{}'), mod);
        vm.runInContext('processImageTags = window.realProcessImageTags;', batchCtx);
        // 차시는 열린 교과에 있다(일괄 작업은 그리는 동안에도 지금 데이터의 그 차시인지 본다)
        vm.runInContext("globalState = { subjects: [{ id: 's1', title: '교과', lessons: [window.currentMod] }] }; currentSubjectId = 's1'; courseData = globalState.subjects[0].lessons;", batchCtx);
        assert.deepStrictEqual(plain(call(batchCtx, 'imageTagTabs')(mod)).map(tab => tab.id), ['basicLearn']);
        await call(batchCtx, 'generateAllImagesInModule')(1);
        assert.ok(!mod.tabContents.basicLearn.includes('<!-- [IMG:'), '탭 글의 태그를 채운다');
        assert.ok(!mod.content.includes('<!-- [IMG:'), '합친 본문도 탭 글로 다시 만든다');
        assert.ok(batchCtx.toasts.some(message => message.includes('일괄 이미지 찾기를 마쳤습니다')), JSON.stringify(batchCtx.toasts));
        assert.ok(batchCtx.elements['lesson-pipeline-bar']?.removed, '진행 막대를 썼다가 닫는다');
    });

    await run('미리보기: 섹션 제목을 이스케이프한다', async () => {
        const aiCtx = makeContext();
        let html = '';
        aiCtx.onOverlay = overlay => { html = overlay.innerHTML; setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: 'cancel' } } })); };
        await call(aiCtx, 'previewAiChange')('## 가\n\n글', '## 가 <img src=x onerror=alert(1)>\n\n다른 글입니다.');
        assert.ok(!html.includes('<img src=x') && html.includes('&lt;img src=x'));
    });

    await run('미리보기: 섹션 짝짓기와 선택 반영', async () => {
        const before = '머리말입니다.\n\n## 하나\n\n첫 원문\n\n## 둘\n\n둘째 원문\n\n## 셋\n\n셋째 원문';
        const after = '머리말입니다.\n\n## 하나\n\n첫 수정\n\n## 셋\n\n셋째 원문\n\n## 넷\n\n새 내용';
        const rows = call(ctx, 'alignMdSections')(before, after);
        assert.deepStrictEqual(plain(rows).map(row => [row.title, !!row.before, !!row.after]), [['', true, true], ['하나', true, true], ['둘', true, false], ['셋', true, true], ['넷', false, true]]);
        const accepted = call(ctx, 'defaultAcceptedRows')(rows);
        assert.deepStrictEqual([...accepted], [1, 4], '사라진 섹션은 기본으로 남긴다');
        const merged = call(ctx, 'composeSectionChoice')(rows, accepted);
        assert.ok(merged.includes('첫 수정') && merged.includes('둘째 원문') && merged.includes('새 내용'));
        assert.ok(merged.indexOf('둘째 원문') < merged.indexOf('셋째 원문'), '사라진 섹션은 원래 자리에');
        const none = call(ctx, 'composeSectionChoice')(rows, new Set());
        assert.ok(none.includes('첫 원문') && !none.includes('새 내용'), '고르지 않으면 원문');
    });

    await run('미리보기: 지적 수와 취소', async () => {
        const before = '## 하나\n\n앞에서 다룹니다.\n\n## 둘\n\n매우 빠릅니다.';
        const after = '## 하나\n\n도메인을 다룹니다.\n\n## 둘\n\n2배 빠릅니다.';
        assert.strictEqual(call(ctx, 'lintDeltaLabel')(before, after), '검수 지적 필수 1 → 0 · 권장 1 → 0');
        const aiCtx = makeContext();
        answerPreview(aiCtx, 'apply', [[1, false]]);
        const applied = await call(aiCtx, 'previewAiChange')(before, after, { title: '<b>제목</b>' });
        assert.ok(applied.includes('도메인을 다룹니다.') && applied.includes('매우 빠릅니다.'), '체크를 푼 섹션은 원문');
        assert.ok(!aiCtx.overlays[0].innerHTML.includes('<b>제목</b>'), '제목을 이스케이프한다');
        answerPreview(aiCtx, 'cancel');
        assert.strictEqual(await call(aiCtx, 'previewAiChange')(before, after), null);
    });

    await run('보강: 미리보기를 거쳐 반영한다', async () => {
        const original = '## 본문\n\n원래 글입니다.';
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: original } };
        const aiCtx = generationContext(async () => reply('## 본문\n\n보강한 글입니다.'), mod);
        aiCtx.elements['ai-command-input'].value = '예시 추가';
        answerPreview(aiCtx, 'cancel');
        await call(aiCtx, 'reinforceCurrentTab')(1, '예시 추가');
        assert.strictEqual(mod.tabContents.basicLearn, original, '취소하면 그대로');
        assert.strictEqual(aiCtx.archived.length, 0);
        assert.strictEqual(aiCtx.elements['ai-command-input'].value, '예시 추가', '취소하면 요청을 남긴다');
        answerPreview(aiCtx, 'apply');
        await call(aiCtx, 'reinforceCurrentTab')(1, '예시 추가');
        assert.strictEqual(aiCtx.elements['ai-command-input'].value, '', '반영하면 요청 칸을 비운다');
        assert.ok(mod.tabContents.basicLearn.includes('보강한 글입니다.'));
        assert.strictEqual(aiCtx.archived[0].content, original, '바꾸기 전 내용을 히스토리에 남긴다');
        assert.strictEqual(aiCtx.archived[0].tabId, 'basicLearn');
        assert.strictEqual(aiCtx.archived[0].lesson, mod);
        assert.strictEqual(aiCtx.archived[0].reason, '고치기 전');
        assert.strictEqual(aiCtx.archived[0].title, '차시 · 기본학습', '탭이 있는 차시는 제목에 그 탭 이름');
        assert.ok(mod.history[0].note.includes('예시 추가'));
        assert.notStrictEqual(aiCtx.elements['editor-loading'].style.display, 'flex', '화면을 막지 않는다');
        assert.ok(aiCtx.elements['lesson-pipeline-bar']?.removed, '진행 막대를 띄웠다가 닫는다');
        assert.ok(aiCtx.toasts.some(message => message.includes('AI 수정을 반영했습니다')), '끝나면 알림으로 알린다');
    });

    await run('보강: 고정 섹션과 잘린 응답', async () => {
        const original = '## 고정\n\n원문입니다.\n\n## 본문\n\n원래 글입니다.';
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: original }, lockedSections: { basicLearn: ['고정'] } };
        const aiCtx = generationContext(async () => reply('## 고정\n\n바뀐 글입니다.\n\n## 본문\n\n보강', 'MAX_TOKENS'), mod);
        let html = '';
        aiCtx.onOverlay = overlay => { html = overlay.innerHTML; setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: 'apply' } } })); };
        await call(aiCtx, 'reinforceCurrentTab')(1, '보강');
        assert.ok(html.includes('잘렸습니다'), '잘린 응답을 알린다');
        assert.ok(mod.tabContents.basicLearn.includes('원문입니다.') && !mod.tabContents.basicLearn.includes('바뀐 글'));
        assert.ok(mod.tabContents.basicLearn.includes('원래 글입니다.'), '잘린 마지막 섹션이 본문을 덮지 않는다');
    });

    await run('탭 전체 AI 수정: 탭 없이 본문만 있는 최종 평가·옛 차시도 고친다', async () => {
        const original = '## 최종 평가\n\n원래 과제입니다.';
        const fixed = '## 최종 평가\n\n고친 과제입니다.';
        const mod = { id: 'mainQuest', title: '최종 평가', content: original };
        const aiCtx = generationContext(async () => reply(fixed), mod);
        answerPreview(aiCtx, 'apply');
        await call(aiCtx, 'reinforceCurrentTab')('mainQuest', '채점 기준을 더해 줘');
        assert.ok(!aiCtx.alerts.some(message => message.includes('먼저 이 탭의 교안을 생성')), '내용이 있으면 생성하라고 하지 않는다');
        assert.strictEqual(mod.content, fixed, '탭이 없으면 본문에 반영한다');
        assert.strictEqual(mod.tabContents, undefined, '탭을 새로 만들지 않는다');
        assert.strictEqual(aiCtx.archived[0].content, original, '고치기 전 본문을 남긴다');
        assert.strictEqual(aiCtx.archived[0].lesson, mod);
        assert.strictEqual(aiCtx.archived[0].title, '최종 평가', '탭이 없는 최종 평가는 본문 전체라 기록 제목에 탭 이름을 붙이지 않는다');
    });

    await run('패널: AI 수정 제안은 수락해야 반영한다', async () => {
        const original = '## 본문\n\n앞에서 다룹니다.';
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: original } };
        const aiCtx = makeContext(async () => reply('## 본문\n\n도메인을 다룹니다.'));
        aiCtx.currentMod = mod;
        aiCtx.onOverlay = overlay => { if (!overlay.id) setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: 'cancel' } } })); };
        call(aiCtx, 'runConventionCheck')(1);
        assert.ok(aiCtx.elements['lesson-review-dialog'].innerHTML.includes('필수 3건'), '다른 차시 지칭, 학습 목표 없음, 개요 없음');
        await call(aiCtx, 'proposeLessonFix')();
        assert.strictEqual(mod.tabContents.basicLearn, original, '취소하면 그대로');
        aiCtx.onOverlay = overlay => setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: 'apply' } } }));
        await call(aiCtx, 'proposeLessonFix')();
        assert.ok(mod.tabContents.basicLearn.includes('도메인을 다룹니다.'));
        assert.strictEqual(aiCtx.archived.length, 1);
        assert.strictEqual(aiCtx.archived[0].tabId, 'basicLearn');
        assert.strictEqual(aiCtx.archived[0].reason, '고치기 전');
    });

    await run('패널: 기다리는 동안 탭이 바뀌면 덮어쓰지 않는다', async () => {
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '## 본문\n\n앞에서 다룹니다.' } };
        const aiCtx = makeContext(async () => {
            mod.tabContents.basicLearn = '## 본문\n\n사용자가 그사이 고친 글입니다.';
            return reply('## 본문\n\n도메인을 다룹니다.');
        });
        aiCtx.currentMod = mod;
        call(aiCtx, 'runConventionCheck')(1);
        aiCtx.onOverlay = overlay => setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: 'apply' } } }));
        await call(aiCtx, 'proposeLessonFix')();
        assert.ok(mod.tabContents.basicLearn.includes('사용자가 그사이 고친 글입니다.'));
        assert.strictEqual(aiCtx.archived.length, 0);
        assert.ok(aiCtx.alerts.at(-1).includes('반영하지 않았습니다'));
    });

    await run('패널: 지적이 모두 고정 섹션이면 호출하지 않는다', async () => {
        let calls = 0;
        const mod = { id: 1, title: '차시', tabContents: { basicPrac: '## 고정\n\n앞에서 다룹니다.' }, lockedSections: { basicPrac: ['고정'] } };
        const aiCtx = makeContext(async () => { calls += 1; return reply(''); });
        aiCtx.currentMod = mod;
        vm.runInContext("currentLessonTab = 'basicPrac'", aiCtx);
        call(aiCtx, 'runConventionCheck')(1);
        await call(aiCtx, 'proposeLessonFix')();
        assert.strictEqual(calls, 0);
        assert.ok(aiCtx.alerts.at(-1).includes('고정'));
    });

    await run('패널: 사용자와 AI 문자열을 이스케이프한다', async () => {
        const html = call(ctx, 'reviewPanelHtml')({ title: '차시' }, 'basicLearn', '## <img src=x onerror=alert(1)>\n\n앞에서 <b>다룹니다</b>.\n\n"앞서"<script>', false);
        assert.ok(!/<img src=x/.test(html) && !html.includes('<script>'));
        assert.ok(html.includes('&lt;img src=x'));
        ['필수', '수동 검수', '검사 규칙 목록', '학습 목표 0개'].forEach(text => assert.ok(html.includes(text), text));
        assert.ok(call(ctx, 'reviewPanelHtml')({}, 'assessment', '## 본문\n\n글입니다.', false).includes('객관식:'), '학습이해도 탭은 문항 규칙도 보여 준다');
    });

    await run('수동 검수: 차시·탭별 기록과 내용 변경 표시', async () => {
        const withCheck = call(ctx, 'withManualCheck');
        const mod = { manualReview: { assessment: { strength: { at: 'old', hash: 1 } } } };
        const next = plain(withCheck(mod, 'basicLearn', 'domain', true, '본문', '2026-11-02T10:00:00.000Z'));
        assert.strictEqual(next.basicLearn.domain.at, '2026-11-02T10:00:00.000Z');
        assert.ok(next.assessment.strength, '다른 탭 기록은 유지');
        assert.deepStrictEqual(mod.manualReview.basicLearn, undefined, '원본은 바꾸지 않는다');
        assert.deepStrictEqual(plain(withCheck({ manualReview: next }, 'basicLearn', 'domain', false, '본문', 'x')).basicLearn, {}, '해제하면 기록을 지운다');
        const state = call(ctx, 'manualCheckState');
        assert.strictEqual(state(next.basicLearn.domain, '본문'), 'ok');
        assert.strictEqual(state(next.basicLearn.domain, '바뀐 본문'), 'stale');
        assert.strictEqual(state(undefined, '본문'), 'none');
        assert.deepStrictEqual(plain(call(ctx, 'manualChecksFor')('basicPrac')).map(check => check.key), ['strength', 'version'], '개요·대응 항목은 학습 탭만');
        assert.strictEqual(call(ctx, 'manualChecksFor')('basicLearn').length, 4);
        const html = withTimeZone('Asia/Seoul', () => call(ctx, 'manualCheckRow')({ key: 'domain', text: '확인', hint: '힌트' }, next.basicLearn.domain, '본문'));
        assert.ok(html.includes('확인함 · 2026-11-02 19:00') && html.includes('checked'), '확인한 시각은 이 컴퓨터 시각(한국 시각)으로 보인다');
    });

    await run('수동 검수: 패널에서 저장하고 이력을 남긴다', async () => {
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '## 본문\n\n글입니다.' } };
        const aiCtx = makeContext();
        aiCtx.currentMod = mod;
        call(aiCtx, 'runConventionCheck')(1);
        await call(aiCtx, 'onReviewChange')({ target: { dataset: { manualKey: 'domain' }, checked: true } });
        assert.ok(mod.manualReview.basicLearn.domain.at);
        assert.ok(mod.history[0].note.startsWith('수동 검수 확인'));
        assert.strictEqual(aiCtx.saved, 1);
    });

    await run('배지: 지적 수와 빈 탭', async () => {
        const mod = { id: 1, title: '차시', tabContents: { basicPrac: '## 본문\n\n앞에서 매우 빠릅니다.' } };
        const aiCtx = makeContext();
        aiCtx.currentMod = mod;
        const badge = fakeElement();
        aiCtx.elements['convention-check-count'] = badge;
        vm.runInContext("currentLessonTab = 'basicPrac'", aiCtx);
        call(aiCtx, 'syncReviewBadge')(mod);
        assert.strictEqual(badge.textContent, '필수 1 · 권장 1');
        assert.ok(badge.className.includes('rose'));
        mod.tabContents.basicPrac = '## 본문\n\n글입니다.';
        call(aiCtx, 'syncReviewBadge')(mod);
        assert.strictEqual(badge.textContent, '통과');
        mod.tabContents.basicPrac = '';
        call(aiCtx, 'syncReviewBadge')(mod);
        assert.deepStrictEqual([badge.textContent, badge.className], ['', 'hidden']);
    });

    await run('저장: 수정 모드 편집이 탭에 남는다', async () => {
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '기본 local:img_1', basicPrac: '실습 local:img_2', advLearn: null, advPrac: null, assessment: null }, images: { img_1: 'a', img_2: 'b', img_3: 'c' }, content: '기본 local:img_1\n\n---\n\n실습 local:img_2' };
        const aiCtx = makeContext();
        aiCtx.currentMod = mod;
        const raw = fakeElement();
        raw.value = '고친 실습 local:img_2 &nbsp;';
        raw.dataset = { moduleId: '1', tabId: 'basicPrac' };
        aiCtx.elements['raw-view'] = raw;
        call(aiCtx, 'saveRawContent')();
        assert.strictEqual(mod.tabContents.basicPrac, '고친 실습 local:img_2 &nbsp;');
        assert.ok(mod.content.includes('기본 local:img_1') && mod.content.includes('고친 실습'), 'content는 전 탭을 합친 값');
        assert.ok(mod.images.img_1, '다른 탭의 이미지를 지우지 않는다');
        assert.ok(!mod.images.img_3, '어느 탭에도 없는 이미지만 정리한다');
        assert.strictEqual(aiCtx.saved, 1);
        call(aiCtx, 'saveRawContent')();
        assert.strictEqual(aiCtx.saved, 1, '바뀌지 않았으면 다시 저장하지 않는다');
    });

    await run('저장: 편집기를 그린 탭에 저장한다', async () => {
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '기본', basicPrac: '실습' } };
        const aiCtx = makeContext();
        aiCtx.currentMod = mod;
        const raw = fakeElement();
        raw.value = '기본 고침';
        raw.dataset = { moduleId: '1', tabId: 'basicLearn' };
        aiCtx.elements['raw-view'] = raw;
        vm.runInContext("currentLessonTab = 'basicPrac'", aiCtx);
        call(aiCtx, 'saveRawContent')();
        assert.deepStrictEqual(plain(mod.tabContents), { basicLearn: '기본 고침', basicPrac: '실습' });
        const other = { id: 2, title: '다른 차시', tabContents: { basicLearn: '다른 원문' } };
        aiCtx.currentMod = other;
        aiCtx.otherMod = mod;
        raw.value = '먼저 차시 고침';
        call(aiCtx, 'saveRawContent')();
        assert.strictEqual(mod.tabContents.basicLearn, '먼저 차시 고침', '화면이 다른 차시로 바뀌어도 그린 차시에 저장한다');
        assert.strictEqual(other.tabContents.basicLearn, '다른 원문');
    });

    // 그림 지우기 흉내: 보고 있는 차시·탭을 정하고, 묻는 창의 답(answer, 함수면 기다리는 동안 한 일)과 탭 저장(writeLessonTab)을 남긴다.
    // 네이티브 confirm은 두지 않는다(남아 있으면 부르다 실패한다)
    function pictureContext(mod, { answer = true, tabId = 'basicLearn' } = {}) {
        const ctx = makeContext();
        ctx.currentMod = mod;
        ctx.currentEditingModuleId = mod.id;
        vm.runInContext(`currentLessonTab = '${tabId}'`, ctx);
        ctx.asked = [];
        ctx.confirmAsync = async (message, opts) => {
            ctx.asked.push({ message, opts });
            return typeof answer === 'function' ? answer(ctx) : answer;
        };
        ctx.written = [];
        ctx.writeLessonTab = async (m, tab, md) => {
            call(ctx, 'setTabMarkdown')(m, tab, md);
            ctx.written.push({ tab, md });
            await ctx.saveState();
        };
        return ctx;
    }

    await run('저장: 이미지 삭제 후 숨겨진 편집기가 참조를 되살리지 않는다', async () => {
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '앞 ![그림](local:img_1) 뒤' }, images: { img_1: 'a' } };
        const aiCtx = pictureContext(mod);
        const raw = fakeElement();
        raw.value = mod.tabContents.basicLearn;
        raw.dataset = { moduleId: '1', tabId: 'basicLearn' };
        aiCtx.elements['raw-view'] = raw;
        await call(aiCtx, 'deleteImage')('img_1');
        assert.ok(!raw.value.includes('local:img_1'));
        assert.strictEqual(raw.storedFrom, '앞  뒤', '칸을 맞춘 저장된 글(storedFrom)을 남긴다');
        assert.strictEqual(raw.lastSaved, raw.value);
        // 다른 차시를 그린 원문 칸에는 쓰지 않는다
        const next = { id: 1, title: '차시', tabContents: { basicLearn: '앞 ![그림](local:img_1) 뒤' }, images: { img_1: 'a' } };
        const other = pictureContext(next);
        const otherRaw = fakeElement();
        otherRaw.value = '다른 차시 원문';
        otherRaw.dataset = { moduleId: '2', tabId: 'basicLearn' };
        other.elements['raw-view'] = otherRaw;
        await call(other, 'deleteImage')('img_1');
        assert.strictEqual(next.tabContents.basicLearn, '앞  뒤');
        assert.deepStrictEqual([otherRaw.value, otherRaw.storedFrom], ['다른 차시 원문', undefined]);
    });

    await run('저장: 메인 퀘스트와 탭이 비어 있는 옛 차시', async () => {
        const setTab = call(ctx, 'setTabMarkdown');
        const quest = { content: '퀘스트' };
        setTab(quest, 'basicLearn', '고친 퀘스트');
        assert.deepStrictEqual(plain(quest), { content: '고친 퀘스트' }, '탭이 없는 항목에 탭을 만들지 않는다');
        const legacy = { content: '옛 본문', tabContents: { basicLearn: null, basicPrac: null } };
        setTab(legacy, 'basicPrac', '새 실습');
        assert.ok(legacy.content.includes('옛 본문') && legacy.content.includes('새 실습'), '다른 탭을 고쳐도 옛 본문을 잃지 않는다');
    });

    await run('서식 도구: 감싸기와 줄 머리', async () => {
        const wrap = (v, s, e) => plain(call(ctx, 'mdWrapEdit')(v, s, e, '**', '**', '굵은 글씨'));
        assert.deepStrictEqual(wrap('가나다', 1, 2), { from: 1, to: 2, text: '**나**', selStart: 3, selEnd: 4 });
        assert.deepStrictEqual(wrap('가**나**다', 3, 4), { from: 1, to: 6, text: '나', selStart: 1, selEnd: 2 }, '한 번 더 누르면 푼다');
        assert.strictEqual(wrap('', 0, 0).text, '**굵은 글씨**');
        const tools = call(ctx, 'MD_TOOLS');
        const tool = id => tools.find(item => item.id === id).edit;
        assert.strictEqual(tool('bullet')('가\n나', 0, 3).text, '- 가\n- 나');
        assert.strictEqual(tool('bullet')('- 가\n- 나', 0, 7).text, '가\n나', '모두 목록이면 뗀다');
        assert.strictEqual(tool('number')('- 가\n  - 나', 0, 9).text, '1. 가\n  2. 나', '다른 기호는 바꾸고 들여쓰기는 유지');
        assert.strictEqual(tool('heading')('제목', 0, 0).text, '## 제목');
        assert.strictEqual(tool('quote')('가\n\n나', 0, 4).text, '> 가\n\n> 나', '빈 줄은 건너뛴다');
        assert.strictEqual(tool('code')('한 줄', 0, 4).text, '`한 줄`');
        assert.ok(tool('code')('가\n나', 0, 3).text.startsWith('```\n가\n나\n```'));
    });

    await run('서식 도구: 표는 컨벤션의 HTML 표', async () => {
        const edit = call(ctx, 'mdTableEdit')('글', 1, 1);
        assert.ok(edit.text.startsWith('\n\n<table style="border-collapse: collapse; width: 100%;">') && !edit.text.includes('|---'));
        assert.ok(edit.text.includes('background-color: #f2f2f2'));
        assert.strictEqual(`글${edit.text}`.slice(edit.selStart, edit.selEnd), '항목', '첫 칸을 선택한다');
    });

    await run('서식 도구: 목록 줄의 Enter', async () => {
        const enter = (v, pos = v.length) => plain(call(ctx, 'mdListEnterEdit')(v, pos));
        assert.strictEqual(enter('- 가').text, '\n- ');
        assert.strictEqual(enter('  * 가').text, '\n  * ');
        assert.strictEqual(enter('3. 가').text, '\n4. ');
        assert.strictEqual(enter('2) 가').text, '\n3) ');
        assert.strictEqual(enter('- [x] 가').text, '\n- [ ] ', '체크 목록은 비어 있는 칸으로 잇는다');
        assert.deepStrictEqual(enter('가\n- '), { from: 2, to: 4, text: '', selStart: 2, selEnd: 2 }, '빈 항목은 목록을 끝낸다');
        assert.strictEqual(enter('  - ').text, '  ', '들여쓰기는 남긴다');
        assert.strictEqual(enter('일반 글'), null);
        assert.strictEqual(enter('- 가\n나'), null, '현재 줄만 본다');
    });

    await run('빠른 지시: 이어 붙이기', async () => {
        const append = call(ctx, 'appendAiInstruction');
        assert.strictEqual(append('', '더 짧게'), '더 짧게');
        assert.strictEqual(append('예시 추가', '더 짧게'), '예시 추가, 더 짧게');
        assert.strictEqual(append('예시를 넣습니다.', '더 짧게'), '예시를 넣습니다. 더 짧게');
        assert.strictEqual(call(ctx, 'AI_EDIT_CHIPS').length, 8);
    });

    await run('Pixabay: 검색어를 100자로 자르고 거절 이유를 알린 뒤 같은 키로 다시 부르지 않는다', async () => {
        const ctx = makeContext();
        const cut = call(ctx, 'pixabayQuery');
        const long = Array.from({ length: 30 }, (_, i) => `낱말${i}`).join(' ');
        assert.ok(cut(long).length <= 100 && !cut(long).endsWith(' '));
        assert.strictEqual(cut('  게임   루프 '), '게임 루프');
        const urls = [];
        ctx.fetch = async url => { urls.push(String(url)); return { ok: false, status: 400, text: async () => '[ERROR 400] "key" is invalid' }; };
        vm.runInContext('pixabayApiKey = "test-placeholder"', ctx);
        const search = call(ctx, 'searchPixabayAPI');
        assert.strictEqual(await search(long), null);
        assert.ok(decodeURIComponent(urls[0].match(/[?&]q=([^&]+)/)[1]).length <= 100, '보내는 q는 100자 이하');
        assert.ok(urls[0].includes('&lang=ko'), '한글 검색어는 한국어로 찾는다');
        assert.ok(ctx.toasts.at(-1).includes('키를 거절'));
        assert.strictEqual(await search('game loop'), null);
        assert.strictEqual(urls.length, 1, '거절된 키로 다시 요청하지 않는다');
        vm.runInContext('pixabayApiKey = "test-placeholder-2"', ctx);
        await search('game loop');
        assert.strictEqual(urls.length, 2, '키를 바꾸면 다시 시도한다');
        assert.ok(!urls[1].includes('lang=ko'));
    });

    /* ---------- 묶음 8: 그림 정리, 원문 칸 넣기, AI 명령줄이 넣을 자리, 그림 지우기·미리 보기, 시각 ---------- */
    await run('그림 정리: 교수안·편성안·슬라이드 편집·삽화·판서 영상·고정 섹션이 쓰는 그림은 남긴다', async () => {
        const ctx = makeContext();
        const unused = (mod, extra) => plain(call(ctx, 'unusedLessonImageIds')(mod, extra));
        const mod = {
            images: { img_1: 'a', img_doc: 'b', img_deck: 'c', img_h: 'd', img_ill: 'e', img_wb: 'f', img_lock: 'g', img_gone: 'h' },
            tabContents: { basicLearn: '기본 local:img_1', basicPrac: { 이상한: 'local:img_gone' } },
            gyosuan: { docMd: '![붙여넣은 이미지](local:img_doc)', deckMd: '![](local:img_deck)', deckHtml: '<img src="local:img_h">', sessionDecks: { 0: '<img src="data:image/png;base64,AA">' } },
            illustrations: [{ id: 'a', imgId: 'img_ill' }, { id: 'b', imgId: null }],
            whiteboardVideos: { img_wb: { id: 'v' } }
        };
        assert.deepStrictEqual(unused(mod), ['img_lock', 'img_gone'], '글이 아닌 탭 값은 건너뛴다');
        assert.deepStrictEqual(unused(mod, ['## 고정\n\n<img src="local:img_lock">']), ['img_gone']);
        assert.deepStrictEqual(unused(null), []);
        assert.deepStrictEqual(unused({}), []);
        assert.deepStrictEqual(unused({ images: { a: 1 }, illustrations: {}, whiteboardVideos: 'x', gyosuan: 'local:a', tabContents: 'local:a' }), ['a'], '모양이 틀린 칸은 던지지 않고 건너뛴다');
        assert.deepStrictEqual(unused({ images: { img_1: 1, img_10: 1 }, content: 'local:img_10' }), [], '지우는 쪽보다 남기는 쪽');
        assert.deepStrictEqual(unused({ images: { ref: 'teacher-image:0123456789abcdef1a', empty: '' }, content: 'local:ref local:empty' }), [], '찾지 못한 그림 자리·빈 값도 글이 가리키면 남긴다');
        const regen = { images: { img_old: 'a', img_doc: 'b' }, tabContents: { basicLearn: null }, content: '', gyosuan: { docMd: '![](local:img_doc)' } };
        call(ctx, 'dropUnusedLessonImages')(regen);
        assert.deepStrictEqual(Object.keys(regen.images), ['img_doc'], '다시 만들 때도 교수안 그림은 남긴다');
    });

    await run('저장: 교수안·편성안·삽화·판서 영상이 쓰는 그림은 원문 저장에서 지우지 않는다', async () => {
        const mod = {
            id: 1, title: '차시', tabContents: { basicLearn: '기본 local:img_1' }, content: '기본 local:img_1',
            images: { img_1: 'a', img_doc: 'b', img_deck: 'c', img_ill: 'd', img_wb: 'e', img_gone: 'f' },
            gyosuan: { docMd: '![붙여넣은 이미지](local:img_doc)', deckMd: '![](local:img_deck)' },
            illustrations: [{ id: 'a', imgId: 'img_ill' }], whiteboardVideos: { img_wb: { id: 'v' } }
        };
        const aiCtx = makeContext();
        aiCtx.currentMod = mod;
        const raw = fakeElement();
        raw.value = '고친 기본 local:img_1';
        raw.dataset = { moduleId: '1', tabId: 'basicLearn' };
        aiCtx.elements['raw-view'] = raw;
        call(aiCtx, 'saveRawContent')();
        assert.strictEqual(mod.tabContents.basicLearn, '고친 기본 local:img_1');
        assert.deepStrictEqual(Object.keys(mod.images).sort(), ['img_1', 'img_deck', 'img_doc', 'img_ill', 'img_wb']);
        assert.strictEqual(aiCtx.saved, 1);
    });

    await run('원문 칸: 열어 둔 칸에서 고친 글만 넣고, 손대지 않은 칸은 넣지 않는다', async () => {
        const aiCtx = makeContext();
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '기본' } };
        aiCtx.currentMod = mod;
        const raw = fakeElement();
        let hidden = false;
        raw.classList = { add() {}, remove() {}, toggle() {}, contains: cls => cls === 'hidden' && hidden };
        raw.dataset = { moduleId: '1', tabId: 'basicLearn' };
        raw.value = '기본';
        aiCtx.elements['raw-view'] = raw;
        const pendingNow = () => call(aiCtx, 'hasPendingRawEdit')();
        assert.strictEqual(pendingNow(), false);
        raw.value = '기본 고침';
        assert.strictEqual(pendingNow(), true);
        call(aiCtx, 'flushVisibleRawView')();
        assert.strictEqual(mod.tabContents.basicLearn, '기본 고침');
        assert.strictEqual(pendingNow(), false);
        mod.tabContents.basicLearn = '기본 고침 + 삽화'; // 칸을 그대로 둔 사이 다른 기능이 탭을 바꿨다
        call(aiCtx, 'flushVisibleRawView')();
        assert.strictEqual(mod.tabContents.basicLearn, '기본 고침 + 삽화', '손대지 않은 칸의 옛 글로 덮지 않는다');
        raw.value = '숨은 칸 글';
        hidden = true;
        assert.strictEqual(pendingNow(), false);
        call(aiCtx, 'flushVisibleRawView')();
        assert.strictEqual(mod.tabContents.basicLearn, '기본 고침 + 삽화', '숨은 칸은 넣지 않는다');
        // 브라우저의 칸은 그린 글을 defaultValue로 기억한다. 그 글 그대로면 저장된 탭이 그사이 바뀌었어도 넣지 않는다
        const drawn = fakeElement();
        drawn.dataset = { moduleId: '1', tabId: 'basicLearn' };
        drawn.value = drawn.defaultValue = '그릴 때 글';
        aiCtx.elements['raw-view'] = drawn;
        call(aiCtx, 'flushVisibleRawView')();
        assert.strictEqual(mod.tabContents.basicLearn, '기본 고침 + 삽화', '그린 뒤 손대지 않은 칸');
        // 탭이 없는 최종 평가를 기본학습이 아닌 탭에서 원문으로 열면 칸이 빈다. 손대지 않았으면 본문을 지우지 않는다
        const quest = { id: 'mainQuest', title: '최종 평가', content: '퀘스트 본문', images: {} };
        aiCtx.currentMod = quest;
        const questRaw = fakeElement();
        questRaw.dataset = { moduleId: 'mainQuest', tabId: 'advLearn' };
        questRaw.value = '';
        aiCtx.elements['raw-view'] = questRaw;
        assert.strictEqual(call(aiCtx, 'hasPendingRawEdit')(), false);
        call(aiCtx, 'flushVisibleRawView')();
        assert.strictEqual(quest.content, '퀘스트 본문');
    });

    await run('다시 생성: 옛 본문 그림만 비우고 교수안·고정 섹션이 쓰는 그림은 남긴다', async () => {
        const api = fs.readFileSync(root + 'api.js', 'utf8').replace(/\r\n/g, '\n');
        const at = api.indexOf("await archiveContents([mod], '다시 생성 전');");
        const block = api.slice(at, api.indexOf('\n    }\n', at));
        assert.ok(at > 0 && block.includes('dropUnusedLessonImages(mod, Object.values(lockedByTab)'), block);
        assert.ok(!/^\s*mod\.images = \{\};$/m.test(block), '그림을 통째로 비우는 줄이 없다(형식이 틀린 값만 빈 목록으로 맞춘다)');
        assert.ok(block.indexOf("mod.content = '';") < block.indexOf('dropUnusedLessonImages'), '탭과 본문을 비운 뒤에 정리한다');
    });

    await run('AI 명령줄: 시작한 자리 비교와 넣을 자리 찾기', async () => {
        const ctx = makeContext();
        const same = call(ctx, 'sameAiEditTarget');
        const start = { subjectId: 's1', moduleId: 1, tabId: 'basicLearn' };
        assert.strictEqual(same(start, { subjectId: 's1', moduleId: '1', tabId: 'basicLearn' }), true);
        assert.strictEqual(same(start, { subjectId: 's2', moduleId: 1, tabId: 'basicLearn' }), false, '다른 교과의 같은 id 차시');
        assert.strictEqual(same(start, { subjectId: 's1', moduleId: 2, tabId: 'basicLearn' }), false);
        assert.strictEqual(same(start, { subjectId: 's1', moduleId: 1, tabId: 'basicPrac' }), false);
        assert.strictEqual(same(start, { subjectId: 's1', moduleId: 1, tabId: null }), false, '교수안 같은 항목을 보는 중');
        const place = call(ctx, 'placeAiEdit');
        const edit = { selStart: 2, selEnd: 6, selectedText: '바꿀 글', newText: '고친 글' };
        assert.strictEqual(place('앞 바꿀 글 뒤', edit), '앞 고친 글 뒤');
        assert.strictEqual(place('새 줄\n앞 바꿀 글 뒤', edit), '새 줄\n앞 고친 글 뒤', '앞에 글이 늘면 한 번 나오는 자리');
        assert.strictEqual(place('바꿀 글과 바꿀 글', { ...edit, selStart: 20, selEnd: 24 }), null, '두 번 나오면 고르지 않는다');
        assert.strictEqual(place('없는 글', edit), null);
        const image = call(ctx, 'insertAiImage');
        assert.strictEqual(image('가나다', { baseText: '가나다', pos: 1, imgTag: '[그림]' }), '가[그림]나다');
        assert.strictEqual(image('가나다라', { baseText: '가나다', pos: 1, imgTag: '[그림]' }), '가나다라[그림]', '바뀌었으면 끝에');
        assert.strictEqual(image('가나', { baseText: '가나', pos: 99, imgTag: '[그림]' }), '가나[그림]');
        const away = call(ctx, 'aiResultAwayDialog');
        const ask = away('edit', '교과 › 차시 › 기본학습');
        assert.ok(ask.message.includes('넣을 곳: 교과 › 차시 › 기본학습'));
        assert.deepStrictEqual([ask.opts.okLabel, ask.opts.cancelLabel, ask.opts.dismissible], ['돌아가서 반영', '버리기', false]);
        assert.strictEqual(away('image', 'x').opts.okLabel, '돌아가서 넣기');
    });

    // 아래 AI 명령줄: 보기 화면에서 '바꿀 글'을 고르고 '더 짧게'를 보낸다. onCall은 응답을 기다리는 동안 사용자가 한 일
    const commandLessons = () => [
        { id: 1, title: '첫 차시', tabContents: { basicLearn: '앞 바꿀 글 뒤' }, images: {} },
        { id: 2, title: '둘째 차시', tabContents: { basicLearn: '다른 글' }, images: {} }
    ];
    function commandContext(lessons, { onCall = () => {}, mode = 'edit' } = {}) {
        const ctx = makeContext(async () => { onCall(ctx); return reply('고친 글'); });
        ['ai-command-input', 'ai-command-send', 'render-view'].forEach(id => { ctx.elements[id] = fakeElement(); });
        ctx.elements['ai-command-input'].value = '더 짧게';
        ctx.elements['ai-command-input'].focus = () => {}; // runAICommand의 finally가 부른다
        const raw = fakeElement();
        raw.dataset = { moduleId: '1', tabId: 'basicLearn' };
        raw.value = lessons[0].tabContents.basicLearn;
        ctx.elements['raw-view'] = raw;
        ctx.location = { hash: '#editor/s1' };
        ctx.lessons = lessons;
        vm.runInContext(`globalState = { subjects: [{ id: 's1', title: '교과', lessons: window.lessons }] }; currentSubjectId = 's1'; courseData = window.lessons; aiCommandMode = '${mode}';
            getEditingModule = (id = currentEditingModuleId) => courseData.find(m => String(m.id) === String(id));`, ctx);
        ctx.currentEditingModuleId = 1;
        ctx.currentCapturedSelection = '바꿀 글';
        ctx.toggleEditorMode = () => {};
        ctx.viewModule = id => { ctx.currentEditingModuleId = id; };
        // 묻지 않을 미리 보기가 뜨면 기다리지 않고 취소한다(answerPreview로 답을 정한 경우는 그 답). 테스트가 멈추지 않고 틀리게
        ctx.onOverlay = overlay => setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: 'cancel' } } }));
        return ctx;
    }

    await run('AI 명령줄: 기다리는 동안 다른 차시로 옮기면 넣지 않고 묻고, 버리면 그대로 둔다', async () => {
        const L = commandLessons();
        const ctx = commandContext(L, { onCall: c => { c.currentEditingModuleId = 2; } });
        let asked = null;
        ctx.confirmAsync = async (m, o) => { asked = { m, o }; return false; };
        await ctx.executeAICommand();
        assert.deepStrictEqual(plain(L.map(lesson => lesson.tabContents.basicLearn)), ['앞 바꿀 글 뒤', '다른 글']);
        assert.ok(asked.m.includes('넣을 곳: 교과 › 첫 차시 › 기본학습'), asked.m);
        assert.deepStrictEqual([asked.o.okLabel, asked.o.cancelLabel, asked.o.dismissible], ['돌아가서 반영', '버리기', false]);
        assert.ok(!ctx.alerts.some(text => String(text).includes('완료')), ctx.alerts.join('|'));
        assert.ok(ctx.toasts.includes('이번 AI 결과를 버렸습니다.'));
        assert.strictEqual(ctx.elements['ai-command-input'].value, '더 짧게', '넣지 않았으면 다시 실행할 수 있게 명령을 둔다');
    });

    await run('AI 명령줄: 돌아가서 반영을 고르면 시작한 차시에 넣는다', async () => {
        const L = commandLessons();
        const ctx = commandContext(L, { onCall: c => { c.currentEditingModuleId = 2; } });
        ctx.confirmAsync = async () => true;
        answerPreview(ctx, 'apply');
        await ctx.executeAICommand();
        assert.strictEqual(L[0].tabContents.basicLearn, '앞 고친 글 뒤');
        assert.strictEqual(L[1].tabContents.basicLearn, '다른 글');
        assert.strictEqual(ctx.currentEditingModuleId, 1, '시작한 차시로 돌아간다');
        assert.ok(ctx.alerts.includes('✅ 텍스트 수정 완료!'), ctx.alerts.join('|'));
        assert.strictEqual(ctx.elements['ai-command-input'].value, '');
    });

    await run('AI 명령줄: 같은 자리면 기다리는 동안 쓴 글을 지키고 고른 글을 바꾼다', async () => {
        const L = commandLessons();
        const ctx = commandContext(L, { onCall: c => { c.elements['raw-view'].value = '먼저 쓴 줄\n' + c.elements['raw-view'].value; } });
        let asked = 0;
        ctx.confirmAsync = async () => { asked += 1; return true; };
        answerPreview(ctx, 'apply');
        await ctx.executeAICommand();
        assert.strictEqual(asked, 0, '같은 자리면 묻지 않는다');
        assert.strictEqual(L[0].tabContents.basicLearn, '먼저 쓴 줄\n앞 고친 글 뒤');
    });

    await run('AI 명령줄: 그림은 시작한 차시에 넣는다', async () => {
        const L = commandLessons();
        const ctx = commandContext(L, { mode: 'image' });
        ctx.generateImageAPI = async () => { ctx.currentEditingModuleId = 2; return 'data:image/png;base64,QUJD'; };
        ctx.confirmAsync = async () => true;
        await ctx.executeAICommand();
        assert.ok(/local:img_\d+/.test(L[0].tabContents.basicLearn), L[0].tabContents.basicLearn);
        assert.strictEqual(Object.keys(L[0].images).length, 1);
        assert.strictEqual(Object.keys(L[1].images).length, 0, '그사이 연 차시에는 넣지 않는다');
        assert.ok(ctx.alerts.includes('✅ 이미지 삽입 완료!'), ctx.alerts.join('|'));
    });

    await run('AI 명령줄: 그림을 만들지 못하면 완료라고 하지 않는다', async () => {
        const L = commandLessons();
        const ctx = commandContext(L, { mode: 'image' });
        ctx.generateImageAPI = async () => null;
        await ctx.executeAICommand();
        assert.deepStrictEqual(plain(ctx.alerts), ['이미지 생성에 실패했습니다.']);
        assert.strictEqual(L[0].tabContents.basicLearn, '앞 바꿀 글 뒤');
    });

    await run('AI 명령줄: 그림 태그의 설명(alt)은 이스케이프한다', async () => {
        const L = commandLessons();
        const ctx = commandContext(L, { mode: 'image' });
        ctx.elements['ai-command-input'].value = '고양이" onerror="alert(1)';
        ctx.generateImageAPI = async () => 'data:image/png;base64,QUJD';
        await ctx.executeAICommand();
        const text = L[0].tabContents.basicLearn;
        assert.ok(text.includes('alt="고양이&quot; onerror=&quot;alert(1)"'), text);
        assert.ok(!text.includes('" onerror="'), '명령 글이 속성을 깨지 않는다');
    });

    await run('AI 명령줄: 그림 설명(캡션)도 자른 뒤 이스케이프한다(태그로 읽히거나 역슬래시가 붙지 않는다)', async () => {
        const L = commandLessons();
        const ctx = commandContext(L, { mode: 'image' });
        ctx.elements['ai-command-input'].value = `'반복문' a<b & "c"`;
        ctx.generateImageAPI = async () => 'data:image/png;base64,QUJD';
        await ctx.executeAICommand();
        const text = L[0].tabContents.basicLearn;
        assert.ok(text.includes(`'반복문' a&lt;b &amp; &quot;c&quot;</div></div>`), text);
        assert.ok(!text.includes("\\'"), '따옴표 앞에 역슬래시를 넣지 않는다');
        const cut = commandLessons();
        const long = commandContext(cut, { mode: 'image' });
        long.elements['ai-command-input'].value = `${'ㄱ'.repeat(79)}"`;
        long.generateImageAPI = async () => 'data:image/png;base64,QUJD';
        await long.executeAICommand();
        assert.ok(cut[0].tabContents.basicLearn.includes(`${'ㄱ'.repeat(79)}&quot;</div></div>`), '80자로 자른 뒤 이스케이프해 &quot;가 반만 남지 않는다');
    });

    await run('AI 명령줄: 시작한 차시가 지워졌으면 알린다', async () => {
        const L = commandLessons();
        const ctx = commandContext(L, { onCall: c => { vm.runInContext('courseData = courseData.filter(m => m.id !== 1)', c); c.currentEditingModuleId = 2; } });
        let asked = 0;
        ctx.confirmAsync = async () => { asked += 1; return true; };
        await ctx.executeAICommand();
        assert.deepStrictEqual(plain(ctx.alerts), [call(ctx, 'AI_RESULT_GONE')]);
        assert.strictEqual(asked, 0);
    });

    await run('AI 명령줄: 다른 교과의 같은 id 차시를 열어도 시작한 교과에 넣는다', async () => {
        const L = commandLessons();
        const L2 = [{ id: 1, title: '남의 차시', tabContents: { basicLearn: '남의 글' }, images: {} }];
        const ctx = commandContext(L, {
            onCall: c => {
                vm.runInContext("currentSubjectId = 's2'; courseData = window.L2;", c);
                c.location.hash = '#editor/s2';
                const r2 = fakeElement();
                r2.dataset = { moduleId: '1', tabId: 'basicLearn' };
                r2.value = '남의 글';
                c.elements['raw-view'] = r2;
            }
        });
        ctx.L2 = L2;
        vm.runInContext("globalState.subjects.push({ id: 's2', title: '교과2', lessons: window.L2 })", ctx);
        let message = '';
        ctx.confirmAsync = async m => { message = m; return true; };
        answerPreview(ctx, 'apply');
        await ctx.executeAICommand();
        assert.ok(message.includes('교과 › 첫 차시'), message);
        assert.strictEqual(L[0].tabContents.basicLearn, '앞 고친 글 뒤');
        assert.strictEqual(L2[0].tabContents.basicLearn, '남의 글');
        assert.strictEqual(ctx.location.hash, '#editor/s1/1', '시작한 교과의 그 차시로 돌아간다');
    });

    await run('AI 명령줄: 탭을 보고 있지 않으면 실행하지 않는다(넣을 탭이 없다)', async () => {
        const L = commandLessons();
        let called = 0;
        const ctx = commandContext(L, { onCall: () => { called += 1; } });
        ctx.location.hash = '#overview';
        await ctx.executeAICommand();
        assert.deepStrictEqual([called, L[0].tabContents.basicLearn, plain(ctx.alerts)], [0, '앞 바꿀 글 뒤', []], '편집기 밖');
        vm.runInContext("_lessonPanel = 'gyosuan'", ctx);
        ctx.location.hash = '#editor/s1';
        await ctx.executeAICommand();
        assert.strictEqual(called, 0, '교수안 같은 항목을 보는 중');
    });

    await run('AI 명령줄: 저장하지 못하면 완료라고 하지 않는다', async () => {
        const L = commandLessons();
        const ctx = commandContext(L);
        ctx.saveState = async () => false;
        answerPreview(ctx, 'apply');
        await ctx.executeAICommand();
        assert.strictEqual(L[0].tabContents.basicLearn, '앞 고친 글 뒤', '글은 넣었다(브라우저 저장만 실패)');
        assert.ok(!ctx.alerts.some(text => String(text).includes('완료')), ctx.alerts.join('|'));
    });

    await run('AI 명령줄: 보낸 뒤 결과를 넣거나 버릴 때까지는 창을 닫기 전에 묻는다(보내기 전에는 묻지 않는다)', async () => {
        const seen = [];
        const ctx = commandContext(commandLessons(), { onCall: c => { seen.push(['응답 전', c.isAiResultPending()]); c.currentEditingModuleId = 2; } });
        assert.strictEqual(ctx.isAiResultPending(), false, '아직 보내지 않았다');
        ctx.confirmAsync = async () => { seen.push(['옮겨서 묻는 창', ctx.isAiResultPending()]); return false; };
        await ctx.executeAICommand();
        seen.push(['버린 뒤', ctx.isAiResultPending()]);
        assert.deepStrictEqual(seen, [['응답 전', true], ['옮겨서 묻는 창', true], ['버린 뒤', false]]);
        const same = commandContext(commandLessons());
        let previewing = null;
        same.onOverlay = overlay => { previewing = same.isAiResultPending(); setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: 'cancel' } } })); };
        await same.executeAICommand();
        assert.deepStrictEqual([previewing, same.isAiResultPending()], [true, false], '바뀐 부분을 미리 보는 동안');
        const failing = commandContext(commandLessons(), { onCall: () => { throw new Error('연결 끊김'); } });
        await failing.executeAICommand();
        assert.strictEqual(failing.isAiResultPending(), false, '오류로 끝나도 되돌린다');
        // 고른 글이 없어 탭 전체를 고칠지 묻는 동안은 아직 아무것도 보내지 않았다
        const whole = commandContext(commandLessons());
        whole.currentCapturedSelection = '';
        whole.getSelection = () => null;
        let asking = null;
        whole.confirmAsync = async () => { asking = whole.isAiResultPending(); return false; };
        await whole.executeAICommand();
        assert.strictEqual(asking, false);
    });

    await run('그림 지우기: 주소가 꼭 같은 마크다운 그림만 지우고, 그림 키·data URL로 정규식을 만들지 않는다', async () => {
        const ctx = makeContext();
        const without = call(ctx, 'withoutLessonImages');
        const png = 'data:image/png;base64,QUJD';
        const md = `앞 ![a](local:img_1) ![b](local:img_10) ![c](${png}) ![d](local:img_1x) 뒤`;
        assert.strictEqual(without(md, ['local:img_1', png]), '앞  ![b](local:img_10)  ![d](local:img_1x) 뒤', 'img_1을 지울 때 img_10은 남는다');
        const plus = 'data:image/png;base64,iV+B/OR+w==';
        assert.strictEqual(without(`![a](${plus}) ![b](data:image/png;base64,iVVB/OR+w==) 글`, [plus]), ' ![b](data:image/png;base64,iVVB/OR+w==) 글', '+ / = 가 든 그림 주소도 글자 그대로 견준다');
        ['withoutLessonImages', 'removeLessonImages', 'mapPictureProse', 'tidyPictureGaps', 'lessonImageTargets'].forEach(name => {
            assert.ok(!/new RegExp/.test(call(ctx, name).toString()), `${name}: 데이터로 정규식을 만들지 않는다`);
        });
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '앞 ![그림](local:img_1) 가운데 ![다른](local:img_10) 뒤' }, images: { img_1: 'a', img_10: 'b' } };
        mod.content = mod.tabContents.basicLearn;
        const picture = pictureContext(mod);
        await call(picture, 'deleteImage')('img_1');
        assert.strictEqual(mod.tabContents.basicLearn, '앞  가운데 ![다른](local:img_10) 뒤');
        assert.strictEqual(mod.content, mod.tabContents.basicLearn, '합친 본문도 맞춘다');
        assert.deepStrictEqual(Object.keys(mod.images), ['img_10']);
        assert.deepStrictEqual([picture.written.length, picture.saved], [1, 1]);
        assert.ok(picture.toasts.includes('그림을 지웠습니다.'), picture.toasts.join('|'));
        assert.ok(!/\bconfirm\(/.test(call(picture, 'deleteImage').toString()), '앱의 확인 창으로만 묻는다(네이티브 confirm 없음)');
    });

    const PICTURE_A = 'data:image/png;base64,QUFB';
    const PICTURE_B = 'data:image/png;base64,QkJC';
    const pictureFrame = (id, caption) => `<div class="image-wrapper"><img src="local:${id}" alt="그림" class="rounded-lg border-2 border-accent/30 shadow-md max-w-full"><span class="absolute bottom-3 left-3 bg-black/80 text-white"><i class="ph-fill ph-sparkle text-accent"></i> AI 생성 이미지</span><button class="image-regenerate-btn px-3 py-1.5" data-lesson-action="regenerate-image" data-keyword="반복문" data-img-id="${id}"><i class="ph-bold ph-arrows-clockwise"></i> 다시 생성</button><div class="image-caption" style="margin-top:8px;text-align:center;">${caption}</div></div>`;

    await run('그림 지우기: 그림 틀(AI 표시·다시 생성 버튼·설명)과 붙여 넣은 맨 <img>를 통째로 지우고 img_10 틀은 남긴다', async () => {
        const kept = pictureFrame('img_10', '남는 그림');
        const md = `## 반복문\n\n앞 글\n\n${pictureFrame('img_1', "\\'반복문\\' a<b 비교")}\n\n${kept}\n\n<img src="local:img_1" alt="inserted image" style="max-width:100%; border-radius:8px;">\n\n<div class="image-wrapper"><img src="local:img_1" alt="삽화" class="rounded-lg"></div>\n\n뒤 글`;
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: md }, images: { img_1: PICTURE_A, img_10: PICTURE_B } };
        const ctx = pictureContext(mod);
        await call(ctx, 'deleteImage')('img_1');
        const text = mod.tabContents.basicLearn;
        assert.strictEqual(text, `## 반복문\n\n앞 글\n\n${kept}\n\n뒤 글`, '그림만 있던 줄과 남는 빈 줄을 함께 뺀다');
        assert.strictEqual((text.match(/<div/g) || []).length, (text.match(/<\/div>/g) || []).length, '떨어진 </div>가 없다');
        assert.deepStrictEqual(Object.keys(mod.images), ['img_10']);
        const { message, opts } = ctx.asked[0];
        assert.ok(message.includes('이 탭에 같은 그림이 3곳 있어 모두 지웁니다.'), message);
        assert.deepStrictEqual([opts.title, opts.okLabel, opts.tone], ['그림 지우기', '지우기', 'danger']);
        // 글 사이에 넣은 그림은 그 자리만 비우고, 모양이 다른 옛 틀은 맨 <img>만 지운다(블록을 넘어 지우지 않는다)
        const without = call(ctx, 'withoutLessonImages');
        assert.strictEqual(without('앞 글\n<img alt="x" src="local:img_1">\n뒤 글', ['local:img_1']), '앞 글\n뒤 글');
        const odd = '<div class="image-wrapper"><span>머리</span><img src="local:img_1"><div class="image-caption">설명</div></div>\n\n다음 문단';
        assert.strictEqual(without(odd, ['local:img_1']), '<div class="image-wrapper"><span>머리</span><div class="image-caption">설명</div></div>\n\n다음 문단');
        const open = '<div class="image-wrapper"><img src="local:img_1">\n\n긴 문단은 남는다</div>';
        assert.strictEqual(without(open, ['local:img_1']), '<div class="image-wrapper">\n\n긴 문단은 남는다</div>', '빈 줄을 넘어 지우지 않는다');
        const crlf = '앞\r\n\r\n<div class="image-wrapper"><img src="local:img_1">\r\n\r\n긴 문단은 남는다</div>\r\n';
        assert.strictEqual(without(crlf, ['local:img_1']), '앞\r\n\r\n<div class="image-wrapper">\r\n\r\n긴 문단은 남는다</div>\r\n', '\\r\\n으로 끝나는 빈 줄도 넘지 않는다');
        // 그림 값을 주소로 바로 쓴 틀도 보기 화면 버튼이 넘긴 키로 지운다
        const inline = { id: 1, title: '차시', tabContents: { basicLearn: `앞\n\n<div class="image-wrapper"><img src="${PICTURE_A}" alt="x"></div>\n\n뒤` }, images: { img_1: PICTURE_A } };
        await call(pictureContext(inline), 'deleteImage')('img_1');
        assert.deepStrictEqual([inline.tabContents.basicLearn, Object.keys(inline.images).length], ['앞\n\n뒤', 0]);
    });

    await run('그림 지우기: 코드 블록 안의 그림 예제는 그림이 아니라 건드리지 않는다', async () => {
        const url = 'https://example.com/cat.png';
        const md = `HTML 예제:\n\n\`\`\`html\n<img src="${url}">\n![고양이](${url})\n\`\`\`\n\n<img src="${url}">\n\n끝`;
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: md }, images: {} };
        const ctx = pictureContext(mod);
        await call(ctx, 'deleteImage')(encodeURIComponent(url));
        assert.strictEqual(mod.tabContents.basicLearn, `HTML 예제:\n\n\`\`\`html\n<img src="${url}">\n![고양이](${url})\n\`\`\`\n\n끝`);
        assert.ok(!ctx.asked[0].message.includes('곳 있어'), '코드 속 예제는 세지 않는다');
    });

    await run('그림 지우기: 다른 탭·교수안·삽화가 쓰는 그림은 값을 남기고 이 탭에서만 뺀다', async () => {
        const tabs = () => ({ basicLearn: '앞 ![그림](local:img_1) 뒤', basicPrac: '실습 글' });
        const cases = [
            ['다른 탭', { tabContents: { ...tabs(), basicPrac: '실습 ![그림](local:img_1)' } }, true],
            ['교수안', { tabContents: tabs(), gyosuan: { docMd: '교수안 ![그림](local:img_1)' } }, true],
            ['슬라이드', { tabContents: tabs(), gyosuan: { deckMd: '슬라이드 ![그림](local:img_1)' } }, true],
            ['삽화', { tabContents: tabs(), illustrations: [{ id: 'art1', imgId: 'img_1', svg: '<svg/>' }] }, false]
        ];
        for (const [name, extra, shared] of cases) {
            const mod = { id: 1, title: '차시', images: { img_1: PICTURE_A }, ...extra };
            const ctx = pictureContext(mod);
            await call(ctx, 'deleteImage')(encodeURIComponent(PICTURE_A));
            assert.strictEqual(mod.tabContents.basicLearn, '앞  뒤', name);
            assert.strictEqual(mod.images.img_1, PICTURE_A, `${name}: 그림 값을 남긴다`);
            assert.strictEqual(ctx.asked[0].message.includes('그곳의 그림은 그대로 둡니다'), shared, name);
        }
    });

    await run('그림 지우기: 비운 기본학습에 보이는 다른 탭 글에서는 지우지 않는다(다른 탭 글이 기본학습에 겹쳐 들어가지 않게)', async () => {
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '', basicPrac: '실습\n\n![그림](local:img_1)\n\n끝' }, images: { img_1: PICTURE_A } };
        mod.content = mod.tabContents.basicPrac;
        const before = JSON.stringify(mod);
        const ctx = pictureContext(mod);
        await call(ctx, 'deleteImage')(encodeURIComponent(PICTURE_A));
        assert.strictEqual(JSON.stringify(mod), before, '기본학습·다른 탭·그림이 그대로다');
        assert.deepStrictEqual([ctx.asked.length, ctx.written.length], [0, 0]);
        assert.ok(ctx.toasts[0].includes('다른 탭의 글이 보이는 중'), ctx.toasts.join('|'));
        // 탭이 모두 빈 옛 차시의 본문은 기본학습 글이라 지운다
        const legacy = { id: 1, title: '차시', content: '앞\n\n![그림](local:img_1)\n\n뒤', tabContents: { basicLearn: null, basicPrac: null }, images: { img_1: PICTURE_A } };
        await call(pictureContext(legacy), 'deleteImage')('img_1');
        assert.deepStrictEqual([legacy.tabContents.basicLearn, legacy.content, Object.keys(legacy.images).length], ['앞\n\n뒤', '앞\n\n뒤', 0]);
    });

    await run('그림 지우기: 확인 창에서 취소하면 글·그림·저장이 그대로다', async () => {
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: pictureFrame('img_1', '설명') }, images: { img_1: PICTURE_A }, whiteboardVideos: { img_1: { id: 'wb_video000001' } } };
        const before = JSON.stringify(mod);
        const ctx = pictureContext(mod, { answer: false });
        await call(ctx, 'deleteImage')('img_1');
        assert.strictEqual(JSON.stringify(mod), before);
        assert.deepStrictEqual([ctx.saved, ctx.written.length, ctx.toasts.length], [undefined, 0, 0]);
        assert.ok(ctx.asked[0].message.includes('영상 연결도 풉니다'), ctx.asked[0].message);
    });

    await run('그림 지우기: 빈 주소(찾지 못한 그림 자리)와 참조 값으로는 다른 그림을 고르지 않는다', async () => {
        const ref = 'teacher-image:0123456789abcdef1a';
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '![](local:gone) 앞 ![그림](local:img_2) 뒤 ![참조](local:img_ref)' }, images: { img_1: '', img_2: PICTURE_A, img_ref: ref } };
        const before = JSON.stringify(mod);
        const ctx = pictureContext(mod);
        await call(ctx, 'deleteImage')(''); // ![]() 자리의 옛 버튼
        await call(ctx, 'deleteImage')(encodeURIComponent(ref));
        assert.strictEqual(JSON.stringify(mod), before, '아무것도 바꾸지 않는다');
        assert.deepStrictEqual([ctx.asked.length, ctx.saved], [0, undefined], '묻지도 저장하지도 않는다');
        assert.ok(ctx.toasts.every(text => text.includes('찾지 못해 지우지 않았습니다')) && ctx.toasts.length === 2, ctx.toasts.join('|'));
        const targets = (images, id) => plain(call(ctx, 'lessonImageTargets')({ images }, id));
        assert.deepStrictEqual(targets(mod.images, ''), { keys: [], refs: [] });
        assert.deepStrictEqual(targets({ a1: PICTURE_A, a2: PICTURE_A, b: PICTURE_B, c: '' }, encodeURIComponent(PICTURE_A)), { keys: ['a1', 'a2'], refs: ['local:a1', 'local:a2', PICTURE_A] }, '같은 그림 값의 키는 모두');
        assert.deepStrictEqual(targets({ a1: PICTURE_A, a2: PICTURE_A }, 'a2'), { keys: ['a2'], refs: ['local:a2', PICTURE_A] }, '키를 받으면 그 키만(그 그림 값을 주소로 바로 쓴 자리도)');
        assert.deepStrictEqual(targets({ a3: '' }, 'local:a3'), { keys: ['a3'], refs: ['local:a3'] });
        assert.strictEqual(call(ctx, 'mdImageDeleteButton')('', ''), '', '빈 주소의 마크다운 그림에는 삭제 버튼을 달지 않는다');
        assert.ok(call(ctx, 'mdImageDeleteButton')(PICTURE_A, 'x%22y').includes('data-lesson-action="delete-image" data-img-id="x%22y"'));
    });

    await run('그림 지우기: 묻는 동안 다른 차시나 탭으로 옮기면 지우지 않는다', async () => {
        const moves = [c => { vm.runInContext("currentLessonTab = 'basicPrac'", c); }, c => { c.currentEditingModuleId = 2; }, c => { vm.runInContext("_lessonPanel = 'gyosuan'", c); }];
        for (const move of moves) {
            const mod = { id: 1, title: '차시', tabContents: { basicLearn: '앞 ![그림](local:img_1) 뒤', basicPrac: '실습' }, images: { img_1: PICTURE_A } };
            const before = JSON.stringify(mod);
            const ctx = pictureContext(mod, { answer: c => { move(c); return true; } });
            await call(ctx, 'deleteImage')('img_1');
            assert.strictEqual(JSON.stringify(mod), before);
            assert.deepStrictEqual(ctx.toasts, ['다른 차시나 탭으로 옮겨 그림을 지우지 않았습니다.']);
        }
        // 기다리는 동안 그 그림이 이미 빠졌으면 성공이라고 하지 않는다
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '앞 ![그림](local:img_1) 뒤' }, images: { img_1: PICTURE_A } };
        const gone = pictureContext(mod, { answer: () => { mod.tabContents = { basicLearn: '다른 글' }; return true; } });
        await call(gone, 'deleteImage')('img_1');
        assert.deepStrictEqual([mod.tabContents.basicLearn, gone.written.length], ['다른 글', 0]);
        assert.ok(!gone.toasts.includes('그림을 지웠습니다.'), gone.toasts.join('|'));
    });

    await run('그림 지우기: AI 작업이 도는 동안에는 글에서만 빼고 그림 값과 판서 영상 연결은 남긴다', async () => {
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '앞 ![그림](local:img_1) 뒤' }, images: { img_1: PICTURE_A }, whiteboardVideos: { img_1: { id: 'wb_video000001' } } };
        const ctx = pictureContext(mod);
        ctx.isVolumeFilling = () => true; // 기본학습 분량 채우기(고정 섹션을 쥐고 있다)
        await call(ctx, 'deleteImage')('img_1');
        assert.strictEqual(mod.tabContents.basicLearn, '앞  뒤');
        assert.deepStrictEqual([mod.images.img_1, mod.whiteboardVideos.img_1.id], [PICTURE_A, 'wb_video000001']);
        assert.ok(!ctx.asked[0].message.includes('영상 연결'), '남길 영상 연결을 푼다고 말하지 않는다');
        const pipeline = { id: 1, title: '차시', tabContents: { basicLearn: '![그림](local:img_1)' }, images: { img_1: PICTURE_A } };
        const busy = pictureContext(pipeline);
        busy.isLessonPipelineRunning = () => true;
        await call(busy, 'deleteImage')('img_1');
        assert.strictEqual(pipeline.images.img_1, PICTURE_A, '진행 막대의 작업');
    });

    await run('그림 지우기: 판서 영상은 연결만 풀고 영상 파일은 지우지 않는다(다른 탭이 그 그림을 쓰면 연결도 둔다)', async () => {
        const video = { id: 'wb_video000001', title: '판서', ext: 'mp4', at: 1 };
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: `앞\n\n${pictureFrame('img_1', '설명')}\n\n뒤` }, images: { img_1: PICTURE_A }, whiteboardVideos: { img_1: video, img_9: { id: 'wb_video000009' } } };
        const ctx = pictureContext(mod);
        vm.runInContext(fs.readFileSync(root + 'whiteboard-video.js', 'utf8'), ctx);
        const deleted = [];
        ctx.DBManager = { deleteItem: async key => { deleted.push(key); }, setItem: async () => {}, getItem: async () => null };
        await call(ctx, 'deleteImage')('img_1');
        assert.deepStrictEqual(Object.keys(mod.whiteboardVideos), ['img_9']);
        assert.ok(!('img_1' in mod.images));
        assert.deepStrictEqual(deleted, [], '영상 파일은 저장된 작업을 열 때 정리한다');
        assert.ok(ctx.asked[0].message.includes('영상 연결도 풉니다'));
        const shared = { id: 1, title: '차시', tabContents: { basicLearn: '앞 ![그림](local:img_1) 뒤', advLearn: '![그림](local:img_1)' }, images: { img_1: PICTURE_A }, whiteboardVideos: { img_1: { ...video } } };
        const other = pictureContext(shared);
        vm.runInContext(fs.readFileSync(root + 'whiteboard-video.js', 'utf8'), other);
        await call(other, 'deleteImage')('img_1');
        assert.deepStrictEqual([shared.whiteboardVideos.img_1.id, shared.images.img_1], [video.id, PICTURE_A]);
        assert.ok(!other.asked[0].message.includes('영상 연결'), other.asked[0].message);
    });

    await run('보기 화면: 그림 틀·붙여 넣은 그림에 삭제 버튼을 하나씩 달고, 마크다운 그림·빈 주소·링크 안 그림은 건너뛴다', async () => {
        const make = (tag, { cls = '', attrs = {}, children = [] } = {}) => {
            const el = {
                tagName: tag.toUpperCase(), className: cls, attrs: { ...attrs }, dataset: {}, children: [], parentElement: null,
                classList: { add: (...names) => { el.className = [...new Set([...el.className.split(' ').filter(Boolean), ...names])].join(' '); } },
                getAttribute: name => (name in el.attrs ? el.attrs[name] : null),
                appendChild(child) {
                    if (child.parentElement) child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
                    child.parentElement = el;
                    el.children.push(child);
                    return child;
                },
                replaceWith(other) {
                    const list = el.parentElement.children;
                    list[list.indexOf(el)] = other;
                    other.parentElement = el.parentElement;
                    el.parentElement = null;
                },
                matches: selector => selector.split(',').map(part => part.trim()).some(part => {
                    if (part.startsWith('.')) return el.className.split(' ').includes(part.slice(1));
                    if (part === '[data-img-id]') return 'data-img-id' in el.attrs || el.dataset.imgId !== undefined;
                    if (part.startsWith('[')) return part.slice(1, -1) in el.attrs;
                    return el.tagName === part.toUpperCase();
                }),
                closest(selector) {
                    for (let node = el; node; node = node.parentElement) if (node.matches(selector)) return node;
                    return null;
                },
                all: () => el.children.flatMap(child => [child, ...child.all()]),
                querySelector: selector => el.all().find(node => node.matches(selector)) || null,
                querySelectorAll: selector => el.all().filter(node => node.matches(selector))
            };
            // data-* 속성은 브라우저처럼 dataset에도 보인다
            Object.entries(attrs).filter(([name]) => name.startsWith('data-')).forEach(([name, value]) => {
                el.dataset[name.slice(5).replace(/-([a-z])/g, (whole, ch) => ch.toUpperCase())] = value;
            });
            children.forEach(child => el.appendChild(child));
            return el;
        };
        const img = src => make('img', { attrs: { src } });
        const PICTURE_C = 'data:image/png;base64,Q0ND';
        const PICTURE_D = 'data:image/png;base64,RERE';
        const web = 'https://example.com/a.png';
        const view = make('div', { children: [
            make('div', { cls: 'image-wrapper', children: [img(PICTURE_A), make('button', { attrs: { 'data-img-id': 'img_1' } })] }),
            make('div', { attrs: { 'data-imgid': 'x' }, children: [img(PICTURE_B)] }),
            img(PICTURE_C),
            make('div', { cls: 'image-wrapper', children: [img('')] }),
            make('a', { attrs: { href: web }, children: [img(web)] }),
            make('p', { children: [img(web)] }),
            make('div', { cls: 'image-wrapper', children: [img(PICTURE_D), make('button', { attrs: { 'data-img-id': 'd2' } })] }),
            img(PICTURE_D)
        ] });
        const ctx = makeContext();
        ctx.document.createElement = tag => make(tag);
        const mod = { id: 1, images: { img_1: PICTURE_A, img_2: PICTURE_B, d1: PICTURE_D, d2: PICTURE_D } };
        const blocks = view.children.length;
        call(ctx, 'addImageDeleteButtons')(view, mod);
        const buttons = view.querySelectorAll('button').filter(button => button.dataset.lessonAction === 'delete-image');
        assert.deepStrictEqual(buttons.map(button => button.dataset.imgId), ['img_1', encodeURIComponent(PICTURE_C), encodeURIComponent(web), 'd2', encodeURIComponent(PICTURE_D)],
            '키를 하나로 알면 키를, 모르거나 여럿이면 그림 주소를 넘긴다');
        assert.strictEqual(view.children.length, blocks, '화면 블록 수는 그대로다');
        assert.ok(view.children[0].className.includes('relative') && view.children[0].className.includes('group'));
        assert.strictEqual(view.children[2].tagName, 'SPAN', '틀 없는 그림은 칸으로 감싼다');
        assert.ok(buttons.every(button => button.className.includes('left-2') && button.title === '그림 지우기'), '왼쪽 위(다시 찾기는 오른쪽 위)');
        assert.strictEqual(view.children[1].querySelectorAll('button').length, 0, '마크다운 그림은 렌더러가 단다');
        assert.strictEqual(view.children[4].querySelectorAll('button').length, 0, '링크 안 그림');
        assert.strictEqual(view.children[3].querySelectorAll('button').length, 0, '빈 주소');
        call(ctx, 'addImageDeleteButtons')(null, mod);
    });

    await run('원문 칸 미리 보기: 그림 키 모양 하나로 진짜 그림만 넣는다(img_1이 img_10 안에서 바뀌지 않는다)', async () => {
        const ctx = makeContext();
        vm.runInContext('renderLessonHTML = html => html; preprocessMarkdown = md => md;', ctx);
        const preview = call(ctx, 'mdPreviewHtml');
        const images = { img_1: 'data:image/png;base64,AAA', img_10: 'data:image/png;base64,BBB', ref: 'teacher-image:0123456789abcdef1a', empty: '' };
        const html = preview({ images }, '<img src="local:img_10"> <img src="local:img_1"> <img src="local:ref"> ![빈](local:empty) ![없음](local:none)');
        assert.ok(html.includes('<img src="data:image/png;base64,BBB">') && html.includes('<img src="data:image/png;base64,AAA">'), html);
        assert.ok(!html.includes('AAA0') && !html.includes('teacher-image:'), html);
        assert.ok(html.includes('src="" alt="[이미지 생성 누락]"') && html.includes('![빈]()') && html.includes('![없음]()'), html);
        assert.ok(!html.includes('local:'), html);
    });

    await run('시각: 휴지통·변경 이력·수동 검수는 이 컴퓨터 시각으로 보인다(UTC 그대로가 아니다)', async () => {
        const ctx = makeContext();
        const local = call(ctx, 'localTimeText');
        withTimeZone('Asia/Seoul', () => {
            assert.strictEqual(local('2026-11-05T16:30:00.000Z'), '2026-11-06 01:30');
            vm.runInContext("globalState = { subjects: [{ id: 's1', title: '교과' }], lessonTrash: [{ at: '2026-11-05T16:30:00.000Z', subjectId: 's1', lesson: { id: 1, title: '지운 차시' } }] }", ctx);
            assert.ok(call(ctx, 'renderTrashRows')().includes('교과 · 2026-11-06 01:30'), '휴지통');
            assert.ok(call(ctx, 'metaHistoryRows')({ history: [{ at: '2026-11-05T16:30:00.000Z', note: '제목 바꿈' }] }).includes('2026-11-06 01:30 · 제목 바꿈'), '변경 이력');
        });
        withTimeZone('UTC', () => assert.strictEqual(local('2026-11-05T16:30:00.000Z'), '2026-11-05 16:30'));
        [5, '지운 날', undefined, null, {}].forEach(value => assert.strictEqual(local(value), '', String(value)));
    });

    console.log('ALL PASSED');
})().catch(e => { console.error('FAIL', e.message, e.stack); process.exit(1); });
