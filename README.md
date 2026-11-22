# osu! skin mixer

Make a new osu!lazer skin by picking parts from skins you already have.

Take the cursor from one skin, the hit circles from another and the hit sounds from a third, and watch the
result play on one of your own beatmaps before you save it. Your existing skins are never changed.

It works with osu!lazer, the osu! (standard) game mode, and skins made of image and sound files.

## How to use it

1. Download the file for your system from the Releases page and run it. There is nothing to install.
   - It opens in its own window if you have Edge, Chrome, Chromium or Brave. Otherwise it opens in your
     browser.
   - Closing the window quits it.
2. Type a name for your skin and choose a skin to start from.
3. Change what you like:
   - **One element:** click it in the list on the left, then click the version you want on the right.
     Hovering over a version shows it in the preview first.
   - **A whole group** (Cursor, Hit sounds, ...): click the group's name, then click a skin.
   - **Hide or silence** an element: choose "Hidden" or "Silent".
   - **Recolour** an image: click "Recolour this image" and pick a colour.
   - **skin.ini:** the `skin.ini` button at the top lets you set any value yourself.
4. Click **Create skin**. Your skin now shows up in osu!'s skin list.
5. After more changes, click **Apply**. In osu!, switch to another skin and back to see them.

### The preview

- Click the song name under the preview to choose a beatmap from your library.
- **Jump to** skips to the next slider, spinner, miss and so on.
- A few 100s, 50s and misses are added on purpose so you can see every hit burst.

### If it can't find osu!

It asks you for the folder. In osu!, open Settings and click "Open osu! folder", then paste that folder's
address. On Linux you can also just start osu! and click "Look again".

### Backups

Before the first change each time you run it, the mixer saves a copy of osu!'s database. It keeps the last
three in its own folder (see below).

## Options

You don't need any of these for normal use.

| Option | What it does |
| --- | --- |
| `--no-open` | Doesn't open a window. Keeps running until you stop it. |
| `--browser` | Opens in your browser instead of its own window. |
| `OSU_DIR` | Environment variable. The folder osu! keeps its data in. |
| `MIXER_STATE_DIR` | Environment variable. The folder the mixer keeps its own data in. |
| `PORT` | Environment variable. The port to use. The default is 5727. |

Where things are kept:

| | Linux | Windows |
| --- | --- | --- |
| osu!'s data | `~/.local/share/osu` | `%APPDATA%\osu` |
| The mixer's data | `~/.local/share/osu-skin-mixer` | `%LOCALAPPDATA%\osu-skin-mixer` |

## Development

You need the .NET 10 SDK and Node 22. With Nix, `nix develop` gives you both, and the scripts below use it
by themselves.

```sh
./run        # start it at http://127.0.0.1:5727 without opening a window
./publish    # build the Linux and Windows files into dist/
```

- `server/` reads and writes osu!'s database (C#).
- `web/` is the interface and the preview (TypeScript, React, PixiJS).
- In `web/`, `npm run dev` gives live reloading on port 5728 while `./run` is running, and `npm test` runs
  the tests.
- Pushing a tag like `v0.2.0` builds both files and adds them to a GitHub release.
- The Realm package in `server/server.csproj` has to be the same version osu!lazer uses, or the database
  won't open.

## Limits

- The preview is close to the game but not identical. Sliders appear all at once instead of snaking in, and
  beatmap skins, storyboards and a beatmap's own hit sounds are not used.
- Applying has only been tested with osu! closed. If Apply fails, close osu! and try again.
- The Windows version has not been tested on Windows yet.
- The first time you run it, it downloads osu!'s built-in skin so it can show default elements. That needs
  an internet connection once.
- Only osu! (standard) is previewed. Elements for other modes can be mixed but not seen.
