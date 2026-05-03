import os
from dotenv import load_dotenv

load_dotenv()

ENTSOE_API_KEY = os.getenv("ENTSOE_API_KEY")
KRAKEN_EMAIL = os.getenv("KRAKEN_EMAIL")
KRAKEN_PASSWORD = os.getenv("KRAKEN_PASSWORD")
KRAKEN_ACCOUNT = os.getenv("KRAKEN_ACCOUNT")
KRAKEN_URL = "https://api.oeg-kraken.energy/v1/graphql/"

# Pendulum natively handles string timezones
GERMANY_TZ = "Europe/Berlin"

DEF_FIXED = float(os.getenv("DEFAULT_FIXED_COST", 0.21))
DEF_BASE = float(os.getenv("DEFAULT_BASELINE", 0.3136))
TAXES = float(os.getenv("DEFAULT_TAXES", 1.19))
DEF_FEE = float(os.getenv("MONTHLY_FEE", 15.20))