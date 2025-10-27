/**
 * SoundEffectsManager - Key-to-URL mapping for sound effects with caching
 * Provides easy sound effect playback with enum support and persistent caching
 */

import { AudioCache } from './AudioCache.js';
import { AudioProcessor } from './AudioProcessor.js';
import {
    SoundEffectOptions,
    SoundEffectState,
    SoundEffectEvent,
    SoundEffectEventType,
    SoundEffectEventCallback,
    SoundEffectItem,
    SoundEffectKey,
} from './types.js';

export class SoundEffectsManager {
    private _cache: AudioCache;
    private _processor: AudioProcessor;
    private _soundEffects: Map<SoundEffectKey, SoundEffectItem> = new Map();
    private _activeSounds: Map<string, HTMLAudioElement> = new Map();
    private _state: SoundEffectState;
    private _eventCallbacks: Map<SoundEffectEventType, SoundEffectEventCallback[]> = new Map();
    private _options: Required<SoundEffectOptions>;
    private _isInitialized: boolean = false;

    constructor(options: SoundEffectOptions = {}) {
        this._options = {
            enableCaching: options.enableCaching ?? true,
            cacheDbName: options.cacheDbName ?? 'sound-effects-cache',
            cacheStoreName: options.cacheStoreName ?? 'sound-effects',
            maxConcurrentSounds: options.maxConcurrentSounds ?? 8,
            defaultVolume: options.defaultVolume ?? 1.0,
            preloadSounds: options.preloadSounds ?? false,
            audioStreamerOptions: options.audioStreamerOptions ?? {},
        };

        this._cache = new AudioCache(this._options.cacheDbName, this._options.cacheStoreName);
        this._processor = new AudioProcessor();

        this._state = {
            state: 'idle',
            loadedSounds: 0,
            totalSounds: 0,
            activeSounds: 0,
            canPlay: false,
            error: null,
        };
    }

    /**
     * Initialize the sound effects manager
     */
    public async initialize(): Promise<void> {
        if (this._isInitialized) return;

        await this._cache.initialize();
        this._isInitialized = true;
        this._updateState();
        this._emitEvent('initialized');
    }

    /**
     * Register a sound effect with a key
     */
    public registerSound(key: SoundEffectKey, url: string, metadata?: Partial<SoundEffectItem>): void {
        const soundEffect: SoundEffectItem = {
            key,
            url,
            title: metadata?.title || String(key),
            duration: metadata?.duration || 0,
            volume: metadata?.volume ?? this._options.defaultVolume,
            loop: metadata?.loop ?? false,
            preload: metadata?.preload ?? this._options.preloadSounds,
            metadata: metadata?.metadata || {},
        };

        this._soundEffects.set(key, soundEffect);
        this._updateState();
        this._emitEvent('soundRegistered', { key, soundEffect });

        // Preload if enabled
        if (soundEffect.preload) {
            this._preloadSound(soundEffect);
        }
    }

    /**
     * Register multiple sound effects at once
     */
    public registerSounds(sounds: Array<{ key: SoundEffectKey; url: string; metadata?: Partial<SoundEffectItem> }>): void {
        sounds.forEach(({ key, url, metadata }) => {
            this.registerSound(key, url, metadata);
        });
    }

    /**
     * Play a sound effect by key
     */
    public async playSound(
        key: SoundEffectKey,
        options?: {
            volume?: number;
            loop?: boolean;
            onEnded?: () => void;
        }
    ): Promise<HTMLAudioElement | null> {
        await this.initialize();

        const soundEffect = this._soundEffects.get(key);
        if (!soundEffect) {
            throw new Error(`Sound effect '${String(key)}' not found`);
        }

        // Check concurrent sound limit
        if (this._activeSounds.size >= this._options.maxConcurrentSounds) {
            console.warn(`Maximum concurrent sounds (${this._options.maxConcurrentSounds}) reached`);
            return null;
        }

        try {
            const audioElement = await this._createAudioElement(soundEffect, options);
            if (audioElement) {
                this._activeSounds.set(`${String(key)}-${Date.now()}`, audioElement);
                this._updateState();
                this._emitEvent('soundPlayed', { key, soundEffect, audioElement });
            }
            return audioElement;
        } catch (error) {
            this._setState('error', error.message);
            this._emitEvent('playError', { key, soundEffect, error });
            throw error;
        }
    }

