/**
 * DeviceManager - Static utility class for audio device management
 * Provides device enumeration, constraint building, and change detection
 * without managing state (state belongs in consuming applications)
 */

import { PermissionManager } from './PermissionManager.js';

export interface DeviceManagerConstraints {
    deviceId?: string;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
    channelCount?: number;
    sampleRate?: number;
}

export class DeviceManager {
    private static deviceChangeListeners: Map<() => void, { cleanup: () => void }> = new Map();
    private static deviceChangeHandler: (() => void) | null = null;
    private static debounceTimeout: NodeJS.Timeout | null = null;

    /**
     * Enumerate all available audio input and output devices
     * Requires microphone permission to get device labels
     */
    static async enumerateDevices(): Promise<{
        inputs: MediaDeviceInfo[];
        outputs: MediaDeviceInfo[];
    }> {
        if (!navigator.mediaDevices?.enumerateDevices) {
            throw new Error('Device enumeration is not supported in this browser');
        }

        try {
            // Check if we have permission - if not, request it to get device labels
            const permissionManager = PermissionManager.getInstance();
            const permissionState = await permissionManager.checkPermissionState();

            // If permission not granted, device labels will be empty strings
            // We'll still return the devices but with generic labels
            const devices = await navigator.mediaDevices.enumerateDevices();

            const inputs = devices
                .filter((device) => device.kind === 'audioinput' && device.deviceId && device.deviceId.length > 0)
                .map((device, index) => ({
                    deviceId: device.deviceId,
                    kind: device.kind,
                    groupId: device.groupId,
                    // Provide fallback label if permission not granted yet
                    label: device.label || `Microphone ${index + 1}`,
                    toJSON: device.toJSON?.bind(device),
                })) as MediaDeviceInfo[];

            const outputs = devices
                .filter((device) => device.kind === 'audiooutput' && device.deviceId && device.deviceId.length > 0)
                .map((device, index) => ({
                    deviceId: device.deviceId,
                    kind: device.kind,
                    groupId: device.groupId,
                    // Provide fallback label if permission not granted yet
                    label: device.label || `Speaker ${index + 1}`,
                    toJSON: device.toJSON?.bind(device),
                })) as MediaDeviceInfo[];

            return { inputs, outputs };
        } catch (error) {
            throw new Error(`Failed to enumerate devices: ${(error as Error).message}`);
        }
    }

    /**
     * Build MediaTrackConstraints from options
     * Handles Safari compatibility by excluding unsupported constraints
     */
    static buildConstraints(options: DeviceManagerConstraints = {}): MediaTrackConstraints {
        const constraints: MediaTrackConstraints = {
            echoCancellation: options.echoCancellation ?? true,
            noiseSuppression: options.noiseSuppression ?? true,
            autoGainControl: options.autoGainControl ?? true,
        };

        // Add optional constraints if specified
        if (options.deviceId) {
            constraints.deviceId = { exact: options.deviceId };
        }

        if (options.channelCount !== undefined) {
            constraints.channelCount = options.channelCount;
        }

        if (options.sampleRate !== undefined) {
            constraints.sampleRate = options.sampleRate;
        }

        // Safari compatibility: Remove constraints that may cause issues
        if (this._isSafari()) {
            // Safari can be picky about sampleRate and channelCount
            // Only include deviceId if specified, omit the rest for better compatibility
            const safariConstraints: MediaTrackConstraints = {
                echoCancellation: constraints.echoCancellation,
                noiseSuppression: constraints.noiseSuppression,
                autoGainControl: constraints.autoGainControl,
            };

            if (constraints.deviceId) {
                safariConstraints.deviceId = constraints.deviceId;
            }

            return safariConstraints;
        }

        return constraints;
    }

    /**
     * Check if browser supports output device selection (setSinkId)
     */
    static supportsOutputSelection(): boolean {
        return 'setSinkId' in HTMLAudioElement.prototype || 'setSinkId' in HTMLVideoElement.prototype;
    }

