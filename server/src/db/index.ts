import crypto from 'crypto';
import { firestore } from '../lib/firebaseAdmin.js';
export { firestore };
import { initEncryptionKey, encrypt } from '../lib/crypto.js';

export interface GlobalModel {
  id: string; // platform_modelId
  platform: string;
  modelId: string;
  displayName: string;
  intelligenceRank: number;
  speedRank: number;
  sizeLabel: string;
  rpmLimit: number | null;
  rpdLimit: number | null;
  tpmLimit: number | null;
  tpdLimit: number | null;
  monthlyTokenBudget: string;
  contextWindow: number | null;
  enabled: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string;
  unifiedApiKey: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface ApiKeyDoc {
  id: string;
  platform: string;
  label: string;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  status: string;
  enabled: boolean;
  createdAt: string;
  lastCheckedAt: string | null;
}

export interface ClientKeyDoc {
  id: string;
  userId: string;
  label: string;
  hashedKey: string;
  keyPrefix: string;
  dailyTokenQuota: number | null;
  tokensUsedToday: number;
  lastQuotaReset: string;
  enabled: boolean;
  createdAt: string;
}

export interface RequestDoc {
  id: string;
  userId: string;
  platform: string;
  modelId: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
  createdAt: string;
}

export interface FallbackEntry {
  modelDbId: string;
  priority: number;
  enabled: boolean;
}

export async function initDb(): Promise<void> {
  console.log('Initializing Firestore database...');
  await initEncryptionKey();
  try {
    await seedGlobalModels();
  } catch (error: any) {
    const isCredsError =
      error.message?.includes('Could not load the default credentials') ||
      error.message?.includes('NO_ADC_FOUND') ||
      error.code === 'credentials-invalid' ||
      error.stack?.includes('googleauth.js');

    if (isCredsError) {
      // Don't call process.exit() here — in a serverless function (Vercel)
      // that kills the lambda and surfaces as FUNCTION_INVOCATION_FAILED with
      // no useful body. Throw instead so the handler can return a JSON 500.
      const msg =
        'Firebase Admin credentials could not be loaded. Set the ' +
        'FIREBASE_SERVICE_ACCOUNT environment variable to the full JSON ' +
        "contents of a Firebase service-account key (Console → Project " +
        'Settings → Service Accounts → Generate new private key). ' +
        'Locally you can instead set GOOGLE_APPLICATION_CREDENTIALS to an ' +
        'absolute path to that JSON file. Underlying error: ' +
        (error.message ?? String(error));
      console.error('[initDb] ' + msg);
      const wrapped = new Error(msg);
      (wrapped as any).code = 'FIREBASE_CREDENTIALS_MISSING';
      throw wrapped;
    }
    throw error;
  }
}

async function seedGlobalModels() {
  const modelsColl = firestore.collection('global_models');
  const snapshot = await modelsColl.limit(1).get();
  if (!snapshot.empty) {
    return; // Already seeded
  }

  console.log('Seeding global models into Firestore...');

  const models: Omit<GlobalModel, 'id'>[] = [
    // Google
    { platform: 'google', modelId: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', intelligenceRank: 14, speedRank: 8, sizeLabel: 'Frontier', rpmLimit: 5, rpdLimit: 20, tpmLimit: 250000, tpdLimit: null, monthlyTokenBudget: '~3M', contextWindow: 1048576, enabled: false },
    { platform: 'google', modelId: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', intelligenceRank: 20, speedRank: 5, sizeLabel: 'Large', rpmLimit: 10, rpdLimit: 20, tpmLimit: 250000, tpdLimit: null, monthlyTokenBudget: '~3M', contextWindow: 1048576, enabled: true },
    { platform: 'google', modelId: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', intelligenceRank: 26, speedRank: 3, sizeLabel: 'Medium', rpmLimit: 15, rpdLimit: 20, tpmLimit: 250000, tpdLimit: null, monthlyTokenBudget: '~3M', contextWindow: 1048576, enabled: true },
    { platform: 'google', modelId: 'gemini-3.1-flash-lite-preview', displayName: 'Gemini 3.1 Flash-Lite Preview', intelligenceRank: 18, speedRank: 3, sizeLabel: 'Medium', rpmLimit: 15, rpdLimit: 20, tpmLimit: 250000, tpdLimit: null, monthlyTokenBudget: '~3M', contextWindow: 1048576, enabled: true },
    { platform: 'google', modelId: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash Preview', intelligenceRank: 11, speedRank: 5, sizeLabel: 'Large', rpmLimit: 10, rpdLimit: 20, tpmLimit: 250000, tpdLimit: null, monthlyTokenBudget: '~3M', contextWindow: 1048576, enabled: true },
    { platform: 'google', modelId: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview', intelligenceRank: 1, speedRank: 8, sizeLabel: 'Frontier', rpmLimit: 5, rpdLimit: 20, tpmLimit: 250000, tpdLimit: null, monthlyTokenBudget: '~3M', contextWindow: 1048576, enabled: true },

    // OpenRouter
    { platform: 'openrouter', modelId: 'minimax/minimax-m2.5:free', displayName: 'MiniMax M2.5 (free)', intelligenceRank: 1, speedRank: 9, sizeLabel: 'Large', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 196608, enabled: true },
    { platform: 'openrouter', modelId: 'qwen/qwen3-coder:free', displayName: 'Qwen3 Coder (free)', intelligenceRank: 2, speedRank: 9, sizeLabel: 'Frontier', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 262144, enabled: true },
    { platform: 'openrouter', modelId: 'qwen/qwen3-next-80b-a3b-instruct:free', displayName: 'Qwen3-Next 80B (free)', intelligenceRank: 3, speedRank: 9, sizeLabel: 'Large', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 262144, enabled: true },
    { platform: 'openrouter', modelId: 'openai/gpt-oss-120b:free', displayName: 'GPT-OSS 120B (free)', intelligenceRank: 6, speedRank: 9, sizeLabel: 'Large', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 131072, enabled: true },
    { platform: 'openrouter', modelId: 'openai/gpt-oss-20b:free', displayName: 'GPT-OSS 20B (free)', intelligenceRank: 18, speedRank: 9, sizeLabel: 'Medium', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 131072, enabled: true },
    { platform: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free', displayName: 'Llama 3.3 70B (free)', intelligenceRank: 17, speedRank: 9, sizeLabel: 'Medium', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 131072, enabled: true },
    { platform: 'openrouter', modelId: 'liquid/lfm-2.5-1.2b-instruct:free', displayName: 'Liquid LFM 2.5 1.2B (free)', intelligenceRank: 30, speedRank: 10, sizeLabel: 'Small', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 32768, enabled: true },
    { platform: 'openrouter', modelId: 'google/gemma-4-31b-it:free', displayName: 'Gemma 4 31B (free)', intelligenceRank: 19, speedRank: 9, sizeLabel: 'Medium', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 262144, enabled: true },
    { platform: 'openrouter', modelId: 'inclusionai/ling-2.6-1t:free', displayName: 'Ling 2.6 1T (free)', intelligenceRank: 4, speedRank: 9, sizeLabel: 'Frontier', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 262144, enabled: true },
    { platform: 'openrouter', modelId: 'tencent/hy3-preview:free', displayName: 'Tencent HY3 Preview (free)', intelligenceRank: 7, speedRank: 9, sizeLabel: 'Frontier', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 262144, enabled: true },
    { platform: 'openrouter', modelId: 'poolside/laguna-m.1:free', displayName: 'Poolside Laguna M.1 (free)', intelligenceRank: 13, speedRank: 9, sizeLabel: 'Large', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 131072, enabled: true },
    { platform: 'openrouter', modelId: 'google/gemma-4-26b-a4b-it:free', displayName: 'Gemma 4 26B-A4B (free)', intelligenceRank: 22, speedRank: 9, sizeLabel: 'Medium', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 262144, enabled: true },
    { platform: 'openrouter', modelId: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', displayName: 'Nemotron 3 Nano 30B Reasoning (free)', intelligenceRank: 23, speedRank: 9, sizeLabel: 'Medium', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 262144, enabled: true },
    { platform: 'openrouter', modelId: 'poolside/laguna-xs.2:free', displayName: 'Poolside Laguna XS.2 (free)', intelligenceRank: 26, speedRank: 10, sizeLabel: 'Medium', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 131072, enabled: true },
    { platform: 'openrouter', modelId: 'nvidia/nemotron-nano-9b-v2:free', displayName: 'Nemotron Nano 9B v2 (free)', intelligenceRank: 28, speedRank: 10, sizeLabel: 'Medium', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 128000, enabled: true },
    { platform: 'openrouter', modelId: 'liquid/lfm-2.5-1.2b-thinking:free', displayName: 'Liquid LFM 2.5 1.2B Thinking (free)', intelligenceRank: 30, speedRank: 10, sizeLabel: 'Small', rpmLimit: 20, rpdLimit: 200, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~6M', contextWindow: 32768, enabled: true },

    // SambaNova
    { platform: 'sambanova', modelId: 'DeepSeek-V3.2', displayName: 'DeepSeek V3.2', intelligenceRank: 4, speedRank: 9, sizeLabel: 'Frontier', rpmLimit: 20, rpdLimit: 20, tpmLimit: null, tpdLimit: 200000, monthlyTokenBudget: '~3M', contextWindow: 131072, enabled: true },
    { platform: 'sambanova', modelId: 'DeepSeek-V3.1', displayName: 'DeepSeek V3.1', intelligenceRank: 5, speedRank: 9, sizeLabel: 'Frontier', rpmLimit: 20, rpdLimit: 20, tpmLimit: null, tpdLimit: 200000, monthlyTokenBudget: '~3M', contextWindow: 131072, enabled: true },
    { platform: 'sambanova', modelId: 'DeepSeek-V3.1-cb', displayName: 'DeepSeek V3.1 (CB)', intelligenceRank: 5, speedRank: 9, sizeLabel: 'Frontier', rpmLimit: 20, rpdLimit: 20, tpmLimit: null, tpdLimit: 200000, monthlyTokenBudget: '~3M', contextWindow: 131072, enabled: true },
    { platform: 'sambanova', modelId: 'gemma-3-12b-it', displayName: 'Gemma 3 12B (SambaNova)', intelligenceRank: 22, speedRank: 9, sizeLabel: 'Medium', rpmLimit: 20, rpdLimit: 20, tpmLimit: null, tpdLimit: 200000, monthlyTokenBudget: '~3M', contextWindow: 131072, enabled: true },
    { platform: 'sambanova', modelId: 'Llama-4-Maverick-17B-128E-Instruct', displayName: 'Llama 4 Maverick', intelligenceRank: 11, speedRank: 9, sizeLabel: 'Large', rpmLimit: 20, rpdLimit: 20, tpmLimit: null, tpdLimit: 200000, monthlyTokenBudget: '~3M', contextWindow: 8192, enabled: true },
    { platform: 'sambanova', modelId: 'gpt-oss-120b', displayName: 'GPT-OSS 120B (SambaNova)', intelligenceRank: 6, speedRank: 9, sizeLabel: 'Large', rpmLimit: 20, rpdLimit: 20, tpmLimit: null, tpdLimit: 200000, monthlyTokenBudget: '~3M', contextWindow: 131072, enabled: true },
    { platform: 'sambanova', modelId: 'Meta-Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B', intelligenceRank: 17, speedRank: 9, sizeLabel: 'Large', rpmLimit: 20, rpdLimit: 20, tpmLimit: null, tpdLimit: 200000, monthlyTokenBudget: '~3M', contextWindow: 8192, enabled: true },

    // Groq
    { platform: 'groq', modelId: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B', intelligenceRank: 17, speedRank: 2, sizeLabel: 'Medium', rpmLimit: 30, rpdLimit: 1000, tpmLimit: 12000, tpdLimit: 500000, monthlyTokenBudget: '~15M', contextWindow: 131072, enabled: true },
    { platform: 'groq', modelId: 'openai/gpt-oss-120b', displayName: 'GPT-OSS 120B (Groq)', intelligenceRank: 6, speedRank: 2, sizeLabel: 'Large', rpmLimit: 30, rpdLimit: 1000, tpmLimit: 8000, tpdLimit: 200000, monthlyTokenBudget: '~6M', contextWindow: 131072, enabled: true },
    { platform: 'groq', modelId: 'openai/gpt-oss-20b', displayName: 'GPT-OSS 20B (Groq)', intelligenceRank: 18, speedRank: 2, sizeLabel: 'Medium', rpmLimit: 30, rpdLimit: 1000, tpmLimit: 8000, tpdLimit: 200000, monthlyTokenBudget: '~6M', contextWindow: 131072, enabled: true },
    { platform: 'groq', modelId: 'qwen/qwen3-32b', displayName: 'Qwen3 32B (Groq)', intelligenceRank: 19, speedRank: 2, sizeLabel: 'Medium', rpmLimit: 60, rpdLimit: 1000, tpmLimit: 6000, tpdLimit: 500000, monthlyTokenBudget: '~15M', contextWindow: 131072, enabled: true },
    { platform: 'groq', modelId: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant', intelligenceRank: 28, speedRank: 2, sizeLabel: 'Small', rpmLimit: 30, rpdLimit: 14400, tpmLimit: 6000, tpdLimit: 500000, monthlyTokenBudget: '~15M', contextWindow: 131072, enabled: true },

    // Mistral
    { platform: 'mistral', modelId: 'devstral-latest', displayName: 'Devstral', intelligenceRank: 16, speedRank: 8, sizeLabel: 'Medium', rpmLimit: 2, rpdLimit: null, tpmLimit: 500000, tpdLimit: null, monthlyTokenBudget: '~50-100M', contextWindow: 131072, enabled: true },
    { platform: 'mistral', modelId: 'codestral-latest', displayName: 'Codestral', intelligenceRank: 16, speedRank: 6, sizeLabel: 'Medium', rpmLimit: 2, rpdLimit: null, tpmLimit: 500000, tpdLimit: null, monthlyTokenBudget: '~50-100M', contextWindow: 32000, enabled: true },
    { platform: 'mistral', modelId: 'mistral-large-latest', displayName: 'Mistral Large 3', intelligenceRank: 14, speedRank: 8, sizeLabel: 'Large', rpmLimit: 2, rpdLimit: null, tpmLimit: 500000, tpdLimit: null, monthlyTokenBudget: '~50-100M', contextWindow: 131072, enabled: true },
    { platform: 'mistral', modelId: 'mistral-medium-latest', displayName: 'Mistral Medium 3.5', intelligenceRank: 14, speedRank: 8, sizeLabel: 'Large', rpmLimit: 2, rpdLimit: null, tpmLimit: 500000, tpdLimit: null, monthlyTokenBudget: '~50-100M', contextWindow: 131072, enabled: true },
    { platform: 'mistral', modelId: 'magistral-medium-latest', displayName: 'Magistral Medium', intelligenceRank: 21, speedRank: 8, sizeLabel: 'Large', rpmLimit: 2, rpdLimit: null, tpmLimit: 500000, tpdLimit: null, monthlyTokenBudget: '~50-100M', contextWindow: 40000, enabled: true },

    // GitHub
    { platform: 'github', modelId: 'openai/gpt-4.1', displayName: 'GPT-4.1 (GitHub)', intelligenceRank: 20, speedRank: 7, sizeLabel: 'Large', rpmLimit: 10, rpdLimit: 50, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~9M', contextWindow: 128000, enabled: true },
    { platform: 'github', modelId: 'gpt-4o', displayName: 'GPT-4o', intelligenceRank: 25, speedRank: 7, sizeLabel: 'Large', rpmLimit: 10, rpdLimit: 50, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~18M', contextWindow: 8000, enabled: true },

    // Cohere
    { platform: 'cohere', modelId: 'command-a-03-2025', displayName: 'Command-A (03-2025)', intelligenceRank: 27, speedRank: 11, sizeLabel: 'Large', rpmLimit: 20, rpdLimit: 33, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~1-2M', contextWindow: 131072, enabled: true },
    { platform: 'cohere', modelId: 'command-r-plus-08-2024', displayName: 'Command R+ (08-2024)', intelligenceRank: 27, speedRank: 11, sizeLabel: 'Large', rpmLimit: 20, rpdLimit: 33, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~1-2M', contextWindow: 131072, enabled: true },

    // Cloudflare
    { platform: 'cloudflare', modelId: '@cf/openai/gpt-oss-120b', displayName: 'GPT-OSS 120B (CF)', intelligenceRank: 6, speedRank: 11, sizeLabel: 'Large', rpmLimit: null, rpdLimit: null, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~18-45M', contextWindow: 131072, enabled: true },
    { platform: 'cloudflare', modelId: '@cf/zai-org/glm-4.7-flash', displayName: 'GLM-4.7 Flash (CF)', intelligenceRank: 10, speedRank: 11, sizeLabel: 'Large', rpmLimit: null, rpdLimit: null, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~18-45M', contextWindow: 131072, enabled: true },
    { platform: 'cloudflare', modelId: '@cf/meta/llama-4-scout-17b-16e-instruct', displayName: 'Llama 4 Scout (CF)', intelligenceRank: 12, speedRank: 11, sizeLabel: 'Large', rpmLimit: null, rpdLimit: null, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~18-45M', contextWindow: 131072, enabled: true },
    { platform: 'cloudflare', modelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', displayName: 'Llama 3.3 70B fp8-fast (CF)', intelligenceRank: 17, speedRank: 11, sizeLabel: 'Medium', rpmLimit: null, rpdLimit: null, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~18-45M', contextWindow: 131072, enabled: true },
    { platform: 'cloudflare', modelId: '@cf/moonshotai/kimi-k2.5', displayName: 'Kimi K2.5 (CF)', intelligenceRank: 3, speedRank: 11, sizeLabel: 'Frontier', rpmLimit: null, rpdLimit: null, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~10-20M', contextWindow: 262144, enabled: true },
    { platform: 'cloudflare', modelId: '@cf/qwen/qwen3-30b-a3b-fp8', displayName: 'Qwen3 30B-A3B fp8 (CF)', intelligenceRank: 7, speedRank: 11, sizeLabel: 'Large', rpmLimit: null, rpdLimit: null, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~18-45M', contextWindow: 131072, enabled: true },
    { platform: 'cloudflare', modelId: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', displayName: 'DeepSeek R1 Distill Qwen 32B (CF)', intelligenceRank: 9, speedRank: 11, sizeLabel: 'Large', rpmLimit: null, rpdLimit: null, tpmLimit: null, tpdLimit: null, monthlyTokenBudget: '~3-5M', contextWindow: 131072, enabled: true },

    // Zhipu
    { platform: 'zhipu', modelId: 'glm-4.7-flash', displayName: 'GLM-4.7 Flash', intelligenceRank: 18, speedRank: 4, sizeLabel: 'Large', rpmLimit: null, rpdLimit: null, tpmLimit: null, tpdLimit: 1000000, monthlyTokenBudget: '~30M', contextWindow: 131072, enabled: true },
    { platform: 'zhipu', modelId: 'glm-4.5-flash', displayName: 'GLM-4.5 Flash', intelligenceRank: 24, speedRank: 4, sizeLabel: 'Large', rpmLimit: null, rpdLimit: null, tpmLimit: null, tpdLimit: 1000000, monthlyTokenBudget: '~30M', contextWindow: 131072, enabled: true }
  ];

  const batch = firestore.batch();
  for (const m of models) {
    const id = `${m.platform}_${m.modelId.replace(/\//g, '_')}`;
    const docRef = modelsColl.doc(id);
    batch.set(docRef, { ...m, id });
  }
  await batch.commit();
  console.log(`Seeded ${models.length} global models.`);
}

export async function getGlobalModels(): Promise<GlobalModel[]> {
  const snapshot = await firestore.collection('global_models').get();
  return snapshot.docs.map((doc: any) => doc.data() as GlobalModel);
}

// User Profile Operations
export async function ensureUser(uid: string, email: string, displayName: string, photoUrl: string): Promise<UserProfile> {
  const userRef = firestore.collection('users').doc(uid);
  const doc = await userRef.get();
  
  if (doc.exists) {
    const data = doc.data() as UserProfile;
    const updated = {
      ...data,
      email,
      displayName,
      photoUrl,
      lastLoginAt: new Date().toISOString()
    };
    await userRef.set(updated);
    return updated;
  }

  // Create new user with a unique unified API key (guaranteed unique)
  let unifiedApiKey = '';
  let isUnique = false;
  while (!isUnique) {
    unifiedApiKey = `freellmapi-unified-${crypto.randomBytes(24).toString('hex')}`;
    const existing = await firestore.collection('users').where('unifiedApiKey', '==', unifiedApiKey).limit(1).get();
    if (existing.empty) {
      isUnique = true;
    }
  }

  const newUser: UserProfile = {
    uid,
    email,
    displayName,
    photoUrl,
    unifiedApiKey,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString()
  };

  await userRef.set(newUser);
  return newUser;
}

export async function getUser(uid: string): Promise<UserProfile | null> {
  const doc = await firestore.collection('users').doc(uid).get();
  return doc.exists ? (doc.data() as UserProfile) : null;
}

export async function getUnifiedApiKey(uid: string): Promise<string> {
  const user = await getUser(uid);
  if (!user) throw new Error('User not found');
  return user.unifiedApiKey;
}

export async function regenerateUnifiedKey(uid: string): Promise<string> {
  const userRef = firestore.collection('users').doc(uid);
  let newKey = '';
  let isUnique = false;
  while (!isUnique) {
    newKey = `freellmapi-unified-${crypto.randomBytes(24).toString('hex')}`;
    const existing = await firestore.collection('users').where('unifiedApiKey', '==', newKey).limit(1).get();
    if (existing.empty) {
      isUnique = true;
    }
  }
  await userRef.update({ unifiedApiKey: newKey });
  return newKey;
}

// API Keys Operations (User-Scoped)
export async function getUserApiKeys(uid: string): Promise<ApiKeyDoc[]> {
  const snapshot = await firestore.collection('users').doc(uid).collection('api_keys').orderBy('createdAt', 'desc').get();
  return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as ApiKeyDoc));
}

export async function addUserApiKey(uid: string, platform: string, rawKey: string, label: string): Promise<ApiKeyDoc> {
  const { encrypted, iv, authTag } = encrypt(rawKey);
  const keyRef = firestore.collection('users').doc(uid).collection('api_keys').doc();
  
  const newKey: Omit<ApiKeyDoc, 'id'> = {
    platform,
    label: label || '',
    encrypted_key: encrypted,
    iv,
    auth_tag: authTag,
    status: 'unknown',
    enabled: true,
    createdAt: new Date().toISOString(),
    lastCheckedAt: null
  };

  await keyRef.set(newKey);
  return { id: keyRef.id, ...newKey };
}

export async function deleteUserApiKey(uid: string, keyId: string): Promise<boolean> {
  const docRef = firestore.collection('users').doc(uid).collection('api_keys').doc(keyId);
  const doc = await docRef.get();
  if (!doc.exists) return false;
  await docRef.delete();
  return true;
}

export async function toggleUserApiKey(uid: string, keyId: string, enabled: boolean): Promise<boolean> {
  const docRef = firestore.collection('users').doc(uid).collection('api_keys').doc(keyId);
  const doc = await docRef.get();
  if (!doc.exists) return false;
  await docRef.update({ enabled });
  return true;
}

export async function updateUserApiKeyStatus(uid: string, keyId: string, status: string): Promise<void> {
  await firestore.collection('users').doc(uid).collection('api_keys').doc(keyId).update({
    status,
    lastCheckedAt: new Date().toISOString()
  });
}

// Fallback Configuration (User-Scoped)
export async function getUserFallbackConfig(uid: string): Promise<FallbackEntry[]> {
  const docRef = firestore.collection('users').doc(uid).collection('fallback_config').doc('default');
  const doc = await docRef.get();
  
  if (doc.exists) {
    const data = doc.data();
    if (data && Array.isArray(data.chain)) {
      return data.chain as FallbackEntry[];
    }
  }

  // Generate default fallback config based on global models ordered by intelligence
  const globalModels = await getGlobalModels();
  const sorted = globalModels.sort((a, b) => a.intelligenceRank - b.intelligenceRank);
  const chain: FallbackEntry[] = sorted.map((m, idx) => ({
    modelDbId: m.id,
    priority: idx + 1,
    enabled: m.enabled
  }));

  await docRef.set({ chain });
  return chain;
}

export async function updateUserFallbackConfig(uid: string, chain: FallbackEntry[]): Promise<void> {
  const docRef = firestore.collection('users').doc(uid).collection('fallback_config').doc('default');
  await docRef.set({ chain });
}

// Settings Operations (User-Scoped)
export async function getUserSettings(uid: string): Promise<Record<string, string>> {
  const doc = await firestore.collection('users').doc(uid).collection('settings').doc('config').get();
  const defaults = {
    smart_routing: 'true',
    prompt_translation: 'true',
    ollama_local_enabled: 'false',
    ollama_local_url: 'http://localhost:11434',
    multi_tenant_auth: 'true'
  };

  if (doc.exists) {
    return { ...defaults, ...doc.data() };
  }
  
  return defaults;
}

export async function getUserSetting(uid: string, key: string): Promise<string | undefined> {
  const settings = await getUserSettings(uid);
  return settings[key];
}

export async function setUserSetting(uid: string, key: string, value: string): Promise<void> {
  const docRef = firestore.collection('users').doc(uid).collection('settings').doc('config');
  await docRef.set({ [key]: value }, { merge: true });
}

// Requests / Analytics Operations (User-Scoped)
export async function logRequest(uid: string, requestData: Omit<RequestDoc, 'id' | 'userId' | 'createdAt'>): Promise<void> {
  const docRef = firestore.collection('users').doc(uid).collection('requests').doc();
  await docRef.set({
    ...requestData,
    userId: uid,
    createdAt: new Date().toISOString()
  });
}

export async function getUserRequests(uid: string, sinceDate: string): Promise<RequestDoc[]> {
  const snapshot = await firestore
    .collection('users')
    .doc(uid)
    .collection('requests')
    .where('createdAt', '>=', sinceDate)
    .get();

  return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as RequestDoc));
}

// Client Keys (Downstream user tokens generated to access proxy, e.g. for Fixo CLI)
export async function getUserClientKeys(uid: string): Promise<ClientKeyDoc[]> {
  const snapshot = await firestore
    .collection('user_keys')
    .where('userId', '==', uid)
    .get();
  return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as ClientKeyDoc));
}

export async function createClientKey(uid: string, label: string, dailyTokenQuota: number | null): Promise<{ rawKey: string; keyPrefix: string }> {
  let rawKey = '';
  let hashedKey = '';
  let docRef;
  let isUnique = false;

  while (!isUnique) {
    rawKey = `freellmapi-user-${crypto.randomBytes(24).toString('hex')}`;
    hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');
    docRef = firestore.collection('user_keys').doc(hashedKey);
    const doc = await docRef.get();
    if (!doc.exists) {
      isUnique = true;
    }
  }

  const keyPrefix = rawKey.slice(0, 20) + '...';
  const newKey: Omit<ClientKeyDoc, 'id'> = {
    userId: uid,
    label: label || '',
    hashedKey,
    keyPrefix,
    dailyTokenQuota,
    tokensUsedToday: 0,
    lastQuotaReset: new Date().toISOString().split('T')[0],
    enabled: true,
    createdAt: new Date().toISOString()
  };

  await docRef!.set(newKey);
  return { rawKey, keyPrefix };
}

export async function deleteClientKey(uid: string, keyId: string): Promise<boolean> {
  const docRef = firestore.collection('user_keys').doc(keyId);
  const doc = await docRef.get();
  if (!doc.exists) return false;
  const data = doc.data() as ClientKeyDoc;
  if (data.userId !== uid) return false; // Ensure ownership
  await docRef.delete();
  return true;
}

export async function toggleClientKey(uid: string, keyId: string, enabled: boolean): Promise<boolean> {
  const docRef = firestore.collection('user_keys').doc(keyId);
  const doc = await docRef.get();
  if (!doc.exists) return false;
  const data = doc.data() as ClientKeyDoc;
  if (data.userId !== uid) return false; // Ensure ownership
  await docRef.update({ enabled });
  return true;
}

export async function lookupClientKey(hashedKey: string): Promise<ClientKeyDoc | null> {
  const docRef = firestore.collection('user_keys').doc(hashedKey);
  const doc = await docRef.get();
  if (!doc.exists) return null;

  const data = doc.data() as any;
  if (!data.enabled) return null;

  // Lazy quota reset if it's a new day
  const today = new Date().toISOString().split('T')[0];
  if (data.lastQuotaReset < today) {
    const updated = {
      ...data,
      tokensUsedToday: 0,
      lastQuotaReset: today
    };
    await docRef.set(updated);
    return { id: doc.id, ...updated } as ClientKeyDoc;
  }

  return { id: doc.id, ...data } as ClientKeyDoc;
}

export async function incrementClientKeyUsage(hashedKey: string, tokens: number): Promise<void> {
  const docRef = firestore.collection('user_keys').doc(hashedKey);
  await firestore.runTransaction(async (transaction: any) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) return;
    const data = doc.data() as any;
    transaction.update(docRef, {
      tokensUsedToday: (data.tokensUsedToday || 0) + tokens
    });
  });
}

// Model Aliases
export interface ModelAliasDoc {
  id: string;
  alias: string;
  targetModelDbId: string | null;
}

export async function getModelAliases(uid: string): Promise<ModelAliasDoc[]> {
  const snapshot = await firestore
    .collection('users')
    .doc(uid)
    .collection('model_aliases')
    .get();
  return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as ModelAliasDoc));
}

export async function createModelAlias(uid: string, alias: string, targetModelDbId: string | null): Promise<string> {
  const aliasesColl = firestore.collection('users').doc(uid).collection('model_aliases');
  const existing = await aliasesColl.where('alias', '==', alias).limit(1).get();
  if (!existing.empty) {
    throw new Error('Alias already exists');
  }

  const docRef = aliasesColl.doc();
  await docRef.set({
    alias,
    targetModelDbId
  });
  return docRef.id;
}

export async function deleteModelAlias(uid: string, aliasId: string): Promise<boolean> {
  const docRef = firestore.collection('users').doc(uid).collection('model_aliases').doc(aliasId);
  const doc = await docRef.get();
  if (!doc.exists) return false;
  await docRef.delete();
  return true;
}

export async function resolveAlias(uid: string, alias: string): Promise<string | null | undefined> {
  const snapshot = await firestore
    .collection('users')
    .doc(uid)
    .collection('model_aliases')
    .where('alias', '==', alias)
    .limit(1)
    .get();

  if (snapshot.empty) return undefined;
  const data = snapshot.docs[0].data();
  return data.targetModelDbId;
}

// User Lookup by Unified API Key (for proxy request authentication)
export async function lookupUserByUnifiedApiKey(apiKey: string): Promise<UserProfile | null> {
  const snapshot = await firestore
    .collection('users')
    .where('unifiedApiKey', '==', apiKey)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as UserProfile;
}

export async function resetDailyQuotas(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const snapshot = await firestore.collection('user_keys').where('lastQuotaReset', '<', today).get();
  if (snapshot.empty) return;
  const batch = firestore.batch();
  for (const doc of snapshot.docs) {
    batch.update(doc.ref, { tokensUsedToday: 0, lastQuotaReset: today });
  }
  await batch.commit();
}

