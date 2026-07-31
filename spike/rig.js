/**
 * Phase 0.5 optical measurement rig — S2/S3/S4.
 *
 * NOT a prototype. This is an instrument. It deliberately contains no fountain
 * code, no block layer, no compression, no resume, no OPFS and no error recovery,
 * because none of those affect what it measures: what the screen→camera channel
 * physically delivers on YOUR hardware.
 *
 * Sender  — emits sequentially numbered packets as a grid of QR tiles.
 * Receiver— decodes, counts UNIQUE packets, and reports the numbers Phase 1 needs.
 *
 * Everything here is throwaway. Results go to docs/notes/spike-results.md.
 */

import QRCode from 'qrcode';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';

const HEADER = 13;

/** Ladder rungs from plan.md §3.1.1 — packet count fixed, QR version chosen to fit. */
export const RUNGS = {
  R1: { ver: 10, packets: 1, label: 'conservative' },
  R2: { ver: 16, packets: 2, label: 'nominal' },
  R3: { ver: 20, packets: 3, label: 'aggressive' },
  R4: { ver: 23, packets: 4, label: 'probe' },
};

// ───────────────────────────────────────────────────────────── sender

/** Build one packet: 13-byte header + L payload bytes. Payload is deterministic
 *  from seq so the receiver can verify byte-exactness without a side channel. */
export function makePacket(seq, L) {
  const p = new Uint8Array(HEADER + L);
  const dv = new DataView(p.buffer);
  p[0] = 0x5f;                       // magic+ver
  p[1] = 0;                          // flags
  dv.setUint32(2, 0xdeadbeef);       // streamId
  p[6] = 0; p[7] = 0; p[8] = 0;      // blockIndex
  p[9] = (seq >>> 16) & 0xff; p[10] = (seq >>> 8) & 0xff; p[11] = seq & 0xff;
  let x = (seq * 2654435761) >>> 0;  // deterministic payload
  for (let i = 0; i < L; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    p[HEADER + i] = x & 0xff;
  }
  p[12] = crc8(p, 0, 12);
  return p;
}

export function crc8(buf, from, to) {
  let c = 0xff;
  for (let i = from; i < to; i++) {
    c ^= buf[i];
    for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ 0x31) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

export function verifyPacket(bytes, L) {
  if (bytes.length !== HEADER + L) return null;
  if (bytes[0] !== 0x5f) return null;
  if (crc8(bytes, 0, 12) !== bytes[12]) return null;
  const seq = (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
  const expect = makePacket(seq, L);
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== expect[i]) return { seq, exact: false };
  return { seq, exact: true };
}

/** Render one tile to an ImageData-backed canvas at an exact module pixel size. */
async function renderTile(payload, version, modulePx) {
  const qr = QRCode.create([{ data: payload, mode: 'byte' }], {
    errorCorrectionLevel: 'L', version,
  });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const c = new OffscreenCanvas(size * modulePx, size * modulePx);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // 1px-per-module ImageData, then integer upscale — measured 0.154 ms/frame (D4 source)
  const small = new OffscreenCanvas(size, size);
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = data[i] ? 0 : 255;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  ctx.drawImage(small, 0, 0, c.width, c.height);
  return { canvas: c, modules: size };
}

export class Sender {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.seq = 0;
    this.frames = 0;
    this.running = false;
  }

  /** @param {{rung:string, L:number, modulePx:number, fps:number, cols:number, rows:number}} cfg */
  async start(cfg) {
    this.cfg = cfg;
    this.running = true;
    this.seq = 0;
    this.frames = 0;
    this.t0 = performance.now();
    const rung = RUNGS[cfg.rung];
    const perFrame = cfg.cols * cfg.rows * rung.packets;

    const loop = async () => {
      if (!this.running) return;
      const packets = [];
      for (let i = 0; i < perFrame; i++) packets.push(makePacket(this.seq++, cfg.L));

      // moderate background, not full white — D12 (OLED ABL) and D10 (DC balance)
      this.ctx.fillStyle = '#d8d8d8';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      let k = 0;
      for (let r = 0; r < cfg.rows; r++) {
        for (let c = 0; c < cfg.cols; c++) {
          const group = packets.slice(k, k + rung.packets); k += rung.packets;
          const joined = new Uint8Array(group.length * (HEADER + cfg.L));
          group.forEach((p, i) => joined.set(p, i * (HEADER + cfg.L)));
          const { canvas } = await renderTile(joined, rung.ver, cfg.modulePx);
          const pad = 8;
          this.ctx.drawImage(canvas,
            pad + c * (canvas.width + pad),
            pad + r * (canvas.height + pad));
        }
      }
      this.frames++;
      setTimeout(loop, Math.max(0, 1000 / cfg.fps));
    };
    loop();
  }

  stop() { this.running = false; }

  stats() {
    const secs = (performance.now() - this.t0) / 1000;
    return {
      frames: this.frames,
      packetsEmitted: this.seq,
      actualFps: this.frames / secs,
      wireBytesPerSec: (this.seq * this.cfg.L) / secs,
    };
  }
}

