/**
 * AudioProcessor - Audio processing utilities for trimming, format conversion, and optimization
 * Handles silence trimming, ID3 tag removal, and WAV conversion
 */

import { AudioProcessingResult, ProcessingError, AudioFormat } from './types.js';

export class AudioProcessor {
	private _audioContext: AudioContext | null = null;

	constructor() {
		this._initializeAudioContext();
	}

	private _initializeAudioContext(): void {
		try {
			// Use existing AudioContext if available, otherwise create new one
			if (typeof window !== 'undefined' && 'AudioContext' in window) {
				this._audioContext = new AudioContext();
			} else if (typeof window !== 'undefined' && 'webkitAudioContext' in window) {
				this._audioContext = new (window as any).webkitAudioContext();
			}
		} catch (error) {
			console.warn('AudioContext not available:', error);
		}
	}

	/**
	 * Process audio chunks with trimming and format conversion
	 */
	public async processAudio(
		chunks: Uint8Array[],
		options: {
			trimSilence?: boolean;
			silenceThresholdDb?: number;
			minSilenceMs?: number;
			outputFormat?: 'wav' | 'original';
			stripID3?: boolean;
		} = {}
	): Promise<AudioProcessingResult> {
		const {
			trimSilence = true,
			silenceThresholdDb = -50,
			minSilenceMs = 100,
			outputFormat = 'wav',
			stripID3 = true
		} = options;

		try {
			// First, concatenate and clean chunks
			let processedChunks = stripID3 ? this._stripID3Tags(chunks) : chunks;
			const arrayBuffer = this._concatenateChunks(processedChunks);

			let finalBuffer = arrayBuffer;
			let metadata = {
				originalDuration: 0,
				trimmedDuration: 0,
				silenceRemovedStart: 0,
				silenceRemovedEnd: 0
			};

			if (trimSilence && this._audioContext) {
				// Decode and trim audio
				const audioBuffer = await this._decodeAudioData(arrayBuffer);
				metadata.originalDuration = audioBuffer.duration;

				const trimmedBuffer = this._trimSilence(
					audioBuffer,
					silenceThresholdDb,
					minSilenceMs
				);
				metadata.trimmedDuration = trimmedBuffer.buffer.duration;
				metadata.silenceRemovedStart = trimmedBuffer.trimmedStart;
				metadata.silenceRemovedEnd = trimmedBuffer.trimmedEnd;

				if (outputFormat === 'wav') {
					finalBuffer = this._audioBufferToWav(trimmedBuffer.buffer);
				} else {
					// For original format, we need to re-encode (complex operation)
					// For now, fall back to WAV
					finalBuffer = this._audioBufferToWav(trimmedBuffer.buffer);
				}
			} else if (outputFormat === 'wav' && this._audioContext) {
				// Convert to WAV without trimming
				const audioBuffer = await this._decodeAudioData(arrayBuffer);
				metadata.originalDuration = audioBuffer.duration;
				metadata.trimmedDuration = audioBuffer.duration;
				finalBuffer = this._audioBufferToWav(audioBuffer);
			}

			const blob = new Blob([finalBuffer], {
				type: outputFormat === 'wav' ? 'audio/wav' : 'audio/mpeg'
			});

			return {
				blob,
				metadata
			};

		} catch (error) {
			throw new ProcessingError('Failed to process audio', undefined, error as Error);
		}
	}

