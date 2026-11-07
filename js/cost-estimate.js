// cost-estimate.js - 일괄 작업 전에 글 호출 수·비용 수준, 그림 장수·그리는 곳·요금 방식, 걸릴 시간을 미리 보여 준다
// 정확한 값이 아니라 가늠이다. 호출 하나에 걸린 시간을 이 브라우저에 모델별로 모아(본문 호출과 짧은 호출은 따로, 최근 평균) 시간 가늠에 쓴다(api.js callGemini).
// 금액은 공급자 요금표가 자주 바뀌어 넣지 않는다. 글은 고른 글 모델로 비용 수준(낮음·보통·높음)을, 그림은 누가 그리는지와 요금 방식을 보인다. 테스트: tests/cost-estimate.test.js

const ESTIMATE_RULES = {
    tabCalls: 2,                                    // 탭 하나: 본문(학습 탭은 이어쓰기가 잦아 2~6회, 나머지 1~3회) + 가끔 생성 직후 자동 수정
    // 탭마다 그림 자리(설정의 교안 이미지 양). 탭 글 규칙(ui.js 탭 작성 지시)의 최소 섹션 수로 센다(api.js autoInjectImageTags·pendingImageTags):
    // 핵심만은 ## 섹션마다 한 장(기본·심화 학습은 학습 목표·개요를 빼고 6개, 실습 3개), 모두는 긴 ### 소주제마다 한 장 더(기본·심화 학습 16개).
    // 학습 이해도는 문제(짧은 ###)뿐이라 그림이 거의 없다. 글이 길면 더 늘어난다(모두는 정해진 상한이 없다)
    imagesPerTab: {
        all: { basicLearn: 22, basicPrac: 3, advLearn: 22, advPrac: 3, assessment: 0 },
        section: { basicLearn: 6, basicPrac: 3, advLearn: 6, advPrac: 3, assessment: 0 },
        none: {}
    },
    shortCallsPerImage: 1,                          // 교안 그림 하나: 검색어 정하기(검색 키가 있으면 고르기 판정이 하나 더)
    shortCallsPerSlideImage: 2,                     // 슬라이드 그림 하나: 장면 글로 바꾸기 + 그림 속 글자 확인(kbuilder/auto-images.js)
    ncsCalls: 1,                                    // NCS 배정(교과·차시)
    gyosuanCalls: 12,                               // 교수안: 머리말 1 + 전개(섹션마다 1, 최대 14) + 도입·정리 1
    gyosuanWaitCalls: 6,                            // 전개는 셋씩 함께 부르므로 기다리는 시간은 호출 6번쯤
    qbankCalls: 2,                                  // 문제은행 채우기
    artCalls: 4,                                    // SVG 삽화(후보 1회 + 그림 최대 3장)
    ocrMaxCallsPerPdf: 8,                           // 스캔 PDF: 30쪽까지 4쪽마다 1회
    // 학습 탭(기본학습·심화학습) 분량 보강(lesson-volume.js): 호출 하나가 낭독 글자 약 5,000자를 늘린다고 보고, 탭마다 호출 상한(목표 글자 ÷ 5,000, 480분이면 24번, 최대 48번)까지 센다.
    // 실제 답은 부탁한 글자의 절반쯤만 써 초안이 짧으면 상한 가까이 쓴다. 채운 뒤 컨벤션 필수 지적 자동 수정이 3번까지 이어진다
    volumeCharsPerCall: 5000,
    volumeCallLimit: 48,
    volumeFixCalls: 3,
    // 강사가 실습 시간을 정한 실습 탭은 이어쓰기 상한이 max(3, ⌈분 ÷ 90⌉)(6까지)로 늘어(lesson-lint.js tabChunkLimit) 기본 상한 3을 넘는 만큼 본문 호출을 더 센다
    practiceMinutesPerChunk: 90,
    practiceChunkBase: 3,
    practiceChunkCap: 6
};
const CALL_SECONDS = { low: 20, mid: 45, high: 90 };       // 잰 기록이 없을 때 본문 호출 하나(초)
const SHORT_CALL_FACTOR = 0.3;                             // 잰 기록이 없을 때 짧은 호출은 본문 호출의 이만큼
const LONG_CALL_FACTOR = 3;                                // 잰 기록이 없을 때 분량 보강(긴 글) 호출은 본문 호출의 이만큼
// lesson-lint.js LEARN_TARGET_MINUTES·READ_CHARS_PER_MINUTE·LEARN_VOLUME_TABS·PRACTICE_MINUTE_KEYS와 같다(테스트는 lesson-lint.js 없이 돈다)
const ESTIMATE_VOLUME = { minutes: 480, charsPerMinute: 250, tabs: ['basicLearn', 'advLearn'], practiceTabs: ['basicPrac', 'advPrac'] };
const IMAGE_CALL_SECONDS = { gemini: 25, higgsfield: 60 }; // 잰 기록이 없을 때 그림 한 장(초)
const ESTIMATE_GAPS = { image: 7, tab: 4 };                // 교안 그림 사이 간격(api.js IMAGE_TAG_GAP_MS), 탭·단계 사이 쉬는 시간(초)
const EFFORT_FACTOR = { low: 0.7, medium: 1, high: 1.5, xhigh: 1.75, max: 2 };
const COST_LABEL = { low: '낮음', mid: '보통', high: '높음' };
const ESTIMATE_SVG_MODEL = 'svg-illustration';             // data.js SVG_IMAGE_MODEL과 같다(테스트는 data.js 없이 돈다)
const AI_TIMING_KEY = 'teacher:ai-timing';
const AI_TIMING_MIN_SAMPLES = 3;
const AI_TIMING_WINDOW = 50; // 최근 호출에 더 무게를 둔다

