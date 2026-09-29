const fs = require('fs');
const path = require('path');

const hrmDir = path.resolve(__dirname, '..');
const dirs = fs.readdirSync(hrmDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && fs.existsSync(path.join(hrmDir, d.name, 'code.html')));

const scriptTag = '<script src="../hrm-interactive-hub.js"></script>';

let count = 0;
for (const d of dirs) {
  const file = path.join(hrmDir, d.name, 'code.html');
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes('hrm-interactive-hub.js')) {
    content = content.replace('</body>', scriptTag + '\n</body>');
    fs.writeFileSync(file, content, 'utf8');
    count++;
  }
}

console.log(`Added hrm-interactive-hub.js to ${count} screens.`);
