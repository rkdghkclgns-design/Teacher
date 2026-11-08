// image-slot-place.js - 도구의 '그림 자리 넣기': 마우스로 넣을 자리를 고르고, 아직 그림이 없는 그림 자리를 눌러 그 자리 그림 한 장을 만든다
// 자리 고르기: 마우스 포인터를 따라다니는 '그림 자리' 표시가 가리킨 화면 블록(단락·제목·목록·표·코드 블록)의 위나 아래 경계를 보여 주고, 누르면 그 경계에 넣는다.
//  화면 블록은 원문 블록과 글자로 짝짓는다(lesson-format.js locateLessonBlock, 두 번 눌러 고치기와 같은 규칙). 원문 블록의 앞이나 뒤에 빈 줄로 띄운 <!-- [IMG: "검색어"] --> 줄을 넣으므로
//  코드 블록·표·목록 항목 안에는 들어가지 않는다. 넣은 줄이 따로 선 그림 자리가 되지 않거나(닫히지 않은 코드 블록 뒤 등) 화면이 그림을 숨기는 곳(학습 목표·개요·첫 제목 바로 아래)이면 넣지 않는다.
//  검색어는 둘레 단락과 그 위 제목에서 짧게 고른다(영어 낱말 먼저). 바꾸기 전 글은 작업 기록에 남기고(lesson-review.js commitTabChange) Ctrl+Z로도 되돌린다(format-toolbar.js).
//  Esc·오른쪽 클릭·교안 밖 클릭은 넣지 않고 그만둔다.
//  같은 자리 고르기를 도구의 '동영상 넣기'·'텍스트 블록 넣기'(lesson-insert-tools.js)도 쓴다(startLessonBlockPlacing에 무엇을 넣는지 kind를 준다. 넣을 글은 lessonBlockInsertPlan이 검사한다).
// 눌러 그림 만들기: 보기 화면의 그림 자리(그림 자리 표시 줄, 그림을 못 만든 자리)를 누르면 그림 1장의 비용·시간을 보이고 묻는다(cost-estimate.js confirmWithEstimate).
//  확인하면 일괄 이미지 찾기와 같은 길(api.js processImageTags: 검색어 정하기 → 그림 검색 → AI 그림)로 그 자리 하나만 채운다. 다른 그림 자리 표시는 잠시 다른 표시로 바꿔 두어 건드리지 않는다.
//  그림을 만든 때만 글을 바꾸고 바꾸기 전 글은 작업 기록에 남긴다. 테스트: tests/image-slot.test.js

const SLOT_COMMENT = /^\s*\[IMG:\s*"?([^"]+)"?\]\s*$/; // 보기 화면 주석 노드의 글(<!-- … --> 안)이 그림 자리 표시인지(api.js IMAGE_TAG_RE와 같은 모양)
const SLOT_NUMBERED = /<!--\s*\[IMG:\s*"teacher-slot-(\d+)"\]\s*-->/g; // 화면에 남는 그림 자리를 가릴 때 붙이는 번호 표시
const SLOT_ENGLISH = /[A-Za-z][A-Za-z0-9+#'’-]*(?:[ \t]+[A-Za-z][A-Za-z0-9+#'’-]*)*/g; // 이어 쓴 영어 낱말 묶음(Game Loop)
const SLOT_STOPWORDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'be', 'by', 'at', 'as', 'it', 'with', 'this', 'that']);
const SLOT_HEADING_NUMBER = /^\d+(?:[.-]\d+)*[.)]\s+/; // 제목 앞 번호(2. · 1-2.)
const SLOT_KEYWORD_WORDS = 5; // 검색어에 쓰는 영어 낱말 수
const SLOT_KEYWORD_CHARS = 24; // 한글 검색어 길이(낱말 경계에서 자른다)
const SLOT_LABEL_CHARS = 40; // 그림 자리 칸과 묻는 창에 보이는 검색어 길이
const SLOT_LINE_GAP = 6; // 넣을 경계선과 블록 사이(px)
const SLOT_POINTER_GAP = 14; // 포인터와 표시 글 사이(px)
const SLOT_DBLCLICK_GUARD_MS = 500; // 넣은 바로 뒤 이 시간 안의 두 번 누르기는 단락 편집을 열지 않는다

