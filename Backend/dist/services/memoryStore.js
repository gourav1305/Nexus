"use strict";
class MemoryStore {
    docs;
    maxDocs;
    constructor(maxDocs = 200) {
        this.docs = [];
        this.maxDocs = maxDocs;
    }
    async add(groq, userId, username, role, content) {
        this.docs.push({
            userId,
            username,
            role,
            content,
            words: this._tokenize(content),
            timestamp: Date.now(),
        });
        if (this.docs.length > this.maxDocs) {
            this.docs = this.docs.slice(-this.maxDocs);
        }
    }
    async query(groq, userId, queryText, topK = 5, minScore = 0.1) {
        if (this.docs.length === 0)
            return [];
        const queryWords = this._tokenize(queryText);
        const userDocs = this.docs.filter((d) => d.userId === userId);
        // Score by word overlap + recency boost
        const scored = userDocs
            .map((d) => {
            const overlap = this._wordOverlap(queryWords, d.words);
            const recency = Math.min(1, (Date.now() - d.timestamp) / (3600000 * 24));
            const score = overlap.overlap * (1 + recency * 0.2);
            return { ...d, score };
        })
            .filter((d) => d.score >= minScore)
            .sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }
    clearUser(userId) {
        this.docs = this.docs.filter((d) => d.userId !== userId);
    }
    _tokenize(text) {
        return text
            .toLowerCase()
            .split(/[\s,.;:!?(){}[\]"'’`।]+/)
            .filter((w) => w.length > 0);
    }
    _wordOverlap(queryWords, docWords) {
        const querySet = new Set(queryWords);
        const docSet = new Set(docWords);
        let overlap = 0;
        for (const w of queryWords) {
            if (docSet.has(w))
                overlap++;
        }
        const union = new Set([...querySet, ...docSet]);
        return {
            overlap,
            jaccard: union.size === 0 ? 0 : overlap / union.size,
        };
    }
}
module.exports = new MemoryStore();