function modelCostTier(model) {
    const name = String(model || '').toLowerCase();
    if (/flash|haiku|(^|[-_.])(lite|mini|nano)([-_.]|$)/.test(name)) return 'low'; // 'gemini' 안의 mini는 세지 않는다
    if (/opus|fable|ultra/.test(name)) return 'high';
    return 'mid';
}

// 교수안을 만들 때 슬라이드에 자동으로 넣는 그림 수(kbuilder/auto-images.js 설정, 기본 4장, '끔'이면 0)
function defaultSlideImageCount() {
    const count = Number(typeof window !== 'undefined' ? window.KBuilder?.autoImages?.count?.() : 0);
    return count > 0 ? count : 0;
}

// 만들 탭들의 그림 자리 수. tabs: 탭 id 목록(탭마다 센다)이나 탭 수(어느 탭인지 모르면 탭 하나를 다섯 탭의 평균으로 센다)
function tabImageCount(tabs, imageAmount = 'section') {
    const perTab = ESTIMATE_RULES.imagesPerTab[imageAmount] || ESTIMATE_RULES.imagesPerTab.section;
    if (Array.isArray(tabs)) return tabs.reduce((sum, id) => sum + (Object.prototype.hasOwnProperty.call(perTab, id) ? perTab[id] : 0), 0);
    const counts = Object.values(perTab);
    return counts.length ? Math.round((Number(tabs) || 0) * counts.reduce((sum, n) => sum + n, 0) / counts.length) : 0;
}

// 차시 학습 탭의 낭독 목표(분). lesson-lint.js learnTargetMinutes(차시 시간과 관계없이 480분)를 따르고, 없으면(테스트) 480분
const lessonVolumeMinutes = (mod, tabId = 'basicLearn') => (typeof learnTargetMinutes === 'function' ? learnTargetMinutes(mod, tabId) : ESTIMATE_VOLUME.minutes);

// 차시 실습 탭마다 강사가 정한 실습 시간(분, lesson-lint.js lessonPracticeMinutes). 그 파일이 없으면(테스트) 빈 값. courseOptions: 저장 전 과정 기본값
const lessonPracticeWork = (mod, courseOptions) => (typeof lessonPracticeMinutes === 'function'
    ? Object.fromEntries(ESTIMATE_VOLUME.practiceTabs.map(tabId => [tabId, lessonPracticeMinutes(mod, tabId, courseOptions)]))
    : {});

