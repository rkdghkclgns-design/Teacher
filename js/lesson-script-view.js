// lesson-script-view.js - 강사 대본 화면과 만들기. 기본학습·심화학습 머리줄의 '대본보기'를 누르면 교안 자리를 세로 2분할(왼쪽 교안, 오른쪽 대본)로 바꾼다
// 화면: #render-view를 숨기고 그 옆에 #lesson-script-view를 둔다. 줄(섹션)마다 한 칸(grid 두 칸)이라 섹션 글과 그 대본이 같은 높이에서 시작하고,
//  대본 칸은 그 줄 안에서 따라 내려온다(sticky, 넘치면 칸 안에서 굴린다). 왼쪽은 보기 화면과 같은 렌더(api.js drawLessonScreen)로 섹션마다 그린다.
//  두 번 눌러 고치기·접기·지우기·서식 막대·그림 다시 찾기는 #render-view에서만 돌므로 이 화면에서는 움직이지 않는다. 도구 메뉴·AI 명령줄·편집 안내는 숨긴다.
//  renderEditor가 다시 그리면(applyLessonScriptView) 같은 차시·탭일 때 다시 연다. 원문 전체 수정(toggleEditorMode('edit'))은 대본 화면을 닫는다(leaveLessonScriptView).
// 만들기: 처음 누를 때 대본이 없는 섹션 수와 비용·시간을 보이고 묻는다(cost-estimate.js). 확인하면 진행 막대(lesson-pipeline.js runLessonJob)에서
//  '대본 작성 중 (3/9)'로 한 섹션씩 쓰고 쓸 때마다 저장한다. 멈추거나 실패해도 쓴 섹션은 남고, 다시 누르면 없는 섹션만 이어서 쓴다.
//  교안이 바뀐 섹션은 그 섹션만 '다시 만들기'를 보인다. 계산은 lesson-script.js, 테스트: tests/lesson-script.test.js

const SCRIPT_VIEW_ID = 'lesson-script-view';
const SCRIPT_BUTTON_ID = 'lesson-script-btn';
const SCRIPT_CALL_GAP_MS = 2000; // 호출 사이에 쉰다(lesson-pipeline.js PIPELINE_COOLDOWN_MS와 같다. 분당 호출 한도)
const SCRIPT_BUTTON_CLASS = 'px-2.5 py-1.5 text-[0.6875rem] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded hover:bg-teal-100 transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap';
const SCRIPT_TEXT = {
    busy: '진행 중인 생성이 끝난 뒤 다시 시도해주세요.',
    empty: '이 탭에는 대본을 쓸 섹션이 없습니다. 먼저 탭을 만들어 주세요.',
    noKey: '글 모델 키가 없어 대본을 쓸 수 없습니다. 오른쪽 위 ⚙ 설정에서 키를 넣어 주세요.',
    moved: '묻는 동안 다른 차시나 탭으로 옮겨 대본을 쓰지 않았습니다.',
    none: '아직 쓴 대본이 없습니다. 대본보기를 눌러 대본을 먼저 만들어 주세요.',
    gone: '그사이 이 차시를 지우거나 옮겼거나, 백업·PC 폴더를 불러와 내용이 바뀌었습니다.',
    retry: "대본 화면에서 그 섹션의 '다시 만들기'를 누르거나 대본보기를 다시 누르면 남은 섹션만 씁니다."
};

let _scriptView = null;           // 열린 대본 화면 { moduleId, subjectId, tabId, source(그린 탭 글) }
let _scriptJob = null;            // 쓰는 중 { moduleId, subjectId, tabId, current(쓰는 줄 열쇠), pending(쓸 줄 열쇠) }
let _scriptFailures = new Map();  // '차시|탭|열쇠' → 쓰지 못한 까닭(다시 쓰면 지운다)
let _scriptAsking = false;        // 비용을 묻는 창이 떠 있다

const scriptFailKey = (mod, tabId, key) => `${mod?.id}|${tabId}|${key}`;
const scriptPanelOpen = () => typeof _lessonPanel !== 'undefined' && !!_lessonPanel;
const scriptTabText = (mod, tabId) => String(typeof tabSourceFor === 'function' ? tabSourceFor(mod, tabId) || '' : mod?.tabContents?.[tabId] || '');

// 그 차시·탭의 대본 화면이 열려 있는가(지금 연 교과에서)
const scriptViewOpenFor = (mod, tabId) => !!_scriptView && !!mod && _scriptView.moduleId === String(mod.id) && _scriptView.tabId === tabId && _scriptView.subjectId === currentSubjectId;
const scriptJobFor = (mod, tabId) => (_scriptJob && _scriptJob.moduleId === String(mod?.id) && _scriptJob.tabId === tabId ? _scriptJob : null);

