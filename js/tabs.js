// tabs.js — 5탭 에디터 시스템

let currentLessonTab = 'basicLearn';
let _lessonPanel = null; // 탭 대신 보고 있는 항목: gyosuan | slides | qbank
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
    violet:  { active: 'bg-violet-500 border-violet-500 text-white shadow-md', inactive: 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200' }
};

// 교안 탭 뒤에 이어지는 항목. 교수안과 슬라이드는 한 번에 만들어진다
const LESSON_PANELS = [
    { id: 'gyosuan', step: 'gyosuan', label: '교수안', icon: 'ph-chalkboard-teacher', color: 'violet', done: mod => !!mod.gyosuan?.docMd },
    { id: 'slides', step: 'gyosuan', label: '슬라이드', icon: 'ph-presentation-chart', color: 'blue', done: mod => !!(mod.gyosuan?.deckMd || mod.gyosuan?.deckHtml) },
    { id: 'qbank', step: 'qbank', label: '문제은행', icon: 'ph-list-checks', color: 'emerald', done: mod => qbankQuestions(mod).some(question => question.objective) }
];

function lessonNavDot(done, running) {
    if (running) return '<i class="ph-bold ph-circle-notch animate-spin text-sm"></i>';
    return `<span class="w-2 h-2 rounded-full ${done ? 'bg-current opacity-70' : 'bg-gray-300 opacity-40'}"></span>`;
}

function lessonPanelButton(mod, panel) {
    const colors = TAB_COLORS[panel.color];
    return `<button onclick="showLessonPanel('${panel.id}')"
            class="px-3 py-2 text-[0.75rem] font-bold rounded-t-lg border-b-2 transition-all cursor-pointer select-none flex items-center gap-1.5 whitespace-nowrap ${_lessonPanel === panel.id ? colors.active : colors.inactive}">
            <i class="ph-bold ${panel.icon} text-sm"></i>
            ${panel.label}
            ${lessonNavDot(panel.done(mod), !!window.isPipelineStep?.(panel.step, mod.id))}
        </button>`;
}

