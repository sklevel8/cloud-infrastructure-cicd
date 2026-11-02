###############################################################################
# IAM
#   * ECS execution role  - pulls the image, reads the two secrets, writes logs
#   * ECS task role       - the application's own AWS identity (least privilege)
#   * GitHub deploy role  - assumed by Actions via OIDC, no long lived keys
###############################################################################

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name                 = "${local.name}-ecs-execution"
  description          = "Allows ECS to pull images, resolve secrets and ship logs"
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_assume.json
  max_session_duration = 3600

  tags = { Name = "${local.name}-ecs-execution" }
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_secrets" {
  statement {
    sid       = "ReadRuntimeSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.database_url.arn, aws_secretsmanager_secret.redis_url.arn]
  }

  statement {
    sid       = "DecryptSecretVersions"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name   = "read-runtime-secrets"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_secrets.json
}

# The application currently talks to Postgres and Redis on the VPC, so it needs
# no AWS API permissions at all. The role exists so that any future integration
# (S3 uploads, SQS consumers) gets a scoped policy instead of reusing the
# execution role.
resource "aws_iam_role" "ecs_task" {
  name                 = "${local.name}-ecs-task"
  description          = "Runtime identity for the application container"
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_assume.json
  max_session_duration = 3600

  tags = { Name = "${local.name}-ecs-task" }
}

# ECS Exec needs the task role to open the SSM data channel. The API only
# grants it when an engineer runs `aws ecs execute-command`.
data "aws_iam_policy_document" "ecs_exec" {
  statement {
    sid = "EcsExec"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ecs_exec" {
  name   = "ecs-exec"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_exec.json
}

###############################################################################
# GitHub Actions OIDC. Short lived credentials replace long lived access keys.
###############################################################################

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = { Name = "${local.name}-github-oidc" }
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc ? 0 : 1
  arn   = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
}

locals {
  github_oidc_arn = var.create_github_oidc ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn

  # Only this repository, only from main (deploy) or PRs (plan) can mint tokens.
  github_subjects = [
    "repo:${var.github_repository}:ref:refs/heads/main",
    "repo:${var.github_repository}:pull_request",
    "repo:${var.github_repository}:environment:production",
  ]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    sid     = "GitHubActionsOIDC"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.github_subjects
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "${local.name}-github-deploy"
  description          = "Assumed by GitHub Actions to push images and update the ECS service"
  assume_role_policy   = data.aws_iam_policy_document.github_assume.json
  max_session_duration = 3600

  tags = { Name = "${local.name}-github-deploy" }
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPushPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [aws_ecr_repository.app.arn]
  }

  statement {
    sid = "EcsDeploy"
    actions = [
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "ecs:DescribeTasks",
      "ecs:ListTasks",
      "ecs:RegisterTaskDefinition",
      "ecs:UpdateService",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "PassTaskRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.ecs_execution.arn, aws_iam_role.ecs_task.arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  dynamic "statement" {
    for_each = var.terraform_state_bucket == "" ? [] : [var.terraform_state_bucket]

    content {
      sid       = "TerraformStateBucket"
      actions   = ["s3:ListBucket", "s3:GetObject", "s3:PutObject"]
      resources = ["arn:${data.aws_partition.current.partition}:s3:::${statement.value}", "arn:${data.aws_partition.current.partition}:s3:::${statement.value}/*"]
    }
  }

  dynamic "statement" {
    for_each = var.terraform_state_lock_table == "" ? [] : [var.terraform_state_lock_table]

    content {
      sid       = "TerraformStateLock"
      actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:DescribeTable"]
      resources = ["arn:${data.aws_partition.current.partition}:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${statement.value}"]
    }
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy-pipeline"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
