/**
 * Elise's spoken voice. Everything goes through speak(), so the feature can be
 * switched off (Settings → Voice responses) or removed without touching callers.
 * Uses the Windows voices exposed through WebView2's speechSynthesis.
 */

let voicesCache: SpeechSynthesisVoice[] = [];

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!("speechSynthesis" in window)) return Promise.resolve([]);
  const v = speechSynthesis.getVoices();
  if (v.length) {
    voicesCache = v;
    return Promise.resolve(v);
  }
  return new Promise((resolve) => {
    const done = () => {
      voicesCache = speechSynthesis.getVoices();
      resolve(voicesCache);
    };
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

export async function englishVoices(): Promise<SpeechSynthesisVoice[]> {
  const all = await loadVoices();
  return all.filter((v) => v.lang.toLowerCase().startsWith("en"));
}

const PREFERRED = ["aria", "jenny", "ava", "emma", "michelle", "sonia", "libby", "zira", "hazel", "susan"];

function pickVoice(name: string | null): SpeechSynthesisVoice | undefined {
  const en = voicesCache.filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (name) {
    const exact = en.find((v) => v.name === name);
    if (exact) return exact;
  }
  for (const p of PREFERRED) {
    const v = en.find((x) => x.name.toLowerCase().includes(p));
    if (v) return v;
  }
  return en[0];
}

export interface VoiceOptions {
  enabled: boolean;
  voiceName: string | null;
  rate: number;
}

/** Speak `text`; resolves when finished (or immediately when disabled). */
export async function speak(text: string, opts: VoiceOptions): Promise<void> {
  if (!opts.enabled || !text.trim() || !("speechSynthesis" in window)) return;
  await loadVoices();
  speechSynthesis.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(opts.voiceName);
    if (v) u.voice = v;
    u.rate = opts.rate || 1;
    u.pitch = 1.05;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
    // Safety net: never block the UI on a stuck utterance.
    setTimeout(resolve, 2000 + text.length * 90);
  });
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
