// lesson-format.js - 교안 본문에서 드래그한 글자에 서식(굵게·기울임·목록·인용 등)을 입힌다
// 화면 HTML이 아니라 저장된 마크다운을 고친다. 화면에서 고른 글자를 marked 토큰의 원문 위치로 되짚어 그 자리에 기호를 넣거나 뺀다.
// DOM을 쓰지 않는 함수만 둔다(화면 쪽은 format-toolbar.js). 테스트: tests/lesson-format.test.js

// 교안은 번호 목록을 글머리 목록으로 바꿔 그린다(postprocessHtml). 서식 막대로 고른 번호 목록만 이 표시로 번호를 남긴다
const LF_OL_MARK = '<!-- 번호 목록 -->';
// 화면 후처리가 라벨 끝 콜론을 지우고 마침표 뒤에 줄을 바꾸므로, 화면 글자와 원문 글자를 비교할 때 빈칸과 콜론은 뺀다
const LF_SKIP = /[\s:：]/;
const LF_SKIP_ALL = /[\s:：]/g;
const LF_PUNCT = /[\p{P}\p{S}]/u;
const LF_STYLE_SPANS = {
    bold: ['strong', 'html:strong', 'html:b'],
    italic: ['em', 'html:em', 'html:i'],
    strike: ['del', 'html:del', 'html:s', 'html:strike'],
    underline: ['html:u'],
    code: ['codespan'],
    link: ['link']
};
const LF_INLINE_STYLES = Object.keys(LF_STYLE_SPANS);
const LF_MARKERS = { bold: '**', italic: '*', strike: '~~' };
const LF_TAGS = { bold: 'strong', italic: 'em', strike: 'del', underline: 'u' };
const LF_HTML_TAGS = ['strong', 'b', 'em', 'i', 'del', 's', 'strike', 'u'];
const LF_SPAN_TOKENS = new Set(['strong', 'em', 'del', 'link']);
const LF_HEADING_LEVELS = { h2: 2, h3: 3, h4: 4 };
const LF_SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

const lfFail = reason => ({ ok: false, reason });
const lfReplace = (raw, start, end, text) => raw.slice(0, start) + text + raw.slice(end);
const lfNorm = text => String(text || '').replace(LF_SKIP_ALL, '');
const lfSplit = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean);

function lfLex(md) {
    if (typeof marked === 'undefined' || typeof marked.lexer !== 'function') throw new Error('마크다운 해석기(marked)를 불러오지 못했습니다');
    return marked.lexer(md);
}

/* ---------- 블록: 화면의 i번째 블록은 원문의 i번째 '보이는' 토큰이다(두 번 눌러 고치기와 같은 규칙) ---------- */
function lfIsShown(token) {
    return token.type !== 'space' && !(token.type === 'html' && token.raw.trim().startsWith('<!--'));
}

// 토큰 raw를 이어 붙인 글이 원문과 다르면(링크 정의처럼 토큰이 되지 않는 줄) null. 그런 원문은 고치지 않는다
function lessonBlocks(source) {
    const text = String(source || '').replace(/\r\n?/g, '\n');
    let start = 0;
    let shown = 0;
    const blocks = lfLex(text).map(token => {
        const block = { token, raw: token.raw, start, index: lfIsShown(token) ? shown++ : -1 };
        start += token.raw.length;
        return block;
    });
    return blocks.map(block => block.raw).join('') === text ? blocks : null;
}

/* ---------- 블록 원문을 보이는 글자와 그 원문 위치로 펼친다. 서식 기호의 범위(spans)도 모은다 ---------- */
function lfProject(raw) {
    const out = { chars: [], spans: [] };
    lfWalk(lfLex(raw), raw, 0, out);
    return { ...out, spans: [...out.spans, ...lfHtmlSpans(raw)] };
}

