import { useMemo, useRef } from 'react'
import { BackSide, ShaderMaterial } from 'three'
import { useFrame } from '@react-three/fiber'
import { useMusicPlayer } from '../audio/MusicPlayer'
import { readBassLevel } from '../audio/bass'

const SPEED_TRANSITION_RATE = 4.5

// Procedural cloud structure adapted from LizardLover42's Shadertoy: https://www.shadertoy.com/view/33cSWX

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
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec3(1.0, 0.0, 0.0));
    float c = hash(i + vec3(0.0, 1.0, 0.0));
    float d = hash(i + vec3(1.0, 1.0, 0.0));
    float e = hash(i + vec3(0.0, 0.0, 1.0));
    float f1 = hash(i + vec3(1.0, 0.0, 1.0));
    float g = hash(i + vec3(0.0, 1.0, 1.0));
    float h = hash(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
      mix(mix(e, f1, f.x), mix(g, h, f.x), f.y),
      f.z
    );
  }
  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 2; i++) {
      value += amplitude * noise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }
  void main() {
    vec3 direction = normalize(vDirection);
    vec3 p = direction * 4.5;
    float t = uTime * 0.1;
    float q = fbm(p - vec3(t, t * 0.7, -t * 0.4));
    float r = fbm(p + vec3(q) + vec3(1.7, 9.2, 4.6) + vec3(0.15 * t));
    float f = pow(fbm(p + vec3(r)), 3.0);

    vec3 nebulaColor = mix(vec3(0.1, 0.0, 0.2), vec3(0.6, 0.1, 0.5), f * 2.0);
    nebulaColor = mix(nebulaColor, vec3(0.9, 0.6, 0.2), abs(q));
    nebulaColor = mix(nebulaColor, vec3(0.9), abs(r));
    nebulaColor *= f * f * f + f * f + f;
    float intensity = dot(nebulaColor, vec3(0.2126, 0.7152, 0.0722));
    float cloudBody = smoothstep(0.03, 0.24, f);
    float nebula = clamp(cloudBody * (0.26 + intensity * 0.3), 0.0, 0.42);
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
