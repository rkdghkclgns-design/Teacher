// gyosuan-deck-tidy.js - 슬라이드 편성안(deckMd) 다듬기: 빈 그림 자리·빈 표·빈 도식 블록을 덜어 내고, 여러 문장을 한 줄에 이은 긴 슬라이드 문구는 문장마다 나눈다
// 스튜디오(js/kbuilder render-deck.js)는 '이미지/시각' 줄이 있으면 그림이 없어도 빈 그림 칸을 그린다. 그림이 없는 그 줄을 빼면 그림 칸 없는 레이아웃이 된다.
// 만든 편성안은 자동 그림을 붙인 뒤(gyosuan-images.js) 저장하기 전에 다듬고, 저장해 둔 편성안은 화면 편집본이 없을 때 스튜디오에 넘기는 글만 다듬는다(gyosuan.js).
// 슬라이드·칸 나누기는 kbuilder parser.js parseDeck과 같은 규칙을 따른다(### 머리줄이 슬라이드, 들여쓰지 않은 '이름:' 줄이 칸, ## 비고는 건드리지 않는다). 테스트: tests/gyosuan-regen.test.js

const DECK_FIELD = /^(?:[-*]\s+)?(대응\s*교수안|슬라이드\s*문구|이미지\s*[/·]\s*시각|이미지|핵심\s*메시지)\s*[:：]\s*(.*)$/;
const DECK_FENCE = /^\s*(```|~~~)/;
const DECK_MD_IMAGE = /!\[[^\]]*\]\(\s*([^)\s]*)[^)]*\)/g;
const DECK_HTML_IMAGE = /<img\b[^>]*>/gi;
// 그림 자리 표시: 교안의 <!-- [IMG: …] -->, [이미지]·[이미지: 설명]·[그림 1]·[IMG] 같은 글. 링크 글자([이미지](주소))는 아니다
const DECK_PLACEHOLDER = /<!--\s*\[IMG:[^\]]*\]\s*-->|\[(?:이미지|그림|사진|도표|도식|IMG|image)(?:[:：\s][^\]]*)?\](?!\()/gi;
const DECK_IMAGE_TAG = /^\[이미지:[^\]\s]+\]$/; // 자동 그림 표시(kbuilder auto-images.js). 스튜디오가 그 저장소에서 그림을 찾으므로 그림으로 본다
const DECK_REAL_IMAGE = /!\[[^\]]*\]\(\s*\S|<img\b|\[이미지:[^\]\s]+\]/i; // 죽은 그림을 뗀 뒤에도 남은 그림
const DECK_SPLIT = { minChars: 40, maxPieces: 4, minPiece: 6 }; // 이보다 짧은 줄·더 많은 문장·더 짧은 조각이면 나누지 않는다
const DECK_INLINE_CODE = /(``[^`]*``|`[^`]*`)/; // 인라인 코드. 그 안의 <img>·![]()·[이미지] 예제(HTML·마크다운 수업)는 그림 자리가 아니다

// 인라인 코드 밖의 글에만 fn을 쓴다. code를 주면 코드 조각은 code로 바꾼다
const outsideInlineCode = (line, fn, code = part => part) => line.split(DECK_INLINE_CODE).map((part, i) => (i % 2 ? code(part) : fn(part))).join('');

// parser.js indentDepth와 같다(빈칸 둘이 한 단계, 탭은 빈칸 넷)
function deckIndent(raw) {
    let n = 0;
    for (const ch of raw) {
        if (ch === ' ') n += 1;
        else if (ch === '\t') n += 4;
        else break;
    }
    return Math.floor(n / 2);
}

// 그림 주소가 진짜 그림인가: data:image·http(s) 주소, 또는 images에 진짜 그림(data:image)이 있는 local:키. 찾지 못한 그림 참조(teacher-image)·빈 주소는 아니다
function deckImageIsReal(url, images) {
    const src = String(url || '').trim();
    if (/^data:image\//i.test(src) || /^https?:\/\/\S/i.test(src)) return true;
    const local = src.match(/^local:([\w-]+)$/);
    return !!local && Object.prototype.hasOwnProperty.call(images, local[1]) && /^data:image\//.test(String(images[local[1]]));
}

const htmlImageSrc = tag => {
    const match = tag.match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return match ? match[1] ?? match[2] ?? match[3] ?? '' : '';
};

// 그 줄의 죽은 그림(그림 없는 마크다운 그림·img 태그, 그림 자리 표시)을 뗀다. 인라인 코드 속 예제는 그대로 둔다
function deckLineWithoutDeadImages(line, images) {
    return outsideInlineCode(line, text => text
        .replace(DECK_MD_IMAGE, (match, url) => (deckImageIsReal(url, images) ? match : ''))
        .replace(DECK_HTML_IMAGE, tag => (deckImageIsReal(htmlImageSrc(tag), images) ? tag : ''))
        .replace(DECK_PLACEHOLDER, match => (DECK_IMAGE_TAG.test(match) ? match : '')));
}

// 떼고 남은 빈칸을 줄인다(들여쓰기는 그대로)
const deckTidiedLine = line => line.replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ').replace(/[ \t]+$/, '');
const isBareBullet = line => /^\s*(?:[-*+]|\d+[.)])?\s*$/.test(line);

/* ---------- 표·코드 블록 ---------- */
const tableText = line => line.replace(/^\s*(?:[-*]\s+)?/, '');
const isTableLine = line => tableText(line).startsWith('|');
const tableCells = line => tableText(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
const isTableRule = cells => cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell));

// 머리줄만 있는 표(본문 줄이 없거나 본문 칸이 모두 빈 표)와 칸이 모두 빈 표
function isDeadTable(rows) {
    const parsed = rows.map(tableCells);
    const body = isTableRule(parsed[1] || []) ? parsed.slice(2) : parsed;
    return !body.filter(cells => !isTableRule(cells)).flat().some(Boolean);
}

const isEmptyFence = chunk => chunk.closed && chunk.lines.slice(1, -1).every(line => !line.trim());

// 슬라이드 몸통 줄을 덩어리로: 코드 블록(fence)·표(table)·한 줄(line). 닫히지 않은 코드 블록은 슬라이드 끝까지다(건드리지 않는다)
function deckChunks(lines) {
    const chunks = [];
    for (let i = 0; i < lines.length; i++) {
        const fence = lines[i].match(DECK_FENCE);
        if (fence) {
            let end = i + 1;
            while (end < lines.length && !lines[end].trim().startsWith(fence[1])) end++;
            chunks.push({ kind: 'fence', lines: lines.slice(i, end + 1), closed: end < lines.length });
            i = end;
        } else if (isTableLine(lines[i])) {
            let end = i;
            while (end + 1 < lines.length && isTableLine(lines[end + 1])) end++;
            chunks.push({ kind: 'table', lines: lines.slice(i, end + 1) });
            i = end;
        } else {
            chunks.push({ kind: 'line', line: lines[i] });
        }
    }
    return chunks;
}

/* ---------- 긴 문구 나누기 ---------- */
// 한글 낱말 뒤 마침표·물음표·느낌표에서 문장을 가른다(숫자 1.5나 영어 약자에서는 가르지 않는다)
function deckSentences(text) {
    const pieces = [];
    const end = /[가-힣][.!?](?=\s+\S)/g;
    let from = 0;
    for (let match = end.exec(text); match; match = end.exec(text)) {
        pieces.push(text.slice(from, match.index + match[0].length).trim());
        from = match.index + match[0].length;
    }
    pieces.push(text.slice(from).trim());
    return pieces.filter(Boolean);
}

// 슬라이드 문구 한 줄(들여 쓴 목록)에 여러 문장을 이었으면 같은 들여쓰기의 문장 줄로 나눈다. 뜻이 바뀔 수 있는 줄은 그대로 둔다:
// (제목)·(하단) 같은 표시 줄, 단계 번호 줄, 코드·표·링크·태그·흐름(→)이 든 줄, 문장이 너무 많거나 조각이 너무 짧은 줄, 굵게(**) 표시가 문장을 넘어 이어지는 줄
const openBold = piece => (piece.match(/\*\*/g) || []).length % 2 === 1;
function splitDeckLine(line) {
    const bullet = line.match(/^(\s+)([-*])\s+(.+?)\s*$/);
    if (!bullet || deckIndent(line) < 1) return [line];
    const text = bullet[3];
    if (text.length < DECK_SPLIT.minChars || /^\([^)]{1,8}\)|^(?:\d+[.)]|[①-⑨])\s|[`|<]|\]\(|→|https?:/.test(text)) return [line];
    const pieces = deckSentences(text);
    if (pieces.length < 2 || pieces.length > DECK_SPLIT.maxPieces || pieces.some(piece => piece.length < DECK_SPLIT.minPiece || openBold(piece))) return [line];
    return pieces.map(piece => `${bullet[1]}${bullet[2]} ${piece}`);
}

