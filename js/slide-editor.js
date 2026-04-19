// slide-editor.js — PPTAgent 스타일 슬라이드 구조화 편집기
// v1.0: 교안 마크다운 → 편집 가능한 슬라이드 덱 (제목/불릿/본문/이미지)
// 편집 후 실시간 HTML 미리보기, HTML·PPTX 내보내기, 교안으로 저장 지원

(function () {
    'use strict';

    // ────────────────────────────────────────────────────────────
    // 상태 (단일 덱 — 한 번에 하나의 에디터만 열림)
    // ────────────────────────────────────────────────────────────
    const state = {
        slides: [],        // SlideData[]
        active: 0,         // 현재 선택된 슬라이드 인덱스
        moduleId: null,
        title: '',
        images: {},        // { imgId: base64DataURL }
        dirty: false,      // 편집됨 표시
    };

    // ────────────────────────────────────────────────────────────
    // 마크다운 → 구조화 슬라이드 데이터
    // ────────────────────────────────────────────────────────────
    /** @typedef {Object} SlideData
     *  @property {string} id
     *  @property {'title'|'section'|'content'|'quiz'|'data-table'} kind
     *  @property {string} title
     *  @property {string[]} bullets  — 불릿 라인
     *  @property {string} body       — 불릿 이외 본문 마크다운
     *  @property {string[]} images   — 이미지 src 목록
     *  @property {string} notes      — 발표자 노트(옵션)
     */

    function genId() {
        return 'slide_' + Math.random().toString(36).slice(2, 10);
    }

    function extractBulletsAndBody(body) {
        const lines = (body || '').split('\n');
        const bullets = [];
        const bodyLines = [];
        let inBullet = true;
        for (const line of lines) {
            const bm = line.match(/^\s*[-*•]\s+(.+)/);
            const nm = line.match(/^\s*\d+\.\s+(.+)/);
            if ((bm || nm) && inBullet) {
                bullets.push((bm ? bm[1] : nm[1]).trim());
            } else if (line.trim() === '' && bullets.length > 0 && bodyLines.length === 0) {
                continue;
            } else {
                inBullet = false;
                bodyLines.push(line);
            }
        }
        return { bullets, body: bodyLines.join('\n').trim() };
    }

    function extractImages(md) {
        const out = [];
        const re = /!\[[^\]]*\]\(([^)]+)\)|<img[^>]*src=["']([^"']+)["']/gi;
        let m;
        while ((m = re.exec(md)) !== null) {
            out.push(m[1] || m[2]);
        }
        return out;
    }

    function parseDeck(markdown) {
        const raw = (typeof window._parseSlidesFromMD === 'function')
            ? window._parseSlidesFromMD(markdown || '')
            : [];
        return raw.map((s) => {
            const { bullets, body } = extractBulletsAndBody(s.body || '');
            return {
                id: genId(),
                kind: s.type || 'content',
                title: s.heading || '',
                bullets,
                body,
                images: extractImages(s.body || ''),
                notes: '',
            };
        });
    }

    function slideToMarkdown(sl) {
        const lines = [];
        const hashPrefix = sl.kind === 'title' ? '# ' : '## ';
        if (sl.title) lines.push(hashPrefix + sl.title);
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

    function deckToLegacySlideArray() {
        // buildSlideHTML/slideToHTML 형식으로 변환 (기존 렌더러 재사용)
        return state.slides.map((s) => ({
            type: s.kind,
            heading: s.title,
            body: buildLegacyBody(s),
            level: s.kind === 'title' ? 1 : 2,
        }));
    }

    function buildLegacyBody(sl) {
        const parts = [];
        if (sl.bullets && sl.bullets.length) {
            for (const b of sl.bullets) parts.push('- ' + b);
            if (sl.body) parts.push('');
        }
        if (sl.body) parts.push(sl.body);
        return parts.join('\n');
    }

    // ────────────────────────────────────────────────────────────
    // HTML 빌드 (기존 SLIDE_CSS + slideToHTML 재사용)
    // ────────────────────────────────────────────────────────────
    function buildFullDeckHTML() {
        if (typeof window._buildSlideHTML !== 'function') {
            return '<html><body>슬라이드 렌더러를 불러올 수 없습니다.</body></html>';
        }
        const md = deckToMarkdown();
        let html = window._buildSlideHTML(md, state.title || '슬라이드');
        // 이미지 치환
        if (state.images) {
            for (const [imgId, b64] of Object.entries(state.images)) {
                html = html.replace(new RegExp(`local:${imgId}`, 'g'), b64);
            }
        }
        return html;
    }

    function buildSingleSlideHTML(sl) {
        if (typeof window._slideToHTML !== 'function' || typeof window._SLIDE_CSS !== 'string') {
            return '';
        }
        const legacySlide = {
            type: sl.kind,
            heading: sl.title,
            body: buildLegacyBody(sl),
            level: sl.kind === 'title' ? 1 : 2,
        };
        let inner = window._slideToHTML(legacySlide);
        // 이미지 치환
        if (state.images) {
            for (const [imgId, b64] of Object.entries(state.images)) {
                inner = inner.replace(new RegExp(`local:${imgId}`, 'g'), b64);
            }
        }
        const css = window._SLIDE_CSS;
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"><\/script>
<style>${css}
body { padding: 0; min-height: auto; }
.slide-container { box-shadow: none; margin: 0 auto; }
.mermaid svg { max-width: 100%; height: auto; }
</style></head><body>${inner}
<script>
if (typeof mermaid !== 'undefined') {
  mermaid.initialize({ startOnLoad: true, theme: 'dark' });
  document.querySelectorAll('pre code.language-mermaid, code.language-mermaid').forEach(el => {
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = el.textContent;
    el.closest('pre')?.replaceWith(div) || el.replaceWith(div);
  });
  setTimeout(() => { try { mermaid.run(); } catch(e) {} }, 300);
}
<\/script></body></html>`;
    }

    // ────────────────────────────────────────────────────────────
    // UI 렌더링
    // ────────────────────────────────────────────────────────────
    const COLORS = {
        bg: 'rgba(10,14,26,0.95)',
        panel: '#111827',
        panel2: '#1a1a2e',
        border: 'rgba(255,255,255,0.1)',
        accent: '#22d3ee',
        accent2: '#a78bfa',
        text: '#f3f4f6',
        muted: '#9ca3af',
    };

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function renderThumbnails() {
        const strip = document.getElementById('slide-editor-thumbs');
        if (!strip) return;
        strip.innerHTML = state.slides.map((sl, i) => {
            const active = i === state.active;
            const kindLabel = ({
                title: '표지', section: '섹션', content: '본문', quiz: '퀴즈', 'data-table': '표',
            })[sl.kind] || '본문';
            return `
              <div class="slide-thumb ${active ? 'active' : ''}" data-idx="${i}"
                   style="display:flex;flex-direction:column;gap:4px;padding:8px;border-radius:8px;cursor:pointer;
                          background:${active ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.03)'};
                          border:1px solid ${active ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.08)'};
                          transition:all 0.15s;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:10px;color:${COLORS.muted};font-weight:600;">${i + 1}</span>
                  <span style="font-size:9px;color:${COLORS.accent2};padding:1px 6px;border-radius:8px;background:rgba(167,139,250,0.1);">${kindLabel}</span>
                </div>
                <div style="font-size:11px;color:${COLORS.text};font-weight:600;line-height:1.3;
                            display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
                  ${escapeHtml(sl.title || '(제목 없음)')}
                </div>
                <div style="font-size:9px;color:${COLORS.muted};line-height:1.4;
                            display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
                  ${escapeHtml((sl.bullets[0] || sl.body || '').slice(0, 80))}
                </div>
              </div>`;
        }).join('') + `
          <button id="slide-editor-add-btn" title="슬라이드 추가"
                  style="padding:10px;border-radius:8px;border:1px dashed rgba(34,211,238,0.4);
                         background:rgba(34,211,238,0.05);color:${COLORS.accent};font-size:11px;font-weight:700;cursor:pointer;">
            + 슬라이드 추가
          </button>`;

        // 바인딩
        strip.querySelectorAll('.slide-thumb').forEach((el) => {
            el.addEventListener('click', () => {
                state.active = parseInt(el.dataset.idx, 10);
                renderThumbnails();
                renderEditor();
            });
        });
        const addBtn = document.getElementById('slide-editor-add-btn');
        if (addBtn) addBtn.addEventListener('click', addSlide);
    }

    function renderEditor() {
        const pane = document.getElementById('slide-editor-canvas');
        if (!pane) return;
        const sl = state.slides[state.active];
        if (!sl) {
            pane.innerHTML = `<div style="color:${COLORS.muted};padding:40px;text-align:center;">슬라이드가 없습니다.</div>`;
            return;
        }
        const kindOpts = [
            { v: 'title', label: '표지' },
            { v: 'section', label: '섹션' },
            { v: 'content', label: '본문' },
            { v: 'quiz', label: '퀴즈' },
            { v: 'data-table', label: '표' },
        ].map((o) => `<option value="${o.v}" ${sl.kind === o.v ? 'selected' : ''}>${o.label}</option>`).join('');

        pane.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:16px;">
            <!-- 편집 툴바 -->
            <div style="display:flex;gap:8px;align-items:center;padding:8px 12px;background:rgba(255,255,255,0.03);border:1px solid ${COLORS.border};border-radius:8px;">
              <span style="font-size:11px;color:${COLORS.muted};font-weight:600;">${state.active + 1} / ${state.slides.length}</span>
              <div style="width:1px;height:18px;background:${COLORS.border};"></div>
              <label style="font-size:11px;color:${COLORS.muted};">유형</label>
              <select id="slide-kind" style="font-size:11px;padding:3px 8px;background:${COLORS.panel2};color:${COLORS.text};border:1px solid ${COLORS.border};border-radius:4px;outline:none;">${kindOpts}</select>
              <div style="flex:1;"></div>
              <button id="slide-move-up" title="위로" style="padding:4px 8px;font-size:11px;background:transparent;color:${COLORS.muted};border:1px solid ${COLORS.border};border-radius:4px;cursor:pointer;">↑</button>
              <button id="slide-move-dn" title="아래로" style="padding:4px 8px;font-size:11px;background:transparent;color:${COLORS.muted};border:1px solid ${COLORS.border};border-radius:4px;cursor:pointer;">↓</button>
              <button id="slide-duplicate" title="복제" style="padding:4px 10px;font-size:11px;background:transparent;color:${COLORS.accent2};border:1px solid rgba(167,139,250,0.3);border-radius:4px;cursor:pointer;">복제</button>
              <button id="slide-delete" title="삭제" style="padding:4px 10px;font-size:11px;background:transparent;color:#f87171;border:1px solid rgba(248,113,113,0.3);border-radius:4px;cursor:pointer;">삭제</button>
            </div>

            <!-- 제목 -->
            <div>
              <label style="display:block;font-size:10px;font-weight:700;color:${COLORS.accent};letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">제목</label>
              <input id="slide-title" type="text" value="${escapeHtml(sl.title)}" placeholder="슬라이드 제목"
                     style="width:100%;padding:10px 14px;font-size:18px;font-weight:700;background:${COLORS.panel};color:${COLORS.text};border:1px solid ${COLORS.border};border-radius:8px;outline:none;" />
            </div>

            <!-- 불릿 -->
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <label style="font-size:10px;font-weight:700;color:${COLORS.accent};letter-spacing:1px;text-transform:uppercase;">불릿 포인트</label>
                <button id="slide-add-bullet" style="padding:3px 10px;font-size:10px;background:rgba(34,211,238,0.1);color:${COLORS.accent};border:1px solid rgba(34,211,238,0.3);border-radius:4px;cursor:pointer;">+ 추가</button>
              </div>
              <div id="slide-bullets-list" style="display:flex;flex-direction:column;gap:6px;"></div>
            </div>

            <!-- 본문 -->
            <div>
              <label style="display:block;font-size:10px;font-weight:700;color:${COLORS.accent};letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">추가 본문 (마크다운)</label>
              <textarea id="slide-body" placeholder="표, 이미지, Mermaid 다이어그램 등을 마크다운으로 입력"
                        style="width:100%;height:140px;padding:10px 14px;font-size:12px;font-family:'Courier New',monospace;background:${COLORS.panel};color:${COLORS.text};border:1px solid ${COLORS.border};border-radius:8px;outline:none;resize:vertical;">${escapeHtml(sl.body)}</textarea>
            </div>

            <!-- 미리보기 -->
            <div>
              <label style="display:block;font-size:10px;font-weight:700;color:${COLORS.accent2};letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">실시간 미리보기</label>
              <iframe id="slide-editor-preview" sandbox="allow-scripts allow-same-origin"
                      style="width:100%;height:480px;border:1px solid ${COLORS.border};border-radius:8px;background:#0F172A;"></iframe>
            </div>
          </div>`;

        // 불릿 렌더
        renderBullets();

        // 바인딩
        document.getElementById('slide-title').addEventListener('input', (e) => {
            sl.title = e.target.value;
            markDirty();
            schedulePreview();
            debounce('thumbs', renderThumbnails, 250);
        });
        document.getElementById('slide-body').addEventListener('input', (e) => {
            sl.body = e.target.value;
            markDirty();
            schedulePreview();
            debounce('thumbs', renderThumbnails, 250);
        });
        document.getElementById('slide-kind').addEventListener('change', (e) => {
            sl.kind = e.target.value;
            markDirty();
            schedulePreview();
            renderThumbnails();
        });
        document.getElementById('slide-add-bullet').addEventListener('click', () => {
            sl.bullets.push('새 포인트');
            markDirty();
            renderBullets();
            schedulePreview();
            renderThumbnails();
        });
        document.getElementById('slide-move-up').addEventListener('click', () => moveSlide(-1));
        document.getElementById('slide-move-dn').addEventListener('click', () => moveSlide(1));
        document.getElementById('slide-duplicate').addEventListener('click', duplicateSlide);
        document.getElementById('slide-delete').addEventListener('click', deleteSlide);

        updatePreview();
    }

    function renderBullets() {
        const list = document.getElementById('slide-bullets-list');
        const sl = state.slides[state.active];
        if (!list || !sl) return;
        if (sl.bullets.length === 0) {
            list.innerHTML = `<div style="font-size:11px;color:${COLORS.muted};padding:8px;">불릿 없음. 우측 상단 "+ 추가"로 생성.</div>`;
            return;
        }
        list.innerHTML = sl.bullets.map((b, i) => `
          <div style="display:flex;gap:6px;align-items:center;">
            <span style="width:22px;height:22px;border-radius:50%;background:rgba(34,211,238,0.15);color:${COLORS.accent};font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</span>
            <input type="text" value="${escapeHtml(b)}" data-bidx="${i}" class="slide-bullet-input"
                   style="flex:1;padding:7px 10px;font-size:13px;background:${COLORS.panel};color:${COLORS.text};border:1px solid ${COLORS.border};border-radius:6px;outline:none;" />
            <button data-bidx="${i}" class="slide-bullet-del"
                    style="padding:4px 8px;font-size:11px;background:transparent;color:#f87171;border:1px solid rgba(248,113,113,0.25);border-radius:4px;cursor:pointer;">✕</button>
          </div>
        `).join('');

        list.querySelectorAll('.slide-bullet-input').forEach((el) => {
            el.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.bidx, 10);
                sl.bullets[idx] = e.target.value;
                markDirty();
                schedulePreview();
                debounce('thumbs', renderThumbnails, 250);
            });
        });
        list.querySelectorAll('.slide-bullet-del').forEach((el) => {
            el.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.bidx, 10);
                sl.bullets.splice(idx, 1);
                markDirty();
                renderBullets();
                schedulePreview();
                renderThumbnails();
            });
        });
    }

    function updatePreview() {
        const iframe = document.getElementById('slide-editor-preview');
        const sl = state.slides[state.active];
        if (!iframe || !sl) return;
        iframe.srcdoc = buildSingleSlideHTML(sl);
    }

    // ────────────────────────────────────────────────────────────
    // 조작
    // ────────────────────────────────────────────────────────────
    function markDirty() { state.dirty = true; updateHeaderBadge(); }
    function clearDirty() { state.dirty = false; updateHeaderBadge(); }

    function updateHeaderBadge() {
        const badge = document.getElementById('slide-editor-dirty');
        if (!badge) return;
        badge.style.display = state.dirty ? 'inline-block' : 'none';
    }

    function addSlide() {
        const newSlide = {
            id: genId(),
            kind: 'content',
            title: '새 슬라이드',
            bullets: ['첫 번째 포인트'],
            body: '',
            images: [],
            notes: '',
        };
        state.slides.splice(state.active + 1, 0, newSlide);
        state.active = state.active + 1;
        markDirty();
        renderThumbnails();
        renderEditor();
    }

    function duplicateSlide() {
        const cur = state.slides[state.active];
        if (!cur) return;
        const copy = JSON.parse(JSON.stringify(cur));
        copy.id = genId();
        copy.title = cur.title + ' (복사)';
        state.slides.splice(state.active + 1, 0, copy);
        state.active = state.active + 1;
        markDirty();
        renderThumbnails();
        renderEditor();
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
        renderThumbnails();
        renderEditor();
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
        renderThumbnails();
        renderEditor();
    }

    // 디바운스 헬퍼
    const _timers = {};
    function debounce(key, fn, ms) {
        if (_timers[key]) clearTimeout(_timers[key]);
        _timers[key] = setTimeout(() => { fn(); delete _timers[key]; }, ms || 150);
    }
    function schedulePreview() { debounce('preview', updatePreview, 200); }

    // ────────────────────────────────────────────────────────────
    // 내보내기
    // ────────────────────────────────────────────────────────────
    function downloadHTML() {
        const html = buildFullDeckHTML();
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
        // 편집된 마크다운을 기존 exportToPptx가 사용하도록 임시로 모듈에 주입 후 호출
        const mod = typeof getEditingModule === 'function'
            ? getEditingModule(state.moduleId)
            : null;
        if (!mod) {
            if (window.showAlert) window.showAlert('교안 모듈을 찾을 수 없습니다.');
            return;
        }
        const tabKey = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
        const newMd = deckToMarkdown();
        // 원본 보존 후 임시 덮어쓰기 → PPTX 생성 → 복원
        const origTab = tabKey && mod.tabContents ? mod.tabContents[tabKey] : undefined;
        const origContent = mod.content;
        try {
            if (tabKey && mod.tabContents) mod.tabContents[tabKey] = newMd;
            mod.content = newMd;
            if (typeof window.exportToPptx === 'function') {
                window.exportToPptx();
            } else {
                if (window.showAlert) window.showAlert('PPTX 내보내기 기능을 찾을 수 없습니다.');
            }
        } finally {
            if (tabKey && mod.tabContents) mod.tabContents[tabKey] = origTab;
            mod.content = origContent;
        }
    }

    function saveToModule() {
        const mod = typeof getEditingModule === 'function'
            ? getEditingModule(state.moduleId)
            : null;
        if (!mod) return;
        if (!confirm('편집한 슬라이드 내용을 교안 탭에 반영합니다. 원본 교안이 덮어쓰기 됩니다. 계속하시겠습니까?')) return;
        const tabKey = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
        const newMd = deckToMarkdown();
        if (tabKey && mod.tabContents) mod.tabContents[tabKey] = newMd;
        mod.content = newMd;
        if (typeof window.saveState === 'function') window.saveState();
        if (typeof window.openModuleEditor === 'function') window.openModuleEditor(mod.id);
        clearDirty();
        if (window.showToast) window.showToast('✅ 교안에 저장됨', 'success');
    }

    // ────────────────────────────────────────────────────────────
    // 진입점 / 종료
    // ────────────────────────────────────────────────────────────
    function openEditor(moduleId) {
        const mod = typeof getEditingModule === 'function'
            ? getEditingModule(moduleId)
            : null;
        if (!mod) {
            if (window.showAlert) window.showAlert('교안을 먼저 선택해주세요.');
            return;
        }
        const content = (mod.tabContents && typeof currentLessonTab !== 'undefined'
            ? mod.tabContents[currentLessonTab]
            : null) || mod.content;
        if (!content) {
            if (window.showAlert) window.showAlert('교안 내용이 없습니다. 먼저 탭을 생성해주세요.');
            return;
        }

        state.slides = parseDeck(content);
        if (state.slides.length === 0) {
            state.slides = [{
                id: genId(), kind: 'title', title: mod.title || '새 슬라이드',
                bullets: [], body: '', images: [], notes: '',
            }];
        }
        state.active = 0;
        state.moduleId = moduleId;
        state.title = mod.title || '슬라이드';
        state.images = mod.images || {};
        state.dirty = false;

        renderShell();
        renderThumbnails();
        renderEditor();
    }

    function renderShell() {
        document.getElementById('slide-editor-root')?.remove();
        const root = document.createElement('div');
        root.id = 'slide-editor-root';
        root.style.cssText = `position:fixed;inset:0;z-index:9998;background:${COLORS.bg};display:flex;flex-direction:column;backdrop-filter:blur(8px);`;
        root.innerHTML = `
          <!-- 헤더 -->
          <div style="display:flex;align-items:center;gap:12px;padding:12px 20px;background:${COLORS.panel};border-bottom:1px solid ${COLORS.border};">
            <i class="ph-fill ph-presentation-chart" style="color:${COLORS.accent};font-size:18px;"></i>
            <h3 style="color:${COLORS.text};font-size:15px;font-weight:700;margin:0;flex:1;">슬라이드 편집기 — ${escapeHtml(state.title)}
              <span id="slide-editor-dirty" style="display:none;margin-left:8px;padding:2px 8px;font-size:10px;font-weight:700;background:rgba(245,158,11,0.15);color:#f59e0b;border-radius:10px;">편집됨</span>
            </h3>
            <button id="sed-save" title="교안에 저장" style="padding:7px 14px;font-size:12px;font-weight:700;border:1px solid rgba(34,197,94,0.5);background:rgba(34,197,94,0.15);color:#22c55e;border-radius:6px;cursor:pointer;">💾 교안에 저장</button>
            <button id="sed-html" style="padding:7px 14px;font-size:12px;font-weight:700;border:1px solid rgba(139,92,246,0.5);background:rgba(139,92,246,0.15);color:${COLORS.accent2};border-radius:6px;cursor:pointer;">📥 HTML</button>
            <button id="sed-pptx" style="padding:7px 14px;font-size:12px;font-weight:700;border:1px solid rgba(34,211,238,0.5);background:rgba(34,211,238,0.15);color:${COLORS.accent};border-radius:6px;cursor:pointer;">📊 PPTX</button>
            <button id="sed-close" style="padding:7px 14px;font-size:12px;font-weight:700;border:1px solid rgba(248,113,113,0.3);background:transparent;color:#f87171;border-radius:6px;cursor:pointer;">✕ 닫기</button>
          </div>

          <!-- 본문: 썸네일 + 편집 캔버스 -->
          <div style="flex:1;display:grid;grid-template-columns:260px 1fr;min-height:0;">
            <!-- 썸네일 사이드바 -->
            <aside style="border-right:1px solid ${COLORS.border};background:rgba(0,0,0,0.3);overflow-y:auto;padding:14px;">
              <div style="font-size:10px;font-weight:700;color:${COLORS.muted};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:10px;">슬라이드 목록</div>
              <div id="slide-editor-thumbs" style="display:flex;flex-direction:column;gap:8px;"></div>
            </aside>

            <!-- 편집 캔버스 -->
            <main style="overflow-y:auto;padding:20px 24px;">
              <div id="slide-editor-canvas"></div>
            </main>
          </div>`;
        document.body.appendChild(root);

        // ESC 닫기
        root._escHandler = (e) => { if (e.key === 'Escape') closeEditor(); };
        document.addEventListener('keydown', root._escHandler);

        // 버튼 바인딩
        document.getElementById('sed-close').addEventListener('click', closeEditor);
        document.getElementById('sed-html').addEventListener('click', downloadHTML);
        document.getElementById('sed-pptx').addEventListener('click', downloadPPTX);
        document.getElementById('sed-save').addEventListener('click', saveToModule);
    }

    function closeEditor() {
        if (state.dirty && !confirm('편집된 내용이 저장되지 않았습니다. 닫으시겠습니까?')) return;
        const root = document.getElementById('slide-editor-root');
        if (root) {
            if (root._escHandler) document.removeEventListener('keydown', root._escHandler);
            root.remove();
        }
    }

    // ────────────────────────────────────────────────────────────
    // 전역 노출
    // ────────────────────────────────────────────────────────────
    window.openSlideEditor = openEditor;
    window.closeSlideEditor = closeEditor;
})();
