// data.js - 설정값, 상수, 프롬프트, 모의 데이터 관리

// 0. 공통 유틸리티 (모든 모듈에서 참조 — 반드시 data.js에 위치)
function extractText(data) {
    try {
        const parts = data?.candidates?.[0]?.content?.parts;
        if (!parts || parts.length === 0) return "";
        // Thinking 파트(thought: true)를 건너뛰고 실제 응답 텍스트만 반환
        const textPart = parts.filter(p => !p.thought).map(p => p.text).join('');
        let text = textPart || parts[parts.length - 1]?.text || "";

        // [방어 코드] AI가 프롬프트를 무시하고 &nbsp; 대신 비가시 특수 공백(U+00A0)을 출력하는 문제 해결
        // 1. 마크다운 리스트(-, *, 1. 등) 들여쓰기에 잘못 사용된 특수 공백이나 일반 공백이 섞인 경우, 리스트 문법을 보존하기 위해 들여쓰기 공백을 일반 공백(스페이스바) 2칸으로 묶어버림 (또는 제거)
        // 리스트 문구 앞에는 원래 '&nbsp;' 사용 자체가 금지입니다.
        text = text.replace(/^[ \u00A0]+([-*+]|\d+\.) /gm, '  $1 ');
        // 2. 그 외(일반 텍스트 단락 등)에 쓰인 비가시 특수 공백은 모두 플랫폼 호환을 위해 명시적인 문자열 '&nbsp;'로 치환함
        text = text.replace(/\u00A0/g, '&nbsp;');

        // 3. 블록 요소(table, div, 코드펜스) 전 빈줄 보장 — 마크다운 파서 호환
        text = text.replace(/([^\n])\n(<(?:table|div|blockquote)[\s>])/gi, '$1\n\n$2');
        text = text.replace(/([^\n])\n(```)/g, '$1\n\n$2');

        // 4. GFM 테이블 전후 빈 줄 보장 (marked.js 파싱 조건)
        text = text.replace(/([^\n])\n(\|[^\n]+\|[^\n]*\n\|[\s:|-]+\|)/g, '$1\n\n$2');
        text = text.replace(/(\|[^\n]+\|)\n([^\n|])/g, '$1\n\n$2');

        // 5. 마크다운 제목(#) 앞 빈 줄 보장 — 이전 줄이 비어있지 않으면 빈줄 삽입
        text = text.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2');
        // 5.1. 제목 앞 들여쓰기 공백 제거 — 4칸 이상 공백은 코드 블록으로 인식됨
        text = text.replace(/^[ \t]+(#{1,6}\s)/gm, '$1');

        // 6. **볼드** 마크다운 깨짐 방지 — 붙어있는 특수문자(', ", ·) 앞뒤 공백 보정
        text = text.replace(/\*\*\s*'([^']+)'\s*\*\*/g, '**$1**');

        // 6.1. 표 셀 내부 **볼드** 파싱 보장 — 파이프 뒤 **에 공백 추가
        text = text.replace(/\|\s*\*\*/g, '| **');
        text = text.replace(/\*\*\s*\|/g, '** |');

        // ================================================================
        // 7. 넘버링/이모지/하위항목 정규화 (최우선 규칙)
        // 전체 줄 단위 2-pass 방식으로 처리
        // ================================================================
        const EMOJI_CHARS = '💡✅☑️🎮⚠️⚙️ℹ️💬🗣️💥🔑🎯🏆📌🔍🎨📝🧠🎵🎬📊🔧🎓🎲🕹️📱💻🖥️';

        function hasEmoji(str) {
            if (!str) return false;
            for (const ch of EMOJI_CHARS) { if (str.includes(ch)) return true; }
            return /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(str);
        }

        // Pass 1: 넘버링/이모지/불릿 정규화 (최우선)
        // ★ 이모지는 항상 단독 줄 (불릿/넘버링 뒤에 이모지 금지)
        // ★ "핵심 개념:" 제목줄 → 넘버링 유지 (1\. escape로 <ol> 방지)
        // ★ 제목/이모지 뒤 하위항목 → 들여쓰기 불릿 변환
        {
            const lines = text.split('\n');
            const result = [];
            let afterTitleLine = false;

            for (let i = 0; i < lines.length; i++) {
                let line = lines[i];

                // ★★ 선처리: 불릿(- ) 뒤에 이모지가 오는 경우 → 불릿 제거, 이모지만 남김
                const bm = line.match(/^(\s*)[-*+]\s+(.*)/);
                if (bm && hasEmoji(bm[2])) {
                    line = bm[2]; // 불릿+들여쓰기 제거, 이모지 줄로 독립
                }

                const numMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);

                if (numMatch) {
                    const indent = numMatch[1];
                    const num = numMatch[2];
                    const content = numMatch[3];

                    // Case A: 이모지가 포함된 넘버링 줄 → 넘버링 제거
                    if (hasEmoji(content)) {
                        result.push(indent + content);
                        afterTitleLine = true;
                        continue;
                    }

                    // Case B: 볼드 제목으로 시작하는 넘버링 줄 → 넘버링 제거
                    if (/^\*\*[^*]+\*\*/.test(content)) {
                        result.push(indent + content);
                        afterTitleLine = true;
                        continue;
                    }

                    // Case C: 이전 줄이 제목 줄이었으면 → 하위항목으로 들여쓰기 불릿 변환
                    if (afterTitleLine) {
                        result.push('    - ' + content);
                        continue;
                    }

                    // Case D: 들여쓰기 넘버링 → 불릿 변환
                    if (indent.length >= 2) {
                        result.push(indent + '- ' + content);
                        continue;
                    }

                    // 그 외: 넘버링 유지
                    result.push(line);
                    afterTitleLine = false;
                } else {
                    // 넘버링이 아닌 줄
                    result.push(line);
                    const trimmed = line.trim();
                    if (/^#{1,4}\s/.test(trimmed)) {
                        afterTitleLine = true;
                    } else if (hasEmoji(trimmed) && !/^[-*+]\s/.test(trimmed)) {
                        // 이모지 단독 줄 → 제목 역할
                        afterTitleLine = true;
                    } else if (trimmed === '' || trimmed === '<br>' || trimmed.startsWith('---')) {
                        afterTitleLine = false;
                    } else if (/^\*\*[^*]+\*\*/.test(trimmed)) {
                        afterTitleLine = true;
                    } else {
                        afterTitleLine = false;
                    }
                }
            }
            text = result.join('\n');
        }

        // Pass 2: 불필요한 라벨 패턴 제거
        text = text.replace(/▣\s*이론\s*설명\s*[:：]?\s*/g, '');
        // "핵심 개념:" 문구 삭제 (볼드 안/밖 모두)
        text = text.replace(/\*\*\s*핵심\s*개념\s*[:：]\s*/g, '**');
        text = text.replace(/핵심\s*개념\s*[:：]\s*/g, '');

        // 볼드 제목 끝 콜론 제거 — 줄 시작/불릿 뒤의 볼드만 (인라인 볼드는 유지)
        // "- **게임 기획의 본질:**" → "- **게임 기획의 본질**"
        text = text.replace(/^(\s*[-*+]?\s*)\*\*([^*]+?)[:：]\s*\*\*/gm, '$1**$2**');

        // 볼드/콜론 뒤 백슬래시(\) 제거 — "**제목**\" → "**제목**"
        text = text.replace(/(\*\*[^*]+\*\*)\s*\\\s*/g, '$1 ');
        // 줄 끝 백슬래시 제거 (마크다운 줄바꿈 문자가 텍스트로 노출되는 문제)
        text = text.replace(/\\\s*$/gm, '');

        // 7.5. 문장 중간 이모지 → 줄바꿈하여 맨 앞으로 이동
        // "설명합니다. 💡 핵심" → "설명합니다.\n💡 핵심"
        {
            const emojiPattern = new RegExp(
                `([가-힣a-zA-Z0-9.,:;!?)\\]'"…])\\s+(${EMOJI_CHARS.split('').filter(c => c.trim()).join('|')})`,
                'g'
            );
            // 간단하게: 한글/영문/숫자/구두점 뒤에 공백+이모지 → 줄바꿈
            text = text.split('\n').map(line => {
                if (/^\s*\|/.test(line) || /^\s*```/.test(line) || /<\/?(?:td|th|tr|table)\b/i.test(line)) return line;
                // 줄 중간에 이모지가 있으면 앞에서 줄바꿈
                for (const ch of EMOJI_CHARS) {
                    if (!ch.trim()) continue;
                    const idx = line.indexOf(ch);
                    // 이모지가 줄 맨 앞(0~1위치)이면 OK, 중간이면 줄바꿈
                    if (idx > 1) {
                        const before = line.substring(0, idx).trimEnd();
                        const after = line.substring(idx);
                        // 불릿/헤딩 뒤가 아니라 실제 텍스트 뒤인 경우만
                        if (before && !/^[-*+#]\s*$/.test(before) && !/^\s*$/.test(before)) {
                            line = before + '\n' + after;
                        }
                    }
                }
                return line;
            }).join('\n');
        }

        // 8. 한국어 마침표 뒤 줄바꿈 (교안 가독성)
        // 표 행(GFM: |...|, HTML: <td>/<th>) 내부에서는 줄바꿈 제외
        text = text.replace(/^([^\n]+)$/gm, (line) => {
            // GFM 표 행 (파이프로 시작하거나 파이프 포함 행) 또는 HTML 표 요소 내부는 건너뜀
            if (/^\s*\|/.test(line) || /<\/?(?:td|th|tr|table)\b/i.test(line)) return line;
            // 코드블록 펜스는 건너뜀
            if (/^\s*```/.test(line)) return line;
            return line.replace(/([가-힣])\.\s+(?=[가-힣])/g, '$1.\n');
        });

        return text;
    } catch (e) {
        console.error("extractText 실패:", e);
        return "";
    }
}
function safeJSONParse(text) {
    if (!text) return null;
    try {
        let cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```$/i, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        console.error("JSON 파싱 실패:", e, "\n원본:", text.substring(0, 200));
        return null;
    }
}

// 1. API 설정 및 애플리케이션 상수
// Supabase Edge Function 프록시를 통해 Gemini API 호출 (서버 측 키 관리)
const GEMINI_PROXY_URL = 'https://pkwbqbxuujpcvndpacsc.supabase.co/functions/v1/gemini-proxy';
let apiKey = '';
try {
    apiKey = localStorage.getItem('gemini_api_key') || '';
} catch (e) {
    console.warn("localStorage 접근 불가 (API Key):", e);
}
const STORAGE_KEY = 'agent_curriculum_v4_7';
let TEXT_MODEL = 'gemini-2.5-flash';
let IMAGE_MODEL = 'gemini-3.1-flash-image-preview';


// [Phase F10] Google Custom Search API 설정 (다중 키 롤링용)
let googleSearchCx = '';
let googleSearchApiKeys = [];
let currentSearchKeyIndex = 0;

// [Phase F10] 무료 스톡 이미지(Pixabay) 전역 변수
let pixabayApiKey = '';

// 모델 선택지 목록
const TEXT_MODEL_OPTIONS = [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (권장)' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];
const IMAGE_MODEL_OPTIONS = [
    { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image (Preview, 권장)' },
    { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image (Preview)' },
    { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
];

// 모델 런타임 변경 + localStorage 저장
function updateTextModel(val) {
    if (val) { TEXT_MODEL = val; try { localStorage.setItem('gemini_text_model', val); } catch (e) { } }
}
function updateImageModel(val) {
    if (val) { IMAGE_MODEL = val; try { localStorage.setItem('gemini_image_model', val); } catch (e) { } }
}

// 저장된 모델 복원
try {
    const savedText = localStorage.getItem('gemini_text_model');
    const savedImage = localStorage.getItem('gemini_image_model');
    if (savedText && TEXT_MODEL_OPTIONS.some(o => o.value === savedText)) TEXT_MODEL = savedText;
    if (savedImage && IMAGE_MODEL_OPTIONS.some(o => o.value === savedImage)) IMAGE_MODEL = savedImage;

    // [Phase F10] 구글 검색 상태 복원
    googleSearchCx = localStorage.getItem('google_search_cx') || '';
    const keysStr = localStorage.getItem('google_search_api_keys');
    if (keysStr) googleSearchApiKeys = JSON.parse(keysStr);

    // [Phase F10] 무료 스톡(Pixabay) 검색 상태 복원
    pixabayApiKey = localStorage.getItem('pixabay_api_key') || '';
} catch (e) { console.warn("localStorage 접근 불가 (Model/Search):", e); }

// 1-1. API Key 런타임 관리
function updateApiKey(newKey) {
    if (newKey && newKey.trim()) {
        apiKey = newKey.trim();
        try {
            localStorage.setItem('gemini_api_key', apiKey);
        } catch (e) {
            console.warn("localStorage 접근 불가 (API Key 저장):", e);
        }
        return true;
    }
    return false;
}

// 1-2. [Phase F10] 구글 검색 API 설정 저장
function updateGoogleSearchSettings(cx, keysStr) {
    cx = (cx || '').trim();
    const keysArray = (keysStr || '')
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0);

    googleSearchCx = cx;
    googleSearchApiKeys = keysArray;
    currentSearchKeyIndex = 0; // 설정 바뀌면 인덱스 초기화

    try {
        localStorage.setItem('google_search_cx', googleSearchCx);
        localStorage.setItem('google_search_api_keys', JSON.stringify(googleSearchApiKeys));
        return true;
    } catch (e) {
        console.warn("localStorage 접근 불가 (Google Search 설정):", e);
        return false;
    }
}

// 1-3. [Phase F10] 무료 스톡 이미지(Pixabay) API 설정 저장
function updatePixabaySetting(newKey) {
    if (newKey !== undefined) {
        pixabayApiKey = newKey.trim();
        try {
            localStorage.setItem('pixabay_api_key', pixabayApiKey);
            return true;
        } catch (e) {
            console.warn("localStorage 접근 불가 (Pixabay API Key 저장):", e);
        }
    }
    return false;
}

// 2. 프롬프트 생성용 핵심 컨텍스트 (페르소나 및 룰셋)
const CONTEXT_CORE = {
    personas: {
        orchestrator: "당신은 [AntiGravity Curriculum Orchestrator]입니다. 게임 기획 교육과정 전문 설계자입니다.",
        instructor: "당신은 게임 기획 전문 강사입니다.",
        assistant: "당신은 교안 작성 및 수정 보조 AI입니다."
    },
    rules: {
        json_only: "응답은 반드시 순수한 JSON Array여야 하며 마크다운 코드블록을 포함하지 마십시오. 형식: [{\"id\": 1, \"title\": \"차시명\", \"description\": \"목표\", \"hours\": 4}]",
        blueprint_scope: "5~10개의 모듈로 구성하세요.",
        markdown_structure: "교안 구조를 다음 위계로 반드시 구성하세요: " +
            "1. [개요(Overview)] — 차시 주제 소개, 교육 목적 제시, 흥미 유도 도입부. " +
            "개요 섹션 작성 규칙: " +
            "(a) 모든 내용은 반드시 불릿(-)으로 작성. 이모지 사용 금지. " +
            "(b) 한국어 마침표(.) 뒤에는 줄바꿈하여 가독성을 높이세요. " +
            "(c) **볼드 키워드:** 뒤의 설명은 반드시 줄바꿈 후 들여쓰기 불릿(  -)으로 작성. " +
            "예시: '- **전투의 재미:**\\n    - 스킬과 상태 이상의 설계 구조를 학습합니다.' " +
            "2. [학습 목표(Objectives)] — 이 수업으로 얻을 지식과 역량을 반드시 불릿(-)으로 명시. 이모지는 사용하지 마세요. '이 차시를 마치면 다음을 할 수 있습니다' 같은 서두 문구는 절대 사용하지 마세요. 바로 목표 항목 불릿으로 시작하세요. " +
            "3. [핵심 내용(Detailed Content)] — 반드시 다음 하위 흐름을 따를 것: " +
            "(a) 개념 정의(Concepts) → (b) 이론 설명 → (c) 구체적 예시 → (d) 사례 분석. " +
            "각 하위 항목은 ### ■ 레벨 이하 헤딩으로 분리하세요. " +
            "4. [실습/예제(Practice)] — 학생이 자력으로 수행하는 과제. " +
            "각 실습 항목에는 [예상 소요시간], [난이도(초급/중급/고급)], [평가 기준]을 명시하세요. " +
            "5. [심화(Advanced)] — 고성취자를 위한 참고자료, 도전 과제, 추가 팁(TMI/Info 박스).",
        image_tags: "이미지 태그 <!-- [IMG: \"영어 키워드\"] -->를 다음 위치에 반드시 삽입하세요: " +
            "①차시 최상단 — 학습 분위기를 설정하는 대표 이미지. " +
            "②제목 수준 2(##) 마다 — 해당 ## 제목 바로 아래에 섹션 대표 이미지 삽입. " +
            "③절차/프로세스 설명 시 — **다이어그램**으로 출력(mermaid 또는 구조도). " +
            "④교안 내용에 '예시'가 있을 경우 — 해당 단락 제목 바로 아래에 예시 관련 이미지 삽입. " +
            "절대 마크다운 이미지 텍스트(![alt](url))나 html <img src=\"local:...\"> 구문을 직접 출력하지 마세요. " +
            "오직 <!-- [IMG: \"영어 키워드\"] --> 형태의 주석 태그만 허용됩니다. 각 태그 전후에 빈 줄을 반드시 삽입하세요.",
        quiz_format: "정답과 해설을 포함한 4지선다형 객관식 퀴즈 3문제를 만들어주세요. 마크다운 형식으로 출력하세요.",
        concise_edit: "수정된 텍스트만 출력하세요. 부가 설명은 절대 생략합니다.",

        // ── Phase 0: 우선 규칙 + 요소 정의 (formattingrules.md §0~1) ──

        priority_rules: "규칙과 예시가 충돌할 경우, 반드시 이 규칙 문서를 우선하세요. 예시는 톤·스타일 참조용일 뿐입니다. " +
            "요소 관계 식별: 시각적 근접성이 아니라, 각 요소의 정확한 유형(헤딩/본문/블록)을 먼저 판별한 뒤 해당 규칙을 적용하세요. " +
            "예시: 헤딩 아래 이미지 → 텍스트 배치는 '헤딩→본문'이 아니라 '헤딩→블록' + '블록→본문' 두 관계입니다.",

        element_definitions: "[서사 요소] 헤딩(#~): 계층 제목, 본문(Body): 일반 텍스트·리스트(-), 핵심개념(Key Concept): **볼드 헤딩** + 들여쓰기 설명. " +
            "[블록 요소] 이미지(<p align='center'><img>), 코드블록(```), HTML 표(<table>), 인용(>). 블록은 '콘텐츠'로 취급하며 간격 규칙에서 별도 처리. " +
            "[간격 존] [Enter + <br> + Enter] 조합의 물리적 빈 공간. " +
            "[단락] 특정 헤딩(L1~L4) 시작부터 다음 헤딩 직전 간격 존까지의 논리 묶음.",

        // ── Phase 1: 기반 규칙 (handoff_to_antigravity.md §Phase 1) ──

        tone: "헤딩(#, ##, ### 등): 체언종결 또는 명사종결(~음, ~함). 본문: 합쇼체(~합니다, ~입니다). 초보자 수준으로 쉽게 설명하되, 전문 용어는 유지하고 괄호 안에 풀어쓴 정의를 병기하세요.",

        heading_hierarchy: "헤딩 위계를 반드시 준수하세요: Level 1 = '# 📝 [차시 주제]', Level 2 = '## [핵심 섹션]', Level 3 = '### ■ [하위 항목]', Level 4 = '####   ▣ [세부 항목]'. 각 레벨에 지정된 접두 기호(📝, ■, ▣)를 반드시 사용하세요.",

        semantic_icons: "본문 내 핵심 키워드 앞에 시맨틱 아이콘을 삽입하세요: 💡 = 중요 개념/핵심 포인트, ✅ = 학습 체크리스트/확인 사항, 🎮 = 실무·현장 사례/게임 예시, ⚠️ = 주의사항/흔한 실수, ⚙️ = 실습 가이드/따라하기 단계. 아이콘은 해당 문단 또는 불릿(-) 첫머리에 배치합니다. [중요] 숫자 넘버링 리스트(1. 2. 3.)에는 이모지를 사용하지 마세요. 넘버링과 이모지를 함께 쓰지 않습니다. 올바른 예: '1. 게임의 골격 만들기', 잘못된 예: '1. 💡 게임의 골격 만들기'.",

        indentation: "Level 4(####) 이상 헤딩 아래의 접두사가 없는 일반 줄글(텍스트 블록) 첫머리에는 들여쓰기를 위해 명시적으로 '&nbsp;&nbsp;' 문자열을 출력하세요. 주의: 실제 유니코드 특수 공백(U+00A0 등)을 출력하지 말고 문자열 형태를 유지해야 합니다. 단, 일반 줄글 형태 자체를 지양하고 최대한 마크다운 문법(불릿 등)을 활용해 구조화하세요.",

        body_lists: "본문 리스트 들여쓰기 규칙: Depth 1(-) = 기본 설명, Depth 2(  -) = 하위 항목 상세, Depth 3(    -) = 추가 세부. 리스트 기호(-) 앞에는 무조건 일반 스페이스바 2칸 들여쓰기만 사용하세요. 마크다운 렌더링이 깨지는 1순위 원인이므로 리스트 구조 앞이나 중간에는 절대 '&nbsp;' 문자열이나 특수 공백을 사용하지 마십시오.",

        numbering_usage: "[넘버링 사용 규칙 — 최우선]\n" +
            "숫자 넘버링(1. 2. 3.)은 극히 제한적으로만 사용하세요:\n" +
            "- 허용: 순서가 있는 절차/단계를 설명할 때만 (예: '1단계→2단계→3단계')\n" +
            "- 금지: 개념 나열, 설명, 특징, 역할, 목표 나열 시 넘버링 사용 금지\n" +
            "- 금지: 상위 제목 아래 하위 설명에 넘버링 사용 금지\n" +
            "- 대신 사용: 모든 나열은 불릿 기호(- 또는 *)를 사용하세요.\n\n" +
            "[상위-하위 구조 규칙]\n" +
            "볼드 제목(**제목**) 아래의 설명/하위 항목은 반드시 불릿(- 또는 *)으로 작성:\n" +
            "✗ 잘못된 예:\n1. **핵심 개념: 시스템 설계**\n2. 게임을 구성하는 모든 규칙...\n3. 캐릭터 능력치...\n" +
            "✓ 올바른 예:\n**핵심 개념: 시스템 설계**\n- 게임을 구성하는 모든 규칙...\n- 캐릭터 능력치...",

        text_emphasis: "텍스트 강조 2종: Bold(**...**) = 개념·키워드 강조, Inline Code(`...`) = 파일명·단축키·코드 스니펫. 두 가지를 일관되게 사용하세요.",

        // ── Phase 3: 이미지 태그 전략 + 에비던스 + HTML 표 ──

        evidence_based: "모든 설명에는 초보자도 이해하기 쉽도록 구체적인 상황을 가장 먼저 제시하세요. '정의 → 이론 설명 → 구체적 예시 → [실무적 팁/해결책/행동 지침]' 흐름을 반드시 지키세요.",

        real_world_references: "교안 본문 작성 시 추상적인 설명에 그치지 말고, 아래 패턴들을 적극 활용하세요.\n" +
            "1. **실무적 행동 패턴 (✅)**: 지표나 수치, 개념에 대해 결과만 말하지 말고 '이 수치가 높으면 ~하므로 기획자는 ~해야 한다' 식의 구체적 액션 아이템을 제안하세요.\n" +
            "2. **조합 분석 예시 표기 (✅ 실무적 조합 예시)**: 두 가지 이상 개념이 있을 경우 표로 묶어서 그 둘의 연관성을 비교 분석하는 파트를 따로 마련하세요.\n" +
            "3. **추가 참고 팁 (💬 TMI/Info)**: 실무 현장에서 자주 오해하거나 간과하는 사항은 별도 정보성 문장으로 분리하세요.",

        table_html_style: "교안 내 표를 생성할 때는 반드시 인라인 스타일 HTML Table을 사용하세요(마크다운 표 사용 금지). " +
            "[중요] 표(table) 안에는 이모지를 절대 사용하지 마세요. th, td 셀 내부에 💡, ✅, 🎮, ⚠️ 등 어떤 이모지도 넣지 마세요. " +
            "[기본 구조] <table style=\"border-collapse: collapse; width: 100%;\">. 모든 th, td에 border: 1px solid black; padding: 10px; 내열 적용. th에 background-color: #f2f2f2; text-align: center; padding: 10px; 적용. " +
            "[칼럼 너비 전략] Case A — 1열이 짧은 단어·라벨(번호, 이름, 구분 등): 1열 th에 width: 120px(또는 100~200px) 고정. " +
            "Case B — 1열이 긴 문장·문장형 제목: 1열 th에 width 속성 제거, 자연 확장. " +
            "Case C — 대등 비교(A vs B): 비교 칼럼에 width 미적용, 나머지 칼럼에만 width 적용하여 균등 분배. " +
            "[텍스트 정렬] 1열 td: font-weight: bold; text-align: center;(단, 긴 문장이면 text-align: left; 허용). 나머지 열: 줄글이 길면 text-align: left;, 짧은 단답형이면 text-align: center;. " +
            "[내부 요소] 리스트(<ul>,<ol>) 사용 시 margin: 0; padding-left: 20px; line-height: 1.6; 적용. 표 내부는 마크다운을 혼용해도 됩니다.",

        // ── Phase 4: 간격(Spacing) 규칙 (formattingrules.md §3.2~3.3) ──

        spacing: "교안 작성 시 요소 간 간격을 다음 매트릭스에 따라 적용하세요: " +
            "①헤딩 내부(##~ 바로 아래 본문) → 간격 없음(0). 헤딩과 설명은 하나의 단락이므로 붙여 씁니다. " +
            "②헤딩-블록 분리(##~ 아래 이미지/표/코드) → 줄바꿈 1회([Enter]). <br> 없이 최소 간격. " +
            "③문단 분리(문단↔문단, 문단↔헤딩) → 1줄 간격([Enter + <br> + Enter]). 논리 단위 변경 시. " +
            "④요소 분리(텍스트↔블록) → 1줄 간격([Enter + <br> + Enter]). 설명과 자료 사이. " +
            "⑤블록 연속(블록↔블록) → 2줄 간격([Enter + <br><br> + Enter]). 서로 다른 자료가 연속될 때. " +
            "⑥차시 전환(→ # 📝) → 구분선 세트(<br><br> + --- + <br>). " +
            "특수 패턴(우선 적용): " +
            "(A) 샌드위치 구조: 블록(A)→텍스트(B)→블록(C) 배치 시, B 위에 <br> 1회, B 아래에 <br><br> 2회. " +
            "(B) 차시 제목 예외: # 📝 바로 아래는 별도 규칙 없으면 줄바꿈 1회. " +
            "(C) 연속 미디어 예외: 연속 이미지/영상은 [Enter]만으로 구분.",

        // ── 서식 워크플로우 (formattingrules.md §6) ──

        formatting_workflow: "교안 작성 시 다음 워크플로우를 순차 수행하세요: " +
            "Step 1(파싱): 입력 원문을 스캔하여 단락 단위로 분리하고, 각 요소를 서사(헤딩/본문) 또는 블록(이미지/표/코드/인용)으로 라벨링. " +
            "Step 2(드래프트): 남은 요소의 배치 순서를 확인. " +
            "Step 3-1(타이포 매핑): 모든 헤더를 스캔하여 ###에 ■, ####에 &nbsp;&nbsp; ▣를 강제 부착. " +
            "Step 3-2(아이콘 주입): 본문 키워드(예시, 팁, 주의 등)를 찾아 해당 줄 시작에 시맨틱 아이콘 삽입. " +
            "Step 3-3(들여쓰기 주입): #### 이상 헤딩에 &nbsp;&nbsp; 삽입, Depth 2+ 리스트·접두사 없는 텍스트에 &nbsp;&nbsp; 강제 삽입. " +
            "Step 3-4(간격 적용): spacing 매트릭스 6패턴 + 특수 패턴 3종 적용. 샌드위치 구조 발생 여부를 정밀 검사. " +
            "Step 3-5(톤 적용): 헤딩은 체언종결, 본문은 합쇼체로 최종 변환. " +
            "Step 4(출력): 위 과정을 거친 최종본만 출력.",

        // ── 용어 통일 (glossary.md §1) ──

        glossary_terms: "교안 생성 시 다음 용어를 정확히 구분하여 사용하세요: " +
            "과정(Course) = 학습의 최상위 주제 단위. " +
            "교과(Session) = 과정 내 세부 주제, 1일 수업(8시간) 기준. " +
            "차시(Lesson Plan) = 마크다운 교안, 기본학습/기본실습/심화학습/심화실습 4종. " +
            "레벨테스트(Level Test) = 별칭 '메인 퀘스트', 교과 전체의 최종 과제. " +
            "기본 실습(Basic Practice) = 별칭 '일일 퀘스트', 각 차시 끝 실습 과제.",

        // ── 컨벤션: 강사 Callout 규칙 (v8 — 읽기만 해도 수업 가능한 강사 스크립트) ──
        instructor_callout:
            '★★★ 강사 Callout 최우선 규칙 ★★★\n' +
            '각 ## 섹션 직후에 반드시 <div class="instructor-callout"> 블록을 삽입하세요.\n' +
            '이 블록은 "교안을 읽기만 해도 바로 수업할 수 있는 강사 대본"입니다.\n' +
            '짧은 메모가 아니라, 실제로 입을 열어 말할 완전한 문장을 작성하세요.\n\n' +

            '=== 강의 시간 배분 규칙 (총 480분 = 8시간) ===\n' +
            '전체 과정은 기본학습 + 기본실습 + 심화학습 + 심화실습 + 학습이해도 5개 탭으로 구성됩니다.\n' +
            '각 탭은 대략 다음 시간 배분을 따르세요:\n' +
            '- 기본학습: 약 90~120분 (이론 중심 + 강사 대본 충분)\n' +
            '- 기본실습: 약 90~120분 (실습 과제 + 평가가이드 + 피드백 시간 포함)\n' +
            '- 심화학습: 약 90~120분 (심화 이론 + 사례 분석 + 토론)\n' +
            '- 심화실습: 약 90~120분 (프로젝트형 실습 + 발표/피드백)\n' +
            '- 학습이해도: 약 30~60분 (퀴즈 + 해설)\n' +
            '합계 480분이 되도록 조절하세요.\n' +
            '각 ## 섹션의 ⏱️ 예상 소요 시간을 명시하고, 탭 마지막 교강사 가이드에서 전체 시간 합계를 정리하세요.\n' +
            '강사 대본은 실제 수업 시간(90~120분)을 채울 수 있을 만큼 충분히 길고 구체적으로 작성하세요.\n\n' +

            '=== Callout 내부 구조 (반드시 이 순서대로, 모든 항목 포함) ===\n' +
            '⏱️ **예상 소요:** {N}분 | 🎚️ **난이도:** 쉬움/보통/어려움\n\n' +

            '🎬 **도입 멘트** (이 섹션을 시작할 때 말할 문장)\n' +
            '- 구어체, 수강생에게 직접 말하는 톤 (예: "자, 이번에는 ~에 대해 알아보겠습니다.")\n' +
            '- 이전 섹션과의 연결고리를 포함 (예: "아까 배운 ~를 기반으로...")\n' +
            '- 2~3문장 이상 작성\n\n' +

            '🗣️ **핵심 설명 대본** (이 섹션의 핵심을 설명하는 강의 스크립트)\n' +
            '- 본문의 내용을 교사가 쉽게 풀어서 말할 수 있도록 구어체로 재구성\n' +
            '- 비유/예시를 포함 (예: "이걸 쉽게 말하면 ~와 같습니다.")\n' +
            '- 칠판/화면에 무엇을 보여주며 설명할지 안내 (예: "[화면] 슬라이드 3번을 보시면...")\n' +
            '- 학생이 이해하기 어려운 개념은 단계적으로 풀어서 설명\n' +
            '- 최소 10~20문장 이상 충분히 작성 (실제 수업 시간 10~15분을 채울 분량)\n' +
            '- 단순 요약이 아닌, 강사가 그대로 읽어도 자연스러운 강의 대본 수준으로 작성\n' +
            '- 중간에 "잠깐, 여기서 질문 하나 드릴게요" 같은 참여 유도 멘트도 포함\n\n' +

            '💡 **꼭 짚어야 할 핵심** (반드시 강조할 포인트)\n' +
            '- 시험에 나올 수 있는 핵심, 실무에서 자주 쓰이는 내용\n' +
            '- 2~3가지 불릿 포인트\n\n' +

            '⚠️ **자주 헷갈리는 포인트** (학생이 오해하기 쉬운 부분)\n' +
            '- 흔한 오해를 먼저 언급하고 올바른 이해를 제시\n' +
            '- (예: "많은 분들이 ~라고 오해하시는데, 실제로는 ~입니다.")\n\n' +

            '🗣️ **질문/참여 유도** (학생 참여를 이끌어낼 질문)\n' +
            '- 개방형 질문 1~2개 (예: "여러분은 ~를 해본 경험이 있나요?")\n' +
            '- 예상 답변도 함께 적기 (예: "학생이 ~라고 답하면 → ~로 연결")\n\n' +

            '🔗 **전환 멘트** (다음 섹션으로 넘어갈 때 말할 문장)\n' +
            '- 1~2문장 (예: "그럼 이제 ~를 살펴보겠습니다.")\n\n' +

            '=== 교강사 가이드 섹션 (탭 마지막에 필수) ===\n' +
            '탭 마지막에는 ## 🎓 교강사 가이드 (강사 전용) 섹션을 반드시 포함하세요.\n' +
            '이 섹션에는 다음을 포함:\n' +
            '- **전체 시간 배분표** (섹션별 소요시간 합계, 10분 단위)\n' +
            '- **수업 전 준비 체크리스트** (프로그램 설치, 예제 파일, 장비 등)\n' +
            '- **예상 질문 & 답변 가이드** (FAQ 3~5개, 질문+답변 쌍)\n' +
            '- **수업 마무리 스크립트** (오늘 배운 내용 요약, 과제 안내, 다음 차시 예고)\n' +
            '- **평가 포인트** (이 차시에서 확인해야 할 학습 달성 기준)',

        // ── 컨벤션: Mermaid 다이어그램 제약 ──
        mermaid_rules: "Mermaid 다이어그램 허용 타입: flowchart LR/TD, sequenceDiagram, gantt만 사용. " +
            "stateDiagram-v2 절대 사용 금지 — 상태 전이도는 flowchart TD로 대체. " +
            "노드 수 10개 이하, 노드명에 괄호 ( ) 금지, 공백 포함 시 [\"한글 이름\"] 형식, 동일 탭 내 같은 타입 반복 금지.",

        // ── 컨벤션: 평가 기준 (100점 루브릭) ──
        rubric_100: "퀴즈/레벨테스트 채점 기준표는 반드시 100점 만점 기준: S(90~100), A(80~89), B(70~79), C(60~69), F(0~59).",

        // ── 한국어 마침표 줄바꿈 ──
        korean_period: "한국어 문장에서 마침표(.) 뒤에는 줄바꿈하여 가독성을 높이세요. 단, 표(table) 내부, 코드블록, 링크, 약어에서는 줄바꿈하지 마세요.",

        // ── 보충자료 출처 제한 ──
        reference_policy: "보충 자료 추천 시 반드시 다음 규칙을 준수하세요:\n" +
            "- 출처가 확실한 공식 문서, 공식 블로그, 위키백과만 추천\n" +
            "- 논문 인용 절대 금지 (학술 논문, arXiv, Google Scholar 등)\n" +
            "- 유튜브 링크 절대 금지 (youtube.com, youtu.be URL 포함 금지)\n" +
            "- 유튜브 영상 인용 절대 금지 (영상 제목, 채널명 언급 금지)\n" +
            "- 허용 출처: 공식 문서(Unity, Unreal, GDC Vault), 위키백과, 게임 위키, 공식 개발자 블로그",

        // ── 이모지 사용 규칙 ──
        emoji_rule: "이모지 사용 규칙 [최우선 규칙 — 반드시 준수]:\n" +
            "★ 핵심 원칙: 이모지는 항상 줄 맨 앞에 단독으로만 위치합니다.\n" +
            "  - 이모지 앞에 넘버링(1. 2. 3.) 절대 금지\n" +
            "  - 이모지 앞에 불릿(- * +) 절대 금지\n" +
            "  - 이모지는 줄의 첫 번째 문자여야 합니다\n" +
            "  ✗ 잘못된 예: '1. 💡 개념', '- 💡 개념', '  - 🎮 예시'\n" +
            "  ✓ 올바른 예: '💡 **개념:**' (줄 맨 앞에 단독)\n\n" +
            "★ 이모지 줄 다음 구조:\n" +
            "  이모지 줄은 제목 역할 → 바로 아래 하위 내용은 들여쓰기 + 불릿(-)으로 작성\n" +
            "  ✓ 올바른 예:\n" +
            "  💡 **핵심 개념: 시스템 설계**\n" +
            "      - 게임을 구성하는 모든 규칙...\n" +
            "      - 캐릭터 능력치...\n\n" +
            "★ 볼드 제목 뒤 줄바꿈: **볼드 제목:** 끝에서 반드시 줄바꿈하고 하위 내용 시작\n" +
            "  ✗ 잘못된 예: '**스킬 시스템:** 스킬은 발동 방식에 따라...'\n" +
            "  ✓ 올바른 예: '**스킬 시스템:**\\n    - 스킬은 발동 방식에 따라...'\n\n" +
            "★ 개요/학습 목표 섹션:\n" +
            "  - ## 개요: 모든 내용을 불릿(-)으로 작성. 이모지 사용 시 줄 첫번째에 단독 배치\n" +
            "  - ## 학습 목표: 모든 내용을 불릿(-)으로 작성. 이모지 사용 금지\n\n" +
            "기타 규칙:\n" +
            "1) 💡=핵심, ✅=체크, 🎮=게임사례, ⚠️=주의, ⚙️=실습\n" +
            "2) '💡 이론 설명' 같은 이모지+라벨 조합 금지. 이모지 뒤 바로 본문\n" +
            "3) '## 학습 목표' 섹션 이모지 사용 금지\n" +
            "4) 섹션 제목에 영문 괄호 금지"
    },

    // ── Phase 6: Few-Shot 서식 예시 (모든 경우 발췌) ──
    fewshot_cases: `[서식 예시 — 아래 형식을 참조하여 교안을 작성하세요]

■ 헤딩 위계 4단계:
# 📝 3D 씬 구성과 렌더링 기초
## 3D 오브젝트의 구성
### ■ 3D 렌더링의 핵심 3요소
#### &nbsp;&nbsp; ▣ 메쉬 (Mesh) : 기하학적 형상

■ 간격 매트릭스 6패턴:
[①헤딩 내부 — 간격 없음]
## 3D 오브젝트의 구성
- 3D 오브젝트는 세 가지 핵심 요소로 구성됩니다.

[②헤딩-블록 — 줄바꿈 1회]
## 3D 오브젝트의 구성
<p align="center">
    <img src="local:img01" alt="img01.png">
</p>

[③문단 분리 — <br> 1회]
...본문 내용...

<br>

### ■ 다음 하위 항목

[④요소 분리 — <br> 1회]
...설명 텍스트...

<br>

<p align="center">
    <img src="local:img02" alt="img02.png">
</p>

[⑤블록 연속 — <br><br> 2회]
...html 표...

<br><br>

<p align="center">
    <img src="local:img02" alt="img02.png">
</p>

[⑥차시 전환 — 구분선 세트]

<br><br>

---

<br>

# 📝 다음 차시 주제

■ 특수 패턴 3종:
[A] 샌드위치(블록→텍스트→블록):
<p align="center">
    <img src="local:img01" alt="img01.png">
</p>

<br>

- 이 이미지는 메쉬의 구조를 보여줍니다.

<br><br>

<p align="center">
    <img src="local:img02" alt="img02.png">
</p>

[B] 차시 제목 예외: # 📝 바로 아래 줄바꿈 1회

# 📝 3D 씬 구성과 렌더링 기초

<br>

...설명 텍스트...

[C] 연속 미디어: 이미지/영상 사이 [Enter]만

■ 본문 리스트 Depth 3단계:
- 게임 기획의 핵심 3요소
  - 시스템 기획: 수치, 밸런스, 규칙 설계
    - 예: 레벨 디자인, 경제 시스템
  - 콘텐츠 기획: 퀘스트, 아이템, 스토리

■ 텍스트 강조 2종:
**핵심 포인트** = 개념·키워드 강조 (Bold)
\`파일명.txt\` = 파일명·단축키·코드 (Inline Code)

■ 들여쓰기 2종:
#### &nbsp;&nbsp; ▣ L4 헤딩 (&nbsp;&nbsp;+ ▣)
일반 텍스트에도 &nbsp;&nbsp; 로 들여쓰기

■ 시맨틱 아이콘 8종:
💡 **핵심 포인트**: 중요 개념
✅ **체크**: 학습 체크리스트
☑️ **강조**: 보조 강조
ℹ️ **참고**: 추가 정보
💬 **TMI**: 부가 정보
🎮 **게임 예시**: **게임 관련** 실무 사례
⚠️ **주의**: 주의사항
⚙️ **실습**: 따라하기 가이드

■ Key Concept 포맷:
- **버텍스 (Vertex, 정점)**
    - X, Y, Z 좌표를 가진 3D 공간의 점입니다.
`
};

