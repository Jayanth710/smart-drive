import logging
import threading
from flask import Flask
from app.pubsub import pubsub


logging.basicConfig(level=logging.INFO,
    format= '%(asctime)s - [%(levelname)s] - %(name)s - %(message)s'
    )

logger = logging.getLogger(__name__)

def run_background_listener():
    """Wrapper function for the Pub/Sub listener."""
    logger.info("Starting background Pub/Sub listener...")
    pubsub()

def create_app():
    app = Flask(__name__)
    listener_thread = threading.Thread(target=run_background_listener, daemon=True)
    listener_thread.start()

    @app.route("/")
    def health_check():
        logger.info("Health check endpoint was called.")
        return {"status": "running"}

    return app


