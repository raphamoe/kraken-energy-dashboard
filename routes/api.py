import io
import os
import zipfile
import logging
import pendulum
from flask import Blueprint, jsonify, request, send_file
from config import GERMANY_TZ, DEF_BASE

from services.stats_service import (
    get_price_history,
    calculate_stats,
    get_consumption_chart_data,
)
from services.sync_service import (
    sync_kraken_work,
    sync_kraken_usage,
    sync_entsoe_spot,
    run_daily_sync,
)

api_bp = Blueprint("api", __name__, url_prefix="/api")


@api_bp.route("/prices")
def api_prices():
    # History page uses 'start' and 'end'[cite: 5]
    # Dashboard uses 'date'[cite: 4]
    start_date = request.args.get("start") or request.args.get("date")
    end_date = request.args.get("end")  # If None, it treats as single-day

    if not start_date:
        start_date = pendulum.now(GERMANY_TZ).format("YYYY-MM-DD")

    try:
        data = get_price_history(start_date, end_date)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api_bp.route("/stats")
def api_stats():
    try:
        start_date = request.args.get("start")
        end_date = request.args.get("end")
        delta = float(request.args.get("delta", 0.0))
        base = float(request.args.get("baseline", DEF_BASE))
        monthly_fee = float(request.args.get("monthly_fee", 15.20))
        days = int(request.args.get("days", 7))

        stats = calculate_stats(
            start_date, end_date, days, delta, base, monthly_fee
        )
        return jsonify(stats)
    except Exception as e:
        logging.error(f"Stats error: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/sync/work")
def sync_work():
    return sync_kraken_work()


@api_bp.route("/sync/usage")
def sync_usage():
    days = int(float(request.args.get("days", 1)))
    force_sync = request.args.get("force", "false").lower() == "true"
    return sync_kraken_usage(days, force=force_sync)


@api_bp.route("/sync/spot")
def sync_spot():
    days = int(float(request.args.get("days", 1)))
    force_sync = request.args.get("force", "false").lower() == "true"
    return sync_entsoe_spot(days, force=force_sync)

@api_bp.route("/sync/all")
def sync_all():
    """
    The Master Sync: Runs all tasks and triggers the 
    single optimized backup if new data was found.
    """
    days = int(float(request.args.get("days", 3)))
    force_sync = request.args.get("force", "false").lower() == "true"
    
    try:
        results = run_daily_sync(days_back=days, force=force_sync)
        return jsonify({"status": "success", "results": results}), 200
    except Exception as e:
        logging.error(f"Full sync error: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/export_db")
def export_db():
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, "w", zipfile.ZIP_DEFLATED) as zf:
        filepath = os.path.join("data", "energy.db")
        if os.path.exists(filepath):
            zf.write(filepath, arcname="energy.db")

    memory_file.seek(0)
    ts = pendulum.now().format("YYYY-MM-DD")
    return send_file(
        memory_file,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"energy_database_backup_{ts}.zip",
    )


@api_bp.route("/consumption_chart")
def api_consumption_chart():
    try:
        start_date = request.args.get("start")
        end_date = request.args.get("end")
        group_by = request.args.get("groupby", "day")

        data = get_consumption_chart_data(start_date, end_date, group_by)
        return jsonify(data)

    except Exception as e:
        logging.error(f"Consumption chart error: {e}")
        return jsonify({"error": str(e)}), 500
