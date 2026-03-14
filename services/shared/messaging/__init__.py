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
Shared messaging layer for RabbitMQ integration.

Provides enhanced message publishing and consuming utilities with:
- Retry logic and exponential backoff
- Dead letter queue support
- Priority queues
- Publisher confirms
- Transaction support
"""

from .consumer import BatchConsumer, MessageConsumer
from .publisher import MessagePublisher, TransactionalPublisher

# Queue definitions for the security triage system
QUEUES = {
    "alert.raw": {
        "type": "direct",
        "durable": True,
        "priority": True,
        "dlq": "alert.raw.dlq",
    },
    "alert.normalized": {
        "type": "direct",
        "durable": True,
        "priority": True,
        "dlq": "alert.normalized.dlq",
    },
    "alert.enriched": {
        "type": "direct",
        "durable": True,
        "priority": True,
        "dlq": "alert.enriched.dlq",
    },
    "alert.contextualized": {
        "type": "direct",
        "durable": True,
        "priority": True,
        "dlq": "alert.contextualized.dlq",
    },
    "alert.result": {
        "type": "direct",
        "durable": True,
        "priority": True,
        "dlq": "alert.result.dlq",
    },
    "notifications": {
        "type": "fanout",
        "durable": True,
    },
}

# Exchange definitions
EXCHANGES = {
    "alerts": {
        "type": "topic",
        "durable": True,
    },
    "workflows": {
        "type": "direct",
        "durable": True,
    },
    "notifications": {
        "type": "fanout",
        "durable": True,
    },
}

__all__ = [
    # Consumer classes
    "MessageConsumer",
    "BatchConsumer",
    # Publisher classes
    "MessagePublisher",
    "TransactionalPublisher",
    # Configuration
    "QUEUES",
    "EXCHANGES",
]

# Alias for backwards compatibility
QUEUE_DEFINITIONS = QUEUES
