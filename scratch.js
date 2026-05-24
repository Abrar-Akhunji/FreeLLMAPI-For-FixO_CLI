const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');

const rl = readline.createInterface({ input, output });

async function main() {
  const answer = await rl.question('\nLine 1\n> ');
  process.stdout.write('\x1b[1A\x1b[2K');
  console.log('> ' + answer.replace(/foo/g, '\x1b[32mbar\x1b[0m'));
  console.log('done');
  rl.close();
}
main();
