import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Group, ShaderMaterial } from 'three'
import type { SceneConfig } from '../config/scene'
import { seededRandom } from './math'
import { useMusicPlayer } from '../audio/MusicPlayer'
import { readBassLevel } from '../audio/bass'

const vertexShader = `
  uniform float uTime;
  uniform float uSize;
  uniform float uBrightness;
  uniform float uBass;
  attribute float aPhase;
  attribute float aSparkle;
  attribute float aSize;
  attribute float aBrightness;
  attribute float aTwinkleRate;
  varying float vGlow;
  varying float vTwinkle;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float pulse = 0.5 + 0.5 * sin(uTime * aTwinkleRate + aPhase);
    vTwinkle = pulse * (0.45 + aSparkle * 0.55);
    float spawn = smoothstep(aSparkle - 0.08, aSparkle + 0.08, 0.72 + uBass * 0.28);
    vGlow = (0.12 + aSparkle * 0.88) * pulse * aBrightness * uBrightness * spawn * (1.0 + uBass * 0.65);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = uSize * aSize * (1.0 + vTwinkle * 2.5) * (30.0 / max(1.0, -viewPosition.z));
  }
`

const fragmentShader = `
  varying float vGlow;
  varying float vTwinkle;
  void main() {
    vec2 point = gl_PointCoord - vec2(0.5);
    float radius = length(point);
    float core = 1.0 - smoothstep(0.12, 0.5, radius);
    float flareLength = 0.08 + vTwinkle * 0.42;
    float horizontal = (1.0 - smoothstep(0.008, 0.025, abs(point.y))) *
      (1.0 - smoothstep(flareLength, flareLength + 0.035, abs(point.x)));
    float vertical = (1.0 - smoothstep(0.008, 0.025, abs(point.x))) *
      (1.0 - smoothstep(flareLength, flareLength + 0.035, abs(point.y)));
    float flare = max(horizontal, vertical) * smoothstep(0.6, 0.95, vTwinkle) * 0.8;
    gl_FragColor = vec4(vec3(0.42 + vGlow * 0.58), max(core, flare) * vGlow);
  }
`

export default function Stars({ config }: { config: SceneConfig['stars'] }) {
  const material = useRef<ShaderMaterial>(null)
  const field = useRef<Group>(null)
  const bassLevel = useRef(0)
  const { analyser, playing } = useMusicPlayer()
  const frequencyData = useMemo(
    () => (analyser ? new Uint8Array(analyser.frequencyBinCount) : null),
    [analyser],
  )
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
    const target = playing && analyser && frequencyData ? readBassLevel(analyser, frequencyData) : 0
    const rate = target > bassLevel.current ? 45 : playing ? 14 : 3.5
    bassLevel.current += (target - bassLevel.current) * (1 - Math.exp(-Math.min(delta, 0.05) * rate))
    if (material.current) {
      material.current.uniforms.uTime.value += Math.min(delta, 0.05)
      material.current.uniforms.uBass.value = bassLevel.current
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
            uBass: { value: 0 },
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
