# def main():
#     print("Hello from smartdrive-image-extractor!")


# if __name__ == "__main__":
#     main()

import logging
import os

# from flask import app
from app.app import create_app
# from app.environment import Environment

# env  = Environment.from_env()

# logging.basicConfig(level=env.root_log_level)
# logging.getLogger('starter').setLevel(level=env.starter_log_level)

if __name__ == "__main__":
    app = create_app()
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8080)),
        debug=False
    )