/* ---------- 슬라이드 ---------- */
const deckFieldName = name => {
    const key = name.replace(/\s+/g, '');
    if (/대응교수안/.test(key)) return 'maps';
    if (/슬라이드문구/.test(key)) return 'lines';
    if (/이미지/.test(key)) return 'visual';
    return 'key';
};

// 몸통을 칸으로 묶는다. 첫 칸 앞의 줄은 이름 없는 칸(parseDeck이 그리지 않는다)
function deckGroups(body) {
    const groups = [{ field: null, chunks: [] }];
    deckChunks(body).forEach(chunk => {
        const field = chunk.kind === 'line' && deckIndent(chunk.line) === 0 ? chunk.line.trim().match(DECK_FIELD) : null;
        if (field) groups.push({ field: deckFieldName(field[1]), chunks: [chunk] });
        else groups[groups.length - 1].chunks.push(chunk);
    });
    return groups;
}

// 칸 하나를 다듬는다 → { field, lines, keep, hasContent, removed }. 이미지/시각 칸은 진짜 그림이 있을 때만, 슬라이드 문구 칸은 덜어 내고 빈 칸이 되면 뺀다
function tidyDeckGroup(group, images) {
    let removed = false;
    const lines = [];
    group.chunks.forEach((chunk, at) => {
        if (chunk.kind !== 'line') {
            const dead = chunk.kind === 'fence' ? isEmptyFence(chunk) : isDeadTable(chunk.lines);
            if (dead) removed = true;
            else lines.push(...chunk.lines);
            return;
        }
        const head = !!group.field && at === 0;
        const stripped = deckLineWithoutDeadImages(chunk.line, images);
        const line = stripped === chunk.line ? chunk.line : deckTidiedLine(stripped);
        if (stripped !== chunk.line) removed = true;
        if (!head && stripped !== chunk.line && isBareBullet(line)) return;
        lines.push(...(group.field === 'lines' && !head ? splitDeckLine(line) : [line]));
    });
    const value = group.field ? ((lines[0] || '').trim().match(DECK_FIELD)?.[2] || '').trim() : '';
    const hasContent = !!value || lines.slice(group.field ? 1 : 0).some(line => line.trim());
    const keep = group.field === 'visual' ? DECK_REAL_IMAGE.test(lines.map(line => outsideInlineCode(line, text => text, () => '')).join('\n'))
        : !(group.field === 'lines' && removed && !hasContent);
    return { field: group.field, lines, keep, hasContent, removed: removed || !keep };
}

