// course-ncs.js - 교과별 NCS 능력단위 검색·추천·확정
// 검색과 추천은 develocket-slide(assets/course-model.js, course-ai.js @3a7303f)를 이 앱의 교과 단위로 옮겼다.
// 교과에 subj.ncs = { units, recs, confirmed, updatedAt } 으로 저장한다. 확정 전 자동 배정은 화면에 표시한다.

const NCS_CATALOG_SRC = 'js/kbuilder/ncs-catalog.js';
const NCS_AUTO_MIN_SCORE = 70;
const NCS_AUTO_FLOOR_SCORE = 40;
const NCS_AUTO_MAX = 3;
const NCS_MAX_SUBD = 6;
const NCS_MAX_CANDIDATES = 45;
const NCS_MAX_RECS = 6;
const NCS_SEARCH_LIMIT = 15;

// 과정 주제에 자주 나오지만 NCS 명칭과 표현이 다른 낱말 → NCS 쪽 표현으로 확장
const NCS_SYNONYMS = {
    '저작권': '지식재산 저작 권리화 계약관리', '라이선스': '라이센스 라이선싱 지식재산 계약', '라이센스': '라이선싱 계약',
    'ugc': '소셜미디어 콘텐츠 채널 운영', '크리에이터': '소셜미디어 채널 운영 콘텐츠 기획', '이코노미': '콘텐츠 생태계 소비시장',
    '플랫폼': '플랫폼 유통플랫폼 채널', 'llm': '인공지능 모델 생성형 프롬프트', '에이전트': '인공지능 서비스 구현 에이전트',
    '이미지': '그래픽 일러스트레이션 디자인', '사운드': '음향 사운드 효과음 배경음악', '영상': '영상 편집 촬영',
    '프롬프트': '프롬프트 구현 최적화', '챗봇': '인공지능 서비스 시나리오', '윤리': '윤리 준수 안전성',
    '게임': '게임 기획 콘텐츠 개발'
};

let _ncsCatalogPromise = null;
let _ncsIndex = null;
let _ncsDraft = null;
let _ncsOpening = false;

// 카탈로그 원문에 남은 HTML 엔티티를 푼다 (화면 출력에서 다시 이스케이프한다)
const decodeNcsText = text => String(text).replace(/&amp;/g, '&');
const ncsKeywordRows = (query, limit) => ncsSearch(query, limit).map(unit => ({ ...unit, by: '키워드' }));

/* ---------- 카탈로그 ---------- */
function ncsCatalog() {
    return window.KBuilder?.NCS || { subd: {}, units: [] };
}

// 카탈로그는 180KB라 NCS를 다룰 때만 불러온다
function loadNcsCatalog() {
    if (window.KBuilder?.NCS) return Promise.resolve();
    if (!_ncsCatalogPromise) {
        _ncsCatalogPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = NCS_CATALOG_SRC;
            script.onload = () => resolve();
            script.onerror = () => {
                _ncsCatalogPromise = null;
                reject(new Error('NCS 목록을 불러오지 못했습니다. 네트워크 상태를 확인해주세요.'));
            };
            document.head.appendChild(script);
        });
    }
    return _ncsCatalogPromise;
}

function ncsUnit(code) {
    const catalog = ncsCatalog();
    const unit = catalog.units.find(u => u[0] === code);
    if (!unit) return null;
    const subd = (catalog.subd[code.slice(0, 8)] || []).map(decodeNcsText);
    return { code: unit[0], name: decodeNcsText(unit[1]), level: unit[2], subd: code.slice(0, 8), path: subd.slice(0, 4), duty: subd[4] || '' };
}

function ncsLine(unit) {
    return `${unit.code} ${unit.name}${unit.level ? ` (${unit.level}수준)` : ''}`;
}

// 문서에 넣는 NCS 표기. 사용자가 확정하기 전의 자동 배정은 미확정으로 밝힌다.
function subjectNcsText(subject, separator = ', ') {
    const units = subject?.ncs?.units || [];
    if (!units.length) return '';
    return `${units.map(ncsLine).join(separator)}${subject.ncs.confirmed ? '' : ' (미확정)'}`;
}

