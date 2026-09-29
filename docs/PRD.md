# Elise — Product Requirements Document

**Owner:** Enigma (personal use, single user, single Windows laptop)
**Status:** Approved 2026-09-29 — in build (see §11 for progress)
**Date:** 2026-09-29

---

## 1. What Elise is

Elise is a personal Windows calendar assistant. She lives in the system tray, starts
with Windows, and can be summoned by saying **"Hey Elise"**, by a hotkey, or from the
tray. When summoned, a glowing **eye** appears in the bottom-right corner of the screen,
greets the user, takes a command by **voice or typing**, updates the calendar, says
**"Understood."**, and fades away.

There is also a full calendar window, which the user can browse and edit by hand, with
Elise's eye "overseeing" it from the top middle.

### Goals
1. Adding, moving, editing and deleting events and reminders by natural language is
   faster than using a normal calendar app.
2. It always runs in the background with **no noticeable performance impact**,
   including while gaming.
3. It has a distinctive, cohesive, "magical" look: a dark UI, a purple iris, a glowing
   red pupil, and smooth, restrained animation.

### Non-goals (v1)
- No sync with phone, Google Calendar or Outlook, and no cloud storage. Data stays on
  this laptop only.
- English only.
- No overlay over **exclusive-fullscreen** games. Borderless and windowed are
  supported, and the user accepts this limit.
- No multiple users or accounts.
- The user can't change Elise's appearance or pick a different logo.

---

## 2. Platform & tech stack

| Concern | Choice | Why |
|---|---|---|
| App shell | **Tauri 2** (Rust backend + WebView2 frontend) | Much lower RAM/CPU than Electron. Node 24 and Rust 1.98 are already installed. |
| Frontend | **React + TypeScript + Vite** | Well-known, good animation tooling |
| Animation | CSS transforms/opacity + SVG, **Framer Motion** for UI transitions | Runs on the GPU and stays smooth |
| Storage | **SQLite** (`rusqlite`, bundled) at `%APPDATA%\Elise\elise.db` | Reliable, handles years of events |
| Settings | JSON at `%APPDATA%\Elise\settings.json` | Simple |
| API key storage | **Windows Credential Manager** (`keyring` crate) | Never stored in plain text or in the repo |
| Command understanding | **Claude API**, model **`claude-haiku-4-5`** (cheapest and fastest), using **tool use** for structured output | Reliable natural-language understanding at a tiny cost |
| Wake word ("Hey Elise") | Local, offline. **Vosk** small English model in grammar mode (`["hey elise", "[unk]"]`) | Free, no key, low CPU |
| Speech-to-text (the command) | Local, offline. **faster-whisper** `base.en` (int8, CPU), loaded on demand | Free, no key, accurate |
| Voice pipeline host | Small **Python sidecar** (`elise-voice`) packaged with PyInstaller, spawned by Tauri, talking to it by JSON lines over stdin/stdout | The best offline speech libraries are Python. The sidecar keeps them isolated from the app. |
| Elise's spoken voice | Windows built-in voices via WebView2 `speechSynthesis` (prefer a female English voice, e.g. "Aria"/"Zira") | Free, no key |
| Notifications | Elise's eye overlay (primary). Windows toast via `tauri-plugin-notification` as a fallback when the overlay is off. | |
| Autostart | `tauri-plugin-autostart`, launched with `--hidden` so it goes straight to the tray | Like Discord |
| Single instance | `tauri-plugin-single-instance` | A second launch focuses the existing one |
| Global hotkey | `tauri-plugin-global-shortcut`, default **Ctrl+Alt+E** | Summon in games without voice |
| Installer | Tauri NSIS bundle (`.exe` installer) | |

**The only secret is the Claude API key.** The user types it into Elise's Settings
screen. It is **never** pasted into chat, committed, or written to a file.

---

## 3. Visual identity

### 3.1 Color palette

| Token | Hex | Use |
|---|---|---|
| `bg` | `#0A0710` | App background (near-black with a purple tint) |
| `surface` | `#140E1F` | Panels, day cells |
| `surface-2` | `#1D1430` | Hover, selected cells, inputs |
| `border` | `#2C2042` | Hairlines |
| `iris` | `#8B00FF` | **Primary**: electric purple (iris, buttons, focus, selection) |
| `iris-glow` | `#B44CFF` | Glows, highlights |
| `pupil` | `#D70000` | **Accent**: the red pupil, "today" marker, imminent reminders, delete |
| `pupil-glow` | `#FF2A2A` | Red glow |
| `text` | `#EDE6F7` | Primary text |
| `text-dim` | `#9A8DB3` | Secondary text |

