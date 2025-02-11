# Keygen Self-Service Portal
(with Keycloak OpenID authentication)

This is based on an example made by the keygen.sh team [here](https://github.com/keygen-sh/example-react-licensing-portal)...

The portal offers the following functionality:

- License information e.g. expiration date.
- Machine deactivation.
- Protection behind SSO Portal
- Admin portal
- Env variables

## Env Variables
_Note: Mandatory varibales marked with *_

__Keycloak data:__
- KEYCLOAK_ID * (Client ID. Note: client must be public)
- KEYCLOAK_SECRET * (Client secret)
- KEYCLOAK_REALM * (Realm name)
- KEYCLOAK_URL * (URL of the server) / e.g. https://kc.myserver.org/

__Keygen data:__
- KEYGEN_URL * (URL of the server) / e.g. https://key.myserver.org
- KEYGEN_ACCOUNT_ID * (Keygen account Id)
- KEYGEN_TOKEN * (admin -bearer- token)

__Other data:__
- SESSION * (Session secret for your portal)

Note: You can use a local .env at root of the application or container variables...