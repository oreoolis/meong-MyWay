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

# Set as DYNAMODB_ANALYSES_TABLE in the frontend's .env.local.
output "dynamodb_analyses_table_name" {
  value = aws_dynamodb_table.analyses.name
}

# Set as BEDROCK_REASONING_MODEL_ID / BEDROCK_EMBEDDING_MODEL_ID /
# BEDROCK_REGION. Echoed from the data sources rather than the variables so the
# output is proof the models actually resolved.
#
# This is the *runtime* ID — the inference profile, not the foundation model.
# Handing out the foundation-model ID would produce a ValidationException on
# the first user request for any model that is profile-only, which is every
# Anthropic 4.x model.
output "bedrock_reasoning_model_id" {
  value = var.bedrock_inference_profile_prefix == "" ? data.aws_bedrock_foundation_model.reasoning.model_id : data.aws_bedrock_inference_profile.reasoning[0].inference_profile_id
}

output "bedrock_embedding_model_id" {
  value = data.aws_bedrock_foundation_model.embedding.model_id
}

output "bedrock_region" {
  value = var.bedrock_region
}

output "agent_runtime_policy_arn" {
  value = var.create_iam ? aws_iam_policy.agent_runtime[0].arn : null
}

# Set as S3_JOBS_BUCKET in the frontend's .env.local. `null` when the scraper
# is not enabled — sync-env.sh treats that as optional, not a hard failure.
output "jobs_bucket_name" {
  value = local.jobs_enabled ? aws_s3_bucket.jobs[0].bucket : null
}

# Set as S3_COURSES_BUCKET. The same bucket as above under a `courses/` prefix
# — see the `market_bucket_enabled` note in jobs.tf — but emitted separately so
# the app can tell "the course pool is deployed" from "the jobs feed is",
# which are independent switches.
output "courses_bucket_name" {
  value = local.courses_enabled ? aws_s3_bucket.jobs[0].bucket : null
}

# output "iam_policy_arn" {
#   value = aws_iam_policy.app_access.arn
# }