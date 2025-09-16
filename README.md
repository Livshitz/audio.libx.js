# audio.libx.js

[![npm version](https://badge.fury.io/js/audio.libx.js.svg)](https://badge.fury.io/js/audio.libx.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)

A comprehensive audio library for web browsers that provides both progressive streaming playback and advanced recording capabilities, with intelligent caching and real-time audio processing.

## 🚀 Features

### 🎵 Audio Playback
- **Progressive Streaming**: Start playing audio immediately while downloading using MediaSource Extensions
- **Intelligent Caching**: Persistent storage using IndexedDB with smart cache management
- **Silence Trimming**: Automatically remove leading/trailing silence from audio
- **Cross-Platform**: Support for both standard MediaSource and iOS 17.1+ ManagedMediaSource
- **Format Detection**: Automatic detection and handling of MP3, WAV, WebM, and OGG formats

### 🎤 Audio Recording
- **MediaRecorder Integration**: Cross-browser audio recording with format optimization
- **Permission Management**: Robust microphone permission handling with detailed error guidance
- **Real-time Processing**: Live audio level monitoring, silence detection, and effects
- **Multiple Formats**: Support for WebM, MP4, WAV, and other browser-supported formats
- **Recording Controls**: Start, stop, pause, resume functionality with event-driven API

### 🔧 General Features
- **Promise-Based API**: Modern async/await support with comprehensive event system
- **Memory Efficient**: Chunked processing to minimize memory usage
- **TypeScript Support**: Full type definitions included
- **Browser Compatibility**: Extensive cross-browser support with Safari optimizations

## 📦 Installation

```bash
npm install audio.libx.js
```

## 🎵 Quick Start

### Audio Streaming
```typescript
import { createAudioStreamer } from 'audio.libx.js';

// Get your audio element
const audioElement = document.getElementById('audio') as HTMLAudioElement;

// Create streamer with options
const streamer = createAudioStreamer(audioElement, {
    bufferThreshold: 5,      // Start playing after 5 seconds buffered
    enableCaching: true,     // Enable persistent caching
    enableTrimming: true     // Enable silence trimming
});

// Stream audio from URL
try {
    const result = await streamer.streamFromUrl('https://example.com/audio.mp3');
    
    // Wait for audio to be ready
    await result.onLoaded;
    console.log('Audio is ready to play!');
    
    // Wait for playback to complete
    await result.onEnded;
    console.log('Playback finished!');
    
} catch (error) {
    console.error('Streaming failed:', error);
}
```

### Audio Recording
```typescript
import { createAudioRecorder } from 'audio.libx.js';

// Create recorder with options
const recorder = createAudioRecorder({
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 128000,
    enableRealtimeProcessing: true
});

// Set up event listeners
recorder.on('recordingStarted', (event) => {
    console.log('Recording started:', event.recordingId);
});

recorder.on('audioLevel', (event) => {
    console.log('Audio level:', event.data);
});

recorder.on('recordingCompleted', (event) => {
    console.log('Recording completed:', event.data);
    // event.data contains the recorded audio blob
});

// Start recording
try {
    const recording = await recorder.startRecording();
    
    // Wait for recording to start
    await recording.onStarted;
    console.log('Recording is active!');
    
    // Stop recording after some time or user action
    const recordedData = await recording.stop();
    console.log('Recording finished:', recordedData);
    
} catch (error) {
    console.error('Recording failed:', error);
}
```

## 🔧 API Reference

### AudioStreamer

The main class for audio streaming operations.

#### Constructor

```typescript
const streamer = new AudioStreamer(audioElement: HTMLAudioElement, options?: AudioStreamerOptions);
```

#### Methods

##### `streamFromUrl(url: string, audioId?: string): Promise<StreamResult>`

Stream audio from a URL with automatic caching.

```typescript
const result = await streamer.streamFromUrl('https://example.com/track.mp3');
await result.onLoaded; // Audio ready to play
await result.onEnded;  // Playback complete
```

##### `streamFromResponse(response: Response, audioId?: string): Promise<StreamResult>`

Stream audio from a fetch Response object.

```typescript
const response = await fetch('/api/audio/track');
const result = await streamer.streamFromResponse(response);
```

##### `playFromCache(audioId: string): Promise<StreamResult>`

Play previously cached audio by ID.

```typescript
const result = await streamer.playFromCache('my-audio-id');
```

##### `initialize(): Promise<void>`

Initialize the streamer (called automatically on first use).

##### `getState(): StreamingState`

Get current streaming state.

```typescript
const state = streamer.getState();
console.log(state.state); // 'idle', 'loading', 'streaming', 'playing', etc.
```

##### `getCacheStats(): Promise<CacheStats>`

Get cache statistics.

```typescript
const stats = await streamer.getCacheStats();
console.log(`Cache size: ${stats.totalSize} bytes`);
console.log(`Hit ratio: ${stats.hitRatio * 100}%`);
```

##### `clearCache(): Promise<void>`

Clear all cached audio.

##### `dispose(): void`

Clean up resources and event listeners.

### AudioRecorder

The main class for audio recording operations.

#### Constructor

```typescript
const recorder = new AudioRecorder(options?: AudioRecorderOptions);
```

#### Methods

##### `startRecording(recordingId?: string): Promise<RecordingResult>`

Start recording audio with automatic permission handling.

```typescript
const recording = await recorder.startRecording();
await recording.onStarted; // Recording active
const data = await recording.stop(); // Stop and get data
```

##### `stopRecording(): Promise<RecordingData>`

Stop current recording and return the recorded data.

```typescript
const recordedData = await recorder.stopRecording();
console.log('Duration:', recordedData.duration);
console.log('Size:', recordedData.blob.size);
```

##### `pauseRecording(): void`

Pause current recording (if supported by browser).

##### `resumeRecording(): void`

Resume paused recording (if supported by browser).

##### `cancelRecording(): void`

Cancel current recording and discard data.

##### `getState(): RecordingState`

Get current recording state.

```typescript
const state = recorder.getState();
console.log('State:', state.state); // 'idle', 'recording', 'paused', etc.
console.log('Duration:', state.duration);
console.log('Has permission:', state.hasPermission);
```

##### `getCapabilities()`

Get recorder capabilities and supported formats.

```typescript
const caps = recorder.getCapabilities();
console.log('Supported MIME types:', caps.supportedMimeTypes);
console.log('Can pause:', caps.canPause);
```

#### Events

Subscribe to recording events:

```typescript
recorder.on('permissionRequested', (event) => {
    console.log('Requesting permission...');
});

recorder.on('recordingStarted', (event) => {
    console.log('Recording started:', event.recordingId);
});

recorder.on('audioLevel', (event) => {
    console.log('Audio level:', event.data);
});

recorder.on('durationUpdate', (event) => {
    console.log('Duration:', event.data, 'ms');
});

recorder.on('recordingError', (event) => {
    console.error('Recording error:', event.data);
});
```

Available events:
- `permissionRequested` - Permission request started
- `permissionGranted` - Permission granted
- `permissionDenied` - Permission denied
- `recordingStarted` - Recording started
- `recordingPaused` - Recording paused
- `recordingResumed` - Recording resumed
- `recordingStopped` - Recording stopped
- `recordingCompleted` - Recording completed with data
- `recordingCancelled` - Recording cancelled
- `audioLevel` - Real-time audio level updates
- `durationUpdate` - Recording duration updates
- `recordingError` - Error occurred

### PermissionManager

Singleton class for managing microphone permissions.

#### Methods

##### `PermissionManager.getInstance(): PermissionManager`

Get the singleton instance.

##### `requestPermission(constraints?: MediaConstraintsOptions): Promise<PermissionResult>`

Request microphone permission with optional constraints.

```typescript
const permissionManager = PermissionManager.getInstance();
const result = await permissionManager.requestPermission({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
});

if (result.granted) {
    console.log('Permission granted!');
    // result.stream contains the MediaStream
} else {
    console.error('Permission denied:', result.error);
}
```

##### `checkPermissionState(): Promise<PermissionState>`

Check current permission state without requesting.

##### `testMicrophoneAccess(): Promise<PermissionResult>`

Test microphone access without keeping the stream.

##### `getPermissionErrorGuidance(error: PermissionError): string[]`

Get user-friendly guidance for permission errors.

##### `getBrowserSpecificGuidance(): string[]`

Get browser-specific setup instructions.

### RealtimeAudioProcessor

Real-time audio processing and effects.

#### Constructor

```typescript
const processor = new RealtimeAudioProcessor(options?: RealtimeProcessingOptions);
```

#### Methods

##### `initialize(mediaStream: MediaStream): Promise<void>`

Initialize processor with a media stream.

##### `startProcessing(): void`

Start real-time audio processing.

##### `stopProcessing(): void`

Stop real-time processing.

##### `onAudioData(callback: (data: RealtimeAudioData) => void): void`

Set callback for real-time audio data updates.

```typescript
processor.onAudioData((data) => {
    console.log('Audio level:', data.level);
    console.log('Is silence:', data.isSilence);
    console.log('Sample rate:', data.sampleRate);
});
```

##### `setVolume(volume: number): void`

Adjust volume (0-2, where 1 is normal).

##### `setFilter(type: BiquadFilterType, frequency: number, Q?: number): void`

Apply basic EQ filter.

```typescript
processor.setFilter('lowpass', 1000, 1);
```

#### Events

Subscribe to streaming events:

```typescript
streamer.on('stateChange', (event) => {
    console.log('State changed to:', event.data.state);
});

streamer.on('bufferProgress', (event) => {
    console.log('Buffer progress:', event.data * 100 + '%');
});

streamer.on('cacheHit', (event) => {
    console.log('Cache hit for:', event.audioId);
});

streamer.on('error', (event) => {
    console.error('Streaming error:', event.data);
});
```

Available events:
- `stateChange` - Streaming state changes
- `bufferProgress` - Buffer loading progress
- `canPlay` - Audio ready for playback
- `loadStart` - Loading started
- `loadEnd` - Loading completed
- `playStart` - Playback started
- `playEnd` - Playback ended
- `error` - Error occurred
- `cacheHit` - Audio found in cache
- `cacheMiss` - Audio not in cache

### Configuration Options

```typescript
interface AudioStreamerOptions {
    bufferThreshold?: number;        // Buffer threshold in seconds (default: 5)
    enableCaching?: boolean;         // Enable caching (default: true)
    enableTrimming?: boolean;        // Enable silence trimming (default: true)
    mimeType?: string;              // Force specific MIME type
    silenceThresholdDb?: number;    // Silence threshold in dB (default: -50)
    minSilenceMs?: number;          // Min silence duration in ms (default: 100)
    cacheDbName?: string;           // IndexedDB database name
    cacheStoreName?: string;        // IndexedDB store name
}
```

## 🎛️ Advanced Usage

### Custom Audio Processing

```typescript
import { AudioProcessor } from 'audio.libx.js';

const processor = new AudioProcessor();

// Process audio chunks with custom options
const result = await processor.processAudio(chunks, {
    trimSilence: true,
    silenceThresholdDb: -40,
    minSilenceMs: 200,
    outputFormat: 'wav'
});

// Get processed audio as blob
const audioBlob = result.blob;
```

### Cache Management

```typescript
import { AudioCache } from 'audio.libx.js';

const cache = new AudioCache('my-app-cache', 'audio-store');
await cache.initialize();

// Store audio chunks
await cache.set('audio-id', chunks, 'audio/mpeg');

// Retrieve audio chunks  
const chunks = await cache.get('audio-id');

// Cleanup old entries
const deletedCount = await cache.cleanup({
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    maxEntries: 100,
    minAccessCount: 2
});
```

### MediaSource Utilities

```typescript
import { MediaSourceHelper } from 'audio.libx.js';

const helper = MediaSourceHelper.getInstance();

// Check capabilities
const capabilities = helper.getCapabilities();
console.log('Supported MIME types:', capabilities.supportedMimeTypes);

// Detect audio format
const format = helper.detectAudioFormat(audioData);
console.log('Detected format:', format.type); // 'mp3', 'wav', etc.

// Create MediaSource with cross-platform support
const mediaSourceInfo = helper.createMediaSource();
```

## 🌐 Browser Compatibility

- **Chrome/Edge**: Full support
- **Firefox**: Full support  
- **Safari**: Full support (uses ManagedMediaSource on iOS 17.1+)
- **Mobile**: Optimized for mobile browsers

### Requirements

- MediaSource Extensions support
- IndexedDB support (for caching)
- Web Audio API support (for audio processing)

## 📱 Mobile Considerations

The library automatically handles mobile-specific optimizations:

- Uses `ManagedMediaSource` on iOS 17.1+ for better performance
- Adaptive buffering based on connection speed
- Memory-efficient chunk processing
- Touch interaction handling for audio context initialization

## 🔍 Examples

Check out the `/examples` directory for complete working examples:

- **Basic Usage**: Simple streaming with default options
- **Advanced Configuration**: Custom options and event handling
- **Cache Management**: Working with the cache system
- **Audio Processing**: Custom audio processing workflows

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run tests
npm test

# Watch mode for development
npm run dev

# Format code
npm run format
```

## 📊 Performance

The library is optimized for performance:

- **Memory Usage**: Chunked processing keeps memory usage low
- **Network Efficiency**: Progressive streaming reduces initial load time
- **Cache Performance**: Smart caching reduces redundant downloads
- **Processing Speed**: Efficient audio processing with Web Audio API

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our GitHub repository.

## 📄 License

MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

This library was inspired by reverse-engineering advanced audio streaming mechanisms and aims to provide a production-ready solution for progressive audio streaming in web applications.

---

**audio.libx.js** - Making audio streaming seamless and efficient for modern web applications.