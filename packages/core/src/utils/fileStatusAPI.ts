/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileTrackerService, FileStatus, type FileEntry } from './fileTrackerService.js';

/**
 * Simple API for querying file status information.
 * This provides a clean interface for the agent to check which files it has read
 * and their current status (current/stale/not read).
 */
export class FileStatusAPI {
  private static instance: FileStatusAPI | undefined;
  private readonly service: FileTrackerService;

  private constructor() {
    this.service = new FileTrackerService();
  }

  /**
   * Gets the singleton instance of the FileStatusAPI.
   */
  static getInstance(): FileStatusAPI {
    if (!FileStatusAPI.instance) {
      FileStatusAPI.instance = new FileStatusAPI();
    }
    return FileStatusAPI.instance;
  }

  /**
   * Gets the status of a specific file.
   * @param filePath Path to the file
   * @returns FileEntry if the file has been read, undefined if not tracked
   */
  getFileStatus(filePath: string): FileEntry | undefined {
    return this.service.getFileStatus(filePath);
  }

  /**
   * Checks if a file is stale (has been modified externally).
   * @param filePath Path to the file
   * @returns Promise resolving to true if stale, false if current or not tracked
   */
  async isFileStale(filePath: string): Promise<boolean> {
    return this.service.isFileStale(filePath);
  }

  /**
   * Gets all files that have been read and are currently stale.
   * @returns Array of stale files
   */
  getStaleFiles(): FileEntry[] {
    return this.service.getFilesByStatus(FileStatus.READ_STALE);
  }

  /**
   * Gets all files that have been read and are current.
   * @returns Array of current files
   */
  getCurrentFiles(): FileEntry[] {
    return this.service.getFilesByStatus(FileStatus.READ_CURRENT);
  }

  /**
   * Gets all files that have been read (both current and stale).
   * @returns Array of all read files
   */
  getAllReadFiles(): FileEntry[] {
    return [
      ...this.getCurrentFiles(),
      ...this.getStaleFiles(),
    ];
  }

  /**
   * Gets statistics about tracked files.
   * @returns Object with counts by status
   */
  getStats() {
    return this.service.getStats();
  }

  /**
   * Gets a summary of file tracking status.
   * @returns Object with summary information
   */
  getSummary(): {
    totalTracked: number;
    currentFiles: number;
    staleFiles: number;
    errorFiles: number;
  } {
    const stats = this.service.getStats();
    return {
      totalTracked: Object.values(stats).reduce((sum, count) => sum + count, 0),
      currentFiles: stats[FileStatus.READ_CURRENT],
      staleFiles: stats[FileStatus.READ_STALE],
      errorFiles: stats[FileStatus.READ_ERROR],
    };
  }

  /**
   * Gets a list of files that may need attention (stale or error).
   * @returns Array of files that need attention
   */
  getFilesNeedingAttention(): FileEntry[] {
    return [
      ...this.service.getFilesByStatus(FileStatus.READ_STALE),
      ...this.service.getFilesByStatus(FileStatus.READ_ERROR),
    ];
  }
}

/**
 * Convenience function to get the FileStatusAPI instance.
 */
export function getFileStatusAPI(): FileStatusAPI {
  return FileStatusAPI.getInstance();
}

/**
 * Convenience function to check if a file is stale.
 * @param filePath Path to the file
 * @returns Promise resolving to true if stale, false if current or not tracked
 */
export async function isFileStale(filePath: string): Promise<boolean> {
  return FileStatusAPI.getInstance().isFileStale(filePath);
}

/**
 * Convenience function to get all stale files.
 * @returns Array of stale files
 */
export function getStaleFiles(): FileEntry[] {
  return FileStatusAPI.getInstance().getStaleFiles();
}
