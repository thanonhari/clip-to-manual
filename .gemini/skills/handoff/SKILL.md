---
name: handoff
description: Compact the current conversation into a structured handoff document for another agent or fresh session to continue the work seamlessly.
argument-hint: "What will the next session be used for?"
---

# Handoff Skill (by Matt Pocock)

When this skill is invoked:
1. **Analyze Session Context**: Review all completed tasks, current project state, active files, and open decisions.
2. **Security & Redaction**: Scan the document for API keys, passwords, or secrets and redact them (`[REDACTED]`).
3. **Structured Handoff Document**: Generate a clean, comprehensive markdown handoff document containing:
   - **Executive Summary**: What was built, tested, and resolved.
   - **Current System State & Architecture**: Key files, technologies, and active endpoints.
   - **Open Tasks & Next Steps**: What the next session / agent should focus on.
   - **Key Decisions & Constraints**: Architectural decisions, Anti-Slop rules, and quality gates.
   - **Suggested Skills & Tools**: Which skills or commands the next agent should use.
4. **Save Location**: Save the handoff document to the workspace or temporary location and present it to the user.