const SLOT_TEXT = {
    start: "넣을 곳을 누르세요. 마우스를 따라다니는 '그림 자리'가 넣을 자리(단락·제목·목록·표·코드 블록의 위나 아래)를 보여 줍니다. Esc나 오른쪽 클릭으로 그만둡니다.",
    noView: '그림 자리는 교안 보기 화면에서 넣을 곳을 눌러 넣습니다. 보기 화면에서 다시 눌러 주세요.',
    cancelled: '그림 자리 넣기를 그만두었습니다.',
    odd: '이 탭은 원문 구조가 특이해 그림 자리를 바로 넣을 수 없습니다. 도구 → 원문 전체 수정에서 넣어 주세요.',
    notFound: '이 자리를 원문에서 찾지 못했습니다. 바로 위나 아래 단락을 눌러 주세요.',
    inside: '여기에 넣으면 그림 자리가 코드 블록이나 목록 안으로 들어갑니다. 다른 자리를 눌러 주세요.',
    hidden: '학습 목표·개요와 첫 제목 바로 아래는 화면에 그림을 보이지 않는 곳이라 그림 자리를 넣지 않습니다. 다른 자리를 눌러 주세요.',
    placed: keyword => `그림 자리(${keyword})를 넣었습니다. 그 자리를 누르면 그림을 만듭니다. Ctrl+Z로 되돌릴 수 있습니다.`,
    placeFailed: '그림 자리를 넣지 못했습니다. 잠시 뒤 다시 해 보세요.',
    missing: "이 그림 자리를 교안 원문에서 찾지 못했습니다. 도구의 '일괄 이미지 찾기'로 채우거나 도구 → 원문 전체 수정에서 그 자리를 확인해 주세요.",
    busy: '진행 중인 생성이 끝난 뒤 다시 시도해주세요.',
    moved: '묻는 동안 다른 차시나 탭으로 옮겨 그림을 만들지 않았습니다.',
    made: '그림을 만들어 그 자리에 넣었습니다. 바꾸기 전 글은 작업 기록에 남겼습니다.',
    stopped: '그림 만들기를 멈췄습니다. 그림 자리는 그대로 두었습니다.',
    gone: '그림을 만드는 동안 그 그림 자리가 지워지거나 옮겨져 그림을 넣지 않았습니다. 다시 눌러 주세요.',
    lessonGone: '그림을 만드는 동안 이 차시를 지우거나 옮겼거나, 백업·PC 폴더를 불러와 내용이 바뀌어 그림을 넣지 않았습니다.',
    failed: '그림을 만들지 못했습니다. 그림 자리는 그대로 두었습니다. 설정의 이미지 생성 모델과 키를 확인한 뒤 다시 눌러 보세요.',
    gameFailed: title => `인터넷에서 '${title}' 게임 그림을 찾지 못했습니다. 그림 자리는 그대로 두었습니다.`,
    blocked: '그림 모델을 쓸 수 없어 그림을 만들지 못했습니다. 그림 자리는 그대로 두었습니다.',
    // 동영상·텍스트 블록 넣기(lesson-insert-tools.js)가 함께 쓰는 자리 검사(lessonBlockInsertPlan)
    blockEmpty: '넣을 글이 비어 있습니다.',
    blockFence: '코드 블록(```)이 닫히지 않았습니다. 닫는 ``` 줄을 더한 뒤 넣어 주세요.',
    blockInside: '여기에 넣으면 앞뒤의 목록·코드 블록과 섞여 따로 선 블록이 되지 않습니다. 다른 자리를 누르거나 글을 고쳐 주세요.',
    blockHidden: '학습 목표·개요와 첫 제목 바로 아래는 화면이 글을 정리해 보이는 곳이라 넣어도 보이지 않습니다. 다른 자리를 눌러 주세요.'
};

