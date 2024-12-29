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

# Install yarn
RUN apk add --no-cache yarn

# Build Portal
WORKDIR /app/node
COPY app/ .
RUN yarn build

EXPOSE 3000
CMD ["yarn", "start"]