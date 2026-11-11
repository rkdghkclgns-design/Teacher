/* deck-runtime.js — 슬라이드를 화면에 붙인 뒤에 하는 일 (slide-studio.html, render-deck.js 뒤에 싣는다)
   - K.deckFit     : 글이 넘치는 슬라이드의 글 칸을 줄인다 (핵심 띠·제목과 겹치거나 잘리지 않게, 0.7 아래로는 줄이지 않는다)
   - K.deckVideo   : 영상 칸(.slide-video)에 재생기를 붙이고 뗀다 · HTML 내보내기용 재생기
   - K.deckRuntime : 저장본을 만들 때 위 두 가지가 남긴 흔적을 지운다
   영상은 가리키는 값(data-video-ref)으로만 저장한다. 그 값은 K.videoSource {info(ref), blob(ref)} 가 그릴 때 푼다 (studio.js 가 교안 도우미에 묻는다).
   배율 표시(data-fit · --fit)와 재생기([data-video-live])는 실행 중에만 있고 저장본에는 넣지 않는다 — 열 때마다 다시 잰다. */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});
  var esc = function (s) { return K.escapeHtml(s == null ? "" : s); };
  function qsa(sel, root) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  /* ================= 글 칸 줄이기 ================= */
  var FLOOR = 0.7;   // 이보다 작게는 줄이지 않는다 (그보다 많은 글은 paginateDeck 이 다음 슬라이드로 넘긴다)
  var STEP = 0.05;
  /* 줄일 칸: 본문 2단의 글 칸과, 틀에 바로 놓인 카드·비교·목차·표 묶음. 손으로 옮긴 칸(data-abs)은 건드리지 않는다 */
  var FIT_TARGETS = [".cols > .col-main", ".card-grid", ".cmp-grid", ".toc-grid", ".tbl", ".duo"];

  function setFit(el, z) {
    if (z >= 1) { el.style.removeProperty("--fit"); el.removeAttribute("data-fit"); }
    else { el.style.setProperty("--fit", String(z)); el.setAttribute("data-fit", ""); }
  }
  /* els 를 넘치지 않을 때까지 줄인다. measure() 는 넘치는 px (0.5 이하면 들어간 것). 고른 배율을 돌려준다 */
  function fitFrame(els, measure) {
    var z = 1;
    if (!els.length) return z;
    els.forEach(function (el) { setFit(el, 1); });
    while (z > FLOOR + 1e-6 && measure() > 0.5) {
      z = Math.round((z - STEP) * 100) / 100;
      els.forEach(function (el) { setFit(el, z); });
    }
    return z;
  }
  function fitTargets(frame) {
    var sel = FIT_TARGETS.map(function (s) { return ":scope > " + s; }).join(",");
    return qsa(sel, frame).filter(function (el) { return !el.hasAttribute("data-abs"); });
  }
  /* 흐름의 끝이 틀 안쪽 바닥을 얼마나 넘는가 (1920×1080 기준 px).
     등장 애니메이션의 변형이나 화면 배율에 흔들리지 않게, 흐름 끝에 잠깐 둔 빈 요소의 offsetTop 으로 잰다 */
  function overflowOf(frame) {
    var probe = document.createElement("i");
    probe.setAttribute("style", "display:block;flex:0 0 0px;width:0;height:0;margin:0;padding:0;border:0;visibility:hidden");
    frame.appendChild(probe);
    var end = probe.offsetTop;
    frame.removeChild(probe);
    var pad = parseFloat(getComputedStyle(frame).paddingBottom) || 0;
    return end - (frame.clientHeight - pad);
  }
  /* 슬라이드 하나: 재는 동안만 본문이 글 높이만큼 차지하게 하고(css .fit-measure) 넘치면 글 칸을 줄인다. 감춘 슬라이드도 잰다 */
  function fitSlide(slide) {
    var frame = slide && slide.querySelector ? slide.querySelector(".frame") : null;
    if (!frame) return 1;
    var els = fitTargets(frame);
    if (!els.length) return 1;
    var hidden = getComputedStyle(slide).display === "none";
    var shown = slide.style.display;
    if (hidden) slide.style.display = "block";
    frame.classList.add("fit-measure");
    try {
      return fitFrame(els, function () { return overflowOf(frame); });
    } finally { // 재다가 멈춰도 재는 표시와 감춤은 되돌린다
      frame.classList.remove("fit-measure");
      if (hidden) slide.style.display = shown;
    }
  }
  function fitAll(stage) {
    if (!stage || !stage.querySelectorAll) return;
    qsa(".slide", stage).forEach(fitSlide);
  }

  /* ================= 영상 ================= */
  /* 삽입 플레이어는 교안이 허용하는 두 곳의 정해 둔 모양만 (js/lesson-sanitize.js lessonYoutubeEmbed · lessonVimeoEmbed 와 같다) */
  var EMBED = /^https:\/\/(?:www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}(?:\?start=\d{1,6})?|player\.vimeo\.com\/video\/\d{1,12}\?(?:h=[0-9a-fA-F]{6,20}&)?dnt=1)$/;
  var HTTPS = /^https:\/\/[^\s"'<>`\\]+$/; // 바깥 주소 영상은 https 만 (http 내부망 주소를 떠보거나 덱을 열기만 해도 요청이 나가지 않게)
  var PICTURE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
  var GIF = /^data:image\/gif;base64,[A-Za-z0-9+/=]+$/;
  /* 재생·전체 화면·PIP 만 (카메라·마이크·자동 재생은 주지 않는다). 위 창을 옮기지 못하게 sandbox 로 묶는다 */
  var EMBED_ALLOW = "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  var EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox";

  /* 영상 정보 → 재생기 HTML (모두 data-video-live 를 단다). still 이면 인쇄에 찍힐 그림만.
     주소·그림 값은 정해 둔 모양일 때만 쓰고, 아니면 빈 글 — 그러면 제목 칸만 보인다 */
  function liveHtml(meta, title, still) {
    if (!meta || typeof meta !== "object") return "";
    var label = esc(title || "영상");
    if (meta.kind === "gif") {
      return GIF.test(String(meta.src || "")) ? '<img data-video-live src="' + esc(meta.src) + '" alt="' + label + '" />' : "";
    }
    if (meta.kind === "local" || meta.kind === "wb") {
      var poster = PICTURE.test(String(meta.poster || "")) ? String(meta.poster) : "";
      var image = poster ? '<img data-video-live class="sv-poster" src="' + esc(poster) + '" alt="' + label + '" />' : "";
      if (still) return image;
      return image + '<video data-video-live controls playsinline preload="metadata"' + (poster ? ' poster="' + esc(poster) + '"' : "") + ' aria-label="' + label + '"></video>';
    }
    if (still) return "";
    if (meta.kind === "youtube" || meta.kind === "vimeo") {
      if (!EMBED.test(String(meta.embed || ""))) return "";
      return '<iframe data-video-live src="' + esc(meta.embed) + '" title="' + label + '" allow="' + EMBED_ALLOW + '" allowfullscreen loading="lazy"' +
        ' referrerpolicy="strict-origin-when-cross-origin" sandbox="' + EMBED_SANDBOX + '"></iframe>';
    }
    if (meta.kind === "file") {
      // 남의 덱을 열기만 해도 바깥 주소로 요청이 나가지 않게: 재생을 누르기 전에는 받지 않고(preload none), 리퍼러를 보내지 않는다
      if (!HTTPS.test(String(meta.src || ""))) return "";
      return '<video data-video-live controls playsinline preload="none" referrerpolicy="no-referrer" src="' + esc(meta.src) + '" aria-label="' + label + '"></video>';
    }
    return "";
  }

  function videoInfo(ref) {
    try { return (K.videoSource && K.videoSource.info && K.videoSource.info(ref)) || null; } catch (e) { return null; }
  }
  /* 다른 창(교안 도우미)에서 만든 Blob 은 이 창의 instanceof 로 가릴 수 없어 모양으로 본다 */
  function isBlob(value) { return !!value && typeof value.size === "number" && typeof value.slice === "function"; }
  function videoBlob(ref) {
    return Promise.resolve().then(function () {
      return K.videoSource && K.videoSource.blob ? K.videoSource.blob(ref) : null;
    }).then(function (blob) { return isBlob(blob) ? blob : null; }, function () { return null; });
  }
  function blobDataUrl(blob) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { resolve(""); };
      reader.readAsDataURL(blob);
    });
  }
  function titleOf(box) { var t = box.querySelector(".sv-title"); return t ? String(t.textContent || "").trim() : ""; }
  function liveNodes(stage) { return qsa("[data-video-live]", stage); }
  function isPoster(el) { return /(^|\s)sv-poster(\s|$)/.test(el.getAttribute("class") || ""); }
  function append(stage, html) {
    var holder = stage.ownerDocument.createElement("div");
    holder.innerHTML = html;
    while (holder.firstChild) stage.appendChild(holder.firstChild);
  }
  /* 칸에 재생기를 새로 넣는다 → 파일을 기다리는 <video> (없으면 null). 넣을 것이 없으면 '찾지 못함' */
  function mountLive(box, stage, still) {
    liveNodes(stage).forEach(function (el) { el.remove(); });
    var meta = videoInfo(box.getAttribute("data-video-ref") || "");
    var html = liveHtml(meta, titleOf(box), still);
    if (still) { if (html) append(stage, html); return null; }
    if (!html) { box.setAttribute("data-video-state", "missing"); return null; }
    append(stage, html);
    var player = stage.querySelector("video[data-video-live]");
    if (player && !player.getAttribute("src")) return player;
    box.setAttribute("data-video-state", "ready");
    return null;
  }

  /* 보이는 슬라이드의 영상 칸에 재생기를 붙인다. 이미 붙어 있으면(재생 중일 수 있다) 그대로 둔다 */
  function hydrate(slide) {
    if (!slide || !slide.querySelectorAll) return;
    qsa(".slide-video", slide).forEach(function (box) {
      var stage = box.querySelector(".sv-stage");
      if (!stage || liveNodes(stage).some(function (el) { return !isPoster(el); })) return;
      var player = mountLive(box, stage, false);
      if (!player) return;
      box.setAttribute("data-video-state", "loading");
      videoBlob(box.getAttribute("data-video-ref") || "").then(function (blob) {
        if (!player.isConnected) return; // 그사이 다른 슬라이드로 넘어갔다
        if (!blob) { player.remove(); box.setAttribute("data-video-state", "missing"); return; }
        player.src = URL.createObjectURL(blob);
        box.setAttribute("data-video-state", "ready");
      });
    });
  }
  /* 인쇄 전: 모든 영상 칸에 찍힐 그림(판서 영상의 원래 그림·GIF)만 붙인다. 재생기가 이미 있는 칸은 그대로 */
  function hydrateAll(stage) {
    if (!stage || !stage.querySelectorAll) return;
    qsa(".slide-video", stage).forEach(function (box) {
      var inner = box.querySelector(".sv-stage");
      if (inner && !liveNodes(inner).length) mountLive(box, inner, true);
    });
  }
  /* 재생기를 뗀다 (다른 슬라이드로 넘어가면 재생도 멈춘다). 이 창이 만든 재생 주소는 놓는다 */
  function release(root) {
    if (!root || !root.querySelectorAll) return;
    liveNodes(root).forEach(function (el) {
      var src = el.getAttribute("src") || "";
      if (src.indexOf("blob:") === 0) { try { URL.revokeObjectURL(src); } catch (e) { /* 이미 놓은 주소 */ } }
      el.remove();
    });
    qsa("[data-video-state]", root).forEach(function (el) { el.removeAttribute("data-video-state"); });
  }
  /* HTML 내보내기: 사본(root)의 영상 칸을 파일 하나로 열리게 채운다.
     주소 영상은 재생기로, 넣은 파일·판서 영상은 파일 안에(data URL), GIF 는 그림으로. 못 찾은 영상은 제목 칸으로 남긴다 */
  function exportInto(root) {
    return Promise.all(qsa(".slide-video", root).map(function (box) {
      var stage = box.querySelector(".sv-stage");
      if (!stage) return null;
      box.removeAttribute("data-video-state");
      var player = mountLive(box, stage, false);
      if (!player) return null;
      return videoBlob(box.getAttribute("data-video-ref") || "").then(function (blob) { return blob ? blobDataUrl(blob) : ""; }).then(function (url) {
        if (!url) { player.remove(); box.setAttribute("data-video-state", "missing"); return; }
        player.setAttribute("src", url);
        box.setAttribute("data-video-state", "ready");
      });
    }));
  }

  /* 이 덱(stage)에 아직 보인 적 없는 영상(videos [{ref, title}])을 마무리 슬라이드 앞에 영상 슬라이드로 더한다 → 더한 수.
     화면 편집본(저장본)은 편성안으로 다시 그리지 않으므로, 저장한 뒤에 학습 탭에 넣은 영상은 이 길로 들어온다.
     보인 영상은 덱 맨 앞의 표시(.deck-videos 의 data-seen)에 적어 둔다 — 강사가 지운 영상 칸은 다시 넣지 않는다. 영상이 없는 덱은 건드리지 않는다 */
  function offer(stage, videos, meta) {
    var known = Object.create(null), late = [];
    var note = Array.prototype.slice.call(stage.children).filter(function (el) { return /(^|\s)deck-videos(\s|$)/.test(el.getAttribute("class") || ""); })[0] || null;
    (note ? String(note.getAttribute("data-seen") || "").split(/\s+/) : []).forEach(function (ref) { if (ref) known[ref] = 1; });
    qsa("[data-video-ref]", stage).forEach(function (box) { known[box.getAttribute("data-video-ref")] = 1; });
    (Array.isArray(videos) ? videos : []).forEach(function (v) {
      if (!v || !K.parseVideoField || !K.parseVideoField(v.ref) || known[v.ref]) return; // 정해 둔 모양의 값만
      known[v.ref] = 1;
      late.push({ ref: v.ref, title: String(v.title || "") });
    });
    if (late.length) {
      var holder = stage.ownerDocument.createElement("div");
      holder.innerHTML = K.videoSlidesHtml(late, meta || {});
      var slides = qsa(".slide", stage), last = slides[slides.length - 1];
      var closing = last && last.parentNode === stage && /(^|\s)kind-closing(\s|$)/.test(last.getAttribute("class") || "") ? last : null;
      while (holder.firstChild) stage.insertBefore(holder.firstChild, closing);
    }
    var seen = Object.keys(known).filter(Boolean).join(" ");
    if (!seen) return 0;
    if (!note) {
      note = stage.ownerDocument.createElement("i");
      note.setAttribute("class", "deck-videos");
      note.setAttribute("hidden", "");
      stage.insertBefore(note, stage.firstChild);
    }
    if (note.getAttribute("data-seen") !== seen) note.setAttribute("data-seen", seen);
    return late.length;
  }

  /* ================= 저장본 정리 ================= */
  /* 저장하는 글(root)에서 실행 중에만 쓰는 것을 뗀다: 재생기·상태 표시·글 칸 배율. 가리키는 값과 제목·링크는 남긴다 */
  function strip(root) {
    qsa("[data-video-live]", root).forEach(function (el) { el.remove(); });
    qsa("[data-video-state]", root).forEach(function (el) { el.removeAttribute("data-video-state"); });
    qsa("[data-fit]", root).forEach(function (el) {
      var style = (el.getAttribute("style") || "").replace(/(^|;)\s*--fit\s*:[^;]*(;|$)/g, "$1").trim();
      if (style) el.setAttribute("style", style); else el.removeAttribute("style");
      el.removeAttribute("data-fit");
    });
    qsa(".fit-measure", root).forEach(function (el) { el.classList.remove("fit-measure"); });
    return root;
  }

  K.deckFit = { FLOOR: FLOOR, STEP: STEP, frame: fitFrame, slide: fitSlide, all: fitAll };
  K.deckVideo = { liveHtml: liveHtml, hydrate: hydrate, hydrateAll: hydrateAll, release: release, exportInto: exportInto, offer: offer };
  K.deckRuntime = { strip: strip };
})();
