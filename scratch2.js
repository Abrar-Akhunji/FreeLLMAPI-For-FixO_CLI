const fs = require('fs/promises');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
};

async function formatQueryForChat(query) {
  const pathRegex = /'?(?:\/|\\)[^\s'"]+'?/g;
  let formatted = query;
  
  const matches = [...query.matchAll(pathRegex)];
  for (const matchObj of matches) {
    const match = matchObj[0];
    try {
      const unquoted = match.replace(/^['"]|['"]$/g, '');
      const resolved = path.resolve(unquoted);
      const stat = await fs.stat(resolved).catch(() => null);
      if (stat) {
        const baseName = path.basename(resolved);
        formatted = formatted.replace(match, `${colors.bold}${colors.green}${baseName}${colors.reset}`);
      }
    } catch (e) {
      // Ignore
    }
  }
  return formatted;
}

async function run() {
  console.log(await formatQueryForChat("look at '/Users/abrarakhunji/Desktop/FreeLLMAPI/freellmapi/calculator.html' and /help and /Users/abrarakhunji/Desktop/FreeLLMAPI/freellmapi/calculator.html"));
}

run();
