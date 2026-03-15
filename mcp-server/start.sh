#!/bin/sh
# MCP Server startup script

echo "Installing esbuild for Alpine Linux..."
cd /app

# Install esbuild binary for Alpine Linux
npm install esbuild-linux-64 --save-dev 2>/dev/null || true

# Or rebuild esbuild
npm rebuild esbuild 2>/dev/null || true

echo "Starting MCP SSE Server..."
exec npx tsx mcp-server/sse-server.ts
