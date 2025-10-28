/**
 * AudioCache - IndexedDB-based persistent audio caching system
 * Provides efficient storage and retrieval of audio chunks with metadata
 */

import { AudioCacheEntry, CacheError, CacheStats } from './types.js';

export class AudioCache {
    private _db: IDBDatabase | null = null;
    private _dbName: string;
    private _storeName: string;
    private _version: number = 2; // Bumped for tag support
    private _memoryCache: Map<string, AudioCacheEntry> = new Map();
    private _initPromise: Promise<void> | null = null;
    private _stats: CacheStats = {
        entryCount: 0,
        totalSize: 0,
        availableQuota: 0,
        usedQuota: 0,
        hitRatio: 0,
        byTag: {},
    };
    private _accessCounts: Map<string, number> = new Map();
    private _totalAccesses: number = 0;
    private _cacheHits: number = 0;

    constructor(dbName: string = 'sound-libx-cache', storeName: string = 'audio-tracks') {
        this._dbName = dbName;
        this._storeName = storeName;
    }

    /**
     * Initialize the IndexedDB connection and load memory cache
     */
    public async initialize(): Promise<void> {
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = this._performInitialization();
        return this._initPromise;
    }

    private async _performInitialization(): Promise<void> {
        try {
            await this._openDatabase();
            await this._loadMemoryCache();
            await this._updateStorageStats();
        } catch (error) {
            throw new CacheError('Failed to initialize audio cache', undefined, error as Error);
        }
    }

    private async _openDatabase(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) {
                reject(new CacheError('IndexedDB is not supported in this browser'));
                return;
            }

            const request = indexedDB.open(this._dbName, this._version);

            request.onerror = () => {
                reject(new CacheError('Failed to open IndexedDB', undefined, request.error as Error));
            };

