# Command accuracy (baseline)

> **Baseline, before the prompt and context fixes.** One failure here (#35, "öğle yemeği") was a grading mistake: the check looked for "yemek", but Turkish softens it to "yemeği". With that corrected, the baseline is 94/104 = **90%**.

Model: `claude-haiku-4-5` · 104 commands · run 2026-10-01 · fixed "now": Thursday 2026-10-01 10:00 · median latency 2.1 s

| Test set | Commands | Accuracy |
|---|---:|---:|
| **All** | 104 | **89%** |
| English | 58 | 95% |
| Turkish | 46 | 83% |
| Unclear (should ask) | 6 | 100% |
| Simple adds | 20 | 85% |
| Cancels | 11 | 91% |
| Moves & edits | 18 | 89% |
| Questions | 9 | 89% |
| Repeating events | 8 | 100% |
| Relative dates | 22 | 82% |
| Reminders | 10 | 100% |

A command passes only if the calendar ends up exactly right: correct event, date, time, length, repeat rule and reminders, and nothing else touched. Questions must not change anything; unclear commands pass if Elise asks back (or does nothing) instead of guessing.

## Failures

| # | Command | Expected | What happened |
|---|---|---|---|
| 2 | Meeting tomorrow at 3 | nothing was created | answered: I need to clarify: is this a new meeting you want me to add to your calendar, or are you asking about an existing event? If it's new, what's the meeti |
| 17 | 28 Ekim'e kira ödemesi ekle | nothing was created | answered: I need to clarify the time for the rent payment on October 28th. What time should I schedule it for? |
| 18 | Cuma akşam 9'da film gecesi | nothing was created | asked: Which Friday do you mean—October 2nd or a later date? |
| 24 | Dentist checkup the day after tomorrow at 11am | also deleted [] / changed ["dentist"] | Updated: Dentist · Sat 3 Oct 2026 11:00 |
| 35 | Haftaya çarşamba 12:30'da öğle yemeği | title "Öğle yemeği" lacks any of ["yemek", "lunch"] | Added: Öğle yemeği · Wed 7 Oct 2026 12:30 |
| 36 | Öbür gün saat 11'de diş kontrolü | nothing was created | answered: I need to clarify which day you mean by "öbür gün" (the other day). Do you mean tomorrow (Friday, October 2nd)? |
| 38 | Gelecek ayın birinde tatil | nothing was created | asked: Do you mean November 1st, 2026 (next month) or October 1st, 2027 (next year)? |
| 76 | Salı günkü sporu akşam 7'ye al | start 2026-10-06T18:00 not in ["2026-10-06T19:00"] | asked: Do you want to move the existing gym event to Tuesday at 7 PM, or add a new gym session on Tuesday at 7 PM? |
| 77 | Annemle görüşmeyi yarın aynı saate ertele | start 2026-10-01T15:00 not in ["2026-10-02T15:00"] | asked: Move "Call with mom" from today 3pm to tomorrow at 3pm? |
| 85 | Yarınki toplantıyı iptal et | not deleted: ["project"] | asked: Which meeting tomorrow would you like to cancel: Project meeting at 11:00 or Dentist at 15:00? |
| 94 | Do I have anything on Tuesday? | answer lacks any of ["gym"] | answered: You have a project meeting at 11am and a dentist appointment at 3pm on Tuesday. |

Regenerate: `python tests/make_commands.py` then `cd src-tauri && cargo test accuracy -- --ignored --nocapture`.
