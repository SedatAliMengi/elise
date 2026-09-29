"""
Elise voice sidecar — fully offline.

  * Wake word: Vosk small English model in grammar mode ("hey elise").
  * Command:   faster-whisper base.en (int8, CPU), loaded on demand,
               unloaded after a few idle minutes.

Protocol: JSON lines. Commands on stdin, events on stdout.
  in : {"cmd": "set_wake", "on": bool} | {"cmd": "listen"} | {"cmd": "cancel"}
       {"cmd": "preload"} | {"cmd": "shutdown"}
  out: {"evt": "ready"} | {"evt": "status", "msg": str} | {"evt": "wake"}
       {"evt": "listening"} | {"evt": "level", "v": float} | {"evt": "transcribing"}
       {"evt": "final", "text": str} | {"evt": "error", "msg": str}

The microphone stream is only open while wake listening is on or a command is
being recorded, so with wake word off Elise uses no mic and no CPU.
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import queue
import re
import sys
import threading
import time
import urllib.request
import zipfile

import numpy as np

SR = 16000
BLOCK = 1600  # 100 ms
VOSK_NAME = "vosk-model-small-en-us-0.15"
VOSK_URL = f"https://alphacephei.com/vosk/models/{VOSK_NAME}.zip"
WHISPER_NAME = "base.en"
WHISPER_IDLE_UNLOAD_S = 300

# Stage 1 (cheap, always on): Vosk in grammar mode spots these phrases.
# Anything else falls into "[unk]". Adding look-alike names here makes the
# grammar grab ordinary speech, so keep it tight.
WAKE_PHRASES = ["hey elise", "okay elise", "hi elise"]
# Stage 2 (only after stage 1 fires): Whisper re-listens to the last few
# seconds and must hear the name. This rejects look-alikes like "hey, at least".
NAME_RE = re.compile(r"\b(elise|elyse|elise's|eliza|alise|elice|ellis)\b", re.I)
WAKE_WINDOW_S = 2.5

PROMPT = (
    "Hey Elise, add a doctor appointment on July 5th at 10pm and remind me two days before. "
    "Move my dentist appointment to next Friday. Cancel the meeting on Thursday."
)

_out_lock = threading.Lock()


def emit(**kw) -> None:
    with _out_lock:
        sys.stdout.write(json.dumps(kw) + "\n")
        sys.stdout.flush()


def log(*a) -> None:
    print("[voice]", *a, file=sys.stderr, flush=True)


class Voice:
    def __init__(self, models_dir: str):
        self.models_dir = models_dir
        os.makedirs(models_dir, exist_ok=True)
        self.audio: queue.Queue[np.ndarray] = queue.Queue(maxsize=200)
        self.stream = None
        self.wake_on = False
        self.mode = "idle"  # idle | wake | armed | record
        self.armed_until = 0.0
        self.lock = threading.RLock()

        self.vosk_model = None
        self.rec = None
        self.whisper = None
        self.whisper_used = 0.0
        self.whisper_lock = threading.Lock()

        self.recent: list[np.ndarray] = []  # last few seconds while wake listening
        self.rec_buf: list[np.ndarray] = []
        self.rec_started = 0.0
        self.speech_started = False
        self.silence_blocks = 0
        self.loud_blocks = 0
        self.noise_floor = None
        self.last_level = 0.0

    # ---------- models ----------

    def ensure_vosk(self) -> bool:
        if self.vosk_model is not None:
            return True
        path = os.path.join(self.models_dir, VOSK_NAME)
        if not os.path.isdir(path):
            emit(evt="status", msg="Downloading the wake word model (40 MB, one time)…")
            try:
                zpath = path + ".zip"
                urllib.request.urlretrieve(VOSK_URL, zpath)
                with zipfile.ZipFile(zpath) as z:
                    z.extractall(self.models_dir)
                os.remove(zpath)
            except Exception as e:  # noqa: BLE001
                emit(evt="error", msg=f"Couldn't download the wake word model: {e}")
                return False
        from vosk import KaldiRecognizer, Model, SetLogLevel

        SetLogLevel(-1)
        self.vosk_model = Model(path)
        words_file = os.path.join(path, "graph", "words.txt")
        vocab: set[str] = set()
        if os.path.exists(words_file):
            with open(words_file, encoding="utf-8") as f:
                vocab = {line.split()[0] for line in f if line.strip()}
        phrases = [p for p in WAKE_PHRASES if not vocab or all(w in vocab for w in p.split())]
        log("wake phrases:", phrases)
        # Whisper is not preloaded: it costs ~150 MB and is only needed once a
        # wake candidate is heard (first check of a session takes ~1.5 s).
        self.rec = KaldiRecognizer(self.vosk_model, SR, json.dumps(phrases + ["[unk]"]))
        return True

    def ensure_whisper(self):
        with self.whisper_lock:
            if self.whisper is None:
                from faster_whisper import WhisperModel

                emit(evt="status", msg="Loading speech model…")
                self.whisper = WhisperModel(
                    WHISPER_NAME,
                    device="cpu",
                    compute_type="int8",
                    download_root=os.path.join(self.models_dir, "whisper"),
                    cpu_threads=max(2, (os.cpu_count() or 4) // 2),
                )
                emit(evt="status", msg="")
            self.whisper_used = time.time()
            return self.whisper

    def maybe_unload_whisper(self):
        with self.whisper_lock:
            if self.whisper is not None and time.time() - self.whisper_used > WHISPER_IDLE_UNLOAD_S and self.mode != "record":
                self.whisper = None
                gc.collect()
                log("whisper unloaded")

    # ---------- microphone ----------

    def _callback(self, indata, frames, t, status):  # noqa: ARG002
        try:
            self.audio.put_nowait(indata[:, 0].copy())
        except queue.Full:
            pass

    def open_stream(self):
        if self.stream is not None:
            return True
        import sounddevice as sd

        try:
            sd._terminate()  # re-scan devices so a changed default mic is picked up
            sd._initialize()
            self.stream = sd.InputStream(samplerate=SR, channels=1, dtype="int16", blocksize=BLOCK, callback=self._callback)
            self.stream.start()
            return True
        except Exception as e:  # noqa: BLE001
            self.stream = None
            emit(evt="error", msg="no_mic")
            log("mic error:", e)
            return False

    def close_stream(self):
        if self.stream is not None:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:  # noqa: BLE001
                pass
            self.stream = None
        while not self.audio.empty():
            self.audio.get_nowait()

    def sync_stream(self):
        need = self.wake_on or self.mode in ("record", "armed")
        if need:
            self.open_stream()
        else:
            self.close_stream()

    # ---------- commands ----------

    def set_wake(self, on: bool):
        with self.lock:
            self.wake_on = on
            if on and not self.ensure_vosk():
                self.wake_on = False
            if self.mode in ("idle", "wake", "verifying"):
                self.mode = "wake" if self.wake_on else "idle"
            if self.rec is not None:
                self.rec.Reset()
            self.sync_stream()

    def listen(self):
        with self.lock:
            self.mode = "record"
            self.rec_buf = []
            self.rec_started = time.time()
            self.speech_started = False
            self.silence_blocks = 0
            self.loud_blocks = 0
            self.noise_floor = None
            if not self.open_stream():
                self.mode = "wake" if self.wake_on else "idle"
                return
            # drop audio captured before this moment (e.g. Elise's greeting)
            while not self.audio.empty():
                self.audio.get_nowait()
        threading.Thread(target=self.ensure_whisper, daemon=True).start()
        emit(evt="listening")

    def cancel(self):
        with self.lock:
            self.mode = "wake" if self.wake_on else "idle"
            self.rec_buf = []
            if self.rec is not None:
                self.rec.Reset()
            self.sync_stream()

    # ---------- processing ----------

    def on_block(self, block: np.ndarray):
        mode = self.mode
        if mode == "wake" and self.rec is not None:
            self.recent.append(block)
            keep = int(WAKE_WINDOW_S * SR / BLOCK) + 4
            if len(self.recent) > keep:
                del self.recent[: len(self.recent) - keep]
            # Only final results: partials are too eager.
            if self.rec.AcceptWaveform(block.tobytes()):
                text = json.loads(self.rec.Result()).get("text", "")
                if any(p in text for p in WAKE_PHRASES):
                    log("wake candidate:", text)
                    clip = np.concatenate(self.recent)
                    self.recent = []
                    with self.lock:
                        self.mode = "verifying"
                    threading.Thread(target=self.verify_wake, args=(clip,), daemon=True).start()
        elif mode == "armed":
            if time.time() > self.armed_until:
                self.cancel()
        elif mode == "record":
            self.record_block(block)

    def verify_wake(self, clip: np.ndarray):
        heard = ""
        try:
            model = self.ensure_whisper()
            segs, _ = model.transcribe(clip.astype(np.float32) / 32768.0, language="en", beam_size=1, condition_on_previous_text=False)
            heard = " ".join(s.text.strip() for s in segs)
        except Exception as e:  # noqa: BLE001
            log("verify failed:", e)
        ok = bool(NAME_RE.search(heard))
        log("verify:", repr(heard), "->", ok)
        with self.lock:
            if self.mode != "verifying":
                return
            if self.rec is not None:
                self.rec.Reset()
            if ok:
                self.mode = "armed"
                self.armed_until = time.time() + 12
            else:
                self.mode = "wake" if self.wake_on else "idle"
        if ok:
            emit(evt="wake")

    def record_block(self, block: np.ndarray):
        self.rec_buf.append(block)
        rms = float(np.sqrt(np.mean(block.astype(np.float32) ** 2)))
        if self.noise_floor is None:
            self.noise_floor = rms
        elif not self.speech_started:
            self.noise_floor = 0.9 * self.noise_floor + 0.1 * min(rms, self.noise_floor * 2)
        thr = max(self.noise_floor * 2.8, 420.0)

        level = min(1.0, rms / 4000.0)
        if abs(level - self.last_level) > 0.02:
            self.last_level = level
            emit(evt="level", v=round(level, 3))

        if rms > thr:
            self.loud_blocks += 1
            self.silence_blocks = 0
            if self.loud_blocks >= 2:
                self.speech_started = True
        else:
            self.loud_blocks = 0
            self.silence_blocks += 1

        elapsed = time.time() - self.rec_started
        done = (self.speech_started and self.silence_blocks >= 12) or elapsed > 15
        if not self.speech_started and elapsed > 7:
            with self.lock:
                self.mode = "wake" if self.wake_on else "idle"
                self.sync_stream()
            emit(evt="level", v=0)
            emit(evt="final", text="")
            return
        if done:
            audio = np.concatenate(self.rec_buf)
            self.rec_buf = []
            with self.lock:
                self.mode = "transcribing"
            emit(evt="level", v=0)
            threading.Thread(target=self.transcribe, args=(audio,), daemon=True).start()

    def transcribe(self, audio: np.ndarray):
        emit(evt="transcribing")
        try:
            model = self.ensure_whisper()
            f32 = audio.astype(np.float32) / 32768.0
            segments, _ = model.transcribe(f32, language="en", beam_size=1, initial_prompt=PROMPT, condition_on_previous_text=False)
            text = " ".join(s.text.strip() for s in segments).strip()
            self.whisper_used = time.time()
            emit(evt="final", text=text)
        except Exception as e:  # noqa: BLE001
            emit(evt="error", msg=f"transcribe: {e}")
        finally:
            with self.lock:
                self.mode = "wake" if self.wake_on else "idle"
                if self.rec is not None:
                    self.rec.Reset()
                self.sync_stream()

    def loop(self):
        last_housekeeping = time.time()
        while True:
            try:
                block = self.audio.get(timeout=1.0)
                self.on_block(block)
            except queue.Empty:
                pass
            if time.time() - last_housekeeping > 30:
                last_housekeeping = time.time()
                self.maybe_unload_whisper()


def stdin_reader(v: Voice):
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        cmd = msg.get("cmd")
        if cmd == "set_wake":
            threading.Thread(target=v.set_wake, args=(bool(msg.get("on")),), daemon=True).start()
        elif cmd == "listen":
            v.listen()
        elif cmd == "cancel":
            v.cancel()
        elif cmd == "preload":
            threading.Thread(target=v.ensure_whisper, daemon=True).start()
        elif cmd == "shutdown":
            break
    # stdin closed: the app is gone.
    v.close_stream()
    os._exit(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass
    v = Voice(args.models)
    threading.Thread(target=stdin_reader, args=(v,), daemon=True).start()
    emit(evt="ready")
    v.loop()


if __name__ == "__main__":
    main()
