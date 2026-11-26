# Caddy с модулем layer4: он отдаёт TURN по TLS на том же порту 443, что и сайт.
# Сети, где закрыто всё, кроме 443, иначе остались бы без голоса.
# Версии закреплены: если caddy-l4 поменяет синтаксис, Caddy не стартует, и ляжет
# всё сразу (сайт, сигналинг, TURN/TLS). caddy-l4 v0.1.2 собран под Caddy v2.11.4.
FROM caddy:2.11.4-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-l4@v0.1.2

FROM caddy:2.11.4
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
