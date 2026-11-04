// tutorial.js — 사용 안내: 화면 오른쪽 옆 패널(aside)
// 화면을 덮지 않아 안내를 읽으면서 앱을 그대로 쓸 수 있다. 단계마다 무엇인지·쓰는 순서·알아 둘 점을 보여 주고,
// '화면에서 위치 보기'로 해당 부분에 테두리를 둘러 알려 준다. 접으면 오른쪽 아래 작은 버튼으로 남는다.

const TUTORIAL_KEY = 'kyoan_tutorial_done_v8';
let tutorialStep = 0;
let tutorialHighlightTarget = null;
let tutorialHighlightFrame = 0;
let tutorialWatchTimer = 0;
const TUTORIAL_WATCH_MS = 800; // 안내를 펴 둔 채 화면을 옮기면 짚을 곳이 생기거나 사라진다

// target: 화면에서 짚을 곳(없으면 null). where: 그곳이 지금 화면에 없을 때 어디서 보이는지
const TUTORIAL_STEPS = [
    {
        id: 'start',
        icon: 'ph-flag-banner',
        title: '시작하기 전에',
        target: null,
        summary: '이 도구는 교안 <strong>초안</strong>을 빠르게 만드는 도구입니다. 만든 내용은 반드시 직접 검수한 뒤 쓰세요.',
        what: '과정 → 교과 → 차시 순서로 교육 과정을 세우고, 차시마다 AI로 5탭 교안·교수안·슬라이드·문제은행을 만드는 웹 앱입니다. 서버 없이 이 브라우저 안에서 동작하며, 작업한 내용과 API 키는 이 브라우저에만 저장됩니다.',
        how: [
            '오른쪽 위 <strong>설정(톱니바퀴)</strong>에서 Gemini 또는 Claude API 키를 넣습니다. 키가 없으면 생성할 수 없습니다.',
            '왼쪽 <strong>과정 개요</strong>에서 교과를 만들고 <strong>이 교과 편집기 열기</strong>로 들어갑니다.',
            '왼쪽 목차에서 <strong>AI 차시 목차 생성</strong>으로 차시를 만들고, 차시를 눌러 교안을 생성합니다.',
            '생성된 교안을 읽고 고친 뒤 <strong>내보내기</strong>로 MD·PDF·HTML·슬라이드로 저장합니다.'
        ],
        tips: [
            '빠른 모델(Flash·Haiku)은 빠르고, 고급 모델(Fable·Argon)은 느리지만 내용과 이미지가 훨씬 정확합니다.',
            '브라우저 데이터를 지우면 작업도 사라집니다. 중요한 과정은 <strong>ZIP</strong>이나 <strong>데이터 연동</strong>(프로젝트 폴더)으로 따로 보관하세요.',
            '문제가 생기면 담당자에게 <strong>플로우(Flow)</strong>로 알려 주세요.',
            '이 안내는 언제든 <strong>설정 → 튜토리얼 다시보기</strong>로 다시 열 수 있습니다.'
        ]
    },
    {
        id: 'settings',
        icon: 'ph-gear-six',
        title: '설정',
        target: '#btn-settings',
        summary: 'AI 모델, API 키, 이미지 생성 방식을 정하는 곳입니다. 처음 한 번은 꼭 열어 키를 넣으세요.',
        what: '교안을 쓰는 텍스트 모델과 그림을 만드는 이미지 모델, 각 서비스의 API 키, 교안에 넣을 이미지 양을 정합니다. 모든 값은 이 브라우저에만 저장됩니다.',
        how: [
            '오른쪽 위 <strong>톱니바퀴</strong>를 눌러 설정을 엽니다.',
            '<strong>AI 모델</strong>에서 텍스트 모델과 이미지 모델을 고릅니다.',
            '사용할 서비스의 <strong>API 키</strong>를 넣고 저장합니다. 키 옆 표시가 초록이면 등록된 것입니다.',
            '<strong>교안 이미지 양</strong>에서 태그마다 / ## 섹션마다 한 장 / 넣지 않음을 고릅니다. 줄이면 생성이 빨리 끝납니다.'
        ],
        tips: [
            '<strong>Higgsfield 이미지</strong>는 키와 함께 <strong>중계 주소</strong>(Cloudflare Worker)를 넣어야 합니다. 설정의 안내대로 중계를 한 번 배포하고, 나온 주소를 넣은 뒤 <strong>연결 확인</strong>을 누르세요.',
            '키는 다른 사람과 같이 쓰는 PC에서는 넣지 않는 것이 안전합니다.'
        ]
    },
    {
        id: 'overview',
        icon: 'ph-books',
        title: '과정 개요와 교과',
        target: '#overview-lnb-list',
        where: '과정 개요 화면(처음 화면)의 왼쪽 목록에 있습니다.',
        summary: '과정에 들어갈 교과(과목)를 만들고 고르는 목록입니다.',
        what: '과정 개요 화면의 왼쪽 목록입니다. 교과를 고르면 가운데에 차시 구조 다이어그램이 보이고, 교과 편집기로 들어가 차시를 만들 수 있습니다.',
        how: [
            '<strong>+</strong> 버튼으로 새 교과를 추가하고 이름을 넣습니다.',
            '교과를 눌러 고르면 가운데 다이어그램과 교과 정보가 바뀝니다.',
            '<strong>이 교과 편집기 열기</strong>를 눌러 차시 목록과 교안 편집 화면으로 들어갑니다.',
            '교과 옆 메뉴(⋮)로 이름을 바꾸거나 지웁니다.'
        ],
        tips: [
            '<strong>과정 설계</strong>로 과정 전체를 교과와 블록으로 한 번에 나눌 수 있습니다.',
            '교과 NCS 능력단위는 교과 편집기의 <strong>교과 NCS → 관리</strong>에서 배정·확정합니다.'
        ]
    },
    {
        id: 'diagram',
        icon: 'ph-tree-structure',
        title: '커리큘럼 다이어그램',
        target: '#diagram-viewport',
        where: '과정 개요 화면 가운데에 있습니다.',
        summary: '교과의 차시 구조를 한눈에 보는 지도입니다.',
        what: '고른 교과의 차시와 흐름을 노드로 그립니다. 차시 목차를 만들거나 고치면 자동으로 다시 그려집니다.',
        how: [
            '마우스로 <strong>끌어서</strong> 화면을 옮깁니다.',
            '마우스 <strong>휠</strong>로 확대·축소합니다.',
            '차시 노드를 <strong>누르면</strong> 그 차시 편집 화면으로 갑니다.'
        ],
        tips: ['차시가 많아 복잡하면 휠로 줄여 전체 흐름부터 확인하세요.']
    },
    {
        id: 'toolbar',
        icon: 'ph-toolbox',
        title: '상단 도구 모음',
        target: '#toolbar-scroll',
        summary: '내보내기·보관·기록처럼 과정 전체에 쓰는 버튼이 모여 있습니다.',
        what: '화면 맨 위 줄입니다. 지금 보는 차시나 교과, 또는 과정 전체를 파일로 내보내고, 예전 기록을 되살리고, 작업을 폴더와 연동합니다.',
        how: [
            '<strong>내보내기</strong>: 범위(현재 차시 / 교과 / 전체)를 고른 뒤 MD·PDF·HTML·슬라이드로 저장합니다.',
            '<strong>ZIP</strong>: 고른 교과 또는 전체를 이미지와 함께 압축 파일로 받습니다(백업용으로 좋습니다).',
            '<strong>히스토리</strong>: 이전에 생성한 교안 기록을 보고 되살립니다.',
            '<strong>데이터 연동</strong>: 프로젝트 폴더를 연결해 작업을 PC 폴더에 자동 저장합니다.'
        ],
        tips: [
            '<strong>캐시 보관함</strong>은 이미지 검색 결과를 모아 둔 곳입니다. 용량이 커지면 비우세요.',
            '<strong>컨벤션</strong>에서 교안 작성 규칙을 확인할 수 있습니다. 규칙 검사는 차시 화면의 <strong>컨벤션 검수</strong>로 합니다.'
        ]
    },
    {
        id: 'sidebar',
        icon: 'ph-list-bullets',
        title: '왼쪽 목차와 차시 카드',
        target: '#module-list',
        where: '교과 편집기를 열면 왼쪽에 보입니다.',
        summary: '차시 목록입니다. 위쪽 도구는 접혀 있어 차시 카드가 먼저 보입니다.',
        what: '교과 편집기 왼쪽 패널입니다. 맨 위 <strong>커리큘럼 목차</strong>(주제·참고자료·단원 수·AI 차시 목차 생성)와 <strong>교과 NCS · 교과 일괄 작업 · 교과 정보 및 레벨테스트</strong>는 한 줄로 접혀 있고, 그 아래에 차시 카드가 있습니다. 접고 편 상태는 브라우저에 기억됩니다.',
        how: [
            '<strong>커리큘럼 목차</strong> 줄을 누르면 주제·참고자료 입력과 <strong>AI 차시 목차 생성</strong>이 펼쳐집니다.',
            '차시 카드를 누르면 오른쪽에 그 차시 교안이 열립니다. 제목·설명은 카드에서 바로 고칠 수 있습니다.',
            '카드 오른쪽 위 <strong>✨/↻</strong> 아이콘으로 교안을 만들거나 다시 만듭니다.',
            '카드에 마우스를 올리면 <strong>MD 올리기 · 순서 변경 · 삭제</strong> 아이콘이 나타납니다.'
        ],
        tips: [
            '카드의 <strong>NCS 코드</strong>에 마우스를 올리면 후보 코드와 근거가 보이고, 골라서 확정하거나 코드를 복사할 수 있습니다.',
            '검색칸과 상태 필터(작성중·검수중·완료·개선필요)로 차시를 추려 봅니다.',
            '여러 카드를 체크하면 <strong>병합 재생성</strong>으로 한 차시로 합칠 수 있습니다.',
            '<strong>교과 일괄 작업</strong>의 <strong>남은 차시 생성</strong>으로 비어 있는 차시를 차례로 만듭니다.'
        ]
    },
    {
        id: 'editor',
        icon: 'ph-note-pencil',
        title: '교안 편집 화면',
        target: '#editor-content-area',
        where: '교과 편집기에서 차시를 누르면 오른쪽에 열립니다.',
        summary: 'AI가 만든 교안을 읽고 고치는 핵심 화면입니다.',
        what: '위쪽 탐색줄에서 5탭 교안(기본학습·기본실습·심화학습·심화실습·학습이해도)과 교수안·슬라이드·문제은행을 오갑니다. 학습이해도는 학습 목표마다 1문제 이상, 10문항 이상으로 만듭니다.',
        how: [
            '<strong>이 탭 생성</strong>은 보고 있는 탭만, <strong>전체 생성</strong>은 비어 있는 항목을 교안 탭 → 교수안·슬라이드 → 문제은행 순서로 만듭니다.',
            '긴 작업은 화면을 막지 않고 <strong>오른쪽 아래 진행 막대</strong>에 단계·걸린 시간·남은 이미지 수를 보여 줍니다. 막대의 <strong>중지</strong>로 멈출 수 있습니다.',
            '<strong>보기/수정</strong>으로 마크다운을 직접 고치거나, 보기 화면에서 문단을 <strong>두 번 눌러</strong> 바로 고칩니다.',
            '<strong>보강 명령</strong> 칸에 "예시를 더 추가해줘"처럼 쓰고 <strong>보강 재생성</strong>을 누르면 바뀐 부분을 미리 보고 고를 수 있습니다.'
        ],
        tips: [
            '<strong>컨벤션 검수</strong>는 지금 탭을 작성 규칙으로 검사하고, AI 수정안을 비교해 반영합니다.',
            '아래쪽 명령줄에서 글을 드래그해 고른 뒤 "더 쉽게" 같은 요청을 넣으면 그 부분만 고칩니다.',
            '고치기 전 내용은 작업 히스토리에 남아 되돌릴 수 있습니다.'
        ]
    },
    {
        id: 'tools',
        icon: 'ph-wrench',
        title: '도구 메뉴',
        target: '#lesson-tools-menu',
        where: '차시를 연 화면 오른쪽 위의 <strong>도구</strong> 버튼입니다.',
        summary: '이미지·삽화·복사·판서 영상처럼 교안을 다듬는 기능이 모여 있습니다.',
        what: '차시 편집 화면 위쪽 <strong>도구</strong>를 누르면 펼쳐지는 메뉴입니다.',
        how: [
            '<strong>일괄 이미지 찾기</strong>: 교안의 이미지 자리를 탭마다 채웁니다.',
            '<strong>콘텐츠 정리</strong>: 마크다운 문법 오류를 고치고 빠진 이미지를 만듭니다.',
            '<strong>이미지 삽입 · 이미지 저장</strong>: 내 그림을 넣거나 교안 그림을 JPG로 받습니다.',
            '<strong>섹션 고정</strong>: 다시 생성해도 바꾸지 않을 섹션을 고릅니다.',
            '<strong>삽화</strong>: 교안에 맞는 SVG 삽화를 만들어 본문에 넣습니다.',
            '<strong>복사</strong>: 지금 탭의 마크다운을 복사합니다.',
            '<strong>판서 영상</strong>: 이 차시 교안으로 나레이션이 있는 판서 영상을 만듭니다(다음 단계에서 자세히).'
        ],
        tips: ['그림 위의 <strong>다시 생성</strong> 버튼으로 그림 한 장만 새로 만들 수도 있습니다.']
    },
    {
        id: 'whiteboard',
        icon: 'ph-chalkboard-teacher',
        title: '판서 영상',
        target: '#lesson-tools-menu',
        where: '차시 화면의 <strong>도구 → 판서 영상</strong>, 또는 보기 화면의 교안 그림 위에 있습니다.',
        summary: '교안 내용으로 칠판에 그리듯 설명하는 나레이션 영상을 만들고, 교안 그림을 그 영상으로 바꿀 수 있습니다.',
        what: '같은 주소에 있는 <strong>화이트보드 교안 스튜디오</strong>와 연결된 기능입니다. Teacher가 교안 내용을 넘기면 스튜디오가 5장면 판서 수업과 나레이션을 만들고, 영상으로 내보내거나 Teacher로 돌려보냅니다.',
        how: [
            '<strong>도구 → 판서 영상</strong>을 누르면 <strong>판서 영상 만들기</strong> 창이 열립니다. 주제와 담을 내용(차시 교안)이 채워져 있으니 지우거나 직접 써넣으세요.',
            '<strong>스튜디오에서 만들기</strong>를 누르면 새 탭에 스튜디오가 열립니다. Gemini 키를 넣고 <strong>판서 수업 생성하기</strong>를 누릅니다.',
            '교안 <strong>그림에 마우스를 올리면</strong> <strong>판서 영상으로 바꾸기</strong>가 나옵니다. 그 그림이 든 절의 글로 창이 열립니다.',
            '스튜디오에서 수업을 만든 뒤 <strong>Teacher로 보내기</strong>를 누르고 Teacher 탭으로 돌아오면 그 그림 자리가 영상으로 바뀝니다.'
        ],
        tips: [
            '영상 위의 <strong>원래 그림으로</strong>로 언제든 되돌릴 수 있습니다.',
            '교안 글은 바뀌지 않아 PDF·슬라이드·MD에는 원래 그림이 나갑니다. 현재 차시 <strong>HTML 내보내기</strong>에는 영상이 파일 안에 들어갑니다.',
            '영상은 이 브라우저에만 저장됩니다. 다른 PC에서는 원래 그림으로 보입니다.'
        ]
    },
    {
        id: 'slides',
        icon: 'ph-presentation-chart',
        title: '교수안과 슬라이드',
        target: '#editor-content-area',
        where: '차시 화면 탐색줄의 <strong>교수안 · 슬라이드</strong>입니다.',
        summary: '교안으로 만든 교수안과 슬라이드 편성안을 고쳐 PPTX·HTML로 내보냅니다.',
        what: '교수안은 강사용 진행 계획이고, 슬라이드는 그 교수안으로 만든 발표 자료입니다. 슬라이드 스튜디오에서 글과 그림을 직접 고칩니다.',
        how: [
            '탐색줄에서 <strong>교수안</strong>을 눌러 만들거나 확인합니다.',
            '<strong>슬라이드</strong>에서 스튜디오를 열고, 글자를 눌러 고치거나 이미지 칸에 파일·AI 그림을 넣습니다.',
            '고친 내용은 차시에 저장되며 <strong>PPTX · HTML</strong>로 내보냅니다.'
        ],
        tips: [
            '편집 단축키: <strong>Ctrl+Z</strong> 되돌리기, <strong>Ctrl+C/X/V</strong> 복사·잘라내기·붙여넣기, <strong>Delete</strong> 삭제, <strong>Esc</strong> 선택 해제.',
            '보기 모드에서는 <strong>← →</strong>로 슬라이드를 넘깁니다.'
        ]
    },
    {
        id: 'course',
        icon: 'ph-compass',
        title: '과정 전체 작업',
        target: '#module-list',
        where: '교과 편집기 왼쪽의 <strong>교과 일괄 작업</strong> 줄을 펼치면 보입니다.',
        summary: '차시 하나가 아니라 교과·과정 단위로 한 번에 하는 일입니다.',
        what: '여러 차시를 차례로 만들거나, 교과의 차시 구성을 다시 짜거나, 과정 전체 자료를 묶어 내려받습니다.',
        how: [
            '<strong>남은 차시 생성</strong>: 내용이 빈 탭만 차례로 만듭니다(이미 만든 내용도 다시 만들도록 고를 수 있습니다).',
            '<strong>차시 구성 · 블록 다시 설계</strong>: 차시 제목과 시간을 보고 고치거나 AI로 다시 나눕니다.',
            '<strong>교수안·편성안 묶음 · 교육 자료</strong>: 교과 또는 과정 전체를 한 파일로 받습니다.',
            '<strong>기존 내용 보강</strong>: 예전에 만든 교과·차시에 NCS와 삽화를 채웁니다.'
        ],
        tips: [
            '차시 카드의 <strong>차시 정보</strong>에서 학습 목표, 진행 단계, 툴·버전, NCS 요소, 변경 이력을 고칩니다.',
            '<strong>문제은행</strong>은 학습 목표와 밴드별로 문항을 만들고 고칩니다.'
        ]
    }
];

