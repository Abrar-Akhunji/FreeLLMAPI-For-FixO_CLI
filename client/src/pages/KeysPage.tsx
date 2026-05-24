import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/page-header'
import { ExternalLink, Sparkles, Info, Key } from 'lucide-react'
import type { ApiKey, Platform } from '../../../shared/types'

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'google', label: 'Google AI Studio' },
  { value: 'groq', label: 'Groq' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'sambanova', label: 'SambaNova' },
  { value: 'nvidia', label: 'NVIDIA NIM' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'github', label: 'GitHub Models' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI' },
  { value: 'zhipu', label: 'Zhipu AI (Z.ai)' },
  { value: 'ollama', label: 'Ollama Cloud' },
  { value: 'kilo', label: 'Kilo Gateway (anon ok)' },
  { value: 'pollinations', label: 'Pollinations (anon ok)' },
  { value: 'llm7', label: 'LLM7 (anon ok)' },
]

const PLATFORM_HELPERS: Record<Platform, {
  url?: string;
  freeTier: string;
  models: string;
  tips?: string;
}> = {
  google: {
    url: 'https://aistudio.google.com/',
    freeTier: '15 RPM / 1.5M TPM / 1,500 RPD (100% Free)',
    models: 'Gemini 2.5 Flash, Gemini 1.5 Pro/Flash, Gemma 2',
    tips: 'Recommended! Best for complex agent coding and multi-modal instructions.'
  },
  groq: {
    url: 'https://console.groq.com/keys',
    freeTier: 'Generous limits depending on model tiers (100% Free)',
    models: 'Llama 3 8B/70B, Mixtral 8x7B, Gemma 2 9B',
    tips: 'Ultra-low latency inference, perfect for lightning-fast edits.'
  },
  cerebras: {
    url: 'https://cloud.cerebras.ai/',
    freeTier: 'Completely free during beta/introductory tier',
    models: 'Llama 3.1 8B, Llama 3.1 70B',
    tips: 'World-record speed sub-second inference engine.'
  },
  sambanova: {
    url: 'https://cloud.sambanova.ai/',
    freeTier: 'Free developer access limits',
    models: 'Llama 3.1 405B, Qwen 2.5 72B',
    tips: 'Excellent capability with massive-parameter Llama 405B.'
  },
  nvidia: {
    url: 'https://build.nvidia.com/',
    freeTier: '1,000 free API credits to start',
    models: 'Mistral Large, Llama 3.1 405B, Gemma 2',
    tips: 'High availability and enterprise performance.'
  },
  mistral: {
    url: 'https://console.mistral.ai/api-keys/',
    freeTier: 'Limited free access on developer tiers',
    models: 'Mistral Large, Codestral, Pixtral',
    tips: 'Top-tier code completion and French/multilingual support.'
  },
  openrouter: {
    url: 'https://openrouter.ai/keys',
    freeTier: 'Free models list (unlimited/anon rate limits)',
    models: 'Llama 3 Free, Mistral Free, Gemma Free',
    tips: 'Excellent fallback gateway routing to various free clusters.'
  },
  github: {
    url: 'https://github.com/settings/tokens',
    freeTier: 'Free developer request quota per model',
    models: 'GPT-4o, Claude 3.5 Sonnet, Llama 3.1 70B',
    tips: 'Requires Personal Access Token (classic/fine-grained). Easy setup!'
  },
  cohere: {
    url: 'https://dashboard.cohere.com/api-keys',
    freeTier: 'Free trial keys with rate limits',
    models: 'Command R, Command R+',
    tips: 'Superb text parsing, multilingual agent support.'
  },
  cloudflare: {
    url: 'https://dash.cloudflare.com/',
    freeTier: '10,000 free runs/day on workers tier',
    models: 'Llama 3, Mistral, Qwen, DeepSeek',
    tips: 'Requires both Account ID and API Token configured as AccountID:ApiToken.'
  },
  zhipu: {
    url: 'https://open.bigmodel.cn/usercenter/apikeys',
    freeTier: 'Free trials upon registration',
    models: 'GLM-4 Flash, GLM-4',
    tips: 'Leading Chinese-English bilingual LLM provider.'
  },
  ollama: {
    url: 'https://ollama.com/',
    freeTier: 'Self-hosted (100% free and offline)',
    models: 'Local models (e.g. Llama 3, DeepSeek, Qwen)',
    tips: 'Requires local Ollama. Enter any placeholder or "anonymous" key.'
  },
  kilo: {
    url: 'https://kilo.llm7.net',
    freeTier: 'Fully anonymous and unlimited (shared pool)',
    models: 'Routed free models',
    tips: 'No key needed! Type "anonymous" as the key to initialize.'
  },
  pollinations: {
    url: 'https://pollinations.ai/',
    freeTier: 'Free and anonymous server',
    models: 'Mistral, Llama, and generative image tools',
    tips: 'No key needed! Enter "anonymous" or any placeholder.'
  },
  llm7: {
    url: 'https://llm7.net/',
    freeTier: 'Free shared access layer',
    models: 'General models',
    tips: 'No key needed! Enter "anonymous" as the key to verify.'
  },
  'ollama-local': {
    url: 'http://localhost:11434',
    freeTier: 'Self-hosted (100% free and offline)',
    models: 'Local models (e.g. Llama 3, DeepSeek, Qwen)',
    tips: 'Requires local Ollama. It will be discovered automatically.'
  }
}

