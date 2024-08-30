#!/bin/sh

# Start the backend application
yarn --cwd /app/node/portal server &

# Start the client application
yarn --cwd /app/node/portal build

# Start Nginx in the foreground
nginx -g 'daemon off;'