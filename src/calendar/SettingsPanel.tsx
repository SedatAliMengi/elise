import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { speak } from "../lib/speech";
import type { Settings } from "../lib/types";
import { useVoiceStatus } from "../lib/useSettings";

interface Props {
  settings: Settings;
  onClose: () => void;
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="set-row">
      <div>
        <div className="set-row__label">{label}</div>
        {hint && <div className="set-row__hint">{hint}</div>}
      </div>
      <button className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)} aria-pressed={on} />
    </div>
  );
}

function comboFrom(e: React.KeyboardEvent): string | null {
  const k = e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(k)) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  if (!mods.length) return null;
  const key = k.length === 1 ? k.toUpperCase() : k === " " ? "Space" : k;
  return [...mods, key].join("+");
}

export default function SettingsPanel({ settings, onClose }: Props) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const voice = useVoiceStatus();

  useEffect(() => {
    api.hasApiKey().then(setHasKey);
    const k = (e: KeyboardEvent) => e.key === "Escape" && !capturing && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, capturing]);

  const update = async (patch: Partial<Settings>) => {
    setErr(null);
    try {
      await api.setSettings({ ...settings, ...patch });
    } catch (e) {
      setErr(String(e));
    }
  };

  const saveKey = async () => {
    setBusy(true);
    setKeyMsg(null);
    try {
      await api.setApiKey(keyInput);
      setKeyInput("");
      const has = await api.hasApiKey();
      setHasKey(has);
      if (has) {
        await api.testApiKey();
        setKeyMsg({ ok: true, text: "Saved and working." });
      } else setKeyMsg({ ok: true, text: "Key removed." });
    } catch (e) {
      setKeyMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const testKey = async () => {
    setBusy(true);
    setKeyMsg(null);
    try {
      await api.testApiKey();
      setKeyMsg({ ok: true, text: "The key works." });
    } catch (e) {
      setKeyMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="modal-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal settings"
        initial={{ scale: 0.97, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 12 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings__head">
          <h2>Settings</h2>
          <button className="btn ghost icon" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings__body">
          <section>
            <h4>Elise's mind (Claude API)</h4>
            <div className="set-row set-row--col">
              <div className="set-row__hint">
                Status:{" "}
                {hasKey === null ? "…" : hasKey ? <b className="ok">key saved (stored in Windows Credential Manager)</b> : <b className="bad">no key yet</b>}
              </div>
              <div className="dt">
                <input
                  className="input"
                  type="password"
                  placeholder={hasKey ? "Paste a new key to replace it" : "Paste your key (sk-ant-…)"}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && keyInput.trim() && saveKey()}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="btn primary" disabled={busy || !keyInput.trim()} onClick={saveKey}>
                  Save
                </button>
                <button className="btn" disabled={busy || !hasKey} onClick={testKey}>
                  Test
                </button>
              </div>
              {keyMsg && <div className={`set-msg ${keyMsg.ok ? "ok" : "bad"}`}>{keyMsg.text}</div>}
            </div>
          </section>

          <section>
            <h4>Summoning</h4>
            <div className="set-row">
              <div>
                <div className="set-row__label">Hotkey</div>
                <div className="set-row__hint">Click, then press a key combination</div>
              </div>
              <button
                className={`btn hotkey ${capturing ? "capturing" : ""}`}
                onClick={() => setCapturing(true)}
                onBlur={() => setCapturing(false)}
                onKeyDown={(e) => {
                  if (!capturing) return;
                  e.preventDefault();
                  if (e.key === "Escape") return setCapturing(false);
                  const c = comboFrom(e);
                  if (c) {
                    setCapturing(false);
                    update({ hotkey: c });
                  }
                }}
              >
                {capturing ? "Press keys…" : settings.hotkey || "None"}
              </button>
            </div>
            <Toggle label='Listen for "Hey Elise"' hint="Uses the laptop microphone, fully offline" on={settings.wakeWord} onChange={(v) => update({ wakeWord: v })} />
            <div className="set-row__hint voice-status">
              Voice engine: {voice.available ? <b className="ok">running</b> : <b className="bad">not running</b>}
              {voice.message && ` · ${voice.message}`}
            </div>
            <Toggle label="Hover on screen" hint="Keep a small eye on screen; drag it anywhere" on={settings.hoverMode} onChange={(v) => update({ hoverMode: v })} />
            <div className="set-row">
              <div>
                <div className="set-row__label">Big eye on screen</div>
                <div className="set-row__hint">Elise fills your main screen · Esc to close</div>
              </div>
              <button className="btn" onClick={() => { onClose(); api.stageSet(true); }}>
                Show
              </button>
            </div>
            {settings.hoverMode && (
              <div className="set-row">
                <div className="set-row__label">Eye position</div>
                <button className="btn" onClick={() => api.resetHoverPos()}>
                  Reset to corner
                </button>
              </div>
            )}
          </section>

          <section>
            <h4>Voice</h4>
            <Toggle label="Voice responses" hint="Elise speaks her replies and reminders" on={settings.voiceResponses} onChange={(v) => update({ voiceResponses: v })} />
            {settings.voiceResponses && (
              <>
                <div className="set-row">
                  <div>
                    <div className="set-row__label">Voice</div>
                    <div className="set-row__hint">Heart · offline</div>
                  </div>
                  <button className="btn" onClick={() => speak(`Hello ${settings.userName}, what is your command?`, { enabled: true })} disabled={!voice.available}>
                    ▶ Preview
                  </button>
                </div>
                <div className="set-row">
                  <div className="set-row__label">Speed</div>
                  <input
                    type="range"
                    min={0.7}
                    max={1.4}
                    step={0.05}
                    value={settings.voiceRate}
                    onChange={(e) => update({ voiceRate: parseFloat(e.target.value) })}
                    className="range"
                  />
                </div>
              </>
            )}
          </section>

          <section>
            <h4>Calendar</h4>
            <div className="set-row">
              <div className="set-row__label">Elise calls you</div>
              <input className="input narrow" value={settings.userName} onChange={(e) => update({ userName: e.target.value })} />
            </div>
            <div className="set-row">
              <div>
                <div className="set-row__label">Default reminder time</div>
                <div className="set-row__hint">For "remind me 2 days before"</div>
              </div>
              <input type="time" className="input narrow" value={settings.defaultReminderTime} onChange={(e) => e.target.value && update({ defaultReminderTime: e.target.value })} />
            </div>
            <div className="set-row">
              <div className="set-row__label">Default event length</div>
              <select className="input narrow" value={settings.defaultEventMinutes} onChange={(e) => update({ defaultEventMinutes: parseInt(e.target.value, 10) })}>
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </select>
            </div>
            <Toggle label="Week starts on Monday" on={settings.weekStartsMonday} onChange={(v) => update({ weekStartsMonday: v })} />
            <Toggle label="24-hour clock" on={settings.time24h} onChange={(v) => update({ time24h: v })} />
          </section>

          <section>
            <h4>System</h4>
            <Toggle label="Start with Windows" hint="Opens quietly in the tray" on={settings.autostart} onChange={(v) => update({ autostart: v })} />
            <div className="set-row">
              <div className="set-row__label">Quit Elise completely</div>
              <button className="btn danger" onClick={() => api.quit()}>
                Quit
              </button>
            </div>
          </section>
          {err && <div className="set-msg bad">{err}</div>}
        </div>
      </motion.div>
    </motion.div>
  );
}
