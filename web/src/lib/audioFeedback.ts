interface WindowWithAudio extends Window {
  AudioContext: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const win = window as WindowWithAudio;
    const AudioCtor = win.AudioContext || win.webkitAudioContext;
    if (AudioCtor) {
      audioCtx = new AudioCtor();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    void audioCtx.resume().catch(() => undefined);
  }
  return audioCtx;
}

let warmedUp = false;

/**
 * Builds the AudioContext now, away from any scan: building it costs ~200 ms on the main thread, and doing that
 * at the first chime splits the next barcode-gun burst. Browsers keep it suspended until a user gesture, so it
 * resumes on the first tap or key press. Call once when the scanning screen mounts.
 */
export function warmUpAudio(): void {
  if (warmedUp || typeof window === "undefined") return;
  warmedUp = true;
  try {
    getAudioContext();
  } catch {
    return;
  }
  const resume = () => {
    window.removeEventListener("pointerdown", resume, true);
    window.removeEventListener("keydown", resume, true);
    if (audioCtx?.state === "suspended") void audioCtx.resume().catch(() => undefined);
  };
  window.addEventListener("pointerdown", resume, true);
  window.addEventListener("keydown", resume, true);
}

export function playSuccessChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    // Dual ascending pleasant chime (880Hz then 1760Hz)
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1760, now + 0.08);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.25);
  } catch {
    // Audio autoplay restrictions or unsupported
  }
}

export function playErrorBuzz(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    // Low harsh buzzer
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.setValueAtTime(160, now + 0.1);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.35);
  } catch {
    // Audio autoplay restrictions or unsupported
  }
}

export function playProvisionalChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    // Dual mid-tone warm chime (587Hz D5 then 659Hz E5) - distinctly non-final compared to success (880/1760Hz)
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.setValueAtTime(659.25, now + 0.1);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  } catch {
    // Audio autoplay restrictions or unsupported
  }
}