/* ---------- 검색어 ---------- */
// 원문 블록에서 보이는 글만 남긴다: 인라인 코드·그림·주석·HTML 태그·주소·마크다운 기호·(⏱ N분)을 걷어 낸다
function slotPlainText(raw) {
    return String(raw ?? '')
        .replace(/`[^`\n]*`/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/https?:\/\/\S+|local:[\w-]+/g, ' ')
        .replace(/\(\s*⏱[^)]*\)/g, ' ')
        .replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+[.)])[ \t]+/gm, '')
        .replace(/[*_~|#>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// 글의 영어 낱말 묶음. 앞뒤의 a·the 같은 낱말은 떼고, 같은 묶음은 한 번만
function slotEnglishTerms(text) {
    const seen = new Set();
    return [...String(text ?? '').matchAll(SLOT_ENGLISH)].map(match => {
        const words = match[0].split(/[ \t]+/);
        while (words.length && SLOT_STOPWORDS.has(words[0].toLowerCase())) words.shift();
        while (words.length && SLOT_STOPWORDS.has(words[words.length - 1].toLowerCase())) words.pop();
        return words.join(' ');
    }).filter(term => {
        const key = term.toLowerCase();
        if (term.replace(/[^A-Za-z]/g, '').length < 2 || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// 영어 묶음을 낱말 수 상한까지 잇는다
function slotEnglishKeyword(terms) {
    const words = [];
    for (const term of terms) {
        const next = term.split(' ');
        if (words.length && words.length + next.length > SLOT_KEYWORD_WORDS) break;
        words.push(...next.slice(0, SLOT_KEYWORD_WORDS - words.length));
        if (words.length >= SLOT_KEYWORD_WORDS) break;
    }
    return words.join(' ');
}

// 글을 낱말 경계에서 max자 안으로 자른다
function slotShortText(text, max = SLOT_KEYWORD_CHARS) {
    const clean = String(text ?? '').trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max + 1);
    const space = cut.lastIndexOf(' ');
    return (space > 0 ? cut.slice(0, space) : clean.slice(0, max)).trim();
}

// 제목 글에서 번호·이모지 같은 꾸밈을 뗀다(api.js autoInjectImageTags가 섹션 제목을 검색어로 쓰듯이)
const slotHeadingText = text => slotPlainText(text).replace(SLOT_HEADING_NUMBER, '').replace(/[^\p{L}\p{N}\s·:()-]/gu, ' ').replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').trim();

// 새 그림 자리의 검색어. 둘레 단락(text)과 그 위 제목(heading)에서 영어 낱말을 먼저 고르고(앱의 그림 자리처럼 짧은 영어),
// 없으면 제목 글, 단락 앞부분, 차시 제목(fallback) 순서로 쓴다. 표시를 깨는 글자는 뺀다(api.js imageSlotKeyword)
function imageSlotKeywordFor({ text = '', heading = '', fallback = '' } = {}) {
    const english = slotEnglishKeyword(slotEnglishTerms(slotPlainText(text))) || slotEnglishKeyword(slotEnglishTerms(slotPlainText(heading)));
    const korean = slotShortText(slotHeadingText(heading)) || slotShortText(slotPlainText(text)) || slotShortText(slotPlainText(fallback));
    return imageSlotKeyword(english || korean) || 'lesson illustration';
}

/* ---------- 넣을 자리(화면 블록 → 원문 위치) ---------- */
// 가리킨 블록의 글. 코드 블록 글은 검색어에 쓰지 않는다
const slotBlockText = block => (block && block.token.type !== 'code' && block.token.type !== 'space' ? block.raw : '');

// 넣을 자리 바로 위의 제목 글. 블록 뒤에 넣으면 그 블록까지, 앞에 넣으면 그 블록 앞까지 본다
function slotHeadingBefore(blocks, index, side) {
    for (let i = side === 'after' ? index : index - 1; i >= 0; i--) {
        if (blocks[i].token.type === 'heading') return blocks[i].token.text || '';
    }
    return '';
}

// 넣을 자리 둘레의 단락: 가리킨 블록. 제목 앞에 넣으면 그 자리는 앞 섹션 끝이라 바로 앞 블록을 본다
function slotNeighborText(blocks, index, side) {
    if (side !== 'before' || blocks[index].token.type !== 'heading') return slotBlockText(blocks[index]);
    for (let i = index - 1; i >= 0; i--) {
        if (blocks[i].index >= 0) return slotBlockText(blocks[i]);
    }
    return '';
}

// 줄바꿈을 \n으로 맞춘 글(lesson-format.js lessonBlocks)의 위치 → 원문 위치(\r\n은 한 글자로 센다)
function slotSourceOffset(source, at) {
    let i = 0;
    for (let n = 0; n < at && i < source.length; n++) i += source[i] === '\r' && source[i + 1] === '\n' ? 2 : 1;
    return i;
}

// 원문 at 자리(블록 경계)에 그림 자리 줄을 넣는다. 앞뒤를 빈 줄 하나씩으로 띄우고 원문의 줄바꿈(\r\n·\n)을 따른다. { text, at: 넣은 줄의 위치 }
function withImageSlotLine(source, at, tag) {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const head = source.slice(0, at).replace(/\s+$/, '');
    const tail = source.slice(at);
    const rest = tail.replace(/^(?:[ \t]*\r?\n)+/, '');
    const lead = head ? `${head}${eol}${eol}` : '';
    const end = rest ? `${eol}${eol}${rest}` : (/\n\s*$/.test(tail) ? eol : '');
    return { text: `${lead}${tag}${end}`, at: lead.length };
}

const slotTagBlocks = (blocks, tag) => blocks.filter(block => block.token.type === 'html' && block.raw.trim() === tag).length;

// 화면 블록(part: 두 번 눌러 고치기와 같은 { index, text, media, mediaKey })의 앞(side 'before')이나 뒤('after')에 그림 자리를 넣은 글.
// { ok: true, text, tag, keyword } 또는 { ok: false, reason }. 넣은 줄이 따로 선 그림 자리가 되지 않거나 화면이 숨기는 곳이면 넣지 않는다
function imageSlotPlan(source, part, side, { fallback = '' } = {}) {
    const text = String(source ?? '');
    const blocks = lessonBlocks(text);
    if (!blocks) return { ok: false, reason: SLOT_TEXT.odd };
    const located = locateLessonBlock(text, part);
    const index = located ? blocks.findIndex(block => block.start === located.start) : -1;
    if (index < 0) return { ok: false, reason: SLOT_TEXT.notFound };
    const where = side === 'before' ? 'before' : 'after';
    const block = blocks[index];
    const at = where === 'before' ? block.start : block.start + block.raw.trimEnd().length;
    const keyword = imageSlotKeywordFor({ text: slotNeighborText(blocks, index, where), heading: slotHeadingBefore(blocks, index, where), fallback });
    const tag = `<!-- [IMG: "${keyword}"] -->`;
    const placed = withImageSlotLine(text, slotSourceOffset(text, at), tag);
    const after = lessonBlocks(placed.text);
    if (!after || slotTagBlocks(after, tag) !== slotTagBlocks(blocks, tag) + 1) return { ok: false, reason: SLOT_TEXT.inside };
    if (!shownImageSlotTags(placed.text).some(item => item.start === placed.at)) return { ok: false, reason: SLOT_TEXT.hidden };
    return { ok: true, text: placed.text, tag, keyword };
}

/* ---------- 블록 넣기(동영상·텍스트 블록, lesson-insert-tools.js) ---------- */
// 보이는 블록 원문(빈 줄 토큰은 뺀다). 넣은 뒤 블록이 '앞 블록들 + 넣은 블록들 + 뒤 블록들' 그대로인지 견줄 때 쓴다
const slotShownRaws = blocks => blocks.filter(block => block.token.type !== 'space').map(block => block.raw.trim());
const slotSameList = (a, b) => a.length === b.length && a.every((item, i) => item === b[i]);
const slotSquash = text => String(text).replace(/\s+/g, ' ').trim();
// 화면에 보이는 글(첫머리 정리와 강사 안내 칸을 뺀 글, shownImageSlotTags와 같은 정리)
function slotShownText(text) {
    const opened = typeof cleanLessonOpening === 'function' ? cleanLessonOpening(text) : text;
    return typeof stripInstructorCallouts === 'function' ? stripInstructorCallouts(opened) : opened;
}
const slotCount = (text, part) => {
    let found = 0;
    for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + part.length)) found += 1;
    return found;
};

// 화면 블록(part)의 앞(side 'before')이나 뒤('after') 경계에 글(block: 마크다운 한 블록이나 여러 블록)을 빈 줄로 띄워 넣은 원문. { ok: true, text } 또는 { ok: false, reason }.
// 넣은 글이 앞뒤 블록과 섞이면(목록에 이어 붙음, 닫지 않은 코드 블록이 뒤를 삼킴 등) 넣지 않는다. 화면이 정리해 넣은 글 일부가 보이지 않는 곳(학습 목표·개요의 첫머리)도 넣지 않는다.
// 원문의 줄바꿈(\r\n·\n)을 따른다(넣는 글의 줄바꿈도 맞춘다)
function lessonBlockInsertPlan(source, part, side, block) {
    const text = String(source ?? '');
    const body = String(block ?? '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd();
    if (!body.trim()) return { ok: false, reason: SLOT_TEXT.blockEmpty };
    // 닫지 않은 코드 블록은 넣은 뒤의 글을 모두 코드로 삼킨다(글 끝에 넣어도 다음에 넣는 글을 삼킨다)
    if (typeof fenceStateAfter === 'function' && body.split('\n').reduce(fenceStateAfter, 0) > 0) return { ok: false, reason: SLOT_TEXT.blockFence };
    const blocks = lessonBlocks(text);
    const own = lessonBlocks(body);
    if (!blocks || !own) return { ok: false, reason: SLOT_TEXT.odd };
    const located = locateLessonBlock(text, part);
    const index = located ? blocks.findIndex(item => item.start === located.start) : -1;
    if (index < 0) return { ok: false, reason: SLOT_TEXT.notFound };
    const where = side === 'before' ? 'before' : 'after';
    const target = blocks[index];
    const at = where === 'before' ? target.start : target.start + target.raw.trimEnd().length;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const placed = withImageSlotLine(text, slotSourceOffset(text, at), body.replace(/\n/g, eol));
    const after = lessonBlocks(placed.text);
    const split = where === 'before' ? index : index + 1;
    const expected = [...slotShownRaws(blocks.slice(0, split)), ...slotShownRaws(own), ...slotShownRaws(blocks.slice(split))];
    if (!after || !slotSameList(slotShownRaws(after), expected)) return { ok: false, reason: SLOT_TEXT.blockInside };
    const visible = slotSquash(body);
    if (slotCount(slotSquash(slotShownText(placed.text)), visible) !== slotCount(slotSquash(slotShownText(text)), visible) + 1) return { ok: false, reason: SLOT_TEXT.blockHidden };
    return { ok: true, text: placed.text };
}

/* ---------- 화면에 보이는 그림 자리 ---------- */
// 원문에서 코드 블록(``` 펜스) 밖의 그림 자리 표시. 코드 줄은 같은 길이의 빈칸으로 덮고 찾아 위치(start)가 원문과 같다. { start, raw, fullMatch, keyword, game }
function slotTagsOutsideCode(text) {
    let fence = 0;
    const masked = text.split('\n').map(line => {
        const coded = fence > 0;
        fence = fenceStateAfter(fence, line);
        return coded || fence > 0 ? ' '.repeat(line.length) : line;
    }).join('\n');
    return [...masked.matchAll(IMAGE_TAG_RE)].map(match => ({ ...imageTagOf(match), raw: match[0], start: match.index }));
}

