// Paragraph-aware fixed-size chunking. Pure function, easy to test.
function chunkText(text, size = 600) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  const push = () => { if (current.trim()) chunks.push(current.trim()); current = ""; };
  for (const p of paragraphs) {
    if (p.length > size) {
      push();
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
      continue;
    }
    if ((current + "\n\n" + p).length > size) push();
    current = current ? current + "\n\n" + p : p;
  }
  push();
  return chunks.map((content, ordinal) => ({ ordinal, content }));
}
module.exports = { chunkText };
