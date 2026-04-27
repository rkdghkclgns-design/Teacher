// ═══ v7.6: 공통 전처리/후처리 함수 ═══

function preprocessMarkdown(text) {
    // 영문 괄호 제거
    text = text.replace(/개요\s*\(Overview\)/gi, '개요');
    text = text.replace(/학습\s*목표\s*\(Objectives?\)/gi, '학습 목표');
    text = text.replace(/상세\s*내용\s*\(Details?\)/gi, '상세 내용');
    text = text.replace(/실습\s*\/?\s*예제\s*\(Practice\)/gi, '실습/예제');
    text = text.replace(/주요\s*용어\s*정리\s*\(Key Terms?\)/gi, '주요 용어 정리');
    text = text.replace(/\(Overview\)/gi, '');
    text = text.replace(/\(Objectives?\)/gi, '');
    text = text.replace(/\(Practice\)/gi, '');
    text = text.replace(/\(Key Terms?\)/gi, '');
    text = text.replace(/\(Details?\)/gi, '');
    // 제목(#) 앞 빈 줄 보장
    text = text.replace(/([^\n])\n(#{1,3}\s)/g, '$1\n\n$2');
    // 넘버링 앞 줄바꿈 보장
    text = text.replace(/([가-힣]\.)\s+(\d+\.\s)/g, '$1\n\n$2');
    // 표 셀 볼드 공백 보장
    text = text.replace(/\|\s*\*\*/g, '| **');
    text = text.replace(/\*\*\s*\|/g, '** |');
    return text;
}

function postprocessHtml(html) {
    const EMOJI_SET = '💡|✅|☑️|ℹ️|💬|🎮|⚠️|⚙️|🗣️|💥|🔑|🎯|🏆|📌|🔍|🎨|📝|🧠|🎵|🎬|📊|🔧|🎓|🎲|🕹️|📱|💻|🖥️';
    const TOP_EMOJI = '💡|🎮|⚠️|✅|⚙️|☑️';

    // 퀴즈 보기 줄바꿈
    html = html.replace(/([^\n<,])(\s+)([①②③④⑤])/g, '$1<br>$3');
    // "이 차시를 마치면" 제거
    html = html.replace(/<p>\s*이 차시를 마치면[^<]*<\/p>/gi, '');
    html = html.replace(/이 차시를 마치면 다음을 할 수 있습니다[.:]?\s*(<br\s*\/?>)?/gi, '');
    // 복수정답 횡 나열
    html = html.replace(/(정답[:\s]*(?:<\/strong>)?)\s*(?:<br\s*\/?>|\s)*([①②③④⑤][,\s]*(?:(?:<br\s*\/?>|\s)*[①②③④⑤][,\s]*)*)/gi, (m, prefix, nums) => {
        return prefix + ' ' + nums.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?p>/gi, ' ').replace(/\s+/g, ' ').trim();
    });
    // 이모지+라벨 제거 (💡 이론 설명, ▣ 이론 설명 등)
    html = html.replace(new RegExp(`(${EMOJI_SET})\\s*(?:이론\\s*설명|이론설명)\\s*[:：]?\\s*`, 'g'), '');
    html = html.replace(/▣\s*(?:이론\s*설명|이론설명)\s*[:：]?\s*/g, '');
    // ★ 이모지는 항상 줄 맨 앞에만 위치 (중간 삽입 금지)
    // 텍스트 중간에 이모지가 있으면 앞에서 줄바꿈하여 맨 앞으로 이동
    // 예: "설명합니다. 💡 핵심" → "설명합니다.<br>💡 핵심"
    // 예: "내용 💡 다음" → "내용<br>💡 다음"
    html = html.replace(new RegExp(`([가-힣a-zA-Z0-9.,:;!?)\\]'"…>])(\\s+)(${EMOJI_SET})`, 'g'), '$1<br>$3');
    // HTML 태그 직후 이모지 (</p>💡 등은 제외 — 이미 줄 앞)
    html = html.replace(new RegExp(`(</(?:li|td|th|span|em|a)>)(\\s*)(${EMOJI_SET})`, 'g'), '$1<br>$3');
    // ================================================================
    // ★ 넘버링+이모지 제거 (HTML 단계 — 최우선 규칙)
    // ================================================================

    // 텍스트 내 "N. 이모지" 패턴 제거
    html = html.replace(/(\d+)\.\s*([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/gu, '$2');
    html = html.replace(new RegExp(`\\d+\\.\\s*((?:${EMOJI_SET}))`, 'g'), '$1');

    // ★ 핵심: 모든 <ol>을 <ul>로 일괄 변환 (교안에서 넘버링 리스트 불필요)
    html = html.replace(/<ol[^>]*>/g, '<ul style="list-style:disc;padding-left:1.5rem;">');
    html = html.replace(/<\/ol>/g, '</ul>');

    // ★ <li> 안에 이모지가 첫 글자면 → <li> 밖으로 분리 (이모지는 단독 줄)
    // "<li>💡 제목: ..." → "</ul><p>💡 <strong>제목</strong>: ...</p><ul>"
    {
        const emojiInLi = new RegExp(`<li>\\s*((?:${EMOJI_SET}|[\\u{1F300}-\\u{1F9FF}\\u{2600}-\\u{26FF}\\u{2700}-\\u{27BF}]))\\s*`, 'gu');
        html = html.replace(emojiInLi, (m, emoji) => {
            return `</ul><p>${emoji} `;
        });
        // 분리된 이모지 줄 뒤에 다시 ul 열기 (다음 <li>가 올 것이므로)
        html = html.replace(/<\/p>\s*<li>/g, '</p><ul style="list-style:disc;padding-left:1.5rem;"><li>');
    }

    // 빈 <ul></ul> 정리
    html = html.replace(/<ul[^>]*>\s*<\/ul>/g, '');

    // ★ 볼드 제목 끝 콜론 제거 — "**게임 기획의 본질:**" → "**게임 기획의 본질**"
    // 단, 문장 중간의 짧은 볼드(예: **창의성**: 같은 인라인)는 유지
    // 줄/리스트 시작에 있는 볼드 제목만 콜론 제거
    html = html.replace(/((?:^|<li>|<p>|<br\s*\/?>)\s*(?:[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]\s*)?<strong>[^<]+?)[:：]\s*<\/strong>/gmu, '$1</strong>');

    // ★ "예:" 들여쓰기 — 예: 로 시작하는 항목을 들여쓰기 처리
    html = html.replace(
        /(<li>)\s*(예\s*[:：]\s*)/g,
        '$1<span style="padding-left:1.5rem;display:inline-block;">$2'
    );
    // 인라인 "예:" 패턴도 들여쓰기
    html = html.replace(
        /(<br\s*\/?>)\s*(예\s*[:：]\s*)/g,
        '$1<span style="padding-left:1.5rem;display:inline-block;">$2'
    );

    // ★ 표 안 이모지 제거
    html = html.replace(
        /(<t[dh][^>]*>)([\s\S]*?)(<\/t[dh]>)/gi,
        (match, open, content, close) => {
            const cleaned = content.replace(new RegExp(`(${EMOJI_SET})\\s*`, 'g'), '');
            return open + cleaned + close;
        }
    );

    // ★ 볼드 뒤 이모지 줄바꿈 (무조건 적용)
    // "</strong> 💡" → "</strong><br>💡"
    html = html.replace(
        /(<\/strong>)\s*([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/gu,
        '$1<br>$2'
    );
    html = html.replace(
        new RegExp(`(<\\/strong>)\\s*((?:${EMOJI_SET}))`, 'g'),
        '$1<br>$2'
    );

    // "핵심 개념:" 문구 삭제 (HTML 단계)
    html = html.replace(/<strong>\s*핵심\s*개념\s*[:：]\s*/g, '<strong>');
    html = html.replace(/핵심\s*개념\s*[:：]\s*/g, '');
    // 백슬래시(\) 잔류 제거 — "</strong>\" → "</strong>"
    html = html.replace(/(<\/strong>)\s*\\\s*/g, '$1 ');
    html = html.replace(/([가-힣a-zA-Z0-9:：])\\(\s)/g, '$1$2');
    // ZWJ 이모지 치환
    html = html.replace(/(\?{3,})\s*/g, '');
    html = html.replace(/👨‍🏫/g, '🎓');
    html = html.replace(/👩‍🎓/g, '🎓');
    // 영문 괄호 제거 (HTML 단계)
    html = html.replace(/개요\s*\(Overview\)/gi, '개요');
    html = html.replace(/학습\s*목표\s*\(Objectives?\)/gi, '학습 목표');
    html = html.replace(/\(Overview\)/gi, '');
    html = html.replace(/\(Objectives?\)/gi, '');
    // 대괄호 제목 분리
    html = html.replace(/\[개요\]\s*/g, '<br><strong>개요</strong><br>');
    html = html.replace(/\[학습\s*목표\]\s*/g, '<br><strong>학습 목표</strong><br>');
    // 개요 섹션 이모지 제거
    html = html.replace(
        /(<h2[^>]*>(?:[^<]*개요[^<]*)<\/h2>)([\s\S]*?)(?=<h2|$)/gi,
        (match, heading, body) => heading + body.replace(new RegExp(`(${EMOJI_SET})\\s*`, 'g'), '')
    );
    // 학습 목표 섹션 이모지 제거
    html = html.replace(
        /(<h2[^>]*>(?:[^<]*학습\s*목표[^<]*)<\/h2>)([\s\S]*?)(?=<h2|$)/gi,
        (match, heading, body) => heading + body.replace(new RegExp(`(${EMOJI_SET})\\s*`, 'g'), '')
    );

    // ★ 미렌더링 마크다운 볼드(**text**) → <strong>text</strong> 변환
    // marked.js가 "**경험(Player Experience)**을" 같은 패턴을 렌더링하지 못하는 경우 보정
    html = html.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

    return html;
}

// ── instructor-callout 내부 마크다운 재파싱 ──────────────────────
// marked.parse()는 HTML <div> 내부의 마크다운을 파싱하지 않으므로
// .instructor-callout 요소를 찾아 내부 콘텐츠를 별도로 재파싱한다.

function detectCalloutType(text) {
    if (/스크립트|대본|말씀|설명\s*방법|이렇게\s*말/.test(text)) return 'callout-script';
    if (/핵심|언급|강조|포인트|중요|꼭\s*설명/.test(text)) return 'callout-emphasis';
    if (/주의|경고|실수|오류|흔한\s*실수|조심/.test(text)) return 'callout-warning';
    if (/질문|물어|토론|생각해|학생.*에게/.test(text)) return 'callout-question';
    if (/마무리|정리|요약|마지막|수고/.test(text)) return 'callout-closing';
    return '';
}

function enhanceKeyPoints(html) {
    return html.replace(
        /(핵심\s*언급점|핵심\s*포인트|주요\s*언급|Key\s*Points?)[^<]*<\/(?:p|strong|h[1-6])>\s*<ul>/gi,
        (match) => match.replace('<ul>', '<ul class="key-points">')
    );
}

function reParseInstructorCallouts(html) {
    try {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;

        tmp.querySelectorAll('.instructor-callout').forEach(callout => {
            const inner = callout.innerHTML;

            // v7.1: 강사 callout 내부 | 구분자를 줄바꿈으로 변환 (가독성 개선)
            let preprocessed = inner.replace(/\s*\|\s*(?=[\s\S]*(?:\*\*|🎚️|⏱️|🗣️|💡|⚠️))/g, '\n');

            // v7.2: <br> 텍스트를 실제 줄바꿈으로 변환 (marked가 이스케이프하지 않도록)
            preprocessed = preprocessed.replace(/&lt;br&gt;/gi, '\n').replace(/<br\s*\/?>/gi, '\n');

            // v7.3: callout 내부 들여쓰기 제거 — 4칸+ 들여쓰기를 marked가 코드블록으로 인식하는 문제 방지
            preprocessed = preprocessed.replace(/^[ \t]{4,}/gm, '');

            // v7.3: callout 내부 <pre><code> 블록 풀기 — AI가 코드블록으로 감싼 경우
            preprocessed = preprocessed.replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
                return code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            });

            // v7.1: 항상 marked.parse() 호출 — **볼드**, 리스트, 테이블 등 미파싱 방지
            let parsedContent;
            try {
                parsedContent = marked.parse(preprocessed);
            } catch {
                parsedContent = preprocessed;
            }

            // v7.3: 파싱 후에도 남은 <pre><code> 블록 풀기 (이중 감싸짐 방지)
            parsedContent = parsedContent.replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
                const decoded = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
                try { return marked.parse(decoded); } catch { return decoded; }
            });

            // 섹션 타입 자동 감지
            const lc = inner.toLowerCase();
            const sectionType = detectCalloutType(lc);
            if (sectionType) callout.classList.add(sectionType);

            // 핵심 언급점 목록 강화
            parsedContent = enhanceKeyPoints(parsedContent);

            callout.innerHTML = parsedContent;
        });

        return tmp.innerHTML;
    } catch {
        return html;
    }
}

// v5.9 포팅: 한국어 마침표 뒤 줄바꿈 HTML 후처리
function applyPeriodLineBreakHTML(html) {
    if (!html) return html;
    const SKIP_TAGS = new Set(['CODE', 'PRE', 'A', 'TH', 'TD', 'TABLE', 'THEAD', 'TBODY', 'TR', 'SCRIPT', 'STYLE', 'SVG', 'BLOCKQUOTE', 'FIGCAPTION', 'CAPTION']);
    try {
        const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
        const root = doc.body.firstChild;
        const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        const targets = [];
        while (walker.nextNode()) {
            const node = walker.currentNode;
            let skip = false;
            let p = node.parentElement;
            while (p && p !== root) {
                if (SKIP_TAGS.has(p.tagName)) { skip = true; break; }
                p = p.parentElement;
            }
            if (!skip && node.textContent.length > 10 && /[가-힣]\.\s+[가-힣]/.test(node.textContent)) targets.push(node);
        }
        targets.forEach(node => {
            const frag = doc.createDocumentFragment();
            const parts = node.textContent.split(/(?<=[가-힣]\.)\s+(?=[가-힣])/);
            parts.forEach((part, i) => {
                if (i > 0) frag.appendChild(doc.createElement('br'));
                frag.appendChild(doc.createTextNode(part));
            });
            node.parentNode.replaceChild(frag, node);
        });
        return root.innerHTML;
    } catch (e) { return html; }
}

// v5.9 포팅: 참고자료 컨텍스트 빌더
function getReferenceContext(maxChars = 8000) {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return '';
    let ctx = '';
    const refText = (subj.referenceText || '').trim();
    if (refText) {
        const truncated = refText.length > maxChars
            ? refText.substring(0, maxChars) + '\n...(이하 생략)'
            : refText;
        ctx += '\n\n[참고 자료 — 아래 내용을 참고하여 교안 작성 시 반영하십시오]\n' + truncated;
    }
    if (Array.isArray(subj.referenceUrls) && subj.referenceUrls.length > 0) {
        const linkList = subj.referenceUrls.map(l => '- ' + (l.title || l.url) + ': ' + l.url).join('\n');
        ctx += '\n\n[참고 출처 목록]\n' + linkList;
    }
    return ctx;
}

async function fetchWithRetry(url, options, retries = 5) {
    // 503 과부하 에러 등을 대비해 기본 재시도 횟수 5회 및 대기 시간 대폭 연장 (1.5s, 3s, 6s, 10s, 15s)
    const delays = [1500, 3000, 6000, 10000, 15000];

    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            if (!res.ok) {
                // 400/401/403은 재시도해도 실패하므로 즉시 중단
                if (res.status === 400 || res.status === 401 || res.status === 403) {
                    const errText = await res.text();
                    const statusLabel = res.status === 401 ? 'Unauthorized (API 키 확인 필요)' : res.status === 403 ? 'Forbidden' : 'Bad Request';
                    throw new Error(`HTTP error! status: ${res.status}, ${statusLabel}: ${errText.substring(0, 150)}`);
                }
                // 429, 500, 503 등은 throw하여 아래 catch 블록에서 지연 재시도를 타게 만듦
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return await res.json();
        } catch (e) {
            // 마지막 재시도까지 실패하거나 클라이언트 에러(400/401/403)면 즉시 중단
            if (i === retries - 1 || /status: (400|401|403)/.test(e.message)) {
                throw e;
            }

            console.warn(`[fetchWithRetry] API 오류 또는 지연 발생. ${delays[i] / 1000}초 후 재시도합니다... (${i + 1}/${retries - 1}) | 사유: ${e.message}`);
            await new Promise(r => setTimeout(r, delays[i]));
        }
    }
}

// Edge Function 프록시를 통한 Gemini API 호출 헬퍼
function callGemini(modelName, payload) {
    const proxyPayload = { model: modelName, ...payload };
    return fetchWithRetry(
        GEMINI_PROXY_URL,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proxyPayload) }
    );
}



