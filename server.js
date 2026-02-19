import http from 'node:http';
import { WebSocketServer } from 'ws';
import { handleSpeechConnection } from './src/lib/speech-ws.js';
import * as providers from './src/lib/speech-providers.js';

process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const { handler } = await import('./dist/server/entry.mjs');
const server = http.createServer(handler);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/speech') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleSpeechConnection(ws, { providers });
    });
  } else {
    socket.destroy();
  }
});
server.listen(process.env.PORT || 3456, process.env.HOST || '0.0.0.0');
