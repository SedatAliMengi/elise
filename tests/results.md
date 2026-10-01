# Command accuracy

Model: `claude-haiku-4-5` · 104 commands · run 2026-10-01 · fixed "now": Thursday 2026-10-01 10:00 · median latency 2.5 s

| Test set | Commands | Accuracy |
|---|---:|---:|
| **All** | 104 | **97%** |
| English | 58 | 98% |
| Turkish | 46 | 96% |
| Unclear (should ask) | 6 | 100% |
| Simple adds | 20 | 95% |
| Cancels | 11 | 91% |
| Moves & edits | 18 | 94% |
| Questions | 9 | 100% |
| Repeating events | 8 | 100% |
| Relative dates | 22 | 100% |
| Reminders | 10 | 100% |

A command passes only if the calendar ends up exactly right: correct event, date, time, length, repeat rule and reminders, and nothing else touched. Questions must not change anything; unclear commands pass if Elise asks back (or does nothing) instead of guessing.

## Failures

| # | Command | Expected | What happened |
|---|---|---|---|
| 20 | Ayın 9'unda saat 14:00'te kuaför | start 2026-11-09T14:00 not in ["2026-10-09T14:00"] | Added: kuaför · Mon 9 Nov 2026 14:00 |
| 75 | Matematik sınavını 16 Ekim'e taşı | start 2026-10-14T10:00 not in ["2026-10-16T10:00"] | answered: I need to clarify: do you want to move the math exam to October 16th at the same time (10:00 AM), or at a different time? |
| 79 | Cancel tomorrow's meeting | not deleted: ["project"] | asked: Which event tomorrow should I cancel: Project meeting at 11 AM or Dentist at 3 PM? |

Regenerate: `python tests/make_commands.py` then `cd src-tauri && cargo test accuracy -- --ignored --nocapture`.
