import logging
import pandas as pd
import numpy as np
import pendulum
from database import fetch_all
from config import DEF_BASE, DEF_FIXED, TAXES

pd.set_option("future.no_silent_downcasting", True)


def _fetch_combined_data(query_type, param1, param2=None):
    try:
        dt_start = pendulum.parse(param1, exact=False)
        buffer_start = dt_start.subtract(days=1).format("YYYY-MM-DD HH:mm")
    except Exception:
        buffer_start = param1

    if query_type == "like":
        q_u = "SELECT timestamp, usage FROM consumption WHERE timestamp LIKE ?"
        q_p = "SELECT timestamp, price FROM {table} WHERE timestamp >= ? AND timestamp <= ?"
        args_u = (f"{param1}%",)
        args_p = (buffer_start, f"{param1} 23:59")

    elif query_type == "between" and param2:
        d1, d2 = sorted([param1, param2])
        q_u = "SELECT timestamp, usage FROM consumption WHERE timestamp BETWEEN ? AND ?"
        q_p = "SELECT timestamp, price FROM {table} WHERE timestamp BETWEEN ? AND ?"
        args_u = (f"{d1} 00:00", f"{d2} 23:59")
        args_p = (buffer_start, f"{d2} 23:59")

    else:
        q_u = "SELECT timestamp, usage FROM consumption WHERE timestamp >= ?"
        q_p = "SELECT timestamp, price FROM {table} WHERE timestamp >= ?"
        args_u = (param1,)
        args_p = (buffer_start,)

    u_rows = fetch_all(q_u, args_u)
    s_rows = fetch_all(q_p.format(table="spot_prices"), args_p)
    w_rows = fetch_all(q_p.format(table="work_prices"), args_p)

    df_u = (
        pd.DataFrame(map(dict, u_rows))
        if u_rows
        else pd.DataFrame(columns=["timestamp", "usage"])
    )
    df_s = (
        pd.DataFrame(map(dict, s_rows))
        if s_rows
        else pd.DataFrame(columns=["timestamp", "price"])
    )
    df_w = (
        pd.DataFrame(map(dict, w_rows))
        if w_rows
        else pd.DataFrame(columns=["timestamp", "price"])
    )

    return df_u, df_s, df_w


def get_price_history(start_date, end_date=None):
    if not end_date:
        df_u, df_s, df_w = _fetch_combined_data("like", start_date)
    else:
        df_u, df_s, df_w = _fetch_combined_data(
            "between", start_date, end_date
        )

    all_ts = sorted(
        list(
            set(
                df_s["timestamp"].tolist()
                + df_w["timestamp"].tolist()
                + df_u["timestamp"].tolist()
            )
        )
    )
    if not all_ts:
        return []

    df_all = pd.DataFrame({"timestamp": all_ts})
    df_all = pd.merge(df_all, df_s, on="timestamp", how="left")

    # Spot prices keep the standard ffill/bfill since they cover whole days
    df_all["price"] = df_all["price"].ffill().bfill().infer_objects(copy=False)

    df_all = pd.merge(
        df_all,
        df_w.rename(columns={"price": "real_work_price"}),
        on="timestamp",
        how="left",
    )
    
    # FIX APPLIED HERE: limit=4, removed bfill
    df_all["real_work_price"] = (
        df_all["real_work_price"].ffill(limit=4).infer_objects(copy=False)
    )

    df_all = pd.merge(df_all, df_u, on="timestamp", how="left")
    df_all["usage"] = df_all["usage"].fillna(0).infer_objects(copy=False)

    combined = []
    d_min, d_max = (
        sorted([start_date, end_date]) if end_date else (start_date, None)
    )

    for _, row in df_all.iterrows():
            ts_date = row['timestamp'].split(' ')[0]
            
            if end_date:
                if not (d_min <= ts_date <= d_max):
                    continue
            elif not row['timestamp'].startswith(start_date):
                continue
                
            # Build the Tuple: [timestamp, spot_price, usage]
            entry = [
                row['timestamp'],
                row['price'],
                float(row['usage'])
            ]
            
            # Append the explicit work_price if it exists as the 4th item
            if pd.notnull(row['real_work_price']):
                entry.append(row['real_work_price'])
                
            combined.append(entry)
            
    return combined


