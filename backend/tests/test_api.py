"""API tests. Owner: Person A. Run from backend/:  python -m pytest tests/test_api.py"""

import json
from pathlib import Path

import pytest
from app import clock, config
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
            c.patch(
                f"/api/devices/{device_id}",
                json={"limit_minutes": 720, "sound_enabled": True, "motion_sensitivity": "medium"},
            )
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
    minutes_only = client.patch("/api/devices/fridge-1", json={"limit_minutes": 30})
    assert minutes_only.status_code == 200
    assert minutes_only.json()["device"]["limit_minutes"] == 30
    assert client.patch("/api/devices/fridge-1", json={"limit_minutes": 0}).status_code == 422
    assert client.patch("/api/devices/fridge-1", json={"limit_minutes": 2881}).status_code == 422
    assert client.patch("/api/devices/nope", json={"name": "x"}).status_code == 404


def test_patch_device_sensor_settings(client):
    ok = client.patch(
        "/api/devices/fridge-1", json={"sound_enabled": False, "motion_sensitivity": "high"}
    )
    assert ok.status_code == 200
    assert ok.json()["device"]["sound_enabled"] is False
    assert ok.json()["device"]["motion_sensitivity"] == "high"
    bad = client.patch("/api/devices/fridge-1", json={"motion_sensitivity": "extreme"})
    assert bad.status_code == 422


def test_event_response_carries_device_settings(client):
    client.patch("/api/devices/fridge-1", json={"motion_sensitivity": "low"})
    body = {"device_id": "fridge-1", "type": "heartbeat"}
    res = client.post("/api/events", json=body, headers=TOKEN)
    assert res.json() == {
        "ok": True,
        "settings": {"sound_enabled": True, "motion_sensitivity": "low"},
    }


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


# --- Alert state machine -------------------------------------------------------------------


def _event(client, body):
    body = {"device_id": "fridge-1", **body}
    assert client.post("/api/events", json=body, headers=TOKEN).status_code == 202


def _fridge(client):
    return client.get("/api/devices/fridge-1").json()["device"]


def _jump_clock(client, iso):
    client.post("/api/demo", json={"enabled": True, "start_clock_at": iso})


def test_motion_silence_alert_motion_all_clear(client):
    from app import checker

    client.post("/api/contacts", json={"name": "Sam", "phone": "+14045550123"})
    _jump_clock(client, "2026-09-26T00:00:00Z")
    _event(client, {"type": "motion"})
    checker.check_all()
    assert _fridge(client)["status"] == "ok"

    _jump_clock(client, "2026-09-26T12:30:00Z")  # 12.5 h of silence, limit is 12 h
    checker.check_all()
    checker.check_all()  # a second pass must not fire again
    device = _fridge(client)
    assert device["status"] == "inactive_alert"
    assert device["active_alert"]["kind"] == "inactivity"
    assert device["active_alert"]["sms_sent"] is True
    assert device["next_alert_at"] is None
    assert [a["kind"] for a in device["alerts"]] == ["inactivity"]

    _event(client, {"type": "motion"})
    device = _fridge(client)
    assert device["status"] == "ok"
    assert device["active_alert"] is None
    kinds = {a["kind"]: a for a in device["alerts"]}
    assert kinds["inactivity"]["resolved_by"] == "motion"
    assert kinds["all_clear"]["sms_sent"] is True


def test_loud_then_ok_button_is_false_alarm(client):
    _event(client, {"type": "motion"})
    _event(client, {"type": "loud", "level": 2400})
    assert _fridge(client)["status"] == "awaiting_reply"
    _event(client, {"type": "reply", "value": "ok_button"})
    device = _fridge(client)
    assert device["status"] == "ok"
    assert device["alerts"][0]["kind"] == "false_alarm"
    assert device["alerts"][0]["sms_sent"] is False


def test_loud_ignored_when_sound_disabled(client):
    client.patch("/api/devices/fridge-1", json={"sound_enabled": False})
    _event(client, {"type": "loud", "level": 2400})
    device = _fridge(client)
    assert device["status"] == "ok"
    assert device["events"][0]["type"] == "loud"  # still recorded
    _event(client, {"type": "fall", "level": 9})
    assert _fridge(client)["status"] == "awaiting_reply"  # falls always count


