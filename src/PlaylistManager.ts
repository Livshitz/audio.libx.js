/**
 * PlaylistManager - Spotify-like playlist functionality for sequential audio playback
 * Manages playlist state, playback controls, and integrates with AudioStreamer
 */

import { AudioStreamer } from './AudioStreamer.js';
import { PlaylistOptions, PlaylistState, PlaylistEvent, PlaylistEventType, PlaylistEventCallback, PlaylistItem, PlayMode } from './types.js';

export class PlaylistManager {
    private _audioStreamer: AudioStreamer;
    private _playlist: PlaylistItem[] = [];
    private _currentIndex: number = -1;
    private _state: PlaylistState;
    private _eventCallbacks: Map<PlaylistEventType, PlaylistEventCallback[]> = new Map();
    private _playMode: PlayMode = 'sequential';
    private _isShuffled: boolean = false;
    private _shuffledIndices: number[] = [];
    private _isInitialized: boolean = false;

    constructor(audioElement: HTMLAudioElement, options: PlaylistOptions = {}) {
        this._audioStreamer = new AudioStreamer(audioElement, options.audioStreamerOptions);

        this._state = {
            state: 'idle',
            currentTrack: null,
            currentIndex: -1,
            totalTracks: 0,
            playMode: 'sequential',
            isShuffled: false,
            canPlay: false,
            canPlayNext: false,
            canPlayPrevious: false,
        };

        this._setupAudioStreamerListeners();
    }

    /**
     * Initialize the playlist manager
     */
    public async initialize(): Promise<void> {
        if (this._isInitialized) return;

        await this._audioStreamer.initialize();
        this._isInitialized = true;
        this._emitEvent('initialized');
    }

    /**
     * Load a playlist from an array of URLs or PlaylistItems
     */
    public loadPlaylist(items: (string | PlaylistItem)[]): void {
        this._playlist = items.map((item, index) => {
            if (typeof item === 'string') {
                return {
                    id: `track-${index}`,
                    url: item,
                    title: `Track ${index + 1}`,
                    duration: 0,
                    metadata: {},
                };
            }
            return {
                id: item.id || `track-${index}`,
                url: item.url,
                title: item.title || `Track ${index + 1}`,
                duration: item.duration || 0,
                metadata: item.metadata || {},
            };
        });

        this._currentIndex = -1;
        this._shuffledIndices = [];
        this._updateState();
        this._emitEvent('playlistLoaded', { totalTracks: this._playlist.length });
    }

    /**
     * Add a track to the playlist
     */
    public addTrack(item: string | PlaylistItem, index?: number): void {
        const playlistItem: PlaylistItem =
            typeof item === 'string'
                ? {
                      id: `track-${Date.now()}`,
                      url: item,
                      title: `Track ${this._playlist.length + 1}`,
                      duration: 0,
                      metadata: {},
                  }
                : {
                      id: item.id || `track-${Date.now()}`,
                      url: item.url,
                      title: item.title || `Track ${this._playlist.length + 1}`,
                      duration: item.duration || 0,
                      metadata: item.metadata || {},
                  };

        if (index !== undefined && index >= 0 && index <= this._playlist.length) {
            this._playlist.splice(index, 0, playlistItem);
        } else {
            this._playlist.push(playlistItem);
        }

        this._updateState();
        this._emitEvent('trackAdded', { track: playlistItem, index: index ?? this._playlist.length - 1 });
    }

    /**
     * Remove a track from the playlist
     */
    public removeTrack(index: number): PlaylistItem | null {
        if (index < 0 || index >= this._playlist.length) return null;

        const removedTrack = this._playlist.splice(index, 1)[0];

        // Adjust current index if necessary
        if (this._currentIndex === index) {
            this._currentIndex = -1;
            this._state.currentTrack = null;
        } else if (this._currentIndex > index) {
            this._currentIndex--;
        }

        this._updateState();
        this._emitEvent('trackRemoved', { track: removedTrack, index });
        return removedTrack;
    }

