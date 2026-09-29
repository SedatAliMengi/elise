/**
 * Elise's spoken voice: Kokoro "Heart", rendered offline by the voice engine.
 * Everything goes through speak(), so voice output can be switched off
 * (Settings → Voice responses) or removed without touching callers.
 * If the voice engine isn't running she simply stays silent.
 */
import { invoke } from "@tauri-apps/api/core";
import { on } from "./api";

export interface VoiceOptions {
  enabled: boolean;
}

let nextId = 1;
const waiting = new Map<number, () => void>();
let subscribed = false;

function subscribe() {
  if (subscribed) return;
  subscribed = true;
  on<number>("voice-spoken", (id) => {
    waiting.get(id)?.();
    waiting.delete(id);
  });
}

/** Speak `text`; resolves when she has finished (or right away if silent). */
export async function speak(text: string, opts: VoiceOptions): Promise<void> {
  if (!opts.enabled || !text.trim()) return;
  subscribe();
  const id = nextId++;
  const done = new Promise<void>((resolve) => {
    waiting.set(id, resolve);
    // Safety net: never block the UI on a lost event.
    setTimeout(() => {
      waiting.delete(id);
      resolve();
    }, 4000 + text.length * 120);
  });
  const started = await invoke<boolean>("voice_speak", { id, text }).catch(() => false);
  if (!started) {
    waiting.delete(id);
    return;
  }
  return done;
}

export function stopSpeaking() {
  invoke("voice_stop_speaking").catch(() => {});
}