Glow = layered `box-shadow` / SVG `feGaussianBlur` in `iris-glow` / `pupil-glow` at low
opacity. It should look magical but stay readable, and never be neon-soup.

Typography: a clean geometric sans (e.g. **Inter** or **Outfit**, bundled locally, not
loaded from the web).

### 3.2 The Eye (logo + character)

The eye is an **SVG component** (`<Eye state=… />`) used at every size: tray icon,
overlay, calendar header and app icon.

- **Shape:** almond-shaped eye outline in a light lavender stroke with a soft purple
  outer glow.
- **Iris:** electric purple radial gradient (`#8B00FF` → `#B44CFF` → darker rim), with
  subtle fibrous radial strokes and a faint **glow**.
- **Pupil:** red `#D70000` core with a **red glow** (`#FF2A2A`), slightly lit from
  within.
- **Highlight:** one small white catch-light.

**States and animations.** All are smooth and subtle, using transforms/opacity only.

| State | Animation |
|---|---|
| `appearing` | Eyelids open from a closed line (~450 ms, ease-out), glow fades in |
| `idle` | Slow glow "breathing" (~4 s loop). Iris drifts a few px as if looking around. Natural blink every ~5–9 s (randomized). |
| `listening` | Pupil gently pulses with the **microphone level**. Glow brightens slightly. |
| `thinking` | Slow shimmer rotating around the iris |
| `speaking` / `done` | One soft glow pulse on "Understood." |
| `error` | Pupil flickers once. Short "can't do that" message. |
| `vanishing` | Eyelids close (~350 ms), then fade out |

The app icon and tray icon are rendered from the same SVG as PNG/ICO at build time
(16, 32, 48, 256 px).

---

## 4. Features & acceptance criteria

### F1 — Tray presence & app lifecycle
- An eye icon sits in the Windows system tray (the overflow panel is fine).
- **Left-click** the tray icon → open or focus the calendar window.
- **Right-click menu:**
  - Summon Elise
  - Open Calendar
  - ☐ Hover on screen (toggle, see F5)
  - ☐ Listen for "Hey Elise" (toggle)
  - ☐ Voice responses (toggle, default **on**)
  - ☐ Start with Windows (toggle, default **on**)
  - Settings…
  - Quit Elise
- Closing the calendar window **hides it to the tray**. It does not quit.
- Only one instance can run.

**Accept when:** after a reboot, Elise is in the tray without any window opening;
every menu item works; toggles persist across restarts.

### F2 — Summoning Elise
Three ways to summon:
1. Say **"Hey Elise"** (when wake-word listening is on).
2. The global hotkey **Ctrl+Alt+E** (configurable).
3. Tray → **Summon Elise**.

On summon:
1. The overlay eye **appears** in the bottom-right corner, above the taskbar, with the
   `appearing` animation.
2. A speech bubble next to it shows **"Hello Enigma, what is your command?"**. It is
   also spoken if voice responses are on.
3. A **text box** appears under the bubble, already focused, and the eye enters
   `listening`.
   - If summoned by voice, the mic records the command right away. Recording ends
     after ~1.2 s of silence, or when the user clicks the mic button.
   - If summoned by hotkey or tray, the user can type, or click 🎤 to speak.
   - **Esc**, or ~20 s of inactivity, dismisses her.
4. The eye enters `thinking`. The command goes to the command engine (F6).
5. On success, the bubble shows **"Understood."** (also spoken if enabled), with a
   one-line summary below it, e.g. *"Doctor appointment · Sat 5 Jul 22:00 · reminders
   3 Jul & 4 Jul"*.
6. After ~2.5 s the eye **vanishes**. If hover mode is on, it collapses back to the
   idle hover eye instead.
7. If the command is ambiguous, Elise asks **one** short follow-up question in the
   bubble, e.g. "Which one: dentist on 12 Oct or 19 Oct?", and waits for an answer by
   voice or text.

- The overlay is a separate **transparent, frameless, always-on-top, skip-taskbar**
  window. It does not steal focus from a game until the user interacts with it. Only
  the eye, bubble and text box take clicks. Everything else is click-through.
