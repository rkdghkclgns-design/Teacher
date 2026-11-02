// course-sessions.js - 1차시(1시간) 단위 분할과 차시별 교수안·슬라이드 편성안
// 분할 규칙과 산출물 구성은 develocket-slide(assets/course-sessions.js @3a7303f)를 따른다.
// 진행 단계를 60분마다 자르되 블록 설계는 바꾸지 않는다. 차시는 산출물을 나누는 단위다.

const SESSION_MINUTES = 60;
const SESSION_FRAME_MINUTES = 5;
const SESSION_MIN_CARVE_MINUTES = 15;

function readMinutes(text) {
    const value = String(text);
    const both = value.match(/(\d+)\s*시간\s*(\d+)\s*분/);
    const minutes = value.match(/(\d+)\s*분/);
    const hours = value.match(/(\d+(?:\.\d+)?)\s*시간/);
    if (both && !/^\s*\d+\s*분/.test(value)) return Number(both[1]) * 60 + Number(both[2]);
    if (minutes) return Number(minutes[1]);
    return hours ? Math.round(Number(hours[1]) * 60) : 0;
}

function labelSessionParts(sessions) {
    const spans = new Map();
    sessions.forEach((session, index) => session.mods.forEach(mod => spans.set(mod, [...(spans.get(mod) || []), index])));
    return sessions.map((session, index) => ({
        ...session,
        part: Object.fromEntries(session.mods
            .filter(mod => spans.get(mod).length > 1)
            .map(mod => [mod, `${spans.get(mod).indexOf(index) + 1}/${spans.get(mod).length}`]))
    }));
}

// 진행 단계를 시간 순서로 이어 60분마다 자른다. 경계에 걸친 단계는 앞부분과 이어지는 부분으로 나눈다.
function splitSessions(modules) {
    const sessions = [{ minutes: 0, items: [] }];
    modules.forEach((module, moduleIndex) => {
        const flow = module.flow?.length ? module.flow : [{ phase: '전개', title: module.title, minutes: module.minutes }];
        flow.forEach((step, flowIndex) => {
            let left = Math.max(0, Math.round(Number(step.minutes) || 0));
            let part = 0;
            while (left > 0) {
                if (sessions.at(-1).minutes >= SESSION_MINUTES) sessions.push({ minutes: 0, items: [] });
                const current = sessions.at(-1);
                const take = Math.min(left, SESSION_MINUTES - current.minutes);
                current.items.push({ module: moduleIndex, flow: flowIndex, step, minutes: take, cont: part > 0, more: left > take });
                current.minutes += take;
                left -= take;
                part += 1;
            }
        });
    });
    return labelSessionParts(sessions.map(session => ({ ...session, mods: [...new Set(session.items.map(item => item.module))] })));
}

// 차시 제목: 학습모듈 이름(여러 차시에 걸치면 k/K). 둘 이상이면 가장 오래 다루는 블록 + 외 n개
function sessionTitle(modules, session) {
    const name = mod => `${String(modules[mod].title || '').trim()}${session.part[mod] ? ` (${session.part[mod]})` : ''}`;
    if (session.mods.length <= 1) return session.mods.length ? name(session.mods[0]) : '';
    const minutes = session.mods.map(mod => session.items.filter(item => item.module === mod).reduce((sum, item) => sum + item.minutes, 0));
    return `${name(session.mods[minutes.indexOf(Math.max(...minutes))])} 외 ${session.mods.length - 1}개`;
}

function carveFrame(items) {
    const longest = condition => items.reduce((best, item) => (condition(item) && item.minutes >= SESSION_MIN_CARVE_MINUTES && (!best || item.minutes > best.minutes) ? item : best), null);
    const target = longest(item => item.step.phase === '전개') || longest(() => true);
    if (target) {
        target.minutes -= SESSION_FRAME_MINUTES;
        target.trimmed = true;
    }
    return !!target;
}

