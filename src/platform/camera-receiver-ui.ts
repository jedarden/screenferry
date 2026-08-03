/**
 * Camera receiver UI with aim reticle overlay (F3)
 *
 * Integrates the camera pipeline with the aim reticle overlay to provide
 * live feedback on QR code detection quality and distance coaching.
 *
 * This creates a receiver interface with:
 * - Live camera feed
 * - Document-scanner-style reticle overlay
 * - Real-time px/module measurements
 * - Distance coaching messages
 * - Quality color coding (red/amber/green)
 * - Partial artefact navigation warnings (bf-2w6u)
 *
 * Reference: plan.md §7 geometry, D16. Phase 5.
 */

import { createCameraPipeline, type CameraPipeline, type FrameResult } from './camera-pipeline.js';
import { createAimReticle, type AimReticle } from './aim-reticle.js';
import type { DecodedFrameResult } from '../modulation/types.js';
import type { StallDiagnosis } from './stall-detector.js';
import type { RecvSessionState } from '../core/session/types.js';
import { updateNavigationGuardState, enablePartialNavigationGuard, disablePartialNavigationGuard } from './navigation-guard.js';
import { createFileListUI, type FileListUI, showToast } from './file-list-ui.js';
import { getStorageManager, type OutputArtefact } from './storage.js';

/**
 * Configuration for the camera receiver UI
 */
export interface CameraReceiverUIConfig {
  /** Container element for the UI */
  container: HTMLElement;

  /** Optional: Custom camera pipeline configuration */
  cameraConfig?: Parameters<typeof createCameraPipeline>[0];

  /** Optional: Custom reticle configuration */
  reticleConfig?: {
    criticalThreshold?: number;
    warningThreshold?: number;
    updateRate?: number;
  };
}

/**
 * Camera receiver UI component
 *
 * Manages the complete receiver interface with camera feed,
 * reticle overlay, and real-time quality feedback.
 */
export class CameraReceiverUI {
  private container: HTMLElement;
  private pipeline: CameraPipeline;
  private reticle: AimReticle;

  // UI elements
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private statsPanel: HTMLElement;
  private stallWarningPanel: HTMLElement;
  private fileListUI: FileListUI;
  private fileListToggleButton: HTMLButtonElement;
  private deleteLatestButton: HTMLButtonElement;

  // State
  private running: boolean = false;
  private frameCount: number = 0;
  private lastStatsUpdate: number = 0;
  private currentStallDiagnosis: StallDiagnosis | null = null;
  private currentSessionState: RecvSessionState | null = null;

  // Performance tracking
  private readonly STATS_UPDATE_INTERVAL = 500; // Update stats every 500ms

  constructor(config: CameraReceiverUIConfig) {
    this.container = config.container;

    // Create UI structure
    this.createUI();

    // Create camera pipeline
    this.pipeline = createCameraPipeline(config.cameraConfig);

    // Create aim reticle overlay
    this.reticle = createAimReticle({
      canvas: this.canvas,
      video: this.video,
      ...config.reticleConfig,
    });

    // Wire up pipeline callbacks
    this.pipeline.setFrameResultCallback(this.handleFrameResult.bind(this));
    this.pipeline.setErrorCallback(this.handleError.bind(this));
  }

