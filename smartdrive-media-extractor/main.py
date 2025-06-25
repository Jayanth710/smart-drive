import os
from app.app import create_app

if __name__ == "__main__":
    app = create_app()
    app.run(
        host="0.0.0.0",
        port = int(os.getenv("PORT", 8080)),
        debug=False
    )
