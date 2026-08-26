const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Sathya Sai Grama Visitor Management System (VMS) API',
      version: '1.0.0',
      description: `
### Centralized Visitor & Access Management REST API
Provides comprehensive endpoints for visitor pre-registration, multi-tier approvals (L1/L2), live gate ingress/egress check-in, supervisor overrides, super admin master bypasses, and 13 executive analytics reports.

#### Authentication
API endpoints require a JWT Bearer token in the \`Authorization\` header:
\`\`\`
Authorization: Bearer <your_jwt_token>
\`\`\`
      `,
      contact: {
        name: 'Systems Architecture Team',
        email: 'sysadmin@ashram.org',
      },
    },
    servers: [
      {
        url: 'http://localhost:5003',
        description: 'Local Active Server (Port 5003)',
      },
      {
        url: 'http://localhost:5002',
        description: 'Secondary Server (Port 5002)',
      },
      {
        url: 'http://localhost:5000',
        description: 'Default Server (Port 5000)',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token obtained from `/api/auth/login`',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;
