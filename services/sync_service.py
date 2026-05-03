import logging
import pandas as pd
import pendulum

from config import GERMANY_TZ, KRAKEN_ACCOUNT
from database import fetch_one, bulk_insert, backup_db
from clients import kraken, entsoe_client
from utils import normalize_ts
from graphql_queries import GET_DAY_AHEAD_PRICES, GET_USAGE


def sync_kraken_work():
    """Fetches day-ahead work prices from Kraken and updates the database."""
    try:
        res_p = kraken.fetch_graphql(
            GET_DAY_AHEAD_PRICES, {"accountNumber": KRAKEN_ACCOUNT}
        )

        if not res_p or "errors" in res_p or "data" not in res_p:
            err_msg = (
                res_p.get("errors", [{}])[0].get(
                    "message", "Login failed or unknown error"
                )
                if res_p
                else "None"
            )
            return {"status": "error", "message": f"API Error: {err_msg}"}, 500

        forecasts = (
            res_p["data"]
            .get("account", {})
            .get("properties", [{}])[0]
            .get("electricityMalos", [{}])[0]
            .get("agreements", [])
        )

        new_prices = []
        for agree in forecasts:
            for entry in agree.get("unitRateForecast", []):
                ts = normalize_ts(entry.get("validFrom"))
                rate = (
                    entry.get("unitRateInformation", {})
                    .get("rates", [{}])[0]
                    .get("latestGrossUnitRateCentsPerKwh")
                )
                if ts and rate is not None:
                    new_prices.append((ts, round(float(rate) / 100, 4)))

        if not new_prices:
            return {
                "status": "error",
                "message": "No valid prices parsed.",
            }, 500

        added = bulk_insert("work_prices", new_prices)
        return {"status": "success", "rows_added": added}, 200

    except Exception as e:
        logging.error(f"Sync Work: {e}")
        return {"status": "error", "message": str(e)}, 500


def sync_kraken_usage(days_back, force=False):
    """Fetches smart meter consumption data from Kraken."""
    total_added = 0
    try:
        now = pendulum.now(GERMANY_TZ)
        for i in range(max(1, min(days_back, 365)) + 1):
            # Pendulum easily subtracts days and formats it
            d_str = now.subtract(days=i).format("YYYY-MM-DD")

            if not force:
                count = fetch_one(
                    "SELECT COUNT(*) FROM consumption WHERE timestamp LIKE ?",
                    (f"{d_str}%",),
                )[0]
                if count >= 90:
                    continue

            res_u = kraken.fetch_graphql(
                GET_USAGE, {"account": KRAKEN_ACCOUNT, "date": d_str}
            )
            edges = (
                res_u.get("data", {})
                .get("account", {})
                .get("properties", [{}])[0]
                .get("measurements", {})
                .get("edges", [])
                if res_u
                else []
            )

            new_usage = []
            for edge in edges:
                node = edge.get("node", {})
                ts = normalize_ts(node.get("startAt"))
                if ts and "value" in node:
                    new_usage.append((ts, float(node["value"])))

            total_added += bulk_insert("consumption", new_usage)

        return {"status": "success", "rows_added": total_added}, 200

    except Exception as e:
        logging.error(f"Sync Usage: Error: {e}")
        return {"status": "error", "message": str(e)}, 500


def sync_entsoe_spot(days_back, force=False):
    """Fetches wholesale spot prices from ENTSO-E in a single optimized block using Pendulum."""
    try:
        days_back = max(1, min(days_back, 365))

        now = pendulum.now(GERMANY_TZ)
        start_dt = now.subtract(days=days_back)
        end_dt = now.add(days=1)

        start = pd.Timestamp(start_dt.date(), tz=GERMANY_TZ)
        end = pd.Timestamp(end_dt.date(), tz=GERMANY_TZ) + pd.Timedelta(days=1)

        ts_p = entsoe_client.query_day_ahead_prices(
            "DE_LU", start=start, end=end
        )

        new_spot = [
            (k.strftime("%Y-%m-%d %H:%M"), round(v / 1000, 4))
            for k, v in ts_p.items()
        ]

        total_added = bulk_insert("spot_prices", new_spot)
        return {"status": "success", "rows_added": total_added}, 200

    except Exception as e:
        logging.error(f"Sync Spot Error: {e}")
        return {"status": "error", "message": str(e)}, 500

def run_daily_sync(days_back=3, force=False):
    """
    Orchestrates the sync workers and blindly requests a backup.
    The database module will reject the backup if one was made recently.
    """
    results = {}

    # 1. Run the workers
    res_work, _ = sync_kraken_work()
    res_usage, _ = sync_kraken_usage(days_back, force)
    res_spot, _ = sync_entsoe_spot(days_back, force)

    results["work"] = res_work
    results["usage"] = res_usage
    results["spot"] = res_spot

    # 2. Request the backup blindly
    logging.info("Sync workers finished. Requesting daily backup check.")
    
    # We pass the 'force' flag down so you can override the 24h limit manually
    backup_db(force=force) 

    return results