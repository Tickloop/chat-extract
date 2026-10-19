# chat-extract Privacy Policy

_Last updated: 2026-10-19_

chat-extract is a browser extension that exports your ChatGPT or Claude conversations into session files for the Claude Code and Codex command-line tools. This policy explains what the extension touches and where that data goes.

## What the extension reads

The extension reads conversations only when you ask it to, from the ChatGPT or Claude tab you opened it on:

- **Export** reads the conversation open in that tab. On chatgpt.com and chat.openai.com it uses the conversation data the page has already loaded, or requests it from ChatGPT's own website. On claude.ai it requests it from Claude's own website.
- **Export all chats as .zip** lists the conversations in your account on that site, then, when you click its Export button, requests each of them in turn.

Every request goes only to the site you opened the extension on, using the session you are already signed in with. The extension never reads other tabs, other sites, your browsing history, or anything beyond the conversations you chose to export.

## What it does with it

Conversations are converted entirely inside your browser and saved to your computer as files in your Downloads folder (for a bulk export, a single .zip of Markdown and JSONL files), using the browser's download feature. Nothing is sent to the developer or to any third party. The extension has no servers, no analytics, no advertising, and no tracking, and it makes no network requests of its own.

## What it stores

The extension remembers a few preferences in the browser's local extension storage so you don't have to re-enter them:

- which export formats are ticked (Claude Code, Codex CLI)
- the project path you last entered
- your default model names for Claude Code and Codex
- the install and resume commands from your last export, and that conversation's title, so they are still there if the popup closes. The next export replaces them, and changing the project path deletes them.
These stay on your device. Removing the extension deletes them.

## Permissions

- **activeTab**: access the tab you are on, only after you click the extension, and only until that tab is closed or reloaded.
- **scripting**: run the conversation reader in that tab.
- **downloads**: save the exported session files or zip.
- **storage**: remember the preferences listed above.

The extension requests no permanent access to any website.

## Contact

Questions about this policy: pulkit.arya.tech@gmail.com, or [open an issue](https://github.com/tickloop/chat-extract/issues).

The full source code is public at https://github.com/tickloop/chat-extract, so you can verify everything above.
