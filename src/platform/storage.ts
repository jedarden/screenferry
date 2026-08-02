/**
 * Storage manager for receiver output files.
 *
 * Manages OPFS storage for decoded files, including:
 * - Storing outputs by streamId
 * - Listing all outputs
 * - Deleting outputs by streamId
 * - Startup cleanup of orphaned outputs
 *
 * Reference: docs/notes/bf-ho40-startup-cleanup.md
 */

import {createPositionalWriteHandleFactory} from '../core/io/positional-write.js';

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
   */
  deleteOutput(streamId: number): Promise<void>;

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

    console.log(`[Storage] Stored output: streamId=${streamId}, filename=${filename}, size=${data.length}`);
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

  async deleteOutput(streamId: number): Promise<void> {
    try {
      const outputDir = await this.getOutputDirectory();
      const filePath = this.getFilePath(streamId);
      const metadataPath = this.getMetadataPath(streamId);

      // Delete file and metadata
      await outputDir.removeEntry(filePath, { recursive: false });
      await outputDir.removeEntry(metadataPath, { recursive: false });

      console.log(`[Storage] Deleted output: streamId=${streamId}`);
    } catch (e) {
      // If file doesn't exist, that's okay - it's already gone
      if (e instanceof Error && !e.message.includes('not found')) {
        console.error(`[Storage] Failed to delete output: streamId=${streamId}`, e);
        throw e;
      }
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
        console.log(`[Storage] Cleaning up orphaned output: streamId=${output.streamId}, filename=${output.filename}, age=${Math.round((now - output.createdAt) / 1000 / 60)} minutes`);

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
