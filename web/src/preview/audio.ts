import type { PreviewSkin } from "./assets";

// Loaded as soon as sound is on, so the first hits of a song aren't silent while their samples are fetched.
const COMMON_SAMPLES = ["normal-hitnormal", "soft-hitnormal", "drum-hitnormal", "normal-slidertick", "soft-slidertick", "combobreak", "spinnerbonus"];

/** Plays the mix's hitsounds, and the song they belong to, in time with the preview. */
export class PreviewAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private skin: PreviewSkin | null = null;
  /** Samples of the current skin by name. Null marks one the skin and the game both lack. */
  private samples = new Map<string, AudioBuffer | null | Promise<void>>();
  private readonly decoded = new Map<string, Promise<AudioBuffer | null>>();
  private music: HTMLAudioElement | null = null;
  private volume = 0.6;
  /** Set when the browser refused to start the song because nothing on the page has been clicked yet. */
  private refused = false;
  private stopListening: (() => void) | null = null;

  enabled = false;

  /**
   * Browsers only let a page make sound once it has been clicked or typed into. Sound which is on from the start
   * therefore begins with the first click anywhere, which is what the listeners here wait for.
   */
  enable() {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
    }

    if (!this.stopListening) {
      const unlock = () => {
        this.refused = false;
        void this.context?.resume();
      };

      document.addEventListener("pointerdown", unlock, true);
      document.addEventListener("keydown", unlock, true);

      this.stopListening = () => {
        document.removeEventListener("pointerdown", unlock, true);
        document.removeEventListener("keydown", unlock, true);
      };
    }

    void this.context.resume();
    this.enabled = true;
    this.setVolume(this.volume);

    for (const name of COMMON_SAMPLES) this.load(name);
  }

  disable() {
    this.enabled = false;
    this.music?.pause();
  }

  setVolume(volume: number) {
    this.volume = volume;

    // Hit sounds are mixed a little above the song, as most players have them.
    if (this.gain) this.gain.gain.value = volume * 0.7;
    if (this.music) this.music.volume = Math.min(1, volume * 0.55);
  }

  setSkin(skin: PreviewSkin) {
    this.skin = skin;
    this.samples = new Map();

    if (this.enabled) for (const name of COMMON_SAMPLES) this.load(name);
  }

  private load(name: string) {
    if (!this.skin || !this.context || this.samples.has(name)) return;

    const samples = this.samples;
    const url = this.skin.sampleUrl(name);

    if (!url) {
      samples.set(name, null);
      return;
    }

    samples.set(
      name,
      this.decode(url).then((buffer) => {
        samples.set(name, buffer);
      }),
    );
  }

  private decode(url: string): Promise<AudioBuffer | null> {
    let pending = this.decoded.get(url);

    if (!pending) {
      pending = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then((data) => this.context!.decodeAudioData(data))
        .catch(() => null);
      this.decoded.set(url, pending);
    }

    return pending;
  }

  play(names: string[]) {
    if (!this.enabled || !this.context || !this.gain) return;

    // While the browser is holding sound back, anything started is not dropped but kept waiting, and would all
    // go off at once on the click which lets sound through. So until then, nothing is started at all.
    if (this.context.state !== "running") return;

    for (const name of names) {
      const buffer = this.samples.get(name);

      // A sample heard for the first time is fetched now and played from the next time on.
      if (buffer === undefined) this.load(name);
      if (!(buffer instanceof AudioBuffer)) continue;

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain);
      source.start();
    }
  }

  // ---- the song -----------------------------------------------------------------------------------------------

  setMusic(url: string | null) {
    this.music?.pause();
    this.music = null;

    if (url) {
      this.music = new Audio(url);
      this.music.preload = "auto";
      this.setVolume(this.volume);
    }
  }

  /** Starts or stops the song so that it matches what the preview is doing. */
  syncMusic(playing: boolean, time: number) {
    const music = this.music;
    if (!music) return;

    if (!this.enabled || !playing) {
      music.pause();
      return;
    }

    if (music.paused && !this.refused) {
      music.currentTime = Math.max(0, time / 1000);
      void music.play().catch((e: Error) => {
        if (e.name === "NotAllowedError") this.refused = true;
      });
    }
  }

  /** Whether sound is on but the browser is holding it back until the page is clicked. */
  get waitingForClick(): boolean {
    return this.enabled && (this.refused || this.context?.state === "suspended");
  }

  seekMusic(time: number) {
    if (this.music) this.music.currentTime = Math.max(0, time / 1000);
  }

  /** Where the song is, in milliseconds, while it is actually sounding. */
  musicTime(): number | null {
    const music = this.music;
    if (!music || !this.enabled || music.paused || music.seeking || music.readyState < 3) return null;

    return music.currentTime * 1000;
  }

  destroy() {
    this.stopListening?.();
    this.music?.pause();
    this.music = null;
    void this.context?.close();
    this.context = null;
  }
}
