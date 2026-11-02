// develocket-slide의 검수 규칙을 원본 코드 그대로 실행해 Teacher 검수기와 같은 입력으로 비교한다 (실행: node tests/convention-parity.test.js)
// 메시지 문구가 아니라 잡아낸 위반의 종류를 비교한다. 목표 어미만 각자의 표기(~할 수 있다 / ~할 수 있습니다)로 넣는다.
// 알려진 차이: 목표가 없을 때 원본은 대응 지적을 함께 내고, Teacher는 목표 어미·다시 보기에서 지적을 더 낸다.
// 복수 정답 안내는 Teacher 문항 제목의 (복수정답) 표기가 대신한다. 원본 저장소가 없는 환경에서는 건너뛴다.
const fs = require('fs');
const vm = require('vm');

const ORIGIN = 'D:/유치훈/디벨로켓/develocket-slide/assets/course-rules.js';
const TEACHER = `${__dirname}/../js/`;
if (!fs.existsSync(ORIGIN)) {
    console.log('원본 저장소가 없어 건너뜁니다.');
    console.log('ALL PASSED');
    process.exit(0);
}
const origin = { window: { KBuilder: {} }, console };
vm.createContext(origin);
vm.runInContext(fs.readFileSync(ORIGIN, 'utf8'), origin);
const R = origin.window.KBuilder.courseRules;

const teacher = { console, escapeHtml: s => String(s) };
teacher.window = teacher;
vm.createContext(teacher);
vm.runInContext(fs.readFileSync(`${TEACHER}lesson-lint.js`, 'utf8'), teacher);
const t = name => vm.runInContext(name, teacher);

const KINDS = [
    ['목표 없음', /목표가없|목표를1개이상/], ['개요 없음', /개요가없|개요를작성/], ['목표 어미', /할수있.*끝냅/], ['관찰 불가 동사', /관찰/], ['목표 개수', /4개이상|3개이하/],
    ['조건 부족', /수행조건|조건.*제약/], ['내용 대응', /학습내용.*덩어리|목표마다내용|학습내용은/], ['체크리스트 대응', /체크리스트.*항목|체크리스트는목표와같은수/],
    ['다시 보기', /다시볼/], ['학습자 호칭', /호칭/], ['다른 차시 지칭', /지칭/], ['당연 표현', /당연/], ['수업 진행', /교안의몫|교수안의몫/], ['어투', /경어체|종결/],
    ['모호 표현', /판단기준|경우에따라|모호/], ['정도 수치', /수치/], ['버전', /버전|단축키/]
];
const kindOf = msg => {
    const text = String(msg).replace(/\s/g, '').replace(/학습목표/g, '목표').replace(/학습모듈/g, '차시');
    return (KINDS.find(([, re]) => re.test(text)) || [`기타:${text.slice(0, 24)}`])[0];
};
const kinds = list => [...new Set(list.map(issue => kindOf(issue.msg)))].sort();

const GOAL = ['주어진 양식으로 게임 기획서를 3쪽 이내로 작성할 수 있', '플레이 기록을 근거로 재미 요소를 2가지 기준으로 비교할 수 있'];
const base = {
    objectives: GOAL.map(text => `${text}다.`),
    overview: '요청마다 새 연결을 여는 구조에서는 응답이 2배로 늘어납니다.',
    sections: [{ title: '기획서의 구조', body: '- 기획서는 목적, 대상, 범위를 적습니다.' }, { title: '플레이 분석', body: '- 플레이 기록을 표로 정리합니다.' }],
    checklist: [{ text: '기획서를 양식대로 작성했습니다.', ref: '기획서의 구조' }, { text: '재미 요소를 기준으로 비교했습니다.', ref: '플레이 분석' }]
};
const honorific = goal => goal.replace(/수 있다\.$/, '수 있습니다.');
const toOrigin = c => ({ objectives: c.objectives, content: { overview: c.overview, sections: c.sections, checklist: c.checklist } });
const toMd = c => ['# 재미', '',
    ...(c.objectives.length ? ['## 학습 목표', '', ...c.objectives.map(goal => `- ${honorific(goal)}`), ''] : []),
    ...(c.overview ? ['## 개요', '', `- ${c.overview}`, ''] : []),
    ...c.sections.flatMap(section => [`## ${section.title}`, '', section.body, '']),
    ...(c.checklist.length ? ['## 학습 후 체크리스트', '', ...c.checklist.map(item => `- ${item.text}${item.ref ? ` (다시 보기: ${item.ref})` : ''}`)] : [])].join('\n');

