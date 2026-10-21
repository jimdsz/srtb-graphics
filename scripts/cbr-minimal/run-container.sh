#!/bin/bash
# No pull, package installation, network, production mount or deployment.
set -euo pipefail
image=emscripten/emsdk@sha256:c1e807a6e03ac5bd5b37bae2ace3c46c08579e2ddeb951037a3b8dac7067f2cc
context=$(cd -- "$(dirname -- "$0")" && pwd -P)
[[ -f $context/SHA256SUMS && -f $context/sources.lock.json ]] || {
  printf 'Run node scripts/prepare-cbr-minimal.mjs --stage first.\n' >&2; exit 2;
}
(cd "$context" && sha256sum -c SHA256SUMS)
docker image inspect "$image" >/dev/null || {
  printf 'Pinned image is not local. No download was attempted.\n' >&2; exit 3;
}
[[ $(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image") == linux/amd64 ]] || exit 3
output="$(dirname -- "$context")/output"
# Refuse to overwrite an earlier build, including its provenance records.
mkdir -- "$output"
docker run --rm --pull=never --platform=linux/amd64 \
  --cidfile "$output/container.cid" --label srtb-cbr-minimal=qualification-only \
  --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --tmpfs /tmp:rw,exec,size=512m --tmpfs /work:rw,exec,size=6g \
  --mount "type=bind,src=$context,dst=/inputs,readonly" \
  --mount "type=bind,src=$output,dst=/output" \
  --entrypoint /bin/bash "$image" /inputs/build.sh 2>&1 | tee "$output/build.log"
