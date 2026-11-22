import { useCallback, useEffect, useRef, useState } from "react";
import { type Beatmap, fetchBeatmaps } from "../lib/api";
import { type Skin, fileUrl } from "../lib/skins";
import { parseBeatmap } from "../preview/beatmap";
import { PreviewRenderer, type PreviewSettings } from "../preview/renderer";
import { DEMO_SCENE, type Scene } from "../preview/scene";
import { BeatmapPicker, DEMO_ID, formatTime } from "./BeatmapPicker";
import { JumpMenu } from "./JumpMenu";

interface Props {
  skin: Skin | null;
  defaults: Set<string> | null;
  /** Shown over the preview while something other than the saved mix is being displayed. */
  note: string | null;
}

const STORAGE_KEY = "osu-skin-mixer.preview";

interface Remembered {
  beatmap?: string;
  sound?: boolean;
  volume?: number;
  backdrop?: number;
  hud?: boolean;
}

function remembered(): Remembered {
  try {
    return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Remembered) ?? {};
  } catch {
    return {};
  }
}

const icon = (path: React.ReactNode) => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    {path}
  </svg>
);

/** Tells a slider how much of its track to colour in. */
const filled = (fraction: number) => ({ "--filled": `${Math.max(0, Math.min(1, fraction)) * 100}%` }) as React.CSSProperties;

