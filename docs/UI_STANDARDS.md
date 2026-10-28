# Interface standards

ProjectAnvil should make work easy to read, find, and act on. These standards apply to interface fixes and future features. Preserve existing workflows and local-only operation while improving the presentation.

## Product decisions

Use these UX and UI pillars as acceptance criteria, including when adding future features. The goal is a useful, calm workspace whose depth appears when needed.

| Pillar | ProjectAnvil rule |
| --- | --- |
| Usability and simplicity | Put the next action and essential fields first. Show optional planning and administration in named expandable sections. Reveal configured values and validation errors so important information stays discoverable. |
| Usefulness and value | Every addition must support an identifiable project, task, thinking, or recovery goal. Improve an existing workflow before introducing another tool, setting, or permanent control. Removing a capability needs evidence and explicit review of existing work. |
| Findability | Use stable navigation groups and searchable tool names. More tools contains occasional destinations; navigation, search, guides, and deep links must still reach them. Keep current workspace and project scope visible. |
| Accessibility | Preserve keyboard, screen-reader, touch, zoom, reduced-motion, focus, and theme support. A collapsed section must be operable by keyboard, and closing/resetting controls must leave focus somewhere useful. |
| Credibility and feedback | Place errors beside the affected action, retain entered work, and offer a next step. Distinguish saving, queued device changes, confirmed server saves, and failures. Explain replacement/import consequences before applying them. |
| Desirability and hierarchy | Use the established typography, surfaces, spacing, and five themes. Give primary work room to breathe; optional inspectors start closed. Polish must improve readability and orientation. |
| Consistency and user control | Reuse controls, labels, and recovery paths. Keep visible exits, cancellation, Undo, and restore. Expanding help or a settings group must never create records, save edits, or change permissions. |

The first-run guide is an **eight-step Quick start**. Detailed help belongs in the **nine optional topic guides**, searchable through **All guides**. Add future feature explanations to the relevant topic instead of lengthening the default tour. Navigation and guidance must preserve the current project, avoid edits, and return users to their previous screen when dismissed.

These rules apply the [visual hierarchy principles](https://www.nngroup.com/articles/principles-visual-design/) and [usability, consistency, accessibility, and user-control principles](https://www.uxdesigninstitute.com/blog/ux-design-principles-2026/) to this app. They are design requirements, not a claim of completed accessibility certification or validated user research.

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
- Keep local editor panels below global navigation menus, and application dialogs above both. Check ordinary pointer clicks and keyboard access while competing panels are open; a visible control must also be reachable.
- Respect reduced-motion preferences. Do not rely on animation to explain a result.
- Keep the page usable from 320 px mobile layouts through large desktop screens and at 200% zoom. Contain deliberate horizontal scrolling inside boards, timelines, canvases, and wide tables; avoid page-level overflow.
- Check long names, many projects, populated workspaces, and empty workspaces. Preserve readable content rather than shrinking text to make it fit.

## Writing and icons

- Use short, familiar labels that describe the tool or action. Navigation uses **Tasks**, **Daily notes**, and **Teams & workspaces**; use the same names in search, headings, and guides. Keep stored keys separate from display labels.
- Use sentence case. Omit promotional eyebrows, motivational slogans, and promises such as "magic" or "effortless." A heading should help someone find their work. Warm, ordinary language is welcome; avoid repeated coaching.
- Give an empty state a factual heading and one useful next action. Avoid generic illustrations and repeated reassurance that add no information.
- Keep helper text close to the control it explains. Explain unusual behavior, limits, and consequences; don't restate an obvious label. Put operational detail in the setup guide or an optional disclosure.
- Errors should explain what happened and what to do next. Preserve distinctions between drafts, queued changes, saved work, conflicts, and denied access. Never imply an email was sent, a save succeeded, or a backup exists unless it did.
- Show readable field and item names in ordinary feedback. Reuse the shared field/entity labels; don't show schema keys, request identifiers, or synchronization internals as product copy. Raw export and optional recovery inspection formats remain available.
- Use the existing Lucide icons consistently. A pencil edits; an ellipsis opens a menu; an internal arrow opens an item; an external-link arrow opens another window or destination. Icons must describe the actual action. Reserve warning graphics for a state that needs attention.
- Keep text labels for important actions. Give icon-only buttons an accessible name and hide adjacent decorative icons from screen readers. Don't display a keyboard-key badge unless it represents a real shortcut.
- Retain useful detail and creative template examples. Concise copy must not hide sharing rules, data-loss consequences, offline limits, or recovery choices.

## Review checklist

Before an interface change is finished:

- Review affected screens on a narrow mobile viewport and a desktop viewport, including keyboard focus and touch-size controls.
- Check every supported theme, visible scope, active states, long content, and relevant empty, pending, and failed-save states.
- Verify the affected workflow, including cancellation and returning from dialogs. Run the existing checks appropriate to the change.
- Check both the simple first-use path and populated/configured work. Verify advanced sections retain values when closed, validation reveals the affected fields, search reaches occasional tools, and the short guide retains access to detailed help without writing records.
- Update the [README](../README.md) for changed user-facing behavior and keep the in-app tour's names and instructions consistent.
- Keep screenshots and public examples free of private workspace data, account details, and local backup locations.

Startup, storage, backup, and recovery instructions belong in [Local setup](LOCAL_SETUP.md). Publishing and synchronization remain subject to [Local-only operation](../LOCAL_ONLY.md).
