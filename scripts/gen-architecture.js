/**
 * Regenerates the architecture diagram in the README.
 *
 *   node scripts/gen-architecture.js docs/img
 *
 * Emits architecture-light.svg and architecture-dark.svg, which the README
 * selects between with a <picture> element on prefers-color-scheme.
 *
 * The service icons are the official AWS Architecture Icons (Version
 * 01/30/2026), vendored under docs/img/aws/ and inlined here as <symbol> defs.
 * Inlining is not an optimisation: GitHub renders the diagram through <img>,
 * which blocks every external reference, so a self-contained file is the only
 * kind that displays.
 */

const fs = require("fs");
const path = require("path");

const ICON_DIR = path.join(__dirname, "..", "docs", "img", "aws");
const OUT_DIR = process.argv[2];
if (!OUT_DIR) throw new Error("usage: node scripts/gen-architecture.js <out-dir>");

/* --------------------------------------------------------------------------
 * Icons
 * ------------------------------------------------------------------------ */

const ICONS = {
  bedrock: "bedrock.svg",
  cognito: "cognito.svg",
  dynamodb: "dynamodb.svg",
  s3: "s3.svg",
  iam: "iam.svg",
};

function symbolFor(id, file) {
  const raw = fs.readFileSync(path.join(ICON_DIR, file), "utf8");
  // Strip the outer <svg> wrapper and the <title>; keep the drawing only.
  const inner = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .trim();
  return `<symbol id="ic-${id}" viewBox="0 0 64 64">${inner}</symbol>`;
}

/* --------------------------------------------------------------------------
 * Theme
 * ------------------------------------------------------------------------ */

const THEMES = {
  light: {
    bg: "#ffffff",
    panel: "#f6f8fa",
    panelAlt: "#ffffff",
    border: "#d0d7de",
    borderStrong: "#8c959f",
    text: "#1f2328",
    muted: "#59636e",
    line: "#6e7781",
    awsInk: "#232f3e",
    accent: "#ff9900",
    okBg: "#dafbe1",
    okBorder: "#4ac26b",
  },
  dark: {
    bg: "#0d1117",
    panel: "#161b22",
    panelAlt: "#0d1117",
    border: "#30363d",
    borderStrong: "#6e7681",
    text: "#e6edf3",
    muted: "#9198a1",
    line: "#8b949e",
    awsInk: "#e6edf3",
    accent: "#ff9900",
    okBg: "#0f2b17",
    okBorder: "#2ea043",
  },
};

const FONT =
  "ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

/* --------------------------------------------------------------------------
 * Primitives
 * ------------------------------------------------------------------------ */

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function text(x, y, s, o = {}) {
  const {
    size = 13,
    weight = 400,
    fill = "text",
    anchor = "start",
    font = FONT,
    t,
    opacity = 1,
  } = o;
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${t[fill] || fill}" text-anchor="${anchor}" opacity="${opacity}">${esc(s)}</text>`;
}

function panel(x, y, w, h, o = {}) {
  const { t, fill = "panel", stroke = "border", dash = null, rx = 10, sw = 1.5 } = o;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${t[fill] || fill}" stroke="${t[stroke] || stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}

/** An AWS service: official icon tile plus its name and a one-line role. */
function service(x, y, icon, name, sub, t, o = {}) {
  const { size = 44 } = o;
  let s = `<use href="#ic-${icon}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
  s += text(x + size + 12, y + (sub ? 18 : 27), name, { t, size: 13.5, weight: 600 });
  if (sub) s += text(x + size + 12, y + 35, sub, { t, size: 11.5, fill: "muted" });
  return s;
}

function arrow(x1, y1, x2, y2, t, o = {}) {
  const { dash = null, id = "arw", width = 1.6 } = o;
  return `<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="${t.line}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#${id})"/>`;
}

/** Orthogonal connector: out horizontally, then vertically, then in. */
function elbow(x1, y1, x2, y2, t, o = {}) {
  const { dash = null, id = "arw", width = 1.6, midX = null } = o;
  const mx = midX ?? (x1 + x2) / 2;
  return `<path d="M ${x1} ${y1} H ${mx} V ${y2} H ${x2}" fill="none" stroke="${t.line}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#${id})" stroke-linejoin="round"/>`;
}

function chip(x, y, w, label, t, o = {}) {
  const { h = 26, size = 11.5, fill = "panelAlt", font = MONO } = o;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${t[fill]}" stroke="${t.border}" stroke-width="1"/>` +
    text(x + 10, y + h / 2 + 4, label, { t, size, font })
  );
}

