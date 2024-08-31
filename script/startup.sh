#!/bin/sh

# Start the backend application
yarn --cwd /app/node/portal server &

# Start the client application
yarn --cwd /app/node/portal build

# Check Cloudflare specific case for real IP
sh /cloudflare_nginx.sh

# Start Nginx in the foreground
nginx -g 'daemon off;'