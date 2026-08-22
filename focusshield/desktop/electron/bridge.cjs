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
  const commands = [];
  const commandResults = new Map();
  const commandWaiters = new Set();

  function takeCommand() {
    return commands.find((command) => !command.delivered) || null;
  }

  function wakeCommandWaiters() {
    for (const wake of commandWaiters) wake();
    commandWaiters.clear();
  }

  function enqueueCommand(type, payload = {}, timeoutMs = 8_000) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const command = { id, type, payload, createdAt: Date.now(), delivered: false };
    commands.push(command);
    wakeCommandWaiters();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        commandResults.delete(id);
        const index = commands.findIndex((item) => item.id === id);
        if (index >= 0) commands.splice(index, 1);
        resolve({ ok: false, error: "extension_unavailable" });
      }, timeoutMs);
      commandResults.set(id, (result) => {
        clearTimeout(timer);
        commandResults.delete(id);
        const index = commands.findIndex((item) => item.id === id);
        if (index >= 0) commands.splice(index, 1);
        resolve(result || { ok: false, error: "empty_extension_result" });
      });
    });
  }
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

    if (request.url === "/v1/commands/next" && request.method === "GET") {
      let command = takeCommand();
      if (!command) {
        await new Promise((resolve) => {
          let timer = null;
          const wake = () => {
            if (timer) clearTimeout(timer);
            commandWaiters.delete(wake);
            resolve();
          };
          timer = setTimeout(wake, 20_000);
          commandWaiters.add(wake);
        });
        command = takeCommand();
      }
      if (!command) {
        response.writeHead(204, {
          "Access-Control-Allow-Origin": origin || "*",
          "Access-Control-Allow-Private-Network": "true",
          "Cache-Control": "no-store",
        });
        response.end();
        return;
      }
      command.delivered = true;
      sendJson(response, 200, {
        ok: true,
        command: {
          id: command.id,
          type: command.type,
          payload: command.payload,
        },
      }, origin || "*");
      return;
    }

    if (request.url === "/v1/commands/result" && request.method === "POST") {
      try {
        const body = await readBody(request);
        const resolveResult = commandResults.get(String(body.id || ""));
        if (!resolveResult) {
          sendJson(response, 404, { ok: false, error: "command_not_found" }, origin || "*");
          return;
        }
        resolveResult(body.result || { ok: false, error: "empty_extension_result" });
        sendJson(response, 200, { ok: true }, origin || "*");
      } catch {
        sendJson(response, 400, { ok: false, error: "invalid_json" }, origin || "*");
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
  server.enqueueCommand = enqueueCommand;
  return server;
}

module.exports = { BRIDGE_PORT, createExtensionBridge };
