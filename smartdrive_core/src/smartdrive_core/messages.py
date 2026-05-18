"""Shared Pub/Sub message schema. The backend publishes these; workers consume them.

Keeping one canonical model here means a rename on either side fails loudly
instead of silently dropping fields.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FileExtractionMessage:
    file_id: str
    user_id: str
    file_name: str
    file_type: str
    gcs_url: str
    uploaded_at: str

    @classmethod
    def from_pubsub(cls, data: dict[str, Any]) -> "FileExtractionMessage":
        """Parse the Pub/Sub JSON payload published by the backend.

        Backend uses camelCase keys (_id, userId, fileName, fileType, gcsUrl, uploadedAt).
        Workers should call this once at the edge and pass the typed object through.
        """
        try:
            return cls(
                file_id=str(data["_id"]),
                user_id=str(data["userId"]),
                file_name=str(data["fileName"]),
                file_type=str(data.get("fileType", "")).lower(),
                gcs_url=str(data["gcsUrl"]),
                uploaded_at=str(data.get("uploadedAt", "")),
            )
        except KeyError as e:
            raise ValueError(f"Pub/Sub message missing required field: {e}") from e

    def to_legacy_dict(self) -> dict[str, Any]:
        """For functions that still expect the raw camelCase dict.

        Lets us migrate workers gradually without changing every signature.
        """
        return {
            "_id": self.file_id,
            "userId": self.user_id,
            "fileName": self.file_name,
            "fileType": self.file_type,
            "gcsUrl": self.gcs_url,
            "uploadedAt": self.uploaded_at,
        }


@dataclass
class ExtractionResult:
    created: bool
    message: str = ""
    error_kind: str | None = None  # see errors.ExtractionError
    chunks_indexed: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_legacy_dict(self) -> dict[str, Any]:
        """Older callers expect `{"created": bool, "message": str}`."""
        return {
            "created": self.created,
            "message": self.message,
            **({"error_kind": self.error_kind} if self.error_kind else {}),
            **({"chunks_indexed": self.chunks_indexed} if self.chunks_indexed else {}),
        }
