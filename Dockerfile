# Base image for Node.js applications
FROM node:lts-alpine

ARG APPLICATION="keygen-sh-ssp"
ARG BUILD_RFC3339="2024-12-29T16:00:00Z"
ARG REVISION="local"
ARG DESCRIPTION="Fully Packaged Self-Service Portal for Keygen.sh with keycloak SSO"
ARG PACKAGE="flcontainers/keygen-sh-ssp"
ARG VERSION="1.0.0"

LABEL org.opencontainers.image.ref.name="${PACKAGE}" \
  org.opencontainers.image.created=$BUILD_RFC3339 \
  org.opencontainers.image.authors="MaxWaldorf" \
  org.opencontainers.image.documentation="https://github.com/${PACKAGE}/README.md" \
  org.opencontainers.image.description="${DESCRIPTION}" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.source="https://github.com/${PACKAGE}" \
  org.opencontainers.image.revision=$REVISION \
  org.opencontainers.image.version=$VERSION \
  org.opencontainers.image.url="https://hub.docker.com/r/${PACKAGE}/"

# Set production for nodejs
ENV NODE_ENV=production

# node app directory
RUN mkdir -p /app/node
RUN mkdir -p /app/node/sessions

# Install required packages
RUN apk add --no-cache yarn netcat-openbsd sqlite sqlite-dev

# Build Portal
WORKDIR /app/node
COPY app/ .

# Production build with error logging
RUN yarn install --production \
    && yarn cache clean

# Add healthcheck with proper logging
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD nc -z localhost 3000 || (echo "Health check failed" && exit 1)

# Add startup script with error handling first
COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

# Create non-root user and set permissions after chmod
RUN adduser -D nodeuser && \
    chown -R nodeuser:nodeuser /app/node && \
    chown nodeuser:nodeuser /docker-entrypoint.sh && \
    chown -R nodeuser:nodeuser /app/node/sessions

# Switch to non-root user
USER nodeuser

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["yarn", "start"]