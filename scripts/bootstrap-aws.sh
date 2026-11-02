#!/usr/bin/env bash
#
# One-time bootstrap for a fresh AWS account:
#   1. creates the encrypted S3 bucket + DynamoDB table that hold Terraform state
#   2. writes terraform/backend.hcl
#   3. runs terraform init
#
# Requirements: awscli v2 (authenticated), terraform >= 1.7
#
# Usage: AWS_PROFILE=my-profile ./scripts/bootstrap-aws.sh

set -euo pipefail

REGION="${AWS_REGION:-af-south-1}"
PROJECT="${PROJECT:-sa-enterprise}"
ENV="${ENV:-prod}"

command -v aws >/dev/null || { echo "awscli not found" >&2; exit 1; }
command -v terraform >/dev/null || { echo "terraform not found" >&2; exit 1; }

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${PROJECT}-terraform-state-${ACCOUNT_ID}"
TABLE="${PROJECT}-terraform-locks"

echo "==> Account ${ACCOUNT_ID}, region ${REGION}"

if aws s3api head-bucket --bucket "${BUCKET}" 2>/dev/null; then
  echo "==> State bucket ${BUCKET} already exists"
else
  echo "==> Creating state bucket ${BUCKET}"
  if [ "${REGION}" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "${BUCKET}" --region "${REGION}" >/dev/null
  else
    aws s3api create-bucket --bucket "${BUCKET}" --region "${REGION}" \
      --create-bucket-configuration LocationConstraint="${REGION}" >/dev/null
  fi

  aws s3api put-bucket-versioning --bucket "${BUCKET}" --versioning-configuration Status=Enabled
  aws s3api put-bucket-encryption --bucket "${BUCKET}" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  aws s3api put-public-access-block --bucket "${BUCKET}" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
fi

if aws dynamodb describe-table --table-name "${TABLE}" --region "${REGION}" >/dev/null 2>&1; then
  echo "==> Lock table ${TABLE} already exists"
else
  echo "==> Creating lock table ${TABLE}"
  aws dynamodb create-table \
    --table-name "${TABLE}" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "${REGION}" >/dev/null

  aws dynamodb wait table-exists --table-name "${TABLE}" --region "${REGION}"
fi

cat > terraform/backend.hcl <<EOF
bucket         = "${BUCKET}"
key            = "cloud-infra-cicd/${ENV}/terraform.tfstate"
region         = "${REGION}"
dynamodb_table = "${TABLE}"
encrypt        = true
EOF

echo "==> Wrote terraform/backend.hcl"
echo "==> Next: cd terraform && terraform init -backend-config=backend.hcl"
echo "==> Then add these to envs/${ENV}.tfvars:"
echo "    terraform_state_bucket     = \"${BUCKET}\""
echo "    terraform_state_lock_table = \"${TABLE}\""
