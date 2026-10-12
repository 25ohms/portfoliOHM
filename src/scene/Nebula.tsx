import { useMemo, useRef } from 'react'
import { BackSide, ShaderMaterial } from 'three'
import { useFrame } from '@react-three/fiber'
import { useMusicPlayer } from '../audio/MusicPlayer'
import { readBassLevel } from '../audio/bass'

const SPEED_TRANSITION_RATE = 4.5

const vertexShader = `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = `
  uniform float uTime;
  varying vec3 vDirection;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float x00 = mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x);
    float x10 = mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x);
    float x01 = mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x);
    float x11 = mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x);
    return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
  }
  void main() {
    vec3 p = normalize(vDirection);
    float cloud = noise(p * 5.0 + vec3(uTime * 0.008, -uTime * 0.004, uTime * 0.003));
    cloud += 0.5 * noise(p * 11.0 - vec3(uTime * 0.006));
    cloud += 0.25 * noise(p * 23.0 + vec3(uTime * 0.003));
    float shape = smoothstep(0.72, 1.18, cloud);
    float wisps = smoothstep(0.52, 0.93, noise(p * 8.0 + vec3(0.0, uTime * 0.005, 0.0)));
    float nebula = clamp(shape * 0.48 + wisps * shape * 0.4, 0.0, 0.48);
    gl_FragColor = vec4(vec3(nebula), 1.0);
  }
`

export default function Nebula() {
  const material = useRef<ShaderMaterial>(null)
  const bassLevel = useRef(0)
  const { analyser, playing } = useMusicPlayer()
  const frequencyData = useMemo(
    () => (analyser ? new Uint8Array(analyser.frequencyBinCount) : null),
    [analyser],
  )
  useFrame((_, delta) => {
    const target = playing && analyser && frequencyData ? readBassLevel(analyser, frequencyData) : 0
    bassLevel.current +=
      (target - bassLevel.current) *
      (1 - Math.exp(-Math.min(delta, 0.05) * SPEED_TRANSITION_RATE))
    if (material.current) {
      material.current.uniforms.uTime.value +=
        Math.min(delta, 0.05) * (1 + bassLevel.current * 2)
    }
  })
  return (
    <mesh renderOrder={-1000}>
      <sphereGeometry args={[2200, 64, 48]} />
      <shaderMaterial
        ref={material}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={{ uTime: { value: 0 } }}
        side={BackSide}
        toneMapped={false}
      />
    </mesh>
  )
}
