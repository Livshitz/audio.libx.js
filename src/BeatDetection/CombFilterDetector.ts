/**
 * CombFilterDetector - BPM-locked beat detection using autocorrelation
 * Estimates tempo and locks onto detected BPM for predictive beat tracking
 */

import type { BeatEvent, BeatDetectionAlgorithm, BeatDetectorOptions } from '../types.js';
import {
	IBeatDetectionAlgorithm,
	FrequencyAnalysisUtils,
	StatisticalUtils,
	CircularBuffer,
} from './BeatDetectorCore.js';

export class CombFilterDetector implements IBeatDetectionAlgorithm {
	private audioContext: AudioContext | null = null;
	private analyserNode: AnalyserNode | null = null;
	private options!: Required<BeatDetectorOptions>;

	private energyHistory: CircularBuffer<number>;
	private beatIntervals: CircularBuffer<number>;
	private lastBeatTime: number = 0;
	private estimatedBPM: number | null = null;
	private expectedNextBeat: number = 0;
	private confidenceLevel: number = 0;

	// Autocorrelation parameters
	private readonly minBPM = 60;
	private readonly maxBPM = 200;
	private readonly autocorrelationWindowSize = 256; // ~5 seconds at 60fps

	constructor() {
		this.energyHistory = new CircularBuffer(this.autocorrelationWindowSize);
		this.beatIntervals = new CircularBuffer(8);
	}

	initialize(
		audioContext: AudioContext,
		analyserNode: AnalyserNode,
		options: Required<BeatDetectorOptions>
	): void {
		this.audioContext = audioContext;
		this.analyserNode = analyserNode;
		this.options = options;
		this.reset();
	}

	reset(): void {
		this.energyHistory.clear();
		this.beatIntervals.clear();
		this.lastBeatTime = 0;
		this.estimatedBPM = null;
		this.expectedNextBeat = 0;
		this.confidenceLevel = 0;
	}

	setSensitivity(value: number): void {
		this.options.sensitivity = Math.max(0.5, Math.min(5.0, value));
	}

	getAlgorithmType(): BeatDetectionAlgorithm {
		return 'comb-filter';
	}

	getMetrics() {
		const all = this.energyHistory.getAll();
		return {
			avgEnergy: all.length > 0 ? StatisticalUtils.mean(all) : 0,
			currentEnergy: all.length > 0 ? all[all.length - 1] : 0,
			estimatedBPM: this.estimatedBPM,
			confidence: this.confidenceLevel,
		};
	}

	private calculateEnergy(): number {
		if (!this.analyserNode) return 0;

		const frequencyData = FrequencyAnalysisUtils.getFrequencyData(this.analyserNode);
		return FrequencyAnalysisUtils.getEnergyInNormalizedRange(
			frequencyData,
			this.options.frequencyRangeLow,
			this.options.frequencyRangeHigh
		);
	}

	private performAutocorrelation(): number | null {
		const energies = this.energyHistory.getAll();
		if (energies.length < 64) return null;

		const maxLag = Math.min(energies.length / 2, 180); // Max ~3 seconds
		const minLag = Math.floor((60000 / this.maxBPM) / 16.67); // Min lag for max BPM (assuming ~60fps)

		let bestLag = 0;
		let bestCorrelation = -Infinity;

		// Calculate autocorrelation for different lags
		for (let lag = minLag; lag < maxLag; lag++) {
			let correlation = 0;
			let count = 0;

			for (let i = 0; i < energies.length - lag; i++) {
				correlation += energies[i] * energies[i + lag];
				count++;
			}

			if (count > 0) {
				correlation /= count;
				if (correlation > bestCorrelation) {
					bestCorrelation = correlation;
					bestLag = lag;
				}
			}
		}

		// Convert lag to BPM (assuming ~60 fps)
		const intervalMs = bestLag * 16.67; // Approximate frame time
		const bpm = 60000 / intervalMs;

		// Validate BPM range
		if (bpm >= this.minBPM && bpm <= this.maxBPM) {
			return bpm;
		}

		return null;
	}

