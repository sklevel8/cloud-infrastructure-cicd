###############################################################################
# Production variables for af-south-1 (Cape Town).
#
#   terraform init -backend-config=backend.hcl
#   terraform apply -var-file=envs/prod.tfvars
#
# app_image is a bootstrap placeholder: the first pipeline run registers a task
# definition pointing at the real ECR image and updates the service. Afterwards
# Terraform ignores task_definition changes by design.
###############################################################################

aws_region  = "af-south-1"
project     = "sa-enterprise"
environment = "prod"

vpc_cidr                = "10.0.0.0/16"
availability_zone_count = 3
single_nat_gateway      = false

app_image  = "public.ecr.aws/docker/library/node:24-alpine"
app_port   = 3000
app_cpu    = 512
app_memory = 1024

desired_count = 2
min_capacity  = 2
max_capacity  = 10

# Set this to the ACM certificate ARN once DNS is delegated to Route 53.
# Leaving it empty serves plain HTTP - acceptable for a demo, never for prod.
certificate_arn   = ""
health_check_path = "/health"

db_instance_class        = "db.t4g.medium"
db_name                  = "app"
db_username              = "app_admin"
db_multi_az              = true
db_backup_retention_days = 30

redis_node_type = "cache.t4g.small"

log_retention_days          = 30
alarm_email                 = ""
alarm_5xx_threshold_percent = 5
alarm_cpu_threshold_percent = 85

github_repository  = "sklevel8/cloud-infra-cicd-pipeline"
create_github_oidc = true

# Filled in by scripts/bootstrap-aws.sh output.
terraform_state_bucket     = ""
terraform_state_lock_table = ""

# Enable once the first release is verified.
alb_deletion_protection = false
db_deletion_protection  = false
