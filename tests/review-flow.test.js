// 컨벤션 검수·AI 수정 제안·자동 수정·미리보기·수동 검수·서식 도구 테스트 (실행: node tests/review-flow.test.js)
// AI 응답만 스텁으로 두고 실제 파일을 실행한다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', 'js') + path.sep;
const FILES = ['data.js', 'convention.js', 'lesson-lint.js', 'lesson-opening.js', 'course-meta.js', 'course-qbank.js', 'ai-edit-preview.js', 'lesson-editor-tools.js', 'lesson-review.js', 'md-toolbar.js', 'lesson-attachments.js', 'tabs.js', 'ai-routing.js', 'api.js'];

function fakeElement() {
    const handlers = {};
    return {
        style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', disabled: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener(type, fn) { handlers[type] = fn; },
        fire(type, event) { return handlers[type](event); },
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
        escapeHtml: s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''),
        saveState: async () => { ctx.saved = (ctx.saved || 0) + 1; },
        renderEditor: () => { ctx.rendered = (ctx.rendered || 0) + 1; },
        renderSidebar() {},
        showLessonView() {},
        lessonDesignBrief: () => '',
        lessonGenBrief: () => '',
        archiveContent: async item => { ctx.archived.push(item); },
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
    // api.js의 callGemini와 tabs.js가 쓰는 함수는 스텁으로 바꾼다. 실제 파일에서 함수 선언이 전역을 차지하므로 로드 후에 덮는다.
    ctx.callGemini = callGemini;
    vm.runInContext('callGemini = window.callGemini; buildTaskContext = (task, args) => ({ systemInstruction: "시스템", userPrompt: `${task}:${args.tabId}` }); getEditingModule = (id = window.currentMod?.id) => (String(id) === String(window.currentMod?.id) ? window.currentMod : window.otherMod); processImageTags = async (mod, md) => md; renderSidebar = () => {}; renderEditor = () => { window.rendered = (window.rendered || 0) + 1; };', ctx);
    return ctx;
}

const call = (ctx, name) => vm.runInContext(name, ctx);
const reply = (text, finishReason = 'STOP') => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });
const plain = value => JSON.parse(JSON.stringify(value));

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
    ['editor-loading', 'editor-loading-text', 'editor-loading-stop', 'reinforce-input'].forEach(id => { ctx.elements[id] = fakeElement(); });
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
        assert.ok(stopping.alerts.at(-1).includes('히스토리에 보관'));
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
        aiCtx.elements['reinforce-input'].value = '예시 추가';
        answerPreview(aiCtx, 'cancel');
        await call(aiCtx, 'reinforceCurrentTab')(1);
        assert.strictEqual(mod.tabContents.basicLearn, original, '취소하면 그대로');
        assert.strictEqual(aiCtx.archived.length, 0);
        answerPreview(aiCtx, 'apply');
        await call(aiCtx, 'reinforceCurrentTab')(1);
        assert.ok(mod.tabContents.basicLearn.includes('보강한 글입니다.'));
        assert.strictEqual(aiCtx.archived[0].content, original, '바꾸기 전 내용을 히스토리에 남긴다');
        assert.ok(mod.history[0].note.includes('예시 추가'));
        assert.strictEqual(aiCtx.elements['editor-loading'].style.display, 'none');
    });

    await run('보강: 고정 섹션과 잘린 응답', async () => {
        const original = '## 고정\n\n원문입니다.\n\n## 본문\n\n원래 글입니다.';
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: original }, lockedSections: { basicLearn: ['고정'] } };
        const aiCtx = generationContext(async () => reply('## 고정\n\n바뀐 글입니다.\n\n## 본문\n\n보강', 'MAX_TOKENS'), mod);
        aiCtx.elements['reinforce-input'].value = '보강';
        let html = '';
        aiCtx.onOverlay = overlay => { html = overlay.innerHTML; setImmediate(() => overlay.fire('click', { target: { dataset: { diffAction: 'apply' } } })); };
        await call(aiCtx, 'reinforceCurrentTab')(1);
        assert.ok(html.includes('잘렸습니다'), '잘린 응답을 알린다');
        assert.ok(mod.tabContents.basicLearn.includes('원문입니다.') && !mod.tabContents.basicLearn.includes('바뀐 글'));
        assert.ok(mod.tabContents.basicLearn.includes('원래 글입니다.'), '잘린 마지막 섹션이 본문을 덮지 않는다');
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
        const html = call(ctx, 'manualCheckRow')({ key: 'domain', text: '확인', hint: '힌트' }, next.basicLearn.domain, '본문');
        assert.ok(html.includes('확인함 · 2026-11-02 10:00') && html.includes('checked'));
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

    await run('저장: 이미지 삭제 후 숨겨진 편집기가 참조를 되살리지 않는다', async () => {
        const mod = { id: 1, title: '차시', tabContents: { basicLearn: '앞 ![그림](local:img_1) 뒤' }, images: { img_1: 'a' } };
        const aiCtx = makeContext();
        aiCtx.currentMod = mod;
        aiCtx.confirm = () => true;
        const raw = fakeElement();
        raw.value = mod.tabContents.basicLearn;
        raw.dataset = { moduleId: '1', tabId: 'basicLearn' };
        aiCtx.elements['raw-view'] = raw;
        call(aiCtx, 'deleteImage')('img_1', null);
        assert.ok(!raw.value.includes('local:img_1'));
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

    console.log('ALL PASSED');
})().catch(e => { console.error('FAIL', e.message, e.stack); process.exit(1); });
