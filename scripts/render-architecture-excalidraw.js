/**
 * Renders docs/architecture.excalidraw to the flat SVG the README embeds.
 *
 *   node scripts/render-architecture-excalidraw.js docs/architecture.excalidraw docs/img/architecture-excalidraw.svg
 *
 * A plain-geometry renderer, not Excalidraw's own: no rough.js hand-drawn
 * stroke wobble, no real font-metric text measurement. What it preserves
 * exactly is the layout, so the two stay honest with each other. For the
 * sketchy look, open the .excalidraw file itself in the Excalidraw app and
 * use Export image there.
 */
const fs = require("fs");
const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) throw new Error("usage: node scripts/render-architecture-excalidraw.js <in.excalidraw> <out.svg>");

const scene = JSON.parse(fs.readFileSync(inFile, "utf8"));

let maxX = 0, maxY = 0;
for (const el of scene.elements) {
  maxX = Math.max(maxX, el.x + el.width);
  maxY = Math.max(maxY, el.y + el.height);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const body = [];
for (const el of scene.elements) {
  if (el.type === "rectangle") {
    body.push(
      `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="8" ` +
        `fill="${el.backgroundColor}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" ` +
        `stroke-dasharray="${el.strokeStyle === "dashed" ? "6 4" : "none"}"/>`,
    );
  } else if (el.type === "text") {
    body.push(
      `<text x="${el.x}" y="${el.y + el.fontSize}" font-size="${el.fontSize}" fill="${el.strokeColor}" ` +
        `font-family="sans-serif" font-weight="${el.fontFamily === 2 ? 700 : 400}">${esc(el.text)}</text>`,
    );
  } else if (el.type === "arrow" || el.type === "line") {
    const pts = el.points.map(([px, py]) => `${el.x + px},${el.y + py}`).join(" ");
    const arrowhead = el.type === "arrow" ? ' marker-end="url(#arw)"' : "";
    body.push(
      `<polyline points="${pts}" fill="none" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" ` +
        `stroke-dasharray="${el.strokeStyle === "dashed" ? "6 4" : "none"}"${arrowhead}/>`,
    );
  } else if (el.type === "image") {
    const file = scene.files[el.fileId];
    if (file) body.push(`<image x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" href="${file.dataURL}"/>`);
  }
}

const defs =
  `<defs><marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" ` +
  `orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#495057"/></marker></defs>`;

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX + 40}" height="${maxY + 40}" ` +
  `viewBox="0 0 ${maxX + 40} ${maxY + 40}" role="img" aria-label="MyWay AWS architecture diagram">` +
  `<rect width="100%" height="100%" fill="#ffffff"/>${defs}${body.join("")}</svg>`;

fs.writeFileSync(outFile, svg);
console.log("wrote", outFile, fs.statSync(outFile).size, "bytes");
