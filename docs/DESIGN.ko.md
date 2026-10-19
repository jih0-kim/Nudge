# Nudgling (너즐링) 구현 설계

> 일을 대신해 주는 에이전트 말고, 내가 하게 만드는 에이전트.
> 내가 정한 습관을 실제로 하면 알에서 시작한 너즐이가 자란다.

Cline x Composio x Parallel 해커톤 (Open Source AI Week, 2026-10-19)

---

## 1. 문제와 접근

- 개인 에이전트 대부분은 일을 대신해 준다 (메일 정리, 일정, 리서치).
- 논문 읽기, 운동, 글쓰기는 대신해 줄 수 없다. 사람이 미루는 이유는 확인이 없어서보다 시작이 무거워서인 경우가 많다.
- 너즐링은 세 가지를 한 번에 한다.
  1. **실제 데이터로 검증:** 자기 보고가 아니라 슬랙 스레드 답장, GitHub 활동 등 흔적으로 인정
  2. **시작 비용 낮추기:** 다음 퀘스트를 언제, 어디서, 무엇을, 얼마나 할지 정하고 자료까지 미리 준비
  3. **사람마다 다르게 크는 캐릭터:** 습관 반복 횟수에 따라 성장, 습관별 파츠로 개성이 생김

기존 프로젝트와의 차이: lifeagent(검증 + 압박), 커밋 다마고치들(코딩만), Habitica(자기 보고). 너즐링은 검증 + 시작 준비 + 성장의 조합.

---

## 2. 심사 기준 매핑 (각 5점, 총 20점)

| 기준 | 너즐링에서 보여줄 것 |
|---|---|
| 유용성 | 습관 형성 연구 기반 설계, 내가 실제로 쓰는 습관(논문 읽기, 레포 관찰)으로 시연 |
| 실제 동작 | 슬랙 퀘스트 → 수락 → 캘린더 일정 생성 → 스레드 답장 → 프로필 캐릭터 커밋까지 한 번에 실행 |
| 독창성 | "하게 만드는" 방향, 연구 기반 성장 곡선, 플랫폼별로 다르게 쌓이는 기록 |
| 재현성 | 템플릿 레포, 환경 변수 이름, `nudgling.yaml` 예시, 샘플 `events.jsonl`, 키 없이 도는 `demo` 명령 |

승인 경계: 캘린더 일정 생성과 프로필 커밋은 사용자의 ✅ 리액션 이후에만 실행. 데모에서 이 지점을 명시한다.

---

## 3. 아키텍처

```
             Sources (신호 입력)
  Slack 스레드   GitHub   Google Calendar   코딩 에이전트(MCP)
                     │
              ┌──────▼───────┐
              │    Core      │  이벤트 로그 → 규칙 계산 → 퀘스트 → 렌더링
              └──────┬───────┘
                     │
             Surfaces (표시, 상호작용)
  GitHub 프로필   CLI   Slack DM   MCP 서버   (로드맵: VS Code, 폰 페이지)
```

원칙
- Core는 어디에 붙는지 모른다. Sources와 Surfaces는 어댑터로 추가한다.
- 원본 데이터는 `events.jsonl` 하나. 스탯, 단계, 캐릭터는 전부 여기서 계산한다.
- 성장 규칙과 렌더링은 결정적 코드. LLM은 퀘스트 문구, 진화 설명처럼 창의적인 부분만 맡는다.

### 실행 단계 (한 번의 `run`)

| 역할 | 하는 일 | 사용 도구 | LLM |
|---|---|---|---|
| Watcher | 슬랙 리액션, 스레드 답장, GitHub 변화 감지 | Composio (Slack, GitHub) | 증거 판정에 소형 호출 |
| Keeper | 로그 기록, 반복 횟수, 단계, 기분, 다음 퀘스트 시간 계산 | 없음 (순수 코드) | 없음 |
| Scout | 다음 퀘스트 후보 3개와 준비 자료 | Parallel (Search, Task) | 퀘스트 문구 |
| Scheduler | 언제 할지 결정, 수락 시 캘린더 일정 생성 | Composio (Google Calendar) | 없음 |
| Messenger | 슬랙 DM 전송, 진화 알림 | Composio (Slack) | 없음 |
| Renderer | pet.svg 생성, 프로필 레포 커밋 | Composio (GitHub) | 없음 |

