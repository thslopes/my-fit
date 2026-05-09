# Agent Instructions

These instructions apply to all agents working in this repository.

## Core Rules

- Make the minimal change necessary to satisfy the request.
- Do not add files, dependencies, tooling, configuration, tests, CI, Docker, or scaffolding unless the user explicitly asks for them.
- Prefer editing existing files over creating new files.
- If a request is ambiguous, ask before introducing new architecture or expanding scope.

## Design Rules

- Prefer object-oriented design when implementing code.
- Use clear class and interface boundaries where the language and project style support them.
- Keep responsibilities small and cohesive.
- Reuse existing abstractions before introducing new ones.
- Avoid unnecessary patterns or abstraction layers when a simpler object-oriented design is sufficient.

## Validation Rules

- Always run lint after code changes when a lint command or lint configuration exists in the repository.
- Fix lint issues introduced by the change.
- Do not fix unrelated lint issues unless the user asks for broader cleanup.

## Execution Style

- Implement only what was requested.
- Stop after the requested work is complete.
- Summarize assumptions briefly when they affect the implementation.