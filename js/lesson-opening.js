// lesson-opening.js - 교안 첫머리 정리: 본문 앞 이미지와 개요의 시간표·특징 목록을 뺀다
// 개요는 문제 상황, 해결할 일, 학습 후 가능해지는 일만 담는다. 프롬프트로도 막지만 모델이 어길 수 있고,
// 예전에 저장한 교안도 같게 보이도록 읽을 때 거른다.
// 고치는 곳은 첫머리, 학습 목표, 개요뿐이다. 본문의 표·코드 블록·이미지와 <br> 간격은 건드리지 않는다.

const OPENING_IMAGE_LINE = /<!--\s*\[IMG:|^\s*!\[[^\]]*\]\(|<div class="image-(?:wrapper|placeholder)"/;
const OPENING_TIME_LINE = /^\s*[-*]\s+\**\s*\d+\s*분?\s*[~∼～-]\s*\d+\s*분/;
const OPENING_TIME_HEAD = /^\s*(?:#{3,6}\s*|\*\*)?\s*(?:타임\s*테이블|시간표|시간\s*배분|수업\s*흐름)\s*(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/;
const OPENING_TIME_TABLE = /^\s*\|\s*(?:시간|소요\s*시간|분|구간|타임\s*테이블)\s*(?:\([^)|]*\))?\s*\|/;
const OPENING_KEYWORD_LINE = /^\s*[-*]\s+\*\*[^*]+\*\*\s*:?\s*$/;
// 머리말로 보는 줄: 빈 줄, 목록, 표, <br>, 굵은 라벨, 구분선(차시 전환 구분선 세트 '<br><br> + --- + <br>'가 목록과 제목 사이에 낀다)
const OPENING_FILLER_LINE = /^\s*(?:$|[-*+]\s|\d+[.)]\s|\||<br|<hr|\*\*[^*]+\*\*\s*:?\s*$|(?:-{3,}|\*{3,}|_{3,})\s*$)/;
const OPENING_LESSON_TITLE = /📝/; // 차시 제목(# 📝 ...). 탭은 이 제목으로 시작하므로 앞에 붙은 글은 문장이어도 머리말이다
const OPENING_GAP_LINE = /^\s*(?:<br\s*\/?>\s*)*$/;
const OPENING_SENTENCE_END = /다\.?\**\s*$/;
const OPENING_GOAL_TITLE = /학습\s*목표/;
const OPENING_LEADING_GAP = /^(?:\s*<br\s*\/?>)+\s*/i;

// 줄마다 코드 블록 안인지 표시한다. 여닫는 펜스 줄도 코드로 본다
function openingFences(lines) {
    let fence = 0;
    return lines.map(line => {
        const coded = fence > 0;
        fence = nextCodeFence(fence, line);
        return coded || fence > 0;
    });
}

