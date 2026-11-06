// higgsfield.js - Higgsfield 이미지 생성: 설정에 넣은 키로 교안 삽화를 만든다
// Higgsfield API는 브라우저 출처를 막으므로(CORS) 사용자가 배포한 중계(relay/higgsfield-relay.mjs)를 거쳐 부른다.
// 키는 다른 AI 키처럼 이 브라우저에만 저장하고, 중계는 받은 Authorization 헤더를 넘길 뿐 저장하지 않는다.

// 모델별 API 경로와 고정 값. 화면 비율은 교안 이미지 규격(IMAGE_ASPECT_RATIO)을 쓴다
const HIGGSFIELD_MODELS = {
    recraft: { path: 'recraft/v4.1/text-to-image', body: { output_format: 'png' } },
    soul: { path: 'higgsfield-ai/soul/v2/standard', body: { resolution: '1080p' } },
    ideogram: { path: 'ideogram/v4.0', body: {} },
    grok: { path: 'xai/grok-imagine-image-2.0', body: { resolution: '2k' } }
};
const HIGGSFIELD_PROMPT_MAX = 2000; // Ideogram 상한(2048자)에 맞춘다
const HIGGSFIELD_POLL_MS = 3000;
const HIGGSFIELD_TIMEOUT_MS = 5 * 60 * 1000;
const HIGGSFIELD_POLL_RETRIES = 3; // 상태 조회가 연결 오류로 연달아 실패해도 이만큼은 다시 묻는다
const HIGGSFIELD_STOPPED = { failed: '생성에 실패했습니다', nsfw: '부적절한 내용으로 판단해 거절했습니다', canceled: '요청이 취소되었습니다' };
const HIGGSFIELD_PROBE_ID = '00000000-0000-0000-0000-000000000000'; // 연결 확인용. 없는 요청이라 비용이 들지 않는다
const HIGGSFIELD_RELAY_FILE = './relay/higgsfield-relay.mjs';
const HIGGSFIELD_IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' };

let higgsfieldKey = '';
let higgsfieldRelayUrl = '';
try {
    higgsfieldKey = localStorage.getItem('higgsfield_api_key') || '';
    higgsfieldRelayUrl = localStorage.getItem('higgsfield_relay_url') || '';
} catch (e) {
    console.warn('localStorage 접근 불가 (Higgsfield):', e);
}

const higgsfieldModel = model => (isHiggsfieldModel(model) ? HIGGSFIELD_MODELS[model.slice(HIGGSFIELD_MODEL_PREFIX.length)] || null : null);
const higgsfieldReady = () => !!higgsfieldKey && !!higgsfieldRelayUrl;
// 기다리다 중지하면 바로 끝낸다(AbortError)
const higgsfieldStopped = () => Object.assign(new Error('중지했습니다.'), { name: 'AbortError' });
const pauseHiggsfield = (ms, signal = null) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(higgsfieldStopped());
    const timer = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(higgsfieldStopped()); }
    signal?.addEventListener?.('abort', onAbort, { once: true });
});

/* ---------- 설정 값 ---------- */
// "Key 아이디:비밀값"을 붙여 넣어도 받는다. 형식이 틀리면 null
function normalizeHiggsfieldKey(value) {
    const key = String(value || '').trim().replace(/^Key\s+/i, '');
    if (!key) return '';
    return /^[^\s:]+:[^\s:]+$/.test(key) ? key : null;
}

// https 주소만 받는다. 내 컴퓨터에서 시험할 때는 http://localhost도 받는다. 끝의 /는 뗀다
function normalizeHiggsfieldRelay(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        const url = new URL(text);
        const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
        if (url.protocol !== 'https:' && !local) return null;
        return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    } catch {
        return null;
    }
}

// 빈 칸으로 저장하면 지운다 (다른 키와 같음). 키만 먼저 넣고 중계는 나중에 넣어도 된다
function updateHiggsfieldSetting(keyInput, relayInput) {
    const key = normalizeHiggsfieldKey(keyInput);
    const relay = normalizeHiggsfieldRelay(relayInput);
    if (key === null) return { ok: false, error: 'Higgsfield 키는 "Key ID:Secret" 형식으로 넣어 주세요.' };
    if (relay === null) return { ok: false, error: '중계 주소는 https://로 시작하는 주소여야 합니다.' };
    higgsfieldKey = key;
    higgsfieldRelayUrl = relay;
    storeApiKey('higgsfield_api_key', key);
    storeApiKey('higgsfield_relay_url', relay);
    return { ok: true };
}

