"""Unit tests for Workflow Engine service - execution, branching, tasks, correlation,
audit logging, SLA management, smart assignment, approval workflow, and CRUD APIs."""

import asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared.models import (
    HumanTask,
    TaskPriority,
    TaskStatus,
    WorkflowDefinition,
    WorkflowExecution,
    WorkflowStatus,
)

# ---------------------------------------------------------------------------
# Decision Expression Evaluation
# ---------------------------------------------------------------------------


class TestDecisionEvaluation:
    """Test the condition expression evaluator."""

    def test_in_expression_true(self):
        from services.workflow_engine.main import evaluate_condition

        ctx = {"risk_level": "CRITICAL"}
        assert evaluate_condition("risk_level in ('CRITICAL', 'HIGH')", ctx) is True

    def test_in_expression_false(self):
        from services.workflow_engine.main import evaluate_condition

        ctx = {"risk_level": "LOW"}
        assert evaluate_condition("risk_level in ('CRITICAL', 'HIGH')", ctx) is False

    def test_equality_expression(self):
        from services.workflow_engine.main import evaluate_condition

        ctx = {"severity": "critical"}
        assert evaluate_condition("severity == 'CRITICAL'", ctx) is True

    def test_inequality_expression(self):
        from services.workflow_engine.main import evaluate_condition

        ctx = {"severity": "low"}
        assert evaluate_condition("severity != 'CRITICAL'", ctx) is True

    def test_numeric_comparison_greater(self):
        from services.workflow_engine.main import evaluate_condition

        ctx = {"threat_score": 85}
        assert evaluate_condition("threat_score > 70", ctx) is True
        assert evaluate_condition("threat_score > 90", ctx) is False

    def test_numeric_comparison_gte(self):
        from services.workflow_engine.main import evaluate_condition

        ctx = {"confidence": 80}
        assert evaluate_condition("confidence >= 80", ctx) is True
        assert evaluate_condition("confidence >= 81", ctx) is False

    def test_empty_condition_returns_true(self):
        from services.workflow_engine.main import evaluate_condition

        assert evaluate_condition("", {}) is True
        assert evaluate_condition("  ", {}) is True

    def test_missing_variable_defaults_safely(self):
        from services.workflow_engine.main import evaluate_condition

        ctx = {}
        # risk_level not in context → empty string → not in CRITICAL/HIGH
        assert evaluate_condition("risk_level in ('CRITICAL', 'HIGH')", ctx) is False

    def test_case_insensitive_matching(self):
        from services.workflow_engine.main import evaluate_condition

        ctx = {"risk_level": "critical"}
        assert evaluate_condition("risk_level in ('CRITICAL', 'HIGH')", ctx) is True

    def test_legacy_risk_level_fallback(self):
        from services.workflow_engine.main import evaluate_condition

        ctx = {"risk_level": "HIGH"}
        assert evaluate_condition("risk_level check", ctx) is True

        ctx2 = {"risk_level": "LOW"}
        assert evaluate_condition("risk_level check", ctx2) is False


# ---------------------------------------------------------------------------
# Notification Helpers
# ---------------------------------------------------------------------------


class TestNotificationHelpers:
    """Test notification template rendering and dispatch."""

    def test_safe_format_dict_missing_key(self):
        from services.workflow_engine.main import _SafeFormatDict

        d = _SafeFormatDict({"name": "test"})
        result = "Hello {name}, status: {status}".format_map(d)
        assert "test" in result
        assert "{status}" in result  # Missing key preserved

    @pytest.mark.asyncio
    async def test_send_notification_with_publisher(self):
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import send_notification

        mock_pub = AsyncMock()
        original_pub = wf_module.publisher
        wf_module.publisher = mock_pub

        try:
            result = await send_notification(
                channels=["security-team"],
                template="workflow_completed",
                context={
                    "workflow_id": "test-wf",
                    "alert_id": "ALT-001",
                    "risk_level": "HIGH",
                    "status": "completed",
                },
            )
            assert result["status"] == "dispatched"
            assert "security-team" in result["channels"]
            mock_pub.publish.assert_called_once()
        finally:
            wf_module.publisher = original_pub

    @pytest.mark.asyncio
    async def test_send_notification_without_publisher(self):
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import send_notification

        original_pub = wf_module.publisher
        wf_module.publisher = None

        try:
            result = await send_notification(
                channels=["team"], template="workflow_completed", context={}
            )
            assert result["status"] == "dispatched"  # Still returns dispatched
        finally:
            wf_module.publisher = original_pub


# ---------------------------------------------------------------------------
# Automation Trigger
# ---------------------------------------------------------------------------


class TestAutomationTrigger:
    """Test automation playbook triggering."""

    def test_alert_type_playbook_map(self):
        from services.workflow_engine.main import ALERT_TYPE_PLAYBOOK_MAP

        assert ALERT_TYPE_PLAYBOOK_MAP["malware"] == "malware-response"
        assert ALERT_TYPE_PLAYBOOK_MAP["phishing"] == "phishing-response"

    @pytest.mark.asyncio
    async def test_trigger_automation_for_malware(self):
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import pending_approvals, trigger_automation

        mock_pub = AsyncMock()
        original_pub = wf_module.publisher
        wf_module.publisher = mock_pub

        try:
            # Use LOW risk to bypass approval (CRITICAL would require approval)
            execution = WorkflowExecution(
                execution_id="exec-auto-001",
                workflow_id="alert-processing",
                status=WorkflowStatus.RUNNING,
                input={
                    "alert": {
                        "alert_id": "ALT-001",
                        "alert_type": "malware",
                        "source_ip": "1.2.3.4",
                    },
                    "risk_level": "LOW",
                },
            )

            step = {"type": "automation", "playbook_selector": "by_alert_type"}
            result = await trigger_automation(execution, step)

            assert result["status"] == "triggered"
            assert result["playbook_id"] == "malware-response"
            mock_pub.publish.assert_called_once()
            call_args = mock_pub.publish.call_args
            assert call_args[0][0] == "automation.trigger"
        finally:
            wf_module.publisher = original_pub

    @pytest.mark.asyncio
    async def test_trigger_automation_no_playbook_mapped(self):
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import trigger_automation

        original_pub = wf_module.publisher
        wf_module.publisher = AsyncMock()

        try:
            execution = WorkflowExecution(
                execution_id="exec-auto-002",
                workflow_id="alert-processing",
                status=WorkflowStatus.RUNNING,
                input={
                    "alert": {"alert_id": "ALT-002", "alert_type": "anomaly"},
                },
            )

            step = {"type": "automation", "playbook_selector": "by_alert_type"}
            result = await trigger_automation(execution, step)

            assert result["status"] == "skipped"
        finally:
            wf_module.publisher = original_pub


