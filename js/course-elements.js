// course-elements.js - 차시 NCS 능력단위요소 추천과 자동 배정
// develocket-slide(assets/course-ai-tb.js, course-auto.js @3a7303f)의 recommendElements·normRec·assignModule을 옮겼다.
// 요소를 등록하지 않은 능력단위는 능력단위 수준으로 추천하고, 참조 목록에 없는 후보는 목록 밖으로 표시한다.

const ELEMENT_MAX_REFS = 60;
const ELEMENT_MAX_RECS = 12;
const ELEMENT_MAX_KEYWORD_RECS = 6;
const ELEMENT_SEARCH_PER_SUBD = 6;
const ELEMENT_PICK_LIMIT = 12;
const ELEMENT_KEYWORD_FIT = 50;
const ELEMENT_REF_CHARS = 60000;
const ELEMENT_LESSON_CHARS = 3000;
const ELEMENT_REC_STATES = {
    ref: { label: '참조 목록', style: 'bg-emerald-500/20 text-emerald-300' },
    unverified: { label: '미검증', style: 'bg-amber-500/20 text-amber-300' },
    out: { label: '목록 밖', style: 'bg-rose-500/20 text-rose-300' }
};

// 교과에 배정한 단위를 앞에 두고, 등록해 둔 단위와 키워드로 찾은 단위를 뒤에 붙인다
function elementCandidateUnits(subject, mod, objectives) {
    const query = [mod.title, mod.category, ...objectives].filter(Boolean).join(' ');
    const units = [
        ...(subject?.ncs?.units || []).map(unit => ncsRefInfo(unit.code, unit)),
        ...enrichedNcsUnits(),
        ...ncsSearch(query, NCS_REF_LIMIT, { perSubd: ELEMENT_SEARCH_PER_SUBD }).map(unit => ncsRefInfo(unit.code, unit)),
        ...ncsSearch(`${subject?.title || ''} ${mod.title}`, ELEMENT_MAX_RECS).map(unit => ncsRefInfo(unit.code, unit))
    ];
    return units.filter((unit, index) => units.findIndex(other => other.code === unit.code) === index).slice(0, ELEMENT_MAX_REFS);
}

function elementRefLines(units) {
    return units.map(unit => {
        const elements = unit.elements.length
            ? unit.elements.map(element => `  - ${element.code || '(코드없음)'}|${element.name}`).join('\n')
            : '  - (능력단위요소 미등록)';
        return `${unit.code}|${unit.name}|${unit.level || ''}수준|${unit.path?.[3] || ''}${unit.verified ? '' : '|미검증'}\n${elements}`;
    }).join('\n');
}

function buildElementPrompt(subject, mod, units, objectives) {
    const lesson = String(mod.tabContents?.basicLearn || mod.content || '').replace(/\s+/g, ' ').slice(0, ELEMENT_LESSON_CHARS);
    return [
        '국가직무능력표준(NCS) 매핑 담당자로서 아래 차시에 대응하는 NCS 능력단위요소를 추천합니다.', '',
        '[매핑 규칙]',
        '- 능력단위요소는 차시에 대응합니다(추천의 주 대상). 능력단위는 교과에 대응합니다.',
        '- 반드시 [참조 목록]에서 먼저 고릅니다. 참조 목록의 능력단위에 요소가 등록되지 않았다면 elementCode와 elementName은 빈 문자열로 두고 unitCode만 채웁니다.',
        '- 참조 목록에 적합한 것이 없을 때만 목록 밖 후보를 제시하되, 코드를 지어내지 말고 unitCode를 빈 문자열로 둡니다.',
        '- 차시의 학습 목표 중 어느 것을 덮는지 covers에 학습 목표 번호로 적습니다.',
        '- fit은 0~100 적합도입니다. 부풀리지 않고 정직하게 매깁니다. 확실한 후보 외에 관련성이 낮은 후보(50 미만)도 함께 넣어 모두 8~12개를 추천하고, 적합도 내림차순으로 정렬합니다.', '',
        '[참조 목록] (코드|이름|수준|세분류)', elementRefLines(units).slice(0, ELEMENT_REF_CHARS), '',
        `[차시] ${mod.title}${mod.category ? ` (${mod.category})` : ''} — 교과: ${subject?.title || '-'}`,
        `[설명] ${mod.description || '-'}`,
        `[학습 목표]\n${objectives.map((text, index) => `${index + 1}. ${text}`).join('\n') || '-'}`,
        `[교안 요지] ${lesson || '-'}`, '',
        '[출력] JSON 하나만:',
        '{"recs":[{"unitCode":"","unitName":"","level":3,"elementCode":"","elementName":"","fit":85,"covers":[1,2],"reason":"한두 문장 근거"}],"note":"전체 매핑에 대한 한 문장 메모(없으면 빈 문자열)"}'
    ].join('\n');
}

