/**
 * Unit tests for export operations (shareFile, saveFile).
 *
 * Tests deletion after successful export operations (bf-69cw, bf-6dho).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { shareFile, saveFile } from '../src/platform/export.js';
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

describe('saveFile() deletion behavior', () => {
  let showSaveFilePickerSpy: ReturnType<typeof vi.fn>;
  let mockFileHandle: any;
  let mockWritable: any;
  const testOptions: ExportOptions = {
    data: new Uint8Array([1, 2, 3, 4]),
    filename: 'test.dat',
    mimeType: 'application/octet-stream',
    streamId: 456,
  };

  beforeEach(() => {
    // Reset mock state
    mockStorage.deleteOutputCalls = [];
    mockStorage.shouldFail = false;

    // Create mock writable stream
    mockWritable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock file handle
    mockFileHandle = {
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    };

    // Mock showSaveFilePicker
    showSaveFilePickerSpy = vi.fn();
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: showSaveFilePickerSpy,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls deleteOutput() after successful save', async () => {
    // Mock successful save
    showSaveFilePickerSpy.mockResolvedValue(mockFileHandle);

    const result = await saveFile(testOptions);

    // Verify showSaveFilePicker was called
    expect(showSaveFilePickerSpy).toHaveBeenCalledTimes(1);
    expect(showSaveFilePickerSpy).toHaveBeenCalledWith({
      suggestedName: 'test.dat',
      types: [{
        description: 'application/octet-stream',
        accept: { 'application/octet-stream': ['*'] },
      }],
    });

    // Verify file was written
    expect(mockFileHandle.createWritable).toHaveBeenCalledTimes(1);
    expect(mockWritable.write).toHaveBeenCalledWith(testOptions.data);
    expect(mockWritable.close).toHaveBeenCalledTimes(1);

    // Verify result indicates success
    expect(result).toEqual({
      success: true,
      method: 'save',
    });

    // Verify deleteOutput was called with the streamId
    expect(mockStorage.deleteOutputCalls).toEqual([456]);
  });

  it('does NOT call deleteOutput() when save fails', async () => {
    // Mock failed save (picker succeeds, but write fails)
    showSaveFilePickerSpy.mockResolvedValue(mockFileHandle);
    mockWritable.write.mockRejectedValue(new Error('Disk full'));

    const result = await saveFile(testOptions);

    // Verify showSaveFilePicker was called
    expect(showSaveFilePickerSpy).toHaveBeenCalledTimes(1);

    // Verify result indicates failure
    expect(result).toEqual({
      success: false,
      method: 'save',
      error: 'Disk full',
    });

    // Verify deleteOutput was NOT called
    expect(mockStorage.deleteOutputCalls).toEqual([]);
  });

  it('does NOT call deleteOutput() when user cancels', async () => {
    // Mock user cancellation (AbortError)
    const abortError = new Error('User cancelled');
    abortError.name = 'AbortError';
    showSaveFilePickerSpy.mockRejectedValue(abortError);

    const result = await saveFile(testOptions);

    // Verify showSaveFilePicker was called
    expect(showSaveFilePickerSpy).toHaveBeenCalledTimes(1);

    // Verify result indicates cancellation
    expect(result).toEqual({
      success: false,
      method: 'cancelled',
    });

    // Verify deleteOutput was NOT called
    expect(mockStorage.deleteOutputCalls).toEqual([]);
  });

  it('handles deletion errors gracefully (save still succeeds)', async () => {
    // Mock successful save
    showSaveFilePickerSpy.mockResolvedValue(mockFileHandle);
    // Mock deletion failure
    mockStorage.shouldFail = true;

    const result = await saveFile(testOptions);

    // Verify showSaveFilePicker was called
    expect(showSaveFilePickerSpy).toHaveBeenCalledTimes(1);

    // Verify result still indicates success despite deletion failure
    expect(result).toEqual({
      success: true,
      method: 'save',
    });

    // Verify deleteOutput was attempted
    expect(mockStorage.deleteOutputCalls).toEqual([456]);
  });

  it('returns error when File System Access API is not supported', async () => {
    // Remove showSaveFilePicker
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const result = await saveFile(testOptions);

    // Verify result indicates API not supported
    expect(result).toEqual({
      success: false,
      method: 'save',
      error: 'File System Access API not supported on this platform',
    });

    // Verify deleteOutput was NOT called
    expect(mockStorage.deleteOutputCalls).toEqual([]);
  });

  it('handles save with unknown error type', async () => {
    // Mock save failure with non-Error value
    showSaveFilePickerSpy.mockRejectedValue('string error');

    const result = await saveFile(testOptions);

    // Verify showSaveFilePicker was called
    expect(showSaveFilePickerSpy).toHaveBeenCalledTimes(1);

    // Verify result indicates failure with string error
    expect(result).toEqual({
      success: false,
      method: 'save',
      error: 'string error',
    });

    // Verify deleteOutput was NOT called
    expect(mockStorage.deleteOutputCalls).toEqual([]);
  });

  it('handles save with null error', async () => {
    // Mock save failure with null value
    showSaveFilePickerSpy.mockRejectedValue(null);

    const result = await saveFile(testOptions);

    // Verify showSaveFilePicker was called
    expect(showSaveFilePickerSpy).toHaveBeenCalledTimes(1);

    // Verify result indicates failure
    expect(result).toEqual({
      success: false,
      method: 'save',
      error: 'null',
    });

    // Verify deleteOutput was NOT called
    expect(mockStorage.deleteOutputCalls).toEqual([]);
  });

  it('handles picker failure after selection', async () => {
    // Mock picker succeeds but createWritable fails
    showSaveFilePickerSpy.mockResolvedValue(mockFileHandle);
    mockFileHandle.createWritable.mockRejectedValue(new Error('Permission denied'));

    const result = await saveFile(testOptions);

    // Verify showSaveFilePicker was called
    expect(showSaveFilePickerSpy).toHaveBeenCalledTimes(1);

    // Verify result indicates failure
    expect(result).toEqual({
      success: false,
      method: 'save',
      error: 'Permission denied',
    });

    // Verify deleteOutput was NOT called
    expect(mockStorage.deleteOutputCalls).toEqual([]);
  });

  it('handles writable.close() failure', async () => {
    // Mock write succeeds but close fails
    showSaveFilePickerSpy.mockResolvedValue(mockFileHandle);
    mockWritable.close.mockRejectedValue(new Error('Close failed'));

    const result = await saveFile(testOptions);

    // Verify showSaveFilePicker was called
    expect(showSaveFilePickerSpy).toHaveBeenCalledTimes(1);

    // Verify result indicates failure
    expect(result).toEqual({
      success: false,
      method: 'save',
      error: 'Close failed',
    });

    // Verify deleteOutput was NOT called
    expect(mockStorage.deleteOutputCalls).toEqual([]);
  });
});
