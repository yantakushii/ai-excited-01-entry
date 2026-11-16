/**
 * Supernova — a procedural deep-space neon burst.
 *
 * Node 22, standard library only. One 768x768 PNG is written to
 * join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'entry.png').
 * No randomness anywhere: the same bytes are produced on every run.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 768;
const H = 768;

/* ------------------------------------------------------------------ */
/* small math helpers                                                  */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => t * t * (3 - 2 * t);
const sat = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ------------------------------------------------------------------ */
/* deterministic hashing + value noise (no Math.random, no clock)      */
/* ------------------------------------------------------------------ */

function hash2i(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise1(x: number, s: number): number {
  const xi = Math.floor(x);
  const f = smooth(x - xi);
  return mix(hash2i(xi, 0, s), hash2i(xi + 1, 0, s), f);
}

function vnoise2(x: number, y: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const a = hash2i(xi, yi, s);
  const b = hash2i(xi + 1, yi, s);
  const c = hash2i(xi, yi + 1, s);
  const d = hash2i(xi + 1, yi + 1, s);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

function fbm2(x: number, y: number, oct: number, s: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise2(x * freq, y * freq, s + i * 37);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 1) + 1) % 1;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hh * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

/* ------------------------------------------------------------------ */
/* scene constants                                                     */
/* ------------------------------------------------------------------ */

// the burst sits off-centre, up and to the right of the frame centre
const CX = W * 0.615;
const CY = H * 0.372;
const R = W * 0.62; // radial scale of the explosion

// the lightning crescent wraps the lower-left of the core
const ARC_PHI = 2.62;
const ARC_SPAN = 1.28;

function render(): Uint8Array {
  const px = new Uint8Array(W * H * 3);
  const twoPi = Math.PI * 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x / W;
      const ny = y / H;

      // ---------------- deep space background ----------------
      let r = 0.004;
      let g = 0.006;
      let b = 0.018;

      const neb = fbm2(nx * 3.1 + 4.7, ny * 3.1 + 9.2, 5, 11);
      const tint = fbm2(nx * 1.9 + 40.3, ny * 1.9 + 17.8, 4, 23);
      const nebA = Math.pow(clamp01((neb - 0.33) / 0.67), 1.8);
      r += mix(0.30, 0.03, tint) * nebA * 0.85;
      g += mix(0.05, 0.26, tint) * nebA * 0.85;
      b += mix(0.46, 0.40, tint) * nebA * 0.85;

      // faint dust lanes carve the nebula
      const dust = clamp01((fbm2(nx * 5.4 + 71.1, ny * 5.4 + 3.3, 4, 51) - 0.5) * 2.2);
      r *= 1 - 0.45 * dust;
      g *= 1 - 0.45 * dust;
      b *= 1 - 0.45 * dust;

      // ---------------- starfield ----------------
      let star = 0;
      let starTint = 0;
      const cs = 5;
      const gx0 = Math.floor((x - 6) / cs);
      const gy0 = Math.floor((y - 6) / cs);
      for (let sy = gy0; sy <= gy0 + 2; sy++) {
        for (let sx = gx0; sx <= gx0 + 2; sx++) {
          if (hash2i(sx, sy, 101) > 0.34) continue;
          const sxPos = (sx + hash2i(sx, sy, 211)) * cs;
          const syPos = (sy + hash2i(sx, sy, 307)) * cs;
          const dxs = x - sxPos;
          const dys = y - syPos;
          const d2 = dxs * dxs + dys * dys;
          if (d2 > 14) continue;
          const mag = Math.pow(hash2i(sx, sy, 401), 2.6);
          star += (0.06 + mag * 1.1) * Math.exp(-d2 / 1.05);
          starTint += hash2i(sx, sy, 433);
        }
      }
      if (star > 0) {
        const t = sat(starTint / 9) * 0.5;
        r += star * mix(1.0, 0.72, t);
        g += star * mix(0.95, 0.86, t);
        b += star * 1.0;
      }

      // ---------------- geometry relative to the burst ----------------
      const dx = x - CX;
      const dy = y - CY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const theta = Math.atan2(dy, dx);

      // log-spiral twist so the streaks curve outwards
      const twist = theta + 1.35 * Math.log(1 + dist / 55);
      const u = twist / twoPi;

      // ---------------- radial colour streaks ----------------
      const n1 = vnoise1(u * 55.0 + 2.3, 5);
      const n2 = vnoise1(u * 22.0 + 8.1, 9);
      const n3 = vnoise1(u * 131.0 + 1.7, 13);
      let ray = 0.52 * n1 + 0.31 * n2 + 0.17 * n3;
      ray = Math.pow(clamp01((ray - 0.31) / 0.69), 3.1);
      const falloff = Math.exp(-dist / (R * 0.92)) + 1.45 * Math.exp(-dist / (R * 0.19));
      const rayI = ray * falloff * 1.75;

      const hue = (u * 1.55 + 0.62 + 0.22 * vnoise1(u * 13.0 + 44.2, 17)) % 1;
      const rc = hsl(hue, 0.96, 0.60);
      const rc2 = hsl(hue + 0.09, 0.90, 0.52);

      r += mix(rc[0], rc2[0], 0.5) * rayI;
      g += mix(rc[1], rc2[1], 0.5) * rayI;
      b += mix(rc[2], rc2[2], 0.5) * rayI;

      // fine hot filaments inside the streaks
      const filament = Math.pow(clamp01(vnoise1(u * 210.0 + 77.7, 19) * 0.85), 6) * Math.exp(-dist / (R * 0.45));
      r += filament * 0.55;
      g += filament * 0.45;
      b += filament * 0.85;

      // ---------------- crescent of lightning arcs ----------------
      let da = theta - ARC_PHI;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const crescent = Math.pow(clamp01(1 - Math.abs(da) / ARC_SPAN), 1.45);
      if (crescent > 0.001) {
        const arc1 = R * 0.585 + 26 * (vnoise1(da * 15.0 + 3.3, 29) - 0.5) + 11 * (vnoise1(da * 57.0 + 7.7, 31) - 0.5);
        const arc2 = R * 0.805 + 20 * (vnoise1(da * 12.0 + 41.0, 37) - 0.5) + 9 * (vnoise1(da * 44.0 + 5.0, 41) - 0.5);

        const seg1 = 0.25 + 0.75 * Math.pow(vnoise1(da * 9.0 + 3.0, 43), 1.6);
        const seg2 = 0.20 + 0.80 * Math.pow(vnoise1(da * 7.0 + 61.0, 47), 1.8);

        const d1 = dist - arc1;
        const d2 = dist - arc2;
        const bolt1 = Math.exp(-(d1 * d1) / 5.2) * seg1 + Math.exp(-(d1 * d1) / 900) * 0.20 * seg1;
        const bolt2 = Math.exp(-(d2 * d2) / 4.0) * seg2 + Math.exp(-(d2 * d2) / 700) * 0.16 * seg2;

        const arcI = (bolt1 * 1.55 + bolt2 * 1.15) * crescent;
        const at = 0.5 + 0.5 * Math.sin(da * 5.0 + 1.2);
        r += arcI * mix(0.62, 0.92, at);
        g += arcI * mix(0.95, 0.55, at);
        b += arcI * mix(1.0, 1.0, at);

        // white-hot junctions where the arcs kink
        const junc = Math.pow(clamp01(vnoise1(da * 23.0 + 11.0, 53) * 1.15 - 0.35), 3.0);
        const jglow = Math.exp(-(d1 * d1) / 90) * crescent;
        r += jglow * junc * 1.1;
        g += jglow * junc * 1.0;
        b += jglow * junc * 1.25;
      }

      // ---------------- white core ----------------
      const coreGlow =
        Math.exp(-(dist * dist) / 52) * 3.0 +
        Math.exp(-(dist * dist) / 700) * 1.15 +
        Math.exp(-dist / 62) * 0.62 +
        Math.exp(-dist / (R * 0.42)) * 0.16;
      r += coreGlow * 1.02;
      g += coreGlow * 0.98;
      b += coreGlow * 0.94;

      // diffraction spikes on the core
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const spikeH = Math.exp(-(ay * ay) / 2.6) * Math.exp(-ax / 210) * 0.95;
      const spikeV = Math.exp(-(ax * ax) / 2.6) * Math.exp(-ay / 210) * 0.95;
      const d1s = (dx + dy) * 0.7071068;
      const d2s = (dx - dy) * 0.7071068;
      const spikeD =
        (Math.exp(-(d2s * d2s) / 5.5) + Math.exp(-(d1s * d1s) / 5.5)) * Math.exp(-(ax + ay) / 300) * 0.34;
      const spikes = spikeH + spikeV + spikeD;
      r += spikes * 1.0;
      g += spikes * 0.93;
      b += spikes * 1.0;

      // ---------------- tone map + vignette ----------------
      let vr = 1 - Math.exp(-r * 1.42);
      let vg = 1 - Math.exp(-g * 1.42);
      let vb = 1 - Math.exp(-b * 1.42);

      vr = Math.pow(clamp01(vr), 0.92);
      vg = Math.pow(clamp01(vg), 0.92);
      vb = Math.pow(clamp01(vb), 0.92);

      const dvx = nx - 0.5;
      const dvy = ny - 0.5;
      const dv = Math.sqrt(dvx * dvx + dvy * dvy) / 0.7071068;
      const vig = 1 - 0.30 * Math.pow(clamp01(dv), 2.3);
      vr *= vig;
      vg *= vig;
      vb *= vig;

      const o = (y * W + x) * 3;
      px[o] = Math.round(clamp01(vr) * 255);
      px[o + 1] = Math.round(clamp01(vg) * 255);
      px[o + 2] = Math.round(clamp01(vb) * 255);
    }
  }

  return px;
}

/* ------------------------------------------------------------------ */
/* PNG encoder: signature, IHDR, IDAT (zlib), IEND, own CRC32          */
/* ------------------------------------------------------------------ */

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf: any): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32(v: number): any {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v >>> 0, 0);
  return b;
}

function chunk(type: string, data: any): any {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}

function encodePng(px: any, width: number, height: number): any {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 1; // Sub filter: helps a lot on smooth gradients
    const src = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= 3 ? px[src + i - 3] : 0;
      raw[rowStart + 1 + i] = (px[src + i] - left) & 0xff;
    }
  }

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const pixels = render();
const png = encodePng(pixels, W, H);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), png);
process.stdout.write(`wrote ${join(outDir, 'entry.png')} (${png.length} bytes, ${W}x${H})\n`);