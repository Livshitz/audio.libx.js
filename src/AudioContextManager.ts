/**
 * AudioContextManager - Centralized audio context management for mobile and desktop
 * Handles platform detection, audio context unlocking, and lifecycle management
 */

import { AudioContextManagerState, AudioContextManagerOptions, PlatformType } from './types.js';

export class AudioContextManager {
    private _audioContext: AudioContext | null = null;
    private _options: Required<AudioContextManagerOptions>;
    private _platform: PlatformType;
    private _isLocked: boolean = true;
    private _autoUnlockRegistered: boolean = false;
    private _unlockHandlers: (() => void)[] = [];
    private _silentAudioElement: HTMLAudioElement | null = null;
    private _iosAudioUnlocked: boolean = false;
    private _unlockInProgress: boolean = false;
    private _hasPlayedRealAudio: boolean = false;

    constructor(options: AudioContextManagerOptions = {}) {
        this._options = {
            sampleRate: options.sampleRate ?? 44100,
            latencyHint: options.latencyHint ?? 'interactive',
            autoUnlock: options.autoUnlock ?? false,
            // iOS AudioSession type: 'playback' (default) or 'play-and-record' (for apps with mic)
            audioSessionType: options.audioSessionType ?? 'playback',
        };

        this._platform = this._detectPlatform();

        if (this._options.autoUnlock) {
            this.registerAutoUnlock();
        }
    }

    /**
     * Get or create the audio context
     */
    public getContext(): AudioContext {
        if (!this._audioContext) {
            this._audioContext = new AudioContext({
                sampleRate: this._options.sampleRate,
                latencyHint: this._options.latencyHint,
            });

            // Check if context is already running (unlikely on first creation)
            if (this._audioContext.state === 'running') {
                this._isLocked = false;
            }
        }

        return this._audioContext;
    }

    /**
     * Check if audio context needs to be unlocked
     */
    public needsUnlock(): boolean {
        if (!this._audioContext) {
            // On mobile platforms, assume locked until proven otherwise
            return this._platform === 'ios' || this._platform === 'android';
        }

        return this._audioContext.state === 'suspended' || this._isLocked;
    }

    /**
     * Ensure audio context is unlocked and running
     * Includes iOS silent mode bypass
     */
    public async ensureUnlocked(): Promise<boolean> {
        const context = this.getContext();

        const state = context.state as AudioContextState;
        if (state === 'running') {
            this._isLocked = false;
            return true;
        }

        try {
            await context.resume();

            // iOS-specific unlock with silent mode bypass
            if (this._platform === 'ios' || this._platform === 'safari') {
                await this._unlockIOSAudio(context);
            }

            const newState = context.state as AudioContextState;
            this._isLocked = newState !== 'running';
            return !this._isLocked;
        } catch (error) {
            console.warn('[AudioContextManager] Failed to unlock audio context:', error);
            return false;
        }
    }

    /**
     * Register auto-unlock on next user gesture
     */
    public registerAutoUnlock(): void {
        if (this._autoUnlockRegistered) return;

        const unlockHandler = async () => {
            const unlocked = await this.ensureUnlocked();
            if (unlocked) {
                this._removeUnlockHandlers();
            }
        };

        // Register on multiple event types to catch any user interaction
        const events = ['click', 'touchstart', 'touchend', 'keydown'];
        events.forEach((eventType) => {
            const handler = () => {
                unlockHandler();
            };
            document.addEventListener(eventType, handler, { once: true, passive: true });
            this._unlockHandlers.push(() => {
                document.removeEventListener(eventType, handler);
            });
        });

        this._autoUnlockRegistered = true;
    }

    /**
     * Get platform-specific guidance for audio setup
     */
    public getPlatformGuidance(): string[] {
        switch (this._platform) {
            case 'ios':
                return [
                    'Tap the screen to enable audio',
                    'Audio playback requires user interaction on iOS',
                    'Use headphones for better audio quality',
                    'Silent mode bypass is automatically enabled',
                ];

            case 'android':
                return [
                    'Tap the screen to enable audio',
                    'Grant microphone permission when prompted',
                    'Check volume settings if no sound',
                ];

            case 'safari':
                return [
                    'Click anywhere to enable audio',
                    'Safari requires user interaction for audio playback',
                    'Ensure autoplay is allowed in browser settings',
                ];

            case 'desktop':
            default:
                return [
                    'Click to start audio if needed',
                    'Grant microphone permission when prompted',
                ];
        }
    }

    /**
     * Get current state of the audio context manager
     */
    public getState(): AudioContextManagerState {
        const context = this._audioContext;

        return {
            platform: this._platform,
            isLocked: this._isLocked,
            contextState: context ? (context.state as 'suspended' | 'running' | 'closed' | 'interrupted') : 'suspended',
            autoUnlockRegistered: this._autoUnlockRegistered,
            iosAudioUnlocked: this._iosAudioUnlocked,
        };
    }

    /**
     * Close and cleanup the audio context
     */
    public async dispose(): Promise<void> {
        this._removeUnlockHandlers();

        // Cleanup silent audio element
        if (this._silentAudioElement) {
            this._silentAudioElement.pause();
            this._silentAudioElement.src = ''; // Release media resource
            this._silentAudioElement.remove();
            this._silentAudioElement = null;
        }

        if (this._audioContext) {
            if (this._audioContext.state !== 'closed') {
                await this._audioContext.close();
            }
            this._audioContext = null;
        }

        this._isLocked = true;
        this._iosAudioUnlocked = false;
        this._unlockInProgress = false;
        this._hasPlayedRealAudio = false;
        this._autoUnlockRegistered = false;
    }