- It must show over **borderless-windowed and windowed games**.

**Accept when:** all three summon methods work; greeting, "Understood." and summary
appear; the eye vanishes by itself; Esc dismisses; it shows over a borderless game.

### F3 — Calendar window
- Frameless window with a custom dark title bar (min, max, close-to-tray) in the Elise
  palette.
- **Elise's eye sits at the top middle** of the window, idle-animating (blinks, looks
  around). **Clicking it** opens the same command text box and bubble as the overlay,
  anchored under the eye.
- **Views:** **Year** (12 mini-months), **Month** (default), **Week**, **Day**.
  - The user can navigate freely to **any year in the past or future**. Prev/next
    arrows, a "Today" button, and a jump-to-date picker (type a year or pick a date).
  - Today is marked with a red (`pupil`) ring or glow.
  - Events show as colored pills with their time. More than 3 in a month cell shows
    "+N more".
- **Manual editing:**
  - Click an empty day/slot to create an event. Click an event to open the **event
    editor** (a slide-in panel).
  - Editor fields: title, date, start/end time or all-day, location (optional), notes
    (optional), repeat (see F4), reminders (see F4), color (from a small palette
    built on purple/red).
  - Delete asks for confirmation.
  - Drag an event to another day or slot in Month/Week/Day view to move it.
- **Search** box: find events by title or notes across all time.
- **Animations:** view switches cross-fade and slide (~200 ms), month changes slide
  left/right, the editor panel slides in, and new events pop in softly. Nothing takes
  longer than ~300 ms.

**Accept when:** the user can jump to e.g. 1998 and 2040, create, edit, drag and
delete events by hand, and changes persist after a restart.

### F4 — Events, recurrence & reminders
- An event has: title, start, end (or all-day), location, notes, color, recurrence,
  and a list of reminders.
- **Recurrence:** none / daily / weekly (pick weekdays) / monthly / yearly, with an
  optional end date or count. Stored as an RRULE subset. Editing a recurring event
  asks: *this occurrence* / *this and following* / *all*.
- **Reminders:** each event can have **any number** of reminders. Each is either:
  - relative: *N minutes/hours/days/weeks before* (optionally at a fixed time of day,
    e.g. "2 days before at 09:00"), or
  - absolute: a specific date and time.
- **The example from the spec must work:** "remind me 2 days before, each of those two
  days" creates **two** reminders: 2 days before and 1 day before. The default time
  of day for day-based reminders is **09:00** (configurable).
- **Firing a reminder:**
  - The **eye appears** in the bottom-right with the reminder text in its bubble, e.g.
    "Reminder: Doctor appointment — Saturday 22:00 (in 2 days)". It is spoken too if
    voice responses are on.
  - Buttons: **Dismiss** and **Snooze** (10 min / 1 h / tomorrow).
  - It stays until dismissed, or auto-hides after 30 s and becomes a Windows toast so
    it isn't lost.
  - If the laptop was off or asleep when a reminder was due, it fires **on the next
    startup/wake** marked "(missed)", but only if the event hasn't passed by more than
    24 h.
- The reminder scheduler runs in the **Rust backend**. It sleeps until the next due
  reminder instead of polling constantly.

**Accept when:** a reminder set for 1 minute from now appears on time via the eye;
snooze works; a missed reminder appears after a restart.

### F5 — Hover-on-screen mode
- A tray toggle, also in Settings.
- When on, a **small idle eye** (~64 px) stays on screen permanently, starting in the
  bottom-right corner.
- It can be **dragged** anywhere, across monitors. Its position is remembered.
- **Click** → it opens the command bubble and text box (same flow as F2).
- **Right-click** → a mini menu: Open Calendar, Settings, Hide (turns hover mode off).
- A lower-opacity idle look, so it isn't distracting.

**Accept when:** the eye can be dragged and stays where dropped after a restart, and
clicking it takes a command.

### F6 — Command engine (natural language → calendar actions)
- **Input:** the command text (typed or transcribed), plus context: current local
  date/time, weekday, time zone, and a compact list of events relevant to the command
  (e.g. the next 60 days + keyword matches).
- **Model:** `claude-haiku-4-5`, called from the **Rust backend**, so the key
  never reaches the webview.
