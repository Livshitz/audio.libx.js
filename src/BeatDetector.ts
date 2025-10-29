/**
 * BeatDetector - Real-time beat detection for audio playback
 * Uses spectral flux onset detection with multi-band analysis
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
	private _animationFrameId: number | null = null;
	private _isConnected: boolean = false;
	private _debugMode: boolean = false;

	// Spectral flux tracking
	private _previousSpectrum: Float32Array | null = null;
	private _fluxHistory: number[] = [];
	private _lastBeatTime: number = 0;

	// Multi-band energy tracking
	private _bassEnergy: number = 0;
	private _midEnergy: number = 0;
	private _totalEnergy: number = 0;

	constructor(options: BeatDetectorOptions = {}) {
		this._options = {
			sensitivity: options.sensitivity ?? 2.0,
			cooldown: options.cooldown ?? 200,
			frequencyRangeLow: options.frequencyRangeLow ?? 0,
			frequencyRangeHigh: options.frequencyRangeHigh ?? 0.15,
			energyHistorySize: options.energyHistorySize ?? 43,
			minEnergyThreshold: options.minEnergyThreshold ?? 0.01,
			fftSize: options.fftSize ?? 2048, // Larger FFT for better frequency resolution
			smoothingTimeConstant: options.smoothingTimeConstant ?? 0.3, // Lower smoothing for more responsive detection
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
		this._previousSpectrum = null;
		this._fluxHistory = [];
		this._lastBeatTime = 0;
		this._state.beatCount = 0;
		this._bassEnergy = 0;
		this._midEnergy = 0;
		this._totalEnergy = 0;

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
	 * Enable debug logging
	 */
	public setDebugMode(enabled: boolean): void {
		this._debugMode = enabled;
		console.log(`[BeatDetector] Debug mode ${enabled ? 'enabled' : 'disabled'}`);
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
		this._previousSpectrum = null;
		this._fluxHistory = [];
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
	 * Calculate spectral flux (change in frequency spectrum)
	 */
	private _calculateSpectralFlux(currentSpectrum: Float32Array, previousSpectrum: Float32Array): number {
		let flux = 0;
		const binCount = Math.min(currentSpectrum.length, previousSpectrum.length);

		for (let i = 0; i < binCount; i++) {
			const diff = currentSpectrum[i] - previousSpectrum[i];
			// Only count positive changes (energy increases)
			if (diff > 0) {
				flux += diff;
			}
		}

		return flux / binCount;
	}

	/**
	 * Calculate multi-band energy
	 * frequencyData contains dB values (typically -100 to 0)
	 */
	private _calculateMultiBandEnergy(frequencyData: Float32Array, sampleRate: number): { bass: number; mid: number; total: number } {
		const binCount = frequencyData.length;
		const nyquist = sampleRate / 2;
		const binSize = nyquist / binCount;

		// Frequency ranges
		const bassEndHz = 150;
		const midStartHz = 150;
		const midEndHz = 2000;

		const bassEndBin = Math.min(binCount, Math.floor(bassEndHz / binSize));
		const midStartBin = Math.min(binCount, Math.floor(midStartHz / binSize));
		const midEndBin = Math.min(binCount, Math.floor(midEndHz / binSize));

		let bassEnergy = 0;
		let midEnergy = 0;
		let totalEnergy = 0;

		for (let i = 0; i < binCount; i++) {
			// Convert dB to linear scale for energy calculation
			// dB values are negative, so we add 100 to shift to positive range
			const magnitude = frequencyData[i] + 100;
			totalEnergy += magnitude;

			if (i < bassEndBin && bassEndBin > 0) {
				bassEnergy += magnitude;
			} else if (i >= midStartBin && i < midEndBin && midEndBin > midStartBin) {
				midEnergy += magnitude;
			}
		}

		return {
			bass: bassEndBin > 0 ? bassEnergy / bassEndBin : 0,
			mid: (midEndBin > midStartBin) ? midEnergy / (midEndBin - midStartBin) : 0,
			total: totalEnergy / binCount,
		};
	}

	/**
	 * Beat detection loop using spectral flux and multi-band analysis
	 */
	private _detectLoop = (): void => {
		if (!this._state.isRunning) return;

		this._animationFrameId = requestAnimationFrame(this._detectLoop);

		if (!this._analyserNode || !this._audioContext) return;

		// Get frequency data as Float32Array (values are in dB, typically -100 to 0)
		const frequencyData = new Float32Array(this._analyserNode.frequencyBinCount);
		this._analyserNode.getFloatFrequencyData(frequencyData);

		const sampleRate = this._audioContext.sampleRate;

		// Calculate multi-band energy (convert dB to linear scale for processing)
		const bandEnergy = this._calculateMultiBandEnergy(frequencyData, sampleRate);
		this._bassEnergy = bandEnergy.bass;
		this._midEnergy = bandEnergy.mid;
		this._totalEnergy = bandEnergy.total;

		// Combined energy (weighted: bass is more important for beat detection)
		const combinedEnergy = (this._bassEnergy * 0.6) + (this._midEnergy * 0.4);
		// Normalize energy (dB values are negative, so we normalize to 0-1 range)
		this._state.currentEnergy = Math.max(0, Math.min(1, (combinedEnergy + 100) / 100));

		// Calculate spectral flux
		let spectralFlux = 0;
		if (this._previousSpectrum) {
			spectralFlux = this._calculateSpectralFlux(frequencyData, this._previousSpectrum);
		}

		// Store current spectrum for next iteration
		this._previousSpectrum = new Float32Array(frequencyData);

		// Need previous spectrum to calculate flux
		if (!this._previousSpectrum || spectralFlux === 0) return;

		// Maintain flux history for adaptive thresholding
		this._fluxHistory.push(spectralFlux);
		if (this._fluxHistory.length > this._options.energyHistorySize) {
			this._fluxHistory.shift();
		}

		// Need minimum history for detection
		if (this._fluxHistory.length < 10) return;

		// Calculate adaptive threshold
		const recentHistory = this._fluxHistory.slice(-Math.min(20, this._fluxHistory.length));
		const avgFlux = recentHistory.reduce((a, b) => a + b, 0) / recentHistory.length;
		const variance = recentHistory.reduce((sum, f) => sum + (f - avgFlux) ** 2, 0) / recentHistory.length;
		const stdDev = Math.sqrt(variance);
		const threshold = avgFlux + (this._options.sensitivity * stdDev);

		this._state.avgEnergy = avgFlux;

		const now = performance.now();
		const timeSinceLastBeat = now - this._lastBeatTime;

		// Beat detection conditions
		const fluxAboveThreshold = spectralFlux > threshold;
		// minEnergyThreshold is 0-1, combinedEnergy is already normalized
		const energyAboveMinimum = this._state.currentEnergy > this._options.minEnergyThreshold;
		const outsideCooldown = timeSinceLastBeat > this._options.cooldown;
		const significantIncrease = spectralFlux > avgFlux + (stdDev * 0.5); // Significant flux increase

		if (fluxAboveThreshold && energyAboveMinimum && outsideCooldown && significantIncrease) {
			// Calculate beat strength and confidence
			const fluxStrength = (spectralFlux - avgFlux) / (stdDev + 0.001);
			const beatStrength = Math.min(5, fluxStrength);
			const confidence = Math.min(1, beatStrength / 3);

			const beatEvent: BeatEvent = {
				timestamp: now,
				strength: beatStrength,
				energy: this._state.currentEnergy,
				avgEnergy: avgFlux,
				confidence: confidence,
			};

			this._lastBeatTime = now;
			this._state.lastBeatTime = now;
			this._state.beatCount++;

			if (this._debugMode) {
				console.log('[BeatDetector] BEAT', {
					flux: spectralFlux.toFixed(4),
					threshold: threshold.toFixed(4),
					strength: beatStrength.toFixed(2),
					bassEnergy: this._bassEnergy.toFixed(2),
					midEnergy: this._midEnergy.toFixed(2),
				});
			}

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