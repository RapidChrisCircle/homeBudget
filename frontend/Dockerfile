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

# /etc/nginx/templates/*.template - not conf.d/default.conf directly - is a
# convention the base image's own entrypoint scripts already provide: on
# startup, before nginx itself starts, it runs `envsubst` over every
# *.template file here and writes the result to the matching path under
# conf.d/, picking up API_UPSTREAM (below) from this container's own
# environment. No custom entrypoint script needed - CMD is overridden below,
# not ENTRYPOINT, so the base image's own entrypoint (which does this
# substitution, then execs CMD) still runs first.
#
# NGINX_ENVSUBST_FILTER restricts substitution to variables matching this
# pattern - without it, envsubst would also try to substitute nginx's OWN
# runtime variables ($host, $uri, $request_uri, $remote_addr) that
# nginx.conf uses, silently blanking them since they are not environment
# variables of this container.
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=^API_UPSTREAM$
# Default here matches docker-compose.qnap.yml's own default for
# API_UPSTREAM - this container can still run (e.g. `docker run` outside
# that compose file entirely) without the variable being set explicitly.
ENV API_UPSTREAM=homebudget-api:8000

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]