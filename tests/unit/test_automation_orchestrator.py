"""Unit tests for Automation Orchestrator service - executors, playbook execution,
rollback, condition evaluation, audit logging, DB persistence, and API endpoints."""

import asyncio
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

from shared.models import (
    AutomationPlaybook,
    PlaybookAction,
    PlaybookExecution,
    WorkflowStatus,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_action(
    action_id: str = "test-action",
    action_type: str = "ssh_command",
    name: str = "Test Action",
    description: str = "A test action",
    parameters: dict = None,
    timeout_seconds: int = 300,
    rollback_action: str = None,
    conditions: list = None,
) -> PlaybookAction:
    return PlaybookAction(
        action_id=action_id,
        action_type=action_type,
        name=name,
        description=description,
        parameters=parameters or {},
        timeout_seconds=timeout_seconds,
        rollback_action=rollback_action,
        conditions=conditions or [],
    )


def _make_playbook(
    playbook_id: str = "test-playbook",
    actions: list = None,
    approval_required: bool = False,
) -> AutomationPlaybook:
    if actions is None:
        actions = [_make_action()]
    return AutomationPlaybook(
        playbook_id=playbook_id,
        name="Test Playbook",
        description="A playbook for testing",
        version="1.0.0",
        actions=actions,
        approval_required=approval_required,
        timeout_seconds=600,
        trigger_conditions={"alert_type": "malware"},
    )


def _make_execution(
    playbook_id: str = "test-playbook",
    status: WorkflowStatus = WorkflowStatus.PENDING,
    approval_status: str = None,
    input_data: dict = None,
) -> PlaybookExecution:
    return PlaybookExecution(
        execution_id="pb-exec-test-123",
        playbook_id=playbook_id,
        trigger_alert_id="ALT-001",
        status=status,
        started_at=datetime.utcnow(),
        results=[],
        input_data=input_data or {"target_ip": "10.0.0.50", "file_hash": "abc123"},
        approval_status=approval_status,
    )


# ---------------------------------------------------------------------------
# Executor Tests
# ---------------------------------------------------------------------------


class TestSSHCommandExecutor:
    """Test SSH command executor."""

    @pytest.mark.asyncio
    async def test_ssh_execute_success(self):
        from services.automation_orchestrator.main import SSHCommandExecutor

        executor = SSHCommandExecutor()
        action = _make_action(
            action_type="ssh_command",
            parameters={
                "command_template": "iptables -A INPUT -s {target_ip} -j DROP",
                "target_host": "{target_ip}",
            },
        )
        context = {"target_ip": "10.0.0.50"}

        result = await executor.execute(action, context)

        assert result["status"] == "success"
        assert "10.0.0.50" in result["output"]

    @pytest.mark.asyncio
    async def test_ssh_execute_missing_context_key(self):
        from services.automation_orchestrator.main import SSHCommandExecutor

        executor = SSHCommandExecutor()
        action = _make_action(
            parameters={"command_template": "cmd {missing_key}", "target_host": "host"},
        )
        context = {}

        result = await executor.execute(action, context)
        assert result["status"] == "failed"


class TestEDRCommandExecutor:
    """Test EDR command executor."""

    @pytest.mark.asyncio
    async def test_edr_execute_success(self):
        from services.automation_orchestrator.main import EDRCommandExecutor

        executor = EDRCommandExecutor()
        action = _make_action(
            action_type="edr_command",
            parameters={"file_hash": "{file_hash}", "action": "quarantine"},
        )
        context = {"file_hash": "abc123def"}

        result = await executor.execute(action, context)

        assert result["status"] == "success"
        assert "abc123def" in result["output"]

    @pytest.mark.asyncio
    async def test_edr_missing_hash(self):
        from services.automation_orchestrator.main import EDRCommandExecutor

        executor = EDRCommandExecutor()
        action = _make_action(
            action_type="edr_command",
            parameters={"file_hash": "{missing}", "action": "quarantine"},
        )
        result = await executor.execute(action, {})
        assert result["status"] == "failed"


class TestEmailCommandExecutor:
    """Test email command executor."""

    @pytest.mark.asyncio
    async def test_email_execute_success(self):
        from services.automation_orchestrator.main import EmailCommandExecutor

        executor = EmailCommandExecutor()
        action = _make_action(
            action_type="email_command",
            parameters={"action": "block_sender", "sender_address": "{sender}"},
        )
        context = {"sender": "bad@evil.com"}

        result = await executor.execute(action, context)

        assert result["status"] == "success"
        assert "block_sender" in result["output"]


class TestNotificationExecutor:
    """Test notification executor."""

    @pytest.mark.asyncio
    async def test_notification_success(self):
        from services.automation_orchestrator.main import NotificationExecutor

        executor = NotificationExecutor()
        action = _make_action(
            action_type="notification",
            parameters={
                "channels": ["slack", "email"],
                "recipients": ["admin@co.com", "#security"],
                "message": "Alert {alert_id} detected",
            },
        )
        context = {"alert_id": "ALT-001"}

        result = await executor.execute(action, context)

        assert result["status"] == "success"
        assert "2 recipients" in result["output"]

    @pytest.mark.asyncio
    async def test_notification_empty_recipients(self):
        from services.automation_orchestrator.main import NotificationExecutor

        executor = NotificationExecutor()
        action = _make_action(
            action_type="notification",
            parameters={"channels": ["slack"], "recipients": [], "message": "test"},
        )
        result = await executor.execute(action, {})
        assert result["status"] == "success"
        assert "0 recipients" in result["output"]


class TestFirewallRuleExecutor:
    """Test firewall rule executor."""

    @pytest.mark.asyncio
    async def test_firewall_success(self):
        from services.automation_orchestrator.main import FirewallRuleExecutor

        executor = FirewallRuleExecutor()
        action = _make_action(
            action_type="firewall_rule",
            parameters={"rule_template": "block from {source_ip} any to any"},
        )
        context = {"source_ip": "192.168.1.100"}

        result = await executor.execute(action, context)

        assert result["status"] == "success"
        assert "192.168.1.100" in result["output"]


class TestADCommandExecutor:
    """Test AD command executor."""

    @pytest.mark.asyncio
    async def test_ad_command_success(self):
        from services.automation_orchestrator.main import ADCommandExecutor

        executor = ADCommandExecutor()
        action = _make_action(
            action_type="ad_command",
            parameters={"username": "{user_id}"},
        )
        context = {"user_id": "john.doe"}

        result = await executor.execute(action, context)

        assert result["status"] == "success"
        assert "john.doe" in result["output"]


class TestGenericExecutor:
    """Test generic executor."""

    @pytest.mark.asyncio
    async def test_generic_success(self):
        from services.automation_orchestrator.main import GenericExecutor

        executor = GenericExecutor()
        action = _make_action(action_type="forensics", action_id="collect-evidence")

        result = await executor.execute(action, {})

        assert result["status"] == "success"
        assert "forensics" in result["output"]


# ---------------------------------------------------------------------------
# Action Executor Registry
# ---------------------------------------------------------------------------


class TestActionExecutorRegistry:
    """Test that all expected action types are registered."""

    def test_all_executor_types_registered(self):
        from services.automation_orchestrator.main import ACTION_EXECUTORS

        expected_types = [
            "ssh_command", "edr_command", "email_command", "api_call",
            "notification", "firewall_rule", "ad_command", "network_change",
            "email_action", "email_filter", "security_filter",
            "threat_intel_upload", "rate_limit", "security_config",
            "forensics", "access_control", "log_collection", "audit_log",
            "workflow_trigger",
        ]
        for action_type in expected_types:
            assert action_type in ACTION_EXECUTORS, f"Missing executor: {action_type}"

    def test_executor_count(self):
        from services.automation_orchestrator.main import ACTION_EXECUTORS

        assert len(ACTION_EXECUTORS) >= 19


# ---------------------------------------------------------------------------
# Condition Evaluation in execute_playbook_action
# ---------------------------------------------------------------------------


class TestConditionEvaluation:
    """Test condition evaluation in action execution."""

    @pytest.mark.asyncio
    async def test_condition_equal_met(self):
        from services.automation_orchestrator.main import execute_playbook_action

        action = _make_action(
            conditions=[{"field": "severity", "operator": "==", "value": "high"}],
        )
        execution = _make_execution()
        context = {"severity": "high", "target_ip": "10.0.0.1"}

        with patch("services.automation_orchestrator.main.audit_log", new_callable=AsyncMock):
            result = await execute_playbook_action(execution, action, context)

        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_condition_equal_not_met(self):
        from services.automation_orchestrator.main import execute_playbook_action

        action = _make_action(
            conditions=[{"field": "severity", "operator": "==", "value": "critical"}],
        )
        execution = _make_execution()
        context = {"severity": "low"}

        with patch("services.automation_orchestrator.main.audit_log", new_callable=AsyncMock):
            result = await execute_playbook_action(execution, action, context)

        assert result["status"] == "skipped"

    @pytest.mark.asyncio
    async def test_condition_not_equal_met(self):
        from services.automation_orchestrator.main import execute_playbook_action

        action = _make_action(
            conditions=[{"field": "severity", "operator": "!=", "value": "low"}],
        )
        execution = _make_execution()
        context = {"severity": "high", "target_ip": "10.0.0.1"}

        with patch("services.automation_orchestrator.main.audit_log", new_callable=AsyncMock):
            result = await execute_playbook_action(execution, action, context)

        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_condition_in_met(self):
        from services.automation_orchestrator.main import execute_playbook_action

        action = _make_action(
            conditions=[{"field": "risk_level", "operator": "in", "value": ["HIGH", "CRITICAL"]}],
        )
        execution = _make_execution()
        context = {"risk_level": "HIGH", "target_ip": "10.0.0.1"}

        with patch("services.automation_orchestrator.main.audit_log", new_callable=AsyncMock):
            result = await execute_playbook_action(execution, action, context)

        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_condition_in_not_met(self):
        from services.automation_orchestrator.main import execute_playbook_action

        action = _make_action(
            conditions=[{"field": "risk_level", "operator": "in", "value": ["HIGH", "CRITICAL"]}],
        )
        execution = _make_execution()
        context = {"risk_level": "LOW"}

        with patch("services.automation_orchestrator.main.audit_log", new_callable=AsyncMock):
            result = await execute_playbook_action(execution, action, context)

        assert result["status"] == "skipped"

    @pytest.mark.asyncio
    async def test_no_conditions_executes(self):
        from services.automation_orchestrator.main import execute_playbook_action

        action = _make_action(conditions=[])
        execution = _make_execution()
        context = {"target_ip": "10.0.0.1"}

        with patch("services.automation_orchestrator.main.audit_log", new_callable=AsyncMock):
            result = await execute_playbook_action(execution, action, context)

        assert result["status"] == "success"


# ---------------------------------------------------------------------------
# Timeout handling
# ---------------------------------------------------------------------------


class TestActionTimeout:
    """Test action timeout handling."""

    @pytest.mark.asyncio
    async def test_action_timeout(self):
        from services.automation_orchestrator.main import execute_playbook_action, ActionExecutor, ACTION_EXECUTORS

        class SlowExecutor(ActionExecutor):
            async def execute(self, action, context):
                await asyncio.sleep(10)
                return {"status": "success"}

        original = ACTION_EXECUTORS.get("ssh_command")
        ACTION_EXECUTORS["ssh_command"] = SlowExecutor()

        try:
            action = _make_action(timeout_seconds=1)
            execution = _make_execution()

            with patch("services.automation_orchestrator.main.audit_log", new_callable=AsyncMock):
                result = await execute_playbook_action(execution, action, {"target_ip": "10.0.0.1"})

            assert result["status"] == "failed"
            assert "timed out" in result["error"]
        finally:
            ACTION_EXECUTORS["ssh_command"] = original

    @pytest.mark.asyncio
    async def test_unknown_action_type(self):
        from services.automation_orchestrator.main import execute_playbook_action

        action = _make_action(action_type="nonexistent_type")
        execution = _make_execution()

        with patch("services.automation_orchestrator.main.audit_log", new_callable=AsyncMock):
            result = await execute_playbook_action(execution, action, {})

        assert result["status"] == "failed"
        assert "No executor found" in result["error"]


# ---------------------------------------------------------------------------
# Rollback Logic
# ---------------------------------------------------------------------------


class TestRollback:
    """Test rollback functionality."""

    @pytest.mark.asyncio
    async def test_rollback_executes_in_reverse(self):
        from services.automation_orchestrator.main import perform_rollback

        actions = [
            _make_action(action_id="a1", action_type="firewall_rule", rollback_action="undo_a1"),
            _make_action(action_id="a2", action_type="ad_command", rollback_action="undo_a2"),
            _make_action(action_id="a3", action_type="notification"),  # no rollback
        ]
        playbook = _make_playbook(actions=actions)
        execution = _make_execution()
        context = {"target_ip": "10.0.0.1", "user_id": "testuser"}

        with patch("services.automation_orchestrator.main.audit_log", new_callable=AsyncMock):
            await perform_rollback(execution, playbook, context, failed_action_index=2)

        assert execution.rollback_performed is True
        rollback_entry = execution.results[-1]
        assert rollback_entry["type"] == "rollback"
        # a2 has rollback, a1 has rollback - both should execute (a3 skipped, not in range)
        # failed_action_index=2, so we rollback actions 1 and 0
        rollback_ids = [r["action_id"] for r in rollback_entry["rollback_results"]]
        assert "a2" in rollback_ids
        assert "a1" in rollback_ids

    @pytest.mark.asyncio
    async def test_rollback_skips_actions_without_rollback(self):
        from services.automation_orchestrator.main import perform_rollback

        actions = [
            _make_action(action_id="a1", action_type="notification"),  # no rollback
            _make_action(action_id="a2", action_type="notification"),  # no rollback
        ]
        playbook = _make_playbook(actions=actions)
        execution = _make_execution()

        with patch("services.automation_orchestrator.main.audit_log", new_callable=AsyncMock):
            await perform_rollback(execution, playbook, {}, failed_action_index=2)

        assert execution.rollback_performed is True
        rollback_entry = execution.results[-1]
        assert len(rollback_entry["rollback_results"]) == 0

    @pytest.mark.asyncio
    async def test_rollback_at_first_action_nothing_to_rollback(self):
        from services.automation_orchestrator.main import perform_rollback

        actions = [_make_action(action_id="a1", rollback_action="undo")]
        playbook = _make_playbook(actions=actions)
        execution = _make_execution()

        with patch("services.automation_orchestrator.main.audit_log", new_callable=AsyncMock):
            await perform_rollback(execution, playbook, {}, failed_action_index=0)

        assert execution.rollback_performed is True
        rollback_entry = execution.results[-1]
        assert len(rollback_entry["rollback_results"]) == 0


# ---------------------------------------------------------------------------
# Playbook Execution
# ---------------------------------------------------------------------------


class TestPlaybookExecution:
    """Test end-to-end playbook execution."""

    @pytest.mark.asyncio
    async def test_successful_execution(self):
        import services.automation_orchestrator.main as mod

        actions = [
            _make_action(action_id="a1", action_type="notification", parameters={"channels": [], "recipients": [], "message": "test"}),
            _make_action(action_id="a2", action_type="firewall_rule", parameters={"rule_template": "block"}),
        ]
        playbook = _make_playbook(actions=actions, approval_required=False)
        execution = _make_execution(status=WorkflowStatus.PENDING)

        old_playbooks = dict(mod.playbooks)
        old_publisher = mod.publisher
        mod.playbooks["test-playbook"] = playbook
        mod.publisher = MagicMock()
        mod.publisher.publish = AsyncMock()

        try:
            with patch.object(mod, "audit_log", new_callable=AsyncMock):
                with patch.object(mod, "persist_execution_update", new_callable=AsyncMock):
                    await mod.execute_playbook(execution)

            assert execution.status == WorkflowStatus.COMPLETED
            assert len(execution.results) == 2
            assert execution.completed_at is not None
        finally:
            mod.playbooks = old_playbooks
            mod.publisher = old_publisher

    @pytest.mark.asyncio
    async def test_execution_with_failure_triggers_rollback(self):
        import services.automation_orchestrator.main as mod
        from services.automation_orchestrator.main import ActionExecutor, ACTION_EXECUTORS

        class FailingExecutor(ActionExecutor):
            async def execute(self, action, context):
                return {"status": "failed", "error": "Simulated failure"}

        actions = [
            _make_action(action_id="a1", action_type="notification", rollback_action="undo_a1",
                         parameters={"channels": [], "recipients": [], "message": "test"}),
            _make_action(action_id="a2", action_type="ssh_command", rollback_action="undo_a2"),
        ]
        playbook = _make_playbook(actions=actions, approval_required=False)
        execution = _make_execution(status=WorkflowStatus.PENDING)

        old_playbooks = dict(mod.playbooks)
        old_publisher = mod.publisher
        old_ssh = ACTION_EXECUTORS.get("ssh_command")
        mod.playbooks["test-playbook"] = playbook
        mod.publisher = MagicMock()
        mod.publisher.publish = AsyncMock()
        ACTION_EXECUTORS["ssh_command"] = FailingExecutor()

        try:
            with patch.object(mod, "audit_log", new_callable=AsyncMock):
                with patch.object(mod, "persist_execution_update", new_callable=AsyncMock):
                    await mod.execute_playbook(execution)

            assert execution.status == WorkflowStatus.FAILED
            assert execution.rollback_performed is True
            assert "a2" in execution.error
        finally:
            mod.playbooks = old_playbooks
            mod.publisher = old_publisher
            ACTION_EXECUTORS["ssh_command"] = old_ssh

    @pytest.mark.asyncio
    async def test_execution_awaits_approval(self):
        import services.automation_orchestrator.main as mod

        playbook = _make_playbook(approval_required=True)
        execution = _make_execution(status=WorkflowStatus.PENDING, approval_status=None)

        old_playbooks = dict(mod.playbooks)
        mod.playbooks["test-playbook"] = playbook

        try:
            await mod.execute_playbook(execution)

            assert execution.status == WorkflowStatus.PENDING
            assert len(execution.results) == 0
        finally:
            mod.playbooks = old_playbooks

    @pytest.mark.asyncio
    async def test_approved_execution_runs(self):
        import services.automation_orchestrator.main as mod

        actions = [
            _make_action(action_id="a1", action_type="notification",
                         parameters={"channels": [], "recipients": [], "message": "test"}),
        ]
        playbook = _make_playbook(actions=actions, approval_required=True)
        execution = _make_execution(status=WorkflowStatus.PENDING, approval_status="approved")

        old_playbooks = dict(mod.playbooks)
        old_publisher = mod.publisher
        mod.playbooks["test-playbook"] = playbook
        mod.publisher = MagicMock()
        mod.publisher.publish = AsyncMock()

        try:
            with patch.object(mod, "audit_log", new_callable=AsyncMock):
                with patch.object(mod, "persist_execution_update", new_callable=AsyncMock):
                    await mod.execute_playbook(execution)

            assert execution.status == WorkflowStatus.COMPLETED
        finally:
            mod.playbooks = old_playbooks
            mod.publisher = old_publisher

    @pytest.mark.asyncio
    async def test_execution_playbook_not_found(self):
        import services.automation_orchestrator.main as mod

        execution = _make_execution(playbook_id="nonexistent")

        old_publisher = mod.publisher
        mod.publisher = MagicMock()
        mod.publisher.publish = AsyncMock()

        try:
            with patch.object(mod, "persist_execution_update", new_callable=AsyncMock):
                await mod.execute_playbook(execution)

            assert execution.status == WorkflowStatus.FAILED
            assert "not found" in execution.error
        finally:
            mod.publisher = old_publisher

    @pytest.mark.asyncio
    async def test_skipped_action_continues_execution(self):
        import services.automation_orchestrator.main as mod

        actions = [
            _make_action(
                action_id="conditional",
                action_type="notification",
                parameters={"channels": [], "recipients": [], "message": "test"},
                conditions=[{"field": "severity", "operator": "==", "value": "critical"}],
            ),
            _make_action(
                action_id="always",
                action_type="notification",
                parameters={"channels": [], "recipients": [], "message": "test"},
            ),
        ]
        playbook = _make_playbook(actions=actions)
        execution = _make_execution(input_data={"severity": "low"})

        old_playbooks = dict(mod.playbooks)
        old_publisher = mod.publisher
        mod.playbooks["test-playbook"] = playbook
        mod.publisher = MagicMock()
        mod.publisher.publish = AsyncMock()

        try:
            with patch.object(mod, "audit_log", new_callable=AsyncMock):
                with patch.object(mod, "persist_execution_update", new_callable=AsyncMock):
                    await mod.execute_playbook(execution)

            assert execution.status == WorkflowStatus.COMPLETED
            assert len(execution.results) == 2
            assert execution.results[0]["result"]["status"] == "skipped"
            assert execution.results[1]["result"]["status"] == "success"
        finally:
            mod.playbooks = old_playbooks
            mod.publisher = old_publisher


# ---------------------------------------------------------------------------
# start_playbook_execution
# ---------------------------------------------------------------------------


class TestStartPlaybookExecution:
    """Test starting playbook execution."""

    @pytest.mark.asyncio
    async def test_start_creates_execution(self):
        import services.automation_orchestrator.main as mod

        playbook = _make_playbook(approval_required=True)
        old_playbooks = dict(mod.playbooks)
        mod.playbooks["test-playbook"] = playbook

        try:
            with patch.object(mod, "persist_execution_start", new_callable=AsyncMock):
                with patch.object(mod, "execute_playbook", new_callable=AsyncMock):
                    execution = await mod.start_playbook_execution(
                        "test-playbook", "ALT-001", {"key": "value"}
                    )

            assert execution.playbook_id == "test-playbook"
            assert execution.trigger_alert_id == "ALT-001"
            assert execution.input_data == {"key": "value"}
            assert execution.execution_id.startswith("pb-exec-")
        finally:
            mod.playbooks = old_playbooks


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------


class TestAuditLog:
    """Test audit log function."""

    @pytest.mark.asyncio
    async def test_audit_log_no_db_manager(self):
        import services.automation_orchestrator.main as mod

        old_db = mod.db_manager
        mod.db_manager = None
        try:
            # Should not raise
            await mod.audit_log(
                event_type="test.event",
                action="test",
                target_type="test",
                target_id="123",
            )
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_audit_log_with_db_manager(self):
        import services.automation_orchestrator.main as mod

        mock_session = AsyncMock()
        mock_session.commit = AsyncMock()
        mock_session.add = MagicMock()

        mock_db = MagicMock()
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            await mod.audit_log(
                event_type="automation.test",
                action="test",
                target_type="playbook",
                target_id="pb-1",
                details={"foo": "bar"},
            )

            mock_session.add.assert_called_once()
            mock_session.commit.assert_called_once()
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_audit_log_handles_db_error(self):
        import services.automation_orchestrator.main as mod

        mock_db = MagicMock()
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(side_effect=Exception("DB error"))
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            # Should not raise
            await mod.audit_log(event_type="test", action="test")
        finally:
            mod.db_manager = old_db


# ---------------------------------------------------------------------------
# DB Persistence Helpers
# ---------------------------------------------------------------------------


class TestDBPersistence:
    """Test DB persistence helper functions."""

    @pytest.mark.asyncio
    async def test_persist_execution_start_no_db(self):
        import services.automation_orchestrator.main as mod

        old_db = mod.db_manager
        mod.db_manager = None
        try:
            execution = _make_execution()
            await mod.persist_execution_start(execution)  # Should not raise
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_persist_execution_update_no_db(self):
        import services.automation_orchestrator.main as mod

        old_db = mod.db_manager
        mod.db_manager = None
        try:
            execution = _make_execution()
            await mod.persist_execution_update(execution)  # Should not raise
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_persist_playbook_no_db(self):
        import services.automation_orchestrator.main as mod

        old_db = mod.db_manager
        mod.db_manager = None
        try:
            playbook = _make_playbook()
            await mod.persist_playbook(playbook)  # Should not raise
        finally:
            mod.db_manager = old_db


# ---------------------------------------------------------------------------
# Default Playbooks
# ---------------------------------------------------------------------------


class TestDefaultPlaybooks:
    """Test default playbook definitions."""

    def test_default_playbooks_loaded(self):
        from services.automation_orchestrator.main import DEFAULT_PLAYBOOKS

        assert "malware-response" in DEFAULT_PLAYBOOKS
        assert "phishing-response" in DEFAULT_PLAYBOOKS

    def test_malware_playbook_has_rollback(self):
        from services.automation_orchestrator.main import DEFAULT_PLAYBOOKS

        pb = DEFAULT_PLAYBOOKS["malware-response"]
        # isolate-host and quarantine-file should have rollback
        rollback_actions = [a for a in pb.actions if a.rollback_action]
        assert len(rollback_actions) >= 2

    def test_phishing_playbook_has_rollback(self):
        from services.automation_orchestrator.main import DEFAULT_PLAYBOOKS

        pb = DEFAULT_PLAYBOOKS["phishing-response"]
        rollback_actions = [a for a in pb.actions if a.rollback_action]
        assert len(rollback_actions) >= 1

    def test_default_playbooks_valid(self):
        from services.automation_orchestrator.main import DEFAULT_PLAYBOOKS

        for pb_id, pb in DEFAULT_PLAYBOOKS.items():
            assert pb.playbook_id == pb_id
            assert len(pb.actions) > 0
            assert pb.version == "1.0.0"


# ---------------------------------------------------------------------------
# Playbooks module
# ---------------------------------------------------------------------------


class TestPlaybooksModule:
    """Test playbooks.py definitions."""

    def test_get_all_playbooks(self):
        from services.automation_orchestrator.playbooks import get_all_playbooks

        pbs = get_all_playbooks()
        assert len(pbs) == 6
        assert "malware-containment" in pbs
        assert "ransomware-response" in pbs
        assert "phishing-email-containment" in pbs
        assert "brute-force-rate-limit" in pbs
        assert "account-lockout-enforcement" in pbs
        assert "data-exfiltration-containment" in pbs

    def test_get_playbook_for_alert_malware(self):
        from services.automation_orchestrator.playbooks import get_playbook_for_alert

        result = get_playbook_for_alert("malware", "high")
        assert "malware-containment" in result

    def test_get_playbook_for_alert_ransomware(self):
        from services.automation_orchestrator.playbooks import get_playbook_for_alert

        result = get_playbook_for_alert("malware", "critical")
        assert "malware-containment" in result
        assert "ransomware-response" in result

    def test_get_playbook_for_alert_phishing(self):
        from services.automation_orchestrator.playbooks import get_playbook_for_alert

        result = get_playbook_for_alert("phishing")
        assert "phishing-email-containment" in result

    def test_get_playbook_for_alert_brute_force(self):
        from services.automation_orchestrator.playbooks import get_playbook_for_alert

        result = get_playbook_for_alert("brute_force", "high")
        assert "brute-force-rate-limit" in result
        assert "account-lockout-enforcement" in result

    def test_get_playbook_for_alert_data_exfiltration(self):
        from services.automation_orchestrator.playbooks import get_playbook_for_alert

        result = get_playbook_for_alert("data_exfiltration")
        assert "data-exfiltration-containment" in result

    def test_get_playbook_for_unknown_alert(self):
        from services.automation_orchestrator.playbooks import get_playbook_for_alert

        result = get_playbook_for_alert("unknown_type")
        assert result == []

    def test_all_playbooks_have_actions(self):
        from services.automation_orchestrator.playbooks import get_all_playbooks

        for pb_id, pb in get_all_playbooks().items():
            assert len(pb.actions) > 0, f"Playbook {pb_id} has no actions"

    def test_malware_containment_playbook_details(self):
        from services.automation_orchestrator.playbooks import MALWARE_CONTAINMENT_PLAYBOOK

        pb = MALWARE_CONTAINMENT_PLAYBOOK
        assert pb.approval_required is True
        assert pb.timeout_seconds == 600
        assert len(pb.actions) == 6
        # Check rollback actions are defined
        rollback_actions = [a for a in pb.actions if a.rollback_action]
        assert len(rollback_actions) >= 3


# ---------------------------------------------------------------------------
# Shared Model Tests
# ---------------------------------------------------------------------------


class TestSharedModels:
    """Test shared Pydantic model fields."""

    def test_playbook_action_rollback_field(self):
        action = PlaybookAction(
            action_id="test",
            action_type="ssh_command",
            name="Test",
            description="Test action",
            rollback_action="undo_test",
        )
        assert action.rollback_action == "undo_test"

    def test_playbook_action_rollback_default_none(self):
        action = PlaybookAction(
            action_id="test",
            action_type="ssh_command",
            name="Test",
            description="Test action",
        )
        assert action.rollback_action is None

    def test_automation_playbook_rollback_actions_field(self):
        pb = AutomationPlaybook(
            playbook_id="test",
            name="Test",
            description="Test playbook",
            version="1.0.0",
            actions=[_make_action()],
            rollback_actions=["undo_a", "undo_b"],
        )
        assert pb.rollback_actions == ["undo_a", "undo_b"]

    def test_playbook_execution_input_data_field(self):
        execution = PlaybookExecution(
            execution_id="test",
            playbook_id="test",
            trigger_alert_id="ALT-001",
            status=WorkflowStatus.PENDING,
            input_data={"key": "value"},
        )
        assert execution.input_data == {"key": "value"}

    def test_playbook_execution_input_data_default(self):
        execution = PlaybookExecution(
            execution_id="test",
            playbook_id="test",
            trigger_alert_id="ALT-001",
            status=WorkflowStatus.PENDING,
        )
        assert execution.input_data == {}

    def test_playbook_execution_rollback_performed_default(self):
        execution = PlaybookExecution(
            execution_id="test",
            playbook_id="test",
            trigger_alert_id="ALT-001",
            status=WorkflowStatus.PENDING,
        )
        assert execution.rollback_performed is False


# ---------------------------------------------------------------------------
# API Endpoint Tests (using FastAPI TestClient pattern via direct calls)
# ---------------------------------------------------------------------------


class TestAPIEndpoints:
    """Test API endpoint logic."""

    @pytest.mark.asyncio
    async def test_health_check(self):
        from services.automation_orchestrator.main import health_check

        result = await health_check()
        assert result["status"] == "healthy"
        assert result["service"] == "automation-orchestrator"
        assert "executors" in result

    @pytest.mark.asyncio
    async def test_list_playbooks_endpoint(self):
        import services.automation_orchestrator.main as mod

        old_playbooks = dict(mod.playbooks)
        mod.playbooks = {"test": _make_playbook()}

        try:
            result = await mod.list_playbooks()
            assert result["success"] is True
            assert result["data"]["total"] == 1
        finally:
            mod.playbooks = old_playbooks

    @pytest.mark.asyncio
    async def test_get_playbook_found(self):
        import services.automation_orchestrator.main as mod

        old_playbooks = dict(mod.playbooks)
        mod.playbooks = {"test-playbook": _make_playbook()}

        try:
            result = await mod.get_playbook("test-playbook")
            assert result["success"] is True
            assert result["data"]["playbook_id"] == "test-playbook"
        finally:
            mod.playbooks = old_playbooks

    @pytest.mark.asyncio
    async def test_get_playbook_not_found(self):
        import services.automation_orchestrator.main as mod

        old_playbooks = dict(mod.playbooks)
        mod.playbooks = {}

        try:
            with pytest.raises(HTTPException) as exc_info:
                await mod.get_playbook("nonexistent")
            assert exc_info.value.status_code == 404
        finally:
            mod.playbooks = old_playbooks

    @pytest.mark.asyncio
    async def test_create_playbook_endpoint(self):
        import services.automation_orchestrator.main as mod

        old_playbooks = dict(mod.playbooks)
        mod.playbooks = {}

        try:
            with patch.object(mod, "persist_playbook", new_callable=AsyncMock):
                with patch.object(mod, "audit_log", new_callable=AsyncMock):
                    result = await mod.create_playbook(_make_playbook())
            assert result["success"] is True
            assert "test-playbook" in mod.playbooks
        finally:
            mod.playbooks = old_playbooks

    @pytest.mark.asyncio
    async def test_delete_playbook_endpoint(self):
        import services.automation_orchestrator.main as mod

        old_playbooks = dict(mod.playbooks)
        old_db = mod.db_manager
        mod.playbooks = {"test-playbook": _make_playbook()}
        mod.db_manager = None

        try:
            with patch.object(mod, "audit_log", new_callable=AsyncMock):
                result = await mod.delete_playbook("test-playbook")
            assert result["success"] is True
            assert "test-playbook" not in mod.playbooks
        finally:
            mod.playbooks = old_playbooks
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_delete_playbook_not_found(self):
        import services.automation_orchestrator.main as mod

        old_playbooks = dict(mod.playbooks)
        mod.playbooks = {}

        try:
            with pytest.raises(HTTPException) as exc_info:
                await mod.delete_playbook("nonexistent")
            assert exc_info.value.status_code == 404
        finally:
            mod.playbooks = old_playbooks

    @pytest.mark.asyncio
    async def test_get_execution_found(self):
        import services.automation_orchestrator.main as mod

        execution = _make_execution()
        old_execs = dict(mod.active_executions)
        mod.active_executions = {"pb-exec-test-123": execution}

        try:
            result = await mod.get_execution("pb-exec-test-123")
            assert result["success"] is True
        finally:
            mod.active_executions = old_execs

    @pytest.mark.asyncio
    async def test_get_execution_not_found(self):
        import services.automation_orchestrator.main as mod

        old_execs = dict(mod.active_executions)
        mod.active_executions = {}

        try:
            with pytest.raises(HTTPException) as exc_info:
                await mod.get_execution("nonexistent")
            assert exc_info.value.status_code == 404
        finally:
            mod.active_executions = old_execs

    @pytest.mark.asyncio
    async def test_cancel_execution(self):
        import services.automation_orchestrator.main as mod

        execution = _make_execution(status=WorkflowStatus.RUNNING)
        old_execs = dict(mod.active_executions)
        mod.active_executions = {"pb-exec-test-123": execution}

        try:
            with patch.object(mod, "persist_execution_update", new_callable=AsyncMock):
                with patch.object(mod, "audit_log", new_callable=AsyncMock):
                    result = await mod.cancel_execution("pb-exec-test-123")
            assert result["success"] is True
            assert execution.status == WorkflowStatus.CANCELLED
        finally:
            mod.active_executions = old_execs

    @pytest.mark.asyncio
    async def test_cancel_completed_execution_fails(self):
        import services.automation_orchestrator.main as mod

        execution = _make_execution(status=WorkflowStatus.COMPLETED)
        old_execs = dict(mod.active_executions)
        mod.active_executions = {"pb-exec-test-123": execution}

        try:
            with pytest.raises(HTTPException) as exc_info:
                await mod.cancel_execution("pb-exec-test-123")
            assert exc_info.value.status_code == 400
        finally:
            mod.active_executions = old_execs

    @pytest.mark.asyncio
    async def test_approve_execution(self):
        import services.automation_orchestrator.main as mod

        execution = _make_execution(status=WorkflowStatus.PENDING)
        old_execs = dict(mod.active_executions)
        mod.active_executions = {"pb-exec-test-123": execution}

        try:
            with patch.object(mod, "execute_playbook", new_callable=AsyncMock):
                with patch.object(mod, "audit_log", new_callable=AsyncMock):
                    result = await mod.approve_execution("pb-exec-test-123", "admin", "LGTM")
            assert result["success"] is True
            assert execution.approval_status == "approved"
            assert execution.approved_by == "admin"
        finally:
            mod.active_executions = old_execs

    @pytest.mark.asyncio
    async def test_approve_non_pending_fails(self):
        import services.automation_orchestrator.main as mod

        execution = _make_execution(status=WorkflowStatus.RUNNING)
        old_execs = dict(mod.active_executions)
        mod.active_executions = {"pb-exec-test-123": execution}

        try:
            with pytest.raises(HTTPException) as exc_info:
                await mod.approve_execution("pb-exec-test-123", "admin")
            assert exc_info.value.status_code == 400
        finally:
            mod.active_executions = old_execs

    @pytest.mark.asyncio
    async def test_list_executions_filter_by_status(self):
        import services.automation_orchestrator.main as mod

        exec1 = _make_execution(status=WorkflowStatus.RUNNING)
        exec1.execution_id = "exec-1"
        exec2 = _make_execution(status=WorkflowStatus.COMPLETED)
        exec2.execution_id = "exec-2"

        old_execs = dict(mod.active_executions)
        mod.active_executions = {"exec-1": exec1, "exec-2": exec2}

        try:
            result = await mod.list_executions(status=WorkflowStatus.RUNNING)
            assert result["data"]["total"] == 1
        finally:
            mod.active_executions = old_execs

    @pytest.mark.asyncio
    async def test_list_executions_filter_by_playbook(self):
        import services.automation_orchestrator.main as mod

        exec1 = _make_execution(playbook_id="pb-a")
        exec1.execution_id = "exec-1"
        exec2 = _make_execution(playbook_id="pb-b")
        exec2.execution_id = "exec-2"

        old_execs = dict(mod.active_executions)
        mod.active_executions = {"exec-1": exec1, "exec-2": exec2}

        try:
            result = await mod.list_executions(playbook_id="pb-a")
            assert result["data"]["total"] == 1
        finally:
            mod.active_executions = old_execs


# Need to import HTTPException for test assertions
from fastapi import HTTPException
