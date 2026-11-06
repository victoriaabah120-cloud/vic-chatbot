"""Integration providers."""

from .base import Provider, Tool, ToolCallResult
from .github import GitHubProvider
from .telegram import TelegramProvider

__all__ = [
    "Provider",
    "Tool",
    "ToolCallResult",
    "GitHubProvider",
    "TelegramProvider",
]
