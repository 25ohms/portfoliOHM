import {
  SignedDistanceField,
  buildSignedDistanceGridFromTriangles,
  type SignedDistanceGrid,
} from './SignedDistanceField'

type MeshSnapshot = {
  positions: Float32Array
  indices: Uint32Array | null
  matrix: Float64Array
}

type AnalysisRequest = {
  meshes: MeshSnapshot[]
  pathPoints: Float32Array
  samplePoints: Float64Array
  projectionSteps: number
  resolution: number
  padding: number
}

type AnalysisResponse = {
  grid: SignedDistanceGrid
  scopeMaps: Float32Array[]
  centerPoints: Float64Array
  centerDistances: Float32Array
  buildDurationMs: number
  mappingDurationMs: number
}

function transformPoint(
  positions: Float32Array,
  vertexIndex: number,
  matrix: Float64Array,
  target: Float32Array,
  targetOffset: number,
) {
  const offset = vertexIndex * 3
  const x = positions[offset]
  const y = positions[offset + 1]
  const z = positions[offset + 2]
  target[targetOffset] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]
  target[targetOffset + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]
  target[targetOffset + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
}

function triangleVertices(meshes: MeshSnapshot[]) {
  const triangleCount = meshes.reduce(
    (count, mesh) => count + (mesh.indices?.length ?? mesh.positions.length / 3) / 3,
    0,
  )
  const vertices = new Float32Array(triangleCount * 9)
  const point = new Float32Array(3)
  let outputOffset = 0
  for (const mesh of meshes) {
    const elementCount = mesh.indices?.length ?? mesh.positions.length / 3
    for (let element = 0; element + 2 < elementCount; element += 3) {
      for (let corner = 0; corner < 3; corner++) {
        const vertexIndex = mesh.indices ? mesh.indices[element + corner] : element + corner
        transformPoint(mesh.positions, vertexIndex, mesh.matrix, point, 0)
        vertices[outputOffset++] = point[0]
        vertices[outputOffset++] = point[1]
        vertices[outputOffset++] = point[2]
      }
    }
  }
  return vertices
}

function mapVerticesToSpine(
  meshes: MeshSnapshot[],
  pathPoints: Float32Array,
  projectionSteps: number,
) {
  const segmentCount = Math.floor(pathPoints.length / 3) - 1
  const segmentData = new Float32Array(segmentCount * 7)
  for (let segment = 0; segment < segmentCount; segment++) {
    const startOffset = segment * 3
    const endOffset = startOffset + 3
    const dataOffset = segment * 7
    const startX = pathPoints[startOffset]
    const startY = pathPoints[startOffset + 1]
    const startZ = pathPoints[startOffset + 2]
    const dx = pathPoints[endOffset] - startX
    const dy = pathPoints[endOffset + 1] - startY
    const dz = pathPoints[endOffset + 2] - startZ
    segmentData[dataOffset] = startX
    segmentData[dataOffset + 1] = startY
    segmentData[dataOffset + 2] = startZ
    segmentData[dataOffset + 3] = dx
    segmentData[dataOffset + 4] = dy
    segmentData[dataOffset + 5] = dz
    segmentData[dataOffset + 6] = dx * dx + dy * dy + dz * dz
  }

  return meshes.map((mesh) => {
    const vertexCount = mesh.positions.length / 3
    const mapping = new Float32Array(vertexCount * 4)
    const vertex = new Float32Array(3)
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
      transformPoint(mesh.positions, vertexIndex, mesh.matrix, vertex, 0)
      const x = vertex[0]
      const y = vertex[1]
      const z = vertex[2]
      let bestDistance = Infinity
      let bestT = 0
      for (let segment = 0; segment < segmentCount; segment++) {
        const offset = segment * 7
        const startX = segmentData[offset]
        const startY = segmentData[offset + 1]
        const startZ = segmentData[offset + 2]
        const dx = segmentData[offset + 3]
        const dy = segmentData[offset + 4]
        const dz = segmentData[offset + 5]
        const lengthSquared = segmentData[offset + 6]
        const ratio = lengthSquared > 0
          ? Math.max(0, Math.min(1, ((x - startX) * dx + (y - startY) * dy + (z - startZ) * dz) / lengthSquared))
          : 0
        const deltaX = x - (startX + dx * ratio)
        const deltaY = y - (startY + dy * ratio)
        const deltaZ = z - (startZ + dz * ratio)
        const distanceSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ
        if (distanceSquared < bestDistance) {
          bestDistance = distanceSquared
          bestT = (segment + ratio) / projectionSteps
        }
      }
      const outputOffset = vertexIndex * 4
      mapping[outputOffset] = bestT
      mapping[outputOffset + 1] = x
      mapping[outputOffset + 2] = y
      mapping[outputOffset + 3] = z
    }
    return mapping
  })
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null
  postMessage(message: AnalysisResponse, transfer: Transferable[]): void
}

workerScope.onmessage = (event) => {
  const request = event.data
  const buildStartedAt = performance.now()
  const vertices = triangleVertices(request.meshes)
  const grid = buildSignedDistanceGridFromTriangles(
    vertices,
    request.resolution,
    request.padding,
  )
  const field = new SignedDistanceField(grid)
  const centerDistances = new Float32Array(request.samplePoints.length / 3)
  for (let index = 0; index < centerDistances.length; index++) {
    const offset = index * 3
    centerDistances[index] = field.sample(
      request.samplePoints[offset],
      request.samplePoints[offset + 1],
      request.samplePoints[offset + 2],
    )
  }
  const buildDurationMs = performance.now() - buildStartedAt
  const mappingStartedAt = performance.now()
  const scopeMaps = mapVerticesToSpine(
    request.meshes,
    request.pathPoints,
    request.projectionSteps,
  )
  const mappingDurationMs = performance.now() - mappingStartedAt
  const response: AnalysisResponse = {
    grid,
    scopeMaps,
    centerPoints: request.samplePoints,
    centerDistances,
    buildDurationMs,
    mappingDurationMs,
  }
  const transfer: Transferable[] = [
    grid.values.buffer,
    request.samplePoints.buffer,
    centerDistances.buffer,
  ]
  for (const mapping of scopeMaps) transfer.push(mapping.buffer)
  workerScope.postMessage(response, transfer)
}