- **Tools** exposed to the model:
  - `create_event(title, start, end|all_day, location?, notes?, recurrence?, reminders[]?)`
  - `update_event(event_id, fields…)`: move, rename, change time, etc.
  - `delete_event(event_id, scope?)`
  - `set_reminders(event_id, reminders[])`: add, replace or remove reminders
  - `find_events(query?, from?, to?)`: for "what do I have on Friday?"
  - `ask_clarification(question)`: when truly ambiguous
- The model's final text is short. The UI always shows "Understood." plus a summary
  generated **from the actual changes made**, not the model's own words.
- **Queries** like "what do I have tomorrow?" answer in the bubble (and by voice)
  instead of saying "Understood.".
- **Must handle** (these become the test set):
  1. "Add an appointment to the doctor on July 5th 10pm, remind me 2 days before, each of those two days"
  2. "Move my dentist appointment to next Friday same time"
  3. "Push everything tomorrow one hour later"
  4. "Remind me every Monday at 8 to take out the trash"
  5. "Change the gym reminder to 30 minutes before"
  6. "Cancel the meeting on Thursday"
  7. "What do I have this weekend?"
  8. "Add Mom's birthday on March 3rd every year, remind me a week before"
- Dates without a year mean the **next** occurrence of that date.
- **Undo:** after any change, the bubble shows an **Undo** button for ~10 s. The last
  command's changes are also undoable from the calendar window.
- **Errors:**
  - No internet → "I can't reach my mind right now — try again or add it manually."
  - Missing or invalid key → "I need my API key — open Settings."
  - The model returns nothing usable → "I didn't catch that, say it differently?"

**Accept when:** all 8 test commands produce the correct calendar changes, and the
failure messages appear in the right situations.

### F7 — Voice input (offline)
- Uses the **current default Windows microphone**. It follows the device if the
  default changes.
- **Wake word:** the Vosk small English model (~40 MB) listens continuously **only
  when "Listen for 'Hey Elise'" is on**. Target idle CPU < 2 %. The word is detected
  locally and no audio leaves the laptop.
- **Command transcription:** faster-whisper `base.en`, loaded on first use and
  unloaded after 5 min idle to free RAM.
- Voice activity detection ends recording after ~1.2 s of silence (max 15 s).
- The transcribed text appears live in the text box so the user can see what was heard
  before it's processed.
- If the mic is unavailable → the eye says "I can't hear you — check your microphone,"
  and typing still works.

**Accept when:** "Hey Elise" from normal speaking distance summons her reliably (≥ 9/10
attempts in a quiet room); false triggers are rare (< 1 per hour of normal
background audio/gaming); the spoken test commands transcribe correctly.

### F8 — Voice output (optional)
- Speaks the greeting, "Understood.", answers to queries, clarification questions and
  reminders.
- **Default: on.** Toggle in the tray and Settings. The voice and speech rate can be
  chosen in Settings from the installed Windows voices.
- The whole feature can be removed later without affecting anything else. It is kept
  behind a single `speak()` function.

### F9 — Settings screen
Opened from the tray or from a gear icon in the calendar window.
- **Claude API key:** a masked input, **Save** (to Windows Credential Manager), and
  **Test** (makes one tiny call and shows ✓/✗).
- Wake word on/off. Mic device shown (the default is used).
- Voice responses on/off, voice picker, rate.
- Summon hotkey.
- Hover mode on/off, "Reset eye position".
- Start with Windows on/off.
- Default reminder time of day (09:00), default event length (1 h).
- Week starts on: Monday (default) / Sunday. Time format: 24 h (default) / 12 h.
- The name Elise calls the user: **"Enigma"** (editable).

### F10 — Performance budget
| Metric | Target |
|---|---|
| Idle RAM (app + sidecar, wake word on, whisper unloaded) | ≤ 200 MB |
| Idle CPU (wake word on) | ≤ 2 % average |
| Idle CPU (wake word off, no windows visible) | ~0 % |
| Summon → eye visible | ≤ 300 ms (hotkey/tray), ≤ 800 ms (voice) |
| Command → "Understood." (typed) | ≤ 3 s typical |

- Hidden windows don't render. Animations only run while visible.
- No continuous polling: the scheduler uses timers and the audio loop blocks on the
  mic stream.

---

## 5. Data model

