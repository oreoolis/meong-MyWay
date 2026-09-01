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
# }
#
# resource "aws_iam_policy" "app_access" {
#   name   = "${var.project_name}-app-access"
#   policy = data.aws_iam_policy_document.app_access.json
# }
