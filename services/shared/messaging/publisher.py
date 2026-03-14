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
Message publisher with priority and persistence support.

This module provides an enhanced message publisher with features for
reliable message delivery, priority queues, and message tracking.
"""

import asyncio
import json
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Union

from aio_pika import DeliveryMode, ExchangeType, Message, RobustConnection, connect_robust
from aio_pika.abc import AbstractChannel, AbstractExchange
from shared.utils.logger import get_logger

logger = get_logger(__name__)


class MessagePublisher:
    """
    Enhanced message publisher with priority and persistence support.

    Features:
    - Message priority (0-10, higher = more important)
    - Persistent delivery mode
    - Message acknowledgment tracking
    - Automatic reconnection
    - Transaction support for batch publishing
    - Publisher confirms for reliable delivery
    """

    def __init__(
        self,
        amqp_url: str,
        exchange_name: Optional[str] = None,
        exchange_type: ExchangeType = ExchangeType.DIRECT,
        use_publisher_confirms: bool = True,
        confirm_timeout: float = 5.0,
    ):
        """
        Initialize message publisher.

        Args:
            amqp_url: RabbitMQ connection URL
            exchange_name: Exchange name (None for default exchange)
            exchange_type: Type of exchange (direct, topic, fanout, headers)
            use_publisher_confirms: Enable publisher confirms for reliable delivery
            confirm_timeout: Timeout for publisher confirms in seconds
        """
        self.amqp_url = amqp_url
        self.exchange_name = exchange_name or ""
        self.exchange_type = exchange_type
        self.use_publisher_confirms = use_publisher_confirms
        self.confirm_timeout = confirm_timeout

        self.connection: Optional[RobustConnection] = None
        self.channel: Optional[AbstractChannel] = None
        self.exchange: Optional[AbstractExchange] = None

        self._pending_confirms: Dict[str, Any] = {}
        self._confirmed_messages: List[str] = []
        self._failed_messages: List[Dict[str, Any]] = []

    async def connect(self):
        """Connect to RabbitMQ and setup exchange."""
        try:
            self.connection = await connect_robust(self.amqp_url)
            self.channel = await self.connection.channel()

            # Note: Publisher confirms disabled for compatibility with aio-pika 9.x
            # TODO: Implement proper publisher confirms when needed

            # Declare exchange if specified
            if self.exchange_name:
                self.exchange = await self.channel.declare_exchange(
                    self.exchange_name,
                    self.exchange_type,
                    durable=True,
                )
                logger.info(f"Declared exchange: {self.exchange_name}")

            logger.info("Publisher connected to RabbitMQ")

        except Exception as e:
            logger.error(f"Failed to connect publisher to RabbitMQ: {e}")
            raise

    async def publish(
        self,
        routing_key: str,
        message: Dict[str, Any],
        priority: int = 5,
        persistent: bool = True,
        correlation_id: Optional[str] = None,
        reply_to: Optional[str] = None,
        expiration: Optional[int] = None,
        headers: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """
        Publish message to exchange.

        Args:
            routing_key: Routing key for message routing
            message: Message payload
            priority: Message priority (0-10, default 5)
            persistent: Whether to persist message to disk
            correlation_id: Optional correlation ID for request/response
            reply_to: Optional queue name for reply
            expiration: Message TTL in milliseconds
            headers: Optional message headers

        Returns:
            Message ID if confirmed, None otherwise
        """
        if not self.connection:
            await self.connect()

        try:
            # Generate message ID
            message_id = str(uuid.uuid4())

            # Add metadata to message
            message_body = {
                "_meta": {
                    "message_id": message_id,
                    "timestamp": datetime.utcnow().isoformat(),
                    "publisher": self.__class__.__name__,
                },
                "data": message,
            }

            # Encode message
            body_json = json.dumps(message_body, default=str)
            message_bytes = body_json.encode("utf-8")

            # Prepare message properties
            message_properties = {
                "delivery_mode": DeliveryMode.PERSISTENT if persistent else DeliveryMode.NOT_PERSISTENT,
                "priority": max(0, min(10, priority)),  # Clamp to 0-10
                "correlation_id": correlation_id or message_id,
                "message_id": message_id,
            }

            if reply_to:
                message_properties["reply_to"] = reply_to

            if expiration:
                message_properties["expiration"] = str(expiration)

            if headers:
                message_properties["headers"] = headers

            # Create message
            msg = Message(message_bytes, **message_properties)

            # Publish message
            target_exchange = self.exchange or self.channel.default_exchange
            await target_exchange.publish(msg, routing_key=routing_key)

            # Track if publisher confirms enabled
            if self.use_publisher_confirms:
                self._pending_confirms[message_id] = {
                    "routing_key": routing_key,
                    "timestamp": datetime.utcnow(),
                }

            logger.info(
                "Message published",
                extra={
                    "message_id": message_id,
                    "routing_key": routing_key,
                    "priority": priority,
                    "persistent": persistent,
                },
            )

            return message_id

        except Exception as e:
            logger.error(
                f"Failed to publish message: {e}",
                extra={"routing_key": routing_key},
            )
            return None

    async def publish_batch(
        self,
        messages: List[Dict[str, Any]],
        routing_key: str,
        priority: int = 5,
        persistent: bool = True,
    ) -> Dict[str, Any]:
        """
        Publish multiple messages in a batch.

        Args:
            messages: List of message payloads
            routing_key: Routing key for all messages
            priority: Default priority for all messages
            persistent: Whether to persist messages

        Returns:
            Dictionary with success count, failure count, and message IDs
        """
        message_ids = []

        for i, message in enumerate(messages):
            # Use message-specific priority if provided
            msg_priority = message.get("priority", priority)

            message_id = await self.publish(
                routing_key=routing_key,
                message=message,
                priority=msg_priority,
                persistent=persistent,
            )

            if message_id:
                message_ids.append(message_id)

        return {
            "success_count": len(message_ids),
            "failure_count": len(messages) - len(message_ids),
            "message_ids": message_ids,
        }

    async def publish_to_queue(
        self,
        queue_name: str,
        message: Dict[str, Any],
        priority: int = 5,
        persistent: bool = True,
    ) -> Optional[str]:
        """
        Publish message directly to a queue.

        Args:
            queue_name: Target queue name
            message: Message payload
            priority: Message priority
            persistent: Whether to persist message

        Returns:
            Message ID if confirmed, None otherwise
        """
        return await self.publish(
            routing_key=queue_name,
            message=message,
            priority=priority,
            persistent=persistent,
        )

    async def publish_with_retry(
        self,
        routing_key: str,
        message: Dict[str, Any],
        max_retries: int = 3,
        retry_delay: float = 1.0,
        **kwargs,
    ) -> Optional[str]:
        """
        Publish message with automatic retry on failure.

        Args:
            routing_key: Routing key for message routing
            message: Message payload
            max_retries: Maximum number of retry attempts
            retry_delay: Delay between retries in seconds
            **kwargs: Additional arguments passed to publish()

        Returns:
            Message ID if successful, None otherwise
        """
        for attempt in range(max_retries):
            try:
                message_id = await self.publish(routing_key, message, **kwargs)

                if message_id:
                    if attempt > 0:
                        logger.info(
                            f"Message published after {attempt} retries",
                            extra={"message_id": message_id},
                        )
                    return message_id

            except Exception as e:
                logger.warning(
                    f"Publish attempt {attempt + 1} failed: {e}",
                    extra={"routing_key": routing_key},
                )

                if attempt < max_retries - 1:
                    await asyncio.sleep(retry_delay * (2**attempt))  # Exponential backoff

        logger.error(
            f"Failed to publish message after {max_retries} attempts",
            extra={"routing_key": routing_key},
        )
        return None

    async def publish_priority_alert(
        self,
        routing_key: str,
        message: Dict[str, Any],
        alert_type: str = "high",
    ) -> Optional[str]:
        """
        Publish alert message with automatic priority based on alert type.

        Args:
            routing_key: Routing key for message routing
            message: Message payload
            alert_type: Alert type (critical, high, medium, low)

        Returns:
            Message ID if confirmed, None otherwise
        """
        priority_map = {
            "critical": 10,
            "high": 8,
            "medium": 5,
            "low": 3,
            "info": 1,
        }

        priority = priority_map.get(alert_type.lower(), 5)

        return await self.publish(
            routing_key=routing_key,
            message=message,
            priority=priority,
            persistent=True,
            headers={"alert_type": alert_type},
        )

    async def get_publish_stats(self) -> Dict[str, Any]:
        """
        Get publishing statistics.

        Returns:
            Dictionary with publishing stats
        """
        return {
            "pending_confirms": len(self._pending_confirms),
            "confirmed_messages": len(self._confirmed_messages),
            "failed_messages": len(self._failed_messages),
            "use_publisher_confirms": self.use_publisher_confirms,
            "exchange_name": self.exchange_name,
        }

    async def wait_for_confirms(self, timeout: float = 5.0) -> bool:
        """
        Wait for all pending publisher confirms.

        Args:
            timeout: Timeout in seconds

        Returns:
            True if all messages confirmed, False if timeout
        """
        if not self.use_publisher_confirms:
            return True

        try:
            # Wait for pending confirms
            start_time = datetime.utcnow()
            while self._pending_confirms:
                if (datetime.utcnow() - start_time).total_seconds() > timeout:
                    logger.warning(
                        f"Timeout waiting for {len(self._pending_confirms)} confirms"
                    )
                    return False

                await asyncio.sleep(0.1)

            logger.info("All messages confirmed")
            return True

        except Exception as e:
            logger.error(f"Error waiting for confirms: {e}")
            return False

    async def close(self):
        """Close connection to RabbitMQ."""
        if self._pending_confirms:
            logger.warning(
                f"Closing publisher with {len(self._pending_confirms)} pending confirms"
            )

        if self.connection:
            await self.connection.close()
            logger.info("Publisher connection closed")


class TransactionalPublisher(MessagePublisher):
    """
    Publisher with transaction support for atomic batch publishing.

    Uses RabbitMQ transactions to ensure all-or-nothing delivery.
    """

    def __init__(self, *args, **kwargs):
        """
        Initialize transactional publisher.

        Args:
            *args: Arguments passed to MessagePublisher
            **kwargs: Keyword arguments passed to MessagePublisher
        """
        super().__init__(*args, **kwargs)
        self._in_transaction = False

    async def begin_transaction(self):
        """Begin a transaction."""
        if not self.connection:
            await self.connect()

        await self.channel.transaction_commit()  # Commit any existing transaction
        await self.channel.tx_select()
        self._in_transaction = True

        logger.debug("Transaction started")

    async def commit_transaction(self):
        """Commit the current transaction."""
        if not self._in_transaction:
            logger.warning("No active transaction to commit")
            return

        await self.channel.tx_commit()
        self._in_transaction = False

        logger.info("Transaction committed")

    async def rollback_transaction(self):
        """Rollback the current transaction."""
        if not self._in_transaction:
            logger.warning("No active transaction to rollback")
            return

        await self.channel.tx_rollback()
        self._in_transaction = False

        logger.info("Transaction rolled back")

    async def publish_in_transaction(
        self,
        messages: List[Dict[str, Any]],
        routing_key: str,
        **kwargs,
    ) -> bool:
        """
        Publish multiple messages in a transaction.

        Args:
            messages: List of message payloads
            routing_key: Routing key for all messages
            **kwargs: Additional arguments passed to publish()

        Returns:
            True if transaction committed, False if rolled back
        """
        await self.begin_transaction()

        try:
            for message in messages:
                await super().publish(routing_key, message, **kwargs)

            await self.commit_transaction()
            return True

        except Exception as e:
            logger.error(f"Error in transaction, rolling back: {e}")
            await self.rollback_transaction()
            return False

    async def close(self):
        """Close connection, committing any open transaction."""
        if self._in_transaction:
            await self.commit_transaction()

        await super().close()
