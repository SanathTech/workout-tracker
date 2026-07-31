// Generates the AUTH_PASSWORD_HASH value. Reads the password from stdin so it never
// lands in shell history:  npm run auth:hash
const crypto = require('crypto');
const { hashPassword } = require('./auth');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

(async () => {
  if (process.stdin.isTTY) process.stdout.write('Password: ');
  const password = await readStdin();
  if (!password) {
    console.error('No password given.');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error(`Password is ${password.length} characters. Use at least 12.`);
    process.exit(1);
  }
  console.log('\nAdd both of these to the backend Vercel project:\n');
  console.log(`AUTH_PASSWORD_HASH=${await hashPassword(password)}`);
  console.log(`SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`);
  console.log('\nSetting both turns authentication on. Until then the API stays open.');
})();
