#!/usr/bin/env bash
#
# One-click rollback.
#
#   ./scripts/rollback.sh                       # previous ACTIVE revision
#   ./scripts/rollback.sh <task-definition-arn> # explicit revision
#
# Environment: CLUSTER, SERVICE, optionally REGION.
#
# The previous revision is computed from the task definition family of the
# service's current revision, so it works even after several deploys.

set -euo pipefail

CLUSTER="${CLUSTER:?set CLUSTER}"
SERVICE="${SERVICE:?set SERVICE}"
REGION="${AWS_REGION:-af-south-1}"
TARGET="${1:-}"

command -v aws >/dev/null || { echo "awscli not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq not found" >&2; exit 1; }

current_arn="$(aws ecs describe-services \
  --cluster "${CLUSTER}" \
  --services "${SERVICE}" \
  --region "${REGION}" \
  --query 'services[0].taskDefinition' --output text)"

family="$(aws ecs describe-task-definition \
  --task-definition "${current_arn}" \
  --region "${REGION}" \
  --query 'taskDefinition.family' --output text)"

if [ -z "${TARGET}" ]; then
  echo "Resolving previous revision of ${family} (current: ${current_arn##*/})"

  TARGET="$(aws ecs list-task-definitions \
    --family-prefix "${family}" \
    --status ACTIVE \
    --sort DESC \
    --region "${REGION}" \
    --query 'taskDefinitionArns' --output json \
    | jq -r --arg current "${current_arn}" '[.[] | select(. != $current)] | .[0] // empty')"

  if [ -z "${TARGET}" ]; then
    echo "no previous revision found for ${family}" >&2
    exit 1
  fi
fi

echo "Rolling ${SERVICE} back to ${TARGET}"

aws ecs update-service \
  --cluster "${CLUSTER}" \
  --service "${SERVICE}" \
  --task-definition "${TARGET}" \
  --region "${REGION}" >/dev/null

echo "Waiting for service stability (this can take a few minutes)..."
aws ecs wait services-stable \
  --cluster "${CLUSTER}" \
  --services "${SERVICE}" \
  --region "${REGION}"

echo "Rollback complete: ${SERVICE} -> ${TARGET##*/}"