데모 로그에는 각 줄 앞에 `[Watcher]`, `[Scout]` 같은 역할 이름을 찍는다.

---

## 4. 데이터 모델

### 4.1 `nudgling.yaml` (사용자가 고치는 유일한 파일)

```yaml
pet:
  name: 너즐이
  profile_repo: jiho/jiho        # 공개 프로필 레포
  seed: jiho                     # 개체 차이용 시드

channel: slack

habits:
  - id: paper-reading
    label: 논문 읽기
    source: slack_thread          # 스레드 답장을 증거로 인정
    target_reps: 66               # 습관 형성 기준 (운동 프리셋 99)
    part: glasses                 # 이 습관이 키우는 파츠
    place: 집 책상
    duration: { start: 15m, min: 10m, max: 45m }
    scout: "follow-up papers on VLA and robot manipulation I recently read"

  - id: watch-repos
    label: 관심 레포 관찰
    source: slack_thread
    watch: [pytorch/pytorch, PyTorchKR/Awesome-Physical-AI]
    target_reps: 66
    part: antenna
    place: 아무 곳
    duration: { start: 10m, min: 5m, max: 20m }
    scout: "what changed in these repos and why it matters"

schedule:
  quiet_hours: "23:00-08:00"
  use_calendar: true
  timezone: America/Los_Angeles
```

습관 하나 = **어디서 감지 + 무엇을 증거로 + 몇 번이면 형성 + 어떤 파츠 + 다음 퀘스트 방향**.

### 4.2 `events.jsonl` (append-only 원본)

```jsonl
{"ts":"2026-10-19T12:01:00-07:00","type":"quest_proposed","quest_id":"q1","habit":"paper-reading","options":["o1","o2","o3"],"slot":"2026-10-19T21:00","duration_min":15}
{"ts":"2026-10-19T12:05:00-07:00","type":"quest_accepted","quest_id":"q1","option":"o2","declined":["o1","o3"],"client":"slack"}
{"ts":"2026-10-19T12:05:10-07:00","type":"calendar_event_created","quest_id":"q1","event_id":"..."}
{"ts":"2026-10-19T21:30:00-07:00","type":"quest_completed","quest_id":"q1","habit":"paper-reading","evidence":{"kind":"slack_thread","text":"FAST 토크나이저는 DCT로..."},"client":"slack"}
{"ts":"2026-10-19T21:30:05-07:00","type":"evolved","from":0,"to":1}
{"ts":"2026-10-19T22:00:00-07:00","type":"activity_logged","habit":"watch-repos","client":"cline"}
```

- `declined`: 고르지 않은 옵션. 취향 학습의 핵심 신호.
- `client`: MCP 연결 시 `clientInfo.name`으로 자동 기록 (cline, claude-code, cursor 등). 플랫폼별 기록의 근거.

### 4.3 파생 데이터

- `profile.md`: LLM이 로그를 주기적으로 요약한 취향 ("코드 있는 논문을 고름", "21시대 완료율 높음"). 사람이 직접 수정 가능.
- `pet.json`: Keeper가 계산한 상태 (단계, 습관별 반복 횟수, 기분, 다음 퀘스트 시간). 언제 다시 계산해도 같은 값.

### 4.4 저장 위치

| 데이터 | 위치 | 이유 |
|---|---|---|
| `events.jsonl`, `profile.md`, `pet.json`, `nudgling.yaml` | 비공개 레포 (템플릿으로 생성) | 활동 기록은 비공개 |
| `nudgling.svg`, README | 공개 프로필 레포 `사용자명/사용자명` | 캐릭터만 공개 |

---

## 5. 성장 규칙

근거: Lally 외 (2010) 자동화까지 평균 66일, 18~254일. 초반 반복에서 자동성이 가장 크게 오르고 이후 평평해짐. 하루 빠짐은 영향이 작고, 빠짐이 쌓이면 최대치가 낮아짐. 운동은 약 1.5배 오래 걸림. Singh 외 (2024) 메타분석 중앙값 59~66일.

### 5.1 단계 (습관별 완료 횟수 기준)

