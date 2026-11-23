"""Uploaded document intake and text extraction.

Files live in the private `documents` bucket under `<user id>/...`, so a user
can only ever reach their own objects. Text is extracted on the server; the
browser never sees a parser or a key.
"""

from __future__ import annotations

import io
import os
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.integrations.deps import get_current_user_and_client

router = APIRouter(prefix="/documents", tags=["documents"])

MIGRATION_HINT = (
    "This feature needs the assistant upgrade tables. Run "
    "app/sql/003_assistant_upgrade.sql in Supabase, then try again."
)


def _guard(call, label):
    """Run a table call, turning a missing table into a readable 503."""
    try:
        return call()
    except Exception as error:  # noqa: BLE001
        print(f"{label} ERROR:", repr(error))
        raise HTTPException(status_code=503, detail=MIGRATION_HINT)


BUCKET = "documents"
MAX_BYTES = 20 * 1024 * 1024          # 20 MB per file
MAX_IMAGE_BYTES = 8 * 1024 * 1024     # 8 MB per image
MAX_TEXT_CHARS = 60000                # per document, keeps prompts sane

TEXT_TYPES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
    "text/markdown": "txt",
}
IMAGE_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}


def _kind(mime: str, name: str) -> str | None:
    mime = (mime or "").lower()
    lower = (name or "").lower()
    if mime in TEXT_TYPES:
        return TEXT_TYPES[mime]
    if mime in IMAGE_TYPES:
        return "image"
    if lower.endswith(".pdf"):
        return "pdf"
    if lower.endswith(".docx"):
        return "docx"
    if lower.endswith((".txt", ".md")):
        return "txt"
    if lower.endswith((".png", ".jpg", ".jpeg", ".webp")):
        return "image"
    return None


def _pdf_text(data: bytes) -> tuple[str, int]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = [(page.extract_text() or "") for page in reader.pages]
    return "\n\n".join(pages).strip(), len(reader.pages)


def _docx_text(data: bytes) -> str:
    from docx import Document

    document = Document(io.BytesIO(data))
    parts = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n".join(part for part in parts if part.strip()).strip()


def _plain_text(data: bytes) -> str:
    # utf-16 only when the file actually carries a BOM, otherwise arbitrary
    # bytes "decode" into nonsense.
    encodings = ["utf-8"]
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        encodings.append("utf-16")
    encodings.append("latin-1")
    for encoding in encodings:
        try:
            return data.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace").strip()


def _vision_text(data: bytes, mime: str) -> str:
    """Describe an image with Groq's vision model; empty when unavailable."""
    key = os.getenv("GROQ_API_KEY")
    if not key:
        return ""
    import base64

    encoded = base64.b64encode(data).decode()
    payload = {
        "model": os.getenv("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct"),
        "temperature": 0.2,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Describe this image in detail for a document assistant: "
                            "layout, objects, people, and every piece of visible text "
                            "transcribed verbatim."
                        ),
                    },
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
                ],
            }
        ],
    }
    try:
        response = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json=payload,
            timeout=60,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"].strip()
    except Exception as error:  # vision is best effort, never fatal
        print("VISION ERROR:", repr(error))
        return ""


