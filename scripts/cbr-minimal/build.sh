#!/bin/bash
# New minimal core recipe, authored 2026-09-23. Not the npm 0.12.10 recipe.
# Run only through run-container.sh, with verified inputs and no network.
set -euo pipefail
umask 022
export LC_ALL=C TZ=UTC SOURCE_DATE_EPOCH=1736244768
export CBR_PREFIX=/work/install
export EM_CACHE=/work/emscripten-cache
export CFLAGS="-O3 -msimd128 -I$CBR_PREFIX/include"
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-O3 -msimd128 -L$CBR_PREFIX/lib"
export FFMPEG_ST=yes
unset FFMPEG_MT
JOBS=${CBR_JOBS:-2}
[[ $JOBS =~ ^[1-8]$ ]] || { printf 'CBR_JOBS must be 1..8\n' >&2; exit 2; }
[[ -d /inputs && -d /output && ! -e /work/src ]] || exit 2
x264=/work/src/x264-33cac6b77d5b9259c552156013a817ab23119612
ffmpeg=/work/src/FFmpeg-4729204c17f756e186d622060088371d10b34f7e
bindings=/work/src/ffmpeg.wasm-71aa99d37c02a7b4c435275ca9ef50e612f6efa1
record_build() {
  result=$?
  trap - EXIT
  set +e
  mkdir -p /output/build-records
  printf '%s\n' "$result" > /output/build-records/exit-code.txt
  for input in config.h config_components.h ffbuild/config.mak ffbuild/config.log; do
    [[ ! -f $ffmpeg/$input ]] || cp "$ffmpeg/$input" /output/build-records/
  done
  [[ ! -f $x264/config.h ]] || cp "$x264/config.h" /output/build-records/x264-config.h
  [[ ! -f $x264/config.log ]] || cp "$x264/config.log" /output/build-records/x264-config.log
  [[ ! -f $x264/x264_config.h ]] || cp "$x264/x264_config.h" /output/build-records/x264-version.h
  [[ ! -f $CBR_PREFIX/lib/pkgconfig/x264.pc ]] || cp "$CBR_PREFIX/lib/pkgconfig/x264.pc" /output/build-records/x264.pc
  cp /inputs/sources.lock.json /inputs/SHA256SUMS /output/build-records/
  emcc --version > /output/build-records/emcc-version.txt
  node --version > /output/build-records/node-version.txt
  make --version > /output/build-records/make-version.txt
  # Hash the SDK sources and the actual cache (including compiled system libs)
  # available to this run. The pinned image identifies the full toolchain too.
  find /emsdk/upstream/emscripten/system /emsdk/upstream/emscripten/src -type f -print0 \
    | sort -z | xargs -0 sha256sum > /output/build-records/emscripten-runtime-inputs.sha256
  if [[ -d $EM_CACHE ]]; then
    find "$EM_CACHE" -type f -print0 | sort -z | xargs -0 -r sha256sum > /output/build-records/emscripten-cache.sha256
  fi
  for name in emcc emar emranlib emnm clang wasm-ld wasm-opt; do
    executable=$(command -v "$name")
    [[ -z $executable ]] || sha256sum "$executable"
    [[ -z $executable ]] || "$executable" --version > "/output/build-records/$name-version.txt" 2>&1
  done > /output/build-records/compiler-tools.sha256
  if [[ $result == 0 && -s /output/ffmpeg-core.js && -s /output/ffmpeg-core.wasm ]]; then
    (cd /output && sha256sum ffmpeg-core.js ffmpeg-core.wasm) > /output/build-records/artifacts.sha256
  fi
  exit "$result"
}
trap record_build EXIT
for tool in emcc em++ emconfigure emmake emar emnm emranlib make node python3 gcc \
  tar sha256sum install find sort xargs sed awk grep diff cp chmod; do command -v "$tool" >/dev/null; done
