/**
 * Partial artefact warning dialog system.
 *
 * Provides security-focused warnings when users would keep partial artefacts.
 * Implements the T4b deletion lifecycle requirement for user warnings.
 *
 * Reference: docs/notes/bf-1yk1-t4b-deletion-lifecycle.md
 */

import type {PartialArtefactInfo, PartialArtefactType} from './partial-artefact-detector.js';

/**
 * User action choice for partial artefact warnings.
 */
export enum PartialArtefactAction {
  /** Keep the partial artefact */
  KEEP = 'keep',
  /** Delete the partial artefact */
  DELETE = 'delete',
  /** Cancel the operation */
  CANCEL = 'cancel',
  /** Export the artefact (if available) */
  EXPORT = 'export',
}

/**
 * Warning dialog result.
 */
export interface WarningDialogResult {
  /** User's chosen action */
  action: PartialArtefactAction;
  /** Whether the user acknowledged the security warning */
  acknowledged: boolean;
  /** Optional user feedback */
  feedback?: string;
}

/**
 * Warning dialog configuration.
 */
export interface WarningDialogConfig {
  /** Title of the warning dialog */
  title?: string;
  /** Custom message (overrides default) */
  message?: string;
  /** Available actions */
  actions: PartialArtefactAction[];
  /** Whether acknowledgment is required */
  requireAcknowledgment: boolean;
  /** Timeout for auto-dismiss (ms, 0 = no timeout) */
  timeout?: number;
  /** Custom CSS class for styling */
  cssClass?: string;
}

/**
 * Partial artefact warning dialog manager.
 *
 * Creates and manages security-focused warning dialogs for partial artefacts.
 */
export class PartialWarningDialogManager {
  private activeDialog: HTMLElement | null = null;
  private activeResolver: ((result: WarningDialogResult) => void) | null = null;
  private overlay: HTMLElement | null = null;