/* ---------- 검색 (한글 바이그램 + 영문 토큰, IDF 가중) ---------- */
function ncsTokens(text) {
    const source = String(text || '').toLowerCase();
    const tokens = {};
    (source.match(/[a-z0-9]+/g) || []).forEach(word => { if (word.length > 1) tokens[word] = 1; });
    (source.match(/[가-힣]+/g) || []).forEach(word => {
        for (let i = 0; i < word.length - 1; i++) tokens[word.slice(i, i + 2)] = 1;
    });
    return tokens;
}

const NCS_STOP = ncsTokens('하기 있다 수있 할수 하는 및 의 기반 관리 활용 이해 개념 구조 기초 등의 종류 원리 동작');

function expandNcsQuery(query) {
    const source = String(query || '');
    const lower = source.toLowerCase();
    return Object.keys(NCS_SYNONYMS).reduce((text, key) => (lower.includes(key) ? `${text} ${NCS_SYNONYMS[key]}` : text), source);
}

function buildNcsIndex() {
    const catalog = ncsCatalog();
    if (_ncsIndex && _ncsIndex.n === catalog.units.length) return _ncsIndex;
    const subdTokens = {};
    Object.keys(catalog.subd).forEach(code => {
        const row = catalog.subd[code];
        subdTokens[code] = { name: ncsTokens(`${row[2]} ${row[3]}`), duty: ncsTokens(row[4]) };
    });
    const df = {};
    const docs = catalog.units.map(unit => {
        const subd = unit[0].slice(0, 8);
        const doc = { code: unit[0], subd, name: ncsTokens(unit[1]), subdTokens: subdTokens[subd] || { name: {}, duty: {} } };
        Object.keys({ ...doc.name, ...doc.subdTokens.name }).forEach(token => { df[token] = (df[token] || 0) + 1; });
        return doc;
    });
    _ncsIndex = { n: catalog.units.length, docs, df };
    return _ncsIndex;
}

// 능력단위명 3 · 세분류명 2 · 직무정의 0.5 가중, 세분류당 perSubd개까지 상위 limit개
function ncsSearch(query, limit = 20, opts = {}) {
    const tokens = Object.keys(ncsTokens(expandNcsQuery(query))).filter(token => !NCS_STOP[token]);
    if (!tokens.length) return [];
    const index = buildNcsIndex();
    const idf = Object.fromEntries(tokens.map(token => [token, Math.log(1 + index.n / (1 + (index.df[token] || 0)))]));
    const scored = [];
    index.docs.forEach(doc => {
        if (opts.subds && !opts.subds.includes(doc.subd)) return;
        const score = tokens.reduce((sum, token) => sum +
            (doc.name[token] ? 3 * idf[token] : 0) +
            (doc.subdTokens.name[token] ? 2 * idf[token] : 0) +
            (doc.subdTokens.duty[token] ? 0.5 * idf[token] : 0), 0);
        if (score > 0) scored.push({ code: doc.code, subd: doc.subd, score });
    });
    scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
    const perSubd = {};
    const cap = opts.perSubd || 3;
    const picked = [];
    for (const row of scored) {
        if (picked.length >= limit) break;
        perSubd[row.subd] = (perSubd[row.subd] || 0) + 1;
        if (perSubd[row.subd] <= cap) picked.push(row);
    }
    const top = picked.length ? picked[0].score : 1;
    return picked.map(row => ({ ...ncsUnit(row.code), match: Math.round(40 + 55 * (row.score / top)) }));
}

/* ---------- 추천 ---------- */
// 교과 이름만으로는 분야를 알 수 없을 때가 많아 과정 주제를 함께 쓴다
function ncsCourseTitle() {
    return globalState.courseDesign?.title || globalState.courseTitle || '';
}

function subjectNcsBrief(subject) {
    const lessons = (subject.lessons || []).map(l => `${l.title}${l.description ? `: ${l.description}` : ''}`).join('\n');
    return `[과정] ${ncsCourseTitle()}\n[교과] ${subject.title}\n[교과 설명] ${subject.description || '-'}\n[차시]\n${lessons || '-'}`;
}

function textModelHasKey() {
    return isClaudeModel(TEXT_MODEL) ? !!claudeApiKey : !!apiKey;
}

