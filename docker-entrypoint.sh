#!/bin/sh
set -e

check_env_vars() {
    local missing_vars=0
    # Updated required variables to match application env names
    local required_vars="OIDC_ISSUER OIDC_CLIENT_ID OIDC_CLIENT_SECRET OIDC_REDIRECT_URI KEYGEN_URL KEYGEN_ACCOUNT_ID KEYGEN_TOKEN"

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

    # If SESSION is not provided, generate a strong random secret and export it
    if [ -z "$SESSION" ]; then
        echo "SESSION not set — generating a random session secret..."
        if command -v openssl >/dev/null 2>&1; then
            SESSION=$(openssl rand -hex 32)
        elif [ -r /dev/urandom ] && command -v sha256sum >/dev/null 2>&1; then
            SESSION=$(head -c 64 /dev/urandom | sha256sum | cut -d' ' -f1)
        elif [ -r /dev/urandom ] && command -v od >/dev/null 2>&1; then
            SESSION=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
        else
            # fallback: timestamp+pid hashed (least preferred)
            SESSION=$(echo "$(date +%s%N)-$$" | (command -v sha256sum >/dev/null 2>&1 && sha256sum | cut -d' ' -f1) || echo "$(date +%s%N)-$$")
        fi
        export SESSION
        echo "Generated SESSION secret."
    fi

    # Validate OIDC_ISSUER format
    if [ -n "$OIDC_ISSUER" ] && ! echo "$OIDC_ISSUER" | grep -qE "^https?://"; then
        echo "Error: OIDC_ISSUER must start with http:// or https://"
        missing_vars=1
    fi

    # Validate KEYGEN_URL format
    if [ -n "$KEYGEN_URL" ] && ! echo "$KEYGEN_URL" | grep -qE "^https?://"; then
        echo "Error: KEYGEN_URL must start with http:// or https://"
        missing_vars=1
    fi

    return $missing_vars
}

check_env_vars
exec "$@"