type Triangle = {
  ax: number; ay: number; az: number
  bx: number; by: number; bz: number
  cx: number; cy: number; cz: number
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
  centerX: number; centerY: number; centerZ: number
}

type BvhNode = {
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
  triangles?: Triangle[]
  left?: BvhNode
  right?: BvhNode
}

const BVH_LEAF_SIZE = 8

export type SignedDistanceGrid = {
  originX: number
  originY: number
  originZ: number
  cellSize: number
  sizeX: number
  sizeY: number
  sizeZ: number
  values: Float32Array
}

function buildBvh(triangles: Triangle[]): BvhNode {
  let minX = Infinity; let minY = Infinity; let minZ = Infinity
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity
  let centerMinX = Infinity; let centerMinY = Infinity; let centerMinZ = Infinity
  let centerMaxX = -Infinity; let centerMaxY = -Infinity; let centerMaxZ = -Infinity
  for (const triangle of triangles) {
    minX = Math.min(minX, triangle.minX); minY = Math.min(minY, triangle.minY); minZ = Math.min(minZ, triangle.minZ)
    maxX = Math.max(maxX, triangle.maxX); maxY = Math.max(maxY, triangle.maxY); maxZ = Math.max(maxZ, triangle.maxZ)
    centerMinX = Math.min(centerMinX, triangle.centerX); centerMinY = Math.min(centerMinY, triangle.centerY); centerMinZ = Math.min(centerMinZ, triangle.centerZ)
    centerMaxX = Math.max(centerMaxX, triangle.centerX); centerMaxY = Math.max(centerMaxY, triangle.centerY); centerMaxZ = Math.max(centerMaxZ, triangle.centerZ)
  }
  const node: BvhNode = { minX, minY, minZ, maxX, maxY, maxZ }
  if (triangles.length <= BVH_LEAF_SIZE) {
    node.triangles = triangles
    return node
  }
  const extents = [centerMaxX - centerMinX, centerMaxY - centerMinY, centerMaxZ - centerMinZ]
  const axis = extents[0] >= extents[1] && extents[0] >= extents[2] ? 0 : extents[1] >= extents[2] ? 1 : 2
  const centerKey = axis === 0 ? 'centerX' : axis === 1 ? 'centerY' : 'centerZ'
  triangles.sort((a, b) => a[centerKey] - b[centerKey])
  const middle = triangles.length >> 1
  node.left = buildBvh(triangles.slice(0, middle))
  node.right = buildBvh(triangles.slice(middle))
  return node
}

function boxDistanceSquared(node: BvhNode, x: number, y: number, z: number) {
  const dx = x < node.minX ? node.minX - x : x > node.maxX ? x - node.maxX : 0
  const dy = y < node.minY ? node.minY - y : y > node.maxY ? y - node.maxY : 0
  const dz = z < node.minZ ? node.minZ - z : z > node.maxZ ? z - node.maxZ : 0
  return dx * dx + dy * dy + dz * dz
}

function pointTriangleDistanceSquared(x: number, y: number, z: number, triangle: Triangle) {
  const abX = triangle.bx - triangle.ax; const abY = triangle.by - triangle.ay; const abZ = triangle.bz - triangle.az
  const acX = triangle.cx - triangle.ax; const acY = triangle.cy - triangle.ay; const acZ = triangle.cz - triangle.az
  const apX = x - triangle.ax; const apY = y - triangle.ay; const apZ = z - triangle.az
  const d1 = abX * apX + abY * apY + abZ * apZ
  const d2 = acX * apX + acY * apY + acZ * apZ
  if (d1 <= 0 && d2 <= 0) return apX * apX + apY * apY + apZ * apZ

  const bpX = x - triangle.bx; const bpY = y - triangle.by; const bpZ = z - triangle.bz
  const d3 = abX * bpX + abY * bpY + abZ * bpZ
  const d4 = acX * bpX + acY * bpY + acZ * bpZ
  if (d3 >= 0 && d4 <= d3) return bpX * bpX + bpY * bpY + bpZ * bpZ

  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    const dx = apX - v * abX; const dy = apY - v * abY; const dz = apZ - v * abZ
    return dx * dx + dy * dy + dz * dz
  }

  const cpX = x - triangle.cx; const cpY = y - triangle.cy; const cpZ = z - triangle.cz
  const d5 = abX * cpX + abY * cpY + abZ * cpZ
  const d6 = acX * cpX + acY * cpY + acZ * cpZ
  if (d6 >= 0 && d5 <= d6) return cpX * cpX + cpY * cpY + cpZ * cpZ

  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    const dx = apX - w * acX; const dy = apY - w * acY; const dz = apZ - w * acZ
    return dx * dx + dy * dy + dz * dz
  }

  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6)
    const dx = bpX - w * (triangle.cx - triangle.bx)
    const dy = bpY - w * (triangle.cy - triangle.by)
    const dz = bpZ - w * (triangle.cz - triangle.bz)
    return dx * dx + dy * dy + dz * dz
  }

  const denominator = va + vb + vc
  if (Math.abs(denominator) < 1e-20) {
    return Math.min(
      segmentDistanceSquared(x, y, z, triangle.ax, triangle.ay, triangle.az, triangle.bx, triangle.by, triangle.bz),
      segmentDistanceSquared(x, y, z, triangle.bx, triangle.by, triangle.bz, triangle.cx, triangle.cy, triangle.cz),
      segmentDistanceSquared(x, y, z, triangle.cx, triangle.cy, triangle.cz, triangle.ax, triangle.ay, triangle.az),
    )
  }
  const inverse = 1 / denominator
  const v = vb * inverse; const w = vc * inverse
  const dx = apX - (abX * v + acX * w)
  const dy = apY - (abY * v + acY * w)
  const dz = apZ - (abZ * v + acZ * w)
  return dx * dx + dy * dy + dz * dz
}

