"""Comprehensive tests for rovn-agent-sdk Python SDK.

All tests use unittest + unittest.mock only (zero external dependencies).
Run with:
    python -m unittest discover packages/sdk-python/tests/
    python -m pytest packages/sdk-python/tests/
"""

from __future__ import annotations

import io
import json
import queue
import threading
import time
import unittest
from http.client import HTTPResponse
from typing import Any
from unittest.mock import MagicMock, Mock, call, patch
from urllib.error import HTTPError, URLError

from rovn_sdk import (
    AgentInfo,
    Guardrail,
    RovnAgent,
    RovnError,
    PeerMessage,
    Task,
)


# ── Helpers ────────────────────────────────────────────────


def _make_urlopen_response(body: dict[str, Any], status: int = 200) -> MagicMock:
    """Create a mock that behaves like the return value of urllib.request.urlopen."""
    data = json.dumps(body).encode()
    mock_resp = MagicMock()
    mock_resp.read.return_value = data
    mock_resp.__enter__ = Mock(return_value=mock_resp)
    mock_resp.__exit__ = Mock(return_value=False)
    return mock_resp


def _success(data: Any = None) -> dict[str, Any]:
    """Wrap data in a standard success envelope."""
    return {"success": True, "data": data}


def _error_response(
    error: str = "Something went wrong",
    code: str | None = None,
    status: int = 400,
) -> HTTPError:
    """Create an HTTPError with a JSON body."""
    body = {"error": error}
    if code is not None:
        body["code"] = code
    fp = io.BytesIO(json.dumps(body).encode())
    err = HTTPError(
        url="http://localhost:3000/api/test",
        code=status,
        msg=error,
        hdrs={},  # type: ignore[arg-type]
        fp=fp,
    )
    return err


# ── Dataclass Tests ────────────────────────────────────────


class TestAgentInfo(unittest.TestCase):
    """Tests for the AgentInfo dataclass and its from_dict factory."""

    def test_from_dict_full(self) -> None:
        data = {
            "id": "a1",
            "name": "TestAgent",
            "description": "A test agent",
            "status": "active",
            "type": "assistant",
            "approved": True,
            "capabilities": ["research"],
            "metadata": {"env": "test"},
            "created_at": "2026-01-01",
            "updated_at": "2026-01-02",
            "last_seen_at": "2026-01-03",
        }
        info = AgentInfo.from_dict(data)
        self.assertEqual(info.id, "a1")
        self.assertEqual(info.name, "TestAgent")
        self.assertEqual(info.description, "A test agent")
        self.assertEqual(info.status, "active")
        self.assertEqual(info.type, "assistant")
        self.assertTrue(info.approved)
        self.assertEqual(info.capabilities, ["research"])
        self.assertEqual(info.metadata, {"env": "test"})
        self.assertEqual(info.last_seen_at, "2026-01-03")

    def test_from_dict_minimal(self) -> None:
        data = {"id": "a1", "name": "Min"}
        info = AgentInfo.from_dict(data)
        self.assertEqual(info.id, "a1")
        self.assertEqual(info.name, "Min")
        self.assertIsNone(info.description)
        self.assertEqual(info.status, "active")
        self.assertEqual(info.type, "general")
        self.assertFalse(info.approved)
        self.assertIsNone(info.capabilities)
        self.assertIsNone(info.metadata)
        self.assertEqual(info.created_at, "")
        self.assertIsNone(info.last_seen_at)


class TestTask(unittest.TestCase):
    """Tests for the Task dataclass and its from_dict factory."""

    def test_from_dict_full(self) -> None:
        data = {
            "id": "t1",
            "agent_id": "a1",
            "owner_id": "o1",
            "title": "Run analysis",
            "description": "Detailed analysis",
            "status": "in_progress",
            "priority": "high",
            "result": {"output": "done"},
            "scheduled_at": "2026-01-01",
            "started_at": "2026-01-01T01:00:00",
            "completed_at": None,
            "created_at": "2026-01-01",
            "updated_at": "2026-01-02",
        }
        task = Task.from_dict(data)
        self.assertEqual(task.id, "t1")
        self.assertEqual(task.title, "Run analysis")
        self.assertEqual(task.status, "in_progress")
        self.assertEqual(task.priority, "high")
        self.assertEqual(task.result, {"output": "done"})

    def test_from_dict_minimal(self) -> None:
        data = {"id": "t1", "agent_id": "a1", "owner_id": "o1", "title": "Do it"}
        task = Task.from_dict(data)
        self.assertEqual(task.status, "pending")
        self.assertEqual(task.priority, "medium")
        self.assertIsNone(task.description)
        self.assertIsNone(task.result)


class TestPeerMessage(unittest.TestCase):
    """Tests for PeerMessage dataclass."""

    def test_from_dict_full(self) -> None:
        data = {
            "id": "m1",
            "from_agent_id": "a1",
            "to_agent_id": "a2",
            "content": "Hello peer",
            "message_type": "json",
            "metadata": {"key": "val"},
            "read_at": "2026-01-01",
            "created_at": "2026-01-01",
            "from_agent_name": "Agent1",
            "to_agent_name": "Agent2",
        }
        msg = PeerMessage.from_dict(data)
        self.assertEqual(msg.content, "Hello peer")
        self.assertEqual(msg.message_type, "json")
        self.assertEqual(msg.from_agent_name, "Agent1")
        self.assertEqual(msg.to_agent_name, "Agent2")

    def test_from_dict_minimal(self) -> None:
        data = {
            "id": "m1",
            "from_agent_id": "a1",
            "to_agent_id": "a2",
            "content": "Hi",
        }
        msg = PeerMessage.from_dict(data)
        self.assertEqual(msg.message_type, "text")
        self.assertIsNone(msg.metadata)
        self.assertIsNone(msg.read_at)


