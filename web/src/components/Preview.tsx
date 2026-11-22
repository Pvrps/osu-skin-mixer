import { useEffect, useRef, useState } from "react";
import type { Skin } from "../lib/skins";
import { PreviewRenderer, type PreviewSettings } from "../preview/renderer";

interface Props {
  skin: Skin | null;
  defaults: Set<string> | null;
  /** Shown over the preview while something other than the saved mix is being displayed. */
  note: string | null;
}

export function Preview({ skin, defaults, note }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<PreviewRenderer | null>(null);
  // `?t=<ms>` opens the preview frozen at a point in the loop, which is handy for comparing skins frame for frame.
  const startAt = useRef(new URLSearchParams(location.search).get("t"));
  const [settings, setSettings] = useState<PreviewSettings>({ backdrop: 0.1, playing: startAt.current === null, sound: false, hud: true });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const instance = new PreviewRenderer();
    renderer.current = instance;
    void instance.init(host.current!);
    if (startAt.current !== null) instance.seek(Number(startAt.current) || 0);

    return () => {
      renderer.current = null;
      instance.destroy();
    };
  }, []);

  useEffect(() => {
    renderer.current?.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!skin || !defaults || !renderer.current) return;

    let current = true;
    setLoading(true);

    void renderer.current.setSkin(skin, defaults).finally(() => {
      if (current) setLoading(false);
    });

    return () => {
      current = false;
    };
  }, [skin, defaults]);

  const toggle = (key: "playing" | "sound" | "hud") => setSettings((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div className="preview">
      <div className="preview-stage">
        <div className="preview-canvas" ref={host} />
        {note && <div className="preview-note">{note}</div>}
        {loading && <div className="preview-loading">Loading…</div>}
      </div>
      <div className="preview-controls">
        <button onClick={() => toggle("playing")}>{settings.playing ? "Pause" : "Play"}</button>
        <button className={settings.sound ? "on" : ""} onClick={() => toggle("sound")}>
          Hitsounds {settings.sound ? "on" : "off"}
        </button>
        <button className={settings.hud ? "on" : ""} onClick={() => toggle("hud")}>
          HUD {settings.hud ? "on" : "off"}
        </button>
        <label>
          Background
          <input
            type="range"
            min={0}
            max={0.6}
            step={0.02}
            value={settings.backdrop}
            onChange={(e) => setSettings((s) => ({ ...s, backdrop: Number(e.target.value) }))}
          />
        </label>
      </div>
    </div>
  );
}
