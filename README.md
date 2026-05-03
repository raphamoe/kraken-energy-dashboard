# 🐙 Kraken Energy Pi-Dashboard

A lightweight, bulletproof energy consumption and price tracking dashboard. Designed as a "set-and-forget" appliance for low-power hardware like a Raspberry Pi. 

It fetches smart meter usage and dynamic work prices from the Kraken GraphQL API, day-ahead spot prices from ENTSO-E, and calculates costs and savings against a standard baseline tariff.


---

## ✨ Features at a Glance

*   **Ultra-Lean Architecture**: No heavy background schedulers. The Flask backend sits silently in RAM until triggered by a native OS `cron` job. 
*   **SD-Card Friendly Backups**: Uses a "dumb orchestrator, smart worker" architecture. Backups use SQLite's native `VACUUM INTO` command to create a defragmented clone, protected by a strict 24-hour hardware lock to prevent SD card burnout.
*   **Smart Fallback Pricing**: Automatically merges Kraken dynamic rates with ENTSO-E spot prices. If Kraken doesn't provide a specific hourly rate, the app seamlessly falls back to calculating the spot price + taxes and fixed fees.
*   **PWA Ready**: Installable as a native-feeling app on iOS and Android with service workers for caching.
*   **Offline-First History**: Browsing historical years fetches data once and locks it into Session Storage for instant navigation.

---

## 🚀 Getting Started

1. Make sure you have access to the GERMAN Kraken GraphQL API. If you are a UK or customer from elsewhere, you're gonna have to do some changes first before running this. 
2. Create a account here: https://transparency.entsoe.eu/
3. Send an e-mail to transparency@entsoe.eu requesting access to their API. It can take a while before they set you up.
4. Once you're setup, go to https://transparency.entsoe.eu/myAccount/webApiAccess , create an API Key. Note it down. You will need it.

### Option A: Docker (Recommended)
The project includes a `Dockerfile` for easy deployment.
1.  **Build the image**: `docker build -t energy-dashboard .`
2.  **Run the container**:
    ```bash
    docker run -d \
      --name energy-app \
      -p 5000:5000 \
      --env-file .env \
      -v $(pwd)/data:/app/data \
      energy-dashboard
    ```

### Option B: Native Python
If you prefer running without Docker:
1.  **Install dependencies**: `pip install -r requirements.txt`
2.  **Configure Environment**: Ensure your `.env` file is in the root directory.
3.  **Launch**: `python app.py`

---

Once you're running, go to --> History, click on Settings, select a timeframe to which date you want to sync back your data (if any) and hit the Sync Button. Depending on the amount of data, it might take a few minutes.

Hidden features:
1. Force Update: In history, Shift-Click the Update button to force-sync your DB, overwriting any entries.
2. Doubleclick on "Day" in the Energy Usage page to jump back to the current day. 

## ⚙️ Configuration (.env)

Create a `.env` file in the root directory:
```env
# --- API Keys & Accounts ---
KRAKEN_EMAIL=              # The E-mail to your Kraken Account
KRAKEN_PASSWORD=           # Your Kraken login Password.
KRAKEN_ACCOUNT=            # The Account ID, found in the Kraken Dashboard. Looks like this: A-123456789
KRAKEN_URL=                # The URL to your countries specific Kraken API URL
ENTSOE_API_KEY=            # The API Key you should have generated from Entso-E

# --- Baseline & Tariff Settings ---
DEFAULT_BASELINE=        # Standard price for savings comparison
DEFAULT_FIXED_COST=      # Grid fees/taxes per kWh
MONTHLY_FEE=             # Base monthly fee
DEFAULT_TAXES=           # your added VAT


---

To switch your dashboard from the German Kraken platform to Octopus Energy UK, you will need to change both the API URL and the structure of your GraphQL queries. 

Because Kraken is a global platform, the underlying architecture is the same, but the regional terminology (and database schema) differs slightly to match local energy market laws.

### 1. The UK API Route
First, update your `.env` file with the official UK GraphQL endpoint:
```env
KRAKEN_BASE_URL=[https://api.octopus.energy/v1/graphql/](https://api.octopus.energy/v1/graphql/)
```

### 2. The GraphQL Query Changes
In Germany, energy grids use a "Marktlokation" (MaLo) to identify supply points, which is why your current `graphql_queries.py` uses the `electricityMalos` array. 

In the UK, this concept doesn't exist. Instead, Octopus UK uses `electricityAgreements` and `electricityMeterPoints` directly attached to the account.

You will need to open your `graphql_queries.py` and modify your queries to match the UK schema.

#### Fetching Day-Ahead Prices (Agile/Dynamic Tariffs)
To get your `unitRateForecast` in the UK, your query should bypass properties/malos and look directly at active agreements.

**Change your price query to look something like this:**
```graphql
query getDayAheadPrices($accountNumber: String!) {
  account(accountNumber: $accountNumber) {
    electricityAgreements(active: true) {
      tariff {
        ... on HalfHourlyTariff {
          unitRates {
            validFrom
            validTo
            valueIncVat
          }
        }
      }
    }
  }
}
```
*(Note: You will also need to update `stats_service.py` to parse this new JSON path: `res["data"]["account"]["electricityAgreements"][0]["tariff"]["unitRates"]` instead of the old `electricityMalos` path).*

#### Fetching Usage Data
In the UK, querying live usage via GraphQL is typically done using the **Octopus Home Mini** device. If you have one, you query the `smartMeterTelemetry` endpoint. 

First, you need your Home Mini's Device ID. You can find it by running this query once:
```graphql
query GetDeviceId($accountNumber: String!) {
  account(accountNumber: $accountNumber) {
    electricityAgreements(active: true) {
      meterPoint {
        meters(includeInactive: false) {
          smartDevices {
            deviceId
          }
        }
      }
    }
  }
}
```

Then, you update your `GET_USAGE` query in `graphql_queries.py` to fetch the actual consumption:
```graphql
query GetUsage($deviceId: String!, $start: DateTime!, $end: DateTime!) {
  smartMeterTelemetry(
    deviceId: $deviceId
    grouping: HALF_HOURLY
    start: $start
    end: $end
  ) {
    readAt
    consumptionDelta
  }
}
```

You will also propably want to use different timezones and pricing symbols.

### Summary of the Tinkering Required:
1. Update `.env` with the UK URL.
2. Rewrite `GET_DAY_AHEAD_PRICES` to use `electricityAgreements`.
3. Rewrite `GET_USAGE` to use `smartMeterTelemetry` (requires a Home Mini).
4. Update `sync_service.py` to parse the new JSON paths returned by the UK queries.
