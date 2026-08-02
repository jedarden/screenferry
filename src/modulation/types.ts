/**
 * Modulation layer — the ONLY contract above the swappable layer (plan.md §6.5)
 *
 * This interface is the boundary between the core codec (fixed) and the modulation
 * implementation (swappable: Stage 1 tiled mono QR, Stage 2 RGB tripling, Stage 3 custom codec).
 *
 * CRITICAL: This interface was corrected in bf-1bd (AR-2/AR-4 pivot class) to fix three
 * fundamental issues that would have blocked Phase 2 receiver wiring:
 *
 * 1. D16 MIXED PROFILES: The sender mixes 2-4 robustness profiles WITHIN every frame
 *    (R1 conservative v10-L at 15%, R2 nominal v15-L at 60%, R3 aggressive v20-L at 25%).
 *    The previous scalar `packetsPerFrame` could not express per-profile distribution.
 *    Fixed by replacing scalar with `profileMix` array.
 *
 * 2. D18b/§11 PER-TILE DIAGNOSTICS: Phase 5 ladder adaptation and §11 error codes need
 *    per-tile yield and quality metrics (cameraPxPerModule for E-TOO-FAR, sharpness for
 *    E-BLUR, torn-frame detection for E-TORN). The previous `decodeFrame()` only returned
 *    packets and discarded this information. Fixed by returning `DecodedFrameResult` with
 *    `diagnostics` array.
 *
 * 3. PLATFORM COMPATIBILITY: The previous `decodeFrame(frame: VideoFrame)` broke the
 *    mandatory non-Chromium fallback (plan.md §6.4: `requestVideoFrameCallback` +
 *    `drawImage` produces `ImageData`, not `VideoFrame`). Fixed by accepting
 *    `VideoFrame | ImageData`.
 *
 * These fixes are an AR-2/AR-4 pivot class — they must be applied before Phase 2 wires
 * the receiver, or the interface would require breaking changes mid-implementation.
 */

/**
 * A QR profile configuration (one rung of the ladder per D16/D18a).
 *
 * D16: "Sender mixes 2–4 robustness profiles *within every frame*; no negotiation in v1"
 * D18a: "Fixed weights (frame-area fractions): R1 (conservative v10-L) = 15%, R2 (nominal
 * v15-L) = 60%, R3 (aggressive v20-L) = 25%"
 *
 * Profiles are defined by packetsPerTile, which determines QR version via §3.1.1's rule:
 * "pick L to fit the smallest tile any profile would use" and "rungs are defined by
 * packet count, with the QR version chosen to fit".
 */
export interface Profile {
  /** Profile identifier: R1=conservative, R2=nominal, R3=aggressive, R4=probe-only */
  readonly name: 'R1' | 'R2' | 'R3' | 'R4';

  /** Frame-area fraction (e.g., 0.15 for R1's 15%) */
  readonly tileFraction: number;

  /** Packets per tile (1 for R1, 2 for R2, 3 for R3, 4 for R4) */
  readonly packetsPerTile: number;

  /** QR version (determined by packetsPerTile and L) */
  readonly qrVersion: number;

  /** ECC level — always 'L' per plan (redundancy belongs in fountain code, not QR) */
  readonly eccLevel: 'L';
}

/**
 * Decode result for a single frame, including both packet data and per-tile diagnostics.
 *
 * D18b (Phase 5 ladder adaptation) needs local metrics like frame timing and receiver
 * observations to drive the 1:9 up/down asymmetry and immediate hard step-down.
 *
 * §11 error codes need per-tile quality metrics:
 * - E-TOO-FAR: camera px/module < 4
 * - E-TOO-CLOSE: symbol exceeds frame
 * - E-BLUR: sharpness metric below threshold
 * - E-DARK: insufficient exposure
 * - E-GLARE: saturated region over code
 * - E-FOCUS-HUNT: focus oscillating
 * - E-TORN: torn-frame rate high
 */
export interface DecodedFrameResult {
  /**
   * Decoded packets (0..n — never throws).
   * Returning fewer packets than the sender emitted is the NORMAL case due to erasure.
   */
  readonly packets: Uint8Array[];

  /**
   * Per-tile diagnostics for quality assessment and error reporting.
   * Array length matches the number of tiles the sender encoded (even undecoded ones).
   */
  readonly diagnostics: TileDiagnostics[];
}

/**
 * Per-tile quality metrics and error conditions for D18b adaptation and §11 error codes.
 */
export interface TileDiagnostics {
  /** Zero-based tile index in the frame grid */
  readonly tileIndex: number;

  /** Whether this tile was successfully decoded */
  readonly decoded: boolean;

