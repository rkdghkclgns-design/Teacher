// tutorial.js — 화면으로 따라 하는 사용 가이드
// 왼쪽은 작업별 바로가기, 오른쪽은 실제 화면 캡처(예시 데이터)에 번호를 붙이고 같은 번호로 설명한다.
// 캡처와 번호 위치는 scripts/capture-guide.js가 만든 guide/*.jpg와 js/guide-shots.js(GUIDE_SHOTS)를 쓴다.

const TUTORIAL_KEY = 'kyoan_tutorial_done_v8';
let tutorialStep = 0;
let tutorialReturnFocus = null;

// shot: GUIDE_SHOTS의 캡처 이름. points는 캡처 속 번호 순서와 같다
const TUTORIAL_STEPS = [
    {
        id: 'overview', shot: 'overview', nav: '화면 둘러보기', category: '화면 안내',
        title: '화면 구성 살펴보기',
        lead: '번호가 표시된 화면과 아래 설명을 함께 보세요. 왼쪽 목차에서 필요한 작업으로 바로 이동할 수 있습니다.',
        points: [
            { title: '위쪽 버튼', text: '<strong>내보내기·백업</strong>(파일로 내보내기, 백업 ZIP, PC 폴더 자동 저장)과 <strong>작업 기록</strong>이 있습니다. 검색 그림 저장소와 작성 규칙은 설정의 <strong>고급</strong>에 있습니다.' },
            { title: '과정 목차(교과 리스트)', text: '과정에 들어갈 교과를 만들고 고르는 곳입니다. 교과를 누르면 오른쪽에 교과 상세 정보가 열립니다.' },
            { title: '커리큘럼 다이어그램', text: '과정 → 교과 → 차시 구조를 지도로 보여 줍니다. 끌어서 옮기고, 휠로 확대·축소하고, 차시를 누르면 그 차시 편집으로 갑니다.' },
            { title: '사용 가이드', text: '이 가이드를 언제든 다시 엽니다. 왼쪽 작업별 바로가기에서 필요한 단계로 바로 갈 수 있습니다.' },
            { title: '설정', text: 'API 키와 AI 모델을 정합니다. 처음 한 번은 꼭 열어 키를 넣어야 교안을 만들 수 있습니다.' }
        ],
        tips: [
            '이 도구는 교안 <strong>초안</strong>을 빠르게 만드는 도구입니다. 만든 내용은 반드시 직접 검수한 뒤 쓰세요.',
            '작업 내용과 키는 이 브라우저에만 저장됩니다. 위쪽 <strong>내보내기·백업</strong>에서 백업 ZIP을 받아 두세요. 버튼 옆에 마지막 백업 시각이 보이고, 7일이 지나면 노란색으로 알려 줍니다.',
            '문제가 생기면 담당자에게 <strong>플로우(Flow)</strong>로 알려 주세요.'
        ]
    },
    {
        id: 'keys', shot: 'settings', nav: 'API 키 넣기', category: '설정',
        title: 'API 키 넣기',
        lead: '교안을 만들려면 AI 키가 <strong>하나</strong> 필요합니다(Gemini나 Claude). 처음이면 설정의 링크에서 Gemini 무료 키를 받아 넣으세요.',
        points: [
            { title: '설정 열기', text: '오른쪽 위 톱니바퀴를 누르면 설정 창이 열립니다.' },
            { title: 'Gemini API Key', text: '교안 글과 이미지 생성에 씁니다. 칸 아래 <strong>키 받기</strong> 링크에서 무료로 받습니다. 붙여 넣고 <strong>저장</strong>을 누르면 바로 연결을 확인해 \'연결됨\'(초록)이나 \'키가 맞지 않습니다\'(빨강)를 보여 줍니다.' },
            { title: 'Claude API Key', text: 'Claude로 교안 글을 쓸 때 넣습니다(유료). Claude 키만 넣으면 글 모델이 Claude로 자동으로 바뀝니다. 그림은 Gemini 키가 있거나 Higgsfield 모델을 골라 설정했으면 그림 모델이 그리고, 아니면 글 모델이 SVG 삽화로 그립니다.' },
            { title: '이미지 검색 (선택)', text: 'Google 검색 엔진 ID와 키를 넣으면 교안 그림을 검색으로도 찾습니다. 아래 Pixabay 키는 검색이 막혔을 때 대신 씁니다.' }
        ],
        tips: ['설정 맨 위 <strong>빠르고 저렴하게</strong>는 무료 키로도 되는 설정(그림은 글 모델이 SVG로 그립니다), <strong>품질 우선</strong>은 느리고 비용이 드는 대신 글과 그림이 더 정확한 설정입니다.', '빈 칸으로 저장하면 그 키가 지워집니다.', '여러 사람이 쓰는 PC에서는 키를 넣지 않는 것이 안전합니다.']
    },
    {
        id: 'models', shot: 'models', nav: '모델·이미지 설정', category: '설정',
        title: 'AI 모델과 이미지 정하기',
        lead: '설정 창을 아래로 내리면 교안을 쓰는 모델과 그림을 만드는 방식을 고를 수 있습니다.',
        points: [
            { title: '텍스트 생성 모델', text: '교안·퀴즈·문체 변환에 쓰는 모델입니다. 빠른 모델(Flash·Haiku)은 빠르고, 고급 모델은 느리지만 내용이 훨씬 정확합니다.' },
            { title: '이미지 생성 모델', text: '교안에 넣을 그림을 만드는 모델입니다. Gemini 키가 없으면 텍스트 모델이 SVG 삽화를 그립니다.' },
            { title: '교안 이미지 양', text: '탭을 만들 때 넣을 그림 수입니다(태그마다 / ## 섹션마다 한 장 / 넣지 않음). 줄이면 생성이 빨리 끝나고, 남긴 자리는 나중에 채울 수 있습니다.' },
            { title: 'Higgsfield 이미지 (선택)', text: 'Higgsfield로 그림을 만들려면 키와 <strong>중계 주소</strong>를 넣고 <strong>연결 확인</strong>을 누르세요. 중계 주소는 설정의 안내대로 Cloudflare에 중계를 한 번 배포하면 생깁니다.' }
        ],
        tips: ['<strong>추론 강도</strong>를 높이면 품질이 좋아지는 대신 시간과 비용이 늘어납니다.', '처음 기본값은 빠른 모델·보통 강도·핵심 그림만입니다. 설정 맨 위 두 버튼으로 한 번에 바꿀 수 있습니다.']
    },
    {
        id: 'subject', shot: 'subject', nav: '교과 만들기', category: '과정 만들기',
        title: '교과 만들고 편집기 열기',
        lead: '과정 개요 화면에서 교과를 만들고, 교과 편집기로 들어가 차시를 만듭니다.',
        points: [
            { title: '과정 설계', text: '과정 전체를 AI로 교과와 블록으로 한 번에 나눕니다. 교과를 하나씩 만들려면 옆의 <strong>+</strong>를 누르세요.' },
            { title: '교과 카드', text: '누르면 오른쪽에 교과 상세 정보(설명·차시 목록)가 열립니다. 체크해 여러 교과를 함께 다룰 수 있습니다.' },
            { title: '이 교과 편집기 열기', text: '고른 교과의 차시 목록과 교안 편집 화면으로 들어갑니다.' }
        ],
        tips: ['교과 이름은 교과 상세 정보에서 고칠 수 있습니다.', '과정명 아래 <strong>과정 정보</strong>에서 과정명과 <strong>분야</strong>(예: 간호, 회계, 웹 개발)를 넣으세요. AI가 그 분야의 강사로 교안을 씁니다. 처음 보이는 과정은 \'예시\' 표시가 붙은 둘러보기용입니다.']
    },
    {
        id: 'outline', shot: 'outline', nav: '차시 목차 만들기', category: '과정 만들기',
        title: 'AI로 차시 목차 만들기',
        lead: '교과 편집기 왼쪽 위 <strong>차시 목차 만들기</strong>에서 주제와 차시 수를 정하고 목차를 만듭니다.',
        points: [
            { title: '차시 목차 만들기', text: '누르면 목차 만들기 영역이 펼쳐지고 접힙니다. 차시가 생기면 접혀 있어 차시 카드가 먼저 보입니다.' },
            { title: '주제', text: '교과 주제를 씁니다. 옆의 <strong>참고자료</strong> 탭에서 <strong>파일에서 글자 가져오기</strong>로 자료 파일(PDF·PPTX·DOCX 등)의 글자를 넣으면 그 내용을 바탕으로 목차와 교안을 만듭니다.' },
            { title: '차시 수와 어투', text: '만들 차시 수(− 5 +)와 교안 어투(합쇼체·해요체·코치형)를 고릅니다.' },
            { title: 'AI 차시 목차 생성', text: '누르면 차시 제목·설명·학습 목표가 담긴 목차가 만들어집니다. 이미 차시가 있으면 휴지통으로 옮길지 먼저 묻습니다.' }
        ],
        tips: ['목차를 만든 뒤 <strong>교과 일괄 작업 → 남은 차시 생성</strong>으로 모든 차시의 교안을 한 번에 만듭니다.']
    },
    {
        id: 'cards', shot: 'cards', nav: '차시 카드 다루기', category: '과정 만들기',
        title: '차시 카드 다루기',
        lead: '왼쪽 차시 목록의 카드로 교안을 열고, 만들고, 정리합니다.',
        points: [
            { title: '차시 카드', text: '누르면 오른쪽에 그 차시 교안이 열립니다. 제목과 설명은 카드에서 바로 고칠 수 있습니다.' },
            { title: '교안 생성 아이콘', text: '✨는 교안 만들기, ↻는 다시 만들기입니다. 누르면 핵심 개념을 묻는 창이 먼저 뜹니다.' },
            { title: '마우스를 올리면 나오는 아이콘', text: 'MD 올리기 · 순서 변경 · 삭제가 카드에 마우스를 올렸을 때만 나타납니다.' },
            { title: '검색과 상태 필터', text: '제목·카테고리·목표로 찾고, 작성중·검수중·완료·개선필요로 추려 봅니다.' }
        ],
        tips: ['카드의 <strong>NCS 코드</strong>에 마우스를 올리면 후보 코드와 근거가 보이고, 골라서 확정하거나 복사할 수 있습니다.', '여러 카드를 체크하면 <strong>병합 재생성</strong>으로 한 차시로 합칩니다.']
    },
    {
        id: 'generate', shot: 'generate', nav: '교안 생성하기', category: '교안 만들기',
        title: '교안 생성하기',
        lead: '차시를 열면 오른쪽에 교안 편집 화면이 나옵니다. 탭을 골라 만들거나 한 번에 만듭니다.',
        points: [
            { title: '탐색줄', text: '5탭 교안(기본학습·기본실습·심화학습·심화실습·학습이해도)과 교수안·슬라이드·문제은행을 오갑니다. 점은 내용이 있는 탭입니다.' },
            { title: '이 탭 생성', text: '지금 보고 있는 탭만 만듭니다.' },
            { title: '전체 생성', text: '빈 항목을 교안 탭 → 교수안·슬라이드 → 문제은행 순서로 만듭니다.' },
            { title: '교안 내용', text: '만들어진 교안이 여기 보입니다. 생성 중에도 끝난 탭은 바로 읽을 수 있습니다.' }
        ],
        tips: ['긴 작업은 화면을 막지 않고 <strong>오른쪽 아래 진행 막대</strong>에 단계·걸린 시간·남은 이미지 수를 보여 줍니다. 막대의 <strong>중지</strong>로 멈춥니다.', '학습이해도는 학습 목표마다 1문제 이상, 10문항 이상으로 만듭니다.']
    },
    {
        id: 'edit', shot: 'edit', nav: '교안 고치기', category: '교안 다듬기',
        title: '교안 고치기',
        lead: '만든 교안은 직접 고치거나, 요청을 써서 AI에게 고치게 할 수 있습니다. 교안 위 안내 줄에 고치는 방법이 짧게 적혀 있습니다(✕로 닫으면 다시 보이지 않습니다).',
        points: [
            { title: '단락 수정', text: '본문을 <strong>두 번 누르면</strong> 그 단락만 원문 편집 상자로 열립니다. Enter로 저장, Esc로 취소, <strong>Ctrl+Z</strong>로 되돌립니다. 탭 전체 원문은 <strong>도구 → 원문 전체 수정</strong>에서 고칩니다.' },
            { title: '서식 막대', text: '글자를 드래그하면 굵게·기울임·밑줄·취소선, 문단 스타일, 링크, 목록, 인용, 코드, 구분선 버튼이 뜹니다. <strong>Ctrl+B/I/U</strong>도 됩니다. 막대의 <strong>AI로 수정</strong>을 누르면 고른 글을 아래 칸에서 고칩니다.' },
            { title: '컨벤션 검수', text: '지금 탭을 작성 규칙으로 검사합니다. 필수·권장 위반 수가 보이고, AI 수정안을 비교해 반영할 수 있습니다.' },
            { title: 'AI에게 고쳐 달라고 하기', text: '아래 칸에 "예시를 하나 더 넣어 줘" 같은 요청을 쓰고 실행합니다. 글을 끌어 골랐으면 그 부분만, 고르지 않았으면 <strong>이 탭 전체</strong>를 고칩니다. 탭 전체는 바뀐 부분을 미리 보고 골라 반영합니다. 위 칩으로 자주 쓰는 요청을 넣습니다.' }
        ],
        tips: ['다시 만들기·고치기 전 내용은 <strong>작업 기록</strong>에 남습니다. 작업 기록에서 <strong>되돌리기</strong>를 누르면 그 차시가 5개 탭 그대로 돌아옵니다.']
    },
    {
        id: 'tools', shot: 'tools', nav: '도구 메뉴', category: '교안 다듬기',
        title: '도구 메뉴 쓰기',
        lead: '차시 화면 위쪽 <strong>도구</strong>를 누르면 그림·삽화·판서 영상 같은 기능이 펼쳐집니다.',
        points: [
            { title: '일괄 이미지 찾기', text: '교안의 그림 자리를 탭마다 채웁니다. 바로 아래의 <strong>콘텐츠 정리</strong>는 교과 전체의 글 서식을 고치고 아직 채우지 않은 그림 자리를 채웁니다. 둘 다 오른쪽 아래 막대에서 멈출 수 있습니다.' },
            { title: '섹션 고정', text: '다시 생성해도 바꾸지 않을 섹션을 고릅니다.' },
            { title: '삽화', text: '교안에 맞는 SVG 삽화를 만들어 본문에 넣습니다.' },
            { title: '판서 영상', text: '이 차시 교안으로 나레이션이 있는 판서 영상을 만듭니다. 다음 단계에서 자세히 봅니다.' }
        ],
        tips: ['<strong>원문 전체 수정</strong>은 지금 탭의 마크다운 원문을 한 번에 고칩니다. 다 고친 뒤 <strong>보기로 돌아가기</strong>를 누르면 저장됩니다.', '<strong>이미지 삽입 · 이미지 저장</strong>으로 내 그림을 넣거나 교안 그림을 JPG로 받습니다.', '<strong>복사</strong>는 지금 탭의 마크다운을 복사합니다.']
    },
    {
        id: 'whiteboard', shot: 'whiteboard', nav: '판서 영상 만들기', category: '판서 영상',
        title: '판서 영상 만들기',
        lead: '<strong>도구 → 판서 영상</strong>을 누르면 이 창이 열립니다. 담을 내용을 직접 고쳐 쓴 뒤 화이트보드 교안 스튜디오로 넘깁니다.',
        points: [
            { title: '주제', text: '판서 수업의 주제입니다. 차시 제목으로 채워져 있습니다.' },
            { title: '판서 영상에 담을 내용', text: '차시 교안이 미리 채워져 있습니다. 필요 없는 부분은 지우고, 강조할 설명이나 예시를 직접 써넣으세요. 스튜디오는 이 내용만 자료로 씁니다.' },
            { title: '원래 내용으로', text: '고친 내용을 버리고 처음 채워진 내용으로 되돌립니다.' },
            { title: '스튜디오에서 만들기', text: '새 탭에 스튜디오가 열립니다. Gemini 키를 넣고 <strong>판서 수업 생성하기</strong>를 누르면 5장면 판서와 나레이션이 만들어집니다.' }
        ],
        tips: ['스튜디오에서 영상(MP4)·자막·교안으로 내보낼 수 있습니다.']
    },
    {
        id: 'image-video', shot: 'image-video', nav: '그림 → 판서 영상', category: '판서 영상',
        title: '그림을 판서 영상으로 바꾸기',
        lead: '교안 속 그림 자리에 그 내용을 설명하는 판서 영상을 넣을 수 있습니다.',
        points: [
            { title: '교안 그림', text: '보기 화면에서 바꾸고 싶은 그림에 마우스를 올립니다.' },
            { title: '판서 영상으로 바꾸기', text: '누르면 그 그림이 든 절의 글로 판서 영상 만들기 창이 열립니다. 스튜디오에서 수업을 만든 뒤 <strong>Teacher로 보내기</strong>를 누르고 Teacher 탭으로 돌아오면 그림 자리가 영상으로 바뀝니다.' }
        ],
        tips: [
            '영상 위의 <strong>원래 그림으로</strong>로 언제든 되돌립니다.',
            'PDF·슬라이드·MD 내보내기에는 원래 그림이 나가고, 현재 차시 <strong>HTML 내보내기</strong>에는 지금 보고 있는 탭의 영상이 파일 안에 들어갑니다.',
            '영상은 이 브라우저에만 저장되어 다른 PC에서는 원래 그림으로 보입니다.'
        ]
    },
    {
        id: 'slides', shot: 'slides', nav: '교수안·슬라이드', category: '수업 자료',
        title: '교수안과 슬라이드 만들기',
        lead: '탐색줄 오른쪽에서 강사용 교수안, 발표용 슬라이드, 문제은행을 만듭니다.',
        points: [
            { title: '교수안', text: '수업 진행 계획(도입·전개·정리, 시간 배분)을 만들고 확인합니다.' },
            { title: '슬라이드', text: '교안으로 만든 슬라이드 편성안을 미리 봅니다.' },
            { title: '슬라이드 생성', text: '누르면 슬라이드를 만듭니다. 스튜디오에서 글을 눌러 고치고, 이미지 칸에 파일이나 AI 그림을 넣은 뒤 PPTX·HTML로 내보냅니다.' },
            { title: '문제은행', text: '학습 목표와 밴드별로 문항을 만들고 고칩니다.' }
        ],
        tips: ['슬라이드 편집 단축키: <strong>Ctrl+Z</strong> 되돌리기, <strong>Ctrl+C/X/V</strong>, <strong>Delete</strong> 삭제, 보기 모드에서 <strong>← →</strong>로 넘기기.']
    },
    {
        id: 'flow', shot: 'flow', nav: '교과 일괄 작업', category: '과정 관리',
        title: '교과 일괄 작업',
        lead: '왼쪽 <strong>교과 일괄 작업</strong> 줄을 펼치면 여러 차시를 한 번에 다루는 버튼이 나옵니다.',
        points: [
            { title: '남은 차시 생성', text: '내용이 빈 탭만 차례로 만듭니다. 이미 만든 내용도 다시 만들도록 고를 수 있고, 그때 지금 내용은 <strong>휴지통</strong>에 30일 동안 남습니다. 창 아래 <strong>미리 보기</strong>에 글 호출 수와 비용 수준, 그림 장수와 요금, 걸릴 시간이 나옵니다.' },
            { title: '차시 구성', text: '차시 제목과 시간을 한눈에 보고 고칩니다. 옆의 <strong>블록 다시 설계</strong>는 AI로 차시를 새로 나눕니다.' },
            { title: '교수안·편성안 묶음', text: '모든 차시의 교수안과 슬라이드 편성안을 한 파일로 받습니다. 옆의 <strong>교육 자료</strong>는 학습자용 자료로 받습니다.' },
            { title: '기존 내용 보강', text: '예전에 만든 교과와 차시에 NCS와 삽화를 채웁니다.' }
        ],
        tips: ['위의 <strong>교과 NCS → 관리</strong>에서 교과 능력단위를 배정·확정합니다.', '전체 생성·일괄 이미지 찾기·콘텐츠 정리처럼 오래 걸리는 일은 시작 전에 호출 수와 시간을 먼저 보여 주고 묻습니다. 시간은 이 브라우저에서 잰 최근 호출로 점점 정확해집니다.']
    },
    {
        id: 'export', shot: 'export', nav: '내보내기·백업', category: '내보내기',
        title: '내보내기와 백업',
        lead: '위쪽 <strong>내보내기·백업</strong>을 누르면 읽기용 파일 내보내기, 되살리기용 백업, PC 폴더 자동 저장이 한 메뉴에 있습니다.',
        points: [
            { title: '내보내기', text: '<strong>현재 차시</strong> 또는 <strong>현재 교과(전체 차시)</strong>를 고른 뒤 MD·PDF·HTML·슬라이드 형식을 고릅니다. 현재 차시는 <strong>전체 탭</strong>(5개 탭을 한 문서로)과 <strong>지금 탭</strong> 중에서 고릅니다. PDF·HTML은 화면과 같은 모양(그림·인용 막대·번호 목록)으로 나가고, PDF는 인쇄 창에서 <strong>PDF로 저장</strong>을 고릅니다.' },
            { title: '그림 담기', text: '백업에 그림을 어떻게 담을지 고릅니다. <strong>함께</strong>는 예전처럼 한 파일에, <strong>따로·가볍게</strong>는 그림 폴더에 파일로 담습니다(같은 그림은 한 번만, 그림이 많은 과정에 알맞음). 이 둘은 PC 폴더 자동 저장에도 적용되고, 그림이 많아 한 파일에 담지 못하면 저절로 따로·가볍게로 바뀝니다. <strong>빼기</strong>는 메뉴를 연 채 바로 받는 백업 하나만 되살리기용 그림을 빼고 만듭니다(파일 이름 끝 _그림없음). 그 파일로 되살리면 그림 자리가 빕니다.' },
            { title: '백업 ZIP', text: '<strong>교과 백업 ZIP</strong>은 고른 교과(편집 중에는 지금 교과)를, <strong>과정 전체 백업 ZIP</strong>은 모든 교과와 설정을 받습니다. 차시 폴더마다 화면과 같은 모양의 <strong>교안.html</strong>도 들어 있습니다. <strong>백업 ZIP으로 되살리기</strong>로 되살립니다(교과 백업은 그 교과만 바꾸고 다른 교과는 그대로 둡니다).' },
            { title: '내보낸 교안 다시 불러오기', text: '이 앱에서 내보낸 교안 HTML·MD와 교수안 HTML을 고칠 수 있는 차시로 되살립니다. 편집 중이면 그 교과 끝에, 개요 화면에서는 새 교과에 넣습니다. 다른 사람에게 받은 파일도 됩니다.' },
            { title: 'PC 폴더에 자동 저장', text: '<strong>빈 폴더에 저장 시작</strong>으로 폴더를 고르면 이후 바뀐 내용을 그 폴더에 자동으로 저장합니다. 오른쪽 위에 저장 상태(꺼짐·폴더 이름)가 보입니다.' },
            { title: '작업 기록', text: '다시 만들기·불러오기·되돌리기 전에 남긴 기록을 보고, <strong>되돌리기</strong>로 그 차시를 그때 내용으로 돌립니다. 지운 차시의 기록은 새 차시로 되살립니다.' }
        ],
        tips: ['브라우저 데이터를 지우면 작업도 사라집니다. 정기적으로 백업 ZIP을 받아 두세요.', '지운 교과와 차시는 교과 목록 아래 <strong>휴지통</strong>에서 30일 동안 되살릴 수 있습니다.', '백업 ZIP으로 되살리기와 저장해 둔 폴더 열기는 지금 작업을 바꾸기 전에 확인을 받고, 지금 상태를 백업 파일로 먼저 내려받습니다.']
    }
];

