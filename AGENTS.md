# AI Agent Coding Guidelines & Quality Gate

## Automated Quality Gate
Before submitting or finishing any task, the AI Agent **MUST** run:
```bash
npm run check
```
If there are any errors or warnings from Oxlint or TypeScript, they must be resolved immediately.

## Anti-Slop Principles
1. **No `any` or broad types:** Use precise types, generics, or validated schemas.
2. **No Unsafe Type Assertions:** Avoid `as unknown as Type` or forced casts without verifiable evidence.
3. **No `Reflect` bypasses:** Do not use `Reflect.get()` to bypass TypeScript errors.
4. **Evidence-based Code:** Write clear type guards and handle `undefined`/`null` safely instead of using non-null assertions (`!`).
