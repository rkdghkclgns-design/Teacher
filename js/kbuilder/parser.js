/* parser.js — 교수안/슬라이드 편성안 마크다운 파서
   범용: 같은 구조의 어떤 MD든 파싱한다.
   전역으로 window.KBuilder.parse* 함수를 노출한다. */
(function () {
  "use strict";

  /* ---------- 공통: 프론트매터 ---------- */
  function splitFrontmatter(src) {
    var meta = {};
    var body = src;
    var m = src.match(/^\uFEFF?---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (m) {
      var block = m[1];
      block.split(/\n/).forEach(function (line) {
        var kv = line.match(/^\s*([^:]+):\s*(.*)$/);
        if (kv) meta[kv[1].trim()] = kv[2].trim();
      });
      body = src.slice(m[0].length);
    }
    return { meta: meta, body: body };
  }

  /* ---------- 들여쓰기 깊이 ---------- */
  function indentDepth(raw) {
    var n = 0;
    for (var i = 0; i < raw.length; i++) {
      if (raw[i] === " ") n += 1;
      else if (raw[i] === "\t") n += 4;
      else break;
    }
    return Math.floor(n / 2); // 2 spaces = 1 level
  }

  /* =====================================================
     슬라이드 편성안 파서
     ===================================================== */
  function parseDeck(src) {
    var fm = splitFrontmatter(src);
    var lines = fm.body.replace(/\r\n/g, "\n").split("\n");

    var slides = [];
    var notes = []; // 비고
    var cur = null; // 현재 슬라이드
    var curField = null; // 현재 수집 중인 필드 ("문구" 등)
    var inDeckSection = false;
    var inNotes = false;

    function flush() {
      // 문구·그림 없이 영상만 있는 슬라이드는 영상 슬라이드다 (제목에 '정리'·'활동'이 들어 있어도)
      if (cur && cur.videos.length && !cur.lines.length && !cur.visual) cur.kind = "video";
      if (cur) slides.push(cur);
      cur = null;
      curField = null;
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var line = raw.trim();
      if (line === "") continue;

      // 섹션 헤더 (## )
      var h2 = raw.match(/^##\s+(.*)$/);
      if (h2) {
        flush();
        var t = h2[1].trim();
        inDeckSection = /슬라이드\s*편성/.test(t) || /편성/.test(t);
        inNotes = /비고|참고|메모/.test(t);
        if (inNotes) inDeckSection = false;
        continue;
      }

      // 비고 수집
      if (inNotes) {
        var nb = line.match(/^[-*]\s+(.*)$/);
        if (nb) notes.push(nb[1].trim());
        continue;
      }

      // 슬라이드 헤더 (### 슬라이드 N - 제목)
      var h3 = raw.match(/^###\s+(.*)$/);
      if (h3) {
        flush();
        var head = h3[1].trim();
        var sm = head.match(/^슬라이드\s*([0-9]+(?:-[0-9]+)?)\s*[-–—:]\s*(.*)$/);
        var num = sm ? sm[1] : String(slides.length + 1);
        var title = sm ? sm[2].trim() : head;
        cur = {
          num: num,
          title: title,
          maps: "",
          lines: [],   // 슬라이드 문구 items {text, depth}
          visual: "",  // 이미지/시각
          videos: [],  // 영상 {ref, title} — 영상 값이 아니라 가리키는 값만 (그릴 때 푼다)
          key: "",     // 핵심 메시지
          kind: classify(title)
        };
        curField = null;
        continue;
      }

      if (!cur) continue; // 슬라이드 블록 밖

      // 필드 라인 또는 sub item
      var depth = indentDepth(raw);
      var bullet = line.match(/^[-*]\s+(.*)$/);
      var content = bullet ? bullet[1].trim() : line;

      // 필드 시작 키워드 감지 (대응 교수안 / 슬라이드 문구 / 이미지·시각 / 핵심 메시지)
      var fieldMatch = content.match(/^(대응\s*교수안|슬라이드\s*문구|이미지\s*[\/·]\s*시각|이미지|핵심\s*메시지|동영상|영상)\s*[:：]\s*(.*)$/);
      // 영상 칸: '- 영상: [제목](가리키는 값)', 또는 '- 영상:' 아래에 들여 쓴 '- [제목](값)' 줄.
      // 값이 정해 둔 모양이 아니면 칸이 아니라 예전처럼 글 줄로 읽는다 ('- 영상: 시청 후 토론' 같은 문구를 잃지 않게)
      var videoField = fieldMatch && /영상/.test(fieldMatch[1]) ? { video: parseVideoField(fieldMatch[2]), head: !fieldMatch[2].trim() && !!parseVideoField(nextSubItem(lines, i)) } : null;
      if (depth <= 0 && videoField && (videoField.video || videoField.head)) {
        if (videoField.video) cur.videos.push(videoField.video);
        curField = "video";
        continue;
      }
      if (depth <= 0 && fieldMatch && !videoField) {
        var fname = fieldMatch[1].replace(/\s+/g, "");
        var fval = fieldMatch[2].trim();
        if (/대응교수안/.test(fname)) { cur.maps = fval; curField = "maps"; }
        else if (/슬라이드문구/.test(fname)) { curField = "lines"; if (fval) cur.lines.push({ text: fval, depth: 0 }); }
        else if (/이미지/.test(fname)) { cur.visual = fval; curField = "visual"; }
        else if (/핵심메시지/.test(fname)) { cur.key = fval; curField = "key"; }
        else curField = null;
        continue;
      }

      // sub item — 현재 필드에 따라 처리
      if (curField === "lines" && bullet) {
        cur.lines.push({ text: content, depth: Math.max(0, depth - 1) });
      } else if (curField === "visual" && bullet) {
        cur.visual += (cur.visual ? " " : "") + content;
      } else if (curField === "key" && bullet) {
        cur.key += (cur.key ? " " : "") + content;
      } else if (curField === "video" && bullet) {
        var more = parseVideoField(content);
        if (more) cur.videos.push(more);
      }
    }
    flush();

    return { meta: fm.meta, slides: slides, notes: notes };
  }

  /* 영상 칸의 값 → {ref, title} | null
     가리키는 값은 판서 영상(wb:그림 키) · 넣은 동영상 파일(local:vid_키) · 움직이는 GIF(gif:그림 키) · http(s) 주소만 받는다.
     주소가 어느 곳의 영상인지(YouTube·Vimeo·mp4)는 그릴 때 교안 도우미가 가린다 — 여기서는 속성에 넣어도 되는 글자인지만 본다 */
  var VIDEO_REF = /^(?:wb:[\w-]{1,80}|gif:[\w-]{1,80}|local:vid_[a-z0-9]{6,40}|https?:\/\/[^\s"'<>`\\]{4,2000})$/;
  /* i 번째 줄 바로 아래의 들여 쓴 목록 줄의 글 (빈 줄은 건너뛴다). 없으면 "" */
  function nextSubItem(lines, i) {
    for (var k = i + 1; k < lines.length; k++) {
      var t = lines[k].trim();
      if (!t) continue;
      var bullet = t.match(/^[-*]\s+(.*)$/);
      return bullet && indentDepth(lines[k]) > 0 ? bullet[1].trim() : "";
    }
    return "";
  }
  function parseVideoField(text) {
    var value = String(text == null ? "" : text).trim();
    var link = value.match(/^\[([^\]]*)\]\((\S+)\)$/);
    var ref = link ? link[2] : value;
    if (!VIDEO_REF.test(ref)) return null;
    return { ref: ref, title: link ? link[1].replace(/\s+/g, " ").trim() : "" };
  }

  function classify(title) {
    var t = title.replace(/\s+/g, "");
    if (/표지|커버|cover/i.test(t)) return "cover";
    if (/목차|차례|agenda|toc/i.test(t)) return "toc";
    if (/\[?활동\]?/.test(title) || /활동/.test(t)) return "activity";
    if (/마무리|정리|클로징|closing|시작하자|기회를잘/.test(t)) return "closing";
    return "content";
  }

  /* =====================================================
     교수안 파서 — 블록 트리
     반환: {meta, title, blocks:[...]}
     블록 종류: heading(level,text), para(html), list(items,ordered),
                table(headers, rows), labelpara(label, html), callout(text)
     ===================================================== */
  function parseDoc(src) {
    var fm = splitFrontmatter(src);
    var lines = fm.body.replace(/\r\n/g, "\n").split("\n");
    var blocks = [];
    var docTitle = "";
    var i = 0;

    function inline(s) {
      // **bold**, `code`, ![alt](img), [text](url), 링크 자동
      s = escapeHtml(s);
      s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
      // 인라인 이미지 — 링크 치환보다 먼저(그래야 ![..](..)가 링크로 새지 않음). data:image·http(s)만 허용
      s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (m, alt, url) {
        url = url.trim();
        return /^(data:image\/|https?:)/i.test(url)
          ? '<img class="doc-inline-img" src="' + url + '" alt="' + alt + '" loading="lazy" />'
          : alt;
      });
      // 링크는 안전한 스킴(https?·mailto·페이지 내 앵커)만 허용 — javascript: 등은 라벨 텍스트로만 남긴다
      s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (m, label, url) {
        url = url.trim();
        return /^(https?:|mailto:|#)/i.test(url)
          ? '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>'
          : label;
      });
      s = s.replace(/(^|[\s(])((https?:\/\/)[^\s)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
      return s;
    }

    while (i < lines.length) {
      var raw = lines[i];
      var line = raw.trim();

      if (line === "") { i++; continue; }

      // 헤딩
      var h = raw.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        var lvl = h[1].length;
        var txt = h[2].trim();
        if (lvl === 1 && !docTitle) docTitle = txt;
        blocks.push({ type: "heading", level: lvl, text: txt });
        i++;
        continue;
      }

      // 이미지 — 마크다운 ![alt](url) 단독 줄 (Ctrl+V 붙여넣기 산출물 포함)
      var mdImg = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (mdImg) {
        var iu = mdImg[2].trim();
        if (/^(data:image\/|https?:)/i.test(iu)) blocks.push({ type: "image", src: iu, alt: mdImg[1].trim() });
        i++;
        continue;
      }
      // 이미지 — <img ...> 또는 <div class="image-wrapper"><img ...> (AI 산출물·붙여넣기)
      if (/<img\b/i.test(line)) {
        var tag = line.match(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i);
        var isrc = tag ? tag[1].trim() : "";
        var ialt = (line.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
        // 안전 스킴만 렌더 — local: 등 깨진 참조나 래퍼는 조용히 건너뛴다(리터럴 HTML 노출 방지)
        if (isrc && /^(data:image\/|https?:)/i.test(isrc)) blocks.push({ type: "image", src: isrc, alt: ialt });
        i++;
        continue;
      }
      // 이미지 래퍼 등 단독 HTML 태그 줄 — 렌더 노이즈가 되지 않게 건너뛴다
      if (/^<\/?(div|figure|figcaption|picture)\b[^>]*>$/i.test(line)) { i++; continue; }

      // 표
      if (/^\|/.test(line) && i + 1 < lines.length && /^\|?[\s:|-]+\|/.test(lines[i + 1].trim()) && /-/.test(lines[i + 1])) {
        var headers = splitRow(line);
        i += 2; // skip header + separator
        var rows = [];
        while (i < lines.length && /^\|/.test(lines[i].trim())) {
          rows.push(splitRow(lines[i].trim()));
          i++;
        }
        blocks.push({ type: "table", headers: headers.map(inline), rows: rows.map(function (r) { return r.map(inline); }) });
        continue;
      }

      // 리스트 (- / * / 1.)
      if (/^([-*]|\d+\.)\s+/.test(line)) {
        var items = [];
        var ordered = /^\d+\.\s+/.test(line);
        var baseIndent = indentDepth(raw);
        while (i < lines.length) {
          var r2 = lines[i];
          var l2 = r2.trim();
          if (l2 === "") { i++; continue; }
          var lm = l2.match(/^([-*]|\d+\.)\s+(.*)$/);
          if (!lm) break;
          items.push({ text: inline(lm[2].trim()), depth: Math.max(0, indentDepth(r2) - baseIndent) });
          i++;
        }
        blocks.push({ type: "list", ordered: ordered, items: items });
        continue;
      }

      // 라벨 문단: **강사 활동**: ...  또는  **멘트 예시**: "..."
      var lab = line.match(/^\*\*([^*]+)\*\*\s*[:：]\s*(.*)$/);
      if (lab) {
        var label = lab[1].trim();
        var rest = lab[2].trim();
        // 멘트/대사 → 콜아웃
        if (/멘트|대사|예시 멘트/.test(label)) {
          blocks.push({ type: "callout", label: label, html: inline(rest) });
        } else {
          // 같은 문단 이어지는 줄 흡수
          i++;
          while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|[-*]\s|\d+\.\s|\||\*\*[^*]+\*\*\s*[:：])/.test(lines[i].trim())) {
            rest += " " + lines[i].trim();
            i++;
          }
          blocks.push({ type: "labelpara", label: label, html: inline(rest) });
          continue;
        }
        i++;
        continue;
      }

      // 일반 문단 (이어지는 줄 흡수)
      var para = line;
      i++;
      while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|[-*]\s|\d+\.\s|\||\*\*[^*]+\*\*\s*[:：])/.test(lines[i].trim())) {
        para += " " + lines[i].trim();
        i++;
      }
      blocks.push({ type: "para", html: inline(para) });
    }

    return { meta: fm.meta, title: docTitle, blocks: blocks };
  }

  function splitRow(line) {
    var s = line.replace(/^\|/, "").replace(/\|\s*$/, "");
    return s.split("|").map(function (c) { return c.trim(); });
  }

  function escapeHtml(s) {
    // 따옴표까지 이스케이프 — 이 출력은 텍스트뿐 아니라 HTML 속성값에도 들어간다
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  window.KBuilder = window.KBuilder || {};
  window.KBuilder.parseDeck = parseDeck;
  window.KBuilder.parseVideoField = parseVideoField;
  window.KBuilder.parseDoc = parseDoc;
  window.KBuilder.escapeHtml = escapeHtml;
  window.KBuilder.classify = classify;
})();
