#!/bin/bash

# Copyright 2026 CCR <chenchunrun@gmail.com>
#
# Script to push Security Triage System to GitHub
# This script handles the git push operation with multiple retry methods

echo "================================"
echo "Security Triage System - Git Push"
echo "================================"
echo ""

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

echo "📊 Current Git Status:"
echo ""
git status --short
echo ""

# Show pending commits
echo "📝 Pending Commits:"
echo ""
git log origin/main..main --oneline 2>/dev/null || git log -1 --oneline
echo ""

echo "🚀 Attempting to push to GitHub..."
echo "================================"
echo ""

# Method 1: Normal HTTPS push
echo "📡 Method 1: Normal HTTPS push..."
if git push origin main 2>&1; then
    echo ""
    echo "✅ Successfully pushed to GitHub using Method 1!"
    echo ""
    echo "📦 Repository: https://github.com/chenchunrun/security"
    echo ""
    exit 0
fi
echo "❌ Method 1 failed"
echo ""

# Method 2: HTTP/1.1 (fallback from HTTP/2)
echo "📡 Method 2: HTTPS with HTTP/1.1..."
if git -c http.version=HTTP/1.1 push origin main 2>&1; then
    echo ""
    echo "✅ Successfully pushed to GitHub using Method 2!"
    echo ""
    echo "📦 Repository: https://github.com/chenchunrun/security"
    echo ""
    exit 0
fi
echo "❌ Method 2 failed"
echo ""

# Method 3: With verbose output
echo "📡 Method 3: Verbose HTTPS push..."
if git push origin main --verbose 2>&1; then
    echo ""
    echo "✅ Successfully pushed to GitHub using Method 3!"
    echo ""
    echo "📦 Repository: https://github.com/chenchunrun/security"
    echo ""
    exit 0
fi
echo "❌ Method 3 failed"
echo ""

# Method 4: Try SSH if available
echo "📡 Method 4: SSH (if configured)..."
REMOTE_URL=$(git remote get-url origin)
if echo "$REMOTE_URL" | grep -q "^git@"; then
    echo "SSH already configured, trying..."
    if git push origin main 2>&1; then
        echo ""
        echo "✅ Successfully pushed to GitHub using Method 4!"
        echo ""
        exit 0
    fi
else
    echo "⚠️  HTTPS remote detected. To switch to SSH:"
    echo "   git remote set-url origin git@github.com:chenchunrun/security.git"
    echo "   git push origin main"
fi
echo "❌ Method 4 failed or not available"
echo ""

# All methods failed
echo "================================"
echo "❌ All automatic methods failed"
echo ""
echo "📝 Manual troubleshooting steps:"
echo ""
echo "1. Check internet connectivity:"
echo "   ping github.com"
echo "   curl -I https://github.com"
echo ""
echo "2. Try pushing manually:"
echo "   cd /Users/newmba/security"
echo "   git push origin main"
echo ""
echo "3. Check Git configuration:"
echo "   git remote -v"
echo "   git config --list | grep -E '(http|proxy|url)'"
echo ""
echo "4. Switch to SSH (recommended for stability):"
echo "   git remote set-url origin git@github.com:chenchunrun/security.git"
echo "   git push origin main"
echo ""
echo "5. If behind proxy, configure it:"
echo "   export https_proxy=http://proxy.example.com:8080"
echo "   export http_proxy=http://proxy.example.com:8080"
echo "   git push origin main"
echo ""
echo "6. Try GitHub Desktop or other Git GUI client"
echo ""
echo "7. Check for VPN/Firewall interference"
echo ""
echo "Pending commits:"
git log origin/main..main --oneline 2>/dev/null || echo "Unable to show commits"
echo ""
echo "================================"
echo ""
exit 1
