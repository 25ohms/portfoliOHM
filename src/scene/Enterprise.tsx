import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import {
  AdditiveBlending,
  Box3,
  CircleGeometry,
  CylinderGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  SphereGeometry,
  ShaderMaterial,
  Vector3,
} from 'three'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { useMusicPlayer } from '../audio/MusicPlayer'
import type { SceneDebugObjects } from './SceneContents'
import enterpriseUrl from '../../models/enterprise/uss-enterprise.obj?url'

const APPROACH_START = 22
const TAXI_START = 70
const ENGINE_WARMUP_START = 87
const WARP_START = 93
const WARP_DURATION = 0.4
const WARP_TRAIL_FADE = 1.6
const WARP_STRETCH = 150
const WARP_TAIL_LENGTH = 90
const WARP_DISTANCE = 1000
const SHIP_SCALE = 0.93
const ENTERPRISE_Y = 0.5
const APPROACH_START_MIN_X = -3
const POST_VERTEX_X = 1.45
const POST_TAXI_TRAVEL_DISTANCE = 0.75
const POST_WARMUP_TRAVEL_DISTANCE = 0.05
const ENGINE_OUTLET_X = 0.265
const ENGINE_OUTLET_Y = 0.174
const ENGINE_OUTLET_Z = 0.999
const PARABOLA_FOCAL_DISTANCE = 0.1
const POST_TAXI_SPEED_FACTOR = 0.4

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