# ---------------------------------------------------------------------------
# Step Execution
# ---------------------------------------------------------------------------


class TestStepExecution:
    """Test individual workflow step types."""

    @pytest.mark.asyncio
    async def test_activity_step_correlation(self):
        """Correlation activity should run and return results."""
        from services.workflow_engine.main import execute_workflow_step, recent_alerts_cache

        execution = WorkflowExecution(
            execution_id="exec-step-001",
            workflow_id="alert-processing",
            status=WorkflowStatus.RUNNING,
            input={
                "alert_id": "STEP-001",
                "alert_type": "malware",
                "severity": "high",
                "source_ip": "1.2.3.4",
            },
        )

        step = {"name": "correlate", "type": "activity", "service": "correlation"}
        result = await execute_workflow_step(execution, step)

        assert result["status"] == "completed"
        assert "output" in result
        assert "attack_chains" in result["output"]
        assert "correlation" in execution.input

    @pytest.mark.asyncio
    async def test_activity_step_generic_service(self):
        """Generic service activity should publish a message."""
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import execute_workflow_step

        mock_pub = AsyncMock()
        original_pub = wf_module.publisher
        wf_module.publisher = mock_pub

        try:
            execution = WorkflowExecution(
                execution_id="exec-step-002",
                workflow_id="alert-processing",
                status=WorkflowStatus.RUNNING,
                input={"alert_id": "STEP-002"},
            )

            step = {"name": "enrich", "type": "activity", "service": "context_collector"}
            result = await execute_workflow_step(execution, step)

            assert result["status"] == "completed"
            mock_pub.publish.assert_called_once()
            assert mock_pub.publish.call_args[0][0] == "workflow.context_collector"
        finally:
            wf_module.publisher = original_pub

    @pytest.mark.asyncio
    async def test_decision_step_true(self):
        """Decision step should evaluate to True for CRITICAL risk."""
        from services.workflow_engine.main import execute_workflow_step

        execution = WorkflowExecution(
            execution_id="exec-step-003",
            workflow_id="alert-processing",
            status=WorkflowStatus.RUNNING,
            input={"risk_level": "CRITICAL"},
        )

        step = {
            "name": "auto_response",
            "type": "decision",
            "condition": "risk_level in ('CRITICAL', 'HIGH')",
            "on_true": "trigger_automation",
            "on_false": "human_review",
        }
        result = await execute_workflow_step(execution, step)

        assert result["decision"] is True
        assert result["goto"] == "trigger_automation"

    @pytest.mark.asyncio
    async def test_decision_step_false(self):
        """Decision step should evaluate to False for LOW risk."""
        from services.workflow_engine.main import execute_workflow_step

        execution = WorkflowExecution(
            execution_id="exec-step-004",
            workflow_id="alert-processing",
            status=WorkflowStatus.RUNNING,
            input={"risk_level": "LOW"},
        )

        step = {
            "name": "auto_response",
            "type": "decision",
            "condition": "risk_level in ('CRITICAL', 'HIGH')",
            "on_true": "trigger_automation",
            "on_false": "human_review",
        }
        result = await execute_workflow_step(execution, step)

        assert result["decision"] is False
        assert result["goto"] == "human_review"

    @pytest.mark.asyncio
    async def test_human_task_step(self):
        """Human task step should create a pending task."""
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import execute_workflow_step, pending_tasks

        original_pub = wf_module.publisher
        wf_module.publisher = AsyncMock()

        try:
            execution = WorkflowExecution(
                execution_id="exec-step-005",
                workflow_id="alert-processing",
                status=WorkflowStatus.RUNNING,
                input={"alert_id": "STEP-005"},
            )

            step = {
                "name": "human_review",
                "type": "human_task",
                "description": "Review this alert",
                "assignee": "analyst-1",
                "priority": "high",
            }
            result = await execute_workflow_step(execution, step)

            assert result["status"] == "pending"
            assert result["assigned_to"] == "analyst-1"
            assert result["task_id"] in pending_tasks
            task = pending_tasks[result["task_id"]]
            assert task.priority == TaskPriority.HIGH
            assert task.assigned_to == "analyst-1"

            # Cleanup
            pending_tasks.pop(result["task_id"], None)
        finally:
            wf_module.publisher = original_pub

    @pytest.mark.asyncio
    async def test_notification_step(self):
        """Notification step should dispatch notifications."""
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import execute_workflow_step

        mock_pub = AsyncMock()
        original_pub = wf_module.publisher
        wf_module.publisher = mock_pub

        try:
            execution = WorkflowExecution(
                execution_id="exec-step-006",
                workflow_id="alert-processing",
                status=WorkflowStatus.RUNNING,
                input={"alert": {"alert_id": "STEP-006"}, "risk_level": "HIGH"},
            )

            step = {
                "name": "notify_team",
                "type": "notification",
                "channels": ["security-team"],
                "template": "workflow_completed",
            }
            result = await execute_workflow_step(execution, step)

            assert result["status"] == "completed"
            mock_pub.publish.assert_called_once()
        finally:
            wf_module.publisher = original_pub

    @pytest.mark.asyncio
    async def test_unknown_step_type_skipped(self):
        """Unknown step type should be skipped gracefully."""
        from services.workflow_engine.main import execute_workflow_step

        execution = WorkflowExecution(
            execution_id="exec-step-007",
            workflow_id="test",
            status=WorkflowStatus.RUNNING,
            input={},
        )

        step = {"name": "unknown", "type": "imaginary_type"}
        result = await execute_workflow_step(execution, step)

        assert result["status"] == "skipped"


