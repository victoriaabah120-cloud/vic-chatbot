"""GitHub provider: OAuth connection plus read/write tools."""

import base64
import os
from typing import Any, Dict, List
from urllib.parse import urlencode

import httpx

from .base import Provider, Tool

API = "https://api.github.com"
AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"

SCOPES = ["repo", "read:user"]

MAX_FILE_CHARS = 12000


def _headers(token: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "vic-chatbot",
    }


def _get(token: str, path: str, params: Dict[str, Any] | None = None) -> Any:
    response = httpx.get(
        f"{API}{path}",
        headers=_headers(token),
        params=params or {},
        timeout=20,
    )
    if response.status_code == 401:
        raise RuntimeError("GitHub rejected the stored token. Reconnect GitHub.")
    if response.status_code == 404:
        raise RuntimeError("Not found. Check the repository name and path.")
    if response.status_code == 403:
        raise RuntimeError(
            "GitHub refused this request. The token may lack permission "
            "for that repository."
        )
    response.raise_for_status()
    return response.json()


def _post(token: str, path: str, payload: Dict[str, Any]) -> Any:
    response = httpx.post(
        f"{API}{path}",
        headers=_headers(token),
        json=payload,
        timeout=20,
    )
    if response.status_code == 401:
        raise RuntimeError("GitHub rejected the stored token. Reconnect GitHub.")
    response.raise_for_status()
    return response.json()


