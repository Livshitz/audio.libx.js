/**
 * AudioChunkConverter - Utilities for converting audio chunks between formats
 * Supports PCM, WAV, and WebM formats for real-time streaming
 */

import { AudioChunk, ChunkFormat } from './types.js';

export class AudioChunkConverter {
    /**
     * Convert Float32Array audio data to the specified format
     */
    public static convertToFormat(
        audioData: Float32Array,
        format: ChunkFormat,
        sampleRate: number,
        channelCount: number,
        timestamp: number
    ): AudioChunk {
        const duration = (audioData.length / channelCount / sampleRate) * 1000;

        let data: ArrayBuffer;

        switch (format) {
            case 'raw':
                data = audioData.buffer.slice(
                    audioData.byteOffset,
                    audioData.byteOffset + audioData.byteLength
                ) as ArrayBuffer;
                break;

            case 'pcm':
                data = this._convertToPCM(audioData);
                break;

            case 'wav':
                data = this._convertToWAV(audioData, sampleRate, channelCount);
                break;

            case 'webm':
                // WebM requires more complex encoding, for now return PCM
                // In production, this would use a WebM encoder
                data = this._convertToPCM(audioData);
                break;

            default:
                throw new Error(`Unsupported chunk format: ${format}`);
        }

        return {
            data,
            format,
            sampleRate,
            channelCount,
            timestamp,
            duration,
        };
    }

    /**
     * Convert Float32Array to PCM16 (16-bit signed integers)
     */
    private static _convertToPCM(float32Array: Float32Array): ArrayBuffer {
        const buffer = new ArrayBuffer(float32Array.length * 2);
        const view = new DataView(buffer);

        for (let i = 0; i < float32Array.length; i++) {
            // Clamp to [-1, 1] and convert to 16-bit signed integer
            const sample = Math.max(-1, Math.min(1, float32Array[i]));
            const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            view.setInt16(i * 2, int16, true); // true = little-endian
        }

        return buffer;
    }

    /**
     * Convert Float32Array to WAV format with proper headers
     */
    private static _convertToWAV(
        float32Array: Float32Array,
        sampleRate: number,
        channelCount: number
    ): ArrayBuffer {
        const pcmData = this._convertToPCM(float32Array);
        const pcmLength = pcmData.byteLength;

        // WAV file structure:
        // - RIFF header (12 bytes)
        // - fmt chunk (24 bytes)
        // - data chunk header (8 bytes)
        // - PCM data
        const headerLength = 44;
        const totalLength = headerLength + pcmLength;

        const buffer = new ArrayBuffer(totalLength);
        const view = new DataView(buffer);

        // RIFF header
        this._writeString(view, 0, 'RIFF');
        view.setUint32(4, totalLength - 8, true); // File size - 8
        this._writeString(view, 8, 'WAVE');

        // fmt chunk
        this._writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, 1, true); // Audio format (1 = PCM)
        view.setUint16(22, channelCount, true); // Number of channels
        view.setUint32(24, sampleRate, true); // Sample rate
        view.setUint32(28, sampleRate * channelCount * 2, true); // Byte rate
        view.setUint16(32, channelCount * 2, true); // Block align
        view.setUint16(34, 16, true); // Bits per sample

        // data chunk
        this._writeString(view, 36, 'data');
        view.setUint32(40, pcmLength, true); // Data size

        // Copy PCM data
        const pcmView = new Uint8Array(pcmData);
        const wavView = new Uint8Array(buffer);
        wavView.set(pcmView, headerLength);

        return buffer;
    }

    /**
     * Write a string to a DataView
     */
    private static _writeString(view: DataView, offset: number, string: string): void {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    /**
     * Resample audio data to a different sample rate
     */
    public static resample(
        audioData: Float32Array,
        fromRate: number,
        toRate: number,
        channelCount: number = 1
    ): Float32Array {
        if (fromRate === toRate) {
            return audioData;
        }

        const ratio = fromRate / toRate;
        const samplesPerChannel = audioData.length / channelCount;
        const newLength = Math.floor(samplesPerChannel / ratio) * channelCount;
        const result = new Float32Array(newLength);

        for (let channel = 0; channel < channelCount; channel++) {
            for (let i = 0; i < newLength / channelCount; i++) {
                const srcIndex = i * ratio;
                const srcIndexFloor = Math.floor(srcIndex);
                const srcIndexCeil = Math.min(srcIndexFloor + 1, samplesPerChannel - 1);
                const fraction = srcIndex - srcIndexFloor;

                // Linear interpolation
                const sample1 = audioData[srcIndexFloor * channelCount + channel];
                const sample2 = audioData[srcIndexCeil * channelCount + channel];
                result[i * channelCount + channel] = sample1 + (sample2 - sample1) * fraction;
            }
        }

        return result;
    }

    /**
     * Convert stereo to mono by averaging channels
     */
    public static stereoToMono(stereoData: Float32Array): Float32Array {
        const monoLength = stereoData.length / 2;
        const monoData = new Float32Array(monoLength);

        for (let i = 0; i < monoLength; i++) {
            monoData[i] = (stereoData[i * 2] + stereoData[i * 2 + 1]) / 2;
        }

        return monoData;
    }

    /**
     * Convert mono to stereo by duplicating the channel
     */
    public static monoToStereo(monoData: Float32Array): Float32Array {
        const stereoData = new Float32Array(monoData.length * 2);

        for (let i = 0; i < monoData.length; i++) {
            stereoData[i * 2] = monoData[i];
            stereoData[i * 2 + 1] = monoData[i];
        }

        return stereoData;
    }
}