/* ---------- 그리기 ---------- */
const tutorialList = items => (items?.length ? items.map(item => `<li>${item}</li>`).join('') : '');

// 한 단계의 본문. 단계 내용은 앱이 직접 쓴 글이라 <strong> 같은 태그를 그대로 쓴다
function tutorialStepHtml(step, index, total, targetShown) {
    const locate = !step.target ? ''
        : targetShown
            ? `<button type="button" class="tutorial-locate" data-tutorial-action="locate"><i class="ph-bold ph-crosshair"></i> 화면에서 위치 보기</button>`
            : `<p class="tutorial-where"><i class="ph-bold ph-info"></i> 지금 화면에는 없습니다. ${step.where || ''}</p>`;
    return `
        <p class="tutorial-kicker">${index + 1} / ${total}단계</p>
        <h3 class="tutorial-title"><i class="ph-fill ${step.icon}"></i> ${step.title}</h3>
        <p class="tutorial-summary">${step.summary}</p>
        ${locate}
        <section class="tutorial-section"><h4>무엇인가요?</h4><p>${step.what}</p></section>
        <section class="tutorial-section"><h4>이렇게 쓰세요</h4><ol>${tutorialList(step.how)}</ol></section>
        ${step.tips?.length ? `<section class="tutorial-section tutorial-tips"><h4>알아 두면 좋아요</h4><ul>${tutorialList(step.tips)}</ul></section>` : ''}`;
}

