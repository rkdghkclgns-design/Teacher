// slide-editor.js — PPTAgent 스타일 슬라이드 구조화 편집기
// v2.0: 교안 마크다운 → 편집 가능한 슬라이드 덱
// 레이아웃: 썸네일 스트립(좌) + 라이브 프리뷰 캔버스(중앙) + 편집 패널(우)

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
        images: {},        // { imgId: base64DataURL } — 원본 모듈 이미지
        dirty: false,
    };

    const ICON_RE = /[■▣●📝⚙️🎮💡✅⚠️🧠🏆🚀🔬🎓📘📗📙📕🖥️🧩🎯🔍]/g;

    function genId() { return 'slide_' + Math.random().toString(36).slice(2, 10); }

    // ────────────────────────────────────────────────────────────
    // 파서: 교안 마크다운 → SlideData[]
    // 교안은 # 레벨 1 제목으로 주요 섹션을 나누고, ## / ### 로 세부 분할
    // 각 헤딩을 슬라이드 한 장으로 매핑
    // ────────────────────────────────────────────────────────────
    function isQuizDoc(md) {
        return /^#{2,3}\s*문제\s*\d/m.test(md) && !/^##\s+(?!문제)/m.test(md);
    }

    function extractImagesFromBody(body) {
        const out = [];
        const re = /!\[[^\]]*\]\(([^)]+)\)|<img[^>]*src=["']([^"']+)["']/gi;
        let m;
        while ((m = re.exec(body)) !== null) {
            out.push(m[1] || m[2]);
        }
        return out;
    }

    function extractBulletsAndBody(body) {
        // 본문 상단의 연속된 불릿을 `bullets[]`로 추출, 이외 모두 `body`로 보존
        const lines = (body || '').split('\n');
        const bullets = [];
        const bodyLines = [];
        let stillBullet = true;
        for (const line of lines) {
            const bm = line.match(/^\s*[-*•]\s+(.+)/);
            const nm = line.match(/^\s*\d+\.\s+(.+)/);
            if (stillBullet && (bm || nm)) {
                bullets.push((bm ? bm[1] : nm[1]).trim());
                continue;
            }
            if (stillBullet && line.trim() === '' && bullets.length > 0 && bodyLines.length === 0) {
                // 불릿 블록과 본문 사이의 빈 줄 — 구분선으로 사용하고 본문 시작
                stillBullet = false;
                continue;
            }
            stillBullet = false;
            bodyLines.push(line);
        }
        return { bullets, body: bodyLines.join('\n').trim() };
    }

    function detectKind(level, title, body) {
        // 퀴즈
        if (/^문제\s*\d/.test(title) || /###?\s*문제\s*\d/.test(body)) return 'quiz';
        // 표 포함
        if (body && (body.includes('<table') || (body.includes('|') && /\n\s*\|?\s*-{3,}/.test(body)))) return 'data-table';
        // 헤딩 레벨 기반
        if (level === 1) return 'title';
        if (level === 2) return 'section-h2';
        if (level >= 3) return 'content';
        return 'content';
    }

    function parseQuizDoc(md) {
        // 기존 _parseSlidesFromMD이 있으면 재사용 (이미 퀴즈 로직 포함)
        if (typeof window._parseSlidesFromMD !== 'function') return [];
        const raw = window._parseSlidesFromMD(md || '');
        return raw.map((s) => {
            const { bullets, body } = extractBulletsAndBody(s.body || '');
            return {
                id: genId(),
                kind: s.type || 'content',
                level: s.level || 2,
                title: (s.heading || '').replace(ICON_RE, '').trim(),
                bullets, body,
                images: extractImagesFromBody(s.body || ''),
                notes: '',
            };
        });
    }

    function parseDeck(markdown) {
        const md = String(markdown || '').replace(/\r\n/g, '\n');
        if (!md.trim()) return [];

        if (isQuizDoc(md)) return parseQuizDoc(md);

        // 탭 병합 구분자 정리 + 코드블록 보호
        // 1) fenced code block을 플레이스홀더로 치환하여 헤딩 파싱과 분리
        const fences = [];
        const masked = md.replace(/```[\s\S]*?```/g, (block) => {
            fences.push(block);
            return `\n__FENCE_${fences.length - 1}__\n`;
        });

        const lines = masked.split('\n');
        const buckets = [];
        let current = null;

        const pushCurrent = () => {
            if (current) buckets.push(current);
            current = null;
        };

        for (const line of lines) {
            const hm = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
            if (hm) {
                pushCurrent();
                current = {
                    level: hm[1].length,
                    title: hm[2].replace(ICON_RE, '').trim(),
                    bodyLines: [],
                };
            } else if (current) {
                current.bodyLines.push(line);
            } else if (line.trim() && line.trim() !== '---') {
                // 헤딩 이전의 선두 본문 — 묵시적 인트로 슬라이드
                current = { level: 0, title: '', bodyLines: [line] };
            }
        }
        pushCurrent();

        // fence 복원
        const restoreFences = (text) => text.replace(/__FENCE_(\d+)__/g, (_, i) => fences[parseInt(i, 10)] || '');

        const slides = buckets.map((b) => {
            const rawBody = restoreFences(b.bodyLines.join('\n')).trim();
            const { bullets, body } = extractBulletsAndBody(rawBody);
            const kind = detectKind(b.level, b.title, rawBody);
            return {
                id: genId(),
                kind,
                level: b.level,
                title: b.title,
                bullets,
                body,
                images: extractImagesFromBody(rawBody),
                notes: '',
            };
        });

        // 완전히 비어있는 슬라이드(제목도 본문도 없음) 제거
        return slides.filter((s) => (s.title && s.title.trim()) || (s.bullets && s.bullets.length) || (s.body && s.body.trim()));
    }

    // ────────────────────────────────────────────────────────────
    // 직렬화 및 HTML 빌드
    // ────────────────────────────────────────────────────────────
    function slideToMarkdown(sl) {
        const lines = [];
        const level = sl.level || (sl.kind === 'title' ? 1 : (sl.kind === 'section-h2' ? 2 : 3));
        const prefix = '#'.repeat(Math.max(1, Math.min(4, level))) + ' ';
        if (sl.title) lines.push(prefix + sl.title);
        if (sl.bullets && sl.bullets.length) {
            lines.push('');
            for (const b of sl.bullets) lines.push('- ' + b);
        }
        if (sl.body && sl.body.trim()) {
            lines.push('');
            lines.push(sl.body);
        }
        return lines.join('\n');
    }

    function deckToMarkdown() {
        return state.slides.map(slideToMarkdown).join('\n\n');
    }

    function resolveImages(html) {
        if (!state.images) return html;
        let out = html;
        for (const [imgId, b64] of Object.entries(state.images)) {
            out = out.replace(new RegExp(`local:${imgId}`, 'g'), b64);
        }
        return out;
    }

    function buildSingleSlideHTML(sl) {
        if (typeof window._slideToHTML !== 'function' || typeof window._SLIDE_CSS !== 'string') {
            return '<html><body>슬라이드 렌더러를 불러올 수 없습니다.</body></html>';
        }
        // 레거시 렌더러 형식
        const legacy = {
            type: legacyKindOf(sl),
            heading: sl.title || '(제목 없음)',
            body: legacyBodyOf(sl),
            level: sl.level || (sl.kind === 'title' ? 1 : 2),
        };
        let inner;
        try { inner = window._slideToHTML(legacy); }
        catch (e) { inner = `<div style="color:#f87171;padding:20px;">렌더 오류: ${e.message}</div>`; }
        inner = resolveImages(inner);

        const css = window._SLIDE_CSS;
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"><\/script>
<style>${css}
body { padding: 0; min-height: auto; display: block; }
.slide-container { box-shadow: 0 8px 24px rgba(0,0,0,0.4); margin: 0 auto; transform-origin: top center; }
.mermaid { background: transparent; text-align: center; margin: 20px 0; }
.mermaid svg { max-width: 100%; height: auto; }
</style></head><body>${inner}
<script>
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

    function legacyKindOf(sl) {
        // 기존 slideToHTML이 인식하는 type 값으로 매핑
        if (sl.kind === 'quiz') return 'quiz';
        if (sl.kind === 'data-table') return 'data-table';
        if (sl.kind === 'title' || (sl.level === 1)) return 'title';
        if (sl.kind === 'section-h2') return 'section';
        return 'content';
    }

    function legacyBodyOf(sl) {
        const parts = [];
        if (sl.bullets && sl.bullets.length) {
            for (const b of sl.bullets) parts.push('- ' + b);
        }
        if (sl.body && sl.body.trim()) {
            if (parts.length) parts.push('');
            parts.push(sl.body);
        }
        return parts.join('\n');
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
        title: '표지',
        'section-h2': '섹션',
        section: '섹션',
        content: '본문',
        quiz: '퀴즈',
        'data-table': '표',
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
          <header style="display:flex;align-items:center;gap:12px;padding:12px 20px;background:${C.panel};border-bottom:1px solid ${C.border};">
            <i class="ph-fill ph-presentation-chart" style="color:${C.accent};font-size:18px;"></i>
            <h3 style="color:${C.text};font-size:15px;font-weight:700;margin:0;flex:1;">슬라이드 편집기 — ${esc(state.title)}
              <span id="sed-dirty" style="display:none;margin-left:8px;padding:2px 8px;font-size:10px;font-weight:700;background:rgba(245,158,11,0.15);color:#f59e0b;border-radius:10px;">편집됨</span>
              <span id="sed-count" style="margin-left:6px;padding:2px 8px;font-size:10px;font-weight:700;background:rgba(34,211,238,0.1);color:${C.accent};border-radius:10px;">0장</span>
            </h3>
            <button id="sed-fullscreen" title="미리보기 확대" style="padding:7px 12px;font-size:12px;font-weight:700;border:1px solid ${C.border};background:transparent;color:${C.muted};border-radius:6px;cursor:pointer;">🔍 확대</button>
            <button id="sed-save" title="교안에 저장" style="padding:7px 14px;font-size:12px;font-weight:700;border:1px solid rgba(34,197,94,0.5);background:rgba(34,197,94,0.15);color:#22c55e;border-radius:6px;cursor:pointer;">💾 교안에 저장</button>
            <button id="sed-html" style="padding:7px 14px;font-size:12px;font-weight:700;border:1px solid rgba(139,92,246,0.5);background:rgba(139,92,246,0.15);color:${C.accent2};border-radius:6px;cursor:pointer;">📥 HTML</button>
            <button id="sed-pptx" style="padding:7px 14px;font-size:12px;font-weight:700;border:1px solid rgba(34,211,238,0.5);background:rgba(34,211,238,0.15);color:${C.accent};border-radius:6px;cursor:pointer;">📊 PPTX</button>
            <button id="sed-close" style="padding:7px 14px;font-size:12px;font-weight:700;border:1px solid rgba(248,113,113,0.3);background:transparent;color:#f87171;border-radius:6px;cursor:pointer;">✕ 닫기</button>
          </header>

          <!-- 3단 레이아웃: 썸네일 | 프리뷰 | 편집 -->
          <div style="flex:1;display:grid;grid-template-columns:220px 1fr 380px;min-height:0;">
            <!-- 썸네일 -->
            <aside style="border-right:1px solid ${C.border};background:rgba(0,0,0,0.3);overflow-y:auto;padding:12px;">
              <div style="font-size:9px;font-weight:700;color:${C.muted};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:10px;">슬라이드 (${state.slides.length})</div>
              <div id="sed-thumbs" style="display:flex;flex-direction:column;gap:6px;"></div>
            </aside>

            <!-- 라이브 프리뷰 -->
            <main style="overflow:auto;padding:20px;display:flex;flex-direction:column;align-items:center;gap:10px;background:radial-gradient(ellipse at top, rgba(34,211,238,0.04), transparent 70%);">
              <div id="sed-preview-wrap" style="width:100%;max-width:960px;display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:0 4px;">
                  <span id="sed-nav-info" style="font-size:11px;color:${C.muted};font-weight:600;"></span>
                  <div style="display:flex;gap:6px;">
                    <button id="sed-prev" style="padding:4px 10px;font-size:11px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">◀ 이전</button>
                    <button id="sed-next" style="padding:4px 10px;font-size:11px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">다음 ▶</button>
                  </div>
                </div>
                <iframe id="sed-preview" sandbox="allow-scripts"
                        style="width:100%;aspect-ratio:16/9;border:1px solid ${C.border};border-radius:10px;background:#0F172A;"></iframe>
              </div>
            </main>

            <!-- 편집 패널 -->
            <aside style="border-left:1px solid ${C.border};background:rgba(0,0,0,0.25);overflow-y:auto;padding:16px;">
              <div id="sed-editor"></div>
            </aside>
          </div>`;
        document.body.appendChild(root);

        // 키보드
        root._escHandler = (e) => {
            if (e.key === 'Escape') closeEditor();
            // 제목 input·textarea에 포커스된 경우 네비게이션 제외
            const tag = (e.target?.tagName || '').toUpperCase();
            const isText = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
            if (!isText) {
                if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); navigate(-1); }
                if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); navigate(1); }
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
            const summary = sl.bullets[0] || sl.body || '';
            return `
              <div class="sed-thumb" data-idx="${i}"
                   style="padding:8px 10px;border-radius:7px;cursor:pointer;display:flex;flex-direction:column;gap:3px;
                          background:${active ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.03)'};
                          border:1px solid ${active ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.06)'};
                          transition:all 0.15s;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:10px;color:${active ? C.accent : C.muted};font-weight:700;">${i + 1}</span>
                  <span style="font-size:8px;color:${C.accent2};padding:1px 6px;border-radius:8px;background:rgba(167,139,250,0.1);">${label}</span>
                </div>
                <div style="font-size:11px;color:${C.text};font-weight:600;line-height:1.3;
                            display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
                  ${esc(sl.title || '(제목 없음)')}
                </div>
                <div style="font-size:9px;color:${C.muted};line-height:1.3;
                            display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
                  ${esc(String(summary).replace(/[#*`<>]/g, '').slice(0, 70))}
                </div>
              </div>`;
        }).join('') + `
          <button id="sed-add-btn"
                  style="margin-top:4px;padding:8px;border-radius:7px;border:1px dashed rgba(34,211,238,0.4);
                         background:rgba(34,211,238,0.04);color:${C.accent};font-size:11px;font-weight:700;cursor:pointer;">
            + 슬라이드 추가
          </button>`;

        strip.querySelectorAll('.sed-thumb').forEach((el) => {
            el.addEventListener('click', () => {
                state.active = parseInt(el.dataset.idx, 10);
                renderThumbs();
                renderEditor();
                updatePreview();
                updateNavInfo();
            });
        });
        document.getElementById('sed-add-btn')?.addEventListener('click', addSlide);
    }

    function renderEditor() {
        const pane = document.getElementById('sed-editor');
        if (!pane) return;
        const sl = state.slides[state.active];
        if (!sl) {
            pane.innerHTML = `<div style="color:${C.muted};padding:40px;text-align:center;">슬라이드가 없습니다.</div>`;
            return;
        }
        const kindOpts = [
            ['title', '표지'], ['section-h2', '섹션'], ['content', '본문'], ['quiz', '퀴즈'], ['data-table', '표'],
        ].map(([v, l]) => `<option value="${v}" ${sl.kind === v ? 'selected' : ''}>${l}</option>`).join('');

        pane.innerHTML = `
          <!-- 툴바 -->
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px;background:rgba(255,255,255,0.03);border:1px solid ${C.border};border-radius:8px;margin-bottom:14px;">
            <button id="sed-move-up" title="위로" style="padding:4px 8px;font-size:11px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">↑</button>
            <button id="sed-move-dn" title="아래로" style="padding:4px 8px;font-size:11px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">↓</button>
            <button id="sed-dup" title="복제" style="padding:4px 10px;font-size:11px;background:transparent;color:${C.accent2};border:1px solid rgba(167,139,250,0.3);border-radius:4px;cursor:pointer;">복제</button>
            <button id="sed-del" title="삭제" style="padding:4px 10px;font-size:11px;background:transparent;color:#f87171;border:1px solid rgba(248,113,113,0.3);border-radius:4px;cursor:pointer;">삭제</button>
            <div style="flex:1;"></div>
            <select id="sed-kind" style="font-size:11px;padding:3px 8px;background:${C.panel2};color:${C.text};border:1px solid ${C.border};border-radius:4px;outline:none;">${kindOpts}</select>
          </div>

          <!-- 제목 -->
          <label style="display:block;font-size:9px;font-weight:700;color:${C.accent};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:5px;">제목</label>
          <input id="sed-title" type="text" value="${esc(sl.title)}" placeholder="슬라이드 제목"
                 style="width:100%;padding:9px 12px;font-size:15px;font-weight:700;background:${C.panel};color:${C.text};border:1px solid ${C.border};border-radius:7px;outline:none;margin-bottom:14px;" />

          <!-- 불릿 -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <label style="font-size:9px;font-weight:700;color:${C.accent};letter-spacing:1.2px;text-transform:uppercase;">불릿 포인트 (${sl.bullets.length})</label>
            <button id="sed-add-bullet" style="padding:2px 8px;font-size:10px;background:rgba(34,211,238,0.1);color:${C.accent};border:1px solid rgba(34,211,238,0.3);border-radius:4px;cursor:pointer;">+ 추가</button>
          </div>
          <div id="sed-bullets" style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px;"></div>

          <!-- 본문 (추가 마크다운) -->
          <label style="display:block;font-size:9px;font-weight:700;color:${C.accent};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:5px;">추가 본문 (마크다운 · HTML 허용)</label>
          <textarea id="sed-body" placeholder="표, 이미지, Mermaid 다이어그램, HTML 등 원본을 그대로 보존합니다."
                    style="width:100%;height:220px;padding:9px 12px;font-size:11px;font-family:'Consolas','Courier New',monospace;background:${C.panel};color:${C.text};border:1px solid ${C.border};border-radius:7px;outline:none;resize:vertical;line-height:1.5;">${esc(sl.body)}</textarea>

          <!-- 힌트 -->
          <div style="margin-top:14px;padding:10px;background:rgba(34,211,238,0.05);border:1px solid rgba(34,211,238,0.15);border-radius:7px;">
            <div style="font-size:10px;color:${C.accent};font-weight:700;margin-bottom:4px;">💡 편집 팁</div>
            <div style="font-size:10px;color:${C.muted};line-height:1.6;">
              • 입력과 동시에 좌측 미리보기가 갱신됩니다<br>
              • 본문에 마크다운 표, 이미지(<code>&lt;img src=&quot;local:...&quot;&gt;</code>), <code>\`\`\`mermaid</code> 블록을 넣을 수 있습니다<br>
              • 단축키: <kbd>↑</kbd>/<kbd>↓</kbd> 슬라이드 이동, <kbd>ESC</kbd> 닫기
            </div>
          </div>`;

        renderBullets();

        document.getElementById('sed-title').addEventListener('input', (e) => {
            sl.title = e.target.value;
            markDirty();
            schedulePreview();
            debounce('thumbs', renderThumbs, 200);
        });
        document.getElementById('sed-body').addEventListener('input', (e) => {
            sl.body = e.target.value;
            markDirty();
            schedulePreview();
            debounce('thumbs', renderThumbs, 300);
        });
        document.getElementById('sed-kind').addEventListener('change', (e) => {
            sl.kind = e.target.value;
            if (sl.kind === 'title') sl.level = 1;
            else if (sl.kind === 'section-h2') sl.level = 2;
            else if (!sl.level || sl.level < 2) sl.level = 3;
            markDirty();
            schedulePreview();
            renderThumbs();
        });
        document.getElementById('sed-add-bullet').addEventListener('click', () => {
            sl.bullets.push('');
            markDirty();
            renderBullets();
            schedulePreview();
            // 마지막 입력 포커스
            setTimeout(() => {
                const inputs = document.querySelectorAll('.sed-bullet-input');
                inputs[inputs.length - 1]?.focus();
            }, 0);
        });
        document.getElementById('sed-move-up').addEventListener('click', () => moveSlide(-1));
        document.getElementById('sed-move-dn').addEventListener('click', () => moveSlide(1));
        document.getElementById('sed-dup').addEventListener('click', duplicateSlide);
        document.getElementById('sed-del').addEventListener('click', deleteSlide);
    }

    function renderBullets() {
        const wrap = document.getElementById('sed-bullets');
        const sl = state.slides[state.active];
        if (!wrap || !sl) return;
        if (!sl.bullets || sl.bullets.length === 0) {
            wrap.innerHTML = `<div style="font-size:11px;color:${C.muted};padding:8px 2px;">불릿 없음</div>`;
            return;
        }
        wrap.innerHTML = sl.bullets.map((b, i) => `
          <div style="display:flex;gap:4px;align-items:center;">
            <span style="width:20px;height:20px;border-radius:50%;background:rgba(34,211,238,0.15);color:${C.accent};font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</span>
            <input type="text" value="${esc(b)}" data-bidx="${i}" class="sed-bullet-input" placeholder="불릿 내용"
                   style="flex:1;padding:6px 9px;font-size:12px;background:${C.panel};color:${C.text};border:1px solid ${C.border};border-radius:5px;outline:none;" />
            <button data-bidx="${i}" class="sed-bullet-del"
                    style="padding:3px 7px;font-size:10px;background:transparent;color:#f87171;border:1px solid rgba(248,113,113,0.25);border-radius:4px;cursor:pointer;">✕</button>
          </div>`).join('');
        wrap.querySelectorAll('.sed-bullet-input').forEach((el) => {
            el.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.bidx, 10);
                sl.bullets[idx] = e.target.value;
                markDirty();
                schedulePreview();
                debounce('thumbs', renderThumbs, 250);
            });
        });
        wrap.querySelectorAll('.sed-bullet-del').forEach((el) => {
            el.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.bidx, 10);
                sl.bullets.splice(idx, 1);
                markDirty();
                renderBullets();
                schedulePreview();
                renderThumbs();
            });
        });
    }

    function updatePreview() {
        const iframe = document.getElementById('sed-preview');
        const sl = state.slides[state.active];
        if (!iframe || !sl) return;
        iframe.srcdoc = buildSingleSlideHTML(sl);
    }

    function updateNavInfo() {
        const el = document.getElementById('sed-nav-info');
        if (el) el.textContent = `${state.active + 1} / ${state.slides.length}`;
        const cnt = document.getElementById('sed-count');
        if (cnt) cnt.textContent = `${state.slides.length}장`;
    }

    function navigate(delta) {
        const next = state.active + delta;
        if (next < 0 || next >= state.slides.length) return;
        state.active = next;
        renderThumbs();
        renderEditor();
        updatePreview();
        updateNavInfo();
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
            title: '새 슬라이드', bullets: [], body: '', images: [], notes: '',
        });
        state.active += 1;
        markDirty();
        renderThumbs();
        renderEditor();
        updatePreview();
        updateNavInfo();
    }

    function duplicateSlide() {
        const cur = state.slides[state.active];
        if (!cur) return;
        const copy = JSON.parse(JSON.stringify(cur));
        copy.id = genId();
        copy.title = (cur.title || '슬라이드') + ' (복사)';
        state.slides.splice(state.active + 1, 0, copy);
        state.active += 1;
        markDirty();
        renderThumbs();
        renderEditor();
        updatePreview();
        updateNavInfo();
    }

    function deleteSlide() {
        if (state.slides.length <= 1) {
            if (window.showAlert) window.showAlert('최소 한 장의 슬라이드가 필요합니다.');
            return;
        }
        if (!confirm('이 슬라이드를 삭제하시겠습니까?')) return;
        state.slides.splice(state.active, 1);
        state.active = Math.min(state.active, state.slides.length - 1);
        markDirty();
        renderThumbs();
        renderEditor();
        updatePreview();
        updateNavInfo();
    }

    function moveSlide(dir) {
        const i = state.active;
        const j = i + dir;
        if (j < 0 || j >= state.slides.length) return;
        const t = state.slides[i];
        state.slides[i] = state.slides[j];
        state.slides[j] = t;
        state.active = j;
        markDirty();
        renderThumbs();
        renderEditor();
        updatePreview();
        updateNavInfo();
    }

    const _timers = {};
    function debounce(key, fn, ms) {
        if (_timers[key]) clearTimeout(_timers[key]);
        _timers[key] = setTimeout(() => { fn(); delete _timers[key]; }, ms || 150);
    }
    function schedulePreview() { debounce('preview', updatePreview, 250); }

    // ────────────────────────────────────────────────────────────
    // 내보내기 / 저장
    // ────────────────────────────────────────────────────────────
    function downloadHTML() {
        const html = buildFullDeckHTML();
        if (!html) return;
        const safe = (state.title || 'slide').replace(/[^\w가-힣]/g, '_');
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = safe + '_슬라이드.html';
        a.click();
        URL.revokeObjectURL(a.href);
        if (window.showToast) window.showToast('📥 슬라이드 HTML 다운로드', 'success');
    }

    function downloadPPTX() {
        if (typeof PptxGenJS === 'undefined') {
            if (window.showAlert) window.showAlert('PptxGenJS 라이브러리를 불러오는 중입니다.');
            return;
        }
        const mod = typeof getEditingModule === 'function' ? getEditingModule(state.moduleId) : null;
        if (!mod) { if (window.showAlert) window.showAlert('교안 모듈을 찾을 수 없습니다.'); return; }
        const tabKey = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
        const newMd = deckToMarkdown();
        const origTab = tabKey && mod.tabContents ? mod.tabContents[tabKey] : undefined;
        const origContent = mod.content;
        try {
            if (tabKey && mod.tabContents) mod.tabContents[tabKey] = newMd;
            mod.content = newMd;
            if (typeof window.exportToPptx === 'function') window.exportToPptx();
            else if (window.showAlert) window.showAlert('PPTX 내보내기 기능을 찾을 수 없습니다.');
        } finally {
            if (tabKey && mod.tabContents) mod.tabContents[tabKey] = origTab;
            mod.content = origContent;
        }
    }

    function saveToModule() {
        const mod = typeof getEditingModule === 'function' ? getEditingModule(state.moduleId) : null;
        if (!mod) return;
        if (!confirm('편집한 슬라이드 내용을 교안 탭에 반영합니다. 원본이 덮어쓰기 됩니다. 계속하시겠습니까?')) return;
        const tabKey = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
        const newMd = deckToMarkdown();
        if (tabKey && mod.tabContents) mod.tabContents[tabKey] = newMd;
        mod.content = newMd;
        if (typeof window.saveState === 'function') window.saveState();
        clearDirty();
        if (window.showToast) window.showToast('✅ 교안에 저장됨', 'success');
    }

    // ────────────────────────────────────────────────────────────
    // 확대 미리보기 (모든 슬라이드 전체 데크)
    // ────────────────────────────────────────────────────────────
    function openPreviewFullscreen() {
        const html = buildFullDeckHTML();
        if (!html) return;
        document.getElementById('sed-full-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'sed-full-overlay';
        overlay.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.95);display:flex;flex-direction:column;`;
        overlay.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;background:${C.panel};border-bottom:1px solid ${C.border};">
            <span style="color:${C.text};font-size:13px;font-weight:700;flex:1;">🔍 전체 데크 미리보기 — ${esc(state.title)}</span>
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
        if (!content) { if (window.showAlert) window.showAlert('교안 내용이 없습니다. 먼저 탭을 생성해주세요.'); return; }

        state.slides = parseDeck(content);
        if (state.slides.length === 0) {
            state.slides = [{ id: genId(), kind: 'title', level: 1, title: mod.title || '새 슬라이드', bullets: [], body: '', images: [], notes: '' }];
        }
        state.active = 0;
        state.moduleId = moduleId;
        state.title = mod.title || '슬라이드';
        state.images = mod.images || {};
        state.dirty = false;

        renderShell();
        renderThumbs();
        renderEditor();
        updatePreview();
        updateNavInfo();
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
