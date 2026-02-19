import { EventEmitter } from 'node:events';

export class MockWebSocket extends EventEmitter {
  readyState = 1;
  sent = [];
  closed = false;
  OPEN = 1;
  CLOSED = 3;

  send(data) { this.sent.push(data); }

  close(code, reason) {
    this.readyState = 3;
    this.closed = true;
    this.emit('close', code, reason);
  }

  sentJSON() { return this.sent.filter(d => typeof d === 'string').map(JSON.parse); }
  sentBinary() { return this.sent.filter(d => typeof d !== 'string'); }
  receiveJSON(obj) { this.emit('message', JSON.stringify(obj)); }
  receiveBinary(buf) { this.emit('message', buf); }
}
