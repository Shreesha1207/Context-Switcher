/**
 * Common utilities shared across all AI platform extractors.
 * Each extractor sets window.__aiContextBridge with its platform-specific implementation.
 */

// Base adapter that each extractor extends
window.__aiContextBridge = window.__aiContextBridge || {
  platformName: "unknown",

  /**
   * Extract conversation from the current page.
   * @returns {{ role: string, text: string, media?: object[] }[]} Array of messages
   */
  extractConversation() {
    return [];
  },

  /**
   * Get a unique conversation ID from the current URL.
   * @returns {string|null}
   */
  getConversationId() {
    return null;
  },

  /**
   * Generate a title from the conversation (first user message, truncated).
   * @param {{ role: string, text: string }[]} messages
   * @returns {string}
   */
  generateTitle(messages) {
    const firstUserMsg = messages.find(m => m.role === "user");
    if (!firstUserMsg) return "Untitled Conversation";
    const text = firstUserMsg.text.trim();
    // Guard against raw HTML being used as a title
    if (text.startsWith("<") || text.includes("<!DOCTYPE") || text.includes("<html")) {
      return "Untitled Conversation";
    }
    return text.length > 80 ? text.substring(0, 77) + "..." : text;
  },

  // ─── Media Extraction ─────────────────────────────────────────────

  /**
   * Extract media metadata from a DOM element (images, videos, audio, files).
   * Returns metadata only — NOT the actual binary data.
   * @param {Element} element - The message container element to scan
   * @param {string[]} [ignoreSelectors] - CSS selectors for elements to skip (avatars, icons)
   * @returns {{ type: string, alt?: string, filename?: string, width?: number, height?: number, src?: string }[]}
   */
  extractMediaFromElement(element, ignoreSelectors = []) {
    const media = [];
    if (!element) return media;

    // Default ignore: tiny icons, avatars, UI chrome
    const defaultIgnore = [
      'img[width="16"]', 'img[height="16"]',
      'img[width="24"]', 'img[height="24"]',
      'img[width="32"]', 'img[height="32"]',
      '[class*="avatar"] img', '[class*="Avatar"] img',
      '[class*="icon"] img', '[class*="Icon"] img',
      '[class*="logo"] img', '[class*="Logo"] img',
      'button img', 'nav img'
    ];
    const allIgnore = [...defaultIgnore, ...ignoreSelectors];

    // ── Images ──────────────────────────────────────────────────────
    const images = element.querySelectorAll('img');
    for (const img of images) {
      // Skip ignored selectors
      if (allIgnore.some(sel => img.matches(sel) || img.closest(sel.replace(' img', '')))) continue;

      // Skip tiny images (icons, bullets, etc.)
      const w = img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 0;
      const h = img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 0;
      if (w > 0 && w < 48 && h > 0 && h < 48) continue;

      // Skip data-uri placeholders that are very small
      const src = img.src || '';
      if (src.startsWith('data:') && src.length < 200) continue;

      const alt = img.alt || '';
      const filename = this._extractFilenameFromSrc(src) || (alt ? alt.substring(0, 60) : null);

      media.push({
        type: 'image',
        alt: alt || undefined,
        filename: filename || undefined,
        width: w > 0 ? w : undefined,
        height: h > 0 ? h : undefined
      });
    }

    // ── Videos ───────────────────────────────────────────────────────
    const videos = element.querySelectorAll('video');
    for (const video of videos) {
      const src = video.src || video.querySelector('source')?.src || '';
      media.push({
        type: 'video',
        filename: this._extractFilenameFromSrc(src) || undefined
      });
    }

    // ── Audio ────────────────────────────────────────────────────────
    const audios = element.querySelectorAll('audio');
    for (const audio of audios) {
      const src = audio.src || audio.querySelector('source')?.src || '';
      media.push({
        type: 'audio',
        filename: this._extractFilenameFromSrc(src) || undefined
      });
    }

    // ── File upload indicators ───────────────────────────────────────
    // Look for common file attachment UI patterns
    const fileIndicators = element.querySelectorAll(
      '[class*="file"], [class*="File"], [class*="attachment"], [class*="Attachment"], ' +
      '[class*="upload"], [class*="Upload"], [data-testid*="file"]'
    );
    for (const fi of fileIndicators) {
      // Avoid double-counting images already captured
      if (fi.querySelector('img') && media.some(m => m.type === 'image')) continue;

      const fiText = fi.innerText?.trim();
      if (fiText && fiText.length > 0 && fiText.length < 200) {
        // Try to extract filename from the text (e.g., "report.pdf (2.3 MB)")
        const fnMatch = fiText.match(/^([\w\-. ]+\.\w{1,6})/);
        if (fnMatch) {
          const ext = fnMatch[1].split('.').pop().toLowerCase();
          const isMedia = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
          if (!isMedia) { // Images already handled above
            media.push({
              type: 'file',
              filename: fnMatch[1]
            });
          }
        }
      }
    }

    return media;
  },

  /**
   * Format a media item as a text placeholder for context transfer.
   * @param {{ type: string, alt?: string, filename?: string, width?: number, height?: number }} item
   * @returns {string}
   */
  formatMediaPlaceholder(item) {
    const parts = [];
    const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);

    if (item.filename) parts.push(item.filename);
    if (item.alt && item.alt !== item.filename) parts.push(`"${item.alt}"`);
    if (item.width && item.height) parts.push(`${item.width}×${item.height}`);

    return parts.length > 0
      ? `[${typeLabel}: ${parts.join(', ')}]`
      : `[${typeLabel}]`;
  },

  /**
   * Format all media items in a message as placeholder text.
   * @param {{ type: string, alt?: string, filename?: string, width?: number, height?: number }[]} mediaItems
   * @returns {string}
   */
  formatAllMediaPlaceholders(mediaItems) {
    if (!mediaItems || mediaItems.length === 0) return '';
    return mediaItems.map(m => this.formatMediaPlaceholder(m)).join('\n');
  },

  /** @private */
  _extractFilenameFromSrc(src) {
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return null;
    try {
      const url = new URL(src);
      const path = url.pathname;
      const segments = path.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      if (last && last.includes('.') && last.length < 100) return decodeURIComponent(last);
    } catch { }
    return null;
  },

  // ─── Formatting & Tokens ───────────────────────────────────────────

  /**
   * Format messages for copying to clipboard.
   * @param {{ role: string, text: string, media?: object[] }[]} messages
   * @param {string} mode - "smart" | "recent" | "full"
   * @param {number} recentCount - number of recent exchanges for "recent" mode
   * @returns {string}
   */
  formatForCopy(messages, mode = "smart", recentCount = 10) {
    const platform = this.platformName.charAt(0).toUpperCase() + this.platformName.slice(1);
    let formattedMessages = "";

    if (mode === "recent") {
      // Segment into proper exchanges (user + assistant pairs)
      const segments = [];
      let i = 0;
      while (i < messages.length) {
        const seg = { user: null, assistant: null };
        if (messages[i].role === "user") {
          seg.user = messages[i]; i++;
          if (i < messages.length && messages[i].role === "assistant") {
            seg.assistant = messages[i]; i++;
          }
        } else if (messages[i].role === "assistant") {
          seg.assistant = messages[i]; i++;
        } else { i++; }
        segments.push(seg);
      }
      const recentSegs = segments.slice(-recentCount);
      const recentMsgs = [];
      for (const seg of recentSegs) {
        if (seg.user) recentMsgs.push(seg.user);
        if (seg.assistant) recentMsgs.push(seg.assistant);
      }
      formattedMessages = `[RECENT EXCHANGES - last ${recentSegs.length}]\n` +
        recentMsgs
          .map(m => {
            let line = `${m.role.toUpperCase()}: ${m.text}`;
            if (m.media && m.media.length > 0) {
              line += '\n' + this.formatAllMediaPlaceholders(m.media);
            }
            return line;
          })
          .join("\n\n");
    } else {
      // Smart mode: use condenser for intelligent summarization
      if (window.__condenser) {
        const result = window.__condenser.condenseForSmart(messages, recentCount);
        formattedMessages = result.text;
      } else {
        // Fallback if condenser not loaded: include everything
        formattedMessages = messages
          .map(m => {
            let line = `${m.role.toUpperCase()}: ${m.text}`;
            if (m.media && m.media.length > 0) {
              line += '\n' + this.formatAllMediaPlaceholders(m.media);
            }
            return line;
          })
          .join("\n\n");
      }
    }

    return `I am continuing a conversation from ${platform}.\nHere is the relevant context:\n\n${formattedMessages}\n\nPlease continue from where we left off.`;
  },

  /**
   * Estimate token count (rough: ~4 chars per token).
   * Includes media placeholder text in the estimate.
   * @param {{ role: string, text: string, media?: object[] }[]} messages
   * @returns {number}
   */
  estimateTokens(messages) {
    let totalChars = 0;
    for (const m of messages) {
      totalChars += m.text.length;
      if (m.media && m.media.length > 0) {
        totalChars += this.formatAllMediaPlaceholders(m.media).length;
      }
    }
    return Math.ceil(totalChars / 4);
  },

  /**
   * Validate extracted messages and fall back to dynamic.js if broken.
   * A result is "broken" if all messages have the same role.
   */
  validateAndFallback(messages) {
    if (!messages || messages.length < 2) return messages;

    const roles = new Set(messages.map(m => m.role));
    if (roles.size > 1) return messages; // Both roles present — good

    // Only one role found — platform extractor is broken, try dynamic
    if (window.__dynamicExtractor) {
      console.log(`AI Context Bridge: Platform extractor returned only '${[...roles][0]}' messages, falling back to dynamic extractor`);
      const dynamicResult = window.__dynamicExtractor.extract();
      if (dynamicResult && dynamicResult.length > 0) {
        const dynamicRoles = new Set(dynamicResult.map(m => m.role));
        if (dynamicRoles.size > 1) return dynamicResult;
      }
    }

    // Dynamic also failed — return original (better than nothing)
    return messages;
  },

  /**
   * Safe extraction: run platform extractor + validate + fallback.
   */
  safeExtract() {
    const raw = this.extractConversation();
    return this.validateAndFallback(raw);
  }
};

// Listen for messages from background script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extract") {
    const bridge = window.__aiContextBridge;
    const messages = bridge.safeExtract();
    sendResponse({
      conversation: messages,
      platform: bridge.platformName,
      conversationId: bridge.getConversationId(),
      title: bridge.generateTitle(messages),
      messageCount: messages.length,
      estimatedTokens: bridge.estimateTokens(messages)
    });
  }
  return true; // keep message channel open for async
});
