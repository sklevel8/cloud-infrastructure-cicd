###############################################################################
# PostgreSQL on RDS in the isolated subnet tier.
#
# publicly_accessible = false plus a security group that only accepts 5432 from
# the ECS task group is what satisfies the network isolation requirement.
###############################################################################

resource "aws_db_subnet_group" "this" {
  name        = "${local.name}-db"
  description = "Isolated subnets for ${local.name} PostgreSQL"
  subnet_ids  = aws_subnet.isolated[*].id

  tags = { Name = "${local.name}-db" }
}

resource "aws_db_parameter_group" "this" {
  name        = "${local.name}-pg16"
  family      = "postgres16"
  description = "Log slow queries so CloudWatch can surface them"

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  tags = { Name = "${local.name}-pg16" }
}

resource "aws_db_instance" "this" {
  identifier = "${local.name}-postgres"

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = 50
  max_allocated_storage = 200
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.data.id]
  parameter_group_name   = aws_db_parameter_group.this.name

  # No public endpoint, ever.
  publicly_accessible = false
  multi_az            = var.db_multi_az

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "23:00-23:30" # 01:00-01:30 SAST
  maintenance_window      = "sun:00:00-sun:00:30"
  copy_tags_to_snapshot   = true

  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  enabled_cloudwatch_logs_exports       = ["postgresql"]
  monitoring_interval                   = 0

  auto_minor_version_upgrade = true
  apply_immediately          = false

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-postgres-final"

  tags = { Name = "${local.name}-postgres" }

  lifecycle {
    # Password rotation is handled by Secrets Manager, not by Terraform diffs.
    ignore_changes = [password]
  }
}
