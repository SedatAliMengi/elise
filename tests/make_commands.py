"""Generates tests/commands.json: the accuracy test set for Elise's command engine.

Every case runs against the same seed calendar with "now" fixed to
Thursday 2026-10-01 10:00, so relative dates have exactly one right answer
(or an explicit list of acceptable ones where people genuinely disagree,
e.g. "next Wednesday").

    python tests/make_commands.py
"""

import json
import os

NOW = "2026-10-01T10:00:00"  # Thursday

SEED = [
    {"id": "lunch", "title": "Lunch with Ali", "start": "2026-10-01T13:00:00", "end": "2026-10-01T14:00:00"},
    {"id": "call", "title": "Call with mom", "start": "2026-10-01T15:00:00", "end": "2026-10-01T15:30:00"},
    {"id": "project", "title": "Project meeting", "start": "2026-10-02T11:00:00", "end": "2026-10-02T12:00:00"},
    {"id": "dentist", "title": "Dentist", "start": "2026-10-02T15:00:00", "end": "2026-10-02T16:00:00"},
    {"id": "standup", "title": "Team standup", "start": "2026-10-05T09:00:00", "end": "2026-10-05T09:15:00",
     "recurrence": {"freq": "weekly", "interval": 1, "byWeekday": [0]}},
    {"id": "gym", "title": "Gym", "start": "2026-10-06T18:00:00", "end": "2026-10-06T19:00:00",
     "reminders": [{"offsetMin": 60}]},
    {"id": "exam", "title": "Math exam", "start": "2026-10-14T10:00:00", "end": "2026-10-14T12:00:00"},
    {"id": "bday", "title": "Ayşe's birthday", "start": "2026-10-20T00:00:00", "allDay": True,
     "recurrence": {"freq": "yearly", "interval": 1}},
]

cases = []


def add(cat, lang, text, **expect):
    cases.append({"id": len(cases) + 1, "category": cat, "lang": lang, "text": text, "expect": expect})


def create(cat, lang, text, title, start, **kw):
    add(cat, lang, text, action="create", title_any=title, start=start, **kw)


# ---------- simple creates ----------
create("create", "en", "Add a meeting tomorrow at 3pm", ["meeting"], "2026-10-02T15:00")
create("create", "en", "Meeting tomorrow at 3", ["meeting"], "2026-10-02T15:00")
create("create", "en", "Schedule dinner with Sarah on Saturday at 8pm", ["dinner"], "2026-10-03T20:00")
create("create", "en", "Add doctor appointment on October 7th at 10:30", ["doctor"], "2026-10-07T10:30")
create("create", "en", "Put a haircut on the 9th at 2pm", ["hair"], "2026-10-09T14:00")
create("create", "en", "Add coffee with Mark today at 4pm", ["coffee"], "2026-10-01T16:00")
create("create", "en", "Book a car service on Monday at 9am", ["car", "service"], "2026-10-05T09:00")
create("create", "en", "Add 'Pay rent' on October 28th", ["rent"], "2026-10-28", all_day=True)
create("create", "en", "Create an event called Movie night on Friday at 9pm", ["movie"], "2026-10-02T21:00")
create("create", "en", "Add a 2 hour study session tomorrow at 10am", ["study"], "2026-10-02T10:00", end="2026-10-02T12:00")
create("create", "tr", "Yarın saat 3'te toplantı ekle", ["toplantı", "meeting"], "2026-10-02T15:00")
create("create", "tr", "Yarın öğleden sonra 3'te toplantı", ["toplantı", "meeting"], "2026-10-02T15:00")
create("create", "tr", "Cumartesi akşam 8'de Selin ile yemek", ["yemek", "dinner"], "2026-10-03T20:00")
create("create", "tr", "7 Ekim saat 10:30'da doktor randevusu ekle", ["doktor", "doctor"], "2026-10-07T10:30")
create("create", "tr", "Bugün saat 16:00'da kahve", ["kahve", "coffee"], "2026-10-01T16:00")
create("create", "tr", "Pazartesi sabah 9'da araba servisi", ["servis", "service", "araba", "car"], "2026-10-05T09:00")
create("create", "tr", "28 Ekim'e kira ödemesi ekle", ["kira", "rent"], "2026-10-28", all_day=True)
create("create", "tr", "Cuma akşam 9'da film gecesi", ["film", "movie"], "2026-10-02T21:00")
create("create", "tr", "Yarın sabah 10'da 2 saatlik ders çalışma", ["ders", "çalış", "study"], "2026-10-02T10:00", end="2026-10-02T12:00")
create("create", "tr", "Ayın 9'unda saat 14:00'te kuaför", ["kuaför", "hair"], "2026-10-09T14:00")