function lfWalk(tokens, parentRaw, offset, out) {
    let cursor = 0;
    let first = -1;
    let last = -1;
    (tokens || []).forEach(token => {
        const at = token.raw ? parentRaw.indexOf(token.raw, cursor) : -1;
        if (at === -1) return; // 들여쓰기를 걷어 낸 여러 줄 목록 항목 같은 경우. 글자 찾기가 실패하면 서식을 못 바꾼다고 알린다
        cursor = at + token.raw.length;
        if (first === -1) first = offset + at;
        last = offset + cursor;
        lfVisit(token, offset + at, out);
    });
    return { first, last };
}

function lfVisit(token, at, out) {
    if (token.type === 'escape') return lfPushChars(out, token.raw.slice(1), at + 1);
    if (token.type === 'codespan' || token.type === 'code') return lfVisitLiteral(token, at, out);
    if (token.type === 'br') return lfPushChars(out, '\n', at);
    if (token.type === 'list') return lfWalk(token.items, token.raw, at, out);
    if (token.tokens) {
        const inner = lfWalk(token.tokens, token.raw, at, out);
        if (LF_SPAN_TOKENS.has(token.type) && inner.first !== -1) {
            out.spans.push({ type: token.type, start: at, end: at + token.raw.length, innerStart: inner.first, innerEnd: inner.last });
        }
        return null;
    }
    return token.type === 'text' ? lfPushChars(out, token.raw, at) : null; // html, image, hr에는 글자가 없다
}

function lfVisitLiteral(token, at, out) {
    const inner = token.raw.indexOf(token.text);
    if (inner === -1) return null;
    lfPushChars(out, token.text, at + inner);
    if (token.type === 'codespan') {
        out.spans.push({ type: 'codespan', start: at, end: at + token.raw.length, innerStart: at + inner, innerEnd: at + inner + token.text.length });
    }
    return null;
}

function lfPushChars(out, text, at) {
    for (let i = 0; i < text.length; i++) out.chars.push({ c: text[i], pos: at + i });
    return null;
}

