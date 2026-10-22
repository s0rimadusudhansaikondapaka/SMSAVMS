const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '..', '.env');
const envExamplePath = path.join(__dirname, '..', '.env.example');

function hashPassword(plainText) {
  return crypto.createHash('sha256').update(String(plainText)).digest('hex');
}

function updateEnvFile(filePath, rawPassword) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[SHA-256 DB Password] File not found: ${filePath}`);
    return null;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  
  // If password is already a 64-char hex string, treat it as already hashed unless forced
  const isAlreadySha256 = /^[a-f0-9]{64}$/i.test(rawPassword);
  const hashedPassword = isAlreadySha256 ? rawPassword : hashPassword(rawPassword);

  // Update DB_PASSWORD
  if (/^DB_PASSWORD=.*$/m.test(content)) {
    content = content.replace(/^DB_PASSWORD=.*$/m, `DB_PASSWORD=${hashedPassword}`);
  } else {
    content += `\nDB_PASSWORD=${hashedPassword}\n`;
  }

  // Update password inside LOCAL_CONNECTION_STRING if matching postgresql format
  content = content.replace(
    /(LOCAL_CONNECTION_STRING=postgresql:\/\/[^:]+:)([^@]+)(@.+)/m,
    `$1${hashedPassword}$3`
  );

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[SHA-256 DB Password] Updated ${path.basename(filePath)} successfully with SHA-256 password: ${hashedPassword}`);
  return hashedPassword;
}

if (require.main === module) {
  // Read current DB_PASSWORD from .env if not supplied via command line argument
  let initialPass = process.argv[2];
  if (!initialPass && fs.existsSync(envPath)) {
    const currentEnv = fs.readFileSync(envPath, 'utf8');
    const match = currentEnv.match(/^DB_PASSWORD=(.*)$/m);
    if (match && match[1]) {
      initialPass = match[1].trim();
    }
  }
  initialPass = initialPass || 'postgres';

  console.log('[SHA-256 DB Password] Encoding and saving DB password in .env...');
  updateEnvFile(envPath, initialPass);
}

module.exports = { hashPassword, updateEnvFile };
