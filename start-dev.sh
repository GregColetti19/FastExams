#!/bin/bash
# start-dev.sh - Start FastExams dev environment with converter

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONVERTER_DIR="$PROJECT_ROOT/converter"
LOG_DIR="/tmp/fastexams-logs"

mkdir -p "$LOG_DIR"

echo "=== FastExams Dev Startup ==="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not installed. Install from https://nodejs.org"
    exit 1
fi
echo "✓ Node.js: $(node --version)"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 not installed. Install from https://python.org"
    exit 1
fi
echo "✓ Python3: $(python3 --version)"

# Setup Node dependencies
cd "$PROJECT_ROOT"
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi
echo "✓ Node dependencies ready"

# Setup Python venv
if [ ! -d "$CONVERTER_DIR/venv" ]; then
    echo "Creating Python venv..."
    cd "$CONVERTER_DIR"
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    cd "$PROJECT_ROOT"
else
    echo "✓ Python venv exists"
fi

# Kill any existing processes
pkill -f "next dev" || true
pkill -f "python.*main.py" || true
sleep 1

# Start converter
echo "Starting converter..."
cd "$CONVERTER_DIR"
source venv/bin/activate
python -u main.py 2>&1 | tee "$LOG_DIR/converter.log" &
CONVERTER_PID=$!
echo "✓ Converter PID: $CONVERTER_PID (log: $LOG_DIR/converter.log)"

# Start Next.js dev
echo "Starting Next.js..."
cd "$PROJECT_ROOT"
npm run dev > "$LOG_DIR/next.log" 2>&1 &
NEXT_PID=$!
echo "✓ Next.js PID: $NEXT_PID (log: $LOG_DIR/next.log)"

# Wait for servers
sleep 3

# Check if both are running
if ! kill -0 $CONVERTER_PID 2>/dev/null; then
    echo "❌ Converter failed to start. Check: tail $LOG_DIR/converter.log"
    kill $NEXT_PID 2>/dev/null || true
    exit 1
fi

if ! kill -0 $NEXT_PID 2>/dev/null; then
    echo "❌ Next.js failed to start. Check: tail $LOG_DIR/next.log"
    kill $CONVERTER_PID 2>/dev/null || true
    exit 1
fi

echo "✓ Both services running"
echo ""
echo "Logs available at:"
echo "  Converter: tail -f $LOG_DIR/converter.log"
echo "  Next.js:   tail -f $LOG_DIR/next.log"
echo ""
echo "Opening http://localhost:3000 in Chrome..."
open -a "Google Chrome" http://localhost:3000 2>/dev/null || echo "(Chrome not available, open manually)"

echo ""
echo "Press Ctrl+C to stop both services"

# Keep script alive, kill both on exit
trap "echo 'Stopping services...' && kill $CONVERTER_PID $NEXT_PID 2>/dev/null; echo 'Done'" EXIT
wait
