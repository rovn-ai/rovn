"""Rovn Agent OS — Python SDK"""

from __future__ import annotations

import json
import queue
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Generator, Literal
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

__all__ = [
    "RovnAgent",
    "RovnError",
    "AgentInfo",
    "Task",
    "PeerMessage",
    "Guardrail",
    "Constraint",
    "ApprovalRequest",
    "TrustScore",
    "CheckResult",
    "ReportCard",
    "LangChainTool",
]

WebhookEvent = Literal[
    "activity",
    "task_update",
    "message",
    "status",
    "share_data",
    "command_response",
    "approval_request",
    "peer_message",
]

SSEEventType = Literal[
    "connected",
    "command",
    "approval_response",
    "interrupt",
    "agent_updated",
    "peer_message",
]

SSEHandler = Callable[[str, dict[str, Any]], None]

_SENTINEL = object()  # poison pill for worker thread shutdown


# ── Types ─────────────────────────────────────────────────


@dataclass
class AgentInfo:
    """Agent information returned by the Rovn API."""

    id: str
    name: str
    description: str | None
    status: str
    type: str
    approved: bool
    capabilities: list[str] | None = None
    metadata: dict[str, Any] | None = None
    created_at: str = ""
    updated_at: str = ""
    last_seen_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentInfo":
        return cls(
            id=data["id"],
            name=data["name"],
            description=data.get("description"),
            status=data.get("status", "active"),
            type=data.get("type", "general"),
            approved=data.get("approved", False),
            capabilities=data.get("capabilities"),
            metadata=data.get("metadata"),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
            last_seen_at=data.get("last_seen_at"),
        )


@dataclass
class Task:
    """Task information returned by the Rovn API."""

    id: str
    agent_id: str
    owner_id: str
    title: str
    description: str | None = None
    status: str = "pending"
    priority: str = "medium"
    result: dict[str, Any] | None = None
    scheduled_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str = ""
    updated_at: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Task":
        return cls(
            id=data["id"],
            agent_id=data["agent_id"],
            owner_id=data["owner_id"],
            title=data["title"],
            description=data.get("description"),
            status=data.get("status", "pending"),
            priority=data.get("priority", "medium"),
            result=data.get("result"),
            scheduled_at=data.get("scheduled_at"),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
        )


@dataclass
class PeerMessage:
    """Peer message between agents."""

    id: str
    from_agent_id: str
    to_agent_id: str
    content: str
    message_type: str = "text"
    metadata: dict[str, Any] | None = None
    read_at: str | None = None
    created_at: str = ""
    from_agent_name: str | None = None
    to_agent_name: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PeerMessage":
        return cls(
            id=data["id"],
            from_agent_id=data["from_agent_id"],
            to_agent_id=data["to_agent_id"],
            content=data["content"],
            message_type=data.get("message_type", "text"),
            metadata=data.get("metadata"),
            read_at=data.get("read_at"),
            created_at=data.get("created_at", ""),
            from_agent_name=data.get("from_agent_name"),
            to_agent_name=data.get("to_agent_name"),
        )


@dataclass
class Guardrail:
    """Guardrail configuration for an agent."""

    id: str
    agent_id: str
    owner_id: str
    metric: str
    limit_value: int
    current_value: int = 0
    window: str = "daily"
    action: str = "block"
    enabled: bool = True
    created_at: str = ""
    updated_at: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Guardrail":
        return cls(
            id=data["id"],
            agent_id=data["agent_id"],
            owner_id=data["owner_id"],
            metric=data["metric"],
            limit_value=data["limit_value"],
            current_value=data.get("current_value", 0),
            window=data.get("window", "daily"),
            action=data.get("action", "block"),
            enabled=data.get("enabled", True),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
        )


@dataclass
class Constraint:
    """Self-constraint declaration for a task."""

    id: str
    agent_id: str
    task: str
    constraints: dict[str, Any]
    actual_usage: dict[str, Any] | None = None
    compliance: str = "pending"
    started_at: str = ""
    completed_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Constraint":
        return cls(
            id=data["id"],
            agent_id=data.get("agent_id", ""),
            task=data.get("task", ""),
            constraints=data.get("constraints", {}),
            actual_usage=data.get("actual_usage"),
            compliance=data.get("compliance", "pending"),
            started_at=data.get("started_at", ""),
            completed_at=data.get("completed_at"),
        )


