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

"""
Workflow repository for automation workflows and executions.
"""

from typing import Any, Dict, List, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database.models import Workflow, WorkflowExecution


class WorkflowRepository:
    """Repository for workflow and workflow execution management."""

    def __init__(self, session: AsyncSession):
        """
        Initialize repository.

        Args:
            session: Database session
        """
        self.session = session

    async def get_all_workflows(
        self, status: Optional[str] = None, category: Optional[str] = None
    ) -> List[Workflow]:
        """
        Get all workflows, optionally filtered by status or category.

        Args:
            status: Optional status filter
            category: Optional category filter

        Returns:
            List of Workflow objects
        """
        query = select(Workflow)

        if status:
            query = query.where(Workflow.status == status)
        if category:
            query = query.where(Workflow.category == category)

        query = query.order_by(Workflow.created_at.desc())

        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def get_workflow(self, workflow_id: str) -> Optional[Workflow]:
        """
        Get a single workflow by ID.

        Args:
            workflow_id: Workflow ID

        Returns:
            Workflow object or None
        """
        result = await self.session.execute(
            select(Workflow).where(Workflow.workflow_id == workflow_id)
        )
        return result.scalar_one_or_none()

    async def create_workflow(
        self,
        workflow_id: str,
        name: str,
        description: str,
        category: str,
        steps: List[Dict[str, Any]],
        trigger_type: str = "manual",
        trigger_conditions: Optional[Dict[str, Any]] = None,
        status: str = "draft",
        priority: str = "medium",
        created_by: str = "system",
    ) -> Workflow:
        """
        Create a new workflow.

        Args:
            workflow_id: Unique workflow ID
            name: Workflow name
            description: Workflow description
            category: Workflow category
            steps: List of workflow steps
            trigger_type: Trigger type
            trigger_conditions: Optional trigger conditions
            status: Initial status
            priority: Priority level
            created_by: Creator username

        Returns:
            Created Workflow object
        """
        workflow = Workflow(
            workflow_id=workflow_id,
            name=name,
            description=description,
            category=category,
            trigger_type=trigger_type,
            trigger_conditions=trigger_conditions,
            status=status,
            priority=priority,
            steps=steps,
            created_by=created_by,
        )
        self.session.add(workflow)
        await self.session.flush()
        return workflow

    async def update_workflow(
        self,
        workflow_id: str,
        **updates,
    ) -> Optional[Workflow]:
        """
        Update a workflow.

        Args:
            workflow_id: Workflow ID
            **updates: Fields to update

        Returns:
            Updated Workflow object or None
        """
        workflow = await self.get_workflow(workflow_id)
        if workflow:
            for key, value in updates.items():
                if hasattr(workflow, key):
                    setattr(workflow, key, value)
            await self.session.flush()
        return workflow

    async def delete_workflow(self, workflow_id: str) -> bool:
        """
        Delete a workflow.

        Args:
            workflow_id: Workflow ID

        Returns:
            True if deleted, False if not found
        """
        workflow = await self.get_workflow(workflow_id)
        if workflow:
            await self.session.delete(workflow)
            await self.session.flush()
            return True
        return False

    async def get_workflow_executions(
        self, workflow_id: str, limit: int = 10
    ) -> List[WorkflowExecution]:
        """
        Get recent executions for a workflow.

        Args:
            workflow_id: Workflow ID
            limit: Maximum number of executions to return

        Returns:
            List of WorkflowExecution objects
        """
        result = await self.session.execute(
            select(WorkflowExecution)
            .where(WorkflowExecution.workflow_id == workflow_id)
            .order_by(WorkflowExecution.started_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def create_workflow_execution(
        self,
        execution_id: str,
        workflow_id: str,
        trigger_type: str,
        trigger_reference: Optional[str] = None,
        executed_by: Optional[str] = None,
    ) -> WorkflowExecution:
        """
        Create a new workflow execution.

        Args:
            execution_id: Unique execution ID
            workflow_id: Workflow ID
            trigger_type: How the workflow was triggered
            trigger_reference: Optional reference (e.g., alert_id)
            executed_by: Optional username

        Returns:
            Created WorkflowExecution object
        """
        execution = WorkflowExecution(
            execution_id=execution_id,
            workflow_id=workflow_id,
            trigger_type=trigger_type,
            trigger_reference=trigger_reference,
            executed_by=executed_by,
        )
        self.session.add(execution)
        await self.session.flush()
        return execution

    async def update_workflow_execution(
        self,
        execution_id: str,
        **updates,
    ) -> Optional[WorkflowExecution]:
        """
        Update a workflow execution.

        Args:
            execution_id: Execution ID
            **updates: Fields to update

        Returns:
            Updated WorkflowExecution object or None
        """
        result = await self.session.execute(
            select(WorkflowExecution).where(
                WorkflowExecution.execution_id == execution_id
            )
        )
        execution = result.scalar_one_or_none()

        if execution:
            for key, value in updates.items():
                if hasattr(execution, key):
                    setattr(execution, key, value)
            await self.session.flush()
        return execution

    async def get_execution(self, execution_id: str) -> Optional[WorkflowExecution]:
        """
        Get a single workflow execution by ID.

        Args:
            execution_id: Execution ID

        Returns:
            WorkflowExecution object or None
        """
        result = await self.session.execute(
            select(WorkflowExecution).where(
                WorkflowExecution.execution_id == execution_id
            )
        )
        return result.scalar_one_or_none()
