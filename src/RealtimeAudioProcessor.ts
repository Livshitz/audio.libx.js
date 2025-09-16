/**
 * RealtimeAudioProcessor - Real-time audio processing and analysis
 * Provides live audio effects, level monitoring, and silence detection
 */

import { RealtimeProcessingOptions, RealtimeAudioData, AudioEffect, ProcessingError } from './types.js';

export class RealtimeAudioProcessor {
    private _audioContext: AudioContext | null = null;
    private _sourceNode: MediaStreamAudioSourceNode | null = null;
    private _analyserNode: AnalyserNode | null = null;
    private _gainNode: GainNode | null = null;
    private _outputGainNode: GainNode | null = null;
    private _filterNode: BiquadFilterNode | null = null;
    private _effectNodes: Map<string, AudioNode> = new Map();
    private _options: RealtimeProcessingOptions;
    private _isProcessing: boolean = false;
    private _animationFrame: number | null = null;
    private _callbacks: {
        onAudioData?: (data: RealtimeAudioData) => void;
        onSilenceDetected?: (isSilence: boolean) => void;
        onLevelUpdate?: (level: number) => void;
    } = {};

    constructor(options: RealtimeProcessingOptions = {}) {
        this._options = {
            enableSilenceDetection: options.enableSilenceDetection ?? true,
            silenceThresholdDb: options.silenceThresholdDb ?? -50,
            enableLevelMonitoring: options.enableLevelMonitoring ?? true,
            levelUpdateInterval: options.levelUpdateInterval ?? 100,
            enableEffects: options.enableEffects ?? false,
            effects: options.effects ?? [],
        };
    }

    /**
     * Initialize processor with media stream
     */
    public async initialize(mediaStream: MediaStream): Promise<void> {
        try {
            // Create AudioContext
            this._audioContext = new AudioContext();

            // Resume if suspended
            if (this._audioContext.state === 'suspended') {
                await this._audioContext.resume();
            }

            // Create source node from media stream
            this._sourceNode = this._audioContext.createMediaStreamSource(mediaStream);

            // Set up processing chain
            await this._setupProcessingChain();

            console.log('RealtimeAudioProcessor initialized with sample rate:', this._audioContext.sampleRate);
        } catch (error) {
            console.error('Failed to initialize RealtimeAudioProcessor:', error);
            throw new ProcessingError('Failed to initialize RealtimeAudioProcessor', undefined, error as Error);
        }
    }

    private async _setupProcessingChain(): Promise<void> {
        if (!this._audioContext || !this._sourceNode) {
            throw new ProcessingError('AudioContext or source node not available');
        }

        // Set up gain node for volume control
        this._gainNode = this._audioContext.createGain();
        this._gainNode.gain.value = 1.0;

        // Set up filter node for basic EQ
        this._filterNode = this._audioContext.createBiquadFilter();
        this._filterNode.type = 'allpass';
        this._filterNode.frequency.value = 1000;

        // Set up analyser node for monitoring
        this._analyserNode = this._audioContext.createAnalyser();
        this._analyserNode.fftSize = 2048;
        this._analyserNode.smoothingTimeConstant = 0.8;

        // Set up output gain node for volume control
        this._outputGainNode = this._audioContext.createGain();
        this._outputGainNode.gain.value = 0.3; // Start with low volume to avoid feedback
        this._outputGainNode.connect(this._audioContext.destination);

        // Build the full processing chain
        await this._rebuildProcessingChain();

        console.log('Processing chain setup complete');
    }

    private async _applyEffects(inputNode: AudioNode): Promise<AudioNode> {
        if (!this._audioContext || !this._options.effects) {
            return inputNode;
        }

        let currentNode = inputNode;

        for (const effect of this._options.effects) {
            if (!effect.enabled) continue;

            try {
                const effectNode = await this._createEffectNode(effect);
                if (effectNode) {
                    currentNode.connect(effectNode);
                    currentNode = effectNode;
                    this._effectNodes.set(effect.type, effectNode);
                }
            } catch (error) {
                console.warn(`Failed to create effect ${effect.type}:`, error);
            }
        }

        return currentNode;
    }

