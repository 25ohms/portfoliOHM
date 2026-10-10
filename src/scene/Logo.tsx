import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { FetusLoader } from './FetusLoader'
import logoUrl from '../../models/ohmLOGO/ohmLOGO.fbx?url'
import type { SceneConfig } from '../config/scene'
import { useMusicPlayer } from '../audio/MusicPlayer'
import { logPerformance } from '../utils/performanceLogger'
import { LOGO_BLOOM_LAYER } from './renderLayers'
import {
  ENGINE_WARMUP_START,
  TAXI_START,
  displacementMultiplierAt,
  WARP_LOGO_FADE_DURATION,
  WARP_START,
} from './sceneTimeline'

const TAXI_GLOW_BOOST = 0.75

function bandLevel(
  data: Uint8Array,
  sampleRate: number,
  fftSize: number,
  low: number,
  high: number,
) {
  const binWidth = sampleRate / fftSize
  const first = Math.max(0, Math.floor(low / binWidth))
  const last = Math.min(data.length - 1, Math.ceil(high / binWidth))
  let sum = 0
  for (let bin = first; bin <= last; bin++) sum += data[bin]
  return sum / Math.max(1, last - first + 1) / 255
}

export default function Logo({
  config,
  timelineEnabled,
}: {
  config: SceneConfig
  timelineEnabled: boolean
}) {
  const original = useLoader(FetusLoader, logoUrl)
  const { analyser, playing, getCurrentTime } = useMusicPlayer()
  const beat = useRef({
    level: 0,
    vibration: 0,
    previousKick: 0,
    previousSnare: 0,
    previousAir: 0,
  })
  const frequencyData = useMemo(
    () => (analyser ? new Uint8Array(analyser.frequencyBinCount) : null),
    [analyser],
  )
  const { normalized, coreMaterial, haloMaterial, geometries, normalizationScale } =
    useMemo(() => {
      const startedAt = performance.now()
      const object = clone(original)
      const halo = clone(original)
      const geometries: Array<{ geometry: BufferGeometry; base: Float32Array }> = []
      const coreMaterial = new MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        toneMapped: false,
      })
      const haloMaterial = new MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        toneMapped: false,
      })
      const prepare = (source: Object3D, material: MeshBasicMaterial) => {
        source.traverse((child) => {
          if (!(child instanceof Mesh)) return
          child.geometry = child.geometry.clone()
          const position = child.geometry.getAttribute('position')
          position.setUsage(DynamicDrawUsage)
          geometries.push({
            geometry: child.geometry,
            base: new Float32Array(position.array as ArrayLike<number>),
          })
          child.material = material
          child.layers.set(material === haloMaterial ? LOGO_BLOOM_LAYER : 0)
        })
      }
      prepare(object, coreMaterial)
      prepare(halo, haloMaterial)
      object.updateMatrixWorld(true)
      const bounds = new Box3().setFromObject(object)
      const center = bounds.getCenter(new Vector3())
      const scale = 1 / Math.max(...bounds.getSize(new Vector3()).toArray())
      object.position.sub(center)
      halo.position.copy(object.position)
      const normalized = new Group()
      normalized.add(object)
      const haloGroup = new Group()
      haloGroup.add(halo)
      haloGroup.scale.setScalar(1)
      normalized.add(haloGroup)
      normalized.scale.setScalar(scale)
      logPerformance('OHM_LOGO_GEOMETRY_PREPARED', {
        meshCount: geometries.length,
        vertexCount: geometries.reduce(
          (count, item) => count + item.geometry.getAttribute('position').count,
          0,
        ),
        durationMs: Math.round(performance.now() - startedAt),
      })
      return {
        normalized,
        coreMaterial,
        haloMaterial,
        geometries,
        normalizationScale: scale,
      }
    }, [original])

  useEffect(() => {
    coreMaterial.color.setRGB(
      config.material.intensity,
      config.material.intensity,
      config.material.intensity,
    )
    coreMaterial.opacity = config.material.opacity
  }, [coreMaterial, config.material])

  useFrame((_, delta) => {
    const signal = beat.current
    let kick = 0
    let snare = 0
    let bassTarget = 0
    if (!playing) {
      signal.level = 0
      signal.vibration = 0
      signal.previousKick = 0
      signal.previousSnare = 0
      signal.previousAir = 0
    }
    if (playing && analyser && frequencyData) {
      analyser.getByteFrequencyData(frequencyData)
      const sampleRate = analyser.context.sampleRate
      const fftSize = analyser.fftSize
      const kickLevel = bandLevel(frequencyData, sampleRate, fftSize, 35, 150)
      bassTarget = Math.max(0, Math.min(1, (kickLevel - 0.1) * 2.2))
      const snareBody = bandLevel(frequencyData, sampleRate, fftSize, 150, 500)
      const snareAir = bandLevel(frequencyData, sampleRate, fftSize, 1400, 5000)
      if (signal.previousKick > 0) {
        kick = kickLevel > 0.16 ? Math.max(0, kickLevel - signal.previousKick - 0.05) * 16 : 0
        snare = Math.max(
          snareBody > 0.16 ? Math.max(0, snareBody - signal.previousSnare - 0.045) * 12 : 0,
          snareAir > 0.2 ? Math.max(0, snareAir - signal.previousAir - 0.055) * 8 : 0,
        )
      }
      signal.previousKick = kickLevel
      signal.previousSnare = snareBody
      signal.previousAir = snareAir
    }
    const hit = Math.min(1, Math.max(kick, snare))
    const envelopeRate = hit > signal.level ? 70 : 26
    signal.level += (hit - signal.level) * (1 - Math.exp(-Math.min(delta, 0.05) * envelopeRate))
    const vibrationRate = bassTarget > signal.vibration ? 32 : 12
    signal.vibration +=
      (bassTarget - signal.vibration) * (1 - Math.exp(-Math.min(delta, 0.05) * vibrationRate))
    const intensity = signal.level
    const base = config.material.intensity
    coreMaterial.color.setRGB(
      base + intensity * 0.9,
      base + intensity * 0.9,
      base + intensity * 0.9,
    )
    coreMaterial.opacity = config.material.opacity + intensity * (1 - config.material.opacity)
    haloMaterial.color.setRGB(1.8, 1.8, 1.8)
    let timelineGlow = 0
    let warpFade = 1
    if (timelineEnabled) {
      const timelineTime = getCurrentTime()
      timelineGlow = MathUtils.smoothstep(timelineTime, TAXI_START, ENGINE_WARMUP_START)
      warpFade = 1 - MathUtils.smoothstep(
        timelineTime,
        WARP_START,
        WARP_START + WARP_LOGO_FADE_DURATION,
      )
    }
    haloMaterial.opacity = (intensity * 0.9 + timelineGlow * TAXI_GLOW_BOOST) * warpFade
    const time = performance.now() / 1000
    const timelineMultiplier = timelineEnabled ? displacementMultiplierAt(getCurrentTime()) : 1
    const amount =
      ((0.0035 * signal.vibration) / (normalizationScale * 0.42)) * timelineMultiplier
    for (const { geometry, base: originalPositions } of geometries) {
      const position = geometry.getAttribute('position')
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

  useEffect(
    () => () => {
      coreMaterial.dispose()
      haloMaterial.dispose()
      geometries.forEach(({ geometry }) => geometry.dispose())
    },
    [coreMaterial, haloMaterial, geometries],
  )

  return <primitive object={normalized} dispose={null} />
}
