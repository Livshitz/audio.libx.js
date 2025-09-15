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
    CacheStats
} from './types.js';

// Error exports
export {
    AudioStreamingError,
    MediaSourceError,
    CacheError,
    ProcessingError
} from './types.js';

// Convenience factory function
export function createAudioStreamer(
    audioElement: HTMLAudioElement,
    options?: import('./types.js').AudioStreamerOptions
): AudioStreamer {
    return new AudioStreamer(audioElement, options);
}

// Default export for CommonJS compatibility
import { AudioStreamer } from './AudioStreamer.js';
export default AudioStreamer;
