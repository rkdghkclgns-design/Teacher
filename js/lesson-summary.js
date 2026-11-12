// lesson-summary.js - 학습 탭 내용 섹션 끝의 핵심 요약 상자와 💡·⚠️·✅ 줄을 눈에 띄는 상자로 보이기
// 마크다운 모양: 새로 만드는 학습 탭(기본학습·심화학습)의 내용 ## 섹션마다 끝(다음 # · ## 제목 앞)에 하나(data.js CONTEXT_CORE.rules.section_summary)
//   > 📌 **핵심 요약**
//   > - 그 섹션의 핵심을 다시 말하는 짧은 문장(2~3줄, 새 사실 없음)
// 개요·학습 정보·학습 목표·학습 후 체크리스트, 첫머리와 # 제목 블록에는 두지 않는다. 최종 평가에도 두지 않는다.
// 1) 정리: 생성·분량 채우기·자동 수정 뒤 섹션마다 상자를 하나만 맨 끝(끝의 <br>·구분선 줄 앞)에 둔다(summaryBoxesLast). 다시 돌려도 같은 글이다.
//    이미 맨 끝에 하나뿐인 상자는 한 글자도 바꾸지 않고, 옮기는 상자도 줄을 그대로 옮긴다(그림·하위 목록 줄 포함). 상자가 둘 이상이면 항목을 합친다(겹친 항목은 하나, 상한 있음).
//    분량 채우기는 상자 앞에 새 소주제를 넣고(summaryTailStart, lesson-volume.js appendToSection), AI에게 보내고 받는 소주제에서는 상자를 뺀다(withoutSummaryBoxes).
//    섹션 고치기는 원래 섹션에 있던 상자를 지키고(빠뜨리면 되붙인다) 없던 상자는 더하지 않는다(keepSectionSummary, lesson-review.js settleFixText).
// 2) 그리기: 화면·미리 보기·HTML·PDF 내보내기의 HTML에 class만 붙인다(markLessonCallouts, api.js renderLessonHTML). 감싸지 않으므로 화면 블록 수가 마크다운
//    블록 수와 같다(두 번 눌러 고치기·접기·지우기 단추). 맨 위 블록(목록·접기·인용·표 안이 아닌 문단과 인용)만 보고, 코드 블록(<pre>)은 건드리지 않는다.
//    문제은행 탭(학습이해도·심화이해도)과 최종 평가는 상자로 그리지 않는다(lessonCalloutsFor: 정답·힌트 줄이 상자가 되지 않게).
//    그릴 때만 붙이므로 예전 교안의 💡·⚠️·✅ 줄도 상자로 보인다.
// 낭독 분량: 상자 글도 강사가 읽는 글로 센다(섹션을 정리하며 읽는 글이다. lesson-lint.js spokenText가 > 표시·목록 기호·이모지를 뺀다).
// 기대는 것: lesson-lint.js(nextCodeFence·LESSON_FRAME_TITLE·LESSON_OVERVIEW_TITLE), lesson-editor-tools.js(lockTitleKey, 고정 섹션). 테스트: tests/summary-box.test.js

