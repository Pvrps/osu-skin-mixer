import { useEffect, useRef, useState } from "react";

interface Props {
  title: React.ReactNode;
  /** Shown at the right of the title bar, before the close button. */
  actions?: React.ReactNode;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  onClose: () => void;
  children: React.ReactNode;
}

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Keeps a window on screen: no larger than the page, and with its title bar always within reach. */
function contain(frame: Frame, minWidth: number, minHeight: number): Frame {
  const width = Math.max(Math.min(minWidth, window.innerWidth), Math.min(frame.width, window.innerWidth));
  const height = Math.max(Math.min(minHeight, window.innerHeight), Math.min(frame.height, window.innerHeight));

  return {
    width,
    height,
    x: Math.max(0, Math.min(window.innerWidth - width, frame.x)),
    y: Math.max(0, Math.min(window.innerHeight - height, frame.y)),
  };
}

/** A window which floats over the rest of the app, and can be dragged by its title bar and resized by its corner. */
export function FloatingWindow({ title, actions, width, height, minWidth = 480, minHeight = 360, onClose, children }: Props) {
  const [frame, setFrame] = useState<Frame>(() =>
    contain({ width, height, x: (window.innerWidth - width) / 2, y: (window.innerHeight - height) / 2 }, minWidth, minHeight),
  );

  // What a drag started from, so each movement is measured from there rather than piling up rounding.
  const drag = useRef<{ kind: "move" | "resize"; pointerX: number; pointerY: number; frame: Frame } | null>(null);

  useEffect(() => {
    const keepOnScreen = () => setFrame((current) => contain(current, minWidth, minHeight));

    window.addEventListener("resize", keepOnScreen);
    return () => window.removeEventListener("resize", keepOnScreen);
  }, [minWidth, minHeight]);

  const begin = (kind: "move" | "resize") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, pointerX: e.clientX, pointerY: e.clientY, frame };
  };

  const move = (e: React.PointerEvent) => {
    const start = drag.current;
    if (!start) return;

    const dx = e.clientX - start.pointerX;
    const dy = e.clientY - start.pointerY;

    setFrame(
      contain(
        start.kind === "move"
          ? { ...start.frame, x: start.frame.x + dx, y: start.frame.y + dy }
          : { ...start.frame, width: Math.max(minWidth, start.frame.width + dx), height: Math.max(minHeight, start.frame.height + dy) },
        minWidth,
        minHeight,
      ),
    );
  };

  const end = () => {
    drag.current = null;
  };

  return (
    <div className="floating" role="dialog" aria-label={typeof title === "string" ? title : undefined} style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}>
      <div className="floating-bar" onPointerDown={begin("move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <div className="floating-title">{title}</div>
        {/* Presses on the controls are theirs, and must not start dragging the window. */}
        <div className="floating-actions" onPointerDown={(e) => e.stopPropagation()}>
          {actions}
          <button className="floating-close" aria-label="Close" title="Close" onClick={onClose}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="floating-body">{children}</div>

      <div className="floating-resize" title="Resize" onPointerDown={begin("resize")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
    </div>
  );
}
