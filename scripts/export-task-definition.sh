#!/usr/bin/env bash
#
# Exports the service's live task definition into deploy/task-definition.json.
#
# The AWS-provided render action expects a clean task definition document, so
# the read-only fields that describe a registered revision are stripped. The
# pipeline runs this before every deploy: the running revision stays the single
# source of truth and Terraform never has to be applied just to change an image.

set -euo pipefail

CLUSTER="${CLUSTER:?set CLUSTER}"
SERVICE="${SERVICE:?set SERVICE}"
REGION="${AWS_REGION:-af-south-1}"
OUTPUT="${1:-deploy/task-definition.json}"

command -v aws >/dev/null || { echo "awscli not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq not found" >&2; exit 1; }

mkdir -p "$(dirname "${OUTPUT}")"

task_definition_arn="$(aws ecs describe-services \
  --cluster "${CLUSTER}" \
  --services "${SERVICE}" \
  --region "${REGION}" \
  --query 'services[0].taskDefinition' --output text)"

if [ -z "${task_definition_arn}" ] || [ "${task_definition_arn}" = "None" ]; then
  echo "service ${SERVICE} has no task definition yet" >&2
  exit 1
fi

aws ecs describe-task-definition \
  --task-definition "${task_definition_arn}" \
  --region "${REGION}" \
  --query 'taskDefinition' \
  | jq 'del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)' \
  > "${OUTPUT}"

echo "wrote ${OUTPUT} from ${task_definition_arn##*/}"