// 화면에 보이는 그림 자리 표시(원문 순서). 화면은 첫머리를 정리하고(lesson-opening.js cleanLessonOpening) 강사 안내 칸을 뺀(data.js stripInstructorCallouts) 글로 그린다.
// 표시마다 번호를 붙여 같은 정리를 돌려 보고 남는 번호만 고른다(api.js shownPlaceholderBlocks와 같은 방법)
function shownImageSlotTags(source) {
    const text = String(source ?? '');
    const tags = slotTagsOutsideCode(text);
    if (!tags.length) return [];
    let numbered = '';
    let from = 0;
    tags.forEach((tag, n) => {
        numbered += `${text.slice(from, tag.start)}<!-- [IMG: "teacher-slot-${n}"] -->`;
        from = tag.start + tag.raw.length;
    });
    numbered += text.slice(from);
    const opened = typeof cleanLessonOpening === 'function' ? cleanLessonOpening(numbered) : numbered;
    const shown = typeof stripInstructorCallouts === 'function' ? stripInstructorCallouts(opened) : opened;
    return [...String(shown).matchAll(SLOT_NUMBERED)].map(match => tags[Number(match[1])]).filter(Boolean);
}

// 보기 화면의 그림 자리 주석 노드(문서 순서, 안쪽 요소까지)
function imageSlotComments(root) {
    const found = [];
    const walk = node => {
        for (let child = node.firstChild; child; child = child.nextSibling) {
            if (child.nodeType === 8) {
                if (SLOT_COMMENT.test(child.data || '')) found.push(child);
            } else if (child.nodeType === 1) {
                walk(child);
            }
        }
    };
    if (root) walk(root);
    return found;
}

const slotLabel = text => (text.length > SLOT_LABEL_CHARS ? `${text.slice(0, SLOT_LABEL_CHARS)}…` : text);

// 아직 그림이 없는 그림 자리 칸(누르면 그림을 만든다). n: 화면의 그림 자리 표시 가운데 몇째인지, total: 그 수.
// 보이는 글은 CSS(::after, data-slot-label)로 그리고 칸에는 글자를 두지 않는다. 끌어 고른 글·두 번 눌러 고치기·서식 막대가 블록 글자로 원문을 찾을 때 섞이지 않게(코드 블록 이름표와 같다)
function pendingSlotButton(tag, n, total) {
    const name = tag.game ? '예시 게임 그림 자리' : '그림 자리';
    const label = `${name} · ${slotLabel(tag.game || tag.keyword)} · 누르면 그림을 만듭니다`;
    const button = document.createElement('button');
    button.setAttribute('type', 'button');
    button.className = 'image-slot-pending';
    button.setAttribute('data-image-slot', 'pending');
    button.setAttribute('data-lesson-action', 'fill-image-slot');
    button.setAttribute('data-slot-n', String(n));
    button.setAttribute('data-slot-total', String(total));
    button.setAttribute('data-slot-keyword', tag.keyword);
    button.setAttribute('data-slot-label', label);
    button.setAttribute('aria-label', label);
    button.title = tag.game ? '누르면 이 게임 그림을 위키백과에서 찾아 이 자리에 넣습니다' : '누르면 주변 글에 맞는 그림 1장을 만들어 이 자리에 넣습니다';
    button.innerHTML = '<i class="ph-bold ph-image-square" aria-hidden="true"></i>';
    return button;
}

