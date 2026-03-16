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

"""Configuration Management"""
import os
from pathlib import Path
from typing import Dict, Any
import yaml
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class Config:
    """Configuration Manager"""

    def __init__(self, config_path: str = None):
        if config_path is None:
            config_path = Path(__file__).parent.parent.parent / "config" / "config.yaml"

        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)

    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value by dot notation key"""
        keys = key.split('.')
        value = self.config

        for k in keys:
            if isinstance(value, dict):
                value = value.get(k)
            else:
                return default

        return value if value is not None else default

    @property
    def llm_api_key(self) -> str:
        """Get LLM API key"""
        return os.getenv("LLM_API_KEY", "")

    @property
    def llm_base_url(self) -> str:
        """Get LLM base URL"""
        base_url = os.getenv("LLM_BASE_URL", "")
        return base_url if base_url else None

    @property
    def llm_model(self) -> str:
        """Get LLM model name"""
        return self.get("llm.model", "qwen-plus")

    @property
    def llm_temperature(self) -> float:
        """Get LLM temperature"""
        return self.get("llm.temperature", 0.0)

    # 保持向后兼容
    @property
    def openai_api_key(self) -> str:
        """Get OpenAI API key (deprecated, use llm_api_key)"""
        return self.llm_api_key

    @property
    def openai_model(self) -> str:
        """Get OpenAI model name (deprecated, use llm_model)"""
        return self.llm_model

    @property
    def openai_temperature(self) -> float:
        """Get OpenAI temperature (deprecated, use llm_temperature)"""
        return self.llm_temperature

    @property
    def vector_store_dir(self) -> Path:
        """Get vector store directory"""
        return Path(self.get("vector_store.persist_directory", "./data/vector_store"))

    @property
    def log_level(self) -> str:
        """Get log level"""
        return os.getenv("LOG_LEVEL", self.get("logging.level", "INFO"))

    @property
    def log_file(self) -> Path:
        """Get log file path"""
        return Path(self.get("logging.file", "./logs/triage.log"))

    @property
    def risk_thresholds(self) -> Dict[str, int]:
        """Get risk score thresholds"""
        return self.get("risk_scoring.thresholds", {
            "critical": 90,
            "high": 70,
            "medium": 40,
            "low": 20,
            "info": 0
        })

    @property
    def risk_weights(self) -> Dict[str, float]:
        """Get risk scoring weights"""
        return self.get("risk_scoring.weights", {
            "severity": 0.3,
            "threat_intel": 0.3,
            "asset_criticality": 0.2,
            "exploitability": 0.2
        })


# Global config instance
config = Config()