// <u>…</u>, <strong>…</strong> 같은 HTML 서식. 같은 태그끼리 안쪽부터 짝을 맞춘다
function lfHtmlSpans(raw) {
    return LF_HTML_TAGS.flatMap(tag => {
        const opens = [];
        const spans = [];
        for (const match of raw.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>|</${tag}\\s*>`, 'gi'))) {
            if (match[0][1] !== '/') opens.push(match);
            else if (opens.length) {
                const open = opens.pop();
                spans.push({ type: `html:${tag}`, start: open.index, end: match.index + match[0].length, innerStart: open.index + open[0].length, innerEnd: match.index });
            }
        }
        return spans;
    });
}

/* ---------- 화면에서 고른 글자 → 원문 위치 ---------- */
function lfClosestIndex(text, needle, near) {
    let best = -1;
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
        if (best === -1 || Math.abs(i - near) < Math.abs(best - near)) best = i;
    }
    return best;
}

// 고른 글자(selected)와 블록 안에서 그 앞 글자(before)로 원문 [start, end)를 찾는다. 못 찾으면 null
function findInlineRange(raw, before, selected, proj = lfProject(raw)) {
    const needle = lfNorm(selected);
    if (!needle) return null;
    const chars = proj.chars.filter(ch => !LF_SKIP.test(ch.c));
    const at = lfClosestIndex(chars.map(ch => ch.c).join(''), needle, lfNorm(before).length);
    if (at === -1) return null;
    const start = chars[at].pos;
    const end = chars[at + needle.length - 1].pos + 1;
    // '**라벨:**'의 콜론은 화면에서 지워진다. 서식 기호 바로 앞의 콜론까지 고른 것으로 본다
    const colon = raw.slice(end).match(/^[:：]+(?=$|[*_~<\n])/);
    return { start, end: end + (colon ? colon[0].length : 0) };
}

// 화면 블록 글자(text)와 원문 블록이 같은 블록인지. 앞 몇 글자가 겹치면 같다고 본다
function lfSameBlock(proj, text) {
    const shown = lfNorm(text);
    const source = lfNorm(proj.chars.map(ch => ch.c).join(''));
    if (!shown || !source) return false;
    const size = Math.min(12, shown.length, source.length);
    return source.includes(shown.slice(0, size)) || shown.includes(source.slice(0, size));
}

// 화면 순서(index)에서 가까운 원문 블록부터 글자가 맞는 블록을 찾는다. 화면 후처리가 블록을 나누거나 지워도 따라간다
function lfCandidates(blocks, index) {
    return blocks.filter(block => block.index >= 0).sort((a, b) => Math.abs(a.index - index) - Math.abs(b.index - index));
}

function lfLocateBlock(blocks, part) {
    return lfCandidates(blocks, part.index).find(block => lfSameBlock(lfProject(block.raw), part.text)) || null;
}

function lfLocateInline(blocks, part) {
    for (const block of lfCandidates(blocks, part.index)) {
        const proj = lfProject(block.raw);
        const range = lfSameBlock(proj, part.text) ? findInlineRange(block.raw, part.before, part.selected, proj) : null;
        if (range) return { block, range, proj };
    }
    return null;
}

/* ---------- 글자 서식 ---------- */
const lfSpansFor = (spans, style) => spans.filter(span => (LF_STYLE_SPANS[style] || []).includes(span.type));
const lfContaining = (spans, range) => spans
    .filter(span => span.innerStart <= range.start && range.end <= span.innerEnd)
    .sort((a, b) => (a.end - a.start) - (b.end - b.start));
const lfIsActive = (target, style) => lfContaining(lfSpansFor(target.proj.spans, style), target.range).length > 0;

function lfTrimRange(raw, range) {
    let { start, end } = range;
    while (start < end && /\s/.test(raw[start])) start++;
    while (end > start && /\s/.test(raw[end - 1])) end--;
    return { start, end };
}

// 범위가 다른 서식을 반쯤 걸치면 그 서식을 통째로 넣는다. 기호가 엇갈려 깨지지 않게 한다(bound 밖으로는 넓히지 않는다)
function lfExpandRange(spans, range, bound) {
    let { start, end } = range;
    let grown = true;
    while (grown) {
        grown = false;
        spans.forEach(span => {
            const partial = span.start < end && start < span.end
                && !(start <= span.start && span.end <= end)
                && !(span.innerStart <= start && end <= span.innerEnd);
            const inBound = !bound || (bound.innerStart <= span.start && span.end <= bound.innerEnd);
            if (partial && inBound) {
                start = Math.min(start, span.start);
                end = Math.max(end, span.end);
                grown = true;
            }
        });
    }
    return { start, end };
}

// 범위 안에 통째로 든 서식(spans)의 기호를 걷어 낸 글
function lfStripSpans(raw, range, spans) {
    const cuts = spans
        .filter(span => range.start <= span.start && span.end <= range.end)
        .flatMap(span => [[span.start, span.innerStart], [span.innerEnd, span.end]])
        .sort((a, b) => a[0] - b[0]);
    let text = '';
    let at = range.start;
    cuts.forEach(([from, to]) => {
        if (from < at) return;
        text += raw.slice(at, from);
        at = to;
    });
    return text + raw.slice(at, range.end);
}

function lfWrapKeepSpace(text, open, close) {
    if (!text.trim()) return text;
    const lead = text.match(/^\s*/)[0];
    const trail = text.match(/\s*$/)[0];
    return lead + open + text.trim() + close + trail;
}

// 한글 바로 옆에서 문장부호로 끝나는 '**경험(PX)**을'은 마크다운 강조가 되지 않는다. 그럴 때는 HTML 태그를 쓴다
function lfMarkers(style, raw, range, mid) {
    const marker = LF_MARKERS[style];
    const tag = LF_TAGS[style];
    const prev = raw[range.start - 1];
    const next = raw[range.end];
    const tight = ch => ch !== undefined && !/\s/.test(ch) && !LF_PUNCT.test(ch);
    const risky = !marker
        || (LF_PUNCT.test(mid[0]) && tight(prev))
        || (LF_PUNCT.test(mid[mid.length - 1]) && tight(next))
        || prev === marker[0] || next === marker[0];
    return risky ? [`<${tag}>`, `</${tag}>`] : [marker, marker];
}

function lfCodeSpan(text) {
    const longest = Math.max(0, ...(text.match(/`+/g) || []).map(run => run.length));
    const fence = '`'.repeat(longest + 1);
    const pad = /^`|`$/.test(text) ? ' ' : '';
    return fence + pad + text + pad + fence;
}

