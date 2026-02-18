import os
from smartdrive_core.pubsub_pull import pull_and_process
from smartdrive_core.gcs import download_and_process
from utils.ingestion_router import route_and_process  # your docling path

from dotenv import load_dotenv
load_dotenv()

subscription_id = os.getenv("PUBSUB_SUBSCRIPTION_ID","smartdrive-data-extract-sub")

def handle_message(data):
    return download_and_process(data, route_and_process)

def handler(data):
    return handle_message(data)

def run():
    pull_and_process(handler, subscription_id=subscription_id)