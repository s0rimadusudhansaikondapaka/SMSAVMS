require('dotenv').config();
const { sendVisitorApprovalEmail } = require('./src/services/emailService');

async function main() {
  console.log('Sending test visitor pass approval email to 8500050077a@gmail.com...');
  const res = await sendVisitorApprovalEmail({
    visitorEmail: '8500050077a@gmail.com',
    visitorName: 'Valued Visitor',
    passCode: 'PASS-TEST-9999',
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 12 * 60 * 60 * 1000),
    hostName: 'Sathya Sai Grama Host',
  });
  console.log('Test Mail Result:', res);
  process.exit(0);
}

main();
