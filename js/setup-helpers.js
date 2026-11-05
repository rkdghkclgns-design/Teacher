// setup-helpers.js - 처음 쓰는 사람이 바로 성공하게
// 설정 빠른 선택(빠르고 저렴하게 / 품질 우선: 글 모델·추론 강도·그림 양·그림 모델), 키 연결 확인(모델 목록 조회라 비용 없음), 키에 맞춘 글 모델 자동 선택,
// 과정 정보(과정명·분야) 편집과 예시 과정 표시. 계산만 하는 함수는 tests/setup-helpers.test.js가 확인한다.

const SETTINGS_PRESETS = {
    // 빠르고 저렴하게: 무료 키로도 되는 글 모델. 그림은 글 모델이 SVG로 그려 그림 요금이 없고 무료 키에서도 그려진다
    saving: { gemini: 'gemini-3.8-flash', claude: 'claude-haiku-5-5', effort: 'medium', images: 'section', imageModel: 'svg-illustration' }, // = SVG_IMAGE_MODEL (data.js)
    quality: { gemini: 'gemini-4-argon', claude: 'claude-fable-5-1', effort: 'high', images: 'all', imageModel: 'gemini-nano-banana-2.1' } // = IMAGE_MODEL_OPTIONS[0] (data.js)
};
const FALLBACK_MODELS = { gemini: 'gemini-3.8-flash', claude: 'claude-sonnet-5-5' };
const EXAMPLE_COURSE_ID = 'course_mock_1';
const CLAUDE_MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1';

/* ---------- 계산 ---------- */
// Gemini 키가 있으면 Gemini, Claude 키만 있으면 Claude
const presetProvider = (hasGemini, hasClaude) => (!hasGemini && hasClaude ? 'claude' : 'gemini');

function presetValues(name, hasGemini, hasClaude) {
    const preset = SETTINGS_PRESETS[name];
    if (!preset) return null;
    return { textModel: preset[presetProvider(hasGemini, hasClaude)], effort: preset.effort, images: preset.images, imageModel: preset.imageModel };
}

// 지금 설정과 같은 묶음(버튼을 눌린 모양으로 보여 줄 때)
function activePreset(current, hasGemini, hasClaude) {
    return Object.keys(SETTINGS_PRESETS).find(name => {
        const values = presetValues(name, hasGemini, hasClaude);
        return values.textModel === current.textModel && values.effort === current.effort && values.images === current.images && values.imageModel === current.imageModel;
    }) || null;
}

// 고른 글 모델에 맞는 키가 없고 다른 키만 있으면 그 키의 모델로 바꾼다. 바꿀 필요가 없으면 null
function autoTextModel(model, hasGemini, hasClaude, isClaude) {
    const claudeModel = isClaude(model);
    if (claudeModel && !hasClaude && hasGemini) return FALLBACK_MODELS.gemini;
    if (!claudeModel && !hasGemini && hasClaude) return FALLBACK_MODELS.claude;
    return null;
}

// 분야를 넣기 전에 만든 과정은 과정명에서 분야를 읽는다: '게임 기획 전문가 양성 과정' → '게임 기획'
function fieldFromCourseTitle(title) {
    const field = String(title || '').replace(/\s*(전문가)?\s*(양성)?\s*(과정|교육|훈련|코스)\s*$/u, '').trim();
    return field.length >= 2 && !/^(새로운|이름 없는|제목 없음)$/.test(field) ? field : '';
}

// 예시 과정인지: 표시를 단 상태이거나, 표시가 생기기 전에 저장한 예시 과정(같은 과정 id)
const isExampleCourse = state => !!state && (state.isExample === true || (state.isExample !== false && state.courseId === EXAMPLE_COURSE_ID));

/* ---------- 설정 빠른 선택 ---------- */
function syncSettingSelects() {
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
    set('settings-text-model', TEXT_MODEL);
    set('settings-reasoning-effort', REASONING_EFFORT);
    set('settings-image-amount', LESSON_IMAGE_AMOUNT);
    set('settings-image-model', IMAGE_MODEL);
    window.renderRoleRouteNote?.();
}

