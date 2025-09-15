/**
 * MediaSourceHelper - Cross-platform MediaSource management
 * Handles compatibility between standard MediaSource and ManagedMediaSource (iOS 17.1+)
 */

import { MediaSourceInfo, MediaSourceError, AudioFormat } from './types.js';

export class MediaSourceHelper {
	private static _instance: MediaSourceHelper;
	private _supportedMimeTypes: string[] = [];
	private _isSupported: boolean = false;
	private _hasManagedMediaSource: boolean = false;

	private constructor() {
		this._initialize();
	}

	public static getInstance(): MediaSourceHelper {
		if (!MediaSourceHelper._instance) {
			MediaSourceHelper._instance = new MediaSourceHelper();
		}
		return MediaSourceHelper._instance;
	}

	private _initialize(): void {
		// Check for ManagedMediaSource (iOS 17.1+)
		this._hasManagedMediaSource = 'ManagedMediaSource' in window;

		// Check for standard MediaSource
		const hasStandardMediaSource = 'MediaSource' in window;

		this._isSupported = this._hasManagedMediaSource || hasStandardMediaSource;

		if (this._isSupported) {
			this._detectSupportedMimeTypes();
		}
	}

	private _detectSupportedMimeTypes(): void {
		const commonMimeTypes = [
			'audio/mpeg',
			'audio/mp3',
			'audio/wav',
			'audio/webm',
			'audio/webm; codecs=opus',
			'audio/webm; codecs=vorbis',
			'audio/ogg',
			'audio/ogg; codecs=opus',
			'audio/ogg; codecs=vorbis',
			'audio/mp4',
			'audio/mp4; codecs=mp4a.40.2',
			'audio/aac'
		];

		this._supportedMimeTypes = commonMimeTypes.filter(mimeType => {
			try {
				return MediaSource.isTypeSupported(mimeType);
			} catch {
				return false;
			}
		});
	}

	/**
	 * Creates a new MediaSource instance with cross-platform compatibility
	 */
	public createMediaSource(): MediaSourceInfo {
		if (!this._isSupported) {
			throw new MediaSourceError('MediaSource API is not supported on this device');
		}

		let mediaSource: MediaSource | any;
		let isManaged = false;

		try {
			if (this._hasManagedMediaSource) {
				// Use ManagedMediaSource on iOS 17.1+ and other supported platforms
				mediaSource = new (window as any).ManagedMediaSource();
				isManaged = true;
			} else {
				// Fallback to standard MediaSource
				mediaSource = new MediaSource();
				isManaged = false;
			}
		} catch (error) {
			throw new MediaSourceError(
				'Failed to create MediaSource instance',
				undefined,
				error as Error
			);
		}

		return {
			mediaSource,
			isManaged,
			supportedMimeTypes: [...this._supportedMimeTypes]
		};
	}

	/**
	 * Determines the best MIME type for the given audio format
	 */
	public getBestMimeType(format: AudioFormat): string {
		const preferredMimeTypes = this._getPreferredMimeTypesForFormat(format);

		for (const mimeType of preferredMimeTypes) {
			if (this._supportedMimeTypes.includes(mimeType)) {
				return mimeType;
			}
		}

		// Fallback to the most widely supported type
		if (this._supportedMimeTypes.includes('audio/mpeg')) {
			return 'audio/mpeg';
		}

		if (this._supportedMimeTypes.length > 0) {
			return this._supportedMimeTypes[0];
		}

		throw new MediaSourceError(`No supported MIME type found for format: ${format.type}`);
	}

	private _getPreferredMimeTypesForFormat(format: AudioFormat): string[] {
		switch (format.type) {
			case 'mp3':
				return ['audio/mpeg', 'audio/mp3'];

			case 'wav':
				// WAV/PCM is generally not supported by MediaSource API
				// Prefer compressed formats that can handle the audio content
				return ['audio/webm; codecs=opus', 'audio/mpeg'];

			case 'webm':
				return [
					'audio/webm; codecs=opus',
					'audio/webm; codecs=vorbis',
					'audio/webm'
				];

			case 'ogg':
				return [
					'audio/ogg; codecs=opus',
					'audio/ogg; codecs=vorbis',
					'audio/ogg'
				];

			default:
				return ['audio/mpeg']; // Safe fallback
		}
	}

	/**
	 * Detects audio format from binary data
	 */
	public detectAudioFormat(data: Uint8Array | ArrayBuffer): AudioFormat {
		const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;

		// Check for WAV format
		if (this._isWavFormat(bytes)) {
			return {
				type: 'wav',
				mimeType: 'audio/wav',
				streamable: false, // WAV/PCM typically not supported by MediaSource
				requiresConversion: true
			};
		}

		// Check for MP3 format
		if (this._isMp3Format(bytes)) {
			return {
				type: 'mp3',
				mimeType: 'audio/mpeg',
				streamable: true
			};
		}

		// Check for WebM format
		if (this._isWebMFormat(bytes)) {
			return {
				type: 'webm',
				mimeType: 'audio/webm',
				streamable: true,
				codec: 'opus' // Assume Opus for WebM audio
			};
		}

		// Check for Ogg format
		if (this._isOggFormat(bytes)) {
			return {
				type: 'ogg',
				mimeType: 'audio/ogg',
				streamable: true
			};
		}

		// Unknown format
		return {
			type: 'unknown',
			mimeType: 'audio/mpeg', // Safe fallback
			streamable: false
		};
	}

