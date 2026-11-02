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
│   ├── course-design.js       과정 설계 (시간 배분·학습모듈·과정 설계서)
│   ├── course-ncs.js          NCS 능력단위 검색·추천·확정
│   ├── course-sessions.js     1차시(1시간) 분할, 차시별 교수안
│   ├── course-meta.js         차시 메타데이터(상태·툴·선행·NCS 요소·이력)
│   ├── course-qbank.js        문제은행(분포·검수·문항 생성·CSV)
│   ├── course-art.js          SVG 삽화, 아트 스타일 가이드
│   ├── ai-edit-preview.js     AI 수정 단어 단위 미리보기
│   ├── lesson-editor-tools.js 섹션 고정
│   ├── course-refs.js         이미지·스캔 PDF 판독, 쪽 범위
│   ├── claude.js              Claude API 어댑터
│   ├── kbuilder/              교수안·슬라이드 렌더러 (develocket-slide)
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
└── tests/                     ← 자동 테스트 (node tests/gyosuan.test.js, node tests/course.test.js, node tests/lesson-tools.test.js)
```

## 주요 기능

- **AI 교안 생성**: Google Gemini API · Claude API 기반 자동 교안 생성 (키는 설정 패널에서 입력, Gemini 키가 없으면 삽화는 SVG로 생성)
- **5탭 시스템**: 기본학습 / 기본실습 / 심화학습 / 심화실습 / 학습이해도
- **내보내기**: Markdown / HTML / PDF / PPTX / ZIP
- **이미지 삽입**: Google 검색 + Pixabay + AI 생성 자동 삽입
- **교수안(강사뷰)**: 교안을 바탕으로 강사 활동·설명 내용·멘트 예시·학생 활동을 담은 교수안 생성
- **슬라이드**: 교수안과 함께 만든 슬라이드 편성안을 슬라이드 스튜디오에서 편집하고 PPTX·HTML로 내보내기
- **컨벤션 검수**: 콘텐츠 업무 설계 규칙으로 교안 자동 검사
- **과정 설계**: 주제와 단원 목록에서 시간을 배분하고 학습모듈 블록으로 나누어 교과·차시 생성, 과정 설계서 내려받기
- **NCS**: 교과별 능력단위 자동 배정·AI 추천·검색·확정, 차시별 능력단위요소 등록·추천, 교수안 개요에 표시 (NCS 29차 체계 2,156개)
- **1차시 분할**: 수업을 60분 단위로 나눈 차시 구성표와 차시별 교수안 내려받기
- **차시 관리**: 카테고리, 작업 상태, 사용 툴·버전, 선행 차시, 변경 이력, 상태·검색 필터
- **문제은행**: 학습 목표×밴드 분포, 문항 검수, AI 문항 생성, 문항 편집, CSV 저장
- **SVG 삽화**: 이미지 모델 키 없이 텍스트 모델이 과정 공용 화풍으로 삽화 생성
- **AI 수정 미리보기**: 선택 영역 AI 수정 결과를 단어 단위로 비교한 뒤 반영
- **섹션 고정**: 고른 섹션은 탭을 다시 생성해도 그대로 유지
- **작업별 추론 강도**: 켜면 NCS·문항·판독 같은 보조 작업만 낮춰 시간과 비용을 줄임 (교안 본문은 설정값 유지)
- **교차 검증**: Gemini·Claude 키가 모두 있으면 NCS 추천은 두 모델 합의, 문항은 다른 모델이 검수
- **참고 자료**: PDF·PPTX(노트 포함)·DOCX·MD·이미지, 스캔 PDF 판독, 쪽 범위 선택
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