// 등록 형식의 요소 코드는 단위 코드와 달라도 되므로 등록 목록에서 먼저 찾는다
function elementOwnerUnit(elementCode) {
    if (!elementCode) return '';
    const owner = Object.keys(globalState.ncsElements || {}).find(code => registeredElements(code).some(element => element.code === elementCode));
    return owner || elementCode.split('.')[0];
}

function normalizeElementRec(row, objectiveCount) {
    const elementCode = String(row?.elementCode || '').trim();
    const unitCode = String(row?.unitCode || '').trim() || elementOwnerUnit(elementCode);
    const info = unitCode ? ncsUnit(unitCode) : null;
    const covers = (Array.isArray(row?.covers) ? row.covers : []).map(Number).filter(no => Number.isInteger(no) && no >= 1 && no <= objectiveCount);
    return {
        unitCode, unitName: String(row?.unitName || info?.name || '').trim(), level: Number(row?.level) || info?.level || null,
        elementCode, elementName: String(row?.elementName || '').trim(),
        fit: Math.max(0, Math.min(100, Math.round(Number(row?.fit) || 0))),
        covers: [...new Set(covers)].sort((a, b) => a - b), reason: String(row?.reason || '').trim(), by: 'AI'
    };
}

const lessonKeywordText = (mod, objectives) => [mod.title, mod.category, mod.description, ...objectives].filter(Boolean).join(' ');

// 차시 제목과 학습 목표로 찾은 순서를 쓴다. 교과에 배정한 단위는 차시가 속한 범위이므로 찾은 것 중에서 앞에 두고, 못 찾았어도 다른 단위보다 앞에 둔다
function keywordCandidateUnits(subject, mod, objectives) {
    const hits = ncsSearch(lessonKeywordText(mod, objectives), NCS_REF_LIMIT, { perSubd: ELEMENT_SEARCH_PER_SUBD });
    const own = subject?.ncs?.units || [];
    const ownCodes = new Set(own.map(unit => unit.code));
    const units = [
        ...hits.filter(unit => ownCodes.has(unit.code)),
        ...own.filter(unit => !hits.some(hit => hit.code === unit.code)),
        ...hits.filter(unit => !ownCodes.has(unit.code))
    ];
    return units.map(unit => ncsRefInfo(unit.code, unit)).filter(Boolean);
}

// 단위에 요소를 등록해 두었으면 차시 글과 낱말이 가장 많이 겹치는 요소를 고른다
function keywordElementRecs(units, text = '') {
    const lessonTokens = ncsTokens(text);
    const overlap = name => Object.keys(ncsTokens(name)).filter(token => lessonTokens[token]).length;
    return units.slice(0, ELEMENT_MAX_KEYWORD_RECS).map(unit => {
        const element = (unit.elements || []).length ? [...unit.elements].sort((a, b) => overlap(b.name) - overlap(a.name))[0] : null;
        return {
            unitCode: unit.code, unitName: unit.name, level: unit.level, elementCode: element?.code || '', elementName: element?.name || '',
            fit: unit.match || ELEMENT_KEYWORD_FIT, covers: [], reason: '키워드 일치 (교안을 만들면 AI가 분석해 다시 배정합니다)', by: '키워드'
        };
    });
}

async function recommendLessonElements(subject, mod) {
    await loadNcsCatalog();
    const objectives = qbankObjectives(mod);
    const units = elementCandidateUnits(subject, mod, objectives);
    if (!textModelHasKey()) return { recs: keywordElementRecs(keywordCandidateUnits(subject, mod, objectives), lessonKeywordText(mod, objectives)), note: 'AI 없이 키워드로 찾은 후보입니다.' };
    const parsed = await askNcsJson(buildElementPrompt(subject, mod, units, objectives));
    const rows = Array.isArray(parsed) ? parsed : (parsed?.recs || []);
    const recs = rows.slice(0, ELEMENT_MAX_RECS).map(row => normalizeElementRec(row, objectives.length)).filter(rec => rec.unitName || rec.elementName);
    if (!recs.length) throw new Error('NCS 추천 응답을 읽지 못했습니다. 다시 시도해주세요.');
    return { recs: [...recs].sort((a, b) => b.fit - a.fit), note: String(parsed?.note || '').trim() };
}

