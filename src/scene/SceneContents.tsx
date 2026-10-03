import { Suspense, useEffect, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, PerspectiveCamera } from 'three'
import type { SceneConfig, Vec3 } from '../config/scene'
import Fetus from './Fetus'
import Stars from './Stars'
import PalettePass from './PalettePass'
import { cameraDistance } from './math'

export interface RuntimeScene {
  pose: MutableRefObject<Vec3>
  invalidate: MutableRefObject<() => void>
  dragging: MutableRefObject<boolean>
}

export default function SceneContents({
  config,
  runtime,
  running,
  resolution,
  onReady,
  onSlow,
}: {
  config: SceneConfig
  runtime: RuntimeScene
  running: boolean
  resolution: number
  onReady: () => void
  onSlow: () => void
}) {
  const group = useRef<Group>(null)
  const { camera, size, invalidate } = useThree()
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
    perspective.position.set(
      0,
      0,
      cameraDistance(size.width / size.height, config.camera.fov, 1.12, config.camera.padding),
    )
    perspective.lookAt(0, 0, 0)
    perspective.updateProjectionMatrix()
    invalidate()
  }, [camera, config.camera, size, invalidate])
  useFrame((_, delta) => {
    if (running && !runtime.dragging.current)
      runtime.pose.current[1] =
        (runtime.pose.current[1] + Math.min(delta, 0.05) * config.motion.speed) % (Math.PI * 2)
    if (group.current) group.current.rotation.set(...runtime.pose.current)
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
      <Stars config={config.stars} />
      <group ref={group} position={config.model.position} scale={config.model.scale}>
        <Suspense fallback={null}>
          <Fetus config={config} onReady={onReady} />
        </Suspense>
      </group>
      <PalettePass config={config} resolution={resolution} />
    </>
  )
}