            request.onsuccess = () => {
                this._db = request.result;
                this._setupErrorHandling();
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                this._createObjectStore(db);
            };
        });
    }

    private _createObjectStore(db: IDBDatabase): void {
        // Delete existing store if it exists (for upgrades)
        if (db.objectStoreNames.contains(this._storeName)) {
            db.deleteObjectStore(this._storeName);
        }

        // Create the object store
        const store = db.createObjectStore(this._storeName, { keyPath: 'id' });

        // Create indexes for efficient querying
        store.createIndex('cachedAt', 'cachedAt', { unique: false });
        store.createIndex('mimeType', 'mimeType', { unique: false });
        store.createIndex('originalSize', 'originalSize', { unique: false });
        store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        store.createIndex('accessCount', 'accessCount', { unique: false });
    }

    private _setupErrorHandling(): void {
        if (this._db) {
            this._db.onerror = (event) => {
                console.error('IndexedDB error:', event);
            };

            this._db.onversionchange = () => {
                this._db?.close();
                this._db = null;
            };
        }
    }

    private async _loadMemoryCache(): Promise<void> {
        const entries = await this._getAllEntries();
        this._memoryCache.clear();

        for (const entry of entries) {
            this._memoryCache.set(entry.id, entry);
        }

        this._updateStats();
    }

    private async _getAllEntries(): Promise<AudioCacheEntry[]> {
        if (!this._db) {
            throw new CacheError('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this._db!.transaction([this._storeName], 'readonly');
            const store = transaction.objectStore(this._storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result || []);
            };

            request.onerror = () => {
                reject(new CacheError('Failed to load cache entries', undefined, request.error as Error));
            };
        });
    }

    /**
     * Store audio chunks in cache
     */
    public async set(
        id: string,
        chunks: Uint8Array[],
        mimeType: string,
        options?: {
            tags?: string[];
            customData?: Record<string, any>;
            processed?: boolean;
        }
    ): Promise<void> {
        if (!this._db) {
            await this.initialize();
        }

        const originalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const entry: AudioCacheEntry = {
            id,
            chunks,
            mimeType,
            cachedAt: Date.now(),
            originalSize,
            processed: options?.processed ?? false,
            tags: options?.tags || [],
            customData: options?.customData || {},
            accessCount: 0,
        };

        try {
            await this._storeEntry(entry);
            this._memoryCache.set(id, entry);
            this._updateStats();
        } catch (error) {
            throw new CacheError(`Failed to cache audio with ID: ${id}`, id, error as Error);
        }
    }

    private async _storeEntry(entry: AudioCacheEntry): Promise<void> {
        if (!this._db) {
            throw new CacheError('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this._db!.transaction([this._storeName], 'readwrite');
            const store = transaction.objectStore(this._storeName);
            const request = store.put(entry);

            request.onsuccess = () => resolve();
            request.onerror = () => {
                reject(new CacheError('Failed to store cache entry', entry.id, request.error as Error));
            };
        });
    }

    /**
     * Retrieve audio chunks from cache
     */
    public async get(id: string): Promise<Uint8Array[] | null> {
        this._totalAccesses++;

        // Check memory cache first
        const memoryEntry = this._memoryCache.get(id);
        if (memoryEntry) {
            this._cacheHits++;
            this._incrementAccessCount(id);
            this._updateHitRatio();
            return memoryEntry.chunks;
        }

        // Check IndexedDB
        if (!this._db) {
            await this.initialize();
        }

        try {
            const entry = await this._getEntry(id);
            if (entry) {
                this._cacheHits++;
                this._memoryCache.set(id, entry); // Cache in memory for future access
                this._incrementAccessCount(id);
                this._updateHitRatio();
                return entry.chunks;
            }
        } catch (error) {
            throw new CacheError(`Failed to retrieve audio with ID: ${id}`, id, error as Error);
        }

        this._updateHitRatio();
        return null;
    }

    private async _getEntry(id: string): Promise<AudioCacheEntry | null> {
        if (!this._db) {
            throw new CacheError('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this._db!.transaction([this._storeName], 'readonly');
            const store = transaction.objectStore(this._storeName);
            const request = store.get(id);

            request.onsuccess = () => {
                resolve(request.result || null);
            };

            request.onerror = () => {
                reject(new CacheError('Failed to get cache entry', id, request.error as Error));
            };
        });
    }

    /**
     * Check if audio is cached
     */
    public async has(id: string): Promise<boolean> {
        // Check memory cache first
        if (this._memoryCache.has(id)) {
            return true;
        }

        // Check IndexedDB
        const entry = await this.get(id);
        return entry !== null;
    }

    /**
     * Get entries by tag
     */
    public async getByTag(tag: string): Promise<AudioCacheEntry[]> {
        if (!this._db) {
            await this.initialize();
        }

        return new Promise((resolve, reject) => {
            const transaction = this._db!.transaction([this._storeName], 'readonly');
            const store = transaction.objectStore(this._storeName);
            const index = store.index('tags');
            const request = index.getAll(tag);

            request.onsuccess = () => {
                resolve(request.result || []);
            };

            request.onerror = () => {
                reject(new CacheError('Failed to get entries by tag', undefined, request.error as Error));
            };
        });
    }

    /**
     * Clear entries by tag
     */
    public async clearByTag(tag: string): Promise<number> {
        const entries = await this.getByTag(tag);
        let deletedCount = 0;

        for (const entry of entries) {
            const deleted = await this.delete(entry.id);
            if (deleted) deletedCount++;
        }

        return deletedCount;
    }

    /**
     * Remove audio from cache
     */
    public async delete(id: string): Promise<boolean> {
        if (!this._db) {
            await this.initialize();
        }

        try {
            const deleted = await this._deleteEntry(id);
            if (deleted) {
                this._memoryCache.delete(id);
                this._accessCounts.delete(id);
                this._updateStats();
            }
            return deleted;
        } catch (error) {
            throw new CacheError(`Failed to delete audio with ID: ${id}`, id, error as Error);
        }
    }

    private async _deleteEntry(id: string): Promise<boolean> {
        if (!this._db) {
            throw new CacheError('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this._db!.transaction([this._storeName], 'readwrite');
            const store = transaction.objectStore(this._storeName);
            const request = store.delete(id);

            request.onsuccess = () => {
                resolve(request.result !== undefined);
            };

            request.onerror = () => {
                reject(new CacheError('Failed to delete cache entry', id, request.error as Error));
            };
        });
    }

    /**
     * Clear all cached audio
     */
    public async clear(): Promise<void> {
        if (!this._db) {
            await this.initialize();
        }

        try {
            await this._clearStore();
            this._memoryCache.clear();
            this._accessCounts.clear();
            this._totalAccesses = 0;
            this._cacheHits = 0;
            this._updateStats();
        } catch (error) {
            throw new CacheError('Failed to clear cache', undefined, error as Error);
        }
    }

    private async _clearStore(): Promise<void> {
        if (!this._db) {
            throw new CacheError('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this._db!.transaction([this._storeName], 'readwrite');
            const store = transaction.objectStore(this._storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => {
                reject(new CacheError('Failed to clear object store', undefined, request.error as Error));
            };
        });
    }

    /**
     * Get all cached audio IDs
     */
    public async keys(): Promise<string[]> {
        if (!this._db) {
            await this.initialize();
        }

        return new Promise((resolve, reject) => {
            const transaction = this._db!.transaction([this._storeName], 'readonly');
            const store = transaction.objectStore(this._storeName);
            const request = store.getAllKeys();

            request.onsuccess = () => {
                resolve(request.result as string[]);
            };

            request.onerror = () => {
                reject(new CacheError('Failed to get cache keys', undefined, request.error as Error));
            };
        });
    }

    /**
     * Advanced cleanup with filtering options
     */
    public async cleanup(options: import('./types.js').CacheCleanupOptions = {}): Promise<number> {
        const allEntries = await this._getAllEntries();
        let deletedCount = 0;
        const now = Date.now();

        for (const entry of allEntries) {
            let shouldDelete = false;

            // Check age
            if (options.maxAge && now - entry.cachedAt > options.maxAge) {
                shouldDelete = true;
            }

            // Check access count
            if (options.minAccessCount && (entry.accessCount || 0) < options.minAccessCount) {
                shouldDelete = true;
            }

            // Check tag filters
            if (options.tags && options.tags.length > 0) {
                const hasTags = entry.tags?.some((tag) => options.tags!.includes(tag));
                if (!hasTags) continue; // Skip if doesn't have required tags
            }

            // Check exclude tags
            if (options.excludeTags && options.excludeTags.length > 0) {
                const hasExcludedTag = entry.tags?.some((tag) => options.excludeTags!.includes(tag));
                if (hasExcludedTag) continue; // Skip if has excluded tag
            }

            if (shouldDelete) {
                await this.delete(entry.id);
                deletedCount++;
            }
        }

        // Handle maxEntries limit
        if (options.maxEntries) {
            const remainingEntries = await this._getAllEntries();
            if (remainingEntries.length > options.maxEntries) {
                // Sort by access count and age, delete least used/oldest
                const sorted = remainingEntries.sort((a, b) => {
                    const accessDiff = (a.accessCount || 0) - (b.accessCount || 0);
                    if (accessDiff !== 0) return accessDiff;
                    return a.cachedAt - b.cachedAt;
                });

                const toDelete = sorted.slice(0, remainingEntries.length - options.maxEntries);
                for (const entry of toDelete) {
                    await this.delete(entry.id);
                    deletedCount++;
                }
            }
        }

        return deletedCount;
    }

    /**
     * Get cache statistics
     */
    public async getStats(): Promise<CacheStats> {
        await this._updateStorageStats();
        await this._updateTagStats();
        return { ...this._stats };
    }

    private _updateStats(): void {
        this._stats.entryCount = this._memoryCache.size;
        this._stats.totalSize = Array.from(this._memoryCache.values()).reduce((sum, entry) => sum + entry.originalSize, 0);
    }

    private async _updateTagStats(): Promise<void> {
        const allEntries = await this._getAllEntries();
        const byTag: Record<string, { count: number; size: number }> = {};

        for (const entry of allEntries) {
            if (entry.tags) {
                for (const tag of entry.tags) {
                    if (!byTag[tag]) {
                        byTag[tag] = { count: 0, size: 0 };
                    }
                    byTag[tag].count++;
                    byTag[tag].size += entry.originalSize;
                }
            }
        }

        this._stats.byTag = byTag;
    }

    private async _updateStorageStats(): Promise<void> {
        if ('navigator' in window && 'storage' in navigator && 'estimate' in navigator.storage) {
            try {
                const estimate = await navigator.storage.estimate();
                this._stats.usedQuota = estimate.usage || 0;
                this._stats.availableQuota = estimate.quota || 0;
            } catch (error) {
                // Storage estimation not available
                this._stats.usedQuota = 0;
                this._stats.availableQuota = 0;
            }
        }
    }

    private _incrementAccessCount(id: string): void {
        const count = this._accessCounts.get(id) || 0;
        this._accessCounts.set(id, count + 1);
    }

    private _updateHitRatio(): void {
        this._stats.hitRatio = this._totalAccesses > 0 ? this._cacheHits / this._totalAccesses : 0;
    }

    /**
     * Close the database connection
     */
    public close(): void {
        if (this._db) {
            this._db.close();
            this._db = null;
        }
        this._memoryCache.clear();
        this._accessCounts.clear();
        this._initPromise = null;
    }
}