# ---------- relative dates ----------
create("relative", "en", "Add gym session in 2 weeks at 6pm", ["gym"], "2026-10-15T18:00")
create("relative", "en", "Remind me to call the bank in 3 days at noon", ["bank"], "2026-10-04T12:00")
create("relative", "en", "Add a team lunch next Wednesday at 12:30", ["lunch"], ["2026-10-07T12:30", "2026-10-14T12:30"])
create("relative", "en", "Dentist checkup the day after tomorrow at 11am", ["dentist", "checkup"], "2026-10-03T11:00")
create("relative", "en", "Add a call with Tom this Saturday at 5pm", ["call", "tom"], "2026-10-03T17:00")
create("relative", "en", "Plan a trip on the first of next month", ["trip"], "2026-11-01", all_day=True)
create("relative", "en", "Add interview a week from today at 2pm", ["interview"], "2026-10-08T14:00")
create("relative", "en", "Add parent-teacher meeting on the last Friday of October at 4pm", ["parent", "teacher", "meeting"], "2026-10-30T16:00")
create("relative", "en", "Add yoga in 10 days at 7am", ["yoga"], "2026-10-11T07:00")
create("relative", "en", "Add a review meeting next Monday at 10", ["review"], ["2026-10-05T10:00", "2026-10-12T10:00"])
create("relative", "en", "Concert on New Year's Eve at 9pm", ["concert"], "2026-12-31T21:00")
create("relative", "en", "Add a vet appointment the Tuesday after next at 3pm", ["vet"], "2026-10-13T15:00")
create("relative", "tr", "2 hafta sonra saat 18:00'de spor", ["spor", "gym", "sport"], "2026-10-15T18:00")
create("relative", "tr", "3 gün sonra öğlen bankayı ara", ["banka", "bank"], "2026-10-04T12:00")
create("relative", "tr", "Haftaya çarşamba 12:30'da öğle yemeği", ["yeme", "lunch"], ["2026-10-07T12:30", "2026-10-14T12:30"])
create("relative", "tr", "Öbür gün saat 11'de diş kontrolü", ["diş", "dentist", "kontrol", "checkup"], "2026-10-03T11:00")
create("relative", "tr", "Bu cumartesi saat 17:00'de Tom ile görüşme", ["görüşme", "tom", "call", "meeting"], "2026-10-03T17:00")
create("relative", "tr", "Gelecek ayın birinde tatil", ["tatil", "trip", "vacation", "holiday"], "2026-11-01", all_day=True)
create("relative", "tr", "Bir hafta sonra saat 14:00'te mülakat", ["mülakat", "interview"], "2026-10-08T14:00")
create("relative", "tr", "10 gün sonra sabah 7'de yoga", ["yoga"], "2026-10-11T07:00")
create("relative", "tr", "Yılbaşı gecesi saat 21:00'de konser", ["konser", "concert"], "2026-12-31T21:00")
create("relative", "tr", "Önümüzdeki pazartesi saat 10'da değerlendirme toplantısı", ["değerlendirme", "toplantı", "review", "meeting"], ["2026-10-05T10:00", "2026-10-12T10:00"])

