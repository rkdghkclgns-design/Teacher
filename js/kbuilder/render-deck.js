/* Ported from develocket-slide@3a7303f assets/render-deck.js for slide-studio.html */
/* render-deck.js — 파싱된 편성안 → 메이플스토리 월드 템플릿 16:9 슬라이드
   window.KBuilder.buildDeck(parsed, mountEl) */
(function () {
  "use strict";
  var esc = function (s) { return window.KBuilder.escapeHtml(s == null ? "" : s); };
  // 인라인 마크다운(**굵게**, `코드`)을 슬라이드 텍스트에도 적용한다.
  // 편성안 MD의 ** 가 슬라이드에 그대로 노출되던 문제 해결. (속성/ID에는 쓰지 말 것)
  function inlineMd(s) {
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s;
  }
  var POINTS = ["--pink", "--sky", "--lime", "--orange"];
  function pad2(n) { var s = String(n).replace(/[^0-9]/g, ""); return s.length < 2 ? "0" + s : s; }

  function tagOf(text) {
    var m = text.match(/^\(([^)]{1,8})\)\s*(.*)$/);
    if (!m) return { tag: "", text: text };
    var t = m[1].replace(/\s+/g, "");
    var map = { "제목": "title", "부제": "subtitle", "큰문구": "big", "하단": "foot", "한줄": "cap" };
    return { tag: map[t] || "", text: m[2].trim() };
  }
  function isFlow(t) { return t.indexOf("→") !== -1 && t.split("→").length >= 2; }
  function isChips(t) { var p = t.split(/\s*[\/·]\s*/); return p.length >= 3 && p.every(function (x) { return x.trim().length <= 16; }); }
  function isStep(t) { return /^\s*(\d+[.)]|[①②③④⑤⑥⑦⑧⑨])\s*/.test(t); }

  function deckKey(meta) {
    var base = (meta["주제"] || meta["교과목"] || "deck");
    var h = 0; for (var i = 0; i < base.length; i++) { h = (h * 31 + base.charCodeAt(i)) % 100000; }
    return "d" + h;
  }

  /* ---------- 본문 ---------- */
  function renderBody(lines) {
    var out = [], buf = [];
    function flush() {
      if (!buf.length) return;
      out.push('<ul class="items anim2">' + buf.map(function (b) {
        var sub = b.depth > 0 ? " sub" : "";
        return '<li class="' + sub.trim() + '"><span class="chk">✓</span><span>' + inlineMd(b.text) + '</span></li>';
      }).join("") + '</ul>');
      buf = [];
    }
    lines.forEach(function (item) {
      var info = tagOf(item.text), text = info.text;
      if (info.tag === "big" || info.tag === "title" || info.tag === "subtitle") { flush(); out.push('<p class="lead anim" style="font-size:var(--type-subtitle);color:var(--ink);font-weight:700;max-width:none">' + inlineMd(text) + '</p>'); return; }
      if (info.tag === "foot" || info.tag === "cap") { flush(); out.push('<p class="lead anim3">' + inlineMd(text) + '</p>'); return; }
      if (isFlow(text)) { flush(); out.push(flowHtml(text)); return; }
      if (isStep(text) && item.depth === 0) { flush(); out.push(stepHtml(text)); return; }
      if (isChips(text) && item.depth === 0) { flush(); out.push(chipsHtml(text)); return; }
      buf.push(item);
    });
    flush();
    return out.join("");
  }
  function flowHtml(text) {
    var steps = text.split("→").map(function (s) { return s.trim(); }).filter(Boolean);
    return '<div class="flow anim2">' + steps.map(function (s, i) {
      var m = s.match(/^\s*(\d+)[.)]\s*(.*)$/);
      var no = m ? '<span class="no">' + m[1] + '</span>' : "";
      var lab = m ? m[2] : s;
      return '<div class="step">' + no + '<span>' + inlineMd(lab) + '</span></div>' + (i < steps.length - 1 ? '<span class="arrow">→</span>' : "");
    }).join("") + '</div>';
  }
  function stepHtml(text) {
    var no = text.match(/^\s*(\d+|[①②③④⑤⑥⑦⑧⑨])/)[1];
    var rest = text.replace(/^\s*(\d+[.)]|[①②③④⑤⑥⑦⑧⑨])\s*/, "");
    return '<div class="flow anim2"><div class="step"><span class="no">' + esc(no) + '</span><span>' + inlineMd(rest) + '</span></div></div>';
  }
  function chipsHtml(text) {
    var parts = text.split(/\s*[\/·]\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    return '<div class="chips anim2">' + parts.map(function (p) { return '<span class="chip">' + inlineMd(p) + '</span>'; }).join("") + '</div>';
  }

  /* ---------- 가구 ---------- */
  // 로고: 사용자가 업로드한 src가 있고 표시(shown)일 때만 보인다. 기본은 숨김.
  function logo() {
    var L = (window.KBuilder && window.KBuilder.logo) || {};
    var show = !!(L.shown && L.src);
    return '<img class="logo" src="' + (L.src || "assets/kbuilder/logo-worlds.png") + '" alt=""' + (show ? '' : ' style="display:none"') + ' />';
  }
  function pagenum(cur, total) { return ""; } // 페이지 표시 제거 (사용자 요청)
  function brandfoot(meta) { return ""; } // 우측 하단 푸터 제거 (사용자 요청)
  function eyebrow(label) { return '<span class="eyebrow anim"><span class="dot"></span>' + esc(label) + '</span>'; }
  function keybar(key) { return key ? '<div class="keybar anim3"><span class="klab">핵심</span><span>' + inlineMd(key) + '</span></div>' : ""; }
  // 이미지는 절대 잘리지 않도록 항상 contain. fitFrame=true면 프레임이 이미지 비율에 맞춰져
  // 여백(레터박스) 없이 영역을 가득 채운다. (image-slot의 frame="fit" 처리)
  function imgslot(id, placeholder, cls, src, fitFrame) {
    // 시각 제안에 붙은 자동 생성 이미지([이미지:id])·이미지 주소는 칸에 채우고, 설명만 자리 표시로 남긴다
    var v = window.KBuilder.resolveVisual ? window.KBuilder.resolveVisual(placeholder) : { text: placeholder, src: "" };
    src = src || v.src;
    return '<image-slot id="' + esc(id) + '" class="' + cls + '" shape="rounded" radius="36" fit="contain"' +
      (fitFrame ? ' frame="fit"' : '') +
      (src ? ' src="' + esc(src) + '"' : '') + ' placeholder="' + esc(v.text || "이미지를 끌어다 놓기") + '"></image-slot>';
  }

  /* ---------- 영상 칸 ----------
     편성안의 '영상' 칸(학습 탭의 판서 영상·넣은 동영상·움직이는 GIF)을 그린다. 여기서 만드는 글은 저장본에도 그대로 남으므로
     가리키는 값(data-video-ref)과 제목·링크만 담는다. 재생기는 화면에서 붙인다(deck-runtime.js deckVideo). */
  function videoInfo(ref) {
    var source = window.KBuilder.videoSource;
    try { return (source && source.info && source.info(ref)) || null; } catch (e) { return null; }
  }
  function videoBox(v) {
    var meta = videoInfo(v.ref) || {};
    var title = v.title || meta.title || "영상";
    var link = /^https?:\/\//i.test(String(meta.link || "")) ? String(meta.link) : ""; // 링크는 http(s) 주소만
    return '<div class="slide-video" data-video-ref="' + esc(v.ref) + '" data-video-kind="' + esc(meta.kind || "") + '">' +
      '<div class="sv-stage"><div class="sv-card"><span class="sv-icon">▶</span></div></div>' +
      '<div class="sv-cap"><span class="sv-title">' + esc(title) + '</span>' +
      (link ? '<a class="sv-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">' + esc(meta.linkText || "영상 보기") + '</a>' : "") +
      '</div></div>';
  }
  /* 옆 칸: 그림이 있으면 그림, 없고 영상이 있으면 영상 (그림과 영상이 함께 있으면 영상은 paginateDeck 이 뒤 슬라이드로 넘긴다) */
  function sideOf(s, key) {
    if (s.visual) return { html: imgslot(key + "-img-" + s.num, s.visual, "imgslot", "", true), video: false };
    var v = s.videos && s.videos[0];
    return v ? { html: videoBox(v), video: true } : null;
  }
  function colsOpen(side, flip) {
    return '<div class="cols' + (side && side.video ? " has-video" : "") + (side ? (flip ? " flip" : "") : " solo") + '">';
  }
  function colSide(side) { return side ? '<div class="col-side pop">' + side.html + '</div>' : ""; }

  /* ---------- 레이아웃 ---------- */
  /* 표지 문구 — 제목이 길면 첫 덩어리만 제목, 나머지는 부제로(원래 부제는 하단으로). 길이에 따라 제목 글자 크기를 줄인다.
     예전에 만든 긴 표지 제목도 제목·부제로 나뉘어 보이게 한다. PPTX 내보내기도 같은 규칙을 쓴다 */
  function coverParts(title, sub, foot) {
    title = String(title || "").trim(); sub = String(sub || "").trim(); foot = String(foot || "").trim();
    if (title.length > 28) {
      var parts = title.split(/\s+[·—–|-]\s+|\s*:\s+/).filter(Boolean);
      if (parts.length > 1 && parts[0].length >= 4) {
        if (sub && !foot) foot = sub;
        sub = parts.slice(1).join(" · ") + (sub && sub !== foot ? " · " + sub : "");
        title = parts[0];
      }
    }
    return { title: title, sub: sub, foot: foot, size: title.length > 34 ? "xl" : title.length > 18 ? "l" : "" };
  }
  function slideCover(s, meta, key) {
    var pick = function (tag) { var it = s.lines.find(function (l) { return tagOf(l.text).tag === tag; }); return it ? tagOf(it.text).text : ""; };
    var cp = coverParts(pick("title") || meta["주제"] || s.title, pick("subtitle") || meta["부제"] || "", pick("foot"));
    return logo() +
      '<div class="frame cover solo">' +
        '<div class="cover-left">' +
          '<span class="cover-course"><span class="mush">🍄</span> ' + esc(meta["교과목"] || "메이플스토리 월드 코딩 교실") + '</span>' +
          '<h1 class="cover-title anim' + (cp.size ? " t-" + cp.size : "") + '">' + inlineMd(cp.title) + '</h1>' +
          (cp.sub ? '<p class="cover-sub anim2">' + inlineMd(cp.sub) + '</p>' : "") +
          (cp.foot ? '<p class="cover-foot anim2">' + inlineMd(cp.foot) + '</p>' : "") +
        '</div>' +
      '</div>' +
      brandfoot(meta);
  }

  /* 목차 슬라이드 문구 → {heading, items}
     첫 줄(번호 없음)은 제목, 나머지는 항목 — '1. …' 번호 줄뿐 아니라 차시 흐름의 '도입. …'·'전개 1. …' 줄도 항목으로 (PPTX 내보내기도 사용) */
  function tocParts(lines) {
    var heading = "", items = [];
    (lines || []).forEach(function (l) {
      var t = String(tagOf(l.text).text || "").trim();
      if (!t) return;
      if (isStep(t)) items.push(t.replace(/^\s*(?:\d+[.)]|[①②③④⑤⑥⑦⑧⑨])\s*/, ""));
      else if (!heading && !items.length) heading = t;
      else items.push(t.replace(/^(도입|정리|전개\s*\d+)\s*[.:：·]\s*/, "$1 · "));
    });
    return { heading: heading || "오늘의 여정", items: items };
  }
  function slideToc(s, num, total) {
    var tp = tocParts(s.lines), heading = tp.heading, items = tp.items;
    return logo() +
      '<div class="frame">' +
        eyebrow("AGENDA") +
        '<h2 class="slidetitle">' + inlineMd(heading) + '</h2>' +
        '<div class="toc-grid">' + items.map(function (it, i) {
          var c = "var(" + POINTS[i % 4] + ")";
          return '<div class="toc-card pop"><div class="no" style="background:' + c + '">' + (i + 1) + '</div><div class="txt">' + inlineMd(it) + '</div></div>';
        }).join("") + '</div>' +
      '</div>' +
      pagenum(num, total);
  }

  /* ---------- 레이아웃 자동 선택 헬퍼 ---------- */
  function statementInfo(lines) {
    var bigItem = null, rest = [];
    lines.forEach(function (l) {
      var info = tagOf(l.text);
      if (info.tag === "big" && !bigItem) bigItem = info.text;
      else rest.push(tagOf(l.text).text);
    });
    return bigItem ? { big: bigItem, rest: rest } : null;
  }
  function collectCards(lines) {
    var cards = [], cur = null, ok = true;
    lines.forEach(function (l) {
      var info = tagOf(l.text);
      if (info.tag) { ok = false; return; }
      var t = info.text;
      if (l.depth === 0) {
        if (isFlow(t) || isChips(t) || isStep(t)) { ok = false; return; }
        cur = { t: t, b: [] }; cards.push(cur);
      } else if (cur) cur.b.push(t);
    });
    if (!ok || cards.length < 2 || cards.length > 4) return null;
    if (!cards.every(function (c) { return c.t.length <= 22; })) return null;
    return cards;
  }

  function slideStatement(s, num, total, info) {
    var lead = info.rest.join(" ") || s.key || "";
    return logo() +
      '<div class="frame statement">' +
        '<span class="st-kicker anim">' + inlineMd(s.title) + '</span>' +
        '<span class="st-bar anim"></span>' +
        '<h2 class="st-big anim2">' + inlineMd(info.big) + '</h2>' +
        (lead ? '<p class="st-lead anim3">' + inlineMd(lead) + '</p>' : "") +
      '</div>' +
      pagenum(num, total);
  }

  function slideCards(s, num, total, cards) {
    return logo() +
      '<div class="frame">' +
        eyebrow(pad2(s.num)) +
        '<h2 class="slidetitle">' + inlineMd(s.title) + '</h2>' +
        '<div class="card-grid">' + cards.map(function (c, i) {
          var col = "var(" + POINTS[i % 4] + ")";
          return '<div class="ct-card pop"><div class="ct-no" style="background:' + col + '">' + (i + 1) + '</div>' +
            '<div class="ct-t">' + inlineMd(c.t) + '</div>' +
            (c.b.length ? '<p class="ct-b">' + inlineMd(c.b.join(" ")) + '</p>' : "") + '</div>';
        }).join("") + '</div>' +
        keybar(s.key) +
      '</div>' +
      pagenum(num, total);
  }

  function slideContent(s, num, total, key, variant) {
    variant = variant || {};
    var side = sideOf(s, key);
    var body = renderBody(s.lines);
    if (variant.panel && /class="items/.test(body)) body = '<div class="panel">' + body + '</div>';
    return logo() +
      '<div class="frame">' +
        eyebrow(pad2(s.label || s.num)) +
        '<h2 class="slidetitle">' + inlineMd(s.title) + '</h2>' +
        colsOpen(side, variant.flip) +
          '<div class="col-main">' + body + '</div>' +
          colSide(side) +
        '</div>' +
        keybar(s.key) +
      '</div>' +
      pagenum(num, total);
  }

  function slideActivity(s, num, total, key) {
    var side = sideOf(s, key);
    var cleanTitle = s.title.replace(/^\[?활동\]?\s*[:：]?\s*/, "");
    return logo() +
      '<div class="frame">' +
        eyebrow("활동 · " + pad2(s.label || s.num)) +
        '<h2 class="slidetitle">' + inlineMd(cleanTitle) + '</h2>' +
        colsOpen(side, false) +
          '<div class="col-main">' + renderBody(s.lines) + '</div>' +
          colSide(side) +
        '</div>' +
        keybar(s.key) +
      '</div>' +
      pagenum(num, total);
  }

  /* 영상만 있는 슬라이드 — 남은 높이를 영상이 채운다 (제목의 '영상:'은 머리표로 옮긴다) */
  function slideVideo(s, num, total) {
    var v = s.videos && s.videos[0];
    var cleanTitle = s.title.replace(/^(동영상|영상)\s*[:：]\s*/, "");
    return logo() +
      '<div class="frame">' +
        eyebrow(s.bare ? "영상" : "영상 · " + pad2(s.label || s.num)) +
        '<h2 class="slidetitle">' + inlineMd(cleanTitle) + '</h2>' +
        '<div class="video-body">' + (v ? videoBox(v) : "") + '</div>' +
        keybar(s.key) +
      '</div>' +
      pagenum(num, total);
  }

  function slideClosing(s, meta, key) {
    var bigItem = s.lines.find(function (l) { return tagOf(l.text).tag === "big" || tagOf(l.text).tag === "title"; });
    var big = bigItem ? tagOf(bigItem.text).text : (s.key || s.title);
    var lead = s.lines.filter(function (l) { return l !== bigItem; }).map(function (l) { return tagOf(l.text).text; })[0] || s.key || "";
    // 표지처럼 글자만 가운데 — 장식 이미지가 글을 밀어내지 않게
    return logo() +
      '<div class="frame closing solo">' +
        '<div class="closing-right">' +
          '<span class="cover-course"><span class="mush">🍄</span> ' + esc(s.title) + '</span>' +
          '<h2 class="closing-title anim">' + inlineMd(big) + '</h2>' +
          (lead && lead !== big ? '<p class="closing-lead anim2">' + inlineMd(lead) + '</p>' : "") +
        '</div>' +
      '</div>' +
      brandfoot(meta);
  }

  /* ---------- 비교/대조 (label: 내용 묶음 2~4개) ---------- */
  function splitItems(body) {
    return body.split(/\s*[·/、,]\s*|\s{2,}/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function footOf(lines) {
    var f = lines.filter(function (l) { var t = tagOf(l.text).tag; return t === "foot" || t === "cap"; })
      .map(function (l) { return tagOf(l.text).text; })[0];
    return f || "";
  }
  function labeledGroups(lines) {
    var groups = [], others = 0;
    lines.forEach(function (l) {
      if (l.depth > 0) return;
      var info = tagOf(l.text);
      if (info.tag) { if (info.tag === "foot" || info.tag === "cap") return; others++; return; }
      var m = info.text.match(/^([^:：]{1,16})[:：]\s*(.+)$/);
      if (m && !/https?/i.test(m[1])) groups.push({ label: m[1].trim(), body: m[2].trim() });
      else others++;
    });
    if (groups.length >= 2 && groups.length <= 4 && others <= 1 &&
        groups.some(function (g) { return g.body.length > 2; })) return groups;
    return null;
  }
  function slideCompare(s, num, total, groups) {
    var foot = footOf(s.lines);
    var cols = groups.map(function (g, i) {
      var c = "var(" + POINTS[i % 4] + ")";
      var items = splitItems(g.body);
      var body = items.length > 1
        ? '<ul class="cmp-list">' + items.map(function (it) { return '<li>' + inlineMd(it) + '</li>'; }).join("") + '</ul>'
        : '<p class="cmp-one">' + inlineMd(g.body) + '</p>';
      return '<div class="cmp-col pop" style="--c:' + c + '"><div class="cmp-head">' + inlineMd(g.label) + '</div>' + body + '</div>';
    }).join("");
    return logo() +
      '<div class="frame">' +
        eyebrow(pad2(s.num)) +
        '<h2 class="slidetitle">' + inlineMd(s.title) + '</h2>' +
        '<div class="cmp-grid cmp-' + groups.length + '">' + cols + '</div>' +
        (foot ? '<p class="cmp-foot anim3">' + inlineMd(foot) + '</p>' : "") +
        keybar(s.key) +
      '</div>' +
      pagenum(num, total);
  }

  /* ---------- 단계/절차 (번호 목록 3+개, → 없는 경우) ---------- */
  function stepSequence(lines) {
    var steps = [], ok = true;
    lines.forEach(function (l) {
      if (l.depth > 0) return;
      var info = tagOf(l.text);
      if (info.tag) { if (info.tag === "foot" || info.tag === "cap") return; ok = false; return; }
      if (isFlow(info.text)) { ok = false; return; }
      if (isStep(info.text)) steps.push(info.text.replace(/^\s*(\d+[.)]|[①②③④⑤⑥⑦⑧⑨])\s*/, ""));
      else ok = false;
    });
    return (ok && steps.length >= 3) ? steps : null;
  }
  function slideSteps(s, num, total, key, steps) {
    var side = sideOf(s, key);
    var from = s.stepFrom || 0; // (이어서) 슬라이드는 앞 장의 단계 번호를 잇는다
    var list = '<div class="steps-list">' + steps.map(function (t, i) {
      var c = "var(" + POINTS[(from + i) % 4] + ")";
      return '<div class="step-row pop"><span class="step-num" style="background:' + c + '">' + (from + i + 1) + '</span><span class="step-txt">' + inlineMd(t) + '</span></div>';
    }).join("") + '</div>';
    return logo() +
      '<div class="frame">' +
        eyebrow(pad2(s.label || s.num)) +
        '<h2 class="slidetitle">' + inlineMd(s.title) + '</h2>' +
        colsOpen(side, false) +
          '<div class="col-main">' + list + '</div>' +
          colSide(side) +
        '</div>' +
        keybar(s.key) +
      '</div>' +
      pagenum(num, total);
  }

  /* 슬라이드가 쓰는 배치 이름 — 그리기·나누기(paginateDeck)·PPTX 내보내기가 같은 판별을 쓴다 */
  function layoutOf(s) {
    if (s.kind === "cover" || s.kind === "toc" || s.kind === "activity" || s.kind === "closing" || s.kind === "video") return s.kind;
    var st = statementInfo(s.lines);
    if (st && s.lines.length <= 3) return "statement";
    if (labeledGroups(s.lines)) return "compare";   // 비교·대조 / 용어 풀이
    if (collectCards(s.lines)) return "cards";      // 카드 (제목+설명)
    if (stepSequence(s.lines)) return "steps";      // 단계·절차
    return "content";
  }

  function renderSlide(s, meta, num, total, key, accentIdx) {
    var inner, accent = "var(--mush)";
    var point = "var(" + POINTS[accentIdx % 4] + ")";
    switch (layoutOf(s)) {
      case "cover": inner = slideCover(s, meta, key); break;
      case "toc": inner = slideToc(s, num, total); accent = point; break;
      case "activity": accent = point; inner = slideActivity(s, num, total, key); break;
      case "closing": inner = slideClosing(s, meta, key); break;
      case "video": accent = point; inner = slideVideo(s, num, total); break;
      case "statement": accent = point; inner = slideStatement(s, num, total, statementInfo(s.lines)); break;
      case "compare": accent = point; inner = slideCompare(s, num, total, labeledGroups(s.lines)); break;
      case "cards": accent = point; inner = slideCards(s, num, total, collectCards(s.lines)); break;
      case "steps": accent = point; inner = slideSteps(s, num, total, key, stepSequence(s.lines)); break;
      default:
        accent = point;
        inner = slideContent(s, num, total, key, { flip: accentIdx % 2 === 1, panel: accentIdx % 3 === 2 });
    }
    return '<section class="slide kind-' + s.kind + '" data-screen-label="' + esc(s.bare ? "영상" : pad2(s.label || s.num)) + ' ' + esc(s.title) + '" style="--accent:' + accent + '">' + inner + '</section>';
  }
  /* 영상마다 한 장인 영상 슬라이드 HTML — 화면 편집본에 뒤늦게 더할 때 쓴다 (deck-runtime.js deckVideo.offer). 번호 없는 머리표 */
  function videoSlidesHtml(videos, meta) {
    meta = meta || {};
    return (videos || []).map(function (v, i) {
      var s = { num: "v" + (i + 1), bare: true, title: v.title || "영상", maps: "", lines: [], visual: "", videos: [v], key: "", kind: "video" };
      return renderSlide(s, meta, 0, 0, deckKey(meta), i);
    }).join("");
  }

  /* ---------- 넘치는 항목은 다음 슬라이드로 · 영상 놓을 자리 ----------
     그리기 전에 한 번 거른다(순수 함수 — 받은 값은 바꾸지 않는다). PPTX 내보내기도 이 결과를 쓴다.
     1) 글 목록·단계·활동 슬라이드의 항목이 글 칸에 들어가지 않을 만큼 많으면 '(이어서)' 슬라이드로 나눈다.
        들어가는지는 글자 수로 어림한다(1920×1080 기준). 조금 넘치는 것은 화면에서 글 칸을 줄여 맞춘다(deck-runtime.js).
     2) 영상은 옆 칸이 비어 있는 글 슬라이드에만 함께 두고, 그림이 있거나 옆 칸이 없는 배치는 바로 뒤 영상 슬라이드로 넘긴다. */
  var ROOM = {
    frame: 898, eyebrow: 51, titleGap: 40, titleLine: 68.4, titleWidth: 1700, bodyGap: 8,
    keyGap: 28, keyPad: 40, keyLine: 40.3, keyWidth: 1350, body: 1700, sideGap: 64, image: 600, video: 760,
    zoom: 0.8 // 이 배율로도 들어가지 않으면 나눈다 (화면에서는 0.7까지 줄인다)
  };
  function textUnits(text) { // 글자 너비(전각 1, 영문·숫자·빈칸은 약 0.56)
    var t = String(text || "").replace(/\*\*|`/g, ""), n = 0;
    for (var i = 0; i < t.length; i++) n += t.charCodeAt(i) > 0x2E7F ? 1 : 0.56;
    return n;
  }
  function textRows(text, width, font) { return Math.max(1, Math.ceil(textUnits(text) * font / Math.max(width, font))); }
  function bodyRoom(s) {
    var title = ROOM.titleGap + textRows(s.title, ROOM.titleWidth, 60) * ROOM.titleLine;
    var key = s.key ? ROOM.keyGap + ROOM.keyPad + Math.min(3, textRows(s.key, ROOM.keyWidth, 31)) * ROOM.keyLine : 0;
    return ROOM.frame - ROOM.eyebrow - title - ROOM.bodyGap - key;
  }
  /* 글 칸의 높이 어림 — 옆 칸 너비 side, 배율 z. 목록은 가장 높아지는 패널 꾸밈(항목 사이 46px)으로 센다 */
  function bodyHeight(lines, layout, side, z) {
    var width = (ROOM.body - (side ? side + ROOM.sideGap : 0)) / z;
    var h = 34, n = 0;
    lines.forEach(function (l) {
      var t = tagOf(l.text).text;
      if (layout === "steps") {
        if (l.depth > 0) return;
        h += (n++ ? 18 : 0) + textRows(t, width - 146, 31) * 41.85 + 42;
      } else if (l.depth > 0) {
        h += (n++ ? 46 : 52) + textRows(t, width - 224, 25) * 35;
      } else {
        h += (n++ ? 46 : 52) + textRows(t, width - 164, 31) * 43.4;
      }
    });
    return h * z;
  }
  function lineGroups(lines) { // 덧붙임 줄(들여 쓴 줄)은 윗줄과 한 묶음
    var groups = [];
    lines.forEach(function (l) {
      if (l.depth > 0 && groups.length) groups[groups.length - 1].push(l);
      else groups.push([l]);
    });
    return groups;
  }
  function splitLong(s, layout, side) {
    if (layout !== "content" && layout !== "steps" && layout !== "activity") return [s];
    var room = bodyRoom(Object.assign({}, s, { title: s.title + " (이어서)" }));
    var fits = function (lines, first) { return bodyHeight(lines, layout, first ? side : 0, ROOM.zoom) <= room; };
    if (fits(s.lines, true)) return [s];
    var parts = [], cur = [];
    lineGroups(s.lines).forEach(function (g) {
      var next = cur.concat(g);
      if (cur.length && !fits(next, !parts.length)) { parts.push(cur); cur = g.slice(); }
      else cur = next;
    });
    parts.push(cur);
    if (parts.length < 2) return [s];
    // 같은 장 수로 고르게 나눠도 들어가면 그렇게 나눈다 (끝 장에 한 줄만 남지 않게)
    var groups = lineGroups(s.lines), size = Math.ceil(groups.length / parts.length), even = [];
    for (var at = 0; at < groups.length; at += size) even.push(Array.prototype.concat.apply([], groups.slice(at, at + size)));
    if (even.length === parts.length && even.every(function (lines, i) { return fits(lines, i === 0); })) parts = even;
    var steps = 0;
    return parts.map(function (lines, i) {
      var part = Object.assign({}, s, {
        num: i === 0 ? s.num : s.num + "-" + (i + 1), label: s.label || s.num,
        title: i === 0 ? s.title : s.title + " (이어서)",
        lines: lines, visual: i === 0 ? s.visual : "", key: i === parts.length - 1 ? s.key : "", videos: []
      });
      if (layout === "steps") { part.stepFrom = steps; steps += lines.filter(function (l) { return l.depth === 0; }).length; }
      return part;
    });
  }
  function videoSlide(s, v, i) {
    return { num: s.num + "-v" + (i + 1), label: s.label || s.num, title: s.title, maps: s.maps, lines: [], visual: "", videos: [v], key: "", kind: "video" };
  }
  function paginateDeck(parsed) {
    var out = [];
    ((parsed && parsed.slides) || []).forEach(function (s) {
      var videos = s.videos || [];
      var layout = layoutOf(s);
      var texty = layout === "content" || layout === "steps" || layout === "activity";
      var hosted = (layout === "video" || (texty && !s.visual)) ? videos.slice(0, 1) : [];
      var side = s.visual ? ROOM.image : (texty && hosted.length ? ROOM.video : 0);
      var parts = splitLong(s, layout, side);
      parts.forEach(function (part, i) {
        var own = i === 0 ? hosted : [];
        out.push(part === s && own.length === videos.length ? s : Object.assign({}, part, { videos: own }));
      });
      videos.slice(hosted.length).forEach(function (v, i) { out.push(videoSlide(s, v, i)); });
    });
    return Object.assign({}, parsed, { slides: out });
  }

  /* ---------- 애니메이션 순서 (명시적 번호 — 편집해도 뒤바뀌지 않음) ----------
     기존 anim/anim2/.../pop 클래스(특히 pop의 nth-child 딜레이)는 DOM 위치에
     의존해 편집(이동 시 플레이스홀더 삽입, 복제 등)으로 순서가 뒤바뀐다.
     최초 표시 때 클래스 리듬→DOM 순으로 번호(data-anim-order)를 구워 두고,
     이후에는 번호 기반 인라인 animation-delay만 사용한다. 새 객체는 항상
     마지막 번호를 받아 기존 순서를 흔들지 않는다. */
  var ANIM_SEL = ".anim,.anim2,.anim3,.anim4,.pop,[data-anim-order]";
  var ANIM_STEP = 0.09; // 번호 간 딜레이(초) — 기존 anim2(.09s) 리듬 유지
  function animRank(el) {
    var c = el.classList;
    if (!c) return 9;
    if (c.contains("anim")) return 0;
    if (c.contains("anim2") || c.contains("pop")) return 1;
    if (c.contains("anim3")) return 2;
    if (c.contains("anim4")) return 3;
    return 9;
  }
  var animOrder = {
    ensure: function (slide) {
      if (!slide || !slide.querySelectorAll) return;
      var els = Array.prototype.slice.call(slide.querySelectorAll(ANIM_SEL));
      var max = 0, unnumbered = [];
      els.forEach(function (el) {
        var n = parseInt(el.getAttribute && el.getAttribute("data-anim-order"), 10);
        if (n > 0) { if (n > max) max = n; } else unnumbered.push(el);
      });
      if (!unnumbered.length) return;
      unnumbered
        .map(function (el, i) { return { el: el, r: animRank(el), i: i }; })
        .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
        .forEach(function (x) { x.el.setAttribute("data-anim-order", String(++max)); });
    },
    apply: function (slide) {
      if (!slide || !slide.querySelectorAll) return;
      Array.prototype.slice.call(slide.querySelectorAll("[data-anim-order]")).forEach(function (el) {
        var n = parseInt(el.getAttribute("data-anim-order"), 10) || 1;
        if (el.style) el.style.animationDelay = (Math.max(0, n - 1) * ANIM_STEP).toFixed(2) + "s";
      });
    },
    setOrder: function (slide, el, target) {
      if (!slide || !slide.querySelectorAll) return;
      var list = Array.prototype.slice.call(slide.querySelectorAll("[data-anim-order]"))
        .sort(function (a, b) {
          return (parseInt(a.getAttribute("data-anim-order"), 10) || 0) - (parseInt(b.getAttribute("data-anim-order"), 10) || 0);
        });
      var i = list.indexOf(el);
      if (i >= 0) list.splice(i, 1);
      target = Math.max(1, Math.min(list.length + 1, target || 1));
      list.splice(target - 1, 0, el);
      list.forEach(function (x, k) { x.setAttribute("data-anim-order", String(k + 1)); });
      animOrder.apply(slide);
    },
    replay: function (slide) {
      if (!slide || !slide.querySelectorAll) return;
      var els = Array.prototype.slice.call(slide.querySelectorAll("[data-anim-order]"));
      els.forEach(function (el) { if (el.style) el.style.animation = "none"; });
      void (slide.offsetWidth); // 리플로우 강제 → 애니메이션 재시작
      els.forEach(function (el) { if (el.style) el.style.animation = ""; });
      animOrder.apply(slide);   // animation 단축속성 조작이 지운 인라인 딜레이 복구
    },
    ensureAll: function (stageInner) {
      if (!stageInner || !stageInner.querySelectorAll) return;
      Array.prototype.slice.call(stageInner.querySelectorAll(".slide")).forEach(function (s) {
        animOrder.ensure(s); animOrder.apply(s);
      });
    }
  };

  /* ---------- 빌드 + 스테이지 ---------- */
  /* 슬라이드 HTML (화면에 붙이지 않는 순수 조립 — 테스트/QA용) */
  function renderDeckHtml(parsed) {
    var meta = parsed.meta || {};
    var key = deckKey(meta);
    var total = parsed.slides.length;
    var accentIdx = 0;
    return parsed.slides.map(function (s, i) {
      var ai = accentIdx;
      if (s.kind === "content" || s.kind === "activity" || s.kind === "toc") accentIdx++; // 영상 슬라이드는 세지 않는다 (뒤 슬라이드의 색·배치가 바뀌지 않게)
      return renderSlide(s, meta, i + 1, total, key, ai);
    }).join("");
  }
  function buildDeck(parsed, mount) {
    return mountStage(renderDeckHtml(parsed), mount, parsed, deckKey(parsed.meta || {}));
  }

  /* 슬라이드 HTML을 스테이지에 장착 (빌드·불러오기 공용) */
  function mountStage(slidesHtml, mount, parsed, key) {
    var total = (parsed.slides && parsed.slides.length) || "";
    mount.innerHTML =
      '<div class="deck-viewport" tabindex="0">' +
        '<div class="deck-scaler"><div class="deck-stage-inner">' + slidesHtml + '</div></div>' +
        '<button class="deck-nav prev" aria-label="이전">‹</button>' +
        '<button class="deck-nav next" aria-label="다음">›</button>' +
        '<div class="deck-counter"><span class="dc-cur">1</span> / <span class="dc-tot">' + total + '</span></div>' +
      '</div>';

    var viewport = mount.querySelector(".deck-viewport");
    var scaler = mount.querySelector(".deck-scaler");
    var stageInner = mount.querySelector(".deck-stage-inner");
    var idx = 0;
    var curEl = mount.querySelector(".dc-cur");
    var totEl = mount.querySelector(".dc-tot");
    var onShow = null;

    function slidesNow() { return Array.prototype.slice.call(stageInner.querySelectorAll(".slide")); }
    function show(n) {
      var slides = slidesNow();
      idx = Math.max(0, Math.min(slides.length - 1, n));
      slides.forEach(function (sl, i) {
        if (i === idx) { sl.setAttribute("data-deck-active", ""); sl.style.display = "block"; }
        else { sl.removeAttribute("data-deck-active"); sl.style.display = "none"; }
      });
      if (slides[idx]) { animOrder.ensure(slides[idx]); animOrder.apply(slides[idx]); }
      // 보이는 슬라이드: 글이 넘치면 글 칸을 줄이고, 영상 재생기는 이 슬라이드에만 붙인다 (deck-runtime.js)
      var K = window.KBuilder;
      if (slides[idx] && K.deckFit) K.deckFit.slide(slides[idx]);
      if (K.deckVideo) slides.forEach(function (sl, i) { if (i === idx) K.deckVideo.hydrate(sl); else K.deckVideo.release(sl); });
      curEl.textContent = idx + 1;
      totEl.textContent = slides.length;
      if (onShow) onShow(idx, slides);
    }
    var sized = false;
    /* 모든 슬라이드의 글 칸 배율을 다시 잰다 (deck-runtime.js) — 화면에 자리가 잡혔을 때와 글꼴이 다 실렸을 때 */
    function refitAll() { if (window.KBuilder.deckFit && stageInner.isConnected) window.KBuilder.deckFit.all(stageInner); }
    function fit() {
      var vw = viewport.clientWidth, vh = viewport.clientHeight;
      if (vw < 2 || vh < 2) return false;
      scaler.style.transform = "translate(-50%,-50%) scale(" + Math.min(vw / 1920, vh / 1080) + ")";
      if (!sized) { sized = true; refitAll(); } // 감춰진 채 열렸다가 보이게 된 때에도 잰다 (감춰진 동안에는 잴 수 없다)
      return true;
    }
    function fitWhenReady(t) { if (fit() || t <= 0) return; requestAnimationFrame(function () { fitWhenReady(t - 1); }); }

    mount.querySelector(".deck-nav.prev").addEventListener("click", function () { show(idx - 1); });
    mount.querySelector(".deck-nav.next").addEventListener("click", function () { show(idx + 1); });
    viewport.addEventListener("keydown", function (e) {
      if (e.target && e.target.isContentEditable) return;
      if (e.target && /^(VIDEO|IFRAME)$/.test(e.target.tagName || "")) return; // 영상 재생기의 키(빈칸·화살표)는 재생기가 쓴다
      if (viewport.classList.contains("editing")) return; // 편집 모드: 에디터가 키 처리
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { show(idx + 1); e.preventDefault(); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { show(idx - 1); e.preventDefault(); }
    });

    var ro = new ResizeObserver(fit);
    ro.observe(viewport);
    window.addEventListener("resize", fit);
    fitWhenReady(30); show(0);
    // 글꼴이 다 실린 뒤 글 높이가 달라지므로 다시 잰다
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(refitAll);

    var ctrl = {
      goTo: show, refit: function () { fitWhenReady(30); },
      get index() { return idx; },
      get count() { return slidesNow().length; },
      slidesNow: slidesNow, sync: function (n) { show(n == null ? idx : n); },
      stageInner: stageInner, viewport: viewport, mount: mount,
      setOnShow: function (fn) { onShow = fn; },
      destroy: function () { ro.disconnect(); }
    };
    window.KBuilder.lastDeck = { parsed: parsed, key: key, ctrl: ctrl };
    return ctrl;
  }

  window.KBuilder = window.KBuilder || {};
  window.KBuilder.buildDeck = buildDeck;
  window.KBuilder.renderDeckHtml = renderDeckHtml;
  window.KBuilder.paginateDeck = paginateDeck; // 넘치는 항목·영상을 뒤 슬라이드로 넘긴 편성 (studio · PPTX 공용)
  window.KBuilder.slideLayout = layoutOf;
  window.KBuilder.videoSlidesHtml = videoSlidesHtml;
  window.KBuilder.logoHTML = logo; // 로고 상태 기반 <img> (layouts/editor 공용)
  window.KBuilder.animOrder = animOrder; // 애니메이션 순서 (editor/export 공용)
  /* 내용→레이아웃 판별 휴리스틱 공유 — PPTX 내보내기가 화면 렌더와 같은 레이아웃을 쓰게 한다 */
  window.KBuilder.deckHeuristics = {
    tagOf: tagOf, isFlow: isFlow, isChips: isChips, isStep: isStep,
    statementInfo: statementInfo, collectCards: collectCards,
    labeledGroups: labeledGroups, stepSequence: stepSequence,
    footOf: footOf, splitItems: splitItems, coverParts: coverParts, tocParts: tocParts,
    layoutOf: layoutOf, textRows: textRows
  };
  /* 이 슬라이드가 이미지 칸을 그리는지 — renderSlide 의 레이아웃 판별과 같은 순서 (자동 이미지 고르기에 사용) */
  window.KBuilder.slideShowsImage = function (s) {
    if (!s || !s.visual) return false;
    if (s.kind === "activity") return true;
    if (s.kind !== "content") return false;
    var st = statementInfo(s.lines);
    if (st && s.lines.length <= 3) return false;
    return !labeledGroups(s.lines) && !collectCards(s.lines); // 단계·일반 내용 레이아웃만 이미지 칸이 있다
  };
  /* 내보낸 HTML의 슬라이드를 그대로 장착해 이어서 편집 */
  window.KBuilder.mountDeckHtml = function (slidesHtml, mount, meta) {
    var parsed = { meta: meta || {}, slides: [] };
    var ctrl = mountStage(slidesHtml, mount, parsed, deckKey(meta || {}));
    window.KBuilder.lastDeck.imported = true;
    return ctrl;
  };
})();
