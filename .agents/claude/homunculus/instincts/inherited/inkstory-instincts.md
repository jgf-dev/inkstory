# Instincts generated from https://github.com/jgf-dev/inkstory
# Generated: 2026-09-14T18:24:21.610Z
# Version: 2.0
# NOTE: This file supplements (does not replace) any existing curated instincts.
# High-confidence manually curated instincts should be preserved alongside these.

---
id: inkstory-commit-length
trigger: "when writing a commit message"
confidence: 0.6
domain: git
source: repo-analysis
source_repo: https://github.com/jgf-dev/inkstory
---

# Inkstory Commit Length

## Action

Write moderate-length commit messages (~58 characters)

## Evidence

- Average commit message length: 58 chars
- Based on 100 commits

---
id: inkstory-naming-files
trigger: "when creating a new file"
confidence: 0.8
domain: code-style
source: repo-analysis
source_repo: https://github.com/jgf-dev/inkstory
---

# Inkstory Naming Files

## Action

Use camelCase naming convention

## Evidence

- Analyzed file naming patterns in repository
- Dominant pattern: camelCase

---
id: inkstory-export-style
trigger: "when exporting from a module"
confidence: 0.7
domain: code-style
source: repo-analysis
source_repo: https://github.com/jgf-dev/inkstory
---

# Inkstory Export Style

## Action

Prefer named exports

## Evidence

- Export pattern analysis
- Dominant style: named

---
id: inkstory-arch-type-based
trigger: "when adding new code"
confidence: 0.8
domain: architecture
source: repo-analysis
source_repo: https://github.com/jgf-dev/inkstory
---

# Inkstory Arch Type Based

## Action

Place code in the appropriate type folder (components/, services/, utils/, etc.)

## Evidence

- Type-based module organization detected
- Folders: app, lib

---
id: inkstory-test-separate
trigger: "when writing tests"
confidence: 0.8
domain: testing
source: repo-analysis
source_repo: https://github.com/jgf-dev/inkstory
---

# Inkstory Test Separate

## Action

Place tests in the tests/ or __tests__/ directory, mirroring src structure

## Evidence

- Separate test directory pattern detected
- Tests live in dedicated test folders

