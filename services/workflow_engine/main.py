# Copyright 2026 CCR <chenchunrun@gmail.com>
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Workflow Engine Service - Manages workflow definitions and executions."""

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from shared.database import DatabaseManager, get_database_manager
from shared.errors import WorkflowError
from shared.messaging import MessageConsumer, MessagePublisher
from shared.models import (
    HumanTask,
    ResponseMeta,
    SuccessResponse,
    TaskPriority,
    TaskStatus,
    WorkflowDefinition,
    WorkflowExecution,
    WorkflowStatus,
)
from shared.utils import Config, get_logger

logger = get_logger(__name__)
config = Config()

db_manager: DatabaseManager = None
publisher: MessagePublisher = None
consumer: MessageConsumer = None

# In-memory workflow execution storage (use database in production)
active_executions: Dict[str, WorkflowExecution] = {}
workflow_definitions: Dict[str, WorkflowDefinition] = {}

# Load default workflow definitions
DEFAULT_WORKFLOWS = {
    "alert-processing": WorkflowDefinition(
        workflow_id="alert-processing",
        name="Alert Processing Workflow",
        description="Standard workflow for processing security alerts",
        version="1.0.0",
        steps=[
            {
                "name": "enrich",
                "type": "activity",
                "description": "Enrich alert with context",
                "service": "context_collector",
            },
            {
                "name": "analyze",
                "type": "activity",
                "description": "AI triage analysis",
                "service": "ai_triage_agent",
            },
            {
                "name": "auto_response",
                "type": "decision",
                "description": "Check if auto-response is needed",
                "condition": "${risk_level == 'CRITICAL' or risk_level == 'HIGH'}",
            },
            {
                "name": "human_review",
                "type": "human_task",
                "description": "Security analyst review",
                "assignee": "security-team",
            },
        ],
        timeout_seconds=3600,
    ),
    "incident-response": WorkflowDefinition(
        workflow_id="incident-response",
        name="Incident Response Workflow",
        description="Workflow for handling security incidents",
        version="1.0.0",
        steps=[
            {"name": "assess", "type": "activity", "description": "Initial incident assessment"},
            {"name": "contain", "type": "activity", "description": "Contain the threat"},
            {"name": "eradicate", "type": "activity", "description": "Eradicate threat"},
            {"name": "recover", "type": "activity", "description": "Recover systems"},
        ],
        timeout_seconds=7200,
    ),
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan."""
    global db_manager, publisher, consumer, workflow_definitions

    logger.info("Starting Workflow Engine service...")

    # Initialize database
    db_manager = get_database_manager()
    await db_manager.initialize()

    # Initialize messaging
    publisher = MessagePublisher(config.rabbitmq_url)
    await publisher.connect()

    consumer = MessageConsumer(config.rabbitmq_url, "workflow.trigger")
    await consumer.connect()

    # Load workflow definitions
    workflow_definitions.update(DEFAULT_WORKFLOWS)

    # Start consuming workflow triggers
    asyncio.create_task(consume_workflow_triggers())

    # Start background task to monitor active executions
    asyncio.create_task(monitor_executions())

    logger.info("Workflow Engine service started successfully")

    yield

    # Cleanup
    await consumer.close()
    await publisher.close()
    await db_manager.close()
    logger.info("Workflow Engine service stopped")


