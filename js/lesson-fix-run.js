// lesson-fix-run.js - 섹션 고치기 실행: 코드 블록 자리 표시, 큰 섹션 나누기, 지적이 있는 곳을 차례로 고쳐 받기
// 컨벤션 검수의 'AI 수정 제안'과 생성 직후 자동 수정이 함께 쓴다(lesson-review.js requestSectionFix가 이 파일이 있으면 runSectionFix를 부른다).
// 1) 코드 블록: 고칠 글을 보내기 전에 닫힌 코드 블록(``` · ~~~, 목록 안에 들여쓴 블록 포함)을 자리 표시 줄 하나([[CODE-BLOCK-이름-번호]])로 바꾸고,
//    답을 받으면 원래 블록을 한 글자도 바꾸지 않고 되돌린다. AI는 코드를 보지 못하므로 고치지도 못한다(받은 글 정리 규칙도 코드에 닿지 않는다).
//    자리 표시가 빠지거나 겹치거나 바뀐 답은 까닭을 적어 한 번 더 받고, 그래도 어긋나면 빠진 블록만 원래 자리(바로 앞 줄이 그대로 남아 있을 때)에 다시 넣는다.
//    자리를 알 수 없으면 그 섹션은 반영하지 않는다. 마지막에는 지금까지처럼 keepsSectionCode가 원래 블록이 차례대로 남았는지 본다.
//    펜스를 고쳐야 하는 지적(이름표 적기·닫기)과 문항의 교차 검수 지적(정답을 드러내는 주석)이 있는 글은 코드를 보여 주는 예전 길로 간다(sectionCodeLeeway).
// 2) 큰 섹션: 보낼 글이 상한(REVIEW_FIX_MAX_CHARS)을 넘으면 ### 소주제에서 나누고(그래도 크면 문단 묶음), 지적이 있는 조각만 하나씩 보낸다. 고치지 않은 조각은 그대로다.
// 3) 차례: 필수 지적이 있는 곳부터 한 호출씩 부른다. 호출 상한(FIX_MAX_CALLS)·중지·오류로 남은 곳은 까닭과 함께 안내에 적는다(fixRunNote).
// 부를 때만 쓰는 다른 파일: lesson-review.js(fixSectionRows·buildFixPrompt·askSectionFix·mergeFixSections·settleFixText·applyFixOutcomes·fixTextShape·fixIssuePlaces·sectionCodeLeeway·insertSection),
//   lesson-editor-tools.js(mdSections·lockTitleKey·restoreLockedSections), lesson-lint.js(lintLessonMarkdown·lintCounts), code-comments.js(codeCommentBlocks·ccFenceAfter), data.js(fenceStateAfter), ai-errors.js(aiErrorStopsRun)
// 테스트: tests/fix-proposal.test.js

const FIX_MAX_CALLS = 12; // 'AI 수정 제안' 한 번에 쓰는 AI 호출 상한(다시 받기 포함). 넘은 곳은 안내에 적고, 반영한 뒤 다시 실행하면 이어서 고친다
const FIX_NAME_LIMIT = 6; // 안내에 적는 자리 이름 수
const FIX_CODE_HEAD = '[[CODE-BLOCK-';
const FIX_CODE_SHAPE = /\[\[CODE-BLOCK-[0-9a-z]+-\d+\]\]/g; // 자리 표시 꼴. 이름이 바뀐 자리 표시가 글에 남지 않았는지 볼 때 쓴다
const FIX_CODE_LINE = /^\[\[CODE-BLOCK-[0-9a-z]+-\d+\]\]$/;
const FIX_LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/;
const FIX_HTML_OPEN = /<(?:div|table|details|ul|ol|blockquote)\b/gi;
const FIX_HTML_CLOSE = /<\/(?:div|table|details|ul|ol|blockquote)>/gi;

/* ---------- 1. 코드 블록 자리 표시 ---------- */
// 이번 실행의 자리 표시 이름. 교안 글(md)에 없는 글자열만 쓴다(교안에 적힌 글이 자리 표시로 읽혀 코드로 바뀌지 않게)
function fixCodeToken(md) {
    const text = String(md ?? '');
    for (let tries = 0; ; tries += 1) {
        const token = `${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}${tries > 4 ? tries.toString(36) : ''}`;
        if (!text.includes(token)) return token;
    }
}

