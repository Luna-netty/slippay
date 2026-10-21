// MCP stdio smoke test: initialize -> tools/list -> tools/call slippay_verify.
import { spawn } from "node:child_process";

const SPEC = "agent AgentWallet {\n  bind      -> [read_balance, propose_payment]\n  invariant -> sliding_window(ceiling = 2) bound 2\n}\n";
const CERT = JSON.stringify({
  kind: "axl-proof-certificate", axl_version: "0.1.0",
  spec_sha256: "0415df303eb4abf45bc224df6b2d147d1a53933130fccd9889054aff8e35e3be",
  agent: "AgentWallet", invariant: { family: "sliding_window", ceiling: 2, bound: 2 },
  verdict: "ISSUED", tight: true,
  onchain: { ssl_hash: "0415df303eb4abf45bc224df6b2d147d1a53933130fccd9889054aff8e35e3be", window_cap_multiplier: 2 },
});

const child = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
const req = (id, method, params) => new Promise((res) => { pending.set(id, res); send({ jsonrpc: "2.0", id, method, params }); });

const init = await req(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
console.log("initialize:", init.result?.serverInfo?.name, init.result?.serverInfo?.version);
send({ jsonrpc: "2.0", method: "notifications/initialized" });

const list = await req(2, "tools/list", {});
console.log("tools:", list.result.tools.map((t) => t.name).join(", "));

const call = await req(3, "tools/call", { name: "slippay_verify", arguments: { certificate: CERT, spec: SPEC } });
const payload = JSON.parse(call.result.content[0].text);
console.log("slippay_verify.verified:", payload.verified);
console.log("slippay_verify.obligations:", payload.obligations.length);
console.log("slippay_verify.summary:", payload.summary);

// tamper: spec drift must go red
const bad = await req(4, "tools/call", { name: "slippay_verify", arguments: { certificate: CERT, spec: SPEC + "x" } });
console.log("tampered.verified (expect false):", JSON.parse(bad.result.content[0].text).verified);

child.kill();
console.log("SMOKE OK");
