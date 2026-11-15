#!/bin/sh
# Starts a fresh test server, runs the browser test, stops the server.
cd "$(dirname "$0")/.." && mkdir -p /tmp/shots
node tests/server.js 8787 > /tmp/server.log 2>&1 & PID=$!
sleep 1; python3 tests/e2e.py; R=$?; kill $PID; exit $R