# ---------------------------------------------------------------------------
# Step Retry Logic
# ---------------------------------------------------------------------------


class TestStepRetry:
    """Test step-level retry with backoff."""

    @pytest.mark.asyncio
    async def test_retry_succeeds_on_second_attempt(self):
        from services.workflow_engine.main import execute_step_with_retry

        execution = WorkflowExecution(
            execution_id="exec-retry-001",
            workflow_id="test",
            status=WorkflowStatus.RUNNING,
            input={"alert_id": "RETRY-001"},
        )

        call_count = 0

        async def mock_step(exec, step):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return {"status": "failed", "error": "Temporary error"}
            return {"status": "completed", "output": {"ok": True}}

        step = {
            "name": "flaky_step",
            "type": "activity",
            "service": "test_service",
            "retry": {"max_attempts": 3, "backoff_seconds": 0},  # 0 for fast test
        }

        with patch("services.workflow_engine.main.execute_workflow_step", side_effect=mock_step):
            result = await execute_step_with_retry(execution, step)

        assert result["status"] == "completed"
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_retry_exhausted(self):
        from services.workflow_engine.main import execute_step_with_retry

        execution = WorkflowExecution(
            execution_id="exec-retry-002",
            workflow_id="test",
            status=WorkflowStatus.RUNNING,
            input={},
        )

        step = {
            "name": "always_fail",
            "type": "activity",
            "retry": {"max_attempts": 2, "backoff_seconds": 0},
        }

        with patch(
            "services.workflow_engine.main.execute_workflow_step",
            new_callable=AsyncMock,
            return_value={"status": "failed", "error": "Persistent error"},
        ):
            result = await execute_step_with_retry(execution, step)

        assert result["status"] == "failed"
        assert result["attempts"] == 2


# ---------------------------------------------------------------------------
# Human Task Completion & Resume
# ---------------------------------------------------------------------------


class TestHumanTaskCompletion:
    """Test human task lifecycle and workflow resume."""

    def test_complete_task(self):
        from services.workflow_engine.main import (
            _resume_events,
            active_executions,
            complete_human_task,
            pending_tasks,
        )

        # Create a pending task
        task = HumanTask(
            task_id="task-complete-001",
            execution_id="exec-resume-001",
            task_type="manual_review",
            title="Review alert",
            description="Review and confirm",
            assigned_to="analyst",
            status=TaskStatus.ASSIGNED,
            priority=TaskPriority.MEDIUM,
        )
        pending_tasks["task-complete-001"] = task

        # Create matching execution
        execution = WorkflowExecution(
            execution_id="exec-resume-001",
            workflow_id="test",
            status=WorkflowStatus.PENDING,
            input={"alert_id": "TEST-001"},
        )
        active_executions["exec-resume-001"] = execution

        # Create resume event
        event = asyncio.Event()
        _resume_events["exec-resume-001"] = event

        # Complete the task
        completed = complete_human_task(
            "task-complete-001",
            output_data={"disposition": "true_positive"},
            notes="Confirmed malware",
        )

        assert completed.status == TaskStatus.COMPLETED
        assert completed.output_data["disposition"] == "true_positive"
        assert completed.notes == "Confirmed malware"
        assert event.is_set()  # Workflow should resume
        assert "task-complete-001" not in pending_tasks
        assert execution.input["human_task_result"]["disposition"] == "true_positive"

        # Cleanup
        active_executions.pop("exec-resume-001", None)
        _resume_events.pop("exec-resume-001", None)

    def test_complete_nonexistent_task_raises(self):
        from shared.errors import WorkflowError

        from services.workflow_engine.main import complete_human_task

        with pytest.raises(WorkflowError, match="Task not found"):
            complete_human_task("task-nonexistent")

    def test_complete_already_completed_task_raises(self):
        from shared.errors import WorkflowError

        from services.workflow_engine.main import complete_human_task, pending_tasks

        task = HumanTask(
            task_id="task-already-done",
            execution_id="exec-xxx",
            task_type="review",
            title="Done",
            description="Already done",
            status=TaskStatus.COMPLETED,
            priority=TaskPriority.LOW,
        )
        pending_tasks["task-already-done"] = task

        try:
            with pytest.raises(WorkflowError, match="terminal state"):
                complete_human_task("task-already-done")
        finally:
            pending_tasks.pop("task-already-done", None)


# ---------------------------------------------------------------------------
# Workflow Execution
# ---------------------------------------------------------------------------