const ICONS = {
  play: icon(<path d="M4.5 2.5v11l9-5.5z" fill="currentColor" />),
  pause: icon(<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" />),
  sound: icon(
    <>
      <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" />
      <path d="M10.5 5.5a3.5 3.5 0 010 5M12.3 3.6a6 6 0 010 8.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </>,
  ),
  muted: icon(
    <>
      <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" />
      <path d="M10.5 6l4 4M14.5 6l-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </>,
  ),
  music: icon(<path d="M6 12.5a2 2 0 11-1-1.7V3l8-1.5v9a2 2 0 11-1-1.7V4.2L6 5.3z" fill="currentColor" />),
};

export function Preview({ skin, defaults, note }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<PreviewRenderer | null>(null);

  // `?t=<ms>` opens the preview frozen at a point in time, and `?map=<id>` on a particular beatmap, which is handy
  // for comparing skins frame for frame.
  const params = useRef(new URLSearchParams(location.search));
  const frozenAt = useRef(params.current.get("t"));
  const saved = useRef(remembered());

  const [settings, setSettings] = useState<PreviewSettings>({
    backdrop: saved.current.backdrop ?? 0.2,
    playing: frozenAt.current === null,
    // Sound is on unless it was turned off. The browser holds it back until the first click on the page.
    sound: saved.current.sound ?? true,
    volume: saved.current.volume ?? 0.6,
    hud: saved.current.hud ?? true,
  });
  const [loading, setLoading] = useState(true);
  const [beatmaps, setBeatmaps] = useState<Beatmap[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [scene, setScene] = useState<Scene>(DEMO_SCENE);
  const [time, setTime] = useState(0);
  const [picking, setPicking] = useState(false);
  const [jumping, setJumping] = useState(false);
  const [waitingForClick, setWaitingForClick] = useState(false);

  const range = scene;

  useEffect(() => {
    const instance = new PreviewRenderer();
    renderer.current = instance;
    instance.onProgress = (now) => {
      setTime(now);
      setWaitingForClick(instance.soundWaitingForClick);
    };
    void instance.init(host.current!);

    return () => {
      renderer.current = null;
      instance.destroy();
    };
  }, []);

  useEffect(() => {
    void fetchBeatmaps().then((all) => {
      setBeatmaps(all);

      const wanted = params.current.get("map") ?? saved.current.beatmap;

      if (wanted === DEMO_ID || all.length === 0) setChosen(DEMO_ID);
      else if (wanted && all.some((b) => b.id === wanted)) setChosen(wanted);
      // Failing a choice, start with something of middling difficulty: busy enough to show a skin off, and still readable.
      else setChosen(all.reduce((best, b) => (Math.abs(b.stars - 4) < Math.abs(best.stars - 4) ? b : best)).id);
    });
  }, []);

  useEffect(() => {
    renderer.current?.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ beatmap: chosen ?? undefined, sound: settings.sound, volume: settings.volume, backdrop: settings.backdrop, hud: settings.hud } satisfies Remembered));
    } catch {
      // Without storage the choices simply aren't remembered.
    }
  }, [chosen, settings.sound, settings.volume, settings.backdrop, settings.hud]);

  const beatmap = beatmaps?.find((b) => b.id === chosen) ?? null;

  useEffect(() => {
    if (chosen === null || !renderer.current) return;

    let current = true;
    const frozen = frozenAt.current !== null ? Number(frozenAt.current) || 0 : null;

    const show = (scene: typeof DEMO_SCENE, startAt: number, audioUrl: string | null, backgroundUrl: string | null) => {
      if (!current || !renderer.current) return;

      renderer.current.setScene(scene, { audioUrl, backgroundUrl }, frozen ?? startAt);
      setScene(scene);
    };

    if (!beatmap) {
      show(DEMO_SCENE, DEMO_SCENE.start, null, null);
      return;
    }

    void fetch(fileUrl({ name: "beatmap.osu", hash: beatmap.file }))
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(response.statusText))))
      .then((text) => {
        const scene = parseBeatmap(text);

        if (!scene) {
          show(DEMO_SCENE, DEMO_SCENE.start, null, null);
          return;
        }

        // Songs mark where their best part starts, which is a better first impression than an intro.
        const startAt = beatmap.previewTime > scene.start && beatmap.previewTime < scene.end - 5000 ? beatmap.previewTime : scene.start;

        show(
          scene,
          startAt,
          beatmap.audio ? fileUrl({ name: beatmap.audioName ?? "audio.mp3", hash: beatmap.audio }) : null,
          beatmap.background ? fileUrl({ name: beatmap.backgroundName ?? "background.jpg", hash: beatmap.background }) : null,
        );
      })
      .catch(() => show(DEMO_SCENE, DEMO_SCENE.start, null, null));

    return () => {
      current = false;
    };
    // The beatmap is looked up from the choice, so the choice alone decides when to reload.
  }, [chosen, beatmap]);

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
  const closePicker = useCallback(() => setPicking(false), []);
  const closeJump = useCallback(() => setJumping(false), []);

  return (
    <div className="preview">
      <div className="preview-stage">
        <div className="preview-canvas" ref={host} />
        {note && <div className="preview-note">{note}</div>}
        {loading && <div className="preview-loading">Loading…</div>}
        {waitingForClick && settings.playing && <div className="preview-hint">Click anywhere to start the sound</div>}
      </div>

      <div className="transport">
        <div className="transport-seek">
          <span className="transport-time">{formatTime(time - range.start)}</span>
          <input
            className="seek"
            type="range"
            aria-label="Position"
            min={range.start}
            max={range.end}
            step={10}
            value={Math.min(range.end, Math.max(range.start, time))}
            style={filled((time - range.start) / Math.max(1, range.end - range.start))}
            onChange={(e) => {
              const value = Number(e.target.value);
              renderer.current?.seek(value);
              setTime(value);
            }}
          />
          <span className="transport-time">{formatTime(range.end - range.start)}</span>
        </div>

        <button className="icon primary" aria-label={settings.playing ? "Pause" : "Play"} title={settings.playing ? "Pause" : "Play"} onClick={() => toggle("playing")}>
          {settings.playing ? ICONS.pause : ICONS.play}
        </button>

        <div className="transport-song">
          <button className="song" title="Choose a beatmap to preview with" aria-haspopup="dialog" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
            {ICONS.music}
            <span className="song-name">{beatmap ? `${beatmap.title} [${beatmap.difficulty}]` : "Demo pattern"}</span>
          </button>
          {picking && beatmaps && (
            <BeatmapPicker
              beatmaps={beatmaps}
              chosen={chosen ?? DEMO_ID}
              onChoose={(id) => {
                // A fresh choice always plays from its own starting point.
                frozenAt.current = null;
                setChosen(id);
                setPicking(false);
              }}
              onClose={closePicker}
            />
          )}
        </div>

        <div className="transport-jump">
          <button title="Go to the next slider, spinner, miss and so on" aria-haspopup="menu" aria-expanded={jumping} onClick={() => setJumping((v) => !v)}>
            Jump to
          </button>
          {jumping && (
            <JumpMenu
              scene={scene}
              time={time}
              onJump={(to) => {
                renderer.current?.seek(to);
                setTime(to);
                setJumping(false);
              }}
              onClose={closeJump}
            />
          )}
        </div>

        <div className="spacer" />

        <button className={`icon${settings.sound ? " on" : ""}`} aria-pressed={settings.sound} aria-label="Sound" title={settings.sound ? "Mute" : "Unmute"} onClick={() => toggle("sound")}>
          {settings.sound ? ICONS.sound : ICONS.muted}
        </button>
        <input
          className="level"
          type="range"
          aria-label="Volume"
          title="Volume"
          min={0}
          max={1}
          step={0.02}
          disabled={!settings.sound}
          value={settings.volume}
          style={filled(settings.volume)}
          onChange={(e) => setSettings((s) => ({ ...s, volume: Number(e.target.value) }))}
        />

        <button className={settings.hud ? "on" : ""} aria-pressed={settings.hud} title="Show the score, combo and health bar" onClick={() => toggle("hud")}>
          HUD
        </button>

        <label className="transport-dim" title="How much of the background shows">
          Background
          <input className="level" type="range" min={0} max={1} step={0.02} value={settings.backdrop} style={filled(settings.backdrop)} onChange={(e) => setSettings((s) => ({ ...s, backdrop: Number(e.target.value) }))} />
        </label>
      </div>
    </div>
  );
}
