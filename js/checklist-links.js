// checklist-links.js - 학습 후 체크리스트의 '(다시 보기: 섹션 제목)'에서 섹션 제목을 그 ## 제목으로 가는 링크로 그린다
// 저장한 마크다운은 바꾸지 않는다. 다시 보기를 글자로 읽는 곳(검수·학습 목표 세트·문제은행·교수안·교육 자료·분량 채우기·병합)이 많아서다.
// 그릴 때만 단다: 차시 화면·미리 보기·작업 기록(api.js renderLessonHTML)과 HTML·PDF 내보내기(lesson-export.js, 탭마다 id 앞말을 바꾼다).
// 그려서 다는 것이라 예전에 만든 교안에도 보인다. 섹션은 검수와 같은 규칙(lesson-lint.js lessonSectionKey·findLessonSection)으로 찾고, 찾지 못하면 글자로 둔다.
// 화면에서 누르면 그 제목으로 스크롤한다. 주소의 #은 바꾸지 않는다(바꾸면 화면 이동이 일어난다, ui.js handleRoute). 테스트: tests/lesson-info.test.js

const CHECK_LINK_CLASS = 'lesson-check-link';
const CHECK_LINK_ID = 'lesson-sec-'; // 제목에 다는 id 앞말. 내보내기는 탭마다 앞말을 더 붙인다(scopeChecklistLinks)
const CHECK_LINK_ID_RE = /^[\w-]{1,120}$/;
const CHECK_LINK_HEADING = /학습\s*후\s*체크리스트/;
const CHECK_LINK_REF = /다시\s*보기\s*[:：]\s*/;
const CHECK_LINK_END = /[)）]/;
const CHECK_LINK_SKIP = /^(?:A|CODE|PRE|SCRIPT|STYLE|TEXTAREA)$/; // 이 요소 안의 글은 링크로 바꾸지 않는다

/* ---------- 링크 달기 ---------- */
// 체크리스트 제목 뒤의 블록(다음 # · ## 제목 앞까지)
function checklistBlocks(heading) {
    const blocks = [];
    for (let node = heading.nextSibling; node; node = node.nextSibling) {
        if (node.nodeType !== 1) continue;
        if (/^H[12]$/.test(node.nodeName)) break;
        blocks.push(node);
    }
    return blocks;
}

// 다시 보기 글이 든 글자 마디(링크·코드 안은 뺀다)
function checklistRefNodes(block) {
    const found = [];
    const walk = node => {
        if (node.nodeType === 3) {
            if (CHECK_LINK_REF.test(node.nodeValue || '')) found.push(node);
        } else if (node.nodeType === 1 && !CHECK_LINK_SKIP.test(node.nodeName)) {
            Array.from(node.childNodes).forEach(walk);
        }
    };
    walk(block);
    return found;
}

// value의 from부터 닫는 괄호(없으면 끝) 앞까지에서 앞뒤 빈칸을 뺀 제목 자리. 제목이 비면 null
function checklistTitleRange(value, from) {
    const close = value.slice(from).search(CHECK_LINK_END);
    const raw = value.slice(from, close < 0 ? value.length : from + close);
    const title = raw.trim();
    if (!title) return null;
    const start = from + raw.length - raw.trimStart().length;
    return { start, end: start + title.length, title };
}

// 다시 보기 뒤 글자가 하나도 없으면 줄바꿈(<br>) 뒤 다음 글자 마디(이모지 앞 줄바꿈, api.js postprocessHtml)
function nextTextAfterBreaks(node) {
    let next = node.nextSibling;
    while (next && next.nodeType === 1 && next.nodeName === 'BR') next = next.nextSibling;
    return next && next.nodeType === 3 ? next : null;
}

// 링크로 바꿀 섹션 제목의 자리 { node, start, end, title }. 없으면 null
function checklistRefSpot(node) {
    const value = node.nodeValue;
    const ref = CHECK_LINK_REF.exec(value);
    const from = ref.index + ref[0].length;
    const own = checklistTitleRange(value, from);
    if (own) return { node, ...own };
    const next = value.slice(from).trim() ? null : nextTextAfterBreaks(node);
    const moved = next && checklistTitleRange(next.nodeValue, 0);
    return moved ? { node: next, ...moved } : null;
}

// 제목의 id. 이미 쓸 수 있는 id가 있으면 그것을, 없으면 lesson-sec-(제목 차례)를 단다
function checklistHeadingId(heading, index) {
    const own = heading.getAttribute('id') || '';
    if (CHECK_LINK_ID_RE.test(own)) return own;
    const id = `${CHECK_LINK_ID}${index + 1}`;
    heading.setAttribute('id', id);
    return id;
}