def test_loud_then_help_is_urgent(client):
    client.post("/api/contacts", json={"name": "Sam", "phone": "+14045550123"})
    _event(client, {"type": "loud", "level": 2400})
    _event(client, {"type": "reply", "value": "help"})
    device = _fridge(client)
    assert device["status"] == "urgent"
    assert device["active_alert"]["kind"] == "urgent"
    assert device["active_alert"]["sms_sent"] is True


def test_fall_then_silence_sends_no_reply(client, monkeypatch):
    from datetime import timedelta

    from app import checker, config

    monkeypatch.setattr(config, "REPLY_WINDOW", timedelta(seconds=0))
    _event(client, {"type": "motion"})
    _event(client, {"type": "fall", "level": 3.7})
    checker.check_all()
    device = _fridge(client)
    assert device["status"] == "no_reply_alert"
    assert device["active_alert"]["kind"] == "no_reply"
    assert "Possible fall detected" in device["active_alert"]["message"]

    _event(client, {"type": "motion"})
    assert _fridge(client)["status"] == "ok"


def test_loud_no_reply_text_says_loud_sound(client, monkeypatch):
    from datetime import timedelta

    from app import checker, config

    monkeypatch.setattr(config, "REPLY_WINDOW", timedelta(seconds=0))
    _event(client, {"type": "loud", "level": 2400})
    checker.check_all()
    assert "Loud sound" in _fridge(client)["active_alert"]["message"]


def test_family_resolve_returns_device_to_ok(client):
    _event(client, {"type": "reply", "value": "help"})
    alert_id = _fridge(client)["active_alert"]["id"]
    assert client.post(f"/api/alerts/{alert_id}/resolve").json() == {"ok": True}
    device = _fridge(client)
    assert device["status"] == "ok"
    assert device["alerts"][0]["resolved_by"] == "family"


def test_family_check_in_counts_as_activity(client):
    from app import checker

    client.post("/api/contacts", json={"name": "Sam", "phone": "+14045550123"})
    _jump_clock(client, "2026-09-26T00:00:00Z")
    _event(client, {"type": "motion"})
    _jump_clock(client, "2026-09-26T12:30:00Z")
    checker.check_all()
    alert_id = _fridge(client)["active_alert"]["id"]

    client.post(f"/api/alerts/{alert_id}/resolve")
    checker.check_all()  # the old gap must not fire a fresh inactivity alert
    device = _fridge(client)
    assert device["status"] == "ok"
    assert device["last_motion_at"] >= "2026-09-26T12:30:00Z"  # demo clock keeps running
    assert device["events"][0]["type"] == "motion"


def test_silent_device_goes_offline_then_recovers(client, monkeypatch):
    from datetime import timedelta

    from app import checker, config

    _event(client, {"type": "heartbeat"})
    monkeypatch.setattr(config, "OFFLINE_AFTER", timedelta(seconds=-1))
    checker.check_all()
    device = _fridge(client)
    assert device["status"] == "offline"
    assert device["active_alert"]["kind"] == "offline"

    monkeypatch.setattr(config, "OFFLINE_AFTER", timedelta(hours=2))
    _event(client, {"type": "heartbeat"})
    device = _fridge(client)
    assert device["status"] == "ok"
    assert device["alerts"][0]["resolved_by"] == "heartbeat"


def test_one_bad_device_does_not_stop_the_loop(client, monkeypatch):
    from app import alerts, checker

    checked = []
    real_check = alerts.check_device

    def flaky(session, device):
        checked.append(device.id)
        if device.id == "door-1":
            raise RuntimeError("boom")
        real_check(session, device)

    monkeypatch.setattr(alerts, "check_device", flaky)
    checker.check_all()
    assert sorted(checked) == ["door-1", "fridge-1", "walker-1"]


