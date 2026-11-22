import { type RefObject, useEffect } from "react";

/** Closes a popover when Escape is pressed or anything outside of it is clicked. */
export function useDismiss(root: RefObject<HTMLElement | null>, onClose: () => void) {
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
  }, [root, onClose]);
}