// 제목 자리의 글자를 링크로 감싼다. 링크 글자는 글자 마디로 넣는다(HTML로 읽지 않는다)
function wrapChecklistTitle(spot, id) {
    const { node } = spot;
    const doc = node.ownerDocument;
    const value = node.nodeValue;
    const link = doc.createElement('a');
    link.setAttribute('href', `#${id}`);
    link.setAttribute('class', CHECK_LINK_CLASS);
    link.appendChild(doc.createTextNode(value.slice(spot.start, spot.end)));
    node.parentNode.insertBefore(doc.createTextNode(value.slice(0, spot.start)), node);
    node.parentNode.insertBefore(link, node);
    node.nodeValue = value.slice(spot.end);
}

// root 안 첫 체크리스트(## 학습 후 체크리스트)의 다시 보기를 링크로 바꾼다. 단 링크 수
function linkChecklistIn(root) {
    const headings = Array.from(root.querySelectorAll('h2'));
    const checklist = headings.find(heading => CHECK_LINK_HEADING.test(heading.textContent || ''));
    if (!checklist) return 0;
    const keys = headings.map(heading => (heading === checklist ? '' : lessonSectionKey(heading.textContent)));
    let count = 0;
    checklistBlocks(checklist).flatMap(checklistRefNodes).forEach(node => {
        const spot = checklistRefSpot(node);
        const at = spot ? findLessonSection(keys, spot.title) : -1;
        if (at < 0) return;
        wrapChecklistTitle(spot, checklistHeadingId(headings[at], at));
        count += 1;
    });
    return count;
}

// 그린 교안 HTML에 다시 보기 링크를 단다. 체크리스트나 다시 보기가 없거나 찾은 섹션이 없으면 받은 글 그대로다
function linkChecklistReviews(html) {
    const text = String(html ?? '');
    const ready = typeof DOMParser !== 'undefined' && typeof findLessonSection === 'function' && typeof lessonSectionKey === 'function';
    if (!ready || !CHECK_LINK_REF.test(text) || !CHECK_LINK_HEADING.test(text)) return text;
    try {
        const doc = new DOMParser().parseFromString(`<!doctype html><body>${text}`, 'text/html');
        return linkChecklistIn(doc.body) ? doc.body.innerHTML : text;
    } catch (err) {
        console.warn('[체크리스트 링크] 링크를 달지 못해 글자로 둡니다:', err?.message || err);
        return text;
    }
}

/* ---------- 내보내기 ---------- */
// 내보낸 문서에 탭·차시가 여럿 들어가도 id가 겹치지 않게 이 파일이 단 id와 그 링크에 앞말(영문·숫자·-·_)을 붙인다. box: 그린 탭을 담은 요소
function scopeChecklistLinks(box, prefix) {
    const safe = String(prefix ?? '').replace(/[^\w-]/g, '');
    if (!box || !safe) return box;
    Array.from(box.querySelectorAll(`a.${CHECK_LINK_CLASS}`)).forEach(link => {
        const id = String(link.getAttribute('href') || '').slice(1);
        if (id.startsWith(CHECK_LINK_ID)) link.setAttribute('href', `#${safe}-${id}`);
    });
    Array.from(box.querySelectorAll(`[id^="${CHECK_LINK_ID}"]`)).forEach(el => el.setAttribute('id', `${safe}-${el.getAttribute('id')}`));
    return box;
}

/* ---------- 화면에서 누르기 ---------- */
// 링크가 가리키는 제목: 링크에서 위로 올라가며 그 id를 가진 요소를 찾는다(차시 화면·미리 보기 창 안에서 찾는다)
function checklistLinkTarget(link) {
    const id = String(link.getAttribute('href') || '').slice(1);
    if (!CHECK_LINK_ID_RE.test(id)) return null;
    for (let box = link.parentElement; box; box = box.parentElement) {
        const hit = box.querySelector(`[id="${id}"]`);
        if (hit) return hit;
    }
    return null;
}

// 누르면 주소는 그대로 두고 그 제목으로 스크롤한다. 링크(a)이므로 두 번 눌러 고치기(paragraph-edit.js)는 열리지 않는다
function onChecklistLinkClick(event) {
    const link = event.target?.closest?.(`a.${CHECK_LINK_CLASS}`);
    if (!link) return;
    event.preventDefault();
    checklistLinkTarget(link)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', onChecklistLinkClick);
