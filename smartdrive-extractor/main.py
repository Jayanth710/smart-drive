import os
import json
from google.cloud import pubsub_v1
from utils.gcs_file_download import download_from_gcs;

# Point to your service account key
# os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "smartdrive-service-account.json"

project_id = "smartdrive-461502"
subscription_id = "smartdrive-data-extract-sub"
# Set up subscriber
from google.oauth2 import service_account

# Load credentials from the local JSON file
credentials = service_account.Credentials.from_service_account_file(
    "smartdrive-service-account.json"
)

# Define the callback that handles incoming messages
def callback(message):
    try:
        data = json.loads(message.data.decode("utf-8"))
        # data = json.dumps(data, indent=2)
        output_path = download_from_gcs(data["fileUrl"], data["fileName"])
        message.ack()
    except Exception as e:
        print("❌ Error processing message:", e)
        message.nack()


subscriber = pubsub_v1.SubscriberClient(credentials=credentials)
subscription_path = subscriber.subscription_path(project_id, subscription_id)

# Start listening
subscriber.subscribe(subscription_path, callback=callback)
print(f"🚀 Listening to {subscription_path}")

# Keep the process alive
import time
while True:
    time.sleep(60)