    /**
     * Play a specific track by index
     */
    public async playTrack(index: number): Promise<void> {
        if (index < 0 || index >= this._playlist.length) {
            throw new Error(`Invalid track index: ${index}`);
        }

        await this.initialize();

        this._currentIndex = index;
        const track = this._playlist[index];

        this._setState('loading', track);
        this._emitEvent('trackChanged', { track, index });

        try {
            const result = await this._audioStreamer.streamFromUrl(track.url, track.id);
            await result.onLoaded;
            this._setState('playing', track);
            this._emitEvent('playStart', { track, index });

            // Set up end listener for automatic next track
            result.onEnded.then(() => {
                this._handleTrackEnd();
            });
        } catch (error) {
            this._setState('error', track, error.message);
            this._emitEvent('playError', { track, index, error });
            throw error;
        }
    }

    /**
     * Play the current track
     */
    public async play(): Promise<void> {
        if (this._currentIndex === -1 && this._playlist.length > 0) {
            await this.playTrack(0);
        } else if (this._currentIndex >= 0) {
            // For AudioStreamer, we need to use the audio element directly
            const audioElement = (this._audioStreamer as any)._audioElement;
            await audioElement.play();
            this._setState('playing', this._state.currentTrack);
            this._emitEvent('playStart', {
                track: this._state.currentTrack,
                index: this._currentIndex,
            });
        }
    }

    /**
     * Pause the current track
     */
    public pause(): void {
        const audioElement = (this._audioStreamer as any)._audioElement;
        audioElement.pause();
        this._setState('paused', this._state.currentTrack);
        this._emitEvent('pause', {
            track: this._state.currentTrack,
            index: this._currentIndex,
        });
    }

    /**
     * Play the next track
     */
    public async next(): Promise<void> {
        if (!this._canPlayNext()) return;

        const nextIndex = this._getNextIndex();
        await this.playTrack(nextIndex);
    }

    /**
     * Play the previous track
     */
    public async previous(): Promise<void> {
        if (!this._canPlayPrevious()) return;

        const prevIndex = this._getPreviousIndex();
        await this.playTrack(prevIndex);
    }

    /**
     * Set play mode (sequential, repeat, repeatOne)
     */
    public setPlayMode(mode: PlayMode): void {
        this._playMode = mode;
        this._state.playMode = mode;
        this._updateState();
        this._emitEvent('playModeChanged', { mode });
    }

    /**
     * Toggle shuffle mode
     */
    public toggleShuffle(): void {
        this._isShuffled = !this._isShuffled;
        this._state.isShuffled = this._isShuffled;

        if (this._isShuffled) {
            this._generateShuffledIndices();
        } else {
            this._shuffledIndices = [];
        }

        this._updateState();
        this._emitEvent('shuffleToggled', { isShuffled: this._isShuffled });
    }

    /**
     * Get current playlist state
     */
    public getState(): PlaylistState {
        return { ...this._state };
    }

    /**
     * Get the current playlist
     */
    public getPlaylist(): PlaylistItem[] {
        return [...this._playlist];
    }

    /**
     * Get current track
     */
    public getCurrentTrack(): PlaylistItem | null {
        return this._state.currentTrack;
    }

    /**
     * Get current track index
     */
    public getCurrentIndex(): number {
        return this._currentIndex;
    }

    /**
     * Clear the playlist
     */
    public clearPlaylist(): void {
        this._playlist = [];
        this._currentIndex = -1;
        this._shuffledIndices = [];
        this._setState('idle', null);
        this._emitEvent('playlistCleared');
    }

    /**
     * Event subscription
     */
    public on(event: PlaylistEventType, callback: PlaylistEventCallback): void {
        if (!this._eventCallbacks.has(event)) {
            this._eventCallbacks.set(event, []);
        }
        this._eventCallbacks.get(event)!.push(callback);
    }