	private _isWavFormat(bytes: Uint8Array): boolean {
		if (bytes.length < 12) return false;

		const riff = String.fromCharCode(...bytes.slice(0, 4));
		const wave = String.fromCharCode(...bytes.slice(8, 12));

		return riff === 'RIFF' && wave === 'WAVE';
	}

	private _isMp3Format(bytes: Uint8Array): boolean {
		if (bytes.length < 3) return false;

		// Check for ID3 tag
		if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
			return true; // ID3v2 tag
		}

		// Check for MP3 frame sync
		if (bytes.length >= 2 && bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) {
			return true;
		}

		// Check for ID3v1 tag at the end (if we have enough data)
		if (bytes.length >= 128) {
			const tagStart = bytes.length - 128;
			if (bytes[tagStart] === 0x54 && bytes[tagStart + 1] === 0x41 && bytes[tagStart + 2] === 0x47) {
				return true; // ID3v1 tag
			}
		}

		return false;
	}

	private _isWebMFormat(bytes: Uint8Array): boolean {
		if (bytes.length < 4) return false;

		// WebM files start with EBML header (0x1A45DFA3)
		return bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3;
	}

	private _isOggFormat(bytes: Uint8Array): boolean {
		if (bytes.length < 4) return false;

		// Ogg files start with "OggS"
		const signature = String.fromCharCode(...bytes.slice(0, 4));
		return signature === 'OggS';
	}

	/**
	 * Creates a SourceBuffer with error handling and retry logic
	 */
	public async createSourceBuffer(
		mediaSource: MediaSource,
		mimeType: string,
		retryCount: number = 3
	): Promise<SourceBuffer> {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt < retryCount; attempt++) {
			try {
				const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
				return sourceBuffer;
			} catch (error) {
				lastError = error as Error;

				if (attempt < retryCount - 1) {
					// Wait before retrying
					await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
				}
			}
		}

		throw new MediaSourceError(
			`Failed to create SourceBuffer with MIME type: ${mimeType}`,
			undefined,
			lastError
		);
	}

	/**
	 * Safely appends data to SourceBuffer with proper state management
	 */
	public async appendToSourceBuffer(
		sourceBuffer: SourceBuffer,
		data: ArrayBuffer | Uint8Array,
		timeout: number = 10000
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(new MediaSourceError('SourceBuffer append timeout'));
			}, timeout);

			const onUpdateEnd = () => {
				clearTimeout(timeoutId);
				sourceBuffer.removeEventListener('updateend', onUpdateEnd);
				sourceBuffer.removeEventListener('error', onError);
				resolve();
			};

			const onError = (event: Event) => {
				clearTimeout(timeoutId);
				sourceBuffer.removeEventListener('updateend', onUpdateEnd);
				sourceBuffer.removeEventListener('error', onError);

				// Provide more descriptive error message
				let errorMessage = 'SourceBuffer append error';
				if (event && (event as any).error) {
					errorMessage += `: ${(event as any).error.message || 'Unknown error'}`;
				}
				errorMessage += '. This may be due to unsupported audio format or codec.';

				reject(new MediaSourceError(errorMessage, undefined, event as any));
			};

			if (sourceBuffer.updating) {
				// Wait for current update to complete
				sourceBuffer.addEventListener('updateend', () => {
					this._performAppend(sourceBuffer, data, onUpdateEnd, onError);
				}, { once: true });
			} else {
				this._performAppend(sourceBuffer, data, onUpdateEnd, onError);
			}
		});
	}

	private _performAppend(
		sourceBuffer: SourceBuffer,
		data: ArrayBuffer | Uint8Array,
		onUpdateEnd: () => void,
		onError: (event: Event) => void
	): void {
		sourceBuffer.addEventListener('updateend', onUpdateEnd, { once: true });
		sourceBuffer.addEventListener('error', onError, { once: true });

		try {
			const arrayBuffer = data instanceof Uint8Array
				? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
				: data as ArrayBuffer;
			sourceBuffer.appendBuffer(arrayBuffer);
		} catch (error) {
			sourceBuffer.removeEventListener('updateend', onUpdateEnd);
			sourceBuffer.removeEventListener('error', onError);
			throw new MediaSourceError('Failed to append buffer', undefined, error as Error);
		}
	}

	/**
	 * Gets information about MediaSource support
	 */
	public getCapabilities() {
		return {
			isSupported: this._isSupported,
			hasManagedMediaSource: this._hasManagedMediaSource,
			supportedMimeTypes: [...this._supportedMimeTypes]
		};
	}

	/**
	 * Checks if a specific MIME type is supported
	 */
	public isMimeTypeSupported(mimeType: string): boolean {
		return this._supportedMimeTypes.includes(mimeType);
	}
}
