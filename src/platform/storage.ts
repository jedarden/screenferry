/**
 * Storage manager for receiver output files.
 *
 * Manages OPFS storage for decoded files, including:
 * - Storing outputs by streamId
 * - Listing all outputs
 * - Deleting outputs by streamId
 * - Startup cleanup of orphaned outputs
 * - Storage quota estimation and pre-flight checks (bf-4d6: F1)
 *
 * Reference: docs/notes/bf-ho40-startup-cleanup.md
 */

import {createPositionalWriteHandleFactory} from '../core/io/positional-write.js';

/**
 * Storage quota estimate from navigator.storage.estimate()
 */
export interface StorageQuotaEstimate {
  /** Estimated quota in bytes */
  quota: number;
  /** Current usage in bytes */
  usage: number;
  /** Available space in bytes (quota - usage) */
  available: number;
}

/**
 * Storage capacity check result
 */
export interface StorageCapacityResult {
  /** Whether there's enough storage for the operation */
  hasCapacity: boolean;
  /** Estimated quota information */
  estimate: StorageQuotaEstimate;
  /** Required space in bytes */
  requiredSpace: number;
  /** Available space in bytes */
  availableSpace: number;
  /** User-facing error message if capacity insufficient */
  error?: string;
}

/**
 * Output artefact metadata.
 */
export interface OutputArtefact {
  /** Stream ID (unique identifier) */
  streamId: number;
  /** Original filename from beacon */
  filename: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Creation timestamp */
  createdAt: number;
  /** OPFS file path */
  path: string;
}

/**
 * Orphaned file metadata with reason for orphaning.
 */
export interface OrphanedFile extends OutputArtefact {
  /** Age of the file in milliseconds */
  age: number;
  /** Human-readable reason for why the file is considered orphaned */
  reason: string;
  /** Whether the file is inactive (not in active stream IDs) */
  isInactive: boolean;
  /** Whether the file exceeds the maximum age threshold */
  isOld: boolean;
}

/**
 * Storage manager configuration.
 */
export interface StorageManagerConfig {
  /** OPFS subdirectory for receiver outputs */
  outputDirectory: string;
  /** Maximum age for orphaned outputs (ms) - default 24 hours */
  maxOrphanAge: number;
}

/**
 * Default configuration.
 */
