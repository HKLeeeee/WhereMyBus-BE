# 경기 데이터를 서울 형식으로 저장할 수 있는지 검증

검증일: 2026-10-27. 입력 데이터는 기존 2026-10-11 스냅샷이다. 새로 수집한 최신 데이터라는 뜻은 아니다.

**가능하다.** 기존 서울의 `DESCRIPTION`/`DATA`, 정류소 필드명, 문자열 좌표 타입으로 경기 데이터를 변환할 수 있다. 단, 파일 형식 호환과 앱 동작 호환은 다르다. 앱 지역 enum·조회 ID·외부 도착 endpoint 분기는 필요하다. 기존 백엔드 API 변경은 필요하지 않다.

## 필드 변환

| 경기 입력 | 서울 형식 출력 | 규칙 |
|---|---|---|
| stationName | stop_nm | 문자열 그대로 |
| mobileNo | stop_no | 앞자리 0 보존. null/00000은 빈 문자열 |
| stationId | node_id | API ID 문자열 그대로 |
| longitude | xcode | 숫자 → 문자열. null은 빈 문자열 |
| latitude | ycode | 숫자 → 문자열. null은 빈 문자열 |
| isCentralLane | stop_type | true → 중앙차로, false → 일반차로, null → 빈 문자열 |
| 방문별 nextStationId | nxtStn | 단일 방면을 확정할 수 없어 null |

`stop_type`은 중앙차로 여부만 변환한다. 서울의 마을버스/가상정류장 등 세부 유형을 복원하는 것은 아니다. 지역은 `REGION="경기"`로 저장한다. 디코딩을 통과시키려고 `서울`로 위장하지 않는다.

실제 변환한 수일중학교 레코드:

```json
{
  "stop_nm": "수일중학교",
  "ycode": "37.3070667",
  "stop_no": "01109",
  "xcode": "126.99985",
  "stop_type": "일반차로",
  "node_id": "200000078",
  "nxtStn": null
}
```

## 검증 결과

- 노선 연결 지점 40,971개 중 이름에 `미정차`가 포함된 2,193개 제외 → 38,778건 변환.
- 서울 레코드와 필드 집합 동일. `nxtStn`을 제외한 모든 값이 문자열. node_id 중복 없음.
- stop_no가 빈 레코드 271개, 비어 있지 않은 표시번호 중 중복 값 1,697종. 따라서 stop_no를 경기 내부 식별자로 사용하면 안 된다.
- 기존 iOS `62d85b4`의 `BusStopListDTO` Codable 선언으로 실행: `REGION="경기"` enum 디코딩 실패.
- 같은 선언에서 `WMBRegion`에 `case gyeonggi = "경기"`만 추가: 38,778건 전체 Swift JSONDecoder 디코딩 성공.
- 검증 과정에서 Domain 모듈 의존 `toDomain`은 제외했다. 앱 전체 빌드나 실제 Domain 매핑까지 검증한 결과는 아니다.

변환 파일은 작업용 임시 경로에 생성했다. 기존 정식 스냅샷 3개는 변경하지 않았다. 아래 명령으로 같은 파일을 원하는 경로에 재생성할 수 있다.

```sh
python3 - <<'PY'
import json
from pathlib import Path

source = json.loads(Path('data/gyeonggi/snapshots/2026-10-11/stations.json').read_text())
seoul = json.loads(Path('data/total_stationList_final.json').read_text())
rows = []
for station in source['data']:
    if '미정차' in station['stationName']:
        continue
    rows.append({
        'stop_nm': station['stationName'],
        'stop_no': station['mobileNo'] if station['mobileNo'] not in (None, '00000') else '',
        'node_id': station['stationId'],
        'xcode': '' if station['longitude'] is None else str(station['longitude']),
        'ycode': '' if station['latitude'] is None else str(station['latitude']),
        'stop_type': {True: '중앙차로', False: '일반차로', None: ''}[station['isCentralLane']],
        'nxtStn': None,
    })
result = {'DESCRIPTION': seoul['DESCRIPTION'], 'REGION': '경기', 'DATA': rows}
output = Path('/tmp/bus_station_list_gyeonggi.json')
with output.open('x', encoding='utf-8') as stream:
    json.dump(result, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(len(rows), output)
PY
```

출력 파일이 이미 있으면 중단한다. 이 코드는 형식 검증용 예제이며 자동 수집/배포 파이프라인에 연결한 운영용 변환기는 아니다.

최종 앱 반영 방식은 [최소 변경 설계](MINIMAL_CHANGE_DESIGN.md)를 따른다. 기존 String 전달을 유지하고 새 경기 내부 키만 접두사로 구분하며, 조회 경계에서 원래 node_id를 복원한다.

## 앱에서 필요한 최소 변경

1. `REGION="경기"`를 처리할 enum/분기 추가. JSON 레코드 DTO 필드는 서울 것을 재사용할 수 있다.
2. 서울은 기존대로 `stop_no → arsId`, 경기는 `node_id → stationId`. `stop_no`는 표시/검색용으로 별도 보존한다.
3. 경기 데이터는 별도 번들 파일로 로드하고 provider를 유지한다. 표시번호로 서울 데이터와 병합하거나 중복 제거하지 않는다.
4. 실시간 조회는 경기 외부 API adapter를 앱에 추가한다. 서울 응답 DTO에 경기 응답을 강제로 끼워 넣지 않는다.
5. `nxtStn=null`은 방향 미표시로 처리한다. 노선별 순번·방향이 필요하면 기존 `routes.json`/`route_stations.json`을 보조 자료로 유지한다. 위 표시용 필터로 원본 staOrder를 재계산하지 않는다.
6. 기존 백엔드 `/regular`에는 경기 알림을 보내지 않는다. 별도 경기 알림 기능이 없으면 경기 정기알림 등록은 비활성화한다.

**결론:** 필드명·정적 JSON 타입은 서울 형식으로 통일 가능하다. ID의 의미, 지역 분기, 실시간 API 계약까지 동일해지는 것은 아니다. `stop_no`에 stationId를 넣으면 기존 표시번호 의미를 깨므로 권장하지 않는다.
