# THIS ENTIRE REPO IS VIBE-CODED (EVEN THIS README). YOU HAVE BEEN WARNED.

For a proper proxy setup, use nginx https://github.com/osu-community-tournaments/osu-api-proxy

# osu! API Proxy

This is a self-contained local Node proxy for the osu! API. It runs directly on your machine, without Wrangler or Cloudflare Workers.

## What you get

- A local proxy at `http://127.0.0.1:8787`
- A simple tunnel setup with `cloudflared` so outside clients can reach your local instance
  - Note: Cloudflare caches aggressively, which can cause stale results (e.g. lobby stats after a match ends). Use **Caching → Cache Rules** in your domain settings to bypass it if needed.
- No domain? Other free tunnel options that give you a public URL without owning a domain:
  - [ngrok](https://ngrok.com/) - stable, widely used, free tier gives a random `*.ngrok-free.app` URL; run `ngrok http 8787`
  - [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) - no account needed, run `cloudflared tunnel --url http://127.0.0.1:8787` (see Option 1 below)
  - [localhost.run](https://localhost.run/) - no install, just SSH: `ssh -R 80:localhost:8787 nokey@localhost.run`
  - [Serveo](https://serveo.net/) - similar to localhost.run: `ssh -R 80:localhost:8787 serveo.net`

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

Test it by going to `http://localhost:8787/health` in your browser or terminal.

You should get a JSON response like:

```json
{
  "status": "ok",
  "proxy": "osu-api-proxy",
  "usage": "Replace https://osu.ppy.sh with this server's URL in your requests."
}
```

## Expose your local proxy with cloudflared


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

### Option 3: Cloudflare Tunnel via the Web Dashboard

This is the easiest approach if you prefer a GUI over the CLI. You configure everything from the Cloudflare dashboard - no CLI tunnel setup required.

#### Prerequisites

- A Cloudflare account (free tier works)
- A domain added to Cloudflare (i.e. its nameservers point to Cloudflare)
- The `cloudflared` daemon installed locally - only needed to **run** the tunnel, not to configure it

#### Step 1 - Open the Tunnels page

1. Go to [https://dash.cloudflare.com/](https://dash.cloudflare.com) and log in.
2. In the left sidebar, select **Networks → Tunnels**.
3. Click **Create Tunnel**.

#### Step 2 - Create a new tunnel

1. Choose **Cloudflared** as the connector type, then click **Next**.
2. Give your tunnel a name (e.g. `osu-api-proxy`) and click **Save tunnel**.

#### Step 3 - Install & run the connector

The dashboard will show you a one-liner install command. Copy and run it in a terminal on the machine running the proxy.

**Windows (PowerShell):**

```powershell
# The dashboard generates a command like this - copy yours directly from the UI:
cloudflared service install <YOUR_TUNNEL_TOKEN>
```

This registers `cloudflared` as a Windows service so the tunnel starts automatically on boot.

To run it manually instead of as a service:

```powershell
cloudflared tunnel run --token <YOUR_TUNNEL_TOKEN>
```

Once the connector is running, the dashboard will show it as **Connected**. Click **Next**.

#### Step 4 - Add a public hostname

1. In the **Public Hostname** tab, click **Add a public hostname**.
2. Fill in the fields:

| Field | Value |
| --- | --- |
| **Subdomain** | e.g. `osu-proxy` |
| **Domain** | your domain managed by Cloudflare |
| **Type** | `HTTP` |
| **URL** | `http://127.0.0.1:8787` |

3. Click **Save `<hostname>`**.

Your proxy is now reachable at `https://osu-proxy.yourdomain.com` - no DNS records to create manually, Cloudflare handles it automatically.

#### Step 5 - (Optional) Disable caching for live data

By default Cloudflare may cache API responses, which can cause stale results (e.g. lobby stats after a match ends). To bypass caching:

1. In the Cloudflare dashboard go to your domain → **Caching → Cache Rules**.
2. Create a new rule matching your proxy subdomain (e.g. `osu-proxy.yourdomain.com/*`).
3. Set **Cache eligibility** to **Bypass cache**.
4. Save and deploy the rule.

---

## Optional: Protect the proxy with a secret

By default, anyone who knows the proxy URL can use it. You can restrict access by setting a shared secret.

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
| Query parameter for API v2 | `https://your-proxy.example.com/api/v2/...?proxy_secret=your-secret-here` |
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
