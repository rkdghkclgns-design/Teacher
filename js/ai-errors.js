// ai-errors.js - AI 호출 오류를 한국어 한 줄과 '다음에 할 일'로 바꾼다
// 화면에는 이 문장만 보이고, 기술 내용(상태 코드·응답 원문)은 err.status·err.detail에 남겨 콘솔에만 찍는다.
// 상태 코드를 괄호로 덧붙여 두어, 문의할 때 원인을 바로 알 수 있게 한다. 테스트: tests/ai-errors.test.js

const AI_SETTINGS_HINT = '오른쪽 위 ⚙ 설정';
const AI_NO_RETRY = [400, 401, 403, 404];

const aiProviderOf = url => {
    const text = String(url || '');
    if (text.includes('generativelanguage.googleapis.com')) return 'Gemini';
    if (text.includes('anthropic.com')) return 'Claude';
    return 'AI';
};

function friendlyAiError(status, body = '', provider = 'AI') {
    const text = String(body || '');
    const key = `${provider === 'AI' ? 'AI' : provider} 키`;
    if (status === 0) return '인터넷에 연결되지 않았습니다. 연결을 확인한 뒤 다시 해 주세요.';
    if (status === 401 || (status === 400 && /API[_ ]KEY[_ ]INVALID|API key not valid|invalid.*api.?key/i.test(text))) {
        return `${key}가 맞지 않습니다(${status}). ${AI_SETTINGS_HINT}에서 키를 다시 넣고 '연결 확인'을 눌러 주세요.`;
    }
    if (status === 403) return `이 ${key}로는 고른 모델을 쓸 수 없습니다(403). ${AI_SETTINGS_HINT}에서 '빠르고 저렴하게'를 누르거나 키를 확인해 주세요.`;
    if (status === 404) return `고른 모델을 찾지 못했습니다(404). ${AI_SETTINGS_HINT}에서 다른 모델을 골라 주세요.`;
    if (status === 429) return `AI 사용 한도를 넘었습니다(429). 무료 키는 분당·하루 사용량이 정해져 있습니다. 잠시 뒤 다시 하거나 ${AI_SETTINGS_HINT}에서 '빠르고 저렴하게'를 눌러 주세요.`;
    if (status === 400) return `AI가 요청을 받지 못했습니다(400). 내용을 조금 줄이거나 ${AI_SETTINGS_HINT}에서 다른 모델을 골라 다시 해 주세요.`;
    if (status >= 500) return `AI 서버가 잠시 바쁩니다(${status}). 1~2분 뒤 다시 해 주세요.`;
    return `AI 호출에 실패했습니다(${status}). 잠시 뒤 다시 해 주세요.`;
}

// 화면용 문장을 담은 오류. 키·모델 문제(400·401·403·404)는 다시 시도해도 같으므로 바로 멈춘다
function aiError(status, body, provider) {
    const err = new Error(friendlyAiError(status, body, provider));
    err.status = status;
    err.detail = String(body || '').slice(0, 300);
    err.noRetry = AI_NO_RETRY.includes(status);
    return err;
}

// 키 연결 확인(모델 목록 조회)의 결과. 조회는 비용이 들지 않는다
function keyCheckResult(status) {
    if (status === 200) return { ok: true, text: '연결됨' };
    if (status === 0) return { ok: false, text: '확인하지 못했습니다(인터넷 연결 확인)' };
    if (status === 400 || status === 401) return { ok: false, text: '키가 맞지 않습니다' };
    if (status === 403) return { ok: false, text: '이 키로는 쓸 수 없습니다(권한 확인)' };
    if (status === 429) return { ok: true, text: '연결됨 · 지금은 사용 한도에 걸려 있습니다' };
    return { ok: false, text: `확인하지 못했습니다(${status})` };
}

if (typeof window !== 'undefined') {
    Object.assign(window, { friendlyAiError, aiError, aiProviderOf, keyCheckResult });
}
