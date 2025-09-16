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

export class RecordingError extends AudioStreamingError {
    constructor(message: string, recordingId?: string, originalError?: Error) {
        super(message, 'RECORDING_ERROR', recordingId, originalError);
    }
}

export class PermissionError extends AudioStreamingError {
    constructor(message: string, originalError?: Error) {
        super(message, 'PERMISSION_ERROR', undefined, originalError);
    }
}

// Recording-related types
export interface AudioRecorderOptions {
    /** MIME type for recorded audio (auto-detected if not specified) */
    mimeType?: string;

    /** Audio bits per second for recording quality */
    audioBitsPerSecond?: number;

    /** Enable echo cancellation */
    enableEchoCancellation?: boolean;

    /** Enable noise suppression */
    enableNoiseSuppression?: boolean;

    /** Enable automatic gain control */
    enableAutoGainControl?: boolean;

    /** Maximum recording duration in milliseconds */
    maxDuration?: number;

    /** Enable real-time audio processing during recording */
    enableRealtimeProcessing?: boolean;

    /** Silence threshold for real-time detection (in dB) */
    silenceThresholdDb?: number;
}

export interface RecordingState {
    /** Current recording state */
    state: 'idle' | 'requesting-permission' | 'recording' | 'paused' | 'processing' | 'completed' | 'error';

    /** Current recording ID */
    recordingId?: string;

    /** Recording duration in milliseconds */
    duration: number;

    /** Whether microphone permission is granted */
    hasPermission: boolean;

    /** Current audio level (0-1) if available */
    audioLevel?: number;

    /** Error message if state is 'error' */
    error?: string;
}

export interface RecordingResult {
    /** Unique identifier for this recording */
    recordingId: string;

    /** Promise that resolves when recording starts */
    onStarted: Promise<string>;

    /** Promise that resolves when recording completes */
    onCompleted: Promise<RecordingData>;

    /** Stop the recording */
    stop: () => Promise<RecordingData>;

    /** Pause the recording (if supported) */
    pause: () => void;

    /** Resume the recording (if supported) */
    resume: () => void;

    /** Cancel the recording */
    cancel: () => void;
}

export interface RecordingData {
    /** Recording ID */
    id: string;

    /** Audio data as Blob */
    blob: Blob;

    /** MIME type of recorded audio */
    mimeType: string;

    /** Recording duration in milliseconds */
    duration: number;

    /** Recording metadata */
    metadata: {
        /** Recording start time */
        startTime: number;
        /** Recording end time */
        endTime: number;
        /** Sample rate */
        sampleRate?: number;
        /** Number of channels */
        channels?: number;
        /** Average audio level during recording */
        averageLevel?: number;
    };
}

export type RecordingEventType =
    | 'permissionRequested'
    | 'permissionGranted'
    | 'permissionDenied'
    | 'recordingStarted'
    | 'recordingPaused'
    | 'recordingResumed'
    | 'recordingStopped'
    | 'recordingCompleted'
    | 'recordingCancelled'
    | 'audioLevel'
    | 'durationUpdate'
    | 'recordingError';

export interface RecordingEvent {
    type: RecordingEventType;
    recordingId?: string;
    data?: any;
    timestamp: number;
}

export type RecordingEventCallback = (event: RecordingEvent) => void;

// Permission-related types
export interface PermissionState {
    /** Current permission status */
    status: 'granted' | 'denied' | 'prompt' | 'unknown';

    /** Whether permission check is supported */
    isSupported: boolean;

    /** Error details if permission failed */
    error?: PermissionError;
}

export interface PermissionResult {
    /** Whether permission was granted */
    granted: boolean;

    /** Permission state details */
    state: PermissionState;

    /** Media stream if permission was granted */
    stream?: MediaStream;

    /** Error if permission failed */
    error?: PermissionError;
}

export interface MediaConstraintsOptions {
    /** Device ID for specific audio input device */
    deviceId?: string;

    /** Enable echo cancellation */
    echoCancellation?: boolean;

    /** Enable noise suppression */
    noiseSuppression?: boolean;

    /** Enable automatic gain control */
    autoGainControl?: boolean;

    /** Sample rate preference */
    sampleRate?: number;

    /** Channel count preference */
    channelCount?: number;
}

// Real-time processing types
export interface RealtimeProcessingOptions {
    /** Enable real-time silence detection */
    enableSilenceDetection?: boolean;

    /** Silence threshold in dB */
    silenceThresholdDb?: number;

    /** Enable real-time audio level monitoring */
    enableLevelMonitoring?: boolean;

    /** Level update interval in milliseconds */
    levelUpdateInterval?: number;

    /** Enable real-time audio effects */
    enableEffects?: boolean;

    /** Audio effects to apply */
    effects?: AudioEffect[];
}

export interface AudioEffect {
    /** Effect type */
    type: 'gain' | 'filter' | 'reverb' | 'echo' | 'custom';

    /** Effect parameters */
    parameters: Record<string, any>;

    /** Whether effect is enabled */
    enabled: boolean;
}

export interface RealtimeAudioData {
    /** Audio data as Float32Array */
    audioData: Float32Array;

    /** Sample rate */
    sampleRate: number;

    /** Number of channels */
    channels: number;

    /** Current audio level (0-1) */
    level: number;

    /** Whether silence is detected */
    isSilence: boolean;

    /** Timestamp */
    timestamp: number;
}