// # · ## 제목으로 나눈다. 코드 블록 안의 # 은 제목이 아니다
function openingSections(md) {
    const lines = md.split('\n');
    const coded = openingFences(lines);
    const sections = [{ level: 0, title: '', lines: [] }];
    lines.forEach((line, index) => {
        const heading = !coded[index] && line.match(/^(#{1,2})\s+(.*)$/);
        if (heading) sections.push({ level: heading[1].length, title: heading[2].trim(), lines: [line] });
        else sections.at(-1).lines.push(line);
    });
    return sections;
}

const isOverviewSection = section => section.level === 2 && LESSON_OVERVIEW_TITLE.test(section.title);
const isGoalSection = section => section.level === 2 && OPENING_GOAL_TITLE.test(section.title) && LESSON_FRAME_TITLE.test(section.title);
const isInfoSection = section => section.level === 2 && LESSON_INFO_TITLE.test(section.title); // 학습 정보(lesson-info.js가 차시 메타데이터로 쓴다)
const isTimeLine = line => OPENING_TIME_LINE.test(line) && !OPENING_SENTENCE_END.test(line);

// 빠진 자리에 남은 <br>과 빈 줄을 한 벌로 줄인다
function withoutRepeatedGaps(lines) {
    return lines.filter((line, index) => !OPENING_GAP_LINE.test(line) || !line.trim() || !lines.slice(0, index).reverse().find(item => item.trim())?.match(OPENING_GAP_LINE));
}

function withoutImages(lines) {
    const coded = openingFences(lines);
    return withoutRepeatedGaps(lines.filter((line, index) => coded[index] || !OPENING_IMAGE_LINE.test(line)));
}

// 제목 바로 아래 이미지만 뺀다. 내용이 시작된 뒤의 이미지는 본문이다
function withoutLeadingImages(lines) {
    const [title, ...rest] = lines;
    const start = rest.findIndex(line => !OPENING_GAP_LINE.test(line) && !OPENING_IMAGE_LINE.test(line));
    const opening = start < 0 ? rest : rest.slice(0, start);
    return [title, ...withoutImages(opening), ...(start < 0 ? [] : rest.slice(start))];
}

function withoutTimeTable(lines) {
    const coded = openingFences(lines);
    let inTable = false;
    return lines.filter((line, index) => {
        if (coded[index]) return true;
        const tableRow = /^\s*\|/.test(line);
        inTable = tableRow && (inTable || OPENING_TIME_TABLE.test(line));
        return !inTable && !isTimeLine(line) && !OPENING_TIME_HEAD.test(line);
    });
}

// "**키워드**" 줄과 그 아래 세부 불릿 묶음을 뺀다
function withoutKeywordGroups(lines) {
    const coded = openingFences(lines);
    let inGroup = false;
    return lines.filter((line, index) => {
        if (coded[index]) return true;
        if (inGroup && /^\s+\S/.test(line)) return false;
        inGroup = OPENING_KEYWORD_LINE.test(line);
        return !inGroup;
    });
}

const hasOverviewBody = lines => lines.slice(1).some(line => !OPENING_GAP_LINE.test(line));

// 특징 묶음밖에 없는 개요는 비우지 않고 남긴다. 예전 프롬프트가 개요를 이 형식으로 쓰게 했다. 시간표뿐이면 제목도 뺀다
function cleanedOverview(lines) {
    const noTable = withoutTimeTable(withoutImages(lines));
    if (!hasOverviewBody(noTable)) return [];
    const noGroups = withoutKeywordGroups(noTable);
    return withoutRepeatedGaps(hasOverviewBody(noGroups) ? noGroups : noTable);
}

function cleanedSection(section, index, firstTitle) {
    if (section.level === 0 || isGoalSection(section)) return withoutImages(section.lines);
    if (index === firstTitle) return withoutLeadingImages(section.lines);
    return isOverviewSection(section) ? cleanedOverview(section.lines) : section.lines;
}

// 제목 없는 첫머리가 머리말인가. 목록·간격·구분선·그림뿐이면 머리말이다. 차시 제목(# 📝) 앞이면 문장도 머리말로 본다.
// 코드 블록이 든 첫머리는 어느 쪽이든 남긴다
const isOpeningFiller = (lines, beforeLessonTitle) => {
    const coded = openingFences(lines);
    return lines.every((line, index) => !coded[index] && (beforeLessonTitle || OPENING_FILLER_LINE.test(line) || OPENING_IMAGE_LINE.test(line)));
};

// 첫 큰 제목(# 📝 ...) 앞에 목록만 있으면 머리말이다. 차시 안에 학습 목표가 있으면 통째로 빼고, 없으면 학습 목표만 남긴다.
// 머리말의 개요·학습 정보는 뺀다(학습 정보는 새로 만든 학습 탭에 코드가 다시 쓴다, lesson-info.js).
// 내용 섹션이 앞에 있는 교안(끝에 # 일일 퀘스트가 붙는 경우)은 머리말이 아니다
function withoutPreamble(sections) {
    const firstTitle = sections.findIndex(section => section.level === 1);
    if (firstTitle < 1) return sections;
    const head = sections.slice(0, firstTitle);
    const lessonTitle = OPENING_LESSON_TITLE.test(sections[firstTitle].title);
    const opening = head.every(section => (section.level === 0 ? isOpeningFiller(section.lines, lessonTitle) : isGoalSection(section) || isOverviewSection(section) || isInfoSection(section)));
    if (!opening) return sections;
    const body = sections.slice(firstTitle);
    return [...(body.some(isGoalSection) ? [] : head.filter(isGoalSection)), ...body];
}

function cleanLessonOpening(md) {
    if (!md) return md;
    const sections = withoutPreamble(openingSections(String(md).replace(/\r\n/g, '\n')));
    const firstTitle = sections.findIndex(section => section.level === 1);
    return sections.flatMap((section, index) => cleanedSection(section, index, firstTitle)).join('\n').trimStart().replace(OPENING_LEADING_GAP, ''); // 서식 정리가 첫 제목 앞에 넣는 간격을 뺀다
}
