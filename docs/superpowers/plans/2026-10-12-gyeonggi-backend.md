# 경기버스 백엔드 계획 — 기존 API 유지

> 2026-10-27 사용자 제약 반영. 이전의 기존 `/regular` 변경·기존 DB 마이그레이션·공유 service 수정 계획을 대체한다. 기존 API는 수정하지 않는다.
>
> **For agentic workers:** 이 문서는 개발 범위와 후속 구현 조건을 정한다. 새 백엔드 구현은 별도 요청 시 `superpowers:writing-plans`로 구현 단계를 확정한 뒤 진행한다. 현재 PR에 백엔드 구현은 없다.

**Goal:** 기존 서울 API와 알림 동작을 그대로 유지하면서 경기 데이터·앱 기능을 추가할 수 있는 경계를 정한다.

**Architecture:** 1차는 정적 데이터 변환과 앱의 경기 외부 API 직접 조회로 처리하므로 BE 변경이 없다. 향후 경기 정기알림이 필요하면 신규 endpoint·별도 collection·별도 scheduler/sender로 분리한다. 기존 서울 알림 collection에는 경기 레코드를 저장하지 않는다.

**Tech Stack:** 1차는 Python JSON 변환과 기존 iOS 앱. 후속 경기 알림은 기존 NestJS/Mongoose/Firebase 기술 사용 가능하나 기존 API 구현체 수정은 범위에서 제외한다.

**최소 변경 검토:** [최종 권고 설계](../../../data/gyeonggi/MINIMAL_CHANGE_DESIGN.md). 초기 경기 즐겨찾기·정기알림·위젯 저장을 미루는 조건에서 기존 CoreData와 서울 ID도 유지한다. 앱 내부 `gg:` 키는 외부 API나 기존 서버로 전송하지 않는다.

**Spec:** [서울 형식 변환 검증](../../../data/gyeonggi/SEOUL_FORMAT_COMPATIBILITY.md), [앱팀 전달 문서](../../../data/gyeonggi/APP_HANDOFF.md). 기존 API/코드 검토 기준은 이 브랜치의 서버 코드다.

## Global constraints

- 기존 `/regular`의 URL, HTTP method, request/response, validation, GET 범위, DELETE 조건, 등록 및 발송 동작을 유지한다.
- 응답의 기존 `busRoutedId` 철자, arsId/busRouteId/adirection 의미, Mongo `_id`와 기존 사용자 데이터를 유지한다.
- 기존 `RegularAlarm` collection에 provider/경기 필드를 추가하거나 경기 문서를 저장하지 않는다. 서울 backfill도 수행하지 않는다.
- 기존 BusInfoService, RegularAlarmService/Repository, FcmService, cron, MessageUtil을 경기 지원 목적으로 수정하지 않는다.
- 경기 stationId를 서울 arsId로 바꾸어 기존 API에 전달하지 않는다. 표시번호와 API ID의 의미는 데이터 형식 통일과 별개다.
- 신규 endpoint도 이번 요청에서 구현하지 않는다. 기존 API 무변경 원칙을 만족하는 후속 선택지로만 정리한다.

## Review focus

1. 파일 필드명 통일을 API 기능 호환으로 오인하지 않는가: 앱은 지역·조회 ID·외부 API 분기를 유지한다.
2. 기존 서울 scheduler가 경기 문서를 읽을 수 있는가: 별도 collection을 필수로 한다.
3. 구버전 앱 sync가 경기 알림을 삭제할 수 있는가: 기존 GET에는 원래 서울 collection만 있으므로 새 경기 알림을 보지 못하게 한다.
4. 신규 구현이 공유 FCM/조회 service의 동작을 바꾸는가: 새로운 adapter/sender를 사용하고 기존 코드 수정은 제외한다.
5. 경기 기능 중단이 서울 기능에 영향을 주는가: 독립 설정·실행권·collection으로 경기만 끌 수 있게 한다.

## 1. 바로 진행 가능한 범위 — BE 수정 없음

| 기능 | 처리 위치 | 기존 BE 변경 |
|---|---|---|
| 서울 형식 경기 정류소 JSON | 데이터 변환 단계 | 없음 |
| 경기 검색·지도 | 앱의 별도 경기 번들 + 지역 enum | 없음 |
| 경기 실시간 도착 | 앱의 GBIS 직접 호출 adapter | 없음 |
| 서울 기존 정기알림 | 기존 `/regular` | 없음 |
| 경기 정기알림 | 별도 구현 전 비활성화 | 기존 `/regular` 재사용 금지 |