// 2-0.5. 강사 어투 프리셋 (생성 시 적용)
const INSTRUCTOR_TONE_PRESETS = [
    { id: 'formal', label: '합쇼체', promptSuffix: '헤딩: 체언종결(~음, ~함). 본문: 합쇼체(~합니다, ~입니다).' },
    { id: 'friendly', label: '해요체', promptSuffix: '헤딩: 체언종결(~음, ~함). 본문: 해요체(~해요, ~이에요). 친근하지만 존댓말을 유지.' },
    { id: 'coaching', label: '코치형', promptSuffix: '헤딩: 체언종결(~음, ~함). 본문: 코칭형(~해봅시다, ~해볼까요?). 함께 배워가는 동료 멘토 느낌으로.' }
];

// 2-1. 문체 변환 프리셋 (Tone & Manner)
const TONE_PRESETS = [
    {
        id: 'academic',
        label: '📚 교과서',
        color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        prompt: '학술적이고 정제된 교과서 문체로 변환하세요. 존댓말(~합니다, ~입니다)을 사용하고, 전문 용어는 유지하되 정의를 병기하며, 논리적이고 체계적인 서술 구조를 갖추세요. 감정적 표현이나 구어체는 배제합니다.'
    },
    {
        id: 'casual',
        label: '💬 대화형',
        color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        prompt: '친근한 대화체로 변환하세요. 강사가 학생에게 편하게 설명하듯 ~요, ~죠 같은 종결어미를 사용하고, 질문을 던지며 대화를 이어가는 느낌으로 작성하세요. 딱딱한 서술은 부드럽게 풀어주세요.'
    },
    {
        id: 'gamer',
        label: '🎮 게이머',
        color: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
        prompt: '게이머/게임 개발자 문화에 익숙한 문체로 변환하세요. 게임 용어(버프, 너프, 메타, OP, 밸런스 등)를 적극 활용하고, 열정적이며 에너지 넘치는 톤으로 작성하세요. 비유도 게임 세계관에서 가져오세요.'
    },
    {
        id: 'simple',
        label: '👶 쉬운말',
        color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        prompt: '초등학생도 이해할 수 있도록 최대한 쉬운 말로 변환하세요. 전문 용어는 일상 단어로 바꾸고, 짧은 문장 위주로 구성하며, 비유와 예시를 풍부하게 사용하세요. 핵심 개념은 누락하지 마세요.'
    },
    {
        id: 'business',
        label: '🏢 실무형',
        color: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
        prompt: '실무 현업 기획서/보고서 문체로 변환하세요. 간결하고 핵심 중심으로 서술하며, 불릿 포인트와 수치 근거를 활용하세요. "~해야 한다", "~가 필요하다" 형태의 실행 지향적 어조를 사용하세요.'
    },
    {
        id: 'hype',
        label: '🔥 동기부여',
        color: 'bg-red-500/15 text-red-400 border-red-500/30',
        prompt: '학습 의욕을 극대화하는 동기부여 문체로 변환하세요. 열정적이고 긍정적인 톤을 사용하고, 독자를 "당신"으로 호칭하며, 도전의식과 성취감을 자극하는 표현을 적극 사용하세요. 문장 끝에 힘을 주세요.'
    }
];

