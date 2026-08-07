/**
 * Navigation guard for partial receiver artefacts.
 *
 * Prevents accidental navigation away from incomplete transfers,
 * showing security warnings about persistent plaintext data.
 *
 * Reference: docs/notes/bf-1yk1-t4b-deletion-lifecycle.md
 */

import type {RecvSessionState} from '../core/session/types.js';
import {
  detectPartialArtefact,
  shouldWarnOnNavigation,
  type PartialArtefactInfo,
} from './partial-artefact-detector.js';
import {
  showPartialWarningDialog,
  dismissPartialWarningDialog,
  type WarningDialogResult,
  PartialArtefactAction,
} from './partial-warning-dialog.js';

/**
 * Navigation guard configuration.
 */
export interface NavigationGuardConfig {
  /** Enable/disable the navigation guard */
  enabled: boolean;
  /** Require acknowledgment before allowing navigation */
  requireAcknowledgment: boolean;
  /** Available actions when warning is triggered */
  actions: PartialArtefactAction[];
  /** Custom callback when navigation is intercepted */
  onIntercept?: (partialInfo: PartialArtefactInfo) => void;
  /** Custom callback when user chooses action */
  onAction?: (result: WarningDialogResult, partialInfo: PartialArtefactInfo) => void;
}

/**
 * Default navigation guard configuration.
 */
const DEFAULT_CONFIG: NavigationGuardConfig = {
  enabled: true,
  requireAcknowledgment: true,
  actions: [PartialArtefactAction.KEEP, PartialArtefactAction.DELETE, PartialArtefactAction.CANCEL],
};

/**
 * Navigation guard for partial artefacts.
 *
 * Monitors navigation events and warns users about partial artefacts.
 */
export class PartialArtefactNavigationGuard {
  private config: NavigationGuardConfig;
  private currentState: RecvSessionState | null = null;
  private beforeUnloadHandler: ((event: BeforeUnloadEvent) => void) | null = null;
  private interceptCount = 0;

  constructor(config: NavigationGuardConfig = DEFAULT_CONFIG) {
    this.config = {...DEFAULT_CONFIG, ...config};
  }

  /**
   * Update the current receiver session state.
   *
   * @param state - Current receiver session state
   */
  updateState(state: RecvSessionState): void {
    this.currentState = state;

    // Update navigation guard based on state
    if (this.config.enabled && shouldWarnOnNavigation(state)) {
      this.enable();
    } else {
      this.disable();
    }
  }

  /**
   * Enable the navigation guard.
   */
  enable(): void {
    if (this.beforeUnloadHandler) {
      return; // Already enabled
    }

    this.beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      this.handleBeforeUnload(event);
    };

