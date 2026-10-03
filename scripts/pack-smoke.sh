#!/bin/bash
# Smoke test of the packaged app: its daemon and CLI run as node from inside Laki Electron.app (Electron's node,
# node-pty from the bundle), fake agents report through the bundled hook command, then the app window
# connects (file:// origin) and captures a screenshot. Temp home; nothing real is touched.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP="$ROOT/dist/mac-arm64/Laki Electron.app"
BIN="$APP/Contents/MacOS/Laki Electron"
RES="$APP/Contents/Resources/app/out/main"
H=${1:-/tmp/laki-electron-pack}
NODE_DIR=$(dirname "$(node -p process.execPath)") # before HOME moves (version managers)
rm -rf "$H" && mkdir -p "$H/repo"
export HOME=$H LAKI_ELECTRON_HOME=$H/data FAKE_LOG=$H/fake.log FAKE_TURN_MS=1500 SHELL=$ROOT/test/fakes/tsh
export PATH=$ROOT/test/fakes:$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
cd "$H/repo" && git init -q -b main && echo hi > README.md && echo '{"setup":"echo setup-ran"}' > .laki.json && git add -A && git commit -qm init
laki-electron() { ELECTRON_RUN_AS_NODE=1 "$BIN" "$RES/cli.js" "$@"; }
ELECTRON_RUN_AS_NODE=1 "$BIN" "$RES/daemon.js" > "$H/daemon.out" 2>&1 &
for i in $(seq 50); do [ -f "$LAKI_ELECTRON_HOME/daemon.json" ] && break; sleep 0.1; done
laki-electron project add "$H/repo"
laki-electron new repo --preset claude --name packed --prompt "hello from the bundle"
for i in $(seq 100); do laki-electron ls | grep -q "○● claude" && break; sleep 0.1; done
laki-electron ls
echo "--- hook command:"; grep -o '"command": "[^"]*hook idle' "$LAKI_ELECTRON_HOME/claude-settings.json"
echo "--- screen:"; laki-electron screen packed
LAKI_ELECTRON_CAPTURE=$H/shot.png LAKI_ELECTRON_NOTIFY_LOG=$H/notify.log "$BIN" > "$H/app.out" 2>&1 &
APP_PID=$!
for i in $(seq 100); do [ -f "$H/shot.png" ] && break; sleep 0.1; done
# a turn that ends in a workspace the window doesn't show: the app posts a notification
laki-electron new repo --preset claude --name other --prompt "background work" > /dev/null
for i in $(seq 100); do [ -s "$H/notify.log" ] && break; sleep 0.1; done
echo "--- notifications:"; cat "$H/notify.log"
sleep 0.5; kill $APP_PID || true; laki-electron stop
grep -i refused "$H/daemon.out" || echo "no refused connections"
ls -la "$H/shot.png"