function lfEscapeMarkdown(line) {
    return line.replace(/([\\`*_~[\]<])/g, '\\$1').replace(/^(\s*)([#>+-]|\d+[.)])/, '$1\\$2');
}

function lfRemoveStyle(target, style) {
    const { block, range, proj } = target;
    const raw = block.raw;
    const span = lfContaining(lfSpansFor(proj.spans, style), range)[0];
    const inner = raw.slice(span.innerStart, span.innerEnd);
    if (style === 'link') return lfReplace(raw, span.start, span.end, inner);
    if (style === 'code') return lfReplace(raw, span.start, span.end, lfEscapeMarkdown(inner));
    const cut = lfExpandRange(proj.spans.filter(other => other !== span), range, span);
    const open = raw.slice(span.start, span.innerStart);
    const close = raw.slice(span.innerEnd, span.end);
    const piece = lfWrapKeepSpace(raw.slice(span.innerStart, cut.start), open, close)
        + raw.slice(cut.start, cut.end)
        + lfWrapKeepSpace(raw.slice(cut.end, span.innerEnd), open, close);
    return lfReplace(raw, span.start, span.end, piece);
}

function lfAddStyle(target, style, opts) {
    const { block, proj } = target;
    const raw = block.raw;
    const range = lfExpandRange(proj.spans, lfTrimRange(raw, target.range), null);
    if (range.start >= range.end) return raw;
    if (style === 'code') {
        const shown = proj.chars.filter(ch => range.start <= ch.pos && ch.pos < range.end).map(ch => ch.c).join('');
        return lfReplace(raw, range.start, range.end, lfCodeSpan(shown));
    }
    const mid = lfStripSpans(raw, range, lfSpansFor(proj.spans, style));
    if (style === 'link') return lfReplace(raw, range.start, range.end, `[${mid}](${opts.url})`);
    const [open, close] = lfMarkers(style, raw, range, mid);
    return lfReplace(raw, range.start, range.end, open + mid + close);
}

function lfRebuild(blocks, edits) {
    return blocks.map(block => (edits.has(block) ? edits.get(block) : block.raw)).join('');
}

function lfLocateAll(source, parts) {
    const blocks = lessonBlocks(source);
    if (!blocks) return { error: '이 탭은 원문 구조가 특이해 서식을 바로 바꿀 수 없습니다. 도구 → 원문 전체 수정에서 고쳐 주세요.' };
    const targets = parts.map(part => lfLocateInline(blocks, part));
    if (!targets.length || targets.some(target => !target)) return { error: '고른 글자를 원문에서 찾지 못했습니다. 두 번 눌러 직접 고쳐 주세요.' };
    if (new Set(targets.map(target => target.block)).size !== targets.length) return { error: '고른 범위를 원문과 맞추지 못했습니다. 한 문단씩 골라 주세요.' };
    return { blocks, targets };
}

// 고른 글자에 이미 걸린 서식. 막대 버튼을 눌린 모양으로 보여 줄 때 쓴다
function inlineFormatState(source, parts) {
    const found = lfLocateAll(source, parts);
    const state = {};
    LF_INLINE_STYLES.forEach(style => { state[style] = !found.error && found.targets.every(target => lfIsActive(target, style)); });
    return state;
}

// parts: [{ index, before, selected, text }] — index는 화면 블록 순서, before는 그 블록 안에서 고른 글자 앞의 글, text는 블록 전체 글
// 고른 글자가 모두 그 서식이면 걷어 내고, 아니면 모두에 입힌다(슬랙과 같은 규칙)
function applyInlineFormat(source, parts, style, opts = {}) {
    if (!LF_STYLE_SPANS[style]) return lfFail('알 수 없는 서식입니다.');
    const found = lfLocateAll(source, parts);
    if (found.error) return lfFail(found.error);
    const active = found.targets.every(target => lfIsActive(target, style));
    if (style === 'link' && !active && found.targets.length > 1) return lfFail('링크는 한 문단 안에서만 걸 수 있습니다.');
    if (style === 'link' && !active && !opts.url) return lfFail('링크 주소를 넣어 주세요.');
    const edits = new Map(found.targets.map(target => [
        target.block,
        active ? lfRemoveStyle(target, style) : lfAddStyle(target, style, opts)
    ]));
    return { ok: true, source: lfRebuild(found.blocks, edits), active: !active };
}

// 'naver.com' → 'https://naver.com'. http(s)와 메일 주소만 받는다. 마크다운 괄호를 깨는 글자는 인코딩한다
function normalizeLinkUrl(input) {
    const text = String(input || '').trim();
    if (!text || /\s/.test(text)) return null;
    const url = LF_SAFE_LINK.test(text) ? text : (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(text) ? `https://${text}` : null);
    return url ? url.replace(/[()<>]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`) : null;
}

/* ---------- 블록 서식: 목록·인용·제목·코드 블록·구분선 ---------- */
function lfLines(block) {
    const token = block.token;
    if (['paragraph', 'heading', 'text', 'blockquote', 'code'].includes(token.type)) return lfSplit(token.text);
    if (token.type === 'list') return token.items.flatMap(item => lfSplit(item.text));
    return null; // 표, HTML, 그림 블록은 목록이나 제목으로 바꾸지 않는다
}

const lfTextBlock = block => ['paragraph', 'heading'].includes(block.token.type);

function lfHeading(shown, level) {
    return shown.map(block => (lfTextBlock(block)
        ? (level ? `${'#'.repeat(level)} ` : '') + lfLines(block).join(level ? ' ' : '\n')
        : block.raw.trimEnd())).join('\n\n');
}

function lfToggleList(shown, ordered) {
    const isSame = block => block.token.type === 'list' && !!block.token.ordered === ordered;
    if (shown.every(isSame)) return shown.flatMap(lfLines).join('\n\n');
    if (shown.some(block => !lfLines(block))) return null;
    const items = shown.flatMap(lfLines).map((line, i) => `${ordered ? `${i + 1}.` : '-'} ${line}`);
    return (ordered ? `${LF_OL_MARK}\n` : '') + items.join('\n');
}

function lfToggleQuote(shown) {
    const lines = block => block.raw.trimEnd().split('\n');
    if (shown.every(block => block.token.type === 'blockquote')) {
        return shown.map(block => lines(block).map(line => line.replace(/^ {0,3}> ?/, '')).join('\n')).join('\n\n');
    }
    return shown.map(block => lines(block).map(line => (line.trim() ? `> ${line}` : '>')).join('\n')).join('\n>\n');
}

function lfToggleCodeBlock(shown, opts) {
    if (shown.length === 1 && shown[0].token.type === 'code') return lfSplit(shown[0].token.text).map(lfEscapeMarkdown).join('\n\n');
    const texts = opts.texts && opts.texts.length ? opts.texts : shown.map(block => (lfLines(block) || []).join('\n'));
    const body = texts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const longest = Math.max(0, ...(body.match(/`+/g) || []).map(run => run.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}\n${body}\n${fence}`;
}

const LF_BLOCK_OPS = {
    paragraph: shown => lfHeading(shown, 0),
    h2: shown => lfHeading(shown, LF_HEADING_LEVELS.h2),
    h3: shown => lfHeading(shown, LF_HEADING_LEVELS.h3),
    h4: shown => lfHeading(shown, LF_HEADING_LEVELS.h4),
    bullet: shown => lfToggleList(shown, false),
    ordered: shown => lfToggleList(shown, true),
    quote: shown => lfToggleQuote(shown),
    codeblock: (shown, opts) => lfToggleCodeBlock(shown, opts),
    divider: (shown, opts, region) => `${region.map(block => block.raw).join('').trimEnd()}\n\n---`
};

// 번호 목록 앞의 표시 주석도 함께 바꾼다
function lfRegionStart(blocks, first) {
    let at = first - 1;
    while (at >= 0 && blocks[at].token.type === 'space') at--;
    return at >= 0 && blocks[at].raw.trim() === LF_OL_MARK ? at : first;
}

// parts: [{ index, text }] — 고른 범위가 걸친 화면 블록들. opts.texts는 코드 블록에 넣을 화면 글자
function applyBlockFormat(source, parts, op, opts = {}) {
    if (!LF_BLOCK_OPS[op]) return lfFail('알 수 없는 서식입니다.');
    const blocks = lessonBlocks(source);
    if (!blocks) return lfFail('이 탭은 원문 구조가 특이해 서식을 바로 바꿀 수 없습니다. 도구 → 원문 전체 수정에서 고쳐 주세요.');
    const found = parts.map(part => lfLocateBlock(blocks, part));
    if (!found.length || found.some(block => !block)) return lfFail('고른 문단을 원문에서 찾지 못했습니다. 두 번 눌러 직접 고쳐 주세요.');
    const positions = found.map(block => blocks.indexOf(block));
    const last = Math.max(...positions);
    const from = lfRegionStart(blocks, Math.min(...positions));
    const region = blocks.slice(from, last + 1);
    const body = LF_BLOCK_OPS[op](region.filter(block => block.index >= 0), opts, region);
    if (body == null) return lfFail('표나 그림이 섞인 범위는 목록으로 바꿀 수 없습니다.');
    const tail = blocks[last].raw.slice(blocks[last].raw.trimEnd().length);
    const join = list => list.map(block => block.raw).join('');
    return { ok: true, source: join(blocks.slice(0, from)) + body + tail + join(blocks.slice(last + 1)) };
}

/* ---------- 두 번 눌러 단락 고치기 ---------- */
// 화면 블록(part: { index, text })에 맞는 원문 블록. 글자가 맞는 가까운 블록을 먼저 찾고,
// 글자가 없는 블록(그림·HTML 표)만 화면 순서로 짝짓는다. 못 찾으면 null
function locateLessonBlock(source, part) {
    const blocks = lessonBlocks(source);
    if (!blocks) return null;
    const byText = lfLocateBlock(blocks, part);
    const byIndex = blocks.find(block => block.index === part.index);
    const fallback = byIndex && !lfProject(byIndex.raw).chars.some(ch => !LF_SKIP.test(ch.c)) ? byIndex : null;
    const block = byText || fallback;
    return block ? { start: block.start, raw: block.raw } : null;
}

// locateLessonBlock으로 찾은 블록을 text로 바꾼 원문. 그사이 원문이 바뀌었으면 null
function replaceLessonBlock(source, located, text) {
    const normalized = String(source || '').replace(/\r\n?/g, '\n');
    const { start, raw } = located;
    if (normalized.slice(start, start + raw.length) !== raw) return null;
    const tail = raw.slice(raw.trimEnd().length);
    return normalized.slice(0, start) + String(text).trimEnd() + tail + normalized.slice(start + raw.length);
}

// postprocessHtml이 <ol>을 글머리 목록으로 바꾼 뒤, 서식 막대로 고른 번호 목록만 번호로 되돌린다
function keepChosenNumbering(html) {
    return String(html || '').replace(/<!--\s*번호 목록\s*-->\s*<ul style="list-style:disc;/g, '<ul style="list-style:decimal;');
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        lessonBlocks, findInlineRange, inlineFormatState, applyInlineFormat, applyBlockFormat,
        normalizeLinkUrl, keepChosenNumbering, locateLessonBlock, replaceLessonBlock
    });
}
