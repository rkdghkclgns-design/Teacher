// slide-export.js — 마크다운 → HTML/PPTX 슬라이드 변환 (발표용 프리미엄 디자인)
// v8.0: 광고대행사급 슬라이드 — 1280x720 16:9, Pretendard 글꼴, 컨텐츠 형태 자동 분기 레이아웃,
//       페이지 번호·푸터 일관성, PPTX·HTML 디자인 토큰 동기화

// ═══════════════════════════════════════════════════════════════
// 디자인 토큰 (HTML/PPTX 공통)
// ═══════════════════════════════════════════════════════════════
const DT = {
    bg1: '#0B1120', bg2: '#10203F', bg3: '#162B5C',
    accent: '#4BACC6', accent2: '#A78BFA', accent3: '#F59E0B',
    h: '#F5F7FA', sub: '#94A3B8', txt: '#CBD5E1', muted: '#64748B',
    cardBg: 'rgba(31, 73, 125, 0.20)', cardBd: 'rgba(75, 172, 198, 0.30)',
};
const PPTX_T = {
    bg: '0B1120', card: '162B5C', accent: '4BACC6', accent2: 'A78BFA',
    h: 'F5F7FA', sub: '94A3B8', txt: 'CBD5E1', border: '334155', muted: '64748B',
};

// v8.0: 발표용 프리미엄 슬라이드 CSS
const SLIDE_CSS = `
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: 'Pretendard', 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
body {
    background: linear-gradient(180deg, #050810 0%, #0a0e1a 100%);
    display: grid; gap: 32px; grid-template-columns: 1fr;
    place-items: center; padding: 32px 0; min-height: 100vh; color: ${DT.h};
}

/* ── 슬라이드 컨테이너 (1280x720 = 16:9) ── */
.slide-container {
    width: 1280px; height: 720px;
    background: linear-gradient(135deg, ${DT.bg1} 0%, ${DT.bg2} 50%, ${DT.bg3} 100%);
    border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    padding: 64px 72px 56px 72px;
    position: relative; overflow: hidden;
    display: flex; flex-direction: column;
    font-family: 'Pretendard', sans-serif;
}
.slide-container::before {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background-image:
        radial-gradient(circle at 8% 92%, rgba(75,172,198,0.10) 0%, transparent 35%),
        radial-gradient(circle at 92% 8%, rgba(167,139,250,0.08) 0%, transparent 35%);
    z-index: 0;
}
.slide-container::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background-size: 48px 48px;
    background-image:
        linear-gradient(to right, rgba(255,255,255,0.012) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255,255,255,0.012) 1px, transparent 1px);
    z-index: 0;
}
.slide-container > * { position: relative; z-index: 1; }

/* ── 푸터 / 페이지 번호 ── */
.slide-footer {
    position: absolute; left: 72px; right: 72px; bottom: 24px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 13px; color: ${DT.muted}; z-index: 2;
    border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px;
}
.slide-footer .brand { color: ${DT.accent}; font-weight: 700; letter-spacing: 0.5px; }
.slide-footer .page-num { font-variant-numeric: tabular-nums; }

/* ── 헤더 / 제목 ── */
.slide-header {
    display: flex; align-items: flex-end; justify-content: space-between;
    margin-bottom: 24px; padding-bottom: 18px;
    border-bottom: 2px solid rgba(75, 172, 198, 0.25);
}
.slide-title {
    font-size: 38px; font-weight: 800; color: ${DT.accent};
    letter-spacing: -0.3px; line-height: 1.2;
    flex: 1; max-width: 100%;
}
.slide-eyebrow {
    font-size: 13px; font-weight: 700; color: ${DT.accent2};
    text-transform: uppercase; letter-spacing: 2px; padding-bottom: 6px;
}
.slide-body {
    flex: 1; min-height: 0; overflow: hidden;
    font-size: 22px; line-height: 1.6; color: ${DT.txt};
}

/* ── 표지 슬라이드 ── */
.slide-cover {
    display: flex; flex-direction: column; justify-content: center; align-items: flex-start;
    background: linear-gradient(135deg, #0B1120 0%, #1F497D 100%);
}
.slide-cover h1 {
    font-size: 72px; font-weight: 800; color: ${DT.h}; line-height: 1.15;
    letter-spacing: -1px; margin-bottom: 24px; max-width: 900px;
}
.slide-cover h1 .accent { color: ${DT.accent}; }
.slide-cover .subtitle {
    font-size: 28px; color: ${DT.sub}; font-weight: 400; line-height: 1.5;
    max-width: 800px;
}
.slide-cover .meta {
    margin-top: 40px; font-size: 16px; color: ${DT.muted};
    display: flex; gap: 24px; align-items: center;
}
.slide-cover .meta-tag {
    background: rgba(75,172,198,0.15); color: ${DT.accent};
    padding: 6px 14px; border-radius: 20px; font-weight: 700;
    border: 1px solid rgba(75,172,198,0.3);
}
.slide-cover::after {
    content: ''; position: absolute; right: -100px; top: -100px;
    width: 500px; height: 500px; border-radius: 50%;
    background: radial-gradient(circle, rgba(75,172,198,0.20) 0%, transparent 70%);
    pointer-events: none;
}

/* ── 섹션 디바이더 ── */
.slide-section {
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    text-align: center; background: linear-gradient(135deg, #1F497D 0%, #0B1120 100%);
}
.slide-section .part-tag {
    font-size: 16px; color: ${DT.accent}; font-weight: 700;
    text-transform: uppercase; letter-spacing: 4px; margin-bottom: 12px;
}
.slide-section hr {
    width: 80px; border: none; height: 4px;
    background: linear-gradient(90deg, transparent, ${DT.accent}, transparent);
    margin: 16px auto 28px;
}
.slide-section h1 {
    font-size: 64px; font-weight: 800; color: ${DT.h};
    max-width: 1000px; line-height: 1.2; letter-spacing: -0.5px;
}

/* ── 본문 타이포 ── */
.slide-body h2 { font-size: 30px; font-weight: 700; color: ${DT.h}; margin: 16px 0 12px; }
.slide-body h3 { font-size: 26px; font-weight: 700; color: ${DT.accent}; margin: 14px 0 10px; }
.slide-body h4 { font-size: 22px; font-weight: 700; color: ${DT.h}; margin: 12px 0 8px; }
.slide-body p { font-size: 22px; line-height: 1.6; color: ${DT.txt}; margin: 8px 0; }
.slide-body strong { color: ${DT.h}; font-weight: 700; }
.slide-body em { color: ${DT.accent2}; font-style: normal; }
.slide-body code { background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 4px; font-size: 0.92em; color: ${DT.accent}; font-family: 'D2Coding', 'Consolas', monospace; }

/* ── 불릿 리스트 ── */
.slide-body ul, .slide-body ol { list-style: none; padding: 0; margin: 8px 0; }
.slide-body ul li {
    position: relative; padding-left: 32px; margin: 14px 0;
    font-size: 22px; line-height: 1.55; color: ${DT.txt};
}
.slide-body ul li::before {
    content: ''; position: absolute; left: 8px; top: 13px;
    width: 10px; height: 10px; border-radius: 50%;
    background: ${DT.accent}; box-shadow: 0 0 12px rgba(75,172,198,0.5);
}
.slide-body ol { counter-reset: olc; }
.slide-body ol li {
    position: relative; padding-left: 44px; margin: 14px 0;
    font-size: 22px; line-height: 1.55; color: ${DT.txt}; counter-increment: olc;
}
.slide-body ol li::before {
    content: counter(olc); position: absolute; left: 0; top: 0;
    width: 32px; height: 32px; border-radius: 50%;
    background: linear-gradient(135deg, ${DT.accent}, ${DT.accent2});
    color: #fff; font-weight: 800; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
}
.slide-body li > ul, .slide-body li > ol { margin: 6px 0 4px; }
.slide-body li > ul li { font-size: 19px; margin: 6px 0; }
.slide-body li > ul li::before { width: 8px; height: 8px; top: 11px; background: ${DT.sub}; }

/* ── 표 ── */
.slide-body table, .data-table {
    width: 100%; border-collapse: separate; border-spacing: 0;
    margin: 12px 0; font-size: 17px; border-radius: 10px; overflow: hidden;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
.slide-body table th, .data-table th {
    background: linear-gradient(135deg, rgba(75,172,198,0.30), rgba(75,172,198,0.15));
    color: ${DT.accent}; font-weight: 800; padding: 14px 18px;
    text-align: left; font-size: 16px; letter-spacing: 0.3px;
    border-bottom: 2px solid rgba(75,172,198,0.4);
}
.slide-body table td, .data-table td {
    padding: 12px 18px; color: ${DT.txt}; font-size: 17px; line-height: 1.5;
    border-bottom: 1px solid rgba(75,172,198,0.12);
    background: rgba(31,73,125,0.10);
}
.slide-body table tr:last-child td, .data-table tr:last-child td { border-bottom: none; }
.slide-body table tr:nth-child(even) td, .data-table tr:nth-child(even) td { background: rgba(31,73,125,0.18); }

/* ── 카드 / 타일 ── */
.tiled-content { display: grid; gap: 20px; width: 100%; align-content: center; }
.tiled-content.cols-2 { grid-template-columns: 1fr 1fr; }
.tiled-content.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
.tiled-content.cols-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
.tile {
    background: linear-gradient(160deg, rgba(31,73,125,0.30) 0%, rgba(31,73,125,0.15) 100%);
    border: 1px solid rgba(75,172,198,0.25); border-radius: 14px;
    padding: 28px 24px; text-align: left;
    box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    display: flex; flex-direction: column; gap: 12px;
    position: relative; overflow: hidden;
}
.tile::before {
    content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 4px;
    background: linear-gradient(90deg, ${DT.accent}, ${DT.accent2});
}
.tile .tile-num {
    width: 40px; height: 40px; border-radius: 10px;
    background: linear-gradient(135deg, ${DT.accent}, ${DT.accent2});
    color: #fff; font-weight: 800; font-size: 18px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 12px rgba(75,172,198,0.4);
}
.tile h3 { font-size: 22px; color: ${DT.h}; font-weight: 700; margin: 0; line-height: 1.3; }
.tile p { font-size: 17px; color: ${DT.txt}; line-height: 1.55; margin: 0; }

/* ── 두 열 (텍스트 + 이미지) ── */
.two-column { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center; height: 100%; }
.two-column.left-heavy { grid-template-columns: 1.3fr 1fr; }
.two-column.right-heavy { grid-template-columns: 1fr 1.3fr; }
.image-wrapper {
    border-radius: 14px; overflow: hidden;
    border: 1px solid rgba(75,172,198,0.25);
    box-shadow: 0 12px 32px rgba(0,0,0,0.4);
    background: rgba(11,17,32,0.5);
    display: flex; align-items: center; justify-content: center;
    max-height: 480px; width: 100%;
}
.image-wrapper img { max-width: 100%; max-height: 480px; object-fit: contain; display: block; }

/* ── 단계 카드 (Step) ── */
.step-card {
    background: rgba(31,73,125,0.18);
    border-left: 4px solid ${DT.accent};
    padding: 20px 26px; margin: 12px 0; border-radius: 0 12px 12px 0;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}
.step-card h3 { color: ${DT.h}; font-size: 22px; margin-bottom: 6px; }
.step-card p { color: ${DT.txt}; font-size: 19px; line-height: 1.55; }

/* ── 강조 인용 ── */
.callout {
    background: linear-gradient(135deg, rgba(167,139,250,0.15), rgba(75,172,198,0.10));
    border: 1px solid rgba(167,139,250,0.30); border-radius: 14px;
    padding: 28px 32px; margin: 20px 0;
    font-size: 22px; line-height: 1.6; color: ${DT.h};
    position: relative;
}
.callout::before {
    content: '"'; position: absolute; left: 18px; top: 8px;
    font-size: 56px; color: ${DT.accent2}; font-family: Georgia, serif; opacity: 0.5;
}

/* ── 단일 강조 (Hero Statement) ── */
.slide-hero {
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    text-align: center; height: 100%;
}
.slide-hero .hero-title {
    font-size: 56px; font-weight: 800; color: ${DT.h};
    line-height: 1.2; letter-spacing: -0.5px; max-width: 1000px;
}
.slide-hero .hero-sub {
    font-size: 26px; color: ${DT.sub}; margin-top: 24px; max-width: 900px;
}

/* ── Mermaid ── */
.mermaid {
    background: rgba(11,17,32,0.5); border-radius: 12px; padding: 16px;
    text-align: center; margin: 16px 0; max-height: 480px; overflow: hidden;
    border: 1px solid rgba(75,172,198,0.20);
}
.mermaid svg { max-width: 100%; max-height: 460px; height: auto; }

/* ── 코드 블록 ── */
.slide-body pre {
    background: rgba(0,0,0,0.5); border-radius: 10px; padding: 18px 22px;
    overflow: auto; max-height: 460px; border: 1px solid rgba(75,172,198,0.15);
    margin: 12px 0;
}
.slide-body pre code {
    background: transparent; padding: 0; color: #E2E8F0; font-size: 16px;
    font-family: 'D2Coding', 'JetBrains Mono', 'Consolas', monospace; line-height: 1.55;
}

/* ── 퀴즈 ── */
.quiz-question { font-size: 26px; line-height: 1.5; color: ${DT.h}; font-weight: 600; margin-bottom: 24px; }
.quiz-options { display: grid; gap: 12px; }
.quiz-options p { font-size: 22px; padding: 14px 20px; border-radius: 10px; background: rgba(31,73,125,0.20); border: 1px solid rgba(75,172,198,0.15); }
.quiz-hint { margin-top: 20px; padding: 16px 22px; background: rgba(245,158,11,0.10); border-left: 4px solid ${DT.accent3}; border-radius: 0 10px 10px 0; color: ${DT.h}; font-size: 18px; }

/* ── 네비게이션 ── */
.slide-nav {
    position: fixed; bottom: 24px; right: 24px; display: flex; gap: 8px; z-index: 100;
    background: rgba(11,17,32,0.85); padding: 8px; border-radius: 50px;
    backdrop-filter: blur(10px); border: 1px solid rgba(75,172,198,0.25);
}
.slide-nav button {
    width: 48px; height: 48px; border-radius: 50%;
    border: none; background: ${DT.accent}; color: #0B1120;
    font-size: 20px; font-weight: 700; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
}
.slide-nav button:hover { background: ${DT.accent2}; transform: translateY(-2px); }
.slide-counter {
    position: fixed; bottom: 32px; left: 24px;
    background: rgba(11,17,32,0.85); padding: 10px 18px; border-radius: 20px;
    backdrop-filter: blur(10px); border: 1px solid rgba(75,172,198,0.20);
    color: ${DT.sub}; font-size: 14px; font-weight: 700; z-index: 100;
    font-variant-numeric: tabular-nums;
}

/* ── 단어 끊김 방지 (한국어) ── */
.slide-body, .slide-body *, h1, h2, h3, h4, p, li {
    word-break: keep-all; overflow-wrap: break-word; line-break: strict;
}
`;

