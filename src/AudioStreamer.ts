/**
 * AudioStreamer - Main orchestrator class for progressive audio streaming
 * Combines MediaSource streaming, caching, and audio processing capabilities
 */

import { MediaSourceHelper } from './MediaSourceHelper.js';
import { AudioCache } from './AudioCache.js';
import { AudioProcessor } from './AudioProcessor.js';
import {
	AudioStreamerOptions,
	StreamResult,
	StreamingState,
	StreamingEvent,
	StreamingEventCallback,
	StreamingEventType,
	AudioStreamingError,
	MediaSourceError,
	ChunkAppendOptions
} from './types.js';

export class AudioStreamer {
	private _mediaSourceHelper: MediaSourceHelper;
	private _cache: AudioCache;
	private _processor: AudioProcessor;
	private _options: Required<AudioStreamerOptions>;
	private _audioElement: HTMLAudioElement;
	private _state: StreamingState;
	private _eventCallbacks: Map<StreamingEventType, StreamingEventCallback[]> = new Map();
	private _activeStreams: Map<string, AbortController> = new Map();
	private _isInitialized: boolean = false;

	constructor(
		audioElement: HTMLAudioElement,
		options: AudioStreamerOptions = {}
	) {
		this._audioElement = audioElement;
		this._options = {
			bufferThreshold: options.bufferThreshold ?? 5,
			enableCaching: options.enableCaching ?? true,
			enableTrimming: options.enableTrimming ?? true,
			mimeType: options.mimeType ?? '',
			silenceThresholdDb: options.silenceThresholdDb ?? -50,
			minSilenceMs: options.minSilenceMs ?? 100,
			cacheDbName: options.cacheDbName ?? 'sound-libx-cache',
			cacheStoreName: options.cacheStoreName ?? 'audio-tracks'
		};

		this._mediaSourceHelper = MediaSourceHelper.getInstance();
		this._cache = new AudioCache(this._options.cacheDbName, this._options.cacheStoreName);
		this._processor = new AudioProcessor();

		this._state = {
			state: 'idle',
			bufferProgress: 0,
			canPlay: false
		};

		this._setupAudioElementListeners();
	}

	/**
	 * Initialize the streamer
	 */
	public async initialize(): Promise<void> {
		if (this._isInitialized) return;

		try {
			if (this._options.enableCaching) {
				await this._cache.initialize();
			}
			this._isInitialized = true;
			this._emitEvent('loadStart');
		} catch (error) {
			throw new AudioStreamingError(
				'Failed to initialize AudioStreamer',
				'INITIALIZATION_ERROR',
				undefined,
				error as Error
			);
		}
	}

	/**
	 * Stream audio from a Response object
	 */
	public async streamFromResponse(
		response: Response,
		audioId?: string,
		options: { justCache?: boolean; } = {}
	): Promise<StreamResult> {
		await this.initialize();

		const id = audioId || this._generateId();
		const abortController = new AbortController();
		this._activeStreams.set(id, abortController);

		const onLoadedPromise = this._createPromise<string>();
		const onEndedPromise = this._createPromise<string>();

		try {
			// Check cache first
			if (this._options.enableCaching) {
				const cachedChunks = await this._cache.get(id);
				if (cachedChunks) {
					this._emitEvent('cacheHit', id);
					return await this._playFromCache(id, cachedChunks, onLoadedPromise, onEndedPromise);
				}
			}

			this._emitEvent('cacheMiss', id);

			// Stream from response
			if (!options.justCache) {
				// Start streaming immediately for playback
				this._streamForPlayback(response.clone(), id, onLoadedPromise, abortController.signal);
			}

			// Cache the response
			await this._cacheFromResponse(response, id, abortController.signal);

			if (options.justCache) {
				onLoadedPromise.resolve(id);
				onEndedPromise.resolve(id);
			}

		} catch (error) {
			this._activeStreams.delete(id);
			onLoadedPromise.reject(error);
			onEndedPromise.reject(error);
			this._emitEvent('error', id, error);
		}

		return {
			audioId: id,
			onLoaded: onLoadedPromise.promise,
			onEnded: onEndedPromise.promise,
			cancel: () => this._cancelStream(id)
		};
	}

