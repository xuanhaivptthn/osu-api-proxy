# THIS ENTIRE REPO IS VIBE-CODED (EVEN THIS README). YOU HAVE BEEN WARNED.

# osu! API Proxy

This is a self-contained local Node proxy for the osu! API. It runs directly on your machine, without Wrangler or Cloudflare Workers.

## What you get

- A local proxy at `http://127.0.0.1:8787`
- A simple tunnel setup with `cloudflared` so outside clients can reach your local instance
- Feel free to use something else, like https://ngrok.com/ 

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or newer
- `cloudflared` if you want to expose your local proxy

## Run locally

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/osu-api-proxy.git
cd osu-api-proxy
npm install
npm start
```

`npm start` builds the TypeScript source and starts the Node server locally. By default it listens on `http://127.0.0.1:8787`.

Security notes:

- Do not commit secrets. Copy `.env.example` to `.env` and set `PROXY_SECRET` there.
- `.gitignore` already excludes `.env`, `dist/`, and `node_modules/`.

Test it with:

```bash
curl http://127.0.0.1:8787/health
```

You should get a JSON response like:

```json
{
  "status": "ok",
  "proxy": "osu-api-proxy",
  "usage": "Replace https://osu.ppy.sh with this server's URL in your requests."
}
```

## Expose your local proxy with cloudflared

You can also setup using the Tunnels page in your domain config

### Option 1: Quick temporary tunnel

This is the fastest way to expose your local proxy without creating DNS records:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

Cloudflared will print a public `https://...trycloudflare.com` URL. Point your client, script, or sheet at that URL instead of the local one.

This option is useful for testing, but the URL changes every time you restart the tunnel.

### Option 2: Named tunnel with a stable hostname

Use this if you want a persistent public address like `https://osu-proxy.yourdomain.com`.

1. Authenticate cloudflared with your Cloudflare account:

```bash
cloudflared tunnel login
```

2. Create a tunnel:

```bash
cloudflared tunnel create osu-api-proxy
```

3. Route a hostname to that tunnel:

```bash
cloudflared tunnel route dns osu-api-proxy osu-proxy.yourdomain.com
```

4. Create a config file for the tunnel, for example `config.yml`:

```yaml
tunnel: osu-api-proxy
credentials-file: C:\Users\YOUR_USER\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: osu-proxy.yourdomain.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

5. Start the tunnel:

```bash
cloudflared tunnel run osu-api-proxy
```

## Development

Use the fast TypeScript dev server during development:

```bash
npm install
npm run dev
```

This runs `ts-node-dev` and restarts on source changes.

If you prefer, you can also point a custom domain or subdomain to the tunnel through the Cloudflare dashboard instead of using `cloudflared tunnel route dns`.

## Optional: Protect the proxy with a secret

By default, anyone who knows the Worker URL can use the proxy. You can restrict access by setting a shared secret.

### 1. Set the secret in your local environment

On PowerShell:

```powershell
$env:PROXY_SECRET = "your-secret-here"
npm start
```

### 2. Include the secret in requests

Callers must pass the exact same value in one of these ways:

| Method | Example |
| --- | --- |
| Header | `X-Proxy-Secret: your-secret-here` |
| Query parameter for API v2 | `https://your-proxy.example.com/api/v2/... ?proxy_secret=your-secret-here` |
| Query parameter for API v1 | `https://your-proxy.example.com/api/get_beatmaps?k=your-osu-api-key&proxy_secret=your-secret-here` |

The query parameter is stripped before the request is forwarded to osu.ppy.sh, so the upstream API never sees it.

If the secret is set but a request omits it or sends the wrong value, the proxy responds with `401 Unauthorized`.

### 3. Remove the secret

To go back to open access, unset it locally:

```powershell
Remove-Item Env:PROXY_SECRET
```

## Apps Script updates

Replace `https://osu.ppy.sh` with your local tunnel URL or your custom domain.

If you added a secret, also add the header to every `UrlFetchApp` call:

```js
var options = {
  method: "get",
  headers: {
    "Authorization": "Bearer " + osuToken,
    "X-Proxy-Secret": "your-secret-here"
  }
};
var response = UrlFetchApp.fetch(url, options);
```
