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
Test runner script with comprehensive reporting.

Run tests:
  ./tests/run_tests.py                    # All tests
  ./tests/run_tests.py unit               # Unit tests only
  ./tests/run_tests.py integration        # Integration tests only
  ./tests/run_tests.py e2e                # E2E tests only
  ./tests/run_tests.py stage1             # Stage 1 tests only
  ./tests/run_tests.py --cov              # With coverage report
  ./tests/run_tests.py --html             # Generate HTML report
"""

import argparse
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def run_command(cmd: list, description: str) -> int:
    """Run a command and return exit code."""
    print(f"\n{'='*70}")
    print(f"Running: {description}")
    print(f"Command: {' '.join(cmd)}")
    print(f"{'='*70}\n")

    result = subprocess.run(cmd, cwd=Path(__file__).parent.parent)

    if result.returncode != 0:
        print(f"\n❌ {description} failed with exit code {result.returncode}")
    else:
        print(f"\n✅ {description} succeeded")

    return result.returncode


def main():
    """Main test runner."""
    parser = argparse.ArgumentParser(description="Run security triage system tests")
    parser.add_argument(
        "test_type",
        nargs="?",
        choices=["unit", "integration", "e2e", "all"],
        default="all",
        help="Type of tests to run",
    )
    parser.add_argument(
        "--stage",
        type=str,
        help="Run tests for specific stage (e.g., stage1, stage2, stage3, stage4)",
    )
    parser.add_argument("--cov", action="store_true", help="Generate coverage report")
    parser.add_argument("--html", action="store_true", help="Generate HTML report")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument(
        "--parallel", "-n", type=int, help="Number of parallel workers (requires pytest-xdist)"
    )

    args = parser.parse_args()

    # Build pytest command
    pytest_cmd = ["python", "-m", "pytest"]

    # Add verbosity
    if args.verbose:
        pytest_cmd.append("-vv")
    else:
        pytest_cmd.append("-v")

    # Add coverage
    if args.cov:
        pytest_cmd.extend(
            [
                "--cov=services",
                "--cov-report=html",
                "--cov-report=term-missing",
                "--cov-fail-under=80",
            ]
        )

    # Add HTML report
    if args.html:
        report_dir = Path(__file__).parent.parent / "test-reports"
        report_dir.mkdir(exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        pytest_cmd.extend(
            ["--html", str(report_dir / f"report_{timestamp}.html"), "--self-contained-html"]
        )

    # Add parallel execution
    if args.parallel:
        pytest_cmd.extend(["-n", str(args.parallel)])

    # Determine test paths
    test_dir = Path(__file__).parent

    if args.stage:
        # Run tests for specific stage
        stage_map = {
            "stage1": "tests/unit/stage1",
            "stage2": "tests/unit/stage2",
            "stage3": "tests/unit/stage3",
            "stage4": "tests/unit/stage4",
        }
        test_path = stage_map.get(args.stage.lower())
        if test_path:
            pytest_cmd.append(str(test_dir / test_path))
        else:
            print(f"❌ Unknown stage: {args.stage}")
            print(f"Available stages: {', '.join(stage_map.keys())}")
            return 1
    else:
        # Run by test type
        if args.test_type == "unit":
            pytest_cmd.append(str(test_dir / "unit"))
            pytest_cmd.append("-m")
            pytest_cmd.append("unit")
        elif args.test_type == "integration":
            pytest_cmd.append(str(test_dir / "integration"))
            pytest_cmd.append("-m")
            pytest_cmd.append("integration")
        elif args.test_type == "e2e":
            pytest_cmd.append(str(test_dir / "e2e"))
            pytest_cmd.append("-m")
            pytest_cmd.append("e2e")
        else:  # all
            pytest_cmd.append(str(test_dir))

    # Run tests
    exit_code = run_command(pytest_cmd, f"Running {args.test_type} tests")

    # Print summary
    print(f"\n{'='*70}")
    print("Test Summary")
    print(f"{'='*70}")

    if args.cov:
        print(f"\n📊 Coverage report: {Path(__file__).parent.parent / 'htmlcov' / 'index.html'}")

    if args.html:
        print(f"\n📄 HTML report: {report_dir / f'report_{timestamp}.html'}")

    print(f"\n{'='*70}\n")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