/* ---------- 머리줄 단추 ---------- */
function scriptButtonInner(open) {
    return open ? '<i class="ph-bold ph-x"></i> 대본 닫기' : '<i class="ph-bold ph-scroll"></i> 대본보기';
}

const SCRIPT_BUTTON_TIPS = {
    open: '세로 2분할 대본 화면을 닫고 교안 화면으로 돌아갑니다',
    closed: '교안 옆에 섹션마다 강사가 그대로 읽을 수 있는 대본을 보입니다. 처음 누르면 AI 호출 수와 비용·시간을 보이고 물은 뒤 대본을 씁니다'
};

// 기본학습·심화학습 탭에만, 글이 있을 때만 둔다(api.js tabGenerateButtonsHtml이 이 탭 생성 앞에 넣는다). 최종 평가에는 두지 않는다
function lessonScriptButtonHtml(mod, tabId) {
    if (!mod || mod.id === 'mainQuest' || !isScriptTab(tabId) || !scriptTabText(mod, tabId).trim()) return '';
    const open = scriptViewOpenFor(mod, tabId);
    return `<button type="button" id="${SCRIPT_BUTTON_ID}" data-script-lesson="${scriptEscape(String(mod.id))}" data-script-tab="${tabId}" onclick="toggleLessonScript(this.dataset.scriptLesson, this.dataset.scriptTab)" aria-pressed="${open}" title="${SCRIPT_BUTTON_TIPS[open ? 'open' : 'closed']}" class="${SCRIPT_BUTTON_CLASS}">${scriptButtonInner(open)}</button>`;
}

function syncScriptButton() {
    const btn = document.getElementById(SCRIPT_BUTTON_ID);
    if (!btn) return;
    const mod = getEditingModule(btn.getAttribute('data-script-lesson'));
    const open = scriptViewOpenFor(mod, btn.getAttribute('data-script-tab'));
    btn.setAttribute('aria-pressed', String(open));
    btn.setAttribute('title', SCRIPT_BUTTON_TIPS[open ? 'open' : 'closed']);
    btn.innerHTML = scriptButtonInner(open);
}

/* ---------- 화면 ---------- */
// 왼쪽 칸: 보기 화면과 같은 렌더(그림·코드 블록·표). 그리지 못하면 글자로 보인다
function scriptLessonHtml(row, mod) {
    try {
        if (typeof drawLessonScreen === 'function') return drawLessonScreen(lessonScreenInput(row.text, mod.images), row.text, mod.images);
    } catch (err) {
        console.warn('[대본] 섹션을 그리지 못해 글자로 보입니다:', err?.message || err);
    }
    return `<pre class="whitespace-pre-wrap">${scriptEscape(row.text)}</pre>`;
}

const scriptActionButton = (action, key, label, { tone = '', disabled = false } = {}) =>
    `<button type="button" class="ls-btn${tone ? ` ls-btn-${tone}` : ''}" data-script-action="${action}"${key ? ` data-script-key="${scriptEscape(key)}"` : ''}${disabled ? ' disabled' : ''}>${label}</button>`;

// 오른쪽 칸: 시간 표시와 상태(쓰는 중·기다림·쓰지 못함·없음·교안이 바뀜)와 대본
function scriptCellHtml(mod, tabId, row, plan, span) {
    const state = plan.states.get(row.key);
    if (state === 'none') return `<p class="ls-none">${row.kind === 'frame' ? '이 부분은 따로 대본을 쓰지 않습니다.' : '대본을 쓸 글이 없습니다.'}</p>`;
    const job = scriptJobFor(mod, tabId);
    const busy = !!_scriptJob;
    const entry = plan.entries.get(row.key);
    const failed = _scriptFailures.get(scriptFailKey(mod, tabId, row.key));
    const redo = (label, tone) => scriptActionButton('regen', row.key, label, { tone, disabled: busy });
    const head = action => `<div class="ls-head"><span class="ls-time">${scriptEscape(scriptTimeText(row, span))}</span>${action}</div>`;
    if (job?.current === row.key) return `${head('')}<p class="ls-wait"><i class="ph-bold ph-circle-notch animate-spin"></i> 대본을 쓰고 있습니다…</p>${entry ? `<div class="ls-old">${scriptTextHtml(entry.text)}</div>` : ''}`;
    if (job?.pending.has(row.key)) return `${head('')}<p class="ls-wait">차례를 기다리고 있습니다.</p>${entry ? `<div class="ls-old">${scriptTextHtml(entry.text)}</div>` : ''}`;
    const fail = failed ? `<p class="ls-fail">대본을 쓰지 못했습니다: ${scriptEscape(failed)}</p>` : '';
    if (state === 'missing') return `${head(redo('이 섹션 대본 쓰기', 'main'))}${fail}${failed ? '' : '<p class="ls-empty">아직 대본이 없습니다.</p>'}`;
    if (state === 'outdated') {
        return `${head(redo('다시 만들기', 'warn'))}${fail}<p class="ls-stale">이 대본을 쓴 뒤 교안이 바뀌었습니다. 바뀐 내용에 맞추려면 다시 만드세요.</p><div class="ls-old">${scriptTextHtml(entry.text)}</div>`;
    }
    return `${head(redo('다시 만들기', ''))}${fail}${scriptTextHtml(entry.text)}`;
}