// ═══════════════════════════════════════════════════════════════
// 마크다운 → 슬라이드 분할
// ═══════════════════════════════════════════════════════════════
function parseMarkdownToSlides(markdown) {
    const slides = [];

    // 퀴즈 전체 문서 감지
    const fullHasQuiz = /###?\s*문제\s*\d/m.test(markdown);
    if (fullHasQuiz) {
        const headingLines = markdown.match(/^#{1,2}\s+.+/gm) || [];
        const quizTitleLine = headingLines.find(h => !/(채점|루브릭|기준표|평가\s*기준)/i.test(h));
        let sectionTitle = '학습 이해도 점검';
        if (quizTitleLine) {
            const m = quizTitleLine.match(/^#{1,2}\s+(.+)/);
            if (m) {
                const cleaned = m[1].replace(/[■▣📝⚙️🎮💡✅⚠️🧠🏆🚀🔬🎓]/g, '').trim();
                if (cleaned) sectionTitle = cleaned;
            }
        }
        slides.push({ type: 'section', heading: sectionTitle, body: '', level: 1 });

        const qRegex = /#{2,3}\s*문제\s*\d+[.:\s][^\n]*\n[\s\S]*?(?=#{2,3}\s*문제\s*\d|#{2,3}\s*(?:채점|루브릭|평가)|$)/g;
        let m;
        while ((m = qRegex.exec(markdown)) !== null) {
            const q = m[0].trim();
            const qLines = q.split('\n');
            const qHeadMatch = qLines[0].match(/^#{2,3}\s+(.+)/);
            if (!qHeadMatch) continue;
            const qTitle = qHeadMatch[1].trim();
            if (qTitle.includes('채점') || qTitle.includes('루브릭') || qTitle.includes('기준표')) continue;
            let qBody = qLines.slice(1).join('\n').trim();
            qBody = qBody.replace(/^.*(?:정답|✅|☑️)[\s:：].*$/gm, '');
            qBody = qBody.replace(/^.*(?:해설|📝|🗒️)[\s:：][\s\S]*?(?=\n#{2,3}\s|\n---|\n$|$)/gm, '');
            qBody = qBody.replace(/<span\s+style="[^"]*"[^>]*>(.*?)<\/span>/gi, '$1');
            qBody = qBody.trim();
            slides.push({ type: 'quiz', heading: qTitle, body: qBody, level: 3 });
        }

        if (slides.length > 1) return slides;
        slides.length = 0;
    }

    // 일반 섹션 분리
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

        let slideType = 'content';
        if (level === 1) slideType = 'title';
        else if (body.includes('<table') || (body.includes('|') && body.includes('---'))) slideType = 'data-table';

        slides.push({ type: slideType, heading: title, body: body, level: level });
    });

    return slides;
}

// ═══════════════════════════════════════════════════════════════
// 본문 형태 자동 분기 (단일 / 카드 / 두 열 / 표 / 코드 / Mermaid / 단계)
// ═══════════════════════════════════════════════════════════════
function detectBodyShape(body) {
    if (!body) return 'empty';
    const s = body.trim();
    // Mermaid 우선
    if (/```mermaid|class="mermaid"/.test(s)) return 'mermaid';
    // 표
    if (/<table/i.test(s) || /^\|.*\|.*\n\|?\s*[-:|\s]+/m.test(s)) return 'table';
    // 코드 블록 단독
    if (/^```[\s\S]*```$/.test(s.trim())) return 'code';
    // 이미지 단독
    if (/^(?:<div[^>]*image-wrapper[^>]*>|<img\b|!\[)/.test(s) && s.replace(/<[^>]*>/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim().length < 80) return 'image-only';
    // 짧은 단일 문장 (영감 인용 / 한 줄 강조)
    const plain = s.replace(/<[^>]+>/g, '').replace(/[#*_`>]/g, '').trim();
    if (plain.length < 60 && !plain.includes('\n')) return 'hero';
    // 불릿 리스트 비율
    const lines = plain.split('\n').filter(l => l.trim());
    const bulletLines = lines.filter(l => /^\s*[-*•]\s|^\s*\d+\.\s/.test(l));
    if (bulletLines.length >= 3 && bulletLines.length / lines.length > 0.6) {
        // 불릿 4~6개 짧으면 카드형
        const shortBullets = bulletLines.filter(b => b.replace(/^\s*[-*•]\s|^\s*\d+\.\s/, '').length < 70);
        if (shortBullets.length === bulletLines.length && bulletLines.length >= 3 && bulletLines.length <= 6) return 'tiled';
        return 'list';
    }
    // 단계: "Step / 단계 / 1단계"
    if (/^(?:Step\s*\d|\d+\s*단계|단계\s*\d)/m.test(s)) return 'steps';
    // 기본
    return 'flow';
}

function htmlEscape(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 짧은 불릿을 카드로 변환
function bulletsToTiles(bulletLines) {
    return bulletLines.map((line, i) => {
        const text = line.replace(/^\s*[-*•]\s+/, '').replace(/^\s*\d+\.\s+/, '').trim();
        // "**제목:** 내용" 형태 분리
        const m = text.match(/^\*\*([^*:]+)[:：]?\*\*\s*(.*)/);
        const head = m ? m[1].trim() : '';
        const desc = m ? m[2].trim() : text;
        const num = String(i + 1).padStart(2, '0');
        return `<div class="tile">
            <div class="tile-num">${num}</div>
            ${head ? `<h3>${htmlEscape(head)}</h3>` : ''}
            <p>${desc.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>
        </div>`;
    }).join('');
}

function preProcessSlideBody(body) {
    let b = body || '';
    // instructor-callout / 강사 마커 제거 (학생 발표용)
    b = b.replace(/<div class="instructor-callout">[\s\S]*?<\/div>/gi, '');
    b = b.replace(/^\s*[⏱⏰]️?\s*\*{0,2}\s*예상\s*소요[^\n]*\n?/gim, '');
    b = b.replace(/^\s*🎚️?\s*\*{0,2}\s*난이도[^\n]*\n?/gim, '');
    b = b.replace(/^\s*🎬\s*\*{0,2}\s*도입\s*멘트[^\n]*\n?/gim, '');
    b = b.replace(/^\s*🗣️?\s*\*{0,2}\s*(?:핵심\s*설명|질문|참여)[^\n]*\n?/gim, '');
    b = b.replace(/^\s*💡\s*\*{0,2}\s*꼭\s*짚어[^\n]*\n?/gim, '');
    b = b.replace(/^\s*💼\s*\*{0,2}\s*활용\s*예시[^\n]*\n?/gim, '');
    b = b.replace(/^\s*❓\s*\*{0,2}\s*권장\s*질문[^\n]*\n?/gim, '');
    b = b.replace(/^\s*⚠️?\s*\*{0,2}\s*자주\s*헷갈[^\n]*\n?/gim, '');
    b = b.replace(/^\s*🔗\s*\*{0,2}\s*전환[^\n]*\n?/gim, '');
    // &nbsp; 정리
    b = b.replace(/&nbsp;/g, ' ');
    // 다시 찾기 / 재생성 / 삭제 버튼 제거
    b = b.replace(/<div class="relative group[^"]*"[^>]*data-imgid="[^"]*">\s*<img([^>]*)>[\s\S]*?<\/div>\s*<\/div>/gi, '<div class="image-wrapper"><img$1></div>');
    b = b.replace(/<button[^>]*(?:regenerate|deleteImage|promptRegenerate)[^>]*>[\s\S]*?<\/button>/gi, '');
    b = b.replace(/<div[^>]*class="[^"]*absolute[^"]*"[^>]*>[\s\S]*?다시\s*찾기[\s\S]*?<\/div>/gi, '');
    // image-caption 제거 (슬라이드용)
    b = b.replace(/<div\s+class="image-caption"[^>]*>[\s\S]*?<\/div>/gi, '');
    // 연속 빈줄
    b = b.replace(/\n{3,}/g, '\n\n').trim();
    return b;
}

function slideToHTML(slide, opts) {
    opts = opts || {};
    const pageNum = opts.pageNum;
    const totalPages = opts.totalPages;
    const courseTitle = opts.courseTitle || '';

    // 본문 전처리 (강사 콜아웃 제거 등)
    let body = slide.type === 'quiz' ? (slide.body || '') : preProcessSlideBody(slide.body || '');

    // 표지 / 섹션 / 퀴즈는 전용 레이아웃
    if (slide.type === 'title' || slide.type === 'cover') {
        const subtitle = body.replace(/<[^>]+>/g, '').replace(/[#*_`]/g, '').replace(/\n+/g, ' ').trim();
        return `<div class="slide-container slide-cover">
            <h1>${formatHeading(slide.heading)}</h1>
            ${subtitle ? `<p class="subtitle">${htmlEscape(subtitle.slice(0, 200))}</p>` : ''}
            <div class="meta">
                ${courseTitle ? `<span class="meta-tag">${htmlEscape(courseTitle)}</span>` : ''}
                <span>발표용 슬라이드</span>
            </div>
            ${renderFooter(courseTitle, pageNum, totalPages, true)}
        </div>`;
    }

    if (slide.type === 'section') {
        return `<div class="slide-container slide-section">
            ${slide.partLabel ? `<div class="part-tag">${htmlEscape(slide.partLabel)}</div>` : ''}
            <hr>
            <h1>${formatHeading(slide.heading)}</h1>
            ${renderFooter(courseTitle, pageNum, totalPages, true)}
        </div>`;
    }

    if (slide.type === 'quiz') {
        const bodyHTML = renderQuizBody(body);
        return `<div class="slide-container">
            <div class="slide-header">
                <div>
                    <div class="slide-eyebrow">학습 점검 · QUIZ</div>
                    <h2 class="slide-title">${formatHeading(slide.heading)}</h2>
                </div>
            </div>
            <div class="slide-body">${bodyHTML}</div>
            ${renderFooter(courseTitle, pageNum, totalPages)}
        </div>`;
    }

    // 콘텐츠 슬라이드: 본문 형태 자동 감지
    const shape = detectBodyShape(body);
    let bodyHTML = '';
    let extraClass = '';

    if (shape === 'hero') {
        const plain = body.replace(/<[^>]+>/g, '').replace(/[#*_`>]/g, '').trim();
        return `<div class="slide-container">
            <div class="slide-header">
                <div>
                    <h2 class="slide-title">${formatHeading(slide.heading)}</h2>
                </div>
            </div>
            <div class="slide-body slide-hero">
                <div class="hero-title">${htmlEscape(plain)}</div>
            </div>
            ${renderFooter(courseTitle, pageNum, totalPages)}
        </div>`;
    }

    if (shape === 'tiled') {
        const bulletLines = body.split('\n').filter(l => /^\s*[-*•]\s|^\s*\d+\.\s/.test(l));
        const cols = bulletLines.length === 4 ? 2 : Math.min(bulletLines.length, 3);
        const tilesHTML = bulletsToTiles(bulletLines.slice(0, 6));
        return `<div class="slide-container">
            <div class="slide-header">
                <div><h2 class="slide-title">${formatHeading(slide.heading)}</h2></div>
            </div>
            <div class="slide-body" style="display:flex;align-items:center;">
                <div class="tiled-content cols-${cols}" style="width:100%;">${tilesHTML}</div>
            </div>
            ${renderFooter(courseTitle, pageNum, totalPages)}
        </div>`;
    }

    // 일반 마크다운 → marked로 렌더
    bodyHTML = (typeof marked !== 'undefined') ? marked.parse(body) : body;
    bodyHTML = bodyHTML.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    // 미렌더 mermaid 코드블록 → div.mermaid 변환
    bodyHTML = bodyHTML.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/gi, '<div class="mermaid">$1</div>');
    // 이미지 wrapping
    bodyHTML = bodyHTML.replace(/<img([^>]*)>/gi, (match, attrs) => {
        if (match.includes('image-wrapper')) return match;
        return `<div class="image-wrapper"><img${attrs}></div>`;
    });

    // 이미지가 본문에 있으면 두 열 레이아웃 시도
    const imgMatch = bodyHTML.match(/<div class="image-wrapper">[\s\S]*?<\/div>/);
    if (imgMatch && shape !== 'mermaid' && shape !== 'table') {
        const imgHTML = imgMatch[0];
        const textHTML = bodyHTML.replace(imgMatch[0], '').trim();
        if (textHTML.replace(/<[^>]+>/g, '').trim().length > 30) {
            return `<div class="slide-container">
                <div class="slide-header">
                    <div><h2 class="slide-title">${formatHeading(slide.heading)}</h2></div>
                </div>
                <div class="slide-body">
                    <div class="two-column right-heavy">
                        <div>${textHTML}</div>
                        <div>${imgHTML}</div>
                    </div>
                </div>
                ${renderFooter(courseTitle, pageNum, totalPages)}
            </div>`;
        }
    }

    return `<div class="slide-container ${extraClass}">
        <div class="slide-header">
            <div><h2 class="slide-title">${formatHeading(slide.heading)}</h2></div>
        </div>
        <div class="slide-body">${bodyHTML}</div>
        ${renderFooter(courseTitle, pageNum, totalPages)}
    </div>`;
}

function formatHeading(h) {
    if (!h) return '';
    // "GAME · DESIGN" 형태로 첫 단어 강조
    const safe = htmlEscape(h);
    return safe;
}

function renderFooter(courseTitle, pageNum, totalPages, hide) {
    if (hide) return '';
    if (!pageNum && !totalPages) return '';
    return `<div class="slide-footer">
        <span class="brand">${htmlEscape(courseTitle || '디벨로켓 교안')}</span>
        <span class="page-num">${pageNum}/${totalPages}</span>
    </div>`;
}

function renderQuizBody(body) {
    let bodyHTML = (typeof marked !== 'undefined') ? marked.parse(body) : body;
    // 보기 번호 앞 줄바꿈
    bodyHTML = bodyHTML.replace(/([^\n<])(\s*)([①②③④⑤])/g, '$1<br>$3');
    bodyHTML = bodyHTML.replace(/<span\s+style="[^"]*color[^"]*"[^>]*>(.*?)<\/span>/gi, '$1');
    bodyHTML = bodyHTML.replace(/<p>[^<]*[✅☑️][^<]*정답[^<]*<\/p>/gi, '');
    bodyHTML = bodyHTML.replace(/<p>\s*<strong>[✅☑️]?\s*정답[\s\S]*?<\/p>/gi, '');
    bodyHTML = bodyHTML.replace(/<p>[^<]*[📝🗒️][^<]*해설[^<]*<\/p>/gi, '');
    bodyHTML = bodyHTML.replace(/<p>\s*<strong>[📝🗒️]?\s*해설[\s\S]*?<\/p>/gi, '');
    return bodyHTML;
}

// ═══════════════════════════════════════════════════════════════
// 자동 보강: 표지·학습목표·정리·감사 슬라이드 추가
// ═══════════════════════════════════════════════════════════════
function augmentSlides(slides, courseTitle) {
    const out = [];
    let hasCover = slides[0] && (slides[0].type === 'title' || slides[0].type === 'cover');
    let hasClosing = slides.some(s => /감사|마무리|정리|요약|Thank/i.test(s.heading || ''));

    if (!hasCover) {
        out.push({ type: 'cover', heading: courseTitle || '슬라이드', body: '발표용 슬라이드', level: 1 });
    }

    // 섹션 디바이더 자동 번호
    let partNum = 0;
    for (const s of slides) {
        if (s.type === 'section' || (s.level === 1 && !s.body)) {
            partNum++;
            out.push({ ...s, type: 'section', partLabel: `Part ${String(partNum).padStart(2, '0')}` });
        } else {
            out.push(s);
        }
    }

    if (!hasClosing) {
        // 핵심 섹션 제목 5개 모음
        const keys = slides.filter(s => s.heading && s.type !== 'title' && s.type !== 'section' && s.type !== 'cover')
            .slice(0, 4).map(s => '- ' + s.heading);
        out.push({
            type: 'cover', heading: '감사합니다',
            body: keys.length ? `오늘 다룬 핵심\n\n${keys.join('\n')}` : 'Thank you',
            level: 1
        });
    }

    return out;
}

// ═══════════════════════════════════════════════════════════════
// 본문 과다 슬라이드 자동 분할 (16:9 프레임 초과·가독성 저하 방지)
//   - 순수 텍스트(불릿/문단/소제목) 본문만 대상
//   - 이미지·표·mermaid·코드 본문은 전용 레이아웃이 따로 처리하므로 제외
//   - 분할 후속 페이지는 제목에 " (계속)"을 붙여 연속성을 표시
// ═══════════════════════════════════════════════════════════════
function estimateUnitHeight(unit) {
    const CPL = 32;        // 한 줄 추정 글자 수(보수적 과대추정 → 분할을 일찍 유도)
    const LINE_H = 38;     // 줄 높이(px, 본문 22px·line-height≈1.6 + 여유)
    const ITEM_PAD = 18;   // 항목 간 여백(px)
    if (unit.type === 'heading') return 52;
    const plain = String(unit.text || '').replace(/<[^>]+>/g, '').replace(/[#*_`>]/g, '').trim();
    const lines = Math.max(1, Math.ceil(plain.length / CPL));
    return lines * LINE_H + ITEM_PAD;
}

function splitBodyIntoUnits(body) {
    // 본문을 분할 단위(top-level 불릿/문단/소제목)로 쪼갠다.
    const rawLines = String(body || '').split('\n');
    const units = [];
    let para = null; // 누적 중인 문단 라인들
    const flushPara = () => {
        if (para && para.length) units.push({ type: 'para', text: para.join('\n') });
        para = null;
    };
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (!line.trim()) { flushPara(); continue; }
        // 소제목
        if (/^#{1,6}\s+/.test(line)) {
            flushPara();
            units.push({ type: 'heading', text: line });
            continue;
        }
        // top-level 불릿/번호 (들여쓰기 없음)
        if (/^(?:[-*•]|\d+[.)])\s+/.test(line)) {
            flushPara();
            const item = [line];
            // 뒤따르는 들여쓰기 하위 라인(중첩 불릿 포함) 흡수
            while (i + 1 < rawLines.length && /^\s+\S/.test(rawLines[i + 1])) {
                item.push(rawLines[++i]);
            }
            units.push({ type: 'bullet', text: item.join('\n') });
            continue;
        }
        // 일반 문단 라인 누적
        if (!para) para = [];
        para.push(line);
    }
    flushPara();
    return units;
}

function paginateSlides(slides) {
    const PAGE_BUDGET = 720; // 페이지당 추정 본문 높이 상한(px) — 초과 시 분할
    const MAX_PAGES = 12;    // 원본 1슬라이드당 최대 분할 수(폭주 방지)
    const out = [];

    for (const slide of slides) {
        // 분할 대상이 아닌 타입(표지·섹션·퀴즈 등)은 그대로 통과
        if (!slide || (slide.type !== 'content' && slide.type !== 'data-table')) {
            out.push(slide);
            continue;
        }
        const body = preProcessSlideBody(slide.body || '');
        // 특수 본문(이미지·표·mermaid·코드)은 분할 제외 — 전용 레이아웃이 처리
        const hasImage = /<img\b|image-wrapper|!\[/.test(body);
        const hasTable = /<table/i.test(body) || /^\|.*\|.*\n\|?\s*[-:|\s]+/m.test(body);
        const hasMermaid = /```mermaid|class="mermaid"/.test(body);
        const hasCode = /```/.test(body);
        if (hasImage || hasTable || hasMermaid || hasCode) {
            out.push(slide);
            continue;
        }

        const units = splitBodyIntoUnits(body);
        if (units.length <= 1) { out.push(slide); continue; }

        // 전체 추정 높이가 한 페이지 예산 이내면 분할 불필요
        const totalH = units.reduce((sum, u) => sum + estimateUnitHeight(u), 0);
        if (totalH <= PAGE_BUDGET) { out.push(slide); continue; }

        // 그리디 패킹: 단위들을 페이지 예산까지 채운다(페이지당 최소 1단위 보장)
        const pages = [];
        let cur = [];
        let curH = 0;
        for (const u of units) {
            const h = estimateUnitHeight(u);
            if (cur.length > 0 && curH + h > PAGE_BUDGET) {
                pages.push(cur);
                cur = [];
                curH = 0;
            }
            cur.push(u);
            curH += h;
        }
        if (cur.length) pages.push(cur);

        // 고아 소제목 방지: 페이지 끝에 소제목만 남으면 다음 페이지로 이동
        for (let p = 0; p < pages.length - 1; p++) {
            while (pages[p].length > 1 && pages[p][pages[p].length - 1].type === 'heading') {
                pages[p + 1].unshift(pages[p].pop());
            }
        }

        // 비정상(과다 분할/분할 불가) 입력 방어 → 원본 유지
        if (pages.length <= 1 || pages.length > MAX_PAGES) {
            out.push(slide);
            continue;
        }

        pages.forEach((pg, idx) => {
            const pageBody = pg.map(u => u.text).join('\n');
            const heading = idx === 0 ? slide.heading : `${slide.heading || ''} (계속)`.trim();
            out.push({ ...slide, heading, body: pageBody });
        });
    }

    return out;
}

// ═══════════════════════════════════════════════════════════════
// 전체 슬라이드 HTML 빌드
// ═══════════════════════════════════════════════════════════════
function buildSlideHTML(markdown, title) {
    // 마크다운 정합성 보정 (표 다중라인 복구, 강사 마커 래핑 등)
    if (typeof sanitizeMarkdownContent === 'function') {
        try { markdown = sanitizeMarkdownContent(markdown); } catch (e) { /* noop */ }
    }
    let slides = parseMarkdownToSlides(markdown);
    if (slides.length === 0) {
        slides.push({ type: 'cover', heading: title, body: '', level: 1 });
    }
    slides = augmentSlides(slides, title);
    slides = paginateSlides(slides);   // 본문 과다 슬라이드 분할 (16:9 초과·클리핑 방지)
    const total = slides.length;

    const slidesHTML = slides.map((s, i) => slideToHTML(s, {
        pageNum: i + 1, totalPages: total, courseTitle: title
    })).join('\n\n');

    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${htmlEscape(title)} - 슬라이드</title>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"><\/script>
    <style>${SLIDE_CSS}</style>
</head>
<body>
    ${slidesHTML}

    <div class="slide-counter"><span id="slide-num">1</span> / ${total}</div>
    <div class="slide-nav">
        <button onclick="goTo(currentSlide-1)" title="이전 (←)">‹</button>
        <button onclick="goTo(currentSlide+1)" title="다음 (→ / Space)">›</button>
    </div>

    <script>
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose',
                themeVariables: { primaryColor: '#1F497D', primaryTextColor: '#F5F7FA', lineColor: '#4BACC6', secondaryColor: '#162B5C' } });
            document.querySelectorAll('pre code.language-mermaid, code.language-mermaid').forEach(el => {
                const div = document.createElement('div');
                div.className = 'mermaid';
                div.textContent = el.textContent;
                (el.closest('pre') || el).replaceWith(div);
            });
            setTimeout(() => { try { mermaid.run({ suppressErrors: true }); } catch(e) {} setTimeout(fitSlides, 120); }, 200);
        }
        let currentSlide = 0;
        const slides = document.querySelectorAll('.slide-container');
        function goTo(n) {
            currentSlide = Math.max(0, Math.min(n, slides.length - 1));
            slides[currentSlide].scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.getElementById('slide-num').textContent = currentSlide + 1;
        }
        document.addEventListener('keydown', e => {
            if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goTo(currentSlide + 1); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(currentSlide - 1); }
            if (e.key === 'Home') goTo(0);
            if (e.key === 'End') goTo(slides.length - 1);
        });
        // 스크롤 시 페이지 번호 동기화
        const io = new IntersectionObserver(entries => {
            entries.forEach(en => {
                if (en.isIntersecting) {
                    const idx = Array.from(slides).indexOf(en.target);
                    if (idx >= 0) { currentSlide = idx; document.getElementById('slide-num').textContent = idx + 1; }
                }
            });
        }, { threshold: 0.6 });
        slides.forEach(s => io.observe(s));
        // ── 자동 맞춤(shrink-to-fit): 16:9 프레임을 절대 초과하지 않도록 본문을 축소 ──
        function fitSlides() {
            document.querySelectorAll('.slide-body').forEach(el => {
                el.style.transform = '';
                el.style.transformOrigin = 'top left';
                const availH = el.clientHeight, availW = el.clientWidth;
                if (availH <= 0 || availW <= 0) return;
                const needH = el.scrollHeight, needW = el.scrollWidth;
                const sH = needH > availH ? availH / needH : 1;
                const sW = needW > availW ? availW / needW : 1;
                let scale = Math.min(sH, sW);
                if (scale < 1) {
                    if (scale < 0.4) scale = 0.4;
                    el.style.transform = 'scale(' + scale + ')';
                }
            });
        }
        window.addEventListener('load', () => setTimeout(fitSlides, 80));
        window.addEventListener('resize', () => { clearTimeout(window.__fitT); window.__fitT = setTimeout(fitSlides, 150); });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => setTimeout(fitSlides, 50));
        document.querySelectorAll('.slide-body img').forEach(img => {
            if (!img.complete) img.addEventListener('load', () => setTimeout(fitSlides, 30), { once: true });
        });
        setTimeout(fitSlides, 300);
    <\/script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════
// HTML 다운로드
// ═══════════════════════════════════════════════════════════════
window.exportToSlideHTML = function () {
    const mod = getEditingModule();
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');

    const content = (mod.tabContents && mod.tabContents[currentLessonTab]) || mod.content;
    if (!content) return window.showAlert('교안 내용이 없습니다.');

    let html = buildSlideHTML(content, mod.title);
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

// ═══════════════════════════════════════════════════════════════
// PPTX 내보내기 — HTML 디자인 토큰과 동기화
// ═══════════════════════════════════════════════════════════════
window.exportToPptx = async function () {
    if (typeof PptxGenJS === 'undefined') {
        return window.showAlert('슬라이드 라이브러리(PptxGenJS)를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
    }
    const mod = getEditingModule();
    if (!mod) {
        if (typeof window.exportSubjectToPptx === 'function') return window.exportSubjectToPptx();
        return window.showAlert('차시를 먼저 선택해주세요.');
    }

    let content = (mod.tabContents && mod.tabContents[currentLessonTab]) || mod.content;
    if (!content) return window.showAlert('교안 내용이 없습니다.');

    // ── 참고 이미지 준비: 본문에 미생성 [IMG] 태그가 있으면 먼저 생성 ──
    // (본문 참고 이미지는 인용하고, 부족한 것은 생성)
    if (content.includes('<!-- [IMG:') && typeof processImageTags === 'function') {
        try {
            if (window.showToast) window.showToast('🖼️ 슬라이드용 참고 이미지를 준비하는 중입니다...', 'info');
            const withImages = await processImageTags(mod, content);
            if (withImages) {
                content = withImages;
                if (mod.tabContents && mod.tabContents[currentLessonTab]) mod.tabContents[currentLessonTab] = content;
                else mod.content = content;
            }
        } catch (imgErr) {
            // 이미지 생성 실패 시에도 텍스트 슬라이드는 정상 진행
        }
    }

    try {
        const pptx = new PptxGenJS();
        pptx.defineLayout({ name: 'WIDE16x9', width: 13.33, height: 7.5 });
        pptx.layout = 'WIDE16x9';
        pptx.title = mod.title || '교안 슬라이드';
        pptx.company = '디벨로켓';

        const T = PPTX_T;
        const FONT = 'Pretendard';
        const FALLBACK = 'Malgun Gothic';

        // ── 마스터 슬라이드 (배경·푸터·페이지 번호 자동) ──
        pptx.defineSlideMaster({
            title: 'CONTENT_MASTER',
            background: { color: T.bg },
            objects: [
                // 푸터 라인
                { rect: { x: 0.5, y: 7.05, w: 12.33, h: 0.01, fill: { color: T.border } } },
                // 브랜드
                { text: { text: mod.title || '디벨로켓 교안', options: { x: 0.5, y: 7.10, w: 8, h: 0.3, fontSize: 10, fontFace: FONT, color: T.accent, bold: true } } },
            ],
            slideNumber: { x: 12.5, y: 7.10, w: 0.7, h: 0.3, fontFace: FONT, fontSize: 10, color: T.muted, align: 'right' },
        });
        pptx.defineSlideMaster({
            title: 'COVER_MASTER',
            background: { color: '0B1120' },
            objects: [
                { rect: { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: '0B1120' } } },
                // 우측 장식 원
                { rect: { x: 10.5, y: -1, w: 4, h: 4, fill: { color: '1F497D' }, line: { type: 'none' } } },
                { rect: { x: 0.5, y: 6.7, w: 2, h: 0.05, fill: { color: T.accent } } },
            ],
        });

        // ── 표지 ──
        const cover = pptx.addSlide({ masterName: 'COVER_MASTER' });
        cover.addText(mod.title || '교안 슬라이드', {
            x: 0.6, y: 2.0, w: 9.5, h: 1.6, fontSize: 54, fontFace: FONT,
            color: T.h, bold: true, valign: 'middle', autoFit: true,
        });
        const tabLabel = typeof LESSON_TABS !== 'undefined' ? (LESSON_TABS.find(t => t.id === currentLessonTab) || {}).label || '' : '';
        if (tabLabel) {
            cover.addText(tabLabel, {
                x: 0.6, y: 3.7, w: 9.5, h: 0.6, fontSize: 24, fontFace: FONT, color: T.accent, bold: true,
            });
        }
        cover.addText('Lecture Material · 발표용 슬라이드', {
            x: 0.6, y: 4.4, w: 9.5, h: 0.5, fontSize: 16, fontFace: FONT, color: T.sub,
        });
        // 우측 데코
        cover.addShape(pptx.ShapeType.rect, { x: 11.0, y: 5.5, w: 1.5, h: 0.05, fill: { color: T.accent } });
        cover.addText('디벨로켓', { x: 11.0, y: 5.6, w: 2, h: 0.4, fontSize: 14, fontFace: FONT, color: T.muted, bold: true });

        // ── 본문 섹션 파싱 ──
        const rawSections = content.split(/^(?=#{1,2}\s)/m).filter(s => s.trim());
        const modImages = mod.images || {};
        const parsed = [];
        for (const section of rawSections) {
            const lines = section.trim().split('\n');
            const firstLine = lines[0].trim();
            const heading = cleanText(firstLine.replace(/^#{1,4}\s*/, ''));
            const fullBody = preProcessSlideBody(lines.slice(1).join('\n'));
            // 본문이 실질적으로 비어 있을 때만 '구분 슬라이드'로 처리
            // (표·불릿·이미지·산문이 있으면 반드시 콘텐츠 슬라이드로 — 누락 방지)
            const _plain = fullBody.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '');
            const _hasBullets = /^\s*(?:[-*•]|\d+\.)\s+\S/m.test(_plain);
            const _hasTable = /\|.*\|/.test(fullBody) && /\|[\s:|-]+\|/.test(fullBody);
            const _hasImage = /local:|data:image|<img|!\[/.test(fullBody);
            const _proseLen = _plain.replace(/[#>*`~\-|]/g, '').replace(/\s+/g, '').length;
            const isDivider = !(_hasBullets || _hasTable || _hasImage || _proseLen >= 12);

            // 본문 참고 이미지 수집 (local:imgId → data URL, 인라인 data: 포함)
            const imgs = [];
            const seenIds = new Set();
            let _m; const _re = /local:([^"'\s>)]+)/g;
            while ((_m = _re.exec(fullBody)) !== null) {
                const id = _m[1];
                if (!seenIds.has(id) && modImages[id] && String(modImages[id]).startsWith('data:')) {
                    seenIds.add(id); imgs.push(modImages[id]);
                }
            }
            let _d; const _reD = /(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)/g;
            while ((_d = _reD.exec(fullBody)) !== null) { if (!imgs.includes(_d[1])) imgs.push(_d[1]); }

            parsed.push({ heading, body: fullBody, isDivider, images: imgs });
        }

        // ── 부족한 참고 이미지 생성 (본문 이미지 인용 우선, 없는 본문 단락은 생성) ──
        const NO_IMG = /학습\s*목표|objectives?|개요|overview|요약|정리|마무리|summary|채점|루브릭|평가\s*기준|q\s*&?\s*a/i;
        const needGen = parsed.filter(s => !s.isDivider && s.images.length === 0
            && !NO_IMG.test(s.heading)
            && !/\n\s*\|.*\|/.test(s.body)
            && cleanText(s.body).replace(/\s+/g, '').length >= 80);
        const toGen = needGen.slice(0, 16); // 생성 상한 (대기시간·rate limit 보호)
        if (toGen.length && typeof generateImageAPI === 'function') {
            _pptProgress(0, `강의용 참고 이미지 생성 준비 (${toGen.length}장)`);
            for (let i = 0; i < toGen.length; i++) {
                const s = toGen[i];
                _pptProgress(Math.round((i / toGen.length) * 100), `참고 이미지 생성 ${i + 1}/${toGen.length} — ${s.heading}`);
                try {
                    const b64 = await generateImageAPI(_pptBuildGenPrompt(s.heading, cleanText(s.body)));
                    if (b64 && String(b64).startsWith('data:')) {
                        const id = 'img_' + Date.now() + Math.floor(Math.random() * 1000);
                        modImages[id] = b64; s.images.push(b64);
                    }
                } catch (e) { /* 개별 실패는 텍스트 슬라이드로 진행 */ }
                if (i < toGen.length - 1) await new Promise(r => setTimeout(r, 800));
            }
            mod.images = modImages;
            if (typeof saveState === 'function') { try { await saveState(); } catch (e) {} }
            _pptProgressDone(`참고 이미지 ${toGen.length}장 준비 완료`);
        }

        // ── 슬라이드 렌더 ──
        const _titleKey = (mod.title || '').replace(/\s/g, '');
        let partNum = 0;
        for (const s of parsed) {
            if (s.isDivider) {
                // 표지와 동일 제목의 빈 섹션은 생략 (중복 타이틀 방지)
                if (s.heading && _titleKey && s.heading.replace(/\s/g, '') === _titleKey) continue;
                partNum++; addPartDivider(pptx, T, FONT, partNum, s.heading); continue;
            }
            renderContentSection(pptx, T, FONT, s.heading, s.body, partNum, s.images);
        }

        // ── 마무리 ──
        const endSlide = pptx.addSlide({ masterName: 'COVER_MASTER' });
        endSlide.addText('감사합니다', {
            x: 0.6, y: 2.4, w: 12.13, h: 1.6, fontSize: 64, fontFace: FONT,
            color: T.h, bold: true, align: 'center',
        });
        endSlide.addShape(pptx.ShapeType.rect, { x: 5.7, y: 4.2, w: 2, h: 0.06, fill: { color: T.accent } });
        endSlide.addText('Thank You', {
            x: 0.6, y: 4.5, w: 12.13, h: 0.6, fontSize: 22, fontFace: FONT, color: T.sub, align: 'center',
        });

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

// ── PPTX 유틸리티 ──
function cleanText(s) {
    return String(s || '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/[■▣●]/g, '')
        .trim();
}

function addPartDivider(pptx, T, FONT, partNum, heading) {
    const sl = pptx.addSlide({ masterName: 'COVER_MASTER' });
    sl.addText(`PART ${String(partNum).padStart(2, '0')}`, {
        x: 0.6, y: 2.4, w: 12.13, h: 0.5, fontSize: 18, fontFace: FONT,
        color: T.accent, bold: true, align: 'center', charSpacing: 4,
    });
    sl.addShape(pptx.ShapeType.rect, { x: 6.16, y: 3.05, w: 1, h: 0.05, fill: { color: T.accent } });
    sl.addText(heading || '(제목 없음)', {
        x: 0.6, y: 3.3, w: 12.13, h: 1.8, fontSize: 48, fontFace: FONT,
        color: T.h, bold: true, align: 'center', valign: 'top',
    });
}

function renderContentSection(pptx, T, FONT, heading, body, partNum, imageData) {
    // imageData: 이 섹션에 인용/생성된 참고 이미지 data URL 배열
    const imgs = (imageData || []).filter(d => d && String(d).startsWith('data:'));

    // 본문 분석
    const tableRows = [];
    const processed = [];
    const bullets = [];
    let inCodeBlock = false;
    let inTable = false;

    body.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('```')) { inCodeBlock = !inCodeBlock; return; }
        if (inCodeBlock) return;
        if (!trimmed) { inTable = false; return; }
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            if (trimmed.match(/^\|[\s:|-]+\|$/)) return;
            inTable = true;
            tableRows.push(trimmed.split('|').filter(c => c.trim()).map(c => cleanText(c)));
            return;
        }
        inTable = false;
        const bm = trimmed.match(/^[-*•]\s+(.+)/) || trimmed.match(/^\d+\.\s+(.+)/);
        if (bm) { bullets.push(cleanText(bm[1])); return; }
        const c = cleanText(trimmed);
        if (c) processed.push(c);
    });

    const textItems = [...bullets, ...processed].filter(Boolean);
    const hasText = textItems.length > 0;

    // (A) 표 — 페이지 분할 (표는 전체 폭 우선, 이미지는 표 뒤 별도 슬라이드)
    if (tableRows.length >= 2) {
        const header = tableRows[0];
        const rows = tableRows.slice(1);
        const ROWS_PER_PAGE = 9;
        const totalPages = Math.ceil(rows.length / ROWS_PER_PAGE);
        for (let p = 0; p < totalPages; p++) {
            const sl = pptx.addSlide({ masterName: 'CONTENT_MASTER' });
            _pptHead(pptx, sl, T, FONT, totalPages > 1 ? `${heading} (${p + 1}/${totalPages})` : heading);
            const slice = rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
            const colW = header.map(() => 12.13 / header.length);
            const tblRows = [
                header.map(h => ({ text: h, options: { fontSize: 14, fontFace: FONT, color: T.accent, bold: true, fill: { color: '1A2A4D' }, border: { pt: 1, color: T.border }, valign: 'middle', align: 'center' } })),
                ...slice.map((row, i) => row.map(cell => ({
                    text: cell, options: {
                        fontSize: 12, fontFace: FONT, color: T.txt,
                        fill: { color: i % 2 === 0 ? T.bg : '11203E' }, border: { pt: 1, color: T.border }, valign: 'middle',
                    }
                })))
            ];
            // autoPage:false + rowH로 본문 영역(최대 5.15in) 내 고정 — 16:9 초과 방지
            sl.addTable(tblRows, { x: 0.6, y: 1.7, w: 12.13, colW, rowH: Math.min(0.5, 5.0 / (slice.length + 1)), autoPage: false, valign: 'middle' });
        }
        if (imgs.length) renderSectionImages(pptx, T, FONT, heading, imgs);
        return;
    }

    // (B) 참고 이미지 + 본문 → 2단(텍스트 좌 / 이미지 우) 동일 슬라이드 (강의용)
    if (imgs.length && hasText) {
        const sl = pptx.addSlide({ masterName: 'CONTENT_MASTER' });
        _pptHead(pptx, sl, T, FONT, heading);
        // 좌측 텍스트 컬럼 (최대 7항목, fit:shrink로 박스 내 강제 축소)
        const items = textItems.slice(0, 7).map(row => {
            const isHead = !bullets.includes(row) && row.length < 56 && /^[가-힣A-Z]/.test(row);
            return {
                text: row.length > 110 ? row.substring(0, 107) + '...' : row,
                options: {
                    fontSize: isHead ? 19 : 16, fontFace: FONT, color: isHead ? T.h : T.txt, bold: isHead,
                    ...(isHead ? {} : { bullet: { type: 'number', color: T.accent } }),
                    breakLine: true, paraSpaceBefore: isHead ? 10 : 5, paraSpaceAfter: 5,
                }
            };
        });
        sl.addText(items, { x: 0.6, y: 1.7, w: 6.45, h: 5.05, valign: 'top', wrap: true, fit: 'shrink' });
        // 우측 이미지 카드 (contain — 절대 초과 안 함)
        _pptImageCard(pptx, sl, T, imgs[0], { x: 7.25, y: 1.72, w: 5.45, h: 5.06 });
        // 여분 이미지(2장 이상)는 뒤에 별도 슬라이드
        if (imgs.length > 1) renderSectionImages(pptx, T, FONT, heading, imgs.slice(1));
        return;
    }

    // (C) 참고 이미지만 있고 본문 텍스트가 거의 없음 → 전체 이미지 슬라이드
    if (imgs.length && !hasText) {
        renderSectionImages(pptx, T, FONT, heading, imgs);
        return;
    }

    // (D) 짧은 불릿 3~6개 — 카드형 (이미지 없음)
    const shortBullets = bullets.filter(b => b.length < 70);
    if (shortBullets.length >= 3 && shortBullets.length <= 6 && shortBullets.length === bullets.length) {
        const sl = pptx.addSlide({ masterName: 'CONTENT_MASTER' });
        _pptHead(pptx, sl, T, FONT, heading);
        const cards = shortBullets.slice(0, 6);
        const cols = cards.length <= 2 ? cards.length : (cards.length === 4 ? 2 : 3);
        const rows = Math.ceil(cards.length / cols);
        const gap = 0.25;
        const cw = (12.13 - (cols - 1) * gap) / cols;
        const startY = 1.85;
        const ch = (5.0 - (rows - 1) * gap) / rows;
        cards.forEach((card, i) => {
            const r = Math.floor(i / cols), c = i % cols;
            const cx = 0.6 + c * (cw + gap), cy = startY + r * (ch + gap);
            sl.addShape(pptx.ShapeType.roundRect, { x: cx, y: cy, w: cw, h: ch, fill: { color: T.card }, line: { color: T.border, width: 1 }, rectRadius: 0.12 });
            sl.addShape(pptx.ShapeType.rect, { x: cx, y: cy, w: cw, h: 0.08, fill: { color: T.accent } });
            sl.addShape(pptx.ShapeType.roundRect, { x: cx + 0.25, y: cy + 0.3, w: 0.55, h: 0.55, fill: { color: T.accent }, rectRadius: 0.08 });
            sl.addText(String(i + 1).padStart(2, '0'), { x: cx + 0.25, y: cy + 0.3, w: 0.55, h: 0.55, fontSize: 18, fontFace: FONT, color: '0B1120', bold: true, align: 'center', valign: 'middle' });
            const m = card.match(/^([^:：]{2,40})[:：]\s*(.+)/);
            if (m) {
                sl.addText(m[1].trim(), { x: cx + 0.95, y: cy + 0.3, w: cw - 1.15, h: 0.55, fontSize: 17, fontFace: FONT, color: T.h, bold: true, valign: 'middle', fit: 'shrink' });
                sl.addText(m[2].trim(), { x: cx + 0.25, y: cy + 1.0, w: cw - 0.5, h: ch - 1.2, fontSize: 14, fontFace: FONT, color: T.txt, valign: 'top', wrap: true, fit: 'shrink' });
            } else {
                sl.addText(card, { x: cx + 0.25, y: cy + 1.0, w: cw - 0.5, h: ch - 1.2, fontSize: 15, fontFace: FONT, color: T.h, valign: 'top', wrap: true, fit: 'shrink' });
            }
        });
        return;
    }

    // (E) 일반 콘텐츠 — 불릿 슬라이드 (라인 예산 기반 페이지 분할 + fit:shrink)
    if (textItems.length > 0) {
        const MAX_ITEMS = 7, LINE_BUDGET = 13;
        const estLines = (row) => {
            const isHead = !bullets.includes(row) && row.length < 60 && /^[가-힣A-Z]/.test(row);
            const cpl = isHead ? 36 : 48;
            const len = Math.min(row.length, 130);
            return Math.max(1, Math.ceil(len / cpl)) + 0.6;
        };
        const pageChunks = [];
        let cur = [], curLines = 0;
        for (const row of textItems) {
            const l = estLines(row);
            if (cur.length > 0 && (curLines + l > LINE_BUDGET || cur.length >= MAX_ITEMS)) { pageChunks.push(cur); cur = []; curLines = 0; }
            cur.push(row); curLines += l;
        }
        if (cur.length) pageChunks.push(cur);

        const pages = pageChunks.length;
        pageChunks.forEach((chunk, p) => {
            const sl = pptx.addSlide({ masterName: 'CONTENT_MASTER' });
            _pptHead(pptx, sl, T, FONT, pages > 1 ? `${heading} (${p + 1}/${pages})` : heading);
            const items = chunk.map(row => {
                const isHead = !bullets.includes(row) && row.length < 60 && /^[가-힣A-Z]/.test(row);
                return {
                    text: row.length > 130 ? row.substring(0, 127) + '...' : row,
                    options: {
                        fontSize: isHead ? 22 : 18, fontFace: FONT, color: isHead ? T.h : T.txt, bold: isHead,
                        ...(isHead ? {} : { bullet: { type: 'number', color: T.accent } }),
                        breakLine: true, paraSpaceBefore: isHead ? 14 : 6, paraSpaceAfter: 6,
                    }
                };
            });
            sl.addText(items, { x: 0.6, y: 1.75, w: 12.13, h: 5.1, valign: 'top', wrap: true, fit: 'shrink' });
        });
        return;
    }
}

// ── 공통: 제목 + 구분선 ──
function _pptHead(pptx, sl, T, FONT, title) {
    const t = String(title || '');
    sl.addText(t.length > 80 ? t.substring(0, 77) + '...' : t, {
        x: 0.6, y: 0.4, w: 12.13, h: 0.9, fontSize: 30, fontFace: FONT, color: T.accent, bold: true, valign: 'middle', fit: 'shrink',
    });
    sl.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.45, w: 12.13, h: 0.025, fill: { color: T.border } });
}

// ── 공통: 이미지 카드 (프레임 + contain — 16:9 절대 초과 안 함) ──
function _pptImageCard(pptx, sl, T, data, box) {
    if (!data || !String(data).startsWith('data:')) return;
    sl.addShape(pptx.ShapeType.roundRect, { x: box.x, y: box.y, w: box.w, h: box.h, fill: { color: '0E1A33' }, line: { color: T.border, width: 1 }, rectRadius: 0.10 });
    const pad = 0.18;
    sl.addImage({ data, x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: box.h - pad * 2, sizing: { type: 'contain', w: box.w - pad * 2, h: box.h - pad * 2 } });
}

// ── 참고 이미지 전용 슬라이드 (data URL 배열, 16:9 contain) ──
function renderSectionImages(pptx, T, FONT, heading, dataUrls) {
    (dataUrls || []).forEach((data, i) => {
        if (!data || !String(data).startsWith('data:')) return;
        const sl = pptx.addSlide({ masterName: 'CONTENT_MASTER' });
        const title = dataUrls.length > 1 ? `${heading} · 참고 이미지 (${i + 1}/${dataUrls.length})` : `${heading} · 참고 이미지`;
        _pptHead(pptx, sl, T, FONT, title);
        _pptImageCard(pptx, sl, T, data, { x: 0.6, y: 1.7, w: 12.13, h: 5.15 });
    });
}

// ── 강의용 참고 이미지 생성 프롬프트 (글자 없는 개념 일러스트) ──
function _pptBuildGenPrompt(title, plain) {
    const t = String(title || '').replace(/^\d+[.)]\s*/, '').replace(/[:：]\s*$/, '').trim();
    const ctx = String(plain || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    return `Educational concept illustration for a lecture slide titled "${t}". Context: ${ctx}. Modern flat digital art, clean, professional, high detail, 16:9 wide composition, soft lighting. No text, no letters, no words, no numbers, no labels, no captions, no watermark anywhere in the image.`;
}

// ── PPT 변환 진행바 ──
function _pptProgress(pct, label) {
    let bar = document.getElementById('ppt-progress-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'ppt-progress-bar';
        bar.style.cssText = 'position:fixed;top:0;left:0;width:100%;z-index:99999;background:rgba(11,17,32,0.96);color:#fff;padding:12px 24px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:16px;backdrop-filter:blur(8px);';
        document.body.appendChild(bar);
    }
    bar.innerHTML = `<div style="flex:1"><div style="margin-bottom:6px;">📊 PPT 변환 — <span style="color:#4BACC6;">${label}</span></div><div style="width:100%;height:6px;background:rgba(255,255,255,0.15);border-radius:4px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#4BACC6,#A78BFA);border-radius:4px;transition:width .4s;"></div></div></div><span style="font-size:18px;min-width:48px;text-align:right;">${pct}%</span>`;
}
function _pptProgressDone(label) {
    const bar = document.getElementById('ppt-progress-bar');
    if (!bar) return;
    bar.innerHTML = `<div style="flex:1;text-align:center;">✅ ${label}</div>`;
    setTimeout(() => bar.remove(), 2200);
}
function _pptProgressFail(label) {
    const bar = document.getElementById('ppt-progress-bar');
    if (!bar) return;
    bar.innerHTML = `<div style="flex:1;color:#f87171;">⚠️ ${label}</div>`;
    setTimeout(() => bar.remove(), 4000);
}

// ═══════════════════════════════════════════════════════════════
// 교과 전체 슬라이드 HTML 내보내기
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// 교과 전체 PPTX 내보내기
// ═══════════════════════════════════════════════════════════════
window.exportSubjectToPptx = async function () {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    if (!subj) return window.showAlert('교과를 먼저 선택해주세요.');
    const lessonList = subj.lessons || [];
    if (!lessonList.length) return window.showAlert('내보낼 차시가 없습니다.');
    if (typeof PptxGenJS === 'undefined') return window.showAlert('PptxGenJS를 불러오는 중입니다.');

    let count = 0;
    const downloadNext = async (idx) => {
        if (idx >= lessonList.length) {
            window.showToast(`📁 ${count}개 차시 PPTX 다운로드 완료`, 'success');
            return;
        }
        const mod = lessonList[idx];
        const allContent = Object.entries(mod.tabContents || {}).map(([k, v]) => v || '').filter(Boolean).join('\n\n---\n\n');
        if (!allContent) { downloadNext(idx + 1); return; }

        const prevModId = typeof currentEditingModuleId !== 'undefined' ? currentEditingModuleId : null;
        if (typeof currentEditingModuleId !== 'undefined') currentEditingModuleId = mod.id;

        try {
            await window.exportToPptx();
            count++;
        } catch (e) { console.warn('[PPTX Subject Export]', e); }

        if (typeof currentEditingModuleId !== 'undefined' && prevModId) currentEditingModuleId = prevModId;
        setTimeout(() => downloadNext(idx + 1), 2000);
    };
    downloadNext(0);
};

// ═══════════════════════════════════════════════════════════════
// 슬라이드 뷰 패널 — 보기 / 수정 / 내려받기
// ═══════════════════════════════════════════════════════════════
let _slideViewMode = 'view';
let _slideHtmlCache = '';
let _slideMdCache = '';
let _slideModRef = null;

// 인라인 슬라이드 iframe을 안전하게 마운트 (요청#4: 슬라이드 생성 실패 방지)
//   기존 방식: innerHTML + srcdoc="${html.replace(/"/g,'&quot;')}" 문자열 인젝션
//   → 대용량/복잡한 HTML(480분 교안)에서 속성값이 깨지며 iframe이 비어 보이는 문제 발생
//   개선: DOM 엘리먼트를 직접 생성하고 srcdoc을 "프로퍼티"로 할당해 파서 의존성 제거
function mountInlineSlideIframe(previewArea, slideHtml) {
    if (!previewArea) return;
    previewArea.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.id = 'slide-inline-iframe';
    iframe.style.cssText = 'width:100%;height:600px;border:1px solid #e2e8f0;border-radius:12px;background:#0B1120;';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    previewArea.appendChild(iframe);
    iframe.srcdoc = slideHtml;
}

window.generateSlideView = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');

    const content = (mod.tabContents && mod.tabContents[currentLessonTab]) || mod.content;
    if (!content) return window.showAlert('교안 내용이 없습니다. 먼저 탭을 생성해주세요.');

    try {
        let slideHtml = buildSlideHTML(content, mod.title);
        if (mod.images) {
            for (const [imgId, b64] of Object.entries(mod.images)) {
                slideHtml = slideHtml.replace(new RegExp(`local:${imgId}`, 'g'), b64);
            }
        }

        _slideHtmlCache = slideHtml;
        _slideMdCache = content;
        _slideModRef = mod;

        const previewArea = document.getElementById('slide-preview-area');
        const statusBadge = document.getElementById('slide-status-badge');
        const downloadBtn = document.getElementById('slide-download-btn');

        mountInlineSlideIframe(previewArea, slideHtml);
        if (statusBadge) {
            statusBadge.textContent = '생성됨';
            statusBadge.className = 'text-[0.6rem] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-bold';
        }
        if (downloadBtn) {
            downloadBtn.classList.remove('hidden');
            downloadBtn.classList.add('flex');
        }
        const regenBtn = document.getElementById('slide-regen-btn');
        if (regenBtn) {
            regenBtn.classList.remove('hidden');
            regenBtn.classList.add('flex');
        }

        if (previewArea) previewArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.showToast) window.showToast('슬라이드가 생성되었습니다.', 'success');
    } catch (err) {
        window.showAlert('슬라이드 생성 실패: ' + (err && err.message ? err.message : err));
    }
};

window.regenerateSlideView = async function (moduleId) {
    const mod = getEditingModule(moduleId) || _slideModRef || getEditingModule();
    if (!mod) return window.showAlert('교안을 먼저 선택해주세요.');

    const content = (mod.tabContents && mod.tabContents[currentLessonTab]) || mod.content;
    if (!content) return window.showAlert('교안 내용이 없습니다.');

    const userRequest = prompt('슬라이드 재생성 요구사항을 입력하세요.\n(예: "핵심만 요약", "표 위주로", "이미지 많이")\n\n비워두면 발표용 핵심 요약으로 자동 생성됩니다.');
    if (userRequest === null) return;

    try {
        const loadingEl = document.getElementById('editor-loading');
        if (loadingEl) loadingEl.style.display = 'flex';

        const defaultInstruction = '발표 자료용으로 핵심을 요약하세요. 각 섹션을 짧은 핵심 포인트 3~5개로 압축하고, 불필요한 상세 설명은 제거하세요.';
        const slidePrompt = `[슬라이드 재생성 작업]
아래 교안 내용을 발표용 슬라이드에 적합하게 재구성하세요.

[사용자 요구사항]
${userRequest || defaultInstruction}

[규칙 — 발표용 슬라이드]
1. 슬라이드당 글자수 최소화 — 한 슬라이드에 핵심 키워드/포인트 3~5개만
2. ## 단위로 섹션을 구분 (각 ## = 한 장의 슬라이드)
3. 각 슬라이드 첫 줄은 핵심 결론 한 문장 (60자 이내)
4. 짧은 불릿 위주 — 한 불릿당 한 줄 (50자 이내)
5. 표·다이어그램·이미지 태그(<!-- [IMG: ...] -->)는 유지
6. 강사 콜아웃(예상 소요/꼭 짚어야/권장 질문/활용 예시) 모두 제거
7. 마크다운 형식 출력

[원본 교안]
${content.substring(0, 15000)}`;

        const payload = {
            contents: [{ parts: [{ text: slidePrompt }] }],
            systemInstruction: { parts: [{ text: '당신은 발표용 교육 슬라이드 디자인 전문가입니다. 정보 과부하 없이 청중이 30초 안에 이해할 수 있는 간결한 슬라이드 마크다운을 작성합니다.' }] }
        };

        const data = await callGemini(TEXT_MODEL, payload);

        const resultText = extractText(data);
        if (!resultText) return window.showAlert('슬라이드 재생성 실패: 응답 없음');

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
        mountInlineSlideIframe(previewArea, slideHtml);

        if (window.showToast) window.showToast('슬라이드가 재생성되었습니다.', 'success');
    } catch (err) {
        window.showAlert('슬라이드 재생성 실패: ' + (err && err.message ? err.message : err));
    } finally {
        const loadingEl = document.getElementById('editor-loading');
        if (loadingEl) loadingEl.style.display = 'none';
    }
};

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

    let slideHtml = buildSlideHTML(content, mod.title);
    if (mod.images) {
        for (const [imgId, b64] of Object.entries(mod.images)) {
            slideHtml = slideHtml.replace(new RegExp(`local:${imgId}`, 'g'), b64);
        }
    }
    _slideHtmlCache = slideHtml;
    _slideMdCache = content;
    _slideModRef = mod;
    _slideViewMode = 'view';

    document.getElementById('slide-view-panel')?.remove();

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
            <iframe id="slide-view-iframe" style="width:100%;max-width:1320px;height:100%;border:none;border-radius:8px;background:#0B1120;"></iframe>
        </div>
        <textarea id="slide-view-editor" style="display:none;flex:1;margin:12px 24px;padding:16px;font-family:'Courier New',monospace;font-size:13px;background:#1a1a2e;color:#e2e8f0;border:1px solid rgba(255,255,255,0.1);border-radius:8px;resize:none;outline:none;"></textarea>
    `;

    document.body.appendChild(panel);

    const iframe = document.getElementById('slide-view-iframe');
    iframe.srcdoc = _slideHtmlCache;

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

    const activeStyle = { bg: 'rgba(34,211,238,0.2)', color: '#22d3ee', border: 'rgba(34,211,238,0.5)' };
    const inactiveStyle = { bg: 'transparent', color: '#9ca3af', border: 'rgba(255,255,255,0.1)' };

    if (mode === 'view') {
        if (editor && !editor.style.display.includes('none') && editor.value) {
            _slideMdCache = editor.value;
            const mod = _slideModRef || getEditingModule();
            let rebuilt = buildSlideHTML(_slideMdCache, (mod && mod.title) || '교안');
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
        if (editor) { editor.value = _slideMdCache; editor.style.display = 'block'; }
        if (content) content.style.display = 'none';
        if (btnView) { btnView.style.background = inactiveStyle.bg; btnView.style.color = inactiveStyle.color; btnView.style.borderColor = inactiveStyle.border; }
        if (btnEdit) { btnEdit.style.background = activeStyle.bg; btnEdit.style.color = activeStyle.color; btnEdit.style.borderColor = activeStyle.border; }
    }
};

window.downloadSlideHTML = function () {
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
// 슬라이드 양식 템플릿 다운로드
// ═══════════════════════════════════════════════════════════════
window.downloadSlideTemplate = async function () {
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
    } catch (e) {
        console.warn('[Template] fetch 실패, PptxGenJS 폴백:', e);
    }

    if (typeof PptxGenJS === 'undefined') {
        return window.showAlert('양식 파일을 다운로드할 수 없습니다. 로컬 서버(실행.bat)를 사용해주세요.');
    }
    try {
        const pptx = new PptxGenJS();
        pptx.defineLayout({ name: 'WIDE16x9', width: 13.33, height: 7.5 });
        pptx.layout = 'WIDE16x9';
        const T = PPTX_T;
        const FONT = 'Pretendard';

        // 1. 표지
        const s1 = pptx.addSlide();
        s1.background = { color: '0B1120' };
        s1.addShape(pptx.ShapeType.rect, { x: 10.5, y: -1, w: 4, h: 4, fill: { color: '1F497D' } });
        s1.addText('교안 제목을 입력하세요', { x: 0.6, y: 2.0, w: 9.5, h: 1.6, fontSize: 54, fontFace: FONT, color: T.h, bold: true });
        s1.addText('부제목 또는 과목명', { x: 0.6, y: 3.7, w: 9.5, h: 0.6, fontSize: 24, fontFace: FONT, color: T.accent, bold: true });
        s1.addText('Lecture Material · 발표용 슬라이드', { x: 0.6, y: 4.4, w: 9.5, h: 0.5, fontSize: 16, fontFace: FONT, color: T.sub });
        s1.addShape(pptx.ShapeType.rect, { x: 0.6, y: 5.5, w: 1.5, h: 0.05, fill: { color: T.accent } });

        // 2. 섹션 타이틀
        const s2 = pptx.addSlide();
        s2.background = { color: '0B1120' };
        s2.addText('PART 01', { x: 0.6, y: 2.4, w: 12.13, h: 0.5, fontSize: 18, fontFace: FONT, color: T.accent, bold: true, align: 'center', charSpacing: 4 });
        s2.addShape(pptx.ShapeType.rect, { x: 6.16, y: 3.05, w: 1, h: 0.05, fill: { color: T.accent } });
        s2.addText('섹션 제목을 입력하세요', { x: 0.6, y: 3.3, w: 12.13, h: 1.8, fontSize: 48, fontFace: FONT, color: T.h, bold: true, align: 'center' });

        // 3. 카드형 4분할
        const s3 = pptx.addSlide();
        s3.background = { color: T.bg };
        s3.addText('카드형 레이아웃', { x: 0.6, y: 0.45, w: 12, h: 0.85, fontSize: 30, fontFace: FONT, color: T.accent, bold: true });
        s3.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.45, w: 12, h: 0.025, fill: { color: T.border } });
        ['핵심 개념', '실전 예시', '주의 사항', '응용'].forEach((title, i) => {
            const c = i % 2, r = Math.floor(i / 2);
            const cx = 0.6 + c * 6.15, cy = 1.85 + r * 2.45;
            s3.addShape(pptx.ShapeType.roundRect, { x: cx, y: cy, w: 5.9, h: 2.3, fill: { color: T.card }, line: { color: T.border, width: 1 }, rectRadius: 0.12 });
            s3.addShape(pptx.ShapeType.rect, { x: cx, y: cy, w: 5.9, h: 0.08, fill: { color: T.accent } });
            s3.addShape(pptx.ShapeType.roundRect, { x: cx + 0.25, y: cy + 0.3, w: 0.55, h: 0.55, fill: { color: T.accent }, rectRadius: 0.08 });
            s3.addText(String(i + 1).padStart(2, '0'), { x: cx + 0.25, y: cy + 0.3, w: 0.55, h: 0.55, fontSize: 18, fontFace: FONT, color: '0B1120', bold: true, align: 'center', valign: 'middle' });
            s3.addText(title, { x: cx + 0.95, y: cy + 0.3, w: 4.7, h: 0.5, fontSize: 17, fontFace: FONT, color: T.h, bold: true, valign: 'middle' });
            s3.addText('카드 내용을 작성하세요. 핵심 개념이나 특징을 설명합니다.', { x: cx + 0.25, y: cy + 1.0, w: 5.4, h: 1.2, fontSize: 14, fontFace: FONT, color: T.txt });
        });

        // 4. 표
        const s4 = pptx.addSlide();
        s4.background = { color: T.bg };
        s4.addText('데이터 테이블', { x: 0.6, y: 0.45, w: 12, h: 0.85, fontSize: 30, fontFace: FONT, color: T.accent, bold: true });
        s4.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.45, w: 12, h: 0.025, fill: { color: T.border } });
        const hdr = { fontSize: 14, fontFace: FONT, color: T.accent, bold: true, fill: { color: '1A2A4D' }, border: { pt: 1, color: T.border }, valign: 'middle' };
        const cell = { fontSize: 13, fontFace: FONT, color: T.txt, fill: { color: T.bg }, border: { pt: 1, color: T.border }, valign: 'middle' };
        s4.addTable([
            [{ text: '항목', options: hdr }, { text: '설명', options: hdr }, { text: '비고', options: hdr }],
            [{ text: '항목 1', options: cell }, { text: '설명을 작성하세요', options: cell }, { text: '비고', options: cell }],
            [{ text: '항목 2', options: cell }, { text: '설명을 작성하세요', options: cell }, { text: '비고', options: cell }],
            [{ text: '항목 3', options: cell }, { text: '설명을 작성하세요', options: cell }, { text: '비고', options: cell }]
        ], { x: 0.6, y: 1.7, w: 12, colW: [3, 6, 3], rowH: 0.5 });

        // 5. 마무리
        const s5 = pptx.addSlide();
        s5.background = { color: '0B1120' };
        s5.addText('감사합니다', { x: 0.6, y: 2.4, w: 12.13, h: 1.6, fontSize: 64, fontFace: FONT, color: T.h, bold: true, align: 'center' });
        s5.addShape(pptx.ShapeType.rect, { x: 5.7, y: 4.2, w: 2, h: 0.06, fill: { color: T.accent } });
        s5.addText('Thank You', { x: 0.6, y: 4.5, w: 12.13, h: 0.6, fontSize: 22, fontFace: FONT, color: T.sub, align: 'center' });

        pptx.writeFile({ fileName: '슬라이드_양식_템플릿.pptx' })
            .then(() => { if (window.showToast) window.showToast('📋 PPTX 양식 템플릿이 다운로드되었습니다.', 'success'); })
            .catch(e => window.showAlert('PPTX 양식 생성 오류: ' + e.message));
    } catch (e) {
        console.error('[Slide Template]', e);
        window.showAlert('양식 생성 오류: ' + e.message);
    }
};

// ═══════════════════════════════════════════════════════════════
// Expose internals for slide-editor.js
// ═══════════════════════════════════════════════════════════════
window._SLIDE_CSS = SLIDE_CSS;
window._parseSlidesFromMD = parseMarkdownToSlides;
window._slideToHTML = slideToHTML;
window._buildSlideHTML = buildSlideHTML;