  /**
   * Create the UI structure
   */
  private createUI(): void {
    // Create wrapper for proper layering
    const wrapper = document.createElement('div');
    wrapper.className = 'camera-receiver-wrapper';
    wrapper.style.cssText = `
      position: relative;
      width: 100%;
      max-width: 1280px;
      margin: 0 auto;
      aspect-ratio: 16 / 9;
      background: #000;
      border-radius: 8px;
      overflow: hidden;
    `;

    // Create file list toggle button
    this.fileListToggleButton = this.createFileListToggleButton();

    // Create delete latest file button
    this.deleteLatestButton = this.createDeleteLatestButton();

    // Create video element
    this.video = document.createElement('video');
    this.video.id = 'camera-feed';
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000;
    `;

    // Create canvas overlay for reticle
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'reticle-overlay';
    this.canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    `;

    // Create stats panel
    this.statsPanel = document.createElement('div');
    this.statsPanel.id = 'stats-panel';
    this.statsPanel.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      line-height: 1.4;
      pointer-events: none;
    `;

    // Create stall warning panel (F2: Diagnostic stall detector)
    this.stallWarningPanel = document.createElement('div');
    this.stallWarningPanel.id = 'stall-warning-panel';
    this.stallWarningPanel.style.cssText = `
      position: absolute;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(244, 67, 54, 0.95);
      color: #fff;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: system-ui;
      font-size: 14px;
      line-height: 1.4;
      max-width: 80%;
      pointer-events: none;
      display: none;
      z-index: 10;
    `;

    // Assemble the UI
    wrapper.appendChild(this.video);
    wrapper.appendChild(this.canvas);
    wrapper.appendChild(this.statsPanel);
    wrapper.appendChild(this.stallWarningPanel);
    wrapper.appendChild(this.fileListToggleButton);
    wrapper.appendChild(this.deleteLatestButton);
    this.container.appendChild(wrapper);

    // Create file list UI
    this.fileListUI = createFileListUI({
      container: wrapper,
      onFileDeleted: this.handleFileDeleted.bind(this),
      onFileListChanged: this.handleFileListChanged.bind(this),
      position: 'top-left',
    });
  }

  /**
   * Start the receiver UI
   */
  async start(): Promise<void> {
    if (this.running) {
      console.warn('[Camera Receiver UI] Already running');
      return;
    }

    try {
      console.log('[Camera Receiver UI] Starting...');

      // Start the camera pipeline
      await this.pipeline.start();

      // Request wake lock to prevent screen sleep (F2: environment-wake-lock)
      try {
        await this.pipeline.requestWakeLock();
      } catch (error) {
        console.warn('[Camera Receiver UI] Failed to request wake lock:', error);
      }

      // Attach video stream to video element for preview
      const stream = await this.getCameraStream();
      this.video.srcObject = stream;
      await this.video.play();

      // Initialize navigation guard for partial artefacts (bf-2w6u)
      this.updateSessionState({ type: 'idle' });

      // Update delete latest button state
      await this.updateDeleteLatestButtonState();

      this.running = true;
      console.log('[Camera Receiver UI] Started successfully');
    } catch (error) {
      console.error('[Camera Receiver UI] Failed to start:', error);
      this.handleError(error as Error);
      throw error;
    }
  }

  /**
   * Get the camera stream from the pipeline
   */
  private async getCameraStream(): Promise<MediaStream> {
    // For now, request a new stream with the same constraints
    // In a production setup, we'd expose this from the pipeline
    const constraints = {
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    };

    return await navigator.mediaDevices.getUserMedia(constraints);
  }

  /**
   * Create the file list toggle button
   */
  private createFileListToggleButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'file-list-toggle-button';
    button.innerHTML = '📁';
    button.title = 'Show received files (Alt+F)';
    button.setAttribute('aria-label', 'Toggle received files list');
    button.style.cssText = `
      position: absolute;
      bottom: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      border: 1px solid #444;
      color: #fff;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 18px;
      z-index: 50;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // Hover effect
    button.addEventListener('mouseover', () => {
      button.style.background = 'rgba(33, 150, 243, 0.3)';
      button.style.borderColor = '#2196F3';
    });

    button.addEventListener('mouseout', () => {
      button.style.background = 'rgba(0, 0, 0, 0.8)';
      button.style.borderColor = '#444';
    });

    // Focus styles for keyboard accessibility
    button.addEventListener('focus', () => {
      button.style.outline = '2px solid #4CAF50';
      button.style.outlineOffset = '2px';
    });

    button.addEventListener('blur', () => {
      button.style.outline = 'none';
      button.style.outlineOffset = '0';
    });

    // Toggle file list on click
    button.addEventListener('click', () => {
      this.toggleFileList();
    });

    // Keyboard support
    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleFileList();
      }
    });

    // Global keyboard shortcut (Alt+F)
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'f') {
        e.preventDefault();
        this.toggleFileList();
      }
    });

    return button;
  }

  /**
   * Create the delete latest file button
   */
  private createDeleteLatestButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'delete-latest-button';
    button.innerHTML = '🗑️ Delete latest file';
    button.title = 'Delete the most recently received file (Alt+D)';
    button.setAttribute('aria-label', 'Delete latest received file');
    button.disabled = true; // Disabled by default until files exist
    button.style.cssText = `
      position: absolute;
      bottom: 10px;
      right: 60px;
      background: rgba(244, 67, 54, 0.8);
      border: 1px solid #F44336;
      color: #fff;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      z-index: 50;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
    `;

    // Hover effect
    button.addEventListener('mouseover', () => {
      if (!button.disabled) {
        button.style.background = 'rgba(244, 67, 54, 0.9)';
        button.style.borderColor = '#ff6b5b';
      }
    });

    button.addEventListener('mouseout', () => {
      button.style.background = 'rgba(244, 67, 54, 0.8)';
      button.style.borderColor = '#F44336';
    });

    // Focus styles for keyboard accessibility
    button.addEventListener('focus', () => {
      button.style.outline = '2px solid #4CAF50';
      button.style.outlineOffset = '2px';
    });

    button.addEventListener('blur', () => {
      button.style.outline = 'none';
      button.style.outlineOffset = '0';
    });

    // Delete action
    button.addEventListener('click', () => {
      this.handleDeleteLatestClick();
    });

    // Keyboard support
    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.handleDeleteLatestClick();
      }
    });

    // Global keyboard shortcut (Alt+D)
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'd') {
        e.preventDefault();
        this.handleDeleteLatestClick();
      }
    });

    return button;
  }

  /**
   * Handle delete latest button click
   */
  private async handleDeleteLatestClick(): Promise<void> {
    if (this.deleteLatestButton.disabled) {
      return;
    }

    try {
      const storage = getStorageManager();
      const files = await storage.listOutputs();

      // Sort by creation date (newest first)
      files.sort((a, b) => b.createdAt - a.createdAt);

      if (files.length === 0) {
        showToast('No files to delete', 'info');
        return;
      }

      const latestFile = files[0];

      // Show confirmation dialog
      const confirmed = await this.showDeleteConfirmation(latestFile);
      if (!confirmed) {
        return;
      }

      // Delete the file
      await storage.deleteOutput(latestFile.streamId, latestFile.filename);
      console.log('[Camera Receiver UI] Deleted latest file: streamId=', latestFile.streamId);

      // Show success notification
      showToast('File deleted successfully', 'success');

      // Notify callback
      if (this.fileListUI) {
        this.handleFileDeleted(latestFile.streamId);
      }

      // Update button state
      await this.updateDeleteLatestButtonState();
    } catch (error) {
      console.error('[Camera Receiver UI] Failed to delete latest file:', error);
      showToast('Failed to delete file', 'error');
    }
  }

  /**
   * Show delete confirmation dialog
   */
  private async showDeleteConfirmation(file: OutputArtefact): Promise<boolean> {
    return new Promise((resolve) => {
      const confirmed = window.confirm(
        `Are you sure you want to delete "${file.filename}"?\n\n` +
        `Size: ${this.formatFileSize(file.size)}\n` +
        `Received: ${this.formatDate(file.createdAt)}\n\n` +
        `This action cannot be undone.`
      );
      resolve(confirmed);
    });
  }

  /**
   * Update the delete latest button state based on file existence
   */
  private async updateDeleteLatestButtonState(): Promise<void> {
    try {
      const storage = getStorageManager();
      const files = await storage.listOutputs();

      const hasFiles = files.length > 0;
      this.deleteLatestButton.disabled = !hasFiles;

      // Update button text based on state
      if (hasFiles) {
        const latestFile = files.sort((a, b) => b.createdAt - a.createdAt)[0];
        this.deleteLatestButton.title = `Delete "${latestFile.filename}" (Alt+D)`;
      } else {
        this.deleteLatestButton.title = 'No files to delete';
      }
    } catch (error) {
      console.error('[Camera Receiver UI] Failed to update delete button state:', error);
      this.deleteLatestButton.disabled = true;
    }
  }

  /**
   * Format file size for display
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
  }

  /**
   * Format date for display
   */
  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'just now';
    } else if (diffMins < 60) {
      return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  /**
   * Toggle the file list visibility
   */
  private async toggleFileList(): Promise<void> {
    await this.fileListUI.toggle();
    this.updateFileListButtonState();
  }

  /**
   * Update the file list button state based on visibility
   */
  private updateFileListButtonState(): void {
    const isVisible = this.fileListUI.isPanelVisible();
    this.fileListToggleButton.innerHTML = isVisible ? '✕' : '📁';
    this.fileListToggleButton.title = isVisible ? 'Hide received files (Alt+F)' : 'Show received files (Alt+F)';
  }

  /**
   * Handle file deletion event
   */
  private handleFileDeleted(streamId: number): void {
    console.log('[Camera Receiver UI] File deleted:', streamId);
    // Additional cleanup if needed
  }

  /**
   * Handle file list changes
   */
  private handleFileListChanged(files: OutputArtefact[]): void {
    console.log('[Camera Receiver UI] File list changed:', files.length, 'files');
    // Update delete latest button state
    this.updateDeleteLatestButtonState();
  }

  /**
   * Handle a decoded frame result
   */
  private handleFrameResult(result: FrameResult): void {
    this.frameCount++;

    // Update reticle with decoded frame data
    this.reticle.updateFromFrame(result.result);

    // Check for stall conditions (F2: Diagnostic stall detector)
    this.checkStallCondition();

    // Update stats panel periodically
    const now = performance.now();
    if (now - this.lastStatsUpdate >= this.STATS_UPDATE_INTERVAL) {
      this.lastStatsUpdate = now;
      this.updateStatsPanel(result);
    }
  }

  /**
   * Update the statistics panel
   */
  private updateStatsPanel(result: FrameResult): void {
    const stats = this.pipeline.getStats();
    const reticleState = this.reticle.getState();

    const decodedCount = result.result.diagnostics.filter(d => d.decoded).length;
    const totalCount = result.result.diagnostics.length;

    this.statsPanel.innerHTML = `
      <div style="margin-bottom: 4px;"><strong>Camera Receiver</strong></div>
      <div>FPS: ${stats.captureFps.toFixed(1)}</div>
      <div>Decoding: ${stats.decodeFps.toFixed(1)} fps</div>
      <div>Packets/s: ${stats.packetsPerSec.toFixed(0)}</div>
      <div>Latency: ${stats.p50DecodeMs.toFixed(0)}ms p50</div>
      <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid #444;">
        Tiles: ${decodedCount}/${totalCount}
      </div>
      <div>px/module: ${reticleState.pxPerModule.toFixed(1)}</div>
    `;
  }

  /**
   * Handle a pipeline error
   */
  private handleError(error: Error): void {
    console.error('[Camera Receiver UI] Error:', error);

    // Show error message in stats panel
    this.statsPanel.innerHTML = `
      <div style="color: #f66;"><strong>Error</strong></div>
      <div>${error.message}</div>
    `;
  }

  /**
   * Check for stall conditions and update warning panel (F2: Diagnostic stall detector)
   */
  private checkStallCondition(): void {
    const diagnosis = this.pipeline.getStallDiagnosis();

    // Only update if diagnosis changed
    if (JSON.stringify(diagnosis) !== JSON.stringify(this.currentStallDiagnosis)) {
      this.currentStallDiagnosis = diagnosis;
      this.updateStallWarning(diagnosis);
    }
  }

  /**
   * Update the stall warning panel based on diagnosis
   */
  private updateStallWarning(diagnosis: StallDiagnosis | null): void {
    if (!diagnosis) {
      this.stallWarningPanel.style.display = 'none';
      return;
    }

    // Display the stall warning
    this.stallWarningPanel.style.display = 'block';
    this.stallWarningPanel.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 18px;">⚠️</span>
        <div>
          <div style="font-weight: 600; margin-bottom: 4px;">${diagnosis.explanation}</div>
          <div style="font-size: 13px; opacity: 0.9;">${diagnosis.suggestion}</div>
          ${diagnosis.confidence === 'low' ? '<div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">Diagnosis uncertain - trying different approaches may help</div>' : ''}
        </div>
      </div>
    `;

    // Adjust styling based on confidence
    if (diagnosis.confidence === 'low') {
      this.stallWarningPanel.style.background = 'rgba(255, 152, 0, 0.95)'; // Orange for low confidence
    } else if (diagnosis.confidence === 'high') {
      this.stallWarningPanel.style.background = 'rgba(244, 67, 54, 0.95)'; // Red for high confidence
    } else {
      this.stallWarningPanel.style.background = 'rgba(255, 152, 0, 0.95)'; // Orange for medium confidence
    }
  }

  /**
   * Stop the receiver UI
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log('[Camera Receiver UI] Stopping...');

    this.running = false;

    // Clean up file list UI
    this.fileListUI.destroy();

    // Disable navigation guard for partial artefacts (bf-2w6u)
    disablePartialNavigationGuard();
    this.currentSessionState = null;

    // Stop the reticle
    this.reticle.stop();

    // Release wake lock
    try {
      await this.pipeline.releaseWakeLock();
    } catch (error) {
      console.warn('[Camera Receiver UI] Failed to release wake lock:', error);
    }

    // Stop the pipeline
    await this.pipeline.stop();

    // Stop the video stream
    if (this.video.srcObject) {
      const stream = this.video.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      this.video.srcObject = null;
    }

    console.log('[Camera Receiver UI] Stopped');
  }

  /**
   * Update the receiver session state.
   *
   * This method should be called whenever the receiver session state changes
   * to ensure proper navigation guard behavior for partial artefacts (bf-2w6u).
   *
   * @param state - Current receiver session state
   */
  updateSessionState(state: RecvSessionState): void {
    this.currentSessionState = state;

    // Update navigation guard with new state
    try {
      updateNavigationGuardState(state);
      console.log('[Camera Receiver UI] Updated navigation guard for state:', state.type);
    } catch (error) {
      console.warn('[Camera Receiver UI] Failed to update navigation guard:', error);
    }
  }

  /**
   * Get the current receiver session state.
   */
  getSessionState(): RecvSessionState | null {
    return this.currentSessionState;
  }

  /**
   * Get current pipeline statistics
   */
  getStats() {
    return {
      pipeline: this.pipeline.getStats(),
      reticle: this.reticle.getState(),
    };
  }

  /**
   * Get the camera pipeline instance
   */
  getPipeline(): CameraPipeline {
    return this.pipeline;
  }

  /**
   * Get the aim reticle instance
   */
  getReticle(): AimReticle {
    return this.reticle;
  }
}

/**
 * Create a camera receiver UI with default configuration
 */
export function createCameraReceiverUI(config: CameraReceiverUIConfig): CameraReceiverUI {
  return new CameraReceiverUI(config);
}
