###############################################################################
# ECS Fargate service.
#
# Rolling deployment settings are the zero-downtime contract:
#   minimum_healthy_percent = 100  -> never remove capacity before new tasks pass
#   maximum_percent         = 200  -> run new and old tasks side by side
#   circuit breaker         = true -> failed deployments roll back automatically
#   stopTimeout             = 30   -> matches the app's graceful shutdown budget
###############################################################################

resource "aws_ecs_cluster" "this" {
  name = "${local.name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  configuration {
    execute_command_configuration {
      logging = "OVERRIDE"

      log_configuration {
        cloud_watch_log_group_name = aws_cloudwatch_log_group.app.name
      }
    }
  }

  tags = { Name = "${local.name}-cluster" }
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}/api"
  retention_in_days = var.log_retention_days

  tags = { Name = "${local.name}-api-logs" }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.app_cpu
  memory                   = var.app_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "api-container"
      image     = var.app_image
      essential = true

      portMappings = [
        {
          containerPort = var.app_port
          hostPort      = var.app_port
          protocol      = "tcp"
        }
      ]

      environment = local.container_environment
      secrets     = local.container_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }

      # Give the app the same 30s it allows itself for graceful shutdown.
      stopTimeout = 30

      linuxParameters = {
        initProcessEnabled = true
      }
    }
  ])

  tags = { Name = "${local.name}-api" }
}

resource "aws_ecs_service" "app" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  platform_version = "LATEST"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 30
  enable_execute_command             = true
  propagate_tags                     = "SERVICE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "api-container"
    container_port   = var.app_port
  }

  depends_on = [
    aws_lb_listener.http,
    aws_iam_role_policy.ecs_execution_secrets,
  ]

  lifecycle {
    # The pipeline owns the running revision; Terraform owns the shape.
    # Without this, every `terraform apply` would silently roll production back.
    ignore_changes = [task_definition, desired_count]
  }

  tags = { Name = "${local.name}-api" }
}
