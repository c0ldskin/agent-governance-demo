// Replays one recorded take from ../logs through the live adapter and prints the kit's steps per chapter.
// No agents, no browser: a quick check that real logs become the right steps.   node dev/replay.mjs
import { readFileSync } from "node:fs";
import { createModel } from "../src/live/adapter.js";

const L = new URL("../../logs/", import.meta.url);
const lines = (f) => { try { return readFileSync(new URL(f, L), "utf8").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)); } catch { return []; } };
const items = [
  ...lines("events.jsonl").map((d) => ({ src: "event", d, ts: d.ts })),
  ...lines("gateway.log").map((d) => ({ src: "gateway", d, ts: d.ts })),
  ...lines("attacker.jsonl").map((d) => ({ src: "attacker", d, ts: d.time })),
  ...lines("cloud-model.jsonl").map((d) => ({ src: "cloud", d, ts: d.time })),
  ...lines("governance-audit.log").map((d) => ({ src: "governance", d, ts: d.ts })),
].sort((a, b) => a.ts - b.ts);

// The last window between two resets that holds a whole take (two act-1 runs and three act-2 runs).
const resets = items.map((x, k) => (x.src === "event" && x.d.ev === "reset" ? k : -1)).filter((k) => k >= 0);
let win = null;
for (let j = resets.length - 1; j > 0; j--) {
  const part = items.slice(resets[j - 1] + 1, resets[j]);
  if (part.filter((x) => x.src === "event" && x.d.ev === "run_start").length >= 5) { win = part; break; }
}
const m = createModel();
for (const x of win) m.push(x);
const ch = m.chapters();
for (const [name, steps] of Object.entries({ without: ch.without, with: ch.with, deputy: ch.deputy })) {
  console.log(`\n== ${name}: ${steps?.length ?? 0} steps`);
  for (const s of steps || []) console.log(`  ${s.t.toFixed(1).padStart(5)}s ${s.verdict.padEnd(8)} ${(s.stage || "").padEnd(6)} ${s.title}${s.edges ? "  " + JSON.stringify(s.edges) : ""}`);
}
