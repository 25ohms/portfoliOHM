import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import {
  AdditiveBlending,
  Box3,
  DynamicDrawUsage,
  Group,
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

export default function Fetus({ config, onReady }: { config: SceneConfig; onReady: () => void }) {
  const original = useLoader(FetusLoader, modelUrl)
  const { analyser, playing } = useMusicPlayer()
  const bassLevel = useRef(0)
  const audioData = useMemo(
    () => (analyser ? new Uint8Array(analyser.frequencyBinCount) : null),
    [analyser],
  )
  const { normalized, material, geometries } = useMemo(() => {
    const startedAt = performance.now()
    const object = clone(original)
    const geometries: Mesh['geometry'][] = []
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
    logPerformance('FETUS_GEOMETRY_PREPARED', {
      meshCount: geometries.length,
      vertexCount: geometries.reduce(
        (count, geometry) => count + geometry.getAttribute('position').count,
        0,
      ),
      durationMs: Math.round(performance.now() - startedAt),
    })
    return { normalized, material, geometries }
  }, [original])
  useFrame((state, delta) => {
    const target = playing && analyser && audioData ? readBassLevel(analyser, audioData) : 0
    bassLevel.current = smoothBassLevel(bassLevel.current, target, delta)
    const strength = bassLevel.current
    if (strength === 0) return
    const time = state.clock.elapsedTime
    for (const geometry of geometries) {
      const position = geometry.getAttribute('position')
      const base = geometry.userData.basePosition as Float32Array | undefined
      if (!base) {
        geometry.userData.basePosition = new Float32Array(position.array as ArrayLike<number>)
      }
      const originalPositions = geometry.userData.basePosition as Float32Array
      const amount = (0.008 * strength) / normalized.scale.x
      for (let index = 0; index < position.count; index++) {
        const offset = index * 3
        const x = originalPositions[offset]
        const y = originalPositions[offset + 1]
        const z = originalPositions[offset + 2]
        const phase = x * 17.1 + y * 31.7 + z * 23.3
        position.array[offset] = x + Math.sin(time * 37 + phase) * amount
        position.array[offset + 1] = y + Math.sin(time * 43 + phase * 1.7) * amount
        position.array[offset + 2] = z + Math.sin(time * 39 + phase * 2.3) * amount
      }
      position.needsUpdate = true
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
  return <primitive object={normalized} dispose={null} />
}