function scriptRowHtml(mod, tabId, row, plan, span) {
    const key = scriptEscape(row.key);
    return `<section class="lesson-script-row ls-${row.kind}" data-script-row="${key}">
        <div class="lesson-script-lesson markdown-body">${scriptLessonHtml(row, mod)}</div>
        <div class="lesson-script-side"><div class="lesson-script-card" data-script-cell="${key}">${scriptCellHtml(mod, tabId, row, plan, span)}</div></div>
    </section>`;
}

// 위 막대: 이름·센 수·빠진 대본 쓰기·내려받기·닫기와 안내
function scriptBarHtml(mod, tabId, plan) {
    const busy = !!_scriptJob;
    const counts = [
        `대본 ${plan.entries.size}/${plan.scripted.length}`,
        plan.outdated.length ? `교안이 바뀐 섹션 ${plan.outdated.length}개` : '',
        scriptJobFor(mod, tabId) ? '쓰는 중' : ''
    ].filter(Boolean).join(' · ');
    const fill = plan.missing.length && !scriptJobFor(mod, tabId) ? scriptActionButton('fill', '', `<i class="ph-bold ph-sparkle"></i> 빠진 대본 쓰기 (${plan.missing.length})`, { tone: 'main', disabled: busy }) : '';
    return `<div class="lesson-script-bar">
        <div class="ls-bar-title"><i class="ph-bold ph-scroll"></i> <b>${scriptEscape(scriptTabLabel(tabId))} 강사 대본</b> <span class="ls-bar-count" data-script-count>${scriptEscape(counts)}</span></div>
        <div class="ls-bar-actions">${fill}${scriptActionButton('download', '', '<i class="ph-bold ph-download-simple"></i> 대본 다운로드', { disabled: !plan.entries.size })}${scriptActionButton('close', '', '<i class="ph-bold ph-x"></i> 대본 닫기')}</div>
        <p class="ls-bar-note">${scriptEscape(`${SCRIPT_CUE_NOTE} ${SCRIPT_NOTE}`)}</p>
    </div>`;
}

function scriptViewHtml(mod, tabId, plan) {
    const times = scriptTimeline(plan.rows);
    const rows = plan.rows.map((row, i) => scriptRowHtml(mod, tabId, row, plan, times[i])).join('');
    return `<div data-script-bar>${scriptBarHtml(mod, tabId, plan)}</div><div class="lesson-script-cols" aria-hidden="true"><span>교안</span><span>강사 대본</span></div>${rows}`;
}

// 대본 화면에서 쓰지 않는 편집 도구를 숨기거나(hidden) 되돌린다. 단락 단추 묶음도 닫는다
function hideScriptEditingTools(hidden) {
    const menu = document.getElementById('lesson-tools-menu');
    if (menu) {
        if (hidden) menu.open = false;
        menu.classList.toggle('hidden', hidden);
    }
    document.getElementById('lesson-edit-hint')?.classList.toggle('hidden', hidden || scriptPanelOpen() || !!window.lessonEditHintHidden?.());
    document.getElementById('ai-command-bar')?.classList.toggle('hidden', hidden || scriptPanelOpen());
    if (hidden && typeof hideBlockTools === 'function') hideBlockTools();
}

// 대본 화면의 다이어그램도 보기 화면과 같은 방법으로 그린다(api.js drawLessonDiagrams, 새 차례로)
function drawScriptDiagrams(box) {
    if (typeof window === 'undefined' || !window.mermaid || typeof drawLessonDiagrams !== 'function' || typeof lessonDiagramPass === 'undefined') return;
    lessonDiagramPass += 1;
    const pass = lessonDiagramPass;
    setTimeout(() => drawLessonDiagrams(box, pass).catch(err => console.warn('[대본] 다이어그램을 그리다 멈췄습니다:', err?.message || err)), typeof LESSON_DIAGRAM_DELAY !== 'undefined' ? LESSON_DIAGRAM_DELAY : 200);
}

