# Copyright 2026 CCR <chenchunrun@gmail.com>
#
# Simple JSON-based data loader for POC deployment
# This replaces complex CMDB/LDAP integrations with JSON files

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class JSONDataLoader:
    """Load and manage data from JSON files for POC deployment."""

    def __init__(self, data_dir: str = "/app/data"):
        """
        Initialize the data loader.

        Args:
            data_dir: Directory containing JSON data files
        """
        self.data_dir = Path(data_dir)
        self._assets: Optional[Dict[str, Any]] = None
        self._users: Optional[Dict[str, Any]] = None
        self._iocs: Optional[Dict[str, Any]] = None
        self._load_all_data()

    def _load_json_file(self, filename: str) -> Dict[str, Any]:
        """
        Load a JSON file from the data directory.

        Args:
            filename: Name of the JSON file

        Returns:
            Parsed JSON data as dictionary
        """
        file_path = self.data_dir / filename

        if not file_path.exists():
            logger.warning(f"Data file not found: {file_path}")
            return {}

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            logger.info(f"Loaded data from {file_path}")
            return data
        except Exception as e:
            logger.error(f"Failed to load {file_path}: {e}")
            return {}

    def _load_all_data(self):
        """Load all JSON data files into memory."""
        logger.info(f"Loading data from {self.data_dir}")

        self._assets = self._load_json_file("assets.json")
        self._users = self._load_json_file("users.json")
        self._iocs = self._load_json_file("internal_iocs.json")

        logger.info(
            f"Data loaded: "
            f"{len(self._assets.get('assets', []))} assets, "
            f"{len(self._users.get('users', []))} users, "
            f"{len(self._iocs.get('iocs', []))} IOCs"
        )

    def reload(self):
        """Reload all data from files."""
        logger.info("Reloading data...")
        self._load_all_data()

    # ========================================================================
    # Asset Queries
    # ========================================================================

    def get_asset_by_id(self, asset_id: str) -> Optional[Dict[str, Any]]:
        """
        Get asset by asset_id.

        Args:
            asset_id: Asset identifier

        Returns:
            Asset dictionary or None if not found
        """
        assets = self._assets.get("assets", [])
        for asset in assets:
            if asset.get("asset_id") == asset_id:
                return asset
        return None

    def get_asset_by_ip(self, ip_address: str) -> Optional[Dict[str, Any]]:
        """
        Get asset by IP address.

        Args:
            ip_address: IP address

        Returns:
            Asset dictionary or None if not found
        """
        assets = self._assets.get("assets", [])
        for asset in assets:
            if asset.get("ip_address") == ip_address:
                return asset
        return None

    def get_all_assets(self) -> List[Dict[str, Any]]:
        """Get all assets."""
        return self._assets.get("assets", [])

    def is_internal_network(self, ip_address: str) -> bool:
        """
        Check if IP is in internal network ranges.

        Args:
            ip_address: IP address to check

        Returns:
            True if internal, False otherwise
        """
        import ipaddress

        try:
            ip = ipaddress.ip_address(ip_address)
            networks = self._assets.get("networks", {})
            internal_ranges = networks.get("internal_ranges", [])

            for range_str in internal_ranges:
                network = ipaddress.ip_network(range_str)
                if ip in network:
                    return True

            return False
        except ValueError:
            return False

    # ========================================================================
    # User Queries
    # ========================================================================

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Get user by user_id (email or username).

        Args:
            user_id: User identifier

        Returns:
            User dictionary or None if not found
        """
        users = self._users.get("users", [])
        for user in users:
            if (
                user.get("user_id") == user_id
                or user.get("username") == user_id
                or user.get("email") == user_id
            ):
                return user
        return None

    def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """
        Get user by email address.

        Args:
            email: Email address

        Returns:
            User dictionary or None if not found
        """
        return self.get_user_by_id(email)

    def get_all_users(self) -> List[Dict[str, Any]]:
        """Get all users."""
        return self._users.get("users", [])

    # ========================================================================
    # IOC Queries
    # ========================================================================

    def get_ioc(self, ioc_value: str, ioc_type: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Get IOC by value and optionally by type.

        Args:
            ioc_value: IOC value
            ioc_type: Optional IOC type filter

        Returns:
            IOC dictionary or None if not found
        """
        iocs = self._iocs.get("iocs", [])
        for ioc in iocs:
            if not ioc.get("active", True):
                continue
            if ioc.get("ioc_value") == ioc_value:
                if ioc_type is None or ioc.get("ioc_type") == ioc_type:
                    return ioc
        return None

    def get_iocs_by_type(self, ioc_type: str) -> List[Dict[str, Any]]:
        """
        Get all IOCs of a specific type.

        Args:
            ioc_type: IOC type (ip, domain, hash, url, email)

        Returns:
            List of IOC dictionaries
        """
        iocs = self._iocs.get("iocs", [])
        return [
            ioc
            for ioc in iocs
            if ioc.get("ioc_type") == ioc_type and ioc.get("active", True)
        ]

    def is_malicious_ioc(self, ioc_value: str) -> tuple[bool, Optional[Dict[str, Any]]]:
        """
        Check if IOC is in internal threat intelligence database.

        Args:
            ioc_value: IOC value to check

        Returns:
            Tuple of (is_malicious, ioc_data)
        """
        ioc = self.get_ioc(ioc_value)
        if ioc:
            return True, ioc
        return False, None

    def get_all_iocs(self) -> List[Dict[str, Any]]:
        """Get all active IOCs."""
        iocs = self._iocs.get("iocs", [])
        return [ioc for ioc in iocs if ioc.get("active", True)]


# Global instance
_data_loader: Optional[JSONDataLoader] = None


def get_data_loader() -> JSONDataLoader:
    """Get the global data loader instance."""
    global _data_loader
    if _data_loader is None:
        # Default data directory for Docker container
        data_dir = "/app/data"
        # Check if running locally (for development)
        if not Path(data_dir).exists():
            # Try local development path
            local_data_dir = Path(__file__).parent.parent.parent / "data"
            if local_data_dir.exists():
                data_dir = str(local_data_dir)

        _data_loader = JSONDataLoader(data_dir)
    return _data_loader
