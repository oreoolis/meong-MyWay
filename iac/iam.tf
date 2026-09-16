# NOTE: aws_iam_policy.app_access is commented out because it's not attached
# to any role/user/group yet, and the sandbox account restricts IAM console
# access. Re-enable once there's an actual role to attach it to.

# data "aws_iam_policy_document" "app_access" {
#   statement {
#     actions = [
#       "dynamodb:GetItem", "dynamodb:PutItem",
#       "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"
#     ]
#     resources = [aws_dynamodb_table.users.arn]
#   }
#
#   statement {
#     actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
#     resources = ["${aws_s3_bucket.uploads.arn}/*"]
#   }
#
#   # Required whenever `enable_kms_encryption` is on. S3 does the encrypting,
#   # but it does it *as the caller*, so the statement above is not sufficient
#   # on its own: without these two the app gets AccessDenied on every résumé
#   # read and write, and the S3 permissions look correct while it happens.
#   #
#   # GenerateDataKey is for writes, Decrypt for reads. `one(...)` resolves to
#   # null when the key is switched off, so guard the statement on the flag
#   # rather than relying on an empty resource list.
#   dynamic "statement" {
#     for_each = var.enable_kms_encryption ? [1] : []
#     content {
#       actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
#       resources = [one(aws_kms_key.uploads[*].arn)]
#     }
#   }
# }
#
# resource "aws_iam_policy" "app_access" {
#   name   = "${var.project_name}-app-access"
#   policy = data.aws_iam_policy_document.app_access.json
# }
