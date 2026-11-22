import type { Selection } from "./mix";

export interface RawSkin {
  id: string;
  name: string;
  creator: string;
  files: { name: string; hash: string }[];
  ini: string | null;
}

export interface AppState {
  osuDir: string;
  /** Set when there is no osu! database where the mixer looked. */
  missing: boolean;
  /** Whether the mixer can find osu! by itself while the game is running. */
  findsRunningGame: boolean;
  blank: { png: string; wav: string };
  skins: RawSkin[];
  selection: Partial<Selection> | null;
}

export interface ApplyResult {
  id: string;
  created: boolean;
  fileCount: number;
  backup: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;

    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Not a JSON error body; the status line will do.
    }

    throw new Error(message);
  }

  return (response.status === 204 ? undefined : await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchState = () => request<AppState>("/api/state");

/** Hands the mixer an image changed in the editor, returning the hash it can be used under. */
export async function saveEdited(image: Blob): Promise<string> {
  const response = await fetch("/api/edited", { method: "POST", headers: { "Content-Type": "image/png" }, body: image });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "The edited image couldn't be saved.");
  }

  return ((await response.json()) as { hash: string }).hash;
}

/** Tells the mixer where osu! keeps its data, for installs which aren't in the usual place. */
export const setLocation = (path: string) => request<{ osuDir: string }>("/api/location", json("POST", { path }));

export const saveSelection = (selection: Selection) => request<void>("/api/selection", json("PUT", selection));

export const applyMix = (name: string, skinId: string | null, files: { name: string; hash: string }[], skinIni: string) =>
  request<ApplyResult>("/api/apply", json("POST", { name, skinId, files, skinIni }));

/** A release of the mixer newer than the one running, and where to get it. */
export interface Update {
  version: string;
  url: string;
}

/** Null when this is the latest release, and when that can't be told. */
export const fetchUpdate = () =>
  request<{ version: string | null; url: string }>("/api/update")
    .then((update) => (update.version ? ({ version: update.version, url: update.url } satisfies Update) : null))
    .catch(() => null);

/** Names of the classic skin's files. Empty when they cannot be fetched, in which case the preview goes without. */
export const fetchDefaultIndex = () =>
  request<string[]>("/api/default/index")
    .then((names) => new Set(names))
    .catch(() => new Set<string>());

/** An osu! standard difficulty from the game's library, which the preview can play. */
export interface Beatmap {
  id: string;
  title: string;
  artist: string;
  difficulty: string;
  stars: number;
  /** In milliseconds. */
  length: number;
  /** Where the song's preview starts, in milliseconds, or -1 when the map doesn't say. */
  previewTime: number;
  file: string;
  audio: string | null;
  audioName: string | null;
  background: string | null;
  backgroundName: string | null;
}

/** Empty when the game has no beatmaps, or they can't be read. The preview has a pattern of its own for that. */
export const fetchBeatmaps = () => request<Beatmap[]>("/api/beatmaps").catch(() => [] as Beatmap[]);
