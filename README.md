# 디벨로켓 교안 도우미

AI 기반 게임 기획 교안 자동 생성 도구

## 실행 방법

### 사전 준비
- [Node.js](https://nodejs.org) 설치 (LTS 권장)

### 실행
1. `실행.bat` 더블클릭
2. 브라우저가 자동으로 열립니다 (`http://localhost:3000`)

> 종료: 명령 프롬프트 창을 닫거나 `Ctrl+C`

## 폴더 구조

```
교안봇/
├── index.html                 ← 메인 페이지
├── slide-studio.html          ← 슬라이드 스튜디오 (iframe)
├── 실행.bat                   ← 서버 실행 파일
├── server.js                  ← 로컬 웹서버
├── README.md                  ← 이 파일
│
├── js/                        ← JavaScript 모듈
│   ├── api.js                 API 호출 / 마크다운 렌더링
│   ├── data.js                설정값 / 프롬프트
│   ├── ui.js                  UI 렌더링 / 내보내기
│   ├── tabs.js                5탭 시스템
│   ├── state.js               상태 관리 (IndexedDB)
│   ├── diagram.js             Mermaid 다이어그램
│   ├── gyosuan.js             교수안·슬라이드 편성안 생성, 강사뷰
│   ├── lesson-lint.js         컨벤션 검수
│   ├── claude.js              Claude API 어댑터
│   ├── kbuilder/              교수안·슬라이드 렌더러 (develocket-slide)
│   ├── export-modal.js        내보내기 모달
│   ├── tutorial.js            튜토리얼
│   ├── panel-manager.js       패널 관리
│   ├── merge.js               차시 병합
│   ├── convention.js          교안 컨벤션
│   └── filename-convention.js 파일명 규칙
│
├── assets/                    ← 리소스 파일
│
├── docs/                      ← 문서
│   └── 기능_설명서.md
│
└── tests/                     ← 자동 테스트 (node tests/gyosuan.test.js)
```

## 주요 기능

- **AI 교안 생성**: Google Gemini API · Claude API 기반 자동 교안 생성 (키는 설정 패널에서 입력, 이미지 생성은 Gemini 키 필요)
- **5탭 시스템**: 기본학습 / 기본실습 / 심화학습 / 심화실습 / 학습이해도
- **내보내기**: Markdown / HTML / PDF / PPTX / ZIP
- **이미지 삽입**: Google 검색 + Pixabay + AI 생성 자동 삽입
- **교수안(강사뷰)**: 교안을 바탕으로 강사 활동·설명 내용·멘트 예시·학생 활동을 담은 교수안 생성
- **슬라이드**: 교수안과 함께 만든 슬라이드 편성안을 슬라이드 스튜디오에서 편집하고 PPTX·HTML로 내보내기
- **컨벤션 검수**: 콘텐츠 업무 설계 규칙으로 교안 자동 검사
- **교안 컨벤션**: 파일명 규칙, 마크다운 컨벤션 설정

## 기술 스택

| 분류 | 기술 |
|------|------|
| AI | Google Gemini API, Claude API |
| 마크다운 | marked.js |
| 다이어그램 | Mermaid.js |
| PDF | html2pdf.js |
| PPTX | PptxGenJS (슬라이드 스튜디오) |
| 압축 | JSZip + FileSaver |
| UI | Tailwind CSS + Phosphor Icons |
| 저장 | IndexedDB |