@dataclass
class ApprovalRequest:
    """Approval request created by the agent."""

    id: str
    agent_id: str
    type: str
    title: str
    status: str = "pending"
    urgency: str = "medium"
    description: str | None = None
    decided_at: str | None = None
    decided_by: str | None = None
    decision_note: str | None = None
    created_at: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ApprovalRequest":
        return cls(
            id=data["id"],
            agent_id=data.get("agent_id", ""),
            type=data.get("type", ""),
            title=data.get("title", ""),
            status=data.get("status", "pending"),
            urgency=data.get("urgency", "medium"),
            description=data.get("description"),
            decided_at=data.get("decided_at"),
            decided_by=data.get("decided_by"),
            decision_note=data.get("decision_note"),
            created_at=data.get("created_at", ""),
        )


@dataclass
class TrustScore:
    """Trust score result."""

    agent_id: str
    score: int
    grade: str
    breakdown: dict[str, Any]
    computed_at: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TrustScore":
        return cls(
            agent_id=data.get("agent_id", ""),
            score=data.get("score", 0),
            grade=data.get("grade", "F"),
            breakdown=data.get("breakdown", {}),
            computed_at=data.get("computed_at", ""),
        )


@dataclass
class CheckResult:
    """Result of a pre-flight action check."""

    action: str
    allowed: bool
    needs_approval: bool
    would_auto_approve: bool
    checks: list[dict[str, Any]]
    summary: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CheckResult":
        return cls(
            action=data.get("action", ""),
            allowed=data.get("allowed", False),
            needs_approval=data.get("needs_approval", False),
            would_auto_approve=data.get("would_auto_approve", False),
            checks=data.get("checks", []),
            summary=data.get("summary", ""),
        )


@dataclass
class ReportCard:
    """Agent report card with performance metrics."""

    agent: dict[str, Any]
    period: str
    productivity: dict[str, Any]
    reliability: dict[str, Any]
    compliance: dict[str, Any]
    trust: dict[str, Any]
    recommendations: list[str]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ReportCard":
        return cls(
            agent=data.get("agent", {}),
            period=data.get("period", ""),
            productivity=data.get("productivity", {}),
            reliability=data.get("reliability", {}),
            compliance=data.get("compliance", {}),
            trust=data.get("trust", {}),
            recommendations=data.get("recommendations", []),
        )


# ── Error ─────────────────────────────────────────────────


