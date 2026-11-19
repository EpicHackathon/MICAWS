// Browser audio doubles capture lifecycle calls without opening a microphone.
export function installAudioMocks(t, { getUserMedia, addModule } = {}) {
  const contexts = [], nodes = [], tracks = [];
  class AudioContextMock {
    state = 'suspended';
    destination = {};
    audioWorklet = { addModule: addModule ?? (async () => {}) };
    constructor() { contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  class AudioWorkletNodeMock {
    commands = [];
    constructor() {
      nodes.push(this);
      this.port = {
        postMessage: command => this.commands.push(command),
        close: () => { this.closed = true; },
      };
    }
    emit(data) { this.port.onmessage?.({ data }); }
    connect() {}
    disconnect() {}
  }
  const mediaDevices = {
    getUserMedia: getUserMedia ?? (async () => {
      const track = { stops: 0, stop() { this.stops++; } };
      tracks.push(track);
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    }),
  };
  for (const [key, value] of Object.entries({
    AudioContext: AudioContextMock, AudioWorkletNode: AudioWorkletNodeMock,
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  const browserNavigator = navigator;
  const original = Object.getOwnPropertyDescriptor(browserNavigator, 'mediaDevices');
  Object.defineProperty(browserNavigator, 'mediaDevices', { configurable: true, value: mediaDevices });
  t.after(() => {
    if (original) Object.defineProperty(browserNavigator, 'mediaDevices', original);
    else delete browserNavigator.mediaDevices;
  });
  return { contexts, nodes, tracks };
}