const TUTORIAL_CAPTION = '캡처 안의 버튼은 안내 이미지입니다. 실제 작업은 가이드를 닫고 화면에서 진행하세요.';

/* ---------- 그리기 (모두 앱이 직접 쓴 글이라 <strong> 같은 태그를 그대로 쓴다) ---------- */
const tutorialNum = n => String(n).padStart(2, '0');

function tutorialShot(step) {
    return (typeof GUIDE_SHOTS !== 'undefined' && GUIDE_SHOTS[step.shot]) || null;
}

// 번호는 요소 왼쪽 바깥에 두고, 왼쪽 끝 요소는 안쪽 위에 둔다
function tutorialPinStyle(m) {
    return m.x > 4
        ? `left:${m.x}%;top:${m.y + m.h / 2}%;transform:translate(calc(-100% - 6px),-50%)`
        : `left:${m.x}%;top:${m.y}%;transform:translate(6px,6px)`;
}

function tutorialShotHtml(step, { zoomed = false } = {}) {
    const shot = tutorialShot(step);
    if (!shot) return '<div class="guide-shot-missing">캡처를 불러오지 못했습니다.</div>';
    const marks = shot.markers.map((m, i) => `
        <span class="guide-box" data-guide-point="${i}" style="left:${m.x}%;top:${m.y}%;width:${m.w}%;height:${m.h}%"></span>
        <span class="guide-pin" data-guide-point="${i}" style="${tutorialPinStyle(m)}">${i + 1}</span>`).join('');
    return `<div class="guide-shot-frame${zoomed ? ' is-zoomed' : ''}">
        <img src="${shot.src}" alt="${step.title} 화면 캡처 (예시 데이터)" loading="lazy" decoding="async">${marks}</div>`;
}

