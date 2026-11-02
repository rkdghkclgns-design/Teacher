// lesson-material.js - 학습자용 교안을 직무 교육 자료 양식으로 내려받는다
// 양식은 develocket-slide(assets/course-model.js lessonDocMd·moduleBlockMd)를 따른다.
// 생성과 저장은 Teacher의 탭 마크다운을 그대로 쓰고 내보낼 때만 바꾼다. 학습이해도 탭은 정답이 있어 넣지 않는다.

const MATERIAL_GAP = '<br>';
const MATERIAL_TIME_NOTE = /\s*\(⏱[^)]*\)/g;
const MATERIAL_CHECK_REF = /\s*[(（]\s*다시\s*보기\s*:\s*([^)）]+)[)）]\s*$/;

const materialTitle = title => String(title).replace(MATERIAL_TIME_NOTE, '').trim();
const materialCell = text => String(text || '').replace(/\|/g, '｜').replace(/\s+/g, ' ').trim();
const sectionBody = section => section.text.replace(/^##\s+[^\n]*\n?/, '');
// 화면과 같게 강사 전용 내용과 첫머리의 시간표·목록을 뺀다
const materialTabMd = (lesson, tabId) => (lesson.tabContents?.[tabId] ? resolveMarkdownImages(cleanLessonOpening(stripInstructorCallouts(lesson.tabContents[tabId])), lesson.images).replace(/\r\n/g, '\n') : '');

// 글머리 "- 용어: 설명" → "- **용어** | 설명". 짧은 이름(15자 이하)일 때만 항목 표기로 본다
function materialTermLine(line) {
    const term = line.match(/^(\s*[-*+]\s+)([^\s*:：|`[\]()<>][^*:：|`[\]()<>]{0,14}?)\s*[:：]\s+(\S.*)$/);
    if (!term || /^\d+$/.test(term[2])) return line;
    return `${term[1]}**${term[2].trim()}** | ${term[3]}`;
}

// 소제목은 #### ▣ 로 내리고 코드 블록 안은 그대로 둔다
function materialBody(md) {
    let fence = 0;
    const lines = [];
    String(md || '').split('\n').forEach(line => {
        const coded = fence > 0;
        fence = nextCodeFence(fence, line);
        const heading = !coded && !fence && line.match(/^#{1,6}\s+(.*)$/);
        if (coded || fence) lines.push(line);
        else if (heading) lines.push(MATERIAL_GAP, '', `#### ▣ ${materialTitle(heading[1])}`, '');
        else if (line.trim() || lines.at(-1)?.trim()) lines.push(materialTermLine(line)); // 코드 블록 밖의 빈 줄은 한 줄로 줄인다
    });
    return lines.join('\n').replace(/^\s*<br>\s*/, '').trim();
}

// 개요는 글머리로 쓴다. 줄글이면 문장마다 나눈다
function materialOverview(section) {
    const body = section ? sectionBody(section) : '';
    const bullets = body.split('\n').map(line => (line.match(/^\s*[-*]\s+(.*)$/) || [])[1]).filter(Boolean);
    return bullets.length ? bullets : body.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=\S)/).filter(Boolean);
}

// 화면에 보이지 않는 주석으로 차시 메타데이터를 남긴다
function materialMetaComment(subject, lesson) {
    const tools = lessonTools(lesson).map(toolLabel).join(', ');
    const prereqs = (lesson.prereqs || []).map(item => item.title).filter(Boolean).join(', ');
    const elements = (lesson.ncsElements || []).map(elementLabel).join(', ');
    const history = (lesson.history || []).slice(0, 3).map(row => `${row.at.slice(0, 10)} ${row.note}`).join(' / ');
    const rows = [
        '차시 정보', `상태: ${lessonStatus(lesson)}`, `예상 소요 시간: ${fmtMinutes(lessonMinutes(lesson))}`, `사용 툴과 버전: ${tools || '-'}`,
        `선행 차시: ${prereqs || '없음'}`, `NCS 능력단위(교과 대응): ${subjectNcsText(subject) || '-'}`, `NCS 능력단위요소(차시 대응): ${elements || '-'}`, `변경 이력: ${history || '-'}`
    ];
    return `<!--\n${rows.join('\n').replace(/--/g, '—')}\n-->`;
}

const materialSectionLines = (title, body) => ['', MATERIAL_GAP, `### ■ ${title}`, '', body];

function materialContentLines(md, prefix = '') {
    const sections = mdSections(md);
    return objectiveContentSections(md).flatMap(({ index }) => materialSectionLines(`${prefix}${materialTitle(sections[index].title)}`, materialBody(sectionBody(sections[index]))));
}

function materialChecklistLines(md) {
    const checks = lessonLintBullets(md, CHECKLIST_BULLETS);
    if (!checks.length) return [];
    return ['', MATERIAL_GAP, '### ■ ✅ 학습 후 체크리스트', '', ...checks.map(check => `- [ ] ${check.replace(MATERIAL_CHECK_REF, ' → 다시 보기: $1')}`)];
}