// 대본 화면을 (다시) 그린다. #render-view 바로 뒤에 두고 #render-view는 숨긴다
function drawLessonScriptView(mod) {
    const view = document.getElementById('render-view');
    if (!view || !_scriptView || !view.parentNode) return;
    document.getElementById(SCRIPT_VIEW_ID)?.remove();
    const tabId = _scriptView.tabId;
    const box = document.createElement('div');
    box.id = SCRIPT_VIEW_ID;
    box.className = 'lesson-script';
    box.innerHTML = scriptViewHtml(mod, tabId, lessonScriptPlan(mod, tabId));
    view.parentNode.insertBefore(box, view.nextSibling);
    view.classList.add('hidden');
    view.parentNode.classList.add('lesson-script-wide');
    hideScriptEditingTools(true);
    box.addEventListener('click', onScriptViewClick);
    window.applyLessonVideos?.(box, mod, { keepUrls: true }); // 직접 넣은 동영상(보기 화면의 재생 주소는 놓지 않는다)
    drawScriptDiagrams(box);
    _scriptView = { ..._scriptView, source: scriptTabText(mod, tabId) };
}

// 쓰는 동안 오른쪽 칸과 위 막대만 고친다(왼쪽 교안은 다시 그리지 않아 읽던 자리가 그대로다). 줄이 달라졌으면 통째로 다시 그린다
function refreshScriptCells(mod) {
    const box = document.getElementById(SCRIPT_VIEW_ID);
    if (!box || !_scriptView || !mod || !scriptViewOpenFor(mod, _scriptView.tabId) || getEditingModule(mod.id) !== mod) return;
    const tabId = _scriptView.tabId;
    const plan = lessonScriptPlan(mod, tabId);
    const cells = Array.from(box.querySelectorAll('[data-script-cell]'));
    const same = cells.length === plan.rows.length && cells.every((cell, i) => cell.getAttribute('data-script-cell') === plan.rows[i].key) && scriptTabText(mod, tabId) === _scriptView.source;
    if (!same) return drawLessonScriptView(mod);
    const times = scriptTimeline(plan.rows);
    cells.forEach((cell, i) => { cell.innerHTML = scriptCellHtml(mod, tabId, plan.rows[i], plan, times[i]); });
    const bar = box.querySelector('[data-script-bar]');
    if (bar) bar.innerHTML = scriptBarHtml(mod, tabId, plan);
}

function openLessonScriptView(mod, tabId) {
    _scriptView = { moduleId: String(mod.id), subjectId: currentSubjectId, tabId, source: '' };
    drawLessonScriptView(mod);
    syncScriptButton();
    document.getElementById('editor-content-area')?.scrollTo?.({ top: 0 });
}

// 대본 화면을 걷어 낸다(다시 그리지 않는다). 원문 전체 수정으로 갈 때(api.js toggleEditorMode)와 닫을 때 쓴다
window.leaveLessonScriptView = function () {
    const box = document.getElementById(SCRIPT_VIEW_ID);
    const wasOpen = !!_scriptView || !!box;
    _scriptView = null;
    if (!wasOpen) return;
    if (box) {
        box.parentNode?.classList.remove('lesson-script-wide');
        box.remove();
        document.getElementById('render-view')?.classList.remove('hidden'); // 원문 전체 수정은 이 뒤에 다시 숨긴다
    }
    hideScriptEditingTools(false);
    syncScriptButton();
};

function closeLessonScriptView(mod) {
    window.leaveLessonScriptView();
    if (mod && typeof renderEditor === 'function') renderEditor(mod);
}

// renderEditor가 화면을 다 그린 뒤 부른다. 같은 차시·탭이면 대본 화면을 다시 열고, 탭·차시를 바꿨거나 다른 항목(교수안 등)을 열었으면 닫는다
window.applyLessonScriptView = function (mod) {
    document.getElementById(SCRIPT_BUTTON_ID)?.classList.toggle('hidden', scriptPanelOpen());
    if (!_scriptView) return;
    const here = !!mod && !scriptPanelOpen() && typeof currentLessonTab !== 'undefined' && scriptViewOpenFor(mod, currentLessonTab)
        && getEditingModule(mod.id) === mod && !!scriptTabText(mod, currentLessonTab).trim();
    if (!here) return void window.leaveLessonScriptView();
    drawLessonScriptView(mod);
};

// 보기 모드를 다시 그린 뒤(api.js toggleEditorMode) 부른다. 대본 화면이 떠 있으면 보기 화면을 다시 숨기고, 그사이 탭 글이 바뀌었으면 대본 화면을 다시 그린다
window.keepLessonScriptView = function () {
    if (!_scriptView || !document.getElementById(SCRIPT_VIEW_ID)) return;
    const mod = getEditingModule(_scriptView.moduleId);
    if (!mod) return;
    if (scriptTabText(mod, _scriptView.tabId) !== _scriptView.source) return drawLessonScriptView(mod);
    document.getElementById('render-view')?.classList.add('hidden');
};

