/* Ported from develocket-slide@3a7303f assets/ref-images.js */
/* ref-images.js — 참고 이미지 공용 도구 (교안 도우미 · 슬라이드 스튜디오)
   목록은 차시에 저장한다(mod.refImages = [{name, url}]). 여기에는 변환·검사와 슬롯 삽입 모달만 둔다.
   - K.isRasterImage(url)        : 내보내기가 읽을 수 있는 래스터 data URL인지
   - K.normalizeRefImages(list)  : 검사를 통과한 [{name, url}] (최대 K.REF_IMAGE_MAX장)
   - K.refDownscale(file)        : Promise<dataURL>
   - K.pickRefImage()            : Promise<url|null> (슬롯 삽입 모달, 목록은 K.getRefImages()) */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});
  var MAX = 24;       // 과도한 메모리·내보내기 용량 방지
  var MAX_DIM = 1400;
  var NAME_CHARS = 80;
  /* ZIP·PDF 내보내기가 /^data:(image\/\w+);base64,/ 로 읽는다 — svg+xml 은 여기서 걸러진다 */
  var RASTER = /^data:image\/\w+;base64,/;

  function isRasterImage(url) { return typeof url === "string" && RASTER.test(url); }

  function normalizeRefImages(list) {
    var valid = (Array.isArray(list) ? list : []).filter(function (ref) { return ref && isRasterImage(ref.url); });
    return valid.slice(0, MAX).map(function (ref, i) {
      return { name: String(ref.name || "").slice(0, NAME_CHARS) || "이미지 " + (i + 1), url: ref.url };
    });
  }

  /* 다운스케일 → webp dataURL (실패 시 원본 dataURL 폴백) */
  function downscale(file) {
    return new Promise(function (resolve, reject) {
      if (!file || String(file.type).indexOf("image/") !== 0) { reject(new Error("이미지 파일이 아닙니다.")); return; }
      var rawRead = function () {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result)); };
        fr.onerror = function () { reject(new Error("이미지를 읽지 못했습니다.")); };
        fr.readAsDataURL(file);
      };
      // GIF는 재인코딩 시 애니메이션이 사라지므로 원본 유지
      if (typeof createImageBitmap !== "function" || file.type === "image/gif") { rawRead(); return; }
      createImageBitmap(file).then(function (bm) {
        try {
          var scale = Math.min(1, MAX_DIM / Math.max(bm.width, bm.height));
          var w = Math.max(1, Math.round(bm.width * scale));
          var h = Math.max(1, Math.round(bm.height * scale));
          var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(bm, 0, 0, w, h);
          if (bm.close) bm.close();
          resolve(cv.toDataURL("image/webp", 0.85));
        } catch (e) { rawRead(); }
      }, rawRead);
    });
  }

  /* ---------- 슬롯 삽입 피커 모달 ---------- */
  function pickRefImage() {
    return new Promise(function (resolve) {
      var refs = K.getRefImages ? K.getRefImages() : [];
      if (!refs.length) { alert("먼저 교수안 화면의 ‘참고 이미지’에 이미지를 추가해 주세요."); resolve(null); return; }
      var ov = document.createElement("div");
      ov.className = "ref-pick-ov";
      var box = document.createElement("div");
      box.className = "ref-pick-box";
      box.innerHTML = '<div class="ref-pick-head"><span>참고 이미지 선택</span>' +
        '<button class="ref-pick-x" type="button" title="닫기">×</button></div>';
      var grid = document.createElement("div");
      grid.className = "ref-pick-grid";
      var done = false;
      function cleanup() { if (done) return; done = true; document.removeEventListener("keydown", onKey, true); if (ov.parentNode) ov.parentNode.removeChild(ov); }
      function onKey(e) { if (e.key === "Escape") { cleanup(); resolve(null); } }
      refs.forEach(function (r) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "ref-pick-item"; b.title = r.name;
        var im = document.createElement("img"); im.src = r.url; im.alt = r.name;
        b.appendChild(im);
        b.addEventListener("click", function () { cleanup(); resolve(r.url); });
        grid.appendChild(b);
      });
      box.appendChild(grid);
      ov.appendChild(box);
      ov.addEventListener("click", function (e) { if (e.target === ov) { cleanup(); resolve(null); } });
      box.querySelector(".ref-pick-x").addEventListener("click", function () { cleanup(); resolve(null); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(ov);
    });
  }

  K.REF_IMAGE_MAX = MAX;
  K.isRasterImage = isRasterImage;
  K.normalizeRefImages = normalizeRefImages;
  K.refDownscale = downscale;
  K.pickRefImage = pickRefImage;
})();
