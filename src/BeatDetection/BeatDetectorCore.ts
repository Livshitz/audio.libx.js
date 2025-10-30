/**
 * BeatDetectorCore - Base interfaces and shared utilities for beat detection algorithms
 */

import type { BeatEvent, BeatDetectionAlgorithm, BeatDetectorOptions } from '../types.js';

/**
 * Base interface that all beat detection algorithms must implement
 */
export interface IBeatDetectionAlgorithm {
	/**
	 * Initialize the algorithm with audio context and configuration
	 */
	initialize(
		audioContext: AudioContext,
		analyserNode: AnalyserNode,
		options: Required<BeatDetectorOptions>
	): void;

	/**
	 * Process audio frame and detect beats
	 * @returns BeatEvent if beat detected, null otherwise
	 */
	detectBeat(timestamp: number): BeatEvent | null;

	/**
	 * Reset algorithm state
	 */
	reset(): void;

	/**
	 * Update sensitivity setting
	 */
	setSensitivity(value: number): void;

	/**
	 * Get algorithm type
	 */
	getAlgorithmType(): BeatDetectionAlgorithm;

	/**
	 * Get current state metrics (for debugging/visualization)
	 */
	getMetrics(): {
		avgEnergy: number;
		currentEnergy: number;
		threshold?: number;
		[key: string]: any;
	};
}

/**
 * Shared utilities for frequency analysis
 */
export class FrequencyAnalysisUtils {
	/**
	 * Get frequency data from analyser node
	 */
	static getFrequencyData(analyser: AnalyserNode): Uint8Array {
		const data = new Uint8Array(analyser.frequencyBinCount);
		analyser.getByteFrequencyData(data);
		return data;
	}

	/**
	 * Calculate energy in a specific frequency range
	 * @param frequencyData - Frequency data from analyser
	 * @param sampleRate - Audio context sample rate
	 * @param fftSize - FFT size used
	 * @param freqLow - Low frequency in Hz
	 * @param freqHigh - High frequency in Hz
	 * @returns Normalized energy (0-1)
	 */
	static getEnergyInRange(
		frequencyData: Uint8Array,
		sampleRate: number,
		fftSize: number,
		freqLow: number,
		freqHigh: number
	): number {
		const binStart = Math.floor((freqLow * fftSize) / sampleRate);
		const binEnd = Math.floor((freqHigh * fftSize) / sampleRate);

		let energy = 0;
		for (let i = binStart; i < binEnd && i < frequencyData.length; i++) {
			const normalized = frequencyData[i] / 255;
			energy += normalized * normalized;
		}

		return energy / (binEnd - binStart);
	}

	/**
	 * Calculate energy using normalized frequency range (0-1)
	 * @param frequencyData - Frequency data from analyser
	 * @param rangeLow - Low range (0-1, where 1 is nyquist frequency)
	 * @param rangeHigh - High range (0-1)
	 * @returns Normalized energy (0-1)
	 */
	static getEnergyInNormalizedRange(
		frequencyData: Uint8Array,
		rangeLow: number,
		rangeHigh: number
	): number {
		const binStart = Math.floor(frequencyData.length * rangeLow);
		const binEnd = Math.floor(frequencyData.length * rangeHigh);

		let energy = 0;
		for (let i = binStart; i < binEnd; i++) {
			const normalized = frequencyData[i] / 255;
			energy += normalized * normalized;
		}

		return energy / (binEnd - binStart);
	}

	/**
	 * Calculate bass energy (60-180Hz)
	 */
	static getBassEnergy(
		frequencyData: Uint8Array,
		sampleRate: number,
		fftSize: number
	): number {
		return this.getEnergyInRange(frequencyData, sampleRate, fftSize, 60, 180);
	}
}

/**
 * Statistical utilities for beat detection
 */
export class StatisticalUtils {
	/**
	 * Calculate mean of array
	 */
	static mean(values: number[]): number {
		if (values.length === 0) return 0;
		return values.reduce((sum, val) => sum + val, 0) / values.length;
	}

	/**
	 * Calculate variance of array
	 */
	static variance(values: number[], mean?: number): number {
		if (values.length === 0) return 0;
		const avg = mean ?? this.mean(values);
		return values.reduce((sum, val) => sum + (val - avg) ** 2, 0) / values.length;
	}

	/**
	 * Calculate standard deviation
	 */
	static stdDev(values: number[], mean?: number): number {
		return Math.sqrt(this.variance(values, mean));
	}

	/**
	 * Get adaptive threshold based on energy history
	 */
	static getAdaptiveThreshold(
		energyHistory: number[],
		sensitivity: number
	): { threshold: number; mean: number; stdDev: number } {
		const mean = this.mean(energyHistory);
		const stdDev = this.stdDev(energyHistory, mean);
		const threshold = mean + sensitivity * stdDev;

		return { threshold, mean, stdDev };
	}

	/**
	 * Detect if value is a peak (local maximum)
	 */
	static isPeak(current: number, previous: number, next: number): boolean {
		return current > previous && current >= next;
	}
}

/**
 * Circular buffer for efficient history tracking
 */
export class CircularBuffer<T> {
	private buffer: T[];
	private index: number = 0;
	private size: number;
	private filled: boolean = false;

	constructor(size: number) {
		this.size = size;
		this.buffer = new Array(size);
	}

	push(item: T): void {
		this.buffer[this.index] = item;
		this.index = (this.index + 1) % this.size;
		if (this.index === 0) this.filled = true;
	}

	getAll(): T[] {
		if (!this.filled) {
			return this.buffer.slice(0, this.index);
		}
		// Return in chronological order
		return [...this.buffer.slice(this.index), ...this.buffer.slice(0, this.index)];
	}

	getLast(n: number): T[] {
		const all = this.getAll();
		return all.slice(-n);
	}

	clear(): void {
		this.index = 0;
		this.filled = false;
	}

	get length(): number {
		return this.filled ? this.size : this.index;
	}
}

/**
 * BPM estimator using beat intervals
 */
export class BPMEstimator {
	private beatIntervals: CircularBuffer<number>;
	private lastBeatTime: number | null = null;
	private readonly minBPM = 60;
	private readonly maxBPM = 200;

	constructor(historySize: number = 8) {
		this.beatIntervals = new CircularBuffer(historySize);
	}

	addBeat(timestamp: number): number | null {
		if (this.lastBeatTime !== null) {
			const interval = timestamp - this.lastBeatTime;
			// Filter out unrealistic intervals
			const bpm = 60000 / interval;
			if (bpm >= this.minBPM && bpm <= this.maxBPM) {
				this.beatIntervals.push(interval);
			}
		}
		this.lastBeatTime = timestamp;

		return this.getEstimatedBPM();
	}

	getEstimatedBPM(): number | null {
		if (this.beatIntervals.length < 2) return null;

		const intervals = this.beatIntervals.getAll();
		const avgInterval = StatisticalUtils.mean(intervals);
		return Math.round(60000 / avgInterval);
	}

	reset(): void {
		this.beatIntervals.clear();
		this.lastBeatTime = null;
	}
}

