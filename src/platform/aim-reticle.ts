/**
 * Aim reticle and distance coach overlay (F3)
 *
 * Document-scanner-style reticle overlay for aligning sender's screen,
 * with live px/module feedback and distance coaching.
 *
 * Per ideas-ledger.md F3 (2026-07-31 finalist, grade M):
 * - Defends the 4 px/module cliff (highest-impact measured effect)
 * - Geometry, not software, is the dominant risk
 * - Visual-only feedback (no haptics on iOS Safari)
 *
 * Reference: plan.md §7 geometry, D16. Phase 5.
 */

import type { DecodedFrameResult, TileDiagnostics } from '../modulation/types.js';
import { getReducedMotionManager } from './reduced-motion.js';

/**
 * Reticle state and quality metrics
 */
export interface ReticleState {
  /** Current pixels per module measurement */
  pxPerModule: number;
  /** Quality category */
  quality: 'good' | 'warning' | 'critical';
  /** Coaching message */
  message: string;
  /** Detected QR positions for visualization */
  positions: Array<{ x: number; y: number }>;
  /** Frame width in pixels */
  frameWidth: number;
  /** Frame height in pixels */
  frameHeight: number;
}

/**
 * Configuration for the reticle overlay
 */
export interface ReticleConfig {
  /** Target canvas element for rendering */
  canvas: HTMLCanvasElement;
  /** Video element for camera feed */
  video: HTMLVideoElement;
  /** Threshold for critical (red) zone - below this, decoding fails */
  criticalThreshold?: number;
  /** Threshold for warning (amber) zone */
  warningThreshold?: number;
  /** Frame rate for reticle updates (Hz) */
  updateRate?: number;
}

/**
 * Aim reticle overlay component
 *
 * Provides document-scanner-style alignment guidance with live
 * pixels-per-module feedback and distance coaching messages.
 */
export class AimReticle {
  private canvas: HTMLCanvasElement;
  private video: HTMLVideoElement;
  private ctx: CanvasRenderingContext2D;

  // Quality thresholds (pixels per module)
  private readonly CRITICAL_THRESHOLD = 4.0; // Below this, decode reliability collapses
  private readonly WARNING_THRESHOLD = 8.0;  // Below this, suboptimal performance

  // Animation state
  private lastUpdate = 0;
  private updateInterval: number;
  private animationId: number | null = null;

  // Reduced-motion support (F4: WCAG 2.3.1 safeguard)
  private reducedMotionManager = getReducedMotionManager();
  private reducedMotionUnsubscribe: (() => void) | null = null;

  // Current state
  private state: ReticleState = {
    pxPerModule: 0,
    quality: 'critical',
    message: 'Initializing...',
    positions: [],
    frameWidth: 0,
    frameHeight: 0,
  };

  constructor(config: ReticleConfig) {
    this.canvas = config.canvas;
    this.video = config.video;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context for reticle canvas');
    }
    this.ctx = ctx;

    this.criticalThreshold = config.criticalThreshold ?? this.CRITICAL_THRESHOLD;
    this.warningThreshold = config.warningThreshold ?? this.WARNING_THRESHOLD;
    this.updateInterval = 1000 / (config.updateRate || 15); // Default 15 Hz

