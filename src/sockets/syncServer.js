const WebSocket = require('ws');

let wss = null;

function initWebSocketServer(server) {
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    console.log('[WebSocket Sync] New client connected');

    ws.isAlive = true;
    ws.userId = null;
    ws.userRole = null;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        if (data.type === 'REGISTER_USER') {
          ws.userId = String(data.userId || data.guid || '');
          ws.userRole = String(data.role || '');
          console.log(`[WebSocket Sync] Registered Socket for User ID: ${ws.userId}, Role: ${ws.userRole}`);
          return;
        }

        if (data.type === 'PING') {
          ws.isAlive = true;
          ws.send(JSON.stringify({ type: 'PONG' }));
          return;
        }

        // Relay general events
        broadcastSyncEvent(data.type, data.payload);
      } catch (e) {
        console.error('Invalid WS message:', e);
      }
    });

    ws.on('close', () => {
      console.log('[WebSocket Sync] Client disconnected');
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

function sendTargetedNotification({ targetUserIds = [], targetRoles = [], eventType, payload }) {
  if (!wss) return;
  const message = JSON.stringify({ type: eventType, payload, timestamp: new Date() });

  const targetIdSet = new Set(targetUserIds.map((id) => String(id)));
  const targetRoleSet = new Set(targetRoles.map((r) => String(r)));

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      const matchUser = client.userId && targetIdSet.has(client.userId);
      const matchRole = client.userRole && targetRoleSet.has(client.userRole);

      // Send if target lists are empty (broadcast to all) OR if client matches user/role
      if ((targetUserIds.length === 0 && targetRoles.length === 0) || matchUser || matchRole) {
        client.send(message);
      }
    }
  });
}

module.exports = {
  initWebSocketServer,
  broadcastSyncEvent,
  sendTargetedNotification,
};