    /**
     * Stop a specific sound effect
     */
    public stopSound(key: SoundEffectKey): void {
        const soundEntries = Array.from(this._activeSounds.entries()).filter(([soundKey]) => soundKey.startsWith(String(key)));

        soundEntries.forEach(([soundKey, audioElement]) => {
            audioElement.pause();
            audioElement.currentTime = 0;
            this._activeSounds.delete(soundKey);
        });

        this._updateState();
        this._emitEvent('soundStopped', { key });
    }

    /**
     * Stop all playing sounds
     */
    public stopAllSounds(): void {
        this._activeSounds.forEach((audioElement) => {
            audioElement.pause();
            audioElement.currentTime = 0;
        });
        this._activeSounds.clear();
        this._updateState();
        this._emitEvent('allSoundsStopped');
    }

    /**
     * Set volume for a specific sound effect
     */
    public setVolume(key: SoundEffectKey, volume: number): void {
        const soundEffect = this._soundEffects.get(key);
        if (soundEffect) {
            soundEffect.volume = Math.max(0, Math.min(1, volume));
            this._emitEvent('volumeChanged', { key, volume });
        }
    }

    /**
     * Get sound effect information
     */
    public getSoundEffect(key: SoundEffectKey): SoundEffectItem | null {
        return this._soundEffects.get(key) || null;
    }

    /**
     * Get all registered sound effects
     */
    public getAllSoundEffects(): SoundEffectItem[] {
        return Array.from(this._soundEffects.values());
    }

    /**
     * Get currently playing sounds
     */
    public getActiveSounds(): Array<{ key: SoundEffectKey; audioElement: HTMLAudioElement }> {
        return Array.from(this._activeSounds.entries()).map(([soundKey, audioElement]) => ({
            key: soundKey.split('-')[0] as SoundEffectKey,
            audioElement,
        }));
    }

    /**
     * Remove a sound effect
     */
    public removeSound(key: SoundEffectKey): boolean {
        const soundEffect = this._soundEffects.get(key);
        if (!soundEffect) return false;

        // Stop any active instances
        this.stopSound(key);

        // Remove from cache if enabled
        if (this._options.enableCaching) {
            this._cache.delete(String(key)).catch(console.error);
        }

        this._soundEffects.delete(key);
        this._updateState();
        this._emitEvent('soundRemoved', { key, soundEffect });
        return true;
    }

    /**
     * Clear all sound effects
     */
    public clearAllSounds(): void {
        this.stopAllSounds();
        this._soundEffects.clear();
        this._updateState();
        this._emitEvent('allSoundsCleared');
    }

    /**
     * Preload a specific sound effect
     */
    public async preloadSound(key: SoundEffectKey): Promise<void> {
        const soundEffect = this._soundEffects.get(key);
        if (!soundEffect) {
            throw new Error(`Sound effect '${String(key)}' not found`);
        }

        await this._preloadSound(soundEffect);
    }

    /**
     * Preload all registered sound effects
     */
    public async preloadAllSounds(): Promise<void> {
        const preloadPromises = Array.from(this._soundEffects.values()).map((soundEffect) => this._preloadSound(soundEffect));

        await Promise.allSettled(preloadPromises);
    }

    /**
     * Get current state
     */
    public getState(): SoundEffectState {
        return { ...this._state };
    }

    /**
     * Get capabilities
     */
    public getCapabilities(): {
        isSupported: boolean;
        hasCaching: boolean;
        hasProcessor: boolean;
        maxConcurrentSounds: number;
        preloadSupported: boolean;
    } {
        return {
            isSupported: typeof Audio !== 'undefined',
            hasCaching: this._options.enableCaching,
            hasProcessor: true,
            maxConcurrentSounds: this._options.maxConcurrentSounds,
            preloadSupported: true,
        };
    }

    /**
     * Event subscription
     */
    public on(event: SoundEffectEventType, callback: SoundEffectEventCallback): void {
        if (!this._eventCallbacks.has(event)) {
            this._eventCallbacks.set(event, []);
        }
        this._eventCallbacks.get(event)!.push(callback);
    }

