import { type IniSection, iniValue, parseIni } from "./ini";

export interface SkinFile {
  /** The filename exactly as stored by lazer. */
  name: string;
  hash: string;
  /** Lowercased, forward-slashed name without `@2x` or extension. This is what lazer looks elements up by. */
  stem: string;
  ext: string;
  hd: boolean;
  /** Whether the file sits at the top level of the skin. Standard elements are only ever looked up there. */
  root: boolean;
}

export interface Skin {
  id: string;
  name: string;
  creator: string;
  isMix: boolean;
  files: SkinFile[];
  ini: IniSection[];
}

export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg"]);
export const AUDIO_EXTS = new Set(["wav", "ogg", "mp3"]);

export function describeFile(name: string, hash: string): SkinFile {
  const normalised = name.replace(/\\/g, "/").toLowerCase();
  const slash = normalised.lastIndexOf("/");
  const dot = normalised.lastIndexOf(".");
  const hasExt = dot > slash;
  const ext = hasExt ? normalised.slice(dot + 1) : "";
  let stem = hasExt ? normalised.slice(0, dot) : normalised;
  const hd = stem.endsWith("@2x");
  if (hd) stem = stem.slice(0, -3);

  return { name, hash, stem, ext, hd, root: slash < 0 };
}

export const fileUrl = (file: { name: string; hash: string }) =>
  `/api/file/${file.hash}/${encodeURIComponent(file.name.replace(/\\/g, "/").split("/").pop() ?? "file")}`;

export function findIni(files: SkinFile[]): SkinFile | undefined {
  return files.find((f) => f.root && f.stem === "skin" && f.ext === "ini");
}

export async function loadSkin(raw: {
  id: string;
  name: string;
  creator: string;
  isMix: boolean;
  files: { name: string; hash: string }[];
}): Promise<Skin> {
  const files = raw.files.map((f) => describeFile(f.name, f.hash));
  const iniFile = findIni(files);
  let ini: IniSection[] = [];

  if (iniFile) {
    const response = await fetch(fileUrl(iniFile));
    if (response.ok) ini = parseIni(await response.text());
  }

  return { id: raw.id, name: raw.name, creator: raw.creator, isMix: raw.isMix, files, ini };
}

/** Normalises a font prefix from skin.ini the way lazer's lookups end up treating it. */
export function fontPrefix(ini: IniSection[], key: string, fallback: string): string {
  const value = iniValue(ini, "Fonts", key);
  return (value && value.length > 0 ? value : fallback).replace(/\\/g, "/").toLowerCase();
}