	/**
	 * Stream audio from a URL
	 */
	public async streamFromUrl(
		url: string,
		audioId?: string,
		options: { justCache?: boolean; } = {}
	): Promise<StreamResult> {
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
			return this.streamFromResponse(response, audioId, options);
		} catch (error) {
			throw new AudioStreamingError(
				`Failed to fetch audio from URL: ${url}`,
				'FETCH_ERROR',
				audioId,
				error as Error
			);
		}
	}

	/**
	 * Play cached audio by ID
	 */
	public async playFromCache(audioId: string): Promise<StreamResult> {
		await this.initialize();

		if (!this._options.enableCaching) {
			throw new AudioStreamingError('Caching is disabled', 'CACHE_DISABLED', audioId);
		}

		const cachedChunks = await this._cache.get(audioId);
		if (!cachedChunks) {
			throw new AudioStreamingError('Audio not found in cache', 'CACHE_MISS', audioId);
		}

		const onLoadedPromise = this._createPromise<string>();
		const onEndedPromise = this._createPromise<string>();

		return this._playFromCache(audioId, cachedChunks, onLoadedPromise, onEndedPromise);
	}

	private async _playFromCache(
		audioId: string,
		chunks: Uint8Array[],
		onLoadedPromise: { promise: Promise<string>; resolve: (value: string) => void; reject: (error: any) => void; },
		onEndedPromise: { promise: Promise<string>; resolve: (value: string) => void; reject: (error: any) => void; }
	): Promise<StreamResult> {
		try {
			this._setState('loading', audioId);
			this._resetAudioElement();

			if (this._options.enableTrimming) {
				// Process and play as WAV
				const result = await this._processor.processAudio(chunks, {
					trimSilence: true,
					silenceThresholdDb: this._options.silenceThresholdDb,
					minSilenceMs: this._options.minSilenceMs,
					outputFormat: 'wav'
				});

				this._audioElement.src = URL.createObjectURL(result.blob);
				onLoadedPromise.resolve(audioId);
			} else {
				// Play using MediaSource
				const mediaSource = await this._createMediaSourceFromChunks(chunks, audioId, onLoadedPromise);
				this._audioElement.src = URL.createObjectURL(mediaSource.mediaSource);
			}

			this._setupPlaybackPromises(audioId, onEndedPromise);

			return {
				audioId,
				onLoaded: onLoadedPromise.promise,
				onEnded: onEndedPromise.promise,
				cancel: () => this._cancelStream(audioId)
			};

		} catch (error) {
			onLoadedPromise.reject(error);
			onEndedPromise.reject(error);
			throw error;
		}
	}

	private async _streamForPlayback(
		response: Response,
		audioId: string,
		onLoadedPromise: { promise: Promise<string>; resolve: (value: string) => void; reject: (error: any) => void; },
		signal: AbortSignal
	): Promise<void> {
		try {
			this._setState('streaming', audioId);
			this._resetAudioElement();

			// Read first chunk to detect format before creating MediaSource
			const reader = response.body!.getReader();
			const { value: firstChunk } = await reader.read();

			if (!firstChunk || signal.aborted) return;

			const format = this._mediaSourceHelper.detectAudioFormat(firstChunk);
			console.log('Streaming - Detected audio format:', format);

			// Handle WAV files that require conversion - use direct URL streaming
			if (format.requiresConversion && format.type === 'wav') {
				console.log('WAV file detected in streaming - using direct URL streaming (HTML audio element)');

				// Cancel the current reader since we'll let HTML audio handle the streaming
				reader.cancel();

				// Use the original URL directly - let HTML audio element handle progressive loading
				this._audioElement.src = response.url;

				// Set up event listeners for consistent behavior
				this._audioElement.addEventListener('canplay', () => {
					console.log('WAV file ready for playback');
					this._audioElement.play().catch(error => {
						console.warn('Auto-play failed for WAV file:', error);
					});
				}, { once: true });

				this._audioElement.addEventListener('play', () => {
					this._setState('playing', audioId);
				}, { once: true });

				this._audioElement.addEventListener('loadstart', () => {
					console.log('WAV file started loading');
				}, { once: true });

				this._audioElement.addEventListener('progress', () => {
					// Update buffer progress based on HTML audio buffering
					if (this._audioElement.buffered.length > 0) {
						const bufferedEnd = this._audioElement.buffered.end(this._audioElement.buffered.length - 1);
						const duration = this._audioElement.duration || 1;
						const progress = bufferedEnd / duration;
						this._emitEvent('bufferProgress', audioId, progress);
					}
				});

				onLoadedPromise.resolve(audioId);
				return;
			}

			// For supported formats, continue with MediaSource streaming
			const mediaSourceInfo = this._mediaSourceHelper.createMediaSource();
			this._audioElement.src = URL.createObjectURL(mediaSourceInfo.mediaSource);

			await this._waitForSourceOpen(mediaSourceInfo.mediaSource);

			const mimeType = this._options.mimeType || this._mediaSourceHelper.getBestMimeType(format);
			console.log('Streaming - Selected MIME type:', mimeType);

			const sourceBuffer = await this._mediaSourceHelper.createSourceBuffer(
				mediaSourceInfo.mediaSource,
				mimeType
			);

			// Append first chunk
			await this._mediaSourceHelper.appendToSourceBuffer(sourceBuffer, firstChunk);

			let playbackStarted = false;
			let streamEnded = false;

			// Continue reading and appending chunks
			while (!streamEnded && !signal.aborted) {
				const { done, value } = await reader.read();

				if (done) {
					streamEnded = true;
					break;
				}

				await this._mediaSourceHelper.appendToSourceBuffer(sourceBuffer, value);

				// Start playback when buffer threshold is met
				if (!playbackStarted && this._isBufferSufficient()) {
					playbackStarted = true;
					onLoadedPromise.resolve(audioId);
					this._setState('playing', audioId);
					this._emitEvent('canPlay', audioId);

					try {
						await this._audioElement.play();
						this._emitEvent('playStart', audioId);
					} catch (playError) {
						console.warn('Playback failed:', playError);
					}
				}
			}

			// End the stream
			if (streamEnded && !signal.aborted) {
				try {
					mediaSourceInfo.mediaSource.endOfStream();
				} catch (endError) {
					console.warn('endOfStream error:', endError);
				}
			}

			// If playback never started, start it now
			if (!playbackStarted && !signal.aborted) {
				onLoadedPromise.resolve(audioId);
				this._setState('playing', audioId);
				try {
					await this._audioElement.play();
					this._emitEvent('playStart', audioId);
				} catch (playError) {
					console.warn('Final playback attempt failed:', playError);
				}
			}

		} catch (error) {
			if (!signal.aborted) {
				onLoadedPromise.reject(error);
				this._emitEvent('error', audioId, error);
			}
		}
	}

	private async _cacheFromResponse(
		response: Response,
		audioId: string,
		signal: AbortSignal
	): Promise<void> {
		if (!this._options.enableCaching) return;

		try {
			const reader = response.body!.getReader();
			const chunks: Uint8Array[] = [];
			let mimeType = response.headers.get('content-type') || 'audio/mpeg';

			while (!signal.aborted) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
			}

			if (!signal.aborted && chunks.length > 0) {
				await this._cache.set(audioId, chunks, mimeType);
			}

		} catch (error) {
			console.warn('Failed to cache audio:', error);
		}
	}

	private async _createMediaSourceFromChunks(
		chunks: Uint8Array[],
		audioId: string,
		onLoadedPromise: { promise: Promise<string>; resolve: (value: string) => void; reject: (error: any) => void; }
	): Promise<{ mediaSource: MediaSource; }> {
		const mediaSourceInfo = this._mediaSourceHelper.createMediaSource();

		const sourceOpenPromise = this._waitForSourceOpen(mediaSourceInfo.mediaSource);

		sourceOpenPromise.then(async () => {
			try {
				const format = this._mediaSourceHelper.detectAudioFormat(chunks[0]);
				console.log('Detected audio format:', format);
				let processedChunks = chunks;
				let mimeType = this._options.mimeType || this._mediaSourceHelper.getBestMimeType(format);
				console.log('Selected MIME type:', mimeType);

				// Handle WAV files that require conversion
				if (format.requiresConversion && format.type === 'wav') {
					console.log('WAV file detected - MediaSource does not support WAV/PCM, falling back to regular audio element');

					// For WAV files, skip MediaSource entirely and use regular HTML audio
					// This provides better compatibility and avoids complex conversion issues
					let audioBlob: Blob;

					if (this._options.enableTrimming) {
						try {
							// Process audio for trimming, but still use blob URL approach
							const processingResult = await this._processor.processAudio(chunks, {
								trimSilence: true,
								silenceThresholdDb: this._options.silenceThresholdDb,
								minSilenceMs: this._options.minSilenceMs,
								outputFormat: 'wav',
								stripID3: false
							});
							audioBlob = processingResult.blob;
							console.log('WAV file processed for silence trimming');
						} catch (processingError) {
							console.warn('WAV processing failed, using original file:', processingError);
							audioBlob = new Blob(chunks as BlobPart[], { type: format.mimeType });
						}
					} else {
						// Use original WAV data
						audioBlob = new Blob(chunks as BlobPart[], { type: format.mimeType });
					}

					const url = URL.createObjectURL(audioBlob);
					this._audioElement.src = url;

					// Clean up the URL when audio ends
					this._audioElement.addEventListener('ended', () => {
						URL.revokeObjectURL(url);
					}, { once: true });

					// Wait for the audio to be ready, then start playback automatically
					this._audioElement.addEventListener('canplay', () => {
						this._audioElement.play().catch(error => {
							console.warn('Auto-play failed for WAV file:', error);
						});
					}, { once: true });

					// Set up play event listener to update state when playback actually starts
					this._audioElement.addEventListener('play', () => {
						this._setState('playing', audioId);
					}, { once: true });

					onLoadedPromise.resolve(audioId);
					return;
				}

				const sourceBuffer = await this._mediaSourceHelper.createSourceBuffer(
					mediaSourceInfo.mediaSource,
					mimeType
				);

				// Append chunks sequentially
				for (let i = 0; i < processedChunks.length; i++) {
					await this._mediaSourceHelper.appendToSourceBuffer(sourceBuffer, processedChunks[i]);
				}

				// End the stream
				try {
					mediaSourceInfo.mediaSource.endOfStream();
				} catch (endError) {
					console.warn('endOfStream error:', endError);
				}

				onLoadedPromise.resolve(audioId);

			} catch (error) {
				onLoadedPromise.reject(error);
			}
		}).catch(error => {
			onLoadedPromise.reject(error);
		});

		return { mediaSource: mediaSourceInfo.mediaSource };
	}

	private _waitForSourceOpen(mediaSource: MediaSource): Promise<void> {
		return new Promise((resolve, reject) => {
			if (mediaSource.readyState === 'open') {
				resolve();
				return;
			}

			const onSourceOpen = () => {
				mediaSource.removeEventListener('sourceopen', onSourceOpen);
				mediaSource.removeEventListener('error', onError);
				resolve();
			};

			const onError = (event: Event) => {
				mediaSource.removeEventListener('sourceopen', onSourceOpen);
				mediaSource.removeEventListener('error', onError);
				reject(new MediaSourceError('MediaSource failed to open', undefined, event as any));
			};

			mediaSource.addEventListener('sourceopen', onSourceOpen, { once: true });
			mediaSource.addEventListener('error', onError, { once: true });
		});
	}

	private _setupAudioElementListeners(): void {
		this._audioElement.addEventListener('canplay', () => {
			this._state.canPlay = true;
			this._emitEvent('canPlay', this._state.currentAudioId);
		});

		this._audioElement.addEventListener('ended', () => {
			this._setState('ended', this._state.currentAudioId);
			this._emitEvent('playEnd', this._state.currentAudioId);
		});

		this._audioElement.addEventListener('error', (event) => {
			this._setState('error', this._state.currentAudioId, (event.target as HTMLAudioElement).error?.message);
			this._emitEvent('error', this._state.currentAudioId, event);
		});

		this._audioElement.addEventListener('progress', () => {
			this._updateBufferProgress();
		});
	}

	private _setupPlaybackPromises(
		audioId: string,
		onEndedPromise: { promise: Promise<string>; resolve: (value: string) => void; reject: (error: any) => void; }
	): void {
		const onEnded = () => {
			this._audioElement.removeEventListener('ended', onEnded);
			this._audioElement.removeEventListener('error', onError);
			onEndedPromise.resolve(audioId);
		};

		const onError = (event: Event) => {
			this._audioElement.removeEventListener('ended', onEnded);
			this._audioElement.removeEventListener('error', onError);
			onEndedPromise.reject(new AudioStreamingError(
				'Playback error',
				'PLAYBACK_ERROR',
				audioId,
				(event.target as HTMLAudioElement).error as unknown as Error
			));
		};

		this._audioElement.addEventListener('ended', onEnded, { once: true });
		this._audioElement.addEventListener('error', onError, { once: true });
	}

	private _resetAudioElement(): void {
		this._audioElement.pause();
		this._audioElement.removeAttribute('src');
		this._audioElement.load();
	}

	private _isBufferSufficient(): boolean {
		if (this._audioElement.buffered.length === 0) return false;

		const bufferedEnd = this._audioElement.buffered.end(0);
		return bufferedEnd >= this._options.bufferThreshold;
	}

	private _updateBufferProgress(): void {
		if (this._audioElement.buffered.length > 0) {
			const bufferedEnd = this._audioElement.buffered.end(0);
			const duration = this._audioElement.duration || bufferedEnd;
			this._state.bufferProgress = Math.min(bufferedEnd / duration, 1);
			this._emitEvent('bufferProgress', this._state.currentAudioId, this._state.bufferProgress);
		}
	}

	private _setState(state: StreamingState['state'], audioId?: string, error?: string): void {
		this._state.state = state;
		this._state.currentAudioId = audioId;
		if (error) {
			this._state.error = error;
		}
		this._emitEvent('stateChange', audioId, { state, error });
	}

	private _cancelStream(audioId: string): void {
		const abortController = this._activeStreams.get(audioId);
		if (abortController) {
			abortController.abort();
			this._activeStreams.delete(audioId);
		}
	}

	private _generateId(): string {
		return `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	private _createPromise<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: any) => void; } {
		let resolve: (value: T) => void;
		let reject: (error: any) => void;

		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});

		return { promise, resolve: resolve!, reject: reject! };
	}

	private _emitEvent(type: StreamingEventType, audioId?: string, data?: any): void {
		const callbacks = this._eventCallbacks.get(type);
		if (callbacks) {
			const event: StreamingEvent = {
				type,
				audioId,
				data,
				timestamp: Date.now()
			};

			callbacks.forEach(callback => {
				try {
					callback(event);
				} catch (error) {
					console.error('Event callback error:', error);
				}
			});
		}
	}

	/**
	 * Event subscription methods
	 */
	public on(eventType: StreamingEventType, callback: StreamingEventCallback): void {
		if (!this._eventCallbacks.has(eventType)) {
			this._eventCallbacks.set(eventType, []);
		}
		this._eventCallbacks.get(eventType)!.push(callback);
	}

	public off(eventType: StreamingEventType, callback: StreamingEventCallback): void {
		const callbacks = this._eventCallbacks.get(eventType);
		if (callbacks) {
			const index = callbacks.indexOf(callback);
			if (index > -1) {
				callbacks.splice(index, 1);
			}
		}
	}

	/**
	 * Utility methods
	 */
	public getState(): StreamingState {
		return { ...this._state };
	}

	public async getCacheStats() {
		if (!this._options.enableCaching) {
			throw new AudioStreamingError('Caching is disabled', 'CACHE_DISABLED');
		}
		return this._cache.getStats();
	}

	public async clearCache(): Promise<void> {
		if (!this._options.enableCaching) {
			throw new AudioStreamingError('Caching is disabled', 'CACHE_DISABLED');
		}
		await this._cache.clear();
	}

	public getCapabilities() {
		return {
			mediaSource: this._mediaSourceHelper.getCapabilities(),
			processor: this._processor.getCapabilities(),
			caching: this._options.enableCaching
		};
	}

	/**
	 * Cleanup and disposal
	 */
	public dispose(): void {
		// Cancel all active streams
		for (const [audioId, controller] of this._activeStreams) {
			controller.abort();
		}
		this._activeStreams.clear();

		// Clear event listeners
		this._eventCallbacks.clear();

		// Close cache
		this._cache.close();

		// Dispose processor
		this._processor.dispose();

		// Reset audio element
		this._resetAudioElement();

		this._isInitialized = false;
	}
}
