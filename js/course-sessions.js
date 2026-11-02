// course-sessions.js - 1차시(1시간) 단위 분할과 차시별 교수안
// 분할 규칙은 develocket-slide(assets/course-sessions.js @3a7303f)를 따른다.
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
    if (target) target.minutes -= SESSION_FRAME_MINUTES;
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

// 차시 구성표의 내용. 시간이 없으면 빈 목록이다
function sessionRows(modules) {
    const sessions = splitSessions(modules);
    if (sessions.every(session => !session.minutes)) return [];
    return sessions.map((session, index) => ({ title: sessionTitle(modules, session), minutes: session.minutes, steps: sessionSteps(modules, session, index, sessions.length) }));
}

function sessionTableLines(modules, separator = '<br>') {
    const rows = sessionRows(modules).map((row, index) => {
        const steps = row.steps.map(step => `${step.label} ${step.text} (${fmtMinutes(step.minutes)})`);
        return `| ${index + 1}차시. ${mdCell(row.title)} | ${fmtMinutes(row.minutes)} | ${mdCell(steps.join(separator))} |`;
    });
    return rows.length ? ['### 차시 구성 (1차시 = 1시간)', '', '| 차시 | 시간 | 진행 단계 |', '|---|---|---|', ...rows, ''] : [];
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

function frameGuide(step, index, title, nextTitle) {
    if (step.synthetic === 'intro') {
        return [
            `**강사 활동**: ${index > 0 ? '이전 차시에서 다룬 내용을 질문 한두 개로 확인하고, ' : ''}이번 차시의 목표와 진행 순서를 안내한다.`,
            `**멘트 예시**: "${index > 0 ? '지난 시간에 이어서, ' : ''}이번 시간에는 「${title}」 내용을 다룹니다."`,
            `**학생 활동**: ${index > 0 ? '이전 차시의 핵심을 한 문장으로 떠올려 답한다.' : '이번 차시 목표를 확인하고 궁금한 점을 메모한다.'}`
        ].join('\n');
    }
    return [
        `**강사 활동**: 이번 차시에서 다룬 핵심을 요약하고 ${nextTitle ? '다음 차시에서 이어질 내용을 예고한다.' : '학습 목표에 도달했는지 체크리스트로 확인하게 한다.'}`,
        `**멘트 예시**: "오늘은 「${title}」 내용을 다뤘습니다.${nextTitle ? ` 다음 시간에는 「${nextTitle}」 내용을 이어 갑니다.` : ''}"`,
        '**학생 활동**: 핵심을 한 문장으로 정리하고 궁금한 점을 적는다.'
    ].join('\n');
}

function parseDeckSlides(deckMd) {
    return String(deckMd || '').split(/^(?=###\s*슬라이드)/m).filter(block => /^###\s*슬라이드/.test(block)).map(block => ({
        title: block.split('\n')[0].replace(/^###\s*슬라이드\s*\d*\s*-?\s*/, '').trim(),
        label: (block.match(/대응\s*교수안:\s*(.+)/) || [])[1]?.trim() || '',
        body: block.split('\n').slice(1).join('\n').trim()
    }));
}

// 편성안 슬라이드를 대응 교수안(도입·전개 N·정리)별로 묶는다
function deckSlidesByLabel(deckMd) {
    return parseDeckSlides(deckMd).reduce((groups, slide) => ({ ...groups, [slide.label]: [...(groups[slide.label] || []), slide] }), {});
}

function sessionStepBody(step, index, title, nextTitle) {
    if (step.synthetic) return frameGuide(step, index, title, nextTitle);
    return step.item.cont ? '앞 차시에서 시작한 활동을 이어서 진행한다.' : step.item.step.body;
}

function sessionBlockLines(modules, session, index, sessions, deck) {
    const title = sessionTitle(modules, session);
    const plainTitle = text => text.replace(/\s*\(\d+\/\d+\)$/, '');
    const nextTitle = sessions[index + 1] ? plainTitle(sessionTitle(modules, sessions[index + 1])) : '';
    const steps = sessionSteps(modules, session, index, sessions.length);
    const slides = sessionLabels(session, index).flatMap(label => deck[label] || []);
    return [
        `# ${index + 1}차시. ${title}`, '',
        `- 시간: ${fmtMinutes(session.minutes)} (${index + 1}/${sessions.length}차시)`, '',
        ...steps.flatMap(step => [`## ${step.heading}`, '', sessionStepBody(step, index, plainTitle(title), nextTitle), '']),
        ...(slides.length ? ['## 슬라이드', '', ...slides.map(slide => `- ${slide.title}`), ''] : [])
    ];
}

function gyosuanSessionsMd(mod) {
    const flow = gyosuanFlow(mod);
    if (!flow.length) return '';
    const modules = [{ title: mod.title, minutes: flow.reduce((sum, step) => sum + step.minutes, 0), flow }];
    const sessions = splitSessions(modules);
    const deck = deckSlidesByLabel(mod.gyosuan.deckMd);
    return [
        `# 차시별 교수안 - ${mod.title}`, '', ...sessionTableLines(modules),
        ...sessions.flatMap((session, index) => sessionBlockLines(modules, session, index, sessions, deck))
    ].join('\n');
}

// 표지·목차처럼 교수안 단계에 대응하지 않는 슬라이드는 첫 차시에 싣는다
function sessionLabels(session, index) {
    return [...(index === 0 ? ['-'] : []), ...new Set(session.items.filter(item => !item.cont).map(item => item.step.label))];
}

// 차시마다 슬라이드 번호를 1번부터 다시 매긴 편성안
function gyosuanSessionDecksMd(mod) {
    const flow = gyosuanFlow(mod);
    if (!flow.length) return '';
    const modules = [{ title: mod.title, minutes: flow.reduce((sum, step) => sum + step.minutes, 0), flow }];
    const deck = deckSlidesByLabel(mod.gyosuan.deckMd);
    const sessions = splitSessions(modules);
    return sessions.flatMap((session, index) => {
        const slides = sessionLabels(session, index).flatMap(label => deck[label] || []);
        return [
            `# 슬라이드 편성안 - ${index + 1}차시. ${sessionTitle(modules, session)}`, '', '## 슬라이드 편성', '',
            ...slides.flatMap((slide, slideIndex) => [`### 슬라이드 ${slideIndex + 1} - ${slide.title}`, slide.body, '']),
            ...(slides.length ? [] : ['이 차시에 대응하는 슬라이드가 없습니다.', ''])
        ];
    }).join('\n');
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
    downloadMd(md, `${mod.title}_차시별편성안`);
};

window.downloadGyosuanSessions = function (moduleId) {
    const mod = getEditingModule(moduleId);
    const md = mod && gyosuanSessionsMd(mod);
    if (!md) return window.showAlert('먼저 교수안을 생성해주세요.');
    downloadMd(md, `${mod.title}_차시별교수안`);
};