const SUMMARY_LEARN_TABS = ['basicLearn', 'advLearn']; // lesson-lint.js LESSON_STRUCTURED_TABS와 같다
const SUMMARY_BANK_TABS = ['assessment', 'advAssessment']; // lesson-lint.js LESSON_BANK_TABS와 같다
const SUMMARY_MERGE_MAX = 5; // 상자를 합칠 때 남기는 항목 수(마지막 상자의 항목은 모두 남긴다)
const SUMMARY_HINT = /핵심[ \t]*요약/; // 상자가 없을 글은 줄로 나누지 않고 그대로 돌려준다
// 상자 머리 줄: > 뒤의 (📌) **핵심 요약**. 굵게·끝 콜론은 있어도 없어도 된다
const SUMMARY_HEAD_LINE = /^ {0,3}>[ \t]*(?:📌[ \t]*)?(?:\*\*|__)?[ \t]*(?:📌[ \t]*)?핵심[ \t]*요약[ \t]*(?:\*\*|__)?[ \t]*[:：]?[ \t]*(?:\*\*|__)?[ \t]*$/;
const SUMMARY_QUOTE_LINE = /^ {0,3}>/;
const SUMMARY_QUOTE_BLANK = /^ {0,3}>[ \t]*$/;
const SUMMARY_QUOTE_MARK = /^ {0,3}>[ \t]?/;
const SUMMARY_GAP_LINE = /^[ \t]*(?:<br\s*\/?>[ \t]*)*$/i; // 빈 줄과 <br> 간격 줄
const SUMMARY_TAIL_LINE = /^[ \t]*(?:(?:<br\s*\/?>[ \t]*)*|(?:[-*_][ \t]*){3,})$/i; // 섹션 끝에 상자 뒤로 남기는 간격·구분선 줄
const SUMMARY_ITEM_MARK = /^(?:[-*+•]|\d+[.)])[ \t]+/;
const SUMMARY_LEAD_ICON = /^(?:[\p{Extended_Pictographic}️‍][ \t]*)+/u;
const SUMMARY_MEDIA = /<!--|!\[|<\/?(?:img|video|iframe|table|div|figure)\b/i; // 교수안에 보낼 항목 글에서 뺄 그림·그림 자리·표 줄
const SUMMARY_SECTION_HEAD = /^(#{1,2})[ \t]+(.*)$/;
const SUMMARY_HEADING = /^#{1,6}[ \t]/;

// 줄 끝의 \r을 뗀 줄(윈도 줄바꿈 글을 줄로 나눠 받아도 같은 규칙으로 본다)
const bareLine = line => String(line ?? '').replace(/\r$/, '');
const quoteBody = line => bareLine(line).replace(SUMMARY_QUOTE_MARK, '');
const isSummaryItemLine = line => line != null && SUMMARY_QUOTE_LINE.test(bareLine(line)) && SUMMARY_ITEM_MARK.test(quoteBody(line));

/* ---------- 상자 찾기 ---------- */
// 상자가 끝나는 줄(다음 줄 번호). 머리 줄 뒤로 이어지는 > 줄이 상자이고, 상자가 아닌 첫 줄에서 끝난다:
// > 표시가 없는 줄, 다른 상자의 머리 줄, 항목이 나온 뒤의 빈 인용 줄(>) 다음이 목록 항목이 아닐 때(바로 붙은 다른 인용은 따로 둔다)
function summaryBoxEnd(lines, start) {
    let end = start + 1;
    let body = false;
    while (end < lines.length && SUMMARY_QUOTE_LINE.test(bareLine(lines[end])) && !SUMMARY_HEAD_LINE.test(bareLine(lines[end]))) {
        const blank = SUMMARY_QUOTE_BLANK.test(bareLine(lines[end]));
        if (blank && body && !isSummaryItemLine(lines[end + 1])) break;
        body = body || !blank;
        end += 1;
    }
    return end;
}

// 줄 목록에서 상자 자리 [{ start, end }](end는 상자 다음 줄). 코드 블록 안은 보지 않는다
function summaryBoxSpans(lines) {
    const spans = [];
    let fence = 0;
    for (let i = 0; i < lines.length; i += 1) {
        const line = bareLine(lines[i]);
        const wasFenced = fence;
        fence = nextCodeFence(fence, line);
        if (wasFenced || fence || !SUMMARY_HEAD_LINE.test(line)) continue;
        const end = summaryBoxEnd(lines, i);
        spans.push({ start: i, end });
        i = end - 1;
    }
    return spans;
}

// 상자의 항목: 목록 항목 줄과 그 아래 딸린 줄(하위 목록·이어 쓴 줄·그림)을 원래 줄 그대로 묶는다. 빈 인용 줄은 항목이 아니다
function summaryEntries(lines, span) {
    return lines.slice(span.start + 1, span.end).reduce((entries, line) => {
        if (!quoteBody(line).trim()) return entries;
        if (SUMMARY_ITEM_MARK.test(quoteBody(line)) || !entries.length) return [...entries, [line]];
        return [...entries.slice(0, -1), [...entries[entries.length - 1], line]];
    }, []);
}

// 항목을 견줄 글(빈칸·목록 기호를 뺀 글)
const summaryEntryKey = entry => entry.map(line => quoteBody(line).trim().replace(SUMMARY_ITEM_MARK, '')).join('').replace(/\s+/g, '');

// 여러 상자의 항목을 합친다: 마지막 상자의 항목은 모두, 앞 상자의 항목은 겹치지 않는 것만 상한까지 앞에 둔다(문서 순서)
function mergedSummaryEntries(boxes) {
    const keyed = entries => entries.map(entry => ({ entry, key: summaryEntryKey(entry) })).filter(item => item.key);
    const seen = new Set();
    const unique = items => items.filter(item => !seen.has(item.key) && !!seen.add(item.key));
    const tail = unique(keyed(boxes[boxes.length - 1].entries));
    const earlier = unique(boxes.slice(0, -1).flatMap(box => keyed(box.entries)));
    return [...earlier.slice(0, Math.max(0, SUMMARY_MERGE_MAX - tail.length)), ...tail].map(item => item.entry);
}

// 남길 상자 줄. 항목이 있는 상자가 하나면 그 상자 줄 그대로, 둘 이상이면 마지막 상자의 머리 줄에 합친 항목을 잇는다. 항목이 있는 상자가 없으면 빈 목록
function summaryBoxOf(lines, spans) {
    const boxes = spans.map(span => ({ span, entries: summaryEntries(lines, span) })).filter(box => box.entries.length);
    if (!boxes.length) return [];
    const last = boxes[boxes.length - 1];
    if (boxes.length === 1) return lines.slice(last.span.start, last.span.end);
    return [lines[last.span.start], ...mergedSummaryEntries(boxes).flat()];
}

/* ---------- 줄 다듬기 ---------- */
// 끝의 빈 줄을 떼어 둔다(섹션 사이 빈 줄은 그대로 되붙인다)
function splitTrailingBlank(lines) {
    let end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) end -= 1;
    return { body: lines.slice(0, end), blank: lines.slice(end) };
}

// 상자 줄을 뺀 줄. 상자 바로 뒤의 빈 줄은 앞 줄도 비었으면 함께 뺀다(빈 줄이 겹치지 않게. 상자 뒤 줄은 코드 블록 밖이다)
function dropSummarySpans(lines, spans) {
    const inBox = i => spans.some(span => i >= span.start && i < span.end);
    const afterBox = i => spans.some(span => span.end === i);
    return lines.reduce((out, line, i) => {
        if (inBox(i)) return out;
        if (afterBox(i) && !line.trim() && out.length && !out[out.length - 1].trim()) return out;
        return [...out, line];
    }, []);
}

// 끝의 간격·구분선 줄이 시작하는 자리(없으면 줄 수)
function summaryTailFrom(lines) {
    let at = lines.length;
    while (at > 0 && SUMMARY_TAIL_LINE.test(bareLine(lines[at - 1]))) at -= 1;
    return at;
}

function trimGapEnd(lines) {
    let end = lines.length;
    while (end > 0 && SUMMARY_GAP_LINE.test(bareLine(lines[end - 1]))) end -= 1;
    return lines.slice(0, end);
}

function trimBlankStart(lines) {
    let at = 0;
    while (at < lines.length && !lines[at].trim()) at += 1;
    return lines.slice(at);
}

// 상자 뒤 줄: 간격 줄(<br>)뿐이면 <br> 한 줄로 줄인다(상자를 뺀 자리에 남은 <br>이 겹치지 않게). 구분선이 있으면 그대로다
function summaryTail(lines) {
    const tail = trimBlankStart(lines);
    if (!tail.length || !tail.every(line => SUMMARY_GAP_LINE.test(bareLine(line)))) return tail;
    return tail.some(line => line.trim()) ? ['<br>'] : [];
}

// 상자 앞 간격: 본문이 있으면 <br> 한 줄(텍스트↔블록 간격), 제목 줄뿐이면 빈 줄만
function summaryGap(head) {
    if (!head.length) return [];
    return head.some(line => line.trim() && !SUMMARY_HEADING.test(line)) ? ['', '<br>', ''] : [''];
}

/* ---------- 상자를 맨 끝에 하나만 ---------- */
// 섹션(또는 조각) 줄에서 상자를 하나만 맨 끝에 둔 줄. keep이 거짓이면 상자를 모두 뺀다. 상자가 없으면 받은 줄 그대로다.
// 이미 맨 끝에 하나뿐인 상자는 받은 줄 그대로다. 옮길 때는 상자가 끝 블록이면 그 뒤의 간격·구분선 줄을,
// 아니면 섹션 끝의 간격·구분선 줄을 상자 뒤에 남기고, 상자 앞은 <br> 간격 하나다
function summaryLastLines(lines, keep = true) {
    const { body, blank } = splitTrailingBlank(lines);
    const spans = summaryBoxSpans(body);
    if (!spans.length) return lines;
    const box = keep ? summaryBoxOf(body, spans) : [];
    if (!box.length) return [...dropSummarySpans(body, spans), ...blank];
    const last = spans[spans.length - 1];
    const after = body.slice(last.end);
    const trailing = after.every(line => SUMMARY_TAIL_LINE.test(bareLine(line)));
    if (trailing && spans.length === 1) return lines;
    const kept = trailing ? dropSummarySpans(body.slice(0, last.start), spans) : dropSummarySpans(body, spans);
    const cut = trailing ? kept.length : summaryTailFrom(kept);
    return placeSummaryLast(kept.slice(0, cut), box, trailing ? after : kept.slice(cut), blank);
}

// 본문(content) 뒤에 <br> 간격 하나를 두고 상자를 놓고, 그 뒤에 간격·구분선 줄(tail)과 끝의 빈 줄(blank)을 잇는다
function placeSummaryLast(content, box, tailLines, blank = []) {
    const head = trimGapEnd(content);
    const tail = summaryTail(tailLines);
    return [...head, ...summaryGap(head), ...box, ...(tail.length ? ['', ...tail] : []), ...blank];
}

// 글을 # · ## 제목마다 블록으로 나눈다(코드 블록 안의 # 줄은 제목이 아니다). 첫 블록은 첫머리(제목 없음)다
function summaryBlocks(text) {
    const blocks = [{ level: 0, title: '', lines: [] }];
    let fence = 0;
    text.split('\n').forEach(line => {
        const wasFenced = fence;
        fence = nextCodeFence(fence, line);
        const head = !wasFenced && !fence && line.match(SUMMARY_SECTION_HEAD);
        if (head) blocks.push({ level: head[1].length, title: head[2].trim(), lines: [line] });
        else blocks[blocks.length - 1].lines.push(line);
    });
    return blocks.filter((block, i) => i > 0 || block.lines.length);
}

// 상자를 둘 내용 섹션: ## 제목이고 개요·학습 정보·학습 목표·학습 후 체크리스트가 아니다
function isSummarySection(block) {
    const title = block.title.replace(/\(\s*⏱[^)]*\)/g, ' ').trim();
    return block.level === 2 && !!title && !LESSON_FRAME_TITLE.test(title) && !LESSON_OVERVIEW_TITLE.test(title);
}

