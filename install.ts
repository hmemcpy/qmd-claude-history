import prompts from 'prompts';
import ora from 'ora';
import chalk from 'chalk';
import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

interface Assistant {
  name: string;
  id: string;
  configPath: string;
  detected: boolean;
}

const SCRIPT_DIR = path.join(homedir(), '.local', 'bin');
const SKILL_DIR = path.join(homedir(), '.claude', 'skills', 'qmd-claude-history');
const CONVERT_DIR = path.join(homedir(), '.claude', 'converted-history');
const LAUNCH_AGENTS_DIR = path.join(homedir(), 'Library', 'LaunchAgents');

const CONVERTER_SCRIPT = `#!/bin/bash
# convert-claude-history.sh - Convert Claude JSONL conversation history to Markdown
set -e
CONVERT_DIR="\${HOME}/.claude/converted-history"
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Usage: $0 [--dry-run]"; exit 1 ;;
  esac
done
mkdir -p "$CONVERT_DIR"
project_count=0
converted_count=0
for project_dir in ~/.claude/projects/*; do
  [[ ! -d "$project_dir" ]] && continue
  jsonl_count=$(find "$project_dir" -maxdepth 1 -name "*.jsonl" -type f 2>/dev/null | wc -l)
  [[ $jsonl_count -eq 0 ]] && continue
  ((project_count++))
  first_jsonl=$(find "$project_dir" -maxdepth 1 -name "*.jsonl" -type f | head -1)
  [[ -z "$first_jsonl" ]] && continue
  cwd=$(head -5 "$first_jsonl" | jq -r 'select(.cwd != null) | .cwd' 2>/dev/null | head -1)
  [[ -z "$cwd" ]] && { echo "Warning: Could not extract cwd from $first_jsonl, skipping"; continue; }
  [[ "$cwd" == *".ralphy-worktrees"* ]] || [[ "$cwd" == *"/agent-"* ]] && { echo "  Skipping agent worktree: $cwd"; continue; }
  project_name=$(basename "$cwd")
  project_convert_dir="$CONVERT_DIR/$project_name"
  mkdir -p "$project_convert_dir"
  echo "Processing project: $project_name ($jsonl_count sessions)"
  for jsonl in "$project_dir"/*.jsonl; do
    [[ ! -f "$jsonl" ]] && continue
    first_line=$(head -1 "$jsonl")
    session_id=$(echo "$first_line" | jq -r '.sessionId // empty')
    session_slug=$(echo "$first_line" | jq -r '.slug // "unknown"')
    session_date=$(echo "$first_line" | jq -r '.timestamp[0:10] // empty')
    [[ -z "$session_date" ]] && session_date=$(date +%Y-%m-%d)
    # Use session_id (first 8 chars) for unique filenames since slug is often null
    short_id="\${session_id:0:8}"
    [[ -z "$short_id" ]] && short_id=$(basename "$jsonl" .jsonl | cut -c1-8)
    md_file="$project_convert_dir/\${session_date}-\${short_id}.md"
    [[ "$DRY_RUN" == true ]] && { echo "  Would convert: $(basename "$jsonl") -> $(basename "$md_file")"; continue; }
    {
      echo "# Claude Session: $session_slug"
      echo ""
      echo "- **Date**: $session_date"
      echo "- **Session ID**: $session_id"
      echo "- **Project**: $cwd"
      echo ""
      echo "---"
      echo ""
      jq -r 'if .type == "user" then "## User\\n\\n" + (.message.content // "") + "\\n" elif .type == "assistant" then "## Assistant\\n\\n" + ((.message.content // []) | if type == "array" then map(.text // empty) | join("\\n") else . end) + "\\n" else empty end' "$jsonl" 2>/dev/null || echo "Error parsing $jsonl"
    } > "$md_file"
    ((converted_count++))
  done
  echo "  Converted $jsonl_count sessions to $project_convert_dir"
done
echo ""
echo "Summary:"
echo "  Projects processed: $project_count"
echo "  Sessions converted: $converted_count"
echo "  Output directory: $CONVERT_DIR"
`;

