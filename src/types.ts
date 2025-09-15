/**
 * Core types and interfaces for audio.libx.js
 */

export interface AudioStreamerOptions {
	/** Buffer threshold in seconds before starting playback (default: 5) */
	bufferThreshold?: number;

	/** Enable persistent caching using IndexedDB (default: true) */
	enableCaching?: boolean;

	/** Enable automatic silence trimming (default: true) */
	enableTrimming?: boolean;

	/** MIME type for audio content (auto-detected if not specified) */
	mimeType?: string;

	/** Silence threshold in dB for trimming (default: -50) */
	silenceThresholdDb?: number;

	/** Minimum silence duration in ms to consider for trimming (default: 100) */
	minSilenceMs?: number;

	/** IndexedDB database name for caching (default: 'sound-libx-cache') */
	cacheDbName?: string;

	/** IndexedDB store name for audio tracks (default: 'audio-tracks') */
	cacheStoreName?: string;
}

export interface StreamResult {
	/** Promise that resolves when audio is loaded and ready to play */
	onLoaded: Promise<string>;

	/** Promise that resolves when playback has ended */
	onEnded: Promise<string>;

	/** Unique identifier for this audio stream */
	audioId: string;

	/** Cancel the streaming operation */
	cancel: () => void;
}

export interface AudioCacheEntry {
	/** Unique identifier for the audio */
	id: string;

	/** Audio data as array of Uint8Array chunks */
	chunks: Uint8Array[];

	/** MIME type of the audio */
	mimeType: string;

	/** Timestamp when cached */
	cachedAt: number;

	/** Original size in bytes */
	originalSize: number;

	/** Whether audio has been processed (trimmed) */
	processed?: boolean;
}

export interface AudioProcessingResult {
	/** Processed audio as Blob */
	blob: Blob;

	/** Processing metadata */
	metadata: {
		originalDuration: number;
		trimmedDuration: number;
		silenceRemovedStart: number;
		silenceRemovedEnd: number;
	};
}

export interface MediaSourceInfo {
	/** The MediaSource instance */
	mediaSource: MediaSource | any; // 'any' for ManagedMediaSource

	/** Whether this is a ManagedMediaSource (iOS 17.1+) */
	isManaged: boolean;

	/** Supported MIME types */
	supportedMimeTypes: string[];
}

export interface StreamingState {
	/** Current streaming state */
	state: 'idle' | 'loading' | 'streaming' | 'playing' | 'paused' | 'ended' | 'error';

	/** Current audio ID being processed */
	currentAudioId?: string;

	/** Buffer progress (0-1) */
	bufferProgress: number;

	/** Whether sufficient buffer is available for playback */
	canPlay: boolean;

	/** Error message if state is 'error' */
	error?: string;
}

export type StreamingEventType =
	| 'stateChange'
	| 'bufferProgress'
	| 'canPlay'
	| 'loadStart'
	| 'loadEnd'
	| 'playStart'
	| 'playEnd'
	| 'error'
	| 'cacheHit'
	| 'cacheMiss';

export interface StreamingEvent {
	type: StreamingEventType;
	audioId?: string;
	data?: any;
	timestamp: number;
}

export type StreamingEventCallback = (event: StreamingEvent) => void;

export interface AudioFormat {
	/** Detected format type */
	type: 'mp3' | 'wav' | 'webm' | 'ogg' | 'unknown';

	/** MIME type */
	mimeType: string;

	/** Whether format supports streaming */
	streamable: boolean;

	/** Codec information if available */
	codec?: string;

	/** Whether format requires conversion for MediaSource compatibility */
	requiresConversion?: boolean;
}

export interface ChunkAppendOptions {
	/** Whether to wait for previous append to complete */
	waitForUpdate?: boolean;

	/** Timeout in ms for append operation */
	timeout?: number;

	/** Retry count for failed appends */
	retryCount?: number;
}

export interface CacheStats {
	/** Total number of cached entries */
	entryCount: number;

	/** Total cache size in bytes */
	totalSize: number;

	/** Available storage quota in bytes */
	availableQuota: number;

	/** Used storage quota in bytes */
	usedQuota: number;

	/** Cache hit ratio (0-1) */
	hitRatio: number;
}

// Error types
export class AudioStreamingError extends Error {
	constructor(
		message: string,
		public code: string,
		public audioId?: string,
		public originalError?: Error
	) {
		super(message);
		this.name = 'AudioStreamingError';
	}
}

export class MediaSourceError extends AudioStreamingError {
	constructor(message: string, audioId?: string, originalError?: Error) {
		super(message, 'MEDIA_SOURCE_ERROR', audioId, originalError);
	}
}

export class CacheError extends AudioStreamingError {
	constructor(message: string, audioId?: string, originalError?: Error) {
		super(message, 'CACHE_ERROR', audioId, originalError);
	}
}

export class ProcessingError extends AudioStreamingError {
	constructor(message: string, audioId?: string, originalError?: Error) {
		super(message, 'PROCESSING_ERROR', audioId, originalError);
	}
}
