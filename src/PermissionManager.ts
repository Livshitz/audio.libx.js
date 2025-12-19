/**
 * PermissionManager - Handles microphone permission requests and state management
 * Provides cross-browser compatible permission handling with detailed error reporting
 */

import { PermissionState, PermissionResult, PermissionError, MediaConstraintsOptions } from './types.js';

export class PermissionManager {
    private static _instance: PermissionManager;
    private _currentStream: MediaStream | null = null;
    private _permissionState: PermissionState = {
        status: 'unknown',
        isSupported: false,
    };

    private constructor() {
        this._initialize();
    }

    public static getInstance(): PermissionManager {
        if (!PermissionManager._instance) {
            PermissionManager._instance = new PermissionManager();
        }
        return PermissionManager._instance;
    }

    private _initialize(): void {
        // Check if getUserMedia is supported
        this._permissionState.isSupported = this._isGetUserMediaSupported();

        // Try to get initial permission state
        if (this._permissionState.isSupported) {
            this._checkInitialPermissionState();
        }
    }

    private _isGetUserMediaSupported(): boolean {
        return !!(
            navigator.mediaDevices?.getUserMedia ||
            (navigator as any).getUserMedia ||
            (navigator as any).webkitGetUserMedia ||
            (navigator as any).mozGetUserMedia ||
            (navigator as any).msGetUserMedia
        );
    }

    private async _checkInitialPermissionState(): Promise<void> {
        // Try to check permission state using Permissions API if available
        if ('permissions' in navigator && 'query' in navigator.permissions) {
            try {
                const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
                this._permissionState.status = permission.state as PermissionState['status'];

                // Listen for permission changes
                permission.addEventListener('change', () => {
                    this._permissionState.status = permission.state as PermissionState['status'];
                });
            } catch (error) {
                // Permissions API not fully supported, will rely on getUserMedia calls
                this._permissionState.status = 'prompt';
            }
        } else {
            this._permissionState.status = 'prompt';
        }
    }

    /**
     * Request microphone permission with optional constraints
     */
    public async requestPermission(constraints: MediaConstraintsOptions = {}): Promise<PermissionResult> {
        if (!this._permissionState.isSupported) {
            const error = new PermissionError('getUserMedia is not supported in this browser');
            return {
                granted: false,
                state: { ...this._permissionState, error },
                error,
            };
        }

        try {
            // Build media constraints
            const mediaConstraints = this._buildMediaConstraints(constraints);

            // Request permission by attempting to get media stream
            const stream = await this._getUserMedia(mediaConstraints);

            // Update permission state
            this._permissionState.status = 'granted';
            this._currentStream = stream;

            return {
                granted: true,
                state: { ...this._permissionState },
                stream,
            };
        } catch (error) {
            const permissionError = this._handlePermissionError(error as Error);
            this._permissionState.error = permissionError;

            return {
                granted: false,
                state: { ...this._permissionState },
                error: permissionError,
            };
        }
    }

    private _buildMediaConstraints(options: MediaConstraintsOptions): MediaStreamConstraints {
        const audioConstraints: MediaTrackConstraints = {
            echoCancellation: options.echoCancellation ?? true,
            noiseSuppression: options.noiseSuppression ?? true,
            autoGainControl: options.autoGainControl ?? true,
        };

        // Add optional constraints if specified
        if (options.deviceId) {
            audioConstraints.deviceId = options.deviceId;
        }
        if (options.sampleRate) {
            audioConstraints.sampleRate = options.sampleRate;
        }
        if (options.channelCount) {
            audioConstraints.channelCount = options.channelCount;
        }

        // Safari compatibility: avoid problematic constraints
        if (this._isSafari()) {
            // Safari can be picky about constraints, use minimal set
            const safariConstraints: MediaTrackConstraints = {
                echoCancellation: audioConstraints.echoCancellation,
                noiseSuppression: audioConstraints.noiseSuppression,
                autoGainControl: audioConstraints.autoGainControl,
            };

            // Include deviceId if specified (Safari supports this)
            if (audioConstraints.deviceId) {
                safariConstraints.deviceId = audioConstraints.deviceId;
            }

            return {
                audio: safariConstraints,
            };
        }

        return { audio: audioConstraints };
    }

