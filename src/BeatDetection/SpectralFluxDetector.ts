/**
 * SpectralFluxDetector - Beat detection using spectral flux (onset detection)
 * Tracks changes in frequency spectrum over time to detect note/beat onsets
 */

import type { BeatEvent, BeatDetectionAlgorithm, BeatDetectorOptions } from '../types.js';
import {
	IBeatDetectionAlgorithm,
	FrequencyAnalysisUtils,
	StatisticalUtils,
	CircularBuffer,
	BPMEstimator,
} from './BeatDetectorCore.js';

export class SpectralFluxDetector implements IBeatDetectionAlgorithm {
	private audioContext: AudioContext | null = null;
	private analyserNode: AnalyserNode | null = null;
	private options!: Required<BeatDetectorOptions>;

	private previousSpectrum: Uint8Array | null = null;
	private fluxHistory: CircularBuffer<number>;
	private lastBeatTime: number = 0;
	private lastFlux: number = 0;
	private bpmEstimator: BPMEstimator;

	constructor() {
		this.fluxHistory = new CircularBuffer(43);
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
		this.previousSpectrum = null;
		this.fluxHistory.clear();
		this.lastBeatTime = 0;
		this.lastFlux = 0;
		this.bpmEstimator.reset();
	}

	setSensitivity(value: number): void {
		this.options.sensitivity = Math.max(0.5, Math.min(5.0, value));
	}

	getAlgorithmType(): BeatDetectionAlgorithm {
		return 'spectral-flux';
	}

	getMetrics() {
		const all = this.fluxHistory.getAll();
		return {
			avgEnergy: all.length > 0 ? StatisticalUtils.mean(all) : 0,
			currentEnergy: this.lastFlux,
			threshold: all.length > 0 ? StatisticalUtils.getAdaptiveThreshold(all, this.options.sensitivity).threshold : 0,
			spectralFlux: this.lastFlux,
		};
	}

	detectBeat(timestamp: number): BeatEvent | null {
		if (!this.analyserNode) return null;

		// Get current spectrum
		const currentSpectrum = FrequencyAnalysisUtils.getFrequencyData(this.analyserNode);

		// Need previous frame for comparison
		if (!this.previousSpectrum) {
			this.previousSpectrum = new Uint8Array(currentSpectrum);
			return null;
		}

		// Calculate spectral flux (sum of positive differences)
		let spectralFlux = 0;
		for (let i = 0; i < currentSpectrum.length; i++) {
			const diff = (currentSpectrum[i] - this.previousSpectrum[i]) / 255;
			if (diff > 0) {
				spectralFlux += diff * diff; // Square for emphasis
			}
		}
		spectralFlux = Math.sqrt(spectralFlux / currentSpectrum.length);

		// Add to history
		this.fluxHistory.push(spectralFlux);

		// Need minimum history
		if (this.fluxHistory.length < 10) {
			this.previousSpectrum = new Uint8Array(currentSpectrum);
			this.lastFlux = spectralFlux;
			return null;
		}

		// Calculate adaptive threshold
		const recentHistory = this.fluxHistory.getLast(Math.min(20, this.fluxHistory.length));
		const { threshold, mean: avgFlux, stdDev } = StatisticalUtils.getAdaptiveThreshold(
			recentHistory,
			this.options.sensitivity
		);

		// Check cooldown
		const timeSinceLastBeat = timestamp - this.lastBeatTime;
		const isInCooldown = timeSinceLastBeat < this.options.cooldown;

		// Detect onset: flux peak above threshold
		const isFluxPeak = StatisticalUtils.isPeak(spectralFlux, this.lastFlux, spectralFlux);
		const aboveThreshold = spectralFlux > threshold;
		const significantFlux = spectralFlux > this.options.minEnergyThreshold;

		if (!isInCooldown && isFluxPeak && aboveThreshold && significantFlux) {
			const beatStrength = (spectralFlux - avgFlux) / (stdDev + 0.0001);
			const confidence = Math.min(1, beatStrength / 5);
			const bpm = this.bpmEstimator.addBeat(timestamp);

			this.lastBeatTime = timestamp;
			this.previousSpectrum = new Uint8Array(currentSpectrum);
			this.lastFlux = spectralFlux;

			return {
				timestamp,
				strength: beatStrength,
				energy: spectralFlux,
				avgEnergy: avgFlux,
				confidence,
				algorithm: 'spectral-flux',
				bpm: bpm ?? undefined,
			};
		}

		// Update state for next frame
		this.previousSpectrum = new Uint8Array(currentSpectrum);
		this.lastFlux = spectralFlux;
		return null;
	}
}

