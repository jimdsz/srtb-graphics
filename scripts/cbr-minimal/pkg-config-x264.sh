#!/bin/bash
# Local recipe adapter, 2026-09-23. Implements only FFmpeg 5.1.4's x264 queries.
# This is not a general pkg-config replacement. Header and linker checks remain
# FFmpeg's responsibility and must actually succeed with the compiled library.
set -euo pipefail
[[ ${CBR_PREFIX:-} == /work/install ]] || exit 2
[[ $# -gt 0 ]] || exit 2
[[ $* != *$'\n'* ]] || exit 2
if [[ $# == 1 && $1 == --version ]]; then printf '%s\n' 'srtb-x264-only-1'; exit 0; fi
mode= package=
for argument in "$@"; do
  case "$argument" in
    --exists|--cflags|--libs|--variable=includedir)
      [[ -z $mode ]] || exit 2
      mode=$argument ;;
    --static|--print-errors) ;;
    x264) [[ -z $package ]] || exit 2; package=x264 ;;
    *) printf 'Unsupported pkg-config query: %s\n' "$argument" >&2; exit 2 ;;
  esac
done
[[ $package == x264 && -n $mode ]] || exit 2
for input in include/x264.h include/x264_config.h lib/libx264.a lib/pkgconfig/x264.pc; do
  [[ -s $CBR_PREFIX/$input ]] || { printf 'Missing compiled x264 input: %s\n' "$input" >&2; exit 1; }
done
case "$mode" in
  --exists) ;;
  --cflags) printf '%s\n' "-I$CBR_PREFIX/include" ;;
  --libs) printf '%s\n' "-L$CBR_PREFIX/lib -lx264 -lm" ;;
  --variable=includedir) printf '%s\n' "$CBR_PREFIX/include" ;;
esac