| 단계 | 완료 횟수 (target 66) | 비율 | 모습 |
|---|---|---|---|
| 0 알 | 0 | 0 | 알 |
| 1 금 간 알 | 1 | 첫 반복 | 금이 가고 새싹이 고개를 내밂 |
| 2 부화 | 7 | 7/66 | 껍질 속 모찌 몸통, 첫 파츠 등장 |
| 3 유년 | 21 | 21/66 | 껍질을 벗고 앉음, 파츠 2단계 |
| 4 청년 | 42 | 42/66 | 몸이 커지고 새싹이 잎이 됨 |
| 5 성체 | 66 | 1 | 습관 형성 완료, 형태 이름 부여 |

- `target_reps`가 다르면 비율대로 환산 (운동 99: 1, 11, 32, 63, 99).
- **몸 단계 = 가장 많이 진행된 습관의 단계.** 성체는 "습관 하나 이상 형성"을 의미한다.
- **나머지 습관은 파츠로 표시.** 각 습관의 단계가 그 파츠의 레벨.
- 66회 도달 습관은 졸업. 파츠는 영구히 남고 새 습관을 제안한다.
- 단계와 파츠는 내려가지 않는다. 연속 기록(streak) 개념 없음.

### 5.2 기분 (눈)

| 마지막 완료 후 | 눈 | 추가 행동 |
|---|---|---|
| 2일 이내 | 반짝이는 눈 | |
| 3~6일 | 평소 눈 | |
| 7일 이상 | 졸린 눈 | 다음 퀘스트를 최소 시간으로 제안 |

### 5.3 퀘스트 시간 조정

- 최근 5회 중 4회 이상 완료 → +5분
- 최근 5회 중 절반 미만 완료 → -5분
- 습관별 `min`, `max` 범위 안에서만

### 5.4 시간대 결정

- 연구상 일정한 시간대가 습관을 강하게 하므로 **과거 수락 시간대를 우선**한다.
- 후보: 최근 수락 시각의 최빈 시간대 ± 30분 → 캘린더 빈 시간과 교집합 → `quiet_hours` 제외.
- 수락 기록이 없으면 오늘 남은 빈 시간 중 가장 이른 슬롯.

### 5.5 데모 모드

`NUDGLING_DEMO=1`이면 단계 기준을 1, 2, 3, 4, 5회로 줄인다. 샘플 로그 재생으로 알부터 성체까지 몇 초에 보여준다.

---

## 6. 퀘스트

### 6.1 슬랙 메시지

```
🥚 너즐이의 퀘스트

📖 무엇: π0-FAST 논문 3장 (토크나이저 부분) 읽기
🕘 언제: 오늘 21:00 (최근 이 시간대 완료 4/5)
⏱ 얼마나: 15분
📍 어디서: 집 책상, 논문 링크
💡 미리 준비: 핵심 3줄 요약 (출처 2건)

1️⃣ 2️⃣ 3️⃣ 리액션으로 고르기 (다른 후보는 스레드에)
끝나면 이 스레드에 한 줄 요약을 남겨줘
```

- 버튼 대신 리액션: 서버 없이 다음 실행에서 읽을 수 있음.
- 수락 → Scheduler가 캘린더 일정 생성 (설명란에 링크와 요약).
- 스레드 답장 → Watcher가 증거 판정 → `quest_completed`.

### 6.2 증거 판정

- 1차 규칙: 스레드 답장이 존재하고 10자 이상.
- 2차 LLM(선택): 퀘스트 주제와 관련 있는지 yes/no. 실패 시 1차 규칙만으로 인정.

### 6.3 Scout와 Parallel

- 논문: Search API로 후보 수집 → Task API로 3줄 요약과 인용.
- 레포: GitHub 최근 릴리스/커밋(Composio) + Search로 외부 맥락.
- 프롬프트에 `profile.md`와 최근 `declined` 목록을 넣어 취향 반영.

---

## 7. Surfaces

### 7.1 CLI

```bash
npx nudgling run            # 한 번 실행 (Watcher → ... → Renderer)
npx nudgling status         # 단계, 습관별 진행, 다음 퀘스트
npx nudgling demo           # 샘플 로그 재생 (키 불필요)
npx nudgling render         # nudgling.svg만 다시 생성
npx nudgling connect slack github googlecalendar   # Composio 인증 링크
```

### 7.2 GitHub 프로필