function tutorialTocHtml(current) {
    return TUTORIAL_STEPS.map((step, index) => `
        <li><button type="button" data-tutorial-step="${index}" class="${index === current ? 'is-current' : ''}" ${index === current ? 'aria-current="step"' : ''}>
            <span class="tutorial-toc-num">${index + 1}</span> ${step.title}</button></li>`).join('');
}

function tutorialTarget(step) {
    const el = step?.target ? document.querySelector(step.target) : null;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? el : null;
}

/* ---------- 위치 표시: 화면을 어둡게 하지 않고 테두리만 두른다 ---------- */
function placeTutorialHighlight() {
    const box = document.getElementById('tutorial-highlight');
    const el = tutorialHighlightTarget;
    if (!box) return;
    if (!el || !el.isConnected) { box.hidden = true; return; }
    const rect = el.getBoundingClientRect();
    const pad = 6;
    box.hidden = rect.width === 0 && rect.height === 0;
    Object.assign(box.style, {
        left: `${rect.left - pad}px`, top: `${rect.top - pad}px`,
        width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px`
    });
}

function followTutorialHighlight() {
    cancelAnimationFrame(tutorialHighlightFrame);
    const loop = () => {
        placeTutorialHighlight();
        if (tutorialHighlightTarget) tutorialHighlightFrame = requestAnimationFrame(loop);
    };
    loop();
}

function highlightTutorialTarget(el, { scroll = false } = {}) {
    tutorialHighlightTarget = el;
    let box = document.getElementById('tutorial-highlight');
    if (!box) {
        box = document.createElement('div');
        box.id = 'tutorial-highlight';
        box.className = 'tutorial-highlight';
        box.setAttribute('aria-hidden', 'true');
        document.body.appendChild(box);
    }
    if (scroll && el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    box.classList.remove('is-pulsing');
    void box.offsetWidth; // 다시 누를 때마다 깜빡임을 새로 시작한다
    if (el) box.classList.add('is-pulsing');
    followTutorialHighlight();
}

function clearTutorialHighlight() {
    tutorialHighlightTarget = null;
    cancelAnimationFrame(tutorialHighlightFrame);
    clearInterval(tutorialWatchTimer);
    document.getElementById('tutorial-highlight')?.remove();
}

/* ---------- 옆 패널 ---------- */
function tutorialAside() {
    let aside = document.getElementById('tutorial-aside');
    if (aside) return aside;
    aside = document.createElement('aside');
    aside.id = 'tutorial-aside';
    aside.className = 'tutorial-aside';
    aside.setAttribute('aria-label', '사용 안내');
    aside.innerHTML = `
        <div class="tutorial-head">
            <div class="tutorial-head-title"><i class="ph-fill ph-graduation-cap"></i> 사용 안내</div>
            <span class="tutorial-progress" data-tutorial-progress></span>
            <button type="button" class="tutorial-icon-btn" data-tutorial-action="minimize" title="접기 (Esc)" aria-label="안내 접기"><i class="ph-bold ph-caret-double-right"></i></button>
            <button type="button" class="tutorial-icon-btn" data-tutorial-action="close" title="안내 닫기" aria-label="안내 닫기"><i class="ph-bold ph-x"></i></button>
        </div>
        <div class="tutorial-bar" aria-hidden="true"><span data-tutorial-bar></span></div>
        <details class="tutorial-toc"><summary>전체 목차</summary><ol data-tutorial-toc></ol></details>
        <div class="tutorial-body" data-tutorial-body tabindex="-1"></div>
        <div class="tutorial-foot">
            <label class="tutorial-dont-show"><input type="checkbox" id="tutorial-dont-show-check"> 다시 보지 않기</label>
            <div class="tutorial-foot-nav">
                <button type="button" class="tutorial-prev-btn" data-tutorial-action="prev">← 이전</button>
                <button type="button" class="tutorial-next-btn" data-tutorial-action="next"></button>
            </div>
        </div>`;
    aside.addEventListener('click', onTutorialClick);
    aside.addEventListener('keydown', event => { if (event.key === 'Escape') minimizeTutorial(); });
    // 다시 보지 않기는 고르는 즉시 기억한다 (접어 둔 채 창을 닫아도 다음에 열리지 않게)
    aside.addEventListener('change', event => {
        if (event.target.id !== 'tutorial-dont-show-check') return;
        try {
            if (event.target.checked) localStorage.setItem(TUTORIAL_KEY, 'true');
            else localStorage.removeItem(TUTORIAL_KEY);
        } catch (e) { console.warn('[사용 안내] 다시 보지 않기를 저장하지 못했습니다:', e); }
    });
    document.body.appendChild(aside);
    return aside;
}

function onTutorialClick(event) {
    const stepButton = event.target.closest('[data-tutorial-step]');
    if (stepButton) {
        stepButton.closest('details')?.removeAttribute('open');
        return showTutorialStep(Number(stepButton.dataset.tutorialStep));
    }
    const action = event.target.closest('[data-tutorial-action]')?.dataset.tutorialAction;
    if (action === 'next') nextTutorialStep();
    else if (action === 'prev') showTutorialStep(tutorialStep - 1);
    else if (action === 'locate') highlightTutorialTarget(tutorialTarget(TUTORIAL_STEPS[tutorialStep]), { scroll: true });
    else if (action === 'minimize') minimizeTutorial();
    else if (action === 'close') endTutorial();
}

// 짚을 곳이 화면에 나타나거나 사라지면 본문(위치 보기 / 어디서 보이는지)과 테두리를 맞춘다
function watchTutorialTarget() {
    clearInterval(tutorialWatchTimer);
    tutorialWatchTimer = setInterval(() => {
        const aside = document.getElementById('tutorial-aside');
        if (!aside || aside.classList.contains('is-hidden')) return clearInterval(tutorialWatchTimer);
        const shown = !!tutorialTarget(TUTORIAL_STEPS[tutorialStep]);
        if (shown !== (aside.dataset.targetShown === 'true')) showTutorialStep(tutorialStep, { keepScroll: true });
    }, TUTORIAL_WATCH_MS);
}

function showTutorialStep(index, { keepScroll = false } = {}) {
    const total = TUTORIAL_STEPS.length;
    tutorialStep = Math.max(0, Math.min(index, total - 1));
    const step = TUTORIAL_STEPS[tutorialStep];
    const aside = tutorialAside();
    document.getElementById('tutorial-reopen')?.remove();
    aside.classList.remove('is-hidden');
    document.documentElement.classList.add('tutorial-docked'); // 넓은 화면에서는 앱을 패널 폭만큼 좁혀 나란히 둔다
    const target = tutorialTarget(step);
    const body = aside.querySelector('[data-tutorial-body]');
    const scrollTop = body.scrollTop;
    aside.dataset.targetShown = String(!!target);
    body.innerHTML = tutorialStepHtml(step, tutorialStep, total, !!target);
    body.scrollTop = keepScroll ? scrollTop : 0;
    aside.querySelector('[data-tutorial-toc]').innerHTML = tutorialTocHtml(tutorialStep);
    aside.querySelector('[data-tutorial-progress]').textContent = `${tutorialStep + 1} / ${total}`;
    aside.querySelector('[data-tutorial-bar]').style.width = `${((tutorialStep + 1) / total) * 100}%`;
    aside.querySelector('[data-tutorial-action="prev"]').disabled = tutorialStep === 0;
    aside.querySelector('[data-tutorial-action="next"]').textContent = tutorialStep === total - 1 ? '완료' : '다음 →';
    highlightTutorialTarget(target);
    watchTutorialTarget();
}

// 처음 열 때(또는 다시보기) 시작 단계부터 보여 준다. 화면은 막지 않는다
function startTutorial(index = 0) {
    showTutorialStep(index);
    setTimeout(() => document.querySelector('#tutorial-aside [data-tutorial-body]')?.focus({ preventScroll: true }), 50);
}

function nextTutorialStep() {
    if (tutorialStep >= TUTORIAL_STEPS.length - 1) return endTutorial();
    showTutorialStep(tutorialStep + 1);
}

// 접으면 오른쪽 아래 작은 버튼으로 남아 이어서 볼 수 있다
function minimizeTutorial() {
    const aside = document.getElementById('tutorial-aside');
    if (!aside) return;
    aside.classList.add('is-hidden');
    document.documentElement.classList.remove('tutorial-docked');
    clearTutorialHighlight();
    if (document.getElementById('tutorial-reopen')) return;
    const reopen = document.createElement('button');
    reopen.type = 'button';
    reopen.id = 'tutorial-reopen';
    reopen.className = 'tutorial-reopen';
    reopen.innerHTML = `<i class="ph-fill ph-graduation-cap"></i> 사용 안내 ${tutorialStep + 1}/${TUTORIAL_STEPS.length}`;
    reopen.onclick = () => showTutorialStep(tutorialStep);
    document.body.appendChild(reopen);
}

function skipTutorial() {
    endTutorial();
}

function endTutorial() {
    const check = document.getElementById('tutorial-dont-show-check');
    if (check && check.checked) {
        try { localStorage.setItem(TUTORIAL_KEY, 'true'); } catch (e) { console.warn('[사용 안내] 다시 보지 않기를 저장하지 못했습니다:', e); }
    }
    clearTutorialHighlight();
    document.documentElement.classList.remove('tutorial-docked');
    document.getElementById('tutorial-aside')?.remove();
    document.getElementById('tutorial-reopen')?.remove();
}

function restartTutorial() {
    try { localStorage.removeItem(TUTORIAL_KEY); } catch (e) { console.warn('[사용 안내] 저장값을 지우지 못했습니다:', e); }
    startTutorial(0);
}

// 처음 방문했거나 '다시 보지 않기'를 고르지 않았으면 열어 둔다
function shouldAutoStartTutorial() {
    try { return localStorage.getItem(TUTORIAL_KEY) !== 'true'; } catch (e) { return false; }
}
