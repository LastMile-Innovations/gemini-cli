/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileTrackerService, FileStatus, type FileEntry } from './fileTrackerService.js';

vi.mock('node:fs/promises');

describe('FileTrackerService', () => {
  let tempDir: string;
  let service: FileTrackerService;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = path.join(os.tmpdir(), 'file-tracker-service-test');
    service = new FileTrackerService();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('registerFile', () => {
    it('should register a new file with READ_CURRENT status', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const mockState = {
        content: 'Hello, World!',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 13,
      };

      await service.registerFile(filePath, mockState);

      const entry = service.getFileStatus(filePath);
      expect(entry).toBeDefined();
      expect(entry?.status).toBe(FileStatus.READ_CURRENT);
      expect(entry?.state).toEqual(mockState);
      expect(entry?.firstReadAt).toBeInstanceOf(Date);
      expect(entry?.lastUpdatedAt).toBeInstanceOf(Date);
    });

    it('should enforce maximum tracked files limit', async () => {
      const smallService = new FileTrackerService({ maxTrackedFiles: 2 });

      const file1 = path.join(tempDir, 'file1.txt');
      const file2 = path.join(tempDir, 'file2.txt');
      const file3 = path.join(tempDir, 'file3.txt');

      await smallService.registerFile(file1, {
        content: '1',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 1,
      });

      await smallService.registerFile(file2, {
        content: '2',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 1,
      });

      await smallService.registerFile(file3, {
        content: '3',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 1,
      });

      // Should have evicted the oldest entry
      expect(smallService.getFileStatus(file1)).toBeUndefined();
      expect(smallService.getFileStatus(file2)).toBeDefined();
      expect(smallService.getFileStatus(file3)).toBeDefined();
      expect(smallService.getAllTrackedFiles()).toHaveLength(2);
    });
  });

  describe('updateFileState', () => {
    it('should update file state and status', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const originalState = {
        content: 'Hello, World!',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 13,
      };

      await service.registerFile(filePath, originalState);

      const updatedState = {
        content: 'Hello, Universe!',
        mtime: new Date('2024-01-01T12:30:00Z'),
        size: 15,
      };

      await service.updateFileState(filePath, updatedState);

      const entry = service.getFileStatus(filePath);
      expect(entry?.state).toEqual(updatedState);
      expect(entry?.lastUpdatedAt).toBeInstanceOf(Date);
      expect(entry?.lastUpdatedAt.getTime()).toBeGreaterThan(entry?.firstReadAt.getTime() ?? 0);
    });

    it('should handle non-existent files', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const state = {
        content: 'Hello, World!',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 13,
      };

      await service.registerFile(filePath, state);

      // Mock file not existing
      vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

      const newState = {
        content: 'Updated content',
        mtime: new Date('2024-01-01T12:30:00Z'),
        size: 14,
      };

      await service.updateFileState(filePath, newState);

      const entry = service.getFileStatus(filePath);
      expect(entry?.status).toBe(FileStatus.READ_ERROR);
      expect(entry?.error).toContain('ENOENT');
    });
  });

  describe('getFilesByStatus', () => {
    it('should return files filtered by status', async () => {
      const file1 = path.join(tempDir, 'file1.txt');
      const file2 = path.join(tempDir, 'file2.txt');

      await service.registerFile(file1, {
        content: '1',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 1,
      });

      await service.registerFile(file2, {
        content: '2',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 1,
      });

      const currentFiles = service.getFilesByStatus(FileStatus.READ_CURRENT);
      const staleFiles = service.getFilesByStatus(FileStatus.READ_STALE);

      expect(currentFiles).toHaveLength(2);
      expect(staleFiles).toHaveLength(0);
    });
  });

  describe('isFileStale', () => {
    it('should return false for non-tracked files', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const isStale = await service.isFileStale(filePath);
      expect(isStale).toBe(false);
    });

    it('should return true for files that have changed', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const originalState = {
        content: 'Hello, World!',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 13,
      };

      await service.registerFile(filePath, originalState);

      // Mock file with different mtime
      const mockStats = {
        mtime: new Date('2024-01-01T12:30:00Z'), // Different time
        size: 13,
      };
      vi.mocked(fs.stat).mockResolvedValue(mockStats as fs.Stats);

      const isStale = await service.isFileStale(filePath);
      expect(isStale).toBe(true);
    });
  });

  describe('refreshFileState', () => {
    it('should refresh file state successfully', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const originalState = {
        content: 'Hello, World!',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 13,
      };

      await service.registerFile(filePath, originalState);

      const updatedState = {
        content: 'Hello, Universe!',
        mtime: new Date('2024-01-01T12:30:00Z'),
        size: 15,
      };

      vi.mocked(fs.stat).mockResolvedValue({
        mtime: updatedState.mtime,
        size: updatedState.size,
      } as fs.Stats);
      vi.mocked(fs.readFile).mockResolvedValue(updatedState.content);

      const success = await service.refreshFileState(filePath);

      expect(success).toBe(true);
      const entry = service.getFileStatus(filePath);
      expect(entry?.state).toEqual(updatedState);
    });

    it('should handle refresh failures', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const originalState = {
        content: 'Hello, World!',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 13,
      };

      await service.registerFile(filePath, originalState);

      // Mock file read error
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));

      const success = await service.refreshFileState(filePath);

      expect(success).toBe(false);
      const entry = service.getFileStatus(filePath);
      expect(entry?.status).toBe(FileStatus.READ_ERROR);
      expect(entry?.error).toContain('Permission denied');
    });
  });

  describe('getStats', () => {
    it('should return statistics about tracked files', async () => {
      const file1 = path.join(tempDir, 'file1.txt');
      const file2 = path.join(tempDir, 'file2.txt');

      await service.registerFile(file1, {
        content: '1',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 1,
      });

      await service.registerFile(file2, {
        content: '2',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 1,
      });

      const stats = service.getStats();

      expect(stats[FileStatus.READ_CURRENT]).toBe(2);
      expect(stats[FileStatus.READ_STALE]).toBe(0);
      expect(stats[FileStatus.NOT_READ]).toBe(0);
      expect(stats[FileStatus.READ_ERROR]).toBe(0);
    });
  });

  describe('autoTrackFile', () => {
    it('should track files when trackAllFiles is enabled', async () => {
      const service = new FileTrackerService({ trackAllFiles: true });
      const filePath = path.join(tempDir, 'test.txt');
      const state = {
        content: 'Hello, World!',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 13,
      };

      await service.autoTrackFile(filePath, state);

      const entry = service.getFileStatus(filePath);
      expect(entry).toBeDefined();
      expect(entry?.status).toBe(FileStatus.READ_CURRENT);
    });

    it('should not track files when trackAllFiles is disabled', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const state = {
        content: 'Hello, World!',
        mtime: new Date('2024-01-01T12:00:00Z'),
        size: 13,
      };

      await service.autoTrackFile(filePath, state);

      const entry = service.getFileStatus(filePath);
      expect(entry).toBeUndefined();
    });
  });
});