# ---------- reminders ----------
create("reminders", "en", "Add a flight on October 10th at 6am and remind me the day before", ["flight"], "2026-10-10T06:00", reminders=[1440])
create("reminders", "en", "Doctor appointment on July 5th at 10pm, remind me 2 days before, each of those two days", ["doctor"], "2027-07-05T22:00", reminders=[1440, 2880])
create("reminders", "en", "Add a webinar tomorrow at 1pm and remind me 30 minutes before", ["webinar"], "2026-10-02T13:00", reminders=[30])
create("reminders", "en", "Add Mom's birthday on March 3rd every year, remind me a week before", ["birthday"], "2027-03-03", all_day=True, freq="yearly", reminders=[10080])
add("reminders", "en", "Change the gym reminder to 30 minutes before", action="update", target="gym", reminders=[30])
add("reminders", "en", "Remind me about the math exam 2 days before", action="update", target="exam", reminders=[2880])
create("reminders", "tr", "10 Ekim sabah 6'da uçuş ekle, bir gün önce hatırlat", ["uçuş", "flight"], "2026-10-10T06:00", reminders=[1440])
create("reminders", "tr", "Yarın saat 13:00'te webinar, 30 dakika önce hatırlat", ["webinar"], "2026-10-02T13:00", reminders=[30])
add("reminders", "tr", "Spor hatırlatmasını 2 saat önceye al", action="update", target="gym", reminders=[120])
add("reminders", "tr", "Matematik sınavından 1 gün önce hatırlat", action="update", target="exam", reminders=[1440])

# ---------- recurring ----------
create("recurring", "en", "Remind me every Monday at 8 to take out the trash", ["trash"], "2026-10-05T08:00", freq="weekly")
create("recurring", "en", "Add piano lessons every Wednesday at 5pm", ["piano"], "2026-10-07T17:00", freq="weekly")
create("recurring", "en", "Add a daily standup at 9:30 starting tomorrow", ["standup"], "2026-10-02T09:30", freq="daily")
create("recurring", "en", "Pay bills on the 1st of every month", ["bill"], ["2026-10-01", "2026-11-01"], freq="monthly")
create("recurring", "en", "Add Dad's birthday on December 12 every year", ["birthday"], "2026-12-12", freq="yearly")
create("recurring", "tr", "Her pazartesi saat 8'de çöpü çıkar", ["çöp", "trash", "garbage"], "2026-10-05T08:00", freq="weekly")
create("recurring", "tr", "Her çarşamba saat 17:00'de piyano dersi", ["piyano", "piano"], "2026-10-07T17:00", freq="weekly")
create("recurring", "tr", "Her ayın 1'inde faturaları öde", ["fatura", "bill"], ["2026-10-01", "2026-11-01"], freq="monthly")

# ---------- edits ----------
def edit(lang, text, target, **kw):
    add("edit", lang, text, action="update", target=target, **kw)


edit("en", "Move my 3pm to 5", "call", start="2026-10-01T17:00")
edit("en", "Move the dentist to Monday same time", "dentist", start="2026-10-05T15:00")
edit("en", "Push the project meeting one hour later", "project", start="2026-10-02T12:00")
edit("en", "Reschedule lunch with Ali to 1:30", "lunch", start="2026-10-01T13:30")
edit("en", "Move the math exam to October 16th", "exam", start="2026-10-16T10:00")
edit("en", "Rename the dentist appointment to Orthodontist", "dentist", title_any=["orthodont"], start="2026-10-02T15:00")
edit("en", "Change the gym on Tuesday to 7pm", "gym", start="2026-10-06T19:00")
edit("en", "Postpone the call with mom to tomorrow at the same time", "call", start="2026-10-02T15:00")
edit("en", "Make the project meeting 2 hours long", "project", start="2026-10-02T11:00", end="2026-10-02T13:00")
edit("en", "Move tomorrow's dentist appointment 30 minutes earlier", "dentist", start="2026-10-02T14:30")
edit("tr", "Saat 3'teki görüşmemi 5'e al", "call", start="2026-10-01T17:00")
edit("tr", "Dişçiyi pazartesiye aynı saate taşı", "dentist", start="2026-10-05T15:00")
edit("tr", "Proje toplantısını bir saat ertele", "project", start="2026-10-02T12:00")
edit("tr", "Ali ile öğle yemeğini 13:30'a al", "lunch", start="2026-10-01T13:30")
edit("tr", "Matematik sınavını 16 Ekim'e taşı", "exam", start="2026-10-16T10:00")
edit("tr", "Salı günkü sporu akşam 7'ye al", "gym", start="2026-10-06T19:00")
edit("tr", "Annemle görüşmeyi yarın aynı saate ertele", "call", start="2026-10-02T15:00")
edit("tr", "Yarınki dişçi randevusunu yarım saat öne çek", "dentist", start="2026-10-02T14:30")

