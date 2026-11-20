"""Long-term memory: what Vic keeps about a person between conversations.

Every row is owned by one auth user, the queries always filter on that user,
and the table carries row level security as a second wall.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.integrations.deps import get_current_user_and_client

router = APIRouter(prefix="/memory", tags=["memory"])

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


MAX_MEMORIES = 200
MAX_LENGTH = 500

# (pattern, keep whole sentence). A bare "Victoria Abah" means little later,
# so statements about the person are stored as they were said.
REMEMBER_PATTERNS = (
    (re.compile(r"\bremember (?:that|this|these)?[: ]+(.+)", re.IGNORECASE | re.DOTALL), False),
    (re.compile(r"\b(?:please )?keep in mind (?:that )?(.+)", re.IGNORECASE | re.DOTALL), False),
    (re.compile(r"\bdon'?t forget (?:that )?(.+)", re.IGNORECASE | re.DOTALL), False),
    (re.compile(r"\bmy (?:name|nickname) is [^.!?\n]+", re.IGNORECASE), True),
    (re.compile(r"\bi (?:prefer|like|love|hate|dislike) [^.!?\n]+", re.IGNORECASE), True),
    (re.compile(r"\bi(?:'m| am) (?:working on|building|learning) [^.!?\n]+", re.IGNORECASE), True),
)


class MemoryIn(BaseModel):
    content: str = Field(min_length=2, max_length=MAX_LENGTH)
    category: str = Field(default="general", max_length=40)


class SettingsIn(BaseModel):
    enabled: bool


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())[:MAX_LENGTH]


def detect_memories(message: str) -> list[str]:
    """Pull explicit 'remember this' style statements out of a message."""
    found: list[str] = []
    text = (message or "").strip()
    if not text or len(text) > 1200:
        return found

    for pattern, whole_sentence in REMEMBER_PATTERNS:
        for match in pattern.finditer(text):
            raw = match.group(0) if whole_sentence else match.group(1)
            candidate = _clean(raw.rstrip(".!?"))
            if len(candidate) < 3:
                continue
            # Skip instructions about the current turn, not the person.
            if candidate.lower().startswith(("to ", "the following", "this conversation")):
                continue
            if candidate not in found:
                found.append(candidate)
        if found:
            break
    return found[:3]


def memory_enabled(client, user_id: str) -> bool:
    try:
        row = (
            client.table("profiles")
            .select("memory_enabled")
            .eq("id", user_id)
            .limit(1)
            .execute()
        ).data
    except Exception:
        return True
    if not row:
        return True
    value = row[0].get("memory_enabled")
    return True if value is None else bool(value)


def save_memory(client, user_id: str, content: str, category: str = "general", source: str = "chat") -> dict | None:
    text = _clean(content)
    if len(text) < 3:
        return None

    existing = (
        client.table("user_memories")
        .select("id,content")
        .eq("user_id", user_id)
        .limit(MAX_MEMORIES)
        .execute()
    ).data or []

    for row in existing:
        if (row.get("content") or "").strip().lower() == text.lower():
            return None
    if len(existing) >= MAX_MEMORIES:
        oldest = existing[-1]["id"]
        client.table("user_memories").delete().eq("id", oldest).eq("user_id", user_id).execute()

    inserted = _guard(
        lambda: client.table("user_memories")
        .insert(
            {"user_id": user_id, "content": text, "category": category, "source": source}
        )
        .execute(),
        "MEMORY SAVE",
    )
    return (inserted.data or [None])[0]


def build_context(client, user_id: str, limit: int = 20) -> str:
    if not memory_enabled(client, user_id):
        return ""
    rows = (
        client.table("user_memories")
        .select("content,category,created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    ).data or []
    if not rows:
        return ""
    lines = [f"- {row['content']}" for row in rows if row.get("content")]
    if not lines:
        return ""
    return (
        "Things this person asked you to remember. Use them naturally when they "
        "are relevant, never recite the list unprompted:\n" + "\n".join(lines)
    )


@router.get("")
def list_memories(authorization: str | None = Header(default=None)):
    client, user = get_current_user_and_client(authorization)
    rows = (
        client.table("user_memories")
        .select("id,content,category,source,created_at")
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .limit(MAX_MEMORIES)
        .execute()
    ).data or []
    return {"memories": rows, "enabled": memory_enabled(client, user.id)}


@router.post("")
def add_memory(payload: MemoryIn, authorization: str | None = Header(default=None)):
    client, user = get_current_user_and_client(authorization)
    row = save_memory(client, user.id, payload.content, payload.category, source="manual")
    if row is None:
        raise HTTPException(status_code=400, detail="That memory is empty or already saved.")
    return {"memory": row}


@router.delete("/{memory_id}")
def delete_memory(memory_id: str, authorization: str | None = Header(default=None)):
    client, user = get_current_user_and_client(authorization)
    result = (
        client.table("user_memories")
        .delete()
        .eq("id", memory_id)
        .eq("user_id", user.id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Memory not found.")
    return {"deleted": True}


@router.delete("")
def clear_memories(authorization: str | None = Header(default=None)):
    client, user = get_current_user_and_client(authorization)
    client.table("user_memories").delete().eq("user_id", user.id).execute()
    return {"cleared": True}


@router.patch("/settings")
def update_settings(payload: SettingsIn, authorization: str | None = Header(default=None)):
    client, user = get_current_user_and_client(authorization)
    client.table("profiles").update(
        {"memory_enabled": payload.enabled, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", user.id).execute()
    return {"enabled": payload.enabled}
