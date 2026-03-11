#!/bin/bash

# API Map - Start Script
# Starts the API server (which auto-launches the GUI in dev mode)

cd "$(dirname "$0")"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                   API Map - Starting                       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Function to cleanup processes on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $API_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo "Error: Bun is not installed. Please install Bun first:"
    echo "  curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing API dependencies..."
    bun install
fi

if [ ! -d "gui/node_modules" ]; then
    echo "📦 Installing GUI dependencies..."
    cd gui && bun install && cd ..
fi

# Create config directory if needed
if [ ! -d "config" ]; then
    mkdir -p config/backups
fi

# Config will be auto-generated on first run with detected providers
# if config/config.yaml doesn't exist

# Start API server with hot reload (auto-launches GUI dev server)
echo "🚀 Starting API server (hot reload) on http://0.0.0.0:3000..."
echo "🎨 GUI will be available at http://0.0.0.0:3001"
echo ""
bun --hot src/server.ts &
API_PID=$!

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  API Server:  http://0.0.0.0:3000                        ║"
echo "║  GUI:         http://0.0.0.0:3001                        ║"
echo "║                                                            ║"
echo "║  Press Ctrl+C to stop                                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Wait for process
wait
