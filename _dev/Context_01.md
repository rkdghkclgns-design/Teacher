# 교안봇 컨텍스트 #01

## 프로젝트 개요
- **프로젝트명**: 디벨로켓 교안 도우미
- **목적**: AI 기반 게임 기획 교안 자동 생성 도구
- **구조**: 멀티 파일 (HTML + JS 14개)
- **작업 경로**: `C:\Users\KGA-유치훈\OneDrive\바탕 화면\유치훈\딸각 스튜디오\교안봇\`

## 파일 구조
```
교안봇/
├── 디벨로켓 교안 도우미.html    (메인 HTML)
├── api.js                  (API 호출, 마크다운 렌더링, 이미지 처리)
├── data.js                 (설정값, 상수, 프롬프트, extractText)
├── ui.js                   (UI 함수, 내보내기, 드롭다운, 라우팅)
├── tabs.js                 (5탭 시스템, 생성/보강)
├── state.js                (상태 관리, IndexedDB, 저장/복원)
├── diagram.js              (Mermaid 다이어그램)
├── slide-export.js         (HTML/PPTX 슬라이드 내보내기)
├── export-modal.js         (내보내기 모달)
├── tutorial.js             (튜토리얼 시스템)
├── panel-manager.js        (패널 매니저)
├── merge.js                (차시 병합 재생성)
├── convention.js           (교안 컨벤션)
├── filename-convention.js  (파일명 규칙)
├── server.js               (Node.js 로컬 서버)
├── 실행.bat                (서버 실행 + 브라우저 오픈)
└── Context_01.md           (컨텍스트 기록)
```

## 핵심 기술 스택
- **AI**: Google Gemini API (gemini-2.5-flash 텍스트, gemini-2.0-flash-exp 이미지)
- **마크다운**: marked.js (GFM, breaks:false)
- **다이어그램**: Mermaid.js
- **PDF**: html2pdf.js
- **PPTX**: PptxGenJS v3.12.0
- **ZIP**: JSZip + FileSaver
- **UI**: Tailwind CSS CDN + Phosphor Icons
- **저장**: IndexedDB (via DBManager in state.js)

## 데이터 구조 (중요!)
- 교과 데이터: `globalState.subjects[n].lessons` (**lessons** 사용, ~~modules~~ 아님)
- 탭 키 이름: `basicLearn`, `basicPrac`, `advLearn`, `advPrac`, `assessment`
- 메인 퀘스트: `subj.mainQuest` (별도 객체)
- `courseData` 변수: 현재 활성 교과의 `lessons` 배열 참조

## 5탭 시스템
| 탭 ID | 라벨 |
|-------|------|
| basicLearn | 기본학습 |
| basicPrac | 기본실습 |
| advLearn | 심화학습 |
| advPrac | 심화실습 |
| assessment | 학습이해도 |

## API 키 보호
- API 키는 char code 배열로 난독화 저장 (Google Scanner 회피)
- 비밀번호 112400으로 보호 (3회 실패 시 차단)

## 이번 세션 수정 이력 (2026-03-24)

### 에러 수정
1. **ui.js `handleRoute()` null 체크** — `overview`/`editor` DOM 요소 null 시 early return
2. **ui.js `openSubjectDetail()` null 체크** — `panel` null 시 early return
3. **ui.js 내보내기 함수들** — `subj.modules` → `subj.lessons` 변경 (exportSubjectToMD/HTML/Slide, exportSelectedToZip, exportAllToZip)
4. **ui.js 내보내기 함수들** — tabNames 키 `basic`→`basicLearn`, `advanced`→`advLearn` 수정
5. **ui.js 3개 export 함수** — `subj` null 체크 추가

### 코드리뷰 결과 수정 (8건)
1. **slide-export.js** — `subj.modules` → `subj.lessons` (슬라이드/PPTX 내보내기 완전 고장 수정)
2. **api.js handleGenerate** — `tabContents`/`images` 필드 초기화 추가
3. **api.js generateQuiz** — tabContents fallback 추가 (content 없어도 탭 내용으로 퀴즈 생성 가능)
4. **server.js** — 경로 탐색(path traversal) 보안 취약점 수정
5. **merge.js** — tabContents 읽기 fallback 추가 (병합 시 탭 내용 인식)
6. **export-modal.js** — buildFilename 인덱스 0 고정 → 실제 차시 번호 사용
7. **state.js importProjectZip** — sanitizeState 통과 추가 (악성 ZIP 방어)

### 전수 테스트 결과
- 자동화 테스트 12/12 PASS
- UI 브라우저 테스트 10/10 PASS
- 콘솔 에러 0건

## 미완료 항목
- (없음 — 현재 요청 사항 모두 처리됨)