def _email_only(monkeypatch):
    from app import config, notify

    monkeypatch.setattr(config, "SMTP_USER", "stillhere@example.com")
    monkeypatch.setattr(config, "SMTP_PASSWORD", "app-password")
    monkeypatch.setattr(config, "ALERT_EMAILS", ["family@example.com"])
    emails = []
    monkeypatch.setattr(
        notify, "send_email", lambda subject, body: emails.append((subject, body)) or "email"
    )
    return emails


def test_alerts_fall_back_to_email_without_sms_provider(client, monkeypatch):
    emails = _email_only(monkeypatch)
    client.post("/api/contacts", json={"name": "Sam", "phone": "+14045550123"})
    _event(client, {"type": "reply", "value": "help"})
    assert _fridge(client)["active_alert"]["sms_sent"] is True
    assert emails and emails[0][0] == "URGENT: StillHere alert"


def test_alerts_fall_back_to_email_when_texts_fail(client, monkeypatch):
    from app import config, notify

    emails = _email_only(monkeypatch)
    monkeypatch.setattr(config, "SIMPLETEXTING_API_KEY", "test-key")

    def fail(to, body):
        raise notify.SmsError("SimpleTexting error 403: API access not enabled")

    monkeypatch.setattr(notify, "send_sms", fail)
    contact = client.post("/api/contacts", json={"name": "Sam", "phone": "+14045550123"}).json()
    _event(client, {"type": "reply", "value": "help"})
    assert len(emails) == 1
    assert client.post(f"/api/contacts/{contact['id']}/test").json() == {
        "ok": True,
        "channel": "email",
    }


def _fake_urlopen(monkeypatch, reply: bytes):
    from app import notify

    sent = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self):
            return reply

    def fake(request, timeout):
        sent["url"] = request.full_url
        sent["data"] = request.data
        return FakeResponse()

    monkeypatch.setattr(notify.urllib.request, "urlopen", fake)
    return sent


def test_textbelt_request_and_error(monkeypatch):
    from urllib.parse import parse_qs

    from app import config, notify

    monkeypatch.setattr(config, "TEXTBELT_API_KEY", "tb-key")
    sent = _fake_urlopen(monkeypatch, b'{"success": true, "textId": "1", "quotaRemaining": 9}')
    assert notify.send_sms("+14045550123", "hello") == "sms"
    assert sent["url"] == config.TEXTBELT_API_URL
    assert parse_qs(sent["data"].decode()) == {
        "phone": ["+14045550123"],
        "message": ["hello"],
        "key": ["tb-key"],
    }

    _fake_urlopen(monkeypatch, b'{"success": false, "error": "Out of quota"}')
    with pytest.raises(notify.SmsError, match="Out of quota"):
        notify.send_sms("+14045550123", "hello")


def test_textbelt_text_has_no_link_lookalikes(monkeypatch):
    from urllib.parse import parse_qs

    from app import config, messages, notify

    monkeypatch.setattr(config, "TEXTBELT_API_KEY", "tb-key")
    sent = _fake_urlopen(monkeypatch, b'{"success": true, "textId": "1", "quotaRemaining": 9}')
    notify.send_sms("+14045550123", messages.test_message("VB"))
    assert parse_qs(sent["data"].decode())["message"] == [
        "StillHere: Hi VB, this is a test; you'll get alerts at this number."
    ]
    assert notify.textbelt_text("Level 3.7 at 8:30 AM. AM check. I'm ok.") == (
        "Level 3.7 at 8:30 AM; AM check; I'm ok."
    )


def test_resend_email_request(monkeypatch):
    import json

    from app import config, notify

    monkeypatch.setattr(config, "RESEND_API_KEY", "re_test")
    monkeypatch.setattr(config, "EMAIL_FROM", "StillHere <onboarding@resend.dev>")
    monkeypatch.setattr(config, "ALERT_EMAILS", ["family@example.com"])
    sent = _fake_urlopen(monkeypatch, b'{"id": "email-1"}')
    assert notify.email_configured() is True
    assert notify.send_email("StillHere alert", "hello") == "email"
    assert sent["url"] == config.RESEND_API_URL
    assert json.loads(sent["data"]) == {
        "from": "StillHere <onboarding@resend.dev>",
        "to": ["family@example.com"],
        "subject": "StillHere alert",
        "text": "hello",
    }


