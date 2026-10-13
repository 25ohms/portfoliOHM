import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import {
  AdditiveBlending,
  Box3,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  SphereGeometry,
  ShaderMaterial,
  Vector3,
} from 'three'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { useMusicPlayer } from '../audio/MusicPlayer'
import type { SceneDebugObjects } from './SceneContents'
import {
  APPROACH_START,
  ENGINE_WARMUP_START,
  TAXI_START,
  TAXI_FLARE_FADE_DURATION,
  WARP_DURATION,
  WARP_START,
  WARP_TRAIL_FADE,
  WARMUP_FLARE_LEAD,
} from './sceneTimeline'
import enterpriseUrl from '../../models/enterprise/uss-enterprise.obj?url'

const WARP_STRETCH = 150
const WARP_TAIL_LENGTH = 90
const WARP_DISTANCE = 1000
const ENTERPRISE_SIZE_MULTIPLIER = 0.5
const SHIP_SCALE = 0.93 * ENTERPRISE_SIZE_MULTIPLIER
const ENTERPRISE_Y = 0.5
const APPROACH_START_MIN_X = -3
const ENTERPRISE_DEPTH_OFFSET = 1.2
const POST_VERTEX_X = 0.15
const POST_TAXI_TRAVEL_DISTANCE = 0.2
const POST_WARMUP_TRAVEL_DISTANCE = 0.05
const ENGINE_OUTLET_X = 0.265
const ENGINE_OUTLET_Y = 0.174
const ENGINE_OUTLET_Z = 0.999
const PARABOLA_FOCAL_DISTANCE = 0.1
const POST_TAXI_SPEED_FACTOR = 0.4
const TAXI_TANGENT_HANDLE_RATIO = 0.85

function parabolaArcLength(q: number, focalDistance: number) {
  const ratio = q / (2 * focalDistance)
  return 0.5 * q * Math.sqrt(1 + ratio * ratio) + focalDistance * Math.asinh(ratio)
}

function arcParameterAtLength(
  distance: number,
  limit: number,
  focalDistance: number,
  minimum = -limit,
  maximum = limit,
) {
  const target = MathUtils.clamp(
    distance,
    parabolaArcLength(minimum, focalDistance),
    parabolaArcLength(maximum, focalDistance),
  )
  let low = minimum
  let high = maximum
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2
    if (parabolaArcLength(middle, focalDistance) < target) low = middle
    else high = middle
  }
  return (low + high) / 2
}

// Hermite interpolation makes arc distance continuous with matching endpoint speeds.
function interpolatePathDistance(
  progress: number,
  distance: number,
  duration: number,
  startSpeed: number,
  endSpeed: number,
) {
  const t = MathUtils.clamp(progress, 0, 1)
  const t2 = t * t
  const t3 = t2 * t
  return (
    (t3 - 2 * t2 + t) * duration * startSpeed +
    (-2 * t3 + 3 * t2) * distance +
    (t3 - t2) * duration * endSpeed
  )
}

function meanGeometryPoint(root: Object3D, target: Vector3) {
  root.updateWorldMatrix(true, true)
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert()
  const localToRoot = new Matrix4()
  const vertex = new Vector3()
  const sum = new Vector3()
  let count = 0

  root.traverse((child) => {
    if (!(child instanceof Mesh)) return
    const position = child.geometry.getAttribute('position')
    if (!position) return
    localToRoot.multiplyMatrices(rootInverse, child.matrixWorld)
    for (let index = 0; index < position.count; index++) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(localToRoot)
      sum.add(vertex)
      count++
    }
  })

  if (count === 0) return false
  target.copy(sum).multiplyScalar(1 / count)
  return true
}

