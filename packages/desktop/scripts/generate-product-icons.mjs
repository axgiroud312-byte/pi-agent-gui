// Dependency-free Pi mark asset generation. Geometry matches ui/src/assets/pi-mark.svg.
// This is an asset build, independent of the desktop/Agent bundle and upstream artwork.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const build = new URL("../build/", import.meta.url);
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const segments = [
  [14, 21, 50, 21],
  [25, 21, 25, 41],
  [40, 21, 40, 44],
];
for (const points of [[25, 41, 25, 47, 22, 49, 19, 49], [40, 44, 40, 47, 42, 49, 45, 49]]) {
  let previous = points.slice(0, 2);
  for (let step = 1; step <= 24; step++) {
    const t = step / 24;
    const u = 1 - t;
    const next = [0, 1].map((axis) =>
      u ** 3 * points[axis] + 3 * u ** 2 * t * points[axis + 2] +
      3 * u * t ** 2 * points[axis + 4] + t ** 3 * points[axis + 6],
    );
    segments.push([...previous, ...next]);
    previous = next;
  }
}

function distanceToSegment(x, y, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]);
  const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(bytes.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), body.length + 4);
  return result;
}

function png(size) {
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (const sy of [0.25, 0.75]) for (const sx of [0.25, 0.75]) {
        const px = (x + sx) * 64 / size;
        const py = (y + sy) * 64 / size;
        const qx = Math.abs(px - 32) - 20;
        const qy = Math.abs(py - 32) - 20;
        const edge = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 11;
        if (edge > 0.5) continue;
        const mark = segments.some((segment) => distanceToSegment(px, py, segment) <= 3);
        const color = mark ? [255, 255, 255] : edge > -0.5 ? [183, 188, 191] : [21, 23, 24];
        for (let axis = 0; axis < 3; axis++) sum[axis] += color[axis];
        sum[3] += 255;
      }
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      for (let axis = 0; axis < 3; axis++) scanlines[offset + axis] = sum[3] ? Math.round(sum[axis] * 255 / sum[3]) : 0;
      scanlines[offset + 3] = Math.round(sum[3] / 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const images = new Map();
for (const size of sizes) {
  const image = png(size);
  images.set(size, image);
  await writeFile(new URL(`icons/${size}x${size}.png`, build), image);
}
for (const name of ["icon.png", "icon_windows.png", "icon_installer.png"]) {
  await writeFile(new URL(name, build), images.get(512));
}

const icoSizes = sizes.filter((size) => size <= 256);
const icoHeader = Buffer.alloc(6 + icoSizes.length * 16);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(icoSizes.length, 4);
let offset = icoHeader.length;
icoSizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  icoHeader[entry] = size % 256;
  icoHeader[entry + 1] = size % 256;
  icoHeader.writeUInt16LE(1, entry + 4);
  icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(images.get(size).length, entry + 8);
  icoHeader.writeUInt32LE(offset, entry + 12);
  offset += images.get(size).length;
});
const ico = Buffer.concat([icoHeader, ...icoSizes.map((size) => images.get(size))]);
for (const name of ["icon.ico", "icon_installer.ico"]) await writeFile(new URL(name, build), ico);

const icnsEntries = [["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024]].map(([type, size]) => {
  const header = Buffer.alloc(8);
  header.write(type);
  header.writeUInt32BE(8 + images.get(size).length, 4);
  return Buffer.concat([header, images.get(size)]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns");
icnsHeader.writeUInt32BE(8 + icnsEntries.reduce((sum, entry) => sum + entry.length, 0), 4);
for (const name of ["icon.icns", "icon_installer.icns"]) {
  await writeFile(new URL(name, build), Buffer.concat([icnsHeader, ...icnsEntries]));
}
console.log(`Generated Pi product icons in ${fileURLToPath(build)}`);