// 2-2. 분량 조절 프리셋 (Volume Control)
const VOLUME_PRESETS = {
    shorter: {
        label: '⊖ 짧게',
        prompt: '다음 텍스트를 핵심 정의와 결론 위주로 압축하세요. 부연 설명, 반복, 예시 중 불필요한 것을 걷어내고 분량을 약 50~60% 수준으로 줄이세요. 마크다운 구조(#, ##, * 등)는 유지하되, 이미지 태그와 HTML 요소는 절대 수정하지 마세요.'
    },
    longer: {
        label: '⊕ 길게',
        prompt: '다음 텍스트의 핵심 개념은 유지하면서 분량을 약 150~170% 수준으로 늘려주세요. 구체적인 사례, 부가 설명, 실무 팁(TMI/Info 박스 형태)을 추가하세요. 마크다운 구조(#, ##, * 등)는 유지하되, 이미지 태그와 HTML 요소는 절대 수정하지 마세요.'
    }
};

// 2-3. 5탭 교안 분류 상수
const LESSON_TABS = [
    { id: 'basicLearn',  label: '기본학습',   icon: 'ph-book-open',     color: 'blue' },
    { id: 'basicPrac',   label: '기본실습',   icon: 'ph-code',          color: 'emerald' },
    { id: 'advLearn',    label: '심화학습',   icon: 'ph-brain',         color: 'amber' },
    { id: 'advPrac',     label: '심화실습',   icon: 'ph-rocket-launch', color: 'red' },
    { id: 'assessment',  label: '학습이해도', icon: 'ph-exam',          color: 'violet' }
];

