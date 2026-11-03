// higgsfield-relay.mjs - 교안 도우미(Teacher)가 Higgsfield API를 부를 수 있게 요청을 넘기는 Cloudflare Worker
// Higgsfield API는 브라우저 출처를 막으므로(CORS) 이 중계를 거친다.
// 키는 저장하지 않는다. 앱이 보낸 Authorization 헤더를 그대로 넘기므로 키가 없으면 이 중계로 아무것도 만들 수 없다.
//
// 배포: Cloudflare 대시보드 → Workers & Pages → Create → Worker → 이름을 정하고 Deploy → Edit code에서
//       기존 코드를 지우고 이 파일 내용을 붙여 넣은 뒤 Deploy. 나온 주소(https://이름.계정.workers.dev)를 앱 설정에 넣는다.
// 앱을 다른 주소에서 쓰면 Worker의 Settings → Variables에 ALLOWED_ORIGINS를 만들고 출처를 쉼표로 적는다 (예: http://localhost:3102)

const HIGGSFIELD_API = 'https://api.higgsfield.ai';
const DEFAULT_ORIGINS = ['https://rkdghkclgns-design.github.io'];
const MODEL_PATH = /^\/(?!requests\/)[a-z0-9-]+(?:\/[a-z0-9.-]+){1,4}$/;
const REQUEST_PATH = /^\/requests\/[0-9a-f-]{36}\/(status|cancel)$/;
const MEDIA_HOST = /(^|\.)higgsfield\.ai$|\.cloudfront\.net$/;

function allowedOrigins(env) {
    const extra = String(env?.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean);
    return [...DEFAULT_ORIGINS, ...extra];
}

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin'
    };
}

function json(body, status, headers) {
    return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

// 정해 둔 호출만 넘긴다: 모델 생성(POST), 요청 상태(GET), 요청 취소(POST)
function isAllowedCall(method, path) {
    const request = path.match(REQUEST_PATH);
    if (request) return (request[1] === 'status' && method === 'GET') || (request[1] === 'cancel' && method === 'POST');
    return method === 'POST' && MODEL_PATH.test(path);
}

async function relayApi(request, url, cors) {
    const headers = { Authorization: request.headers.get('Authorization') || '' };
    const type = request.headers.get('Content-Type');
    if (type) headers['Content-Type'] = type;
    const upstream = await fetch(`${HIGGSFIELD_API}${url.pathname}`, {
        method: request.method,
        headers,
        body: request.method === 'POST' ? await request.text() : undefined
    });
    return new Response(upstream.body, {
        status: upstream.status,
        headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' }
    });
}

// 결과 이미지는 보통 앱이 바로 받는다. 저장소가 막을 때를 위해 Higgsfield 저장소 주소만 대신 받아 준다
async function relayMedia(target, cors) {
    let url;
    try {
        url = new URL(target || '');
    } catch {
        return json({ error: '이미지 주소가 올바르지 않습니다.' }, 400, cors);
    }
    if (url.protocol !== 'https:' || !MEDIA_HOST.test(url.hostname)) return json({ error: '받을 수 없는 이미지 주소입니다.' }, 400, cors);
    const upstream = await fetch(url.toString());
    return new Response(upstream.body, {
        status: upstream.status,
        headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream' }
    });
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const allowed = allowedOrigins(env).includes(origin);
        const cors = allowed ? corsHeaders(origin) : {};
        if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
        if (!allowed) return json({ error: '이 중계는 등록한 앱 주소에서 온 요청만 받습니다.' }, 403, cors);
        const url = new URL(request.url);
        try {
            if (url.pathname === '/media' && request.method === 'GET') return await relayMedia(url.searchParams.get('url'), cors);
            if (!isAllowedCall(request.method, url.pathname)) return json({ error: '중계하지 않는 경로입니다.' }, 404, cors);
            return await relayApi(request, url, cors);
        } catch (err) {
            return json({ error: `중계 오류: ${err.message}` }, 502, cors);
        }
    }
};