    private async _createEffectNode(effect: AudioEffect): Promise<AudioNode | null> {
        if (!this._audioContext) return null;

        switch (effect.type) {
            case 'gain':
                const gainNode = this._audioContext.createGain();
                gainNode.gain.value = effect.parameters.gain ?? 1.0;
                return gainNode;

            case 'filter':
                const filterNode = this._audioContext.createBiquadFilter();
                filterNode.type = effect.parameters.type ?? 'lowpass';
                filterNode.frequency.value = effect.parameters.frequency ?? 1000;
                filterNode.Q.value = effect.parameters.Q ?? 1;
                return filterNode;

            case 'reverb':
                return await this._createReverbNode(effect.parameters);

            case 'echo':
                return this._createEchoNode(effect.parameters);

            default:
                console.warn(`Unknown effect type: ${effect.type}`);
                return null;
        }
    }

    private async _createReverbNode(parameters: any): Promise<AudioNode | null> {
        if (!this._audioContext) return null;

        try {
            const convolver = this._audioContext.createConvolver();

            // Create impulse response for reverb
            const length = this._audioContext.sampleRate * (parameters.duration ?? 2);
            const impulse = this._audioContext.createBuffer(2, length, this._audioContext.sampleRate);

            const decay = parameters.decay ?? 0.5;

            for (let channel = 0; channel < 2; channel++) {
                const channelData = impulse.getChannelData(channel);
                for (let i = 0; i < length; i++) {
                    channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
                }
            }

            convolver.buffer = impulse;
            return convolver;
        } catch (error) {
            console.warn('Failed to create reverb effect:', error);
            return null;
        }
    }

    private _createEchoNode(parameters: any): AudioNode | null {
        if (!this._audioContext) return null;

        try {
            const delay = this._audioContext.createDelay();
            const feedback = this._audioContext.createGain();
            const output = this._audioContext.createGain();

            delay.delayTime.value = parameters.delay ?? 0.3;
            feedback.gain.value = parameters.feedback ?? 0.3;
            output.gain.value = parameters.wet ?? 0.5;

            // Create echo feedback loop
            delay.connect(feedback);
            feedback.connect(delay);
            delay.connect(output);

            return output;
        } catch (error) {
            console.warn('Failed to create echo effect:', error);
            return null;
        }
    }

    /**
     * Start real-time processing
     */
    public startProcessing(): void {
        if (this._isProcessing || !this._analyserNode) {
            return;
        }

        this._isProcessing = true;
        this._processAudioFrame();
        console.log('Real-time processing started');
    }

    /**
     * Stop real-time processing
     */
    public stopProcessing(): void {
        this._isProcessing = false;

        if (this._animationFrame) {
            cancelAnimationFrame(this._animationFrame);
            this._animationFrame = null;
        }

        console.log('Real-time processing stopped');
    }

