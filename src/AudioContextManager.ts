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

    constructor(options: AudioContextManagerOptions = {}) {
        this._options = {
            sampleRate: options.sampleRate ?? 44100,
            latencyHint: options.latencyHint ?? 'interactive',
            autoUnlock: options.autoUnlock ?? false,
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

            // Play silent buffer to fully unlock on iOS
            if (this._platform === 'ios' || this._platform === 'safari') {
                await this._playSilentBuffer(context);
            }

            const newState = context.state as AudioContextState;
            this._isLocked = newState !== 'running';
            return !this._isLocked;
        } catch (error) {
            console.warn('Failed to unlock audio context:', error);
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
                    'Ensure Silent Mode is off for sound effects',
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
        };
    }

    /**
     * Close and cleanup the audio context
     */
    public async dispose(): Promise<void> {
        this._removeUnlockHandlers();

        if (this._audioContext) {
            if (this._audioContext.state !== 'closed') {
                await this._audioContext.close();
            }
            this._audioContext = null;
        }

        this._isLocked = true;
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

