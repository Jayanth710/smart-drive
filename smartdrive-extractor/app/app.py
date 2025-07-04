import logging
from flask import Flask
from app.environment import Environment
from app.pubsub import pubsub;

logging.basicConfig(level=logging.INFO,
    format= '%(asctime)s - [%(levelname)s] - %(name)s - %(message)s'
    )

logger = logging.getLogger(__name__)

def create_app(env: Environment = Environment.from_env()) -> Flask:
    app = Flask(__name__)
    
    @app.route("/")
    def health_check():
        logger.info("Health check endpoint was called.")
        return {"status": "running"}
    
    @app.route("/", methods=["POST"])
    def trigger_pull():
        logger.info("Cloud Scheduler triggered a pull now.")
        pubsub()
        return {"status": "triggered"}, 200


    return app