class TestWorkflowExecution:
    """Test full workflow execution orchestration."""

    @pytest.mark.asyncio
    async def test_simple_workflow_completes(self):
        """A workflow with only activity steps should complete."""
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import (
            active_executions,
            execute_workflow,
            execution_step_results,
            workflow_definitions,
        )

        # Register a simple test workflow
        test_wf = WorkflowDefinition(
            workflow_id="test-simple",
            name="Simple Test",
            description="Test workflow",
            version="1.0",
            steps=[
                {"name": "step1", "type": "activity", "service": "correlation"},
                {"name": "step2", "type": "activity", "service": "correlation"},
            ],
            timeout_seconds=60,
        )
        workflow_definitions["test-simple"] = test_wf

        mock_pub = AsyncMock()
        original_pub = wf_module.publisher
        wf_module.publisher = mock_pub

        try:
            execution = WorkflowExecution(
                execution_id="exec-simple-001",
                workflow_id="test-simple",
                status=WorkflowStatus.PENDING,
                input={
                    "alert_id": "SIMPLE-001",
                    "alert_type": "malware",
                    "severity": "high",
                },
            )

            await execute_workflow(execution)

            assert execution.status == WorkflowStatus.COMPLETED
            assert execution.progress == 1.0
            assert execution.completed_at is not None
            # Completion event should be published
            mock_pub.publish.assert_called()
        finally:
            wf_module.publisher = original_pub
            workflow_definitions.pop("test-simple", None)
            active_executions.pop("exec-simple-001", None)

    @pytest.mark.asyncio
    async def test_workflow_fails_on_step_error(self):
        """Workflow should fail when a step fails."""
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import (
            active_executions,
            execute_workflow,
            workflow_definitions,
        )

        test_wf = WorkflowDefinition(
            workflow_id="test-fail",
            name="Fail Test",
            description="Test failure",
            version="1.0",
            steps=[
                {"name": "bad_step", "type": "activity", "service": "nonexistent"},
            ],
            timeout_seconds=60,
        )
        workflow_definitions["test-fail"] = test_wf

        mock_pub = AsyncMock()
        # Make publish raise to simulate failure
        mock_pub.publish.side_effect = Exception("Connection refused")
        original_pub = wf_module.publisher
        wf_module.publisher = mock_pub

        try:
            execution = WorkflowExecution(
                execution_id="exec-fail-001",
                workflow_id="test-fail",
                status=WorkflowStatus.PENDING,
                input={"alert_id": "FAIL-001"},
            )

            await execute_workflow(execution)

            assert execution.status == WorkflowStatus.FAILED
            assert execution.error is not None
        finally:
            wf_module.publisher = original_pub
            workflow_definitions.pop("test-fail", None)
            active_executions.pop("exec-fail-001", None)

    @pytest.mark.asyncio
    async def test_workflow_decision_branching(self):
        """Workflow should branch based on decision result."""
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import (
            active_executions,
            execute_workflow,
            workflow_definitions,
        )

        test_wf = WorkflowDefinition(
            workflow_id="test-branch",
            name="Branch Test",
            description="Test branching",
            version="1.0",
            steps=[
                {
                    "name": "check_risk",
                    "type": "decision",
                    "condition": "risk_level in ('CRITICAL', 'HIGH')",
                    "on_true": "high_path",
                    "on_false": "low_path",
                },
                {"name": "low_path", "type": "activity", "service": "correlation"},
                {"name": "high_path", "type": "activity", "service": "correlation"},
            ],
            timeout_seconds=60,
        )
        workflow_definitions["test-branch"] = test_wf
        original_pub = wf_module.publisher
        wf_module.publisher = AsyncMock()

        try:
            # High risk → should jump to high_path, skip low_path
            execution = WorkflowExecution(
                execution_id="exec-branch-001",
                workflow_id="test-branch",
                status=WorkflowStatus.PENDING,
                input={
                    "alert_id": "BRANCH-001",
                    "alert_type": "malware",
                    "risk_level": "CRITICAL",
                },
            )

            await execute_workflow(execution)

            assert execution.status == WorkflowStatus.COMPLETED
            # The high_path step should have run
            step_results = execution.output.get("step_results", {})
            assert "high_path" in step_results
        finally:
            wf_module.publisher = original_pub
            workflow_definitions.pop("test-branch", None)
            active_executions.pop("exec-branch-001", None)

    @pytest.mark.asyncio
    async def test_workflow_not_found_raises(self):
        """Starting a workflow with unknown ID should raise WorkflowError."""
        from shared.errors import WorkflowError

        from services.workflow_engine.main import start_workflow_execution

        with pytest.raises(WorkflowError, match="not found"):
            start_workflow_execution("nonexistent-workflow", {})


# ---------------------------------------------------------------------------
# Workflow Cancellation
# ---------------------------------------------------------------------------


class TestWorkflowCancellation:
    """Test workflow cancellation."""

    @pytest.mark.asyncio
    async def test_cancel_running_execution(self):
        from services.workflow_engine.main import (
            active_executions,
            cancel_workflow_execution,
        )

        execution = WorkflowExecution(
            execution_id="exec-cancel-001",
            workflow_id="test",
            status=WorkflowStatus.RUNNING,
            input={},
        )
        active_executions["exec-cancel-001"] = execution

        try:
            result = await cancel_workflow_execution("exec-cancel-001")
            assert result.status == WorkflowStatus.CANCELLED
            assert result.completed_at is not None
        finally:
            active_executions.pop("exec-cancel-001", None)

    @pytest.mark.asyncio
    async def test_cancel_completed_execution_raises(self):
        from shared.errors import WorkflowError

        from services.workflow_engine.main import (
            active_executions,
            cancel_workflow_execution,
        )

        execution = WorkflowExecution(
            execution_id="exec-cancel-002",
            workflow_id="test",
            status=WorkflowStatus.COMPLETED,
            input={},
        )
        active_executions["exec-cancel-002"] = execution

        try:
            with pytest.raises(WorkflowError, match="Cannot cancel"):
                await cancel_workflow_execution("exec-cancel-002")
        finally:
            active_executions.pop("exec-cancel-002", None)

    @pytest.mark.asyncio
    async def test_cancel_nonexistent_raises(self):
        from shared.errors import WorkflowError

        from services.workflow_engine.main import cancel_workflow_execution

        with pytest.raises(WorkflowError, match="not found"):
            await cancel_workflow_execution("exec-nonexistent")


# ---------------------------------------------------------------------------
# Correlation Integration
# ---------------------------------------------------------------------------


