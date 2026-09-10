const outlines = new WeakMap();

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

export async function loadMaterialTexture(file) {
  const temporary = file instanceof Blob;
  const url = temporary ? URL.createObjectURL(file) : typeof file === 'string' ? file : file.dataUrl;
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = url;
    await image.decode();
    const { canvas, context } = createCanvas(256, 256);
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 256, 256);
    return { name: file.name || '材质图片', image, width: image.naturalWidth, height: image.naturalHeight, dataUrl: canvas.toDataURL('image/png') };
  } finally {
    if (temporary) URL.revokeObjectURL(url);
  }
}

function simplify(points, tolerance = 1) {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const deltaX = last[0] - first[0];
  const deltaY = last[1] - first[1];
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  let maximum = tolerance * tolerance;
  let split = -1;
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index];
    const fraction = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - first[0]) * deltaX + (point[1] - first[1]) * deltaY) / lengthSquared)) : 0;
    const distance = (point[0] - first[0] - fraction * deltaX) ** 2 + (point[1] - first[1] - fraction * deltaY) ** 2;
    if (distance > maximum) {
      maximum = distance;
      split = index;
    }
  }
  if (split < 0) return [first, last];
  return [...simplify(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplify(points.slice(split), tolerance)];
}

function polygonArea(points) {
  let area = 0;
  for (let index = 1; index < points.length; index++) {
    area += points[index - 1][0] * points[index][1] - points[index][0] * points[index - 1][1];
  }
  return area / 2;
}

function outlineFor(surface, piece) {
  let cache = outlines.get(surface);
  if (!cache) {
    cache = new Map();
    outlines.set(surface, cache);
  }
  if (cache.has(piece.id)) return cache.get(piece.id);
  const stride = surface.width + 1;
  const edges = new Map();
  const contains = (column, row) => column >= 0 && row >= 0 && column < surface.width && row < surface.height && (surface.labels ? surface.labels[row * surface.width + column] === piece.id : !!surface.mask[row * surface.width + column]);
  const addEdge = (startX, startY, endX, endY) => {
    const key = startY * stride + startX;
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push(endY * stride + endX);
  };
  for (let row = piece.y; row < piece.y + piece.height; row++) {
    for (let column = piece.x; column < piece.x + piece.width; column++) {
      if (!contains(column, row)) continue;
      if (!contains(column, row - 1)) addEdge(column, row, column + 1, row);
      if (!contains(column + 1, row)) addEdge(column + 1, row, column + 1, row + 1);
      if (!contains(column, row + 1)) addEdge(column + 1, row + 1, column, row + 1);
      if (!contains(column - 1, row)) addEdge(column, row + 1, column, row);
    }
  }
  const path = new Path2D();
  while (edges.size) {
    const start = edges.keys().next().value;
    let current = start;
    const points = [];
    do {
      points.push([current % stride, Math.floor(current / stride)]);
      const candidates = edges.get(current);
      if (!candidates?.length) break;
      const next = candidates.pop();
      if (!candidates.length) edges.delete(current);
      current = next;
    } while (current !== start);
    if (points.length < 3) continue;
    points.push(points[0]);
    const simplified = simplify(points);
    const area = polygonArea(points);
    const contour = simplified.length >= 4 && Math.abs(polygonArea(simplified) - area) <= Math.max(0.5, Math.abs(area) * 0.02) ? simplified : points;
    path.moveTo(...contour[0]);
    for (const point of contour.slice(1)) path.lineTo(...point);
    path.closePath();
  }
  cache.set(piece.id, path);
  return path;
}

function paintSurface(context, surface, piece, options) {
  const path = outlineFor(surface, piece);
  const texture = options.materialTexture?.image;
  context.save();
  context.clip(path, 'evenodd');
  const base = options.palette?.[options.material]?.base || [154, 162, 166];
  context.fillStyle = `rgb(${base.join(',')})`;
  context.fillRect(piece.x, piece.y, piece.width, piece.height);
  if (texture) {
    const cover = Math.max(surface.width / texture.naturalWidth, surface.height / texture.naturalHeight);
    const drawnWidth = texture.naturalWidth * cover;
    const drawnHeight = texture.naturalHeight * cover;
    context.drawImage(texture, (surface.width - drawnWidth) / 2, (surface.height - drawnHeight) / 2, drawnWidth, drawnHeight);
  }
  context.strokeStyle = 'rgba(25, 35, 40, 0.28)';
  context.lineWidth = 0.65;
  context.stroke(path);
  context.restore();
}

export function pieceDimensions(piece, scale = 4, padding = 16) {
  return { width: Math.ceil(piece.width * scale) + padding * 2, height: Math.ceil(piece.height * scale) + padding * 2 };
}

export function renderPiece(mask, geometry, options = {}) {
  const piece = geometry.pieces[options.pieceId];
  const scale = Number(options.scale ?? 4);
  const padding = Number(options.padding ?? 16);
  if (!piece || !Number.isFinite(scale) || scale <= 0 || scale > 8 || !Number.isInteger(padding) || padding < 0) throw new Error('碎片导出尺寸无效');
  const { width, height } = pieceDimensions(piece, scale, padding);
  const { canvas, context } = createCanvas(width, height);
  if (options.transparent === false) {
    context.fillStyle = options.background || '#1ca84a';
    context.fillRect(0, 0, width, height);
  }
  context.translate(padding, padding);
  context.scale(scale, scale);
  context.translate(-piece.x, -piece.y);
  paintSurface(context, geometry, piece, options);
  return canvas;
}

export function renderComposite(mask, geometry, options = {}) {
  const width = options.width || 2048;
  const height = options.height || width;
  const { canvas, context } = createCanvas(width, height);
  context.fillStyle = options.background || '#1ca84a';
  context.fillRect(0, 0, width, height);
  context.scale(width / mask.width, height / mask.height);
  if (geometry) {
    for (const piece of geometry.pieces) {
      const offset = geometry.layout?.[piece.id] || { x: 0, y: 0 };
      context.save();
      context.translate(Number(offset.x) || 0, Number(offset.y) || 0);
      paintSurface(context, geometry, piece, options);
      context.restore();
    }
  } else {
    paintSurface(context, mask, { id: -1, x: 0, y: 0, width: mask.width, height: mask.height }, options);
  }
  return canvas;
}

export function exportManifest(source, geometry, layout, texture, material, scale) {
  return {
    source, pieces: geometry.count, gap: geometry.gap, material: texture?.name || material, layout,
    version: 2, scale, padding: 16, coordinateSpace: { width: geometry.width, height: geometry.height },
    outputSize: { width: geometry.width * scale, height: geometry.height * scale },
    textureSize: texture ? { width: texture.width, height: texture.height } : null,
    fragments: geometry.pieces.map(piece => ({
      id: piece.id, file: `fragment-${String(piece.id + 1).padStart(3, '0')}.png`,
      ...pieceDimensions(piece, scale),
      x: (piece.x + (layout[piece.id]?.x || 0)) * scale - 16,
      y: (piece.y + (layout[piece.id]?.y || 0)) * scale - 16
    }))
  };
}
