---
name: project-analyzer
description: >
  Analyze the current project structure, identify key files, 
  and summarize the technology stack. 
  Use this when the user asks "what does this project do?" 
  or "how is the code organized?".
tags: [analysis, codebase, tech-stack]
---

# Project Analyzer Skill

This skill provides a standard operating procedure for analyzing a codebase.

## Workflow

1. **Scan Directory**: Use `exec` with `ls -R` to see the full structure.
2. **Identify Entry Points**: Look for `package.json`, `index.ts`, or `main.ts`.
3. **Read Key Files**: Use `read_file` to inspect `package.json` for dependencies.
4. **Summarize**: Provide a high-level summary of the architecture.

## Guidelines

- Be concise and focus on the primary purpose of the project.
- Mention the key technologies used (e.g. TypeScript, OpenAI, Vitest).
- Point out the core logic directory.
