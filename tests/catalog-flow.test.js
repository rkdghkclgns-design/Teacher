// NCS 요소·참조 목록·문제은행·차시 목록·삽화·참고 자료 흐름 테스트 (실행: node tests/catalog-flow.test.js)
// AI 응답만 스텁으로 두고 실제 파일을 실행한다. DOM이 필요한 화면 동작은 여기서 다루지 않는다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', 'js') + path.sep;
const FILES = ['kbuilder/ncs-catalog.js', 'lesson-lint.js', 'ai-routing.js', 'course-ncs.js', 'course-ncs-ref.js', 'course-design.js', 'course-sessions.js', 'course-meta.js', 'course-elements.js', 'course-list.js', 'course-art.js', 'course-illustrations.js', 'course-qbank.js', 'lesson-editor-tools.js', 'course-refs.js'];

// 실제 escapeHtml과 같게 문자열이 아니면 빈 문자열을 돌려준다
const escapeHtml = s => (typeof s === 'string' ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : '');

function makeContext(callGemini, keys = { gemini: '' }) {
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, URL, Blob, TextDecoder,
        TEXT_MODEL: 'gemini-4-argon',
        IMAGE_MODEL: 'gemini-nano-banana-2.1',
        SVG_IMAGE_MODEL: 'svg-illustration',
        apiKey: keys.gemini,
        claudeApiKey: keys.claude || '',
        isClaudeModel: m => /^claude-/.test(m),
        CONTEXT_CORE: { personas: { orchestrator: '설계자' } },
        globalState: { courseTitle: '과정', subjects: [] },
        courseData: [],
        saveState: async () => {},
        currentSubjectId: 's1',
        escapeHtml,
        safeJSONParse: t => JSON.parse(t),
        extractText: d => d.candidates[0].content.parts[0].text,
        document: { getElementById: () => null, createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} } },
        callGemini
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    FILES.forEach(file => vm.runInContext(fs.readFileSync(root + file, 'utf8'), ctx));
    return ctx;
}

const reply = obj => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] });
const plain = v => JSON.parse(JSON.stringify(v));
const noAi = async () => { throw new Error('호출되면 안 됨'); };

async function run(name, fn) {
    await fn();
    console.log('PASS', name);
}

