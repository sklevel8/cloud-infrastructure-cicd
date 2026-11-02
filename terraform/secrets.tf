###############################################################################
# Secrets. Nothing in this repository contains a credential: Terraform
# generates the passwords, stores them in Secrets Manager, and ECS injects them
# into the container at runtime through the execution role.
###############################################################################

resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>?"
}

# ElastiCache auth tokens accept a narrower character set than RDS passwords.
resource "random_password" "redis" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.name}/database-url"
  description             = "PostgreSQL connection string for ${local.name}"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0

  tags = { Name = "${local.name}-database-url" }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgres://%s:%s@%s:%d/%s?sslmode=require",
    var.db_username,
    urlencode(random_password.db.result),
    aws_db_instance.this.address,
    aws_db_instance.this.port,
    var.db_name,
  )

  depends_on = [aws_db_instance.this]
}

resource "aws_secretsmanager_secret" "redis_url" {
  name                    = "${local.name}/redis-url"
  description             = "Redis (TLS) connection string for ${local.name}"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0

  tags = { Name = "${local.name}-redis-url" }
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id = aws_secretsmanager_secret.redis_url.id
  secret_string = format(
    "rediss://:%s@%s:%d",
    urlencode(random_password.redis.result),
    aws_elasticache_replication_group.this.primary_endpoint_address,
    aws_elasticache_replication_group.this.port,
  )

  depends_on = [aws_elasticache_replication_group.this]
}
