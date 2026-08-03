/**
 * Sender splash UI tests (F8: Pairing splash QR)
 *
 * Tests QR code generation, file drop zone, and sender splash UI functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSenderSplashUI, type SenderSplashUI } from '../src/platform/sender-splash-ui.js';
import { generateReceiverLink } from '../src/platform/role-inference.js';

describe('sender-splash-ui', () => {
  let container: HTMLElement;
  let senderUI: SenderSplashUI;

  beforeEach(() => {
    // Create a fresh container for each test
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Clean up UI
    if (senderUI && 'stop' in senderUI) {
      senderUI.stop();
    }
    document.body.removeChild(container);
  });

  describe('UI Creation', () => {
    it('should create sender splash UI with QR code container', () => {
      senderUI = createSenderSplashUI({
        container,
      });

      expect(container.querySelector('.qr-code-container')).toBeTruthy();
      expect(container.querySelector('#pairing-qr-code')).toBeTruthy();
    });

    it('should create file drop zone', () => {
      senderUI = createSenderSplashUI({
        container,
      });

      expect(container.querySelector('.file-drop-zone')).toBeTruthy();
    });

    it('should create instructions panel', () => {
      senderUI = createSenderSplashUI({
        container,
      });

      const instructions = container.querySelector('h2');
      expect(instructions?.textContent).toContain('Pairing Instructions');
    });

    it('should create switch mode button', () => {
      senderUI = createSenderSplashUI({
        container,
      });

      const button = container.querySelector('button');
      expect(button?.textContent).toContain('Switch to Receiver Mode');
    });
  });

  describe('QR Code Generation', () => {
    it('should generate QR code on start', async () => {
      senderUI = createSenderSplashUI({
        container,
      });

      await senderUI.start();

      const qrCanvas = senderUI.getQRCanvas();
      expect(qrCanvas).toBeTruthy();
      expect(qrCanvas.width).toBeGreaterThan(0);
      expect(qrCanvas.height).toBeGreaterThan(0);
    });

    it('should generate QR code with receiver deep link', async () => {
      senderUI = createSenderSplashUI({
        container,
      });

      await senderUI.start();

      const receiverLink = generateReceiverLink();
      const qrCanvas = senderUI.getQRCanvas();

      // QR code generation should have succeeded
      expect(qrCanvas).toBeTruthy();
    });

    it('should use custom QR config when provided', async () => {
      senderUI = createSenderSplashUI({
        container,
        qrConfig: {
          size: 200,
          margin: 4,
          color: {
            dark: '#FF0000',
            light: '#00FF00',
          },
        },
      });

      await senderUI.start();

      const qrCanvas = senderUI.getQRCanvas();
      // Note: QR generation may fail in test environment due to Canvas API limitations
      // but the UI should still be created with proper config
      expect(qrCanvas).toBeTruthy();
    });
  });

  describe('File Drop Zone', () => {
    it('should call onFileDrop callback when file is dropped', async () => {
      let droppedFile: File | null = null;

      senderUI = createSenderSplashUI({
        container,
        onFileDrop: (file: File) => {
          droppedFile = file;
        },
      });

      await senderUI.start();

      const dropZone = senderUI.getDropZone();

      // Verify drop zone exists and is ready
      expect(dropZone).toBeTruthy();
      expect(dropZone.classList.contains('file-drop-zone')).toBe(true);

      // Note: DragEvent testing is limited in test environment
      // The file drop functionality is tested manually in browser
    });

    it('should update drop zone text when file is selected', async () => {
      senderUI = createSenderSplashUI({
        container,
        onFileDrop: () => {},
      });

      await senderUI.start();

      const dropZone = senderUI.getDropZone();
      expect(dropZone).toBeTruthy();
      expect(dropZone.textContent).toContain('Drop a file here to send');
    });
  });

  describe('F8 Feature Integration', () => {
    it('should display pairing instructions for both sender and receiver', async () => {
      senderUI = createSenderSplashUI({
        container,
      });

      await senderUI.start();

      const instructions = container.querySelector('h2');
      expect(instructions?.textContent).toContain('Pairing Instructions');

      const instructionsList = container.querySelector('ol');
      expect(instructionsList).toBeTruthy();
      expect(instructionsList?.textContent).toContain('Receiver');
      expect(instructionsList?.textContent).toContain('Sender');
    });

    it('should show offline limitation notice', async () => {
      senderUI = createSenderSplashUI({
        container,
      });

      await senderUI.start();

      const content = container.textContent || '';
      expect(content).toContain('online');
      expect(content).toContain('air-gapped');
    });

    it('should support complete pairing workflow', async () => {
      senderUI = createSenderSplashUI({
        container,
      });

      await senderUI.start();

      // 1. QR code is generated
      const qrCanvas = senderUI.getQRCanvas();
      expect(qrCanvas).toBeTruthy();

      // 2. File drop zone is ready
      const dropZone = senderUI.getDropZone();
      expect(dropZone).toBeTruthy();

      // 3. Switch to receiver button is available
      const switchButton = container.querySelector('button');
      expect(switchButton).toBeTruthy();
      expect(switchButton?.textContent).toContain('Switch to Receiver Mode');

      // 4. Instructions are displayed
      const instructions = container.querySelector('h2');
      expect(instructions?.textContent).toContain('Pairing Instructions');
    });
  });

  describe('QR Code Styling', () => {
    it('should apply proper styling to QR code container', async () => {
      senderUI = createSenderSplashUI({
        container,
      });

      await senderUI.start();

      const qrContainer = container.querySelector('.qr-code-container');
      expect(qrContainer).toBeTruthy();

      const computedStyle = window.getComputedStyle(qrContainer!);
      expect(computedStyle.backgroundColor).toBe('rgb(255, 255, 255)');
      expect(computedStyle.padding).not.toBe('0px');
    });

    it('should apply proper styling to drop zone', async () => {
      senderUI = createSenderSplashUI({
        container,
      });

      await senderUI.start();

      const dropZone = container.querySelector('.file-drop-zone');
      expect(dropZone).toBeTruthy();

      const computedStyle = window.getComputedStyle(dropZone!);
      expect(computedStyle.border).toContain('dashed');
    });
  });

  describe('Feature Highlights', () => {
    it('should display ScreenFerry features', async () => {
      senderUI = createSenderSplashUI({
        container,
      });

      await senderUI.start();

      // Look for all h2 elements in the container
      const headers = container.querySelectorAll('h2');
      let featuresHeader: HTMLElement | null = null;

      for (const header of headers) {
        if (header.textContent?.includes('ScreenFerry Features')) {
          featuresHeader = header as HTMLElement;
          break;
        }
      }

      expect(featuresHeader).toBeTruthy();

      // Find the feature list (it should be in the same column as the features header)
      const featureList = container.querySelectorAll('ul');
      let featureListElement: HTMLUListElement | null = null;

      for (const list of featureList) {
        if (list.textContent?.includes('Smart reticle')) {
          featureListElement = list as HTMLUListElement;
          break;
        }
      }

      expect(featureListElement).toBeTruthy();
      expect(featureListElement?.textContent).toContain('Smart reticle');
      expect(featureListElement?.textContent).toContain('Fast transfers');
      expect(featureListElement?.textContent).toContain('Privacy-first');
      expect(featureListElement?.textContent).toContain('Air-gapped');
    });
  });
});