function onScriptViewClick(event) {
    const btn = event.target?.closest?.('[data-script-action]');
    if (!btn || btn.disabled || !_scriptView) return;
    const mod = getEditingModule(_scriptView.moduleId);
    if (!mod) return;
    const tabId = _scriptView.tabId;
    const action = btn.getAttribute('data-script-action');
    if (action === 'close') return closeLessonScriptView(mod);
    if (action === 'download') return window.downloadLessonScript(mod.id, tabId);
    if (action === 'fill') return startScriptWork(mod, tabId, lessonScriptPlan(mod, tabId).missing, { existing: true });
    if (action === 'regen') {
        const plan = lessonScriptPlan(mod, tabId);
        const row = plan.rows.find(item => item.key === btn.getAttribute('data-script-key') && item.scripted);
        if (row) startScriptWork(mod, tabId, [row], plan.entries.has(row.key) ? { replace: true } : { existing: true }); // 대본이 없는 섹션은 '이어서 씁니다'로 묻는다
    }
}

/* ---------- 묻기 ---------- */
// 다른 생성이 돌고 있는가(image-batch.js batchBusy와 같은 표시에 교수안 생성을 더한다)
function scriptBusy() {
    return !!window.isLessonPipelineRunning?.()
        || (typeof generationBusy === 'function' && !!generationBusy())
        || (typeof _lessonRun !== 'undefined' && !!_lessonRun)
        || (typeof _backfillRun !== 'undefined' && !!_backfillRun)
        || (typeof _gyosuanRunning !== 'undefined' && !!_gyosuanRunning)
        || !!window.isVolumeFilling?.();
}

// 묻는 창의 글. existing: 이미 쓴 대본이 있다(이어서 쓴다) · replace: 고른 줄의 대본을 다시 쓴다
function scriptConfirmText(tabId, rows, { existing = false, replace = false } = {}) {
    const label = scriptTabLabel(tabId);
    const units = rows.reduce((sum, row) => sum + scriptRowUnits(row).length, 0);
    const chunked = rows.filter(row => scriptRowUnits(row).length > 1).length;
    const names = rows.map(scriptRowName);
    const listed = names.length <= 3 ? `(${names.join(', ')})` : '';
    const head = replace
        ? `«${names.join(', ')}» 대본을 다시 씁니다. 지금 대본은 새 대본으로 바뀝니다.`
        : existing
            ? `«${label}» 탭에서 아직 대본이 없는 섹션 ${rows.length}개${listed}의 대본을 이어서 씁니다. 이미 쓴 대본은 그대로 둡니다.`
            : `«${label}» 탭의 섹션 ${rows.length}개${listed}에 강의 경험이 없어도 그대로 읽을 수 있는 강사 대본을 씁니다(수업 시작·마무리 포함). 섹션마다 들어가며·강의·넘어가며 말과 [화면]·[판서] 같은 행동 지시, 시간 표시, 예상 질문, 막힐 때 할 일을 담습니다.`;
    const calls = chunked
        ? `길어서 소주제로 나눠 쓰는 섹션이 ${chunked}개라 AI 호출은 ${units}번입니다(형식이 맞지 않는 답은 한 번 더 받습니다).`
        : `AI 호출은 섹션마다 한 번씩 ${units}번입니다(형식이 맞지 않는 답은 한 번 더 받습니다).`;
    const tail = replace ? '' : ' 다 쓰면 다음부터 대본보기를 누를 때 바로 열립니다. 쓰는 동안 오른쪽 아래 막대에서 언제든 멈출 수 있고, 멈춰도 다 쓴 섹션은 남습니다.';
    return { message: `${head} ${calls}${tail}`, units };
}

function confirmScriptWork(tabId, rows, opts) {
    const { message, units } = scriptConfirmText(tabId, rows, opts);
    const title = `${scriptTabLabel(tabId)} 대본 ${opts.replace ? '다시 쓰기' : '쓰기'}`;
    const options = { title, okLabel: '대본 쓰기' };
    return typeof confirmWithEstimate === 'function' ? confirmWithEstimate(message, { lessonScripts: units }, options) : confirmAsync(message, options);
}

// 원문 칸·단락 편집 상자에서 고치던 글을 먼저 탭에 넣는다(image-batch.js saveBatchOpenEdits와 같다)
function commitScriptEdits(mod, tabId) {
    if (typeof saveOpenEditsFor === 'function') saveOpenEditsFor(mod, tabId);
    const input = document.querySelector('#render-view .para-edit textarea');
    if (input && typeof Event === 'function') input.dispatchEvent(new Event('blur'));
}

const scriptStillHere = (mod, tabId) => getEditingModule(mod.id) === mod && currentLessonTab === tabId && !scriptPanelOpen();