function tutorialStepHtml(step, index, total) {
    const points = step.points.map((p, i) => `
        <li data-guide-point="${i}"><span class="guide-point-num">${i + 1}</span>
            <div><strong class="guide-point-title">${p.title}</strong><p>${p.text}</p></div></li>`).join('');
    const tips = step.tips?.length ? `<div class="guide-tips"><h4>알아 두면 좋아요</h4><ul>${step.tips.map(t => `<li>${t}</li>`).join('')}</ul></div>` : '';
    return `
        <div class="guide-progress">
            <span>${index + 1} / ${total}</span>
            <div class="guide-progress-bar"><span style="width:${((index + 1) / total) * 100}%"></span></div>
            <span class="guide-category">${step.category}</span>
        </div>
        <h3 class="guide-step-title" id="guide-step-title">${step.title}</h3>
        <p class="guide-lead">${step.lead}</p>
        <figure class="guide-shot">
            <div class="guide-shot-head"><span>실제 화면 캡처 · 예시 데이터</span>
                <button type="button" class="guide-btn guide-btn-ghost" data-guide-action="zoom"><i class="ph-bold ph-magnifying-glass-plus"></i> 화면 확대</button></div>
            ${tutorialShotHtml(step)}
            <figcaption>${TUTORIAL_CAPTION}</figcaption>
        </figure>
        <ol class="guide-points">${points}</ol>
        ${tips}`;
}

