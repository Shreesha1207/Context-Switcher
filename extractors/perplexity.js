/**
 * Perplexity Conversation Extractor
 * Works on: perplexity.ai
 */

(function () {
    const bridge = window.__aiContextBridge;
    if (!bridge) return;

    bridge.platformName = "perplexity";

    bridge.extractConversation = function () {
        const messages = [];

        // Strategy 1: Perplexity uses query/answer block structure
        // User queries and AI answers are in alternating blocks
        const queryBlocks = document.querySelectorAll(
            "[class*='query'], [class*='Query'], [data-testid*='query']"
        );
        const answerBlocks = document.querySelectorAll(
            "[class*='answer'], [class*='Answer'], [data-testid*='answer'], " +
            ".prose, [class*='response']"
        );

        if (queryBlocks.length > 0) {
            const allBlocks = [];

            queryBlocks.forEach(el => {
                // Get just the query text, not child answer elements
                const textEl = el.querySelector("textarea, [contenteditable], span, p") || el;
                const text = textEl.innerText.trim();
                if (text) {
                    const msg = { role: "user", text, element: el };
                    const media = bridge.extractMediaFromElement(el);
                    if (media.length > 0) msg.media = media;
                    allBlocks.push(msg);
                }
            });

            answerBlocks.forEach(el => {
                // Skip if this is inside a query block
                if (el.closest("[class*='query'], [class*='Query']")) return;

                const text = el.innerText.trim();
                if (text && text.length > 10) {
                    const msg = { role: "assistant", text, element: el };
                    const media = bridge.extractMediaFromElement(el);
                    if (media.length > 0) msg.media = media;
                    allBlocks.push(msg);
                }
            });

            // Sort by DOM position
            allBlocks.sort((a, b) => {
                const pos = a.element.compareDocumentPosition(b.element);
                return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
            });

            allBlocks.forEach(m => {
                const msg = { role: m.role, text: m.text };
                if (m.media) msg.media = m.media;
                messages.push(msg);
            });
        }

        // Strategy 2: Look for thread/search result structure
        if (messages.length === 0) {
            const threadItems = document.querySelectorAll(
                "[class*='thread-item'], [class*='ThreadItem'], [class*='search-result']"
            );

            threadItems.forEach(item => {
                // Each thread item typically has a question and answer
                const questionEl = item.querySelector(
                    "[class*='question'], [class*='query'], h2, h3"
                );
                const answerEl = item.querySelector(
                    "[class*='answer'], [class*='prose'], .markdown"
                );

                if (questionEl) {
                    const text = questionEl.innerText.trim();
                    if (text) messages.push({ role: "user", text });
                }
                if (answerEl) {
                    const text = answerEl.innerText.trim();
                    if (text) messages.push({ role: "assistant", text });
                }
            });
        }

        // Strategy 3: Fallback — grab all visible text blocks in order
        if (messages.length === 0) {
            const containers = document.querySelectorAll(
                "main [class*='message'], main [class*='Message']"
            );
            let isUser = true;
            containers.forEach(el => {
                const text = el.innerText.trim();
                if (text && text.length > 5) {
                    messages.push({ role: isUser ? "user" : "assistant", text });
                    isUser = !isUser;
                }
            });
        }

        // Final fallback: dynamic heuristic extraction
        if (messages.length === 0 && window.__dynamicExtractor) {
            console.log("AI Context Bridge: Using dynamic extractor for Perplexity");
            return window.__dynamicExtractor.extract();
        }

        return messages;
    };

    bridge.getConversationId = function () {
        // URL patterns: perplexity.ai/search/<id> or /thread/<id>
        const match = window.location.pathname.match(
            /\/search\/([a-zA-Z0-9-]+)|\/thread\/([a-zA-Z0-9-]+)/
        );
        return match ? (match[1] || match[2]) : null;
    };
})();