def test_frontend_routes_fall_back_to_index(tmp_path):
    from app.main import mount_frontend
    from fastapi import FastAPI

    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("js")
    (tmp_path / "index.html").write_text("<html>dashboard</html>")
    (tmp_path / "manifest.webmanifest").write_text("{}")
    app = FastAPI()
    mount_frontend(app, tmp_path)
    web = TestClient(app)

    assert web.get("/").text == "<html>dashboard</html>"
    assert web.get("/demo").text == "<html>dashboard</html>"
    assert web.get("/assets/app.js").text == "js"
    assert web.get("/manifest.webmanifest").text == "{}"
    assert web.get("/api/nope").status_code == 404
    assert web.get("/../backend/app/config.py").text == "<html>dashboard</html>"


def _login(client, email):
    res = client.post("/api/auth/login", json={"email": email, "password": "stillhere-demo"})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['token']}"}


FAMILY = "demo@stillhere.example"
PROVIDER = "staff@maplegrove.example"


def test_login_returns_role_and_rejects_bad_password(client):
    res = client.post("/api/auth/login", json={"email": PROVIDER, "password": "stillhere-demo"})
    assert res.json()["user"]["role"] == "provider"
    assert res.json()["user"]["community_name"] == "Maple Grove Senior Living"
    assert set(res.json()) == set(fixture("auth_login.json"))
    bad = client.post("/api/auth/login", json={"email": PROVIDER, "password": "nope"})
    assert bad.status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    me = client.get("/api/auth/me", headers=_login(client, FAMILY)).json()["user"]
    assert me["role"] == "family" and me["resident_id"] == "mg-204"


def test_family_sees_only_their_resident(client):
    family = _login(client, FAMILY)
    ids = {d["id"] for d in client.get("/api/devices", headers=family).json()["devices"]}
    assert ids == {"fridge-1", "walker-1", "door-1"}
    assert client.get("/api/devices/sim-101", headers=family).status_code == 404
    residents = client.get("/api/residents", headers=family).json()
    assert [r["id"] for r in residents] == ["mg-204"]
    assert set(residents[0]) == set(fixture("residents.json")[0])


def test_provider_sees_whole_community(client):
    provider = _login(client, PROVIDER)
    devices = client.get("/api/devices", headers=provider).json()["devices"]
    assert {"fridge-1", "sim-101", "sim-308"} <= {d["id"] for d in devices}
    assert len(client.get("/api/residents", headers=provider).json()) == 24


def test_open_requests_still_see_everything(client):
    ids = {d["id"] for d in client.get("/api/devices").json()["devices"]}
    assert {"fridge-1", "sim-101"} <= ids


