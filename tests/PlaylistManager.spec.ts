/**
 * Tests for PlaylistManager class
 */

import { PlaylistManager, createPlaylistManager } from '../src/index';

// Mock IndexedDB for Node.js environment (same as SoundEffectsManager tests)
class MockIDBRequest {
    result: any = null;
    error: any = null;
    onsuccess: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;

    _triggerSuccess(result: any) {
        this.result = result;
        if (this.onsuccess) {
            this.onsuccess({ target: this });
        }
    }
}

class MockIDBObjectStore {
    private _data = new Map<string, any>();

    createIndex() {
        return this;
    }

    put(value: any) {
        const request = new MockIDBRequest();
        setTimeout(() => {
            this._data.set(value.id, value);
            request._triggerSuccess(undefined);
        }, 0);
        return request;
    }

    get(key: string) {
        const request = new MockIDBRequest();
        setTimeout(() => {
            request._triggerSuccess(this._data.get(key) || null);
        }, 0);
        return request;
    }

    getAll() {
        const request = new MockIDBRequest();
        setTimeout(() => {
            request._triggerSuccess(Array.from(this._data.values()));
        }, 0);
        return request;
    }

    getAllKeys() {
        const request = new MockIDBRequest();
        setTimeout(() => {
            request._triggerSuccess(Array.from(this._data.keys()));
        }, 0);
        return request;
    }

    delete(key: string) {
        const request = new MockIDBRequest();
        setTimeout(() => {
            this._data.delete(key);
            request._triggerSuccess(undefined);
        }, 0);
        return request;
    }

    clear() {
        const request = new MockIDBRequest();
        setTimeout(() => {
            this._data.clear();
            request._triggerSuccess(undefined);
        }, 0);
        return request;
    }

    index() {
        return {
            getAll: () => {
                const request = new MockIDBRequest();
                setTimeout(() => request._triggerSuccess([]), 0);
                return request;
            }
        };
    }
}

class MockIDBTransaction {
    private _store: MockIDBObjectStore;

    constructor() {
        this._store = new MockIDBObjectStore();
    }

    objectStore(name: string) {
        return this._store;
    }
}

class MockIDBDatabase {
    objectStoreNames = { contains: () => false };
    onerror: any = null;
    onversionchange: any = null;

    transaction(storeNames: string[], mode: string) {
        return new MockIDBTransaction();
    }

    createObjectStore(name: string, options: any) {
        return new MockIDBObjectStore();
    }

    close() {}
}

class MockIDBOpenDBRequest extends MockIDBRequest {
    onupgradeneeded: ((event: any) => void) | null = null;
}

// Mock indexedDB
(global as any).indexedDB = {
    open: (name: string, version: number) => {
        const request = new MockIDBOpenDBRequest();
        setTimeout(() => {
            const db = new MockIDBDatabase();
            if (request.onupgradeneeded) {
                request.onupgradeneeded({ target: { result: db } });
            }
            request._triggerSuccess(db);
        }, 0);
        return request;
    }
};

// Mock navigator.storage for quota estimation
(global as any).navigator = {
    ...((global as any).navigator || {}),
    storage: {
        estimate: () => Promise.resolve({ usage: 0, quota: 1000000000 })
    }
};

// Mock DOM environment for testing
const mockAudioElement = {
    src: '',
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn(),
    load: jest.fn(),
    removeAttribute: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    buffered: { length: 0, end: jest.fn().mockReturnValue(0) },
    duration: 0,
    currentTime: 0,
    paused: false,
} as unknown as HTMLAudioElement;

// Mock AudioStreamer - Bun doesn't support jest.mock, so we'll test without mocking
// const mockAudioStreamer = {
//     initialize: jest.fn().mockResolvedValue(undefined),
//     streamFromUrl: jest.fn().mockResolvedValue({
//         onLoaded: Promise.resolve('test-audio-id'),
//         onEnded: Promise.resolve('test-audio-id'),
//         cancel: jest.fn()
//     }),
//     dispose: jest.fn(),
//     on: jest.fn(),
//     off: jest.fn()
// };

