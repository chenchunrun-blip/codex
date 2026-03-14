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
Structured logging utilities.

Provides logging with standard Python logging module.
"""

import logging
import os
import sys
from datetime import datetime
from typing import Any, Dict, Optional

# Global flag to ensure handlers are only added once
_handlers_configured = False
_logger = None

def get_logger(name: str) -> Any:
    """
    Get logger instance.

    Args:
        name: Logger name (typically __name__)

    Returns:
        Logger instance
    """
    global _handlers_configured, _logger

    # Only configure handlers once
    if not _handlers_configured:
        _logger = logging.getLogger("security_triage")
        _logger.setLevel(logging.DEBUG)

        # Console handler
        console_handler = logging.StreamHandler(sys.stderr)
        console_handler.setLevel(logging.INFO)
        console_format = logging.Formatter(
            '%(asctime)s | %(levelname)-8s | %(name)s:%(funcName)s:%(lineno)d - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        console_handler.setFormatter(console_format)
        _logger.addHandler(console_handler)

        # File handler for JSON logs - create logs directory if it doesn't exist
        log_dir = "logs"
        try:
            os.makedirs(log_dir, exist_ok=True)
            from logging.handlers import RotatingFileHandler
            file_handler = RotatingFileHandler(
                os.path.join(log_dir, "triage.log"),
                maxBytes=100*1024*1024,  # 100 MB
                backupCount=30
            )
            file_handler.setLevel(logging.DEBUG)
            file_format = logging.Formatter(
                '%(asctime)s | %(levelname)s | %(name)s:%(funcName)s:%(lineno)d - %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S'
            )
            file_handler.setFormatter(file_format)
            _logger.addHandler(file_handler)
        except Exception as e:
            # If we can't create the file handler, just use console
            _logger.warning(f"Could not create file handler: {e}")

        _handlers_configured = True

    # Return a child logger with the specified name
    return _logger.getChild(name)


def log_structured(
    level: str,
    message: str,
    extra: Optional[Dict[str, Any]] = None,
):
    """
    Log structured message with extra fields.

    Args:
        level: Log level (info, warning, error, etc.)
        message: Log message
        extra: Additional fields for structured logging
    """
    logger = get_logger("structured")

    log_func = getattr(logger, level, logger.info)
    if extra:
        # Add extra fields to the message as string
        extra_str = " | " + ", ".join(f"{k}={v}" for k, v in extra.items())
        log_func(message + extra_str)
    else:
        log_func(message)