function collectBackCenterlineSegments(root: Object3D, segments: Vector3[]) {
  root.updateWorldMatrix(true, true)
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert()
  const localToRoot = new Matrix4()
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const edgePoint = new Vector3()
  const intersectionPoints: Vector3[] = []
  segments.length = 0

  root.traverse((child) => {
    if (!(child instanceof Mesh)) return
    const position = child.geometry.getAttribute('position')
    if (!position) return
    const index = child.geometry.getIndex()
    const elementCount = index?.count ?? position.count
    localToRoot.multiplyMatrices(rootInverse, child.matrixWorld)

    for (let element = 0; element + 2 < elementCount; element += 3) {
      const ia = index ? index.getX(element) : element
      const ib = index ? index.getX(element + 1) : element + 1
      const ic = index ? index.getX(element + 2) : element + 2
      a.fromBufferAttribute(position, ia).applyMatrix4(localToRoot)
      b.fromBufferAttribute(position, ib).applyMatrix4(localToRoot)
      c.fromBufferAttribute(position, ic).applyMatrix4(localToRoot)
      intersectionPoints.length = 0

      const addUnique = (point: Vector3) => {
        if (intersectionPoints.some((existing) => existing.distanceToSquared(point) < 1e-10)) return
        intersectionPoints.push(point.clone())
      }
      const intersectEdge = (start: Vector3, end: Vector3) => {
        if (Math.abs(start.x) < 1e-7) addUnique(start)
        if ((start.x < 0 && end.x > 0) || (start.x > 0 && end.x < 0)) {
          const progress = start.x / (start.x - end.x)
          addUnique(edgePoint.copy(start).lerp(end, progress))
        }
      }

      intersectEdge(a, b)
      intersectEdge(b, c)
      intersectEdge(c, a)
      if (intersectionPoints.length < 2) continue

      // A triangle crossing the center plane yields a segment; use its farthest
      // pair if a vertex lies exactly on that plane.
      let start = intersectionPoints[0]
      let end = intersectionPoints[1]
      let segmentLengthSq = start.distanceToSquared(end)
      for (let first = 0; first < intersectionPoints.length; first++) {
        for (let second = first + 1; second < intersectionPoints.length; second++) {
          const lengthSq = intersectionPoints[first].distanceToSquared(intersectionPoints[second])
          if (lengthSq > segmentLengthSq) {
            start = intersectionPoints[first]
            end = intersectionPoints[second]
            segmentLengthSq = lengthSq
          }
        }
      }

      if (start.z > 0 && end.z > 0) continue
      if (start.z > 0) start.lerp(end, start.z / (start.z - end.z))
      else if (end.z > 0) end.lerp(start, end.z / (end.z - start.z))

      segments.push(start.clone(), end.clone())
    }
  })
}

function nearestBackCenterlinePoint(
  root: Object3D,
  segments: Vector3[],
  referenceWorld: Vector3,
  target: Vector3,
) {
  root.updateWorldMatrix(true, true)
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert()
  const worldStart = new Vector3()
  const worldEnd = new Vector3()
  const candidate = new Vector3()
  let closestDistanceSq = Infinity
  let found = false

  for (let segment = 0; segment + 1 < segments.length; segment += 2) {
    worldStart.copy(segments[segment]).applyMatrix4(root.matrixWorld)
    worldEnd.copy(segments[segment + 1]).applyMatrix4(root.matrixWorld)
    // Keep the logo mean's world-space Y fixed; only search for the nearest
    // rear centerline crossing in XZ so the aim cannot drift toward the skull top.
    const worldSegmentY = worldEnd.y - worldStart.y
    let progress: number
    if (Math.abs(worldSegmentY) < 1e-8) {
      if (Math.abs(referenceWorld.y - worldStart.y) > 1e-5) continue
      const segmentX = worldEnd.x - worldStart.x
      const segmentZ = worldEnd.z - worldStart.z
      const segmentLengthSq = segmentX * segmentX + segmentZ * segmentZ
      progress = segmentLengthSq > 1e-12
        ? MathUtils.clamp(
            ((referenceWorld.x - worldStart.x) * segmentX +
              (referenceWorld.z - worldStart.z) * segmentZ) /
              segmentLengthSq,
            0,
            1,
          )
        : 0
    } else {
      progress = (referenceWorld.y - worldStart.y) / worldSegmentY
      if (progress < 0 || progress > 1) continue
    }
    candidate.copy(worldStart).lerp(worldEnd, progress)
    candidate.y = referenceWorld.y
    const dx = candidate.x - referenceWorld.x
    const dz = candidate.z - referenceWorld.z
    const distanceSq = dx * dx + dz * dz
    if (distanceSq < closestDistanceSq) {
      closestDistanceSq = distanceSq
      target.copy(candidate).applyMatrix4(rootInverse)
      found = true
    }
  }

  return found
}

