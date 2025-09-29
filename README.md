# Keygen Self-Service Portal
(with OIDC authentication, e.g. Authentik, Keycloak)

This is based on an example made by the keygen.sh team [here](https://github.com/keygen-sh/example-react-licensing-portal)...

The portal offers the following functionality:

- License information (e.g. expiration date)
- Machine deactivation
- Protection behind SSO Portal
- Admin portal
- Env variables

## Environment Variables
_Note: Mandatory variables marked with *_  
_Note: You can use a local `.env` at the root of the application or container variables._

### OIDC Authentication Data (e.g. Authentik, Keycloak)
- OIDC_ISSUER * (Base URL of your OIDC provider, e.g. `https://auth.example.com`)
- OIDC_CLIENT_ID * (Client ID registered with your OIDC provider)
- OIDC_CLIENT_SECRET * (Client secret registered with your OIDC provider)
- OIDC_REDIRECT_URI * (Redirect URI registered with your OIDC provider, e.g. `https://your-app-domain.com`)
- OIDC_ROLES_PROPERTY (Name of the property in the OIDC user payload that contains user roles, e.g. `roles`, `groups`)

### Keygen Data
- KEYGEN_URL * (URL of the Keygen server, e.g. `https://key.myserver.org`)
- KEYGEN_ACCOUNT_ID * (Keygen account ID)
- KEYGEN_TOKEN * (Keygen admin bearer token)

### Other Data
- SESSION * (Session secret for your portal)

### Example `.env`
```
OIDC_ISSUER=https://auth.example.com
OIDC_CLIENT_ID=my-client-id
OIDC_CLIENT_SECRET=my-client-secret
OIDC_REDIRECT_URI=https://your-app-domain.com
OIDC_ROLES_PROPERTY=roles
SESSION=your-session-secret

KEYGEN_URL=https://key.myserver.org
KEYGEN_ACCOUNT_ID=your-keygen-account-id
KEYGEN_TOKEN=your-keygen-admin-token
```

## Role-Based Access

The app uses the `OIDC_ROLES_PROPERTY` variable to determine which property in the OIDC user payload contains the user's roles.  
Set this to match your OIDC provider's payload (e.g., `roles`, `groups`, etc.).
The app will look for the "Administrator" value in the property selected...

## Environment variables

Important OIDC-related variables:

- BASE_APP_URL (new)
  - The origin of your application (scheme + host[:port]), e.g. `http://localhost:3000`.
  - When set, this value is used as the OIDC client's baseURL (origin). This is preferred to avoid hardcoding URLs.
- OIDC_REDIRECT_URI
  - The full redirect/callback URL registered with your OIDC provider, e.g. `http://localhost:3000/auth/callback`.
  - If this includes a path, that path will be used as the callback route.
- OIDC_CALLBACK_PATH (optional)
  - If OIDC_REDIRECT_URI has no path (or is not set), this path is used as the callback (default: `/auth/callback`).

Behavior summary:
- If BASE_APP_URL is provided, it's used as the OIDC baseURL origin.
- If OIDC_REDIRECT_URI contains a path, that path is used as the callback route.
- If OIDC_REDIRECT_URI is root-only (no path) or absent, OIDC_CALLBACK_PATH (or `/auth/callback`) will be used.
- Ensure the redirect/callback registered in your OIDC provider matches the resolved baseURL + callback path.

Examples:
- Single env value approach:
  - BASE_APP_URL=http://localhost:3000
  - OIDC_REDIRECT_URI=http://localhost:3000/auth/callback
- Split approach:
  - BASE_APP_URL=http://localhost:3000
  - OIDC_CALLBACK_PATH=/auth/callback

Restart the app after updating environment variables.