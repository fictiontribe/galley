# UI kit (`@/ui`)

React components over the brand's `g-` classes (`brand/components.css`). Import
from `@/ui`. Use these instead of writing markup for the same thing; when the
brand has no class for something, the style lives in `src/styles/app.css`
(prefixed `app-`). Copy follows `brand/voice.md`.

| Component | Props (all optional unless marked) |
| --- | --- |
| `Button` | `variant` primary·secondary·quiet·danger·danger-quiet, `size` sm·md·lg·xl, `icon`, `busy`, `busyLabel` ("Publishing…"), `kbd`, `block`, + every `<button>` prop. Busy shows the stet dots and swallows clicks. |
| `IconButton` | **`icon`**, **`label`** (accessible name + tooltip), `variant` (quiet), `size` (sm), `tooltip` (true), `tooltipSide`. |
| `buttonClass(variant, size, extra)` | Class string for a `<Link>`/`<a>` that should look like a button. |
| `Input` | `size` sm·md, `mono`, + every `<input>` prop. Inside `Field` it is labelled and described automatically. |
| `Textarea` | `maxRows` (12, grows to it then scrolls), `mono`, + every `<textarea>` prop. |
| `Select` | **`value`**, **`onChange(value)`**, **`options`** `{value,label,disabled?}[]`, `placeholder`. |
| `Toggle` | **`checked`**, **`onChange(checked)`**, `label`, `description`, `disabled`, `aria-label` (when no label). `role="switch"`. |
| `Checkbox` | **`checked`**, **`onChange(checked)`**, **`label`**, `description`, `disabled`. |
| `Field` | **`label`**, **`children`** (one control), `fieldKey` (mono key, e.g. `hero.heading`), `hint`, `error`, `edited` (true or a word: shows the caret + "Edited"), `hideLabel`, `group` (fieldset/legend for radio sets), `aside`. `useFieldControl()` gives custom controls the id/description. |
| `Tabs` / `TabPanel` | Tabs: **`label`**, **`idBase`**, **`items`** `{id,label,count?,quietCount?}[]`, **`value`**, **`onChange(id)`**. TabPanel: **`idBase`**, **`id`**, **`value`**. Arrow keys move and select. |
| `SegmentedControl` | **`label`**, **`options`** `{value,label,title?,disabled?}[]`, **`value`**, **`onChange`**. A radio group (arrow keys). |
| `Tag` | **`children`**, `variant` default·outline·mono, `title`. Neutral metadata. |
| `Badge` | **`children`** (a word — never colour alone), `tone` neutral·insert·delete·change·success·warning·danger·info·accent, `mark` (override; `null` for none). |
| `Count` | **`value`**, `quiet`, `label` (spoken text). The little number pill. |
| `ChangeCount` | `additions`, `deletions`, `changes`, `unit` (singular, "line"). The proof tally ‸4 ꝺ2 with screen-reader words. |
| `ProofMark` | **`kind`** caret·dele·transpose·stet·reg·pilcrow·bang·chevron·send, `tone` insert·delete·change, `label` (otherwise decorative). |
| `Icon` | **`name`** (see `Icon.tsx`: navigation, actions and the six proof marks as SVG), `size`, `label`. 16-unit grid, currentColor. |
| `Kbd` | **`keys`** e.g. `["mod","K"]` — `mod` renders ⌘ or Ctrl. `keyName(key)` for text. |
| `Spinner` | `label` ("Working"). The stet dots. Use for actions; use `Skeleton` for layout-bearing content. |
| `Skeleton` | `width`, `height`, `lines`, `pill`. Visual only — put `aria-busy` on the loading region. |
| `EmptyState` | **`title`** (display face, ends with a full stop), `body` (one sentence), `actions` (one, two at most), `mark` (pilcrow), `compact` (for panes). |
| `ErrorState` | **`title`** ("Couldn't …"), `error` (any thrown value — its plain message and detail are used), `message`, `detail`, `onRetry`, `retryLabel`, `actions`, `compact`. Detail sits behind "Technical details" with Copy. |
| `Dialog` | **`open`**, **`onClose`**, **`title`**, `description`, `children`, `footer` (safe action first), `size` sm·md·lg·xl, `initialFocus` ref, `dismissible` (true), `hideTitle`. Native `<dialog>`: focus trapped and restored, Escape closes. `data-autofocus` on a child focuses it. |
| `ConfirmDialog` | **`open`**, **`onClose`**, **`title`** (the question), **`body`** (what goes, what stays), **`confirmLabel`** (repeat the verb), **`onConfirm`** (may be async; errors show inline), `busyLabel`, `cancelLabel` ("Keep editing"), `tone` danger·primary, `errorTitle`. |
| `Menu` | **`trigger(props)`** (spread props onto a `<button>`), **`items`** (`{id,label,icon?,hint?,onSelect,tone?,disabled?,current?}` · `{kind:"separator",id}` · `{kind:"heading",id,label}`), **`label`**, `placement`. Arrow keys, Home/End, type-ahead. |
| `Popover` | **`open`**, **`onClose`**, **`anchor`** (ref), **`children`**, `placement`, `role`, `aria-label`, `autoFocus`. Outside click / Escape close; Escape returns focus. |
| `Tooltip` | **`content`**, **`children`**, `side`, `decorative` (when it repeats the control's name). Hover after a beat, or keyboard focus at once. |
| `ToastViewport` | `children` (rendered above toasts). Mounted once in `App`. Raise toasts with `notify()` from `@/lib/stores/toasts`. |
| `SplitPane` | **`id`** (persists sizes), **`panes`** `{id,label,size?,min?,max?,collapsible?}[]` (exactly one without `size` flexes), **`children`** (one per pane). Dividers drag, take ←/→ (⇧ for big steps), Home/End, Enter to collapse. Fits itself: shrinks fixed panes, then folds the rightmost into a rail. `usePaneControls(paneId)` → `{collapsed, toggle, label}` for a pane's own hide button. |
| `Breadcrumbs` | **`items`** `{label, to?}[]`; last is the current page. Separator ›. (Screens normally set crumbs through `useTopBar`.) |
| `PageHeader` | **`title`**, `eyebrow`, `description`, `actions`. Head of a full-width screen. |
| `Logo` | `className`. The brand mark in the 20 px slot, or `meta.brand.logoUrl` when set. |
| `cx(...parts)` | Join class names, skipping falsy ones. |
