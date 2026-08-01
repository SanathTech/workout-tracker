// Generates the AUTH_PASSWORD_HASH value. Reads the password from a prompt so it never
// lands in shell history:  npm run auth:hash
const crypto = require('crypto');
const readline = require('readline');
const { hashPassword } = require('./auth');

// Echo is muted by suppressing readline's own output once the prompt is written, so the
// password isn't left on screen. Resolves on Enter — waiting for EOF would leave an
// interactive prompt hanging until Ctrl+D, which reads as the script having frozen.
function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (str) => { if (!muted) rl.output.write(str); };
    rl.question(prompt, (answer) => {
      rl.output.write('\n');
      rl.close();
      resolve(answer.trim());
    });
    muted = true;
  });
}

function readPiped() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

(async () => {
  let password;
  if (process.stdin.isTTY) {
    password = await askHidden('Password: ');
    if (password && password.length >= 12) {
      // There is no reset flow — a typo here is only discoverable at the login screen.
      const again = await askHidden('Confirm: ');
      if (again !== password) {
        console.error("Passwords don't match. Nothing generated.");
        process.exit(1);
      }
    }
  } else {
    password = await readPiped();
  }

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
