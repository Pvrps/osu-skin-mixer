import { useEffect, useMemo, useRef, useState } from "react";
import type { Beatmap } from "../lib/api";

/** Stands for the built-in pattern, which is always available. */
export const DEMO_ID = "demo";

interface Props {
  beatmaps: Beatmap[];
  chosen: string;
  onChoose: (id: string) => void;
  onClose: () => void;
}

/** However large the library, only this many matches are listed. Typing narrows it down. */
const LIMIT = 60;

export const formatTime = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function BeatmapPicker({ beatmaps, chosen, onChoose, onClose }: Props) {
  const [filter, setFilter] = useState("");
  const root = useRef<HTMLDivElement>(null);

  const searchable = useMemo(() => beatmaps.map((b) => `${b.artist} ${b.title} ${b.difficulty}`.toLowerCase()), [beatmaps]);

  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const matches: Beatmap[] = [];
  let total = 0;

  for (let i = 0; i < beatmaps.length; i++) {
    if (!words.every((word) => searchable[i]!.includes(word))) continue;

    total++;
    if (matches.length < LIMIT) matches.push(beatmaps[i]!);
  }

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="picker" ref={root} role="dialog" aria-label="Choose what to preview with">
      <input type="search" autoFocus placeholder={`Search ${beatmaps.length} beatmaps`} value={filter} onChange={(e) => setFilter(e.target.value)} />

      <div className="picker-list">
        {words.length === 0 && (
          <button className={`picker-row${chosen === DEMO_ID ? " selected" : ""}`} onClick={() => onChoose(DEMO_ID)}>
            <span className="picker-title">Demo pattern</span>
            <span className="muted">A short loop with every kind of object and judgement. No music.</span>
          </button>
        )}

        {matches.map((beatmap) => (
          <button key={beatmap.id} className={`picker-row${chosen === beatmap.id ? " selected" : ""}`} onClick={() => onChoose(beatmap.id)}>
            <span className="picker-title">
              {beatmap.title}
              <span className="picker-meta">
                {beatmap.stars >= 0 ? `${beatmap.stars.toFixed(1)}★ · ` : ""}
                {formatTime(beatmap.length)}
              </span>
            </span>
            <span className="muted">
              {beatmap.artist ? `${beatmap.artist} · ` : ""}
              {beatmap.difficulty}
            </span>
          </button>
        ))}

        {total > matches.length && <p className="muted picker-more">{total - matches.length} more. Keep typing to narrow it down.</p>}
        {total === 0 && words.length > 0 && <p className="muted picker-more">Nothing matches "{filter}".</p>}
      </div>
    </div>
  );
}
