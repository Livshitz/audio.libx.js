/**
 * AudioRecorder - MediaRecorder-based audio recording with real-time features
 * Handles cross-browser recording with comprehensive state management and event system
 */

import { PermissionManager } from './PermissionManager.js';
import {
    AudioRecorderOptions,
    RecordingState,
    RecordingResult,
    RecordingData,
    RecordingEvent,
    RecordingEventCallback,
    RecordingEventType,
    RecordingError,
    PermissionError,
    RealtimeProcessingOptions,
    RealtimeAudioData,
} from './types.js';

export class AudioRecorder {
    private _permissionManager: PermissionManager;
    private _mediaRecorder: MediaRecorder | null = null;
    private _mediaStream: MediaStream | null = null;
    private _audioContext: AudioContext | null = null;
    private _analyserNode: AnalyserNode | null = null;
    private _options: Required<AudioRecorderOptions>;
    private _state: RecordingState;
    private _eventCallbacks: Map<RecordingEventType, RecordingEventCallback[]> = new Map();
    private _recordedChunks: Blob[] = [];
    private _startTime: number = 0;
    private _pausedDuration: number = 0;
    private _durationTimer: number | null = null;
    private _levelTimer: number | null = null;
    private _isInitialized: boolean = false;
    private _realtimeProcessing: RealtimeProcessingOptions | null = null;

    constructor(options: AudioRecorderOptions = {}) {
        this._options = {
            mimeType: options.mimeType ?? this._getDefaultMimeType(),
            audioBitsPerSecond: options.audioBitsPerSecond ?? 128000,
            enableEchoCancellation: options.enableEchoCancellation ?? true,
            enableNoiseSuppression: options.enableNoiseSuppression ?? true,
            enableAutoGainControl: options.enableAutoGainControl ?? true,
            maxDuration: options.maxDuration ?? 300000, // 5 minutes default
            enableRealtimeProcessing: options.enableRealtimeProcessing ?? false,
            silenceThresholdDb: options.silenceThresholdDb ?? -50,
        };

        this._permissionManager = PermissionManager.getInstance();

        this._state = {
            state: 'idle',
            duration: 0,
            hasPermission: false,
        };

        if (this._options.enableRealtimeProcessing) {
            this._realtimeProcessing = {
                enableSilenceDetection: true,
                silenceThresholdDb: this._options.silenceThresholdDb,
                enableLevelMonitoring: true,
                levelUpdateInterval: 100,
                enableEffects: false,
                effects: [],
            };
        }
    }

    /**
     * Initialize the recorder
     */
    public async initialize(): Promise<void> {
        if (this._isInitialized) return;

        try {
            // Check permission state
            const permissionState = await this._permissionManager.checkPermissionState();
            this._state.hasPermission = permissionState.status === 'granted';

            this._isInitialized = true;
        } catch (error) {
            throw new RecordingError('Failed to initialize AudioRecorder', undefined, error as Error);
        }
    }

    /**
     * Start recording audio
     */
    public async startRecording(recordingId?: string): Promise<RecordingResult> {
        await this.initialize();

        const id = recordingId || this._generateId();

        // Check if already recording
        if (this._state.state === 'recording') {
            throw new RecordingError('Already recording', id);
        }

        const onStartedPromise = this._createPromise<string>();
        const onCompletedPromise = this._createPromise<RecordingData>();

        try {
            this._setState('requesting-permission', id);
            this._emitEvent('permissionRequested', id);

            // Request microphone permission
            const permissionResult = await this._permissionManager.requestPermission({
                echoCancellation: this._options.enableEchoCancellation,
                noiseSuppression: this._options.enableNoiseSuppression,
                autoGainControl: this._options.enableAutoGainControl,
            });

            if (!permissionResult.granted) {
                this._setState('error', id, permissionResult.error?.message);
                this._emitEvent('permissionDenied', id, permissionResult.error);
                onStartedPromise.reject(permissionResult.error);
                onCompletedPromise.reject(permissionResult.error);
                throw permissionResult.error;
            }

            this._emitEvent('permissionGranted', id);
            this._mediaStream = permissionResult.stream!;
            this._state.hasPermission = true;

            // Set up real-time processing if enabled
            if (this._options.enableRealtimeProcessing) {
                await this._setupRealtimeProcessing();
            }

            // Create MediaRecorder
            await this._createMediaRecorder();

            // Start recording
            this._recordedChunks = [];
            this._startTime = Date.now();
            this._pausedDuration = 0;

            // Start recording with timeslice to collect data periodically
            this._mediaRecorder!.start(1000); // Collect data every 1 second
            this._setState('recording', id);
            this._emitEvent('recordingStarted', id);

            // Start duration timer
            this._startDurationTimer(id);

            // Start level monitoring if enabled
            if (this._options.enableRealtimeProcessing && this._realtimeProcessing?.enableLevelMonitoring) {
                this._startLevelMonitoring(id);
            }

            onStartedPromise.resolve(id);
        } catch (error) {
            this._setState('error', id, (error as Error).message);
            this._emitEvent('recordingError', id, error);
            onStartedPromise.reject(error);
            onCompletedPromise.reject(error);
        }

        return {
            recordingId: id,
            onStarted: onStartedPromise.promise,
            onCompleted: onCompletedPromise.promise,
            stop: () => this.stopRecording(),
            pause: () => this.pauseRecording(),
            resume: () => this.resumeRecording(),
            cancel: () => this.cancelRecording(),
        };
    }

