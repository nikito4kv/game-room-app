# Образ сайта Game Room для своего сервера (см. deploy/README.md).
# NEXT_PUBLIC_* Next.js вшивает в сборку, поэтому они приходят как build-args — из
# них же next.config.ts собирает Content-Security-Policy (адреса LiveKit, Sentry,
# PostHog). Без них клиент не узнает адрес LiveKit, а CSP его не пропустит.

# Версия закреплена: случайная пересборка не притащит непроверенный Node.
ARG NODE_IMAGE=node:22.23.3-alpine3.24

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_LIVEKIT_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${NODE_IMAGE}
WORKDIR /app
# Версия сборки для /api/internal/health (up.sh: git rev-parse --short HEAD, date -u).
# Объявлены в последней стадии: смена коммита не сбрасывает кэш npm ci и сборки.
ARG GIT_COMMIT=""
ARG BUILT_AT=""
ENV GIT_COMMIT=${GIT_COMMIT} \
    BUILT_AT=${BUILT_AT}
# HOSTNAME=0.0.0.0 — чтобы образ работал и в обычной сети Docker. На сервере
# compose.yaml переопределяет его на 127.0.0.1: там host-сеть, и сайт должен быть
# виден только через Caddy.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Файлы принадлежат node: Next пишет кэш в .next/cache, root-файлы ему не дали бы.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Шрифты OG-картинок читаются через fs в рантайме — трассировка standalone их не видит.
COPY --from=build --chown=node:node /app/assets ./assets
USER node
# Живой ли сервер: статичный favicon без рендера страниц и без походов в Redis/LiveKit.
# wget — из busybox, curl в alpine-образе нет; sh -c — ради $PORT.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["sh", "-c", "wget -q -O /dev/null http://127.0.0.1:$PORT/favicon.ico || exit 1"]
CMD ["node", "server.js"]
