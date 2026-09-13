#!/bin/bash
# Compiles every shaders/*.frag to the .qsb Qt Quick loads, with qsb from Qt's
# shader tools (qt6-shadertools). The .qsb files are generated: edit the .frag
# and run this. --check fails when a .qsb differs from what its .frag gives.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
qsb=$(command -v qsb || echo /usr/lib/qt6/bin/qsb)
[[ -x $qsb ]] || { echo "qsb not found (install qt6-shadertools)" >&2; exit 1; }

check=0
[[ ${1:-} == --check ]] && check=1

status=0
for frag in "$root"/shaders/*.frag; do
  out="$frag.qsb"
  tmp=$(mktemp)
  "$qsb" --glsl "100 es,120,150" --hlsl 50 --msl 12 -o "$tmp" "$frag"
  if (( check )); then
    if cmp -s "$tmp" "$out"; then
      echo "${out#"$root"/} is up to date"
    else
      echo "${out#"$root"/} is stale: run scripts/build-shaders.sh" >&2
      status=1
    fi
    rm -f "$tmp"
  else
    mv "$tmp" "$out"
    chmod 644 "$out"
    echo "wrote ${out#"$root"/}"
  fi
done
exit $status
