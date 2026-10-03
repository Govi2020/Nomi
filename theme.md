# Nomi color themes

Nomi's settings offer seven color choices: the existing **Light** and **Dark** appearances, plus five named palettes designed for a quiet writing space. Each palette keeps the same navigation, reading hierarchy, and semantic status colors while changing the paper, raised surfaces, text, separators, and accent roles. The selection is saved in this browser under `memory-theme`.

## Palette choices

| Theme | Appearance | Canvas | Surface | Raised surface | Primary text | Accent | Supporting color |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Light | Light | `#f4f4ef` | `#ffffff` | `#eceee7` | `#30362e` | `#65765d` | `#947047` |
| Dark | Dark | `#191c18` | `#20241f` | `#262b24` | `#e8e9df` | `#8b9a81` | `#c7a77c` |
| Storybook Harvest | Light | `#fff9e8` | `#fffdf7` | `#f7edcf` | `#263238` | `#335c67` | `#e09f3e` |
| Moss & Paper | Light | `#f1f3e8` | `#fcfcf5` | `#e5eadc` | `#29382f` | `#3f624d` | `#b78048` |
| Clay Journal | Light | `#f6eee8` | `#fffaf6` | `#efe1d7` | `#382b29` | `#87483d` | `#b97856` |
| Blue Hour | Dark | `#15262c` | `#1d3037` | `#263e46` | `#e4efee` | `#7bb6ba` | `#d7a575` |
| Plum Evening | Dark | `#251e2b` | `#302736` | `#403348` | `#f2eaf0` | `#d397b2` | `#d8aa77` |

## Storybook Harvest source colors

Storybook Harvest uses the supplied [Coolors palette](https://coolors.co/palette/335c67-fff3b0-e09f3e-9e2a2b-540b0e):

| Color | Hex | Intended role |
| --- | --- | --- |
| Deep teal | `#335c67` | Main action and selection |
| Butter yellow | `#fff3b0` | Warm highlight and atmosphere |
| Marigold | `#e09f3e` | Secondary emphasis |
| Brick red | `#9e2a2b` | Supporting accent |
| Berry ink | `#540b0e` | Deep contrast accent |

The page canvas and elevated surfaces are softened versions of the source palette so long-form diary text remains easy to read. Teal carries the main interactive role, while marigold and berry stay occasional accents.

## Shared semantic roles

- **Canvas** is the page background; **surface** is a sidebar, editor, or content panel; **raised surface** identifies a selected or nested area.
- **Primary text** carries titles and body copy. Muted and quiet text use related hues with enough contrast for supporting information.
- **Accent** marks primary controls, focus rings, current navigation, and selection. **Supporting color** is reserved for secondary emphasis.
- Error, deletion, and success states keep their separate meanings instead of inheriting decorative theme colors.

The five additional palettes are implemented as semantic CSS tokens in `frontend/src/theme.ts` and palette-specific surface rules in `frontend/src/styles.css`. The settings picker is in `frontend/src/features/support/SupportPage.tsx`.