    private _processAudioFrame(): void {
        if (!this._isProcessing || !this._analyserNode || !this._audioContext) {
            return;
        }

        const bufferLength = this._analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const floatArray = new Float32Array(bufferLength);

        // Get frequency data
        this._analyserNode.getByteFrequencyData(dataArray);
        this._analyserNode.getFloatFrequencyData(floatArray);

        // Calculate audio level
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const level = rms / 255; // Normalize to 0-1

        // Convert to dB
        const dbLevel = 20 * Math.log10(level + 0.0001); // Add small value to avoid log(0)

        // Silence detection
        let isSilence = false;
        if (this._options.enableSilenceDetection) {
            isSilence = dbLevel < (this._options.silenceThresholdDb || -50);

            if (this._callbacks.onSilenceDetected) {
                this._callbacks.onSilenceDetected(isSilence);
            }
        }

        // Level monitoring
        if (this._options.enableLevelMonitoring && this._callbacks.onLevelUpdate) {
            this._callbacks.onLevelUpdate(level);
        }

        // Create real-time audio data
        const realtimeData: RealtimeAudioData = {
            audioData: floatArray,
            sampleRate: this._audioContext.sampleRate,
            channels: 1, // Assuming mono for analysis
            level,
            isSilence,
            timestamp: Date.now(),
        };

        // Debug logging (only log occasionally to avoid spam)
        if (Math.random() < 0.01) {
            // Log 1% of the time
            console.log('Processing audio frame:', {
                level: level.toFixed(3),
                dbLevel: dbLevel.toFixed(1),
                isSilence,
                bufferLength,
                hasCallbacks: !!this._callbacks.onAudioData,
            });
        }

        // Emit audio data
        if (this._callbacks.onAudioData) {
            this._callbacks.onAudioData(realtimeData);
        }

        // Schedule next frame
        this._animationFrame = requestAnimationFrame(() => this._processAudioFrame());
    }

    /**
     * Set callback for audio data updates
     */
    public onAudioData(callback: (data: RealtimeAudioData) => void): void {
        this._callbacks.onAudioData = callback;
    }

    /**
     * Set callback for silence detection
     */
    public onSilenceDetected(callback: (isSilence: boolean) => void): void {
        this._callbacks.onSilenceDetected = callback;
    }

    /**
     * Set callback for level updates
     */
    public onLevelUpdate(callback: (level: number) => void): void {
        this._callbacks.onLevelUpdate = callback;
    }

    /**
     * Update processing options
     */
    public updateOptions(options: Partial<RealtimeProcessingOptions>): void {
        this._options = { ...this._options, ...options };

        // Update effects if changed
        if (options.effects && this._audioContext) {
            this._rebuildProcessingChain();
        }
    }

    /**
     * Enable/disable all effects
     */
    public setEffectsEnabled(enabled: boolean): void {
        this._options.enableEffects = enabled;
        console.log(`Effects ${enabled ? 'enabled' : 'disabled'}. Rebuilding processing chain.`);
        this._rebuildProcessingChain().catch((error) => {
            console.warn('Failed to rebuild processing chain for effects toggle:', error);
        });
    }

    private async _rebuildProcessingChain(): Promise<void> {
        if (!this._audioContext || !this._sourceNode || !this._gainNode || !this._filterNode || !this._analyserNode || !this._outputGainNode) {
            console.warn('Cannot rebuild chain: essential nodes are missing.');
            return;
        }

        console.log('Disconnecting all nodes before rebuilding...');
        this._sourceNode.disconnect();
        this._gainNode.disconnect();
        this._filterNode.disconnect();
        this._analyserNode.disconnect();
        for (const node of this._effectNodes.values()) {
            node.disconnect();
        }
        this._effectNodes.clear();

        let currentNode: AudioNode = this._sourceNode;

        currentNode.connect(this._gainNode);
        currentNode = this._gainNode;

        currentNode.connect(this._filterNode);
        currentNode = this._filterNode;

        if (this._options.enableEffects) {
            console.log('Applying effects...');
            currentNode = await this._applyEffects(currentNode);
        }

        currentNode.connect(this._analyserNode);

        currentNode.connect(this._outputGainNode);

        console.log('Processing chain rebuilt successfully.');
    }

    /**
     * Adjust input volume (gain)
     */
    public setVolume(volume: number): void {
        if (this._gainNode) {
            this._gainNode.gain.value = Math.max(0, Math.min(2, volume)); // Clamp between 0 and 2
        }
    }

    /**
     * Adjust output volume (what you hear)
     */
    public setOutputVolume(volume: number): void {
        if (this._outputGainNode) {
            this._outputGainNode.gain.value = Math.max(0, Math.min(1, volume)); // Clamp between 0 and 1
        }
    }

