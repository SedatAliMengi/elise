"""Merge Elise data from Desktop\\Elise\\transfer into the real %APPDATA% folder.

Run by install-elise.bat (outside Claude, so it writes to the real AppData).
Never deletes or overwrites existing events: it only adds the missing ones.
Exit code 0 = success (the bat then removes the transfer folder).
"""

import json
import os
import shutil
import sqlite3
import sys

here = os.path.dirname(os.path.abspath(__file__))
src_dir = os.path.join(here, "..", "transfer", "com.enigma.elise")
dst_dir = os.path.join(os.environ["APPDATA"], "com.enigma.elise")

if not os.path.isdir(src_dir):
    print("   Nothing to restore.")
    sys.exit(0)
os.makedirs(dst_dir, exist_ok=True)

# 1) Calendar: add events/reminders that aren't there yet.
src_db = os.path.join(src_dir, "elise.db")
dst_db = os.path.join(dst_dir, "elise.db")
if os.path.exists(src_db):
    if not os.path.exists(dst_db):
        shutil.copy2(src_db, dst_db)
        print("   Calendar restored.")
    else:
        con = sqlite3.connect(dst_db)
        con.execute("ATTACH DATABASE ? AS src", (src_db,))
        before = con.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        for table in ("events", "reminders", "reminder_log", "command_history"):
            try:
                con.execute(f"INSERT OR IGNORE INTO main.{table} SELECT * FROM src.{table}")
            except sqlite3.Error as e:
                print(f"   (skipped {table}: {e})")
        con.commit()
        after = con.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        con.close()
        print(f"   Calendar merged: {after - before} event(s) restored, {after} total.")

# 2) Settings: the new install only has defaults, so bring yours back.
src_set = os.path.join(src_dir, "settings.json")
if os.path.exists(src_set):
    with open(src_set, encoding="utf-8") as f:
        json.load(f)  # sanity check
    shutil.copy2(src_set, os.path.join(dst_dir, "settings.json"))
    print("   Settings restored.")

# 3) Voice models: copy whatever is missing.
src_models = os.path.join(src_dir, "models")
if os.path.isdir(src_models):
    shutil.copytree(src_models, os.path.join(dst_dir, "models"), dirs_exist_ok=True)
    print("   Voice models restored.")

sys.exit(0)