const statusDot: Record<string, string> = {
  healthy: 'bg-emerald-500',
  rate_limited: 'bg-amber-500',
  invalid: 'bg-rose-500',
  error: 'bg-rose-500',
  unknown: 'bg-muted-foreground/40',
}

const statusLabel: Record<string, string> = {
  healthy: 'healthy',
  rate_limited: 'rate-limited',
  invalid: 'invalid',
  error: 'error',
  unknown: 'unchecked',
}

interface HealthPlatform {
  platform: string
  totalKeys: number
  healthyKeys: number
  rateLimitedKeys: number
  invalidKeys: number
  errorKeys: number
  unknownKeys: number
}

interface HealthData {
  platforms: HealthPlatform[]
  keys: { id: number; platform: string; status: string; lastCheckedAt: string | null }[]
}

function UnifiedKeySection() {
  const queryClient = useQueryClient()
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const { data } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const regenerate = useMutation({
    mutationFn: () => apiFetch('/api/settings/api-key/regenerate', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['unified-key'] }),
  })

  const apiKey = data?.apiKey ?? ''
  const masked = apiKey ? apiKey.slice(0, 13) + '•'.repeat(32) : '…'
  const baseUrl = import.meta.env.DEV
    ? `http://${window.location.hostname}:${__SERVER_PORT__}/v1`
    : `${window.location.origin}/v1`

  function copy() {
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-medium">Your unified API key</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Use this as your OpenAI <code className="font-mono">api_key</code>; it authenticates requests to this proxy.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
        >
          Regenerate
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-xs bg-muted px-3 py-2 rounded-md select-all truncate tabular-nums">
          {showKey ? apiKey : masked}
        </code>
        <Button variant="outline" size="sm" onClick={() => setShowKey(!showKey)}>
          {showKey ? 'Hide' : 'Show'}
        </Button>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Base URL</span>
        <code className="font-mono">{baseUrl}</code>
        <span className="text-muted-foreground">Endpoint</span>
        <code className="font-mono">/v1/chat/completions</code>
      </div>
    </section>
  )
}

