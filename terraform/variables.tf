variable "aws_region" {
  description = "AWS region. af-south-1 (Cape Town) keeps latency low for South African users."
  type        = string
  default     = "af-south-1"
}

variable "project" {
  description = "Short project slug used to name and tag every resource."
  type        = string
  default     = "sa-enterprise"
}

variable "environment" {
  description = "Deployment environment (prod, staging)."
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of AZs to spread the three subnet tiers across."
  type        = number
  default     = 3

  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 3
    error_message = "Use 2 or 3 AZs so the ALB and RDS satisfy the high availability requirement."
  }
}

variable "single_nat_gateway" {
  description = "Use one NAT gateway instead of one per AZ. Cheaper, but a single AZ failure breaks egress."
  type        = bool
  default     = false
}

variable "app_image" {
  description = "Full ECR image URI including tag. CI overrides this on every deploy."
  type        = string
}

variable "app_port" {
  description = "Container port the API listens on."
  type        = number
  default     = 3000
}

variable "app_cpu" {
  description = "Fargate task CPU units (512 = 0.5 vCPU)."
  type        = number
  default     = 512
}

variable "app_memory" {
  description = "Fargate task memory in MiB. Must be a valid CPU/memory pair."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Baseline number of running tasks. Autoscaling works upwards from here."
  type        = number
  default     = 2

  validation {
    condition     = var.desired_count >= 2
    error_message = "Keep at least 2 tasks so a rolling deployment never runs out of capacity."
  }
}

variable "min_capacity" {
  description = "Minimum task count for target tracking autoscaling."
  type        = number
  default     = 2
}

variable "max_capacity" {
  description = "Maximum task count for target tracking autoscaling."
  type        = number
  default     = 10
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener. Leave empty to serve HTTP only (not acceptable in production)."
  type        = string
  default     = ""
}

variable "health_check_path" {
  description = "ALB target group health check path."
  type        = string
  default     = "/health"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "app"
}

variable "db_username" {
  description = "Master username. The password is generated and stored in Secrets Manager."
  type        = string
  default     = "app_admin"
}

variable "db_multi_az" {
  description = "Run a synchronously replicated standby in a second AZ."
  type        = bool
  default     = true
}

variable "db_backup_retention_days" {
  description = "Automated snapshot retention. 30 days is the FICA-friendly default."
  type        = number
  default     = 30
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the API log group."
  type        = number
  default     = 30
}

variable "alarm_email" {
  description = "Optional email address subscribed to the SNS alert topic. Confirm the subscription after apply."
  type        = string
  default     = ""
}

variable "alarm_5xx_threshold_percent" {
  description = "Percentage of 5XX responses within one 5 minute window that triggers the alarm."
  type        = number
  default     = 5
}

variable "alarm_cpu_threshold_percent" {
  description = "ECS average CPU utilisation that triggers the alarm."
  type        = number
  default     = 85
}

variable "github_repository" {
  description = "owner/repo allowed to assume the deployment role via OIDC."
  type        = string
  default     = "sklevel8/cloud-infra-cicd-pipeline"
}

variable "create_github_oidc" {
  description = "Create the GitHub Actions OIDC provider and deploy role. Disable if the provider already exists in the account."
  type        = bool
  default     = true
}

variable "alb_deletion_protection" {
  description = "Refuse to delete the load balancer. Enable in production; leave false so teardown is not blocked."
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Refuse to delete the database. Enable in production; leave false for disposable environments."
  type        = bool
  default     = false
}

variable "terraform_state_bucket" {
  description = "S3 bucket holding Terraform state. When set, the GitHub role may read and write it for plan/apply jobs."
  type        = string
  default     = ""
}

variable "terraform_state_lock_table" {
  description = "DynamoDB table used for Terraform state locking."
  type        = string
  default     = ""
}