// 글(섹션·조각)의 닫힌 코드 블록을 자리 표시 줄로 바꾼다 → { sent(보낼 글), codes: [{ key(자리 표시), raw(여는 펜스부터 닫는 펜스까지 원래 줄) }] }.
// 자리 표시 줄은 여는 펜스의 들여쓰기를 따른다. 닫히지 않은 블록은 글 끝까지 코드라 그대로 둔다. from: 이번 실행에서 앞서 쓴 번호 수. 주석 모듈이 없으면 바꾸지 않는다
function shieldFixCode(text, token, from = 0) {
    const source = String(text ?? '');
    const lines = source.split('\n');
    const blocks = typeof codeCommentBlocks === 'function' ? codeCommentBlocks(source).filter(block => block.closeLine >= 0) : [];
    if (!blocks.length) return { sent: source, codes: [] };
    const codes = blocks.map((block, k) => ({ key: `${FIX_CODE_HEAD}${token}-${from + k + 1}]]`, raw: lines.slice(block.openLine, block.closeLine + 1) }));
    const opens = new Map(blocks.map((block, k) => [block.openLine, `${block.indent}${codes[k].key}`]));
    const hidden = new Set(blocks.flatMap(block => Array.from({ length: block.closeLine - block.openLine }, (_, k) => block.openLine + 1 + k)));
    return { sent: lines.flatMap((line, no) => (opens.has(no) ? [opens.get(no)] : hidden.has(no) ? [] : [line])).join('\n'), codes };
}

// 줄 전체가 자리 표시이면 그 자리 표시 글, 아니면 ''. AI가 덧붙이기 쉬운 꾸밈(양옆의 ` 와 *, 대괄호 앞의 \)은 벗겨 본다.
// 그 줄은 통째로 원래 블록으로 바뀌므로 꾸밈은 글에 남지 않는다
function fixCodeKeyOf(line) {
    const bare = String(line ?? '').trim().replace(/\\(?=[[\]])/g, '').replace(/^[`*]+|[`*]+$/g, '');
    return FIX_CODE_LINE.test(bare) ? bare : '';
}

// 자리 표시 줄을 원래 코드 블록으로 되돌린다. 줄 전체가 이번 실행의 자리 표시일 때만 바꾸고, 들여쓰기를 포함해 원래 줄을 그대로 쓴다
function restoreFixCode(text, codes) {
    if (!codes?.length) return String(text ?? '');
    const raws = new Map(codes.map(code => [code.key, code.raw]));
    return String(text ?? '').split('\n').flatMap(line => raws.get(fixCodeKeyOf(line)) || [line]).join('\n');
}

// 답(되돌리기 전 글)이 자리 표시를 지켰는가 → { ok, problem, keys }.
// problem: missing(빠졌다) · twice(두 번 넘게 나왔다) · moved(차례가 바뀌었다) · changed(다른 글과 한 줄에 섞였거나 번호·글자가 바뀌었다). keys: 빠졌거나 겹친 자리 표시
function fixCodeState(answer, codes, token) {
    const text = String(answer ?? '');
    const lines = text.split('\n').map(fixCodeKeyOf);
    const at = codes.map(code => lines.flatMap((line, no) => (line === code.key ? [no] : [])));
    const whole = at.reduce((sum, list) => sum + list.length, 0);
    const loose = text.split(token).length - 1 - whole; // 줄 전체가 자리 표시가 아닌 곳에 남은 이름
    const pick = test => codes.filter((code, k) => test(at[k])).map(code => code.key);
    const twice = pick(list => list.length > 1);
    const missing = pick(list => !list.length);
    const firsts = at.filter(list => list.length).map(list => list[0]);
    const moved = firsts.some((no, k) => k > 0 && no < firsts[k - 1]);
    const problem = loose > 0 ? 'changed' : twice.length ? 'twice' : moved ? 'moved' : missing.length ? 'missing' : '';
    return { ok: !problem, problem, keys: problem === 'twice' ? twice : problem === 'missing' ? missing : [] };
}

