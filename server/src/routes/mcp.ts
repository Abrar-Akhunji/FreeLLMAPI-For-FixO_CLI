import { Router } from 'express';
import { getMcpLogs, recordToolCall, clearMcpLogs, computeLineDiff } from '../services/mcpLog.js';
import { buildWorkspaceIndex, getIndexStatus } from '../services/indexer.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export const mcpRouter = Router();

mcpRouter.use(authMiddleware);

// Retrieve all agent logs
mcpRouter.get('/logs', (req, res) => {
  res.json({ logs: getMcpLogs() });
});

// Clear log timeline
mcpRouter.post('/logs/clear', (req, res) => {
  clearMcpLogs();
  res.json({ status: 'ok' });
});

// Record or update a tool call log
mcpRouter.post('/log', (req, res) => {
  const { id, tool, arguments: args, status, error, originalContent, newContent } = req.body;

  let diffs;
  if (tool === 'write_file' && originalContent !== undefined && newContent !== undefined) {
    const { diffs: lines, additions, deletions } = computeLineDiff(originalContent, newContent);
    diffs = [{
      file: args?.path || 'unknown',
      additions,
      deletions,
      lines,
    }];
  }

  const recorded = recordToolCall({
    id,
    tool,
    arguments: args,
    status,
    error,
    diffs,
  });

  res.json({ status: 'ok', log: recorded });
});

// Manual trigger for rebuilding the AST Workspace Index
mcpRouter.post('/index/trigger', async (req, res, next) => {
  try {
    const status = await buildWorkspaceIndex();
    res.json({ status: 'ok', indexStatus: status });
  } catch (err) {
    next(err);
  }
});

// Retrieve current indexer statistics
mcpRouter.get('/index/status', (req, res) => {
  res.json({ indexStatus: getIndexStatus() });
});
