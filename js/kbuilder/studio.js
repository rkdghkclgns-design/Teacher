/* studio.js — boot script for slide-studio.html: the ported KBuilder deck pane, wired to the parent page.
   Parent contract (window.parent): getSlideStudioPayload(moduleId, session) · saveSlideStudioHtml(moduleId, html, {rev, session}) ·
   importGyosuanHtml · getSlideStudioSample · generateImageAPI · callGemini · extractText · TEXT_MODEL.
   주소: ?module=id (전체 덱) · &session=n (한 차시) · ?sample=1 (저장하지 않는 샘플)
   Ported from develocket-slide@3a7303f: logo/theme/mount wiring and html import from assets/main.js, pdf from assets/print.js. */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});

  var SAVE_DELAY_MS = 800;
  var MAX_FAILS_IN_ROW = 2;           // auto-images.run 과 같은 기준: 키·할당량 문제로 연달아 실패하면 멈춘다
  var PROGRESS_LINGER_MS = 5000;
  var DEFAULT_SLOT_TEXT = "이미지를 끌어다 놓기";
  var LOGO_FALLBACK = "assets/kbuilder/logo-worlds.png";
  var NO_IMAGE_AI_MSG = "AI 이미지 생성을 사용할 수 없습니다. 교안 도우미 설정을 확인해 주세요.";
  var NO_TEXT_AI_MSG = "AI 텍스트 생성을 사용할 수 없습니다. 교안 도우미 설정을 확인해 주세요.";
  /* image-slot 이 실행 중에만 쓰는 속성 — 저장본에 남기지 않는다 */
  var SLOT_RUNTIME_ATTRS = ["data-filled", "data-editable", "data-over", "data-loading", "data-reframe", "data-panning"];
  var SLIDE_POINT_SEL = ".col-main li, .flow .step, .chip, .lead, .step-txt, .ct-t, .cmp-head, .keybar span:last-child";

  var params = new URLSearchParams(location.search);
  var moduleId = params.get("module");
  var isSample = params.get("sample") === "1";
  var session = params.has("session") ? Number(params.get("session")) : null;
  var deckRev = 0;
  var ctrl = null;
  var lastSaved = null;
  var saveTimer = null;
  var fillRun = null;
  var progressTimer = null;
  var saveChannel = null;
  var staleDeck = false;

  function $(id) { return document.getElementById(id); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, val) {
    try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, val); }
    catch (e) { /* 용량 초과 등은 세션 메모리로만 유지 */ }
  }

  /* ---------- 부모 페이지 ---------- */
  function parentFn(name) {
    try {
      var p = window.parent;
      return p && p !== window && typeof p[name] === "function" ? p[name].bind(p) : null;
    } catch (e) { return null; } // 교차 출처 부모
  }
  /* js/data.js 의 `let TEXT_MODEL` 은 window 속성이 아니므로 parent.TEXT_MODEL 은 undefined — 부모 전역 스코프에서 읽는다 */
  function textModel() {
    var p = window.parent;
    if (p.TEXT_MODEL) return p.TEXT_MODEL;
    try { return new p.Function("return typeof TEXT_MODEL === 'undefined' ? '' : TEXT_MODEL")(); }
    catch (e) { return ""; }
  }
  function textReady() { return !!(parentFn("callGemini") && parentFn("extractText")); }
  function imageReady() { return !!parentFn("generateImageAPI"); }

  /* ---------- KBuilder.ai 대체 (ai-client.js · ai-config.js 없음 — 키는 부모가 관리) ---------- */
  function callText(prompt, opts) {
    if (!textReady()) return Promise.reject(new Error(NO_TEXT_AI_MSG));
    var parts = [{ text: String(prompt) }].concat(((opts && opts.images) || []).map(function (im) {
      return { inlineData: { mimeType: im.mime, data: im.data } };
    }));
    return Promise.resolve().then(function () {
      var model = textModel();
      if (!model) throw new Error(NO_TEXT_AI_MSG);
      return parentFn("callGemini")(model, { contents: [{ role: "user", parts: parts }], taskRole: opts && opts.role });
    }).then(function (data) { return parentFn("extractText")(data); });
  }
  /* generateImageAPI 는 실패하면 null 을 돌려주지만, 복사한 코드는 실패를 reject 로 받는다 */
  function genImage(prompt) {
    if (!imageReady()) return Promise.reject(new Error(NO_IMAGE_AI_MSG));
    return Promise.resolve().then(function () { return parentFn("generateImageAPI")(prompt); }).then(function (url) {
      if (!url) throw new Error("이미지를 만들지 못했습니다.");
      return url;
    });
  }
  K.ai = {
    call: callText,
    genImage: genImage,
    available: function (role) { return role === "image" ? imageReady() : textReady(); }
  };
  K.genImage = genImage;
  K.AI = { hasKey: imageReady }; // auto-images.available() 가 보는 관문

  /* ---------- 안내 · 상태 ---------- */
  function showNotice(msg) {
    $("app").style.display = "none";
    var box = $("studio-notice");
    box.textContent = msg;
    box.hidden = false;
  }
  function setStatus(text, isError) {
    var el = $("studio-status");
    el.textContent = text;
    el.classList.toggle("error", !!isError);
  }

  /* ---------- 저장 ---------- */
  function liveSlotSrc(slot) {
    if (!slot) return "";
    return (slot._img && slot._img.src && slot._img.src.indexOf("data:") === 0) ? slot._img.src : (slot.getAttribute("src") || "");
  }
  /* 지금 덱을 저장용 HTML 로 — 끌어다 놓은 이미지는 innerHTML 에 없으므로 src 로 굽고, 편집·탐색 흔적은 지운다 */
  function serializeDeck() {
    var root = K.inertRoot(ctrl.stageInner.innerHTML);
    qsa("image-slot", root).forEach(function (slot) {
      var src = liveSlotSrc(slot.id ? $(slot.id) : null);
      if (src) slot.setAttribute("src", src);
      SLOT_RUNTIME_ATTRS.forEach(function (attr) { slot.removeAttribute(attr); });
    });
    qsa(".rs-handle,.marquee,.align-guide", root).forEach(function (el) { el.remove(); });
    qsa(".sel-elem", root).forEach(function (el) { el.classList.remove("sel-elem"); });
    qsa("[contenteditable]", root).forEach(function (el) { el.removeAttribute("contenteditable"); });
    // 로고는 테마처럼 브라우저별 설정(applyLogo 가 다시 입힘) — 슬라이드마다 data URL 을 저장하지 않는다
    qsa(".logo", root).forEach(function (im) { im.setAttribute("src", LOGO_FALLBACK); im.setAttribute("style", "display:none"); });
    qsa(".slide", root).forEach(function (slide) {
      slide.removeAttribute("data-deck-active");
      slide.style.removeProperty("display");
    });
    return root.innerHTML;
  }
  function saveFailed(err) {
    lastSaved = null; // 다음 변경 때 다시 시도
    console.error("[slide-studio] save failed:", err);
    setStatus("저장하지 못했습니다", true);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (staleDeck || isSample) return; // 다른 창의 저장본을 낡은 덱으로 덮어쓰지 않는다
    var html = serializeDeck();
    if (html === lastSaved) return;
    var save = parentFn("saveSlideStudioHtml");
    if (!save) { saveFailed(new Error("saveSlideStudioHtml 없음")); return; }
    var result;
    try { result = save(moduleId, html, { rev: deckRev, session: session }); }
    catch (err) { saveFailed(err); return; }
    if (result === false) { // 덱을 다시 만들었다 — 이 창은 이전 덱이다
      staleDeck = true;
      setStatus("슬라이드를 다시 만들어 이 화면은 저장하지 않습니다. 다시 열어 주세요", true);
      return;
    }
    lastSaved = html;
    setStatus("저장됨");
    if (saveChannel) saveChannel.postMessage("saved");
    Promise.resolve(result).catch(saveFailed);
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
  }
  function watchEdits() {
    new MutationObserver(scheduleSave).observe(ctrl.stageInner, { subtree: true, childList: true, attributes: true, characterData: true });
    // 부모가 iframe 을 닫아도 대기 중인 저장을 잃지 않게 한다
    window.addEventListener("pagehide", function () { if (saveTimer) flushSave(); });
  }
  /* 같은 모듈을 인라인과 오버레이로 함께 열 수 있다 — 다른 창이 저장하면 이 덱은 낡았으므로, 다시 볼 때 새로 불러온다 */
  function watchOtherInstances() {
    if (typeof BroadcastChannel !== "function" || isSample) return;
    saveChannel = new BroadcastChannel("slide-studio:" + moduleId + (session === null ? "" : ":" + session));
    saveChannel.onmessage = function () { staleDeck = true; };
    window.addEventListener("focus", function () { if (staleDeck && !fillRun) location.reload(); });
  }

  /* ---------- 테마 · 로고 (main.js) ---------- */
  function applyTheme(theme) {
    lsSet("kb-theme", theme);
    $("theme-sel").value = theme;
    [document.querySelector("#deck-mount .deck-stage-inner"), $("deck-rail")].forEach(function (el) {
      if (el) el.classList.toggle("theme-dark", theme === "dark");
    });
  }
  K.logo = { src: lsGet("kb-logo-src") || "", shown: lsGet("kb-logo-shown") === "1" };
  K.applyLogo = function () {
    var show = !!(K.logo.shown && K.logo.src);
    qsa("#deck-mount .logo, #deck-rail .logo").forEach(function (im) {
      im.src = K.logo.src || LOGO_FALLBACK;
      im.style.display = show ? "" : "none";
    });
  };
  function persistLogo() {
    lsSet("kb-logo-src", K.logo.src || null);
    lsSet("kb-logo-shown", K.logo.shown ? "1" : "0");
  }
  function buildLogoControl() {
    var btn = $("btn-logo");
    var pop = document.createElement("div");
    pop.className = "logo-pop";
    pop.innerHTML =
      '<div class="lg-row"><div class="lg-prev" id="lg-prev">로고 없음</div></div>' +
      '<button class="lg-btn" id="lg-up">📂 로고 이미지 업로드</button>' +
      '<label class="lg-toggle"><input type="checkbox" id="lg-show" /> 슬라이드에 로고 표시</label>' +
      '<button class="lg-btn lg-danger" id="lg-rm">🗑 로고 제거</button>' +
      '<p class="lg-hint">우측 상단에 표시됩니다. 투명 PNG 권장.</p>';
    document.body.appendChild(pop);
    var fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.hidden = true;
    document.body.appendChild(fileInput);
    var prev = pop.querySelector("#lg-prev");
    var chk = pop.querySelector("#lg-show");
    function syncPop() {
      chk.checked = !!(K.logo.shown && K.logo.src);
      chk.disabled = !K.logo.src;
      prev.innerHTML = K.logo.src ? '<img src="' + K.escapeHtml(K.logo.src) + '" alt="logo" />' : "로고 없음";
    }
    function openPop() {
      var r = btn.getBoundingClientRect();
      pop.style.top = (r.bottom + 8) + "px";
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 280)) + "px";
      syncPop();
      pop.classList.add("open");
    }
    function closePop() { pop.classList.remove("open"); }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (pop.classList.contains("open")) closePop(); else openPop();
    });
    document.addEventListener("click", function (e) {
      if (pop.classList.contains("open") && !pop.contains(e.target) && e.target !== btn) closePop();
    });
    pop.querySelector("#lg-up").addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        K.logo.src = String(fr.result); K.logo.shown = true;
        persistLogo(); K.applyLogo(); syncPop();
      };
      fr.readAsDataURL(f);
      fileInput.value = "";
    });
    chk.addEventListener("change", function () { K.logo.shown = chk.checked; persistLogo(); K.applyLogo(); });
    pop.querySelector("#lg-rm").addEventListener("click", function () {
      K.logo.src = ""; K.logo.shown = false;
      persistLogo(); K.applyLogo(); syncPop();
    });
  }

  /* ---------- 빈 이미지 칸 AI 채우기 (auto-images 와 같은 프롬프트·순차 생성, 슬라이드는 지금 화면 기준) ---------- */
  function slidePoints(slide) {
    return qsa(SLIDE_POINT_SEL, slide).map(function (el) {
      return el.textContent.replace(/^✓\s*/, "").trim();
    }).filter(Boolean).slice(0, 5);
  }
  function slotJob(slot) {
    var ctx = slot._promptContext();
    var generic = ctx.visual === DEFAULT_SLOT_TEXT || K.autoImages.GENERIC.test(ctx.visual);
    return {
      id: slot.id,
      title: ctx.title,
      prompt: K.recommendImagePrompt({
        visual: generic ? "" : ctx.visual, title: ctx.title, subject: ctx.subject, points: slidePoints(slot.closest(".slide"))
      })
    };
  }
  function showProgress(done, total, label) {
    clearTimeout(progressTimer);
    $("studio-progress").hidden = false;
    $("studio-progress-label").textContent = label;
    $("studio-progress-bar").style.width = Math.round((done / Math.max(total, 1)) * 100) + "%";
  }
  function fillOne(run, job, i, total) {
    var slot = $(job.id);
    // 기다리는 사이 지웠거나 채운 칸에는 비용을 쓰지 않는다
    if (run.stop || !slot || liveSlotSrc(slot) || slot.hasAttribute("data-loading")) return Promise.resolve();
    showProgress(i, total, "🖼 이미지 생성 중… (" + (i + 1) + "/" + total + ") " + job.title);
    slot.setAttribute("data-loading", "");
    return K.autoImages.genOne(job.prompt, job.title, false).then(function (id) {
      var live = $(job.id); // 생성 중에 실행취소·삭제했을 수 있으니 다시 찾는다
      if (live && !liveSlotSrc(live)) {
        live.setAttribute("src", K.autoImages.url(id));
        run.made++;
      }
      run.inRow = 0;
    }).catch(function (err) {
      console.error("[slide-studio] image fill failed:", err);
      run.failed++;
      run.inRow++;
      if (run.inRow >= MAX_FAILS_IN_ROW) { run.stop = true; run.gaveUp = true; }
    }).then(function () {
      var cur = $(job.id);
      if (cur) cur.removeAttribute("data-loading");
      K.editor.buildRail();
    });
  }
  function fillSummary(run) {
    var head = run.made || !run.failed ? "🖼 이미지 " + run.made + "장 완료" : "🖼 이미지를 만들지 못했습니다";
    var failed = run.failed ? " (실패 " + run.failed + "장)" : "";
    var tail = run.gaveUp ? " 연달아 실패해 남은 이미지는 건너뛰었습니다." : run.stop ? " 남은 이미지는 건너뛰었습니다." : "";
    return head + failed + "." + tail;
  }
  function finishFill(run, total) {
    fillRun = null;
    $("btn-fill-images").disabled = false;
    $("btn-fill-stop").hidden = true;
    showProgress(total, total, fillSummary(run));
    progressTimer = setTimeout(function () { $("studio-progress").hidden = true; }, PROGRESS_LINGER_MS);
  }
  function fillEmptySlots() {
    if (fillRun) return;
    if (!K.autoImages.available()) { alert(NO_IMAGE_AI_MSG); return; }
    var empty = qsa("image-slot", ctrl.stageInner).filter(function (slot) { return slot.id && !liveSlotSrc(slot); });
    if (!empty.length) { alert("빈 이미지 칸이 없습니다."); return; }
    if (!confirm("빈 이미지 칸 " + empty.length + "개를 AI 이미지로 채울까요?\n이미지마다 생성 비용이 듭니다.")) return;

    var jobs = empty.map(slotJob);
    var run = { made: 0, failed: 0, inRow: 0, stop: false, gaveUp: false };
    fillRun = run;
    K.editor.snapshot(); // Ctrl+Z 로 한 번에 되돌린다
    $("btn-fill-images").disabled = true;
    $("btn-fill-stop").hidden = false;
    $("btn-fill-stop").disabled = false;
    showProgress(0, jobs.length, "🖼 이미지 생성 준비 중…");

    var chain = K.autoImages.ready;
    jobs.forEach(function (job, i) {
      chain = chain.then(function () { return fillOne(run, job, i, jobs.length); });
    });
    chain.then(function () { finishFill(run, jobs.length); });
  }

  /* ---------- PDF (print.js) — 슬라이드 한 장을 16:9 한 페이지로. 페이지 크기·대상은 slide-studio.html 에 고정했다 ---------- */
  function printDeck() {
    K.editor.setEdit(false);
    window.print();
  }

  /* ---------- 내보낸 HTML 불러오기 — 저장은 부모가 맡고, 이 창은 저장본으로 다시 연다 ---------- */
  function importHtmlFile(file) {
    var restore = parentFn("importGyosuanHtml");
    if (!file || !restore) return;
    var reader = new FileReader();
    reader.onerror = function () { alert("파일을 읽지 못했습니다."); };
    reader.onload = function () {
      Promise.resolve(restore(moduleId, String(reader.result), session)).then(function (result) {
        if (result && result.error) alert(result.error);
        if (!result || !result.ok) return;
        staleDeck = true; // 지금 덱을 저장본 위에 다시 쓰지 않는다
        location.reload();
      }).catch(function (err) {
        console.error("[slide-studio] import failed:", err);
        alert("HTML을 불러오지 못했습니다.");
      });
    };
    reader.readAsText(file, "utf-8");
  }

  /* ---------- 내보내기에 내장할 소스 · 슬롯 피커 목록 (지금 값을 부모에서 읽는다) ---------- */
  function currentPayload() {
    var get = parentFn("getSlideStudioPayload");
    return get && moduleId ? get(moduleId, session) : null;
  }
  K.getRefImages = function () {
    var payload = currentPayload();
    return (payload && payload.refs) || [];
  };
  K.getSource = function () {
    var payload = currentPayload();
    if (!payload) return null;
    return { doc: payload.docMd || "", deck: payload.deckMd || "", source: "", refs: payload.refs || [], session: payload.session };
  };

  /* ---------- 차시 선택 — 한 차시를 따로 연 덱. 저장도 차시별로 한다 ---------- */
  function addSessionOption(sel, value, label) {
    var option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    sel.appendChild(option);
  }
  function buildSessionPicker(sessions) {
    var sel = $("session-sel");
    if (!sessions || sessions.length < 2) return;
    addSessionOption(sel, "", "전체 슬라이드");
    sessions.forEach(function (item) { addSessionOption(sel, String(item.index), (item.index + 1) + "차시. " + item.title); });
    sel.value = session === null ? "" : String(session);
    sel.hidden = false;
  }
  function openSession(value) {
    var query = new URLSearchParams(location.search);
    if (value === "") query.delete("session"); else query.set("session", value);
    location.search = query.toString(); // 대기 중인 저장은 pagehide 에서 내보낸다
  }

  /* ---------- 시작 ---------- */
  function wireControls() {
    $("btn-edit").addEventListener("click", function () { K.editor.setEdit(!K.editor.isEditing()); });
    $("btn-html").addEventListener("click", function () { K.exportHTML(); });
    $("btn-pptx").addEventListener("click", function () { K.exportPPTX(); });
    $("btn-pdf").addEventListener("click", printDeck);
    $("btn-import-html").addEventListener("click", function () { $("file-import-html").click(); });
    $("file-import-html").addEventListener("change", function () {
      importHtmlFile(this.files && this.files[0]);
      this.value = "";
    });
    $("session-sel").addEventListener("change", function () { openSession(this.value); });
    $("btn-dup-slide").addEventListener("click", function () { K.editor.dupSlide(); });
    $("btn-add-slide").addEventListener("click", function () { K.editor.addSlide(); });
    $("btn-del-slide").addEventListener("click", function () { K.editor.delSlide(); });
    $("theme-sel").addEventListener("change", function () { applyTheme(this.value); });
    $("btn-fill-images").addEventListener("click", fillEmptySlots);
    $("btn-fill-stop").addEventListener("click", function () {
      if (!fillRun) return;
      fillRun.stop = true;
      this.disabled = true;
      $("studio-progress-label").textContent = "이번 이미지까지만 넣고 멈춥니다…";
    });
    buildLogoControl();
  }
  /* 제목·교과목이 편성안에 없으면 부모가 준 값으로 채운다 — 슬롯 id 가 달라지지 않게 빌드와 복원이 같은 meta 를 쓴다 */
  function deckMeta(meta, payload) {
    return Object.assign({}, meta, {
      "주제": meta["주제"] || payload.title || "",
      "교과목": meta["교과목"] || payload.subject || ""
    });
  }
  function start(payload) {
    session = payload.session === undefined ? null : payload.session;
    deckRev = payload.rev || 0;
    K.exportFileBase = payload.fileBase || "";
    buildSessionPicker(payload.sessions);
    if (isSample) { $("btn-import-html").hidden = true; $("btn-fill-images").hidden = true; }
    var parsed = K.parseDeck(String(payload.deckMd || ""));
    var meta = deckMeta(parsed.meta || {}, payload);
    var deck = Object.assign({}, parsed, { meta: meta });
    var saved = payload.deckHtml ? K.sanitizeDeckHtml(String(payload.deckHtml)) : "";
    if (!saved && !deck.slides.length) { showNotice("표시할 슬라이드가 없습니다. 교안 도우미에서 슬라이드를 먼저 만들어 주세요."); return; }

    var mount = $("deck-mount");
    if (saved) {
      ctrl = K.mountDeckHtml(saved, mount, meta);
      if (deck.slides.length) {
        // 저장본을 되살려도 PPTX 는 MD 기준이다 (main.js convert 와 동일)
        K.lastDeck.parsed = deck;
        K.lastDeck.imported = false;
      }
    } else {
      ctrl = K.buildDeck(deck, mount);
    }
    K.editor.init(ctrl);
    applyTheme(lsGet("kb-theme") || "maple");
    K.animOrder.ensureAll(ctrl.stageInner); // 슬라이드를 넘기는 것만으로 저장본이 달라지지 않게 미리 굽는다
    lastSaved = serializeDeck();
    watchEdits();
    watchOtherInstances();
    $("studio-title").textContent = "🎬 " + (meta["주제"] || "슬라이드");
    ctrl.refit();
    requestAnimationFrame(function () { ctrl.viewport.focus(); });
  }
  function boot() {
    var getPayload = parentFn(isSample ? "getSlideStudioSample" : "getSlideStudioPayload");
    if (!getPayload || !parentFn("saveSlideStudioHtml")) { showNotice("이 페이지는 교안 도우미 안에서 열어 주세요."); return; }
    if (!moduleId && !isSample) { showNotice("열 모듈을 찾지 못했습니다. 교안 도우미에서 다시 열어 주세요."); return; }
    wireControls();
    Promise.resolve().then(function () { return getPayload(moduleId, session); }).then(function (payload) {
      if (!payload) { showNotice("이 모듈의 슬라이드를 찾지 못했습니다."); return; }
      start(payload);
    }).catch(function (err) {
      console.error("[slide-studio] boot failed:", err);
      showNotice("슬라이드를 불러오지 못했습니다. 다시 열어 주세요.");
    });
  }
  boot();
})();
