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
import {
  ENGINE_WARMUP_START,
  TAXI_START,
  WARP_END,
  WARP_START,
  isFinalFrontierTrack,
} from './sceneTimeline'

const TAXI_SUBJECT_SCALE = 4.5
const TAXI_SUBJECT_Y_OFFSET = 2.5
const TAXI_SUBJECT_X_ROTATION = MathUtils.degToRad(-30)
const DEFAULT_CAMERA_ORBIT = { theta: 0, phi: Math.PI / 2 }

export interface RuntimeScene {
  pose: MutableRefObject<Vec3>
  invalidate: MutableRefObject<() => void>
  dragging: MutableRefObject<boolean>
  cameraOrbit: MutableRefObject<{ theta: number; phi: number }>
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
  debugObjects: MutableRefObject<SceneDebugObjects>
}) {
  const cameraView: CameraView = 'front'
  const group = useRef<Group>(null)
  const subjectGroup = useRef<Group>(null)
  const babyGroup = useRef<Group>(null)
  const logoGroup = useRef<Group>(null)
  const { currentTrack, playing, getCurrentTime } = useMusicPlayer()
  const isFinalFrontier = isFinalFrontierTrack(currentTrack?.title)
  const showEnterprise = playing && isFinalFrontier
  const layoutTarget = useRef({ x: config.model.position[0], scale: config.model.scale })
  const layoutAnimating = useRef(false)
  const { camera, size, invalidate } = useThree()
  const projectionRaycaster = useRef(new Raycaster())
  const projectionPlane = useRef(new Plane())
  const projectionHit = useRef(new Vector3())
  const projectionNormal = useRef(new Vector3())
  const projectionNdc = useRef(new Vector2())
  const cameraTarget = useRef(new Vector3())
  const cameraTargetOffset = useRef(new Vector3())
  const groupWorldOrigin = useRef(new Vector3())
  const warpOrbitStart = useRef<{ theta: number; phi: number; progress: number } | null>(null)
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
    const views: Record<CameraView, { theta: number; phi: number }> = {
      front: { theta: 0, phi: Math.PI / 2 },
      back: { theta: Math.PI, phi: Math.PI / 2 },
      left: { theta: -Math.PI / 2, phi: Math.PI / 2 },
      right: { theta: Math.PI / 2, phi: Math.PI / 2 },
      top: { theta: 0, phi: 0.08 },
      bottom: { theta: 0, phi: Math.PI - 0.08 },
      xz: { theta: 0, phi: Math.PI - 0.08 },
    }
    runtime.cameraOrbit.current = { ...views[cameraView] }
    perspective.position.set(0, 0, distance)
    perspective.lookAt(0, 0, 0)
    perspective.updateProjectionMatrix()
    invalidate()
  }, [camera, cameraView, config.camera, size, invalidate, runtime])
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
            cameraDistance(size.width / size.height, config.camera.fov, 1.12, config.camera.padding) *
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
    layoutAnimating.current = true
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
    if (running && rotationEnabled) {
      runtime.pose.current[1] =
        (runtime.pose.current[1] + Math.min(delta, 0.05) * config.motion.speed) % (Math.PI * 2)
    }
    const time = playing && showEnterprise ? getCurrentTime() : -1
    const taxiIn = MathUtils.smoothstep(time, TAXI_START, ENGINE_WARMUP_START)
    const warpOut = MathUtils.smoothstep(time, WARP_START, WARP_END)
    const taxiProgress = taxiIn * (1 - warpOut)
    if (time < WARP_START) {
      warpOrbitStart.current = null
    } else if (time <= WARP_END) {
      const progress = MathUtils.smoothstep(time, WARP_START, WARP_END)
      if (!warpOrbitStart.current) {
        warpOrbitStart.current = { ...runtime.cameraOrbit.current, progress }
      }
      if (runtime.dragging.current) {
        // Keep drag live and restart the remaining scripted return from the
        // orbit the user is actively choosing.
        warpOrbitStart.current = { ...runtime.cameraOrbit.current, progress }
      } else {
        const start = warpOrbitStart.current
        const returnProgress = MathUtils.clamp(
          (progress - start.progress) / (1 - start.progress || 1),
          0,
          1,
        )
        const thetaDelta = Math.atan2(Math.sin(-start.theta), Math.cos(-start.theta))
        runtime.cameraOrbit.current = {
          theta: start.theta + thetaDelta * returnProgress,
          phi: MathUtils.lerp(start.phi, DEFAULT_CAMERA_ORBIT.phi, returnProgress),
        }
      }
    } else if (warpOrbitStart.current) {
      // Release the scripted orbit at the endpoint so camera drag remains free.
      if (!runtime.dragging.current) {
        runtime.cameraOrbit.current = { ...DEFAULT_CAMERA_ORBIT }
      }
      warpOrbitStart.current = null
    }
    if (subjectGroup.current) {
      const taxiScale = 1 + (TAXI_SUBJECT_SCALE - 1) * taxiProgress
      subjectGroup.current.scale.setScalar(taxiScale)
      subjectGroup.current.position.y = -TAXI_SUBJECT_Y_OFFSET * taxiProgress
      subjectGroup.current.rotation.x = TAXI_SUBJECT_X_ROTATION * taxiProgress
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
      const distance = cameraDistance(
        size.width / size.height,
        config.camera.fov,
        1.12,
        config.camera.padding,
      )
      const { theta, phi } = runtime.cameraOrbit.current
      group.current.updateWorldMatrix(true, false)
      const target = subjectGroup.current?.getWorldPosition(cameraTarget.current) ?? group.current.position
      // Counter the taxi translation so the camera preserves the original staged pan
      // while continuing to orbit around the shared baby/logo group.
      cameraTargetOffset.current.set(0, TAXI_SUBJECT_Y_OFFSET * taxiProgress, 0)
      group.current.localToWorld(cameraTargetOffset.current)
      group.current.getWorldPosition(groupWorldOrigin.current)
      target.add(cameraTargetOffset.current.sub(groupWorldOrigin.current))
      const sinPhi = Math.sin(phi)
      camera.position.set(
        target.x + distance * sinPhi * Math.sin(theta),
        target.y + distance * Math.cos(phi),
        target.z + distance * sinPhi * Math.cos(theta),
      )
      camera.up.set(0, 1, 0)
      camera.lookAt(target)
      camera.updateMatrixWorld()
      if (layoutAnimating.current) {
        const target = layoutTarget.current
        const settled =
          Math.abs(group.current.position.x - target.x) < 0.001 &&
          Math.abs(group.current.position.y - config.model.position[1]) < 0.001 &&
          Math.abs(group.current.position.z - config.model.position[2]) < 0.001 &&
          Math.abs(group.current.scale.x - target.scale) < 0.001
        if (settled) layoutAnimating.current = false
        else if (!running) invalidate()
      }
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
      <group name="scene-supergroup">
        <Nebula />
        <Stars config={config.stars} />
        <group ref={group} position={config.model.position} scale={config.model.scale}>
          <group ref={subjectGroup}>
            <Suspense fallback={null}>
              <>
                <group
                  ref={logoGroup}
                  position={config.logo.position}
                  rotation={config.logo.rotation}
                  scale={0.42}
                >
                  <Logo config={config} timelineEnabled={isFinalFrontier} />
                </group>
                <group ref={babyGroup}>
                  <Fetus config={config} onReady={onReady} />
                </group>
              </>
            </Suspense>
          </group>
          {showEnterprise && (
            <Suspense fallback={null}>
              <Enterprise
                anchor={group}
                babyGroup={babyGroup}
                logoGroup={logoGroup}
                debugObjects={debugObjects}
              />
            </Suspense>
          )}
        </group>
      </group>
      <PalettePass config={config} resolution={resolution} />
    </>
  )
}
