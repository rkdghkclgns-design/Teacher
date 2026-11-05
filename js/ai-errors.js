// ai-errors.js - AI 호출 오류를 한국어 한 줄과 '다음에 할 일'로 바꾼다
// 화면에는 이 문장만 보이고, 기술 내용(상태 코드·응답 원문)은 err.status·err.detail에 남겨 콘솔에만 찍는다.
// 상태 코드를 괄호로 덧붙여 두어, 문의할 때 원인을 바로 알 수 있게 한다. 테스트: tests/setup-helpers.test.js

const AI_SETTINGS_HINT = '오른쪽 위 ⚙ 설정';
const AI_NO_RETRY = [400, 401, 403, 404];
// 일괄 작업(남은 차시 생성)을 멈추는 상태 코드: 다음 차시도 같은 까닭으로 실패한다(인터넷 끊김, 키·잔액·권한·모델 문제)
const AI_RUN_STOP = [0, 401, 402, 403, 404];
const AI_KEY_INVALID_RE = /API[_ ]KEY[_ ]INVALID|API key not valid|invalid.*api.?key/i; // Gemini는 맞지 않는 키를 400으로 알린다

const aiProviderOf = url => {
    const text = String(url || '');
    if (text.includes('generativelanguage.googleapis.com')) return 'Gemini';
    if (text.includes('anthropic.com')) return 'Claude';
    return 'AI';
};

// 429 가운데 기다려도 풀리지 않는 한도. 'zero': 이 키로는 쓸 수 없는 모델(한도 0) · 'daily': 하루 한도. 분당 한도는 ''
// Gemini는 message에 "limit: 0"을, details의 quotaId에 PerDay·PerMinute를 적는다. 응답 원문 전체로 판정한다(err.detail은 300자로 자른다)
function aiQuotaKind(status, body = '') {
    if (status !== 429) return '';
    const text = String(body || '');
    if (/limit:\s*0(?![\d.])|"quotaValue"\s*:\s*"0"/i.test(text)) return 'zero';
    if (/PerDay|per\s*day|daily/i.test(text)) return 'daily';
    return '';
}

function friendlyAiError(status, body = '', provider = 'AI') {
    const text = String(body || '');
    const key = `${provider === 'AI' ? 'AI' : provider} 키`;
    if (status === 0) return '인터넷에 연결되지 않았습니다. 연결을 확인한 뒤 다시 해 주세요.';
    // 잔액·결제 문제. 429 원문에도 'billing'이 들어 있어(무료 한도 안내) 429는 한도 문구로 둔다
    if (status === 402 || (status !== 429 && /credit balance|billing|insufficient.?(funds|balance)|payment required/i.test(text))) {
        return `${provider === 'Claude' ? 'Claude 콘솔' : provider === 'Gemini' ? 'Google AI Studio' : 'AI 서비스'}의 잔액(크레딧)이 부족하거나 결제가 필요합니다(${status}). 충전한 뒤 다시 하거나 ${AI_SETTINGS_HINT}에서 다른 키를 넣어 주세요.`;
    }
    if (status === 401 || (status === 400 && AI_KEY_INVALID_RE.test(text))) {
        return `${key}가 맞지 않습니다(${status}). ${AI_SETTINGS_HINT}에서 키를 다시 넣고 '연결 확인'을 눌러 주세요.`;
    }
    if (status === 403) return `이 ${key}로는 고른 모델을 쓸 수 없습니다(403). ${AI_SETTINGS_HINT}에서 '빠르고 저렴하게'를 누르거나 키를 확인해 주세요.`;
    if (status === 404) return `고른 모델을 찾지 못했습니다(404). ${AI_SETTINGS_HINT}에서 다른 모델을 골라 주세요.`;
    if (status === 429) {
        const quota = aiQuotaKind(status, text);
        if (quota === 'zero') return `이 ${key}로는 고른 모델을 쓸 수 없습니다(429 · 무료 사용량 0). ${AI_SETTINGS_HINT}에서 '빠르고 저렴하게'를 누르거나 유료 키를 넣어 주세요.`;
        if (quota === 'daily') return `오늘 쓸 수 있는 AI 사용량을 다 썼습니다(429). 내일 다시 하거나 ${AI_SETTINGS_HINT}에서 다른 모델이나 키로 바꿔 주세요.`;
        return `AI 사용 한도를 넘었습니다(429). 무료 키는 분당·하루 사용량이 정해져 있습니다. 잠시 뒤 다시 하거나 ${AI_SETTINGS_HINT}에서 '빠르고 저렴하게'를 눌러 주세요.`;
    }
    if (status === 400) return `AI가 요청을 받지 못했습니다(400). 내용을 조금 줄이거나 ${AI_SETTINGS_HINT}에서 다른 모델을 골라 다시 해 주세요.`;
    if (status >= 500) return `AI 서버가 잠시 바쁩니다(${status}). 1~2분 뒤 다시 해 주세요.`;
    return `AI 호출에 실패했습니다(${status}). 잠시 뒤 다시 해 주세요.`;
}

// 화면용 문장을 담은 오류. 키·모델 문제(400·401·403·404)와 기다려도 풀리지 않는 한도(한도 0·하루 한도)는 다시 시도해도 같으므로 바로 멈춘다
function aiError(status, body, provider) {
    const err = new Error(friendlyAiError(status, body, provider));
    err.status = status;
    err.detail = String(body || '').slice(0, 300);
    err.quota = aiQuotaKind(status, body); // 'zero' | 'daily' | ''
    err.noRetry = AI_NO_RETRY.includes(status) || !!err.quota;
    return err;
}

// 일괄 작업을 멈출 오류인지: 기다려도 풀리지 않는 한도(한도 0·하루 한도), 인터넷 끊김, 키·잔액·권한·모델 문제(맞지 않는 Gemini 키의 400 포함).
// 다음 차시로 넘어가도 같은 오류로 실패하므로 다시 해 보지 않고 멈춘다(course-flow.js)
function aiErrorStopsRun(err) {
    if (!err || typeof err !== 'object') return false;
    if (err.quota || AI_RUN_STOP.includes(err.status)) return true;
    return err.status === 400 && AI_KEY_INVALID_RE.test(String(err.detail || ''));
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
    Object.assign(window, { friendlyAiError, aiError, aiProviderOf, keyCheckResult, aiQuotaKind, aiErrorStopsRun });
}
