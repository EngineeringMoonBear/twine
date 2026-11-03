// Twine feedback relay: turns an in-app note into a GitHub issue,
// so reviewers can send feedback without a GitHub account.
const KINDS = ["Idea", "Confusing", "Bug", "Love it", "Missing"];
const MAX = { note: 4000, screen: 200, context: 1000, name: 80 };

// Strips control characters, trims, and caps length.
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
// A zero-width space after "@" keeps mentions readable without pinging anyone.
const noPing = s => s.replace(/@/g, "@​");
// Shows reviewer text as typed: entities and HTML display literally (so "&#64;" can't become a ping),
// a line can't pose as one of the issue's own headings, and images can't load.
const safeText = s => noPing(s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
  .replace(/^(\s*)#/gm, "$1\\#").replace(/!\[/g, "!\\[");
// Keeps reviewer text from closing the code fence it sits in.
const unfence = s => s.replace(/`{3,}/g, m => m.split("").join("​"));

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors } });
}

export function buildIssue(input) {
  const raw = clean(input.note, MAX.note);
  if (!raw) return null;
  const note = safeText(raw);
  const kind = KINDS.includes(input.kind) ? input.kind : "Idea";
  const rawScreen = clean(input.screen, MAX.screen) || "Unknown screen";
  const screen = safeText(rawScreen);
  const name = safeText(clean(input.name, MAX.name));
  const context = unfence(noPing(clean(input.context, MAX.context)));
  // Titles are plain text on GitHub, so they only need the no-ping guard.
  const firstLine = raw.split("\n")[0].slice(0, 60);
  return {
    title: noPing(`[${kind}] ${rawScreen}: ${firstLine}`),
    body: [
      `### Your feedback`, note, ``,
      `### Screen`, screen, ``,
      `### From`, name || "Anonymous reviewer", ``,
      `### App and device details`, "```", context || "None sent", "```", ``,
      `<sub>Sent from the in-app Feedback button via the twine-feedback relay.</sub>`,
    ].join("\n"),
    labels: ["feedback"],
  };
}

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const cors = allowed.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" }
      : {};
    const { pathname } = new URL(request.url);

    if (pathname !== "/feedback") return json({ error: "Not found" }, 404, {});
    if (request.method === "OPTIONS") return new Response(null, { status: cors["Access-Control-Allow-Origin"] ? 204 : 403, headers: cors });
    if (request.method !== "POST") return json({ error: "Use POST" }, 405, cors);
    if (!cors["Access-Control-Allow-Origin"]) return json({ error: "This site can't send feedback here." }, 403, {});

    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") || "unknown" });
      if (!success) return json({ error: "That's a lot of notes at once. Try again in a minute." }, 429, cors);
    }

    if (Number(request.headers.get("Content-Length") || 0) > 16_000) return json({ error: "That note is too long." }, 413, cors);
    let input;
    try { input = await request.json(); } catch { return json({ error: "Couldn't read that note. Try again." }, 400, cors); }
    // Honeypot: the field is hidden from people, so only bots fill it in. Pretend it worked.
    if (input?.website) return json({ ok: true }, 200, cors);

    const issue = buildIssue(input || {});
    if (!issue) return json({ error: "Write a note first." }, 400, cors);
    if (!env.GITHUB_TOKEN) return json({ error: "Feedback isn't set up yet. Use Copy instead." }, 503, cors);

    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "twine-feedback-relay",
      },
      body: JSON.stringify(issue),
    });
    if (!res.ok) {
      console.log("GitHub rejected the issue", res.status, (await res.text()).slice(0, 300));
      return json({ error: "Couldn't send it right now. Use Copy instead." }, 502, cors);
    }
    const { number } = await res.json();
    return json({ ok: true, number }, 201, cors);
  },
};