// 3. 모의 데이터 (Mock Data)
const MOCK_IMAGE_B64 = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNDAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWUxZTJlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjI0IiBmaWxsPSIjOGE4YWI1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+R2FtZSBEZXNpZ24gRGlhZ3JhbSBNb2NrPC90ZXh0Pjwvc3ZnPg==";

const MOCK_CONTENT_1 = `# 1. 개요\n게임 기획(Game Design)은 플레이어에게 '재미'를 제공하기 위한 규칙과 시스템을 설계하는 과정입니다. 성공적인 게임은 철저한 기획에서 출발합니다.\n\n# 2. 학습 목표\n* 게임 기획의 핵심 정의와 역할을 설명할 수 있다.\n* 게임 디자이너가 갖춰야 할 기본 소양을 이해한다.\n\n# 3. 핵심 내용\n## 재미의 본질\n재미란 무엇일까요? 플레이어가 게임 내에서 겪는 도전과 보상의 순환 고리입니다.\n\n<div class="image-wrapper"><img src="local:img_mock_123" alt="게임 기획 다이어그램" class="rounded-lg border-2 border-accent/30 shadow-md max-w-full"><span class="absolute bottom-3 left-3 bg-black/80 text-white text-[0.6rem] px-2 py-1 rounded border border-white/20 flex items-center gap-1 pointer-events-none"><i class="ph-fill ph-sparkle text-accent"></i> AI 생성 이미지</span><button class="image-regenerate-btn px-3 py-1.5 text-xs text-white font-bold rounded flex items-center gap-1 border border-accent/50 hover:bg-accent transition-colors" onclick="promptRegenerateImage(this, '게임 기획 다이어그램', 'img_mock_123')"><i class="ph-bold ph-arrows-clockwise"></i> 다시 생성</button></div>\n\n## 기획자의 역할\n* **시스템 기획:** 수치, 밸런스, 규칙 설계\n* **콘텐츠 기획:** 퀘스트, 아이템, 스토리 설계\n* **UI/UX 기획:** 사용자 인터페이스 및 경험 설계\n\n# 4. 요약\n게임 기획은 단순한 아이디어가 아닌, 플레이어의 경험(UX)을 수학적/논리적으로 설계하는 정밀한 엔지니어링 작업입니다.\n\n---\n<!-- 메인 퀘스트가 아직 작성되지 않았습니다. -->`;