    this.resizeCanvas();
    this.start();
  }

  /**
   * Update reticle state from decoded frame results
   */
  updateFromFrame(result: DecodedFrameResult): void {
    const now = performance.now();

    // Get throttled frame interval from reduced-motion manager (F4: WCAG 2.3.1)
    const throttledInterval = this.reducedMotionManager.getFrameInterval(
      1000 / this.updateInterval
    );

    if (now - this.lastUpdate < throttledInterval) {
      return; // Throttle updates
    }

    this.lastUpdate = now;

    // Extract metrics from diagnostics
    const decodedTiles = result.diagnostics.filter(d => d.decoded && d.cameraPxPerModule);

    if (decodedTiles.length === 0) {
      this.state = {
        ...this.state,
        pxPerModule: 0,
        quality: 'critical',
        message: 'No QR codes detected - align screen within frame',
      };
      return;
    }

    // Calculate average px/module across all detected tiles
    const avgPxPerModule = decodedTiles.reduce(
      (sum, tile) => sum + (tile.cameraPxPerModule || 0),
      0
    ) / decodedTiles.length;

    // Determine quality category and message
    let quality: ReticleState['quality'];
    let message: string;

    if (avgPxPerModule < this.criticalThreshold) {
      quality = 'critical';
      message = `TOO FAR: ${avgPxPerModule.toFixed(1)} px/module - Move closer`;
    } else if (avgPxPerModule < this.warningThreshold) {
      quality = 'warning';
      message = `Adjusting: ${avgPxPerModule.toFixed(1)} px/module - Almost there`;
    } else {
      quality = 'good';
      message = `Good: ${avgPxPerModule.toFixed(1)} px/module - Hold steady`;
    }

    // Extract all QR positions for visualization
    const allPositions: Array<{ x: number; y: number }> = [];
    for (const tile of decodedTiles) {
      if (tile.position) {
        allPositions.push(...tile.position);
      }
    }

    // Update frame dimensions from video
    const frameWidth = this.video.videoWidth || 0;
    const frameHeight = this.video.videoHeight || 0;

    this.state = {
      pxPerModule: avgPxPerModule,
      quality,
      message,
      positions: allPositions,
      frameWidth,
      frameHeight,
    };
  }

  /**
   * Start the reticle animation loop
   */
  private start(): void {
    const render = () => {
      this.render();
      this.animationId = requestAnimationFrame(render);
    };
    render();
  }

  /**
   * Stop the reticle animation loop
   */
  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Resize canvas to match video dimensions
   */
  private resizeCanvas(): void {
    const rect = this.video.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
  }

  /**
   * Get quality color based on state
   */
  private getQualityColor(): string {
    switch (this.state.quality) {
      case 'good':
        return '#4CAF50'; // Green
      case 'warning':
        return '#FF9800'; // Amber
      case 'critical':
        return '#F44336'; // Red
    }
  }

  /**
   * Render the reticle overlay
   */
  private render(): void {
    const { width, height } = this.canvas;

    // Clear canvas
    this.ctx.clearRect(0, 0, width, height);

    // Draw reticle corner brackets
    this.drawReticle(width, height);

    // Draw detected QR positions
    this.drawQRPositions();

    // Draw quality indicator
    this.drawQualityIndicator(width, height);

    // Draw coaching message
    this.drawCoachingMessage(width, height);
  }

  /**
   * Draw document-scanner-style reticle with corner brackets
   */
  private drawReticle(width: number, height: number): void {
    const ctx = this.ctx;
    const margin = 40;
    const bracketLength = 80;
    const lineWidth = 4;

    ctx.strokeStyle = this.getQualityColor();
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';

    // Top-left bracket
    ctx.beginPath();
    ctx.moveTo(margin, margin + bracketLength);
    ctx.lineTo(margin, margin);
    ctx.lineTo(margin + bracketLength, margin);
    ctx.stroke();

    // Top-right bracket
    ctx.beginPath();
    ctx.moveTo(width - margin - bracketLength, margin);
    ctx.lineTo(width - margin, margin);
    ctx.lineTo(width - margin, margin + bracketLength);
    ctx.stroke();

    // Bottom-right bracket
    ctx.beginPath();
    ctx.moveTo(width - margin, height - margin - bracketLength);
    ctx.lineTo(width - margin, height - margin);
    ctx.lineTo(width - margin - bracketLength, height - margin);
    ctx.stroke();

    // Bottom-left bracket
    ctx.beginPath();
    ctx.moveTo(margin + bracketLength, height - margin);
    ctx.lineTo(margin, height - margin);
    ctx.lineTo(margin, height - margin - bracketLength);
    ctx.stroke();

    // Draw center crosshair (subtle)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;

    const centerX = width / 2;
    const centerY = height / 2;
    const crossSize = 30;

    ctx.beginPath();
    ctx.moveTo(centerX - crossSize, centerY);
    ctx.lineTo(centerX + crossSize, centerY);
    ctx.moveTo(centerX, centerY - crossSize);
    ctx.lineTo(centerX, centerY + crossSize);
    ctx.stroke();
  }

  /**
   * Draw detected QR code positions
   */
  private drawQRPositions(): void {
    if (this.state.positions.length === 0) {
      return;
    }

    const ctx = this.ctx;
    const videoRect = this.video.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();

    // Scale factors to convert video coordinates to canvas coordinates
    const scaleX = canvasRect.width / (this.state.frameWidth || videoRect.width);
    const scaleY = canvasRect.height / (this.state.frameHeight || videoRect.height);

    ctx.fillStyle = this.getQualityColor();
    ctx.globalAlpha = 0.3;

    // Draw circles at each detected corner
    for (const pos of this.state.positions) {
      const x = pos.x * scaleX;
      const y = pos.y * scaleY;

      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;
  }

  /**
   * Draw quality indicator (colored circle with text)
   */
  private drawQualityIndicator(width: number, height: number): void {
    const ctx = this.ctx;
    const x = 60;
    const y = 60;
    const radius = 25;

    // Draw colored circle
    ctx.fillStyle = this.getQualityColor();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Draw px/module text inside circle
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const text = this.state.pxPerModule > 0
      ? this.state.pxPerModule.toFixed(1)
      : '---';

    ctx.fillText(text, x, y);

    // Draw "px/module" label below
    ctx.fillStyle = '#fff';
    ctx.font = '11px system-ui';
    ctx.fillText('px/module', x, y + radius + 15);
  }

  /**
   * Draw coaching message at bottom of screen
   */
  private drawCoachingMessage(width: number, height: number): void {
    const ctx = this.ctx;
    const padding = 20;
    const fontSize = 16;
    const lineHeight = 24;

    ctx.font = `bold ${fontSize}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Measure text for background
    const metrics = ctx.measureText(this.state.message);
    const textWidth = metrics.width;
    const textHeight = lineHeight;

    // Draw background pill
    const bgX = (width - textWidth) / 2 - padding;
    const bgY = height - textHeight - padding * 2;
    const bgWidth = textWidth + padding * 2;
    const bgHeight = textHeight + padding * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.beginPath();
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 8);
    ctx.fill();

    // Draw border with quality color
    ctx.strokeStyle = this.getQualityColor();
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw text
    ctx.fillStyle = '#fff';
    ctx.fillText(this.state.message, width / 2, height - padding);
  }

  /**
   * Get current reticle state
   */
  getState(): ReticleState {
    return { ...this.state };
  }
}

/**
 * Create an aim reticle overlay with default configuration
 */
export function createAimReticle(config: ReticleConfig): AimReticle {
  return new AimReticle(config);
}