async function askNcsJson(prompt) {
    const data = await callGemini(TEXT_MODEL, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: 'NCS 기반 교육과정 설계 전문가로서 지정된 JSON만 출력합니다.' }] },
        generationConfig: { responseMimeType: 'application/json' }
    });
    return safeJSONParse(extractText(data));
}

async function pickNcsSubds(subject) {
    const catalog = ncsCatalog();
    const list = Object.keys(catalog.subd).map(code => `${code} | ${catalog.subd[code].slice(0, 4).join(' > ')}`).join('\n');
    const prompt = [
        `아래 교과에 대응할 NCS 세분류를 현행 분류 목록에서 최대 ${NCS_MAX_SUBD}개 고르세요.`,
        subjectNcsBrief(subject), '',
        '[현행 세분류 목록: 코드 | 대분류 > 중분류 > 소분류 > 세분류]', list, '',
        '목록에 있는 코드만 사용합니다. JSON만 출력합니다: {"subds": ["20010707"]}'
    ].join('\n');
    try {
        const parsed = await askNcsJson(prompt);
        return (parsed?.subds || []).map(String).filter(code => catalog.subd[code]).slice(0, NCS_MAX_SUBD);
    } catch (err) {
        console.warn('[NCS] 세분류 선택 실패, 키워드 후보만 사용:', err);
        return [];
    }
}

function collectNcsCandidates(query, local, subds) {
    const seen = new Set(local.map(u => u.code));
    const candidates = [...local];
    const add = unit => { if (!seen.has(unit.code)) { seen.add(unit.code); candidates.push(unit); } };
    if (subds.length) {
        ncsSearch(query, 30, { subds, perSubd: 8 }).forEach(add);
        ncsCatalog().units.forEach(unit => {
            if (candidates.length < NCS_MAX_CANDIDATES && subds.includes(unit[0].slice(0, 8))) add(ncsUnit(unit[0]));
        });
    }
    return candidates;
}

function buildNcsRankPrompt(subject, candidates) {
    return [
        '아래 교과에 대응할 NCS 능력단위를 후보 목록에서 고르세요. 하나의 교과가 여러 능력단위를 묶을 수 있습니다. 분류번호는 후보에 적힌 코드를 그대로 씁니다.',
        subjectNcsBrief(subject), '',
        '[후보: 코드 | 능력단위 | 세분류 | 수준]',
        candidates.map(u => `${u.code} | ${u.name} | ${u.path[3]} | ${u.level}수준`).join('\n'), '',
        '최대 5개를 적합도 높은 순으로 고르고, 근거를 1문장으로 씁니다.',
        'JSON만 출력합니다: [{"code": "...", "score": 0, "reason": "..."}] (score는 0~100 정수)'
    ].join('\n');
}

function keywordRecs(local) {
    return local.slice(0, NCS_MAX_RECS).map(unit => ({ ...unit, score: unit.match, reason: '키워드 일치 (AI 키를 저장하면 근거와 함께 추천합니다)', by: '키워드' }));
}

async function recommendSubjectNcs(subject, onProgress = () => {}) {
    await loadNcsCatalog();
    const query = `${ncsCourseTitle()} ${subject.title} ${subject.description || ''} ${(subject.lessons || []).map(l => l.title).join(' ')}`;
    const local = ncsSearch(query, NCS_SEARCH_LIMIT);
    if (!textModelHasKey()) return keywordRecs(local);

    onProgress('세분류 후보를 고르고 있습니다...');
    const subds = await pickNcsSubds(subject);
    const candidates = collectNcsCandidates(query, local, subds);
    const byCode = new Map(candidates.map(unit => [unit.code, unit]));
    onProgress('능력단위 적합도를 판단하고 있습니다...');
    const ranked = await askNcsJson(buildNcsRankPrompt(subject, candidates));
    const rows = Array.isArray(ranked) ? ranked : (ranked?.items || ranked?.results || []);
    const recs = rows.filter(row => row && byCode.has(row.code)).slice(0, NCS_MAX_RECS).map(row => ({
        ...byCode.get(row.code),
        score: Math.max(0, Math.min(100, Math.round(Number(row.score) || 0))),
        reason: String(row.reason || '').trim(),
        by: 'AI'
    })).sort((a, b) => b.score - a.score);
    return recs.length ? recs : keywordRecs(local);
}