@router.post("")
async def upload_document(
    file: UploadFile = File(...),
    conversation_id: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
):
    client, user = get_current_user_and_client(authorization)

    data = await file.read()
    kind = _kind(file.content_type, file.filename)
    if kind is None:
        raise HTTPException(
            status_code=415,
            detail="That file type is not supported. Use PDF, DOCX, TXT, PNG, JPG or WEBP.",
        )

    limit = MAX_IMAGE_BYTES if kind == "image" else MAX_BYTES
    if len(data) > limit:
        raise HTTPException(
            status_code=413,
            detail=f"{file.filename} is larger than {limit // (1024 * 1024)} MB.",
        )
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty.")

    extracted = ""
    pages = None
    try:
        if kind == "pdf":
            extracted, pages = await run_in_threadpool(_pdf_text, data)
        elif kind == "docx":
            extracted = await run_in_threadpool(_docx_text, data)
        elif kind == "txt":
            extracted = await run_in_threadpool(_plain_text, data)
        else:
            extracted = await run_in_threadpool(_vision_text, data, file.content_type or "image/png")
    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=f"Vicora could not read {file.filename}. Try another copy of the file.",
        ) from error

    document_id = str(uuid.uuid4())
    safe_name = os.path.basename(file.filename or f"{document_id}")
    storage_path = f"{user.id}/{document_id}-{safe_name}"

    try:
        client.storage.from_(BUCKET).upload(
            storage_path,
            data,
            {"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception as error:
        print("STORAGE ERROR:", repr(error))
        raise HTTPException(status_code=502, detail="The file could not be stored. Please try again.") from error

    record = {
        "id": document_id,
        "user_id": user.id,
        "conversation_id": conversation_id or None,
        "file_name": safe_name,
        "mime_type": file.content_type or "",
        "byte_size": len(data),
        "storage_path": storage_path,
        "extracted_text": extracted[:MAX_TEXT_CHARS] if extracted else "",
        "page_count": pages,
        "status": "ready",
    }
    inserted = _guard(
        lambda: client.table("uploaded_documents").insert(record).execute(),
        "DOCUMENT SAVE",
    )
    if not inserted.data:
        raise HTTPException(status_code=502, detail="The file could not be registered.")

    return {
        "id": document_id,
        "file_name": safe_name,
        "mime_type": record["mime_type"],
        "byte_size": len(data),
        "kind": kind,
        "page_count": pages,
        "has_text": bool(extracted),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("")
def list_documents(
    conversation_id: str | None = None,
    authorization: str | None = Header(default=None),
):
    client, user = get_current_user_and_client(authorization)
    query = (
        client.table("uploaded_documents")
        .select("id,file_name,mime_type,byte_size,page_count,status,created_at,conversation_id")
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .limit(50)
    )
    if conversation_id:
        query = query.eq("conversation_id", conversation_id)
    return {"documents": query.execute().data or []}


@router.delete("/{document_id}")
def delete_document(document_id: str, authorization: str | None = Header(default=None)):
    client, user = get_current_user_and_client(authorization)
    row = (
        client.table("uploaded_documents")
        .select("id,storage_path")
        .eq("id", document_id)
        .eq("user_id", user.id)
        .limit(1)
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="Document not found.")
    path = row.data[0].get("storage_path")
    if path:
        try:
            client.storage.from_(BUCKET).remove([path])
        except Exception:
            pass
    client.table("uploaded_documents").delete().eq("id", document_id).eq("user_id", user.id).execute()
    return {"deleted": True}


def build_context(client, user_id: str, document_ids: list[str], budget: int = 12000) -> tuple[str, list[dict]]:
    """Return (prompt block, attachment summaries) for the given documents."""
    if not document_ids:
        return "", []

    rows = (
        client.table("uploaded_documents")
        .select("id,file_name,mime_type,extracted_text,page_count")
        .in_("id", document_ids[:5])
        .eq("user_id", user_id)
        .execute()
    ).data or []

    blocks, summaries, used = [], [], 0
    for row in rows:
        text = (row.get("extracted_text") or "").strip()
        if not text:
            continue
        room = max(0, budget - used)
        if room <= 0:
            break
        excerpt = text[:room]
        used += len(excerpt)
        label = row.get("file_name") or "document"
        pages = f", {row['page_count']} pages" if row.get("page_count") else ""
        blocks.append(f"[Attached file: {label}{pages}]\n{excerpt}")
        summaries.append({"id": row["id"], "file_name": label, "chars": len(excerpt)})

    if not blocks:
        return "", summaries
    header = (
        "The user attached the files below. Ground every answer about them in this "
        "text, quote exact figures and names, and say so plainly if something is "
        "not in the file.\n\n"
    )
    return header + "\n\n---\n\n".join(blocks), summaries
