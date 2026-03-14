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
Cryptographic utilities for encrypting and decrypting sensitive data.

This module provides Fernet-based symmetric encryption for API keys and other
sensitive configuration values.
"""

import os
import base64
from typing import Optional

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from shared.utils import get_logger

logger = get_logger(__name__)

# Configuration key for encryption
ENCRYPTION_KEY_ENV = "ENCRYPTION_KEY"


def get_encryption_key() -> bytes:
    """
    Get or generate the encryption key for Fernet.

    Returns:
        Fernet encryption key as bytes

    Raises:
        ValueError: If ENCRYPTION_KEY is not set and cannot be generated
    """
    key = os.getenv(ENCRYPTION_KEY_ENV)

    if not key:
        # Generate a new key if not set (for development)
        # In production, this should be set via environment variable
        logger.warning(
            f"ENCRYPTION_KEY not set, generating temporary key. "
            f"Set {ENCRYPTION_KEY_ENV} environment variable for production use."
        )
        key = base64.urlsafe_b64encode(os.urandom(32)).decode()

    # Ensure key is valid Fernet key (32 bytes, base64-encoded)
    try:
        key_bytes = key.encode() if isinstance(key, str) else key
        # If it's not a valid Fernet key, derive one from it
        if len(key_bytes) != 44:  # Fernet keys are 44 bytes when base64-encoded
            # Derive a proper key using PBKDF2
            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=b'security_triage_salt',  # In production, use random salt
                iterations=100000,
            )
            derived_key = base64.urlsafe_b64encode(kdf.derive(key_bytes))
            return derived_key
        return key_bytes
    except Exception as e:
        logger.error(f"Invalid encryption key: {e}")
        raise ValueError(f"Invalid {ENCRYPTION_KEY_ENV}: {e}")


def encrypt_value(plaintext: str) -> str:
    """
    Encrypt a plaintext value using Fernet symmetric encryption.

    Args:
        plaintext: Plain text value to encrypt

    Returns:
        Encrypted value as base64-encoded string
    """
    if not plaintext:
        return ""

    try:
        key = get_encryption_key()
        fernet = Fernet(key)
        encrypted_bytes = fernet.encrypt(plaintext.encode('utf-8'))
        return encrypted_bytes.decode('utf-8')
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        raise ValueError(f"Failed to encrypt value: {e}") from e


def decrypt_value(encrypted: str) -> str:
    """
    Decrypt an encrypted value using Fernet symmetric encryption.

    Args:
        encrypted: Encrypted value (base64-encoded string)

    Returns:
        Decrypted plain text value

    Raises:
        ValueError: If decryption fails
    """
    if not encrypted:
        return ""

    try:
        key = get_encryption_key()
        fernet = Fernet(key)
        decrypted_bytes = fernet.decrypt(encrypted.encode('utf-8'))
        return decrypted_bytes.decode('utf-8')
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        raise ValueError(f"Failed to decrypt value: {e}") from e


def is_encrypted_value(value: str) -> bool:
    """
    Check if a value appears to be encrypted (Fernet format).

    Fernet tokens are base64-encoded and have a specific structure.
    This is a simple heuristic check.

    Args:
        value: Value to check

    Returns:
        True if value appears to be encrypted, False otherwise
    """
    if not value or len(value) < 44:
        return False

    try:
        # Try to decode as base64
        decoded = base64.urlsafe_b64decode(value.encode())
        # Fernet tokens are at least 44 bytes (timestamp + IV + ciphertext + HMAC)
        return len(decoded) >= 44
    except Exception:
        return False


def safe_decrypt(value: str) -> str:
    """
    Safely decrypt a value, returning the original if decryption fails.

    This is useful for handling both encrypted and plaintext values
    during migration periods.

    Args:
        value: Value to decrypt (may already be plaintext)

    Returns:
        Decrypted value or original value if decryption fails
    """
    if not value:
        return ""

    if not is_encrypted_value(value):
        # Value is not encrypted, return as-is
        return value

    try:
        return decrypt_value(value)
    except Exception:
        # Decryption failed, return original value
        # (might be a plaintext value that looks like encrypted)
        return value
