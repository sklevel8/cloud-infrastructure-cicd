# Software Requirements Specification (SRS)

**Project:** Cloud Infrastructure & CI/CD Pipeline (Project #4)
**Role:** Business Analyst
**Status:** Approved baseline for v1.0.0
**Region:** AWS `af-south-1` (Cape Town)

---

## 1. Purpose and scope

South African banks, insurers and telecommunications operators are migrating workloads off
on-premise server estates that are deployed by hand, drift between environments, and cannot be
reproduced after an incident. This project delivers the delivery platform such a migration needs:
infrastructure defined in code, applications shipped as immutable containers, deployments that
never drop a request, and a rollback path that a release manager can execute under pressure.

In scope:

- Terraform-provisioned AWS environment (network, compute, database, cache, registry, monitoring)
- Containerised application service with health, readiness and metrics endpoints
- GitHub Actions pipeline: continuous integration, image build, rolling deployment, rollback
- Operational documentation: runbook, release notes, maintenance log

Out of scope for v1.0.0: multi-region active/active, service mesh, Kubernetes, customer-facing DNS
delegation, and application domain features beyond the reference `items` resource.

---

## 2. Functional requirements

| ID | Requirement | Priority | Verification |
| --- | --- | --- | --- |
| FR-01 | All cloud resources are provisioned by Terraform; no console-created infrastructure is required for a working environment | Must | `terraform apply` on a clean account; second `plan` is empty |
| FR-02 | Application services are packaged as immutable Docker images | Must | ECR tag immutability enabled; deployed tag equals Git SHA |
| FR-03 | A merge to `main` runs tests, builds the image, pushes to ECR and deploys to ECS without manual steps | Must | `deploy.yml` run record |
| FR-04 | A one-click rollback restores the previous stable image | Must | `rollback.yml` + `scripts/rollback.sh` |
| FR-05 | A failed deployment rolls back automatically, without human intervention | Must | ECS circuit breaker + post-deploy smoke test gate |
| FR-06 | The API exposes liveness, readiness and metrics endpoints | Must | `test/app.test.js` |
| FR-07 | Pull requests run unit tests, linting, dependency audit, image scan and Terraform validation before merge | Must | `ci.yml` required status checks |
| FR-08 | Terraform state is stored remotely with locking and encryption | Must | S3 + DynamoDB backend; `bootstrap-aws.sh` |
| FR-09 | The service scales horizontally on CPU and request rate | Should | Target tracking policies, `autoscaling.tf` |
| FR-10 | Operators can open a shell in a running task for diagnosis | Could | ECS Exec enabled with scoped SSM permissions |

---

## 3. Security and compliance requirements

| ID | Requirement | Implementation |
| --- | --- | --- |
| SR-01 | No credential, key or connection string may exist in source control | Generated at apply time, stored in Secrets Manager, injected at runtime |
| SR-02 | The pipeline must not use long-lived AWS access keys | GitHub OIDC federation with branch-scoped trust |
| SR-03 | PostgreSQL and Redis must have no public IP or internet route | Isolated subnets, no default route, `publicly_accessible = false` |
| SR-04 | The data tier must accept connections only from the application tier | Security group reference rules on 5432/6379 |
| SR-05 | Data must be encrypted in transit and at rest | TLS listener, `sslmode=require`, `rediss://`, RDS + ElastiCache encryption |
| SR-06 | Deployed images must be scanned for known vulnerabilities | Trivy on filesystem and image; `npm audit` gate (`--high`) |
| SR-07 | Backups must support recovery within an agreed retention window | RDS automated snapshots, 30-day retention, 01:00 SAST window |
| SR-08 | Access to production deployments must be attributable | Environment protection + OIDC session names carrying `run_id` and actor |

**Compliance note.** FICA (Financial Intelligence Centre Act) and POPIA (Protection of Personal
Information Act) both require that personal and financial data be protected against unauthorised
access and that access be auditable. Subnet isolation, private endpoints, encrypted transport and
CloudTrail-visible role assumption address the infrastructure portion of that obligation. It is not
a claim of full FICA/POPIA certification: application-level controls, data retention rules and
audit-log retention remain the data controller's responsibility.

---

## 4. Non-functional requirements

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-01 | Availability during deployment | 0 dropped requests; 0% 5XX attributable to the swap |
| NFR-02 | Recovery time after a failed release | < 10 minutes, automated |
| NFR-03 | API latency overhead from the platform | < 5 ms added p95 vs. direct origin |
| NFR-04 | Provisioning time from zero | < 20 minutes for a full environment |
| NFR-05 | Observability | 5XX ratio, latency percentiles, ECS CPU/memory, RDS CPU/storage, unhealthy targets |
| NFR-06 | Alert delivery | < 5 minutes from threshold breach to SNS |
| NFR-07 | Log retention | 30 days hot in CloudWatch (configurable) |
| NFR-08 | Secret rotation | Documented procedure; no rotation required to ship a release |
| NFR-09 | Test execution time | Unit suite < 60 seconds locally |
| NFR-10 | Disaster recovery | RDS point-in-time restore, Terraform rebuild from state |

---

## 5. Constraints and assumptions

- AWS only; the design maps to Azure or GCP equivalents but v1.0.0 targets AWS.
- `af-south-1` does not offer every instance family; defaults use Graviton-capable instance classes
  (`t4g`) and Fargate x86_64 tasks.
- TLS requires an ACM certificate. Without one the stack serves HTTP so a demo account can run;
  a production release must set `certificate_arn`.
- The reference application is deliberately small. The value of the project is the platform around
  it, not the CRUD surface.
- Slack/Teams alert fan-out uses AWS Chatbot, attached to the SNS topic after apply (console step).

---

## 6. Acceptance criteria

A release is accepted when:

1. `terraform plan` against the committed configuration produces no changes after apply.
2. All tests pass on Node 22 and 24, and lint is clean.
3. The image builds and Trivy reports no unfixed HIGH/CRITICAL findings.
4. A merge to `main` reaches `wait-for-service-stability` success and passes the `/health` +
   `/ready` smoke test through the ALB.
5. A deliberately failing release leaves the service on the previous revision.
6. No secret value appears in the repository, image layers or CloudWatch logs.
