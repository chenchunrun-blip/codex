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
Network context collector for enriching alerts with network information.

This module handles collection of network context including:
- GeoIP location data (MaxMind GeoLite2 or ip-api.com fallback)
- IP reputation scores (AbuseIPDB)
- Network anomalies
- Subnet information
"""

import asyncio
import ipaddress
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import aiohttp
from shared.utils.logger import get_logger

logger = get_logger(__name__)

# API configuration
GEOIP_DB_PATH = os.getenv("GEOIP_DB_PATH", "")  # Path to GeoLite2-City.mmdb
ABUSEIPDB_API_KEY = os.getenv("ABUSEIPDB_API_KEY", "")


class NetworkCollector:
    """
    Collector for network-related context.

    Gathers information about IP addresses, geolocation, reputation,
    and network characteristics.
    """

    # Internal network ranges
    INTERNAL_NETWORKS = [
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "127.0.0.0/8",
        "169.254.0.0/16",
    ]

    # Known threat intelligence feeds
    THREAT_FEEDS = [
        "abuseipdb",
        "virustotal",
        "alienvault_otx",
        "threatconnect",
    ]

    def __init__(self, cache_ttl_seconds: int = 3600):
        """
        Initialize network collector.

        Args:
            cache_ttl_seconds: Cache time-to-live in seconds (default 1 hour)
        """
        self.cache_ttl = timedelta(seconds=cache_ttl_seconds)
        self.cache: Dict[str, tuple] = {}  # key: (data, expiry_time)
        self.internal_networks = [ipaddress.ip_network(net) for net in self.INTERNAL_NETWORKS]

    async def collect_context(self, ip: str) -> Dict[str, Any]:
        """
        Collect comprehensive network context for an IP address.

        Args:
            ip: IP address string

        Returns:
            Dictionary with network context information
        """
        # Validate IP address
        if not self._is_valid_ip(ip):
            logger.warning(f"Invalid IP address: {ip}")
            return self._empty_context(ip)

        # Check cache
        cache_key = f"network:{ip}"
        cached_data = self._get_from_cache(cache_key)
        if cached_data:
            logger.debug(f"Network context cache hit for {ip}")
            return cached_data

        # Build network context
        context = {
            "ip": ip,
            "is_internal": self._is_internal_ip(ip),
            "collected_at": datetime.utcnow().isoformat(),
        }

        # Collect geolocation data
        geo_data = await self._query_geolocation(ip)
        context["geolocation"] = geo_data

        # Collect reputation data
        reputation_data = await self._query_reputation(ip)
        context["reputation"] = reputation_data

        # Collect subnet information
        subnet_data = self._get_subnet_info(ip)
        context["subnet"] = subnet_data

        # Collect network anomalies (if any)
        anomalies = await self._detect_anomalies(ip)
        if anomalies:
            context["anomalies"] = anomalies

        # Cache the result
        self._put_in_cache(cache_key, context)

        logger.info(
            f"Network context collected for {ip}",
            extra={
                "ip": ip,
                "has_geo": bool(geo_data),
                "reputation_score": reputation_data.get("score"),
            },
        )

        return context

    def _is_valid_ip(self, ip: str) -> bool:
        """
        Validate IP address format.

        Args:
            ip: IP address string

        Returns:
            True if valid, False otherwise
        """
        try:
            ipaddress.ip_address(ip)
            return True
        except ValueError:
            return False

    def _is_internal_ip(self, ip: str) -> bool:
        """
        Check if IP is internal/private.

        Args:
            ip: IP address string

        Returns:
            True if internal, False otherwise
        """
        try:
            addr = ipaddress.ip_address(ip)
            return any(addr in network for network in self.internal_networks)
        except ValueError:
            return False

    async def _query_geolocation(self, ip: str) -> Dict[str, Any]:
        """
        Query geolocation data for IP address.

        Uses MaxMind GeoLite2 local database if available, otherwise falls back
        to the free ip-api.com HTTP service.

        Args:
            ip: IP address string

        Returns:
            Geolocation data dictionary
        """
        if self._is_internal_ip(ip):
            return {
                "country": "Internal",
                "country_code": "INT",
                "city": "Internal Network",
                "latitude": None,
                "longitude": None,
                "timezone": None,
            }

        # Try MaxMind GeoLite2 local database first
        if GEOIP_DB_PATH:
            try:
                import geoip2.database

                with geoip2.database.Reader(GEOIP_DB_PATH) as reader:
                    response = reader.city(ip)
                    return {
                        "country": response.country.name or "Unknown",
                        "country_code": response.country.iso_code or "XX",
                        "city": response.city.name or "Unknown",
                        "latitude": response.location.latitude,
                        "longitude": response.location.longitude,
                        "timezone": response.location.time_zone,
                    }
            except ImportError:
                logger.debug("geoip2 library not installed, falling back to HTTP API")
            except Exception as e:
                logger.warning(f"GeoLite2 lookup failed for {ip}: {e}")

        # Fallback: free ip-api.com (no key required, 45 req/min limit)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"http://ip-api.com/json/{ip}",
                    params={
                        "fields": "status,country,countryCode,city,lat,lon,timezone,isp,org,as"
                    },
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        if data.get("status") == "success":
                            return {
                                "country": data.get("country", "Unknown"),
                                "country_code": data.get("countryCode", "XX"),
                                "city": data.get("city", "Unknown"),
                                "latitude": data.get("lat"),
                                "longitude": data.get("lon"),
                                "timezone": data.get("timezone"),
                                "isp": data.get("isp"),
                                "org": data.get("org"),
                                "asn": data.get("as"),
                            }
        except asyncio.TimeoutError:
            logger.warning(f"GeoIP HTTP lookup timed out for {ip}")
        except Exception as e:
            logger.warning(f"GeoIP HTTP lookup failed for {ip}: {e}")

        return {
            "country": "Unknown",
            "country_code": "XX",
            "city": "Unknown",
            "latitude": None,
            "longitude": None,
            "timezone": None,
        }

    async def _query_reputation(self, ip: str) -> Dict[str, Any]:
        """
        Query IP reputation from AbuseIPDB.

        Args:
            ip: IP address string

        Returns:
            Reputation data dictionary
        """
        if self._is_internal_ip(ip):
            return {
                "score": 0,
                "confidence": 1.0,
                "categories": [],
                "reports": 0,
                "last_reported": None,
                "sources": [],
            }

        # Query AbuseIPDB if key is available
        if ABUSEIPDB_API_KEY:
            try:
                headers = {"Key": ABUSEIPDB_API_KEY, "Accept": "application/json"}
                params = {"ipAddress": ip, "maxAgeInDays": "90", "verbose": ""}

                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        "https://api.abuseipdb.com/api/v2/check",
                        params=params,
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as response:
                        if response.status == 200:
                            data = await response.json()
                            report = data.get("data", {})
                            abuse_score = report.get("abuseConfidenceScore", 0)

                            return {
                                "score": abuse_score,
                                "confidence": (
                                    min(abuse_score / 100.0, 1.0) if abuse_score > 0 else 0.3
                                ),
                                "categories": [str(c) for c in report.get("reports", [])[:5]],
                                "reports": report.get("totalReports", 0),
                                "last_reported": report.get("lastReportedAt"),
                                "sources": ["AbuseIPDB"],
                                "isp": report.get("isp"),
                                "country_code": report.get("countryCode"),
                                "is_whitelisted": report.get("isWhitelisted", False),
                            }
                        else:
                            logger.warning(f"AbuseIPDB returned {response.status} for {ip}")

            except asyncio.TimeoutError:
                logger.warning(f"AbuseIPDB timeout for {ip}")
            except Exception as e:
                logger.warning(f"AbuseIPDB query failed for {ip}: {e}")

        # Fallback: unknown reputation
        return {
            "score": 50,
            "confidence": 0.3,
            "categories": ["unknown"],
            "reports": 0,
            "last_reported": None,
            "sources": [],
        }

    def _get_subnet_info(self, ip: str) -> Dict[str, Any]:
        """
        Get subnet information for IP address.

        Args:
            ip: IP address string

        Returns:
            Subnet information dictionary
        """
        try:
            addr = ipaddress.ip_address(ip)

            # Find matching internal subnet
            for network in self.internal_networks:
                if addr in network:
                    return {
                        "subnet": str(network),
                        "network_address": str(network.network_address),
                        "broadcast_address": str(network.broadcast_address),
                        "prefix_length": network.prefixlen,
                        "num_addresses": network.num_addresses,
                        "is_internal": True,
                    }

            # For external IPs, provide basic info
            return {
                "subnet": None,
                "network_address": None,
                "broadcast_address": None,
                "prefix_length": None,
                "num_addresses": None,
                "is_internal": False,
            }

        except ValueError:
            return {}

    async def _detect_anomalies(self, ip: str) -> List[Dict[str, Any]]:
        """
        Detect network anomalies for IP address.

        Performs heuristic checks based on collected reputation data.

        Args:
            ip: IP address string

        Returns:
            List of anomaly dictionaries
        """
        anomalies = []

        # Check reputation data for anomalies
        reputation = await self._query_reputation(ip)

        if reputation.get("score", 0) >= 75:
            anomalies.append(
                {
                    "type": "high_abuse_score",
                    "severity": "high",
                    "description": f"IP {ip} has abuse confidence score of {reputation['score']}%",
                    "detected_at": datetime.utcnow().isoformat(),
                }
            )

        if reputation.get("reports", 0) > 50:
            anomalies.append(
                {
                    "type": "frequently_reported",
                    "severity": "medium",
                    "description": f"IP {ip} reported {reputation['reports']} times in the last 90 days",
                    "detected_at": datetime.utcnow().isoformat(),
                }
            )

        # Check if IP is in a known bad ASN range (Bogon/unallocated)
        try:
            addr = ipaddress.ip_address(ip)
            if addr.is_reserved or addr.is_multicast:
                anomalies.append(
                    {
                        "type": "reserved_address",
                        "severity": "low",
                        "description": f"IP {ip} is a reserved/multicast address",
                        "detected_at": datetime.utcnow().isoformat(),
                    }
                )
        except ValueError:
            pass

        return anomalies

    def _get_from_cache(self, key: str) -> Optional[Any]:
        """Get value from cache if not expired."""
        if key in self.cache:
            data, expiry = self.cache[key]
            if datetime.utcnow() < expiry:
                return data
            else:
                del self.cache[key]
        return None

    def _put_in_cache(self, key: str, data: Any):
        """Put value in cache with expiry time."""
        expiry = datetime.utcnow() + self.cache_ttl
        self.cache[key] = (data, expiry)

    def _empty_context(self, ip: str) -> Dict[str, Any]:
        """Return empty context for invalid IP."""
        return {
            "ip": ip,
            "is_internal": False,
            "geolocation": None,
            "reputation": None,
            "subnet": None,
            "anomalies": [],
            "collected_at": datetime.utcnow().isoformat(),
            "error": "Invalid IP address",
        }

    async def collect_batch_context(self, ips: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Collect network context for multiple IPs in parallel.

        Args:
            ips: List of IP address strings

        Returns:
            Dictionary mapping IP to context data
        """
        import asyncio

        tasks = [self.collect_context(ip) for ip in ips]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        context_map = {}
        for ip, result in zip(ips, results):
            if isinstance(result, Exception):
                logger.error(f"Error collecting context for {ip}: {result}")
                context_map[ip] = self._empty_context(ip)
            else:
                context_map[ip] = result

        return context_map

    def get_cache_stats(self) -> Dict[str, Any]:
        """
        Get cache statistics.

        Returns:
            Dictionary with cache stats
        """
        return {
            "cache_size": len(self.cache),
            "cache_ttl_seconds": int(self.cache_ttl.total_seconds()),
            "expired_entries": sum(
                1 for _, expiry in self.cache.values() if datetime.utcnow() >= expiry
            ),
        }

    def clear_cache(self):
        """Clear all cached data."""
        self.cache.clear()
        logger.info("Network context cache cleared")
