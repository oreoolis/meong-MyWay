/**
 * Generates the Excalidraw source of the architecture diagram.
 *
 *   node scripts/gen-architecture-excalidraw.js docs/architecture.excalidraw
 *
 * Writes one .excalidraw scene file, editable in the Excalidraw app
 * (excalidraw.com, the desktop app, or the VS Code extension) or on its own
 * canvas. The five real AWS Architecture Icons vendored under docs/img/aws/
 * are embedded as image elements. Lambda, EventBridge and CloudWatch have no
 * vendored SVG yet, so they get the same plain, category-coloured stand-in
 * tiles gen-architecture.js already uses for the same reason: readable, and
 * honest that they are not the official artwork.
 *
 * This file is the editable source. The PNG the README embeds is exported
 * from it inside the Excalidraw app ("Export image"), because this script
 * has no headless renderer of its own.
 */

const fs = require("fs");
const path = require("path");

const ICON_DIR = path.join(__dirname, "..", "docs", "img", "aws");
const OUT_FILE = process.argv[2];
if (!OUT_FILE) throw new Error("usage: node scripts/gen-architecture-excalidraw.js <out-file>");

/* --------------------------------------------------------------------------
 * Excalidraw element builders
 *
 * The scene format carries a lot of bookkeeping (seed, versionNonce, group
 * membership) that only matters to Excalidraw's own editing history. These
 * fill in sane defaults so the diagram content below can read as a diagram
 * instead of a JSON schema.
 * ---------------------------------------------------------------------- */

let seedCounter = 1;
const nextSeed = () => (seedCounter += 7919) % 2147483647;
const NOW = Date.now();
let idCounter = 0;
const nextId = (prefix) => `${prefix}-${++idCounter}`;

const elements = [];
const files = {};

function base(type, x, y, width, height, extra = {}) {
  const el = {
    id: nextId(type),
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1.5,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: nextSeed(),
    version: 1,
    versionNonce: nextSeed(),
    isDeleted: false,
    boundElements: null,
    updated: NOW,
    link: null,
    locked: false,
    ...extra,
  };
  elements.push(el);
  return el;
}

/** A container box. `rounded` gives it the soft Excalidraw corner. */
function box(x, y, w, h, o = {}) {
  const { stroke = "#1e1e1e", fill = "transparent", dashed = false, rounded = true } = o;
  return base("rectangle", x, y, w, h, {
    strokeColor: stroke,
    backgroundColor: fill,
    strokeStyle: dashed ? "dashed" : "solid",
    roundness: rounded ? { type: 3 } : null,
  });
}

/** Standalone text, not bound to a container, so position is exact. */
function label(x, y, s, o = {}) {
  const { size = 16, color = "#1e1e1e", bold = false, mono = false, align = "left" } = o;
  return base("text", x, y, size * s.length * 0.55, size * 1.25, {
    strokeColor: color,
    text: s,
    originalText: s,
    fontSize: size,
    // 1 = hand-drawn (Virgil), 2 = normal, 3 = code. Bold headings read
    // better in the plain sans than in the sketch font at small sizes.
    fontFamily: bold || mono ? (mono ? 3 : 2) : 1,
    textAlign: align,
    verticalAlign: "top",
    baseline: size,
    lineHeight: 1.25,
    containerId: null,
  });
}

/** Orthogonal-ish straight arrow between two points. */
function arrow(x1, y1, x2, y2, o = {}) {
  const { dashed = false, color = "#495057", width = 2 } = o;
  return base("arrow", Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1) || 1, Math.abs(y2 - y1) || 1, {
    strokeColor: color,
    strokeWidth: width,
    strokeStyle: dashed ? "dashed" : "solid",
    points: [
      [x1 - Math.min(x1, x2), y1 - Math.min(y1, y2)],
      [x2 - Math.min(x1, x2), y2 - Math.min(y1, y2)],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "triangle",
  });
}

