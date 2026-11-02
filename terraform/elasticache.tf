###############################################################################
# ElastiCache Redis in the isolated subnet tier.
#
# Transit and at-rest encryption are both on, and the auth token lives in
# Secrets Manager. The application connects with rediss:// so credentials and
# payloads never cross the VPC in clear text.
###############################################################################

resource "aws_elasticache_subnet_group" "this" {
  name        = "${local.name}-redis"
  description = "Isolated subnets for ${local.name} Redis"
  subnet_ids  = aws_subnet.isolated[*].id

  tags = { Name = "${local.name}-redis" }
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "${local.name}-redis"
  description          = "Session and read cache for ${local.name}"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.redis_node_type
  port           = 6379

  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.data.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result

  snapshot_retention_limit = 7
  snapshot_window          = "22:00-23:00"
  maintenance_window       = "sun:03:00-sun:04:00"

  auto_minor_version_upgrade = true
  apply_immediately          = false

  tags = { Name = "${local.name}-redis" }

  lifecycle {
    ignore_changes = [auth_token]
  }
}
