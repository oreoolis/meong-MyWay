# Stored resumes: one active record per user.
#
# The partition key is the Cognito `sub`, with no sort key, so re-uploading
# overwrites in place — a user always has exactly one current resume, and the
# API cannot be tricked into reading someone else's by key manipulation.
# The file bytes live in the uploads bucket (see s3.tf); this table holds the
# pointer and metadata.
resource "aws_dynamodb_table" "resumes" {
  name         = "${var.project_name}-resumes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}