    /**
     * Apply output device to an audio or video element
     * Returns true if successful, false if not supported
     */
    static async applyOutputDevice(element: HTMLAudioElement | HTMLVideoElement, deviceId: string): Promise<boolean> {
        if (!this.supportsOutputSelection()) {
            console.warn('Output device selection (setSinkId) is not supported in this browser');
            return false;
        }

        try {
            // TypeScript doesn't know about setSinkId, so we cast to any
            await (element as any).setSinkId(deviceId);
            return true;
        } catch (error) {
            console.warn(`Failed to set output device: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Register a callback for device changes with optional debouncing
     * Returns an unsubscribe function
     *
     * @param callback - Function to call when devices change
     * @param debounceMs - Debounce delay in milliseconds (default: 300ms)
     * @returns Unsubscribe function
     */
    static onDeviceChange(callback: () => void, debounceMs: number = 300): () => void {
        if (!navigator.mediaDevices?.addEventListener) {
            console.warn('Device change detection is not supported in this browser');
            return () => {}; // Return no-op unsubscribe
        }

        // Set up global device change handler if not already set up
        if (!this.deviceChangeHandler) {
            this.deviceChangeHandler = () => {
                // Debounce: Clear existing timeout
                if (this.debounceTimeout) {
                    clearTimeout(this.debounceTimeout);
                }

                // Set new timeout to call all listeners
                this.debounceTimeout = setTimeout(() => {
                    console.log(`🎤 Device change detected, notifying ${this.deviceChangeListeners.size} listener(s)`);
                    this.deviceChangeListeners.forEach((_, callback) => {
                        try {
                            callback();
                        } catch (error) {
                            console.error('Error in device change callback:', error);
                        }
                    });
                }, debounceMs);
            };

            navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeHandler);
        }

        // Store this callback
        const cleanup = () => {
            this.deviceChangeListeners.delete(callback);

            // If no more listeners, remove global handler
            if (this.deviceChangeListeners.size === 0 && this.deviceChangeHandler) {
                if (this.debounceTimeout) {
                    clearTimeout(this.debounceTimeout);
                    this.debounceTimeout = null;
                }
                navigator.mediaDevices?.removeEventListener('devicechange', this.deviceChangeHandler);
                this.deviceChangeHandler = null;
            }
        };

        this.deviceChangeListeners.set(callback, { cleanup });

        console.log(`🎤 Registered device change listener (total: ${this.deviceChangeListeners.size})`);

        // Return unsubscribe function
        return cleanup;
    }

    /**
     * Find a device by label (useful for persistence by label instead of deviceId)
     * Device IDs can change between sessions, but labels are more stable
     *
     * @param devices - Array of devices to search
     * @param label - Device label to find
     * @returns The matching device or null if not found
     */
    static findDeviceByLabel(devices: MediaDeviceInfo[], label: string): MediaDeviceInfo | null {
        return devices.find((device) => device.label === label) || null;
    }

    /**
     * Get a human-readable device label with fallback
     * Handles cases where device.label is empty (no permission yet)
     *
     * @param device - The media device
     * @param index - Index for fallback labeling
     * @returns A readable label
     */
    static getDeviceLabel(device: MediaDeviceInfo, index: number = 0): string {
        if (device.label && device.label.trim() !== '') {
            return device.label;
        }

        // Generate fallback label based on kind
        const prefix = device.kind === 'audioinput' ? 'Microphone' : device.kind === 'audiooutput' ? 'Speaker' : 'Device';

        // Use first 6 chars of deviceId if available
        if (device.deviceId && device.deviceId !== 'default') {
            return `${prefix} (${device.deviceId.substring(0, 6)})`;
        }

        return `${prefix} ${index + 1}`;
    }

    /**
     * Check if current browser is Safari
     */
    private static _isSafari(): boolean {
        const userAgent = navigator.userAgent.toLowerCase();
        return userAgent.includes('safari') && !userAgent.includes('chrome');
    }

    /**
     * Clean up all device change listeners (useful for testing or cleanup)
     */
    static dispose(): void {
        // Call cleanup for all listeners
        this.deviceChangeListeners.forEach((value) => value.cleanup());
        this.deviceChangeListeners.clear();

        // Clear timeout
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
            this.debounceTimeout = null;
        }

        // Remove global handler
        if (this.deviceChangeHandler) {
            navigator.mediaDevices?.removeEventListener('devicechange', this.deviceChangeHandler);
            this.deviceChangeHandler = null;
        }
    }
}











