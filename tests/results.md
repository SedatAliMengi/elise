# Command accuracy

Model: `claude-haiku-4-5` · 104 commands · run 2026-10-01 · fixed "now": Thursday 2026-10-01 10:00 · median latency 2.1 s

| Test set | Commands | Accuracy |
|---|---:|---:|
| **All** | 104 | **97%** |
| English | 58 | 97% |
| Turkish | 46 | 98% |
| Unclear (should ask) | 6 | 100% |
| Simple adds | 20 | 100% |
| Cancels | 11 | 91% |
| Moves & edits | 18 | 94% |
| Questions | 9 | 100% |
| Repeating events | 8 | 100% |
| Relative dates | 22 | 95% |
| Reminders | 10 | 100% |

A command passes only if the calendar ends up exactly right: correct event, date, time, length, repeat rule and reminders, and nothing else touched. Questions must not change anything; unclear commands pass if Elise asks back (or does nothing) instead of guessing.

## Failures

| # | Command | Expected | What happened |
|---|---|---|---|
| 24 | Dentist checkup the day after tomorrow at 11am | nothing was created | asked: Do you want to add a new dentist checkup on Saturday at 11am, or move the existing Friday 3pm dentist appointment to Saturday 11am? |
| 75 | Matematik sınavını 16 Ekim'e taşı | start 2026-10-14T10:00 not in ["2026-10-16T10:00"] | asked: Matematik sınavını 16 Ekim'e taşırken, saat 10:00'da mı kalacak yoksa başka bir saatte mi olacak? |
| 79 | Cancel tomorrow's meeting | not deleted: ["project"] | asked: Which meeting tomorrow—Project meeting at 11:00 or Dentist at 15:00? |

Regenerate: `python tests/make_commands.py` then `cd src-tauri && cargo test accuracy -- --ignored --nocapture`.