function taxiCurvePoint(
  progress: number,
  start: Vector3,
  end: Vector3,
  direction: Vector3,
  target: Vector3,
  tangent: Vector3,
  endTangent: Vector3,
) {
  const t = MathUtils.clamp(progress, 0, 1)
  const t2 = t * t
  const t3 = t2 * t
  const handle = start.distanceTo(end) * TAXI_TANGENT_HANDLE_RATIO
  const startTangent = tangent.set(0, 0, -handle)
  endTangent.copy(direction).multiplyScalar(handle)
  return target
    .copy(start)
    .multiplyScalar(2 * t3 - 3 * t2 + 1)
    .addScaledVector(startTangent, t3 - 2 * t2 + t)
    .addScaledVector(end, -2 * t3 + 3 * t2)
    .addScaledVector(endTangent, t3 - t2)
}

function taxiCurveDirection(
  progress: number,
  start: Vector3,
  end: Vector3,
  direction: Vector3,
  target: Vector3,
  tangent: Vector3,
  endTangent: Vector3,
) {
  const t = MathUtils.clamp(progress, 0, 1)
  const t2 = t * t
  const handle = start.distanceTo(end) * TAXI_TANGENT_HANDLE_RATIO
  const startTangent = tangent.set(0, 0, -handle)
  endTangent.copy(direction).multiplyScalar(handle)
  return target
    .set(0, 0, 0)
    .addScaledVector(start, 6 * t2 - 6 * t)
    .addScaledVector(startTangent, 3 * t2 - 4 * t + 1)
    .addScaledVector(end, -6 * t2 + 6 * t)
    .addScaledVector(endTangent, 3 * t2 - 2 * t)
    .normalize()
}