```text
events
  id            TEXT PK (uuid)
  title         TEXT NOT NULL
  start         TEXT                -- local wall-clock time (see §11 note)
  end           TEXT NULL
  all_day       INTEGER (0/1)
  location      TEXT NULL
  notes         TEXT NULL
  color         TEXT NULL
  rrule         TEXT NULL           -- RRULE subset
  exdates       TEXT NULL (JSON)    -- skipped occurrences
  parent_id     TEXT NULL           -- overridden occurrence of a recurring event
  created_at, updated_at

reminders
  id            TEXT PK
  event_id      TEXT FK -> events.id (cascade)
  kind          TEXT  -- 'relative' | 'absolute'
  offset_min    INTEGER NULL        -- minutes before start (relative)
  at_time       TEXT NULL           -- 'HH:MM' fixed time of day (relative, day-based)
  at_utc        TEXT NULL           -- absolute
  
reminder_log                        -- fired/dismissed/snoozed per occurrence
  reminder_id, occurrence_start_utc, status, snooze_until_utc

command_history                     -- for undo + debugging
  id, text, created_at, changes_json (before/after snapshots)
```

---

## 6. Architecture

```text
┌──────────────────────── Tauri app (Rust) ────────────────────────┐
│ tray · autostart · hotkey · single-instance                      │
│ db (SQLite) · reminder scheduler · command engine (Claude API)   │
│ keyring (API key) · settings                                     │
│        ▲ Tauri commands/events           ▲ stdin/stdout JSON     │
│        │                                 │                       │
│  ┌─────┴─────────────┐          ┌────────┴──────────────┐        │
│  │ WebView windows    │          │ elise-voice (Python)  │        │
│  │ • calendar (main)  │          │ • mic capture         │        │
│  │ • overlay (eye)    │          │ • Vosk wake word      │        │
│  │ • settings         │          │ • VAD + faster-whisper│        │
│  │ React + TS + Vite  │          └───────────────────────┘        │
│  └────────────────────┘                                          │
└──────────────────────────────────────────────────────────────────┘
```

Sidecar protocol (JSON lines), for example:
`→ {"cmd":"set_wake","on":true}` · `← {"evt":"wake"}` · `← {"evt":"level","v":0.42}` ·
`← {"evt":"partial","text":"add an appoint"}` · `← {"evt":"final","text":"…"}` ·
`← {"evt":"error","msg":"no_mic"}`

Repo layout:
```text
Elise/
  docs/PRD.md
  src/                 React frontend (components/Eye.tsx, views/, overlay/, settings/)
  src-tauri/           Rust backend (db.rs, scheduler.rs, commands.rs, llm.rs, voice.rs, tray.rs)
  voice/               Python sidecar (elise_voice.py, requirements.txt, build script)
  scripts/             icon generation from Eye SVG
  CLAUDE.md            dev notes for future sessions
```

---

## 7. Build order (milestones)

Each milestone ends with a verification step before the next one starts.

| # | Milestone | Done when |
|---|---|---|
| **M0** | Scaffold Tauri 2 + React + TS + Vite. Git init. Tray icon + menu, single instance, autostart (`--hidden`), close-to-tray. `CLAUDE.md`. | `npm run tauri dev` runs, tray works, `cargo check` + `tsc --noEmit` clean |
| **M1** | **Eye** SVG component with all states + palette/theme + app/tray icons generated from it | Eye visibly animates through every state in a dev preview page |
| **M2** | SQLite layer + event/reminder CRUD commands + recurrence expansion | Rust unit tests for CRUD, recurrence and reminder time computation pass |
| **M3** | Calendar window: Year/Month/Week/Day views, navigation to any year, event editor, drag-to-move, search, overseeing eye at top | Manual create/edit/move/delete works and persists |
| **M4** | Reminder scheduler + reminder overlay (eye + text + Dismiss/Snooze) + toast fallback + missed reminders | A reminder 1 min out fires via the eye; snooze and missed-on-restart work |
| **M5** | Overlay window + summon flow (tray, hotkey, click eye in calendar) with **typed** input; hover mode with drag | Summon → greet → type → (stubbed) "Understood." → vanish, all smooth |
| **M6** | Settings screen + API key in Credential Manager + **Claude command engine** with tools, clarification, undo | All 8 test commands in F6 produce correct changes |
| **M7** | Voice output (`speechSynthesis`) behind the toggle | Greeting/"Understood."/reminders spoken when on, silent when off |
| **M8** | Python voice sidecar: wake word + VAD + whisper, packaged with PyInstaller, wired into the summon flow | "Hey Elise" → speak command → correct event created |
| **M9** | Polish (animation timing, glow tuning), performance check against F10, NSIS installer build | Installer installs, app autostarts after reboot, budgets met |

