# The SkillsFuture course pool: a scraper on a weekly schedule against the
# SSG-WSG course directory, and the Titan embedding it attaches to every course
# before publishing.
#
# The same EventBridge → Lambda → S3 shape as jobs.tf, sharing that file's
# bucket under a `courses/` prefix — see the `market_bucket_enabled` note
# there. Three things differ, and all three are in this file rather than that
# one:
#
#   1. bedrock:InvokeModel, because the embedding is computed here rather than
#      in the request that needs it. That is the point of the feature: the
#      career planner used to call the directory live and embed two dozen
#      candidate courses on the critical path of every analysis.
#   2. SSG OAuth credentials, because unlike MyCareersFuture the directory is
#      not an open GET.
#   3. A weekly schedule and a longer timeout. A course catalogue moves far
#      more slowly than a job board, and a cold pool is ~1,500 embeddings.
#
# Gated behind `enable_courses_scraper` AND `create_iam`, same as the jobs
# scraper: a Lambda cannot exist without an execution role.

variable "enable_courses_scraper" {
  type    = bool
  default = false
}

# SkillsFuture developer-portal credentials (https://developer.swda.gov.sg).
#
# Set in iac/terraform.tfvars, which is gitignored. Marked sensitive so a plan
# or apply log does not print them — note that "sensitive" hides them from
# output, not from state: `terraform.tfstate` is also gitignored and holds them
# in the clear, the same as every other secret Terraform manages.
#
# ponytail: plain Lambda environment variables rather than Secrets Manager or
# an SSM SecureString. Lambda encrypts them at rest with an AWS-managed key, so
# what is actually declined is protection against a principal who already holds
# lambda:GetFunctionConfiguration in this account. Move to an SSM SecureString
# (free for standard parameters) if this ever runs somewhere with more than one
# operator.
variable "ssg_client_id" {
  type      = string
  default   = ""
  sensitive = true
}

variable "ssg_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

# Override the seed keywords the pool is built from. Comma-separated; empty
# uses the list in the handler. The directory has no "list everything" mode, so
# these queries are the pool's entire coverage — see DEFAULT_KEYWORDS in
# lambda/courses-scraper/handler.js for what they have to span and why.
variable "courses_keywords" {
  type    = string
  default = ""
}

locals {
  # Credentials are part of the gate, not a runtime surprise: the handler
  # raises on a missing client ID, which would present as a Lambda that fails
  # every scheduled run rather than as a feature that was never turned on.
  #
  # `nonsensitive` because otherwise this local inherits the credentials'
  # sensitivity and taints everything derived from it — including the
  # `courses_bucket_name` output, which is a bucket name. What is unwrapped is
  # the boolean "are they set", not the values.
  courses_enabled = (
    var.enable_courses_scraper
    && var.create_iam
    && nonsensitive(var.ssg_client_id != "" && var.ssg_client_secret != "")
  )
}

# A single file, zipped directly — no build step, same as the jobs scraper.
# `handler.js` requires `@aws-sdk/client-s3` and
# `@aws-sdk/client-bedrock-runtime`, both bundled in the Node.js 20.x runtime,
# plus the global `fetch` it already provides.
data "archive_file" "courses_scraper" {
  count       = local.courses_enabled ? 1 : 0
  type        = "zip"
  source_file = "${path.module}/../lambda/courses-scraper/handler.js"
  output_path = "${path.module}/../lambda/courses-scraper/courses-scraper.zip"
}