// 비용을 묻고 대본을 쓴다. 쓴 대본이 있는 화면이면 거절해도 화면은 그대로다. 썼으면 true
async function startScriptWork(mod, tabId, rows, opts = {}) {
    if (!rows.length || _scriptAsking) return false; // 묻는 창이 이미 떠 있으면 또 묻지 않는다(두 번 눌러 일이 둘 생기지 않게)
    if (scriptBusy() || _scriptJob) return void window.showAlert(SCRIPT_TEXT.busy);
    if (typeof textModelHasKey === 'function' && !textModelHasKey()) return void window.showAlert(SCRIPT_TEXT.noKey);
    _scriptAsking = true;
    let ok = false;
    try {
        ok = await confirmScriptWork(tabId, rows, opts);
    } finally {
        _scriptAsking = false;
    }
    if (!ok) return false;
    if (!scriptStillHere(mod, tabId)) return void window.showToast?.(SCRIPT_TEXT.moved, 'warning');
    if (scriptBusy() || _scriptJob) return void window.showAlert(SCRIPT_TEXT.busy); // 묻는 사이 시작된 생성
    if (!scriptViewOpenFor(mod, tabId)) openLessonScriptView(mod, tabId);
    await runScriptJob(mod, tabId, rows.map(row => row.key));
    return true;
}

// 머리줄 '대본보기' · '대본 닫기'. 대본이 모두 있으면(또는 쓰는 중이면) 바로 열고, 없는 섹션이 있으면 비용을 묻고 쓴다
window.toggleLessonScript = async function (moduleId, tabId = currentLessonTab) {
    const mod = getEditingModule(moduleId);
    if (!mod) return;
    if (scriptViewOpenFor(mod, tabId)) return closeLessonScriptView(mod);
    if (!isScriptTab(tabId) || mod.id === 'mainQuest') return;
    commitScriptEdits(mod, tabId);
    const plan = lessonScriptPlan(mod, tabId);
    if (!plan.scripted.length) return window.showAlert(SCRIPT_TEXT.empty);
    const some = plan.entries.size > 0;
    if (!plan.missing.length || scriptJobFor(mod, tabId)) return openLessonScriptView(mod, tabId);
    if (scriptBusy() || _scriptJob) {
        if (some) openLessonScriptView(mod, tabId);
        return window.showAlert(SCRIPT_TEXT.busy);
    }
    const wrote = await startScriptWork(mod, tabId, plan.missing, { existing: some });
    if (!wrote && some && scriptStillHere(mod, tabId) && !scriptViewOpenFor(mod, tabId)) openLessonScriptView(mod, tabId); // 묻는 창을 닫아도 쓴 대본은 본다
};

/* ---------- 쓰기 ---------- */
const scriptJobStopped = job => !!job.run?.stopped || !!window.isTabGenerationStopped?.();
// 원문 칸에서 그 탭을 고치던 글을 먼저 넣는다(tabs.js saveOpenEditsFor)
const commitScriptRaw = job => typeof saveOpenEditsFor === 'function' && saveOpenEditsFor(job.mod, job.tabId);
const scriptErrorHalts = err => !!err?.noRetry || (typeof aiErrorStopsRun === 'function' && aiErrorStopsRun(err));

function scriptRetryNotice({ delayMs, isRateLimit } = {}) {
    const sec = Math.round((delayMs || 0) / 1000);
    window.setPipelineStatus?.(isRateLimit ? `⏳ API 호출 한도에 도달했습니다. ${sec}초 후 자동으로 다시 시도합니다...` : `⏳ 일시적인 응답 지연이 발생했습니다. ${sec}초 후 자동으로 다시 시도합니다...`);
}

// AI 답 { text(생각 글을 뺀 답), truncated(출력 한도에서 잘렸다) }. 중지하면 받던 답을 끊는다
async function askScriptModel(prompt) {
    const data = await callGemini(TEXT_MODEL, {
        taskRole: 'write',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: scriptSystemInstruction() }] },
        generationConfig: { maxOutputTokens: SCRIPT_MAX_TOKENS },
        signal: window.aiStopSignal?.() || null
    }, scriptRetryNotice);
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    return { text: parts.filter(part => !part.thought).map(part => part.text || '').join(''), truncated: candidate?.finishReason === 'MAX_TOKENS' };
}

