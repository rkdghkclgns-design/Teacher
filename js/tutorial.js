// tutorial.js — 튜토리얼 스포트라이트 시스템

const TUTORIAL_KEY = 'kyoan_tutorial_done_v8';
let tutorialStep = 0;

const TUTORIAL_STEPS = [
    {
        target: '#btn-settings',
        title: '1. ⚙️ 설정',
        desc: `<strong>📌 무엇인가요?</strong><br>
교안 생성 환경을 설정하는 패널입니다.<br><br>
<strong>📖 사용법</strong><br>
① 톱니바퀴 아이콘을 클릭하세요.<br>
② <strong>AI 모델</strong>을 선택합니다 (텍스트/이미지 각각).<br>
③ 이 튜토리얼을 다시 볼 수 있습니다.`,
        position: 'bottom'
    },
    {
        target: '#overview-lnb-list',
        title: '2. 📚 교과 추가',
        desc: `<strong>📌 무엇인가요?</strong><br>
교과(과목)를 만들고 관리하는 좌측 패널입니다.<br><br>
<strong>📖 사용법</strong><br>
① <strong>+ 버튼</strong>을 눌러 새 교과를 추가합니다.<br>
② 교과명을 입력하고 확인을 누르세요.<br>
③ 교과를 클릭하면 차시 목록과 다이어그램이 표시됩니다.<br>
④ 교과 옆 메뉴(⋮)로 이름 변경, 삭제가 가능합니다.`,
        position: 'right'
    },
    {
        target: '#diagram-viewport',
        title: '3. 🗺️ 커리큘럼 다이어그램',
        desc: `<strong>📌 무엇인가요?</strong><br>
교과의 전체 차시 구조를 한눈에 보여주는 시각화 영역입니다.<br><br>
<strong>📖 사용법</strong><br>
① 마우스 <strong>드래그</strong>로 화면을 이동합니다.<br>
② 마우스 <strong>휠</strong>로 확대/축소합니다.<br>
③ 차시 노드를 <strong>클릭</strong>하면 해당 차시 편집으로 이동합니다.<br>
④ AI 목차 생성 후 자동으로 업데이트됩니다.`,
        position: 'left'
    },
    {
        target: '#toolbar-scroll',
        title: '4. 🧰 상단 도구 모음',
        desc: `<strong>📌 무엇인가요?</strong><br>
내보내기, 히스토리, 보관함 등 주요 기능 버튼이 모여있습니다.<br><br>
<strong>📖 주요 버튼</strong><br>
• <strong>📤 내보내기</strong> — 범위(현재/전체) 선택 후 MD, PDF, 슬라이드, HTML 형식으로 저장<br>
• <strong>🕐 히스토리</strong> — 이전에 생성한 교안 기록을 복원<br>
• <strong>📦 캐시 보관함</strong> — 이미지 캐시를 관리<br>
• <strong>📏 컨벤션</strong> — 교안 작성 규칙을 확인`,
        position: 'bottom'
    },
    {
        target: '#module-list',
        title: '5. 📋 차시 관리',
        desc: `<strong>📌 무엇인가요?</strong><br>
교과에 포함된 차시(수업 단위)를 관리합니다.<br><br>
<strong>📖 교안 생성 방법</strong><br>
① 차시를 <strong>클릭</strong>하면 에디터가 열립니다.<br>
② <strong>✨ 버튼</strong>으로 AI가 5탭 교안을 자동 생성합니다.<br>
③ <strong>전체 탭</strong> 버튼으로 5개 탭을 한 번에 생성합니다.<br><br>
<strong>📖 관리 기능</strong><br>
• <strong>체크박스</strong> — 여러 차시를 선택하여 병합 가능<br>
• <strong>일괄 삭제</strong> — 전체 차시를 한 번에 삭제 (보관함 저장 옵션)`,
        position: 'right'
    },
    {
        target: '#editor-content-area',
        title: '6. ✏️ 교안 에디터',
        desc: `<strong>📌 무엇인가요?</strong><br>
AI가 생성한 교안을 확인하고 편집하는 핵심 영역입니다.<br><br>
<strong>📖 5탭 시스템</strong><br>
• <strong>기본학습</strong> — 핵심 이론과 개념<br>
• <strong>기본실습</strong> — 기본 실습 과제<br>
• <strong>심화학습</strong> — 고급 이론과 응용<br>
• <strong>심화실습</strong> — 프로젝트형 실습<br>
• <strong>학습이해도</strong> — 5지선다 퀴즈 10문항<br><br>
<strong>📖 편집 기능</strong><br>
• <strong>보기/수정</strong> — 마크다운 직접 편집 가능<br>
• <strong>탐색줄</strong> — 교안 탭, 교수안, 슬라이드, 문제은행을 한 줄에서 오갑니다<br>
• <strong>전체 생성</strong> — 빈 항목을 순서대로 만듭니다. 생성 중에도 끝난 항목을 읽을 수 있습니다<br>
• <strong>도구</strong> — 이미지, 섹션 고정, 삽화, 복사<br>
• <strong>보강 재생성</strong> — 추가 명령으로 내용 개선<br>
• <strong>슬라이드</strong> — 교안으로 만든 슬라이드를 편집하고 PPTX·HTML로 내보내기<br>
• <strong>이미지 저장</strong> — 교안 이미지를 JPG로 일괄 다운로드`,
        position: 'left'
    },
    {
        target: '#editor-content-area',
        title: '7. 🎬 슬라이드 편집',
        desc: `<strong>📌 무엇인가요?</strong><br>
교수안과 함께 만든 슬라이드 편성안을 화면에서 고쳐 PPTX·HTML로 내보내는 스튜디오입니다.<br><br>
<strong>📖 사용법</strong><br>
① 슬라이드 패널에서 스튜디오를 엽니다. 차시를 고르면 그 차시만 엽니다.<br>
② 글자를 눌러 고치고, 이미지 칸에 파일을 넣거나 AI로 만듭니다.<br>
③ 고친 내용은 차시에 저장됩니다.<br><br>
<strong>⌨️ 단축키 (편집 모드)</strong><br>
• <strong>Ctrl+Z</strong> 되돌리기 · <strong>Ctrl+C/X/V</strong> 복사·잘라내기·붙여넣기<br>
• <strong>Ctrl+A</strong> 전체 선택 · <strong>Delete</strong> 삭제 · <strong>Esc</strong> 선택 해제<br>
• <strong>←/→</strong> 슬라이드 이동 (보기 모드)`,
        position: 'left'
    },
    {
        target: '#editor-content-area',
        title: '8. 🧭 과정 전체 작업',
        desc: `<strong>📌 무엇인가요?</strong><br>
차시 하나를 넘어 교과와 과정 단위로 일하는 기능입니다.<br><br>
<strong>📖 주요 기능</strong><br>
• <strong>과정 설계</strong> — 과정을 교과와 블록으로 나눕니다<br>
• <strong>교과 일괄 작업</strong> — 남은 차시와 교수안 생성, 차시 구성, 기존 내용 보강<br>
• <strong>차시 정보</strong> — 학습 목표, 진행 단계, 툴·버전, NCS 요소, 변경 이력<br>
• <strong>컨벤션 검수</strong> — 규칙 위반을 찾고 AI 수정안을 비교해 반영합니다<br>
• <strong>문제은행</strong> — 학습 목표와 밴드별로 문항을 만들고 고칩니다<br>
• <strong>삽화</strong> — 교안에 맞는 SVG 삽화를 만들어 본문에 넣습니다`,
        position: 'left'
    }
];