class GitHubProvider(Provider):
    def __init__(self) -> None:
        super().__init__(
            id="github",
            name="GitHub",
            auth="oauth2",
            description="Read repositories, files and issues, and open issues.",
            scopes=SCOPES,
        )

    def is_configured(self) -> bool:
        return bool(
            os.getenv("GITHUB_CLIENT_ID") and os.getenv("GITHUB_CLIENT_SECRET")
        )

    def build_authorize_url(self, state: str, redirect_uri: str) -> str:
        query = urlencode(
            {
                "client_id": os.getenv("GITHUB_CLIENT_ID", ""),
                "redirect_uri": redirect_uri,
                "scope": " ".join(SCOPES),
                "state": state,
                "allow_signup": "false",
            }
        )
        return f"{AUTHORIZE_URL}?{query}"

    def exchange_code(self, code: str, redirect_uri: str) -> Dict[str, Any]:
        response = httpx.post(
            TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": os.getenv("GITHUB_CLIENT_ID", ""),
                "client_secret": os.getenv("GITHUB_CLIENT_SECRET", ""),
                "code": code,
                "redirect_uri": redirect_uri,
            },
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()

        if payload.get("error"):
            raise RuntimeError(
                payload.get("error_description") or payload["error"]
            )

        access_token = payload.get("access_token")
        if not access_token:
            raise RuntimeError("GitHub did not return an access token.")

        return {
            "access_token": access_token,
            "refresh_token": payload.get("refresh_token"),
            "expires_in": payload.get("expires_in"),
            "scopes": payload.get("scope", " ".join(SCOPES)),
        }

    def fetch_account_label(self, access_token: str) -> str:
        try:
            user = _get(access_token, "/user")
            return user.get("login") or ""
        except Exception:  # noqa: BLE001 - label is cosmetic
            return ""

    def tools(self, access_token: str) -> List[Tool]:
        token = access_token

        def list_repos(limit: int = 10) -> List[Dict[str, Any]]:
            limit = max(1, min(int(limit), 30))
            repos = _get(
                token,
                "/user/repos",
                {"per_page": limit, "sort": "updated", "affiliation": "owner,collaborator,organization_member"},
            )
            return [
                {
                    "full_name": repo["full_name"],
                    "private": repo["private"],
                    "language": repo.get("language"),
                    "updated_at": (repo.get("pushed_at") or "")[:10],
                    "description": repo.get("description"),
                }
                for repo in repos
            ]

        def read_file(repo: str, path: str, ref: str | None = None) -> Dict[str, Any]:
            params = {"ref": ref} if ref else None
            data = _get(token, f"/repos/{repo}/contents/{path}", params)

            if isinstance(data, list):
                return {
                    "path": path,
                    "type": "directory",
                    "entries": [entry.get("name") for entry in data][:100],
                }

            content = ""
            if data.get("encoding") == "base64" and data.get("content"):
                try:
                    content = base64.b64decode(data["content"]).decode(
                        "utf-8", errors="replace"
                    )
                except Exception:  # noqa: BLE001
                    content = ""

            truncated = len(content) > MAX_FILE_CHARS
            return {
                "path": data.get("path"),
                "size": data.get("size"),
                "truncated": truncated,
                "content": content[:MAX_FILE_CHARS],
            }

        def search_code(query: str, limit: int = 5) -> Dict[str, Any]:
            limit = max(1, min(int(limit), 10))
            data = _get(
                token,
                "/search/code",
                {"q": query, "per_page": limit},
            )
            return {
                "total": data.get("total_count", 0),
                "items": [
                    {
                        "repo": item["repository"]["full_name"],
                        "path": item["path"],
                        "url": item.get("html_url"),
                    }
                    for item in data.get("items", [])[:limit]
                ],
            }

        def list_issues(
            repo: str, state: str = "open", limit: int = 10
        ) -> List[Dict[str, Any]]:
            limit = max(1, min(int(limit), 20))
            if state not in {"open", "closed", "all"}:
                state = "open"
            issues = _get(
                token,
                f"/repos/{repo}/issues",
                {"state": state, "per_page": limit},
            )
            return [
                {
                    "number": issue["number"],
                    "title": issue["title"],
                    "state": issue["state"],
                    "author": (issue.get("user") or {}).get("login"),
                    "url": issue.get("html_url"),
                }
                for issue in issues
                if "pull_request" not in issue
            ]

        def create_issue(repo: str, title: str, body: str = "") -> Dict[str, Any]:
            issue = _post(
                token,
                f"/repos/{repo}/issues",
                {"title": title, "body": body},
            )
            return {
                "number": issue["number"],
                "title": issue["title"],
                "url": issue.get("html_url"),
            }

        return [
            Tool(
                name="github_list_repos",
                description=(
                    "List the user's GitHub repositories, most recently "
                    "updated first."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "limit": {
                            "type": "integer",
                            "description": "How many repositories to return, 1-30.",
                        }
                    },
                },
                handler=list_repos,
            ),
            Tool(
                name="github_read_file",
                description=(
                    "Read a file or list a directory inside a GitHub "
                    "repository. Give the repo as owner/name."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "repo": {
                            "type": "string",
                            "description": "Repository in owner/name form.",
                        },
                        "path": {
                            "type": "string",
                            "description": "File or directory path, e.g. app/api.py.",
                        },
                        "ref": {
                            "type": "string",
                            "description": "Optional branch, tag or commit.",
                        },
                    },
                    "required": ["repo", "path"],
                },
                handler=read_file,
            ),
            Tool(
                name="github_search_code",
                description="Search code across the user's GitHub repositories.",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "GitHub code search query.",
                        },
                        "limit": {"type": "integer"},
                    },
                    "required": ["query"],
                },
                handler=search_code,
            ),
            Tool(
                name="github_list_issues",
                description="List issues in a repository.",
                parameters={
                    "type": "object",
                    "properties": {
                        "repo": {"type": "string", "description": "owner/name"},
                        "state": {
                            "type": "string",
                            "enum": ["open", "closed", "all"],
                        },
                        "limit": {"type": "integer"},
                    },
                    "required": ["repo"],
                },
                handler=list_issues,
            ),
            Tool(
                name="github_create_issue",
                description=(
                    "Open a new issue in a repository. Only use this when the "
                    "user clearly asks you to create an issue."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "repo": {"type": "string", "description": "owner/name"},
                        "title": {"type": "string"},
                        "body": {"type": "string"},
                    },
                    "required": ["repo", "title"],
                },
                handler=create_issue,
                write=True,
            ),
        ]