def test_auth_required_rejects_open_requests(client, monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    assert client.get("/api/devices").status_code == 401
    assert client.get("/api/devices", headers=_login(client, FAMILY)).status_code == 200


def test_bad_token_is_rejected(client):
    bad = {"Authorization": "Bearer 1.9999999999.forged"}
    assert client.get("/api/devices", headers=bad).status_code == 401


def test_sharing_hides_activity_and_alerts_from_family_only(client):
    _event(client, {"type": "motion"})
    client.patch(
        "/api/residents/mg-204",
        json={"share_activity_with_family": False, "share_alerts_with_family": False},
    )
    try:
        family = client.get("/api/devices/fridge-1", headers=_login(client, FAMILY)).json()
        assert family["device"]["events"] == []
        provider = client.get("/api/devices/fridge-1", headers=_login(client, PROVIDER)).json()
        assert [e["type"] for e in provider["device"]["events"]] == ["motion"]
    finally:
        client.patch(
            "/api/residents/mg-204",
            json={"share_activity_with_family": True, "share_alerts_with_family": True},
        )


def test_check_loop_skips_simulated_devices(client):
    from app import checker

    client.post("/api/demo", json={"enabled": True, "time_scale": 1_000_000})
    checker.check_all()
    sim = client.get("/api/devices/sim-101").json()["device"]
    assert sim["alerts"] == [] and sim["status"] == "ok"


def test_grid_state_rules():
    from app.community import grid_state

    assert grid_state(30, True, False, 240, 480) == "fine"
    assert grid_state(300, True, False, 240, 480) == "watch"
    assert grid_state(480, True, False, 240, 480) == "worry"
    assert grid_state(None, True, False, 240, 480) == "worry"
    assert grid_state(30, False, False, 240, 480) == "offline"  # offline beats "fine"
    assert grid_state(30, False, True, 240, 480) == "urgent"  # urgent beats everything


def _grid(client):
    res = client.get("/api/community", headers=_login(client, PROVIDER))
    assert res.status_code == 200
    return {u["unit"]: u for u in res.json()["units"]}


def test_community_grid_has_seeded_mix(client):
    units = _grid(client)
    assert len(units) == 24
    states = [u["state"] for u in units.values()]
    assert states.count("urgent") == 1 and units["305"]["active_alert"]["kind"] == "urgent"
    assert units["208"]["state"] == "offline"
    assert units["106"]["state"] == "worry" and units["103"]["state"] == "watch"
    assert states.count("fine") >= 12
    assert units["101"]["first_name"] == "Harold" and units["101"]["device_id"] == "sim-101"
    assert set(units["101"]) == set(fixture("community.json")["units"][0])


def test_community_is_for_providers_only(client):
    assert client.get("/api/community").status_code == 401
    assert client.get("/api/community", headers=_login(client, FAMILY)).status_code == 403


def test_community_thresholds_are_configurable(client):
    provider = _login(client, PROVIDER)
    try:
        bad = client.patch("/api/community", json={"watch_after_minutes": 600}, headers=provider)
        assert bad.status_code == 422  # yellow must come before red
        ok = client.patch(
            "/api/community",
            json={"watch_after_minutes": 5, "worry_after_minutes": 10},
            headers=provider,
        )
        assert ok.json()["worry_after_minutes"] == 10
        assert _grid(client)["101"]["state"] == "worry"
    finally:
        client.patch(
            "/api/community",
            json={"watch_after_minutes": 240, "worry_after_minutes": 480},
            headers=provider,
        )


def test_demo_clock_moves_grid_colors(client):
    before = _grid(client)["101"]
    assert before["state"] == "fine"
    client.post("/api/demo", json={"enabled": True, "time_scale": 3600 * 24})
    import time

    time.sleep(0.5)  # half a real second is 12 demo hours at this speed
    assert _grid(client)["101"]["state"] == "worry"


# --- Staff alert handling, routing, escalation ---


def _texts(monkeypatch):
    """Capture every text instead of sending it."""
    from app import notify

    sent = []
    monkeypatch.setattr(notify, "send_sms", lambda to, body: sent.append((to, body)) or "sms")
    return sent


def _set_community(client, **settings):
    res = client.patch("/api/community", json=settings, headers=_login(client, PROVIDER))
    assert res.status_code == 200, res.text


@pytest.fixture()
def on_call(client):
    _set_community(client, on_call_phone="+15550100000", escalate_after_minutes=10)
    client.post("/api/contacts", json={"name": "Sam", "phone": "+14045550123"})
    yield "+15550100000"
    _set_community(client, on_call_phone="", escalate_after_minutes=10)
    client.patch("/api/residents/mg-204", json={"family_notify": "immediately"})


def test_urgent_alert_pages_on_call_staff_first_then_family(client, monkeypatch, on_call):
    sent = _texts(monkeypatch)
    _event(client, {"type": "reply", "value": "help"})
    assert [to for to, _ in sent] == [on_call, "+14045550123"]


def test_family_waits_for_staff_when_resident_prefers(client, monkeypatch, on_call):
    from app import checker

    client.patch("/api/residents/mg-204", json={"family_notify": "if_unanswered"})
    sent = _texts(monkeypatch)
    _event(client, {"type": "reply", "value": "help"})
    assert [to for to, _ in sent] == [on_call]
    # Nobody acknowledges within the window: it escalates to the family.
    monkeypatch.setattr(clock, "real_now", lambda: datetime_now_plus(minutes=11))
    checker.check_all()
    assert sent[-1][0] == "+14045550123"
    assert sent[-1][1].startswith("StillHere: not yet acknowledged after 10 minutes.")
    alert = _fridge(client)["active_alert"]
    assert alert["escalation_level"] == 1


def datetime_now_plus(**delta):
    from datetime import datetime, timedelta, timezone

    return datetime.now(timezone.utc) + timedelta(**delta)


def test_acknowledged_alert_does_not_escalate(client, monkeypatch, on_call):
    from app import checker

    sent = _texts(monkeypatch)
    _event(client, {"type": "reply", "value": "help"})
    alert_id = _fridge(client)["active_alert"]["id"]
    staff = _login(client, PROVIDER)
    ack = client.post(f"/api/alerts/{alert_id}/acknowledge", headers=staff).json()
    assert ack["acknowledged_by"] == "Maple Grove wellness staff" and ack["acknowledged_at"]
    before = len(sent)
    monkeypatch.setattr(clock, "real_now", lambda: datetime_now_plus(minutes=30))
    checker.check_all()
    assert len(sent) == before
    assert client.post(f"/api/alerts/{alert_id}/resolve", headers=staff).json() == {"ok": True}
    resolved = _fridge(client)["alerts"][0]
    assert resolved["resolved_by"] == "staff" and _fridge(client)["status"] == "ok"


def test_only_staff_can_acknowledge(client):
    _event(client, {"type": "reply", "value": "help"})
    alert_id = _fridge(client)["active_alert"]["id"]
    family = _login(client, FAMILY)
    assert client.post(f"/api/alerts/{alert_id}/acknowledge", headers=family).status_code == 403


def test_community_settings_validate(client):
    staff = _login(client, PROVIDER)
    for bad in ({"on_call_phone": "555"}, {"checkin_time": "25:00"}, {"escalate_after_minutes": 0}):
        assert client.patch("/api/community", json=bad, headers=staff).status_code == 422


# --- Morning check-in, wellness trends, visit summary ---


def test_checkin_since_is_latest_local_checkin_time():
    from datetime import datetime, timezone

    from app.community import checkin_since

    after = datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc)  # 11:00 in New York
    before = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)  # 08:00 in New York
    assert checkin_since("10:00", after, "America/New_York").isoformat().startswith("2026-09-26T14")
    assert (
        checkin_since("10:00", before, "America/New_York").isoformat().startswith("2026-09-25T14")
    )