export default function Enterprise({
  anchor,
  babyGroup,
  logoGroup,
  debugObjects,
}: {
  anchor: React.RefObject<Group | null>
  babyGroup: React.RefObject<Group | null>
  logoGroup: React.RefObject<Group | null>
  debugObjects: MutableRefObject<SceneDebugObjects>
}) {
  const source = useLoader(OBJLoader, enterpriseUrl)
  const { getCurrentTime } = useMusicPlayer()
  const group = useRef<Group>(null)
  const engineBurn = useRef<Group>(null)
  const engineCore = useRef<Group>(null)
  const engineCoreFlames = useRef<Array<Mesh | null>>([null, null])
  const warpContrail = useRef<Group>(null)
  const leftContrail = useRef<Mesh>(null)
  const rightContrail = useRef<Mesh>(null)
  const engineFlares = useRef<Array<Mesh | null>>([null, null])
  const movementDirection = useMemo(() => new Vector3(0, 0, -1), [])
  const warpDirection = useMemo(() => new Vector3(0, 0, -1), [])
  const anchorWorldPosition = useMemo(() => new Vector3(), [])
  const aimedPointLocal = useMemo(() => new Vector3(), [])
  const logoMeanLocal = useMemo(() => new Vector3(), [])
  const logoMeanWorld = useMemo(() => new Vector3(), [])
  const babyBackCenterlineSegments = useMemo(() => [] as Vector3[], [])
  const babyBackCenterlineLocal = useMemo(() => new Vector3(), [])
  const babyBackCenterlineWorld = useMemo(() => new Vector3(), [])
  const logoMeanReady = useRef(false)
  const babyBackGeometryReady = useRef(false)
  const babyBackCenterlineReady = useRef(false)
  const warpDirectionReady = useRef(false)
  const aimedDirection = useMemo(() => new Vector3(0, 0, -1), [])
  const taxiStart = useMemo(() => new Vector3(), [])
  const taxiEnd = useMemo(() => new Vector3(), [])
  const warpStart = useMemo(() => new Vector3(), [])
  const pathPoint = useMemo(() => new Vector3(), [])
  const pathTangent = useMemo(() => new Vector3(), [])
  const pathEndTangent = useMemo(() => new Vector3(), [])
  const localForward = useMemo(() => new Vector3(0, 0, -1), [])
  const contrailBackward = useMemo(() => new Vector3(), [])
  const contrailForward = useMemo(() => new Vector3(0, 0, 1), [])
  const contrailRotation = useMemo(() => new Quaternion(), [])
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#8effdc',
        wireframe: true,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )
  const normalized = useMemo(() => {
    const object = source.clone(true)
    object.traverse((child) => {
      if (child instanceof Mesh) child.material = material
    })
    object.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(object)
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    object.position.sub(center)
    const root = new Group()
    root.add(object)
    root.scale.setScalar(2 / Math.max(size.x, size.y, size.z))
    return root
  }, [material, source])
  const shipHalfExtents = useMemo(
    () => new Box3().setFromObject(normalized).getSize(new Vector3()).multiplyScalar(0.5),
    [normalized],
  )
  const flameGeometry = useMemo(() => new CylinderGeometry(0, 0.026, 0.34, 7), [])
  const flameCoreGeometry = useMemo(() => new SphereGeometry(0.03, 12, 8), [])
  const engineFlareGeometry = useMemo(() => new CircleGeometry(1, 32), [])
  const flameMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#86f4ff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )
  const flameCoreMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#dfffff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )
  const engineFlareMaterial = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uIntensity: { value: 0 } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uIntensity;
          varying vec2 vUv;
          void main() {
            vec2 point = (vUv - 0.5) * 2.0;
            float radius = length(point);
            float core = exp(-radius * radius * 34.0);
            float halo = exp(-radius * radius * 4.5);
            float horizontalRay = exp(-point.y * point.y * 190.0) * exp(-abs(point.x) * 3.5);
            float verticalRay = exp(-point.x * point.x * 190.0) * exp(-abs(point.y) * 3.5);
            float alpha = (core * 0.9 + halo * 0.25 + (horizontalRay + verticalRay) * 0.13) * uIntensity;
            vec3 color = mix(vec3(0.30, 0.86, 1.0), vec3(1.0), core);
            gl_FragColor = vec4(color, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )
  const contrailGeometry = useMemo(
    () =>
      new CylinderGeometry(
        0.004 * ENTERPRISE_SIZE_MULTIPLIER,
        0.024 * ENTERPRISE_SIZE_MULTIPLIER,
        1,
        7,
        24,
      ),
    [],
  )
  const contrailMaterial = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Vector3(0.77, 1, 1) },
          uOpacity: { value: 0 },
          uDissipation: { value: -0.1 },
        },
        vertexShader: `
          varying float vTrailPosition;
          void main() {
            vTrailPosition = uv.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          uniform float uDissipation;
          varying float vTrailPosition;
          void main() {
            float remains = smoothstep(uDissipation - 0.035, uDissipation + 0.035, vTrailPosition);
            gl_FragColor = vec4(uColor, uOpacity * remains);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )

  useFrame(({ camera, size, clock }) => {
    const ship = group.current
    if (!ship) return
    debugObjects.current.enterprise = ship
    const time = getCurrentTime()
    const anchorGroup = anchor.current
    const anchorScale = anchorGroup?.scale.x ?? 1
    anchorGroup?.updateWorldMatrix(true, false)
    anchorGroup?.getWorldPosition(anchorWorldPosition)
    const camera3d = camera as PerspectiveCamera
    const endY = ENTERPRISE_Y
    const requestedFocalDistance = PARABOLA_FOCAL_DISTANCE
    const focusX = POST_VERTEX_X - requestedFocalDistance
    const vertexZ = ENTERPRISE_DEPTH_OFFSET
    const approachStartMinX = APPROACH_START_MIN_X / Math.max(anchorScale, 1e-5)
    // The focus sits close to the vertex, keeping the inbound parabola narrow.
    const cameraDepth = Math.hypot(
      camera3d.position.x - anchorWorldPosition.x,
      camera3d.position.y - anchorWorldPosition.y,
      camera3d.position.z - anchorWorldPosition.z,
    )
    const viewTangent = Math.tan(MathUtils.degToRad(camera3d.fov) / 2)
    const halfViewHeight = (cameraDepth * viewTangent) / Math.max(anchorScale, 1e-5)
    const halfViewWidth = halfViewHeight * (size.width / size.height)
    const shipMargin = SHIP_SCALE
    const maxViewX = halfViewWidth - shipMargin
    // The Enterprise's center crosses X = -3 at APPROACH_START.
    const maxApproachDepth = Math.max(0.01, halfViewHeight - SHIP_SCALE * 0.12)
    const minimumFocalDistance = 0.05
    const maximumFocalDistance = Math.max(minimumFocalDistance, maxViewX - focusX)
    let parabolaP = Math.min(requestedFocalDistance, maximumFocalDistance)
    let approachDepth = maxApproachDepth
    for (let i = 0; i < 6; i++) {
      const horizontalOffset = approachStartMinX - focusX
      const focalDistanceForEntry =
        (horizontalOffset + Math.sqrt(horizontalOffset ** 2 + approachDepth ** 2)) / 2
      parabolaP = Math.max(
        minimumFocalDistance,
        Math.min(requestedFocalDistance, maximumFocalDistance, focalDistanceForEntry),
      )
      const depthToEntry = Math.sqrt(
        Math.max(0, 4 * parabolaP * (focusX + parabolaP - approachStartMinX)),
      )
      approachDepth = Math.min(maxApproachDepth, depthToEntry)
    }
    const vertexX = focusX + parabolaP
    const taxiDistance = POST_TAXI_TRAVEL_DISTANCE
    const warmupDistance = POST_WARMUP_TRAVEL_DISTANCE
    taxiStart.set(vertexX, endY, vertexZ)
    taxiEnd.set(vertexX, endY, vertexZ - taxiDistance)
    if (time < ENGINE_WARMUP_START) {
      warpDirectionReady.current = false
      warpDirection.set(0, 0, -1)
    }
    if (time >= TAXI_START && logoGroup.current && !warpDirectionReady.current) {
      if (!logoMeanReady.current) {
        logoMeanReady.current = meanGeometryPoint(logoGroup.current, logoMeanLocal)
      }
      if (logoMeanReady.current) {
        logoGroup.current.updateWorldMatrix(true, true)
        logoMeanWorld.copy(logoMeanLocal).applyMatrix4(logoGroup.current.matrixWorld)
        if (babyGroup.current) {
          if (!babyBackGeometryReady.current) {
            collectBackCenterlineSegments(babyGroup.current, babyBackCenterlineSegments)
            babyBackGeometryReady.current = babyBackCenterlineSegments.length > 0
          }
          babyBackCenterlineReady.current =
            babyBackGeometryReady.current &&
            nearestBackCenterlinePoint(
              babyGroup.current,
              babyBackCenterlineSegments,
              logoMeanWorld,
              babyBackCenterlineLocal,
            )
        }
        const aimPointWorld = babyBackCenterlineReady.current && babyGroup.current
          ? babyBackCenterlineWorld
              .copy(babyBackCenterlineLocal)
              .applyMatrix4(babyGroup.current.matrixWorld)
          : logoMeanWorld
        aimedPointLocal.copy(aimPointWorld)
        if (anchorGroup) anchorGroup.worldToLocal(aimedPointLocal)
        aimedDirection.copy(aimedPointLocal).sub(taxiEnd)
        if (aimedDirection.lengthSq() > 1e-8) aimedDirection.normalize()
        else aimedDirection.set(0, 0, -1)

        const taxiProgress = MathUtils.smoothstep(time, TAXI_START, ENGINE_WARMUP_START)
        warpDirection.set(0, 0, -1).lerp(aimedDirection, taxiProgress).normalize()
        if (time >= ENGINE_WARMUP_START) {
          warpDirection.copy(aimedDirection)
          warpDirectionReady.current = true
        }
      }
    }
    warpStart.copy(taxiEnd).addScaledVector(warpDirection, warmupDistance)
    const preApproachStartX =
      approachStartMinX - SHIP_SCALE * shipHalfExtents.x
    const preApproachDepth = Math.sqrt(
      Math.max(0, 4 * parabolaP * (vertexX - preApproachStartX)),
    )
    const warpDepth = taxiDistance + warmupDistance

    const updateWarpContrail = (progress: number, opacity: number, dissipation = -0.1) => {
      const travel = progress ** 1.35
      const warpStretch = 1 + progress * WARP_STRETCH
      const distance = WARP_DISTANCE * travel
      const shipX = warpStart.x + warpDirection.x * distance
      const shipY = warpStart.y + warpDirection.y * distance
      const shipZ = warpStart.z + warpDirection.z * distance
      const trailLength = Math.max(
        0.01,
        // Compensate for ship stretch so the contrail's far end stays at the nozzle's warp-start position.
        distance + SHIP_SCALE * (1 - warpStretch) * ENGINE_OUTLET_Z,
      )
      if (warpContrail.current) {
        warpContrail.current.visible = opacity > 0.01
        warpContrail.current.position.set(shipX, shipY, shipZ)
        contrailBackward.copy(warpDirection).negate()
        contrailRotation.setFromUnitVectors(contrailForward, contrailBackward)
        warpContrail.current.quaternion.copy(contrailRotation)
      }
      for (const [trail, side] of [[leftContrail.current, -1], [rightContrail.current, 1]] as const) {
        if (!trail) continue
        trail.position.set(
          side * ENGINE_OUTLET_X * SHIP_SCALE,
          ENGINE_OUTLET_Y * SHIP_SCALE,
          ENGINE_OUTLET_Z * SHIP_SCALE * warpStretch + trailLength * 0.5,
        )
        trail.scale.set(1, trailLength, 1)
      }
      contrailMaterial.uniforms.uOpacity.value = opacity
      contrailMaterial.uniforms.uDissipation.value = dissipation
    }

    if (time >= WARP_START + WARP_DURATION) {
      ship.visible = false
      debugObjects.current.enterpriseDirection = warpDirection
      engineBurn.current && (engineBurn.current.visible = false)
      engineCore.current && (engineCore.current.visible = false)
      const elapsed = time - (WARP_START + WARP_DURATION)
      const fadeProgress = MathUtils.smoothstep(elapsed, 0, WARP_TRAIL_FADE)
      const dissipation = fadeProgress
      const residualOpacity = MathUtils.lerp(0.95, 0.015, fadeProgress)
      updateWarpContrail(1, residualOpacity, dissipation)
      return
    }

    ship.visible = time >= APPROACH_START
    if (warpContrail.current) warpContrail.current.visible = false

    let x: number
    let y: number
    let z: number
    let stretch = 1
    let opacity = 0.82
    let burn = 0
    let roll = 0

    if (time < WARP_START) {
      // Time-space waypoints constrain X at approach, taxi turn, engine warmup, and warp.
      const preArc = parabolaArcLength(preApproachDepth, parabolaP)
      const entryArc = parabolaArcLength(approachDepth, parabolaP)
      const leadDistance = preArc - entryArc
      const approachDistance = entryArc
      const entrySpeed =
        0.8 * Math.min(leadDistance / APPROACH_START, approachDistance / (TAXI_START - APPROACH_START))
      const warmupSpeed =
        POST_TAXI_SPEED_FACTOR * Math.min(
          taxiDistance / (ENGINE_WARMUP_START - TAXI_START),
          warmupDistance / (WARP_START - ENGINE_WARMUP_START),
        )

      let distanceFromStart = 0
      if (time < APPROACH_START) {
        distanceFromStart = interpolatePathDistance(
          time / APPROACH_START,
          leadDistance,
          APPROACH_START,
          0,
          entrySpeed,
        )
      } else if (time < TAXI_START) {
        distanceFromStart =
          leadDistance +
          interpolatePathDistance(
            (time - APPROACH_START) / (TAXI_START - APPROACH_START),
            approachDistance,
            TAXI_START - APPROACH_START,
            entrySpeed,
            0,
          )
      }

      if (time < TAXI_START) {
        const targetArcLength = preArc - distanceFromStart
        const q = arcParameterAtLength(
          targetArcLength,
          Math.max(preApproachDepth, warpDepth),
          parabolaP,
          -warpDepth,
          preApproachDepth,
        )
        z = vertexZ + q
        x = vertexX - (q * q) / (4 * parabolaP)
        y = endY
        const pathSlope = -q / (2 * parabolaP)
        movementDirection.set(-pathSlope, 0, -1).normalize()
      } else if (time < ENGINE_WARMUP_START) {
        const pathDistance = interpolatePathDistance(
          (time - TAXI_START) / (ENGINE_WARMUP_START - TAXI_START),
          taxiDistance,
          ENGINE_WARMUP_START - TAXI_START,
          0,
          warmupSpeed,
        )
        const taxiProgress = MathUtils.clamp(pathDistance / taxiDistance, 0, 1)
        taxiCurvePoint(
          taxiProgress,
          taxiStart,
          taxiEnd,
          warpDirection,
          pathPoint,
          pathTangent,
          pathEndTangent,
        )
        x = pathPoint.x
        y = pathPoint.y
        z = pathPoint.z
        taxiCurveDirection(
          taxiProgress,
          taxiStart,
          taxiEnd,
          warpDirection,
          movementDirection,
          pathTangent,
          pathEndTangent,
        )
      } else {
        const pathDistance = interpolatePathDistance(
          (time - ENGINE_WARMUP_START) / (WARP_START - ENGINE_WARMUP_START),
          warmupDistance,
          WARP_START - ENGINE_WARMUP_START,
          warmupSpeed,
          0,
        )
        pathPoint.copy(taxiEnd).addScaledVector(warpDirection, pathDistance)
        x = pathPoint.x
        y = pathPoint.y
        z = pathPoint.z
        movementDirection.copy(warpDirection)
      }
      debugObjects.current.enterpriseDirection = movementDirection
      const approachProgress = MathUtils.clamp(
        (time - APPROACH_START) / (TAXI_START - APPROACH_START),
        0,
        1,
      )
      const taxiProgress = MathUtils.clamp(
        (time - TAXI_START) / (WARP_START - TAXI_START),
        0,
        1,
      )
      const flightProgress = MathUtils.clamp(
        (time - APPROACH_START) / (WARP_START - APPROACH_START),
        0,
        1,
      )
      roll =
        Math.sin(flightProgress * Math.PI * 1.5) *
        0.13 *
        (1 - MathUtils.smoothstep(time, TAXI_START, ENGINE_WARMUP_START))
      burn =
        time < APPROACH_START
          ? 0
          : MathUtils.clamp(
              4 * (time < TAXI_START ? approachProgress : taxiProgress) *
                (1 - (time < TAXI_START ? approachProgress : taxiProgress)),
              0,
              1,
            )
    } else {
      const progress = MathUtils.clamp((time - WARP_START) / WARP_DURATION, 0, 1)
      const travel = progress ** 1.35
      const distance = WARP_DISTANCE * travel
      stretch = 1 + progress * WARP_STRETCH
      x = warpStart.x + warpDirection.x * distance
      y = warpStart.y + warpDirection.y * distance
      z = warpStart.z + warpDirection.z * distance
      movementDirection.copy(warpDirection)
      debugObjects.current.enterpriseDirection = movementDirection
      opacity = 0.82 * (1 - MathUtils.smoothstep(progress, 0.72, 1))
      burn = MathUtils.clamp(progress * 12, 0, 1) * (1 - MathUtils.smoothstep(progress, 0.82, 1))
      updateWarpContrail(progress, MathUtils.clamp(progress * 12, 0, 1))
    }

    ship.position.set(x, y, z)
    ship.quaternion.setFromUnitVectors(localForward, movementDirection)
    ship.rotateZ(roll)
    const warpCompression = time >= WARP_START ? 1 - 0.45 * MathUtils.clamp((time - WARP_START) / WARP_DURATION, 0, 1) : 1
    ship.scale.set(SHIP_SCALE * warpCompression, SHIP_SCALE * warpCompression, SHIP_SCALE * stretch)
    material.opacity = opacity
    const warmup = MathUtils.smoothstep(time, ENGINE_WARMUP_START, WARP_START)
    if (engineBurn.current) {
      const inWarmup = time >= ENGINE_WARMUP_START && time < WARP_START
      const warpProgress = MathUtils.clamp((time - WARP_START) / WARP_DURATION, 0, 1)
      engineBurn.current.visible = !inWarmup && burn > 0.015
      const beamLength = time >= WARP_START ? 1 + WARP_TAIL_LENGTH * warpProgress ** 0.35 : 1
      engineBurn.current.scale.y = beamLength / stretch
      if (inWarmup) {
        flameMaterial.opacity = 0
      } else {
        const taxiFlameOpacity = time >= TAXI_START && time < ENGINE_WARMUP_START ? 0.055 : 0.9
        flameMaterial.opacity = taxiFlameOpacity * burn
      }
    }
    const warmupPulse = 0.78 + (0.22 * (Math.sin(clock.elapsedTime * 10) + 1)) / 2
    const approachFlareRamp =
      MathUtils.smoothstep(time, APPROACH_START, TAXI_START) *
      (1 - MathUtils.smoothstep(time, TAXI_START, TAXI_START + TAXI_FLARE_FADE_DURATION))
    const approachCoreGlow = approachFlareRamp * warmupPulse * 0.52
    const coreGlow = approachCoreGlow + warmup ** 1.6 * warmupPulse * 2.8
    if (engineCore.current) {
      engineCore.current.visible = coreGlow > 0.015
      engineCore.current.scale.set(1, 1 / stretch, 1)
      flameCoreMaterial.opacity = coreGlow
    }
    const coreSphereScale = 0.75 + warmup * 0.45
    for (const core of engineCoreFlames.current) {
      if (core) core.scale.setScalar(coreSphereScale)
    }
    const warmupFlareRamp = MathUtils.smoothstep(
      time,
      ENGINE_WARMUP_START + WARMUP_FLARE_LEAD,
      WARP_START,
    )
    const flareIntensity = approachFlareRamp * 0.3 + warmupFlareRamp ** 1.5 * 1.8
    engineFlareMaterial.uniforms.uIntensity.value = flareIntensity
    const flareSize = 0.025 + approachFlareRamp * 0.04 + warmupFlareRamp * 0.2
    for (const flare of engineFlares.current) {
      if (!flare) continue
      flare.visible = flareIntensity > 0.01
      flare.scale.set(flareSize, flareSize, 1)
    }
  })

  useEffect(
    () => () => {
      material.dispose()
      flameGeometry.dispose()
      flameCoreGeometry.dispose()
      engineFlareGeometry.dispose()
      contrailGeometry.dispose()
      flameMaterial.dispose()
      flameCoreMaterial.dispose()
      engineFlareMaterial.dispose()
      contrailMaterial.dispose()
    },
    [contrailGeometry, contrailMaterial, engineFlareGeometry, engineFlareMaterial, flameCoreGeometry, flameCoreMaterial, flameGeometry, flameMaterial, material],
  )
  useEffect(
    () => () => {
      if (debugObjects.current.enterprise === group.current) {
        debugObjects.current.enterprise = null
        debugObjects.current.enterpriseDirection = null
      }
    },
    [debugObjects],
  )

  return (
    <>
      <group ref={group} visible={false}>
        <primitive object={normalized} dispose={null} />
        <group ref={engineBurn} position={[0, ENGINE_OUTLET_Y, ENGINE_OUTLET_Z]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh geometry={flameGeometry} material={flameMaterial} position={[-ENGINE_OUTLET_X, 0.185, 0]} />
          <mesh geometry={flameGeometry} material={flameMaterial} position={[ENGINE_OUTLET_X, 0.185, 0]} />
        </group>
        <group ref={engineCore} position={[0, ENGINE_OUTLET_Y, ENGINE_OUTLET_Z]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh
            ref={(mesh) => { engineCoreFlames.current[0] = mesh }}
            geometry={flameCoreGeometry}
            material={flameCoreMaterial}
            position={[-ENGINE_OUTLET_X, 0.025, 0]}
          />
          <mesh
            ref={(mesh) => { engineCoreFlames.current[1] = mesh }}
            geometry={flameCoreGeometry}
            material={flameCoreMaterial}
            position={[ENGINE_OUTLET_X, 0.025, 0]}
          />
        </group>
        <mesh
          ref={(mesh) => { engineFlares.current[0] = mesh }}
          geometry={engineFlareGeometry}
          material={engineFlareMaterial}
          position={[-ENGINE_OUTLET_X, ENGINE_OUTLET_Y, ENGINE_OUTLET_Z + 0.035]}
          visible={false}
        />
        <mesh
          ref={(mesh) => { engineFlares.current[1] = mesh }}
          geometry={engineFlareGeometry}
          material={engineFlareMaterial}
          position={[ENGINE_OUTLET_X, ENGINE_OUTLET_Y, ENGINE_OUTLET_Z + 0.035]}
          visible={false}
        />
      </group>
      <group ref={warpContrail} visible={false}>
        <mesh ref={leftContrail} geometry={contrailGeometry} material={contrailMaterial} rotation={[Math.PI / 2, 0, 0]} />
        <mesh ref={rightContrail} geometry={contrailGeometry} material={contrailMaterial} rotation={[Math.PI / 2, 0, 0]} />
      </group>
    </>
  )
}
