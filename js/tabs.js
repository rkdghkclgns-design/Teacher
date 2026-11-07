// tabs.js — 6탭 에디터 시스템

let currentLessonTab = 'basicLearn';
let _lessonPanel = null; // 탭 대신 보고 있는 항목: gyosuan | slides | qbank
let _lessonTrack = 'basic'; // 교수안·슬라이드·문제은행에서 고른 갈래(data.js LESSON_TRACKS). 페이지를 연 동안 마지막 선택을 기억한다
let _suppressTabAlert = false;
let _tabGenStop = false; // 중단을 누르면 받고 있는 단락까지만 저장하고 다음 단락과 다음 탭을 건너뛴다
let _tabGenAbort = null; // 중지를 누르면 그림 호출과 다시 보내려고 기다리던 호출도 끊는다. 생성을 시작할 때마다 새로 만든다(resetTabGenStop)
const TAB_STOP_LABELS = { idle: '이 단락까지만 받고 중단', pending: '받고 있는 단락까지만 저장합니다...' };
let _tabStopLabels = TAB_STOP_LABELS;

const TAB_COLORS = {
    blue:    { active: 'bg-blue-500 border-blue-500 text-white shadow-md', inactive: 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200' },
    emerald: { active: 'bg-emerald-500 border-emerald-500 text-white shadow-md', inactive: 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200' },
    amber:   { active: 'bg-amber-500 border-amber-500 text-white shadow-md', inactive: 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200' },
    red:     { active: 'bg-red-500 border-red-500 text-white shadow-md', inactive: 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200' },
    violet:  { active: 'bg-violet-500 border-violet-500 text-white shadow-md', inactive: 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200' },
    fuchsia: { active: 'bg-fuchsia-500 border-fuchsia-500 text-white shadow-md', inactive: 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200' }
};

// 갈래(기본학습·심화학습)마다 그 항목이 있는가: 교수안 문서, 슬라이드(편성안·화면 편집본), 문제은행(목표가 붙은 문항)
const PANEL_TRACK_DONE = {
    gyosuan: (mod, track) => !!gyosuanOf(mod, track.id)?.docMd,
    slides: (mod, track) => !!(gyosuanOf(mod, track.id)?.deckMd || gyosuanOf(mod, track.id)?.deckHtml),
    qbank: (mod, track) => qbankQuestions(mod, track.id).some(question => question.objective)
};

// 탐색줄 점: 학습 내용이 있는 갈래가 모두 그 항목을 가졌으면 켠다. 내용이 있는 갈래가 없으면(완성 MD로 만든 교수안만 있는 차시 등) 항목이 하나라도 있으면 켠다
function lessonPanelDone(mod, panelId) {
    const has = track => PANEL_TRACK_DONE[panelId](mod, track);
    const filled = LESSON_TRACKS.filter(track => trackHasContent(mod, track.id));
    return filled.length ? filled.every(has) : LESSON_TRACKS.some(has);
}

// 교안 탭 뒤에 이어지는 항목. 교수안과 슬라이드는 갈래마다 한 번에 만들어진다(전체 생성의 단계: lesson-pipeline.js)
const LESSON_PANELS = [
    { id: 'gyosuan', steps: ['gyosuan', 'gyosuanAdv'], label: '교수안', icon: 'ph-chalkboard-teacher', color: 'violet', done: mod => lessonPanelDone(mod, 'gyosuan') },
    { id: 'slides', steps: ['gyosuan', 'gyosuanAdv'], label: '슬라이드', icon: 'ph-presentation-chart', color: 'blue', done: mod => lessonPanelDone(mod, 'slides') },
    { id: 'qbank', steps: ['qbank'], label: '문제은행', icon: 'ph-list-checks', color: 'emerald', done: mod => lessonPanelDone(mod, 'qbank') }
];

function lessonNavDot(done, running) {
    if (running) return '<i class="ph-bold ph-circle-notch animate-spin text-sm"></i>';
    return `<span class="w-2 h-2 rounded-full ${done ? 'bg-current opacity-70' : 'bg-gray-300 opacity-40'}"></span>`;
}

function lessonPanelButton(mod, panel) {
    const colors = TAB_COLORS[panel.color];
    const running = panel.steps.some(step => !!window.isPipelineStep?.(step, mod.id));
    return `<button onclick="showLessonPanel('${panel.id}')"
            class="px-3 py-2 text-[0.75rem] font-bold rounded-t-lg border-b-2 transition-all cursor-pointer select-none flex items-center gap-1.5 whitespace-nowrap ${_lessonPanel === panel.id ? colors.active : colors.inactive}">
            <i class="ph-bold ${panel.icon} text-sm"></i>
            ${panel.label}
            ${lessonNavDot(panel.done(mod), running)}
        </button>`;
}

/* ---------- 기본학습 | 심화학습 고르기 (교수안·슬라이드·문제은행 위) ---------- */
// 지금 고른 갈래 id
window.lessonPanelTrack = () => _lessonTrack;

const TRACK_SWITCH_ITEM = { gyosuan: '교수안이', slides: '슬라이드가', qbank: '문항이' };
const TRACK_SWITCH_STYLE = {
    light: { box: 'bg-gray-100 border-gray-200', on: 'bg-white text-gray-900 shadow-sm', off: 'text-gray-500 hover:text-gray-800', muted: 'text-gray-400' },
    dark: { box: 'bg-black/30 border-white/10', on: 'bg-accent text-white', off: 'text-textMuted hover:text-textLight', muted: 'text-textMuted' }
};

// 두 갈래 단추. 점은 그 갈래에 이 항목이 있다는 뜻이고, 학습·실습 탭이 비어 있는 갈래는 '교안 없음'을 붙인다
// panelId: gyosuan | slides | qbank / theme: light(교수안·슬라이드) | dark(문제은행)
function lessonTrackSwitchHtml(mod, panelId, theme = 'light') {
    const style = TRACK_SWITCH_STYLE[theme] || TRACK_SWITCH_STYLE.light;
    const item = TRACK_SWITCH_ITEM[panelId] || '항목이';
    const label = id => LESSON_TABS.find(tab => tab.id === id)?.label || id;
    const buttons = LESSON_TRACKS.map(track => {
        const on = _lessonTrack === track.id;
        const filled = trackHasContent(mod, track.id);
        const done = !!PANEL_TRACK_DONE[panelId]?.(mod, track);
        const tip = !filled ? `${label(track.learn)}·${label(track.practice)} 탭에 아직 교안이 없습니다` : `${track.label} ${item} ${done ? '있습니다' : '아직 없습니다'}`;
        return `<button type="button" onclick="setLessonPanelTrack('${track.id}')" aria-pressed="${on ? 'true' : 'false'}" title="${escapeHtml(tip)}"
            class="px-3 py-1 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${on ? style.on : style.off}">
            ${escapeHtml(track.label)}${lessonNavDot(done, false)}${filled ? '' : `<span class="text-[0.6875rem] font-normal ${style.muted}">교안 없음</span>`}
        </button>`;
    }).join('');
    return `<div class="lesson-track-switch inline-flex items-center gap-0.5 p-0.5 mb-3 rounded-lg border ${style.box}" role="group" aria-label="기본학습·심화학습 고르기">${buttons}</div>`;
}

// 갈래를 바꾸고 보고 있는 교수안·슬라이드·문제은행을 그 갈래로 다시 그린다. 열어 둔 문제은행에서 문항을 고치거나 만드는 중이면 바꾸지 않는다
window.setLessonPanelTrack = function (trackId) {
    const next = lessonTrack(trackId).id;
    if (next === _lessonTrack) return;
    if (window.qbankTrackLocked?.()) {
        window.showToast?.('문항을 고치거나 만드는 중입니다. 저장하거나 취소한 뒤 바꿔 주세요.', 'warning');
        return;
    }
    _lessonTrack = next;
    if (window.switchQbankTrack?.(next)) return; // 열어 둔 문제은행은 그 자리에서 그 갈래로 다시 그린다(고른 목표·밴드 등은 그대로)
    const mod = getEditingModule();
    if (mod && _lessonPanel) renderEditor(mod); // 교수안·슬라이드(연 스튜디오도 닫고 그 갈래로)
};

// 탭이 없는 최종 평가(차시 목록의 카드로 만든 본문 하나). 기본학습 칸에 본문을 보이고 탭 단추·탭 생성은 두지 않는다(탭 생성은 본문을 버리고 새 탭을 만든다)
const isTablessQuest = mod => mod?.id === 'mainQuest' && !mod.tabContents;

function renderTabBar(mod) {
    if (!mod || !LESSON_TABS) return '';
    if (isTablessQuest(mod)) return ''; // 본문 하나뿐이라 고를 탭이 없다(교수안·슬라이드·문제은행 항목도 최종 평가에는 없다)
    const tabContents = mod.tabContents || {};
    const tabs = LESSON_TABS.map(tab => {
        const isActive = !_lessonPanel && currentLessonTab === tab.id;
        const hasContent = !!tabContents[tab.id];
        const colors = TAB_COLORS[tab.color] || TAB_COLORS.blue;
        const cls = isActive ? colors.active : colors.inactive;
        const dot = lessonNavDot(hasContent, !!window.isPipelineStep?.(tab.id, mod.id));
        return `<button onclick="switchLessonTab('${tab.id}')"
            class="px-3 py-2 text-[0.75rem] font-bold rounded-t-lg border-b-2 transition-all cursor-pointer select-none flex items-center gap-1.5 whitespace-nowrap ${cls}">
            <i class="ph-bold ${tab.icon} text-sm"></i>
            ${tab.label}
            ${dot}
        </button>`;
    }).join('');
    const panels = mod.id === 'mainQuest' ? '' : `<span class="w-px h-5 bg-gray-200 mx-1 shrink-0"></span>${LESSON_PANELS.map(panel => lessonPanelButton(mod, panel)).join('')}`;
    return `${tabs}${panels}`;
}

function switchLessonTab(tabId) {
    currentLessonTab = tabId;
    window.clearLessonPanel();
    const mod = getEditingModule();
    if (mod) renderEditor(mod);
}

// 패널을 닫았으면 true
window.clearLessonPanel = function () {
    const opened = !!_lessonPanel;
    _lessonPanel = null;
    window.forgetInlineQbank?.();
    return opened;
};

window.showLessonPanel = function (panel) {
    window.forgetInlineQbank?.();
    _lessonPanel = panel;
    const mod = getEditingModule();
    if (mod) renderEditor(mod);
};

// 탐색줄에서 고른 항목만 본문 자리에 보여 준다. renderEditor가 화면을 다시 그린 뒤 부른다
function applyLessonPanel(mod) {
    // 메인 퀘스트에는 교수안·슬라이드·문제은행 항목이 없다
    if (mod.id === 'mainQuest' && _lessonPanel) {
        window.clearLessonPanel();
        window.refreshLessonNav(mod);
    }
    applyViewMode(_lessonPanel === 'gyosuan' ? 'instructor' : 'student');
    window.syncLessonPanelView();
    document.getElementById('lesson-tab-generate')?.classList.toggle('hidden', !!_lessonPanel);
    document.getElementById('lesson-practice-time')?.classList.toggle('hidden', !!_lessonPanel); // 실습 탭의 실습 시간 단추(course-design.js)
    document.getElementById('ai-command-bar')?.classList.toggle('hidden', !!_lessonPanel);
    document.getElementById('lesson-edit-hint')?.classList.toggle('hidden', !!_lessonPanel || !!window.lessonEditHintHidden?.());
    if (_lessonPanel === 'qbank') window.openQuestionBank(mod.id, { inline: true, track: _lessonTrack });
}

// 보기/수정 전환 뒤에도 고른 항목만 보이게 한다
window.syncLessonPanelView = function () {
    document.getElementById('render-view')?.classList.toggle('hidden', _lessonPanel === 'slides' || _lessonPanel === 'qbank');
    document.getElementById('slide-view-panel')?.classList.toggle('hidden', _lessonPanel !== 'slides');
};

// 교수안이 끝나도 입력 중인 다른 항목은 다시 그리지 않는다
window.refreshAfterGyosuan = function (mod) {
    if (_lessonPanel === 'gyosuan' || _lessonPanel === 'slides') renderEditor(mod);
    else window.refreshLessonNav(mod);
};

// 생성이 끝날 때 보고 있는 화면은 두고 탐색줄 표시만 고친다
window.refreshLessonNav = function (mod) {
    const nav = document.getElementById('lesson-nav-items');
    if (nav && String(currentEditingModuleId) === String(mod.id)) nav.innerHTML = renderTabBar(mod);
};

// 그 차시(같은 객체)의 그 탭을 보고 있는지. 다른 교과의 같은 번호 차시(최종 평가는 모든 교과가 같은 id)를 보고 있으면 아니다
const isViewingTab = (mod, tabId) => String(currentEditingModuleId) === String(mod.id) && getEditingModule(mod.id) === mod && !_lessonPanel && currentLessonTab === tabId;

// 화면을 막지 않고 만드는 동안 같은 탭을 수정 모드로 고치고 있었으면 먼저 저장한다. 그래야 미리보기의 '이전 글'과 히스토리에 들어간다
function saveOpenEditsFor(mod, tabId) {
    const raw = document.getElementById('raw-view');
    if (!raw || raw.classList.contains('hidden')) return;
    if (String(raw.dataset.moduleId) !== String(mod.id) || (raw.dataset.tabId || currentLessonTab) !== tabId) return;
    window.saveRawContent?.();
}

// 이미지를 다 만든 시점의 탭 글. 기다리는 동안 고친 내용 위에 이미지를 넣는다
function latestTabMarkdown(mod, tabId, fallback) {
    saveOpenEditsFor(mod, tabId);
    return (mod.tabContents ? mod.tabContents[tabId] : mod.content) ?? fallback;
}

// 탭 글이 하나도 없는 차시(탭으로 나뉘기 전 옛 차시, 탭이 없는 최종 평가)의 본문(content). 이 본문은 기본학습 글이다(data.js trackHasContent도 같은 규칙).
// 다른 탭에 글이 있으면 content는 그 탭들을 합친 글이라 기본학습이 아니다(비운 기본학습에 다른 탭 글을 보이거나, 고쳐서 옮겨 넣지 않게)
function legacyLessonBody(mod) {
    if (!mod?.content) return '';
    return LESSON_TABS.some(tab => mod.tabContents?.[tab.id]) ? '' : mod.content;
}

function getActiveTabContent(mod) {
    if (!mod) return '';
    if (mod.tabContents && mod.tabContents[currentLessonTab]) {
        return cleanLessonOpening(mod.tabContents[currentLessonTab]);
    }
    // 폴백: 탭 글이 없는 옛 차시의 본문(content)은 기본학습에 보인다
    const body = currentLessonTab === 'basicLearn' ? legacyLessonBody(mod) : '';
    return body ? cleanLessonOpening(body) : '';
}

// 화면에 보이는 탭의 저장된 원문(첫머리 정리 전). getActiveTabContent는 화면에 그릴 정리본이다.
// 고친 내용을 저장할 때는 이 원문을 바탕으로 해야 화면에서 숨긴 첫머리(앞 그림·시간표·특징 목록)가 지워지지 않는다
function getActiveTabSource(mod) {
    return tabSourceFor(mod, currentLessonTab);
}

// 정한 탭의 저장된 원문. 원문 칸(#raw-view)은 이 글로 채운다. 탭이 없는 최종 평가와 탭 글이 없는 옛 차시는 기본학습 칸에만 본문(content)을 보인다.
// 다른 탭에만 글이 있는 차시의 비운 기본학습은 빈 글이다(legacyLessonBody)
function tabSourceFor(mod, tabId) {
    if (!mod) return '';
    if (mod.tabContents && mod.tabContents[tabId]) return mod.tabContents[tabId];
    return tabId === 'basicLearn' ? legacyLessonBody(mod) : '';
}

// mod.content는 탭을 합친 글이기도 하다. 탭이 하나라도 있으면 옛 단일 본문이 아니므로 기본 학습으로 옮기지 않는다.
function migrateMonolithicContent(mod) {
    if (mod && mod.content && !LESSON_TABS.some(tab => mod.tabContents?.[tab.id])) {
        if (!mod.tabContents) {
            mod.tabContents = { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null, advAssessment: null };
        }
        mod.tabContents.basicLearn = mod.content;
    }
}

// 아직 내용이 없는 탭 id 목록
function lessonMissingTabs(mod) {
    const tabs = mod?.tabContents || {};
    const legacyBody = !!mod?.content && !LESSON_TABS.some(tab => tabs[tab.id]);
    return LESSON_TABS.map(tab => tab.id).filter(id => !tabs[id] && !(legacyBody && id === 'basicLearn'));
}

// 탭 본문을 바꾸고 역호환용 content도 맞춘다. 탭이 모두 비어 있으면 content가 곧 기본학습 내용이다.
function setTabMarkdown(mod, tabId, md) {
    if (!mod.tabContents) {
        mod.content = md;
        return;
    }
    const isLegacy = mod.content && !LESSON_TABS.some(tab => mod.tabContents[tab.id]);
    mod.tabContents = { ...mod.tabContents, ...(isLegacy ? { basicLearn: mod.content } : {}), [tabId]: md };
    mod.content = LESSON_TABS.map(tab => mod.tabContents[tab.id] || '').filter(Boolean).join('\n\n---\n\n');
}

// 차시 안에서 그림(local:그림 id)을 가리킬 수 있는 글: 합친 본문, 탭 글, 두 갈래(기본학습·심화학습)의 교수안·편성안(원문 칸에 붙여 넣은 그림은 mod.images에 있다),
// 슬라이드 화면 편집본, 부른 쪽이 더 주는 글(다시 만든 탭에 돌려 넣을 고정 섹션). 'local:'이 없는 글과 글이 아닌 값은 뺀다
function lessonImageRefTexts(mod, extraTexts = []) {
    const isMap = value => !!value && typeof value === 'object';
    const gyosuanTexts = LESSON_TRACKS.flatMap(track => {
        const gyosuan = isMap(mod?.[track.field]) ? mod[track.field] : {};
        return [gyosuan.docMd, gyosuan.deckMd, gyosuan.deckHtml, ...(isMap(gyosuan.sessionDecks) ? Object.values(gyosuan.sessionDecks) : [])];
    });
    return [mod?.content, ...(isMap(mod?.tabContents) ? Object.values(mod.tabContents) : []), ...gyosuanTexts, ...(Array.isArray(extraTexts) ? extraTexts : [])]
        .filter(text => typeof text === 'string' && text.includes('local:'));
}

// 차시 어디에서도 쓰지 않는 그림 id. 글에 없어도 삽화(imgId)나 판서 영상(그림 id 자리)이 가리키면 쓰는 그림이다.
// 움직이는 GIF의 원래 그림(imageMotions[GIF 그림 키].still, image-motion.js)은 그 GIF 그림이 남는 동안 쓰는 그림이다(GIF 그림이 빠지면 함께 빠진다).
// 값은 보지 않는다(찾지 못한 그림 자리 teacher-image:…나 빈 값도 글이 가리키는 동안은 남긴다). local:img_1은 local:img_10 안에도 있어 남기는 쪽으로 틀린다
function unusedLessonImageIds(mod, extraTexts = []) {
    const images = mod?.images && typeof mod.images === 'object' ? mod.images : {};
    const texts = lessonImageRefTexts(mod, extraTexts);
    const illustrations = Array.isArray(mod?.illustrations) ? mod.illustrations : [];
    const videos = mod?.whiteboardVideos && typeof mod.whiteboardVideos === 'object' ? Object.keys(mod.whiteboardVideos) : [];
    const pinned = new Set([...illustrations.map(item => item?.imgId), ...videos].filter(id => id != null && id !== '').map(String));
    const unused = Object.keys(images).filter(id => !pinned.has(id) && !texts.some(text => text.includes(`local:${id}`)));
    const motions = mod?.imageMotions && typeof mod.imageMotions === 'object' && !Array.isArray(mod.imageMotions) ? Object.entries(mod.imageMotions) : [];
    const stills = new Set(motions
        .filter(([id, item]) => Object.prototype.hasOwnProperty.call(images, id) && !unused.includes(id) && item && typeof item.still === 'string')
        .map(([, item]) => item.still));
    return unused.filter(id => !stills.has(id));
}

// 쓰지 않는 그림만 지운다(용량 확보). 다른 곳이 가리키는 그림은 남긴다. 지운 GIF 그림이나 원래 그림의 움직이는 GIF 기록도 뺀다
function dropUnusedLessonImages(mod, extraTexts = []) {
    const unused = unusedLessonImageIds(mod, extraTexts);
    unused.forEach(id => { delete mod.images[id]; });
    if (!unused.length || !mod.imageMotions || typeof mod.imageMotions !== 'object' || Array.isArray(mod.imageMotions)) return;
    mod.imageMotions = Object.fromEntries(Object.entries(mod.imageMotions).filter(([id, item]) => !unused.includes(id) && !unused.includes(item?.still)));
}

function showTabGenStop(visible, labels = TAB_STOP_LABELS) {
    _tabStopLabels = labels;
    const btn = document.getElementById('editor-loading-stop');
    if (!btn) return;
    btn.classList.toggle('hidden', !visible);
    btn.disabled = false;
    btn.textContent = labels.idle;
}

// 중지 상태를 풀고 새 끊기 신호를 만든다(생성을 시작할 때). 이전 생성의 끊긴 신호를 다시 쓰지 않는다
function resetTabGenStop() {
    _tabGenStop = false;
    _tabGenAbort = typeof AbortController === 'function' ? new AbortController() : null;
}
window.resetTabGenStop = resetTabGenStop;

// 지금 생성의 끊기 신호. 생성 안의 AI 호출에만 넘긴다(작업 밖의 호출에 넘기면 지난번 중지가 남아 바로 끊긴다)
window.aiStopSignal = () => _tabGenAbort?.signal || null;

// 교안 전체 생성과 교수안 생성도 같은 중단 버튼을 쓴다
window.beginGenerationStop = function (labels) {
    resetTabGenStop();
    showTabGenStop(true, labels);
};

window.endGenerationStop = () => showTabGenStop(false);

// 차시를 묶어 생성하는 쪽도 중단을 알아야 다음 차시로 넘어가지 않는다
window.isTabGenerationStopped = () => _tabGenStop;

window.requestTabGenerationStop = function () {
    _tabGenStop = true;
    _tabGenAbort?.abort(); // 그리던 그림 호출과 다시 보내려고 기다리던 호출을 끊는다
    const btn = document.getElementById('editor-loading-stop');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = _tabStopLabels.pending;
};

const ASSESSMENT_MIN_QUESTIONS = 10;
const REINFORCE_WARN_CHARS = 80000; // 이보다 긴 탭을 통째로 고치면 응답이 출력 한도에서 잘릴 수 있어 먼저 묻는다

// 문제은행 탭(학습이해도·심화이해도)이 묻지 않은 그 갈래의 학습 목표가 있으면 생성 직후 알린다. 빠진 목표는 문제은행에서 그 갈래를 골라 그 목표로 문항을 만들어 채운다
function warnUncoveredObjectives(mod, md, tabId = 'assessment') {
    const track = tabTrack(tabId) || lessonTrack('basic');
    const [issue] = lintObjectiveCoverage(String(md || ''), qbankTrackObjectives(mod, track.id).length);
    const label = LESSON_TABS.find(tab => tab.id === tabId)?.label || '학습이해도';
    if (issue) window.showToast?.(`${label} 점검: ${issue.snip}. 문제은행의 ${track.label}에서 그 목표로 문항을 만들어 채우세요.`, 'warning');
}

// 강사가 실습 시간을 정한 실습 탭은 ## 제목의 (⏱ N분) 합계가 그 시간에서 10%보다 벗어나거나 시간 표시가 없으면 생성 직후 한 번 알린다(막지 않는다, lesson-lint.js)
function warnPracticeTime(minutes, md, label) {
    const note = minutes ? practiceTimeNote(md, minutes, label) : '';
    if (note) window.showToast?.(note, 'warning');
}

// 문제은행 탭(학습이해도·심화이해도) 문항을 문제은행에서 바로 쓰도록 그 갈래의 목표 번호를 함께 준다. 목표가 기본 문제 수보다 많으면 목표 수만큼 낸다
// 다시 만드는 탭이므로 예전 방식의 학습이해도가 남아 있어도 그 갈래의 목표만 준다
function assessmentObjectivePrompt(mod, tabId) {
    if (!isQuestionBankTab(tabId) || typeof qbankTrackObjectives !== 'function') return '';
    const goals = qbankTrackObjectives(mod, tabTrack(tabId).id);
    if (!goals.length) return '';
    const count = Math.max(ASSESSMENT_MIN_QUESTIONS, goals.length);
    return `\n\n[학습 목표 목록 — 문제마다 이 번호를 쓰고, 모든 목표를 1문제 이상 묻습니다. 문제는 ${count}개 이상 냅니다]\n${goals.map((goal, i) => `${i + 1}. ${goal}`).join('\n')}`;
}

// 탭 생성 끝 알림 글. 분량 채우기를 거친 학습 탭은 낭독 분량을 함께 알린다
// volume: lesson-volume.js 결과 / info: 저장한 글의 { minutes, targetMinutes, short }
function tabDoneText({ label, stoppedInChunks, received, archivePartial, volume, info }) {
    const archived = archivePartial ? ' 이전 내용은 작업 기록에 남겼습니다.' : '';
    const resume = " 탭 위 '분량 채우기'로 이어서 늘릴 수 있습니다.";
    if (stoppedInChunks) return `${label} 생성을 중단했습니다. 받은 ${received.toLocaleString()}자까지 저장했습니다.${archived}`;
    if (volume?.stopped) return `${label} 생성을 중단했습니다. 낭독 약 ${info.minutes}분까지 저장했습니다.${resume}${archived}`;
    if (info?.short) {
        const reason = volume.error?.message ? ` ${volume.error.message}` : '';
        const closed = volume.reason === 'none' ? ' 고정 섹션과 실습·요약 섹션은 늘리지 않습니다.' : '';
        return `${label} 탭을 만들었지만 낭독 약 ${info.minutes}분으로 목표 ${info.targetMinutes}분에 못 미칩니다.${resume}${reason}${closed}`;
    }
    if (info) return `${label} 탭이 생성되었습니다. 낭독 약 ${info.minutes}분(목표 ${info.targetMinutes}분)입니다.`;
    return `${label} 탭이 생성되었습니다.`;
}

// 저장한 학습 탭의 낭독 분량. 분량 채우기를 하지 않은 탭은 null. 분은 내림이다(lesson-lint.js readAloudMinutes)
function tabVolumeInfo(volume, md) {
    if (!volume) return null;
    const spoken = spokenChars(md);
    return { minutes: readAloudMinutes(md), targetMinutes: volume.targetMinutes, short: spoken < volume.targetChars };
}

// 분량을 채운 학습 탭을 차시에 넣지 못했을 때(차시가 지워졌거나 불러온 내용으로 바뀜) 작업 기록에 남긴다. 알림에 붙일 글을 돌려준다
async function keepFilledTab(mod, volume, md, tabId) {
    if (!volume || typeof keepVolumeText !== 'function' || !String(md || '').trim()) return '';
    return ` ${await keepVolumeText(mod, md, tabId)}`;
}

// opts.quiet: 알림 없이 결과만 돌려준다 / opts.onStatus: 진행 문구를 받는다 (일괄 생성용)
// opts.background: 화면을 막지 않고 만든다. 끝나도 보고 있는 화면은 그대로 둔다 (전체 생성)
// opts.lockedBlocks: 탭을 비운 뒤 다시 만들 때 미리 챙겨 둔 고정 섹션
async function generateTabContent(moduleId, tabId, opts = {}) {
    const mod = getEditingModule(moduleId);
    if (!mod) return { ok: false, error: '차시를 찾지 못했습니다.' };
    if (!opts.background && window.isLessonPipelineRunning?.()) {
        if (!opts.quiet) window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
        return { ok: false, error: '다른 생성(진행 막대의 작업)이 끝나지 않았습니다.', halt: true }; // 일괄 생성은 다음 차시로 가지 않고 멈춘다(course-flow.js)
    }
    if (!opts.background) showLessonView();

    const tabMeta = LESSON_TABS.find(t => t.id === tabId);
    if (!tabMeta) return { ok: false, error: '알 수 없는 탭입니다.' };
    const lockedBlocks = opts.lockedBlocks || lockedSectionBlocks(mod, tabId);

    // Cross-tab context
    const tabContents = mod.tabContents || {};
    const otherTabSummaries = LESSON_TABS
        .filter(t => t.id !== tabId && tabContents[t.id])
        .map(t => `[${t.label}] ${tabContents[t.id].substring(0, 500)}...`)
        .join('\n');

    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    // 학습 탭(기본학습·심화학습)은 초안 뒤 낭독 목표 분량까지 채운다(lesson-volume.js). 그때 붙일 참고 자료는 기다리기 전에 잡아 둔다
    const volumeSnap = fillsLearnVolume(mod, tabId) && typeof ensureSpokenVolume === 'function' ? volumeSnapshot(mod) : null;
    const baseArgs = {
        title: mod.title,
        description: mod.description,
        keyConcepts: [],
        tabId: tabId,
        tabLabel: tabMeta.label,
        otherTabContents: otherTabSummaries || null,
        hasMainQuest: !!subj?.mainQuest,
        mainQuestText: subj?.mainQuest?.description || '',
        codeTopic: lessonCodeTopic(mod), // 코드를 다루는 차시면 설명마다 예제 코드 블록을 쓰게 한다
        targetMinutes: learnTargetMinutes(mod, tabId), // 학습 탭의 낭독 목표(분, 다른 탭은 0)
        practiceMinutes: lessonPracticeMinutes(mod, tabId) // 강사가 정한 실습 시간(분, 정하지 않았거나 실습 탭이 아니면 0)
    };
    const { systemInstruction, userPrompt } = buildTaskContext('tab_content', baseArgs);

    try {
        if (!opts.background) document.getElementById('editor-loading').style.display = 'flex';
        if (!_suppressTabAlert) resetTabGenStop(); // 일괄 생성은 묶음 시작에서 한 번만 초기화한다
        showTabGenStop(!opts.background);
        const stopSignal = window.aiStopSignal(); // 중지하면 다시 보내려고 기다리던 단락 호출을 끊는다(받고 있는 단락은 끝까지 받는다)

        // 진행도 표기: 로딩 오버레이의 안내 문구를 단계별로 갱신해 사용자가 현재 진행 상황을 알 수 있게 함
        const setLoadingText = (txt) => {
            const el = document.getElementById('editor-loading-text');
            if (el && !opts.background) el.textContent = txt; // 다른 작업이 쓰는 로딩 문구를 건드리지 않는다
            opts.onStatus?.(txt);
        };

        // 재시도 발생 시(특히 429 호출 한도) 로딩 문구를 갱신해 멈춘 것처럼 보이지 않게 함
        const onRetry = ({ delayMs, isRateLimit }) => {
            const sec = Math.round((delayMs || 0) / 1000);
            if (isRateLimit) {
                setLoadingText(`⏳ API 호출 한도에 도달했습니다. ${sec}초 후 자동으로 다시 시도합니다...`);
            } else {
                setLoadingText(`⏳ 일시적인 응답 지연이 발생했습니다. ${sec}초 후 자동으로 다시 시도합니다...`);
            }
        };

        // ─── CONTINUE/END 분할 생성 루프 (긴 탭, 특히 학습 탭 480분이 잘리지 않도록) ───
        const CONTINUE_MARKER = '<!-- CONTINUE -->';
        const END_MARKER = '<!-- END -->';
        // 학습 탭은 분량이 가장 커서 청크를 더 허용하고, 실습 시간을 정한 실습 탭은 시간에 맞춰 늘린다(lesson-lint.js tabChunkLimit)
        const MAX_CHUNKS = tabChunkLimit(tabId, baseArgs.practiceMinutes);

        setLoadingText(`📝 ${tabMeta.label} 작성 중입니다... (1/${MAX_CHUNKS} 단락)`);

        const firstPayload = {
            contents: [{ role: 'user', parts: [{ text: userPrompt + lessonDesignBrief(mod, tabId) + lockedSectionPrompt(lockedBlocks) + assessmentObjectivePrompt(mod, tabId) + lessonAttachmentPrompt(mod.id) }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: { maxOutputTokens: 65536 }
        };

        // 응답 전체를 감싼 펜스만 벗긴다. 단락 끝의 코드 블록은 그대로 둔다
        let fullText = extractText(await callGemini(TEXT_MODEL, { ...firstPayload, waitSignal: stopSignal }, onRetry), { unwrap: true });
        let chunkCount = 1;
        // 이어쓰기 단계에서 호출 한도 등으로 실패하면, 이미 만든 단락은 버리지 않고 보존하기 위한 플래그
        let partialDueToError = false;
        let partialError = null; // 이어쓰기를 멈추게 한 오류(한도 0·하루 한도면 그 안내를 그대로 보인다)
        let stoppedWhileWaiting = false; // 이어 쓸 단락을 다시 보내려고 기다리다 중지했다

        while (fullText.includes(CONTINUE_MARKER) && chunkCount < MAX_CHUNKS && !_tabGenStop) {
            // 마커 제거 후 이어쓰기 준비. 코드 블록 안에서 끊겼으면 닫아 이어 쓴 글이 코드로 들어가지 않게 한다
            fullText = closeOpenFence(fullText.replace(new RegExp(CONTINUE_MARKER, 'g'), '').trimEnd());
            const contextTail = fullText.length > 2000 ? fullText.slice(-2000) : fullText;

            const cont = buildTaskContext('tab_content_continue', {
                ...baseArgs,
                chunkIndex: chunkCount,
                previousContent: contextTail,
                writtenHeadings: fullText.match(/^##\s+.+$/gm) || []
            });

            setLoadingText(`✍️ ${tabMeta.label} 이어서 작성 중입니다... (${chunkCount + 1}/${MAX_CHUNKS} 단락, ${fullText.length.toLocaleString()}자 수신)`);

            await new Promise(r => setTimeout(r, 1500));

            const contPayload = {
                contents: [{ role: 'user', parts: [{ text: cont.userPrompt + lessonGenBrief(mod, tabId) + lessonAttachmentPrompt(mod.id) }] }],
                systemInstruction: { parts: [{ text: cont.systemInstruction }] },
                generationConfig: { maxOutputTokens: 65536 }
            };

            let contText;
            try {
                contText = extractText(await callGemini(TEXT_MODEL, { ...contPayload, waitSignal: stopSignal }, onRetry), { unwrap: true });
            } catch (contErr) {
                if (contErr?.name === 'AbortError') { // 중지: 받은 단락은 남기고 멈춘다
                    stoppedWhileWaiting = true;
                    break;
                }
                // 이어쓰기 청크 실패(예: 429 호출 한도) — 첫 청크는 이미 성공했으므로
                // 지금까지 생성된 분량을 보존하고 루프를 종료한다 (전체 폐기 방지)
                partialDueToError = true;
                partialError = contErr;
                break;
            }

            // 중복 헤딩 제거: 이어쓴 첫 헤딩이 직전 마지막 헤딩과 같으면 제거
            const prevHeadings = fullText.match(/^(#{1,4}\s+.+)$/gm) || [];
            const lastHeading = prevHeadings.length ? prevHeadings[prevHeadings.length - 1].trim() : null;
            if (lastHeading) {
                const contLines = contText.split('\n');
                const firstNonEmpty = contLines.findIndex(l => l.trim() !== '');
                if (firstNonEmpty !== -1 && contLines[firstNonEmpty].trim() === lastHeading) {
                    contLines.splice(firstNonEmpty, 1);
                    contText = contLines.join('\n');
                }
            }

            fullText += '\n\n' + contText.trimStart();
            chunkCount++;
        }

        const stoppedInChunks = _tabGenStop && (fullText.includes(CONTINUE_MARKER) || stoppedWhileWaiting); // 마커는 이어쓰기 전에 지웠으므로 기다리다 멈춘 것은 따로 센다

        // 잔여 마커 정리. 코드 블록 안에서 끝났으면 닫는다(합친 본문에서 다음 탭이 코드로 보이지 않게)
        fullText = closeOpenFence(fullText
            .replace(new RegExp(CONTINUE_MARKER, 'g'), '')
            .replace(new RegExp(END_MARKER, 'g'), '')
            .trimEnd());

        let resultText = fullText;
        // 마크다운 정리
        if (typeof sanitizeMarkdownContent === 'function') {
            resultText = sanitizeMarkdownContent(resultText);
        }

        // 탭이 없는 최종 평가·옛 차시의 본문은 기본 학습 탭으로 옮긴다. 새 탭이 본문을 지우지 않고, 기본 학습을 다시 만들면 미리 보고 작업 기록에 남긴다
        migrateMonolithicContent(mod);
        if (!mod.tabContents) mod.tabContents = { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null, advAssessment: null };
        resultText = cleanLessonOpening(restoreLockedSections(resultText, lockedBlocks));
        if (typeof checklistLast === 'function') resultText = checklistLast(resultText, tabId);
        if (!resultText.trim()) throw new Error('AI 응답이 비어 있습니다.');
        // 학습 탭은 모자란 섹션마다 새 소주제를 이어 붙여 낭독 목표 분량까지 채운다. 그림 자리는 초안에만 미리 넣는다(붙인 소주제에는 넣지 않는다)
        const volume = volumeSnap && !partialDueToError && !_tabGenStop ? await ensureSpokenVolume({
            ...volumeSnap, md: window.autoInjectImageTags ? window.autoInjectImageTags(resultText) : resultText, mod, tabId, lockedBlocks,
            targetMinutes: baseArgs.targetMinutes, codeTopic: baseArgs.codeTopic, isStopped: () => _tabGenStop,
            isLive: () => !subj || typeof lessonStillLive !== 'function' || lessonStillLive(subj, mod), onStatus: setLoadingText, onRetry, waitSignal: stopSignal
        }) : null;
        // 채우는 동안이나 채운 뒤(고치기·미리 보기·그림)에 차시를 지웠거나 백업·PC 폴더를 불러왔다. 그 차시에 쓰지 않고 채운 글은 작업 기록에 남긴다
        const lessonGone = async md => {
            const goneText = `차시가 지워졌거나 불러온 내용으로 바뀌어 ${tabMeta.label} 만들기를 멈췄습니다.${await keepFilledTab(mod, volume, md, tabId)}`;
            if (!_suppressTabAlert && !opts.quiet) window.showAlert(goneText); // 탭 모두 다시 만들기는 끝에 한 번만 알린다
            return { ok: false, error: goneText };
        };
        const lessonHere = () => !volume || !subj || typeof lessonStillLive !== 'function' || lessonStillLive(subj, mod);
        if (volume?.gone) return lessonGone(volume.added ? volume.md : '');
        if (volume) resultText = volume.md;
        const stoppedEarly = stoppedInChunks || !!volume?.stopped;
        const volumeHalt = !!volume && typeof aiErrorStopsRun === 'function' && aiErrorStopsRun(volume.error); // 하루 한도·키 문제: 일괄 생성도 멈춘다
        // 하루 한도·키 문제나 다시 보내도 같은 오류(noRetry, lesson-volume.js isVolumeHalt)로 분량 채우기가 멈췄으면 고치기·그림도 같은 까닭으로 실패하므로 하지 않는다
        const volumeQuit = volumeHalt || (!!volume && typeof isVolumeHalt === 'function' && isVolumeHalt(volume.error));
        // 끝까지 받지 못한 글은 체크리스트 누락 같은 지적이 당연히 나오므로 자동 수정하지 않는다
        if (typeof autoFixGeneratedTab === 'function' && !partialDueToError && !_tabGenStop && !volumeQuit) {
            showTabGenStop(false);
            const floor = volume ? { rounds: VOLUME_FIX_ROUNDS, minSpokenChars: volume.targetChars, isStopped: () => _tabGenStop } : {}; // 채운 분량 아래로 줄이지 않는다
            resultText = await autoFixGeneratedTab({ tabId, md: resultText, lockedBlocks, onStatus: setLoadingText, onRetry, ...floor });
            // 분량을 채운 학습 탭은 고쳐 받은 체크리스트에도 다시 보기의 옛 (⏱) 시간이 남지 않게 뗀다(lesson-volume.js)
            if (volume && typeof volumeChecklistText === 'function') resultText = volumeChecklistText(resultText, lockedBlocks);
        }
        if (tabId === 'basicPrac' && typeof withQuestFileName === 'function') resultText = withQuestFileName(resultText, mod, subj);
        // 기존 탭을 다시 만들면 바뀐 섹션을 보고 고른다. 묶어서 생성할 때는 묻지 않고 기존 글을 히스토리에 남긴다
        saveOpenEditsFor(mod, tabId);
        const previous = mod.tabContents[tabId];
        const previewed = !!previous && !_suppressTabAlert && !opts.quiet;
        if (previewed) {
            document.getElementById('editor-loading').style.display = 'none';
            const truncated = stoppedInChunks || partialDueToError; // 분량 채우기를 멈춘 글은 섹션이 다 있어 마지막 섹션도 고른다
            const stoppedNote = volume?.stopped ? `분량 채우기를 중간에 멈춘 글입니다(낭독 약 ${readAloudMinutes(resultText)}분/목표 ${volume.targetMinutes}분).` : '';
            const generated = resultText;
            resultText = await previewAiChange(previous, resultText, {
                title: `${tabMeta.label} 재생성 미리보기`, tabId, truncated, rewrite: true, cancelLabel: volume ? '반영하지 않기' : '취소',
                note: truncated ? '끝까지 받지 못한 글입니다. 마지막 섹션은 기본으로 고르지 않았습니다.' : stoppedNote || '새 글에 없는 이전 섹션은 기본으로 지웁니다. 이전 글은 작업 기록에 남습니다.'
            });
            if (resultText === null || resultText.trim() === previous.trim()) {
                // 분량을 채우느라 오래 걸린 학습 탭은 반영하지 않아도 작업 기록에 남긴다(다시 만들지 않아도 그 글로 되돌릴 수 있게)
                if (volume && typeof keepVolumeText === 'function') window.showToast?.(`${tabMeta.label} 다시 만들기를 반영하지 않았습니다. ${await keepVolumeText(mod, generated, tabId)}`, 'info');
                return { ok: true, cancelled: true };
            }
            // 섹션을 골라 반영하면 (⏱) 합계가 목표에서 벗어날 수 있어 고른 글로 다시 매긴다(lesson-volume.js)
            if (volume && resultText !== generated && typeof retimeVolumeChoice === 'function') resultText = retimeVolumeChoice(resultText, { targetMinutes: volume.targetMinutes, lockedBlocks, tabId });
            if (!opts.background) document.getElementById('editor-loading').style.display = 'flex'; // 막지 않는 작업은 진행 막대가 이어서 보인다
        }
        if (!lessonHere()) return lessonGone(resultText);
        // 끝까지 받지 못한 글, 미리보기로 고른 글, 전체 탭 재생성이 기존 탭을 덮으므로 기존 내용을 히스토리에 남긴다
        const archivePartial = !!previous && (stoppedEarly || partialDueToError || previewed || _suppressTabAlert);
        if (archivePartial) await archiveContent({ title: `${mod.title} · ${tabMeta.label}`, content: previous, images: mod.images, tabId, lesson: mod }, '다시 생성 전');
        mod.tabContents[tabId] = resultText;
        if (isQuestionBankTab(tabId)) warnUncoveredObjectives(mod, resultText, tabId);
        mod.status = 'done';
        Object.assign(mod, withHistoryNote(mod, `${tabMeta.label} ${previous ? 'AI 재생성' : 'AI 생성'}`));

        // content 필드도 업데이트 (역호환)
        mod.content = LESSON_TABS
            .map(t => (mod.tabContents[t.id] || ''))
            .filter(Boolean)
            .join('\n\n---\n\n');

        // 이미지 태그 자동 처리 (딥리서치 파이프라인 활용). 중단하면 이미지 생성 비용도 쓰지 않고 태그만 남긴다. 한도·키 문제로 멈췄을 때도 부르지 않는다.
        // 분량을 채운 글은 초안에 넣은 그림 자리만 채운다(inject: false)
        if (typeof processImageTags === 'function' && !_tabGenStop && !volumeQuit) {
            setLoadingText(`🖼️ ${tabMeta.label} 이미지와 서식을 정리하고 있습니다...`);
            try {
                const processed = restoreLockedSections(await processImageTags(mod, resultText, { onStatus: setLoadingText, latest: () => latestTabMarkdown(mod, tabId, resultText), inject: !volume }), lockedBlocks);
                if (processed !== resultText) {
                    mod.tabContents[tabId] = processed;
                    mod.content = LESSON_TABS.map(t => (mod.tabContents[t.id] || '')).filter(Boolean).join('\n\n---\n\n');
                }
            } catch (imgErr) {
                console.warn('[TabGen] 이미지 처리 경고:', imgErr.message);
            }
        }
        if (!lessonHere()) return lessonGone(mod.tabContents[tabId]); // 그림을 그리는 동안 차시가 바뀌었다(그 차시는 이제 저장된 작업에 없다)
        if (!stoppedEarly && !partialDueToError) warnPracticeTime(baseArgs.practiceMinutes, mod.tabContents[tabId], tabMeta.label); // 끝까지 받은 실습 탭만 시간 합계를 본다

        await saveState();
        renderSidebar();
        if (!opts.background || isViewingTab(mod, tabId)) renderEditor(mod);
        else window.refreshLessonNav(mod);
        const info = tabVolumeInfo(volume, mod.tabContents[tabId]);
        if (!_suppressTabAlert && !opts.quiet) {
            const doneText = tabDoneText({ label: tabMeta.label, stoppedInChunks, received: fullText.length, archivePartial, volume, info });
            // 화면을 막지 않고 만든 작업은 끝을 알림으로 알린다. 일부가 빠진 결과와 한도로 멈춘 분량 채우기는 다시 해야 하므로 창으로 알린다
            if (partialDueToError) window.showAlert(partialError?.quota
                ? `${tabMeta.label} 탭은 만들었지만 뒷부분을 받지 못했습니다. ${partialError.message}`
                : `${tabMeta.label} 탭이 생성되었지만, API 호출 한도로 일부 단락이 누락되었을 수 있습니다. 잠시 후(1~2분) 다시 생성하면 전체 분량이 완성됩니다.`);
            else if (volumeHalt) window.showAlert(doneText);
            else if (opts.background) window.notifyLessonJobDone?.(doneText, stoppedEarly || info?.short ? 'warning' : 'success');
            else window.showAlert(doneText);
        }
        // short: 학습 탭이 낭독 목표에 못 미쳤다 / halt: 한도·키 문제로 분량 채우기가 멈췄다(일괄 생성도 멈춘다)
        return {
            ok: true, partial: partialDueToError || stoppedEarly,
            ...(info?.short ? { short: true, readMinutes: info.minutes, targetMinutes: info.targetMinutes } : {}),
            ...(volumeHalt ? { halt: true, error: volume.error.message } : {})
        };
    } catch (err) {
        if (err?.name === 'AbortError') { // 첫 단락을 다시 보내려고 기다리다 중지했다. 받은 글이 없어 지금 글은 그대로다
            if (!_suppressTabAlert && !opts.quiet) window.showToast?.(`${tabMeta.label} 생성을 멈췄습니다.`, 'warning');
            return { ok: false, stopped: true };
        }
        console.error(`[TabGen] ${tabMeta.label} 실패:`, err);
        // 429(호출 한도)는 원인과 대처법을 명확히 안내해 사용자가 무한 재시도하지 않도록 함
        const is429 = !err.quota && (err.status === 429 || /status:\s*429/.test(err.message || '')); // 한도 0·하루 한도는 기다려도 안 되므로 ai-errors.js 안내를 그대로 둔다
        const message = is429
            ? `${tabMeta.label} 생성 실패: API 호출 한도(429)에 도달했습니다. 1~2분 후 다시 시도해 주세요. (짧은 시간에 여러 탭을 연속 생성하면 한도에 걸릴 수 있습니다.)`
            : `${tabMeta.label} 생성 중 오류: ${err.message}`;
        if (!opts.quiet) window.showAlert(message);
        // noRetry: 다시 보내도 같은 오류(키·모델·한도 0·하루 한도) / halt: 다음 차시도 같은 까닭으로 실패한다(일괄 생성을 멈춘다, ai-errors.js)
        return { ok: false, error: message, noRetry: !!err?.noRetry, halt: typeof aiErrorStopsRun === 'function' && aiErrorStopsRun(err) };
    } finally {
        // 진행도 안내 문구를 기본값으로 복원해 다음 작업에 잔여 텍스트가 남지 않도록 함
        // 화면을 막지 않고 만들 때는 다른 작업이 켠 로딩 화면을 끄지 않는다
        if (!opts.background) {
            const loadingTextEl = document.getElementById('editor-loading-text');
            if (loadingTextEl) loadingTextEl.textContent = 'AI가 상세 교안을 작성하고 있습니다...';
            document.getElementById('editor-loading').style.display = 'none';
            showTabGenStop(false);
        }
    }
}

// 교안 탭을 모두 다시 만든다. 화면을 막지 않고 진행 막대에서 탭 순서·걸린 시간·중지를 보여 주며, 이전 글은 히스토리에 남긴다
async function generateAllTabs(moduleId) {
    const failed = [];
    const short = []; // 학습 탭이 낭독 목표에 못 미친 탭
    let halted = null; // 한도·키 문제로 멈췄으면 그 안내
    // 시작한 교과의 그 차시만 다시 만든다. 탭마다 차시를 id로 다시 찾으므로, 다른 교과로 옮기거나 차시가 바뀌면
    // (최종 평가는 모든 교과가 같은 id) 그 교과의 차시를 다시 만들지 않게 다음 탭으로 가지 않고 멈춘다
    const subjectId = currentSubjectId;
    const lesson = getEditingModule(moduleId);
    let moved = false;
    const outcome = await window.runLessonJob(moduleId, { label: '교안 탭 모두 다시 만들기', current: LESSON_TABS[0].id, total: LESSON_TABS.length }, async () => {
        for (let i = 0; i < LESSON_TABS.length; i++) {
            if (currentSubjectId !== subjectId || !lesson || getEditingModule(moduleId) !== lesson) {
                moved = true;
                break;
            }
            const tab = LESSON_TABS[i];
            window.updateLessonJob({ current: tab.id, label: tab.label, done: i });
            const result = await generateTabContent(moduleId, tab.id, { background: true, onStatus: window.setPipelineStatus });
            if (!result.ok) failed.push(tab.label);
            if (result.short) short.push(`${tab.label}(낭독 약 ${result.readMinutes}분)`);
            if (result.halt) { // 남은 탭도 같은 까닭으로 실패한다
                halted = result.error || '';
                break;
            }
            if (_tabGenStop) break;
            await new Promise(r => setTimeout(r, 2000));
        }
        return { ok: true };
    });
    if (outcome?.busy) return;
    if (moved) return window.showAlert('다른 교과로 옮겼거나 차시가 바뀌어 교안 탭 다시 만들기를 멈췄습니다. 그 전에 다시 만든 탭은 저장했고 이전 글은 작업 기록에 있습니다. 남은 탭은 그 차시로 돌아가 탭마다 \'이 탭 생성\'으로 다시 만드세요.');
    const shortNote = short.length ? ` ${short.join(', ')}은 목표 분량에 못 미칩니다. 탭 위 '분량 채우기'로 이어서 늘릴 수 있습니다.` : '';
    if (halted !== null) return window.showAlert(`${halted}\n그 전에 만든 탭은 저장했습니다. 남은 탭은 한도가 풀린 뒤 탭마다 '이 탭 생성'으로 만드세요.${shortNote}`);
    if (_tabGenStop) return window.showAlert(`전체 탭 생성을 중단했습니다. 받은 내용까지 저장했습니다.${shortNote}`);
    if (failed.length) return window.showAlert(`${failed.join(', ')} 탭을 만들지 못했습니다. 그 탭에서 다시 생성해 주세요.${shortNote}`);
    if (short.length) return window.notifyLessonJobDone(`교안 탭을 모두 다시 만들었습니다.${shortNote} 이전 글은 작업 기록에 남았습니다.`, 'warning');
    window.notifyLessonJobDone('교안 탭을 모두 다시 만들었습니다. 이전 글은 작업 기록에 남았습니다.');
}

// 낭독 목표에 못 미친 학습 탭을 모은다(일괄 생성 보고에 탭마다 보인다). readMinutes는 처음 모자란 탭의 낭독 시간이다
function withShortTab(short, tabId, result) {
    const label = LESSON_TABS.find(tab => tab.id === tabId)?.label || tabId;
    return { short: true, readMinutes: short.readMinutes ?? result.readMinutes, shortTabs: [...(short.shortTabs || []), { tabId, label, readMinutes: result.readMinutes }] };
}

// 일괄 생성용: 빈 탭만 순서대로 채운다. 있는 탭은 건드리지 않고 첫 실패에서 멈춰 결과를 돌려준다.
// lockedByTab: 덮어쓰기로 비우기 전에 챙겨 둔 고정 섹션
async function fillMissingTabs(moduleId, { isStopped = () => false, onTab = () => {}, onStatus, lockedByTab = {} } = {}) {
    const mod = getEditingModule(moduleId);
    if (!mod) return { ok: false, error: '차시를 찾지 못했습니다.' };
    migrateMonolithicContent(mod); // 탭을 저장하면 mod.content를 다시 쓰므로 옛 단일 본문을 먼저 옮긴다
    const missing = lessonMissingTabs(mod);
    let partial = false;
    let short = {}; // 학습 탭이 낭독 목표에 못 미쳤으면 { short: true, readMinutes, shortTabs }
    for (let i = 0; i < missing.length; i++) {
        if (isStopped()) return { ok: false, stopped: true, partial, ...short };
        onTab(LESSON_TABS.find(tab => tab.id === missing[i]), i, missing.length);
        const result = await generateTabContent(moduleId, missing[i], { quiet: true, onStatus, lockedBlocks: lockedByTab[missing[i]] });
        if (result.short) short = withShortTab(short, missing[i], result);
        if (!result.ok) return { ok: false, partial, ...short, error: result.error, stopped: !!result.stopped, noRetry: !!result.noRetry, halt: !!result.halt };
        partial = partial || !!result.partial;
        // 학습 탭은 저장했지만 분량 채우기가 하루 한도·키 문제로 멈췄다. 남은 탭과 다음 차시도 같은 까닭으로 실패하므로 일괄 생성을 멈춘다
        if (result.halt) return { ok: false, partial, ...short, halt: true, error: result.error };
        await new Promise(r => setTimeout(r, 2000));
    }
    return { ok: true, partial, ...short };
}

// 탭 전체 AI 수정: 아래 명령줄에서 글을 고르지 않고 요청하면 온다. 기존 탭 내용 + 요청으로 다시 쓰고,
// 바뀐 부분을 미리 보고 골라 반영한다. 화면을 막지 않고 진행 막대에서 기다린다
async function reinforceCurrentTab(moduleId, command = '') {
    const mod = getEditingModule(moduleId);
    if (!mod) return;
    const tabId = currentLessonTab;
    // 원문 전체 수정에서 고치던 글을 먼저 저장해 그 글을 고친다. 최종 평가·옛 차시는 탭 대신 본문(content)을 읽는다
    saveOpenEditsFor(mod, tabId);
    const existingContent = storedTabMarkdown(mod, tabId);
    if (!existingContent) return window.showAlert('먼저 이 탭의 교안을 생성해주세요.');

    const reinforceCmd = String(command || '').trim();
    const lockedBlocks = lockedSectionBlocks(mod, tabId);
    if (!reinforceCmd) return window.showAlert('고칠 내용을 아래 칸에 써 주세요.');

    const tabMeta = LESSON_TABS.find(t => t.id === tabId);
    const shownLabel = mod.id === 'mainQuest' ? '최종 평가' : tabMeta.label; // 최종 평가는 탭이 없다
    // 분량을 채운 기본 학습처럼 긴 탭은 통째로 고치면 잘릴 수 있다. 잘린 뒤의 섹션은 미리보기에서 지금 글을 그대로 둔다
    if (existingContent.length > REINFORCE_WARN_CHARS && !(await confirmAsync(
        `이 탭은 ${existingContent.length.toLocaleString('ko-KR')}자로 깁니다. 탭 전체를 한 번에 고치면 응답이 출력 한도에서 잘릴 수 있고, 잘린 뒤의 섹션은 미리보기에서 지금 글을 그대로 둡니다. 고칠 부분을 끌어 골라 AI로 고치면 더 정확합니다.`,
        { title: '긴 탭 전체 고치기', okLabel: '그래도 탭 전체 고치기', tone: 'primary' }))) return;
    await window.runLessonJob(moduleId, { label: `${shownLabel} AI로 고치기`, current: tabId, alerts: true }, async () => {
        try {
            window.setPipelineStatus('AI가 고친 글을 받고 있습니다...');
            const systemInstruction = CONTEXT_CORE.personas.instructor +
                '\n[규칙]\n- 기존 교안 내용을 유지하면서, 사용자의 보강 명령에 따라 내용을 개선하세요.\n- 전체 구조와 서식은 보존하되, 요청된 부분만 보강·수정하세요.\n- ' +
                CONTEXT_CORE.rules.content_design + '\n- ' +
                CONTEXT_CORE.rules.korean_period + '\n- ' +
                (CONTEXT_CORE.rules.emoji_rule || '') +
                (!isQuestionBankTab(tabId) && CONTEXT_CORE.rules.code_examples ? '\n- ' + CONTEXT_CORE.rules.code_examples : '');

            const userPrompt = `[현재 작업: ${tabMeta.label} 보강 재생성]\n모듈명: ${mod.title}\n\n[사용자 보강 명령]\n${reinforceCmd}\n\n[기존 교안 내용 — 이 내용을 기반으로 보강하세요]\n${existingContent}`;

            const payload = {
                contents: [{ parts: [{ text: userPrompt + lockedSectionPrompt(lockedBlocks) + lessonAttachmentPrompt(mod.id) }] }],
                systemInstruction: { parts: [{ text: systemInstruction }] },
                generationConfig: { maxOutputTokens: 65536 }
            };

            const data = await callGemini(TEXT_MODEL, { ...payload, signal: window.aiStopSignal() }); // 중지하면 받던 글을 끊는다(반영하지 않는 글이다)
            if (_tabGenStop) return; // 중지하면 받은 글을 반영하지 않는다

            const resultText = restoreLockedSections(extractText(data), lockedBlocks);
            const truncated = data?.candidates?.[0]?.finishReason === 'MAX_TOKENS';
            // 기다리는 동안 이 탭을 고쳤으면 고친 글을 지키고, 다시 실행하게 한다
            saveOpenEditsFor(mod, tabId);
            if (storedTabMarkdown(mod, tabId) !== existingContent) return window.showAlert('고치는 동안 탭 내용이 바뀌어 반영하지 않았습니다. 다시 실행해 주세요.');
            window.setPipelineStatus('바뀐 섹션을 골라 반영해 주세요.');
            const approved = await previewAiChange(existingContent, resultText, {
                title: `${shownLabel} AI 수정 미리보기`,
                tabId,
                truncated,
                note: truncated ? '응답이 출력 한도에서 잘렸습니다. 마지막 섹션은 기본으로 고르지 않았습니다.' : ''
            });
            if (approved === null) return;

            if (!(await commitTabChange(mod, tabId, existingContent, approved, `AI 수정 반영(탭 전체): ${reinforceCmd}`))) return;
            const commandInput = document.getElementById('ai-command-input');
            if (commandInput && commandInput.value.trim() === reinforceCmd) commandInput.value = ''; // 반영한 요청만 지운다
            window.notifyLessonJobDone(`${shownLabel}에 AI 수정을 반영했습니다.`);
        } catch (err) {
            if (err?.name === 'AbortError') return; // 중지: 반영할 글이 없다
            console.error('[탭 전체 AI 수정] 실패:', err);
            window.showAlert('AI 수정 중 오류: ' + err.message);
        }
    });
}