// ------------------------------------------------------------------------
// Mermaid 코드 sanitize — AI가 노드 라벨에 괄호/따옴표를 넣어 파서가 실패하는 문제 방지
// 예시 에러: Parse error on line 5: E[문서화 (GDD, 기획서 등)]
//   → Mermaid는 [...] 안에 ( ) 를 허용하지 않음
// 전략: 노드 라벨(브래킷 내부) 안의 ( ), 따옴표, 중첩 [] 제거 · 치환
// ------------------------------------------------------------------------
function sanitizeMermaidCode(code) {
    if (!code || typeof code !== 'string') return code || '';
    let out = String(code);

    // 1) 중복 괄호/따옴표/대괄호를 한국어 대시로 변환
    //    [라벨 (보조설명)]   → [라벨 - 보조설명]
    //    [라벨 (보조1, 보조2)] → [라벨 - 보조1, 보조2]
    //    (...)               → - ...
    //    {라벨 (보조설명)}   → {라벨 - 보조설명}
    //    ((라벨))            → ((라벨))  (원형 노드는 허용)
    const fixInside = (s) => s
        .replace(/\s*\(\s*([^()]*?)\s*\)\s*/g, ' - $1')   // (X) → - X
        .replace(/"/g, "'")                                  // 따옴표 단일화
        .replace(/\[([^\[\]]*?)\]/g, '$1')                  // 내부 [] 제거
        .replace(/\s+/g, ' ')
        .trim();

    // [label] 노드
    out = out.replace(/\[([^\[\]\n]{1,200})\]/g, (m, inner) => {
        if (!/[()\[\]"]/.test(inner)) return m;
        return '[' + fixInside(inner) + ']';
    });
    // {label} (마름모) 노드
    out = out.replace(/\{([^{}\n]{1,200})\}/g, (m, inner) => {
        if (!/[()\[\]"]/.test(inner)) return m;
        return '{' + fixInside(inner) + '}';
    });
    // ((label)) (원형) 노드는 이중괄호 구조만 보존하고 내부만 정제
    out = out.replace(/\(\(([^()\n]{1,200})\)\)/g, (m, inner) => {
        if (!/[()\[\]"]/.test(inner)) return m;
        return '((' + fixInside(inner) + '))';
    });

    // 2) 연결선 텍스트: A -->|라벨 (보조)| B  내부 괄호 제거
    out = out.replace(/\|([^|\n]{1,200})\|/g, (m, inner) => {
        if (!/[()\[\]"]/.test(inner)) return m;
        return '|' + fixInside(inner) + '|';
    });

    // 3) stateDiagram-v2는 convention 상 금지이므로 flowchart로 치환
    out = out.replace(/^\s*stateDiagram-v2/m, 'flowchart TD');

    return out;
}
window.sanitizeMermaidCode = sanitizeMermaidCode;

// ------------------------------------------------------------------------
// Marked.js 커스텀 렌더러 설정 (이미지 호버 재생성 UI 주입)
// ------------------------------------------------------------------------
if (typeof marked !== 'undefined') {
    const renderer = {
        code(codeArg, infostringArg, escapedArg) {
            // marked 최신 v8.0.0+ 에서는 첫 번째 인자에 token 객체가 넘어옵니다.
            let codeText = typeof codeArg === 'object' ? codeArg.text : codeArg;
            let infostring = typeof codeArg === 'object' ? codeArg.lang : infostringArg;

            if (infostring === 'mermaid') {
                return `<div class="mermaid">\n${sanitizeMermaidCode(codeText)}\n</div>`;
            }
            // mermaid가 아닌 일반 코드 블록 폴백 처리
            const lang = (infostring || '').match(/\S*/)?.[0] || '';
            let escapedCode = codeText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            if (!lang) {
                return `<pre><code>${escapedCode}</code></pre>\n`;
            }
            return `<pre><code class="language-${lang}">${escapedCode}</code></pre>\n`;
        },
        image(hrefArg, titleArg, textArg) {
            // marked v8.0.0+: 첫 인자가 token 객체일 수 있음
            const href = typeof hrefArg === 'object' ? (hrefArg.href || '') : (hrefArg || '');
            const title = typeof hrefArg === 'object' ? (hrefArg.title || '') : (titleArg || '');
            const text = typeof hrefArg === 'object' ? (hrefArg.text || '') : (textArg || '');

            // 이미지 ID 추적 (보통 local:xxxx-xxxx 형태)
            let imgIdToPass = href;
            if (href && href.startsWith('local:')) {
                imgIdToPass = href.substring(6); // 'local:' 접두사 제거
            } else {
                imgIdToPass = encodeURIComponent(href); // 외부 URL인 경우
            }

            return `
                <div class="relative group my-6 flex justify-center" data-imgid="${imgIdToPass}">
                    <img src="${href}" alt="${text}" title="${title}" class="rounded-xl shadow-lg max-w-full h-auto max-h-[450px] object-contain transition-transform duration-500 group-hover:scale-[1.01]">
                    <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                        <button onclick="deleteImage('${imgIdToPass}', this)" class="px-3 py-1.5 bg-red-500/80 hover:bg-red-600 text-white text-xs font-bold rounded-lg shadow-lg flex items-center gap-1 backdrop-blur-sm">
                            <i class="ph-bold ph-trash"></i> 삭제
                        </button>
                    </div>
                </div>
            `;
        }
    };
    marked.use({ renderer });
}

// ------------------------------------------------------------------------
// AI Logic & Other Editor Functions
// ------------------------------------------------------------------------

// [Step 3] 퀴즈 생성 로직 (generateQuiz)

window.generateQuiz = async function () {

    const mod = getEditingModule();

    const tabContent = mod && mod.tabContents ? Object.values(mod.tabContents).find(v => v) : null;
    if (!mod || (!mod.content && !tabContent)) return window.showAlert('교안 내용이 생성되지 않았습니다.');



    const btn = document.getElementById('quiz-btn');

    const origHTML = btn.innerHTML;

    btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i> 생성중...';

    btn.disabled = true;



    const { systemInstruction, userPrompt } = buildTaskContext('quiz', mod.content);



    const payload = {

        contents: [{ parts: [{ text: userPrompt }] }],

        systemInstruction: { parts: [{ text: systemInstruction }] }

    };



    try {

        const data = await callGemini(TEXT_MODEL, payload);

        const quizMd = extractText(data);

        showModal('AI 생성 퀴즈', marked.parse(quizMd));

    } catch (e) {

        window.showAlert('퀴즈 생성 실패: ' + e.message);

    } finally {

        btn.innerHTML = origHTML;

        btn.disabled = false;

    }

};



// [Step 3] TTS 재생 로직 제거됨 (사용자 요청)



async function handleGenerate() {

    const topic = document.getElementById('topic-input').value.trim();

    if (!topic) return window.showAlert('교육 주제를 입력해주세요.');



    document.getElementById('sidebar-loading').style.display = 'flex';

    document.getElementById('generate-btn').disabled = true;



    const { systemInstruction, userPrompt } = buildTaskContext('blueprint', topic);



    const payload = {

        contents: [{ parts: [{ text: userPrompt }] }],

        systemInstruction: { parts: [{ text: systemInstruction }] },

        generationConfig: { responseMimeType: "application/json" }

    };



    try {

        const data = await callGemini(TEXT_MODEL, payload);



        const rawText = extractText(data);

        const parsed = safeJSONParse(rawText);



        if (!Array.isArray(parsed)) throw new Error("Invalid format received");



        courseData = parsed.map((item, idx) => ({

            id: Date.now() + idx,

            title: item.title,

            description: item.description,

            hours: item.hours || 2,

            status: 'waiting',

            content: null,

            images: {},

            tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null },

            uploadedMdName: null,

            uploadedMdContent: null

        }));

        currentTopic = topic;



        renderSidebar();

        saveState();

    } catch (err) {

        console.error(err);

        if (err.message && err.message.includes('401')) {

            window.showAlert('API 인증 오류(401)가 발생했습니다. 시스템 토큰 갱신 지연일 수 있으니 10초 후 시도하거나 새로고침(F5) 해주세요.');

        } else {

            window.showAlert('목차 생성 중 오류가 발생했습니다. 다시 시도해주세요.');

        }

    } finally {

        document.getElementById('sidebar-loading').style.display = 'none';

        document.getElementById('generate-btn').disabled = false;

    }

}



async function generateModuleContent(moduleId, keyConcepts) {
    // API 키: Edge Function 프록시가 서버 측에서 관리

    const mod = getEditingModule(moduleId);

    if (!mod) return;

    // F1-2: 핵심개념 저장 (재생성 시 기본값으로 재활용)
    if (Array.isArray(keyConcepts) && keyConcepts.length > 0) {
        mod.keyConcepts = keyConcepts;
    }

    // [재생성 중복 방지] 재생성인 경우 기존 tabContents·images 초기화
    // 이전엔 status==='done'이면 tabContents가 남아있어 5탭 자동생성이 스킵되고
    // mod.content와 tabContents가 어긋나 같은 내용이 2회 이상 보이는 문제 발생.
    if (mod.status === 'done' || (mod.tabContents && Object.values(mod.tabContents).some(v => v))) {
        console.log('[Regeneration] tabContents·images 초기화하여 중복 생성 방지');
        mod.tabContents = { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null };
        // 재생성 시 옛 이미지 캐시도 비움 (새 본문에 맞는 이미지로 갱신)
        mod.images = {};
        mod.content = '';
    }


    const subj = globalState.subjects.find(s => s.id === currentSubjectId);

    let hasMainQuest = false;

    let mainQuestText = "";

    let otherLessonsText = "";



    if (subj && subj.mainQuest && subj.mainQuest.status === 'done' && subj.mainQuest.content) {

        hasMainQuest = true;

        const cleanMqContent = cleanForAPI(subj.mainQuest.content).substring(0, 300);

        mainQuestText = `${subj.mainQuest.title}: ${subj.mainQuest.description}\n[핵심 내용 요약] ${cleanMqContent}...`;



        const otherQuests = subj.lessons

            .filter(l => String(l.id) !== String(moduleId) && l.status === 'done' && l.content)

            .map(l => {

                const match = l.content.match(/# ⚔️ 일일 퀘스트[\s\S]*/);

                const qText = match ? cleanForAPI(match[0]).substring(0, 150) : '퀘스트 없음';

                return `- [${l.title}]의 일일 퀘스트: ${qText}`;

            });

        otherLessonsText = otherQuests.join('\n');

    }



    const loadingEl = document.getElementById('editor-loading');
    const loadingText = document.getElementById('editor-loading-text');
    loadingEl.style.display = 'flex';
    loadingText.textContent = 'AI가 상세 교안을 작성하고 있습니다...';



    document.querySelectorAll('.module-card').forEach(c => c.classList.remove('border-accent', 'bg-accent/10', 'border-yellow-400', 'bg-yellow-400/10'));

    const card = document.querySelector(`.module-card[data-id="${moduleId}"]`);

    if (card) {

        if (moduleId === 'mainQuest') card.classList.add('border-yellow-400', 'bg-yellow-400/10');

        else card.classList.add('border-accent', 'bg-accent/10');

    }



    // ── F2: 분할 생성 파이프라인 ──
    const MAX_CHUNKS = 5;
    const CONTINUE_MARKER = '<!-- CONTINUE -->';
    const END_MARKER = '<!-- END -->';
    let fullContent = '';
    let chunkCount = 0;

    try {
        // ── Chunk 1: 최초 생성 ──
        const { systemInstruction, userPrompt } = buildTaskContext('module', {
            title: mod.title,
            description: mod.description,
            keyConcepts: mod.keyConcepts || [],
            hasMainQuest: hasMainQuest,
            mainQuestText: mainQuestText,
            otherLessonsText: otherLessonsText,
            uploadedMdContent: mod.uploadedMdContent
        });

        loadingText.textContent = '교안 작성 중... (1단계: 초안 생성)';

        const firstData = await callGemini(TEXT_MODEL, {
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                    ],
                    contents: [{ parts: [{ text: userPrompt }] }],
                    systemInstruction: { parts: [{ text: systemInstruction }] }
        });

        let chunkText = extractText(firstData);
        chunkText = chunkText.replace(/^```\w*\n?/i, '').replace(/\n?```$/i, '').trim();
        fullContent = chunkText;
        chunkCount = 1;

        // ── Chunk 2~N: 이어쓰기 루프 ──
        while (fullContent.includes(CONTINUE_MARKER) && chunkCount < MAX_CHUNKS) {
            chunkCount++;
            // CONTINUE 마커 제거
            fullContent = fullContent.replace(CONTINUE_MARKER, '').trimEnd();

            loadingText.textContent = `교안 이어쓰기 중... (${chunkCount}단계)`;

            // 이전 내용의 마지막 1500자를 컨텍스트로 전달 (토큰 절약)
            const contextTail = fullContent.length > 1500 ? fullContent.slice(-1500) : fullContent;

            const { systemInstruction: contSys, userPrompt: contPrompt } = buildTaskContext('module_continue', {
                title: mod.title,
                description: mod.description,
                keyConcepts: mod.keyConcepts || [],
                hasMainQuest: hasMainQuest,
                chunkIndex: chunkCount,
                previousContent: contextTail
            });

            // API 쿨다운
            await new Promise(r => setTimeout(r, 1500));

            const contData = await callGemini(TEXT_MODEL, {
                        safetySettings: [
                            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                        ],
                        contents: [{ parts: [{ text: contPrompt }] }],
                        systemInstruction: { parts: [{ text: contSys }] }
            });

            let contText = extractText(contData);
            contText = contText.replace(/^```\w*\n?/i, '').replace(/\n?```$/i, '').trim();

            // 이어쓰기 내용 병합 (중복 헤딩 방지: 이전 마지막 헤딩과 동일하면 제거)
            const lastHeadingMatch = fullContent.match(/^(#{1,4}\s+.+)$/gm);
            if (lastHeadingMatch) {
                const lastHeading = lastHeadingMatch[lastHeadingMatch.length - 1].trim();
                const contLines = contText.split('\n');
                if (contLines[0] && contLines[0].trim() === lastHeading) {
                    contLines.shift();
                    contText = contLines.join('\n');
                }
            }

            fullContent += '\n\n' + contText;
        }

        // END 마커 정리
        fullContent = fullContent.replace(END_MARKER, '').trimEnd();
        // 잔여 CONTINUE 마커 정리 (MAX_CHUNKS 초과 시)
        fullContent = fullContent.replace(new RegExp(CONTINUE_MARKER, 'g'), '').trimEnd();

        // 마크다운 정리 + 강사 callout 자동 래핑 (이미지 처리 전에 적용)
        if (typeof sanitizeMarkdownContent === 'function') {
            fullContent = sanitizeMarkdownContent(fullContent);
        }

        // ── 이미지 태그 처리 ──
        loadingText.textContent = chunkCount > 1
            ? `이미지 생성 중... (${chunkCount}단계 완료)`
            : '이미지 생성 중...';

        fullContent = await processImageTags(mod, fullContent);

        mod.content = fullContent;
        mod.status = 'done';
        currentEditingModuleId = mod.id;

        // 5탭 마이그레이션: 기본학습 탭에 콘텐츠 저장
        if (typeof migrateMonolithicContent === 'function') migrateMonolithicContent(mod);

        await saveState();
        renderSidebar();
        renderEditor(mod);

        // 나머지 4탭 자동 생성 (기본학습은 이미 완료)
        if (typeof generateRemainingTabs === 'function') {
            await generateRemainingTabs(mod.id);
        } else if (chunkCount > 1) {
            window.showAlert(`✅ 교안이 ${chunkCount}단계에 걸쳐 생성되었습니다.`);
        }

    } catch (err) {

        console.error("교안 생성 중 에러 상세 (generateModuleContent):", err, err.stack);

        if (err.message && err.message.includes('401')) {

            window.showAlert('API 인증 오류(401)가 발생했습니다. 시스템 토큰 갱신 지연일 수 있으니 10초 후 시도하거나 새로고침(F5) 해주세요.');

        } else {

            window.showAlert('교안 생성 중 오류가 발생했습니다.\n' + (err.message || ''));

        }

        // 부분 생성 복구: 일부 청크가 성공한 경우 저장
        if (fullContent && fullContent.length > 200) {
            fullContent = fullContent.replace(new RegExp(CONTINUE_MARKER, 'g'), '').replace(END_MARKER, '').trimEnd();
            mod.content = fullContent;
            mod.status = 'done';
            await saveState();
            renderSidebar();
            renderEditor(mod);
            window.showAlert('⚠️ 중간 오류가 발생했지만 작성된 부분까지 저장했습니다.\n수동으로 나머지를 보완하거나 재생성하세요.');
        }

    } finally {

        loadingEl.style.display = 'none';
        loadingText.textContent = 'AI가 상세 교안을 작성하고 있습니다...';

    }

}

// ── F1-2: 핵심개념 팝업을 거쳐 교안 생성하는 래퍼 ──
window.promptAndGenerateModule = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return;
    const existing = Array.isArray(mod.keyConcepts) ? mod.keyConcepts : [];
    const label = mod.status === 'done' ? `재생성: ${mod.title}` : `교안 생성: ${mod.title}`;
    showKeyConceptsPrompt(label, existing, (concepts) => {
        generateModuleContent(moduleId, concepts);
    });
};

// ── F1-2: 메인퀘스트도 핵심개념 팝업 래퍼 ──
window.promptAndGenerateMainQuest = function () {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return;
    const mq = subj.mainQuest;
    const existing = Array.isArray(mq?.keyConcepts) ? mq.keyConcepts : [];
    showKeyConceptsPrompt('메인 퀘스트 생성', existing, (concepts) => {
        if (concepts.length > 0 && mq) mq.keyConcepts = concepts;
        generateMainQuest();
    });
};



async function generateMainQuest() {
    if (!apiKey) {
        window.showAlert('API 키가 설정되지 않았습니다.\n좌측 하단 설정 버튼에서 Gemini API 키를 먼저 입력해주세요.');
        return;
    }

    const subj = globalState.subjects.find(s => s.id === currentSubjectId);

    if (!subj) return;

    const mq = subj.mainQuest;



    document.getElementById('editor-loading').style.display = 'flex';



    document.querySelectorAll('.module-card').forEach(c => c.classList.remove('border-accent', 'bg-accent/10', 'border-yellow-400', 'bg-yellow-400/10'));

    const card = document.querySelector(`.module-card[data-id="mainQuest"]`);

    if (card) card.classList.add('border-yellow-400', 'bg-yellow-400/10');



    let contextStr = subj.lessons.map(l => `- ${l.title}: ${l.description}\n  내용 요약: ${l.content ? cleanForAPI(l.content).substring(0, 150) + '...' : '미작성'}`).join('\n\n');



    const { systemInstruction, userPrompt } = buildTaskContext('main_quest', contextStr);



    const payload = {
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ],
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] }
    };



    try {

        const data = await callGemini(TEXT_MODEL, payload);



        let markdownContent = extractText(data);

        markdownContent = await processImageTags(mq, markdownContent);



        mq.content = markdownContent;

        mq.status = 'done';

        currentEditingModuleId = 'mainQuest';



        await saveState();

        renderSidebar();

        renderEditor(mq);

    } catch (err) {

        console.error(err);

        if (err.message && err.message.includes('401')) {

            window.showAlert('API 인증 오류(401)가 발생했습니다. 시스템 토큰 갱신 지연일 수 있으니 10초 후 시도하거나 새로고침(F5) 해주세요.');

        } else {

            window.showAlert('메인 퀘스트 생성 중 오류가 발생했습니다.');

        }

    } finally {

        document.getElementById('editor-loading').style.display = 'none';

    }

}

// --- Phase F10: Deep Research 검색 에이전트 서브루틴 ---

function getContextWindow(text, matchStr, windowSize = 300) {
    const idx = text.indexOf(matchStr);
    if (idx === -1) return "";
    const start = Math.max(0, idx - windowSize);
    const end = Math.min(text.length, idx + matchStr.length + windowSize);
    return text.substring(start, end).replace(/<!--.*?-->/g, '').replace(/[#*`_>]/g, '').trim();
}

async function extractSearchIntent(keyword, context) {
    const systemPrompt = `당신은 게임 기획 및 시장 분석 전문 데이터 리서처이자 이미지 프롬프트 엔지니어입니다.
주어진 이미지 키워드와 주변 교안 문맥을 분석하여 두 종류의 출력을 생성합니다:
(A) 웹 검색용 쿼리 — 구글 이미지 등 검색 엔진에서 실제 자료를 찾기 위한 쿼리
(B) AI 이미지 생성용 프롬프트 — Gemini/Imagen 모델이 문맥에 맞는 고품질 일러스트를 생성하도록 하는 프롬프트

[검색 쿼리(A) 지시사항]
1. 고유명사(게임명, 캐릭터명, 시스템명, 회사명 등)를 쿼리의 핵심에 배치
2. 이미지 종류(일러스트/스크린샷/UI/차트)에 맞는 영어 한정자 추가 ("official art", "gameplay UI", "revenue chart" 등)
3. 영어 쿼리 위주로, 한국 게임은 한글 쿼리 병행
4. 부정어 연산자로 가비지 배제 ("-fanart -cosplay -reddit")
5. 공식 스크린샷이 필요하면 "official screenshot", "in-game" 한정자 사용

[AI 이미지 생성 프롬프트(B) 지시사항 — 매우 중요]
1. **순수 영어로만 작성** — 한국어 단어·고유명사 절대 포함 금지. 한국 게임이면 영어 일반 묘사로 변환 ("Genshin Impact" → "a fantasy open-world action RPG with anime-style heroes").
2. **본문 문맥을 1순위로 활용** — [주변 교안 문맥]에서 등장하는 구체적 단어·예시·키워드(예: '코어 루프', 'MDA 프레임워크', '플레이테스트', '레벨 디자인', '밸런싱')를 시각적 은유로 변환. 키워드 자체보다 **본문이 무엇을 설명하고 있는지**를 그림으로 보여주는 것이 핵심.
   - 본문이 "MDA 프레임워크"를 설명 중 → 'Mechanics(톱니바퀴)→Dynamics(흐르는 빛)→Aesthetics(플레이어 미소)'를 한 화면에 시각화
   - 본문이 "밸런싱"을 다룸 → 양손에 각기 다른 무기 카드를 들고 저울처럼 비교하는 디자이너
   - 본문이 "플레이테스트"를 다룸 → 디자이너가 클립보드에 메모하며 플레이어들의 반응을 관찰하는 장면
3. **단순한 물체나 정적 포즈가 아니라 "지금 무언가 일어나고 있는 한 컷"** 을 만들 것.
   - 좋은 예: "게임 기획 회의" → "Four game designers in a sleek modern studio mid-discussion, gesturing animatedly at a glowing holographic game world projected above the table. Concept sketches scattered around, neon-lit monitors in background, dynamic low-angle"
   - 나쁜 예: "Four people standing around a table looking at papers" (정적·교과서적)
4. **인물의 표정·행동·소품을 풍부하게 묘사** — 본문이 다루는 감정·과정을 표정과 자세로 표현.
   - "재미의 본질" → "Two players leaning forward intensely toward a glowing arcade screen, controllers gripped tightly, faces lit by colorful game light, golden particle effects bursting from the screen"
5. **스타일 — 반드시 다음 문구 포함**: "Dynamic AAA game studio concept art style, dramatic lighting with rim light and atmospheric haze, painterly digital illustration with bold brushwork, vibrant saturated palette (cobalt blue, electric purple, neon teal accents on deep indigo). Visual references: Riot Games splash art, Blizzard cinematic key art, Supercell promo illustrations". 절대 'flat illustration', 'clip art', 'isometric corporate diagram', 'educational textbook' 같은 정적·범용 키워드는 사용 금지.
6. **게임 산업 친화 시각 요소**: 적절히 반영 — 모니터·UI 와이어프레임(빈 화면)·게임 컨트롤러·헤드셋·캐릭터 컨셉 시트·픽셀/네온 효과·HUD 도형·디자인 노트북·VR 헤드셋·홀로그램 디스플레이.
7. **텍스트·글자 절대 금지**: 프롬프트에 반드시 다음 포함: "STRICTLY NO TEXT, no letters, no Korean characters, no hangul, no numbers, no typography, no labels, no UI text. Any screens/papers/signs must be blank or show only abstract glyphs."
8. **구도 — 반드시 포함 (letterbox 단어 절대 금지)**: "Wide horizontal landscape composition, strictly 16:9 (1408x768), the composition fills the ENTIRE frame edge-to-edge with NO black bars, NO borders, NO film letterbox, diagonal energy lines, depth of field, hero subject fills the frame horizontally, dynamic camera angle (low-angle / over-shoulder / dutch tilt 권장), motion sense". 'letterbox', 'cinematic bars', 'film border' 단어는 절대 사용 금지 — AI가 검은 띠를 그려넣음.
9. **저작권 금지**: 특정 게임·캐릭터 이름 직접 언급 금지 (대신 "fantasy warrior", "cyberpunk hacker", "anime-style adventurer" 등 일반 장르 묘사).
10. **품질 키워드 필수**: "4K detail, editorial concept art polish, sharp focus, dramatic atmosphere, professional game industry conference quality".

[출력 포맷 JSON — 반드시 준수]
{
  "intent_type": "data_representation | visual_asset | concept_illustration | screenshot | diagram",
  "search_query": "최적화된 검색 쿼리",
  "image_gen_prompt": "AI 이미지 생성 전용 영문 프롬프트 (위 지시사항 전부 반영, 80~200 단어)",
  "reasoning": "이 결정 이유 (한국어 짧게, 40자 이내)"
}`;

    const userPrompt = `[문맥 추출 대상]\n키워드: ${keyword}\n\n[주변 교안 문맥]\n${context}`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: 0.1, // 일관된 JSON 추출을 위해 낮은 온도값
            responseMimeType: "application/json"
        }
    };

    try {
        const response = await callGemini(TEXT_MODEL, payload);
        const textResp = extractText(response);
        // v7.3: JSON 파싱 전 제어 문자 제거 (Gemini가 줄바꿈/탭을 문자열 내부에 삽입하는 문제)
        const sanitized = textResp
            .replace(/[\x00-\x1F\x7F]/g, ' ')  // 제어 문자 → 공백
            .replace(/```json\s*/gi, '')         // 코드펜스 제거
            .replace(/```\s*/g, '')
            .trim();
        // JSON 블록 추출 (응답에 설명 텍스트가 섞인 경우 대비)
        const jsonMatch = sanitized.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
        console.warn("검색어 의도 추출 에이전트 실패 (폴백 사용):", e.message);
        return null; // 실패 시 기존 키워드 Fallback을 위해 Null 반환
    }
}
// [Phase F10] 구글 검색 이미지 URL Fetch 및 Canvas Base64 인코딩 (CORS 프록시 체인)
async function fetchImageAsBase64(imageUrl) {
    // 무료 CORS 우회 프록시 (향후 필요 시 교체 가능)
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(imageUrl)}`;

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // 가로 최대 800px 축소 최적화
            let width = img.width;
            let height = img.height;
            const MAX_WIDTH = 800;
            if (width > MAX_WIDTH) {
                height = Math.round((height * MAX_WIDTH) / width);
                width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            try {
                // 압축 포맷 WebP 혹은 JPEG으로 리턴
                const dataURL = canvas.toDataURL('image/jpeg', 0.85);
                resolve(dataURL);
            } catch (e) {
                console.error("Canvas 보안/인코딩 에러:", e);
                reject(e);
            }
        };
        img.onerror = (e) => reject(new Error("Image Load Failed"));
        img.src = proxyUrl;
    });
}

// [Phase F10] VLM(Vision-Language Model) 기반 웹 검색 이미지 유효성 검열
async function validateImageWithVLM(base64Image, searchIntent, context) {
    if (!base64Image) return { isValid: false, reason: "이미지 데이터 없음" };

    // "data:image/jpeg;base64,..."에서 데이터 부분만 추출
    const base64Data = base64Image.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
    const mimeType = base64Image.match(/^data:(image\/[^;]+);/)[1] || "image/jpeg";

    const systemPrompt = `당신은 게임/IT 교육 자료 품질 검열관입니다.
수집된 이미지가 교안의 문맥(Context) 및 검색 의도(Intent)에 부합하는지 철저히 평가하십시오.
다음 조건 중 하나라도 해당되면 "isValid": false 처리하십시오:
1. 유튜브 썸네일 텍스트 낚시, 조잡한 밈(Meme), 관련 없는 워터마크가 도배된 경우
2. 의도한 데이터 객체(예: 매출 그래프)를 찾았으나 수치나 텍스트를 전혀 읽을 수 없을 정도로 흐릿한 경우
3. 실제 게임 스크린샷이나 일러스트가 아닌 팬아트, 코스프레, 모드(Mod) 적용 사진인 경우 (의도된 바가 아니라면)
4. 성인물, 폭력적, 혐오스러운 요소가 포함된 경우

[출력 포맷 JSON]
{
  "isValid": true (합격) 또는 false (불합격),
  "reason": "평가 사유 (한국어 짧게)",
  "confidence": 0.0 ~ 1.0
}`;

    const userPrompt = `[수집된 의도 및 문맥]\n검색 쿼리/의도: ${JSON.stringify(searchIntent)}\n주변 문맥:\n${context}\n\n첨부된 이미지가 위 문맥에 비추어 교육 자료로 적합한지 평가하십시오.`;

    const payload = {
        contents: [
            {
                role: "user",
                parts: [
                    { text: userPrompt },
                    { inlineData: { mimeType: mimeType, data: base64Data } }
                ]
            }
        ],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
        }
    };

    try {
        console.log(`[VLM Validator] 이미지 검열 시작...`);
        // 이미지 검열용 모델은 안전장치가 강한 모델 사용 권장. 설정된 모델(TEXT_MODEL) 재활용
        const response = await callGemini(TEXT_MODEL, payload);
        const textResp = extractText(response);
        const result = JSON.parse(textResp);
        console.log(`[VLM Validator] 검열 결과:`, result);
        return result;
    } catch (e) {
        console.error("[VLM Validator] 에러 발생 (기본 통과 처리):", e);
        // 검열기 자체 오류면 차단보단 일단 통과시켜 흐름 유지 (False Positive 방어)
        return { isValid: true, reason: "VLM 통신 에러로 자동 패스", confidence: 0 };
    }
}

// [Phase F10] 구글 Custom Search (Key 롤링 방어 적용)
async function searchImageAPI(query) {
    if (!googleSearchCx || !googleSearchApiKeys || googleSearchApiKeys.length === 0) {
        return null; // 설정 안되어있으면 즉시 폴백
    }

    const maxRetries = googleSearchApiKeys.length;
    let attempt = 0;

    while (attempt < maxRetries) {
        const currentKey = googleSearchApiKeys[currentSearchKeyIndex];
        const endpoint = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&searchType=image&num=1&cx=${encodeURIComponent(googleSearchCx)}&key=${encodeURIComponent(currentKey)}`;

        try {
            const res = await fetch(endpoint);
            if (res.status === 429) {
                // 할당량 초과 -> 다음 키로 롤링 (Rotate)
                console.warn(`[Search API] Key 인덱스 ${currentSearchKeyIndex} 할당량 초과(429). 다음 Key로 롤링합니다.`);
                if (window.showToast) window.showToast(`API Key 할당량 초과! 다음 Key로 전환합니다.`, 'warning');

                currentSearchKeyIndex = (currentSearchKeyIndex + 1) % googleSearchApiKeys.length;
                attempt++;
                continue; // 재시도
            }
            if (!res.ok) {
                console.error(`[Search API] HTTP Error: ${res.status}`);
                break; // 다른 에러는 롤백
            }

            const data = await res.json();
            if (data.items && data.items.length > 0) {
                const imgUrl = data.items[0].link;
                // Base64로 가져오기
                console.log(`[Search API] 이미지 찾음: ${imgUrl}`);
                const b64 = await fetchImageAsBase64(imgUrl);
                return { b64, source: imgUrl, vendor: "Google" };
            } else {
                return null; // 검색 결과 없음 -> 롤백
            }
        } catch (e) {
            console.error("[Search API] 네트워크/파싱 에러:", e);
            break; // 예기치 못한 에러 시 폴백
        }
    }

    // 키를 다 소모했거나 검색 실패 시
    if (attempt === maxRetries) {
        console.warn(`[Search API] 등록된 ${maxRetries}개의 Key를 모두 소진했습니다.`);
        if (window.showToast) window.showToast(`등록된 검색 API Key의 일일 한도가 모두 소진되었습니다. AI 이미지 생성으로 자동 전환합니다.`, 'error');
    }
    return null;
}

// [Phase F10] 무료 스톡 이미지 (Pixabay) API 연동 (Fallback)
async function searchPixabayAPI(query) {
    if (!pixabayApiKey) {
        return null; // 설정되어있지 않으면 스킵
    }

    try {
        console.log(`[Pixabay API] 대체 스톡 이미지 검색 시도: ${query}`);
        // pixabay는 기본 영어 검색, 사진(photo) 우선
        const endpoint = `https://pixabay.com/api/?key=${encodeURIComponent(pixabayApiKey)}&q=${encodeURIComponent(query)}&image_type=photo&per_page=3&safesearch=true`;

        const res = await fetch(endpoint);
        if (!res.ok) {
            console.error(`[Pixabay API] HTTP 에러: ${res.status}`);
            return null;
        }

        const data = await res.json();
        if (data.hits && data.hits.length > 0) {
            // 가장 첫번째 결과의 webformatURL 혹은 largeImageURL 사용
            const imgUrl = data.hits[0].webformatURL || data.hits[0].largeImageURL;
            console.log(`[Pixabay API] 스톡 이미지 찾음: ${imgUrl}`);

            // CORS 우회 프록시를 통해 base64로 변환 
            const b64 = await fetchImageAsBase64(imgUrl);
            return { b64, source: imgUrl, vendor: "Pixabay" };
        } else {
            console.log(`[Pixabay API] 결과 없음.`);
            return null;
        }
    } catch (e) {
        console.error("[Pixabay API] 통신 에러:", e);
        return null; // 오류나면 fallback 체인 계속 진행
    }
}
// --------------------------------------------------------


// 이미지 태그가 누락된 경우 ## 헤딩마다 자동 주입 (LLM이 태그를 빠뜨려도 이미지 생성 보장)
function autoInjectImageTags(markdown) {
    if (!markdown || typeof markdown !== 'string') return markdown;
    // 이미 이미지 태그가 하나라도 있으면 그대로 반환 (LLM이 배치한 위치 신뢰)
    if (/<!--\s*\[IMG:/.test(markdown)) return markdown;

    const ICON_RE = /[■▣📝⚙️🎮💡✅⚠️🧠🏆🚀🔬🎓📘📗📙📕🖥️🧩🎯🔍]/g;
    let injected = 0;
    const out = markdown.replace(/^(##\s+[^\n]+)$/gm, (m, heading) => {
        const title = heading.replace(/^##\s+/, '').replace(ICON_RE, '').replace(/^\[|\]$/g, '').trim();
        // 학습 목표 섹션은 이미지 태그 제외
        if (/학습\s*목표|Objectives?/i.test(title)) return m;
        if (!title) return m;
        injected++;
        return `${m}\n\n<!-- [IMG: "${title}"] -->\n`;
    });
    if (injected > 0) {
        console.log(`[autoInjectImageTags] LLM이 이미지 태그를 누락함 → ${injected}개 자동 주입`);
    }
    return out;
}
window.autoInjectImageTags = autoInjectImageTags;

async function processImageTags(mod, markdown) {

    // LLM이 태그를 누락했을 경우 자동 주입 (이미지 0장 방지)
    markdown = autoInjectImageTags(markdown);

    const regex = /<!--\s*\[IMG:\s*"?([^"]+)"?\]\s*-->/g;

    let result = markdown;

    let match;



    const tagsToReplace = [];
    while ((match = regex.exec(markdown)) !== null) {
        tagsToReplace.push({ fullMatch: match[0], keyword: match[1].trim() });
    }

    if (tagsToReplace.length === 0) return result;

    // v7.2: 학습 목표(Objectives) 섹션 내 이미지 태그 제외
    const filteredTags = tagsToReplace.filter(tag => {
        const pos = markdown.indexOf(tag.fullMatch);
        const beforeText = markdown.substring(Math.max(0, pos - 500), pos);
        // 학습 목표 섹션인지 확인 (## 학습 목표 ~ 다음 ## 사이)
        const lastH2 = beforeText.lastIndexOf('## ');
        if (lastH2 >= 0) {
            const sectionTitle = beforeText.substring(lastH2, lastH2 + 30).toLowerCase();
            if (sectionTitle.includes('학습 목표') || sectionTitle.includes('objectives')) {
                console.log(`[Image] 학습 목표 섹션 이미지 태그 건너뜀: ${tag.keyword}`);
                return false;
            }
        }
        return true;
    });

    if (filteredTags.length === 0) return result;

    // 시작 알림 — 사용자가 진행 상황을 인지할 수 있도록 toast 표시
    console.log(`[Image Pipeline] 이미지 태그 ${filteredTags.length}개 처리 시작`);
    if (window.showToast) {
        window.showToast(`🎨 이미지 ${filteredTags.length}개 생성 시작 (약 ${Math.ceil(filteredTags.length * 10)}초 소요)`, 'info');
    }

    // Rate Limit(429) 방지: 순차 처리 + 요청 간 7초 간격
    let successCount = 0;
    let failCount = 0;
    const replacements = [];
    for (let index = 0; index < filteredTags.length; index++) {
        const tag = filteredTags[index];
        const replacement = await (async () => {
        try {
            // Rate Limit 방어: 순차 실행 + 요청 간 7초 대기 (무료 티어 분당 10회 제한)
            if (index > 0) await new Promise(r => setTimeout(r, 7000));

            // [Phase F10] 1. 문맥 기반 검색어 튜닝 에이전트 가동
            const context = getContextWindow(markdown, tag.fullMatch, 400);
            const intent = await extractSearchIntent(tag.keyword, context);
            const searchQuery = (intent && intent.search_query) ? intent.search_query : tag.keyword;

            console.log(`[Deep Research Agent] 원본 키워드: ${tag.keyword} -> 최적화 쿼리: ${searchQuery}`, intent);

            // [Phase F10] 2. Google Custom Search API 연동 (다중 키 롤링)
            let b64Image = null;
            let vendorLabel = "";

            // 2-1. 먼저 동일한 검색어(의도)에 대해 로컬 캐시가 있는지 확인
            const cached = await DBManager.getCache(searchQuery);
            if (cached && cached.base64) {
                b64Image = cached.base64;
                vendorLabel = `캐시된 이미지 (${cached.format})`;
                console.log(`[Cache Hit] 저장된 검색 결과를 불러왔습니다: ${searchQuery}`);
                if (window.showToast) window.showToast(`로컬 캐시에서 이미지를 로드했습니다: ${searchQuery}`, 'success');
            } else {
                // 2-2. 캐시가 없으면 구글 API 검색 수행
                const searchResult = await searchImageAPI(searchQuery);

                if (searchResult && searchResult.b64) {
                    // [Phase F10] 2-3. VLM(Vision-Language Model) 기반 이미지 유효성 심사
                    const validation = await validateImageWithVLM(searchResult.b64, intent, context);

                    if (validation && validation.isValid !== false) {
                        b64Image = searchResult.b64;
                        vendorLabel = `웹 검색 연동`;

                        // 검열 통과 시 IndexedDB 캐시에 영구 저장
                        await DBManager.setCache(searchQuery, b64Image, searchResult.source, vendorLabel);
                        console.log(`[Cache Save] 검열을 통과한 새 검색 결과를 저장했습니다: ${searchQuery}`);
                    } else {
                        console.warn(`[VLM Validator] 이미지 부적합 판정 (폐기): ${validation?.reason || '이유 불명'}`);
                        if (window.showToast) window.showToast(`검색된 이미지가 부적합 판정(${validation?.reason})을 받아 우회합니다.`, 'warning');
                    }
                }
            }

            // [Phase F10] 3. Fallback 체인 1단계: 무료 스톡 이미지(Pixabay) 연동
            if (!b64Image) {
                const pixabayResult = await searchPixabayAPI(searchQuery);
                if (pixabayResult && pixabayResult.b64) {
                    b64Image = pixabayResult.b64;
                    vendorLabel = `스톡 연동 (Pixabay)`;

                    // 스톡 이미지도 다음번 빠른 로딩을 위해 캐시에 저장
                    await DBManager.setCache(searchQuery, b64Image, pixabayResult.source, vendorLabel);
                    console.log(`[Cache Save] Pixabay 스톡 검색 결과를 저장했습니다: ${searchQuery}`);
                }
            }

            // [Phase F10] 4. Fallback 체인 최종: AI 이미지 생성 (모든 외부 검색/통과 실패 시)
            if (!b64Image) {
                // 우선순위:
                // 1) extractSearchIntent가 생성한 image_gen_prompt (문맥 기반 고품질)
                // 2) 레거시 방식 (Context + Query) - 이전 응답 호환
                // 3) 키워드 단독 - 최후 수단
                let generatePrompt;
                if (intent && intent.image_gen_prompt && intent.image_gen_prompt.length > 30) {
                    generatePrompt = intent.image_gen_prompt;
                    console.log(`[AI Gen] 문맥 기반 전용 프롬프트 사용 (${generatePrompt.length}자): ${tag.keyword}`);
                } else if (intent && intent.reasoning) {
                    // 게임 산업 다이내믹 스타일 (정적 educational illustration 금지)
                    generatePrompt = `Cinematic concept art for a Korean game design lecture. Subject context: ${intent.reasoning}. Show this concept as a dynamic moment in a modern game studio setting — designers in mid-action, glowing holographic UI, dramatic rim lighting, painterly digital art with bold brushwork, vibrant cobalt-purple palette. AAA game studio splash-art quality, no text.`;
                    console.log(`[AI Gen] 레거시 게임-스타일 프롬프트 사용: ${tag.keyword}`);
                } else {
                    // 키워드만 있을 때도 다이내믹·게임 친화 기본값
                    generatePrompt = `Dynamic cinematic concept art illustrating "${tag.keyword}" in the context of professional game design. Show characters, designers or players mid-action with dramatic lighting and atmospheric haze. Painterly digital art style, vibrant cobalt-purple palette, AAA game studio quality (Riot/Blizzard splash-art aesthetic). No text, no letters.`;
                    console.log(`[AI Gen] 기본 게임-스타일 프롬프트 사용: ${tag.keyword}`);
                }
                b64Image = await generateImageAPI(generatePrompt);
                vendorLabel = "AI 생성 이미지";
            }

            // v5.9: 한글 설명 생성 — intent.reasoning 또는 키워드 한글화
            const koreanDesc = (intent && intent.reasoning) ? intent.reasoning : tag.keyword;
            const safeKoreanDesc = koreanDesc.replace(/'/g, "\\'").replace(/"/g, '&quot;');

            if (b64Image) {
                if (!mod.images) mod.images = {};
                const imgId = 'img_' + Date.now() + Math.floor(Math.random() * 1000);
                mod.images[imgId] = b64Image;

                let vendorIcon = 'ph-sparkle'; // default (AI)
                if (vendorLabel.includes('Google') || vendorLabel.includes('웹 검색')) vendorIcon = 'ph-google-logo';
                else if (vendorLabel.includes('Pixabay') || vendorLabel.includes('스톡')) vendorIcon = 'ph-camera';
                else if (vendorLabel.includes('캐시')) vendorIcon = 'ph-images';

                const imgHTML = `\n<div class="image-wrapper"><img src="local:${imgId}" alt="${safeKoreanDesc}" class="rounded-lg border-2 border-accent/30 shadow-md max-w-full"><button class="image-regenerate-btn px-3 py-1.5 text-xs text-white font-bold rounded flex items-center gap-1 border border-accent/50 hover:bg-accent transition-colors" onclick="promptRegenerateImage(this, '${tag.keyword}', '${imgId}')"><i class="ph-bold ph-arrows-clockwise"></i> 다시 찾기</button></div>\n`;

                successCount++;
                console.log(`[Image Pipeline] (${index + 1}/${filteredTags.length}) ✅ ${tag.keyword} → ${vendorLabel}`);
                return { fullMatch: tag.fullMatch, html: imgHTML };
            } else {
                failCount++;
                console.warn(`[Image Pipeline] (${index + 1}/${filteredTags.length}) ⚠️ 이미지 미확보: ${tag.keyword}`);
                return { fullMatch: tag.fullMatch, html: `\n<div class="image-placeholder" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:24px;margin:12px 0;border:2px dashed rgba(156,163,175,0.4);border-radius:8px;background:rgba(31,41,55,0.3);color:#9ca3af;font-size:0.85rem;"><i class="ph-bold ph-image" style="font-size:1.4rem;opacity:0.6;"></i> <span>이미지 영역: ${safeKoreanDesc}</span> <button onclick="promptRegenerateImage(this,'${tag.keyword.replace(/'/g, "\\'")}',null)" class="ml-2 px-2 py-1 text-xs bg-accent/20 text-accent border border-accent/40 rounded hover:bg-accent/30 transition-colors" style="cursor:pointer;">🔄 다시 검색</button></div>\n` };
            }

        } catch (e) {
            failCount++;
            console.error(`이미지 처리 실패 (${tag.keyword}):`, e);
            return { fullMatch: tag.fullMatch, html: `\n<div class="image-placeholder" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:24px;margin:12px 0;border:2px dashed rgba(156,163,175,0.4);border-radius:8px;background:rgba(31,41,55,0.3);color:#9ca3af;font-size:0.85rem;"><i class="ph-bold ph-image" style="font-size:1.4rem;opacity:0.6;"></i> <span>이미지 확보 실패: ${tag.keyword}</span></div>\n` };
        }
        })();
        replacements.push(replacement);
    }

    for (const rep of replacements) {
        if (rep) result = result.replace(rep.fullMatch, rep.html);
    }

    // 완료 토스트 — 성공/실패 카운트 표시
    console.log(`[Image Pipeline] 완료: 성공 ${successCount}건, 실패 ${failCount}건`);
    if (window.showToast) {
        if (successCount > 0 && failCount === 0) {
            window.showToast(`✅ 이미지 ${successCount}건 생성 완료`, 'success');
        } else if (successCount > 0 && failCount > 0) {
            window.showToast(`⚠️ 이미지 ${successCount}건 성공 · ${failCount}건 실패 (실패한 이미지는 '다시 찾기' 버튼으로 재시도)`, 'warning');
        } else if (failCount > 0) {
            window.showToast(`❌ 이미지 ${failCount}건 모두 실패 — Gemini 이미지 모델이 응답하지 않습니다`, 'error');
        }
    }

    return result;
}

// [신규] 지연된 이미지를 일괄 생성/검색하는 수동 트리거 함수
async function generateAllImagesInModule(moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod || !mod.content) return;

    if (!mod.content.includes('<!-- [IMG:')) {
        window.showToast('본문에 처리 대기 중인 이미지 태그가 없습니다.', 'info');
        return;
    }

    const btn = document.getElementById('img-batch-btn');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i> 이미지 일괄 확보 중...';
        btn.disabled = true;
    }

    document.getElementById('editor-loading').style.display = 'flex';
    document.getElementById('editor-loading-text').textContent = '본문 이미지를 수집하고 안전하게 검색을 수행하고 있습니다...';

    try {
        const newContent = await processImageTags(mod, mod.content);
        mod.content = newContent;
        await saveState();
        renderEditor(mod); // 최신 내용으로 리렌더링
        window.showToast('이미지 일괄 확보가 완료되었습니다.', 'success');
    } catch (e) {
        console.error('이미지 일괄 확보 실패:', e);
        window.showAlert('이미지 검색/생성 중 오류가 발생했습니다.');
    } finally {
        document.getElementById('editor-loading').style.display = 'none';
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}



// 현재 교과의 모든 차시를 정리: 마크다운 sanitize + 누락 이미지 일괄 생성
window.sanitizeAllContent = async function () {
    if (!confirm('현재 교과의 모든 차시에 마크다운 정리와 누락 이미지 생성을 수행합니다.\n시간이 오래 걸릴 수 있습니다. 계속하시겠습니까?')) return;

    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) { window.showAlert('교과를 먼저 선택하세요.'); return; }

    const btn = document.getElementById('sanitize-btn');
    const originalHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i> 정리 중...'; btn.disabled = true; }

    const loading = document.getElementById('editor-loading');
    const loadingText = document.getElementById('editor-loading-text');
    if (loading) loading.style.display = 'flex';

    let sanitized = 0;
    let imagesDone = 0;
    const targets = [...(subj.lessons || []), subj.mainQuest].filter(Boolean);

    try {
        // Pass 1: 마크다운 정리 (모든 탭·메인 컨텐츠)
        for (let i = 0; i < targets.length; i++) {
            const mod = targets[i];
            if (loadingText) loadingText.textContent = `마크다운 정리 (${i + 1}/${targets.length}): ${mod.title || ''}`;
            if (mod.content && typeof sanitizeMarkdownContent === 'function') {
                const before = mod.content;
                mod.content = sanitizeMarkdownContent(before);
                if (before !== mod.content) sanitized++;
            }
            if (mod.tabContents) {
                for (const tab of Object.keys(mod.tabContents)) {
                    if (mod.tabContents[tab]) {
                        const before = mod.tabContents[tab];
                        mod.tabContents[tab] = sanitizeMarkdownContent(before);
                        if (before !== mod.tabContents[tab]) sanitized++;
                    }
                }
            }
        }

        // Pass 2: 누락 이미지 처리 (<!-- [IMG: ... ] --> 가 남아있는 차시)
        for (let i = 0; i < targets.length; i++) {
            const mod = targets[i];
            const hasTag = (mod.content && mod.content.includes('<!-- [IMG:'))
                || (mod.tabContents && Object.values(mod.tabContents).some(c => c && c.includes('<!-- [IMG:')));
            if (!hasTag) continue;
            if (loadingText) loadingText.textContent = `이미지 처리 (${i + 1}/${targets.length}): ${mod.title || ''}`;
            try {
                // 메인 content
                if (mod.content && mod.content.includes('<!-- [IMG:')) {
                    mod.content = await processImageTags(mod, mod.content);
                    imagesDone++;
                }
                // 탭별 content
                if (mod.tabContents) {
                    for (const tab of Object.keys(mod.tabContents)) {
                        if (mod.tabContents[tab] && mod.tabContents[tab].includes('<!-- [IMG:')) {
                            mod.tabContents[tab] = await processImageTags(mod, mod.tabContents[tab]);
                            imagesDone++;
                        }
                    }
                }
            } catch (e) {
                console.warn('[sanitizeAllContent] 이미지 처리 실패:', mod.title, e);
            }
        }

        await saveState();
        // 현재 열린 에디터가 있으면 리렌더
        const editing = typeof getEditingModule === 'function' ? getEditingModule() : null;
        if (editing) renderEditor(editing);

        window.showToast(`✅ 정리 완료 — 마크다운 ${sanitized}건, 이미지 ${imagesDone}건`, 'success');
    } catch (e) {
        console.error('[sanitizeAllContent]', e);
        window.showAlert('정리 중 오류: ' + (e.message || e));
    } finally {
        if (loading) loading.style.display = 'none';
        if (btn) { btn.innerHTML = originalHTML; btn.disabled = false; }
    }
};

// Imagen 3.0 전용 호출 헬퍼 (프록시의 imagen 분기 사용)
async function callImagen(modelName, prompt) {
    const proxyPayload = {
        model: modelName,
        instances: [{ prompt: String(prompt || '') }],
        parameters: { sampleCount: 1, aspectRatio: '16:9' },
    };
    return fetchWithRetry(
        GEMINI_PROXY_URL,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proxyPayload) }
    );
}

async function generateImageAPI(prompt) {
    // 이미지 생성 폴백 체인 (16:9 정확도 우선)
    //
    // 검증 결과:
    // - gemini-2.5-flash-image: 항상 1024x1024 정사각형 반환 (aspectRatio 지시 무시)
    // - imagen-4.0-generate-001: aspectRatio="16:9" 파라미터 준수 → 1408x768 반환 ✅
    //
    // 따라서 Imagen 4.0을 Stage 1로 우선 호출하여 16:9 준수를 보장.
    // Gemini는 Imagen 실패 시 폴백으로만 사용 (정사각형이라도 이미지 확보).
    const imagenModels = ['imagen-4.0-generate-001'];
    const geminiOrder = [
        IMAGE_MODEL,
        'gemini-2.5-flash-image',
        'gemini-2.5-flash-image-preview',
        'gemini-2.0-flash-exp-image-generation',
    ];
    const geminiModels = [...new Set(geminiOrder.filter(Boolean))];
    const errorHistory = [];

    // 16:9 비율 + 게임 산업 전문가용 다이내믹 아트 스타일
    //
    // 변경 배경: 이전 'clean flat educational illustration'은 정적·범용·교과서스러운
    // 결과를 만들어 게임 기획 교안과 어울리지 않음.
    // 변경 후: AAA 게임 스튜디오 컨셉 아트 / 모던 게임 잡지 일러스트 스타일.
    //         프로 강사가 PPT에서 사용할 만한 다이내믹·시네마틱·게임친화 비주얼.
    const hasStyleHints = /\b(cinematic|concept art|game studio|dynamic|AAA|polished)\b/i.test(prompt);
    // 주의: 'letterbox' 단어는 AI가 이미지에 검은 띠를 그리도록 유도하므로 절대 사용 금지
    const ASPECT_SPEC = " ASPECT RATIO: Wide horizontal landscape, strictly 16:9 widescreen (1408x768). NEVER square, portrait, or vertical. The composition fills the ENTIRE frame edge-to-edge with NO black bars, NO borders, NO film letterbox, NO matte frames. Subject and background extend fully to all four edges.";
    const NO_TEXT_SPEC = " STRICTLY NO TEXT: no letters, no words, no Korean characters, no hangul, no numbers, no typography, no labels, no UI text, no signs, no book titles, no watermarks, no signatures. If screens/papers/signs appear, they must be blank or show only abstract glyphs and icons — NEVER readable letters.";
    const GAME_STYLE_SPEC = " STYLE: Dynamic AAA game studio concept art quality, modern indie game magazine illustration aesthetic. Cinematic dramatic lighting with rim light and atmospheric haze. Painterly digital art with bold brushwork, vibrant saturated colors but harmonized palette (cobalt blue, electric purple, neon teal accents on deep indigo background). Strong sense of energy, motion, and storytelling. Diagonal compositions, leading lines, depth of field. Characters and objects feel alive and in-action — not stiff or posed. Visual references: Riot Games splash art, Blizzard cinematic key art, Supercell promotional illustrations, contemporary game UI/UX portfolio pieces. AVOID: flat vector art, clip-art look, generic educational textbook illustration, static stock-photo poses, isometric corporate diagrams.";
    const QUALITY_SPEC = " QUALITY: 4K detail, editorial concept art polish, sharp focus on hero subject, dramatic depth and atmosphere, premium presentation slide hero image worthy of a professional game industry conference.";
    const CONTEXT_SPEC = " CONTEXT: This image illustrates a concept for a Korean professional game design curriculum used by a star instructor. The viewer should immediately feel game-industry energy and understand the visual metaphor without any text.";
    const styleSuffix = hasStyleHints
        ? NO_TEXT_SPEC + QUALITY_SPEC + ASPECT_SPEC + CONTEXT_SPEC
        : GAME_STYLE_SPEC + NO_TEXT_SPEC + QUALITY_SPEC + ASPECT_SPEC + CONTEXT_SPEC;
    const enhancedPrompt = prompt + styleSuffix;

    // Stage 1: Imagen 4.0 (predict 엔드포인트) — 16:9 aspectRatio 공식 파라미터 준수
    //          실제 테스트 결과: 1408x768 정확히 16:9 반환
    for (const model of imagenModels) {
        try {
            console.log(`[Image Gen] Imagen ${model} 시도 (16:9 공식 파라미터): ${prompt.substring(0, 60)}...`);
            const data = await callImagen(model, enhancedPrompt);

            const pred = data?.predictions?.[0];
            if (pred && pred.bytesBase64Encoded) {
                const mime = pred.mimeType || 'image/png';
                console.log(`[Image Gen] ✅ Imagen ${model} 성공 (16:9 보장)`);
                return `data:${mime};base64,${pred.bytesBase64Encoded}`;
            }
            console.warn(`[Image Gen] Imagen ${model} 응답에 이미지 없음`, data);
            errorHistory.push(`${model}: 이미지 파트 없음`);
        } catch (e) {
            const msg = e.message || String(e);
            const is429 = msg.includes('429');
            if (is429) {
                console.warn(`[Image Gen] Imagen ${model} 429 — 15초 대기 후 다음 모델로`);
                if (window.showToast) window.showToast(`이미지 생성 대기 중... (15초)`, 'warning');
                await new Promise(r => setTimeout(r, 15000));
            }
            console.error(`[Image Gen] Imagen ${model} 에러:`, msg);
            errorHistory.push(`${model}: ${msg.slice(0, 80)}`);
        }
    }

    // Stage 2: Gemini 이미지 모델 (generateContent) — Imagen 실패 시 폴백
    //          주의: Gemini 2.5 Flash Image는 1024x1024 정사각형만 반환 (aspectRatio 무시)
    //          → 폴백이므로 정사각형이라도 이미지 확보 우선
    for (const model of geminiModels) {
        const payload = {
            contents: [{ parts: [{ text: enhancedPrompt }] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        };

        for (let retry = 0; retry < 3; retry++) {
            try {
                console.log(`[Image Gen] Gemini ${model} 폴백 시도 (${retry > 0 ? '재시도 ' + retry : '최초'}): ${prompt.substring(0, 60)}...`);
                const data = await callGemini(model, payload);

                const parts = data?.candidates?.[0]?.content?.parts;
                if (parts) {
                    const imgPart = parts.find(p => p.inlineData && p.inlineData.mimeType && p.inlineData.mimeType.startsWith('image/'));
                    if (imgPart) {
                        console.log(`[Image Gen] ✅ Gemini ${model} 폴백 성공 (정사각형)`);
                        return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
                    }
                }
                const blockReason = data?.promptFeedback?.blockReason
                    || data?.candidates?.[0]?.finishReason
                    || '이미지 파트 없음';
                console.warn(`[Image Gen] Gemini ${model} 응답에 이미지 없음 — ${blockReason}`, data);
                errorHistory.push(`${model}: ${blockReason}`);
                break;
            } catch (e) {
                const msg = e.message || String(e);
                const is429 = msg.includes('429');
                const is404 = msg.includes('404') || /not\s*found|unsupported/i.test(msg);
                if (is429 && retry < 2) {
                    const waitSec = (retry + 1) * 15;
                    console.warn(`[Image Gen] 429 Rate Limit — ${waitSec}초 대기`);
                    if (window.showToast) window.showToast(`이미지 생성 대기 중... (${waitSec}초)`, 'warning');
                    await new Promise(r => setTimeout(r, waitSec * 1000));
                    continue;
                }
                console.error(`[Image Gen] Gemini ${model} 에러:`, msg);
                errorHistory.push(`${model}: ${is404 ? '모델 미지원' : msg.slice(0, 80)}`);
                break;
            }
        }
    }

    console.error("[Image Gen] 모든 모델 실패:", errorHistory);
    if (window.showToast && errorHistory.length) {
        window.showToast(`⚠️ 이미지 생성 실패 (${errorHistory[0]})`, 'error');
    }
    return null;
}



window.promptRegenerateImage = function (btn, fallbackKeyword, imgId) {

    const wrapper = btn.closest('.image-wrapper') || btn.closest('.image-placeholder');

    if (!wrapper || wrapper.querySelector('.prompt-overlay')) return;



    const overlay = document.createElement('div');

    overlay.className = 'prompt-overlay absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 z-20 animate-fade-in rounded-lg';

    overlay.onclick = () => overlay.remove();

    overlay.innerHTML = `

                <div class="w-full max-w-[320px] bg-[#1a1a2e] p-4 rounded-xl border border-white/10 shadow-2xl relative" onclick="event.stopPropagation()">

                    <div class="flex justify-between items-center mb-3">

                        <h4 class="text-sm font-bold text-white flex items-center gap-1.5"><i class="ph-fill ph-sparkle text-accent"></i> 이미지 다시 생성</h4>

                        <button class="text-textMuted hover:text-white transition-colors" onclick="this.closest('.prompt-overlay').remove()"><i class="ph-bold ph-x"></i></button>

                    </div>

                    <textarea class="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-white focus:border-accent focus:ring-1 focus:ring-accent outline-none resize-none mb-3 placeholder:text-textMuted/40" rows="3" placeholder="프롬프트를 입력하세요.\n(입력하지 않으면 주변 문맥을 분석하여 자동 생성됩니다)"></textarea>

                    <div class="flex justify-end gap-2">

                        <button class="px-3 py-1.5 text-xs font-bold text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors" onclick="this.closest('.prompt-overlay').remove()">취소</button>

                        <button class="px-3 py-1.5 text-xs font-bold text-white bg-accent hover:bg-accentHover rounded-lg transition-colors" onclick="doRegenerateImage(this, '${fallbackKeyword}', '${imgId}')">생성하기</button>

                    </div>

                </div>

            `;

    wrapper.appendChild(overlay);

};



function extractContextForImage(imgId) {

    const mod = getEditingModule();

    if (!mod || !mod.content) return "게임 기획 관련 이미지";



    const text = mod.content;

    const marker = `local:${imgId}`;

    const idx = text.indexOf(marker);

    if (idx === -1) return "게임 기획 관련 이미지";



    const start = Math.max(0, idx - 300);

    const end = Math.min(text.length, idx + marker.length + 300);

    let context = text.substring(start, end)

        .replace(/local:img_[0-9]+/g, '')

        .replace(/<!--.*?-->/g, '')

        .replace(/[#*`_>]/g, '')

        .trim();



    return context || "게임 기획 관련 이미지";

}



window.doRegenerateImage = async function (submitBtn, fallbackKeyword, imgId) {

    const overlay = submitBtn.closest('.prompt-overlay');

    const wrapper = overlay.closest('.image-wrapper');

    const textarea = overlay.querySelector('textarea');

    let prompt = textarea.value.trim();



    if (!prompt) {

        const context = extractContextForImage(imgId);

        prompt = `다음 문맥에 어울리는 이미지: ${context} (주요 키워드: ${fallbackKeyword})`;

    }



    overlay.innerHTML = `

                <div class="flex flex-col items-center justify-center h-full">

                    <div class="spinner spinner-large mb-4"></div>

                    <p class="text-sm text-white font-bold animate-pulse drop-shadow-md">새로운 이미지를 생성 중입니다...</p>

                    <p class="text-xs text-textLight/60 mt-2 max-w-[280px] text-center truncate px-4" title="${prompt}">프롬프트: ${prompt}</p>

                </div>

            `;



    try {

        const newB64 = await generateImageAPI(prompt);

        if (newB64) {

            const mod = getEditingModule();

            if (mod) {

                if (!mod.images) mod.images = {};

                mod.images[imgId] = newB64;

                saveState().then(() => {
                    const imgEl = wrapper.querySelector('img');

                    if (imgEl) imgEl.src = newB64;
                });

            }

        } else {

            window.showAlert('이미지 생성에 실패했습니다.');

        }

    } catch (e) {

        window.showAlert('이미지 재생성 중 오류가 발생했습니다.');

        console.error(e);

    } finally {

        if (overlay && overlay.parentNode) overlay.remove();

    }

};



window.updateSubjectMeta = function (field, value) {

    if (!currentSubjectId) return;

    const subj = globalState.subjects.find(s => s.id === currentSubjectId);

    if (subj && subj[field] !== value.trim()) {

        subj[field] = value.trim();

        saveState().then(() => {
            renderOverviewLNB();

            if (field === 'title') {

                document.getElementById('topic-input').value = value.trim();

                renderDiagram();

            }
        });

    }

}



// ─── v5.9 포팅: 사이드바 탭 전환 ───
function switchSidebarTab(tabId) {
    currentSidebarTab = tabId;
    ['topic', 'curriculum', 'reference'].forEach(t => {
        const panel = document.getElementById('sidebar-tab-' + t);
        const btn = document.querySelector('.sidebar-input-tab[data-sidebar-tab="' + t + '"]');
        if (panel) panel.classList.toggle('hidden', t !== tabId);
        if (btn) {
            btn.classList.toggle('border-accent', t === tabId);
            btn.classList.toggle('text-accent', t === tabId);
            btn.classList.toggle('border-transparent', t !== tabId);
            btn.classList.toggle('text-textMuted', t !== tabId);
        }
    });
}

// ─── v5.9 포팅: 강사 어투 선택 ───
function setInstructorTone(toneId) {
    instructorTone = toneId;
    try { localStorage.setItem('kyoan_tone', toneId); } catch (e) {}
    document.querySelectorAll('.tone-btn').forEach(btn => {
        const isActive = btn.dataset.tone === toneId;
        btn.className = 'tone-btn px-1.5 py-0.5 text-[0.6rem] font-bold rounded border transition-colors ' +
            (isActive ? 'bg-accent/20 text-accent border-accent/40' : 'bg-white/5 text-textMuted border-white/10');
    });
}

// ─── v5.9 포팅: 참고자료 URL 관리 ───
function addReferenceUrl() {
    const input = document.getElementById('reference-url-input');
    const url = (input?.value || '').trim();
    if (!url) return;
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return window.showAlert('교과를 먼저 선택해주세요.');
    if (subj.referenceUrls.some(r => r.url === url)) return window.showAlert('이미 등록된 URL입니다.');
    if (subj.referenceUrls.length >= 999) return window.showAlert('참고 URL은 최대 999개까지 등록 가능합니다.');

    // NotebookLM URL 감지 → 노트북 이름 입력 다이얼로그
    let isNotebookLM = false;
    try { isNotebookLM = new URL(url).hostname.includes('notebooklm'); } catch (e) {}

    if (isNotebookLM) {
        // 커스텀 다이얼로그로 노트북 이름 입력받기 (prompt()는 Electron에서 미지원)
        showNotebookNameDialog(url, subj);
        return; // 다이얼로그 콜백에서 처리
    }

    let title = '';
    try { title = new URL(url).hostname; } catch (e) { title = url.substring(0, 30); }
    subj.referenceUrls.push({ url, title, addedAt: Date.now() });
    input.value = '';
    renderReferenceUrls();
    updateReferenceStatus();
    saveState();
}

// NotebookLM 노트북 이름 입력 다이얼로그
function showNotebookNameDialog(url, subj) {
    // 기존 다이얼로그 제거
    const existing = document.getElementById('nb-name-dialog');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'nb-name-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px);';
    overlay.innerHTML = `
        <div style="background:#1e1b2e;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px;width:400px;max-width:90vw;">
            <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;">📒 NotebookLM 노트북 이름</div>
            <div style="font-size:11px;color:#9ca3af;margin-bottom:16px;">연결된 노트북의 이름을 입력하세요.</div>
            <input id="nb-name-input" type="text" placeholder="예: 04_AI를 활용한 게임 지표 분석과 BM기획"
                style="width:100%;padding:10px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:13px;outline:none;box-sizing:border-box;"
                autofocus>
            <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
                <button id="nb-cancel-btn" style="padding:8px 16px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#9ca3af;font-size:12px;font-weight:600;cursor:pointer;">취소</button>
                <button id="nb-confirm-btn" style="padding:8px 16px;background:#7c5bf5;border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">등록</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const nameInput = document.getElementById('nb-name-input');
    const confirmBtn = document.getElementById('nb-confirm-btn');
    const cancelBtn = document.getElementById('nb-cancel-btn');

    setTimeout(() => nameInput?.focus(), 100);

    const doConfirm = () => {
        const nbName = (nameInput?.value || '').trim();
        if (!nbName) { nameInput.style.borderColor = '#f87171'; return; }
        subj.referenceUrls.push({ url, title: '📒 ' + nbName, addedAt: Date.now() });
        document.getElementById('reference-url-input').value = '';
        overlay.remove();
        renderReferenceUrls();
        updateReferenceStatus();
        saveState();
    };

    confirmBtn.addEventListener('click', doConfirm);
    cancelBtn.addEventListener('click', () => overlay.remove());
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doConfirm(); if (e.key === 'Escape') overlay.remove(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function removeReferenceUrl(idx) {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return;
    subj.referenceUrls.splice(idx, 1);
    renderReferenceUrls();
    updateReferenceStatus();
    saveState();
}

function renderReferenceUrls() {
    const container = document.getElementById('reference-url-list');
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!container || !subj) return;
    if (subj.referenceUrls.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = subj.referenceUrls.map((r, i) =>
        `<div class="flex items-center gap-1 py-0.5 text-[0.6rem]">
            <a href="${r.url}" target="_blank" class="text-accent hover:underline truncate flex-1" title="${r.url}">${r.title || r.url}</a>
            <button onclick="removeReferenceUrl(${i})" class="text-red-400 hover:text-red-300 px-1 shrink-0">✕</button>
        </div>`
    ).join('');
}

function onReferenceTextChange() {
    const textarea = document.getElementById('reference-text-input');
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj || !textarea) return;
    subj.referenceText = textarea.value;
    const countEl = document.getElementById('reference-char-count');
    if (countEl) countEl.textContent = textarea.value.length + '자';
    updateReferenceStatus();
    saveState();
}

function updateReferenceStatus() {
    const badge = document.getElementById('reference-status-badge');
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!badge || !subj) return;
    const urls = subj.referenceUrls.length;
    const textLen = (subj.referenceText || '').length;
    if (urls === 0 && textLen === 0) {
        badge.textContent = '미등록';
        badge.className = 'text-[0.6rem] px-1.5 py-0.5 rounded bg-white/5 text-textMuted';
    } else {
        const parts = [];
        if (urls > 0) parts.push('링크 ' + urls + '개');
        if (textLen > 0) parts.push('텍스트 ' + textLen + '자');
        badge.textContent = parts.join(' + ');
        badge.className = 'text-[0.6rem] px-1.5 py-0.5 rounded bg-accent/15 text-accent';
    }
}

// 전역 등록 — HTML onclick에서 호출
window.addReferenceUrl = addReferenceUrl;
window.removeReferenceUrl = removeReferenceUrl;
window.onReferenceTextChange = onReferenceTextChange;

function syncReferenceUI() {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return;
    const textarea = document.getElementById('reference-text-input');
    if (textarea) textarea.value = subj.referenceText || '';
    const countEl = document.getElementById('reference-char-count');
    if (countEl) countEl.textContent = (subj.referenceText || '').length + '자';
    renderReferenceUrls();
    updateReferenceStatus();
}

// ─── v5.9 포팅: 커리큘럼 샘플 MD 다운로드 ───
function downloadCurriculumSample() {
    const sample = `# 게임 기획 기초 과정\n\n## 1단원: 게임 기획의 이해\n- 게임 기획이란 무엇인가?\n- MDA 프레임워크\n- 게임 디자이너의 역할\n- 재미의 본질\n- 기획 문서 작성법\n\n## 2단원: 시스템 기획\n- 수치 밸런스\n- 경제 시스템\n- 전투 시스템\n- 성장 시스템\n- 보상 설계`;
    const blob = new Blob([sample], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '커리큘럼_샘플.md';
    a.click();
    URL.revokeObjectURL(a.href);
}

function renderSidebar() {

    const list = document.getElementById('module-list');

    const subj = globalState.subjects.find(s => s.id === currentSubjectId);

    if (!subj) return;



    let html = '';



    // 교과 정보 & 메인 퀘스트 통합 모듈 (가로 분할 - 상하 Layout)

    const mq = subj.mainQuest;

    const allLessonsDone = Array.isArray(subj.lessons) && subj.lessons.length > 0 && subj.lessons.every(l => l.status === 'done');



    html += `

                <div class="mb-6 rounded-xl border border-white/10 bg-bgSidebar overflow-hidden flex flex-col shadow-[0_0_15px_rgba(0,0,0,0.2)]">

                    <div class="bg-white/5 p-2.5 border-b border-white/10 flex items-center gap-2">

                        <i class="ph-fill ph-sliders-horizontal text-accent"></i>

                        <h3 class="text-[0.7rem] font-bold text-textLight tracking-wider">교과 정보 및 레벨테스트</h3>

                    </div>

                    <div class="flex flex-col items-stretch">

                        <!-- 상단: 교과 정보 -->

                        <div class="w-full p-3 border-b border-white/10 flex flex-col gap-3">

                            <div>
                                <label class="text-[0.6rem] font-bold text-textMuted mb-1 flex items-center gap-1"><i class="ph-bold ph-file-code"></i> 파일명 규칙</label>
                                <div id="sidebar-filename-convention-ui"></div>
                            </div>

                        </div>



                        <!-- 하단: 메인 퀘스트 -->

                        <div class="w-full p-3 flex flex-col">

                            <div class="flex-1 p-3 rounded-lg border-2 ${mq && mq.status === 'done' ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-transparent hover:border-white/10 hover:bg-white/5'} flex flex-col cursor-pointer transition-all group module-card" data-id="mainQuest" onclick="viewModule('mainQuest')">

                                <div class="flex items-center justify-between mb-1.5">

                                    <div class="flex items-center gap-1">

                                        <i class="ph-fill ph-crown text-sm ${mq && mq.status === 'done' ? 'text-yellow-400' : 'text-accent'}"></i>

                                        <span class="text-[0.65rem] font-bold text-textLight group-hover:text-accent transition-colors">메인 퀘스트</span>

                                    </div>

                                    <span class="text-[0.6rem] font-bold px-1.5 py-0.5 rounded ${mq && mq.status === 'done' ? 'bg-yellow-500/20 text-yellow-300' : 'bg-white/10 text-white/50'}">${mq && mq.status === 'done' ? '완료' : '대기중'}</span>

                                </div>

                                <div class="mb-2">

                                    <h4 class="font-bold text-xs text-white mb-0.5 line-clamp-1">${mq ? mq.title : ''}</h4>

                                    <p class="text-[0.6rem] text-textMuted line-clamp-2">${mq ? mq.description : ''}</p>

                                </div>

                                <div class="mt-2 flex justify-between items-center pt-2 border-t border-white/5">

                                    <span class="text-[0.55rem] text-white/50">${allLessonsDone ? '🌟 차시 완료' : '⚠️ 진행 필요'}</span>

                                    <button onclick="event.stopPropagation(); promptAndGenerateMainQuest()" class="text-[0.6rem] font-bold px-2 py-1 rounded ${allLessonsDone ? 'bg-accent hover:bg-accentHover' : 'bg-white/10 hover:bg-white/20'} text-white transition-colors" ${!allLessonsDone && mq && mq.status !== 'done' ? 'title="모든 차시를 먼저 생성하는 것을 권장합니다."' : ''}>

                                        ${mq && mq.status === 'done' ? '재생성' : '발급'}

                                    </button>

                                </div>

                            </div>

                        </div>

                    </div>

                </div>

                

                <div class="flex items-center gap-2 mb-3 px-1">

                    <i class="ph-fill ph-flag-pennant text-textMuted"></i>

                    <h3 class="text-xs font-bold text-textMuted uppercase tracking-wider flex-1">차시 목록</h3>

                    <button onclick="deleteAllModules()" class="text-[0.55rem] font-bold px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors" title="모든 차시 일괄 삭제">
                        <i class="ph-bold ph-trash-simple"></i> 일괄 삭제
                    </button>

                </div>

            `;



    if (!Array.isArray(courseData) || courseData.length === 0) {

        html += `<div class="text-center pt-5 text-textMuted/60 text-sm leading-relaxed">차시 모듈이 없습니다.</div>`;

    } else {

        html += courseData.map((mod, idx) => `

                    <div class="module-card bg-white/5 border ${mod.status === 'done' ? 'border-green-500/30' : 'border-white/10'} rounded-xl p-4 mb-3 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg transition-all" 

                         data-id="${mod.id}" draggable="true" onclick="viewModule(${mod.id})" style="animation-delay: ${idx * 0.05}s">

                        <div class="flex justify-between items-start mb-2">

                            <div class="flex items-center gap-2">
                                <input type="checkbox" class="merge-checkbox w-3.5 h-3.5 accent-accent shrink-0 cursor-pointer" data-lesson-id="${mod.id}" onchange="toggleMergeCheckbox('${mod.id}')" onclick="event.stopPropagation()">
                                <span class="inline-flex items-center justify-center w-6 h-6 rounded bg-accent/20 text-accent font-bold text-xs">${idx + 1}</span>
                            </div>

                            <div class="flex gap-2">

                                <button class="text-white/40 hover:text-white cursor-grab drag-handle" title="순서 변경"><i class="ph-bold ph-list"></i></button>

                                <button onclick="event.stopPropagation(); deleteModule(${mod.id})" class="text-red-400/70 hover:text-red-400" title="삭제"><i class="ph-bold ph-x"></i></button>

                            </div>

                        </div>

                        <h3 class="font-bold text-sm text-white mb-1 outline-none focus:bg-white/10 rounded px-1 -ml-1" contenteditable="true" spellcheck="false" onblur="updateModuleMeta(${mod.id}, 'title', this.innerText)" onclick="event.stopPropagation()">${mod.title}</h3>

                        <p class="text-xs text-textMuted line-clamp-2 outline-none focus:bg-white/10 rounded px-1 -ml-1" contenteditable="true" spellcheck="false" onblur="updateModuleMeta(${mod.id}, 'description', this.innerText)" onclick="event.stopPropagation()">${mod.description}</p>

                        

                        <div class="mt-3 flex items-center justify-between">

                            <span class="text-[0.65rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${mod.status === 'done' ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/50'}">${mod.status === 'done' ? '작성완료' : '대기중'}</span>

                            <div class="flex gap-1.5 items-center">

                                ${mod.uploadedMdName

                ? `<div class="flex items-center gap-1 bg-blue-500/20 text-blue-300 px-2 py-1 rounded text-[0.65rem] border border-blue-500/30">

                                           <i class="ph-bold ph-file-md"></i> <span class="max-w-[50px] truncate" title="${mod.uploadedMdName}">${mod.uploadedMdName}</span>

                                           <button onclick="event.stopPropagation(); cancelFileUpload(${mod.id})" class="ml-1 hover:text-white" title="업로드 취소"><i class="ph-bold ph-x"></i></button>

                                       </div>`

                : `<label class="cursor-pointer text-[0.65rem] font-bold px-2 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white transition-colors border border-white/10 flex items-center gap-1" onclick="event.stopPropagation();" title="기존 마크다운 파일 업로드">

                                           <i class="ph-bold ph-upload-simple"></i> MD 업로드

                                           <input type="file" accept=".md" class="hidden" onchange="handleFileUpload(event, ${mod.id})">

                                       </label>`

            }

                                <button onclick="event.stopPropagation(); promptAndGenerateModule(${mod.id})" class="text-xs font-bold px-3 py-1.5 rounded bg-white/10 hover:bg-accent text-white transition-colors">

                                    ${mod.status === 'done' ? '<i class="ph-bold ph-arrows-clockwise mr-1"></i>재생성' : '<i class="ph-bold ph-sparkle mr-1"></i>교안 생성'}

                                </button>

                            </div>

                        </div>

                    </div>

                `).join('');

    }



    html += `

                <button onclick="addModule()" class="w-full py-3 border-2 border-dashed border-white/10 rounded-xl text-white/50 text-sm font-bold hover:border-accent/50 hover:text-accent transition-colors flex items-center justify-center gap-2 mt-4">

                    <i class="ph-bold ph-plus"></i> 새 차시 추가

                </button>

            `;



    // 병합 재생성 버튼
    html += `<button id="merge-btn" class="hidden w-full mt-3 px-3 py-2 text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-500 hover:to-indigo-500 transition-all flex items-center justify-center gap-2"
        onclick="executeMerge()">
        <i class="ph-bold ph-git-merge"></i> 선택한 <span class="merge-count">0</span>개 차시 병합 재생성
    </button>`;

    list.innerHTML = html;

    initDragAndDrop();
    if (typeof updateMergeUI === 'function') updateMergeUI();
    // v7.2: 사이드바 파일명 규칙 UI 렌더링
    if (typeof renderFilenameConventionUI === 'function') renderFilenameConventionUI();
}



window.viewModule = function (id) {

    document.querySelectorAll('.module-card').forEach(c => c.classList.remove('border-accent', 'bg-accent/10', 'border-yellow-400', 'bg-yellow-400/5'));

    const card = document.querySelector(`.module-card[data-id="${id}"]`);

    if (card) {

        if (id === 'mainQuest') card.classList.add('border-yellow-400', 'bg-yellow-400/5');

        else card.classList.add('border-accent', 'bg-accent/10');

    }



    const mod = getEditingModule(id);

    if (mod) {

        currentEditingModuleId = id;

        renderEditor(mod);

    }

}



window.updateModuleMeta = function (id, field, value) {

    const mod = getEditingModule(id);

    if (mod && mod[field] !== value.trim()) {

        mod[field] = value.trim();

        saveState().then(() => {
            if (id !== 'mainQuest') renderSidebar();
        });

    }

}



window.deleteModule = function (id) {

    if (id === 'mainQuest') return;

    showConfirm('차시 모듈을 삭제하시겠습니까?', () => {

        const mod = getEditingModule(id);

        if (mod && mod.content) archiveContent(mod);

        courseData = courseData.filter(m => String(m.id) !== String(id));

        if (String(currentEditingModuleId) === String(id)) {

            currentEditingModuleId = null;

            document.getElementById('editor-content-area').innerHTML = '<div class="h-full flex items-center justify-center text-textMuted text-sm">모듈이 삭제되었습니다.</div>';

            document.getElementById('ai-command-bar').classList.add('hidden'); // 삭제 시 커맨드 바도 숨김 처리

        }

        saveState().then(() => renderSidebar());

    });

}

// v7.2: 단원 일괄 삭제
window.deleteAllModules = function () {
    if (!courseData || courseData.length === 0) {
        return window.showAlert('삭제할 차시가 없습니다.');
    }
    const count = courseData.filter(m => m.id !== 'mainQuest').length;
    if (count === 0) return window.showAlert('삭제할 차시가 없습니다.');

    // v7.3: 3버튼 다이얼로그 — 삭제 / 보관함 저장 / 취소
    const overlay = document.createElement('div');
    overlay.id = 'delete-all-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
    overlay.innerHTML = `
        <div style="background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px;max-width:420px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
            <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
            <h3 style="color:#f3f4f6;font-size:18px;font-weight:700;margin-bottom:8px;">차시 일괄 삭제</h3>
            <p style="color:#9ca3af;font-size:14px;margin-bottom:24px;">총 <strong style="color:#f87171;">${count}개</strong> 차시를 삭제합니다.<br>보관함의 기존 저장 내용은 유지됩니다.</p>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                <button id="delete-all-confirm" style="padding:10px 20px;background:#ef4444;color:#fff;font-weight:700;border:none;border-radius:8px;cursor:pointer;font-size:14px;">🗑️ 즉시 삭제</button>
                <button id="delete-all-archive" style="padding:10px 20px;background:#8b5cf6;color:#fff;font-weight:700;border:none;border-radius:8px;cursor:pointer;font-size:14px;">📦 보관함에 저장 후 삭제</button>
                <button id="delete-all-cancel" style="padding:10px 20px;background:rgba(255,255,255,0.1);color:#9ca3af;font-weight:600;border:1px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;font-size:14px;">취소</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const cleanup = () => overlay.remove();

    document.getElementById('delete-all-cancel').onclick = cleanup;
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };

    document.getElementById('delete-all-confirm').onclick = () => {
        // 즉시 삭제 (보관함 저장 없이)
        courseData = courseData.filter(m => m.id === 'mainQuest');
        currentEditingModuleId = null;
        document.getElementById('editor-content-area').innerHTML = '<div class="h-full flex items-center justify-center text-textMuted text-sm">모든 차시가 삭제되었습니다.</div>';
        document.getElementById('ai-command-bar').classList.add('hidden');
        saveState().then(() => renderSidebar());
        if (window.showToast) window.showToast(`${count}개 차시가 즉시 삭제되었습니다.`, 'success');
        cleanup();
    };

    document.getElementById('delete-all-archive').onclick = () => {
        // 보관함에 저장 후 삭제
        courseData.forEach(mod => {
            if (mod.id !== 'mainQuest' && (mod.content || mod.tabContents)) {
                if (typeof archiveContent === 'function') archiveContent(mod);
            }
        });
        courseData = courseData.filter(m => m.id === 'mainQuest');
        currentEditingModuleId = null;
        document.getElementById('editor-content-area').innerHTML = '<div class="h-full flex items-center justify-center text-textMuted text-sm">모든 차시가 삭제되었습니다.</div>';
        document.getElementById('ai-command-bar').classList.add('hidden');
        saveState().then(() => renderSidebar());
        if (window.showToast) window.showToast(`${count}개 차시가 보관함에 저장 후 삭제되었습니다.`, 'success');
        cleanup();
    };
}

window.addModule = function () {

    const newId = Date.now();

    if (!Array.isArray(courseData)) courseData = [];

    courseData.push({ id: newId, title: '새 차시', description: '설명을 입력하세요', status: 'waiting', content: null, images: {}, uploadedMdName: null, uploadedMdContent: null });

    saveState().then(() => renderSidebar());

}

// =========================================================================
// MD 파일 업로드 / 취소 핸들러 (사이드바 차시 카드)
// =========================================================================

window.handleFileUpload = function (event, moduleId) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const mod = getEditingModule(moduleId);
        if (mod) {
            mod.uploadedMdName = file.name;
            mod.uploadedMdContent = e.target.result;
            saveState().then(() => renderSidebar());
        }
    };
    reader.readAsText(file, 'UTF-8');
    event.target.value = ''; // 리셋
}

window.cancelFileUpload = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (mod) {
        mod.uploadedMdName = null;
        mod.uploadedMdContent = null;
        saveState().then(() => renderSidebar());
    }
}

function renderEditor(mod) {

    const area = document.getElementById('editor-content-area');

    const cmdBar = document.getElementById('ai-command-bar');



    if (!mod.content) {

        area.innerHTML = `

                    <div class="h-full flex flex-col items-center justify-center text-center animate-fade-in p-8">

                        <i class="ph-duotone ${mod.id === 'mainQuest' ? 'ph-crown text-yellow-400/30' : 'ph-file-dashed text-white/20'} text-6xl mb-4"></i>

                        <h2 class="text-xl font-bold text-white mb-2">${mod.title}</h2>

                        <p class="text-textMuted text-sm mb-6">아직 교안 내용이 생성되지 않았습니다.</p>

                        <button onclick="${mod.id === 'mainQuest' ? 'promptAndGenerateMainQuest()' : `promptAndGenerateModule(${mod.id})`}" class="px-6 py-2.5 bg-accent hover:bg-accentHover text-white font-bold rounded-lg shadow-lg transition-colors flex items-center gap-2">

                            <i class="ph-bold ph-sparkle"></i> AI 교안 생성 시작하기

                        </button>

                    </div>

                `;

        cmdBar.classList.add('hidden');

        return;

    }



    let renderText = (typeof getActiveTabContent === 'function') ? getActiveTabContent(mod) : mod.content;

    // [최적화 & 버그픽스] 렌더 시 Base64 이미지로 교체 (정규표현식 글로벌 치환으로 안전하게 처리)
    if (mod.images) {
        for (const [imgId, b64] of Object.entries(mod.images)) {
            const regex = new RegExp(`local:${imgId}`, 'g');
            renderText = renderText.replace(regex, b64);
        }
    }

    // AI가 규칙을 무시하고 출력한 미할당(환각) local: 이미지 링크 일괄 제거 (네트워크 병목 방지)
    renderText = renderText.replace(/src="local:[^"]+"/g, 'src="" alt="[이미지 생성 누락]"');
    renderText = renderText.replace(/\(local:[^\)]+\)/g, '()');

    // v7.6: 공통 마크다운 전처리 적용
    renderText = preprocessMarkdown(renderText);

    // 안정화: marked.js 로드 실패 시 방어

    let htmlContent = '';

    try {

        htmlContent = typeof marked !== 'undefined' ? marked.parse(renderText) : `<pre class="text-gray-200 whitespace-pre-wrap">${renderText.replace(/</g, '&lt;')}</pre>`;
        // instructor-callout 내부 마크다운 재파싱
        htmlContent = reParseInstructorCallouts(htmlContent);
        // 한국어 마침표 뒤 줄바꿈 적용
        htmlContent = applyPeriodLineBreakHTML(htmlContent);
        // v7.6: 공통 HTML 후처리 적용
        htmlContent = postprocessHtml(htmlContent);

    } catch (e) {

        htmlContent = `<div class="p-4 bg-red-500/20 border border-red-500 text-red-400 rounded">마크다운 파싱 오류: ${e.message}</div><pre class="text-gray-200 mt-4">${renderText.replace(/</g, '&lt;')}</pre>`;

    }



    area.innerHTML = `

                <div class="sticky top-0 bg-bgEditor/95 backdrop-blur-sm border-b border-gray-200 z-30 shadow-sm">

                    <div class="p-4 flex justify-between items-center">

                        <h2 class="font-bold text-gray-800 truncate pr-4">${mod.title}</h2>

                        <div class="flex items-center gap-2 shrink-0">

                            <button onclick="generateQuiz()" id="quiz-btn" class="px-3 py-1.5 text-xs font-bold bg-emerald-50 text-emerald-600 border border-emerald-200 rounded hover:bg-emerald-100 flex items-center gap-1 transition-colors"><i class="ph-fill ph-question"></i> 퀴즈 생성</button>
                            <button onclick="generateAllImagesInModule('${mod.id}')" id="img-batch-btn" class="px-3 py-1.5 text-xs font-bold bg-purple-50 text-purple-600 border border-purple-200 rounded hover:bg-purple-100 flex items-center gap-1 transition-colors hover:-translate-y-0.5"><i class="ph-bold ph-image-square"></i> 일괄 이미지 찾기</button>
                            <button onclick="sanitizeAllContent()" id="sanitize-btn" class="px-3 py-1.5 text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 flex items-center gap-1 transition-colors hover:-translate-y-0.5" title="마크다운 문법 오류 일괄 정리 + 누락 이미지 일괄 생성"><i class="ph-bold ph-sparkle"></i> 콘텐츠 정리</button>
                            
                            <label class="cursor-pointer px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100 flex items-center gap-1 transition-colors" title="에디터에 이미지 삽입">
                                <i class="ph-bold ph-image"></i> 이미지 삽입
                                <input type="file" accept="image/*" class="hidden" multiple onchange="handleImageInputSelect(event)">
                            </label>

                            <button onclick="downloadImagesAsJPG('${mod.id}')" class="px-3 py-1.5 text-xs font-bold bg-teal-50 text-teal-600 border border-teal-200 rounded hover:bg-teal-100 flex items-center gap-1 transition-colors" title="이미지 JPG 다운로드">
                                <i class="ph-bold ph-download-simple"></i> 이미지 저장
                            </button>

                            <div class="w-px h-4 bg-gray-300 mx-1"></div>

                            <div class="flex bg-gray-100 rounded p-1 border border-gray-200">

                                <button onclick="toggleEditorMode('view')" id="toggle-view" class="px-3 py-1 text-xs font-bold rounded bg-white text-gray-800 shadow-sm transition-all">보기</button>

                                <button onclick="toggleEditorMode('edit')" id="toggle-edit" class="px-3 py-1 text-xs font-bold rounded text-gray-500 hover:text-gray-800 transition-all">수정</button>

                            </div>

                            <div class="w-px h-4 bg-gray-300 mx-1"></div>

                            <button onclick="toggleViewMode()" id="view-mode-toggle" class="px-2 py-1 text-xs font-bold rounded border border-gray-200 text-gray-600 hover:text-gray-800 transition-all" title="강사/학생 뷰 전환">🎓 강사</button>

                            <button onclick="insertImageSlot()" class="px-2 py-1 text-xs font-bold rounded border border-gray-200 text-gray-600 hover:text-gray-800 transition-all" title="이미지 슬롯 삽입">🖼️</button>

                        </div>

                    </div>

                    <!-- 보강 재생성 입력 바 -->
                    <div class="px-4 pb-2 flex items-center gap-2 border-t border-gray-100 pt-2">
                        <input type="text" id="reinforce-input" placeholder="보강 명령 (예: 예시를 더 추가해줘, 실습 난이도 높여줘)"
                            class="flex-1 px-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20">
                        <button onclick="reinforceCurrentTab('${mod.id}')" class="px-3 py-1.5 text-[0.65rem] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap">
                            <i class="ph-bold ph-arrow-clockwise"></i> 보강 재생성
                        </button>
                        <div id="tone-loading" class="hidden items-center gap-1.5 ml-2">
                            <div class="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin"></div>
                            <span class="text-[0.6rem] font-bold text-accent" id="tone-loading-text">재생성 중...</span>
                        </div>
                    </div>

                </div>

                <!-- 5탭 바 (sticky) -->
                <div class="sticky top-[105px] z-20 flex items-center gap-0.5 px-4 py-1 bg-white border-b border-gray-200 overflow-x-auto shadow-sm">
                    ${typeof renderTabBar === 'function' ? renderTabBar(mod) : ''}
                    <div class="flex-1"></div>
                    <button onclick="generateTabContent('${mod.id}', currentLessonTab)"
                        class="px-2.5 py-1.5 text-[0.65rem] font-bold text-accent bg-accent/10 border border-accent/30 rounded hover:bg-accent/20 transition-colors flex items-center gap-1 shrink-0">
                        <i class="ph-bold ph-sparkle"></i> 이 탭 생성
                    </button>
                    <button onclick="generateAllTabs('${mod.id}')"
                        class="px-2.5 py-1.5 text-[0.65rem] font-bold text-white bg-accent rounded hover:bg-accentHover transition-colors flex items-center gap-1 shrink-0 ml-1">
                        <i class="ph-bold ph-lightning"></i> 전체 탭
                    </button>
                    <button onclick="openSlideEditor('${mod.id}')"
                        class="px-2.5 py-1.5 text-[0.65rem] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 transition-colors flex items-center gap-1 shrink-0 ml-1"
                        title="교안을 바탕으로 편집 가능한 슬라이드 생성">
                        <i class="ph-bold ph-presentation-chart"></i> 슬라이드
                    </button>
                    <button onclick="downloadSlideTemplate()"
                        class="px-2.5 py-1.5 text-[0.65rem] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 transition-colors flex items-center gap-1 shrink-0 ml-0.5"
                        title="슬라이드 양식 HTML 다운로드 (빈 템플릿)">
                        <i class="ph-bold ph-file-html"></i> 양식
                    </button>
                </div>

                <div class="max-w-[800px] mx-auto p-8 pb-32">

                    <div id="render-view" class="markdown-body animate-fade-in">${htmlContent}</div>

                    <textarea id="raw-view" class="hidden w-full h-[600px] p-6 font-mono text-sm bg-gray-900 text-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-accent resize-y" spellcheck="false" onchange="saveRawContent()">${typeof getActiveTabContent === 'function' ? getActiveTabContent(mod) : (mod.content || '')}</textarea>

                </div>

                <!-- v7.5: 슬라이드 뷰 영역 (기본 노출, 빈 상태) -->
                <div id="slide-view-panel" class="border-t-2 border-indigo-500/30 bg-gradient-to-b from-gray-50 to-white">
                    <div class="flex items-center justify-between px-6 py-3 bg-indigo-50/50 border-b border-indigo-200/50">
                        <div class="flex items-center gap-2">
                            <i class="ph-bold ph-presentation-chart text-indigo-500"></i>
                            <span class="text-sm font-bold text-indigo-700">슬라이드 미리보기</span>
                            <span id="slide-status-badge" class="text-[0.6rem] px-2 py-0.5 rounded-full bg-gray-200 text-gray-500 font-bold">미생성</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="generateSlideView('${mod.id}')" id="slide-generate-btn"
                                class="px-3 py-1.5 text-xs font-bold text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-1">
                                <i class="ph-bold ph-sparkle"></i> 슬라이드 생성
                            </button>
                            <button onclick="regenerateSlideView('${mod.id}')" id="slide-regen-btn"
                                class="hidden px-3 py-1.5 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors items-center gap-1">
                                <i class="ph-bold ph-arrow-clockwise"></i> 재생성
                            </button>
                            <button onclick="downloadCurrentSlide()" id="slide-download-btn"
                                class="hidden px-3 py-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-1">
                                <i class="ph-bold ph-download-simple"></i> 내려받기
                            </button>
                        </div>
                    </div>
                    <div id="slide-preview-area" class="p-6 min-h-[200px] flex items-center justify-center">
                        <div class="text-center text-gray-400">
                            <i class="ph-light ph-presentation-chart text-4xl mb-2 block opacity-50"></i>
                            <p class="text-sm">교안 내용을 기반으로 슬라이드를 생성합니다</p>
                            <p class="text-xs mt-1 text-gray-300">상단 <b>슬라이드 생성</b> 버튼을 클릭하세요</p>
                        </div>
                    </div>
                </div>

            `;



    cmdBar.classList.remove('hidden');
    toggleEditorMode('view');

    // 인라인 에디팅 기능 활성화 (약간의 지연 후 렌더 트리가 안전할 때)
    setTimeout(() => initInlineEditing(), 100);
}

window.initInlineEditing = function () {
    const renderView = document.getElementById('render-view');
    if (!renderView) return;

    // 중복 바인딩 방지
    renderView.removeEventListener('dblclick', handleInlineEditDblClick);
    renderView.addEventListener('dblclick', handleInlineEditDblClick);
};

function handleInlineEditDblClick(e) {
    const mod = getEditingModule();
    if (!mod || !mod.content || typeof marked === 'undefined') return;

    // 최상위 블록 엘리먼트 찾기 (p, h1~6, ul/ol, blockquote, table 등)
    const topLevelTarget = e.target.closest('#render-view > *');
    if (!topLevelTarget || topLevelTarget.isEditing) return;

    // 클릭된 DOM 자식 요소의 인덱스 추적 (마크다운 AST 토큰과의 매핑 목적)
    const children = Array.from(document.getElementById('render-view').children);
    const targetIndex = children.indexOf(topLevelTarget);
    if (targetIndex === -1) return;

    try {
        const tokens = marked.lexer(mod.content);
        let blockIndex = 0;
        let targetToken = null;

        // Space 및 주석(Comment) 등 렌더 뷰에 표시되지 않는 토큰 필터링 인덱스 추적
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            let generatesElement = t.type !== 'space';
            if (t.type === 'html' && t.raw.trim().startsWith('<!--')) generatesElement = false;

            if (generatesElement) {
                if (blockIndex === targetIndex) {
                    targetToken = t;
                    break;
                }
                blockIndex++;
            }
        }

        if (!targetToken) return;

        // 원시 마크다운(Raw Markdown) 기반으로 Textarea 생성
        const rawMarkdownText = targetToken.raw.trimEnd();

        topLevelTarget.classList.add('hidden');
        const ta = document.createElement('textarea');
        ta.className = 'w-full p-4 font-mono text-sm bg-gray-900 border border-accent/40 shadow-xl shadow-accent/10 text-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-accent resize-y min-h-[100px] my-2 animate-fade-in';
        ta.value = rawMarkdownText;

        const saveAndRestore = () => {
            if (!topLevelTarget.isEditing) return;
            topLevelTarget.isEditing = false;

            const newMarkdown = ta.value.trimEnd();
            if (newMarkdown !== rawMarkdownText && newMarkdown) {
                // 원문을 AST 기반으로 완벽 재구성 (해당 블록만 새 문구로 치환)
                let newContent = "";
                let bIdx = 0;
                for (let t of tokens) {
                    let generatesElem = t.type !== 'space';
                    if (t.type === 'html' && t.raw.trim().startsWith('<!--')) generatesElem = false;

                    if (generatesElem) {
                        if (bIdx === targetIndex) {
                            newContent += newMarkdown + (t.raw.endsWith('\\n') ? '' : '\\n');
                        } else {
                            newContent += t.raw;
                        }
                        bIdx++;
                    } else {
                        newContent += t.raw;
                    }
                }

                mod.content = newContent;
                saveState().then(() => renderEditor(mod)); // 전체 리렌더링
                return;
            }

            // 변경사항 없으면 복구
            ta.remove();
            topLevelTarget.classList.remove('hidden');
        };

        ta.onblur = saveAndRestore;
        ta.onkeydown = (ev) => {
            // Shift + Enter 를 허용하고, 그냥 Enter 는 저장
            if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                ta.blur();
            } else if (ev.key === 'Escape') {
                ta.value = rawMarkdownText;
                ta.blur();
            }
        };

        topLevelTarget.parentNode.insertBefore(ta, topLevelTarget.nextSibling);
        topLevelTarget.isEditing = true;
        ta.focus();

    } catch (err) {
        console.error("인라인 편집 매핑 오류:", err);
    }
}


window.toggleEditorMode = function (mode) {

    const renderView = document.getElementById('render-view');

    const rawView = document.getElementById('raw-view');

    const btnView = document.getElementById('toggle-view');

    const btnEdit = document.getElementById('toggle-edit');



    if (!renderView || !rawView) return;



    if (mode === 'edit') {

        renderView.classList.add('hidden');

        rawView.classList.remove('hidden');

        btnEdit.classList.add('bg-white', 'text-gray-800', 'shadow-sm');

        btnEdit.classList.remove('text-gray-500');

        btnView.classList.remove('bg-white', 'text-gray-800', 'shadow-sm');

        btnView.classList.add('text-gray-500');

    } else {

        renderView.classList.remove('hidden');

        rawView.classList.add('hidden');

        btnView.classList.add('bg-white', 'text-gray-800', 'shadow-sm');

        btnView.classList.remove('text-gray-500');

        btnEdit.classList.remove('bg-white', 'text-gray-800', 'shadow-sm');

        btnEdit.classList.add('text-gray-500');



        const mod = getEditingModule();

        if (mod) {

            let renderText = rawView.value;

            // [최적화 & 버그픽스] 보기 모드 전환 시 Base64 글로벌 교체
            if (mod.images) {
                for (const [imgId, b64] of Object.entries(mod.images)) {
                    const regex = new RegExp(`local:${imgId}`, 'g');
                    renderText = renderText.replace(regex, b64);
                }
            }

            // 환각 미처리 local: 링크 역시 렌더링 시 방어
            renderText = renderText.replace(/src="local:[^"]+"/g, 'src="" alt="[이미지 생성 누락]"');
            renderText = renderText.replace(/\(local:[^\)]+\)/g, '()');

            // v7.6: 마크다운 전처리 (두 번째 렌더 경로에도 동일 적용)
            renderText = preprocessMarkdown(renderText);

            try {

                let parsedHtml = typeof marked !== 'undefined' ? marked.parse(renderText) : `<pre class="text-gray-200 whitespace-pre-wrap">${renderText.replace(/</g, '&lt;')}</pre>`;
                parsedHtml = reParseInstructorCallouts(parsedHtml);
                parsedHtml = applyPeriodLineBreakHTML(parsedHtml);
                parsedHtml = postprocessHtml(parsedHtml);
                renderView.innerHTML = parsedHtml;

                // Mermaid 다이어그램 렌더링 (근본적 수정)
                if (window.mermaid) {
                    setTimeout(async () => {
                        // 아직 SVG로 변환되지 않은 .mermaid div 찾기
                        const mermaidDivs = renderView.querySelectorAll('.mermaid');
                        if (mermaidDivs.length === 0) return;

                        // 이미 렌더링된 노드(SVG 포함) 건너뛰기
                        const unrendered = Array.from(mermaidDivs).filter(
                            el => !el.querySelector('svg') && el.textContent.trim()
                        );
                        if (unrendered.length === 0) return;

                        console.log(`[Mermaid] ${unrendered.length}개 다이어그램 렌더링 시작`);

                        // 각 다이어그램을 개별적으로 렌더링 (하나 실패해도 나머지 계속)
                        for (let i = 0; i < unrendered.length; i++) {
                            const el = unrendered[i];
                            let code = el.textContent.trim();
                            // 안전망: 렌더 직전에도 한 번 더 sanitize (저장된 원본 콘텐츠 호환)
                            if (typeof sanitizeMermaidCode === 'function') {
                                code = sanitizeMermaidCode(code);
                            }
                            const id = 'mermaid-svg-' + Date.now() + '-' + i;
                            try {
                                const { svg } = await window.mermaid.render(id, code);
                                el.innerHTML = svg;
                                console.log(`[Mermaid] 다이어그램 ${i + 1}/${unrendered.length} 렌더링 성공`);
                            } catch (err) {
                                // 1차 실패 → 더 aggressive sanitize 후 재시도 (괄호/특수문자 일괄 제거)
                                console.warn(`[Mermaid] 다이어그램 ${i + 1} 1차 실패:`, err.message);
                                try {
                                    const stripped = code
                                        .replace(/\[([^\[\]\n]{1,200})\]/g, (m, inner) => '[' + inner.replace(/[()"\[\]{}]/g, '').trim() + ']')
                                        .replace(/\{([^{}\n]{1,200})\}/g, (m, inner) => '{' + inner.replace(/[()"\[\]{}]/g, '').trim() + '}')
                                        .replace(/\|([^|\n]{1,200})\|/g, (m, inner) => '|' + inner.replace(/[()"]/g, '').trim() + '|');
                                    const { svg } = await window.mermaid.render(id + '_retry', stripped);
                                    el.innerHTML = svg;
                                    console.log(`[Mermaid] 다이어그램 ${i + 1} 재시도 성공`);
                                } catch (err2) {
                                    console.warn(`[Mermaid] 다이어그램 ${i + 1} 최종 실패:`, err2.message);
                                    el.innerHTML = `<div style="padding:12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#f87171;font-size:13px;">
                                        <strong>⚠️ Mermaid 렌더링 실패</strong><br>
                                        <code style="font-size:11px;opacity:0.7;">${err2.message}</code><br>
                                        <pre style="margin-top:8px;font-size:11px;opacity:0.5;white-space:pre-wrap;">${code.substring(0, 200)}</pre>
                                    </div>`;
                                }
                            }
                        }
                    }, 200);
                }

            } catch (e) {

                renderView.innerHTML = `<div class="p-4 bg-red-500/20 border border-red-500 text-red-400 rounded">마크다운 파싱 오류: ${e.message}</div>`;

            }

        }

    }

}



window.saveRawContent = function () {

    const rawView = document.getElementById('raw-view');

    const mod = getEditingModule();

    if (mod && rawView) {

        mod.content = rawView.value;



        // [가비지 컬렉션] 텍스트에서 삭제된 이미지 데이터 찌꺼기를 찾아 완전 삭제 (용량 확보)

        if (mod.images) {

            for (const imgId in mod.images) {

                if (!mod.content.includes(`local:${imgId}`)) {

                    delete mod.images[imgId];

                }

            }

        }

        saveState();

    }

}



window.switchAIMode = function (mode) {

    aiCommandMode = mode;

    const btnEdit = document.getElementById('mode-btn-edit');

    const btnImg = document.getElementById('mode-btn-image');

    const input = document.getElementById('ai-command-input');



    if (mode === 'edit') {

        btnEdit.className = 'px-3 py-1.5 text-xs font-bold rounded-md transition-all bg-accent text-white';

        btnImg.className = 'px-3 py-1.5 text-xs font-bold rounded-md transition-all text-gray-400 hover:text-white';

        input.placeholder = '텍스트를 드래그 선택 후 요청사항을 입력하세요...';

    } else {

        btnImg.className = 'px-3 py-1.5 text-xs font-bold rounded-md transition-all bg-accent text-white';

        btnEdit.className = 'px-3 py-1.5 text-xs font-bold rounded-md transition-all text-gray-400 hover:text-white';

        input.placeholder = '생성할 이미지에 대한 설명을 입력하세요...';

    }

}



window.executeAICommand = async function () {

    const input = document.getElementById('ai-command-input');
    const btn = document.getElementById('ai-command-send');
    const command = input.value.trim();
    if (!command) return;

    const renderView = document.getElementById('render-view');
    const rawView = document.getElementById('raw-view');
    if (!rawView) return;

    // ── 1. 실행 전 선택 텍스트 캡처 (보기 모드 / 수정 모드 양쪽 지원) ──
    let capturedSelection = '';
    let selStart = -1;
    let selEnd = -1;
    const isViewMode = renderView && !renderView.classList.contains('hidden');

    if (aiCommandMode === 'edit') {
        if (isViewMode) {
            // 보기 모드: UI에서 캡처해둔 텍스트 우선 사용, 없으면 현재 드래그 영역 사용
            if (window.currentCapturedSelection) {
                capturedSelection = window.currentCapturedSelection;
            } else {
                const sel = window.getSelection();
                capturedSelection = sel ? sel.toString().trim() : '';
            }
        } else {
            // 수정 모드: raw-view textarea 선택 범위 직접 사용
            selStart = rawView.selectionStart;
            selEnd = rawView.selectionEnd;
            capturedSelection = rawView.value.substring(selStart, selEnd).trim();
        }
        if (!capturedSelection) {
            return window.showAlert('수정할 텍스트를 먼저 드래그하여 선택해주세요.');
        }
    }

    // ── 2. 수정 모드로 전환하여 raw-view 접근 확보 ──
    toggleEditorMode('edit');

    // 보기 모드에서 캡처한 선택 텍스트를 raw 원문에서 위치 매핑
    if (aiCommandMode === 'edit' && isViewMode && capturedSelection) {
        const rawText = rawView.value;
        // HTML 태그/엔티티 제거된 순수 텍스트로 검색 (렌더링 산물 차이 보정)
        const plainCapture = capturedSelection.replace(/\s+/g, ' ');

        // 1차: 원문에서 그대로 검색
        let idx = rawText.indexOf(capturedSelection);

        // 2차: 공백 정규화 후 재시도
        if (idx === -1) {
            const normalizedRaw = rawText.replace(/\s+/g, ' ');
            const normIdx = normalizedRaw.indexOf(plainCapture);
            if (normIdx !== -1) {
                // 정규화 인덱스를 원본 인덱스로 역변환 (근사치)
                let count = 0, origIdx = 0;
                for (let i = 0; i < rawText.length && count < normIdx; i++) {
                    if (rawText[i] === normalizedRaw[count]) count++;
                    origIdx = i + 1;
                }
                idx = origIdx > 0 ? origIdx - 1 : 0;
            }
        }

        if (idx !== -1) {
            selStart = idx;
            // 원본에서 캡처 텍스트의 실제 끝 위치 (줄바꿈 포함 원본 기준)
            const remaining = rawText.substring(idx);
            // 캡처 텍스트의 각 단어를 순서대로 매칭하여 끝 위치 산출
            let endSearch = idx + capturedSelection.length;
            // 보수적 확장: 마크다운 기호 등으로 인한 오프셋 보정
            const snippet = rawText.substring(idx, Math.min(idx + capturedSelection.length + 50, rawText.length));
            const lastWordMatch = capturedSelection.split(/\s+/).pop();
            if (lastWordMatch) {
                const lwIdx = snippet.lastIndexOf(lastWordMatch);
                if (lwIdx !== -1) endSearch = idx + lwIdx + lastWordMatch.length;
            }
            selEnd = Math.min(endSearch, rawText.length);
        } else {
            // 매핑 실패 시 사용자에게 수정 모드 안내
            return window.showAlert('선택한 텍스트를 원문에서 찾지 못했습니다.\n"수정" 탭에서 직접 텍스트를 선택한 뒤 다시 시도해주세요.');
        }
    }

    input.disabled = true;
    btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i>';

    try {
        if (aiCommandMode === 'edit') {
            if (selStart === selEnd || selStart < 0) throw new Error("수정할 텍스트를 영역 선택해주세요.");

            const text = rawView.value;
            const selectedText = text.substring(selStart, selEnd);
            const context = text.substring(Math.max(0, selStart - 300), selStart);

            const { systemInstruction, userPrompt } = buildTaskContext('edit', { context, selectedText, command });

            const res = await callGemini(TEXT_MODEL, {
                        contents: [{ parts: [{ text: userPrompt }] }],
                        systemInstruction: { parts: [{ text: systemInstruction }] }
            });

            let newText = extractText(res);
            newText = newText.replace(/^```\w*\n?/i, '').replace(/\n?```$/i, '').trim();

            rawView.value = text.substring(0, selStart) + newText + text.substring(selEnd);

            if (typeof clearAISelection === 'function') clearAISelection();

        } else if (aiCommandMode === 'image') {
            const b64 = await generateImageAPI(command);
            if (b64) {
                const mod = getEditingModule();
                if (!mod.images) mod.images = {};
                const imgId = 'img_' + Date.now() + Math.floor(Math.random() * 1000);
                mod.images[imgId] = b64;

                const imgTag = `\n<div class="image-wrapper"><img src="local:${imgId}" alt="${command}" class="rounded-lg border-2 border-accent/30 shadow-md max-w-full"><span class="absolute bottom-3 left-3 bg-black/80 text-white text-[0.6rem] px-2 py-1 rounded border border-white/20 flex items-center gap-1 pointer-events-none"><i class="ph-fill ph-sparkle text-accent"></i> AI 생성 이미지</span><button class="image-regenerate-btn px-3 py-1.5 text-xs text-white font-bold rounded flex items-center gap-1 border border-accent/50 hover:bg-accent transition-colors" onclick="promptRegenerateImage(this, '${command}', '${imgId}')"><i class="ph-bold ph-arrows-clockwise"></i> 다시 생성</button></div>\n`;

                const text = rawView.value;
                // 보기 모드에서 진입한 경우 커서가 0이므로 문서 끝에 삽입
                const pos = (isViewMode || rawView.selectionStart === 0) ? text.length : rawView.selectionStart;
                rawView.value = text.substring(0, pos) + imgTag + text.substring(pos);
            } else {
                window.showAlert('이미지 생성에 실패했습니다.');
            }
        }

        // 저장 후 보기 모드로 복귀하여 렌더링 결과 표시
        saveRawContent();
        toggleEditorMode('view');
        input.value = '';
        window.showAlert(aiCommandMode === 'edit' ? '✅ 텍스트 수정 완료!' : '✅ 이미지 삽입 완료!');

    } catch (err) {
        window.showAlert(err.message || '명령 실행 중 오류 발생');
    } finally {
        input.disabled = false;
        btn.innerHTML = '✨ 실행';
        input.focus();
    }
}



// ===== 문체 변환 (Tone Conversion) =====
window.applyToneConversion = async function (toneId) {
    const mod = getEditingModule();
    if (!mod || !mod.content) {
        return window.showAlert('변환할 교안 콘텐츠가 없습니다.');
    }

    const preset = typeof TONE_PRESETS !== 'undefined' ? TONE_PRESETS.find(t => t.id === toneId) : null;
    if (!preset) return window.showAlert('알 수 없는 문체입니다.');

    window.showConfirm(
        `"${preset.label}" 문체로 전체 교안을 변환합니다.\n원본은 히스토리에 자동 저장됩니다. 계속할까요?`,
        async () => {
            const loadingEl = document.getElementById('tone-loading');
            const loadingText = document.getElementById('tone-loading-text');
            const allBtns = document.querySelectorAll('#tone-toolbar button');

            if (loadingEl) { loadingEl.classList.remove('hidden'); loadingEl.classList.add('flex'); }
            if (loadingText) loadingText.textContent = `${preset.label} 변환 중...`;
            allBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.4'; b.style.pointerEvents = 'none'; });

            try {
                if (typeof archiveContent === 'function') archiveContent(mod, '문체 변환 전 백업');

                const { systemInstruction, userPrompt } = buildTaskContext('tone', {
                    tonePrompt: preset.prompt,
                    content: mod.content
                });

                const payload = {
                    contents: [{ parts: [{ text: userPrompt }] }],
                    systemInstruction: { parts: [{ text: systemInstruction }] }
                };

                const data = await callGemini(TEXT_MODEL, payload);

                let resultText = extractText(data);
                if (resultText && resultText.trim().length > 50) {
                    // 모델이 마크다운 블록(```)으로 감싸서 리턴할 경우 제거하는 전처리 로직
                    resultText = resultText.replace(/^```\w*\n?/i, '').replace(/\n?```$/i, '').trim();
                    mod.content = resultText;
                    await saveState();
                    renderEditor(mod);
                    window.showAlert(`✅ "${preset.label}" 문체로 변환 완료!`);
                } else {
                    window.showAlert('변환 결과가 너무 짧습니다. 다시 시도해 주세요.');
                }
            } catch (err) {
                console.error('문체 변환 실패:', err);
                window.showAlert('문체 변환 중 오류: ' + (err.message || '알 수 없는 오류'));
            } finally {
                if (loadingEl) { loadingEl.classList.add('hidden'); loadingEl.classList.remove('flex'); }
                allBtns.forEach(b => { b.disabled = false; b.style.opacity = '1'; b.style.pointerEvents = ''; });
            }
        }
    );
}


// ===== 분량 조절 (Volume Control) =====
window.applyVolumeControl = async function (direction) {
    const mod = getEditingModule();
    if (!mod || !mod.content) {
        return window.showAlert('조절할 교안 콘텐츠가 없습니다.');
    }

    const preset = typeof VOLUME_PRESETS !== 'undefined' ? VOLUME_PRESETS[direction] : null;
    if (!preset) return window.showAlert('알 수 없는 분량 옵션입니다.');

    window.showConfirm(
        `교안을 "${preset.label}" 방향으로 조절합니다.\n원본은 히스토리에 자동 저장됩니다. 계속할까요?`,
        async () => {
            const loadingEl = document.getElementById('tone-loading');
            const loadingText = document.getElementById('tone-loading-text');
            const allBtns = document.querySelectorAll('#tone-toolbar button');

            if (loadingEl) { loadingEl.classList.remove('hidden'); loadingEl.classList.add('flex'); }
            if (loadingText) loadingText.textContent = `${preset.label} 조절 중...`;
            allBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.4'; b.style.pointerEvents = 'none'; });

            try {
                if (typeof archiveContent === 'function') archiveContent(mod, '분량 조절 전 백업');

                const { systemInstruction, userPrompt } = buildTaskContext('volume', {
                    volumePrompt: preset.prompt,
                    content: mod.content
                });

                const payload = {
                    contents: [{ parts: [{ text: userPrompt }] }],
                    systemInstruction: { parts: [{ text: systemInstruction }] }
                };

                const data = await callGemini(TEXT_MODEL, payload);

                let resultText = extractText(data);
                if (resultText && resultText.trim().length > 30) {
                    resultText = resultText.replace(/^```\w*\n?/i, '').replace(/\n?```$/i, '').trim();
                    const before = mod.content.length;
                    mod.content = resultText;
                    const after = resultText.length;
                    const ratio = Math.round((after / before) * 100);
                    await saveState();
                    renderEditor(mod);
                    window.showAlert(`✅ 분량 조절 완료! (${before.toLocaleString()}자 → ${after.toLocaleString()}자, ${ratio}%)`);
                } else {
                    window.showAlert('분량 조절 결과가 비어있습니다. 다시 시도해 주세요.');
                }
            } catch (err) {
                console.error('분량 조절 실패:', err);
                window.showAlert('분량 조절 중 오류: ' + (err.message || '알 수 없는 오류'));
            } finally {
                if (loadingEl) { loadingEl.classList.add('hidden'); loadingEl.classList.remove('flex'); }
                allBtns.forEach(b => { b.disabled = false; b.style.opacity = '1'; b.style.pointerEvents = ''; });
            }
        }
    );
}

// v7.2: 이미지 삭제 — 보기모드에서 이미지 제거
window.deleteImage = function (imgId, btnEl) {
    if (!confirm('이 이미지를 삭제하시겠습니까?')) return;
    const mod = getEditingModule();
    if (!mod) return;

    // Base64 캐시에서 제거
    if (mod.images && mod.images[imgId]) {
        delete mod.images[imgId];
    }

    // 마크다운에서 이미지 참조 제거 (local:imgId 또는 data:image 형태)
    const tabId = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
    if (tabId && mod.tabContents && mod.tabContents[tabId]) {
        mod.tabContents[tabId] = mod.tabContents[tabId]
            .replace(new RegExp(`!\\[[^\\]]*\\]\\(local:${imgId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'), '')
            .replace(new RegExp(`!\\[[^\\]]*\\]\\(data:image[^)]+\\)`, 'g'), '');
    }
    if (mod.content) {
        mod.content = mod.content
            .replace(new RegExp(`!\\[[^\\]]*\\]\\(local:${imgId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'), '');
    }

    // DOM에서 이미지 wrapper 제거
    const wrapper = btnEl?.closest('[data-imgid]');
    if (wrapper) {
        wrapper.style.transition = 'opacity 0.3s, transform 0.3s';
        wrapper.style.opacity = '0';
        wrapper.style.transform = 'scale(0.95)';
        setTimeout(() => wrapper.remove(), 300);
    }

    if (typeof saveGlobalState === 'function') saveGlobalState();
    if (window.showToast) window.showToast('이미지가 삭제되었습니다.', 'success');
};

// v7.3: 이미지 JPG 일괄 다운로드
window.downloadImagesAsJPG = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod || !mod.images || Object.keys(mod.images).length === 0) {
        return window.showAlert('다운로드할 이미지가 없습니다.');
    }

    // 현재 탭 이미지만 vs 전체 차시 이미지 선택
    const tabId = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
    const tabContent = tabId && mod.tabContents ? (mod.tabContents[tabId] || '') : '';
    const allImgIds = Object.keys(mod.images);
    const tabImgIds = allImgIds.filter(id => tabContent.includes(id));

    if (tabImgIds.length === 0 && allImgIds.length === 0) {
        return window.showAlert('다운로드할 이미지가 없습니다.');
    }

    // 선택 다이얼로그
    const hasTabImages = tabImgIds.length > 0;
    const hasAllImages = allImgIds.length > 0;

    let targetIds;
    if (hasTabImages && allImgIds.length > tabImgIds.length) {
        const choice = confirm(
            `현재 탭: ${tabImgIds.length}개 이미지\n전체 차시: ${allImgIds.length}개 이미지\n\n[확인] = 현재 탭만 다운로드\n[취소] = 전체 차시 다운로드`
        );
        targetIds = choice ? tabImgIds : allImgIds;
    } else {
        targetIds = hasTabImages ? tabImgIds : allImgIds;
    }

    // 다운로드 실행
    targetIds.forEach((imgId, index) => {
        const b64 = mod.images[imgId];
        if (!b64) return;
        setTimeout(() => {
            const a = document.createElement('a');
            a.href = b64;
            a.download = `${(mod.title || '교안').replace(/[^\w가-힣]/g, '_')}_img_${index + 1}.jpg`;
            a.click();
        }, index * 300); // 동시 다운로드 방지
    });

    if (window.showToast) window.showToast(`📸 ${targetIds.length}개 이미지 다운로드 시작`, 'success');
};

