# Room music files

These four room soundtracks were selected from Mixkit and downloaded on
2026-07-27:

| App file | Mixkit title | Source |
| --- | --- | --- |
| `ambient-focus.mp3` | Smooth Meditation | https://assets.mixkit.co/music/324/324.mp3 |
| `flow-relax.mp3` | Serene View | https://assets.mixkit.co/music/443/443.mp3 |
| `gentle-rain.mp3` | Light Rain Loop | https://assets.mixkit.co/active_storage/sfx/2393/2393-preview.mp3 |
| `quiet-forest.mp3` | European Forest Ambience | https://assets.mixkit.co/active_storage/sfx/1213/1213-preview.mp3 |
| `fireplace.mp3` | Campfire Night Wind | https://assets.mixkit.co/active_storage/sfx/1736/1736-preview.mp3 |

License record: https://mixkit.co/license/

Mixkit lists stock music and sound effects under its Free License for use in
commercial and non-commercial projects. Attribution is not required, but this
file is intentionally retained as an asset provenance record. Re-check the
license before redistributing the raw audio outside MySession.

Recommended export settings:

- MP3, 44.1 kHz or 48 kHz, stereo
- 128–192 kbps constant bitrate
- 5–20 minutes long
- seamless start/end loop with no spoken watermark
- integrated loudness around -20 to -16 LUFS and peaks below -1 dBFS
- keep each file below roughly 20 MB for fast room loading

If a soundtrack is replaced later, preserve its title, direct source URL,
license URL, and download date in this table.

## Custom room tracks

Hosts and room moderators can upload MP3, M4A, OGG, or WebM audio from the
room music panel. Files are limited to 3 MB so uploads remain below the
serverless request limit and do not put avoidable pressure on room bandwidth.
The API creates the public `room-soundtracks` Supabase Storage bucket on first
use and keeps only the five newest custom uploads for each room.

## Playlist icons

The playlist looks for these replaceable SVG assets in `public/icons/`:

- `music-ambient-focus.svg`
- `music-flow-relax.svg`
- `music-gentle-rain.svg`
- `music-quiet-forest.svg`
- `music-fireplace.svg`
- `music-custom.svg`

Until a dedicated icon is added, the UI automatically falls back to
`soundscape-light.svg`.
