import type { PreviewSkin } from "./assets";
import type { SoundName } from "./scene";

const SAMPLE_LOOKUPS: Record<SoundName, string[]> = {
  hit: ["normal-hitnormal", "soft-hitnormal"],
  tick: ["normal-slidertick", "soft-slidertick"],
  break: ["combobreak"],
  bonus: ["spinnerbonus"],
};

/** Plays the mix's hitsounds in time with the preview. */
export class PreviewAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private readonly decoded = new Map<string, Promise<AudioBuffer | null>>();
  private generation = 0;

  enabled = false;

  /** Browsers only allow audio to start from a user gesture, so this is called from the toggle's click. */
  enable() {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = 0.45;
      this.gain.connect(this.context.destination);
    }

    void this.context.resume();
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  async setSkin(skin: PreviewSkin) {
    if (!this.context) {
      this.pendingSkin = skin;
      return;
    }

    const generation = ++this.generation;
    const next = new Map<SoundName, AudioBuffer>();

    await Promise.all(
      (Object.keys(SAMPLE_LOOKUPS) as SoundName[]).map(async (sound) => {
        const url = skin.sampleUrl(...SAMPLE_LOOKUPS[sound]);
        const buffer = url ? await this.decode(url) : null;

        if (buffer) next.set(sound, buffer);
      }),
    );

    if (generation === this.generation) this.buffers = next;
  }

  private pendingSkin: PreviewSkin | null = null;

  /** Loads samples for whichever skin was set before audio was first enabled. */
  async loadPending() {
    if (this.pendingSkin) {
      const skin = this.pendingSkin;
      this.pendingSkin = null;
      await this.setSkin(skin);
    }
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

  play(sound: SoundName) {
    const buffer = this.buffers.get(sound);
    if (!this.enabled || !this.context || !this.gain || !buffer) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.start();
  }

  destroy() {
    void this.context?.close();
    this.context = null;
  }
}
