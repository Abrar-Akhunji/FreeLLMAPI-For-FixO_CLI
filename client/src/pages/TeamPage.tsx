import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/page-header';
import { Users, Trash2, KeyRound, Copy, Check, Info, Coins, ShieldAlert } from 'lucide-react';

interface UserKey {
  id: number;
  label: string;
  key_prefix: string;
  dailyTokenQuota: number | null;
  tokensUsedToday: number;
  enabled: boolean;
  createdAt: string;
}

export default function TeamPage() {
  const queryClient = useQueryClient();
  const [key, setKeyState] = useState(() => localStorage.getItem('freellmapi_admin_key') || '');
  const [name, setName] = useState('');
  const [quota, setQuota] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useQuery({
    queryKey: ['auto-admin-key-team'],
    queryFn: async () => {
      if (key) return key;
      try {
        const data = await apiFetch<{ apiKey: string }>('/api/settings/api-key');
        if (data.apiKey) {
          localStorage.setItem('freellmapi_admin_key', data.apiKey);
          setKeyState(data.apiKey);
          return data.apiKey;
        }
      } catch (e) {}
      return '';
    },
    enabled: !key
  });

  const setKey = (val: string) => {
    localStorage.setItem('freellmapi_admin_key', val);
    setKeyState(val);
  };

  const { data: users = [], isLoading } = useQuery<UserKey[]>({
    queryKey: ['users', key],
    queryFn: () => apiFetch<UserKey[]>('/api/users', {
      headers: { 'Authorization': `Bearer ${key}` }
    }),
    enabled: !!key
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const q = parseInt(quota, 10);
      return apiFetch<{ key: string }>('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({ name, role: 'member', daily_quota: isNaN(q) ? null : q })
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setNewlyCreatedKey(data.key);
      setName('');
      setQuota('');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${key}` }
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] })
  });

  const copyKey = () => {
    if (newlyCreatedKey) {
      navigator.clipboard.writeText(newlyCreatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (!key) {
    return (
      <div className="max-w-md mx-auto mt-12 p-6 border rounded-xl bg-card shadow-lg animate-in fade-in duration-300">
        <h2 className="text-lg font-semibold tracking-tight mb-2">Admin Authentication Required</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Access to team credentials and key management is restricted. Enter your unified API key to continue.
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

  return (
    <div className="space-y-8">
      <PageHeader
        title="Team Management"
        description="Provision keys, manage team members, and allocate daily token quotas (Team-Share Mode)."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side: Creation Form */}
        <div className="lg:col-span-1 space-y-6">
          <div className="p-5 border rounded-xl bg-card shadow-sm space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Users className="size-4 text-emerald-500" />
              Add Team Member
            </h3>
            
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-foreground">User Name / Identifier</label>
                <Input 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  placeholder="e.g. John Doe, Web App client" 
                  className="text-xs h-9"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-foreground">Daily Token Quota (optional)</label>
                <Input 
                  type="number" 
                  value={quota} 
                  onChange={e => setQuota(e.target.value)} 
                  placeholder="e.g. 50000 (leave empty for unlimited)" 
                  className="text-xs h-9 font-mono"
                />
              </div>

              <Button 
                onClick={() => createMutation.mutate()} 
                disabled={!name || createMutation.isPending}
                className="w-full mt-2 text-xs h-9"
              >
                {createMutation.isPending ? 'Generating...' : 'Create Key'}
              </Button>
            </div>

            {newlyCreatedKey && (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-lg text-xs space-y-2 animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center gap-1">
                    <KeyRound className="size-3.5" />
                    Copy API Key
                  </span>
                  <Button variant="ghost" size="xs" onClick={copyKey} className="h-6 px-2 hover:bg-emerald-500/20 text-emerald-600">
                    {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                  </Button>
                </div>
                <code className="block p-2 bg-muted font-mono text-[10px] rounded border overflow-x-auto text-foreground select-all break-all leading-tight">
                  {newlyCreatedKey}
                </code>
                <p className="text-[9px] text-muted-foreground italic leading-normal flex items-start gap-1">
                  <ShieldAlert className="size-3 text-amber-500 shrink-0 mt-0.5" />
                  Make sure to save this credentials token now. It will not be shown again.
                </p>
              </div>
            )}
          </div>

          <div className="p-4 rounded-xl bg-muted/20 border text-xs space-y-2 text-muted-foreground leading-relaxed">
            <h4 className="font-medium text-foreground flex items-center gap-1">
              <Info className="size-3.5 text-blue-500" />
              About Team Quotas
            </h4>
            <p>
              When a user makes requests using their provided key, their consumed input and output tokens are tracked in SQLite. 
              If the cumulative usage exceeds their configured daily quota, the proxy rejects further completions with a 429 status code. 
              Quotas reset daily at midnight server-time.
            </p>
          </div>
        </div>

        {/* Right Side: Active Members List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Active Members ({users.length})</h3>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              <div className="h-16 bg-muted/40 animate-pulse rounded-xl" />
              <div className="h-16 bg-muted/40 animate-pulse rounded-xl" />
              <div className="h-16 bg-muted/40 animate-pulse rounded-xl" />
            </div>
          ) : users.length === 0 ? (
            <div className="p-8 border border-dashed rounded-xl text-center bg-card">
              <p className="text-sm text-muted-foreground">No team members provisioned yet.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {users.map(u => {
                const percentage = u.dailyTokenQuota 
                  ? Math.min(100, Math.round((u.tokensUsedToday / u.dailyTokenQuota) * 100))
                  : 0;

                return (
                  <div key={u.id} className="flex flex-col md:flex-row md:items-center justify-between p-4 border rounded-xl bg-card hover:bg-muted/15 transition-all gap-4">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm tracking-tight truncate">{u.label}</span>
                        <code className="text-[10px] font-mono bg-muted/80 px-2 py-0.5 rounded text-muted-foreground border shrink-0">{u.key_prefix}</code>
                      </div>
                      
                      <div className="space-y-1 w-full max-w-md">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Coins className="size-3 text-emerald-500 shrink-0" />
                            <span>Used: <strong className="text-foreground">{u.tokensUsedToday.toLocaleString()}</strong> / {u.dailyTokenQuota ? `${u.dailyTokenQuota.toLocaleString()} tokens` : 'Unlimited'}</span>
                          </span>
                          {u.dailyTokenQuota && <span>{percentage}%</span>}
                        </div>
                        {u.dailyTokenQuota && (
                          <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-300 ${percentage > 90 ? 'bg-rose-500' : percentage > 75 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        )}
                      </div>

                      <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                        <span>Created: {new Date(u.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end md:self-auto border-t md:border-t-0 pt-2 md:pt-0 w-full md:w-auto justify-end">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/5 size-8 p-0" 
                        onClick={() => deleteMutation.mutate(u.id)}
                        disabled={deleteMutation.isPending}
                        title="Delete key"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
