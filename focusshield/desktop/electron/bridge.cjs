const http = require("node:http");

const BRIDGE_PORT = 43117;

function sendJson(response, status, body, origin = "*") {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function isTrustedPairingOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    return (
      url.protocol === "https:" &&
      (url.hostname === "mysession.club" ||
        url.hostname === "www.mysession.club" ||
        url.hostname.endsWith(".vercel.app"))
    ) || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) reject(new Error("body_too_large"));
    });
    request.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { reject(new Error("invalid_json")); }
    });
    request.on("error", reject);
  });
}

function createExtensionBridge({ getPolicy, updatePolicy, connectAccount }) {
  const server = http.createServer(async (request, response) => {
    const origin = String(request.headers.origin || "");
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {}, origin || "*");
      return;
    }

    if (request.url === "/v1/connect") {
      if (request.method !== "POST" || !isTrustedPairingOrigin(origin)) {
        sendJson(response, 403, { ok: false, error: "untrusted_origin" }, origin || "null");
        return;
      }
      try {
        const body = await readBody(request);
        const result = await connectAccount(body);
        sendJson(response, result.ok ? 200 : 401, result, origin);
      } catch (error) {
        sendJson(response, 400, { ok: false, error: String(error?.message || "invalid_request") }, origin);
      }
      return;
    }

    if (request.url !== "/v1/policy") {
      sendJson(response, 404, { error: "not_found" });
      return;
    }

    if (request.method === "GET") {
      sendJson(response, 200, { ok: true, policy: getPolicy() });
      return;
    }

    if (request.method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }

    try {
      const body = await readBody(request);
      const result = updatePolicy(body.policy || {}, "extension");
      if (!result.ok) {
        sendJson(response, result.status || 409, result);
        return;
      }
      sendJson(response, 200, result);
    } catch {
      sendJson(response, 400, { ok: false, error: "invalid_json" });
    }
  });

  server.on("error", (error) => {
    console.warn("FocusShield extension bridge unavailable", error.message);
  });
  server.listen(BRIDGE_PORT, "127.0.0.1");
  return server;
}

module.exports = { BRIDGE_PORT, createExtensionBridge };
