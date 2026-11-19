import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// CRC32 table for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba, includeAlpha = true) {
  const channels = includeAlpha ? 4 : 3;
  const stride = width * channels + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = rowStart + 1 + x * channels;
      raw[dstIdx] = rgba[srcIdx];
      raw[dstIdx + 1] = rgba[srcIdx + 1];
      raw[dstIdx + 2] = rgba[srcIdx + 2];
      if (includeAlpha) {
        raw[dstIdx + 3] = rgba[srcIdx + 3];
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = includeAlpha ? 6 : 2; // RGBA or RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Evaluate strobe icon color at normalized coordinates (u, v) in [-1, 1]
// scale < 1 shrinks the strobe rings into Android adaptive icon safe zone
function sampleStrobe(u, v, scale) {
  const x = u / scale;
  const y = v / scale;
  const r = Math.hypot(x, y);
  let angle = Math.atan2(y, x);
  if (angle < 0) angle += Math.PI * 2;

  // Center dot
  if (r <= 0.115) {
    return 0.98;
  }

  // 3 concentric strobe rings matching favicon.svg & StrobeDisplay
  const rings = [
    { rInner: 0.27, rOuter: 0.39, segments: 6, offset: 0.0, alpha: 0.7 },
    { rInner: 0.48, rOuter: 0.61, segments: 8, offset: 0.32, alpha: 0.85 },
    { rInner: 0.70, rOuter: 0.85, segments: 12, offset: 0.0, alpha: 0.98 },
  ];

  for (const ring of rings) {
    if (r >= ring.rInner && r <= ring.rOuter) {
      const step = (Math.PI * 2) / ring.segments;
      const pos = ((angle + ring.offset) % step) / step;
      if (pos <= 0.48) {
        return ring.alpha;
      }
      return 0;
    }
  }

  // Subtle outer bezel ring
  if (r >= 0.91 && r <= 0.935) {
    return 0.28;
  }

  return 0;
}

function renderStrobeIcon(size, { scale = 1.0, transparentBg = false, roundMask = false } = {}) {
  const rgba = new Uint8Array(size * size * 4);
  const bgR = 9, bgG = 9, bgB = 11; // #09090b (zinc-950)
  const fgR = 52, fgG = 211, fgB = 153; // #34d399 (emerald-400)

  // 3x3 supersampling for crisp anti-aliased edges
  const sub = 3;
  const invSub2 = 1 / (sub * sub);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let fgAcc = 0;
      let maskAcc = 0;

      for (let sy = 0; sy < sub; sy++) {
        const v = ((y + (sy + 0.5) / sub) / size) * 2 - 1;
        for (let sx = 0; sx < sub; sx++) {
          const u = ((x + (sx + 0.5) / sub) / size) * 2 - 1;
          if (roundMask && Math.hypot(u, v) > 0.98) {
            continue;
          }
          maskAcc += 1;
          fgAcc += sampleStrobe(u, v, scale);
        }
      }

      const idx = (y * size + x) * 4;
      const fgAlpha = fgAcc * invSub2;
      const bgCover = maskAcc * invSub2;

      if (transparentBg) {
        rgba[idx] = fgR;
        rgba[idx + 1] = fgG;
        rgba[idx + 2] = fgB;
        rgba[idx + 3] = Math.round(fgAlpha * 255);
      } else if (roundMask) {
        const r = Math.round(bgR * (1 - fgAlpha) + fgR * fgAlpha);
        const g = Math.round(bgG * (1 - fgAlpha) + fgG * fgAlpha);
        const b = Math.round(bgB * (1 - fgAlpha) + fgB * fgAlpha);
        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
        rgba[idx + 3] = Math.round(bgCover * 255);
      } else {
        rgba[idx] = Math.round(bgR * (1 - fgAlpha) + fgR * fgAlpha);
        rgba[idx + 1] = Math.round(bgG * (1 - fgAlpha) + fgG * fgAlpha);
        rgba[idx + 2] = Math.round(bgB * (1 - fgAlpha) + fgB * fgAlpha);
        rgba[idx + 3] = 255;
      }
    }
  }

  return rgba;
}

// 1. iOS 1024x1024 opaque RGB AppIcon
const iosIconPath = path.resolve('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
const iosRgba = renderStrobeIcon(1024, { scale: 0.82, transparentBg: false });
fs.writeFileSync(iosIconPath, encodePng(1024, 1024, iosRgba, false));
console.log('Generated iOS AppIcon:', iosIconPath);

// 2. Android mipmap icons
const androidMipmaps = [
  { dir: 'mipmap-mdpi', launcher: 48, foreground: 108 },
  { dir: 'mipmap-hdpi', launcher: 72, foreground: 162 },
  { dir: 'mipmap-xhdpi', launcher: 96, foreground: 216 },
  { dir: 'mipmap-xxhdpi', launcher: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
];

for (const m of androidMipmaps) {
  const baseDir = path.resolve('android/app/src/main/res', m.dir);

  const sq = renderStrobeIcon(m.launcher, { scale: 0.84, transparentBg: false });
  fs.writeFileSync(path.join(baseDir, 'ic_launcher.png'), encodePng(m.launcher, m.launcher, sq, true));

  const rnd = renderStrobeIcon(m.launcher, { scale: 0.84, transparentBg: false, roundMask: true });
  fs.writeFileSync(path.join(baseDir, 'ic_launcher_round.png'), encodePng(m.launcher, m.launcher, rnd, true));

  // Adaptive icon foreground (inner 62% safe zone)
  const fg = renderStrobeIcon(m.foreground, { scale: 0.56, transparentBg: true });
  fs.writeFileSync(path.join(baseDir, 'ic_launcher_foreground.png'), encodePng(m.foreground, m.foreground, fg, true));
}
console.log('Generated Android mipmap icons');

// 3. Web / iOS PWA Home Screen icons (apple-touch-icon.png + PWA manifest icons)
const appleTouchPath = path.resolve('public/apple-touch-icon.png');
const appleTouchRgba = renderStrobeIcon(180, { scale: 0.82, transparentBg: false });
fs.writeFileSync(appleTouchPath, encodePng(180, 180, appleTouchRgba, false));

const pwa192Path = path.resolve('public/icon-192.png');
const pwa192Rgba = renderStrobeIcon(192, { scale: 0.82, transparentBg: false });
fs.writeFileSync(pwa192Path, encodePng(192, 192, pwa192Rgba, false));

const pwa512Path = path.resolve('public/icon-512.png');
const pwa512Rgba = renderStrobeIcon(512, { scale: 0.82, transparentBg: false });
fs.writeFileSync(pwa512Path, encodePng(512, 512, pwa512Rgba, false));
console.log('Generated Web PWA & apple-touch-icon PNGs in public/');