const SKILL_MD = `---
name: qmd-claude-history
description: Automatic indexing and search for Claude Code conversation history using QMD. Enables Claude to search its own past work across projects.
---

# QMD Claude History

This skill enables Claude to automatically search its own conversation history when you ask about past work, previous implementations, or anything from prior sessions.

## When to Use This Skill

**Activate automatically when user asks:**
- "What did we work on last week?"
- "How did I implement X?"
- "Remind me about the Y project"
- "What was our approach to Z?"
- "Did we discuss...?"
- Any question referencing past work or conversations

## Available Collections

### Per-Project Conversation History (Auto-detect by cwd)
Collections are automatically created for each project. Use \`qmd collection list\` to see all available collections.

Collection naming convention: \`claude-<project-name>\` or \`claude-<project-name>-conversations\`

## Search Strategy

Choose the right search type for your query:

### 1. BM25 Keyword Search (DEFAULT)
\`\`\`bash
qmd search "your query" --collection claude-<project>-conversations
\`\`\`
- Fast, accurate keyword matching
- Best for: specific terms, technical keywords, file names, exact phrases
- Use when you know the exact words you're looking for

### 2. Vector Semantic Search
\`\`\`bash
qmd search "your query" --semantic --collection claude-<project>-conversations
\`\`\`
- Semantic similarity matching
- Best for: conceptual queries where wording may vary
- Example: "deployment process" vs "how to deploy"

### 3. Hybrid Search (Maximum Recall)
\`\`\`bash
qmd query "your query" --collection claude-<project>-conversations
\`\`\`
- BM25 + Vector + LLM reranking
- Most thorough but slower
- Use only when other methods don't find what you need

## Auto-Detect Collection from Current Directory

When in a project directory, automatically determine the collection:

\`\`\`bash
# If cwd is /Users/user/git/myproject:
qmd search "how to deploy" --collection claude-myproject-conversations
\`\`\`

## Workflow

1. **Auto-search**: When user asks about past work, immediately search QMD first
2. **Present results**: Show relevant snippets with docids
3. **Get full context**: If needed, read the full document using \`qmd get "#docid"\`
4. **Answer**: Combine search results with your knowledge

## Examples

### Searching within current project:

**User:** "What did we work on last week?"

**Claude:**
1. Detect project from cwd
2. Search: \`qmd search "last week" --collection claude-<project>-conversations\`
3. Present relevant conversation snippets
4. Answer based on findings

**User:** "How did I implement the sandbox?"

**Claude:**
1. Search: \`qmd search "sandbox implementation" --collection claude-<project>-conversations\`
2. Show results from previous conversations about sandbox
3. Summarize implementation approach

### Getting full document context:

\`\`\`bash
# From search results, get full document (quote the docid)
qmd get "#58167c"
\`\`\`

## Keeping History Updated

QMD updates are incremental - only new/changed files are processed:

\`\`\`bash
# Convert new conversations (only processes new JSONL files)
convert-claude-history.sh

# Index new markdown files only
qmd update

# Generate embeddings for new content only
qmd embed
\`\`\`

The LaunchAgent runs these automatically every 30 minutes.

To manually update after a session:
\`\`\`bash
convert-claude-history.sh && qmd update && qmd embed
\`\`\`

## QMD Commands Reference

| Command | Description |
|---------|-------------|
| \`qmd search "<query>"\` | BM25 keyword search (fast) |
| \`qmd search "<query>" --semantic\` | Vector semantic search (conceptual) |
| \`qmd query "<query>"\` | Hybrid + reranking (best quality) |
| \`qmd get "#<docid>"\` | Retrieve full document (quote the docid) |
| \`qmd status\` | Show collections and index status |
| \`qmd collection list\` | List all collections |

## Troubleshooting

### LaunchAgent not running?
\`\`\`bash
launchctl list | grep qmd-claude-history
launchctl load ~/Library/LaunchAgents/com.user.qmd-claude-history.plist
\`\`\`

### Missing collections?
\`\`\`bash
# Re-run conversion and indexing
convert-claude-history.sh
qmd collection list
qmd embed
\`\`\`

### Clear and rebuild all
\`\`\`bash
rm -rf ~/.claude/converted-history
convert-claude-history.sh
# Then recreate collections manually
\`\`\`

## Notes

- This skill is automatically available to Claude when discussing past work
- No activation command needed - searches happen automatically
- 96% token reduction by returning snippets instead of full files
- All indexing is local and private
- Project names are extracted from the \`cwd\` field in JSONL files
- New projects are automatically indexed when the LaunchAgent runs
`;

