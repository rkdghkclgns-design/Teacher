// claude.js - Claude API 어댑터
// 호출부는 Gemini 형식 payload로 callGemini()를 호출하고, 모델명이 claude-로 시작하면
// 여기서 Messages API 요청으로 변환한 뒤 응답을 다시 Gemini 형식으로 돌려준다.
// Claude는 이미지 생성을 지원하지 않으므로 이미지는 항상 Gemini 모델이 담당한다.

const CLAUDE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
// 추론(thinking)도 max_tokens 안에서 소비되므로 모델 상한까지 확보 (스트리밍 필수)
const CLAUDE_MAX_TOKENS = 128000;
const CLAUDE_MAX_RETRIES = 4;
// 안전 분류기 거절 시 서버가 대체 모델로 이어서 처리 (Haiku는 미지원)
const CLAUDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const CLAUDE_FALLBACK_MODELS = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5'];
const CLAUDE_JSON_INSTRUCTION = '응답은 유효한 JSON만 출력하십시오. 코드펜스, 인사말, 설명을 붙이지 마십시오.';

let claudeSdkPromise = null;

function isClaudeModel(modelName) {
    return /^claude-/.test(modelName);
}

function loadClaudeSdk() {
    if (!claudeSdkPromise) {
        claudeSdkPromise = import(CLAUDE_SDK_URL).catch(e => {
            claudeSdkPromise = null; // 일시적 CDN 실패 후 재시도 가능하도록 초기화
            console.error('[Claude] SDK 로드 실패:', e);
            throw new Error('Claude SDK를 불러오지 못했습니다. 네트워크 상태를 확인해주세요.');
        });
    }
    return claudeSdkPromise;
}

function wantsJsonResponse(payload) {
    return payload.generationConfig?.responseMimeType === 'application/json';
}

function toClaudeContent(parts) {
    return (parts || []).flatMap(part => {
        if (part.inlineData) {
            return [{ type: 'image', source: { type: 'base64', media_type: part.inlineData.mimeType, data: part.inlineData.data } }];
        }
        return part.text?.trim() ? [{ type: 'text', text: part.text }] : [];
    });
}

// temperature 등 샘플링 값은 현행 Claude 모델에서 400 오류이므로 전달하지 않는다
function buildClaudeRequest(modelName, payload) {
    const systemText = (payload.systemInstruction?.parts || []).map(p => p.text).join('\n');
    const system = [systemText, wantsJsonResponse(payload) ? CLAUDE_JSON_INSTRUCTION : ''].filter(Boolean).join('\n\n');
    return {
        model: modelName,
        max_tokens: CLAUDE_MAX_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: { effort: taskEffort(payload.taskRole) },
        messages: payload.contents.map(c => ({
            role: c.role === 'model' ? 'assistant' : 'user',
            content: toClaudeContent(c.parts)
        })),
        ...(system ? { system } : {}),
        ...(CLAUDE_FALLBACK_MODELS.includes(modelName) ? { betas: [CLAUDE_FALLBACK_BETA], fallbacks: 'default' } : {})
    };
}

function stripJsonFence(text) {
    return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function toGeminiResponse(message, jsonMode) {
    if (message.stop_reason === 'refusal') {
        const category = message.stop_details?.category;
        throw new Error(`Claude가 안전 정책으로 요청을 거절했습니다${category ? ` (${category})` : ''}. 다른 모델을 선택하거나 내용을 수정해주세요.`);
    }
    // 대체 모델 전환 시에도 텍스트 블록은 이어쓰기 구조이므로 순서대로 합치면 된다
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return {
        candidates: [{
            content: { parts: [{ text: jsonMode ? stripJsonFence(text) : text }] },
            finishReason: message.stop_reason === 'max_tokens' ? 'MAX_TOKENS' : 'STOP'
        }]
    };
}

function describeClaudeError(Anthropic, e) {
    if (e instanceof Anthropic.APIConnectionError) return friendlyAiError(0, e.message, 'Claude');
    if (e instanceof Anthropic.APIError) return friendlyAiError(e.status || 0, e.message, 'Claude'); // 키·권한·한도·서버 문제를 한국어 한 줄로(ai-errors.js)
    return e.message || String(e);
}

async function callClaude(modelName, payload) {
    if (!claudeApiKey) {
        throw new Error('Claude API 키가 없습니다. 오른쪽 위 ⚙ 설정에서 키를 넣어 주세요(키는 console.anthropic.com에서 받습니다).');
    }
    const { default: Anthropic } = await loadClaudeSdk();
    const client = new Anthropic({ apiKey: claudeApiKey, maxRetries: CLAUDE_MAX_RETRIES, dangerouslyAllowBrowser: true });
    try {
        const message = await client.beta.messages.stream(buildClaudeRequest(modelName, payload)).finalMessage();
        return toGeminiResponse(message, wantsJsonResponse(payload));
    } catch (e) {
        console.error('[Claude] 호출 실패:', e);
        const err = new Error(describeClaudeError(Anthropic, e));
        err.status = e.status;
        err.detail = String(e.message || '').slice(0, 300); // 원문은 콘솔·detail에만
        throw err;
    }
}
