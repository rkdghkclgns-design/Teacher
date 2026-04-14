// slide-export.js — 마크다운 → HTML 슬라이드 변환

// v7.6: PPTX 양식 기반 슬라이드 CSS (AI 기초 소양 PPTX 디자인 참조)
const SLIDE_CSS = `* { box-sizing: border-box; }
body { background-color: #0a0e1a; display: grid; gap: 20px; grid-template-columns: 1fr; margin: 0; min-height: 100vh; padding: 20px 0; place-items: center; font-family: 'Malgun Gothic', 'Noto Sans KR', 'Apple SD Gothic Neo', Arial, sans-serif; }
.slide-container { align-items: flex-start; background: linear-gradient(135deg, #0f1629 0%, #162040 50%, #1a2550 100%); border-radius: 12px; box-shadow: 0 15px 30px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; gap: 20px; height: 720px; justify-content: center; overflow: hidden; padding: 50px 60px; position: relative; width: 1280px; }
.slide-container::before { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: radial-gradient(circle at 10% 90%, rgba(79, 129, 189, 0.08) 0%, transparent 30%), radial-gradient(circle at 90% 10%, rgba(75, 172, 198, 0.06) 0%, transparent 30%); z-index: 0; }
.slide-container::after { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-size: 40px 40px; background-image: linear-gradient(to right, rgba(255, 255, 255, 0.015) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.015) 1px, transparent 1px); z-index: 0; }
.slide-container > * { position: relative; z-index: 1; }
h1, h2, h3, h4 { color: #f0f2f5; margin: 0; line-height: 1.3; }
h1 { font-size: 56px; font-weight: 700; margin-bottom: 16px; font-family: 'Malgun Gothic', Arial, sans-serif; letter-spacing: -0.5px; }
h1 span { color: #4BACC6; text-shadow: 0 0 20px rgba(75, 172, 198, 0.3); }
.slide-title { font-size: 36px; font-weight: 700; color: #4BACC6; margin-bottom: 12px; width: 100%; border-bottom: 2px solid rgba(75, 172, 198, 0.3); padding-bottom: 12px; }
h3 { font-size: 24px; font-weight: 600; color: #e2e6ed; margin-bottom: 10px; }
p, li { color: #b0b8c8; font-size: 18px; line-height: 1.7; }
.subtitle { font-size: 22px; color: #8ba4c4; font-weight: 400; }
.content-area { display: flex; flex-direction: column; flex-grow: 1; justify-content: center; width: 100%; }
.two-column { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; width: 100%; align-items: center; }
.image-wrapper { border-radius: 10px; overflow: hidden; height: auto; max-height: 450px; width: 100%; border: 1px solid rgba(75, 172, 198, 0.2); box-shadow: 0 8px 24px rgba(0,0,0,0.3); background: #0f1629; display: flex; align-items: center; justify-content: center; }
.image-wrapper img { max-width: 100%; max-height: 450px; object-fit: contain; }
.node-box { background: rgba(31, 73, 125, 0.3); border: 1px solid rgba(75, 172, 198, 0.3); border-radius: 10px; padding: 16px 20px; color: #e2e6ed; font-size: 16px; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
.step-card { background: rgba(31, 73, 125, 0.15); border-left: 4px solid #4BACC6; padding: 18px 22px; margin-bottom: 12px; border-radius: 0 8px 8px 0; }
.data-table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 15px; }
.data-table th, .data-table td { border: 1px solid rgba(75, 172, 198, 0.25); padding: 12px 16px; text-align: left; color: #d0d8e8; }
.data-table th { background: rgba(31, 73, 125, 0.4); color: #4BACC6; font-weight: 700; }
.data-table tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
.section-slide { text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; background: linear-gradient(135deg, #1F497D 0%, #162040 100%); }
.section-slide hr { width: 80px; border: none; height: 3px; background: linear-gradient(90deg, transparent, #4BACC6, transparent); margin: 24px auto; }
.section-slide h4 { color: #8ba4c4; font-size: 16px; text-transform: uppercase; letter-spacing: 3px; font-weight: 600; }
.tiled-content { display: flex; gap: 20px; width: 100%; justify-content: center; }
.tile { background: rgba(31, 73, 125, 0.2); border-radius: 12px; padding: 28px 20px; flex: 1; text-align: center; border: 1px solid rgba(75, 172, 198, 0.2); transition: transform 0.2s; }
.tile:hover { transform: translateY(-4px); }
.tile .icon { font-size: 36px; color: #4BACC6; margin-bottom: 14px; width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto; background: rgba(75, 172, 198, 0.1); }
.slide-body { flex-grow: 1; width: 100%; overflow-y: auto; }
.slide-body ul, .slide-body ol { padding-left: 24px; }
.slide-body table { width: 100%; border-collapse: collapse; margin-top: 16px; }
.slide-body table th, .slide-body table td { border: 1px solid rgba(75, 172, 198, 0.25); padding: 10px 14px; text-align: left; color: #d0d8e8; }
.slide-body table th { background: rgba(31, 73, 125, 0.4); color: #4BACC6; font-weight: 700; }
.slide-nav { position: fixed; bottom: 20px; right: 20px; display: flex; gap: 8px; z-index: 100; }
.slide-nav button { width: 44px; height: 44px; border-radius: 50%; border: 1px solid rgba(75, 172, 198, 0.3); background: rgba(31, 73, 125, 0.5); color: #4BACC6; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.slide-nav button:hover { background: rgba(75, 172, 198, 0.3); }
.slide-counter { position: fixed; bottom: 28px; left: 20px; color: #6b7890; font-size: 14px; z-index: 100; }`;