// 다시 부탁할 때 적는 까닭(lesson-review.js buildFixPrompt의 again)
function fixCodeProblemText({ problem, keys = [] }) {
    if (problem === 'missing') return `코드 블록 자리 표시 줄 ${keys.length}개(${keys.join(', ')})가 빠졌습니다.`;
    if (problem === 'twice') return `코드 블록 자리 표시 줄(${keys.join(', ')})이 두 번 넘게 나왔습니다.`;
    if (problem === 'moved') return '코드 블록 자리 표시 줄의 차례가 바뀌었습니다.';
    return '코드 블록 자리 표시 줄이 다른 글과 한 줄에 섞였거나 글자가 바뀌었습니다.';
}

// 되돌린 글에 자리 표시가 남았는가: 이번 실행의 이름이 남았거나, 원래 글(original)에 없던 자리 표시 꼴이 생겼다. 남은 글은 저장하지 않는다
function fixCodeLeftover(text, original, token) {
    const body = String(text ?? '');
    if (body.includes(token)) return true;
    const count = value => (String(value ?? '').match(FIX_CODE_SHAPE) || []).reduce((map, shape) => map.set(shape, (map.get(shape) || 0) + 1), new Map());
    const had = count(original);
    return [...count(body)].some(([shape, n]) => n > (had.get(shape) || 0));
}

// 빠진 자리 표시를 원래 자리에 다시 넣은 답(못 넣으면 null). shape: 보낸 글이 그대로 돌아왔을 때의 꼴(답과 같은 정리 규칙을 거친 글, lesson-review.js fixTextShape).
// 자리가 분명할 때만 넣는다: 보낸 글에서 그 자리 표시 바로 앞의 비지 않은 줄이 보낸 글에도 답에도 꼭 한 번씩 있다(글 맨 앞의 블록은 맨 앞에 넣는다).
// AI가 코드 펜스를 새로 써 넣은 답은 빠뜨린 자리에 다른 코드를 쓴 것일 수 있어 넣지 않는다(코드가 두 벌이 된다)
function refitFixCode(answer, shape, codes) {
    const sent = String(shape ?? '').split('\n');
    if (fixFenceCount(answer) > fixFenceCount(sent.join('\n'))) return null;
    const same = (list, text) => list.flatMap((line, no) => (line.trim() === text || fixCodeKeyOf(line) === text ? [no] : []));
    const fitted = codes.reduce((lines, code) => {
        if (!lines || same(lines, code.key).length) return lines;
        const [at] = same(sent, code.key);
        if (at === undefined) return null;
        const prev = sent.slice(0, at).map(line => !!line.trim()).lastIndexOf(true);
        const found = prev < 0 ? [-1] : same(lines, sent[prev].trim());
        if (found.length !== 1 || (prev >= 0 && same(sent, sent[prev].trim()).length !== 1)) return null;
        const where = found[0] + 1;
        const gap = prev < 0 ? [] : sent.slice(prev + 1, at); // 앞 줄과 자리 표시 사이의 빈 줄
        const tail = sent[at + 1] !== undefined && !sent[at + 1].trim() && (lines[where] || '').trim() ? [''] : [];
        return [...lines.slice(0, where), ...gap, sent[at], ...tail, ...lines.slice(where)];
    }, String(answer ?? '').split('\n'));
    return fitted ? fitted.join('\n') : null;
}

const fixFenceCount = text => (typeof codeCommentBlocks === 'function' ? codeCommentBlocks(String(text ?? '')).length : 0);

/* ---------- 2. 큰 섹션 나누기 ---------- */
// 줄마다 코드 펜스 안인지(여는·닫는 펜스 줄 포함). ``` 와 ~~~ 를 함께 따라간다(code-comments.js ccFenceAfter, 없으면 ``` 만)
function fixFencedLines(lines) {
    let fence = null;
    return lines.map(line => {
        const was = fence;
        fence = typeof ccFenceAfter === 'function' ? ccFenceAfter(fence, line) : (fenceStateAfter(fence || 0, line) || null);
        return !!(was || fence);
    });
}