def calculate_stats(start_date, end_date, days, delta, base, monthly_fee):
    if start_date and end_date:
        df_u, df_s, df_w = _fetch_combined_data(
            "between", f"{start_date} 00:00", f"{end_date} 23:59"
        )
        if not df_u.empty:
            num_days = max(
                1, df_u["timestamp"].str.split(" ").str[0].nunique()
            )
        else:
            num_days = max(
                1,
                pendulum.parse(end_date)
                .diff(pendulum.parse(start_date))
                .in_days()
                + 1,
            )
    else:
        cutoff = (
            pendulum.now("Europe/Berlin")
            .subtract(days=days)
            .format("YYYY-MM-DD HH:mm")
        )
        df_u, df_s, df_w = _fetch_combined_data("greater_equal", cutoff)
        num_days = (
            max(1, df_u["timestamp"].str.split(" ").str[0].nunique())
            if not df_u.empty
            else days
        )

    if df_u.empty:
        return {
            "avg_price": 0,
            "total_kwh": 0,
            "total_cost": 0,
            "savings": 0,
            "max_price": 0,
            "min_price": 0,
            "daily_avg": 0,
        }

    df = df_u.sort_values("timestamp")
    df = pd.merge(df, df_s, on="timestamp", how="left")
    df["price"] = df["price"].ffill().bfill().infer_objects(copy=False)

    df = pd.merge(
        df,
        df_w.rename(columns={"price": "real_price"}),
        on="timestamp",
        how="left",
    )
    
    # FIX APPLIED HERE: limit=4, removed bfill
    df["real_price"] = (
        df["real_price"].ffill(limit=4).infer_objects(copy=False)
    )

    df["final_price"] = df.apply(
        lambda row: (
            (row["real_price"] + delta)
            if pd.notnull(row["real_price"])
            else (
                ((row["price"] * TAXES) + DEF_FIXED + delta)
                if pd.notnull(row["price"])
                else np.nan
            )
        ),
        axis=1,
    )

    df_priced = df.dropna(subset=["final_price"])
    total_cost = (df_priced["usage"] * df_priced["final_price"]).sum()
    apportioned_fee = (monthly_fee * 12 / 365) * num_days

    return {
        "total_cost_with_fee": round(total_cost + apportioned_fee, 2),
        "avg_price": (
            round(total_cost / df_priced["usage"].sum(), 4)
            if not df_priced.empty and df_priced["usage"].sum() > 0
            else 0
        ),
        "market_avg": (
            round(((df["price"] * TAXES) + DEF_FIXED).mean(), 4)
            if not df.empty
            else 0
        ),
        "total_kwh": round(df["usage"].sum(), 2),
        "total_cost": round(total_cost, 2),
        "savings": round((df_priced["usage"].sum() * base) - total_cost, 2),
        "max_price": (
            round(df_priced["final_price"].max(), 4)
            if not df_priced.empty
            else 0
        ),
        "min_price": (
            round(df_priced["final_price"].min(), 4)
            if not df_priced.empty
            else 0
        ),
        "daily_avg": round(df["usage"].sum() / num_days, 2),
    }


def get_consumption_chart_data(start_date, end_date, group_by):
    df_u, df_s, df_w = _fetch_combined_data("between", start_date, end_date)

    if df_u.empty:
        return []

    df = df_u.sort_values("timestamp")

    if not df_s.empty:
        df = pd.merge(df, df_s, on="timestamp", how="left")
        df["price"] = df["price"].ffill().bfill().infer_objects(copy=False)
    else:
        df["price"] = 0

    if not df_w.empty:
        df = pd.merge(
            df,
            df_w.rename(columns={"price": "real_price"}),
            on="timestamp",
            how="left",
        )
        
        # FIX APPLIED HERE: limit=4, removed bfill
        df["real_price"] = (
            df["real_price"].ffill(limit=4).infer_objects(copy=False)
        )
    else:
        df["real_price"] = None

    df["final_price"] = df.apply(
        lambda row: (
            row["real_price"]
            if pd.notnull(row["real_price"])
            else (
                ((row["price"] * TAXES) + DEF_FIXED)
                if pd.notnull(row["price"])
                else 0
            )
        ),
        axis=1,
    )

    df["cost"] = df["usage"] * df["final_price"]
    df["dt"] = pd.to_datetime(df["timestamp"])

    if group_by == "hour":
        df["key"] = df["dt"].dt.strftime("%Y-%m-%d %H:00")
    elif group_by == "month":
        df["key"] = df["dt"].dt.strftime("%Y-%m")
    else:
        df["key"] = df["dt"].dt.strftime("%Y-%m-%d")

    return (
        df.groupby("key")[["usage", "cost"]]
        .sum()
        .reset_index()
        .to_dict("records")
    )