app = FastAPI(
    title="Workflow Engine Service",
    description="Manages workflow definitions and executions",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def execute_workflow_step(
    execution: WorkflowExecution, step: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Execute a single workflow step.

    Supports:
    - activity: Service call
    - human_task: Create human task
    - decision: Conditional branching
    """
    step_type = step.get("type")
    step_name = step.get("name")

    logger.info(f"Executing step {step_name} (type: {step_type})")

    try:
        if step_type == "activity":
            # Execute service activity
            service = step.get("service")
            if service:
                # Publish message to service
                await publisher.publish(
                    f"workflow.{service}",
                    {
                        "message_id": str(uuid.uuid4()),
                        "message_type": "workflow.activity",
                        "payload": {
                            "execution_id": execution.execution_id,
                            "step": step_name,
                            "input": execution.input,
                        },
                        "timestamp": datetime.utcnow().isoformat(),
                    },
                )
                return {"status": "completed", "output": {}}

        elif step_type == "human_task":
            # Create human task
            task = HumanTask(
                task_id=f"task-{uuid.uuid4()}",
                execution_id=execution.execution_id,
                task_type=step.get("task_type", "manual_review"),
                title=step.get("title", f"Complete task: {step_name}"),
                description=step.get("description", ""),
                assigned_to=step.get("assignee", "security-team"),
                status=TaskStatus.ASSIGNED,
                priority=TaskPriority.MEDIUM,
                input_data=execution.input.copy(),
            )

            # TODO: Save task to database
            # TODO: Send notification to assignee

            return {
                "status": "pending",
                "task_id": task.task_id,
                "message": "Human task created, awaiting completion",
            }

        elif step_type == "decision":
            # Evaluate condition
            condition = step.get("condition", "")
            # Simple condition evaluation (use proper expression parser in production)
            if "risk_level" in execution.input:
                risk_level = execution.input.get("risk_level", "").upper()
                if risk_level in ["CRITICAL", "HIGH"]:
                    return {"status": "continue", "decision": True}
                else:
                    return {"status": "skip", "decision": False}

        return {"status": "completed"}

    except Exception as e:
        logger.error(f"Step execution failed: {e}", exc_info=True)
        return {"status": "failed", "error": str(e)}


async def execute_workflow(execution: WorkflowExecution):
    """
    Execute workflow steps sequentially.

    Args:
        execution: Workflow execution instance
    """
    try:
        workflow_def = workflow_definitions.get(execution.workflow_id)
        if not workflow_def:
            raise WorkflowError(f"Workflow definition not found: {execution.workflow_id}")

        execution.status = WorkflowStatus.RUNNING
        active_executions[execution.execution_id] = execution

        # Execute each step
        for i, step in enumerate(workflow_def.steps):
            execution.current_step = step.get("name")
            execution.progress = i / len(workflow_def.steps)

            result = await execute_workflow_step(execution, step)

            if result.get("status") == "failed":
                execution.status = WorkflowStatus.FAILED
                execution.error = result.get("error", "Step execution failed")
                execution.completed_at = datetime.utcnow()
                break

            elif result.get("status") == "pending":
                # Waiting for human task or external action
                execution.status = WorkflowStatus.PENDING
                # TODO: Resume when task is completed
                break

        # If all steps completed
        if execution.status == WorkflowStatus.RUNNING:
            execution.status = WorkflowStatus.COMPLETED
            execution.completed_at = datetime.utcnow()
            execution.progress = 1.0
            execution.output = {"message": "Workflow completed successfully"}

        # Publish completion event
        await publisher.publish(
            "workflow.completed",
            {
                "message_id": str(uuid.uuid4()),
                "message_type": "workflow.completed",
                "payload": execution.model_dump(),
                "timestamp": datetime.utcnow().isoformat(),
            },
        )

        logger.info(
            f"Workflow execution {execution.execution_id} completed: {execution.status.value}"
        )

    except Exception as e:
        logger.error(f"Workflow execution failed: {e}", exc_info=True)
        execution.status = WorkflowStatus.FAILED
        execution.error = str(e)
        execution.completed_at = datetime.utcnow()


async def consume_workflow_triggers():
    """Consume workflow trigger messages from queue."""

    async def process_message(message: dict):
        try:
            payload = message["payload"]
            workflow_id = payload.get("workflow_id")
            input_data = payload.get("input", {})

            if not workflow_id:
                logger.error("Missing workflow_id in trigger message")
                return

            # Start workflow execution
            execution = start_workflow_execution(workflow_id, input_data)
            logger.info(f"Started workflow execution {execution.execution_id}")

        except Exception as e:
            logger.error(f"Failed to process workflow trigger: {e}", exc_info=True)

    await consumer.consume(process_message)


def start_workflow_execution(workflow_id: str, input_data: Dict[str, Any]) -> WorkflowExecution:
    """
    Start a new workflow execution.

    Args:
        workflow_id: Workflow definition ID
        input_data: Input parameters for workflow

    Returns:
        WorkflowExecution instance
    """
    execution = WorkflowExecution(
        execution_id=f"exec-{uuid.uuid4()}",
        workflow_id=workflow_id,
        status=WorkflowStatus.PENDING,
        input=input_data,
        started_at=datetime.utcnow(),
    )

    # Start execution in background
    asyncio.create_task(execute_workflow(execution))

    return execution


async def monitor_executions():
    """Monitor active workflow executions for timeouts."""
    while True:
        try:
            await asyncio.sleep(60)  # Check every minute

            current_time = datetime.utcnow()
            timed_out = []

            for exec_id, execution in active_executions.items():
                # Check if execution has timed out
                workflow_def = workflow_definitions.get(execution.workflow_id)
                if not workflow_def:
                    continue

                timeout = timedelta(seconds=workflow_def.timeout_seconds)
                if current_time - execution.started_at > timeout:
                    execution.status = WorkflowStatus.TIMED_OUT
                    execution.error = "Workflow execution timed out"
                    execution.completed_at = current_time
                    timed_out.append(exec_id)

                    logger.warning(f"Workflow execution {exec_id} timed out")

            # Clean up timed out executions
            for exec_id in timed_out:
                del active_executions[exec_id]

        except Exception as e:
            logger.error(f"Error monitoring executions: {e}", exc_info=True)


# API Endpoints


@app.post("/api/v1/workflows/definitions", response_model=Dict[str, Any])
async def create_workflow_definition(definition: WorkflowDefinition):
    """Create a new workflow definition."""
    try:
        workflow_definitions[definition.workflow_id] = definition

        # TODO: Save to database

        return {
            "success": True,
            "data": definition.model_dump(),
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except Exception as e:
        logger.error(f"Failed to create workflow definition: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Failed to create workflow definition: {str(e)}"
        )


@app.get("/api/v1/workflows/definitions", response_model=Dict[str, Any])
async def list_workflow_definitions():
    """List all workflow definitions."""
    return {
        "success": True,
        "data": {
            "workflows": [wf.model_dump() for wf in workflow_definitions.values()],
            "total": len(workflow_definitions),
        },
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/workflows/definitions/{workflow_id}", response_model=Dict[str, Any])
async def get_workflow_definition(workflow_id: str):
    """Get a specific workflow definition."""
    workflow = workflow_definitions.get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow definition not found: {workflow_id}")

    return {
        "success": True,
        "data": workflow.model_dump(),
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.post("/api/v1/workflows/execute", response_model=Dict[str, Any])
async def execute_workflow_api(
    workflow_id: str, input_data: Dict[str, Any], background_tasks: BackgroundTasks
):
    """
    Start workflow execution via API.

    Args:
        workflow_id: Workflow definition ID
        input_data: Input parameters for workflow
    """
    try:
        # Check if workflow exists
        if workflow_id not in workflow_definitions:
            raise HTTPException(
                status_code=404, detail=f"Workflow definition not found: {workflow_id}"
            )

        # Start execution
        execution = start_workflow_execution(workflow_id, input_data)

        return {
            "success": True,
            "data": {
                "execution_id": execution.execution_id,
                "workflow_id": execution.workflow_id,
                "status": execution.status.value,
                "started_at": execution.started_at.isoformat(),
            },
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start workflow execution: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to start workflow execution: {str(e)}")


@app.get("/api/v1/workflows/executions", response_model=Dict[str, Any])
async def list_executions(
    status: Optional[WorkflowStatus] = None, workflow_id: Optional[str] = None
):
    """List workflow executions, optionally filtered by status or workflow."""
    executions = list(active_executions.values())

    if status:
        executions = [e for e in executions if e.status == status]

    if workflow_id:
        executions = [e for e in executions if e.workflow_id == workflow_id]

    return {
        "success": True,
        "data": {"executions": [e.model_dump() for e in executions], "total": len(executions)},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/workflows/executions/{execution_id}", response_model=Dict[str, Any])
async def get_execution(execution_id: str):
    """Get a specific workflow execution."""
    execution = active_executions.get(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail=f"Execution not found: {execution_id}")

    return {
        "success": True,
        "data": execution.model_dump(),
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.post("/api/v1/workflows/executions/{execution_id}/cancel", response_model=Dict[str, Any])
async def cancel_execution(execution_id: str):
    """Cancel a running workflow execution."""
    execution = active_executions.get(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail=f"Execution not found: {execution_id}")

    if execution.status not in [WorkflowStatus.PENDING, WorkflowStatus.RUNNING]:
        raise HTTPException(
            status_code=400, detail=f"Cannot cancel execution in status: {execution.status.value}"
        )

    execution.status = WorkflowStatus.CANCELLED
    execution.completed_at = datetime.utcnow()

    return {
        "success": True,
        "message": "Execution cancelled",
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "workflow-engine",
        "timestamp": datetime.utcnow().isoformat(),
        "workflows": {
            "definitions": len(workflow_definitions),
            "active_executions": len(active_executions),
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.host, port=config.port)