// 요소가 등록 목록에 없으면 능력단위가 있어도 목록 밖이다. 모델이 지어낸 요소를 참조 목록으로 보이지 않게 한다.
function elementRecState(rec) {
    const unit = rec.unitCode ? ncsUnit(rec.unitCode) : null;
    if (!unit) return 'out';
    const isElement = rec.elementCode || rec.elementName;
    const listed = !isElement || registeredElements(rec.unitCode).some(item => (rec.elementCode && item.code === rec.elementCode) || (!rec.elementCode && item.name === rec.elementName));
    if (!listed) return 'out';
    return ncsVerified(unit) ? 'ref' : 'unverified';
}

function recToElement(rec) {
    const isElement = rec.elementCode || rec.elementName;
    const name = rec.elementName || rec.unitName;
    return { code: rec.elementCode || (isElement ? '' : rec.unitCode), name, unitCode: rec.unitCode, unitName: rec.unitName, ...(isElement ? {} : { unitLevel: true }) };
}

// 적합도 기준을 넘는 AI 후보를 고르고, 없으면 차시가 비지 않도록 가장 가까운 후보 하나를 고른다.
// 목록 밖 후보(참조 목록에 없는 코드)는 고르지 않는다. 키워드 후보는 AI 후보가 없을 때만 쓴다
function pickLessonElements(recs) {
    const listed = recs.filter(rec => elementRecState(rec) !== 'out');
    const ai = listed.filter(rec => rec.by === 'AI');
    const picks = topNcsPicks(ai, rec => rec.fit);
    return picks.length ? picks : [...(ai.length ? ai : listed)].sort((a, b) => b.fit - a.fit).slice(0, 1);
}

const hasConfirmedElements = mod => (mod.ncsElements || []).length > 0 && !mod.ncsAuto;
const lessonHasBody = mod => Object.values(mod.tabContents || {}).some(Boolean) || !!mod.content;

// 키워드로 채워 둔 차시는 교안이 생기면 AI로 다시 배정한다
function needsElementAutoAssign(mod) {
    const empty = !(mod.ncsElements || []).length && !(mod.ncsRecs || []).length;
    return textModelHasKey() && !mod.ncsAutoTried && (empty || !!mod.ncsKeyword) && lessonHasBody(mod) && qbankObjectives(mod).length > 0;
}

/* ---------- 빈 차시 채우기 ---------- */
// 사용자가 일부러 모두 해제한 차시는 다시 채우지 않는다
const needsKeywordNcs = mod => mod.id !== 'mainQuest' && !mod.ncsNone && !(mod.ncsElements || []).length;

// 교안이 없거나 AI를 쓸 수 없어도 비워 두지 않는다. 가장 가까운 후보를 확정 전으로 넣는다
function keywordAssignLesson(subject, mod) {
    const objectives = qbankObjectives(mod);
    const recs = keywordElementRecs(keywordCandidateUnits(subject, mod, objectives), lessonKeywordText(mod, objectives));
    const [pick] = pickLessonElements(recs);
    if (!pick) return false;
    Object.assign(mod, { ncsRecs: recs, ncsElements: [{ ...recToElement(pick), auto: true }], ncsAuto: true, ncsKeyword: true });
    return true;
}

let _lessonNcsFilling = null;

// 목록을 그릴 때마다 불러도 된다. 채울 차시가 없으면 아무것도 하지 않고, 채웠을 때만 다시 그린다
window.fillMissingLessonNcs = function (subject) {
    const lessons = (subject?.lessons || []).filter(needsKeywordNcs);
    if (!lessons.length || _lessonNcsFilling) return _lessonNcsFilling;
    _lessonNcsFilling = (async () => {
        try {
            await loadNcsCatalog();
            const filled = lessons.filter(lesson => needsKeywordNcs(lesson) && keywordAssignLesson(subject, lesson)).length;
            if (!filled) return;
            await saveState();
            if (subject.id === currentSubjectId) renderSidebar();
        } catch (err) {
            console.warn('[NCS] 빈 차시를 채우지 못했습니다:', err.message);
        } finally {
            _lessonNcsFilling = null;
        }
    })();
    return _lessonNcsFilling;
};

