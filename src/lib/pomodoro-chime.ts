/**
 * **The completion cue** — a short synthesized chime for the bar timer
 * (task 354).
 *
 * Synthesized rather than shipped as an audio file, for two reasons that both
 * matter here: an artifact would be a network fetch under a strict CSP for one
 * second of sound, and the app is offline-first. Two soft sine tones (a rising
 * fifth) with an exponential decay — about a second, quiet, no percussive
 * attack.
 *
 * ## The autoplay rule, and why arming is a separate call
 *
 * A browser creates an `AudioContext` in the `suspended` state unless a user
 * gesture is in flight, and it will not resume one outside a gesture either.
 * The completion is a TIMER event — by definition not a gesture — so a context
 * created at completion time is silent. {@link armPomodoroAudio} is therefore
 * called from the play/start click, which is the gesture that precedes every
 * completion, and the context it warms is what the chime later plays through.
 *
 * Everything is best-effort and total: no Web Audio (jsdom, an old browser, a
 * blocked context) means no sound and never an exception on the timer path.
 */

type Ctor = typeof AudioContext;

function audioCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

let ctx: AudioContext | null = null;

/**
 * Create (or resume) the shared context. **Call from a user gesture** — the
 * play button — so the autoplay policy can never mute the completion cue.
 * Idempotent and safe to call on every press.
 */
export function armPomodoroAudio(): void {
  try {
    const Ctor = audioCtor();
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** One tone: sine, exponential decay, scheduled on the shared context. */
function tone(ac: AudioContext, freq: number, at: number, dur: number, peak: number): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, at);
  // Ramp up over ~12ms rather than starting at peak: an instant onset clicks.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/**
 * Play the two-tone completion cue. Called once per completion — the
 * transition that produces it is idempotent in the store, so this cannot
 * double-fire for one elapse.
 */
export function playPomodoroChime(): void {
  try {
    armPomodoroAudio();
    const ac = ctx;
    if (!ac || typeof ac.createOscillator !== "function") return;
    const t = ac.currentTime + 0.01;
    tone(ac, 660, t, 0.34, 0.09);        // E5
    tone(ac, 990, t + 0.19, 0.62, 0.075); // B5 — a fifth up, softer
  } catch {
    /* a cue is never worth an exception on the timer path */
  }
}

/** Test-only: forget the shared context. */
export function __resetPomodoroAudioForTest(): void {
  try {
    void ctx?.close();
  } catch {
    /* ignore */
  }
  ctx = null;
}
