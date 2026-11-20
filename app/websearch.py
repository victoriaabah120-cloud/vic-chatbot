"""Web search through Tavily.

The key stays on the server. When no key is configured the endpoint reports
that plainly and the chat answers from its own knowledge instead of pretending
to have searched.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from app.integrations.deps import get_current_user_and_client

router = APIRouter(prefix="/search", tags=["search"])

TAVILY_URL = "https://api.tavily.com/search"

FRESH_HINTS = (
    "latest", "today", "tonight", "yesterday", "this week", "this month",
    "current", "currently", "right now", "recent", "recently", "news",
    "update on", "up to date", "uptodate", "live", "breaking", "trending",
    "price of", "stock price", "exchange rate", "weather", "who won",
    "release date", "released", "launch", "just announced", "2026", "2025",
    "score", "fixtures", "election", "population of", "how much is",
    "documentation for", "changelog", "version of",
)


class SearchIn(BaseModel):
    query: str = Field(min_length=2, max_length=400)
    max_results: int = Field(default=5, ge=1, le=8)


def configured() -> bool:
    return bool(os.getenv("TAVILY_API_KEY"))


def should_search(question: str) -> bool:
    text = (question or "").lower()
    if len(text) < 4:
        return False
    return any(hint in text for hint in FRESH_HINTS)


def search(query: str, max_results: int = 5) -> list[dict]:
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        return []

    try:
        response = httpx.post(
            TAVILY_URL,
            json={
                "api_key": key,
                "query": query,
                "max_results": max_results,
                "search_depth": "basic",
                "include_answer": False,
                "include_raw_content": False,
            },
            timeout=25,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as error:
        print("SEARCH ERROR:", repr(error))
        return []

    results = []
    for item in payload.get("results", [])[:max_results]:
        url = (item.get("url") or "").strip()
        if not url:
            continue
        results.append(
            {
                "title": (item.get("title") or url)[:200],
                "url": url,
                "site": re.sub(r"^www\.", "", re.sub(r"^https?://", "", url).split("/")[0]),
                "snippet": (item.get("content") or "").strip()[:600],
                "published": item.get("published_date"),
            }
        )
    return results


def build_context(results: list[dict]) -> str:
    if not results:
        return ""
    lines = []
    for index, item in enumerate(results, start=1):
        lines.append(
            f"[{index}] {item['title']} ({item['site']})\n{item['url']}\n{item['snippet']}"
        )
    return (
        "Fresh web results retrieved just now. Use them for anything time sensitive, "
        "cite the source number in square brackets like [1] where you rely on them, "
        "and say clearly when the results do not answer the question:\n\n"
        + "\n\n".join(lines)
    )


@router.get("/status")
def status():
    return {
        "configured": configured(),
        "provider": "tavily",
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("")
def run_search(payload: SearchIn, authorization: str | None = Header(default=None)):
    get_current_user_and_client(authorization)
    if not configured():
        return {"results": [], "configured": False}
    return {"results": search(payload.query, payload.max_results), "configured": True}
