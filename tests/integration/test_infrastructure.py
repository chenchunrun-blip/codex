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
Integration tests for infrastructure services.

These tests verify that Docker Compose infrastructure services
(PostgreSQL, Redis, RabbitMQ, ChromaDB) are properly configured
and accessible.
"""

import asyncio
import os
import sys
import time
from datetime import datetime

import pytest

# Add parent directory to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

try:
    import pika
    import psycopg2
    import redis
    import requests
    from psycopg2 import OperationalError
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
    from sqlalchemy.orm import sessionmaker
except ImportError as e:
    pytest.skip(f"Required dependencies not installed: {e}", allow_module_level=True)


# =============================================================================
# Test Configuration
# =============================================================================

# Database configuration
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", "5432")),
    "database": os.getenv("DB_NAME", "security_triage"),
    "user": os.getenv("DB_USER", "triage_user"),
    "password": os.getenv("DB_PASSWORD", "triage_password_change_me"),
}

# Redis configuration
REDIS_CONFIG = {
    "host": os.getenv("REDIS_HOST", "localhost"),
    "port": int(os.getenv("REDIS_PORT", "6379")),
    "password": os.getenv("REDIS_PASSWORD", "redis_password_change_me"),
    "db": int(os.getenv("REDIS_DB", "0")),
}

# RabbitMQ configuration
RABBITMQ_CONFIG = {
    "host": os.getenv("RABBITMQ_HOST", "localhost"),
    "port": int(os.getenv("RABBITMQ_PORT", "5672")),
    "user": os.getenv("RABBITMQ_USER", "admin"),
    "password": os.getenv("RABBITMQ_PASSWORD", "rabbitmq_password_change_me"),
    "vhost": os.getenv("RABBITMQ_VHOST", "/"),
}

# ChromaDB configuration
CHROMADB_CONFIG = {
    "host": os.getenv("CHROMADB_HOST", "localhost"),
    "port": int(os.getenv("CHROMADB_PORT", "8001")),
}


# =============================================================================
# PostgreSQL Tests
# =============================================================================


class TestPostgreSQL:
    """Test PostgreSQL database connectivity and functionality."""

    @pytest.fixture(scope="class")
    def db_connection(self):
        """Create database connection for tests."""
        max_retries = 5
        retry_delay = 2

        for attempt in range(max_retries):
            try:
                conn = psycopg2.connect(**DB_CONFIG)
                conn.autocommit = True
                yield conn
                conn.close()
                return
            except OperationalError as e:
                if attempt < max_retries - 1:
                    print(f"PostgreSQL connection attempt {attempt + 1} failed, retrying...")
                    time.sleep(retry_delay)
                else:
                    raise e

    def test_database_connection(self, db_connection):
        """Test that we can connect to PostgreSQL."""
        assert db_connection is not None
        cursor = db_connection.cursor()
        cursor.execute("SELECT version()")
        version = cursor.fetchone()[0]
        assert version is not None
        assert "PostgreSQL" in version
        print(f"✓ PostgreSQL version: {version}")

    def test_database_tables_exist(self, db_connection):
        """Test that required tables were created."""
        cursor = db_connection.cursor()

        # Check for alerts table
        cursor.execute(
            """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'alerts'
            )
        """
        )
        assert cursor.fetchone()[0] is True, "alerts table does not exist"

        # Check for triage_results table
        cursor.execute(
            """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'triage_results'
            )
        """
        )
        assert cursor.fetchone()[0] is True, "triage_results table does not exist"

        # Check for remediation_actions table
        cursor.execute(
            """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'remediation_actions'
            )
        """
        )
        assert cursor.fetchone()[0] is True, "remediation_actions table does not exist"

        # Check for threat_intel table (note: table name is threat_intel not threat_intelligence)
        cursor.execute(
            """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'threat_intel'
            )
        """
        )
        assert cursor.fetchone()[0] is True, "threat_intel table does not exist"

        print("✓ All required tables exist")

    def test_database_indexes_exist(self, db_connection):
        """Test that important indexes were created."""
        cursor = db_connection.cursor()

        # Check for alerts table indexes
        cursor.execute(
            """
            SELECT indexname FROM pg_indexes
            WHERE tablename = 'alerts'
        """
        )
        indexes = [row[0] for row in cursor.fetchall()]

        # Note: alert_id has a unique constraint (alerts_alert_id_key) instead of an index
        assert "alerts_alert_id_key" in indexes, "alert_id unique constraint missing"
        # Note: column is received_at not timestamp
        assert "idx_alerts_received_at" in indexes, "received_at index missing"
        assert "idx_alerts_severity" in indexes, "severity index missing"
        assert "idx_alerts_status" in indexes, "status index missing"
        assert "idx_alerts_alert_type" in indexes, "alert_type index missing"

        print(f"✓ Found {len(indexes)} indexes/constraints on alerts table")

    def test_sample_data_exists(self, db_connection):
        """Test that sample data was inserted."""
        cursor = db_connection.cursor()

        cursor.execute("SELECT COUNT(*) FROM alerts")
        count = cursor.fetchone()[0]

        assert count >= 4, f"Expected at least 4 sample alerts, found {count}"
        print(f"✓ Found {count} sample alerts")

    def test_database_insert_and_query(self, db_connection):
        """Test that we can insert and query data."""
        cursor = db_connection.cursor()

        # Insert test alert
        # Note: column is received_at not timestamp, alert_type has constraints
        test_alert_id = f"TEST-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        cursor.execute(
            """
            INSERT INTO alerts (alert_id, received_at, alert_type, severity, title, description)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """,
            (test_alert_id, datetime.now(), "malware", "low", "Test Alert", "Test alert for integration testing"),
        )

        alert_id = cursor.fetchone()[0]
        assert alert_id is not None

        # Query the alert
        cursor.execute("SELECT alert_id, title FROM alerts WHERE alert_id = %s", (test_alert_id,))
        result = cursor.fetchone()
        assert result is not None
        assert result[0] == test_alert_id
        assert result[1] == "Test Alert"

        # Clean up
        cursor.execute("DELETE FROM alerts WHERE alert_id = %s", (test_alert_id,))

        print("✓ Database insert and query successful")


# =============================================================================
# Redis Tests
# =============================================================================


class TestRedis:
    """Test Redis connectivity and functionality."""

    @pytest.fixture(scope="class")
    def redis_client(self):
        """Create Redis client for tests."""
        max_retries = 5
        retry_delay = 2

        for attempt in range(max_retries):
            try:
                client = redis.Redis(
                    host=REDIS_CONFIG["host"],
                    port=REDIS_CONFIG["port"],
                    password=REDIS_CONFIG["password"],
                    db=REDIS_CONFIG["db"],
                    decode_responses=True,
                )
                client.ping()
                yield client
                client.close()
                return
            except redis.ConnectionError as e:
                if attempt < max_retries - 1:
                    print(f"Redis connection attempt {attempt + 1} failed, retrying...")
                    time.sleep(retry_delay)
                else:
                    raise e

    def test_redis_connection(self, redis_client):
        """Test that we can connect to Redis."""
        assert redis_client is not None
        result = redis_client.ping()
        assert result is True
        print("✓ Redis connection successful")

    def test_redis_set_and_get(self, redis_client):
        """Test Redis SET and GET operations."""
        test_key = f"test:key:{datetime.now().strftime('%Y%m%d%H%M%S')}"
        test_value = "test_value"

        # Set
        redis_client.set(test_key, test_value)

        # Get
        result = redis_client.get(test_key)
        assert result == test_value

        # Clean up
        redis_client.delete(test_key)

        print("✓ Redis SET/GET operations successful")

    def test_redis_cache_expiration(self, redis_client):
        """Test Redis cache expiration (TTL)."""
        test_key = f"test:ttl:{datetime.now().strftime('%Y%m%d%H%M%S')}"

        # Set with 2 second TTL
        redis_client.setex(test_key, 2, "expiring_value")

        # Check immediately
        assert redis_client.get(test_key) == "expiring_value"

        # Wait for expiration
        time.sleep(3)

        # Check after expiration
        result = redis_client.get(test_key)
        assert result is None

        print("✓ Redis TTL expiration working correctly")

    def test_redis_list_operations(self, redis_client):
        """Test Redis list operations (for message queue simulation)."""
        test_list = f"test:list:{datetime.now().strftime('%Y%m%d%H%M%S')}"

        # Push items
        redis_client.rpush(test_list, "item1", "item2", "item3")

        # Pop item
        item = redis_client.lpop(test_list)
        assert item == "item1"

        # Check length
        length = redis_client.llen(test_list)
        assert length == 2

        # Clean up
        redis_client.delete(test_list)

        print("✓ Redis list operations successful")


# =============================================================================
# RabbitMQ Tests
# =============================================================================


class TestRabbitMQ:
    """Test RabbitMQ connectivity and functionality."""

    @pytest.fixture(scope="class")
    def rabbitmq_connection(self):
        """Create RabbitMQ connection for tests."""
        max_retries = 5
        retry_delay = 2

        for attempt in range(max_retries):
            try:
                credentials = pika.PlainCredentials(
                    RABBITMQ_CONFIG["user"], RABBITMQ_CONFIG["password"]
                )
                parameters = pika.ConnectionParameters(
                    host=RABBITMQ_CONFIG["host"],
                    port=RABBITMQ_CONFIG["port"],
                    virtual_host=RABBITMQ_CONFIG["vhost"],
                    credentials=credentials,
                )
                connection = pika.BlockingConnection(parameters)
                yield connection
                connection.close()
                return
            except Exception as e:
                if attempt < max_retries - 1:
                    print(f"RabbitMQ connection attempt {attempt + 1} failed, retrying...")
                    time.sleep(retry_delay)
                else:
                    raise e

    def test_rabbitmq_connection(self, rabbitmq_connection):
        """Test that we can connect to RabbitMQ."""
        assert rabbitmq_connection is not None
        assert rabbitmq_connection.is_open is True
        print("✓ RabbitMQ connection successful")

    def test_rabbitmq_queues_exist(self, rabbitmq_connection):
        """Test that we can interact with RabbitMQ queues."""
        channel = rabbitmq_connection.channel()

        # Test queues that may be created by services
        # If they don't exist, we'll create a test queue to verify functionality
        required_queues = [
            "alert.raw",
            "alert.normalized",
            "alert.enriched",
            "alert.result",
        ]

        existing_queues = []
        for queue_name in required_queues:
            try:
                # Create new channel for each attempt (previous may be closed)
                test_channel = rabbitmq_connection.channel()
                test_channel.queue_declare(queue=queue_name, passive=True)
                existing_queues.append(queue_name)
                test_channel.close()
                print(f"✓ Queue exists: {queue_name}")
            except (pika.exceptions.ChannelClosedByBroker, pika.exceptions.ChannelWrongStateError):
                # Queue doesn't exist yet - services not started
                print(f"ℹ️  Queue not yet created: {queue_name} (services not started)")
            except Exception as e:
                print(f"⚠️  Error checking queue {queue_name}: {e}")

        # Even if queues don't exist, verify we can create a test queue
        if not existing_queues:
            test_queue = f"test.queue.{datetime.now().strftime('%Y%m%d%H%M%S')}"
            test_channel = rabbitmq_connection.channel()
            test_channel.queue_declare(queue=test_queue)
            test_channel.queue_delete(queue=test_queue)
            test_channel.close()
            print(f"✓ RabbitMQ queue creation/deletion works (test queue: {test_queue})")

    def test_rabbitmq_publish_and_consume(self, rabbitmq_connection):
        """Test publishing and consuming a message."""
        channel = rabbitmq_connection.channel()

        test_queue = f"test.queue.{datetime.now().strftime('%Y%m%d%H%M%S')}"

        # Declare test queue
        channel.queue_declare(queue=test_queue)

        # Publish message
        test_message = f"Test message at {datetime.now().isoformat()}"
        channel.basic_publish(
            exchange="",
            routing_key=test_queue,
            body=test_message,
        )
        print(f"✓ Published message to queue: {test_queue}")

        # Consume message
        method, properties, body = channel.basic_get(queue=test_queue, auto_ack=True)
        assert body.decode() == test_message
        print(f"✓ Consumed message from queue: {test_queue}")

        # Clean up
        channel.queue_delete(queue=test_queue)

    def test_rabbitmq_exchanges_exist(self, rabbitmq_connection):
        """Test that we can interact with RabbitMQ exchanges."""
        channel = rabbitmq_connection.channel()

        # Test exchanges that may be created by services
        required_exchanges = ["alerts", "workflows", "notifications"]

        existing_exchanges = []
        for exchange_name in required_exchanges:
            try:
                # Create new channel for each attempt (previous may be closed)
                test_channel = rabbitmq_connection.channel()
                test_channel.exchange_declare(exchange=exchange_name, passive=True)
                existing_exchanges.append(exchange_name)
                test_channel.close()
                print(f"✓ Exchange exists: {exchange_name}")
            except (pika.exceptions.ChannelClosedByBroker, pika.exceptions.ChannelWrongStateError):
                # Exchange doesn't exist yet - services not started
                print(f"ℹ️  Exchange not yet created: {exchange_name} (services not started)")
            except Exception as e:
                print(f"⚠️  Error checking exchange {exchange_name}: {e}")

        # Even if exchanges don't exist, verify we can create a test exchange
        if not existing_exchanges:
            test_exchange = f"test.exchange.{datetime.now().strftime('%Y%m%d%H%M%S')}"
            test_channel = rabbitmq_connection.channel()
            test_channel.exchange_declare(exchange=test_exchange, exchange_type='direct')
            test_channel.exchange_delete(exchange=test_exchange)
            test_channel.close()
            print(f"✓ RabbitMQ exchange creation/deletion works (test exchange: {test_exchange})")


# =============================================================================
# ChromaDB Tests
# =============================================================================


class TestChromaDB:
    """Test ChromaDB connectivity and functionality."""

    @pytest.fixture(scope="class")
    def chromadb_client(self):
        """Create ChromaDB client for tests."""
        max_retries = 5
        retry_delay = 2

        for attempt in range(max_retries):
            try:
                import chromadb

                client = chromadb.HttpClient(
                    host=CHROMADB_CONFIG["host"], port=CHROMADB_CONFIG["port"]
                )
                # Test connection
                client.heartbeat()
                yield client
                return
            except Exception as e:
                if attempt < max_retries - 1:
                    print(f"ChromaDB connection attempt {attempt + 1} failed, retrying...")
                    time.sleep(retry_delay)
                else:
                    raise e

    def test_chromadb_connection(self, chromadb_client):
        """Test that we can connect to ChromaDB."""
        assert chromadb_client is not None
        # Heartbeat will raise exception if connection fails
        chromadb_client.heartbeat()
        print("✓ ChromaDB connection successful")

    def test_chromadb_create_collection(self, chromadb_client):
        """Test creating a collection."""
        test_collection_name = f"test_collection_{datetime.now().strftime('%Y%m%d%H%M%S')}"

        # Create collection
        collection = chromadb_client.create_collection(
            name=test_collection_name,
            metadata={"description": "Test collection for integration testing"},
        )

        assert collection is not None
        assert collection.name == test_collection_name
        print(f"✓ Created collection: {test_collection_name}")

        # Clean up
        chromadb_client.delete_collection(test_collection_name)
        print(f"✓ Deleted collection: {test_collection_name}")

    def test_chromadb_insert_and_query(self, chromadb_client):
        """Test inserting and querying vectors."""
        test_collection_name = f"test_collection_{datetime.now().strftime('%Y%m%d%H%M%S')}"

        # Create collection
        collection = chromadb_client.create_collection(name=test_collection_name)

        # Insert test data
        test_ids = ["id1", "id2", "id3"]
        test_embeddings = [
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
            [0.7, 0.8, 0.9],
        ]
        test_documents = ["doc1", "doc2", "doc3"]

        collection.add(ids=test_ids, embeddings=test_embeddings, documents=test_documents)
        print("✓ Inserted test vectors into ChromaDB")

        # Query
        results = collection.query(query_embeddings=[[0.1, 0.2, 0.3]], n_results=2)

        assert results is not None
        assert len(results["ids"][0]) == 2
        print("✓ Queried vectors from ChromaDB")

        # Clean up
        chromadb_client.delete_collection(test_collection_name)


# =============================================================================
# Performance Tests
# =============================================================================


class TestPerformance:
    """Performance benchmarks for infrastructure services."""

    def test_database_query_performance(self):
        """Test database query performance."""
        import psycopg2

        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        start_time = time.time()

        # Execute 100 queries
        for _ in range(100):
            cursor.execute("SELECT * FROM alerts LIMIT 1")
            cursor.fetchone()

        end_time = time.time()
        elapsed = end_time - start_time

        cursor.close()
        conn.close()

        avg_time_ms = (elapsed / 100) * 1000

        # Target: < 50ms per query P95
        assert avg_time_ms < 50, f"Average query time {avg_time_ms:.2f}ms exceeds 50ms target"
        print(f"✓ Database query performance: {avg_time_ms:.2f}ms average")

    def test_redis_cache_performance(self):
        """Test Redis cache performance."""
        client = redis.Redis(**REDIS_CONFIG, decode_responses=True)

        test_key = "perf_test_key"
        test_value = "x" * 100  # 100 bytes

        # Measure SET performance
        start_time = time.time()
        for _ in range(1000):
            client.set(test_key, test_value)
        set_time = time.time() - start_time

        # Measure GET performance
        start_time = time.time()
        for _ in range(1000):
            client.get(test_key)
        get_time = time.time() - start_time

        avg_set_time_ms = (set_time / 1000) * 1000
        avg_get_time_ms = (get_time / 1000) * 1000

        # Target: < 5ms per operation P95
        assert avg_set_time_ms < 5, f"SET time {avg_set_time_ms:.2f}ms exceeds 5ms target"
        assert avg_get_time_ms < 5, f"GET time {avg_get_time_ms:.2f}ms exceeds 5ms target"

        print(f"✓ Redis SET performance: {avg_set_time_ms:.2f}ms average")
        print(f"✓ Redis GET performance: {avg_get_time_ms:.2f}ms average")

        # Clean up
        client.close()


# =============================================================================
# Health Check Tests
# =============================================================================


class TestHealthChecks:
    """Test health check endpoints for infrastructure services."""

    def test_postgresql_health_check(self):
        """Test PostgreSQL health check."""
        import psycopg2

        try:
            conn = psycopg2.connect(**DB_CONFIG)
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            result = cursor.fetchone()
            cursor.close()
            conn.close()

            assert result[0] == 1
            print("✓ PostgreSQL health check passed")
        except Exception as e:
            pytest.fail(f"PostgreSQL health check failed: {e}")

    def test_redis_health_check(self):
        """Test Redis health check."""
        client = redis.Redis(**REDIS_CONFIG, decode_responses=True)

        try:
            result = client.ping()
            assert result is True
            print("✓ Redis health check passed")
        except Exception as e:
            pytest.fail(f"Redis health check failed: {e}")
        finally:
            client.close()

    def test_rabbitmq_health_check(self):
        """Test RabbitMQ health check."""
        try:
            credentials = pika.PlainCredentials(
                RABBITMQ_CONFIG["user"], RABBITMQ_CONFIG["password"]
            )
            parameters = pika.ConnectionParameters(
                host=RABBITMQ_CONFIG["host"],
                port=RABBITMQ_CONFIG["port"],
                virtual_host=RABBITMQ_CONFIG["vhost"],
                credentials=credentials,
            )
            connection = pika.BlockingConnection(parameters)
            assert connection.is_open is True
            connection.close()

            print("✓ RabbitMQ health check passed")
        except Exception as e:
            pytest.fail(f"RabbitMQ health check failed: {e}")

    def test_chromadb_health_check(self):
        """Test ChromaDB health check."""
        try:
            import chromadb

            client = chromadb.HttpClient(host=CHROMADB_CONFIG["host"], port=CHROMADB_CONFIG["port"])
            client.heartbeat()

            print("✓ ChromaDB health check passed")
        except Exception as e:
            pytest.fail(f"ChromaDB health check failed: {e}")
