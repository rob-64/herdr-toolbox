#!/bin/sh
if command -v bun >/dev/null 2>&1; then
  echo "omo-toolbox: using bun $(bun --version)"
  exit 0
fi
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$major" -ge 18 ]; then
    echo "omo-toolbox: using node $(node --version)"
    exit 0
  fi
fi
echo "omo-toolbox: install bun (https://bun.sh) or node >= 18 first" >&2
exit 1
