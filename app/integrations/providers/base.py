"""Shared types for integration providers."""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


@dataclass
class ToolCallResult:
    """What a tool returns to the model."""

    data: Any
    error: Optional[str] = None


@dataclass
class Tool:
    """One capability the model may call, e.g. github_list_repos."""

    name: str
    description: str
    parameters: Dict[str, Any]
    handler: Callable[..., Any]
    write: bool = False

    def spec(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def run(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        try:
            return {"ok": True, "result": self.handler(**(arguments or {}))}
        except Exception as error:  # noqa: BLE001 - surfaced to the model
            return {"ok": False, "error": f"{type(error).__name__}: {error}"}


@dataclass
class Provider:
    """A connectable service."""

    id: str
    name: str
    auth: str  # "oauth2" or "bot"
    description: str
    scopes: List[str] = field(default_factory=list)

    def is_configured(self) -> bool:  # pragma: no cover - overridden
        return False

    def build_authorize_url(self, state: str, redirect_uri: str) -> str:
        raise NotImplementedError

    def exchange_code(self, code: str, redirect_uri: str) -> Dict[str, Any]:
        raise NotImplementedError

    def fetch_account_label(self, access_token: str) -> str:
        return ""

    def tools(self, access_token: str) -> List[Tool]:
        return []
