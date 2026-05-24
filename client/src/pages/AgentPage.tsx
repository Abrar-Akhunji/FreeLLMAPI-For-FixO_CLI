import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import {
  Play,
  Terminal,
  Activity,
  Code,
  FileCode,
  FolderOpen,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
  FileText,
  Hammer
} from 'lucide-react'

// Log item shapes
interface LineDiff {
  type: 'added' | 'removed' | 'normal'
  content: string
}

interface FileDiffSummary {
  file: string
  additions: number
  deletions: number
  lines: LineDiff[]
}

interface McpToolLog {
  id: string
  tool: string
  arguments: any
  status: 'started' | 'completed' | 'failed'
  timestamp: string
  durationMs?: number
  error?: string
  diffs?: FileDiffSummary[]
}

interface IndexStatus {
  isIndexing: boolean
  totalFiles: number
  totalSymbols: number
  lastIndexedAt: string | null
  durationMs: number
}

function ToolIcon({ tool }: { tool: string }) {
  const size = 18
  switch (tool) {
    case 'get_codebase_summary':
      return <Activity size={size} className="text-blue-500" />
    case 'list_directory':
      return <FolderOpen size={size} className="text-amber-500" />
    case 'read_file':
      return <FileText size={size} className="text-purple-500" />
    case 'write_file':
      return <FileCode size={size} className="text-emerald-500" />
    case 'grep_search':
      return <Search size={size} className="text-cyan-500" />
    case 'semantic_search':
      return <Code size={size} className="text-indigo-500" />
    default:
      return <Hammer size={size} className="text-muted-foreground" />
  }
}