def test_checkin_list_is_quiet_residents_longest_first(client):
    body = client.get("/api/community", headers=_login(client, PROVIDER)).json()
    by_id = {u["resident_id"]: u for u in body["units"]}
    listed = body["checkin"]["resident_ids"]
    minutes = [by_id[r]["minutes_since_motion"] for r in listed if by_id[r]["minutes_since_motion"]]
    assert minutes == sorted(minutes, reverse=True)
    assert "mg-101" not in listed  # moved minutes ago


def test_trend_flags_quieter_residents_and_community_response_times(client):
    body = client.get("/api/community", headers=_login(client, PROVIDER)).json()
    lower = {u["unit"] for u in body["units"] if u["activity_lower_than_usual"]}
    assert lower == {"102", "303"}
    stats = body["response_times"]
    assert stats["acknowledged"] >= 4 and stats["average_acknowledge_seconds"] > 0


def test_resident_summary_for_visit(client):
    staff = _login(client, PROVIDER)
    summary = client.get("/api/residents/mg-104/summary", headers=staff).json()
    assert set(summary) == set(fixture("resident_summary.json"))
    assert len(summary["trend"]["days"]) == 30
    assert summary["alerts"][0]["acknowledged_by"] == "Maple Grove wellness staff"
    assert summary["response_times"]["average_acknowledge_seconds"] == 180
    family = _login(client, FAMILY)
    assert client.get("/api/residents/mg-104/summary", headers=family).status_code == 404
    client.patch("/api/residents/mg-204", json={"share_activity_with_family": False})
    try:
        mine = client.get("/api/residents/mg-204/summary", headers=family).json()
        assert mine["trend"] is None
    finally:
        client.patch("/api/residents/mg-204", json={"share_activity_with_family": True})


