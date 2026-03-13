/**
 * Dynamic DOM Conversation Extractor
 * 
 * This is the "magic" fallback — when platform-specific selectors break,
 * this analyzer scans the page structure heuristically to find conversations.
 * 
 * How it works:
 * 1. Finds the main conversation container by scoring DOM regions
 * 2. Identifies alternating message blocks (user vs AI)
 * 3. Uses multiple signals: class names, positions, text patterns, styling
 */

window.__dynamicExtractor = {

    // ─── Keywords that hint at roles ────────────────────────────────
    USER_HINTS: [
        'user', 'human', 'you', 'query', 'question', 'prompt', 'request',
        'sender', 'self', 'me', 'input', 'ask'
    ],

    AI_HINTS: [
        'assistant', 'ai', 'bot', 'model', 'response', 'answer', 'reply',
        'gpt', 'claude', 'gemini', 'copilot', 'system', 'agent', 'output'
    ],

    // Class/attribute substrings that often indicate a chat container
    CONTAINER_HINTS: [
        'conversation', 'chat', 'thread', 'messages', 'dialog', 'turns',
        'history', 'transcript', 'exchange', 'log'
    ],

    /**
     * Main entry point — attempt dynamic extraction from the page.
     * @returns {{ role: string, text: string }[]}
     */
    extract() {
        // Step 1: Find the conversation container
        const container = this.findConversationContainer();
        if (!container) return [];

        // Step 2: Find message blocks inside the container
        const messageBlocks = this.findMessageBlocks(container);
        if (messageBlocks.length === 0) return [];

        // Step 3: Classify each block as user or assistant
        const messages = this.classifyMessages(messageBlocks);

        return messages;
    },

    /**
     * Step 1: Find the main conversation area on the page.
     * Scores elements based on how "chat-like" they appear.
     */
    findConversationContainer() {
        const candidates = [];

        // Check all major containers
        const allContainers = document.querySelectorAll(
            'main, [role="main"], [role="log"], [role="feed"], ' +
            'section, article, div'
        );

        for (const el of allContainers) {
            // Skip tiny or hidden elements
            if (el.offsetHeight < 100 || el.offsetWidth < 200) continue;
            if (getComputedStyle(el).display === 'none') continue;

            let score = 0;

            // Score by class/id names
            const identifier = ((el.className || '') + ' ' + (el.id || '')).toLowerCase();
            for (const hint of this.CONTAINER_HINTS) {
                if (identifier.includes(hint)) score += 10;
            }

            // Score by ARIA role
            const role = el.getAttribute('role');
            if (role === 'log' || role === 'feed') score += 15;

            // Score by having multiple similar direct children (chat = repeated blocks)
            const childTags = {};
            for (const child of el.children) {
                const key = child.tagName + '.' + (child.className || '').split(' ')[0];
                childTags[key] = (childTags[key] || 0) + 1;
            }
            const maxRepeats = Math.max(0, ...Object.values(childTags));
            if (maxRepeats >= 3) score += maxRepeats * 2;

            // Score by having text content with alternating patterns
            const childTexts = Array.from(el.children)
                .map(c => c.innerText?.trim().length || 0)
                .filter(len => len > 10);
            if (childTexts.length >= 4) score += 8;

            // Score by scroll height (long scrollable area = likely chat)
            if (el.scrollHeight > el.clientHeight * 1.5) score += 5;

            // Penalize elements that are too broad (like body or html)
            if (el.tagName === 'BODY' || el.tagName === 'HTML') score -= 50;
            if (el.children.length > 100) score -= 10;

            if (score > 5) {
                candidates.push({ element: el, score });
            }
        }

        // Return highest scoring container
        candidates.sort((a, b) => b.score - a.score);
        return candidates.length > 0 ? candidates[0].element : document.querySelector('main') || document.body;
    },

    /**
     * Step 2: Find individual message blocks within the container.
     * Looks for repeated sibling elements that represent individual messages.
     */
    findMessageBlocks(container) {
        const blocks = [];

        // Strategy A: Find children with role hints in class/attributes
        const hintedChildren = container.querySelectorAll(
            '[class*="message"], [class*="Message"], ' +
            '[class*="turn"], [class*="Turn"], ' +
            '[class*="response"], [class*="query"], ' +
            '[data-role], [data-message-author-role], [data-testid*="message"]'
        );

        if (hintedChildren.length >= 2) {
            hintedChildren.forEach(el => {
                const text = el.innerText?.trim();
                if (text && text.length > 1) {
                    blocks.push(el);
                }
            });

            // Deduplicate: remove children that are contained in other blocks
            return this.deduplicateNested(blocks);
        }

        // Strategy B: Find groups of similar siblings (common in chat UIs)
        const childGroups = this.findRepeatedSiblingGroups(container);
        if (childGroups.length >= 2) {
            return childGroups;
        }

        // Strategy C: Just take all direct children with substantial text
        const directChildren = Array.from(container.children).filter(el => {
            const text = el.innerText?.trim();
            return text && text.length > 5 && el.offsetHeight > 20;
        });

        if (directChildren.length >= 2) {
            return directChildren;
        }

        return [];
    },

    /**
     * Find groups of repeated sibling elements (e.g., all divs with same class pattern).
     */
    findRepeatedSiblingGroups(container) {
        const groups = new Map();

        for (const child of container.children) {
            // Create a "signature" for this element
            const sig = child.tagName + ':' +
                Array.from(child.classList).sort().join(',');

            if (!groups.has(sig)) groups.set(sig, []);

            const text = child.innerText?.trim();
            if (text && text.length > 5) {
                groups.get(sig).push(child);
            }
        }

        // Return the largest group (most repeated pattern = likely messages)
        let bestGroup = [];
        for (const [, group] of groups) {
            if (group.length > bestGroup.length) {
                bestGroup = group;
            }
        }

        return bestGroup;
    },

    /**
     * Step 3: Classify message blocks as user or assistant.
     * Uses multiple signals: class names, data attributes, text characteristics.
     */
    classifyMessages(blocks) {
        const messages = [];
        const bridge = window.__aiContextBridge;

        for (const block of blocks) {
            const text = block.innerText?.trim();
            if (!text || text.length < 2) continue;

            const role = this.classifyRole(block, text);
            const msg = { role, text };

            // Extract media if bridge is available
            if (bridge && bridge.extractMediaFromElement) {
                const media = bridge.extractMediaFromElement(block);
                if (media.length > 0) msg.media = media;
            }

            messages.push(msg);
        }

        // Validate: if all messages have the same role, assume alternating
        const roles = messages.map(m => m.role);
        const uniqueRoles = new Set(roles);
        if (uniqueRoles.size === 1 && messages.length >= 2) {
            // Fallback to alternating pattern
            messages.forEach((m, i) => {
                m.role = i % 2 === 0 ? 'user' : 'assistant';
            });
        }

        return messages;
    },

    /**
     * Classify a single message block as user or assistant.
     */
    classifyRole(element, text) {
        let userScore = 0;
        let aiScore = 0;

        // Signal 1: Check class names and data attributes
        const attrs = (
            (element.className || '') + ' ' +
            (element.id || '') + ' ' +
            (element.getAttribute('data-role') || '') + ' ' +
            (element.getAttribute('data-message-author-role') || '') + ' ' +
            (element.getAttribute('data-testid') || '') + ' ' +
            (element.getAttribute('data-type') || '')
        ).toLowerCase();

        for (const hint of this.USER_HINTS) {
            if (attrs.includes(hint)) userScore += 5;
        }
        for (const hint of this.AI_HINTS) {
            if (attrs.includes(hint)) aiScore += 5;
        }

        // Signal 2: Check parent element attributes too
        const parent = element.parentElement;
        if (parent) {
            const parentAttrs = (
                (parent.className || '') + ' ' +
                (parent.getAttribute('data-role') || '') + ' ' +
                (parent.getAttribute('data-testid') || '')
            ).toLowerCase();

            for (const hint of this.USER_HINTS) {
                if (parentAttrs.includes(hint)) userScore += 3;
            }
            for (const hint of this.AI_HINTS) {
                if (parentAttrs.includes(hint)) aiScore += 3;
            }
        }

        // Signal 3: Text length heuristic (AI responses tend to be longer)
        if (text.length > 500) aiScore += 2;
        if (text.length < 100) userScore += 1;

        // Signal 4: Markdown/formatting (AI responses often have formatted content)
        const hasCodeBlocks = element.querySelector('pre, code') !== null;
        const hasLists = element.querySelector('ul, ol') !== null;
        const hasHeadings = element.querySelector('h1, h2, h3, h4') !== null;
        if (hasCodeBlocks || hasLists || hasHeadings) aiScore += 3;

        // Signal 5: Avatar/icon presence (many UIs show different avatars)
        const imgs = element.querySelectorAll('img, svg');
        // This is just a tiebreaker, not reliable enough to be primary

        if (userScore > aiScore) return 'user';
        if (aiScore > userScore) return 'assistant';

        // Default: check position (first message is usually from user)
        return 'user';
    },

    /**
     * Remove elements that are nested inside other elements in the list.
     */
    deduplicateNested(elements) {
        const result = [];
        for (const el of elements) {
            const isNested = elements.some(other =>
                other !== el && other.contains(el)
            );
            if (!isNested) {
                result.push(el);
            }
        }
        return result;
    }
};
