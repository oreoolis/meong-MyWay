# The job listings snapshot: a scraper on a 12-hour schedule against
# MyCareersFuture's public jobs API, and the bucket it publishes to.
#
# Separate from `s3.tf`'s uploads bucket on purpose. That bucket holds one
# private object per user and is blocked from public access on those grounds;
# this one holds a single shared, non-personal artifact with a completely
# different access story.
#
# Gated behind `enable_jobs_scraper` AND `create_iam`, same reasoning as the
# Bedrock policy in bedrock.tf: a Lambda cannot exist without an execution
# role, and the sandbox account this project develops against blocks IAM
# writes. Unlike the Bedrock policy there is no degraded mode — without IAM
# there is no function, so this whole file evaluates to nothing rather than
# failing.

variable "enable_jobs_scraper" {
  type    = bool
  default = false
}

locals {
  jobs_enabled = var.enable_jobs_scraper && var.create_iam
}

resource "aws_s3_bucket" "jobs" {
  # Scoped to this bucket rather than skipped project-wide, so the uploads
  # bucket losing its CMK would still fail the build. Same argument as the
  # Trivy AWS-0132 entry in .trivyignore.yaml: public data, SSE-S3 declared
  # below deliberately.
  #checkov:skip=CKV_AWS_145:Public job-postings snapshot; SSE-S3 is the deliberate choice, see the encryption block below.
  count  = local.jobs_enabled ? 1 : 0
  bucket = "${var.project_name}-jobs-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "jobs" {
  count                   = local.jobs_enabled ? 1 : 0
  bucket                  = aws_s3_bucket.jobs[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# SSE-S3, deliberately — not the customer-managed key the uploads bucket gets.
#
# Trivy's AWS-0132 wants a CMK on every bucket and is suppressed for this file
# alone in .trivyignore.yaml. The argument: this bucket holds one object, a
# snapshot of postings scraped from MyCareersFuture's *public*, unauthenticated
# API. There is no confidentiality to protect — the source is on the open web —
# so a CMK would buy key rotation and decrypt auditing for data that is public
# by construction, at a standing monthly charge against a $20 project budget.
#
# Declared rather than left to the default so that choice is on the record. S3
# would apply AES256 either way; what an empty file could not say is that
# anybody weighed it.
#
# It is also the cheaper failure mode. SSE-KMS here would mean the scraper's
# role needs kms:Decrypt and kms:GenerateDataKey, and `readPool` in handler.js
# raises rather than degrading to an empty pool — so a missing grant would stop
# the feed publishing rather than quietly weaken it.
resource "aws_s3_bucket_server_side_encryption_configuration" "jobs" {
  count  = local.jobs_enabled ? 1 : 0
  bucket = aws_s3_bucket.jobs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Run archives are for debugging a bad snapshot, which stops being useful
# quickly. `latest.json` sits outside the prefix and is never expired.
resource "aws_s3_bucket_lifecycle_configuration" "jobs" {
  count  = local.jobs_enabled ? 1 : 0
  bucket = aws_s3_bucket.jobs[0].id

  rule {
    id     = "expire-run-archives"
    status = "Enabled"
    filter { prefix = "jobs/runs/" }
    expiration { days = 30 }
  }
}

# A single file, zipped directly — no build step. `handler.js` requires only
# `@aws-sdk/client-s3`, which the Node.js 20.x Lambda runtime bundles, and the
# global `fetch` the same runtime already provides. There is nothing to
# vendor.
data "archive_file" "jobs_scraper" {
  count       = local.jobs_enabled ? 1 : 0
  type        = "zip"
  source_file = "${path.module}/../lambda/jobs-scraper/handler.js"
  output_path = "${path.module}/../lambda/jobs-scraper/jobs-scraper.zip"
}

data "aws_iam_policy_document" "jobs_scraper_assume" {
  count = local.jobs_enabled ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "jobs_scraper" {
  count              = local.jobs_enabled ? 1 : 0
  name               = "${var.project_name}-jobs-scraper"
  assume_role_policy = data.aws_iam_policy_document.jobs_scraper_assume[0].json
}

data "aws_iam_policy_document" "jobs_scraper" {
  count = local.jobs_enabled ? 1 : 0

  # Read the pool, then write it back. Scoped to this bucket's object space
  # alone — the function has no reason to touch anything else in the account.
  #
  # `GetObject` is what makes the pool accumulate rather than being replaced by
  # whatever one run saw. Without it the handler cannot read `latest.json`, and
  # it deliberately raises rather than falling back to an empty pool, so a
  # missing permission fails the run loudly instead of quietly publishing a
  # single fetch over a week of postings.
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.jobs[0].arn}/*"]
  }

  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"]
  }
}

resource "aws_iam_role_policy" "jobs_scraper" {
  count  = local.jobs_enabled ? 1 : 0
  name   = "${var.project_name}-jobs-scraper"
  role   = aws_iam_role.jobs_scraper[0].id
  policy = data.aws_iam_policy_document.jobs_scraper[0].json
}

resource "aws_cloudwatch_log_group" "jobs_scraper" {
  count             = local.jobs_enabled ? 1 : 0
  name              = "/aws/lambda/${var.project_name}-jobs-scraper"
  retention_in_days = 14
}

# No VPC configuration, deliberately. A non-VPC Lambda egresses through
# AWS-managed addresses that vary between invocations, which suits a public,
# rate-sensitive API better than a NAT Gateway's single pinned address would.
resource "aws_lambda_function" "jobs_scraper" {
  count            = local.jobs_enabled ? 1 : 0
  function_name    = "${var.project_name}-jobs-scraper"
  role             = aws_iam_role.jobs_scraper[0].arn
  handler          = "handler.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.jobs_scraper[0].output_path
  source_code_hash = data.archive_file.jobs_scraper[0].output_base64sha256

  # Twenty paced pages against a public API, plus reading and rewriting a pool
  # that a week of postings takes to roughly 10 MB. Raised from 60s/256MB when
  # the pool replaced the single-fetch snapshot: the extra work is one GET, one
  # merge over tens of thousands of objects, and two larger PUTs.
  timeout     = 120
  memory_size = 512

  environment {
    variables = {
      JOBS_BUCKET         = aws_s3_bucket.jobs[0].bucket
      JOBS_PREFIX         = "jobs"
      JOBS_WINDOW_SECONDS = "86400"
      JOBS_PAGE_LIMIT     = "100"
      JOBS_MAX_PAGES      = "20"
      # The window the app actually matches against. `JOBS_WINDOW_SECONDS`
      # above bounds one fetch and is never reached — MCF serves a full page
      # every time, so a run exits on the page cap after five or six hours of
      # postings. This is the number that decides how much of the market a
      # candidate is compared to.
      JOBS_RETENTION_DAYS = "7"
    }
  }

  depends_on = [aws_cloudwatch_log_group.jobs_scraper]
}

resource "aws_cloudwatch_event_rule" "jobs_scraper" {
  count               = local.jobs_enabled ? 1 : 0
  name                = "${var.project_name}-jobs-scraper-12h"
  description         = "Refresh the job listings snapshot every 12 hours."
  schedule_expression = "rate(12 hours)"
}

resource "aws_cloudwatch_event_target" "jobs_scraper" {
  count     = local.jobs_enabled ? 1 : 0
  rule      = aws_cloudwatch_event_rule.jobs_scraper[0].name
  target_id = "jobs-scraper"
  arn       = aws_lambda_function.jobs_scraper[0].arn
}

resource "aws_lambda_permission" "jobs_scraper" {
  count         = local.jobs_enabled ? 1 : 0
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.jobs_scraper[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.jobs_scraper[0].arn
}

# The alarm that matters. The handler raises rather than publishing an empty
# snapshot, so any real failure — API shape drift, an outage — arrives here as
# a Lambda error. Two missed 12-hour runs means the snapshot is a full day
# stale with nobody notified, which is the silent-staleness failure this
# alarm exists to catch.
resource "aws_cloudwatch_metric_alarm" "jobs_scraper_failing" {
  count               = local.jobs_enabled ? 1 : 0
  alarm_name          = "${var.project_name}-jobs-scraper-failing"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 43200
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    FunctionName = aws_lambda_function.jobs_scraper[0].function_name
  }
}