// ───────────────────────────────────────────────────────────── receiver

export class Receiver {
  constructor(video) {
    this.video = video;
    this.seen = new Set();
    this.reset();
  }

  reset() {
    this.seen.clear();
    this.cameraFrames = 0;
    this.decodedTiles = 0;
    this.corruptTiles = 0;
    this.inexact = 0;
    this.perFrameCounts = [];
    this.decodeMs = [];
    this.t0 = performance.now();
  }

  async start({ L, expectPerFrame }) {
    await prepareZXingModule({ fireImmediately: true });
    this.L = L;
    this.expectPerFrame = expectPerFrame;
    this.running = true;

    const track = this.video.srcObject.getVideoTracks()[0];
    // D14 — the single biggest fps lever; absent on iOS, so failure here is expected there
    const caps = track.getCapabilities?.() ?? {};
    if (caps.exposureCompensation) {
      try {
        await track.applyConstraints({
          advanced: [{ exposureCompensation: caps.exposureCompensation.min }],
        });
        this.exposureApplied = true;
      } catch { this.exposureApplied = false; }
    }

    const c = new OffscreenCanvas(this.video.videoWidth, this.video.videoHeight);
    const ctx = c.getContext('2d', { willReadFrequently: true });

    const onFrame = async () => {
      if (!this.running) return;
      ctx.drawImage(this.video, 0, 0);
      const blob = await c.convertToBlob({ type: 'image/png' });
      const t = performance.now();
      let results = [];
      try {
        results = await readBarcodes(blob, { tryHarder: false, formats: ['QRCode'], maxNumberOfSymbols: 64 });
      } catch { /* a frame that fails to decode is an erasure, not an error */ }
      this.decodeMs.push(performance.now() - t);
      this.cameraFrames++;

      let good = 0;
      for (const r of results) {
        const bytes = r.bytes;                       // D3 — .bytes, never .text
        if (!bytes) continue;
        for (let off = 0; off + HEADER + L <= bytes.length; off += HEADER + L) {
          const v = verifyPacket(bytes.subarray(off, off + HEADER + L), L);
          if (!v) { this.corruptTiles++; continue; }
          if (!v.exact) this.inexact++;
          this.seen.add(v.seq);
          good++;
        }
      }
      this.decodedTiles += good;
      this.perFrameCounts.push(good);
      this.video.requestVideoFrameCallback(onFrame);
    };
    this.video.requestVideoFrameCallback(onFrame);
  }

  stop() { this.running = false; }

  stats() {
    const secs = (performance.now() - this.t0) / 1000;
    const p = [...this.perFrameCounts];
    const sorted = [...this.decodeMs].sort((a, b) => a - b);
    const yieldRate = p.length ? p.reduce((a, b) => a + b, 0) / (p.length * this.expectPerFrame) : 0;
    return {
      cameraFps: this.cameraFrames / secs,
      uniquePackets: this.seen.size,
      goodputBytesPerSec: (this.seen.size * this.L) / secs,
      tileYield: yieldRate,                       // fraction of emitted tiles decoded
      erasureRate: 1 - yieldRate,                 // ← the number D18c assumes is 20–30%
      framesWithZero: p.filter((x) => x === 0).length / (p.length || 1),
      decodeMsP50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      decodeMsP99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
      corruptTiles: this.corruptTiles,
      byteMismatches: this.inexact,               // MUST be 0 — binary safety (I10)
      exposureApplied: this.exposureApplied ?? false,
    };
  }
}
