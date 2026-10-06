import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { ShaderMaterial } from 'three'

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = `
  uniform float uTime;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec2 p = (vUv - 0.5) * vec2(2.0, 1.2);
    float cloud = noise(p * 3.0 + vec2(uTime * 0.008, -uTime * 0.004));
    cloud += 0.5 * noise(p * 6.0 - uTime * 0.006);
    cloud += 0.25 * noise(p * 12.0 + uTime * 0.003);
    float shape = smoothstep(0.36, 0.88, cloud) * (1.0 - smoothstep(0.35, 1.12, length(p * vec2(0.8, 1.0))));
    float wisps = smoothstep(0.52, 0.93, noise(p * 4.2 + vec2(0.0, uTime * 0.005)));
    float nebula = clamp(shape * 0.48 + wisps * shape * 0.4, 0.0, 0.48);
    gl_FragColor = vec4(vec3(nebula), nebula);
  }
`

export default function Nebula() {
  const material = useRef<ShaderMaterial>(null)
  useFrame((_, delta) => {
    if (material.current) {
      material.current.uniforms.uTime.value += Math.min(delta, 0.05)
    }
  })
  return (
    <mesh position={[0, 0, -18]}>
      <planeGeometry args={[46, 29]} />
      <shaderMaterial
        ref={material}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={{ uTime: { value: 0 } }}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}