// 줄바꿈(\r\n·\n)을 지키며 \n 글로 다룬다
function withLineFeeds(md, fn) {
    const text = String(md ?? '');
    const crlf = text.includes('\r\n');
    const next = fn(crlf ? text.replace(/\r\n/g, '\n') : text);
    return crlf ? next.replace(/\n/g, '\r\n') : next;
}

// 학습 탭 글의 상자를 섹션마다 하나만 맨 끝에 둔다. 내용 ## 섹션에만 남기고 첫머리·# 제목 블록·개요·학습 정보·학습 목표·체크리스트의 상자는 뺀다.
// 고정 섹션(lockedBlocks)은 한 글자도 바꾸지 않는다. 학습 탭이 아니거나 상자가 없는 글은 받은 글 그대로다
function summaryBoxesLast(md, tabId = 'basicLearn', lockedBlocks = []) {
    const text = String(md ?? '');
    if (!SUMMARY_LEARN_TABS.includes(tabId) || !SUMMARY_HINT.test(text)) return text;
    const keyOf = title => (typeof lockTitleKey === 'function' ? lockTitleKey(title) : String(title).trim());
    const locked = new Set((Array.isArray(lockedBlocks) ? lockedBlocks : []).map(block => keyOf(block?.title ?? '')));
    return withLineFeeds(text, plainText => summaryBlocks(plainText)
        .map(block => (block.level === 2 && locked.has(keyOf(block.title)) ? block.lines : summaryLastLines(block.lines, isSummarySection(block))).join('\n'))
        .join('\n'));
}