    /**
     * Mute/unmute output
     */
    public setOutputMuted(muted: boolean): void {
        if (this._outputGainNode) {
            this._outputGainNode.gain.value = muted ? 0 : 0.3; // 0.3 is default volume
        }
    }

    /**
     * Apply basic EQ filter
     */
    public setFilter(type: BiquadFilterType, frequency: number, Q: number = 1): void {
        if (this._filterNode) {
            this._filterNode.type = type;
            this._filterNode.frequency.value = frequency;
            this._filterNode.Q.value = Q;
        }
    }

    /**
     * Enable/disable specific effect
     */
    public toggleEffect(effectType: string, enabled: boolean): void {
        const effect = this._options.effects?.find((e) => e.type === effectType);
        if (effect) {
            effect.enabled = enabled;
            this._rebuildProcessingChain();
        }
    }

    /**
     * Get current audio level
     */
    public getCurrentLevel(): number {
        if (!this._analyserNode) return 0;

        const bufferLength = this._analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this._analyserNode.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        return rms / 255; // Normalize to 0-1
    }

    /**
     * Get frequency analysis data
     */
    public getFrequencyData(): Uint8Array | null {
        if (!this._analyserNode) return null;

        const bufferLength = this._analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this._analyserNode.getByteFrequencyData(dataArray);
        return dataArray;
    }

    /**
     * Get time domain data (waveform)
     */
    public getWaveformData(): Uint8Array | null {
        if (!this._analyserNode) return null;

        const bufferLength = this._analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this._analyserNode.getByteTimeDomainData(dataArray);
        return dataArray;
    }

    /**
     * Create a processed output stream (for recording processed audio)
     */
    public createProcessedStream(): MediaStream | null {
        if (!this._audioContext || !this._analyserNode) return null;

        try {
            // Create MediaStreamDestination to capture processed audio
            const destination = this._audioContext.createMediaStreamDestination();
            this._analyserNode.connect(destination);
            return destination.stream;
        } catch (error) {
            console.warn('Failed to create processed stream:', error);
            return null;
        }
    }

    /**
     * Get processor capabilities
     */
    public getCapabilities() {
        return {
            isSupported: typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined',
            hasAnalyser: this._analyserNode !== null,
            isProcessing: this._isProcessing,
            supportedEffects: ['gain', 'filter', 'reverb', 'echo'],
            sampleRate: this._audioContext?.sampleRate,
            currentOptions: { ...this._options },
        };
    }

    /**
     * Dispose and cleanup resources
     */
    public dispose(): void {
        // Stop processing
        this.stopProcessing();

        // Disconnect all nodes
        if (this._sourceNode) {
            try {
                this._sourceNode.disconnect();
            } catch (error) {
                // Ignore disconnect errors
            }
        }

        if (this._gainNode) {
            try {
                this._gainNode.disconnect();
            } catch (error) {
                // Ignore disconnect errors
            }
        }

        if (this._outputGainNode) {
            try {
                this._outputGainNode.disconnect();
            } catch (error) {
                // Ignore disconnect errors
            }
        }

        if (this._filterNode) {
            try {
                this._filterNode.disconnect();
            } catch (error) {
                // Ignore disconnect errors
            }
        }

        if (this._analyserNode) {
            try {
                this._analyserNode.disconnect();
            } catch (error) {
                // Ignore disconnect errors
            }
        }

        // Disconnect effect nodes
        for (const [type, node] of this._effectNodes) {
            try {
                node.disconnect();
            } catch (error) {
                // Ignore disconnect errors
            }
        }

        // Close AudioContext
        if (this._audioContext && this._audioContext.state !== 'closed') {
            this._audioContext.close();
        }

        // Clear references
        this._audioContext = null;
        this._sourceNode = null;
        this._analyserNode = null;
        this._gainNode = null;
        this._outputGainNode = null;
        this._filterNode = null;
        this._effectNodes.clear();
        this._callbacks = {};

        console.log('RealtimeAudioProcessor disposed');
    }
}