function tutorialNavHtml(current) {
    return TUTORIAL_STEPS.map((step, i) => `
        <li><button type="button" data-guide-step="${i}" class="${i === current ? 'is-current' : ''}" ${i === current ? 'aria-current="step"' : ''}>
            <span class="guide-nav-num">${tutorialNum(i + 1)}</span> ${step.nav}</button></li>`).join('');
}

/* ---------- 가이드 창 ---------- */
function tutorialDialog() {
    let overlay = document.getElementById('guide-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'guide-overlay';
    overlay.className = 'guide-overlay';
    overlay.innerHTML = `
        <div class="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-dialog-title" tabindex="-1">
            <div class="guide-head">
                <h2 id="guide-dialog-title">화면으로 따라 하는 사용 가이드</h2>
                <button type="button" class="guide-icon-btn" data-guide-action="close" title="닫기 (다음부터 자동으로 열지 않음)" aria-label="가이드 닫기"><i class="ph-bold ph-x"></i></button>
            </div>
            <div class="guide-main">
                <nav class="guide-nav" aria-label="작업별 바로가기">
                    <p class="guide-nav-title">작업별 바로가기</p>
                    <ol data-guide-nav></ol>
                    <p class="guide-nav-hint">화면 속 번호와 아래 설명의 번호를 맞춰 보세요.</p>
                </nav>
                <div class="guide-content" data-guide-content tabindex="-1"></div>
            </div>
            <div class="guide-foot">
                <button type="button" class="guide-btn guide-btn-ghost" data-guide-action="later">나중에 보기</button>
                <span class="guide-foot-count" data-guide-count></span>
                <div class="guide-foot-nav">
                    <button type="button" class="guide-btn guide-btn-ghost" data-guide-action="prev">이전</button>
                    <button type="button" class="guide-btn guide-btn-primary" data-guide-action="next">다음</button>
                </div>
            </div>
            <div class="guide-zoom" data-guide-zoom hidden></div>
        </div>`;
    overlay.addEventListener('click', onTutorialClick);
    overlay.addEventListener('mouseover', event => markTutorialPoint(event.target.closest?.('[data-guide-point]')?.dataset.guidePoint));
    overlay.addEventListener('mouseleave', () => markTutorialPoint(null));
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onTutorialKey);
    return overlay;
}