class TestCorrelationIntegration:
    """Test correlation helpers in workflow context."""

    @pytest.mark.asyncio
    async def test_run_correlation_caches_alert(self):
        from services.workflow_engine.main import _run_correlation, recent_alerts_cache

        initial_len = len(recent_alerts_cache)

        input_data = {
            "alert_id": "CORR-001",
            "alert_type": "malware",
            "severity": "high",
            "source_ip": "1.2.3.4",
        }

        result = await _run_correlation(input_data)

        assert "attack_chains" in result
        assert "root_cause" in result
        assert "threat_actor_profile" in result
        assert "impact_analysis" in result
        assert len(recent_alerts_cache) == initial_len + 1

    @pytest.mark.asyncio
    async def test_cache_bounded_at_max(self):
        from services.workflow_engine.main import (
            MAX_RECENT_ALERTS,
            _cache_lock,
            _run_correlation,
            recent_alerts_cache,
        )

        # Fill cache to max
        async with _cache_lock:
            original_cache = list(recent_alerts_cache)
            recent_alerts_cache.clear()
            for i in range(MAX_RECENT_ALERTS):
                recent_alerts_cache.append({"alert_id": f"FILL-{i}"})

        try:
            # Adding one more should evict the oldest
            await _run_correlation({"alert_id": "OVERFLOW-001"})
            assert len(recent_alerts_cache) == MAX_RECENT_ALERTS
            # Oldest entry should have been evicted
            ids = [a["alert_id"] for a in recent_alerts_cache]
            assert "FILL-0" not in ids
            assert "OVERFLOW-001" in ids
        finally:
            async with _cache_lock:
                recent_alerts_cache.clear()
                recent_alerts_cache.extend(original_cache)

    @pytest.mark.asyncio
    async def test_trigger_incident_response(self):
        # Ensure incident-response workflow is registered
        from services.workflow_engine.main import (
            DEFAULT_WORKFLOWS,
            _resume_events,
            _trigger_incident_response,
            active_executions,
            pending_tasks,
            workflow_definitions,
        )

        workflow_definitions.update(DEFAULT_WORKFLOWS)

        execution = WorkflowExecution(
            execution_id="exec-ir-source",
            workflow_id="alert-processing",
            status=WorkflowStatus.RUNNING,
            input={"alert": {"alert_id": "IR-001", "alert_type": "malware"}},
        )

        correlation_result = {
            "attack_chains": [{"chain_type": "initial_access_to_exfil"}],
        }

        await _trigger_incident_response(execution, correlation_result)

        # Give the background task a moment to register in active_executions
        await asyncio.sleep(0.1)

        # Should have created a new execution (may be PENDING due to human_task)
        ir_execs = [
            e
            for e in active_executions.values()
            if e.workflow_id == "incident-response"
            and e.input.get("triggered_by") == "exec-ir-source"
        ]
        assert len(ir_execs) >= 1

        # Cleanup: cancel any paused workflows and remove tasks
        for e in ir_execs:
            event = _resume_events.pop(e.execution_id, None)
            if event:
                e.status = WorkflowStatus.CANCELLED
                event.set()
            active_executions.pop(e.execution_id, None)

        # Remove any tasks created by the IR workflow
        task_ids_to_remove = [
            tid
            for tid, t in pending_tasks.items()
            if any(t.execution_id == e.execution_id for e in ir_execs)
        ]
        for tid in task_ids_to_remove:
            pending_tasks.pop(tid, None)

        await asyncio.sleep(0.1)  # Let cancelled tasks settle


# ---------------------------------------------------------------------------
# Default Workflow Definitions
# ---------------------------------------------------------------------------


class TestDefaultWorkflows:
    """Test default workflow definition structure."""

    def test_alert_processing_workflow_exists(self):
        from services.workflow_engine.main import DEFAULT_WORKFLOWS

        wf = DEFAULT_WORKFLOWS["alert-processing"]
        assert wf.workflow_id == "alert-processing"
        assert len(wf.steps) >= 5
        assert wf.timeout_seconds == 3600

    def test_incident_response_workflow_exists(self):
        from services.workflow_engine.main import DEFAULT_WORKFLOWS

        wf = DEFAULT_WORKFLOWS["incident-response"]
        assert wf.workflow_id == "incident-response"
        assert len(wf.steps) >= 4
        assert wf.timeout_seconds == 7200

    def test_alert_processing_has_all_step_types(self):
        from services.workflow_engine.main import DEFAULT_WORKFLOWS

        wf = DEFAULT_WORKFLOWS["alert-processing"]
        step_types = {s["type"] for s in wf.steps}
        assert "activity" in step_types
        assert "decision" in step_types
        assert "human_task" in step_types
        assert "automation" in step_types
        assert "notification" in step_types

    def test_all_steps_have_names(self):
        from services.workflow_engine.main import DEFAULT_WORKFLOWS

        for wf_id, wf in DEFAULT_WORKFLOWS.items():
            for step in wf.steps:
                assert "name" in step, f"Step missing name in workflow {wf_id}"
                assert "type" in step, f"Step missing type in workflow {wf_id}"


# ---------------------------------------------------------------------------
# Step Result Aggregation
# ---------------------------------------------------------------------------


class TestStepResultAggregation:
    """Test step result tracking."""

    def test_get_execution_step_results_empty(self):
        from services.workflow_engine.main import get_execution_step_results

        result = get_execution_step_results("nonexistent")
        assert result == {}

    def test_get_execution_step_results_populated(self):
        from services.workflow_engine.main import (
            execution_step_results,
            get_execution_step_results,
        )

        execution_step_results["exec-results-001"] = {
            "enrich": {"status": "completed"},
            "analyze": {"status": "completed"},
        }

        try:
            results = get_execution_step_results("exec-results-001")
            assert "enrich" in results
            assert "analyze" in results
        finally:
            execution_step_results.pop("exec-results-001", None)


# ---------------------------------------------------------------------------
# Error Classes
# ---------------------------------------------------------------------------


class TestErrorClasses:
    """Test custom error classes."""

    def test_workflow_error(self):
        from shared.errors import WorkflowError

        err = WorkflowError(
            "Test error",
            workflow_id="wf-001",
            execution_id="exec-001",
        )
        assert err.code == "WORKFLOW_ERROR"
        assert err.details["workflow_id"] == "wf-001"
        assert err.details["execution_id"] == "exec-001"

        d = err.to_dict()
        assert d["code"] == "WORKFLOW_ERROR"
        assert d["message"] == "Test error"

    def test_automation_error(self):
        from shared.errors import AutomationError

        err = AutomationError(
            "Playbook failed",
            playbook_id="pb-001",
            action_id="act-001",
        )
        assert err.code == "AUTOMATION_ERROR"
        assert err.details["playbook_id"] == "pb-001"
        assert err.details["action_id"] == "act-001"


# ---------------------------------------------------------------------------
# Helper to reset analyst pool state between tests
# ---------------------------------------------------------------------------


