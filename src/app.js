const http = require('http');
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

const apiRoutes = require('./routes/api');
const swaggerSpec = require('./config/swagger');
const { initWebSocketServer } = require('./sockets/syncServer');
const { startExpiryService } = require('./controllers/expiryService');

const app = express();
const PORT = process.env.PORT || 5004;

const defaultAllowedOrigins = [
  'https://vms-qrf6.onrender.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5004'
];

const envOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envOrigins]))
  .map((o) => o.replace(/\/$/, ''));

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const cleanOrigin = origin.replace(/\/$/, '');
    if (allowedOrigins.includes('*') || allowedOrigins.includes(cleanOrigin)) {
      return callback(null, true);
    }
    // Fallback to allow request
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Interactive Swagger API Documentation UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Raw OpenAPI Spec JSON
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// REST API Routes
app.use('/api', apiRoutes);

// Root healthcheck
app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: 'Sathya Sai Grama VMS Backend',
    port: PORT,
    swagger_docs: `http://localhost:${PORT}/api-docs`,
    timestamp: new Date(),
  });
});

const server = http.createServer(app);

// Initialize WebSocket Central Sync Server
initWebSocketServer(server);
startExpiryService();

server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(` Sathya Sai Grama VMS Backend Server Running `);
  console.log(` HTTP Server: http://localhost:${PORT}`);
  console.log(` WebSocket Server: ws://localhost:${PORT}`);
  console.log(` Swagger Docs UI: http://localhost:${PORT}/api-docs`);
  console.log(`=================================================`);
});
