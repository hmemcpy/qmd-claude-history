#!/bin/bash
# install.sh - Install qmd-claude-history integration
# This sets up automatic indexing of Claude conversation history with QMD

set -e

REPO_URL="https://github.com/hmemcpy/qmd-claude-history"
INSTALL_DIR="${HOME}/.local/share/qmd-claude-history"
SCRIPT_DIR="${HOME}/.local/bin"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     QMD Claude History Integration - Installer             ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
info() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v bun &> /dev/null; then
    error "Bun not found. Please install Bun first:"
    echo "   curl -fsSL https://bun.sh/install | bash"
    echo ""
    echo "Then add ~/.bun/bin to your PATH and try again."
    exit 1
fi
info "Bun found"

if ! command -v qmd &> /dev/null; then
    error "QMD not found. Please install QMD:"
    echo "   bun install -g https://github.com/tobi/qmd"
    echo ""
    echo "On macOS, also install SQLite:"
    echo "   brew install sqlite"
    exit 1
fi
info "QMD found"

if ! command -v jq &> /dev/null; then
    error "jq not found. Please install jq:"
    echo "   brew install jq"
    exit 1
fi
info "jq found"

echo ""
info "Note: QMD will download GGUF models (~2GB total) on first use"
echo "  - Embedding model: ~300MB"
echo "  - Reranker model: ~640MB"
echo "  - Query expansion: ~1.1GB"
echo ""

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$SCRIPT_DIR"
mkdir -p "${HOME}/.claude/converted-history"
info "Created directories"

# Install converter script
cat > "$SCRIPT_DIR/convert-claude-history.sh" << 'SCRIPT_EOF'
#!/bin/bash
# convert-claude-history.sh - Convert Claude JSONL conversation history to Markdown

set -e

CONVERT_DIR="${HOME}/.claude/converted-history"
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Usage: $0 [--dry-run]"
      exit 1
      ;;
  esac
done

# Create conversion directory
mkdir -p "$CONVERT_DIR"

# Find all project directories
project_count=0
converted_count=0