/* --------------------------------------------------------------------------
 * Diagram
 * ------------------------------------------------------------------------ */

function build(t) {
  const W = 1320;
  const H = 930;
  const o = [];

  o.push(`<rect width="${W}" height="${H}" fill="${t.bg}"/>`);

  /* Title ---------------------------------------------------------------- */
  o.push(text(40, 46, "MyWay — AWS Architecture", { t, size: 22, weight: 700 }));
  o.push(
    text(40, 70, "One Next.js deployment. Five Amazon Bedrock agents. No separate backend service.", {
      t,
      size: 13,
      fill: "muted",
    }),
  );

  /* ---------------------------------------------------------------- CLIENT */
  const cx = 40, cy = 100, cw = 250, ch = 150;
  o.push(panel(cx, cy, cw, ch, { t }));
  o.push(text(cx + 18, cy + 28, "CLIENT", { t, size: 10.5, weight: 700, fill: "muted" }));
  o.push(text(cx + 18, cy + 58, "Browser", { t, size: 17, weight: 600 }));
  o.push(text(cx + 18, cy + 82, "React 19 · Tailwind v4", { t, size: 12, fill: "muted" }));
  o.push(text(cx + 18, cy + 102, "Amplify Auth (SRP)", { t, size: 12, fill: "muted" }));
  o.push(text(cx + 18, cy + 128, "One route — a single <Workspace/>", { t, size: 11, fill: "muted" }));

  /* -------------------------------------------------------------- NEXT.JS */
  const nx = 350, ny = 100, nw = 400, nh = 626;
  o.push(panel(nx, ny, nw, nh, { t, fill: "panel" }));
  o.push(text(nx + 18, ny + 28, "COMPUTE — NEXT.JS 16 APP ROUTER", { t, size: 10.5, weight: 700, fill: "muted" }));
  o.push(text(nx + 18, ny + 52, "Pages and API routes, one deployment", { t, size: 12.5, weight: 600 }));

  const chipY = [ny + 74, ny + 108, ny + 142];
  o.push(chip(nx + 18, chipY[0], nw - 36, "/api/auth/session · verifies Cognito JWTs", t));
  o.push(chip(nx + 18, chipY[1], nw - 36, "/api/resume · GET POST DELETE", t));
  o.push(chip(nx + 18, chipY[2], nw - 36, "/api/analysis · GET POST", t));

  const ox = nx + 18, oy = ny + 190, ow = nw - 36, oh = 412;
  o.push(panel(ox, oy, ow, oh, { t, fill: "panelAlt", stroke: "borderStrong" }));
  o.push(text(ox + 14, oy + 24, "Agent Orchestrator", { t, size: 13.5, weight: 600 }));
  o.push(text(ox + 14, oy + 42, "lib/agents/orchestrator.ts", { t, size: 11, fill: "muted", font: MONO }));

  const agents = [
    ["1", "Resume Parser", "PDF/DOCX → profile + embedding"],
    ["2", "Career Planner", "trajectory + ranked paths"],
    ["3", "Resume Improver", "quoted, line-level rewrites"],
    ["4", "Industry Advisor", "roles inside the current sector"],
    ["5", "Career Swapper", "pivot destinations + real gaps"],
  ];
  let ay = oy + 58;
  agents.forEach(([n, name, sub], i) => {
    const h = 48;
    const fan = i >= 2;
    o.push(
      `<rect x="${ox + 14}" y="${ay}" width="${ow - 28}" height="${h}" rx="7" fill="${t.panel}" stroke="${t.border}" stroke-width="1"${fan ? ' stroke-dasharray="4 3"' : ""}/>`,
    );
    o.push(`<circle cx="${ox + 36}" cy="${ay + h / 2}" r="12" fill="${t.accent}"/>`);
    o.push(
      `<text x="${ox + 36}" y="${ay + h / 2 + 4.5}" font-family="${FONT}" font-size="12.5" font-weight="700" fill="#232f3e" text-anchor="middle">${n}</text>`,
    );
    o.push(text(ox + 58, ay + 21, name, { t, size: 12.5, weight: 600 }));
    o.push(text(ox + 58, ay + 37, sub, { t, size: 10.5, fill: "muted" }));
    ay += h + 8;
  });
  o.push(text(ox + 14, oy + oh - 14, "Agents 3–5 fan out concurrently — Promise.allSettled", { t, size: 10.5, fill: "muted" }));

  /* ------------------------------------------------------------ AWS CLOUD */
  const ax = 810, ay0 = 100, aw = 470, ah = 626;
  o.push(panel(ax, ay0, aw, ah, { t, fill: "panelAlt", stroke: "borderStrong", dash: "6 4" }));
  o.push(text(ax + 18, ay0 + 28, "AWS CLOUD", { t, size: 10.5, weight: 700, fill: "awsInk" }));
  o.push(text(ax + aw - 18, ay0 + 28, "Region us-east-1", { t, size: 10.5, fill: "muted", anchor: "end", font: MONO }));

  // Bedrock
  const bx = ax + 18, by = 142, bw = aw - 36, bh = 182;
  o.push(panel(bx, by, bw, bh, { t, fill: "panel" }));
  o.push(service(bx + 16, by + 16, "bedrock", "Amazon Bedrock", "Converse API · temperature 0", t, { size: 46 }));
  o.push(chip(bx + 16, 214, bw - 32, "us.anthropic.claude-haiku-4-5-20251001-v1:0", t, { h: 28 }));
  o.push(text(bx + 16, 258, "Reasoning · all five agents · cross-region inference profile", { t, size: 10.5, fill: "muted" }));
  o.push(chip(bx + 16, 268, bw - 32, "amazon.titan-embed-text-v2:0", t, { h: 28 }));
  o.push(text(bx + 16, 312, "Embeddings · 1024-d resume vectors", { t, size: 10.5, fill: "muted" }));

  // Storage
  const sx = ax + 18, sy = 340;
  o.push(panel(sx, sy, aw - 36, 204, { t, fill: "panel" }));
  o.push(text(sx + 16, sy + 24, "STORAGE", { t, size: 10.5, weight: 700, fill: "muted" }));
  o.push(service(sx + 16, sy + 36, "s3", "Amazon S3", "resume bytes · ≤5 MB · byte-sniffed", t));
  o.push(service(sx + 16, sy + 92, "dynamodb", "DynamoDB · resumes", "one current resume per user", t));
  o.push(service(sx + 16, sy + 148, "dynamodb", "DynamoDB · analyses", "one item per artifact · TTL 30d", t));

  // Identity
  const iy = 560;
  o.push(panel(sx, iy, aw - 36, 148, { t, fill: "panel" }));
  o.push(text(sx + 16, iy + 24, "IDENTITY & ACCESS", { t, size: 10.5, weight: 700, fill: "muted" }));
  o.push(service(sx + 16, iy + 36, "cognito", "Amazon Cognito", "user pool · SRP · TOTP MFA", t));
  o.push(service(sx + 16, iy + 92, "iam", "AWS IAM", "agent-runtime policy · scoped to 2 models", t));

  /* --------------------------------------------------------------- ARROWS */
  // Browser -> Next.js
  o.push(arrow(cx + cw, cy + 62, nx - 6, cy + 62, t));
  o.push(text((cx + cw + nx) / 2, cy + 52, "page loads", { t, size: 10, fill: "muted", anchor: "middle" }));
  o.push(arrow(cx + cw, cy + 104, nx - 6, cy + 104, t));
  o.push(text((cx + cw + nx) / 2, cy + 124, "Bearer ID token", { t, size: 10, fill: "muted", anchor: "middle" }));

  // Next.js -> AWS, orthogonal through a routing channel so crossings are clean
  o.push(elbow(nx + nw, chipY[0] + 13, ax - 6, iy + 58, t, { midX: 766 }));           // auth -> Cognito
  o.push(elbow(nx + nw, chipY[1] + 9, ax - 6, sy + 58, t, { midX: 776 }));            // resume -> S3
  o.push(elbow(nx + nw, chipY[1] + 18, ax - 6, sy + 114, t, { midX: 784 }));          // resume -> DDB resumes
  o.push(elbow(nx + nw, oy + 60, ax - 6, by + 40, t, { midX: 794, width: 2.2 }));     // orchestrator -> Bedrock
  o.push(elbow(nx + nw, oy + 300, ax - 6, sy + 170, t, { midX: 802 }));               // orchestrator -> DDB analyses

  // Browser -> Cognito (SRP), routed under both columns
  o.push(
    `<path d="M ${cx + cw / 2} ${cy + ch} V 738 H 930 V ${iy + 148 + 6}" fill="none" stroke="${t.line}" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#arw)" stroke-linejoin="round"/>`,
  );
  o.push(text(cx + cw / 2 + 12, 732, "SRP sign-in / sign-up (Amplify Auth) — password never leaves the browser", { t, size: 10.5, fill: "muted" }));

  /* ------------------------------------------------------------- EXTERNAL */
  const ex = 40, ey = 756, ew = 710, eh = 78;
  o.push(panel(ex, ey, ew, eh, { t, fill: "panelAlt", dash: "5 4" }));
  o.push(text(ex + 18, ey + 26, "External data — SSG-WSG Skills Framework API", { t, size: 13, weight: 600 }));
  o.push(text(ex + 18, ey + 47, "Ground truth for role titles, sectors and salary bands. Agents 4 and 5 only.", { t, size: 11, fill: "muted" }));
  o.push(text(ex + 18, ey + 65, "A role the API never returned is dropped, never invented by the model.", { t, size: 11, fill: "muted" }));
  o.push(`<path d="M 568 ${oy + oh} V ${ey - 6}" fill="none" stroke="${t.line}" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#arw)"/>`);

  /* ---------------------------------------------------------------- CI/CD */
  const gx = 810, gy = 756, gw = 470, gh = 140;
  o.push(panel(gx, gy, gw, gh, { t, fill: "panel" }));
  o.push(text(gx + 18, gy + 26, "CI/CD — GitHub Actions", { t, size: 13, weight: 600 }));
  o.push(chip(gx + 18, gy + 38, gw - 36, "secret-scan.yml", t, { h: 24 }));
  o.push(text(gx + 18, gy + 78, "gitleaks (full history) · env-file hygiene · client-bundle canary", { t, size: 10.5, fill: "muted" }));
  o.push(chip(gx + 18, gy + 88, gw - 36, "deplopy-infra.yml → Terraform → AWS", t, { h: 24 }));
  o.push(text(gx + 18, gy + 128, "iac/*.tf provisions S3, DynamoDB, Bedrock access and IAM", { t, size: 10.5, fill: "muted" }));
  o.push(`<path d="M ${gx + gw / 2} ${gy} V ${ay0 + ah + 6}" fill="none" stroke="${t.line}" stroke-width="1.6" marker-end="url(#arw)"/>`);

  /* ----------------------------------------------------------------- defs */
  const M = (id) =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${t.line}"/></marker>`;
  const defs = `<defs>${M("arw")}${Object.entries(ICONS).map(([id, f]) => symbolFor(id, f)).join("")}</defs>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="MyWay AWS architecture diagram">${defs}${o.join("")}</svg>`;
}

for (const [name, t] of Object.entries(THEMES)) {
  const out = path.join(OUT_DIR, `architecture-${name}.svg`);
  fs.writeFileSync(out, build(t));
  console.log("wrote", out, fs.statSync(out).size, "bytes");
}
