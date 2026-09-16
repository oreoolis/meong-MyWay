# Nothing reads this table.
#
# The app's users live in the Cognito user pool, and its two real tables are
# `resumes` and `analyses`. This one is referenced only by outputs.tf and the
# commented-out policy in iam.tf — no application code names it, and no
# environment variable points at it.
#
# Left in place rather than removed: it exists in the live account and in
# state, and deleting a table is not something to do as a side effect of
# quietening a linter. Remove it deliberately, or give it a purpose.
#
# Point-in-time recovery is skipped rather than switched on for the same
# reason. PITR on a table nothing writes to is a monthly charge for backing up
# nothing; the honest fix here is deciding the table's fate, not buying it a
# backup. Scoped to this resource, so `resumes` and `analyses` — which both
# have PITR enabled and need it — still fail the check if theirs is removed.
resource "aws_dynamodb_table" "users" {
  #checkov:skip=CKV_AWS_28:Unused table, nothing writes to it; see the note above. Decide whether to delete it rather than backing up an empty table.
  name         = "${var.project_name}-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "username"

  attribute {
    name = "username"
    type = "S"
  }
}