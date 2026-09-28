#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --test --test-reporter=spec \
  --experimental-test-coverage \
  --test-coverage-include='src/**/*.ts' \
  --test-coverage-exclude='src/adapters/inbound/pi/entry/**' \
  --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 \
  "tests/unit/**/*.test.ts" "tests/architecture/*.test.ts"
