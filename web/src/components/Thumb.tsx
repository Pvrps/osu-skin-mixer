import type { ElementKind } from "../lib/elements";

let playing: HTMLAudioElement | null = null;

export function playSample(url: string) {
  playing?.pause();
  playing = new Audio(url);
  playing.volume = 0.5;
  void playing.play().catch(() => {});
}

interface Props {
  kind: ElementKind;
  /** Where the file can be fetched from, or null when there is nothing to show. */
  url: string | null;
  /** What to say in place of a picture when there is none. */
  empty?: string;
  size?: "small" | "medium" | "large";
}

/** A small look at (or listen to) one file of a skin. */
export function Thumb({ kind, url, empty = "", size = "medium" }: Props) {
  let content: React.ReactNode;

  if (!url) content = <span className="thumb-empty">{empty}</span>;
  else if (kind === "image") content = <img src={url} loading="lazy" alt="" draggable={false} />;
  else if (kind === "audio") {
    content = (
      <span
        className="thumb-play"
        role="button"
        tabIndex={-1}
        title="Play"
        onClick={(e) => {
          e.stopPropagation();
          playSample(url);
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
        </svg>
      </span>
    );
  } else content = <span className="thumb-empty">file</span>;

  return <span className={`thumb ${size} ${kind}`}>{content}</span>;
}
