/**
 * Photosensitivity warning dialog (F4: WCAG 2.3.1 safeguard)
 *
 * Provides WCAG 2.3.1 compliant warning about photosensitivity risks
 * before starting QR code animation. Includes:
 * - Clear warning about flashing lights
 * - Option to enable reduced-motion mode
 * - User acknowledgment requirement
 * - Compliance with WCAG 2.3.1 (3 flashes per second limit)
 *
 * Per ideas-ledger.md F4 (2026-07-31 finalist, grade S):
 * - Full-screen, high-contrast, rapidly-changing animation is a seizure risk
 * - WCAG 2.3.1 requires <3 general flashes per second OR small-safe area
 * - App flashes high-contrast frames at 12-15 fps
 * - Mitigation: bounded display region + reduced-motion mode + warning
 *
 * Reference: plan.md D10, D12. Phase 5.
 */

/**
 * Result of the photosensitivity warning dialog
 */
export interface PhotosensitivityWarningResult {
  /** Whether user acknowledged the warning */
  acknowledged: boolean;
  /** Whether reduced-motion mode is enabled */
  reducedMotion: boolean;
}

/**
 * Configuration for the photosensitivity warning
 */
export interface PhotosensitivityWarningConfig {
  /** Whether to show reduced-motion option (default: true) */
  showReducedMotionOption?: boolean;
  /** Custom message to override default warning text */
  customMessage?: string;
}

/**
 * Photosensitivity warning dialog component
 *
 * Warns users about flashing light risks and provides options
 * for reduced-motion mode before starting QR code animation.
 */
export class PhotosensitivityWarning {
  private resolved: boolean = false;
  private resolvePromise: ((result: PhotosensitivityWarningResult) => void) | null = null;
  private overlay: HTMLDivElement | null = null;
  private dialog: HTMLDivElement | null = null;

