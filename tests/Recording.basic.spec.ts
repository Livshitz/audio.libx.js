/**
 * Basic tests for recording functionality
 */

import { AudioRecorder, PermissionManager, RealtimeAudioProcessor, createAudioRecorder, RecordingError, PermissionError } from '../src/index';

// Mock MediaRecorder for tests
Object.defineProperty(global, 'MediaRecorder', {
    value: jest.fn(() => ({
        start: jest.fn(),
        stop: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        state: 'inactive',
        mimeType: 'audio/webm',
    })),
    writable: true,
});

Object.defineProperty(MediaRecorder, 'isTypeSupported', {
    value: jest.fn(() => true),
    writable: true,
});

// Mock AudioContext
Object.defineProperty(global, 'AudioContext', {
    value: jest.fn(() => ({
        createAnalyser: jest.fn(() => ({
            fftSize: 2048,
            smoothingTimeConstant: 0.8,
            frequencyBinCount: 1024,
            getByteFrequencyData: jest.fn(),
            getFloatFrequencyData: jest.fn(),
            getByteTimeDomainData: jest.fn(),
        })),
        createMediaStreamSource: jest.fn(() => ({
            connect: jest.fn(),
        })),
        createGain: jest.fn(() => ({
            gain: { value: 1.0 },
            connect: jest.fn(),
        })),
        createBiquadFilter: jest.fn(() => ({
            type: 'allpass',
            frequency: { value: 1000 },
            connect: jest.fn(),
        })),
        state: 'running',
        sampleRate: 44100,
        resume: jest.fn(),
        close: jest.fn(),
    })),
    writable: true,
});

describe('Recording Module Exports', () => {
    test('should export AudioRecorder class', () => {
        expect(AudioRecorder).toBeDefined();
        expect(typeof AudioRecorder).toBe('function');
    });

    test('should export PermissionManager class', () => {
        expect(PermissionManager).toBeDefined();
        expect(typeof PermissionManager).toBe('function');
    });

    test('should export RealtimeAudioProcessor class', () => {
        expect(RealtimeAudioProcessor).toBeDefined();
        expect(typeof RealtimeAudioProcessor).toBe('function');
    });

    test('should export createAudioRecorder factory function', () => {
        expect(createAudioRecorder).toBeDefined();
        expect(typeof createAudioRecorder).toBe('function');
    });

    test('should export error classes', () => {
        expect(RecordingError).toBeDefined();
        expect(PermissionError).toBeDefined();
        expect(typeof RecordingError).toBe('function');
        expect(typeof PermissionError).toBe('function');
    });
});

describe('AudioRecorder Basic Tests', () => {
    test('should create AudioRecorder instance', () => {
        const recorder = new AudioRecorder();
        expect(recorder).toBeInstanceOf(AudioRecorder);
        expect(recorder.getState).toBeDefined();
        expect(recorder.dispose).toBeDefined();
        recorder.dispose();
    });

    test('should create AudioRecorder with options', () => {
        const recorder = new AudioRecorder({
            mimeType: 'audio/webm',
            audioBitsPerSecond: 128000,
        });
        expect(recorder).toBeInstanceOf(AudioRecorder);
        recorder.dispose();
    });

    test('should create recorder via factory function', () => {
        const recorder = createAudioRecorder({
            mimeType: 'audio/mp4',
        });
        expect(recorder).toBeInstanceOf(AudioRecorder);
        recorder.dispose();
    });

    test('should get initial state', () => {
        const recorder = new AudioRecorder();
        const state = recorder.getState();

        expect(state).toHaveProperty('state');
        expect(state).toHaveProperty('duration');
        expect(state).toHaveProperty('hasPermission');
        expect(state.state).toBe('idle');
        expect(state.duration).toBe(0);
        expect(state.hasPermission).toBe(false);

        recorder.dispose();
    });

    test('should get capabilities', () => {
        const recorder = new AudioRecorder();
        const capabilities = recorder.getCapabilities();

        expect(capabilities).toHaveProperty('isSupported');
        expect(capabilities).toHaveProperty('supportedMimeTypes');
        expect(capabilities).toHaveProperty('canPause');
        expect(capabilities).toHaveProperty('canResume');
        expect(Array.isArray(capabilities.supportedMimeTypes)).toBe(true);

        recorder.dispose();
    });

    test('should handle event listeners', () => {
        const recorder = new AudioRecorder();
        const callback = jest.fn();

        expect(() => {
            recorder.on('recordingStarted', callback);
            recorder.off('recordingStarted', callback);
        }).not.toThrow();

        recorder.dispose();
    });
});