const DEFAULT_CONFIG: StorageManagerConfig = {
  outputDirectory: 'screenferry-outputs',
  maxOrphanAge: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Storage manager for receiver outputs.
 */
export interface StorageManager {
  /**
   * Store an output file.
   *
   * @param streamId - Unique stream identifier
   * @param data - File data
   * @param filename - Original filename
   * @param mimeType - MIME type
   */
  storeOutput(
    streamId: number,
    data: Uint8Array,
    filename: string,
    mimeType: string
  ): Promise<void>;

  /**
   * Get an output file by streamId.
   *
   * @param streamId - Stream identifier
   * @returns File data or null if not found
   */
  getOutput(streamId: number): Promise<Uint8Array | null>;

  /**
   * Get metadata for an output.
   *
   * @param streamId - Stream identifier
   * @returns Metadata or null if not found
   */
  getOutputMetadata(streamId: number): Promise<OutputArtefact | null>;

  /**
   * List all output artefacts.
   *
   * @returns Array of output metadata
   */
  listOutputs(): Promise<OutputArtefact[]>;

  /**
   * Delete an output by streamId.
   *
   * @param streamId - Stream identifier
   * @param filename - Optional filename for logging purposes
   */
  deleteOutput(streamId: number, filename?: string): Promise<void>;

  /**
   * Cleanup orphaned outputs.
   *
   * Identifies and deletes outputs that exist in storage without
   * a corresponding active session reference.
   *
   * @param activeStreamIds - Set of currently active stream IDs
   * @returns Count of files cleaned up
   */
  cleanupOrphanedOutputs(activeStreamIds: Set<number>): Promise<number>;

  /**
   * Scan for orphaned files without deleting them.
   *
   * Returns detailed information about orphaned files including
   * the reason they are considered orphaned.
   *
   * @param activeStreamIds - Set of currently active stream IDs
   * @returns Array of orphaned file metadata
   */
  scanOrphanedFiles(activeStreamIds: Set<number>): Promise<OrphanedFile[]>;
}

/**
 * Estimate storage quota and usage using navigator.storage.estimate().
 *
 * **Platform behavior (bf-4d6 F1):**
 * - Chrome/Edge desktop: ~60% of free disk (multi-GB typical)
 * - Firefox: ~10% of disk, capped ~10 GB
 * - Safari/iOS: ~1 GB before prompting
 *
 * **IMPORTANT:** These estimates are ADVISORY, not guarantees. Safari's
 * estimate is particularly unreliable. Always handle quota exhaustion mid-transfer
 * even if pre-flight checks pass.
 *
 * @returns Storage quota estimate or null if not supported
 */
export async function estimateStorageQuota(): Promise<StorageQuotaEstimate | null> {
  try {
    if (!navigator.storage || !navigator.storage.estimate) {
      console.warn('[Storage] navigator.storage.estimate() not supported');
      return null;
    }

    const estimate = await navigator.storage.estimate();

    if (!estimate || estimate.quota == null || estimate.usage == null) {
      console.warn('[Storage] Invalid storage estimate:', estimate);
      return null;
    }

    const quota = estimate.quota;
    const usage = estimate.usage;
    const available = quota - usage;

    return {
      quota,
      usage,
      available,
    };
  } catch (error) {
    console.error('[Storage] Failed to estimate storage quota:', error);
    return null;
  }
}

/**
 * Calculate compression staging buffer for file transfer (bf-4d6).
 *
 * During compression and encoding, the sender needs temporary working space.
 * This accounts for:
 * - Compressed data staging
 * - Block encoding buffers
 * - Fountain code matrix storage (I6a: 1 MB working set)
 * - Temporary artifacts during transfer
 *
 * **Formula:** staging = fileSize * 0.15 + 10 MB
 * - 15% overhead for compression staging (conservative estimate)
 * - 10 MB fixed buffer for codec working sets
 *
 * @param fileSize - Size of the file to transfer in bytes
 * @returns Required staging buffer in bytes
 */
export function calculateCompressionStagingBuffer(fileSize: number): number {
  const COMPRESSION_OVERHEAD = 0.15; // 15% overhead for compression staging
  const CODEC_BUFFER = 10 * 1024 * 1024; // 10 MB fixed codec buffer

  return Math.ceil(fileSize * COMPRESSION_OVERHEAD) + CODEC_BUFFER;
}

/**
 * Check if there's enough storage capacity for a file transfer (bf-4d6 F1).
 *
 * **Pre-flight validation:** Call this BEFORE accepting a file to avoid
 * discovering quota exhaustion hours into a transfer.
 *
 * **Safety margin:** Multiplies required space by 1.5 to account for:
 * - OPFS filesystem overhead
 * - Metadata storage
 * - Quota estimate inaccuracies (especially Safari)
 * - Platform-specific quota variations
 *
 * @param fileSize - Size of the file to transfer in bytes
 * @param additionalSpace - Optional additional space to reserve in bytes
 * @returns Storage capacity check result
 */
export async function checkStorageCapacity(
  fileSize: number,
  additionalSpace: number = 0
): Promise<StorageCapacityResult> {
  // Default to assuming capacity if estimate unavailable (don't block on unsupported platforms)
  const estimate = await estimateStorageQuota();

  if (!estimate) {
    console.warn('[Storage] Unable to estimate quota, proceeding with caution');
    return {
      hasCapacity: true, // Optimistic default - let the transfer attempt
      estimate: {
        quota: 0,
        usage: 0,
        available: 0,
      },
      requiredSpace: fileSize + additionalSpace,
      availableSpace: 0,
    };
  }

  // Calculate required space with staging buffer and safety margin
  const stagingBuffer = calculateCompressionStagingBuffer(fileSize);
  const baseRequired = fileSize + stagingBuffer + additionalSpace;
  const SAFETY_MARGIN = 1.5; // 50% safety margin for quota estimate inaccuracies
  const requiredSpace = Math.ceil(baseRequired * SAFETY_MARGIN);

  const hasCapacity = estimate.available >= requiredSpace;

  if (!hasCapacity) {
    const shortfall = requiredSpace - estimate.available;
    const error = `Insufficient storage capacity. Required: ${formatBytes(requiredSpace)}, Available: ${formatBytes(estimate.available)}, Shortfall: ${formatBytes(shortfall)}`;

    console.warn('[Storage] Capacity check failed:', error);

    return {
      hasCapacity: false,
      estimate,
      requiredSpace,
      availableSpace: estimate.available,
      error,
    };
  }

  console.log('[Storage] Capacity check passed:', {
    required: formatBytes(requiredSpace),
    available: formatBytes(estimate.available),
    margin: formatBytes(estimate.available - requiredSpace),
  });

  return {
    hasCapacity: true,
    estimate,
    requiredSpace,
    availableSpace: estimate.available,
  };
}

/**
 * Format bytes as human-readable string (e.g., "1.5 GB").
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * OPFS-based storage manager implementation.
 */
class OPFSStorageManager implements StorageManager {
  private config: StorageManagerConfig;
  private opfsRoot: FileSystemDirectoryHandle | null = null;

  constructor(config: StorageManagerConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  /**
   * Get or create OPFS root directory.
   */
  private async getRoot(): Promise<FileSystemDirectoryHandle> {
    if (!this.opfsRoot) {
      this.opfsRoot = await navigator.storage.getDirectory();
    }
    return this.opfsRoot;
  }

  /**
   * Get or create output directory.
   */
  private async getOutputDirectory(): Promise<FileSystemDirectoryHandle> {
    const root = await this.getRoot();
    return await root.getDirectoryHandle(this.config.outputDirectory, { create: true });
  }

  /**
   * Get file path for a stream ID.
   */
  private getFilePath(streamId: number): string {
    return `output-${streamId}.bin`;
  }

  /**
   * Get metadata path for a stream ID.
   */
  private getMetadataPath(streamId: number): string {
    return `output-${streamId}.meta.json`;
  }

  async storeOutput(
    streamId: number,
    data: Uint8Array,
    filename: string,
    mimeType: string
  ): Promise<void> {
    const outputDir = await this.getOutputDirectory();
    const filePath = this.getFilePath(streamId);
    const metadataPath = this.getMetadataPath(streamId);

    // Store file data using positional write
    const factory = createPositionalWriteHandleFactory();
    const dataHandle = await factory.createHandle(
      `${this.config.outputDirectory}/${filePath}`,
      data.length
    );
    await dataHandle.write(data, { at: 0 });
    await dataHandle.close();

    // Prepare metadata
    const metadata: OutputArtefact = {
      streamId,
      filename,
      mimeType,
      size: data.length,
      createdAt: Date.now(),
      path: filePath,
    };

    // Store metadata using positional write
    const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
    const metaHandle = await factory.createHandle(
      `${this.config.outputDirectory}/${metadataPath}`,
      metadataBytes.length
    );
    await metaHandle.write(metadataBytes, { at: 0 });
    await metaHandle.close();

    console.log(`[Storage] Stored output: streamId=${streamId}, size=${data.length}`);
  }

  async getOutput(streamId: number): Promise<Uint8Array | null> {
    try {
      const outputDir = await this.getOutputDirectory();
      const filePath = this.getFilePath(streamId);
      const fileHandle = await outputDir.getFileHandle(filePath, { create: false });
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (e) {
      console.error(`[Storage] Failed to get output: streamId=${streamId}`, e);
      return null;
    }
  }

  async getOutputMetadata(streamId: number): Promise<OutputArtefact | null> {
    try {
      const outputDir = await this.getOutputDirectory();
      const metadataPath = this.getMetadataPath(streamId);
      const metaHandle = await outputDir.getFileHandle(metadataPath, { create: false });
      const file = await metaHandle.getFile();
      const text = await file.text();
      return JSON.parse(text) as OutputArtefact;
    } catch (e) {
      console.error(`[Storage] Failed to get metadata: streamId=${streamId}`, e);
      return null;
    }
  }

  async listOutputs(): Promise<OutputArtefact[]> {
    try {
      const outputDir = await this.getOutputDirectory();
      const outputs: OutputArtefact[] = [];

      // Iterate through directory entries
      for await (const entry of outputDir.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.meta.json')) {
          try {
            const file = await entry.getFile();
            const text = await file.text();
            const metadata = JSON.parse(text) as OutputArtefact;
            outputs.push(metadata);
          } catch (e) {
            console.error(`[Storage] Failed to parse metadata: ${entry.name}`, e);
          }
        }
      }

      return outputs;
    } catch (e) {
      console.error('[Storage] Failed to list outputs', e);
      return [];
    }
  }

  async deleteOutput(streamId: number, filename?: string): Promise<void> {
    const startTime = performance.now();

    console.log('[Storage:Deletion] Starting deletion', {
      streamId,
      filename: filename || '(unknown)',
      timestamp: new Date().toISOString(),
    });

    try {
      const outputDir = await this.getOutputDirectory();
      const filePath = this.getFilePath(streamId);
      const metadataPath = this.getMetadataPath(streamId);

      console.log('[Storage:Deletion] Deleting files', {
        streamId,
        filename: filename || '(unknown)',
        files: [filePath, metadataPath],
      });

      // Delete file and metadata
      await outputDir.removeEntry(filePath, { recursive: false });
      console.log('[Storage:Deletion] Data file deleted', {
        streamId,
        file: filePath,
      });

      await outputDir.removeEntry(metadataPath, { recursive: false });
      console.log('[Storage:Deletion] Metadata file deleted', {
        streamId,
        file: metadataPath,
      });

      const duration = performance.now() - startTime;
      console.log('[Storage:Deletion] Deletion completed successfully', {
        streamId,
        filename: filename || '(unknown)',
        duration: `${duration.toFixed(2)}ms`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      const duration = performance.now() - startTime;
      const errorDetails = {
        streamId,
        filename: filename || '(unknown)',
        duration: `${duration.toFixed(2)}ms`,
        timestamp: new Date().toISOString(),
        error: {
          name: e instanceof Error ? e.name : 'Unknown',
          message: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        },
      };

      // If file doesn't exist, that's okay - it's already gone
      if (e instanceof Error && !e.message.includes('not found')) {
        console.error('[Storage:Deletion] Failed to delete output', errorDetails);
        throw e;
      }

      // File not found - log but don't throw
      console.warn('[Storage:Deletion] Files not found (already deleted)', {
        streamId,
        filename: filename || '(unknown)',
        duration: `${duration.toFixed(2)}ms`,
      });
    }
  }

  async cleanupOrphanedOutputs(activeStreamIds: Set<number>): Promise<number> {
    console.log('[Storage] Starting orphaned output cleanup...');

    const outputs = await this.listOutputs();
    const now = Date.now();
    let cleanupCount = 0;

    for (const output of outputs) {
      // An output is orphaned if:
      // 1. It's not in the active stream IDs set, AND
      // 2. It's older than the max orphan age

      const isInactive = !activeStreamIds.has(output.streamId);
      const isOld = (now - output.createdAt) > this.config.maxOrphanAge;

      if (isInactive && isOld) {
        console.log(`[Storage] Cleaning up orphaned output: streamId=${output.streamId}, age=${Math.round((now - output.createdAt) / 1000 / 60)} minutes`);

        try {
          await this.deleteOutput(output.streamId);
          cleanupCount++;
        } catch (e) {
          console.error(`[Storage] Failed to cleanup orphaned output: streamId=${output.streamId}`, e);
        }
      }
    }

    console.log(`[Storage] Cleanup complete: removed ${cleanupCount} orphaned output(s)`);
    return cleanupCount;
  }

  async scanOrphanedFiles(activeStreamIds: Set<number>): Promise<OrphanedFile[]> {
    console.log('[Storage] Starting orphaned file scan...');

    const orphans: OrphanedFile[] = [];
    const now = Date.now();

    try {
      const outputDir = await this.getOutputDirectory();

      // Iterate through directory entries
      for await (const entry of outputDir.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.meta.json')) {
          try {
            const file = await entry.getFile();
            const text = await file.text();
            const metadata = JSON.parse(text) as OutputArtefact;

            // Calculate orphan status
            const age = now - metadata.createdAt;
            const isInactive = !activeStreamIds.has(metadata.streamId);
            const isOld = age > this.config.maxOrphanAge;

            // A file is orphaned if it's both inactive AND old
            if (isInactive && isOld) {
              const reasons: string[] = [];
              if (isInactive) {
                reasons.push('not in active stream IDs');
              }
              if (isOld) {
                reasons.push(`exceeds maximum age (${Math.round(age / 1000 / 60)} minutes > ${Math.round(this.config.maxOrphanAge / 1000 / 60)} minutes)`);
              }

              orphans.push({
                ...metadata,
                age,
                reason: reasons.join(' and '),
                isInactive,
                isOld,
              });
            }
          } catch (e) {
            // Handle corrupted metadata gracefully
            console.error(`[Storage] Failed to parse metadata file: ${entry.name}`, e);
            // Continue scanning other files
          }
        }
      }

      console.log(`[Storage] Scan complete: found ${orphans.length} orphaned file(s)`);
      return orphans;
    } catch (e) {
      console.error('[Storage] Failed to scan for orphaned files', e);
      // Return empty array on error rather than throwing
      return [];
    }
  }
}

/**
 * Global storage manager instance.
 */
let storageManagerInstance: StorageManager | null = null;

/**
 * Get the global storage manager instance.
 *
 * Creates a new instance on first call.
 *
 * @returns Storage manager instance
 */
export function getStorageManager(): StorageManager {
  if (!storageManagerInstance) {
    storageManagerInstance = new OPFSStorageManager(DEFAULT_CONFIG);
  }
  return storageManagerInstance;
}

/**
 * Reset the global storage manager instance.
 *
 *主要用于测试; 重新创建一个干净的实例。
 */
export function resetStorageManager(): void {
  storageManagerInstance = null;
}

/**
 * Configure the storage manager with custom options.
 *
 * Must be called before the first getStorageManager() invocation.
 *
 * @param config - Custom configuration
 */
export function configureStorageManager(config: Partial<StorageManagerConfig>): void {
  if (storageManagerInstance) {
    throw new Error('Storage manager already initialized. Call configureStorageManager() before getStorageManager().');
  }

  storageManagerInstance = new OPFSStorageManager({
    ...DEFAULT_CONFIG,
    ...config,
  });
}

/**
 * Run startup cleanup of orphaned outputs.
 *
 * This function should be called during app initialization to clean up
 * any orphaned output files from previous sessions.
 *
 * @param activeStreamIds - Set of currently active stream IDs (empty on startup)
 * @returns Cleanup result with count of files removed
 */
export async function runStartupCleanup(activeStreamIds: Set<number> = new Set()): Promise<{
  cleaned: number;
  error?: string;
}> {
  try {
    const storage = getStorageManager();
    const cleaned = await storage.cleanupOrphanedOutputs(activeStreamIds);
    return { cleaned };
  } catch (e) {
    console.error('[Storage] Startup cleanup failed:', e);
    return {
      cleaned: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