// 낭독 minutes분을 채우는 긴 호출 수(탭 하나): 초안을 모르면 호출 상한까지 쓴다고 보고 채운 뒤 자동 수정을 더한다(lesson-volume.js volumeCallEstimate는 지금 글로 센다)
function volumeCallsFor(minutes = ESTIMATE_VOLUME.minutes) {
    const rule = ESTIMATE_RULES;
    const chars = (Number(minutes) > 0 ? Number(minutes) : ESTIMATE_VOLUME.minutes) * ESTIMATE_VOLUME.charsPerMinute;
    return Math.min(rule.volumeCallLimit, Math.ceil(chars / rule.volumeCharsPerCall)) + rule.volumeFixCalls;
}

// 실습 시간을 정한 실습 탭이 기본보다 더 쓸 수 있는 이어쓰기 호출 수(정하지 않았으면 0)
function practiceExtraCalls(minutes) {
    const rule = ESTIMATE_RULES;
    const n = Number(minutes);
    if (!(n > 0)) return 0;
    return Math.min(rule.practiceChunkCap, Math.max(rule.practiceChunkBase, Math.ceil(n / rule.practiceMinutesPerChunk))) - rule.practiceChunkBase;
}

// 차시 하나에서 할 일. tabs: 만들 탭 id 목록(또는 탭 수) / imageAmount: 설정의 교안 이미지 양(all·section·none) / slideImages: 교수안을 만들면 슬라이드에 넣는 그림 수
// 학습 탭(기본학습·심화학습)을 만들면 탭마다 낭독 분량 채우기(volume: 탭 수, volumeAdv: 그 가운데 심화학습 수, volumeCalls: 긴 호출 수, volumeMinutes: 낭독 목표 분)도 센다.
// 탭 수만 알면 어느 탭인지 몰라 세지 않는다. 분량을 채우지 않는 최종 평가는 fillsVolume: false. volumeMinutes: 학습 탭의 낭독 목표(480분)
// practiceMinutes: 실습 탭마다 강사가 정한 실습 시간({ basicPrac, advPrac }). 정한 실습 탭은 이어쓰기 호출(practiceCalls)을 더 센다
function lessonWork({ tabs = 0, gyosuan = false, qbank = false, art = false, ncs, fillsVolume = true, volumeMinutes = ESTIMATE_VOLUME.minutes, practiceMinutes = {} } = {}, imageAmount = 'section', slideImages = defaultSlideImageCount()) {
    const tabCount = Array.isArray(tabs) ? tabs.length : (Number(tabs) || 0);
    const withNcs = ncs === undefined ? tabCount > 0 : ncs;
    const minutes = Number(volumeMinutes) > 0 ? Number(volumeMinutes) : ESTIMATE_VOLUME.minutes;
    const learnTabs = fillsVolume && Array.isArray(tabs) ? tabs.filter(id => ESTIMATE_VOLUME.tabs.includes(id)) : [];
    const adv = learnTabs.filter(id => id === 'advLearn').length;
    const volume = learnTabs.length ? { volume: learnTabs.length, volumeCalls: learnTabs.length * volumeCallsFor(minutes), volumeMinutes: minutes, ...(adv ? { volumeAdv: adv } : {}) } : {};
    const practiceCalls = Array.isArray(tabs) && practiceMinutes && typeof practiceMinutes === 'object'
        ? tabs.filter(id => ESTIMATE_VOLUME.practiceTabs.includes(id)).reduce((sum, id) => sum + practiceExtraCalls(practiceMinutes[id]), 0) : 0;
    return { tabs: tabCount, images: tabImageCount(tabs, imageAmount), slideImages: gyosuan ? slideImages : 0, ncs: withNcs ? 1 : 0, gyosuan: gyosuan ? 1 : 0, qbank: qbank ? 1 : 0, art: art ? 1 : 0, ...volume, ...(practiceCalls ? { practiceCalls } : {}) };
}

// 차시마다 할 일을 더한다. 낭독 목표(volumeMinutes)는 더하지 않고 가장 긴 것을 쓴다(안내 글에 보인다)
const sumWork = list => list.reduce((total, work) => {
    Object.entries(work).forEach(([key, value]) => { total[key] = key === 'volumeMinutes' ? Math.max(total[key] || 0, value) : (total[key] || 0) + value; });
    return total;
}, {});

