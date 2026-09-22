# Third-party sources and compatibility

The resolved dependency graph and integrity hashes are pinned in `package-lock.json`.
Installed packages retain their upstream license files. No Claude Code Desktop or Codex App source is included.

| Source | Fixed version / source | License | Use and adaptation |
| --- | --- | --- | --- |
| [Pi Coding Agent](https://github.com/earendil-works/pi) | 0.87.0; upstream `16787ad5b2dc748047f314ca1bfe7708f30f54f3` | MIT | Unmodified npm CLI; one JSONL RPC child per active session. Framing/client written here from documented protocol, not copied source. |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | CLI 4.21.0; registry radix-nova fetched 2026-09-22, upstream `98a1fe67b439324ddc857f47fbdce056600a4329` | MIT | Generated button, field, input, textarea, alert, badge, empty, label, separator source. Local source and lockfile preserve the exact imported snapshot. |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | @assistant-ui/react 0.15.21 | MIT | External-store conversation primitives; Pi remains state and execution authority. |
| [Radix UI](https://github.com/radix-ui/primitives) | radix-ui 1.6.7 | MIT | Accessible UI primitives. |
| [Lucide](https://github.com/lucide-icons/lucide) | lucide-react 1.47.0 | ISC | Icons. |
| [React](https://github.com/facebook/react) | 19.3.0 | MIT | Renderer. |
| [Electron](https://github.com/electron/electron) | 44.4.3 | MIT; Chromium third-party notices included by distribution | Desktop host and isolated renderer. |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | 4.3.3 | MIT | Semantic visual tokens and utilities. |
| [cn](https://www.npmjs.com/package/cn) | 0.3.2 | MIT | Registry-generated class composition helper. |
| [class-variance-authority](https://github.com/joe-bell/cva) | 0.7.1 | Apache-2.0 | Registry component variants. |
| [clsx](https://github.com/lukeed/clsx) / [tailwind-merge](https://github.com/dcastil/tailwind-merge) | 2.1.1 / 3.7.0 | MIT | Application class composition. |

ZCode, Claude Code Desktop and Codex App are interaction references only in this change. Subsequent source adaptations must add their source, version, license and modification boundary here.

## shadcn/ui copied-source license

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
