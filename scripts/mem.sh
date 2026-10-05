#!/bin/bash
# Memory with 3 workspaces x 2 tabs (fake claude + shell): the packaged app starts its daemon itself.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP=${APP:-$ROOT/dist/$([ "$(uname -m)" = arm64 ] && echo mac-arm64 || echo mac)/Laki.app} # APP=…/dist/mac/Laki.app: the Intel build, under Rosetta
BIN="$APP/Contents/MacOS/Laki"
NODE_DIR=$(dirname "$(node -p process.execPath)")
H=${1:-/tmp/laki-mem}
rm -rf "$H" && mkdir -p "$H/repo"
export HOME=$H LAKI_HOME=$H/data SHELL=$ROOT/test/fakes/tsh FAKE_LOG=$H/fake.log
export PATH=$ROOT/test/fakes:$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
cd "$H/repo" && git init -q -b main && echo hi > README.md && git add -A && git commit -qm init
laki() { ELECTRON_RUN_AS_NODE=1 "$BIN" "$APP/Contents/Resources/app/out/main/cli.js" "$@"; }
"$BIN" > "$H/app.out" 2>&1 &
APP_PID=$!
for i in $(seq 100); do [ -f "$LAKI_HOME/daemon.json" ] && break; sleep 0.1; done
sleep 1
laki project add "$H/repo" > /dev/null
for n in one two three; do laki new repo --name $n --preset claude --prompt "task $n" > /dev/null; laki tab $n > /dev/null; done
sleep 6
DPID=$(python3 -c "import json; print(json.load(open('$LAKI_HOME/daemon.json'))['pid'])")
rss() { ps -o rss= -p "$1" | awk '{printf "%.1f", $1/1024}'; }
echo "daemon (Electron as node, pid $DPID): $(rss $DPID) MB"
total=0
for p in $(pgrep -f "$APP/Contents" | grep -v "^$DPID$"); do
  kind=$(ps -o command= -p $p | sed -E 's/.*--type=([a-z-]+).*/\1/; s/.*MacOS\/Laki.*/main/' | cut -c1-20)
  echo "electron $kind (pid $p): $(rss $p) MB"
done
echo "agents/shells under the daemon (fake claude = node):"
# each tab: the login shell the daemon spawns, and what it runs
for c in $(pgrep -P $DPID); do
  for p in $c $(pgrep -P $c); do echo "  $(ps -o rss=,command= -p $p | awk '{printf "%.1f MB  %s %s", $1/1024, $2, $3}')"; done
done
laki ls
kill $APP_PID || true; laki stop
