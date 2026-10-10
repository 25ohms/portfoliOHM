import { Suspense, useEffect, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, MathUtils, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { SceneConfig, Vec3 } from '../config/scene'
import Fetus from './Fetus'
import Logo from './Logo'
import Stars from './Stars'
import Nebula from './Nebula'
import PalettePass from './PalettePass'
import { cameraDistance } from './math'
import Enterprise from './Enterprise'
import { useMusicPlayer } from '../audio/MusicPlayer'
import { recordSceneFrame } from '../utils/performanceLogger'

export interface RuntimeScene {
  pose: MutableRefObject<Vec3>
  invalidate: MutableRefObject<() => void>
  dragging: MutableRefObject<boolean>
}

export type CameraView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'xz'
export interface SceneDebugObjects {
  baby: Group | null
  enterprise: Group | null
  enterpriseDirection: Vector3 | null
  cursorNdc: { x: number; y: number } | null
  cursorProjection: { x: number; y: number; z: number } | null
}

export default function SceneContents({
  config,
  runtime,
  running,
  rotationEnabled,
  cardOpen,
  resolution,
  onReady,
  onSlow,
  cameraView,
  debugObjects,
}: {
  config: SceneConfig
  runtime: RuntimeScene
  running: boolean
  rotationEnabled: boolean
  cardOpen: boolean
  resolution: number
  onReady: () => void
  onSlow: () => void
  cameraView: CameraView
  debugObjects: MutableRefObject<SceneDebugObjects>
}) {
  const group = useRef<Group>(null)
  const { currentTrack, playing } = useMusicPlayer()
  const showEnterprise =
    playing &&
    currentTrack?.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') === 'finalfrontier'
  const layoutTarget = useRef({ x: config.model.position[0], scale: config.model.scale })
  const { camera, size, invalidate } = useThree()
  const projectionRaycaster = useRef(new Raycaster())
  const projectionPlane = useRef(new Plane())
  const projectionHit = useRef(new Vector3())
  const projectionNormal = useRef(new Vector3())
  const projectionNdc = useRef(new Vector2())
  const samples = useRef({ elapsed: 0, frames: 0, reported: false, warmup: 0 })
  useEffect(() => {
    runtime.invalidate.current = invalidate
    return () => {
      runtime.invalidate.current = () => {}
    }
  }, [runtime, invalidate])
  useEffect(() => {
    const perspective = camera as PerspectiveCamera
    perspective.fov = config.camera.fov
    const distance = cameraDistance(
      size.width / size.height,
      config.camera.fov,
      1.12,
      config.camera.padding,
    )
    perspective.up.set(0, 1, 0)
    switch (cameraView) {
      case 'back':
        perspective.position.set(0, 0, -distance)
        break
      case 'left':
        perspective.position.set(-distance, 0, 0)
        break
      case 'right':
        perspective.position.set(distance, 0, 0)
        break
      case 'top':
        perspective.position.set(0, distance, 0)
        perspective.up.set(0, 0, -1)
        break
      case 'bottom':
        perspective.position.set(0, -distance, 0)
        perspective.up.set(0, 0, 1)
        break
      case 'xz':
        perspective.position.set(0, -distance, 0)
        perspective.up.set(0, 0, 1)
        break
      default:
        perspective.position.set(0, 0, distance)
    }
    perspective.lookAt(0, 0, 0)
    perspective.updateProjectionMatrix()
    invalidate()
  }, [camera, cameraView, config.camera, size, invalidate])
  useEffect(() => {
    let offsetX = 0
    let scale = config.model.scale
    if (cardOpen) {
      const experience = document.querySelector<HTMLElement>('.experience')
      const rail = document.querySelector<HTMLElement>('.dial-rail')
      const card = document.querySelector<HTMLElement>('.content-card')
      if (experience && rail && card) {
        const experienceRect = experience.getBoundingClientRect()
        const railRect = rail.getBoundingClientRect()
        const cardRect = card.getBoundingClientRect()
        const openWidth = Math.max(0, cardRect.left - railRect.right)
        const centerX = (railRect.right + cardRect.left) / 2 - experienceRect.left
        const fraction = centerX / experienceRect.width - 0.5
        const worldWidth =
          (2 *
            camera.position.z *
            Math.tan(MathUtils.degToRad(config.camera.fov) / 2) *
            size.width) /
          size.height
        offsetX = fraction * worldWidth
        scale =
          config.model.scale *
          MathUtils.clamp((openWidth / experienceRect.width) * 1.75, 0.42, 0.82)
      }
    }
    layoutTarget.current = { x: config.model.position[0] + offsetX, scale }
    invalidate()
  }, [
    cardOpen,
    camera,
    config.camera.fov,
    config.model.position,
    config.model.scale,
    size,
    invalidate,
  ])
  useFrame((_, delta) => {
    recordSceneFrame(delta * 1000)
    const cursorNdc = import.meta.env.DEV ? debugObjects.current.cursorNdc : null
    if (cursorNdc && group.current) {
      const baby = group.current.position
      let planeOffset: number
      if (cameraView === 'front' || cameraView === 'back') {
        projectionNormal.current.set(0, 0, 1)
        planeOffset = -baby.z
      } else if (cameraView === 'left' || cameraView === 'right') {
        projectionNormal.current.set(1, 0, 0)
        planeOffset = -baby.x
      } else {
        projectionNormal.current.set(0, 1, 0)
        planeOffset = -baby.y
      }
      projectionPlane.current.set(projectionNormal.current, planeOffset)
      projectionNdc.current.set(cursorNdc.x, cursorNdc.y)
      projectionRaycaster.current.setFromCamera(projectionNdc.current, camera)
      const hit = projectionRaycaster.current.ray.intersectPlane(
        projectionPlane.current,
        projectionHit.current,
      )
      if (hit) {
        const previous = debugObjects.current.cursorProjection
        if (previous) {
          previous.x = hit.x
          previous.y = hit.y
          previous.z = hit.z
        } else {
          debugObjects.current.cursorProjection = { x: hit.x, y: hit.y, z: hit.z }
        }
      } else {
        debugObjects.current.cursorProjection = null
      }
    } else {
      debugObjects.current.cursorProjection = null
    }
    if (running && rotationEnabled && !runtime.dragging.current) {
      runtime.pose.current[1] =
        (runtime.pose.current[1] + Math.min(delta, 0.05) * config.motion.speed) % (Math.PI * 2)
    }
    if (group.current) {
      debugObjects.current.baby = group.current
      group.current.rotation.set(...runtime.pose.current)
      const smoothing = 1 - Math.exp(-Math.min(delta, 0.05) * 8)
      group.current.position.x = MathUtils.lerp(
        group.current.position.x,
        layoutTarget.current.x,
        smoothing,
      )
      group.current.position.y = MathUtils.lerp(
        group.current.position.y,
        config.model.position[1],
        smoothing,
      )
      group.current.position.z = MathUtils.lerp(
        group.current.position.z,
        config.model.position[2],
        smoothing,
      )
      group.current.scale.setScalar(
        MathUtils.lerp(group.current.scale.x, layoutTarget.current.scale, smoothing),
      )
    }
    if (running && !samples.current.reported) {
      const s = samples.current
      s.warmup += delta
      if (s.warmup > 2 && delta < 0.2) {
        s.elapsed += delta
        s.frames++
      }
      if (s.elapsed > 3) {
        if (s.frames / s.elapsed < 42) {
          s.reported = true
          onSlow()
        }
        s.elapsed = 0
        s.frames = 0
      }
    }
  })
  return (
    <>
      <color attach="background" args={['#000000']} />
      <Nebula />
      <Stars config={config.stars} />
      <group ref={group} position={config.model.position} scale={config.model.scale}>
        <Suspense fallback={null}>
          <>
            <group position={config.logo.position} rotation={config.logo.rotation} scale={0.42}>
              <Logo config={config} />
            </group>
            <Fetus config={config} onReady={onReady} />
          </>
        </Suspense>
      </group>
      {showEnterprise && (
        <Suspense fallback={null}>
          <Enterprise anchor={group} debugObjects={debugObjects} />
        </Suspense>
      )}
      <PalettePass config={config} resolution={resolution} />
    </>
  )
}
