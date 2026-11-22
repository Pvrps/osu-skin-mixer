import { useRef } from "react";
import { type Scene, type SceneObject, judgementTime } from "../preview/scene";
import { useDismiss } from "./useDismiss";

interface Props {
  scene: Scene;
  /** The time the preview is at, to look onwards from. */
  time: number;
  onJump: (time: number) => void;
  onClose: () => void;
}

interface Destination {
  label: string;
  matches: (object: SceneObject) => boolean;
  /** The moment of interest, which the preview is taken to just ahead of. */
  at: (object: SceneObject) => number;
}

const starts = (object: SceneObject) => object.time;

const DESTINATIONS: Destination[] = [
  { label: "Slider", matches: (o) => o.kind === "slider", at: starts },
  { label: "Slider with a reverse arrow", matches: (o) => o.kind === "slider" && o.spans > 1, at: starts },
  { label: "Slider with ticks", matches: (o) => o.kind === "slider" && o.ticks.length > 0, at: starts },
  { label: "Spinner", matches: (o) => o.kind === "spinner", at: starts },
  { label: "100", matches: (o) => o.result === "ok", at: judgementTime },
  { label: "50", matches: (o) => o.result === "meh", at: judgementTime },
  { label: "Miss", matches: (o) => o.result === "miss", at: judgementTime },
];

/** Takes the preview to the next place in the map where a particular thing happens. */
export function JumpMenu({ scene, time, onJump, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, onClose);

  // Arrive early enough to watch it come in.
  const lead = Math.min(scene.preempt, 800) + 300;

  return (
    <div className="menu" ref={root} role="menu">
      {DESTINATIONS.map((destination) => {
        const found = scene.objects.filter(destination.matches);
        // The next one from here, or the first again once the last has gone by.
        const next = found.find((o) => destination.at(o) - lead > time + 50) ?? found[0];

        return (
          <button
            key={destination.label}
            role="menuitem"
            disabled={!next}
            title={next ? undefined : "This beatmap has none"}
            onClick={() => next && onJump(Math.max(scene.start, destination.at(next) - lead))}
          >
            <span>{destination.label}</span>
            <span className="muted">{found.length === 0 ? "none here" : found.length}</span>
          </button>
        );
      })}
    </div>
  );
}
