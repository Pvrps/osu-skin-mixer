import { useEffect, useState } from "react";
import { type Update, fetchUpdate } from "../lib/api";

const STORAGE_KEY = "osu-skin-mixer.update-dismissed";

/** Says when a newer release is out, with a link to it. Dismissing it holds until the release after that. */
export function UpdateNotice() {
  const [update, setUpdate] = useState<Update | null>(null);

  useEffect(() => {
    void fetchUpdate().then((found) => {
      if (found && localStorage.getItem(STORAGE_KEY) !== found.version) setUpdate(found);
    });
  }, []);

  if (!update) return null;

  return (
    <div className="update" role="status">
      {/* Opened outside the mixer's own window, in the user's browser. */}
      <a href={update.url} target="_blank" rel="noreferrer" title="Open the download page in your browser">
        Version {update.version} is available
      </a>
      <button
        className="update-dismiss"
        aria-label="Dismiss"
        title="Don't mention this version again"
        onClick={() => {
          try {
            localStorage.setItem(STORAGE_KEY, update.version);
          } catch {
            // Without storage it is simply mentioned again next time.
          }

          setUpdate(null);
        }}
      >
        ×
      </button>
    </div>
  );
}