    // Also listen for visibility changes (tab backgrounding)
    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));

    // Also listen for popstate (browser navigation)
    window.addEventListener('popstate', this.handlePopState.bind(this));

    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  /**
   * Disable the navigation guard.
   */
  disable(): void {
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }

    document.removeEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    window.removeEventListener('popstate', this.handlePopState.bind(this));
  }

  /**
   * Check if the guard is currently enabled.
   */
  isEnabled(): boolean {
    return this.beforeUnloadHandler !== null;
  }

  /**
   * Handle beforeunload event.
   */
  private async handleBeforeUnload(event: BeforeUnloadEvent): Promise<void> {
    if (!this.currentState) {
      return;
    }

    const partialInfo = detectPartialArtefact(this.currentState);
    if (!partialInfo) {
      return;
    }

    // Don't warn if nearly complete (>95%)
    if (partialInfo.progressPercent > 95) {
      return;
    }

    // Track intercept for analytics/debugging
    this.interceptCount++;

    // Call custom callback if configured
    if (this.config.onIntercept) {
      this.config.onIntercept(partialInfo);
    }

    // Note: beforeunload doesn't allow async/promises, so we can't show a custom dialog
    // We have to use the browser's native confirmation dialog
    event.preventDefault();
    event.returnValue = this.getBrowserWarningMessage(partialInfo);

    // The browser will show its own dialog based on returnValue
  }

  /**
   * Handle visibility change (tab backgrounding).
   */
  private handleVisibilityChange(): void {
    if (document.hidden && this.currentState) {
      const partialInfo = detectPartialArtefact(this.currentState);
      if (partialInfo && partialInfo.progressPercent <= 95) {
        console.warn('[NavigationGuard] Tab backgrounded with partial artefact:', partialInfo);
        // Could trigger a notification here
      }
    }
  }

  /**
   * Handle popstate event (browser back/forward buttons).
   */
  private handlePopState(event: PopStateEvent): void {
    if (!this.currentState) {
      return;
    }

    const partialInfo = detectPartialArtefact(this.currentState);
    if (!partialInfo) {
      return;
    }

    // Don't warn if nearly complete (>95%)
    if (partialInfo.progressPercent > 95) {
      return;
    }

    // For popstate, we can show a custom dialog since it's not a page unload
    this.handleInterceptedNavigation(partialInfo);
  }

  /**
   * Handle intercepted navigation (custom dialog flow).
   */
  private async handleInterceptedNavigation(partialInfo: PartialArtefactInfo): Promise<void> {
    try {
      const result = await showPartialWarningDialog(partialInfo, {
        actions: this.config.actions,
        requireAcknowledgment: this.config.requireAcknowledgment,
      });

      // Call custom callback if configured
      if (this.config.onAction) {
        this.config.onAction(result, partialInfo);
      }

      // Handle user's choice
      switch (result.action) {
        case 'keep':
          // Allow navigation to proceed
          console.log('[NavigationGuard] User chose to keep partial artefact');
          break;

        case 'delete':
          // Delete the partial artefact and allow navigation
          console.log('[NavigationGuard] User chose to delete partial artefact');
          await this.deletePartialArtefact(partialInfo);
          break;

        case 'cancel':
          // Prevent navigation by pushing state back
          console.log('[NavigationGuard] User cancelled navigation');
          window.history.pushState(null, '', window.location.href);
          break;

        case 'export':
          // Export the partial artefact
          console.log('[NavigationGuard] User chose to export partial artefact');
          await this.exportPartialArtefact(partialInfo);
          break;
      }
    } catch (error) {
      console.error('[NavigationGuard] Failed to handle intercepted navigation:', error);
    }
  }

  /**
   * Get browser warning message for beforeunload dialog.
   */
  private getBrowserWarningMessage(partialInfo: PartialArtefactInfo): string {
    const percent = Math.round(partialInfo.progressPercent);
    return `You have an incomplete file transfer (${percent}% complete). If you leave, the partial file will be stored in plaintext. Are you sure you want to leave?`;
  }

  /**
   * Delete a partial artefact.
   */
  private async deletePartialArtefact(partialInfo: PartialArtefactInfo): Promise<void> {
    try {
      // Import storage manager dynamically to avoid circular dependencies
      const {getStorageManager} = await import('./storage.js');
      const storage = getStorageManager();
      await storage.deleteOutput(partialInfo.streamId);
      console.log(`[NavigationGuard] Deleted partial artefact: streamId=${partialInfo.streamId}`);
    } catch (error) {
      console.error(`[NavigationGuard] Failed to delete partial artefact:`, error);
    }
  }

  /**
   * Export a partial artefact.
   */
  private async exportPartialArtefact(partialInfo: PartialArtefactInfo): Promise<void> {
    try {
      // Import export manager dynamically to avoid circular dependencies
      const {getStorageManager} = await import('./storage.js');
      const storage = getStorageManager();
      const data = await storage.getOutput(partialInfo.streamId);

      if (!data) {
        console.error(`[NavigationGuard] Failed to get partial artefact for export: streamId=${partialInfo.streamId}`);
        return;
      }

      // Create download link
      const blob = new Blob([data], {type: partialInfo.filename.endsWith('.gz') ? 'application/gzip' : 'application/octet-stream'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${partialInfo.filename}.partial`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log(`[NavigationGuard] Exported partial artefact: streamId=${partialInfo.streamId}`);
    } catch (error) {
      console.error(`[NavigationGuard] Failed to export partial artefact:`, error);
    }
  }

  /**
   * Get statistics about navigation guard activity.
   */
  getStats(): {interceptCount: number; enabled: boolean; hasPartialState: boolean} {
    return {
      interceptCount: this.interceptCount,
      enabled: this.isEnabled(),
      hasPartialState: this.currentState ? shouldWarnOnNavigation(this.currentState) : false,
    };
  }

  /**
   * Reset the navigation guard state.
   */
  reset(): void {
    this.disable();
    this.currentState = null;
    this.interceptCount = 0;
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<NavigationGuardConfig>): void {
    this.config = {...this.config, ...config};

    // Re-enable/disable based on new config
    if (this.currentState && this.config.enabled) {
      if (shouldWarnOnNavigation(this.currentState)) {
        this.enable();
      } else {
        this.disable();
      }
    } else {
      this.disable();
    }
  }
}

/**
 * Global navigation guard instance.
 */
let globalNavigationGuard: PartialArtefactNavigationGuard | null = null;

/**
 * Get the global navigation guard instance.
 *
 * @returns Navigation guard instance
 */
export function getPartialNavigationGuard(): PartialArtefactNavigationGuard {
  if (!globalNavigationGuard) {
    globalNavigationGuard = new PartialArtefactNavigationGuard();
  }
  return globalNavigationGuard;
}

/**
 * Update the navigation guard with current session state.
 *
 * Convenience function that uses the global navigation guard.
 *
 * @param state - Current receiver session state
 */
export function updateNavigationGuardState(state: RecvSessionState): void {
  const guard = getPartialNavigationGuard();
  guard.updateState(state);
}

/**
 * Enable the navigation guard.
 *
 * Convenience function that uses the global navigation guard.
 */
export function enablePartialNavigationGuard(): void {
  const guard = getPartialNavigationGuard();
  guard.enable();
}

/**
 * Disable the navigation guard.
 *
 * Convenience function that uses the global navigation guard.
 */
export function disablePartialNavigationGuard(): void {
  const guard = getPartialNavigationGuard();
  guard.disable();
}

/**
 * Configure the navigation guard.
 *
 * Convenience function that uses the global navigation guard.
 *
 * @param config - Navigation guard configuration
 */
export function configurePartialNavigationGuard(config: Partial<NavigationGuardConfig>): void {
  const guard = getPartialNavigationGuard();
  guard.updateConfig(config);
}
