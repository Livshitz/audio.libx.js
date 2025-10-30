/**
 * EnergyBasedDetector - Enhanced energy-based beat detection algorithm
 * Detects beats by analyzing energy peaks in bass frequencies with adaptive thresholding
 */

import type { BeatEvent, BeatDetectionAlgorithm, BeatDetectorOptions } from '../types.js';
import {
	IBeatDetectionAlgorithm,
	FrequencyAnalysisUtils,
	StatisticalUtils,
	CircularBuffer,
	BPMEstimator,
} from './BeatDetectorCore.js';

export class EnergyBasedDetector implements IBeatDetectionAlgorithm {
	private audioContext: AudioContext | null = null;
	private analyserNode: AnalyserNode | null = null;
	private options!: Required<BeatDetectorOptions>;

	private energyHistory: CircularBuffer<number>;
	private lastBeatTime: number = 0;
	private lastEnergy: number = 0;
	private bpmEstimator: BPMEstimator;

	// Peak detection state
	private isPeakMode: boolean = false;
	private peakStartTime: number = 0;
	private peakWindow: number[] = [];

	constructor() {
		this.energyHistory = new CircularBuffer(43);
		this.bpmEstimator = new BPMEstimator();
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
		this.lastBeatTime = 0;
		this.lastEnergy = 0;
		this.isPeakMode = false;
		this.peakStartTime = 0;
		this.peakWindow = [];
		this.bpmEstimator.reset();
	}

	setSensitivity(value: number): void {
		this.options.sensitivity = Math.max(0.5, Math.min(5.0, value));
	}

	getAlgorithmType(): BeatDetectionAlgorithm {
		return 'energy';
	}

	getMetrics() {
		const all = this.energyHistory.getAll();
		return {
			avgEnergy: all.length > 0 ? StatisticalUtils.mean(all) : 0,
			currentEnergy: this.lastEnergy,
			threshold: all.length > 0 ? StatisticalUtils.getAdaptiveThreshold(all, this.options.sensitivity).threshold : 0,
			peakMode: this.isPeakMode,
		};
	}

	detectBeat(timestamp: number): BeatEvent | null {
		if (!this.analyserNode) return null;

		// Get frequency data
		const frequencyData = FrequencyAnalysisUtils.getFrequencyData(this.analyserNode);

		// Calculate instant energy for bass frequencies
		const instantEnergy = FrequencyAnalysisUtils.getEnergyInNormalizedRange(
			frequencyData,
			this.options.frequencyRangeLow,
			this.options.frequencyRangeHigh
		);

		// Add to history
		this.energyHistory.push(instantEnergy);

		// Need minimum history for detection
		if (this.energyHistory.length < 10) {
			this.lastEnergy = instantEnergy;
			return null;
		}

		// Calculate adaptive threshold using longer window to avoid threshold drift
		// Use a window that's long enough to smooth out beat spikes but responsive to changes
		const historyWindowSize = Math.min(30, this.energyHistory.length); // ~0.5s at 60fps
		const recentHistory = this.energyHistory.getLast(historyWindowSize);

		// Calculate baseline from lower percentile to avoid beat spikes raising the threshold
		const sortedHistory = [...recentHistory].sort((a, b) => a - b);
		const medianIndex = Math.floor(sortedHistory.length * 0.5); // Use median instead of mean
		const avgEnergy = sortedHistory[medianIndex];

		// Calculate standard deviation for dynamic thresholding
		const variance = recentHistory.reduce((sum, e) => sum + (e - avgEnergy) ** 2, 0) / recentHistory.length;
		const stdDev = Math.sqrt(variance);

		// Check cooldown
		const timeSinceLastBeat = timestamp - this.lastBeatTime;
		const isInCooldown = timeSinceLastBeat < this.options.cooldown;

		// Detect energy increase
		const energyJump = instantEnergy - this.lastEnergy;
		const isEnergyRising = energyJump > 0;
		const energyAboveAvg = instantEnergy - avgEnergy;

		// More lenient onset thresholds to catch more beats
		const onsetThreshold = Math.max(0.08, stdDev * 1.0); // Lowered from 1.5
		const avgEnergyThreshold = Math.max(stdDev * 1.2, 0.05); // Lowered from 2.0

		// State machine: idle -> detecting peak -> cooldown
		if (!this.isPeakMode && !isInCooldown) {
			// More lenient onset detection
			const hasSharpOnset = isEnergyRising && energyJump > onsetThreshold;
			const wellAboveAverage = energyAboveAvg > avgEnergyThreshold;
			const aboveMinEnergy = instantEnergy > this.options.minEnergyThreshold;

			// Simpler detection: strong onset OR significantly above average
			const strongOnset = hasSharpOnset && aboveMinEnergy;
			const strongPeak = wellAboveAverage && instantEnergy > (avgEnergy + stdDev * this.options.sensitivity);

			if (strongOnset || strongPeak) {
				// Enter peak detection mode
				this.isPeakMode = true;
				this.peakStartTime = timestamp;
				this.peakWindow = [instantEnergy];
			}
		} else if (this.isPeakMode) {
			// In peak detection mode - wait for energy to stop rising
			const peakTimeout = timestamp - this.peakStartTime > 200; // Max 200ms to find peak
			this.peakWindow.push(instantEnergy);

			// Check if energy is falling
			const energyFalling =
				!isEnergyRising &&
				this.peakWindow.length >= 3 &&
				this.peakWindow[this.peakWindow.length - 1] < this.peakWindow[this.peakWindow.length - 2];

			if (energyFalling || peakTimeout) {
				// Found peak - trigger beat
				const peakEnergy = Math.max(...this.peakWindow);
				const beatStrength = (peakEnergy - avgEnergy) / (stdDev + 0.0001);

				// More lenient beat strength threshold
				if (beatStrength >= 1.3) { // Lowered from 1.7
					const confidence = Math.min(1, beatStrength / 5);
					const bpm = this.bpmEstimator.addBeat(timestamp);

					this.lastBeatTime = timestamp;
					this.isPeakMode = false;
					this.peakWindow = [];
					this.lastEnergy = instantEnergy;

					return {
						timestamp,
						strength: beatStrength,
						energy: peakEnergy,
						avgEnergy,
						confidence,
						algorithm: 'energy',
						bpm: bpm ?? undefined,
					};
				}

				// Reset peak detection
				this.isPeakMode = false;
				this.peakWindow = [];
			}
		}

		this.lastEnergy = instantEnergy;
		return null;
	}
}

