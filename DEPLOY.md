# Putting TurboFun online

The server is a long-lived process holding WebSocket connections and running a
60 Hz simulation. That rules out static hosts (Vercel, Netlify, GitHub Pages)
for the server itself — they are built for files and short function calls.

## Fly.io (recommended)

```bash
brew install flyctl          # or: curl -L https://fly.io/install.sh | sh
fly auth signup
fly launch --no-deploy       # answer no to databases; edit fly.toml if needed
fly deploy
fly open                     # your URL, with TLS already in place
```

TLS matters: the page is served over https, so the browser will only allow
`wss://`. The client derives the protocol from the page, so nothing in the code
changes — but a plain-http host would break it.

Google sign-in, if you use it:

```bash
fly secrets set GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
```

…and add `https://your-app.fly.dev` to **Authorized JavaScript origins** in the
Google Cloud console, or sign-in fails in production while working locally.

## What is already in place

- `GET /healthz` returns connections, lobbies and running races. The Fly check
  hits it every 15 s.
- Per-IP limits (`server/limits.js`): 8 concurrent sockets, 40 new connections
  per minute, 3 open rooms, and 140 messages per second per connection, which
  is comfortably above the 60 input packets a real client sends.
- `--trust-proxy` reads `X-Forwarded-For`, so the limits see real addresses
  rather than the load balancer. The Dockerfile sets it; do not remove it
  behind a proxy, and do not set it when the server is directly exposed.
- `SIGTERM` tells every connected client to reconnect before the process exits,
  so a deploy shows a message instead of a silent freeze.

## Capacity, measured

About **50 kbps downstream per player** at 20 snapshots a second. A room of
eight is therefore ~400 kbps outbound. CPU is not the first wall: one shared
vCPU runs many rooms before the 60 Hz loop struggles, and bandwidth runs out
first. Watch `/healthz` and your egress bill, in that order.

## Known limits of this deployment

- **One process, one region.** All rooms live in memory. A restart ends every
  race in progress, and players far from the region pay the latency.
- **No horizontal scaling.** Two machines would not share rooms; that needs a
  router in front and a shared directory of which room lives where.
- **No persistence.** Accounts, coins and results vanish on restart.
