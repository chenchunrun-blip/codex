#!/usr/bin/env python3
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
RabbitMQ Queue Creation Script

This script creates all required queues, exchanges, and bindings
for the Security Alert Triage System.
"""

import os
import sys
import asyncio
import pika
from pika import Channel
from pika.adapters.blocking_connection import BlockingChannel
from typing import Optional

# Queue configuration
QUEUE_CONFIG = {
    "alert.raw": {
        "durable": True,
        "arguments": {
            "x-max-length": 10000,  # Max 10k messages
            "x-message-ttl": 86400000,  # 24 hours TTL
        }
    },
    "alert.normalized": {
        "durable": True,
        "arguments": {
            "x-max-length": 10000,
            "x-message-ttl": 86400000,
        }
    },
    "alert.enriched": {
        "durable": True,
        "arguments": {
            "x-max-length": 10000,
            "x-message-ttl": 86400000,
        }
    },
    "alert.result": {
        "durable": True,
        "arguments": {
            "x-max-length": 10000,
            "x-message-ttl": 604800000,  # 7 days TTL (keep results longer)
        }
    },
    "workflow.tasks": {
        "durable": True,
        "arguments": {
            "x-max-length": 5000,
            "x-message-ttl": 43200000,  # 12 hours TTL
        }
    },
    "notification.pending": {
        "durable": True,
        "arguments": {
            "x-max-length": 5000,
            "x-message-ttl": 86400000,  # 24 hours TTL
        }
    },
}

# Exchange configuration
EXCHANGE_CONFIG = {
    "alerts": {
        "exchange_type": "topic",
        "durable": True,
    },
    "workflows": {
        "exchange_type": "direct",
        "durable": True,
    },
    "notifications": {
        "exchange_type": "fanout",
        "durable": True,
    },
}

# Binding configuration (queue -> exchange -> routing_key)
BINDING_CONFIG = {
    "alert.raw": ("alerts", "alert.raw"),
    "alert.normalized": ("alerts", "alert.normalized"),
    "alert.enriched": ("alerts", "alert.enriched"),
    "alert.result": ("alerts", "alert.result"),
    "workflow.tasks": ("workflows", "task.#"),
    "notification.pending": ("notifications", ""),
}


def get_rabbitmq_connection() -> BlockingConnection:
    """
    Create RabbitMQ connection using environment variables.

    Returns:
        BlockingChannel: RabbitMQ connection

    Raises:
        SystemExit: If connection fails
    """
    # Default credentials from docker-compose
    host = os.getenv("RABBITMQ_HOST", "localhost")
    port = int(os.getenv("RABBITMQ_PORT", "5672"))
    username = os.getenv("RABBITMQ_USER", "admin")
    password = os.getenv("RABBITMQ_PASSWORD", "rabbitmq_password_change_me")
    virtual_host = os.getenv("RABBITMQ_VHOST", "/")

    try:
        credentials = pika.PlainCredentials(username, password)
        parameters = pika.ConnectionParameters(
            host=host,
            port=port,
            virtual_host=virtual_host,
            credentials=credentials,
            heartbeat=600,
            blocked_connection_timeout=300,
        )
        connection = pika.BlockingConnection(parameters)
        return connection
    except Exception as e:
        print(f"❌ Failed to connect to RabbitMQ: {e}")
        print(f"\nConnection details:")
        print(f"  Host: {host}")
        print(f"  Port: {port}")
        print(f"  Username: {username}")
        print(f"  Virtual Host: {virtual_host}")
        print("\nPlease ensure:")
        print("  1. RabbitMQ is running: docker-compose up -d rabbitmq")
        print("  2. Environment variables are set correctly")
        sys.exit(1)


def create_exchanges(channel: Channel) -> None:
    """
    Create all exchanges.

    Args:
        channel: RabbitMQ channel
    """
    print("\n📨 Creating exchanges...")

    for exchange_name, config in EXCHANGE_CONFIG.items():
        try:
            channel.exchange_declare(
                exchange=exchange_name,
                exchange_type=config["exchange_type"],
                durable=config["durable"],
            )
            print(f"  ✓ Exchange created: {exchange_name}")
        except Exception as e:
            print(f"  ✗ Failed to create exchange {exchange_name}: {e}")


def create_queues(channel: Channel) -> None:
    """
    Create all queues.

    Args:
        channel: RabbitMQ channel
    """
    print("\n📬 Creating queues...")

    for queue_name, config in QUEUE_CONFIG.items():
        try:
            channel.queue_declare(
                queue=queue_name,
                durable=config["durable"],
                arguments=config.get("arguments"),
            )
            print(f"  ✓ Queue created: {queue_name}")
        except Exception as e:
            print(f"  ✗ Failed to create queue {queue_name}: {e}")


def create_bindings(channel: Channel) -> None:
    """
    Create all queue-exchange bindings.

    Args:
        channel: RabbitMQ channel
    """
    print("\n🔗 Creating bindings...")

    for queue_name, (exchange_name, routing_key) in BINDING_CONFIG.items():
        try:
            channel.queue_bind(
                queue=queue_name,
                exchange=exchange_name,
                routing_key=routing_key,
            )
            print(f"  ✓ Binding created: {queue_name} -> {exchange_name} ({routing_key})")
        except Exception as e:
            print(f"  ✗ Failed to create binding {queue_name}: {e}")


def create_dead_letter_queues(channel: Channel) -> None:
    """
    Create dead letter queues for failed messages.

    Args:
        channel: RabbitMQ channel
    """
    print("\n💀 Creating dead letter queues...")

    dlq_config = {
        "alert.raw.dlq": {"durable": True},
        "alert.normalized.dlq": {"durable": True},
        "alert.enriched.dlq": {"durable": True},
        "alert.result.dlq": {"durable": True},
    }

    for queue_name, config in dlq_config.items():
        try:
            channel.queue_declare(
                queue=queue_name,
                durable=config["durable"],
            )
            print(f"  ✓ DLQ created: {queue_name}")
        except Exception as e:
            print(f"  ✗ Failed to create DLQ {queue_name}: {e}")


def verify_setup(channel: Channel) -> None:
    """
    Verify that all queues and exchanges were created.

    Args:
        channel: RabbitMQ channel
    """
    print("\n🔍 Verifying setup...")

    # Check queues
    try:
        queues = channel.queue_declare(queue="", passive=True)
        print(f"  ✓ RabbitMQ is responsive")
    except Exception as e:
        print(f"  ✗ RabbitMQ verification failed: {e}")


def main():
    """Main execution function."""
    print("=" * 70)
    print("🚀 Security Triage System - RabbitMQ Queue Setup")
    print("=" * 70)

    # Connect to RabbitMQ
    print("\n🔌 Connecting to RabbitMQ...")
    connection = get_rabbitmq_connection()
    channel = connection.channel()

    try:
        # Create exchanges
        create_exchanges(channel)

        # Create queues
        create_queues(channel)

        # Create dead letter queues
        create_dead_letter_queues(channel)

        # Create bindings
        create_bindings(channel)

        # Verify setup
        verify_setup(channel)

        print("\n" + "=" * 70)
        print("✅ RabbitMQ setup completed successfully!")
        print("=" * 70)
        print("\n📊 Summary:")
        print(f"  - Exchanges: {len(EXCHANGE_CONFIG)}")
        print(f"  - Queues: {len(QUEUE_CONFIG)}")
        print(f"  - Bindings: {len(BINDING_CONFIG)}")
        print(f"  - Dead Letter Queues: 4")
        print("\n💡 Next steps:")
        print("  1. Start consuming messages from queues")
        print("  2. Monitor queues using RabbitMQ Management UI: http://localhost:15672")
        print("  3. Check queue depths and message rates")

    except Exception as e:
        print(f"\n❌ Setup failed: {e}")
        sys.exit(1)

    finally:
        # Close connection
        channel.close()
        connection.close()
        print("\n👋 Connection closed")


if __name__ == "__main__":
    main()
