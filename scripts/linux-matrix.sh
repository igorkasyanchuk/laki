#!/bin/bash
# The Linux AppImages (scripts/linux.sh builds them into dist/linux) on other distributions, in Docker under Xvfb: each
# one's stock image with the libraries a desktop install has, the AppImage extracted (a container has no FUSE) and
# scripts/pack-smoke.sh run against it; node for the test fakes is the build image's own (node:22's binary: glibc 2.28
# and up). Each one's result and screenshot in dist/linux/matrix/. MATRIX="ubuntu:24.04/arm64 debian:12/x64 …" picks.
# What a container can't show (a real machine's): AppArmor's user namespace rule (Ubuntu 23.10 and up: the sandbox),
# FUSE mounting the AppImage, a desktop's tray, notifications, Wayland, a GPU
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
V=$(node -p "require('$ROOT/package.json').version")
MATRIX=${MATRIX:-"ubuntu:24.04/arm64 ubuntu:24.04/x64 ubuntu:22.04/arm64 ubuntu:22.04/x64 debian:12/x64 fedora:40/x64"}
OUT=$ROOT/dist/linux/matrix
mkdir -p "$OUT"
fail=0
for m in $MATRIX; do
  img=${m%/*} arch=${m#*/}
  plat=linux/$([ "$arch" = x64 ] && echo amd64 || echo arm64)
  ai=$ROOT/dist/linux/Laki-$V-$([ "$arch" = x64 ] && echo x86_64 || echo arm64).AppImage
  [ -f "$ai" ] || { echo "no $ai: ARCH=$arch npm run pack:linux first"; exit 1; }
  node=$OUT/node-$arch
  [ -s "$node" ] || { docker run --rm --platform "$plat" "laki-linux-$arch" cat /usr/local/bin/node > "$node" && chmod +x "$node"; }
  case $img in
    fedora*) inst='dnf -y -q install git lsof procps-ng perl util-linux xorg-x11-server-Xvfb xorg-x11-xauth nss atk at-spi2-atk cups-libs libdrm gtk3 mesa-libgbm alsa-lib libXScrnSaver libxshmfence libxkbcommon libnotify > /dev/null' ;;
    *) inst='apt-get update -qq && a=$(apt-cache show libasound2t64 > /dev/null 2>&1 && echo libasound2t64 || echo libasound2) && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends git lsof procps perl bsdutils xvfb xauth libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgtk-3-0 libgbm1 $a libxss1 libxshmfence1 libxkbcommon0 libnotify4 > /dev/null' ;;
  esac
  tag=$(echo "$img-$arch" | tr ':/' '--')
  echo "--- $img ($arch)"
  if docker run --rm --platform "$plat" -v "$ROOT":/src:ro -v "$ai":/a/Laki.AppImage:ro -v "$node":/usr/local/bin/node:ro -v "$OUT":/out "$img" bash -c "
    set -e
    $inst
    echo \"\$(. /etc/os-release && echo \$PRETTY_NAME), glibc \$(ldd --version | head -1 | grep -o '[0-9.]*\$')\"
    cd /tmp && cp /a/Laki.AppImage . && printf '\\0\\0\\0' | dd of=Laki.AppImage bs=1 seek=8 count=3 conv=notrunc 2> /dev/null # AppImage's magic (AI 2 in the ELF header's padding) off the copy: binfmt's x86 emulation won't run it with it
    ./Laki.AppImage --appimage-extract > /dev/null
    miss=\$(ldd squashfs-root/laki | grep 'not found' || true); [ -z \"\$miss\" ] || { echo \"missing: \$miss\"; exit 1; }
    script -qec 'APP=/tmp/squashfs-root bash /src/scripts/pack-smoke.sh /tmp/laki-pack' /dev/null < /dev/null > /tmp/smoke.log 2>&1 || { tail -30 /tmp/smoke.log; exit 1; }
    tail -3 /tmp/smoke.log; cp /tmp/laki-pack/shot.png /out/shot-$tag.png
  " > "$OUT/$tag.log" 2>&1; then
    echo "ok: $(grep -m1 glibc "$OUT/$tag.log")"
  else
    echo "FAILED ($OUT/$tag.log):"; tail -15 "$OUT/$tag.log"; fail=1
  fi
done
exit $fail
