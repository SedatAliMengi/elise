"""
Elise voice sidecar — fully offline.

  * Wake word: Vosk small English model in grammar mode ("hey elise").
  * Command:   faster-whisper base.en (int8, CPU), loaded on demand,
               unloaded after a few idle minutes.
  * Voice:     Kokoro TTS, voice "af_heart". Fixed phrases are pre-rendered
               and cached so they play instantly; the model unloads when idle.

Protocol: JSON lines. Commands on stdin, events on stdout.
  in : {"cmd": "set_wake", "on": bool} | {"cmd": "listen"} | {"cmd": "cancel"}
       {"cmd": "preload"} | {"cmd": "shutdown"}
       {"cmd": "speak", "id": int, "text": str, "speed": float} | {"cmd": "stop_speaking"}
       {"cmd": "prewarm", "texts": [str], "speed": float}
  out: {"evt": "ready"} | {"evt": "status", "msg": str} | {"evt": "wake"}
       {"evt": "listening"} | {"evt": "level", "v": float} | {"evt": "transcribing"}
       {"evt": "final", "text": str} | {"evt": "error", "msg": str}
       {"evt": "spoken", "id": int}   (finished, interrupted or failed)

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
KOKORO_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
KOKORO_MODEL = "kokoro-v1.0.onnx"
KOKORO_VOICE = "af_heart"
KOKORO_VOICE_FILE = "voice-heart.npz"
TTS_IDLE_UNLOAD_S = 300

# Stage 1 (cheap, always on): Vosk in grammar mode spots these phrases.
# Anything else falls into "[unk]". Adding look-alike names here makes the
# grammar grab ordinary speech, so keep it tight.
WAKE_PHRASES = ["hey elise", "okay elise", "hi elise", "elise"]
# Stage 2 (only after stage 1 fires): Whisper re-listens to the last few
# seconds and must hear the name. This rejects look-alikes like "hey, at least".
NAME_RE = re.compile(r"\b(elise|elyse|elise's|eliza|alise|elice|ellis)\b", re.I)
WAKE_WINDOW_S = 6.0  # long enough for "Elise, <whole command>" in one breath

PROMPT = (
    "Hey Elise, add a doctor appointment on July 5th at 10pm and remind me two days before. "
    "Move my dentist appointment to next Friday. Cancel the meeting on Thursday."
)

_out_lock = threading.Lock()

# While Elise speaks (plus a short tail for room echo) the microphone input is
# ignored: her own voice from the speakers must never wake her or become a command.
_speaking_until = 0.0
SPEAK_TAIL_S = 0.6

# End-of-speech detection. People pause mid-sentence, so only a clear stretch of
# silence ends a command; the mic button ("I'm done") ends it immediately.
SILENCE_END_S = 2.5
MAX_COMMAND_S = 30
NO_SPEECH_TIMEOUT_S = 8


def speaking() -> bool:
    return time.time() < _speaking_until


def plain_text(text: str) -> str:
    """Remove markdown and symbols that a voice would read out ("asterisk")."""
    t = re.sub(r"^\s*(?:[-*+•]|\d+[.)])\s+", "", text, flags=re.M)  # list bullets
    t = re.sub(r"[*_#`~>|]+", "", t)                                 # emphasis, headings, code
    t = re.sub(r"(\d)\s*[-–—]\s*(\d)", r"\1 to \2", t)                # 15:00 - 16:00 -> "to"
    t = re.sub(r"\s+[-–—]\s+", ", ", t)                              # " - " used as a pause
    t = re.sub(r"\s*\n+\s*", ". ", t)                                # line breaks
    t = re.sub(r"([:;,])\s*\.", r"\1", t)
    t = re.sub(r"\.\s*\.", ".", t)
    return re.sub(r"\s{2,}", " ", t).strip()
_log_file = None  # set in main(): <app data>/voice.log


def emit(**kw) -> None:
    with _out_lock:
        sys.stdout.write(json.dumps(kw) + "\n")
        sys.stdout.flush()
    if kw.get("evt") != "level":
        log("->", json.dumps(kw))


def log(*a) -> None:
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a)
    print("[voice]", line, file=sys.stderr, flush=True)
    if _log_file:
        try:
            with open(_log_file, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass


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
        self.verify_buf: list[np.ndarray] = []  # audio that arrives while verifying
        self.strip_name = False  # one-breath command: drop "Elise," from the transcript
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

                log("loading whisper from", os.path.join(self.models_dir, "whisper"))

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
            try:
                log("mic opened:", sd.query_devices(kind="input")["name"])
            except Exception:  # noqa: BLE001
                pass
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
        log("listen requested")
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

    def finish(self):
        """The user says they're done: transcribe what we have right now."""
        with self.lock:
            if self.mode != "record":
                return
            buf, self.rec_buf = self.rec_buf, []
            heard = self.speech_started
            self.mode = "transcribing" if heard and buf else ("wake" if self.wake_on else "idle")
        emit(evt="level", v=0)
        log("finish requested; speech heard:", heard)
        if heard and buf:
            threading.Thread(target=self.transcribe, args=(np.concatenate(buf),), daemon=True).start()
        else:
            with self.lock:
                self.sync_stream()
            emit(evt="final", text="")

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
        if speaking():
            # Drop Elise's own voice; forget anything the wake word heard of it.
            if self.recent:
                self.recent = []
                if self.rec is not None:
                    self.rec.Reset()
            return
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
                        self.verify_buf = []
                    threading.Thread(target=self.verify_wake, args=(clip,), daemon=True).start()
        elif mode == "verifying":
            # Keep listening while Whisper checks: the user may still be talking.
            self.verify_buf.append(block)
        elif mode == "armed":
            if time.time() > self.armed_until:
                self.cancel()
        elif mode == "record":
            self.record_block(block)

    def verify_wake(self, clip: np.ndarray):
        heard = ""
        try:
            model = self.ensure_whisper()
            # Tell Whisper "Elise" is a name to expect (it otherwise hears "Police").
            segs, _ = model.transcribe(
                clip.astype(np.float32) / 32768.0,
                language="en",
                beam_size=1,
                condition_on_previous_text=False,
                initial_prompt="Elise is my assistant.",
            )
            heard = " ".join(s.text.strip() for s in segs)
        except Exception as e:  # noqa: BLE001
            log("verify failed:", e)
        m = NAME_RE.search(heard)
        ok = bool(m)
        # "Elise, add a meeting tomorrow" in one breath: the rest is the command.
        rest = heard[m.end():].strip(" ,.!?;:-") if m else ""
        if len(rest.split()) < 2:
            rest = ""
        log("verify:", repr(heard), "->", ok, "| command:", repr(rest))
        with self.lock:
            if self.mode != "verifying":
                return
            if self.rec is not None:
                self.rec.Reset()
            if ok and rest:
                # "Elise, add a meeting tomorrow": keep recording until they stop
                # talking, then transcribe the whole sentence as the command.
                self.mode = "record"
                self.rec_buf = [clip] + self.verify_buf
                self.rec_started = time.time()
                self.speech_started = True
                self.silence_blocks = 0
                self.loud_blocks = 0
                # Room noise = the quietest moments of what we already heard.
                n = len(clip) // BLOCK
                levels = np.sqrt(np.mean(clip[: n * BLOCK].reshape(n, BLOCK).astype(np.float32) ** 2, axis=1)) if n else np.array([300.0])
                self.noise_floor = float(np.percentile(levels, 10))
                self.strip_name = True
            elif ok:
                self.mode = "armed"
                self.armed_until = time.time() + 12
            else:
                self.mode = "wake" if self.wake_on else "idle"
            self.verify_buf = []
        if ok:
            emit(evt="wake", direct=bool(rest))

    def record_block(self, block: np.ndarray):
        self.rec_buf.append(block)
        rms = float(np.sqrt(np.mean(block.astype(np.float32) ** 2)))
        if self.noise_floor is None:
            self.noise_floor = min(rms, 400.0)
        elif not self.speech_started:
            self.noise_floor = 0.9 * self.noise_floor + 0.1 * min(rms, self.noise_floor * 2)
        # Start needs clear speech; once talking, quieter syllables still count
        # as speech (hysteresis), so soft voices aren't cut mid-sentence.
        thr = max(self.noise_floor * 2.2, 260.0)
        thr_off = max(self.noise_floor * 1.5, 180.0)

        level = min(1.0, rms / 4000.0)
        if abs(level - self.last_level) > 0.02:
            self.last_level = level
            emit(evt="level", v=round(level, 3))

        if rms > (thr_off if self.speech_started else thr):
            self.loud_blocks += 1
            self.silence_blocks = 0
            if self.loud_blocks >= 2:
                self.speech_started = True
        else:
            self.loud_blocks = 0
            self.silence_blocks += 1

        elapsed = time.time() - self.rec_started
        if self.speech_started and self.loud_blocks == 2:
            log(f"speech started (rms {rms:.0f}, threshold {thr:.0f})")
        silence_end = int(SILENCE_END_S * SR / BLOCK)
        done = (self.speech_started and self.silence_blocks >= silence_end) or elapsed > MAX_COMMAND_S
        if done:
            log(f"recording ended after {elapsed:.1f}s ({'silence' if elapsed <= MAX_COMMAND_S else 'max length'})")
        if not self.speech_started and elapsed > NO_SPEECH_TIMEOUT_S:
            log(f"no speech heard in {NO_SPEECH_TIMEOUT_S}s (last rms {rms:.0f}, threshold {thr:.0f}, noise floor {self.noise_floor:.0f})")
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
            if self.strip_name:
                m = NAME_RE.search(text)
                if m and m.start() <= 12:  # "Elise," / "Hey Elise," at the start
                    text = text[m.end():].strip(" ,.!?;:-")
                self.strip_name = False
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
                if getattr(self, "speaker", None) is not None:
                    self.speaker.maybe_unload()