const LAUNCH_AGENT_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.qmd-claude-history</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/sh</string>
        <string>-c</string>
        <string>export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH" &amp;&amp; convert-claude-history.sh &amp;&amp; qmd update &amp;&amp; qmd embed</string>
    </array>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/dev/null</string>
    <key>StandardErrorPath</key>
    <string>/dev/null</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>XDG_CACHE_HOME</key>
        <string>\${HOME}/.cache</string>
    </dict>
</dict>
</plist>
`;

const CLAUDE_MD_ADDITION = `

## Memory & Context Retrieval

When the user asks about past work, previous conversations, or anything that might be in conversation history, **activate the qmd-claude-history skill** and search QMD first before answering.

### When to Search History

Activate qmd-claude-history skill when user asks:
- "What did we work on last week?"
- "How did I implement X?"
- "Remind me about the Y project"
- "What was our approach to Z?"
- "Did we discuss...?"
- Any question referencing past work or conversations

### Quick Reference

\`\`\`bash
# Search current project's conversation history
qmd search "your query" --collection claude-<project>-conversations

# Example for myproject
qmd search "sandbox implementation" --collection claude-myproject-conversations
\`\`\`

**Note:** Full documentation is in the qmd-claude-history skill (\`~/.claude/skills/qmd-claude-history/SKILL.md\`)
`;

