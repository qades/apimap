#!/bin/bash

# API Map - Start Script
# Starts both the API server and GUI

cd "$(dirname "$0")"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                   API Map - Starting                       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Function to cleanup processes on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $API_PID $GUI_PID 2>/dev/null
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
    echo "📁 Creating config directory..."
    mkdir -p config/backups
fi

# Create default config if needed
if [ ! -f "config/config.yaml" ]; then
    echo "📝 Creating default configuration..."
    cat > config/config.yaml << 'EOF'
server:
  port: 3000
  host: "0.0.0.0"
  timeout: 120
  cors:
    origin: "*"
    credentials: false

logging:
  dir: "./logs"
  level: "info"
  maskKeys: true

preload:
  enabled: false
  models: []

schemes:
  - id: "openai"
    path: "/v1/chat/completions"
    format: "openai"
  - id: "anthropic"
    path: "/v1/messages"
    format: "anthropic"

providers:
  ollama:
    baseUrl: "http://localhost:11434"
    timeout: 300

routes:
  - pattern: "local/*"
    provider: ollama
    model: "${1}"
    priority: 80

  - pattern: "llama2*"
    provider: ollama
    priority: 70

  - pattern: "mistral*"
    provider: ollama
    priority: 70

  - pattern: "codellama*"
    provider: ollama
    priority: 70
EOF
fi

# Start API server
echo "🚀 Starting API server on http://0.0.0.0:3000..."
bun run --hot src/server.ts --host 0.0.0.0 &
API_PID=$!

# Wait for API to start
sleep 2

# Start GUI with host binding
echo "🎨 Starting GUI on http://0.0.0.0:3001..."
cd gui && bun run dev --host &
GUI_PID=$!

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  API Server:  http://0.0.0.0:3000                        ║"
echo "║  GUI:         http://0.0.0.0:3001                        ║"
echo "║                                                            ║"
echo "║  Press Ctrl+C to stop both servers                         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Wait for both processes
wait
