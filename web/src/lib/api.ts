import type { Selection } from "./mix";

export interface RawSkin {
  id: string;
  name: string;
  creator: string;
  isMix: boolean;
  files: { name: string; hash: string }[];
}

export interface AppState {
  mixName: string;
  osuDir: string;
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

export const saveSelection = (selection: Selection) => request<void>("/api/selection", json("PUT", selection));

export const applyMix = (files: { name: string; hash: string }[], skinIni: string) =>
  request<ApplyResult>("/api/apply", json("POST", { files, skinIni }));

/** Names of the classic skin's files. Empty when they cannot be fetched, in which case the preview goes without. */
export const fetchDefaultIndex = () =>
  request<string[]>("/api/default/index")
    .then((names) => new Set(names))
    .catch(() => new Set<string>());
