// cost-estimate.js - 일괄 작업 전에 AI 호출 수·그림 장수·걸릴 시간·비용 수준을 미리 보여 준다
// 정확한 값이 아니라 가늠이다. 호출 하나에 걸린 시간을 이 브라우저에 모델별로 모아(최근 평균) 시간 가늠에 쓴다(api.js callGemini).
// 금액은 공급자 요금표가 자주 바뀌어 넣지 않고, 고른 글 모델로 비용 수준(낮음·보통·높음)을 보인다. 테스트: tests/cost-estimate.test.js

const ESTIMATE_RULES = {
    tabCalls: 1.3,                                  // 탭 하나: 본문 + 가끔 이어쓰기·생성 직후 자동 수정
    imagesPerTab: { all: 4, section: 3, none: 0 },  // 탭 하나에 들어가는 그림 자리(설정의 교안 이미지 양)
    callsPerImage: 2,                               // 그림 하나: 고르기 판정 + 검색으로 못 찾으면 AI 생성
    ncsCalls: 1,                                    // NCS 배정(교과·차시)
    gyosuanCalls: 3,                                // 교수안 + 슬라이드 편성안 + 슬라이드
    qbankCalls: 2,                                  // 문제은행 채우기
    artCalls: 4,                                    // SVG 삽화(후보 1회 + 그림 최대 3장)
    ocrMaxCallsPerPdf: 8                            // 스캔 PDF: 30쪽까지 4쪽마다 1회
};
const CALL_SECONDS = { low: 20, mid: 45, high: 90 };   // 잰 기록이 없을 때 호출 하나에 걸리는 시간(초)
const EFFORT_FACTOR = { low: 0.7, medium: 1, high: 1.5, max: 2 };
const COST_LABEL = { low: '낮음', mid: '보통', high: '높음' };
const AI_TIMING_KEY = 'teacher:ai-timing';
const AI_TIMING_MIN_SAMPLES = 3;
const AI_TIMING_WINDOW = 50; // 최근 호출에 더 무게를 둔다

function modelCostTier(model) {
    const name = String(model || '').toLowerCase();
    if (/flash|haiku|(^|[-_.])(lite|mini|nano)([-_.]|$)/.test(name)) return 'low'; // 'gemini' 안의 mini는 세지 않는다
    if (/opus|fable|ultra/.test(name)) return 'high';
    return 'mid';
}

// 차시 하나에서 할 일. imageAmount: 설정의 교안 이미지 양(all·section·none)
function lessonWork({ tabs = 0, gyosuan = false, qbank = false, art = false, ncs = tabs > 0 } = {}, imageAmount = 'section') {
    const perTab = ESTIMATE_RULES.imagesPerTab[imageAmount] ?? ESTIMATE_RULES.imagesPerTab.section;
    return { tabs, images: tabs * perTab, ncs: ncs ? 1 : 0, gyosuan: gyosuan ? 1 : 0, qbank: qbank ? 1 : 0, art: art ? 1 : 0 };
}

const sumWork = list => list.reduce((total, work) => {
    Object.entries(work).forEach(([key, value]) => { total[key] = (total[key] || 0) + value; });
    return total;
}, {});

// work: { tabs, images, ncs, gyosuan, qbank, art, ocr } 개수 → AI 호출 수
function estimateCalls(work = {}) {
    const rule = ESTIMATE_RULES;
    const calls = (work.tabs || 0) * rule.tabCalls + (work.images || 0) * rule.callsPerImage + (work.ncs || 0) * rule.ncsCalls
        + (work.gyosuan || 0) * rule.gyosuanCalls + (work.qbank || 0) * rule.qbankCalls + (work.art || 0) * rule.artCalls + (work.ocr || 0);
    return Math.ceil(calls);
}

/* ---------- 걸린 시간 기록 ---------- */
function readAiTimings() {
    try {
        const data = JSON.parse(localStorage.getItem(AI_TIMING_KEY) || '{}');
        return data && typeof data === 'object' ? data : {};
    } catch (err) {
        return {};
    }
}

// 성공한 호출만 넣는다(대기·재시도 시간 포함이라 실제 체감에 가깝다)
function recordAiTiming(model, ms) {
    if (!model || !(ms > 0)) return;
    const all = readAiTimings();
    const previous = all[model] || { count: 0, avg: 0 };
    const count = Math.min(previous.count + 1, AI_TIMING_WINDOW);
    try {
        localStorage.setItem(AI_TIMING_KEY, JSON.stringify({ ...all, [model]: { count, avg: Math.round(previous.avg + (ms - previous.avg) / count) } }));
    } catch (err) {
        console.warn('[예고] 호출 시간을 저장하지 못했습니다:', err.message);
    }
}

