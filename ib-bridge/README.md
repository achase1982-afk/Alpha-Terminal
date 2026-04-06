# IB Gateway WebSocket Bridge

Run this on your Mac alongside IB Gateway. It wraps the IB TCP protocol
in WebSocket so Cloudflare Tunnel can carry it.

## Setup (one time)

```bash
cd ib-bridge
npm install
```

## Run

```bash
node bridge.mjs
```

IB Gateway must be running on localhost:4001 (the default).

## Environment variables (optional)

- `IB_HOST` — IB Gateway host (default: 127.0.0.1)
- `IB_PORT` — IB Gateway port (default: 4001)
- `BRIDGE_PORT` — WebSocket listen port (default: 7497)

## Cloudflare Tunnel

Update your tunnel's public hostname route:
- Service type: **HTTP** (not TCP)
- URL: `localhost:7497`
