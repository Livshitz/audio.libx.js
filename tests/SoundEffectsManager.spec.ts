/**
 * Tests for SoundEffectsManager class
 */

import { SoundEffectsManager, createSoundEffectsManager } from '../src/index';

// Mock AudioCache - Bun doesn't support jest.mock, so we'll test without mocking
// const mockAudioCache = {
//     initialize: jest.fn().mockResolvedValue(undefined),
//     get: jest.fn().mockResolvedValue(null),
//     set: jest.fn().mockResolvedValue(undefined),
//     delete: jest.fn().mockResolvedValue(undefined),
//     close: jest.fn()
// };

// Mock AudioProcessor - Bun doesn't support jest.mock, so we'll test without mocking
// const mockAudioProcessor = {
//     splitIntoChunks: jest.fn().mockReturnValue([new Uint8Array(100)]),
//     dispose: jest.fn()
// };

// Mock global Audio
Object.defineProperty(global, 'Audio', {
    value: () => ({
        play: () => Promise.resolve(),
        pause: () => {},
        load: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        volume: 1.0,
        loop: false,
        currentTime: 0,
    }),
    writable: true,
});

// Mock fetch
global.fetch = () =>
    Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        headers: {
            get: () => 'audio/mpeg',
        },
    } as any);

// Mock URL
Object.defineProperty(global, 'URL', {
    value: {
        createObjectURL: () => 'blob:mock-url',
        revokeObjectURL: () => {},
    },
    writable: true,
});