	private updateBPMEstimate(newBPM: number): void {
		if (!this.estimatedBPM) {
			this.estimatedBPM = newBPM;
			this.confidenceLevel = 0.3;
		} else {
			// Smooth BPM changes
			const diff = Math.abs(newBPM - this.estimatedBPM);
			if (diff < 5) {
				// Close match - increase confidence and smooth
				this.estimatedBPM = this.estimatedBPM * 0.9 + newBPM * 0.1;
				this.confidenceLevel = Math.min(1, this.confidenceLevel + 0.1);
			} else if (diff < 10) {
				// Moderate match - slight adjustment
				this.estimatedBPM = this.estimatedBPM * 0.95 + newBPM * 0.05;
			} else {
				// Large difference - decrease confidence
				this.confidenceLevel = Math.max(0, this.confidenceLevel - 0.2);
			}
		}
	}

	detectBeat(timestamp: number): BeatEvent | null {
		if (!this.analyserNode) return null;

		// Calculate current energy
		const energy = this.calculateEnergy();
		this.energyHistory.push(energy);

		// Need minimum history
		if (this.energyHistory.length < 20) return null;

		// Periodically update BPM estimate via autocorrelation
		if (this.energyHistory.length % 30 === 0) {
			const detectedBPM = this.performAutocorrelation();
			if (detectedBPM) {
				this.updateBPMEstimate(detectedBPM);
			}
		}

		// If we have a BPM estimate, use predictive detection
		if (this.estimatedBPM && this.confidenceLevel > 0.3) {
			const beatInterval = 60000 / this.estimatedBPM;
			const timeSinceLastBeat = timestamp - this.lastBeatTime;

			// Check if we're near expected beat time
			const timeToNextBeat = beatInterval - timeSinceLastBeat;
			const isNearExpectedBeat = Math.abs(timeToNextBeat) < beatInterval * 0.2; // Within 20% window

			if (isNearExpectedBeat) {
				// Look for energy peak
				const recentEnergies = this.energyHistory.getLast(5);
				const { threshold, mean: avgEnergy } = StatisticalUtils.getAdaptiveThreshold(
					this.energyHistory.getLast(30),
					this.options.sensitivity
				);

				const currentIsPeak =
					recentEnergies.length >= 3 &&
					energy > recentEnergies[recentEnergies.length - 2] &&
					energy >= recentEnergies[recentEnergies.length - 3];

				if (currentIsPeak && energy > threshold) {
					const strength = (energy - avgEnergy) / (avgEnergy + 0.0001);

					this.lastBeatTime = timestamp;
					this.expectedNextBeat = timestamp + beatInterval;

					// Update intervals for BPM refinement
					if (this.beatIntervals.length > 0) {
						this.beatIntervals.push(timeSinceLastBeat);
					}

					return {
						timestamp,
						strength,
						energy,
						avgEnergy,
						confidence: this.confidenceLevel,
						algorithm: 'comb-filter',
						bpm: Math.round(this.estimatedBPM),
					};
				}
			}
		} else {
			// Fallback to simple onset detection when BPM not locked
			const recentHistory = this.energyHistory.getLast(Math.min(15, this.energyHistory.length));
			const { threshold, mean: avgEnergy } = StatisticalUtils.getAdaptiveThreshold(
				recentHistory,
				this.options.sensitivity * 1.2 // Slightly higher sensitivity for initial detection
			);

			const timeSinceLastBeat = timestamp - this.lastBeatTime;
			const isInCooldown = timeSinceLastBeat < this.options.cooldown;

			if (!isInCooldown && energy > threshold && energy > this.options.minEnergyThreshold) {
				const strength = (energy - avgEnergy) / (avgEnergy + 0.0001);

				if (this.lastBeatTime > 0) {
					this.beatIntervals.push(timeSinceLastBeat);
				}

				this.lastBeatTime = timestamp;

				return {
					timestamp,
					strength,
					energy,
					avgEnergy,
					confidence: 0.5, // Lower confidence without BPM lock
					algorithm: 'comb-filter',
					bpm: this.estimatedBPM ? Math.round(this.estimatedBPM) : undefined,
				};
			}
		}

		return null;
	}
}

