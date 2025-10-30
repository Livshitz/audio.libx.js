/**
 * BeatDetector - Main beat detection orchestrator with multiple algorithms
 * Real-time beat detection for audio playback with algorithm switching
 */

import {
	BeatDetectorOptions,
	BeatDetectorState,
	BeatEvent,
	BeatDetectorEventType,
	BeatDetectorEventCallback,
	BeatDetectionError,
	BeatDetectionAlgorithm,
} from './types.js';

import { IBeatDetectionAlgorithm } from './BeatDetection/BeatDetectorCore.js';
import { EnergyBasedDetector } from './BeatDetection/EnergyBasedDetector.js';
import { SpectralFluxDetector } from './BeatDetection/SpectralFluxDetector.js';
import { FrequencyBandDetector } from './BeatDetection/FrequencyBandDetector.js';
import { CombFilterDetector } from './BeatDetection/CombFilterDetector.js';

export class BeatDetector {
	private _audioContext: AudioContext | null = null;
	private _analyserNode: AnalyserNode | null = null;
	private _sourceNode: MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null = null;
	private _options: Required<BeatDetectorOptions>;
	private _state: BeatDetectorState;
	private _eventCallbacks: Map<BeatDetectorEventType, BeatDetectorEventCallback[]> = new Map();
	private _animationFrameId: number | null = null;
	private _isConnected: boolean = false;

	// Algorithm management
	private _currentAlgorithm: IBeatDetectionAlgorithm;
	private _algorithms: Map<BeatDetectionAlgorithm, IBeatDetectionAlgorithm>;

	constructor(options: BeatDetectorOptions = {}) {
		this._options = {
			algorithm: options.algorithm ?? 'energy',
			sensitivity: options.sensitivity ?? 2.0,
			cooldown: options.cooldown ?? 200,
			frequencyRangeLow: options.frequencyRangeLow ?? 0,
			frequencyRangeHigh: options.frequencyRangeHigh ?? 0.15,
			energyHistorySize: options.energyHistorySize ?? 43,
			minEnergyThreshold: options.minEnergyThreshold ?? 0.01,
			fftSize: options.fftSize ?? 1024,
			smoothingTimeConstant: options.smoothingTimeConstant ?? 0.8,
		};

		// Initialize all algorithms
		this._algorithms = new Map<BeatDetectionAlgorithm, IBeatDetectionAlgorithm>();
		this._algorithms.set('energy', new EnergyBasedDetector());
		this._algorithms.set('spectral-flux', new SpectralFluxDetector());
		this._algorithms.set('frequency-band', new FrequencyBandDetector());
		this._algorithms.set('comb-filter', new CombFilterDetector());

		this._currentAlgorithm = this._algorithms.get(this._options.algorithm)!;

		this._state = {
			isRunning: false,
			algorithm: this._options.algorithm,
			lastBeatTime: null,
			avgEnergy: 0,
			currentEnergy: 0,
			beatCount: 0,
			estimatedBPM: null,
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
			this._analyserNode.smoothingTimeConstant = Math.min(0.5, this._options.smoothingTimeConstant);

			this._sourceNode = this._audioContext.createMediaElementSource(audioElement);
			this._sourceNode.connect(this._analyserNode);
			this._analyserNode.connect(this._audioContext.destination);

			this._isConnected = true;

			// Initialize current algorithm
			this._currentAlgorithm.initialize(this._audioContext, this._analyserNode, this._options);

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
			this._analyserNode.smoothingTimeConstant = Math.min(0.5, this._options.smoothingTimeConstant);

			this._sourceNode = this._audioContext.createMediaStreamSource(stream);
			this._sourceNode.connect(this._analyserNode);

			this._isConnected = true;

			// Initialize current algorithm
			this._currentAlgorithm.initialize(this._audioContext, this._analyserNode, this._options);

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
		this._state.beatCount = 0;
		this._currentAlgorithm.reset();

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
	 * Set detection algorithm
	 */
	public setAlgorithm(algorithm: BeatDetectionAlgorithm): void {
		if (!this._algorithms.has(algorithm)) {
			throw new BeatDetectionError(`Unknown algorithm: ${algorithm}`);
		}

		const wasRunning = this._state.isRunning;
		if (wasRunning) {
			this.stop();
		}

		this._currentAlgorithm = this._algorithms.get(algorithm)!;
		this._options.algorithm = algorithm;
		this._state.algorithm = algorithm;

		if (this._isConnected && this._audioContext && this._analyserNode) {
			this._currentAlgorithm.initialize(this._audioContext, this._analyserNode, this._options);
		}

		if (wasRunning) {
			this.start();
		}
	}

	/**
	 * Get current algorithm
	 */
	public getAlgorithm(): BeatDetectionAlgorithm {
		return this._state.algorithm;
	}

	/**
	 * Get list of available algorithms
	 */
	public getAvailableAlgorithms(): BeatDetectionAlgorithm[] {
		return Array.from(this._algorithms.keys());
	}

	/**
	 * Set sensitivity (0.5-5.0)
	 */
	public setSensitivity(value: number): void {
		this._options.sensitivity = Math.max(0.5, Math.min(5.0, value));
		this._state.config.sensitivity = this._options.sensitivity;
		this._currentAlgorithm.setSensitivity(value);
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
	 * Get the analyser node (for visualization purposes)
	 */
	public getAnalyserNode(): AnalyserNode | null {
		return this._analyserNode;
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

		const timestamp = performance.now();
		const beatEvent = this._currentAlgorithm.detectBeat(timestamp);

		if (beatEvent) {
			this._state.lastBeatTime = beatEvent.timestamp;
			this._state.beatCount++;
			this._state.estimatedBPM = beatEvent.bpm ?? this._state.estimatedBPM;
			this._emitEvent('beat', beatEvent);

			// Emit BPM update if changed
			if (beatEvent.bpm) {
				this._emitEvent('bpm-updated', { bpm: beatEvent.bpm });
			}
		}

		// Update current metrics
		const metrics = this._currentAlgorithm.getMetrics();
		this._state.avgEnergy = metrics.avgEnergy;
		this._state.currentEnergy = metrics.currentEnergy;
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