// 확정한 선택은 건드리지 않는다. 기다리는 사이 사용자가 고쳤으면 후보만 남기고 선택은 그대로 둔다.
async function assignLessonElements(subject, mod) {
    if (hasConfirmedElements(mod)) return false;
    const before = JSON.stringify(mod.ncsElements || []);
    mod.ncsAutoTried = true;
    const { recs, note } = await recommendLessonElements(subject, mod).catch(err => {
        mod.ncsAutoTried = false; // 호출 실패는 시도로 치지 않아 다시 만들 때 재시도한다
        throw err;
    });
    const kept = JSON.stringify(mod.ncsElements || []) !== before;
    const picks = kept ? [] : pickLessonElements(recs);
    const elements = picks.map(rec => ({ ...recToElement(rec), auto: true }));
    // 고를 후보가 없으면(모두 목록 밖) 키워드로 채운 값을 지운 채 두지 않는다
    Object.assign(mod, { ncsRecs: recs, ncsNote: note }, kept || !elements.length ? {} : { ncsElements: elements, ncsAuto: true, ncsKeyword: false });
    if (elements.length) Object.assign(mod, withHistoryNote(mod, `NCS 자동 배정 ${elements.length}개 (확정 전)`));
    return elements.length > 0;
}

/* ---------- 직접 검색 ---------- */
// 등록한 요소 이름까지 찾고, 코드를 그대로 넣으면 그 단위를 맨 앞에 둔다
function searchElementUnits(query) {
    const text = String(query || '').trim();
    if (!text) return [];
    const low = text.toLowerCase();
    const enriched = enrichedNcsUnits().filter(unit => `${unit.code} ${unit.name} ${unit.elements.map(elementLabel).join(' ')}`.toLowerCase().includes(low));
    const hits = ncsSearch(text, ELEMENT_PICK_LIMIT, { perSubd: ELEMENT_SEARCH_PER_SUBD }).map(unit => ncsRefInfo(unit.code, unit));
    const units = [ncsRefInfo(text), ...enriched, ...hits].filter(Boolean);
    return units.filter((unit, index) => units.findIndex(other => other.code === unit.code) === index).slice(0, ELEMENT_PICK_LIMIT);
}

// 요소를 등록하지 않은 단위는 능력단위 수준으로 고른다
function unitPickOptions(unit) {
    const owner = { unitCode: unit.code, unitName: unit.name };
    return unit.elements.length ? unit.elements.map(element => ({ ...element, ...owner })) : [{ code: unit.code, name: unit.name, ...owner, unitLevel: true }];
}

const searchElementOptions = query => searchElementUnits(query).flatMap(unitPickOptions);

/* ---------- 대화상자 목록 ---------- */
function elementEntry(element, rec = null) {
    return { key: elementKey(element), element, rec };
}

// 추천 후보, 교과 단위에 등록된 요소, 이미 고른 값을 한 목록으로 합친다
function lessonElementEntries(mod, options) {
    const entries = [
        ...(mod.ncsRecs || []).map(rec => elementEntry(recToElement(rec), rec)),
        ...options.map(option => elementEntry(option)),
        ...(mod.ncsElements || []).map(element => elementEntry(element))
    ];
    return entries.filter((entry, index) => entries.findIndex(other => other.key === entry.key) === index);
}

function elementBadgeHtml(rec) {
    if (!rec) return '';
    const state = ELEMENT_REC_STATES[elementRecState(rec)];
    return `<span class="text-[0.55rem] font-bold px-1 rounded ${state.style}">${state.label}</span>`;
}

function elementRowMeta(entry) {
    const { element, rec } = entry;
    return [
        element.unitName,
        rec?.by === 'AI' ? `적합도 ${rec.fit}` : '',
        rec?.covers.length ? `학습 목표 ${rec.covers.join(' · ')}` : '',
        element.unitLevel ? '능력단위 수준' : ''
    ].filter(Boolean).join(' · ');
}

function elementRowHtml(entry, checked) {
    const { key, element, rec } = entry;
    // 코드도 이름도 확정되지 않은 목록 밖 후보는 참고로만 보여 준다
    const blocked = !element.unitCode && !element.code;
    return `
        <label class="flex items-start gap-2 text-xs text-textLight">
            <input type="checkbox" class="mt-0.5" data-meta-element="${escapeHtml(key)}" ${checked ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
            <span>${escapeHtml(elementLabel(element))} ${elementBadgeHtml(rec)}
                <span class="block text-[0.6rem] text-textMuted">${escapeHtml(elementRowMeta(entry))}</span>
                ${rec?.reason ? `<span class="block text-[0.6rem] text-textMuted/80">${escapeHtml(rec.reason)}</span>` : ''}
            </span>
        </label>`;
}
