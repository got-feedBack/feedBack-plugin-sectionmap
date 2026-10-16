# feedBack Plugin: Section Map

A plugin for [feedBack](https://github.com/got-feedBack/feedBack) that shows a minimap bar of the full song structure at the top of the player. Click any section to jump to it.

## Features

- **Color-coded sections** — intro (blue), verse (green), chorus (yellow), bridge (purple), solo (red), breakdown (orange), outro (gray)
- **Clickable navigation** — click anywhere on the bar to jump to that point in the song
- **Playback position** — white marker shows current position, active section highlighted
- **Always visible** — sits between the HUD and the highway, doesn't obstruct notes
- **Automatic** — appears when you play a song, disappears when you leave the player

## Installation

```bash
cd /path/to/feedBack/plugins
git clone https://github.com/got-feedBack/feedBack-plugin-sectionmap.git section_map
docker compose restart
```

The section map automatically appears at the top of the player when you play a song.

## License

MIT