(cd /inputs && sha256sum -c SHA256SUMS)
version=$(emcc --version)
[[ $version == *3.1.40* && $version == *5c27e79dd0a9c4e27ef2326841698cdd4f6b5784* ]] || {
  printf 'Unexpected Emscripten compiler: %s\n' "$version" >&2; exit 2;
}
mkdir -p /work/src "$CBR_PREFIX" "$EM_CACHE"
# Cached standard libraries are inputs from the pinned image. Copy them to the
# ephemeral writable work area; no changes to the host or the SDK installation.
if [[ -d /emsdk/upstream/emscripten/cache ]]; then cp -a --no-preserve=ownership /emsdk/upstream/emscripten/cache/. "$EM_CACHE/"; fi
for archive in \
  FFmpeg--FFmpeg-4729204c17f756e186d622060088371d10b34f7e.tar.gz \
  ffmpegwasm--x264-33cac6b77d5b9259c552156013a817ab23119612.tar.gz \
  ffmpegwasm--ffmpeg.wasm-71aa99d37c02a7b4c435275ca9ef50e612f6efa1.tar.gz; do
  tar -xzf "/inputs/$archive" -C /work/src --no-same-owner
done
cp /inputs/pkg-config-x264.sh /work/pkg-config-x264
chmod 0755 /work/pkg-config-x264
cd "$x264"
emconfigure ./configure \
  --prefix="$CBR_PREFIX" --host=x86-gnu --enable-static \
  --disable-cli --disable-asm --disable-thread --disable-opencl \
  --bit-depth=8 --chroma-format=420 --extra-cflags="$CFLAGS"
emmake make install-lib-static -j"$JOBS"
cd "$ffmpeg"
emconfigure ./configure \
  --target-os=none --arch=x86_32 --enable-cross-compile \
  --disable-asm --disable-stripping --disable-programs --disable-doc \
  --disable-debug --disable-runtime-cpudetect --disable-autodetect \
  --disable-everything --disable-network --disable-avdevice \
  --disable-postproc --disable-swresample --disable-sdl2 --disable-iconv \
  --disable-pthreads --disable-w32threads --disable-os2threads \
  --enable-gpl --enable-libx264 --enable-decoder=h264 --enable-parser=h264 \
  --enable-encoder=libx264 --enable-demuxer=mov --enable-muxer=mp4 \
  --enable-protocol=file \
  --enable-filter=null,format,scale,trim,transpose,hflip,vflip,rotate \
  --nm=emnm --ar=emar --ranlib=emranlib --cc=emcc --cxx=em++ \
  --objcc=emcc --dep-cc=emcc --pkg-config=/work/pkg-config-x264 \
  --extra-cflags="$CFLAGS" --extra-cxxflags="$CXXFLAGS"
emmake make -j"$JOBS"
mkdir -p src/bind
cp -a "$bindings/src/bind/ffmpeg" src/bind/ffmpeg
cp -a "$bindings/src/fftools" src/fftools
# Keep the upstream binding contract, including ffprobe. No SDL2 port or
# WORKERFS is required by the product's MEMFS write/read/unlink protocol.
emcc -O3 -msimd128 -I. -Isrc/fftools -I"$CBR_PREFIX/include" \
  -L"$CBR_PREFIX/lib" -Llibavcodec -Llibavformat -Llibavfilter -Llibavutil -Llibswscale \
  -Wno-deprecated-declarations \
  -sENVIRONMENT=worker -sWASM_BIGINT -sMODULARIZE -sEXPORT_ES6 \
  -sEXPORT_NAME=createFFmpegCore -sINITIAL_MEMORY=32MB -sALLOW_MEMORY_GROWTH \
  "-sEXPORTED_FUNCTIONS=$(node src/bind/ffmpeg/export.js)" \
  "-sEXPORTED_RUNTIME_METHODS=$(node src/bind/ffmpeg/export-runtime.js)" \
  --pre-js src/bind/ffmpeg/bind.js \
  src/fftools/cmdutils.c src/fftools/ffmpeg.c src/fftools/ffmpeg_filter.c \
  src/fftools/ffmpeg_hw.c src/fftools/ffmpeg_mux.c src/fftools/ffmpeg_opt.c \
  src/fftools/opt_common.c src/fftools/ffprobe.c \
  -Wl,--start-group -lavcodec -lavformat -lavfilter -lavutil -lswscale -lx264 -Wl,--end-group -lm \
  -o /output/ffmpeg-core.js
printf '%s\n' 'NEW CORE BUILT, NOT QUALIFIED. RELEASE_BLOCKED.md MUST REMAIN.'
