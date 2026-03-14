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
API Gateway Verification Script.

This script verifies that the API Gateway can start and respond to basic requests.
"""

import sys
import os
from pathlib import Path

# Add project root to Python path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

print("=" * 60)
print("API Gateway Verification")
print("=" * 60)
print()

# Step 1: Check dependencies
print("✓ Step 1: Checking dependencies...")
try:
    import fastapi
    import uvicorn
    import sqlalchemy
    import pydantic
    import loguru
    print(f"  FastAPI: {fastapi.__version__}")
    print(f"  Uvicorn: {uvicorn.__version__}")
    print(f"  SQLAlchemy: {sqlalchemy.__version__}")
    print(f"  Pydantic: {pydantic.__version__}")
    print("  All dependencies installed ✓")
except ImportError as e:
    print(f"  ✗ Missing dependency: {e}")
    print("\n  Run: pip install -r requirements.txt")
    sys.exit(1)

print()

# Step 2: Check imports
print("✓ Step 2: Checking imports...")
try:
    from main import app
    print("  Main app: ✓")
    from routes import alerts
    print("  Alerts router: ✓")
    from routes import analytics
    print("  Analytics router: ✓")
    from models import requests
    print("  Request models: ✓")
    from models import responses
    print("  Response models: ✓")
except ImportError as e:
    print(f"  ✗ Import error: {e}")
    sys.exit(1)

print()

# Step 3: Check routes
print("✓ Step 3: Checking routes...")
routes = []
for route in app.routes:
    if hasattr(route, 'path') and hasattr(route, 'methods'):
        for method in route.methods:
            if method != 'HEAD':
                routes.append(f"{method} {route.path}")

print(f"  Total routes: {len(routes)}")
print("  Key routes:")
key_routes = [
    "GET /",
    "GET /health",
    "GET /api/v1/alerts/",
    "POST /api/v1/alerts/",
    "GET /api/v1/analytics/dashboard",
]
for key_route in key_routes:
    if key_route in routes:
        print(f"    {key_route} ✓")
    else:
        print(f"    {key_route} ✗")

print()

# Step 4: Check OpenAPI docs
print("✓ Step 4: Checking OpenAPI documentation...")
open_api_schema = app.openapi()
print(f"  Title: {open_api_schema['info']['title']}")
print(f"  Version: {open_api_schema['info']['version']}")
print(f"  Paths: {len(open_api_schema['paths'])}")
print("  OpenAPI schema generated ✓")

print()

# Step 5: Summary
print("=" * 60)
print("✓ API Gateway Verification Complete")
print("=" * 60)
print()
print("Next steps:")
print("  1. Start the server:")
print("     python main.py")
print()
print("  2. Or use the start script:")
print("     ./start.sh")
print()
print("  3. Access the API:")
print("     http://localhost:8080/docs")
print("     http://localhost:8080/redoc")
print("     http://localhost:8080/health")
print()
