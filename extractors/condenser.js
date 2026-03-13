/**
 * Conversation Condenser for AI Context Bridge.
 * 
 * Intelligently condenses ENTIRE conversations — not just trimming,
 * but analyzing and summarizing the full context.
 * 
 * Strategy:
 * - Text-heavy: summarize each exchange into key points, preserve decisions
 * - Code-heavy: summarize prose, skip old code iterations, keep latest 2-3 code blocks
 */

window.__condenser = {

    // ─── Configuration ─────────────────────────────────────────────
    MAX_PROSE_CHARS: 200,
    LATEST_CODE_COUNT: 2,
    CODE_HEAVY_THRESHOLD: 0.4,
    // How many recent exchanges to keep in full (lightly condensed)
    RECENT_FULL_COUNT: 3,
    MAX_CODE_LINES: 15,
    MAX_TOPIC_CHARS: 200,

    // ─── Code Detection ────────────────────────────────────────────

    CODE_FENCE_REGEX: /```[\s\S]*?```/g,

    hasCodeBlocks(text) {
        return /```[\s\S]*?```/.test(text);
    },

    isCodeHeavy(messages) {
        if (messages.length === 0) return false;
        const codeCount = messages.filter(m => /```[\s\S]*?```/.test(m.text)).length;
        return (codeCount / messages.length) >= this.CODE_HEAVY_THRESHOLD;
    },

    // ─── Code Block Utilities ──────────────────────────────────────

    extractCodeBlocks(text) {
        const blocks = [];
        const regex = /```(\w*)\n?([\s\S]*?)```/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            blocks.push({
                lang: match[1] || "",
                code: match[2].trim(),
                full: match[0]
            });
        }
        return blocks;
    },

    removeCodeBlocks(text) {
        return text.replace(/```[\s\S]*?```/g, "").trim();
    },

    truncateCodeBlock(code, maxLines) {
        const lines = code.split("\n");
        if (lines.length <= maxLines) return code;
        const kept = lines.slice(0, maxLines);
        return kept.join("\n") + `\n// ... (${lines.length - maxLines} more lines trimmed)`;
    },

    formatMediaPlaceholder(item) {
        const parts = [];
        const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
        if (item.filename) parts.push(item.filename);
        if (item.alt && item.alt !== item.filename) parts.push(`"${item.alt}"`);
        if (item.width && item.height) parts.push(`${item.width}×${item.height}`);
        return parts.length > 0 ? `[${typeLabel}: ${parts.join(', ')}]` : `[${typeLabel}]`;
    },

    formatAllMediaPlaceholders(mediaItems) {
        if (!mediaItems || mediaItems.length === 0) return '';
        return mediaItems.map(m => this.formatMediaPlaceholder(m)).join('\n');
    },

    // Boilerplate phrases AI assistants pad their responses with
    BOILERPLATE_PATTERNS: [
        /^(sure|of course|absolutely|great question|certainly|no problem|happy to help)[!.,]?\s*/i,
        /^(here'?s?|let me|i'?ll|i can|i will|i would|allow me to)\s+(show|explain|help|provide|give|walk|break|update|fix|create)/i,
        /^(okay|ok|alright|right)[!.,]?\s*/i,
        /let me know if you (need|have|want|require) .{0,30}$/i,
        /hope this helps[!.]?$/i,
        /feel free to (ask|reach|let me know).{0,40}$/i,
        /is there anything else .{0,40}$/i,
        /don'?t hesitate to .{0,40}$/i
    ],

    TRIVIAL_PATTERNS: [
        /^(thanks|thank you|thx|ty|cheers|appreciated)[!.]*$/i,
        /^(got it|understood|noted)[!.]*$/i,
        /^you'?re welcome[!.]*$/i,
        /^glad (to|i could) help[!.]*$/i,
        /^(good luck|best of luck)[!.]*$/i
    ],

    stripBoilerplate(text) {
        let cleaned = text;
        for (const pattern of this.BOILERPLATE_PATTERNS) {
            cleaned = cleaned.replace(pattern, '');
        }
        return cleaned.trim();
    },

    stripMarkdownFormatting(text) {
        return text
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .replace(/__(.+?)__/g, '$1')
            .replace(/_(.+?)_/g, '$1')
            .replace(/~~(.+?)~~/g, '$1')
            .replace(/^[\s]*[-*+]\s+/gm, '• ')
            .replace(/^\d+\.\s+/gm, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/^>\s+/gm, '');
    },

    isTrivialMessage(text) {
        const trimmed = text.trim();
        if (trimmed.length > 80) return false;
        return this.TRIVIAL_PATTERNS.some(p => p.test(trimmed));
    },

    // ─── Text Summarization Utilities ──────────────────────────────

    /**
     * Truncate text preserving sentence boundaries.
     */
    truncateText(text, maxChars) {
        if (text.length <= maxChars) return text;
        const truncated = text.substring(0, maxChars);
        const lastPeriod = truncated.lastIndexOf(".");
        const lastNewline = truncated.lastIndexOf("\n");
        const cutPoint = Math.max(lastPeriod, lastNewline);
        if (cutPoint > maxChars * 0.5) {
            return truncated.substring(0, cutPoint + 1).trim();
        }
        return truncated.trim() + "...";
    },

    /**
     * Extract the most important parts of a text:
     * - First sentence (sets context)
     * - Any sentences with decision/conclusion keywords
     * - Last sentence (usually the answer/conclusion)
     */
    extractKeySentences(text, maxChars = 200) {
        if (text.length <= maxChars) return text;

        // Split into sentences (rough but effective)
        const sentences = text
            .replace(/\n+/g, ". ")
            .split(/(?<=[.!?])\s+/)
            .map(s => s.trim())
            .filter(s => s.length > 5);

        if (sentences.length === 0) return this.truncateText(text, maxChars);
        if (sentences.length <= 2) return sentences.join(" ");

        const DECISION_KEYWORDS = [
            "should", "need to", "must", "decided", "solution", "fix",
            "issue", "problem", "error", "because", "instead", "better",
            "recommend", "approach", "implement", "use ", "change",
            "update", "add ", "remove", "create", "configure", "install",
            "the key", "important", "note that", "make sure", "however",
            "resolved", "working", "fixed", "correct", "wrong"
        ];

        const scored = sentences.map((s, i) => {
            let score = 0;
            const lower = s.toLowerCase();

            // First sentence gets a boost (introduces the topic)
            if (i === 0) score += 3;
            // Last sentence gets a boost (usually the conclusion)
            if (i === sentences.length - 1) score += 2;

            // Score for decision/conclusion keywords
            for (const kw of DECISION_KEYWORDS) {
                if (lower.includes(kw)) score += 1;
            }

            // Penalize very short filler sentences
            if (s.length < 20) score -= 2;

            return { sentence: s, score, index: i };
        });

        // Sort by score, pick the top sentences
        scored.sort((a, b) => b.score - a.score);

        const selected = [];
        let charCount = 0;
        const pickedIndices = new Set();

        for (const item of scored) {
            if (charCount + item.sentence.length > maxChars) break;
            selected.push(item);
            pickedIndices.add(item.index);
            charCount += item.sentence.length;
        }

        // Re-sort by original position to maintain flow
        selected.sort((a, b) => a.index - b.index);
        return selected.map(s => s.sentence).join(" ");
    },

    /**
     * Summarize a user message into a brief directive.
     */
    summarizeUserMessage(text) {
        const prose = this.removeCodeBlocks(text).trim();
        if (!prose) {
            // Message is entirely code
            const blocks = this.extractCodeBlocks(text);
            if (blocks.length > 0) {
                const lang = blocks[0].lang ? ` (${blocks[0].lang})` : "";
                return `[shared code${lang}, ${blocks[0].code.split("\n").length} lines]`;
            }
            return null;
        }
        if (prose.length <= 120) return prose;
        return this.extractKeySentences(prose, 120);
    },

    /**
     * Summarize an assistant message into key takeaways.
     */
    summarizeAssistantMessage(text) {
        const prose = this.stripMarkdownFormatting(this.stripBoilerplate(this.removeCodeBlocks(text))).trim();
        const blocks = this.extractCodeBlocks(text);

        if (!prose && blocks.length === 0) return null;

        let summary = "";

        if (prose) {
            summary = this.extractKeySentences(prose, 200);
        }

        // Mention code blocks without including them
        if (blocks.length > 0) {
            const codeNote = blocks.map(b => {
                const lang = b.lang || "code";
                const lines = b.code.split("\n").length;
                return `${lang} (${lines} lines)`;
            }).join(", ");
            summary += summary ? ` [Provided: ${codeNote}]` : `[Provided: ${codeNote}]`;
        }

        return summary || null;
    },

    // ─── Conversation Segmentation ────────────────────────────────

    /**
     * Group messages into logical exchange pairs (user + assistant).
     * Each segment represents one Q&A turn.
     */
    segmentConversation(messages) {
        const segments = [];
        let i = 0;

        while (i < messages.length) {
            const segment = { user: null, assistant: null };

            if (messages[i].role === "user") {
                segment.user = messages[i];
                i++;
                if (i < messages.length && messages[i].role === "assistant") {
                    segment.assistant = messages[i];
                    i++;
                }
            } else if (messages[i].role === "assistant") {
                segment.assistant = messages[i];
                i++;
            } else {
                i++;
            }

            segments.push(segment);
        }

        return segments;
    },

    /**
     * Get the last N code blocks across all messages (chronological).
     */
    getLatestCodeBlocks(messages, count) {
        const allBlocks = [];
        for (const msg of messages) {
            const blocks = this.extractCodeBlocks(msg.text);
            for (const block of blocks) {
                allBlocks.push({
                    role: msg.role,
                    lang: block.lang,
                    code: block.code
                });
            }
        }
        return allBlocks.slice(-count);
    },

    // ─── Main Entry Point ──────────────────────────────────────────

    /**
     * Condense an ENTIRE conversation for Smart copy mode.
     * Processes all messages, not just first + last.
     * 
     * @param {{ role: string, text: string }[]} messages
     * @param {number} recentCount - number of recent exchanges to keep in full
     * @returns {{ text: string, tokenEstimate: number, messageCount: number }}
     */
    condenseForSmart(messages, recentCount) {
        if (!messages || messages.length === 0) {
            return { text: "", tokenEstimate: 0, messageCount: 0 };
        }

        // Use provided recentCount or default
        const recentExchanges = recentCount || this.RECENT_FULL_COUNT;
        const recentMsgCount = recentExchanges * 2;
        const maxCodeLines = this.MAX_CODE_LINES;

        // Short conversations: still condense code blocks
        if (messages.length <= recentMsgCount + 4) {
            const formatted = messages
                .map(m => {
                    let text = m.text;
                    if (m.role === 'assistant') {
                        text = this.stripMarkdownFormatting(this.stripBoilerplate(text));
                    }
                    const blocks = this.extractCodeBlocks(text);
                    if (blocks.length > 0) {
                        for (const b of blocks) {
                            const truncated = this.truncateCodeBlock(b.code, maxCodeLines);
                            text = text.replace(b.full, "```" + b.lang + "\n" + truncated + "\n```");
                        }
                    }
                    return `${m.role.toUpperCase()}: ${text}`;
                })
                .join("\n\n");
            return {
                text: formatted,
                tokenEstimate: Math.ceil(formatted.length / 4),
                messageCount: messages.length
            };
        }

        const isCodeConvo = this.isCodeHeavy(messages);
        const segments = this.segmentConversation(messages);
        const totalSegments = segments.length;
        const recentSegmentStart = Math.max(0, totalSegments - recentExchanges);

        const parts = [];

        // ── Section 1: Topic (strip code, summarize concisely) ─────
        const firstUserMsg = messages.find(m => m.role === "user");
        if (firstUserMsg) {
            const prose = this.removeCodeBlocks(firstUserMsg.text).trim();
            const codeBlocks = this.extractCodeBlocks(firstUserMsg.text);
            let topicText = prose.length > this.MAX_TOPIC_CHARS
                ? this.truncateText(prose, this.MAX_TOPIC_CHARS)
                : prose;
            if (codeBlocks.length > 0 && !topicText) {
                const lang = codeBlocks[0].lang ? ` (${codeBlocks[0].lang})` : "";
                topicText = `[shared code${lang}, ${codeBlocks[0].code.split("\n").length} lines]`;
            } else if (codeBlocks.length > 0) {
                topicText += ` [+${codeBlocks.length} code block(s)]`;
            }
            let topicLine = "[TOPIC]\nUSER: " + topicText;
            if (firstUserMsg.media && firstUserMsg.media.length > 0) {
                topicLine += '\n' + this.formatAllMediaPlaceholders(firstUserMsg.media);
            }
            parts.push(topicLine);
        }

        // ── Section 2: Full conversation summary ──────────────────
        // Process ALL middle segments (not just skip them!)
        const middleSegments = segments.slice(1, recentSegmentStart);

        if (middleSegments.length > 0) {
            const summaryLines = [];

            for (let i = 0; i < middleSegments.length; i++) {
                const seg = middleSegments[i];

                // Skip only if BOTH user AND assistant messages are trivial
                const userTrivial = seg.user && this.isTrivialMessage(seg.user.text);
                const assistantTrivial = seg.assistant && this.isTrivialMessage(seg.assistant.text);
                if (userTrivial && (!seg.assistant || assistantTrivial)) continue;
                if (!seg.user && assistantTrivial) continue;

                // Summarize user's question/request
                if (seg.user) {
                    const userSummary = this.summarizeUserMessage(seg.user.text);
                    if (userSummary) {
                        let line = "→ " + userSummary;
                        if (seg.user.media && seg.user.media.length > 0) {
                            line += ' ' + seg.user.media.map(m => this.formatMediaPlaceholder(m)).join(' ');
                        }
                        summaryLines.push(line);
                    }
                }

                // Summarize assistant's response
                if (seg.assistant) {
                    const assistantSummary = this.summarizeAssistantMessage(seg.assistant.text);
                    if (assistantSummary) {
                        let line = "  ↳ " + assistantSummary;
                        if (seg.assistant.media && seg.assistant.media.length > 0) {
                            line += ' ' + seg.assistant.media.map(m => this.formatMediaPlaceholder(m)).join(' ');
                        }
                        summaryLines.push(line);
                    }
                }
            }

            if (summaryLines.length > 0) {
                parts.push(
                    `[CONVERSATION SUMMARY - ${middleSegments.length} exchanges condensed]\n` +
                    summaryLines.join("\n")
                );
            }
        }

        // ── Section 3: Latest code state (code-heavy only) ────────
        if (isCodeConvo) {
            // Get latest code blocks from the NON-recent part
            const nonRecentMessages = messages.slice(0, -recentMsgCount);
            const allBlocks = [];
            for (const msg of nonRecentMessages) {
                for (const block of this.extractCodeBlocks(msg.text)) {
                    allBlocks.push({ role: msg.role, lang: block.lang, code: block.code });
                }
            }
            // Deduplicate by language: keep only the LAST block per language
            const byLang = new Map();
            for (const block of allBlocks) {
                const key = block.lang || 'unknown';
                byLang.set(key, block);
            }
            const dedupedBlocks = Array.from(byLang.values()).slice(-this.LATEST_CODE_COUNT);

            if (dedupedBlocks.length > 0) {
                parts.push("[LATEST CODE STATE]");
                for (const block of dedupedBlocks) {
                    const langLabel = block.lang ? ` (${block.lang})` : "";
                    const truncatedCode = this.truncateCodeBlock(block.code, maxCodeLines);
                    parts.push(
                        `${block.role.toUpperCase()}${langLabel}:\n` +
                        "```" + block.lang + "\n" + truncatedCode + "\n```"
                    );
                }
            }
        }

        // ── Section 4: Recent exchanges (condense both roles) ─────
        const recentMsgs = messages.slice(-recentMsgCount);
        parts.push(
            `[RECENT EXCHANGES - last ${recentExchanges} of ${totalSegments} total]`
        );

        for (const msg of recentMsgs) {
            const codeBlocks = this.extractCodeBlocks(msg.text);
            const prose = this.removeCodeBlocks(msg.text).trim();

            if (msg.role === "assistant" && msg.text.length > this.MAX_PROSE_CHARS * 2) {
                let condensed = this.stripMarkdownFormatting(this.stripBoilerplate(prose));
                condensed = condensed.length > this.MAX_PROSE_CHARS
                    ? this.extractKeySentences(condensed, this.MAX_PROSE_CHARS)
                    : condensed;
                if (codeBlocks.length > 0) {
                    // Keep only last 2 code blocks, truncated
                    const keptBlocks = codeBlocks.slice(-2);
                    condensed += "\n" + keptBlocks.map(b =>
                        "```" + b.lang + "\n" + this.truncateCodeBlock(b.code, maxCodeLines) + "\n```"
                    ).join("\n");
                    if (codeBlocks.length > 2) {
                        condensed += `\n[${codeBlocks.length - 2} earlier code block(s) omitted]`;
                    }
                }
                parts.push("ASSISTANT: " + condensed);
                if (msg.media && msg.media.length > 0) {
                    parts[parts.length - 1] += '\n' + this.formatAllMediaPlaceholders(msg.media);
                }
            } else if (msg.role === "user" && msg.text.length > this.MAX_PROSE_CHARS) {
                // Condense long user messages too
                let condensed = prose.length > this.MAX_PROSE_CHARS
                    ? this.extractKeySentences(prose, this.MAX_PROSE_CHARS)
                    : prose;
                if (codeBlocks.length > 0) {
                    const keptBlocks = codeBlocks.slice(-1);
                    condensed += "\n" + keptBlocks.map(b =>
                        "```" + b.lang + "\n" + this.truncateCodeBlock(b.code, maxCodeLines) + "\n```"
                    ).join("\n");
                    if (codeBlocks.length > 1) {
                        condensed += `\n[${codeBlocks.length - 1} earlier code block(s) omitted]`;
                    }
                }
                parts.push("USER: " + condensed);
                if (msg.media && msg.media.length > 0) {
                    parts[parts.length - 1] += '\n' + this.formatAllMediaPlaceholders(msg.media);
                }
            } else {
                // Short messages: still truncate code blocks
                let text = msg.text;
                if (codeBlocks.length > 0) {
                    for (const b of codeBlocks) {
                        const truncated = this.truncateCodeBlock(b.code, maxCodeLines);
                        text = text.replace(b.full, "```" + b.lang + "\n" + truncated + "\n```");
                    }
                }
                parts.push(`${msg.role.toUpperCase()}: ${text}`);
                if (msg.media && msg.media.length > 0) {
                    parts[parts.length - 1] += '\n' + this.formatAllMediaPlaceholders(msg.media);
                }
            }
        }

        const finalText = parts.join("\n\n");
        return {
            text: finalText,
            tokenEstimate: Math.ceil(finalText.length / 4),
            messageCount: messages.length
        };
    },

    /**
     * Estimate token count for condensed output.
     */
    estimateCondensedTokens(messages, recentCount) {
        const result = this.condenseForSmart(messages, recentCount);
        return result.tokenEstimate;
    }
};
