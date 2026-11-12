// lesson-info.js - 새로 만든 학습 탭(기본학습·심화학습)의 첫머리를 개요 → 학습 정보 → 학습 목표 차례로 둔다
// 학습 정보는 AI가 쓰지 않고 차시 메타데이터(차시 시간 hours, 선행 차시 prereqs, 사용 툴과 버전 tools)로 코드가 쓴다.
// 탭 생성(tabs.js generateTabContent: 한 탭·전체 생성·탭 모두 다시 만들기·일괄 생성)·교안 전체 생성(api.js generateModuleContent)·병합(merge.js)이
// 글을 마무리할 때(자동 수정·분량 채우기·코드 주석 뒤) 부른다. 저장해 둔 예전 탭은 바꾸지 않고, 예전 차례(학습 목표 → 개요)의 탭도 다른 기능이 그대로 읽는다.
// 섹션 나누기와 첫머리 섹션 알아보기는 lesson-opening.js(openingSections·isOverviewSection·isInfoSection·isGoalSection)를 쓴다. 테스트: tests/lesson-info.test.js

const LESSON_INFO_HEADING = '## 학습 정보';
const LESSON_INFO_TABS = ['basicLearn', 'advLearn'];
const LESSON_INFO_URL_BAD = /[\s"'<>()`\\]/; // 링크 주소에 두지 않는 글자(마크다운 링크를 끊거나 속성 밖으로 나간다)
const LESSON_INFO_URL_MAX = 2000;
// 흔한 툴의 공식 페이지(https). 이름이 같거나 이름 뒤에 버전(숫자·v숫자)만 붙었으면 그 툴로 본다. 위에서부터 찾는다(Visual Studio Code가 Visual Studio보다 먼저)
const LESSON_INFO_TOOL_PAGES = [
    { names: ['visual studio code', 'vs code', 'vscode'], url: 'https://code.visualstudio.com/' },
    { names: ['visual studio'], url: 'https://visualstudio.microsoft.com/' },
    { names: ['unity'], url: 'https://unity.com/' },
    { names: ['unreal engine', 'unreal'], url: 'https://www.unrealengine.com/' },
    { names: ['python'], url: 'https://www.python.org/' },
    { names: ['node.js', 'nodejs', 'node'], url: 'https://nodejs.org/' },
    { names: ['git'], url: 'https://git-scm.com/' },
    { names: ['blender'], url: 'https://www.blender.org/' },
    { names: ['godot engine', 'godot'], url: 'https://godotengine.org/' },
    { names: ['intellij idea', 'intellij'], url: 'https://www.jetbrains.com/idea/' },
    { names: ['android studio'], url: 'https://developer.android.com/studio' },
    { names: ['eclipse'], url: 'https://www.eclipse.org/' }
];

// 학습 정보를 쓰는 탭인가: 기본학습·심화학습(최종 평가는 아니다)
const lessonInfoApplies = (mod, tabId) => !!mod && mod.id !== 'mainQuest' && LESSON_INFO_TABS.includes(tabId);

/* ---------- 학습 정보 줄 ---------- */
// 차시 시간(시간 단위) → '1시간', '1시간 30분', '45분'. 시간을 모르면 ''
function lessonInfoHours(hours) {
    if (typeof hours !== 'number' && typeof hours !== 'string') return '';
    const minutes = Math.round(Number(hours) * 60);
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    const whole = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return [whole ? `${whole}시간` : '', rest ? `${rest}분` : ''].filter(Boolean).join(' ');
}

// 마크다운에 글자로 넣는다: 줄바꿈은 빈칸 하나로, &·<·>는 글자 참조로, 서식 기호(\ ` * _ [ ] ~)는 \로 막는다
function lessonInfoText(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim()
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/([\\`*_[\]~])/g, '\\$1');
}

// https 주소만 받는다(계정을 적었거나 빈칸·따옴표·괄호가 든 주소는 받지 않는다). 받으면 정리한 주소, 아니면 ''
function lessonInfoUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw || raw.length > LESSON_INFO_URL_MAX || LESSON_INFO_URL_BAD.test(raw)) return '';
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' && url.hostname && !url.username && !url.password && !LESSON_INFO_URL_BAD.test(url.href) ? url.href : '';
    } catch (err) {
        return '';
    }
}

const lessonInfoToolKey = name => String(name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

// 이름으로 찾은 공식 페이지. 이름이 같거나 이름 뒤에 버전만 붙었으면('Visual Studio 2022', 'Python3') 그 툴로 본다. 없으면 ''
function lessonInfoToolPage(name) {
    const key = lessonInfoToolKey(name);
    const fits = known => key.startsWith(known) && (key.length === known.length || /^\s*v?\d/.test(key.slice(known.length)));
    return (key && LESSON_INFO_TOOL_PAGES.find(page => page.names.some(fits))?.url) || '';
}

const lessonInfoField = value => (typeof value === 'string' ? value.trim() : '');

// 툴 하나: [이름 버전](주소) 또는 이름 버전. 주소는 차시 정보에 적은 https 주소, 없거나 받을 수 없으면 흔한 툴의 공식 페이지. 이름이 없으면 ''
function lessonInfoTool(tool) {
    const name = lessonInfoField(tool?.name);
    if (!name) return '';
    const label = lessonInfoText([name, lessonInfoField(tool.version)].filter(Boolean).join(' '));
    const url = lessonInfoUrl(tool.url) || lessonInfoToolPage(name);
    return url ? `[${label}](${url})` : label;
}

// 그 차시의 사용 툴: 차시에 적은 툴, 없으면 과정 공통 툴(course-design.js lessonTools)
function lessonInfoTools(mod) {
    const tools = typeof lessonTools === 'function' && typeof globalState !== 'undefined' && globalState ? lessonTools(mod) : mod.tools;
    return Array.isArray(tools) ? tools : [];
}

// 직접 선행 차시 제목(차시 정보의 선행 차시). 없으면 '없음'
function lessonInfoPrereqs(mod) {
    const titles = (Array.isArray(mod.prereqs) ? mod.prereqs : []).map(item => lessonInfoField(item?.title)).filter(Boolean);
    return titles.length ? titles.map(lessonInfoText).join(', ') : '없음';
}

// 선행 차시 칸(item)이 이 차시를 가리키는가: id가 같거나 제목이 같다(course-meta.js findLessonPrereq처럼 지운 뒤 다시 만든 차시는 제목으로 잇는다)
const lessonInfoPoints = (item, mod) => !!item && ((item.id != null && mod.id != null && String(item.id) === String(mod.id))
    || (!!lessonInfoField(item.title) && lessonInfoField(item.title) === lessonInfoField(mod.title)));

// 같은 교과에서 바로 다음 차시가 이 차시를 선행으로 적었으면(연속편) 그 차시 제목. 아니면 ''
function lessonInfoNext(mod, lessons) {
    const list = Array.isArray(lessons) ? lessons : [];
    const at = list.findIndex(item => item === mod || (item && mod.id != null && String(item.id) === String(mod.id)));
    const next = at >= 0 ? list[at + 1] : null;
    if (!next || next.id === 'mainQuest' || !Array.isArray(next.prereqs)) return '';
    return next.prereqs.some(item => lessonInfoPoints(item, mod)) ? lessonInfoField(next.title) : '';
}

// 학습 정보의 줄. 시간을 모르면 권장 수업 시간을, 연속편이 아니면 후속을, 툴이 없으면 사용 툴 줄을 뺀다
function lessonInfoLines(mod, lessons = []) {
    const hours = lessonInfoHours(mod.hours);
    const next = lessonInfoNext(mod, lessons);
    const tools = lessonInfoTools(mod).map(lessonInfoTool).filter(Boolean);
    return [
        hours ? `- 권장 수업 시간: ${hours}` : '',
        `- 선행: ${lessonInfoPrereqs(mod)}`,
        next ? `- 후속: ${lessonInfoText(next)}` : '',
        tools.length ? `- 사용 툴과 버전: ${tools.join(', ')}` : ''
    ].filter(Boolean);
}

const lessonInfoSection = (mod, lessons = []) => [LESSON_INFO_HEADING, '', ...lessonInfoLines(mod, lessons)].join('\n');

// 그 차시가 든 교과의 차시 목록(지금 교과는 courseData가 최신이다, course-meta.js subjectLessons). 못 찾으면 빈 목록
function lessonInfoSiblings(mod) {
    const subjects = typeof globalState !== 'undefined' && Array.isArray(globalState?.subjects) ? globalState.subjects : [];
    const lists = [typeof courseData !== 'undefined' ? courseData : null, ...subjects.map(subject => subject?.lessons)].filter(Array.isArray);
    return lists.find(list => list.includes(mod)) || lists.find(list => list.some(item => item && mod.id != null && String(item.id) === String(mod.id))) || [];
}

/* ---------- 첫머리 차례 ---------- */
// 파트(openingSections: # · ## 제목 단위)를 견줄 글(끝의 빈 줄은 빼고 본다). 글로 쓸 때는 파트의 줄을 그대로 쓴다(joinOpeningParts)
const openingPartBody = part => part.lines.join('\n').replace(/\s+$/, '');
const isBlankLine = line => !String(line).trim();

// 학습 정보 파트: 쓸 글(info)이 없거나 고정한 섹션이거나 같은 글이면 있던 파트, 아니면 새 글로 바꾼 파트(처음 넣으면 새 파트, 끝에 빈 줄 하나).
// 바꾸는 파트는 제목이 꼭 '학습 정보'인 섹션뿐이다(isInfoSection, lesson-lint.js LESSON_INFO_TITLE)
function lessonInfoPart(parts, at, info, keepInfo) {
    const current = at >= 0 ? parts[at] : null;
    if (!info || (current && (keepInfo(current) || openingPartBody(current) === info))) return current;
    return { level: 2, title: '학습 정보', lines: [...info.split('\n'), ''], index: -1 };
}

// 이 차시 글이 차지하는 파트 범위 [start, end)와 차시 제목이 있는지. 차시 제목(# 📝, 또는 앞에 ## 섹션이 없는 첫 # 제목) 다음부터 그다음 # 제목 앞까지다.
// 첫 # 제목 앞에 ## 섹션이 있으면(제목 없이 쓴 탭 뒤에 # 일일 퀘스트가 붙은 경우) 맨 앞부터 그 # 제목 앞까지. # 제목을 넘어 섹션을 옮기지 않는다
function lessonOpeningRegion(parts) {
    const first = parts.findIndex(part => part.level === 1);
    if (first < 0) return { start: 0, end: parts.length, titled: false };
    const titled = OPENING_LESSON_TITLE.test(parts[first].title) || parts.slice(0, first).every(part => part.level === 0);
    if (!titled) return { start: 0, end: first, titled: false };
    const next = parts.findIndex((part, index) => index > first && part.level === 1);
    return { start: first + 1, end: next < 0 ? parts.length : next, titled: true };
}

// 틀 섹션을 넣을 자리(범위 안에서 틀을 뺀 파트 목록 기준): 차시 제목 바로 뒤. 제목이 없으면 틀 섹션이 처음 있던 자리, 새로 넣는 학습 정보뿐이면 맨 앞(제목 없는 머리 글 뒤)
function openingInsertAt(inside, frame, titled) {
    if (titled) return 0;
    const first = Math.min(...frame.map(part => part.index).filter(index => index >= 0));
    if (Number.isFinite(first)) return inside.filter(part => part.index < first).length;
    return inside[0]?.level === 0 ? 1 : 0;
}

// 파트를 이어 글로 쓴다. 파트의 줄은 한 글자도 바꾸지 않고(줄 끝 빈칸 두 개의 줄바꿈·빈 줄도 그대로), 원래 이웃이 아니던 두 파트 사이에 빈 줄이 없을 때만 빈 줄 하나를 넣는다
function joinOpeningParts(parts) {
    const lines = [];
    parts.forEach((part, i) => {
        const prev = parts[i - 1];
        const fresh = !!prev && (prev.index < 0 || part.index !== prev.index + 1);
        if (fresh && lines.length && !isBlankLine(lines[lines.length - 1])) lines.push('');
        lines.push(...part.lines);
    });
    return lines.join('\n');
}

const sameParts = (before, after) => before.length === after.length && before.every((part, i) => part === after[i]);

// 틀 섹션(개요 → 학습 정보 → 학습 목표, 이 차시 범위 안의 각 첫 섹션)을 빼서 차례대로 모아 둔다. 다른 섹션의 차례와 글은 그대로다.
// info: 학습 정보 섹션으로 쓸 글(주지 않으면 있는 섹션을 옮기기만 하고 새로 넣지 않는다) · keepInfo(part): 그대로 둘 학습 정보인가(고정 섹션)
// 바꿀 것이 없으면 받은 글 그대로다. 글 끝의 줄바꿈은 받은 글과 같게 둔다
function arrangeLessonOpening(md, { info = '', keepInfo = () => false } = {}) {
    const text = String(md ?? '').replace(/\r\n/g, '\n');
    const parts = openingSections(text).map((part, index) => ({ ...part, index }));
    const { start, end, titled } = lessonOpeningRegion(parts);
    const region = parts.slice(start, end);
    const [overview, infoAt, goals] = [isOverviewSection, isInfoSection, isGoalSection].map(test => region.find(test)?.index ?? -1);
    const frame = [parts[overview], lessonInfoPart(parts, infoAt, info, keepInfo), parts[goals]].filter(Boolean);
    if (!frame.length) return md;
    const moved = new Set([overview, infoAt, goals].filter(at => at >= 0));
    const inside = region.filter(part => !moved.has(part.index));
    const at = openingInsertAt(inside, frame, titled);
    const next = [...parts.slice(0, start), ...inside.slice(0, at), ...frame, ...inside.slice(at), ...parts.slice(end)];
    if (sameParts(parts, next)) return md;
    return `${joinOpeningParts(next).replace(/\n*$/, '')}${text.match(/\n*$/)[0]}`;
}

// 첫머리 차례만 맞춘다(학습 정보를 새로 넣거나 고쳐 쓰지 않는다). mod를 주면 학습 탭(lessonInfoApplies)일 때만 바꾼다
function orderLessonOpening(md, { mod = null, tabId = 'basicLearn' } = {}) {
    if (mod && !lessonInfoApplies(mod, tabId)) return md;
    return arrangeLessonOpening(md);
}

const lessonInfoLockKey = title => (typeof lockTitleKey === 'function' ? lockTitleKey(title) : String(title ?? '').trim());

// 새로 만든 학습 탭의 마무리: 학습 정보를 차시 메타데이터로 쓰고(고정한 학습 정보는 그대로) 첫머리를 개요 → 학습 정보 → 학습 목표 차례로 둔다.
// lessons: 다음 차시(후속)를 찾을 교과의 차시 목록(주지 않으면 그 차시가 든 교과에서 찾는다) · lockedBlocks: 고정 섹션(lesson-editor-tools.js lockedSectionBlocks)
// 학습 탭이 아니거나(실습·문제은행·최종 평가) 빈 글이면 받은 글 그대로다
function applyLessonInfoFrame(md, { mod = null, tabId = 'basicLearn', lessons = null, lockedBlocks = [] } = {}) {
    if (!lessonInfoApplies(mod, tabId) || !String(md ?? '').trim()) return md;
    const locked = new Set((Array.isArray(lockedBlocks) ? lockedBlocks : []).map(block => lessonInfoLockKey(block?.title)));
    const info = lessonInfoSection(mod, Array.isArray(lessons) ? lessons : lessonInfoSiblings(mod));
    return arrangeLessonOpening(md, { info, keepInfo: part => locked.has(lessonInfoLockKey(part.title)) });
}
