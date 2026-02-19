import { WebSocketServer } from 'ws';
import { handleSpeechConnection } from '../lib/speech-ws.js';
import * as providers from '../lib/speech-providers.js';

export default function websocketIntegration() {
  let viteServer;
  return {
    name: 'thinkdone-websocket',
    hooks: {
      'astro:server:setup': ({ server }) => {
        viteServer = server;
      },
      'astro:server:start': () => {
        const httpServer = viteServer?.httpServer;
        if (!httpServer) {
          console.warn('[ws-integration] No httpServer available, WebSocket disabled');
          return;
        }
        const wss = new WebSocketServer({ noServer: true });
        httpServer.on('upgrade', (req, socket, head) => {
          if (req.url === '/ws/speech') {
            wss.handleUpgrade(req, socket, head, (ws) => {
              handleSpeechConnection(ws, { providers });
            });
          }
        });
        console.log('[ws-integration] WebSocket handler attached for /ws/speech');
      },
    },
  };
}
