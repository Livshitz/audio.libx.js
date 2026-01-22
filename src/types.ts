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

    /** Force use of native progressive streaming instead of MSE (auto-detected on mobile by default) */
    useNativeStreaming?: boolean;
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

    /** Tags for categorization and filtering */
    tags?: string[];

    /** Custom metadata */
    customData?: Record<string, any>;

    /** Number of times this entry has been accessed */
    accessCount?: number;
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

    /** Statistics by tag */
    byTag?: Record<string, { count: number; size: number; }>;
}

export interface CacheCleanupOptions {
    /** Maximum age in milliseconds */
    maxAge?: number;

    /** Maximum number of entries to keep */
    maxEntries?: number;

    /** Minimum access count to keep */
    minAccessCount?: number;

    /** Only cleanup entries with these tags */
    tags?: string[];

    /** Exclude entries with these tags from cleanup */
    excludeTags?: string[];
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

    /** Enable real-time audio chunk streaming */
    enableRealtimeChunks?: boolean;

    /** Interval between chunks in milliseconds (default: 500) */
    chunkInterval?: number;

    /** Format for audio chunks (default: 'wav') */
    chunkFormat?: ChunkFormat;

    /** Target sample rate for chunks (default: 16000) */
    chunkSampleRate?: number;

    /** Number of channels for chunks (default: 1) */
    chunkChannels?: number;
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

// Real-time chunk streaming types
export type ChunkFormat = 'raw' | 'pcm' | 'wav' | 'webm';

export interface AudioChunk {
    /** Audio data in requested format */
    data: ArrayBuffer;

    /** Format of the audio data */
    format: ChunkFormat;

    /** Sample rate of the audio */
    sampleRate: number;

    /** Number of channels */
    channelCount: number;

    /** Timestamp in milliseconds since recording start */
    timestamp: number;

    /** Duration of this chunk in milliseconds */
    duration: number;
}

export type AudioChunkCallback = (chunk: AudioChunk) => void;

// Playlist Manager Types
export interface PlaylistItem {
    /** Unique identifier for the track */
    id: string;

    /** URL of the audio file */
    url: string;

    /** Display title of the track */
    title: string;

    /** Duration in seconds */
    duration: number;

    /** Additional metadata */
    metadata: Record<string, any>;
}

export type PlayMode = 'sequential' | 'repeat' | 'repeatOne';

export interface PlaylistOptions {
    /** AudioStreamer options */
    audioStreamerOptions?: AudioStreamerOptions;
}

export interface PlaylistState {
    /** Current playlist state */
    state: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

    /** Current track being played */
    currentTrack: PlaylistItem | null;

    /** Current track index */
    currentIndex: number;

    /** Total number of tracks */
    totalTracks: number;

    /** Current play mode */
    playMode: PlayMode;

    /** Whether shuffle is enabled */
    isShuffled: boolean;

    /** Whether playback is possible */
    canPlay: boolean;

    /** Whether next track is available */
    canPlayNext: boolean;

    /** Whether previous track is available */
    canPlayPrevious: boolean;

    /** Error message if state is 'error' */
    error?: string;
}

export type PlaylistEventType =
    | 'initialized'
    | 'playlistLoaded'
    | 'playlistCleared'
    | 'trackAdded'
    | 'trackRemoved'
    | 'trackChanged'
    | 'playStart'
    | 'pause'
    | 'trackEnded'
    | 'playlistEnded'
    | 'playModeChanged'
    | 'shuffleToggled'
    | 'stateChange'
    | 'playError';

export interface PlaylistEvent {
    type: PlaylistEventType;
    data?: any;
    timestamp: number;
}

export type PlaylistEventCallback = (event: PlaylistEvent) => void;

// Sound Effects Manager Types
export type SoundEffectKey = string | number | symbol;

export interface SoundEffectItem {
    /** Unique key for the sound effect */
    key: SoundEffectKey;

    /** URL of the sound effect */
    url: string;

    /** Display title */
    title: string;

    /** Duration in seconds */
    duration: number;

    /** Volume level (0-1) */
    volume: number;

    /** Whether to loop the sound */
    loop: boolean;

    /** Whether to preload the sound */
    preload: boolean;

    /** Additional metadata */
    metadata: Record<string, any>;
}

export interface SoundEffectOptions {
    /** Enable persistent caching using IndexedDB */
    enableCaching?: boolean;

    /** IndexedDB database name for caching */
    cacheDbName?: string;

    /** IndexedDB store name for sound effects */
    cacheStoreName?: string;

    /** Maximum number of concurrent sounds */
    maxConcurrentSounds?: number;

    /** Default volume for all sounds (0-1) */
    defaultVolume?: number;

    /** Whether to preload sounds on registration */
    preloadSounds?: boolean;

    /** AudioStreamer options for advanced features */
    audioStreamerOptions?: AudioStreamerOptions;

    /** Optional AudioContextManager for better mobile support */
    useAudioContext?: boolean;
}

export interface SoundEffectState {
    /** Current state */
    state: 'idle' | 'loading' | 'playing' | 'error';