// 그림을 못 만든 자리(api.js imagePlaceholderHtml) 전체를 누를 수 있게 덮개 버튼을 깐다. 그 자리의 '다시 검색'(요청을 직접 적는다)은 덮개 위에 둔다
function addPlaceholderFill(box) {
    const button = document.createElement('button');
    button.setAttribute('type', 'button');
    button.className = 'image-slot-fill';
    button.setAttribute('data-image-slot', 'placeholder');
    button.setAttribute('data-lesson-action', 'fill-image-slot');
    button.setAttribute('aria-label', '이 자리에 그림 만들기');
    button.title = "누르면 주변 글에 맞는 그림 1장을 만들어 이 자리에 넣습니다. 요청을 직접 적으려면 '다시 검색'을 누르세요";
    box.classList.add('relative');
    box.querySelectorAll('[data-lesson-action]').forEach(el => el.classList.add('relative', 'z-10'));
    box.insertBefore(button, box.firstChild);
}

// 보기 화면을 그린 뒤 부른다(api.js toggleEditorMode). 화면의 그림 자리 표시와 원문의 보이는 표시 수가 같을 때만 순서로 짝지어 칸을 단다(누른 칸을 원문에서 찾을 수 있게).
// 코드 블록 안 모양(코드 예제)과 이미 있는 그림을 가리키는 local: 자리에는 달지 않고, 문제은행 탭(학습이해도·심화이해도)에는 그림을 넣지 않아 달지 않는다
window.showImageSlots = function (view, mod) {
    if (!view || !mod) return;
    view.querySelectorAll('[data-image-slot]').forEach(el => el.remove());
    const tabId = typeof currentLessonTab !== 'undefined' ? currentLessonTab : 'basicLearn';
    if (mod.tabContents && isQuestionBankTab(tabId)) return;
    const source = storedTabMarkdown(mod, tabId);
    const comments = imageSlotComments(view);
    const shown = comments.length ? shownImageSlotTags(source) : [];
    if (comments.length && shown.length === comments.length) {
        comments.forEach((node, n) => {
            if (node.parentNode === view && usableImageTag(shown[n])) view.insertBefore(pendingSlotButton(shown[n], n, comments.length), node.nextSibling);
        });
    }
    const boxes = [...view.querySelectorAll('.image-placeholder')];
    if (boxes.length && shownPlaceholderBlocks(source).length === boxes.length) boxes.forEach(addPlaceholderFill);
};

/* ---------- 자리 고르기 ---------- */
let _slotPlacing = null; // { mod, tabId, marker, x, y }
let _slotDblClickUntil = 0;

// 자리를 고르는 차시·탭의 보기 화면. 다른 차시·탭으로 옮겼거나 보기 화면이 가려졌으면 null
function slotPlacingView(state) {
    const view = document.getElementById('render-view');
    return view && !view.classList.contains('hidden') && isViewingTab(state.mod, state.tabId) ? view : null;
}

// 넣을 곳으로 보는 곳: 교안 화면 안과 그 둘레 여백(바로 위 칸)
const slotArea = (view, target) => !!target && (view.contains(target) || target === view.parentElement);

// 넣을 자리로 고를 수 있는 화면 블록. 그림 자리 칸·단락 편집 상자·숨긴 블록과 높이가 없는 블록은 뺀다
function slotTargets(view) {
    return [...view.children].filter(el => !el.matches('[data-image-slot], .para-edit, .hidden'))
        .map(el => ({ el, rect: el.getBoundingClientRect() }))
        .filter(item => item.rect.height > 0);
}

// 포인터 높이(y)의 블록과 그 위('before')·아래('after'). 블록 사이 빈 곳이면 가까운 블록의 가까운 쪽. 블록이 없으면 null
function slotSpotAt(view, y) {
    const targets = slotTargets(view);
    if (!targets.length) return null;
    const inside = targets.find(item => y >= item.rect.top && y <= item.rect.bottom);
    if (inside) return { el: inside.el, rect: inside.rect, side: y < (inside.rect.top + inside.rect.bottom) / 2 ? 'before' : 'after' };
    const near = targets.map(item => ({ ...item, gap: y < item.rect.top ? item.rect.top - y : y - item.rect.bottom })).sort((a, b) => a.gap - b.gap)[0];
    return { el: near.el, rect: near.rect, side: y < near.rect.top ? 'before' : 'after' };
}

// 가리킨 화면 블록을 원문 블록과 짝지을 글(paragraph-edit.js와 같은 모양). 순서는 그림 자리 칸을 빼고 센다
function slotPart(view, el) {
    return {
        index: [...view.children].filter(child => !child.matches('[data-image-slot]')).indexOf(el),
        text: el.textContent || '',
        media: el.matches('img, video, table, svg, iframe') || !!el.querySelector('img, video, table, svg, iframe'),
        mediaKey: el.querySelector('[data-img-id]')?.getAttribute('data-img-id') || el.querySelector('[data-video-id]')?.getAttribute('data-video-id') || ''
    };
}

