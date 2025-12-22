# Product Requirements Document: Agent Skills Compatibility Layer

**Document Version:** 1.0
**Date:** December 22, 2025
**Project Codename:** Stirrup
**Author:** Letta Engineering Team

---

## Executive Summary

> *This section provides a high-level overview of what we're building and why. It should give stakeholders enough context to understand the project's purpose without diving into technical details.*

The Agent Skills specification, published by Anthropic at [agentskills.io](https://agentskills.io), has emerged as an open standard for extending AI agent capabilities. Major platforms including Cursor, VS Code (GitHub Copilot), OpenCode, Goose, and Claude Code have adopted this standard, creating an ecosystem of interoperable skills.

This PRD defines the requirements for making Letta Code's existing skill system fully compatible with the Agent Skills specification. Our goal is to enable skill portability—users should be able to take skills created for Claude Code or other compatible platforms and use them seamlessly in Letta Code, and vice versa.

**Key Outcomes:**
- Full compatibility with the Agent Skills v1 specification
- Ability to import skills from the Anthropic skills repository
- Skills created in Letta Code work in other compatible agents
- Preservation of Letta Code's existing skill capabilities

---

## Table of Contents

1. [Background & Research](#background--research)
2. [Current State Analysis](#current-state-analysis)
3. [Feature Comparison Matrix](#feature-comparison-matrix)
4. [Gap Analysis](#gap-analysis)
5. [Technical Requirements](#technical-requirements)
6. [Implementation Specification](#implementation-specification)
7. [Migration Strategy](#migration-strategy)
8. [Success Criteria](#success-criteria)
9. [Appendices](#appendices)

---

## Background & Research

> *This section documents our research into the Agent Skills ecosystem. Understanding the standard and its adoption is crucial for making informed design decisions.*

### What is Agent Skills?

Agent Skills is an open format developed by Anthropic for extending AI agent capabilities. It provides a lightweight framework for giving agents access to specialized knowledge and workflows on demand. The specification is intentionally minimal—a skill is simply a folder containing a `SKILL.md` file with optional supporting resources.

**Core Value Proposition:**
- **Domain Expertise**: Package specialized knowledge into reusable instructions
- **New Capabilities**: Extend agents with abilities like presentation creation, data analysis, etc.
- **Repeatable Workflows**: Convert multi-step tasks into consistent, auditable processes
- **Interoperability**: Reuse skills across different compatible agent platforms

### Ecosystem Adoption

The following platforms have adopted the Agent Skills standard:

| Platform | Skill Location(s) | Status |
|----------|-------------------|--------|
| Claude Code | `~/.claude/skills/`, `.claude/skills/` | Full support |
| VS Code (Copilot) | `.github/skills/`, `.claude/skills/` | Full support |
| Cursor | `.cursor/skills/` | Full support |
| OpenCode | Configuration-based | Full support |
| Goose | Configuration-based | Full support |
| Letta Code (Current) | `.skills/` | Partial support |

### Research Sources

- [Agent Skills Official Documentation](https://agentskills.io)
- [Agent Skills Specification](https://agentskills.io/specification)
- [Anthropic Skills Repository](https://github.com/anthropics/skills)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [VS Code Agent Skills Integration](https://code.visualstudio.com/docs/copilot/customization/agent-skills)

---

## Current State Analysis

> *This section documents how skills currently work in Letta Code. Understanding our existing implementation helps identify what needs to change versus what can be preserved.*

### Letta Code Skill Architecture

Letta Code already has a sophisticated skill system with the following components:

#### 1. Directory Structure

Skills are stored in a `.skills/` directory (configurable via `--skills` flag):

```
.skills/
├── skill-name/
│   ├── SKILL.md          (required)
│   ├── scripts/          (optional - executable code)
│   ├── references/       (optional - documentation)
│   ├── assets/           (optional - templates, images)
│   └── LICENSE.txt       (optional)
```

#### 2. SKILL.md Format

Current frontmatter schema:

```yaml
---
name: skill-name           # Required
description: "..."         # Required
category: "..."            # Optional (Letta-specific)
tags: ["...", "..."]       # Optional (Letta-specific)
---

[Markdown content]
```

#### 3. Memory Block Integration

Letta Code uses a unique memory block system for skill management:

- **`skills` block**: Lists all discovered skills (metadata only)
- **`loaded_skills` block**: Contains full content of actively loaded skills

This design enables progressive disclosure—only skill metadata is loaded at startup, full content is loaded on-demand.

#### 4. Skill Tool

The `Skill` tool provides three commands:

| Command | Purpose |
|---------|---------|
| `load` | Load skill content into `loaded_skills` block |
| `unload` | Remove skill from `loaded_skills` block |
| `refresh` | Re-scan skills directory and update `skills` block |

#### 5. Discovery Process

1. Recursively search for `SKILL.md` files in skills directory
2. Parse YAML frontmatter to extract metadata
3. Derive skill ID from directory path (e.g., `web/scraper` → `web/scraper`)
4. Format skills list for `skills` memory block

---

## Feature Comparison Matrix

> *This matrix provides a side-by-side comparison of our current implementation against the Agent Skills specification. Green checkmarks indicate compatibility, yellow circles indicate partial compatibility, and red X's indicate gaps.*

| Feature | Agent Skills Spec | Letta Code Current | Status |
|---------|------------------|-------------------|--------|
| **Core Structure** | | | |
| SKILL.md file required | Yes | Yes | Compatible |
| Case-insensitive filename | Yes (`skill.md`, `SKILL.md`) | Yes (uppercase only) | Partial |
| Directory-based skills | Yes | Yes | Compatible |
| **Frontmatter Fields** | | | |
| `name` (required) | Max 64 chars, lowercase, hyphens | Any string | Gap |
| `description` (required) | Max 1024 chars | Any string | Gap |
| `license` (optional) | String | Not supported | Gap |
| `compatibility` (optional) | Max 500 chars | Not supported | Gap |
| `metadata` (optional) | Key-value pairs | Not supported | Gap |
| `allowed-tools` (optional) | Space-delimited list | Not supported | Gap |
| `category` (Letta-specific) | N/A | Supported | Extension |
| `tags` (Letta-specific) | N/A | Supported | Extension |
| **Resource Directories** | | | |
| `scripts/` directory | Supported | Supported | Compatible |
| `references/` directory | Supported | Supported | Compatible |
| `assets/` directory | Supported | Supported | Compatible |
| **Discovery Locations** | | | |
| User skills (`~/.claude/skills/`) | Supported | Not supported | Gap |
| Project skills (`.claude/skills/`) | Supported | `.skills/` only | Gap |
| Plugin/bundled skills | Supported | Not supported | Gap |
| **Context Integration** | | | |
| Progressive disclosure | 3 levels | 3 levels | Compatible |
| XML prompt format | Recommended | Markdown format | Compatible |
| **Tooling** | | | |
| Validation (`skills-ref validate`) | Supported | Not supported | Gap |
| Prompt generation | Supported | Custom format | Compatible |

---

## Gap Analysis

> *This section details the specific gaps between our implementation and the specification, along with the impact of each gap and recommended resolution approach.*

### Critical Gaps (Must Fix)

#### Gap 1: Skill Discovery Locations

**Current:** Skills only discovered from `.skills/` directory
**Spec:** Multiple locations supported:
- `~/.claude/skills/` (user-level)
- `.claude/skills/` (project-level, git-tracked)
- Plugin-provided skills

**Impact:** Users cannot share project skills via git or maintain personal skill libraries.

**Resolution:** Implement multi-location discovery with priority ordering.

#### Gap 2: Frontmatter Validation

**Current:** No validation of frontmatter field values
**Spec:** Strict requirements:
- `name`: Max 64 chars, lowercase letters, numbers, hyphens only
- `description`: Max 1024 chars

**Impact:** Skills created in Letta Code may fail validation in other tools.

**Resolution:** Add validation with warnings for non-compliant skills.

#### Gap 3: `allowed-tools` Support

**Current:** Not supported
**Spec:** Optional field to restrict which tools Claude can access when skill is active

**Impact:** Security-sensitive skills cannot enforce tool restrictions.

**Resolution:** Implement tool filtering when skills with `allowed-tools` are loaded.

### Medium Gaps (Should Fix)

#### Gap 4: Additional Frontmatter Fields

**Current:** Only `name`, `description`, `category`, `tags` supported
**Spec:** Also supports `license`, `compatibility`, `metadata`

**Impact:** Skills may lose metadata when moved between systems.

**Resolution:** Parse and preserve all standard fields.

#### Gap 5: Case-Insensitive File Discovery

**Current:** Only looks for `SKILL.MD` (uppercase)
**Spec:** Case-insensitive matching (`skill.md`, `SKILL.md`, `Skill.md`)

**Impact:** Skills with lowercase filenames won't be discovered.

**Resolution:** Update file matching to be case-insensitive.

### Low Priority Gaps (Nice to Have)

#### Gap 6: Validation Tooling

**Current:** No CLI validation tool
**Spec:** `skills-ref validate` command available

**Impact:** Skill authors must manually verify compliance.

**Resolution:** Add `letta skills validate <path>` command.

---

## Technical Requirements

> *This section specifies what must be built to achieve full compatibility. Each requirement is numbered for traceability and includes acceptance criteria.*

### TR-1: Multi-Location Skill Discovery

**Description:** Support discovering skills from multiple standard locations with proper priority ordering.

**Locations (in priority order):**
1. Project skills: `./.claude/skills/` (highest priority)
2. Project skills (legacy): `./.skills/` (backward compatibility)
3. User skills: `~/.claude/skills/`
4. Plugin skills: Bundled with installed plugins

**Acceptance Criteria:**
- [ ] Skills discovered from all four locations
- [ ] Higher priority locations shadow lower priority skills with same ID
- [ ] Skill source location indicated in skill metadata
- [ ] `--skills` flag overrides default locations

### TR-2: Frontmatter Schema Compliance

**Description:** Parse and validate all Agent Skills specification frontmatter fields.

**Schema:**
```typescript
interface SkillFrontmatter {
  // Required fields
  name: string;        // Max 64 chars, lowercase, numbers, hyphens
  description: string; // Max 1024 chars

  // Optional spec fields
  license?: string;
  compatibility?: string;  // Max 500 chars
  metadata?: Record<string, string>;
  'allowed-tools'?: string;  // Space-delimited tool names

  // Letta extensions (preserved for compatibility)
  category?: string;
  tags?: string[];
}
```

**Acceptance Criteria:**
- [ ] All spec fields parsed correctly
- [ ] Validation warnings for non-compliant values
- [ ] Letta-specific fields preserved as extensions
- [ ] Invalid skills logged but not fatal

### TR-3: `allowed-tools` Enforcement

**Description:** When a skill with `allowed-tools` is loaded, restrict available tools to the specified list.

**Behavior:**
- Parse space-delimited tool list from frontmatter
- When skill is active, filter tool calls to allowed list
- Other tools require explicit user permission

**Acceptance Criteria:**
- [ ] Tool filtering active when `allowed-tools` specified
- [ ] Clear error messages when blocked tools invoked
- [ ] User can override with explicit permission
- [ ] Works correctly with multiple loaded skills

### TR-4: Case-Insensitive File Discovery

**Description:** Discover `SKILL.md` files regardless of case.

**Valid filenames:** `SKILL.md`, `skill.md`, `Skill.md`, `SKILL.MD`

**Acceptance Criteria:**
- [ ] All case variations discovered
- [ ] Only one skill per directory (first match wins)
- [ ] Consistent behavior across operating systems

### TR-5: Context Prompt Format

**Description:** Support XML-style prompt format for skill availability display.

**Format:**
```xml
<available_skills>
  <skill>
    <name>skill-name</name>
    <description>Skill purpose and triggers</description>
    <location>/path/to/SKILL.md</location>
  </skill>
</available_skills>
```

**Acceptance Criteria:**
- [ ] XML format available as option
- [ ] Markdown format preserved as default
- [ ] Format configurable via settings

### TR-6: Validation Command

**Description:** Add CLI command to validate skill compliance.

**Usage:** `letta skills validate <path>`

**Checks:**
- Frontmatter format and required fields
- Field value constraints (length, characters)
- Directory structure
- Resource file references

**Acceptance Criteria:**
- [ ] Clear pass/fail output
- [ ] Detailed error messages for failures
- [ ] Exit code reflects validation result
- [ ] Supports validating single skill or directory

---

## Implementation Specification

> *This section provides detailed implementation guidance for each technical requirement. It includes code examples and file locations to modify.*

### IS-1: Updated Skill Interface

**File:** `src/agent/skills.ts`

```typescript
export interface Skill {
  // Existing fields
  id: string;
  name: string;
  description: string;
  path: string;

  // Updated fields
  category?: string;      // Letta extension
  tags?: string[];        // Letta extension

  // New Agent Skills spec fields
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];  // Parsed from 'allowed-tools'

  // Source tracking
  source: 'project' | 'legacy' | 'user' | 'plugin';
}
```

### IS-2: Multi-Location Discovery

**File:** `src/agent/skills.ts`

```typescript
export async function discoverAllSkills(): Promise<SkillDiscoveryResult> {
  const locations = [
    { path: join(process.cwd(), '.claude', 'skills'), source: 'project' },
    { path: join(process.cwd(), '.skills'), source: 'legacy' },
    { path: join(homedir(), '.claude', 'skills'), source: 'user' },
    // Plugin skills handled separately
  ];

  const allSkills: Skill[] = [];
  const seenIds = new Set<string>();

  for (const location of locations) {
    const result = await discoverSkills(location.path);
    for (const skill of result.skills) {
      if (!seenIds.has(skill.id)) {
        skill.source = location.source;
        allSkills.push(skill);
        seenIds.add(skill.id);
      }
    }
  }

  return { skills: allSkills, errors: [] };
}
```

### IS-3: Frontmatter Validation

**File:** `src/utils/skillValidation.ts` (new file)

```typescript
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSkillFrontmatter(
  frontmatter: Record<string, unknown>
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required: name
  if (!frontmatter.name) {
    errors.push('Missing required field: name');
  } else if (typeof frontmatter.name === 'string') {
    if (frontmatter.name.length > 64) {
      warnings.push('name exceeds 64 character limit');
    }
    if (!/^[a-z0-9-]+$/.test(frontmatter.name)) {
      warnings.push('name should use lowercase letters, numbers, and hyphens only');
    }
  }

  // Required: description
  if (!frontmatter.description) {
    errors.push('Missing required field: description');
  } else if (typeof frontmatter.description === 'string') {
    if (frontmatter.description.length > 1024) {
      warnings.push('description exceeds 1024 character limit');
    }
  }

  // Optional: compatibility
  if (frontmatter.compatibility && typeof frontmatter.compatibility === 'string') {
    if (frontmatter.compatibility.length > 500) {
      warnings.push('compatibility exceeds 500 character limit');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

### IS-4: Allowed Tools Enforcement

**File:** `src/tools/impl/Skill.ts`

When loading a skill with `allowed-tools`, store the restriction:

```typescript
// Track tool restrictions per loaded skill
const skillToolRestrictions = new Map<string, string[]>();

// In load command:
if (skill.allowedTools && skill.allowedTools.length > 0) {
  skillToolRestrictions.set(skillId, skill.allowedTools);
}

// Export for tool execution layer
export function getActiveToolRestrictions(): string[] | null {
  const allRestrictions = Array.from(skillToolRestrictions.values());
  if (allRestrictions.length === 0) return null;

  // Intersection of all restrictions
  return allRestrictions.reduce((acc, curr) =>
    acc.filter(tool => curr.includes(tool))
  );
}
```

---

## Migration Strategy

> *This section outlines how to transition from the current implementation to the new compatible version without breaking existing users.*

### Phase 1: Backward Compatibility (Week 1)

1. Keep `.skills/` as a supported location
2. Add support for additional frontmatter fields without requiring them
3. Case-insensitive file matching
4. Log deprecation warnings for `.skills/` usage

### Phase 2: New Locations (Week 2)

1. Add `.claude/skills/` and `~/.claude/skills/` discovery
2. Implement priority ordering
3. Update documentation

### Phase 3: Validation & Tooling (Week 3)

1. Add `letta skills validate` command
2. Implement `allowed-tools` enforcement
3. Add skill creation templates

### Phase 4: Documentation & Polish (Week 4)

1. Update all documentation
2. Create migration guide for existing skills
3. Add example skills from Anthropic repository
4. Final testing across platforms

---

## Success Criteria

> *This section defines measurable criteria for determining when the project is complete and successful.*

### Functional Criteria

| ID | Criterion | Verification Method |
|----|-----------|---------------------|
| SC-1 | Skills from Anthropic repository work in Letta Code | Import and test 5 sample skills |
| SC-2 | Skills created in Letta Code validate with `skills-ref` | Test with official validation tool |
| SC-3 | Existing `.skills/` directory skills continue working | Regression test suite |
| SC-4 | `allowed-tools` restrictions enforced correctly | Security test cases |
| SC-5 | Multi-location discovery works correctly | Integration tests |

### Quality Criteria

| ID | Criterion | Target |
|----|-----------|--------|
| QC-1 | Test coverage for new code | >80% |
| QC-2 | No regressions in existing tests | 100% pass rate |
| QC-3 | Documentation complete and accurate | Reviewed by 2 team members |

### User Experience Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| UX-1 | Clear error messages for invalid skills | User testing feedback |
| UX-2 | Migration path documented | Documentation review |
| UX-3 | Skill creation workflow intuitive | User testing feedback |

---

## Appendices

### Appendix A: Agent Skills Specification Reference

**Full Specification:** https://agentskills.io/specification

**Key Points:**
- SKILL.md with YAML frontmatter is the only required file
- Frontmatter requires `name` and `description`
- Optional fields: `license`, `compatibility`, `metadata`, `allowed-tools`
- Resource directories: `scripts/`, `references/`, `assets/`
- Progressive disclosure recommended for context efficiency

### Appendix B: Example Compliant Skill

```
my-skill/
├── SKILL.md
├── scripts/
│   └── helper.py
├── references/
│   └── api-docs.md
└── assets/
    └── template.html
```

**SKILL.md:**
```yaml
---
name: my-skill
description: Helps with specific task X. Use when user asks about Y or mentions Z.
license: MIT
allowed-tools: Read Grep Glob Edit
---

# My Skill

Instructions for using this skill...

## When to Use

- When user asks about X
- When files of type Y are involved

## Workflow

1. First, do A
2. Then, do B
3. Finally, do C

## Resources

- See `scripts/helper.py` for automation
- See `references/api-docs.md` for API details
```

### Appendix C: Related Documents

- [Letta Code Architecture](/docs/architecture.md)
- [Memory Block System](/docs/memory-blocks.md)
- [Tool Implementation Guide](/docs/tools.md)

---

*End of Document*
