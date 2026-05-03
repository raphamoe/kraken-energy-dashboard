import sys
import logging
from flask import Flask
from flask_compress import Compress


from routes.api import api_bp
from routes.views import views_bp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)

app = Flask(__name__)
Compress(app)

app.register_blueprint(api_bp)
app.register_blueprint(views_bp)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
