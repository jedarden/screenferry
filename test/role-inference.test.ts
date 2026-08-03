/**
 * Role inference system tests (F8: Pairing splash QR)
 *
 * Tests URL hash parsing, mode detection, and deep link generation
 * for the sender/receiver role switching functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AppMode,
  parseModeFromHash,
  getCurrentMode,
  generateReceiverLink,
  generateSenderLink,
  switchToReceiverMode,
  switchToSenderMode,
} from '../src/platform/role-inference.js';

describe('role-inference', () => {
  describe('parseModeFromHash', () => {
    it('should parse #recv hash as receiver mode', () => {
      expect(parseModeFromHash('#recv')).toBe(AppMode.RECEIVER);
      expect(parseModeFromHash('#RECV')).toBe(AppMode.RECEIVER);
    });

    it('should parse #receive hash as receiver mode', () => {
      expect(parseModeFromHash('#receive')).toBe(AppMode.RECEIVER);
      expect(parseModeFromHash('#RECEIVE')).toBe(AppMode.RECEIVER);
    });

    it('should parse #send hash as sender mode', () => {
      expect(parseModeFromHash('#send')).toBe(AppMode.SENDER);
      expect(parseModeFromHash('#SEND')).toBe(AppMode.SENDER);
    });

    it('should parse empty hash as receiver mode (default)', () => {
      expect(parseModeFromHash('')).toBe(AppMode.RECEIVER);
      expect(parseModeFromHash('#')).toBe(AppMode.RECEIVER);
    });

    it('should parse unknown hash as receiver mode (default)', () => {
      expect(parseModeFromHash('#unknown')).toBe(AppMode.RECEIVER);
      expect(parseModeFromHash('#foo')).toBe(AppMode.RECEIVER);
    });

    it('should handle hash without leading #', () => {
      expect(parseModeFromHash('recv')).toBe(AppMode.RECEIVER);
      expect(parseModeFromHash('send')).toBe(AppMode.SENDER);
    });
  });

  describe('generateReceiverLink', () => {
    it('should generate URL with #recv hash', () => {
      // Mock window.location
      const originalLocation = window.location;
      delete (window as any).location;
      window.location = new URL('https://example.com/screenferry') as any;

      const link = generateReceiverLink();
      expect(link).toContain('#recv');

      window.location = originalLocation;
    });

    it('should preserve existing URL components', () => {
      const originalLocation = window.location;
      delete (window as any).location;
      window.location = new URL('https://example.com/screenferry?foo=bar') as any;

      const link = generateReceiverLink();
      expect(link).toContain('foo=bar');
      expect(link).toContain('#recv');

      window.location = originalLocation;
    });
  });

  describe('generateSenderLink', () => {
    it('should generate URL with #send hash', () => {
      const originalLocation = window.location;
      delete (window as any).location;
      window.location = new URL('https://example.com/screenferry') as any;

      const link = generateSenderLink();
      expect(link).toContain('#send');

      window.location = originalLocation;
    });

    it('should preserve existing URL components', () => {
      const originalLocation = window.location;
      delete (window as any).location;
      window.location = new URL('https://example.com/screenferry?foo=bar') as any;

      const link = generateSenderLink();
      expect(link).toContain('foo=bar');
      expect(link).toContain('#send');

      window.location = originalLocation;
    });
  });

  describe('switchToReceiverMode', () => {
    it('should set window.location.hash to #recv', () => {
      const originalLocation = window.location;
      delete (window as any).location;
      window.location = new URL('https://example.com/screenferry') as any;

      switchToReceiverMode();
      expect(window.location.hash).toBe('#recv');

      window.location = originalLocation;
    });
  });

  describe('switchToSenderMode', () => {
    it('should set window.location.hash to #send', () => {
      const originalLocation = window.location;
      delete (window as any).location;
      window.location = new URL('https://example.com/screenferry') as any;

      switchToSenderMode();
      expect(window.location.hash).toBe('#send');

      window.location = originalLocation;
    });
  });

  describe('getCurrentMode', () => {
    it('should return current mode from window.location.hash', () => {
      const originalLocation = window.location;
      delete (window as any).location;

      window.location = new URL('https://example.com/screenferry#recv') as any;
      expect(getCurrentMode()).toBe(AppMode.RECEIVER);

      window.location = new URL('https://example.com/screenferry#send') as any;
      expect(getCurrentMode()).toBe(AppMode.SENDER);

      window.location = originalLocation;
    });

    it('should default to receiver mode for empty hash', () => {
      const originalLocation = window.location;
      delete (window as any).location;
      window.location = new URL('https://example.com/screenferry') as any;

      expect(getCurrentMode()).toBe(AppMode.RECEIVER);

      window.location = originalLocation;
    });
  });

  describe('F8 Feature Integration', () => {
    it('should support complete pairing workflow', () => {
      const originalLocation = window.location;
      delete (window as any).location;
      window.location = new URL('https://example.com/screenferry') as any;

      // 1. Sender generates receiver deep link
      const receiverLink = generateReceiverLink();
      expect(receiverLink).toContain('#recv');

      // 2. Receiver opens link and lands in receive mode
      window.location = new URL(receiverLink) as any;
      expect(getCurrentMode()).toBe(AppMode.RECEIVER);

      // 3. Sender can switch to receiver mode
      switchToReceiverMode();
      expect(window.location.hash).toBe('#recv');

      // 4. Receiver can switch to sender mode
      switchToSenderMode();
      expect(window.location.hash).toBe('#send');
      expect(getCurrentMode()).toBe(AppMode.SENDER);

      window.location = originalLocation;
    });

    it('should handle case-insensitive hash parsing', () => {
      expect(parseModeFromHash('#RECV')).toBe(AppMode.RECEIVER);
      expect(parseModeFromHash('#Recv')).toBe(AppMode.RECEIVER);
      expect(parseModeFromHash('#SEND')).toBe(AppMode.SENDER);
      expect(parseModeFromHash('#Send')).toBe(AppMode.SENDER);
    });
  });
});
