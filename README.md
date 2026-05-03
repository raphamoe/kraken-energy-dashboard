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

## ⚙️ Configuration (.env)

Create a `.env` file in the root directory:
```env
# --- API Keys & Accounts ---
KRAKEN_EMAIL=              # The E-mail to your Kraken Account
KRAKEN_PASSWORD=           # Your Kraken login Password.
KRAKEN_ACCOUNT=            # The Account ID, found in the Kraken Dashboard. Looks like this: A-123456789
ENTSOE_API_KEY=            # The API Key you should have generated from Entso-E

# --- Baseline & Tariff Settings ---
DEFAULT_BASELINE=        # Standard price for savings comparison
DEFAULT_FIXED_COST=      # Grid fees/taxes per kWh
MONTHLY_FEE=             # Base monthly fee
DEFAULT_TAXES=           # your added VAT