    /**
     * Event unsubscription
     */
    public off(event: SoundEffectEventType, callback: SoundEffectEventCallback): void {
        const callbacks = this._eventCallbacks.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * Dispose the sound effects manager
     */
    public dispose(): void {
        this.stopAllSounds();
        this._cache.close();
        this._eventCallbacks.clear();
        this._soundEffects.clear();
        this._isInitialized = false;
    }

    private async _createAudioElement(
        soundEffect: SoundEffectItem,
        options?: { volume?: number; loop?: boolean; onEnded?: () => void }
    ): Promise<HTMLAudioElement> {
        let audioElement: HTMLAudioElement;

        // Try to get from cache first
        if (this._options.enableCaching) {
            try {
                const cachedData = await this._cache.get(String(soundEffect.key));
                if (cachedData) {
                    // For now, we'll load directly since AudioCache.get returns Uint8Array[]
                    // In a real implementation, we'd need to store mimeType separately
                    audioElement = await this._loadAndCacheSound(soundEffect);
                } else {
                    audioElement = await this._loadAndCacheSound(soundEffect);
                }
            } catch (error) {
                console.warn('Cache retrieval failed, loading directly:', error);
                audioElement = await this._loadAndCacheSound(soundEffect);
            }
        } else {
            audioElement = new Audio(soundEffect.url);
        }

        // Configure audio element
        audioElement.volume = options?.volume ?? soundEffect.volume;
        audioElement.loop = options?.loop ?? soundEffect.loop;

        // Set up event listeners
        audioElement.addEventListener(
            'ended',
            () => {
                this._handleSoundEnded(soundEffect.key, audioElement);
                options?.onEnded?.();
            },
            { once: true }
        );

        audioElement.addEventListener('error', (event) => {
            this._emitEvent('playError', {
                key: soundEffect.key,
                soundEffect,
                error: event,
            });
        });

        // Play the sound
        try {
            await audioElement.play();
        } catch (playError) {
            // Handle autoplay restrictions
            if (playError.name === 'NotAllowedError') {
                console.warn('Autoplay blocked, user interaction required');
                this._emitEvent('autoplayBlocked', { key: soundEffect.key, soundEffect });
            }
            throw playError;
        }

        return audioElement;
    }

    private async _loadAndCacheSound(soundEffect: SoundEffectItem): Promise<HTMLAudioElement> {
        const response = await fetch(soundEffect.url);
        if (!response.ok) {
            throw new Error(`Failed to load sound: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const chunks = this._processor.splitIntoChunks(new Uint8Array(arrayBuffer), 8192);

        // Cache the sound if caching is enabled
        if (this._options.enableCaching) {
            try {
                await this._cache.set(String(soundEffect.key), chunks, response.headers.get('content-type') || 'audio/mpeg');
            } catch (cacheError) {
                console.warn('Failed to cache sound:', cacheError);
            }
        }

        const blob = new Blob([arrayBuffer], { type: response.headers.get('content-type') || 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audioElement = new Audio(url);

        // Clean up object URL when audio ends
        audioElement.addEventListener(
            'ended',
            () => {
                URL.revokeObjectURL(url);
            },
            { once: true }
        );

        return audioElement;
    }

    private async _preloadSound(soundEffect: SoundEffectItem): Promise<void> {
        try {
            await this._loadAndCacheSound(soundEffect);
            this._emitEvent('soundPreloaded', { key: soundEffect.key, soundEffect });
        } catch (error) {
            this._emitEvent('preloadError', { key: soundEffect.key, soundEffect, error });
        }
    }

    private _handleSoundEnded(key: SoundEffectKey, audioElement: HTMLAudioElement): void {
        // Find and remove from active sounds
        const soundKey = Array.from(this._activeSounds.entries()).find(([, element]) => element === audioElement)?.[0];

        if (soundKey) {
            this._activeSounds.delete(soundKey);
            this._updateState();
            this._emitEvent('soundEnded', { key, audioElement });
        }
    }

    private _setState(state: SoundEffectState['state'], error?: string): void {
        this._state.state = state;
        this._state.error = error;
        this._updateState();
        this._emitEvent('stateChange', { state, error });
    }

    private _updateState(): void {
        this._state.loadedSounds = this._soundEffects.size;
        this._state.totalSounds = this._soundEffects.size;
        this._state.activeSounds = this._activeSounds.size;
        this._state.canPlay = this._soundEffects.size > 0;
    }

    private _emitEvent(type: SoundEffectEventType, data?: any): void {
        const event: SoundEffectEvent = {
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
                    console.error('Error in sound effect event callback:', error);
                }
            });
        }
    }
}
