import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Group, ShaderMaterial } from 'three'
import type { SceneConfig } from '../config/scene'
import { seededRandom } from './math'

const vertexShader = `
  uniform float uTime;
  uniform float uSize;
  uniform float uBrightness;
  attribute float aPhase;
  attribute float aSparkle;
  attribute float aSize;
  attribute float aBrightness;
  attribute float aTwinkleRate;
  varying float vGlow;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float pulse = 0.5 + 0.5 * sin(uTime * aTwinkleRate + aPhase);
    vGlow = (0.12 + aSparkle * 0.88) * pulse * aBrightness * uBrightness;
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = uSize * aSize * (30.0 / max(1.0, -viewPosition.z));
  }
`

const fragmentShader = `
  varying float vGlow;
  void main() {
    float radius = length(gl_PointCoord - vec2(0.5));
    float core = 1.0 - smoothstep(0.12, 0.5, radius);
    gl_FragColor = vec4(vec3(0.42 + vGlow * 0.58), core * vGlow);
  }
`

export default function Stars({ config }: { config: SceneConfig['stars'] }) {
  const material = useRef<ShaderMaterial>(null)
  const field = useRef<Group>(null)
  const { positions, phases, sparkles, sizes, brightnesses, twinkleRates } = useMemo(() => {
    const random = seededRandom(config.seed)
    const positions = new Float32Array(config.count * 3)
    const phases = new Float32Array(config.count)
    const sparkles = new Float32Array(config.count)
    const sizes = new Float32Array(config.count)
    const brightnesses = new Float32Array(config.count)
    const twinkleRates = new Float32Array(config.count)
    for (let i = 0; i < config.count; i++) {
      positions.set([(random() - 0.5) * 24, (random() - 0.5) * 16, -2 - random() * 12], i * 3)
      phases[i] = random() * Math.PI * 2
      sparkles[i] = random()
      sizes[i] = 0.4 + random() * 2.2
      brightnesses[i] = 0.18 + random() * 1.22
      twinkleRates[i] = 0.2 + random() * 2.3
    }
    return { positions, phases, sparkles, sizes, brightnesses, twinkleRates }
  }, [config.count, config.seed])

  useEffect(() => {
    if (material.current) {
      material.current.uniforms.uSize.value = config.size
      material.current.uniforms.uBrightness.value = config.brightness
    }
  }, [config.size, config.brightness])

  useFrame((_, delta) => {
    if (material.current) {
      material.current.uniforms.uTime.value += Math.min(delta, 0.05)
    }
    if (field.current) {
      field.current.rotation.y += delta * 0.0009
      field.current.rotation.x =
        Math.sin((material.current?.uniforms.uTime.value ?? 0) * 0.025) * 0.006
    }
  })

  return (
    <group ref={field}>
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} />
          <bufferAttribute attach="attributes-aSparkle" args={[sparkles, 1]} />
          <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
          <bufferAttribute attach="attributes-aBrightness" args={[brightnesses, 1]} />
          <bufferAttribute attach="attributes-aTwinkleRate" args={[twinkleRates, 1]} />
        </bufferGeometry>
        <shaderMaterial
          ref={material}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={{
            uTime: { value: 0 },
            uSize: { value: config.size },
            uBrightness: { value: config.brightness },
          }}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  )
}