    /**
     * Stop recording and return the recorded data
     */
    public async stopRecording(): Promise<RecordingData> {
        if (this._state.state !== 'recording' && this._state.state !== 'paused') {
            throw new RecordingError('Not currently recording', this._state.recordingId);
        }

        const recordingId = this._state.recordingId!;

        try {
            this._setState('processing', recordingId);
            this._emitEvent('recordingStopped', recordingId);

            // Stop timers
            this._stopTimers();

            // Stop MediaRecorder and wait for final data
            if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
                await this._stopMediaRecorderAndWait();
            }

            // Create recording result
            const recordingData = await this._finalizeRecording(recordingId);

            this._setState('completed', recordingId);
            this._emitEvent('recordingCompleted', recordingId, recordingData);

            // Cleanup
            this._cleanup();

            return recordingData;
        } catch (error) {
            this._setState('error', recordingId, (error as Error).message);
            this._emitEvent('recordingError', recordingId, error);
            throw error;
        }
    }

    /**
     * Pause recording (if supported by browser)
     */
    public pauseRecording(): void {
        if (this._state.state !== 'recording') {
            throw new RecordingError('Not currently recording', this._state.recordingId);
        }

        if (!this._mediaRecorder) {
            throw new RecordingError('MediaRecorder not initialized', this._state.recordingId);
        }

        try {
            if (typeof this._mediaRecorder.pause === 'function') {
                this._mediaRecorder.pause();
                this._setState('paused', this._state.recordingId);
                this._emitEvent('recordingPaused', this._state.recordingId);

                // Pause timers
                this._stopTimers();
            } else {
                throw new RecordingError('Pause is not supported in this browser', this._state.recordingId);
            }
        } catch (error) {
            this._emitEvent('recordingError', this._state.recordingId, error);
            throw error;
        }
    }

    /**
     * Resume recording (if supported by browser)
     */
    public resumeRecording(): void {
        if (this._state.state !== 'paused') {
            throw new RecordingError('Recording is not paused', this._state.recordingId);
        }

        if (!this._mediaRecorder) {
            throw new RecordingError('MediaRecorder not initialized', this._state.recordingId);
        }

        try {
            if (typeof this._mediaRecorder.resume === 'function') {
                const pauseStartTime = Date.now();
                this._mediaRecorder.resume();
                this._setState('recording', this._state.recordingId);
                this._emitEvent('recordingResumed', this._state.recordingId);

                // Update paused duration
                this._pausedDuration += Date.now() - pauseStartTime;

                // Resume timers
                this._startDurationTimer(this._state.recordingId!);
                if (this._options.enableRealtimeProcessing && this._realtimeProcessing?.enableLevelMonitoring) {
                    this._startLevelMonitoring(this._state.recordingId!);
                }
            } else {
                throw new RecordingError('Resume is not supported in this browser', this._state.recordingId);
            }
        } catch (error) {
            this._emitEvent('recordingError', this._state.recordingId, error);
            throw error;
        }
    }

    /**
     * Cancel recording and discard data
     */
    public cancelRecording(): void {
        const recordingId = this._state.recordingId;

        try {
            // Stop timers
            this._stopTimers();

            // Stop MediaRecorder without waiting
            if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
                this._mediaRecorder.stop();
            }

            // Clear recorded data
            this._recordedChunks = [];

            this._setState('idle');
            this._emitEvent('recordingCancelled', recordingId);

            // Cleanup
            this._cleanup();
        } catch (error) {
            this._emitEvent('recordingError', recordingId, error);
        }
    }

    private async _createMediaRecorder(): Promise<void> {
        if (!this._mediaStream) {
            throw new RecordingError('Media stream not available');
        }

        try {
            // Determine the best MIME type
            const mimeType = this._getBestSupportedMimeType();

            const options: MediaRecorderOptions = {
                mimeType,
                audioBitsPerSecond: this._options.audioBitsPerSecond,
            };

            this._mediaRecorder = new MediaRecorder(this._mediaStream, options);

            // Set up event listeners
            this._mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this._recordedChunks.push(event.data);
                    console.log(`Received audio chunk: ${event.data.size} bytes, total chunks: ${this._recordedChunks.length}`);
                }
            };

            this._mediaRecorder.onerror = (event) => {
                const error = new RecordingError(`MediaRecorder error: ${(event as any).error?.message || 'Unknown error'}`, this._state.recordingId);
                this._emitEvent('recordingError', this._state.recordingId, error);
            };

            this._mediaRecorder.onstop = () => {
                console.log('MediaRecorder stopped, total chunks collected:', this._recordedChunks.length);
            };
        } catch (error) {
            throw new RecordingError('Failed to create MediaRecorder', this._state.recordingId, error as Error);
        }
    }

    private async _stopMediaRecorderAndWait(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!this._mediaRecorder) {
                resolve();
                return;
            }

            // Set up a one-time stop event listener
            const stopHandler = () => {
                this._mediaRecorder!.removeEventListener('stop', stopHandler);
                // Give a small delay to ensure all data events are processed
                setTimeout(() => {
                    resolve();
                }, 100);
            };

            this._mediaRecorder.addEventListener('stop', stopHandler);

            // Set up error handler
            const errorHandler = (event: any) => {
                this._mediaRecorder!.removeEventListener('error', errorHandler);
                this._mediaRecorder!.removeEventListener('stop', stopHandler);
                reject(new RecordingError(`MediaRecorder stop error: ${event.error?.message || 'Unknown error'}`));
            };

            this._mediaRecorder.addEventListener('error', errorHandler);

            // Request final data chunk and stop
            this._mediaRecorder.requestData();
            this._mediaRecorder.stop();
        });
    }

    private async _setupRealtimeProcessing(): Promise<void> {
        if (!this._mediaStream) return;

        try {
            // Create AudioContext if not exists
            if (!this._audioContext) {
                this._audioContext = new AudioContext();
            }

            // Resume AudioContext if suspended
            if (this._audioContext.state === 'suspended') {
                await this._audioContext.resume();
            }

            // Create analyser node for real-time analysis
            this._analyserNode = this._audioContext.createAnalyser();
            this._analyserNode.fftSize = 2048;
            this._analyserNode.smoothingTimeConstant = 0.8;

            // Connect media stream to analyser
            const source = this._audioContext.createMediaStreamSource(this._mediaStream);
            source.connect(this._analyserNode);
        } catch (error) {
            console.warn('Failed to setup real-time processing:', error);
            // Continue without real-time processing
        }
    }

    private _startDurationTimer(recordingId: string): void {
        this._durationTimer = window.setInterval(() => {
            if (this._state.state === 'recording') {
                const currentDuration = Date.now() - this._startTime - this._pausedDuration;
                this._state.duration = currentDuration;
                this._emitEvent('durationUpdate', recordingId, currentDuration);

                // Check max duration
                if (currentDuration >= this._options.maxDuration) {
                    this.stopRecording().catch((error) => {
                        this._emitEvent('recordingError', recordingId, error);
                    });
                }
            }
        }, 100);
    }

    private _startLevelMonitoring(recordingId: string): void {
        if (!this._analyserNode || !this._realtimeProcessing) return;

        const bufferLength = this._analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        this._levelTimer = window.setInterval(() => {
            if (this._analyserNode && this._state.state === 'recording') {
                this._analyserNode.getByteFrequencyData(dataArray);

                // Calculate RMS level
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i] * dataArray[i];
                }
                const rms = Math.sqrt(sum / bufferLength);
                const level = rms / 255; // Normalize to 0-1

                this._state.audioLevel = level;
                this._emitEvent('audioLevel', recordingId, level);

                // Silence detection
                if (this._realtimeProcessing.enableSilenceDetection) {
                    const dbLevel = 20 * Math.log10(level + 0.0001); // Add small value to avoid log(0)
                    const isSilence = dbLevel < (this._realtimeProcessing.silenceThresholdDb || -50);

                    // Emit real-time audio data
                    const audioData: RealtimeAudioData = {
                        audioData: new Float32Array(dataArray.length),
                        sampleRate: this._audioContext?.sampleRate || 44100,
                        channels: 1,
                        level,
                        isSilence,
                        timestamp: Date.now(),
                    };

                    // Convert Uint8Array to Float32Array
                    for (let i = 0; i < dataArray.length; i++) {
                        audioData.audioData[i] = (dataArray[i] - 128) / 128;
                    }

                    this._emitEvent('audioLevel', recordingId, audioData);
                }
            }
        }, this._realtimeProcessing.levelUpdateInterval || 100);
    }

    private _stopTimers(): void {
        if (this._durationTimer) {
            clearInterval(this._durationTimer);
            this._durationTimer = null;
        }
        if (this._levelTimer) {
            clearInterval(this._levelTimer);
            this._levelTimer = null;
        }
    }

    private async _finalizeRecording(recordingId: string): Promise<RecordingData> {
        console.log(`Finalizing recording with ${this._recordedChunks.length} chunks`);

        // Log chunk sizes for debugging
        this._recordedChunks.forEach((chunk, index) => {
            console.log(`Chunk ${index}: ${chunk.size} bytes, type: ${chunk.type}`);
        });

        // Combine all recorded chunks
        const mimeType = this._mediaRecorder?.mimeType || this._options.mimeType;
        const blob = new Blob(this._recordedChunks, { type: mimeType });

        console.log(`Final blob created: ${blob.size} bytes, type: ${blob.type}`);

        const endTime = Date.now();
        const duration = endTime - this._startTime - this._pausedDuration;

        const recordingData: RecordingData = {
            id: recordingId,
            blob,
            mimeType,
            duration,
            metadata: {
                startTime: this._startTime,
                endTime,
                sampleRate: this._audioContext?.sampleRate,
                channels: this._mediaStream?.getAudioTracks()[0]?.getSettings()?.channelCount,
                averageLevel: this._state.audioLevel,
            },
        };

        return recordingData;
    }

    private _cleanup(): void {
        // Stop media stream
        if (this._mediaStream) {
            this._mediaStream.getTracks().forEach((track) => track.stop());
            this._mediaStream = null;
        }

        // Close audio context
        if (this._audioContext && this._audioContext.state !== 'closed') {
            this._audioContext.close();
            this._audioContext = null;
        }

        // Clear references
        this._mediaRecorder = null;
        this._analyserNode = null;
        this._recordedChunks = [];

        // Reset state
        this._state.duration = 0;
        this._state.audioLevel = undefined;
    }

    private _getDefaultMimeType(): string {
        // Check supported MIME types in order of preference
        const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/wav'];

        for (const mimeType of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                return mimeType;
            }
        }

        return 'audio/webm'; // Fallback
    }

    private _getBestSupportedMimeType(): string {
        // Use specified MIME type if supported
        if (MediaRecorder.isTypeSupported(this._options.mimeType)) {
            return this._options.mimeType;
        }

        // Find best alternative
        return this._getDefaultMimeType();
    }

    private _generateId(): string {
        return `recording_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private _createPromise<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: any) => void } {
        let resolve: (value: T) => void;
        let reject: (error: any) => void;

        const promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
        });

        return { promise, resolve: resolve!, reject: reject! };
    }

    private _setState(state: RecordingState['state'], recordingId?: string, error?: string): void {
        this._state.state = state;
        this._state.recordingId = recordingId;
        if (error) {
            this._state.error = error;
        }
        // Note: State changes are emitted by specific event handlers, not here
    }

    private _emitEvent(type: RecordingEventType, recordingId?: string, data?: any): void {
        const callbacks = this._eventCallbacks.get(type);
        if (callbacks) {
            const event: RecordingEvent = {
                type,
                recordingId,
                data,
                timestamp: Date.now(),
            };

            callbacks.forEach((callback) => {
                try {
                    callback(event);
                } catch (error) {
                    console.error('Recording event callback error:', error);
                }
            });
        }
    }

    /**
     * Event subscription methods
     */
    public on(eventType: RecordingEventType, callback: RecordingEventCallback): void {
        if (!this._eventCallbacks.has(eventType)) {
            this._eventCallbacks.set(eventType, []);
        }
        this._eventCallbacks.get(eventType)!.push(callback);
    }

    public off(eventType: RecordingEventType, callback: RecordingEventCallback): void {
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
    public getState(): RecordingState {
        return { ...this._state };
    }

    public getCapabilities() {
        return {
            isSupported: typeof MediaRecorder !== 'undefined',
            supportedMimeTypes: this._getSupportedMimeTypes(),
            hasRealtimeProcessing: this._options.enableRealtimeProcessing,
            hasPermission: this._state.hasPermission,
            canPause: typeof MediaRecorder.prototype.pause === 'function',
            canResume: typeof MediaRecorder.prototype.resume === 'function',
        };
    }

    private _getSupportedMimeTypes(): string[] {
        const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm;codecs=vorbis', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/mpeg'];

        return mimeTypes.filter((mimeType) => MediaRecorder.isTypeSupported(mimeType));
    }

    /**
     * Cleanup and disposal
     */
    public dispose(): void {
        // Cancel any active recording
        if (this._state.state === 'recording' || this._state.state === 'paused') {
            this.cancelRecording();
        }

        // Stop timers
        this._stopTimers();

        // Cleanup resources
        this._cleanup();

        // Clear event listeners
        this._eventCallbacks.clear();

        this._isInitialized = false;
    }
}
