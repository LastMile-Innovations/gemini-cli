/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import { isNodeError } from './errors.js';
import { FileStateTracker, type FileState, type FileFreshnessResult } from './fileStateTracker.js';

/**
 * Status of a tracked file.
 */
export enum FileStatus {
  /** File has not been read by the agent */
  NOT_READ = 'not_read',
  /** File has been read and is current (no external changes) */
  READ_CURRENT = 'read_current',
  /** File has been read but is stale (externally modified) */
  READ_STALE = 'read_stale',
  /** File has been read but encountered an error */
  READ_ERROR = 'read_error',
}

/**
 * Entry for a tracked file.
 */
export interface FileEntry {
  /** Absolute path to the file */
  path: string;
  /** Last known state of the file */
  state: FileState;
  /** Current status of the file */
  status: FileStatus;
  /** Timestamp when the file was first read */
  firstReadAt: Date;
  /** Timestamp when the file state was last updated */
  lastUpdatedAt: Date;
  /** Error message if status is READ_ERROR */
  error?: string;
}

/**
 * Options for file tracking configuration.
 */
export interface FileTrackerServiceOptions {
  /** Whether to compute content hashes for more accurate comparison (default: false) */
  useContentHash?: boolean;
  /** Whether to generate diffs when files change (default: true) */
  generateDiffs?: boolean;
  /** Maximum number of files to track (default: 1000) */
  maxTrackedFiles?: number;
  /** Whether to track all files or only those explicitly registered (default: false) */
  trackAllFiles?: boolean;
}

/**
 * Service for tracking file state across the agent's session.
 * Provides global awareness of which files have been read and their current status.
 */
export class FileTrackerService {
  private readonly stateTracker: FileStateTracker;
  private readonly trackedFiles = new Map<string, FileEntry>();
  private readonly options: Required<FileTrackerServiceOptions>;

  constructor(options: FileTrackerServiceOptions = {}) {
    this.stateTracker = new FileStateTracker({
      useContentHash: options.useContentHash ?? false,
      generateDiffs: options.generateDiffs ?? true,
    });

    this.options = {
      useContentHash: options.useContentHash ?? false,
      generateDiffs: options.generateDiffs ?? true,
      maxTrackedFiles: options.maxTrackedFiles ?? 1000,
      trackAllFiles: options.trackAllFiles ?? false,
    };
  }

  /**
   * Registers a file that has been read by the agent.
   * @param filePath Path to the file
   * @param state Current state of the file
   * @returns Promise resolving when registration is complete
   */
  async registerFile(filePath: string, state: FileState): Promise<void> {
    const entry: FileEntry = {
      path: filePath,
      state,
      status: FileStatus.READ_CURRENT,
      firstReadAt: new Date(),
      lastUpdatedAt: new Date(),
    };

    this.trackedFiles.set(filePath, entry);

    // Enforce maximum tracked files limit
    if (this.trackedFiles.size > this.options.maxTrackedFiles) {
      this.evictOldestEntry();
    }
  }

  /**
   * Updates the state of a tracked file.
   * @param filePath Path to the file
   * @param newState New state of the file
   * @returns Promise resolving when update is complete
   */
  async updateFileState(filePath: string, newState: FileState): Promise<void> {
    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      throw new Error(`File not tracked: ${filePath}`);
    }

    entry.state = newState;
    entry.lastUpdatedAt = new Date();

    // Update status based on freshness check
    try {
      const freshnessResult = await this.stateTracker.checkFreshness(
        filePath,
        newState,
      );
      entry.status = freshnessResult.isFresh
        ? FileStatus.READ_CURRENT
        : FileStatus.READ_STALE;
      entry.error = undefined;
    } catch (error) {
      entry.status = FileStatus.READ_ERROR;
      entry.error = error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Gets the current status of a file.
   * @param filePath Path to the file
   * @returns FileEntry if tracked, undefined if not tracked
   */
  getFileStatus(filePath: string): FileEntry | undefined {
    return this.trackedFiles.get(filePath);
  }

  /**
   * Gets all tracked files.
   * @returns Array of all tracked files
   */
  getAllTrackedFiles(): FileEntry[] {
    return Array.from(this.trackedFiles.values());
  }

  /**
   * Gets all files with a specific status.
   * @param status Status to filter by
   * @returns Array of files with the specified status
   */
  getFilesByStatus(status: FileStatus): FileEntry[] {
    return this.getAllTrackedFiles().filter(entry => entry.status === status);
  }

  /**
   * Checks if a file is stale (has been modified externally).
   * @param filePath Path to the file
   * @returns Promise resolving to true if stale, false if current or not tracked
   */
  async isFileStale(filePath: string): Promise<boolean> {
    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      return false; // Not tracked, assume not stale
    }

    try {
      const freshnessResult = await this.stateTracker.checkFreshness(
        filePath,
        entry.state,
      );
      return !freshnessResult.isFresh;
    } catch {
      return true; // Error checking freshness, consider stale
    }
  }

  /**
   * Refreshes the state of a tracked file by re-reading it.
   * @param filePath Path to the file
   * @returns Promise resolving to true if refreshed successfully, false if failed
   */
  async refreshFileState(filePath: string): Promise<boolean> {
    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      return false; // Not tracked
    }

    try {
      const newState = await this.stateTracker.getFileState(filePath);
      await this.updateFileState(filePath, newState);
      return true;
    } catch (error) {
      entry.status = FileStatus.READ_ERROR;
      entry.error = error instanceof Error ? error.message : String(error);
      entry.lastUpdatedAt = new Date();
      return false;
    }
  }

  /**
   * Removes a file from tracking.
   * @param filePath Path to the file
   * @returns True if file was removed, false if not tracked
   */
  removeFile(filePath: string): boolean {
    return this.trackedFiles.delete(filePath);
  }

  /**
   * Clears all tracked files.
   */
  clear(): void {
    this.trackedFiles.clear();
  }

  /**
   * Gets statistics about tracked files.
   * @returns Object with counts by status
   */
  getStats(): Record<FileStatus, number> {
    const stats = Object.values(FileStatus).reduce((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {} as Record<FileStatus, number>);

    for (const entry of this.trackedFiles.values()) {
      stats[entry.status]++;
    }

    return stats;
  }

  /**
   * Evicts the oldest tracked file when the limit is exceeded.
   */
  private evictOldestEntry(): void {
    let oldestPath: string | undefined;
    let oldestTime = new Date();

    for (const [path, entry] of this.trackedFiles.entries()) {
      if (entry.firstReadAt < oldestTime) {
        oldestTime = entry.firstReadAt;
        oldestPath = path;
      }
    }

    if (oldestPath) {
      this.trackedFiles.delete(oldestPath);
    }
  }

  /**
   * Automatically tracks a file if trackAllFiles is enabled.
   * This is called by tools that read files to maintain global awareness.
   * @param filePath Path to the file
   * @param state Current state of the file
   * @returns Promise resolving when tracking is complete
   */
  async autoTrackFile(filePath: string, state: FileState): Promise<void> {
    if (this.options.trackAllFiles) {
      await this.registerFile(filePath, state);
    }
  }
}
