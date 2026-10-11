#!/bin/bash
# The Linux build, in Docker (npm ci there gets node-pty's Linux binary): an AppImage in dist/linux, then the tests and
# scripts/pack-smoke.sh against it under Xvfb (the window's screenshot: dist/linux/shot.png). ARCH=x64 for Intel/AMD
# (emulated on Apple silicon: slow); TESTS=0 skips the tests.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ARCH=${ARCH:-$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')}
PLAT=linux/$([ "$ARCH" = x64 ] && echo amd64 || echo arm64)
docker build -q --platform "$PLAT" -t "laki-linux-$ARCH" - > /dev/null <<'EOF'
FROM node:22-trixie
RUN apt-get update && apt-get install -y --no-install-recommends git jq lsof procps xvfb xauth libnss3 libatk1.0-0 \
    libatk-bridge2.0-0 libcups2 libdrm2 libgtk-3-0 libgbm1 libasound2t64 libxss1 libxshmfence1 libxkbcommon0 libnotify4 \
  && rm -rf /var/lib/apt/lists/* && useradd -m t
EOF
mkdir -p "$ROOT/dist/linux"
docker run --rm --platform "$PLAT" -e TESTS -v "$ROOT":/src:ro -v "$ROOT/dist/linux":/out -v "laki-npm-$ARCH":/root/.npm \
  -v "laki-cache-$ARCH":/root/.cache "laki-linux-$ARCH" bash -c '
set -e
mkdir /w && cd /src && tar --exclude=./node_modules --exclude=./out --exclude=./dist --exclude=./.git -cf - . | tar xf - -C /w
cd /w && npm ci --no-audit --no-fund --loglevel=error > /dev/null && npx electron-vite build > /dev/null
npx electron-builder --linux AppImage --'$ARCH' 2>&1 | grep -E "building|error" || true
cp dist/*.AppImage /out/
echo "--- smoke test"; bash scripts/pack-smoke.sh /tmp/laki-pack; cp /tmp/laki-pack/shot.png /out/
[ "$TESTS" = 0 ] && exit
echo "--- tests (dist/linux/test.log)"; chown -R t /w; r=0; su t -c "npm test" > /out/test.log 2>&1 || r=$?
grep -E "^# (tests|pass|fail) |^not ok" /out/test.log; exit $r
'
ls -la "$ROOT/dist/linux"
