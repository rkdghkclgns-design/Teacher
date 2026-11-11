/* Ported from develocket-slide@3a7303f assets/export.js for slide-studio.html */
/* export.js — 슬라이드 덱을 HTML(단독 파일) / PPTX로 내보내기
   window.KBuilder.exportHTML(), window.KBuilder.exportPPTX() */
(function () {
  "use strict";
  var esc = function (s) { return window.KBuilder.escapeHtml(s == null ? "" : s); };

  function download(filename, data, mime) {
    var blob = new Blob([data], { type: (mime || "text/plain") + ";charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 120);
  }
  function fetchText(path) { return fetch(path).then(function (r) { return r.text(); }); }

  /* 웹폰트(Jua·Gothic A1)를 dataURL로 내장한 CSS 생성 (1회 캐시) */
  var FONT_CSS_URL = "https://fonts.googleapis.com/css2?family=Jua&family=Gothic+A1:wght@400;700;900&display=swap";
  var fontCssCache = null;
  function getFontCss() {
    if (fontCssCache) return Promise.resolve(fontCssCache);
    return fetch(FONT_CSS_URL).then(function (r) { return r.text(); }).then(function (css) {
      var urls = [], re = /url\((https:[^)]+)\)/g, m;
      while ((m = re.exec(css))) urls.push(m[1]);
      var uniq = Array.from(new Set(urls));
      return Promise.all(uniq.map(function (u) {
        return fetch(u).then(function (r) { return r.blob(); }).then(function (b) {
          return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res([u, fr.result]); }; fr.readAsDataURL(b); });
        });
      })).then(function (pairs) {
        pairs.forEach(function (p) { css = css.split(p[0]).join(p[1]); });
        fontCssCache = css;
        return css;
      });
    });
  }
  function fetchDataUrl(path) {
    return fetch(path).then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(b); });
    });
  }
  function slotSrc(id) {
    var sl = document.getElementById(id);
    if (!sl) return "";
    return (sl._img && sl._img.src && sl._img.src.indexOf("data:") === 0) ? sl._img.src : (sl.getAttribute("src") || "");
  }

  /* ============ HTML 단독 파일 내보내기 ============ */
  function exportHTML() {
    var deck = window.KBuilder.lastDeck;
    var inner = document.querySelector("#deck-mount .deck-stage-inner");
    if (!deck || !inner) { alert("먼저 슬라이드를 만들어 주세요."); return; }
    var btn = document.getElementById("btn-html"); var old = btn.textContent; btn.textContent = "⏳ 폰트 포함 중…";

    // 모든 슬라이드의 애니 순서를 굽고 인라인 딜레이를 박아 — 내보낸 HTML도 같은 순서로 재생
    if (window.KBuilder.animOrder) window.KBuilder.animOrder.ensureAll(inner);
    // 감춘 슬라이드까지 글 칸 배율을 다시 재 둔다 — 내보낸 파일은 그 배율을 그대로 쓴다 (deck-runtime.js)
    if (window.KBuilder.deckFit) window.KBuilder.deckFit.all(inner);
    Promise.all([fetchText("css/kbuilder/styles.css"), fetchText("css/kbuilder/slides.css"), getFontCss().catch(function () { return null; })]).then(function (parts) {
      var css = parts[0] + "\n" + parts[1];
      var fontCss = parts[2];
      var clone = inner.cloneNode(true);
      // 편집 잔여물 제거 (핸들·선택 외곽선)
      Array.prototype.slice.call(clone.querySelectorAll(".rs-handle")).forEach(function (h) { h.remove(); });
      Array.prototype.slice.call(clone.querySelectorAll(".sel-elem")).forEach(function (x) { x.classList.remove("sel-elem"); });
      // image-slot → <div><img></div> (현재 이미지 또는 placeholder)
      var slots = Array.prototype.slice.call(clone.querySelectorAll("image-slot"));
      slots.forEach(function (sl) {
        var src = slotSrc(sl.id) || sl.getAttribute("src") || "";
        var fit = sl.getAttribute("fit") || "contain";
        var wrap = document.createElement("div");
        wrap.className = sl.className;
        wrap.setAttribute("style", "overflow:hidden;display:flex;align-items:center;justify-content:center;background:#f3eee0");
        if (src) {
          var im = document.createElement("img");
          im.src = src; im.setAttribute("style", "width:100%;height:100%;object-fit:" + fit);
          wrap.appendChild(im);
        } else {
          wrap.style.color = "#9a8f78"; wrap.style.fontSize = "24px"; wrap.style.padding = "24px"; wrap.style.textAlign = "center";
          wrap.textContent = sl.getAttribute("placeholder") || "";
        }
        sl.parentNode.replaceChild(wrap, sl);
      });
      // 상대경로 이미지(logo/mushroom)를 dataURL로 인라인
      var imgs = Array.prototype.slice.call(clone.querySelectorAll("img")).filter(function (im) {
        var s = im.getAttribute("src") || ""; return s.indexOf("assets/") === 0 || (s.indexOf("data:") !== 0 && s.indexOf("http") !== 0);
      });
      return Promise.all(imgs.map(function (im) {
        return fetchDataUrl(im.getAttribute("src")).then(function (d) { im.setAttribute("src", d); }).catch(function () {});
      })).then(function () {
        // 영상 칸: 주소 영상은 재생기로, 넣은 파일·판서 영상은 파일 안에 넣는다. 못 찾은 영상은 제목 칸으로 남는다
        return window.KBuilder.deckVideo ? window.KBuilder.deckVideo.exportInto(clone) : null;
      }).then(function () {
        var themeCls = inner.classList.contains("theme-dark") ? " theme-dark" : "";
        var total = clone.querySelectorAll(".slide").length; // 저장본·불러온 덱은 parsed.slides 가 비어 있거나 편집으로 달라졌다
        var doc = standaloneDoc(deck.parsed, clone.innerHTML, css, themeCls, fontCss, total);
        download((window.KBuilder.exportFileBase || deck.parsed.meta["주제"] || "슬라이드") + ".html", doc, "text/html");
        btn.textContent = old;
      });
    }).catch(function (e) { console.error(e); alert("HTML 내보내기 실패: " + e); btn.textContent = old; });
  }

  function standaloneDoc(parsed, innerHTML, css, themeCls, fontCss, total) {
    var title = esc(parsed.meta["주제"] || "슬라이드");
    var fontPart = fontCss
      ? '<style>' + fontCss + '</style>'
      : '<link href="https://fonts.googleapis.com/css2?family=Jua&family=Gothic+A1:wght@400;500;700;800;900&display=swap" rel="stylesheet"/>';
    // 교수안·편성안 MD와 참고 이미지를 내장 — 'HTML 불러오기'에서 한번에 복원·수정 가능
    var src = window.KBuilder.getSource ? window.KBuilder.getSource() : null;
    var srcPart = "";
    if (src && (src.doc || src.deck || src.source)) {
      srcPart = '<script type="application/json" id="kb-source">' +
        JSON.stringify(src).replace(/</g, "\\u003c") + '<\/script>';
    }
    return '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
      '<title>' + title + '</title>' + fontPart +
      '<style>html,body{margin:0;height:100%;background:#18213a}\n' + css + '\n' +
      '.deck-viewport{position:fixed;inset:0}</style></head><body>' +
      '<div class="deck-viewport" tabindex="0">' +
      '<div class="deck-scaler"><div class="deck-stage-inner' + (themeCls || "") + '">' + innerHTML + '</div></div>' +
      '<button class="deck-nav prev" aria-label="이전">‹</button>' +
      '<button class="deck-nav next" aria-label="다음">›</button>' +
      '<div class="deck-counter"><span class="dc-cur">1</span> / <span class="dc-tot">' + (total || parsed.slides.length) + '</span></div>' +
      '</div>' + srcPart + '<script>' + stageScript() + '<\/script></body></html>';
  }

  function stageScript() {
    return "(function(){var vp=document.querySelector('.deck-viewport'),sc=document.querySelector('.deck-scaler')," +
      "ss=[].slice.call(document.querySelectorAll('.slide')),i=0,cur=document.querySelector('.dc-cur');" +
      // 넘어간 슬라이드의 영상은 멈춘다 (감춘 슬라이드에서 소리가 계속 나지 않게) — 삽입 플레이어는 주소를 다시 넣어 멈춘다
      "function quiet(s){[].forEach.call(s.querySelectorAll('video'),function(v){try{v.pause();}catch(e){}});[].forEach.call(s.querySelectorAll('iframe'),function(f){f.src=f.src;});}" +
      "function show(n){var p=i;i=Math.max(0,Math.min(ss.length-1,n));if(p!==i&&ss[p])quiet(ss[p]);ss.forEach(function(s,k){if(k===i){s.setAttribute('data-deck-active','');s.style.display='block';}else{s.removeAttribute('data-deck-active');s.style.display='none';}});cur.textContent=i+1;}" +
      "function fit(){var w=vp.clientWidth,h=vp.clientHeight;if(w<2||h<2)return;sc.style.transform='translate(-50%,-50%) scale('+Math.min(w/1920,h/1080)+')';}" +
      "document.querySelector('.deck-nav.prev').onclick=function(){show(i-1);};document.querySelector('.deck-nav.next').onclick=function(){show(i+1);};" +
      "addEventListener('keydown',function(e){if(e.target&&/^(VIDEO|IFRAME)$/.test(e.target.tagName||''))return;if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){show(i+1);}if(e.key==='ArrowLeft'||e.key==='PageUp'){show(i-1);}});" +
      "addEventListener('resize',fit);new ResizeObserver(fit).observe(vp);fit();show(0);})();";
  }

  /* ============ PPTX 내보내기 (PptxGenJS, 편집 가능 텍스트) ============ */
  var IW = 13.333, IH = 7.5;
  function X(px) { return +(px / 1920 * IW).toFixed(2); }
  function Y(px) { return +(px / 1080 * IH).toFixed(2); }
  function PT(px) { return Math.max(12, Math.round(px * 0.5)); }
  var C = { ink: "2B2240", soft: "5C5470", mush: "F5A623", pink: "F48FB6", sky: "5CC6F0", lime: "A9C63E", orange: "F3994F", paper: "FFFDF6" };
  var BASE = JSON.parse(JSON.stringify(C));
  var THEME = { bg: "FFF3E0", phFill: "F3EEE0", phText: "9A8F78", phLine: "FFFFFF", dark: false };
  var POINTS = ["pink", "sky", "lime", "orange"];

  function tagOf(text) {
    var m = text.match(/^\(([^)]{1,8})\)\s*(.*)$/);
    if (!m) return { tag: "", text: text };
    var t = m[1].replace(/\s+/g, "");
    var map = { "제목": "title", "부제": "subtitle", "큰문구": "big", "하단": "foot", "한줄": "cap" };
    return { tag: map[t] || "", text: m[2].trim() };
  }
  function bodyLines(s) {
    var arr = [];
    s.lines.forEach(function (l) {
      var info = tagOf(l.text); var t = info.text;
      if (info.tag === "title" || info.tag === "subtitle") return; // 표지/별도 처리
      t = t.replace(/\s*→\s*/g, "  →  ");
      arr.push({ text: t, indent: l.depth > 0 ? 1 : 0, tag: info.tag });
    });
    return arr;
  }

  function exportPPTX() {
    var deck = window.KBuilder.lastDeck;
    if (!deck) { alert("먼저 슬라이드를 만들어 주세요."); return; }
    if (deck.imported || !deck.parsed.slides.length) { alert("불러온 HTML 덱은 PPTX 변환을 지원하지 않아요. HTML 또는 PDF로 내보내 주세요."); return; }
    if (typeof PptxGenJS === "undefined") { alert("PPTX 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."); return; }
    var btn = document.getElementById("btn-pptx"); var old = btn.textContent; btn.textContent = "⏳ PPTX…";

    // 테마 반영
    var darkTheme = !!document.querySelector("#deck-mount .deck-stage-inner.theme-dark");
    Object.assign(C, BASE);
    if (darkTheme) Object.assign(C, { ink: "E9EEF7", soft: "93A1B8", mush: "29B6E8", pink: "29B6E8", sky: "4FC7F0", lime: "35C3EA", orange: "29B6E8", paper: "1A2336" });
    Object.assign(THEME, darkTheme
      ? { bg: "0E1628", phFill: "101A2E", phText: "6D7C97", phLine: "33415E", dark: true }
      : { bg: "FFF3E0", phFill: "F3EEE0", phText: "9A8F78", phLine: "FFFFFF", dark: false });

    var Lg = window.KBuilder.logo || {};
    var logoData = (Lg.shown && Lg.src) ? Lg.src : null;
    Promise.all([fetchDataUrl("assets/kbuilder/mushroom.png")]).then(function (imgs) {
      var mush = imgs[0];
      var pptx = new PptxGenJS();
      pptx.defineLayout({ name: "MW", width: IW, height: IH });
      pptx.layout = "MW";
      var meta = deck.parsed.meta || {};
      var key = deck.key;
      var accentIdx = 0;

      deck.parsed.slides.forEach(function (s, i) {
        var slide = pptx.addSlide();
        slide.background = { color: THEME.bg };
        var accent = C.mush;
        if (s.kind === "content" || s.kind === "activity" || s.kind === "toc") { accent = C[POINTS[accentIdx % 4]]; accentIdx++; }
        else if (s.kind === "video") accent = C[POINTS[accentIdx % 4]]; // 영상 슬라이드는 세지 않는다 (화면과 같다)

        // 사용자 로고 (표시 설정 시에만, 비율 유지)
        if (logoData) slide.addImage({ data: logoData, x: X(1920 - 64 - 300), y: Y(44), w: X(300), h: Y(132), sizing: { type: "contain", w: X(300), h: Y(132) } });

        if (s.kind === "cover") coverSlide(slide, s, meta, mush, key);
        else if (s.kind === "closing") closingSlide(slide, s, meta, mush, key);
        else if (s.kind === "toc") tocSlide(slide, s, accent);
        else if (s.kind === "video") videoOnlySlide(slide, s, accent);
        else contentSlide(slide, s, accent, key, mush);

        // 우측 하단 푸터 제거 (사용자 요청)
      });

      pptx.writeFile({ fileName: (window.KBuilder.exportFileBase || meta["주제"] || "슬라이드") + ".pptx" }).then(function () { btn.textContent = old; });
    }).catch(function (e) { console.error(e); alert("PPTX 내보내기 실패: " + e); btn.textContent = old; });
  }
  function pad2(n) { var s = String(n).replace(/[^0-9]/g, ""); return s.length < 2 ? "0" + s : s; }

  function coverSlide(slide, s, meta, mush, key) {
    var pick = function (tag) { var it = s.lines.find(function (l) { return tagOf(l.text).tag === tag; }); return it ? tagOf(it.text).text : ""; };
    var H = window.KBuilder.deckHeuristics;
    var raw = { title: pick("title") || meta["주제"] || s.title, sub: pick("subtitle") || meta["부제"] || "", foot: pick("foot") };
    // 화면과 같은 규칙: 긴 제목은 제목·부제로 나누고 글자 크기를 줄인다
    var cp = H && H.coverParts ? H.coverParts(raw.title, raw.sub, raw.foot) : { title: raw.title, sub: raw.sub, foot: raw.foot, size: "" };
    slide.addText("🍄 " + (meta["교과목"] || "메이플스토리 월드 코딩 교실"), { x: X(110), y: Y(300), w: X(1000), h: Y(60), fontSize: 13, color: C.mush, bold: true });
    slide.addText(cp.title, { x: X(110), y: Y(360), w: X(1050), h: Y(320), fontSize: PT(cp.size === "xl" ? 60 : cp.size === "l" ? 80 : 110), fontFace: "Jua", color: C.ink, bold: true, valign: "top" });
    if (cp.sub) slide.addText(cp.sub, { x: X(110), y: Y(690), w: X(1050), h: Y(110), fontSize: PT(34), color: C.soft, valign: "top" });
    if (cp.foot) slide.addText(cp.foot, { x: X(110), y: Y(810), w: X(1050), h: Y(60), fontSize: PT(26), color: C.soft });
    var img = slotSrc(key + "-mush-cover");
    if (img) slide.addImage({ data: img.indexOf("data:") === 0 ? img : undefined, path: img.indexOf("data:") === 0 ? undefined : img, x: X(1230), y: Y(240), w: X(560), h: X(560), rounding: true });
  }

  function closingSlide(slide, s, meta, mush, key) {
    var bigItem = s.lines.find(function (l) { var t = tagOf(l.text).tag; return t === "big" || t === "title"; });
    var big = bigItem ? tagOf(bigItem.text).text : (s.key || s.title);
    // 화면과 같이 글자만 가운데 — 직접 넣은 이미지가 있을 때만 왼쪽에 둔다
    var img = slotSrc(key + "-mush-closing");
    if (!img) {
      slide.addText("🍄 " + s.title, { x: X(260), y: Y(330), w: X(1400), h: Y(60), fontSize: 13, color: C.mush, bold: true, align: "center" });
      slide.addText(big, { x: X(160), y: Y(400), w: X(1600), h: Y(300), fontSize: PT(64), fontFace: "Jua", color: C.ink, bold: true, align: "center", valign: "top" });
      return;
    }
    slide.addImage({ data: img.indexOf("data:") === 0 ? img : undefined, path: img.indexOf("data:") === 0 ? undefined : img, x: X(130), y: Y(240), w: X(560), h: X(560), rounding: true });
    slide.addText("🍄 " + s.title, { x: X(760), y: Y(360), w: X(1000), h: Y(60), fontSize: 13, color: C.mush, bold: true });
    slide.addText(big, { x: X(760), y: Y(420), w: X(1030), h: Y(260), fontSize: PT(64), fontFace: "Jua", color: C.ink, bold: true, valign: "top" });
  }

  function tocSlide(slide, s, accent) {
    // 화면과 같은 규칙(번호 줄 · 차시 흐름의 '도입. …'·'전개 1. …' 줄)으로 항목을 읽는다
    var H = window.KBuilder.deckHeuristics || {};
    var heading = "", items = [];
    if (H.tocParts) { var tp = H.tocParts(s.lines); heading = tp.heading; items = tp.items; }
    else s.lines.forEach(function (l) {
      var t = tagOf(l.text).text;
      if (/^\s*\d+[.)]/.test(t)) items.push(t.replace(/^\s*\d+[.)]\s*/, ""));
      else if (!items.length && !heading) heading = t;
      else items.push(t);
    });
    slide.addText(heading || "오늘의 여정", { x: X(110), y: Y(150), w: X(1400), h: Y(90), fontSize: PT(60), fontFace: "Jua", color: C.ink, bold: true });
    var cols = 2, cw = 820, ch = 120, gx = 40, gy = 26, x0 = 110, y0 = 320;
    items.slice(0, 8).forEach(function (it, i) {
      var cx = x0 + (i % cols) * (cw + gx), cy = y0 + Math.floor(i / cols) * (ch + gy);
      var c = C[POINTS[i % 4]];
      slide.addShape("roundRect", { x: X(cx), y: Y(cy), w: X(cw), h: Y(ch), fill: { color: C.paper }, line: { color: "FFFFFF" }, rectRadius: 0.12 });
      slide.addText(String(i + 1), { x: X(cx + 22), y: Y(cy + 22), w: X(76), h: Y(76), fill: { color: c }, color: "FFFFFF", align: "center", valign: "middle", fontFace: "Jua", fontSize: PT(48), rectRadius: 0.1 });
      slide.addText(it, { x: X(cx + 120), y: Y(cy), w: X(cw - 140), h: Y(ch), valign: "middle", fontSize: PT(30), color: C.ink, bold: true });
    });
  }

  /* ---------- 내용 레이아웃별 본문 렌더러 (화면 렌더와 동일한 판별·순서) ---------- */
  /* 글자 너비 어림 (전각 1, 영문·숫자·빈칸 약 0.56 — render-deck.js textUnits 와 같다) */
  function textUnits(text) {
    var t = String(text || ""), n = 0;
    for (var i = 0; i < t.length; i++) n += t.charCodeAt(i) > 0x2E7F ? 1 : 0.56;
    return n;
  }
  /* 너비 max(전각 글자 수)를 넘는 글은 낱말 끝에서 자르고 … 을 붙인다 */
  function clampText(text, max) {
    var t = String(text || "").trim();
    if (textUnits(t) <= max) return t;
    var n = 0, end = 0;
    while (end < t.length && n + (t.charCodeAt(end) > 0x2E7F ? 1 : 0.56) <= max - 1) { n += t.charCodeAt(end) > 0x2E7F ? 1 : 0.56; end++; }
    var cut = t.slice(0, end), space = cut.lastIndexOf(" ");
    if (space > cut.length * 0.4 && !/^\s/.test(t.slice(end))) cut = cut.slice(0, space); // 낱말 가운데서 끊지 않는다
    return cut.replace(/[\s,.;:·]+$/, "") + "…";
  }
  /* 핵심 띠의 글·높이·자리. 화면의 3줄 말줄임과 같게 3줄 분량까지만 넣고, 줄 수만큼 띠를 키워 바닥(976px)에 맞춘다. 핵심이 없으면 null */
  function keyBox(s, bw) {
    if (!s.key) return null;
    var per = Math.max(10, Math.floor((bw - 190) / 28)); // 한 줄에 드는 전각 글자 수 (28px 글자)
    var text = clampText(s.key, per * 3);
    var lines = Math.min(3, Math.max(1, Math.ceil(textUnits(text) / per)));
    var h = lines === 1 ? 96 : 56 + lines * 42;
    return { text: text, h: h, y: 976 - h, w: bw };
  }
  /* 본문이 끝나야 하는 높이(px): 핵심 띠가 있으면 그 위 24px, 없으면 예전 자리 */
  function bodyBottom(kb, plain) { return kb ? kb.y - 24 : plain; }
  function keybarShape(slide, kb, accent) {
    if (!kb) return;
    slide.addShape("roundRect", { x: X(110), y: Y(kb.y), w: X(kb.w), h: Y(kb.h), fill: { color: accent }, rectRadius: 0.14 });
    slide.addText([{ text: "핵심 ", options: { fontFace: "Jua", color: "FFFFFF" } }, { text: kb.text, options: { color: "FFFFFF", bold: true } }], { x: X(140), y: Y(kb.y), w: X(kb.w - 60), h: Y(kb.h), valign: "middle", fontSize: PT(28) });
  }
  function imageBlock(slide, s, key, h) {
    if (!s.visual) return;
    h = Math.min(500, h || 500);
    var img = slotSrc(key + "-img-" + s.num);
    // data: 는 그대로, 웹 주소(https…)는 path 로 넘겨야 pptxgenjs 가 받아 온다
    if (img) slide.addImage(Object.assign(img.indexOf("data:") === 0 ? { data: img } : { path: img }, { x: X(1180), y: Y(330), w: X(610), h: Y(h) }));
    else {
      slide.addShape("roundRect", { x: X(1180), y: Y(330), w: X(610), h: Y(h), fill: { color: THEME.phFill }, line: { color: THEME.phLine, width: 3 }, rectRadius: 0.1 });
      var vText = window.KBuilder.resolveVisual ? window.KBuilder.resolveVisual(s.visual).text : s.visual;
      slide.addText("🖼  " + (vText || "이미지"), { x: X(1210), y: Y(350), w: X(550), h: Y(h - 40), align: "center", valign: "middle", fontSize: PT(26), color: THEME.phText });
    }
  }
  /* 영상 칸: PPTX 에서는 재생하지 않는다. 판서 영상의 원래 그림·움직이는 GIF 가 있으면 그 그림을, 없으면 ▶ 칸을 그리고
     아래에 제목과(주소 영상이면) 링크를 적는다. 영상 값은 넣지 않는다 */
  function videoBlock(slide, v, x, y, w, h) {
    var source = window.KBuilder.videoSource, meta = null;
    try { meta = source && source.info ? source.info(v.ref) : null; } catch (e) { meta = null; }
    meta = meta || {};
    var title = v.title || meta.title || "영상";
    var cap = 70, picture = String((meta.kind === "gif" ? meta.src : meta.poster) || "");
    if (/^data:image\/(?:png|jpeg|gif);base64,/.test(picture)) {
      slide.addImage({ data: picture, x: X(x), y: Y(y), w: X(w), h: Y(h - cap), sizing: { type: "contain", w: X(w), h: Y(h - cap) } });
    } else {
      slide.addShape("roundRect", { x: X(x), y: Y(y), w: X(w), h: Y(h - cap), fill: { color: "101A2E" }, line: { color: THEME.phLine, width: 3 }, rectRadius: 0.1 });
      slide.addText("▶", { x: X(x), y: Y(y), w: X(w), h: Y(h - cap), align: "center", valign: "middle", fontSize: PT(90), color: "FFFFFF" });
    }
    var link = /^https:\/\/[^\s"'<>`\\]+$/.test(String(meta.link || "")) ? String(meta.link) : ""; // 링크는 https 주소만 (화면과 같다)
    var runs = [{ text: "▶ " + title, options: { color: C.soft, bold: true } }];
    if (link) runs.push({ text: "   " + (meta.linkText || "영상 보기"), options: { color: C.mush, bold: true, hyperlink: { url: link, tooltip: title } } });
    slide.addText(runs, { x: X(x), y: Y(y + h - cap), w: X(w), h: Y(cap), align: "center", valign: "middle", fontSize: PT(24) });
  }
  /* 옆 칸: 그림이 있으면 그림, 없고 영상이 있으면 영상 (화면과 같다) */
  function sideBlock(slide, s, key, h) {
    if (s.visual) imageBlock(slide, s, key, h);
    else if (s.videos && s.videos.length) videoBlock(slide, s.videos[0], 1180, 330, 610, Math.min(500, h));
  }
  function videoOnlySlide(slide, s, accent) {
    var title = s.title.replace(/^(동영상|영상)\s*[:：]\s*/, "");
    slide.addText("영상 · " + pad2(s.label || s.num), { x: X(110), y: Y(96), w: X(600), h: Y(54), fontSize: PT(24), color: C.soft, bold: true });
    slide.addText(title, { x: X(110), y: Y(150), w: X(1500), h: Y(150), fontSize: PT(60), fontFace: "Jua", color: C.ink, bold: true, valign: "top" });
    var kb = keyBox(s, 1700);
    var h = bodyBottom(kb, 960) - 320, w = Math.min(1700, Math.round((h - 70) * 16 / 9));
    if (s.videos && s.videos.length) videoBlock(slide, s.videos[0], 110 + (1700 - w) / 2, 320, w, h);
    keybarShape(slide, kb, accent);
  }
  function statementBody(slide, s, st) {
    slide.addText(st.big, { x: X(160), y: Y(360), w: X(1600), h: Y(320), align: "center", valign: "middle", fontSize: PT(72), fontFace: "Jua", color: C.ink, bold: true });
    var lead = (st.rest || []).join(" ") || s.key || "";
    if (lead) slide.addText(lead, { x: X(260), y: Y(700), w: X(1400), h: Y(90), align: "center", fontSize: PT(30), color: C.soft });
  }
  function compareBody(slide, s, groups, H, bottom) {
    var n = Math.min(4, groups.length);
    var gap = 36, x0 = 110, w = (1700 - gap * (n - 1)) / n, y0 = 330, h = bottom - y0;
    groups.slice(0, n).forEach(function (g, i) {
      var cx = x0 + i * (w + gap);
      var col = C[POINTS[i % 4]];
      slide.addShape("roundRect", { x: X(cx), y: Y(y0), w: X(w), h: Y(h), fill: { color: C.paper }, line: { color: THEME.phLine, width: 1 }, rectRadius: 0.06 });
      slide.addShape("rect", { x: X(cx + 10), y: Y(y0), w: X(w - 20), h: Y(12), fill: { color: col } });
      slide.addText(g.label, { x: X(cx + 30), y: Y(y0 + 34), w: X(w - 60), h: Y(74), fontSize: PT(38), fontFace: "Jua", color: col, bold: true });
      var items = (H.splitItems ? H.splitItems(g.body) : [g.body]).filter(Boolean);
      var runs = items.map(function (t) { return { text: t, options: { bullet: { code: "2022", indent: 12 }, fontSize: PT(26), color: C.ink, paraSpaceAfter: 8 } }; });
      if (runs.length) slide.addText(runs, { x: X(cx + 30), y: Y(y0 + 120), w: X(w - 60), h: Y(h - 150), valign: "top" });
    });
    var foot = H.footOf ? H.footOf(s.lines) : "";
    if (foot && !s.key) slide.addText(foot, { x: X(260), y: Y(880), w: X(1400), h: Y(70), align: "center", fontSize: PT(26), color: C.soft });
  }
  function cardsBody(slide, s, cards, bottom) {
    var n = Math.min(4, cards.length);
    var gap = 36, x0 = 110, w = (1700 - gap * (n - 1)) / n, y0 = 350, h = bottom - y0;
    cards.slice(0, n).forEach(function (cdef, i) {
      var cx = x0 + i * (w + gap);
      var col = C[POINTS[i % 4]];
      slide.addShape("roundRect", { x: X(cx), y: Y(y0), w: X(w), h: Y(h), fill: { color: C.paper }, line: { color: THEME.phLine, width: 1 }, rectRadius: 0.06 });
      slide.addText(String(i + 1), { x: X(cx + w / 2 - 38), y: Y(y0 + 36), w: X(76), h: Y(76), fill: { color: col }, color: "FFFFFF", align: "center", valign: "middle", fontFace: "Jua", fontSize: PT(40) });
      slide.addText(cdef.t, { x: X(cx + 24), y: Y(y0 + 130), w: X(w - 48), h: Y(100), align: "center", fontSize: PT(30), color: C.ink, bold: true });
      if (cdef.b && cdef.b.length) slide.addText(cdef.b.join(" "), { x: X(cx + 24), y: Y(y0 + 240), w: X(w - 48), h: Y(h - 260), align: "center", fontSize: PT(24), color: C.soft });
    });
  }
  function stepsBody(slide, s, steps, accent, bw, bottom) {
    var n = steps.length; // 모든 단계를 넣는다 (너무 많은 단계는 paginateDeck 이 '(이어서)' 장으로 나눈다)
    var from = s.stepFrom || 0; // (이어서) 슬라이드는 앞 장의 단계 번호를 잇는다
    var gap = 16, areaH = bottom - 330, rh = Math.min(90, (areaH - gap * (n - 1)) / n), y = 330;
    var num = Math.min(56, rh - 8), font = rh < 70 ? 22 : 27; // 띠가 높아져 줄이 낮아지면 글자도 줄인다
    steps.slice(0, n).forEach(function (t, i) {
      var col = C[POINTS[(from + i) % 4]];
      slide.addShape("roundRect", { x: X(110), y: Y(y), w: X(bw), h: Y(rh), fill: { color: C.paper }, line: { color: accent, width: 1.5 }, rectRadius: 0.12 });
      slide.addText(String(from + i + 1), { x: X(132), y: Y(y + (rh - num) / 2), w: X(56), h: Y(num), fill: { color: col }, color: "FFFFFF", align: "center", valign: "middle", fontFace: "Jua", fontSize: PT(30) });
      slide.addText(t, { x: X(210), y: Y(y), w: X(bw - 120), h: Y(rh), valign: "middle", fontSize: PT(font), color: C.ink, bold: true, fit: "shrink" });
      y += rh + gap;
    });
  }
  /* 글 목록이 칸 높이를 넘을 것 같으면 글자를 줄인다 (0.7배까지 — 화면과 같은 바닥). 줄 수는 글자 수로 어림한다 */
  function bulletScale(lines, bw, areaH) {
    var need = 0;
    lines.forEach(function (l) {
      var font = l.tag === "big" ? 40 : 30;
      need += Math.max(1, Math.ceil(textUnits(l.text) * font / Math.max(bw - 60 - (l.indent ? 40 : 0), font))) * font * 1.3 + 14;
    });
    return need > areaH ? Math.max(0.7, areaH / need) : 1;
  }

  function contentSlide(slide, s, accent, key, mush) {
    var isAct = s.kind === "activity";
    var title = isAct ? s.title.replace(/^\[?활동\]?\s*[:：]?\s*/, "") : s.title;
    var H = window.KBuilder.deckHeuristics || {};
    // 화면 렌더(renderSlide)와 같은 배치 판별 — '(이어서)'로 나눈 장은 나누기 전 배치(s.layout)를 그대로 쓴다
    var layout = H.layoutOf ? H.layoutOf(s) : "";

    // 문구(statement) 레이아웃은 화면처럼 큰 제목 없이 작은 키커 + 중앙 큰 문구만 그린다
    var st = layout === "statement" && H.statementInfo ? H.statementInfo(s.lines) : null;
    if (st) {
      slide.addText(title, { x: X(260), y: Y(240), w: X(1400), h: Y(60), align: "center", fontSize: PT(26), color: accent, bold: true });
      statementBody(slide, s, st);
      return;
    }

    // 아이브로 + 제목 (문구 외 모든 내용 레이아웃 공통)
    slide.addText((isAct ? "활동 · " : "") + pad2(s.label || s.num), { x: X(110), y: Y(96), w: X(400), h: Y(54), fontSize: PT(24), color: C.soft, bold: true });
    slide.addText(title, { x: X(110), y: Y(150), w: X(1500), h: Y(150), fontSize: PT(60), fontFace: "Jua", color: C.ink, bold: true, valign: "top" });

    var hasSide = !!s.visual || !!(s.videos && s.videos.length); // 옆 칸: 그림이나 영상
    var bw = hasSide ? 980 : 1700;
    // 핵심 띠는 3줄 분량까지 키우고, 본문 칸은 그 위에서 끝낸다 (띠가 본문을 덮지 않게)
    var wide = keyBox(s, 1700), kb = keyBox(s, bw);

    // 화면 렌더(renderSlide)와 같은 배치: 비교 · 카드 · 단계 · 불릿
    var groups = layout === "compare" && H.labeledGroups ? H.labeledGroups(s.lines) : null;
    if (groups) { compareBody(slide, s, groups, H, bodyBottom(wide, 840)); keybarShape(slide, wide, accent); return; }
    var cards = layout === "cards" && H.collectCards ? H.collectCards(s.lines) : null;
    if (cards) { cardsBody(slide, s, cards, bodyBottom(wide, 830)); keybarShape(slide, wide, accent); return; }
    var steps = layout === "steps" && H.stepItems ? H.stepItems(s.lines) : null;
    if (steps) { stepsBody(slide, s, steps, accent, bw, bodyBottom(kb, 850)); sideBlock(slide, s, key, bodyBottom(kb, 830) - 330); keybarShape(slide, kb, accent); return; }

    // 기본: 불릿 + 이미지(또는 영상)
    var lines = bodyLines(s);
    var areaH = bodyBottom(kb, 850) - 330;
    var scale = bulletScale(lines, bw, areaH);
    var textRuns = lines.map(function (l) {
      return { text: l.text, options: { bullet: l.tag ? false : { code: "2022", indent: 14 }, indentLevel: l.indent, fontSize: PT((l.tag === "big" ? 40 : 30) * scale), color: l.indent ? C.soft : C.ink, bold: l.tag === "big", paraSpaceAfter: 10 } };
    });
    if (textRuns.length) slide.addText(textRuns, { x: X(110), y: Y(330), w: X(bw), h: Y(areaH), valign: "top", fit: "shrink" });
    sideBlock(slide, s, key, bodyBottom(kb, 830) - 330);
    keybarShape(slide, kb, accent);
  }

  window.KBuilder = window.KBuilder || {};
  window.KBuilder.exportHTML = exportHTML;
  window.KBuilder.exportPPTX = exportPPTX;
  window.KBuilder.standaloneDoc = standaloneDoc; // 순수 조립 함수 (테스트/QA용)
})();
