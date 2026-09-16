resource "aws_s3_bucket" "uploads" {
  bucket = "${var.project_name}-uploads-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# A customer-managed key for the résumé bytes.
#
# S3 has encrypted every new object with SSE-S3 since January 2023, so this is
# not the difference between encrypted and plaintext. What a CMK adds is
# control: rotation on a schedule we set, a key policy that can revoke access
# independently of the bucket policy, and a CloudTrail record of every decrypt.
# This bucket holds one résumé per user — personal data someone handed us to
# read once — which is the case where those three are worth paying for.
#
# The jobs bucket deliberately does NOT get one; see the note above its own
# encryption block in jobs.tf.
resource "aws_kms_key" "uploads" {
  count                   = var.enable_kms_encryption ? 1 : 0
  description             = "${var.project_name} résumé uploads (S3 SSE-KMS)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = one(data.aws_iam_policy_document.uploads_kms[*].json)
}

# The AWS default key policy, written out.
#
# Omitting `policy` gets this exact document generated for you, which is why
# leaving it out is not a security hole — but it is invisible, and an
# unreviewable policy on the key guarding personal data is worth two dozen
# lines. Checkov's CKV2_AWS_64 asks for the same thing.
#
# Delegating to the account root is deliberate, not lazy. It means IAM policies
# govern who may decrypt, which is the only arrangement that keeps working for
# both principals this project has: a developer's own keys locally, and a task
# role in a deployed environment. A key policy that named those principals
# directly would lock out whichever one it forgot — and locking yourself out of
# a KMS key is not recoverable without AWS support.
data "aws_iam_policy_document" "uploads_kms" {
  count = var.enable_kms_encryption ? 1 : 0

  statement {
    sid       = "EnableIAMUserPermissions"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
}

resource "aws_kms_alias" "uploads" {
  count         = var.enable_kms_encryption ? 1 : 0
  name          = "alias/${var.project_name}-uploads"
  target_key_id = aws_kms_key.uploads[0].key_id
}

# `one(...[*].arn)` rather than a ternary on `[0]`: with the key switched off
# the list is empty, and indexing it fails at apply even on the branch that is
# never taken. `one` yields null for an empty list, which is exactly what
# `kms_master_key_id` wants when the algorithm is AES256.
resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.enable_kms_encryption ? "aws:kms" : "AES256"
      kms_master_key_id = one(aws_kms_key.uploads[*].arn)
    }

    # S3 Bucket Keys cut KMS request charges by up to 99% by deriving a
    # short-lived bucket-level key instead of calling KMS per object. This
    # project's whole inference budget is $20, so a per-object KMS charge on
    # every résumé read is not a rounding error — see docs/adr/0002.
    bucket_key_enabled = var.enable_kms_encryption
  }
}

data "aws_caller_identity" "current" {}