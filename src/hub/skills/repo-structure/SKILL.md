---
name: repo-structure
description: Keep a repository clean and well organised. Use whenever you add files or code, and before finishing, to enforce clear module boundaries, no duplicated logic, comments only for the non-obvious why, and no AI-flavoured boilerplate.
---

# Repo structure

Follow the layout the repository already has. If it has its own conventions (AGENTS.md, CLAUDE.md, a project skill), they come first.

## Layout

- One responsibility per module. Split a file that mixes concerns, such as data access and rendering.
- Put new code where similar code already lives. Create a new folder only when several files share a purpose.
- Shared helpers go in the project's existing shared location, and only when two or more places use them.
- Keep tests, tools and generated output out of shipped source.

## No repetition

- Near-duplicate logic (same steps, different values) becomes one function, component or data table.
- Variants that differ only in data belong in a table, not in copied functions.
- Before writing a helper, search for an existing one.

## Comments

- Comment only the non-obvious why: a platform quirk, a data-format detail, a deliberate trade-off.
- No narrating comments, section banners, commented-out code, or doc comments that repeat the signature.

## Naming and boilerplate

- Specific names (`parseInvoice`, `lastSyncedAt`), not generic ones (`data`, `handler`, `utils2`, `manager`).
- No redundant wrappers, no catch-and-rethrow, no empty `else`, no checks for values that can't be missing.
- No placeholder text, unowned TODOs, or example code left behind.
- No personal details in code, comments, configs or fixtures: names, emails, machine paths, account IDs or tokens.

## Before finishing

1. List the files you touched (`git status`).
2. Check each against the rules above.
3. Extract shared code, delete noise, rename vague identifiers, then run the tests.

<!-- Installed by Ultron -->