// kind: 무엇을 넣는지(아래 IMAGE_SLOT_KIND, lesson-insert-tools.js의 동영상·텍스트 블록). 표시 글과 아이콘을 그 이름으로 쓴다
function slotMarker(kind) {
    const marker = document.createElement('div');
    marker.id = 'image-slot-marker';
    marker.className = 'image-slot-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.innerHTML = `<div class="image-slot-marker-line"></div><div class="image-slot-marker-label"><i class="ph-bold ${escapeHtml(kind.icon)}" aria-hidden="true"></i> ${escapeHtml(kind.label)} <span class="image-slot-marker-where"></span></div>`;
    marker.style.display = 'none';
    document.body.appendChild(marker);
    return marker;
}

// 포인터 옆에 '그림 자리'를, 넣을 경계(가리킨 블록의 위나 아래)에 선을 그린다. 교안 밖이면 숨긴다
function drawSlotMarker(state, view, target) {
    const spot = slotArea(view, target) ? slotSpotAt(view, state.y) : null;
    const marker = state.marker;
    if (!spot) {
        marker.style.display = 'none';
        marker.removeAttribute('data-side');
        return;
    }
    const top = spot.side === 'before' ? spot.rect.top - SLOT_LINE_GAP : spot.rect.bottom + SLOT_LINE_GAP;
    Object.assign(marker.querySelector('.image-slot-marker-line').style, { top: `${Math.round(top)}px`, left: `${Math.round(spot.rect.left)}px`, width: `${Math.round(spot.rect.width)}px` });
    Object.assign(marker.querySelector('.image-slot-marker-label').style, { top: `${Math.round(state.y + SLOT_POINTER_GAP)}px`, left: `${Math.round(state.x + SLOT_POINTER_GAP)}px` });
    marker.querySelector('.image-slot-marker-where').textContent = spot.side === 'before' ? '· 이 블록 위에 넣기' : '· 이 블록 아래에 넣기';
    marker.setAttribute('data-side', spot.side);
    marker.style.display = 'block';
}

function onSlotMove(event) {
    const state = _slotPlacing;
    if (!state) return;
    const view = slotPlacingView(state);
    if (!view) return window.stopImageSlotPlacing();
    state.x = event.clientX;
    state.y = event.clientY;
    drawSlotMarker(state, view, event.target);
}

// 굴리면 같은 포인터 자리의 블록이 바뀐다
function onSlotScroll() {
    const state = _slotPlacing;
    const view = state && slotPlacingView(state);
    if (view && state.marker.style.display !== 'none') drawSlotMarker(state, view, document.elementFromPoint?.(state.x, state.y) || view);
}

// 누르는 동안 글자가 골라지지 않게 한다
function onSlotDown(event) {
    const state = _slotPlacing;
    const view = state && slotPlacingView(state);
    if (view && slotArea(view, event.target)) event.preventDefault();
}

function onSlotClick(event) {
    const state = _slotPlacing;
    if (!state || event.target?.closest?.('#lesson-tools-menu')) return; // 도구 메뉴는 그대로 쓴다(그림 자리 넣기를 다시 누르면 처음부터)
    const view = slotPlacingView(state);
    if (!view || !slotArea(view, event.target)) return window.stopImageSlotPlacing(); // 교안 밖을 누르면 그만둔다(그 클릭은 그대로 간다)
    event.preventDefault();
    event.stopPropagation();
    const spot = slotSpotAt(view, event.clientY);
    if (!spot) return;
    const kind = state.kind || IMAGE_SLOT_KIND;
    const run = async () => kind.place(state, view, spot); // 첫 await까지는 이 클릭 안에서 돈다(그림 자리 넣기와 같다)
    run().catch(err => {
        console.error(`[${kind.label}] 넣지 못했습니다:`, err);
        window.showToast?.(kind.failed || SLOT_TEXT.placeFailed, 'error');
    });
}

function cancelImageSlotPlacing() {
    const kind = _slotPlacing?.kind || IMAGE_SLOT_KIND;
    if (window.stopImageSlotPlacing()) window.showToast?.(kind.cancelled, 'info');
}

function onSlotMenu(event) {
    if (!_slotPlacing) return;
    event.preventDefault();
    cancelImageSlotPlacing();
}

