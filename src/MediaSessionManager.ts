/**
 * MediaSessionManager - Integrates with browser's Media Session API
 * Provides lock screen controls, background playback, and system-level media integration
 * Works with iOS Safari, Android Chrome, and desktop browsers
 */

export interface MediaSessionMetadata {
	title?: string;
	artist?: string;
	album?: string;
	artwork?: MediaImage[];
}

export interface MediaSessionCallbacks {
	onPlay?: () => void | Promise<void>;
	onPause?: () => void;
	onSeek?: (time: number) => void;
	onSeekBackward?: (offset?: number) => void;
	onSeekForward?: (offset?: number) => void;
	onPreviousTrack?: () => void;
	onNextTrack?: () => void;
	onStop?: () => void;
}

export interface MediaSessionOptions {
	metadata?: MediaSessionMetadata;
	callbacks?: MediaSessionCallbacks;
	seekBackwardOffset?: number;  // Default: 10 seconds
	seekForwardOffset?: number;   // Default: 10 seconds
	autoUpdatePosition?: boolean; // Default: true
}

export class MediaSessionManager {
	private _audioElement?: HTMLAudioElement;
	private _callbacks: MediaSessionCallbacks = {};
	private _options: Required<Omit<MediaSessionOptions, 'metadata' | 'callbacks'>>;
	private _isSupported: boolean;
	private _positionUpdateInterval?: ReturnType<typeof setInterval>;

	constructor(options: MediaSessionOptions = {}) {
		this._isSupported = this._checkSupport();
		this._options = {
			seekBackwardOffset: options.seekBackwardOffset ?? 10,
			seekForwardOffset: options.seekForwardOffset ?? 10,
			autoUpdatePosition: options.autoUpdatePosition ?? true,
		};

		if (!this._isSupported) {
			console.log('[MediaSession] API not supported in this browser');
			return;
		}

		if (options.callbacks) {
			this._callbacks = options.callbacks;
		}

		this._setupActionHandlers();

		if (options.metadata) {
			this.updateMetadata(options.metadata);
		}
	}

	/**
	 * Connect to an audio element for automatic position updates
	 */
	public connectAudioElement(audioElement: HTMLAudioElement): void {
		this._audioElement = audioElement;

		if (this._options.autoUpdatePosition) {
			this._setupAudioListeners();
		}
	}

	/**
	 * Update metadata (title, artist, album, artwork)
	 */
	public updateMetadata(metadata: MediaSessionMetadata): void {
		if (!this._isSupported) return;

		try {
			const artwork: MediaImage[] = metadata.artwork || [];

			// If no artwork provided, use a default or empty array
			const artworkArray = artwork.length > 0 ? artwork : [];

			navigator.mediaSession.metadata = new MediaMetadata({
				title: metadata.title || 'Unknown Title',
				artist: metadata.artist || 'Unknown Artist',
				album: metadata.album || '',
				artwork: artworkArray,
			});

			console.log('[MediaSession] Metadata updated:', {
				title: metadata.title,
				artist: metadata.artist,
				hasArtwork: artwork.length > 0,
			});
		} catch (error) {
			console.warn('[MediaSession] Failed to update metadata:', error);
		}
	}

	/**
	 * Update playback state (playing, paused, none)
	 */
	public updatePlaybackState(state: 'playing' | 'paused' | 'none'): void {
		if (!this._isSupported) return;

		try {
			navigator.mediaSession.playbackState = state;
		} catch (error) {
			console.warn('[MediaSession] Failed to update playback state:', error);
		}
	}

	/**
	 * Update position state for scrubbing support
	 */
	public updatePositionState(currentTime: number, duration: number, playbackRate: number = 1): void {
		if (!this._isSupported || !navigator.mediaSession.setPositionState) return;

		try {
			navigator.mediaSession.setPositionState({
				duration: duration || 0,
				playbackRate: playbackRate,
				position: Math.min(currentTime, duration || currentTime),
			});
		} catch (error) {
			// Ignore errors (can happen if values are invalid)
		}
	}

