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
  | 'payload-decode-fail'     // QR codes detected but payload decode failed (payload issue)
  | 'sender-paused'           // Duplicate frames detected (sender issue)
  | 'sender-wrong-stream'     // Wrong streamId (sender issue)
  | 'environment-wake-lock'   // Wake-lock failure (environment issue)
  | 'environment-thermal'     // Thermal/battery throttling (environment issue)
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

  constructor(config: StallDetectorConfig = {}) {
    this.config = {
      stallThreshold: config.stallThreshold || 2000, // 2 seconds without packets
      diagnosisDelay: config.diagnosisDelay || 1000, // 1 second before showing diagnosis
      minAnalysisFrames: config.minAnalysisFrames || 10, // Need 10 frames for analysis
      pxModuleCliff: config.pxModuleCliff || 4.0, // The critical cliff
      sharpnessThreshold: config.sharpnessThreshold || 100, // Below this = blur
      maxTornFrameRate: config.maxTornFrameRate || 0.3, // 30% torn frames = bad
    };
    this.startedAt = performance.now();
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
    }
  ): void {
    const now = performance.now();

    // Track last packet time
    if (result.packets.length > 0) {
      this.lastPacketTime = now;
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

    // Check for duplicate frames first (sender paused)
    if (this.duplicateFrameCount >= 5) {
      category = 'sender-paused';
      confidence = 'high';
      explanation = 'Sender appears to be paused or asleep';
      suggestion = 'Check that the sender is actively transmitting';
    }
    // Check for total optical failure (no QR codes at all)
    else if (timeSinceLastDetection > timeSinceLastPacket) {
      category = 'optical-no-codes';
      confidence = 'high';
      explanation = 'No QR codes detected in the camera feed';
      suggestion = 'Ensure the sender screen is visible and within the reticle frame';
    }
    // Check for optical quality issues
    else if (recent.avgPxPerModule > 0 && recent.avgPxPerModule < this.config.pxModuleCliff) {
      category = 'optical-too-far';
      confidence = 'high';
      explanation = `Camera is too far: ${recent.avgPxPerModule.toFixed(1)} px/module (below ${this.config.pxModuleCliff} cliff)`;
      suggestion = 'Move closer to the sender screen';
    }
    // Check for blur
    else if (recent.avgSharpness > 0 && recent.avgSharpness < this.config.sharpnessThreshold) {
      category = 'optical-blur';
      confidence = 'medium';
      explanation = 'Image appears blurry (low sharpness)';
      suggestion = 'Hold the camera steadier or check for autofocus issues';
    }
    // Check for torn frames
    else if (recent.tornFrameRate > this.config.maxTornFrameRate) {
      category = 'optical-torn';
      confidence = 'medium';
      explanation = 'High torn-frame rate detected';
      suggestion = 'Try reducing the sender frame rate or move to better lighting';
    }
    // Check if some codes are detected but no payload
    else if (recent.decodedCount > 0 && recent.packetCount === 0) {
      category = 'payload-decode-fail';
      confidence = 'medium';
      explanation = 'QR codes detected but payload extraction failed';
      suggestion = 'This may be a different file or stream - verify the sender is transmitting the correct data';
    }
    // Fallback: optical issue but unclear what
    else {
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