// 상한보다 큰 조각(줄 배열)을 문단 묶음으로 나눈다 → 줄 배열의 배열. 빈 줄 다음의 글 줄에서만 자르고, 자르지 않는 곳:
// 코드 블록 안, 열려 있는 HTML 블록(<div>·<table>…) 안, 들여쓴 줄 앞(목록 항목에 딸린 글·코드), 이어지는 목록 항목 사이, 제목만 있는 첫머리 바로 뒤.
// 표는 빈 줄 없이 이어진 줄이라 나뉘지 않는다. 묶음은 상한을 넘지 않는 데까지 잇고, 나눌 곳이 없는 긴 문단은 그대로 한 묶음이다
function splitFixParagraphs(lines, limit) {
    const fenced = fixFencedLines(lines);
    const tags = (line, re) => (line.match(re) || []).length;
    let depth = 0; // 열려 있는 HTML 블록 수
    let body = false; // 제목이 아닌 글이 앞에 있었는가
    let listed = false; // 바로 앞의 비지 않은 줄이 목록 항목이거나 들여쓴 줄인가
    const cuts = lines.flatMap((line, no) => {
        const prose = !fenced[no];
        const cut = prose && !!line.trim() && no > 0 && !lines[no - 1].trim() && body && depth === 0 && !/^[ \t]/.test(line) && !(listed && FIX_LIST_LINE.test(line));
        if (prose) depth = Math.max(0, depth + tags(line, FIX_HTML_OPEN) - tags(line, FIX_HTML_CLOSE));
        if (line.trim()) {
            body = body || !prose || !/^#{1,6}\s/.test(line);
            listed = prose && (FIX_LIST_LINE.test(line) || /^[ \t]/.test(line));
        }
        return cut ? [no] : [];
    });
    let sum = 0;
    const ends = lines.map(line => (sum += line.length + 1)); // 그 줄 끝까지의 글자 수(줄바꿈 포함)
    const size = (from, to) => ends[to - 1] - (from ? ends[from - 1] : 0) - 1;
    const groups = [];
    let start = 0;
    let last = 0;
    [...cuts, lines.length].forEach(end => {
        if (last > start && size(start, end) > limit) {
            groups.push(lines.slice(start, last));
            start = last;
        }
        last = end;
    });
    return [...groups, lines.slice(start)];
}

