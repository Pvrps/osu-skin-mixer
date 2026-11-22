# osu! skin mixer

Build a skin for [osu!lazer](https://github.com/ppy/osu) out of parts of the skins you already have, and see it in
play before it goes anywhere near the game.

- Start from one of your skins, then swap in any single element (an image, a sound, a font glyph) from any other.
- Hide or silence an element, fall back to the game's own, or recolour an image.
- Watch the result on a beatmap from your own library, with its song and hit sounds.
- Set any `skin.ini` value yourself.
- Press **Apply** and the mix appears in osu! as a skin of its own. The skins it draws on are never changed.

Only osu! standard is previewed, and only legacy-style skins (the kind made of image and sound files) can be
mixed.

## Using it

Download the build for your platform from the releases page and run it. It is a single file with nothing to
install. It opens in a window of its own if you have Edge, Chrome, Chromium or Brave, and otherwise in a tab of
your default browser. Closing that window quits the mixer.

1. Name your mix and pick the skin it starts as a copy of.
2. Pick an element on the left. On the right are all the versions of it your skins have, with identical ones
   folded together. Hover one to try it in the preview, click to take it.
3. Click a group's name (Cursor, Hit sounds, ...) to take all of it from one skin, or to change its settings.
   **Jump to** under the preview skips to the next slider, spinner, miss and so on in the song.
4. Press **Create skin**, then choose the new skin in osu!. After later changes press **Apply**, and in osu!
   switch to another skin and back: the game doesn't reload a skin while it is selected.

Before the first change of each session the mixer saves a copy of osu!'s database, keeping the newest three.

### Where things are

| | Linux | Windows |
| --- | --- | --- |
| osu! data it looks for | `~/.local/share/osu` | `%APPDATA%\osu` |
| The mixer's own data | `~/.local/share/osu-skin-mixer` | `%LOCALAPPDATA%\osu-skin-mixer` |

A data folder moved from within osu! is followed automatically. The mixer's own data holds your current mix,
recoloured images, a cache of the game's built-in skin (downloaded the first time it is needed), and the
database backups.

### Options

| | |
| --- | --- |
| `--no-open` | Don't open a window, and keep running until stopped. |
| `--browser` | Open in a tab of the default browser instead of a window of its own. |
| `OSU_DIR` | Where osu!'s data is, if not in the usual place. |
| `MIXER_STATE_DIR` | Where the mixer keeps its own data. |
| `PORT` | The port to serve on. Defaults to 5727, or any free one if that is taken. |

## How it works

osu!lazer keeps every file of every skin once, named by its hash, and a database saying which skin uses which
file under which name. A mix is therefore mostly bookkeeping: the mixer writes a skin entry which points at
files the game already has. The only new files are the generated `skin.ini`, recoloured images, and the blank
image and silent sample which stand in for hidden elements.

- `server/` is a small local web server (ASP.NET, .NET 10) which reads and writes osu!'s Realm database. It opens
  the database only for the length of each request, in a mode which can never change its schema.
- `web/` is the interface (React, TypeScript, PixiJS). All of the skin logic lives here, in `web/src/lib`, so
  that what the preview shows and what gets written are computed by the same code. `web/src/preview` is a
  reimplementation of how lazer draws a legacy skin, and reads `.osu` files to play them.

The Realm package must be the version osu!lazer itself ships with, or the database can't be opened.

## Development

Needs the .NET 10 SDK and Node 22. With Nix, `nix develop` provides both, and the scripts enter it by themselves.

```sh
./run        # build the UI if it is stale, and serve on http://127.0.0.1:5727 without opening a window
./publish    # build the standalone app for Linux and Windows into dist/
```

For work on the interface, run `npm run dev` in `web/` alongside `./run` for hot reloading on port 5728.
`npm test` runs the tests of the mixing logic and the beatmap reader.

Pushing a tag like `v0.2.0` builds both platforms and attaches them to a GitHub release.

## Known limits

- The preview is an approximation of the game. Slider bodies appear whole rather than snaking in, and beatmap
  skins, storyboards and custom beatmap samples are not shown or played.
- Applying has only been tried with osu! closed. With the game running it may hold its database in a way that
  gets in the mixer's way, so close the game first if Apply fails.
- The Windows build has not been run on Windows yet.
