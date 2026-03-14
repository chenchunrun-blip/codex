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
Add Apache 2.0 copyright header to all Python source files.

Copyright 2026 CCR <chenchunrun@gmail.com>
Licensed under the Apache License, Version 2.0
"""

import os
from pathlib import Path

# Copyright header to add
COPYRIGHT_HEADER = '''# Copyright 2026 CCR <chenchunrun@gmail.com>
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
'''

def has_copyright_header(content: str) -> bool:
    """Check if file already has copyright header."""
    lines = content.split('\n')
    for line in lines[:10]:  # Check first 10 lines
        if line.strip().startswith('# Copyright '):
            return True
    return False

def add_header_to_file(file_path: Path) -> bool:
    """Add copyright header to a single file. Returns True if modified."""
    try:
        # Read file content
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Check if already has copyright header
        if has_copyright_header(content):
            print(f"  ✓ Already has copyright header: {file_path.relative_to('/Users/newmba/security')}")
            return False

        # Extract shebang and encoding if present
        lines = content.split('\n')
        prefix_lines = []

        # Check for shebang
        if lines and lines[0].startswith('#!'):
            prefix_lines.append(lines[0])
            lines.pop(0)

        # Check for encoding declaration
        if lines and ('coding' in lines[0] or 'encoding' in lines[0]):
            prefix_lines.append(lines[0])
            lines.pop(0)

        # Add copyright header
        new_content = '\n'.join(prefix_lines)
        if prefix_lines:
            new_content += '\n'
        new_content += COPYRIGHT_HEADER + '\n'
        new_content += '\n'.join(lines)

        # Write back
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)

        print(f"  ✓ Added copyright header: {file_path.relative_to('/Users/newmba/security')}")
        return True

    except Exception as e:
        print(f"  ✗ Error processing {file_path}: {e}")
        return False

def main():
    """Process all Python files in the project."""
    base_path = Path('/Users/newmba/security')

    # Find all Python files, excluding cache directories
    python_files = []
    for file_path in base_path.rglob('*.py'):
        # Skip cache and test cache directories
        if '__pycache__' in str(file_path) or '.pytest_cache' in str(file_path):
            continue
        python_files.append(file_path)

    python_files.sort()

    print(f"Found {len(python_files)} Python files to process\n")

    modified_count = 0
    skipped_count = 0

    for file_path in python_files:
        if add_header_to_file(file_path):
            modified_count += 1
        else:
            skipped_count += 1

    print(f"\n{'='*60}")
    print(f"Summary:")
    print(f"  Total files:     {len(python_files)}")
    print(f"  Modified:        {modified_count}")
    print(f"  Skipped:         {skipped_count}")
    print(f"{'='*60}")

if __name__ == '__main__':
    main()
