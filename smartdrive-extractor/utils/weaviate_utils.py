import json
from smartdrive_core import weaviate_client as ws
import weaviate.classes as wvc

DOC_COLLECTION = "SmartDriveDocuments"

DOC_PROPERTIES = [
  wvc.config.Property(name="file_id", data_type=wvc.config.DataType.TEXT),
  wvc.config.Property(name="user_id", data_type=wvc.config.DataType.TEXT),
  wvc.config.Property(name="summary", data_type=wvc.config.DataType.TEXT),
  wvc.config.Property(name="filename", data_type=wvc.config.DataType.TEXT),
  wvc.config.Property(name="filetype", data_type=wvc.config.DataType.TEXT),
  wvc.config.Property(name="created_at", data_type=wvc.config.DataType.DATE, index_filterable=True),
  wvc.config.Property(name="index_json", data_type=wvc.config.DataType.TEXT),
]

IMG_COLLECTION = "SmartDriveImages"

IMG_PROPERTIES = [
    wvc.config.Property(name="file_id", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="user_id", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="summary", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="filename", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="filetype", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="created_at", data_type=wvc.config.DataType.DATE, index_filterable=True),
    wvc.config.Property(name="processing_type",data_type= wvc.config.DataType.TEXT, description="The type of processing applied to the file",),
]

def init_schema():
    ws.ensure_collection(DOC_COLLECTION, DOC_PROPERTIES)

def save_doc(data, summary, index_json, embedding):

    init_schema()  # ensure collection/schema exists before upload

    props = {
        "filename": data["fileName"],
        "file_id": str(data["_id"]),
        "user_id": data["userId"],
        "summary": summary,
        "index_json": json.dumps(index_json, ensure_ascii=False),
        "filetype": data.get("fileType"),
        "created_at": data.get("uploadedAt"),
    }
    return ws.upload(DOC_COLLECTION, props, embedding)


def init_image_schema():
    ws.ensure_collection(IMG_COLLECTION, IMG_PROPERTIES)

def save_image(data, summary, embedding, processing_type):

    init_image_schema()  # ensure collection/schema exists before upload

    props = {
        "filename": data["fileName"],
        "file_id": str(data["_id"]),
        "user_id": data["userId"],
        "summary": summary,
        "filetype": data.get("fileType"),
        "created_at": data.get("uploadedAt"),
        "processing_type": processing_type,
    }
    
    return ws.upload(IMG_COLLECTION, props, embedding)