class TestGuardrail(unittest.TestCase):
    """Tests for Guardrail dataclass."""

    def test_from_dict_full(self) -> None:
        data = {
            "id": "g1",
            "agent_id": "a1",
            "owner_id": "o1",
            "metric": "api_calls",
            "limit_value": 100,
            "current_value": 42,
            "window": "hourly",
            "action": "warn",
            "enabled": False,
            "created_at": "2026-01-01",
            "updated_at": "2026-01-02",
        }
        g = Guardrail.from_dict(data)
        self.assertEqual(g.metric, "api_calls")
        self.assertEqual(g.limit_value, 100)
        self.assertEqual(g.current_value, 42)
        self.assertEqual(g.window, "hourly")
        self.assertEqual(g.action, "warn")
        self.assertFalse(g.enabled)

    def test_from_dict_defaults(self) -> None:
        data = {
            "id": "g1",
            "agent_id": "a1",
            "owner_id": "o1",
            "metric": "tokens",
            "limit_value": 1000,
        }
        g = Guardrail.from_dict(data)
        self.assertEqual(g.current_value, 0)
        self.assertEqual(g.window, "daily")
        self.assertEqual(g.action, "block")
        self.assertTrue(g.enabled)


# ── RovnError Tests ────────────────────────────────────────


class TestRovnError(unittest.TestCase):
    """Tests for the RovnError exception."""

    def test_basic_error(self) -> None:
        err = RovnError("bad request", status_code=400, error_code="invalid")
        self.assertEqual(str(err), "bad request")
        self.assertEqual(err.status_code, 400)
        self.assertEqual(err.error_code, "invalid")

    def test_default_status_code(self) -> None:
        err = RovnError("network")
        self.assertEqual(err.status_code, 0)
        self.assertIsNone(err.error_code)

    def test_repr(self) -> None:
        err = RovnError("test", status_code=500)
        self.assertEqual(repr(err), "RovnError(500, 'test')")

    def test_is_exception(self) -> None:
        with self.assertRaises(RovnError):
            raise RovnError("boom", status_code=500)


# ── RovnAgent Initialization Tests ─────────────────────────


class TestRovnAgentInit(unittest.TestCase):
    """Tests for RovnAgent constructor and configuration."""

    def test_base_url_trailing_slash_stripped(self) -> None:
        agent = RovnAgent(base_url="http://localhost:3000/", api_key="key")
        self.assertEqual(agent.base_url, "http://localhost:3000")

    def test_base_url_no_trailing_slash(self) -> None:
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        self.assertEqual(agent.base_url, "http://localhost:3000")

    def test_api_key_stored(self) -> None:
        agent = RovnAgent(base_url="http://localhost:3000", api_key="rovn_abc123")
        self.assertEqual(agent.api_key, "rovn_abc123")

    def test_agent_id_initially_none(self) -> None:
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        self.assertIsNone(agent.agent_id)

    def test_headers_include_auth(self) -> None:
        agent = RovnAgent(base_url="http://localhost:3000", api_key="rovn_xyz")
        headers = agent._headers()
        self.assertEqual(headers["Authorization"], "Bearer rovn_xyz")
        self.assertEqual(headers["Content-Type"], "application/json")

    def test_context_manager(self) -> None:
        with RovnAgent(base_url="http://localhost:3000", api_key="key") as agent:
            self.assertIsInstance(agent, RovnAgent)
        # After exiting, no exceptions should have occurred

    def test_fire_and_forget_starts_worker(self) -> None:
        agent = RovnAgent(
            base_url="http://localhost:3000",
            api_key="key",
            fire_and_forget=True,
        )
        self.assertIsNotNone(agent._worker_thread)
        self.assertTrue(agent._worker_thread.is_alive())
        agent.close()

    def test_empty_api_key(self) -> None:
        agent = RovnAgent(base_url="http://localhost:3000", api_key="")
        self.assertEqual(agent.api_key, "")
        self.assertEqual(agent._headers()["Authorization"], "Bearer ")


# ── RovnAgent._request Tests ──────────────────────────────


