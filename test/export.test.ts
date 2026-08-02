/**
 * Unit tests for export operations (shareFile, saveFile).
 *
 * Tests deletion after successful export operations (bf-69cw).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { shareFile } from '../src/platform/export.js';
import type { ExportOptions } from '../src/platform/export.js';

// Mock storage manager
class MockStorageManager {
  deleteOutputCalls: number[] = [];
  shouldFail: boolean = false;

  async deleteOutput(streamId: number): Promise<void> {
    this.deleteOutputCalls.push(streamId);
    if (this.shouldFail) {
      throw new Error('Mock deletion failed');
    }
  }
}

const mockStorage = new MockStorageManager();

// Mock getStorageManager
vi.mock('../src/platform/storage.js', () => ({
  getStorageManager: vi.fn(async () => mockStorage),
}));

describe('shareFile() deletion behavior', () => {
  let shareSpy: ReturnType<typeof vi.fn>;
  const testOptions: ExportOptions = {
    data: new Uint8Array([1, 2, 3, 4]),
    filename: 'test.dat',
    mimeType: 'application/octet-stream',
    streamId: 123,
  };

  beforeEach(() => {
    // Reset mock state
    mockStorage.deleteOutputCalls = [];
    mockStorage.shouldFail = false;

    // Mock navigator.share
    shareSpy = vi.fn();
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls deleteOutput() after successful share', async () => {
    // Mock successful share
    shareSpy.mockResolvedValue(undefined);

    const result = await shareFile(testOptions);

    // Verify share was called
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy).toHaveBeenCalledWith({
      files: [expect.any(File)],
      title: 'test.dat',
      text: 'Shared via ScreenFerry',
    });

    // Verify result indicates success
    expect(result).toEqual({
      success: true,
      method: 'share',
    });

    // Verify deleteOutput was called with the streamId
    expect(mockStorage.deleteOutputCalls).toEqual([123]);
  });

  it('does NOT call deleteOutput() when share fails', async () => {
    // Mock failed share (not AbortError)
    shareSpy.mockRejectedValue(new Error('Network error'));

    const result = await shareFile(testOptions);

    // Verify share was called
    expect(shareSpy).toHaveBeenCalledTimes(1);

    // Verify result indicates failure
    expect(result).toEqual({
      success: false,
      method: 'share',
      error: 'Network error',
    });

    // Verify deleteOutput was NOT called
    expect(mockStorage.deleteOutputCalls).toEqual([]);
  });

  it('does NOT call deleteOutput() when user cancels', async () => {
    // Mock user cancellation (AbortError)
    const abortError = new Error('User cancelled');
    abortError.name = 'AbortError';
    shareSpy.mockRejectedValue(abortError);

    const result = await shareFile(testOptions);

    // Verify share was called
    expect(shareSpy).toHaveBeenCalledTimes(1);

    // Verify result indicates cancellation
    expect(result).toEqual({
      success: false,
      method: 'cancelled',
    });

    // Verify deleteOutput was NOT called
    expect(mockStorage.deleteOutputCalls).toEqual([]);
  });

  it('handles deletion errors gracefully (share still succeeds)', async () => {
    // Mock successful share
    shareSpy.mockResolvedValue(undefined);
    // Mock deletion failure
    mockStorage.shouldFail = true;

    const result = await shareFile(testOptions);

    // Verify share was called
    expect(shareSpy).toHaveBeenCalledTimes(1);

    // Verify result still indicates success despite deletion failure
    expect(result).toEqual({
      success: true,
      method: 'share',
    });

    // Verify deleteOutput was attempted
    expect(mockStorage.deleteOutputCalls).toEqual([123]);
  });

  it('returns error when Web Share API is not supported', async () => {
    // Remove navigator.share
    Object.defineProperty(navigator, 'share', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const result = await shareFile(testOptions);

    // Verify result indicates API not supported
    expect(result).toEqual({
      success: false,
      method: 'share',
      error: 'Web Share API not supported on this platform',
    });

    // Verify deleteOutput was NOT called
    expect(mockStorage.deleteOutputCalls).toEqual([]);
  });

  it('handles share with unknown error type', async () => {
    // Mock share failure with non-Error value
    shareSpy.mockRejectedValue('string error');

    const result = await shareFile(testOptions);

    // Verify share was called
    expect(shareSpy).toHaveBeenCalledTimes(1);

    // Verify result indicates failure with string error
    expect(result).toEqual({
      success: false,
      method: 'share',
      error: 'string error',
    });

    // Verify deleteOutput was NOT called
    expect(mockStorage.deleteOutputCalls).toEqual([]);
  });

  it('handles share with null error', async () => {
    // Mock share failure with null value
    shareSpy.mockRejectedValue(null);

    const result = await shareFile(testOptions);

    // Verify share was called
    expect(shareSpy).toHaveBeenCalledTimes(1);

    // Verify result indicates failure
    expect(result).toEqual({
      success: false,
      method: 'share',
      error: 'null',
    });

    // Verify deleteOutput was NOT called
    expect(mockStorage.deleteOutputCalls).toEqual([]);
  });
});
