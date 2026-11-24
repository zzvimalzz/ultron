---
name: kiss
description: Keep code simple. Use whenever you write or change code, and before finishing, to strip over-engineering - speculative abstractions, extra layers, config options or dependencies the requirement doesn't need.
---

# KISS

Write the simplest code that meets the requirement as stated today. If the repository has its own conventions (AGENTS.md, CLAUDE.md, a project skill), they come first.

## Rules

1. **No speculative abstraction.** No base class, plugin system, factory or option for a case that doesn't exist yet. Two real call sites justify a shared function; one doesn't.
2. **No pass-through layers.** A function that only forwards its arguments goes. So does a module holding one small helper used in one place: inline it.
3. **No new dependencies** when the language or platform does the job in a few lines.
4. **No configuration nobody asked for.** Hard-code sensible values; add a setting only for a stated user need.
5. **Data over branches.** A small table beats a chain of `if`/`switch` branches that differ only in values.
6. **Delete dead code:** unused exports, parameters, styles, routes, flags and commented-out blocks.
7. **Match the change to the request.** Don't refactor, rename or reformat code the task didn't touch.

## Before finishing

For every file you touched, ask:

- Could this be shorter without being harder to read?
- Does every function, parameter and option have a real caller?
- Did I add a dependency, layer or setting the task didn't require?

Fix what you find. If a simplification would change behaviour, keep the behaviour and say why.

<!-- Installed by Ultron -->
