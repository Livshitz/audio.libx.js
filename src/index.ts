/**
 * audio.libx.js - Progressive Audio Streaming Library
 * 
 * A comprehensive library for streaming audio content with real-time playback,
 * intelligent caching, and advanced audio processing capabilities.
 * 
 * Features:
 * - Progressive streaming with MediaSource Extensions
 * - Persistent caching using IndexedDB
 * - Silence trimming and audio processing
 * - Cross-platform compatibility (iOS ManagedMediaSource support)
 * - Format detection and conversion
 * - Promise-based API with event system
 * 
 * @author Livshitz
 */

// Core exports
export { AudioStreamer } from './AudioStreamer.js';
export { AudioCache } from './AudioCache.js';
export { AudioProcessor } from './AudioProcessor.js';
export { MediaSourceHelper } from './MediaSourceHelper.js';

// Recording exports
export { AudioRecorder } from './AudioRecorder.js';
export { PermissionManager } from './PermissionManager.js';
export { RealtimeAudioProcessor } from './RealtimeAudioProcessor.js';

// Playlist and Sound Effects exports
export { PlaylistManager } from './PlaylistManager.js';
export { SoundEffectsManager } from './SoundEffectsManager.js';

// Type exports
export type {
    AudioStreamerOptions,
    StreamResult,
    StreamingState,
    StreamingEvent,
    StreamingEventType,
    StreamingEventCallback,
    AudioCacheEntry,
    AudioProcessingResult,
    MediaSourceInfo,
    AudioFormat,
    ChunkAppendOptions,
    CacheStats,
    // Recording types
    AudioRecorderOptions,
    RecordingState,
    RecordingResult,
    RecordingData,
    RecordingEvent,
    RecordingEventType,
    RecordingEventCallback,
    PermissionState,
    PermissionResult,
    MediaConstraintsOptions,
    RealtimeProcessingOptions,
    RealtimeAudioData,
    AudioEffect,
    // Playlist types
    PlaylistItem,
    PlayMode,
    PlaylistOptions,
    PlaylistState,
    PlaylistEvent,
    PlaylistEventType,
    PlaylistEventCallback,
    // Sound Effects types
    SoundEffectKey,
    SoundEffectItem,
    SoundEffectOptions,
    SoundEffectState,
    SoundEffectEvent,
    SoundEffectEventType,
    SoundEffectEventCallback,
} from './types.js';

// Error exports
export { AudioStreamingError, MediaSourceError, CacheError, ProcessingError, RecordingError, PermissionError } from './types.js';

// Convenience factory functions
export function createAudioStreamer(
    audioElement: HTMLAudioElement,
    options?: import('./types.js').AudioStreamerOptions
): AudioStreamer {
    return new AudioStreamer(audioElement, options);
}

export function createAudioRecorder(options?: import('./types.js').AudioRecorderOptions): AudioRecorder {
    return new AudioRecorder(options);
}

export function createPlaylistManager(audioElement: HTMLAudioElement, options?: import('./types.js').PlaylistOptions): PlaylistManager {
    return new PlaylistManager(audioElement, options);
}

export function createSoundEffectsManager(options?: import('./types.js').SoundEffectOptions): SoundEffectsManager {
    return new SoundEffectsManager(options);
}

// Default export for CommonJS compatibility
import { AudioStreamer } from './AudioStreamer.js';
import { AudioRecorder } from './AudioRecorder.js';
import { PlaylistManager } from './PlaylistManager.js';
import { SoundEffectsManager } from './SoundEffectsManager.js';
export default AudioStreamer;