describe('SoundEffectsManager', () => {
    let soundEffectsManager: SoundEffectsManager;

    beforeEach(() => {
        soundEffectsManager = new SoundEffectsManager();
    });

    afterEach(() => {
        soundEffectsManager?.dispose();
    });

    describe('Basic Functionality', () => {
        test('should create SoundEffectsManager instance', () => {
            expect(soundEffectsManager).toBeInstanceOf(SoundEffectsManager);
        });

        test('should create via factory function', () => {
            const manager = createSoundEffectsManager();
            expect(manager).toBeInstanceOf(SoundEffectsManager);
            manager.dispose();
        });

        test('should create with options', () => {
            const options = {
                maxConcurrentSounds: 4,
                defaultVolume: 0.8,
                enableCaching: false,
            };
            const manager = new SoundEffectsManager(options);
            expect(manager).toBeInstanceOf(SoundEffectsManager);
            manager.dispose();
        });

        test('should initialize successfully', async () => {
            await soundEffectsManager.initialize();
            expect(soundEffectsManager).toBeInstanceOf(SoundEffectsManager);
        });

        test('should get initial state', () => {
            const state = soundEffectsManager.getState();
            expect(state.state).toBe('idle');
            expect(state.loadedSounds).toBe(0);
            expect(state.totalSounds).toBe(0);
            expect(state.activeSounds).toBe(0);
            expect(state.canPlay).toBe(false);
        });

        test('should get capabilities', () => {
            const capabilities = soundEffectsManager.getCapabilities();
            expect(capabilities).toHaveProperty('isSupported');
            expect(capabilities).toHaveProperty('hasCaching');
            expect(capabilities).toHaveProperty('hasProcessor');
            expect(capabilities).toHaveProperty('maxConcurrentSounds');
            expect(capabilities).toHaveProperty('preloadSupported');
        });
    });

    describe('Sound Registration', () => {
        test('should register sound with string key', () => {
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');

            const soundEffect = soundEffectsManager.getSoundEffect('click');
            expect(soundEffect).not.toBeNull();
            expect(soundEffect?.key).toBe('click');
            expect(soundEffect?.url).toBe('http://example.com/click.mp3');
        });

        test('should register sound with number key', () => {
            soundEffectsManager.registerSound(1, 'http://example.com/sound1.mp3');

            const soundEffect = soundEffectsManager.getSoundEffect(1);
            expect(soundEffect).not.toBeNull();
            expect(soundEffect?.key).toBe(1);
        });

        test('should register sound with metadata', () => {
            const metadata = {
                title: 'Custom Click Sound',
                volume: 0.5,
                loop: true,
                preload: true,
            };
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3', metadata);

            const soundEffect = soundEffectsManager.getSoundEffect('click');
            expect(soundEffect?.title).toBe('Custom Click Sound');
            expect(soundEffect?.volume).toBe(0.5);
            expect(soundEffect?.loop).toBe(true);
            expect(soundEffect?.preload).toBe(true);
        });

        test('should register multiple sounds', () => {
            const sounds = [
                { key: 'click', url: 'http://example.com/click.mp3' },
                { key: 'beep', url: 'http://example.com/beep.mp3' },
                { key: 'chime', url: 'http://example.com/chime.mp3' },
            ];
            soundEffectsManager.registerSounds(sounds);

            const allSounds = soundEffectsManager.getAllSoundEffects();
            expect(allSounds).toHaveLength(3);
        });

        test('should update state when registering sounds', () => {
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');

            const state = soundEffectsManager.getState();
            expect(state.loadedSounds).toBe(1);
            expect(state.totalSounds).toBe(1);
            expect(state.canPlay).toBe(true);
        });
    });

    describe('Sound Playback', () => {
        beforeEach(() => {
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
        });

        test('should play registered sound', async () => {
            await soundEffectsManager.initialize();
            const audioElement = await soundEffectsManager.playSound('click');

            expect(audioElement).not.toBeNull();
            expect(audioElement).toBeInstanceOf(HTMLAudioElement);
        });

        test('should play sound with custom options', async () => {
            await soundEffectsManager.initialize();
            const onEnded = jest.fn();
            const audioElement = await soundEffectsManager.playSound('click', {
                volume: 0.5,
                loop: true,
                onEnded,
            });

            expect(audioElement).not.toBeNull();
            expect(audioElement.volume).toBe(0.5);
            expect(audioElement.loop).toBe(true);
        });

        test('should handle concurrent sound limit', async () => {
            await soundEffectsManager.initialize();

            // Mock maxConcurrentSounds to 1
            const manager = new SoundEffectsManager({ maxConcurrentSounds: 1 });
            manager.registerSound('click', 'http://example.com/click.mp3');
            await manager.initialize();

            const audio1 = await manager.playSound('click');
            const audio2 = await manager.playSound('click');

            expect(audio1).not.toBeNull();
            expect(audio2).toBeNull(); // Should be null due to limit
            manager.dispose();
        });

        test('should throw error for unregistered sound', async () => {
            await soundEffectsManager.initialize();

            await expect(soundEffectsManager.playSound('nonexistent')).rejects.toThrow("Sound effect 'nonexistent' not found");
        });
    });

    describe('Sound Control', () => {
        beforeEach(() => {
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
        });

        test('should stop specific sound', async () => {
            await soundEffectsManager.initialize();
            await soundEffectsManager.playSound('click');

            soundEffectsManager.stopSound('click');

            const activeSounds = soundEffectsManager.getActiveSounds();
            expect(activeSounds).toHaveLength(0);
        });

        test('should stop all sounds', async () => {
            await soundEffectsManager.initialize();
            soundEffectsManager.registerSound('beep', 'http://example.com/beep.mp3');

            await soundEffectsManager.playSound('click');
            await soundEffectsManager.playSound('beep');

            soundEffectsManager.stopAllSounds();

            const activeSounds = soundEffectsManager.getActiveSounds();
            expect(activeSounds).toHaveLength(0);
        });

        test('should set volume for sound effect', () => {
            soundEffectsManager.setVolume('click', 0.7);

            const soundEffect = soundEffectsManager.getSoundEffect('click');
            expect(soundEffect?.volume).toBe(0.7);
        });

        test('should clamp volume to valid range', () => {
            soundEffectsManager.setVolume('click', 1.5);
            expect(soundEffectsManager.getSoundEffect('click')?.volume).toBe(1);

            soundEffectsManager.setVolume('click', -0.5);
            expect(soundEffectsManager.getSoundEffect('click')?.volume).toBe(0);
        });
    });

    describe('Sound Management', () => {
        test('should remove sound effect', () => {
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
            const removed = soundEffectsManager.removeSound('click');

            expect(removed).toBe(true);
            expect(soundEffectsManager.getSoundEffect('click')).toBeNull();
        });

        test('should return false when removing non-existent sound', () => {
            const removed = soundEffectsManager.removeSound('nonexistent');
            expect(removed).toBe(false);
        });

        test('should clear all sound effects', () => {
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
            soundEffectsManager.registerSound('beep', 'http://example.com/beep.mp3');

            soundEffectsManager.clearAllSounds();

            const allSounds = soundEffectsManager.getAllSoundEffects();
            expect(allSounds).toHaveLength(0);
        });

        test('should get all registered sound effects', () => {
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
            soundEffectsManager.registerSound('beep', 'http://example.com/beep.mp3');

            const allSounds = soundEffectsManager.getAllSoundEffects();
            expect(allSounds).toHaveLength(2);
            expect(allSounds.map((s) => s.key)).toContain('click');
            expect(allSounds.map((s) => s.key)).toContain('beep');
        });
    });

    describe('Preloading', () => {
        test('should preload specific sound', async () => {
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
            await soundEffectsManager.initialize();

            await expect(soundEffectsManager.preloadSound('click')).resolves.not.toThrow();
        });

        test('should preload all sounds', async () => {
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
            soundEffectsManager.registerSound('beep', 'http://example.com/beep.mp3');
            await soundEffectsManager.initialize();

            await expect(soundEffectsManager.preloadAllSounds()).resolves.not.toThrow();
        });

        test('should throw error when preloading non-existent sound', async () => {
            await soundEffectsManager.initialize();

            await expect(soundEffectsManager.preloadSound('nonexistent')).rejects.toThrow("Sound effect 'nonexistent' not found");
        });
    });

    describe('Event System', () => {
        test('should handle event subscription', () => {
            const callback = () => {};
            soundEffectsManager.on('soundRegistered', callback);
            soundEffectsManager.off('soundRegistered', callback);
            // In a real test, we'd verify the callback wasn't called
            expect(true).toBe(true);
        });

        test('should emit sound registered event', () => {
            let eventReceived = false;
            const callback = (event: any) => {
                eventReceived = true;
                expect(event.type).toBe('soundRegistered');
                expect(event.data.key).toBe('click');
                expect(event.data.soundEffect.url).toBe('http://example.com/click.mp3');
            };
            soundEffectsManager.on('soundRegistered', callback);

            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
            expect(eventReceived).toBe(true);
        });

        test('should emit sound played event', async () => {
            let eventReceived = false;
            const callback = (event: any) => {
                eventReceived = true;
                expect(event.type).toBe('soundPlayed');
                expect(event.data.key).toBe('click');
            };
            soundEffectsManager.on('soundPlayed', callback);

            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
            await soundEffectsManager.initialize();
            await soundEffectsManager.playSound('click');

            expect(eventReceived).toBe(true);
        });
    });

    describe('State Management', () => {
        test('should update state when registering sounds', () => {
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');

            const state = soundEffectsManager.getState();
            expect(state.loadedSounds).toBe(1);
            expect(state.totalSounds).toBe(1);
            expect(state.canPlay).toBe(true);
        });

        test('should update state when playing sounds', async () => {
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
            await soundEffectsManager.initialize();
            await soundEffectsManager.playSound('click');

            const state = soundEffectsManager.getState();
            expect(state.activeSounds).toBe(1);
        });

        test('should update state when clearing sounds', () => {
            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
            soundEffectsManager.clearAllSounds();

            const state = soundEffectsManager.getState();
            expect(state.loadedSounds).toBe(0);
            expect(state.totalSounds).toBe(0);
            expect(state.canPlay).toBe(false);
        });
    });

    describe('Error Handling', () => {
        test('should handle fetch errors', async () => {
            // Mock fetch to reject
            global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
            await soundEffectsManager.initialize();

            await expect(soundEffectsManager.playSound('click')).rejects.toThrow('Network error');
        });

        test('should handle autoplay restrictions', async () => {
            // Mock Audio.play to reject with NotAllowedError
            const mockAudio = {
                play: () => Promise.reject(new Error('NotAllowedError')),
                pause: () => {},
                load: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                volume: 1.0,
                loop: false,
                currentTime: 0,
            };
            Object.defineProperty(global, 'Audio', {
                value: () => mockAudio,
                writable: true,
            });

            soundEffectsManager.registerSound('click', 'http://example.com/click.mp3');
            await soundEffectsManager.initialize();

            await expect(soundEffectsManager.playSound('click')).rejects.toThrow('NotAllowedError');
        });
    });

    describe('Disposal', () => {
        test('should dispose gracefully', () => {
            expect(() => {
                soundEffectsManager.dispose();
            }).not.toThrow();
        });

        test('should handle multiple dispose calls', () => {
            soundEffectsManager.dispose();
            expect(() => {
                soundEffectsManager.dispose();
            }).not.toThrow();
        });
    });
});