// 뺀 칸 끝의 빈 줄은 남긴다(다음 슬라이드와 붙지 않게)
const trailingBlanks = lines => {
    let n = 0;
    while (n < lines.length && !lines[lines.length - 1 - n].trim()) n++;
    return lines.slice(lines.length - n);
};

// 슬라이드 하나 → 다듬은 줄(머리줄 포함). 덜어 내서 문구·그림·핵심 메시지가 모두 빈 슬라이드는 null
function tidyDeckSlide(slide, images) {
    const groups = deckGroups(slide.body).map(group => ({ group, result: tidyDeckGroup(group, images) }));
    const removed = groups.some(({ result }) => result.removed);
    const content = groups.some(({ result }) => result.keep && result.hasContent && ['lines', 'visual', 'key'].includes(result.field));
    if (removed && !content) return null;
    const body = groups.flatMap(({ group, result }) => (result.keep ? result.lines : trailingBlanks(group.chunks.flatMap(chunk => chunk.lines || [chunk.line]))));
    return [slide.header, ...body];
}

// 편성안을 덩어리로: 슬라이드({ header, body })와 그 밖의 줄(앞머리·## 머리줄·## 비고)
function deckBlocks(lines) {
    const blocks = [];
    let notes = false;
    let slide = null;
    lines.forEach(line => {
        const h2 = line.match(/^##\s+(.*)$/);
        if (h2) notes = /비고|참고|메모/.test(h2[1]);
        if (h2 || (!notes && /^###\s+/.test(line))) slide = null;
        if (!h2 && !notes && /^###\s+/.test(line)) {
            slide = { header: line, body: [] };
            blocks.push(slide);
        } else if (slide) {
            slide.body.push(line);
        } else {
            blocks.push({ raw: line });
        }
    });
    return blocks;
}

// 뺀 슬라이드가 있을 때, 슬라이드 머리줄이 모두 '### 슬라이드 N - 제목'이고 1부터 차례였으면 남은 슬라이드 번호를 다시 매긴다(아니면 그대로)
const SLIDE_NUMBER = /^(###\s+슬라이드\s*)(\d+)(?=\s*[-–—:])/;
function renumberDeckSlides(blocks) {
    const slides = blocks.filter(block => block.header);
    if (!slides.every(({ header }, i) => Number(header.match(SLIDE_NUMBER)?.[2]) === i + 1)) return blocks;
    let number = 0;
    return blocks.map(block => {
        if (!block.lines) return block;
        number += 1;
        return { ...block, lines: [block.lines[0].replace(SLIDE_NUMBER, `$1${number}`), ...block.lines.slice(1)] };
    });
}

// 코드 블록 밖의 이어진 빈 줄을 하나로
function collapseDeckBlanks(lines) {
    let inside = false;
    return lines.filter((line, i) => {
        if (DECK_FENCE.test(line)) inside = !inside;
        return inside || line.trim() || i === 0 || lines[i - 1].trim();
    });
}

// md: 편성안 글. images: local:키가 가리키는 그림(그 키의 그림이 진짜 그림이면 그 그림 칸을 남긴다). 바꿀 것이 없으면 받은 글을 그대로 돌려준다
function tidyGyosuanDeck(md, images = {}) {
    const text = String(md ?? '');
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const map = images && typeof images === 'object' ? images : {};
    // 슬라이드 덩어리마다 다듬은 줄(lines, 뺀 슬라이드는 null)을 단다. 그 밖의 줄은 raw 그대로
    const blocks = deckBlocks(lines).map(block => (block.header ? { ...block, lines: tidyDeckSlide(block, map) } : block));
    const slides = blocks.filter(block => block.header);
    if (slides.every(slide => slide.lines && slide.lines.join('\n') === [slide.header, ...slide.body].join('\n'))) return text;
    const numbered = slides.some(slide => !slide.lines) ? renumberDeckSlides(blocks) : blocks;
    const out = collapseDeckBlanks(numbered.flatMap(block => (block.header ? block.lines || [] : [block.raw])));
    return out.join(text.includes('\r\n') ? '\r\n' : '\n');
}
