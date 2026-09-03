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
# Nova Lite is the cheapest Bedrock model that still holds a multi-step
# argument about a career, and it reads PDF/DOCX natively through Converse, so
# the parser needs no separate text-extraction dependency. At $0.06/$0.24 per
# million tokens a full five-agent run costs roughly half a cent.
#
# Nova Micro (amazon.nova-micro-v1:0) is cheaper still but text-only and
# noticeably thinner on rationale; anthropic.claude-haiku-4-5-20251001-v1:0 is
# the upgrade when advice quality matters more than the bill.
variable "bedrock_reasoning_model_id" {
  type    = string
  default = "amazon.nova-lite-v1:0"
}

# Titan Text Embeddings V2 — $0.02 per million tokens, and already inside
# Bedrock, so resume vectors need no second vendor or hosted HuggingFace
# endpoint. 1024 dimensions by default.
variable "bedrock_embedding_model_id" {
  type    = string
  default = "amazon.titan-embed-text-v2:0"
}

# Bedrock is not available in every region, and model availability varies
# within the ones where it is. Kept separate from `aws_region` so storage can
# stay where it is while inference runs somewhere the models exist.
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