for project_dir in ~/.claude/projects/*; do
  if [[ ! -d "$project_dir" ]]; then
    continue
  fi

  # Count JSONL files
  jsonl_count=$(find "$project_dir" -maxdepth 1 -name "*.jsonl" -type f 2>/dev/null | wc -l)
  if [[ $jsonl_count -eq 0 ]]; then
    continue
  fi

  ((project_count++))

  # Extract cwd from first JSONL to get actual path
  first_jsonl=$(find "$project_dir" -maxdepth 1 -name "*.jsonl" -type f | head -1)
  if [[ -z "$first_jsonl" ]]; then
    continue
  fi

  # Extract the cwd (current working directory) from the first line that has it
  cwd=$(head -5 "$first_jsonl" | jq -r 'select(.cwd != null) | .cwd' 2>/dev/null | head -1)

  if [[ -z "$cwd" ]]; then
    echo "Warning: Could not extract cwd from $first_jsonl, skipping"
    continue
  fi

  # Skip agent worktrees (Ralph Wiggum sub-agents)
  if [[ "$cwd" == *".ralphy-worktrees"* ]] || [[ "$cwd" == *"/agent-"* ]]; then
    echo "  Skipping agent worktree: $cwd"
    continue
  fi

  # Get project name from cwd (e.g., /Users/hmemcpy/git/clair -> clair)
  project_name=$(basename "$cwd")

  # Create project directory in converted history
  project_convert_dir="$CONVERT_DIR/$project_name"
  mkdir -p "$project_convert_dir"

  echo "Processing project: $project_name ($jsonl_count sessions)"

  # Convert each JSONL to Markdown
  for jsonl in "$project_dir"/*.jsonl; do
    if [[ ! -f "$jsonl" ]]; then
      continue
    fi

    # Extract session info
    first_line=$(head -1 "$jsonl")
    session_id=$(echo "$first_line" | jq -r '.sessionId // empty')
    session_slug=$(echo "$first_line" | jq -r '.slug // "unknown"')
    session_date=$(echo "$first_line" | jq -r '.timestamp[0:10] // empty')

    if [[ -z "$session_date" ]]; then
      session_date=$(date +%Y-%m-%d)
    fi

    # Create markdown filename
    md_file="$project_convert_dir/${session_date}-${session_slug}.md"

    if [[ "$DRY_RUN" == true ]]; then
      echo "  Would convert: $(basename "$jsonl") -> $(basename "$md_file")"
      continue
    fi

    # Convert JSONL to Markdown
    {
      echo "# Claude Session: $session_slug"
      echo ""
      echo "- **Date**: $session_date"
      echo "- **Session ID**: $session_id"
      echo "- **Project**: $cwd"
      echo ""
      echo "---"
      echo ""

      # Extract conversation
      jq -r '
        if .type == "user" then
          "## User\n\n" + (.message.content // "") + "\n"
        elif .type == "assistant" then
          "## Assistant\n\n" + ((.message.content // []) | if type == "array" then map(.text // empty) | join("\n") else . end) + "\n"
        else
          empty
        end
      ' "$jsonl" 2>/dev/null || echo "Error parsing $jsonl"

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
SCRIPT_EOF

chmod +x "$SCRIPT_DIR/convert-claude-history.sh"
info "Installed converter script"

# Install Skill
SKILL_DIR="${HOME}/.claude/skills/qmd-claude-history"
mkdir -p "$SKILL_DIR"

cat > "$SKILL_DIR/SKILL.md" << 'SKILL_EOF'
---
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
Collections are automatically created for each project:

| Project | Collection | Conversations |
|---------|-----------|---------------|
| scrolltunes | `claude-scrolltunes` | 13 conversations |
| shnekel | `claude-shnekel` | 10 conversations |
| toolkata | `claude-toolkata-conversations` | 8 conversations |
| finn | `claude-finn` | 4 conversations |
| clair | `claude-clair-conversations` | 3 conversations |
| ralph-wiggum | `claude-ralph-wiggum` | 4 conversations |

### Other Collections
- `claude-plans` - Past Claude session plans and task breakdowns (~/.claude/plans/)
- `toolkata-docs` - Toolkata design documents
- `toolkata-specs` - Toolkata technical specifications

## Search Strategy

Choose the right search type for your query:

### 1. BM25 Keyword Search (DEFAULT)
```bash
/qmd "your query" --collection claude-<project>-conversations
```
- Fast, accurate keyword matching
- Best for: specific terms, technical keywords, file names, exact phrases
- Use when you know the exact words you're looking for

### 2. Vector Semantic Search
```bash
/qmd "your query" --semantic --collection claude-<project>-conversations
```
- Semantic similarity matching
- Best for: conceptual queries where wording may vary
- Example: "deployment process" vs "how to deploy"

### 3. Hybrid Search (Maximum Recall)
```bash
qmd query "your query" --collection claude-<project>-conversations
```
- BM25 + Vector + LLM reranking
- Most thorough but slower
- Use only when other methods don't find what you need

## Auto-Detect Collection from Current Directory

When in a project directory, automatically determine the collection:

```bash
# If cwd is /Users/hmemcpy/git/toolkata:
/qmd "how to deploy" --collection claude-toolkata-conversations

# If cwd is /Users/hmemcpy/git/clair:
/qmd "thesis remediation" --collection claude-clair-conversations
```

The convention is:
- Collection name: `claude-<project-name>-conversations` (or just `claude-<project-name>`)
- Context shows: "Claude conversation history for <project> project"

## Workflow

1. **Auto-search**: When user asks about past work, immediately search QMD first
2. **Present results**: Show relevant snippets with docids
3. **Get full context**: If needed, read the full document using `get #docid`
4. **Answer**: Combine search results with your knowledge

## Examples

### Searching within current project:

**User:** "What did we work on last week?" (in /Users/hmemcpy/git/toolkata)

**Claude:**
1. Detect project: toolkata
2. Search: `/qmd last week --collection claude-toolkata-conversations`
3. Present relevant conversation snippets
4. Answer based on findings

**User:** "How did I implement the sandbox?"

**Claude:**
1. Search: `/qmd sandbox implementation --collection claude-toolkata-conversations`
2. Show results from previous conversations about sandbox
3. Summarize implementation approach

### Searching plans and docs:

**User:** "What was the implementation plan for the scream time app?"

**Claude:**
1. Search: `/qmd scream time app implementation --collection claude-plans`
2. Get full plan if needed: `qmd get "#58167c"` (from search results - note: quote the docid to prevent shell interpretation)
3. Answer with details from the plan

**User:** "How did we handle sandbox integration?"

**Claude:**
1. Search: `/qmd sandbox integration --semantic`
2. Present findings from toolkata-specs collection

## Keeping History Updated

QMD updates are incremental - only new/changed files are processed:

```bash
# Convert new conversations (only processes new JSONL files)
convert-claude-history.sh

# Index new markdown files only
qmd update

# Generate embeddings for new content only
qmd embed
```

The LaunchAgent runs these automatically every 30 minutes.

To manually update after a session:
```bash
convert-claude-history.sh && qmd update && qmd embed
```

## QMD Commands Reference

| Command | Description |
|---------|-------------|
| `/qmd <query>` | BM25 keyword search (fast) |
| `/qmd <query> --semantic` | Vector semantic search (conceptual) |
| `qmd query "<query>"` | Hybrid + reranking (best quality) |
| `qmd get "#<docid>"` | Retrieve full document (quote the docid) |
| `qmd status` | Show collections and index status |
| `qmd collection list` | List all collections |

## Installation & Setup

### Prerequisites
- QMD: `bun install -g https://github.com/tobi/qmd`
- jq: `brew install jq`

### Quick Install
```bash
curl -fsSL https://raw.githubusercontent.com/hmemcpy/qmd-claude-history/main/install.sh | bash
```

### What Gets Installed
1. **Converter script**: `~/.local/bin/convert-claude-history.sh`
2. **LaunchAgent**: Auto-updates every 30 minutes at `~/Library/LaunchAgents/com.user.qmd-claude-history.plist`
3. **This skill**: `~/.claude/skills/qmd-claude-history/SKILL.md`
4. **QMD collections**: Created for all existing projects

### Manual Update
If you need to update immediately:
```bash
convert-claude-history.sh && qmd update && qmd embed
```

## Troubleshooting

### LaunchAgent not running?
```bash
launchctl list | grep qmd-claude-history
launchctl load ~/Library/LaunchAgents/com.user.qmd-claude-history.plist
```

### Missing collections?
```bash
# Re-run conversion and indexing
convert-claude-history.sh
qmd collection list
qmd embed
```

### Clear and rebuild all
```bash
rm -rf ~/.claude/converted-history
convert-claude-history.sh
# Then recreate collections manually
```

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.user.qmd-claude-history.plist
rm ~/Library/LaunchAgents/com.user.qmd-claude-history.plist
rm ~/.local/bin/convert-claude-history.sh
# Optional: remove converted history
rm -rf ~/.claude/converted-history
```

## Notes

- This skill is automatically available to Claude when discussing past work
- No activation command needed - searches happen automatically
- 96% token reduction by returning snippets instead of full files
- All indexing is local and private
- Project names are extracted from the `cwd` field in JSONL files
- New projects are automatically indexed when the LaunchAgent runs
SKILL_EOF

info "Installed skill: qmd-claude-history"

# Install LaunchAgent
cat > "${HOME}/Library/LaunchAgents/com.user.qmd-claude-history.plist" << 'PLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
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
        <string>${HOME}/.cache</string>
    </dict>
</dict>
</plist>
PLIST_EOF

# Load LaunchAgent
launchctl load "${HOME}/Library/LaunchAgents/com.user.qmd-claude-history.plist" 2>/dev/null || true
info "Installed and loaded LaunchAgent (runs every 30 min)"

# Convert existing history
echo ""
echo "Converting existing Claude history..."
convert-claude-history.sh 2>&1 | tail -5

# Create QMD collections for major projects
echo ""
echo "Creating QMD collections for converted history..."

for project_dir in "${HOME}/.claude/converted-history"/*; do
    if [[ ! -d "$project_dir" ]]; then
        continue
    fi

    project_name=$(basename "$project_dir")
    collection_name="claude-${project_name}-conversations"

    # Check if collection already exists
    if qmd collection list 2>/dev/null | grep -q "^${collection_name}$"; then
        warn "Collection $collection_name already exists, skipping"
        continue
    fi

    echo "Creating collection: $collection_name"
    qmd collection add "$project_dir" --name "$collection_name" 2>/dev/null || warn "Failed to create collection"
    qmd context add "qmd://${collection_name}/" "Claude conversation history for ${project_name} project" 2>/dev/null || true
done

# Generate embeddings
echo ""
echo "Generating embeddings..."
qmd embed 2>&1 | tail -3

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                 Installation Complete!                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "What's set up:"
echo "  ✓ Skill: ~/.claude/skills/qmd-claude-history/SKILL.md"
echo "  ✓ Converter script: ~/.local/bin/convert-claude-history.sh"
echo "  ✓ LaunchAgent: Auto-updates every 30 minutes"
echo "  ✓ Collections: Created for existing projects"
echo ""
echo "The skill activates automatically when you ask about past work:"
echo "  \"What did we work on last week?\""
echo "  \"How did I implement X?\""
echo "  \"Remind me about the Y project\""
echo ""
echo "Manual search:"
echo "  /qmd \"your query\" --collection claude-<project>-conversations"
echo ""
echo "Manual update:"
echo "  convert-claude-history.sh && qmd update && qmd embed"
echo ""