- `nudgling.svg`를 프로필 레포에 커밋, README에서 `raw.githubusercontent.com` 전체 URL로 참조.
- 애니메이션은 SMIL(`<animate>`, `<animateTransform>`)만 사용. CSS, 폰트, 스크립트, 외부 참조 금지.
- 캐시 회피: README의 이미지 URL에 `?v=<커밋 해시>`.

### 7.3 MCP 서버

| 도구 | 설명 |
|---|---|
| `get_status` | 단계, 습관별 진행, 기분, 다음 퀘스트 |
| `get_quests` | 준비된 퀘스트 후보 |
| `accept_quest` | 선택 기록 (`declined` 포함) |
| `log_activity` | 활동 기록 (client 자동 기록) |
| `render_pet` | 현재 SVG 반환 |

설정 예시 (Cline, Claude Code, Cursor 공통 형식)

```json
{ "mcpServers": { "nudgling": { "command": "npx", "args": ["-y", "nudgling", "mcp"] } } }
```

자동 기록 보강: 훅 지원 도구는 세션 종료 시 `npx nudgling log`, 그 외는 `AGENTS.md`/`.clinerules`에 호출 지침, 최후 안전망은 GitHub 활동 감지.

### 7.4 슬랙

- 오늘: 퀘스트 DM, 리액션과 스레드 읽기, 진화 시 GIF 알림(시간 남으면).
- 로드맵: `/status` 즉시 응답 (Socket Mode 프로세스 필요).

---

## 8. 캐릭터 렌더링