def _reset_analyst_pool():
    """Reset analyst pool to default state for test isolation."""
    from services.workflow_engine.main import ANALYST_POOL

    for analyst in ANALYST_POOL:
        analyst["active_tasks"] = 0
        analyst["available"] = True


# ---------------------------------------------------------------------------
# SLA Management
# ---------------------------------------------------------------------------


class TestSLAManagement:
    """Test SLA deadline calculation and breach detection."""

    def test_calculate_sla_deadline_critical(self):
        from services.workflow_engine.main import calculate_sla_deadline

        now = datetime(2026, 3, 15, 12, 0, 0)
        deadlines = calculate_sla_deadline("critical", now)

        assert deadlines["response_deadline"] == now + timedelta(minutes=15)
        assert deadlines["resolve_deadline"] == now + timedelta(minutes=60)

    def test_calculate_sla_deadline_low(self):
        from services.workflow_engine.main import calculate_sla_deadline

        now = datetime(2026, 3, 15, 12, 0, 0)
        deadlines = calculate_sla_deadline("low", now)

        assert deadlines["response_deadline"] == now + timedelta(minutes=120)
        assert deadlines["resolve_deadline"] == now + timedelta(minutes=1440)

    def test_calculate_sla_deadline_unknown_falls_back_to_medium(self):
        from services.workflow_engine.main import calculate_sla_deadline

        now = datetime(2026, 3, 15, 12, 0, 0)
        deadlines = calculate_sla_deadline("unknown_priority", now)

        # Should fall back to medium
        assert deadlines["response_deadline"] == now + timedelta(minutes=60)
        assert deadlines["resolve_deadline"] == now + timedelta(minutes=480)

    @pytest.mark.asyncio
    async def test_check_sla_breaches_detects_overdue(self):
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import check_sla_breaches, pending_tasks

        original_pub = wf_module.publisher
        wf_module.publisher = AsyncMock()

        # Create a task that was created 2 hours ago with critical priority
        # (critical response SLA = 15 min, so this is breached)
        old_time = datetime.utcnow() - timedelta(hours=2)
        task = HumanTask(
            task_id="task-sla-001",
            execution_id="exec-sla-001",
            task_type="review",
            title="Overdue task",
            description="This task is overdue",
            assigned_to="analyst-1",
            status=TaskStatus.ASSIGNED,
            priority=TaskPriority.CRITICAL,
            created_at=old_time,
        )
        pending_tasks["task-sla-001"] = task

        try:
            _reset_analyst_pool()
            breaches = await check_sla_breaches()
            assert len(breaches) >= 1
            breach = next(b for b in breaches if b["task_id"] == "task-sla-001")
            assert breach["breach_type"] in ("response", "resolve")
            assert breach["overdue_minutes"] > 0
        finally:
            pending_tasks.pop("task-sla-001", None)
            wf_module.publisher = original_pub

    @pytest.mark.asyncio
    async def test_check_sla_breaches_no_breach_for_recent_task(self):
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import check_sla_breaches, pending_tasks

        original_pub = wf_module.publisher
        wf_module.publisher = AsyncMock()

        # Create a task just now with low priority (SLA = 120 min response)
        task = HumanTask(
            task_id="task-sla-002",
            execution_id="exec-sla-002",
            task_type="review",
            title="Fresh task",
            description="Just created",
            assigned_to="analyst-1",
            status=TaskStatus.ASSIGNED,
            priority=TaskPriority.LOW,
        )
        pending_tasks["task-sla-002"] = task

        try:
            breaches = await check_sla_breaches()
            sla_breach = [b for b in breaches if b["task_id"] == "task-sla-002"]
            assert len(sla_breach) == 0
        finally:
            pending_tasks.pop("task-sla-002", None)
            wf_module.publisher = original_pub

    def test_sla_config_structure(self):
        from services.workflow_engine.main import SLA_CONFIG

        for priority in ("critical", "high", "medium", "low"):
            assert priority in SLA_CONFIG
            assert "response_minutes" in SLA_CONFIG[priority]
            assert "resolve_minutes" in SLA_CONFIG[priority]


# ---------------------------------------------------------------------------
# Smart Task Assignment
# ---------------------------------------------------------------------------