function renderTabBar(mod) {
    if (!mod || !LESSON_TABS) return '';
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
    document.getElementById('ai-command-bar')?.classList.toggle('hidden', !!_lessonPanel);
    document.getElementById('lesson-edit-hint')?.classList.toggle('hidden', !!_lessonPanel || !!window.lessonEditHintHidden?.());
    if (_lessonPanel === 'qbank') window.openQuestionBank(mod.id, { inline: true });
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

const isViewingTab = (mod, tabId) => String(currentEditingModuleId) === String(mod.id) && !_lessonPanel && currentLessonTab === tabId;

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

function getActiveTabContent(mod) {
    if (!mod) return '';
    if (mod.tabContents && mod.tabContents[currentLessonTab]) {
        return cleanLessonOpening(mod.tabContents[currentLessonTab]);
    }
    // 폴백: 기존 content 필드 사용
    if (currentLessonTab === 'basicLearn' && mod.content) {
        return cleanLessonOpening(mod.content);
    }
    return '';
}

// 화면에 보이는 탭의 저장된 원문(첫머리 정리 전). getActiveTabContent는 화면에 그릴 정리본이다.
// 고친 내용을 저장할 때는 이 원문을 바탕으로 해야 화면에서 숨긴 첫머리(앞 그림·시간표·특징 목록)가 지워지지 않는다
function getActiveTabSource(mod) {
    if (!mod) return '';
    if (mod.tabContents && mod.tabContents[currentLessonTab]) return mod.tabContents[currentLessonTab];
    if (currentLessonTab === 'basicLearn' && mod.content) return mod.content;
    return '';
}

// mod.content는 탭을 합친 글이기도 하다. 탭이 하나라도 있으면 옛 단일 본문이 아니므로 기본 학습으로 옮기지 않는다.
function migrateMonolithicContent(mod) {
    if (mod && mod.content && !LESSON_TABS.some(tab => mod.tabContents?.[tab.id])) {
        if (!mod.tabContents) {
            mod.tabContents = { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null };
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

// 학습이해도가 묻지 않은 학습 목표가 있으면 생성 직후 알린다. 빠진 목표는 문제은행에서 그 목표로 문항을 만들어 채운다
function warnUncoveredObjectives(mod, md) {
    const [issue] = lintObjectiveCoverage(String(md || ''), qbankObjectives(mod).length);
    if (issue) window.showToast?.(`학습이해도 점검: ${issue.snip}. 문제은행에서 그 목표로 문항을 만들어 채우세요.`, 'warning');
}

// 학습이해도 문항을 문제은행에서 바로 쓰도록 목표 번호를 함께 준다. 목표가 기본 문제 수보다 많으면 목표 수만큼 낸다
function assessmentObjectivePrompt(mod, tabId) {
    if (tabId !== 'assessment' || typeof qbankObjectives !== 'function') return '';
    const goals = qbankObjectives(mod);
    if (!goals.length) return '';
    const count = Math.max(ASSESSMENT_MIN_QUESTIONS, goals.length);
    return `\n\n[학습 목표 목록 — 문제마다 이 번호를 쓰고, 모든 목표를 1문제 이상 묻습니다. 문제는 ${count}개 이상 냅니다]\n${goals.map((goal, i) => `${i + 1}. ${goal}`).join('\n')}`;
}

// opts.quiet: 알림 없이 결과만 돌려준다 / opts.onStatus: 진행 문구를 받는다 (일괄 생성용)
// opts.background: 화면을 막지 않고 만든다. 끝나도 보고 있는 화면은 그대로 둔다 (전체 생성)
// opts.lockedBlocks: 탭을 비운 뒤 다시 만들 때 미리 챙겨 둔 고정 섹션
async function generateTabContent(moduleId, tabId, opts = {}) {
    const mod = getEditingModule(moduleId);
    if (!mod) return { ok: false, error: '차시를 찾지 못했습니다.' };
    if (!opts.background && window.isLessonPipelineRunning?.()) {
        window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
        return { ok: false, error: '다른 생성이 진행 중입니다.' };
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
    const baseArgs = {
        title: mod.title,
        description: mod.description,
        keyConcepts: [],
        tabId: tabId,
        tabLabel: tabMeta.label,
        otherTabContents: otherTabSummaries || null,
        hasMainQuest: !!subj?.mainQuest,
        mainQuestText: subj?.mainQuest?.description || ''
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

        // ─── CONTINUE/END 분할 생성 루프 (긴 탭, 특히 기본 학습 480분이 잘리지 않도록) ───
        const CONTINUE_MARKER = '<!-- CONTINUE -->';
        const END_MARKER = '<!-- END -->';
        // 기본 학습은 분량이 가장 크므로 더 많은 청크 허용
        const MAX_CHUNKS = tabId === 'basicLearn' ? 6 : 3;

        setLoadingText(`📝 ${tabMeta.label} 작성 중입니다... (1/${MAX_CHUNKS} 단락)`);

        const firstPayload = {
            contents: [{ role: 'user', parts: [{ text: userPrompt + lessonDesignBrief(mod) + lockedSectionPrompt(lockedBlocks) + assessmentObjectivePrompt(mod, tabId) + lessonAttachmentPrompt(mod.id) }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: { maxOutputTokens: 65536 }
        };

        let fullText = extractText(await callGemini(TEXT_MODEL, { ...firstPayload, waitSignal: stopSignal }, onRetry));
        let chunkCount = 1;
        // 이어쓰기 단계에서 호출 한도 등으로 실패하면, 이미 만든 단락은 버리지 않고 보존하기 위한 플래그
        let partialDueToError = false;
        let partialError = null; // 이어쓰기를 멈추게 한 오류(한도 0·하루 한도면 그 안내를 그대로 보인다)
        let stoppedWhileWaiting = false; // 이어 쓸 단락을 다시 보내려고 기다리다 중지했다

        while (fullText.includes(CONTINUE_MARKER) && chunkCount < MAX_CHUNKS && !_tabGenStop) {
            // 마커 제거 후 이어쓰기 준비
            fullText = fullText.replace(new RegExp(CONTINUE_MARKER, 'g'), '').trimEnd();
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
                contents: [{ role: 'user', parts: [{ text: cont.userPrompt + lessonGenBrief(mod) + lessonAttachmentPrompt(mod.id) }] }],
                systemInstruction: { parts: [{ text: cont.systemInstruction }] },
                generationConfig: { maxOutputTokens: 65536 }
            };

            let contText;
            try {
                contText = extractText(await callGemini(TEXT_MODEL, { ...contPayload, waitSignal: stopSignal }, onRetry));
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

        const stoppedEarly = _tabGenStop && (fullText.includes(CONTINUE_MARKER) || stoppedWhileWaiting); // 마커는 이어쓰기 전에 지웠으므로 기다리다 멈춘 것은 따로 센다

        // 잔여 마커 정리
        fullText = fullText
            .replace(new RegExp(CONTINUE_MARKER, 'g'), '')
            .replace(new RegExp(END_MARKER, 'g'), '')
            .trimEnd();

        let resultText = fullText;
        // 마크다운 정리
        if (typeof sanitizeMarkdownContent === 'function') {
            resultText = sanitizeMarkdownContent(resultText);
        }

        if (!mod.tabContents) mod.tabContents = { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null };
        resultText = cleanLessonOpening(restoreLockedSections(resultText, lockedBlocks));
        if (typeof checklistLast === 'function') resultText = checklistLast(resultText, tabId);
        if (!resultText.trim()) throw new Error('AI 응답이 비어 있습니다.');
        // 끝까지 받지 못한 글은 체크리스트 누락 같은 지적이 당연히 나오므로 자동 수정하지 않는다
        if (typeof autoFixGeneratedTab === 'function' && !partialDueToError && !_tabGenStop) {
            showTabGenStop(false);
            resultText = await autoFixGeneratedTab({ tabId, md: resultText, lockedBlocks, onStatus: setLoadingText, onRetry });
        }
        if (tabId === 'basicPrac' && typeof withQuestFileName === 'function') resultText = withQuestFileName(resultText, mod, subj);
        // 기존 탭을 다시 만들면 바뀐 섹션을 보고 고른다. 묶어서 생성할 때는 묻지 않고 기존 글을 히스토리에 남긴다
        saveOpenEditsFor(mod, tabId);
        const previous = mod.tabContents[tabId];
        const previewed = !!previous && !_suppressTabAlert && !opts.quiet;
        if (previewed) {
            document.getElementById('editor-loading').style.display = 'none';
            const truncated = stoppedEarly || partialDueToError;
            resultText = await previewAiChange(previous, resultText, {
                title: `${tabMeta.label} 재생성 미리보기`, tabId, truncated, rewrite: true,
                note: truncated ? '끝까지 받지 못한 글입니다. 마지막 섹션은 기본으로 고르지 않았습니다.' : '새 글에 없는 이전 섹션은 기본으로 지웁니다. 이전 글은 작업 기록에 남습니다.'
            });
            if (resultText === null || resultText.trim() === previous.trim()) return { ok: true, cancelled: true };
            if (!opts.background) document.getElementById('editor-loading').style.display = 'flex'; // 막지 않는 작업은 진행 막대가 이어서 보인다
        }
        // 끝까지 받지 못한 글, 미리보기로 고른 글, 전체 탭 재생성이 기존 탭을 덮으므로 기존 내용을 히스토리에 남긴다
        const archivePartial = !!previous && (stoppedEarly || partialDueToError || previewed || _suppressTabAlert);
        if (archivePartial) await archiveContent({ title: `${mod.title} · ${tabMeta.label}`, content: previous, images: mod.images, tabId, lesson: mod }, '다시 생성 전');
        mod.tabContents[tabId] = resultText;
        if (tabId === 'assessment') warnUncoveredObjectives(mod, resultText);
        mod.status = 'done';
        Object.assign(mod, withHistoryNote(mod, `${tabMeta.label} ${previous ? 'AI 재생성' : 'AI 생성'}`));

        // content 필드도 업데이트 (역호환)
        mod.content = LESSON_TABS
            .map(t => (mod.tabContents[t.id] || ''))
            .filter(Boolean)
            .join('\n\n---\n\n');

        // 이미지 태그 자동 처리 (딥리서치 파이프라인 활용). 중단하면 이미지 생성 비용도 쓰지 않고 태그만 남긴다.
        if (typeof processImageTags === 'function' && !_tabGenStop) {
            setLoadingText(`🖼️ ${tabMeta.label} 이미지와 서식을 정리하고 있습니다...`);
            try {
                const processed = restoreLockedSections(await processImageTags(mod, resultText, { onStatus: setLoadingText, latest: () => latestTabMarkdown(mod, tabId, resultText) }), lockedBlocks);
                if (processed !== resultText) {
                    mod.tabContents[tabId] = processed;
                    mod.content = LESSON_TABS.map(t => (mod.tabContents[t.id] || '')).filter(Boolean).join('\n\n---\n\n');
                }
            } catch (imgErr) {
                console.warn('[TabGen] 이미지 처리 경고:', imgErr.message);
            }
        }

        await saveState();
        renderSidebar();
        if (!opts.background || isViewingTab(mod, tabId)) renderEditor(mod);
        else window.refreshLessonNav(mod);
        if (!_suppressTabAlert && !opts.quiet) {
            const doneText = stoppedEarly
                ? `${tabMeta.label} 생성을 중단했습니다. 받은 ${fullText.length.toLocaleString()}자까지 저장했습니다.${archivePartial ? ' 이전 내용은 작업 기록에 남겼습니다.' : ''}`
                : `${tabMeta.label} 탭이 생성되었습니다.`;
            // 화면을 막지 않고 만든 작업은 끝을 알림으로 알린다. 일부가 빠진 결과는 다시 만들어야 하므로 창으로 알린다
            if (partialDueToError) window.showAlert(partialError?.quota
                ? `${tabMeta.label} 탭은 만들었지만 뒷부분을 받지 못했습니다. ${partialError.message}`
                : `${tabMeta.label} 탭이 생성되었지만, API 호출 한도로 일부 단락이 누락되었을 수 있습니다. 잠시 후(1~2분) 다시 생성하면 전체 분량이 완성됩니다.`);
            else if (opts.background) window.notifyLessonJobDone?.(doneText, stoppedEarly ? 'warning' : 'success');
            else window.showAlert(doneText);
        }
        return { ok: true, partial: partialDueToError || stoppedEarly };
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
        return { ok: false, error: message };
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
    const outcome = await window.runLessonJob(moduleId, { label: '교안 탭 모두 다시 만들기', current: LESSON_TABS[0].id, total: LESSON_TABS.length }, async () => {
        for (let i = 0; i < LESSON_TABS.length; i++) {
            const tab = LESSON_TABS[i];
            window.updateLessonJob({ current: tab.id, label: tab.label, done: i });
            const result = await generateTabContent(moduleId, tab.id, { background: true, onStatus: window.setPipelineStatus });
            if (!result.ok) failed.push(tab.label);
            if (_tabGenStop) break;
            await new Promise(r => setTimeout(r, 2000));
        }
        return { ok: true };
    });
    if (outcome?.busy) return;
    if (_tabGenStop) return window.showAlert('전체 탭 생성을 중단했습니다. 받은 내용까지 저장했습니다.');
    if (failed.length) return window.showAlert(`${failed.join(', ')} 탭을 만들지 못했습니다. 그 탭에서 다시 생성해 주세요.`);
    window.notifyLessonJobDone('교안 탭을 모두 다시 만들었습니다. 이전 글은 작업 기록에 남았습니다.');
}

// 일괄 생성용: 빈 탭만 순서대로 채운다. 있는 탭은 건드리지 않고 첫 실패에서 멈춰 결과를 돌려준다.
// lockedByTab: 덮어쓰기로 비우기 전에 챙겨 둔 고정 섹션
async function fillMissingTabs(moduleId, { isStopped = () => false, onTab = () => {}, onStatus, lockedByTab = {} } = {}) {
    const mod = getEditingModule(moduleId);
    if (!mod) return { ok: false, error: '차시를 찾지 못했습니다.' };
    migrateMonolithicContent(mod); // 탭을 저장하면 mod.content를 다시 쓰므로 옛 단일 본문을 먼저 옮긴다
    const missing = lessonMissingTabs(mod);
    let partial = false;
    for (let i = 0; i < missing.length; i++) {
        if (isStopped()) return { ok: false, stopped: true, partial };
        onTab(LESSON_TABS.find(tab => tab.id === missing[i]), i, missing.length);
        const result = await generateTabContent(moduleId, missing[i], { quiet: true, onStatus, lockedBlocks: lockedByTab[missing[i]] });
        if (!result.ok) return { ok: false, partial, error: result.error, stopped: !!result.stopped };
        partial = partial || !!result.partial;
        await new Promise(r => setTimeout(r, 2000));
    }
    return { ok: true, partial };
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
    await window.runLessonJob(moduleId, { label: `${shownLabel} AI로 고치기`, current: tabId, alerts: true }, async () => {
        try {
            window.setPipelineStatus('AI가 고친 글을 받고 있습니다...');
            const systemInstruction = CONTEXT_CORE.personas.instructor +
                '\n[규칙]\n- 기존 교안 내용을 유지하면서, 사용자의 보강 명령에 따라 내용을 개선하세요.\n- 전체 구조와 서식은 보존하되, 요청된 부분만 보강·수정하세요.\n- ' +
                CONTEXT_CORE.rules.content_design + '\n- ' +
                CONTEXT_CORE.rules.korean_period + '\n- ' +
                (CONTEXT_CORE.rules.emoji_rule || '');

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