class Speaker:
    """Elise's voice. One worker thread plays requests in order."""

    def __init__(self, models_dir: str):
        self.dir = os.path.join(models_dir, "kokoro")
        self.model = None
        self.used = 0.0
        self.lock = threading.Lock()
        self.cache: dict[tuple[str, float], np.ndarray] = {}
        self.jobs: queue.Queue[tuple[int, str, float]] = queue.Queue()
        self.stop_flag = threading.Event()
        self.sr = 24000
        threading.Thread(target=self._worker, daemon=True).start()

    def _download(self):
        os.makedirs(self.dir, exist_ok=True)
        model = os.path.join(self.dir, KOKORO_MODEL)
        voice = os.path.join(self.dir, KOKORO_VOICE_FILE)
        if not os.path.exists(model):
            emit(evt="status", msg="Downloading Elise's voice (310 MB, one time)…")
            urllib.request.urlretrieve(f"{KOKORO_URL}/{KOKORO_MODEL}", model + ".part")
            os.replace(model + ".part", model)
        if not os.path.exists(voice):
            pack = os.path.join(self.dir, "voices-v1.0.bin")
            urllib.request.urlretrieve(f"{KOKORO_URL}/voices-v1.0.bin", pack)
            np.savez(voice, **{KOKORO_VOICE: np.load(pack)[KOKORO_VOICE]})
            os.remove(pack)
        emit(evt="status", msg="")

    def ensure(self):
        with self.lock:
            if self.model is None:
                self._download()
                import onnxruntime as ort
                from kokoro_onnx import Kokoro

                so = ort.SessionOptions()
                so.intra_op_num_threads = min(8, os.cpu_count() or 4)
                sess = ort.InferenceSession(os.path.join(self.dir, KOKORO_MODEL), so, providers=["CPUExecutionProvider"])
                self.model = Kokoro.from_session(sess, os.path.join(self.dir, KOKORO_VOICE_FILE))
            self.used = time.time()
            return self.model

    def render(self, text: str, speed: float) -> np.ndarray:
        key = (text, round(speed, 2))
        if key in self.cache:
            return self.cache[key]
        audio, self.sr = self.ensure().create(text, voice=KOKORO_VOICE, speed=speed, lang="en-us")
        audio = audio.astype(np.float32)
        if len(self.cache) < 64:
            self.cache[key] = audio
        return audio

    def prewarm(self, texts: list[str], speed: float):
        try:
            for t in texts:
                if t.strip():
                    self.render(t.strip(), speed)
        except Exception as e:  # noqa: BLE001
            log("prewarm failed:", e)

    def speak(self, job_id: int, text: str, speed: float):
        self.jobs.put((job_id, plain_text(text), speed))

    def stop(self):
        self.stop_flag.set()
        while not self.jobs.empty():
            job_id, _, _ = self.jobs.get_nowait()
            emit(evt="spoken", id=job_id)
        try:
            import sounddevice as sd

            sd.stop()
        except Exception:  # noqa: BLE001
            pass

    def _worker(self):
        import sounddevice as sd

        while True:
            job_id, text, speed = self.jobs.get()
            self.stop_flag.clear()
            try:
                # Speak sentence by sentence so long answers start quickly.
                parts = [p for p in re.split(r"(?<=[.!?])\s+", text.strip()) if p]
                for part in parts:
                    if self.stop_flag.is_set():
                        break
                    audio = self.render(part, speed)
                    if self.stop_flag.is_set():
                        break
                    global _speaking_until
                    _speaking_until = float("inf")
                    try:
                        sd.play(audio, self.sr)
                        sd.wait()
                    finally:
                        _speaking_until = time.time() + SPEAK_TAIL_S
            except Exception as e:  # noqa: BLE001
                log("speak failed:", e)
            emit(evt="spoken", id=job_id)

    def maybe_unload(self):
        with self.lock:
            if self.model is not None and self.jobs.empty() and time.time() - self.used > TTS_IDLE_UNLOAD_S:
                self.model = None
                gc.collect()
                log("tts unloaded")


def stdin_reader(v: Voice, spk: Speaker):
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
        elif cmd == "finish":
            v.finish()
        elif cmd == "preload":
            threading.Thread(target=v.ensure_whisper, daemon=True).start()
        elif cmd == "speak":
            spk.speak(int(msg.get("id", 0)), str(msg.get("text", "")), float(msg.get("speed", 1.0)))
        elif cmd == "stop_speaking":
            spk.stop()
        elif cmd == "prewarm":
            threading.Thread(target=spk.prewarm, args=(list(msg.get("texts", [])), float(msg.get("speed", 1.0))), daemon=True).start()
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
    global _log_file
    _log_file = os.path.join(os.path.dirname(os.path.abspath(args.models)), "voice.log")
    try:  # keep the log small
        if os.path.getsize(_log_file) > 512_000:
            os.remove(_log_file)
    except OSError:
        pass
    log("voice engine starting, models in", args.models)
    v = Voice(args.models)
    spk = Speaker(args.models)
    v.speaker = spk
    threading.Thread(target=stdin_reader, args=(v, spk), daemon=True).start()
    emit(evt="ready")
    v.loop()


if __name__ == "__main__":
    main()