class TestSmartTaskAssignment:
    """Test skill-based and load-balanced task assignment."""

    def test_find_best_assignee_skill_match(self):
        from services.workflow_engine.main import _find_best_assignee

        _reset_analyst_pool()

        # analyst-1 and analyst-3 have malware skill
        assignee = _find_best_assignee("high", "malware")
        assert assignee in ("analyst-1", "analyst-3")

    def test_find_best_assignee_load_balance(self):
        from services.workflow_engine.main import ANALYST_POOL, _find_best_assignee

        _reset_analyst_pool()

        # Give analyst-1 some load
        ANALYST_POOL[0]["active_tasks"] = 3

        # Both analyst-1 and analyst-3 have malware skill, but analyst-3 has 0 tasks
        assignee = _find_best_assignee("medium", "malware")
        assert assignee == "analyst-3"

        _reset_analyst_pool()

    def test_find_best_assignee_exclude(self):
        from services.workflow_engine.main import _find_best_assignee

        _reset_analyst_pool()

        # Exclude analyst-1, should pick analyst-3 for malware
        assignee = _find_best_assignee("high", "malware", exclude="analyst-1")
        assert assignee == "analyst-3"
        _reset_analyst_pool()

    def test_find_best_assignee_no_candidates_returns_fallback(self):
        from services.workflow_engine.main import ANALYST_POOL, _find_best_assignee

        _reset_analyst_pool()

        # Make all analysts unavailable
        for a in ANALYST_POOL:
            a["available"] = False

        assignee = _find_best_assignee("medium", "malware")
        assert assignee == "security-team"

        _reset_analyst_pool()

    def test_find_best_assignee_increments_active_tasks(self):
        from services.workflow_engine.main import ANALYST_POOL, _find_best_assignee

        _reset_analyst_pool()

        assignee = _find_best_assignee("medium", "brute_force")
        # analyst-2 has brute_force skill
        assert assignee == "analyst-2"

        analyst = next(a for a in ANALYST_POOL if a["id"] == "analyst-2")
        assert analyst["active_tasks"] == 1

        _reset_analyst_pool()

    def test_release_analyst(self):
        from services.workflow_engine.main import ANALYST_POOL, _release_analyst

        _reset_analyst_pool()

        ANALYST_POOL[0]["active_tasks"] = 2
        _release_analyst("analyst-1")
        assert ANALYST_POOL[0]["active_tasks"] == 1

        _reset_analyst_pool()

    def test_release_analyst_does_not_go_negative(self):
        from services.workflow_engine.main import ANALYST_POOL, _release_analyst

        _reset_analyst_pool()

        _release_analyst("analyst-1")  # already at 0
        assert ANALYST_POOL[0]["active_tasks"] == 0

    @pytest.mark.asyncio
    async def test_human_task_uses_smart_assignment(self):
        """Human task step with 'security-team' assignee should use smart assignment."""
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import execute_workflow_step, pending_tasks

        original_pub = wf_module.publisher
        wf_module.publisher = AsyncMock()
        _reset_analyst_pool()

        try:
            execution = WorkflowExecution(
                execution_id="exec-smart-001",
                workflow_id="alert-processing",
                status=WorkflowStatus.RUNNING,
                input={
                    "alert_id": "SMART-001",
                    "alert_type": "malware",
                },
            )

            step = {
                "name": "review",
                "type": "human_task",
                "description": "Review alert",
                "assignee": "security-team",  # triggers smart assignment
                "priority": "high",
            }
            result = await execute_workflow_step(execution, step)

            assert result["status"] == "pending"
            # Should be assigned to an analyst, not security-team
            assert result["assigned_to"] in ("analyst-1", "analyst-3")

            # Verify SLA data is attached
            task = pending_tasks[result["task_id"]]
            assert "sla" in task.input_data
            assert "response_deadline" in task.input_data["sla"]

            pending_tasks.pop(result["task_id"], None)
        finally:
            wf_module.publisher = original_pub
            _reset_analyst_pool()


# ---------------------------------------------------------------------------
# Approval Workflow
# ---------------------------------------------------------------------------


class TestApprovalWorkflow:
    """Test approval workflow for high-risk automation."""

    def test_requires_approval_critical_malware(self):
        from services.workflow_engine.main import requires_approval

        assert requires_approval("malware-response", "CRITICAL") is True
        assert requires_approval("malware-response", "HIGH") is True

    def test_requires_approval_low_risk_no(self):
        from services.workflow_engine.main import requires_approval

        assert requires_approval("malware-response", "LOW") is False
        assert requires_approval("malware-response", "MEDIUM") is False

    def test_requires_approval_unknown_playbook_no(self):
        from services.workflow_engine.main import requires_approval

        assert requires_approval("phishing-response", "CRITICAL") is False

    @pytest.mark.asyncio
    async def test_request_approval_creates_entry(self):
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import (
            pending_approvals,
            request_approval,
        )

        original_pub = wf_module.publisher
        wf_module.publisher = AsyncMock()

        try:
            execution = WorkflowExecution(
                execution_id="exec-approval-001",
                workflow_id="alert-processing",
                status=WorkflowStatus.RUNNING,
                input={
                    "alert": {"alert_id": "APR-001", "alert_type": "malware"},
                    "risk_level": "CRITICAL",
                },
            )

            step = {"type": "automation", "playbook_selector": "by_alert_type"}
            approval = await request_approval(execution, "malware-response", step)

            assert approval["status"] == "pending"
            assert approval["playbook_id"] == "malware-response"
            assert approval["approval_id"] in pending_approvals

            # Cleanup
            pending_approvals.pop(approval["approval_id"], None)
        finally:
            wf_module.publisher = original_pub

    def test_process_approval_approve(self):
        from services.workflow_engine.main import (
            pending_approvals,
            process_approval,
        )

        pending_approvals["test-apr-001"] = {
            "approval_id": "test-apr-001",
            "playbook_id": "malware-response",
            "status": "pending",
            "execution_id": "exec-001",
        }

        try:
            result = process_approval("test-apr-001", True, "admin", "Looks safe")
            assert result["status"] == "approved"
            assert result["approved_by"] == "admin"
            assert result["reason"] == "Looks safe"
        finally:
            pending_approvals.pop("test-apr-001", None)

    def test_process_approval_reject(self):
        from services.workflow_engine.main import (
            pending_approvals,
            process_approval,
        )

        pending_approvals["test-apr-002"] = {
            "approval_id": "test-apr-002",
            "playbook_id": "malware-response",
            "status": "pending",
            "execution_id": "exec-002",
        }

        try:
            result = process_approval("test-apr-002", False, "admin", "Too risky")
            assert result["status"] == "rejected"
        finally:
            pending_approvals.pop("test-apr-002", None)

    def test_process_approval_not_found_raises(self):
        from shared.errors import WorkflowError

        from services.workflow_engine.main import process_approval

        with pytest.raises(WorkflowError, match="not found"):
            process_approval("nonexistent", True, "admin")

    def test_process_approval_already_processed_raises(self):
        from shared.errors import WorkflowError

        from services.workflow_engine.main import (
            pending_approvals,
            process_approval,
        )

        pending_approvals["test-apr-003"] = {
            "approval_id": "test-apr-003",
            "playbook_id": "malware-response",
            "status": "approved",
            "execution_id": "exec-003",
        }

        try:
            with pytest.raises(WorkflowError, match="already processed"):
                process_approval("test-apr-003", True, "admin")
        finally:
            pending_approvals.pop("test-apr-003", None)

    @pytest.mark.asyncio
    async def test_trigger_automation_requires_approval_for_critical(self):
        """High-risk automation with CRITICAL risk should return awaiting_approval."""
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import (
            pending_approvals,
            trigger_automation,
        )

        original_pub = wf_module.publisher
        wf_module.publisher = AsyncMock()

        try:
            execution = WorkflowExecution(
                execution_id="exec-apr-auto-001",
                workflow_id="alert-processing",
                status=WorkflowStatus.RUNNING,
                input={
                    "alert": {"alert_id": "APR-AUTO-001", "alert_type": "malware"},
                    "risk_level": "CRITICAL",
                },
            )

            step = {"type": "automation", "playbook_selector": "by_alert_type"}
            result = await trigger_automation(execution, step)

            assert result["status"] == "awaiting_approval"
            assert result["playbook_id"] == "malware-response"
            assert result["approval_id"] in pending_approvals

            # Cleanup
            pending_approvals.pop(result["approval_id"], None)
        finally:
            wf_module.publisher = original_pub

    @pytest.mark.asyncio
    async def test_trigger_automation_no_approval_for_low_risk(self):
        """Low-risk automation should trigger directly without approval."""
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import trigger_automation

        original_pub = wf_module.publisher
        wf_module.publisher = AsyncMock()

        try:
            execution = WorkflowExecution(
                execution_id="exec-apr-auto-002",
                workflow_id="alert-processing",
                status=WorkflowStatus.RUNNING,
                input={
                    "alert": {"alert_id": "APR-AUTO-002", "alert_type": "malware"},
                    "risk_level": "LOW",
                },
            )

            step = {"type": "automation", "playbook_selector": "by_alert_type"}
            result = await trigger_automation(execution, step)

            assert result["status"] == "triggered"
            assert result["playbook_id"] == "malware-response"
        finally:
            wf_module.publisher = original_pub


