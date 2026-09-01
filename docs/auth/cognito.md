# Cognito authentication setup

The application code is ready to connect to an existing Amazon Cognito user
pool. It deliberately does not contain AWS credentials and cannot create the
pool without access to the AWS account.

## Required Cognito configuration

Create a **user pool** for email registration and login. An identity pool is not
needed because the browser does not call AWS services directly.

Configure the user pool with:

- Email as the username and an auto-verified attribute.
- A password policy of at least 12 characters with uppercase, lowercase,
  numbers, and symbols.
- A **public app client with no client secret**.
- `ALLOW_USER_SRP_AUTH` on the app client. Do not enable
  `ALLOW_USER_PASSWORD_AUTH` for this browser flow.
- Token revocation and refresh-token rotation. When rotation is enabled, do not
  enable `ALLOW_REFRESH_TOKEN_AUTH`; Amplify uses the compatible refresh API.
- TOTP MFA enabled and required for production. The existing authentication card
  supports TOTP enrollment and TOTP-code challenges.
- Email confirmation by code. Do not admin-confirm normal sign-ups because that
  bypasses proof of email ownership.

The corresponding app-client shape is:

```powershell
aws cognito-idp create-user-pool-client `
  --user-pool-id <pool-id> `
  --client-name myway-web `
  --no-generate-secret `
  --explicit-auth-flows ALLOW_USER_SRP_AUTH `
  --enable-token-revocation `
  --refresh-token-rotation Feature=ENABLED,RetryGracePeriodSeconds=30
```

If an existing app client must be changed, first run
`describe-user-pool-client`, then re-send every existing field along with the
change. Cognito's `update-user-pool-client` operation is a full replacement and
silently resets omitted settings.

## Local environment

Copy `frontend/meong-my-way/.env.example` to
`frontend/meong-my-way/.env.local` and replace the placeholders:

```dotenv
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-southeast-1_xxxxxxxxx
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

Restart `npm run dev` after changing these values. They are public identifiers
that are bundled into the browser build. Never add a Cognito client secret,
`AWS_ACCESS_KEY_ID`, or `AWS_SECRET_ACCESS_KEY` to a `NEXT_PUBLIC_*` variable.

## Implemented flow

1. The existing login card registers an email and password with Amplify Auth.
2. Cognito emails a confirmation code; the same card confirms or resends it.
3. Login uses SRP, so the app client does not need password authentication.
4. Amplify stores and refreshes tokens in `SameSite=Strict` client-readable
   cookies. Production cookies are also `Secure`.
5. The Next.js `POST /api/auth/session` route validates both the access token and
   ID token with `aws-jwt-verify`, including signature, issuer, token use, app
   client, expiration, matching user ID, and verified email.
6. Logout revokes/clears the current Amplify session when token revocation is
   enabled on the app client.

The session endpoint never accepts an email supplied by the browser as identity
and never returns or logs tokens.
