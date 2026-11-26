# Self-hosting Game Room

A single-machine setup (tested on Ubuntu 24.04, 2 cores / 12 GB RAM). Comments in the config
files are in Russian; this page is the English overview.

| Service | Role | Ports |
|---|---|---|
| `caddy` | HTTPS for every hostname, TURN/TLS on 443 (layer4 SNI routing) | 80, 443 public |
| `app` | the Next.js site (standalone build) | 127.0.0.1:3000 |
| `livekit` | voice and screen sharing | 127.0.0.1:7880 (signalling), 127.0.0.1:6789 (metrics); public 7881/tcp, 3478/udp (or 443/udp), 50000-60000/udp |
| `redis` + `redis-http` | room state and rate limiting (Upstash-compatible REST wrapper), AOF journal | 127.0.0.1:8079 |

Image versions are pinned in `compose.yaml`, `caddy.Dockerfile` and `../Dockerfile`.

## First run

1. Open ports at your cloud provider: TCP 80, 443, 7881 and UDP 3478, 50000-60000.
2. DNS: `A` records for `APP_DOMAIN`, `RTC_DOMAIN` and `TURN_DOMAIN` pointing to the server.
3. On the server:
   ```bash
   git clone <your fork> game-room && cd game-room
   sudo deploy/bootstrap.sh              # Docker, iptables, UDP buffers; then log in again
   cp deploy/.env.example deploy/.env    # fill in the domains and generate the two secrets
   deploy/up.sh
   ```

## Updating

```bash
git pull && deploy/up.sh
```

`up.sh` does nothing while people are in rooms (it reads `livekit_participant_total` from the
LiveKit metrics): a build eats CPU and restarting LiveKit or Caddy drops calls. Override with
`FORCE=1 deploy/up.sh`. LiveKit and Caddy are recreated only when their config hash changes.

## Notable details

- **TURN over port 443.** Caddy terminates TLS for the TURN hostname (layer4 SNI match) and
  forwards plain TCP to LiveKit on 5349 with a PROXY protocol v2 header, so TURN sees the real
  client address. This lets clients behind networks that only allow web traffic connect. The
  `Caddyfile` and `livekit.yaml.template` must agree on `proxy_protocol`.
- **Optional TURN/UDP on 443.** Set `TURN_UDP_PORT=443` in `deploy/.env`, rerun
  `sudo deploy/bootstrap.sh` and `deploy/up.sh` (HTTP/3 is disabled in Caddy, so the port is free).
- **Redis journal.** `redis-aof.sh` switches AOF on for a running Redis before the container is
  recreated with `--appendonly yes`; without it a fresh container would ignore `dump.rdb`.
- **Rooms are created only by the site.** `room.auto_create: false` in the LiveKit config, so an
  old token cannot resurrect an empty room.

## Checks

- `curl -sI https://<APP_DOMAIN>` shows `strict-transport-security`, `content-security-policy`,
  `x-frame-options`.
- `docker compose -f deploy/compose.yaml ps` - services with a healthcheck report `healthy`.
- People currently in rooms: `curl -s 127.0.0.1:6789/metrics | grep ^livekit_participant_total`.