// v7.6: 튜토리얼 전 공지 팝업
const NOTICE_KEY = 'kyoan_notice_done';

function showNoticePopup(onClose) {
    // "다시보지 않기" 체크된 경우 건너뛰기
    try { if (localStorage.getItem(NOTICE_KEY) === 'true') { onClose(); return; } } catch {}

    const overlay = document.createElement('div');
    overlay.id = 'notice-popup-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);';

    overlay.innerHTML = `
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border:1px solid rgba(124,91,245,0.3);border-radius:20px;padding:36px 32px;max-width:520px;width:92%;box-shadow:0 24px 60px rgba(0,0,0,0.6);text-align:left;">
        <div style="text-align:center;margin-bottom:20px;">
            <div style="font-size:48px;margin-bottom:8px;">📋</div>
            <h2 style="color:#f3f4f6;font-size:20px;font-weight:800;margin:0;">사용 안내</h2>
        </div>

        <div style="color:#d1d5db;font-size:13px;line-height:1.8;margin-bottom:24px;">
            <div style="background:rgba(245,158,11,0.1);border-left:3px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:14px;">
                <strong style="color:#f59e0b;">⚠ 초안 생성 도구</strong><br>
                이 도구는 교안 <strong>초안을 빠르게 작성</strong>하기 위한 목적으로 제작되었습니다.<br>
                생성된 내용은 반드시 <strong style="color:#22d3ee;">사용자 검수 후 조정</strong>이 필요합니다.
            </div>

            <div style="background:rgba(139,92,246,0.1);border-left:3px solid #a78bfa;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:14px;">
                <strong style="color:#a78bfa;">🕐 생성 시간 안내</strong><br>
                빠른 모델(Flash · Haiku) 대신 <strong>고급 모델(Fable · Argon)</strong>을 사용하면<br>
                생성 시간이 <strong style="color:#f87171;">크게 증가</strong>합니다.<br>
                <span style="color:#22d3ee;">고급 모델 사용 시 내용과 이미지의 정확도가 크게 증가합니다.</span>
            </div>

            <div style="background:rgba(34,211,238,0.1);border-left:3px solid #22d3ee;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:14px;">
                <strong style="color:#22d3ee;">🔑 API 키 관리</strong><br>
                좌측 하단 <strong style="color:#f3f4f6;">설정</strong>에서 Gemini 또는 Claude API 키를 입력해야 합니다.<br>
                키는 이 브라우저에만 저장됩니다.
            </div>

            <div style="background:rgba(248,113,113,0.1);border-left:3px solid #f87171;padding:12px 16px;border-radius:0 8px 8px 0;">
                <strong style="color:#f87171;">🚨 문제 발생 시</strong><br>
                담당자에게 <strong>플로우(Flow)</strong>로 알림을 보내주세요.
            </div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#6b7280;cursor:pointer;">
                <input type="checkbox" id="notice-dont-show" style="accent-color:#a78bfa;width:16px;height:16px;">
                다시 보지 않기
            </label>
            <button id="notice-close-btn" style="padding:10px 28px;background:linear-gradient(135deg,#7c5bf5,#a78bfa);color:#fff;font-weight:700;font-size:14px;border:none;border-radius:10px;cursor:pointer;box-shadow:0 4px 14px rgba(124,91,245,0.4);">
                확인
            </button>
        </div>
    </div>`;

    document.body.appendChild(overlay);

    document.getElementById('notice-close-btn').onclick = () => {
        const dontShow = document.getElementById('notice-dont-show');
        if (dontShow && dontShow.checked) {
            try { localStorage.setItem(NOTICE_KEY, 'true'); } catch {}
        }
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.3s';
        setTimeout(() => { overlay.remove(); onClose(); }, 300);
    };
}