// 적합도 기준을 넘는 항목을 최대 3개, 없으면 최소 기준을 넘는 1위만 고른다
function pickAutoNcs(recs) {
    const strong = recs.filter(rec => rec.score >= NCS_AUTO_MIN_SCORE).slice(0, NCS_AUTO_MAX);
    return strong.length ? strong : recs.slice(0, 1).filter(rec => rec.score >= NCS_AUTO_FLOOR_SCORE);
}

// 사용자가 확정한 교과는 건드리지 않는다. 키워드 일치는 적합도가 아니므로 배정하지 않고 후보로만 둔다.
async function autoAssignNcs(subject, onProgress) {
    if (subject.ncs?.confirmed) return subject.ncs;
    const recs = await recommendSubjectNcs(subject, onProgress);
    subject.ncs = { units: pickAutoNcs(recs.filter(rec => rec.by === 'AI')), recs, confirmed: false, updatedAt: new Date().toISOString() };
    return subject.ncs;
}

/* ---------- 화면 ---------- */
function renderSubjectNcsCard(subject) {
    const ncs = subject.ncs;
    const units = ncs?.units || [];
    const status = !units.length ? '미배정' : ncs.confirmed ? '확정' : '자동 배정 · 확정 전';
    const rows = units.map(unit => `
        <div class="text-[0.65rem] text-textLight leading-relaxed" title="${escapeHtml((unit.path || []).join(' > '))}">
            <span class="font-mono text-accent">${escapeHtml(unit.code)}</span> ${escapeHtml(unit.name)}
        </div>`).join('');
    return `
        <div class="mb-3 rounded-xl border border-white/10 bg-bgSidebar p-2.5">
            <div class="flex items-center gap-2 mb-1">
                <i class="ph-fill ph-certificate text-accent"></i>
                <h3 class="text-[0.7rem] font-bold text-textLight tracking-wider">교과 NCS</h3>
                <span class="text-[0.55rem] px-1.5 py-0.5 rounded bg-white/10 text-textMuted">${status}</span>
                <button onclick="openNcsDialog()" class="ml-auto text-[0.6rem] font-bold px-2 py-1 rounded bg-white/10 text-textLight hover:bg-accent transition-colors">관리</button>
            </div>
            ${rows || '<p class="text-[0.6rem] text-textMuted">능력단위를 배정하면 교수안 개요에 표시됩니다.</p>'}
        </div>`;
}

function ncsRowHtml(unit, checked) {
    // 점수는 AI가 매긴 적합도일 때만 보여 준다. 키워드 일치도는 상대값이라 적합도로 읽히면 안 된다.
    const meta = [unit.path?.[3], unit.level ? `${unit.level}수준` : '', unit.by === 'AI' ? `${unit.score}점` : ''].filter(Boolean).join(' · ');
    return `
        <label class="flex items-start gap-2 p-2 rounded-lg hover:bg-white/5 cursor-pointer">
            <input type="checkbox" class="mt-0.5" data-ncs-code="${escapeHtml(unit.code)}" ${checked ? 'checked' : ''}>
            <span class="text-xs text-textLight">
                <span class="font-mono text-accent">${escapeHtml(unit.code)}</span> ${escapeHtml(unit.name)}
                <span class="block text-[0.65rem] text-textMuted">${escapeHtml(meta)}</span>
                ${unit.reason ? `<span class="block text-[0.65rem] text-textMuted/80">${escapeHtml(unit.reason)}</span>` : ''}
            </span>
        </label>`;
}

function renderNcsDialogList() {
    const list = document.getElementById('ncs-dialog-list');
    if (!list || !_ncsDraft) return;
    const shown = new Map([..._ncsDraft.selected.values(), ..._ncsDraft.rows].map(unit => [unit.code, unit]));
    list.innerHTML = [...shown.values()].map(unit => ncsRowHtml(unit, _ncsDraft.selected.has(unit.code))).join('')
        || '<p class="text-xs text-textMuted p-3">AI 추천을 누르거나 능력단위를 검색해주세요.</p>';
}

function setNcsDialogStatus(text) {
    const el = document.getElementById('ncs-dialog-status');
    if (el) el.textContent = text;
}