function segmentDistanceSquared(x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const dx = bx - ax; const dy = by - ay; const dz = bz - az
  const lengthSquared = dx * dx + dy * dy + dz * dz
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / lengthSquared)) : 0
  const px = ax + t * dx; const py = ay + t * dy; const pz = az + t * dz
  const ox = x - px; const oy = y - py; const oz = z - pz
  return ox * ox + oy * oy + oz * oz
}

function nearestDistanceSquared(node: BvhNode, x: number, y: number, z: number, best: number): number {
  if (boxDistanceSquared(node, x, y, z) >= best) return best
  if (node.triangles) {
    for (const triangle of node.triangles) {
      best = Math.min(best, pointTriangleDistanceSquared(x, y, z, triangle))
    }
    return best
  }
  const left = node.left!
  const right = node.right!
  const leftDistance = boxDistanceSquared(left, x, y, z)
  const rightDistance = boxDistanceSquared(right, x, y, z)
  if (leftDistance < rightDistance) {
    best = nearestDistanceSquared(left, x, y, z, best)
    return nearestDistanceSquared(right, x, y, z, best)
  }
  best = nearestDistanceSquared(right, x, y, z, best)
  return nearestDistanceSquared(left, x, y, z, best)
}

function rayHitX(originX: number, y: number, z: number, triangle: Triangle) {
  const e1X = triangle.bx - triangle.ax; const e1Y = triangle.by - triangle.ay; const e1Z = triangle.bz - triangle.az
  const e2X = triangle.cx - triangle.ax; const e2Y = triangle.cy - triangle.ay; const e2Z = triangle.cz - triangle.az
  const pX = 0
  const pY = -e2Z
  const pZ = e2Y
  const determinant = e1X * pX + e1Y * pY + e1Z * pZ
  if (Math.abs(determinant) < 1e-12) return null
  const inverse = 1 / determinant
  const tX = originX - triangle.ax; const tY = y - triangle.ay; const tZ = z - triangle.az
  const u = (tX * pX + tY * pY + tZ * pZ) * inverse
  if (u <= 1e-9 || u >= 1 - 1e-9) return null
  const qX = tY * e1Z - tZ * e1Y
  const qY = tZ * e1X - tX * e1Z
  const qZ = tX * e1Y - tY * e1X
  const v = qX * inverse
  if (v <= 1e-9 || u + v >= 1 - 1e-9) return null
  const distance = (e2X * qX + e2Y * qY + e2Z * qZ) * inverse
  return distance > 1e-9 ? originX + distance : null
}

function collectRayHitsX(
  node: BvhNode,
  originX: number,
  y: number,
  z: number,
  intersections: number[],
) {
  if (
    node.maxX < originX ||
    y < node.minY || y > node.maxY ||
    z < node.minZ || z > node.maxZ
  ) return
  if (node.triangles) {
    for (const triangle of node.triangles) {
      const intersection = rayHitX(originX, y, z, triangle)
      if (intersection !== null) intersections.push(intersection)
    }
    return
  }
  collectRayHitsX(node.left!, originX, y, z, intersections)
  collectRayHitsX(node.right!, originX, y, z, intersections)
}

export class SignedDistanceField {
  constructor(private readonly grid: SignedDistanceGrid) {}

  sample(x: number, y: number, z: number) {
    const { originX, originY, originZ, cellSize, sizeX, sizeY, sizeZ, values } = this.grid
    const gx = (x - originX) / cellSize
    const gy = (y - originY) / cellSize
    const gz = (z - originZ) / cellSize
    const clampedX = Math.max(0, Math.min(sizeX - 1, gx))
    const clampedY = Math.max(0, Math.min(sizeY - 1, gy))
    const clampedZ = Math.max(0, Math.min(sizeZ - 1, gz))
    const x0 = Math.min(sizeX - 2, Math.floor(clampedX))
    const y0 = Math.min(sizeY - 2, Math.floor(clampedY))
    const z0 = Math.min(sizeZ - 2, Math.floor(clampedZ))
    const tx = clampedX - x0; const ty = clampedY - y0; const tz = clampedZ - z0
    const plane = sizeX * sizeY
    const baseIndex = z0 * plane + y0 * sizeX + x0
    const c000 = values[baseIndex]
    const c100 = values[baseIndex + 1]
    const c010 = values[baseIndex + sizeX]
    const c110 = values[baseIndex + sizeX + 1]
    const c001 = values[baseIndex + plane]
    const c101 = values[baseIndex + plane + 1]
    const c011 = values[baseIndex + plane + sizeX]
    const c111 = values[baseIndex + plane + sizeX + 1]
    const c00 = c000 * (1 - tx) + c100 * tx
    const c10 = c010 * (1 - tx) + c110 * tx
    const c01 = c001 * (1 - tx) + c101 * tx
    const c11 = c011 * (1 - tx) + c111 * tx
    const c0 = c00 * (1 - ty) + c10 * ty
    const c1 = c01 * (1 - ty) + c11 * ty
    const interpolated = c0 * (1 - tz) + c1 * tz
    const outsideX = (gx - clampedX) * cellSize
    const outsideY = (gy - clampedY) * cellSize
    const outsideZ = (gz - clampedZ) * cellSize
    const outsideDistance = Math.hypot(outsideX, outsideY, outsideZ)
    return outsideDistance > 0 ? Math.max(0, interpolated) + outsideDistance : interpolated
  }
}

