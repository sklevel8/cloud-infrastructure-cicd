locals {
  name = "${var.project}-${var.environment}"

  azs = slice(data.aws_availability_zones.available.names, 0, var.availability_zone_count)

  # Three tiers, one /24 block each, per AZ.
  public_subnet_cidrs   = [for i in range(var.availability_zone_count) : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnet_cidrs  = [for i in range(var.availability_zone_count) : cidrsubnet(var.vpc_cidr, 8, i + 10)]
  isolated_subnet_cidrs = [for i in range(var.availability_zone_count) : cidrsubnet(var.vpc_cidr, 8, i + 20)]

  nat_gateway_count = var.single_nat_gateway ? 1 : var.availability_zone_count

  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = var.github_repository
  }

  # Container environment. Credentials are injected as secrets, never here.
  container_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = tostring(var.app_port) },
    { name = "SERVICE_NAME", value = "${local.name}-api" },
    { name = "APP_VERSION", value = "1.0.0" },
    { name = "DATABASE_SSL", value = "true" },
    { name = "LOG_LEVEL", value = var.environment == "prod" ? "info" : "debug" },
  ]

  container_secrets = [
    { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
    { name = "REDIS_URL", valueFrom = aws_secretsmanager_secret.redis_url.arn },
  ]
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}
