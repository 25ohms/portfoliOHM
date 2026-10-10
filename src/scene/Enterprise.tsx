import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import {
  AdditiveBlending,
  Box3,
  CylinderGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  ShaderMaterial,
  Vector3,
} from 'three'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { useMusicPlayer } from '../audio/MusicPlayer'
import enterpriseUrl from '../../models/enterprise/uss-enterprise.obj?url'

const APPROACH_START = 22
const TAXI_START = 70
const TAXI_END = 92
const ENGINE_WARMUP_START = 87
const WARP_START = 93
const WARP_DURATION = 0.4
const WARP_TRAIL_FADE = 1.6
const WARP_STRETCH = 150
const WARP_DESTINATION_Z = -1000
const SHIP_SCALE = 0.93
const APPROACH_YAW = MathUtils.degToRad(-135)
const ENGINE_OUTLET_X = 0.265
const ENGINE_OUTLET_Y = 0.174
const ENGINE_OUTLET_Z = 0.999

export default function Enterprise({ anchor }: { anchor: React.RefObject<Group | null> }) {
  const source = useLoader(OBJLoader, enterpriseUrl)
  const { getCurrentTime } = useMusicPlayer()
  const group = useRef<Group>(null)
  const engineBurn = useRef<Group>(null)
  const engineCore = useRef<Group>(null)
  const warpContrail = useRef<Group>(null)
  const leftContrail = useRef<Mesh>(null)
  const rightContrail = useRef<Mesh>(null)
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
  const flameGeometry = useMemo(() => new CylinderGeometry(0, 0.026, 0.34, 7), [])
  const flameCoreGeometry = useMemo(() => new CylinderGeometry(0, 0.045, 0.12, 7), [])
  const flameMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#64eaff',
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
        color: '#eaffff',
        transparent: true,
        opacity: 0,
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
    const time = getCurrentTime()
    if (time < APPROACH_START) {
      ship.visible = false
      if (warpContrail.current) warpContrail.current.visible = false
      return
    }
    const camera3d = camera as PerspectiveCamera
    const anchorGroup = anchor.current
    const anchorX = anchorGroup?.position.x ?? 0
    const anchorY = anchorGroup?.position.y ?? 0
    const anchorZ = anchorGroup?.position.z ?? 0
    const anchorScale = anchorGroup?.scale.x ?? 1
    const endX = anchorX + anchorScale * 1.35
    const endY = anchorY + anchorScale * 0.7
    const endZ = anchorZ + 0.65

    const updateWarpContrail = (progress: number, opacity: number, dissipation = -0.1) => {
      const travel = progress ** 1.35
      const warpStretch = 1 + progress * WARP_STRETCH
      const shipZ = MathUtils.lerp(endZ, WARP_DESTINATION_Z, travel)
      const engineZ = shipZ + SHIP_SCALE * warpStretch * ENGINE_OUTLET_Z
      const startEngineZ = endZ + SHIP_SCALE * ENGINE_OUTLET_Z
      const trailLength = Math.max(0.01, startEngineZ - engineZ)
      if (warpContrail.current) {
        warpContrail.current.visible = opacity > 0.01
        warpContrail.current.position.set(endX, endY + ENGINE_OUTLET_Y * SHIP_SCALE, engineZ)
      }
      for (const [trail, side] of [[leftContrail.current, -1], [rightContrail.current, 1]] as const) {
        if (!trail) continue
        trail.position.set(side * ENGINE_OUTLET_X * SHIP_SCALE, trailLength * 0.5, 0)
        trail.scale.set(1, trailLength, 1)
      }
      contrailMaterial.uniforms.uOpacity.value = opacity
      contrailMaterial.uniforms.uDissipation.value = dissipation
    }

    if (time >= WARP_START + WARP_DURATION) {
      ship.visible = false
      engineBurn.current && (engineBurn.current.visible = false)
      engineCore.current && (engineCore.current.visible = false)
      const elapsed = time - (WARP_START + WARP_DURATION)
      const fadeProgress = MathUtils.smoothstep(elapsed, 0, WARP_TRAIL_FADE)
      const dissipation = fadeProgress
      const residualOpacity = MathUtils.lerp(0.95, 0.015, fadeProgress)
      updateWarpContrail(1, residualOpacity, dissipation)
      return
    }

    ship.visible = true
    if (warpContrail.current) warpContrail.current.visible = false

    let x: number
    let y: number
    let z: number
    let yaw: number
    let stretch = 1
    let opacity = 0.82
    let burn = 0

    if (time < TAXI_START) {
      const progress = MathUtils.clamp((time - APPROACH_START) / (TAXI_START - APPROACH_START), 0, 1)
      const eased = MathUtils.smootherstep(progress, 0, 1)
      const startZ = -4.5
      const distance = camera3d.position.z - startZ
      const halfViewWidth =
        distance * Math.tan(MathUtils.degToRad(camera3d.fov) / 2) * (size.width / size.height)
      x = MathUtils.lerp(-halfViewWidth - 0.5, endX, eased)
      y = MathUtils.lerp(anchorY - 0.35, endY, eased) + Math.sin(progress * Math.PI) ** 2 * 0.18
      z = MathUtils.lerp(startZ, endZ, eased)
      yaw = APPROACH_YAW
      burn = MathUtils.clamp(4 * progress * (1 - progress), 0, 1)
    } else if (time < WARP_START) {
      x = endX
      y = endY
      z = endZ
      const taxiProgress = MathUtils.clamp((time - TAXI_START) / (TAXI_END - TAXI_START), 0, 1)
      yaw = APPROACH_YAW * (1 - MathUtils.smoothstep(taxiProgress, 0, 1))
    } else {
      x = endX
      y = endY
      const progress = MathUtils.clamp((time - WARP_START) / WARP_DURATION, 0, 1)
      const travel = progress ** 1.35
      stretch = 1 + progress * WARP_STRETCH
      z = MathUtils.lerp(endZ, WARP_DESTINATION_Z, travel)
      yaw = 0
      opacity = 0.82 * (1 - MathUtils.smoothstep(progress, 0.72, 1))
      burn = MathUtils.clamp(progress * 12, 0, 1) * (1 - MathUtils.smoothstep(progress, 0.82, 1))
      updateWarpContrail(progress, MathUtils.clamp(progress * 12, 0, 1))
    }

    ship.position.set(x, y, z)
    ship.rotation.set(0, yaw, 0)
    const warpCompression = time >= WARP_START ? 1 - 0.45 * MathUtils.clamp((time - WARP_START) / WARP_DURATION, 0, 1) : 1
    ship.scale.set(SHIP_SCALE * warpCompression, SHIP_SCALE * warpCompression, SHIP_SCALE * stretch)
    material.opacity = opacity
    if (engineBurn.current) {
      engineBurn.current.visible = burn > 0.015
      const beamLength = time >= WARP_START ? 40 : 1
      engineBurn.current.scale.y = beamLength / stretch
      flameMaterial.opacity = 0.9 * burn
    }
    const warmup = MathUtils.smoothstep(time, ENGINE_WARMUP_START, WARP_START)
    const warmupPulse = 0.78 + (0.22 * (Math.sin(clock.elapsedTime * 10) + 1)) / 2
    const coreGlow = Math.max(Math.min(1, burn * 1.4), warmup * warmupPulse)
    if (engineCore.current) {
      engineCore.current.visible = coreGlow > 0.015
      engineCore.current.scale.y = 1 / stretch
      flameCoreMaterial.opacity = coreGlow
    }
  })

  useEffect(
    () => () => {
      material.dispose()
      flameGeometry.dispose()
      flameCoreGeometry.dispose()
      contrailGeometry.dispose()
      flameMaterial.dispose()
      flameCoreMaterial.dispose()
      contrailMaterial.dispose()
    },
    [contrailGeometry, contrailMaterial, flameCoreGeometry, flameCoreMaterial, flameGeometry, flameMaterial, material],
  )

  return (
    <>
      <group ref={group} visible={false}>
        <primitive object={normalized} dispose={null} />
        <group ref={engineBurn} position={[0, ENGINE_OUTLET_Y, ENGINE_OUTLET_Z]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh geometry={flameGeometry} material={flameMaterial} position={[-ENGINE_OUTLET_X, 0.17, 0]} />
          <mesh geometry={flameGeometry} material={flameMaterial} position={[ENGINE_OUTLET_X, 0.17, 0]} />
        </group>
        <group ref={engineCore} position={[0, ENGINE_OUTLET_Y, ENGINE_OUTLET_Z]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh geometry={flameCoreGeometry} material={flameCoreMaterial} position={[-ENGINE_OUTLET_X, 0.06, 0]} />
          <mesh geometry={flameCoreGeometry} material={flameCoreMaterial} position={[ENGINE_OUTLET_X, 0.06, 0]} />
        </group>
      </group>
      <group ref={warpContrail} visible={false} rotation={[Math.PI / 2, 0, 0]}>
        <mesh ref={leftContrail} geometry={contrailGeometry} material={contrailMaterial} />
        <mesh ref={rightContrail} geometry={contrailGeometry} material={contrailMaterial} />
      </group>
    </>
  )
}
