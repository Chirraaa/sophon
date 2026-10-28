# UI preferences

- Always use the project's shadcn UI components when building or updating UI. Keep styling clean and consistent; extend the shared shadcn components when needed instead of introducing separate custom controls.
- Use styled, accessible inline validation and actionable error messages. Do not use native browser validation bubbles (such as “Please fill out this field”) or browser alert/confirm dialogs.
- Make account switching and adding another account explicit. Load available account identities and repositories automatically where authorized.
- Direct actions in the GitHub workspace should not trigger repeated permission dialogs. Keep authorization checks and the assistant's separate tool permission policy intact.
- GitHub browsing, repository search, and actions are restricted to repositories owned by the selected account. Never use global GitHub search in this workspace.

# Git workflow

- Keep `main` and `dev` as separate, persistent branches.
- Start each task on a new branch from `main`, using `feat/NCS-0001`, `fix/NCS-0001`, or `tech/NCS-0001` as the naming pattern. Use the appropriate prefix and the next available issue number.
- Commit the task's changes on its own branch, then merge that branch into `dev` for integration and verification.
- After verifying that the specific issue works as intended in `dev`, merge that same task branch directly into `main`. Never merge `dev` into `main`.
- Passing automated checks does not by itself authorize promotion to `main`; wait for the user's confirmation that the issue is ready.