// 큰 섹션 글을 조각 글로 나눈다(이어 붙이면('\n') 원래 글과 같다). ### 소주제 줄에서 자르고, 그래도 상한보다 큰 조각은 문단 묶음으로 자른다(splitFixParagraphs).
// 코드 블록 안의 ### 줄은 소주제가 아니다. 나눌 곳이 없으면 조각은 하나다
function splitFixChunks(text, limit) {
    const lines = String(text ?? '').split('\n');
    const fenced = fixFencedLines(lines);
    const heads = [0, ...lines.flatMap((line, no) => (no > 0 && !fenced[no] && /^###\s/.test(line) ? [no] : []))];
    return heads
        .map((start, k) => lines.slice(start, heads[k + 1] ?? lines.length))
        .flatMap(piece => (piece.join('\n').length > limit ? splitFixParagraphs(piece, limit) : [piece]))
        .map(piece => piece.join('\n'));
}

// 조각마다의 지적. 섹션 검사는 같은 말을 한 번만 지적하므로 조각 글을 따로 검사해, 그 섹션의 지적과 같은 종류(문항 지적은 같은 문항)만 고른다.
// 조각만 봐서는 나오지 않는 지적(섹션 전체를 보는 지적)은 근거 글(snip)이 든 조각에, 못 찾으면 첫 조각에 붙인다
function fixChunkHits(row, parts) {
    const asked = issue => /^문제 \d+/.test(String(issue.where || ''));
    const same = (hit, issue) => hit.msg === issue.msg && (!asked(hit) || hit.where === issue.where);
    const codeTopic = row.hits.some(hit => [LESSON_CODE_EXAMPLE_MSG, LESSON_LABEL_ISSUE, LESSON_UNCLOSED_ISSUE].includes(hit.msg));
    const found = parts.map(part => lintLessonMarkdown(part, undefined, { codeTopic, codeComments: false })
        .filter(issue => !issue.missing && row.hits.some(hit => same(hit, issue)))
        .map(issue => ({ ...issue, where: row.hits.find(hit => same(hit, issue)).where })));
    const squash = text => String(text ?? '').replace(/\s+/g, ' ');
    return row.hits.filter(hit => !found.some(list => list.some(issue => same(hit, issue)))).reduce((lists, hit) => {
        const at = Math.max(0, hit.snip ? parts.findIndex(part => squash(part).includes(squash(hit.snip))) : -1);
        return lists.map((list, k) => (k === at ? [...list, hit] : list));
    }, found);
}

// 조각 하나를 고칠 일. text: 조각의 원래 글(끝의 빈 줄 tail은 떼어 두었다가 되붙인다) · sent·codes: 자리 표시로 바꾼 글(guarded일 때) · label: 조각 첫 줄의 ### 소주제 이름
function fixChunkUnit(row, part, piece, raw, hits, guarded, codes, token) {
    const cut = text => {
        const lines = text.split('\n');
        const end = lines.map(line => !!line.trim()).lastIndexOf(true) + 1;
        return { body: lines.slice(0, end).join('\n'), tail: lines.slice(end) };
    };
    const { body, tail } = cut(raw);
    const sent = cut(piece).body;
    const mine = guarded ? codes.filter(code => sent.split('\n').some(line => line.trim() === code.key)) : [];
    const label = ((body.split('\n')[0].match(/^###\s+(.*)$/) || [])[1] || '').trim();
    return { kind: 'chunk', index: row.index, title: row.title, part, label, head: part === 0 && !!row.title, hits, text: body, tail, token, ...(mine.length ? { sent, codes: mine } : {}) };
}

const fixUnitTargets = unit => (unit.kind === 'chunk' ? [unit] : unit.targets);

// 고칠 일의 차례(units). 지적이 있는 섹션을 고정 섹션만 빼고 모두 넣는다:
// - 보낼 글(코드 블록은 자리 표시)이 상한 아래인 섹션은 상한까지 한 호출에 묶는다(kind 'sections'. 없는 섹션을 새로 쓰는 일은 첫 묶음 fresh가 맡는다)
// - 상한을 넘는 섹션은 조각으로 나눠 지적이 있는 조각만 하나씩 보낸다(kind 'chunk'). 나눌 곳이 없으면 통째로 한 호출이다
// 필수 지적이 있는 일을 앞에 둔다. 결과 { targets(고칠 섹션), locked(고정이라 뺀 섹션 수), deferred(0), units, parts(나눈 섹션의 조각 글), unplaced(어느 섹션인지 찾지 못한 지적) }
function planFixRun(md, issues, lockedBlocks = [], { quiz = false, token = '' } = {}) {
    const { rows, open, ordered } = fixSectionRows(md, issues, lockedBlocks);
    const guards = hits => {
        const leeway = sectionCodeLeeway({ hits }, quiz);
        return !(leeway.comments || leeway.labels || leeway.closing);
    };
    const planned = ordered.reduce((plan, row) => {
        const shield = shieldFixCode(row.text, token, plan.count);
        const guarded = guards(row.hits);
        const pieces = (guarded ? shield.sent : row.text).length > REVIEW_FIX_MAX_CHARS ? splitFixChunks(shield.sent, REVIEW_FIX_MAX_CHARS) : [];
        const count = plan.count + shield.codes.length;
        if (pieces.length > 1) {
            const raws = pieces.map(piece => restoreFixCode(piece, shield.codes));
            const chunks = fixChunkHits(row, raws).flatMap((hits, k) => (hits.length ? [fixChunkUnit(row, k, pieces[k], raws[k], hits, guards(hits), shield.codes, token)] : []));
            return { ...plan, count, chunks: [...plan.chunks, ...chunks], parts: new Map(plan.parts).set(row.index, raws) };
        }
        const target = { ...row, token, ...(guarded && shield.codes.length ? { sent: shield.sent, codes: shield.codes } : {}) };
        const size = (target.sent ?? target.text).length;
        const at = plan.batches.findIndex(batch => batch.size + size <= REVIEW_FIX_MAX_CHARS);
        const batches = at < 0
            ? [...plan.batches, { kind: 'sections', targets: [target], size }]
            : plan.batches.map((batch, k) => (k === at ? { ...batch, targets: [...batch.targets, target], size: batch.size + size } : batch));
        return { ...plan, count, batches };
    }, { count: 0, batches: [], chunks: [], parts: new Map() });
    const fresh = issues.some(issue => issue.missing) ? [{ kind: 'sections', targets: [], size: 0, ...planned.batches[0], fresh: true }] : planned.batches.slice(0, 1);
    const units = [...fresh, ...planned.batches.slice(1), ...planned.chunks];
    const urgent = unit => !!unit.fresh || lintCounts(fixUnitTargets(unit).flatMap(target => target.hits)).required > 0;
    return {
        targets: open, locked: rows.length - open.length, deferred: 0, parts: planned.parts,
        units: [...units.filter(urgent), ...units.filter(unit => !urgent(unit))],
        unplaced: issues.filter(issue => !issue.missing && !rows.some(row => row.hits.includes(issue)))
    };
}

/* ---------- 3. 차례로 고쳐 받기 ---------- */
// 조각 답에서 받을 글. 받지 않은 섹션 제목 줄을 덧붙인 답은 그 줄을 떼고, 다른 ## 섹션이 섞였거나 제목 줄이 빠진 답은 쓰지 않는다(null)
function fixChunkAnswer(unit, answer) {
    const text = String(answer ?? '');
    const lines = text.split('\n');
    const title = (lines[0].match(/^##\s+(.*)/) || [])[1];
    const extra = !unit.head && title !== undefined && lockTitleKey(title) === lockTitleKey(unit.title);
    const body = extra ? lines.slice(1).join('\n').trim() : text;
    const sections = mdSections(body);
    return sections.length === 1 && !!sections[0].title === !!unit.head ? body : null;
}

// 다음 곳도 같은 까닭으로 실패할 오류(하루 한도·키 문제·중지 신호). 남은 곳을 부르지 않는다
const fixRunHalts = err => err?.name === 'AbortError' || !!err?.noRetry || (typeof aiErrorStopsRun === 'function' && aiErrorStopsRun(err));

// 안내에 적을 결과 한 줄: { status, index, title, where(지적 자리), chunk(조각인가), label(조각의 소주제 이름), error }
const fixOutcomeRecord = ({ target, status, error = '' }) => ({ status, index: target.index, title: target.title, where: fixIssuePlaces(target), chunk: target.kind === 'chunk', label: target.label || '', error });

// 지적이 있는 곳을 차례로 고쳐 받는다 → { text, plan, dropped(코드 블록을 바꿔 반영하지 않은 곳), report: { outcomes, added(새로 쓴 섹션 수), wanted(없다고 지적된 섹션), calls, maxCalls, unplaced } }.
// outcomes의 status: applied · same · cut · code · holder · absent · split(lesson-review.js settleFixText·mergeFixSections) · error(답을 받지 못했다) · stop(중지) · cap(호출 상한)
// onStatus({ no, total, again }): 호출마다 알린다(again: 자리 표시를 지키지 않아 다시 받는 호출) · isStopped: 참이면 다음 곳부터 부르지 않는다(받은 것은 남는다)
// maxCalls: 다시 받기를 포함한 호출 상한 · maxUnits: 고칠 곳 수 상한(자동 수정은 한 회차에 한 곳). 하나도 고치지 못했고 오류가 있었으면 그 오류를 던진다
async function runSectionFix({ tabId, md, issues, lockedBlocks = [], onRetry = null, quiz = false, onStatus = null, isStopped = () => false, maxCalls = FIX_MAX_CALLS, maxUnits = Infinity }) {
    const token = fixCodeToken(md);
    const plan = planFixRun(md, issues, lockedBlocks, { quiz, token });
    const total = Math.min(plan.units.length, maxUnits, maxCalls); // 진행 글에 보일 고칠 곳 수
    let doc = mdSections(md);
    let parts = plan.parts;
    let added = [];
    let outcomes = [];
    let calls = 0;
    let failure = null; // 처음 난 오류
    let halted = null; // 남은 곳을 부르지 않게 한 오류
    const ask = wording => {
        calls += 1;
        return askSectionFix({ tabId, quiz, onRetry }, wording);
    };
    const failed = err => {
        failure = failure || err;
        halted = halted || (fixRunHalts(err) ? err : null);
    };
    const shaped = target => ({ ...target, shape: fixTextShape(target.sent ?? target.text) });

    // 자리 표시를 지키지 않은 답(first): 호출이 남았으면 까닭을 적어 한 번 더 받고, 그래도 어긋나면 빠진 블록만 원래 자리에 다시 넣어 본다.
    // wording(까닭): 다시 보낼 지시 글 · read(답): 그 대상의 답 글(없으면 null)
    const settleAgain = async (target, first, state, step, wording, read) => {
        if (!target.codes?.length) return { status: 'holder' }; // 자리 표시를 보내지 않은 글에 다른 곳의 자리 표시가 섞였다. 다시 부탁할 자리 표시가 없다
        let answers = [first];
        let problem = state;
        if (calls < maxCalls && !halted) {
            onStatus?.({ ...step, again: true });
            try {
                const second = read(await ask(wording(fixCodeProblemText(problem))));
                const settled = second === null ? null : settleFixText(target, second, quiz);
                if (settled && settled.status !== 'holder') return { ...settled, answer: second };
                if (settled) [answers, problem] = [[second, first], settled.problem];
            } catch (err) {
                failed(err);
            }
        }
        const refit = answers.map(answer => refitFixCode(answer, target.shape, target.codes)).filter(text => text !== null)
            .map(text => ({ ...settleFixText(target, text, quiz), answer: text })).find(settled => settled.status !== 'holder');
        // 빠뜨린 자리에 코드를 새로 써 넣은 답은 코드 블록을 바꾼 답이다
        return refit || { status: problem.problem === 'missing' && fixFenceCount(answers[0]) > fixFenceCount(target.shape) ? 'code' : 'holder' };
    };

    const runSections = async (unit, step) => {
        const targets = unit.targets.map(shaped);
        const scoped = unit.fresh ? issues : issues.filter(issue => !issue.missing);
        // 다시 받을 때는 그 섹션만 보내고, 없는 섹션을 새로 쓰는 일은 다시 시키지 않는다
        const wording = (list, again = '') => buildFixPrompt(md, again ? scoped.filter(issue => !issue.missing) : scoped, { targets: list }, lockedBlocks, { quiz, again });
        const merged = mergeFixSections(doc, await ask(wording(targets)), targets, !!unit.fresh, { quiz });
        // 새로 쓴 섹션에 자리 표시를 옮겨 적었으면 그 섹션은 받지 않는다(자리 표시가 저장되는 글에 남지 않게)
        added = [...added, ...merged.added.filter(section => !fixCodeLeftover(section.text, '', token))];
        const settled = [];
        for (const outcome of merged.outcomes) {
            const read = answer => mergeFixSections(doc, answer, [outcome.target], false, { quiz }).outcomes[0].answer ?? null;
            settled.push(outcome.status === 'holder'
                ? { target: outcome.target, ...(await settleAgain(outcome.target, outcome.answer, outcome.problem, step, reason => wording([outcome.target], reason), read)) }
                : outcome);
        }
        doc = applyFixOutcomes(doc, settled);
        return settled;
    };

    const runChunk = async (unit, step) => {
        const target = shaped(unit);
        const wording = (again = '') => buildFixPrompt(md, target.hits, { targets: [target] }, lockedBlocks, { quiz, part: target, again });
        const read = answer => fixChunkAnswer(target, answer);
        const first = read(await ask(wording()));
        const settled = first === null ? { status: 'absent' } : { ...settleFixText(target, first, quiz), answer: first };
        const done = settled.status === 'holder' ? await settleAgain(target, first, settled.problem, step, wording, read) : settled;
        if (done.status === 'applied') {
            const list = parts.get(target.index).map((part, k) => (k === target.part ? [done.text, ...target.tail].join('\n') : part));
            parts = new Map(parts).set(target.index, list);
            doc = doc.map((section, index) => (index === target.index ? { ...section, text: list.join('\n') } : section));
        }
        return [{ target, ...done }];
    };

    for (let k = 0; k < plan.units.length; k += 1) {
        const unit = plan.units[k];
        const skip = halted ? 'error' : k > 0 && isStopped() ? 'stop' : k >= maxUnits || calls >= maxCalls ? 'cap' : '';
        const step = { no: k + 1, total, again: false };
        try {
            if (skip) {
                outcomes = [...outcomes, ...fixUnitTargets(unit).map(target => ({ target, status: skip, error: skip === 'error' ? halted.message : '' }))];
            } else {
                onStatus?.(step);
                outcomes = [...outcomes, ...(unit.kind === 'chunk' ? await runChunk(unit, step) : await runSections(unit, step))];
            }
        } catch (err) {
            failed(err);
            outcomes = [...outcomes, ...fixUnitTargets(unit).map(target => ({ target, status: 'error', error: err.message }))];
        }
    }

    const changed = added.length > 0 || outcomes.some(outcome => outcome.status === 'applied');
    if (!changed && failure) throw failure;
    const merged = changed ? restoreLockedSections(added.reduce(insertSection, doc).map(section => section.text).join('\n\n'), lockedBlocks) : md;
    // 마지막 확인: 자리 표시가 남은 글은 어떤 경우에도 돌려주지 않는다
    const leaked = merged.includes(token);
    const records = outcomes.map(fixOutcomeRecord).map(record => (leaked && record.status === 'applied' ? { ...record, status: 'holder' } : record));
    return {
        text: leaked ? md : merged, plan,
        dropped: records.filter(record => record.status === 'code').map(({ title, where }) => ({ title, where })),
        report: { outcomes: records, added: leaked ? 0 : added.length, wanted: issues.filter(issue => issue.missing).map(issue => issue.where), calls, maxCalls, unplaced: plan.unplaced }
    };
}

/* ---------- 4. 안내 글 ---------- */
// 미리보기 안내: 고친 것, 그리고 고치지 못한 곳마다 까닭과 다음에 할 일. 있는 것만 잇는다
function fixRunNote(plan, report) {
    const of = (...statuses) => report.outcomes.filter(outcome => statuses.includes(outcome.status));
    const name = outcome => (outcome.chunk && outcome.label ? [`${outcome.title || '본문'} › ${outcome.label}`] : outcome.where);
    const names = list => {
        const all = [...new Set(list.flatMap(name))];
        return all.length > FIX_NAME_LIMIT ? `${all.slice(0, FIX_NAME_LIMIT).join(', ')} 외 ${all.length - FIX_NAME_LIMIT}곳` : all.join(', ');
    };
    const who = list => (list.every(outcome => !outcome.chunk) ? `섹션 ${list.length}개(${names(list)})는` : `${list.length}곳(${names(list)})은`);
    const line = (list, text) => (list.length ? text(who(list)) : '');
    const applied = of('applied');
    const pieces = applied.filter(outcome => outcome.chunk);
    const failed = of('error');
    const unplaced = report.unplaced || [];
    return [
        applied.length > pieces.length ? `지적이 있는 섹션 ${applied.length - pieces.length}개를 고쳤습니다.` : '',
        pieces.length ? `분량이 많은 섹션 ${new Set(pieces.map(outcome => outcome.index)).size}개는 지적이 있는 부분 ${pieces.length}곳만 나눠 고쳤습니다.` : '',
        report.added ? `없던 섹션 ${report.added}개를 새로 썼습니다.` : '',
        !report.added && report.wanted?.length ? `없는 섹션(${[...new Set(report.wanted)].join(', ')})은 새로 쓰지 못했습니다. 다시 실행해 주세요.` : '',
        plan.locked ? `고정 섹션 ${plan.locked}개는 고치지 않았습니다.` : '',
        line(of('stop'), at => `중지해서 ${at} 고치지 않았습니다. 다시 실행하면 이어서 고칩니다.`),
        line(of('cap'), at => `한 번에 쓰는 AI 호출 ${report.maxCalls}번을 다 써서 ${at} 이번 제안에서 뺐습니다. 반영한 뒤 다시 실행하면 이어서 고칩니다.`),
        line(of('code'), at => `코드 블록을 바꾼 답이라 ${at} 반영하지 않았습니다. 코드 블록 안을 고칠 지적은 원문에서 고칩니다.`),
        line(of('holder'), at => `코드 블록 자리를 지키지 않은 답이라 ${at} 반영하지 않았습니다. 다시 실행하거나 원문에서 직접 고쳐 주세요.`),
        line(of('cut'), at => `내용이 줄었거나 소주제·그림이 빠진 답이라 ${at} 반영하지 않았습니다. 다시 실행해 주세요.`),
        line(of('absent', 'split'), at => `AI 답에서 고칠 글을 찾지 못해 ${at} 반영하지 않았습니다. 다시 실행해 주세요.`),
        line(of('same'), at => `AI가 고치지 않고 그대로 돌려주어 ${at} 바뀌지 않았습니다. 다시 실행하거나 원문에서 직접 고쳐 주세요.`),
        line(failed, at => `AI 답을 받지 못해 ${at} 고치지 못했습니다(${failed[0].error}). 잠시 뒤 다시 실행해 주세요.`),
        unplaced.length ? `고칠 섹션을 찾지 못한 지적 ${unplaced.length}건(${[...new Set(unplaced.map(issue => issue.where || '본문'))].join(', ')})은 AI 수정 제안으로 고치지 못합니다. 원문에서 직접 고쳐 주세요.` : ''
    ].filter(Boolean).join(' ');
}
