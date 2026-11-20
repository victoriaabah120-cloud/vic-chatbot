"""Conversation export as TXT, Markdown or PDF."""

from __future__ import annotations

import io
import re
from datetime import datetime

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from app.integrations.deps import get_current_user_and_client

router = APIRouter(prefix="/export", tags=["export"])

FORMATS = {"txt", "md", "pdf"}


def _load(client, user_id: str, conversation_id: str) -> tuple[dict, list[dict]]:
    conversation = (
        client.table("conversations")
        .select("id,title,created_at")
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    ).data
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    messages = (
        client.table("messages")
        .select("role,content,created_at")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .execute()
    ).data or []
    return conversation[0], messages


def _stamp(value) -> str:
    if not value:
        return ""
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime("%d %b %Y, %H:%M")
    except ValueError:
        return str(value)[:16]


def _safe_name(title: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", (title or "conversation")).strip("-").lower()
    return (slug or "conversation")[:60]


def to_text(title: str, messages: list[dict]) -> str:
    lines = [title, "=" * len(title), ""]
    for message in messages:
        who = "You" if message.get("role") == "user" else "Vic"
        stamp = _stamp(message.get("created_at"))
        lines.append(f"{who}{' — ' + stamp if stamp else ''}")
        lines.append(message.get("content") or "")
        lines.append("")
    lines.append("Exported from Vic Chatbot.")
    return "\n".join(lines)


def to_markdown(title: str, messages: list[dict]) -> str:
    lines = [f"# {title}", ""]
    for message in messages:
        who = "You" if message.get("role") == "user" else "Vic"
        stamp = _stamp(message.get("created_at"))
        lines.append(f"### {who}{' — ' + stamp if stamp else ''}")
        lines.append("")
        lines.append(message.get("content") or "")
        lines.append("")
    lines.append("---")
    lines.append("_Exported from Vic Chatbot._")
    return "\n".join(lines)


def to_pdf(title: str, messages: list[dict]) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=title,
    )
    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "VicBody", parent=styles["BodyText"], fontSize=10.5, leading=15, spaceAfter=6
    )
    speaker = ParagraphStyle(
        "VicSpeaker", parent=styles["BodyText"], fontSize=9, leading=13,
        textColor="#6D28D9", spaceAfter=2,
    )
    heading = ParagraphStyle(
        "VicTitle", parent=styles["Title"], fontSize=18, leading=22, spaceAfter=4
    )
    story = [Paragraph(_escape(title), heading), Spacer(1, 6)]
    story.append(Paragraph("Exported from Vic Chatbot", speaker))
    story.append(Spacer(1, 10))

    for message in messages:
        who = "You" if message.get("role") == "user" else "Vic"
        stamp = _stamp(message.get("created_at"))
        story.append(Paragraph(f"{who}{' — ' + stamp if stamp else ''}", speaker))
        for block in (message.get("content") or "").split("\n"):
            if block.strip():
                story.append(Paragraph(_escape(block), body))
            else:
                story.append(Spacer(1, 4))
        story.append(Spacer(1, 8))

    doc.build(story)
    return buffer.getvalue()


def _escape(text: str) -> str:
    return (
        (text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


@router.get("/{conversation_id}")
def export_conversation(
    conversation_id: str,
    format: str = "txt",
    authorization: str | None = Header(default=None),
):
    if format not in FORMATS:
        raise HTTPException(status_code=400, detail="Use txt, md or pdf.")

    client, user = get_current_user_and_client(authorization)
    conversation, messages = _load(client, user.id, conversation_id)
    title = conversation.get("title") or "Conversation"

    if format == "pdf":
        payload = to_pdf(title, messages)
        media, ext = "application/pdf", "pdf"
    elif format == "md":
        payload = to_markdown(title, messages).encode("utf-8")
        media, ext = "text/markdown; charset=utf-8", "md"
    else:
        payload = to_text(title, messages).encode("utf-8")
        media, ext = "text/plain; charset=utf-8", "txt"

    filename = f"{_safe_name(title)}.{ext}"
    return StreamingResponse(
        io.BytesIO(payload),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