// work: { tabs, images(교안 그림), slideImages(슬라이드 그림), ncs, gyosuan, qbank, art, ocr, volume(분량을 채우는 학습 탭 수), volumeCalls(그 긴 호출 수),
// practiceCalls(실습 시간을 정한 실습 탭의 더 드는 이어쓰기 호출) } 개수 →
// 본문 호출(body), 기다리는 시간으로 센 본문 호출(bodyWait), 짧은 호출(short), 그림 장수(images), 분량 보강·자동 수정의 긴 호출(long, 있을 때만).
// volumeCalls가 없으면 탭마다 480분 상한으로 센다
function estimateCallSplit(work = {}) {
    const rule = ESTIMATE_RULES;
    const tabs = (work.tabs || 0) * rule.tabCalls + (work.practiceCalls || 0);
    const others = (work.ncs || 0) * rule.ncsCalls + (work.qbank || 0) * rule.qbankCalls + (work.art || 0) * rule.artCalls + (work.ocr || 0);
    const long = work.volumeCalls ?? (work.volume || 0) * volumeCallsFor();
    return {
        body: tabs + others + (work.gyosuan || 0) * rule.gyosuanCalls,
        bodyWait: tabs + others + (work.gyosuan || 0) * rule.gyosuanWaitCalls,
        short: (work.images || 0) * rule.shortCallsPerImage + (work.slideImages || 0) * rule.shortCallsPerSlideImage,
        images: (work.images || 0) + (work.slideImages || 0),
        ...(long > 0 ? { long } : {})
    };
}

