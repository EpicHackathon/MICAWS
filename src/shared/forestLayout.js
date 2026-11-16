// Keep measured rectangles apart, including large translated labels and bubble layouts.
export function arrangeForest(trees, sizes, gap = 80) {
  const result = new Map();
  let left = 0;
  for (const tree of trees) {
    const placed = [];
    for (const [id, point] of tree) {
      const size = sizes.get(id);
      const box = { id, x: point.x, y: point.y, ...size };
      let collision;
      do {
        collision = placed.find(other => box.x < other.x + other.width + 20
          && box.x + box.width + 20 > other.x
          && box.y < other.y + other.height + 20 && box.y + box.height + 20 > other.y);
        if (collision) box.y = collision.y + collision.height + 24;
      } while (collision);
      placed.push(box);
    }
    if (!placed.length) continue;
    const minX = Math.min(...placed.map(box => box.x));
    const minY = Math.min(...placed.map(box => box.y));
    const maxX = Math.max(...placed.map(box => box.x + box.width));
    for (const box of placed) result.set(box.id, { x: left + box.x - minX, y: box.y - minY });
    left += maxX - minX + gap;
  }
  return result;
}