function parseMarkdownToSlides(markdown) {
    const slides = [];

    // v7.5: 퀴즈 전체 문서 감지 — ### 문제 N이 최상위인 경우 (## 없이 바로 시작)
    const fullHasQuiz = /###?\s*문제\s*\d/m.test(markdown);
    if (fullHasQuiz) {
        console.log('[Slide] 퀴즈 문서 감지됨. 문제별 슬라이드 분리 시작.');

        // 제목 추출 — "채점/루브릭/기준표"가 아닌 실제 퀴즈 타이틀을 찾음
        const headingLines = markdown.match(/^#{1,2}\s+.+/gm) || [];
        const quizTitleLine = headingLines.find(h =>
            !/(채점|루브릭|기준표|평가\s*기준)/i.test(h)
        );
        let sectionTitle = '학습 이해도 점검';
        if (quizTitleLine) {
            const m = quizTitleLine.match(/^#{1,2}\s+(.+)/);
            if (m) {
                const cleaned = m[1].replace(/[■▣📝⚙️🎮💡✅⚠️🧠🏆🚀🔬🎓]/g, '').trim();
                if (cleaned) sectionTitle = cleaned;
            }
        }
        slides.push({ type: 'section', heading: sectionTitle, body: '', level: 1 });

        // ### 문제 N 또는 ## 문제 N 패턴으로 분리
        const qRegex = /#{2,3}\s*문제\s*\d+[.:\s][^\n]*\n[\s\S]*?(?=#{2,3}\s*문제\s*\d|#{2,3}\s*(?:채점|루브릭|평가)|$)/g;
        let m;
        while ((m = qRegex.exec(markdown)) !== null) {
            const q = m[0].trim();
            const qLines = q.split('\n');
            const qHeadMatch = qLines[0].match(/^#{2,3}\s+(.+)/);
            if (!qHeadMatch) continue;
            const qTitle = qHeadMatch[1].trim();
            // 채점/루브릭은 제외
            if (qTitle.includes('채점') || qTitle.includes('루브릭') || qTitle.includes('기준표')) continue;
            let qBody = qLines.slice(1).join('\n').trim();
            // 슬라이드 전용: 정답/해설 제거 (힌트는 유지)
            qBody = qBody.replace(/^.*(?:정답|✅|☑️)[\s:：].*$/gm, '');
            qBody = qBody.replace(/^.*(?:해설|📝|🗒️)[\s:：][\s\S]*?(?=\n#{2,3}\s|\n---|\n$|$)/gm, '');
            // 힌트 유지 — 원본 그대로 보존 (💡 포함 여부 무관하게 힌트 줄은 보존)
            // 컬러 span 제거
            qBody = qBody.replace(/<span\s+style="[^"]*"[^>]*>(.*?)<\/span>/gi, '$1');
            qBody = qBody.trim();
            slides.push({ type: 'quiz', heading: qTitle, body: qBody, level: 3 });
            console.log('[Slide] 퀴즈 슬라이드 추가:', qTitle);
        }

        if (slides.length > 1) return slides; // 문제가 추출되었으면 반환
        // 추출 실패 시 아래 일반 파싱으로 폴백
        slides.length = 0;
    }

    // 일반 섹션 분리 (## 기준)
    const sections = markdown.split(/(?=^## )/gm);

    sections.forEach((section, idx) => {
        const lines = section.trim().split('\n');
        if (!lines[0]) return;

        const headingMatch = lines[0].match(/^(#{1,4})\s+(.+)/);
        if (!headingMatch) {
            if (idx === 0 && section.trim()) {
                slides.push({ type: 'content', heading: '', body: section });
            }
            return;
        }

        const level = headingMatch[1].length;
        const title = headingMatch[2].replace(/[■▣📝⚙️🎮💡✅⚠️🧠🏆🚀🔬🎓]/g, '').trim();
        const body = lines.slice(1).join('\n').trim();

        let slideType = 'section';
        if (level === 1) slideType = 'title';
        else if (body.includes('<table') || (body.includes('|') && body.includes('---'))) slideType = 'data-table';
        else slideType = 'content';

        slides.push({ type: slideType, heading: title, body: body, level: level });
    });

    return slides;
}

function slideToHTML(slide) {
    // 슬라이드용 본문 전처리: 발표자료처럼 핵심 요약
    let body = slide.body || '';
    if (slide.type !== 'quiz') {
        // 긴 문단(3줄 이상 연속 텍스트)을 핵심 문장만 유지
        body = body.replace(/(<br\s*\/?>){2,}/gi, '\n\n');
        // instructor-callout 마크다운 제거
        body = body.replace(/<div class="instructor-callout">[\s\S]*?<\/div>/gi, '');
        // &nbsp; 들여쓰기 제거 (슬라이드에서는 불필요)
        body = body.replace(/&nbsp;/g, ' ');
    }

    let bodyHTML = typeof marked !== 'undefined' ? marked.parse(body) : body;

    // ★ 슬라이드 줄바꿈 보정 — 미렌더링 볼드 + 줄바꿈 처리
    // 1) 미렌더링 마크다운 볼드(**text**) → <strong>
    bodyHTML = bodyHTML.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    // 2) 단일 \n을 <br>로 변환 (슬라이드에서 줄바꿈 보장)
    bodyHTML = bodyHTML.replace(/([^>\n])\n([^<\n])/g, '$1<br>$2');
    // 3) 연속 빈줄 정리
    bodyHTML = bodyHTML.replace(/(<br\s*\/?>){3,}/gi, '<br><br>');

    // 이미지를 image-wrapper로 감싸기 (배경 투명, 다시찾기 버튼 없음)
    bodyHTML = bodyHTML.replace(/<div class="relative group[^"]*"[^>]*data-imgid="[^"]*">\s*<img([^>]*)>[\s\S]*?<\/div>\s*<\/div>/gi, '<div class="image-wrapper"><img$1></div>');
    bodyHTML = bodyHTML.replace(/<img([^>]*)>/gi, (match, attrs) => {
        if (match.includes('image-wrapper')) return match;
        return `<div class="image-wrapper"><img${attrs}></div>`;
    });
    // instructor-callout 제거 (슬라이드에서 불필요)
    bodyHTML = bodyHTML.replace(/<div class="instructor-callout">[\s\S]*?<\/div>/gi, '');
    // "다시 찾기" / 재생성 / 삭제 버튼 제거
    bodyHTML = bodyHTML.replace(/<button[^>]*(?:regenerate|deleteImage|promptRegenerate)[^>]*>[\s\S]*?<\/button>/gi, '');
    bodyHTML = bodyHTML.replace(/<div[^>]*class="[^"]*absolute[^"]*"[^>]*>[\s\S]*?다시\s*찾기[\s\S]*?<\/div>/gi, '');

    // v7.4: 슬라이드용 퀴즈 포맷 (quiz 타입에만 적용)
    if (slide.type === 'quiz') {
        // 1) 보기 번호(①②③④⑤) 앞에 줄바꿈 강제
        bodyHTML = bodyHTML.replace(/([^\n<])(\s*)([①②③④⑤])/g, '$1<br>$3');
        // 2) 보기의 컬러 처리(span style) 제거
        bodyHTML = bodyHTML.replace(/<span\s+style="[^"]*color[^"]*"[^>]*>(.*?)<\/span>/gi, '$1');
        // 3) 정답 제거 — 해당 <p> 태그만 삭제 (전체가 아님)
        bodyHTML = bodyHTML.replace(/<p>[^<]*[✅☑️][^<]*정답[^<]*<\/p>/gi, '');
        bodyHTML = bodyHTML.replace(/<p>\s*<strong>[✅☑️]?\s*정답[\s\S]*?<\/p>/gi, '');
        // 4) 해설 제거
        bodyHTML = bodyHTML.replace(/<p>[^<]*[📝🗒️][^<]*해설[^<]*<\/p>/gi, '');
        bodyHTML = bodyHTML.replace(/<p>\s*<strong>[📝🗒️]?\s*해설[\s\S]*?<\/p>/gi, '');
        // 5) 힌트 제거
        bodyHTML = bodyHTML.replace(/<p>[^<]*[💡🔑][^<]*힌트[^<]*<\/p>/gi, '');
        bodyHTML = bodyHTML.replace(/<p>\s*<strong>[💡🔑]?\s*힌트[\s\S]*?<\/p>/gi, '');
    }

    switch (slide.type) {
        case 'title':
            return `<div class="slide-container section-slide">
                <h1><span>${slide.heading}</span></h1>
                <div class="subtitle">${bodyHTML}</div>
            </div>`;
        case 'quiz':
            return `<div class="slide-container">
                <h2 class="slide-title">${slide.heading}</h2>
                <div class="slide-body" style="font-size:20px;line-height:1.8;">${bodyHTML}</div>
            </div>`;
        case 'data-table':
            return `<div class="slide-container">
                <h2 class="slide-title">${slide.heading}</h2>
                <div class="slide-body">${bodyHTML}</div>
            </div>`;
        case 'section':
            return `<div class="slide-container section-slide">
                <hr>
                <h1>${slide.heading}</h1>
            </div>`;
        default:
            return `<div class="slide-container">
                <h2 class="slide-title">${slide.heading}</h2>
                <div class="slide-body">${bodyHTML}</div>
            </div>`;
    }
}

function buildSlideHTML(markdown, title) {
    const slides = parseMarkdownToSlides(markdown);
    if (slides.length === 0) {
        slides.push({ type: 'title', heading: title, body: '', level: 1 });
    }
    const slidesHTML = slides.map(slideToHTML).join('\n\n');
    const total = slides.length;

    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - 슬라이드</title>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"><\/script>
    <style>
    ${SLIDE_CSS}
    .mermaid { background: transparent; text-align: center; margin: 20px 0; }
    .mermaid svg { max-width: 100%; height: auto; }
    table:not(.data-table) { width:100%; border-collapse:collapse; margin:20px 0; font-size:16px; }
    table:not(.data-table) th, table:not(.data-table) td { border:1px solid #374151; padding:10px 14px; text-align:left; color:#d1d5db; }
    table:not(.data-table) th { background:#1f2937; color:#22d3ee; font-weight:bold; }
    /* 이미지 영역 외 배경 노출 */
    .image-wrapper { background: transparent; }
    .image-wrapper img { background: transparent; }
    /* 중첩 리스트 들여쓰기 */
    .slide-body ol, .slide-body ul { padding-left: 1.8rem; }
    .slide-body li > ol, .slide-body li > ul { padding-left: 1.8rem; margin-top: 0.3rem; }
    .slide-body ol { list-style-type: decimal; }
    .slide-body ol ol { list-style-type: lower-alpha; }
    </style>
</head>
<body>
    ${slidesHTML}

    <div class="slide-counter"><span id="slide-num">1</span> / ${total}</div>
    <div class="slide-nav">
        <button onclick="goTo(currentSlide-1)">&larr;</button>
        <button onclick="goTo(currentSlide+1)">&rarr;</button>
    </div>

    <script>
        // Mermaid 초기화
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({ startOnLoad: true, theme: 'dark', themeVariables: { primaryColor: '#1f2937', primaryTextColor: '#f3f4f6', lineColor: '#22d3ee' } });
            // 코드블록 내 mermaid를 렌더링
            document.querySelectorAll('pre code.language-mermaid, code.language-mermaid').forEach(el => {
                const div = document.createElement('div');
                div.className = 'mermaid';
                div.textContent = el.textContent;
                el.closest('pre')?.replaceWith(div) || el.replaceWith(div);
            });
            // 명시적 재실행
            setTimeout(() => { try { mermaid.run(); } catch(e) {} }, 500);
        }
        let currentSlide = 0;
        const slides = document.querySelectorAll('.slide-container');
        function goTo(n) {
            currentSlide = Math.max(0, Math.min(n, slides.length - 1));
            slides[currentSlide].scrollIntoView({ behavior: 'smooth' });
            document.getElementById('slide-num').textContent = currentSlide + 1;
        }
        document.addEventListener('keydown', e => {
            if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goTo(currentSlide + 1); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(currentSlide - 1); }
        });
    <\/script>
</body>
</html>`;
}

window.exportToSlideHTML = function () {
    const mod = getEditingModule();
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');

    const content = (mod.tabContents && mod.tabContents[currentLessonTab]) || mod.content;
    if (!content) return window.showAlert('교안 내용이 없습니다.');

    let html = buildSlideHTML(content, mod.title);
    // 이미지 치환 (local:imgId → Base64)
    if (mod.images) {
        for (const [imgId, b64] of Object.entries(mod.images)) {
            html = html.replace(new RegExp(`local:${imgId}`, 'g'), b64);
        }
    }

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (mod.title || 'slide').replace(/[^\w가-힣]/g, '_') + '_슬라이드.html';
    a.click();
    URL.revokeObjectURL(a.href);

    window.showToast('📊 슬라이드 HTML이 다운로드되었습니다.', 'success');
};

// v7.4: .pptx 슬라이드 내보내기 — 콘텐츠 분석 기반 레이아웃 자동 선택
window.exportToPptx = function () {
    if (typeof PptxGenJS === 'undefined') {
        return window.showAlert('슬라이드 라이브러리(PptxGenJS)를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
    }
    const mod = getEditingModule();
    if (!mod) {
        if (typeof window.exportSubjectToPptx === 'function') return window.exportSubjectToPptx();
        return window.showAlert('차시를 먼저 선택해주세요.');
    }

    const content = (mod.tabContents && mod.tabContents[currentLessonTab]) || mod.content;
    if (!content) return window.showAlert('교안 내용이 없습니다.');

    try {
        const pptx = new PptxGenJS();
        pptx.defineLayout({ name: 'CUSTOM', width: 13.33, height: 7.5 });
        pptx.layout = 'CUSTOM';

        // v7.5: 템플릿 디자인 (#0F172A 배경, 슬레이트 900)
        const T = { bg:'0F172A', title:'22d3ee', sub:'a78bfa', txt:'94a3b8', h:'f1f5f9', accent:'22d3ee', border:'334155', card:'1e293b', warn:'f59e0b' };

        // ── 유틸리티 ──
        const clean = s => s.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/\*([^*]+)\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/<!--[\s\S]*?-->/g,'').replace(/[■▣●]/g,'').trim();
        const addDivider = (sl, y) => sl.addShape(pptx.ShapeType.rect, { x:0.6, y, w:12, h:0.02, fill:{color:T.border} });
        const addTitle = (sl, txt, fs) => sl.addText(txt.length>80?txt.substring(0,77)+'...':txt, { x:0.6, y:0.3, w:12, h:0.9, fontSize:fs||28, fontFace:'Arial', color:T.title, bold:true });
        const MAX_BULLETS = 7; // 슬라이드당 최대 불릿

        // ── 마크다운 → 섹션 분리 ──
        const rawSections = content.split(/^(?=#{1,2}\s)/m).filter(s => s.trim());

        // ── 표지 슬라이드 (Title Slide) ──
        const cover = pptx.addSlide();
        cover.background = { color: T.bg };
        cover.addText(mod.title || '교안 슬라이드', { x:0.5, y:1.2, w:8, h:2.5, fontSize:42, fontFace:'Arial', color:T.h, bold:true, valign:'middle' });
        const tabLabel = typeof LESSON_TABS!=='undefined' ? (LESSON_TABS.find(t=>t.id===currentLessonTab)||{}).label||'' : '';
        if (tabLabel) cover.addText(tabLabel, { x:0.5, y:3.8, w:8, h:0.8, fontSize:22, fontFace:'Arial', color:T.sub });
        // 우측 장식 영역
        cover.addShape(pptx.ShapeType.rect, { x:9, y:0, w:4.33, h:7.5, fill:{color:'1f2937'} });
        cover.addShape(pptx.ShapeType.rect, { x:0.5, y:4.8, w:3, h:0.04, fill:{color:T.accent} });

        let partNum = 0;

        rawSections.forEach(section => {
            const lines = section.trim().split('\n');
            const firstLine = lines[0].trim();
            const isH1 = firstLine.startsWith('# ') && !firstLine.startsWith('## ');
            const isH2 = firstLine.startsWith('## ');
            const heading = clean(firstLine.replace(/^#{1,4}\s*/, ''));
            const bodyLines = lines.slice(1).filter(l => l.trim());

            // instructor-callout 제외 (강사 전용)
            const isCallout = section.includes('instructor-callout') || section.includes('강사 가이드');
            if (isCallout) return;

            // ── 섹션 타이틀 슬라이드 (Section Slide) ──
            if (isH1 || (isH2 && bodyLines.length < 3)) {
                partNum++;
                const sl = pptx.addSlide();
                sl.background = { color: T.bg };
                sl.addText(`Part ${partNum}`, { x:0.5, y:2, w:12.3, h:0.6, fontSize:16, fontFace:'Arial', color:T.sub, align:'center', bold:true });
                sl.addShape(pptx.ShapeType.rect, { x:5.7, y:2.8, w:2, h:0.03, fill:{color:T.accent} });
                sl.addText(heading || '(제목 없음)', { x:0.5, y:3.2, w:12.3, h:1.5, fontSize:36, fontFace:'Arial', color:T.h, bold:true, align:'center' });
                return;
            }

            // ── 본문 분석 ──
            let inCodeBlock = false;
            const processed = [];
            const tableRows = [];
            let inTable = false;

            bodyLines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed.startsWith('```')) { inCodeBlock = !inCodeBlock; return; }
                if (inCodeBlock) return;
                if (!trimmed) { inTable = false; return; }
                // 표 감지
                if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                    if (trimmed.match(/^\|[\s:|-]+\|$/)) return; // 구분선 무시
                    inTable = true;
                    tableRows.push(trimmed.split('|').filter(c=>c.trim()).map(c=>clean(c)));
                    return;
                }
                inTable = false;
                const c = clean(trimmed);
                if (c) processed.push(c);
            });

            // ── 슬라이드 레이아웃 결정 ──

            // (A) 표가 있는 경우 → Data Table 슬라이드
            if (tableRows.length >= 2) {
                const sl = pptx.addSlide();
                sl.background = { color: T.bg };
                addTitle(sl, heading);
                addDivider(sl, 1.25);
                // PptxGenJS 표 생성
                const header = tableRows[0];
                const data = tableRows.slice(1);
                const colW = header.map(() => 12 / header.length);
                const tblRows = [
                    header.map(h => ({ text:h, options:{ fontSize:14, fontFace:'Arial', color:'22d3ee', bold:true, fill:{color:'1f2937'}, border:{pt:1,color:T.border} } })),
                    ...data.slice(0, 8).map(row =>
                        row.map(cell => ({ text:cell, options:{ fontSize:13, fontFace:'Arial', color:'d1d5db', fill:{color:T.bg}, border:{pt:1,color:T.border} } }))
                    )
                ];
                sl.addTable(tblRows, { x:0.6, y:1.5, w:12, colW, rowH:0.45 });
            }

            // (B) 짧은 불릿 3~4개 → 카드형 (Tiled Content)
            const bullets = processed.filter(p => p.startsWith('•') || p.length < 60);
            if (bullets.length >= 3 && bullets.length <= 4 && processed.length <= 6) {
                const sl = pptx.addSlide();
                sl.background = { color: T.bg };
                addTitle(sl, heading);
                addDivider(sl, 1.25);
                const cards = bullets.slice(0, 4);
                const cw = (12 - (cards.length - 1) * 0.3) / cards.length;
                cards.forEach((card, i) => {
                    const cx = 0.6 + i * (cw + 0.3);
                    // 카드 배경
                    sl.addShape(pptx.ShapeType.rect, { x:cx, y:1.8, w:cw, h:4.5, fill:{color:T.card}, rectRadius:0.15, line:{color:T.border,width:1} });
                    // 카드 텍스트
                    sl.addText(card.replace(/^[•]\s*/, ''), { x:cx+0.3, y:2.3, w:cw-0.6, h:3.5, fontSize:15, fontFace:'Arial', color:T.txt, valign:'top', wrap:true });
                });
                return;
            }

            // (C) 일반 콘텐츠 → 불릿 슬라이드 (페이지 분할)
            if (processed.length > 0) {
                // 페이지 분할: MAX_BULLETS개씩 나누기
                for (let i = 0; i < processed.length; i += MAX_BULLETS) {
                    const chunk = processed.slice(i, i + MAX_BULLETS);
                    const sl = pptx.addSlide();
                    sl.background = { color: T.bg };
                    const pageTitle = i === 0 ? heading : heading + ` (${Math.floor(i/MAX_BULLETS)+1})`;
                    addTitle(sl, pageTitle);
                    addDivider(sl, 1.25);

                    const textOpts = chunk.map(row => {
                        const isBullet = row.startsWith('•');
                        const text = isBullet ? row.substring(2).trim() : row;
                        // 긴 텍스트 요약 (슬라이드용 60자 제한)
                        const summary = text.length > 100 ? text.substring(0, 97) + '...' : text;
                        return {
                            text: summary,
                            options: {
                                fontSize: isBullet ? 16 : 18,
                                fontFace: 'Arial',
                                color: isBullet ? T.txt : T.h,
                                ...(isBullet ? { bullet:{color:T.accent} } : {}),
                                breakLine: true
                            }
                        };
                    });
                    sl.addText(textOpts, { x:0.6, y:1.5, w:12, h:5.5, valign:'top', shrinkText:true, paraSpaceBefore:6, paraSpaceAfter:6 });
                }
                return;
            }
        });

        // ── 이미지 슬라이드 — 모듈에 이미지가 있으면 별도 슬라이드 생성 ──
        if (mod.images && Object.keys(mod.images).length > 0) {
            const imgEntries = Object.entries(mod.images).slice(0, 6); // 최대 6개
            imgEntries.forEach(([imgId, b64], idx) => {
                if (!b64 || !b64.startsWith('data:image')) return;
                const sl = pptx.addSlide();
                sl.background = { color: T.bg };
                sl.addText(`참고 이미지 ${idx + 1}`, { x:0.6, y:0.3, w:12, h:0.7, fontSize:22, fontFace:'Arial', color:T.sub, bold:true });
                addDivider(sl, 1.05);
                try {
                    sl.addImage({ data:b64, x:1.5, y:1.3, w:10.3, h:5.8, sizing:{type:'contain',w:10.3,h:5.8} });
                } catch (e) { console.warn('[PPTX] 이미지 삽입 실패:', e); }
            });
        }

        // ── 마지막 슬라이드 ──
        const endSlide = pptx.addSlide();
        endSlide.background = { color: T.bg };
        endSlide.addText('감사합니다', { x:0.8, y:2.5, w:11.7, h:1.5, fontSize:48, fontFace:'Arial', color:T.h, bold:true, align:'center' });
        endSlide.addText('Thank You', { x:0.8, y:4.2, w:11.7, h:0.8, fontSize:20, fontFace:'Arial', color:T.sub, align:'center' });
        endSlide.addShape(pptx.ShapeType.rect, { x:5.5, y:5.3, w:2.3, h:0.04, fill:{color:T.accent} });

        const filename = (mod.title || 'slide').replace(/[^\w가-힣]/g, '_') + '_슬라이드';
        pptx.writeFile({ fileName: filename + '.pptx' })
            .then(() => window.showToast('📊 PPTX 슬라이드가 다운로드되었습니다.', 'success'))
            .catch(err => {
                console.error('[PPTX Export writeFile]', err);
                window.showAlert('PPTX 저장 중 오류: ' + (err.message || err));
            });

    } catch (e) {
        console.error('[PPTX Export]', e);
        window.showAlert('PPTX 생성 중 오류: ' + e.message);
    }
};

// v7.2: 교과 전체 슬라이드 HTML 내보내기
window.exportSubjectToSlide = function () {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return window.showAlert('교과를 먼저 선택해주세요.');
    const lessonList = subj.lessons || [];
    if (!lessonList.length) return window.showAlert('내보낼 차시가 없습니다.');

    lessonList.forEach(mod => {
        const allContent = Object.entries(mod.tabContents || {}).map(([k, v]) => v || '').filter(Boolean).join('\n\n---\n\n');
        const content = allContent || mod.content || '';
        if (!content) return;
        let html = buildSlideHTML(content, mod.title);
        // 이미지 치환
        if (mod.images) {
            for (const [imgId, b64] of Object.entries(mod.images)) {
                html = html.replace(new RegExp(`local:${imgId}`, 'g'), b64);
            }
        }
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (mod.title || 'slide').replace(/[^\w가-힣]/g, '_') + '_슬라이드.html';
        a.click();
        URL.revokeObjectURL(a.href);
    });
    window.showToast(`📁 ${lessonList.length}개 차시 슬라이드 HTML 다운로드`, 'success');
};

// v7.5: 교과 전체 PPTX 내보내기
window.exportSubjectToPptx = function () {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return window.showAlert('교과를 먼저 선택해주세요.');
    const lessonList = subj.lessons || [];
    if (!lessonList.length) return window.showAlert('내보낼 차시가 없습니다.');
    if (typeof PptxGenJS === 'undefined') return window.showAlert('PptxGenJS를 불러오는 중입니다.');

    // 각 차시별로 개별 PPTX 생성
    let count = 0;
    const downloadNext = (idx) => {
        if (idx >= lessonList.length) {
            window.showToast(`📁 ${count}개 차시 PPTX 다운로드 완료`, 'success');
            return;
        }
        const mod = lessonList[idx];
        const allContent = Object.entries(mod.tabContents || {}).map(([k, v]) => v || '').filter(Boolean).join('\n\n---\n\n');
        if (!allContent) { downloadNext(idx + 1); return; }

        // 임시로 현재 모듈/탭 설정 후 exportToPptx 로직 재사용
        const prevModId = typeof currentEditingModuleId !== 'undefined' ? currentEditingModuleId : null;
        if (typeof currentEditingModuleId !== 'undefined') currentEditingModuleId = mod.id;

        try {
            window.exportToPptx();
            count++;
        } catch (e) { console.warn('[PPTX Subject Export]', e); }

        if (typeof currentEditingModuleId !== 'undefined' && prevModId) currentEditingModuleId = prevModId;
        // 2초 간격으로 다음 차시 (브라우저 다운로드 큐 방지)
        setTimeout(() => downloadNext(idx + 1), 2000);
    };
    downloadNext(0);
};

// ═══════════════════════════════════════════════════════════════
// v7.4: 슬라이드 뷰 패널 — 보기 / 수정 / 내려받기
// ═══════════════════════════════════════════════════════════════

let _slideViewMode = 'view'; // 'view' | 'edit'
let _slideHtmlCache = '';
let _slideMdCache = '';  // 원본 마크다운 저장
let _slideModRef = null; // 현재 모듈 참조

// v7.5: 슬라이드 미리보기 영역에 생성 (인라인 패널용)
window.generateSlideView = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');

    const content = (mod.tabContents && mod.tabContents[currentLessonTab]) || mod.content;
    if (!content) return window.showAlert('교안 내용이 없습니다. 먼저 탭을 생성해주세요.');

    // 슬라이드 HTML 빌드
    let slideHtml = buildSlideHTML(content, mod.title);
    if (mod.images) {
        for (const [imgId, b64] of Object.entries(mod.images)) {
            slideHtml = slideHtml.replace(new RegExp(`local:${imgId}`, 'g'), b64);
        }
    }

    _slideHtmlCache = slideHtml;
    _slideMdCache = content;
    _slideModRef = mod;

    // 미리보기 영역에 iframe 삽입
    const previewArea = document.getElementById('slide-preview-area');
    const statusBadge = document.getElementById('slide-status-badge');
    const downloadBtn = document.getElementById('slide-download-btn');

    if (previewArea) {
        previewArea.innerHTML = `<iframe id="slide-inline-iframe" srcdoc="${slideHtml.replace(/"/g, '&quot;')}"
            style="width:100%;height:600px;border:1px solid #e2e8f0;border-radius:12px;background:#0F172A;"
            sandbox="allow-scripts allow-same-origin"></iframe>`;
    }
    if (statusBadge) {
        statusBadge.textContent = '생성됨';
        statusBadge.className = 'text-[0.6rem] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-bold';
    }
    if (downloadBtn) {
        downloadBtn.classList.remove('hidden');
        downloadBtn.classList.add('flex');
    }
    // 재생성 버튼도 표시
    const regenBtn = document.getElementById('slide-regen-btn');
    if (regenBtn) {
        regenBtn.classList.remove('hidden');
        regenBtn.classList.add('flex');
    }

    // 슬라이드 영역으로 스크롤
    if (previewArea) previewArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.showToast) window.showToast('슬라이드가 생성되었습니다.', 'success');
};

// v7.6: AI 슬라이드 재생성 (핵심 요약 + 사용자 요구사항 반영)
window.regenerateSlideView = async function (moduleId) {
    const mod = getEditingModule(moduleId) || _slideModRef || getEditingModule();
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');

    const content = (mod.tabContents && mod.tabContents[currentLessonTab]) || mod.content;
    if (!content) return window.showAlert('교안 내용이 없습니다.');

    // 사용자 요구사항 입력 프롬프트
    const userRequest = prompt('슬라이드 재생성 요구사항을 입력하세요.\n(예: "핵심만 요약", "표 위주로", "이미지 많이")\n\n비워두면 발표용 핵심 요약으로 자동 생성됩니다.');
    if (userRequest === null) return; // 취소

    try {
        const loadingEl = document.getElementById('editor-loading');
        if (loadingEl) loadingEl.style.display = 'flex';

        const defaultInstruction = '발표 자료용으로 핵심을 요약하세요. 각 섹션을 짧은 핵심 포인트 3~5개로 압축하고, 불필요한 상세 설명은 제거하세요.';
        const slidePrompt = `[슬라이드 재생성 작업]\n아래 교안 내용을 발표용 슬라이드에 적합하게 재구성하세요.\n\n[사용자 요구사항]\n${userRequest || defaultInstruction}\n\n[규칙]\n- ## 단위로 섹션을 구분하세요 (각 ## 이 한 장의 슬라이드가 됩니다)\n- 각 슬라이드는 핵심 포인트 3~5개로 구성\n- 표, Mermaid 다이어그램은 가능하면 유지\n- 이미지 태그(<!-- [IMG: ...] -->)는 유지\n- 강사 callout, 실습 과제, 채점 기준은 제외\n- 마크다운 형식으로 출력\n\n[원본 교안]\n${content.substring(0, 15000)}`;

        const payload = {
            contents: [{ parts: [{ text: slidePrompt }] }],
            systemInstruction: { parts: [{ text: '당신은 교육 슬라이드 전문가입니다. 교안을 발표용 슬라이드 마크다운으로 변환합니다.' }] }
        };

        const data = await callGemini(TEXT_MODEL, payload);

        const resultText = extractText(data);
        if (!resultText) return window.showAlert('슬라이드 재생성 실패: 응답 없음');

        // 재생성된 마크다운으로 슬라이드 빌드
        let slideHtml = buildSlideHTML(resultText, mod.title);
        if (mod.images) {
            for (const [imgId, b64] of Object.entries(mod.images)) {
                slideHtml = slideHtml.replace(new RegExp(`local:${imgId}`, 'g'), b64);
            }
        }

        _slideHtmlCache = slideHtml;
        _slideMdCache = resultText;
        _slideModRef = mod;

        const previewArea = document.getElementById('slide-preview-area');
        if (previewArea) {
            previewArea.innerHTML = `<iframe id="slide-inline-iframe" srcdoc="${slideHtml.replace(/"/g, '&quot;')}"
                style="width:100%;height:600px;border:1px solid #e2e8f0;border-radius:12px;background:#0F172A;"
                sandbox="allow-scripts allow-same-origin"></iframe>`;
        }

        if (window.showToast) window.showToast('슬라이드가 재생성되었습니다.', 'success');
    } catch (err) {
        console.error('[SlideRegen]', err);
        window.showAlert('슬라이드 재생성 실패: ' + err.message);
    } finally {
        const loadingEl = document.getElementById('editor-loading');
        if (loadingEl) loadingEl.style.display = 'none';
    }
};

// v7.5: 현재 슬라이드 내려받기 (HTML)
window.downloadCurrentSlide = function () {
    if (!_slideHtmlCache) return window.showAlert('먼저 슬라이드를 생성해주세요.');
    const mod = _slideModRef || getEditingModule();
    const title = (mod?.title || '슬라이드').replace(/[^\w가-힣]/g, '_');
    const blob = new Blob([_slideHtmlCache], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = title + '_슬라이드.html';
    a.click();
    URL.revokeObjectURL(a.href);
    if (window.showToast) window.showToast('슬라이드 HTML이 다운로드되었습니다.', 'success');
};

window.openSlideView = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');

    const content = (mod.tabContents && mod.tabContents[currentLessonTab]) || mod.content;
    if (!content) return window.showAlert('교안 내용이 없습니다. 먼저 탭을 생성해주세요.');

    // 슬라이드 HTML 빌드
    let slideHtml = buildSlideHTML(content, mod.title);
    // 이미지 치환
    if (mod.images) {
        for (const [imgId, b64] of Object.entries(mod.images)) {
            slideHtml = slideHtml.replace(new RegExp(`local:${imgId}`, 'g'), b64);
        }
    }
    _slideHtmlCache = slideHtml;
    _slideMdCache = content; // 원본 마크다운 보존
    _slideModRef = mod;
    _slideViewMode = 'view';

    // 기존 패널 제거
    document.getElementById('slide-view-panel')?.remove();

    // 패널 생성
    const panel = document.createElement('div');
    panel.id = 'slide-view-panel';
    panel.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;backdrop-filter:blur(8px);';

    panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 24px;background:#111827;border-bottom:1px solid rgba(255,255,255,0.1);">
            <h3 style="color:#f3f4f6;font-size:16px;font-weight:700;flex:1;">🖥️ 슬라이드 뷰 — ${mod.title || '교안'}</h3>
            <div style="display:flex;gap:6px;">
                <button id="slide-mode-view" onclick="switchSlideMode('view')" style="padding:6px 14px;font-size:12px;font-weight:700;border:1px solid rgba(34,211,238,0.5);background:rgba(34,211,238,0.2);color:#22d3ee;border-radius:6px;cursor:pointer;">👁 보기</button>
                <button id="slide-mode-edit" onclick="switchSlideMode('edit')" style="padding:6px 14px;font-size:12px;font-weight:700;border:1px solid rgba(255,255,255,0.1);background:transparent;color:#9ca3af;border-radius:6px;cursor:pointer;">✏️ 수정</button>
                <div style="width:1px;height:24px;background:rgba(255,255,255,0.15);margin:0 4px;"></div>
                <button onclick="rebuildSlideView()" style="padding:6px 14px;font-size:12px;font-weight:700;border:1px solid rgba(245,158,11,0.5);background:rgba(245,158,11,0.15);color:#f59e0b;border-radius:6px;cursor:pointer;">🔄 리빌드</button>
                <button onclick="regenerateSlideView()" style="padding:6px 14px;font-size:12px;font-weight:700;border:1px solid rgba(168,85,247,0.5);background:rgba(168,85,247,0.15);color:#a855f7;border-radius:6px;cursor:pointer;">✨ AI 재생성</button>
                <button onclick="downloadSlideHTML()" style="padding:6px 14px;font-size:12px;font-weight:700;border:1px solid rgba(139,92,246,0.5);background:rgba(139,92,246,0.2);color:#a78bfa;border-radius:6px;cursor:pointer;">📥 내려받기</button>
                <button onclick="closeSlideView()" style="padding:6px 14px;font-size:12px;font-weight:700;border:1px solid rgba(248,113,113,0.3);background:transparent;color:#f87171;border-radius:6px;cursor:pointer;">✕ 닫기</button>
            </div>
        </div>
        <div id="slide-view-content" style="flex:1;overflow:auto;padding:20px;display:flex;justify-content:center;">
            <iframe id="slide-view-iframe" style="width:100%;max-width:1320px;height:100%;border:none;border-radius:8px;background:#0b0f19;"></iframe>
        </div>
        <textarea id="slide-view-editor" style="display:none;flex:1;margin:12px 24px;padding:16px;font-family:'Courier New',monospace;font-size:13px;background:#1a1a2e;color:#e2e8f0;border:1px solid rgba(255,255,255,0.1);border-radius:8px;resize:none;outline:none;"></textarea>
    `;

    document.body.appendChild(panel);

    // iframe에 슬라이드 HTML 로드
    const iframe = document.getElementById('slide-view-iframe');
    iframe.srcdoc = _slideHtmlCache;

    // ESC 키로 닫기
    panel._escHandler = (e) => { if (e.key === 'Escape') closeSlideView(); };
    document.addEventListener('keydown', panel._escHandler);
};

window.switchSlideMode = function (mode) {
    _slideViewMode = mode;
    const iframe = document.getElementById('slide-view-iframe');
    const editor = document.getElementById('slide-view-editor');
    const content = document.getElementById('slide-view-content');
    const btnView = document.getElementById('slide-mode-view');
    const btnEdit = document.getElementById('slide-mode-edit');

    const activeStyle = { bg:'rgba(34,211,238,0.2)', color:'#22d3ee', border:'rgba(34,211,238,0.5)' };
    const inactiveStyle = { bg:'transparent', color:'#9ca3af', border:'rgba(255,255,255,0.1)' };

    if (mode === 'view') {
        // 수정 모드에서 돌아올 때 마크다운→HTML 재빌드
        if (editor && !editor.style.display.includes('none') && editor.value) {
            _slideMdCache = editor.value;
            const mod = _slideModRef || getEditingModule();
            let rebuilt = buildSlideHTML(_slideMdCache, (mod && mod.title) || '교안');
            // 이미지 치환
            if (mod && mod.images) {
                for (const [imgId, b64] of Object.entries(mod.images)) {
                    rebuilt = rebuilt.replace(new RegExp(`local:${imgId}`, 'g'), b64);
                }
            }
            _slideHtmlCache = rebuilt;
            if (iframe) iframe.srcdoc = _slideHtmlCache;
        }
        if (iframe) iframe.style.display = '';
        if (content) content.style.display = 'flex';
        if (editor) editor.style.display = 'none';
        if (btnView) { btnView.style.background = activeStyle.bg; btnView.style.color = activeStyle.color; btnView.style.borderColor = activeStyle.border; }
        if (btnEdit) { btnEdit.style.background = inactiveStyle.bg; btnEdit.style.color = inactiveStyle.color; btnEdit.style.borderColor = inactiveStyle.border; }
    } else {
        // 마크다운 소스 표시 (HTML 아닌 원본 마크다운)
        if (editor) { editor.value = _slideMdCache; editor.style.display = 'block'; }
        if (content) content.style.display = 'none';
        if (btnView) { btnView.style.background = inactiveStyle.bg; btnView.style.color = inactiveStyle.color; btnView.style.borderColor = inactiveStyle.border; }
        if (btnEdit) { btnEdit.style.background = activeStyle.bg; btnEdit.style.color = activeStyle.color; btnEdit.style.borderColor = activeStyle.border; }
    }
};

window.downloadSlideHTML = function () {
    // 수정 모드면 마크다운→HTML 재빌드
    const editor = document.getElementById('slide-view-editor');
    const mod = _slideModRef || getEditingModule();
    if (_slideViewMode === 'edit' && editor && editor.value) {
        _slideMdCache = editor.value;
        let rebuilt = buildSlideHTML(_slideMdCache, (mod && mod.title) || '교안');
        if (mod && mod.images) {
            for (const [imgId, b64] of Object.entries(mod.images)) {
                rebuilt = rebuilt.replace(new RegExp(`local:${imgId}`, 'g'), b64);
            }
        }
        _slideHtmlCache = rebuilt;
    }
    const blob = new Blob([_slideHtmlCache], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ((mod && mod.title) || 'slide').replace(/[^\w가-힣]/g, '_') + '_슬라이드.html';
    a.click();
    URL.revokeObjectURL(a.href);
    if (window.showToast) window.showToast('📥 슬라이드 HTML이 다운로드되었습니다.', 'success');
};

// v7.6: 슬라이드 리빌드 — 현재 교안 내용으로 슬라이드 다시 빌드 (AI 호출 없음)
window.rebuildSlideView = function () {
    const mod = _slideModRef || getEditingModule();
    if (!mod) return;
    const content = (mod.tabContents && mod.tabContents[currentLessonTab]) || mod.content;
    if (!content) return window.showAlert('교안 내용이 없습니다.');

    let slideHtml = buildSlideHTML(content, mod.title);
    if (mod.images) {
        for (const [imgId, b64] of Object.entries(mod.images)) {
            slideHtml = slideHtml.replace(new RegExp(`local:${imgId}`, 'g'), b64);
        }
    }
    _slideHtmlCache = slideHtml;
    _slideMdCache = content;

    const iframe = document.getElementById('slide-view-iframe');
    if (iframe) iframe.srcdoc = _slideHtmlCache;
    switchSlideMode('view');
    if (window.showToast) window.showToast('🔄 슬라이드가 재생성되었습니다.', 'success');
};

window.closeSlideView = function () {
    const panel = document.getElementById('slide-view-panel');
    if (panel) {
        if (panel._escHandler) document.removeEventListener('keydown', panel._escHandler);
        panel.style.opacity = '0';
        panel.style.transition = 'opacity 0.2s';
        setTimeout(() => panel.remove(), 200);
    }
};

// ═══════════════════════════════════════════════════════════════
// v7.4: 슬라이드 양식 템플릿 다운로드
// ═══════════════════════════════════════════════════════════════
window.downloadSlideTemplate = async function () {
    // v7.5: 실제 PPTX 템플릿 파일 다운로드 (slide-template.pptx)
    try {
        const res = await fetch('assets/slide-template.pptx');
        if (res.ok) {
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = '슬라이드_양식_템플릿.pptx';
            a.click();
            URL.revokeObjectURL(a.href);
            if (window.showToast) window.showToast('📋 PPTX 양식 템플릿이 다운로드되었습니다.', 'success');
            return;
        }
        // fetch 실패 시 PptxGenJS 폴백
        console.warn('[Template] fetch 실패, PptxGenJS 폴백');
    } catch (e) {
        console.warn('[Template] fetch 오류, PptxGenJS 폴백:', e);
    }

    // PptxGenJS 폴백 (file:// 프로토콜이거나 fetch 실패 시)
    if (typeof PptxGenJS === 'undefined') {
        return window.showAlert('양식 파일을 다운로드할 수 없습니다. 로컬 서버(실행.bat)를 사용해주세요.');
    }
    try {
        const pptx = new PptxGenJS();
        pptx.defineLayout({ name:'W', width:13.33, height:7.5 });
        pptx.layout = 'W';
        const T = { bg:'111827', t:'22d3ee', s:'a78bfa', txt:'9ca3af', h:'f3f4f6', card:'1f2937', bdr:'374151' };
        const rect = (sl,x,y,w,hh,c) => sl.addShape(pptx.ShapeType.rect,{x,y,w,h:hh,fill:{color:c||T.bdr}});
        const divider = (sl,y) => rect(sl,0.6,y,12,0.02,T.bdr);

        // 1. 표지
        const s1 = pptx.addSlide(); s1.background={color:T.bg};
        s1.addText('교안 제목을 입력하세요',{x:0.5,y:1.2,w:8,h:2,fontSize:42,fontFace:'Arial',color:T.h,bold:true});
        s1.addText('부제목 또는 과목명',{x:0.5,y:3.4,w:8,h:0.8,fontSize:22,fontFace:'Arial',color:T.s});
        s1.addText('작성자: OOO | 날짜: 2026.03.23',{x:0.5,y:4.4,w:8,h:0.5,fontSize:14,fontFace:'Arial',color:'6b7280'});
        rect(s1,9,0,4.33,7.5,T.card);
        rect(s1,0.5,5.2,3,0.04,T.t);

        // 2. 섹션 타이틀
        const s2 = pptx.addSlide(); s2.background={color:T.bg};
        s2.addText('Part 1',{x:0.5,y:2,w:12.3,h:0.6,fontSize:18,fontFace:'Arial',color:T.s,align:'center',bold:true});
        rect(s2,5.7,2.8,2,0.04,T.t);
        s2.addText('섹션 제목을 입력하세요',{x:0.5,y:3.2,w:12.3,h:1.5,fontSize:36,fontFace:'Arial',color:T.h,bold:true,align:'center'});
        s2.addText('이 섹션에서 다룰 내용 요약',{x:0.5,y:4.8,w:12.3,h:0.8,fontSize:20,fontFace:'Arial',color:T.s,align:'center'});

        // 3. 텍스트+이미지 (Two Column)
        const s3 = pptx.addSlide(); s3.background={color:T.bg};
        s3.addText('텍스트 + 이미지 레이아웃',{x:0.6,y:0.3,w:12,h:0.9,fontSize:28,fontFace:'Arial',color:T.t,bold:true});
        divider(s3,1.25);
        s3.addText([
            {text:'핵심 내용',options:{fontSize:22,bold:true,color:T.h,breakLine:true}},
            {text:'첫 번째 포인트를 작성하세요',options:{fontSize:16,color:T.txt,bullet:{color:T.t},breakLine:true}},
            {text:'두 번째 포인트를 작성하세요',options:{fontSize:16,color:T.txt,bullet:{color:T.t},breakLine:true}},
            {text:'세 번째 포인트를 작성하세요',options:{fontSize:16,color:T.txt,bullet:{color:T.t},breakLine:true}}
        ],{x:0.6,y:1.5,w:5.8,h:5,valign:'top',paraSpaceAfter:8});
        rect(s3,7,1.5,5.8,5,T.card); // 이미지 영역 placeholder
        s3.addText('🖼️ 이미지 영역\n(여기에 이미지를 삽입하세요)',{x:7.2,y:2.5,w:5.4,h:3,fontSize:16,fontFace:'Arial',color:'6b7280',align:'center',valign:'middle'});

        // 4. 3단 카드형
        const s4 = pptx.addSlide(); s4.background={color:T.bg};
        s4.addText('카드형 레이아웃',{x:0.6,y:0.3,w:12,h:0.9,fontSize:28,fontFace:'Arial',color:T.t,bold:true});
        divider(s4,1.25);
        ['🎮 카드 제목 1','🎯 카드 제목 2','🏆 카드 제목 3'].forEach((title,i) => {
            const cx = 0.6 + i * 4.1;
            rect(s4,cx,1.8,3.8,4.5,T.card);
            s4.addText(title,{x:cx+0.3,y:2.2,w:3.2,h:0.8,fontSize:20,fontFace:'Arial',color:T.h,bold:true,align:'center'});
            s4.addText('카드 내용을 작성하세요.\n핵심 개념이나 특징을 설명합니다.',{x:cx+0.3,y:3.2,w:3.2,h:2.5,fontSize:14,fontFace:'Arial',color:T.txt,align:'center',valign:'top'});
        });

        // 5. 강조 박스 (Step Card)
        const s5 = pptx.addSlide(); s5.background={color:T.bg};
        s5.addText('단계별 설명',{x:0.6,y:0.3,w:12,h:0.9,fontSize:28,fontFace:'Arial',color:T.t,bold:true});
        divider(s5,1.25);
        ['Step 1: 제목','Step 2: 제목','Step 3: 제목'].forEach((step,i) => {
            const sy = 1.6 + i * 1.7;
            s5.addShape(pptx.ShapeType.rect,{x:0.6,y:sy,w:0.08,h:1.3,fill:{color:T.t}}); // 좌측 accent bar
            rect(s5,0.68,sy,11.92,1.3,'1f293780');
            s5.addText(step,{x:1,y:sy+0.15,w:11,h:0.5,fontSize:18,fontFace:'Arial',color:T.h,bold:true});
            s5.addText('단계별 설명을 작성하세요.',{x:1,y:sy+0.65,w:11,h:0.5,fontSize:14,fontFace:'Arial',color:T.txt});
        });

        // 6. 노드 박스 (Node Box)
        const s6 = pptx.addSlide(); s6.background={color:T.bg};
        s6.addText('코드/구조 설명',{x:0.6,y:0.3,w:12,h:0.9,fontSize:28,fontFace:'Arial',color:T.t,bold:true});
        divider(s6,1.25);
        ['시스템 A: 입력 처리','시스템 B: 로직 처리','시스템 C: 출력'].forEach((node,i) => {
            const ny = 2 + i * 1.6;
            rect(s6,3.5,ny,6.3,0.8,T.card);
            s6.addText(node,{x:3.8,y:ny+0.1,w:5.7,h:0.6,fontSize:16,fontFace:'Courier New',color:T.h,align:'center'});
            if (i < 2) s6.addText('↓',{x:6,y:ny+0.85,w:1.3,h:0.6,fontSize:24,fontFace:'Arial',color:'6b7280',align:'center'});
        });

        // 7. 데이터 표
        const s7 = pptx.addSlide(); s7.background={color:T.bg};
        s7.addText('데이터 테이블',{x:0.6,y:0.3,w:12,h:0.9,fontSize:28,fontFace:'Arial',color:T.t,bold:true});
        divider(s7,1.25);
        const hdrOpts = {fontSize:14,fontFace:'Arial',color:T.t,bold:true,fill:{color:T.card},border:{pt:1,color:T.bdr}};
        const cellOpts = {fontSize:13,fontFace:'Arial',color:'d1d5db',fill:{color:T.bg},border:{pt:1,color:T.bdr}};
        s7.addTable([
            [{text:'항목',options:hdrOpts},{text:'설명',options:hdrOpts},{text:'비고',options:hdrOpts}],
            [{text:'항목 1',options:cellOpts},{text:'설명을 작성하세요',options:cellOpts},{text:'비고',options:cellOpts}],
            [{text:'항목 2',options:cellOpts},{text:'설명을 작성하세요',options:cellOpts},{text:'비고',options:cellOpts}],
            [{text:'항목 3',options:cellOpts},{text:'설명을 작성하세요',options:cellOpts},{text:'비고',options:cellOpts}]
        ],{x:0.6,y:1.5,w:12,colW:[3,6,3],rowH:0.55});

        // 8. 마무리
        const s8 = pptx.addSlide(); s8.background={color:T.bg};
        s8.addText('감사합니다',{x:0.8,y:2.5,w:11.7,h:1.5,fontSize:48,fontFace:'Arial',color:T.h,bold:true,align:'center'});
        s8.addText('Thank You',{x:0.8,y:4.2,w:11.7,h:0.8,fontSize:20,fontFace:'Arial',color:T.s,align:'center'});
        rect(s8,5.5,5.3,2.3,0.04,T.t);

        pptx.writeFile({fileName:'슬라이드_양식_템플릿.pptx'})
            .then(() => { if(window.showToast) window.showToast('📋 PPTX 양식 템플릿이 다운로드되었습니다.','success'); })
            .catch(e => window.showAlert('PPTX 양식 생성 오류: '+e.message));
    } catch(e) {
        console.error('[Slide Template]',e);
        window.showAlert('양식 생성 오류: '+e.message);
    }

    return; // PPTX 생성 완료 — 아래 레거시 코드 실행 안 함

    // 아래는 미사용 레거시 HTML 템플릿 (참조용 보존)
    const _legacyUnused = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>슬라이드 양식 템플릿</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=Urbanist:wght@400;700&display=swap" rel="stylesheet">
    <style>${SLIDE_CSS}</style>
</head>
<body>

<!-- ═══ 1. 표지 (Title Slide) ═══ -->
<div class="slide-container">
    <div class="two-column" style="grid-template-columns: 1.2fr 0.8fr;">
        <div>
            <h1><span>교안 제목</span></h1>
            <p class="subtitle">부제목 또는 과목명을 입력하세요</p>
            <p style="color:#6b7280;font-size:14px;margin-top:20px;">작성자: OOO | 날짜: 2026.03.23</p>
        </div>
        <div class="image-wrapper">
            <img src="https://placehold.co/600x400/111827/22d3ee?text=Cover+Image" alt="표지 이미지">
        </div>
    </div>
</div>

<!-- ═══ 2. 섹션 타이틀 (Section Slide) ═══ -->
<div class="slide-container section-slide">
    <h4 style="color:#a78bfa;font-size:18px;">Part 1</h4>
    <hr>
    <h1>섹션 제목</h1>
    <p class="subtitle">이 섹션에서 다룰 내용 요약</p>
</div>

<!-- ═══ 3. 좌우 텍스트+이미지 (Two Column) ═══ -->
<div class="slide-container">
    <h2 class="slide-title">텍스트 + 이미지 레이아웃</h2>
    <div class="two-column">
        <div>
            <h3>핵심 내용</h3>
            <ul>
                <li>첫 번째 포인트를 작성하세요</li>
                <li>두 번째 포인트를 작성하세요</li>
                <li>세 번째 포인트를 작성하세요</li>
            </ul>
        </div>
        <div class="image-wrapper">
            <img src="https://placehold.co/600x400/1f2937/9ca3af?text=Reference+Image" alt="참고 이미지">
        </div>
    </div>
</div>

<!-- ═══ 4. 3단 카드형 (Tiled Content) ═══ -->
<div class="slide-container">
    <h2 class="slide-title">카드형 레이아웃</h2>
    <div class="tiled-content">
        <div class="tile">
            <div class="icon">🎮</div>
            <h3>카드 제목 1</h3>
            <p>카드 내용을 작성하세요. 핵심 개념이나 특징을 설명합니다.</p>
        </div>
        <div class="tile">
            <div class="icon">🎯</div>
            <h3>카드 제목 2</h3>
            <p>카드 내용을 작성하세요. 핵심 개념이나 특징을 설명합니다.</p>
        </div>
        <div class="tile">
            <div class="icon">🏆</div>
            <h3>카드 제목 3</h3>
            <p>카드 내용을 작성하세요. 핵심 개념이나 특징을 설명합니다.</p>
        </div>
    </div>
</div>

<!-- ═══ 5. 강조 박스 (Step Card) ═══ -->
<div class="slide-container">
    <h2 class="slide-title">단계별 설명</h2>
    <div class="content-area">
        <div class="step-card">
            <h3>Step 1: 제목</h3>
            <p>단계별 설명을 작성하세요. 프로세스나 절차를 설명할 때 사용합니다.</p>
        </div>
        <div class="step-card">
            <h3>Step 2: 제목</h3>
            <p>다음 단계의 설명을 작성하세요.</p>
        </div>
        <div class="step-card">
            <h3>Step 3: 제목</h3>
            <p>마지막 단계의 설명을 작성하세요.</p>
        </div>
    </div>
</div>

<!-- ═══ 6. 노드 박스 (Node Box) ═══ -->
<div class="slide-container">
    <h2 class="slide-title">코드/구조 설명</h2>
    <div class="content-area" style="gap:10px;">
        <div class="node-box">시스템 A: 입력 처리</div>
        <div class="node-connector">↓</div>
        <div class="node-box">시스템 B: 로직 처리</div>
        <div class="node-connector">↓</div>
        <div class="node-box">시스템 C: 출력</div>
    </div>
</div>

<!-- ═══ 7. 표 (Data Table) ═══ -->
<div class="slide-container">
    <h2 class="slide-title">데이터 테이블</h2>
    <table class="data-table">
        <thead>
            <tr><th>항목</th><th>설명</th><th>비고</th></tr>
        </thead>
        <tbody>
            <tr><td>항목 1</td><td>설명을 작성하세요</td><td>비고</td></tr>
            <tr><td>항목 2</td><td>설명을 작성하세요</td><td>비고</td></tr>
            <tr><td>항목 3</td><td>설명을 작성하세요</td><td>비고</td></tr>
        </tbody>
    </table>
</div>

<!-- ═══ 8. 마무리 슬라이드 ═══ -->
<div class="slide-container section-slide">
    <h1>감사합니다</h1>
    <hr>
    <p class="subtitle">Thank You</p>
</div>

</body>
</html>`;

    const blob = new Blob([templateHTML], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '슬라이드_양식_템플릿.html';
    a.click();
    URL.revokeObjectURL(a.href);
    if (window.showToast) window.showToast('📋 슬라이드 양식 템플릿이 다운로드되었습니다.', 'success');
};