window.openNcsDialog = async function () {
    const subject = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subject || _ncsOpening || document.getElementById('ncs-dialog')) return;
    _ncsOpening = true;
    try {
        await loadNcsCatalog();
    } catch (err) {
        return window.showAlert(err.message);
    } finally {
        _ncsOpening = false;
    }
    const recs = subject.ncs?.recs || [];
    _ncsDraft = {
        subject,
        recs,
        selected: new Map((subject.ncs?.units || []).map(unit => [unit.code, unit])),
        rows: recs.length ? recs : ncsKeywordRows(`${subject.title} ${subject.description || ''}`, NCS_MAX_RECS)
    };
    const overlay = document.createElement('div');
    overlay.id = 'ncs-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9000]';
    overlay.innerHTML = `
        <div class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[560px] max-h-[80vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-white/10">
                <h2 class="text-sm font-bold text-textLight">교과 NCS 능력단위 · ${escapeHtml(subject.title)}</h2>
                <p class="text-[0.65rem] text-textMuted mt-1">NCS ${ncsCatalog().degree}차 체계 ${ncsCatalog().units.length.toLocaleString()}개 능력단위 기준입니다. 사용 전 ncs.go.kr에서 현행 여부를 확인하세요.</p>
                <div class="flex gap-2 mt-3">
                    <input id="ncs-dialog-search" class="flex-1 px-3 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-accent" placeholder="능력단위 검색 (예: 게임 기획)">
                    <button data-ncs-action="recommend" class="px-3 py-1.5 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">AI 추천</button>
                </div>
                <p id="ncs-dialog-status" class="text-[0.65rem] text-accent mt-2 min-h-[1em]"></p>
            </div>
            <div id="ncs-dialog-list" class="flex-1 overflow-y-auto p-2"></div>
            <div class="p-3 border-t border-white/10 flex justify-end gap-2">
                <button data-ncs-action="close" class="px-4 py-2 text-xs font-bold text-textLight bg-white/10 rounded-lg hover:bg-white/20">닫기</button>
                <button data-ncs-action="confirm" class="px-4 py-2 text-xs font-bold text-white bg-accent rounded-lg hover:bg-accentHover">선택 항목 확정</button>
            </div>
        </div>`;
    overlay.addEventListener('click', onNcsDialogClick);
    overlay.addEventListener('change', onNcsDialogChange);
    overlay.querySelector('#ncs-dialog-search').addEventListener('input', onNcsDialogSearch);
    document.body.appendChild(overlay);
    renderNcsDialogList();
};

function onNcsDialogSearch(event) {
    const query = event.target.value.trim();
    _ncsDraft = { ..._ncsDraft, rows: query ? ncsKeywordRows(query, 20) : _ncsDraft.recs };
    renderNcsDialogList();
}

function onNcsDialogChange(event) {
    const code = event.target.dataset?.ncsCode;
    if (!code) return;
    if (event.target.checked) {
        _ncsDraft.selected.set(code, _ncsDraft.rows.find(unit => unit.code === code) || ncsUnit(code));
    } else {
        _ncsDraft.selected.delete(code);
    }
}

async function onNcsDialogClick(event) {
    const action = event.target.dataset?.ncsAction;
    if (action === 'close') document.getElementById('ncs-dialog')?.remove();
    if (action === 'confirm') await confirmNcsDraft();
    if (action !== 'recommend') return;
    const { subject } = _ncsDraft;
    event.target.disabled = true;
    try {
        const recs = await recommendSubjectNcs(subject, setNcsDialogStatus);
        if (_ncsDraft?.subject !== subject) return;
        _ncsDraft = { ..._ncsDraft, recs, rows: recs };
        setNcsDialogStatus('');
        renderNcsDialogList();
    } catch (err) {
        console.error('[NCS] 추천 실패:', err);
        setNcsDialogStatus(`추천 실패: ${err.message}`);
    } finally {
        event.target.disabled = false;
    }
}

async function confirmNcsDraft() {
    const { subject, selected, recs } = _ncsDraft;
    subject.ncs = { units: [...selected.values()], recs, confirmed: selected.size > 0, updatedAt: new Date().toISOString() };
    await saveState();
    document.getElementById('ncs-dialog')?.remove();
    renderSidebar();
}
