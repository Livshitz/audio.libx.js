# audio.libx.js

[![npm version](https://badge.fury.io/js/audio.libx.js.svg)](https://badge.fury.io/js/audio.libx.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)

A comprehensive progressive audio streaming library for web browsers that enables real-time playback while downloading, with intelligent caching and advanced audio processing capabilities.

## 🚀 Features

- **Progressive Streaming**: Start playing audio immediately while downloading using MediaSource Extensions
- **Intelligent Caching**: Persistent storage using IndexedDB with smart cache management
- **Silence Trimming**: Automatically remove leading/trailing silence from audio
- **Cross-Platform**: Support for both standard MediaSource and iOS 17.1+ ManagedMediaSource
- **Format Detection**: Automatic detection and handling of MP3, WAV, WebM, and OGG formats
- **Promise-Based API**: Modern async/await support with comprehensive event system
- **Memory Efficient**: Chunked processing to minimize memory usage
- **TypeScript Support**: Full type definitions included

## 📦 Installation

```bash
npm install audio.libx.js
```

## 🎵 Quick Start

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