# --- Weather-aware check-ins ---

CONDITIONS_SAMPLE = {
    "temperature_f": 97.0,
    "feels_like_f": 104.0,
    "description": "Clear",
    "observed_at": None,
}

NWS_SAMPLE = [
    {"properties": {"id": "urn:flood", "event": "Flood Watch", "headline": "Flood Watch"}},
    {
        "id": "https://api.weather.gov/alerts/urn:heat",
        "properties": {
            "id": "urn:heat",
            "event": "Heat Advisory",
            "headline": "Heat Advisory issued September 26 until 8:00PM EDT",
            "ends": "2099-09-26T20:00:00-04:00",
        },
    },
]


def test_pick_advisory_keeps_heat_and_cold_only():
    from app.weather import pick_advisory

    advisory = pick_advisory(NWS_SAMPLE)
    assert advisory["event"] == "Heat Advisory" and advisory["id"] == "urn:heat"
    assert advisory["ends_at"].isoformat() == "2099-09-27T00:00:00+00:00"
    assert pick_advisory(NWS_SAMPLE[:1]) is None  # a flood watch doesn't count


@pytest.fixture()
def heat(client):
    staff = _login(client, PROVIDER)
    yield staff
    client.post("/api/community/weather/simulate", json={"kind": None}, headers=staff)


def test_nws_refresh_tightens_thresholds_and_checkin(client, monkeypatch, heat):
    from app import weather
    from app.db import engine
    from sqlmodel import Session

    monkeypatch.setattr(weather, "fetch_features", lambda lat, lon: NWS_SAMPLE)
    monkeypatch.setattr(weather, "fetch_conditions", lambda lat, lon: CONDITIONS_SAMPLE)
    with Session(engine) as session:
        weather.refresh(session)
        session.commit()
    try:
        body = client.get("/api/community", headers=heat).json()
        assert body["weather"]["event"] == "Heat Advisory" and body["weather"]["source"] == "nws"
        assert (body["weather"]["watch_after_minutes"], body["weather"]["worry_after_minutes"]) == (
            120,
            240,
        )
        units = {u["unit"]: u for u in body["units"]}
        assert units["103"]["state"] == "worry"  # 5h quiet: yellow normally, red during heat
        assert body["checkin"]["reason"] == "weather"
        assert "mg-103" in body["checkin"]["resident_ids"]
    finally:
        monkeypatch.setattr(weather, "fetch_features", lambda lat, lon: [])
        with Session(engine) as session:
            weather.refresh(session)
            session.commit()
    assert client.get("/api/community", headers=heat).json()["weather"] is None


def test_simulated_heat_texts_family_once_for_real_sensors_only(client, monkeypatch, heat):
    from app import checker

    sent = _texts(monkeypatch)
    client.post("/api/contacts", json={"name": "Sam", "phone": "+14045550123"})
    _event(client, {"type": "heartbeat"})  # Rosa's sensor is online but hasn't moved
    res = client.post("/api/community/weather/simulate", json={"kind": "heat"}, headers=heat)
    assert res.json()["weather"]["source"] == "simulated"
    checker.check_all()
    checker.check_all()  # a second pass must not text again
    assert len(sent) == 1  # only Rosa (real sensor); 23 simulated apartments stay silent
    to, body = sent[0]
    assert to == "+14045550123"
    assert body.startswith("StillHere: Heat Advisory in effect. Rosa's apartment")


def test_simulate_weather_is_for_staff(client):
    family = _login(client, FAMILY)
    res = client.post("/api/community/weather/simulate", json={"kind": "heat"}, headers=family)
    assert res.status_code == 403


