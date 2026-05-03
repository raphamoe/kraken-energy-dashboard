import logging
import pendulum
from config import GERMANY_TZ

def normalize_ts(raw_ts):
    try:
        # Pendulum automatically detects the format and handles the UTC 'Z'
        dt = pendulum.parse(raw_ts)
        return dt.in_tz(GERMANY_TZ).format("YYYY-MM-DD HH:mm")
    except Exception as e:
        logging.error(f"Time normalization error: {e}")
        return None