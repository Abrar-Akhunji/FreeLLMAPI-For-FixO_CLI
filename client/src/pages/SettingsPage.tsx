import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/page-header';
import { Sliders, Cpu, Shield, Check, Info } from 'lucide-react';

interface Settings {
  smart_routing: string;
  prompt_translation: string;
  ollama_local_enabled: string;
  ollama_local_url: string;
  multi_tenant_auth: string;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [key, setKeyState] = useState(() => localStorage.getItem('freellmapi_admin_key') || '');
  const [success, setSuccess] = useState('');
  const [localUrl, setLocalUrl] = useState('');

  useQuery({
    queryKey: ['auto-admin-key-settings'],
    queryFn: async () => {
      if (key) return key;
      try {
        const data = await apiFetch<{ apiKey: string }>('/api/settings/api-key');
        if (data.apiKey) {
          localStorage.setItem('freellmapi_admin_key', data.apiKey);
          setKeyState(data.apiKey);
          return data.apiKey;
        }
      } catch {
        // Suppress error if API key endpoint is not configured or authenticated yet
      }
      return '';
    },
    enabled: !key
  });

  const setKey = (val: string) => {
    localStorage.setItem('freellmapi_admin_key', val);
    setKeyState(val);
  };

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ['settings-global', key],
    queryFn: () => apiFetch<Settings>('/api/settings/global', {
      headers: { 'Authorization': `Bearer ${key}` }
    }),
    enabled: !!key
  });

  const mutation = useMutation({
    mutationFn: async (newSettings: Partial<Settings>) => {
      return apiFetch('/api/settings/global', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify(newSettings)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-global'] });
      setSuccess('Settings updated successfully!');
      setTimeout(() => setSuccess(''), 3000);
    }
  });

  if (!key) {
    return (
      <div className="max-w-md mx-auto mt-12 p-6 border rounded-xl bg-card shadow-lg animate-in fade-in duration-300">
        <h2 className="text-lg font-semibold tracking-tight mb-2">Admin Authentication Required</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Access to global router settings is restricted. Enter your unified API key to continue.
        </p>
        <Input 
          type="password" 
          placeholder="Enter unified API key..." 
          className="font-mono text-xs mb-3"
          onKeyDown={(e) => {
            if (e.key === 'Enter') setKey(e.currentTarget.value);
          }}
          autoFocus
        />
        <p className="text-[11px] text-muted-foreground">Press <kbd className="font-mono bg-muted px-1 rounded">Enter</kbd> to authenticate.</p>
      </div>
    );
  }

  const handleToggle = (field: keyof Settings, checked: boolean) => {
    mutation.mutate({ [field]: checked ? 'true' : 'false' });
  };

  const handleUrlBlur = () => {
    if (localUrl && localUrl !== settings?.ollama_local_url) {
      mutation.mutate({ ollama_local_url: localUrl });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Global Settings"
        description="Configure next-generation router optimization, fallback rules, and multi-tenant quotas."
      />

      {isLoading ? (
        <div className="space-y-4 max-w-3xl">
          <div className="h-24 bg-muted/40 animate-pulse rounded-lg" />
          <div className="h-24 bg-muted/40 animate-pulse rounded-lg" />
          <div className="h-24 bg-muted/40 animate-pulse rounded-lg" />
        </div>
      ) : settings ? (
        <div className="space-y-6 max-w-3xl">
          {/* Smart Routing */}
          <div className="flex items-start justify-between p-5 border rounded-xl bg-card shadow-sm hover:border-foreground/10 transition-all gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sliders className="size-4.5 text-emerald-500" />
                <h3 className="font-semibold text-sm">Context-Aware Smart Routing</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Dynamically routes incoming requests by inspecting prompt length. Automatically bypasses models with small context windows for large prompts, and load-balances queries to weaker models for simple phrases to save high-intelligence quota.
              </p>
            </div>
            <div className="pt-0.5">
              <Switch 
                checked={settings.smart_routing === 'true'} 
                onCheckedChange={(checked) => handleToggle('smart_routing', checked)}
              />
            </div>
          </div>

          {/* Prompt Translation */}
          <div className="flex items-start justify-between p-5 border rounded-xl bg-card shadow-sm hover:border-foreground/10 transition-all gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Info className="size-4.5 text-blue-500" />
                <h3 className="font-semibold text-sm">Prompt Translation Middleware</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Standardizes messages across heterogeneous models. Strips reasoning blocks (e.g. `&lt;think&gt;` tags) from chat history when routing to non-reasoning fallbacks, auto-converts unsupported system instructions, and fixes missing tool call identifiers.
              </p>
            </div>
            <div className="pt-0.5">
              <Switch 
                checked={settings.prompt_translation === 'true'} 
                onCheckedChange={(checked) => handleToggle('prompt_translation', checked)}
              />
            </div>
          </div>

          {/* Ollama Local Fallback */}
          <div className="border rounded-xl bg-card shadow-sm overflow-hidden">
            <div className="flex items-start justify-between p-5 gap-6">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Cpu className="size-4.5 text-purple-500" />
                  <h3 className="font-semibold text-sm">Ollama Local Fallback</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Cascades failing cloud completions down to local offline models. Automatically scans your local Ollama tags to populate the fallback pool. Safe, private, and has zero network dependencies.
                </p>
              </div>
              <div className="pt-0.5">
                <Switch 
                  checked={settings.ollama_local_enabled === 'true'} 
                  onCheckedChange={(checked) => handleToggle('ollama_local_enabled', checked)}
                />
              </div>
            </div>

            {settings.ollama_local_enabled === 'true' && (
              <div className="px-5 pb-5 pt-1 border-t bg-muted/15 flex flex-col sm:flex-row sm:items-center gap-4 animate-in slide-in-from-top-2 duration-200">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium text-foreground">Local Ollama API Endpoint</label>
                  <p className="text-[10px] text-muted-foreground">The HTTP address where Ollama is running on your machine.</p>
                </div>
                <Input 
                  type="text" 
                  value={localUrl !== '' ? localUrl : settings.ollama_local_url}
                  onChange={(e) => setLocalUrl(e.target.value)}
                  onBlur={handleUrlBlur}
                  onKeyDown={(e) => e.key === 'Enter' && handleUrlBlur()}
                  className="sm:w-72 font-mono text-xs h-9"
                  placeholder="http://localhost:11434"
                />
              </div>
            )}
          </div>

          {/* Team-Share Mode */}
          <div className="flex items-start justify-between p-5 border rounded-xl bg-card shadow-sm hover:border-foreground/10 transition-all gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Shield className="size-4.5 text-amber-500" />
                <h3 className="font-semibold text-sm">Team-Share Mode (Multi-Tenant Auth)</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Enables creating separate user-specific API keys with daily token limits. Turn this on to share your unified proxy pool with team members or developers safely without exposing your main administrator credentials.
              </p>
            </div>
            <div className="pt-0.5">
              <Switch 
                checked={settings.multi_tenant_auth === 'true'} 
                onCheckedChange={(checked) => handleToggle('multi_tenant_auth', checked)}
              />
            </div>
          </div>

          {/* Success toast / status message */}
          {success && (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-lg text-xs font-medium animate-in fade-in duration-300">
              <Check className="size-3.5" />
              {success}
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 border border-rose-500/20 bg-rose-500/5 text-rose-600 rounded-xl max-w-3xl text-xs font-medium">
          Failed to fetch settings from server. Check your console and try logging in again.
        </div>
      )}
    </div>
  );
}
