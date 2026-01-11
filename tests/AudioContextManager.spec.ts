import { AudioContextManager } from '../src/AudioContextManager.js';

// Mock AudioContext
class MockAudioContext {
    state: AudioContextState = 'suspended';
    sampleRate: number = 44100;
    destination: any = {};

    resume = jest.fn().mockResolvedValue(undefined);
    close = jest.fn().mockResolvedValue(undefined);
    createBuffer = jest.fn((channels: number, length: number, sampleRate: number) => ({
        numberOfChannels: channels,
        length,
        sampleRate,
    }));
    createBufferSource = jest.fn(() => {
        const source = {
            buffer: null,
            connect: jest.fn(),
            start: jest.fn(() => {
                // Immediately trigger onended callback
                setTimeout(() => {
                    if (source.onended) {
                        source.onended();
                    }
                }, 0);
            }),
            onended: null as any,
        };
        return source;
    });
}

// Mock HTMLAudioElement
class MockHTMLAudioElement {
    src: string = '';
    loop: boolean = false;
    preload: string = 'auto';
    volume: number = 1;
    style: any = {};
    play = jest.fn().mockResolvedValue(undefined);
    pause = jest.fn();
    load = jest.fn();
    remove = jest.fn();
    setAttribute = jest.fn();
}

describe('AudioContextManager', () => {
    let originalAudioContext: any;
    let originalCreateElement: any;
    let originalUserAgent: PropertyDescriptor | undefined;
    let originalMaxTouchPoints: PropertyDescriptor | undefined;
    let mockAppendChild: jest.Mock;

    beforeEach(() => {
        // Save originals
        originalAudioContext = (global as any).AudioContext;
        originalCreateElement = document.createElement;
        originalUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
        originalMaxTouchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints');

        // Mock AudioContext
        (global as any).AudioContext = MockAudioContext;

        // Mock document.body.appendChild
        mockAppendChild = jest.fn();
        document.body.appendChild = mockAppendChild;

        // Mock document.createElement for audio elements
        document.createElement = jest.fn((tagName: string) => {
            if (tagName === 'audio') {
                return new MockHTMLAudioElement() as any;
            }
            return originalCreateElement.call(document, tagName);
        }) as any;
    });

    afterEach(() => {
        // Restore originals
        (global as any).AudioContext = originalAudioContext;
        document.createElement = originalCreateElement;
        
        if (originalUserAgent) {
            Object.defineProperty(navigator, 'userAgent', originalUserAgent);
        }
        if (originalMaxTouchPoints) {
            Object.defineProperty(navigator, 'maxTouchPoints', originalMaxTouchPoints);
        }
        
        jest.restoreAllMocks();
    });

    describe('Constructor and initialization', () => {
        it('should create instance with default options', () => {
            const manager = new AudioContextManager();
            const state = manager.getState();

            expect(state.isLocked).toBe(true);
            expect(state.autoUnlockRegistered).toBe(false);
        });

        it('should create instance with custom options', () => {
            const manager = new AudioContextManager({
                sampleRate: 48000,
                latencyHint: 'playback',
                autoUnlock: false,
            });

            const context = manager.getContext();
            expect(context).toBeDefined();
        });

        it('should auto-register unlock when autoUnlock is true', () => {
            const manager = new AudioContextManager({ autoUnlock: true });
            const state = manager.getState();

            expect(state.autoUnlockRegistered).toBe(true);
        });
    });

    describe('Platform detection', () => {
        it('should detect iOS platform', () => {
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
                configurable: true,
            });

            const manager = new AudioContextManager();
            const state = manager.getState();

            expect(state.platform).toBe('ios');
        });

        it('should detect Android platform', () => {
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (Linux; Android 13)',
                configurable: true,
            });

            const manager = new AudioContextManager();
            const state = manager.getState();

            expect(state.platform).toBe('android');
        });

        it('should detect Safari platform', () => {
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
                configurable: true,
            });

            const manager = new AudioContextManager();
            const state = manager.getState();

            expect(state.platform).toBe('safari');
        });
    });

    describe('Audio context management', () => {
        it('should create and return audio context', () => {
            const manager = new AudioContextManager();
            const context = manager.getContext();

            expect(context).toBeDefined();
            expect(context).toBeInstanceOf(MockAudioContext);
        });

        it('should return same context on multiple calls', () => {
            const manager = new AudioContextManager();
            const context1 = manager.getContext();
            const context2 = manager.getContext();

            expect(context1).toBe(context2);
        });

        it('should check if unlock is needed', () => {
            const manager = new AudioContextManager();

            // Should need unlock initially
            expect(manager.needsUnlock()).toBe(true);
        });
    });

    describe('iOS audio unlock', () => {
        beforeEach(() => {
            // Mock iOS environment
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
                configurable: true,
            });
            Object.defineProperty(navigator, 'maxTouchPoints', {
                value: 5,
                configurable: true,
            });
        });

        it('should attempt iOS unlock on ensureUnlocked', async () => {
            const manager = new AudioContextManager();
            const context = manager.getContext() as any;

            // Mock context to return 'running' state after resume
            context.resume.mockImplementation(() => {
                context.state = 'running';
                return Promise.resolve();
            });

            const result = await manager.ensureUnlocked();

            expect(result).toBe(true);
            expect(context.resume).toHaveBeenCalled();
        });

        it('should create silent audio element for iOS unlock', async () => {
            const manager = new AudioContextManager();
            const context = manager.getContext() as any;

            context.resume.mockImplementation(() => {
                context.state = 'running';
                return Promise.resolve();
            });

            await manager.ensureUnlocked();

            // Check that createElement was called with 'audio'
            expect(document.createElement).toHaveBeenCalledWith('audio');
            
            // Check that audio element was appended to body
            expect(mockAppendChild).toHaveBeenCalled();
        });

        it('should set iosAudioUnlocked state after successful unlock', async () => {
            const manager = new AudioContextManager();
            const context = manager.getContext() as any;

            context.resume.mockImplementation(() => {
                context.state = 'running';
                return Promise.resolve();
            });

            await manager.ensureUnlocked();

            const state = manager.getState();
            expect(state.iosAudioUnlocked).toBe(true);
        });

        it('should attempt AudioSession API if available', async () => {
            const mockAudioSession = {
                type: 'auto',
            };

            Object.defineProperty(navigator, 'audioSession', {
                value: mockAudioSession,
                configurable: true,
                writable: true,
            });

            const manager = new AudioContextManager();
            const context = manager.getContext() as any;

            context.resume.mockImplementation(() => {
                context.state = 'running';
                return Promise.resolve();
            });

            await manager.ensureUnlocked();

            expect((navigator as any).audioSession.type).toBe('playback');
        });

        it('should handle AudioSession API errors gracefully', async () => {
            Object.defineProperty(navigator, 'audioSession', {
                value: {
                    set type(value: string) {
                        throw new Error('AudioSession not supported');
                    },
                },
                configurable: true,
            });

            const manager = new AudioContextManager();
            const context = manager.getContext() as any;

            context.resume.mockImplementation(() => {
                context.state = 'running';
                return Promise.resolve();
            });

            // Should not throw
            await expect(manager.ensureUnlocked()).resolves.toBe(true);
        });

        it('should skip iOS unlock if already unlocked', async () => {
            const manager = new AudioContextManager();
            const context = manager.getContext() as any;

            context.resume.mockImplementation(() => {
                context.state = 'running';
                return Promise.resolve();
            });

            // First unlock
            await manager.ensureUnlocked();

            // Reset mock call counts
            jest.clearAllMocks();

            // Second unlock should skip iOS-specific unlock
            await manager.ensureUnlocked();

            const state = manager.getState();
            expect(state.iosAudioUnlocked).toBe(true);
        });

        it('should prevent race conditions with concurrent unlock attempts', async () => {
            const manager = new AudioContextManager();
            const context = manager.getContext() as any;

            context.resume.mockImplementation(() => {
                context.state = 'running';
                return Promise.resolve();
            });

            // Trigger multiple concurrent unlock attempts
            const promises = [
                manager.ensureUnlocked(),
                manager.ensureUnlocked(),
                manager.ensureUnlocked(),
            ];

            await Promise.all(promises);

            // Should only create one audio element
            const createAudioCalls = (document.createElement as jest.Mock).mock.calls.filter(
                (call) => call[0] === 'audio'
            );
            expect(createAudioCalls.length).toBe(1);
        });

        it('should stop silent audio loop after real audio plays', async () => {
            const manager = new AudioContextManager();
            const context = manager.getContext() as any;

            context.resume.mockImplementation(() => {
                context.state = 'running';
                return Promise.resolve();
            });

            await manager.ensureUnlocked();

            // Get the created audio element
            const audioElements = (document.createElement as jest.Mock).mock.results
                .filter((result) => result.value instanceof MockHTMLAudioElement)
                .map((result) => result.value);

            expect(audioElements.length).toBeGreaterThan(0);
            const audio = audioElements[0];
            expect(audio.loop).toBe(true);

            // Signal that real audio has played
            manager.stopSilentAudioLoop();

            expect(audio.loop).toBe(false);
        });
    });

    describe('Platform guidance', () => {
        it('should return iOS guidance with silent mode info', () => {
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
                configurable: true,
            });

            const manager = new AudioContextManager();
            const guidance = manager.getPlatformGuidance();

            expect(guidance).toContain('Silent mode bypass is automatically enabled');
        });

        it('should return Android guidance', () => {
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (Linux; Android 13)',
                configurable: true,
            });

            const manager = new AudioContextManager();
            const guidance = manager.getPlatformGuidance();

            expect(guidance.length).toBeGreaterThan(0);
            expect(guidance.some((g) => g.includes('Android') || g.includes('Tap'))).toBe(true);
        });
    });

    describe('Cleanup and disposal', () => {
        it('should cleanup silent audio element on dispose', async () => {
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
                configurable: true,
            });

            const manager = new AudioContextManager();
            const context = manager.getContext() as any;

            context.resume.mockImplementation(() => {
                context.state = 'running';
                return Promise.resolve();
            });

            await manager.ensureUnlocked();
            await manager.dispose();

            const state = manager.getState();
            expect(state.iosAudioUnlocked).toBe(false);
        });

        it('should close audio context on dispose', async () => {
            const manager = new AudioContextManager();
            const context = manager.getContext() as any;

            await manager.dispose();

            expect(context.close).toHaveBeenCalled();
        });

        it('should remove unlock handlers on dispose', async () => {
            const manager = new AudioContextManager({ autoUnlock: true });

            await manager.dispose();

            const state = manager.getState();
            expect(state.autoUnlockRegistered).toBe(false);
        });
    });

    describe('Platform type helpers', () => {
        it('should correctly identify mobile platforms', () => {
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
                configurable: true,
            });

            const manager = new AudioContextManager();

            expect(manager.isMobile()).toBe(true);
            expect(manager.isIOS()).toBe(true);
            expect(manager.isSafari()).toBe(true);
        });

        it('should correctly identify desktop Safari', () => {
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
                configurable: true,
            });

            const manager = new AudioContextManager();

            expect(manager.isMobile()).toBe(false);
            expect(manager.isIOS()).toBe(false);
            expect(manager.isSafari()).toBe(true);
        });
    });
});