**Session note:** M0–M7 are realistic for one long session. M8 (the voice sidecar:
model downloads, packaging) is the riskiest part and may spill into a second session.
Because this PRD lists what's done and what isn't, the next session can resume at the
exact milestone.

---

## 8. What the user needs to provide
- **Claude API key.** Enter it in Elise → Settings → API key during M6. **Do not paste
  it in chat.**
- Test the voice features with the laptop mic when M8 is ready. Wake-word accuracy
  depends on the real environment.

---

## 9. Decisions made on the user's behalf (veto any)
1. **Tauri** over Electron (performance).
2. Hotkey **Ctrl+Alt+E** as an extra summon method (useful mid-game).
3. A one-line **summary under "Understood."** so mistakes are visible immediately,
   plus an **Undo** button.
4. **Week view** included alongside Year/Month/Day.
5. **Recurring events** and **drag-to-move** included.
6. Default reminder time **09:00**, 24 h clock, week starts Monday.
7. Missed reminders fire on the next startup (within 24 h).
8. Reminders become a Windows toast if not dismissed within 30 s.
9. Vosk for the wake word (no key). It could be swapped for Porcupine later if
   accuracy isn't good enough (that needs a free Picovoice key).

## 10. Future ideas (not v1)
- Phone sync or Google Calendar import.
- Turkish language.
- Daily morning briefing ("Good morning Enigma, today you have…").
- Custom-trained "Hey Elise" wake-word model for better accuracy.

---

## 11. Build progress & implementation notes

| # | Milestone | Status |
|---|---|---|
| M0 | Scaffold, tray, single instance, autostart, close-to-tray | ✅ done |
| M1 | Eye component + palette + icons | ✅ done (`src/components/Eye.tsx`, `scripts/make-icons.mjs`) |
| M2 | SQLite + CRUD + recurrence | ✅ done, unit-tested |
| M3 | Calendar views, editor, drag-to-move, search, jump to any year | ✅ done, verified in the running app |
| M4 | Reminder scheduler + overlay + snooze + toast fallback + missed | ✅ done, verified (reminder fired on time, snooze works) |
| M5 | Overlay summon (tray/hotkey/eye click), typed input, hover mode + drag | ✅ done, verified |
| M6 | Settings + API key (Credential Manager) + Claude command engine | ✅ built; tool execution unit-tested; **live test needs the API key** |
| M7 | Voice output behind toggle | ✅ built (`src/lib/speech.ts`) |
| M8 | Voice sidecar: wake word + Whisper | ✅ code complete & wired in; **engine install pending** (slow network — run `voice\setup.ps1`) |
| M9 | Polish, perf check, installer | ✅ idle CPU ≈ 0 %, NSIS installer built |

Implementation notes (decisions made while building):
- **Times are stored as local wall-clock time**, not UTC. A 09:00 event stays at 09:00 across DST
  changes and repeating events don't drift. Fine for a single-laptop calendar.
- Recurrence is stored as a small JSON rule (`freq/interval/byWeekday/until/count`), not an RRULE string.
  Months without the start day (e.g. the 31st) are skipped, like Google Calendar.
- Reminders created after their fire time never fire retroactively (no instant "missed" popups
  when adding an event for tomorrow with a 2-day reminder).
- The spoken greeting finishes **before** the mic starts recording, so Elise never hears herself.
- **Performance (measured):** idle CPU ≈ 0 % with the calendar in the tray (hidden webviews are
  suspended / set to low-memory). Memory is ~300 MB private, almost all of it the WebView2 runtime
  itself; the original ≤ 200 MB target was not realistic for a WebView2 app. The Python voice
  engine adds ~60 MB with the wake word on, plus ~150 MB for Whisper only while transcribing
  (unloaded after 5 idle minutes).
- **Voice engine location:** it runs from `voice\.venv` inside the project folder (no separate
  packaging), so keep the Elise folder where it is. `voice\setup.ps1` installs it and pre-downloads
  both models. Until it's installed, the mic button is hidden and typing works as normal.
- Esc could not be tested automatically (the test tool reserves that key); it's wired in the
  overlay, the editor and all dialogs.