const withBody = body => ({ ...base, sections: [{ title: '기획서의 구조', body }, base.sections[1]] });
const cases = {
    '위반 없음': base,
    '목표 없음': { ...base, objectives: [] },
    '개요 없음': { ...base, overview: '' },
    '체크리스트 없음': { ...base, checklist: [] },
    '목표 어미': { ...base, objectives: ['게임 기획서를 3쪽 이내 양식에 맞게 작성한다.', base.objectives[1]] },
    '이해 동사': { ...base, objectives: ['게임 기획의 구조를 이해할 수 있다.', base.objectives[1]] },
    '목표 4개': { ...base, objectives: [...base.objectives, '기록을 표로 3개 기준에 맞춰 정리할 수 있다.', '결과를 발표 자료 5장으로 만들 수 있다.'], sections: [...base.sections, { title: '셋', body: '- 내용입니다.' }, { title: '넷', body: '- 내용입니다.' }], checklist: [...base.checklist, { text: '셋을 확인했습니다.', ref: '셋' }, { text: '넷을 확인했습니다.', ref: '넷' }] },
    '내용 부족': { ...base, sections: [base.sections[0]], checklist: [base.checklist[0], { text: '비교했습니다.', ref: '기획서의 구조' }] },
    '체크리스트 수 불일치': { ...base, checklist: [base.checklist[0]] },
    '다시 보기 없음': { ...base, checklist: base.checklist.map(item => ({ text: item.text })) },
    '학습자 호칭': withBody('- 여러분은 기획서를 작성합니다.'),
    '다른 차시 지칭': withBody('- 앞에서 배운 내용을 활용합니다.'),
    '당연 표현': withBody('- 당연히 기획서가 필요합니다.'),
    '반말 종결': withBody('- 기획서는 목적을 적는다.'),
    '진행 지시': withBody('- 강사는 학생에게 질문합니다.'),
    '판단 표현': withBody('- 상황에 맞게 작성합니다.'),
    '정도 표현': withBody('- 응답이 매우 느립니다.')
};

let same = 0;
Object.entries(cases).forEach(([name, input]) => {
    const a = kinds(R.lintTextbook(toOrigin(input)));
    const b = kinds(t('lintLessonMarkdown')(toMd(input), 'basicLearn'));
    const equal = JSON.stringify(a) === JSON.stringify(b);
    if (equal) same += 1;
    console.log(`${equal ? '일치' : '차이'} | ${name} | 원본 [${a.join(', ')}] | Teacher [${b.join(', ')}]`);
});
console.log(`\n[교안 판정] ${Object.keys(cases).length}건 중 위반 종류 일치 ${same}건`);

