# Build React application

FROM node:22.14-alpine AS build

# Set via --build-arg by .github/workflows/deploy.yml, from the repo-root
# VERSION file and the commit SHA. Must be ENV (not just ARG) before
# `npm run build` runs - vite.config.js's `define` block reads these through
# process.env at build time, and ARG alone isn't visible to RUN commands.
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ENV APP_VERSION=${APP_VERSION}
ENV GIT_SHA=${GIT_SHA}

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build


# Serve static files

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]