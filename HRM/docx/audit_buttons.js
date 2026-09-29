const fs = require('fs');
const path = require('path');

const hrmDir = path.resolve(__dirname, '..');
const dirs = fs.readdirSync(hrmDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && fs.existsSync(path.join(hrmDir, d.name, 'code.html')));

const results = [];

for (const dir of dirs) {
  const filePath = path.join(hrmDir, dir.name, 'code.html');
  const html = fs.readFileSync(filePath, 'utf8');

  // Find subtabs section if any
  // Typically subtabs are in container like class="...border-b..." or containing tab navigation
  // Let's inspect subtab navigation elements (<button> or <a> within tab container)
  const tabContainers = [];
  const subtabRegex = /<(div|nav)\b[^>]*class="[^"]*(?:border-b|space-x-8|tab)[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
  let tabMatch;
  while ((tabMatch = subtabRegex.exec(html)) !== null) {
    tabContainers.push(tabMatch[0]);
  }

  // Find all buttons in document
  const btnRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let match;
  const buttons = [];
  while ((match = btnRegex.exec(html)) !== null) {
    const attrs = match[1];
    const innerHtml = match[2];
    const text = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const hasOnclick = /\bonclick\s*=/i.test(attrs);
    const isSubtab = /border-b-2|tab/i.test(attrs) || tabContainers.some(tc => tc.includes(match[0]));

    buttons.push({
      text: text || '(Icon/Trống)',
      hasOnclick,
      isSubtab,
      fullTag: match[0].substring(0, 120)
    });
  }

  // Also find tab buttons/links rendered as <a> inside subtabs
  const aTabRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const tabLinks = [];
  while ((match = aTabRegex.exec(html)) !== null) {
    const attrs = match[1];
    const innerHtml = match[2];
    const text = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const href = (attrs.match(/href="([^"]*)"/) || [])[1] || '';
    const hasOnclick = /\bonclick\s*=/i.test(attrs);
    // Is it in a subtab container?
    const inTab = tabContainers.some(tc => tc.includes(match[0]));
    if (inTab || /border-b-2|tab/i.test(attrs)) {
      tabLinks.push({
        text: text || '(Link)',
        href,
        hasOnclick,
        hasValidHref: href !== '#' && href !== '' && !href.startsWith('javascript:void')
      });
    }
  }

  results.push({
    folder: dir.name,
    totalButtons: buttons.length,
    missingOnclickButtons: buttons.filter(b => !b.hasOnclick),
    subtabButtons: buttons.filter(b => b.isSubtab),
    subtabButtonsMissingOnclick: buttons.filter(b => b.isSubtab && !b.hasOnclick),
    tabLinks
  });
}

const summaryFile = path.join(__dirname, 'hrm_buttons_audit.json');
fs.writeFileSync(summaryFile, JSON.stringify(results, null, 2), 'utf8');

console.log('Processed', results.length, 'screens.');
let totalBtns = results.reduce((acc, r) => acc + r.totalButtons, 0);
let totalMissing = results.reduce((acc, r) => acc + r.missingOnclickButtons.length, 0);
let totalSubtabBtns = results.reduce((acc, r) => acc + r.subtabButtons.length, 0);
let totalSubtabBtnsMissing = results.reduce((acc, r) => acc + r.subtabButtonsMissingOnclick.length, 0);

console.log(`Total buttons: ${totalBtns}`);
console.log(`Total buttons missing onclick: ${totalMissing}`);
console.log(`Total subtab buttons: ${totalSubtabBtns} (Missing onclick: ${totalSubtabBtnsMissing})`);
