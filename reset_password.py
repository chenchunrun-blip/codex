#!/usr/bin/env python3
"""
Reset admin user password.

Run this script to generate a new password hash for the admin user.
Usage: python reset_password.py <new_password>
"""

import sys
import bcrypt

def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python reset_password.py <new_password>")
        print("Example: python reset_password.py admin123")
        sys.exit(1)

    password = sys.argv[1]
    hashed = hash_password(password)

    print(f"\nPassword: {password}")
    print(f"Hash: {hashed}\n")

    print("SQL to update database:")
    print(f"UPDATE users SET password_hash = '{hashed}' WHERE username = 'admin';")
