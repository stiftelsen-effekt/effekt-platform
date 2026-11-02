#!/usr/bin/env node
// A local stand-in for the Vipps API, for the full-stack e2e stack (compose.e2e.yml, service
// `vipps`): the API calls it through VIPPS_API_ORIGIN (apps/api/src/config.js, ignored in
// production). It answers what Min Side's agreement changes need: an access token, reading an
// agreement, changing its price or status, and its charges (none). Agreements are kept in memory;
// one it hasn't seen is ACTIVE. No credentials are checked: it's a stub.
//
//   node scripts/e2e/vipps-stub.mjs            port VIPPS_STUB_PORT (8080)
import { createServer } from "node:http";

const port = Number(process.env.VIPPS_STUB_PORT ?? 8080);
const agreements = new Map();

const agreement = (id) => {
  if (!agreements.has(id)) {
    agreements.set(id, {
      id,
      status: "ACTIVE",
      pricing: { type: "LEGACY", amount: 10000, currency: "NOK" },
      interval: { unit: "MONTH", count: 1 },
      productName: "Gi Effektivt",
    });
  }
  return agreements.get(id);
};

const route = (method, path, body) => {
  if (method === "POST" && path === "/accesstoken/get") {
    return [
      200,
      {
        token_type: "Bearer",
        access_token: "vipps-stub-token",
        expires_on: String(Math.floor(Date.now() / 1000) + 3600),
      },
    ];
  }
  let match = path.match(/^\/recurring\/v3\/agreements\/([^/]+)$/);
  if (match && method === "GET") return [200, agreement(match[1])];
  if (match && method === "PATCH") {
    const current = agreement(match[1]);
    if (current.status === "STOPPED") return [400, { title: "Cannot modify a stopped agreement" }];
    if (body.status) current.status = body.status;
    if (body.pricing) current.pricing = { ...current.pricing, ...body.pricing };
    return [204, null];
  }
  match = path.match(/^\/recurring\/v3\/agreements\/([^/]+)\/charges$/);
  if (match && method === "GET") return [200, []];
  if (path === "/recurring/v3/agreements" && method === "GET") return [200, []];
  return [404, { title: `Not in the Vipps stub: ${method} ${path}` }];
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = {};
  try {
    body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    body = {};
  }
  const [status, payload] = route(req.method ?? "GET", url.pathname, body);
  console.log(`${req.method} ${url.pathname} ${status}`);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload === null ? "" : JSON.stringify(payload));
}).listen(port, () => console.log(`Vipps stub on http://localhost:${port}`));