    /** Number of loaded sounds */
    loadedSounds: number;

    /** Total number of registered sounds */
    totalSounds: number;

    /** Number of currently playing sounds */
    activeSounds: number;

    /** Whether sounds can be played */
    canPlay: boolean;

    /** Error message if state is 'error' */
    error: string | null;
}

export type SoundEffectEventType =
    | 'initialized'
    | 'soundRegistered'
    | 'soundRemoved'
    | 'soundPlayed'
    | 'soundStopped'
    | 'soundEnded'
    | 'allSoundsStopped'
    | 'allSoundsCleared'
    | 'soundPreloaded'
    | 'preloadError'
    | 'volumeChanged'
    | 'autoplayBlocked'
    | 'playError'
    | 'stateChange';

export interface SoundEffectEvent {
    type: SoundEffectEventType;
    data?: any;
    timestamp: number;
}

export type SoundEffectEventCallback = (event: SoundEffectEvent) => void;

// AudioContextManager Types
export type PlatformType = 'ios' | 'android' | 'desktop' | 'safari';

export interface AudioContextManagerState {
    /** Current platform type */
    platform: PlatformType;

    /** Whether audio context is locked (needs user gesture) */
    isLocked: boolean;

    /** Audio context state */
    contextState: 'suspended' | 'running' | 'closed' | 'interrupted';

    /** Whether auto-unlock is registered */
    autoUnlockRegistered: boolean;

    /** Whether iOS audio has been unlocked for silent mode bypass */
    iosAudioUnlocked?: boolean;
}

export interface AudioContextManagerOptions {
    /** Sample rate for the audio context */
    sampleRate?: number;

    /** Latency hint for the audio context */
    latencyHint?: AudioContextLatencyCategory;

    /** Whether to automatically try to unlock on first user gesture */
    autoUnlock?: boolean;

    /** 
     * iOS AudioSession type for audio routing. 
     * - 'playback': For audio output only (default, optimized speaker volume)
     * - 'play-and-record': For apps that also capture mic (required for STT/voice apps)
     * Using 'play-and-record' when mic is active prevents iOS from toggling audio 
     * session types which causes volume fluctuations.
     */
    audioSessionType?: 'playback' | 'play-and-record';
}

// BeatDetector Types

/** Available beat detection algorithms */
export type BeatDetectionAlgorithm = 
    | 'energy' 
    | 'spectral-flux' 
    | 'frequency-band' 
    | 'comb-filter';

export interface BeatDetectorOptions {
    /** Detection algorithm to use (default: 'energy') */
    algorithm?: BeatDetectionAlgorithm;

    /** Sensitivity for beat detection (0.5-5.0, default: 2.0) */
    sensitivity?: number;

    /** Cooldown period between beats in milliseconds (default: 200) */
    cooldown?: number;

    /** Low frequency range for bass detection (0-1, default: 0) */
    frequencyRangeLow?: number;

    /** High frequency range for bass detection (0-1, default: 0.15) */
    frequencyRangeHigh?: number;

    /** Size of energy history buffer in frames (default: 43) */
    energyHistorySize?: number;

    /** Minimum energy threshold to detect beats (0-1, default: 0.01) */
    minEnergyThreshold?: number;

    /** FFT size for frequency analysis (default: 512, 1024, 2048, 4096) */
    fftSize?: number;

    /** Smoothing time constant for analyser (0-1, default: 0.8) */
    smoothingTimeConstant?: number;
}

export interface BeatDetectorState {
    /** Whether beat detection is running */
    isRunning: boolean;

    /** Current algorithm being used */
    algorithm: BeatDetectionAlgorithm;

    /** Timestamp of last detected beat */
    lastBeatTime: number | null;

    /** Average energy level */
    avgEnergy: number;

    /** Current instant energy level */
    currentEnergy: number;

    /** Total number of beats detected */
    beatCount: number;

    /** Estimated BPM (if available) */
    estimatedBPM: number | null;

    /** Current configuration */
    config: Required<BeatDetectorOptions>;
}

export interface BeatEvent {
    /** Timestamp of the beat */
    timestamp: number;

    /** Beat strength relative to threshold */
    strength: number;

    /** Instant energy level (0-1) */
    energy: number;

    /** Average energy level (0-1) */
    avgEnergy: number;

    /** Confidence score (0-1) */
    confidence: number;

    /** Algorithm that detected this beat */
    algorithm: BeatDetectionAlgorithm;

    /** Estimated BPM at time of detection (if available) */
    bpm?: number;
}

export type BeatDetectorEventType =
    | 'beat'
    | 'started'
    | 'stopped'
    | 'error'
    | 'bpm-updated';

export interface BeatDetectorEvent {
    type: BeatDetectorEventType;
    data?: any;
    timestamp: number;
}

export type BeatDetectorEventCallback = (event: BeatDetectorEvent) => void;

export class BeatDetectionError extends AudioStreamingError {
    constructor(message: string, originalError?: Error) {
        super(message, 'BEAT_DETECTION_ERROR', undefined, originalError);
    }
}
