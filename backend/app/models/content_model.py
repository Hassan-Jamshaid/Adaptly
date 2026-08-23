from datetime import datetime, timezone

def build_content_doc(uid: str, content_type: str, title: str, chunks: list, source: str = None):
    return {
        "schema_version": "1.0",
        "uid": uid,
        "type": content_type,  # "pdf" | "text" | "website" | "youtube" | "video"
        "title": title,
        "source": source,       # filename or URL, if applicable
        "chunks": chunks,       # list of { chunk_id: str, order: int, text: str }
        "status": "ready",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }