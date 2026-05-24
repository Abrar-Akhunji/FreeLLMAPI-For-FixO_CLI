import * as p from '@clack/prompts';
import type { FreeLLMConfig } from './config.js';
import { getDefaultConfig, saveConfig } from './config.js';

/**
 * Runs the interactive first-run setup wizard for FixO CLI.
 * Links the CLI terminal to the FreeLLMAPI SaaS cloud by prompting
 * for the master API key, destination URL, and saving it to the configuration.
 */
export async function runSetupWizard(): Promise<FreeLLMConfig> {
  p.intro('🚀 Welcome to FixO CLI Setup');

  console.log(`┌────────────────────────────────────────────────────────────────┐
│  🚀 Welcome to FixO CLI!                                       │
│  Let's link your CLI terminal to your FreeLLMAPI SaaS cloud.   │
│                                                                │
│  1. Open your web browser and navigate to your dashboard.       │
│  2. Sign in to your account.                                   │
│  3. Navigate to the Profile / API Keys section.                │
│  4. Copy your master 'FreeLLMAPI' API key.                     │
└────────────────────────────────────────────────────────────────┘\n`);

  const serverChoice = await p.select({
    message: 'Select your FreeLLMAPI server endpoint:',
    options: [
      { value: 'https://api.your-freellmapi-website.com/v1', label: 'Cloud Hosted SaaS (Default)' },
      { value: 'http://localhost:3001/v1', label: 'Local Development Server (http://localhost:3001/v1)' },
      { value: 'custom', label: 'Custom Endpoint URL' },
    ],
  });

  if (p.isCancel(serverChoice)) {
    p.outro('Setup cancelled.');
    process.exit(1);
  }

  let apiUrl = serverChoice as string;
  if (serverChoice === 'custom') {
    const customUrl = await p.text({
      message: 'Enter your custom FreeLLMAPI Endpoint URL:',
      placeholder: 'https://api.custom-domain.com/v1',
      validate: (val) => {
        if (!val.trim()) return 'URL is required';
        return;
      },
    });

    if (p.isCancel(customUrl)) {
      p.outro('Setup cancelled.');
      process.exit(1);
    }
    apiUrl = customUrl.trim();
  }

  const apiKeyInput = await p.text({
    message: 'Enter your FreeLLMAPI API key:',
    placeholder: 'freellmapi-user-sk-...',
    validate: (val) => {
      if (!val.trim()) {
        return 'API key is required';
      }
      if (!val.trim().startsWith('freellmapi-')) {
        return 'API key must start with "freellmapi-"';
      }
      return;
    },
  });

  if (p.isCancel(apiKeyInput)) {
    p.outro('Setup cancelled. FixO CLI requires an API key to function.');
    process.exit(1);
  }

  const config = getDefaultConfig();
  config.freellmapi_api_key = apiKeyInput.trim();
  config.apiUrl = apiUrl;
  config._firstRunComplete = true;

  saveConfig(config);

  p.outro('✓ Configuration successfully serialized into ~/.fixocli/config.json');

  return config;
}
