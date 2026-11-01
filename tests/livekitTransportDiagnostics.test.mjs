import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const load = async (entry) => {
  const out = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
  const mod = { exports: {} };
  new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
  return mod.exports;
};
const diag = await load("src/lib/livekitTransportDiagnostics.ts");
const failure = await load("src/lib/livekitConnectFailure.ts");

test("browser brands tell Brave and Edge apart from Chrome", () => {
  const nav = { userAgentData: { brands: [{ brand: "Brave", version: "156" }, { brand: "Not)A;Brand", version: "8" }, { brand: "Chromium", version: "156" }] } };
  assert.deepEqual(diag.getBrowserBrands(nav), ["Brave 156", "Chromium 156"]);
  assert.deepEqual(diag.getBrowserBrands({}), []);
});

test("ICE servers are logged as URLs only, never credentials", () => {
  const urls = diag.describeIceServerUrls({ iceServers: [
    { urls: ["turns:turn-next.example:443?transport=tcp"], username: "u", credential: "secret" },
    { urls: ["stun:stun.example:3478"] },
  ] });
  assert.deepEqual(urls, ["turns:turn-next.example:443?transport=tcp", "stun:stun.example:3478"]);
  assert.doesNotMatch(JSON.stringify(urls), /secret/);
});

test("the selected candidate pair shows relay over TLS without addresses", () => {
  const report = new Map([
    ["T1", { id: "T1", type: "transport", selectedCandidatePairId: "P1" }],
    ["P1", { id: "P1", type: "candidate-pair", localCandidateId: "L1", remoteCandidateId: "R1", state: "succeeded", currentRoundTripTime: 0.084 }],
    ["L1", { id: "L1", type: "local-candidate", candidateType: "relay", protocol: "udp", relayProtocol: "tls", networkType: "wifi", address: "10.0.0.2" }],
    ["R1", { id: "R1", type: "remote-candidate", candidateType: "host", protocol: "udp", address: "1.2.3.4" }],
  ]);
  const pair = diag.readSelectedCandidatePair(report);
  assert.deepEqual(pair, { localType: "relay", localProtocol: "udp", relayProtocol: "tls", networkType: "wifi", remoteType: "host", remoteProtocol: "udp", rttMs: 84 });
  assert.doesNotMatch(JSON.stringify(pair), /10\.0\.0\.2|1\.2\.3\.4/);
  assert.equal(diag.readSelectedCandidatePair(new Map()), null);
});

test("a failed media connection tells the user about VPNs", () => {
  assert.equal(failure.connectFailureUserMessage("pc_connection", "could not establish pc connection"), failure.NETWORK_BLOCKED_CONNECT_MESSAGE);
  assert.match(failure.NETWORK_BLOCKED_CONNECT_MESSAGE, /VPN/);
  assert.equal(failure.connectFailureUserMessage("timeout", "timed out"), "timed out");
});
