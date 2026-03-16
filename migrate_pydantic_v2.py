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
Migrate Pydantic V1 Config to Pydantic V2 ConfigDict.

This script updates all model files to use ConfigDict instead of class Config.
"""

import re
from pathlib import Path


def migrate_config_to_configdict(file_path: Path) -> int:
    """
    Migrate a single file from Config to ConfigDict.

    Returns number of migrations performed.
    """
    content = file_path.read_text()
    original_content = content

    # Add ConfigDict import if not present
    if "from pydantic import" in content and "ConfigDict" not in content:
        # Add ConfigDict to existing pydantic import
        content = re.sub(
            r"(from pydantic import [^\n]+)",
            r"\1, ConfigDict",
            content
        )
    elif "from pydantic import " not in content and "class Config:" in content:
        # Add new import line after other imports or at top
        lines = content.split('\n')
        import_idx = 0
        for i, line in enumerate(lines):
            if line.startswith('from ') or line.startswith('import '):
                import_idx = i + 1
            elif not line.strip() and import_idx > 0:
                break

        lines.insert(import_idx, "from pydantic import ConfigDict")
        content = '\n'.join(lines)

    # Migrate each Config class
    migrations = 0

    # Pattern to match Config class with its content
    pattern = r'(\s+)class Config:\s*\n((?:\s+\w+.*\n)*)'

    def replace_config(match):
        nonlocal migrations
        indent = match.group(1)
        config_body = match.group(2)

        # Parse config items
        config_items = []
        for line in config_body.strip().split('\n'):
            line = line.strip()
            if '=' in line:
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip().rstrip(',')
                # Convert Python values to dict-compatible format
                if value == 'True':
                    value = 'True'
                elif value == 'False':
                    value = 'False'
                elif value.startswith('"') or value.startswith("'"):
                    value = value  # Keep string quotes
                elif value.startswith('[') or value.startswith('{'):
                    value = value  # Keep lists/dicts as-is
                else:
                    value = f'"{value}"' if not value.isdigit() and not value.replace('.', '', 1).isdigit() else value
                config_items.append(f"{key}={value}")

        migrations += 1
        config_dict = ', '.join(config_items)
        return f'{indent}model_config = ConfigDict({config_dict})\n'

    content = re.sub(pattern, replace_config, content)

    # Write back if changed
    if content != original_content:
        file_path.write_text(content)
        return migrations

    return 0


def main():
    """Migrate all model files."""
    models_dir = Path("services/shared/models")

    if not models_dir.exists():
        print(f"Error: {models_dir} does not exist")
        return

    py_files = list(models_dir.glob("*.py"))
    py_files = [f for f in py_files if f.name != "__init__.py"]

    total_migrations = 0

    print("Migrating Pydantic Config to ConfigDict...\n")

    for py_file in sorted(py_files):
        migrations = migrate_config_to_configdict(py_file)
        if migrations > 0:
            total_migrations += migrations
            print(f"✓ {py_file.name}: {migrations} migrations")

    print(f"\n✓ Total: {total_migrations} Config classes migrated to ConfigDict")

    # Also migrate config.py
    config_file = Path("services/shared/utils/config.py")
    if config_file.exists():
        migrations = migrate_config_to_configdict(config_file)
        if migrations > 0:
            total_migrations += migrations
            print(f"✓ {config_file.name}: {migrations} migrations")

    print(f"\n✓✓✓ Final total: {total_migrations} migrations completed")


if __name__ == "__main__":
    main()
