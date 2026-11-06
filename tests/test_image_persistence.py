"""Tests for generated-image persistence.

These run entirely offline: Supabase and the Cloudflare call are replaced with
in-memory fakes, so the storage/DB flow can be checked without touching the
real project.
"""

import base64
import json
import os
import sys
import pathlib

import pytest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service-role-test")
os.environ.setdefault("GROQ_API_KEY", "groq-test")
os.environ.setdefault("CF_ACCOUNT_ID", "cf-account")
os.environ.setdefault("CF_API_TOKEN", "cf-token")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app import api  # noqa: E402
from app import images as image_store  # noqa: E402


PNG_B64 = base64.b64encode(b"\x89PNG\r\n\x1a\nfake-image-bytes").decode()


class FakeResponse:
    def __init__(self, data):
        self.data = data
        self.count = len(data)


class FakeQuery:
    def __init__(self, rows, mode="select", payload=None):
        self.rows = rows
        self.mode = mode
        self.payload = payload
        self.filters = []
        self.max_rows = None
        self.order_field = None

    def select(self, *args, **kwargs):
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def limit(self, value):
        self.max_rows = value
        return self

    def order(self, field, desc=False):
        self.order_field = field
        return self

    def insert(self, payload):
        rows = payload if isinstance(payload, list) else [payload]
        for row in rows:
            self.rows.append(dict(row))
        self.mode = "insert"
        return self

    def execute(self):
        if self.mode == "insert":
            return FakeResponse(list(self.rows))

        matched = [
            row
            for row in self.rows
            if all(row.get(field) == value for field, value in self.filters)
        ]
        if self.order_field:
            matched = sorted(matched, key=lambda row: row.get(self.order_field) or "")
        if self.max_rows is not None:
            matched = matched[: self.max_rows]
        return FakeResponse(list(matched))


class FakeTable:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *args, **kwargs):
        return FakeQuery(self.rows)

    def insert(self, payload):
        return FakeQuery(self.rows, mode="insert").insert(payload)


class FakeBucketClient:
    def __init__(self, storage):
        self.storage = storage

    def upload(self, path, data, options=None):
        self.storage.uploads.append((path, data, options))

    def create_signed_url(self, path, expires_in):
        self.storage.signed_requests.append((path, expires_in))
        if self.storage.sign_fails:
            raise RuntimeError("object not found")
        return {"signedURL": f"https://storage.test/{path}?token=fresh"}


class FakeStorage:
    def __init__(self):
        self.uploads = []
        self.signed_requests = []
        self.buckets = []
        self.create_fails = None
        self.sign_fails = False

    def create_bucket(self, name, options=None):
        if self.create_fails:
            raise RuntimeError(self.create_fails)
        self.buckets.append((name, options))

    def from_(self, name):
        self.last_bucket = name
        return FakeBucketClient(self)


class FakeSupabase:
    def __init__(self):
        self.tables = {"conversations": [], "messages": []}
        self.storage = FakeStorage()

    def table(self, name):
        return FakeTable(self.tables[name])


class FakeUser:
    def __init__(self, user_id):
        self.id = user_id
        self.email = "victoria@example.com"
        self.app_metadata = {}


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(api, "supabase", fake)

    user_id = "user-1"
    monkeypatch.setattr(api, "get_current_user", lambda authorization: FakeUser(user_id))

    # Cloudflare returns a base64 PNG
    class FakeCF:
        status_code = 200

        def json(self):
            return {"success": True, "result": {"image": PNG_B64}}

        def raise_for_status(self):
            return None

    monkeypatch.setattr(api.httpx, "post", lambda *a, **k: FakeCF())

    monkeypatch.setattr(image_store, "_bucket_ready", False)

    fake.tables["conversations"].append(
        {"id": "conv-1", "user_id": user_id, "title": "New conversation"}
    )
    fake.tables["conversations"].append(
        {"id": "conv-other", "user_id": "someone-else", "title": "Not mine"}
    )

    fake.tables["messages"].append(
        {"conversation_id": "conv-1", "role": "user", "content": "hello"}
    )
    fake.tables["messages"].append(
        {"conversation_id": "conv-1", "role": "assistant", "content": "hi Victoria"}
    )

    return fake


def client():
    return TestClient(api.app)