    private async _getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
        // Try modern API first
        if (navigator.mediaDevices?.getUserMedia) {
            return await navigator.mediaDevices.getUserMedia(constraints);
        }

        // Fallback to legacy APIs
        const getUserMedia =
            (navigator as any).getUserMedia || (navigator as any).webkitGetUserMedia || (navigator as any).mozGetUserMedia || (navigator as any).msGetUserMedia;

        if (!getUserMedia) {
            throw new Error('getUserMedia is not supported');
        }

        return new Promise<MediaStream>((resolve, reject) => {
            getUserMedia.call(navigator, constraints, resolve, reject);
        });
    }

    private _handlePermissionError(error: Error): PermissionError {
        let message = 'Unknown permission error';
        let status: PermissionState['status'] = 'unknown';

        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            message = 'Microphone access was denied by the user. Please enable microphone permissions in your browser settings.';
            status = 'denied';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            message = 'No microphone device was found. Please check that a microphone is connected and try again.';
            status = 'denied';
        } else if (error.name === 'NotSupportedError') {
            message = 'Microphone access is not supported in this browser or context (HTTPS required).';
            status = 'denied';
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            message = 'The microphone is already in use by another application. Please close other applications using the microphone and try again.';
            status = 'denied';
        } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
            message = 'The requested audio constraints could not be satisfied. Please try with different settings.';
            status = 'denied';
        } else if (error.name === 'SecurityError') {
            message = 'Microphone access blocked due to security restrictions. Please ensure you are using HTTPS and try again.';
            status = 'denied';
        } else if (error.name === 'AbortError') {
            message = 'Permission request was cancelled or interrupted.';
            status = 'prompt';
        }

        this._permissionState.status = status;
        return new PermissionError(message, error);
    }

    /**
     * Check current permission state without requesting
     */
    public async checkPermissionState(): Promise<PermissionState> {
        if (!this._permissionState.isSupported) {
            return { ...this._permissionState };
        }

        // Try to update state using Permissions API if available
        if ('permissions' in navigator && 'query' in navigator.permissions) {
            try {
                const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
                this._permissionState.status = permission.state as PermissionState['status'];
            } catch (error) {
                // Permissions API query failed, keep current state
            }
        }

        return { ...this._permissionState };
    }

    /**
     * Stop current media stream and release resources
     */
    public stopCurrentStream(): void {
        if (this._currentStream) {
            this._currentStream.getTracks().forEach((track) => {
                track.stop();
            });
            this._currentStream = null;
        }
    }

    /**
     * Get current media stream if available
     */
    public getCurrentStream(): MediaStream | null {
        return this._currentStream;
    }

    /**
     * Get user-friendly guidance for permission errors
     */
    public getPermissionErrorGuidance(error: PermissionError): string[] {
        const guidance: string[] = [];

        if (error.message.includes('denied')) {
            guidance.push("Click the microphone icon in your browser's address bar");
            guidance.push('Select "Always allow" for microphone access');
            guidance.push('Refresh the page and try again');
        } else if (error.message.includes('not found')) {
            guidance.push('Check that your microphone is properly connected');
            guidance.push('Try selecting a different microphone in your browser settings');
            guidance.push('Restart your browser if the issue persists');
        } else if (error.message.includes('in use')) {
            guidance.push('Close other applications that might be using your microphone');
            guidance.push('Check for other browser tabs using the microphone');
            guidance.push('Restart your browser if necessary');
        } else if (error.message.includes('HTTPS')) {
            guidance.push('Microphone access requires a secure connection (HTTPS)');
            guidance.push('Try accessing the site via HTTPS');
            guidance.push('Contact the site administrator if the issue persists');
        } else {
            guidance.push('Try refreshing the page');
            guidance.push("Check your browser's microphone permissions");
            guidance.push('Try using a different browser if the issue persists');
        }

        return guidance;
    }

    /**
     * Test microphone access without keeping the stream
     */
    public async testMicrophoneAccess(constraints: MediaConstraintsOptions = {}): Promise<PermissionResult> {
        const result = await this.requestPermission(constraints);

        // Stop the stream immediately since this is just a test
        if (result.stream) {
            result.stream.getTracks().forEach((track) => track.stop());
        }

        return {
            ...result,
            stream: undefined, // Don't return the stream for test calls
        };
    }

    /**
     * Get available audio input devices
     */
    public async getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
        if (!navigator.mediaDevices?.enumerateDevices) {
            throw new PermissionError('Device enumeration is not supported');
        }

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter((device) => device.kind === 'audioinput');
        } catch (error) {
            throw new PermissionError('Failed to enumerate audio devices', error as Error);
        }
    }

    /**
     * Get available audio output devices
     */
    public async getAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
        if (!navigator.mediaDevices?.enumerateDevices) {
            throw new PermissionError('Device enumeration is not supported');
        }

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter((device) => device.kind === 'audiooutput');
        } catch (error) {
            throw new PermissionError('Failed to enumerate audio devices', error as Error);
        }
    }

    /**
     * Check if current browser is Safari
     */
    private _isSafari(): boolean {
        const userAgent = navigator.userAgent.toLowerCase();
        return userAgent.includes('safari') && !userAgent.includes('chrome');
    }

    /**
     * Get browser-specific recommendations for microphone setup
     */
    public getBrowserSpecificGuidance(): string[] {
        const userAgent = navigator.userAgent.toLowerCase();

        if (userAgent.includes('chrome')) {
            return [
                'Chrome: Click the microphone icon in the address bar',
                'Select "Always allow" for this site',
                'Check chrome://settings/content/microphone for global settings',
            ];
        } else if (userAgent.includes('firefox')) {
            return [
                'Firefox: Click the shield icon or microphone icon in the address bar',
                'Select "Allow" and check "Remember this decision"',
                'Check about:preferences#privacy for global settings',
            ];
        } else if (this._isSafari()) {
            return [
                'Safari: Check Safari > Preferences > Websites > Microphone',
                'Set this website to "Allow"',
                'Ensure microphone access is enabled in System Preferences > Security & Privacy',
            ];
        } else if (userAgent.includes('edge')) {
            return [
                'Edge: Click the microphone icon in the address bar',
                'Select "Always allow on this site"',
                'Check edge://settings/content/microphone for global settings',
            ];
        }

        return [
            "Check your browser's microphone permissions for this site",
            'Look for a microphone icon in the address bar',
            'Ensure microphone access is enabled in your browser settings',
        ];
    }

    /**
     * Get permission manager capabilities
     */
    public getCapabilities() {
        return {
            isSupported: this._permissionState.isSupported,
            hasPermissionsAPI: 'permissions' in navigator && 'query' in navigator.permissions,
            hasEnumerateDevices: !!navigator.mediaDevices?.enumerateDevices,
            currentStatus: this._permissionState.status,
            browser: this._getBrowserInfo(),
        };
    }

    private _getBrowserInfo() {
        const userAgent = navigator.userAgent.toLowerCase();

        if (userAgent.includes('chrome')) return 'chrome';
        if (userAgent.includes('firefox')) return 'firefox';
        if (this._isSafari()) return 'safari';
        if (userAgent.includes('edge')) return 'edge';

        return 'unknown';
    }

    /**
     * Dispose and cleanup resources
     */
    public dispose(): void {
        this.stopCurrentStream();
        this._permissionState = {
            status: 'unknown',
            isSupported: false,
        };
    }
}
