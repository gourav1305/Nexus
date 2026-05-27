export function extractArtifacts(text, existingCount = 0) {
  const blocks = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    const ext = match[1] || 'txt';
    blocks.push({
      id: `art-${Date.now()}-${idx}`,
      title: `${ext.toUpperCase()} ${existingCount + blocks.length + 1}`,
      language: ext,
      code: match[2].trim(),
      type: ext === 'html' ? 'preview' : ext === 'md' || ext === 'markdown' ? 'preview' : 'code',
      createdAt: Date.now(),
    });
    idx++;
  }
  return blocks;
}

export function stripCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, '').trim();
}
