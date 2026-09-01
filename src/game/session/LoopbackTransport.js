import { cloneSerializable, PROTOCOL_VERSION } from './protocol.js';

// A synchronous in-memory message channel. It deliberately exposes no host methods.
export class LoopbackTransport {
  constructor(host) {
    this.host = host;
    this.closed = false;
  }

  exchange(message) {
    if (this.closed) throw new Error('Loopback transport is closed');
    const request = cloneSerializable(message);
    if (request.version !== PROTOCOL_VERSION) throw new Error(`Unsupported protocol version: ${request.version}`);
    return cloneSerializable(this.host.receive(request));
  }

  close() {
    this.closed = true;
    this.host = null;
  }
}
