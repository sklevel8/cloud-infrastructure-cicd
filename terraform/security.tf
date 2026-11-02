###############################################################################
# Security groups. Each tier only accepts traffic from the tier in front of it.
#   internet -> ALB -> ECS tasks -> RDS / ElastiCache
###############################################################################

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public entrypoint: HTTP/HTTPS from the internet"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP (redirected to HTTPS when a certificate is configured)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from the internet"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward traffic to the application tasks only"
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
}

resource "aws_security_group" "app" {
  name        = "${local.name}-app"
  description = "ECS Fargate tasks: inbound from the ALB only"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name}-app" }
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "Application traffic from the load balancer"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
}

# Egress is limited to what the task actually needs: DNS, HTTPS to AWS APIs and
# third parties via NAT, and the two data-tier ports.
resource "aws_vpc_security_group_egress_rule" "app_dns_udp" {
  security_group_id = aws_security_group.app.id
  description       = "DNS resolution inside the VPC"
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
}

resource "aws_vpc_security_group_egress_rule" "app_dns_tcp" {
  security_group_id = aws_security_group.app.id
  description       = "DNS resolution over TCP"
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
}

resource "aws_vpc_security_group_egress_rule" "app_https" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound HTTPS for AWS APIs and third party integrations"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "app_to_db" {
  security_group_id            = aws_security_group.app.id
  description                  = "PostgreSQL to the data tier"
  referenced_security_group_id = aws_security_group.data.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "app_to_cache" {
  security_group_id            = aws_security_group.app.id
  description                  = "Redis to the data tier"
  referenced_security_group_id = aws_security_group.data.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

resource "aws_security_group" "data" {
  name        = "${local.name}-data"
  description = "RDS and ElastiCache: reachable from the application tier only"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name}-data" }
}

resource "aws_vpc_security_group_ingress_rule" "data_postgres" {
  security_group_id            = aws_security_group.data.id
  description                  = "PostgreSQL from ECS tasks"
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "data_redis" {
  security_group_id            = aws_security_group.data.id
  description                  = "Redis from ECS tasks"
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

# No egress rules: responses to established connections are allowed by the
# stateful nature of security groups, but the data tier cannot initiate traffic.
