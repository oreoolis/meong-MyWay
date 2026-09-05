# Bedrock: the model access the five agents need, and the table their output
# lands in.
#
# Cost is the binding constraint here — see
# docs/adr/0002-claude-haiku-for-grounded-advice.md. Nothing in this
# file provisions capacity: Bedrock on-demand is billed per token, so an idle
# deployment costs $0. The only standing cost is the DynamoDB table below,
# which is PAY_PER_REQUEST like the others.

# ---------------------------------------------------------------------------
# Model access
# ---------------------------------------------------------------------------
#
# On-demand foundation models are not Terraform resources — they are enabled
# once per account in the Bedrock console ("Model access"), and then addressed
# by ID. These data sources turn a typo in a model ID into a plan-time error
# instead of a 4xx at the first user request.

data "aws_bedrock_foundation_model" "reasoning" {
  model_id = var.bedrock_reasoning_model_id
}

data "aws_bedrock_foundation_model" "embedding" {
  model_id = var.bedrock_embedding_model_id
}

# Anthropic's 4.x models publish INFERENCE_PROFILE as their only supported
# inference type, so the ID the runtime invokes is not the foundation-model ID
# above — it is that ID behind a geography prefix. Resolving the profile here
# turns an unavailable geography into a plan-time error, and gives IAM the
# authoritative list of regions the profile routes to rather than a hand-kept
# copy that goes stale when AWS adds one.
data "aws_bedrock_inference_profile" "reasoning" {
  count = var.bedrock_inference_profile_prefix == "" ? 0 : 1

  inference_profile_id = local.reasoning_runtime_model_id
}

locals {
  # What BEDROCK_REASONING_MODEL_ID must be set to. Exported by outputs.tf and
  # written into .env.local by sync-env.sh.
  reasoning_runtime_model_id = "${var.bedrock_inference_profile_prefix}${var.bedrock_reasoning_model_id}"

  # Invoking through a cross-region profile is authorised against the profile
  # *and* against the foundation model in every region it may route to — the
  # request is authorised again after it lands. Granting only the profile ARN
  # yields an AccessDeniedException on whichever region the router happened to
  # pick, which presents as an intermittent failure.
  reasoning_invoke_arns = var.bedrock_inference_profile_prefix == "" ? [
    data.aws_bedrock_foundation_model.reasoning.model_arn
    ] : concat(
    data.aws_bedrock_inference_profile.reasoning[0].models[*].model_arn,
    [data.aws_bedrock_inference_profile.reasoning[0].inference_profile_arn],
  )
}

# ---------------------------------------------------------------------------
# Where agent output lives
# ---------------------------------------------------------------------------
#
# One partition per user, one item per artifact, so each agent writes its own
# row independently: the parser can store its embedding before the planner has
# started, and a failed advisor call does not roll back a good plan.
#
# `artifact` is the sort key and takes a fixed vocabulary — "embedding",
# "profile", "plan", "improver", "advisor", "swapper". Re-running the pipeline
# overwrites in place, so a user has exactly one current analysis, matching how
# `resumes` holds exactly one current resume.
resource "aws_dynamodb_table" "analyses" {
  name         = "${var.project_name}-analyses"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "artifact"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "artifact"
    type = "S"
  }

  # Agent output is derived data — it can always be regenerated from the
  # resume — but regeneration costs a Bedrock call per agent, so a recovery
  # window is cheaper than a re-run.
  point_in_time_recovery {
    enabled = true
  }

  # Analyses are disposable once stale. TTL lets old rows expire without a
  # cleanup job; the app sets `expiresAt` on write.
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

# ---------------------------------------------------------------------------
# IAM
# ---------------------------------------------------------------------------
#
# Gated behind `create_iam` because the sandbox account this project develops
# against restricts IAM writes (see the note in iam.tf). Locally the app runs
# on the developer's own credentials and needs none of this; set
# `create_iam = true` when deploying somewhere with a real execution role.

data "aws_iam_policy_document" "agent_runtime" {
  count = var.create_iam ? 1 : 0

  # Scoped to the two models the agents actually call, so a compromised task
  # role cannot invoke an expensive one. The embedding ARN is an
  # account-agnostic foundation-model ARN; the reasoning side expands to the
  # inference profile plus each regional foundation model behind it.
  statement {
    sid       = "InvokeAgentModels"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = concat(local.reasoning_invoke_arns, [data.aws_bedrock_foundation_model.embedding.model_arn])
  }

  statement {
    sid       = "ReadResumeBytes"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.uploads.arn}/*"]
  }

  statement {
    sid       = "ReadResumeMetadata"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.resumes.arn]
  }

  statement {
    sid = "WriteAnalyses"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:BatchWriteItem",
      "dynamodb:DeleteItem",
    ]
    resources = [aws_dynamodb_table.analyses.arn]
  }
}

resource "aws_iam_policy" "agent_runtime" {
  count  = var.create_iam ? 1 : 0
  name   = "${var.project_name}-agent-runtime"
  policy = data.aws_iam_policy_document.agent_runtime[0].json
}