# ---------------------------------------------------------------------------
# Audit Logging
# ---------------------------------------------------------------------------


class TestAuditLogging:
    """Test audit logging functionality."""

    @pytest.mark.asyncio
    async def test_audit_log_without_db_does_not_raise(self):
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import audit_log

        original_db = wf_module.db_manager
        wf_module.db_manager = None

        try:
            # Should not raise even without database
            await audit_log(
                event_type="workflow.test",
                action="test",
                target_type="test",
                target_id="test-001",
            )
        finally:
            wf_module.db_manager = original_db

    @pytest.mark.asyncio
    async def test_audit_log_with_db_writes_entry(self):
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import audit_log

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)

        mock_db = MagicMock()
        mock_db.get_session = MagicMock(return_value=mock_session)

        original_db = wf_module.db_manager
        wf_module.db_manager = mock_db

        try:
            await audit_log(
                event_type="workflow.created",
                action="create",
                target_type="workflow",
                target_id="wf-001",
                details={"test": True},
            )
            mock_session.add.assert_called_once()
        finally:
            wf_module.db_manager = original_db


# ---------------------------------------------------------------------------
# Database Persistence
# ---------------------------------------------------------------------------


class TestDatabasePersistence:
    """Test database persistence helpers."""

    @pytest.mark.asyncio
    async def test_persist_workflow_definition_no_db(self):
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import persist_workflow_definition

        original_db = wf_module.db_manager
        wf_module.db_manager = None

        try:
            # Should not raise without database
            wf_def = WorkflowDefinition(
                workflow_id="test-persist",
                name="Test",
                description="Test workflow",
                version="1.0",
                steps=[],
            )
            await persist_workflow_definition(wf_def)
        finally:
            wf_module.db_manager = original_db

    @pytest.mark.asyncio
    async def test_persist_execution_no_db(self):
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import persist_execution

        original_db = wf_module.db_manager
        wf_module.db_manager = None

        try:
            execution = WorkflowExecution(
                execution_id="exec-persist-001",
                workflow_id="test",
                status=WorkflowStatus.RUNNING,
                input={},
            )
            await persist_execution(execution)
        finally:
            wf_module.db_manager = original_db

    @pytest.mark.asyncio
    async def test_load_workflow_definitions_no_db(self):
        import services.workflow_engine.main as wf_module
        from services.workflow_engine.main import load_workflow_definitions_from_db

        original_db = wf_module.db_manager
        wf_module.db_manager = None

        try:
            await load_workflow_definitions_from_db()
        finally:
            wf_module.db_manager = original_db


# ---------------------------------------------------------------------------
# Notification Templates
# ---------------------------------------------------------------------------


class TestNotificationTemplates:
    """Test new notification templates."""

    def test_sla_breach_template_exists(self):
        from services.workflow_engine.main import NOTIFICATION_TEMPLATES

        assert "sla_breach" in NOTIFICATION_TEMPLATES
        tmpl = NOTIFICATION_TEMPLATES["sla_breach"]
        assert "{task_id}" in tmpl
        assert "{breach_type}" in tmpl

    def test_approval_required_template_exists(self):
        from services.workflow_engine.main import NOTIFICATION_TEMPLATES

        assert "approval_required" in NOTIFICATION_TEMPLATES
        tmpl = NOTIFICATION_TEMPLATES["approval_required"]
        assert "{approval_id}" in tmpl
        assert "{playbook_id}" in tmpl

    def test_approval_decided_template_exists(self):
        from services.workflow_engine.main import NOTIFICATION_TEMPLATES

        assert "approval_decided" in NOTIFICATION_TEMPLATES


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------


class TestRequestModels:
    """Test Pydantic request models."""

    def test_workflow_update_request_partial(self):
        from services.workflow_engine.main import WorkflowUpdateRequest

        req = WorkflowUpdateRequest(name="Updated Name")
        assert req.name == "Updated Name"
        assert req.description is None
        assert req.steps is None

    def test_workflow_update_request_status_valid(self):
        from services.workflow_engine.main import WorkflowUpdateRequest

        req = WorkflowUpdateRequest(status="active")
        assert req.status == "active"

    def test_task_complete_request_defaults(self):
        from services.workflow_engine.main import TaskCompleteRequest

        req = TaskCompleteRequest()
        assert req.output_data is None
        assert req.notes is None

    def test_approval_request(self):
        from services.workflow_engine.main import ApprovalRequest

        req = ApprovalRequest(approved=True, approver="admin", reason="OK")
        assert req.approved is True
        assert req.approver == "admin"