// 설명에 마우스를 올리면 캡처 속 같은 번호를 밝힌다 (반대도 같다)
function markTutorialPoint(index) {
    document.querySelectorAll('#guide-overlay [data-guide-point]').forEach(el => {
        el.classList.toggle('is-active', index != null && el.dataset.guidePoint === String(index));
    });
}

function onTutorialClick(event) {
    const zoom = event.target.closest('[data-guide-zoom]');
    if (zoom) return closeTutorialZoom();
    const stepButton = event.target.closest('[data-guide-step]');
    if (stepButton) return showTutorialStep(Number(stepButton.dataset.guideStep));
    const action = event.target.closest('[data-guide-action]')?.dataset.guideAction;
    if (action === 'next') nextTutorialStep();
    else if (action === 'prev') showTutorialStep(tutorialStep - 1);
    else if (action === 'zoom') openTutorialZoom();
    else if (action === 'later') laterTutorial();
    else if (action === 'close') endTutorial();
}

function onTutorialKey(event) {
    if (!document.getElementById('guide-overlay')) return;
    const zoom = document.querySelector('#guide-overlay [data-guide-zoom]');
    if (event.key === 'Escape') {
        event.preventDefault();
        return zoom && !zoom.hidden ? closeTutorialZoom() : laterTutorial();
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); nextTutorialStep(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); showTutorialStep(tutorialStep - 1); }
}

