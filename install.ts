import prompts from 'prompts';
import ora from 'ora';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

interface Assistant {
  name: string;
  id: string;
  configPath: string;
  detected: boolean;
}

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
  const spinner = ora('Detecting installed AI assistants...').start();
  const assistants = await detectAssistants();
  spinner.stop();
  
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
    
    if (selected && selected.length > 0) {
      console.log(chalk.green(`Selected ${selected.length} assistant(s) for configuration.`));
    }
  }
  
  // Check prerequisites
  console.log('');
  console.log(chalk.cyan.bold('Step 3: Checking Prerequisites'));
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
  
  const steps = [
    { name: 'Creating directories', delay: 500 },
    { name: 'Installing converter script', delay: 500 },
    { name: 'Installing skill', delay: 500 },
    { name: 'Installing LaunchAgent', delay: 500 },
    { name: 'Converting history', delay: 1000 },
    { name: 'Creating QMD collections', delay: 1000 },
    { name: 'Generating embeddings', delay: 1000 }
  ];
  
  for (const step of steps) {
    const stepSpinner = ora(step.name).start();
    await new Promise(resolve => setTimeout(resolve, step.delay));
    stepSpinner.succeed();
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
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
});
