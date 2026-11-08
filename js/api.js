// ═══ v7.6: 공통 전처리/후처리 함수 ═══

function preprocessMarkdown(source) {
    // 코드 블록 안의 글은 바꾸지 않는다(# 주석, 2. 같은 줄도 코드다)
    const fences = stashCodeFences(source);
    let text = fences.text;
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
    return fences.restore(text);
}

function postprocessHtml(source) {
    const EMOJI_SET = '💡|✅|☑️|ℹ️|💬|🎮|⚠️|⚙️|🗣️|💥|🔑|🎯|🏆|📌|🔍|🎨|📝|🧠|🎵|🎬|📊|🔧|🎓|🎲|🕹️|📱|💻|🖥️';
    const TOP_EMOJI = '💡|🎮|⚠️|✅|⚙️|☑️';
    // 코드 블록(<pre>)은 후처리하지 않는다. a**2 + b**2가 굵은 글씨가 되거나 이모지 앞에 줄바꿈이 들어가지 않게 맨 끝에 되돌린다
    const pres = [];
    let html = String(source).replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, block => `\u0000PRE${pres.push(block) - 1}\u0000`);

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
    // 서식 막대로 직접 고른 번호 목록(<!-- 번호 목록 -->)만 번호로 남긴다
    if (typeof keepChosenNumbering === 'function') html = keepChosenNumbering(html);

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
    html = html.replace(/((?:^|<li>|<p(?: class="[^"]*")?>|<br\s*\/?>)\s*(?:[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]\s*)?<strong>[^<]+?)[:：]\s*<\/strong>/gmu, '$1</strong>');

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

    return html.replace(/\u0000PRE(\d+)\u0000/g, (whole, i) => pres[i] ?? whole);
}

// ── 교안 마크다운 → 최종 HTML 단일 렌더 파이프라인 ──────────────────────────
// 편집기·보기 토글·이력 보기·PDF/이력 내보내기가 '동일한' 변환을 거치도록 통합한다.
// 순서: 이전 버전 강사 callout 제거 → marked → 한국어 마침표 줄바꿈 → postprocess(공통 HTML 후처리)
// 기존에는 편집기만 postprocessHtml을 적용하고 PDF/이력 경로는 누락되어
// 같은 교안이 화면과 내보내기에서 다르게 렌더되는 불일치가 있었다.
// opts.postprocess: 기본 true. (이미지 치환은 호출 측에서 미리 수행)
function renderLessonHTML(md, opts) {
    const postprocess = !opts || opts.postprocess !== false;
    const safe = stripInstructorCallouts((md == null) ? '' : String(md));
    let html = (typeof marked !== 'undefined')
        ? marked.parse(safe)
        : `<pre class="text-gray-200 whitespace-pre-wrap">${safe.replace(/</g, '&lt;')}</pre>`;
    if (typeof applyPeriodLineBreakHTML === 'function') html = applyPeriodLineBreakHTML(html);
    // 항목에 딸린 '용어: 설명'은 왼쪽 막대로. 후처리가 라벨 끝 콜론을 지우기 전에 찾는다
    if (typeof markTermParagraphs === 'function') html = markTermParagraphs(html);
    if (postprocess && typeof postprocessHtml === 'function') html = postprocessHtml(html);
    return sanitizeLessonHtml(html); // 후처리가 글자를 지워 태그가 이어 붙을 수 있으므로 맨 끝에서 거른다
}
if (typeof window !== 'undefined') window.renderLessonHTML = renderLessonHTML;

// ── 차시 화면 그리기: 그림 데이터는 글 처리에서 뺀다 ─────────────────────────
// 차시 화면(renderEditor·toggleEditorMode)의 HTML은 renderLessonHTML(preprocessMarkdown(inlineLessonImages(md, images)))와 한 글자도 다르지 않다.
// 큰 그림(base64 data URL)을 글에 그대로 넣으면 전처리·marked·마침표 줄바꿈·후처리·정리가 그림 수십 MB를 몇 번씩 훑어 탭 하나에 몇 초가 걸린다.
// 그래서 큰 그림은 그림 머리(data:image/jpeg;base64,) 뒤를 이번 그리기에만 쓰는 무작위 표시(영문·숫자)로 바꿔 그리고, 맨 끝에 표시를 그림 데이터로 되돌린다.
//  - 표시도 그림 데이터처럼 머리 뒤가 영문·숫자뿐이라 모든 처리 규칙이 그림 데이터와 똑같이 다룬다. 길이를 세는 규칙({1,40} 등)에도 둘 다 걸리지 않게 표시를 256자로 둔다
//  - 앞뒤가 ( ) 또는 " " 인 자리(마크다운 그림 주소, src="…", <!-- [IMG: "…"] -->)에만 쓰인 그림 키의 큰 base64 그림만 바꾼다. 다른 그림은 예전처럼 데이터를 넣는다
//  - 표시는 그대로(src 등) 또는 encodeURIComponent 모양(마크다운 그림의 data-imgid·삭제 버튼)으로만 나와야 한다.
//    다른 모양으로 남은 표시가 하나라도 있으면 그 결과를 버리고 예전 방법으로 다시 그린다(표시가 화면에 남지 않는다)
//  - 표시의 무작위 글자가 교안 글에 이미 있으면 바꾸지 않는다(교안 글로 표시를 흉내 낼 수 없다)
// 그린 결과(표시가 든 HTML)는 넣은 글·그림·그리는 함수가 꼭 같을 때만 다시 쓴다(lessonScreenCache). 글을 고치거나 그림이 바뀌면 키가 달라져 새로 그린다
//  - 그리는 함수: 그리기가 부르는 함수 선언을 모두 키에 넣는다(lessonScreenInput). 테스트나 기능이 바꿔 끼우면 새로 그린다. const 값은 바뀌지 않는다.
//    marked 렌더러·설정은 이 파일을 불러올 때 한 번 정한다(아래 marked.use). 렌더러나 설정을 바꾸는 코드는 그 자리에서 forgetLessonScreens()를 부른다
//  - 지운 그림을 붙잡지 않는다: 같은 글을 다른 그림으로 그리면 예전 결과를 빼고, 그림을 지우면(deleteImage·dropUnusedLessonImages) 그 그림을 쓴 결과를,
//    상태를 바꾸거나(closeLessonEditor: 저장 파일·폴더 불러오기, 되살리기, 초기화, 지금 교과 지우기) 휴지통에서 영구 삭제하면 모두 잊는다
//  - 원문 칸 미리 보기(md-toolbar.js)는 입력할 때마다 글이 바뀌므로 마지막 결과 하나만 따로 둔다(lessonPreviewScreen). 탭 화면 기억을 밀어내지 않는다
const LESSON_SCREEN_PICTURE_MIN = 4096; // 이보다 짧은 그림은 글에 그대로 넣는다(바꿔도 빨라지지 않는다)
const LESSON_SCREEN_MARK_LENGTH = 256; // 표시 길이(그림 머리 포함)
const LESSON_SCREEN_REF = /local:([\w-]{1,80})(?![\w-])/g; // inlineLessonImages(lesson-export.js)와 같은 그림 키 모양
const LESSON_SCREEN_HEAD = /^data:image\/[A-Za-z0-9.+-]+(?:;[\w.+-]+=[\w.+-]+)*;base64,$/; // 바꿀 그림의 머리
const LESSON_SCREEN_BASE64 = /^[A-Za-z0-9+/=]*$/; // 머리 뒤가 이 글자뿐인 그림만 바꾼다
const LESSON_SCREEN_CACHE_SIZE = 8; // 기억해 둘 그린 결과 수(탭 몇 개를 오가도 다시 그리지 않게)
const LESSON_SCREEN_CACHE_CHARS = 4000000; // 이보다 긴 결과는 기억하지 않는다(그림 데이터가 그대로 든 결과)
let lessonScreenCache = []; // 최근에 쓴 것이 앞. { input, html, marks }
let lessonPreviewScreen = null; // 원문 칸 미리 보기가 마지막으로 그린 결과(같은 모양)

// 이번 그리기에만 쓰는 무작위 글자(영문 소문자·숫자 24자)
function lessonScreenNonce() {
    const bytes = new Uint8Array(24);
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, byte => 'abcdefghijklmnopqrstuvwxyz0123456789'[byte % 36]).join('');
}

// 그린 결과를 가르는 것: 넣은 글, 글에 쓰인 그림 키와 그 그림 값, 그리는 함수들(바꿔 끼운 함수도 가른다)
function lessonScreenInput(md, images) {
    const text = String(md || '');
    const picture = typeof EXPORT_PICTURE_RE !== 'undefined' ? EXPORT_PICTURE_RE : /^data:image\//;
    const pictures = new Map(Object.entries(images || {}).filter(([, data]) => typeof data === 'string' && picture.test(data)));
    const refs = new Map();
    const loose = new Set(); // ( ) · " " 밖에서도 쓰인 그림 키
    for (const match of text.matchAll(LESSON_SCREEN_REF)) {
        const key = match[1];
        if (!refs.has(key)) refs.set(key, pictures.get(key));
        const before = text[match.index - 1];
        const after = text[match.index + match[0].length];
        if (!((before === '(' || before === '"') && (after === ')' || after === '"'))) loose.add(key);
    }
    // 그리기가 부르는 함수 선언: 그림 넣기·코드 블록 떼어 두기(data.js)·전처리·렌더, marked와 그 렌더러가 부르는 함수(코드 블록·이름표·mermaid 정리·그림 삭제 버튼·escapeHtml),
    // 마침표 줄바꿈·용어 문단·후처리·번호 목록, 정리(lesson-sanitize.js)와 그 안의 주소 검사
    const pipeline = [
        typeof inlineLessonImages === 'function' ? inlineLessonImages : null,
        typeof stashCodeFences === 'function' ? stashCodeFences : null,
        typeof fenceStateAfter === 'function' ? fenceStateAfter : null,
        typeof preprocessMarkdown === 'function' ? preprocessMarkdown : null,
        renderLessonHTML,
        typeof stripInstructorCallouts === 'function' ? stripInstructorCallouts : null,
        typeof marked !== 'undefined' ? marked.parse : null,
        sanitizeMermaidCode,
        lessonCodeBlockHtml,
        codeBlockLabel,
        mdImageDeleteButton,
        typeof escapeHtml === 'function' ? escapeHtml : null,
        typeof applyPeriodLineBreakHTML === 'function' ? applyPeriodLineBreakHTML : null,
        typeof markTermParagraphs === 'function' ? markTermParagraphs : null,
        typeof postprocessHtml === 'function' ? postprocessHtml : null,
        typeof keepChosenNumbering === 'function' ? keepChosenNumbering : null,
        typeof sanitizeLessonHtml === 'function' ? sanitizeLessonHtml : null,
        typeof cleanLessonElement === 'function' ? cleanLessonElement : null,
        typeof legacyRegenerateArgs === 'function' ? legacyRegenerateArgs : null,
        typeof isSafeLessonUrl === 'function' ? isSafeLessonUrl : null,
        typeof DOMParser !== 'undefined' ? DOMParser : null
    ];
    return { text, refs: [...refs], loose, pipeline };
}

// 같은 글·그림·함수로 그린 결과인가(그림 값은 같은 글자열이어야 한다)
function sameLessonScreenInput(a, b) {
    return !!a && !!b && a.text === b.text
        && a.pipeline.length === b.pipeline.length && a.pipeline.every((fn, i) => fn === b.pipeline[i])
        && a.refs.length === b.refs.length && a.refs.every(([key, value], i) => b.refs[i][0] === key && b.refs[i][1] === value);
}

// 바꿀 그림과 표시. 바꿀 그림이 없거나 무작위 글자(조각 하나라도)가 글에 있으면 null
function lessonScreenMarks(input, images) {
    const nonce = lessonScreenNonce();
    const parts = [nonce.slice(0, 8), nonce.slice(8, 16), nonce.slice(16)]; // 표시가 쪼개져 남았는지 볼 조각
    if (parts.some(part => input.text.includes(part))) return null;
    // 기억해 둔 결과에서 이미 살펴본 그림(같은 글자열)은 base64인지 다시 훑지 않는다(그림 하나에 1ms쯤 걸린다)
    const checked = new Set([...lessonScreenCache, lessonPreviewScreen].filter(Boolean).flatMap(entry => (entry.marks ? entry.marks.list.map(mark => mark.data) : [])));
    const list = [];
    const tokens = new Map(); // 그림 키 → 그림 머리 + 표시
    input.refs.forEach(([key, data]) => {
        if (input.loose.has(key) || typeof data !== 'string' || data.length < LESSON_SCREEN_PICTURE_MIN) return;
        const comma = data.indexOf(',');
        const head = data.slice(0, comma + 1);
        const body = data.slice(comma + 1);
        if (comma < 0 || !LESSON_SCREEN_HEAD.test(head) || !(checked.has(data) || LESSON_SCREEN_BASE64.test(body))) return;
        const core = `Lv${nonce}k${list.length}z`;
        const marker = core + 'A'.repeat(Math.max(0, LESSON_SCREEN_MARK_LENGTH - head.length - core.length - 1)) + 'Q';
        list.push({ marker, head, encodedHead: encodeURIComponent(head), body, data });
        tokens.set(key, head + marker);
    });
    if (!list.length) return null;
    // 그림 목록은 그대로 두고 바꾼 그림만 표시로 바꾼 새 목록(inlineLessonImages가 같은 규칙으로 넣는다)
    const swapped = Object.fromEntries(Object.entries(images || {}).map(([key, data]) => [key, tokens.has(key) ? tokens.get(key) : data]));
    return { nonce, parts, list, images: swapped };
}

// html 안에 part가 몇 번 있는가
function countLessonScreenPart(html, part) {
    let count = 0;
    for (let at = html.indexOf(part); at !== -1; at = html.indexOf(part, at + part.length)) count += 1;
    return count;
}

// 표시를 그림 데이터로 되돌린다. 표시가 그대로(그림 머리 뒤) 또는 encodeURIComponent 모양(바꾼 머리 뒤)이 아닌 자리에 있거나,
// 무작위 글자의 조각이 표시 밖에도 있으면(처리 규칙이 표시를 쪼갰다) null
function restoreLessonScreenMarks(html, marks) {
    const pieces = [];
    const encoded = new Map();
    let found = 0;
    let from = 0;
    let at = html.indexOf(marks.nonce);
    while (at !== -1) {
        const start = at - 2;
        const index = /^k(\d+)z/.exec(html.slice(at + marks.nonce.length, at + marks.nonce.length + 12));
        const mark = index && marks.list[Number(index[1])];
        if (!mark || start < from || !html.startsWith(mark.marker, start)) return null;
        let body;
        if (start - mark.head.length >= from && html.startsWith(mark.head, start - mark.head.length)) body = mark.body;
        else if (start - mark.encodedHead.length >= from && html.startsWith(mark.encodedHead, start - mark.encodedHead.length)) {
            if (!encoded.has(mark)) encoded.set(mark, encodeURIComponent(mark.body));
            body = encoded.get(mark);
        } else return null;
        found += 1;
        pieces.push(html.slice(from, start), body);
        from = start + mark.marker.length;
        at = html.indexOf(marks.nonce, from);
    }
    if (marks.parts.some(part => countLessonScreenPart(html, part) !== found)) return null;
    if (!found) return html;
    pieces.push(html.slice(from));
    return pieces.join('');
}

// 기억에 둔다. preview면 미리 보기 자리에(하나만), 아니면 탭 화면 기억의 맨 앞에 둔다(정한 수까지).
// 같은 글로 그린 예전 결과는 뺀다(그 글의 그림을 바꿨으면 예전 그림을 붙잡지 않게)
function keepLessonScreen(entry, preview) {
    if (preview) {
        lessonPreviewScreen = entry;
        return;
    }
    lessonScreenCache = [entry, ...lessonScreenCache.filter(item => item !== entry && item.input.text !== entry.input.text)].slice(0, LESSON_SCREEN_CACHE_SIZE);
}

// 그린 결과를 기억한다. 표시로 바꾼 그림 목록(marks.images)은 두지 않는다(글에 쓰지 않은 그림까지 붙잡지 않게).
// 너무 긴 결과는 기억하지 않고, 같은 글로 그린 예전 결과만 뺀다
function rememberLessonScreen(input, html, marks, preview = false) {
    if (html.length <= LESSON_SCREEN_CACHE_CHARS) {
        keepLessonScreen({ input, html, marks: marks && { nonce: marks.nonce, parts: marks.parts, list: marks.list } }, preview);
    } else if (preview) {
        lessonPreviewScreen = null;
    } else {
        lessonScreenCache = lessonScreenCache.filter(item => item.input.text !== input.text);
    }
}

// 기억한 결과를 잊는다. pictures(그림 값 목록)를 주면 그 그림을 쓴 결과만 잊는다(지운 그림을 기억이 붙잡지 않게)
function forgetLessonScreens(pictures) {
    if (pictures === undefined) {
        lessonScreenCache = [];
        lessonPreviewScreen = null;
        return;
    }
    const gone = [...pictures].filter(value => typeof value === 'string');
    const keeps = entry => !entry.input.refs.some(([, value]) => gone.includes(value));
    lessonScreenCache = lessonScreenCache.filter(keeps);
    if (lessonPreviewScreen && !keeps(lessonPreviewScreen)) lessonPreviewScreen = null;
}

// 기억해 둔 결과나 표시로 그린 화면 HTML. 표시를 쓸 수 없으면(바꿀 그림이 없거나 표시가 다른 모양으로 남았다) null.
// 미리 보기도 탭 화면 기억에서 찾고, 탭 화면도 미리 보기 자리에서 찾는다(고친 글로 보기에 돌아오면 미리 보기가 그린 결과를 쓴다)
function drawMarkedLessonScreen(input, md, images, preview) {
    const cached = lessonScreenCache.find(entry => sameLessonScreenInput(entry.input, input))
        || (lessonPreviewScreen && sameLessonScreenInput(lessonPreviewScreen.input, input) ? lessonPreviewScreen : null);
    const restored = cached && (cached.marks ? restoreLessonScreenMarks(cached.html, cached.marks) : cached.html);
    if (typeof restored === 'string') {
        if (!preview) keepLessonScreen(cached, false); // 탭 화면이 쓴 결과는 맨 앞으로(미리 보기 자리에서 찾았으면 탭 화면 기억에도 둔다)
        return restored;
    }
    const marks = lessonScreenMarks(input, images);
    if (!marks) return null;
    const html = renderLessonHTML(preprocessMarkdown(inlineLessonImages(md, marks.images)));
    const done = restoreLessonScreenMarks(html, marks);
    if (done === null) {
        console.warn('[차시 화면] 그림 표시가 다른 모양으로 남아 그림을 넣은 글로 다시 그립니다.');
        return null;
    }
    rememberLessonScreen(input, html, marks, preview);
    return done;
}

// input(lessonScreenInput)으로 그린 차시 화면 HTML. renderLessonHTML(preprocessMarkdown(inlineLessonImages(md, images)))와 같은 글을 돌려주고, 그 식이 던질 때 같은 오류를 던진다.
// preview: 원문 칸 미리 보기(결과를 미리 보기 자리에 둔다)
function drawLessonScreen(input, md, images, preview = false) {
    try {
        const html = drawMarkedLessonScreen(input, md, images, preview);
        if (html !== null) return html;
    } catch (err) {
        console.warn('[차시 화면] 그림을 뺀 글로 그리지 못해 그림을 넣은 글로 다시 그립니다:', err?.message || err);
    }
    const html = renderLessonHTML(preprocessMarkdown(inlineLessonImages(md, images)));
    rememberLessonScreen(input, html, null, preview);
    return html;
}

function renderLessonScreen(md, images, { preview = false } = {}) {
    return drawLessonScreen(lessonScreenInput(md, images), md, images, preview);
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

const IMAGE_CALL_ATTEMPTS = 2; // 그림 쪽 호출(그림 모델·그림 검색어·판정·SVG 삽화)은 한 번만 다시 보낸다. 모델을 차례로 바꿔 보므로 기다림을 겹치지 않는다

// 중지로 끊은 AI 호출. 받는 쪽은 err.name === 'AbortError'로 알아본다(fetch가 끊길 때 내는 오류와 같은 이름)
function abortError() {
    const err = new Error('중지했습니다.');
    err.name = 'AbortError';
    return err;
}

// ms만큼 기다린다. signal로 중지하면 바로 AbortError로 끝난다
function waitMs(ms, signal = null) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const timer = setTimeout(() => {
            signal?.removeEventListener?.('abort', onAbort);
            resolve();
        }, ms);
        function onAbort() {
            clearTimeout(timer);
            reject(abortError());
        }
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

// AI 호출을 보내고, 잠깐의 오류(서버 바쁨·분당 한도)는 기다렸다 다시 보낸다
// opts.attempts: 보내는 최대 횟수 / opts.onRetry: 다시 보내기 전에 알린다({ attempt, total, delayMs, isRateLimit })
// opts.signal: 중지하면 보낸 호출도 끊는다 / opts.waitSignal: 중지하면 다시 보내려고 기다리는 것만 멈춘다(보낸 호출은 끝까지 받는다)
async function fetchWithRetry(url, options, { attempts = 5, onRetry = null, signal = null, waitSignal = signal } = {}) {
    // 503 과부하 에러 등 일반 지연 대비 기본 백오프 (1.5s, 3s, 6s, 10s, 15s)
    const baseDelays = [1500, 3000, 6000, 10000, 15000];
    // 429(호출 한도/쿼터 초과)는 분당 쿼터 리셋에 최대 ~60초가 필요하므로 더 길게 대기
    const rateLimitDelays = [5000, 10000, 20000, 30000, 45000];

    const provider = aiProviderOf(url);
    for (let i = 0; i < attempts; i++) {
        try {
            let res;
            try {
                res = await fetch(url, signal ? { ...options, signal } : options);
            } catch (netErr) {
                if (netErr?.name === 'AbortError') throw abortError(); // 중지로 끊었다. 인터넷 문제가 아니다
                throw aiError(0, netErr.message, provider); // 인터넷 끊김·차단
            }
            if (!res.ok) {
                // 화면에는 한국어 한 줄과 다음에 할 일을, 원문은 err.detail에 둔다(ai-errors.js)
                const bodyText = await res.text().catch(() => '');
                const err = aiError(res.status, bodyText, provider);
                // 429 호출 한도: 응답 본문에 서버 권장 재시도 시간(retryDelay)이 있으면 추출해 존중
                const m = res.status === 429 && bodyText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
                if (m) err.suggestedDelayMs = Math.ceil(parseFloat(m[1]) * 1000);
                throw err;
            }
            return await res.json();
        } catch (e) {
            if (e?.name === 'AbortError') throw abortError(); // 중지: 다시 보내지 않는다(브라우저 영어 문구는 앱 문구로 바꾼다)
            // 마지막 시도까지 실패하거나, 다시 보내도 같은 오류(키·모델 문제 400/401/403/404, 한도 0·하루 한도)면 바로 멈춘다
            if (i === attempts - 1 || e.noRetry) {
                console.error(`[AI 호출] 실패 (${e.status ?? '?'}):`, e.detail || e.message);
                throw e;
            }

            const isRateLimit = e.status === 429;
            let delay = isRateLimit ? rateLimitDelays[i] : baseDelays[i];
            // 서버가 명시한 권장 재시도 시간이 더 길면 그 값을 따름 (상한 65초)
            if (e.suggestedDelayMs && e.suggestedDelayMs > delay) {
                delay = Math.min(e.suggestedDelayMs, 65000);
            }

            console.warn(`[fetchWithRetry] ${isRateLimit ? 'API 호출 한도(429)' : 'API 오류 또는 지연'} 발생. ${Math.round(delay / 1000)}초 후 재시도합니다... (${i + 1}/${attempts - 1}) | 사유: ${e.status ?? ''} ${e.detail || e.message}`);
            // 호출자에게 재시도 상황 통지 (로딩 문구 갱신 등) — 선택적
            if (typeof onRetry === 'function') {
                try { onRetry({ attempt: i + 1, total: attempts - 1, delayMs: delay, isRateLimit }); } catch (_) { /* 통지 실패는 무시 */ }
            }
            await waitMs(delay, waitSignal); // 중지하면 기다리지 않고 AbortError로 끝난다
        }
    }
}

// REASONING_EFFORT → Gemini thinkingLevel 변환 (Gemini는 HIGH가 상한)
const GEMINI_THINKING_LEVELS = { max: 'HIGH', xhigh: 'HIGH', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };

// thinkingConfig를 지원하지 않는 이미지 모델에 보내면 오류이므로 텍스트 모델에만 적용
function withGeminiThinking(modelName, { taskRole, ...payload }) {
    if (!TEXT_MODEL_OPTIONS.some(o => o.value === modelName)) return payload;
    const thinkingConfig = { thinkingLevel: GEMINI_THINKING_LEVELS[taskEffort(taskRole)] };
    return { ...payload, generationConfig: { ...payload.generationConfig, thinkingConfig } };
}

// Gemini API 호출 (키가 URL·로그에 남지 않도록 헤더로 전달). opts는 fetchWithRetry로 넘긴다
async function requestGemini(modelName, payload, { onRetry = null, signal = null, waitSignal = null, attempts = 5 } = {}) {
    if (!apiKey) {
        throw new Error('Gemini API 키가 없습니다. 오른쪽 위 ⚙ 설정에서 키를 넣어 주세요(무료 키는 aistudio.google.com에서 받습니다).');
    }
    return fetchWithRetry(
        `${GEMINI_API_BASE}/${modelName}:generateContent`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(withGeminiThinking(modelName, payload))
        },
        { attempts, onRetry, signal, waitSignal: waitSignal || signal }
    );
}

// 텍스트·이미지 공통 호출 진입점. 호출부는 Gemini payload 형식을 유지하고,
// claude- 모델이면 어댑터(claude.js)가 요청과 응답을 변환한다.
// onRetry: 재시도 발생 시 호출되는 선택적 콜백 ({ attempt, total, delayMs, isRateLimit })
// 텍스트 모델 호출은 역할별 AI 분배를 따른다. 교차 판단처럼 모델을 일부러 고른 호출은 pinModel을 넘긴다
// payload와 같은 자리에 받는 호출 설정(요청에는 싣지 않는다): signal(중지하면 보낸 호출도 끊는다),
// waitSignal(중지하면 다시 보내려고 기다리는 것만 멈춘다), attempts(보내는 최대 횟수, 기본 5), timing('short'면 짧은 호출로 따로 잰다)
// Claude는 waitSignal을 받지 않는다: 다시 보내기를 SDK가 안에서 하므로 그 기다림만 따로 끊을 수 없다(signal을 주면 호출째 끊는다)
function callGemini(modelName, { pinModel, signal = null, waitSignal = null, attempts, timing = '', ...payload }, onRetry = null) {
    const model = modelName === TEXT_MODEL && !pinModel ? roleModel(payload.taskRole) : modelName;
    if (signal?.aborted || waitSignal?.aborted) return Promise.reject(abortError());
    const started = Date.now();
    _aiCallsWaiting += 1;
    let call;
    try {
        call = isClaudeModel(model)
            ? callClaude(model, payload, { signal, attempts })
            : requestGemini(model, payload, { onRetry, signal, waitSignal, attempts });
    } catch (err) {
        _aiCallsWaiting -= 1;
        throw err;
    }
    // 성공한 호출에 걸린 시간을 모델별로(짧은 호출은 따로) 모아 일괄 작업 예고 시간에 쓴다(cost-estimate.js)
    return Promise.resolve(call).then(result => {
        window.recordAiTiming?.(model, Date.now() - started, timing);
        return result;
    }).finally(() => { _aiCallsWaiting -= 1; });
}

// 보낸 뒤 답을 기다리는 AI 호출 수. 창을 닫아도 이어지는 작업(삽화·문제은행 창을 닫은 뒤의 그림, 참고 자료 판독, 그림 다시 찾기, 블록 다시 설계 등)도
// 이 호출로 센다(course-flow.js isAiWorkRunning: 창을 닫기 전에 묻고, 휴지통 되살리기·작업 기록 되돌리기·불러오기를 막는다)
let _aiCallsWaiting = 0;
window.aiCallsWaiting = () => _aiCallsWaiting > 0;



// ------------------------------------------------------------------------
// Mermaid 코드 sanitize — AI가 노드 라벨에 괄호/따옴표를 넣어 파서가 실패하는 문제 방지
// 예시 에러: Parse error on line 5: E[문서화 (GDD, 기획서 등)]
//   → Mermaid는 [...] 안에 ( ) 를 허용하지 않음
// 전략: 노드 라벨(브래킷 내부) 안의 ( ), 따옴표, 중첩 [] 제거 · 치환
// ------------------------------------------------------------------------
function sanitizeMermaidCode(code) {
    if (!code || typeof code !== 'string') return code || '';
    let out = String(code);

    // 0) [최우선] HTML 태그·HTML 엔티티 완전 제거
    //    AI가 ```mermaid 펜스 안에 <pre>/<code>/<div>/<br>/&lt;/등을 흘려 넣는 경우
    //    Mermaid 파서는 '<' 를 TAGSTART 토큰으로 인식하여 'Parse error: got TAGSTART' 발생
    //    예시 에러: ...J;P --> Q;    </pre></div>
    out = out
        // HTML 엔티티를 본래 문자로 복원 (lt/gt만은 빼기 — Mermaid가 < 를 못 처리)
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
        // 모든 HTML 태그 제거 (<br>, </pre>, </div>, <code>, <span>, <p> 등)
        .replace(/<\/?[a-zA-Z][^>]*>/g, '')
        // 남은 < > 도 제거 (Mermaid 파서 호환)
        .replace(/&lt;|&gt;/g, '')
        // 다중 공백·빈줄 정리
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n');

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

    // 4) subgraph 제목 정제 — Mermaid는 subgraph 제목에 괄호 ( ) 를 허용하지 않음.
    //    예시 에러: Parse error on line 10: subgraph 게임 코어 루프 (Core Loop) ... got 'PS'
    //    "subgraph 게임 코어 루프 (Core Loop)" → 'subgraph "게임 코어 루프 - Core Loop"'
    //    괄호가 없는 제목은 그대로 두어 기존 subgraph id 참조를 보존한다.
    out = out.replace(/^([ \t]*subgraph[ \t]+)(.+?)[ \t]*$/gim, (m, prefix, title) => {
        if (!/[()]/.test(title)) return m;                       // 괄호 없으면 변경하지 않음
        const t = title
            .replace(/^["']|["']$/g, '')                         // 양끝 따옴표 제거
            .replace(/\s*\(\s*([^()]*?)\s*\)\s*/g, ' - $1')      // (X) → - X
            .replace(/["'\[\]{}()]/g, '')                        // 남은 특수문자 제거
            .replace(/\s+/g, ' ')
            .trim();
        return prefix + '"' + t + '"';
    });

    return out;
}
window.sanitizeMermaidCode = sanitizeMermaidCode;

// ------------------------------------------------------------------------
// 교안 코드 블록: 언어 이름표와 복사 버튼(lesson-sanitize.js copyLessonCode)
// ------------------------------------------------------------------------
const CODE_BLOCK_LANG = /^[A-Za-z0-9#+._-]{1,24}$/; // 이 모양이 아닌 언어 표기는 class와 이름표에 쓰지 않는다
const CODE_BLOCK_OUTPUT_LANGS = ['text', 'txt', 'plaintext', 'output', 'console'];
const codeBlockEscape = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 이름표: 문제은행과 같은 언어 이름(course-qbank.js), 실행 결과, Markdown, 표기가 없으면 '코드', 그 밖에는 적힌 그대로
function codeBlockLabel(lang) {
    const key = String(lang || '').toLowerCase();
    const names = typeof QBANK_LANG_NAMES === 'object' && QBANK_LANG_NAMES ? QBANK_LANG_NAMES : {};
    if (Object.prototype.hasOwnProperty.call(names, key)) return names[key];
    if (CODE_BLOCK_OUTPUT_LANGS.includes(key)) return '실행 결과';
    if (key === 'md' || key === 'markdown') return 'Markdown';
    return lang || '코드';
}

// 이름표는 CSS(::before)로 보이고 버튼에는 글자가 없어, 블록의 글자가 코드와 같다(두 번 눌러 고치기·복사가 코드 글자로 찾는다)
function lessonCodeBlockHtml(code, info) {
    const word = (String(info || '').match(/\S*/) || [''])[0];
    const lang = CODE_BLOCK_LANG.test(word) ? word : '';
    const langClass = lang ? ` class="language-${codeBlockEscape(lang)}"` : '';
    return `<div class="lesson-code" data-lang="${codeBlockEscape(codeBlockLabel(lang))}">` +
        '<button type="button" class="lesson-code-copy" data-lesson-action="copy-code" title="코드 복사" aria-label="코드 복사"><i class="ph-bold ph-copy" aria-hidden="true"></i></button>' +
        `<pre><code${langClass}>${codeBlockEscape(code)}</code></pre></div>\n`;
}

// ------------------------------------------------------------------------
// Marked.js 커스텀 렌더러 설정 (이미지 호버 재생성 UI 주입)
// ------------------------------------------------------------------------
if (typeof marked !== 'undefined') {
    const renderer = {
        code(codeArg, infostringArg) {
            // marked 최신 v8.0.0+ 에서는 첫 번째 인자에 token 객체가 넘어옵니다.
            const codeText = typeof codeArg === 'object' ? codeArg.text : codeArg;
            const infostring = typeof codeArg === 'object' ? codeArg.lang : infostringArg;

            if (infostring === 'mermaid') {
                return `<div class="mermaid">\n${sanitizeMermaidCode(codeText)}\n</div>`;
            }
            // mermaid가 아닌 코드 블록은 언어 이름표와 복사 버튼을 붙인다
            return lessonCodeBlockHtml(codeText, infostring);
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
                    ${mdImageDeleteButton(href, imgIdToPass)}
                </div>
            `;
        }
    };
    // 렌더러·설정은 여기서 한 번만 정한다. 나중에 바꾸는 코드는 그 자리에서 forgetLessonScreens()를 불러 차시 화면 기억을 비운다(그린 결과가 바뀐다)
    marked.use({ renderer });
}

// 마크다운 그림의 삭제 버튼(오른쪽 위). 빈 주소(찾지 못한 그림 자리 ![]())에는 달지 않는다. 어느 그림인지 알 수 없어 엉뚱한 그림을 지운다
function mdImageDeleteButton(href, imgId) {
    if (!href) return '';
    return `<div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                        <button data-lesson-action="delete-image" data-img-id="${escapeHtml(imgId)}" class="px-3 py-1.5 bg-red-500/80 hover:bg-red-600 text-white text-xs font-bold rounded-lg shadow-lg flex items-center gap-1 backdrop-blur-sm">
                            <i class="ph-bold ph-trash"></i> 삭제
                        </button>
                    </div>`;
}

// ------------------------------------------------------------------------
// AI Logic & Other Editor Functions
// ------------------------------------------------------------------------







// [Step 3] TTS 재생 로직 제거됨 (사용자 요청)



async function handleGenerate() {

    const topic = document.getElementById('topic-input').value.trim();

    if (!topic) return window.showAlert('교육 주제를 입력해주세요.');

    // 차시가 있으면 확인을 받고, 기존 차시는 휴지통으로 보낸다(덮어써서 잃지 않게).
    // 생성이 도는 동안에는 차시를 휴지통으로 옮기지 않는다(만드는 중인 차시를 옮기면 만들던 결과가 버려진다, course-meta.js trashRestoreBlocked)
    const busy = () => typeof trashRestoreBlocked === 'function' && trashRestoreBlocked();
    const startSubjectId = currentSubjectId;
    const replacedLessons = (courseData || []).filter(mod => mod && mod.id !== 'mainQuest');
    if (replacedLessons.length && busy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    if (replacedLessons.length && !(await confirmAsync(`이 교과의 차시 ${replacedLessons.length}개를 휴지통으로 옮기고 새 목차를 만듭니다.\n휴지통(차시 목록 위)에서 30일 동안 되살릴 수 있습니다.`, { okLabel: '새 목차 만들기', tone: 'primary', title: '차시 목차 다시 만들기' }))) return;
    if (replacedLessons.length && busy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.'); // 확인 창을 띄운 사이 시작된 생성



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



        if (!Array.isArray(parsed)) throw new Error('AI 답을 차시 목차로 읽지 못했습니다. 다시 눌러 주세요.');

        // 기다리는 동안 다른 교과를 열었을 수 있다. 새 목차는 시작한 교과에만 쓴다
        const startSubject = startSubjectId ? globalState.subjects.find(s => s.id === startSubjectId) : null;
        if (startSubjectId && !startSubject) throw new Error('목차를 만드는 동안 그 교과가 지워졌습니다.');
        const onStart = !startSubject || currentSubjectId === startSubjectId;
        // 반영하는 지금의 차시를 휴지통으로 보낸다(기다리는 동안 더하거나 고친 차시도 잃지 않게). 그사이 시작된 생성이 있으면 바꾸지 않는다
        // (이 작업의 로딩 표시는 먼저 내리고 본다. 그 표시도 AI 작업으로 센다)
        const replacingNow = ((onStart ? courseData : startSubject.lessons) || []).filter(mod => mod && mod.id !== 'mainQuest');
        document.getElementById('sidebar-loading').style.display = 'none';
        if (replacingNow.length && busy()) throw new Error('목차를 만드는 동안 다른 생성이 시작되어 반영하지 않았습니다. 그 생성이 끝난 뒤 다시 눌러 주세요.');
        if (replacingNow.length && onStart) window.saveRawContent?.(); // 고치던 원문을 먼저 그 차시에 넣고 휴지통으로 보낸다
        if (replacingNow.length) moveLessonsToTrash(replacingNow, startSubjectId);

        const newLessons = parsed.map((item, idx) => ({

            id: Date.now() + idx,

            title: item.title,

            description: item.description,

            hours: item.hours || 2,

            status: 'waiting',

            content: null,

            images: {},

            tabContents: { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null, advAssessment: null },

            uploadedMdName: null,

            uploadedMdContent: null

        }));

        if (onStart) {
            courseData = newLessons;
            currentTopic = topic;
            // 휴지통으로 옮긴 차시의 편집기·원문 칸이 남지 않게 닫는다(남은 칸에 쓴 글은 넣을 차시가 없어 사라진다)
            if (typeof closeLessonEditor === 'function') closeLessonEditor();
            renderSidebar();
        } else {
            startSubject.lessons = newLessons;
            window.showToast?.(`'${startSubject.title}' 교과에 새 차시 목차를 만들었습니다.`, 'success');
        }

        saveState();

    } catch (err) {

        console.error(err);

        window.showAlert(`목차를 만들지 못했습니다.\n${err.message || '잠시 뒤 다시 해 주세요.'}`);

    } finally {

        document.getElementById('sidebar-loading').style.display = 'none';

        document.getElementById('generate-btn').disabled = false;

    }

}



async function generateModuleContent(moduleId, keyConcepts) {
    const mod = getEditingModule(moduleId);

    if (!mod) return;

    // F1-2: 핵심개념 저장 (재생성 시 기본값으로 재활용)
    if (Array.isArray(keyConcepts) && keyConcepts.length > 0) {
        mod.keyConcepts = keyConcepts;
    }

    // 탭을 비우기 전에 고정 섹션을 챙겨 재생성 뒤 되돌린다
    const lockedByTab = Object.fromEntries(LESSON_TABS.map(tab => [tab.id, lockedSectionBlocks(mod, tab.id)]));
    const lockedBlocks = lockedByTab.basicLearn;
    // 시작한 교과와 기본 학습 분량 채우기(lesson-volume.js)에 붙일 참고 자료는 기다리기 전에 잡아 둔다
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    const volumeSnap = moduleId !== 'mainQuest' && typeof ensureSpokenVolume === 'function' ? volumeSnapshot(mod) : null;
    const targetMinutes = learnTargetMinutes(mod, 'basicLearn'); // 기본 학습의 낭독 목표(분, 늘 480분)

    // [재생성 중복 방지] 재생성인 경우 기존 tabContents·images 초기화
    // 이전엔 status==='done'이면 tabContents가 남아있어 5탭 자동생성이 스킵되고
    // mod.content와 tabContents가 어긋나 같은 내용이 2회 이상 보이는 문제 발생.
    if (mod.status === 'done' || (mod.tabContents && Object.values(mod.tabContents).some(v => v))) {
        await archiveContents([mod], '다시 생성 전'); // 중단하거나 실패해도 히스토리에서 이전 교안(모든 탭)으로 되돌릴 수 있게 한다
        mod.tabContents = { basicLearn: null, basicPrac: null, advLearn: null, advPrac: null, assessment: null, advAssessment: null };
        mod.content = '';
        // 다시 만들면 옛 본문 그림은 비운다(새 본문에 맞는 그림으로 갱신). 교수안·편성안에 붙여 넣은 그림, 삽화·판서 영상이 쓰는 그림,
        // 다시 만든 탭에 그대로 돌려 넣을 고정 섹션의 그림은 남긴다(tabs.js dropUnusedLessonImages)
        if (!mod.images || typeof mod.images !== 'object') mod.images = {};
        dropUnusedLessonImages(mod, Object.values(lockedByTab).flat().map(block => block.text));
    }


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



    // 화면을 막지 않고 진행 막대로 보여 준다. 끝난 항목을 읽으면서 기다릴 수 있다
    window.beginLessonPipeline(moduleId);
    const setLoadingStatus = window.setPipelineStatus;
    setLoadingStatus('교안을 작성하고 있습니다...');
    let reported = false; // 결과를 이미 알렸으면 파이프라인 종료 때 또 알리지 않는다



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
        renderEditor(mod);
        const codeTopic = lessonCodeTopic(mod); // 코드를 다루는 차시면 설명마다 예제 코드 블록을 쓰게 한다

        // ── Chunk 1: 최초 생성 ──
        const { systemInstruction, userPrompt } = buildTaskContext('module', {
            title: mod.title,
            description: mod.description,
            keyConcepts: mod.keyConcepts || [],
            hasMainQuest: hasMainQuest,
            mainQuestText: mainQuestText,
            otherLessonsText: otherLessonsText,
            uploadedMdContent: mod.uploadedMdContent,
            codeTopic,
            targetMinutes
        });

        setLoadingStatus('교안 작성 중... (1단계: 초안 생성)');

        const firstData = await callGemini(TEXT_MODEL, {
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                    ],
                    contents: [{ parts: [{ text: userPrompt + lessonDesignBrief(mod, 'basicLearn') + lockedSectionPrompt(lockedBlocks) }] }],
                    systemInstruction: { parts: [{ text: systemInstruction }] },
                    generationConfig: { maxOutputTokens: 65536 }
        });

        // 응답 전체를 감싼 펜스만 벗긴다. 청크 끝의 코드 블록을 닫는 펜스는 코드의 일부다
        fullContent = extractText(firstData, { unwrap: true }).trim();
        chunkCount = 1;

        // ── Chunk 2~N: 이어쓰기 루프 ──
        while (fullContent.includes(CONTINUE_MARKER) && chunkCount < MAX_CHUNKS && !window.isTabGenerationStopped?.()) {
            chunkCount++;
            // CONTINUE 마커 제거. 코드 블록 안에서 끊겼으면 닫아 이어 쓴 글이 코드로 들어가지 않게 한다
            fullContent = closeOpenFence(fullContent.replace(CONTINUE_MARKER, '').trimEnd());

            setLoadingStatus(`교안 이어쓰기 중... (${chunkCount}단계)`);

            // 이전 내용의 마지막 1500자를 컨텍스트로 전달 (토큰 절약)
            const contextTail = fullContent.length > 1500 ? fullContent.slice(-1500) : fullContent;

            const { systemInstruction: contSys, userPrompt: contPrompt } = buildTaskContext('module_continue', {
                title: mod.title,
                description: mod.description,
                keyConcepts: mod.keyConcepts || [],
                hasMainQuest: hasMainQuest,
                chunkIndex: chunkCount,
                previousContent: contextTail,
                codeTopic,
                targetMinutes
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
                        systemInstruction: { parts: [{ text: contSys }] },
                        generationConfig: { maxOutputTokens: 65536 }
            });

            let contText = extractText(contData, { unwrap: true }).trim();

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
        // 잔여 CONTINUE 마커 정리 (MAX_CHUNKS 초과 시). 코드 블록 안에서 끝났으면 닫는다
        fullContent = closeOpenFence(fullContent.replace(new RegExp(CONTINUE_MARKER, 'g'), '').trimEnd());

        // 마크다운 정리 (이미지 처리 전에 적용)
        if (typeof sanitizeMarkdownContent === 'function') {
            fullContent = sanitizeMarkdownContent(fullContent);
        }

        fullContent = cleanLessonOpening(restoreLockedSections(fullContent, lockedBlocks));
        if (typeof checklistLast === 'function') fullContent = checklistLast(fullContent, 'basicLearn');

        // 기본 학습은 모자란 섹션마다 새 소주제를 이어 붙여 낭독 목표 분량까지 채운다. 그림 자리는 초안에만 미리 넣는다(붙인 소주제에는 넣지 않는다)
        const isStopped = () => !!window.isTabGenerationStopped?.();
        const volume = volumeSnap && !isStopped() ? await ensureSpokenVolume({
            ...volumeSnap, md: autoInjectImageTags(fullContent), mod, tabId: 'basicLearn', lockedBlocks, targetMinutes, codeTopic, fromUpload: !!mod.uploadedMdContent,
            isStopped, isLive: () => !subj || lessonStillLive(subj, mod), onStatus: setLoadingStatus, waitSignal: window.aiStopSignal?.() || null
        }) : null;
        // 채우는 동안이나 채운 뒤(고치기·그림)에 차시를 지웠거나 백업·PC 폴더를 불러왔다. 그 차시에 쓰지 않고 채운 글은 작업 기록에 남긴다
        const lessonGone = async md => {
            reported = true;
            const kept = volume && md && typeof keepVolumeText === 'function' ? ` ${await keepVolumeText(mod, md)}` : '';
            window.showAlert(`차시가 지워졌거나 불러온 내용으로 바뀌어 기본학습 만들기를 멈췄습니다.${kept}`);
        };
        if (volume?.gone) return lessonGone(volume.added ? volume.md : '');
        if (volume) fullContent = volume.md;
        const volumeHalt = !!volume && typeof aiErrorStopsRun === 'function' && aiErrorStopsRun(volume.error); // 하루 한도·키 문제: 남은 탭도 같은 까닭으로 실패한다
        // 다시 보내도 같은 오류(noRetry, lesson-volume.js isVolumeHalt)로 멈췄을 때도 고치기·그림은 같은 까닭으로 실패하므로 하지 않는다
        const volumeQuit = volumeHalt || (!!volume && typeof isVolumeHalt === 'function' && isVolumeHalt(volume.error));

        // 중단하면 끝까지 받지 못한 글이므로 자동 수정과 이미지 생성 비용을 쓰지 않는다
        const stopped = isStopped();
        const commentLabel = moduleId === 'mainQuest' ? '최종 평가' : '기본학습';
        let commentRun = null; // 주석 결과는 저장한 뒤에 알린다(그사이 차시가 없어지면 알리지 않고, 중지로 남은 블록은 멈춘 알림에 적는다)
        if (!stopped && !volumeQuit) {
            if (moduleId !== 'mainQuest') {
                const floor = volume ? { rounds: VOLUME_FIX_ROUNDS, minSpokenChars: volume.targetChars, isStopped } : {}; // 채운 분량 아래로 줄이지 않는다
                fullContent = await autoFixGeneratedTab({ tabId: 'basicLearn', md: fullContent, lockedBlocks, onStatus: setLoadingStatus, ...floor });
                // 분량을 채운 기본학습은 고쳐 받은 체크리스트에도 다시 보기의 옛 (⏱) 시간이 남지 않게 뗀다(lesson-volume.js)
                if (volume && typeof volumeChecklistText === 'function') fullContent = volumeChecklistText(fullContent, lockedBlocks);
            }
            // 주석이 모자란 코드 블록에는 주석만 더한다(code-comments-tool.js). 최종 평가는 정답을 알려 주지 않는 문항 모드다
            if (typeof addGeneratedCodeComments === 'function') {
                const commented = await addGeneratedCodeComments({ md: fullContent, tabId: 'basicLearn', quiz: moduleId === 'mainQuest', lockedBlocks, label: commentLabel, onStatus: setLoadingStatus, isStopped, waitSignal: window.aiStopSignal?.() || null, notify: false });
                fullContent = commented.md;
                commentRun = commented.run;
            }

            // ── 이미지 태그 처리 ── 분량을 채운 글은 초안에 넣은 그림 자리만 채운다
            setLoadingStatus(chunkCount > 1 ? `이미지 생성 중... (${chunkCount}단계 완료)` : '이미지 생성 중...');

            fullContent = restoreLockedSections(await processImageTags(mod, fullContent, { onStatus: setLoadingStatus, inject: !volume }), lockedBlocks);
        }
        if (volume && subj && !lessonStillLive(subj, mod)) return lessonGone(fullContent);

        mod.content = fullContent;
        mod.status = 'done';
        Object.assign(mod, withHistoryNote(mod, 'AI 교안 생성'));
        // 만드는 동안 다른 교과로 옮겼으면 그 화면에 이 차시를 열지 않는다(그 교과의 같은 번호 차시를 원문 저장이 덮는다). 이어지는 전체 생성이 멈춘 까닭을 알린다
        if (lessonOpenHere(subj, mod)) currentEditingModuleId = mod.id;

        // 5탭 마이그레이션: 기본학습 탭에 콘텐츠 저장
        if (typeof migrateMonolithicContent === 'function') migrateMonolithicContent(mod);

        await saveState();
        renderSidebar();
        if (lessonOpenHere(subj, mod)) renderEditor(mod);

        const readMinutes = readAloudMinutes(fullContent);
        // 주석 단계에서 중지했으면 다음 단계로 가지 않고, 넣은 블록과 중지로 남은 블록을 멈춘 알림에 적는다
        if (stopped || commentRun?.stopped) {
            reported = true;
            const commentNote = commentRun?.stopped && typeof commentDoneNote === 'function' ? commentDoneNote(commentRun).text : '';
            window.showAlert([`교안 생성을 중단했습니다. 받은 내용까지 저장했습니다(기본학습 낭독 약 ${readMinutes}분). 이전 교안은 작업 기록에 있습니다.`, commentNote].filter(Boolean).join(' '));
            return;
        }
        if (volumeHalt) { // 남은 탭도 같은 까닭으로 실패하므로 만들지 않는다
            reported = true;
            // 기본학습이 목표에 못 미쳤으면 그 탭은 전체 생성이 다시 채우지 않는다(빈 항목만 만든다). 분량 채우기로 이어서 늘린다
            const shortHint = spokenChars(fullContent) < volume.targetChars ? ` 목표 ${volume.targetMinutes}분에 못 미친 기본학습은 한도가 풀린 뒤 기본학습 탭 위 '분량 채우기'로 이어서 늘리세요.` : '';
            window.showAlert(`${volume.error.message}\n기본학습(낭독 약 ${readMinutes}분)은 저장했습니다. 남은 탭은 한도가 풀린 뒤 '전체 생성'으로 만드세요.${shortHint}`);
            return;
        }

        // 주석 결과(넣은 블록·남은 블록·멈춘 오류)는 저장한 뒤에 알린다. 만드는 동안 차시나 교과가 없어졌으면 알리지 않는다
        if (typeof notifyCodeComments === 'function' && (!subj || lessonStillLive(subj, mod))) notifyCodeComments(commentRun, commentLabel);

        // 나머지 탭, 교수안·슬라이드, 문제은행을 차례로 만든다 (기본학습은 이미 완료). 기본 학습이 낭독 목표에 못 미쳤으면 끝 알림에 적는다
        const shortNote = volume && spokenChars(fullContent) < volume.targetChars ? `기본학습(낭독 약 ${readMinutes}분/목표 ${volume.targetMinutes}분)` : '';
        await window.runLessonPipeline(mod.id, { lockedByTab, continuing: true, shortNote });

    } catch (err) {

        // 중지로 끊긴 호출(지금은 단락 호출에 중지 신호를 넘기지 않아 오지 않는다): 받은 글을 한 번만 저장하고 멈췄다고만 알린다
        if (err?.name === 'AbortError') {
            reported = true;
            if (fullContent && fullContent.length > 200) {
                mod.content = closeOpenFence(fullContent.replace(new RegExp(CONTINUE_MARKER, 'g'), '').replace(END_MARKER, '').trimEnd());
                mod.status = 'done';
                await saveState();
                renderSidebar();
                if (lessonOpenHere(subj, mod)) renderEditor(mod);
            }
            window.showAlert('교안 생성을 중단했습니다. 받은 내용까지 저장했습니다. 이전 교안은 작업 기록에 있습니다.');
            return;
        }

        console.error("교안 생성 중 에러 상세 (generateModuleContent):", err, err.stack);
        reported = true;

        window.showAlert(`교안을 만들지 못했습니다.\n${err.message || '잠시 뒤 다시 해 주세요.'}`);

        // 부분 생성 복구: 일부 청크가 성공한 경우 저장
        if (fullContent && fullContent.length > 200) {
            fullContent = closeOpenFence(fullContent.replace(new RegExp(CONTINUE_MARKER, 'g'), '').replace(END_MARKER, '').trimEnd());
            mod.content = fullContent;
            mod.status = 'done';
            await saveState();
            renderSidebar();
            if (lessonOpenHere(subj, mod)) renderEditor(mod);
            window.showAlert('⚠️ 중간 오류가 발생했지만 작성된 부분까지 저장했습니다.\n수동으로 나머지를 보완하거나 재생성하세요.');
        }

    } finally {

        window.finishLessonPipeline({ quiet: reported });

    }

}

// ── F1-2: 핵심개념 팝업을 거쳐 교안 생성하는 래퍼 ──
window.promptAndGenerateModule = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return;
    if (window.isLessonPipelineRunning()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    const existing = Array.isArray(mod.keyConcepts) ? mod.keyConcepts : [];
    const regenerating = mod.status === 'done';
    const label = regenerating ? `다시 생성: ${mod.title}` : `교안 생성: ${mod.title}`;
    const opts = regenerating
        ? { warning: `${LESSON_TABS.length}개 탭과 그림을 모두 새로 만듭니다. 손으로 고친 내용도 바뀝니다. 지금 내용은 작업 기록에 남아 되돌릴 수 있습니다. 한 탭만 바꾸려면 그 탭의 "이 탭 생성"을 쓰세요.`, okLabel: '모두 다시 생성' }
        : {};
    showKeyConceptsPrompt(label, existing, (concepts) => {
        generateModuleContent(moduleId, concepts);
    }, { ...opts, estimateHtml: moduleGenerationEstimate(mod) });
};

// 카드의 교안 생성·다시 생성이 이어서 할 일(전체 생성과 같은 미리 보기, cost-estimate.js): 모든 탭(기본 학습부터 다시 만든다),
// 이어지는 전체 생성이 채우는 삽화·NCS 요소·갈래(기본학습·심화학습)마다 교수안·슬라이드와 문제은행. 미리 보기를 만들 수 없으면 ''
function moduleGenerationEstimate(mod) {
    if (typeof lessonWork !== 'function' || typeof estimateBoxHtml !== 'function') return '';
    try {
        return estimateBoxHtml(lessonWork({
            tabs: LESSON_TABS.map(tab => tab.id),
            gyosuan: LESSON_TRACKS.filter(track => !gyosuanOf(mod, track.id)?.docMd).length, // 탭을 모두 다시 만들어 두 갈래 모두 글이 생긴다
            qbank: LESSON_TRACKS.length,
            art: typeof lessonWantsArt === 'function' && lessonWantsArt(mod),
            ncs: typeof needsElementAutoAssign === 'function' && needsElementAutoAssign(mod),
            fillsVolume: mod.id !== 'mainQuest', // 최종 평가는 학습 탭 분량을 채우지 않는다
            volumeMinutes: lessonVolumeMinutes(mod),
            practiceMinutes: typeof lessonPracticeWork === 'function' ? lessonPracticeWork(mod) : {} // 실습 시간을 정한 실습 탭은 이어쓰기 호출이 늘어난다
        }, currentEstimateSettings().imageAmount));
    } catch (err) {
        console.warn('[미리 보기] 교안 생성 예고를 만들지 못했습니다:', err);
        return '';
    }
}

// ── F1-2: 메인퀘스트도 핵심개념 팝업 래퍼 ──
window.promptAndGenerateMainQuest = function () {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return;
    if (window.isLessonPipelineRunning?.()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    const mq = subj.mainQuest;
    const existing = Array.isArray(mq?.keyConcepts) ? mq.keyConcepts : [];
    // 이미 만든 최종 평가를 다시 만들면 지금 본문(손으로 고친 글 포함)은 작업 기록에 남기고 새로 쓴다
    const remaking = !!(mq?.content || Object.values(mq?.tabContents || {}).some(Boolean));
    const opts = remaking ? { warning: '최종 평가를 새로 만듭니다. 손으로 고친 내용도 바뀝니다. 지금 내용은 작업 기록에 남아 되돌릴 수 있습니다.', okLabel: '다시 만들기' } : {};
    showKeyConceptsPrompt(remaking ? '최종 평가 다시 만들기' : '최종 평가 만들기', existing, (concepts) => {
        if (concepts.length > 0 && mq) mq.keyConcepts = concepts;
        generateMainQuest();
    }, opts);
};



async function generateMainQuest() {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);

    if (!subj) return;
    // 진행 막대의 생성과 함께 돌면 그 작업의 중지가 이 그림까지 멈춘다. 끝난 뒤에 만든다
    if (window.isLessonPipelineRunning?.()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    window.resetTabGenStop?.(); // 앞서 중지한 작업의 신호가 남아 있으면 그림을 하나도 그리지 않는다. 새 끊기 신호로 시작한다

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
        // 문항 속 코드에 주석이 모자라면 주석만 더한다(code-comments-tool.js, 정답을 알려 주지 않는 문항 모드). 로딩 화면 글로 진행을 보이고 끝나면 되돌린다.
        // 결과는 최종 평가를 넣고 저장한 뒤에 알린다(그사이 교과가 없어져 넣지 못하면 알리지 않는다)
        let commentRun = null;
        if (typeof addGeneratedCodeComments === 'function') {
            const loadingText = document.getElementById('editor-loading-text');
            const shownText = loadingText ? loadingText.textContent : '';
            const commented = await addGeneratedCodeComments({ md: markdownContent, quiz: true, label: '최종 평가', onStatus: text => { if (loadingText) loadingText.textContent = text; }, notify: false });
            markdownContent = commented.md;
            commentRun = commented.run;
            if (loadingText) loadingText.textContent = shownText;
        }

        // 지금 최종 평가(손으로 고친 글 포함)는 작업 기록에 남긴다. 예전에 탭으로 만든 최종 평가(tabContents)는 그 탭들도 함께 남긴다
        if (typeof archiveContents === 'function') await archiveContents([mq], '다시 생성 전');

        markdownContent = await processImageTags(mq, markdownContent);



        // 최종 평가는 본문 하나다(탭이 없는 최종 평가). 예전 탭(tabContents)이 남아 있으면 화면이 옛 탭 글을 보이고 다음 탭 저장이 새 본문을 지우므로 걷어 낸다
        delete mq.tabContents;
        mq.content = markdownContent;

        mq.status = 'done';

        await saveState();

        renderSidebar();

        // 만드는 동안 다른 교과로 옮겼으면 그 교과의 최종 평가 화면에 이 글을 그리지 않는다(다음 원문 저장이 그 교과의 최종 평가를 덮는다)
        if (lessonOpenHere(subj, mq)) {
            currentEditingModuleId = 'mainQuest';
            renderEditor(mq);
            if (typeof notifyCodeComments === 'function') notifyCodeComments(commentRun, '최종 평가');
        } else if (globalState.subjects.includes(subj) && subj.mainQuest === mq) {
            const made = `'${subj.title}' 교과의 최종 평가를 만들었습니다. 그 교과를 열면 볼 수 있습니다.`;
            const [madeText, commentWarn] = typeof withCommentNote === 'function' ? withCommentNote(made, commentRun) : [made, false];
            window.showToast?.(madeText, commentWarn ? 'warning' : 'success');
        } else { // 그사이 교과를 지웠거나 백업·PC 폴더를 불러와 바뀌었다: 넣을 곳이 없다(주석 결과도 알리지 않는다)
            window.showToast?.('최종 평가를 만드는 동안 그 교과를 지웠거나 백업·PC 폴더를 불러와, 만든 최종 평가를 넣지 못했습니다.', 'warning');
        }

    } catch (err) {

        console.error(err);

        window.showAlert(`최종 평가를 만들지 못했습니다.\n${err.message || '잠시 뒤 다시 해 주세요.'}`);

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

// 첫 번째로 완전히 닫힌 JSON 객체만 추출 (중괄호 균형 스캔, 문자열/이스케이프 인식).
// Gemini가 여러 객체나 후행 텍스트를 반환해도 첫 객체만 안전하게 파싱하기 위함.
function extractFirstJsonObject(text) {
    const start = text.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }
    return null; // 닫히지 않은 객체 → 파싱 불가
}

async function extractSearchIntent(keyword, context, signal = null) {
    const systemPrompt = `당신은 ${courseFieldLabel('직업훈련')} 분야 교육 자료를 찾는 데이터 리서처이자 이미지 프롬프트 엔지니어입니다.
주어진 이미지 키워드와 주변 교안 문맥을 분석하여 두 종류의 출력을 생성합니다:
(A) 웹 검색용 쿼리 — 구글 이미지 등 검색 엔진에서 실제 자료를 찾기 위한 쿼리
(B) AI 이미지 생성용 프롬프트 — Gemini 이미지 모델이 문맥에 맞는 고품질 일러스트를 생성하도록 하는 프롬프트

[검색 쿼리(A) 지시사항]
1. 고유명사(제품명, 서비스명, 시스템명, 회사명, 인물명 등)를 쿼리의 핵심에 배치
2. 이미지 종류(일러스트/스크린샷/UI/차트)에 맞는 영어 한정자 추가 ("official art", "gameplay UI", "revenue chart" 등)
3. 영어 쿼리 위주로, 한국 자료는 한글 쿼리 병행
4. 부정어 연산자로 가비지 배제 ("-fanart -cosplay -reddit")
5. 공식 스크린샷이 필요하면 "official screenshot", "in-game" 한정자 사용

[AI 이미지 생성 프롬프트(B) 지시사항 — V8.0.0 텍스트 없는 순수 비주얼]
사용 모델: ${IMAGE_MODEL}
중요: 모델은 한글 글자를 깨진 형태로 렌더하므로, **이미지 안에는 어떤 글자도 넣지 않습니다.**
       한국어 설명은 이미지 아래 HTML 캡션으로 별도 표시되므로, 이미지는 순수하게 시각적 요소(아이콘·일러스트·구도)로만 구성합니다.

1. **반드시 영어로만 작성** — 프롬프트 자체를 영어로 작성. 한국어 단어("상세 교안", "교육용 일러스트", "교안" 등) 절대 포함 금지.
2. **글자/라벨 금지** — 이미지에 텍스트, 글자, 숫자, 라벨, 워터마크, 캡션이 일절 나타나지 않도록 명시.
3. **본문 문맥을 시각화** — 주변 교안의 구체 개념을 글자 대신 시각 요소(아이콘·심볼·장면)로 묘사.
   - 예시: 'A 5-stage game development pipeline infographic: planning desk, art monitors, QA controllers, rocket launch icon, live broadcast. Symbolic icons only, no text, no letters, no labels.'
4. **다이어그램·인포그래픽 형태 권장** — 단계도·플로우차트·카드형 레이아웃 (단, 글자 없이 아이콘/색상 구분).
5. **간결하게** — 50~120 단어 이내.
6. **반드시 끝에 추가**: "${LESSON_IMAGE_STYLE}, 16:9 wide composition. No text, no letters, no words, no labels, no watermark anywhere in the image."
7. **저작권 금지**: 특정 상표·작품·캐릭터 이름 직접 언급 금지.

[출력 포맷 JSON — 반드시 준수]
{
  "intent_type": "data_representation | visual_asset | concept_illustration | screenshot | diagram",
  "search_query": "최적화된 검색 쿼리",
  "image_gen_prompt": "영어 전용 이미지 생성 프롬프트 (50~120 단어, 이미지 내 텍스트 없음, 끝에 '${LESSON_IMAGE_STYLE}, 16:9 wide composition. No text, no letters, no words, no labels, no watermark anywhere in the image.' 포함)",
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
        const response = await callGemini(TEXT_MODEL, { ...payload, signal, attempts: IMAGE_CALL_ATTEMPTS, timing: 'short' });
        const textResp = extractText(response);
        // v7.3: JSON 파싱 전 제어 문자 제거 (Gemini가 줄바꿈/탭을 문자열 내부에 삽입하는 문제)
        const sanitized = textResp
            .replace(/[\x00-\x1F\x7F]/g, ' ')  // 제어 문자 → 공백
            .replace(/```json\s*/gi, '')         // 코드펜스 제거
            .replace(/```\s*/g, '')
            .trim();
        // v7.4: 첫 번째 완전한 JSON 객체만 추출 (다중 객체/후행 텍스트가 와도 안전)
        const firstObject = extractFirstJsonObject(sanitized);
        return firstObject ? JSON.parse(firstObject) : null;
    } catch (e) {
        if (e?.name === 'AbortError') throw e; // 중지: 그림 처리를 멈춘다
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
async function validateImageWithVLM(base64Image, searchIntent, context, signal = null) {
    if (!base64Image) return { isValid: false, reason: "이미지 데이터 없음" };

    // "data:image/jpeg;base64,..."에서 데이터 부분만 추출
    const base64Data = base64Image.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
    const mimeType = base64Image.match(/^data:(image\/[^;]+);/)[1] || "image/jpeg";

    const systemPrompt = `당신은 ${courseFieldLabel('직업훈련')} 교육 자료 품질 검열관입니다.
수집된 이미지가 교안의 문맥(Context) 및 검색 의도(Intent)에 부합하는지 철저히 평가하십시오.
다음 조건 중 하나라도 해당되면 "isValid": false 처리하십시오:
1. 유튜브 썸네일 텍스트 낚시, 조잡한 밈(Meme), 관련 없는 워터마크가 도배된 경우
2. 의도한 데이터 객체(예: 매출 그래프)를 찾았으나 수치나 텍스트를 전혀 읽을 수 없을 정도로 흐릿한 경우
3. 실제 화면·자료가 아닌 팬아트, 코스프레, 모드(Mod) 적용 사진인 경우 (의도된 바가 아니라면)
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
        // 이미지 검열용 모델은 안전장치가 강한 모델 사용 권장. 설정된 모델(TEXT_MODEL) 재활용
        const response = await callGemini(TEXT_MODEL, { ...payload, signal, attempts: IMAGE_CALL_ATTEMPTS, timing: 'short' });
        const textResp = extractText(response);
        const result = JSON.parse(textResp);
        return result;
    } catch (e) {
        if (e?.name === 'AbortError') throw e; // 중지: 판정 실패로 그림을 통과시키지 않는다
        console.error("[VLM Validator] 에러 발생 (기본 통과 처리):", e);
        // 검열기 자체 오류면 차단보단 일단 통과시켜 흐름 유지 (False Positive 방어)
        return { isValid: true, reason: "VLM 통신 에러로 자동 패스", confidence: 0 };
    }
}

// [Phase F10] 구글 Custom Search (Key 롤링 방어 적용)
// opts.quiet: 키를 다 쓴 알림(AI 그림으로 바꾼다는 말)을 띄우지 않는다. 예시 게임 그림은 AI 그림으로 바꾸지 않으므로 이 값을 준다
async function searchImageAPI(query, { quiet = false } = {}) {
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
                const b64 = await fetchImageAsBase64(imgUrl);
                const page = typeof data.items[0].image?.contextLink === 'string' ? data.items[0].image.contextLink : ''; // 그림이 실린 페이지(예시 게임 그림의 출처)
                return { b64, source: imgUrl, page, vendor: "Google" };
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
        if (window.showToast && !quiet) window.showToast(`등록된 검색 API Key의 일일 한도가 모두 소진되었습니다. AI 이미지 생성으로 자동 전환합니다.`, 'error');
    }
    return null;
}

// [Phase F10] 무료 스톡 이미지 (Pixabay) API 연동 (Fallback)
const PIXABAY_QUERY_MAX = 100; // Pixabay API는 q가 100자를 넘으면 400으로 거절한다
let _pixabayRejectedKey = null; // 거절된 키로는 다시 요청하지 않는다. 키를 바꾸면 다시 시도한다

// 검색어 정리가 실패하면 이미지 태그의 긴 설명이 그대로 오므로 낱말 경계에서 자른다
function pixabayQuery(query) {
    const text = String(query || '').replace(/\s+/g, ' ').trim();
    if (text.length <= PIXABAY_QUERY_MAX) return text;
    const cut = text.slice(0, PIXABAY_QUERY_MAX);
    const space = cut.lastIndexOf(' ');
    return (space > PIXABAY_QUERY_MAX / 2 ? cut.slice(0, space) : cut).trim();
}

// 400의 이유는 응답 본문에 적혀 온다. 키 문제면 한 번만 알리고 이후 요청을 멈춘다
async function reportPixabayError(res) {
    const reason = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160);
    console.error(`[Pixabay API] HTTP 에러: ${res.status} ${reason}`);
    if (res.status === 400 && /key/i.test(reason) && _pixabayRejectedKey !== pixabayApiKey) {
        _pixabayRejectedKey = pixabayApiKey;
        window.showToast?.(`Pixabay가 API 키를 거절했습니다. 설정에서 키를 확인해주세요. (${escapeHtml(reason)})`, 'error');
    }
}

async function searchPixabayAPI(query) {
    if (!pixabayApiKey || _pixabayRejectedKey === pixabayApiKey) {
        return null; // 설정되어있지 않거나 거절된 키면 스킵
    }
    const q = pixabayQuery(query);
    if (!q) return null;

    try {
        // pixabay는 기본 영어 검색, 사진(photo) 우선. 한글 검색어는 한국어로 찾는다
        const lang = /[가-힣]/.test(q) ? '&lang=ko' : '';
        const endpoint = `https://pixabay.com/api/?key=${encodeURIComponent(pixabayApiKey)}&q=${encodeURIComponent(q)}${lang}&image_type=photo&per_page=3&safesearch=true`;

        const res = await fetch(endpoint);
        if (!res.ok) {
            await reportPixabayError(res);
            return null;
        }

        const data = await res.json();
        if (data.hits && data.hits.length > 0) {
            // 가장 첫번째 결과의 webformatURL 혹은 largeImageURL 사용
            const imgUrl = data.hits[0].webformatURL || data.hits[0].largeImageURL;

            // CORS 우회 프록시를 통해 base64로 변환 
            const b64 = await fetchImageAsBase64(imgUrl);
            return { b64, source: imgUrl, vendor: "Pixabay" };
        } else {
            return null;
        }
    } catch (e) {
        console.error("[Pixabay API] 통신 에러:", e);
        return null; // 오류나면 fallback 체인 계속 진행
    }
}
// --------------------------------------------------------


// 이미지 태그가 부족한 경우 헤딩마다 자동 주입 — 모든 단락이 이미지를 갖도록 보장
// 전략:
//   - LLM이 ## 단위로만 이미지 태그를 넣은 경우, ### 하위 섹션이 길면(>200자) 추가 주입
//   - LLM이 이미지 태그를 전혀 안 넣었으면 ## + 긴 ### 모두에 주입
//   - 단, 학습목표·교강사 가이드 섹션은 제외
function autoInjectImageTags(markdown) {
    if (!markdown || typeof markdown !== 'string') return markdown;

    const ICON_RE = /[■▣📝⚙️🎮💡✅⚠️🧠🏆🚀🔬🎓📘📗📙📕🖥️🧩🎯🔍]/g;
    // 이미지 자동 주입 제외 섹션
    // - 학습 목표·Objectives: 컨벤션 규칙 (목표는 텍스트 위주)
    // - 교강사 가이드·강사 전용: 강사 노트 영역
    // - 개요·Overview: 차시 시작 안내문 (이미지 불필요, 사용자 요청)
    // - 요약·정리·마무리·Summary: 마무리 섹션도 보통 이미지 불요
    // - 학습 후 체크리스트: 확인 목록이라 그림이 필요 없다(그림 한 장에 검색어·판정·그림 호출이 든다)
    const SKIP_RE = /학습\s*목표|Objectives?|교강사\s*가이드|강사\s*전용|개요|Overview|요약|정리|마무리|Summary|체크리스트/i;

    // 섹션을 헤딩 단위로 분리하여 각 섹션의 길이·이미지 보유 여부 점검
    // 코드 블록 안의 # 줄과 이미지 태그는 제목·그림으로 보지 않는다
    const lines = markdown.split('\n');
    const sections = []; // { startLine, level, title, content, hasImage }
    let cur = null;
    let fence = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const wasFenced = fence;
        fence = fenceStateAfter(fence, line);
        const outside = !wasFenced && !fence;
        const m = outside && line.match(/^(#{2,3})\s+(.+)$/);
        if (m) {
            if (cur) sections.push(cur);
            // 검색어는 제목 글만 쓴다. (⏱ N분)은 분량 채우기가 다시 매기면 낡은 시간이 그림 설명·검색어에 남는다
            const title = m[2].replace(ICON_RE, '').replace(IMAGE_TIME_LABEL, ' ').replace(/\s{2,}/g, ' ').replace(/^\[|\]$/g, '').trim();
            cur = { startLine: i, level: m[1].length, title, content: '', hasImage: false };
        } else if (cur) {
            cur.content += line + '\n';
            if (outside && /<!--\s*\[IMG:/.test(line)) cur.hasImage = true;
        }
    }
    if (cur) sections.push(cur);

    let injected = 0;
    const linesCopy = lines.slice();
    // 뒤에서부터 삽입(오프셋 변동 방지)
    for (let s = sections.length - 1; s >= 0; s--) {
        const sec = sections[s];
        if (sec.hasImage) continue;
        if (SKIP_RE.test(sec.title)) continue;
        if (!sec.title) continue;
        // ## 섹션은 항상 주입, ### 섹션은 본문이 충분히 길어야 주입(200자 이상)
        const contentLength = sec.content.replace(/\s+/g, '').length;
        if (sec.level === 3 && contentLength < 200) continue;
        // 헤딩 라인 직후에 IMG 태그 삽입
        const insertAt = sec.startLine + 1;
        linesCopy.splice(insertAt, 0, '', `<!-- [IMG: "${sec.title}"] -->`, '');
        injected++;
    }

    if (injected > 0) {
    }
    return linesCopy.join('\n');
}
window.autoInjectImageTags = autoInjectImageTags;

const IMAGE_TAG_GAP_MS = 7000; // 이미지 하나에 검색 의도·판정·생성 호출이 이어지므로 무료 등급 분당 호출 한도를 피한다

// 이미지 양 설정에 따라 만들 태그를 고른다. 고르지 않은 태그는 본문에 남아 나중에 '일괄 이미지 찾기'로 채운다
// 예시 게임 태그는 AI를 부르지 않아(위키백과에서 찾는다) '핵심만'에서도 모두 고르고 섹션의 한 장으로 세지 않는다. '넣지 않음'이면 고르지 않는다
function pickImageTags(markdown, tags, amount) {
    if (amount === 'none') return [];
    if (amount !== 'section') return tags;
    const sections = new Set();
    let from = 0;
    return tags.filter(tag => {
        const at = markdown.indexOf(tag.fullMatch, from);
        if (at >= 0) from = at + tag.fullMatch.length;
        if (tag.game) return true;
        const section = (markdown.slice(0, Math.max(at, 0)).match(/^##\s/gm) || []).length;
        if (sections.has(section)) return false;
        sections.add(section);
        return true;
    });
}

const IMAGE_TAG_RE = /<!--\s*\[IMG:\s*"?([^"]+)"?\]\s*-->/g;
const IMAGE_SKIP_SECTIONS = /학습\s*목표|objectives?|개요|overview|요약|정리|마무리|summary|체크리스트/i;
const IMAGE_TIME_LABEL = /\(\s*⏱[^()]*\)/g; // 섹션 제목의 (⏱ N분). 그림 자리 검색어에는 넣지 않는다

// 예시 게임 그림 태그: <!-- [IMG: "game: 공식 영어 제목"] -->. AI 그림 모델 대신 인터넷(위키백과)에서 그 게임의 실제 그림을 찾는다(game-images.js)
const GAME_TAG_PREFIX = 'game:';
const isGameImageKeyword = keyword => String(keyword ?? '').trim().slice(0, GAME_TAG_PREFIX.length).toLowerCase() === GAME_TAG_PREFIX;

// 그림 태그 검색어가 예시 게임 태그이면 게임 제목, 아니면 ''
function gameImageTitle(keyword) {
    if (!isGameImageKeyword(keyword)) return '';
    return String(keyword).trim().slice(GAME_TAG_PREFIX.length).replace(/\s+/g, ' ').trim();
}

// 예시 게임 그림을 찾지 못한 자리의 글(이스케이프 전)
const gameMissText = title => `인터넷에서 '${title}' 게임 그림을 찾지 못했습니다`;

// 새 그림 키. 같은 밀리초에 여럿 만들어도(예시 게임 그림은 사이를 두지 않는다) 겹치지 않게 이미 쓴 키를 피한다
function uniqueLessonImageId(taken = new Set()) {
    let id = '';
    do {
        id = 'img_' + Date.now() + Math.floor(Math.random() * 1000);
    } while (taken.has(id));
    taken.add(id);
    return id;
}

// 태그 바로 앞 500자 안의 가장 가까운 # 제목이 학습 목표·개요·요약 같은 글 위주 섹션인지
function inSkippedImageSection(markdown, fullMatch) {
    const pos = markdown.indexOf(fullMatch);
    const before = markdown.substring(Math.max(0, pos - 500), pos);
    const heading = Math.max(before.lastIndexOf('## '), before.lastIndexOf('# '));
    return heading >= 0 && IMAGE_SKIP_SECTIONS.test(before.substring(heading, heading + 60));
}

// 이 글에서 실제로 처리할 그림 자리. 코드 블록 안의 태그(코드 예제)와 글 위주 섹션의 태그, 이미 있는 그림을 가리키는 local: 태그(백업 ZIP 되살리기)는 빼고,
// 이미지 양 설정으로 고른다. 예고(일괄 이미지 찾기·콘텐츠 정리)와 실제 처리가 같은 수를 쓴다. 검색어의 (⏱ N분)은 뗀다(예전에 넣은 태그)
// 태그마다 game: 예시 게임 태그면 게임 제목, 아니면 ''. 제목이 빈 게임 태그는 뺀다
function pendingImageTags(markdown, amount = 'all') {
    const text = stashCodeFences(String(markdown || '')).text;
    const tags = [...text.matchAll(IMAGE_TAG_RE)].map(match => {
        const keyword = match[1].replace(IMAGE_TIME_LABEL, ' ').replace(/\s{2,}/g, ' ').trim();
        return { fullMatch: match[0], keyword, game: gameImageTitle(keyword) };
    });
    const usable = tag => tag.keyword && !/^local:/.test(tag.keyword) && (tag.game || !isGameImageKeyword(tag.keyword));
    return pickImageTags(text, tags.filter(tag => usable(tag) && !inSkippedImageSection(text, tag.fullMatch)), amount);
}
window.pendingImageTags = pendingImageTags;

// 교안 그림 칸(다시 찾기 버튼과 한글 설명). alt·caption은 이미 이스케이프한 글이어야 한다
// attrs: 다시 찾기 버튼(button)과 그림 설명(caption)에 더 달 data 속성 { 이름: 값 }. 이름은 코드가 정하고 값은 여기서 이스케이프한다(빈 값은 달지 않는다)
function imageWrapperHtml(imgId, keyword, alt, caption, attrs = {}) {
    const extra = map => Object.entries(map || {}).filter(([, value]) => value).map(([name, value]) => ` ${name}="${escapeHtml(String(value))}"`).join('');
    return `<div class="image-wrapper"><img src="local:${imgId}" alt="${alt}" class="rounded-lg border-2 border-accent/30 shadow-md max-w-full"><button class="image-regenerate-btn px-3 py-1.5 text-xs text-white font-bold rounded flex items-center gap-1 border border-accent/50 hover:bg-accent transition-colors" data-lesson-action="regenerate-image" data-keyword="${escapeHtml(keyword)}" data-img-id="${imgId}"${extra(attrs.button)}><i class="ph-bold ph-arrows-clockwise"></i> 다시 찾기</button><div class="image-caption"${extra(attrs.caption)} style="margin-top:8px;text-align:center;font-size:0.85rem;color:#6b7280;font-style:italic;font-weight:500;letter-spacing:-0.01em;line-height:1.4;max-width:100%;">${caption}</div></div>`;
}

// 그림을 못 만든 자리. 그 자리의 '다시 검색'을 누르면 새 그림을 만들어 이 자리에 넣는다(doRegenerateImage). text는 이미 이스케이프한 글이어야 한다
function imagePlaceholderHtml(text, keyword) {
    return `\n<div class="image-placeholder" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:24px;margin:12px 0;border:2px dashed rgba(156,163,175,0.4);border-radius:8px;background:rgba(31,41,55,0.3);color:#9ca3af;font-size:0.85rem;"><i class="ph-bold ph-image" style="font-size:1.4rem;opacity:0.6;"></i> <span>${text}</span> <button data-lesson-action="regenerate-image" data-keyword="${escapeHtml(keyword)}" class="ml-2 px-2 py-1 text-xs bg-accent/20 text-accent border border-accent/40 rounded hover:bg-accent/30 transition-colors" style="cursor:pointer;">🔄 다시 검색</button></div>\n`;
}

// opts.onStatus: 진행 문구(장수·남은 시간)를 받는다 / opts.isStopped·opts.signal: 중지하면 남은 태그를 그대로 두고 그리던 그림 호출도 끊는다
// opts.amount: 'all' | 'section' | 'none' (기본은 설정의 이미지 양) / opts.latest: 다 만든 뒤 이미지를 넣을 최신 글을 돌려준다
// opts.inject: 그림 자리가 빠진 섹션에 태그를 보탤지. 새로 만든 글만 켠다(남은 자리를 채울 때 켜면 이미 그림이 있는 섹션에 또 그린다)
// opts.quiet: 끝 알림을 띄우지 않는다(부른 쪽이 모아서 알린다) / opts.stats: { made, failed, gameFailed }에 이번 결과를 더한다
// opts.gamesOnly: 예시 게임 태그만 채운다(예시 게임 그림 넣기. 다른 그림 자리는 AI를 불러야 해서 그대로 둔다)
// 예시 게임 태그는 검색어 정하기·판정·AI 그림 없이 위키백과(검색 키가 있으면 Google)에서 찾는다(game-images.js). 그 앞에서는 쉬지 않는다
async function processImageTags(mod, markdown, { onStatus = null, isStopped = () => !!window.isTabGenerationStopped?.(), signal = window.aiStopSignal?.() || null, amount = LESSON_IMAGE_AMOUNT, latest = null, inject = true, quiet = false, stats = null, gamesOnly = false } = {}) {

    // LLM이 태그를 누락했을 경우 자동 주입 (이미지 0장 방지). 남은 자리를 채우는 작업은 보태지 않는다
    if (inject) markdown = autoInjectImageTags(markdown);
    const result = markdown;
    const pickedTags = pendingImageTags(markdown, amount).filter(tag => !gamesOnly || tag.game);
    if (pickedTags.length === 0) return result;
    const proseText = stashCodeFences(markdown).text; // 검색 문맥은 코드 블록 밖의 같은 태그 자리에서 읽는다
    const takenIds = new Set(Object.keys(mod?.images && typeof mod.images === 'object' ? mod.images : {}));

    // 부른 쪽 진행 막대에 장수와 남은 시간을 보인다. 남은 시간은 지금까지 걸린 평균으로 잰다
    const startedAt = Date.now();
    const reportImage = (done, game) => {
        if (!onStatus) return;
        const leftMinutes = done ? Math.max(1, Math.round((Date.now() - startedAt) / done * (pickedTags.length - done) / 60000)) : 0;
        onStatus(`🖼️ 이미지 ${done + 1}/${pickedTags.length} ${game ? '인터넷에서 찾는 중' : '만드는 중'} · ${done ? `남은 시간 약 ${leftMinutes}분` : '남은 시간 계산 중'}`);
    };

    // 시작 알림 — 사용자가 진행 상황을 인지할 수 있도록 toast 표시
    if (window.showToast && !quiet && !onStatus) window.showToast(`🎨 이미지 ${pickedTags.length}개를 차례로 만듭니다. 한 장에 수십 초가 걸릴 수 있습니다.`, 'info');

    // Rate Limit(429) 방지: 순차 처리 + AI를 부르는 그림 사이 7초 간격
    let successCount = 0;
    let failCount = 0;
    let gameFails = 0; // 못 찾은 자리 가운데 예시 게임 그림(끝 알림이 그림 모델 이야기를 하지 않게)
    let skipped = 0;
    let blockedLeft = 0; // 그림 모델이 모두 막혀 그대로 둔 태그 수
    let calledAi = false; // AI를 부르는 그림 자리를 하나라도 처리했는지(다음 그런 자리 앞에서 쉰다)
    const replacements = [];
    for (let index = 0; index < pickedTags.length; index++) {
        const tag = pickedTags[index];
        // 그림 모델이 모두 막혔고 검색으로 찾을 길도 없으면 AI를 부르는 태그는 부르지 않고 둔다(비용 없음). 예시 게임 태그는 위키백과에서 계속 찾는다
        const blocked = !tag.game && imageGenerationBlocked() && !imageSearchReady();
        // AI를 부르는 자리 사이에 간격을 둔 뒤 중지를 확인한다. 중지하면 남은 태그는 본문에 두어 '일괄 이미지 찾기'로 이어서 만든다
        if (!tag.game && !blocked && calledAi) await waitMs(IMAGE_TAG_GAP_MS, signal).catch(() => {}); // 중지하면 간격을 다 기다리지 않는다
        if (isStopped() || signal?.aborted) {
            skipped = pickedTags.length - index;
            break;
        }
        if (blocked) {
            blockedLeft += 1;
            continue;
        }
        if (!tag.game) calledAi = true;
        reportImage(index, !!tag.game);
        let outcome = ''; // 'stopped' | 'blocked'이면 이 태그는 글에 그대로 둔다
        const replacement = await (async () => {
        try {

            // [Phase F10] 1. 문맥 기반 검색어 튜닝 에이전트 가동
            const context = getContextWindow(proseText, tag.fullMatch, 400);
            if (tag.game) { // 예시 게임: 위키백과 → (검색 키가 있으면) Google. 검색어 정하기·Pixabay·AI 그림은 쓰지 않는다
                if (typeof gameTagReplacement === 'function') return await gameTagReplacement(tag, { signal, context, taken: takenIds });
                return { fullMatch: tag.fullMatch, html: imagePlaceholderHtml(escapeHtml(gameMissText(tag.game)), tag.keyword), game: true };
            }
            const intent = await extractSearchIntent(tag.keyword, context, signal);
            const searchQuery = (intent && intent.search_query) ? intent.search_query : tag.keyword;


            // [Phase F10] 2. Google Custom Search API 연동 (다중 키 롤링)
            let b64Image = null;
            let vendorLabel = "";

            // 2-1. 먼저 동일한 검색어(의도)에 대해 로컬 캐시가 있는지 확인
            const cached = await DBManager.getCache(searchQuery);
            if (cached && cached.base64) {
                b64Image = cached.base64;
                vendorLabel = `캐시된 이미지 (${cached.format})`;
                if (window.showToast) window.showToast(`로컬 캐시에서 이미지를 로드했습니다: ${searchQuery}`, 'success');
            } else {
                // 2-2. 캐시가 없으면 구글 API 검색 수행
                const searchResult = await searchImageAPI(searchQuery);

                if (searchResult && searchResult.b64) {
                    // [Phase F10] 2-3. VLM(Vision-Language Model) 기반 이미지 유효성 심사
                    const validation = await validateImageWithVLM(searchResult.b64, intent, context, signal);

                    if (validation && validation.isValid !== false) {
                        b64Image = searchResult.b64;
                        vendorLabel = `웹 검색 연동`;

                        // 검열 통과 시 IndexedDB 캐시에 영구 저장
                        await DBManager.setCache(searchQuery, b64Image, searchResult.source, vendorLabel);
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
                }
            }

            // [Phase F10] 4. Fallback 체인 최종: AI 이미지 생성 (모든 외부 검색/통과 실패 시)
            if (!b64Image) {
                if (imageGenerationBlocked()) { // 그림 모델이 모두 막혔다: 이 자리는 남긴다(검색으로만 찾는 중)
                    outcome = 'blocked';
                    return null;
                }
                // 우선순위:
                // 1) extractSearchIntent가 생성한 image_gen_prompt (문맥 기반 고품질)
                // 2) 레거시 방식 (Context + Query) - 이전 응답 호환
                // 3) 키워드 단독 - 최후 수단
                let generatePrompt;
                // V7 단순 프롬프트 — 키워드는 통째로 사용 (토큰화 → 개별 라벨 카드 생성 방지)
                // 이전 버그: '5. 핵심 내용: 최신 게임 업계 트렌드 분석' 같은 섹션 제목을
                //          공백으로 split → '핵심', '내용:', '최신', '게임', '업계', '트렌드' 6개
                //          라벨 카드로 그려져 본문 무관 이미지 생성됨.
                // 수정: 키워드는 한 덩어리 개념으로 묘사 (개별 라벨 X)
                // 이미지에 글자가 박히지 않도록 보장하는 영어 접미사
                const NO_TEXT_SUFFIX = ' No text, no letters, no words, no labels, no watermark anywhere in the image.';
                if (intent && intent.image_gen_prompt && intent.image_gen_prompt.length > 30) {
                    // 방어적 정제: 모델이 실수로 넣은 한국어 메타 라벨 제거 + 글자 금지 접미사 보강
                    let promptText = intent.image_gen_prompt
                        .replace(/["']?(상세\s*교안|교육용\s*일러스트|교안|학습\s*이해도|기본\s*학습|심화\s*학습)["']?/g, '')
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                    if (!/no text/i.test(promptText)) promptText += NO_TEXT_SUFFIX;
                    generatePrompt = withLessonImageStyle(promptText);
                } else {
                    // 키워드에서 번호·불필요한 기호 제거하여 자연스러운 주제로 변환
                    const cleanedKeyword = tag.keyword
                        .replace(/^\d+[.\)]\s*/, '')      // 앞쪽 '5.' 같은 번호 제거
                        .replace(/^[#*\-]+\s*/, '')       // 마크다운 마커 제거
                        .replace(/[:：]\s*$/, '')         // 끝의 콜론 제거
                        .trim();
                    // V8: 영어 전용 + 글자 금지 (한국어 "교육용 일러스트" 제거 — 이미지에 글자가 박히던 문제 해결)
                    generatePrompt = `Educational concept illustration representing "${cleanedKeyword}", ${LESSON_IMAGE_STYLE}, 16:9 wide composition.${NO_TEXT_SUFFIX}`;
                }
                b64Image = await generateImageAPI(generatePrompt, {
                    signal,
                    onRetry: ({ delayMs, isRateLimit }) => onStatus?.(`🖼️ 이미지 ${index + 1}/${pickedTags.length}: ${isRateLimit ? '그림 모델 사용 한도에 걸려' : '그림 모델 호출이 실패해'} ${Math.round((delayMs || 0) / 1000)}초 뒤 한 번 더 해 봅니다`)
                });
                vendorLabel = "AI 생성 이미지";
                if (!b64Image && imageGenerationBlocked()) { // 이 그림에서 그림 모델이 모두 막혔다: 이 자리도 남긴다
                    outcome = 'blocked';
                    return null;
                }
            }

            // v5.9: 한글 설명 — intent.reasoning 또는 키워드. 남이 준 파일의 글일 수 있어 HTML로 이스케이프한다
            const koreanDesc = String((intent && intent.reasoning) ? intent.reasoning : tag.keyword);
            const safeKoreanDesc = escapeHtml(koreanDesc);

            if (b64Image) {
                // 그림은 글에 자리를 넣을 때(아래) 차시 그림에 담는다. 그리는 동안 원문을 저장하면 글이 아직 가리키지 않는 그림을 덜어 낸다(tabs.js dropUnusedLessonImages)
                const imgId = uniqueLessonImageId(takenIds);

                let vendorIcon = 'ph-sparkle'; // default (AI)
                if (vendorLabel.includes('Google') || vendorLabel.includes('웹 검색')) vendorIcon = 'ph-google-logo';
                else if (vendorLabel.includes('Pixabay') || vendorLabel.includes('스톡')) vendorIcon = 'ph-camera';
                else if (vendorLabel.includes('캐시')) vendorIcon = 'ph-images';

                // 한글 캡션 텍스트 (이미지 안에 깨진 한글이 그려지는 대신 HTML로 정확히 표시)
                // tag.keyword가 영어면 intent.reasoning(한글) 또는 fallback. 자른 뒤 이스케이프해야 &quot; 같은 표시가 반쯤 잘리지 않는다
                const captionSource = (intent && typeof intent.reasoning === 'string' && /[가-힣]/.test(intent.reasoning))
                    ? intent.reasoning
                    : (/[가-힣]/.test(tag.keyword) ? tag.keyword : koreanDesc);
                const captionText = escapeHtml(captionSource.slice(0, 80));
                const imgHTML = `\n${imageWrapperHtml(imgId, tag.keyword, safeKoreanDesc, captionText)}\n`;

                return { fullMatch: tag.fullMatch, html: imgHTML, imgId, image: b64Image };
            } else {
                console.warn(`[Image Pipeline] (${index + 1}/${pickedTags.length}) ⚠️ 이미지 미확보: ${tag.keyword}`);
                return { fullMatch: tag.fullMatch, html: imagePlaceholderHtml(`이미지 영역: ${safeKoreanDesc}`, tag.keyword) };
            }

        } catch (e) {
            if (e?.name === 'AbortError') { // 중지: 이 태그는 남긴다
                outcome = 'stopped';
                return null;
            }
            console.error(`이미지 처리 실패 (${tag.keyword}):`, e);
            if (tag.game) return { fullMatch: tag.fullMatch, html: imagePlaceholderHtml(escapeHtml(gameMissText(tag.game)), tag.keyword), game: true };
            return { fullMatch: tag.fullMatch, html: imagePlaceholderHtml(`이미지 확보 실패: ${escapeHtml(tag.keyword)}`, tag.keyword) };
        }
        })();
        if (outcome === 'stopped') {
            skipped = pickedTags.length - index;
            break;
        }
        if (outcome === 'blocked') { // 이 자리는 두고, 다음 자리는 검색으로만 찾는다(검색 키가 없으면 위에서 멈춘다)
            blockedLeft += 1;
            continue;
        }
        replacements.push(replacement);
    }

    // 기다리는 동안 글이 바뀌었으면 최신 글에 넣는다. 지운 태그 자리의 이미지는 넣지 않는다
    // 새로 만든 글이면 최신 글에도 같은 기준으로 태그를 보충해야 자동으로 넣은 태그 자리의 이미지가 빠지지 않는다
    // 그림은 자리를 넣는 이 한 걸음에서 차시 그림에 담는다(latest()가 고치던 원문을 저장하며 쓰지 않는 그림을 덜어 내도 새 그림은 남게). 부른 쪽은 돌려받은 글을 곧바로 탭에 넣는다
    // 코드 블록은 자리표시로 바꿔 두고 찾는다(코드 예제 속 같은 모양의 태그에 그림 칸을 넣지 않게). 코드 글자는 그대로 되돌린다
    const finalText = latest ? (inject ? autoInjectImageTags(latest()) : latest()) : result;
    const code = stashCodeFences(finalText, { keepSpaces: true });
    let output = code.text;
    let gone = 0; // 그리는 동안 글에서 지운 자리(그 그림은 담지 않는다)
    for (const rep of replacements) {
        if (!rep) continue;
        const at = output.indexOf(rep.fullMatch);
        if (at < 0) {
            gone += 1;
            continue;
        }
        output = output.slice(0, at) + rep.html + output.slice(at + rep.fullMatch.length); // 글 조각으로 이어 붙여 그림 설명 속 $ 기호를 바꿀 글 규칙으로 읽지 않는다
        if (!rep.imgId) {
            failCount++;
            if (rep.game) gameFails++;
            continue;
        }
        if (!mod.images || typeof mod.images !== 'object') mod.images = {};
        mod.images[rep.imgId] = rep.image;
        successCount++;
    }
    if (stats) {
        stats.made += successCount;
        stats.failed += failCount;
        if (gameFails) stats.gameFailed = (stats.gameFailed || 0) + gameFails;
        if (gone) stats.gone = (stats.gone || 0) + gone;
    }
    if (blockedLeft && _imageRun) _imageRun.left += blockedLeft;

    // 완료 토스트 — 성공/실패 카운트 표시. 중지로 남긴 태그가 있으면 이어서 만드는 법을 알린다
    // 부른 쪽이 모아서 알리거나(quiet) 그림 모델이 막혀 남긴 자리가 있으면(이미 한 번 알렸고 작업 끝에 다시 알린다) 띄우지 않는다
    if (!quiet && !blockedLeft) {
        if (skipped) {
            window.showToast?.(`이미지 ${successCount}건을 만들고 ${skipped}건은 남겨 두었습니다. '일괄 이미지 찾기'로 이어서 만들 수 있습니다.`, 'warning');
        } else if (window.showToast) {
            if (successCount > 0 && failCount === 0) {
                window.showToast(`✅ 이미지 ${successCount}건 생성 완료`, 'success');
            } else if (successCount > 0 && failCount > 0) {
                window.showToast(`⚠️ 이미지 ${successCount}건 성공 · ${failCount}건 실패 (실패한 자리는 '다시 검색'으로 다시 해 보세요)`, 'warning');
            } else if (failCount > 0 && gameFails === failCount) { // 예시 게임 그림만 못 찾았다: 그림 모델 이야기를 하지 않는다
                window.showToast(`인터넷에서 예시 게임 그림 ${failCount}장을 찾지 못했습니다. 그 자리의 '다시 검색'으로 다시 해 보세요.`, 'warning');
            } else if (failCount > 0) {
                window.showToast(`❌ 그림 ${failCount}장을 모두 만들지 못했습니다. 설정의 이미지 생성 모델과 키를 확인해 주세요.`, 'error');
            }
        }
    }

    return code.restore(output);
}

// 그림 자리를 채울 글: 탭이 있는 차시는 글이 있는 탭마다, 탭으로 나뉘기 전 차시와 최종 평가는 본문 하나
// (탭이 있으면 mod.content는 탭을 이어 붙인 글이라 따로 다루지 않는다. setTabMarkdown이 다시 만든다)
function lessonTextParts(mod) {
    if (LESSON_TABS.some(tab => mod?.tabContents?.[tab.id])) return LESSON_TABS.filter(tab => mod.tabContents[tab.id]);
    return mod?.content ? [{ id: 'basicLearn', label: '본문' }] : [];
}

// 그림을 채우는 글. 문제은행 탭(학습이해도·심화이해도)은 빼서 남은 그림 자리도 세지도 채우지도 않는다(컨벤션: 문제은행 탭에는 그림을 넣지 않는다)
const lessonPictureParts = mod => lessonTextParts(mod).filter(part => !isQuestionBankTab(part.id));

// 아직 채우지 않은 그림 자리가 남은 글(일괄 이미지 찾기)
function imageTagTabs(mod) {
    return lessonPictureParts(mod).filter(part => pendingImageTags(storedTabMarkdown(mod, part.id)).length);
}

// 그림 자리 수. 실제 처리와 같은 기준(pendingImageTags, 'all')으로 센다. clean: 세기 전에 글에 적용할 정리(콘텐츠 정리는 서식 정리 뒤를 센다)
function countImageSlots(mod, parts = lessonPictureParts(mod), clean = text => text) {
    return parts.reduce((sum, part) => sum + pendingImageTags(clean(storedTabMarkdown(mod, part.id))).length, 0);
}

// 그림 자리 가운데 예시 게임 그림 수(위키백과에서 찾아 AI 호출이 들지 않는다). 예고가 AI 그림 장수에서 뺀다
function countGameImageSlots(mod, parts = lessonPictureParts(mod), clean = text => text) {
    return parts.reduce((sum, part) => sum + pendingImageTags(clean(storedTabMarkdown(mod, part.id))).filter(tag => tag.game).length, 0);
}

// 그림을 채운 작업의 끝 알림. slots: 시작할 때 센 자리 수(중지·한도로 못 간 자리는 남은 자리로 센다. 그리는 동안 글에서 지운 자리 gone은 빼고)
// 못 만든 자리는 그림 없는 자리(이미지 영역·이미지 확보 실패)가 되고, 그 자리의 '다시 검색'이 새 그림을 만들어 넣는다(doRegenerateImage)
// gameFailed: 못 만든 자리 가운데 인터넷에서 찾지 못한 예시 게임 그림. 모두 그것이면 그림 모델 설정을 보라고 하지 않는다
function imageFillSummary({ made = 0, failed = 0, gone = 0, gameFailed = 0 }, slots = 0) {
    const left = Math.max(0, slots - made - failed - gone);
    const retry = "그 자리의 '다시 검색'으로 다시 해 보세요.";
    const madeText = made ? `그림 ${made}장을 넣었습니다.` : '넣은 그림은 없습니다.';
    const onlyGames = failed > 0 && gameFailed >= failed;
    const head = !failed ? madeText
        : made ? `${madeText} 못 만든 ${failed}곳은 ${retry}`
            : onlyGames ? `인터넷에서 예시 게임 그림을 찾지 못했습니다(${failed}곳). ${retry}`
                : `그림을 하나도 넣지 못했습니다(${failed}곳). 설정의 이미지 생성 모델과 키를 확인한 뒤 ${retry}`;
    const text = left ? `${head} 그림 자리 ${left}개는 그대로 남겨 두었습니다.` : head;
    return { text, kind: failed && !made ? (onlyGames ? 'warning' : 'error') : failed || left ? 'warning' : 'success' };
}
window.lessonTextParts = lessonTextParts;
window.countImageSlots = countImageSlots;
window.countGameImageSlots = countGameImageSlots;
window.imageFillSummary = imageFillSummary;

// 일괄 작업이 시작할 때 잡은 차시(최종 평가)가 아직 지금 데이터의 그 객체인지. 백업·PC 폴더를 불러오거나 교과·차시를 지우면(휴지통)
// 같은 번호라도 다른 객체이거나 없다. 그런 차시에 그림을 넣고 화면에 그리면 다음 원문 저장이 불러온 글을 옛 글로 덮는다
function lessonStillLive(subj, mod) {
    if (!subj || !mod || !globalState.subjects.includes(subj)) return false;
    if (mod === subj.mainQuest) return true;
    const lessons = subj.id === currentSubjectId ? courseData : subj.lessons; // 열린 교과는 courseData가 먼저 바뀐다(saveState가 맞춘다)
    return Array.isArray(lessons) && lessons.includes(mod);
}

// 그 차시의 그 탭을 지금 화면에서 보고 있는지. 다른 교과의 같은 번호 차시나 불러온 차시(같은 번호, 다른 객체)는 아니다
const isShowingLessonTab = (subj, mod, tabId) => currentSubjectId === subj?.id && getEditingModule(mod.id) === mod && isViewingTab(mod, tabId);

// 시작한 교과가 아직 열려 있고 그 차시(최종 평가)가 그 교과의 그 객체인지. 오래 걸린 생성이 끝나 화면에 열기 전에 본다
// (다른 교과로 옮겼으면 같은 번호의 그 교과 차시나 그 교과의 최종 평가 화면에 이 글을 그리지 않는다. 다음 원문 저장이 그쪽을 덮는다)
const lessonOpenHere = (subj, mod) => !!subj && !!mod && currentSubjectId === subj.id && getEditingModule(mod.id) === mod;

const SAVE_AGAIN_HINT = '브라우저 저장 공간을 확인한 뒤 Ctrl+S로 다시 저장해 주세요.';

// 일괄 이미지 찾기의 탭 하나. 그리는 동안 차시가 지워지거나 불러온 내용으로 바뀌면 넣지 않고 'gone', 저장하지 못하면 'save', 아니면 ''
async function fillTabImages(subj, mod, tabId, stats) {
    if (!lessonStillLive(subj, mod)) return 'gone';
    const snapshot = storedTabMarkdown(mod, tabId);
    const tabStats = { made: 0, failed: 0 }; // 넣은 탭의 그림만 끝 알림에 센다
    const processed = await processImageTags(mod, snapshot, {
        amount: 'all', inject: false, quiet: true, stats: tabStats, onStatus: window.setPipelineStatus,
        isStopped: () => window.isTabGenerationStopped() || !lessonStillLive(subj, mod), // 차시가 사라지면 남은 그림을 더 부르지 않는다
        latest: () => latestTabMarkdown(mod, tabId, snapshot)
    });
    if (!lessonStillLive(subj, mod)) return 'gone';
    stats.made += tabStats.made;
    stats.failed += tabStats.failed;
    stats.gone = (stats.gone || 0) + (tabStats.gone || 0);
    stats.gameFailed = (stats.gameFailed || 0) + (tabStats.gameFailed || 0);
    setTabMarkdown(mod, tabId, processed);
    const saved = (await saveState()) !== false; // 브라우저에 저장하지 못하면 false(알림은 saveState가 띄운다)
    if (isShowingLessonTab(subj, mod, tabId)) renderEditor(mod);
    return saved ? '' : 'save';
}

// 남은 이미지 태그를 탭마다 채운다. 화면을 막지 않고 진행 막대에 장수·남은 시간·중지를 보인다.
// 탭 글을 고쳐 저장해야 화면과 내보내기에 반영된다 (합친 본문만 고치면 다음 저장 때 사라진다)
// 이미 그림이 있는 섹션에 또 그리지 않도록 태그를 보태지 않고(inject: false), 예고한 자리 수 그대로 채운다
async function generateAllImagesInModule(moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return;
    if (window.isLessonPipelineRunning?.()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    const tabs = imageTagTabs(mod);
    if (!tabs.length) return window.showToast('아직 채우지 않은 그림 자리가 없습니다.', 'info');
    const slots = countImageSlots(mod, tabs);
    const games = countGameImageSlots(mod, tabs); // 예시 게임 그림은 위키백과에서 찾아 AI 호출로 세지 않는다
    if (!(await confirmWithEstimate(`탭 ${tabs.length}개에서 아직 채우지 않은 그림 자리 ${slots}개를 검색이나 AI로 채웁니다.`, { images: slots - games, gameImages: games }, { title: '일괄 이미지 찾기', okLabel: '찾기 시작', exactImages: true }))) return;
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    const stats = { made: 0, failed: 0 };
    let halt = ''; // fillTabImages가 멈춘 까닭('gone' · 'save')
    await window.runLessonJob(moduleId, { label: '일괄 이미지 찾기', current: tabs[0].id, total: tabs.length, alerts: true }, async () => {
        try {
            for (let i = 0; i < tabs.length && !halt && !window.isTabGenerationStopped(); i++) {
                window.updateLessonJob({ current: tabs[i].id, label: `${tabs[i].label} 이미지`, done: i });
                halt = await fillTabImages(subj, mod, tabs[i].id, stats);
            }
            const summary = imageFillSummary(stats, slots);
            if (halt === 'gone') window.notifyLessonJobDone('일괄 이미지 찾기를 멈췄습니다. 그사이 이 차시를 지우거나 옮겼거나, 백업·PC 폴더를 불러와 내용이 바뀌었습니다.', 'warning');
            else if (halt === 'save') window.notifyLessonJobDone(`저장하지 못해 일괄 이미지 찾기를 멈췄습니다. 마지막에 넣은 그림은 아직 저장되지 않았습니다. ${SAVE_AGAIN_HINT}`, 'error');
            else if (window.isTabGenerationStopped()) window.notifyLessonJobDone(`일괄 이미지 찾기를 멈췄습니다. ${summary.text} 다시 누르면 남은 자리부터 이어서 채웁니다.`, 'warning');
            else window.notifyLessonJobDone(`일괄 이미지 찾기를 마쳤습니다. ${summary.text}`, summary.kind);
        } catch (e) {
            console.error('이미지 일괄 확보 실패:', e);
            window.showAlert('이미지 검색/생성 중 오류가 발생했습니다.');
        }
    });
}



// 교과의 차시와 최종 평가. 차시 목록 안의 id 'mainQuest' 항목은 편집기에서 열리지 않으므로(getEditingModule은 subj.mainQuest를 연다) 빼고,
// 같은 객체가 두 번 들어가지 않게 한다
const cleanupTargets = subj => [...new Set([...(subj.lessons || []).filter(lesson => lesson && lesson.id !== 'mainQuest'), subj.mainQuest].filter(Boolean))];

// 탭(옛 본문은 하나)마다 글 서식을 정리한다. 고친 글 수를 돌려준다
function cleanLessonMarkdown(mod) {
    if (typeof sanitizeMarkdownContent !== 'function') return 0;
    return lessonTextParts(mod).reduce((count, part) => {
        saveOpenEditsFor(mod, part.id); // 원문 칸에서 고치던 글을 먼저 저장해 덮어쓰지 않는다(tabs.js)
        const before = storedTabMarkdown(mod, part.id);
        const after = sanitizeMarkdownContent(before, { promptLabels: false }); // 강사가 쓴 대괄호 줄은 지시 라벨로 보지 않는다(data.js)
        if (after === before) return count;
        setTabMarkdown(mod, part.id, after);
        return count + 1;
    }, 0);
}

// 콘텐츠 정리의 차시 하나: 서식을 고치고 남은 그림 자리를 채운다. 그리는 동안 차시가 지워지거나 불러온 내용으로 바뀌면 { lost: true }
async function cleanupLesson(subj, mod, run) {
    const stats = { made: 0, failed: 0 };
    const changed = cleanLessonMarkdown(mod);
    let touched = changed > 0;
    if (changed && lessonTextParts(mod).some(part => isShowingLessonTab(subj, mod, part.id))) renderEditor(mod);
    for (const part of lessonPictureParts(mod)) { // 문제은행 탭의 남은 그림 자리는 채우지 않는다
        if (run.stopped) break;
        const snapshot = storedTabMarkdown(mod, part.id);
        if (!pendingImageTags(snapshot).length) continue;
        const processed = await processImageTags(mod, snapshot, {
            amount: 'all', inject: false, quiet: true, stats, onStatus: window.setPipelineStatus,
            isStopped: () => window.isTabGenerationStopped() || !lessonStillLive(subj, mod), // 차시가 사라지면 남은 그림을 더 부르지 않는다
            latest: () => latestTabMarkdown(mod, part.id, snapshot)
        });
        if (!lessonStillLive(subj, mod)) return { lost: true };
        if (processed !== storedTabMarkdown(mod, part.id)) {
            setTabMarkdown(mod, part.id, processed);
            touched = true;
        }
        if (isShowingLessonTab(subj, mod, part.id)) renderEditor(mod);
    }
    return { lost: false, changed, touched, stats };
}

// 콘텐츠 정리: 교과의 모든 차시와 최종 평가에서 글 서식을 고치고 아직 채우지 않은 그림 자리를 모두 채운다(이미지 양 설정과 상관없이).
// 화면을 막지 않고 진행 막대(runLessonJob)에서 차시 순서·그림 장수·중지를 보인다. 바뀐 차시마다 저장하므로 멈춰도 한 데까지 남는다
window.sanitizeAllContent = async function () {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return window.showAlert('교과를 먼저 선택하세요.');
    if (window.isLessonPipelineRunning?.()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
    const targets = cleanupTargets(subj);
    const cleanText = typeof sanitizeMarkdownContent === 'function' ? sanitizeMarkdownContent : text => text;
    const slotsOf = targets.map(mod => countImageSlots(mod, undefined, cleanText)); // 서식 정리가 고치는 깨진 태그까지 센다
    const slots = slotsOf.reduce((sum, count) => sum + count, 0);
    const games = targets.reduce((sum, mod) => sum + countGameImageSlots(mod, undefined, cleanText), 0); // 예시 게임 그림은 AI 호출로 세지 않는다
    const lessonCount = targets.filter(mod => mod.id !== 'mainQuest').length;
    const hasFinal = !!subj.mainQuest && lessonTextParts(subj.mainQuest).length > 0;
    const where = `${subj.title ? `'${subj.title}'의` : '이 교과의'} 차시 ${lessonCount}개${hasFinal ? '와 최종 평가' : ''}에서`;
    const ok = slots
        ? await confirmWithEstimate(`${where} 글 서식을 고치고, 아직 채우지 않은 그림 자리 ${slots}개를 채웁니다. 오른쪽 아래 막대에서 언제든 멈출 수 있습니다.`, { images: slots - games, gameImages: games }, { title: '콘텐츠 정리', okLabel: '정리 시작', exactImages: true })
        : await confirmAsync(`${where} 글 서식을 고칩니다. 채울 그림 자리는 없습니다.`, { title: '콘텐츠 정리', okLabel: '정리 시작', tone: 'primary' });
    if (!ok) return;
    const stats = { made: 0, failed: 0 };
    let cleaned = 0;
    let dropped = 0; // 정리하는 동안 지운 차시의 그림 자리. 끝 알림의 남긴 자리에서 뺀다
    let halt = ''; // 'gone': 교과를 지웠거나 불러온 내용으로 바뀌었다 · 'save': 저장하지 못했다
    const outcome = await window.runLessonJob(currentEditingModuleId ?? targets[0]?.id, { label: '콘텐츠 정리', total: targets.length }, async run => {
        try {
            for (let i = 0; i < targets.length && !run.stopped && !halt; i++) {
                const mod = targets[i];
                window.updateLessonJob({ label: `콘텐츠 정리 · ${mod.title || '차시'}`, done: i });
                const done = lessonStillLive(subj, mod) ? await cleanupLesson(subj, mod, run) : { lost: true };
                if (done.lost) { // 그사이 지운 차시는 건너뛰고(그 자리 수도 빼고), 교과째 바뀌었으면 멈춘다
                    dropped += slotsOf[i];
                    if (!globalState.subjects.includes(subj)) halt = 'gone';
                    continue;
                }
                cleaned += done.changed;
                stats.made += done.stats.made;
                stats.failed += done.stats.failed;
                stats.gone = (stats.gone || 0) + (done.stats.gone || 0);
                stats.gameFailed = (stats.gameFailed || 0) + (done.stats.gameFailed || 0);
                // 바뀐 차시만 저장한다(저장마다 PC 폴더 동기화가 돈다). 저장하지 못하면 그림을 더 부르지 않는다
                if (done.touched && (await saveState()) === false) halt = 'save';
            }
            if (!halt && !globalState.subjects.includes(subj)) halt = 'gone';
            return { ok: true };
        } catch (e) {
            console.error('[콘텐츠 정리]', e);
            window.showAlert(`정리 중 오류가 나 멈췄습니다. 앞의 차시까지 고친 내용은 저장했습니다.\n${e.message || e}`);
            return { ok: false };
        }
    });
    if (!outcome?.ok) return; // 다른 생성이 돌고 있었거나(busy) 오류를 이미 알렸다
    // 교과째 바뀌었으면 넣은 그림 수를 말하지 않는다(그 그림은 지금 데이터에 없다)
    if (halt === 'gone') return window.notifyLessonJobDone('콘텐츠 정리를 멈췄습니다. 그사이 이 교과를 지우거나 백업·PC 폴더를 불러와 내용이 바뀌었습니다.', 'warning');
    if (halt === 'save') return window.notifyLessonJobDone(`저장하지 못해 콘텐츠 정리를 멈췄습니다. 마지막에 고친 차시는 아직 저장되지 않았습니다. ${SAVE_AGAIN_HINT}`, 'error');
    const formatted = cleaned ? `글 ${cleaned}개의 서식을 고쳤습니다.` : '고칠 서식은 없었습니다.';
    const summary = slots ? imageFillSummary(stats, slots - dropped) : null; // 채울 자리가 없었으면 그림 이야기는 하지 않는다
    const report = summary ? `${formatted} ${summary.text}` : formatted;
    if (window.isTabGenerationStopped()) return window.notifyLessonJobDone(`콘텐츠 정리를 멈췄습니다. ${report} 다시 누르면 남은 곳부터 이어서 합니다.`, 'warning');
    window.notifyLessonJobDone(`콘텐츠 정리를 마쳤습니다. ${report}`, summary ? summary.kind : 'success');
};
window.cleanupTargets = cleanupTargets;
window.cleanLessonMarkdown = cleanLessonMarkdown;
window.lessonStillLive = lessonStillLive;

// 차시 삽화는 과정 전체가 같은 화풍을 쓴다. 사용자가 직접 쓴 이미지 명령에는 붙이지 않는다.
function withLessonImageStyle(prompt) {
    return prompt.includes(LESSON_IMAGE_STYLE) ? prompt : `${prompt}, ${LESSON_IMAGE_STYLE}`;
}

// 한 작업(전체 생성·남은 차시 생성·일괄 작업) 동안 다시 불러도 안 되는 그림 모델을 적어 둔다. 작업이 끝나면 잊는다
// left: 그림 없이 남긴 교안 그림 자리(태그) 수 · slides: 만들지 못한 교수안 슬라이드 그림 수(슬라이드 그림은 교안에 자리가 남지 않는다)
let _imageRun = null; // { blocked: Map(모델 → 'zero'|'daily'|'credit'|'unavailable'), told, kind, svg, left, slides }
const IMAGE_BLOCK_NOTICE = '그림 모델을 더 쓸 수 없어 남은 그림은 건너뜁니다. 그림 자리는 그대로 둡니다.';
const IMAGE_BLOCK_NOTICE_SEARCH = '그림 모델을 더 쓸 수 없어 남은 교안 그림은 검색으로만 찾습니다. 못 찾은 자리는 그대로 둡니다.'; // 검색 키가 있을 때
// 막힌 까닭(cause)과 다시 해 볼 때(then). then 뒤에 남긴 곳에 맞는 할 일을 붙인다(imageRunNote)
const IMAGE_BLOCK_ADVICE = {
    zero: { cause: "이 키로는 고른 그림 모델을 쓸 수 없습니다(사용 한도 0). 설정의 이미지 생성 모델에서 'SVG 삽화'를 고르면 글 모델이 그림을 그립니다.", then: '그다음' },
    daily: { cause: '오늘 쓸 수 있는 그림 모델 사용량을 다 썼습니다.', then: '내일' },
    credit: { cause: '그림 모델의 잔액(크레딧)이 모자랍니다.', then: '충전한 뒤' },
    unavailable: { cause: '고른 그림 모델을 이 키로 쓸 수 없습니다.', then: '설정의 이미지 생성 모델을 바꾼 뒤' },
    svg: { cause: '글 모델의 사용 한도나 키 문제로 SVG 삽화를 그리지 못했습니다.', then: '설정의 키와 모델을 확인하거나 한도가 풀린 뒤' }
};
// 교안 그림 자리는 태그로 남아 일괄 작업이 채운다. 슬라이드 그림은 교안에 자리가 없어 슬라이드 스튜디오나 교수안 다시 만들기로 채운다
const IMAGE_FILL_LATER = "'일괄 이미지 찾기'(차시)나 '콘텐츠 정리'(교과 전체)로 채우세요.";
const SLIDE_IMAGES_LATER = '슬라이드 스튜디오에서 빈 이미지 칸에 AI 그림을 넣거나 교수안을 다시 만드세요.';

// 작업을 시작할 때 연다. 이미 열려 있으면 그대로 두고 false. true를 받은 쪽만 끝날 때(finally) endImageRun을 부른다
window.beginImageRun = function () {
    if (_imageRun) return false;
    _imageRun = { blocked: new Map(), told: false, kind: '', svg: false, left: 0, slides: 0 };
    return true;
};
window.endImageRun = function () { _imageRun = null; };

// 그림 모델이 막혀 만들지 못한 교수안 슬라이드 그림 수를 적는다(gyosuan-images.js). 작업 밖이면 적지 않는다
window.noteSlideImagesLeft = function (count) {
    if (_imageRun && count > 0) _imageRun.slides += count;
};

// 작업이 끝날 때 한 번 보일 안내: 남긴 곳(교안 그림 자리·슬라이드 그림), 막힌 까닭, 남긴 곳에 맞는 할 일. 그림 모델이 모두 막히지 않았으면 ''
window.imageRunNote = function () {
    if (!_imageRun?.told) return '';
    const { left, slides } = _imageRun;
    const advice = _imageRun.svg ? IMAGE_BLOCK_ADVICE.svg : (IMAGE_BLOCK_ADVICE[_imageRun.kind] || IMAGE_BLOCK_ADVICE.unavailable);
    const where = [left ? `그림 자리 ${left}개는 그림 없이 남겼습니다.` : '', slides ? `교수안 슬라이드 그림 ${slides}장은 만들지 못했습니다.` : ''];
    const todo = [left ? IMAGE_FILL_LATER : '', slides ? `${left ? '슬라이드 그림은 ' : ''}${SLIDE_IMAGES_LATER}` : ''].filter(Boolean).join(' ');
    return [...where, advice.cause, todo ? `${advice.then} ${todo}` : ''].filter(Boolean).join(' ');
};

// 그림 모델 오류 가운데 이번 작업 동안 다시 불러도 안 되는 것: 사용 한도(한도 0·하루)·잔액·권한·없는 모델
function imageBlockKind(err) {
    if (err?.quota) return err.quota; // 'zero' · 'daily' (ai-errors.js)
    if (err?.status === 402) return 'credit';
    if ([401, 403, 404].includes(err?.status)) return 'unavailable';
    return '';
}

// 그런 오류면 이번 작업 동안 그 모델을 건너뛰게 적어 둔다. 적었으면 true (course-art.js의 SVG 삽화도 부른다)
function markImageBlocked(model, err) {
    const kind = imageBlockKind(err);
    if (!kind || !_imageRun) return false;
    _imageRun.blocked.set(model, kind);
    return true;
}
window.markImageBlocked = markImageBlocked;

// 그림을 그려 볼 모델 순서(generateImageAPI와 예고가 같이 쓴다): SVG 삽화면 글 모델 하나,
// 아니면 고른 Higgsfield 모델 → (Gemini 키가 있으면) 고른 Gemini 모델 → 나머지 Gemini 그림 모델
function imageModelChain() {
    if (typeof usesSvgIllustration === 'function' && usesSvgIllustration()) return [SVG_IMAGE_MODEL];
    const higgsfield = isHiggsfieldModel(IMAGE_MODEL) ? [IMAGE_MODEL] : [];
    if (higgsfield.length && !apiKey) return higgsfield;
    const gemini = [...new Set([IMAGE_MODEL, ...IMAGE_MODEL_OPTIONS.map(o => o.value)])].filter(model => model !== SVG_IMAGE_MODEL && !isHiggsfieldModel(model));
    return [...higgsfield, ...gemini];
}

// 이번 작업에서 그려 볼 그림 모델이 모두 막혔는지. 작업 밖이거나 막힌 모델이 없으면 바로 false(설정 함수를 부르지 않는다)
function imageGenerationBlocked() {
    if (!_imageRun?.blocked.size) return false;
    const chain = imageModelChain();
    return chain.length > 0 && chain.every(model => _imageRun.blocked.has(model));
}
window.imageGenerationBlocked = imageGenerationBlocked;

// 그림 모델 없이 그림을 찾을 수 있는지(Google 검색·Pixabay 키). 그림 모델이 막혀도 검색은 계속한다
function imageSearchReady() {
    const google = !!googleSearchCx && Array.isArray(googleSearchApiKeys) && googleSearchApiKeys.length > 0;
    const pixabay = !!pixabayApiKey && _pixabayRejectedKey !== pixabayApiKey;
    return google || pixabay;
}

// 모두 막힌 것을 이 작업에서 처음 알았을 때 한 번만 알린다
function tellImageBlockOnce() {
    if (!_imageRun || _imageRun.told) return;
    const chain = imageModelChain();
    _imageRun.told = true;
    _imageRun.svg = chain.length === 1 && chain[0] === SVG_IMAGE_MODEL;
    _imageRun.kind = _imageRun.blocked.get(chain[0]) || 'unavailable';
    window.showToast?.(imageSearchReady() ? IMAGE_BLOCK_NOTICE_SEARCH : IMAGE_BLOCK_NOTICE, 'warning');
}

// Gemini 그림 모델 하나에 보낸다(한도·서버 문제면 한 번만 다시). 그림이 없으면 이유를 담은 오류
async function requestImageModel(model, prompt, { signal = null, onRetry = null } = {}) {
    const data = await callGemini(model, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: IMAGE_ASPECT_RATIO, imageSize: IMAGE_SIZE }
        },
        signal, attempts: IMAGE_CALL_ATTEMPTS
    }, onRetry);
    const imgPart = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (imgPart) return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
    const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || '이미지 파트 없음';
    console.warn(`[Image Gen] Gemini ${model} 응답에 이미지 없음 — ${reason}`, data);
    throw new Error(reason);
}

// 성공하면 data URL, 실패하면 null. opts.signal을 주면 중지할 때 AbortError를 던진다(주지 않으면 던지지 않는다)
// opts.onRetry: 그림 모델 호출이 한도·서버·연결 문제로 실패해 다시 보내기 전에({ delayMs, isRateLimit }). 작업 안에서 그림 모델이 모두 막히면 한 번 알리고, 그 뒤로는 부르지 않고 null
async function generateImageAPI(prompt, { signal = null, onRetry = null } = {}) {
    if (signal?.aborted) throw abortError();
    if (imageGenerationBlocked()) return null;
    if (typeof usesSvgIllustration === 'function' && usesSvgIllustration()) {
        const svg = await generateSvgIllustration(prompt, { signal, attempts: IMAGE_CALL_ATTEMPTS });
        if (!svg && imageGenerationBlocked()) tellImageBlockOnce();
        return svg;
    }

    const errorHistory = [];
    // Higgsfield를 골랐으면 먼저 쓰고, 실패하면 Gemini 키가 있을 때만 Gemini 모델로 넘어간다(imageModelChain)
    // (gemini-3.1-flash-image-preview, Imagen 4는 2026년 서비스 종료로 제거)
    for (const model of imageModelChain()) {
        if (_imageRun?.blocked.has(model)) continue;
        try {
            if (!isHiggsfieldModel(model)) return await requestImageModel(model, prompt, { signal, onRetry });
            const started = Date.now();
            _aiCallsWaiting += 1; // 답을 기다리는 AI 호출로 센다(창을 닫기 전에 묻는다). Higgsfield는 callGemini를 거치지 않는다
            const url = await generateHiggsfieldImage(model, prompt, { signal }).finally(() => { _aiCallsWaiting -= 1; });
            window.recordAiTiming?.(model, Date.now() - started); // Higgsfield는 callGemini를 거치지 않아 여기서 잰다
            return url;
        } catch (e) {
            if (e?.name === 'AbortError') throw e;
            markImageBlocked(model, e);
            const msg = e.message || String(e);
            console.error(`[Image Gen] ${model} 에러:`, msg);
            errorHistory.push(isHiggsfieldModel(model) ? msg : `${model}: ${e.status === 404 ? '모델 미지원' : msg.slice(0, 80)}`);
        }
    }
    if (imageGenerationBlocked()) {
        tellImageBlockOnce();
        return null;
    }
    console.error("[Image Gen] 모든 모델 실패:", errorHistory);
    if (window.showToast && errorHistory.length) {
        window.showToast(`⚠️ 이미지 생성 실패 (${errorHistory[0]})`, 'error');
    }
    return null;
}

/* ---------- 그림을 못 만든 자리의 '다시 검색' ---------- */
// 그림을 못 만든 자리(imagePlaceholderHtml) 블록. 안에 div가 없어 처음 만나는 </div>가 그 자리의 끝이다
const IMAGE_PLACEHOLDER_BLOCK = /<div class="image-placeholder"[\s\S]*?<\/div>/g;

// 화면에 보이는 '그림을 못 만든 자리'의 원문 위치(화면 순서). 첫머리 정리(cleanLessonOpening)가 숨기는 자리는 뺀다:
// 자리마다 번호 표시로 바꿔 같은 정리를 돌려 보고 남는 번호만 고른다
function shownPlaceholderBlocks(source) {
    const text = String(source || '');
    const blocks = [...text.matchAll(IMAGE_PLACEHOLDER_BLOCK)].map((match, n) => ({ n, start: match.index, raw: match[0] }));
    if (!blocks.length || typeof cleanLessonOpening !== 'function') return blocks;
    let n = 0;
    const numbered = text.replace(IMAGE_PLACEHOLDER_BLOCK, () => `<div class="image-placeholder" data-slot-n="${n++}"></div>`);
    const shown = new Set([...String(cleanLessonOpening(numbered)).matchAll(/data-slot-n="(\d+)"/g)].map(match => Number(match[1])));
    return blocks.filter(block => shown.has(block.n));
}

// 누른 자리가 원문의 어느 블록인지. 화면의 자리 수와 원문에서 보이는 자리 수가 같을 때만 순서로 짝짓는다. 못 찾으면 null
function locateImagePlaceholder(source, placeholder) {
    const onScreen = [...(document.getElementById('render-view')?.querySelectorAll('.image-placeholder') || [])];
    const blocks = shownPlaceholderBlocks(source);
    const at = onScreen.indexOf(placeholder);
    return at >= 0 && onScreen.length === blocks.length ? blocks[at] : null;
}

// 그림을 못 만든 자리를 새 그림 칸으로 바꿔 저장한다. 그림을 만드는 사이 탭 글이 바뀌어 그 자리를 찾지 못하면 false
// frame: 그림 키를 받아 그림 칸 HTML을 돌려준다(예시 게임 그림은 출처를 적은 칸, game-images.js). 없으면 desc를 설명으로 쓴 보통 칸
async function fillImagePlaceholder(mod, tabId, block, b64, keyword, desc, frame = null) {
    const source = storedTabMarkdown(mod, tabId);
    const unmoved = source.slice(block.start, block.start + block.raw.length) === block.raw;
    const once = source.indexOf(block.raw) === source.lastIndexOf(block.raw); // 옮겨졌으면 한 곳에만 있을 때 그 자리로 본다
    const start = unmoved ? block.start : (once ? source.indexOf(block.raw) : -1);
    if (start < 0) return false;
    const imgId = uniqueLessonImageId(new Set(Object.keys(mod.images || {})));
    mod.images = { ...(mod.images || {}), [imgId]: b64 };
    const html = frame ? frame(imgId) : imageWrapperHtml(imgId, keyword, escapeHtml(desc), escapeHtml(desc.slice(0, 80)));
    setTabMarkdown(mod, tabId, source.slice(0, start) + html + source.slice(start + block.raw.length));
    await saveState();
    if (getEditingModule() === mod && isViewingTab(mod, tabId)) renderEditor(mod);
    return true;
}

window.promptRegenerateImage = function (btn, fallbackKeyword, imgId) {

    // 예시 게임 그림은 AI 그림 요청 창을 열지 않고 인터넷에서 다른 그림을 찾는다(game-images.js)
    if (gameImageTitle(fallbackKeyword) && typeof window.regenerateGamePicture === 'function') return window.regenerateGamePicture(btn, fallbackKeyword, imgId);

    const wrapper = btn.closest('.image-wrapper') || btn.closest('.image-placeholder');

    if (!wrapper || wrapper.querySelector('.prompt-overlay')) return;

    if (wrapper.classList.contains('image-placeholder')) wrapper.style.position = 'relative'; // 입력 창이 그 자리 위에 뜨게(그림 칸은 CSS가 맞춘다)



    const overlay = document.createElement('div');

    overlay.className = 'prompt-overlay absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 z-20 animate-fade-in rounded-lg';

    overlay.onclick = () => overlay.remove();

    overlay.innerHTML = `

                <div class="w-full max-w-[320px] bg-[#1a1a2e] p-4 rounded-xl border border-white/10 shadow-2xl relative" onclick="event.stopPropagation()">

                    <div class="flex justify-between items-center mb-3">

                        <h4 class="text-sm font-bold text-white flex items-center gap-1.5"><i class="ph-fill ph-sparkle text-accent"></i> 이미지 다시 생성</h4>

                        <button class="text-textMuted hover:text-white transition-colors" onclick="this.closest('.prompt-overlay').remove()"><i class="ph-bold ph-x"></i></button>

                    </div>

                    <textarea class="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-white focus:border-accent focus:ring-1 focus:ring-accent outline-none resize-none mb-3 placeholder:text-textMuted" rows="3" placeholder="프롬프트를 입력하세요.\n(입력하지 않으면 주변 문맥을 분석하여 자동 생성됩니다)"></textarea>

                    <div class="flex justify-end gap-2">

                        <button class="px-3 py-1.5 text-xs font-bold text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors" onclick="this.closest('.prompt-overlay').remove()">취소</button>

                        <button class="px-3 py-1.5 text-xs font-bold text-white bg-accent hover:bg-accentHover rounded-lg transition-colors" data-regen-submit>생성하기</button>

                    </div>

                </div>

            `;

    // 키워드는 교안에서 온 값이므로 HTML에 끼우지 않고 호출 인자로만 넘긴다
    overlay.querySelector('[data-regen-submit]').onclick = event => window.doRegenerateImage(event.currentTarget, fallbackKeyword, imgId);

    wrapper.appendChild(overlay);

};



function extractContextForImage(imgId) {

    const mod = getEditingModule();

    if (!mod || !mod.content) return `${courseFieldLabel('교육')} 관련 이미지`;



    const text = mod.content;

    const marker = `local:${imgId}`;

    const idx = text.indexOf(marker);

    if (idx === -1) return `${courseFieldLabel('교육')} 관련 이미지`;



    const start = Math.max(0, idx - 300);

    const end = Math.min(text.length, idx + marker.length + 300);

    let context = text.substring(start, end)

        .replace(/local:img_[0-9]+/g, '')

        .replace(/<!--.*?-->/g, '')

        .replace(/[#*`_>]/g, '')

        .trim();



    return context || `${courseFieldLabel('교육')} 관련 이미지`;

}



// 그림 칸의 '다시 찾기'는 그 그림을 바꾸고, 그림을 못 만든 자리의 '다시 검색'은 그 자리를 새 그림 칸으로 바꾼다.
// 만드는 동안 다른 차시·탭으로 옮겨도 누른 차시에 넣는다. 넣을 곳을 원문에서 찾지 못하면 만들지 않는다(비용만 든다)
window.doRegenerateImage = async function (submitBtn, fallbackKeyword, imgId) {
    const overlay = submitBtn.closest('.prompt-overlay');
    const wrapper = overlay.closest('.image-wrapper');
    const placeholder = wrapper ? null : overlay.closest('.image-placeholder');
    const mod = getEditingModule();
    const tabId = currentLessonTab;
    const slot = placeholder && mod ? locateImagePlaceholder(storedTabMarkdown(mod, tabId), placeholder) : null;
    if (!mod || (wrapper ? !imgId : !slot)) {
        overlay.remove();
        return window.showAlert("이 그림 자리를 교안 원문에서 찾지 못했습니다. 도구 → 원문 전체 수정에서 그 자리를 지운 뒤 '이미지 삽입'으로 그림을 넣어 주세요.");
    }
    // 그림을 못 만든 자리의 설명('이미지 영역: …')은 새 그림의 설명과 기본 요청에 쓴다
    const desc = slot ? ((placeholder.querySelector('span')?.textContent || '').replace(/^이미지 (?:영역|확보 실패):\s*/, '').trim() || fallbackKeyword) : '';
    const textarea = overlay.querySelector('textarea');
    let prompt = textarea.value.trim();
    if (!prompt) {
        const context = slot ? desc : extractContextForImage(imgId);
        prompt = `다음 문맥에 어울리는 이미지: ${context} (주요 키워드: ${fallbackKeyword})`;
    }

    overlay.innerHTML = `

                <div class="flex flex-col items-center justify-center h-full">

                    <div class="spinner spinner-large mb-4"></div>

                    <p class="text-sm text-white font-bold animate-pulse drop-shadow-md">새로운 이미지를 생성 중입니다...</p>

                    <p class="text-xs text-textLight/60 mt-2 max-w-[280px] text-center truncate px-4" title="${escapeHtml(prompt)}">프롬프트: ${escapeHtml(prompt)}</p>

                </div>

            `;



    try {
        const newB64 = await generateImageAPI(withLessonImageStyle(prompt));
        if (!newB64) {
            window.showAlert('이미지 생성에 실패했습니다.');
        } else if (slot) {
            if (!(await fillImagePlaceholder(mod, tabId, slot, newB64, fallbackKeyword, desc))) window.showAlert('그림을 만드는 동안 탭 글이 바뀌어 그 자리를 찾지 못했습니다. 다시 눌러 주세요.');
        } else {
            mod.images = { ...(mod.images || {}), [imgId]: newB64 };
            saveState().then(() => {
                const imgEl = wrapper.querySelector('img');
                if (imgEl) imgEl.src = newB64;
            });
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
    ['topic', 'reference'].forEach(t => {
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
        btn.className = 'tone-btn px-1.5 py-0.5 text-[0.6875rem] font-bold rounded border transition-colors ' +
            (isActive ? 'bg-accent/20 text-accent border-accent/40' : 'bg-white/5 text-textMuted border-white/10');
    });
}

// ─── v5.9 포팅: 참고자료 URL 관리 ───
function addReferenceUrl() {
    const input = document.getElementById('reference-url-input');
    const url = (input?.value || '').trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) return window.showAlert('https:// 로 시작하는 웹 주소만 넣을 수 있습니다.');
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return window.showAlert('교과를 먼저 선택해주세요.');
    if (subj.referenceUrls.some(r => r.url === url)) return window.showAlert('이미 등록된 URL입니다.');
    if (subj.referenceUrls.length >= 999) return window.showAlert('참고 URL은 최대 999개까지 등록 가능합니다.');

    // NotebookLM URL 감지 → 노트북 이름 입력 다이얼로그
    let isNotebookLM = false;
    try { isNotebookLM = new URL(url).hostname.includes('notebooklm'); } catch (e) {}

    if (isNotebookLM) {
        // 노트북 이름은 앱의 입력 창으로 받는다(브라우저 기본 입력 창은 Electron에서 뜨지 않는다)
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
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) doConfirm(); if (e.key === 'Escape') overlay.remove(); });
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
        `<div class="flex items-center gap-1 py-0.5 text-[0.6875rem]">
            <a href="${/^https?:\/\//i.test(String(r.url)) ? escapeHtml(r.url) : '#'}" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline truncate flex-1" title="${escapeHtml(r.url)}">${escapeHtml(r.title || r.url)}</a>
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
    saveStateSoon(); // 글자마다 저장하지 않고 입력이 멈춘 뒤 한 번(state.js). 칸을 벗어나면 바로
}

function updateReferenceStatus() {
    const badge = document.getElementById('reference-status-badge');
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!badge || !subj) return;
    const urls = subj.referenceUrls.length;
    const textLen = (subj.referenceText || '').length;
    if (urls === 0 && textLen === 0) {
        badge.textContent = '미등록';
        badge.className = 'text-[0.6875rem] px-1.5 py-0.5 rounded bg-white/5 text-textMuted';
    } else {
        const parts = [];
        if (urls > 0) parts.push('링크 ' + urls + '개');
        if (textLen > 0) parts.push('텍스트 ' + textLen + '자');
        badge.textContent = parts.join(' + ');
        badge.className = 'text-[0.6875rem] px-1.5 py-0.5 rounded bg-accent/15 text-accent';
    }
}

// 참고 파일의 글자를 뽑아 참고 텍스트 칸 끝에 붙인다(예전 일괄 생성 창의 파일 올리기를 옮겼다).
// 그림과 스캔 PDF는 AI가 글자를 옮겨 적는다(course-refs.js). 칸은 목차에 앞 4,000자, 교안에 앞 8,000자가 쓰인다
// 큰 파일도 받는다: 글 파일(MD·TXT)은 크기와 상관없이 넣을 만큼 앞부분만 읽고, PDF·PPTX는 넣을 만큼 모이면 멈추고, 큰 그림은 줄여 보낸다.
// PDF·PPTX·DOCX는 파일 전체를 메모리에 올려 읽으므로 상한을 둔다. 칸에는 파일마다 앞 REFERENCE_KEEP_CHARS자까지만 넣는다(칸이 느려지지 않게)
const REFERENCE_FILE_MAX_BYTES = 512 * 1024 * 1024;
const REFERENCE_IMAGE_MAX_BYTES = 64 * 1024 * 1024; // 그림은 줄이려고 화소로 풀어야 해서 따로 둔다
const REFERENCE_SENT_CHARS = 8000;
const REFERENCE_KEEP_CHARS = 100000;

async function readReferenceFile(file) {
    const lower = String(file.name || '').toLowerCase();
    const textFile = lower.endsWith('.md') || lower.endsWith('.txt');
    const max = REF_IMAGE_EXTENSIONS.some(extension => lower.endsWith(extension)) ? REFERENCE_IMAGE_MAX_BYTES : REFERENCE_FILE_MAX_BYTES;
    if (!textFile && file.size > max) throw importStop(`${Math.round(max / (1024 * 1024))}MB가 넘습니다`);
    const text = String(await extractTextFromFile(file, { maxChars: REFERENCE_KEEP_CHARS })).trim();
    if (!text) throw importStop('읽을 글자가 없습니다');
    const kept = text.length > REFERENCE_KEEP_CHARS ? `${text.slice(0, REFERENCE_KEEP_CHARS)}\n...(파일이 길어 앞 ${REFERENCE_KEEP_CHARS.toLocaleString()}자만 넣었습니다)` : text;
    return `[${file.name}]\n${kept}`;
}

async function importReferenceFiles(event) {
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = ''; // 같은 파일을 다시 고를 수 있게
    const textarea = document.getElementById('reference-text-input');
    if (!files.length || !textarea) return;
    const pictures = files.filter(file => /\.(png|jpe?g|webp)$/i.test(file.name)).length;
    const pdfs = files.filter(file => /\.pdf$/i.test(file.name)).length;
    if (pictures || pdfs) {
        const detail = [pictures ? `그림 ${pictures}장은 AI가 글자를 옮겨 적습니다(장마다 1회)` : '', pdfs ? `PDF ${pdfs}개는 글자가 없는 스캔본이면 AI가 읽습니다(파일마다 최대 ${ESTIMATE_RULES.ocrMaxCallsPerPdf}회, 글자가 있는 PDF는 호출 없음)` : ''].filter(Boolean).join('\n');
        if (!(await confirmWithEstimate(detail, { ocr: pictures + pdfs * ESTIMATE_RULES.ocrMaxCallsPerPdf }, { title: '파일에서 글자 가져오기', okLabel: '가져오기' }))) return;
    }
    window.showToast?.(`파일 ${files.length}개의 글자를 읽고 있습니다...`, 'info');
    const added = [];
    const failed = [];
    for (const file of files) {
        try {
            added.push(await readReferenceFile(file));
        } catch (err) {
            logImportFailure(`[참고 파일] 읽지 못해 건너뜁니다(${file.name}):`, err); // 지원하지 않는 형식·글 없음은 경고로, 그 밖은 오류로
            failed.push(`${file.name}: ${err.message}`);
        }
    }
    if (added.length) {
        textarea.value = [textarea.value.trim(), ...added].filter(Boolean).join('\n\n---\n\n');
        onReferenceTextChange();
        flushSaveStateSoon(); // 파일에서 넣은 글은 바로 저장한다
        const over = textarea.value.length > REFERENCE_SENT_CHARS
            ? ` 교안에는 앞 ${REFERENCE_SENT_CHARS.toLocaleString()}자만 보내므로 필요 없는 부분은 지워 주세요.` : '';
        window.showToast?.(`파일 ${added.length}개의 글자를 참고 텍스트에 넣었습니다.${over}`, over ? 'warning' : 'success');
    }
    if (failed.length) window.showAlert(`읽지 못한 파일이 있습니다.\n${failed.join('\n')}`);
}

// 전역 등록 — HTML onclick에서 호출
window.importReferenceFiles = importReferenceFiles;
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

function renderSidebar() {

    const list = document.getElementById('module-list');

    const subj = globalState.subjects.find(s => s.id === currentSubjectId);

    if (!subj) return;

    window.fillMissingLessonNcs?.(subj); // NCS가 없는 차시를 가장 가까운 후보로 채운다
    window.applySidebarSetupState?.(Array.isArray(courseData) ? courseData.length : 0);






    // 교과 정보(파일명 규칙)와 최종 평가(mainQuest). 접어도 최종 평가 상태와 열기 버튼은 머리줄에 남는다
    const mq = subj.mainQuest;
    const questDone = mq?.status === 'done';
    const allLessonsDone = Array.isArray(subj.lessons) && subj.lessons.length > 0 && subj.lessons.every(l => l.status === 'done');
    const questChip = `<span class="px-1.5 py-0.5 rounded ${questDone ? 'bg-yellow-500/20 text-yellow-300' : 'bg-white/10 text-textMuted'}">최종 평가 ${questDone ? '완료' : '대기중'}</span>`;
    const questOpen = `<button onclick="viewModule('mainQuest')" class="shrink-0 text-[0.6875rem] font-bold px-2 py-1 rounded bg-white/10 text-textLight hover:bg-accent transition-colors" title="최종 평가 열기">열기</button>`;
    const infoBody = `
        <div class="mb-3">
            <label class="text-[0.6875rem] font-bold text-textMuted mb-1 flex items-center gap-1"><i class="ph-bold ph-file-code"></i> 파일명 규칙</label>
            <div id="sidebar-filename-convention-ui"></div>
        </div>
        <div class="p-3 rounded-lg border-2 ${questDone ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-white/5 hover:border-white/10 hover:bg-white/5'} flex flex-col cursor-pointer transition-all group module-card" data-id="mainQuest" onclick="viewModule('mainQuest')">
            <div class="flex items-center justify-between mb-1.5">
                <div class="flex items-center gap-1">
                    <i class="ph-fill ph-crown text-sm ${questDone ? 'text-yellow-400' : 'text-accent'}"></i>
                    <span class="text-[0.6875rem] font-bold text-textLight group-hover:text-accent transition-colors">최종 평가</span>
                </div>
                <span class="text-[0.6875rem] font-bold px-1.5 py-0.5 rounded ${questDone ? 'bg-yellow-500/20 text-yellow-300' : 'bg-white/10 text-white/60'}">${questDone ? '완료' : '대기중'}</span>
            </div>
            <h4 class="font-bold text-xs text-white mb-0.5 line-clamp-1">${escapeHtml(mq?.title || '')}</h4>
            <p class="text-xs text-textMuted line-clamp-2">${escapeHtml(mq?.description || '')}</p>
            <div class="mt-2 flex justify-between items-center pt-2 border-t border-white/5">
                <span class="text-[0.6875rem] text-white/60">${allLessonsDone ? '🌟 차시 완료' : '⚠️ 진행 필요'}</span>
                <button onclick="event.stopPropagation(); promptAndGenerateMainQuest()" class="text-[0.6875rem] font-bold px-2 py-1 rounded ${allLessonsDone ? 'bg-accent hover:bg-accentHover' : 'bg-white/10 hover:bg-white/20'} text-white transition-colors" ${!allLessonsDone && !questDone ? 'title="모든 차시를 먼저 생성하는 것을 권장합니다."' : ''}>${questDone ? '다시 만들기' : '만들기'}</button>
            </div>
        </div>`;

    let html = renderSubjectNcsCard(subj) + renderSubjectFlowCard(subj)
        + sidebarSectionHtml('subject-info', { icon: 'ph-sliders-horizontal', title: '교과 정보 · 최종 평가', summaryHtml: questChip, actions: questOpen }, infoBody);

    html += `
                <div class="flex items-center gap-2 mt-4 mb-2 px-1">
                    <i class="ph-fill ph-flag-pennant text-textMuted"></i>
                    <h3 class="text-xs font-bold text-textMuted uppercase tracking-wider flex-1">차시 목록</h3>${renderLessonTrashButton()}
                    <button onclick="deleteAllModules()" class="text-[0.6875rem] font-bold px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors" title="모든 차시 일괄 삭제">
                        <i class="ph-bold ph-trash-simple"></i> 일괄 삭제
                    </button>
                </div>
            `;



    if (!Array.isArray(courseData) || courseData.length === 0) {

        html += `<div class="text-center pt-5 text-textMuted text-sm leading-relaxed">차시가 없습니다.</div>`;

    } else {

        html += renderLessonFilterBar();
        html += courseData.map((mod, idx) => lessonCardHtml(mod, idx)).join('');

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

    applyLessonGrouping();
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

        renderLessonAttachments();

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

    // 생성이 도는 동안에는 차시를 휴지통으로 옮기지 않는다(만드는 중인 차시를 옮기면 만들던 탭이 휴지통 속 차시에 쓰여 화면에서 사라진다, course-meta.js trashRestoreBlocked)
    const busy = () => typeof trashRestoreBlocked === 'function' && trashRestoreBlocked();
    if (busy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');

    showConfirm('이 차시를 휴지통으로 옮길까요?\n30일 안에 차시 목록 위 휴지통에서 되살릴 수 있습니다.', () => {

        if (busy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.'); // 확인 창을 띄운 사이 시작된 생성

        const mod = getEditingModule(id);

        if (mod && mod.content) archiveContent(mod);

        if (mod) moveLessonsToTrash([mod]);
        courseData = courseData.filter(m => String(m.id) !== String(id));

        if (String(currentEditingModuleId) === String(id)) {

            currentEditingModuleId = null;

            document.getElementById('editor-content-area').innerHTML = '<div class="h-full flex items-center justify-center text-textMuted text-sm">차시를 휴지통으로 옮겼습니다.</div>';

            document.getElementById('ai-command-bar').classList.add('hidden'); // 삭제 시 커맨드 바도 숨김 처리

        }

        saveState().then(() => renderSidebar());

    });

}

// 이 교과의 차시를 모두 휴지통으로 옮긴다. keep: 작업 기록에도 남긴다(한 번에 남겨 기록 id가 겹치지 않고 상한 알림도 한 번만 뜬다)
function trashAllLessons(keep) {
    window.saveRawContent?.(); // 고치던 원문을 먼저 그 차시에 넣고 옮긴다
    const lessons = courseData.filter(m => m.id !== 'mainQuest');
    if (keep && typeof archiveContents === 'function') archiveContents(lessons.filter(mod => mod.content || mod.tabContents));
    moveLessonsToTrash(lessons);
    courseData = courseData.filter(m => m.id === 'mainQuest');
    currentEditingModuleId = null;
    document.getElementById('editor-content-area').innerHTML = '<div class="h-full flex items-center justify-center text-textMuted text-sm">모든 차시를 휴지통으로 옮겼습니다.</div>';
    document.getElementById('ai-command-bar').classList.add('hidden');
    saveState().then(() => renderSidebar());
    window.showToast?.(keep ? `${lessons.length}개 차시를 작업 기록에 남기고 휴지통으로 옮겼습니다.` : `${lessons.length}개 차시를 휴지통으로 옮겼습니다.`, 'success');
}

// v7.2: 단원 일괄 삭제. 앱의 창 틀(ui.js openAppDialog)로 띄운다: Esc·바깥 클릭은 취소, Tab은 창 안에서만, 처음 포커스는 취소
window.deleteAllModules = function () {
    if (!courseData || courseData.length === 0) {
        return window.showAlert('삭제할 차시가 없습니다.');
    }
    const count = courseData.filter(m => m.id !== 'mainQuest').length;
    if (count === 0) return window.showAlert('삭제할 차시가 없습니다.');
    // 생성이 도는 동안에는 차시를 휴지통으로 옮기지 않는다(deleteModule과 같다, course-meta.js trashRestoreBlocked)
    const busy = () => typeof trashRestoreBlocked === 'function' && trashRestoreBlocked();
    if (busy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');

    // v7.3: 3버튼 다이얼로그 — 휴지통으로 / 작업 기록에도 남기고 휴지통으로 / 취소
    const overlay = document.createElement('div');
    overlay.id = 'delete-all-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
    overlay.innerHTML = `
        <div data-app-dialog-panel onclick="event.stopPropagation()" style="background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px;max-width:420px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
            <div style="font-size:48px;margin-bottom:16px;" aria-hidden="true">⚠️</div>
            <h3 data-app-dialog-title style="color:#f3f4f6;font-size:18px;font-weight:700;margin-bottom:8px;">차시 일괄 삭제</h3>
            <p data-app-dialog-text style="color:#9ca3af;font-size:14px;margin-bottom:24px;">총 <strong style="color:#f87171;">${count}개</strong> 차시를 휴지통으로 옮깁니다.<br>휴지통(차시 목록 위)에서 30일 동안 되살릴 수 있습니다.</p>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                <button type="button" id="delete-all-confirm" data-delete-all="trash" style="padding:10px 20px;background:#ef4444;color:#fff;font-weight:700;border:none;border-radius:8px;cursor:pointer;font-size:14px;">🗑️ 휴지통으로 옮기기</button>
                <button type="button" id="delete-all-archive" data-delete-all="keep" style="padding:10px 20px;background:#8b5cf6;color:#fff;font-weight:700;border:none;border-radius:8px;cursor:pointer;font-size:14px;">📦 작업 기록에도 남기고 옮기기</button>
                <button type="button" id="delete-all-cancel" data-delete-all="cancel" style="padding:10px 20px;background:rgba(255,255,255,0.1);color:#9ca3af;font-weight:600;border:1px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;font-size:14px;">취소</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const cancelButton = overlay.querySelector('[data-delete-all="cancel"]');
    const dialog = typeof openAppDialog === 'function'
        ? openAppDialog(overlay, { role: 'alertdialog', focus: cancelButton })
        : { tooSoon: () => false, close: () => overlay.remove() };
    if (typeof openAppDialog !== 'function') overlay.onclick = event => { if (event.target === overlay) dialog.close(); };
    // 막 뜬 창의 클릭은 받지 않는다(두 번 누른 클릭의 둘째로 지우지 않게). 창을 띄운 사이 시작된 생성이 있으면 옮기지 않는다
    const choose = keep => () => {
        if (dialog.tooSoon()) return;
        dialog.close();
        if (busy()) return window.showAlert('진행 중인 생성이 끝난 뒤 다시 시도해주세요.');
        trashAllLessons(keep);
    };
    cancelButton.onclick = () => {
        if (!dialog.tooSoon()) dialog.close();
    };
    overlay.querySelector('[data-delete-all="trash"]').onclick = choose(false);
    overlay.querySelector('[data-delete-all="keep"]').onclick = choose(true);
}

window.addModule = function () {

    const newId = Date.now();

    if (!Array.isArray(courseData)) courseData = [];

    courseData.push({ id: newId, title: '새 차시', description: '설명을 입력하세요', status: 'waiting', content: null, images: {}, uploadedMdName: null, uploadedMdContent: null });

    saveState().then(() => {
        renderSidebar();
        window.openLessonMeta?.(newId); // 제목·시간·선행·툴을 바로 정한다
    });

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

// 머리줄의 탭 생성 단추(이 탭 생성·전체 생성). 탭이 없는 최종 평가에는 두지 않는다(새 탭이 본문을 버린다. 최종 평가는 차시 목록의 카드에서 만든다)
// 실습 탭에서는 이 탭 생성 앞에 '실습 시간 N분' 단추를 둔다(course-design.js practiceTimeButtonHtml)
function tabGenerateButtonsHtml(mod, tabless) {
    if (tabless) return '';
    const practice = typeof practiceTimeButtonHtml === 'function' ? practiceTimeButtonHtml(mod, currentLessonTab) : '';
    return `${practice}
                    <button id="lesson-tab-generate" onclick="runTabJob('${mod.id}', currentLessonTab)"
                        class="px-2.5 py-1.5 text-[0.6875rem] font-bold text-accent bg-accent/10 border border-accent/30 rounded hover:bg-accent/20 transition-colors flex items-center gap-1 shrink-0">
                        <i class="ph-bold ph-sparkle"></i> 이 탭 생성
                    </button>
                    <button onclick="startLessonGeneration('${mod.id}')" title="빈 항목을 교안 탭, 교수안·슬라이드, 문제은행 순서로 만들기"
                        class="px-2.5 py-1.5 text-[0.6875rem] font-bold text-white bg-accent rounded hover:bg-accentHover transition-colors flex items-center gap-1 shrink-0 ml-1">
                        <i class="ph-bold ph-lightning"></i> 전체 생성
                    </button>`;
}

// 아직 내용이 없는 탭의 안내와 만들기 단추. 탭이 없는 최종 평가는 탭 대신 최종 평가를 만든다(탭 생성은 본문을 버리고 새 탭을 만든다)
function emptyTabPromptHtml(mod, tabless) {
    const tabLabel = (typeof LESSON_TABS !== 'undefined' && Array.isArray(LESSON_TABS))
        ? ((LESSON_TABS.find(t => t.id === currentLessonTab) || {}).label || '이 탭')
        : '이 탭';
    const title = tabless ? '아직 최종 평가 내용이 없습니다' : `아직 «${tabLabel}» 탭 내용이 없습니다`;
    const hint = tabless ? '아래 버튼을 눌러 AI로 최종 평가를 만드세요.' : `아래 버튼을 눌러 AI로 «${tabLabel}» 탭 교안을 생성하세요.`;
    const action = tabless ? 'promptAndGenerateMainQuest()' : `runTabJob('${mod.id}', currentLessonTab)`;
    const label = tabless ? '최종 평가 만들기' : `«${tabLabel}» 탭 생성하기`;
    // 차시의 학습 탭(기본학습·심화학습)은 낭독 목표 분량까지 채우느라 오래 걸린다(시작 전에 호출 수·시간을 보이고 묻는다, lesson-pipeline.js runTabJob)
    const fills = !tabless && typeof fillsLearnVolume === 'function' && fillsLearnVolume(mod, currentLessonTab);
    const wait = fills
        ? `${tabLabel}은 강사가 소리 내어 읽어도 ${typeof lessonVolumeMinutes === 'function' ? lessonVolumeMinutes(mod, currentLessonTab) : 480}분이 걸리는 분량까지 채우느라 20분 넘게 걸릴 수 있습니다. 시작하기 전에 AI 호출 수와 걸리는 시간을 먼저 보여 드립니다.`
        : '생성에는 수십 초가 걸릴 수 있습니다.';
    // 실습 탭은 만들기 단추 아래에 실습 시간을 보이고 바꿀 수 있게 한다(course-design.js)
    const practice = !tabless && typeof practiceTimeButtonHtml === 'function' ? practiceTimeButtonHtml(mod, currentLessonTab, 'empty') : '';
    return `
            <div class="flex flex-col items-center justify-center text-center py-20 px-6 select-none">
                <div class="w-16 h-16 mb-5 flex items-center justify-center rounded-2xl bg-accent/10 text-accent text-3xl">
                    <i class="ph-bold ph-sparkle"></i>
                </div>
                <h3 class="text-lg font-bold text-gray-800 mb-2">${title}</h3>
                <p class="text-sm text-gray-500 mb-6 leading-relaxed">${hint}<br>${wait}</p>
                <button onclick="${action}"
                    class="px-5 py-2.5 text-sm font-bold text-white bg-accent rounded-lg hover:bg-accentHover transition-colors flex items-center gap-2 shadow-sm hover:-translate-y-0.5">
                    <i class="ph-bold ph-lightning"></i> ${label}
                </button>${practice}
            </div>`;
}

function renderEditor(mod) {

    window.saveRawContent?.(); // 칸을 바꾸기 전에 고치던 원문을 그 칸을 그린 차시·탭에 넣는다(칸을 벗어나기 전에 다시 그려도 잃지 않게)
    // 탭이 없는 최종 평가는 본문 하나다. 기본학습 칸에 본문을 보이고(원문 칸·AI 명령줄·검수가 본문을 읽는다) 탭 생성 단추는 두지 않는다(tabs.js)
    const tabless = typeof isTablessQuest === 'function' && isTablessQuest(mod);
    if (tabless) currentLessonTab = 'basicLearn';

    window.clearAISelection?.(); // 다른 차시·탭에서 기억한 선택으로 고치지 않게

    const area = document.getElementById('editor-content-area');

    const cmdBar = document.getElementById('ai-command-bar');



    // 생성 중에는 빈 차시도 탐색줄을 보여 준다. 교안이 없어도 교수안(기본학습·심화학습)이 있으면 탐색줄을 보인다
    if (!mod.content && !LESSON_TRACKS.some(track => mod[track.field]) && !window.isLessonPipelineRunning(mod.id)) {

        area.innerHTML = `

                    <div class="h-full flex flex-col items-center justify-center text-center animate-fade-in p-8">

                        <i class="ph-duotone ${mod.id === 'mainQuest' ? 'ph-crown text-yellow-400/30' : 'ph-file-dashed text-gray-300'} text-6xl mb-4"></i>

                        <h2 class="text-xl font-bold text-gray-800 mb-2">${escapeHtml(mod.title)}</h2>

                        <p class="text-gray-500 text-sm mb-6">아직 교안 내용이 생성되지 않았습니다.</p>

                        <button onclick="${mod.id === 'mainQuest' ? 'promptAndGenerateMainQuest()' : `promptAndGenerateModule(${mod.id})`}" class="px-6 py-2.5 bg-accent hover:bg-accentHover text-white font-bold rounded-lg shadow-lg transition-colors flex items-center gap-2">

                            <i class="ph-bold ph-sparkle"></i> AI 교안 생성 시작하기

                        </button>

                        <button onclick="importGyosuanMdFiles('${mod.id}')" class="mt-3 text-sm font-bold text-gray-500 hover:text-gray-800 transition-colors">완성 교수안·편성안 MD로 만들기</button>
                        <label class="mt-3 text-sm font-bold text-gray-500 hover:text-gray-800 transition-colors cursor-pointer" title="이 차시의 교안 생성에 참고할 파일 (md, txt, pdf, pptx, docx)">
                            <i class="ph-bold ph-paperclip"></i> 참고 파일 붙이기
                            <input type="file" multiple accept=".md,.txt,.pdf,.ppt,.pptx,.docx" class="hidden" onchange="addLessonAttachments(event)">
                        </label>
                        <div id="empty-attach-list" onclick="onLessonAttachmentClick(event)" class="hidden mt-2 flex flex-wrap justify-center gap-1"></div>

                    </div>

                `;

        cmdBar.classList.add('hidden');
        renderLessonAttachments();

        return;

    }



    let renderText = (typeof getActiveTabContent === 'function') ? getActiveTabContent(mod) : mod.content;

    // [이슈#2] 현재 탭에 생성된 내용이 없는지 판별 (심화학습 등 미생성 탭의 빈 화면 방지)
    const _tabEmpty = !renderText || !String(renderText).trim();

    // 안정화: marked.js 로드 실패 시 방어

    let htmlContent = '';
    let drawn = null; // 이 화면에 그린 교안의 글·그림(lessonScreenInput). 보기 모드 전환(toggleEditorMode)이 같은 글·그림이면 다시 그리지 않는다

    // 이 탭을 만들고 있거나 전체 생성이 차례로 채우는 중이면 기다림 안내를 보인다. 다른 탭을 만드는 작업이면 평소 화면을 둔다
    const buildingHere = window.isPipelineStep(currentLessonTab, mod.id);
    if (_tabEmpty && window.isLessonPipelineRunning(mod.id) && (buildingHere || window.lessonPipelineKind() === 'all')) {
        const waitText = buildingHere
            ? '이 탭을 만들고 있습니다. 완성되면 여기에 나타납니다. 그동안 다른 탭과 차시를 볼 수 있습니다.'
            : '이 탭은 전체 생성 순서대로 만들고 있습니다. 완성되면 여기에 나타납니다.';
        htmlContent = `
            <div class="flex flex-col items-center justify-center text-center py-20 px-6 select-none text-gray-500">
                <i class="ph-bold ph-circle-notch animate-spin text-3xl text-accent mb-4"></i>
                <p class="text-sm">${waitText}</p>
            </div>`;
    } else if (_tabEmpty) {

        // [이슈#2] 미생성 탭 빈 화면 방지: 친절한 안내 + 생성 버튼 노출
        htmlContent = emptyTabPromptHtml(mod, tabless);

    } else {

        // 렌더 시 local:그림 id를 저장된 그림으로 바꾸고, 없는 그림 자리(AI가 규칙을 무시하고 낸 local: 링크 포함)는 비운다(내보내기와 같은 규칙, lesson-export.js inlineLessonImages).
        // 그림 키 모양 하나로 찾아 그림 목록에서 꺼내므로(그림 id로 정규식을 만들지 않는다) 이상한 id로 차시가 열리지 않거나 멈추지 않고, img_1이 img_10을 건드리지 않는다.
        // 그림 넣기 → v7.6 공통 마크다운 전처리 → renderLessonHTML과 같은 HTML을 그리되, 큰 그림 데이터는 글 처리 밖에 두고 맨 끝에 넣는다(drawLessonScreen)
        const screenInput = lessonScreenInput(renderText, mod.images);

        try {

            // 교안 렌더 단일 파이프라인 (collapse→marked→reParse→마침표줄바꿈→postprocess)
            htmlContent = drawLessonScreen(screenInput, renderText, mod.images);
            drawn = screenInput;

        } catch (e) {

            // 오류 화면에는 예전처럼 그림을 넣고 전처리한 글을 보인다
            const shownText = preprocessMarkdown(inlineLessonImages(renderText, mod.images));
            htmlContent = `<div class="p-4 bg-red-500/20 border border-red-500 text-red-400 rounded">마크다운 파싱 오류: ${escapeHtml(String(e.message || e))}</div><pre class="text-gray-200 mt-4">${shownText.replace(/</g, '&lt;')}</pre>`;

        }

    }

    // 원문 칸을 채울 저장된 글(tabs.js tabSourceFor). 칸에 넣기 전에 그사이 다른 기능이 이 탭을 바꿨는지 이 글과 견준다(saveRawContent)
    const drawnSource = typeof getActiveTabSource === 'function' ? getActiveTabSource(mod) : (mod.content || '');

    area.innerHTML = `

                <div class="sticky top-0 bg-bgEditor/95 backdrop-blur-sm border-b border-gray-200 z-30 shadow-sm">

                    <div class="p-4 flex justify-between items-center">

                        <h2 class="font-bold text-gray-800 truncate pr-4">${escapeHtml(mod.title)}</h2>

                        <div class="flex items-center gap-2 shrink-0">

                            


                            <div class="w-px h-4 bg-gray-300 mx-1"></div>
${tabGenerateButtonsHtml(mod, tabless)}
                    <button onclick="runConventionCheck('${mod.id}')" class="ml-1 px-2.5 py-1.5 text-[0.6875rem] font-bold bg-rose-50 text-rose-600 border border-rose-200 rounded hover:bg-rose-100 flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap" title="콘텐츠 업무 설계 규칙으로 현재 탭 검사"><i class="ph-bold ph-list-checks"></i> 컨벤션 검수<span id="convention-check-count" class="hidden"></span></button>
                            <details id="lesson-tools-menu" class="relative">
                                <summary class="list-none cursor-pointer px-3 py-1.5 text-xs font-bold bg-gray-50 text-gray-600 border border-gray-200 rounded hover:bg-gray-100 flex items-center gap-1"><i class="ph-bold ph-wrench"></i> 도구</summary>
                                <div class="absolute right-0 mt-1 z-40 p-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg flex flex-col gap-1">
                            <button onclick="toggleEditorMode('edit'); this.closest('details').open = false" id="raw-edit-btn" class="px-3 py-1.5 text-xs font-bold bg-gray-50 text-gray-700 border border-gray-200 rounded hover:bg-gray-100 flex items-center gap-1 transition-colors" title="이 탭의 마크다운 원문 전체를 고칩니다. 단락 하나는 본문을 두 번 눌러 고칩니다"><i class="ph-bold ph-code"></i> 원문 전체 수정</button>
                            <button onclick="generateAllImagesInModule('${mod.id}')" id="img-batch-btn" class="px-3 py-1.5 text-xs font-bold bg-purple-50 text-purple-600 border border-purple-200 rounded hover:bg-purple-100 flex items-center gap-1 transition-colors hover:-translate-y-0.5"><i class="ph-bold ph-image-square"></i> 일괄 이미지 찾기</button>
                            <button onclick="sanitizeAllContent()" id="sanitize-btn" class="px-3 py-1.5 text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 flex items-center gap-1 transition-colors hover:-translate-y-0.5" title="교과의 모든 차시와 최종 평가에서 글 서식을 고치고, 아직 채우지 않은 그림 자리를 채웁니다"><i class="ph-bold ph-sparkle"></i> 콘텐츠 정리</button>
                            ${isQuestionBankTab(currentLessonTab) ? '' : `<button onclick="insertGamePictures('${mod.id}'); this.closest('details').open = false" id="game-picture-btn" class="px-3 py-1.5 text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 flex items-center gap-1 transition-colors" title="이 탭에서 예로 든 실제 게임을 AI가 찾아, 그 게임 그림을 위키백과에서 찾아 넣습니다(출처를 함께 적습니다). 위키백과에서 못 찾으면 검색 키가 있을 때 웹 검색으로 찾고, 그 그림에는 이용 조건 확인 필요라고 적습니다"><i class="ph-bold ph-game-controller"></i> 예시 게임 그림 넣기</button>`}
                            <button onclick="startCodeComments('lesson'); this.closest('details').open = false" id="code-comment-btn" class="px-3 py-1.5 text-xs font-bold bg-cyan-50 text-cyan-700 border border-cyan-200 rounded hover:bg-cyan-100 flex items-center gap-1 transition-colors" title="이 차시의 모든 탭에서 주석이 모자란 코드 블록에 AI가 주석만 더합니다. 코드 줄은 한 글자도 바꾸지 않고, 바꾸기 전 글은 작업 기록에 남깁니다"><i class="ph-bold ph-chat-text"></i> 코드 주석 넣기</button>
                            <label class="cursor-pointer px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100 flex items-center gap-1 transition-colors" title="에디터에 이미지 삽입">
                                <i class="ph-bold ph-image"></i> 이미지 삽입
                                <input type="file" accept="image/*" class="hidden" multiple onchange="handleImageInputSelect(event)">
                            </label>
                            <button onclick="downloadImagesAsJPG('${mod.id}')" class="px-3 py-1.5 text-xs font-bold bg-teal-50 text-teal-600 border border-teal-200 rounded hover:bg-teal-100 flex items-center gap-1 transition-colors" title="이미지 JPG 다운로드">
                                <i class="ph-bold ph-download-simple"></i> 이미지 저장
                            </button>
                            <button onclick="insertImageSlot()" class="px-2 py-1 text-xs font-bold rounded border border-gray-200 text-gray-600 hover:text-gray-800 transition-all" title="그림 자리 넣기" aria-label="그림 자리 넣기">🖼️</button>
                        <button onclick="openSectionLocks('${mod.id}')" class="px-3 py-1.5 text-[0.6875rem] font-bold bg-slate-50 text-slate-600 border border-slate-200 rounded hover:bg-slate-100 flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap" title="다시 생성해도 유지할 섹션 선택"><i class="ph-bold ph-lock-simple"></i> 섹션 고정</button>
                        <button onclick="openLessonArt('${mod.id}')" class="px-3 py-1.5 text-[0.6875rem] font-bold bg-sky-50 text-sky-600 border border-sky-200 rounded hover:bg-sky-100 flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap" title="SVG 삽화 생성·수정·배치"><i class="ph-bold ph-paint-brush"></i> 삽화</button>
                        <button onclick="copyTabMarkdown('${mod.id}')" class="px-3 py-1.5 text-[0.6875rem] font-bold bg-sky-50 text-sky-600 border border-sky-200 rounded hover:bg-sky-100 flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap" title="현재 탭의 마크다운을 클립보드에 복사"><i class="ph-bold ph-copy"></i> 복사</button>
                        <button onclick="openWhiteboardStudio('${mod.id}')" class="px-3 py-1.5 text-[0.6875rem] font-bold bg-indigo-50 text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-100 flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap" title="이 차시 교안을 화이트보드 교안 스튜디오로 넘겨 나레이션이 있는 판서 영상 만들기 (새 탭)"><i class="ph-bold ph-chalkboard-teacher"></i> 판서 영상</button>
                                </div>
                            </details>

                            <div class="w-px h-4 bg-gray-300 mx-1"></div>



                        </div>

                    </div>

                    <!-- 탐색줄: 위쪽 버튼 줄과 함께 붙어 있게 같은 sticky 안에 둔다(높이가 바뀌어도 틈이 생기지 않는다).
                         탭 단추만 옆으로 밀어 보고, 낭독 분량 표시(분량 채우기)는 밀지 않아도 늘 오른쪽 끝에 보인다.
                         밀 수 있으면 아래 막대가 보이고 마우스 휠로도 민다(index.html .lesson-nav-scroll, tabs.js lessonNavWheel) -->
                    <div class="flex items-center gap-0.5 px-4 py-1 bg-white border-t border-gray-200">
                        <div class="lesson-nav-scroll flex-1 min-w-0 overflow-x-auto">
                            <div id="lesson-nav-items" class="flex items-center gap-0.5 w-max">${renderTabBar(mod)}</div>
                        </div>
                        <span id="lesson-volume-chip" class="hidden"></span>
                    </div>

                </div>

                <div class="max-w-[800px] mx-auto p-8 pb-32">

                    <div id="lesson-edit-hint" class="${window.lessonEditHintHidden?.() ? 'hidden ' : ''}mb-5 flex items-start gap-2 px-3 py-2 text-xs leading-relaxed text-gray-600 bg-violet-50 border border-violet-100 rounded-lg">
                        <i class="ph-bold ph-cursor-text text-violet-500 text-sm mt-0.5 shrink-0" aria-hidden="true"></i>
                        <span class="flex-1">단락을 <strong>두 번 누르면</strong> 바로 고칩니다 · 글자를 <strong>끌어 고르면</strong> 서식 막대와 AI로 수정이 나옵니다 · <strong>아래 칸</strong>에 요청을 쓰면 AI가 고른 부분이나 이 탭 전체를 고칩니다</span>
                        <button type="button" onclick="hideLessonEditHint()" aria-label="이 안내 닫기" title="닫으면 다시 보이지 않습니다" class="shrink-0 text-gray-400 hover:text-gray-700"><i class="ph-bold ph-x"></i></button>
                    </div>

                    <div id="lesson-inline-panel"></div>
                    <div id="gyosuan-view" class="gyosuan-view hidden"></div>

                    <div id="render-view" class="markdown-body animate-fade-in">${htmlContent}</div>

                    <textarea id="raw-view" data-module-id="${escapeHtml(String(mod.id))}" data-subject-id="${escapeHtml(String(lessonSubjectIdOf(mod)))}" data-tab-id="${currentLessonTab}" class="hidden w-full h-[600px] p-6 font-mono text-sm bg-gray-900 text-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-accent resize-y" spellcheck="false" onchange="saveRawContent()">${escapeHtml(drawnSource)}</textarea>

                </div>

                <!-- v7.5: 슬라이드 뷰 영역 (기본 노출, 빈 상태) -->
                <div id="slide-view-panel" class="hidden border-t-2 border-indigo-500/30 bg-gradient-to-b from-gray-50 to-white">
                    <div id="slide-track-switch" class="px-6 pt-3"></div>
                    <div class="flex items-center justify-between px-6 py-3 bg-indigo-50/50 border-b border-indigo-200/50">
                        <div class="flex items-center gap-2">
                            <i class="ph-bold ph-presentation-chart text-indigo-500"></i>
                            <span id="slide-panel-title" class="text-sm font-bold text-indigo-700">슬라이드 미리보기</span>
                            <span id="slide-status-badge" class="text-[0.6875rem] px-2 py-0.5 rounded-full bg-gray-200 text-gray-500 font-bold">미생성</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="generateSlideView('${mod.id}')" id="slide-generate-btn"
                                class="px-3 py-1.5 text-xs font-bold text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-1">
                                <i class="ph-bold ph-sparkle"></i> <span id="slide-generate-label">슬라이드 생성</span>
                            </button>
                            <button onclick="regenerateSlideView('${mod.id}')" id="slide-regen-btn"
                                class="hidden px-3 py-1.5 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors items-center gap-1">
                                <i class="ph-bold ph-arrow-clockwise"></i> 재생성
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

    const drawnRaw = document.getElementById('raw-view');
    if (drawnRaw) drawnRaw.storedFrom = drawnSource; // 칸이 보이는 글(defaultValue)은 줄바꿈을 바꿔 담으므로 저장된 글을 따로 적어 둔다

    cmdBar.classList.remove('hidden');
    window.enhanceRawView?.();
    window.syncReviewBadge?.(mod);
    // 위에서 #render-view에 넣은 교안을 보기 모드 전환이 같은 글·그림으로 다시 그리지 않게 알린다(바로 다음 호출에서만 쓴다)
    drawnLessonScreen = drawn && { input: drawn, view: document.getElementById('render-view') };
    toggleEditorMode('view');
    drawnLessonScreen = null;
    applyLessonPanel(mod);
    syncSlidePanel(mod);

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

// 두 번 누르면 그 단락만 원문 편집 상자로 연다(paragraph-edit.js). 화면 블록과 원문 블록은 글자로 짝짓는다
function handleInlineEditDblClick(e) {
    window.openParagraphEditor?.(e);
}


// ── 교안 다이어그램(mermaid) 그리기 ─────────────────────────
// 그린 SVG는 다이어그램 코드(정리한 뒤)로 기억한다. 같은 코드는 mermaid로 다시 그리지 않고 기억한 SVG를 넣는다(탭을 오가거나 패널을 여닫거나 단락을 고쳐 화면을 다시 그려도).
// mermaid 설정은 index.html에서 한 번 정한다. 설정을 바꾸는 코드는 lessonDiagramSvgs도 비운다
//  - SVG 안의 스타일·화살표는 그 SVG의 id를 가리킨다. 기억한 SVG의 id가 이미 화면에 있으면(한 화면에 같은 코드가 둘) 새 id로 다시 그린다. id 번호는 이 창에서 겹치지 않는다
//  - #render-view에 교안을 넣을 때마다(toggleEditorMode) 새 차례로 그리고 앞 차례는 멈춘다. 떨어져 나간 화면(탭을 바꿨다)이나 가린 화면(원문 수정·슬라이드·문제은행·교수안)에는 그리지 않는다.
//    가린 화면을 다시 보일 때는 renderEditor·toggleEditorMode('view')가 교안을 다시 넣고 새 차례로 그린다
//  - mermaid로 새로 그리기 전마다 한 번 쉰다(setTimeout). 그사이 누른 탭 바꾸기를 먼저 처리해 앞 차례를 멈출 수 있게
const LESSON_DIAGRAM_DELAY = 200; // 교안을 넣은 뒤 그리기 시작까지(ms)
const LESSON_DIAGRAM_CACHE_SIZE = 300; // 기억할 SVG 수(오래 쓰지 않은 것부터 잊는다)
const LESSON_DIAGRAM_CACHE_CHARS = 8000000; // 기억한 SVG 글자 수 합의 상한
const LESSON_DIAGRAM_SVG_MAX = 800000; // 이보다 큰 SVG는 기억하지 않는다(다른 기억을 밀어내지 않게)
let lessonDiagramSvgs = []; // { code, id, svg }. 최근에 쓴 것이 앞
let lessonDiagramPass = 0; // 다이어그램 그리기 차례
let lessonDiagramSeq = 0; // 그린 SVG의 id 번호

// 원문 수정·슬라이드·문제은행(hidden)이나 교수안(gyosuan-covered)이 화면을 가렸는가
const lessonViewCovered = view => view.classList.contains('hidden') || view.classList.contains('gyosuan-covered');

// 그린 SVG를 기억한다(최근 것을 앞에, 정한 수와 글자 수 합까지)
function rememberLessonDiagram(code, id, svg) {
    if (svg.length > LESSON_DIAGRAM_SVG_MAX) return;
    const list = [{ code, id, svg }, ...lessonDiagramSvgs.filter(item => item.code !== code)].slice(0, LESSON_DIAGRAM_CACHE_SIZE);
    let chars = 0;
    const over = list.findIndex(item => (chars += item.svg.length) > LESSON_DIAGRAM_CACHE_CHARS);
    lessonDiagramSvgs = over === -1 ? list : list.slice(0, over);
}

// 다이어그램 코드. textContent에 HTML 태그가 흘러들어와 있을 수 있어 텍스트만 다시 고르고(innerText는 가시성 영향, textContent 사용)
// 안전망 1: HTML 태그·엔티티 완전 제거(렌더 직전 최후 방어선), 안전망 2: sanitizeMermaidCode(괄호·노드 라벨 등 전체 정리)
function lessonDiagramCode(el) {
    const code = (el.textContent || '').trim()
        .replace(/<\/?[a-zA-Z][^>]*>/g, '')
        .replace(/&lt;|&gt;|&amp;|&quot;|&#39;|&apos;/g, (m) => ({
            '&lt;': '', '&gt;': '', '&amp;': '&', '&quot;': "'", '&#39;': "'", '&apos;': "'"
        }[m] || ''))
        .trim();
    return typeof sanitizeMermaidCode === 'function' ? sanitizeMermaidCode(code) : code;
}

// mermaid로 그려 넣고 그린 SVG를 기억한다. 넣은 SVG의 id를 돌려준다(그리지 못했으면 null). i: 화면에서 몇 번째 다이어그램인지(알림에 쓴다)
async function renderLessonDiagram(el, code, i) {
    lessonDiagramSeq += 1;
    const id = `mermaid-svg-${Date.now()}-${lessonDiagramSeq}`;
    try {
        const { svg } = await window.mermaid.render(id, code);
        if (typeof svg === 'string') rememberLessonDiagram(code, id, svg);
        el.innerHTML = svg;
        return id;
    } catch (err) {
        // 1차 실패 → 더 aggressive sanitize 후 재시도 (괄호/특수문자 일괄 제거)
        console.warn(`[Mermaid] 다이어그램 ${i + 1} 1차 실패:`, err.message);
        try {
            const stripped = code
                .replace(/\[([^\[\]\n]{1,200})\]/g, (m, inner) => '[' + inner.replace(/[()"\[\]{}]/g, '').trim() + ']')
                .replace(/\{([^{}\n]{1,200})\}/g, (m, inner) => '{' + inner.replace(/[()"\[\]{}]/g, '').trim() + '}')
                .replace(/\|([^|\n]{1,200})\|/g, (m, inner) => '|' + inner.replace(/[()"]/g, '').trim() + '|');
            const { svg } = await window.mermaid.render(id + '_retry', stripped);
            if (typeof svg === 'string') rememberLessonDiagram(code, id + '_retry', svg);
            el.innerHTML = svg;
            return id + '_retry';
        } catch (err2) {
            console.warn(`[Mermaid] 다이어그램 ${i + 1} 최종 실패:`, err2.message);
            el.innerHTML = `<div style="padding:12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#f87171;font-size:13px;">
                                        <strong>⚠️ 다이어그램을 그리지 못했습니다</strong><br>
                                        <code style="font-size:11px;opacity:0.7;">${escapeHtml(err2.message)}</code><br>
                                        <pre style="margin-top:8px;font-size:11px;opacity:0.5;white-space:pre-wrap;">${escapeHtml(code.substring(0, 200))}</pre>
                                    </div>`;
            return null;
        }
    }
}

// renderView에서 아직 SVG로 바뀌지 않은 다이어그램을 하나씩 그린다(하나 실패해도 나머지 계속).
// pass: 이 그리기의 차례. 새 차례가 시작됐거나 화면이 떨어져 나가거나 가려지면 다음 다이어그램 앞에서 멈춘다
async function drawLessonDiagrams(renderView, pass) {
    const live = () => pass === lessonDiagramPass && renderView.isConnected !== false && !lessonViewCovered(renderView);
    if (!live()) return;
    const unrendered = Array.from(renderView.querySelectorAll('.mermaid')).filter(el => !el.querySelector('svg') && el.textContent.trim());
    const placed = new Set(); // 이번 차례에 넣은 SVG id
    for (let i = 0; i < unrendered.length; i++) {
        if (!live()) return;
        const el = unrendered[i];
        const code = lessonDiagramCode(el);
        // 빈 코드면 렌더 스킵 (의미없는 에러 방지)
        if (!code || code.length < 8) {
            el.style.display = 'none';
            continue;
        }
        const kept = lessonDiagramSvgs.find(item => item.code === code);
        if (kept && !placed.has(kept.id) && !document.getElementById(kept.id)) {
            lessonDiagramSvgs = [kept, ...lessonDiagramSvgs.filter(item => item !== kept)];
            placed.add(kept.id);
            el.innerHTML = kept.svg;
            continue;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!live()) return;
        const id = await renderLessonDiagram(el, code, i);
        if (id) placed.add(id);
    }
}

// renderEditor가 방금 #render-view에 넣은 교안 { input: lessonScreenInput, view: #render-view }. renderEditor 안의 toggleEditorMode('view') 한 번만 읽고 비운다
let drawnLessonScreen = null;

window.toggleEditorMode = function (mode) {

    const drawn = drawnLessonScreen;
    drawnLessonScreen = null;

    const renderView = document.getElementById('render-view');

    const rawView = document.getElementById('raw-view');

    const btnView = document.getElementById('toggle-view');

    const btnEdit = document.getElementById('toggle-edit');



    if (!renderView || !rawView) return;



    if (mode === 'edit') {

        renderView.classList.add('hidden');

        rawView.classList.remove('hidden');

        btnEdit?.classList.add('bg-white', 'text-gray-800', 'shadow-sm');

        btnEdit?.classList.remove('text-gray-500');

        btnView?.classList.remove('bg-white', 'text-gray-800', 'shadow-sm');

        btnView?.classList.add('text-gray-500');

        syncGyosuanView();

    } else {

        // 숨기기 전에 고친 원문을 넣는다. 아래에서 이 칸의 글로 화면을 그리므로 넣지 않은 글이 숨은 칸에 남지 않게 한다
        window.saveRawContent?.();

        renderView.classList.remove('hidden');

        rawView.classList.add('hidden');

        btnView?.classList.add('bg-white', 'text-gray-800', 'shadow-sm');

        btnView?.classList.remove('text-gray-500');

        btnEdit?.classList.remove('bg-white', 'text-gray-800', 'shadow-sm');

        btnEdit?.classList.add('text-gray-500');

        syncGyosuanView();
        window.syncLessonPanelView();



        const mod = getEditingModule();

        if (mod && (rawView.value.trim() || getActiveTabContent(mod))) { // 빈 탭은 renderEditor가 그린 안내를 둔다

            // 칸에는 저장된 원문이 있다. 화면에는 첫머리를 정리해 그린다(renderEditor와 같은 모양)
            const renderText = typeof cleanLessonOpening === 'function' ? cleanLessonOpening(rawView.value) : rawView.value;

            // 보기 모드로 돌아올 때도 같은 규칙으로 그림을 넣고 없는 그림 자리는 비우고(lesson-export.js inlineLessonImages), v7.6 마크다운 전처리도 같다(drawLessonScreen)
            const screenInput = lessonScreenInput(renderText, mod.images);

            try {

                // 교안 렌더 단일 파이프라인 (collapse→marked→reParse→마침표줄바꿈→postprocess).
                // renderEditor가 방금 같은 글·그림으로 그려 넣은 화면이면 그대로 둔다(같은 HTML을 다시 그리고 다시 넣지 않는다)
                const same = !!drawn && drawn.view === renderView && sameLessonScreenInput(drawn.input, screenInput);
                if (!same) renderView.innerHTML = drawLessonScreen(screenInput, renderText, mod.images);
                addImageDeleteButtons(renderView, mod); // 그림 틀·붙여 넣은 그림에도 삭제 버튼(마크다운 그림은 렌더러가 단다)
                window.applyWhiteboardVideos?.(mod); // 판서 영상으로 바꾼 그림은 영상으로, 나머지 그림에는 바꾸기 버튼

                // Mermaid 다이어그램: 이 화면을 새 차례로 그린다(앞 차례는 멈춘다). 그린 SVG는 코드로 기억해 다시 쓴다(drawLessonDiagrams)
                if (window.mermaid) {
                    lessonDiagramPass += 1;
                    const pass = lessonDiagramPass;
                    setTimeout(() => {
                        drawLessonDiagrams(renderView, pass).catch(err => console.warn('[Mermaid] 다이어그램을 그리다 멈췄습니다:', err?.message || err));
                    }, LESSON_DIAGRAM_DELAY);
                }

            } catch (e) {

                renderView.innerHTML = `<div class="p-4 bg-red-500/20 border border-red-500 text-red-400 rounded">마크다운 파싱 오류: ${escapeHtml(String(e.message || e))}</div>`;

            }

        }

    }

    window.syncMdToolbar?.();

}



// 차시(최종 평가)가 든 교과 id. 원문 칸에 적어 둔다(pendingRawEdit). 어느 교과에서도 못 찾으면 지금 교과
function lessonSubjectIdOf(mod) {
    const owner = typeof lessonOwnerId === 'function' ? lessonOwnerId(mod, globalState.subjects, currentSubjectId, courseData) : null;
    return owner ?? currentSubjectId ?? '';
}

// 원문 칸을 그린 교과의 그 차시(최종 평가). 그사이 다른 교과를 열었어도 그린 교과에서 찾는다
// (지금 교과의 같은 번호 차시나, 모든 교과가 같은 id인 최종 평가를 덮지 않게). 그 교과나 차시가 없어졌으면 null
function rawViewLesson(rawView) {
    const drawnIn = rawView.dataset.subjectId;
    const moduleId = rawView.dataset.moduleId;
    if (drawnIn === undefined || drawnIn === String(currentSubjectId ?? '')) return getEditingModule(moduleId || undefined) || null;
    return moduleId ? lessonInSubject(drawnIn, moduleId) : null;
}

// 원문 칸(#raw-view)에 아직 넣지 않은 글. { mod, tabId, rawView, value }, 없으면 null.
// 편집기를 그릴 때의 교과·차시·탭에 넣는다(화면이 바뀌는 도중의 change가 다른 탭을 덮어쓰지 않게)
function pendingRawEdit() {
    const rawView = document.getElementById('raw-view');
    if (!rawView) return null;
    const mod = rawViewLesson(rawView);
    if (!mod) return null;
    const tabId = rawView.dataset.tabId || currentLessonTab;
    // 칸이 저장된 글과 같으면 고치지 않은 것이다. 그 글을 칸의 새 기준으로 삼는다
    // (다른 기능이 탭을 바꾸며 칸도 맞췄으면, 그 뒤에 고친 글을 그사이 바뀐 탭으로 잘못 보지 않게)
    const shown = tabSourceFor(mod, tabId);
    if (rawView.value === shown) {
        rawView.storedFrom = shown;
        return null;
    }
    // 그린 뒤(또는 마지막으로 넣은 뒤) 손대지 않은 칸은 넣을 것이 없다. 처음 기준은 칸을 그린 글(defaultValue), 넣은 뒤에는 넣은 글(lastSaved).
    // 그사이 삽화 배치 같은 다른 기능이 탭을 바꿨어도 옛 글로 덮지 않는다
    const base = typeof rawView.lastSaved === 'string' ? rawView.lastSaved : rawView.defaultValue;
    if (typeof base === 'string' && rawView.value === base) return null;
    // 첫머리를 정리한 글과 같아도 고치지 않은 것이다(편집기는 첫머리를 정리해 보여 줄 때도 있다)
    if (rawView.value === cleanLessonOpening(shown)) return null;
    return { mod, tabId, rawView, value: rawView.value };
}

const RAW_UNSAVED_REASON = '넣지 못한 원문';

// 이 탭에는 저장된 글이 없고 다른 탭에만 글이 있다. 그때 기본학습 칸은 다른 탭을 합친 본문을 보인다(tabs.js tabSourceFor)
function rawTabOnlyShowsOthers(mod, tabId) {
    const tabs = mod.tabContents;
    return !!tabs && !tabs[tabId] && LESSON_TABS.some(tab => tabs[tab.id]);
}

// 칸을 채운 저장된 글(storedFrom)이 지금 탭과 다르면 그사이 다른 기능이 탭을 바꿨다. 예전 칸은 견줄 글이 없어 넣는다.
// 탭을 바꾸며 칸도 지금 글로 맞춘 기능(칸의 기준 lastSaved가 지금 글)이면 바뀐 것으로 보지 않는다.
// 이 탭은 비고 다른 탭에만 글이 있으면 덮을 글이 없어 바뀐 것으로 보지 않는다(비운 기본학습이 보이는 합친 본문은 다른 탭만 바뀌어도 달라진다)
function rawBoxIsStale({ mod, tabId, rawView }) {
    const stored = tabSourceFor(mod, tabId);
    if (typeof rawView.storedFrom !== 'string' || rawView.storedFrom === stored) return false;
    if (typeof rawView.lastSaved === 'string' && rawView.lastSaved === stored) return false;
    return !rawTabOnlyShowsOthers(mod, tabId);
}

// 칸을 그린(넣은) 뒤 다른 기능(탭 생성·그림 넣기·작업 기록 되돌리기 등)이 그 탭을 바꿨다. 칸의 옛 글로 덮지 않는다.
// 칸의 글은 작업 기록에 '넣지 못한 원문'으로 남기고(기다리지 않는다) 칸을 저장된 글로 맞춘 뒤 알린다. 빈 칸은 남길 글이 없다
function keepStoredRawTab({ mod, tabId, rawView, value }) {
    const tab = (typeof LESSON_TABS !== 'undefined' && Array.isArray(LESSON_TABS) ? LESSON_TABS : []).find(item => item.id === tabId);
    const place = mod.tabContents ? `${mod.title} · ${tab?.label || '이 탭'}` : mod.title;
    if (value && typeof archiveContent === 'function') {
        Promise.resolve(archiveContent({ title: place, content: value, images: mod.images, tabId, lesson: mod }, RAW_UNSAVED_REASON))
            .catch(err => console.warn('[원문] 넣지 못한 원문을 작업 기록에 남기지 못했습니다:', err));
    }
    const stored = tabSourceFor(mod, tabId);
    rawView.value = stored;
    rawView.lastSaved = rawView.value; // 칸이 담은 글(줄바꿈을 바꿔 담는다)이 기준이다
    rawView.storedFrom = stored;
    const kept = value ? ` 고친 글은 작업 기록에 '${RAW_UNSAVED_REASON}'으로 남겼습니다.` : '';
    window.showToast?.(`'${place}' 내용이 원문 칸을 연 뒤 다른 작업으로 바뀌어, 칸에서 고친 글을 넣지 않았습니다.${kept}`, 'warning');
}

window.saveRawContent = function () {
    const edit = pendingRawEdit();
    if (!edit) return;
    const { mod, tabId, rawView, value } = edit;
    if (rawBoxIsStale(edit)) return keepStoredRawTab(edit); // 칸의 옛 글로 바뀐 탭을 덮지 않는다
    setTabMarkdownKeyed(mod, tabId, value); // 코드 블록에 주석만 더한 글이면 교수안 원고 표시도 맞춘다(tabs.js)
    rawView.lastSaved = value; // 넣은 글이 이 칸의 새 기준이다(손대지 않으면 다시 넣지 않는다)
    rawView.storedFrom = tabSourceFor(mod, tabId);
    // 어디에서도 쓰지 않게 된 그림만 지운다(용량 확보). 교수안·편성안에 붙여 넣은 그림, 삽화·판서 영상이 쓰는 그림은 남긴다(tabs.js)
    if (mod.images) dropUnusedLessonImages(mod);
    saveState();
    if (getEditingModule() !== mod) return; // 다른 교과에서 그린 칸이면 지금 화면의 검수 표시와 미리 보기는 그대로 둔다
    window.syncReviewBadge?.(mod);
    window.refreshMdPreview?.();
};

// 열어 둔(수정 모드) 원문 칸에서 고친 글만 넣는다. 숨은 칸은 다시 그리기 전의 글일 수 있어 넣지 않는다(Ctrl+S·창 닫기·AI 결과)
window.flushVisibleRawView = function () {
    const raw = document.getElementById('raw-view');
    if (raw && !raw.classList.contains('hidden')) window.saveRawContent();
};

// 열어 둔 원문 칸에 넣지 않은 글이 있는가(창을 닫기 전에 묻는다)
window.hasPendingRawEdit = function () {
    const raw = document.getElementById('raw-view');
    return !!raw && !raw.classList.contains('hidden') && !!pendingRawEdit();
};



window.switchAIMode = function (mode) {

    aiCommandMode = mode;

    const btnEdit = document.getElementById('mode-btn-edit');

    const btnImg = document.getElementById('mode-btn-image');

    const input = document.getElementById('ai-command-input');



    if (mode === 'edit') {

        btnEdit.className = 'px-3 py-1.5 text-xs font-bold rounded-md transition-all bg-accent text-white';

        btnImg.className = 'px-3 py-1.5 text-xs font-bold rounded-md transition-all text-gray-400 hover:text-white';

        input.placeholder = AI_COMMAND_EDIT_PLACEHOLDER;

    } else {

        btnImg.className = 'px-3 py-1.5 text-xs font-bold rounded-md transition-all bg-accent text-white';

        btnEdit.className = 'px-3 py-1.5 text-xs font-bold rounded-md transition-all text-gray-400 hover:text-white';

        input.placeholder = '생성할 이미지에 대한 설명을 입력하세요...';

    }

}



const AI_COMMAND_EDIT_PLACEHOLDER = '고칠 내용을 쓰세요 · 고른 글만, 안 고르면 이 탭 전체를 고칩니다';

let aiCommandBusy = false;
// AI에 보낸 명령의 결과를 기다리거나 아직 넣지 않았다(응답을 기다리는 동안, 다른 곳으로 옮겨 묻는 창·바뀐 부분 미리 보기가 떠 있는 동안). 창을 닫으면 그 결과를 잃는다
let aiCommandResultPending = false;

// 창을 닫기 전에 묻는다(ui.js hasUnsavedWork). 탭 전체를 고칠지 묻는 동안처럼 아직 보내지 않았으면 false
window.isAiResultPending = () => aiCommandResultPending;

// 한 번에 하나만 실행한다(한글 Enter·연타로 두 번 부르지 않게). 보기 화면에서 시작했으면 어떻게 끝나든 보기로 돌아온다
window.executeAICommand = async function () {
    if (aiCommandBusy) return;
    aiCommandBusy = true;
    const renderView = document.getElementById('render-view');
    const startedInView = !!renderView && !renderView.classList.contains('hidden');
    const startedOn = aiEditTargetNow();
    try {
        await runAICommand();
    } finally {
        aiCommandBusy = false;
        const raw = document.getElementById('raw-view');
        // 시작한 교과·차시·탭이 그대로일 때만(다른 교과의 같은 번호 차시나 다른 탭이면 그 화면을 건드리지 않는다)
        if (startedInView && sameAiEditTarget(startedOn, aiEditTargetNow()) && raw && !raw.classList.contains('hidden')) {
            window.saveRawContent?.(); // 기다리는 동안 원문 칸에 쓴 글을 잃지 않게
            toggleEditorMode('view');
        }
    }
};

// 글이 펜스 하나로 통째 감싸였는가(data.js fenceStateAfter와 같은 규칙): 첫 줄에 연 코드 블록이 마지막 줄에서 처음 닫히거나,
// 이름표 없는 ```·```markdown으로 열고 마지막 줄에서 닫으며 그 안의 펜스 짝이 맞는다(감싼 글 안에 코드 블록이 든 답)
function wrappedInOneFence(text) {
    const lines = String(text ?? '').trim().split(/\r?\n/);
    const [, lang] = lines[0].match(/^\s*`{3,}\s*([^\s`]*)\s*$/) || [];
    if (lang === undefined || lines.length < 2 || !/^\s*`{3,}\s*$/.test(lines[lines.length - 1])) return false;
    let fence = 0;
    for (let k = 0; k < lines.length; k++) {
        const was = fence;
        fence = fenceStateAfter(fence, lines[k]);
        if (was && !fence) {
            if (k === lines.length - 1) return true;
            break;
        }
    }
    return /^(?:markdown|md)?$/i.test(lang) && !lines.slice(1, -1).reduce(fenceStateAfter, 0);
}

// 고친 글의 앞뒤를 다듬는다. 고른 글이 들여쓴 줄로 시작하면(코드 줄·들여쓴 목록) 첫 줄 들여쓰기는 두고 앞의 빈 줄과 끝 공백만 뗀다(넣을 자리가 그 들여쓰기를 지운다)
const trimEditAnswer = (text, keepIndent) => (keepIndent ? String(text ?? '').replace(/^\s*\n/, '').trimEnd() : String(text ?? '').trim());

// 답을 통째 감싼 바깥 겹(이름표 없는 ```·```markdown·```md로 열고 이름표 없는 펜스로 닫는다)을 벗긴 안쪽 글. 그런 겹이 아니면 null
function outerFenceInner(text, keepIndent = false) {
    const lines = String(text ?? '').trim().split(/\r?\n/);
    if (lines.length < 2 || !/^\s*`{3,}\s*(?:markdown|md)?\s*$/i.test(lines[0]) || !/^\s*`{3,}\s*$/.test(lines[lines.length - 1])) return null;
    return trimEditAnswer(lines.slice(1, -1).join('\n'), keepIndent);
}

// 펜스 하나로 통째 감싼 겹 수: 감싼 글이면 1, 그 바깥이 이름표 없는 ```·```markdown이고 안이 다시 통째 감싼 글이면 겹을 더 센다
function fenceWrapDepth(text) {
    if (!wrappedInOneFence(text)) return 0;
    const inner = outerFenceInner(text);
    return 1 + (inner === null ? 0 : fenceWrapDepth(inner));
}

const fenceLineCount = text => String(text ?? '').split(/\r?\n/).filter(line => /^\s*`{3,}/.test(line)).length;

// 고른 글 고치기(edit) 답의 앞뒤 펜스: 답 전체를 감싼 펜스만 벗긴다. 고른 글도 감싼 코드 블록이면(코드 블록을 골라 주석을 달아 달라고 했다)
// 답이 그 위에 한 겹 더 감쌌을 때만 바깥 한 겹을 벗긴다. 고른 글의 펜스 짝이 맞지 않으면(코드 블록 끝을 걸쳐 골랐다) 이름표 없는 ```·```markdown 감싸개 안의
// 펜스 줄 수가 고른 글과 같을 때만 감싸개로 보고 벗긴다. 코드 블록으로 끝나거나 시작하는 답은 감싼 것이 아니라 그대로 둔다
// (닫는 펜스가 지워져 뒤 섹션까지 코드가 되거나 # 주석 줄이 제목이 되지 않게)
function editAnswerText(answer, selected) {
    const keepIndent = /^[ \t]/.test(String(selected ?? ''));
    const text = trimEditAnswer(answer, keepIndent);
    if (String(selected ?? '').split(/\r?\n/).reduce(fenceStateAfter, 0)) {
        const inner = outerFenceInner(text, keepIndent);
        return inner !== null && fenceLineCount(inner) === fenceLineCount(selected) ? inner : text;
    }
    if (!wrappedInOneFence(text)) return text;
    if (wrappedInOneFence(selected) && fenceWrapDepth(text) <= fenceWrapDepth(selected)) return text;
    return trimEditAnswer(text.split(/\r?\n/).slice(1, -1).join('\n'), keepIndent);
}

// AI 응답의 날 글: 생각 글(thought)을 뺀 글 조각을 이어 붙인 그대로(code-comments-tool.js codeCommentAsk와 같다)
const aiResponseText = data => (data?.candidates?.[0]?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join('');

// 고른 글 고치기의 답을 넣을 글로: 글 정리(extractText) 뒤 감싼 펜스를 벗긴다(editAnswerText).
// 고른 글이 코드 블록 안에서 시작하면(블록 끝을 걸쳐 골랐다) 그 블록의 여는 펜스(openFence)를 답 앞에 붙여 정리해, 정리가 코드 줄을 글로 고치지 않게 한다
// (# 줄 앞 들여쓰기 지우기·목록 줄 들여쓰기·닫는 펜스 앞 빈 줄). 붙인 펜스는 정리한 뒤 뗀다. ~~~ 블록은 정리가 ``` 만 알아 ``` 를 붙인다
function editAnswerFromResponse(data, selected, openFence = '') {
    if (!openFence) return editAnswerText(extractText(data), selected);
    const prefix = openFence.startsWith('~') ? '```' : openFence;
    const answer = editAnswerText(aiResponseText(data), selected);
    const cleaned = extractText({ candidates: [{ content: { parts: [{ text: `${prefix}\n${answer}` }] } }] });
    return cleaned.startsWith(`${prefix}\n`) ? trimEditAnswer(cleaned.slice(prefix.length + 1), /^[ \t]/.test(String(selected ?? ''))) : answer;
}

const lineOfOffset = (text, at) => String(text ?? '').slice(0, at).split('\n').length - 1;

// 그 줄(0부터)을 코드 줄로 품은 코드 블록(code-comments.js codeCommentBlocks, ``` · ~~~. 여는·닫는 펜스 줄은 빼고). 없으면 null
function codeBlockAtLine(text, line) {
    if (typeof codeCommentBlocks !== 'function') return null;
    return codeCommentBlocks(String(text ?? '')).find(item => item.openLine < line && (item.closeLine < 0 || line < item.closeLine)) || null;
}

// 고른 글이 코드 블록 안의 줄뿐인가. 그렇다면 고를 범위를 줄 단위로 넓힌 { block, start, end(줄바꿈 앞), first(고른 첫 줄의 블록 안 줄 번호, 0부터) }, 아니면 null.
// 펜스 줄을 걸쳐 고른 글은 코드 블록 안의 줄이 아니다(editAnswerFromResponse가 다룬다)
function codeEditSpan(text, selStart, selEnd) {
    if (!(selEnd > selStart)) return null;
    const source = String(text ?? '');
    const line = lineOfOffset(source, selStart);
    const block = codeBlockAtLine(source, line);
    if (!block || (block.closeLine >= 0 && lineOfOffset(source, selEnd - 1) >= block.closeLine)) return null;
    const close = source.indexOf('\n', selEnd - 1);
    return { block, start: source.lastIndexOf('\n', selStart - 1) + 1, end: close < 0 ? source.length : close, first: line - block.openLine - 1 };
}

const CODE_FENCE_LINE = /^\s*(?:`{3,}|~{3,})/;

// 코드 블록 안의 줄을 고친 답(data: AI 응답, code: codeEditSpan 결과, doc: 고른 때의 탭 글). 글 정리(extractText)를 거치지 않은 날 글에서 앞뒤 빈 줄과 답을 감싼 펜스만 뗀다.
// extractText는 # 줄 앞 들여쓰기·목록 줄 들여쓰기를 고쳐 코드가 바뀐다. 확인은 블록 전체로 한다(고른 줄이 여러 줄 문자열·블록 주석 안인지는 앞뒤 줄을 봐야 안다):
// 블록 줄 가운데 고른 줄 자리에 답 줄(펜스 들여쓰기는 뗀다)을 넣은 코드가 원래 줄에 주석만 더했으면(code-comments.js codeCommentFitBlock) 원래 줄 그대로에
// 그 주석을 끼운 줄(더한 줄은 펜스 들여쓰기와 문서 줄끝을 붙인다)을 넣고, 아니면 확인 창에 알린다(고쳐 달라고 한 것이 코드일 수 있어 막지는 않는다). { text, note }
function codeEditAnswer(data, code, doc) {
    const { block, start, end, first } = code;
    const lines = aiResponseText(data).replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const mine = String(doc ?? '').slice(start, end).split('\n');
    const wrapped = lines.length >= 2 && CODE_FENCE_LINE.test(lines[0]) && CODE_FENCE_LINE.test(lines[lines.length - 1])
        && !CODE_FENCE_LINE.test(mine[0]) && !CODE_FENCE_LINE.test(mine[mine.length - 1]);
    const body = wrapped ? lines.slice(1, -1) : lines;
    if (!block.lang || typeof codeCommentFitBlock !== 'function' || typeof ccStripIndent !== 'function') return { text: body.join('\n'), note: '' };
    const after = first + mine.length; // 고른 줄 뒤 블록 줄의 시작
    const answer = [...block.lines.slice(0, first), ...body.map(line => ccStripIndent(line, block.indent)), ...block.lines.slice(after)];
    const fit = codeCommentFitBlock(doc, block.index, answer);
    const rest = block.raw.length - after;
    // 고른 줄 앞뒤의 블록 줄은 그대로여야 고른 자리만 바꿔 넣을 수 있다
    const inPlace = fit.ok && fit.lines.slice(0, first).every((line, k) => line === block.raw[k])
        && fit.lines.slice(fit.lines.length - rest).every((line, k) => line === block.raw[after + k]);
    if (inPlace) return { text: fit.lines.slice(first, fit.lines.length - rest).join('\n'), note: '' };
    const reason = fit.ok ? '고른 줄 밖에 주석이 들어갑니다.' : fit.reason;
    return { text: body.join('\n'), note: `AI 답의 코드 줄이 바뀌었거나 주석을 넣을 수 없는 자리입니다(${reason}). 반영하기 전에 바뀐 곳을 확인해 주세요.` };
}

// 고친 글(코드 블록 밖을 고른 답)의 주석이 모자란 코드 블록에는 주석만 더한다(code-comments-tool.js. 문항이면 문항 모드). { text, note(넣은 결과·넣지 못한 블록) }
async function commentedEditAnswer(newText, tabId, quiz) {
    if (typeof addGeneratedCodeComments !== 'function') return { text: newText, note: '' };
    const { md, run } = await addGeneratedCodeComments({ md: newText, tabId, quiz, notify: false });
    return { text: md, note: typeof commentRunNote === 'function' ? commentRunNote(run) : '' };
}

async function runAICommand() {

    const input = document.getElementById('ai-command-input');
    const btn = document.getElementById('ai-command-send');
    const command = input.value.trim();
    if (!command) return;

    const renderView = document.getElementById('render-view');
    const rawView = document.getElementById('raw-view');
    if (!rawView) return;
    // 시작한 교과·차시·탭. 응답이 오면 이 자리가 그대로 열려 있을 때만 바로 넣는다
    const target = aiEditTargetNow();
    if (target.tabId == null) return; // 탭을 보고 있지 않으면(교수안 같은 항목·편집기 밖) 넣을 탭이 없다. 그때 명령줄은 숨어 있다

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
            // 고른 글이 없으면 이 탭 전체를 고친다. 시간과 비용이 크므로 한 번 묻는다. 바뀐 부분은 미리 보고 골라 반영한다(tabs.js)
            const mod = getEditingModule();
            const size = mod ? getActiveTabSource(mod).length : 0;
            const ok = await confirmAsync(`고른 글이 없어 이 탭 전체(약 ${size.toLocaleString()}자)를 AI가 고칩니다.\n몇 분 걸릴 수 있고, 바뀐 부분은 미리 보고 골라 반영합니다.\n\n한 부분만 고치려면 취소한 뒤 본문에서 글을 끌어 고르세요.`, { okLabel: '탭 전체 고치기', tone: 'primary', title: '이 탭 전체를 고칠까요?' });
            if (ok) reinforceCurrentTab(currentEditingModuleId, command); // 진행 막대에서 기다리므로 명령줄을 잡아 두지 않는다
            return;
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
            return window.showAlert('선택한 텍스트를 원문에서 찾지 못했습니다.\n도구 → 원문 전체 수정에서 직접 텍스트를 선택한 뒤 다시 시도해주세요.');
        }
    }

    input.disabled = true;
    btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i>';
    aiCommandResultPending = true; // 여기서 보낸다. 결과를 넣거나 버릴 때까지 창을 닫기 전에 묻는다

    try {
        let result = null;
        if (aiCommandMode === 'edit') {
            if (selStart === selEnd || selStart < 0) throw new Error("수정할 텍스트를 영역 선택해주세요.");

            const text = rawView.value;
            // 코드 블록 안의 줄만 골랐으면 줄 단위로 넓혀 보낸다(줄 가운데부터 바꾸면 들여쓰기가 어긋난다). 답은 글 정리를 거치지 않고 받는다
            const code = codeEditSpan(text, selStart, selEnd);
            if (code) [selStart, selEnd] = [code.start, code.end];
            const selectedText = text.substring(selStart, selEnd);
            const context = text.substring(Math.max(0, selStart - 300), selStart);

            // 문항(문제은행 탭·최종 평가)에서 고른 글이면 주석에 답을 적지 않게 묻는다(code-comments-tool.js isCodeCommentQuiz)
            const editMod = getEditingModule(target.moduleId);
            const quiz = typeof isCodeCommentQuiz === 'function' ? isCodeCommentQuiz(editMod, target.tabId) : isQuestionBankTab(target.tabId);
            const { systemInstruction, userPrompt } = buildTaskContext('edit', { context, selectedText, command, quiz, ...(code ? { inCode: true, codeLang: code.block.label } : {}) });

            const res = await callGemini(TEXT_MODEL, {
                contents: [{ parts: [{ text: userPrompt + lessonAttachmentPrompt(currentEditingModuleId) }] }],
                systemInstruction: { parts: [{ text: systemInstruction }] }
            });

            // 코드 블록 안에서 시작해 블록 끝을 걸쳐 고른 글은 그 블록의 여는 펜스를 붙여 정리한다(editAnswerFromResponse)
            const openFence = code ? '' : codeBlockAtLine(text, lineOfOffset(text, selStart))?.fence || '';
            const edited = code ? codeEditAnswer(res, code, text) : await commentedEditAnswer(editAnswerFromResponse(res, selectedText, openFence), target.tabId, quiz);
            result = { kind: 'edit', target, selStart, selEnd, selectedText, newText: edited.text, note: edited.note };

        } else if (aiCommandMode === 'image') {
            const baseText = rawView.value;
            // 보기 모드에서 진입한 경우 커서가 0이므로 문서 끝에 삽입
            const pos = (isViewMode || rawView.selectionStart === 0) ? baseText.length : rawView.selectionStart;
            const b64 = await generateImageAPI(command);
            if (!b64) return window.showAlert('이미지 생성에 실패했습니다.'); // 그림을 못 만들었으면 완료라고 하지 않는다
            const imgId = 'img_' + Date.now() + Math.floor(Math.random() * 1000);
            // 그림 설명은 자른 뒤에 이스케이프한다(&quot; 같은 표시가 반만 남지 않게. 그림 넣기와 같은 규칙)
            const safeCmd = escapeHtml(String(command).slice(0, 80));
            const imgTag = `\n<div class="image-wrapper"><img src="local:${imgId}" alt="${escapeHtml(command)}" class="rounded-lg border-2 border-accent/30 shadow-md max-w-full"><span class="absolute bottom-3 left-3 bg-black/80 text-white text-[0.6875rem] px-2 py-1 rounded border border-white/20 flex items-center gap-1 pointer-events-none"><i class="ph-fill ph-sparkle text-accent"></i> AI 생성 이미지</span><button class="image-regenerate-btn px-3 py-1.5 text-xs text-white font-bold rounded flex items-center gap-1 border border-accent/50 hover:bg-accent transition-colors" data-lesson-action="regenerate-image" data-keyword="${escapeHtml(command)}" data-img-id="${imgId}"><i class="ph-bold ph-arrows-clockwise"></i> 다시 생성</button><div class="image-caption" style="margin-top:8px;text-align:center;font-size:0.85rem;color:#6b7280;font-style:italic;font-weight:500;letter-spacing:-0.01em;line-height:1.4;max-width:100%;">${safeCmd}</div></div>\n`;
            result = { kind: 'image', target, baseText, pos, imgId, b64, imgTag };
        }

        // 시작한 자리에 넣는다. 넣었을 때만 명령을 지운다(넣지 않았으면 다시 실행할 수 있게 둔다)
        if (result && await deliverAiCommandResult(result)) input.value = '';

    } catch (err) {
        window.showAlert(err.message || '명령 실행 중 오류 발생');
    } finally {
        aiCommandResultPending = false;
        input.disabled = false;
        btn.innerHTML = '✨ 실행';
        input.focus();
    }
}

/* ---------- 아래 AI 명령줄: 시작한 자리에만 넣는다(응답을 기다리는 동안 다른 교과·차시·탭으로 옮길 수 있다) ---------- */
const AI_RESULT_GONE = '넣을 교과나 차시를 찾지 못해 AI 결과를 넣지 못했습니다. 지웠다면 휴지통에서 되살린 뒤 다시 실행해 주세요.';
const AI_RESULT_MOVED = '고칠 글이 그사이 바뀌어 반영하지 못했습니다. 그 부분을 다시 골라 고쳐 주세요.';

// 지금 열린 교과·차시·탭. 편집기 화면이 아니거나 탭 대신 교수안 같은 항목을 보고 있으면 탭은 null
function aiEditTargetNow() {
    const onEditor = /^#editor/.test(window.location?.hash || '');
    return { subjectId: currentSubjectId, moduleId: currentEditingModuleId, tabId: onEditor && !_lessonPanel ? currentLessonTab : null };
}

// 교과 id까지 맞춰 차시를 찾는다(차시 id는 교과 안에서만 겹치지 않는다). 지금 연 교과는 화면의 차시 목록이 최신이다
function lessonInSubject(subjectId, moduleId) {
    if (String(subjectId) === String(currentSubjectId)) return getEditingModule(moduleId) || null;
    const subject = (globalState.subjects || []).find(item => String(item.id) === String(subjectId));
    if (!subject) return null;
    if (String(moduleId) === 'mainQuest') return subject.mainQuest || null;
    return (subject.lessons || []).find(lesson => String(lesson.id) === String(moduleId)) || null;
}

// 확인 창에 보일 자리: 교과 › 차시 › 탭 (최종 평가는 탭 없이). 이름은 한 줄로
function aiResultPlace(target, mod) {
    const subject = (globalState.subjects || []).find(item => String(item.id) === String(target.subjectId));
    const quest = String(mod.id) === 'mainQuest';
    const oneLine = text => String(text || '').replace(/\s+/g, ' ').trim();
    const tab = quest ? '' : (LESSON_TABS.find(item => item.id === target.tabId)?.label || '');
    return [oneLine(subject?.title), quest ? '최종 평가' : (oneLine(mod.title) || '차시'), tab].filter(Boolean).join(' › ');
}

// 시작한 교과·차시·탭을 다시 연다. 같은 교과면 바로, 아니면 주소를 바꿔 편집기를 연다(handleRoute)
function openAiEditTarget(target, mod) {
    window.flushVisibleRawView?.(); // 지금 화면에서 고치던 원문은 그 차시에 먼저 넣는다(손대지 않은 칸은 넣지 않는다)
    currentLessonTab = target.tabId;
    window.clearLessonPanel?.();
    const onEditor = /^#editor/.test(window.location?.hash || '');
    if (onEditor && String(currentSubjectId) === String(target.subjectId)) return window.viewModule(mod.id);
    const route = `#editor/${target.subjectId}/${mod.id}`;
    if (window.location.hash === route && typeof handleRoute === 'function') return handleRoute(); // 주소가 같으면 hashchange가 오지 않는다
    window.location.hash = route;
}

// 시작한 차시·탭의 저장된 글에 넣고 저장한다. 넣었으면 true
async function applyAiCommandResult(result) {
    const { target } = result;
    const mod = lessonInSubject(target.subjectId, target.moduleId);
    if (!mod) {
        window.showAlert(AI_RESULT_GONE);
        return false;
    }
    saveOpenEditsFor(mod, target.tabId); // 그 탭을 원문으로 고치던 중이면 그 글을 먼저 넣는다(tabs.js)
    if (result.kind === 'edit') {
        if (placeAiEdit(storedTabMarkdown(mod, target.tabId), result) === null) {
            window.showAlert(AI_RESULT_MOVED);
            return false;
        }
        if (!(await confirmAiEdit(result.selectedText, result.newText, { note: result.note || '' }))) return false;
    }
    // 미리 보는 동안 다른 작업이 글을 바꿨을 수 있어 넣기 직전의 글로 다시 만든다
    const source = storedTabMarkdown(mod, target.tabId);
    const next = result.kind === 'edit' ? placeAiEdit(source, result) : insertAiImage(source, result);
    if (next === null) {
        window.showAlert(AI_RESULT_MOVED);
        return false;
    }
    if (result.kind === 'image') {
        if (!mod.images || typeof mod.images !== 'object') mod.images = {};
        mod.images[result.imgId] = result.b64;
    }
    setTabMarkdownKeyed(mod, target.tabId, next);
    window.clearAISelection?.();
    const saved = await saveState();
    const raw = document.getElementById('raw-view');
    if (sameAiEditTarget(target, aiEditTargetNow()) && raw && String(raw.dataset.moduleId) === String(mod.id)) {
        window.saveRawContent?.(); // 저장을 기다리는 동안 칸에 쓴 글은 맞추기 전에 넣는다(탭이 바뀌었으므로 작업 기록에 남는다)
        const source = getActiveTabSource(mod);
        raw.value = source; // 숨은 원문 칸도 맞춰 옛 글을 다시 넣지 않게
        raw.lastSaved = raw.value;
        raw.storedFrom = source;
        toggleEditorMode('view');
        window.syncReviewBadge?.(mod);
    }
    if (saved !== false) window.showAlert(result.kind === 'edit' ? '✅ 텍스트 수정 완료!' : '✅ 이미지 삽입 완료!'); // 저장하지 못했으면 saveState가 알렸다
    return true;
}

// 응답을 시작한 자리에 넣는다. 그사이 다른 교과·차시·탭으로 옮겼으면 넣지 않고 묻는다: 돌아가서 반영하거나 버린다
async function deliverAiCommandResult(result) {
    if (!sameAiEditTarget(result.target, aiEditTargetNow())) {
        const mod = lessonInSubject(result.target.subjectId, result.target.moduleId);
        if (!mod) {
            window.showAlert(AI_RESULT_GONE);
            return false;
        }
        const { message, opts } = aiResultAwayDialog(result.kind, aiResultPlace(result.target, mod));
        if (!(await confirmAsync(message, opts))) {
            window.showToast?.('이번 AI 결과를 버렸습니다.', 'info');
            return false;
        }
        openAiEditTarget(result.target, mod);
    }
    return applyAiCommandResult(result);
}

/* ---------- 그림 지우기 (보기 화면의 삭제 버튼) ---------- */
// 지울 그림: 저장된 그림 키(keys)와 원문에서 찾을 그림 주소(refs). 키(img_1이나 local:img_1)를 받으면 그 키만 고른다
// (그 키의 그림 값을 주소로 바로 쓴 자리도 찾는다). 마크다운 그림 버튼은 화면에 풀린 data URL을 넘기므로 그 값으로 키를 되찾는다.
// 값으로 찾는 것은 진짜 그림(data:image/)일 때만이고 같은 값의 키는 모두 고른다. 찾지 못한 그림 자리(teacher-image:…)·빈 값은
// 여러 키가 같은 값일 수 있어 값으로 찾지 않는다(엉뚱한 그림을 지운다)
function lessonImageTargets(mod, imgId) {
    const images = mod?.images && typeof mod.images === 'object' ? mod.images : {};
    const has = key => Object.prototype.hasOwnProperty.call(images, key);
    const isPicture = value => typeof value === 'string' && /^data:image\//.test(value);
    const given = String(imgId ?? '');
    let source = given;
    try {
        source = decodeURIComponent(given);
    } catch (err) {
        console.warn('[그림 지우기] 주소를 읽지 못해 그대로 씁니다:', err.message);
    }
    const named = has(given) ? given : (source.startsWith('local:') ? source.slice('local:'.length) : '');
    if (named) {
        const value = has(named) ? images[named] : '';
        return { keys: has(named) ? [named] : [], refs: [`local:${named}`, ...(isPicture(value) ? [value] : [])] };
    }
    if (!source) return { keys: [], refs: [] };
    const keys = isPicture(source) ? Object.keys(images).filter(key => images[key] === source) : [];
    return { keys, refs: [...keys.map(key => `local:${key}`), source] };
}

// 원문의 그림 자리 세 모양. 정해 둔 모양으로만 찾고 주소는 글자 그대로 견준다(그림 키나 data URL로 정규식을 만들지 않는다).
// 그림 틀: <div class="image-wrapper"><img src="…"> 뒤의 AI 표시(span)·다시 찾기 버튼·그림 설명(image-caption)과 닫는 </div>까지.
// 그 사이 글에 '<'가 있어도 되지만 안쪽 <div나 빈 줄에서 멈춘다(모양이 다른 옛 틀은 맨 <img>만 지운다. 블록을 넘어 지우지 않는다).
// 빈 줄은 \r\n으로 끝나는 줄(윈도에서 만든 MD)도 센다.
// 태그 안을 훑는 자리는 다음 '<'에서도 멈춘다(닫지 않은 <img·![가 아주 많은 글도 글 길이만큼만 훑는다)
const IMAGE_WRAPPER_BLOCK = /<div class="image-wrapper(?:\s[^"<>]*)?"[^<>]*>(?:(?!\n[ \t\r]*\n)\s)*<img\b[^<>]*?\ssrc="([^"]*)"[^<>]*>(?:(?!<div|<\/div>|\n[ \t\r]*\n)[\s\S])*(?:<div class="image-caption"[^<>]*>(?:(?!<div|<\/div>|\n[ \t\r]*\n)[\s\S])*<\/div>(?:(?!<div|<\/div>|\n[ \t\r]*\n)[\s\S])*)?<\/div>/g;
// 붙여 넣은 맨 그림 <img src="…">(src 앞에 다른 속성이 있어도 된다)
const HTML_IMAGE_TAG = /<img\b[^<>]*?\ssrc="([^"]*)"[^<>]*>/g;
// 마크다운 그림 ![설명](주소)
const MD_IMAGE_TAG = /!\[[^\[\]]*\]\(([^()\s]*)\)/g;
const LESSON_IMAGE_SHAPES = [IMAGE_WRAPPER_BLOCK, HTML_IMAGE_TAG, MD_IMAGE_TAG];
const PICTURE_GAP = '\u0000그림\u0000'; // 지운 자리 표시(줄 정리에만 쓰고 남기지 않는다)

// 그림 지우기가 따라가는 코드 펜스: ``` 와 ~~~ (3개 이상, 들여쓰기 허용). 여는 펜스와 같은 글자로 같거나 더 길게 닫는다.
// 언어 칸에 `가 든 ``` 줄(```npm install```)은 인라인 코드다(data.js fenceStateAfter와 같다). 펜스 밖이면 null
function pictureFenceAfter(fence, line) {
    const [, marks, rest] = String(line).match(/^\s*(`{3,}|~{3,})(.*?)\r?$/) || [];
    if (!marks) return fence;
    if (!fence) return marks[0] === '`' && rest.includes('`') ? null : { mark: marks[0], size: marks.length };
    return marks[0] === fence.mark && marks.length >= fence.size && !rest.trim() ? null : fence;
}

// from 뒤에서 `가 꼭 size개 이어진 자리(더 길거나 짧은 `줄은 건너뛴다). 없으면 -1
function backtickRunAt(line, size, from) {
    for (let at = line.indexOf('`', from); at !== -1;) {
        let end = at;
        while (line[end] === '`') end += 1;
        if (end - at === size) return at;
        at = line.indexOf('`', end);
    }
    return -1;
}

// 한 줄 안의 인라인 코드(`…`, 같은 수의 `로 열고 닫는다)를 자리표시로 바꾼다. 닫지 않은 `는 글자다. 바꾼 코드는 codes에 모은다
function maskInlineCode(line, codes) {
    let out = '';
    let from = 0;
    let at = line.indexOf('`');
    while (at !== -1) {
        let end = at;
        while (line[end] === '`') end += 1;
        const close = backtickRunAt(line, end - at, end);
        if (close === -1) {
            at = line.indexOf('`', end);
            continue;
        }
        out += `${line.slice(from, at)}\u0000INLINE${codes.push(line.slice(at, close + end - at)) - 1}\u0000`;
        from = close + end - at;
        at = line.indexOf('`', from);
    }
    return out + line.slice(from);
}

// 코드 블록(``` · ~~~ 펜스)과 인라인 코드(`…`) 밖의 글 덩어리에만 change를 부른다. 코드 예제 속 <img>·![]()는 그림이 아니다. 줄 나눔은 그대로 둔다
function mapPictureProse(md, change) {
    const out = [];
    let prose = [];
    let fence = null;
    const flush = () => {
        if (!prose.length) return;
        const codes = [];
        const masked = prose.map(line => maskInlineCode(line, codes)).join('\n');
        out.push(change(masked).replace(/\u0000INLINE(\d+)\u0000/g, (whole, i) => codes[i] ?? whole));
        prose = [];
    };
    md.split('\n').forEach(line => {
        const next = pictureFenceAfter(fence, line);
        if (fence || next) {
            flush();
            out.push(line);
        } else {
            prose.push(line);
        }
        fence = next;
    });
    flush();
    return out.join('\n');
}

// 지운 자리 정리: 그림만 있던 줄은 빼고, 앞뒤가 모두 빈 줄이면 빈 줄 하나만 남긴다. 글 사이에 있던 그림은 그 자리만 비운다
function tidyPictureGaps(text) {
    const lines = text.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes(PICTURE_GAP)) {
            out.push(line);
            continue;
        }
        const rest = line.split(PICTURE_GAP).join('');
        if (rest.trim()) {
            out.push(rest);
            continue;
        }
        const afterBlank = !out.length || !out[out.length - 1].trim();
        if (afterBlank && i + 1 < lines.length && !lines[i + 1].trim()) i += 1;
    }
    return out.join('\n');
}

// 주소가 refs 가운데 하나와 꼭 같은 그림 자리(그림 틀·맨 <img>·마크다운 그림)를 지운 글과 지운 자리 수.
// local:img_1을 지울 때 local:img_10은 남는다
function removeLessonImages(md, refs) {
    const targets = new Set(refs);
    let count = 0;
    const strip = prose => LESSON_IMAGE_SHAPES.reduce((text, shape) => text.replace(shape, (whole, url) => {
        if (!targets.has(url)) return whole;
        count += 1;
        return PICTURE_GAP;
    }), prose);
    const gapped = mapPictureProse(String(md ?? ''), strip);
    return { text: count ? tidyPictureGaps(gapped) : String(md ?? ''), count };
}

function withoutLessonImages(md, refs) {
    return removeLessonImages(md, refs).text;
}

// AI 작업이 도는 중인지. 다시 만들기·일괄 생성·분량 채우기는 비운 탭에 돌려 넣을 고정 섹션의 그림을 쥐고 있다(그동안은 그림 값을 지우지 않는다).
// 창을 닫기 전에 묻는 AI 작업(course-flow.js isAiWorkRunning: 창을 닫아도 이어지는 삽화 등)도 같이 본다. 있는 표시만 읽는다(lesson-pipeline.js, lesson-volume.js)
function pictureJobRunning() {
    return (typeof generationBusy === 'function' && !!generationBusy())
        || (typeof _lessonRun !== 'undefined' && !!_lessonRun)
        || (typeof isAiWorkRunning === 'function' && !!isAiWorkRunning())
        || !!window.isLessonPipelineRunning?.()
        || !!window.isVolumeFilling?.();
}

// 글이 그 그림 키를 가리키는지. local:img_1 뒤에 키 글자가 더 이어지면(local:img_10) 다른 그림이다
function textUsesImage(text, key) {
    const ref = `local:${key}`;
    for (let at = text.indexOf(ref); at !== -1; at = text.indexOf(ref, at + 1)) {
        if (!/[\w-]/.test(text.charAt(at + ref.length))) return true;
    }
    return false;
}

// 차시 어딘가가 아직 그 그림 키를 쓰는지: 글(합친 본문·탭·교수안·슬라이드)이 그 키를 가리키거나 삽화·판서 영상·움직이는 GIF 기록(원래 그림)이 붙잡고 있다.
// tabs.js unusedLessonImageIds와 같은 곳을 보되 local:img_1과 local:img_10을 가른다
function lessonStillUsesImage(mod, key) {
    const illustrations = Array.isArray(mod.illustrations) ? mod.illustrations.map(item => item?.imgId) : [];
    const motions = mod.imageMotions && typeof mod.imageMotions === 'object' ? Object.values(mod.imageMotions).map(item => item?.still) : [];
    const pinned = [...illustrations, ...Object.keys(mod.whiteboardVideos || {}), ...motions];
    return pinned.some(id => id != null && String(id) === key) || lessonImageRefTexts(mod).some(text => textUsesImage(text, key));
}

// 비운 기본학습 칸에는 다른 탭을 합친 글(content)이 보인다(tabs.js tabSourceFor). 그 글에서 지우면 다른 탭 글이 기본학습에 겹쳐 들어간다.
// 탭이 모두 빈 옛 차시의 본문은 기본학습 글이라 그대로 지운다
function showsOtherTabsText(mod, tabId) {
    return tabId === 'basicLearn' && !!mod.tabContents && !mod.tabContents.basicLearn && LESSON_TABS.some(tab => mod.tabContents[tab.id]);
}

// 지운 뒤의 탭 글과 할 일을 미리 센다(차시는 바꾸지 않는다). 확인 창의 글에 쓰고, 확인한 뒤에 다시 센다.
// busy: AI 작업이 돌아 그림 값·영상 연결을 남긴다 / unlink: 이 탭에서 빼면 어느 글도 쓰지 않게 되는 판서 영상 그림 키 / shared: 다른 탭·교수안·슬라이드에도 있는 그림인지
function deleteImagePlan(mod, tabId, targets) {
    const source = showsOtherTabsText(mod, tabId) ? '' : tabSourceFor(mod, tabId);
    const { text, count } = removeLessonImages(source, targets.refs);
    const after = { ...mod };
    setTabMarkdown(after, tabId, text);
    const texts = lessonImageRefTexts(after);
    const usedElsewhere = key => texts.some(item => textUsesImage(item, key));
    const busy = pictureJobRunning();
    return {
        text,
        count,
        busy,
        unlink: busy ? [] : targets.keys.filter(key => mod.whiteboardVideos?.[key] && !usedElsewhere(key)),
        shared: targets.keys.some(usedElsewhere)
    };
}

function deleteImageMessage(plan) {
    return [
        '이 그림을 교안에서 지웁니다.',
        plan.count > 1 ? `이 탭에 같은 그림이 ${plan.count}곳 있어 모두 지웁니다.` : '',
        plan.unlink.length ? '판서 영상으로 바꿔 둔 그림이라 영상 연결도 풉니다.' : '',
        plan.shared ? '다른 탭이나 교수안·슬라이드에도 있는 그림이라 그곳의 그림은 그대로 둡니다.' : '',
        '지운 뒤에는 Ctrl+Z로 되돌릴 수 없습니다.'
    ].filter(Boolean).join('\n');
}

const DELETE_IMAGE_MISSING = '이 그림을 원문에서 찾지 못해 지우지 않았습니다. 도구 → 원문 전체 수정에서 지워 주세요.';
const DELETE_IMAGE_OTHER_TAB = '기본학습 탭이 비어 있어 다른 탭의 글이 보이는 중이라 지우지 않았습니다. 그림이 든 탭에서 지워 주세요.';

// 숨은 원문 칸이 이 차시·탭을 그렸으면 바뀐 글로 맞춘다(지운 그림을 다시 저장하거나 다시 그리지 않게). storedFrom: 칸을 맞춘 저장된 글
function rawViewAfterImageDelete(mod, tabId) {
    const raw = document.getElementById('raw-view');
    if (!raw || String(raw.dataset.moduleId) !== String(mod.id) || (raw.dataset.tabId || tabId) !== tabId) return;
    const stored = tabSourceFor(mod, tabId);
    raw.value = raw.lastSaved = stored;
    raw.storedFrom = stored;
}

// 보기 화면의 삭제 버튼. 물어본 뒤 이 탭의 그 그림 자리를 지운다. 그림 값은 다른 곳이 쓰지 않을 때만 지운다
// (다른 탭·교수안·슬라이드·삽화, 진행 중인 AI 작업). 판서 영상은 연결만 풀고 파일은 저장된 작업을 열 때 정리한다(whiteboard-video.js).
// 움직이는 GIF로 바꾼 그림을 지우면 그 기록과 간직한 원래 그림도 지운다(다른 곳이 쓰지 않을 때만, image-motion.js)
window.deleteImage = async function (imgId) {
    const mod = getEditingModule();
    if (!mod) return;
    const tabId = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
    const missing = () => window.showToast?.(showsOtherTabsText(mod, tabId) ? DELETE_IMAGE_OTHER_TAB : DELETE_IMAGE_MISSING, 'warning');
    const plan = deleteImagePlan(mod, tabId, lessonImageTargets(mod, imgId));
    if (!plan.count) return missing();
    if (!(await confirmAsync(deleteImageMessage(plan), { title: '그림 지우기', okLabel: '지우기', tone: 'danger' }))) return;
    // 기다리는 동안 다른 차시·탭으로 옮겼으면 지우지 않는다. 그사이 글과 그림이 바뀌었을 수 있어 다시 센다
    if (!isViewingTab(mod, tabId)) return window.showToast?.('다른 차시나 탭으로 옮겨 그림을 지우지 않았습니다.', 'warning');
    const targets = lessonImageTargets(mod, imgId);
    const now = deleteImagePlan(mod, tabId, targets);
    if (!now.count) return missing();
    setTabMarkdown(mod, tabId, now.text);
    if (!now.busy) {
        if (typeof dropWhiteboardVideo === 'function') now.unlink.forEach(key => dropWhiteboardVideo(mod, key)); // 영상 연결이 남으면 그림 값도 남는다
        const drop = targets.keys.filter(key => !lessonStillUsesImage(mod, key));
        // 지우는 GIF 그림의 기록을 뺀 뒤, 그 원래 그림도 아무 데서도 쓰지 않으면 함께 지운다
        const stills = typeof dropImageMotion === 'function' ? drop.map(key => dropImageMotion(mod, key)?.still).filter(key => typeof key === 'string' && !drop.includes(key)) : [];
        const gone = [...drop, ...stills.filter(key => !lessonStillUsesImage(mod, key))];
        if (gone.length) {
            forgetLessonScreens(gone.map(key => mod.images[key])); // 지운 그림을 쓴 차시 화면 기억도 그 그림을 놓는다(용량 확보)
            mod.images = Object.fromEntries(Object.entries(mod.images).filter(([key]) => !gone.includes(key)));
        }
    }
    rawViewAfterImageDelete(mod, tabId);
    // 저장하지 못했으면(saveState가 이미 알렸다) 지웠다고 알리지 않는다
    if ((await window.writeLessonTab(mod, tabId, now.text)) !== false) window.showToast?.('그림을 지웠습니다.', 'success');
};

/* ---------- 보기 화면: 그림 틀·붙여 넣은 그림의 삭제 버튼 ---------- */
const IMAGE_DELETE_BUTTON_CLASS = 'absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity px-3 py-1.5 bg-red-500/80 hover:bg-red-600 text-white text-xs font-bold rounded-lg shadow-lg flex items-center gap-1 backdrop-blur-sm';

function imageDeleteButton(imgId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.lessonAction = 'delete-image';
    button.dataset.imgId = imgId;
    button.className = IMAGE_DELETE_BUTTON_CLASS;
    button.title = '그림 지우기';
    button.innerHTML = '<i class="ph-bold ph-trash"></i> 삭제';
    return button;
}

// 틀 없이 붙여 넣은 그림은 버튼을 달 칸(block span)으로 감싼다. 화면 블록 수는 그대로다(두 번 눌러 고치기는 블록 순서로도 짝짓는다)
function wrapLooseImage(img) {
    const box = document.createElement('span');
    box.className = 'block';
    img.replaceWith(box);
    box.appendChild(img);
    return box;
}

// 마크다운 그림 밖의 그림(그림 틀, 붙여 넣은 맨 <img>)에도 삭제 버튼을 단다. 마크다운 그림([data-imgid])은 렌더러가 단다.
// 진짜 그림·웹 그림에만 달고(빈 주소는 어느 그림인지 알 수 없다) 링크 안 그림은 건너뛴다. 버튼은 왼쪽 위(다시 찾기는 오른쪽 위).
// 그림 키를 하나로 알 수 있으면 키를, 아니면 그림 주소를 넘긴다(deleteImage가 같은 값의 키를 모두 고른다)
function addImageDeleteButtons(view, mod) {
    if (!view || !mod) return;
    const images = mod.images && typeof mod.images === 'object' ? mod.images : {};
    view.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src') || '';
        if (!/^(?:data:image\/|https?:)/i.test(src) || img.closest('[data-imgid], a')) return;
        const holder = img.closest('.image-wrapper') || wrapLooseImage(img);
        const keys = Object.keys(images).filter(key => images[key] === src);
        const own = [...holder.querySelectorAll('[data-img-id]')].find(el => el.dataset.lessonAction !== 'delete-image')?.dataset.imgId; // 저장된 다시 찾기 버튼의 키
        const key = keys.length === 1 ? keys[0] : (keys.includes(own) ? own : '');
        holder.classList.add('relative', 'group');
        holder.appendChild(imageDeleteButton(key || encodeURIComponent(src)));
    });
}

// v7.3: 이미지 JPG 일괄 다운로드
window.downloadImagesAsJPG = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod || !mod.images || Object.keys(mod.images).length === 0) {
        return window.showAlert('다운로드할 이미지가 없습니다.');
    }

    // 현재 탭 이미지만 vs 전체 차시 이미지 선택
    const tabId = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
    // 보고 있는 탭의 저장된 글(탭이 없는 최종 평가·옛 차시는 기본학습 칸의 본문, tabs.js tabSourceFor)
    const tabContent = tabId ? String(tabSourceFor(mod, tabId) || '') : '';
    // 받을 수 있는 그림만 센다(찾지 못한 그림의 teacher-image 참조·빈 값은 내려받을 수 없다). local:img_1과 local:img_10을 가른다(textUsesImage)
    const allImgIds = Object.keys(mod.images).filter(id => /^data:image\//.test(String(mod.images[id] || '')));
    const tabImgIds = allImgIds.filter(id => textUsesImage(tabContent, id));

    if (tabImgIds.length === 0 && allImgIds.length === 0) {
        return window.showAlert('다운로드할 이미지가 없습니다.');
    }

    // 현재 탭만 받을지 전체 차시를 받을지 버튼으로 고른다. 바깥 클릭·Esc는 아무것도 받지 않고 닫는다(같은 창을 또 눌러도)
    if (tabImgIds.length > 0 && allImgIds.length > tabImgIds.length) {
        return window.showConfirm(`현재 탭: ${tabImgIds.length}개 이미지\n전체 차시: ${allImgIds.length}개 이미지\n\n어느 이미지를 내려받을까요?`, () => downloadLessonJpgs(mod, tabImgIds), {
            title: '이미지 저장', okLabel: '현재 탭만', cancelLabel: '전체 차시', tone: 'primary',
            onCancel: reason => {
                if (reason === 'button') downloadLessonJpgs(mod, allImgIds);
            }
        });
    }
    downloadLessonJpgs(mod, tabImgIds.length > 0 ? tabImgIds : allImgIds);
};

// 고른 그림을 하나씩 내려받는다(동시에 받지 않게 0.3초씩 띄운다). 받기를 시작할 때만 알린다
// 기본 저장 폴더(save-folder.js)가 있으면 그쪽에 맡긴다: 차례로 저장하고, 다운로드로 받을 때는 그쪽이 0.3초씩 띄운다.
// 그때 폴더에 저장한 그림은 그쪽이 알리므로, 다운로드로 받은 그림만 세어 '다운로드 시작'을 알린다
function downloadLessonJpgs(mod, imgIds) {
    const saves = [];
    let started = 0; // 맡기지 않고 바로 내려받은 그림(data URL이 아닌 그림)
    imgIds.forEach((imgId, index) => {
        const b64 = mod.images[imgId];
        if (!b64) return;
        const fileName = `${(mod.title || '교안').replace(/[^\w가-힣]/g, '_')}_img_${index + 1}.jpg`;
        if (typeof saveFileToFolder === 'function' && /^data:[^,]*;base64,/.test(b64)) return void saves.push(saveFileToFolder(dataUrlBlob(b64), fileName).catch(showSaveFailure));
        started += 1;
        setTimeout(() => {
            const a = document.createElement('a');
            a.href = b64;
            a.download = fileName;
            a.click();
        }, index * 300);
    });
    if (typeof saveFileToFolder !== 'function') return void window.showToast?.(`📸 ${imgIds.length}개 이미지 다운로드 시작`, 'success');
    Promise.all(saves).then(results => {
        const downloaded = started + results.filter(result => result?.saved === 'download').length;
        if (downloaded) window.showToast?.(`📸 ${downloaded}개 이미지 다운로드 시작`, 'success');
    });
}


// ── Phase F3: 최종 서식 변환 (local: → 웹 URL 일괄) ──

// ─── v8: 강사/학생/분할 3모드 뷰 토글 ───


function applyViewMode(mode) {
    window.viewMode = mode;
    document.body.classList.toggle('student-view', mode === 'student');
    document.body.classList.toggle('instructor-view', mode === 'instructor');
    syncGyosuanView();
}







// ─── v5.9 포팅: 이미지 슬롯 빠른 삽입 ───
// 그림 자리 표시에 넣을 검색어. 따옴표·]·줄바꿈은 표시를 깨고, '--'는 HTML 주석을 일찍 닫으며, 앞의 local:은 저장한 그림 자리로 읽히므로 뺀다
function imageSlotKeyword(text) {
    return String(text ?? '').replace(/["\]\r\n]/g, ' ').replace(/-{2,}/g, '-').replace(/^(\s*local:)+/i, '').replace(/\s+/g, ' ').trim();
}

// 보고 있는 탭에 그림 자리(<!-- [IMG: "검색어"] -->)를 넣는다. 원문 칸을 열어 두었으면 커서 자리에, 아니면 탭 끝에 넣는다(일괄 이미지 찾기가 채운다)
async function insertImageSlot() {
    const mod = getEditingModule();
    const tabId = typeof currentLessonTab !== 'undefined' ? currentLessonTab : 'basicLearn';
    if (!mod || !isViewingTab(mod, tabId)) return window.showAlert('그림 자리는 보고 있는 교안 탭에 넣습니다. 교안 탭을 연 뒤 다시 눌러 주세요.');
    const rawOpen = () => {
        const box = document.getElementById('raw-view');
        return !!box && !box.classList.contains('hidden') && String(box.dataset.moduleId) === String(mod.id) && (box.dataset.tabId || tabId) === tabId;
    };
    // 빈 탭에 그림 자리만 넣으면 탭을 만든 것으로 보여 '탭 생성하기' 안내가 사라지고 일괄 생성·전체 생성이 그 탭을 건너뛴다(원문 칸에서 직접 쓰는 중이면 넣는다)
    const emptyTab = () => !rawOpen() && !String((mod.tabContents ? (showsOtherTabsText(mod, tabId) ? '' : tabSourceFor(mod, tabId)) : mod.content) || '').trim();
    const EMPTY_TAB_SLOT = '이 탭은 아직 비어 있습니다. 먼저 탭을 만든 뒤 그림 자리를 넣어 주세요.';
    if (emptyTab()) return window.showAlert(EMPTY_TAB_SLOT);
    const answer = await window.promptAsync('찾을 그림의 검색어를 적으세요(영어 권장).', { title: '그림 자리 넣기', okLabel: '넣기', placeholder: '예: game loop diagram' });
    const keyword = imageSlotKeyword(answer);
    if (!keyword) return;
    // 묻는 동안 다른 차시·탭으로 옮겼으면 넣지 않는다(옮긴 화면의 글에 넣지 않게)
    if (!isViewingTab(mod, tabId)) return window.showToast?.('다른 차시나 탭으로 옮겨 그림 자리를 넣지 않았습니다.', 'warning');
    const tag = `\n<!-- [IMG: "${keyword}"] -->\n`;
    const raw = document.getElementById('raw-view');
    if (rawOpen()) {
        insertTextAtCursor(raw, tag); // 원문 칸에 넣고 바로 저장한다(state.js)
        raw.focus();
        return;
    }
    window.flushVisibleRawView?.(); // 다른 차시·탭을 그린 채 열린 원문 칸이 있으면 그 글을 먼저 그 차시에 넣는다(다시 그리며 잃지 않게)
    if (emptyTab()) return window.showAlert(EMPTY_TAB_SLOT); // 묻는 동안 탭이 비었다
    // 탭이 없는 최종 평가는 본문(content)이 곧 보이는 글이다. 비운 기본학습에 보이는 다른 탭을 합친 글은 기본학습에 옮겨 넣지 않는다(showsOtherTabsText)
    const source = mod.tabContents ? (showsOtherTabsText(mod, tabId) ? '' : tabSourceFor(mod, tabId)) : mod.content || '';
    setTabMarkdown(mod, tabId, source + tag);
    saveState();
    renderEditor(mod);
    window.showToast?.("그림 자리를 탭 끝에 넣었습니다. 도구의 '일괄 이미지 찾기'를 누르면 이 자리에 그림을 찾아 넣습니다.", 'success');
}