def test_image_is_stored_and_linked_to_conversation(setup):
    response = client().post(
        "/image",
        json={"prompt": "a red bicycle", "conversation_id": "conv-1"},
        headers={"Authorization": "Bearer token"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["stored"] is True
    assert body["image"] == PNG_B64           # unchanged response shape
    assert body["image_url"].startswith("https://storage.test/user-1/conv-1/")

    # uploaded to the private bucket under the user + conversation
    path, data, options = setup.storage.uploads[0]
    assert path.startswith("user-1/conv-1/")
    assert path.endswith(".png")
    assert data == base64.b64decode(PNG_B64)
    assert options["content-type"] == "image/png"
    assert setup.storage.buckets == [("chat-images", {"public": False})]

    # a row was written before the request finished
    rows = [r for r in setup.tables["messages"] if image_store.is_image_message(r["content"])]
    assert len(rows) == 1
    payload = image_store.parse_image_message(rows[0]["content"])
    assert payload["path"] == path
    assert payload["prompt"] == "a red bicycle"
    assert rows[0]["role"] == "assistant"


def test_image_for_someone_elses_conversation_is_rejected(setup):
    response = client().post(
        "/image",
        json={"prompt": "a cat", "conversation_id": "conv-other"},
        headers={"Authorization": "Bearer token"},
    )

    assert response.status_code == 404
    assert setup.storage.uploads == []
    assert not any(
        image_store.is_image_message(r["content"]) for r in setup.tables["messages"]
    )


def test_history_rebuilds_the_image_with_a_fresh_url(setup):
    client().post(
        "/image",
        json={"prompt": "a red bicycle", "conversation_id": "conv-1"},
        headers={"Authorization": "Bearer token"},
    )

    response = client().get(
        "/conversation/conv-1/messages",
        headers={"Authorization": "Bearer token"},
    )

    assert response.status_code == 200
    messages = response.json()["messages"]

    assert [m["role"] for m in messages] == ["user", "assistant", "assistant"]
    assert messages[0]["content"] == "hello"
    assert messages[1]["content"] == "hi Victoria"

    image_message = messages[2]
    assert image_message["content"] == ""
    assert image_message["image"]["prompt"] == "a red bicycle"
    assert image_message["image"]["available"] is True
    assert image_message["image"]["url"].startswith("https://storage.test/user-1/conv-1/")

    # every load asks for a new signed URL instead of reusing a stored one
    assert len(setup.storage.signed_requests) >= 2


def test_history_refuses_another_users_conversation(setup):
    response = client().get(
        "/conversation/conv-other/messages",
        headers={"Authorization": "Bearer token"},
    )
    assert response.status_code == 404


def test_missing_stored_image_degrades_gracefully(setup):
    setup.tables["messages"].append({
        "conversation_id": "conv-1",
        "role": "assistant",
        "content": image_store.build_message_content(
            "user-1/conv-1/gone.png", "a lost image"
        ),
    })
    setup.storage.sign_fails = True

    response = client().get(
        "/conversation/conv-1/messages",
        headers={"Authorization": "Bearer token"},
    )

    assert response.status_code == 200
    image_message = response.json()["messages"][-1]
    assert image_message["image"]["available"] is False
    assert image_message["image"]["url"] is None
    assert image_message["image"]["prompt"] == "a lost image"


def test_image_rows_are_not_sent_to_the_language_model(setup, monkeypatch):
    client().post(
        "/image",
        json={"prompt": "a red bicycle", "conversation_id": "conv-1"},
        headers={"Authorization": "Bearer token"},
    )

    captured = {}

    def fake_run_chat(**kwargs):
        captured["messages"] = kwargs["messages"]
        return "sure thing"

    monkeypatch.setattr(api, "run_chat_with_plugins", fake_run_chat)

    response = client().post(
        "/chat",
        json={"conversation_id": "conv-1", "message": "what is next?"},
        headers={"Authorization": "Bearer token"},
    )

    assert response.status_code == 200, response.text
    joined = json.dumps(captured["messages"])
    assert "vic-image" not in joined
    assert "<user>/<conversation>" not in joined


def test_generation_still_works_when_storage_is_unavailable(setup):
    setup.storage.create_fails = "permission denied"

    response = client().post(
        "/image",
        json={"prompt": "a cat", "conversation_id": "conv-1"},
        headers={"Authorization": "Bearer token"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["stored"] is False
    assert body["image"] == PNG_B64          # the picture still shows
    assert "could not be saved" in body["warning"]


def test_image_without_conversation_reports_it_is_not_saved(setup):
    response = client().post(
        "/image",
        json={"prompt": "a cat"},
        headers={"Authorization": "Bearer token"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["stored"] is False
    assert "not saved" in body["warning"]
    assert setup.storage.uploads == []
