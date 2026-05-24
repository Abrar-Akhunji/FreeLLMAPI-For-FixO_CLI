import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const ENV = {
  PORT: process.env.PORT || '3001',
  SMART_ROUTING_ENABLED: process.env.SMART_ROUTING_ENABLED,
  PROMPT_TRANSLATION_ENABLED: process.env.PROMPT_TRANSLATION_ENABLED,
  MULTI_TENANT_AUTH_ENABLED: process.env.MULTI_TENANT_AUTH_ENABLED,
  OLLAMA_LOCAL_ENABLED: process.env.OLLAMA_LOCAL_ENABLED,
  OLLAMA_LOCAL_URL: process.env.OLLAMA_LOCAL_URL
};