정적 파일은 `DESCRIPTION`, `REGION="경기"`, `DATA`로 저장할 수 있다. 레코드는 stop_nm/stop_no/node_id/xcode/ycode/stop_type/nxtStn으로 변환한다. 좌표는 문자열, 불확실한 단일 방향은 null. 검증 결과·재생성 코드는 연결된 변환 문서에 있다.

앱 변경 최소 범위:

1. 경기 REGION/도메인 분기와 별도 JSON 로딩.
2. 서울은 stop_no → arsId 유지, 경기는 node_id → stationId 사용. stop_no는 별도 표시번호로 보존.
3. 경기 외부 도착 API DTO 및 endpoint 추가. 서버 `/regular`로 우회하지 않는다.
4. 신규 경기 알림 기능이 배포되기 전 경기 정기알림 등록 UI 비활성화.

서울/경기 데이터는 파일 단위로 구분하고 제공자 정보를 도메인에 유지한다. 표시번호로 양쪽 데이터를 병합하면 충돌·누락이 생길 수 있다.

## 2. 기존 개발 계획에서 제거한 작업

- 기존 `/regular` GET에 provider 필터 추가 및 DELETE 조건 변경.
- 기존 request/response DTO에 경기 필드 추가 또는 서울을 포함하는 `/v2/regular` 전환.
- 기존 RegularAlarm schema 확장, 서울 문서 backfill, 기존 index 변경.
- 기존 sendNotification의 오류 처리/삭제 정책 변경.
- 공유 FcmService의 await 처리와 기존 서울 cron의 실행권 변경.
- 기존 dashboard metric 분류 및 공통 logging 동작 변경.

위 코드에 개선 가능한 부분이 있어도 이번 경기 확장 작업에 끼워 넣지 않는다. 별도 서울 유지보수 요청에서 검토한다. 이 제약 아래에서도 경기 검색·지도·직접 도착 조회는 가능하다.

## 3. 향후 경기 정기알림이 필요할 때의 분리 설계

현재 필요 기능은 아니다. 기존 API를 유지하면서 경기 알림을 추가하려는 후속 요청이 있을 때만 아래 설계를 구현한다.

### 신규 경로와 저장소

신규 경로 후보는 `/gyeonggi/regular`. 서울 `/regular`와 별도 controller/service/repository를 사용한다. 새 API는 경기만 처리하므로 서울 API를 통합하거나 이전하지 않는다. 신형 앱은 서울 알림은 기존 경로, 경기 알림은 신규 경로로 각각 동기화한다.

Mongo collection은 명시적인 새 이름 `gyeonggi_regular_alarms`를 사용한다. 기존 `RegularAlarm` Mongoose 모델을 reuse하지 않는다. 알림 문서에는 stationId, routeId, staOrder, time, day, deviceToken과 선택 표시명·중복 등록 방지 clientAlarmId를 저장한다. arsId를 만들지 않는다. 서버 _id와 clientAlarmId는 신규 경기 collection 안에서만 관리한다.

후속 API 계약 방향:

| 신규 기능 | 경로 후보 | 내용 |
|---|---|---|
| 등록 | `POST /gyeonggi/regular` | stationId/routeId/staOrder/time/day/clientAlarmId, 성공 id |
| 목록 | `GET /gyeonggi/regular` | 해당 소유자의 경기 알림만 반환 |
| 삭제 | `DELETE /gyeonggi/regular/:id` | 소유권을 확인하고 경기 collection에서만 삭제 |
| 사용 가능 여부 | `GET /gyeonggi/regular/capabilities` | 경기 등록 활성화 상태 |

위 계약의 인증/소유권 방식은 후속 구현 설계에서 확정한다. 기존 deviceToken 기반 소유권을 자동으로 새 API의 충분한 인증으로 간주하지 않는다. API 키나 토큰이 query URL/로그로 노출되지 않는 전송 방식도 신규 API 안에서 정한다. 기존 API의 인증 정책을 이번 범위에서 바꾸지는 않는다.

### 독립 조회·발송

