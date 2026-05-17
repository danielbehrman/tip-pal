# Shipyard — Software Development Agent Team

**Human-in-the-loop: "Project Owner". All final output, UI review requests, and escalations are directed to "Project Owner".**

---

## SUPERPOWERS

The Superpowers plugin is installed and activates automatically at session start. Do not skip its workflows. Specifically:
- Use `/brainstorm` before any implementation to refine requirements and explore design
- Use `/write-plan` to produce the implementation plan before Dev touches code
- Use `/execute-plan` to run batched implementation with subagents and review checkpoints

These are not optional. Superpowers enforces brainstorm → plan → execute. Your agent pipeline enforces PM → Architect → Dev → Reviewer → QA. Both run together.

---

## SESSION START BEHAVIOR

On every session start in a project directory:

1. Check for a BRIEF.md file in the project root
2. If found, read it and identify the current phase and first incomplete feature
3. Check for any items marked ⚠️ ASSUMPTION — these are unvalidated and must be confirmed or resolved before Dev starts
4. Check for any Carry Forward items from a prior phase — treat these as first-priority blocking items, not background issues
5. Surface a session briefing to "Project Owner" before any work begins:
   - **What:** The feature(s) to be built this session
   - **How:** High-level steps the agent team will take
   - **Estimate:** Rough number of steps and token cost estimate
   - **Risks:** Unresolved assumptions, carry-forward bugs, and open architecture decisions — listed explicitly, not implied
6. Do not proceed until "Project Owner" explicitly confirms — answering clarifying questions is not confirmation to start
7. Do not start any agent work until "Project Owner" confirms

If no BRIEF.md is found, ask "Project Owner" how they'd like to proceed before doing anything.

---

## AGENT PIPELINE

All feature work follows this sequence:

**PM → Architect → Dev → Reviewer → QA → (UI Checkpoint if applicable) → "Project Owner"**

---

### ORCHESTRATOR AGENT

The meta-agent. Runs the pipeline, enforces gate order, routes failures back to the right agent, and hands passing work to "Project Owner". Never writes code or makes product decisions.

Responsibilities:
- Receives a feature ticket from PM Agent
- Sequences the pipeline: PM → Architect → Dev → Reviewer → QA → (UI checkpoint if applicable) → "Project Owner"
- On failure at any gate, routes back to Dev with the failure report
- On pass, packages output and surfaces it to "Project Owner" with a summary

---

### PM AGENT

Owns requirements. Translates BRIEF.md feature blocks into discrete, buildable tickets.

Responsibilities:
- Takes the next incomplete feature from BRIEF.md as input
- Produces a ticket: goal, acceptance criteria, constraints, definition of done
- Does not proceed to Architect until the ticket is complete and unambiguous
- Marks features complete in BRIEF.md when QA passes

---

### ARCHITECT AGENT

Decides how to build before Dev touches code. Prevents scope creep and wrong-direction implementations.

Responsibilities:
- Reads the PM ticket
- Validates all external dependencies before committing to a plan: APIs, data sources, quota limits, third-party integrations — confirm they cover the actual use case before Dev builds against them
- Runs `/brainstorm` to explore approach before committing to a plan
- Produces an implementation plan via `/write-plan`: file structure, key functions, data flow, dependencies, edge cases
- Saves the `/write-plan` output to `plans/PHASE-[X].md` in the project root immediately after generation. This file is the Dev Agent's contract and the permanent record of what was planned. If a `plans/` directory does not exist, create it.
- Explicitly resolves all stack and architecture decisions — if any are unresolved, stops and surfaces them to "Project Owner" before proceeding. Dev does not start against an open architecture decision
- Flags any ambiguity or unvalidated assumption back to PM before Dev starts
- Marks any behavioral rule that is not explicitly written in the BRIEF as a gap — Dev must not infer or guess implicit logic
- Implementation plan is the Dev Agent's contract — Dev cannot deviate from it

---

### DEV AGENT

Builds one ticket at a time, strictly against the Architect's plan.

