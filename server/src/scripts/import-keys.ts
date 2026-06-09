/**
 * CLI Key Bulk Importer Script (Firestore version)
 * Usage:
 *   1. Direct command line import:
 *      npx tsx src/scripts/import-keys.ts --userId=uid123 --platform=google --key=AIzaSy... --label="Gemini Key"
 *   2. File bulk import:
 *      npx tsx src/scripts/import-keys.ts --userId=uid123 --file=path/to/keys.txt
 *      (where keys.txt has lines: platform,key,label)
 */
import fs from 'fs';
import path from 'path';
import { initDb, addUserApiKey } from '../db/index.js';
import { maskKey } from '../lib/crypto.js';

const PLATFORMS = [
  'google', 'groq', 'cerebras', 'sambanova', 'nvidia', 'mistral',
  'openrouter', 'github', 'cohere', 'cloudflare', 'zhipu', 'ollama',
  'kilo', 'pollinations', 'llm7',
] as const;

type Platform = typeof PLATFORMS[number];

function validatePlatform(platform: string): platform is Platform {
  return PLATFORMS.includes(platform as any);
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const parts = arg.slice(2).split('=');
      const key = parts[0];
      const val = parts.slice(1).join('=');
      result[key] = val;
    }
  }
  return result;
}

async function insertKey(uid: string, platform: string, key: string, label: string): Promise<boolean> {
  if (!validatePlatform(platform)) {
    console.error(`[Error] Invalid platform: "${platform}". Must be one of: ${PLATFORMS.join(', ')}`);
    return false;
  }

  if (!key || key.trim().length === 0) {
    console.error(`[Error] API Key cannot be empty for platform "${platform}"`);
    return false;
  }

  const trimmedLabel = label.trim() || `${platform.toUpperCase()} Import`;

  try {
    await addUserApiKey(uid, platform, key.trim(), trimmedLabel);
    console.log(`✓ Successfully imported key for user [${uid}] platform [${platform}] - Label: "${trimmedLabel}" - Key: ${maskKey(key)}`);
    return true;
  } catch (error: any) {
    console.error(`[Error] Firestore insert failed for platform "${platform}": ${error.message}`);
    return false;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const userId = options.userId;
  if (!userId) {
    console.error('[Error] You must specify a --userId option (e.g. --userId=uid123)');
    process.exit(1);
  }

  // Initialize Firestore
  await initDb();

  if (options.file) {
    const filePath = path.resolve(options.file);
    if (!fs.existsSync(filePath)) {
      console.error(`[Error] File not found: ${filePath}`);
      process.exit(1);
    }

    console.log(`Reading keys from file: ${filePath}...`);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;

      const parts = line.split(',');
      if (parts.length < 2) {
        console.warn(`[Warning] Line ${i + 1} ignored: Expected "platform,key,label" but got: "${line}"`);
        failCount++;
        continue;
      }

      const platform = parts[0].trim().toLowerCase();
      const key = parts[1].trim();
      const label = parts.slice(2).join(',').trim();

      if (await insertKey(userId, platform, key, label)) {
        successCount++;
      } else {
        failCount++;
      }
    }

    console.log(`\nBulk Import Completed: ${successCount} successful, ${failCount} failed.`);
  } else if (options.platform && options.key) {
    const success = await insertKey(userId, options.platform.toLowerCase(), options.key, options.label || '');
    if (!success) process.exit(1);
  } else {
    console.log(`
free LLM API for FIXO CLI Key Importer Utility (Firestore Version)
======================================================

Usage Options:

1. Direct Command Line Import:
   npm run keys:import -- --userId=<userId> --platform=<platform> --key=<key> [--label="My Key Label"]

   Example:
   npm run keys:import -- --userId=uid123 --platform=groq --key=gsk_12345 --label="Primary Groq Key"

2. File Bulk Import:
   npm run keys:import -- --userId=<userId> --file=<path-to-file>

   Example:
   npm run keys:import -- --userId=uid123 --file=keys-list.txt

   File Format (one key per line, commas or hashtag comments allowed):
   # platform,key,label
   google,AIzaSyCustomKey,My Google Free Key
   groq,gsk_someSecretString,Primary Groq Key
    `);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Unhandled script failure:', error);
  process.exit(1);
});
