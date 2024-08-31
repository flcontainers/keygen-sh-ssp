# Base image for Node.js applications
ARG NODE_BASE_IMAGE=stable-alpine
FROM nginx:${NODE_BASE_IMAGE}

ARG APPLICATION="keygen-sh-ssp"
ARG BUILD_RFC3339="2024-08-30T20:00:00Z"
ARG REVISION="local"
ARG DESCRIPTION="Fully Packaged Self-Service Portal for Keygen.sh with keycloak SSO"
ARG PACKAGE="flcontainers/keygen-sh-ssp"
ARG VERSION="0.1.0"

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
RUN mkdir -p /app/node/portal

# Install nginx
RUN apk add --no-cache nodejs yarn

# Build Portal
WORKDIR /app/node/portal
COPY portal/ .
RUN yarn

# Change rights
#RUN chown www-data:www-data -R /app/node

# Copy Nginx configuration file
COPY nginx/proxy.conf /etc/nginx/conf.d/default.conf

# Copy a custom startup script
COPY script/startup.sh /startup.sh
RUN chmod +x /startup.sh

WORKDIR /app/node/portal
#USER www-data

EXPOSE 80
CMD ["/startup.sh"]