const INITIAL_MOCK_STATE = {
    courseId: "course_mock_1",
    courseTitle: "게임 기획 전문가 양성 과정",
    subjects: [
        {
            id: "subject_1",
            title: "1. 게임 기획의 기초",
            description: "게임 기획의 기본 개념과 프레임워크를 이해합니다.",
            namingConvention: '',
            lessonCount: 2,
            hasLevelTest: true,
            mainQuest: {
                id: 'mainQuest',
                title: '👑 메인 퀘스트: 기획의 본질 파악',
                description: '모든 차시의 일일 퀘스트를 종합하여 최종 기획서를 완성합니다.',
                status: 'waiting',
                content: null,
                images: {}
            },
            lessons: [
                {
                    id: 101,
                    title: '1차시: 개념 이해',
                    description: '기획이란 무엇인가?',
                    status: 'done',
                    content: MOCK_CONTENT_1,
                    images: { "img_mock_123": MOCK_IMAGE_B64 },
                    uploadedMdName: null,
                    uploadedMdContent: null
                },
                {
                    id: 102,
                    title: '2차시: 게임의 구조',
                    description: 'MDA 프레임워크',
                    status: 'waiting',
                    content: null,
                    uploadedMdName: null,
                    uploadedMdContent: null
                }
            ]
        }
    ]
};
