/**
 * BeatDetector - Real-time beat detection for audio playback
 * 
 * Uses energy-based detection with Web Audio API's AnalyserNode to detect beats
 * in audio streams. Focuses on bass frequencies for reliable beat detection.
 * 
 * @warning iOS Safari may have issues with createMediaElementSource() breaking audio playback.
 * See: https://bugs.webkit.org/show_bug.cgi?id=211394
 * 
 * @example
 * ```typescript
 * const beatDetector = new BeatDetector({ sensitivity: 2.0 });
 * await beatDetector.connect(audioElement);
 * 
 * beatDetector.on('beat', (event) => {
 *   console.log('Beat detected!', event.data.strength);
 * });
 * 
 * beatDetector.start();
 * ```
 */

import {
	BeatDetectorOptions,
	BeatDetectorState,
	BeatEvent,
	BeatDetectorEventType,
	BeatDetectorEventCallback,
	BeatDetectorEvent,
	BeatDetectionError
} from './types.js';

export class BeatDetector {
	private _options: Required<BeatDetectorOptions>;
	private _audioContext: AudioContext | null = null;
	private _analyser: AnalyserNode | null = null;
	private _sourceNode: MediaElementAudioSourceNode | null = null;
	private _audioElement: HTMLAudioElement | null = null;
	private _frequencyData: Uint8Array<ArrayBuffer> | null = null;
	private _energyHistory: number[] = [];
	private _lastBeatTime: number = 0;
	private _beatCount: number = 0;
	private _isRunning: boolean = false;
	private _animationFrameId: number | null = null;
	private _eventCallbacks: Map<BeatDetectorEventType, BeatDetectorEventCallback[]> = new Map();
	private _avgEnergy: number = 0;
	private _currentEnergy: number = 0;

	constructor(options: BeatDetectorOptions = {}) {
		this._options = {
			sensitivity: options.sensitivity ?? 2.0,
			cooldown: options.cooldown ?? 200,
			frequencyRangeLow: options.frequencyRangeLow ?? 0,
			frequencyRangeHigh: options.frequencyRangeHigh ?? 0.15,
			energyHistorySize: options.energyHistorySize ?? 43,
			minEnergyThreshold: options.minEnergyThreshold ?? 0.01,
			fftSize: options.fftSize ?? 512,
			smoothingTimeConstant: options.smoothingTimeConstant ?? 0.8
		};

		// Validate options
		if (this._options.sensitivity < 0.5 || this._options.sensitivity > 5.0) {
			throw new BeatDetectionError('Sensitivity must be between 0.5 and 5.0');
		}
	}

