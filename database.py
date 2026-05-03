import os
import sqlite3
import logging
import pendulum
import time
from threading import Lock
from config import GERMANY_TZ

if not os.path.exists("data"):
    os.makedirs("data")

DB_PATH = "data/energy.db"
db_lock = Lock()


def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=20.0)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db_lock, get_db() as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")

        conn.execute(
            """CREATE TABLE IF NOT EXISTS work_prices (timestamp TEXT PRIMARY KEY, price REAL)"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS spot_prices (timestamp TEXT PRIMARY KEY, price REAL)"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS consumption (timestamp TEXT PRIMARY KEY, usage REAL)"""
        )

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_work_ts ON work_prices(timestamp)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_spot_ts ON spot_prices(timestamp)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cons_ts ON consumption(timestamp)"
        )

        conn.commit()


init_db()


def backup_db(force=False):
    """
    Creates a defragmented backup using SQLite's VACUUM INTO.
    Enforces a strict 24-hour limit unless 'force' is True.
    """
    with db_lock:
        if not os.path.exists(DB_PATH):
            return

        # 1. Enforce the 24-Hour Rule
        backups = sorted([
            b for b in os.listdir("data") 
            if b.startswith("energy.db") and b.endswith(".bak")
        ])
        
        if backups and not force:
            latest_backup = os.path.join("data", backups[-1])
            file_age_seconds = time.time() - os.path.getmtime(latest_backup)
            
            if file_age_seconds < 86400:  # 24 hours
                logging.info("Latest backup is under 24 hours old. Skipping VACUUM INTO.")
                return

        # 2. Perform the VACUUM INTO Backup
        ts = pendulum.now(GERMANY_TZ).format("YYYYMMDD_HHmmss")
        bak_file = f"energy.db.{ts}.bak"
        target_path = os.path.join("data", bak_file)

        try:
            with get_db() as conn:
                # This executes the native SQLite command
                conn.execute(f"VACUUM INTO '{target_path}'")
            logging.info(f"Database backed up and optimized: {bak_file}")
            
        except sqlite3.Error as e:
            logging.error(f"VACUUM INTO failed: {e}")
            return

        # 3. Rotate Old Backups (Keep only 5)
        # Re-fetch the list to include the newly created file
        all_backups = sorted([
            b for b in os.listdir("data") 
            if b.startswith("energy.db") and b.endswith(".bak")
        ])
        
        for old in all_backups[:-5]:
            try:
                os.remove(os.path.join("data", old))
                logging.info(f"Cleaned up old backup: {old}")
            except Exception as e:
                logging.warning(f"Failed to clean old backup {old}: {e}")


def fetch_all(query, params=()):
    with get_db() as conn:
        return conn.execute(query, params).fetchall()


def fetch_one(query, params=()):
    with get_db() as conn:
        return conn.execute(query, params).fetchone()


def bulk_insert(table, data_tuples):
    if not data_tuples:
        return 0
    val_col = "usage" if table == "consumption" else "price"
    query = (
        f"INSERT OR REPLACE INTO {table} (timestamp, {val_col}) VALUES (?, ?)"
    )

    with db_lock, get_db() as conn:
        count_before = conn.execute(
            f"SELECT COUNT(*) FROM {table}"
        ).fetchone()[0]
        conn.executemany(query, data_tuples)
        conn.commit()
        return (
            conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            - count_before
        )
