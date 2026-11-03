import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import relay, { buildIssue } from "../src/index.js";

const ORIGIN = "https://twine.joshedunbar.com";
const env = { GITHUB_TOKEN: "test-token", GITHUB_REPO: "EngineeringMoonBear/twine", ALLOWED_ORIGINS: `${ORIGIN},http://twine.joshedunbar.com` };
let sent;
beforeEach(() => {
  sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response(JSON.stringify({ number: 7 }), { status: 201 }); };
});
const post = (body, origin = ORIGIN, e = env) => relay.fetch(new Request("https://relay.test/feedback", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
}), e);

test("files an issue and returns its number", async () => {
  const res = await post({ kind: "Bug", screen: "Live", note: "Chat jumps when I scroll", context: "Platform: web", name: "Sam" });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true, number: 7 });
  assert.equal(sent[0].url, "https://api.github.com/repos/EngineeringMoonBear/twine/issues");
  assert.equal(sent[0].init.headers.Authorization, "Bearer test-token");
  const issue = JSON.parse(sent[0].init.body);
  assert.equal(issue.title, "[Bug] Live: Chat jumps when I scroll");
  assert.deepEqual(issue.labels, ["feedback"]);
  assert.match(issue.body, /### From\nSam/);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("rejects other websites", async () => {
  const res = await post({ note: "hi" }, "https://evil.example");
  assert.equal(res.status, 403);
  assert.equal(sent.length, 0);
});

test("answers the CORS preflight only for the app", async () => {
  const ok = await relay.fetch(new Request("https://relay.test/feedback", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
  const no = await relay.fetch(new Request("https://relay.test/feedback", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env);
  assert.equal(ok.status, 204);
  assert.equal(no.status, 403);
});

test("honeypot submissions look accepted but file nothing", async () => {
  const res = await post({ note: "buy now", website: "spam.example" });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 0);
});

test("empty notes are refused", async () => {
  const res = await post({ note: "   " });
  assert.equal(res.status, 400);
  assert.equal(sent.length, 0);
});

test("rate limit turns into a friendly 429", async () => {
  const res = await post({ note: "hi" }, ORIGIN, { ...env, LIMITER: { limit: async () => ({ success: false }) } });
  assert.equal(res.status, 429);
  assert.equal(sent.length, 0);
});

test("a GitHub failure never leaks details to the browser", async () => {
  globalThis.fetch = async () => new Response("Bad credentials", { status: 401 });
  const res = await post({ note: "hi" });
  assert.equal(res.status, 502);
  assert.doesNotMatch(JSON.stringify(await res.json()), /credentials/i);
});

test("mentions can't ping anyone and fences can't be broken", () => {
  const issue = buildIssue({ note: "cc @octocat", context: "```\n## injected" });
  assert.match(issue.body, /@​octocat/);
  assert.doesNotMatch(issue.body.split("### App and device details")[1], /^```\n## injected/m);
});

test("unknown kinds fall back to Idea and long notes are capped", () => {
  const issue = buildIssue({ kind: "<script>", note: "x".repeat(10_000) });
  assert.match(issue.title, /^\[Idea\]/);
  assert.ok(issue.body.length < 4600);
});
