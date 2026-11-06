"""Provider catalogue. Add a service by registering it here."""

from typing import Dict, List

from .providers import GitHubProvider, Provider, TelegramProvider

_PROVIDERS: Dict[str, Provider] = {
    "github": GitHubProvider(),
    "telegram": TelegramProvider(),
}


def all_providers() -> List[Provider]:
    return list(_PROVIDERS.values())


def get_provider(provider_id: str) -> Provider:
    provider = _PROVIDERS.get(provider_id)
    if provider is None:
        raise KeyError(f"Unknown integration provider: {provider_id}")
    return provider


def register(provider: Provider) -> None:
    """Register another provider (used by tests and future services)."""
    _PROVIDERS[provider.id] = provider
