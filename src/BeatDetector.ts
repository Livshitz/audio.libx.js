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
	private _lastEnergy: number = 0;
	private _peakDetectionWindow: number[] = [];
	private _isPeakMode: boolean = false;
	private _debugMode: boolean = false;
	private _debugLogCounter: number = 0;
	private _peakStartTime: number = 0;
	private _beatIntervals: number[] = [];  // Track time between beats for tempo
	private _estimatedBPM: number = 0;
	private _expectedNextBeat: number = 0;

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
			// Reduced smoothing for more responsive beat detection
			this._analyserNode.smoothingTimeConstant = Math.min(0.5, this._options.smoothingTimeConstant);

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
			// Reduced smoothing for more responsive beat detection
			this._analyserNode.smoothingTimeConstant = Math.min(0.5, this._options.smoothingTimeConstant);

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
		this._lastEnergy = 0;
		this._peakDetectionWindow = [];
		this._isPeakMode = false;
		this._peakStartTime = 0;
		this._beatIntervals = [];
		this._estimatedBPM = 0;
		this._expectedNextBeat = 0;

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

		// Need minimum history for detection (reduced from full buffer)
		if (this._energyHistory.length < Math.min(10, this._options.energyHistorySize)) return;

		// Calculate adaptive threshold using very recent history for fast adaptation
		const recentHistorySize = Math.min(15, this._energyHistory.length);
		const recentHistory = this._energyHistory.slice(-recentHistorySize);
		const avgEnergy = recentHistory.reduce((a, b) => a + b) / recentHistory.length;
		const variance = recentHistory.reduce((sum, e) => sum + (e - avgEnergy) ** 2, 0) / recentHistory.length;
		const stdDev = Math.sqrt(variance);

		// Cap sensitivity to prevent over-detection
		const effectiveSensitivity = Math.min(this._options.sensitivity, 2.0);
		const threshold = avgEnergy + (effectiveSensitivity * stdDev * 0.85);

		this._state.avgEnergy = avgEnergy;

		// Detect energy increase (potential beat onset)
		const energyIncrease = instantEnergy - this._lastEnergy;
		const isEnergyRising = energyIncrease > 0;

		const now = performance.now();
		const timeSinceLastBeat = now - this._lastBeatTime;

		// Debug logging (every 30 frames when enabled)
		if (this._debugMode) {
			this._debugLogCounter++;
			if (this._debugLogCounter % 30 === 0) {
				console.log('[BeatDetector Debug]', {
					instantEnergy: instantEnergy.toFixed(4),
					avgEnergy: avgEnergy.toFixed(4),
					threshold: threshold.toFixed(4),
					stdDev: stdDev.toFixed(4),
					isRising: isEnergyRising,
					isPeakMode: this._isPeakMode,
					timeSinceBeat: timeSinceLastBeat.toFixed(0) + 'ms',
				});
			}
		}

		// Simplified beat detection: focus on strong, clear onsets
		const energyJump = instantEnergy - this._lastEnergy;
		const energyAboveAvg = instantEnergy - avgEnergy;

		// Adaptive onset threshold: must be a VERY sharp rise
		// Scale with stdDev but enforce a high minimum to avoid false positives
		const onsetThreshold = Math.max(0.12, stdDev * 1.5);

		// Must be significantly above average energy
		const avgEnergyThreshold = Math.max(stdDev * 2.0, 0.08);

		// Track peak detection window
		this._peakDetectionWindow.push(instantEnergy);
		if (this._peakDetectionWindow.length > 4) {
			this._peakDetectionWindow.shift();
		}

		// State machine: idle -> detecting peak -> cooldown
		if (!this._isPeakMode) {
			// Strict onset requirements to reduce false positives
			const hasSharpOnset = isEnergyRising && energyJump > onsetThreshold;
			const wellAboveAverage = energyAboveAvg > avgEnergyThreshold;
			const aboveThreshold = instantEnergy > threshold;
			const aboveMinEnergy = instantEnergy > this._options.minEnergyThreshold;
			const outsideCooldown = timeSinceLastBeat > this._options.cooldown;

			// ALL conditions must be met
			const hasOnset = hasSharpOnset && wellAboveAverage && aboveThreshold &&
				aboveMinEnergy && outsideCooldown;

			if (hasOnset) {
				// Enter peak detection mode
				this._isPeakMode = true;
				this._peakStartTime = now;
				this._peakDetectionWindow = [instantEnergy];

				if (this._debugMode) {
					console.log('[BeatDetector] 🎯 Onset detected, finding peak...', {
						energy: instantEnergy.toFixed(4),
						jump: energyJump.toFixed(4),
						onsetThresh: onsetThreshold.toFixed(4),
						aboveAvg: energyAboveAvg.toFixed(4),
						avgThresh: avgEnergyThreshold.toFixed(4),
					});
				}
			}
		} else {
			// In peak detection mode - wait for energy to stop rising or timeout
			const peakTimeout = now - this._peakStartTime > 200; // Max 200ms to find peak (kick drums can have slow attack)
			// Require sustained drop - energy must fall for 2 consecutive frames
			const energyFalling = !isEnergyRising && this._peakDetectionWindow.length >= 3 &&
				this._peakDetectionWindow[this._peakDetectionWindow.length - 1] < this._peakDetectionWindow[this._peakDetectionWindow.length - 2];

			if (energyFalling || peakTimeout) {
				// Found peak - trigger beat at the highest energy point
				const peakEnergy = Math.max(...this._peakDetectionWindow);
				const beatStrength = (peakEnergy - avgEnergy) / (stdDev + 0.0001);
				const confidence = Math.min(1, beatStrength / 5);

				// Additional validation: beat must be strong enough
				// Require moderately strong beats to balance accuracy vs sensitivity
				const isBeatStrong = beatStrength >= 1.7;

				if (isBeatStrong) {
					const beatEvent: BeatEvent = {
						timestamp: now,
						strength: beatStrength,
						energy: peakEnergy,
						avgEnergy: avgEnergy,
						confidence: confidence,
					};

					this._lastBeatTime = now;
					this._state.lastBeatTime = now;
					this._state.beatCount++;

					if (this._debugMode) {
						console.log('[BeatDetector] 🔊 BEAT at peak', {
							peakEnergy: peakEnergy.toFixed(4),
							avgEnergy: avgEnergy.toFixed(4),
							threshold: threshold.toFixed(4),
							strength: beatStrength.toFixed(2),
							peakDelay: (now - this._peakStartTime).toFixed(0) + 'ms',
						});
					}

					this._emitEvent('beat', beatEvent);
				} else if (this._debugMode) {
					console.log('[BeatDetector] ❌ Peak too weak, ignoring', {
						strength: beatStrength.toFixed(2),
						minRequired: '1.5',
					});
				}

				// Reset peak detection
				this._isPeakMode = false;
				this._peakDetectionWindow = [];
			}
		}

		this._lastEnergy = instantEnergy;
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
