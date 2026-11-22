import { useState } from "react";
import { setLocation } from "../lib/api";

interface Props {
  /** Where the mixer expected to find osu!'s data. */
  lookedIn: string;
  onFound: () => void;
}

/** Asks where osu! keeps its data, when it isn't in any of the usual places. */
export function Locate({ lookedIn, onFound }: Props) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    setChecking(true);
    setError(null);

    try {
      await setLocation(path);
      onFound();
    } catch (e) {
      setError((e as Error).message);
      setChecking(false);
    }
  };

  return (
    <div className="onboarding">
      <form
        className="onboarding-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (path.trim() !== "" && !checking) void submit();
        }}
      >
        <div className="brand">osu! skin mixer</div>
        <h1>Where is osu! installed?</h1>
        <p className="muted">
          The mixer looked for osu!'s data in <code>{lookedIn}</code> and didn't find it. This is the folder holding your skins and beatmaps, not
          the one the game itself is in.
        </p>
        <p className="muted">
          To find it, open osu! and go to Settings, General, then "Open osu! folder". Copy the address of the folder that opens and paste it here.
        </p>

        <label className="field">
          <span>osu! data folder</span>
          <input type="text" autoFocus spellCheck={false} placeholder="Paste the folder's address" value={path} onChange={(e) => setPath(e.target.value)} />
          {error && <small className="error">{error}</small>}
        </label>

        <div className="onboarding-actions">
          <span className="muted">It only needs telling once.</span>
          <button type="submit" className="primary" disabled={path.trim() === "" || checking}>
            {checking ? "Checking…" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
