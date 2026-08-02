/**
 * Sender splash UI with QR code display (F8: Pairing splash QR)
 *
 * Displays a large QR code containing the app URL with #recv deep link
 * so the receiver can load the same page without being told where to go.
 *
 * This solves the bootstrap problem: both devices need the same page open,
 * and currently there's no answer for the "we both need the same page" problem.
 *
 * Features:
 * - Large, easily scannable QR code with receiver deep link
 * - Clear instructions for both sender and receiver
 * - File drop area for one-tap role switching (F8 merge)
 * - Professional styling matching ScreenFerry design
 */

import QRCode from 'qrcode';
import { generateReceiverLink, switchToReceiverMode } from './role-inference.js';

/**
 * Configuration for the sender splash UI
 */
export interface SenderSplashUIConfig {
  /** Container element for the UI */
  container: HTMLElement;

  /** Optional: Custom QR code configuration */
  qrConfig?: {
    /** QR code size in pixels (default: 300) */
    size?: number;
    /** QR code margin (default: 2) */
    margin?: number;
    /** QR code color (default: #000000) */
    color?: {
      dark?: string;
      light?: string;
    };
  };

  /** Optional: Callback when a file is dropped */
  onFileDrop?: (file: File) => void;
}

/**
 * Sender splash UI component
 *
 * Manages the sender interface with QR code display,
 * instructions, and file drop area.
 */
export class SenderSplashUI {
  private container: HTMLElement;
  private qrConfig: Required<SenderSplashUIConfig['qrConfig']>;
  private onFileDrop?: (file: File) => void;

  // UI elements
  private qrCodeContainer: HTMLElement;
  private qrCanvas: HTMLCanvasElement;
  private dropZone: HTMLElement;
  private dropZoneText: HTMLElement;

  // State
  private initialized: boolean = false;

  constructor(config: SenderSplashUIConfig) {
    this.container = config.container;
    this.qrConfig = {
      size: config.qrConfig?.size ?? 300,
      margin: config.qrConfig?.margin ?? 2,
      color: {
        dark: config.qrConfig?.color?.dark ?? '#000000',
        light: config.qrConfig?.color?.light ?? '#FFFFFF',
      },
    };
    this.onFileDrop = config.onFileDrop;

    // Create UI structure
    this.createUI();
  }

  /**
   * Create the UI structure
   */
  private createUI(): void {
    // Create main wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'sender-splash-wrapper';
    wrapper.style.cssText = `
      max-width: 1280px;
      margin: 0 auto;
      padding: 1rem;
    `;

    // Create header
    const header = document.createElement('header');
    header.style.cssText = `
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #333;
    `;
    header.innerHTML = `
      <h1 style="margin: 0; font-size: 1.5rem;">ScreenFerry - Sender Mode</h1>
      <p style="margin: 0.5rem 0 0 0; color: #999; font-size: 0.9rem;">
        F8: Pairing splash QR - Share this screen with a receiver
      </p>
    `;

    // Create main content area with two columns
    const content = document.createElement('div');
    content.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
      margin-top: 1rem;
    `;

    // Create left column: QR code and instructions
    const leftColumn = document.createElement('div');
    leftColumn.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
    `;

    // Create QR code container
    this.qrCodeContainer = document.createElement('div');
    this.qrCodeContainer.className = 'qr-code-container';
    this.qrCodeContainer.style.cssText = `
      background: #fff;
      padding: 1rem;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

    // Create canvas for QR code
    this.qrCanvas = document.createElement('canvas');
    this.qrCanvas.id = 'pairing-qr-code';
    this.qrCanvas.style.cssText = `
      display: block;
      max-width: 100%;
      height: auto;
    `;

    this.qrCodeContainer.appendChild(this.qrCanvas);
    leftColumn.appendChild(this.qrCodeContainer);

    // Create instructions panel
    const instructions = document.createElement('div');
    instructions.style.cssText = `
      background: #1a1a1a;
      padding: 1.5rem;
      border-radius: 8px;
      width: 100%;
    `;
    instructions.innerHTML = `
      <h2 style="margin: 0 0 1rem 0; font-size: 1.1rem;">Pairing Instructions</h2>
      <ol style="margin: 0; padding-left: 1.5rem; line-height: 1.8;">
        <li><strong>Receiver:</strong> Scan this QR code with your phone camera</li>
        <li><strong>Receiver:</strong> Open the link to land in receive mode</li>
        <li><strong>Sender:</strong> Drop a file below to start transmission</li>
        <li><strong>Both:</strong> Keep devices steady during transfer</li>
      </ol>
      <p style="margin: 1rem 0 0 0; color: #F44336; font-size: 0.9rem;">
        Note: This requires both devices to be online. For air-gapped transfer,
        use offline distribution (F6) or pre-install the app.
      </p>
    `;

    leftColumn.appendChild(instructions);

    // Create right column: file drop zone and additional info
    const rightColumn = document.createElement('div');
    rightColumn.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    `;

    // Create file drop zone
    this.dropZone = document.createElement('div');
    this.dropZone.className = 'file-drop-zone';
    this.dropZone.style.cssText = `
      background: #1a1a1a;
      border: 2px dashed #444;
      border-radius: 8px;
      padding: 2rem;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s ease;
      min-height: 200px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    `;

    this.dropZoneText = document.createElement('div');
    this.dropZoneText.style.cssText = `
      font-size: 1.1rem;
      color: #999;
    `;
    this.dropZoneText.innerHTML = `
      <div style="font-size: 2rem; margin-bottom: 0.5rem;">📁</div>
      <div style="font-weight: 500; color: #fff;">Drop a file here to send</div>
      <div style="font-size: 0.9rem; margin-top: 0.5rem;">or click to browse</div>
    `;

    this.dropZone.appendChild(this.dropZoneText);
    rightColumn.appendChild(this.dropZone);

    // Create feature highlights
    const features = document.createElement('div');
    features.style.cssText = `
      background: #1a1a1a;
      padding: 1.5rem;
      border-radius: 8px;
    `;
    features.innerHTML = `
      <h2 style="margin: 0 0 1rem 0; font-size: 1.1rem;">ScreenFerry Features</h2>
      <ul style="margin: 0; padding-left: 1.5rem; line-height: 1.6;">
        <li>🎯 <strong>Smart reticle:</strong> Distance coach ensures optimal QR capture</li>
        <li>⚡ <strong>Fast transfers:</strong> Fountain codes for reliable delivery</li>
        <li>🔒 <strong>Privacy-first:</strong> No cloud, no tracking, peer-to-peer only</li>
        <li>📱 <strong>Air-gapped:</strong> Works offline after initial load</li>
      </ul>
    `;

    rightColumn.appendChild(features);

    // Create switch mode button
    const switchMode = document.createElement('button');
    switchMode.style.cssText = `
      background: #2196F3;
      color: white;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1rem;
      width: 100%;
      transition: background 0.2s ease;
    `;
    switchMode.textContent = 'Switch to Receiver Mode';
    switchMode.addEventListener('click', () => {
      switchToReceiverMode();
    });

    // Add hover effect
    switchMode.addEventListener('mouseenter', () => {
      switchMode.style.background = '#1976D2';
    });
    switchMode.addEventListener('mouseleave', () => {
      switchMode.style.background = '#2196F3';
    });

    rightColumn.appendChild(switchMode);

    // Assemble the UI
    content.appendChild(leftColumn);
    content.appendChild(rightColumn);
    wrapper.appendChild(header);
    wrapper.appendChild(content);
    this.container.appendChild(wrapper);

    // Set up drag and drop handlers
    this.setupDragAndDrop();
  }