/* ---------- 호출 ---------- */
function higgsfieldErrorText(status, data, text) {
    // Higgsfield는 {"detail": ...}, 중계는 {"error": ...}로 답한다
    if (data?.detail && (status === 401 || status === 403)) return '키가 맞지 않습니다. 설정의 Higgsfield 키를 확인해 주세요';
    if (status === 402) return 'API 잔액이 부족합니다. console.higgsfield.ai에서 충전해 주세요';
    const detail = Array.isArray(data?.detail) ? data.detail.map(item => item.msg || JSON.stringify(item)).join(', ') : data?.detail;
    return detail || data?.error || String(text || '').slice(0, 120) || `HTTP ${status}`;
}

async function higgsfieldFetch(path, init = {}) {
    let res;
    try {
        res = await fetch(`${higgsfieldRelayUrl}/${path}`, {
            ...init,
            headers: { Authorization: `Key ${higgsfieldKey}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }
        });
    } catch (err) {
        if (err?.name === 'AbortError') throw higgsfieldStopped(); // 중지: 중계 연결 문제가 아니다
        throw new Error(`Higgsfield 중계에 연결하지 못했습니다 (${err.message}). 중계 주소와 배포 상태를 확인해 주세요`);
    }
    const text = await res.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch {
        data = null; // 중계나 Higgsfield가 JSON이 아닌 오류 문구를 돌려줄 때가 있다
    }
    if (!res.ok) throw Object.assign(new Error(`Higgsfield ${res.status}: ${higgsfieldErrorText(res.status, data, text)}`), { status: res.status, data });
    return data;
}

// 끝날 때까지 상태를 본다. 일시적인 연결 오류와 5xx는 몇 번 다시 묻는다
async function waitHiggsfieldRequest(requestId, signal = null) {
    const deadline = Date.now() + HIGGSFIELD_TIMEOUT_MS;
    let misses = 0;
    while (Date.now() < deadline) {
        await pauseHiggsfield(HIGGSFIELD_POLL_MS, signal);
        let data;
        try {
            data = await higgsfieldFetch(`requests/${encodeURIComponent(requestId)}/status`, signal ? { signal } : {});
        } catch (err) {
            if (err?.name === 'AbortError' || (err.status && err.status < 500) || ++misses > HIGGSFIELD_POLL_RETRIES) throw err;
            continue;
        }
        misses = 0;
        if (data?.status === 'completed') return data;
        if (HIGGSFIELD_STOPPED[data?.status]) throw new Error(`Higgsfield ${HIGGSFIELD_STOPPED[data.status]}`);
    }
    throw new Error(`Higgsfield 응답을 ${HIGGSFIELD_TIMEOUT_MS / 60000}분 넘게 기다렸습니다`);
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('이미지를 읽지 못했습니다'));
        reader.readAsDataURL(blob);
    });
}

// 그림 형식만 남긴다: ';' 앞의 글을 다듬고 소문자로('Image/PNG; charset=binary' → 'image/png').
// 서버가 준 형식을 그대로 쓰면 'data:image/png; charset=binary;base64,…'가 되어 다음에 열 때 그림으로 받지 않는다(data-safety.js)
const bareImageType = type => String(type || '').split(';')[0].trim().toLowerCase();

// 형식을 알려 주지 않는 저장소도 있어 주소의 확장자로 채운다. 그림 형식은 매개변수 없이 형식만 둔다(blobToDataUrl이 그 형식으로 data URL을 만든다)
function asImageBlob(blob, url) {
    const type = bareImageType(blob.type);
    if (type.startsWith('image/')) return type === blob.type ? blob : new Blob([blob], { type });
    const ext = (String(url).split('?')[0].match(/\.(\w+)$/) || [])[1]?.toLowerCase();
    return HIGGSFIELD_IMAGE_TYPES[ext] ? new Blob([blob], { type: HIGGSFIELD_IMAGE_TYPES[ext] }) : null;
}

// 결과 주소는 7일 뒤 사라지므로 내려받아 교안에 넣는다. 저장소가 브라우저 요청을 막으면 중계로 받는다
async function higgsfieldImageData(url) {
    const sources = [url, `${higgsfieldRelayUrl}/media?url=${encodeURIComponent(url)}`];
    for (const source of sources) {
        try {
            const res = await fetch(source);
            const blob = res.ok ? asImageBlob(await res.blob(), url) : null;
            if (blob?.size) return await blobToDataUrl(blob);
        } catch (err) {
            console.warn('[Higgsfield] 이미지 내려받기 실패:', err.message);
        }
    }
    throw new Error('Higgsfield 이미지를 내려받지 못했습니다');
}

// 성공하면 data URL. 실패하면 이유를 담은 오류를 던진다 (generateImageAPI가 받아 다음 모델로 넘어간다)
// 중지하면 기다림과 상태 조회를 끊는다. 이미 보낸 요청은 Higgsfield에서 취소되지 않아 크레딧이 쓰일 수 있다
async function generateHiggsfieldImage(modelId, prompt, { signal = null } = {}) {
    const model = higgsfieldModel(modelId);
    if (!model) throw new Error('알 수 없는 Higgsfield 모델입니다');
    if (!higgsfieldReady()) throw new Error('설정에서 Higgsfield 키와 중계 주소를 저장해 주세요');
    const body = { prompt: String(prompt).slice(0, HIGGSFIELD_PROMPT_MAX), aspect_ratio: IMAGE_ASPECT_RATIO, ...model.body };
    const submitted = await higgsfieldFetch(model.path, { method: 'POST', body: JSON.stringify(body), ...(signal ? { signal } : {}) });
    if (!submitted?.request_id) throw new Error('Higgsfield 요청 번호를 받지 못했습니다');
    const done = await waitHiggsfieldRequest(submitted.request_id, signal);
    const url = done.images?.[0]?.url;
    if (!url) throw new Error('Higgsfield 결과에 이미지가 없습니다');
    return higgsfieldImageData(url);
}

// 없는 요청의 상태를 물어 키와 중계를 확인한다. 아무것도 만들지 않으므로 비용이 들지 않는다
async function checkHiggsfieldConnection() {
    if (!higgsfieldReady()) return { ok: false, message: '키와 중계 주소를 모두 넣어 주세요.' };
    try {
        await higgsfieldFetch(`requests/${HIGGSFIELD_PROBE_ID}/status`);
        return { ok: true, message: '연결되었습니다. 키를 확인했습니다.' };
    } catch (err) {
        // Higgsfield가 "없는 요청"이라고 답하면 중계와 키가 모두 통한 것이다. 다른 서버의 404와 구분하려고 detail을 본다
        if ([404, 422].includes(err.status) && err.data?.detail) return { ok: true, message: '연결되었습니다. 키를 확인했습니다.' };
        return { ok: false, message: err.message };
    }
}

/* ---------- 설정 화면 ---------- */
function higgsfieldStatus() {
    if (!higgsfieldKey) return { text: '키 미등록', tone: 'bg-red-400' };
    if (!higgsfieldRelayUrl) return { text: '키 등록됨 · 중계 주소 미등록', tone: 'bg-amber-400' };
    return { text: '키와 중계 주소 등록됨', tone: 'bg-emerald-400' };
}

function showHiggsfieldStatus({ text, tone }) {
    const dot = document.getElementById('higgsfield-status-dot');
    const label = document.getElementById('higgsfield-status-text');
    if (dot) dot.className = `w-1.5 h-1.5 rounded-full shrink-0 ${tone}`;
    if (label) {
        label.textContent = text;
        label.title = text;
    }
}

window.renderHiggsfieldSettings = function () {
    const key = document.getElementById('settings-higgsfield-key-input');
    const relay = document.getElementById('settings-higgsfield-relay-input');
    if (key) key.value = higgsfieldKey;
    if (relay) relay.value = higgsfieldRelayUrl;
    showHiggsfieldStatus(higgsfieldStatus());
};

function saveHiggsfieldInputs() {
    return updateHiggsfieldSetting(
        document.getElementById('settings-higgsfield-key-input')?.value,
        document.getElementById('settings-higgsfield-relay-input')?.value
    );
}

window.saveHiggsfieldSetting = function () {
    const result = saveHiggsfieldInputs();
    if (!result.ok) return window.showAlert(result.error);
    window.renderHiggsfieldSettings();
    window.showToast?.(higgsfieldKey ? 'Higgsfield 설정을 저장했습니다.' : 'Higgsfield 키를 삭제했습니다.', 'success');
};

// 입력한 값을 저장한 뒤 확인한다
window.testHiggsfieldSetting = async function (button) {
    const saved = saveHiggsfieldInputs();
    if (!saved.ok) return window.showAlert(saved.error);
    window.renderHiggsfieldSettings(); // 저장한 모양(머리말·끝 / 정리)으로 칸을 다시 채운다
    if (button) button.disabled = true;
    showHiggsfieldStatus({ text: '연결 확인 중...', tone: 'bg-amber-400' });
    const result = await checkHiggsfieldConnection();
    if (button) button.disabled = false;
    showHiggsfieldStatus({ text: result.message, tone: result.ok ? 'bg-emerald-400' : 'bg-red-400' });
};

// 중계 코드를 복사해 Cloudflare Worker 편집기에 붙여 넣게 한다
window.copyHiggsfieldRelay = async function () {
    try {
        const res = await fetch(HIGGSFIELD_RELAY_FILE);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await copyPlainText(await res.text());
        window.showToast?.('중계 코드를 복사했습니다. Cloudflare Worker 편집기에 붙여 넣고 배포하세요.', 'success');
    } catch (err) {
        console.error('[Higgsfield] 중계 코드 복사 실패:', err);
        window.showAlert(`중계 코드를 복사하지 못했습니다: ${err.message}`);
    }
};
