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
POC Test Quick Start Script

Quick setup and execution of POC tests.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path


class POCQuickStart:
    """Quick start POC testing."""

    def __init__(self):
        self.project_root = Path(__file__).parent.parent.parent
        self.poc_dir = self.project_root / "tests" / "poc"
        self.data_dir = self.poc_dir / "data"
        self.report_dir = self.project_root / "test-reports" / "poc"

    def print_banner(self):
        """Print welcome banner."""
        print("\n" + "=" * 70)
        print("  Security Alert Triage System - POC Quick Start".center(70))
        print("=" * 70)
        print()

    def check_environment(self):
        """Check if environment is ready."""
        print("Checking environment...")

        checks = {
            "Python": sys.version_info >= (3, 9),
            "pytest": self._check_module("pytest"),
            "POC directory": self.poc_dir.exists(),
            "Project structure": (self.project_root / "services").exists(),
        }

        for name, passed in checks.items():
            status = "✓" if passed else "✗"
            print(f"  {status} {name}")

        all_passed = all(checks.values())

        if not all_passed:
            print("\n⚠ Environment check failed. Please fix issues above.")
            return False

        print("\n✓ Environment ready!")
        return True

    def _check_module(self, module_name):
        """Check if Python module is installed."""
        try:
            __import__(module_name)
            return True
        except ImportError:
            return False

    def prepare_test_data(self, count=100):
        """Generate test data."""
        print(f"\nGenerating {count} test alerts...")
        self.data_dir.mkdir(parents=True, exist_ok=True)

        script = self.poc_dir / "data_generator.py"
        cmd = [
            sys.executable,
            str(script),
            "--count",
            str(count),
            "--output",
            str(self.data_dir / "alerts.json"),
        ]

        result = subprocess.run(cmd, cwd=self.project_root)
        return result.returncode == 0

    def run_poc_tests(self):
        """Run POC test scenarios."""
        print("\nRunning POC test scenarios...")
        self.report_dir.mkdir(parents=True, exist_ok=True)

        script = self.poc_dir / "test_executor.py"
        cmd = [
            sys.executable,
            str(script),
            "--scenario",
            "all",
            "--output",
            str(self.report_dir / "results.json"),
        ]

        result = subprocess.run(cmd, cwd=self.project_root)
        return result.returncode == 0

    def show_results(self):
        """Show test results."""
        report_file = self.report_dir / "results.json"

        if not report_file.exists():
            print("\n⚠ No test results found")
            return

        import json

        with open(report_file) as f:
            report = json.load(f)

        summary = report["poc_summary"]
        print("\n" + "=" * 70)
        print("POC Test Results Summary")
        print("=" * 70)
        print(f"Execution Date: {summary['execution_date']}")
        print(f"Total Scenarios: {summary['total_scenarios']}")
        print(f"Passed: {summary['passed']}")
        print(f"Failed: {summary['failed']}")
        print(f"Pass Rate: {summary['pass_rate']:.1f}%")

        print("\nScenario Details:")
        for scenario in report["scenarios"]:
            status_icon = "✓" if scenario["status"] == "PASSED" else "✗"
            print(
                f"  {status_icon} {scenario['test_name']}: {scenario['status']} ({scenario['duration']:.2f}s)"
            )

        print("\nFull report: test-reports/poc/results.json")
        print("=" * 70)

    def interactive_menu(self):
        """Interactive menu for POC testing."""
        while True:
            print("\n" + "=" * 70)
            print("POC Quick Start Menu")
            print("=" * 70)
            print("1. Check environment")
            print("2. Generate test data (default: 100 alerts)")
            print("3. Run all POC scenarios")
            print("4. View test results")
            print("5. Quick test (10 alerts)")
            print("6. Exit")
            print()

            choice = input("Select option [1-6]: ").strip()

            if choice == "1":
                self.check_environment()

            elif choice == "2":
                count = input("Number of alerts [100]: ").strip() or "100"
                if self.prepare_test_data(int(count)):
                    print("✓ Test data generated successfully")
                else:
                    print("✗ Failed to generate test data")

            elif choice == "3":
                if self.run_poc_tests():
                    print("✓ POC tests completed")
                else:
                    print("✗ POC tests failed")

            elif choice == "4":
                self.show_results()

            elif choice == "5":
                print("Running quick test with 10 alerts...")
                self.prepare_test_data(10)
                self.run_poc_tests()
                self.show_results()

            elif choice == "6":
                print("\nGoodbye!")
                break

            else:
                print("\n✗ Invalid option. Please select 1-6.")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="POC Quick Start")
    parser.add_argument(
        "--mode",
        choices=["check", "data", "test", "results", "quick"],
        help="Run specific step directly",
    )
    parser.add_argument("--count", type=int, default=100, help="Number of alerts to generate")

    args = parser.parse_args()

    quickstart = POCQuickStart()
    quickstart.print_banner()

    if args.mode == "check":
        success = quickstart.check_environment()
        sys.exit(0 if success else 1)

    elif args.mode == "data":
        success = quickstart.prepare_test_data(args.count)
        sys.exit(0 if success else 1)

    elif args.mode == "test":
        success = quickstart.run_poc_tests()
        sys.exit(0 if success else 1)

    elif args.mode == "results":
        quickstart.show_results()
        sys.exit(0)

    elif args.mode == "quick":
        # Quick test: small data + run tests
        if quickstart.check_environment():
            quickstart.prepare_test_data(10)
            quickstart.run_poc_tests()
            quickstart.show_results()

    else:
        # Interactive mode
        if quickstart.check_environment():
            quickstart.interactive_menu()


if __name__ == "__main__":
    main()
