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
Alert processors for different SIEM formats.

This package provides processors for normalizing alerts from various
SIEM and security products to a standard SecurityAlert format.
"""

from .cef_processor import CEFProcessor
from .qradar_processor import QRadarProcessor
from .splunk_processor import SplunkProcessor

__all__ = [
    "SplunkProcessor",
    "QRadarProcessor",
    "CEFProcessor",
]
