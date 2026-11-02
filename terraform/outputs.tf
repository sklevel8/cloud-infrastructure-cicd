output "alb_dns_name" {
  description = "Public DNS name of the load balancer."
  value       = aws_lb.this.dns_name
}

output "alb_url" {
  description = "Base URL used by the post-deployment smoke test."
  value       = var.certificate_arn == "" ? "http://${aws_lb.this.dns_name}" : "https://${aws_lb.this.dns_name}"
}

output "ecr_repository_url" {
  description = "Registry prefix the pipeline pushes images to."
  value       = aws_ecr_repository.app.repository_url
}

output "ecr_repository_name" {
  description = "ECR repository name."
  value       = aws_ecr_repository.app.name
}

output "ecs_cluster_name" {
  description = "ECS cluster name, consumed by the deploy workflow."
  value       = aws_ecs_cluster.this.name
}

output "ecs_service_name" {
  description = "ECS service name, consumed by the deploy and rollback workflows."
  value       = aws_ecs_service.app.name
}

output "task_definition_family" {
  description = "Task definition family the pipeline registers new revisions under."
  value       = aws_ecs_task_definition.app.family
}

output "github_deploy_role_arn" {
  description = "Role ARN for aws-actions/configure-aws-credentials (OIDC)."
  value       = aws_iam_role.github_deploy.arn
}

output "alerts_topic_arn" {
  description = "SNS topic to attach to AWS Chatbot for Slack or Teams delivery."
  value       = aws_sns_topic.alerts.arn
}

output "log_group_name" {
  description = "CloudWatch log group for container logs."
  value       = aws_cloudwatch_log_group.app.name
}

output "database_endpoint" {
  description = "RDS endpoint (private, only reachable from the compute subnet)."
  value       = aws_db_instance.this.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "Redis primary endpoint (private)."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
  sensitive   = true
}
