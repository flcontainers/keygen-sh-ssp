#!/bin/sh
set -e

check_env_vars() {
    local missing_vars=0
    local required_vars="KEYCLOAK_ID KEYCLOAK_REALM KEYCLOAK_URL KEYCLOAK_SECRET KEYGEN_URL KEYGEN_ACCOUNT_ID KEYGEN_TOKEN SESSION"

    for var in $required_vars; do
        if [ -z "$(eval echo \${$var})" ]; then
            if [ -f ".env.production" ]; then
                echo "Loading .env.production file..."
                export $(cat .env.production | grep -v '^#' | xargs)
            elif [ -f ".env" ]; then
                echo "Loading .env file..."
                export $(cat .env | grep -v '^#' | xargs)
            fi
            
            if [ -z "$(eval echo \${$var})" ]; then
                echo "Error: $var is not set"
                missing_vars=1
            fi
        fi
    done

    # Validate Keycloak URL format
    if ! echo "$KEYCLOAK_URL" | grep -q "^https\?://"; then
        echo "Error: KEYCLOAK_URL must start with http:// or https://"
        missing_vars=1
    fi

    return $missing_vars
}

check_env_vars
exec "$@"