(async () => {
    const ctx = makeContext(noAi);
    const call = name => vm.runInContext(name, ctx);
    const ofCtx = target => name => vm.runInContext(name, target);
    const realUnit = plain(call('ncsSearch')('게임 기획', 1))[0];
    const realUnit2 = plain(call('ncsSearch')('게임 기획', 3))[1];
    const LESSON = { title: '재미 설계', objectives: ['목표 하나', '목표 둘'], tabContents: { basicLearn: '## 재미\n\n본문입니다.' } };

    /* ---------- NCS 요소 추천 ---------- */
    await run('요소 추천: 요소를 등록하지 않아도 능력단위 수준으로 추천', async () => {
        const prompts = [];
        const aiCtx = makeContext(async (m, p) => {
            prompts.push(p.contents[0].parts[0].text);
            return reply({ recs: [
                { unitCode: realUnit.code, unitName: realUnit.name, fit: 85, covers: [1, 2, 9, 'x', 1], reason: '근거' },
                { unitCode: '', unitName: '목록 밖 단위', fit: 60, covers: [2], reason: '목록에 없음' },
                { unitCode: '9999999999_99v9', unitName: '지어낸 코드', fit: 99, reason: '가짜' }
            ], note: '메모' });
        }, { gemini: 'k' });
        const get = ofCtx(aiCtx);
        const { recs, note } = await get('recommendLessonElements')({ title: '게임 기획', ncs: { units: [realUnit] } }, LESSON);
        assert.ok(prompts[0].includes('(능력단위요소 미등록)') && prompts[0].includes('unitCode만 채웁니다'));
        assert.strictEqual(note, '메모');
        assert.deepStrictEqual(plain(recs).map(rec => rec.fit), [99, 85, 60], '적합도 내림차순');
        const hit = recs.find(rec => rec.unitCode === realUnit.code);
        assert.deepStrictEqual(plain(hit.covers), [1, 2], '없는 학습 목표 번호와 중복은 뺀다');
        assert.deepStrictEqual(plain(recs.map(rec => get('elementRecState')(rec))), ['out', 'ref', 'out']);
        assert.deepStrictEqual(plain(get('pickLessonElements')(recs)).map(rec => rec.unitCode), [realUnit.code], '목록 밖은 적합도가 높아도 자동으로 고르지 않는다');
    });

    await run('요소 추천: 키가 없으면 키워드 후보 중 가장 가까운 하나를 고른다', async () => {
        const { recs, note } = await call('recommendLessonElements')({ title: '게임 기획', ncs: { units: [realUnit] } }, LESSON);
        assert.ok(recs.length > 0 && recs.every(rec => rec.by === '키워드' && !rec.elementCode));
        assert.ok(note.includes('키워드'));
        const picked = plain(call('pickLessonElements')(recs));
        assert.strictEqual(picked.length, 1, '차시를 비워 두지 않는다');
        assert.strictEqual(picked[0].unitCode, realUnit.code, '교과에 배정한 단위를 앞에 둔다');
    });

    await run('요소 추천: 응답을 읽지 못하면 알린다', async () => {
        const empty = makeContext(async () => reply({ recs: [{ fit: 90 }] }), { gemini: 'k' });
        await assert.rejects(ofCtx(empty)('recommendLessonElements')({ title: '교과' }, LESSON), /읽지 못했습니다/);
    });

    await run('요소 판정: 지어낸 요소는 단위가 맞아도 목록 밖, 미검증 표시', async () => {
        ctx.globalState.ncsElements = { [realUnit.code]: [{ code: 'E1', name: '등록 요소' }, { code: '', name: '이름만' }] };
        const state = call('elementRecState');
        const rec = extra => ({ unitCode: realUnit.code, elementCode: '', elementName: '', ...extra });
        assert.strictEqual(state(rec({ elementCode: 'E1', elementName: '등록 요소' })), 'ref');
        assert.strictEqual(state(rec({ elementName: '이름만' })), 'ref', '코드 없이 등록한 요소는 이름으로 찾는다');
        assert.strictEqual(state(rec({ elementCode: 'E9', elementName: '지어낸 요소' })), 'out');
        ctx.globalState.ncsUnverified = { [realUnit.code]: true };
        assert.strictEqual(state(rec({ elementCode: 'E1', elementName: '등록 요소' })), 'unverified');
        ctx.globalState.ncsElements = {};
        ctx.globalState.ncsUnverified = {};
        const owner = call('normalizeElementRec')({ elementCode: 'E1', elementName: '요소', fit: 150 }, 2);
        assert.strictEqual(owner.fit, 100, '적합도 상한');
        assert.deepStrictEqual(plain(call('normalizeElementRec')({ covers: 'no' }, 2).covers), [], '배열이 아닌 covers를 견딘다');
    });

    /* ---------- NCS 자동 배정 ---------- */
    const assignReply = (extra = {}) => async () => reply({ recs: [
        { unitCode: realUnit.code, unitName: realUnit.name, fit: 90, covers: [1], reason: '높음' },
        { unitCode: realUnit2.code, unitName: realUnit2.name, fit: 75, covers: [2], reason: '보통' },
        { unitCode: '', unitName: '목록 밖', fit: 95, reason: '가짜' }
    ], note: '', ...extra });

    await run('자동 배정: 미확정으로 고르고 문서에 미확정을 밝힌다', async () => {
        const aiCtx = makeContext(assignReply(), { gemini: 'k' });
        const get = ofCtx(aiCtx);
        const mod = { ...LESSON };
        assert.strictEqual(get('needsElementAutoAssign')(mod), true);
        assert.strictEqual(await get('assignLessonElements')({ title: '교과' }, mod), true);
        assert.deepStrictEqual(plain(mod.ncsElements).map(element => element.unitCode), [realUnit.code, realUnit2.code]);
        assert.ok(mod.ncsAuto && mod.ncsElements.every(element => element.auto && element.unitLevel));
        assert.ok(get('elementLabel')(mod.ncsElements[0]).endsWith('(미확정)'));
        assert.ok(mod.history[0].note.includes('확정 전'));
        assert.strictEqual(get('needsElementAutoAssign')(mod), false, '한 번만 시도한다');
    });

    await run('자동 배정: 70점 미만이면 40점 이상 1위 하나', async () => {
        const low = makeContext(async () => reply({ recs: [{ unitCode: realUnit.code, unitName: '단위', fit: 55 }, { unitCode: realUnit2.code, unitName: '단위2', fit: 30 }] }), { gemini: 'k' });
        const mod = { ...LESSON };
        await ofCtx(low)('assignLessonElements')({ title: '교과' }, mod);
        assert.deepStrictEqual(plain(mod.ncsElements).map(element => element.unitCode), [realUnit.code]);
    });

    await run('자동 배정: 40점 미만이어도 가장 가까운 후보를 고르고 목록 밖은 고르지 않는다', async () => {
        const low = makeContext(async () => reply({ recs: [{ unitCode: realUnit.code, unitName: '단위', fit: 20 }, { unitCode: '', unitName: '목록 밖', fit: 90 }] }), { gemini: 'k' });
        const mod = { ...LESSON };
        await ofCtx(low)('assignLessonElements')({ title: '교과' }, mod);
        assert.deepStrictEqual(plain(mod.ncsElements).map(element => element.unitCode), [realUnit.code]);
        const outOnly = makeContext(async () => reply({ recs: [{ unitCode: '', unitName: '목록 밖', fit: 90 }] }), { gemini: 'k' });
        const kept = { ...LESSON, ncsElements: [{ code: realUnit2.code, name: '키워드', unitCode: realUnit2.code, auto: true }], ncsAuto: true, ncsKeyword: true };
        await ofCtx(outOnly)('assignLessonElements')({ title: '교과' }, kept);
        assert.strictEqual(kept.ncsElements[0].code, realUnit2.code, '고를 후보가 없으면 키워드로 채운 값을 지우지 않는다');
    });

    await run('빈 차시: 교안이 없어도 키워드로 채우고, 해제한 차시와 메인 퀘스트는 두며, 교안이 생기면 AI로 다시 배정한다', async () => {
        const fillCtx = makeContext(noAi);
        const get = ofCtx(fillCtx);
        let rendered = 0;
        fillCtx.renderSidebar = () => { rendered += 1; };
        const subject = { id: 's1', title: '게임 기획', ncs: { units: [realUnit2] }, lessons: [
            { id: 1, title: '게임 기획서 작성', objectives: ['게임 기획서를 양식에 맞게 작성할 수 있습니다.'] },
            { id: 2, title: '해제한 차시', ncsNone: true, ncsElements: [] },
            { id: 'mainQuest', title: '메인 퀘스트' },
            { id: 3, title: '확정한 차시', ncsElements: [{ code: 'X', name: '확정', unitCode: 'X' }], ncsAuto: false }
        ] };
        await get('fillMissingLessonNcs')(subject);
        const [first, cleared, quest, confirmed] = subject.lessons;
        assert.strictEqual(first.ncsElements.length, 1);
        assert.ok(first.ncsAuto && first.ncsKeyword && first.ncsElements[0].auto, '확정 전 키워드 배정');
        assert.strictEqual(first.ncsElements[0].unitCode, realUnit2.code, '교과에 배정한 단위 안에서 고른다');
        assert.ok(!cleared.ncsElements.length && !quest.ncsElements && confirmed.ncsElements[0].code === 'X');
        assert.strictEqual(rendered, 1, '채웠으면 목록을 다시 그린다');
        await get('fillMissingLessonNcs')(subject);
        assert.strictEqual(rendered, 1, '채울 것이 없으면 다시 그리지 않는다');
        const aiCtx = makeContext(assignReply(), { gemini: 'k' });
        const withBody = { ...first, tabContents: { basicLearn: '## 학습 목표\n\n- 게임 기획서를 양식에 맞게 작성할 수 있습니다.\n\n## 기획서\n\n본문입니다.' } };
        assert.strictEqual(ofCtx(aiCtx)('needsElementAutoAssign')(withBody), true, '키워드로 채운 차시는 교안이 생기면 AI 배정 대상');
        await ofCtx(aiCtx)('assignLessonElements')(subject, withBody);
        assert.ok(!withBody.ncsKeyword && withBody.ncsElements[0].unitCode === realUnit.code, 'AI 배정으로 바꾼다');
    });

    await run('자동 배정: 확정한 선택은 덮어쓰지 않는다', async () => {
        let calls = 0;
        const aiCtx = makeContext(async () => { calls += 1; return reply({ recs: [] }); }, { gemini: 'k' });
        const confirmed = { ...LESSON, ncsElements: [{ code: 'X', name: '확정', unitCode: 'U' }], ncsAuto: false };
        assert.strictEqual(await ofCtx(aiCtx)('assignLessonElements')({ title: '교과' }, confirmed), false);
        assert.strictEqual(calls, 0, '확정한 차시는 호출도 하지 않는다');
        assert.strictEqual(confirmed.ncsElements[0].code, 'X');
    });

    await run('자동 배정: 기다리는 사이 사용자가 고른 값을 지킨다', async () => {
        const mod = { ...LESSON };
        const aiCtx = makeContext(async () => {
            mod.ncsElements = [{ code: 'USER', name: '사용자 선택', unitCode: 'U' }];
            mod.ncsAuto = false;
            return assignReply()();
        }, { gemini: 'k' });
        assert.strictEqual(await ofCtx(aiCtx)('assignLessonElements')({ title: '교과' }, mod), false);
        assert.strictEqual(mod.ncsElements[0].code, 'USER');
        assert.strictEqual(mod.ncsRecs.length, 3, '후보는 남긴다');
        const emptied = { ...LESSON };
        const clearing = makeContext(async () => {
            emptied.ncsElements = [{ code: 'A', name: 'a', unitCode: 'U' }];
            emptied.ncsAuto = true;
            return assignReply()();
        }, { gemini: 'k' });
        await ofCtx(clearing)('assignLessonElements')({ title: '교과' }, emptied);
        assert.strictEqual(emptied.ncsElements[0].code, 'A', '미확정 값이어도 사용자가 바꿨으면 유지');
    });

    await run('확정: 그대로 저장하면 미확정 유지, 고치거나 확정하면 확정', async () => {
        const element = { code: 'E1', name: '요소', unitCode: 'U', unitName: '단위', auto: true };
        const mod = { title: '차시', ncsElements: [element], ncsAuto: true };
        const key = call('elementKey')(element);
        const setDraft = draft => vm.runInContext('(draft => { _metaDraft = draft; })', ctx)(draft);
        const base = { mod, options: [], selected: new Set([key]), confirm: false };
        setDraft(base);
        assert.deepStrictEqual(plain(call('metaElementResult')()), { ncsElements: [element], ncsAuto: true }, '다른 칸만 고쳐 저장');
        setDraft({ ...base, confirm: true });
        const confirmed = plain(call('metaElementResult')());
        assert.strictEqual(confirmed.ncsAuto, false);
        assert.ok(!('auto' in confirmed.ncsElements[0]), '확정하면 미확정 표시를 지운다');
        setDraft({ ...base, selected: new Set() });
        assert.deepStrictEqual(plain(call('metaElementResult')()), { ncsElements: [], ncsAuto: false, ncsKeyword: false, ncsNone: true }, '모두 해제해도 사용자의 결정이고, 빈 차시 채우기가 다시 넣지 않는다');
        assert.strictEqual(confirmed.ncsNone, false);
        setDraft(null);
    });

    await run('요소 목록: 추천·등록·기존 선택을 합치고 코드 없는 목록 밖은 고를 수 없다', async () => {
        const mod = {
            ncsRecs: [{ unitCode: 'U1', unitName: '단위', elementCode: 'E1', elementName: '요소', fit: 80, covers: [1, 2], reason: '<b>근거</b>', by: 'AI' }, { unitCode: '', unitName: '목록 밖', elementCode: '', elementName: '', fit: 50, covers: [], reason: '', by: 'AI' }],
            ncsElements: [{ code: 'OLD', name: '이전 선택', unitCode: 'U0', unitName: '이전 단위' }]
        };
        const entries = call('lessonElementEntries')(mod, [{ code: 'E1', name: '요소', unitCode: 'U1', unitName: '단위' }, { code: 'E2', name: '둘', unitCode: 'U1', unitName: '단위' }]);
        assert.deepStrictEqual(plain(entries).map(entry => entry.key), ['U1::E1', '::목록 밖', 'U1::E2', 'U0::OLD']);
        const html = call('elementRowHtml')(entries[0], true);
        assert.ok(html.includes('학습 목표 1 · 2') && html.includes('적합도 80') && html.includes('목록 밖'), html);
        assert.ok(!html.includes('<b>') && html.includes('&lt;b&gt;'), '근거를 이스케이프한다');
        assert.ok(call('elementRowHtml')(entries[1], false).includes('disabled'));
    });

    await run('교과 자동 배정: 키가 있고 시도한 적 없을 때만', async () => {
        const aiCtx = makeContext(noAi, { gemini: 'k' });
        const needs = ofCtx(aiCtx)('needsNcsAutoAssign');
        assert.strictEqual(needs({ title: '교과' }), true, '과정 설계로 만들지 않은 교과');
        assert.strictEqual(needs({ title: '교과', ncs: { units: [], recs: [], autoTried: true } }), false, '실패해도 다시 시도하지 않는다');
        assert.strictEqual(needs({ title: '교과', ncs: { units: [{ code: 'A' }] } }), false);
        assert.strictEqual(needs({ title: '교과', ncs: { units: [], recs: [{ code: 'A' }] } }), false);
        assert.strictEqual(call('needsNcsAutoAssign')({ title: '교과' }), false, '키가 없으면 호출하지 않는다');
    });

    await run('교과 자동 배정: 기다리는 사이 확정하면 덮어쓰지 않는다', async () => {
        const subject = { title: '게임 기획', lessons: [] };
        let first = true;
        const aiCtx = makeContext(async (m, p) => {
            const text = p.contents[0].parts[0].text;
            if (text.includes('세분류를')) return reply({ subds: [realUnit.subd] });
            if (first) {
                first = false;
                subject.ncs = { units: [{ code: 'MINE' }], recs: [], confirmed: true, updatedAt: 'x' };
            }
            return reply([{ code: realUnit.code, score: 90, reason: '근거' }]);
        }, { gemini: 'k' });
        await ofCtx(aiCtx)('autoAssignNcs')(subject);
        assert.strictEqual(subject.ncs.units[0].code, 'MINE');
        assert.strictEqual(subject.ncs.confirmed, true);
    });

    await run('능력단위 후보: 덮는 학습 목표 표시', async () => {
        const subject = { title: '게임 기획', lessons: [{ title: '차시 하나', objectives: ['첫 목표', '둘째 목표'] }, { title: '차시 둘', objectives: ['셋째 목표'] }] };
        const refs = plain(call('subjectObjectiveRefs')(subject));
        assert.deepStrictEqual(refs.map(item => item.ref), ['1.1', '1.2', '2.1']);
        const byCode = new Map([['A', {}]]);
        const rows = plain(call('parseNcsRank')([{ code: 'A', score: 80, objectives: ['1.1', '9.9', 2], reason: '' }], byCode, refs));
        assert.deepStrictEqual(rows[0].objectives, ['1.1'], '없는 번호는 뺀다');
        const merged = plain(call('mergeNcsRanks')([[{ code: 'A', score: 80, objectives: ['1.2'], reason: '' }], [{ code: 'A', score: 90, objectives: ['1.1', '1.2'], reason: '' }]]));
        assert.deepStrictEqual(merged[0].objectives, ['1.1', '1.2'], '두 모델의 판단을 합친다');
        const seen = [];
        const aiCtx = makeContext(async (m, p) => {
            const text = p.contents[0].parts[0].text;
            seen.push(text);
            return reply(text.includes('세분류를') ? { subds: [] } : [{ code: realUnit.code, score: 90, objectives: ['2.1'], reason: '근거' }]);
        }, { gemini: 'k' });
        const recs = plain(await ofCtx(aiCtx)('recommendSubjectNcs')(subject));
        assert.deepStrictEqual(recs[0].objectives, ['2.1']);
        assert.ok(seen.at(-1).includes('2.1 셋째 목표'));
        const html = call('ncsRowHtml')({ ...realUnit, objectives: ['1.1', '2.1'], by: 'AI', score: 90 }, false);
        assert.ok(html.includes('학습 목표 1.1 · 2.1'));
    });

    /* ---------- 참조 목록 ---------- */
    await run('참조 목록: 직접 추가 단위 편집·검증·삭제', async () => {
        const save = call('saveNcsRefUnit');
        assert.throws(() => save({ code: '', name: '이름', elements: [] }), /코드와 이름/);
        assert.throws(() => save({ code: 'X9', name: ' ', elements: [] }), /코드와 이름/);
        assert.strictEqual(save({ code: ' X9 ', name: '직접 단위', level: '3', subclass: '세분류', elements: [{ code: 'X9.1', name: '요소' }], verified: false }), 'X9');
        const info = plain(call('ncsRefInfo')('X9'));
        assert.deepStrictEqual([info.name, info.level, info.path[3], info.custom, info.verified, info.elements.length], ['직접 단위', 3, '세분류', true, false, 1]);
        save({ code: 'X9', name: '고친 이름', level: '', subclass: '', elements: [], verified: true });
        const edited = plain(call('ncsRefInfo')('X9'));
        assert.deepStrictEqual([edited.name, edited.verified, edited.elements.length], ['고친 이름', true, 0]);
        assert.strictEqual(ctx.globalState.ncsCustomUnits.length, 1, '같은 코드는 한 줄로 유지');
        vm.runInContext("_ncsRef = { query: '', editing: null }", ctx);
        save({ code: 'X9', name: '<b>이름</b>', subclass: '<i>분류</i>', elements: [{ code: '', name: '<u>요소</u>' }], verified: true });
        const rowsHtml = call('ncsRefRowsHtml')(plain(call('ncsRefRows')('')));
        assert.ok(!/<b>|<i>|<u>/.test(rowsHtml) && rowsHtml.includes('&lt;b&gt;이름'), '목록의 사용자 입력을 이스케이프한다');
        assert.ok(rowsHtml.includes('직접 추가') && rowsHtml.includes('확인'));
        const formHtml = call('ncsRefFormHtml')(plain(call('ncsRefInfo')('X9')));
        assert.ok(!formHtml.includes('<b>이름') && formHtml.includes('data-ncs-ref-action="delete"'));
        assert.ok(!call('ncsRefFormHtml')(null).includes('checked'), '새 단위는 확인 전 상태로 시작한다');
        vm.runInContext('_ncsRef = null', ctx);
        call('deleteNcsRefUnit')('X9');
        assert.strictEqual(call('ncsRefInfo')('X9'), null);
        assert.deepStrictEqual(plain(call('ncsRefStats')()).custom, 0);
    });

    await run('참조 목록: 내장 단위는 이름을 바꾸지 않고 요소와 검증만 저장', async () => {
        const save = call('saveNcsRefUnit');
        save({ code: realUnit.code, name: '바꾼 이름', elements: [{ code: 'E1', name: '요소' }], verified: false });
        const info = plain(call('ncsRefInfo')(realUnit.code));
        assert.strictEqual(info.name, realUnit.name);
        assert.deepStrictEqual([info.custom, info.verified, info.elements.length], [false, false, 1]);
        assert.deepStrictEqual(plain(call('enrichedNcsUnits')()).map(unit => unit.code), [realUnit.code]);
        assert.deepStrictEqual(plain(call('ncsRefRows')('')).map(unit => unit.code), [realUnit.code], '검색어가 없으면 보강한 단위만');
        assert.ok(plain(call('ncsRefRows')(realUnit.code)).some(unit => unit.code === realUnit.code), '코드로 찾는다');
        assert.ok(call('ncsRowHtml')(realUnit, false).includes('미검증'));
        save({ code: realUnit.code, elements: [], verified: true });
        assert.deepStrictEqual(plain(call('enrichedNcsUnits')()), [], '요소와 검증 표시를 비우면 목록에서 빠진다');
        assert.ok(!call('ncsRowHtml')(realUnit, false).includes('미검증'));
    });

    /* ---------- 문제은행 ---------- */
    const spec = { objective: 2, band: 'L2', type: '코드제출', multi: false, count: 1 };

    await run('빈 문항: AI 없이 추가해도 뒤따르는 본문을 삼키지 않는다', async () => {
        const blank = call('blankQuestion')({ objective: 1, band: 'L1', type: '객관식', multi: true }, { tabContents: {} });
        assert.deepStrictEqual([blank.objective, blank.band, blank.type, blank.multi, blank.typed], [1, 'L1', '객관식', true, true]);
        const md = '### 문제 1. 첫 문항\n학습 목표 1 · 밴드 L1 · 단답식\n\n✅ **정답:** 값\n\n---\n\n**채점 기준표**\n\n<table></table>\n';
        const added = call('appendQuestionsMd')(md, [{ ...blank, stem: '직접 쓴 문항', multi: false }]);
        const blocks = call('lessonLintQuestions')(added);
        assert.strictEqual(blocks.length, 2);
        assert.ok(!blocks[1].includes('채점 기준표'), '필드가 없는 문항도 구분선에서 끝난다');
        assert.ok(call('removeQuestionMd')(added, 1).includes('<table>'), '새 문항을 지워도 채점표는 남는다');
        assert.strictEqual(call('parseQuestionBlock')(blocks[1]).stem, '직접 쓴 문항');
    });

    await run('복수 정답: 생성 프롬프트와 결과에 반영', async () => {
        const multi = { objective: 1, band: 'L1', type: '객관식', multi: true, count: 2 };
        const prompt = call('buildQuestionPrompt')({ title: '차시', tabContents: {} }, multi, ['목표'], []);
        assert.ok(prompt.includes('(복수 정답)') && prompt.includes('정답 2개 이상'));
        const single = call('buildQuestionPrompt')({ title: '차시', tabContents: {} }, { ...multi, multi: false }, ['목표'], []);
        assert.ok(single.includes('정확히 하나') && !single.includes('(복수 정답)'));
        const [q] = plain(call('parseGeneratedQuestions')('### 문제 1. 판단\n학습 목표 1 · 밴드 L1 · 객관식\n\n맞는 것을 고릅니다.\n\n① 가\n② 나\n③ 다\n④ 라\n\n✅ **정답:** ①, ②\n', multi));
        assert.strictEqual(q.multi, true);
        assert.ok(q.stem.includes('모두 고르시오'), '복수 선택임을 문항에 밝힌다');
        assert.deepStrictEqual(plain(call('lintQuestion')(q)), []);
        const again = plain(call('parseQuestionBlock')(call('serializeQuestion')(q, 1)));
        assert.strictEqual(again.multi, true, '왕복해도 복수 정답 유지');
        const [other] = plain(call('parseGeneratedQuestions')('### 문제 1. 단답\n학습 목표 1 · 밴드 L1 · 단답식\n\n✅ **정답:** 값\n', { ...multi, type: '단답식' }));
        assert.strictEqual(other.multi, false, '객관식이 아니면 복수 정답이 아니다');
    });

    await run('시작 코드: 왕복해도 한 글자도 바뀌지 않는다', async () => {
        const code = [
            '# 입력 받기', '', '', '    들여쓴 줄', '---', '### 문제 9. 코드 안 가짜 문항', '✅ **정답:** 코드 안 가짜 정답', '학습 목표 7 · 밴드 L3',
            '<span>태그</span>', '① 보기처럼 보이는 줄', '```', '끝 줄'
        ].join('\n');
        const q = { ...plain(call('blankQuestion')(spec, { tabContents: {} })), no: 1, title: '코드 문항', stem: '요구사항입니다.', lang: 'python', code, tests: '입력 1 → 출력 2', hint: '힌트' };
        const written = call('serializeQuestion')(q, 1);
        const block = call('lessonLintQuestions')(written);
        assert.strictEqual(block.length, 1, '코드 안의 문제 제목으로 나뉘지 않는다');
        const parsed = plain(call('parseQuestionBlock')(block[0]));
        assert.strictEqual(parsed.code, code);
        assert.strictEqual(parsed.lang, 'python');
        assert.deepStrictEqual([parsed.objective, parsed.band, parsed.answer, parsed.tests, parsed.hint], [2, 'L2', '', '입력 1 → 출력 2', '힌트'], '코드 안의 표기로 필드를 읽지 않는다');
        assert.deepStrictEqual(parsed, plain(call('parseQuestionBlock')(call('serializeQuestion')(parsed, 1))), '두 번 왕복해도 같다');
        assert.strictEqual(call('serializeQuestion')(parsed, 1), written, '쓰는 결과도 같다');
        assert.deepStrictEqual(plain(call('lintQuestion')(parsed)), []);
    });

    await run('시작 코드: 펜스 없이 쓴 값과 빈 값', async () => {
        const inline = plain(call('parseQuestionBlock')('### 문제 1. 코드\n학습 목표 1 · 밴드 L2 · 코드제출\n\n🧩 **시작 코드:** print(1)\n\n🧪 **테스트:** 1\n'));
        assert.deepStrictEqual([inline.code, inline.lang, inline.tests], ['print(1)', '', '1']);
        const again = plain(call('parseQuestionBlock')(call('serializeQuestion')(inline, 1)));
        assert.strictEqual(again.code, 'print(1)');
        assert.ok(!call('serializeQuestion')({ ...inline, code: '' }, 1).includes('시작 코드'), '없으면 쓰지 않는다');
    });

    await run('왕복: 해설의 빈 줄과 코드 블록을 지킨다', async () => {
        const block = '### 문제 1. 서술\n학습 목표 1 · 밴드 L2 · 서술형\n\n```js\nconst a = 1;\n\n---\n```\n\n✅ **정답:** 답\n\n📝 **해설:** 첫 문단\n\n둘째 문단\n\n📏 **채점 기준:** 기준 (5점)\n';
        const q = plain(call('parseQuestionBlock')(block));
        assert.strictEqual(q.stem, '```js\nconst a = 1;\n\n---\n```');
        assert.strictEqual(q.explanation, '첫 문단\n\n둘째 문단');
        assert.deepStrictEqual(plain(call('parseQuestionBlock')(call('serializeQuestion')(q, 1))), q);
    });

    await run('번호 다시 매기기: 코드 안의 문제 제목은 그대로', async () => {
        const md = '### 문제 1. 첫째\n학습 목표 1 · 밴드 L1 · 단답식\n\n✅ **정답:** 값\n\n---\n\n### 문제 2. 둘째\n학습 목표 1 · 밴드 L2 · 코드제출\n\n🧩 **시작 코드:**\n\n```text\n### 문제 7. 코드\n```\n\n🧪 **테스트:** 1\n\n---\n\n### 문제 3. 셋째\n학습 목표 1 · 밴드 L1 · 단답식\n\n✅ **정답:** 값\n';
        const removed = call('removeQuestionMd')(md, 0);
        assert.ok(removed.includes('### 문제 1. 둘째') && removed.includes('### 문제 2. 셋째'));
        assert.ok(removed.includes('### 문제 7. 코드'), '코드는 바꾸지 않는다');
        const ten = Array.from({ length: 11 }, (_, i) => `### 문제 ${i + 1}. 항목\n학습 목표 1 · 밴드 L1 · 단답식\n\n✅ **정답:** 값\n\n---\n`).join('\n');
        const shifted = call('removeQuestionMd')(ten, 0);
        assert.deepStrictEqual(plain(call('lessonLintQuestions')(shifted).map(call('parseQuestionBlock'))).map(q => q.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '자릿수가 바뀌어도 맞다');
    });

    await run('코드 언어 힌트: 교안 코드 블록에서 찾고 도식은 뺀다', async () => {
        const mod = { title: '차시', tabContents: { basicLearn: '```python\nprint(1)\n```\n\n```mermaid\ngraph TD\n```\n', basicPrac: '```lua\nprint(2)\n```\n' } };
        assert.deepStrictEqual(plain(call('lessonCodeLangs')(mod)), ['Python', 'Lua']);
        assert.ok(call('buildQuestionPrompt')(mod, spec, ['목표'], []).includes('Python, Lua'));
        assert.strictEqual(call('blankQuestion')(spec, mod).lang, 'python', '빈 코드제출 문항은 교안 언어로 시작한다');
        const none = call('qbankCodeRule')({ tools: [{ name: 'Unity', version: '6' }], tabContents: {} }, '코드제출');
        assert.ok(none.includes('Unity 6') && none.includes('언어 하나를 골라'));
    });

    await run('교과 CSV: 그 교과 문항만, 시작 코드 포함', async () => {
        const md = '### 문제 1. 코드 문항\n학습 목표 1 · 밴드 L2 · 코드제출\n\n🧩 **시작 코드:**\n\n```js\nlet a;\n```\n\n🧪 **테스트:** 1\n';
        const mine = { id: 's1', title: '내 교과', lessons: [] };
        const other = { id: 's2', title: '다른 교과', lessons: [{ title: '다른 차시', tabContents: { assessment: md.replace('코드 문항', '다른 문항') } }] };
        ctx.globalState.subjects = [mine, other];
        vm.runInContext('courseData = [{ title: "내 차시", tabContents: { assessment: ' + JSON.stringify(md) + ' } }]', ctx);
        const { rows, csv } = call('subjectQuestionsCsv')(mine);
        assert.strictEqual(rows, 1);
        assert.ok(csv.includes('내 차시') && csv.includes('시작코드') && csv.includes('let a;') && !csv.includes('다른 문항'), '현재 교과는 courseData를 읽는다');
        assert.strictEqual(call('courseQuestionsCsv')().rows, 2);
        assert.strictEqual(call('subjectQuestionsCsv')({ id: 's3', title: '빈 교과', lessons: [] }).rows, 0);
        ctx.globalState.subjects = [];
        vm.runInContext('courseData = []', ctx);
    });

    await run('밴드 카드와 지적 문항 목록', async () => {
        const cards = call('qbankBandCardsHtml')();
        ['L1', 'L2', 'L3', 'L4', '프로젝트에서 다룸', '객관식 · 단답식'].forEach(text => assert.ok(cards.includes(text), text));
        const questions = [
            { no: 1, title: '<script>', stem: '', band: 'L1', type: '객관식', typed: true, choices: [], answer: '', accepted: '', rubric: '', tests: '', review: '', objective: 1 },
            { no: 2, title: '통과', stem: '문항', band: 'L1', type: '단답식', typed: true, choices: [], answer: '값', accepted: '', rubric: '', tests: '', review: '', objective: 1 }
        ];
        const html = call('qbankFlaggedHtml')(questions, []);
        assert.ok(html.includes('data-index="0"') && !html.includes('data-index="1"'), '지적이 있는 문항만');
        assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'), '제목을 이스케이프한다');
    });

    /* ---------- 차시 목록 ---------- */
    await run('카테고리 묶음: 이름순, 카테고리 없음은 맨 뒤', async () => {
        const groups = plain(call('groupLessonsByCategory')([{ title: '가', category: '심화' }, { title: '나' }, { title: '다', category: '기초' }, { title: '라', category: '기초' }]));
        assert.deepStrictEqual(groups.map(group => [group.title, group.lessons.length]), [['기초', 2], ['심화', 1], ['(카테고리 없음)', 1]]);
        assert.deepStrictEqual(plain(call('groupLessonsByCategory')([])), []);
    });

    await run('NCS 필터: 고른 요소와 미대응', async () => {
        const element = { code: 'E1', name: '요소', unitCode: 'U', unitName: '단위' };
        const key = call('elementKey')(element);
        const lessons = [{ title: '대응', ncsElements: [element] }, { title: '미대응' }];
        const setFilter = keys => vm.runInContext('(keys => { _lessonFilter = { ..._lessonFilter, ncs: keys }; })', ctx)(keys);
        assert.ok(lessons.every(call('lessonMatchesNcs')), '필터가 없으면 모두');
        setFilter([key]);
        assert.deepStrictEqual(lessons.filter(call('lessonMatchesNcs')).map(item => item.title), ['대응']);
        setFilter(['__none']);
        assert.deepStrictEqual(lessons.filter(call('lessonMatchesNcs')).map(item => item.title), ['미대응']);
        assert.strictEqual(call('lessonMatchesFilter')(lessons[0]), false, '상태·검색 필터와 함께 적용');
        setFilter([]);
        const usage = plain(call('lessonNcsUsage')(lessons));
        assert.deepStrictEqual([usage.rows.length, usage.rows[0].count, usage.none], [1, 1, 1]);
    });

    await run('목록 배지: 필수 위반·문항 수·제목 중복', async () => {
        const assessment = '### 문제 1. 문항\n학습 목표 1 · 밴드 L1 · 단답식\n\n✅ **정답:** 값\n';
        const mod = { id: 1, title: '같은 제목', tabContents: { basicLearn: '## 학습 목표\n\n- 내용을 이해한다.\n\n다음 시간에 이어서 봅니다.\n', assessment }, ncsElements: [{ code: 'A', name: 'a', unitCode: 'U', auto: true }], ncsAuto: true };
        const twin = { id: 2, title: '같은 제목', tabContents: {} };
        ctx.globalState.subjects = [{ id: 's1', title: '교과', lessons: [] }, { id: 's2', title: '다른 교과', lessons: [twin] }];
        vm.runInContext('(lesson => { courseData = [lesson]; })', ctx)(mod);
        const msgs = plain(call('lessonRequiredIssues')(mod)).map(issue => issue.msg);
        assert.ok(msgs.some(msg => msg.includes('~할 수 있습니다')), '필수 규칙');
        assert.ok(msgs.some(msg => msg.includes('다른 차시를 지칭')));
        const warnOnly = { tabContents: { basicLearn: '## 학습 목표\n\n- 짧은 목표를 정할 수 있습니다.\n' } };
        assert.deepStrictEqual(plain(call('lessonRequiredIssues')(warnOnly)), [], '권장 규칙은 세지 않는다');
        const html = call('lessonListBadges')(mod);
        ['필수 위반', '문항 1', 'NCS 1?', '제목 중복'].forEach(text => assert.ok(html.includes(text), text));
        assert.strictEqual(call('lessonListBadges')({ id: 3, title: '혼자', tabContents: {} }), '');
        assert.strictEqual(call('lessonTitleTaken')('같은 제목', 1), true, '다른 교과까지 확인한다');
        assert.strictEqual(call('lessonTitleTaken')('같은 제목', 'x'), true);
        assert.strictEqual(call('lessonTitleTaken')('혼자', 1), false);
        ctx.globalState.subjects = [];
        vm.runInContext('courseData = []', ctx);
    });

    await run('제목 저장: 바꿔서 겹칠 때만 막고 원래 겹치던 제목은 막지 않는다', async () => {
        const mod = { id: 1, title: '새 차시' };
        ctx.globalState.subjects = [{ id: 's1', title: '교과', lessons: [] }];
        vm.runInContext('(lesson => { courseData = [lesson, { id: 2, title: "새 차시" }, { id: 3, title: "다른 차시" }]; })', ctx)(mod);
        const blocked = call('metaTitleBlocked');
        assert.strictEqual(blocked('새 차시', mod), false, '기본 제목이 겹쳐도 상태는 저장할 수 있다');
        assert.strictEqual(blocked('다른 차시', mod), true);
        assert.strictEqual(blocked('고유한 제목', mod), false);
        assert.strictEqual(blocked('', mod), true);
        ctx.globalState.subjects = [];
        vm.runInContext('courseData = []', ctx);
    });

    await run('카테고리 관리: 모든 교과에 이름 변경·삭제와 이력', async () => {
        const inCurrent = { id: 1, title: '가', category: '기초' };
        const inOther = { id: 2, title: '나', category: '기초' };
        const untouched = { id: 3, title: '다', category: '심화' };
        ctx.globalState.subjects = [{ id: 's1', title: '교과', lessons: [] }, { id: 's2', title: '다른 교과', lessons: [inOther, untouched] }];
        vm.runInContext('(lesson => { courseData = [lesson]; })', ctx)(inCurrent);
        assert.deepStrictEqual(plain(call('lessonCategories')()), [{ name: '기초', count: 2 }, { name: '심화', count: 1 }]);
        assert.strictEqual(call('renameLessonCategory')('기초', '입문'), 2);
        assert.deepStrictEqual([inCurrent.category, inOther.category, untouched.category], ['입문', '입문', '심화']);
        assert.ok(inCurrent.history[0].note.includes('기초 → 입문'));
        assert.strictEqual(call('deleteLessonCategory')('입문'), 2);
        assert.deepStrictEqual([inCurrent.category, inOther.category], ['', '']);
        assert.ok(inOther.history[0].note.includes('삭제'));
        ctx.globalState.subjects = [];
        vm.runInContext('courseData = []', ctx);
    });

    await run('교과 간 이동: 내용과 이력을 함께 옮긴다', async () => {
        const lesson = { id: 1, title: '옮길 차시', tabContents: { basicLearn: '본문' } };
        const stay = { id: 2, title: '남는 차시' };
        const from = { id: 's1', title: '출발 교과', lessons: [] };
        const to = { id: 's2', title: '도착 교과', lessons: [] };
        ctx.globalState.subjects = [from, to];
        vm.runInContext('((a, b) => { courseData = [a, b]; })', ctx)(lesson, stay);
        assert.strictEqual(call('moveLessonToSubject')(lesson, 's1'), false, '같은 교과면 옮기지 않는다');
        assert.strictEqual(call('moveLessonToSubject')(lesson, '없는 교과'), false);
        assert.strictEqual(call('moveLessonToSubject')(lesson, 's2'), true);
        assert.deepStrictEqual(plain(vm.runInContext('courseData.map(item => item.title)', ctx)), ['남는 차시']);
        assert.strictEqual(from.lessons.length, 1);
        assert.strictEqual(to.lessons[0], lesson);
        assert.strictEqual(lesson.tabContents.basicLearn, '본문');
        assert.ok(lesson.history[0].note.includes('출발 교과 → 도착 교과'));
        ctx.globalState.subjects = [];
        vm.runInContext('courseData = []', ctx);
    });

    await run('휴지통: 30일 자동 삭제와 남은 기간', async () => {
        const now = Date.parse('2026-11-02T00:00:00Z');
        const entry = days => ({ lesson: { id: days, title: `${days}일` }, subjectId: 's1', at: new Date(now - days * 86400000).toISOString() });
        const live = call('liveLessonTrash');
        assert.deepStrictEqual(plain(live([entry(0), entry(29), entry(30), entry(45)], now)).map(item => item.lesson.id), [0, 29]);
        assert.strictEqual(call('trashDaysLeft')(entry(0), now), 30);
        assert.strictEqual(call('trashDaysLeft')(entry(29), now), 1);
        assert.strictEqual(call('trashDaysLeft')(entry(40), now), 0);
        assert.strictEqual(live([{ lesson: {}, at: '읽을 수 없음' }], now).length, 1, '날짜를 읽지 못하면 지우지 않는다');
        assert.deepStrictEqual(plain(live(undefined, now)), []);
        const expired = { lesson: { id: 9, title: '지난 차시' }, subjectId: 's1', at: new Date(Date.now() - 31 * 86400000).toISOString() };
        const fresh = { lesson: { id: 8, title: '최근 차시' }, subjectId: 's1', at: new Date().toISOString() };
        ctx.globalState.lessonTrash = [expired, fresh];
        assert.ok(call('renderLessonTrashButton')().includes('휴지통 1'), '목록을 그릴 때 지난 항목을 비운다');
        assert.ok(call('renderTrashRows')().includes('남은 기간 30일'));
        ctx.globalState.lessonTrash = [];
    });

    await run('휴지통 복원: 같은 제목이 있으면 구분해서 되살린다', async () => {
        const subject = { id: 's1', title: '교과', lessons: [] };
        ctx.globalState.subjects = [subject];
        vm.runInContext('courseData = [{ id: 1, title: "같은 제목" }]', ctx);
        ctx.globalState.lessonTrash = [{ lesson: { id: 2, title: '같은 제목' }, subjectId: 's1', at: new Date().toISOString() }];
        assert.strictEqual(call('restoreLesson')(0), true);
        assert.deepStrictEqual(plain(vm.runInContext('courseData.map(item => item.title)', ctx)), ['같은 제목', '같은 제목 (복원)']);
        ctx.globalState.subjects = [];
        vm.runInContext('courseData = []', ctx);
    });

    await run('휴지통 상한: 지운 차시는 100개까지, 다시 만들기 전 사본은 세지 않고 30일 동안 둔다', async () => {
        const now = Date.parse('2026-11-02T00:00:00Z');
        const at = ms => new Date(now - ms).toISOString();
        const deleted = n => Array.from({ length: n }, (_, i) => ({ lesson: { id: i, title: `지운 ${i}` }, subjectId: 's1', at: at((i + 1) * 1000) }));
        const add = call('addToLessonTrash');
        const full = add(deleted(100), [{ lesson: { id: 'new' }, subjectId: 's1', at: at(0) }], now);
        assert.deepStrictEqual([full.trash.length, full.dropped, full.droppedNew, full.trash[0].lesson.id, full.trash.at(-1).lesson.id], [100, 1, 0, 'new', 98], '넘치면 목록 뒤쪽(오래된 것)부터');
        const fresh = Array.from({ length: 150 }, (_, i) => ({ lesson: { id: `n${i}` }, subjectId: 's1', at: at(0) }));
        const burst = add(deleted(30), fresh, now);
        assert.deepStrictEqual([burst.dropped, burst.droppedNew, burst.trash.length, burst.trash.every(entry => String(entry.lesson.id).startsWith('n'))], [80, 50, 100, true], '한 번에 100개 넘게 넣으면 방금 넣은 것도 빠지고 그 수를 센다');
        const copies = Array.from({ length: 150 }, (_, i) => ({ lesson: { id: 1000 + i }, subjectId: 's1', at: at(0), kind: 'rewrite' }));
        const big = add(deleted(100), copies, now);
        assert.deepStrictEqual([big.trash.length, big.dropped], [250, 0], '사본은 지운 차시를 밀어내지 않는다');
        const more = add(big.trash, [{ lesson: { id: 'x' }, subjectId: 's1', at: at(0) }], now);
        assert.deepStrictEqual([more.dropped, more.trash.filter(entry => entry.kind === 'rewrite').length], [1, 150], '지운 차시가 늘어도 사본은 남는다');
        assert.strictEqual(add([{ lesson: { id: 'old' }, at: at(31 * 86400000), kind: 'rewrite' }], [], now).trash.length, 0, '30일이 지나면 사본도 지운다');
        const ahead = add(deleted(100), [{ lesson: { id: 'f' }, subjectId: 's1', at: new Date(now + 5 * 86400000).toISOString(), kind: 'rewrite' }], now);
        assert.deepStrictEqual([ahead.dropped, ahead.trash[0].lesson.id], [1, 'f'], '날짜가 앞날인 사본은 지운 차시처럼 센다(끝없이 남지 않게)');
    });

    await run('휴지통: 넘쳐서 지우면 알리고, 다시 만들기 전 사본은 지금 차시와 이어지지 않게 넣는다', async () => {
        const toasts = [];
        const previousToast = ctx.showToast;
        ctx.showToast = (message, type) => toasts.push([message, type]);
        ctx.globalState.lessonTrash = Array.from({ length: 100 }, (_, i) => ({ lesson: { id: i, title: `지운 ${i}` }, subjectId: 's1', at: new Date(Date.now() - (i + 1) * 1000).toISOString() }));
        call('moveLessonsToTrash')([{ id: 500, title: '지운 차시' }]);
        assert.strictEqual(ctx.globalState.lessonTrash.length, 100);
        assert.deepStrictEqual(toasts, [['휴지통에는 지운 차시를 100개까지 둡니다. 넘친 1개를 완전히 지웠습니다.', 'warning']]);
        const mod = { id: 7, title: '차시', tabContents: { basicLearn: '글' }, images: { a: 'data:image/png;base64,AAAA' }, gyosuan: { docMd: '교수안', deckHtml: '<section></section>', sessionDecks: { 1: '<section></section>' }, images: {} }, illustrations: [{ id: 'i1', svg: '<svg></svg>' }], whiteboardVideos: { a: { id: 'wb_1' } } };
        call('trashLessonCopy')(mod, 's1');
        const entry = ctx.globalState.lessonTrash[0];
        assert.strictEqual(toasts.length, 1, '사본은 휴지통을 넘치게 하지 않는다');
        assert.strictEqual(ctx.globalState.lessonTrash.length, 101);
        assert.deepStrictEqual([entry.subjectId, entry.reason, entry.kind], ['s1', '다시 만들기 전', 'rewrite']);
        assert.deepStrictEqual(plain(entry.lesson), plain(mod));
        mod.images.a = 'data:image/png;base64,BBBB';
        mod.gyosuan.sessionDecks[1] = '바뀜';
        mod.illustrations.push({ id: 'i2' });
        assert.deepStrictEqual([entry.lesson.images.a, entry.lesson.gyosuan.sessionDecks[1], entry.lesson.illustrations.length], ['data:image/png;base64,AAAA', '<section></section>', 1], '사본은 지금 차시와 이어지지 않는다');
        assert.ok(call('renderTrashRows')().includes(' · 다시 만들기 전 · 남은 기간 30일'));
        ctx.globalState.lessonTrash = [{ lesson: { id: 1, title: '차시' }, subjectId: 's1', at: new Date().toISOString(), reason: '<img src=x onerror=alert(1)>' }];
        assert.ok(!call('renderTrashRows')().includes('<img'), '파일에서 온 까닭은 이스케이프한다');
        // 차시 150개를 한 번에 지우면(일괄 삭제 등) 방금 지운 차시도 빠진다. 오래된 것부터라고 하지 않고 그 수를 말한다
        ctx.globalState.lessonTrash = Array.from({ length: 30 }, (_, i) => ({ lesson: { id: i, title: `지운 ${i}` }, subjectId: 's1', at: new Date(Date.now() - 86400000).toISOString() }));
        toasts.length = 0;
        call('moveLessonsToTrash')(Array.from({ length: 150 }, (_, i) => ({ id: 1000 + i, title: `차시 ${i}` })));
        assert.strictEqual(ctx.globalState.lessonTrash.length, 100);
        assert.deepStrictEqual(toasts, [['휴지통에는 지운 차시를 100개까지 둡니다. 넘친 80개(방금 지운 차시 50개 포함)를 완전히 지웠습니다.', 'warning']]);
        assert.ok(!toasts[0][0].includes('오래된'));
        ctx.globalState.lessonTrash = [];
        ctx.showToast = previousToast;
    });

    await run('휴지통 되살리기: 다시 만들기 전 사본은 다시 만든 차시를 건드리지 않고 바로 아래에 새 id로 생긴다', async () => {
        const local = makeContext(noAi);
        vm.runInContext(fs.readFileSync(root + 'data-safety.js', 'utf8'), local); // 되살릴 때 쓰는 검사와 새 id(cleanTrashLesson, renumberLessons)
        const rebuilt = { id: 2, title: '2차시', tabContents: { basicLearn: '새 글' }, images: {} };
        local.globalState.subjects = [{ id: 's1', title: '교과', lessons: [{ id: 1, title: '1차시' }, rebuilt, { id: 3, title: '3차시' }] }];
        vm.runInContext('courseData = globalState.subjects[0].lessons', local);
        const old = { id: 2, title: '2차시', tabContents: { basicLearn: '옛 글' }, images: { a: 'data:image/png;base64,AAAA' }, gyosuan: { docMd: '교수안', deckHtml: '<section>고친 화면</section>', sessionDecks: { 1: '<section>1</section>' } }, illustrations: [{ id: 'i1', svg: '<svg></svg>' }], whiteboardVideos: { a: { id: 'wb_1' } } };
        local.globalState.lessonTrash = [{ lesson: old, subjectId: 's1', at: new Date().toISOString(), reason: '다시 만들기 전', kind: 'rewrite' }];
        assert.strictEqual(vm.runInContext('restoreLesson', local)(0), true);
        const list = vm.runInContext('courseData', local);
        assert.deepStrictEqual(plain(list).map(item => item.title), ['1차시', '2차시', '2차시 (복원)', '3차시']);
        assert.strictEqual(list[1], rebuilt, '다시 만든 차시는 그대로 둔다');
        assert.strictEqual(rebuilt.tabContents.basicLearn, '새 글');
        assert.strictEqual(new Set(list.map(item => item.id)).size, 4, '차시 id가 겹치지 않는다');
        assert.ok(Number.isSafeInteger(list[2].id) && list[2].id !== 2);
        assert.deepStrictEqual(plain([list[2].tabContents, list[2].images, list[2].gyosuan, list[2].illustrations, list[2].whiteboardVideos]), plain([old.tabContents, old.images, old.gyosuan, old.illustrations, old.whiteboardVideos]));
        assert.strictEqual(local.globalState.subjects[0].lessons, list, '저장할 교과 목록도 같은 배열');
        assert.strictEqual(local.globalState.lessonTrash.length, 0);
        const orphan = { id: 1, title: '지운 교과의 차시', tabContents: { basicLearn: '글' }, images: {} };
        local.globalState.lessonTrash = [{ lesson: orphan, subjectId: 'gone', at: new Date().toISOString(), reason: '다시 만들기 전', kind: 'rewrite' }];
        assert.strictEqual(vm.runInContext('restoreLesson', local)(0), true);
        assert.deepStrictEqual(plain(vm.runInContext('courseData', local)).map(item => item.title), ['1차시', '2차시', '2차시 (복원)', '3차시', '지운 교과의 차시'], '교과가 없어 지금 교과로 되살리면 다른 교과의 같은 id 차시 옆이 아니라 맨 아래');
    });

    await run('선행 차시: 다른 교과 연결과 상태', async () => {
        const target = { id: 1, title: '선행 차시', reviewStatus: '완료' };
        const self = { id: 2, title: '이 차시', prereqs: [] };
        ctx.globalState.subjects = [{ id: 's1', title: '교과', lessons: [] }, { id: 's2', title: '다른 교과', lessons: [target] }];
        vm.runInContext('(lesson => { courseData = [lesson]; })', ctx)(self);
        const find = call('findLessonPrereq');
        assert.strictEqual(find({ id: 1, title: '예전 이름' }, 2).lesson, target, '이름이 바뀌어도 id로 찾는다');
        assert.strictEqual(find({ id: 99, title: '선행 차시' }, 2).state, 'ok', '지운 뒤 다시 만든 차시는 제목으로 찾는다');
        assert.strictEqual(find({ id: 2, title: '이 차시' }, 2).state, 'self');
        assert.strictEqual(find({ id: 99, title: '없는 차시' }, 2).state, 'none');
        const html = call('metaPrereqRows')({ ...self, prereqs: [{ id: 1, title: '선행 차시' }, { id: 99, title: '없는 차시' }] });
        ['다른 교과', '선행 차시', '완료', '미등록', 'data-meta-prereq-broken="1"'].forEach(text => assert.ok(html.includes(text), text));
        assert.ok(/data-meta-prereq="1" checked/.test(html), '연결한 차시는 체크');
        ctx.globalState.subjects = [];
        vm.runInContext('courseData = []', ctx);
    });

    await run('변경 이력: 직접 기록과 상한', async () => {
        const mod = { history: Array.from({ length: 20 }, (_, i) => ({ at: 'x', note: `이력 ${i}` })) };
        const { history } = plain(call('withHistoryNote')(mod, '직접 기록'));
        assert.strictEqual(history.length, 20);
        assert.strictEqual(history[0].note, '직접 기록');
        assert.strictEqual(mod.history[0].note, '이력 0', '원본은 바꾸지 않는다');
    });

    /* ---------- 삽화 ---------- */
    const PALETTE = [{ role: '윤곽선', hex: '#1E2A3A' }, { role: '바탕', hex: '#F6F4EE' }];

    await run('삽화 프롬프트: 종류·비율·위치와 수정 요청', async () => {
        const art = { ...plain(call('ART_DEFAULT')), anchorSvg: '<svg>기준</svg>' };
        const prompt = call('buildSvgPrompt')(art, '게임 루프', { kind: '개념도', ratio: '640 480', context: '교안 일부' });
        ['viewBox="0 0 640 480"', '[그릴 내용 — 개념도]', '게임 루프', '교안 일부', '[기준 삽화 SVG'].forEach(text => assert.ok(prompt.includes(text), text));
        assert.ok(call('buildSvgPrompt')(art, '게임 루프').includes('viewBox="0 0 640 360"'), '기본은 16:9');
        const revise = call('buildSvgPrompt')(art, '', { ratio: '480 480', revise: { svg: '<svg>원본</svg>', instruction: '화살표를 곡선으로' } });
        ['[수정할 기존 SVG]', '<svg>원본</svg>', '화살표를 곡선으로'].forEach(text => assert.ok(revise.includes(text), text));
        assert.ok(!revise.includes('[기준 삽화 SVG') && !revise.includes('[그릴 내용'));
    });

    await run('수정 요청: 원본 비율을 유지하고 응답을 정리한다', async () => {
        const prompts = [];
        const aiCtx = makeContext(async (m, p) => { prompts.push(p.contents[0].parts[0].text); return reply('<svg></svg>'); }, { gemini: 'k' });
        vm.runInContext('sanitizeSvg = raw => `정리:${raw}`', aiCtx);
        const result = await ofCtx(aiCtx)('reviseLessonSvg')('<svg viewBox="0 0 480 480"></svg>', '바꿔주세요');
        assert.strictEqual(result, '정리:<svg></svg>');
        assert.ok(prompts[0].includes('viewBox="0 0 480 480"'));
    });

    await run('스타일 검사: 팔레트 밖 색과 선 굵기, 글자 내용은 제외', async () => {
        const art = { palette: PALETTE, stroke: 2.5 };
        const clean = plain(call('svgStyleCheck')('<svg><rect fill="#1e2a3a" stroke="#F6F4EE" stroke-width="2.5"/><path fill="none" stroke-width="3"/><text fill="#1E2A3A">fill: #ff0000</text></svg>', art));
        assert.deepStrictEqual([clean.bad, clean.strokeOk], [[], true], '소문자 표기, none, 글자 내용, 허용 오차');
        const off = plain(call('svgStyleCheck')('<svg><rect fill="#ff0000" stroke="#f00" stroke-width="6"/><rect stroke-width="0"/></svg>', art));
        assert.deepStrictEqual(off.bad, ['#ff0000', '#f00']);
        assert.strictEqual(off.strokeOk, false);
        assert.deepStrictEqual(off.strokes.slice().sort(), [0, 6]);
        const snapped = call('snapSvgPalette')('<svg><rect fill="#ff0000"/></svg>', PALETTE).svg;
        assert.deepStrictEqual(plain(call('svgStyleCheck')(snapped, art)).bad, [], '맞추면 검사를 통과한다');
    });

    await run('스타일 가이드: 색 추가·삭제 후에도 색 계산이 맞다', async () => {
        const base = { ...plain(call('ART_DEFAULT')), palette: PALETTE };
        const add = call('addPaletteColor');
        const remove = call('removePaletteColor');
        const update = call('updatePaletteColor');
        const added = add(base);
        assert.strictEqual(added.palette.length, 3);
        assert.strictEqual(base.palette.length, 2, '원본은 바꾸지 않는다');
        const edited = update(added, 2, { hex: '#FF0000', role: '강조' });
        assert.deepStrictEqual(plain(edited.palette[2]), { role: '강조', hex: '#FF0000' });
        const removed = remove(edited, 0);
        assert.deepStrictEqual(plain(removed.palette).map(option => option.hex), ['#F6F4EE', '#FF0000'], '지운 뒤 번호가 당겨진다');
        assert.strictEqual(call('nearestPaletteColor')('#ee0000', removed.palette), '#FF0000');
        const last = remove(remove(removed, 0), 0);
        assert.strictEqual(last.palette.length, 1, '마지막 색은 지우지 않는다');
        assert.strictEqual(call('artBackground')(last.palette), '#FF0000', '한 색만 남아도 계산한다');
        let full = base;
        for (let i = 0; i < 20; i++) full = add(full);
        assert.strictEqual(full.palette.length, 8, '색 수 상한');
    });

    await run('스타일 가이드: 저장값 검증과 기본값 되돌리기', async () => {
        const draft = { ...plain(call('ART_DEFAULT')), name: ' 새 가이드 ', palette: [{ role: ' ', hex: '#abc' }, { role: '주색', hex: '#112233' }], stroke: '99', corner: '', shading: '평면', text: '글자 없음', rules: ' 규칙 ', anchorId: 'x', anchorSvg: '<svg/>' };
        const saved = plain(call('normalizeArtDraft')(draft));
        assert.deepStrictEqual(saved.palette, [{ role: '색', hex: '#AABBCC' }, { role: '주색', hex: '#112233' }], '짧은 색 코드를 펼친다');
        assert.deepStrictEqual([saved.name, saved.stroke, saved.shading, saved.rules], ['새 가이드', 8, '평면', '규칙']);
        assert.strictEqual(saved.corner, call('ART_DEFAULT').corner, '빈 칸은 기본값');
        assert.ok(!('anchorSvg' in saved), '기준 삽화는 저장 대상이 아니다');
        assert.throws(() => call('normalizeArtDraft')({ ...draft, palette: [] }), /하나 이상/);
        assert.throws(() => call('normalizeArtDraft')({ ...draft, palette: [{ role: '색', hex: '#12' }] }), /#RRGGBB/);
        const reset = plain(call('resetArtDraft')(draft));
        assert.deepStrictEqual([reset.name, reset.palette.length, reset.anchorId, reset.anchorSvg], [call('ART_DEFAULT').name, 7, 'x', '<svg/>'], '기준 삽화는 유지');
        assert.strictEqual(call('ART_DEFAULT').palette[0].hex, '#1E2A3A', '기본값을 건드리지 않는다');
        ctx.globalState.courseArt = { palette: [] };
        assert.strictEqual(call('courseArt')().palette.length, 7, '저장된 팔레트가 비면 기본 팔레트');
        delete ctx.globalState.courseArt;
    });

    await run('비율별 비트맵 크기', async () => {
        const size = call('ratioRenderSize');
        assert.deepStrictEqual(plain(size('640 360')), { width: 1280, height: 720 });
        assert.deepStrictEqual(plain(size('640 480')), { width: 1280, height: 960 });
        assert.deepStrictEqual(plain(size('480 480')), { width: 1280, height: 1280 });
        assert.deepStrictEqual(plain(size('이상한 값')), { width: 1280, height: 720 });
    });

    const LESSON_MD = '머리말\n\n## 첫 섹션\n\n첫 본문\n\n```md\n## 코드 안 제목\n```\n\n## 둘째 섹션\n\n둘째 본문\n';

    await run('삽화 배치: 섹션 끝에 넣고 지워도 본문이 그대로다', async () => {
        assert.deepStrictEqual(plain(call('lessonH2s')(LESSON_MD)).map(head => head.title), ['첫 섹션', '둘째 섹션'], '코드 안의 제목은 세지 않는다');
        const html = call('illustrationHtml')('img_1', { title: '제목', caption: '캡션 "따옴표"' });
        assert.ok(html.includes('alt="캡션 &quot;따옴표&quot;"') && html.startsWith('<div class="image-wrapper"><img src="local:img_1"'));
        const first = call('insertIllustrationMd')(LESSON_MD, html, '0');
        assert.ok(first.indexOf('local:img_1') > first.indexOf('코드 안 제목') && first.indexOf('local:img_1') < first.indexOf('## 둘째 섹션'));
        const last = call('insertIllustrationMd')(LESSON_MD, html, 'end');
        assert.ok(last.indexOf('local:img_1') > last.indexOf('둘째 본문'));
        assert.ok(call('insertIllustrationMd')('', html, 'end').startsWith('<div class="image-wrapper">'), '빈 탭에도 넣는다');
        assert.ok(call('insertIllustrationMd')(LESSON_MD, html, '9').includes('local:img_1'), '섹션이 사라졌으면 문서 끝');
        const back = call('removeIllustrationMd')(first, 'img_1');
        assert.ok(!back.includes('image-wrapper'));
        assert.strictEqual(back.replace(/\s+/g, ''), LESSON_MD.replace(/\s+/g, ''), '다른 글자는 그대로');
        assert.strictEqual(call('removeIllustrationMd')(LESSON_MD, 'img_9'), LESSON_MD, '없으면 바꾸지 않는다');
        const odd = call('insertIllustrationMd')(LESSON_MD, call('illustrationHtml')('img_(1)', { title: '제목' }), 'end');
        assert.ok(!call('removeIllustrationMd')(odd, 'img_(1)').includes('image-wrapper'), '괄호가 든 그림 id도 지운다');
        assert.strictEqual(call('removeIllustrationMd')(LESSON_MD, '(a+)+$'), LESSON_MD, '정규식 글자가 든 id로 멈추지 않는다');
    });

    await run('삽화 배치: 본문 이미지는 비트맵만, 옮겨도 한 장', async () => {
        const local = makeContext(noAi);
        const get = ofCtx(local);
        vm.runInContext('svgToPng = async (svg, background, size) => { svgToPng.last = { background, size }; return "data:image/png;base64,QUJD"; }', local);
        const mod = { tabContents: { basicLearn: LESSON_MD, advLearn: '## 심화\n\n본문\n' }, images: { img_keep: 'data:image/png;base64,S0VFUA==' }, illustrations: [{ id: 'a', title: '삽화', ratio: '640 480', svg: '<svg/>', caption: '캡션', imgId: null }] };
        const placed = await get('placeIllustration')(mod, 'a', 'basicLearn', '1');
        assert.ok(placed.imgId);
        assert.ok(/^data:image\/\w+;base64,/.test(mod.images[placed.imgId]), '내보내기가 읽는 비트맵 형식');
        assert.deepStrictEqual(plain(get('svgToPng').last.size), { width: 1280, height: 960 }, '고른 비율로 그린다');
        assert.ok(Object.values(mod.images).every(url => !url.includes('svg')), 'SVG는 본문 이미지로 넣지 않는다');
        assert.strictEqual(get('illustrationPlacement')(mod, placed, 'basicLearn'), '1');
        assert.strictEqual(get('illustrationPlacement')(mod, placed, 'advLearn'), `tab:basicLearn`);
        const moved = await get('placeIllustration')(mod, 'a', 'advLearn', 'end');
        assert.strictEqual(moved.imgId, placed.imgId, '같은 이미지 ID를 쓴다');
        assert.ok(!mod.tabContents.basicLearn.includes('image-wrapper') && mod.tabContents.advLearn.includes(`local:${placed.imgId}`));
        assert.strictEqual(Object.keys(mod.images).length, 2);
        const removed = await get('placeIllustration')(mod, 'a', 'advLearn', '');
        assert.strictEqual(removed.imgId, null);
        assert.deepStrictEqual(Object.keys(mod.images), ['img_keep'], '다른 이미지는 남긴다');
        assert.ok(!mod.tabContents.advLearn.includes('image-wrapper'));
        vm.runInContext('svgToPng = async () => "data:image/svg+xml;base64,PHN2Zz4="', local);
        await assert.rejects(get('placeIllustration')(mod, 'a', 'basicLearn', '0'), /비트맵/, 'SVG 데이터 URL은 거부한다');
    });

    await run('삽화 캡션: 본문 표기를 바꾸고 특수 문자를 그대로 둔다', async () => {
        const html = call('illustrationHtml')('img_1', { title: '제목', caption: '옛 캡션' });
        const mod = { tabContents: { basicLearn: `앞\n\n${html}\n\n뒤\n` }, illustrations: [{ id: 'a', title: '제목', imgId: 'img_1', caption: '비용 $& 절감' }] };
        call('replaceIllustrationCaption')(mod, mod.illustrations[0]);
        assert.ok(mod.tabContents.basicLearn.includes('비용 $&amp; 절감') && !mod.tabContents.basicLearn.includes('옛 캡션'));
        assert.ok(mod.tabContents.basicLearn.startsWith('앞\n\n<div class="image-wrapper">') && mod.tabContents.basicLearn.endsWith('뒤\n'));
    });

    await run('삽화 아이디어: 섹션에서 만들고 AI 응답은 범위를 맞춘다', async () => {
        const ideas = plain(call('sectionIllustrationIdeas')(LESSON_MD));
        assert.deepStrictEqual(ideas.map(idea => idea.section), [0, 1]);
        assert.ok(ideas[0].description.includes('「첫 섹션」'));
        assert.deepStrictEqual(plain(call('sectionIllustrationIdeas')('제목 없는 글')), []);
        const skipped = plain(call('sectionIllustrationIdeas')('## 학습 목표\n\n- 목표\n\n## 핵심 내용\n\n본문\n\n## 학습 후 체크리스트\n\n- 항목\n'));
        assert.deepStrictEqual(skipped.map(idea => idea.section), [1], '그릴 내용이 없는 섹션은 빼되 원래 위치 번호를 유지한다');
        const parsed = plain(call('parseIllustrationIdeas')([{ section: 9, description: '장면' }, { section: 'x', description: '둘째' }, { section: 1, description: ' ' }, { section: 0, description: '셋째' }, { section: 0, description: '넷째' }], 2));
        assert.deepStrictEqual(parsed, [{ section: 1, description: '장면' }, { section: 0, description: '둘째' }], '범위를 맞추고 빈 설명은 뺀다');
        assert.deepStrictEqual(plain(call('parseIllustrationIdeas')({ ideas: [{ section: 3, description: '하나' }] }, 0)), [{ section: 0, description: '하나' }]);
    });

    await run('삽화 카드: AI 문자열을 이스케이프하고 검사 결과를 보여 준다', async () => {
        const local = makeContext(noAi);
        const get = ofCtx(local);
        vm.runInContext("_lessonArt = { moduleId: 1, tabId: 'basicLearn', form: { place: '' }, ideas: [], revising: 'a', status: '' }", local);
        const illustration = { id: 'a', title: '<img onerror=x>', kind: '개념도', prompt: '"><script>', svg: '<svg><rect fill="#ff0000" stroke-width="9"/></svg>', caption: '"닫기', imgId: null };
        const html = get('illustrationCardHtml')({ tabContents: { basicLearn: LESSON_MD }, illustrations: [illustration] }, illustration, { palette: PALETTE, stroke: 2.5, anchorId: null });
        assert.ok(!html.includes('<img onerror') && !html.includes('"><script>'), html);
        assert.ok(html.includes('value="&quot;닫기"'));
        ['팔레트 밖 1색', '선 굵기 불일치', '팔레트로 맞추기', '기준으로', 'lesson-art-revise', '첫 섹션'].forEach(text => assert.ok(html.includes(text), text));
    });

    /* ---------- 참고 자료 ---------- */
    await run('텍스트 파일: UTF-8과 CP949', async () => {
        const decode = call('decodeTextBuffer');
        assert.strictEqual(decode(new TextEncoder().encode('안녕 hello').buffer), '안녕 hello');
        assert.strictEqual(decode(new Uint8Array([0xEF, 0xBB, 0xBF, 0xEC, 0x95, 0x88]).buffer), '안', '바이트 순서 표시를 뺀다');
        assert.strictEqual(decode(new Uint8Array([0xBE, 0xC8, 0xB3, 0xE7, 0x20, 0x61]).buffer), '안녕 a', '메모장 ANSI(CP949) 파일');
    });

    console.log('ALL PASSED');
})().catch(err => {
    console.error('FAILED', err);
    process.exit(1);
});
