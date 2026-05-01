import { createServer } from "http";

const PORT = 8080;
const domain = process.env.REPLIT_DEV_DOMAIN;

if (!domain) {
  console.error("REPLIT_DEV_DOMAIN not set");
  process.exit(1);
}

const targetUrl = `https://${domain}/`;

createServer((req, res) => {
  res.writeHead(301, { Location: targetUrl });
  res.end();
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Redirect server on port ${PORT} → ${targetUrl}`);
});
