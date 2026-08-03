/**
 * File list UI component for managing receiver output files.
 *
 * Provides a user-accessible interface to:
 * - View all stored receiver files
 * - Delete individual files with confirmation
 * - Shows file metadata (name, size, date)
 * - Keyboard accessible controls
 *
 * Reference: Task bf-tvef
 */

import { getStorageManager, type OutputArtefact } from './storage.js';

/**
 * Configuration for the file list UI
 */
export interface FileListUIConfig {
  /** Container element for the UI */
  container: HTMLElement;
  /** Callback when a file is deleted */
  onFileDeleted?: (streamId: number) => void;
  /** Callback when file list changes */
  onFileListChanged?: (files: OutputArtefact[]) => void;
  /** Position of the file list panel */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

/**
 * File list UI component
 */
export class FileListUI {
  private container: HTMLElement;
  private config: FileListUIConfig;
  private panel: HTMLElement;
  private fileList: HTMLElement;
  private refreshButton: HTMLButtonElement;
  private isVisible: boolean = false;

  constructor(config: FileListUIConfig) {
    this.config = {
      position: 'top-right',
      ...config,
    };
    this.container = this.config.container;

    // Create UI elements
    this.createUI();
  }

  /**
   * Create the file list UI
   */
  private createUI(): void {
    // Create main panel
    this.panel = document.createElement('div');
    this.panel.id = 'file-list-panel';
    this.panel.style.cssText = `
      position: absolute;
      ${this.getPositionStyles()}
      width: 320px;
      max-height: 400px;
      background: rgba(0, 0, 0, 0.95);
      border: 1px solid #333;
      border-radius: 8px;
      padding: 12px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      overflow-y: auto;
      z-index: 100;
      display: none;
    `;

    // Create header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #333;
    `;

    const title = document.createElement('h3');
    title.textContent = 'Received Files';
    title.style.cssText = `
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
    `;

    // Create refresh button
    this.refreshButton = document.createElement('button');
    this.refreshButton.innerHTML = '🔄';
    this.refreshButton.title = 'Refresh file list';
    this.refreshButton.style.cssText = `
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 16px;
      padding: 4px;
      border-radius: 4px;
      transition: background 0.2s;
    `;
    this.refreshButton.addEventListener('mouseover', () => {
      this.refreshButton.style.background = 'rgba(255, 255, 255, 0.1)';
    });
    this.refreshButton.addEventListener('mouseout', () => {
      this.refreshButton.style.background = 'transparent';
    });
    this.refreshButton.addEventListener('click', () => this.refreshFileList());

    header.appendChild(title);
    header.appendChild(this.refreshButton);
    this.panel.appendChild(header);

    // Create file list container
    this.fileList = document.createElement('div');
    this.fileList.id = 'file-list-items';
    this.fileList.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    this.panel.appendChild(this.fileList);

    // Add panel to container
    this.container.appendChild(this.panel);
  }

  /**
   * Get position styles based on configuration
   */
  private getPositionStyles(): string {
    switch (this.config.position) {
      case 'top-left':
        return 'top: 10px; left: 10px;';
      case 'top-right':
        return 'top: 10px; right: 10px;';
      case 'bottom-left':
        return 'bottom: 10px; left: 10px;';
      case 'bottom-right':
        return 'bottom: 10px; right: 10px;';
      default:
        return 'top: 10px; right: 10px;';
    }
  }

  /**
   * Show the file list panel
   */
  async show(): Promise<void> {
    this.isVisible = true;
    this.panel.style.display = 'block';
    await this.refreshFileList();
  }

  /**
   * Hide the file list panel
   */
  hide(): void {
    this.isVisible = false;
    this.panel.style.display = 'none';
  }

  /**
   * Toggle the file list panel visibility
   */
  async toggle(): Promise<void> {
    if (this.isVisible) {
      this.hide();
    } else {
      await this.show();
    }
  }

  /**
   * Check if the panel is visible
   */
  isPanelVisible(): boolean {
    return this.isVisible;
  }

  /**
   * Refresh the file list
   */
  private async refreshFileList(): Promise<void> {
    try {
      const storage = getStorageManager();
      const files = await storage.listOutputs();

      // Clear current list
      this.fileList.innerHTML = '';

      // Sort by creation date (newest first)
      files.sort((a, b) => b.createdAt - a.createdAt);

      // Update callback
      if (this.config.onFileListChanged) {
        this.config.onFileListChanged(files);
      }

      if (files.length === 0) {
        this.showEmptyState();
        return;
      }

      // Add file items
      for (const file of files) {
        const fileItem = this.createFileItem(file);
        this.fileList.appendChild(fileItem);
      }
    } catch (error) {
      console.error('[FileListUI] Failed to load file list:', error);
      this.showErrorState();
    }
  }

  /**
   * Show empty state
   */
  private showEmptyState(): void {
    const emptyState = document.createElement('div');
    emptyState.style.cssText = `
      text-align: center;
      padding: 20px;
      color: #999;
      font-style: italic;
    `;
    emptyState.textContent = 'No files received yet';
    this.fileList.appendChild(emptyState);
  }

  /**
   * Show error state
   */
  private showErrorState(): void {
    const errorState = document.createElement('div');
    errorState.style.cssText = `
      text-align: center;
      padding: 20px;
      color: #f66;
    `;
    errorState.textContent = 'Failed to load files';
    this.fileList.appendChild(errorState);
  }

  /**
   * Create a file item element
   */
  private createFileItem(file: OutputArtefact): HTMLElement {
    const item = document.createElement('div');
    item.style.cssText = `
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid #333;
      border-radius: 4px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;

    // File info section
    const fileInfo = document.createElement('div');
    fileInfo.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    `;

    const fileName = document.createElement('div');
    fileName.style.cssText = `
      flex: 1;
      font-weight: 500;
      color: #fff;
      word-break: break-all;
      min-width: 0;
    `;
    fileName.textContent = file.filename;
    fileName.title = file.filename; // Tooltip for full filename

    const fileSize = document.createElement('div');
    fileSize.style.cssText = `
      color: #999;
      font-size: 12px;
      white-space: nowrap;
    `;
    fileSize.textContent = this.formatFileSize(file.size);

    fileInfo.appendChild(fileName);
    fileInfo.appendChild(fileSize);

    // File metadata
    const metadata = document.createElement('div');
    metadata.style.cssText = `
      font-size: 11px;
      color: #777;
    `;
    metadata.textContent = `Received: ${this.formatDate(file.createdAt)}`;

    // Action buttons
    const actions = document.createElement('div');
    actions.style.cssText = `
      display: flex;
      gap: 8px;
      margin-top: 4px;
    `;

    // Delete button
    const deleteButton = this.createDeleteButton(file);
    actions.appendChild(deleteButton);

    item.appendChild(fileInfo);
    item.appendChild(metadata);
    item.appendChild(actions);

    return item;
  }

  /**
   * Create a delete button for a file
   */
  private createDeleteButton(file: OutputArtefact): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = 'Delete decoded file';
    button.className = 'file-delete-button';
    button.setAttribute('data-stream-id', file.streamId.toString());
    button.setAttribute('data-filename', file.filename);

    button.style.cssText = `
      background: rgba(244, 67, 54, 0.2);
      border: 1px solid #F44336;
      color: #F44336;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.2s;
      flex: 1;
      min-width: 0;
    `;

    // Hover effect
    button.addEventListener('mouseover', () => {
      button.style.background = 'rgba(244, 67, 54, 0.3)';
      button.style.borderColor = '#ff6b5b';
    });

    button.addEventListener('mouseout', () => {
      button.style.background = 'rgba(244, 67, 54, 0.2)';
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
      this.handleDeleteClick(file);
    });

    // Keyboard support
    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.handleDeleteClick(file);
      }
    });

    return button;
  }

  /**
   * Handle delete button click
   */
  private async handleDeleteClick(file: OutputArtefact): Promise<void> {
    const confirmed = await this.showDeleteConfirmation(file);
    if (!confirmed) {
      return;
    }

    try {
      await this.deleteFile(file);
      showToast('File deleted successfully', 'success');

      if (this.config.onFileDeleted) {
        this.config.onFileDeleted(file.streamId);
      }

      // Refresh the list
      await this.refreshFileList();
    } catch (error) {
      console.error('[FileListUI] Failed to delete file:', error);
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
        `This action cannot be undone.`
      );
      resolve(confirmed);
    });
  }

  /**
   * Delete a file from storage
   */
  private async deleteFile(file: OutputArtefact): Promise<void> {
    const storage = getStorageManager();
    await storage.deleteOutput(file.streamId, file.filename);
    console.log(`[FileListUI] Deleted file: streamId=${file.streamId}, size=${file.size}`);
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
      return 'Just now';
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
   * Get the panel element
   */
  getPanel(): HTMLElement {
    return this.panel;
  }

  /**
   * Get the current file list
   */
  async getFiles(): Promise<OutputArtefact[]> {
    try {
      const storage = getStorageManager();
      return await storage.listOutputs();
    } catch (error) {
      console.error('[FileListUI] Failed to get files:', error);
      return [];
    }
  }

  /**
   * Clean up and remove the UI
   */
  destroy(): void {
    this.hide();
    if (this.panel.parentNode) {
      this.panel.parentNode.removeChild(this.panel);
    }
  }
}

/**
 * Create a file list UI with default configuration
 */
export function createFileListUI(config: FileListUIConfig): FileListUI {
  return new FileListUI(config);
}

/**
 * Toast notification types
 */
type ToastType = 'success' | 'error' | 'info';

/**
 * Show a toast notification
 */
export function showToast(message: string, type: ToastType = 'info'): void {
  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#F44336' : '#2196F3'};
    color: white;
    padding: 12px 24px;
    border-radius: 4px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease-out;
  `;

  // Add animation keyframes if not already present
  if (!document.getElementById('toast-animations')) {
    const style = document.createElement('style');
    style.id = 'toast-animations';
    style.textContent = `
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }
      @keyframes fadeOut {
        from {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
        to {
          opacity: 0;
          transform: translateX(-50%) translateY(-20px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease-out';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 3000);
}