  /**
   * Show the photosensitivity warning dialog
   *
   * Returns a promise that resolves when user acknowledges
   * or dismisses the warning.
   */
  async show(config: PhotosensitivityWarningConfig = {}): Promise<PhotosensitivityWarningResult> {
    if (this.resolved) {
      return { acknowledged: false, reducedMotion: false };
    }

    // Check for reduced-motion preference
    const prefersReducedMotion = this.checkReducedMotionPreference();

    // Create and show the dialog
    this.createDialog(config, prefersReducedMotion);

    // Return promise that resolves when user makes a choice
    return new Promise<PhotosensitivityWarningResult>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  /**
   * Check if user has prefers-reduced-motion setting
   */
  private checkReducedMotionPreference(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Create the warning dialog DOM elements
   */
  private createDialog(config: PhotosensitivityWarningConfig, systemPrefersReducedMotion: boolean): void {
    // Create overlay
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      backdrop-filter: blur(4px);
    `;

    // Create dialog container
    this.dialog = document.createElement('div');
    this.dialog.style.cssText = `
      background: #1a1a1a;
      border: 2px solid #F44336;
      border-radius: 12px;
      padding: 2rem;
      max-width: 600px;
      width: 90%;
      color: #eee;
      font-family: system-ui, -apple-system, sans-serif;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    `;

    // Warning icon
    const icon = document.createElement('div');
    icon.style.cssText = `
      font-size: 3rem;
      text-align: center;
      margin-bottom: 1rem;
    `;
    icon.textContent = '⚠️';

    // Warning heading
    const heading = document.createElement('h2');
    heading.style.cssText = `
      margin: 0 0 1rem 0;
      color: #F44336;
      font-size: 1.5rem;
      text-align: center;
    `;
    heading.textContent = 'Photosensitivity Warning';

    // Warning message
    const message = document.createElement('div');
    message.style.cssText = `
      margin-bottom: 1.5rem;
      line-height: 1.6;
      color: #ccc;
    `;
    message.innerHTML = config.customMessage || this.getDefaultWarningMessage();

    // Reduced motion section
    const reducedMotionSection = document.createElement('div');
    reducedMotionSection.style.cssText = `
      margin-bottom: 1.5rem;
      padding: 1rem;
      background: #252525;
      border-radius: 8px;
      border-left: 4px solid #FF9800;
    `;

    const reducedMotionLabel = document.createElement('label');
    reducedMotionLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 0.75rem;
      cursor: pointer;
      font-size: 1rem;
    `;

    const reducedMotionCheckbox = document.createElement('input');
    reducedMotionCheckbox.type = 'checkbox';
    reducedMotionCheckbox.id = 'reduced-motion-checkbox';
    reducedMotionCheckbox.checked = systemPrefersReducedMotion;
    reducedMotionCheckbox.style.cssText = `
      width: 1.2rem;
      height: 1.2rem;
      cursor: pointer;
    `;

    const reducedMotionText = document.createElement('div');
    reducedMotionText.innerHTML = `
      <strong>Enable reduced-motion mode</strong><br>
      <span style="font-size: 0.9rem; color: #999;">
        Lowers frame rate and reduces flash area for safer viewing
        ${systemPrefersReducedMotion ? '<br><em>(Detected from system preferences)</em>' : ''}
      </span>
    `;

    reducedMotionLabel.appendChild(reducedMotionCheckbox);
    reducedMotionLabel.appendChild(reducedMotionText);
    reducedMotionSection.appendChild(reducedMotionLabel);

    // Button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      gap: 1rem;
      justify-content: center;
      margin-top: 2rem;
    `;

    // Cancel button
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.cssText = `
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
      border: 1px solid #555;
      background: #2a2a2a;
      color: #eee;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
    `;
    cancelButton.onclick = () => this.handleCancel();

    // Proceed button
    const proceedButton = document.createElement('button');
    proceedButton.textContent = 'I Understand, Proceed';
    proceedButton.style.cssText = `
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
      border: 1px solid #F44336;
      background: #F44336;
      color: #fff;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-weight: 600;
    `;
    proceedButton.onclick = () => this.handleProceed(reducedMotionCheckbox.checked);

    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(proceedButton);

    // Assemble dialog
    this.dialog.appendChild(icon);
    this.dialog.appendChild(heading);
    this.dialog.appendChild(message);
    if (config.showReducedMotionOption !== false) {
      this.dialog.appendChild(reducedMotionSection);
    }
    this.dialog.appendChild(buttonContainer);
    this.overlay.appendChild(this.dialog);

    // Add to document
    document.body.appendChild(this.overlay);

    // Handle escape key
    this.handleEscape = this.handleEscape.bind(this);
    document.addEventListener('keydown', this.handleEscape);
  }

  /**
   * Get the default warning message
   */
  private getDefaultWarningMessage(): string {
    return `
      <p style="margin-top: 0">This application displays <strong>rapidly flashing QR code patterns</strong> at high frame rates.</p>
      <p><strong>⚠️ Risk:</strong> High-contrast, rapidly-changing animations can trigger <strong>photosensitive seizures</strong> in some individuals.</p>
      <p><strong>What we do to protect you:</strong></p>
      <ul style="margin-bottom: 0">
        <li>QR codes are displayed in a <strong>bounded region</strong> (not full-screen)</li>
        <li>A <strong>static surround</strong> reduces flash area</li>
        <li><strong>Reduced-motion mode</strong> is available for safer viewing</li>
      </ul>
    `;
  }

  /**
   * Handle user cancel (dismiss without acknowledging)
   */
  private handleCancel(): void {
    this.cleanup();
    if (this.resolvePromise) {
      this.resolvePromise({ acknowledged: false, reducedMotion: false });
      this.resolvePromise = null;
    }
  }

  /**
   * Handle user proceed (acknowledge and continue)
   */
  private handleProceed(reducedMotion: boolean): void {
    this.cleanup();
    if (this.resolvePromise) {
      this.resolvePromise({ acknowledged: true, reducedMotion });
      this.resolvePromise = null;
    }
  }

  /**
   * Handle escape key press
   */
  private handleEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.handleCancel();
    }
  }

  /**
   * Clean up dialog elements
   */
  private cleanup(): void {
    const startTime = new Date().toISOString();

    // Log cleanup operation start with timestamp
    console.log(JSON.stringify({
      level: 'info',
      timestamp: startTime,
      operation: 'photosensitivity-warning-cleanup',
      message: 'Cleanup operation started',
      component: 'PhotosensitivityWarning',
    }, null, 0));

    this.resolved = true;
    document.removeEventListener('keydown', this.handleEscape);

    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.dialog = null;

    const endTime = new Date().toISOString();

    // Log cleanup operation end with timestamp
    console.log(JSON.stringify({
      level: 'info',
      timestamp: endTime,
      operation: 'photosensitivity-warning-cleanup',
      message: 'Cleanup operation completed',
      component: 'PhotosensitivityWarning',
      startTime,
      endTime,
    }, null, 0));
  }
}

/**
 * Create a photosensitivity warning dialog
 */
export function createPhotosensitivityWarning(): PhotosensitivityWarning {
  return new PhotosensitivityWarning();
}

/**
 * Show a photosensitivity warning and return the result
 *
 * Convenience function that creates, shows, and returns the warning result.
 */
export async function showPhotosensitivityWarning(
  config?: PhotosensitivityWarningConfig
): Promise<PhotosensitivityWarningResult> {
  const warning = createPhotosensitivityWarning();
  return await warning.show(config);
}