# ---------- deletes ----------
add("delete", "en", "Cancel tomorrow's meeting", action="delete", targets=["project"])
add("delete", "en", "Delete the gym session", action="delete", targets=["gym"])
add("delete", "en", "Cancel lunch with Ali", action="delete", targets=["lunch"])
add("delete", "en", "Remove the math exam from my calendar", action="delete", targets=["exam"])
add("delete", "en", "Skip this Monday's team standup", action="skip_occurrence", target="standup", date="2026-10-05")
add("delete", "en", "Cancel all my events tomorrow", action="delete", targets=["project", "dentist"])
add("delete", "tr", "Yarınki toplantıyı iptal et", action="delete", targets=["project"])
add("delete", "tr", "Spor seansını sil", action="delete", targets=["gym"])
add("delete", "tr", "Ali ile öğle yemeğini iptal et", action="delete", targets=["lunch"])
add("delete", "tr", "Matematik sınavını takvimden kaldır", action="delete", targets=["exam"])
add("delete", "tr", "Bu pazartesiki standup'ı atla", action="skip_occurrence", target="standup", date="2026-10-05")

# ---------- questions (must not change anything) ----------
add("query", "en", "What do I have tomorrow?", action="none", answer_any=["dentist", "project"])
add("query", "en", "When is my dentist appointment?", action="none", answer_any=["friday", "tomorrow", "october 2", "oct 2", "3 pm", "3pm", "15:00"])
add("query", "en", "What's on my calendar this weekend?", action="none")
add("query", "en", "When is Ayşe's birthday?", action="none", answer_any=["20"])
add("query", "en", "Do I have anything on Tuesday?", action="none", answer_any=["gym"])
add("query", "tr", "Yarın neyim var?", action="none", answer_any=["dişçi", "dentist", "proje", "project"])
add("query", "tr", "Dişçi randevum ne zaman?", action="none", answer_any=["cuma", "friday", "yarın", "tomorrow", "2 ekim", "15:00", "3 pm"])
add("query", "tr", "Bu hafta sonu bir planım var mı?", action="none")
add("query", "tr", "Ayşe'nin doğum günü ne zaman?", action="none", answer_any=["20"])

# ---------- unclear: asking back (or doing nothing) is the right answer ----------
add("ambiguous", "en", "Set something for later", action="clarify_or_none")
add("ambiguous", "en", "Move my meeting", action="clarify_or_none")
add("ambiguous", "en", "Add an appointment", action="clarify_or_none")
add("ambiguous", "en", "Cancel it", action="clarify_or_none")
add("ambiguous", "tr", "Sonrası için bir şey ayarla", action="clarify_or_none")
add("ambiguous", "tr", "Toplantımı taşı", action="clarify_or_none")

out = {"now": NOW, "seed": SEED, "cases": cases}
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "commands.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
by_lang = {l: sum(c["lang"] == l for c in cases) for l in ("en", "tr")}
print(f"wrote {len(cases)} cases to {path} ({by_lang})")
