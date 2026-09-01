output "dynamodb_table_name" {
  value = aws_dynamodb_table.users.name
}

# Set as DYNAMODB_RESUMES_TABLE in the frontend's .env.local.
output "dynamodb_resumes_table_name" {
  value = aws_dynamodb_table.resumes.name
}

output "s3_bucket_name" {
  value = aws_s3_bucket.uploads.bucket
}

# output "iam_policy_arn" {
#   value = aws_iam_policy.app_access.arn
# }