function sessionStepText(modules, item, kind) {
    const prefix = kind === '전개' && item.step.phase !== '전개' ? `[${modules[item.module].title} · ${item.step.phase}] ` : '';
    return `${prefix}${item.step.title}${item.cont ? ' (이어서)' : ''}${item.more ? ' (다음 차시에 계속)' : ''}`;
}

// 차시가 블록의 도입으로 시작하지 않거나 정리로 끝나지 않으면 가장 긴 전개에서 5분씩 덜어 연결 단계를 넣는다
function sessionSteps(modules, session, index, total) {
    const items = session.items.map(item => ({ ...item }));
    const first = items[0];
    const last = items.at(-1);
    const hasIntro = !!first && first.step.phase === '도입' && !first.cont;
    const hasClose = !!last && last.step.phase === '정리' && !last.more;
    const addIntro = !hasIntro && items.length > 0 && carveFrame(items);
    const addClose = !hasClose && items.length > 0 && carveFrame(items);
    const planned = items.map((item, i) => {
        const kind = i === 0 && hasIntro ? '도입' : i === items.length - 1 && hasClose ? '정리' : '전개';
        return { kind, item, minutes: item.minutes, text: sessionStepText(modules, item, kind) };
    });
    const steps = [
        ...(addIntro ? [{ kind: '도입', synthetic: 'intro', minutes: SESSION_FRAME_MINUTES, text: index > 0 ? '이전 차시 연결과 이번 차시 목표 확인' : '이번 차시 목표 확인' }] : []),
        ...planned,
        ...(addClose ? [{ kind: '정리', synthetic: 'close', minutes: SESSION_FRAME_MINUTES, text: index < total - 1 ? '이번 차시 핵심 정리와 다음 차시 안내' : '핵심 정리' }] : [])
    ];
    let unfold = 0;
    return steps.map(step => {
        unfold += step.kind === '전개' ? 1 : 0;
        const label = step.kind === '전개' ? `전개 ${unfold}` : step.kind;
        return { ...step, label, heading: `${label} - ${step.text} (${fmtMinutes(step.minutes)})` };
    });
}

function sessionTableLines(modules, separator = '<br>') {
    const sessions = splitSessions(modules);
    if (sessions.every(session => !session.minutes)) return [];
    const rows = sessions.map((session, index) => {
        const steps = sessionSteps(modules, session, index, sessions.length).map(step => `${step.label} ${step.text} (${fmtMinutes(step.minutes)})`);
        return `| ${index + 1}차시. ${mdCell(sessionTitle(modules, session))} | ${fmtMinutes(session.minutes)} | ${mdCell(steps.join(separator))} |`;
    });
    return ['### 차시 구성 (1차시 = 1시간)', '', '| 차시 | 시간 | 진행 단계 |', '|---|---|---|', ...rows, ''];
}

// 과정 설계서: 교과의 차시를 모듈로 삼아 시간표를 만든다
function subjectSessionLines(subject) {
    const modules = subject.lessons.map(lesson => ({ title: lesson.title, minutes: lessonMinutes(lesson), flow: lesson.flow }));
    return sessionTableLines(modules);
}

// 교수안의 수업 흐름 표 행([단계, 시간, 핵심])에서 진행 단계를 만든다
function flowFromRows(rows, title) {
    return (rows || []).map(cells => ({
        phase: /도입/.test(cells[0]) ? '도입' : /정리/.test(cells[0]) ? '정리' : '전개',
        title: String(cells[2] || cells[0] || title).trim(),
        minutes: readMinutes(cells[1])
    })).filter(step => step.minutes > 0);
}

// 교수안 개요용: 60분을 넘는 수업만 차시 구성표를 넣는다
function gyosuanSessionTable(rows, title) {
    const flow = flowFromRows(rows, title);
    const total = flow.reduce((sum, step) => sum + step.minutes, 0);
    return total > SESSION_MINUTES ? sessionTableLines([{ title, minutes: total, flow }], ' / ') : []; // 교수안 뷰어는 표 안의 HTML을 글자로 보여 준다
}

