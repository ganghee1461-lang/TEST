# 가스기능사 실기 연습장 (웹앱)

claude.ai 아티팩트로 쓰던 연습장을 태블릿에서 쓰도록 따로 뺀 웹앱입니다.

- 문제·사진은 **암호화**해서 올립니다. 처음 열 때 데이터 비밀번호를 한 번 넣으면 그 기기에 열쇠가 저장됩니다.
- Claude 기능(질문·서술형 채점·손글씨 읽기)은 **내 Anthropic API 키**로 직접 부릅니다. 키는 그 기기 브라우저에만 저장됩니다.
- 풀이 기록·별표·Claude 대화는 **그 기기**(IndexedDB)에 저장됩니다. 기기를 옮길 땐 ⚙ → 백업 파일 저장/불러오기.
- 한 번 열고 나면 문제·사진을 기기에 받아 두므로 인터넷 없이도 풀 수 있습니다(Claude 기능만 인터넷 필요).

## 폴더

| 경로 | 내용 | git |
|---|---|---|
| `index.html` | 첫 화면: 비밀번호·API 키 입력, 데이터 받기 | ✅ |
| `app.html` | 연습장 본체 (빌드가 만듦) | ✅ |
| `shim.js` | 아티팩트 기능 → 웹앱 기능 연결 (API 호출, 기기 저장, 설정 ⚙) | ✅ |
| `sw.js` | 서비스 워커: 암호 파일을 풀어서 보여 주고 오프라인 보관 | ✅ |
| `enc/` | 암호화된 문제(`data/`)·사진(`img/`), `meta.json` | ✅ |
| `src/` | **평문 원본** (교재 내용·풀이 기록) | ❌ 올리지 않음 |
| `tools/build.py` | `src/` → `app.html` + `enc/` | ✅ |
| `tools/decrypt.py` | `enc/` → `src/` 복원 (새 PC에서 작업 이어갈 때) | ✅ |

## 로컬에서 작업하기

```bash
git clone https://github.com/ganghee1461-lang/TEST.git
cd TEST/practice
pip install cryptography

# 1) 평문 복원 (처음 한 번)
GP_PASS='데이터비밀번호' python3 tools/decrypt.py

# 2) src/ 안의 문제(JSON)·사진·src/index.html 수정

# 3) 다시 암호화 + app.html 생성
GP_PASS='데이터비밀번호' python3 tools/build.py

# 4) 로컬에서 확인 (서비스 워커는 localhost에서 동작)
cd .. && python3 -m http.server 8000   # → http://localhost:8000/practice/

# 5) 올리기
git add practice && git commit -m "문제 수정: ..." && git push
```

비밀번호를 바꿔서 빌드하면 모든 기기에서 새 비밀번호를 다시 넣어야 합니다.
같은 비밀번호로 다시 빌드하면 바뀐 파일만 새로 암호화됩니다.

## 문제 데이터 형식 (요약)

`src/data/sets.json`이 세트 목록, 세트마다 `src/data/<id>.json`.
문제 하나는 `prompt`(문제), `ctx`(지문), `vnote`(영상 설명), `img`(사진 경로), `parts`(칸별 `answer`·`accept`·`keys`), `theory`(관련 이론)로 되어 있습니다.
채점 규칙(`accept`: 그대로 맞으면 정답, `keys`: 핵심어 묶음)은 [CHANGELOG](CHANGELOG.md)의 채점 항목을 참고하세요.

## API 사용량

⚙ 설정에서 이 기기에서 쓴 토큰과 대략 금액을 볼 수 있습니다. 질문(튜터)은 Sonnet, 채점·손글씨는 Haiku를 씁니다.
'다른 문제 조회'를 켜면 Claude가 문제은행을 찾아보느라 요청이 몇 번 더 갑니다(기본 꺼짐).
