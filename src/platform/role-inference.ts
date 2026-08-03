/**
 * Role inference system (F8: Pairing splash QR)
 *
 * Determines app mode (sender/receiver) based on URL hash and user actions.
 *
 * Per F8 specification:
 * - #recv → receiver mode (camera opens by default)
 * - #send → sender mode (QR display, file drop area)
 * - No hash → receiver mode (default behavior)
 * - One-tap role inference: camera opens by default, dropping a file switches to send
 *
 * This enables the pairing splash QR workflow where the sender displays a QR
 * containing the app URL with #recv deep link so the receiver can load the
 * same page without being told where to go.
 */

/**
 * App mode enumeration
 */
export enum AppMode {
  /** Receiver mode - camera opens to capture QR codes */
  RECEIVER = 'receiver',
  /** Sender mode - QR display, file drop area */
  SENDER = 'sender',
}

/**
 * Parse URL hash to determine app mode
 *
 * @param hash - URL hash fragment (including #)
 * @returns App mode based on hash
 */
export function parseModeFromHash(hash: string): AppMode {
  // Remove leading # if present
  const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;

  switch (cleanHash.toLowerCase()) {
    case 'send':
      return AppMode.SENDER;
    case 'recv':
    case 'receive':
    case '':
    default:
      return AppMode.RECEIVER;
  }
}

/**
 * Get current app mode from window.location hash
 *
 * @returns Current app mode
 */
export function getCurrentMode(): AppMode {
  return parseModeFromHash(window.location.hash);
}

/**
 * Generate receiver deep link URL
 *
 * Creates a URL with #recv hash that can be shared via QR code.
 *
 * @returns Full URL with #recv hash
 */
export function generateReceiverLink(): string {
  const url = new URL(window.location.href);
  url.hash = 'recv';
  return url.toString();
}

/**
 * Generate sender deep link URL
 *
 * Creates a URL with #send hash that can be shared via QR code.
 *
 * @returns Full URL with #send hash
 */
export function generateSenderLink(): string {
  const url = new URL(window.location.href);
  url.hash = 'send';
  return url.toString();
}

/**
 * Switch to receiver mode
 *
 * Updates URL hash to #recv to trigger receiver mode.
 */
export function switchToReceiverMode(): void {
  window.location.hash = 'recv';
}

/**
 * Switch to sender mode
 *
 * Updates URL hash to #send to trigger sender mode.
 */
export function switchToSenderMode(): void {
  window.location.hash = 'send';
}
