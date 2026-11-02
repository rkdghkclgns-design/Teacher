// ai-routing.js - 역할별 AI 분배: Gemini와 Claude 키가 모두 있을 때 작업마다 어느 모델을 쓸지 정한다
// 역할과 배정은 develocket-slide(assets/ai-config.js MIXED_ROUTE @3a7303f)를 따른다.
// 원본은 키가 둘이면 자동으로 나누지만, 여기서는 고른 모델 대신 다른 공급자를 호출해 비용이 달라지므로 설정에서 켠 경우에만 나눈다.

const CROSS_MODELS = { gemini: 'gemini-4-argon', claude: 'claude-opus-5-5' };
const ROLE_PROVIDERS = { plan: 'claude', write: 'claude', fast: 'gemini', qgen: 'gemini', review: 'claude' };
const ROLE_LABELS = { plan: '구조 설계', write: '본문 작성', fast: '슬라이드·요약', qgen: '문항 생성', review: '교차 검수' };

let ROLE_ROUTING = false;
try {
    ROLE_ROUTING = localStorage.getItem('role_routing') === '1';
} catch (e) { }

const isRoleRouted = () => ROLE_ROUTING && !!apiKey && !!claudeApiKey;
const modelProvider = model => (isClaudeModel(model) ? 'claude' : 'gemini');

// 고른 모델과 같은 공급자가 맡는 역할은 고른 모델을 그대로 쓴다. 역할을 적지 않은 호출은 본문 작성이다
function roleModel(taskRole) {
    if (!isRoleRouted()) return TEXT_MODEL;
    const provider = ROLE_PROVIDERS[taskRole] || ROLE_PROVIDERS.write;
    return provider === modelProvider(TEXT_MODEL) ? TEXT_MODEL : CROSS_MODELS[provider];
}

// 그 역할을 맡은 모델과 다른 공급자의 키가 있으면 교차 판단에 쓸 모델을 돌려준다
function crossCheckModel(taskRole) {
    const other = modelProvider(roleModel(taskRole)) === 'claude' ? 'gemini' : 'claude';
    const hasKey = other === 'claude' ? claudeApiKey : apiKey;
    return hasKey ? CROSS_MODELS[other] : '';
}

function roleRouteNote() {
    if (!ROLE_ROUTING) return '';
    if (!isRoleRouted()) return 'Gemini와 Claude 키를 모두 저장하면 적용됩니다. 지금은 위에서 고른 모델로 처리합니다.';
    const roles = Object.keys(ROLE_LABELS);
    return [...new Set(roles.map(role => roleModel(role)))]
        .map(model => `${model}: ${roles.filter(role => roleModel(role) === model).map(role => ROLE_LABELS[role]).join('·')}`)
        .join(' / ');
}

function renderRoleRouteNote() {
    const note = document.getElementById('settings-role-route');
    if (note) note.textContent = roleRouteNote();
}

function updateRoleRouting(enabled) {
    ROLE_ROUTING = !!enabled;
    try { localStorage.setItem('role_routing', ROLE_ROUTING ? '1' : '0'); } catch (e) { }
    renderRoleRouteNote();
}