- `GyeonggiArrivalAdapter`: GBIS 목록 조회, stationId 기준 회차 내 재사용, routeId+staOrder 매칭.
- `GyeonggiAlarmScheduler`: 새 collection만 읽고 Asia/Seoul 일정으로 실행.
- `GyeonggiNotificationSender`: Firebase Promise를 await하고 실패를 호출자가 관찰. 기존 FcmService를 변경하거나 오류를 숨기는 기존 wrapper에 의존하지 않는다.
- 새 모듈 등록을 위한 composition 변경은 기존 endpoint 동작을 바꾸지 않는 범위에서만 허용한다. 더 강한 운영 분리가 필요하면 별도 프로세스로 배포한다.
- PM2 cluster 설정상 여러 worker가 실행될 수 있으므로 경기 전용 Mongo 실행권 collection으로 동일 분의 중복 실행을 막는다. 기존 서울 cron은 수정하지 않는다.
- 공급자 오류·빈 결과·노선 불일치로 경기 알림을 자동 삭제하지 않는다. 기존 서울 삭제 정책까지 같이 고치지는 않는다.
- 경기 전용 키·호출 예산·등록/발송 플래그를 사용한다. 공유 키를 쓴다면 앱 직접조회까지 포함한 승인량 예산을 확인한다.

정규화 규칙은 실제 응답 근거를 유지한다: routeName 숫자/문자열 혼재, ETA 빈 문자열/누락, RUN/PASS와 정보없음, XML 인증 실패를 구분한다. 빈 ETA를 0초로 해석하지 않는다. stationNm1/2는 차량 위치 이름이므로 승차 정류소 이름으로 쓰지 않는다.

### 후속 구현 작업 묶음

1. **신규 계약·격리 테스트:** 인증/소유권 및 DTO 확정, 별도 collection CRUD, 재전송 중복 방지. v1 계약 snapshot과 기존 문서 hash가 변하지 않는지 검증.
2. **경기 adapter·sender:** 실제 발췌 fixture로 가변 타입/업무 오류 테스트, mock Firebase의 Promise rejection 검증. 기존 Seoul/FCM service diff는 0이어야 한다.
3. **독립 scheduler·예산:** 두 worker 경쟁, 동일 stationId의 호출 묶음, 반복 방문 순번, quota·timeout·unknown 상태 테스트. 실패 시 경기 문서 보존.
4. **앱 연동·제한 배포:** 신형 앱의 서울/경기 개별 sync, 구버전 앱이 경기 문서를 관찰·삭제하지 못함을 검증. 테스트 디바이스 실발송 후 경기 기능만 활성화.

신규 구현의 파일 배치는 `server/src/gyeonggi-alarm/`, `server/src/gyeonggi-arrival/` 같은 독립 영역을 기본으로 하고 기존 regular-alarm/bus-info/fcm 경로의 행위 변경을 피한다. 기존 코드 수정이 불가피하다고 판단되면 우회 구현 또는 별도 서비스 분리를 먼저 검토한다.

## 4. 검증과 배포 기준

현재 문서/형식 검증에서 확인할 항목:

- 기존 서버 소스, 기존 서울 데이터 파일 변경 없음.
- 서울 형식 변환 후 필드 집합·문자열 좌표·표시번호 앞자리 0 보존.
- REGION enum 확장만으로 레코드 전체 디코딩 가능; 앱 도메인/API 연동은 별도 작업임을 명시.
- node_id의 유일성 유지, stop_no 중복/누락 수 기록, nxtStn 임의 생성 없음.

향후 신규 경기 알림 구현 시 추가 검증:

- 신규 endpoint 호출 전후 기존 `/regular` 요청·응답 snapshot 동일.
- 구버전 앱 동기화를 수행해도 신규 경기 collection 문서 수와 _id가 유지됨.
- 서울 데이터 backfill/이전/삭제 없음. 신규 scheduler가 기존 collection에 접근하지 않음.
- 기존 서울 발송과 신규 경기 발송이 별도 설정·실행권으로 동작.
- 경기 등록 off → 발송 off로 중단 가능. 경기 GET/DELETE와 기존 서울 API는 유지.
- 신규 모듈 제거/이전 버전 롤백 시에도 기존 서울 collection 안에 경기 데이터가 없으므로 서울 API가 경기 데이터를 오처리하지 않음. 신규 데이터는 별도 보존.

**결론:** 이번 요청에서는 기존 백엔드 API와 구현 코드를 그대로 둔다. 정적 JSON 형식 통일과 앱의 경기 기능을 먼저 진행할 수 있고, 경기 정기알림은 독립 신규 기능으로만 검토한다.
