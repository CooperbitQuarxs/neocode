# NeoCode

NeoCode is NeoPi's graphical frontend, built from upstream [T3 Code](https://github.com/pingdotgg/t3code). NeoPi is the primary harness, enabled by default and listed first; explicit saved provider and model choices remain authoritative.

Other harnesses remain available, including Claude Code, Codex, Cursor, Grok Build, OpenCode and Antigravity. NeoCode keeps upstream attribution and compatibility without adopting T3 Code's product identity.

## Upstream

T3 Code provides the foundation for the web, desktop and mobile clients. Its authors retain their copyright and attribution; NeoCode develops as a distinct open-source project centered on NeoPi.

## Installation

Download [NeoCode releases](https://github.com/PsychedelicShayna/neocode/releases), then follow [Install and first run](docs/user/install.md) for platform details and provider setup. For a source checkout, use the [development guide](docs/operations/development.md).

Fresh installations enable only NeoPi. Other supported harnesses remain available in Settings, and existing enabled harnesses stay enabled. Upstream T3 Code installers and package-manager entries install upstream T3 Code, not this fork.

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run the server as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

NeoCode uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

File NeoCode bugs and feature requests in [this fork's issue tracker](https://github.com/PsychedelicShayna/neocode/issues).