describe('PermissionManager Basic Tests', () => {
    test('should get singleton instance', () => {
        const instance1 = PermissionManager.getInstance();
        const instance2 = PermissionManager.getInstance();

        expect(instance1).toBe(instance2);
        expect(instance1).toBeInstanceOf(PermissionManager);
    });

    test('should get capabilities', () => {
        const permissionManager = PermissionManager.getInstance();
        const capabilities = permissionManager.getCapabilities();

        expect(capabilities).toHaveProperty('isSupported');
        expect(capabilities).toHaveProperty('hasPermissionsAPI');
        expect(capabilities).toHaveProperty('hasEnumerateDevices');
        expect(capabilities).toHaveProperty('currentStatus');
        expect(capabilities).toHaveProperty('browser');
    });

    test('should provide browser-specific guidance', () => {
        const permissionManager = PermissionManager.getInstance();
        const guidance = permissionManager.getBrowserSpecificGuidance();

        expect(Array.isArray(guidance)).toBe(true);
        expect(guidance.length).toBeGreaterThan(0);
        expect(typeof guidance[0]).toBe('string');
    });

    test('should provide error guidance', () => {
        const permissionManager = PermissionManager.getInstance();
        const error = new PermissionError('Test error');
        const guidance = permissionManager.getPermissionErrorGuidance(error);

        expect(Array.isArray(guidance)).toBe(true);
        expect(guidance.length).toBeGreaterThan(0);
        expect(typeof guidance[0]).toBe('string');
    });
});

describe('RealtimeAudioProcessor Basic Tests', () => {
    test('should create RealtimeAudioProcessor instance', () => {
        const processor = new RealtimeAudioProcessor();
        expect(processor).toBeInstanceOf(RealtimeAudioProcessor);
        expect(processor.dispose).toBeDefined();
        processor.dispose();
    });

    test('should create processor with options', () => {
        const processor = new RealtimeAudioProcessor({
            enableSilenceDetection: true,
            enableLevelMonitoring: true,
            silenceThresholdDb: -40,
        });
        expect(processor).toBeInstanceOf(RealtimeAudioProcessor);
        processor.dispose();
    });

    test('should get capabilities', () => {
        const processor = new RealtimeAudioProcessor();
        const capabilities = processor.getCapabilities();

        expect(capabilities).toHaveProperty('isSupported');
        expect(capabilities).toHaveProperty('hasAnalyser');
        expect(capabilities).toHaveProperty('isProcessing');
        expect(capabilities).toHaveProperty('supportedEffects');
        expect(Array.isArray(capabilities.supportedEffects)).toBe(true);

        processor.dispose();
    });

    test('should handle callbacks', () => {
        const processor = new RealtimeAudioProcessor();
        const audioCallback = jest.fn();
        const silenceCallback = jest.fn();
        const levelCallback = jest.fn();

        expect(() => {
            processor.onAudioData(audioCallback);
            processor.onSilenceDetected(silenceCallback);
            processor.onLevelUpdate(levelCallback);
        }).not.toThrow();

        processor.dispose();
    });

    test('should handle processing controls', () => {
        const processor = new RealtimeAudioProcessor();

        expect(() => {
            processor.startProcessing();
            processor.stopProcessing();
        }).not.toThrow();

        processor.dispose();
    });
});

describe('Error Classes', () => {
    test('RecordingError should work correctly', () => {
        const error = new RecordingError('Test recording error', 'test-id');

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RecordingError);
        expect(error.message).toBe('Test recording error');
        expect(error.code).toBe('RECORDING_ERROR');
        expect(error.name).toBe('AudioStreamingError');
    });

    test('PermissionError should work correctly', () => {
        const error = new PermissionError('Test permission error');

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(PermissionError);
        expect(error.message).toBe('Test permission error');
        expect(error.code).toBe('PERMISSION_ERROR');
        expect(error.name).toBe('AudioStreamingError');
    });
});

describe('Integration Tests', () => {
    test('should create all components together', () => {
        const recorder = new AudioRecorder();
        const permissionManager = PermissionManager.getInstance();
        const processor = new RealtimeAudioProcessor();

        expect(recorder).toBeInstanceOf(AudioRecorder);
        expect(permissionManager).toBeInstanceOf(PermissionManager);
        expect(processor).toBeInstanceOf(RealtimeAudioProcessor);

        // Cleanup
        recorder.dispose();
        processor.dispose();
    });

    test('should handle disposal gracefully', () => {
        const recorder = new AudioRecorder();
        const processor = new RealtimeAudioProcessor();

        expect(() => {
            recorder.dispose();
            processor.dispose();
        }).not.toThrow();

        // Should handle multiple dispose calls
        expect(() => {
            recorder.dispose();
            processor.dispose();
        }).not.toThrow();
    });
});
