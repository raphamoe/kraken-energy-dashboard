from flask import Blueprint, render_template, send_file, send_from_directory
import pendulum
from database import fetch_all, fetch_one
from config import DEF_BASE, DEF_FIXED, TAXES, GERMANY_TZ, DEF_FEE

views_bp = Blueprint("views", __name__)


@views_bp.route("/")
def index():
    return render_template(
        "index.html", base_price=DEF_BASE, fixed_cost=DEF_FIXED, taxes=TAXES
    )


@views_bp.route("/history")
def history():
    entries = fetch_all("SELECT timestamp FROM consumption")
    dates = sorted(
        list(set([e["timestamp"].split(" ")[0] for e in entries])),
        reverse=True,
    )

    struct = {}
    for d_str in dates:
        # Pendulum makes structuring the accordion tree much cleaner
        dt = pendulum.parse(d_str)
        struct.setdefault(dt.format("YYYY"), {}).setdefault(
            dt.format("MMMM"), {}
        ).setdefault(dt.week_of_year, []).append(d_str)

    return render_template(
        "history.html",
        data=struct,
        base_price=DEF_BASE,
        fixed_cost=DEF_FIXED,
        taxes=TAXES,
        monthly_fee = DEF_FEE,
    )


@views_bp.route("/statistics")
def statistics():
    today_date = pendulum.now(GERMANY_TZ).format("YYYY-MM-DD")
    oldest_entry = fetch_one(
        "SELECT timestamp FROM consumption ORDER BY timestamp ASC LIMIT 1"
    )
    oldest_date = (
        oldest_entry["timestamp"].split(" ")[0] if oldest_entry else today_date
    )

    return render_template(
        "statistics.html",
        base_price=DEF_BASE,
        fixed_cost=DEF_FIXED,
        taxes=TAXES,
        oldest_date=oldest_date,
        today_date=today_date,
        monthly_fee = DEF_FEE,
    )


@views_bp.route("/consumption")
def consumption():
    res = fetch_one(
        "SELECT timestamp FROM consumption ORDER BY timestamp DESC LIMIT 1"
    )
    # subtract(days=1) is native and safe in Pendulum
    latest_date = (
        res["timestamp"].split(" ")[0]
        if res
        else pendulum.now(GERMANY_TZ).subtract(days=1).format("YYYY-MM-DD")
    )

    return render_template("consumption.html", latest_date=latest_date, monthly_fee = DEF_FEE,)


@views_bp.route("/sw.js")
def service_worker():
    response = send_file("static/sw.js", mimetype="application/javascript")
    response.headers["Cache-Control"] = "no-cache"
    return response

@views_bp.route('/manifest.json')
def serve_manifest():
    return send_from_directory('static', 'manifest.json', mimetype='application/json')