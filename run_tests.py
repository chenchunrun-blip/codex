#!/usr/bin/env python
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
Test runner script for Security Triage System.

This script runs all tests and generates reports.
"""

import subprocess
import sys
import os
from pathlib import Path
from datetime import datetime


class TestRunner:
    """Test runner for managing test execution."""

    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.tests_dir = project_root / "tests"
        self.reports_dir = project_root / "test-reports"

        # Create reports directory
        self.reports_dir.mkdir(exist_ok=True)

    def run_unit_tests(self) -> int:
        """Run unit tests."""
        print("=" * 60)
        print("Running Unit Tests...")
        print("=" * 60)

        cmd = [
            sys.executable, "-m", "pytest",
            "tests/unit",
            "-v",
            "-m", "unit",
            "--cov=services/shared",
            "--cov-report=term-missing",
            "--cov-report=html:test-reports/coverage-unit",
            "--html=test-reports/unit-report.html",
            "--self-contained-html",
            "-x"  # Stop on first failure
        ]

        result = subprocess.run(cmd, cwd=self.project_root)
        return result.returncode

    def run_integration_tests(self) -> int:
        """Run integration tests."""
        print("\n" + "=" * 60)
        print("Running Integration Tests...")
        print("=" * 60)

        cmd = [
            sys.executable, "-m", "pytest",
            "tests/integration",
            "-v",
            "-m", "integration",
            "--html=test-reports/integration-report.html",
            "--self-contained-html",
        ]

        result = subprocess.run(cmd, cwd=self.project_root)
        return result.returncode

    def run_system_tests(self) -> int:
        """Run system tests."""
        print("\n" + "=" * 60)
        print("Running System Tests...")
        print("=" * 60)

        cmd = [
            sys.executable, "-m", "pytest",
            "tests/system",
            "-v",
            "-m", "system",
            "--html=test-reports/system-report.html",
            "--self-contained-html",
            "-s"  # Show output
        ]

        result = subprocess.run(cmd, cwd=self.project_root)
        return result.returncode

    def run_all_tests(self) -> Dict[str, int]:
        """Run all tests and return results."""
        print("\n" + "🚀 " + "=" * 58)
        print("Running All Tests - Security Triage System")
        print("=" * 60 + "\n")

        results = {
            "unit": self.run_unit_tests(),
            "integration": self.run_integration_tests(),
            "system": self.run_system_tests()
        }

        return results

    def generate_summary_report(self, results: Dict[str, int]):
        """Generate summary test report."""
        report_path = self.reports_dir / "summary.md"

        total_tests = sum(results.values())
        passed_tests = sum(1 for v in results.values() if v == 0)
        failed_tests = sum(1 for v in results.values() if v != 0)

        with open(report_path, "w") as f:
            f.write("# Test Execution Summary\n\n")
            f.write(f"**Date**: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"**Project**: Security Alert Triage System\n\n")
            f.write("---\n\n")
            f.write("## Test Results Summary\n\n")
            f.write(f"**Total Test Suites**: 3\n")
            f.write(f"**Passed**: {passed_tests}\n")
            f.write(f"**Failed**: {failed_tests}\n\n")

            f.write("## Detailed Results\n\n")
            f.write("| Test Suite | Status | Exit Code |\n")
            f.write("|------------|--------|----------|\n")
            f.write(f"| Unit Tests | {'✅ PASS' if results['unit'] == 0 else '❌ FAIL'} | {results['unit']} |\n")
            f.write(f"| Integration Tests | {'✅ PASS' if results['integration'] == 0 else '❌ FAIL'} | {results['integration']} |\n")
            f.write(f"| System Tests | {'✅ PASS' if results['system'] == 0 else '❌ FAIL'} | {results['system']} |\n\n")

            f.write("## Reports Generated\n\n")
            f.write("1. **Unit Test Report**: `test-reports/unit-report.html`\n")
            f.write("2. **Integration Test Report**: `test-reports/integration-report.html`\n")
            f.write("3. **System Test Report**: `test-reports/system-report.html`\n")
            f.write("4. **Coverage Report**: `test-reports/coverage-unit/index.html`\n\n")

            f.write("## Viewing Reports\n\n")
            f.write("Open the HTML reports in your browser:\n\n")
            f.write("```bash\n")
            f.write("# Unit tests report\n")
            f.write("open test-reports/unit-report.html\n\n")
            f.write("# Coverage report\n")
            f.write("open test-reports/coverage-unit/index.html\n\n")
            f.write("# Integration tests report\n")
            f.write("open test-reports/integration-report.html\n\n")
            f.write("# System tests report\n")
            f.write("open test-reports/system-report.html\n")
            f.write("```\n")

        print(f"\n✅ Summary report generated: {report_path}")

    def print_summary(self, results: Dict[str, int]):
        """Print test summary to console."""
        print("\n" + "=" * 60)
        print("Test Execution Summary")
        print("=" * 60)

        total_suites = len(results)
        passed_suites = sum(1 for v in results.values() if v == 0)

        for test_type, exit_code in results.items():
            status = "✅ PASS" if exit_code == 0 else "❌ FAIL"
            print(f"{test_type.title()}: {status} (exit code: {exit_code})")

        print(f"\nTotal: {passed_suites}/{total_suites} test suites passed")

        if all(v == 0 for v in results.values()):
            print("\n🎉 All tests passed!")
        else:
            print("\n⚠️  Some tests failed. Check reports for details.")


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Run tests for Security Triage System")
    parser.add_argument(
        "--type",
        choices=["all", "unit", "integration", "system"],
        default="all",
        help="Type of tests to run"
    )
    parser.add_argument(
        "--project-root",
        type=str,
        default=".",
        help="Project root directory"
    )

    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    runner = TestRunner(project_root)

    if args.type == "all":
        results = runner.run_all_tests()
        runner.generate_summary_report(results)
        runner.print_summary(results)

        # Exit with error if any tests failed
        sys.exit(0 if all(v == 0 for v in results.values()) else 1)

    elif args.type == "unit":
        sys.exit(runner.run_unit_tests())

    elif args.type == "integration":
        sys.exit(runner.run_integration_tests())

    elif args.type == "system":
        sys.exit(runner.run_system_tests())


if __name__ == "__main__":
    main()
