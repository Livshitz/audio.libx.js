/**
 * BeatDetector - Real-time beat detection for audio playback
 * Uses energy-based detection on bass frequencies with statistical thresholding
 */

import {
	BeatDetectorOptions,
	BeatDetectorState,
	BeatEvent,
	BeatDetectorEventType,
	BeatDetectorEventCallback,
	BeatDetectionError,
} from './types.js';

export class BeatDetector {
	private _audioContext: AudioContext | null = null;
	private _analyserNode: AnalyserNode | null = null;
	private _sourceNode: MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null = null;
	private _options: Required<BeatDetectorOptions>;
	private _state: BeatDetectorState;
	private _eventCallbacks: Map<BeatDetectorEventType, BeatDetectorEventCallback[]> = new Map();
	private _energyHistory: number[] = [];
	private _lastBeatTime: number = 0;
	private _animationFrameId: number | null = null;
	private _isConnected: boolean = false;

	constructor(options: BeatDetectorOptions = {}) {
		this._options = {
			sensitivity: options.sensitivity ?? 2.0,
			cooldown: options.cooldown ?? 200,
			frequencyRangeLow: options.frequencyRangeLow ?? 0,
			frequencyRangeHigh: options.frequencyRangeHigh ?? 0.15,
			energyHistorySize: options.energyHistorySize ?? 43,
			minEnergyThreshold: options.minEnergyThreshold ?? 0.01,
			fftSize: options.fftSize ?? 512,
			smoothingTimeConstant: options.smoothingTimeConstant ?? 0.8,
		};

		this._state = {
			isRunning: false,
			lastBeatTime: null,
			avgEnergy: 0,
			currentEnergy: 0,
			beatCount: 0,
			config: this._options,
		};
	}