// 상자를 모두 뺀 글(분량 채우기에 보내는 섹션과 받은 소주제, 최종 평가). 상자가 없으면 받은 글 그대로다
function withoutSummaryBoxes(md) {
    const text = String(md ?? '');
    if (!SUMMARY_HINT.test(text)) return text;
    return withLineFeeds(text, plainText => summaryLastLines(plainText.split('\n'), false).join('\n'));
}

// 섹션 줄에서 끝의 상자가 시작하는 줄 번호. 상자 뒤에 간격·구분선 줄만 있을 때만이고, 아니면 -1(분량 채우기는 이 자리 앞에 새 소주제를 넣는다).
// 줄 끝에 \r이 남은 줄(윈도 줄바꿈)도 같게 본다
function summaryTailStart(lines) {
    const list = Array.isArray(lines) ? lines : String(lines ?? '').split('\n');
    const spans = summaryBoxSpans(list);
    const last = spans[spans.length - 1];
    return last && list.slice(last.end).every(line => SUMMARY_TAIL_LINE.test(bareLine(line))) ? last.start : -1;
}

// 섹션 고치기가 받은 글(after)의 상자를 원래 글(before)에 맞춘다. 원래 글에 상자가 있었으면 하나만 맨 끝에 두고(빠뜨렸으면 원래 상자 줄을 그대로 되붙인다),
// 없었으면 AI가 더한 상자를 뺀다. 둘 다 상자가 없으면 받은 글 그대로다
function keepSectionSummary(before, after) {
    const text = String(after ?? '');
    const old = String(before ?? '').replace(/\r\n/g, '\n').split('\n');
    const oldSpans = summaryBoxSpans(old);
    return withLineFeeds(text, plainText => {
        const lines = plainText.split('\n');
        const has = summaryBoxSpans(lines).length > 0;
        if (!oldSpans.length) return has ? summaryLastLines(lines, false).join('\n') : plainText;
        if (has) return summaryLastLines(lines, true).join('\n');
        const box = summaryBoxOf(old, oldSpans);
        if (!box.length) return plainText;
        const { body, blank } = splitTrailingBlank(lines);
        const cut = summaryTailFrom(body);
        return placeSummaryLast(body.slice(0, cut), box, body.slice(cut), blank).join('\n');
    });
}