function renderPresetButtons() {
    const active = activePreset({ textModel: TEXT_MODEL, effort: REASONING_EFFORT, images: LESSON_IMAGE_AMOUNT, imageModel: IMAGE_MODEL }, !!apiKey, !!claudeApiKey);
    document.querySelectorAll('[data-settings-preset]').forEach(button => {
        const on = button.dataset.settingsPreset === active;
        button.setAttribute('aria-pressed', on ? 'true' : 'false'); // 눌린 모양은 index.html의 [aria-pressed] CSS
    });
}

function applySettingsPreset(name) {
    const values = presetValues(name, !!apiKey, !!claudeApiKey);
    if (!values) return;
    updateTextModel(values.textModel);
    updateReasoningEffort(values.effort);
    updateLessonImageAmount(values.images);
    updateImageModel(values.imageModel);
    syncSettingSelects();
    renderPresetButtons();
    const label = TEXT_MODEL_OPTIONS.find(option => option.value === values.textModel)?.label || values.textModel;
    const imageLabel = String(IMAGE_MODEL_OPTIONS.find(option => option.value === values.imageModel)?.label || values.imageModel).replace(/\s*\(.*\)\s*$/, '');
    // Gemini 키가 없으면 고른 그림 모델 대신 글 모델이 SVG로 그린다(course-art.js usesSvgIllustration)
    const svgNote = values.imageModel !== SVG_IMAGE_MODEL && typeof usesSvgIllustration === 'function' && usesSvgIllustration() ? ' Gemini 키가 없어 그림은 글 모델이 SVG로 그립니다.' : '';
    window.showToast?.(`${name === 'saving' ? '빠르고 저렴하게' : '품질 우선'}: 글은 ${label}, 그림은 ${imageLabel}로 맞췄습니다.${svgNote}`, 'success');
}

/* ---------- 키 연결 확인 ---------- */
const KEY_STATUS_IDS = { gemini: ['api-key-status-dot', 'api-key-status-text'], claude: ['claude-key-status-dot', 'claude-key-status-text'] };
const KEY_STATUS_COLORS = { ok: 'bg-emerald-400', bad: 'bg-red-400', checking: 'bg-amber-400 animate-pulse', none: 'bg-red-400' };

function setKeyStatus(provider, state, text) {
    const [dotId, textId] = KEY_STATUS_IDS[provider];
    const dot = document.getElementById(dotId);
    const label = document.getElementById(textId);
    if (dot) dot.className = `w-1.5 h-1.5 rounded-full ${KEY_STATUS_COLORS[state]}`;
    if (label) {
        label.textContent = text;
        label.classList.toggle('text-red-300', state === 'bad');
        label.classList.toggle('text-emerald-300', state === 'ok');
    }
}

// 모델 목록만 조회한다(생성 호출이 아니라 비용이 들지 않는다)
async function checkAiKey(provider, key) {
    if (!key) return { ok: false, text: '키를 넣어 주세요' };
    if (/[^\x21-\x7e]/.test(key)) return { ok: false, text: '키에 쓸 수 없는 글자(공백·한글 등)가 있습니다' }; // 헤더에 못 실어 fetch가 실패한다
    try {
        const res = provider === 'claude'
            ? await fetch(CLAUDE_MODELS_URL, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } })
            : await fetch(`${GEMINI_API_BASE}?pageSize=1`, { headers: { 'x-goog-api-key': key } });
        return keyCheckResult(res.status);
    } catch (err) {
        console.warn('[키 확인] 연결 실패:', err.message);
        return keyCheckResult(0);
    }
}

const keyCheckRuns = { gemini: 0, claude: 0 };

async function verifyAiKey(provider) {
    const key = provider === 'claude' ? claudeApiKey : apiKey;
    if (!key) return setKeyStatus(provider, 'none', '키 없음');
    const run = ++keyCheckRuns[provider];
    setKeyStatus(provider, 'checking', '연결 확인 중...');
    const result = await checkAiKey(provider, key);
    if (run === keyCheckRuns[provider]) setKeyStatus(provider, result.ok ? 'ok' : 'bad', result.text); // 늦게 온 예전 확인 결과는 버린다
    return result;
}