class RovnError(Exception):
    """Error returned by the Rovn API."""

    def __init__(
        self,
        message: str,
        status_code: int = 0,
        error_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code

    def __repr__(self) -> str:
        return f"RovnError({self.status_code}, {self.args[0]!r})"


# ── Client ────────────────────────────────────────────────


class RovnAgent:
    """Client for the Rovn Agent OS API.

    Usage::

        agent = RovnAgent(base_url="http://localhost:3000", api_key="rovn_...")
        agent.log_activity("Started processing")
        agent.update_status("active")

    Fire-and-forget mode (events are queued and sent in a background thread)::

        with RovnAgent(base_url="...", api_key="...", fire_and_forget=True) as agent:
            agent.log_activity("Queued instantly")
            agent.send_message("Also queued")
        # close() is called automatically, flushing remaining events
    """

    _MAX_QUEUE_SIZE = 10_000
    _BACKOFF_BASE = 1.0
    _BACKOFF_MAX = 30.0
    _GUARDRAIL_CACHE_TTL = 60.0  # seconds

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        fire_and_forget: bool = False,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.agent_id: str | None = None
        self._sse_stop = threading.Event()
        self._sse_thread: threading.Thread | None = None

        # fire-and-forget mode
        self._fire_and_forget = fire_and_forget
        self._event_queue: queue.Queue[Any] = queue.Queue(
            maxsize=self._MAX_QUEUE_SIZE
        )
        self._worker_thread: threading.Thread | None = None
        self._worker_stop = threading.Event()

        # batch mode
        self._batch_active = False
        self._batch_buffer: list[tuple[WebhookEvent, dict[str, Any]]] = []
        self._batch_lock = threading.Lock()

        # guardrail cache
        self._guardrail_cache: list[Guardrail] | None = None
        self._guardrail_cache_time: float = 0.0

        if self._fire_and_forget:
            self._start_worker()

    # ── context manager ─────────────────────────────────────

    def __enter__(self) -> "RovnAgent":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # ── helpers ──────────────────────────────────────────────

    def _ensure_agent_id(self) -> None:
        """Raise RovnError if agent_id has not been set."""
        if self.agent_id is None:
            raise RovnError(
                "agent_id is not set. Call get_info() first or provide "
                "agent_id during registration.",
                status_code=0,
                error_code="missing_agent_id",
            )

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    def _request(self, method: str, path: str, body: dict | None = None) -> Any:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body else None
        req = Request(url, data=data, headers=self._headers(), method=method)
        try:
            with urlopen(req) as resp:
                result = json.loads(resp.read())
        except HTTPError as exc:
            try:
                error_body = json.loads(exc.read())
                raise RovnError(
                    error_body.get("error", f"HTTP {exc.code}"),
                    status_code=exc.code,
                    error_code=error_body.get("code"),
                ) from exc
            except (json.JSONDecodeError, AttributeError):
                raise RovnError(
                    f"Request failed: {method} {path} — HTTP {exc.code}",
                    status_code=exc.code,
                ) from exc
        except URLError as exc:
            raise RovnError(
                f"Request failed: {method} {path} — {exc}",
                status_code=0,
            ) from exc

        if not result.get("success"):
            raise RovnError(
                result.get("error", f"Request failed: {method} {path}"),
                status_code=0,
                error_code=result.get("code"),
            )
        return result.get("data")

    # ── fire-and-forget worker ──────────────────────────────

    def _start_worker(self) -> None:
        """Start the background daemon thread that drains the event queue."""
        self._worker_stop.clear()
        self._worker_thread = threading.Thread(
            target=self._worker_loop, daemon=True
        )
        self._worker_thread.start()

    def _worker_loop(self) -> None:
        """Process events from the queue one at a time with retry logic."""
        backoff = self._BACKOFF_BASE

        while not self._worker_stop.is_set():
            try:
                item = self._event_queue.get(timeout=0.5)
            except queue.Empty:
                continue

            # poison pill — shutdown signal
            if item is _SENTINEL:
                self._event_queue.task_done()
                break

            event, data = item
            while not self._worker_stop.is_set():
                try:
                    self._request(
                        "POST",
                        "/api/webhook/agent",
                        {"event": event, "data": data},
                    )
                    backoff = self._BACKOFF_BASE  # reset on success
                    break
                except RovnError as exc:
                    # Retry on network errors, 5xx, and 429 (rate limit)
                    if exc.status_code == 0 or exc.status_code >= 500 or exc.status_code == 429:
                        self._worker_stop.wait(backoff)
                        backoff = min(backoff * 2, self._BACKOFF_MAX)
                    else:
                        # Non-retryable error (4xx except 429) — drop the event
                        break

            self._event_queue.task_done()

    # ── close / flush ───────────────────────────────────────

    def flush(self) -> None:
        """Block until all queued events have been sent.

        In fire-and-forget mode, waits for the worker to drain the queue.
        In batch mode, sends all buffered events immediately (synchronously).
        """
        # Flush batch buffer first if it has anything
        with self._batch_lock:
            buffered = list(self._batch_buffer)
            self._batch_buffer.clear()

        for event, data in buffered:
            if self._fire_and_forget:
                try:
                    self._event_queue.put_nowait((event, data))
                except queue.Full:
                    pass  # drop if queue is full
            else:
                self._request(
                    "POST",
                    "/api/webhook/agent",
                    {"event": event, "data": data},
                )

        # Wait for the worker queue to drain
        if self._fire_and_forget and self._worker_thread is not None:
            self._event_queue.join()

    def close(self) -> None:
        """Flush remaining events and stop the background worker thread."""
        if self._fire_and_forget and self._worker_thread is not None:
            # Drain any batch buffer into the queue
            with self._batch_lock:
                buffered = list(self._batch_buffer)
                self._batch_buffer.clear()
            for event, data in buffered:
                try:
                    self._event_queue.put_nowait((event, data))
                except queue.Full:
                    pass

            # Send poison pill to stop worker
            self._event_queue.put(_SENTINEL)
            self._worker_thread.join(timeout=10)
            self._worker_thread = None

        # Also disconnect SSE if running
        self.disconnect()

    # ── batch context manager ───────────────────────────────

    @contextmanager
    def batch(self) -> Generator[None, None, None]:
        """Context manager that buffers events and flushes them on exit.

        Usage::

            with agent.batch():
                agent.log_activity("one")
                agent.log_activity("two")
            # both events are sent here
        """
        with self._batch_lock:
            self._batch_active = True
        try:
            yield
        finally:
            with self._batch_lock:
                self._batch_active = False
            self.flush()

    # ── registration ─────────────────────────────────────────

    @classmethod
    def register(
        cls,
        base_url: str,
        *,
        name: str,
        description: str | None = None,
        type: str | None = None,
        capabilities: list[str] | None = None,
        owner_email: str | None = None,
        metadata: dict[str, Any] | None = None,
        fire_and_forget: bool = False,
    ) -> tuple["RovnAgent", str, str]:
        """Register a new agent and return ``(agent, id, api_key)``."""
        payload: dict[str, Any] = {"name": name}
        if description is not None:
            payload["description"] = description
        if type is not None:
            payload["type"] = type
        if capabilities is not None:
            payload["capabilities"] = capabilities
        if owner_email is not None:
            payload["owner_email"] = owner_email
        if metadata is not None:
            payload["metadata"] = metadata

        url = f"{base_url.rstrip('/')}/api/agents/register"
        req = Request(
            url,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(req) as resp:
                result = json.loads(resp.read())
        except HTTPError as exc:
            try:
                error_body = json.loads(exc.read())
                raise RovnError(
                    error_body.get("error", "Registration failed"),
                    status_code=exc.code,
                ) from exc
            except (json.JSONDecodeError, AttributeError):
                raise RovnError(
                    f"Registration failed: HTTP {exc.code}",
                    status_code=exc.code,
                ) from exc

        if not result.get("success"):
            raise RovnError(result.get("error", "Registration failed"))

        data = result["data"]
        agent = cls(
            base_url=base_url,
            api_key=data["api_key"],
            fire_and_forget=fire_and_forget,
        )
        agent.agent_id = data["id"]
        return agent, data["id"], data["api_key"]

    # ── agent info ───────────────────────────────────────────

    def get_info(self) -> AgentInfo:
        """Get agent information. Auto-discovers agent_id on first call."""
        if not self.agent_id:
            info = self._request("GET", "/api/agents/me")
            self.agent_id = info["id"]
            return AgentInfo.from_dict(info)
        data = self._request("GET", f"/api/agents/{self.agent_id}")
        return AgentInfo.from_dict(data)

    # ── webhook events ───────────────────────────────────────

    def send_event(self, event: WebhookEvent, data: dict[str, Any]) -> dict[str, Any] | None:
        """Send an event to the Rovn server.

        In fire-and-forget mode, the event is queued for background delivery
        and ``None`` is returned.
        In batch mode, the event is buffered until the batch context exits
        and ``None`` is returned.
        Otherwise the event is sent synchronously and the server response
        data is returned (e.g. ``{"received": "approval_request", "approval_id": "..."}``).
        """
        # Batch mode: buffer the event
        with self._batch_lock:
            if self._batch_active:
                self._batch_buffer.append((event, data))
                return None

        # Fire-and-forget mode: enqueue for the worker
        if self._fire_and_forget:
            try:
                self._event_queue.put_nowait((event, data))
            except queue.Full:
                pass  # drop silently when queue is full
            return None

        # Synchronous mode (default)
        return self._request("POST", "/api/webhook/agent", {"event": event, "data": data})

    def log_activity(
        self,
        title: str,
        *,
        type: str | None = None,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        payload: dict[str, Any] = {"title": title}
        if type is not None:
            payload["type"] = type
        if description is not None:
            payload["description"] = description
        if metadata is not None:
            payload["metadata"] = metadata
        self.send_event("activity", payload)

    def update_task_status(
        self,
        task_id: str,
        status: str,
        result: dict[str, Any] | None = None,
    ) -> None:
        payload: dict[str, Any] = {"task_id": task_id, "status": status}
        if result is not None:
            payload["result"] = result
        self.send_event("task_update", payload)

    def send_message(
        self,
        content: str,
        *,
        message_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        payload: dict[str, Any] = {"content": content}
        if message_type is not None:
            payload["message_type"] = message_type
        if metadata is not None:
            payload["metadata"] = metadata
        self.send_event("message", payload)

    def update_status(
        self, status: Literal["active", "idle", "busy", "offline", "error"]
    ) -> None:
        self.send_event("status", {"status": status})

    def share_data(
        self,
        title: str,
        content: dict[str, Any],
        type: str | None = None,
    ) -> None:
        payload: dict[str, Any] = {"title": title, "content": content}
        if type is not None:
            payload["type"] = type
        self.send_event("share_data", payload)

    def respond_to_command(
        self,
        command_id: str,
        status: str,
        response: dict[str, Any] | None = None,
    ) -> None:
        payload: dict[str, Any] = {"command_id": command_id, "status": status}
        if response is not None:
            payload["response"] = response
        self.send_event("command_response", payload)

    def request_approval(
        self,
        *,
        type: str,
        title: str,
        description: str | None = None,
        urgency: Literal["low", "medium", "high", "critical"] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str | None:
        """Request approval from the owner.

        Returns the ``approval_id``.  Even in batch or fire-and-forget
        mode the approval request is sent synchronously so the caller
        always receives the server-assigned ``approval_id``.
        """
        payload: dict[str, Any] = {"type": type, "title": title}
        if description is not None:
            payload["description"] = description
        if urgency is not None:
            payload["urgency"] = urgency
        if metadata is not None:
            payload["metadata"] = metadata
        # Approval requests are always synchronous to guarantee approval_id
        result = self._request(
            "POST",
            "/api/webhook/agent",
            {"event": "approval_request", "data": payload},
        )
        if result and "approval_id" in result:
            return result["approval_id"]
        return None

    def send_peer_message(
        self,
        to_agent_id: str,
        content: str,
        *,
        message_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        payload: dict[str, Any] = {"to_agent_id": to_agent_id, "content": content}
        if message_type is not None:
            payload["message_type"] = message_type
        if metadata is not None:
            payload["metadata"] = metadata
        self.send_event("peer_message", payload)

    # ── SSE stream ───────────────────────────────────────────

    def connect(
        self,
        handler: SSEHandler,
        *,
        agent_id: str | None = None,
        on_connect: Callable[[], None] | None = None,
        on_disconnect: Callable[[], None] | None = None,
        reconnect: bool = True,
    ) -> None:
        """Connect to the SSE stream in a background thread.

        If ``agent_id`` is not provided, uses the agent_id from registration
        or auto-discovers it via ``/api/agents/me``.
        """
        if agent_id:
            self.agent_id = agent_id
        elif not self.agent_id:
            self.get_info()  # auto-discover agent_id

        target_id = self.agent_id
        self._sse_stop.clear()

        def _run() -> None:
            last_event_id: str | None = None

            while not self._sse_stop.is_set():
                try:
                    headers = {**self._headers()}
                    headers["Accept"] = "text/event-stream"
                    if last_event_id:
                        headers["Last-Event-ID"] = last_event_id

                    req = Request(
                        f"{self.base_url}/api/agents/{target_id}/stream",
                        headers=headers,
                    )
                    resp = urlopen(req)

                    if on_connect:
                        on_connect()

                    event_type = ""
                    event_data = ""

                    for raw_line in resp:
                        if self._sse_stop.is_set():
                            break
                        line = raw_line.decode("utf-8").rstrip("\n")

                        if line.startswith("id: "):
                            last_event_id = line[4:]
                        elif line.startswith("event: "):
                            event_type = line[7:]
                        elif line.startswith("data: "):
                            event_data = line[6:]
                        elif line == "" and event_type and event_data:
                            try:
                                parsed = json.loads(event_data)
                                handler(event_type, parsed)
                            except json.JSONDecodeError:
                                pass
                            event_type = ""
                            event_data = ""

                except Exception:
                    if self._sse_stop.is_set():
                        return
                    if on_disconnect:
                        on_disconnect()
                    if not reconnect:
                        return
                    self._sse_stop.wait(3)

        self._sse_thread = threading.Thread(target=_run, daemon=True)
        self._sse_thread.start()

    def disconnect(self) -> None:
        """Stop the SSE stream."""
        self._sse_stop.set()
        if self._sse_thread:
            self._sse_thread.join(timeout=5)
            self._sse_thread = None

    # ── tasks ────────────────────────────────────────────────

    def get_tasks(
        self,
        *,
        status: str | None = None,
        limit: int | None = None,
    ) -> list[Task]:
        self._ensure_agent_id()
        params: list[str] = []
        if status:
            params.append(f"status={status}")
        if limit:
            params.append(f"limit={limit}")
        qs = "&".join(params)
        path = f"/api/agents/{self.agent_id}/tasks"
        if qs:
            path += f"?{qs}"
        data = self._request("GET", path)
        return [Task.from_dict(t) for t in data]

    # ── peer messages ────────────────────────────────────────

    def get_peer_messages(
        self,
        *,
        direction: Literal["inbox", "outbox", "all"] | None = None,
        limit: int | None = None,
    ) -> list[PeerMessage]:
        self._ensure_agent_id()
        params: list[str] = []
        if direction:
            params.append(f"direction={direction}")
        if limit:
            params.append(f"limit={limit}")
        qs = "&".join(params)
        path = f"/api/agents/{self.agent_id}/peer"
        if qs:
            path += f"?{qs}"
        data = self._request("GET", path)
        return [PeerMessage.from_dict(m) for m in data]

    # ── guardrails ───────────────────────────────────────────

    def get_guardrails(self) -> list[Guardrail]:
        self._ensure_agent_id()
        data = self._request("GET", f"/api/agents/{self.agent_id}/guardrails")
        guardrails = [Guardrail.from_dict(g) for g in data]
        # Update cache
        import time as _time

        self._guardrail_cache = guardrails
        self._guardrail_cache_time = _time.monotonic()
        return guardrails

    def _get_cached_guardrails(self) -> list[Guardrail]:
        """Return guardrails from cache if fresh, otherwise fetch."""
        import time as _time

        now = _time.monotonic()
        if (
            self._guardrail_cache is not None
            and (now - self._guardrail_cache_time) < self._GUARDRAIL_CACHE_TTL
        ):
            return self._guardrail_cache
        return self.get_guardrails()

    def get_guardrail_remaining(self, metric: str) -> int | None:
        """Return ``limit_value - current_value`` for the given metric.

        Returns ``None`` if the metric is not found among the agent's
        guardrails.  Guardrails are cached for 60 seconds to avoid
        excessive API calls.
        """
        self._ensure_agent_id()
        guardrails = self._get_cached_guardrails()
        for g in guardrails:
            if g.metric == metric:
                return g.limit_value - g.current_value
        return None

    # ── constraints (self-constraint declaration) ─────────

    def declare_constraint(
        self,
        task: str,
        constraints: dict[str, Any],
    ) -> Constraint:
        """Declare constraints for a task (self-constraint declaration)."""
        self._ensure_agent_id()
        data = self._request(
            "POST",
            f"/api/agents/{self.agent_id}/constraints",
            {"task": task, "constraints": constraints},
        )
        return Constraint.from_dict(data)

    def update_constraint(
        self,
        constraint_id: str,
        actual_usage: dict[str, Any],
        *,
        completed: bool = False,
    ) -> dict[str, Any]:
        """Update actual usage against a declared constraint."""
        self._ensure_agent_id()
        return self._request(
            "PATCH",
            f"/api/agents/{self.agent_id}/constraints",
            {
                "constraint_id": constraint_id,
                "actual_usage": actual_usage,
                "completed": completed,
            },
        )

    def get_constraints(self) -> list[Constraint]:
        """Get all constraints for this agent."""
        self._ensure_agent_id()
        data = self._request("GET", f"/api/agents/{self.agent_id}/constraints")
        return [Constraint.from_dict(c) for c in data]

    # ── trust score ───────────────────────────────────────

    def get_trust_score(self) -> TrustScore:
        """Compute and return the agent's trust score."""
        self._ensure_agent_id()
        data = self._request("GET", f"/api/agents/{self.agent_id}/trust-score")
        return TrustScore.from_dict(data)

    # ── approvals (polling) ───────────────────────────────

    def get_approvals(
        self,
        *,
        status: str | None = None,
        limit: int | None = None,
    ) -> list[ApprovalRequest]:
        """Get approval requests for this agent (polling alternative to SSE)."""
        params: list[str] = []
        if status:
            params.append(f"status={status}")
        if limit:
            params.append(f"limit={limit}")
        qs = "&".join(params)
        path = "/api/approvals"
        if qs:
            path += f"?{qs}"
        data = self._request("GET", path)
        approvals = data.get("approvals", data) if isinstance(data, dict) else data
        return [ApprovalRequest.from_dict(a) for a in approvals]

    def poll_approval(self, approval_id: str) -> ApprovalRequest:
        """Poll a specific approval request by ID."""
        data = self._request("GET", f"/api/approvals/{approval_id}")
        return ApprovalRequest.from_dict(data)

    # ── pre-flight check ("Can I Do This?") ───────────────

    def check_action(
        self,
        action: str,
        *,
        urgency: str | None = None,
        cost: float | None = None,
        data_fields: list[str] | None = None,
    ) -> CheckResult:
        """Pre-flight check: would this action be allowed?

        Evaluates policies, guardrails, and earned autonomy without
        actually performing the action.
        """
        from urllib.parse import urlencode

        self._ensure_agent_id()
        params: dict[str, str] = {"action": action}
        if urgency is not None:
            params["urgency"] = urgency
        if cost is not None:
            params["cost"] = str(cost)
        if data_fields is not None:
            params["data_fields"] = ",".join(data_fields)
        qs = urlencode(params)
        data = self._request("GET", f"/api/agents/{self.agent_id}/check?{qs}")
        return CheckResult.from_dict(data)

    # ── report card ──────────────────────────────────────

    def get_report_card(self, *, days: int | None = None) -> ReportCard:
        """Get the agent's report card (performance metrics).

        Args:
            days: Number of days to include in the report (default: 30).
        """
        self._ensure_agent_id()
        path = f"/api/agents/{self.agent_id}/report-card"
        if days is not None:
            path += f"?days={days}"
        data = self._request("GET", path)
        return ReportCard.from_dict(data)


# ── LangChain Integration ────────────────────────────────


class LangChainTool:
    """Drop-in LangChain tool wrapper that adds Rovn governance.

    Wraps any callable so that each invocation:
    1. Runs a pre-flight ``check_action`` against Rovn policies
    2. Blocks the call if policies disallow it
    3. Reports the result back to Rovn as an activity

    Usage with LangChain::

        from langchain.tools import StructuredTool
        from rovn_sdk import RovnAgent, LangChainTool

        agent = RovnAgent(base_url="...", api_key="...")
        agent.get_info()  # sets agent_id

        def my_func(query: str) -> str:
            return f"Result for {query}"

        rovn_tool = LangChainTool(
            agent=agent,
            name="search",
            description="Search the database",
            func=my_func,
            action_name="db_read",
        )

        # Use as a LangChain tool:
        tool = StructuredTool.from_function(
            func=rovn_tool.run,
            name=rovn_tool.name,
            description=rovn_tool.description,
        )
    """

    def __init__(
        self,
        agent: RovnAgent,
        *,
        name: str,
        description: str,
        func: Callable[..., Any],
        action_name: str | None = None,
    ) -> None:
        self.agent = agent
        self.name = name
        self.description = description
        self._func = func
        self._action_name = action_name or name

    def run(self, *args: Any, **kwargs: Any) -> Any:
        """Execute the wrapped function with Rovn governance.

        Checks policies before execution and reports the result afterward.
        Raises ``RovnError`` if the action is blocked by policy.
        """
        # Pre-flight check
        try:
            check = self.agent.check_action(self._action_name)
            if not check.allowed:
                self.agent.log_activity(
                    f"Blocked: {self._action_name}",
                    type="policy_block",
                    description=check.summary,
                )
                raise RovnError(
                    f"Action '{self._action_name}' blocked by policy: {check.summary}",
                    status_code=403,
                    error_code="policy_blocked",
                )
        except RovnError:
            raise
        except Exception:
            # If check fails (network, etc.), allow execution but log warning
            pass

        # Execute the actual function
        try:
            result = self._func(*args, **kwargs)
            self.agent.log_activity(
                f"Executed: {self._action_name}",
                type="tool_execution",
                description=f"Tool '{self.name}' completed successfully",
            )
            return result
        except RovnError:
            raise
        except Exception as exc:
            self.agent.log_activity(
                f"Failed: {self._action_name}",
                type="tool_error",
                description=f"Tool '{self.name}' failed: {exc}",
            )
            raise