/** An elbow arrow: out horizontally, then down, then in. */
function elbow(x1, y1, x2, y2, midX, o = {}) {
  const { dashed = false, color = "#495057", width = 2 } = o;
  const minX = Math.min(x1, x2, midX);
  const minY = Math.min(y1, y2);
  return base(
    "arrow",
    minX,
    minY,
    Math.max(x1, x2, midX) - minX,
    Math.max(y1, y2) - minY,
    {
      strokeColor: color,
      strokeWidth: width,
      strokeStyle: dashed ? "dashed" : "solid",
      points: [
        [x1 - minX, y1 - minY],
        [midX - minX, y1 - minY],
        [midX - minX, y2 - minY],
        [x2 - minX, y2 - minY],
      ],
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: "triangle",
    },
  );
}

/** A free-form multi-point arrow, for a route two elbows can't express. */
function polyArrow(points, o = {}) {
  const { dashed = false, color = "#495057", width = 2 } = o;
  const minX = Math.min(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  return base(
    "arrow",
    minX,
    minY,
    Math.max(...points.map((p) => p[0])) - minX,
    Math.max(...points.map((p) => p[1])) - minY,
    {
      strokeColor: color,
      strokeWidth: width,
      strokeStyle: dashed ? "dashed" : "solid",
      points: points.map(([px, py]) => [px - minX, py - minY]),
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: "triangle",
    },
  );
}

/** A vendored AWS icon, embedded as an image element. */
function realIcon(x, y, size, file) {
  const svg = fs.readFileSync(path.join(ICON_DIR, file), "utf8");
  const fileId = path.basename(file, ".svg");
  if (!files[fileId]) {
    files[fileId] = {
      mimeType: "image/svg+xml",
      id: fileId,
      dataURL: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      created: NOW,
      lastRetrieved: NOW,
    };
  }
  return base("image", x, y, size, size, { fileId, status: "saved", scale: [1, 1] });
}

/**
 * A stand-in tile for a service with no vendored icon yet: a rounded square
 * in the service's own AWS category colour, with a plain drawn glyph. Same
 * policy as gen-architecture.js's SUBSTITUTE_ICONS, so a reader sees one
 * consistent rule across both renderings of this diagram rather than two.
 */
function standInIcon(x, y, size, fill, glyphPath) {
  box(x, y, size, size, { stroke: fill, fill });
  const g = elements[elements.length - 1];
  g.backgroundColor = fill;
  g.fillStyle = "solid";
  base("line", x + size * 0.2, y + size * 0.2, size * 0.6, size * 0.6, {
    strokeColor: "#ffffff",
    strokeWidth: 3,
    points: glyphPath,
    roundness: { type: 2 },
  });
}

/** One AWS service row: icon tile, name, and its one-line role. */
function service(x, y, icon, name, sub, o = {}) {
  const { size = 44 } = o;
  if (icon.real) realIcon(x, y, size, icon.file);
  else standInIcon(x, y, size, icon.fill, icon.glyph);
  label(x + size + 12, y + 2, name, { size: 15, bold: true });
  if (sub) label(x + size + 12, y + 22, sub, { size: 12.5, color: "#495057" });
}

/* --------------------------------------------------------------------------
 * Diagram
 * ---------------------------------------------------------------------- */

// Title.
label(40, 24, "MyWay - AWS Architecture", { size: 28, bold: true });
label(40, 60, "One Next.js deployment. Five Amazon Bedrock agents. No separate backend service.", {
  size: 14,
  color: "#495057",
});

/* Client ------------------------------------------------------------------ */
const cx = 40, cy = 110, cw = 260, ch = 170;
box(cx, cy, cw, ch);
label(cx + 16, cy + 12, "CLIENT", { size: 12, bold: true, color: "#868e96" });
label(cx + 16, cy + 36, "Browser", { size: 20, bold: true });
label(cx + 16, cy + 68, "React 19, Tailwind v4", { size: 13, color: "#495057" });
label(cx + 16, cy + 88, "Amplify Auth (SRP + TOTP MFA)", { size: 13, color: "#495057" });
label(cx + 16, cy + 116, "One route. Every phase is a state", { size: 12.5, color: "#868e96" });
label(cx + 16, cy + 134, "of a single <Workspace/> component.", { size: 12.5, color: "#868e96" });

/* Next.js app --------------------------------------------------------------- */
const nx = 360, ny = 110, nw = 460, nh = 680;
box(nx, ny, nw, nh, { fill: "#f8f9fa" });
label(nx + 16, ny + 12, "COMPUTE - NEXT.JS 16 APP ROUTER", { size: 12, bold: true, color: "#868e96" });
label(nx + 16, ny + 36, "Pages and API routes, one deployment", { size: 14, bold: true });

const routes = [
  "/api/auth/session - verifies Cognito JWTs",
  "/api/resume - GET POST DELETE",
  "/api/analysis/intake - parse + questionnaire",
  "/api/analysis - POST completes the run",
  "/api/analysis/swap - agent 5, deferred",
  "/api/jobs - GET, no auth, shared data",
];
let ry = ny + 62;
for (const r of routes) {
  box(nx + 16, ry, nw - 32, 26, { fill: "#ffffff", rounded: true });
  label(nx + 26, ry + 5, r, { size: 12.5, mono: true });
  ry += 32;
}

const ox = nx + 16, oy = ry + 12, ow = nw - 32, oh = ny + nh - 16 - (ry + 12);
box(ox, oy, ow, oh, { fill: "#ffffff", stroke: "#868e96" });
label(ox + 14, oy + 12, "Agent Orchestrator", { size: 15, bold: true });
label(ox + 14, oy + 32, "lib/agents/orchestrator.ts", { size: 12, mono: true, color: "#868e96" });

const agents = [
  ["1", "Resume Parser", "PDF/DOCX to profile + embedding", "#ff9900"],
  ["2", "Career Planner", "trajectory + ranked paths", "#ff9900"],
  ["3", "Resume Improver", "quoted, line-level rewrites", "#ff9900"],
  ["4", "Industry Advisor", "roles inside the current sector", "#ff9900"],
  ["5", "Career Swapper", "pivot destinations + real gaps", "#ff9900"],
];
let ay = oy + 56;
agents.forEach(([n, name, sub]) => {
  const h = 46;
  box(ox + 14, ay, ow - 28, h, { fill: "#f8f9fa" });
  box(ox + 32, ay + h / 2 - 12, 24, 24, { fill: "#ff9900", rounded: true });
  label(ox + 39, ay + h / 2 - 9, n, { size: 13, bold: true, color: "#1e1e1e" });
  label(ox + 66, ay + 8, name, { size: 13, bold: true });
  label(ox + 66, ay + 26, sub, { size: 11.5, color: "#495057" });
  ay += h + 8;
});
label(ox + 14, ay + 6, "Agent 1 stores profile + embedding before the planner runs.", { size: 11.5, color: "#495057" });
label(ox + 14, ay + 24, "A retry after a later agent dies resumes from that checkpoint", { size: 11.5, color: "#495057" });
label(ox + 14, ay + 42, "instead of recomputing them (see intake.ts, reusableParseResult).", { size: 11.5, color: "#495057" });

/* AWS Cloud ---------------------------------------------------------------- */
const awx = 880, awy = 110, aww = 480, awh = 680;
box(awx, awy, aww, awh, { stroke: "#ff9900", dashed: true });
label(awx + 16, awy + 12, "AWS CLOUD - us-east-1", { size: 12, bold: true, color: "#ff9900" });

const bx = awx + 16, by = awy + 40, bw = aww - 32, bh = 190;
box(bx, by, bw, bh, { fill: "#f8f9fa" });
service(bx + 14, by + 14, { real: true, file: "bedrock.svg" }, "Amazon Bedrock", "Converse API, temperature 0");
box(bx + 14, by + 68, bw - 28, 26, { fill: "#ffffff" });
label(bx + 24, by + 73, "us.anthropic.claude-haiku-4-5-20251001-v1:0", { size: 11.5, mono: true });
label(bx + 14, by + 100, "Reasoning, all five agents, cross-region inference profile", { size: 11.5, color: "#495057" });
box(bx + 14, by + 124, bw - 28, 26, { fill: "#ffffff" });
label(bx + 24, by + 129, "amazon.titan-embed-text-v2:0", { size: 11.5, mono: true });
label(bx + 14, by + 156, "Embeddings, 1024-d resume vectors", { size: 11.5, color: "#495057" });

const sx = awx + 16, sy = by + bh + 16, sh = 246;
box(sx, sy, bw, sh, { fill: "#f8f9fa" });
label(sx + 14, sy + 10, "STORAGE", { size: 12, bold: true, color: "#868e96" });
service(sx + 14, sy + 30, { real: true, file: "s3.svg" }, "Amazon S3 - uploads", "resume bytes, up to 5 MB, byte-sniffed");
service(sx + 14, sy + 82, { real: true, file: "dynamodb.svg" }, "DynamoDB - resumes", "one current resume per user");
service(sx + 14, sy + 134, { real: true, file: "dynamodb.svg" }, "DynamoDB - analyses", "one item per artifact, retry checkpoint, TTL 30d");
service(sx + 14, sy + 186, { real: true, file: "s3.svg" }, "Amazon S3 - jobs", "jobs/latest.json, shared, not per-user");

const iy = sy + sh + 16, ih = 142;
box(sx, iy, bw, ih, { fill: "#f8f9fa" });
label(sx + 14, iy + 10, "IDENTITY AND ACCESS", { size: 12, bold: true, color: "#868e96" });
service(sx + 14, iy + 30, { real: true, file: "cognito.svg" }, "Amazon Cognito", "user pool, SRP, TOTP MFA");
service(sx + 14, iy + 82, { real: true, file: "iam.svg" }, "AWS IAM", "agent-runtime policy, scoped to 2 models");

/* Arrows: client <-> next.js <-> aws --------------------------------------- */
arrow(cx + cw, cy + 40, nx - 6, cy + 40, {});
label((cx + cw + nx) / 2 - 30, cy + 22, "page loads", { size: 11, color: "#868e96" });
arrow(cx + cw, cy + 80, nx - 6, cy + 80, {});
label((cx + cw + nx) / 2 - 40, cy + 62, "Bearer ID token", { size: 11, color: "#868e96" });
// Routed under both columns rather than through them: a straight elbow at
// Identity-box height would cut across the agent list, which sits between
// the client column and the AWS column at that same y.
const corridorY = awy + awh + 20;
polyArrow(
  [
    [cx + cw / 2, cy + ch],
    [cx + cw / 2, corridorY],
    [awx + 40, corridorY],
    [awx + 40, iy + ih - 10],
  ],
  { dashed: true },
);
label(cx + cw / 2 + 10, cy + ch + 20, "SRP sign-in / sign-up, Amplify Auth", { size: 11, color: "#868e96" });

elbow(nx + nw, ry - 30 + 13, awx - 6, iy + 40, nx + nw + 40);
elbow(nx + nw, ry - 30 * 4 + 13, awx - 6, sy + 40, nx + nw + 60);
elbow(nx + nw, oy + 30, awx - 6, by + 40, nx + nw + 80, { width: 2.5 });
elbow(nx + nw, oy + oh - 20, awx - 6, sy + 150, nx + nw + 20);

/* External data and CI/CD, side by side below both columns ------------------ */
const rowBY = 850;
const exx = 40, exy = rowBY, exw = 500, exh = 170;
box(exx, exy, exw, exh, { dashed: true });
label(exx + 14, exy + 10, "External data", { size: 14, bold: true });
label(exx + 14, exy + 34, "SSG-WSG Skills Framework", { size: 12.5, bold: true });
label(exx + 14, exy + 52, "taxonomy: titles, sectors, salary bands", { size: 11.5, color: "#495057" });
label(exx + 14, exy + 78, "MyCareersFuture", { size: 12.5, bold: true });
label(exx + 14, exy + 96, "vacancies: who is hiring, and the apply URL", { size: 11.5, color: "#495057" });
label(exx + 14, exy + 122, "A role the API never returned is dropped,", { size: 11, color: "#868e96" });
label(exx + 14, exy + 138, "never invented by the model.", { size: 11, color: "#868e96" });

const gx = 880, gy = rowBY, gw = 480, gh = 170;
box(gx, gy, gw, gh, { fill: "#f8f9fa" });
label(gx + 14, gy + 10, "CI/CD - GitHub Actions", { size: 14, bold: true });
box(gx + 14, gy + 34, gw - 28, 26, { fill: "#ffffff" });
label(gx + 24, gy + 39, "secret-scan.yml", { size: 11.5, mono: true });
label(gx + 14, gy + 68, "gitleaks, env-file hygiene, bundle canary", { size: 11, color: "#495057" });
box(gx + 14, gy + 82, gw - 28, 26, { fill: "#ffffff" });
label(gx + 24, gy + 87, "deplopy-infra.yml -> Terraform -> AWS", { size: 11, mono: true });
label(gx + 14, gy + 122, "iac/*.tf provisions S3, DynamoDB, Bedrock, IAM", { size: 10.5, color: "#495057" });

arrow(gx + gw / 2, gy, gx + gw / 2, awy + awh + 6, { dashed: true });

/* Job listings feed, its own row below everything else ---------------------- */
const jx = 40, jy = rowBY + exh + 40, jw = 1320, jh = 190;
box(jx, jy, jw, jh, { stroke: "#868e96" });
label(jx + 16, jy + 12, "JOB LISTINGS FEED - scheduled, off the request path, optional", { size: 13, bold: true });
label(jx + 16, jy + 32, "Without it the app runs unchanged, minus the opening badges.", { size: 11.5, color: "#495057" });

const jrow = jy + 60;
const EVENTBRIDGE = { fill: "#e7157b", glyph: [[8, 0], [8, 9], [14, 14]] };
const LAMBDA = { fill: "#ed7100", glyph: [[0, 26], [13, 0], [26, 26]] };
const CLOUDWATCH = { fill: "#e7157b", glyph: [[0, 22], [9, 10], [17, 16], [28, 0]] };

service(jx + 16, jrow, EVENTBRIDGE, "Amazon EventBridge", "rate(12 hours)");
service(jx + 330, jrow, LAMBDA, "AWS Lambda", "lambda/jobs-scraper, Node 20, no deps");
box(jx + 646, jrow - 4, 260, 52, { dashed: true });
label(jx + 660, jrow + 8, "MyCareersFuture", { size: 13, bold: true });
label(jx + 660, jrow + 28, "public jobs API, undocumented", { size: 11, color: "#495057" });
service(jx + 972, jrow, { real: true, file: "s3.svg" }, "Amazon S3 - jobs", "run archive, then flip latest.json");
service(jx + 16, jrow + 82, CLOUDWATCH, "Amazon CloudWatch", "logs, alarms on repeated failed runs");
label(jx + 330, jrow + 88, "The scraper raises rather than publishing an empty snapshot,", { size: 11, color: "#495057" });
label(jx + 330, jrow + 104, "so a blocked or reshaped API leaves the last good file in place.", { size: 11, color: "#495057" });

arrow(jx + 286, jrow + 22, jx + 326, jrow + 22, {});
arrow(jx + 602, jrow + 22, jx + 642, jrow + 22, {});
arrow(jx + 902, jrow + 22, jx + 968, jrow + 22, {});

/* --------------------------------------------------------------------------
 * Write
 * ---------------------------------------------------------------------- */

const scene = {
  type: "excalidraw",
  version: 2,
  source: "https://github.com/oreoolis/meong-MyWay",
  elements,
  appState: {
    gridSize: null,
    viewBackgroundColor: "#ffffff",
  },
  files,
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(scene, null, 2));
console.log("wrote", OUT_FILE, fs.statSync(OUT_FILE).size, "bytes,", elements.length, "elements");
