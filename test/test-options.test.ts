/**
 * Tests for test-options type definition and utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  type TestOptions,
  DEFAULT_TEST_OPTIONS,
  createTestOptions,
  isMemorySamplingEnabled,
} from '../src/test-options.js';

describe('TestOptions', () => {
  describe('type definition', () => {
    it('should define TestOptions interface', () => {
      const options: TestOptions = {
        enableMemorySampling: true,
      };
      expect(options).toBeDefined();
      expect(options.enableMemorySampling).toBe(true);
    });

    it('should allow optional enableMemorySampling field', () => {
      const options: TestOptions = {};
      expect(options).toBeDefined();
      expect(options.enableMemorySampling).toBeUndefined();
    });
  });

  describe('DEFAULT_TEST_OPTIONS', () => {
    it('should have memory sampling disabled by default', () => {
      expect(DEFAULT_TEST_OPTIONS.enableMemorySampling).toBe(false);
    });
  });

  describe('createTestOptions', () => {
    it('should return default options when no overrides provided', () => {
      const options = createTestOptions();
      expect(options.enableMemorySampling).toBe(false);
    });

    it('should return default options when empty object provided', () => {
      const options = createTestOptions({});
      expect(options.enableMemorySampling).toBe(false);
    });

    it('should override enableMemorySampling when explicitly set to true', () => {
      const options = createTestOptions({ enableMemorySampling: true });
      expect(options.enableMemorySampling).toBe(true);
    });

    it('should override enableMemorySampling when explicitly set to false', () => {
      const options = createTestOptions({ enableMemorySampling: false });
      expect(options.enableMemorySampling).toBe(false);
    });
  });

  describe('isMemorySamplingEnabled', () => {
    it('should return false when no options provided', () => {
      expect(isMemorySamplingEnabled()).toBe(false);
    });

    it('should return false when empty options object provided', () => {
      expect(isMemorySamplingEnabled({})).toBe(false);
    });

    it('should return true when enableMemorySampling is true', () => {
      expect(isMemorySamplingEnabled({ enableMemorySampling: true })).toBe(true);
    });

    it('should return false when enableMemorySampling is false', () => {
      expect(isMemorySamplingEnabled({ enableMemorySampling: false })).toBe(false);
    });
  });
});