function materialBlockMd(subject, lesson) {
    const md = materialTabMd(lesson, 'basicLearn');
    const overview = materialOverview(mdSections(md).find(section => LESSON_OVERVIEW_TITLE.test(section.title)));
    const advanced = materialTabMd(lesson, 'advLearn');
    const quest = materialTabMd(lesson, 'basicPrac');
    const advancedPractice = materialTabMd(lesson, 'advPrac');
    return [
        materialMetaComment(subject, lesson), MATERIAL_GAP, `## ${lesson.title}`, '',
        ...(overview.length ? overview.map(line => `- ${line}`) : ['- (이 차시를 왜 배우는지 적습니다.)']),
        ...materialContentLines(md),
        ...(advanced ? materialContentLines(advanced, '심화 학습: ') : []),
        ...materialChecklistLines(md),
        ...(quest ? materialSectionLines('❗오늘의 퀘스트(기본 실습)', materialBody(quest)) : []),
        ...(advancedPractice ? materialSectionLines('❗심화 실습', materialBody(advancedPractice)) : [])
    ].join('\n');
}

// 교육 목차 표. marked에 든 차시는 이 문서가 다루는 곳이라 굵게 쓴다
function materialTocLines(subjects, marked) {
    const rows = subjects.flatMap(subject => {
        const lessons = courseLessons(subject);
        return (lessons.length ? lessons : [null]).map((lesson, index) => {
            const name = lesson ? materialCell(lesson.title) : '-';
            return `| ${index ? ' ' : materialCell(subject.title)} | ${marked?.includes(lesson) ? `**${name}**` : name} |`;
        });
    });
    return ['| 교과목 | 단원명 |', '|---|---|', ...rows];
}

// tocSubjects: 목차에 넣을 교과 (비우면 목차를 뺀다) / marked: 일부 차시만 내려받을 때 목차에서 굵게 쓸 차시
function materialDocMd(subject, lessons, tocSubjects = [], marked = null) {
    const objectives = [...new Set(lessons.flatMap(qbankObjectives))];
    const tools = [...new Set(lessons.flatMap(lessonTools).map(tool => [tool.name, tool.version].filter(Boolean).join(' : ')))];
    const courseTitle = globalState.courseTitle ? `${globalState.courseTitle} ` : '';
    return [
        MATERIAL_GAP, `# 📝 ${subject.title}`, '', MATERIAL_GAP, '## 학습 목표', '',
        ...(objectives.length ? objectives.map(goal => `- ${goal}`) : ['- (학습 목표를 "~할 수 있습니다"로 적습니다.)']),
        ...(tools.length ? ['', MATERIAL_GAP, '## 사용 툴 버전', '', ...tools.map(tool => `- ${tool}`)] : []),
        ...(tocSubjects.length ? ['', MATERIAL_GAP, `## ${courseTitle}교육 목차`, '', ...materialTocLines(tocSubjects, marked)] : []),
        ...lessons.flatMap(lesson => ['', materialBlockMd(subject, lesson)])
    ].join('\n');
}

const materialLessons = subject => courseLessons(subject).filter(lesson => lesson.tabContents?.basicLearn);

// 과정 전체는 첫 교과에만 목차를 넣고 교과 사이를 --- 로 나눈다
function materialCourseMd() {
    const subjects = globalState.subjects.filter(subject => materialLessons(subject).length);
    return subjects.map((subject, index) => materialDocMd(subject, materialLessons(subject), index ? [] : globalState.subjects)).join('\n\n---\n\n');
}

// scope: current(현재 차시) | subject(현재 교과) | course(과정 전체)
window.downloadLessonMaterial = function (scope = 'current') {
    const subject = globalState.subjects.find(item => item.id === currentSubjectId);
    if (scope === 'course') {
        const md = materialCourseMd();
        return md ? downloadMd(md, `${globalState.courseTitle || '과정'}_교육자료`) : window.showAlert('내려받을 교안이 없습니다. 먼저 기본 학습 탭을 생성해주세요.');
    }
    if (!subject) return window.showAlert('교과를 먼저 선택해주세요.');
    if (scope === 'subject') {
        const lessons = materialLessons(subject);
        if (!lessons.length) return window.showAlert('내려받을 교안이 없습니다. 먼저 기본 학습 탭을 생성해주세요.');
        return downloadMd(materialDocMd(subject, lessons, globalState.subjects), `${subject.title}_교육자료`);
    }
    const mod = getEditingModule();
    if (!mod?.tabContents?.basicLearn) return window.showAlert('내려받을 교안이 없습니다. 먼저 기본 학습 탭을 생성해주세요.');
    return downloadMd(materialDocMd(subject, [mod], [subject], [mod]), `${lessonFileBase(mod, subject)}_교육자료`);
};
