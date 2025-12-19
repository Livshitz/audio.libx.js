/**
 * AudioLevelAnalyzer - Standalone audio level visualization utility
 * Provides real-time audio level monitoring for microphone testing
 * Separate from AudioRecorder for use cases that don't require recording
 */

export interface AudioLevelAnalyzerOptions {
    /** FFT size for frequency analysis (default: 256) */
    fftSize?: number;

    /** Smoothing time constant for analyser (default: 0.8) */
    smoothingTimeConstant?: number;

    /** Update interval in milliseconds (default: 50ms for ~20fps) */
    updateInterval?: number;
}

export class AudioLevelAnalyzer {
    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    private animationId: number | null = null;
    private levelCallbacks: Set<(level: number) => void> = new Set();
    private options: Required<AudioLevelAnalyzerOptions>;
    private isRunning: boolean = false;
    private stream: MediaStream;
    private dataArray: Uint8Array<ArrayBuffer> | null = null;

    constructor(stream: MediaStream, options: AudioLevelAnalyzerOptions = {}) {
        this.stream = stream;
        this.options = {
            fftSize: options.fftSize ?? 256,
            smoothingTimeConstant: options.smoothingTimeConstant ?? 0.8,
            updateInterval: options.updateInterval ?? 50,
        };

        this._initialize();
    }

    /**
     * Initialize AudioContext and AnalyserNode
     */
    private _initialize(): void {
        try {
            // Create AudioContext
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

            // Create analyser node
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = this.options.fftSize;
            this.analyser.smoothingTimeConstant = this.options.smoothingTimeConstant;

            // Connect media stream to analyser
            this.source = this.audioContext.createMediaStreamSource(this.stream);
            this.source.connect(this.analyser);

            // Create data array for frequency data
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
        } catch (error) {
            console.error('Failed to initialize AudioLevelAnalyzer:', error);
            throw error;
        }
    }

    /**
     * Start monitoring audio levels
     */
    start(): void {
        if (this.isRunning) {
            console.warn('AudioLevelAnalyzer is already running');
            return;
        }

        if (!this.analyser || !this.dataArray) {
            throw new Error('AudioLevelAnalyzer not properly initialized');
        }

        this.isRunning = true;
        this._updateLevel();
    }

    /**
     * Stop monitoring audio levels
     */
    stop(): void {
        this.isRunning = false;

        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    /**
     * Register a callback for level updates
     * @param callback - Function to call with level (0-1)
     * @returns Unsubscribe function
     */
    onLevel(callback: (level: number) => void): () => void {
        this.levelCallbacks.add(callback);

        // Return unsubscribe function
        return () => {
            this.levelCallbacks.delete(callback);
        };
    }

    /**
     * Internal method to update and emit audio level
     */
    private _updateLevel = (): void => {
        if (!this.isRunning || !this.analyser || !this.dataArray) {
            return;
        }

        // Get frequency data
        this.analyser.getByteFrequencyData(this.dataArray);

        // Calculate average level (RMS-like)
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i] * this.dataArray[i];
        }
        const rms = Math.sqrt(sum / this.dataArray.length);

        // Normalize to 0-1 range (255 is max for Uint8Array)
        const level = Math.min(1, rms / 128);

        // Emit to all callbacks
        this.levelCallbacks.forEach((callback) => {
            try {
                callback(level);
            } catch (error) {
                console.error('Error in level callback:', error);
            }
        });

        // Schedule next update using requestAnimationFrame for smooth updates
        this.animationId = requestAnimationFrame(this._updateLevel);
    };

    /**
     * Get current level (useful for polling instead of callbacks)
     * @returns Current audio level (0-1)
     */
    getCurrentLevel(): number {
        if (!this.analyser || !this.dataArray) {
            return 0;
        }

        this.analyser.getByteFrequencyData(this.dataArray);

        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i] * this.dataArray[i];
        }
        const rms = Math.sqrt(sum / this.dataArray.length);

        return Math.min(1, rms / 128);
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        this.stop();

        // Disconnect and clean up audio nodes
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }

        if (this.analyser) {
            this.analyser.disconnect();
            this.analyser = null;
        }

        // Close audio context
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }

        // Clear callbacks
        this.levelCallbacks.clear();

        // Clear data array
        this.dataArray = null;
    }

    /**
     * Get analyzer state
     */
    getState(): {
        isRunning: boolean;
        hasCallbacks: boolean;
        callbackCount: number;
    } {
        return {
            isRunning: this.isRunning,
            hasCallbacks: this.levelCallbacks.size > 0,
            callbackCount: this.levelCallbacks.size,
        };
    }
}