function CodeDiffCard({ diff }: { diff: FileDiffSummary }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="border rounded-lg bg-background/50 overflow-hidden mt-3 shadow-sm transition-all duration-300">
      <div
        className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b cursor-pointer hover:bg-muted/50 select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 font-mono text-xs text-foreground truncate max-w-[70%]">
          <FileCode size={14} className="text-muted-foreground shrink-0" />
          <span title={diff.file}>{diff.file}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="flex items-center gap-1 font-mono text-xs">
            <span className="text-emerald-500 font-semibold">+{diff.additions}</span>
            <span className="text-rose-500 font-semibold">-{diff.deletions}</span>
          </span>
          {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed max-h-[400px] overflow-y-auto bg-card/40 divide-y divide-border/20">
          {diff.lines.length === 0 ? (
            <div className="text-center text-muted-foreground py-4 italic">No line modifications recorded.</div>
          ) : (
            diff.lines.map((line, idx) => {
              let bgClass = 'hover:bg-muted/10'
              let prefix = ' '
              let textClass = 'text-muted-foreground'

              if (line.type === 'added') {
                bgClass = 'bg-emerald-500/5 hover:bg-emerald-500/10 border-l-2 border-emerald-500 text-emerald-300/90'
                prefix = '+'
                textClass = 'text-emerald-500 font-medium'
              } else if (line.type === 'removed') {
                bgClass = 'bg-rose-500/5 hover:bg-rose-500/10 border-l-2 border-rose-500 text-rose-300/90'
                prefix = '-'
                textClass = 'text-rose-500 font-medium'
              } else {
                textClass = 'text-foreground/90'
              }

              return (
                <div key={idx} className={`flex items-start px-2 py-0.5 font-mono select-text transition-colors duration-150 ${bgClass}`}>
                  <span className={`w-6 select-none shrink-0 font-mono text-[10px] tabular-nums text-center ${textClass} mr-2 opacity-50`}>
                    {prefix}
                  </span>
                  <pre className="whitespace-pre-wrap break-all font-mono select-text flex-1">
                    {line.content || ' '}
                  </pre>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

function LogItemRow({ log }: { log: McpToolLog }) {
  const [argsExpanded, setArgsExpanded] = useState(false)

  const isCompleted = log.status === 'completed'
  const isFailed = log.status === 'failed'
  const isStarted = log.status === 'started'

  const formattedTime = new Date(log.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <div className="relative pl-8 pb-8 last:pb-0 group">
      {/* Visual Timeline connector */}
      <div className="absolute left-[9px] top-5 bottom-0 w-px bg-border group-last:hidden" />
      
      {/* Icon Badge */}
      <div className={`absolute left-0 top-1.5 size-5 rounded-full flex items-center justify-center border bg-background shadow-sm transition-transform duration-200 hover:scale-110 z-10
        ${isStarted ? 'border-amber-400 bg-amber-500/5 ring-4 ring-amber-500/10' : ''}
        ${isCompleted ? 'border-emerald-500 bg-emerald-500/5' : ''}
        ${isFailed ? 'border-rose-500 bg-rose-500/5' : ''}
      `}>
        {isStarted && <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />}
        {isCompleted && <CheckCircle2 size={10} className="text-emerald-500" />}
        {isFailed && <XCircle size={10} className="text-rose-500" />}
      </div>

      <div className="bg-card/50 backdrop-blur border rounded-xl p-4 shadow-sm hover:border-foreground/20 transition-all duration-300">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <ToolIcon tool={log.tool} />
            <span className="font-mono text-sm font-semibold tracking-tight">{log.tool}</span>
            <span className="text-[11px] text-muted-foreground font-mono">#{log.id.slice(0, 8)}</span>
          </div>

          <div className="flex items-center gap-2">
            {log.durationMs !== undefined && (
              <span className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                <Clock size={10} />
                {log.durationMs}ms
              </span>
            )}
            <span className="text-[11px] font-mono text-muted-foreground">{formattedTime}</span>
            
            {/* Status pill */}
            <span className={`text-[10px] font-mono uppercase font-semibold px-2 py-0.5 rounded-md tracking-wider border
              ${isStarted ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse' : ''}
              ${isCompleted ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : ''}
              ${isFailed ? 'bg-rose-500/10 text-rose-500 border-rose-500/20 border-dashed' : ''}
            `}>
              {log.status}
            </span>
          </div>
        </div>

        {/* Collapsible Arguments */}
        <div className="mt-2 text-xs">
          <button
            onClick={() => setArgsExpanded(!argsExpanded)}
            className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors duration-200 bg-muted/20 px-2 py-1 rounded"
          >
            {argsExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {argsExpanded ? 'Hide Parameters' : 'Show Parameters'}
          </button>

          {argsExpanded && (
            <pre className="mt-2 p-3 rounded-lg border bg-muted/30 font-mono text-[10px] leading-relaxed overflow-x-auto text-foreground">
              {JSON.stringify(log.arguments, null, 2)}
            </pre>
          )}
        </div>

        {/* Failures block */}
        {isFailed && log.error && (
          <div className="mt-3 p-3 rounded-lg border border-rose-500/20 bg-rose-500/5 text-rose-400 font-mono text-xs leading-normal">
            <span className="font-semibold select-none">Error: </span>
            {log.error}
          </div>
        )}

        {/* File Diff Visualizer */}
        {log.diffs && log.diffs.map((diff, i) => (
          <CodeDiffCard key={i} diff={diff} />
        ))}
      </div>
    </div>
  )
}

export default function AgentPage() {
  const queryClient = useQueryClient()

  // Real-time timeline polling every 1 second
  const { data: logsData } = useQuery<{ logs: McpToolLog[] }>({
    queryKey: ['mcp-logs'],
    queryFn: () => apiFetch('/api/mcp/logs'),
    refetchInterval: 1000,
  })

  // Indexer status polling every 1.5 seconds
  const { data: statusData } = useQuery<{ indexStatus: IndexStatus }>({
    queryKey: ['mcp-index-status'],
    queryFn: () => apiFetch('/api/mcp/index/status'),
    refetchInterval: 1500,
  })

  const logs = logsData?.logs || []
  const indexStatus = statusData?.indexStatus || {
    isIndexing: false,
    totalFiles: 0,
    totalSymbols: 0,
    lastIndexedAt: null,
    durationMs: 0,
  }

  // Trigger rebuilding AST index
  const { mutate: triggerReindex, isPending: isIndexingPending } = useMutation({
    mutationFn: () => apiFetch('/api/mcp/index/trigger', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-index-status'] })
    },
  })

  // Clear timeline logs
  const { mutate: clearLogs } = useMutation({
    mutationFn: () => apiFetch('/api/mcp/logs/clear', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-logs'] })
    },
  })

  const isScanning = indexStatus.isIndexing || isIndexingPending

  return (
    <div className="space-y-8">
      <PageHeader
        title="Agent Hub"
        description="Monitor structural code search actions, live tool histories, and file-diff changes performed by agentic code editors."
        actions={
          <div className="flex gap-2">
            {logs.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => clearLogs()} className="flex items-center gap-1 text-rose-500 hover:text-rose-600">
                <Trash2 size={14} />
                Clear Logs
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Workspace AST Indexer Controls */}
        <div className="space-y-6 lg:col-span-1">
          <Card className="bg-card/50 backdrop-blur border shadow-md rounded-xl overflow-hidden">
            <CardHeader className="bg-muted/20 border-b">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <FileCode size={18} className="text-primary" />
                AST Codebase Indexer
              </CardTitle>
              <CardDescription className="text-xs">
                Scan structural declarations for fast, token-efficient fuzzy code symbol routing.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-muted/40 rounded-lg border">
                  <div className="text-[10px] text-muted-foreground uppercase font-semibold font-mono tracking-wider">Symbols</div>
                  <div className="text-xl font-bold font-mono tracking-tight mt-1">{indexStatus.totalSymbols}</div>
                </div>
                <div className="p-3 bg-muted/40 rounded-lg border">
                  <div className="text-[10px] text-muted-foreground uppercase font-semibold font-mono tracking-wider">Files Scanned</div>
                  <div className="text-xl font-bold font-mono tracking-tight mt-1">{indexStatus.totalFiles}</div>
                </div>
              </div>

              {indexStatus.lastIndexedAt && (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-muted-foreground font-mono">
                    <span>Last Scan:</span>
                    <span className="text-foreground">
                      {new Date(indexStatus.lastIndexedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground font-mono">
                    <span>Scan Duration:</span>
                    <span className="text-foreground">{indexStatus.durationMs}ms</span>
                  </div>
                </div>
              )}

              <Button
                variant="default"
                disabled={isScanning}
                onClick={() => triggerReindex()}
                className="w-full flex items-center justify-center gap-2 font-medium"
              >
                <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
                {isScanning ? 'Scanning Codebase...' : 'Re-index Codebase'}
              </Button>
            </CardContent>
          </Card>

          {/* Quick Config Card */}
          <Card className="bg-card/50 backdrop-blur border shadow-md rounded-xl">
            <CardHeader className="bg-muted/20 border-b">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Terminal size={14} className="text-muted-foreground" />
                Integration Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 text-xs space-y-3">
              <p className="text-muted-foreground leading-relaxed">
                Connect your workspace editor (Aider, Cursor) via our custom stdio transport interface. Paste this setup block into your editor's MCP server configuration file:
              </p>
              <pre className="p-3 rounded-lg border bg-muted/30 font-mono text-[10px] leading-relaxed overflow-x-auto select-all text-muted-foreground">
{`{
  "mcpServers": {
    "freellmapi": {
      "command": "node",
      "args": [
        "/absolute/path/to/freellmapi/server/dist/mcp.js"
      ]
    }
  }
}`}
              </pre>
              <p className="text-muted-foreground">
                Once set up, the editor will autonomously call our fast AST symbol queries and stream all live action diff logs back to this visual page.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Timeline Log Feed */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="font-semibold text-sm tracking-tight flex items-center gap-2 text-muted-foreground">
            <Activity size={14} />
            Live Activity Timeline
            {logs.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full font-mono uppercase tracking-wider animate-pulse">
                Live Monitoring
              </span>
            )}
          </h3>

          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border bg-card/20 backdrop-blur shadow-inner space-y-4 border-dashed">
              <div className="size-12 rounded-full bg-muted/50 flex items-center justify-center border">
                <Play size={20} className="text-muted-foreground/80 animate-pulse" />
              </div>
              <div className="space-y-1 max-w-sm">
                <h4 className="font-semibold text-sm">Waiting for Agent Interactions</h4>
                <p className="text-xs text-muted-foreground leading-normal">
                  Connect Cursor or Aider using the configuration block on the left and issue a file rewrite or semantic query command.
                </p>
              </div>
            </div>
          ) : (
            <div className="relative pt-2">
              {logs.map((log) => (
                <LogItemRow key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
