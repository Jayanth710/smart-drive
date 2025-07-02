import logging
import threading
from flask import Flask
# from flask_cors import CORS
from app.pubsub import pubsub;

logging.basicConfig(level=logging.INFO,
    format= '%(asctime)s - [%(levelname)s] - %(name)s - %(message)s'
    )

logger = logging.getLogger(__name__)

# def run_background_listener():
#     """Wrapper function for the Pub/Sub listener."""
#     logger.info("Starting background Pub/Sub listener...")
#     pubsub()

def create_app() -> Flask:
    app = Flask(__name__)
    # CORS(app, supports_credentials=True)
    # app.secret_key = "a9b8c7d6e5f4g3h2i1j0"
    # listener_thread = threading.Thread(target=run_background_listener, daemon=True)
    # listener_thread.start()
    
    @app.route("/")
    def health_check():
        logger.info("Health check endpoint was called.")
        return {"status": "running"}
    
    @app.route("/", methods=["POST"])
    def trigger_pull():
        logger.info("Cloud Scheduler triggered a pull now.")
        pubsub()  # actively run a pull on-demand
        return {"status": "triggered"}, 200


    return app