function startTutorial() {
    tutorialStep = 0;
    document.getElementById('tutorial-overlay')?.remove();
    document.getElementById('tutorial-spotlight')?.remove();
    document.getElementById('tutorial-popover')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'tutorial-overlay';
    overlay.className = 'tutorial-overlay';
    document.body.appendChild(overlay);

    const spotlight = document.createElement('div');
    spotlight.id = 'tutorial-spotlight';
    spotlight.className = 'tutorial-spotlight';
    document.body.appendChild(spotlight);

    const popover = document.createElement('div');
    popover.id = 'tutorial-popover';
    popover.className = 'tutorial-popover';
    document.body.appendChild(popover);

    showTutorialStep(0);
}

function showTutorialStep(idx) {
    const step = TUTORIAL_STEPS[idx];
    if (!step) { endTutorial(); return; }

    const target = document.querySelector(step.target);
    if (!target) { showTutorialStep(idx + 1); return; }

    const rect = target.getBoundingClientRect();
    const spotlight = document.getElementById('tutorial-spotlight');
    const popover = document.getElementById('tutorial-popover');
    if (!spotlight || !popover) return;

    const pad = 8;
    spotlight.style.left = (rect.left - pad) + 'px';
    spotlight.style.top = (rect.top - pad) + 'px';
    spotlight.style.width = (rect.width + pad * 2) + 'px';
    spotlight.style.height = (rect.height + pad * 2) + 'px';

    popover.innerHTML = `
        <div class="tutorial-step-indicator">${idx + 1} / ${TUTORIAL_STEPS.length}</div>
        <h4>${step.title}</h4>
        <p>${step.desc}</p>
        <div class="tutorial-nav">
            <button class="tutorial-skip-btn" onclick="skipTutorial()">건너뛰기</button>
            <div style="display:flex;gap:8px;align-items:center;">
                <label class="tutorial-dont-show">
                    <input type="checkbox" id="tutorial-dont-show-check">
                    다시 보지 않기
                </label>
                <button class="tutorial-next-btn" onclick="nextTutorialStep()">
                    ${idx === TUTORIAL_STEPS.length - 1 ? '완료' : '다음 →'}
                </button>
            </div>
        </div>`;

    const gap = 16;
    const pw = 376;
    popover.style.top = '';
    popover.style.left = '';

    switch (step.position) {
        case 'bottom':
            popover.style.top = (rect.bottom + gap) + 'px';
            popover.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - pw)) + 'px';
            break;
        case 'right':
            popover.style.top = Math.max(8, rect.top) + 'px';
            popover.style.left = (rect.right + gap) + 'px';
            break;
        case 'left':
            popover.style.top = Math.max(8, rect.top) + 'px';
            popover.style.left = Math.max(8, rect.left - pw - gap) + 'px';
            break;
        case 'top':
            popover.style.top = Math.max(8, rect.top - gap - 200) + 'px';
            popover.style.left = Math.max(8, rect.left) + 'px';
            break;
    }
}

function nextTutorialStep() {
    tutorialStep++;
    if (tutorialStep >= TUTORIAL_STEPS.length) { endTutorial(); return; }
    showTutorialStep(tutorialStep);
}

function skipTutorial() {
    endTutorial();
}

function endTutorial() {
    const check = document.getElementById('tutorial-dont-show-check');
    if (check && check.checked) {
        try { localStorage.setItem(TUTORIAL_KEY, 'true'); } catch (e) {}
    }
    document.getElementById('tutorial-overlay')?.remove();
    document.getElementById('tutorial-spotlight')?.remove();
    document.getElementById('tutorial-popover')?.remove();
}

function restartTutorial() {
    try { localStorage.removeItem(TUTORIAL_KEY); } catch (e) {}
    try { localStorage.removeItem(NOTICE_KEY); } catch (e) {}
    showNoticePopup(() => startTutorial());
}
