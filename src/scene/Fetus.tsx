import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  CatmullRomCurve3,
  DynamicDrawUsage,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three'
import { FetusLoader } from './FetusLoader'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import modelUrl from '../../models/fetus/source/scene.fbx?url'
import type { SceneConfig } from '../config/scene'
import { useMusicPlayer } from '../audio/MusicPlayer'
import { readBassLevel, smoothBassLevel } from '../audio/bass'
import { logPerformance } from '../utils/performanceLogger'
import { babyDisplacementMultiplierAt, isFinalFrontierTrack } from './sceneTimeline'
import Vectorscope, { SCOPE_RADIUS, TRACE_COUNT } from './Vectorscope'
import { SignedDistanceField } from './SignedDistanceField'
import spinePathData from './spinePath.v1.json'

const VECTORSCOPE_X_DISPLACEMENT_SCALE = 0.5
const VECTORSCOPE_NOISE_BOOST = 7.5
const VECTORSCOPE_EXIT_INFLUENCE_RADIUS = 1
const SDF_RESOLUTION = 48
const SPINE_PROJECTION_STEPS = 128
const SHOW_VECTORSCOPE = false

export default function Fetus({ config, onReady }: { config: SceneConfig; onReady: () => void }) {
  const original = useLoader(FetusLoader, modelUrl)
  const { analyser, vectorscopeAnalysers, playing, currentTrack, getCurrentTime } = useMusicPlayer()
  const timelineEnabled = isFinalFrontierTrack(currentTrack?.title)
  const bassLevel = useRef(0)
  const audioData = useMemo(
    () => (analyser ? new Uint8Array(analyser.frequencyBinCount) : null),
    [analyser],
  )
  const scopeAudioData = useMemo(
    () => vectorscopeAnalysers
      ? [new Uint8Array(vectorscopeAnalysers[0].fftSize), new Uint8Array(vectorscopeAnalysers[1].fftSize)] as const
      : null,
    [vectorscopeAnalysers],
  )
  const scopeSamples = useRef(new Float32Array(TRACE_COUNT * 2))
  const { normalized, material, geometries, meshes } = useMemo(() => {
    const startedAt = performance.now()
    const object = clone(original)
    const geometries: Mesh['geometry'][] = []
    const meshes: Mesh[] = []
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      toneMapped: false,
    })
    object.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry = child.geometry.clone()
        child.geometry.getAttribute('position').setUsage(DynamicDrawUsage)
        geometries.push(child.geometry)
        meshes.push(child)
        child.material = material
      }
    })
    object.updateMatrixWorld(true)
    const box = new Box3().setFromObject(object)
    const center = box.getCenter(new Vector3())
    const scale = 2 / Math.max(...box.getSize(new Vector3()).toArray())
    object.position.sub(center)
    const normalized = new Group()
    normalized.add(object)
    normalized.scale.setScalar(scale)
    normalized.updateMatrixWorld(true)
    logPerformance('FETUS_GEOMETRY_PREPARED', {
      meshCount: geometries.length,
      vertexCount: geometries.reduce(
        (count, geometry) => count + geometry.getAttribute('position').count,
        0,
      ),
      durationMs: Math.round(performance.now() - startedAt),
    })
    return { normalized, material, geometries, meshes }
  }, [original])
  const staticSpinePath = useMemo(
    () => spinePathData.points.map(([x, y, z]) => new Vector3(x, y, z)),
    [],
  )
  const scaledSpinePath = useMemo(
    () => staticSpinePath.map((point) => point.clone().multiplyScalar(normalized.scale.x)),
    [staticSpinePath, normalized.scale.x],
  )
  const scopeCurve = useMemo(
    () => new CatmullRomCurve3(scaledSpinePath, false, 'centripetal'),
    [scaledSpinePath],
  )
  const [analysis, setAnalysis] = useState<{
    field: SignedDistanceField
    scopeMaps: Float32Array[]
    centerPoints: Float64Array
    centerDistances: Float32Array
  } | null>(null)
  const scopeFrames = useMemo(
    () => scopeCurve.computeFrenetFrames(TRACE_COUNT - 1, false),
    [scopeCurve],
  )
  useEffect(() => {
    const worker = new Worker(new URL('./spineAnalysis.worker.ts', import.meta.url), {
      type: 'module',
    })
    const transfer: Transferable[] = []
    const snapshots = meshes.map((mesh) => {
      const positions = Float32Array.from(mesh.geometry.getAttribute('position').array)
      const index = mesh.geometry.index
      const indices = index ? Uint32Array.from(index.array) : null
      const matrix = Float64Array.from(mesh.matrixWorld.elements)
      transfer.push(positions.buffer, matrix.buffer)
      if (indices) transfer.push(indices.buffer)
      return { positions, indices, matrix }
    })
    const pathPoints = new Float32Array((SPINE_PROJECTION_STEPS + 1) * 3)
    const spacedPoints = scopeCurve.getSpacedPoints(SPINE_PROJECTION_STEPS)
    for (let index = 0; index < spacedPoints.length; index++) {
      const offset = index * 3
      pathPoints[offset] = spacedPoints[index].x
      pathPoints[offset + 1] = spacedPoints[index].y
      pathPoints[offset + 2] = spacedPoints[index].z
    }
    const samplePoints = new Float64Array(TRACE_COUNT * 3)
    const samplePoint = new Vector3()
    for (let index = 0; index < TRACE_COUNT; index++) {
      scopeCurve.getPointAt(index / (TRACE_COUNT - 1), samplePoint)
      const offset = index * 3
      samplePoints[offset] = samplePoint.x
      samplePoints[offset + 1] = samplePoint.y
      samplePoints[offset + 2] = samplePoint.z
    }
    transfer.push(pathPoints.buffer, samplePoints.buffer)
    const startedAt = performance.now()
    worker.onmessage = (event: MessageEvent<{
      grid: ConstructorParameters<typeof SignedDistanceField>[0]
      scopeMaps: Float32Array[]
      centerPoints: Float64Array
      centerDistances: Float32Array
      buildDurationMs: number
      mappingDurationMs: number
    }>) => {
      worker.terminate()
      setAnalysis({
        field: new SignedDistanceField(event.data.grid),
        scopeMaps: event.data.scopeMaps,
        centerPoints: event.data.centerPoints,
        centerDistances: event.data.centerDistances,
      })
      logPerformance('FETUS_SDF_PREPARED', {
        resolution: SDF_RESOLUTION,
        workerBuildMs: Math.round(event.data.buildDurationMs),
        scopeMappingMs: Math.round(event.data.mappingDurationMs),
        elapsedMs: Math.round(performance.now() - startedAt),
      })
    }
    worker.onerror = (event) => {
      worker.terminate()
      logPerformance('FETUS_SDF_WORKER_ERROR', { message: event.message })
    }
    worker.postMessage({
      meshes: snapshots,
      pathPoints,
      samplePoints,
      projectionSteps: SPINE_PROJECTION_STEPS,
      resolution: SDF_RESOLUTION,
      padding: SCOPE_RADIUS + 0.1,
    }, transfer)
    return () => worker.terminate()
  }, [meshes, scopeCurve])
  const scopeExitPoints = useRef(new Float32Array(TRACE_COUNT * 4))
  const lastScopeDiagnosticAt = useRef(0)
  const scopeScratch = useMemo(() => ({
    center: new Vector3(),
    endpoint: new Vector3(),
    boundary: new Vector3(),
    candidate: new Vector3(),
    displacement: new Vector3(),
  }), [])
  useFrame((state, delta) => {
    const target = playing && analyser && audioData ? readBassLevel(analyser, audioData) : 0
    bassLevel.current = smoothBassLevel(bassLevel.current, target, delta)
    const strength = bassLevel.current
    const scopeActive = Boolean(playing && vectorscopeAnalysers && scopeAudioData && analysis)
    scopeExitPoints.current.fill(0)
    let scopeInsideCount = 0
    let scopeOutsideEndpointCount = 0
    let scopeExitCount = 0
    let maxScopeMagnitude = 0
    if (scopeActive && vectorscopeAnalysers && scopeAudioData && analysis) {
      vectorscopeAnalysers[0].getByteTimeDomainData(scopeAudioData[0])
      vectorscopeAnalysers[1].getByteTimeDomainData(scopeAudioData[1])
      const sampleCount = Math.min(TRACE_COUNT, scopeAudioData[0].length, scopeAudioData[1].length)
      for (let index = 0; index < sampleCount; index++) {
        const left = (scopeAudioData[0][index] - 128) / 128
        const right = (scopeAudioData[1][index] - 128) / 128
        const mid = (left + right) * 0.5 * SCOPE_RADIUS
        const side = (left - right) * 0.5 * SCOPE_RADIUS
        maxScopeMagnitude = Math.max(maxScopeMagnitude, Math.hypot(mid, side))
        scopeSamples.current[index * 2] = mid
        scopeSamples.current[index * 2 + 1] = side

        const { center, endpoint, boundary, candidate, displacement } = scopeScratch
        const centerOffset = index * 3
        center.set(
          analysis.centerPoints[centerOffset],
          analysis.centerPoints[centerOffset + 1],
          analysis.centerPoints[centerOffset + 2],
        )
        displacement.copy(scopeFrames.normals[index]).multiplyScalar(mid)
          .addScaledVector(scopeFrames.binormals[index], side)
        endpoint.copy(center).add(displacement)
        const centerDistance = analysis.centerDistances[index]
        const endpointDistance = analysis.field.sample(endpoint.x, endpoint.y, endpoint.z)
        if (centerDistance < 0) scopeInsideCount++
        if (endpointDistance > 0) scopeOutsideEndpointCount++
        if (centerDistance < 0 && endpointDistance > 0) {
          scopeExitCount++
          let insideT = 0
          let outsideT = 1
          for (let step = 0; step < 8; step++) {
            const middleT = (insideT + outsideT) * 0.5
            candidate.copy(center).addScaledVector(displacement, middleT)
            if (analysis.field.sample(candidate.x, candidate.y, candidate.z) < 0) insideT = middleT
            else outsideT = middleT
          }
          boundary.copy(center).addScaledVector(displacement, (insideT + outsideT) * 0.5)
          const exitOffset = index * 4
          scopeExitPoints.current[exitOffset] = boundary.x
          scopeExitPoints.current[exitOffset + 1] = boundary.y
          scopeExitPoints.current[exitOffset + 2] = boundary.z
          scopeExitPoints.current[exitOffset + 3] = Math.min(
            1,
            Math.hypot(mid * VECTORSCOPE_X_DISPLACEMENT_SCALE, side) / SCOPE_RADIUS,
          )
        }
      }
    } else {
      scopeSamples.current.fill(0)
    }
    const time = state.clock.elapsedTime
    const timelineMultiplier = timelineEnabled ? babyDisplacementMultiplierAt(getCurrentTime()) : 1
    const amount = ((0.008 * strength) / normalized.scale.x) * timelineMultiplier
    let influencedVertexCount = 0
    let maxExitInfluence = 0
    for (let geometryIndex = 0; geometryIndex < geometries.length; geometryIndex++) {
      const geometry = geometries[geometryIndex]
      const position = geometry.getAttribute('position')
      const base = geometry.userData.basePosition as Float32Array | undefined
      if (!base) {
        geometry.userData.basePosition = new Float32Array(position.array as ArrayLike<number>)
      }
      const originalPositions = geometry.userData.basePosition as Float32Array
      const scopeMap = scopeActive ? analysis?.scopeMaps[geometryIndex] : undefined
      for (let index = 0; index < position.count; index++) {
        const offset = index * 3
        const x = originalPositions[offset]
        const y = originalPositions[offset + 1]
        const z = originalPositions[offset + 2]
        const phase = x * 17.1 + y * 31.7 + z * 23.3
        let exitInfluence = 0
        if (scopeMap) {
          const mapOffset = index * 4
          const samplePosition = scopeMap[mapOffset] * (TRACE_COUNT - 1)
          const sampleIndex = Math.floor(samplePosition)
          const sampleBlend = samplePosition - sampleIndex
          const exitStart = sampleIndex * 4
          const exitEnd = Math.min(TRACE_COUNT - 1, sampleIndex + 1) * 4
          const startWeight = scopeExitPoints.current[exitStart + 3] * (1 - sampleBlend)
          const endWeight = scopeExitPoints.current[exitEnd + 3] * sampleBlend
          const exitWeight = startWeight + endWeight
          if (exitWeight > 0) {
            const exitX = (scopeExitPoints.current[exitStart] * startWeight + scopeExitPoints.current[exitEnd] * endWeight) / exitWeight
            const exitY = (scopeExitPoints.current[exitStart + 1] * startWeight + scopeExitPoints.current[exitEnd + 1] * endWeight) / exitWeight
            const exitZ = (scopeExitPoints.current[exitStart + 2] * startWeight + scopeExitPoints.current[exitEnd + 2] * endWeight) / exitWeight
            const dx = scopeMap[mapOffset + 1] - exitX
            const dy = scopeMap[mapOffset + 2] - exitY
            const dz = scopeMap[mapOffset + 3] - exitZ
            const distanceSquared = dx * dx + dy * dy + dz * dz
            const radiusSquared = VECTORSCOPE_EXIT_INFLUENCE_RADIUS ** 2
            exitInfluence = exitWeight * Math.max(0, 1 - distanceSquared / radiusSquared) ** 2
          }
        }
        if (exitInfluence > 0) influencedVertexCount++
        maxExitInfluence = Math.max(maxExitInfluence, exitInfluence)
        const localNoiseAmount = amount * (1 + VECTORSCOPE_NOISE_BOOST * exitInfluence)
        position.array[offset] = x + Math.sin(time * 37 + phase) * localNoiseAmount
        position.array[offset + 1] = y + Math.sin(time * 43 + phase * 1.7) * localNoiseAmount
        position.array[offset + 2] = z + Math.sin(time * 39 + phase * 2.3) * localNoiseAmount
      }
      position.needsUpdate = true
    }
    const diagnosticTime = performance.now()
    if (scopeActive && scopeAudioData && diagnosticTime - lastScopeDiagnosticAt.current >= 1000) {
      lastScopeDiagnosticAt.current = diagnosticTime
      logPerformance('VECTORSCOPE_SDF_INFLUENCE', {
        radius: VECTORSCOPE_EXIT_INFLUENCE_RADIUS,
        samples: Math.min(TRACE_COUNT, scopeAudioData[0].length, scopeAudioData[1].length),
        insideSamples: scopeInsideCount,
        outsideEndpoints: scopeOutsideEndpointCount,
        surfaceExits: scopeExitCount,
        maxSignalMagnitude: Number(maxScopeMagnitude.toFixed(3)),
        influencedVertices: influencedVertexCount,
        maxNoiseMultiplier: Number((1 + VECTORSCOPE_NOISE_BOOST * maxExitInfluence).toFixed(3)),
        baseNoiseAmount: Number(amount.toFixed(5)),
        maxAddedDisplacement: Number((amount * VECTORSCOPE_NOISE_BOOST * maxExitInfluence * normalized.scale.x).toFixed(5)),
      })
    }
  })
  useEffect(() => {
    material.color.setRGB(
      config.material.intensity,
      config.material.intensity,
      config.material.intensity,
    )
    material.opacity = config.material.opacity
  }, [material, config.material])
  useEffect(() => {
    let cancelled = false
    const startedAt = performance.now()
    logPerformance('SCENE_RENDER_SETTLE_STARTED')
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return
        logPerformance('SCENE_READY_AFTER_RENDERED_FRAMES', {
          durationMs: Math.round(performance.now() - startedAt),
        })
        onReady()
      })
    })
    return () => {
      cancelled = true
    }
  }, [onReady])
  // Cached FBX geometry is shared across route visits; this clone owns its geometry and material.
  useEffect(
    () => () => {
      material.dispose()
      geometries.forEach((geometry) => geometry.dispose())
    },
    [material, geometries],
  )
  return (
    <>
      <primitive
        object={normalized}
        dispose={null}
      />
      <SpineGuide points={scaledSpinePath} />
      {SHOW_VECTORSCOPE && playing && Boolean(vectorscopeAnalysers) && (
        <Vectorscope
          spine={scaledSpinePath}
          samples={scopeSamples}
          visible
        />
      )}
    </>
  )
}

function SpineGuide({ points }: { points: Vector3[] }) {
  const { line, geometry, material } = useMemo(() => {
    const buffer = new BufferGeometry()
    buffer.setFromPoints(points)
    const material = new LineBasicMaterial({ color: '#ff9a68', depthTest: false })
    return { line: new Line(buffer, material), geometry: buffer, material }
  }, [points])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])
  return <primitive object={line} />
}
