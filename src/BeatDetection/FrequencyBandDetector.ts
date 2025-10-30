/**
 * FrequencyBandDetector - Multi-band beat detection
 * Analyzes multiple frequency bands for comprehensive rhythm tracking
 */

import type { BeatEvent, BeatDetectionAlgorithm, BeatDetectorOptions } from '../types.js';
import {
	IBeatDetectionAlgorithm,
	FrequencyAnalysisUtils,
	StatisticalUtils,
	CircularBuffer,
	BPMEstimator,
} from './BeatDetectorCore.js';

interface BandEnergy {
	subBass: number;
	bass: number;
	lowMid: number;
	mid: number;
}

export class FrequencyBandDetector implements IBeatDetectionAlgorithm {
	private audioContext: AudioContext | null = null;
	private analyserNode: AnalyserNode | null = null;
	private options!: Required<BeatDetectorOptions>;

	private bandHistories: {
		subBass: CircularBuffer<number>;
		bass: CircularBuffer<number>;
		lowMid: CircularBuffer<number>;
		mid: CircularBuffer<number>;
	};

	private lastBeatTime: number = 0;
	private lastBandEnergies: BandEnergy | null = null;
	private bpmEstimator: BPMEstimator;

	// Band weights (configurable for different music types)
	private readonly bandWeights = {
		subBass: 0.3,
		bass: 0.5,
		lowMid: 0.15,
		mid: 0.05,
	};

	constructor() {
		const historySize = 43;
		this.bandHistories = {
			subBass: new CircularBuffer(historySize),
			bass: new CircularBuffer(historySize),
			lowMid: new CircularBuffer(historySize),
			mid: new CircularBuffer(historySize),
		};
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
		this.bandHistories.subBass.clear();
		this.bandHistories.bass.clear();
		this.bandHistories.lowMid.clear();
		this.bandHistories.mid.clear();
		this.lastBeatTime = 0;
		this.lastBandEnergies = null;
		this.bpmEstimator.reset();
	}

	setSensitivity(value: number): void {
		this.options.sensitivity = Math.max(0.5, Math.min(5.0, value));
	}

	getAlgorithmType(): BeatDetectionAlgorithm {
		return 'frequency-band';
	}

	getMetrics() {
		const bassHistory = this.bandHistories.bass.getAll();
		const currentEnergy = this.lastBandEnergies
			? this.calculateWeightedEnergy(this.lastBandEnergies)
			: 0;

		return {
			avgEnergy: bassHistory.length > 0 ? StatisticalUtils.mean(bassHistory) : 0,
			currentEnergy,
			bands: this.lastBandEnergies,
		};
	}

	private getBandEnergies(): BandEnergy {
		if (!this.analyserNode || !this.audioContext) {
			return { subBass: 0, bass: 0, lowMid: 0, mid: 0 };
		}

		const frequencyData = FrequencyAnalysisUtils.getFrequencyData(this.analyserNode);
		const sampleRate = this.audioContext.sampleRate;
		const fftSize = this.analyserNode.fftSize;

		return {
			subBass: FrequencyAnalysisUtils.getEnergyInRange(frequencyData, sampleRate, fftSize, 20, 60),
			bass: FrequencyAnalysisUtils.getEnergyInRange(frequencyData, sampleRate, fftSize, 60, 180),
			lowMid: FrequencyAnalysisUtils.getEnergyInRange(frequencyData, sampleRate, fftSize, 180, 500),
			mid: FrequencyAnalysisUtils.getEnergyInRange(frequencyData, sampleRate, fftSize, 500, 2000),
		};
	}

	private calculateWeightedEnergy(bands: BandEnergy): number {
		return (
			bands.subBass * this.bandWeights.subBass +
			bands.bass * this.bandWeights.bass +
			bands.lowMid * this.bandWeights.lowMid +
			bands.mid * this.bandWeights.mid
		);
	}

	detectBeat(timestamp: number): BeatEvent | null {
		if (!this.analyserNode) return null;

		// Get energy in each band
		const currentBands = this.getBandEnergies();
		const weightedEnergy = this.calculateWeightedEnergy(currentBands);

		// Add to histories
		this.bandHistories.subBass.push(currentBands.subBass);
		this.bandHistories.bass.push(currentBands.bass);
		this.bandHistories.lowMid.push(currentBands.lowMid);
		this.bandHistories.mid.push(currentBands.mid);

		// Need minimum history
		if (this.bandHistories.bass.length < 10) {
			this.lastBandEnergies = currentBands;
			return null;
		}

		// Calculate adaptive thresholds for each band
		const bassHistory = this.bandHistories.bass.getLast(15);
		const { threshold, mean: avgEnergy, stdDev } = StatisticalUtils.getAdaptiveThreshold(
			bassHistory,
			this.options.sensitivity
		);

		// Check cooldown
		const timeSinceLastBeat = timestamp - this.lastBeatTime;
		const isInCooldown = timeSinceLastBeat < this.options.cooldown;

		// Detect energy jump in primary bands (bass + sub-bass)
		let hasOnset = false;
		let onsetStrength = 0;

		if (!isInCooldown && this.lastBandEnergies) {
			// Check for significant increases in bass frequencies
			const bassJump = currentBands.bass - this.lastBandEnergies.bass;
			const subBassJump = currentBands.subBass - this.lastBandEnergies.subBass;

			const bassThreshold = stdDev * 1.5;
			const hasSignificantJump = bassJump > bassThreshold || subBassJump > bassThreshold * 0.8;
			const aboveAverage = currentBands.bass > avgEnergy + stdDev;
			const aboveMinThreshold = weightedEnergy > this.options.minEnergyThreshold;

			if (hasSignificantJump && aboveAverage && aboveMinThreshold) {
				hasOnset = true;
				onsetStrength = (weightedEnergy - avgEnergy) / (stdDev + 0.0001);
			}
		}

		if (hasOnset) {
			const confidence = Math.min(1, onsetStrength / 5);
			const bpm = this.bpmEstimator.addBeat(timestamp);

			this.lastBeatTime = timestamp;
			this.lastBandEnergies = currentBands;

			return {
				timestamp,
				strength: onsetStrength,
				energy: weightedEnergy,
				avgEnergy,
				confidence,
				algorithm: 'frequency-band',
				bpm: bpm ?? undefined,
			};
		}

		this.lastBandEnergies = currentBands;
		return null;
	}
}

