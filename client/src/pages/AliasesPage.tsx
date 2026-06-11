import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/page-header';
import { Trash2, Shuffle, GitBranch, Plus, Info } from 'lucide-react';

interface ModelAlias {
  id: number;
  alias: string;
  targetModelDbId: number | null;
  targetDisplayName: string | null;
  targetPlatform: string | null;
}

interface ModelCatalogItem {
  id: number;
  platform: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
}

export default function AliasesPage() {
  const queryClient = useQueryClient();
  const [key, setKeyState] = useState(() => localStorage.getItem('freellmapi_admin_key') || '');
  const [alias, setAlias] = useState('');
  const [targetId, setTargetId] = useState('auto'); // 'auto' or database ID string

  useQuery({
    queryKey: ['auto-admin-key-aliases'],
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

  const { data: aliases = [], isLoading: isAliasesLoading } = useQuery<ModelAlias[]>({
    queryKey: ['aliases', key],
    queryFn: () => apiFetch<ModelAlias[]>('/api/model-aliases', {
      headers: { 'Authorization': `Bearer ${key}` }
    }),
    enabled: !!key
  });

  const { data: models = [], isLoading: isModelsLoading } = useQuery<ModelCatalogItem[]>({
    queryKey: ['models'],
    queryFn: () => apiFetch<ModelCatalogItem[]>('/api/models'),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const dbId = targetId === 'auto' ? null : parseInt(targetId, 10);
      return apiFetch('/api/model-aliases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({ alias, targetModelDbId: dbId })
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aliases'] });
      setAlias('');
      setTargetId('auto');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/model-aliases/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${key}` }
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['aliases'] })
  });

  if (!key) {
    return (
      <div className="max-w-md mx-auto mt-12 p-6 border rounded-xl bg-card shadow-lg animate-in fade-in duration-300">
        <h2 className="text-lg font-semibold tracking-tight mb-2">Admin Authentication Required</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Access to model alias mapping is restricted. Enter your unified API key to continue.
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

  const enabledModels = models.filter(m => m.enabled);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Model Aliases"
        description="Map incoming custom models or client configurations to specific active database models or cascading routing chains."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side: Create Alias Form */}
        <div className="lg:col-span-1 space-y-6">
          <div className="p-5 border rounded-xl bg-card shadow-sm space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Plus className="size-4 text-emerald-500" />
              Add Model Alias
            </h3>

            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-medium">Requested Model Alias</Label>
                <Input 
                  type="text" 
                  value={alias} 
                  onChange={e => setAlias(e.target.value)} 
                  placeholder="e.g. gpt-4, claude-sonnet" 
                  className="text-xs h-9 font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] font-medium">Mapped Target Model</Label>
                <Select value={targetId} onValueChange={(v) => setTargetId(v ?? 'auto')}>
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue placeholder="Select target model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-Route (Cascading Fallback)</SelectItem>
                    {enabledModels.map(m => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.displayName} ({m.platform})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button 
                onClick={() => createMutation.mutate()} 
                disabled={!alias || createMutation.isPending || isModelsLoading}
                className="w-full mt-2 text-xs h-9"
              >
                {createMutation.isPending ? 'Saving...' : 'Create Alias'}
              </Button>
              {createMutation.isError && (
                <p className="text-[10px] text-destructive mt-1">
                  {(createMutation.error as Error).message || 'Failed to create alias.'}
                </p>
              )}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-muted/20 border text-xs space-y-2 text-muted-foreground leading-relaxed">
            <h4 className="font-medium text-foreground flex items-center gap-1">
              <Info className="size-3.5 text-blue-500" />
              How Aliasing Works
            </h4>
            <p>
              When an external app calls the completion proxy requesting a specific model (e.g. `model: "gpt-4"`), the proxy checks the aliases list:
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                If mapped to a <strong>Target Model</strong>, the proxy automatically rewrites the model parameter and routes to that model directly.
              </li>
              <li>
                If mapped to <strong>Auto-Route</strong>, the proxy invokes the cascading fallback intelligence chain, picking the best active model automatically.
              </li>
            </ul>
          </div>
        </div>

        {/* Right Side: Mapped Aliases Grid */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Configured Aliases ({aliases.length})</h3>
          </div>

          {isAliasesLoading ? (
            <div className="space-y-3">
              <div className="h-16 bg-muted/40 animate-pulse rounded-xl" />
              <div className="h-16 bg-muted/40 animate-pulse rounded-xl" />
            </div>
          ) : aliases.length === 0 ? (
            <div className="p-8 border border-dashed rounded-xl text-center bg-card">
              <p className="text-sm text-muted-foreground">No aliases defined yet.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {aliases.map(a => (
                <div key={a.id} className="flex items-center justify-between p-4 border rounded-xl bg-card hover:bg-muted/15 transition-all gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Shuffle className="size-3.5 text-purple-500 shrink-0" />
                      <span className="font-mono text-xs font-semibold tracking-tight">{a.alias}</span>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 leading-none">
                      <GitBranch className="size-3 text-emerald-500 shrink-0" />
                      {a.targetDisplayName ? (
                        <span>
                          routes to <strong className="text-foreground">{a.targetDisplayName}</strong> on <span className="capitalize">{a.targetPlatform}</span>
                        </span>
                      ) : (
                        <span>routes to <strong className="text-foreground">Auto-Route</strong> (cascading fallback)</span>
                      )}
                    </div>
                  </div>

                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/5 size-8 p-0 shrink-0" 
                    onClick={() => deleteMutation.mutate(a.id)}
                    disabled={deleteMutation.isPending}
                    title="Delete alias"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
