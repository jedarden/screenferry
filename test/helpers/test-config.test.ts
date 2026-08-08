/**
 * Tests for common test configuration system.
 *
 * Reference: bead bf-20d0h
 */

import { describe, expect, it } from 'vitest';
import {
  validateSamplingInterval,
  getSamplingInterval,
  createSamplingConfig,
  validateTestConfig,
  DEFAULT_SAMPLING_INTERVAL,
  type BaseTestConfig,
  type SamplingConfig,
} from './test-config.js';

describe('test-config', () => {
  describe('validateSamplingInterval', () => {
    it('should accept valid positive integers', () => {
      expect(validateSamplingInterval(1)).toBe(true);
      expect(validateSamplingInterval(100)).toBe(true);
      expect(validateSamplingInterval(1000)).toBe(true);
    });

    it('should reject zero', () => {
      expect(() => validateSamplingInterval(0)).toThrow(
        'Sampling interval must be a positive integer'
      );
    });

    it('should reject negative numbers', () => {
      expect(() => validateSamplingInterval(-1)).toThrow(
        'Sampling interval must be a positive integer'
      );
      expect(() => validateSamplingInterval(-100)).toThrow(
        'Sampling interval must be a positive integer'
      );
    });

    it('should reject non-integers', () => {
      expect(() => validateSamplingInterval(1.5)).toThrow(
        'Sampling interval must be an integer'
      );
      expect(() => validateSamplingInterval(100.1)).toThrow(
        'Sampling interval must be an integer'
      );
    });

    it('should reject NaN', () => {
      expect(() => validateSamplingInterval(NaN)).toThrow(
        'Sampling interval must be a number'
      );
    });

    it('should reject non-numbers', () => {
      expect(() => validateSamplingInterval('100' as unknown as number)).toThrow(
        'Sampling interval must be a number'
      );
    });
  });

  describe('getSamplingInterval', () => {
    it('should return default interval when not specified', () => {
      expect(getSamplingInterval({})).toBe(100);
      expect(getSamplingInterval({}, 200)).toBe(200);
    });

    it('should return configured interval', () => {
      expect(getSamplingInterval({ samplingInterval: 50 })).toBe(50);
      expect(getSamplingInterval({ samplingInterval: 200 }, 100)).toBe(200);
    });

    it('should validate the interval', () => {
      expect(() => getSamplingInterval({ samplingInterval: 0 })).toThrow();
      expect(() => getSamplingInterval({ samplingInterval: -1 })).toThrow();
      expect(() => getSamplingInterval({ samplingInterval: 1.5 })).toThrow();
    });

    it('should use default when explicitly undefined', () => {
      expect(getSamplingInterval({ samplingInterval: undefined }, 100)).toBe(100);
    });
  });

  describe('createSamplingConfig', () => {
    it('should create config with default interval', () => {
      const config = createSamplingConfig({});
      expect(config.interval).toBe(100);
      expect(config.enabled).toBe(true);
    });

    it('should create config with custom interval', () => {
      const config = createSamplingConfig({ samplingInterval: 200 });
      expect(config.interval).toBe(200);
      expect(config.enabled).toBe(true);
    });

    it('should create config with custom default', () => {
      const config = createSamplingConfig({}, 250);
      expect(config.interval).toBe(250);
      expect(config.enabled).toBe(true);
    });

    it('should validate the interval', () => {
      expect(() => createSamplingConfig({ samplingInterval: 0 })).toThrow();
      expect(() => createSamplingConfig({ samplingInterval: -1 })).toThrow();
    });
  });

  describe('validateTestConfig', () => {
    it('should pass with no sampling interval', () => {
      expect(() => validateTestConfig({})).not.toThrow();
    });

    it('should pass with valid sampling interval', () => {
      expect(() => validateTestConfig({ samplingInterval: 100 })).not.toThrow();
      expect(() => validateTestConfig({ samplingInterval: 1 })).not.toThrow();
      expect(() => validateTestConfig({ samplingInterval: 1000 })).not.toThrow();
    });

    it('should fail with invalid sampling interval', () => {
      expect(() => validateTestConfig({ samplingInterval: 0 })).toThrow();
      expect(() => validateTestConfig({ samplingInterval: -1 })).toThrow();
      expect(() => validateTestConfig({ samplingInterval: 1.5 })).toThrow();
    });

    it('should pass with undefined sampling interval', () => {
      expect(() => validateTestConfig({ samplingInterval: undefined })).not.toThrow();
    });
  });

  describe('DEFAULT_SAMPLING_INTERVAL', () => {
    it('should be defined as 100', () => {
      expect(DEFAULT_SAMPLING_INTERVAL).toBe(100);
    });
  });

  describe('type exports', () => {
    it('should export BaseTestConfig type', () => {
      const config: BaseTestConfig = { samplingInterval: 100 };
      expect(config.samplingInterval).toBe(100);
    });

    it('should export SamplingConfig type', () => {
      const config: SamplingConfig = { interval: 100, enabled: true };
      expect(config.interval).toBe(100);
      expect(config.enabled).toBe(true);
    });
  });
});