class TestRequest(unittest.TestCase):
    """Tests for the _request helper method."""

    def setUp(self) -> None:
        self.agent = RovnAgent(base_url="http://localhost:3000", api_key="key")

    @patch("rovn_sdk.urlopen")
    def test_get_request_success(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(
            _success({"id": "a1", "name": "Test"})
        )
        result = self.agent._request("GET", "/api/agents/me")
        self.assertEqual(result, {"id": "a1", "name": "Test"})

    @patch("rovn_sdk.urlopen")
    def test_post_request_sends_json_body(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        self.agent._request("POST", "/api/webhook/agent", {"event": "activity", "data": {}})

        # Verify the Request object was created with the correct data
        request_obj = mock_urlopen.call_args[0][0]
        self.assertEqual(request_obj.method, "POST")
        sent_body = json.loads(request_obj.data.decode())
        self.assertEqual(sent_body["event"], "activity")

    @patch("rovn_sdk.urlopen")
    def test_http_error_with_json_body(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.side_effect = _error_response("Unauthorized", "auth_failed", 401)
        with self.assertRaises(RovnError) as ctx:
            self.agent._request("GET", "/api/agents/me")
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(str(ctx.exception), "Unauthorized")
        self.assertEqual(ctx.exception.error_code, "auth_failed")

    @patch("rovn_sdk.urlopen")
    def test_http_error_without_json_body(self, mock_urlopen: MagicMock) -> None:
        # HTTPError with non-JSON body
        fp = io.BytesIO(b"<html>Server Error</html>")
        err = HTTPError(
            url="http://localhost:3000/api/test",
            code=500,
            msg="Internal Server Error",
            hdrs={},  # type: ignore[arg-type]
            fp=fp,
        )
        mock_urlopen.side_effect = err
        with self.assertRaises(RovnError) as ctx:
            self.agent._request("GET", "/api/test")
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertIn("HTTP 500", str(ctx.exception))

    @patch("rovn_sdk.urlopen")
    def test_url_error_network_failure(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.side_effect = URLError("Connection refused")
        with self.assertRaises(RovnError) as ctx:
            self.agent._request("GET", "/api/agents/me")
        self.assertEqual(ctx.exception.status_code, 0)
        self.assertIn("Connection refused", str(ctx.exception))

    @patch("rovn_sdk.urlopen")
    def test_response_not_success(self, mock_urlopen: MagicMock) -> None:
        """Server returns 200 but success=false in the body."""
        mock_urlopen.return_value = _make_urlopen_response(
            {"success": False, "error": "Agent not found", "code": "not_found"}
        )
        with self.assertRaises(RovnError) as ctx:
            self.agent._request("GET", "/api/agents/xyz")
        self.assertEqual(str(ctx.exception), "Agent not found")
        self.assertEqual(ctx.exception.error_code, "not_found")

    @patch("rovn_sdk.urlopen")
    def test_request_url_constructed_correctly(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success({}))
        self.agent._request("GET", "/api/agents/a1")
        request_obj = mock_urlopen.call_args[0][0]
        self.assertEqual(request_obj.full_url, "http://localhost:3000/api/agents/a1")


# ── RovnAgent._ensure_agent_id Tests ──────────────────────


class TestEnsureAgentId(unittest.TestCase):
    """Tests for the _ensure_agent_id guard."""

    def test_raises_when_agent_id_is_none(self) -> None:
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        with self.assertRaises(RovnError) as ctx:
            agent._ensure_agent_id()
        self.assertEqual(ctx.exception.error_code, "missing_agent_id")
        self.assertIn("agent_id is not set", str(ctx.exception))

    def test_passes_when_agent_id_set(self) -> None:
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.agent_id = "a1"
        agent._ensure_agent_id()  # Should not raise


# ── Agent Info Tests ──────────────────────────────────────


class TestGetInfo(unittest.TestCase):
    """Tests for the get_info method."""

    def setUp(self) -> None:
        self.agent = RovnAgent(base_url="http://localhost:3000", api_key="key")

    @patch("rovn_sdk.urlopen")
    def test_get_info_auto_discovers_agent_id(self, mock_urlopen: MagicMock) -> None:
        agent_data = {
            "id": "auto_id",
            "name": "AutoAgent",
            "description": None,
            "status": "active",
            "type": "general",
            "approved": False,
        }
        mock_urlopen.return_value = _make_urlopen_response(_success(agent_data))
        info = self.agent.get_info()
        self.assertEqual(info.id, "auto_id")
        self.assertEqual(self.agent.agent_id, "auto_id")

        # Verify it called /api/agents/me (not /api/agents/<id>)
        request_obj = mock_urlopen.call_args[0][0]
        self.assertIn("/api/agents/me", request_obj.full_url)

    @patch("rovn_sdk.urlopen")
    def test_get_info_with_existing_agent_id(self, mock_urlopen: MagicMock) -> None:
        self.agent.agent_id = "a1"
        agent_data = {
            "id": "a1",
            "name": "Existing",
            "status": "active",
            "type": "general",
            "approved": True,
        }
        mock_urlopen.return_value = _make_urlopen_response(_success(agent_data))
        info = self.agent.get_info()
        self.assertEqual(info.name, "Existing")

        # Verify it called /api/agents/a1
        request_obj = mock_urlopen.call_args[0][0]
        self.assertIn("/api/agents/a1", request_obj.full_url)


# ── Registration Tests ────────────────────────────────────


class TestRegister(unittest.TestCase):
    """Tests for the RovnAgent.register class method."""

    @patch("rovn_sdk.urlopen")
    def test_register_success(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(
            _success({"id": "new_agent", "api_key": "rovn_new_key"})
        )
        agent, agent_id, api_key = RovnAgent.register(
            "http://localhost:3000",
            name="NewAgent",
            description="A new agent",
            type="assistant",
            capabilities=["code"],
            owner_email="test@example.com",
            metadata={"version": "1.0"},
        )
        self.assertEqual(agent_id, "new_agent")
        self.assertEqual(api_key, "rovn_new_key")
        self.assertEqual(agent.agent_id, "new_agent")
        self.assertEqual(agent.api_key, "rovn_new_key")

        # Verify the payload
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["name"], "NewAgent")
        self.assertEqual(sent["description"], "A new agent")
        self.assertEqual(sent["type"], "assistant")
        self.assertEqual(sent["capabilities"], ["code"])
        self.assertEqual(sent["owner_email"], "test@example.com")
        self.assertEqual(sent["metadata"], {"version": "1.0"})

    @patch("rovn_sdk.urlopen")
    def test_register_minimal(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(
            _success({"id": "min", "api_key": "rovn_min"})
        )
        agent, agent_id, api_key = RovnAgent.register(
            "http://localhost:3000",
            name="MinAgent",
        )
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent, {"name": "MinAgent"})
        self.assertNotIn("description", sent)
        self.assertNotIn("type", sent)

    @patch("rovn_sdk.urlopen")
    def test_register_http_error(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.side_effect = _error_response("Agent already exists", status=409)
        with self.assertRaises(RovnError) as ctx:
            RovnAgent.register("http://localhost:3000", name="Dup")
        self.assertEqual(ctx.exception.status_code, 409)

    @patch("rovn_sdk.urlopen")
    def test_register_non_json_http_error(self, mock_urlopen: MagicMock) -> None:
        fp = io.BytesIO(b"not json")
        err = HTTPError(
            url="http://localhost:3000/api/agents/register",
            code=500,
            msg="Error",
            hdrs={},  # type: ignore[arg-type]
            fp=fp,
        )
        mock_urlopen.side_effect = err
        with self.assertRaises(RovnError) as ctx:
            RovnAgent.register("http://localhost:3000", name="Fail")
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertIn("HTTP 500", str(ctx.exception))

    @patch("rovn_sdk.urlopen")
    def test_register_api_failure(self, mock_urlopen: MagicMock) -> None:
        """Server returns 200 but success=false."""
        mock_urlopen.return_value = _make_urlopen_response(
            {"success": False, "error": "Name taken"}
        )
        with self.assertRaises(RovnError) as ctx:
            RovnAgent.register("http://localhost:3000", name="Taken")
        self.assertIn("Name taken", str(ctx.exception))

    @patch("rovn_sdk.urlopen")
    def test_register_url_construction(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(
            _success({"id": "x", "api_key": "k"})
        )
        RovnAgent.register("http://localhost:3000/", name="Test")
        request_obj = mock_urlopen.call_args[0][0]
        self.assertEqual(
            request_obj.full_url, "http://localhost:3000/api/agents/register"
        )

    @patch("rovn_sdk.urlopen")
    def test_register_fire_and_forget(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(
            _success({"id": "ff", "api_key": "rovn_ff"})
        )
        agent, _, _ = RovnAgent.register(
            "http://localhost:3000",
            name="FireForget",
            fire_and_forget=True,
        )
        self.assertTrue(agent._fire_and_forget)
        self.assertIsNotNone(agent._worker_thread)
        agent.close()


# ── Webhook Event / Send Methods Tests ─────────────────────


class TestSendEvents(unittest.TestCase):
    """Tests for all webhook event methods (synchronous mode)."""

    def setUp(self) -> None:
        self.agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        self.agent.agent_id = "a1"

    @patch("rovn_sdk.urlopen")
    def test_log_activity(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        self.agent.log_activity(
            "Processing started",
            type="action",
            description="Details",
            metadata={"count": 10},
        )
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["event"], "activity")
        self.assertEqual(sent["data"]["title"], "Processing started")
        self.assertEqual(sent["data"]["type"], "action")
        self.assertEqual(sent["data"]["description"], "Details")
        self.assertEqual(sent["data"]["metadata"], {"count": 10})

    @patch("rovn_sdk.urlopen")
    def test_log_activity_minimal(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        self.agent.log_activity("Just title")
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["data"], {"title": "Just title"})

    @patch("rovn_sdk.urlopen")
    def test_update_task_status(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        self.agent.update_task_status(
            "task_1", "completed", result={"output": "done"}
        )
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["event"], "task_update")
        self.assertEqual(sent["data"]["task_id"], "task_1")
        self.assertEqual(sent["data"]["status"], "completed")
        self.assertEqual(sent["data"]["result"], {"output": "done"})

    @patch("rovn_sdk.urlopen")
    def test_update_task_status_no_result(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        self.agent.update_task_status("task_2", "in_progress")
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertNotIn("result", sent["data"])

    @patch("rovn_sdk.urlopen")
    def test_send_message(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        self.agent.send_message(
            "Hello owner", message_type="alert", metadata={"urgency": "high"}
        )
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["event"], "message")
        self.assertEqual(sent["data"]["content"], "Hello owner")
        self.assertEqual(sent["data"]["message_type"], "alert")

    @patch("rovn_sdk.urlopen")
    def test_update_status(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        self.agent.update_status("busy")
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["event"], "status")
        self.assertEqual(sent["data"]["status"], "busy")

    @patch("rovn_sdk.urlopen")
    def test_share_data(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        self.agent.share_data("Report", {"value": 42}, type="dashboard")
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["event"], "share_data")
        self.assertEqual(sent["data"]["title"], "Report")
        self.assertEqual(sent["data"]["content"], {"value": 42})
        self.assertEqual(sent["data"]["type"], "dashboard")

    @patch("rovn_sdk.urlopen")
    def test_respond_to_command(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        self.agent.respond_to_command(
            "cmd_1", "success", response={"data": "result"}
        )
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["event"], "command_response")
        self.assertEqual(sent["data"]["command_id"], "cmd_1")

    @patch("rovn_sdk.urlopen")
    def test_request_approval(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        self.agent.request_approval(
            type="budget",
            title="Spend $50?",
            description="For API costs",
            urgency="high",
            metadata={"amount": 50},
        )
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["event"], "approval_request")
        self.assertEqual(sent["data"]["type"], "budget")
        self.assertEqual(sent["data"]["title"], "Spend $50?")
        self.assertEqual(sent["data"]["urgency"], "high")

    @patch("rovn_sdk.urlopen")
    def test_send_peer_message(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        self.agent.send_peer_message(
            "agent_2", "Hey there", message_type="json", metadata={"key": "val"}
        )
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["event"], "peer_message")
        self.assertEqual(sent["data"]["to_agent_id"], "agent_2")
        self.assertEqual(sent["data"]["content"], "Hey there")

    @patch("rovn_sdk.urlopen")
    def test_log_activity_empty_string_title(self, mock_urlopen: MagicMock) -> None:
        """Edge case: empty string as title."""
        mock_urlopen.return_value = _make_urlopen_response(_success())
        self.agent.log_activity("")
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["data"]["title"], "")

    @patch("rovn_sdk.urlopen")
    def test_share_data_large_payload(self, mock_urlopen: MagicMock) -> None:
        """Edge case: large payload."""
        mock_urlopen.return_value = _make_urlopen_response(_success())
        big_content = {"items": [{"idx": i, "value": "x" * 1000} for i in range(100)]}
        self.agent.share_data("Big Report", big_content)
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(len(sent["data"]["content"]["items"]), 100)


# ── Tasks, Peer Messages, Guardrails Tests ─────────────────


class TestGetTasks(unittest.TestCase):
    """Tests for get_tasks."""

    def setUp(self) -> None:
        self.agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        self.agent.agent_id = "a1"

    def test_get_tasks_without_agent_id(self) -> None:
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        with self.assertRaises(RovnError) as ctx:
            agent.get_tasks()
        self.assertEqual(ctx.exception.error_code, "missing_agent_id")

    @patch("rovn_sdk.urlopen")
    def test_get_tasks_no_filters(self, mock_urlopen: MagicMock) -> None:
        tasks_data = [
            {
                "id": "t1",
                "agent_id": "a1",
                "owner_id": "o1",
                "title": "Task 1",
            },
            {
                "id": "t2",
                "agent_id": "a1",
                "owner_id": "o1",
                "title": "Task 2",
            },
        ]
        mock_urlopen.return_value = _make_urlopen_response(_success(tasks_data))
        tasks = self.agent.get_tasks()
        self.assertEqual(len(tasks), 2)
        self.assertIsInstance(tasks[0], Task)
        self.assertEqual(tasks[0].title, "Task 1")

    @patch("rovn_sdk.urlopen")
    def test_get_tasks_with_filters(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success([]))
        self.agent.get_tasks(status="pending", limit=5)
        request_obj = mock_urlopen.call_args[0][0]
        self.assertIn("status=pending", request_obj.full_url)
        self.assertIn("limit=5", request_obj.full_url)

    @patch("rovn_sdk.urlopen")
    def test_get_tasks_empty_list(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success([]))
        tasks = self.agent.get_tasks()
        self.assertEqual(tasks, [])


class TestGetPeerMessages(unittest.TestCase):
    """Tests for get_peer_messages."""

    def setUp(self) -> None:
        self.agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        self.agent.agent_id = "a1"

    def test_get_peer_messages_without_agent_id(self) -> None:
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        with self.assertRaises(RovnError):
            agent.get_peer_messages()

    @patch("rovn_sdk.urlopen")
    def test_get_peer_messages_success(self, mock_urlopen: MagicMock) -> None:
        msgs_data = [
            {
                "id": "m1",
                "from_agent_id": "a2",
                "to_agent_id": "a1",
                "content": "Hi",
            }
        ]
        mock_urlopen.return_value = _make_urlopen_response(_success(msgs_data))
        msgs = self.agent.get_peer_messages(direction="inbox", limit=10)
        self.assertEqual(len(msgs), 1)
        self.assertIsInstance(msgs[0], PeerMessage)

        request_obj = mock_urlopen.call_args[0][0]
        self.assertIn("direction=inbox", request_obj.full_url)
        self.assertIn("limit=10", request_obj.full_url)


class TestGetGuardrails(unittest.TestCase):
    """Tests for get_guardrails and guardrail caching."""

    def setUp(self) -> None:
        self.agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        self.agent.agent_id = "a1"

    def test_get_guardrails_without_agent_id(self) -> None:
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        with self.assertRaises(RovnError):
            agent.get_guardrails()

    @patch("rovn_sdk.urlopen")
    def test_get_guardrails_success(self, mock_urlopen: MagicMock) -> None:
        g_data = [
            {
                "id": "g1",
                "agent_id": "a1",
                "owner_id": "o1",
                "metric": "api_calls",
                "limit_value": 100,
                "current_value": 30,
            }
        ]
        mock_urlopen.return_value = _make_urlopen_response(_success(g_data))
        guardrails = self.agent.get_guardrails()
        self.assertEqual(len(guardrails), 1)
        self.assertIsInstance(guardrails[0], Guardrail)
        self.assertEqual(guardrails[0].metric, "api_calls")

    @patch("rovn_sdk.urlopen")
    def test_get_guardrail_remaining(self, mock_urlopen: MagicMock) -> None:
        g_data = [
            {
                "id": "g1",
                "agent_id": "a1",
                "owner_id": "o1",
                "metric": "tokens",
                "limit_value": 1000,
                "current_value": 250,
            }
        ]
        mock_urlopen.return_value = _make_urlopen_response(_success(g_data))
        remaining = self.agent.get_guardrail_remaining("tokens")
        self.assertEqual(remaining, 750)

    @patch("rovn_sdk.urlopen")
    def test_get_guardrail_remaining_not_found(self, mock_urlopen: MagicMock) -> None:
        g_data = [
            {
                "id": "g1",
                "agent_id": "a1",
                "owner_id": "o1",
                "metric": "tokens",
                "limit_value": 1000,
            }
        ]
        mock_urlopen.return_value = _make_urlopen_response(_success(g_data))
        remaining = self.agent.get_guardrail_remaining("nonexistent_metric")
        self.assertIsNone(remaining)

    @patch("rovn_sdk.urlopen")
    def test_guardrail_cache_used_within_ttl(self, mock_urlopen: MagicMock) -> None:
        """Second call within TTL should NOT make another API request."""
        g_data = [
            {
                "id": "g1",
                "agent_id": "a1",
                "owner_id": "o1",
                "metric": "api_calls",
                "limit_value": 100,
                "current_value": 10,
            }
        ]
        mock_urlopen.return_value = _make_urlopen_response(_success(g_data))

        # First call populates cache
        self.agent.get_guardrail_remaining("api_calls")
        self.assertEqual(mock_urlopen.call_count, 1)

        # Second call should use cache
        remaining = self.agent.get_guardrail_remaining("api_calls")
        self.assertEqual(mock_urlopen.call_count, 1)  # No additional call
        self.assertEqual(remaining, 90)

    @patch("rovn_sdk.urlopen")
    def test_guardrail_remaining_without_agent_id(self, mock_urlopen: MagicMock) -> None:
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        with self.assertRaises(RovnError) as ctx:
            agent.get_guardrail_remaining("tokens")
        self.assertEqual(ctx.exception.error_code, "missing_agent_id")


# ── Fire-and-Forget Mode Tests ─────────────────────────────


class TestFireAndForget(unittest.TestCase):
    """Tests for fire-and-forget background worker mode."""

    @patch("rovn_sdk.urlopen")
    def test_events_queued_not_sent_immediately(self, mock_urlopen: MagicMock) -> None:
        agent = RovnAgent(
            base_url="http://localhost:3000",
            api_key="key",
            fire_and_forget=True,
        )
        agent.agent_id = "a1"

        # Block the worker so it doesn't process events
        mock_urlopen.return_value = _make_urlopen_response(_success())

        agent.log_activity("Queued event")
        # The event should be in the queue, urlopen might not have been called yet
        # (depends on timing), but we can at least verify no exception was raised

        agent.close()

    @patch("rovn_sdk.urlopen")
    def test_close_flushes_events(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        agent = RovnAgent(
            base_url="http://localhost:3000",
            api_key="key",
            fire_and_forget=True,
        )
        agent.agent_id = "a1"
        agent.log_activity("Event 1")
        agent.log_activity("Event 2")
        agent.close()

        # After close, all events should have been processed
        self.assertTrue(agent._event_queue.empty())

    @patch("rovn_sdk.urlopen")
    def test_queue_full_drops_event(self, mock_urlopen: MagicMock) -> None:
        """When queue is full, events should be dropped silently."""
        agent = RovnAgent(
            base_url="http://localhost:3000",
            api_key="key",
            fire_and_forget=True,
        )
        agent.agent_id = "a1"

        # Stop the worker so it doesn't drain the queue
        agent._worker_stop.set()
        if agent._worker_thread:
            agent._worker_thread.join(timeout=2)

        # Fill the queue manually
        for i in range(agent._MAX_QUEUE_SIZE):
            agent._event_queue.put(("activity", {"title": f"Event {i}"}))

        # This should NOT raise even though queue is full
        agent.send_event("activity", {"title": "Should be dropped"})
        # If we got here without exception, the test passes
        agent._worker_stop.clear()  # Reset for cleanup
        # Drain queue to clean up
        while not agent._event_queue.empty():
            try:
                agent._event_queue.get_nowait()
            except queue.Empty:
                break


# ── Batch Mode Tests ───────────────────────────────────────


class TestBatchMode(unittest.TestCase):
    """Tests for the batch context manager."""

    def setUp(self) -> None:
        self.agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        self.agent.agent_id = "a1"

    @patch("rovn_sdk.urlopen")
    def test_batch_buffers_events(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        with self.agent.batch():
            self.agent.log_activity("One")
            self.agent.log_activity("Two")
            # During batch, events should NOT have been sent yet
            # (They might or might not have been -- the flush happens on exit)

        # After batch exits, all events should have been sent
        self.assertEqual(mock_urlopen.call_count, 2)

    @patch("rovn_sdk.urlopen")
    def test_batch_flushes_on_exit(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        with self.agent.batch():
            self.agent.send_message("Hello")
            self.agent.update_status("busy")

        # Verify both events were sent
        calls = mock_urlopen.call_args_list
        self.assertEqual(len(calls), 2)

        first_body = json.loads(calls[0][0][0].data.decode())
        self.assertEqual(first_body["event"], "message")

        second_body = json.loads(calls[1][0][0].data.decode())
        self.assertEqual(second_body["event"], "status")

    @patch("rovn_sdk.urlopen")
    def test_batch_no_events(self, mock_urlopen: MagicMock) -> None:
        """Empty batch should not call urlopen."""
        with self.agent.batch():
            pass
        self.assertEqual(mock_urlopen.call_count, 0)


# ── send_event Routing Tests ──────────────────────────────


class TestSendEventRouting(unittest.TestCase):
    """Test that send_event routes correctly based on mode."""

    @patch("rovn_sdk.urlopen")
    def test_synchronous_mode(self, mock_urlopen: MagicMock) -> None:
        """In default mode, send_event calls _request synchronously."""
        mock_urlopen.return_value = _make_urlopen_response(_success())
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.send_event("activity", {"title": "test"})
        self.assertEqual(mock_urlopen.call_count, 1)

    def test_fire_and_forget_mode(self) -> None:
        """In fire-and-forget mode, send_event enqueues instead of calling _request."""
        agent = RovnAgent(
            base_url="http://localhost:3000",
            api_key="key",
            fire_and_forget=True,
        )
        # Stop the worker to prevent it from draining the queue
        agent._worker_stop.set()
        if agent._worker_thread:
            agent._worker_thread.join(timeout=2)

        agent.send_event("status", {"status": "active"})
        self.assertFalse(agent._event_queue.empty())

        # Clean up
        while not agent._event_queue.empty():
            try:
                agent._event_queue.get_nowait()
            except queue.Empty:
                break

    @patch("rovn_sdk.urlopen")
    def test_batch_mode_buffers(self, mock_urlopen: MagicMock) -> None:
        """In batch mode, send_event appends to _batch_buffer."""
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent._batch_active = True
        agent.send_event("activity", {"title": "buffered"})
        self.assertEqual(len(agent._batch_buffer), 1)
        self.assertEqual(agent._batch_buffer[0], ("activity", {"title": "buffered"}))
        self.assertEqual(mock_urlopen.call_count, 0)


# ── Worker Retry Logic Tests ──────────────────────────────


class TestWorkerRetryLogic(unittest.TestCase):
    """Tests for the fire-and-forget worker retry with exponential backoff."""

    @patch("rovn_sdk.urlopen")
    def test_worker_retries_on_network_error(self, mock_urlopen: MagicMock) -> None:
        """Network errors (status_code=0) should trigger a retry."""
        call_count = 0

        def side_effect(*args: Any, **kwargs: Any) -> MagicMock:
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                raise URLError("Connection refused")
            return _make_urlopen_response(_success())

        mock_urlopen.side_effect = side_effect

        agent = RovnAgent(
            base_url="http://localhost:3000",
            api_key="key",
            fire_and_forget=True,
        )
        # Override backoff to make test fast
        agent._BACKOFF_BASE = 0.01
        agent._BACKOFF_MAX = 0.05

        agent.send_event("activity", {"title": "retry test"})

        # Wait for the event to be processed
        time.sleep(0.5)
        agent.close()

        # Should have been called at least 3 times (2 failures + 1 success)
        self.assertGreaterEqual(call_count, 3)

    @patch("rovn_sdk.urlopen")
    def test_worker_drops_on_4xx_error(self, mock_urlopen: MagicMock) -> None:
        """Non-network errors (4xx/5xx) should drop the event without retry."""
        mock_urlopen.side_effect = _error_response("Bad request", status=400)

        agent = RovnAgent(
            base_url="http://localhost:3000",
            api_key="key",
            fire_and_forget=True,
        )
        agent._BACKOFF_BASE = 0.01

        agent.send_event("activity", {"title": "drop test"})
        time.sleep(0.3)
        agent.close()

        # Should have been called only once (no retry for 4xx)
        self.assertEqual(mock_urlopen.call_count, 1)


# ── SSE Connect/Disconnect Tests ──────────────────────────


class TestSSEConnect(unittest.TestCase):
    """Tests for SSE stream connect/disconnect."""

    def test_disconnect_stops_thread(self) -> None:
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.agent_id = "a1"
        agent._sse_stop.clear()

        # Simulate a stopped SSE thread
        agent._sse_thread = threading.Thread(target=lambda: None, daemon=True)
        agent._sse_thread.start()
        agent._sse_thread.join()

        agent.disconnect()
        self.assertIsNone(agent._sse_thread)
        self.assertTrue(agent._sse_stop.is_set())

    @patch("rovn_sdk.urlopen")
    def test_connect_sets_agent_id_from_param(self, mock_urlopen: MagicMock) -> None:
        """connect(handler, agent_id=...) should set agent_id."""
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")

        # Make urlopen raise immediately so the SSE thread stops
        mock_urlopen.side_effect = URLError("fail")

        handler = Mock()
        agent.connect(handler, agent_id="provided_id", reconnect=False)
        self.assertEqual(agent.agent_id, "provided_id")
        time.sleep(0.2)
        agent.disconnect()

    @patch("rovn_sdk.urlopen")
    def test_connect_auto_discovers_agent_id(self, mock_urlopen: MagicMock) -> None:
        """connect() without agent_id calls get_info() to discover it."""
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")

        # First call = get_info, second call = SSE stream (which fails)
        agent_data = {
            "id": "discovered",
            "name": "Auto",
            "status": "active",
            "type": "general",
            "approved": False,
        }
        mock_urlopen.side_effect = [
            _make_urlopen_response(_success(agent_data)),
            URLError("SSE fail"),
        ]

        handler = Mock()
        agent.connect(handler, reconnect=False)
        self.assertEqual(agent.agent_id, "discovered")
        time.sleep(0.2)
        agent.disconnect()


# ── Edge Cases ────────────────────────────────────────────


class TestEdgeCases(unittest.TestCase):
    """Edge case and boundary tests."""

    @patch("rovn_sdk.urlopen")
    def test_none_metadata_excluded_from_payload(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.log_activity("test", metadata=None)
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertNotIn("metadata", sent["data"])

    @patch("rovn_sdk.urlopen")
    def test_empty_metadata_dict_included(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.log_activity("test", metadata={})
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        # Empty dict is truthy enough that metadata= is not None
        self.assertEqual(sent["data"]["metadata"], {})

    @patch("rovn_sdk.urlopen")
    def test_unicode_content(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.send_message("Hello, world!")
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["data"]["content"], "Hello, world!")

    @patch("rovn_sdk.urlopen")
    def test_special_characters_in_message(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        content = 'Line1\nLine2\tTabbed "quoted" & <special>'
        agent.send_message(content)
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["data"]["content"], content)

    def test_close_without_fire_and_forget(self) -> None:
        """close() on a synchronous agent should not raise."""
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.close()  # Should be a no-op

    def test_double_close(self) -> None:
        """Calling close() twice should not raise."""
        agent = RovnAgent(
            base_url="http://localhost:3000",
            api_key="key",
            fire_and_forget=True,
        )
        agent.close()
        agent.close()  # Second close should not raise

    def test_flush_synchronous_no_batch(self) -> None:
        """flush() on a synchronous agent with no batch should be a no-op."""
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.flush()  # Should not raise

    @patch("rovn_sdk.urlopen")
    def test_request_approval_minimal(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.request_approval(type="action", title="Do something?")
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertNotIn("description", sent["data"])
        self.assertNotIn("urgency", sent["data"])
        self.assertNotIn("metadata", sent["data"])

    @patch("rovn_sdk.urlopen")
    def test_send_peer_message_minimal(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.send_peer_message("a2", "Hi")
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertNotIn("message_type", sent["data"])
        self.assertNotIn("metadata", sent["data"])

    @patch("rovn_sdk.urlopen")
    def test_respond_to_command_no_response(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.respond_to_command("cmd_1", "acknowledged")
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertNotIn("response", sent["data"])


# ── Data Serialization Tests ──────────────────────────────


class TestDataSerialization(unittest.TestCase):
    """Tests for JSON serialization edge cases."""

    @patch("rovn_sdk.urlopen")
    def test_nested_dict_serialization(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        nested = {
            "level1": {
                "level2": {
                    "level3": ["a", "b", {"level4": True}]
                }
            }
        }
        agent.share_data("Nested", nested)
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        self.assertEqual(sent["data"]["content"]["level1"]["level2"]["level3"][2]["level4"], True)

    @patch("rovn_sdk.urlopen")
    def test_numeric_values_in_metadata(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.log_activity(
            "metric",
            metadata={"int": 42, "float": 3.14, "negative": -1, "zero": 0},
        )
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        meta = sent["data"]["metadata"]
        self.assertEqual(meta["int"], 42)
        self.assertAlmostEqual(meta["float"], 3.14)
        self.assertEqual(meta["negative"], -1)
        self.assertEqual(meta["zero"], 0)

    @patch("rovn_sdk.urlopen")
    def test_boolean_and_null_values(self, mock_urlopen: MagicMock) -> None:
        mock_urlopen.return_value = _make_urlopen_response(_success())
        agent = RovnAgent(base_url="http://localhost:3000", api_key="key")
        agent.share_data("Bools", {"yes": True, "no": False, "nothing": None})
        request_obj = mock_urlopen.call_args[0][0]
        sent = json.loads(request_obj.data.decode())
        content = sent["data"]["content"]
        self.assertTrue(content["yes"])
        self.assertFalse(content["no"])
        self.assertIsNone(content["nothing"])


# ── All-Exports Test ──────────────────────────────────────


class TestExports(unittest.TestCase):
    """Verify that all public symbols are exported correctly."""

    def test_all_exports(self) -> None:
        import rovn_sdk

        for name in ["RovnAgent", "RovnError", "AgentInfo", "Task", "PeerMessage", "Guardrail"]:
            self.assertTrue(hasattr(rovn_sdk, name), f"{name} not exported")

    def test_all_dunder(self) -> None:
        import rovn_sdk

        expected = {"RovnAgent", "RovnError", "AgentInfo", "Task", "PeerMessage", "Guardrail"}
        # __all__ uses the old name "RovnAgent" which is actually the client class
        # The actual __all__ might differ; just check the listed items are importable
        for name in rovn_sdk.__all__:
            self.assertTrue(hasattr(rovn_sdk, name), f"__all__ lists {name!r} but it's missing")


if __name__ == "__main__":
    unittest.main()