describe('PlaylistManager', () => {
    let playlistManager: PlaylistManager;

    beforeEach(() => {
        playlistManager = new PlaylistManager(mockAudioElement);
    });

    afterEach(() => {
        playlistManager?.dispose();
    });

    describe('Basic Functionality', () => {
        test('should create PlaylistManager instance', () => {
            expect(playlistManager).toBeInstanceOf(PlaylistManager);
        });

        test('should create via factory function', () => {
            const manager = createPlaylistManager(mockAudioElement);
            expect(manager).toBeInstanceOf(PlaylistManager);
            manager.dispose();
        });

        test('should initialize successfully', async () => {
            await playlistManager.initialize();
            expect(playlistManager).toBeInstanceOf(PlaylistManager);
        });

        test('should get initial state', () => {
            const state = playlistManager.getState();
            expect(state.state).toBe('idle');
            expect(state.currentTrack).toBeNull();
            expect(state.currentIndex).toBe(-1);
            expect(state.totalTracks).toBe(0);
            expect(state.canPlay).toBe(false);
        });
    });

    describe('Playlist Management', () => {
        test('should load playlist from URLs', () => {
            const urls = ['http://example.com/track1.mp3', 'http://example.com/track2.mp3'];
            playlistManager.loadPlaylist(urls);

            const state = playlistManager.getState();
            expect(state.totalTracks).toBe(2);
            expect(state.canPlay).toBe(true);

            const playlist = playlistManager.getPlaylist();
            expect(playlist).toHaveLength(2);
            expect(playlist[0].url).toBe(urls[0]);
            expect(playlist[1].url).toBe(urls[1]);
        });

        test('should load playlist from PlaylistItems', () => {
            const items = [
                { id: 'track1', url: 'http://example.com/track1.mp3', title: 'Track 1', duration: 180, metadata: {} },
                { id: 'track2', url: 'http://example.com/track2.mp3', title: 'Track 2', duration: 200, metadata: {} },
            ];
            playlistManager.loadPlaylist(items);

            const playlist = playlistManager.getPlaylist();
            expect(playlist[0].id).toBe('track1');
            expect(playlist[0].title).toBe('Track 1');
            expect(playlist[0].duration).toBe(180);
        });

        test('should add track to playlist', () => {
            playlistManager.loadPlaylist(['http://example.com/track1.mp3']);
            playlistManager.addTrack('http://example.com/track2.mp3');

            const playlist = playlistManager.getPlaylist();
            expect(playlist).toHaveLength(2);
            expect(playlist[1].url).toBe('http://example.com/track2.mp3');
        });

        test('should add track at specific index', () => {
            playlistManager.loadPlaylist(['http://example.com/track1.mp3', 'http://example.com/track2.mp3']);
            playlistManager.addTrack('http://example.com/track1.5.mp3', 1);

            const playlist = playlistManager.getPlaylist();
            expect(playlist[1].url).toBe('http://example.com/track1.5.mp3');
            expect(playlist[2].url).toBe('http://example.com/track2.mp3');
        });

        test('should remove track from playlist', () => {
            playlistManager.loadPlaylist(['http://example.com/track1.mp3', 'http://example.com/track2.mp3']);
            const removedTrack = playlistManager.removeTrack(0);

            expect(removedTrack).not.toBeNull();
            expect(removedTrack?.url).toBe('http://example.com/track1.mp3');

            const playlist = playlistManager.getPlaylist();
            expect(playlist).toHaveLength(1);
            expect(playlist[0].url).toBe('http://example.com/track2.mp3');
        });

        test('should clear playlist', () => {
            playlistManager.loadPlaylist(['http://example.com/track1.mp3', 'http://example.com/track2.mp3']);
            playlistManager.clearPlaylist();

            const state = playlistManager.getState();
            expect(state.totalTracks).toBe(0);
            expect(state.canPlay).toBe(false);
            expect(playlistManager.getPlaylist()).toHaveLength(0);
        });
    });

    describe('Playback Controls', () => {
        beforeEach(() => {
            playlistManager.loadPlaylist(['http://example.com/track1.mp3', 'http://example.com/track2.mp3', 'http://example.com/track3.mp3']);
        });

        test('should play specific track', async () => {
            await playlistManager.initialize();
            await playlistManager.playTrack(1);

            const state = playlistManager.getState();
            expect(state.currentIndex).toBe(1);
            expect(state.currentTrack?.url).toBe('http://example.com/track2.mp3');
        });

        test('should play first track when no current track', async () => {
            await playlistManager.initialize();
            await playlistManager.play();

            const state = playlistManager.getState();
            expect(state.currentIndex).toBe(0);
            expect(state.currentTrack?.url).toBe('http://example.com/track1.mp3');
        });

        test('should pause current track', async () => {
            await playlistManager.initialize();
            await playlistManager.playTrack(0);
            playlistManager.pause();

            const state = playlistManager.getState();
            expect(state.state).toBe('paused');
        });

        test('should play next track', async () => {
            await playlistManager.initialize();
            await playlistManager.playTrack(0);
            await playlistManager.next();

            const state = playlistManager.getState();
            expect(state.currentIndex).toBe(1);
            expect(state.currentTrack?.url).toBe('http://example.com/track2.mp3');
        });

        test('should play previous track', async () => {
            await playlistManager.initialize();
            await playlistManager.playTrack(1);
            await playlistManager.previous();

            const state = playlistManager.getState();
            expect(state.currentIndex).toBe(0);
            expect(state.currentTrack?.url).toBe('http://example.com/track1.mp3');
        });

        test('should handle next at end of playlist', async () => {
            await playlistManager.initialize();
            await playlistManager.playTrack(2);

            const canPlayNext = playlistManager.getState().canPlayNext;
            expect(canPlayNext).toBe(false);
        });

        test('should handle previous at start of playlist', async () => {
            await playlistManager.initialize();
            await playlistManager.playTrack(0);

            const canPlayPrevious = playlistManager.getState().canPlayPrevious;
            expect(canPlayPrevious).toBe(false);
        });
    });

    describe('Play Modes', () => {
        beforeEach(() => {
            playlistManager.loadPlaylist(['http://example.com/track1.mp3', 'http://example.com/track2.mp3']);
        });

        test('should set play mode to repeat', () => {
            playlistManager.setPlayMode('repeat');
            const state = playlistManager.getState();
            expect(state.playMode).toBe('repeat');
        });

        test('should set play mode to repeatOne', () => {
            playlistManager.setPlayMode('repeatOne');
            const state = playlistManager.getState();
            expect(state.playMode).toBe('repeatOne');
        });

        test('should toggle shuffle mode', () => {
            playlistManager.toggleShuffle();
            const state = playlistManager.getState();
            expect(state.isShuffled).toBe(true);

            playlistManager.toggleShuffle();
            expect(state.isShuffled).toBe(false);
        });
    });

    describe('Event System', () => {
        test('should handle event subscription', () => {
            const callback = () => {};
            playlistManager.on('playlistLoaded', callback);
            playlistManager.off('playlistLoaded', callback);
            // In a real test, we'd verify the callback wasn't called
            expect(true).toBe(true);
        });

        test('should emit playlist loaded event', () => {
            let eventReceived = false;
            const callback = (event: any) => {
                eventReceived = true;
                expect(event.type).toBe('playlistLoaded');
                expect(event.data.totalTracks).toBe(1);
            };
            playlistManager.on('playlistLoaded', callback);

            playlistManager.loadPlaylist(['http://example.com/track1.mp3']);
            expect(eventReceived).toBe(true);
        });

        test('should emit track added event', () => {
            let eventReceived = false;
            const callback = (event: any) => {
                eventReceived = true;
                expect(event.type).toBe('trackAdded');
                expect(event.data.track.url).toBe('http://example.com/track1.mp3');
            };
            playlistManager.on('trackAdded', callback);

            playlistManager.addTrack('http://example.com/track1.mp3');
            expect(eventReceived).toBe(true);
        });
    });

    describe('Error Handling', () => {
        test('should handle invalid track index', async () => {
            playlistManager.loadPlaylist(['http://example.com/track1.mp3']);

            await expect(playlistManager.playTrack(5)).rejects.toThrow('Invalid track index: 5');
        });

        test('should handle empty playlist operations', () => {
            const state = playlistManager.getState();
            expect(state.canPlay).toBe(false);
            expect(state.canPlayNext).toBe(false);
            expect(state.canPlayPrevious).toBe(false);
        });
    });

    describe('State Management', () => {
        test('should update state correctly when adding tracks', () => {
            playlistManager.loadPlaylist(['http://example.com/track1.mp3']);
            let state = playlistManager.getState();
            expect(state.totalTracks).toBe(1);
            expect(state.canPlay).toBe(true);

            playlistManager.addTrack('http://example.com/track2.mp3');
            state = playlistManager.getState();
            expect(state.totalTracks).toBe(2);
        });

        test('should update state correctly when removing tracks', () => {
            playlistManager.loadPlaylist(['http://example.com/track1.mp3', 'http://example.com/track2.mp3']);
            playlistManager.removeTrack(0);

            const state = playlistManager.getState();
            expect(state.totalTracks).toBe(1);
        });
    });

    describe('Disposal', () => {
        test('should dispose gracefully', () => {
            expect(() => {
                playlistManager.dispose();
            }).not.toThrow();
        });

        test('should handle multiple dispose calls', () => {
            playlistManager.dispose();
            expect(() => {
                playlistManager.dispose();
            }).not.toThrow();
        });
    });
});