function PlatformOnboardingHub() {
  return (
    <section className="rounded-lg border bg-card/40 backdrop-blur p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <Sparkles className="size-4 text-emerald-500 animate-pulse" />
          Free API Credentials Console
        </h2>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
          Navigate directly to official panels to generate free keys instantly. Hover/click links to get started:
        </p>
      </div>

      <div className="space-y-2.5 max-h-[580px] overflow-y-auto pr-1">
        {PLATFORMS.map(p => {
          const helper = PLATFORM_HELPERS[p.value]
          if (!helper || !helper.url) return null
          return (
            <div key={p.value} className="text-xs p-3 rounded-md bg-muted/30 border border-muted hover:border-foreground/20 hover:bg-muted/50 transition-all group">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                  <Key className="size-3 text-muted-foreground group-hover:text-emerald-500 transition-colors" />
                  {p.label}
                </span>
                <a
                  href={helper.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-emerald-500 hover:text-emerald-400 font-medium transition-colors"
                >
                  Get Key <ExternalLink className="size-3" />
                </a>
              </div>
              <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground leading-relaxed">
                <div>
                  <strong className="text-foreground/80 font-medium">Free:</strong> {helper.freeTier}
                </div>
                <div className="truncate">
                  <strong className="text-foreground/80 font-medium">Models:</strong> {helper.models}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="p-3 rounded-md bg-emerald-500/5 border border-emerald-500/10 text-[11px] text-muted-foreground leading-relaxed">
        💡 **Tip:** FreeLLMAPI load-balances and cascades requests automatically. Configuring 3+ providers secures 99.9% routing reliability.
      </div>
    </section>
  )
}

export default function KeysPage() {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [label, setLabel] = useState('')

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ['keys'],
    queryFn: () => apiFetch('/api/keys'),
  })

  const { data: healthData } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health'),
    refetchInterval: 30000,
  })

  const addKey = useMutation({
    mutationFn: (body: { platform: string; key: string; label?: string }) =>
      apiFetch('/api/keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setPlatform('')
      setApiKey('')
      setAccountId('')
      setLabel('')
    },
  })

  const deleteKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })

  const checkAll = useMutation({
    mutationFn: () => apiFetch('/api/health/check-all', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const checkKey = useMutation({
    mutationFn: (keyId: number) => apiFetch(`/api/health/check/${keyId}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const needsAccountId = platform === 'cloudflare'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!platform || !apiKey) return
    if (needsAccountId && !accountId) return
    const key = needsAccountId ? `${accountId}:${apiKey}` : apiKey
    addKey.mutate({ platform, key, label: label || undefined })
  }

  const healthKeyMap = new Map<number, { status: string; lastCheckedAt: string | null }>()
  for (const k of healthData?.keys ?? []) healthKeyMap.set(k.id, k)

  const grouped = PLATFORMS.map(p => ({
    ...p,
    keys: keys.filter(k => k.platform === p.value),
  })).filter(p => p.keys.length > 0)

  const activeHelper = platform ? PLATFORM_HELPERS[platform as Platform] : null

  return (
    <div>
      <PageHeader
        title="Keys"
        description="Provider credentials and the unified API key your apps connect with."
        actions={
          keys.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => checkAll.mutate()} disabled={checkAll.isPending}>
              {checkAll.isPending ? 'Checking…' : 'Check all'}
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-8">
          <UnifiedKeySection />

          <section>
            <h2 className="text-sm font-medium mb-3">Add a provider key</h2>
            <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border p-4 bg-card">
              <div className="space-y-1.5">
                <Label className="text-xs">Platform</Label>
                <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {needsAccountId && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Account ID</Label>
                  <Input
                    value={accountId}
                    onChange={e => setAccountId(e.target.value)}
                    placeholder="a1b2c3d4…"
                    className="w-[200px] font-mono text-xs"
                  />
                </div>
              )}
              <div className="space-y-1.5 flex-1 min-w-[240px]">
                <Label className="text-xs">{needsAccountId ? 'API token' : 'API key'}</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={needsAccountId ? 'Bearer token' : 'paste key here'}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Label</Label>
                <Input
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="optional"
                  className="w-[160px]"
                />
              </div>
              <Button type="submit" size="sm" disabled={!platform || !apiKey || (needsAccountId && !accountId) || addKey.isPending}>
                {addKey.isPending ? 'Adding…' : 'Add key'}
              </Button>

              {/* Dynamic Context Onboarding Helper */}
              {platform && activeHelper && (
                <div className="w-full mt-3 p-3 rounded-md bg-muted/40 border text-xs space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <Info className="size-3.5 text-emerald-500" />
                      About {PLATFORMS.find(p => p.value === platform)?.label}
                    </span>
                    {activeHelper.url && (
                      <a
                        href={activeHelper.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] text-emerald-500 hover:text-emerald-400 font-medium"
                      >
                        Open Console <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    <strong className="text-foreground/80">Capacity:</strong> {activeHelper.freeTier}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    <strong className="text-foreground/80">Models:</strong> {activeHelper.models}
                  </div>
                  {activeHelper.tips && (
                    <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium italic mt-1 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10">
                      ★ {activeHelper.tips}
                    </div>
                  )}
                </div>
              )}
            </form>
            {addKey.isError && (
              <p className="text-destructive text-xs mt-2">{(addKey.error as Error).message}</p>
            )}
          </section>

          <section>
            <h2 className="text-sm font-medium mb-3">Configured providers</h2>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : keys.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No provider keys yet. Add one above to start routing.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {grouped.map(group => (
                  <div key={group.value}>
                    <div className="flex items-baseline justify-between mb-2">
                      <h3 className="text-sm font-medium">{group.label}</h3>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {group.keys.length} key{group.keys.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="rounded-lg border divide-y bg-card overflow-hidden">
                      {group.keys.map(k => {
                        const h = healthKeyMap.get(k.id)
                        const status = h?.status ?? k.status
                        const lastChecked = h?.lastCheckedAt
                        return (
                          <div key={k.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                            <span className={`size-1.5 rounded-full flex-shrink-0 ${statusDot[status] ?? statusDot.unknown}`} />
                            <code className="text-xs font-mono flex-shrink-0">{k.maskedKey}</code>
                            {k.label && <span className="text-xs text-muted-foreground">{k.label}</span>}
                            <span className="text-xs text-muted-foreground">{statusLabel[status] ?? status}</span>
                            <div className="flex-1" />
                            {lastChecked && (
                              <span className="text-[11px] text-muted-foreground tabular-nums">
                                {new Date(lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                            <Button variant="ghost" size="xs" onClick={() => checkKey.mutate(k.id)} disabled={checkKey.isPending}>
                              Check
                            </Button>
                            <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={() => deleteKey.mutate(k.id)} disabled={deleteKey.isPending}>
                              Remove
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Sidebar Platform Onboarding Hub */}
        <div className="lg:col-span-1">
          <PlatformOnboardingHub />
        </div>
      </div>
    </div>
  )
}

