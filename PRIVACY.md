# chat-extract Privacy Policy

_Last updated: 2026-10-14_

chat-extract is a browser extension that exports the ChatGPT or Claude conversation you have open into session files for the Claude Code and Codex command-line tools. This policy explains what the extension touches and where that data goes.

## What the extension reads

When you click **Export** in the extension's popup, and only then, the extension reads the conversation in the active tab:

- On chatgpt.com and chat.openai.com it reads the conversation data the page has already loaded. For conversations that aren't loaded yet, it requests the conversation from ChatGPT's own website, using the session you are already signed in with.
- On claude.ai it requests the open conversation from Claude's own website, using the session you are already signed in with.

These requests go only to the site you are already on, and only for the conversation you have open. The extension never reads other tabs, other conversations, your browsing history, or any page other than the one you exported from.

## What it does with it

The conversation is converted entirely inside your browser and saved to your computer as files in your Downloads folder, using the browser's download feature. Nothing is sent to the developer or to any third party. The extension has no servers, no analytics, no advertising, and no tracking, and it makes no network requests of its own.

## What it stores

The extension remembers a few preferences in the browser's local extension storage so you don't have to re-enter them:

- which export formats are ticked (Claude Code, Codex CLI)
- the project path you last entered
- your default model names for Claude Code and Codex
- the install and resume commands from your last export, and that conversation's title, so they are still there if the popup closes. The next export replaces them, and changing the project path deletes them.
These stay on your device. Removing the extension deletes them.

## Permissions

- **activeTab**: access the tab you are on, only after you click the extension.
- **scripting**: run the conversation reader in that tab.
- **downloads**: save the exported session files.
- **storage**: remember the preferences listed above.

The extension requests no permanent access to any website.

## Contact

Questions about this policy: pulkit.arya.tech@gmail.com, or [open an issue](https://github.com/tickloop/chat-extract/issues).

The full source code is public at https://github.com/tickloop/chat-extract, so you can verify everything above.
