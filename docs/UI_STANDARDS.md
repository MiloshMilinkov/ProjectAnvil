# Interface standards

ProjectAnvil should make work easy to read, find, and act on. These standards apply to interface fixes and future features. Preserve existing workflows and local-only operation while improving the presentation.

## Readability and consistency

- Reuse shared typography, spacing, surface, border, and control tokens. Prefer existing controls and component styles over a separate visual system.
- Use the shared `--font-size-*`, `--space-*`, `--radius-*`, `--control-height`, `--text-*`, `--surface-*`, `--control-border`, and `--focus-ring` tokens. Focus's dark navigation must retain its own text and surface aliases instead of inheriting the lighter page colors.
- Use 15–16 px body text, 14 px control text, and at least 12 px supporting text. Use 16 px text in mobile inputs to avoid browser zoom.
- Keep line lengths comfortable, descriptions concise, and headings descriptive. Use plain labels such as **Projects**, **Recent notes**, and **Upcoming tasks**. Retain creative and everyday examples where they help explain templates.
- Use an orderly spacing scale and consistent control sizes. Aim for at least 40 px desktop controls and 44 px touch targets. Small visual icons can sit inside larger hit areas.
- Support **Light**, **Dark**, **Warp**, **Focus**, and **Soft** through shared theme tokens. Check page surfaces, menus, dialogs, editors, and Focus's darker navigation separately.
- Target 4.5:1 contrast for normal text and 3:1 for large text and essential control boundaries. Give status and selection a text label, icon, or shape as well as color.

## Navigation and interaction

- Make the current page, workspace, and project scope clear. Label filters and provide a clear way to reset local filters.
- Give each screen one obvious primary action. Keep related actions together and place advanced options behind clearly named controls.
- Prefer useful work and next actions near the top of a page. Decorative content should support the hierarchy without displacing essential work.
- Use meaningful empty, filtered-empty, loading, error, and saving states. Explain what happened and what the user can do next. Show saved feedback only when persistence has succeeded.
- Keep important actions available on touch devices and without hover. Provide an ordinary control alternative to dragging or other precise gestures.
- Use buttons for actions and links for destinations. Use labeled button groups for independent view choices; use tab semantics only with complete tab keyboard behavior and linked panels.

## Accessibility and responsive behavior

- Give every input and icon-only control an accessible name. Use visible labels where the field's purpose would otherwise become unclear after typing.
- Expose state with the appropriate `aria-current`, `aria-pressed`, or `aria-expanded` attribute. Announce save and error feedback without repeatedly interrupting the user.
- Keep a visible focus indicator, a sensible tab order, and full keyboard access. Dialogs must contain focus, close with Escape when appropriate, and return focus when dismissed.
- Respect reduced-motion preferences. Do not rely on animation to explain a result.
- Keep the page usable from 320 px mobile layouts through large desktop screens and at 200% zoom. Contain deliberate horizontal scrolling inside boards, timelines, canvases, and wide tables; avoid page-level overflow.
- Check long names, many projects, populated workspaces, and empty workspaces. Preserve readable content rather than shrinking text to make it fit.

## Review checklist

Before an interface change is finished:

- Review affected screens on a narrow mobile viewport and a desktop viewport, including keyboard focus and touch-size controls.
- Check every supported theme, visible scope, active states, long content, and relevant empty, pending, and failed-save states.
- Verify the affected workflow, including cancellation and returning from dialogs. Run the existing checks appropriate to the change.
- Update the [README](../README.md) for changed user-facing behavior and keep the in-app tour's names and instructions consistent.
- Keep screenshots and public examples free of private workspace data, account details, and local backup locations.

Startup, storage, backup, and recovery instructions belong in [Local setup](LOCAL_SETUP.md). Publishing and synchronization remain subject to [Local-only operation](../LOCAL_ONLY.md).