    /**
     * Event unsubscription
     */
    public off(event: PlaylistEventType, callback: PlaylistEventCallback): void {
        const callbacks = this._eventCallbacks.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * Dispose the playlist manager
     */
    public dispose(): void {
        this._audioStreamer.dispose();
        this._eventCallbacks.clear();
        this._playlist = [];
        this._currentIndex = -1;
        this._shuffledIndices = [];
        this._isInitialized = false;
    }

    private _setupAudioStreamerListeners(): void {
        this._audioStreamer.on('stateChange', (event) => {
            if (event.data?.state === 'playing') {
                this._setState('playing', this._state.currentTrack);
            } else if (event.data?.state === 'paused') {
                this._setState('paused', this._state.currentTrack);
            } else if (event.data?.state === 'ended') {
                this._handleTrackEnd();
            }
        });

        this._audioStreamer.on('error', (event) => {
            this._setState('error', this._state.currentTrack, event.data?.message);
            this._emitEvent('playError', {
                track: this._state.currentTrack,
                index: this._currentIndex,
                error: event.data,
            });
        });
    }

    private _setState(state: PlaylistState['state'], currentTrack: PlaylistItem | null, error?: string): void {
        this._state.state = state;
        this._state.currentTrack = currentTrack;
        this._state.currentIndex = this._currentIndex;
        this._state.error = error;
        this._updateState();
        this._emitEvent('stateChange', { state, currentTrack, error });
    }

    private _updateState(): void {
        this._state.totalTracks = this._playlist.length;
        this._state.canPlay = this._playlist.length > 0;
        this._state.canPlayNext = this._canPlayNext();
        this._state.canPlayPrevious = this._canPlayPrevious();
    }

    private _canPlayNext(): boolean {
        if (this._playlist.length === 0) return false;
        if (this._playMode === 'repeatOne') return true;
        return this._getNextIndex() !== -1;
    }

    private _canPlayPrevious(): boolean {
        if (this._playlist.length === 0) return false;
        return this._getPreviousIndex() !== -1;
    }

    private _getNextIndex(): number {
        if (this._playlist.length === 0) return -1;
        if (this._currentIndex === -1) return 0;

        if (this._isShuffled) {
            const currentShuffledIndex = this._shuffledIndices.indexOf(this._currentIndex);
            if (currentShuffledIndex === -1) return 0;

            const nextShuffledIndex = currentShuffledIndex + 1;
            if (nextShuffledIndex < this._shuffledIndices.length) {
                return this._shuffledIndices[nextShuffledIndex];
            }

            if (this._playMode === 'repeat') {
                return this._shuffledIndices[0];
            }
            return -1;
        } else {
            const nextIndex = this._currentIndex + 1;
            if (nextIndex < this._playlist.length) {
                return nextIndex;
            }

            if (this._playMode === 'repeat') {
                return 0;
            }
            return -1;
        }
    }

    private _getPreviousIndex(): number {
        if (this._playlist.length === 0) return -1;
        if (this._currentIndex === -1) return this._playlist.length - 1;

        if (this._isShuffled) {
            const currentShuffledIndex = this._shuffledIndices.indexOf(this._currentIndex);
            if (currentShuffledIndex === -1) return this._playlist.length - 1;

            const prevShuffledIndex = currentShuffledIndex - 1;
            if (prevShuffledIndex >= 0) {
                return this._shuffledIndices[prevShuffledIndex];
            }
            return -1;
        } else {
            const prevIndex = this._currentIndex - 1;
            if (prevIndex >= 0) {
                return prevIndex;
            }
            return -1;
        }
    }

    private _generateShuffledIndices(): void {
        this._shuffledIndices = Array.from({ length: this._playlist.length }, (_, i) => i);

        // Fisher-Yates shuffle
        for (let i = this._shuffledIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this._shuffledIndices[i], this._shuffledIndices[j]] = [this._shuffledIndices[j], this._shuffledIndices[i]];
        }
    }

    private _handleTrackEnd(): void {
        this._setState('ended', this._state.currentTrack);
        this._emitEvent('trackEnded', {
            track: this._state.currentTrack,
            index: this._currentIndex,
        });

        // Auto-play next track based on play mode
        if (this._playMode === 'repeatOne') {
            this.playTrack(this._currentIndex);
        } else if (this._canPlayNext()) {
            this.next();
        } else {
            this._setState('idle', null);
            this._emitEvent('playlistEnded');
        }
    }

    private _emitEvent(type: PlaylistEventType, data?: any): void {
        const event: PlaylistEvent = {
            type,
            data,
            timestamp: Date.now(),
        };

        const callbacks = this._eventCallbacks.get(type);
        if (callbacks) {
            callbacks.forEach((callback) => {
                try {
                    callback(event);
                } catch (error) {
                    console.error('Error in playlist event callback:', error);
                }
            });
        }
    }
}