function onSlotKey(event) {
    if (!_slotPlacing || event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    cancelImageSlotPlacing();
}

const SLOT_EVENTS = [['mousemove', onSlotMove], ['mousedown', onSlotDown], ['click', onSlotClick], ['contextmenu', onSlotMenu], ['keydown', onSlotKey], ['scroll', onSlotScroll]];

// 고른 경계에 그림 자리를 넣는다. 넣을 수 없는 자리면 까닭을 알리고 자리 고르기를 이어 간다(다른 자리를 누를 수 있게)
async function placeImageSlot(state, view, spot) {
    const { mod, tabId } = state;
    const before = storedTabMarkdown(mod, tabId);
    const plan = imageSlotPlan(before, slotPart(view, spot.el), spot.side, { fallback: mod.title || '' });
    if (!plan.ok) return window.showToast?.(plan.reason, 'warning');
    leaveSlotPlacing();
    const label = mod.tabContents ? reviewTabLabel(tabId) : '본문';
    if (!(await commitTabChange(mod, tabId, before, plan.text, `그림 자리 넣기 (${label})`, '그림 자리 넣기 전'))) return;
    window.recordLessonEdit?.(mod, tabId, before, plan.text);
    window.showToast?.(SLOT_TEXT.placed(plan.keyword), 'success');
}

// 고른 자리를 받았으니 자리 고르기를 끝낸다. 바로 뒤의 두 번 누르기는 단락 편집을 열지 않는다
function leaveSlotPlacing() {
    window.stopImageSlotPlacing();
    _slotDblClickUntil = Date.now() + SLOT_DBLCLICK_GUARD_MS;
}

// 그림 자리 넣기. place(state, view, spot): 고른 자리(spot: 가리킨 화면 블록 el과 그 위·아래 side)로 할 일. 넣을 수 없는 자리면 까닭을 알리고 자리 고르기를 이어 간다
const IMAGE_SLOT_KIND = { label: '그림 자리', icon: 'ph-image-square', start: SLOT_TEXT.start, noView: SLOT_TEXT.noView, cancelled: SLOT_TEXT.cancelled, failed: SLOT_TEXT.placeFailed, place: placeImageSlot };

// 자리 고르기를 시작한다. kind: 무엇을 넣는지({ label, icon, start, startType, noView, cancelled, failed, place }). 이미 고르는 중이면 처음부터
window.startLessonBlockPlacing = function (mod, tabId, kind = IMAGE_SLOT_KIND) {
    const view = document.getElementById('render-view');
    if (!view || view.classList.contains('hidden')) return window.showAlert(kind.noView);
    window.stopImageSlotPlacing();
    window.getSelection?.()?.removeAllRanges?.();
    _slotPlacing = { mod, tabId, kind, marker: slotMarker(kind), x: 0, y: 0 };
    SLOT_EVENTS.forEach(([type, handler]) => document.addEventListener(type, handler, true));
    document.body.classList.add('image-slot-placing');
    window.showToast?.(kind.start, kind.startType || 'info');
};

// 그림 자리 넣기의 자리 고르기(api.js insertImageSlot이 보기 화면에서 부른다)
window.startImageSlotPlacing = function (mod, tabId) {
    return window.startLessonBlockPlacing(mod, tabId, IMAGE_SLOT_KIND);
};
window.leaveLessonBlockPlacing = leaveSlotPlacing;

// 자리 고르기를 끝낸다. 고르는 중이었으면 true
window.stopImageSlotPlacing = function () {
    const state = _slotPlacing;
    if (!state) return false;
    _slotPlacing = null;
    SLOT_EVENTS.forEach(([type, handler]) => document.removeEventListener(type, handler, true));
    state.marker.remove();
    document.body.classList.remove('image-slot-placing');
    return true;
};

// 자리를 고르는 동안과 넣은 바로 뒤의 두 번 누르기는 단락 편집(paragraph-edit.js)을 열지 않는다
document.addEventListener?.('dblclick', event => {
    if (!_slotPlacing && Date.now() >= _slotDblClickUntil) return;
    event.preventDefault();
    event.stopPropagation();
}, true);

/* ---------- 눌러 그림 만들기 ---------- */
let _slotFilling = false; // 묻는 창을 띄운 동안 같은 칸을 또 누르면 다시 묻지 않는다

const slotOccurrences = (text, raw) => {
    const starts = [];
    for (let at = text.indexOf(raw); at !== -1; at = text.indexOf(raw, at + 1)) starts.push(at);
    return starts;
};

// 같은 글자의 자리 가운데 몇째인지 적어 둔다(만드는 동안 다른 곳이 바뀌어 위치가 밀려도 찾게)
function slotWithPlace(source, slot) {
    const starts = slotOccurrences(source, slot.raw);
    return { ...slot, count: starts.length, nth: starts.indexOf(slot.start) };
}

// 누른 칸의 그림 자리를 지금 원문에서 찾는다. { kind: 'tag' | 'placeholder', start, raw, keyword, game, count, nth } 또는 null
function clickedImageSlot(button, mod, tabId) {
    const source = storedTabMarkdown(mod, tabId);
    if (button.getAttribute('data-image-slot') === 'placeholder') {
        const box = button.closest('.image-placeholder');
        const block = box ? locateImagePlaceholder(source, box) : null;
        const keyword = String(box?.querySelector('[data-keyword]')?.getAttribute('data-keyword') || '').trim()
            || (box?.querySelector('span')?.textContent || '').replace(/^이미지 (?:영역|확보 실패):\s*/, '').trim();
        return block && keyword ? slotWithPlace(source, { kind: 'placeholder', start: block.start, raw: block.raw, keyword, game: gameImageTitle(keyword) }) : null;
    }
    const total = Number(button.getAttribute('data-slot-total'));
    const shown = shownImageSlotTags(source);
    const tag = shown[Number(button.getAttribute('data-slot-n'))];
    const view = document.getElementById('render-view');
    if (!view || shown.length !== total || imageSlotComments(view).length !== total || !usableImageTag(tag) || tag.keyword !== button.getAttribute('data-slot-keyword')) return null;
    return slotWithPlace(source, { kind: 'tag', start: tag.start, raw: tag.raw, keyword: tag.keyword, game: tag.game });
}

// 그림을 다 만든 때의 글에서 그 자리. 위치가 그대로면 그 자리, 같은 글자의 자리 수가 그대로면 같은 차례의 자리, 하나뿐이면 그 자리. 못 찾으면 -1
function relocateImageSlot(text, slot) {
    if (text.slice(slot.start, slot.start + slot.raw.length) === slot.raw) return slot.start;
    const starts = slotOccurrences(text, slot.raw);
    if (starts.length === slot.count && slot.nth >= 0) return starts[slot.nth];
    return starts.length === 1 ? starts[0] : -1;
}

function slotNonce(text) {
    let nonce = '';
    do nonce = Math.random().toString(36).slice(2, 10); while (!nonce || text.includes(nonce));
    return nonce;
}

// 그림 찾기에 넘길 글: 그 자리(at)만 그림 자리 표시로 두고 다른 그림 자리 표시(코드 블록 안 모양까지)는 잠시 다른 표시로 바꾼다.
// 그림을 못 만든 자리는 그 칸을 같은 검색어의 그림 자리 표시로 바꿔 넘긴다. restore로 바꿔 둔 표시를 되돌린다. at이 -1이면 모두 바꿔 둔다(채울 자리가 없다)
function slotWorkText(text, slot, at) {
    const tagText = slot.kind === 'placeholder' ? `<!-- [IMG: "${imageSlotKeyword(slot.keyword)}"] -->` : slot.raw;
    const body = at >= 0 ? text.slice(0, at) + tagText + text.slice(at + slot.raw.length) : text;
    const nonce = slotNonce(body);
    const held = [];
    const out = body.replace(new RegExp(IMAGE_TAG_RE.source, 'g'), (whole, keyword, offset) => {
        if (offset === at) return whole;
        held.push(whole);
        return `<!-- [IMG-HOLD ${nonce} ${held.length - 1}] -->`;
    });
    const back = new RegExp(`<!-- \\[IMG-HOLD ${nonce} (\\d+)\\] -->`, 'g');
    return {
        text: out,
        tag: imageTagOf(tagText.match(new RegExp(IMAGE_TAG_RE.source))),
        restore: value => String(value).replace(back, (whole, i) => held[Number(i)] ?? whole)
    };
}

// 그림을 넣지 못한 까닭의 알림 [글, 종류]
function slotMissText(run, stats, slot) {
    if (stats.gone) return [SLOT_TEXT.gone, 'warning'];
    if (run?.stopped || window.isTabGenerationStopped?.()) return [SLOT_TEXT.stopped, 'warning'];
    if (stats.failed) return slot.game ? [SLOT_TEXT.gameFailed(slot.game), 'warning'] : [SLOT_TEXT.failed, 'error'];
    return [SLOT_TEXT.blocked, 'warning'];
}

// 진행 막대 안의 일: 그 자리 하나를 일괄 이미지 찾기와 같은 길로 채우고, 그림을 만들었으면 바꾸기 전 글을 작업 기록에 남기고 넣는다
async function fillImageSlotJob(run, mod, tabId, slot) {
    const subj = globalState.subjects.find(s => s.id === currentSubjectId);
    const snapshot = storedTabMarkdown(mod, tabId);
    const at = relocateImageSlot(snapshot, slot);
    if (at < 0) return window.notifyLessonJobDone(SLOT_TEXT.gone, 'warning');
    const first = slotWorkText(snapshot, slot, at);
    const stats = { made: 0, failed: 0 };
    let base = snapshot;
    let work = first;
    const processed = await processImageTags(mod, first.text, {
        tags: [first.tag], amount: 'all', inject: false, quiet: true, stats, onStatus: window.setPipelineStatus,
        isStopped: () => !!window.isTabGenerationStopped?.() || !lessonStillLive(subj, mod),
        latest: () => {
            base = latestTabMarkdown(mod, tabId, snapshot);
            work = slotWorkText(base, slot, relocateImageSlot(base, slot));
            return work.text;
        }
    });
    if (!lessonStillLive(subj, mod)) return window.notifyLessonJobDone(SLOT_TEXT.lessonGone, 'warning');
    if (!stats.made) return window.notifyLessonJobDone(...slotMissText(run, stats, slot));
    const label = mod.tabContents ? reviewTabLabel(tabId) : '본문';
    if (await commitTabChange(mod, tabId, base, work.restore(processed), `그림 자리 채우기 (${label})`, '그림 만들기 전')) window.notifyLessonJobDone(SLOT_TEXT.made, 'success');
}

function slotConfirmText(slot) {
    if (slot.game) return `이 그림 자리에 예시 게임 '${slotLabel(slot.game)}'의 그림을 위키백과에서 찾아 넣습니다(AI 그림 모델을 쓰지 않습니다). 바꾸기 전 글은 작업 기록에 남깁니다.`;
    return `이 그림 자리(${slotLabel(slot.keyword)})에 맞는 그림 1장을 주변 글을 읽고 검색이나 AI로 만들어 이 자리에만 넣습니다. 바꾸기 전 글은 작업 기록에 남깁니다.`;
}

// 그림 자리 칸(data-lesson-action="fill-image-slot")을 눌렀다. 그림 1장의 비용·시간을 보이고 물은 뒤 진행 막대에서 그 자리만 채운다
window.fillImageSlot = async function (button) {
    if (_slotFilling) return;
    const mod = getEditingModule();
    const tabId = currentLessonTab;
    if (!mod || !isViewingTab(mod, tabId)) return;
    if (window.isLessonPipelineRunning?.()) return window.showAlert(SLOT_TEXT.busy);
    const slot = clickedImageSlot(button, mod, tabId);
    if (!slot) return window.showAlert(SLOT_TEXT.missing);
    _slotFilling = true;
    try {
        const work = slot.game ? { gameImages: 1 } : { images: 1 };
        if (!(await confirmWithEstimate(slotConfirmText(slot), work, { title: '그림 만들기', okLabel: '만들기', exactImages: true }))) return;
        if (!isViewingTab(mod, tabId)) return window.showToast?.(SLOT_TEXT.moved, 'warning');
    } finally {
        _slotFilling = false;
    }
    await window.runLessonJob(mod.id, { label: '그림 만들기', current: tabId, alerts: true }, async run => {
        try {
            await fillImageSlotJob(run, mod, tabId, slot);
        } catch (err) {
            console.error('[그림 자리] 그림을 만들지 못했습니다:', err);
            window.showAlert(`그림을 만들지 못했습니다. 그림 자리는 그대로 두었습니다.\n${err?.message || ''}`.trim());
        }
    });
};

if (typeof LESSON_ACTIONS !== 'undefined') LESSON_ACTIONS['fill-image-slot'] = button => window.fillImageSlot(button);

if (typeof window !== 'undefined') Object.assign(window, { imageSlotPlan, imageSlotKeywordFor, shownImageSlotTags, lessonBlockInsertPlan });