async function detectAssistants(): Promise<Assistant[]> {
  const detected: Assistant[] = [];

  // Check Claude Code
  const claudeDetected = existsSync(path.join(homedir(), '.claude')) ||
    (() => {
      try {
        execSync('which claude', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })();

  if (claudeDetected) {
    detected.push({
      name: 'Claude Code',
      id: 'claude',
      configPath: '~/.claude/CLAUDE.md',
      detected: true
    });
  }

  // Check Amp
  const ampDetected = existsSync(path.join(homedir(), '.amp')) ||
    (() => {
      try {
        execSync('which amp', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })();

  if (ampDetected) {
    detected.push({
      name: 'Amp',
      id: 'amp',
      configPath: '~/.config/amp/AGENTS.md',
      detected: true
    });
  }

  // Check Opencode
  const opencodeDetected = existsSync(path.join(homedir(), '.config', 'opencode')) ||
    (() => {
      try {
        execSync('which opencode', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })();

  if (opencodeDetected) {
    detected.push({
      name: 'Opencode',
      id: 'opencode',
      configPath: '~/.config/opencode/agents/',
      detected: true
    });
  }

  return detected;
}

async function checkPrerequisites(): Promise<{ bun: boolean; qmd: boolean; jq: boolean }> {
  const results = {
    bun: false,
    qmd: false,
    jq: false
  };

  try {
    execSync('which bun', { stdio: 'pipe' });
    results.bun = true;
  } catch {}

  try {
    execSync('which qmd', { stdio: 'pipe' });
    results.qmd = true;
  } catch {}

  try {
    execSync('which jq', { stdio: 'pipe' });
    results.jq = true;
  } catch {}

  return results;
}

function printBox(text: string) {
  const width = 60;
  const padding = Math.floor((width - text.length) / 2);
  console.log('');
  console.log(chalk.cyan('╔' + '═'.repeat(width) + '╗'));
  console.log(chalk.cyan('║') + ' '.repeat(padding) + chalk.bold(text) + ' '.repeat(width - padding - text.length) + chalk.cyan('║'));
  console.log(chalk.cyan('╚' + '═'.repeat(width) + '╝'));
  console.log('');
}

function createDirectories(): void {
  mkdirSync(SCRIPT_DIR, { recursive: true });
  mkdirSync(SKILL_DIR, { recursive: true });
  mkdirSync(CONVERT_DIR, { recursive: true });
  mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
}

function installConverterScript(): void {
  const scriptPath = path.join(SCRIPT_DIR, 'convert-claude-history.sh');
  writeFileSync(scriptPath, CONVERTER_SCRIPT, { mode: 0o755 });
}

function installSkill(): void {
  const skillPath = path.join(SKILL_DIR, 'SKILL.md');
  writeFileSync(skillPath, SKILL_MD);
}

function installLaunchAgent(): void {
  const plistPath = path.join(LAUNCH_AGENTS_DIR, 'com.user.qmd-claude-history.plist');
  writeFileSync(plistPath, LAUNCH_AGENT_PLIST);

  // Load the LaunchAgent
  try {
    execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
  } catch {
    // May already be loaded or fail silently
  }
}

function runConverter(): string {
  const scriptPath = path.join(SCRIPT_DIR, 'convert-claude-history.sh');
  try {
    const result = execSync(`bash "${scriptPath}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result;
  } catch (err: any) {
    return err.stdout || err.message;
  }
}

function createQmdCollections(): { created: number; recreated: number } {
  let created = 0;
  let recreated = 0;

  if (!existsSync(CONVERT_DIR)) {
    return { created, recreated };
  }

  const projects = readdirSync(CONVERT_DIR).filter(f =>
    statSync(path.join(CONVERT_DIR, f)).isDirectory()
  );

  // Get existing collections
  let existingCollections: string[] = [];
  try {
    const result = execSync('qmd collection list', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    // Parse collection names from formatted output like "claude-foo-conversations (qmd://...)"
    existingCollections = result.split('\n')
      .map(line => line.match(/^(claude-\S+-conversations)\s+\(/)?.[1])
      .filter((name): name is string => !!name);
  } catch {}

  for (const project of projects) {
    const collectionName = `claude-${project}-conversations`;
    const projectPath = path.join(CONVERT_DIR, project);

    const exists = existingCollections.includes(collectionName);

    try {
      // Remove existing collection before recreating
      if (exists) {
        execSync(`qmd collection remove "${collectionName}"`, { stdio: 'pipe' });
      }

      execSync(`qmd collection add "${projectPath}" --name "${collectionName}"`, { stdio: 'pipe' });
      execSync(`qmd context add "qmd://${collectionName}/" "Claude conversation history for ${project} project"`, { stdio: 'pipe' });

      if (exists) {
        recreated++;
      } else {
        created++;
      }
    } catch {
      // Collection creation may fail, continue
    }
  }

  return { created, recreated };
}

function generateEmbeddings(): void {
  try {
    execSync('qmd embed', { stdio: 'pipe', timeout: 300000 }); // 5 min timeout
  } catch {
    // May fail or timeout, continue
  }
}

function updateClaudeMd(): boolean {
  const claudeMdPath = path.join(homedir(), '.claude', 'CLAUDE.md');

  // Check if already has qmd-claude-history section
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, 'utf-8');
    if (content.includes('qmd-claude-history')) {
      return false; // Already configured
    }

    // Backup existing file
    const backupPath = `${claudeMdPath}.backup.${Date.now()}`;
    copyFileSync(claudeMdPath, backupPath);

    // Append to existing file
    writeFileSync(claudeMdPath, content + CLAUDE_MD_ADDITION);
  } else {
    // Create new file
    mkdirSync(path.dirname(claudeMdPath), { recursive: true });
    writeFileSync(claudeMdPath, CLAUDE_MD_ADDITION.trim());
  }

  return true;
}

async function main() {
  printBox('QMD History Search Integration');

  console.log(chalk.cyan.bold('What This Installer Does'));
  console.log('  ' + chalk.green('✓') + ' Converts conversation history to searchable Markdown');
  console.log('  ' + chalk.green('✓') + ' Creates per-project QMD collections');
  console.log('  ' + chalk.green('✓') + ' Installs a skill for automatic history search');
  console.log('  ' + chalk.green('✓') + ' Sets up automatic updates every 30 minutes');
  console.log('  ' + chalk.green('✓') + ' Optionally configures AI assistants for auto-activation');
  console.log('');

  const { proceed } = await prompts({
    type: 'confirm',
    name: 'proceed',
    message: 'Continue with installation?',
    initial: true
  });

  if (!proceed) {
    console.log(chalk.yellow('Installation cancelled.'));
    process.exit(0);
  }

  // Detect assistants
  console.log('');
  let spinner = ora('Detecting installed AI assistants...').start();
  const assistants = await detectAssistants();
  spinner.stop();

  let selectedAssistants: string[] = [];

  if (assistants.length === 0) {
    console.log(chalk.yellow('No supported AI assistants detected.'));
    console.log('');
    console.log('Supported assistants:');
    console.log('  • Claude Code (https://claude.ai/code)');
    console.log('  • Amp (https://ampcode.com)');
    console.log('  • Opencode (https://opencode.ai)');
    console.log('');
  } else {
    const { selected } = await prompts({
      type: 'multiselect',
      name: 'selected',
      message: 'Select AI assistants to configure:',
      choices: assistants.map(a => ({
        title: `${a.name} (${a.configPath})`,
        value: a.id
      })),
      hint: '- Space to select. Return to submit'
    });

    selectedAssistants = selected || [];

    if (selectedAssistants.length > 0) {
      console.log(chalk.green(`Selected ${selectedAssistants.length} assistant(s) for configuration.`));
    }
  }

  // Check prerequisites
  console.log('');
  console.log(chalk.cyan.bold('Checking Prerequisites'));
  console.log('');

  const prereqs = await checkPrerequisites();

  if (prereqs.bun) {
    console.log(chalk.green('✓') + ' Bun found');
  } else {
    console.log(chalk.red('✗') + ' Bun not found');
    console.log('  Install: curl -fsSL https://bun.sh/install | bash');
  }

  if (prereqs.qmd) {
    console.log(chalk.green('✓') + ' QMD found');
  } else {
    console.log(chalk.red('✗') + ' QMD not found');
    console.log('  Install: bun install -g https://github.com/tobi/qmd');
  }

  if (prereqs.jq) {
    console.log(chalk.green('✓') + ' jq found');
  } else {
    console.log(chalk.red('✗') + ' jq not found');
    console.log('  Install: brew install jq');
  }

  if (!prereqs.bun || !prereqs.qmd || !prereqs.jq) {
    console.log('');
    console.log(chalk.red('Please install missing prerequisites and try again.'));
    process.exit(1);
  }

  console.log('');
  console.log(chalk.green('All prerequisites satisfied!'));

  const { startInstall } = await prompts({
    type: 'confirm',
    name: 'startInstall',
    message: 'Begin installation?',
    initial: true
  });

  if (!startInstall) {
    console.log(chalk.yellow('Installation cancelled.'));
    process.exit(0);
  }

  // Installation steps
  console.log('');
  console.log(chalk.cyan.bold('Installing...'));
  console.log('');

  // Step 1: Create directories
  spinner = ora('Creating directories').start();
  try {
    createDirectories();
    spinner.succeed();
  } catch (err: any) {
    spinner.fail(`Failed to create directories: ${err.message}`);
    process.exit(1);
  }

  // Step 2: Install converter script
  spinner = ora('Installing converter script').start();
  try {
    installConverterScript();
    spinner.succeed();
  } catch (err: any) {
    spinner.fail(`Failed to install converter script: ${err.message}`);
    process.exit(1);
  }

  // Step 3: Install skill
  spinner = ora('Installing skill').start();
  try {
    installSkill();
    spinner.succeed();
  } catch (err: any) {
    spinner.fail(`Failed to install skill: ${err.message}`);
    process.exit(1);
  }

  // Step 4: Install LaunchAgent
  spinner = ora('Installing LaunchAgent').start();
  try {
    installLaunchAgent();
    spinner.succeed();
  } catch (err: any) {
    spinner.fail(`Failed to install LaunchAgent: ${err.message}`);
    process.exit(1);
  }

  // Step 5: Convert history
  spinner = ora('Converting history').start();
  try {
    const output = runConverter();
    spinner.succeed();
    // Show summary from converter output
    const summaryMatch = output.match(/Summary:[\s\S]*$/);
    if (summaryMatch) {
      console.log(chalk.dim(summaryMatch[0].trim()));
    }
  } catch (err: any) {
    spinner.warn(`Converter completed with warnings`);
  }

  // Step 6: Create QMD collections
  spinner = ora('Creating QMD collections').start();
  try {
    const { created, recreated } = createQmdCollections();
    const parts = [];
    if (created > 0) parts.push(`${created} created`);
    if (recreated > 0) parts.push(`${recreated} recreated`);
    spinner.succeed(parts.length > 0 ? parts.join(', ') : 'No collections to process');
  } catch (err: any) {
    spinner.warn(`Collection creation completed with warnings`);
  }

  // Step 7: Generate embeddings
  spinner = ora('Generating embeddings (this may take a while)').start();
  try {
    generateEmbeddings();
    spinner.succeed();
  } catch (err: any) {
    spinner.warn(`Embedding generation completed with warnings`);
  }

  // Step 8: Configure CLAUDE.md (if Claude was selected)
  if (selectedAssistants.includes('claude')) {
    console.log('');
    console.log(chalk.cyan.bold('CLAUDE.md Configuration'));
    console.log('');
    console.log('To enable automatic skill activation, we can add a directive');
    console.log('to your global CLAUDE.md file.');
    console.log('');

    const { updateClaude } = await prompts({
      type: 'confirm',
      name: 'updateClaude',
      message: 'Add skill activation directive to ~/.claude/CLAUDE.md?',
      initial: true
    });

    if (updateClaude) {
      spinner = ora('Updating CLAUDE.md').start();
      const updated = updateClaudeMd();
      if (updated) {
        spinner.succeed('Updated CLAUDE.md');
      } else {
        spinner.warn('CLAUDE.md already has qmd-claude-history section');
      }
    } else {
      console.log(chalk.yellow('Skipped CLAUDE.md update'));
      console.log('');
      console.log('You can manually activate the skill by telling Claude:');
      console.log('  "activate the qmd-claude-history skill"');
    }
  }

  // Completion
  console.log('');
  printBox('Installation Complete!');

  console.log(chalk.cyan.bold("What's Been Set Up"));
  console.log('  ' + chalk.green('✓') + ' Skill: ~/.claude/skills/qmd-claude-history/SKILL.md');
  console.log('  ' + chalk.green('✓') + ' Converter: ~/.local/bin/convert-claude-history.sh');
  console.log('  ' + chalk.green('✓') + ' LaunchAgent: Auto-updates every 30 minutes');
  console.log('  ' + chalk.green('✓') + ' Collections: Created for existing projects');
  console.log('');

  console.log(chalk.cyan.bold('Usage'));
  console.log('  Just ask your AI assistant about past work:');
  console.log('    "What did we work on last week?"');
  console.log('    "How did I implement X?"');
  console.log('    "Remind me about the Y project"');
  console.log('');

  console.log(chalk.cyan.bold('Manual Commands'));
  console.log('  Search:  qmd search "query" --collection claude-<project>-conversations');
  console.log('  Update:  convert-claude-history.sh && qmd update && qmd embed');
  console.log('');
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
});
