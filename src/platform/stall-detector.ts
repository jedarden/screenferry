/**
 * Stall detector and diagnostic system (F2)
 *
 * When packets stop arriving, tell the user WHY using metrics already computed.
 *
 * Per ideas-ledger.md F2 (2026-07-31 finalist, grade M):
 * - 4 px/module is a cliff, not a slope: below it zxing returns nothing at all
 * - "Fail-soft explanation" is the difference between a usable tool and one people give up on
 * - Misattributing a cause is worse than staying silent
 * - Prefer "the code is not decodable, try moving closer" over a confident wrong diagnosis
 *
 * Surviving objection: Glare and distance can present similarly. Better to be uncertain
 * than confidently wrong.
 *
 * Reference: plan.md D14, D18, section 4.3. Phase 5.
 */

import type { DecodedFrameResult, TileDiagnostics } from '../modulation/types.js';

/**
 * Canary tile constants for known-value detection
 *
 * A canary tile is a QR tile with known content embedded in every frame.
 * If it decodes successfully: optical path works, packet failures are payload issues.
 * If it fails to decode: optical problem (distance, blur, lighting, etc.).
 *
 * This single signal cleanly separates optical from payload failure classes.
 */
export const CANARY_TILE_INDEX = 0; // Canary is always tile index 0
export const CANARY_PAYLOAD = new Uint8Array([0x43, 0x41, 0x4E, 0x41, 0x52, 0x59]); // "CANARY" in bytes
export const CANARY_TILE_PATTERN = 'CANARY';

/**
 * Check if decoded packet data matches canary pattern
 *
 * @param packetData - Decoded packet bytes
 * @returns true if this is a canary tile payload
 */
