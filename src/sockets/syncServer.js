const WebSocket = require('ws');

let wss = null;

function initWebSocketServer(server) {
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    console.log('[WebSocket Central Sync] New client connected');

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        console.log('[WebSocket Received]:', data.type);
        // Relay gate transactions or alerts
        broadcastSyncEvent(data.type, data.payload);
      } catch (e) {
        console.error('Invalid WS message:', e);
      }
    });

    ws.on('close', () => {
      console.log('[WebSocket Central Sync] Client disconnected');
    });
  });

  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });
}

function broadcastSyncEvent(eventType, payload) {
  if (!wss) return;
  const message = JSON.stringify({ type: eventType, payload, timestamp: new Date() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

module.exports = {
  initWebSocketServer,
  broadcastSyncEvent,
};
