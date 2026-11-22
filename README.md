# osu-skin-mixer

Mix and match parts of your osu!lazer skins (cursor from one, hit circles from another, hitsounds from a third)
with a live gameplay preview, and write the result straight into a skin in the game.

osu! standard and legacy-format skins only.

## Running

```sh
./run
```

Then open <http://127.0.0.1:5727>. On NixOS the script enters the flake's dev shell by itself; elsewhere you need
the .NET 10 SDK and Node 22.

1. Pick a base skin. The mix starts out as a copy of it.
2. Pick a category on the left, hover a skin's card to try its version in the preview, click to use it.
3. Press **Apply to skin**. The mix skin is created if it does not exist yet.
4. In osu!, select the mix skin. After later changes, switch to another skin and back: lazer does not reload a
   skin's files while it is selected.

## How it works

lazer keeps skins in its Realm database (`client.realm`) as lists of filename → content hash, with the content in
`files/`. Applying rewrites the mix skin's file list to point at the chosen skins' existing files, plus a generated
`skin.ini`, so nothing is copied and nothing in the source skins is touched.

- A copy of `client.realm` is saved to the state directory before every apply (newest three are kept).
- Font glyphs are stored under `mixfonts/` in the mix so number fonts from different skins cannot clash.
- HUD layouts you edit in lazer's own skin editor while on the mix skin are kept across applies.
- Elements a skin leaves out fall back to lazer's classic skin, in the preview as in the game. Those images are
  downloaded from [ppy/osu-resources](https://github.com/ppy/osu-resources) the first time they are needed.

The preview follows lazer's legacy skin rules but is a reimplementation, not the game: expect small differences.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `OSU_DIR` | `~/.local/share/osu` | lazer's data directory |
| `MIX_SKIN_NAME` | `purps - mix` | name of the skin to write |
| `MIXER_STATE_DIR` | `~/.local/share/osu-skin-mixer` | saved selection, database backups, classic skin cache |
| `PORT` | `5727` | |

## Development

```sh
nix develop
(cd server && dotnet run)     # API on :5727
(cd web && npm run dev)       # UI on :5728, proxying /api
```

`server/` is a thin ASP.NET API over the Realm database. All mixing logic lives in `web/src/lib`, and the preview
in `web/src/preview`.
