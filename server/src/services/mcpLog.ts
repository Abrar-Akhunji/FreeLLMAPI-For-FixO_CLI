import { randomUUID } from 'crypto';

export interface LineDiff {
  type: 'added' | 'removed' | 'normal';
  content: string;
}

export interface FileDiffSummary {
  file: string;
  additions: number;
  deletions: number;
  lines: LineDiff[];
}

export interface McpToolLog {
  id: string;
  tool: string;
  arguments: any;
  status: 'started' | 'completed' | 'failed';
  timestamp: string;
  durationMs?: number;
  error?: string;
  diffs?: FileDiffSummary[];
}

// In-memory rotating logs array
let mcpLogs: McpToolLog[] = [];
const MAX_LOGS = 100;

/**
 * Computes line-by-line differences between two plain text strings.
 */
export function computeLineDiff(original: string, modified: string): { diffs: LineDiff[]; additions: number; deletions: number } {
  const oldLines = (original ?? '').split('\n');
  const newLines = (modified ?? '').split('\n');
  const diffs: LineDiff[] = [];
  
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length) {
      if (oldLines[i] === newLines[j]) {
        diffs.push({ type: 'normal', content: oldLines[i] });
        i++;
        j++;
      } else {
        // Lookahead to search for matches
        const nextMatchInNew = newLines.indexOf(oldLines[i], j);
        const nextMatchInOld = oldLines.indexOf(newLines[j], i);

        if (nextMatchInNew !== -1 && (nextMatchInOld === -1 || nextMatchInNew - j < nextMatchInOld - i)) {
          // Lines were added
          while (j < nextMatchInNew) {
            diffs.push({ type: 'added', content: newLines[j] });
            j++;
          }
        } else if (nextMatchInOld !== -1) {
          // Lines were removed
          while (i < nextMatchInOld) {
            diffs.push({ type: 'removed', content: oldLines[i] });
            i++;
          }
        } else {
          // Straight mismatch / substitution
          diffs.push({ type: 'removed', content: oldLines[i] });
          diffs.push({ type: 'added', content: newLines[j] });
          i++;
          j++;
        }
      }
    } else if (i < oldLines.length) {
      diffs.push({ type: 'removed', content: oldLines[i] });
      i++;
    } else if (j < newLines.length) {
      diffs.push({ type: 'added', content: newLines[j] });
      j++;
    }
  }

  const additions = diffs.filter(d => d.type === 'added').length;
  const deletions = diffs.filter(d => d.type === 'removed').length;

  return { diffs, additions, deletions };
}

/**
 * Pushes a new log or updates an existing one (started -> completed/failed).
 */
export function recordToolCall(log: Omit<McpToolLog, 'id' | 'timestamp'> & { id?: string }): McpToolLog {
  const timestamp = new Date().toISOString();
  
  if (log.id) {
    // Update existing tool call (started -> completed)
    const existingIndex = mcpLogs.findIndex(l => l.id === log.id);
    if (existingIndex !== -1) {
      const existing = mcpLogs[existingIndex];
      const durationMs = Date.now() - new Date(existing.timestamp).getTime();
      
      const updated: McpToolLog = {
        ...existing,
        ...log,
        id: log.id,
        durationMs,
      };
      
      mcpLogs[existingIndex] = updated;
      return updated;
    }
  }

  // Create new started tool call
  const newLog: McpToolLog = {
    id: log.id || randomUUID(),
    timestamp,
    ...log,
  };

  mcpLogs.unshift(newLog); // Push to the front
  
  // Rotate queue size
  if (mcpLogs.length > MAX_LOGS) {
    mcpLogs = mcpLogs.slice(0, MAX_LOGS);
  }

  return newLog;
}

/**
 * Returns all logs in the queue.
 */
export function getMcpLogs(): McpToolLog[] {
  return mcpLogs;
}

/**
 * Clears all logs in the queue.
 */
export function clearMcpLogs(): void {
  mcpLogs = [];
}
