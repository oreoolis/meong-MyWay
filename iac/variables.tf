variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "project_name" {
  type    = string
  default = "meong-myway"
}

# The reasoning model behind all five agents.
#
# Claude Haiku 4.5 — see docs/adr/0002-claude-haiku-for-grounded-advice.md. It
# reads PDF/DOCX natively through Converse document blocks, so the parser still
# needs no text-extraction dependency, and unlike Nova Lite it holds a resume
# line in mind while arguing about it — which is what the Career Swapper needs
# to name alternatives the candidate can actually reach.
#
# This is the *foundation model* ID, not the ID the runtime invokes. Haiku 4.5
# is inference-profile-only (see `bedrock_inference_profile_prefix` below), but
# the data source in bedrock.tf resolves foundation models, so the bare ID is
# what belongs here.
#
# amazon.nova-lite-v1:0 is ~20x cheaper and remains the fallback if the budget
# tightens; it is on-demand, so switching back also means setting
# `bedrock_inference_profile_prefix = ""`.
variable "bedrock_reasoning_model_id" {
  type    = string
  default = "anthropic.claude-haiku-4-5-20251001-v1:0"
}

# Anthropic's 4.x models on Bedrock publish `INFERENCE_PROFILE` as their only
# supported inference type — invoking the bare foundation-model ID returns
# ValidationException ("Retry your request with the ID or ARN of an inference
# profile"). Prefixing the model ID with a geography turns it into the
# cross-region profile that on-demand invocation actually accepts.
#
# "us." routes across us-east-1, us-east-2 and us-west-2, which is what keeps a
# five-agent burst from throttling in a single region. Set to "" for a model
# that supports ON_DEMAND directly, such as the Nova family.
variable "bedrock_inference_profile_prefix" {
  type    = string
  default = "us."

  validation {
    condition     = contains(["", "us.", "eu.", "apac.", "global."], var.bedrock_inference_profile_prefix)
    error_message = "Must be \"\" or one of \"us.\", \"eu.\", \"apac.\", \"global.\"."
  }
}

# Titan Text Embeddings V2 — $0.02 per million tokens, and already inside
# Bedrock, so resume vectors need no second vendor or hosted HuggingFace
# endpoint. 1024 dimensions by default. Unchanged by the reasoning-model swap:
# embedding quality was never the constraint.
variable "bedrock_embedding_model_id" {
  type    = string
  default = "amazon.titan-embed-text-v2:0"
}

# Bedrock is not available in every region, and model availability varies
# within the ones where it is. Kept separate from `aws_region` so storage can
# stay where it is while inference runs somewhere the models exist.
#
# Must be one of the regions the profile prefix above routes to, since the
# request enters Bedrock here before being routed.
variable "bedrock_region" {
  type    = string
  default = "us-east-1"
}

# The sandbox account used for development blocks IAM writes, so the policy in
# bedrock.tf is opt-in. Turn this on when deploying to an account where the app
# runs under a task or instance role rather than a developer's own keys.
variable "create_iam" {
  type    = bool
  default = false
}