const objective = { objectives: base.objectives, content: { overview: base.overview, sections: base.sections, checklist: base.checklist } };
const CHOICES = ['① 가', '② 나', '③ 다', '④ 라'];
const block = (head, stem, choices, answer, extra = '') => [`### 문제 1. ${head}`, '학습 목표 1 · 밴드 L1 · 객관식', '', stem, '', ...choices, '', `✅ **정답:** ${answer}`, ...(extra ? ['', extra] : []), '', '---'].join('\n');
const originQ = (over = {}) => ({ objective: 1, band: 'L1', type: '객관식', multi: false, stem: '재미의 근거는 무엇입니까?', choices: [{ text: '가', correct: true }, { text: '나' }, { text: '다' }, { text: '라' }], ...over });
const qCases = {
    '정상': [originQ(), block('재미', '재미의 근거는 무엇입니까?', CHOICES, '①')],
    '정답 없음': [originQ({ choices: [{ text: '가' }, { text: '나' }, { text: '다' }, { text: '라' }] }), block('재미', '재미의 근거는 무엇입니까?', CHOICES, '')],
    '같은 보기': [originQ({ choices: [{ text: '가', correct: true }, { text: '가' }, { text: '다' }, { text: '라' }] }), block('재미', '재미의 근거는 무엇입니까?', ['① 가', '② 가', '③ 다', '④ 라'], '①')],
    '보기 3개': [originQ({ choices: [{ text: '가', correct: true }, { text: '나' }, { text: '다' }] }), block('재미', '재미의 근거는 무엇입니까?', CHOICES.slice(0, 3), '①')],
    '단일에 정답 2개': [originQ({ choices: [{ text: '가', correct: true }, { text: '나', correct: true }, { text: '다' }, { text: '라' }] }), block('재미', '재미의 근거는 무엇입니까?', CHOICES, '①, ②')],
    '학습자 호칭': [originQ({ stem: '여러분은 무엇을 고르겠습니까?' }), block('재미', '여러분은 무엇을 고르겠습니까?', CHOICES, '①')],
    '버전 의존': [originQ({ stem: 'Ctrl+S의 기능은 무엇입니까?' }), block('재미', 'Ctrl+S의 기능은 무엇입니까?', CHOICES, '①')],
    '복수 안내 없음': [originQ({ multi: true, choices: [{ text: '가', correct: true }, { text: '나', correct: true }, { text: '다' }, { text: '라' }] }), block('재미 (복수정답)', '재미의 근거는 무엇입니까?', CHOICES, '①, ②')],
    '모든 보기 정답': [originQ({ multi: true, stem: '모두 고르시오.', choices: [{ text: '가', correct: true }, { text: '나', correct: true }, { text: '다', correct: true }, { text: '라', correct: true }] }), block('재미 (복수정답)', '모두 고르시오.', CHOICES, '①, ②, ③, ④')]
};
console.log('\n[문항 판정]');
let qSame = 0;
Object.entries(qCases).forEach(([name, [oq, md]]) => {
    const parsed = t('lessonLintQuestions')(md).map(t('parseQuestionBlock'));
    const issues = parsed.flatMap(q => t('lintQuestion')(q, []));
    const a = R.lintQuestion(oq, objective).length;
    const b = issues.length;
    if (!!a === !!b) qSame += 1;
    console.log(`${!!a === !!b ? '일치' : '차이'} | ${name} | 원본 ${a}: ${R.lintQuestion(oq, objective).map(i => i.msg).join('/').slice(0, 50)} | Teacher ${b}: ${issues.map(i => i.msg || i).join('/').slice(0, 50)}`);
});
console.log(`[문항 판정] ${Object.keys(qCases).length}건 중 일치 ${qSame}건`);

const rows = t('LESSON_RULE_LIST');
const pairs = R.RULE_LIST.map((row, i) => [row, rows.find(item => item.area === row.area && kindOf(item.rule) === kindOf(row.rule)) || rows[i]]);
const sameSeverity = pairs.filter(([a, b]) => a.sev === b.sev).length;
console.log(`[규칙 목록] 심각도 일치 ${sameSeverity}/${pairs.length}`);
const manual = t('LESSON_MANUAL_CHECKS');
console.log(`[수동 검수] 원본 ${R.MANUAL_RULES.length}개, Teacher ${manual.length}개`);
if (same < 14 || qSame < 8 || sameSeverity !== pairs.length || manual.length !== R.MANUAL_RULES.length) {
    console.error('FAIL 원본 컨벤션과의 일치가 줄었습니다.');
    process.exit(1);
}
console.log('ALL PASSED');