// 글 모델 호출 수. SVG 삽화는 글 모델이 그리므로 그림 장수도 더한다
function estimateCalls(work = {}, imageSource = 'gemini') {
    const split = estimateCallSplit(work);
    return Math.ceil(split.body + split.short + (split.long || 0) + (imageSource === 'svg' ? split.images : 0));
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

// 'short'는 그림 검색어·판정처럼 짧은 호출, 'long'은 기본 학습 분량 보강처럼 긴 글을 받는 호출. 본문 호출과 섞으면 평균이 흐려져 따로 모은다
// (예전 기록은 모델 이름 그대로라 본문 시간으로 읽힌다)
const aiTimingKey = (model, kind = '') => (kind === 'short' || kind === 'long' ? `${model}#${kind}` : model);

// 성공한 호출만 넣는다(대기·재시도 시간 포함이라 실제 체감에 가깝다). kind: 'short'면 짧은 호출
function recordAiTiming(model, ms, kind = '') {
    if (!model || !(ms > 0)) return;
    const key = aiTimingKey(model, kind);
    const all = readAiTimings();
    const previous = all[key] || { count: 0, avg: 0 };
    const count = Math.min(previous.count + 1, AI_TIMING_WINDOW);
    try {
        localStorage.setItem(AI_TIMING_KEY, JSON.stringify({ ...all, [key]: { count, avg: Math.round(previous.avg + (ms - previous.avg) / count) } }));
    } catch (err) {
        console.warn('[예고] 호출 시간을 저장하지 못했습니다:', err.message);
    }
}

// 호출 하나에 걸리는 시간(초). kind: 'short'면 짧은 호출(잰 기록이 없으면 본문 호출의 SHORT_CALL_FACTOR배), 'long'이면 긴 호출(LONG_CALL_FACTOR배)
function secondsPerCall(model, effort, timings = readAiTimings(), kind = '') {
    const seen = timings[aiTimingKey(model, kind)];
    if (seen && seen.count >= AI_TIMING_MIN_SAMPLES && seen.avg > 0) return { seconds: seen.avg / 1000, measured: true };
    const seconds = CALL_SECONDS[modelCostTier(model)] * (EFFORT_FACTOR[effort] || 1);
    const factor = { short: SHORT_CALL_FACTOR, long: LONG_CALL_FACTOR }[kind] || 1;
    return { seconds: seconds * factor, measured: false };
}

// 그림 한 장(초). 그림 모델 호출은 그 모델 이름으로 잰다(Higgsfield는 api.js generateImageAPI가 잰다)
function secondsPerImage(imageModel, source, timings = readAiTimings()) {
    const seen = timings[imageModel];
    if (seen && seen.count >= AI_TIMING_MIN_SAMPLES && seen.avg > 0) return seen.avg / 1000;
    return IMAGE_CALL_SECONDS[source] || IMAGE_CALL_SECONDS.gemini;
}

/* ---------- 가늠 ---------- */
// 시간은 범위(0.7배~1.5배)로. 한 번에 하나씩 차례로 부르므로 더한다(교수안 전개는 셋씩이라 bodyWait로 센다)
// imageSource: 'gemini'(그림 모델, 장마다 요금) · 'higgsfield'(크레딧) · 'svg'(글 모델이 그림) / exactImages: 남은 자리를 그대로 셌다
// imageAmount: 교안 이미지 양(안내에 쓴다) / imageSearch: 그림 검색 키가 있는지(그림 모델이 막혀도 교안 그림은 검색으로 찾는다)
function estimateSummary(work, { model = '', effort = 'medium', timings = readAiTimings(), imageModel = '', imageSource = 'gemini', exactImages = false, routed = false, imageAmount = '', imageSearch = false } = {}) {
    const split = estimateCallSplit(work);
    const body = secondsPerCall(model, effort, timings);
    const shortSeconds = secondsPerCall(model, effort, timings, 'short').seconds;
    const long = secondsPerCall(model, effort, timings, 'long');
    const longSeconds = long.measured ? long.seconds : body.seconds * LONG_CALL_FACTOR; // 잰 긴 호출이 없으면 본문 호출 시간(잰 값이면 그 값)의 3배
    const imageSeconds = imageSource === 'svg' ? body.seconds : secondsPerImage(imageModel, imageSource, timings);
    const seconds = split.bodyWait * body.seconds + split.short * shortSeconds + (split.long || 0) * longSeconds + split.images * imageSeconds
        + (work.images || 0) * ESTIMATE_GAPS.image + (work.tabs || 0) * ESTIMATE_GAPS.tab;
    const minutes = seconds / 60;
    const minutesLow = Math.max(1, Math.round(minutes * 0.7));
    const minutesHigh = Math.max(minutesLow, Math.ceil(minutes * 1.5));
    const tier = modelCostTier(model);
    return {
        calls: estimateCalls(work, imageSource), images: split.images, slideImages: work.slideImages || 0,
        volume: work.volume || 0, volumeAdv: work.volumeAdv || 0, volumeCalls: split.long || 0, volumeMinutes: work.volumeMinutes || ESTIMATE_VOLUME.minutes,
        imageSource, exactImages, routed, imageAmount, imageSearch,
        minutesLow, minutesHigh, tier, costLabel: COST_LABEL[tier], measured: body.measured
    };
}

function estimateTimeText(low, high) {
    if (high <= 1) return '1분 안쪽';
    if (high < 120) return `약 ${low}~${high}분`;
    return `약 ${Math.max(1, Math.round(low / 60))}~${Math.ceil(high / 60)}시간`;
}

// 그림 장수: 남은 자리를 셌으면 그 수, 아니면 '약'. 슬라이드 그림은 따로 밝힌다
function estimateImageCount(summary) {
    const count = summary.exactImages ? `${summary.images}장` : `약 ${summary.images}장`;
    if (!summary.slideImages) return count;
    return summary.images > summary.slideImages ? `${count}(슬라이드 그림 ${summary.slideImages}장 포함)` : `${count}(슬라이드 그림)`;
}

const IMAGE_SOURCE_TEXT = {
    gemini: label => `${label || '그림 모델'} · 장마다 요금`,
    higgsfield: label => `${label || 'Higgsfield'} · 크레딧 사용`,
    svg: () => '글 모델이 SVG로 그림 · 글 비용에 포함'
};

// 보이는 글: 글(호출 수·비용 수준), 그림(장수·누가 그리는지·요금), 걸리는 시간을 한 줄씩
function estimateLines(summary, { modelLabel = '', imageLabel = '' } = {}) {
    return [
        summary.calls ? `글: AI 호출 약 ${summary.calls}회 · 비용 ${summary.costLabel}${modelLabel ? `(${modelLabel})` : ''}` : '',
        summary.images ? `그림: ${estimateImageCount(summary)} · ${(IMAGE_SOURCE_TEXT[summary.imageSource] || IMAGE_SOURCE_TEXT.gemini)(imageLabel)}` : '',
        `걸리는 시간: ${estimateTimeText(summary.minutesLow, summary.minutesHigh)}`
    ].filter(Boolean);
}

// 그림 모델을 못 쓸 때(무료 키 등) 어떻게 되는지. 검색 키가 있으면 교안 그림은 검색으로 찾는다(api.js processImageTags). 슬라이드 그림은 검색하지 않는다
function imageBlockNote(summary) {
    if (!summary.images || summary.imageSource !== 'gemini') return '';
    const head = '무료 키라면 그림 모델을 못 쓸 수 있습니다.';
    if (!summary.imageSearch) return `${head} 그때는 그림 자리만 남깁니다.`;
    if (summary.images <= summary.slideImages) return `${head} 그때는 슬라이드 그림을 만들지 못합니다.`;
    return `${head} 그때도 교안 그림은 검색으로 찾고 못 찾은 자리만 남깁니다${summary.slideImages ? '(슬라이드 그림은 만들지 못합니다)' : ''}.`;
}

// 학습 탭(기본학습·심화학습) 분량 채우기 안내. 탭이 하나면 그 탭의 긴 호출 수, 여럿이면 탭 수와 모두 더한 긴 호출 수를 보인다
function estimateVolumeNote(summary) {
    if (!summary.volume) return '';
    const minutes = summary.volumeMinutes || ESTIMATE_VOLUME.minutes;
    const chars = (minutes * ESTIMATE_VOLUME.charsPerMinute).toLocaleString('ko-KR');
    const adv = summary.volumeAdv || 0;
    const name = !adv ? '기본학습' : adv >= summary.volume ? '심화학습' : '기본학습·심화학습';
    if (summary.volume === 1) {
        const calls = Math.max(1, Math.round(summary.volumeCalls || 0));
        return `${name}은 낭독 ${minutes}분(공백 포함 약 ${chars}자)이 될 때까지 섹션마다 나눠 보강하고 자동 수정해 긴 호출이 약 ${calls}번 늘어납니다.`;
    }
    const total = Math.max(summary.volume, Math.round(summary.volumeCalls || 0)).toLocaleString('ko-KR');
    return `${name}은 탭마다 낭독 ${minutes}분(공백 포함 약 ${chars}자)이 될 때까지 섹션마다 나눠 보강하고 자동 수정해 탭 ${summary.volume}개에 긴 호출이 약 ${total}번 늘어납니다.`;
}

function estimateNote(summary, model = '') {
    return [
        summary.measured ? '시간은 이 브라우저에서 잰 최근 호출 평균으로 셌습니다.' : '시간은 모델과 추론 강도로 어림했습니다.',
        estimateVolumeNote(summary),
        summary.tier === 'low' && /gemini/i.test(model) ? '무료 키는 분당 호출 한도가 있어 더 걸릴 수 있습니다.' : '',
        imageBlockNote(summary),
        summary.images > summary.slideImages && !summary.exactImages && summary.imageAmount === 'all' ? "교안 이미지 양이 '모두'라 글이 길면 그림이 더 늘어납니다." : '',
        summary.routed ? '역할별 AI 분배가 켜져 있어 일부 글은 다른 모델이 씁니다.' : '',
        '실제 비용은 AI 공급자 요금표를 따릅니다.'
    ].filter(Boolean).join(' ');
}

// 선택지 이름에서 괄호 설명을 뗀다: 'Nano Banana 2.1 (권장 · 최고 성능)' → 'Nano Banana 2.1'
const estimateOptionLabel = (options, value) => String(options.find(option => option.value === value)?.label || value || '').replace(/\s*\(.*\)\s*$/, '');

// 그림을 누가 그리는지(api.js generateImageAPI의 순서와 같다): 'svg'(글 모델이 SVG로) · 'higgsfield'(크레딧) · 'gemini'(그림 모델, 장마다 요금)
// 그림 설정을 읽을 수 없으면(테스트 등) Gemini로 본다. 설정 함수는 그림 모델이 있을 때만 부른다
function estimateImageSource(imageModel) {
    if (!imageModel) return 'gemini';
    if (typeof usesSvgIllustration === 'function' && usesSvgIllustration()) return 'svg';
    if (typeof isHiggsfieldModel === 'function' && isHiggsfieldModel(imageModel) && typeof higgsfieldReady === 'function' && higgsfieldReady()) return 'higgsfield';
    return 'gemini';
}

// 지금 설정(본문 모델·추론 강도·교안 이미지 양·그림 모델)
function currentEstimateSettings() {
    const textModel = typeof TEXT_MODEL !== 'undefined' ? TEXT_MODEL : '';
    // 역할별 분배가 켜져 있으면 본문은 그 모델이 쓴다(ai-routing.js)
    const model = textModel && typeof roleModel === 'function' ? roleModel('write') : textModel;
    const imageOptions = typeof IMAGE_MODEL_OPTIONS !== 'undefined' ? IMAGE_MODEL_OPTIONS : [];
    const chosen = typeof IMAGE_MODEL !== 'undefined' ? IMAGE_MODEL : '';
    const imageSource = estimateImageSource(chosen);
    const isGeminiImage = value => !!value && value !== ESTIMATE_SVG_MODEL && !String(value).startsWith('higgsfield:');
    // Gemini 쪽은 실제로 먼저 부르는 모델(고른 모델이 Gemini 그림 모델이 아니면 목록의 첫 Gemini 그림 모델)
    const imageModel = imageSource === 'gemini' && !isGeminiImage(chosen) ? (imageOptions.find(option => isGeminiImage(option.value))?.value || chosen) : chosen;
    return {
        model,
        modelLabel: estimateOptionLabel(typeof TEXT_MODEL_OPTIONS !== 'undefined' ? TEXT_MODEL_OPTIONS : [], model),
        routed: !!textModel && model !== textModel,
        effort: typeof REASONING_EFFORT !== 'undefined' ? REASONING_EFFORT : 'medium',
        imageAmount: typeof LESSON_IMAGE_AMOUNT !== 'undefined' ? LESSON_IMAGE_AMOUNT : 'section',
        imageModel, imageSource,
        imageLabel: estimateOptionLabel(imageOptions, imageModel),
        imageSearch: typeof imageSearchReady === 'function' && !!imageSearchReady() // 그림 검색 키(api.js)
    };
}

// 창 안에 넣는 예고 상자. exactImages: 그림 장수를 남은 자리에서 셌을 때
function estimateBoxHtml(work, { exactImages = false } = {}) {
    const settings = currentEstimateSettings();
    const summary = estimateSummary(work, { ...settings, exactImages });
    const rows = estimateLines(summary, settings).map(line => `<li>${escapeHtml(line)}</li>`).join('');
    return `<div class="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2">
        <p class="text-xs font-bold text-textLight"><i class="ph-bold ph-gauge text-accent" aria-hidden="true"></i> 미리 보기</p>
        <ul class="mt-0.5 space-y-0.5 text-xs text-textLight">${rows}</ul>
        <p class="text-[0.6875rem] text-textMuted mt-0.5">${escapeHtml(estimateNote(summary, settings.model))}</p>
    </div>`;
}

// 한 번 묻고 시작하는 일괄 작업(차시 전체 생성, 일괄 이미지 찾기, 콘텐츠 정리 등). exactImages: 그림 장수를 남은 자리에서 셌을 때
function confirmWithEstimate(message, work, { title = '시작할까요?', okLabel = '시작', exactImages = false } = {}) {
    const settings = currentEstimateSettings();
    const summary = estimateSummary(work, { ...settings, exactImages });
    return confirmAsync(`${message}\n\n${estimateLines(summary, settings).join('\n')}\n${estimateNote(summary, settings.model)}`, { okLabel, tone: 'primary', title });
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        modelCostTier, lessonWork, volumeCallsFor, practiceExtraCalls, tabImageCount, sumWork, estimateCallSplit, estimateCalls, recordAiTiming, readAiTimings, secondsPerCall, secondsPerImage,
        estimateSummary, estimateTimeText, estimateLines, estimateNote, imageBlockNote, estimateImageSource, defaultSlideImageCount,
        estimateBoxHtml, confirmWithEstimate, currentEstimateSettings
    });
}