function openTutorialZoom() {
    const zoom = document.querySelector('#guide-overlay [data-guide-zoom]');
    if (!zoom) return;
    zoom.innerHTML = `${tutorialShotHtml(TUTORIAL_STEPS[tutorialStep], { zoomed: true })}<p class="guide-zoom-hint">아무 곳이나 누르거나 Esc를 누르면 닫힙니다</p>`;
    zoom.hidden = false;
}

function closeTutorialZoom() {
    const zoom = document.querySelector('#guide-overlay [data-guide-zoom]');
    if (zoom) { zoom.hidden = true; zoom.innerHTML = ''; }
}

function preloadTutorialShot(index) {
    const shot = TUTORIAL_STEPS[index] && tutorialShot(TUTORIAL_STEPS[index]);
    if (shot) new Image().src = shot.src;
}

function showTutorialStep(index) {
    const total = TUTORIAL_STEPS.length;
    tutorialStep = Math.max(0, Math.min(index, total - 1));
    const overlay = tutorialDialog();
    closeTutorialZoom();
    const content = overlay.querySelector('[data-guide-content]');
    content.innerHTML = tutorialStepHtml(TUTORIAL_STEPS[tutorialStep], tutorialStep, total);
    content.scrollTop = 0;
    overlay.querySelector('[data-guide-nav]').innerHTML = tutorialNavHtml(tutorialStep);
    overlay.querySelector('[data-guide-nav] .is-current')?.scrollIntoView({ block: 'nearest' });
    overlay.querySelector('[data-guide-count]').textContent = `${tutorialStep + 1} / ${total}`;
    overlay.querySelector('[data-guide-action="prev"]').disabled = tutorialStep === 0;
    overlay.querySelector('[data-guide-action="next"]').textContent = tutorialStep === total - 1 ? '완료' : '다음';
    preloadTutorialShot(tutorialStep + 1);
}