    /**
     * Connect to an audio element
     */
	public async connectAudioElement(audioElement: HTMLAudioElement): Promise<void> {
		try {
			if (this._isConnected) {
				this.disconnect();
			}

			// iOS compatibility check
			if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
				console.warn('Beat detection may not work reliably on iOS due to Safari limitations');
			}

			this._audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
			this._analyserNode = this._audioContext.createAnalyser();
			this._analyserNode.fftSize = this._options.fftSize;
			this._analyserNode.smoothingTimeConstant = this._options.smoothingTimeConstant;

			this._sourceNode = this._audioContext.createMediaElementSource(audioElement);
			this._sourceNode.connect(this._analyserNode);
			this._analyserNode.connect(this._audioContext.destination);

			this._isConnected = true;

			this._emitEvent('started', undefined);
		} catch (error) {
			throw new BeatDetectionError('Failed to connect audio element', error as Error);
		}
	}

	/**
	 * Connect to a media stream
	 */
	public async connectMediaStream(stream: MediaStream): Promise<void> {
		try {
			if (this._isConnected) {
				this.disconnect();
			}

			this._audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
			this._analyserNode = this._audioContext.createAnalyser();
			this._analyserNode.fftSize = this._options.fftSize;
			this._analyserNode.smoothingTimeConstant = this._options.smoothingTimeConstant;

			this._sourceNode = this._audioContext.createMediaStreamSource(stream);
			this._sourceNode.connect(this._analyserNode);

			this._isConnected = true;

			this._emitEvent('started', undefined);
		} catch (error) {
			throw new BeatDetectionError('Failed to connect media stream', error as Error);
		}
	}

    /**
     * Start beat detection
     */
	public start(): void {
		if (!this._isConnected) {
			throw new BeatDetectionError('No audio source connected. Call connectAudioElement() or connectMediaStream() first.');
		}

		if (this._state.isRunning) return;

		this._state.isRunning = true;
		this._energyHistory = [];
		this._lastBeatTime = 0;
		this._state.beatCount = 0;

		this._detectLoop();
	}

	/**
	 * Stop beat detection
	 */
	public stop(): void {
		if (!this._state.isRunning) return;

		this._state.isRunning = false;

		if (this._animationFrameId !== null) {
			cancelAnimationFrame(this._animationFrameId);
			this._animationFrameId = null;
		}

		this._emitEvent('stopped', undefined);
	}

    /**
     * Set sensitivity (0.5-5.0)
     */
	public setSensitivity(value: number): void {
		this._options.sensitivity = Math.max(0.5, Math.min(5.0, value));
		this._state.config.sensitivity = this._options.sensitivity;
	}

    /**
     * Set cooldown period in milliseconds
     */
	public setCooldown(ms: number): void {
		this._options.cooldown = Math.max(0, ms);
		this._state.config.cooldown = this._options.cooldown;
	}

    /**
     * Set frequency range for analysis (0-1)
     */
	public setFrequencyRange(low: number, high: number): void {
		this._options.frequencyRangeLow = Math.max(0, Math.min(1, low));
		this._options.frequencyRangeHigh = Math.max(0, Math.min(1, high));
		this._state.config.frequencyRangeLow = this._options.frequencyRangeLow;
		this._state.config.frequencyRangeHigh = this._options.frequencyRangeHigh;
	}

	/**
	 * Get current state
	 */
	public getState(): BeatDetectorState {
		return { ...this._state };
	}

    /**
     * Check if detection is running
     */
	public isRunning(): boolean {
		return this._state.isRunning;
	}

    /**
     * Disconnect from audio source
     */
	public disconnect(): void {
		this.stop();

		if (this._sourceNode) {
			this._sourceNode.disconnect();
			this._sourceNode = null;
		}

		if (this._analyserNode) {
			this._analyserNode.disconnect();
			this._analyserNode = null;
		}

		this._isConnected = false;
	}

    /**
     * Cleanup and destroy
     */
	public destroy(): void {
		this.disconnect();

		if (this._audioContext) {
			this._audioContext.close();
			this._audioContext = null;
		}

		this._eventCallbacks.clear();
		this._energyHistory = [];
	}

    /**
     * Register event listener
     */
	public on(eventType: BeatDetectorEventType, callback: BeatDetectorEventCallback): void {
		if (!this._eventCallbacks.has(eventType)) {
			this._eventCallbacks.set(eventType, []);
		}
		this._eventCallbacks.get(eventType)!.push(callback);
	}

    /**
     * Remove event listener
     */
	public off(eventType: BeatDetectorEventType, callback: BeatDetectorEventCallback): void {
		const callbacks = this._eventCallbacks.get(eventType);
		if (callbacks) {
			const index = callbacks.indexOf(callback);
			if (index !== -1) {
				callbacks.splice(index, 1);
			}
		}
	}

    /**
     * Beat detection loop
     */
	private _detectLoop = (): void => {
		if (!this._state.isRunning) return;

		this._animationFrameId = requestAnimationFrame(this._detectLoop);

		if (!this._analyserNode) return;

		// Get frequency data
		const frequencyData = new Uint8Array(this._analyserNode.frequencyBinCount);
		this._analyserNode.getByteFrequencyData(frequencyData);

		// Calculate instant energy for bass frequencies
		const bassStart = Math.floor(frequencyData.length * this._options.frequencyRangeLow);
		const bassEnd = Math.floor(frequencyData.length * this._options.frequencyRangeHigh);

		let instantEnergy = 0;
		for (let i = bassStart; i < bassEnd; i++) {
			instantEnergy += (frequencyData[i] / 255) ** 2;
		}
		instantEnergy /= (bassEnd - bassStart);

		this._state.currentEnergy = instantEnergy;

		// Maintain energy history
		this._energyHistory.push(instantEnergy);
		if (this._energyHistory.length > this._options.energyHistorySize) {
			this._energyHistory.shift();
		}

		// Need sufficient history for detection
		if (this._energyHistory.length < this._options.energyHistorySize) return;

		// Calculate statistical threshold
		const avgEnergy = this._energyHistory.reduce((a, b) => a + b) / this._energyHistory.length;
		const variance = this._energyHistory.reduce((sum, e) => sum + (e - avgEnergy) ** 2, 0) / this._energyHistory.length;
		const stdDev = Math.sqrt(variance);
		const threshold = avgEnergy + this._options.sensitivity * stdDev;

		this._state.avgEnergy = avgEnergy;

		// Detect beat
		const now = performance.now();
		if (
			instantEnergy > threshold &&
			instantEnergy > this._options.minEnergyThreshold &&
			(now - this._lastBeatTime) > this._options.cooldown
		) {
			const beatStrength = (instantEnergy - avgEnergy) / (stdDev + 0.0001);
			const confidence = Math.min(1, beatStrength / 5); // Normalize to 0-1

			const beatEvent: BeatEvent = {
				timestamp: now,
				strength: beatStrength,
				energy: instantEnergy,
				avgEnergy: avgEnergy,
				confidence: confidence,
			};

			this._lastBeatTime = now;
			this._state.lastBeatTime = now;
			this._state.beatCount++;

			this._emitEvent('beat', beatEvent);
		}
	};

    /**
     * Emit event to listeners
     */
	private _emitEvent(type: BeatDetectorEventType, data: any): void {
		const callbacks = this._eventCallbacks.get(type);
		if (callbacks) {
			const event = {
				type,
				data,
				timestamp: performance.now(),
			};
			callbacks.forEach(callback => callback(event));
		}
	}
}
