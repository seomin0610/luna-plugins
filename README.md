[English](./README.md) | [한국어](./README.ko.md)

# Luna Plugin Collection

A plugin collection for **[TidaLuna](https://github.com/Inrixia/TidaLuna)**.

## Included Plugins

### LyricsPorter
Exports lyrics from the Tidal lyrics view for overlays, tools, or external integrations.

Key features:
- Exports the current lyric line over `HTTP`, `TCP`, or `UDP`.
- Runs a separate metadata HTTP server on another port.
- Supports synced lyric parsing from common timed formats (LRC/TTML/JSON-like).

Metadata payload (`/metadata.json`):
- `title`: current track title
- `artist`: current track artist name(s)
- `maxLyricLength`: longest lyric line length in the song
- `nextLyricLength`: length of the next upcoming timed lyric line
- `ts`: server timestamp (ms)

Default ports:
- Lyric output: `1608`
- Metadata output: `1609`

Useful endpoints:
- Lyric text: `/lyrics`
- Lyric JSON: `/lyrics.json`
- Lyric SSE: `/events`
- Metadata JSON: `/metadata.json`
- Metadata SSE: `/events` (metadata server)

```
{
  "title": "...",
  "artist": "...",
  "maxLyricLength": 23,
  "nextLyricLength": 12,
  "ts": 1760000000000
}
```

#### Examples of use:

end4(quickshell) + LyricsPorter
[video
](https://cloud.waterwave.space/sharevid/2026-04-11%2021-36-09.mp4)

### Hunminjeongeum
Attempts to localize track titles to Korean when Korean metadata is available.

Key features:
- Uses cached results and misses to reduce repeated lookups.
- Supports manual title overrides.
- Includes a test mode UI for playback debug info.

## Development

Requirements:
- Node.js 18+
- `pnpm`

Setup:
```bash
pnpm install
```

Start watch + local server:
```bash
pnpm run watch
```

## Build Output

Build artifacts are generated in `dist/`, including:
- Plugin bundles (`*.mjs`)
- Plugin manifests (`*.json`)
- `store.json`

Use `dist/store.json` (or release assets) to install this plugin store in Luna.

## License

See [LICENSE](./LICENSE).