data "aws_iam_policy_document" "courses_scraper_assume" {
  count = local.courses_enabled ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "courses_scraper" {
  count              = local.courses_enabled ? 1 : 0
  name               = "${var.project_name}-courses-scraper"
  assume_role_policy = data.aws_iam_policy_document.courses_scraper_assume[0].json
}

data "aws_iam_policy_document" "courses_scraper" {
  count = local.courses_enabled ? 1 : 0

  # Read the pool, then write it back. `GetObject` is what makes the embeddings
  # survive: a course is re-embedded only when its text changes, so without the
  # read every run would pay for all ~1,500 vectors again.
  #
  # Scoped to the whole bucket's object space rather than `courses/*` because
  # the ARN pattern would be the only thing separating it from the jobs feed
  # anyway, and both feeds are the same non-personal derived data.
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.jobs[0].arn}/*"]
  }

  # Only the embedding model. The reasoning model is far more expensive per
  # call and this function has no use for it, so a compromised role cannot
  # reach it. Titan is on-demand, so there is no inference profile to expand
  # the way bedrock.tf does for Claude.
  #
  # The ARN is built from `bedrock_region` rather than taken from the data
  # source's own `model_arn`, which carries the *provider's* region. Those are
  # deliberately separate variables — see bedrock_region in variables.tf — and
  # when they differ, the data source's ARN names a region this function never
  # calls. The failure would be quiet: `embedPool` settles each embedding
  # individually, so every InvokeModel would be denied, the run would still
  # succeed, and it would publish a complete pool with no vectors in it. The
  # model *id* still comes from the data source, so a typo is still a plan-time
  # error.
  statement {
    sid     = "EmbedCourses"
    actions = ["bedrock:InvokeModel"]
    resources = [
      "arn:aws:bedrock:${var.bedrock_region}::foundation-model/${data.aws_bedrock_foundation_model.embedding.model_id}",
    ]
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

resource "aws_iam_role_policy" "courses_scraper" {
  count  = local.courses_enabled ? 1 : 0
  name   = "${var.project_name}-courses-scraper"
  role   = aws_iam_role.courses_scraper[0].id
  policy = data.aws_iam_policy_document.courses_scraper[0].json
}

resource "aws_cloudwatch_log_group" "courses_scraper" {
  count             = local.courses_enabled ? 1 : 0
  name              = "/aws/lambda/${var.project_name}-courses-scraper"
  retention_in_days = 14
}

resource "aws_lambda_function" "courses_scraper" {
  count            = local.courses_enabled ? 1 : 0
  function_name    = "${var.project_name}-courses-scraper"
  role             = aws_iam_role.courses_scraper[0].arn
  handler          = "handler.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.courses_scraper[0].output_path
  source_code_hash = data.archive_file.courses_scraper[0].output_base64sha256

  # Sized for the cold start, which is the only slow run: ~100 sequential
  # directory pages, then up to 1,500 Bedrock embeddings eight at a time.
  # Steady state is a minute. Memory is about the pool itself — 1,500 courses
  # carrying a 1024-float vector each is roughly 15 MB of JSON, parsed and
  # re-serialised in one process.
  timeout     = 600
  memory_size = 1024

  environment {
    variables = {
      COURSES_BUCKET             = aws_s3_bucket.jobs[0].bucket
      COURSES_PREFIX             = "courses"
      COURSES_KEYWORDS           = var.courses_keywords
      SSG_CLIENT_ID              = var.ssg_client_id
      SSG_CLIENT_SECRET          = var.ssg_client_secret
      BEDROCK_REGION             = var.bedrock_region
      BEDROCK_EMBEDDING_MODEL_ID = data.aws_bedrock_foundation_model.embedding.model_id
      # Must match EMBEDDING_DIMENSIONS in src/lib/bedrock/embeddings.ts. The
      # app refuses to score against a pool of a different width rather than
      # comparing vectors that are not comparable, so changing this here alone
      # silently disables the feature and falls the planner back to live
      # directory calls.
      COURSES_EMBEDDING_DIMENSIONS = "1024"
    }
  }

  depends_on = [aws_cloudwatch_log_group.courses_scraper]
}

# Weekly, against the jobs feed's twelve hours. A course catalogue is reference
# data — a provider adds a new course over weeks, not hours — and every extra
# run is another sweep of the directory for a pool that will barely have moved.
#
# `COURSES_RETENTION_DAYS` is 30, so a withdrawn course must be absent from
# four consecutive runs before it expires. That is the intended slack: it keeps
# one failed sweep from emptying the pool.
resource "aws_cloudwatch_event_rule" "courses_scraper" {
  count               = local.courses_enabled ? 1 : 0
  name                = "${var.project_name}-courses-scraper-weekly"
  description         = "Refresh the SkillsFuture course pool and its embeddings weekly."
  schedule_expression = "rate(7 days)"
}

resource "aws_cloudwatch_event_target" "courses_scraper" {
  count     = local.courses_enabled ? 1 : 0
  rule      = aws_cloudwatch_event_rule.courses_scraper[0].name
  target_id = "courses-scraper"
  arn       = aws_lambda_function.courses_scraper[0].arn
}

resource "aws_lambda_permission" "courses_scraper" {
  count         = local.courses_enabled ? 1 : 0
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.courses_scraper[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.courses_scraper[0].arn
}

# The handler raises rather than publishing an empty pool, so expired
# credentials or a moved response shape arrive here as a Lambda error.
#
# The failure this catches is quiet by construction: a stale pool still
# produces recommendations, just increasingly wrong ones, and the app falls
# back to the live directory only when the pool is missing entirely — not when
# it is months old.
#
# `notBreaching`, unlike the jobs alarm's `breaching`. That alarm fires on
# missing data because a 12-hour schedule puts a datapoint in every period; a
# weekly schedule leaves six of every seven daily periods empty, so treating
# absence as failure would hold this alarm permanently ON and train everyone to
# ignore it. CloudWatch caps `period` at 86400, so a one-period-per-run alarm
# is not available either.
#
# ponytail: this therefore catches a run that FAILS, not a run that never
# fired. If a silent schedule matters, add a separate alarm on the
# `Invocations` metric summed over a week; the Errors alarm alone cannot see it.
resource "aws_cloudwatch_metric_alarm" "courses_scraper_failing" {
  count               = local.courses_enabled ? 1 : 0
  alarm_name          = "${var.project_name}-courses-scraper-failing"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.courses_scraper[0].function_name
  }
}