스타일: 파스텔 모찌 느낌. 따뜻한 갈색 외곽선(#5B4036, 3.5px, 둥근 이음), 크림색 몸(#FFFDF8), 흐린 분홍 볼터치(가우시안 블러), 작은 점눈과 하이라이트, 입 없음. 성장 상징은 머리 위 새싹.

구성: `renderPet(state) → SVG 문자열` 순수 함수. 파츠 조합 방식.

| 레이어 | 결정 요소 |
|---|---|
| 몸 형태 | 단계 |
| 눈 | 기분 (반짝, 평소, 졸림) |
| 새싹 | 단계 (새싹 → 잎 → 꽃) |
| 습관 파츠 | 습관별 단계 (안경, 더듬이, 운동 밴드, 펜 꼬리 등) |
| 색조 | 시드 해시로 미세 변화 (볼터치, 반점 색) |
| 형태 이름 | 성체 진화 시 LLM이 로그를 보고 작명 (텍스트만) |

GIF: 생성기가 숨쉬기 위상을 고정한 정지 프레임 12장을 출력 → PNG 변환 → GIF 합성. 브라우저 불필요.

현재 에셋: `assets/stage0-egg.svg`, `assets/stage1-cracked.svg`, `assets/stage2-hatchling.svg`.

---

## 9. 디렉터리 구조 (TypeScript, Node 20+)

```
nudgling/
├── src/
│   ├── core/
│   │   ├── events.ts        # 로그 읽기/쓰기
│   │   ├── rules.ts         # 단계, 파츠, 기분, 시간 조정, 시간대 (순수 함수)
│   │   ├── config.ts        # nudgling.yaml 로드, 검증
│   │   └── run.ts           # 실행 단계 오케스트레이션
│   ├── roles/
│   │   ├── watcher.ts
│   │   ├── scout.ts
│   │   ├── scheduler.ts
│   │   ├── messenger.ts
│   │   └── renderer.ts
│   ├── adapters/
│   │   ├── composio.ts      # Slack, GitHub, Google Calendar 도구 실행
│   │   ├── parallel.ts      # Search, Task
│   │   └── llm.ts           # OpenAI 호환 클라이언트
│   ├── pet/
│   │   ├── render.ts        # renderPet(state)
│   │   └── parts/           # 몸, 눈, 새싹, 습관 파츠 SVG 조각
│   ├── surfaces/
│   │   ├── cli.ts
│   │   └── mcp.ts
├── examples/
│   ├── nudgling.yaml
│   └── events.sample.jsonl
├── assets/
├── .github/workflows/nudgling.yml   # 30분마다 run
├── .env.example
├── LICENSE                          # MIT
└── README.md
```

---

## 10. 환경 변수

```
COMPOSIO_API_KEY=
COMPOSIO_USER_ID=          # Composio 연결 계정 식별자
PARALLEL_API_KEY=
LLM_BASE_URL=              # OpenAI 호환 (오픈 모델 제공자)
LLM_API_KEY=
LLM_MODEL=
NUDGLING_DEMO=0
```

---

## 11. 오늘 일정 (해킹 11:45 ~ 15:15)

| 시간 | 작업 | 완료 기준 |
|---|---|---|
| 11:45 ~ 12:15 | 레포 생성, 키 발급, Composio로 Slack, GitHub, Calendar 연결, Parallel 호출 테스트 | 각 도구 1회 호출 성공 |
| 12:15 ~ 13:00 | core: events, rules, config, renderPet(단계 0~2), `demo` 명령 | 샘플 로그로 알 → 부화 SVG 출력 |
| 13:00 ~ 13:40 | Messenger + Watcher: 퀘스트 DM, 리액션과 스레드 읽기 | 슬랙에서 수락과 완료가 로그에 기록 |
| 13:40 ~ 14:15 | Scout + Scheduler: Parallel 퀘스트, 캘린더 빈 시간과 일정 생성 | 메시지에 무엇/언제/얼마나/어디서 + 일정 생성 |
| 14:15 ~ 14:35 | Renderer: 프로필 레포 커밋 | 프로필 새로고침 시 캐릭터 변화 |
| 14:35 ~ 14:55 | MCP 서버 5개 도구, Cline 연결 | Cline에서 `get_status` 응답 |
| 14:55 ~ 15:15 | README, LICENSE, 예시 파일, 제출 | 다른 사람이 따라 할 수 있는 문서 |

우선순위가 밀리면 MCP → 캘린더 → Parallel 순으로 축소. 슬랙 루프와 프로필 커밋은 끝까지 지킨다.

---

## 12. 데모 시나리오 (3분)

1. 문제 (20초): "개인 에이전트는 일을 대신해 주지만 논문 읽기는 대신 못 해준다."
2. 설정 (20초): `nudgling.yaml` 습관 두 개, 프로필에 알.
3. 실행 (90초): `npx nudgling run` → 역할별 로그 → 슬랙 퀘스트 도착 → ✅ → 캘린더 일정 생성 → 스레드에 한 줄 요약 → 다시 `run` → 프로필에서 금 간 알 확인.
4. 성장 (30초): `npx nudgling demo`로 연구 기반 단계 소개. "21번이면 습관이라는 말이 있지만 연구상 절반, 그래서 여기서 유년기."
5. 확장 (20초): Cline에서 MCP `get_status`, 플랫폼별 기록. 템플릿 레포로 누구나 시작.

목업이나 실패한 단계는 데모에서 직접 밝힌다.

---

## 13. 리스크와 대체안

| 리스크 | 대체안 |
|---|---|
| Composio 특정 액션 이름이나 권한이 예상과 다름 | 킥오프 직후 도구 목록 조회로 확인, 안 되면 해당 기능은 로드맵으로 |
| 슬랙 리액션 읽기 불가 | 스레드에 "1", "2", "3" 텍스트 답장으로 선택 |
| 캘린더 연동 지연 | 시간대만 메시지에 표시, 일정 생성은 로드맵 |
| 프로필 이미지 캐시 | `?v=` 쿼리 변경, 데모 전 미리 한 번 확인 |
| LLM 응답 불안정 | 퀘스트 템플릿 기본 문구로 대체, 단계와 렌더링은 LLM 없이 동작 |

---

## 14. 로드맵

- GitHub Actions 스케줄 운영, 템플릿 레포 공개
- `npx nudgling init`: 설치된 코딩 도구에 MCP, 규칙, 훅 자동 설정
- 슬랙 `/status` 즉시 응답, 진화 GIF
- 폰 홈 화면 페이지 (GitHub Pages), VS Code 상태 표시줄
- 운동 소스 (Strava 등), 노션 소스
- 성체 이후 새 습관 제안과 다음 세대

---

## 참고 문헌

- Lally, P. 외 (2010). How are habits formed: Modelling habit formation in the real world. European Journal of Social Psychology.
- Singh, B. 외 (2024). Time to form a habit: a systematic review and meta-analysis of health behaviour habit formation and its determinants. Healthcare, 12(23), 2488.
