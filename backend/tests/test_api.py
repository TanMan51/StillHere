"""API tests. Owner: Person A. Run from backend/:  python -m pytest tests/test_api.py"""

import json
from pathlib import Path

import pytest
from app import clock
from app.main import app
from fastapi.testclient import TestClient

FIXTURES = Path(__file__).resolve().parents[2] / "contract" / "fixtures"
TOKEN = {"X-Device-Token": "dev-fridge-1"}


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture()
def client():
    with TestClient(app) as c:
        c.post("/api/demo", json={"enabled": False})
        c.post("/api/demo/reset")
        for device_id in ("fridge-1", "walker-1", "door-1"):
            c.patch(f"/api/devices/{device_id}", json={"limit_minutes": 720})
        for contact in c.get("/api/contacts").json():
            c.delete(f"/api/contacts/{contact['id']}")
        yield c
    clock.disable()


def test_device_shapes_match_fixtures(client):
    body = client.get("/api/devices").json()
    expected = fixture("devices.json")
    assert set(body) == set(expected)
    assert set(body["devices"][0]) == set(expected["devices"][0])

    detail = client.get("/api/devices/fridge-1").json()
    expected = fixture("device_detail.json")
    assert set(detail["device"]) == set(expected["device"])
    assert set(detail["device"]["baseline"]) == set(expected["device"]["baseline"])


def test_event_requires_matching_token(client):
    body = {"device_id": "fridge-1", "type": "motion", "level": 1.8}
    assert client.post("/api/events", json=body).status_code == 401
    assert (
        client.post(
            "/api/events", json=body, headers={"X-Device-Token": "dev-walker-1"}
        ).status_code
        == 401
    )
    missing = {**body, "device_id": "nope"}
    assert client.post("/api/events", json=missing, headers=TOKEN).status_code == 404


def test_every_example_event_is_accepted(client):
    for example in fixture("event_examples.json"):
        headers = {"X-Device-Token": f"dev-{example['device_id']}"}
        assert client.post("/api/events", json=example, headers=headers).status_code == 202


def test_reply_without_value_is_rejected(client):
    body = {"device_id": "fridge-1", "type": "reply"}
    assert client.post("/api/events", json=body, headers=TOKEN).status_code == 422


def test_motion_and_heartbeat_update_device(client):
    client.post(
        "/api/events", json={"device_id": "fridge-1", "type": "motion", "level": 1.8}, headers=TOKEN
    )
    client.post("/api/events", json={"device_id": "fridge-1", "type": "heartbeat"}, headers=TOKEN)
    device = client.get("/api/devices/fridge-1").json()["device"]
    assert device["last_motion_at"].endswith("Z")
    assert device["last_heartbeat_at"].endswith("Z")
    assert device["online"] is True
    assert device["next_alert_at"] is not None
    assert 0 < device["seconds_until_alert"] <= 720 * 60
    assert [e["type"] for e in device["events"]] == ["motion"]  # heartbeats excluded


def test_patch_device_validates_limit(client):
    ok = client.patch("/api/devices/fridge-1", json={"limit_minutes": 360})
    assert ok.status_code == 200 and ok.json()["device"]["limit_minutes"] == 360
    assert client.patch("/api/devices/fridge-1", json={"limit_minutes": 5}).status_code == 422
    assert client.patch("/api/devices/nope", json={"name": "x"}).status_code == 404


def test_contacts_crud(client):
    assert client.post("/api/contacts", json={"name": "Sam", "phone": "404-555"}).status_code == 422
    created = client.post("/api/contacts", json={"name": "Sam", "phone": "+14045550123"})
    assert created.status_code == 201
    contact = created.json()
    assert set(contact) == set(fixture("contacts.json")[0])
    test = client.post(f"/api/contacts/{contact['id']}/test").json()
    assert test == {"ok": True, "channel": "sms"}
    assert client.delete(f"/api/contacts/{contact['id']}").status_code == 204
    assert client.get("/api/contacts").json() == []


def test_demo_clock_runs_fast(client):
    body = client.post(
        "/api/demo", json={"enabled": True, "start_clock_at": "2026-09-26T11:00:00Z"}
    ).json()
    assert set(body) == set(fixture("demo.json"))
    assert body["enabled"] is True and body["time_scale"] == 1440
    assert body["server_now"] >= "2026-09-26T11:00:00Z"
    client.post("/api/events", json={"device_id": "fridge-1", "type": "motion"}, headers=TOKEN)
    device = client.get("/api/devices/fridge-1").json()["device"]
    # A 12-hour limit is about 30 real seconds at 1440x.
    assert 25 <= device["seconds_until_alert"] <= 30


def test_seed_and_reset(client):
    assert client.post("/api/demo/seed", json={"device_id": "fridge-1"}).json()["ok"] is True
    assert client.post("/api/demo/seed", json={"device_id": "nope"}).status_code == 404
    assert client.post("/api/demo/reset").json() == {"ok": True}


def test_failed_test_text_returns_twilio_reason(client, monkeypatch):
    from app import notify

    def fail(to, body):
        raise notify.SmsError("Twilio error 21608: The number is unverified.")

    monkeypatch.setattr(notify, "send_sms", fail)
    contact = client.post("/api/contacts", json={"name": "Sam", "phone": "+14045550123"}).json()
    response = client.post(f"/api/contacts/{contact['id']}/test")
    assert response.status_code == 502
    assert response.json() == {"detail": "Twilio error 21608: The number is unverified."}


def test_simpletexting_request_shape(monkeypatch):
    import json

    from app import config, notify

    sent = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self):
            return b'{"id": "abc"}'

    def fake_urlopen(request, timeout):
        sent["url"] = request.full_url
        sent["auth"] = request.get_header("Authorization")
        sent["body"] = json.loads(request.data)
        return FakeResponse()

    monkeypatch.setattr(config, "SIMPLETEXTING_API_KEY", "test-key")
    monkeypatch.setattr(config, "SIMPLETEXTING_FROM_NUMBER", "+14695550000")
    monkeypatch.setattr(notify.urllib.request, "urlopen", fake_urlopen)

    assert notify.send_sms("+14045550123", "hello") == "sms"
    assert sent["url"] == config.SIMPLETEXTING_API_URL
    assert sent["auth"] == "Bearer test-key"
    assert sent["body"] == {
        "contactPhone": "4045550123",
        "accountPhone": "4695550000",
        "mode": "AUTO",
        "text": "hello",
    }