  /**
   * Camera pixels per QR module (the critical decode cliff metric).
   * Below 4 camera px/module, decode reliability collapses (plan.md §2).
   * Used for E-TOO-FAR error detection.
   */
  readonly cameraPxPerModule?: number;

  /**
   * Sharpness metric (variance of Laplacian or similar edge detector).
   * Below threshold indicates handshake blur or focus issues.
   * Used for E-BLUR error detection.
   */
  readonly sharpness?: number;

  /**
   * Whether this tile shows signs of torn-frame damage (rolling shutter mismatch).
   * Used for E-TORN error detection.
   */
  readonly isTorn?: boolean;

  /**
   * Specific error condition if decoding failed.
   * Absence of this field with decoded=false means "general decode failure".
   */
  readonly error?: 'E-TOO-FAR' | 'E-TOO-CLOSE' | 'E-BLUR' | 'E-DARK' | 'E-GLARE' | 'E-FOCUS-HUNT' | 'E-TORN';
}

/**
 * The modulation interface — contract between core codec and swappable layer.
 *
 * This interface is the ONLY boundary above the swappable modulation layer (plan.md §6.5).
 * All stages (1/2/3) must implement this, and nothing outside `src/modulation/` may
 * reference QR-specific APIs (D-modulation-swappable invariant).
 */
export interface Modulation {
  /**
   * Profile mix for D16: "Sender mixes 2–4 robustness profiles *within every frame*"
   *
   * Each frame contains tiles from 2-4 different QR profiles, mixed at fixed percentages
   * per D18a (R1=15%, R2=60%, R3=25% in Phase 3). This allows probing to be free — a probe
   * tile that succeeds delivers real payload, not wasted bandwidth.
   *
   * Tile fractions MUST sum to 1.0 (100% of frame area).
   *
   * Example Phase 3 configuration:
   * ```
   * [
   *     { name: 'R1', tileFraction: 0.15, packetsPerTile: 1, qrVersion: 10, eccLevel: 'L' },
   *     { name: 'R2', tileFraction: 0.60, packetsPerTile: 2, qrVersion: 16, eccLevel: 'L' },
   *     { name: 'R3', tileFraction: 0.25, packetsPerTile: 3, qrVersion: 20, eccLevel: 'L' },
   *   ]
   * ```
   */
  readonly profileMix: readonly Profile[];

  /**
   * Total packets per frame (sum over all profiles).
   * Useful for debugging and performance monitoring, but NOT the primary encode interface.
   *
   * Examples:
   * - Stage 1 (R2 dominant): ~15 tiles × 2 packets = 30 packets
   * - Stage 2 (RGB tripling): ~15 tiles × 2 packets × 3 channels = 90 packets
   * - Stage 3 (custom codec): ~45 tiles × 2-4 packets (higher density)
   */
  readonly totalPacketsPerFrame: number;

  /**
   * Fragment length L in bytes (D15, I1).
   *
   * FIXED for the session — never changes per profile or mid-session (I1).
   * At L = 256 B, packet = 13-byte header + 256-byte payload = 269 bytes total.
   *
   * This is the atomic unit the fountain code operates over. K fragments form one block.
   */
  readonly fragmentLen: number;

  /**
   * Encode a frame from packets.
   *
   * The encoder receives an undifferentiated array of packets and must decide how to
   * distribute them across the profile mix. Packet ordering is preserved within each
   * profile's tiles (important for fountain code index semantics).
   *
   * @param packets - Array of packet bytes (each is 13-byte header + L payload)
   * @returns ImageData suitable for canvas display (Chromium) or ImageBitmap creation
   *
   * Thread context: Called from frame encoder worker (plan.md §6.2).
   */
  encodeFrame(packets: Uint8Array[]): ImageData;

  /**
   * Decode a frame, returning both packets and per-tile diagnostics.
   *
   * Accepts both VideoFrame (Chromium's `MediaStreamTrackProcessor` path) and ImageData
   * (universal fallback: `requestVideoFrameCallback` + `drawImage`). This compatibility
   * is required by plan.md §6.4 and §16.3 — non-Chromium browsers cannot produce VideoFrame.
   *
   * @param frame - VideoFrame (Chromium) or ImageData (fallback)
   * @returns DecodedFrameResult with packets and diagnostics
   *
   * Thread context: Called from decode pool workers (plan.md §6.2). Each worker MUST
   * `close()` the VideoFrame if provided, or the camera pipeline stalls.
   *
   * IMPORTANT: Must never throw. Return fewer packets rather than throw.
   */
  decodeFrame(frame: VideoFrame | ImageData): DecodedFrameResult;
}

/**
 * Type guard for VideoFrame vs ImageData (Chromium-only API check).
 */
export function isVideoFrame(frame: VideoFrame | ImageData): frame is VideoFrame {
  return 'format' in frame && 'close' in frame;
}
