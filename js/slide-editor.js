// slide-editor.js — PPTAgent 스타일 슬라이드 구조화 편집기
// v3.0: 자동 스케일 프리뷰 + 하단 가로 썸네일 스트립 + 텍스트 스타일 / 이미지 갤러리 / 레이아웃 프리셋
//       PPTX 주 출력 — PPTX로 제작 버튼을 최상단에 배치

(function () {
    'use strict';

    // ────────────────────────────────────────────────────────────
    // 상태
    // ────────────────────────────────────────────────────────────
    const state = {
        slides: [],        // SlideData[]
        active: 0,
        moduleId: null,
        title: '',
        images: {},        // module.images (local:xxx → base64)
        dirty: false,
    };

    const ICON_RE = /[■▣●📝⚙️🎮💡✅⚠️🧠🏆🚀🔬🎓📘📗📙📕🖥️🧩🎯🔍]/g;

    function genId() { return 'slide_' + Math.random().toString(36).slice(2, 10); }

    // ────────────────────────────────────────────────────────────
    // 파서: 교안 마크다운 → SlideData[]
    // ────────────────────────────────────────────────────────────
    function isQuizDoc(md) {
        return /^#{2,3}\s*문제\s*\d/m.test(md) && !/^##\s+(?!문제)/m.test(md);
    }

    function extractImagesFromBody(body) {
        const out = [];
        const re = /!\[[^\]]*\]\(([^)]+)\)|<img[^>]*src=["']([^"']+)["']/gi;
        let m;
        while ((m = re.exec(body)) !== null) out.push(m[1] || m[2]);
        return out;
    }

    function extractBulletsAndBody(body) {
        const lines = (body || '').split('\n');
        const bullets = [];
        const bodyLines = [];
        let stillBullet = true;
        for (const line of lines) {
            const bm = line.match(/^\s*[-*•]\s+(.+)/);
            const nm = line.match(/^\s*\d+\.\s+(.+)/);
            if (stillBullet && (bm || nm)) { bullets.push((bm ? bm[1] : nm[1]).trim()); continue; }
            if (stillBullet && line.trim() === '' && bullets.length > 0 && bodyLines.length === 0) { stillBullet = false; continue; }
            stillBullet = false;
            bodyLines.push(line);
        }
        return { bullets, body: bodyLines.join('\n').trim() };
    }

    function detectKind(level, title, body) {
        if (/^문제\s*\d/.test(title) || /###?\s*문제\s*\d/.test(body)) return 'quiz';
        if (body && (body.includes('<table') || (body.includes('|') && /\n\s*\|?\s*-{3,}/.test(body)))) return 'data-table';
        if (level === 1) return 'title';
        if (level === 2) return 'section-h2';
        return 'content';
    }

    function parseQuizDoc(md) {
        if (typeof window._parseSlidesFromMD !== 'function') return [];
        return window._parseSlidesFromMD(md || '').map((s) => {
            const { bullets, body } = extractBulletsAndBody(s.body || '');
            return {
                id: genId(), kind: s.type || 'content', level: s.level || 2,
                title: (s.heading || '').replace(ICON_RE, '').trim(),
                bullets, body, images: extractImagesFromBody(s.body || ''),
                imageLayouts: [], textStyle: {}, notes: '',
            };
        });
    }

    function parseDeck(markdown) {
        const md = String(markdown || '').replace(/\r\n/g, '\n');
        if (!md.trim()) return [];
        if (isQuizDoc(md)) return parseQuizDoc(md);

        const fences = [];
        const masked = md.replace(/```[\s\S]*?```/g, (block) => { fences.push(block); return `\n__FENCE_${fences.length - 1}__\n`; });
        const restoreFences = (t) => t.replace(/__FENCE_(\d+)__/g, (_, i) => fences[parseInt(i, 10)] || '');

        const lines = masked.split('\n');
        const buckets = [];
        let current = null;
        const push = () => { if (current) buckets.push(current); current = null; };

        for (const line of lines) {
            const hm = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
            if (hm) {
                push();
                current = { level: hm[1].length, title: hm[2].replace(ICON_RE, '').trim(), bodyLines: [] };
            } else if (current) current.bodyLines.push(line);
            else if (line.trim() && line.trim() !== '---') current = { level: 0, title: '', bodyLines: [line] };
        }
        push();

        return buckets.map((b) => {
            const rawBody = restoreFences(b.bodyLines.join('\n')).trim();
            const { bullets, body } = extractBulletsAndBody(rawBody);
            return {
                id: genId(),
                kind: detectKind(b.level, b.title, rawBody),
                level: b.level,
                title: b.title,
                bullets, body,
                images: extractImagesFromBody(rawBody),
                imageLayouts: [],
                textStyle: {},
                notes: '',
            };
        }).filter((s) => (s.title && s.title.trim()) || s.bullets.length || (s.body && s.body.trim()));
    }

    // ────────────────────────────────────────────────────────────
    // 직렬화
    // ────────────────────────────────────────────────────────────
    function slideToMarkdown(sl) {
        const lines = [];
        const level = sl.level || (sl.kind === 'title' ? 1 : (sl.kind === 'section-h2' ? 2 : 3));
        const prefix = '#'.repeat(Math.max(1, Math.min(4, level))) + ' ';
        if (sl.title) lines.push(prefix + sl.title);
        if (sl.bullets && sl.bullets.length) { lines.push(''); for (const b of sl.bullets) lines.push('- ' + b); }
        if (sl.body && sl.body.trim()) { lines.push(''); lines.push(sl.body); }
        return lines.join('\n');
    }

    function deckToMarkdown() { return state.slides.map(slideToMarkdown).join('\n\n'); }

    function resolveImages(htmlOrUrl) {
        if (!state.images || !htmlOrUrl) return htmlOrUrl;
        let out = htmlOrUrl;
        for (const [imgId, b64] of Object.entries(state.images)) {
            out = out.replace(new RegExp(`local:${imgId}`, 'g'), b64);
        }
        return out;
    }

    function resolveImageUrl(url) {
        if (!url) return url;
        if (url.startsWith('local:') && state.images) {
            const id = url.slice(6);
            return state.images[id] || url;
        }
        return url;
    }

    // ────────────────────────────────────────────────────────────
    // 레이아웃 프리셋
    // ────────────────────────────────────────────────────────────
    const LAYOUT_PRESETS = [
        { id: 'right-half', label: '오른쪽 절반', layout: { x: 0.52, y: 0.1, w: 0.43, h: 0.8 } },
        { id: 'left-half', label: '왼쪽 절반', layout: { x: 0.05, y: 0.1, w: 0.43, h: 0.8 } },
        { id: 'full', label: '전체 배경', layout: { x: 0, y: 0, w: 1, h: 1 } },
        { id: 'top-band', label: '상단 밴드', layout: { x: 0.05, y: 0.06, w: 0.9, h: 0.35 } },
        { id: 'bottom-band', label: '하단 밴드', layout: { x: 0.05, y: 0.58, w: 0.9, h: 0.35 } },
        { id: 'center', label: '중앙', layout: { x: 0.25, y: 0.2, w: 0.5, h: 0.6 } },
    ];
    function clampLayout(l) {
        const w = Math.max(0.05, Math.min(1, l.w));
        const h = Math.max(0.05, Math.min(1, l.h));
        const x = Math.max(0, Math.min(1 - w, l.x));
        const y = Math.max(0, Math.min(1 - h, l.y));
        return { x, y, w, h };
    }
    function hasLayoutOverride(sl) {
        return Array.isArray(sl.imageLayouts) && sl.imageLayouts.some((l) => l && typeof l.x === 'number');
    }

    // ────────────────────────────────────────────────────────────
    // 프리뷰 HTML 빌드 (자동 스케일 + 텍스트 스타일 + 이미지 오버레이)
    // ────────────────────────────────────────────────────────────
    function legacyKindOf(sl) {
        if (sl.kind === 'quiz') return 'quiz';
        if (sl.kind === 'data-table') return 'data-table';
        if (sl.kind === 'title' || sl.level === 1) return 'title';
        if (sl.kind === 'section-h2') return 'section';
        return 'content';
    }
    function legacyBodyOf(sl) {
        const parts = [];
        if (sl.bullets && sl.bullets.length) for (const b of sl.bullets) parts.push('- ' + b);
        if (sl.body && sl.body.trim()) { if (parts.length) parts.push(''); parts.push(sl.body); }
        return parts.join('\n');
    }

    function buildImageOverlays(sl) {
        // sl.imageLayouts가 지정된 이미지는 절대 위치 오버레이로 렌더
        if (!hasLayoutOverride(sl)) return '';
        const items = [];
        (sl.images || []).forEach((url, i) => {
            const layout = sl.imageLayouts?.[i];
            if (!layout || typeof layout.x !== 'number') return;
            const src = resolveImageUrl(url);
            items.push(`<img class="img-overlay" src="${src}" style="position:absolute;left:${(layout.x * 100).toFixed(2)}%;top:${(layout.y * 100).toFixed(2)}%;width:${(layout.w * 100).toFixed(2)}%;height:${(layout.h * 100).toFixed(2)}%;object-fit:cover;border-radius:8px;z-index:5;">`);
        });
        return items.join('');
    }

    function buildSingleSlideHTML(sl) {
        const SLIDE_CSS = window._SLIDE_CSS || '';
        const slideToHTMLFn = window._slideToHTML;
        if (!slideToHTMLFn) return '<html><body>렌더러 로딩 중</body></html>';

        const legacy = {
            type: legacyKindOf(sl),
            heading: sl.title || '(제목 없음)',
            body: legacyBodyOf(sl),
            level: sl.level || 2,
        };
        let inner;
        try { inner = slideToHTMLFn(legacy); } catch (e) { inner = `<div style="color:#f87171;padding:20px;">렌더 오류: ${e.message}</div>`; }
        inner = resolveImages(inner);

        // 이미지 오버레이 추가 (imageLayouts 있을 때만)
        if (hasLayoutOverride(sl)) {
            // slide-container 내부에 오버레이 주입
            const overlays = buildImageOverlays(sl);
            inner = inner.replace('<div class="slide-container">', '<div class="slide-container" style="position:relative;">')
                         .replace('</div>\n</div>', overlays + '</div>\n</div>');
            // 단순 폴백: inner 닫는 태그 직전에 삽입
            if (!inner.includes('img-overlay')) {
                inner = inner.replace(/(<\/div>\s*)$/, overlays + '$1');
            }
        }

        // 텍스트 스타일 CSS 오버라이드
        const ts = sl.textStyle || {};
        const titleScale = ts.titleScale ?? 1;
        const bulletScale = ts.bulletScale ?? 1;
        const fontFamily = ts.fontFamily || 'display';
        const titleWeight = ts.titleWeight || 'bold';
        const fontMap = {
            display: "'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
            sans: "'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
            serif: "'Noto Serif KR', 'Nanum Myeongjo', serif",
        };

        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"><\/script>
<style>${SLIDE_CSS}
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #0a0e1a; }
body { display: flex; align-items: center; justify-content: center; font-family: ${fontMap[fontFamily]}; }
.slide-container { transform-origin: center center; flex-shrink: 0; font-family: ${fontMap[fontFamily]}; }
.slide-container h1, .slide-container h2, .slide-container h3, .slide-container h4, .slide-container .slide-title { font-family: ${fontMap[fontFamily]}; }
.slide-container h1 { font-size: ${Math.round(56 * titleScale)}px !important; font-weight: ${titleWeight === 'bold' ? 700 : 600} !important; }
.slide-container .slide-title { font-size: ${Math.round(36 * titleScale)}px !important; font-weight: ${titleWeight === 'bold' ? 700 : 600} !important; }
.slide-container h3 { font-size: ${Math.round(24 * bulletScale)}px !important; }
.slide-container p, .slide-container li { font-size: ${Math.round(18 * bulletScale)}px !important; }
.slide-container .subtitle { font-size: ${Math.round(22 * bulletScale)}px !important; }
.mermaid { background: transparent; text-align: center; margin: 20px 0; }
.mermaid svg { max-width: 100%; height: auto; }
.img-overlay { pointer-events: none; }
</style></head><body>${inner}
<script>
// 슬라이드(1280x720)를 iframe 뷰포트에 자동 스케일로 피팅
(function() {
  const el = document.querySelector('.slide-container');
  if (!el) return;
  const SLIDE_W = 1280, SLIDE_H = 720;
  const PAD = 20; // 여백
  function fit() {
    const vw = window.innerWidth - PAD;
    const vh = window.innerHeight - PAD;
    const scale = Math.min(vw / SLIDE_W, vh / SLIDE_H);
    el.style.transform = 'scale(' + scale + ')';
  }
  fit();
  window.addEventListener('resize', fit);
  setTimeout(fit, 50);
  setTimeout(fit, 200);
})();
// Mermaid
try {
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: false, theme: 'dark', themeVariables: { primaryColor: '#1f2937', primaryTextColor: '#f3f4f6', lineColor: '#22d3ee' } });
    document.querySelectorAll('pre code.language-mermaid, code.language-mermaid').forEach(el => {
      const div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = el.textContent;
      (el.closest('pre') || el).replaceWith(div);
    });
    setTimeout(() => { try { mermaid.run(); } catch(e) {} }, 200);
  }
} catch (e) { console.warn('preview mermaid', e); }
<\/script></body></html>`;
    }

    function buildFullDeckHTML() {
        if (typeof window._buildSlideHTML !== 'function') return '';
        const md = deckToMarkdown();
        let html = window._buildSlideHTML(md, state.title || '슬라이드');
        return resolveImages(html);
    }

    // ────────────────────────────────────────────────────────────
    // UI
    // ────────────────────────────────────────────────────────────
    const C = {
        bg: 'rgba(10,14,26,0.96)',
        panel: '#111827',
        panel2: '#1a1a2e',
        border: 'rgba(255,255,255,0.1)',
        accent: '#22d3ee',
        accent2: '#a78bfa',
        text: '#f3f4f6',
        muted: '#9ca3af',
    };

    const KIND_LABEL = {
        title: '표지', 'section-h2': '섹션', section: '섹션',
        content: '본문', quiz: '퀴즈', 'data-table': '표',
    };

    function esc(s) {
        return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function renderShell() {
        document.getElementById('slide-editor-root')?.remove();
        const root = document.createElement('div');
        root.id = 'slide-editor-root';
        root.style.cssText = `position:fixed;inset:0;z-index:9998;background:${C.bg};display:flex;flex-direction:column;backdrop-filter:blur(8px);`;
        root.innerHTML = `
          <!-- 헤더 -->
          <header style="display:flex;align-items:center;gap:10px;padding:10px 18px;background:${C.panel};border-bottom:1px solid ${C.border};flex-shrink:0;">
            <i class="ph-fill ph-presentation-chart" style="color:${C.accent};font-size:18px;"></i>
            <h3 style="color:${C.text};font-size:14px;font-weight:700;margin:0;flex:1;">슬라이드 편집기 — ${esc(state.title)}
              <span id="sed-dirty" style="display:none;margin-left:8px;padding:2px 8px;font-size:10px;font-weight:700;background:rgba(245,158,11,0.15);color:#f59e0b;border-radius:10px;">편집됨</span>
              <span id="sed-count" style="margin-left:6px;padding:2px 8px;font-size:10px;font-weight:700;background:rgba(34,211,238,0.1);color:${C.accent};border-radius:10px;">0장</span>
            </h3>
            <button id="sed-pptx" title="PPTX로 제작 (주 출력)"
                    style="padding:8px 16px;font-size:12px;font-weight:700;border:1px solid rgba(34,211,238,0.6);background:linear-gradient(135deg,rgba(34,211,238,0.25),rgba(167,139,250,0.25));color:${C.text};border-radius:6px;cursor:pointer;box-shadow:0 0 0 1px rgba(34,211,238,0.3);">
              📊 PPTX로 제작
            </button>
            <button id="sed-save" title="교안에 저장" style="padding:7px 14px;font-size:12px;font-weight:700;border:1px solid rgba(34,197,94,0.5);background:rgba(34,197,94,0.1);color:#22c55e;border-radius:6px;cursor:pointer;">💾 교안 저장</button>
            <button id="sed-html" style="padding:7px 12px;font-size:12px;font-weight:700;border:1px solid ${C.border};background:transparent;color:${C.muted};border-radius:6px;cursor:pointer;">HTML</button>
            <button id="sed-fullscreen" style="padding:7px 12px;font-size:12px;font-weight:700;border:1px solid ${C.border};background:transparent;color:${C.muted};border-radius:6px;cursor:pointer;">🔍</button>
            <button id="sed-close" style="padding:7px 12px;font-size:12px;font-weight:700;border:1px solid rgba(248,113,113,0.3);background:transparent;color:#f87171;border-radius:6px;cursor:pointer;">✕</button>
          </header>

          <!-- 본문: 프리뷰(좌) + 편집패널(우) -->
          <div style="flex:1;display:grid;grid-template-columns:1fr 400px;min-height:0;">
            <!-- 라이브 프리뷰 -->
            <main style="position:relative;overflow:hidden;padding:14px 20px;display:flex;flex-direction:column;gap:8px;background:radial-gradient(ellipse at top,rgba(34,211,238,0.04),transparent 70%);">
              <div style="display:flex;align-items:center;gap:10px;padding:0 2px;flex-shrink:0;">
                <span id="sed-nav-info" style="font-size:11px;color:${C.muted};font-weight:600;"></span>
                <span id="sed-kind-badge" style="padding:2px 8px;font-size:10px;font-weight:700;color:${C.accent2};background:rgba(167,139,250,0.1);border-radius:10px;"></span>
                <div style="flex:1;"></div>
                <button id="sed-prev" style="padding:4px 12px;font-size:11px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">◀ 이전</button>
                <button id="sed-next" style="padding:4px 12px;font-size:11px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">다음 ▶</button>
              </div>
              <iframe id="sed-preview" sandbox="allow-scripts"
                      style="flex:1;width:100%;border:1px solid ${C.border};border-radius:10px;background:#0F172A;min-height:0;"></iframe>
            </main>

            <!-- 편집 패널 -->
            <aside style="border-left:1px solid ${C.border};background:rgba(0,0,0,0.25);overflow-y:auto;padding:14px;">
              <div id="sed-editor"></div>
            </aside>
          </div>

          <!-- 하단 가로 썸네일 스트립 -->
          <footer style="border-top:1px solid ${C.border};background:rgba(0,0,0,0.4);padding:10px 14px;flex-shrink:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:10px;color:${C.muted};font-weight:700;letter-spacing:1px;text-transform:uppercase;">전체 슬라이드</span>
              <span style="font-size:10px;color:${C.muted};">← 가로 스크롤로 탐색 · 클릭하여 이동</span>
            </div>
            <div id="sed-thumbs" style="display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;padding-bottom:6px;scrollbar-width:thin;"></div>
          </footer>`;
        document.body.appendChild(root);

        // 키보드
        root._escHandler = (e) => {
            if (e.key === 'Escape') closeEditor();
            const tag = (e.target?.tagName || '').toUpperCase();
            const isText = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
            if (!isText) {
                if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); navigate(-1); }
                if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); navigate(1); }
            }
        };
        document.addEventListener('keydown', root._escHandler);

        document.getElementById('sed-close').addEventListener('click', closeEditor);
        document.getElementById('sed-save').addEventListener('click', saveToModule);
        document.getElementById('sed-html').addEventListener('click', downloadHTML);
        document.getElementById('sed-pptx').addEventListener('click', downloadPPTX);
        document.getElementById('sed-fullscreen').addEventListener('click', openPreviewFullscreen);
        document.getElementById('sed-prev').addEventListener('click', () => navigate(-1));
        document.getElementById('sed-next').addEventListener('click', () => navigate(1));
    }

    function renderThumbs() {
        const strip = document.getElementById('sed-thumbs');
        if (!strip) return;
        strip.innerHTML = state.slides.map((sl, i) => {
            const active = i === state.active;
            const label = KIND_LABEL[sl.kind] || '본문';
            const img = (sl.images && sl.images.length) ? resolveImageUrl(sl.images[0]) : null;
            return `
              <div class="sed-thumb" data-idx="${i}"
                   style="position:relative;width:140px;height:80px;flex-shrink:0;padding:6px 8px;border-radius:6px;cursor:pointer;
                          display:flex;flex-direction:column;gap:2px;overflow:hidden;
                          background:${active ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.04)'};
                          border:1px solid ${active ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.08)'};
                          transition:all 0.15s;">
                ${img ? `<img src="${esc(img)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.25;">` : ''}
                <div style="position:relative;display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:9px;color:${active ? C.accent : C.muted};font-weight:700;">${i + 1}</span>
                  <span style="font-size:8px;color:${C.accent2};padding:0 5px;border-radius:6px;background:rgba(167,139,250,0.15);">${label}</span>
                </div>
                <div style="position:relative;font-size:10px;color:${C.text};font-weight:600;line-height:1.25;
                            display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
                  ${esc(sl.title || '(제목 없음)')}
                </div>
                <div style="position:relative;font-size:8px;color:${C.muted};line-height:1.3;
                            display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
                  ${esc(String(sl.bullets[0] || sl.body || '').replace(/[#*`<>]/g, '').slice(0, 60))}
                </div>
              </div>`;
        }).join('') + `
          <button id="sed-add-btn" title="슬라이드 추가"
                  style="width:60px;height:80px;flex-shrink:0;border-radius:6px;border:1px dashed rgba(34,211,238,0.4);
                         background:rgba(34,211,238,0.04);color:${C.accent};font-size:18px;font-weight:700;cursor:pointer;">
            +
          </button>`;
        strip.querySelectorAll('.sed-thumb').forEach((el) => {
            el.addEventListener('click', () => {
                state.active = parseInt(el.dataset.idx, 10);
                refresh();
                // 썸네일 화면 내 스크롤
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            });
        });
        document.getElementById('sed-add-btn')?.addEventListener('click', addSlide);
    }

    function renderEditor() {
        const pane = document.getElementById('sed-editor');
        if (!pane) return;
        const sl = state.slides[state.active];
        if (!sl) { pane.innerHTML = `<div style="color:${C.muted};padding:40px;text-align:center;">슬라이드가 없습니다.</div>`; return; }

        const kindOpts = [
            ['title', '표지'], ['section-h2', '섹션'], ['content', '본문'], ['quiz', '퀴즈'], ['data-table', '표'],
        ].map(([v, l]) => `<option value="${v}" ${sl.kind === v ? 'selected' : ''}>${l}</option>`).join('');

        const ts = sl.textStyle = sl.textStyle || {};
        const titleScale = ts.titleScale ?? 1;
        const bulletScale = ts.bulletScale ?? 1;
        const fontFamily = ts.fontFamily || 'display';
        const titleWeight = ts.titleWeight || 'bold';

        pane.innerHTML = `
          <!-- 툴바 -->
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;padding:7px;background:rgba(255,255,255,0.03);border:1px solid ${C.border};border-radius:7px;margin-bottom:12px;">
            <button id="sed-move-up" title="위로" style="padding:4px 8px;font-size:11px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">↑</button>
            <button id="sed-move-dn" title="아래로" style="padding:4px 8px;font-size:11px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">↓</button>
            <button id="sed-dup" style="padding:4px 10px;font-size:11px;background:transparent;color:${C.accent2};border:1px solid rgba(167,139,250,0.3);border-radius:4px;cursor:pointer;">복제</button>
            <button id="sed-del" style="padding:4px 10px;font-size:11px;background:transparent;color:#f87171;border:1px solid rgba(248,113,113,0.3);border-radius:4px;cursor:pointer;">삭제</button>
            <div style="flex:1;"></div>
            <select id="sed-kind" style="font-size:11px;padding:3px 7px;background:${C.panel2};color:${C.text};border:1px solid ${C.border};border-radius:4px;outline:none;">${kindOpts}</select>
          </div>

          <!-- 제목 -->
          <label style="display:block;font-size:9px;font-weight:700;color:${C.accent};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:5px;">제목</label>
          <input id="sed-title" type="text" value="${esc(sl.title)}" placeholder="슬라이드 제목"
                 style="width:100%;padding:8px 11px;font-size:14px;font-weight:700;background:${C.panel};color:${C.text};border:1px solid ${C.border};border-radius:6px;outline:none;margin-bottom:12px;box-sizing:border-box;" />

          <!-- 불릿 -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <label style="font-size:9px;font-weight:700;color:${C.accent};letter-spacing:1.2px;text-transform:uppercase;">불릿 (${sl.bullets.length})</label>
            <button id="sed-add-bullet" style="padding:2px 8px;font-size:10px;background:rgba(34,211,238,0.1);color:${C.accent};border:1px solid rgba(34,211,238,0.3);border-radius:4px;cursor:pointer;">+ 추가</button>
          </div>
          <div id="sed-bullets" style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px;"></div>

          <!-- 본문 -->
          <label style="display:block;font-size:9px;font-weight:700;color:${C.accent};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:5px;">추가 본문 (마크다운 · HTML)</label>
          <textarea id="sed-body" placeholder="표, 이미지, Mermaid 등"
                    style="width:100%;height:140px;padding:8px 10px;font-size:11px;font-family:Consolas,monospace;background:${C.panel};color:${C.text};border:1px solid ${C.border};border-radius:6px;outline:none;resize:vertical;line-height:1.5;box-sizing:border-box;">${esc(sl.body)}</textarea>

          <!-- 텍스트 스타일 -->
          <div style="margin-top:14px;padding:12px;background:rgba(167,139,250,0.05);border:1px solid rgba(167,139,250,0.2);border-radius:7px;">
            <label style="display:block;font-size:9px;font-weight:700;color:${C.accent2};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:8px;">텍스트 스타일</label>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
              <span style="font-size:10px;color:${C.muted};">제목 크기</span>
              <span id="sed-ts-title-val" style="font-size:10px;color:${C.accent2};font-weight:700;">${titleScale.toFixed(2)}×</span>
            </div>
            <input id="sed-ts-title" type="range" min="0.7" max="1.6" step="0.05" value="${titleScale}"
                   style="width:100%;accent-color:${C.accent2};margin-bottom:10px;" />

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
              <span style="font-size:10px;color:${C.muted};">본문 크기</span>
              <span id="sed-ts-body-val" style="font-size:10px;color:${C.accent};font-weight:700;">${bulletScale.toFixed(2)}×</span>
            </div>
            <input id="sed-ts-body" type="range" min="0.7" max="1.6" step="0.05" value="${bulletScale}"
                   style="width:100%;accent-color:${C.accent};margin-bottom:10px;" />

            <div style="font-size:10px;color:${C.muted};margin-bottom:4px;">서체</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:10px;">
              ${['display', 'sans', 'serif'].map((v) => {
                const label = { display: '디스플레이', sans: '프리텐다드', serif: '명조' }[v];
                const on = fontFamily === v;
                return `<button class="sed-font-btn" data-v="${v}" style="padding:5px 4px;font-size:10px;border-radius:5px;cursor:pointer;border:1px solid ${on ? 'rgba(167,139,250,0.6)' : C.border};background:${on ? 'rgba(167,139,250,0.15)' : 'transparent'};color:${on ? C.accent2 : C.muted};">${label}</button>`;
              }).join('')}
            </div>

            <div style="font-size:10px;color:${C.muted};margin-bottom:4px;">제목 굵기</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;">
              ${['semibold', 'bold'].map((v) => {
                const label = { semibold: '보통', bold: '굵게' }[v];
                const on = titleWeight === v;
                return `<button class="sed-weight-btn" data-v="${v}" style="padding:5px;font-size:10px;border-radius:5px;cursor:pointer;border:1px solid ${on ? 'rgba(167,139,250,0.6)' : C.border};background:${on ? 'rgba(167,139,250,0.15)' : 'transparent'};color:${on ? C.accent2 : C.muted};">${label}</button>`;
              }).join('')}
            </div>
            <button id="sed-ts-reset" style="width:100%;padding:5px;font-size:10px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:5px;cursor:pointer;">기본값으로 초기화</button>
          </div>

          <!-- 이미지 갤러리 -->
          <div style="margin-top:14px;padding:12px;background:rgba(34,211,238,0.04);border:1px solid rgba(34,211,238,0.18);border-radius:7px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <label style="font-size:9px;font-weight:700;color:${C.accent};letter-spacing:1.2px;text-transform:uppercase;">이미지 갤러리 (${sl.images.length})</label>
              <label style="padding:3px 9px;font-size:10px;background:rgba(34,211,238,0.15);color:${C.accent};border:1px solid rgba(34,211,238,0.4);border-radius:4px;cursor:pointer;">
                + 업로드
                <input id="sed-img-upload" type="file" accept="image/*" multiple style="display:none;" />
              </label>
            </div>
            <div id="sed-images" style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;"></div>
            <div style="font-size:10px;color:${C.muted};margin-bottom:5px;">이미지 배치 (선택된 이미지에 적용)</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:4px;">
              ${LAYOUT_PRESETS.map((p) => `<button class="sed-preset-btn" data-id="${p.id}" style="padding:5px 3px;font-size:10px;border-radius:5px;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.text};">${p.label}</button>`).join('')}
            </div>
            <button id="sed-layout-reset" style="width:100%;padding:4px;font-size:10px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">배치 초기화 (기본 레이아웃)</button>
          </div>

          <!-- 도움말 -->
          <div style="margin-top:12px;padding:8px;background:rgba(255,255,255,0.02);border:1px solid ${C.border};border-radius:5px;font-size:9px;color:${C.muted};line-height:1.6;">
            💡 단축키 <kbd style="padding:0 4px;background:${C.panel2};border:1px solid ${C.border};border-radius:3px;">◀</kbd> <kbd style="padding:0 4px;background:${C.panel2};border:1px solid ${C.border};border-radius:3px;">▶</kbd> 이동 ·
            <kbd style="padding:0 4px;background:${C.panel2};border:1px solid ${C.border};border-radius:3px;">ESC</kbd> 닫기
          </div>`;

        renderBullets();
        renderImages();

        document.getElementById('sed-title').addEventListener('input', (e) => { sl.title = e.target.value; markDirty(); schedulePreview(); debounce('thumbs', renderThumbs, 250); });
        document.getElementById('sed-body').addEventListener('input', (e) => { sl.body = e.target.value; markDirty(); schedulePreview(); debounce('thumbs', renderThumbs, 350); });
        document.getElementById('sed-kind').addEventListener('change', (e) => {
            sl.kind = e.target.value;
            if (sl.kind === 'title') sl.level = 1;
            else if (sl.kind === 'section-h2') sl.level = 2;
            else if (!sl.level || sl.level < 2) sl.level = 3;
            markDirty(); schedulePreview(); renderThumbs(); updateNavInfo();
        });
        document.getElementById('sed-add-bullet').addEventListener('click', () => {
            sl.bullets.push(''); markDirty(); renderBullets(); schedulePreview();
            setTimeout(() => { const inputs = document.querySelectorAll('.sed-bullet-input'); inputs[inputs.length - 1]?.focus(); }, 0);
        });
        document.getElementById('sed-move-up').addEventListener('click', () => moveSlide(-1));
        document.getElementById('sed-move-dn').addEventListener('click', () => moveSlide(1));
        document.getElementById('sed-dup').addEventListener('click', duplicateSlide);
        document.getElementById('sed-del').addEventListener('click', deleteSlide);

        // 텍스트 스타일 바인딩
        document.getElementById('sed-ts-title').addEventListener('input', (e) => {
            ts.titleScale = parseFloat(e.target.value);
            document.getElementById('sed-ts-title-val').textContent = ts.titleScale.toFixed(2) + '×';
            markDirty(); schedulePreview();
        });
        document.getElementById('sed-ts-body').addEventListener('input', (e) => {
            ts.bulletScale = parseFloat(e.target.value);
            document.getElementById('sed-ts-body-val').textContent = ts.bulletScale.toFixed(2) + '×';
            markDirty(); schedulePreview();
        });
        pane.querySelectorAll('.sed-font-btn').forEach((el) => el.addEventListener('click', () => {
            ts.fontFamily = el.dataset.v; markDirty(); schedulePreview(); renderEditor();
        }));
        pane.querySelectorAll('.sed-weight-btn').forEach((el) => el.addEventListener('click', () => {
            ts.titleWeight = el.dataset.v; markDirty(); schedulePreview(); renderEditor();
        }));
        document.getElementById('sed-ts-reset').addEventListener('click', () => {
            sl.textStyle = {}; markDirty(); schedulePreview(); renderEditor();
        });

        // 이미지 업로드
        document.getElementById('sed-img-upload').addEventListener('change', handleImageUpload);

        // 레이아웃 프리셋
        pane.querySelectorAll('.sed-preset-btn').forEach((el) => el.addEventListener('click', () => applyLayoutPreset(el.dataset.id)));
        document.getElementById('sed-layout-reset').addEventListener('click', () => {
            sl.imageLayouts = []; markDirty(); schedulePreview();
        });
    }

    function renderBullets() {
        const wrap = document.getElementById('sed-bullets');
        const sl = state.slides[state.active];
        if (!wrap || !sl) return;
        if (!sl.bullets || sl.bullets.length === 0) {
            wrap.innerHTML = `<div style="font-size:11px;color:${C.muted};padding:6px 2px;">불릿 없음</div>`;
            return;
        }
        wrap.innerHTML = sl.bullets.map((b, i) => `
          <div style="display:flex;gap:3px;align-items:center;">
            <span style="width:18px;height:18px;border-radius:50%;background:rgba(34,211,238,0.15);color:${C.accent};font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</span>
            <input type="text" value="${esc(b)}" data-bidx="${i}" class="sed-bullet-input"
                   style="flex:1;padding:5px 8px;font-size:11px;background:${C.panel};color:${C.text};border:1px solid ${C.border};border-radius:4px;outline:none;" />
            <button data-bidx="${i}" class="sed-bullet-del"
                    style="padding:2px 6px;font-size:10px;background:transparent;color:#f87171;border:1px solid rgba(248,113,113,0.25);border-radius:3px;cursor:pointer;">✕</button>
          </div>`).join('');
        wrap.querySelectorAll('.sed-bullet-input').forEach((el) => el.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.bidx, 10);
            sl.bullets[idx] = e.target.value;
            markDirty(); schedulePreview(); debounce('thumbs', renderThumbs, 250);
        }));
        wrap.querySelectorAll('.sed-bullet-del').forEach((el) => el.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.dataset.bidx, 10);
            sl.bullets.splice(idx, 1); markDirty(); renderBullets(); schedulePreview(); renderThumbs();
        }));
    }

    function renderImages() {
        const wrap = document.getElementById('sed-images');
        const sl = state.slides[state.active];
        if (!wrap || !sl) return;
        if (!sl.images || sl.images.length === 0) {
            wrap.innerHTML = `<div style="font-size:10px;color:${C.muted};padding:8px;text-align:center;border:1px dashed ${C.border};border-radius:5px;">이미지 없음 — 업로드로 추가</div>`;
            return;
        }
        wrap.innerHTML = sl.images.map((src, i) => {
            const resolved = resolveImageUrl(src);
            const primary = i === 0;
            const hasLayout = sl.imageLayouts && sl.imageLayouts[i];
            return `
              <div style="display:flex;gap:5px;align-items:center;padding:4px;background:rgba(0,0,0,0.2);border:1px solid ${primary ? 'rgba(34,211,238,0.4)' : C.border};border-radius:5px;">
                <img src="${esc(resolved)}" style="width:50px;height:30px;object-fit:cover;border-radius:3px;flex-shrink:0;" />
                <div style="flex:1;min-width:0;">
                  <div style="font-size:9px;font-weight:700;color:${primary ? C.accent : C.muted};">${primary ? '대표' : '추가 #' + i}${hasLayout ? ' · 커스텀 배치' : ''}</div>
                  <div style="font-size:8px;color:${C.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(String(src).slice(0, 40))}</div>
                </div>
                <button data-iidx="${i}" class="sed-img-up" style="padding:2px 5px;font-size:10px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:3px;cursor:pointer;${i === 0 ? 'opacity:0.3;cursor:not-allowed;' : ''}">↑</button>
                <button data-iidx="${i}" class="sed-img-dn" style="padding:2px 5px;font-size:10px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:3px;cursor:pointer;${i >= sl.images.length - 1 ? 'opacity:0.3;cursor:not-allowed;' : ''}">↓</button>
                <button data-iidx="${i}" class="sed-img-sel" style="padding:2px 7px;font-size:10px;background:${C.imgSelIdx === i ? 'rgba(167,139,250,0.2)' : 'transparent'};color:${C.accent2};border:1px solid rgba(167,139,250,0.3);border-radius:3px;cursor:pointer;">선택</button>
                <button data-iidx="${i}" class="sed-img-del" style="padding:2px 5px;font-size:10px;background:transparent;color:#f87171;border:1px solid rgba(248,113,113,0.25);border-radius:3px;cursor:pointer;">✕</button>
              </div>`;
        }).join('');
        wrap.querySelectorAll('.sed-img-up').forEach((el) => el.addEventListener('click', () => moveImage(parseInt(el.dataset.iidx, 10), -1)));
        wrap.querySelectorAll('.sed-img-dn').forEach((el) => el.addEventListener('click', () => moveImage(parseInt(el.dataset.iidx, 10), 1)));
        wrap.querySelectorAll('.sed-img-del').forEach((el) => el.addEventListener('click', () => removeImage(parseInt(el.dataset.iidx, 10))));
        wrap.querySelectorAll('.sed-img-sel').forEach((el) => el.addEventListener('click', () => {
            state.imgSelIdx = parseInt(el.dataset.iidx, 10);
            renderImages();
        }));
    }

    function updatePreview() {
        const iframe = document.getElementById('sed-preview');
        const sl = state.slides[state.active];
        if (!iframe || !sl) return;
        iframe.srcdoc = buildSingleSlideHTML(sl);
    }

    function updateNavInfo() {
        const el = document.getElementById('sed-nav-info');
        const sl = state.slides[state.active];
        if (el && sl) el.textContent = `${state.active + 1} / ${state.slides.length}`;
        const badge = document.getElementById('sed-kind-badge');
        if (badge && sl) badge.textContent = KIND_LABEL[sl.kind] || '본문';
        const cnt = document.getElementById('sed-count');
        if (cnt) cnt.textContent = `${state.slides.length}장`;
    }

    function refresh() {
        renderThumbs();
        renderEditor();
        updatePreview();
        updateNavInfo();
    }

    function navigate(delta) {
        const next = state.active + delta;
        if (next < 0 || next >= state.slides.length) return;
        state.active = next;
        refresh();
    }

    // ────────────────────────────────────────────────────────────
    // 조작
    // ────────────────────────────────────────────────────────────
    function markDirty() {
        state.dirty = true;
        const b = document.getElementById('sed-dirty');
        if (b) b.style.display = 'inline-block';
    }
    function clearDirty() {
        state.dirty = false;
        const b = document.getElementById('sed-dirty');
        if (b) b.style.display = 'none';
    }

    function addSlide() {
        state.slides.splice(state.active + 1, 0, {
            id: genId(), kind: 'content', level: 3,
            title: '새 슬라이드', bullets: [], body: '',
            images: [], imageLayouts: [], textStyle: {}, notes: '',
        });
        state.active += 1; markDirty(); refresh();
    }
    function duplicateSlide() {
        const cur = state.slides[state.active]; if (!cur) return;
        const copy = JSON.parse(JSON.stringify(cur));
        copy.id = genId(); copy.title = (cur.title || '슬라이드') + ' (복사)';
        state.slides.splice(state.active + 1, 0, copy);
        state.active += 1; markDirty(); refresh();
    }
    function deleteSlide() {
        if (state.slides.length <= 1) { if (window.showAlert) window.showAlert('최소 한 장이 필요합니다.'); return; }
        if (!confirm('이 슬라이드를 삭제하시겠습니까?')) return;
        state.slides.splice(state.active, 1);
        state.active = Math.min(state.active, state.slides.length - 1);
        markDirty(); refresh();
    }
    function moveSlide(dir) {
        const i = state.active; const j = i + dir;
        if (j < 0 || j >= state.slides.length) return;
        const t = state.slides[i]; state.slides[i] = state.slides[j]; state.slides[j] = t;
        state.active = j; markDirty(); refresh();
    }

    function moveImage(i, dir) {
        const sl = state.slides[state.active]; if (!sl) return;
        const j = i + dir;
        if (j < 0 || j >= sl.images.length) return;
        [sl.images[i], sl.images[j]] = [sl.images[j], sl.images[i]];
        if (!sl.imageLayouts) sl.imageLayouts = [];
        while (sl.imageLayouts.length < sl.images.length) sl.imageLayouts.push(null);
        [sl.imageLayouts[i], sl.imageLayouts[j]] = [sl.imageLayouts[j], sl.imageLayouts[i]];
        markDirty(); renderImages(); schedulePreview(); debounce('thumbs', renderThumbs, 200);
    }
    function removeImage(i) {
        const sl = state.slides[state.active]; if (!sl) return;
        sl.images.splice(i, 1);
        if (sl.imageLayouts) sl.imageLayouts.splice(i, 1);
        if (state.imgSelIdx === i) state.imgSelIdx = null;
        markDirty(); renderImages(); schedulePreview(); renderThumbs();
    }

    async function handleImageUpload(e) {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        const sl = state.slides[state.active]; if (!sl) return;
        for (const f of files) {
            if (!f.type.startsWith('image/')) continue;
            if (f.size > 8 * 1024 * 1024) { if (window.showAlert) window.showAlert(`${f.name}: 8MB 초과`); continue; }
            const dataUrl = await new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(String(r.result || ''));
                r.onerror = () => rej(new Error('읽기 실패'));
                r.readAsDataURL(f);
            });
            sl.images.push(dataUrl);
            if (!sl.imageLayouts) sl.imageLayouts = [];
            sl.imageLayouts.push(null);
        }
        e.target.value = '';
        markDirty(); renderImages(); schedulePreview(); renderThumbs();
        if (window.showToast) window.showToast(`이미지 ${files.length}장 추가`, 'success');
    }

    function applyLayoutPreset(presetId) {
        const sl = state.slides[state.active]; if (!sl) return;
        const idx = state.imgSelIdx ?? 0;
        if (idx >= sl.images.length) { if (window.showAlert) window.showAlert('먼저 이미지를 업로드하세요.'); return; }
        const preset = LAYOUT_PRESETS.find((p) => p.id === presetId); if (!preset) return;
        if (!sl.imageLayouts) sl.imageLayouts = [];
        while (sl.imageLayouts.length <= idx) sl.imageLayouts.push(null);
        sl.imageLayouts[idx] = clampLayout(preset.layout);
        markDirty(); renderImages(); schedulePreview();
    }

    const _timers = {};
    function debounce(key, fn, ms) {
        if (_timers[key]) clearTimeout(_timers[key]);
        _timers[key] = setTimeout(() => { fn(); delete _timers[key]; }, ms || 150);
    }
    function schedulePreview() { debounce('preview', updatePreview, 250); }

    // ────────────────────────────────────────────────────────────
    // 내보내기
    // ────────────────────────────────────────────────────────────
    function downloadHTML() {
        const html = buildFullDeckHTML(); if (!html) return;
        const safe = (state.title || 'slide').replace(/[^\w가-힣]/g, '_');
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = safe + '_슬라이드.html'; a.click();
        URL.revokeObjectURL(a.href);
        if (window.showToast) window.showToast('📥 HTML 다운로드', 'success');
    }

    function downloadPPTX() {
        if (typeof PptxGenJS === 'undefined') { if (window.showAlert) window.showAlert('PptxGenJS 로딩 중입니다.'); return; }
        const mod = typeof getEditingModule === 'function' ? getEditingModule(state.moduleId) : null;
        if (!mod) { if (window.showAlert) window.showAlert('교안 모듈 없음'); return; }
        const tabKey = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
        const newMd = deckToMarkdown();
        // 업로드된 신규 이미지(data URL)는 mod.images에 등록하여 PPTX에서 렌더 가능하게 함
        const mergedImages = { ...(mod.images || {}) };
        state.slides.forEach((sl) => {
            (sl.images || []).forEach((url, i) => {
                if (typeof url === 'string' && url.startsWith('data:')) {
                    const id = `sed_${sl.id}_${i}`;
                    mergedImages[id] = url;
                }
            });
        });
        const origTab = tabKey && mod.tabContents ? mod.tabContents[tabKey] : undefined;
        const origContent = mod.content;
        const origImages = mod.images;
        try {
            if (tabKey && mod.tabContents) mod.tabContents[tabKey] = newMd;
            mod.content = newMd;
            mod.images = mergedImages;
            if (typeof window.exportToPptx === 'function') {
                window.exportToPptx();
                if (window.showToast) window.showToast('📊 PPTX 생성 완료', 'success');
            } else { if (window.showAlert) window.showAlert('exportToPptx 없음'); }
        } finally {
            if (tabKey && mod.tabContents) mod.tabContents[tabKey] = origTab;
            mod.content = origContent;
            mod.images = origImages;
        }
    }

    function saveToModule() {
        const mod = typeof getEditingModule === 'function' ? getEditingModule(state.moduleId) : null;
        if (!mod) return;
        if (!confirm('편집 내용을 교안에 반영합니다. 계속하시겠습니까?')) return;
        const tabKey = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
        const newMd = deckToMarkdown();
        if (tabKey && mod.tabContents) mod.tabContents[tabKey] = newMd;
        mod.content = newMd;
        // 업로드 이미지 머지
        state.slides.forEach((sl) => (sl.images || []).forEach((url, i) => {
            if (typeof url === 'string' && url.startsWith('data:')) {
                if (!mod.images) mod.images = {};
                const id = `sed_${sl.id}_${i}`;
                mod.images[id] = url;
            }
        }));
        if (typeof window.saveState === 'function') window.saveState();
        clearDirty();
        if (window.showToast) window.showToast('✅ 교안에 저장됨', 'success');
    }

    // ────────────────────────────────────────────────────────────
    // 전체 확대 미리보기
    // ────────────────────────────────────────────────────────────
    function openPreviewFullscreen() {
        const html = buildFullDeckHTML(); if (!html) return;
        document.getElementById('sed-full-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'sed-full-overlay';
        overlay.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.95);display:flex;flex-direction:column;`;
        overlay.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;background:${C.panel};border-bottom:1px solid ${C.border};">
            <span style="color:${C.text};font-size:13px;font-weight:700;flex:1;">🔍 전체 데크 — ${esc(state.title)}</span>
            <button id="sed-full-close" style="padding:6px 14px;font-size:12px;font-weight:700;border:1px solid rgba(248,113,113,0.3);background:transparent;color:#f87171;border-radius:6px;cursor:pointer;">✕ 닫기</button>
          </div>
          <iframe sandbox="allow-scripts" style="flex:1;width:100%;border:none;background:#0F172A;"></iframe>`;
        document.body.appendChild(overlay);
        overlay.querySelector('iframe').srcdoc = html;
        const onEsc = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } };
        document.addEventListener('keydown', onEsc);
        document.getElementById('sed-full-close').addEventListener('click', () => { overlay.remove(); document.removeEventListener('keydown', onEsc); });
    }

    // ────────────────────────────────────────────────────────────
    // 진입 / 종료
    // ────────────────────────────────────────────────────────────
    function openEditor(moduleId) {
        const mod = typeof getEditingModule === 'function' ? getEditingModule(moduleId) : null;
        if (!mod) { if (window.showAlert) window.showAlert('교안을 먼저 선택해주세요.'); return; }
        const tabKey = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
        const content = (tabKey && mod.tabContents ? mod.tabContents[tabKey] : null) || mod.content || '';
        if (!content) { if (window.showAlert) window.showAlert('교안 내용이 없습니다.'); return; }

        state.slides = parseDeck(content);
        if (state.slides.length === 0) {
            state.slides = [{ id: genId(), kind: 'title', level: 1, title: mod.title || '새 슬라이드', bullets: [], body: '', images: [], imageLayouts: [], textStyle: {}, notes: '' }];
        }
        state.active = 0;
        state.moduleId = moduleId;
        state.title = mod.title || '슬라이드';
        state.images = mod.images || {};
        state.imgSelIdx = null;
        state.dirty = false;

        renderShell();
        refresh();
    }

    function closeEditor() {
        if (state.dirty && !confirm('편집된 내용이 저장되지 않았습니다. 닫으시겠습니까?')) return;
        const root = document.getElementById('slide-editor-root');
        if (root) {
            if (root._escHandler) document.removeEventListener('keydown', root._escHandler);
            root.remove();
        }
        document.getElementById('sed-full-overlay')?.remove();
    }

    window.openSlideEditor = openEditor;
    window.closeSlideEditor = closeEditor;
})();