	/**
	 * Trim silence from audio buffer
	 */
	private _trimSilence(
		audioBuffer: AudioBuffer,
		silenceThresholdDb: number,
		minSilenceMs: number
	): { buffer: AudioBuffer; trimmedStart: number; trimmedEnd: number; } {
		if (!this._audioContext) {
			throw new ProcessingError('AudioContext not available for trimming');
		}

		const sampleRate = audioBuffer.sampleRate;
		const channelData = audioBuffer.getChannelData(0); // Use first channel for detection
		const threshold = Math.pow(10, silenceThresholdDb / 20);
		const minSilenceSamples = (minSilenceMs / 1000) * sampleRate;

		let startSample = 0;
		let endSample = channelData.length - 1;

		// Find start of audio content
		for (let i = 0; i < channelData.length; i++) {
			if (Math.abs(channelData[i]) > threshold) {
				startSample = Math.max(0, i - Math.floor(minSilenceSamples / 2));
				break;
			}
		}

		// Find end of audio content
		for (let i = channelData.length - 1; i >= 0; i--) {
			if (Math.abs(channelData[i]) > threshold) {
				endSample = Math.min(channelData.length - 1, i + Math.floor(minSilenceSamples / 2));
				break;
			}
		}

		const trimmedLength = endSample - startSample + 1;

		if (trimmedLength <= 0) {
			// If no audio content found, return minimal buffer
			const minimalBuffer = this._audioContext.createBuffer(
				audioBuffer.numberOfChannels,
				Math.floor(sampleRate * 0.1), // 0.1 second
				sampleRate
			);
			return {
				buffer: minimalBuffer,
				trimmedStart: 0,
				trimmedEnd: 0
			};
		}

		const trimmedBuffer = this._audioContext.createBuffer(
			audioBuffer.numberOfChannels,
			trimmedLength,
			sampleRate
		);

		// Copy trimmed data for all channels
		for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
			const originalData = audioBuffer.getChannelData(ch);
			const trimmedData = trimmedBuffer.getChannelData(ch);
			trimmedData.set(originalData.slice(startSample, endSample + 1));
		}

