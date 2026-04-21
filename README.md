# Paper Logic Graph Prototype

문서에서 문장과 핵심 개념을 추출하고, 문장 간 연결과 충돌 신호를 방사형 그래프로 살펴보는 프로토타입입니다.

## 구성

- `src/parsing`: 문장 분리, 토큰 정규화, 핵심 개념 추출
- `src/analysis`: 문장 연결 강도 계산, 충돌 신호 탐지, 그래프 모델 생성
- `src/ui`: D3 기반 방사형 그래프와 컨텍스트 패널 렌더링
- `src/workers`: 분석 파이프라인을 브라우저 워커에서 실행

## 실행

이 프로젝트는 `ES module`과 `Web Worker`를 사용하므로 `index.html`을 파일로 직접 열지 말고 로컬 서버로 실행해야 합니다.

```bash
npm start
```

브라우저에서 `http://127.0.0.1:4173`으로 접속하면 됩니다.

## 테스트

```bash
npm test
```

## 현재 지원 입력

- 텍스트 직접 붙여넣기
- `.pdf`, `.doc`, `.docx`, `.txt`, `.md` 파일 업로드
- 공개 가능한 Google Docs URL 불러오기
