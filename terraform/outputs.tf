output "vpc_id" {
  value       = aws_vpc.batch.id
  description = "VPC ID"
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "Private subnet IDs"
}

output "ecs_cluster_name" {
  value       = aws_ecs_cluster.batch.name
  description = "ECS cluster name"
}

output "ecs_cluster_arn" {
  value       = aws_ecs_cluster.batch.arn
  description = "ECS cluster ARN"
}

output "cloudwatch_log_group_name" {
  value       = aws_cloudwatch_log_group.ecs_batch.name
  description = "CloudWatch log group name"
}

output "ecr_repository_uri" {
  value       = aws_ecr_repository.batch.repository_url
  description = "ECR repository URI"
}

output "ecs_task_execution_role_arn" {
  value       = aws_iam_role.ecs_task_execution_role.arn
  description = "ECS task execution role ARN"
}

output "ecs_task_role_arn" {
  value       = aws_iam_role.ecs_task_role.arn
  description = "ECS task role ARN"
}

output "ecs_security_group_id" {
  value       = aws_security_group.ecs_tasks.id
  description = "ECS security group ID"
}

output "kms_key_id" {
  value       = aws_kms_key.batch_cmk.id
  description = "KMS key ID for batch processing"
}

output "kms_key_arn" {
  value       = aws_kms_key.batch_cmk.arn
  description = "KMS key ARN"
}

# Output to SSM Parameter Store for CDK consumption
resource "aws_ssm_parameter" "vpc_id" {
  name  = "/batch/terraform/vpc-id"
  type  = "String"
  value = aws_vpc.batch.id
}

resource "aws_ssm_parameter" "private_subnet_ids" {
  name  = "/batch/terraform/private-subnet-ids"
  type  = "StringList"
  value = join(",", aws_subnet.private[*].id)
}

resource "aws_ssm_parameter" "ecs_cluster_arn" {
  name  = "/batch/terraform/ecs-cluster-arn"
  type  = "String"
  value = aws_ecs_cluster.batch.arn
}

resource "aws_ssm_parameter" "cloudwatch_log_group_name" {
  name  = "/batch/terraform/cloudwatch-log-group-name"
  type  = "String"
  value = aws_cloudwatch_log_group.ecs_batch.name
}

resource "aws_ssm_parameter" "ecr_repository_uri" {
  name  = "/batch/terraform/ecr-repository-uri"
  type  = "String"
  value = aws_ecr_repository.batch.repository_url
}

resource "aws_ssm_parameter" "ecs_task_execution_role_arn" {
  name  = "/batch/terraform/ecs-task-execution-role-arn"
  type  = "String"
  value = aws_iam_role.ecs_task_execution_role.arn
}

resource "aws_ssm_parameter" "ecs_task_role_arn" {
  name  = "/batch/terraform/ecs-task-role-arn"
  type  = "String"
  value = aws_iam_role.ecs_task_role.arn
}

resource "aws_ssm_parameter" "ecs_security_group_id" {
  name  = "/batch/terraform/ecs-security-group-id"
  type  = "String"
  value = aws_security_group.ecs_tasks.id
}

resource "aws_ssm_parameter" "kms_key_arn" {
  name  = "/batch/terraform/kms-key-arn"
  type  = "String"
  value = aws_kms_key.batch_cmk.arn
}