    /**
     * Detect the platform type
     */
    private _detectPlatform(): PlatformType {
        const userAgent = navigator.userAgent.toLowerCase();
        const platform = navigator.platform?.toLowerCase() || '';

        // iOS detection
        if (
            /iphone|ipad|ipod/.test(userAgent) ||
            (platform.includes('mac') && 'ontouchend' in document)
        ) {
            return 'ios';
        }

        // Android detection
        if (/android/.test(userAgent)) {
            return 'android';
        }

        // Safari detection (desktop)
        if (/safari/.test(userAgent) && !/chrome/.test(userAgent)) {
            return 'safari';
        }

        return 'desktop';
    }

    /**
     * Create a validated minimal silent WAV file as base64 data URI
     * This is a complete 44-byte WAV file: 16-bit mono, 44.1kHz, 1 sample of silence
     */
    private static readonly SILENT_WAV_44100 = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    
    /**
     * Get appropriate silent WAV for the given sample rate
     */
    private _getSilentWav(sampleRate: number): string {
        // For now, use the 44.1kHz version for all sample rates
        // The browser will handle resampling if needed
        return AudioContextManager.SILENT_WAV_44100;
    }

    /**
     * Unlock iOS audio with silent mode bypass
     * Combines AudioSession API + silent HTML audio loop + Web Audio buffer
     * 
     * The silent audio loop will automatically stop after the first real audio plays
     * to conserve battery while maintaining silent mode bypass capability.
     */
    private async _unlockIOSAudio(context: AudioContext): Promise<void> {
        // Skip if already unlocked or unlock in progress (prevent race condition)
        if (this._iosAudioUnlocked || this._unlockInProgress) {
            return;
        }

        this._unlockInProgress = true;

        try {
            // console.log('[AudioContextManager] Unlocking iOS audio for silent mode bypass...');

            // Strategy 1: AudioSession API (Safari 17.4+)
            if ('audioSession' in navigator) {
                try {
                    const sessionType = this._options.audioSessionType || 'playback';
                    (navigator as any).audioSession.type = sessionType === 'play-and-record' ? 'play-and-record' : 'playback';
                    console.log(`[AudioContextManager] ✓ AudioSession set to ${sessionType} mode`);
                } catch (err) {
                    console.warn('[AudioContextManager] AudioSession API failed:', err);
                }
            }

            // Strategy 2: Silent HTML audio loop
            if (!this._silentAudioElement) {
                const audio = document.createElement('audio');
                audio.setAttribute('x-webkit-airplay', 'deny');
                audio.preload = 'auto';
                audio.loop = true; // Critical: keeps audio session active
                audio.volume = 0.01; // Very low volume to be truly silent
                audio.src = this._getSilentWav(context.sampleRate);
                
                // Append to DOM (required for consistent behavior across browsers)
                audio.style.position = 'fixed';
                audio.style.left = '-9999px';
                audio.style.opacity = '0';
                audio.style.pointerEvents = 'none';
                document.body.appendChild(audio);
                
                audio.load();

                this._silentAudioElement = audio;

                try {
                    await audio.play();
                    console.log('[AudioContextManager] ✓ Silent HTML audio playing (silent mode bypass active)');
                    this._iosAudioUnlocked = true;
                } catch (err) {
                    console.warn('[AudioContextManager] Silent HTML audio play failed:', err);
                    // Cleanup failed element
                    audio.remove();
                    this._silentAudioElement = null;
                }
            }

            // Strategy 3: Web Audio buffer (for compatibility)
            await this._playSilentBuffer(context);
        } finally {
            this._unlockInProgress = false;
        }
    }

    /**
     * Stop the silent audio loop after real audio has played
     * Call this after successfully playing actual audio content
     */
    public stopSilentAudioLoop(): void {
        if (this._silentAudioElement && this._iosAudioUnlocked && !this._hasPlayedRealAudio) {
            this._hasPlayedRealAudio = true;
            
            // Stop the loop to conserve battery
            this._silentAudioElement.loop = false;
            
            // Let it finish current iteration, then it will stop naturally
            console.log('[AudioContextManager] Silent audio loop will stop after first real audio playback');
        }
    }

    /**
     * Play a silent buffer to unlock audio on iOS
     */
    private async _playSilentBuffer(context: AudioContext): Promise<void> {
        return new Promise((resolve) => {
            const buffer = context.createBuffer(1, 1, context.sampleRate);
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            source.onended = () => resolve();
            source.start(0);
        });
    }

    /**
     * Remove all unlock event handlers
     */
    private _removeUnlockHandlers(): void {
        this._unlockHandlers.forEach((handler) => handler());
        this._unlockHandlers = [];
        this._autoUnlockRegistered = false;
    }

    /**
     * Check if the platform is mobile
     */
    public isMobile(): boolean {
        return this._platform === 'ios' || this._platform === 'android';
    }

    /**
     * Check if the platform is iOS
     */
    public isIOS(): boolean {
        return this._platform === 'ios';
    }

    /**
     * Check if the platform is Safari
     */
    public isSafari(): boolean {
        return this._platform === 'safari' || this._platform === 'ios';
    }
}