function secondsPerCall(model, effort, timings = readAiTimings()) {
    const seen = timings[model];
    if (seen && seen.count >= AI_TIMING_MIN_SAMPLES && seen.avg > 0) return { seconds: seen.avg / 1000, measured: true };
    return { seconds: CALL_SECONDS[modelCostTier(model)] * (EFFORT_FACTOR[effort] || 1), measured: false };
}

/* ---------- 가늠 ---------- */
// 시간은 범위(0.7배~1.5배)로. 한 번에 하나씩 차례로 부르므로 더한다
function estimateSummary(work, { model = '', effort = 'medium', timings } = {}) {
    const calls = estimateCalls(work);
    const per = secondsPerCall(model, effort, timings);
    const minutes = calls * per.seconds / 60;
    const minutesLow = Math.max(1, Math.round(minutes * 0.7));
    const minutesHigh = Math.max(minutesLow, Math.ceil(minutes * 1.5));
    const tier = modelCostTier(model);
    return { calls, images: work.images || 0, minutesLow, minutesHigh, tier, costLabel: COST_LABEL[tier], measured: per.measured };
}

function estimateLine(summary, modelLabel = '') {
    const time = summary.minutesHigh <= 1 ? '1분 안쪽' : `약 ${summary.minutesLow}~${summary.minutesHigh}분`;
    return [
        `AI 호출 약 ${summary.calls}회`,
        summary.images ? `그림 최대 ${summary.images}장` : '',
        time,
        `비용 수준 ${summary.costLabel}${modelLabel ? `(${modelLabel})` : ''}`
    ].filter(Boolean).join(' · ');
}

function estimateNote(summary, model = '') {
    return [
        summary.measured ? '시간은 이 브라우저에서 잰 최근 호출 평균으로 셌습니다.' : '시간은 모델과 추론 강도로 어림했습니다.',
        summary.tier === 'low' && /gemini/i.test(model) ? '무료 키는 분당 호출 한도가 있어 더 걸릴 수 있습니다.' : '',
        '실제 비용은 AI 공급자 요금표를 따릅니다.'
    ].filter(Boolean).join(' ');
}

// 지금 설정(글 모델·추론 강도·교안 이미지 양)
function currentEstimateSettings() {
    const model = typeof TEXT_MODEL !== 'undefined' ? TEXT_MODEL : '';
    const options = typeof TEXT_MODEL_OPTIONS !== 'undefined' ? TEXT_MODEL_OPTIONS : [];
    const label = String(options.find(option => option.value === model)?.label || model).replace(/\s*\(.*\)\s*$/, '');
    return {
        model,
        modelLabel: label,
        effort: typeof REASONING_EFFORT !== 'undefined' ? REASONING_EFFORT : 'medium',
        imageAmount: typeof LESSON_IMAGE_AMOUNT !== 'undefined' ? LESSON_IMAGE_AMOUNT : 'section'
    };
}

// 창 안에 넣는 예고 상자
function estimateBoxHtml(work) {
    const settings = currentEstimateSettings();
    const summary = estimateSummary(work, settings);
    return `<div class="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2">
        <p class="text-xs font-bold text-textLight"><i class="ph-bold ph-gauge text-accent" aria-hidden="true"></i> 미리 보기: ${escapeHtml(estimateLine(summary, settings.modelLabel))}</p>
        <p class="text-[0.6875rem] text-textMuted mt-0.5">${escapeHtml(estimateNote(summary, settings.model))}</p>
    </div>`;
}

// 한 번 묻고 시작하는 일괄 작업(차시 전체 생성, 일괄 이미지 찾기, 콘텐츠 정리 등)
function confirmWithEstimate(message, work, { title = '시작할까요?', okLabel = '시작' } = {}) {
    const settings = currentEstimateSettings();
    const summary = estimateSummary(work, settings);
    return confirmAsync(`${message}\n\n${estimateLine(summary, settings.modelLabel)}\n${estimateNote(summary, settings.model)}`, { okLabel, tone: 'primary', title });
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        modelCostTier, lessonWork, sumWork, estimateCalls, recordAiTiming, readAiTimings, secondsPerCall,
        estimateSummary, estimateLine, estimateNote, estimateBoxHtml, confirmWithEstimate, currentEstimateSettings
    });
}
