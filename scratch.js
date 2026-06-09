import { Parser, Language } from 'web-tree-sitter';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  await Parser.init({
    locateFile(scriptName) {
      if (scriptName === 'tree-sitter.wasm') {
        return path.join(__dirname, 'cli/vendor/tree-sitter.wasm');
      }
      return scriptName;
    }
  });

  const Bash = await Language.load(path.join(__dirname, 'cli/vendor/tree-sitter-bash.wasm'));
  const parser = new Parser();
  parser.setLanguage(Bash);

  const command = 'rm -rf /Users/abrar/Desktop/FreeLLMAPI && cat .env && chmod +x script.sh';
  const tree = parser.parse(command);
  
  console.log('AST Syntax Tree parsed successfully!');

  // Function to recursively find command nodes
  function findCommands(node) {
    const list = [];
    if (node.type === 'command') {
      list.push(node);
    }
    for (let i = 0; i < node.childCount; i++) {
      list.push(...findCommands(node.child(i)));
    }
    return list;
  }

  const cmds = findCommands(tree.rootNode);
  for (const cmd of cmds) {
    console.log(`\nFound command node: "${cmd.text}"`);
    // Print all child nodes of command
    for (let i = 0; i < cmd.childCount; i++) {
      const child = cmd.child(i);
      console.log(`  Child type: ${child.type}, Text: "${child.text}"`);
    }
  }
}

run().catch(console.error);