export function buildSignedDistanceGridFromTriangles(
  vertices: Float32Array,
  resolution = 64,
  padding = 0.95,
): SignedDistanceGrid {
  const triangles: Triangle[] = []
  let minX = Infinity; let minY = Infinity; let minZ = Infinity
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity
  for (let offset = 0; offset + 8 < vertices.length; offset += 9) {
    const ax = vertices[offset]; const ay = vertices[offset + 1]; const az = vertices[offset + 2]
    const bx = vertices[offset + 3]; const by = vertices[offset + 4]; const bz = vertices[offset + 5]
    const cx = vertices[offset + 6]; const cy = vertices[offset + 7]; const cz = vertices[offset + 8]
    const triangleMinX = Math.min(ax, bx, cx); const triangleMinY = Math.min(ay, by, cy); const triangleMinZ = Math.min(az, bz, cz)
    const triangleMaxX = Math.max(ax, bx, cx); const triangleMaxY = Math.max(ay, by, cy); const triangleMaxZ = Math.max(az, bz, cz)
    triangles.push({
      ax, ay, az, bx, by, bz, cx, cy, cz,
      minX: triangleMinX, minY: triangleMinY, minZ: triangleMinZ,
      maxX: triangleMaxX, maxY: triangleMaxY, maxZ: triangleMaxZ,
      centerX: (ax + bx + cx) / 3,
      centerY: (ay + by + cy) / 3,
      centerZ: (az + bz + cz) / 3,
    })
    minX = Math.min(minX, triangleMinX); minY = Math.min(minY, triangleMinY); minZ = Math.min(minZ, triangleMinZ)
    maxX = Math.max(maxX, triangleMaxX); maxY = Math.max(maxY, triangleMaxY); maxZ = Math.max(maxZ, triangleMaxZ)
  }
  if (triangles.length === 0) throw new Error('Cannot build an SDF without mesh triangles.')

  minX -= padding; minY -= padding; minZ -= padding
  maxX += padding; maxY += padding; maxZ += padding
  const longestSide = Math.max(maxX - minX, maxY - minY, maxZ - minZ)
  const cellSize = longestSide / (resolution - 1)
  const sizeX = Math.ceil((maxX - minX) / cellSize) + 1
  const sizeY = Math.ceil((maxY - minY) / cellSize) + 1
  const sizeZ = Math.ceil((maxZ - minZ) / cellSize) + 1
  const values = new Float32Array(sizeX * sizeY * sizeZ)
  const root = buildBvh(triangles)
  let index = 0
  const intersections: number[] = []
  for (let zIndex = 0; zIndex < sizeZ; zIndex++) {
    const z = minZ + zIndex * cellSize
    for (let yIndex = 0; yIndex < sizeY; yIndex++) {
      const y = minY + yIndex * cellSize
      const rayOriginX = minX - cellSize
      const rayY = y + Math.sin(y * 127.1 + z * 311.7) * cellSize * 1e-4
      const rayZ = z + Math.sin(y * 269.5 + z * 183.3) * cellSize * 1e-4
      intersections.length = 0
      collectRayHitsX(root, rayOriginX, rayY, rayZ, intersections)
      intersections.sort((a, b) => a - b)
      let nextIntersection = 0
      let inside = false
      let previousDistance = Infinity
      for (let xIndex = 0; xIndex < sizeX; xIndex++) {
        const x = minX + xIndex * cellSize
        while (nextIntersection < intersections.length && intersections[nextIntersection] <= x) {
          inside = !inside
          nextIntersection++
        }
        const searchLimit = previousDistance + cellSize
        const distanceSquared = nearestDistanceSquared(
          root,
          x,
          y,
          z,
          Number.isFinite(previousDistance) ? searchLimit * searchLimit : Infinity,
        )
        const distance = Math.sqrt(distanceSquared)
        previousDistance = distance
        values[index++] = inside ? -distance : distance
      }
    }
  }
  return { originX: minX, originY: minY, originZ: minZ, cellSize, sizeX, sizeY, sizeZ, values }
}