// 조각 하나를 받는다. 형식이 망가진 답은 까닭을 적어 한 번 더 받는다 → 읽은 대본 | { error } | { stopped }. 호출 오류는 던진다
async function askScriptUnit(job, unit, context) {
    const opts = { kind: unit.row.kind, needIntro: unit.part === 0, needOutro: unit.part === unit.parts - 1, target: scriptSpeechChars(unit.minutes) };
    let again = '';
    let read = { error: '답을 받지 못했습니다.' };
    for (let attempt = 0; attempt < 2; attempt++) {
        if (job.calls > 0) await waitMs(SCRIPT_CALL_GAP_MS, window.aiStopSignal?.() || null).catch(() => {}); // 중지하면 다 기다리지 않는다
        if (scriptJobStopped(job)) return { stopped: true };
        job.calls += 1;
        let answer;
        try {
            answer = await askScriptModel(buildScriptPrompt(unit, { ...context, again }));
        } catch (err) {
            if (err?.name === 'AbortError' || scriptJobStopped(job)) return { stopped: true };
            throw err;
        }
        read = parseScriptAnswer(answer.text, { ...opts, truncated: answer.truncated });
        if (!read.error) return read;
        console.warn(`[대본] ${scriptRowName(unit.row)} 답을 받지 않았습니다(${attempt + 1}번째): ${read.error}`);
        again = read.error;
    }
    return read;
}

// 프롬프트에 넣는 앞뒤 이름(대본을 쓰는 줄끼리)과 차시 제목·수업 순서
function scriptPromptContext(mod, tabId, plan, row) {
    const scripted = plan.rows.filter(item => item.scripted);
    const at = scripted.indexOf(row);
    return {
        lessonTitle: scriptLessonTitle(plan.rows, mod), tabLabel: scriptTabLabel(tabId),
        prevTitle: at > 0 ? scriptRowName(scripted[at - 1]) : '', nextTitle: at >= 0 && at < scripted.length - 1 ? scriptRowName(scripted[at + 1]) : '',
        outline: plan.rows.filter(item => item.kind === 'content').map(scriptRowName)
    };
}

// 줄 하나의 대본을 쓰고 넣는다 → { status: made | bad | stop | gone | lost(차시가 사라짐), error, halt }
async function writeRowScript(job, plan, row) {
    const context = scriptPromptContext(job.mod, job.tabId, plan, row);
    const parts = [];
    for (const unit of scriptRowUnits(row)) {
        const read = await askScriptUnit(job, unit, context);
        if (read.stopped) return { status: 'stop' };
        if (read.error) return { status: 'bad', error: read.error };
        parts.push(read);
    }
    const text = scriptTextFrom(joinScriptParts(parts));
    if (text.length > SCRIPT_TEXT_CHARS) return { status: 'bad', error: `대본이 너무 깁니다(${text.length.toLocaleString('ko-KR')}자). 섹션을 나눈 뒤 다시 만들어 주세요.` }; // 저장 고르기가 버리는 크기
    if (!lessonStillLive(job.subj, job.mod)) return { status: 'lost' };
    commitScriptRaw(job);
    // 쓰는 동안 그 섹션을 지웠거나 제목을 바꿨으면 넣지 않는다. 글만 고쳤으면 쓴 때의 지문으로 넣어 화면이 '교안이 바뀜'을 보인다
    const now = lessonScriptPlan(job.mod, job.tabId);
    if (!now.rows.some(item => item.key === row.key && item.scripted)) return { status: 'gone' };
    job.mod.lessonScripts = withLessonScript(job.mod, job.tabId, { key: row.key, title: scriptRowName(row), sourceHash: row.hash, text }, now.rows);
    const saved = await saveState();
    return { status: 'made', halt: saved === false ? 'save' : '' };
}

const withoutPending = (key, next = {}) => (_scriptJob ? { ..._scriptJob, ...next, pending: new Set([..._scriptJob.pending].filter(item => item !== key)) } : null);

// 고른 줄을 차례로 쓴다. 줄마다 지금 탭 글을 다시 읽는다(쓰는 동안 고친 글을 쓴다). 멈춤·차시 사라짐·저장 실패·같은 까닭으로 실패할 오류면 거기서 멈춘다
async function writeScripts(job) {
    for (let k = 0; k < job.keys.length; k++) {
        if (job.halt || scriptJobStopped(job)) return;
        if (!lessonStillLive(job.subj, job.mod)) return void (job.halt = { kind: 'gone' });
        commitScriptRaw(job);
        const plan = lessonScriptPlan(job.mod, job.tabId);
        const row = plan.rows.find(item => item.key === job.keys[k] && item.scripted);
        if (!row) {
            job.stats.gone += 1;
            _scriptJob = withoutPending(job.keys[k]);
            continue;
        }
        _scriptJob = { ..._scriptJob, current: row.key };
        window.updateLessonJob?.({ done: k, current: job.tabId, status: `대본 작성 중 (${k + 1}/${job.keys.length}) · ${scriptRowName(row)}` });
        refreshScriptCells(job.mod);
        let outcome;
        try {
            outcome = await writeRowScript(job, plan, row);
        } catch (err) {
            outcome = scriptJobStopped(job) || err?.name === 'AbortError'
                ? { status: 'stop' }
                : { status: 'bad', error: err?.message || String(err), halt: scriptErrorHalts(err) ? 'error' : '' };
        }
        _scriptJob = withoutPending(row.key, { current: '' });
        const failKey = scriptFailKey(job.mod, job.tabId, row.key);
        if (outcome.status === 'stop') return void refreshScriptCells(job.mod);
        if (outcome.status === 'lost') return void (job.halt = { kind: 'gone' });
        if (outcome.status === 'made') {
            job.stats.made += 1;
            _scriptFailures = new Map([..._scriptFailures].filter(([key]) => key !== failKey));
        } else if (outcome.status === 'gone') {
            job.stats.gone += 1;
        } else {
            job.stats.failed += 1;
            job.errors = [...job.errors, outcome.error];
            _scriptFailures = new Map(_scriptFailures).set(failKey, outcome.error);
        }
        if (outcome.halt === 'save') job.halt = { kind: 'save' };
        if (outcome.halt === 'error') job.halt = { kind: 'error', message: outcome.error };
        refreshScriptCells(job.mod);
    }
}

