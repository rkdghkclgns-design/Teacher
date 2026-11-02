// lesson-opening.js - 교안 첫머리 정리: 본문 앞 이미지와 개요의 시간표·특징 목록을 뺀다
// 개요는 문제 상황, 해결할 일, 학습 후 가능해지는 일만 담는다. 프롬프트로도 막지만 모델이 어길 수 있고,
// 예전에 저장한 교안도 같게 보이도록 읽을 때 거른다.

const OPENING_IMAGE_LINE = /<!--\s*\[IMG:|^\s*!\[[^\]]*\]\(|<div class="image-(?:wrapper|placeholder)"/;
const OPENING_TIME_LINE = /^\s*[-*]\s+\**\s*\d+\s*분?\s*[~∼～-]\s*\d+\s*분/;
const OPENING_TIME_HEAD = /^\s*(?:#{3,6}\s*|\*\*)?\s*(?:타임\s*테이블|시간표|시간\s*배분|수업\s*흐름)\s*(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/;
const OPENING_KEYWORD_LINE = /^\s*[-*]\s+\*\*[^*]+\*\*\s*:?\s*$/;
const OPENING_FILLER_LINE = /^\s*(?:$|[-*+]\s|\d+[.)]\s|\||<br|\*\*[^*]+\*\*\s*:?\s*$)/;
const OPENING_GOAL_TITLE = /학습\s*목표/;

// # · ## 제목으로 나눈다. 코드 블록 안의 # 은 제목이 아니다
function openingSections(md) {
    const sections = [{ level: 0, title: '', lines: [] }];
    let fence = 0;
    md.split('\n').forEach(line => {
        const coded = fence > 0;
        fence = nextCodeFence(fence, line);
        const heading = !coded && !fence && line.match(/^(#{1,2})\s+(.*)$/);
        if (heading) sections.push({ level: heading[1].length, title: heading[2].trim(), lines: [line] });
        else sections.at(-1).lines.push(line);
    });
    return sections;
}

const isOverviewSection = section => section.level === 2 && LESSON_OVERVIEW_TITLE.test(section.title);
const isGoalSection = section => section.level === 2 && OPENING_GOAL_TITLE.test(section.title) && LESSON_FRAME_TITLE.test(section.title);

// 시간표와 "**키워드**" 아래 세부 불릿 묶음을 뺀다. 시간 열이 있는 표도 시간표다
function withoutOverviewPadding(lines) {
    const kept = [];
    let inGroup = false;
    let inTimeTable = false;
    lines.forEach(line => {
        if (inGroup && /^\s+\S/.test(line)) return;
        inGroup = OPENING_KEYWORD_LINE.test(line);
        if (inGroup) return;
        const tableRow = /^\s*\|/.test(line);
        inTimeTable = tableRow && (inTimeTable || (/시간|분/.test(line) && !/^\s*\|/.test(kept.at(-1) || '')));
        if (!inTimeTable && !OPENING_TIME_LINE.test(line) && !OPENING_TIME_HEAD.test(line)) kept.push(line);
    });
    return kept;
}

const withoutImages = lines => lines.filter(line => !OPENING_IMAGE_LINE.test(line));

// 다음 큰 제목 바로 위에 붙은 이미지는 본문 앞 이미지다
function withoutTrailingImages(lines) {
    let end = lines.length;
    while (end > 0 && (!lines[end - 1].trim() || OPENING_IMAGE_LINE.test(lines[end - 1]))) end -= 1;
    return lines.slice(end).some(line => line.trim()) ? [...lines.slice(0, end), ''] : lines;
}

function cleanedSection(section, index, sections) {
    const before = sections[index + 1]?.level === 1;
    if (section.level === 0 || (section.level === 1 && index <= 1) || isGoalSection(section)) return withoutImages(section.lines);
    if (isOverviewSection(section)) return withoutOverviewPadding(withoutImages(section.lines));
    return before ? withoutTrailingImages(section.lines) : section.lines;
}

// 첫 큰 제목(# 📝 ...) 앞에 목록만 있으면 머리말이다. 차시 안에 학습 목표가 있으면 통째로 빼고, 없으면 학습 목표만 남긴다.
// 내용 섹션이 앞에 있는 교안(끝에 # 일일 퀘스트가 붙는 경우)은 머리말이 아니다
function withoutPreamble(sections) {
    const firstTitle = sections.findIndex(section => section.level === 1);
    if (firstTitle < 1) return sections;
    const head = sections.slice(0, firstTitle);
    const opening = head.every(section => (section.level === 0 ? section.lines.every(line => OPENING_FILLER_LINE.test(line) || OPENING_IMAGE_LINE.test(line)) : isGoalSection(section) || isOverviewSection(section)));
    if (!opening) return sections;
    const body = sections.slice(firstTitle);
    return [...(body.some(isGoalSection) ? [] : head.filter(isGoalSection)), ...body];
}

function cleanLessonOpening(md) {
    if (!md) return md;
    const sections = withoutPreamble(openingSections(String(md).replace(/\r\n/g, '\n')));
    const lines = sections.flatMap((section, index) => cleanedSection(section, index, sections));
    return lines.join('\n').replace(/(?:\s*<br\s*\/?>\s*){2,}/g, '\n\n<br>\n\n').replace(/\n{4,}/g, '\n\n\n').trimStart();
}