export function isCanaryPayload(packetData: Uint8Array): boolean {
  if (packetData.length < CANARY_PAYLOAD.length) {
    return false;
  }
  for (let i = 0; i < CANARY_PAYLOAD.length; i++) {
    if (packetData[i] !== CANARY_PAYLOAD[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Stall classification categories
 */
export type StallCategory =
  | 'none'                    // No stall - operating normally
  | 'optical-no-codes'        // No QR codes detected at all (optical issue)
  | 'optical-poor-quality'     // QR codes detected but poor quality (optical issue)
  | 'optical-too-far'         // Below 4 px/module cliff (optical issue)
  | 'optical-too-close'       // Symbol exceeds frame (optical issue)
  | 'optical-blur'            // Sharpness below threshold (optical issue)
  | 'optical-dark'            // Insufficient exposure (optical issue)
  | 'optical-glare'           // Saturated regions (optical issue)
  | 'optical-torn'            // Rolling shutter mismatch (optical issue)
  | 'optical-canary-fail'     // Canary tile failed (optical issue - definitive signal)
  | 'optical-autofocus'       // Autofocus oscillation detected (optical issue)
  | 'payload-decode-fail'     // QR codes detected but payload decode failed (payload issue)
  | 'payload-canary-ok'       // Canary decodes but payload fails (payload issue - definitive signal)
  | 'sender-paused'           // Duplicate frames detected (sender issue)
  | 'sender-wrong-stream'     // Wrong streamId (sender issue)
  | 'environment-wake-lock'   // Wake-lock failure (environment issue)
  | 'environment-thermal'     // Thermal/battery throttling (environment issue)
  | 'eta-not-converging'     // ETA shows transfer will never complete at current rate
  | 'unknown';                // Cause unclear

/**
 * Diagnostic confidence level
 */
export type Confidence = 'low' | 'medium' | 'high';

/**
 * Stall detection result with explanation
 */
export interface StallDiagnosis {
  /** Category of stall */
  category: StallCategory;

  /** Confidence in this diagnosis (low/medium/high) */
  confidence: Confidence;

  /** Human-readable explanation for the user */
  explanation: string;

  /** Suggested action for the user */
  suggestion: string;

  /** Technical details (for debugging) */
  details: {
    /** Time since last successful packet (ms) */
    timeSinceLastPacket: number;

    /** Time since any QR code was detected (ms) */
    timeSinceLastDetection: number;

    /** Current px/module measurement (if available) */
    pxPerModule?: number;

    /** Current sharpness metric (if available) */
    sharpness?: number;

    /** Whether torn frames are being detected */
    tornFrameRate?: number;

    /** Current frame FPS */
    captureFps: number;

    /** Current decode FPS */
    decodeFps: number;

    /** Packets per second */
    packetsPerSec: number;
  };
}

/**
 * Configuration for stall detector
 */
export interface StallDetectorConfig {
  /** Time without packets before considering it a stall (ms) */
  stallThreshold?: number;

  /** Time to wait before showing diagnosis (ms) - prevents flapping */
  diagnosisDelay?: number;

  /** Minimum frames to analyze before making a diagnosis */
  minAnalysisFrames?: number;

  /** px/module cliff threshold (below this, decode reliability collapses) */
  pxModuleCliff?: number;

  /** Sharpness threshold (below this, indicates blur) */
  sharpnessThreshold?: number;

  /** Maximum acceptable torn frame rate (0-1) */
  maxTornFrameRate?: number;

  /** Expected stream ID for validation (optional) */
  expectedStreamId?: number;

  /** Enable canary tile detection (if modulation layer supports it) */
  enableCanaryDetection?: boolean;

  /** Autofocus oscillation threshold (sharpness variance) */
  autofocusOscillationThreshold?: number;

  /** Thermal throttling detection (FPS drop threshold) */
  thermalFpsDropThreshold?: number;

  /** ETA not-converging threshold (hours remaining at current rate) */
  etaMaxHours?: number;
}

/**
 * Frame analysis for trend detection
 */
interface FrameAnalysis {
  timestamp: number;
  decodedCount: number;
  totalCount: number;
  avgPxPerModule: number;
  avgSharpness: number;
  tornFrameCount: number;
  packetCount: number;
  frameHash?: string;  // For duplicate detection
}

/**
 * Stall detector and diagnostic system
 *
 * Monitors frame processing to detect when decoding has stalled and
 * provides human-readable explanations of why.
 */
export class StallDetector {
  private config: Required<StallDetectorConfig>;

  // Analysis window
  private analysisWindow: FrameAnalysis[] = [];
  private readonly MAX_WINDOW_SIZE = 60; // Keep last 60 frames of analysis

  // Timing tracking
  private lastPacketTime: number = 0;
  private lastDetectionTime: number = 0;
  private lastDiagnosisTime: number = 0;
  private startedAt: number = 0;

  // Current state
  private currentDiagnosis: StallDiagnosis | null = null;

  // Duplicate frame detection (sender paused/asleep)
  private lastFrameHash: string | null = null;
  private duplicateFrameCount: number = 0;

  // Wake lock tracking
  private wakeLock: any = null; // WakeSentinel type
  private wakeLockLostTime: number | null = null;

  // Canary tile tracking (optical vs payload separation)
  private canaryLastDecoded: number = 0;
  private canaryDecodeRate: number = 0;
  private canaryTotalAttempts: number = 0;
  private canarySuccessCount: number = 0;

  // Stream ID validation (wrong-stream detection)
  private currentStreamId: number | null = null;
  private streamIdValidated: boolean = false;

  // Autofocus oscillation detection
  private sharpnessHistory: number[] = [];
  private readonly SHARPNESS_HISTORY_SIZE = 20;
  private autofocusOscillationDetected: boolean = false;

  // Thermal throttling detection
  private baselineCaptureFps: number | null = null;
  private currentFpsDrop: number = 0;

  // ETA convergence tracking
  private packetsRemaining: number = 0;
  private currentTransferRate: number = 0;
  private etaHours: number = 0;

  // Transfer progress tracking for ETA convergence
  private totalBlocks: number = 0;
  private completedBlocks: number = 0;
  private transferStartTime: number = 0;
  private rateHistory: { time: number; rate: number; completed: number }[] = [];
  private readonly RATE_HISTORY_SIZE = 30;

  // Wrong streamId detection
  private foreignStreamIdCount: number = 0;
  private foreignStreamIdDetected: number | null = null;

  // Ambient lighting conditions detection
  private darkTileCount: number = 0;
  private lowExposureHistory: number[] = [];
  private readonly EXPOSURE_HISTORY_SIZE = 20;
  private ambientLightWarningIssued: boolean = false;

  constructor(config: StallDetectorConfig = {}) {
    this.config = {
      stallThreshold: config.stallThreshold || 2000, // 2 seconds without packets
      diagnosisDelay: config.diagnosisDelay || 1000, // 1 second before showing diagnosis
      minAnalysisFrames: config.minAnalysisFrames || 10, // Need 10 frames for analysis
      pxModuleCliff: config.pxModuleCliff || 4.0, // The critical cliff
      sharpnessThreshold: config.sharpnessThreshold || 100, // Below this = blur
      maxTornFrameRate: config.maxTornFrameRate || 0.3, // 30% torn frames = bad
      expectedStreamId: config.expectedStreamId,
      enableCanaryDetection: config.enableCanaryDetection ?? true, // Default enabled
      autofocusOscillationThreshold: config.autofocusOscillationThreshold || 50, // Sharpness variance threshold
      thermalFpsDropThreshold: config.thermalFpsDropThreshold || 0.5, // 50% FPS drop = thermal throttle
      etaMaxHours: config.etaMaxHours || 24, // 24 hours max reasonable ETA
    };
    this.startedAt = performance.now();

    // Store expected stream ID if provided
    if (this.config.expectedStreamId !== undefined) {
      this.currentStreamId = this.config.expectedStreamId;
    }
  }

  /**
   * Update the detector with a new frame result
   */
  updateFrame(
    result: DecodedFrameResult,
    stats: {
      captureFps: number;
      decodeFps: number;
      packetsPerSec: number;
    },
    packetStreamIds?: number[] // Stream IDs for each packet (if available)
  ): void {
    const now = performance.now();

    // Track last packet time and validate stream IDs
    if (result.packets.length > 0) {
      this.lastPacketTime = now;

      // Check for foreign stream IDs if provided
      if (packetStreamIds) {
        this.validateStreamIds(packetStreamIds);
      }
    }

    // Track last detection time
    const detectedCount = result.diagnostics.filter(d => d.decoded).length;
    if (detectedCount > 0) {
      this.lastDetectionTime = now;
    }

    // Build frame analysis
    const analysis = this.buildFrameAnalysis(result, now);
    this.analysisWindow.push(analysis);

    // Trim window if needed
    if (this.analysisWindow.length > this.MAX_WINDOW_SIZE) {
      this.analysisWindow.shift();
    }

    // Check for duplicate frames (sender paused)
    this.checkDuplicateFrames(analysis);

    // Track canary tile decode status (if enabled)
    if (this.config.enableCanaryDetection) {
      this.trackCanaryTile(result, now);
    }

    // Track sharpness for autofocus oscillation detection
    this.trackAutofocusOscillation(result);

    // Track ambient lighting conditions
    this.trackAmbientLighting(result);

    // Track thermal throttling (FPS drop)
    this.trackThermalThrottling(stats);

    // Only diagnose if we have enough data
    if (this.analysisWindow.length >= this.config.minAnalysisFrames) {
      this.updateDiagnosis(now, stats);
    }
  }

  /**
   * Build frame analysis from result
   */
  private buildFrameAnalysis(result: DecodedFrameResult, timestamp: number): FrameAnalysis {
    const decodedTiles = result.diagnostics.filter(d => d.decoded);

    // Calculate average metrics across decoded tiles
    const avgPxPerModule = decodedTiles.length > 0
      ? decodedTiles.reduce((sum, t) => sum + (t.cameraPxPerModule || 0), 0) / decodedTiles.length
      : 0;

    const avgSharpness = decodedTiles.length > 0
      ? decodedTiles.reduce((sum, t) => sum + (t.sharpness || 0), 0) / decodedTiles.length
      : 0;

    const tornFrameCount = decodedTiles.filter(t => t.isTorn).length;

    // Simple frame hash for duplicate detection
    const frameHash = this.computeFrameHash(decodedTiles);

    return {
      timestamp,
      decodedCount: decodedTiles.length,
      totalCount: result.diagnostics.length,
      avgPxPerModule,
      avgSharpness,
      tornFrameCount,
      packetCount: result.packets.length,
      frameHash,
    };
  }

  /**
   * Compute a simple hash of frame content for duplicate detection
   */
  private computeFrameHash(decodedTiles: TileDiagnostics[]): string {
    // Hash based on tile indices and positions (if available)
    const parts = decodedTiles.map(t => {
      const posInfo = t.position
        ? `${t.position[0].x.toFixed(0)},${t.position[0].y.toFixed(0)}`
        : 'no-pos';
      return `${t.tileIndex}-${posInfo}`;
    });
    return parts.join('|');
  }

  /**
   * Check for duplicate frames (sender paused/asleep)
   */
  private checkDuplicateFrames(analysis: FrameAnalysis): void {
    if (analysis.frameHash === this.lastFrameHash && analysis.frameHash) {
      this.duplicateFrameCount++;
    } else {
      this.duplicateFrameCount = 0;
      this.lastFrameHash = analysis.frameHash || null;
    }
  }

  /**
   * Track canary tile decode status
   *
   * The canary tile is tile index 0 with known payload "CANARY".
   * If it decodes: optical path works, payload failures are data issues.
   * If it fails: optical problem (distance, blur, lighting, etc.).
   */
  private trackCanaryTile(result: DecodedFrameResult, now: number): void {
    this.canaryTotalAttempts++;

    // Check if canary tile (index 0) was decoded
    const canaryTile = result.diagnostics.find(d => d.tileIndex === CANARY_TILE_INDEX);
    if (canaryTile?.decoded) {
      // Check if canary payload matches expected pattern
      const canaryPacket = result.packets.find(p => isCanaryPayload(p));
      if (canaryPacket) {
        this.canaryLastDecoded = now;
        this.canarySuccessCount++;
      }
    }

    // Calculate canary decode rate over recent history
    if (this.canaryTotalAttempts >= 10) {
      this.canaryDecodeRate = this.canarySuccessCount / this.canaryTotalAttempts;
    }
  }

  /**
   * Track sharpness for autofocus oscillation detection
   *
   * Autofocus oscillation is detected when sharpness variance is high
   * (camera hunting back and forth between focus distances).
   */
  private trackAutofocusOscillation(result: DecodedFrameResult): void {
    const decodedTiles = result.diagnostics.filter(d => d.decoded && d.sharpness !== undefined);
    if (decodedTiles.length === 0) return;

    const avgSharpness = decodedTiles.reduce((sum, t) => sum + (t.sharpness || 0), 0) / decodedTiles.length;
    this.sharpnessHistory.push(avgSharpness);

    // Keep history at fixed size
    if (this.sharpnessHistory.length > this.SHARPNESS_HISTORY_SIZE) {
      this.sharpnessHistory.shift();
    }

    // Check for oscillation (high variance)
    if (this.sharpnessHistory.length >= this.SHARPNESS_HISTORY_SIZE) {
      const variance = this.calculateVariance(this.sharpnessHistory);
      this.autofocusOscillationDetected = variance > this.config.autofocusOscillationThreshold;
    }
  }

  /**
   * Track thermal throttling via FPS drop
   *
   * Thermal/battery throttling causes significant FPS drops.
   * We track baseline FPS at start and alert on sustained drops.
   */
  private trackThermalThrottling(stats: {
    captureFps: number;
    decodeFps: number;
    packetsPerSec: number;
  }): void {
    // Establish baseline on first frames
    if (this.baselineCaptureFps === null && stats.captureFps > 0) {
      this.baselineCaptureFps = stats.captureFps;
    }

    // Calculate FPS drop if baseline exists
    if (this.baselineCaptureFps !== null && this.baselineCaptureFps > 0) {
      this.currentFpsDrop = 1 - (stats.captureFps / this.baselineCaptureFps);
    }
  }

  /**
   * Track ambient lighting conditions
   *
   * Dark-room detection: monitors E-DARK errors and overall exposure levels.
   * Poor ambient lighting is a common cause of decode failures.
   */
  private trackAmbientLighting(result: DecodedFrameResult): void {
    let currentFrameDarkCount = 0;
    let totalLuminance = 0;
    let luminanceSampleCount = 0;

    for (const tile of result.diagnostics) {
      // Count E-DARK errors
      if (tile.error === 'E-DARK') {
        currentFrameDarkCount++;
        this.darkTileCount++;
      }

      // Collect luminance data if available (from sharpness as proxy)
      // Higher sharpness often correlates with better lighting conditions
      if (tile.decoded && tile.sharpness !== undefined) {
        totalLuminance += tile.sharpness;
        luminanceSampleCount++;
      }
    }

    // Track average sharpness as a proxy for lighting conditions
    if (luminanceSampleCount > 0) {
      const avgSharpness = totalLuminance / luminanceSampleCount;
      this.lowExposureHistory.push(avgSharpness);

      // Keep history at fixed size
      if (this.lowExposureHistory.length > this.EXPOSURE_HISTORY_SIZE) {
        this.lowExposureHistory.shift();
      }
    }

    // Reset dark count if current frame is clean
    if (currentFrameDarkCount === 0) {
      this.darkTileCount = Math.max(0, this.darkTileCount - 1);
    }
  }

  /**
   * Calculate variance of an array of numbers
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;

    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((sum, d) => sum + d, 0) / values.length;
  }

  /**
   * Update the current diagnosis based on recent data
   */
  private updateDiagnosis(now: number, stats: {
    captureFps: number;
    decodeFps: number;
    packetsPerSec: number;
  }): void {
    // Don't diagnose too frequently
    if (now - this.lastDiagnosisTime < this.config.diagnosisDelay) {
      return;
    }

    const timeSinceLastPacket = now - this.lastPacketTime;
    const timeSinceLastDetection = now - this.lastDetectionTime;

    // Check if we're actually stalled
    if (timeSinceLastPacket < this.config.stallThreshold) {
      this.currentDiagnosis = null;
      return;
    }

    // We're stalled - diagnose why
    this.currentDiagnosis = this.diagnoseStall(
      timeSinceLastPacket,
      timeSinceLastDetection,
      stats
    );
    this.lastDiagnosisTime = now;
  }

  /**
   * Diagnose the cause of a stall
   *
   * Priority order:
   * 1. Canary tile signals (definitive optical vs payload separation)
   * 2. Duplicate frames (sender paused)
   * 3. Thermal throttling (environment)
   * 4. Autofocus oscillation (optical)
   * 5. Total optical failure (no QR codes)
   * 6. Specific optical issues (too far, blur, torn, dark, glare)
   * 7. Payload decode failures
   * 8. Fallback
   */
  private diagnoseStall(
    timeSinceLastPacket: number,
    timeSinceLastDetection: number,
    stats: {
      captureFps: number;
      decodeFps: number;
      packetsPerSec: number;
    }
  ): StallDiagnosis {
    // Get recent averages
    const recent = this.getRecentAnalysis();

    // Classify stall
    let category: StallCategory;
    let confidence: Confidence;
    let explanation: string;
    let suggestion: string;

    // PRIORITY 1: Canary tile signals (definitive optical vs payload separation)
    if (this.config.enableCanaryDetection && this.canaryTotalAttempts >= 5) {
      const timeSinceCanary = performance.now() - this.canaryLastDecoded;

      // Canary failing but other tiles detected: optical problem (definitive)
      if (timeSinceCanary > this.config.stallThreshold && recent.decodedCount > 0) {
        category = 'optical-canary-fail';
        confidence = 'high';
        explanation = 'Known canary tile failing: optical path problem detected';
        suggestion = 'The camera cannot reliably read QR codes. Try moving closer, improving lighting, or adjusting camera angle';
      }
      // Canary working but no payload: payload problem (definitive)
      else if (timeSinceCanary < this.config.stallThreshold && recent.decodedCount > 0 && recent.packetCount === 0) {
        category = 'payload-canary-ok';
        confidence = 'high';
        explanation = 'Canary tile reads correctly but payload fails: data extraction issue';
        suggestion = 'This may be a different file or corrupted stream - verify the sender is transmitting the correct data';
      }
      // Canary checks inconclusive, continue to other priorities
      else {
        // Variables not set, fall through to next priority
      }
    }

    // PRIORITY 2: Wrong streamId (different file transmission)
    if (category === undefined && this.foreignStreamIdCount >= 3) {
      category = 'sender-wrong-stream';
      confidence = 'high';
      explanation = `Receiving packets from a different file (stream ID ${this.foreignStreamIdDetected} vs expected ${this.currentStreamId})`;
      suggestion = 'Point the camera at the correct sending device, or verify the sender is transmitting the intended file';
    }

    // PRIORITY 3: Duplicate frames (sender paused/asleep)
    else if (category === undefined && this.duplicateFrameCount >= 5) {
      category = 'sender-paused';
      confidence = 'high';
      explanation = 'Sender appears to be paused or asleep (duplicate frames detected)';
      suggestion = 'Check that the sender is actively transmitting and not paused';
    }

    // PRIORITY 3: Thermal/battery throttling (environment)
    else if (category === undefined && this.currentFpsDrop > this.config.thermalFpsDropThreshold) {
      category = 'environment-thermal';
      confidence = 'high';
      explanation = `Frame rate dropped ${(this.currentFpsDrop * 100).toFixed(0)}%: possible thermal/battery throttling`;
      suggestion = 'Device may be overheating or battery low. Try cooling the device or charging during transfer';
    }

    // PRIORITY 4: Autofocus oscillation (optical)
    else if (category === undefined && this.autofocusOscillationDetected) {
      category = 'optical-autofocus';
      confidence = 'medium';
      explanation = 'Camera autofocus oscillating (sharpness variance high)';
      suggestion = 'Try locking autofocus manually or tap to focus on the sender screen';
    }

    // PRIORITY 5: Total optical failure (no QR codes at all)
    else if (category === undefined && timeSinceLastDetection > timeSinceLastPacket) {
      category = 'optical-no-codes';
      confidence = 'high';
      explanation = 'No QR codes detected in the camera feed';
      suggestion = 'Ensure the sender screen is visible and within the reticle frame';
    }

    // PRIORITY 6: Specific optical quality issues
    else if (category === undefined && recent.avgPxPerModule > 0 && recent.avgPxPerModule < this.config.pxModuleCliff) {
      category = 'optical-too-far';
      confidence = 'high';
      explanation = `Camera is too far: ${recent.avgPxPerModule.toFixed(1)} px/module (below ${this.config.pxModuleCliff} cliff)`;
      suggestion = 'Move closer to the sender screen';
    }
    else if (category === undefined && this.darkTileCount >= 5) {
      category = 'optical-dark';
      confidence = 'high';
      explanation = 'Insufficient light for reliable decoding';
      suggestion = 'Increase the sender screen brightness or improve room lighting';
    }
    else if (category === undefined && recent.avgSharpness > 0 && recent.avgSharpness < this.config.sharpnessThreshold) {
      category = 'optical-blur';
      confidence = 'medium';
      explanation = 'Image appears blurry (low sharpness)';
      suggestion = 'Hold the camera steadier or check for autofocus issues';
    }
    else if (category === undefined && recent.tornFrameRate > this.config.maxTornFrameRate) {
      category = 'optical-torn';
      confidence = 'medium';
      explanation = 'High torn-frame rate detected';
      suggestion = 'Try reducing the sender frame rate or move to better lighting';
    }
    else if (category === undefined && recent.decodedCount > 0 && recent.packetCount === 0) {
      category = 'payload-decode-fail';
      confidence = 'medium';
      explanation = 'QR codes detected but payload extraction failed';
      suggestion = 'This may be a different file or stream - verify the sender is transmitting the correct data';
    }

    // PRIORITY 7: ETA not converging
    else if (category === undefined && !this.isTransferConverging()) {
      category = 'eta-not-converging';
      confidence = 'high';
      explanation = `Transfer will not complete at current conditions (est. ${this.etaHours.toFixed(1)}+ hours remaining at ${this.currentTransferRate.toFixed(2)} blocks/sec)`;
      suggestion = 'Move closer to sender, improve lighting, or reduce distance to increase transfer rate';
    }
    else if (category === undefined && this.etaHours > this.config.etaMaxHours) {
      category = 'eta-not-converging';
      confidence = 'medium';
      explanation = `Transfer will take very long at current rate (est. ${this.etaHours.toFixed(1)}+ hours remaining)`;
      suggestion = 'Move closer to sender, improve lighting, or reduce distance to increase transfer rate';
    }

    // PRIORITY 8: Fallback
    else if (category === undefined) {
      category = 'optical-poor-quality';
      confidence = 'low';
      explanation = 'QR codes are detected but not reliably decoded';
      suggestion = 'Try improving lighting, reducing distance, or adjusting camera angle to avoid glare';
    }

    return {
      category,
      confidence,
      explanation,
      suggestion,
      details: {
        timeSinceLastPacket,
        timeSinceLastDetection,
        pxPerModule: recent.avgPxPerModule || undefined,
        sharpness: recent.avgSharpness || undefined,
        tornFrameRate: recent.tornFrameRate,
        captureFps: stats.captureFps,
        decodeFps: stats.decodeFps,
        packetsPerSec: stats.packetsPerSec,
      },
    };
  }

  /**
   * Get recent frame analysis (last 10 frames)
   */
  private getRecentAnalysis(): FrameAnalysis & {
    tornFrameRate: number;
  } {
    const recent = this.analysisWindow.slice(-10);

    if (recent.length === 0) {
      return {
        timestamp: 0,
        decodedCount: 0,
        totalCount: 0,
        avgPxPerModule: 0,
        avgSharpness: 0,
        tornFrameCount: 0,
        packetCount: 0,
        tornFrameRate: 0,
      };
    }

    const summed = recent.reduce((acc, frame) => ({
      decodedCount: acc.decodedCount + frame.decodedCount,
      totalCount: acc.totalCount + frame.totalCount,
      avgPxPerModule: acc.avgPxPerModule + frame.avgPxPerModule,
      avgSharpness: acc.avgSharpness + frame.avgSharpness,
      tornFrameCount: acc.tornFrameCount + frame.tornFrameCount,
      packetCount: acc.packetCount + frame.packetCount,
      totalCountForRate: acc.totalCountForRate + 1,
    }), {
      decodedCount: 0,
      totalCount: 0,
      avgPxPerModule: 0,
      avgSharpness: 0,
      tornFrameCount: 0,
      packetCount: 0,
      totalCountForRate: 0,
    });

    const count = recent.length;
    const tornFrameRate = count > 0 ? summed.tornFrameCount / count : 0;

    return {
      timestamp: recent[recent.length - 1].timestamp,
      decodedCount: summed.decodedCount,
      totalCount: summed.totalCount,
      avgPxPerModule: count > 0 ? summed.avgPxPerModule / count : 0,
      avgSharpness: count > 0 ? summed.avgSharpness / count : 0,
      tornFrameCount: summed.tornFrameCount,
      packetCount: summed.packetCount,
      tornFrameRate,
    };
  }

  /**
   * Get the current stall diagnosis (if stalled)
   */
  getDiagnosis(): StallDiagnosis | null {
    return this.currentDiagnosis;
  }

  /**
   * Check if currently stalled
   */
  isStalled(): boolean {
    return this.currentDiagnosis !== null;
  }

  /**
   * Get time since last successful packet
   */
  getTimeSinceLastPacket(): number {
    return performance.now() - this.lastPacketTime;
  }

  /**
   * Reset the detector (e.g., after reconnecting)
   */
  reset(): void {
    this.analysisWindow = [];
    this.lastPacketTime = performance.now();
    this.lastDetectionTime = performance.now();
    this.lastDiagnosisTime = 0;
    this.currentDiagnosis = null;
    this.duplicateFrameCount = 0;
    this.lastFrameHash = null;
    this.foreignStreamIdCount = 0;
    this.foreignStreamIdDetected = null;
  }

  /**
   * Validate stream IDs from decoded packets
   *
   * Detects when we're receiving packets from a different stream (different file).
   * This is the E-FOREIGN-STREAM error: "That's a different file — ignoring it."
   */
  private validateStreamIds(streamIds: number[]): void {
    for (const streamId of streamIds) {
      // First valid stream ID we see becomes the expected one
      if (this.currentStreamId === null) {
        this.currentStreamId = streamId;
        this.streamIdValidated = true;
        console.log(`[Stall Detector] Locked to stream ID: ${streamId}`);
        continue;
      }

      // Check for foreign stream ID
      if (streamId !== this.currentStreamId) {
        this.foreignStreamIdCount++;
        if (this.foreignStreamIdDetected !== streamId) {
          this.foreignStreamIdDetected = streamId;
          console.warn(`[Stall Detector] Foreign stream ID detected: ${streamId} (expected ${this.currentStreamId})`);
        }
      }
    }
  }

  /**
   * Set the expected stream ID (if known in advance)
   *
   * This can be used when the receiver knows the stream ID before receiving packets.
   */
  setExpectedStreamId(streamId: number): void {
    this.currentStreamId = streamId;
    this.config.expectedStreamId = streamId;
    console.log(`[Stall Detector] Expected stream ID set to: ${streamId}`);
  }

  /**
   * Get the current stream ID we're locked to
   */
  getCurrentStreamId(): number | null {
    return this.currentStreamId;
  }

  /**
   * Set transfer parameters for ETA calculation
   *
   * @param totalBlocks - Total number of blocks to transfer
   * @param completedBlocks - Number of blocks already completed (for resume)
   */
  setTransferParameters(totalBlocks: number, completedBlocks: number = 0): void {
    this.totalBlocks = totalBlocks;
    this.completedBlocks = completedBlocks;
    this.transferStartTime = performance.now();
    this.rateHistory = [];
    console.log(`[Stall Detector] Transfer parameters set: ${totalBlocks} total blocks, ${completedBlocks} completed`);
  }

  /**
   * Update transfer progress for ETA tracking
   *
   * @param completedBlocks - Current number of completed blocks
   */
  updateTransferProgress(completedBlocks: number): void {
    const now = performance.now();
    const previousCompleted = this.completedBlocks;
    this.completedBlocks = completedBlocks;

    // Only track rate if we have progress
    if (completedBlocks > previousCompleted && this.transferStartTime > 0) {
      const elapsedSeconds = (now - this.transferStartTime) / 1000;
      const currentRate = completedBlocks / elapsedSeconds; // blocks per second

      // Add to rate history
      this.rateHistory.push({
        time: now,
        rate: currentRate,
        completed: completedBlocks,
      });

      // Trim history
      if (this.rateHistory.length > this.RATE_HISTORY_SIZE) {
        this.rateHistory.shift();
      }

      // Update current rate (average over recent history)
      this.updateCurrentRate();
    }

    // Update ETA calculation
    this.updateETA();
  }

  /**
   * Update current transfer rate based on recent history
   */
  private updateCurrentRate(): void {
    if (this.rateHistory.length < 2) {
      this.currentTransferRate = 0;
      return;
    }

    // Calculate rate over the last several measurements
    const recent = this.rateHistory.slice(-Math.min(10, this.rateHistory.length));
    if (recent.length < 2) return;

    const oldest = recent[0];
    const newest = recent[recent.length - 1];
    const timeDiff = (newest.time - oldest.time) / 1000; // seconds
    const blocksDiff = newest.completed - oldest.completed;

    if (timeDiff > 0) {
      this.currentTransferRate = blocksDiff / timeDiff; // blocks per second
    }
  }

  /**
   * Update ETA calculation
   */
  private updateETA(): void {
    const remainingBlocks = this.totalBlocks - this.completedBlocks;

    if (remainingBlocks <= 0 || this.currentTransferRate <= 0) {
      this.etaHours = 0;
      return;
    }

    const remainingSeconds = remainingBlocks / this.currentTransferRate;
    this.etaHours = remainingSeconds / 3600; // Convert to hours
  }

  /**
   * Check if transfer is converging (ETA trending down or stable)
   *
   * Non-convergence detection: if ETA is trending up or erratic, the transfer
   * may never complete at current conditions.
   */
  private isTransferConverging(): boolean {
    if (this.rateHistory.length < 5) return true; // Not enough data

    // Check if rate is declining (bad sign)
    const recentRates = this.rateHistory.slice(-5).map(r => r.rate);
    const firstRate = recentRates[0];
    const lastRate = recentRates[recentRates.length - 1];

    // If rate dropped by more than 50%, not converging well
    if (lastRate < firstRate * 0.5) {
      return false;
    }

    // Check if ETA is reasonable (not trending to infinity)
    if (this.etaHours > this.config.etaMaxHours) {
      return false;
    }

    return true;
  }

  /**
   * Request a wake lock to prevent screen sleep during long runs
   *
   * This helps detect wake-lock failure before a multi-hour run dies at minute 3.
   */
  async requestWakeLock(): Promise<void> {
    if ('wakeLock' in navigator) {
      try {
        // @ts-ignore - wakeLock API is not in all TypeScript definitions
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          console.warn('[Stall Detector] Wake lock released');
          this.wakeLockLostTime = performance.now();
        });
        console.log('[Stall Detector] Wake lock acquired');
      } catch (error) {
        console.warn('[Stall Detector] Failed to acquire wake lock:', error);
      }
    }
  }

  /**
   * Release the wake lock
   */
  async releaseWakeLock(): Promise<void> {
    if (this.wakeLock) {
      try {
        // @ts-ignore
        await this.wakeLock.release();
        this.wakeLock = null;
        this.wakeLockLostTime = null;
        console.log('[Stall Detector] Wake lock released');
      } catch (error) {
        console.warn('[Stall Detector] Failed to release wake lock:', error);
      }
    }
  }
}

/**
 * Create a stall detector with default configuration
 */
export function createStallDetector(config?: StallDetectorConfig): StallDetector {
  return new StallDetector(config);
}
