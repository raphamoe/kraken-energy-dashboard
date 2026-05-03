import time
import requests
import logging
from threading import Lock
from entsoe import EntsoePandasClient
from config import ENTSOE_API_KEY, KRAKEN_EMAIL, KRAKEN_PASSWORD, KRAKEN_URL

entsoe_client = EntsoePandasClient(api_key=ENTSOE_API_KEY)


class KrakenClientDE:
    def __init__(self):
        self.token = None
        self.session = requests.Session()
        self.session.headers.update(
            {"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"}
        )
        self._auth_lock = Lock()
        self._last_refresh = 0

    def login(self):
        with self._auth_lock:
            if time.time() - self._last_refresh < 5:
                return True

            self.token = None
            if "Authorization" in self.session.headers:
                del self.session.headers["Authorization"]

            mutation = """mutation krakenTokenAuthentication($email: String!, $password: String!) {
              obtainKrakenToken(input: {email: $email, password: $password}) { token }
            }"""
            try:
                r = self.session.post(
                    KRAKEN_URL,
                    json={
                        "query": mutation,
                        "variables": {
                            "email": KRAKEN_EMAIL,
                            "password": KRAKEN_PASSWORD,
                        },
                    },
                )
                r.raise_for_status()
                data = r.json()

                if "errors" in data:
                    logging.error(f"Kraken Login Failed: {data['errors']}")
                    return False

                self.token = data["data"]["obtainKrakenToken"]["token"]
                self.session.headers.update({"Authorization": self.token})
                self._last_refresh = time.time()

                logging.info("Kraken token successfully refreshed.")
                return True

            except requests.exceptions.JSONDecodeError:
                logging.error(
                    f"Kraken Login Failed: API returned non-JSON. Status: {r.status_code}"
                )
                return False
            except Exception as e:
                logging.error(f"Kraken Login Failed: {e}")
                return False

    def fetch_graphql(self, query, vars={}, is_retry=False):
        if not self.token and not self.login():
            return None
        try:
            r = self.session.post(
                KRAKEN_URL, json={"query": query, "variables": vars}
            )
            r.raise_for_status()
            data = r.json()

            error_text = str(data.get("errors", [])).lower()

            if "errors" in data and any(
                keyword in error_text
                for keyword in ["auth", "jwt", "expired", "unauthorized"]
            ):
                if is_retry:
                    logging.error(
                        "Kraken token refresh loop detected. Giving up."
                    )
                    return None

                logging.warning("Kraken token rejected, attempting refresh...")
                if self.login():
                    return self.fetch_graphql(query, vars, is_retry=True)
                return None

            return data

        except requests.exceptions.JSONDecodeError:
            logging.error(
                f"GraphQL JSON parse failed. Status: {r.status_code}, Response: {r.text[:200]}"
            )
            return None
        except requests.exceptions.HTTPError as e:
            logging.error(
                f"GraphQL HTTP Error: {e} - Response: {r.text[:200]}"
            )
            return None
        except Exception as e:
            logging.error(f"GraphQL request failed: {e}")
            return None


kraken = KrakenClientDE()
