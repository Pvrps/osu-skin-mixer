/** A minimal reader/writer for osu!'s `skin.ini`, following the same rules as lazer's decoder. */

export interface IniEntry {
  key: string;
  value: string;
}

export interface IniSection {
  name: string;
  entries: IniEntry[];
}

export function parseIni(text: string): IniSection[] {
  const sections: IniSection[] = [];
  let current: IniSection | null = null;

  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    // lazer strips everything after a comment marker, wherever it appears on the line.
    const commentAt = raw.indexOf("//");
    const line = (commentAt >= 0 ? raw.slice(0, commentAt) : raw).trim();

    if (line.length === 0) continue;

    const header = /^\[(.+)\]$/.exec(line);

    if (header) {
      current = { name: header[1]!.trim(), entries: [] };
      sections.push(current);
      continue;
    }

    const colon = line.indexOf(":");
    if (colon < 0 || !current) continue;

    current.entries.push({ key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
  }

  return sections;
}

export function serializeIni(sections: IniSection[]): string {
  return (
    sections
      .filter((s) => s.entries.length > 0)
      .map((s) => `[${s.name}]\n${s.entries.map((e) => `${e.key}: ${e.value}`).join("\n")}`)
      .join("\n\n") + "\n"
  );
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The value of a key, with later definitions winning as they do in lazer. */
export function iniValue(sections: IniSection[], section: string, key: string): string | undefined {
  let found: string | undefined;

  for (const s of sections) {
    if (!sameName(s.name, section)) continue;

    for (const e of s.entries) {
      if (sameName(e.key, key)) found = e.value;
    }
  }

  return found;
}

/** Parses an `r,g,b[,a]` colour. Returns null when the value is not a usable colour. */
export function parseColour(value: string | undefined): [number, number, number] | null {
  if (value === undefined) return null;

  const parts = value.split(",").map((p) => Number.parseInt(p.trim(), 10));

  if (parts.length < 3 || parts.slice(0, 3).some((p) => !Number.isFinite(p))) return null;

  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  return [clamp(parts[0]!), clamp(parts[1]!), clamp(parts[2]!)];
}

/** lazer treats a missing version as 1.0 when a skin.ini exists, and `latest` as the newest known version. */
export const LATEST_VERSION = 2.7;

export function parseVersion(value: string | undefined): number {
  if (value === undefined) return 1.0;
  if (value.trim().toLowerCase() === "latest") return LATEST_VERSION;

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 1.0;
}

export function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value.trim() === "1";
}