  /**
   * Set up drag and drop handlers
   */
  private setupDragAndDrop(): void {
    const zone = this.dropZone;

    // Prevent default drag behavior
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      zone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    // Highlight drop zone on drag enter
    ['dragenter', 'dragover'].forEach(eventName => {
      zone.addEventListener(eventName, () => {
        zone.style.borderColor = '#4CAF50';
        zone.style.background = '#1e3d1e';
      });
    });

    // Remove highlight on drag leave
    ['dragleave', 'drop'].forEach(eventName => {
      zone.addEventListener(eventName, () => {
        zone.style.borderColor = '#444';
        zone.style.background = '#1a1a1a';
      });
    });

    // Handle file drop
    zone.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this.handleFileDrop(files[0]);
      }
    });

    // Handle click to browse
    zone.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '*/*';
      input.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.files && target.files.length > 0) {
          this.handleFileDrop(target.files[0]);
        }
      });
      input.click();
    });
  }

  /**
   * Handle file drop
   */
  private handleFileDrop(file: File): void {
    console.log('[Sender Splash] File dropped:', file.name, file.size, 'bytes');

    // Update drop zone to show selected file
    this.dropZoneText.innerHTML = `
      <div style="font-size: 2rem; margin-bottom: 0.5rem;">✅</div>
      <div style="font-weight: 500; color: #fff;">${file.name}</div>
      <div style="font-size: 0.9rem; margin-top: 0.5rem;">${this.formatFileSize(file.size)}</div>
    `;

    // Notify parent
    if (this.onFileDrop) {
      this.onFileDrop(file);
    }
  }

  /**
   * Format file size for display
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Generate and display QR code
   *
   * Creates a QR code containing the receiver deep link URL.
   */
  async generateQR(): Promise<void> {
    try {
      console.log('[Sender Splash] Generating QR code...');

      const receiverLink = generateReceiverLink();
      console.log('[Sender Splash] Receiver link:', receiverLink);

      // Generate QR code on canvas
      await QRCode.toCanvas(this.qrCanvas, receiverLink, {
        width: this.qrConfig.size,
        margin: this.qrConfig.margin,
        color: {
          dark: this.qrConfig.color.dark,
          light: this.qrConfig.color.light,
        },
      });

      console.log('[Sender Splash] QR code generated successfully');
      this.initialized = true;
    } catch (error) {
      console.error('[Sender Splash] Failed to generate QR code:', error);
      this.qrCodeContainer.innerHTML = `
        <div style="color: #f66; padding: 2rem; text-align: center;">
          Failed to generate QR code
          <pre style="margin-top: 1rem; background: #000; padding: 0.5rem; border-radius: 4px; overflow: auto;">${error instanceof Error ? error.message : String(error)}</pre>
        </div>
      `;
    }
  }

  /**
   * Start the sender splash UI
   */
  async start(): Promise<void> {
    if (this.initialized) {
      console.warn('[Sender Splash] Already initialized');
      return;
    }

    try {
      console.log('[Sender Splash] Starting sender splash UI...');
      await this.generateQR();
      console.log('[Sender Splash] Sender splash UI started successfully');
    } catch (error) {
      console.error('[Sender Splash] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop the sender splash UI
   */
  stop(): void {
    console.log('[Sender Splash] Stopping sender splash UI');
    // Cleanup if needed
    this.initialized = false;
  }

  /**
   * Get the QR code canvas element
   */
  getQRCanvas(): HTMLCanvasElement {
    return this.qrCanvas;
  }

  /**
   * Get the drop zone element
   */
  getDropZone(): HTMLElement {
    return this.dropZone;
  }
}

/**
 * Create a sender splash UI with default configuration
 */
export function createSenderSplashUI(config: SenderSplashUIConfig): SenderSplashUI {
  return new SenderSplashUI(config);
}
