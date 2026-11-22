import { useEffect, useRef, useState } from "react";

interface Question {
  title: string;
  /** What will happen, in a sentence or two. */
  detail?: string;
  /** What the button which goes ahead says. */
  confirm: string;
  /** Whether going ahead throws something away, which the button is coloured to warn of. */
  destructive?: boolean;
}

interface Asked extends Question {
  answer: (confirmed: boolean) => void;
}

let show: ((asked: Asked | null) => void) | null = null;

/**
 * Asks the user to confirm something, in a dialog of the app's own. The browser's built-in one works too, but it
 * announces itself with the page's address, which means nothing to someone using the app in its own window.
 */
export function confirm(question: Question): Promise<boolean> {
  return new Promise((resolve) => {
    // Without the dialog on the page there is nobody to ask, so nothing is gone ahead with.
    if (!show) resolve(false);
    else show({ ...question, answer: resolve });
  });
}

/** Where confirmation dialogs appear. There is one of these, at the top of the app. */
export function ConfirmHost() {
  const [asked, setAsked] = useState<Asked | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    show = setAsked;

    return () => {
      show = null;
    };
  }, []);

  // The safe answer is the one a stray Enter gives.
  useEffect(() => {
    if (asked) cancel.current?.focus();
  }, [asked]);

  if (!asked) return null;

  const answer = (confirmed: boolean) => {
    setAsked(null);
    asked.answer(confirmed);
  };

  return (
    <div
      className="confirm-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) answer(false);
      }}
      onKeyDown={(e) => {
        // Kept from reaching anything behind the dialog, which has shortcuts of its own.
        e.stopPropagation();
        if (e.key === "Escape") answer(false);
      }}
    >
      <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={asked.detail ? "confirm-detail" : undefined}>
        <h2 id="confirm-title">{asked.title}</h2>
        {asked.detail && <p id="confirm-detail">{asked.detail}</p>}

        <div className="confirm-actions">
          <button ref={cancel} onClick={() => answer(false)}>
            Cancel
          </button>
          <button className={asked.destructive ? "danger" : "primary"} onClick={() => answer(true)}>
            {asked.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