// 글 안 모든 상자의 항목 글(교수안·슬라이드가 핵심 메시지로 쓴다, gyosuan.js buildSectionPrompt). 그림·표 줄은 빼고 딸린 줄은 이어 붙인다
function summaryItemsOf(md) {
    const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
    const text = line => quoteBody(line).trim().replace(SUMMARY_ITEM_MARK, '').replace(SUMMARY_LEAD_ICON, '').trim();
    return summaryBoxSpans(lines).flatMap(span => summaryEntries(lines, span))
        .map(entry => entry.filter(line => !SUMMARY_MEDIA.test(line)).map(text).filter(Boolean).join(' '))
        .filter(Boolean);
}

/* ---------- 그리기: class만 붙인다 ---------- */
// 상자로 그려도 되는 탭인가: 문제은행 탭(학습이해도·심화이해도)과 최종 평가는 아니다(정답·힌트 줄이 상자가 되지 않게). 탭을 모르면 아니다
function lessonCalloutsFor(mod, tabId) {
    if (!tabId || mod?.id === 'mainQuest') return false;
    return !SUMMARY_BANK_TABS.includes(tabId);
}

// 맨 위 블록인지 셀 요소(이 안의 문단·인용은 상자로 그리지 않는다)와 문단
const CALLOUT_NEST_TAG = /<(\/?)(li|details|blockquote|table|div)\b[^>]*>|<p>/gi;
// marked가 그린 상자의 머리 문단: <p>📌 <strong>핵심 요약</strong></p>
const SUMMARY_HEAD_AHEAD = /^\s*<p>\s*(?:📌\s*)?(?:<(?:strong|b)>\s*)?(?:📌\s*)?핵심\s*요약\s*[:：]?\s*(?:<\/(?:strong|b)>)?\s*[:：]?\s*<\/p>/u;
// 💡(핵심)·⚠️(주의)·✅(확인)로 시작하는 문단. 속성이 없는 <p>만 본다(용어 문단 p.lesson-term 등은 그대로)
const CALLOUT_AHEAD = /^\s*(?:<(?:strong|b)>\s*)?(💡|⚠|✅)/u;
const CALLOUT_CLASS = { '💡': 'lesson-callout-key', '⚠': 'lesson-callout-warn', '✅': 'lesson-callout-check' };
const CALLOUT_PRE = /<pre\b[^>]*>[\s\S]*?<\/pre>/gi;
const CALLOUT_LOOK = 300; // 다음 글을 미리 볼 길이

