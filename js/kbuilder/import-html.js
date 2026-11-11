/* Ported from develocket-slide@3a7303f assets/main.js (내보낸 HTML 불러오기) */
/* import-html.js — 내보낸 슬라이드 HTML 읽기와 저장본 정리 (교안 도우미 · 슬라이드 스튜디오)
   - K.inertRoot(html)              : 스크립트·이미지가 실행되지 않는 문서에 파싱한 루트
   - K.sanitizeDeckHtml(html)       : 실행 요소를 지운 슬라이드 HTML (슬라이드가 없으면 "")
   - K.readEmbeddedSource(json)     : export.js 가 내장한 소스 {doc, deck, source, refs, session} | null
   - K.readExportedHtml(text)       : {html, theme, source} — 지원하지 않는 파일이면 throw */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});
  var UNSUPPORTED = "지원하지 않는 HTML입니다. 슬라이드 스튜디오에서 내보낸 HTML 파일을 선택해 주세요.";
  var LOGO_FALLBACK = "assets/kbuilder/logo-worlds.png";

  function qsa(sel, root) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  /* 스크립트·이미지가 실행되지 않는 문서에 파싱한다 (커스텀 요소도 깨어나지 않음) */
  function inertRoot(html) {
    return new DOMParser().parseFromString('<div id="kb-root">' + html + "</div>", "text/html").getElementById("kb-root");
  }

  function sanitizeDeckHtml(html) {
    var root = inertRoot(html);
    // 슬라이드는 svg·math·style 을 쓰지 않는다 (animate 등으로 href 를 우회하는 경로를 막는다)
    qsa("script,iframe,object,embed,link,meta,base,form,svg,math,style", root).forEach(function (el) { el.remove(); });
    // 영상 재생기(내보낸 파일이 품은 <video>·그림)와 상태 표시는 버린다 — 저장본에는 가리키는 값만 두고 열 때 다시 붙인다 (deck-runtime.js)
    qsa("[data-video-live]", root).forEach(function (el) { el.remove(); });
    qsa("[data-video-state]", root).forEach(function (el) { el.removeAttribute("data-video-state"); });
    qsa("*", root).forEach(function (el) {
      var unsafe = Array.prototype.slice.call(el.attributes).filter(function (a) {
        var name = a.name.toLowerCase();
        if (name.indexOf("on") === 0 || name === "formaction") return true;
        // URL 파서는 스킴 안의 탭·줄바꿈과 앞쪽 제어 문자를 무시하므로 지운 뒤 비교한다
        var url = String(a.value || "").replace(/[\x00-\x20]+/g, "");
        return (name === "href" || name === "src" || name === "xlink:href") && /^javascript:/i.test(url);
      });
      unsafe.forEach(function (a) { el.removeAttribute(a.name); });
    });
    return root.querySelector(".slide") ? root.innerHTML : "";
  }

  function text(value) { return typeof value === "string" ? value : ""; }

  /* 외부 파일에서 온 값이다 — 모양이 다르면 빈 값으로 둔다. 소스가 없는 파일도 슬라이드는 살린다 */
  function readEmbeddedSource(json) {
    var data = null;
    try { data = JSON.parse(json); } catch (e) { return null; }
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return {
      doc: text(data.doc),
      deck: text(data.deck),
      source: text(data.source),
      refs: K.normalizeRefImages ? K.normalizeRefImages(data.refs) : [],
      session: Number.isInteger(data.session) && data.session >= 0 ? data.session : null
    };
  }

  /* 내보낸 파일은 슬라이드마다 로고를 data URL로 품는다. 로고는 브라우저별 설정이라 저장하지 않는다 (studio.js serializeDeck 과 같은 처리) */
  function withoutLogos(html) {
    var root = inertRoot(html);
    qsa(".logo", root).forEach(function (im) { im.setAttribute("src", LOGO_FALLBACK); im.setAttribute("style", "display:none"); });
    return root.innerHTML;
  }

  function readExportedHtml(fileText) {
    var doc = new DOMParser().parseFromString(String(fileText), "text/html");
    var stage = doc.querySelector(".deck-stage-inner");
    var html = stage ? sanitizeDeckHtml(stage.innerHTML) : "";
    if (!html) throw new Error(UNSUPPORTED);
    var embedded = doc.getElementById("kb-source");
    return {
      html: withoutLogos(html),
      theme: stage.classList.contains("theme-dark") ? "dark" : "maple",
      source: embedded ? readEmbeddedSource(embedded.textContent) : null
    };
  }

  K.inertRoot = inertRoot;
  K.sanitizeDeckHtml = sanitizeDeckHtml;
  K.readEmbeddedSource = readEmbeddedSource;
  K.readExportedHtml = readExportedHtml;
})();
