#!/usr/bin/env bash
#
# Post-deployment smoke test. Fails the pipeline (which triggers rollback) if
# the service is not actually serving correct answers through the load balancer.
#
# Usage: ./scripts/smoke-test.sh https://api.example.com

set -euo pipefail

BASE_URL="${1:-${ALB_URL:-}}"
ATTEMPTS="${ATTEMPTS:-10}"
SLEEP_SECONDS="${SLEEP_SECONDS:-6}"

if [ -z "${BASE_URL}" ]; then
  echo "usage: $0 <base-url>" >&2
  exit 2
fi

BASE_URL="${BASE_URL%/}"
command -v curl >/dev/null || { echo "curl not found" >&2; exit 1; }

echo "Smoke testing ${BASE_URL}"

for attempt in $(seq 1 "${ATTEMPTS}"); do
  health_code="$(curl -s -o /tmp/health.json -w '%{http_code}' --max-time 10 "${BASE_URL}/health" || true)"
  ready_code="$(curl -s -o /tmp/ready.json -w '%{http_code}' --max-time 10 "${BASE_URL}/ready" || true)"

  echo "attempt ${attempt}/${ATTEMPTS}: /health=${health_code} /ready=${ready_code}"

  if [ "${health_code}" = "200" ] && [ "${ready_code}" = "200" ]; then
    if grep -q '"status":"ok"' /tmp/health.json && grep -q '"status":"ready"' /tmp/ready.json; then
      echo "smoke test passed"
      cat /tmp/health.json
      exit 0
    fi
    echo "unexpected response body"
    cat /tmp/health.json /tmp/ready.json
  fi

  sleep "${SLEEP_SECONDS}"
done

echo "smoke test failed after ${ATTEMPTS} attempts" >&2
exit 1