function startTutorial(index = 0) {
    if (!document.getElementById('guide-overlay')) tutorialReturnFocus = document.activeElement;
    showTutorialStep(index);
    setTimeout(() => document.querySelector('#guide-overlay .guide-dialog')?.focus({ preventScroll: true }), 30);
}

function nextTutorialStep() {
    if (tutorialStep >= TUTORIAL_STEPS.length - 1) return endTutorial();
    showTutorialStep(tutorialStep + 1);
}

function closeTutorialDialog() {
    document.removeEventListener('keydown', onTutorialKey);
    document.getElementById('guide-overlay')?.remove();
    tutorialReturnFocus?.focus?.({ preventScroll: true });
    tutorialReturnFocus = null;
}

// 나중에 보기: 닫고 다음에 다시 연다
function laterTutorial() {
    closeTutorialDialog();
}

function skipTutorial() {
    endTutorial();
}

// 다 봤거나(완료) 닫으면 다음부터 저절로 열지 않는다. 오른쪽 위 사용 가이드 버튼(#btn-guide)이나 설정 → 사용 가이드 보기로 다시 연다
function endTutorial() {
    try { localStorage.setItem(TUTORIAL_KEY, 'true'); } catch (e) { console.warn('[사용 가이드] 본 것을 기억하지 못했습니다:', e); }
    closeTutorialDialog();
}

function restartTutorial() {
    startTutorial(0);
}

function shouldAutoStartTutorial() {
    try { return localStorage.getItem(TUTORIAL_KEY) !== 'true'; } catch (e) { return false; }
}