// ===== 개별 이미지 문맥 파악 및 재생성 (Context-Aware Image Regeneration) =====
window.regenerateImage = async function (imgId, btnEl) {
    const mod = getEditingModule();
    if (!mod || !mod.content) return;

    const container = btnEl.closest('.group');
    if (!container) return;

    // 1. 이미지 주변 문맥(Context) 추출 
    let contextText = '';

    // 이전 2~3개 블록 텍스트
    let prev = container.previousElementSibling;
    for (let i = 0; i < 3 && prev; i++) {
        if (prev.innerText) contextText = prev.innerText + "\\n" + contextText;
        prev = prev.previousElementSibling;
    }
    // 다음 2~3개 블록 텍스트
    let next = container.nextElementSibling;
    for (let i = 0; i < 3 && next; i++) {
        if (next.innerText) contextText += "\\n" + next.innerText;
        next = next.nextElementSibling;
    }

    let promptSuffix = "이 이미지와 어울리는 새로운 16:9 픽셀아트 스타일의 게임 기획서용 삽화를 한글 프롬프트로 만들어줘.";
    if (contextText.trim()) {
        promptSuffix = `다음 앞뒤 문맥과 완벽히 어울리는 16:9 픽셀아트 스타일의 게임 기획서/교안 삽화 프롬프트를 작성해줘:\n[문맥]\n${contextText.substring(0, 400)}`;
    }

    // 2. 로딩 스피너 UI 활성화
    const originalBtnParent = btnEl.parentElement;

    const overlay = document.createElement('div');
    overlay.className = 'absolute inset-0 bg-bgEditor/85 backdrop-blur-md flex flex-col items-center justify-center z-10 transition-all rounded-xl';
    overlay.innerHTML = `
        <div class="w-10 h-10 border-4 border-accent/20 border-t-accent rounded-full animate-spin mb-4"></div>
        <p class="text-sm font-bold text-white shadow-sm mb-1">AI 문맥 분석 및 재생성 중...</p>
        <p class="text-[0.65rem] text-accent font-mono bg-accent/10 px-2 py-0.5 rounded">ETA: 5~15s</p>
    `;
    container.appendChild(overlay);
    originalBtnParent.classList.add('hidden');

    try {
        // 3. Gemini API를 통해 문맥에 맞는 그림 묘사(Text) 획득
        const payload = {
            contents: [{ parts: [{ text: promptSuffix }] }],
            systemInstruction: { parts: [{ text: "너는 탁월한 게임 컨셉 아트 프롬프트 엔지니어다. 다른 인사말이나 설명 없이 무조건 '한 문장'짜리 명사 위주의 영어 번역 가능한 이미지 묘사 프롬프트만 반환하라." }] },
            generationConfig: { temperature: 0.8 }
        };

        const data = await callGemini(TEXT_MODEL, payload);

        let imagePrompt = extractText(data).trim();
        if (!imagePrompt) throw new Error("프롬프트 획득 실패");

        // 4. Pollinations.ai 무료 API로 새 그림 생성 
        const encodedPrompt = encodeURIComponent(imagePrompt + ", 16:9, pixel art, game concept art, high quality, masterpiece");
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=450&nologo=true&seed=${Math.floor(Math.random() * 9999999)}`;

        const tempImg = new Image();
        tempImg.crossOrigin = "Anonymous";

        await new Promise((resolve, reject) => {
            tempImg.onload = resolve;
            tempImg.onerror = reject;
            tempImg.src = imageUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = tempImg.width;
        canvas.height = tempImg.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(tempImg, 0, 0);
        const base64Image = canvas.toDataURL('image/png', 0.85);

        // 5. 모듈 스토리지 업데이트 및 텍스트 리렌더 
        if (!mod.images) mod.images = {};

        if (typeof archiveContent === 'function') archiveContent(mod, '이미지 재생성 전 백업');

        if (imgId.startsWith('http')) {
            const newImgId = 'img_' + Date.now() + Math.floor(Math.random() * 1000);
            mod.content = mod.content.split(imgId).join(`local:${newImgId}`);
            mod.images[newImgId] = base64Image;
        } else {
            mod.images[imgId] = base64Image;
        }

        await saveState();
        renderEditor(mod); // 전체 리렌더링 수행
        window.showAlert('✅ 주변 문맥을 반영하여 이미지가 성공적으로 갱신되었습니다.');

    } catch (e) {
        console.error("이미지 재생성 오류:", e);
        window.showAlert("이미지 재생성 실패: " + e.message);
        overlay.remove();
        originalBtnParent.classList.remove('hidden');
    }
}


// ── Phase F3: 최종 서식 변환 (local: → 웹 URL 일괄) ──

window.showFormatConvertModal = function () {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return window.showAlert('교과를 먼저 선택해 주세요.');

    // local: 이미지가 있는지 체크
    const allMods = [...(subj.lessons || [])];
    if (subj.mainQuest) allMods.push(subj.mainQuest);
    const hasLocal = allMods.some(m => m.content && m.content.includes('local:'));
    if (!hasLocal) return window.showAlert('변환할 local: 이미지 참조가 없습니다.');

    const modalHTML = `
        <div class="p-4 space-y-4">
            <p class="text-sm text-textMuted">현재 교과의 모든 차시 교안에서 <code>local:</code> 이미지 참조를 웹 URL로 일괄 변환합니다.</p>
            <div>
                <label class="block text-xs font-bold text-white/70 mb-1">① 이미지 웹 폴더 URL (끝에 / 포함)</label>
                <input id="convert-base-url" type="text" placeholder="https://example.com/images/course01/"
                    class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent transition-colors"
                    value="">
            </div>
            <div>
                <label class="block text-xs font-bold text-white/70 mb-1">② 파일명 컨벤션</label>
                <select id="convert-naming" class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent">
                    <option value="sequential">순번 (image01.png, image02.png, ...)</option>
                    <option value="keep">원본 ID 유지 (img_xxxxx.png)</option>
                </select>
            </div>
            <div class="flex gap-2 justify-end mt-4">
                <button onclick="document.getElementById('custom-modal').classList.add('hidden')"
                    class="px-4 py-2 text-sm text-white/60 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors">취소</button>
                <button onclick="executeFormatConvert()"
                    class="px-4 py-2 text-sm font-bold text-white bg-accent hover:bg-accentHover rounded-lg transition-colors">변환 실행</button>
            </div>
        </div>
    `;
    window.showModal('🔄 최종 서식 변환 (local: → 웹 URL)', modalHTML);
};

window.executeFormatConvert = function () {
    const baseUrl = document.getElementById('convert-base-url').value.trim();
    const naming = document.getElementById('convert-naming').value;

    if (!baseUrl) return window.showAlert('이미지 웹 폴더 URL을 입력해 주세요.');
    const safeBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';

    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return;

    const allMods = [...(subj.lessons || [])];
    if (subj.mainQuest) allMods.push(subj.mainQuest);

    let totalReplaced = 0;
    let imgCounter = 1;

    allMods.forEach(mod => {
        if (!mod.content || !mod.content.includes('local:')) return;

        // local:imgId 패턴 추출
        const localRefs = [...new Set(mod.content.match(/local:img_[a-zA-Z0-9_]+/g) || [])];

        localRefs.forEach(ref => {
            const imgId = ref.substring(6); // 'local:' 제거
            let fileName;

            if (naming === 'sequential') {
                fileName = `image${String(imgCounter).padStart(2, '0')}.png`;
                imgCounter++;
            } else {
                fileName = `${imgId}.png`;
            }

            const webUrl = safeBaseUrl + fileName;

            // local:imgId → 웹 URL 교체
            mod.content = mod.content.split(`local:${imgId}`).join(webUrl);

            // image-wrapper div 구조를 최종 서식으로 변환
            // <div class="image-wrapper"><img src="URL" ...>...</div> → <p align="center"><img></p>
            const wrapperRegex = new RegExp(
                `<div class="image-wrapper">\\s*<img src="${webUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*alt="([^"]*)"[^>]*>[\\s\\S]*?</div>`,
                'g'
            );
            mod.content = mod.content.replace(wrapperRegex, (match, alt) => {
                return `\n<p align="center">\n  <img src="${webUrl}" alt="${alt}">\n</p>\n`;
            });

            totalReplaced++;
        });
    });

    saveState().then(() => {
        if (currentEditingModuleId) {
            const mod = getEditingModule(currentEditingModuleId);
            if (mod) renderEditor(mod);
        }

        document.getElementById('custom-modal').classList.add('hidden');
        window.showAlert(`✅ ${totalReplaced}개의 이미지 참조가 웹 URL로 변환되었습니다.`);
    });
};

// ─── v8: 강사/학생/분할 3모드 뷰 토글 ───
function toggleViewMode() {
    const btn = document.getElementById('view-mode-toggle');
    // 순환: 강사 → 학생 → 분할 → 강사
    if (window.viewMode === 'instructor') {
        window.viewMode = 'student';
        document.body.classList.add('student-view');
        destroySplitView();
        if (btn) btn.innerHTML = '🎓 학생';
    } else if (window.viewMode === 'student') {
        window.viewMode = 'split';
        document.body.classList.remove('student-view');
        createSplitView();
        if (btn) btn.innerHTML = '📖 분할';
    } else {
        window.viewMode = 'instructor';
        document.body.classList.remove('student-view');
        destroySplitView();
        if (btn) btn.innerHTML = '🎓 강사';
    }
}

// ─── v8: 분할 뷰 생성/해제 ───
function createSplitView() {
    const renderView = document.getElementById('render-view');
    if (!renderView) return;
    const parent = renderView.parentElement;
    if (!parent) return;

    destroySplitView();
    renderView.style.display = 'none';

    const container = document.createElement('div');
    container.id = 'split-view-container';
    container.className = 'split-view-container';

    // 왼쪽: 수강생 뷰 (강사 callout은 CSS로 투명화 + 공간 유지)
    const leftPane = document.createElement('div');
    leftPane.className = 'split-view-pane split-student-pane';
    leftPane.id = 'split-left';
    leftPane.innerHTML =
        '<div class="split-view-label student">📘 수강생 뷰</div>' +
        '<div class="split-pane-content"><div class="markdown-body">' + renderView.innerHTML + '</div></div>';

    // 오른쪽: 강사 뷰 (스크립트 포함)
    const rightPane = document.createElement('div');
    rightPane.className = 'split-view-pane';
    rightPane.id = 'split-right';
    rightPane.innerHTML =
        '<div class="split-view-label instructor">📙 강사 뷰 (스크립트 포함)</div>' +
        '<div class="split-pane-content"><div class="markdown-body">' + renderView.innerHTML + '</div></div>';

    container.appendChild(leftPane);
    container.appendChild(rightPane);
    parent.insertBefore(container, renderView);

    // 동기 스크롤 (pixel-based — 같은 높이이므로 1:1)
    let syncing = false;
    const syncScroll = (source, target) => {
        if (syncing) return;
        syncing = true;
        target.scrollTop = source.scrollTop;
        requestAnimationFrame(() => { syncing = false; });
    };
    leftPane._scrollHandler = () => syncScroll(leftPane, rightPane);
    rightPane._scrollHandler = () => syncScroll(rightPane, leftPane);
    leftPane.addEventListener('scroll', leftPane._scrollHandler, { passive: true });
    rightPane.addEventListener('scroll', rightPane._scrollHandler, { passive: true });

    // Mermaid 재렌더링
    if (window.mermaid) {
        setTimeout(async () => {
            const divs = container.querySelectorAll('.mermaid');
            for (let i = 0; i < divs.length; i++) {
                const el = divs[i];
                if (el.querySelector('svg') || !el.textContent.trim()) continue;
                try {
                    const { svg } = await window.mermaid.render('split-m-' + Date.now() + '-' + i, el.textContent.trim());
                    el.innerHTML = svg;
                } catch (e) { /* skip */ }
            }
        }, 200);
    }
}

function destroySplitView() {
    const container = document.getElementById('split-view-container');
    if (container) {
        const left = document.getElementById('split-left');
        const right = document.getElementById('split-right');
        if (left && left._scrollHandler) left.removeEventListener('scroll', left._scrollHandler);
        if (right && right._scrollHandler) right.removeEventListener('scroll', right._scrollHandler);
        container.remove();
    }
    const renderView = document.getElementById('render-view');
    if (renderView) renderView.style.display = '';
}

// ─── v5.9 포팅: 이미지 슬롯 빠른 삽입 ───
function insertImageSlot() {
    const keyword = prompt('이미지 검색 키워드를 입력하세요 (영어 권장):', '');
    if (!keyword || !keyword.trim()) return;
    const tag = '\n<!-- [IMG: "' + keyword.trim() + '"] -->\n';
    const editArea = document.getElementById('edit-textarea');
    if (editArea && !editArea.classList.contains('hidden')) {
        const start = editArea.selectionStart;
        const val = editArea.value;
        editArea.value = val.substring(0, start) + tag + val.substring(start);
        editArea.selectionStart = editArea.selectionEnd = start + tag.length;
        editArea.focus();
    } else {
        const mod = getEditingModule();
        if (mod && mod.content) {
            mod.content += tag;
            saveState();
            renderEditor(mod);
            window.showAlert('이미지 슬롯이 끝에 추가되었습니다.');
        }
    }
}
