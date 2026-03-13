# Context-switching-web-plug-in

**AI Context Bridge** is a browser extension that lets you **capture a full conversation from one AI chatbot** and **continue it on another** by generating a portable, copy‑ready summary.

> ⚠️ **Important:** This is a browser extension. You must load it into your browser (as an unpacked/temporary extension) before it will work.

## 🧰 Setup (load the extension)

1. Download the project as a zip file and extract the files onto your system.
2. Open Chrome/Edge and go to `chrome://extensions/` (or `edge://extensions/`).
3. Enable **Developer mode** (toggle at top-right).
4. Click **Load unpacked** and select this repository folder.
5. Confirm the extension appears as **AI Context Bridge** and is enabled.

---

## 🚀 What this does

- 🧠 **Captures** the full chat conversation from a supported AI chatbot page.
- ✂️ **Condenses** it into a clean summary (or recent exchanges) that preserves context.
- 📋 **Copies** the result to your clipboard so you can paste it into another AI chatbot and continue seamlessly.

---

## ✅ Supported platforms (sites)

This extension works on the following sites (as defined in `manifest.json`):

- `chat.openai.com` / `chatgpt.com`
- `gemini.google.com`
- `claude.ai`
- `copilot.microsoft.com`
- `www.perplexity.ai`

---

## 🧩 How to use

### 1) Open a supported chatbot
Go to any supported AI chat page and make sure the conversation you want to transfer is visible.

### 2) Capture the current conversation
1. Click the extension icon in your browser toolbar.
2. Click **"Capture Current Conversation"**.

The extension will read the chat history from the page and store it locally.

### 3) Pick a saved conversation
The popup lists captured conversations (with counts).

### 4) Transfer context to another AI
1. Select a saved conversation.
2. Choose the transfer mode:
   - **Smart Summary** (default): creates a condensed, context‑preserving summary.
   - **Recent Only**: copies the last N exchanges verbatim.
3. Click **"Copy to Clipboard"**.
4. Paste into the message box of another AI chatbot to continue the conversation.

---

## 🛠️ How it works (internals)

- Each supported site has a specific extractor script (in `extractors/`) that reads the conversation content from the page.
- The popup logic (in `popup.js`) then:
  - removes boilerplate / trivial messages
  - extracts key sentences and summaries
  - truncates long code blocks when needed
  - estimates token count for the generated output

---

## 📝 Notes & tips

- If a capture returns nothing, make sure you are on a supported URL and the chat is fully loaded.
- Use **Recent Only** when you only need the latest messages and not the full history.
- The extension stores conversations locally (browser storage), so they remain available until you clear them.

---

## 📦 Files of interest

- `manifest.json` — extension settings & supported domains
- `popup.html / popup.js` — UI and transfer logic
- `extractors/` — per-platform conversation scraping logic