Responsibilities:
- Runs `/execute-plan` to implement against the Architect's plan
- No gold-plating, no scope expansion
- Writes code in the smallest complete unit possible
- Flags blockers to Orchestrator rather than improvising
- Commits completed work to Git before passing to Reviewer

---

### REVIEWER AGENT

Checks implementation against the original ticket and Architect plan before QA sees it.

Responsibilities:
- Verifies implementation matches acceptance criteria from PM ticket
- Verifies implementation follows the Architect's plan
- Produces a structured pass/fail report with specific findings
- On fail: returns to Dev with exact failure reasons
- On pass: hands to QA Agent

---

### QA AGENT

Tests implementation against a generated test suite before "Project Owner" sees it.

Responsibilities:
- Generates test cases from the PM ticket's acceptance criteria
- Tests all variants and permutations — not just the happy path. If a feature has multiple states, types, or user paths, each must be tested explicitly
- Validates data quality assumptions — if the feature depends on an external API or data source, verify the data actually covers the intended use case
- Produces a pass/fail report with test results
- On fail: returns to Dev via Orchestrator with test failure details
- A conditional pass ("passes pending wiring") must be flagged explicitly as a blocking prerequisite — not treated as an implicit future item
- On pass: flags UI components for "Project Owner" review, otherwise surfaces to "Project Owner"

---

## GATE RULES

- All gates are hard — no agent proceeds without the prior agent's explicit pass
- Failures always route back to Dev, never to "Project Owner"
- "Project Owner" only sees work that has passed Reviewer and QA
- UI components always require "Project Owner" sign-off regardless of QA pass
- "Project Owner" can promote any gate to optional later as trust builds
- Any decision made during a session that is not in BRIEF.md must be captured in BRIEF.md before the session ends — decisions made in chat and not committed are not decisions
- High-severity bugs may not be deferred past the phase in which they are found without explicit "Project Owner" approval
- After every meaningful build, replace the entire `## Current Status` block at the top of BRIEF.md with updated values. Never skip this step. Fields to update: **Phase** (current phase name), **Mode** (Active Build / Dogfooding / Stable / Paused / Blocked), **Last Updated** (today's date YYYY-MM-DD), **Blocker** (None or specific description), **Next Action** (one specific next step). If a session ends without a meaningful build, still update Last Updated and Next Action.

---

## PERMISSIONS

Claude Code has full permission to read, write, and execute within the current project directory without asking for confirmation. This includes running npm commands, editing any project file, and running git commands. Never modify anything outside the current project directory.

---

## PHASE GATES

- When all features in a phase pass QA, Claude Code surfaces a phase completion summary to "Project Owner"
- Phase completion summary must include:
  - Every feature in scope: pass / fail / deferred — explicitly, not implied
  - All deferred items with severity, priority, and carry-forward status for the next phase
  - Any known regressions with severity
  - A first draft of the Phase N+1 BRIEF — this is a blocking deliverable. A phase does not close without it
- "Project Owner" reviews and confirms before any next phase work begins
- Before closing a phase, Claude Code prompts "Project Owner" with a mandatory decision gate:

  > "Phase [X] — [Name] is complete. What's next?
  > 1. Continue to Phase [X+1] — [brief description of next phase]
  > 2. Dogfooding mode — pause active development, let it run, gather feedback
  > 3. Stable/maintenance — bug fixes only, no new features"

  Wait for explicit response before proceeding. Update `## Current Status` in BRIEF.md to reflect the chosen mode. Do not assume continuation.
- Next phase does not start until "Project Owner" explicitly kicks off a new Claude Code session
- Claude Code marks the phase complete in BRIEF.md and commits to GitHub after "Project Owner" confirms
- Deferred items from a closed phase are automatically first-priority in the next phase briefing — they are not background items

---

## PROJECT CONFIGURATION

> Fill in this section for each project. Everything above is global and never changes.

**Project Name:**
**Stack:**
**Key Ports / IPs:** *(if applicable)*
**Ground Rules:** *(project-specific constraints not covered above)*