// 끝 알림 [글, 종류]
function scriptDoneNotice(job) {
    const label = `${scriptTabLabel(job.tabId)} 대본`;
    if (job.halt?.kind === 'gone') return [`${label} 쓰기를 멈췄습니다. ${SCRIPT_TEXT.gone}`, 'warning'];
    const { made, failed, gone } = job.stats;
    const left = Math.max(0, job.keys.length - made - failed - gone);
    const text = [
        made ? `섹션 ${made}개의 대본을 썼습니다.` : '쓴 대본은 없습니다.',
        failed ? `${failed}개는 쓰지 못했습니다(${job.errors[0]}). ${SCRIPT_TEXT.retry}` : '',
        gone ? `${gone}개는 쓰는 동안 그 섹션이 지워지거나 제목이 바뀌어 넣지 않았습니다.` : '',
        left ? `${left}개는 아직 쓰지 않았습니다. 대본보기를 다시 누르면 남은 섹션만 이어서 씁니다.` : ''
    ].filter(Boolean).join(' ');
    if (job.halt?.kind === 'save') return [`저장하지 못해 ${label} 쓰기를 멈췄습니다. ${text} ${typeof SAVE_AGAIN_HINT !== 'undefined' ? SAVE_AGAIN_HINT : ''}`.trim(), 'error'];
    if (job.halt?.kind === 'error') return [`${label} 쓰기를 멈췄습니다. ${text}`, 'error'];
    if (scriptJobStopped(job)) return [`${label} 쓰기를 멈췄습니다. ${text}`, 'warning'];
    return [`${label} 쓰기를 마쳤습니다. ${text}`, failed || gone ? 'warning' : 'success'];
}

// 진행 막대에서 고른 줄의 대본을 쓴다(다른 생성이 돌면 runLessonJob이 알리고 멈춘다)
async function runScriptJob(mod, tabId, keys) {
    const subj = globalState.subjects.find(item => item.id === currentSubjectId);
    const job = { subj, mod, tabId, keys, calls: 0, stats: { made: 0, failed: 0, gone: 0 }, errors: [], halt: null, run: null };
    _scriptJob = { moduleId: String(mod.id), subjectId: currentSubjectId, tabId, current: '', pending: new Set(keys) };
    refreshScriptCells(mod);
    try {
        await window.runLessonJob(mod.id, { label: `${scriptTabLabel(tabId)} 대본 작성`, current: tabId, total: keys.length }, async run => {
            job.run = run;
            try {
                await writeScripts(job);
            } catch (err) {
                console.error('[대본] 쓰다가 멈췄습니다:', err);
                job.halt = job.halt || { kind: 'error', message: err?.message || String(err) };
            }
            window.notifyLessonJobDone(...scriptDoneNotice(job));
        });
    } finally {
        _scriptJob = null;
        refreshScriptCells(mod);
    }
    return job;
}

/* ---------- 내려받기 ---------- */
// '{차시 파일 이름}_{기본학습|심화학습}_대본.md'로 받는다(기본 저장 폴더를 골랐으면 그 폴더, course-sessions.js downloadMd)
window.downloadLessonScript = function (moduleId, tabId = currentLessonTab) {
    const mod = getEditingModule(moduleId);
    if (!mod || !isScriptTab(tabId)) return;
    if (!lessonScriptPlan(mod, tabId).entries.size) return window.showAlert(SCRIPT_TEXT.none);
    downloadMd(lessonScriptMarkdown(mod, tabId), lessonScriptFileName(mod, tabId));
};

if (typeof window !== 'undefined') Object.assign(window, { lessonScriptButtonHtml, scriptConfirmText, scriptDoneNotice });