// 키를 저장한 뒤: 키에 맞게 글 모델을 고르고, 바로 연결을 확인한다
async function afterAiKeySaved(provider) {
    const next = autoTextModel(TEXT_MODEL, !!apiKey, !!claudeApiKey, isClaudeModel);
    if (next) {
        updateTextModel(next);
        syncSettingSelects();
        const label = TEXT_MODEL_OPTIONS.find(option => option.value === next)?.label || next;
        window.showToast?.(`글 생성 모델을 ${label}로 바꿨습니다(가진 키에 맞춤).`, 'info');
    }
    renderPresetButtons();
    return verifyAiKey(provider);
}

/* ---------- 과정 정보(과정명·분야)와 예시 표시 ---------- */
function renderCourseInfo() {
    const badge = document.getElementById('overview-example-badge');
    if (badge) badge.classList.toggle('hidden', !isExampleCourse(globalState));
    const field = document.getElementById('overview-course-field');
    if (!field) return;
    const saved = globalState?.courseField;
    const read = typeof saved === 'string' ? saved : fieldFromCourseTitle(globalState?.courseTitle);
    field.textContent = read
        ? `분야: ${read}${typeof saved === 'string' ? '' : ' (과정명에서 읽음)'}`
        : '분야를 넣으면 AI가 그 분야 강사로 씁니다';
}

function openCourseInfo() {
    if (document.getElementById('course-info-dialog')) return;
    const overlay = document.createElement('div');
    overlay.id = 'course-info-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999]';
    overlay.innerHTML = `
        <form class="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[400px] max-w-[92vw] p-6 shadow-2xl flex flex-col gap-3" onclick="event.stopPropagation()">
            <h3 class="font-bold text-white text-sm flex items-center gap-2"><i class="ph-fill ph-graduation-cap text-accent text-lg"></i> 과정 정보</h3>
            ${isExampleCourse(globalState) ? '<p class="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">지금은 둘러보기용 예시 과정입니다. 내 과정 이름과 분야로 바꾸면 예시 표시가 사라집니다.</p>' : ''}
            <label class="text-xs font-bold text-textMuted">과정명
                <input name="courseTitle" required maxlength="80" class="mt-1 w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent" placeholder="예: 간호 실무 전문가 양성 과정">
            </label>
            <label class="text-xs font-bold text-textMuted">분야
                <input name="courseField" maxlength="40" class="mt-1 w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent" placeholder="예: 간호, 회계, 웹 개발, 게임 기획">
                <span class="block mt-1 font-normal text-[0.6875rem] text-textMuted">AI가 교안을 쓸 때 이 분야의 전문 강사로 씁니다. 비우면 직업훈련 강사로 씁니다.</span>
            </label>
            <div class="flex justify-end gap-2 mt-1">
                <button type="button" data-course-info="cancel" class="px-4 py-2 text-xs font-bold text-textLight bg-white/5 hover:bg-white/10 rounded-lg">취소</button>
                <button type="submit" class="px-4 py-2 text-xs font-bold text-white bg-accent hover:bg-accentHover rounded-lg">저장</button>
            </div>
        </form>`;
    const form = overlay.querySelector('form');
    const { courseTitle, courseField } = form.elements; // form.title은 폼 자체의 title 속성이라 elements로 읽는다
    courseTitle.value = globalState.courseTitle || '';
    courseField.value = typeof globalState.courseField === 'string' ? globalState.courseField : fieldFromCourseTitle(globalState.courseTitle);
    const close = () => overlay.remove();
    overlay.addEventListener('click', close);
    overlay.querySelector('[data-course-info="cancel"]').addEventListener('click', close);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const title = courseTitle.value.trim();
        if (!title) return;
        globalState.courseTitle = title;
        globalState.courseField = courseField.value.trim();
        globalState.isExample = false;
        await saveState();
        close();
        if (typeof renderOverview === 'function') renderOverview();
        renderCourseInfo();
        window.showToast?.('과정 정보를 저장했습니다.', 'success');
    });
    document.body.appendChild(overlay);
    courseTitle.focus();
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        presetValues, activePreset, autoTextModel, isExampleCourse, fieldFromCourseTitle, applySettingsPreset, renderPresetButtons,
        verifyAiKey, afterAiKeySaved, renderCourseInfo, openCourseInfo
    });
}