	/**
	 * Update callbacks dynamically
	 */
	public updateCallbacks(callbacks: MediaSessionCallbacks): void {
		this._callbacks = { ...this._callbacks, ...callbacks };
		this._setupActionHandlers();
	}

	/**
	 * Cleanup and dispose
	 */
	public dispose(): void {
		if (this._positionUpdateInterval) {
			clearInterval(this._positionUpdateInterval);
		}

		if (this._isSupported) {
			try {
				// Clear all action handlers
				const actions: MediaSessionAction[] = [
					'play', 'pause', 'seekto', 'seekbackward', 'seekforward',
					'previoustrack', 'nexttrack', 'stop'
				];

				actions.forEach(action => {
					try {
						navigator.mediaSession.setActionHandler(action, null);
					} catch (e) {
						// Action not supported, ignore
					}
				});

				navigator.mediaSession.metadata = null;
			} catch (error) {
				console.warn('[MediaSession] Cleanup error:', error);
			}
		}
	}

	private _checkSupport(): boolean {
		return typeof navigator !== 'undefined' &&
			'mediaSession' in navigator &&
			'MediaMetadata' in window;
	}

	private _setupActionHandlers(): void {
		if (!this._isSupported) return;

		// Play
		this._setActionHandler('play', async () => {
			if (this._callbacks.onPlay) {
				await this._callbacks.onPlay();
				this.updatePlaybackState('playing');
			}
		});

		// Pause
		this._setActionHandler('pause', () => {
			if (this._callbacks.onPause) {
				this._callbacks.onPause();
				this.updatePlaybackState('paused');
			}
		});

		// Seek to
		this._setActionHandler('seekto', (details) => {
			if (this._callbacks.onSeek && details.seekTime !== undefined) {
				this._callbacks.onSeek(details.seekTime);
			}
		});

		// Seek backward
		this._setActionHandler('seekbackward', () => {
			if (this._callbacks.onSeekBackward) {
				this._callbacks.onSeekBackward(this._options.seekBackwardOffset);
			} else if (this._audioElement) {
				this._audioElement.currentTime = Math.max(0, this._audioElement.currentTime - this._options.seekBackwardOffset);
			}
		});

		// Seek forward
		this._setActionHandler('seekforward', () => {
			if (this._callbacks.onSeekForward) {
				this._callbacks.onSeekForward(this._options.seekForwardOffset);
			} else if (this._audioElement) {
				this._audioElement.currentTime = Math.min(
					this._audioElement.duration || this._audioElement.currentTime,
					this._audioElement.currentTime + this._options.seekForwardOffset
				);
			}
		});

		// Previous track
		this._setActionHandler('previoustrack', () => {
			if (this._callbacks.onPreviousTrack) {
				this._callbacks.onPreviousTrack();
			}
		});

		// Next track
		this._setActionHandler('nexttrack', () => {
			if (this._callbacks.onNextTrack) {
				this._callbacks.onNextTrack();
			}
		});

		// Stop
		this._setActionHandler('stop', () => {
			if (this._callbacks.onStop) {
				this._callbacks.onStop();
			} else if (this._audioElement) {
				this._audioElement.pause();
				this._audioElement.currentTime = 0;
				this.updatePlaybackState('none');
			}
		});

		console.log('[MediaSession] Action handlers initialized');
	}

	private _setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler): void {
		try {
			navigator.mediaSession.setActionHandler(action, handler);
		} catch (error) {
			// Action not supported, ignore silently
		}
	}

	private _setupAudioListeners(): void {
		if (!this._audioElement) return;

		// Update position state on time update
		this._audioElement.addEventListener('timeupdate', () => {
			if (this._audioElement) {
				this.updatePositionState(
					this._audioElement.currentTime,
					this._audioElement.duration,
					this._audioElement.playbackRate
				);
			}
		});

		// Update playback state on play/pause/ended
		this._audioElement.addEventListener('play', () => {
			this.updatePlaybackState('playing');
		});

		this._audioElement.addEventListener('pause', () => {
			this.updatePlaybackState('paused');
		});

		this._audioElement.addEventListener('ended', () => {
			this.updatePlaybackState('none');
		});

		console.log('[MediaSession] Auto-sync with audio element enabled');
	}
}

