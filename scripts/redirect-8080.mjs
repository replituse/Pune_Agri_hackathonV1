import { createServer, request as httpRequest } from "http";

const domain = process.env.REPLIT_DEV_DOMAIN;

if (!domain) {
  console.error("REPLIT_DEV_DOMAIN not set");
  process.exit(1);
}

const APP_PORT = 5000;
const targetUrl = `https://${domain}/`;

function startRedirect(port) {
  createServer((_req, res) => {
    res.writeHead(301, { Location: targetUrl });
    res.end();
  }).listen(port, "0.0.0.0", () => {
    console.log(`Redirect server on port ${port} → ${targetUrl}`);
  });
}

function startProxy(port) {
  createServer((req, res) => {
    const opts = {
      hostname: "127.0.0.1",
      port: APP_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${APP_PORT}` },
    };
    const proxy = httpRequest(opts, (upstream) => {
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res, { end: true });
    });
    proxy.on("error", (err) => {
      console.error("Proxy error:", err.message);
      if (!res.headersSent) res.writeHead(502);
      res.end("Bad Gateway");
    });
    req.pipe(proxy, { end: true });
  }).listen(port, "0.0.0.0", () => {
    console.log(`Proxy server on port ${port} → localhost:${APP_PORT}`);
  });
}

startProxy(18593);
startRedirect(8080);