function gyosuanSections(docMd) {
    const progress = (String(docMd).match(/^##\s*진행\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m) || [])[1] || '';
    return progress.split(/^(?=###\s)/m).filter(block => /^###\s/.test(block)).map(block => {
        const [head, ...rest] = block.trim().split('\n');
        return { heading: head.replace(/^###\s*/, '').trim(), body: rest.join('\n').trim() };
    });
}

function gyosuanFlowRows(docMd) {
    // 같은 섹션의 차시 구성표(### 제목)는 수업 흐름이 아니다
    const table = (String(docMd).match(/^##\s*수업 흐름 한눈에 보기\s*$([\s\S]*?)(?=^#{2,3}\s|(?![\s\S]))/m) || [])[1] || '';
    return table.split('\n')
        .filter(line => /^\|/.test(line) && !/^\|\s*(단계|-)/.test(line))
        .map(line => line.replace(/^\||\|\s*$/g, '').split('|').map(cell => cell.trim()))
        .filter(cells => readMinutes(cells[1]) > 0);
}

// 수업 흐름 표는 전개를 묶어 쓰기도 한다. 행 수가 섹션과 다르면 도입·정리 시간은 지키고 나머지를 전개에 고르게 나눈다.
function gyosuanFlowMinutes(sections, rows, mod) {
    const rowMinutes = rows.map(row => readMinutes(row[1]));
    if (rowMinutes.length === sections.length) return rowMinutes;
    const intro = /도입/.test(rows[0]?.[0]) ? rowMinutes[0] : 0;
    const close = /정리/.test(rows.at(-1)?.[0]) ? rowMinutes.at(-1) : 0;
    const fixed = section => (/^도입/.test(section.heading) ? intro : /^정리/.test(section.heading) ? close : 0);
    const total = Math.max(sections.length * SESSION_FRAME_MINUTES, rowMinutes.reduce((sum, minutes) => sum + minutes, 0) || lessonMinutes(mod));
    const open = sections.filter(section => !fixed(section));
    const shared = allocateTime(open.length, total - sections.reduce((sum, section) => sum + fixed(section), 0), null, SESSION_FRAME_MINUTES);
    let next = 0;
    return sections.map(section => fixed(section) || shared[next++]);
}

function gyosuanFlow(mod) {
    const sections = gyosuanSections(mod.gyosuan?.docMd);
    const minutes = gyosuanFlowMinutes(sections, gyosuanFlowRows(mod.gyosuan?.docMd), mod);
    return sections.map((section, index) => ({
        phase: /^도입/.test(section.heading) ? '도입' : /^정리/.test(section.heading) ? '정리' : '전개',
        title: section.heading.replace(/^(도입|전개\s*\d*|정리)\s*-\s*/, ''),
        label: section.heading.split(' - ')[0],
        minutes: minutes[index],
        body: section.body
    }));
}

/* ---------- 교수안 문서 읽기 ---------- */
function gyosuanFront(docMd) {
    const block = (String(docMd || '').match(/^﻿?---\s*\n([\s\S]*?)\n---/) || [])[1] || '';
    return Object.fromEntries(block.split('\n')
        .map(line => line.match(/^\s*([^:]+):\s*(.*)$/))
        .filter(Boolean)
        .map(match => [match[1].trim(), match[2].trim()]));
}

// `## 제목` 아래 줄들 (다음 `## ` 앞까지)
function gyosuanSectionLines(docMd, heading) {
    const lines = String(docMd || '').split('\n');
    const start = lines.findIndex(line => line.trim() === `## ${heading}`);
    if (start === -1) return [];
    const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
    return lines.slice(start + 1, end === -1 ? lines.length : end);
}

function gyosuanBullets(docMd, heading) {
    return gyosuanSectionLines(docMd, heading)
        .map(line => (line.match(/^\s*[-*]\s+(.+)$/) || [])[1])
        .filter(Boolean)
        .map(item => item.trim());
}

function gyosuanOverviewRows(docMd) {
    return gyosuanSectionLines(docMd, '개요')
        .filter(line => /^\|/.test(line) && !/^\|\s*(항목|-)/.test(line))
        .map(line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim()))
        .filter(cells => cells.length >= 2);
}

// 교안의 '학습 후 체크리스트' 항목 (없으면 빈 배열)
function lessonChecklist(mod) {
    const lines = [...Object.values(mod.tabContents || {}), mod.content].filter(Boolean).flatMap(text => String(text).split('\n'));
    const start = lines.findIndex(line => /^#{1,4}\s.*학습 후 체크리스트/.test(line));
    if (start === -1) return [];
    const end = lines.findIndex((line, index) => index > start && /^#{1,4}\s/.test(line));
    return lines.slice(start + 1, end === -1 ? lines.length : end)
        .map(line => (line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/) || [])[1])
        .filter(Boolean)
        .map(item => item.replace(/<[^>]+>/g, '').replace(/\s*\(다시 보기:[^)]*\)\s*$/, '').trim());
}

function lessonQuestionCount(mod) {
    return (String(mod.tabContents?.assessment || '').match(/^#{2,4}\s*문제\s*\d+/gm) || []).length;
}

/* ---------- 슬라이드를 차시에 나누기 ---------- */
function parseDeckSlides(deckMd) {
    return String(deckMd || '').split(/^(?=###\s*슬라이드)/m).filter(block => /^###\s*슬라이드/.test(block)).map(block => ({
        title: block.split('\n')[0].replace(/^###\s*슬라이드\s*\d*\s*-?\s*/, '').trim(),
        label: (block.match(/대응\s*교수안:\s*(.+)/) || [])[1]?.trim() || '',
        body: block.split('\n').slice(1).join('\n').trim()
    }));
}

// 표지·목차·마무리는 차시마다 새로 만든다
const isFrameSlide = slide => slide.label === '-' || /^(표지|목차|마무리)$/.test(slide.title);

// 한 단계가 여러 차시에 걸치면 그 단계의 슬라이드를 시간 비율대로 나눈다. 대응 단계가 없는 슬라이드는 첫 차시에 싣는다.
function shareSlides(slides, minutes) {
    const total = minutes.reduce((sum, value) => sum + value, 0);
    if (!total) return slides.map(() => 0);
    return slides.map((slide, position) => {
        const target = (position + 0.5) / slides.length * total;
        let reached = 0;
        const at = minutes.findIndex(value => {
            reached += value;
            return value > 0 && target <= reached;
        });
        return at === -1 ? minutes.length - 1 : at;
    });
}

function sessionSlideGroups(sessions, slides) {
    const labels = [...new Set(slides.map(slide => slide.label))];
    const placed = new Map(labels.flatMap(label => {
        const group = slides.filter(slide => slide.label === label);
        const minutes = sessions.map(session => session.items.filter(item => item.step.label === label).reduce((sum, item) => sum + item.minutes, 0));
        const shares = shareSlides(group, minutes);
        return group.map((slide, position) => [slide, shares[position]]);
    }));
    return sessions.map((session, index) => slides.filter(slide => placed.get(slide) === index));
}

// 교수안 하나를 차시 산출물로 나누는 데 필요한 값을 모은다. 교수안이 없으면 null
function gyosuanSessionPlan(mod) {
    const flow = gyosuanFlow(mod);
    if (!flow.length) return null;
    const docMd = mod.gyosuan.docMd;
    const front = gyosuanFront(docMd);
    const title = front['주제'] || mod.title; // 완성 MD로 만든 교수안은 차시 이름과 주제가 다를 수 있다
    const modules = [{ title, minutes: flow.reduce((sum, step) => sum + step.minutes, 0), flow }];
    const sessions = splitSessions(modules);
    const contentSlides = parseDeckSlides(mod.gyosuan.deckMd).filter(slide => !isFrameSlide(slide));
    return {
        mod, title, modules, sessions, front,
        overview: gyosuanOverviewRows(docMd),
        objectives: gyosuanBullets(docMd, '학습 목표'),
        assessment: gyosuanBullets(docMd, '평가·체크포인트'),
        notes: gyosuanBullets(docMd, '강사 유의사항'),
        checklist: lessonChecklist(mod),
        questions: lessonQuestionCount(mod),
        slides: sessionSlideGroups(sessions, contentSlides)
    };
}

const plainSessionTitle = text => text.replace(/\s*\(\d+\/\d+\)$/, '');

// 차시 하나의 제목·단계·다음 차시 제목
function sessionView(plan, index) {
    const { modules, sessions } = plan;
    const session = sessions[index];
    const title = sessionTitle(modules, session);
    return {
        session, index, title,
        total: sessions.length,
        last: index === sessions.length - 1,
        plainTitle: plainSessionTitle(title),
        nextTitle: sessions[index + 1] ? plainSessionTitle(sessionTitle(modules, sessions[index + 1])) : '',
        steps: sessionSteps(modules, session, index, sessions.length)
    };
}

// 표지 부제·교수안 개요에 쓰는 차시 내용: 전개 활동 제목, 없으면 수업 제목
function sessionTopics(plan, session) {
    const topics = session.items.filter(item => item.step.phase === '전개').map(item => String(item.step.title || '').trim()).filter(Boolean);
    return [...new Set(topics)].join(' · ') || plan.title;
}

/* ---------- 차시별 교수안 ---------- */
const stepTitles = steps => [...new Set(steps.filter(step => !step.synthetic).map(step => step.item.step.title))];

function frameGuide(step, steps, view) {
    const { index, plainTitle: title, nextTitle } = view;
    const topics = stepTitles(steps);
    if (step.synthetic === 'intro') {
        return [
            `**강사 활동**: ${index > 0 ? '이전 차시에서 다룬 내용을 질문 한두 개로 확인하고, ' : ''}이번 차시의 목표와 진행 순서를 안내한다.`,
            `**설명 내용**: 이번 차시 흐름 - ${topics.join(' → ') || title}.`,
            `**멘트 예시**: "${index > 0 ? '지난 시간에 이어서, ' : ''}이번 시간에는 「${title}」 내용을 다룹니다."`,
            `**학생 활동**: ${index > 0 ? '이전 차시의 핵심을 한 문장으로 떠올려 답한다.' : '이번 차시 목표를 확인하고 궁금한 점을 메모한다.'}`
        ].join('\n');
    }
    return [
        `**강사 활동**: 이번 차시에서 다룬 핵심을 요약하고 ${nextTitle ? '다음 차시에서 이어질 내용을 예고한다.' : '학습 목표에 도달했는지 체크리스트로 확인하게 한다.'}`,
        `**설명 내용**: 핵심 정리 - ${topics.join(' / ') || title}.`,
        `**멘트 예시**: "오늘은 「${title}」 내용을 다뤘습니다.${nextTitle ? ` 다음 시간에는 「${nextTitle}」 내용을 이어 갑니다.` : ''}"`,
        '**학생 활동**: 핵심을 한 문장으로 정리하고 궁금한 점을 적는다.'
    ].join('\n');
}

function sessionStepBody(step, view) {
    if (step.synthetic) return frameGuide(step, view.steps, view);
    return [
        ...(step.item.cont ? ['*앞 차시에서 시작한 활동을 이어서 진행한다.*'] : []),
        step.item.step.body,
        ...(step.item.more ? ['*남은 활동은 다음 차시에 이어서 진행한다.*'] : [])
    ].join('\n\n');
}

function sessionObjectiveLines(plan) {
    return ['## 학습 목표', '', ...(plan.objectives.length ? plan.objectives : ['(교수안의 학습 목표를 입력하세요)']).map(item => `- ${item}`), ''];
}

// 교수안 개요 표에서 소요는 차시 시간으로 바꾸고 나머지는 그대로 쓴다
function sessionOverviewLines(plan, view) {
    const rows = plan.overview.filter(([key]) => !['주제', '소요'].includes(key));
    const subject = rows.filter(([key]) => key === '교과목');
    return [
        '## 개요', '', '| 항목 | 내용 |', '|---|---|',
        ...subject.map(cells => `| ${cells[0]} | ${cells[1]} |`),
        `| 주제 | ${mdCell(plan.title)} |`,
        `| 차시 | ${view.index + 1} / ${view.total}차시 (약 ${fmtMinutes(view.session.minutes)}) |`,
        `| 다루는 내용 | ${mdCell(sessionTopics(plan, view.session))} |`,
        ...rows.filter(([key]) => key !== '교과목').map(cells => `| ${cells[0]} | ${cells[1]} |`),
        ''
    ];
}

function sessionFlowLines(view) {
    return [
        '## 수업 흐름 한눈에 보기', '', '| 단계 | 시간 | 핵심 |', '|---|---|---|',
        ...view.steps.map(step => `| ${step.label} | ${fmtMinutes(step.minutes)} | ${mdCell(step.text)} |`),
        `| **합계** | **${fmtMinutes(view.session.minutes)}** | ${view.index + 1}차시 |`,
        ''
    ];
}

function sessionStudentChecks(steps) {
    const checks = steps.filter(step => !step.synthetic)
        .map(step => (String(step.item.step.body).match(/\*\*학생 활동\*\*\s*[:：]\s*(.+)/) || [])[1])
        .filter(Boolean)
        .map(text => `학생 활동 확인: ${text.trim()}`);
    return [...new Set(checks)];
}

// 체크리스트·문제은행은 수업을 마치는 차시에 확인한다
function sessionAssessmentLines(plan, view) {
    const closing = [
        ...plan.assessment,
        ...(plan.checklist.length || plan.questions ? [[
            plan.checklist.length ? `학습 후 체크리스트 ${plan.checklist.length}항목` : '',
            plan.questions ? `문제은행 ${plan.questions}문항` : ''
        ].filter(Boolean).join(', ') + '으로 학습 목표 도달을 확인한다.'] : [])
    ];
    const items = [
        ...sessionStudentChecks(view.steps),
        ...(view.last ? closing : ['체크리스트는 수업을 마치는 차시에 확인한다.'])
    ];
    return ['## 평가·체크포인트', '', ...(items.length ? items : ['학습 목표 달성 여부를 확인한다.']).map(item => `- ${item}`), ''];
}

function sessionNoteLines(plan, view) {
    const has = key => view.steps.some(step => step.item?.[key]);
    const notes = [
        '각 단계의 시간은 계획 시간이다. 실습 진행 상황에 따라 전개 단계 안에서 조정한다.',
        ...(has('cont') || has('more') ? ["'(이어서)'·'(다음 차시에 계속)'은 한 단계가 차시 경계에 걸쳐 나뉜 것이다."] : []),
        ...(has('trimmed') ? [`차시 도입·정리(각 ${SESSION_FRAME_MINUTES}분)를 넣기 위해 가장 긴 전개 단계에서 시간을 덜었다.`] : []),
        ...plan.notes
    ];
    return ['## 강사 유의사항', '', ...[...new Set(notes)].map(item => `- ${item}`), ''];
}

function sessionPlanLines(plan, index) {
    const view = sessionView(plan, index);
    const slides = plan.slides[index];
    return [
        `# ${index + 1}차시. ${view.title}`, '',
        `- 시간: ${fmtMinutes(view.session.minutes)} (${index + 1}/${view.total}차시)`, '',
        ...sessionObjectiveLines(plan),
        ...sessionOverviewLines(plan, view),
        ...sessionFlowLines(view),
        '## 진행', '',
        ...view.steps.flatMap(step => [`### ${step.heading}`, '', sessionStepBody(step, view), '']),
        ...(slides.length ? ['## 슬라이드', '', ...slides.map(slide => `- ${slide.title}`), ''] : []),
        ...sessionAssessmentLines(plan, view),
        ...sessionNoteLines(plan, view)
    ];
}

function sessionFrontLines(plan, topic, extra = []) {
    const { front, title } = plan;
    return ['---', `교과목: ${front['교과목'] || title}`, `주제: ${topic}`, ...extra]
        .concat(['date', 'status'].filter(key => front[key]).map(key => `${key}: ${front[key]}`), ['---', '']);
}

function gyosuanSessionsMd(mod) {
    const plan = gyosuanSessionPlan(mod);
    if (!plan) return '';
    return [
        ...sessionFrontLines(plan, `${plan.title} (차시별 교수안)`, [`소요: ${plan.sessions.length}차시`]),
        `# 차시별 교수안 - ${plan.title}`, '', ...sessionTableLines(plan.modules),
        ...plan.sessions.flatMap((session, index) => sessionPlanLines(plan, index))
    ].join('\n');
}

// 차시 하나의 교수안 (HTML 내보내기에 내장)
function gyosuanSessionPlanMd(mod, index) {
    const plan = gyosuanSessionPlan(mod);
    return plan?.sessions[index] ? sessionPlanLines(plan, index).join('\n') : '';
}

/* ---------- 차시별 슬라이드 편성안 ---------- */
function slideBlock(title, label, lines) {
    return { title, body: [`- 대응 교수안: ${label}`, ...lines] };
}

function coverSlide(plan, view) {
    return slideBlock('표지', '-', [
        '- 슬라이드 문구:', `  - (제목) ${view.title}`, `  - (부제) ${sessionTopics(plan, view.session)}`,
        `  - (하단) ${view.index + 1}차시 / ${view.total}차시 · ${fmtMinutes(view.session.minutes)}`,
        '- 이미지/시각: 차시 주제를 상징하는 대표 일러스트'
    ]);
}

function tocSlide(view) {
    return slideBlock('목차', view.steps[0]?.label || '도입', [
        '- 슬라이드 문구:', '  - 이번 차시 흐름',
        ...view.steps.map(step => `  - ${step.label}. ${step.text} (${fmtMinutes(step.minutes)})`),
        '- 이미지/시각: 단계를 잇는 흐름 그래픽'
    ]);
}

function objectiveSlide(plan, view) {
    if (!plan.objectives.length) return [];
    return [slideBlock(`학습목표: ${view.plainTitle}`, view.steps[0]?.label || '도입', [
        '- 슬라이드 문구:', ...plan.objectives.map((item, position) => `  - ${position + 1}. ${item}`),
        '- 이미지/시각: 목표 체크 아이콘', '- 핵심 메시지: 이번 차시에서 확인할 목표입니다.'
    ])];
}

// 교수안 단계 번호를 차시 교수안의 번호로 바꾼다
function sessionLabel(steps, label) {
    return steps.find(step => step.item?.step.label === label)?.label || label;
}

function contentSlide(slide, view) {
    const label = sessionLabel(view.steps, slide.label);
    const body = slide.body.replace(/^(\s*-\s*대응\s*교수안:\s*).*$/m, (match, head) => head + label);
    return { title: slide.title, body: [body] };
}

// 슬라이드가 없는 차시는 전개 활동마다 한 장씩 만든다
function fallbackSlides(view) {
    return view.steps.filter(step => step.item?.step.phase === '전개' && step.minutes >= 10).map(step => {
        const title = `${step.item.step.title}${step.item.cont ? ' (이어서)' : ''}`;
        return slideBlock(title, step.label, ['- 슬라이드 문구:', `  - ${step.item.step.title}`, '- 이미지/시각: 관련 이미지', `- 핵심 메시지: ${step.item.step.title}`]);
    });
}

function checklistSlide(plan, view) {
    const closing = plan.checklist.length ? plan.checklist : plan.objectives;
    const items = view.last && closing.length ? closing : stepTitles(view.steps);
    if (!items.length) return [];
    return [slideBlock(`체크리스트: ${view.plainTitle}`, view.steps.at(-1)?.label || '정리', [
        '- 슬라이드 문구:', ...items.map(item => `  - □ ${item}`), '- 이미지/시각: 체크리스트'
    ])];
}

function closingSlide(view) {
    return slideBlock('마무리', view.steps.at(-1)?.label || '정리', [
        '- 슬라이드 문구:', `  - (큰 문구) ${view.index + 1}차시 정리 - ${view.title}`,
        view.nextTitle ? `  - 다음 차시: ${view.nextTitle}` : '  - 체크리스트로 스스로 확인합니다',
        '- 이미지/시각: 다음 단계로 나아가는 장면',
        `- 핵심 메시지: ${view.nextTitle ? '이번 차시 핵심을 확인하고 다음 차시로 이어 갑니다.' : '학습 목표를 확인하고 마무리합니다.'}`
    ]);
}

function sessionDeckLines(plan, index) {
    const view = sessionView(plan, index);
    const content = plan.slides[index].map(slide => contentSlide(slide, view));
    const slides = [
        coverSlide(plan, view), tocSlide(view), ...objectiveSlide(plan, view),
        ...(content.length ? content : fallbackSlides(view)),
        ...checklistSlide(plan, view), closingSlide(view)
    ];
    return [
        `# 슬라이드 편성안 - ${index + 1}차시. ${view.title}`, '', '## 슬라이드 편성', '',
        ...slides.flatMap((slide, position) => [`### 슬라이드 ${position + 1} - ${slide.title}`, ...slide.body, ''])
    ];
}

// 스튜디오가 한 차시를 덱으로 여는 데 쓰는 목록과 편성안
function gyosuanSessionList(mod) {
    const plan = gyosuanSessionPlan(mod);
    return plan ? plan.sessions.map((session, index) => ({ index, title: sessionTitle(plan.modules, session), minutes: session.minutes })) : [];
}

function gyosuanSessionDeckMd(mod, index) {
    const plan = gyosuanSessionPlan(mod);
    if (!plan?.sessions[index]) return '';
    const title = sessionTitle(plan.modules, plan.sessions[index]);
    return [
        ...sessionFrontLines(plan, `${index + 1}차시. ${title}`, [`차시: ${index + 1}/${plan.sessions.length}`]),
        ...sessionDeckLines(plan, index),
        '## 비고', '', `- ${index + 1}차시 편성안 초안입니다. 문구·이미지 제안을 검토해 사용하세요.`, ''
    ].join('\n');
}

// 차시마다 슬라이드 번호를 1번부터 다시 매긴 편성안을 한 파일로 묶는다
function gyosuanSessionDecksMd(mod) {
    const plan = gyosuanSessionPlan(mod);
    if (!plan) return '';
    return [
        ...sessionFrontLines(plan, `${plan.title} (차시별 슬라이드)`),
        ...plan.sessions.flatMap((session, index) => sessionDeckLines(plan, index))
    ].join('\n');
}

function downloadMd(md, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    a.download = `${String(name).replace(/[^\w가-힣]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
}

window.downloadGyosuanSessionDecks = function (moduleId) {
    const mod = getEditingModule(moduleId);
    if (!mod?.gyosuan?.deckMd) return window.showAlert('먼저 슬라이드 편성안을 생성해주세요.');
    const md = gyosuanSessionDecksMd(mod);
    if (!md) return window.showAlert('먼저 교수안을 생성해주세요.');
    downloadMd(resolveGyosuanImages(md, mod), `${mod.title}_차시별편성안`);
};

window.downloadGyosuanSessions = function (moduleId) {
    const mod = getEditingModule(moduleId);
    const md = mod && gyosuanSessionsMd(mod);
    if (!md) return window.showAlert('먼저 교수안을 생성해주세요.');
    downloadMd(resolveGyosuanImages(md, mod), `${mod.title}_차시별교수안`);
};