// 그린 교안 HTML에 상자 class를 붙인다. 맨 위의 인용(<blockquote>)과 문단만 보고 목록·접기(<details>)·인용·표·<div> 안은 그대로 둔다.
// 코드 블록(<pre>)은 떼어 두었다가 그대로 되돌린다. 글자는 바꾸지 않는다
function markLessonCallouts(html) {
    const pres = [];
    const text = String(html ?? '').replace(CALLOUT_PRE, block => `\u0000SUMPRE${pres.push(block) - 1}\u0000`);
    let depth = 0;
    let head = false; // 상자로 표시한 인용의 머리 문단을 기다린다
    const marked = text.replace(CALLOUT_NEST_TAG, (tag, close, name, at, all) => {
        const ahead = all.slice(at + tag.length, at + tag.length + CALLOUT_LOOK);
        if (!name) {
            if (head) {
                head = false;
                return '<p class="lesson-summary-head">';
            }
            const icon = depth === 0 && (ahead.match(CALLOUT_AHEAD) || [])[1];
            return icon ? `<p class="lesson-callout ${CALLOUT_CLASS[icon]}">` : tag;
        }
        if (close) {
            depth = Math.max(0, depth - 1);
            return tag;
        }
        const summary = depth === 0 && tag.toLowerCase() === '<blockquote>' && SUMMARY_HEAD_AHEAD.test(ahead);
        depth += 1;
        if (!summary) return tag;
        head = true;
        return '<blockquote class="lesson-summary">';
    });
    return marked.replace(/\u0000SUMPRE(\d+)\u0000/g, (whole, i) => pres[Number(i)] ?? whole);
}

if (typeof window !== 'undefined') Object.assign(window, { summaryBoxesLast, withoutSummaryBoxes, keepSectionSummary, markLessonCallouts, lessonCalloutsFor });