export default function Enterprise({
  anchor,
  debugObjects,
}: {
  anchor: React.RefObject<Group | null>
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
  const contrailGeometry = useMemo(() => new CylinderGeometry(0.004, 0.024, 1, 7, 24), [])
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
    const anchorX = anchorGroup?.position.x ?? 0
    const anchorY = anchorGroup?.position.y ?? 0
    const anchorZ = anchorGroup?.position.z ?? 0
    const anchorScale = anchorGroup?.scale.x ?? 1
    const camera3d = camera as PerspectiveCamera
    const endY = ENTERPRISE_Y
    const requestedFocalDistance = anchorScale * PARABOLA_FOCAL_DISTANCE
    const focusX = anchorX + POST_VERTEX_X - requestedFocalDistance
    const vertexZ = anchorZ
    // The focus sits close to the vertex, keeping the inbound parabola narrow.
    const cameraDepth = Math.hypot(
      camera3d.position.x - anchorX,
      camera3d.position.y - anchorY,
      camera3d.position.z - anchorZ,
    )
    const viewTangent = Math.tan(MathUtils.degToRad(camera3d.fov) / 2)
    const halfViewHeight = cameraDepth * viewTangent
    const halfViewWidth = halfViewHeight * (size.width / size.height)
    const shipMargin = SHIP_SCALE
    const maxViewX = halfViewWidth - shipMargin
    // The Enterprise's center crosses X = -3 at APPROACH_START.
    const maxApproachDepth = Math.max(0.01, halfViewHeight - SHIP_SCALE * 0.12)
    const minimumFocalDistance = anchorScale * 0.05
    const maximumFocalDistance = Math.max(minimumFocalDistance, maxViewX - focusX)
    let parabolaP = Math.min(requestedFocalDistance, maximumFocalDistance)
    let approachDepth = maxApproachDepth
    for (let i = 0; i < 6; i++) {
      const horizontalOffset = APPROACH_START_MIN_X - focusX
      const focalDistanceForEntry =
        (horizontalOffset + Math.sqrt(horizontalOffset ** 2 + approachDepth ** 2)) / 2
      parabolaP = Math.max(
        minimumFocalDistance,
        Math.min(requestedFocalDistance, maximumFocalDistance, focalDistanceForEntry),
      )
      const depthToEntry = Math.sqrt(
        Math.max(0, 4 * parabolaP * (focusX + parabolaP - APPROACH_START_MIN_X)),
      )
      approachDepth = Math.min(maxApproachDepth, depthToEntry)
    }
    const vertexX = focusX + parabolaP
    const preApproachStartX =
      APPROACH_START_MIN_X - SHIP_SCALE * shipHalfExtents.x
    const preApproachDepth = Math.sqrt(
      Math.max(0, 4 * parabolaP * (vertexX - preApproachStartX)),
    )
    const warmupDepth = POST_TAXI_TRAVEL_DISTANCE
    const warpDepth = warmupDepth + POST_WARMUP_TRAVEL_DISTANCE
    const endZ = vertexZ - warpDepth
    const endX = vertexX
    warpDirection.set(0, 0, -1)

    const updateWarpContrail = (progress: number, opacity: number, dissipation = -0.1) => {
      const travel = progress ** 1.35
      const warpStretch = 1 + progress * WARP_STRETCH
      const distance = WARP_DISTANCE * travel
      const shipX = endX + warpDirection.x * distance
      const shipZ = endZ + warpDirection.z * distance
      const trailLength = Math.max(
        0.01,
        // Compensate for ship stretch so the contrail's far end stays at the nozzle's warp-start position.
        distance + SHIP_SCALE * (1 - warpStretch) * ENGINE_OUTLET_Z,
      )
      if (warpContrail.current) {
        warpContrail.current.visible = opacity > 0.01
        warpContrail.current.position.set(shipX, endY, shipZ)
        warpContrail.current.rotation.set(0, Math.atan2(-warpDirection.x, -warpDirection.z), 0)
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
    let yaw = 0
    let roll = 0

    if (time < WARP_START) {
      // Time-space waypoints constrain X at approach, taxi turn, engine warmup, and warp.
      const preArc = parabolaArcLength(preApproachDepth, parabolaP)
      const entryArc = parabolaArcLength(approachDepth, parabolaP)
      const warmupArc = warmupDepth
      const warpArc = warpDepth
      const leadDistance = preArc - entryArc
      const approachDistance = entryArc
      const taxiDistance = warmupArc
      const warmupDistance = warpArc - warmupArc
      const entrySpeed =
        0.8 * Math.min(leadDistance / APPROACH_START, approachDistance / (TAXI_START - APPROACH_START))
      const warmupSpeed =
        POST_TAXI_SPEED_FACTOR * Math.min(
          taxiDistance / (ENGINE_WARMUP_START - TAXI_START),
          warmupDistance / (WARP_START - ENGINE_WARMUP_START),
        )

      let distanceFromStart: number
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
      } else if (time < ENGINE_WARMUP_START) {
        distanceFromStart =
          leadDistance +
          approachDistance +
          interpolatePathDistance(
            (time - TAXI_START) / (ENGINE_WARMUP_START - TAXI_START),
            taxiDistance,
            ENGINE_WARMUP_START - TAXI_START,
            0,
            warmupSpeed,
          )
      } else {
        distanceFromStart =
          leadDistance +
          approachDistance +
          taxiDistance +
          interpolatePathDistance(
            (time - ENGINE_WARMUP_START) / (WARP_START - ENGINE_WARMUP_START),
            warmupDistance,
            WARP_START - ENGINE_WARMUP_START,
            warmupSpeed,
            0,
          )
      }

      const targetArcLength = preArc - distanceFromStart
      const postTaxiDistance = distanceFromStart - leadDistance - approachDistance
      const q =
        time < TAXI_START
          ? arcParameterAtLength(
              targetArcLength,
              Math.max(preApproachDepth, warpDepth),
              parabolaP,
              -warpDepth,
              preApproachDepth,
            )
          : -postTaxiDistance
      z = vertexZ + q
      x = time < TAXI_START ? vertexX - (q * q) / (4 * parabolaP) : vertexX
      y = endY

      if (time < TAXI_START) {
        const pathSlope = -q / (2 * parabolaP)
        movementDirection.set(-pathSlope, 0, -1).normalize()
      } else {
        movementDirection.set(0, 0, -1)
      }
      debugObjects.current.enterpriseDirection = movementDirection
      // The Enterprise model points forward along local -Z; yaw aligns that axis to the path tangent.
      yaw = Math.atan2(-movementDirection.x, -movementDirection.z)
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
      x = endX
      y = endY
      const progress = MathUtils.clamp((time - WARP_START) / WARP_DURATION, 0, 1)
      const travel = progress ** 1.35
      const distance = WARP_DISTANCE * travel
      stretch = 1 + progress * WARP_STRETCH
      x = endX + warpDirection.x * distance
      z = endZ + warpDirection.z * distance
      movementDirection.copy(warpDirection)
      debugObjects.current.enterpriseDirection = movementDirection
      yaw = Math.atan2(-movementDirection.x, -movementDirection.z)
      opacity = 0.82 * (1 - MathUtils.smoothstep(progress, 0.72, 1))
      burn = MathUtils.clamp(progress * 12, 0, 1) * (1 - MathUtils.smoothstep(progress, 0.82, 1))
      updateWarpContrail(progress, MathUtils.clamp(progress * 12, 0, 1))
    }

    ship.position.set(x, y, z)
    ship.rotation.set(0, yaw, roll)
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
      (1 - MathUtils.smoothstep(time, TAXI_START, TAXI_START + 0.4))
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
    const warmupFlareRamp = MathUtils.smoothstep(time, ENGINE_WARMUP_START + 0.5, WARP_START)
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