  /**
   * Show a warning dialog for partial artefacts.
   *
   * @param partialInfo - Information about the partial artefact
   * @param config - Dialog configuration
   * @returns Promise resolving to user's action choice
   */
  async showWarning(
    partialInfo: PartialArtefactInfo,
    config: WarningDialogConfig
  ): Promise<WarningDialogResult> {
    // Dismiss any existing dialog
    this.dismiss();

    // Create dialog elements
    this.createOverlay();
    this.activeDialog = this.createDialog(partialInfo, config);

    // Add to DOM
    if (this.overlay && this.activeDialog) {
      document.body.appendChild(this.overlay);
      document.body.appendChild(this.activeDialog);

      // Focus the dialog for accessibility
      this.activeDialog.focus();
    }

    // Set up timeout if configured
    let timeoutId: number | null = null;
    if (config.timeout && config.timeout > 0) {
      timeoutId = window.setTimeout(() => {
        this.dismiss();
        if (this.activeResolver) {
          this.activeResolver({ action: PartialArtefactAction.CANCEL, acknowledged: false });
        }
      }, config.timeout);
    }

    // Wait for user action
    return new Promise((resolve) => {
      this.activeResolver = (result: WarningDialogResult) => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        this.dismiss();
        resolve(result);
      };
    });
  }

  /**
   * Dismiss the active dialog.
   */
  dismiss(): void {
    if (this.activeResolver) {
      // Resolve with cancel if dialog was programmatically dismissed
      this.activeResolver({ action: PartialArtefactAction.CANCEL, acknowledged: false });
      this.activeResolver = null;
    }

    if (this.activeDialog) {
      this.activeDialog.remove();
      this.activeDialog = null;
    }

    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  /**
   * Check if a dialog is currently active.
   */
  isActive(): boolean {
    return this.activeDialog !== null;
  }

  /**
   * Create the overlay element.
   */
  private createOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'partial-warning-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(2px);
    `;

    // Click on overlay dismisses the dialog
    this.overlay.addEventListener('click', () => {
      this.dismiss();
    });
  }

  /**
   * Create the dialog element.
   */
  private createDialog(
    partialInfo: PartialArtefactInfo,
    config: WarningDialogConfig
  ): HTMLElement {
    const dialog = document.createElement('div');
    dialog.className = `partial-warning-dialog ${config.cssClass || ''}`;
    dialog.tabIndex = -1; // Make focusable
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-labelledby', 'partial-warning-title');
    dialog.setAttribute('aria-describedby', 'partial-warning-message');

    // Dialog styling
    dialog.style.cssText = `
      background: #1a1a1a;
      border: 2px solid #f93;
      border-radius: 8px;
      padding: 2rem;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
      position: relative;
      color: #eee;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      line-height: 1.6;
    `;

    // Prevent clicks on dialog from dismissing
    dialog.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // ESC key dismisses
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.dismiss();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);

    // Build dialog content
    const title = config.title || this.getDefaultTitle(partialInfo.type);
    const message = config.message || partialInfo.securityMessage;

    dialog.innerHTML = `
      <div class="partial-warning-header" style="display: flex; align-items: center; gap: 12px; margin-bottom: 1.5rem;">
        <span class="warning-icon" style="font-size: 32px;">⚠️</span>
        <h2 id="partial-warning-title" style="margin: 0; font-size: 1.5rem; color: #f93;">${this.escapeHtml(title)}</h2>
      </div>

      <div id="partial-warning-message" class="partial-warning-message" style="margin-bottom: 2rem; white-space: pre-line; background: #222; padding: 1rem; border-radius: 4px; border-left: 4px solid #f93;">
        ${this.escapeHtml(message)}
      </div>

      <div class="partial-warning-progress" style="margin-bottom: 1.5rem; padding: 1rem; background: #222; border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
          <span>Progress:</span>
          <span>${partialInfo.progressPercent.toFixed(1)}%</span>
        </div>
        <div style="width: 100%; height: 8px; background: #333; border-radius: 4px; overflow: hidden;">
          <div style="width: ${partialInfo.progressPercent}%; height: 100%; background: ${this.getProgressColor(partialInfo.progressPercent)}; transition: width 0.3s;"></div>
        </div>
        <div style="margin-top: 0.5rem; font-size: 12px; color: #999;">
          ${partialInfo.completeBlocks} of ${partialInfo.totalBlocks} blocks received
        </div>
      </div>

      ${this.buildActions(config.actions, config.requireAcknowledgment)}
    `;

    // Set up event handlers for buttons
    this.setupActionHandlers(dialog, config);

    return dialog;
  }

  /**
   * Get default title for partial artefact type.
   */
  private getDefaultTitle(type: PartialArtefactType): string {
    switch (type) {
      case PartialArtefactType.QUOTA_EXHAUSTED:
        return 'Storage Quota Exhausted';
      case PartialArtefactType.DECOMPRESS_FAILED:
        return 'Decompression Failed';
      case PartialArtefactType.INCOMPLETE_DOWNLOAD:
        return 'Incomplete Download';
      case PartialArtefactType.VERIFICATION_FAILED:
        return 'Verification Failed';
      default:
        return 'Partial File Warning';
    }
  }

  /**
   * Get progress bar color based on percentage.
   */
  private getProgressColor(percent: number): string {
    if (percent < 25) return '#f33';
    if (percent < 50) return '#f93';
    if (percent < 75) return '#fc3';
    return '#3c3';
  }

  /**
   * Build action buttons HTML.
   */
  private buildActions(
    actions: PartialArtefactAction[],
    requireAcknowledgment: boolean
  ): string {
    const buttons = actions.map(action => {
      const buttonText = this.getActionButtonText(action);
      const buttonStyle = this.getActionButtonStyle(action);
      return `<button data-action="${action}" style="${buttonStyle}">${buttonText}</button>`;
    }).join('');

    const acknowledgment = requireAcknowledgment ? `
      <label style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 1.5rem; cursor: pointer;">
        <input type="checkbox" id="partial-warning-acknowledge" required style="margin-top: 2px;">
        <span style="font-size: 13px;">I understand this data will persist in plaintext storage</span>
      </label>
    ` : '';

    return `
      <div class="partial-warning-actions" style="display: flex; flex-direction: column; gap: 1rem;">
        ${acknowledgment}
        <div style="display: flex; gap: 1rem; justify-content: flex-end; flex-wrap: wrap;">
          ${buttons}
        </div>
      </div>
    `;
  }

  /**
   * Get button text for action.
   */
  private getActionButtonText(action: PartialArtefactAction): string {
    switch (action) {
      case PartialArtefactAction.KEEP:
        return 'Keep Partial File';
      case PartialArtefactAction.DELETE:
        return 'Delete';
      case PartialArtefactAction.CANCEL:
        return 'Cancel';
      case PartialArtefactAction.EXPORT:
        return 'Export Compressed';
      default:
        return 'OK';
    }
  }

  /**
   * Get button style for action.
   */
  private getActionButtonStyle(action: PartialArtefactAction): string {
    const baseStyle = `
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    switch (action) {
      case PartialArtefactAction.DELETE:
        return baseStyle + `
          background: #c33;
          color: white;
        `;
      case PartialArtefactAction.KEEP:
      case PartialArtefactAction.EXPORT:
        return baseStyle + `
          background: #3a3;
          color: white;
        `;
      case PartialArtefactAction.CANCEL:
        return baseStyle + `
          background: #555;
          color: white;
        `;
      default:
        return baseStyle + `
          background: #666;
          color: white;
        `;
    }
  }

  /**
   * Set up event handlers for action buttons.
   */
  private setupActionHandlers(dialog: HTMLElement, config: WarningDialogConfig): void {
    const buttons = dialog.querySelectorAll('button[data-action]');
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        const action = button.getAttribute('data-action') as PartialArtefactAction;
        const acknowledged = this.checkAcknowledgment(dialog);

        if (config.requireAcknowledgment && !acknowledged && action !== PartialArtefactAction.CANCEL) {
          // Show error or highlight checkbox
          const checkbox = dialog.querySelector('#partial-warning-acknowledge') as HTMLInputElement;
          if (checkbox) {
            checkbox.style.borderColor = '#f33';
            checkbox.focus();
            return; // Don't allow action without acknowledgment
          }
        }

        if (this.activeResolver) {
          this.activeResolver({
            action,
            acknowledged,
          });
        }
      });
    });

    // Add hover effects
    buttons.forEach(button => {
      button.addEventListener('mouseenter', () => {
        button.style.transform = 'scale(1.05)';
      });
      button.addEventListener('mouseleave', () => {
        button.style.transform = 'scale(1)';
      });
    });
  }

  /**
   * Check if user acknowledged the warning.
   */
  private checkAcknowledgment(dialog: HTMLElement): boolean {
    const checkbox = dialog.querySelector('#partial-warning-acknowledge') as HTMLInputElement;
    return checkbox ? checkbox.checked : false;
  }

  /**
   * Escape HTML to prevent XSS.
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

/**
 * Global dialog manager instance.
 */
let globalDialogManager: PartialWarningDialogManager | null = null;

/**
 * Get the global dialog manager instance.
 *
 * @returns Dialog manager instance
 */
export function getPartialWarningDialogManager(): PartialWarningDialogManager {
  if (!globalDialogManager) {
    globalDialogManager = new PartialWarningDialogManager();
  }
  return globalDialogManager;
}

/**
 * Show a warning dialog for partial artefacts using the global manager.
 *
 * Convenience function that uses the global dialog manager.
 *
 * @param partialInfo - Information about the partial artefact
 * @param config - Dialog configuration
 * @returns Promise resolving to user's action choice
 */
export async function showPartialWarningDialog(
  partialInfo: PartialArtefactInfo,
  config: WarningDialogConfig
): Promise<WarningDialogResult> {
  const manager = getPartialWarningDialogManager();
  return manager.showWarning(partialInfo, config);
}

/**
 * Dismiss any active partial warning dialog.
 *
 * @returns True if a dialog was dismissed
 */
export function dismissPartialWarningDialog(): boolean {
  const manager = getPartialWarningDialogManager();
  if (manager.isActive()) {
    manager.dismiss();
    return true;
  }
  return false;
}
