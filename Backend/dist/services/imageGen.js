"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateImage = generateImage;
const https = require("https");
const POLLINATIONS_BASE = 'https://image.pollinations.ai';
async function generateImage({ prompt, width = 1024, height = 768, model = 'flux' }) {
    if (!prompt || !prompt.trim())
        throw new Error('Prompt is required');
    const encoded = encodeURIComponent(prompt.trim());
    const url = `${POLLINATIONS_BASE}/prompt/${encoded}?width=${width}&height=${height}&model=${model}&nologo=true`;
    const buffer = await new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Image API returned status ${res.statusCode}`));
                return;
            }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
    return {
        prompt,
        width,
        height,
        data: buffer.toString('base64'),
        mimeType: 'image/jpeg',
        size: buffer.length,
        source: 'pollinations',
    };
}
