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
├── 디벨로켓 교안 도우미.html   ← 메인 페이지
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
│   ├── slide-export.js        슬라이드 내보내기
│   ├── export-modal.js        내보내기 모달
│   ├── tutorial.js            튜토리얼
│   ├── panel-manager.js       패널 관리
│   ├── merge.js               차시 병합
│   ├── convention.js          교안 컨벤션
│   └── filename-convention.js 파일명 규칙
│
├── assets/                    ← 리소스 파일
│   └── slide-template.pptx    PPTX 템플릿
│
├── docs/                      ← 문서
│   └── 기능_설명서.md
│
└── _dev/                      ← 개발용 (공유 시 제외 가능)
    ├── .claude/
    ├── CLAUDE.md
    ├── Context_01.md
    └── checkpoint.txt
```

## 주요 기능

- **AI 교안 생성**: Google Gemini API 기반 자동 교안 생성
- **5탭 시스템**: 기본학습 / 기본실습 / 심화학습 / 심화실습 / 학습이해도
- **내보내기**: Markdown / HTML / PDF / PPTX / ZIP
- **이미지 삽입**: Google 검색 + Pixabay + AI 생성 자동 삽입
- **슬라이드 뷰**: HTML 슬라이드 보기/수정/내려받기
- **교안 컨벤션**: 파일명 규칙, 마크다운 컨벤션 설정

## 기술 스택

| 분류 | 기술 |
|------|------|
| AI | Google Gemini API |
| 마크다운 | marked.js |
| 다이어그램 | Mermaid.js |
| PDF | html2pdf.js |
| PPTX | PptxGenJS |
| 압축 | JSZip + FileSaver |
| UI | Tailwind CSS + Phosphor Icons |
| 저장 | IndexedDB |
