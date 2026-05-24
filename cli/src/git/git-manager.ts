/**
 * Git integration manager for automated commits, undo, and diff viewing.
 * All git operations are safely sandboxed to the workspace directory.
 */
import { execSync } from 'child_process';

/* ──────────────────────── ANSI Colors ──────────────────────── */

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

/* ──────────────────────── GitManager ──────────────────────── */

export class GitManager {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /** Check if the current directory is inside a git repository. */
  isGitRepo(): boolean {
    try {
      const result = execSync('git rev-parse --is-inside-work-tree', {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result.trim() === 'true';
    } catch {
      return false;
    }
  }

  /** Get the current branch name. */
  getCurrentBranch(): string {
    try {
      return execSync('git branch --show-current', {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || 'HEAD';
    } catch {
      return 'unknown';
    }
  }

  /** Check if there are uncommitted changes. */
  hasChanges(): boolean {
    try {
      const result = execSync('git status --porcelain', {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  /** Get a colored diff summary for display. */
  getDiff(): string {
    if (!this.isGitRepo()) return '(not a git repository)';
    if (!this.hasChanges()) return '(no changes)';

    try {
      const stat = execSync('git diff --stat', {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const stagedStat = execSync('git diff --cached --stat', {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const untrackedFiles = execSync(
        'git ls-files --others --exclude-standard',
        { cwd: this.cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();

      const parts: string[] = [];

      if (stagedStat) {
        parts.push(`${colors.green}Staged:${colors.reset}`);
        parts.push(stagedStat);
      }
      if (stat) {
        parts.push(`${colors.yellow}Unstaged:${colors.reset}`);
        parts.push(stat);
      }
      if (untrackedFiles) {
        const files = untrackedFiles.split('\n').slice(0, 10);
        parts.push(`${colors.cyan}Untracked (${files.length}):${colors.reset}`);
        for (const f of files) parts.push(`  + ${f}`);
        if (untrackedFiles.split('\n').length > 10) parts.push(`  ... and more`);
      }

      return parts.join('\n') || '(no changes)';
    } catch {
      return '(could not generate diff)';
    }
  }

  /**
   * Auto-commit all changes with a generated commit message.
   * Returns the short commit hash, or null if nothing to commit.
   */
  autoCommit(task: string, modifiedFiles: string[]): string | null {
    if (!this.isGitRepo() || !this.hasChanges()) return null;

    try {
      const lowerTask = task.toLowerCase();
      let prefix = 'feat';
      if (/\bfix(es|ed|ing)?\b/.test(lowerTask)) prefix = 'fix';
      else if (/\brefactor/.test(lowerTask)) prefix = 'refactor';
      else if (/\btest/.test(lowerTask)) prefix = 'test';
      else if (/\bdoc(s|umentation)?/.test(lowerTask)) prefix = 'docs';
      else if (/\bstyle|format/.test(lowerTask)) prefix = 'style';

      const taskSummary = task.length > 68 ? task.slice(0, 65) + '...' : task;
      const message = `${prefix}: ${taskSummary}`;

      execSync('git add -A', { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const hash = execSync('git rev-parse --short HEAD', {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const fileList = modifiedFiles
        .map((f) => (f.startsWith(this.cwd) ? f.slice(this.cwd.length + 1) : f))
        .slice(0, 5)
        .join(', ');

      console.log(
        `${colors.green}  ✓ Committed ${colors.bold}${hash}${colors.reset}${colors.green}: ${message}${colors.reset}`,
      );
      if (fileList) console.log(`${colors.dim}    Files: ${fileList}${colors.reset}`);
      return hash;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`${colors.yellow}  ⚠ Auto-commit failed: ${msg.slice(0, 80)}${colors.reset}`);
      return null;
    }
  }

  /** Undo the last commit, performing a hard reset of the working tree. */
  undoLastCommit(): boolean {
    if (!this.isGitRepo()) {
      console.log(`${colors.red}  ✗ Not a git repository${colors.reset}`);
      return false;
    }

    try {
      const currentHash = execSync('git rev-parse --short HEAD', {
        cwd: this.cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const commitMsg = execSync('git log -1 --format=%s', {
        cwd: this.cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      execSync('git reset --hard HEAD~1', { cwd: this.cwd, stdio: 'ignore' });

      console.log(`${colors.green}  ⏪ Reverted commit ${colors.bold}${currentHash}${colors.reset}${colors.green}: ${commitMsg}${colors.reset}`);
      console.log(`${colors.dim}    All files have been restored to the previous clean commit state.${colors.reset}`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`${colors.red}  ✗ Undo failed: ${msg.slice(0, 80)}${colors.reset}`);
      return false;
    }
  }

  /** Get last N commit messages for display. */
  getRecentCommits(count = 5): string {
    if (!this.isGitRepo()) return '(not a git repository)';
    try {
      return execSync(`git log --oneline -n ${count}`, {
        cwd: this.cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || '(no commits)';
    } catch {
      return '(no commits)';
    }
  }
}