def test_reset_during_fast_demo_then_turning_it_off_keeps_the_mix(client):
    import time

    client.post("/api/demo", json={"enabled": True, "time_scale": 3600 * 24})
    time.sleep(0.2)  # the fast clock runs hours ahead of real time
    client.post("/api/demo/reset")
    client.post("/api/demo", json={"enabled": False})
    units = _grid(client)
    assert all((u["minutes_since_motion"] or 0) >= 0 for u in units.values())
    assert units["106"]["state"] == "worry" and units["103"]["state"] == "watch"


def test_conditions_are_read_from_open_meteo(monkeypatch):
    from app import weather

    sample = {
        "current": {
            "time": "2026-09-26T18:00",
            "temperature_2m": 97.2,
            "apparent_temperature": 104.5,
            "weather_code": 2,
        }
    }
    monkeypatch.setattr(weather, "_get_json", lambda *a, **k: sample)
    now = weather.fetch_conditions(33.77, -84.39)
    assert (now["temperature_f"], now["feels_like_f"], now["description"]) == (
        97.2,
        104.5,
        "Partly cloudy",
    )
    assert now["observed_at"].isoformat() == "2026-09-26T18:00:00+00:00"


def test_community_shows_conditions_after_refresh(client, monkeypatch, heat):
    from app import weather
    from app.db import engine
    from sqlmodel import Session

    monkeypatch.setattr(weather, "fetch_features", lambda lat, lon: [])
    monkeypatch.setattr(weather, "fetch_conditions", lambda lat, lon: CONDITIONS_SAMPLE)
    with Session(engine) as session:
        weather.refresh(session)
        session.commit()
    body = client.get("/api/community", headers=heat).json()
    assert body["conditions"]["temperature_f"] == 97.0
    assert body["community"]["location_name"] == "Atlanta, GA"


def test_city_search_and_choosing_a_location(client, monkeypatch, heat):
    from app import weather

    decatur = {"name": "Decatur, Georgia", "latitude": 33.7748, "longitude": -84.2963}
    monkeypatch.setattr(weather, "search_places", lambda query: [decatur])
    assert client.get("/api/places?query=Decatur", headers=heat).json() == [decatur]
    assert client.get("/api/places?query=D", headers=heat).status_code == 422
    family = _login(client, FAMILY)
    assert client.get("/api/places?query=Decatur", headers=family).status_code == 403
    try:
        res = client.patch(
            "/api/community",
            json={"latitude": 33.7748, "longitude": -84.2963, "location_name": "Decatur, Georgia"},
            headers=heat,
        )
        assert res.json()["location_name"] == "Decatur, Georgia"
        # Coordinates alone (from "Use my current location") still get a readable name.
        monkeypatch.setattr(config, "WEATHER_ENABLED", True)
        monkeypatch.setattr(weather, "place_name", lambda lat, lon: "Macon, GA")
        monkeypatch.setattr(weather, "refresh_community", lambda community: None)
        res = client.patch(
            "/api/community", json={"latitude": 32.84, "longitude": -83.63}, headers=heat
        )
        assert res.json()["location_name"] == "Macon, GA"
    finally:
        client.patch(
            "/api/community",
            json={"latitude": 33.7756, "longitude": -84.3963, "location_name": "Atlanta, GA"},
            headers=heat,
        )


def test_texts_name_the_resident_not_mom(client, monkeypatch):
    sent = _texts(monkeypatch)
    client.post("/api/contacts", json={"name": "Sam", "phone": "+14045550123"})
    assert _fridge(client)["name"] == "Rosa's fridge"
    _event(client, {"type": "reply", "value": "help"})
    assert (
        sent[-1][1]
        == "URGENT from StillHere: Rosa asked for help near Rosa's fridge. Please call now."
    )
    assert "Mom" not in sent[-1][1]


def test_saved_alerts_lose_the_old_family_name():
    from app import demo_community
    from app.db import engine
    from app.models import Alert
    from sqlmodel import Session

    with Session(engine) as session:
        old = Alert(
            device_id="fridge-1",
            kind="offline",
            message="StillHere: Mom's fridge sensor is offline.",
            sent_at=clock.now(),
        )
        session.add(old)
        session.commit()
        demo_community.ensure(session)
        session.refresh(old)
        assert old.message == "StillHere: Rosa's fridge sensor is offline."