		return {
			buffer: trimmedBuffer,
			trimmedStart: startSample / sampleRate,
			trimmedEnd: (channelData.length - endSample - 1) / sampleRate
		};
	}

	/**
	 * Strip ID3 tags from MP3 chunks
	 */
	private _stripID3Tags(chunks: Uint8Array[]): Uint8Array[] {
		return chunks.map((chunk, index) => this._stripID3FromChunk(chunk, index === 0));
	}

	private _stripID3FromChunk(chunk: Uint8Array, keepID3v2: boolean = false): Uint8Array {
		let start = 0;
		let end = chunk.length;

		// Handle ID3v2 tag at start
		if (chunk.length >= 10 &&
			chunk[0] === 0x49 && chunk[1] === 0x44 && chunk[2] === 0x33) { // 'ID3'

			const size = ((chunk[6] & 0x7f) << 21) |
				((chunk[7] & 0x7f) << 14) |
				((chunk[8] & 0x7f) << 7) |
				(chunk[9] & 0x7f);
			const tagEnd = 10 + size;

			if (!keepID3v2 && tagEnd < chunk.length) {
				start = tagEnd;
			}
		}

		// Handle ID3v1 tag at end
		if (chunk.length >= 128 &&
			chunk[end - 128] === 0x54 && // 'T'
			chunk[end - 127] === 0x41 && // 'A'
			chunk[end - 126] === 0x47) {  // 'G'
			end -= 128;
		}

		return chunk.subarray(start, end);
	}

	/**
	 * Concatenate audio chunks into single ArrayBuffer
	 */
	private _concatenateChunks(chunks: Uint8Array[]): ArrayBuffer {
		const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
		const combined = new Uint8Array(totalLength);

		let offset = 0;
		for (const chunk of chunks) {
			combined.set(chunk, offset);
			offset += chunk.byteLength;
		}

		return combined.buffer;
	}

	/**
	 * Decode audio data using Web Audio API
	 */
	private async _decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
		if (!this._audioContext) {
			throw new ProcessingError('AudioContext not available for decoding');
		}

		try {
			// Ensure AudioContext is resumed
			if (this._audioContext.state === 'suspended') {
				await this._audioContext.resume();
			}

			return await this._audioContext.decodeAudioData(arrayBuffer.slice(0));
		} catch (error) {
			throw new ProcessingError('Failed to decode audio data', undefined, error as Error);
		}
	}

	/**
	 * Convert AudioBuffer to WAV format
	 */
	private _audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
		const numChannels = buffer.numberOfChannels;
		const sampleRate = buffer.sampleRate;
		const format = 1; // PCM
		const bitDepth = 16;

		const samples = buffer.length;
		const blockAlign = numChannels * bitDepth / 8;
		const byteRate = sampleRate * blockAlign;
		const dataSize = samples * blockAlign;

		const bufferLength = 44 + dataSize;
		const arrayBuffer = new ArrayBuffer(bufferLength);
		const view = new DataView(arrayBuffer);

		let offset = 0;

		// Helper functions
		const writeString = (s: string) => {
			for (let i = 0; i < s.length; i++) {
				view.setUint8(offset++, s.charCodeAt(i));
			}
		};

		const writeUint32 = (value: number) => {
			view.setUint32(offset, value, true);
			offset += 4;
		};

		const writeUint16 = (value: number) => {
			view.setUint16(offset, value, true);
			offset += 2;
		};

		// RIFF header
		writeString('RIFF');
		writeUint32(36 + dataSize);
		writeString('WAVE');

		// fmt subchunk
		writeString('fmt ');
		writeUint32(16); // Subchunk1Size
		writeUint16(format); // AudioFormat
		writeUint16(numChannels);
		writeUint32(sampleRate);
		writeUint32(byteRate);
		writeUint16(blockAlign);
		writeUint16(bitDepth);

		// data subchunk
		writeString('data');
		writeUint32(dataSize);

		// Write PCM samples
		for (let i = 0; i < samples; i++) {
			for (let ch = 0; ch < numChannels; ch++) {
				let sample = buffer.getChannelData(ch)[i];
				sample = Math.max(-1, Math.min(1, sample)); // Clamp to [-1, 1]
				const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
				view.setInt16(offset, intSample, true);
				offset += 2;
			}
		}

		return arrayBuffer;
	}

	/**
	 * Concatenate multiple audio buffers
	 */
	public concatenateAudioBuffers(buffers: AudioBuffer[]): AudioBuffer | null {
		if (!this._audioContext || buffers.length === 0) {
			return null;
		}

		const numChannels = buffers[0].numberOfChannels;
		const sampleRate = buffers[0].sampleRate;
		const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);

		const output = this._audioContext.createBuffer(numChannels, totalLength, sampleRate);

		for (let channel = 0; channel < numChannels; channel++) {
			let offset = 0;
			for (const buffer of buffers) {
				output.getChannelData(channel).set(buffer.getChannelData(channel), offset);
				offset += buffer.length;
			}
		}

		return output;
	}

	/**
	 * Split large chunks into smaller ones for better streaming
	 */
	public splitIntoChunks(data: Uint8Array, chunkSize: number = 64 * 1024): Uint8Array[] {
		const chunks: Uint8Array[] = [];
		for (let offset = 0; offset < data.length; offset += chunkSize) {
			const end = Math.min(offset + chunkSize, data.length);
			chunks.push(data.subarray(offset, end));
		}
		return chunks;
	}

	/**
	 * Validate MP3 chunk integrity
	 */
	public validateMP3Chunk(chunk: Uint8Array): boolean {
		if (chunk.length < 4) return false;

		// Check for ID3 tag
		if (chunk[0] === 0x49 && chunk[1] === 0x44 && chunk[2] === 0x33) {
			return true; // ID3v2 tag
		}

		// Check for MP3 frame sync
		for (let i = 0; i < chunk.length - 1; i++) {
			if (chunk[i] === 0xFF && (chunk[i + 1] & 0xE0) === 0xE0) {
				return true; // Found MP3 frame sync
			}
		}

		return false;
	}

	/**
	 * Estimate audio duration from chunks (rough estimation)
	 */
	public estimateDuration(chunks: Uint8Array[], format: AudioFormat): number {
		const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);

		// Rough estimation based on format
		switch (format.type) {
			case 'mp3':
				// Assume average bitrate of 128 kbps
				return (totalBytes * 8) / (128 * 1000);

			case 'wav':
				// Assume 16-bit, 44.1kHz stereo
				return totalBytes / (44100 * 2 * 2);

			default:
				// Generic estimation
				return totalBytes / (128 * 1000 / 8);
		}
	}

	/**
	 * Clean up resources
	 */
	public dispose(): void {
		if (this._audioContext && this._audioContext.state !== 'closed') {
			this._audioContext.close();
		}
		this._audioContext = null;
	}

	/**
	 * Get processor capabilities
	 */
	public getCapabilities() {
		return {
			hasAudioContext: this._audioContext !== null,
			canTrimSilence: this._audioContext !== null,
			canConvertToWav: this._audioContext !== null,
			canConcatenate: this._audioContext !== null,
			supportedFormats: ['mp3', 'wav', 'ogg', 'webm']
		};
	}
}