	/**
	 * Connect to an audio element for beat detection
	 * 
	 * @param audioElement - The HTML audio element to analyze
	 * @throws BeatDetectionError if connection fails or Web Audio API is not supported
	 */
	public async connect(audioElement: HTMLAudioElement): Promise<void> {
		try {
			// Check for Web Audio API support
			if (typeof AudioContext === 'undefined' && typeof (window as any).webkitAudioContext === 'undefined') {
				throw new BeatDetectionError('Web Audio API is not supported in this browser');
			}

			// Warn about iOS issues
			if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
				console.warn('BeatDetector: iOS Safari may experience audio playback issues with MediaElementSource');
			}

			this._audioElement = audioElement;

			// Create audio context
			const AudioContextClass = AudioContext || (window as any).webkitAudioContext;
			this._audioContext = new AudioContextClass();

			// Create analyser node
			this._analyser = this._audioContext.createAnalyser();
			this._analyser.fftSize = this._options.fftSize;
			this._analyser.smoothingTimeConstant = this._options.smoothingTimeConstant;

			// Create frequency data array
			this._frequencyData = new Uint8Array(this._analyser.frequencyBinCount);

			// Connect audio element to analyser
			this._sourceNode = this._audioContext.createMediaElementSource(audioElement);
			this._sourceNode.connect(this._analyser);
			this._analyser.connect(this._audioContext.destination);

			// Resume audio context if suspended
			if (this._audioContext.state === 'suspended') {
				await this._audioContext.resume();
			}

		} catch (error) {
			this.disconnect();
			throw new BeatDetectionError(
				'Failed to connect to audio element',
				error as Error
			);
		}
	}

	/**
	 * Start beat detection
	 * 
	 * @throws BeatDetectionError if not connected to an audio element
	 */
	public start(): void {
		if (!this._analyser || !this._audioElement) {
			throw new BeatDetectionError('Must connect to an audio element before starting');
		}

		if (this._isRunning) {
			return;
		}

		this._isRunning = true;
		this._beatCount = 0;
		this._lastBeatTime = 0;
		this._energyHistory = [];

		this._emitEvent('started');
		this._detectBeats();
	}

	/**
	 * Stop beat detection
	 */
	public stop(): void {
		if (!this._isRunning) {
			return;
		}

		this._isRunning = false;

		if (this._animationFrameId !== null) {
			cancelAnimationFrame(this._animationFrameId);
			this._animationFrameId = null;
		}

		this._emitEvent('stopped');
	}

	/**
	 * Set sensitivity for beat detection
	 * 
	 * @param value - Sensitivity value (0.5-5.0)
	 */
	public setSensitivity(value: number): void {
		if (value < 0.5 || value > 5.0) {
			throw new BeatDetectionError('Sensitivity must be between 0.5 and 5.0');
		}
		this._options.sensitivity = value;
	}

	/**
	 * Set cooldown period between beats
	 * 
	 * @param ms - Cooldown in milliseconds
	 */
	public setCooldown(ms: number): void {
		if (ms < 0) {
			throw new BeatDetectionError('Cooldown must be positive');
		}
		this._options.cooldown = ms;
	}

	/**
	 * Set frequency range for beat detection
	 * 
	 * @param low - Low frequency range (0-1)
	 * @param high - High frequency range (0-1)
	 */
	public setFrequencyRange(low: number, high: number): void {
		if (low < 0 || low > 1 || high < 0 || high > 1 || low >= high) {
			throw new BeatDetectionError('Invalid frequency range');
		}
		this._options.frequencyRangeLow = low;
		this._options.frequencyRangeHigh = high;
	}

	/**
	 * Get current state
	 */
	public getState(): BeatDetectorState {
		return {
			isRunning: this._isRunning,
			lastBeatTime: this._lastBeatTime || null,
			avgEnergy: this._avgEnergy,
			currentEnergy: this._currentEnergy,
			beatCount: this._beatCount,
			config: { ...this._options }
		};
	}

	/**
	 * Check if beat detection is running
	 */
	public isRunning(): boolean {
		return this._isRunning;
	}

	/**
	 * Disconnect from audio element
	 */
	public disconnect(): void {
		this.stop();

		if (this._sourceNode) {
			try {
				this._sourceNode.disconnect();
			} catch (e) {
				// Ignore disconnect errors
			}
			this._sourceNode = null;
		}

		if (this._analyser) {
			try {
				this._analyser.disconnect();
			} catch (e) {
				// Ignore disconnect errors
			}
			this._analyser = null;
		}

		this._audioElement = null;
		this._frequencyData = null;
		this._energyHistory = [];
	}

	/**
	 * Destroy the beat detector and cleanup resources
	 */
	public destroy(): void {
		this.disconnect();

		if (this._audioContext) {
			try {
				this._audioContext.close();
			} catch (e) {
				// Ignore close errors
			}
			this._audioContext = null;
		}

		this._eventCallbacks.clear();
	}

	/**
	 * Subscribe to events
	 */
	public on(eventType: BeatDetectorEventType, callback: BeatDetectorEventCallback): void {
		if (!this._eventCallbacks.has(eventType)) {
			this._eventCallbacks.set(eventType, []);
		}
		this._eventCallbacks.get(eventType)!.push(callback);
	}

	/**
	 * Unsubscribe from events
	 */
	public off(eventType: BeatDetectorEventType, callback: BeatDetectorEventCallback): void {
		const callbacks = this._eventCallbacks.get(eventType);
		if (callbacks) {
			const index = callbacks.indexOf(callback);
			if (index > -1) {
				callbacks.splice(index, 1);
			}
		}
	}

	/**
	 * Main beat detection loop
	 */
	private _detectBeats(): void {
		if (!this._isRunning || !this._analyser || !this._frequencyData) {
			return;
		}

		// Get frequency data
		this._analyser.getByteFrequencyData(this._frequencyData);

		// Calculate instant energy from bass frequencies
		const bassStart = Math.floor(this._frequencyData.length * this._options.frequencyRangeLow);
		const bassEnd = Math.floor(this._frequencyData.length * this._options.frequencyRangeHigh);
		let instantEnergy = 0;

		for (let i = bassStart; i < bassEnd; i++) {
			instantEnergy += (this._frequencyData[i] / 255) ** 2;
		}
		instantEnergy /= (bassEnd - bassStart);

		this._currentEnergy = instantEnergy;

		// Add to history
		this._energyHistory.push(instantEnergy);
		if (this._energyHistory.length > this._options.energyHistorySize) {
			this._energyHistory.shift();
		}

		// Need enough history to detect beats
		if (this._energyHistory.length >= this._options.energyHistorySize) {
			// Calculate average energy
			const avgEnergy = this._energyHistory.reduce((sum, e) => sum + e, 0) / this._energyHistory.length;
			this._avgEnergy = avgEnergy;

			// Calculate standard deviation
			const variance = this._energyHistory.reduce((sum, e) => sum + (e - avgEnergy) ** 2, 0) / this._energyHistory.length;
			const stdDev = Math.sqrt(variance);

			// Calculate threshold
			const threshold = avgEnergy + this._options.sensitivity * stdDev;

			// Check for beat
			const now = Date.now();
			const timeSinceLastBeat = now - this._lastBeatTime;

			if (
				instantEnergy > threshold &&
				instantEnergy > this._options.minEnergyThreshold &&
				timeSinceLastBeat > this._options.cooldown
			) {
				// Beat detected!
				this._lastBeatTime = now;
				this._beatCount++;

				// Calculate beat strength and confidence
				const beatStrength = (instantEnergy - avgEnergy) / (stdDev + 0.0001);
				const confidence = Math.min(instantEnergy / (threshold + 0.0001), 1.0);

				const beatEvent: BeatEvent = {
					timestamp: now,
					strength: beatStrength,
					energy: instantEnergy,
					avgEnergy: avgEnergy,
					confidence: confidence
				};

				this._emitEvent('beat', beatEvent);
			}
		}

		// Continue detection loop
		this._animationFrameId = requestAnimationFrame(() => this._detectBeats());
	}

	/**
	 * Emit an event
	 */
	private _emitEvent(type: BeatDetectorEventType, data?: any): void {
		const callbacks = this._eventCallbacks.get(type);
		if (callbacks) {
			const event: BeatDetectorEvent = {
				type,
				data,
				timestamp: Date.now()
			};

			callbacks.forEach(callback => {
				try {
					callback(event);
				} catch (error) {
					console.error('BeatDetector event callback error:', error);
				}
			});
		}
	}
}

