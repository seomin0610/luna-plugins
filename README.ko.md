[English](./README.md) | [한국어](./README.ko.md)

# Luna 플러그인 모음

**[TidaLuna](https://github.com/Inrixia/TidaLuna)** 용 플러그인 모음 저장소입니다.

## 포함된 플러그인

### LyricsPorter
Tidal 가사 화면의 가사를 오버레이/외부 툴에서 쓸 수 있게 내보냅니다.

주요 기능:
- 현재 가사 한 줄을 `HTTP`, `TCP`, `UDP`로 전송
- 메타데이터를 별도 HTTP 서버(별도 포트)로 전송
- LRC/TTML/JSON 계열의 싱크 가사 파싱 지원

메타데이터 payload (`/metadata.json`):
- `title`: 현재 곡 제목
- `artist`: 현재 곡 아티스트명(들)
- `maxLyricLength`: 곡 전체 가사 중 가장 긴 줄의 길이
- `nextLyricLength`: 다음으로 나올 타임드 가사 한 줄의 길이
- `ts`: 서버 타임스탬프(ms)

기본 포트:
- 가사 출력: `1608`
- 메타데이터 출력: `1609`

주요 엔드포인트:
- 가사 텍스트: `/lyrics`
- 가사 JSON: `/lyrics.json`
- 가사 SSE: `/events`
- 메타데이터 JSON: `/metadata.json`
- 메타데이터 SSE: `/events` (메타데이터 서버 기준)

```
{
  "title": "...",
  "artist": "...",
  "maxLyricLength": 23,
  "nextLyricLength": 12,
  "ts": 1760000000000
}
```

#### 어디에 써먹나요?:

end4(quickshell) + LyricsPorter
[영상
](https://cloud.waterwave.space/sharevid/2026-04-11%2021-36-09.mp4)

### Hunminjeongeum
한국어 메타데이터가 있는 경우 곡 제목을 한국어로 로컬라이징하려고 시도합니다.

주요 기능:
- 조회 결과/미스 캐시로 중복 요청 최소화
- 수동 제목 오버라이드 지원
- 재생 디버그 정보를 보여주는 테스트 모드 UI 제공

## 개발

요구 사항:
- Node.js 18+
- `pnpm`

설치:
```bash
pnpm install
```

감시 빌드 + 로컬 서버 실행:
```bash
pnpm run watch
```
## 빌드 결과물

빌드 결과는 `dist/`에 생성됩니다.

포함 항목:
- 플러그인 번들 (`*.mjs`)
- 플러그인 매니페스트 (`*.json`)
- `store.json`

Luna에는 `dist/store.json`(또는 릴리스 에셋)을 스토어 URL로 등록해서 설치하면 됩니다.

## 라이선스

[LICENSE](./LICENSE) 파일을 참고하세요.
