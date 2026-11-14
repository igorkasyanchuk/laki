#!/bin/bash
# Smoke test of the packaged app: its daemon and CLI run as node on Laki Node inside Laki.app (Electron's node,
# node-pty from the bundle), the app's own binary doesn't (its runAsNode fuse is off), fake agents report through the
# bundled hook command, then the app window connects (app://laki origin) and captures a screenshot. Temp home; nothing
# real is touched.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
if [ "$(uname)" = Linux ]; then # a display from Xvfb; Chromium's sandbox wants a setuid helper or user namespaces
  APP=${APP:-$ROOT/dist/$([ "$(uname -m)" = aarch64 ] && echo linux-arm64-unpacked || echo linux-unpacked)}
  BIN="$APP/laki" NODEBIN="$APP/laki-node" RES="$APP/resources/app/out/main" X="xvfb-run -a" NOSB=--no-sandbox
else
  APP=${APP:-$ROOT/dist/$([ "$(uname -m)" = arm64 ] && echo mac-arm64 || echo mac)/Laki.app} # APP=…/dist/mac/Laki.app: the Intel build, under Rosetta
  BIN="$APP/Contents/MacOS/Laki" NODEBIN="$APP/Contents/Frameworks/Laki Node.app/Contents/MacOS/Laki Node" RES="$APP/Contents/Resources/app/out/main"
fi
H=${1:-/tmp/laki-pack}
NODE_DIR=$(dirname "$(node -p process.execPath)") # before HOME moves (version managers)
rm -rf "$H" && mkdir -p "$H/repo"
export HOME=$H LAKI_HOME=$H/data FAKE_LOG=$H/fake.log FAKE_TURN_MS=1500 SHELL=$ROOT/test/fakes/tsh
export PATH=$ROOT/test/fakes:$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
cd "$H/repo" && git init -q -b main && echo hi > README.md && echo '{"setup":"echo setup-ran"}' > .laki.json && git add -A && git commit -qm init
# docs/dev/helper.md: the app's binary runs no JavaScript as node (an old launcher's call ends at once, with a word,
# never as a window: perl's alarm if it did), Laki Node does
OUT=$(ELECTRON_RUN_AS_NODE=1 perl -e 'alarm 20; exec @ARGV' "$BIN" -e 'console.log("ran" + "-as-node")' 2>&1 || true)
case $OUT in *ran-as-node*) echo "the app's binary still runs JavaScript as node (the runAsNode fuse is on)"; exit 1 ;; esac
[ "$(uname)" = Linux ] || case $OUT in *"doesn't run scripts"*) ;; *) echo "the app's binary as node didn't end with its word: $OUT"; exit 1 ;; esac
[ "$(ELECTRON_RUN_AS_NODE=1 "$NODEBIN" -e 'console.log("ran" + "-as-node")')" = ran-as-node ] || { echo "Laki Node doesn't run as node: $NODEBIN"; exit 1; }
echo "the app's binary runs no JavaScript as node; Laki Node does"
# the talk key's on-device engine (native/laki-speech.swift): built in by after-pack when swiftc was there
if [ "$(uname)" = Darwin ]; then
  SPEECH="$APP/Contents/MacOS/laki-speech"
  if [ -x "$SPEECH" ]; then
    "$SPEECH" --version 2>/dev/null | grep -q '"version"' || { echo "laki-speech doesn't print its version: $SPEECH"; exit 1; }
    echo "laki-speech: $("$SPEECH" --version 2>/dev/null)"
  else
    echo "laki-speech: not in this build (no swiftc at pack): the talk key has Cloud only"
  fi
fi
laki() { ELECTRON_RUN_AS_NODE=1 "$NODEBIN" "$RES/cli.js" "$@"; }
ELECTRON_RUN_AS_NODE=1 "$NODEBIN" "$RES/daemon.js" > "$H/daemon.out" 2>&1 &
APP_PID=
trap 'kill $APP_PID 2> /dev/null; laki stop > /dev/null 2>&1' EXIT # a failed step (set -e) leaves no window or daemon behind: a running one stops the next release at its preflight
for i in $(seq 50); do [ -f "$LAKI_HOME/daemon.json" ] && break; sleep 0.1; done
laki project add "$H/repo"
laki new repo --preset claude --name packed --prompt "hello from the bundle"
for i in $(seq 100); do laki ls | grep -q "○● claude" && break; sleep 0.1; done
laki ls
echo "--- hook command:"; grep -o '"command": "[^"]*hook idle' "$LAKI_HOME/claude-settings.json"
# docs/dev/helper.md: the hook on Laki Node, with a bundle id of its own (macOS), and how long a hook takes to start
grep -q "${NODEBIN#$APP/}" "$LAKI_HOME/claude-settings.json" || { echo "the hook doesn't run on Laki Node"; exit 1; }
if [ "$(uname)" != Linux ]; then
  [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Frameworks/Laki Node.app/Contents/Info.plist")" != "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" ] || { echo 'Laki Node has the app'"'"'s bundle id'; exit 1; }
  codesign --verify --deep --strict "$APP" || { echo "the app's signature doesn't verify"; exit 1; }
fi
node -e 'const { spawnSync } = require("node:child_process"); const ms = []; for (let i = 0; i < 10; i++) { const s = process.hrtime.bigint(); const r = spawnSync(process.argv[1], [process.argv[2], "hook", "ping"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }); if (r.status !== 0) throw new Error("hook ping: exit " + r.status); ms.push(Number(process.hrtime.bigint() - s) / 1e6) } console.log(`--- hook start on Laki Node, ms (10 runs, the median): ${ms.sort((a, b) => a - b)[5].toFixed(0)}`)' "$NODEBIN" "$RES/hook.js"
echo "--- screen:"; laki screen packed
# its own userData: Laki open on this Mac would hold the single-instance lock (the app would quit at once)
$X "$BIN" $NOSB --user-data-dir="$H/userdata" --laki-capture="$H/shot.png" --laki-notify-log="$H/notify.log" > "$H/app.out" 2>&1 &
APP_PID=$!
for i in $(seq 100); do [ -f "$H/shot.png" ] && break; sleep 0.1; done
# an agent that asks in a workspace the window doesn't show: the app posts a notification (a finished turn doesn't on a
# new install, as this one is: core's NEW_DEFAULTS)
laki new repo --preset claude --name other --prompt "menu" > /dev/null
for i in $(seq 100); do [ -s "$H/notify.log" ] && break; sleep 0.1; done
echo "--- notifications:"; cat "$H/notify.log"
sleep 0.5
grep -i refused "$H/daemon.out" || echo "no refused connections"
# About's licenses: a bundled package (react) and a shipped one (ws, npm ls's)
NOTICES=$RES/../renderer/THIRD_PARTY_NOTICES.txt
grep -q '^react@' "$NOTICES" && grep -q '^ws@' "$NOTICES" || { echo "no license notices in the app: $NOTICES"; exit 1; }
echo "license notices in the app"
ls -la "$H/shot.png"
