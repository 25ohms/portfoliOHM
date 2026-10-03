import { useMemo } from 'react'
import { AdditiveBlending } from 'three'
import type { SceneConfig } from '../config/scene'
import { seededRandom } from './math'

export default function Stars({ config }: { config: SceneConfig['stars'] }) {
  const { positions, colors } = useMemo(() => {
    const random = seededRandom(config.seed)
    const positions = new Float32Array(config.count * 3)
    const colors = new Float32Array(config.count * 3)
    for (let i = 0; i < config.count; i++) {
      positions.set([(random() - 0.5) * 24, (random() - 0.5) * 16, -2 - random() * 12], i * 3)
      const brightness = 0.12 + Math.pow(random(), 3) * 0.88
      colors.set([brightness, brightness, brightness], i * 3)
    }
    return { positions, colors }
  }, [config.count, config.seed])
  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        size={config.size}
        sizeAttenuation={false}
        transparent
        opacity={config.brightness}
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </points>
  )
}
